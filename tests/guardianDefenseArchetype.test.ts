/**
 * 수호 방어 스펙 실물빌드 통일 — 정규 경로 배선 가드 (ADR-0025).
 *
 * 이 프로젝트의 반복 결함은 "단위 테스트는 그린인데 배선이 통째 없다" 이다. 방어 스펙을 실물
 * 빌드에서 파생하고(퇴역 시점) 무기 타입이 방어 발사체를 결정하는 이번 변경은, 순수 매핑 함수만
 * 테스트하면 그 매핑이 **실제 퇴역 경로**·**실제 sim 발사 루프**에 닿는지 증명하지 못한다. 그래서
 * 여기서는:
 *   ① mapLoadoutToGuardianSnapshot 의 구조(파워=빌드, 프리셋=이동 AI, 발사체=무기 타입),
 *   ② 실제 retireActiveShip 이 장착 무기 타입을 스냅샷에 전파하는지,
 *   ③ 실제 sim(spawnInvasionGuardians→stepInvasionGuardians)이 무기별 고유 발사체를 쏘는지
 * 를 **정규 함수 호출**로 관측한다. 배선이 빠지면 모든 무기가 벌컨 단발로 수렴해 아래 단언이 깨진다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { Entity } from '../src/sim/entities.js';
import {
  spawnInvasionGuardians,
  stepInvasionGuardians,
  MAINTENANCE_FULL,
} from '../src/sim/invasion/guardianBridge.js';
import { normalizeInvasionLayers } from '../src/sim/invasion/normalize.js';
import { createInvasionRuntime } from '../src/sim/invasion/scroll.js';
import type { InvasionStepContext, InvasionGuardianPlacement } from '../src/sim/invasion/types.js';
import { BK_NONE, BK_HOMING, BK_ACCEL } from '../src/sim/bullets.js';
import {
  mapLoadoutToGuardianSnapshot,
  GUARDIAN_TITAN,
  GUARDIAN_INTERCEPTOR,
  PERFORMANCE_FULL,
} from '../data/guardian.js';
import type { GuardianSnapshot, GuardianLoadoutInput } from '../data/guardian.js';
import {
  neutralLoadout,
  WEAPON_VULCAN,
  WEAPON_SPREAD,
  WEAPON_RAILGUN,
  WEAPON_MISSILE,
  WEAPON_BEAM,
} from '../src/items/loadout.js';
import { retireAtCap } from './support/retireAtCap.js';
import { defaultProfile } from '../src/save/profile.js';
import type { Item } from '../src/items/types.js';

// ---------------------------------------------------------------------------
// ① 순수 매핑 구조 (ADR-0025): 파워=빌드, 프리셋=이동 AI, 발사체=무기 타입
// ---------------------------------------------------------------------------

function loadout(extra?: Partial<GuardianLoadoutInput>): GuardianLoadoutInput {
  return { ...neutralLoadout(), ...extra };
}

describe('mapLoadoutToGuardianSnapshot — 빌드 파생 구조 (ADR-0025)', () => {
  it('무기 타입이 스냅샷에 전파되고, damageMult·maxHpAdd 가 파워를 키운다', () => {
    const base = mapLoadoutToGuardianSnapshot(GUARDIAN_TITAN, loadout());
    const strong = mapLoadoutToGuardianSnapshot(
      GUARDIAN_TITAN,
      loadout({ weaponType: WEAPON_MISSILE, damageMult: 2, maxHpAdd: 300 }),
    );
    expect(base.weaponType).toBe(WEAPON_VULCAN);
    expect(strong.weaponType).toBe(WEAPON_MISSILE);
    expect(strong.bulletDamage).toBeGreaterThan(base.bulletDamage);
    expect(strong.contactDamage).toBeGreaterThan(base.contactDamage);
    expect(strong.hp).toBeGreaterThan(base.hp);
  });

  it('산탄 발사 서술자: bulletCountAdd→bulletCount, spreadAdd→spread(정수 밀리라디안)', () => {
    const spread = mapLoadoutToGuardianSnapshot(
      GUARDIAN_TITAN,
      loadout({ weaponType: WEAPON_SPREAD, bulletCountAdd: 2, spreadAdd: 0.5 }),
    );
    expect(spread.bulletCount).toBe(3); // 1 + 2
    expect(spread.spread).toBe(500); // round(0.5 * 1000)
    // 전부 유한 정수여야 normalize 가 슬롯을 버리지 않는다.
    for (const v of Object.values(spread)) expect(Number.isInteger(v)).toBe(true);
  });

  it('프리셋은 이동 AI 만 정한다: 같은 빌드면 파워 동일, 거동만 다르다', () => {
    const lo = loadout({ damageMult: 1.5, maxHpAdd: 120 });
    const titan = mapLoadoutToGuardianSnapshot(GUARDIAN_TITAN, lo);
    const inter = mapLoadoutToGuardianSnapshot(GUARDIAN_INTERCEPTOR, lo);
    // 파워(빌드 파생) 동일
    expect(titan.hp).toBe(inter.hp);
    expect(titan.bulletDamage).toBe(inter.bulletDamage);
    expect(titan.fireCooldown).toBe(inter.fireCooldown);
    // 거동(프리셋) 다름: 인터셉터=근접 추격, 타이탄=원거리 버팀
    expect(inter.moveSpeed).toBeGreaterThan(titan.moveSpeed);
    expect(titan.standoff).toBeGreaterThan(inter.standoff);
    expect(titan.radius).toBeGreaterThan(inter.radius);
  });
});

// ---------------------------------------------------------------------------
// ①-b 대표 스탯 계승 (prerequisites.md §0-B 결정 C) — 파생 지점은 mapLoadoutToGuardianSnapshot 한 곳
// ---------------------------------------------------------------------------

describe('mapLoadoutToGuardianSnapshot — 대표 스탯 계승 (결정 C)', () => {
  it('이속 배율을 계승한다(이전에는 프리셋 기본값만 실려 통째로 유실됐다)', () => {
    const base = mapLoadoutToGuardianSnapshot(GUARDIAN_TITAN, loadout());
    const fast = mapLoadoutToGuardianSnapshot(GUARDIAN_TITAN, loadout({ moveSpeedMult: 1.5 }));
    expect(fast.moveSpeed).toBe(Math.round(base.moveSpeed * 1.5));
    expect(Number.isInteger(fast.moveSpeed)).toBe(true);
  });

  it('이속 계승은 프리셋 기본값의 2배에서 멈춘다(이동 AI 진동 방지 상한)', () => {
    const base = mapLoadoutToGuardianSnapshot(GUARDIAN_TITAN, loadout());
    const insane = mapLoadoutToGuardianSnapshot(GUARDIAN_TITAN, loadout({ moveSpeedMult: 99 }));
    expect(insane.moveSpeed).toBe(Math.round(base.moveSpeed * 2));
  });

  it('사거리를 늘리면 탄 수명도 함께 늘어난다(고정 수명이면 사거리 계승이 조용히 무효)', () => {
    const base = mapLoadoutToGuardianSnapshot(GUARDIAN_TITAN, loadout());
    const longRange = mapLoadoutToGuardianSnapshot(GUARDIAN_TITAN, loadout({ rangeAdd: 1000 }));
    expect(longRange.range).toBeGreaterThan(base.range);
    expect(longRange.bulletLife).toBeGreaterThan(base.bulletLife);
    // 사거리 2배(1000→2000), 탄속 동일 → 수명도 2배여야 탄이 사거리 끝까지 간다.
    expect(longRange.bulletLife).toBe(base.bulletLife * 2);
  });

  it('느린 탄은 수명이 늘고, 빠른 탄이어도 수명은 기본값 아래로 내려가지 않는다(하한)', () => {
    const base = mapLoadoutToGuardianSnapshot(GUARDIAN_TITAN, loadout());
    const slow = mapLoadoutToGuardianSnapshot(GUARDIAN_TITAN, loadout({ bulletSpeedMult: 0.5 }));
    const quick = mapLoadoutToGuardianSnapshot(GUARDIAN_TITAN, loadout({ bulletSpeedMult: 2 }));
    expect(slow.bulletLife).toBe(base.bulletLife * 2);
    expect(quick.bulletLife).toBe(base.bulletLife); // 계승이 기존 수호를 약화시키지는 않는다
  });

  it('탄 수명 상한이 있다(장수명 탄 누적으로 예산을 먹지 않게)', () => {
    const huge = mapLoadoutToGuardianSnapshot(
      GUARDIAN_TITAN,
      loadout({ rangeAdd: 100000, bulletSpeedMult: 0.1 }),
    );
    expect(huge.bulletLife).toBe(240);
    for (const v of Object.values(huge)) expect(Number.isInteger(v)).toBe(true);
  });

  it('손상된 이속 배율(NaN)에도 유한 정수 스냅샷이 나온다(슬롯 폐기 방지)', () => {
    const broken = mapLoadoutToGuardianSnapshot(GUARDIAN_TITAN, loadout({ moveSpeedMult: NaN }));
    const base = mapLoadoutToGuardianSnapshot(GUARDIAN_TITAN, loadout());
    expect(broken.moveSpeed).toBe(base.moveSpeed);
    for (const v of Object.values(broken)) expect(Number.isInteger(v)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ② 실제 퇴역 경로가 장착 무기 타입을 스냅샷에 전파한다
// ---------------------------------------------------------------------------

function mainWeaponItem(weaponType: number): Item {
  return {
    id: `w-${weaponType}`,
    slot: 'main',
    weaponType,
    rarity: 'rare',
    affixes: [],
    source: { planet: 0, stage: 1 },
  };
}

describe('retireActiveShip — 실물 빌드 무기 타입이 방어 스냅샷에 실린다 (배선 가드)', () => {
  it('레일건 장착으로 퇴역하면 수호 스냅샷 weaponType 이 레일건이다', () => {
    const p = defaultProfile();
    p.ships[p.activeShipIndex]!.equipped = { main: mainWeaponItem(WEAPON_RAILGUN) };
    retireAtCap(p, GUARDIAN_TITAN);
    expect(p.guardians[0]!.snapshot.weaponType).toBe(WEAPON_RAILGUN);
  });

  it('빔 장착 vs 벌컨 장착은 서로 다른 방어 발사체 서술자를 낳는다', () => {
    const beam = defaultProfile();
    beam.ships[beam.activeShipIndex]!.equipped = { main: mainWeaponItem(WEAPON_BEAM) };
    retireAtCap(beam, GUARDIAN_TITAN);
    const vulcan = defaultProfile();
    vulcan.ships[vulcan.activeShipIndex]!.equipped = { main: mainWeaponItem(WEAPON_VULCAN) };
    retireAtCap(vulcan, GUARDIAN_TITAN);
    expect(beam.guardians[0]!.snapshot.weaponType).toBe(WEAPON_BEAM);
    expect(vulcan.guardians[0]!.snapshot.weaponType).toBe(WEAPON_VULCAN);
  });
});

// ---------------------------------------------------------------------------
// ③ 실제 sim 발사 루프가 무기별 고유 발사체를 쏜다 (정규 경로 배선 가드)
// ---------------------------------------------------------------------------

/** 프리셋(이동 AI)만 지정하고 나머지는 무기 타입별 발사 서술자를 세운 방어 스냅샷. */
function snapFor(weaponType: number, extra?: Partial<GuardianLoadoutInput>): GuardianSnapshot {
  return mapLoadoutToGuardianSnapshot(GUARDIAN_TITAN, loadout({ weaponType, ...extra }));
}

/**
 * 수호 1기를 스폰하고 플레이어를 사거리·standoff 이내에 둔 뒤 `ticks` 만큼 정규 스텝을 돌려,
 * 그 수호가 쏜 살아있는 적탄을 반환한다. stepInvasionGuardians 만 돌리므로(stepWorld 아님) 탄은
 * 수명 감쇠 없이 누적된다 — 발사 자체를 관측하기 위함이다.
 */
function firedBullets(snapshot: GuardianSnapshot, ticks = 120): Entity[] {
  const state = createWorld(1, DEFAULT_CONFIG);
  const player = state.entities.find((e) => e.kind === 'player');
  if (player === undefined) throw new Error('player entity not found');
  const placement: InvasionGuardianPlacement = {
    x: 0,
    y: 0,
    snapshot,
    performanceCP: PERFORMANCE_FULL,
    lineageBonusBp: 0,
    milestones: 0,
  };
  const layers = normalizeInvasionLayers({ l3: { guardians: [placement, null] } });
  spawnInvasionGuardians(state, layers);
  // 플레이어를 standoff(타이탄 640) 이내·사거리 이내에 둬 수호가 이동 없이 사격하게 한다.
  player.x = 250;
  player.y = 0;
  player.dead = false;
  const ctx: InvasionStepContext = {
    layers,
    runtime: createInvasionRuntime(),
    maintenance: MAINTENANCE_FULL,
  };
  for (let t = 0; t < ticks; t++) stepInvasionGuardians(state, player, ctx);
  return state.entities.filter((e) => e.kind === 'enemyBullet' && !e.dead);
}

describe('stepInvasionGuardians — 무기 아키타입 발사 배선 (정규 경로)', () => {
  it('미사일 수호는 유도(BK_HOMING) 적탄을 쏜다', () => {
    const bullets = firedBullets(snapFor(WEAPON_MISSILE));
    expect(bullets.length).toBeGreaterThan(0);
    expect(bullets.some((b) => b.enemyType === BK_HOMING)).toBe(true);
  });

  it('레일건 수호는 가속(BK_ACCEL) 단발 적탄을 쏜다', () => {
    const bullets = firedBullets(snapFor(WEAPON_RAILGUN));
    expect(bullets.length).toBeGreaterThan(0);
    expect(bullets.some((b) => b.enemyType === BK_ACCEL)).toBe(true);
  });

  it('빔 수호는 조준선 위에 정적(속도 0) 세그먼트 적탄을 여럿 깐다', () => {
    const bullets = firedBullets(snapFor(WEAPON_BEAM));
    const staticSegs = bullets.filter((b) => b.vx === 0 && b.vy === 0);
    expect(staticSegs.length).toBeGreaterThan(1);
  });

  it('산탄 수호는 벌컨보다 발사당 탄을 더 많이 쏜다(팬 배선)', () => {
    // 두 스냅샷의 발사 간격은 같으므로(동일 fireRateMult) 같은 틱수에 같은 횟수 발사한다 —
    // 탄 수 차이는 오직 발사당 팬 발수(bulletCount)에서 온다. 배선이 빠지면 둘이 같아진다.
    const vulcan = firedBullets(snapFor(WEAPON_VULCAN));
    const spread = firedBullets(snapFor(WEAPON_SPREAD, { bulletCountAdd: 2, spreadAdd: 0.5 }));
    expect(vulcan.length).toBeGreaterThan(0);
    expect(spread.length).toBe(vulcan.length * 3); // bulletCount 3 vs 1
    // 벌컨은 순수 직진(거동 미부착)이다.
    expect(vulcan.every((b) => b.enemyType === BK_NONE)).toBe(true);
  });
});
