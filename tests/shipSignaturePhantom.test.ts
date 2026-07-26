/**
 * M8 시그니처 배선 — 팬텀(typeId 3 / 비트 20) 은신.
 *
 * ## 무엇을 막는가
 * 1. **배선 부재(이 저장소 8회 재발형)** — "단위 테스트는 전부 그린인데 world.ts 분기가 통째로
 *    없다". 그래서 아래 통합 케이스는 `Profile{typeId:3}` → `buildRunConfig` → `createWorld` →
 *    `stepWorld` 정규 경로를 굴려 **은신에 실제로 진입하고 해제 첫 타가 실제로 소진되는지**를
 *    런타임 궤적으로 잰다.
 * 2. **가짜 증거** — "typeId 0 런과 결과가 다르다" 는 **배선이 0줄이어도 이미 참**이다(baseBp 가
 *    damage/maxHp/moveSpeed 를 바꾸고 shipType 이 해시 꼬리에 접힌다). 그래서 정본 대조군은
 *    **시그니처 억제 동형 대조군**이다 — 같은 config 에서 `signatureOn` 의 2축(마스크·shipType)만
 *    눌러 시그니처 하나만 제거한 런.
 * 3. **반쪽 은신** — 은신은 잡몹 일반 사격·돌격형 파편 분출·보스 패턴 세 방출 경로를 모두 막아야
 *    한다. 하나라도 빠지면 "어떤 적은 은신을 뚫는다" 가 되는데 화면상 조용하다. 억제 대조군 대비
 *    **적탄 총량이 실제로 갈리는지**로 잰다.
 * 4. **양방향 리셋 결함** — 무피격 카운터를 "없던 피격"(생존 캡스톤 무효)에서도 리셋하면 은신이
 *    사실상 발동하지 않고, 반대로 실피격에서 리셋을 빼면 맞아도 은신이 유지된다. 둘 다 조용하다.
 * 5. **aux 오염** — 시그니처 없는 런에서 aux 가 0 이 아니게 되면 조건부 폴드 규약이 깨진다.
 */

import { describe, it, expect } from 'vitest';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import type { Profile } from '../src/save/profile.js';
import { createWorld, stepWorld, playerCloaked } from '../src/sim/world.js';
import type { InputFrame, WorldConfig } from '../src/sim/world.js';
import { PLANET_MODE } from '../src/sim/planetMode.js';
import { hashWorld } from '../src/sim/replay.js';
import { hasCapstone } from '../src/sim/capstones.js';
import {
  SIG_PHANTOM_CLOAK,
  SIGNATURE_BITS,
  CLOAK_UNHIT_TICKS,
  CLOAK_BREAK_BP,
  cloakActive,
  cloakBreakDamage,
} from '../src/sim/shipSignature.js';
import { zeroSkillInvest } from '../data/ships/index.js';

// ---------------------------------------------------------------------------
// ① 순수 함수 골든 — 임계와 배율
// ---------------------------------------------------------------------------

describe('팬텀 은신 — 순수 산술 골든', () => {
  it('은신은 연속 무피격이 임계에 **도달**해야 성립한다(경계 포함)', () => {
    expect(cloakActive(CLOAK_UNHIT_TICKS - 1)).toBe(false);
    expect(cloakActive(CLOAK_UNHIT_TICKS)).toBe(true);
    expect(cloakActive(CLOAK_UNHIT_TICKS + 1000)).toBe(true);
    expect(cloakActive(0)).toBe(false);
  });

  it('world.ts 가 인라인한 배율 산술은 정수 피해에 대해 순수 함수와 값이 같다', () => {
    // world.ts 는 `cloakBreakDamage` 를 직접 부르지 않는다 — 그 함수가 입력을 `Math.trunc` 해서
    // weapon.damage(소수 2자리 실수)의 소수부를 지우기 때문이다(아크캐스터가 이미 밟은 함정).
    // 대신 동형 산술(정수 bp · 단일 나눗셈 · 반올림 1회)을 인라인했다. 그 동형성을 여기서 못 박아
    // 두 경로가 갈라지면 즉시 빨개지게 한다.
    for (const d of [0, 1, 2, 3, 7, 13, 25, 99, 100, 12345]) {
      expect(Math.round((d * CLOAK_BREAK_BP) / 10000)).toBe(cloakBreakDamage(d));
    }
    // 2.5배라는 축 자체도 못 박는다(밸런스 패스가 상수를 바꾸면 여기가 먼저 알려 준다).
    expect(CLOAK_BREAK_BP).toBe(25000);
    expect(cloakBreakDamage(100)).toBe(250);
  });
});

// ---------------------------------------------------------------------------
// ② 정규 경로 통합 — 실제로 배선이 살아 있는가
// ---------------------------------------------------------------------------

const NEUTRAL: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };
/** 런이 조기 종료되지 않게 버티는 무대 상수(프로필 파생값이 아니다). */
const DURABLE_HP = 100_000_000;

/** `typeId` 기체 하나를 가진 프로필(무투자). 앱의 기체 교체 결과와 같은 모양. */
function profileWithType(typeId: number): Profile {
  const p = defaultProfile();
  const ship = activeShip(p);
  ship.typeId = typeId;
  ship.skillInvest = zeroSkillInvest(typeId);
  return p;
}

/**
 * 시그니처만 끈 동형 대조군. `signatureOn`(world.ts)은 **마스크 축 OR shipType 축**이므로
 * 둘 다 눌러야 한다. 프로덕션 코드는 한 줄도 건드리지 않는다.
 */
function suppressSignature(cfg: WorldConfig, bit: number): WorldConfig {
  const loadout = cfg.loadout!;
  return {
    ...cfg,
    shipType: 0,
    loadout: { ...loadout, uniqueMask: loadout.uniqueMask & ~(1 << bit) },
  };
}

interface Observed {
  hpLost: number;
  kills: number;
  entityCount: number;
  /** 매 틱 살아 있는 적탄 수의 누적합 — 적 방출 게이트가 실제로 무언가를 막았는지의 척도. */
  enemyBulletTicks: number;
  /** 은신에 진입한 횟수(무피격 카운터가 임계를 새로 넘긴 횟수). */
  cloakEnters: number;
  /** 틱 종료 시점에 은신이 유지되고 있던 틱 수(= 적이 쏘지 못한 틱). */
  cloakedTicks: number;
  firstCloakTick: number;
  /**
   * 해제 첫 타가 **실제로 소진된** 횟수. 판정: 대기 플래그(aux1)가 1 → 0 이 되면서 그 틱에
   * 플레이어 hp 가 줄지 않았다면, 플래그를 지운 주체는 피격 경로가 아니라 autoAttack 의 배율
   * 블록뿐이다(피격 리셋은 hp 차감 분기 안에서만 일어난다).
   */
  breakShots: number;
  maxAux0: number;
  maxAux1: number;
  hashes: number[];
}

function runObserved(seed: number, cfg: WorldConfig, ticks: number): Observed {
  const state = createWorld(seed, { ...cfg, playerHp: DURABLE_HP });
  let maxAux0 = 0;
  let maxAux1 = 0;
  let cloakEnters = 0;
  let cloakedTicks = 0;
  let firstCloakTick = -1;
  let breakShots = 0;
  let enemyBulletTicks = 0;
  let prevAux1 = 0;
  let prevHp = DURABLE_HP;
  const hashes: number[] = [];
  for (let i = 0; i < ticks; i++) {
    stepWorld(state, NEUTRAL);
    const p = state.entities[0]!;
    for (const e of state.entities) if (e.kind === 'enemyBullet' && !e.dead) enemyBulletTicks++;
    if (playerCloaked(state, p)) cloakedTicks++;
    // 진입 판정은 대기 플래그로 한다 — 같은 틱 안에서 진입 후 곧바로 첫 타가 나가면 틱 종료
    // 시점의 aux0 은 이미 0 으로 되돌아 있어 카운터만으로는 놓친다.
    if (prevAux1 === 0 && p.aux1 === 1) {
      cloakEnters++;
      if (firstCloakTick < 0) firstCloakTick = i;
    }
    if (prevAux1 === 1 && p.aux1 === 0 && p.hp === prevHp) breakShots++;
    if (p.aux0 > maxAux0) maxAux0 = p.aux0;
    if (p.aux1 > maxAux1) maxAux1 = p.aux1;
    prevAux1 = p.aux1;
    prevHp = p.hp;
    hashes.push(hashWorld(state));
  }
  return {
    hpLost: DURABLE_HP - state.entities[0]!.hp,
    kills: state.kills,
    entityCount: state.entities.length,
    enemyBulletTicks,
    cloakEnters,
    cloakedTicks,
    firstCloakTick,
    breakShots,
    maxAux0,
    maxAux1,
    hashes,
  };
}

describe('팬텀(typeId 3) 정규 경로 배선 — Profile → buildRunConfig → createWorld → stepWorld', () => {
  it('마스크에 자기 비트만 켜지고 shipType 축도 선다', () => {
    const cfg = buildRunConfig(profileWithType(3), { planet: 0, stage: 1 });
    expect(cfg.shipType).toBe(3);
    const mask = cfg.loadout?.uniqueMask ?? 0;
    expect(hasCapstone(mask, SIG_PHANTOM_CLOAK)).toBe(true);
    for (const bit of SIGNATURE_BITS) {
      if (bit === SIG_PHANTOM_CLOAK) continue;
      expect(hasCapstone(mask, bit), `bit ${bit}`).toBe(false);
    }
  });

  // 무대 선정도 계약의 일부다: 은신은 **연속 무피격 240틱**이 필요하므로 압박이 끊이지 않는
  // 무대(행성2/티어2)에서는 정지 파일럿의 무피격 최대치가 146틱에 그쳐 영영 진입하지 못한다
  // (실측). 행성0/티어0 은 교전 사이에 긴 무피격 구간이 생겨 은신이 반복 발현한다.
  //
  // ⚠️ SEED·TICKS 재측정(2026-07-26, PvE 밀도 상향 + 선분 판정 도입): 이전 증인 seed 555 는
  // 밀도가 오르면서 압박이 거의 끊이지 않게 돼(잡몹이 항상 붙어 있다) 1800틱에 진입 1회뿐이었다
  // (breakShots 도 1회 — 임계 4·3 미달). seed 48 은 3600틱에서 진입 4회·해제 첫 타 4회로
  // 여유 있게 통과한다(PVE_DENSITY_MULT 가 2 → 1.5 로 재조정된 뒤에도 재확인해 동일했다).
  const TRAJ = { planet: 0, stage: 1 } as const;
  const TRAJ_SEED = 48;
  const TRAJ_TICKS = 3600;

  it('은신에 실제로 진입하고 해제 첫 타가 실제로 소진된다 — 억제 대조군은 끝까지 aux 0', () => {
    const cfg = buildRunConfig(profileWithType(3), TRAJ);
    const live = runObserved(TRAJ_SEED, cfg, TRAJ_TICKS);
    const ctrl = runObserved(TRAJ_SEED, suppressSignature(cfg, SIG_PHANTOM_CLOAK), TRAJ_TICKS);

    // 공허 런 가드 — 월드가 멈춰 있으면 이 케이스는 아무것도 증명하지 못한다.
    expect(new Set(live.hashes).size).toBeGreaterThan(900);
    expect(live.kills).toBeGreaterThan(0);

    // 실측 기준선(seed 48 / p0t0 / 3600틱): 진입 4회 · 은신 유지 274틱 · 해제 첫 타 4회 ·
    // 무피격 최대 359틱.
    expect(live.cloakEnters).toBeGreaterThanOrEqual(4);
    expect(live.cloakedTicks).toBeGreaterThan(0);
    expect(live.breakShots).toBeGreaterThanOrEqual(3);
    expect(live.firstCloakTick).toBeGreaterThanOrEqual(CLOAK_UNHIT_TICKS - 1);
    expect(live.maxAux0).toBeGreaterThanOrEqual(CLOAK_UNHIT_TICKS);

    // 억제 대조군은 이 경로를 한 줄도 실행하지 않는다(조건부 폴드 규약).
    expect(ctrl.maxAux0).toBe(0);
    expect(ctrl.maxAux1).toBe(0);
    expect(ctrl.cloakEnters).toBe(0);
    expect(ctrl.cloakedTicks).toBe(0);
    expect(ctrl.breakShots).toBe(0);
  });

  it('aux1 은 0/1 플래그이고 은신 카운터는 상한 안에 머문다 (u32 폴드 규율)', () => {
    const cfg = buildRunConfig(profileWithType(3), TRAJ);
    const live = runObserved(TRAJ_SEED, cfg, TRAJ_TICKS);
    expect(live.maxAux1).toBe(1);
    expect(Number.isInteger(live.maxAux0)).toBe(true);
    // world.ts 의 CLOAK_TICK_CAP(600)과 같은 계약값. 상한이 사라지면 여기가 먼저 빨개진다.
    expect(live.maxAux0).toBeLessThanOrEqual(600);
  });

  // 적 방출 게이트가 실제로 무언가를 막는 무대·시드(실측 탐색으로 고름).
  // ⚠️ 재측정(2026-07-26, PvE 밀도 상향 + 선분 판정 도입): 이전 증인(행성1/seed 9182)은 이제
  // vampire 로 덮어도 live·ctrl 의 적탄 누적·엔티티 수가 완전히 같아졌다(cloakedTicks=0 —
  // 밀도가 오르며 이 무대에서는 무피격 240틱을 영영 못 채운다). 행성0/seed 9182 는 밀도가 낮은
  // 카르곤 로스터라 은신이 반복 서고(누적 49틱), 억제를 껐을 때 초반 방출 하나가 이후 교전
  // 전개를 완전히 바꾼다 — 적탄 누적 157444(live) vs 147704(ctrl), 최종 엔티티 77 vs 73.
  // planet 모드 축은 이 테스트가 재는 팬텀 시그니처 축과 직교하므로 vampire 로 고정한다.
  const GATE = { planet: 0, stage: 1 } as const;
  const GATE_SEED = 9182;
  const GATE_TICKS = 3600;

  it('은신이 적의 방출을 실제로 막는다 — 억제 대조군과 적탄 총량·엔티티가 갈린다', () => {
    const cfg: WorldConfig = {
      ...buildRunConfig(profileWithType(3), GATE),
      planetMode: PLANET_MODE.vampire,
    };
    const live = runObserved(GATE_SEED, cfg, GATE_TICKS);
    const ctrl = runObserved(GATE_SEED, suppressSignature(cfg, SIG_PHANTOM_CLOAK), GATE_TICKS);

    expect(new Set(live.hashes).size).toBeGreaterThan(1800);
    expect(live.cloakedTicks).toBeGreaterThan(0);
    expect(ctrl.enemyBulletTicks).toBeGreaterThan(0);

    // 시그니처 하나만 제거하면 관측이 갈린다 = 배선이 실제로 산 상태다. 두 config 는 이 비트
    // 외에는 완전히 동일하므로(shipType 축은 해시 꼬리에만 접히고 이 관측량은 해시가 아니다)
    // 이 차이의 원인은 시그니처뿐이다.
    expect(live.enemyBulletTicks).not.toBe(ctrl.enemyBulletTicks);
    expect(live.entityCount).not.toBe(ctrl.entityCount);
  });

  it('스트라이커(typeId 0) 런은 은신하지 않고 aux 를 끝까지 0 으로 둔다 (해시 폴드 불변)', () => {
    const striker = buildRunConfig(defaultProfile(), TRAJ);
    const obs = runObserved(TRAJ_SEED, striker, 900);
    expect(obs.maxAux0).toBe(0);
    expect(obs.maxAux1).toBe(0);
    expect(obs.cloakedTicks).toBe(0);
    expect(obs.breakShots).toBe(0);
    expect(new Set(obs.hashes).size).toBeGreaterThan(450);
  });

  it('같은 Profile 은 같은 해시 스트림을 낸다 (결정론 — ADR-0005, 은신은 RNG 미소비)', () => {
    const cfg = (): WorldConfig => buildRunConfig(profileWithType(3), TRAJ);
    expect(runObserved(TRAJ_SEED, cfg(), 700).hashes).toEqual(
      runObserved(TRAJ_SEED, cfg(), 700).hashes,
    );
  });
});
