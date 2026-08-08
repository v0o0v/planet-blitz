/**
 * 카르곤 특산 촉매 배선 — **`id 30 kargon-swarmcall` · `id 31 kargon-magma-vein` ·
 * `id 32 kargon-lava-warden`**(ADR-0052).
 *
 * ## ⚠️ 이 파일의 안전선 넷
 *  1. **음성 대조** — 안 실으면 무촉매와 거동이 같다. 카드마다 하나씩 있다.
 *  2. **이득과 대가가 둘 다 관측된다** — 이득만 재면 "대가를 안 물리는 배선"이 통과한다.
 *     `id 30` 은 2판에서 **대가가 코드상 no-op** 이었으므로 이 축이 특히 중요하다.
 *  3. **"스폰됐다"가 아니라 "실제로 죽인다"** — 단발 촉매 해저드는 `activeTicks = 1` 이거나
 *     `phase !== 1` 이면 **한 번도 안 때린다**(앞 레인 실측). 스폰만 재면 그 결함이 통과한다.
 *  4. **진행 교착 없음** — `id 32` 갑주는 하한이 있어야 원거리 유지형이 보스를 죽일 수 있다
 *     (헌장 §페널티 금지 ④).
 *
 * ## ⚠️ 항진 방지
 * 비교 단언 앞에 **"관측 대상이 실제로 생겼다"** 를 먼저 세운다.
 */

import { describe, it, expect } from 'vitest';

import { createWorld, stepWorld, emptyInput, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldState, InputFrame } from '../src/sim/world.js';
import { blankEntity, addEntity, spawnBullet } from '../src/sim/entities.js';
import type { Entity } from '../src/sim/entities.js';
import { SEGMENTS } from '../data/waves.js';
import { DamageSource } from '../src/sim/skillSlots.js';
import { isCatalystHazard, CATALYST_HAZARD_LIVE_CAP } from '../src/sim/catalyst/shared.js';
import { CATALYST_FX } from '../src/sim/catalyst/fx.js';
import {
  kargonOnTick,
  kargonOnLootRoll,
  kargonOnWaveAdvanced,
  kargonOnPlayerDamaged,
  kargonLavaArmorMult,
  swarmcallStage,
  onMagmaLava,
  MAGMA_LAVA_MARK,
  WARDEN_AURA_MARK,
  WARDEN_ARMOR_RADIUS,
  WARDEN_ARMOR_MIN_MULT,
} from '../src/sim/catalyst/kargon.js';

const idle: InputFrame = emptyInput();

const SWARMCALL = 30;
const MAGMA_VEIN = 31;
const LAVA_WARDEN = 32;
/** 이 레인이 배선하지 않은 카드 — 음성 대조의 "다른 촉매" 축. */
const UNRELATED = 1;

function world(catalysts?: number[]): WorldState {
  const cfg = catalysts === undefined ? { ...DEFAULT_CONFIG } : { ...DEFAULT_CONFIG, catalysts };
  return createWorld(0x4b21, cfg);
}

function player(s: WorldState): Entity {
  const p = s.entities[0];
  if (p === undefined || p.kind !== 'player') throw new Error('player missing');
  return p;
}

/**
 * 적 하나를 심는다. ⚠️ `enemyType` 을 반드시 세운다 — `blankEntity` 기본값 `-1` 이면
 * `enemyDefFor` 가 `undefined` 라 이동 단계도 앵커도 조용히 건너뛴다(앞 레인 실측).
 */
function seedEnemy(s: WorldState, x: number, y: number, hp = 100): Entity {
  const e = blankEntity('enemy');
  e.x = x;
  e.y = y;
  e.enemyType = 0;
  e.hp = hp;
  e.maxHp = hp;
  e.radius = 32;
  return addEntity(s, e);
}

function seedBoss(s: WorldState, x: number, y: number, hp = 5000): Entity {
  const b = blankEntity('boss');
  b.x = x;
  b.y = y;
  b.enemyType = 0;
  b.hp = hp;
  b.maxHp = hp;
  b.radius = 120;
  b.damage = 30;
  return addEntity(s, b);
}

/** 이 카드가 세운 용암만 센다(마커로 가른다 — 피해 > 0 은 공용 장판도 같다). */
function lavas(s: WorldState): Entity[] {
  return s.entities.filter((e) => !e.dead && isCatalystHazard(e) && e.ownerId === MAGMA_LAVA_MARK);
}

function auras(s: WorldState): Entity[] {
  return s.entities.filter((e) => !e.dead && isCatalystHazard(e) && e.ownerId === WARDEN_AURA_MARK);
}

/** RNG 세 스트림의 소비 상태 스냅샷. 촉매 코드는 여기를 **한 칸도** 밀면 안 된다. */
function rngState(s: WorldState): [number, number, number] {
  return [s.dropRng.getState(), s.waveRng.getState(), s.powerupRng.getState()];
}

// ---------------------------------------------------------------------------
// §0 — 계측기 건전성
// ---------------------------------------------------------------------------

describe('카르곤 — 계측기 건전성', () => {
  it('세그먼트 표가 이 테스트가 전제하는 값을 실제로 갖는다', () => {
    // 아래 §1 이 "10 → 5", "46 → 23" 을 단언하므로 원본이 바뀌면 여기서 먼저 터진다.
    expect(SEGMENTS[0]?.killGoal).toBe(10);
    expect(SEGMENTS[2]?.killGoal).toBe(46);
    expect(SEGMENTS[3]?.killGoal).toBe(0); // 중반 격전 — 처치 할당 게이트 미사용
  });
});

// ---------------------------------------------------------------------------
// §1 — id 30 kargon-swarmcall (이득: 처치 할당 절반 / 대가: 누진한 적 상한)
// ---------------------------------------------------------------------------

describe('id 30 kargon-swarmcall', () => {
  it('음성 대조 — 안 실으면 처치 할당도 적 상한도 종전 그대로다', () => {
    const s = world([UNRELATED]);
    kargonOnTick(s, player(s));
    expect(s.wave.segmentKillGoal).toBe(SEGMENTS[0]?.killGoal);
    expect(s.catalystMods.enemyCount).toBe(1);
    expect(swarmcallStage(s)).toBe(0);
  });

  it('⭐ 이득과 대가가 **동시에** 관측된다 — 할당 절반 + 적 상한 누진', () => {
    const s = world([SWARMCALL]);
    // 세그먼트 0: 할당은 절반, 누진 단계는 아직 0 이라 상한 배율이 중립이다.
    kargonOnTick(s, player(s));
    expect(s.wave.segmentKillGoal).toBe(5); // 10 → ceil(10 × 0.5)
    expect(s.catalystMods.enemyCount).toBe(1);

    // 두 세그먼트를 넘긴 상태 — **여기서 대가가 실제로 선다**(2판은 이 자리가 no-op 이었다).
    s.wave.segmentIndex = 2;
    kargonOnTick(s, player(s));
    expect(s.wave.segmentKillGoal).toBe(23); // 46 → ceil(46 × 0.5)
    expect(s.catalystMods.enemyCount).toBeGreaterThan(1);
    expect(swarmcallStage(s)).toBe(2);

    // 대가는 **누진**이다 — 더 넘길수록 더 두꺼워진다.
    const at2 = s.catalystMods.enemyCount;
    s.wave.segmentIndex = 5;
    kargonOnTick(s, player(s));
    expect(s.catalystMods.enemyCount).toBeGreaterThan(at2);
  });

  it('`killGoal 0` 인 세그먼트(중반 격전·보스)는 건드리지 않는다', () => {
    const s = world([SWARMCALL]);
    s.wave.segmentIndex = 3;
    s.wave.segmentKillGoal = 0;
    kargonOnTick(s, player(s));
    expect(s.wave.segmentKillGoal).toBe(0);
  });

  it('멱등이다 — 여러 번 불러도 단조 누적되지 않는다(헌장 §틱 규율)', () => {
    const s = world([SWARMCALL]);
    s.wave.segmentIndex = 2;
    kargonOnTick(s, player(s));
    const goal = s.wave.segmentKillGoal;
    const density = s.catalystMods.enemyCount;
    for (let i = 0; i < 20; i++) kargonOnTick(s, player(s));
    expect(s.wave.segmentKillGoal).toBe(goal);
    expect(s.catalystMods.enemyCount).toBe(density);
  });

  it('경제 — 누진 단계가 오른 세그먼트에서 전리품 개수가 오르고 상한을 안 넘는다', () => {
    const s = world([SWARMCALL]);
    expect(kargonOnLootRoll(s, 0, 0, true).count).toBe(1); // 단계 0 = 중립
    s.wave.segmentIndex = 3;
    expect(kargonOnLootRoll(s, 0, 0, true).count).toBeGreaterThan(1);
    s.wave.segmentIndex = 60; // 상한 검사(비현실적으로 큰 단계)
    expect(kargonOnLootRoll(s, 0, 0, true).count).toBeLessThanOrEqual(2.0);
    // 등급은 이 그룹의 축이 아니다(명세의 상한 축이 둘 다 드랍이다).
    expect(kargonOnLootRoll(s, 0, 0, true).rarity).toBe(1);
  });

  it('신호 — 웨이브 전환마다 정확히 한 번 통지한다(매 틱 아님)', () => {
    const s = world([SWARMCALL]);
    kargonOnWaveAdvanced(s, 0, 1);
    const fired = (s.catalystFx ?? []).filter(
      (f) => f.id === SWARMCALL && f.kind === CATALYST_FX.trigger,
    );
    expect(fired.length).toBe(1);
    // 매 틱 자리에서는 통지가 안 나간다.
    const before = (s.catalystFx ?? []).length;
    for (let i = 0; i < 30; i++) kargonOnTick(s, player(s));
    expect((s.catalystFx ?? []).length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// §2 — id 31 kargon-magma-vein (탄 궤적에 용암 · 적도 나도 태운다)
// ---------------------------------------------------------------------------

describe('id 31 kargon-magma-vein', () => {
  it('음성 대조 — 안 실으면 탄이 지나가도 용암이 안 생긴다', () => {
    const s = world([UNRELATED]);
    spawnBullet(s, 300, 0, 0, 0, 10, 0, 8, 120, 1, 0);
    kargonOnTick(s, player(s));
    expect(lavas(s).length).toBe(0);
  });

  it('탄 궤적 위에 용암이 솟는다 — 같은 셀에는 연속으로 안 올린다(격자 쿨다운)', () => {
    const s = world([MAGMA_VEIN]);
    const b = spawnBullet(s, 300, 0, 0, 0, 10, 0, 8, 600, 1, 0);
    kargonOnTick(s, player(s));
    expect(lavas(s).length).toBe(1);
    // 같은 셀 — 쿨다운이라 안 늘어난다.
    kargonOnTick(s, player(s));
    expect(lavas(s).length).toBe(1);
    // 다른 셀로 옮기면 다시 선다.
    b.x = 3000;
    kargonOnTick(s, player(s));
    expect(lavas(s).length).toBe(2);
  });

  it('⭐ 용암은 **실제로 적을 죽인다**(스폰만 재지 않는다)', () => {
    const s = world([MAGMA_VEIN]);
    spawnBullet(s, 300, 0, 0, 0, 10, 0, 8, 6000, 1, 0);
    kargonOnTick(s, player(s));
    const lava = lavas(s)[0];
    expect(lava).toBeDefined();
    if (lava === undefined) return;
    // 지속형(`phase === 1`)이고 활성 창이 2 틱 이상이어야 공용 피해 루프가 본다.
    expect(lava.phase).toBe(1);
    expect(lava.life).toBeGreaterThanOrEqual(2);

    const victim = seedEnemy(s, lava.x, lava.y, 40);
    const hp0 = victim.hp;
    let ticks = 0;
    while (!victim.dead && ticks < 200) {
      stepWorld(s, idle);
      ticks++;
    }
    expect(victim.hp).toBeLessThan(hp0);
    expect(victim.dead).toBe(true);
  });

  it('자기 피해가 `selfHarm` 으로 갈린다(헌장 §귀속 3)', () => {
    const s = world([MAGMA_VEIN]);
    spawnBullet(s, 300, 0, 0, 0, 10, 0, 8, 600, 1, 0);
    kargonOnTick(s, player(s));
    const lava = lavas(s)[0];
    expect(lava).toBeDefined();
    if (lava === undefined) return;
    const p = player(s);
    p.x = lava.x;
    p.y = lava.y;
    expect(onMagmaLava(s, p.x, p.y)).toBe(true);

    s.catalystFx = [];
    kargonOnPlayerDamaged(s, p, 5, false, DamageSource.hazard);
    const self = (s.catalystFx ?? []).filter((f) => f.kind === CATALYST_FX.selfHarm);
    expect(self.length).toBe(1);
    expect(self[0]?.id).toBe(MAGMA_VEIN);

    // 접촉 피해(해저드 비트 없음)는 자해로 안 센다 — 원인 불명 피해를 만들지 않는다.
    s.catalystFx = [];
    kargonOnPlayerDamaged(s, p, 5, false, DamageSource.contact);
    expect((s.catalystFx ?? []).length).toBe(0);
  });

  it('해저드 동시 상한 12 를 안 넘는다', () => {
    const s = world([MAGMA_VEIN]);
    const b = spawnBullet(s, 0, 0, 0, 0, 10, 0, 8, 100000, 1, 0);
    for (let i = 0; i < 60; i++) {
      b.x = i * 4000; // 매번 다른 셀
      kargonOnTick(s, player(s));
    }
    expect(lavas(s).length).toBeLessThanOrEqual(CATALYST_HAZARD_LIVE_CAP);
  });

  it('경제 — 용암 위에서 죽은 적만 전리품이 두 배다', () => {
    const s = world([MAGMA_VEIN]);
    spawnBullet(s, 300, 0, 0, 0, 10, 0, 8, 600, 1, 0);
    kargonOnTick(s, player(s));
    const lava = lavas(s)[0];
    expect(lava).toBeDefined();
    if (lava === undefined) return;
    expect(kargonOnLootRoll(s, lava.x, lava.y, true).count).toBe(2.0);
    expect(kargonOnLootRoll(s, lava.x + 99999, lava.y, true).count).toBe(1);
  });

  it('RNG 를 한 칸도 소비하지 않는다', () => {
    const s = world([MAGMA_VEIN]);
    spawnBullet(s, 300, 0, 0, 0, 10, 0, 8, 600, 1, 0);
    const before = rngState(s);
    for (let i = 0; i < 30; i++) kargonOnTick(s, player(s));
    expect(rngState(s)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// §3 — id 32 kargon-lava-warden (거리로 녹는 갑주 · 그 반경은 접촉 피해권)
// ---------------------------------------------------------------------------

describe('id 32 kargon-lava-warden', () => {
  it('음성 대조 — 안 실으면 배율이 정확히 1 이고 장판도 안 선다', () => {
    const s = world([UNRELATED]);
    const boss = seedBoss(s, 0, 0);
    expect(kargonLavaArmorMult(s, boss, 5000, 0)).toBe(1);
    kargonOnTick(s, player(s));
    expect(auras(s).length).toBe(0);
  });

  it('붙으면 물러지고 멀어지면 굳는다 — 거리에 **단조**다', () => {
    const s = world([LAVA_WARDEN]);
    const boss = seedBoss(s, 0, 0);
    const near = kargonLavaArmorMult(s, boss, 0, 0);
    const mid = kargonLavaArmorMult(s, boss, WARDEN_ARMOR_RADIUS / 2, 0);
    const far = kargonLavaArmorMult(s, boss, WARDEN_ARMOR_RADIUS * 3, 0);
    expect(near).toBeCloseTo(1, 10);
    expect(mid).toBeGreaterThan(far);
    expect(mid).toBeLessThan(near);
    expect(far).toBe(WARDEN_ARMOR_MIN_MULT);
  });

  it('⭐ 진행 교착이 없다 — 원거리 유지형도 보스를 **결국 죽인다**', () => {
    const s = world([LAVA_WARDEN]);
    const boss = seedBoss(s, 0, 0, 4000);
    // 최악의 자리(반경 밖)에 계속 서 있는 원거리 유지형.
    const mult = kargonLavaArmorMult(s, boss, WARDEN_ARMOR_RADIUS * 5, 0);
    expect(mult).toBeGreaterThan(0);
    let hits = 0;
    while (boss.hp > 0 && hits < 100000) {
      boss.hp -= 10 * mult;
      hits++;
    }
    expect(boss.hp).toBeLessThanOrEqual(0); // 유한 회에 반드시 끝난다
  });

  it('잡몹에는 안 걸린다(보스 전용이다)', () => {
    const s = world([LAVA_WARDEN]);
    const e = seedEnemy(s, 0, 0);
    expect(kargonLavaArmorMult(s, e, 99999, 0)).toBe(1);
  });

  it('⚠️ 접촉 피해권 장판은 `phase 0` 이라 **적도 보스도 안 태운다**', () => {
    const s = world([LAVA_WARDEN]);
    const boss = seedBoss(s, 0, 0, 5000);
    kargonOnTick(s, player(s));
    const aura = auras(s)[0];
    expect(aura).toBeDefined();
    if (aura === undefined) return;
    // `stepCatalystHazards` 의 공용 피해 루프는 `phase === 1` 만 때린다 — 0 이면 안 탄다.
    expect(aura.phase).toBe(0);
    expect(aura.damage).toBe(boss.damage);
    expect(aura.radius).toBe(WARDEN_ARMOR_RADIUS);

    // 장판 한가운데 적을 두고 여러 틱 굴려도 그 장판이 적을 깎지 않는다.
    const inside = seedEnemy(s, 0, 0, 500);
    const bossHp0 = boss.hp;
    const insideHp0 = inside.hp;
    for (let i = 0; i < 20; i++) kargonOnTick(s, player(s));
    expect(inside.hp).toBe(insideHp0);
    expect(boss.hp).toBe(bossHp0);
  });

  it('장판은 보스를 따라다니고 상한을 잠식하지 않는다(매 틱 갱신, 재스폰 아님)', () => {
    const s = world([LAVA_WARDEN]);
    const boss = seedBoss(s, 0, 0);
    kargonOnTick(s, player(s));
    boss.x = 1234;
    boss.y = -777;
    for (let i = 0; i < 30; i++) kargonOnTick(s, player(s));
    const live = auras(s);
    expect(live.length).toBe(1);
    expect(live[0]?.x).toBe(1234);
    expect(live[0]?.y).toBe(-777);
  });

  it('RNG 를 한 칸도 소비하지 않는다', () => {
    const s = world([LAVA_WARDEN]);
    seedBoss(s, 0, 0);
    const before = rngState(s);
    for (let i = 0; i < 30; i++) kargonOnTick(s, player(s));
    expect(rngState(s)).toEqual(before);
  });
});
