/**
 * 말로우 30스킬 배선(ADR-0049 배치 4) — **앵커를 통과하는 관측 테스트**.
 *
 * ## 왜 효과 함수를 직접 부르지 않는가
 * `src/sim/skills/mallow.ts` 의 함수를 직접 부르면 "효과 산술이 맞다"만 잰다. 이 저장소가
 * 반복해서 밟은 실패는 그쪽이 아니라 **"고쳐 놨는데 아무도 안 부른다"** 였다. 그래서 전부
 * `skillHooks.ts` 의 **공개 앵커**를 통해 자극한다 — `case SIG_MALLOW_CUSHION:` 를 지우면
 * 즉시 빨개진다(뮤테이션으로 확인했다, 아래).
 *
 * ## 뮤테이션으로 계측기를 검사했다 (2026-08-07)
 *  ① **효과 본체 삭제** — `mallowDamageChain` 의 CU7 감액(`return dmg - Math.round(...)`)을
 *     `return dmg` 로 바꾸면 §④ 가 실패한다(2건).
 *  ② **배선 이음매 치환** — 앵커 ⑩(`dispatchEnemyDamagedSkill`)의 `case SIG_MALLOW_CUSHION:`
 *     를 지우면 §⑤ SQ4 가 실패한다(2건).
 * 초록인데 아무것도 안 재는 테스트가 아니다.
 *
 * ## S2 앵커 확장분(§⑦~⑩)도 같은 방식으로 검사했다 (2026-08-07)
 *  ③ 앵커 ⑳ 의 `mallowCushionSettled(…)` 호출 제거 → **13건 실패**.
 *  ④ 앵커 ⑯ 의 `mallowVolleyParams(…)` 호출 제거 → **5건 실패**.
 *  ⑤ ME4 의 `if (heal > hit) heal = hit;`(수지 불변식 1) 무력화 → **1건 실패**.
 *  ⑥ SQ2 가 CU3 이 깎기 **전**의 `applied` 를 보게 바꿈(적용 순서 위반) → **1건 실패**.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld,
  stepWorld,
  emptyInput,
  DEFAULT_CONFIG,
  type WorldConfig,
  type WorldState,
} from '../src/sim/world.js';
import type { Entity } from '../src/sim/entities.js';
import { blankEntity, spawnWall } from '../src/sim/entities.js';
import { hashWorld } from '../src/sim/replay.js';
import { neutralLoadout } from '../src/items/loadout.js';
import {
  onGemCollected,
  onPlayerDamaged,
  onDamageChain,
  onEnemyDamaged,
  onPowerupPicked,
  onCushionSettled,
  onCushionSettleDue,
  onCushionThreshold,
  onVolleyParams,
  type VolleyParams,
} from '../src/sim/skillHooks.js';
import {
  SIG_MALLOW_CUSHION,
  CUSHION_RECOVER_TICKS,
  CUSHION_TICK_CAP,
  cushionSettled,
  cushionRecovered,
} from '../src/sim/shipSignature.js';
import { readSlot, SKILL_SLOT_COUNT } from '../src/sim/skillSlots.js';

/** `data/ships/index.ts` 의 타입 id — `data/ships/mallow.ts` 의 `id: 5` 가 정본이다. */
const SHIP_MALLOW = 5;

/**
 * flat 인덱스 — **정본은 `data/ships/mallow.ts` 의 `trees` 배열**이다:
 * `[squish(offense), mend(utility), cushion(defense)]` → SQ 0..9 · ME 10..19 · CU 20..29.
 * ⚠️ 스트라이커(축1=defense)와 순서가 다르다.
 */
const SQ1 = 0;
const SQ2 = 1;
const SQ3 = 2;
const SQ4 = 3;
const SQ5 = 4;
const SQ8 = 7;
const ME1 = 10;
const ME4 = 13;
const ME5 = 14;
const ME9 = 18;
const ME10 = 19;
const CU3 = 22;
const CU4 = 23;
const CU7 = 26;
const CU9 = 28;
const CU10 = 29;

/** 슬롯 번호 — 정본은 `src/sim/skillSlots.ts` 의 `MallowCarry`/`MallowStage` 다. */
const SLOT_SCAR = 0; // MallowCarry.scarApplied — SQ8 누적 선체행
const SLOT_LOAD = 0; // MallowStage.forgivenessLoad — SQ5 장전 잔량

function invest(points: ReadonlyArray<readonly [number, number]>): number[] {
  const v = new Array<number>(30).fill(0);
  for (const [i, n] of points) v[i] = n;
  return v;
}

/** 말로우 런. 피격이 잦되 죽지 않는 레시피(브루저 레인과 동형). */
function mallowConfig(): WorldConfig {
  return {
    ...DEFAULT_CONFIG,
    planet: 0,
    stage: 1,
    shipType: SHIP_MALLOW,
    playerHp: 100_000_000,
    loadout: { ...neutralLoadout(), weaponType: 0 },
  };
}

function mk(points: ReadonlyArray<readonly [number, number]> = []): WorldState {
  return createWorld(1234, { ...mallowConfig(), skillInvest: invest(points) });
}

function player(state: WorldState): Entity {
  const p = state.entities[0];
  if (p === undefined) throw new Error('player missing');
  return p;
}

function addEnemy(state: WorldState, x: number, y: number, hp: number, pierce = 0): Entity {
  const e: Entity = { ...blankEntity('enemy'), x, y, hp, maxHp: hp, radius: 20, pierce };
  state.entities.push(e);
  return e;
}

function addEnemyBullet(state: WorldState, x: number, y: number): Entity {
  const e: Entity = { ...blankEntity('enemyBullet'), x, y, radius: 6 };
  state.entities.push(e);
  return e;
}

/** 앵커 ⑯ 이 넘기는 레코드 한 벌. 말로우 세 스킬은 `damage` 만 만진다. */
function volley(damage = 100): VolleyParams {
  return {
    damage,
    pierce: 1,
    count: 3,
    speed: 500,
    radius: 6,
    life: 60,
    spread: 0.4,
    cooldownQ: 100,
    countUsed: true,
    ballisticsUsed: true,
    targetDist: 200,
    // 발사 방위(rad). SQ7(관성 사출)이 언젠가 읽을 항이지만 아직 미배선 — 기본 0(순수 +x).
    aimAngle: 0,
    cloakBreak: false,
    mark: 0,
    recordSpawnDamage: false,
  };
}

// ---------------------------------------------------------------------------
// ⓪ 전제 — 이 테스트가 말로우를 자극하고 있는가
// ---------------------------------------------------------------------------

describe('⓪ 전제', () => {
  it('shipType 5 런은 말로우 시그니처이고 투자 벡터는 30칸이다', () => {
    const w = mk([[ME1, 1]]);
    expect(w.sigBit).toBe(SIG_MALLOW_CUSHION);
    expect(w.skillsOn).toBe(true);
    expect(w.config.skillInvest).toHaveLength(30);
    expect(w.skillDerived.shipType).toBe(SHIP_MALLOW);
  });

  it('투자 0 런은 `skillsOn` 이 거짓이라 앵커가 첫 줄에서 반환한다', () => {
    expect(mk().skillsOn).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ① 불변 계약 — 투자 0 런은 바이트 불변이어야 한다
// ---------------------------------------------------------------------------

describe('① 투자 0 런 불변', () => {
  it('투자 0 말로우 런 두 개가 240틱 뒤 같은 해시다 (슬롯도 전부 0)', () => {
    const a = mk();
    const b = mk();
    for (let i = 0; i < 240; i++) {
      stepWorld(a, emptyInput());
      stepWorld(b, emptyInput());
    }
    expect(hashWorld(a)).toBe(hashWorld(b));
    for (let s = 0; s < SKILL_SLOT_COUNT; s++) {
      expect(readSlot(a.skillCarry, s)).toBe(0);
      expect(readSlot(a.skillStage, s)).toBe(0);
    }
  });

  it('`skillInvest` 미지정 런과 전 칸 0 런의 **시뮬 상태**가 같다', () => {
    // ⚠️ 여기서 `hashWorld` 를 마주 세우면 안 된다 — `hashWorld` 가 `config.skillInvest` 배열
    // 자체를 접어서 **배선과 무관하게** 갈린다(스트라이커 레인이 밟았다). 배선이 재야 하는
    // 것은 "스킬 경로가 한 줄도 안 돌았다" 이고, 그 관측면은 **엔티티·슬롯·런 풀 상태**다.
    const none = createWorld(77, { ...mallowConfig() });
    const zero = createWorld(77, { ...mallowConfig(), skillInvest: invest([]) });
    for (let i = 0; i < 180; i++) {
      stepWorld(none, emptyInput());
      stepWorld(zero, emptyInput());
    }
    expect(zero.entities.length).toBe(none.entities.length);
    expect(player(zero).aux0).toBe(player(none).aux0);
    expect(player(zero).aux1).toBe(player(none).aux1);
    expect(player(zero).hp).toBe(player(none).hp);
    expect(player(zero).maxHp).toBe(player(none).maxHp);
    expect(zero.xp).toBe(none.xp);
  });

  it('배치 4 의 6종은 슬롯을 한 칸도 쓰지 않는다 (슬롯을 잡는 것은 SQ5·SQ8 둘뿐이다)', () => {
    // 슬롯을 쓰는 것은 S2 확장분 둘(SQ5 장전 잔량 · SQ8 누적 선체행)뿐이고, 그 둘을 안 찍은
    // 런에서는 전 슬롯이 0 이라 `hashWorld` 의 스킬 슬롯 폴드가 한 번도 실행되지 않는다.
    const w = mk([
      [SQ3, 20],
      [SQ4, 20],
      [ME1, 20],
      [ME10, 20],
      [CU4, 20],
      [CU7, 20],
    ]);
    const p = player(w);
    p.aux0 = 40;
    p.aux1 = 90;
    onGemCollected(w, { ...blankEntity('gem'), x: p.x, y: p.y });
    onDamageChain(w, p, 100);
    onPlayerDamaged(w, p, 10, false);
    onPowerupPicked(w, 0, 0);
    for (let s = 0; s < SKILL_SLOT_COUNT; s++) {
      expect(readSlot(w.skillCarry, s)).toBe(0);
      expect(readSlot(w.skillStage, s)).toBe(0);
    }
  });

  it('**다른 스킬만 찍은 런**에서도 미투자 스킬은 작동하지 않는다 (`skillsOn` 만으로는 부족)', () => {
    // ME1 만 찍었는데 CU7·SQ3·CU4·ME10 이 돌면 게이트가 `skillsOn` 에 기대고 있다는 뜻이다.
    const w = mk([[ME1, 20]]);
    const p = player(w);
    p.aux0 = 30;
    p.aux1 = CUSHION_RECOVER_TICKS;
    const foe = addEnemy(w, p.x + 40, p.y, 100);
    const shot = addEnemyBullet(w, p.x + 20, p.y);
    const xpBefore = w.xp;
    expect(onDamageChain(w, p, 100)).toBe(100); // CU7 미투자 → 감액 0
    onPlayerDamaged(w, p, 10, false);
    expect(foe.hp).toBe(100); // SQ3 미투자 → 반격 없음
    expect(shot.dead).toBe(false); // CU4 미투자 → 소거 없음
    onPowerupPicked(w, 0, 0);
    expect(p.aux0).toBe(30); // ME10 미투자 → 부채 불변
    expect(w.xp).toBe(xpBefore);
  });
});

// ---------------------------------------------------------------------------
// ② 앵커 ③ — ME1 조기 상환
// ---------------------------------------------------------------------------

describe('② ME1 조기 상환 (앵커 ③ 젬 수거)', () => {
  it('젬 1개당 무피격 카운터가 `2 + floor(Lv/2)` 만큼 흐른다', () => {
    const w = mk([[ME1, 20]]);
    const p = player(w);
    p.aux1 = 0;
    onGemCollected(w, { ...blankEntity('gem'), x: p.x, y: p.y });
    expect(p.aux1).toBe(12); // 2 + floor(20/2)
  });

  it('투자 전/후 대조 — 미투자 런은 카운터가 움직이지 않는다', () => {
    const off = mk();
    const on = mk([[ME1, 1]]);
    for (const w of [off, on]) player(w).aux1 = 0;
    onGemCollected(off, { ...blankEntity('gem') });
    onGemCollected(on, { ...blankEntity('gem') });
    expect(player(off).aux1).toBe(0);
    expect(player(on).aux1).toBe(2); // 2 + floor(1/2)
  });

  it('⚠️ `CUSHION_TICK_CAP` 클램프 — 상한을 넘지 않는다 (u32 폴드 규율)', () => {
    const w = mk([[ME1, 20]]);
    const p = player(w);
    p.aux1 = CUSHION_TICK_CAP - 3;
    onGemCollected(w, { ...blankEntity('gem') });
    expect(p.aux1).toBe(CUSHION_TICK_CAP);
  });
});

// ---------------------------------------------------------------------------
// ③ 앵커 ④ — SQ3 몸통 반발 · CU4 반발 세척
// ---------------------------------------------------------------------------

describe('③ 앵커 ④ 피격 후속', () => {
  it('SQ3 — 최근접 적 1기에게만 즉시분 비례 반격이 들어간다', () => {
    const w = mk([[SQ3, 20]]);
    const p = player(w);
    const near = addEnemy(w, p.x + 60, p.y, 100);
    const far = addEnemy(w, p.x + 200, p.y, 100);
    onPlayerDamaged(w, p, 10, false);
    // 반환 배율 = 60 + 8×20 = 220% → round(10 × 220/100) = 22.
    expect(near.hp).toBe(78);
    expect(far.hp).toBe(100); // "최근접 1기" — 반경 안이어도 두 번째는 안 맞는다
    expect(near.dead).toBe(false); // 격추 판정은 `compact()` 단일 수렴점이다
  });

  it('SQ3 — 탐색 반경 260 밖의 적은 반격받지 않는다', () => {
    const w = mk([[SQ3, 20]]);
    const p = player(w);
    const away = addEnemy(w, p.x + 400, p.y, 100);
    onPlayerDamaged(w, p, 10, false);
    expect(away.hp).toBe(100);
  });

  it('SQ3 — 대상은 `kind === "enemy"` 한정 (보스는 안 맞는다)', () => {
    const w = mk([[SQ3, 20]]);
    const p = player(w);
    const boss: Entity = { ...blankEntity('boss'), x: p.x + 50, y: p.y, hp: 500, maxHp: 500 };
    w.entities.push(boss);
    onPlayerDamaged(w, p, 10, false);
    expect(boss.hp).toBe(500);
  });

  it('CU4 — 부채가 없으면 발동조차 하지 않는다 (발동 술어 자체가 부채 게이트다)', () => {
    const w = mk([[CU4, 20]]);
    const p = player(w);
    p.aux0 = 0;
    const shot = addEnemyBullet(w, p.x + 10, p.y);
    onPlayerDamaged(w, p, 10, false);
    expect(shot.dead).toBe(false);
  });

  it('CU4 — 부채 보유 중이면 소거되고, 반경이 부채에 비례해 커진다', () => {
    // Lv1: 기본 반경 76. 부채 5 → 확장 10 → 반경 86.
    const small = mk([[CU4, 1]]);
    const ps = player(small);
    ps.aux0 = 5;
    const inside = addEnemyBullet(small, ps.x + 80, ps.y);
    const outside = addEnemyBullet(small, ps.x + 120, ps.y);
    onPlayerDamaged(small, ps, 10, false);
    expect(inside.dead).toBe(true);
    expect(outside.dead).toBe(false);

    // 같은 레벨·같은 좌표인데 부채만 크면(30 → 확장 60, 상한 152 미만) 반경 136 이라 닿는다.
    const big = mk([[CU4, 1]]);
    const pb = player(big);
    pb.aux0 = 30;
    const reached = addEnemyBullet(big, pb.x + 120, pb.y);
    onPlayerDamaged(big, pb, 10, false);
    expect(reached.dead).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ④ 앵커 ⑧ — CU7 아문 살갗
// ---------------------------------------------------------------------------

describe('④ CU7 아문 살갗 (앵커 ⑧ 감쇠 사슬)', () => {
  it('무피격 스트릭 만충이면 감소 bp = K, 그 값이 사슬 반환값에 실제로 반영된다', () => {
    const w = mk([[CU7, 20]]);
    const p = player(w);
    p.aux1 = CUSHION_RECOVER_TICKS;
    // K = 1500 + 3500×20/32 = 3687.5 → bp = round(3687.5) = 3688 → 100 − round(36.88) = 63.
    expect(onDamageChain(w, p, 100)).toBe(63);
  });

  it('정산 직후(`aux1 = 0`)는 무방비다 — 설계가 못 박은 긴장', () => {
    const w = mk([[CU7, 20]]);
    const p = player(w);
    p.aux1 = 0;
    expect(onDamageChain(w, p, 100)).toBe(100);
  });

  it('감소는 스트릭에 **단조 증가**하고, 임계 이상에서는 더 늘지 않는다', () => {
    const w = mk([[CU7, 20]]);
    const p = player(w);
    p.aux1 = 60;
    const third = onDamageChain(w, p, 1000);
    p.aux1 = CUSHION_RECOVER_TICKS;
    const full = onDamageChain(w, p, 1000);
    p.aux1 = CUSHION_TICK_CAP; // 임계를 훌쩍 넘겨도 min(aux1, T) 로 잘린다
    const over = onDamageChain(w, p, 1000);
    expect(third).toBeGreaterThan(full);
    expect(over).toBe(full);
  });

  it('레벨이 오를수록 더 깎는다 (투자 전/후 대조)', () => {
    const lo = mk([[CU7, 1]]);
    const hi = mk([[CU7, 20]]);
    for (const w of [lo, hi]) player(w).aux1 = CUSHION_RECOVER_TICKS;
    const a = onDamageChain(lo, player(lo), 1000);
    const b = onDamageChain(hi, player(hi), 1000);
    expect(b).toBeLessThan(a);
    expect(a).toBeLessThan(1000);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 앵커 ⑩ — SQ4 압인 탄두
// ---------------------------------------------------------------------------

describe('⑤ SQ4 압인 탄두 (앵커 ⑩ 적 피격)', () => {
  /** +X 로 나아가는 아군탄. 방향 정본은 `angle` 이 아니라 `vx/vy` 다(파생탄 대비). */
  function shot(): Entity {
    return { ...blankEntity('bullet'), vx: 10, vy: 0, damage: 5 };
  }

  it('부채 보유 중이면 탄 진행 방향으로 좌표가 직접 변위된다', () => {
    const w = mk([[SQ4, 1]]);
    const p = player(w);
    p.aux0 = 7;
    const foe = addEnemy(w, 300, 400, 100);
    onEnemyDamaged(w, foe, 5, shot());
    expect(foe.x).toBe(315); // 12 + 3×1 = 15, 방향 (+1, 0)
    expect(foe.y).toBe(400);
    expect(foe.vx).toBe(0); // 속도 대입 금지(넉백 규율) — 좌표만 움직인다
  });

  it('부채가 0 이면 밀지 않는다 (술어가 부채 게이트다)', () => {
    const w = mk([[SQ4, 20]]);
    const p = player(w);
    p.aux0 = 0;
    const foe = addEnemy(w, 300, 400, 100);
    onEnemyDamaged(w, foe, 5, shot());
    expect(foe.x).toBe(300);
  });

  it('엘리트(`pierce > 0`)는 변위가 반감된다', () => {
    const w = mk([[SQ4, 1]]);
    player(w).aux0 = 7;
    const elite = addEnemy(w, 300, 400, 100, 2);
    onEnemyDamaged(w, elite, 5, shot());
    expect(elite.x).toBe(308); // round(15/2) = 8
  });

  it('구조물·보스는 부동이다 (`kind === "enemy"` 한정)', () => {
    const w = mk([[SQ4, 20]]);
    player(w).aux0 = 7;
    const wall: Entity = { ...blankEntity('destructible'), x: 300, y: 400, hp: 50, maxHp: 50 };
    w.entities.push(wall);
    onEnemyDamaged(w, wall, 5, shot());
    expect(wall.x).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// ⑥ 앵커 ⑭ — ME10 성장 환전
// ---------------------------------------------------------------------------

describe('⑥ ME10 성장 환전 (앵커 ⑭ 파워업 적용)', () => {
  it('픽 적용 틱에 부채의 절반이 소각되고 **런 풀 XP** 로 환전된다', () => {
    const w = mk([[ME10, 20]]);
    const p = player(w);
    p.aux0 = 11;
    const xpBefore = w.xp;
    const metaBefore = w.xpTotal;
    onPowerupPicked(w, 0, 0);
    expect(p.aux0).toBe(5); // floor(11/2)
    // 소각분 6 × (20 + 50×20/30)% = 6 × 53.33% = 3.2 → floor 3.
    expect(w.xp - xpBefore).toBe(3);
    // ⚠️ 메타 풀은 한 톨도 움직이지 않는다 — 여기가 새면 피격이 계정 성장 재화가 된다.
    expect(w.xpTotal).toBe(metaBefore);
  });

  it('부채가 없으면 무연산이다', () => {
    const w = mk([[ME10, 20]]);
    const p = player(w);
    p.aux0 = 0;
    const xpBefore = w.xp;
    onPowerupPicked(w, 0, 0);
    expect(p.aux0).toBe(0);
    expect(w.xp).toBe(xpBefore);
  });

  it('레벨이 높을수록 같은 부채가 더 많은 XP 가 된다 (투자 전/후 대조)', () => {
    const lo = mk([[ME10, 1]]);
    const hi = mk([[ME10, 20]]);
    for (const w of [lo, hi]) player(w).aux0 = 200;
    const loBefore = lo.xp;
    const hiBefore = hi.xp;
    onPowerupPicked(lo, 0, 0);
    onPowerupPicked(hi, 0, 0);
    expect(hi.xp - hiBefore).toBeGreaterThan(lo.xp - loBefore);
    // 부채 소각량 자체는 레벨과 무관하게 절반 고정이다(전환율만 레벨을 탄다).
    expect(player(lo).aux0).toBe(100);
    expect(player(hi).aux0).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// ⑦ 앵커 ⑳ (S2) — 정산 직후 7종
// ---------------------------------------------------------------------------

describe('⑦ 앵커 ⑳ 정산 직후', () => {
  /** 정산이 이미 hp 를 깎고 온 상태를 흉내 낸다 — 앵커 ⑳ 의 계약이 그 시점이다. */
  function settledWorld(points: ReadonlyArray<readonly [number, number]>, hp = 400): WorldState {
    const w = mk(points);
    const p = player(w);
    p.maxHp = 1000;
    p.hp = hp;
    p.aux0 = 0; // 정산이 이미 리셋했다
    p.aux1 = 0;
    return w;
  }

  it('CU3 — 회당 상한 초과분이 hp 로 되돌아오고 잔여가 `aux0` 로 이월된다', () => {
    // Lv20: 상한 비율 = round(30 − 18×20/30) = 18% → maxHp 1000 의 180.
    const w = settledWorld([[CU3, 20]]);
    const p = player(w);
    onCushionSettled(w, p, 500, 0, 500);
    expect(p.hp).toBe(720); // 400 + (500 − 180)
    expect(p.aux0).toBe(320); // 500 − 180 이 다음 정산으로 이월
    expect(p.aux1).toBe(0); // 임계 재충전 규칙은 건드리지 않는다
  });

  it('CU3 — 상한 이하의 정산은 손대지 않는다 (이월도 없다)', () => {
    const w = settledWorld([[CU3, 20]]);
    const p = player(w);
    onCushionSettled(w, p, 100, 0, 100);
    expect(p.hp).toBe(400);
    expect(p.aux0).toBe(0);
  });

  it('SQ2 — `applied` 비례 폭발이 반경 안 적에게만 들어간다', () => {
    const w = settledWorld([[SQ2, 20]]);
    const p = player(w);
    const near = addEnemy(w, p.x + 100, p.y, 500);
    const far = addEnemy(w, p.x + 400, p.y, 500); // 반경 180 + 200 = 380 밖
    onCushionSettled(w, p, 50, 0, 50);
    expect(near.hp).toBe(400); // round(50 × 200/100) = 100
    expect(far.hp).toBe(500);
    expect(near.dead).toBe(false); // 격추 판정은 `compact()` 단일 수렴점
  });

  it('SQ2 — 선체에 한 톨도 안 들어간 정산(클램프 전량 소멸)은 터지지 않는다', () => {
    const w = settledWorld([[SQ2, 20]]);
    const p = player(w);
    const foe = addEnemy(w, p.x + 100, p.y, 500);
    onCushionSettled(w, p, 500, 0, 0); // applied 0
    expect(foe.hp).toBe(500);
  });

  it('SQ5 — 탕감된 몫이 장전 슬롯에 쌓인다', () => {
    const w = settledWorld([[SQ5, 20]]);
    onCushionSettled(w, player(w), 0, 40, 0);
    // 장전량 = round(40 × (50 + 5×20)/100) = 60.
    expect(readSlot(w.skillStage, SLOT_LOAD)).toBe(60);
  });

  it('SQ8 — `applied` 가 런 내 누적 슬롯에 쌓인다 (정산마다 더해진다)', () => {
    const w = settledWorld([[SQ8, 20]]);
    const p = player(w);
    onCushionSettled(w, p, 30, 0, 30);
    onCushionSettled(w, p, 25, 0, 25);
    expect(readSlot(w.skillCarry, SLOT_SCAR)).toBe(55);
  });

  it('ME4 — 탕감분의 일부가 실제 HP 회복이 된다', () => {
    const w = settledWorld([[ME4, 20]]);
    const p = player(w);
    // 전환율 = 20 + 60×20/35 ≈ 54.29% → round(100 × 54.29/100) = 54.
    onCushionSettled(w, p, 100, 100, 100);
    expect(p.hp).toBe(454);
  });

  it('⚠️ ME4 — 회복은 `applied` 를 절대 못 넘는다 (수지 불변식 1)', () => {
    const w = settledWorld([[ME4, 20]]);
    const p = player(w);
    // 탕감 100 이면 회복 54 가 나올 자리지만 선체행이 10 뿐이라 10 으로 잘린다.
    onCushionSettled(w, p, 10, 100, 10);
    expect(p.hp).toBe(410);
  });

  it('CU9 — 정산 틱에 무적이 서되, 더 긴 기존 무적은 깎지 않는다', () => {
    const w = settledWorld([[CU9, 20]]);
    const p = player(w);
    p.iframes = 0;
    onCushionSettled(w, p, 10, 0, 10);
    expect(p.iframes).toBe(100); // 20 + 4×20
    p.iframes = 200;
    onCushionSettled(w, p, 10, 0, 10);
    expect(p.iframes).toBe(200);
  });

  it('CU10 — `maxHp` 만 오르고 `hp` 는 오르지 않는다 (회복이 아니다)', () => {
    const w = settledWorld([[CU10, 20]]);
    const p = player(w);
    // 전환율 = round(4 + 16×20/36) = 13% → round(100 × 13/100) = 13, 회당 상한 23.
    onCushionSettled(w, p, 10, 100, 10);
    expect(p.maxHp).toBe(1013);
    expect(p.hp).toBe(400);
  });

  it('CU10 — 회당 상한(3 + Lv)이 실제로 문다', () => {
    const w = settledWorld([[CU10, 20]]);
    const p = player(w);
    onCushionSettled(w, p, 10, 1000, 10); // round(1000 × 13/100) = 130 → 23 으로 절삭
    expect(p.maxHp).toBe(1023);
  });

  it('⚠️ 적용 순서 — CU3 이 깎은 값을 SQ2·SQ8 이 본다 (설계 공통 고지 ④)', () => {
    const w = settledWorld([
      [CU3, 20],
      [SQ2, 20],
      [SQ8, 20],
    ]);
    const p = player(w);
    const foe = addEnemy(w, p.x + 100, p.y, 5000);
    onCushionSettled(w, p, 500, 0, 500);
    // CU3 이 180 으로 깎았으므로 폭발은 round(180 × 200/100) = 360 이어야 한다.
    // 순서가 뒤집혀 500 을 봤다면 1000 이 들어가 4000 이 된다.
    expect(foe.hp).toBe(4640);
    expect(readSlot(w.skillCarry, SLOT_SCAR)).toBe(180);
  });

  it('투자 전/후 대조 — 다른 스킬만 찍은 런은 ⑳ 에서 아무것도 하지 않는다', () => {
    const w = settledWorld([[ME1, 20]]);
    const p = player(w);
    const foe = addEnemy(w, p.x + 100, p.y, 500);
    onCushionSettled(w, p, 500, 100, 500);
    expect(p.hp).toBe(400);
    expect(p.maxHp).toBe(1000);
    expect(p.aux0).toBe(0);
    expect(p.iframes).toBe(0);
    expect(foe.hp).toBe(500);
    for (let s = 0; s < SKILL_SLOT_COUNT; s++) {
      expect(readSlot(w.skillCarry, s)).toBe(0);
      expect(readSlot(w.skillStage, s)).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// ⑧ 앵커 ⑯ (S2) — 발사부 3종
// ---------------------------------------------------------------------------

describe('⑧ 앵커 ⑯ 볼리 파라미터', () => {
  it('SQ1 — 현재 부채에 비례해 발당 피해가 증폭된다', () => {
    const w = mk([[SQ1, 20]]);
    const p = player(w);
    p.aux0 = 100;
    const v = volley(100);
    onVolleyParams(w, p, v);
    // bp = 100 × (4 + 20) = 2400 → 100 + round(100 × 2400/10000) = 124.
    expect(v.damage).toBe(124);
  });

  it('SQ1 — 증폭 상한이 문다 (부채가 두 배여도 상한 3000bp)', () => {
    const w = mk([[SQ1, 20]]);
    const p = player(w);
    p.aux0 = 200; // raw 4800 > cap 3000
    const v = volley(100);
    onVolleyParams(w, p, v);
    expect(v.damage).toBe(130);
  });

  it('SQ1 — 부채가 0 이면 무연산이다 (술어가 부채 게이트다)', () => {
    const w = mk([[SQ1, 20]]);
    const p = player(w);
    p.aux0 = 0;
    const v = volley(100);
    onVolleyParams(w, p, v);
    expect(v.damage).toBe(100);
  });

  it('SQ8 — ⑳ 에서 적립하고 ⑯ 에서 소비한다 (두 앵커 왕복)', () => {
    const w = mk([[SQ8, 20]]);
    const p = player(w);
    const before = volley(100);
    onVolleyParams(w, p, before);
    expect(before.damage).toBe(100); // 아직 갚은 적이 없다

    onCushionSettled(w, p, 10, 0, 10);
    const after = volley(100);
    onVolleyParams(w, p, after);
    // bp = 10 × (6 + 2×20) = 460 → 100 + round(100 × 460/10000) = 105.
    expect(after.damage).toBe(105);
  });

  it('SQ5 — 볼리마다 잔량의 25% 가 발당 피해로 실리고 잔량이 줄어든다', () => {
    const w = mk([[SQ5, 1]]);
    const p = player(w);
    onCushionSettled(w, p, 0, 200, 0); // 장전 = round(200 × 55/100) = 110
    expect(readSlot(w.skillStage, SLOT_LOAD)).toBe(110);
    const v = volley(100);
    onVolleyParams(w, p, v);
    expect(v.damage).toBe(127); // floor(110 × 25/100) = 27
    expect(readSlot(w.skillStage, SLOT_LOAD)).toBe(83);
  });

  it('⚠️ SQ5 — 잔량은 반드시 0 에 도달한다 (내림만 쓰면 3 이하에서 영영 안 빈다)', () => {
    const w = mk([[SQ5, 1]]);
    const p = player(w);
    onCushionSettled(w, p, 0, 200, 0);
    for (let i = 0; i < 200; i++) onVolleyParams(w, p, volley(100));
    expect(readSlot(w.skillStage, SLOT_LOAD)).toBe(0);
    const dry = volley(100);
    onVolleyParams(w, p, dry);
    expect(dry.damage).toBe(100); // 빈 탄창은 무연산
  });

  it('투자 전/후 대조 — 다른 스킬만 찍은 런은 ⑯ 에서 파라미터를 안 만진다', () => {
    const w = mk([[ME1, 20]]);
    const p = player(w);
    p.aux0 = 200;
    const v = volley(100);
    onVolleyParams(w, p, v);
    expect(v.damage).toBe(100);
    expect(v.mark).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑨ 엔진 경로 — `stepWorld` 의 정산이 실제로 앵커 ⑳ 을 부른다
// ---------------------------------------------------------------------------

describe('⑨ 엔진 경로', () => {
  it('임계를 채운 틱에 정산이 일어나고 SQ8 누적이 실제로 쌓인다', () => {
    const w = mk([[SQ8, 20]]);
    const p = player(w);
    p.aux0 = 100;
    p.aux1 = CUSHION_RECOVER_TICKS - 1; // 이번 틱에 +1 되어 임계에 닿는다
    stepWorld(w, emptyInput());
    expect(p.aux0).toBe(0); // 정산으로 풀이 비었다
    // 탕감 = round(100 × 6000/10000) = 60 → 선체행 40. hp 여유가 커서 클램프가 안 문다.
    expect(readSlot(w.skillCarry, SLOT_SCAR)).toBe(40);
  });

  it('임계 미달 틱에는 아무 일도 없다 (정산 술어가 살아 있다)', () => {
    const w = mk([[SQ8, 20]]);
    const p = player(w);
    p.aux0 = 100;
    p.aux1 = 10;
    stepWorld(w, emptyInput());
    expect(p.aux0).toBe(100);
    expect(readSlot(w.skillCarry, SLOT_SCAR)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑩ 앵커 ⑲ — ME9 솜틀 요양 (임계 인하) · CU7 분모 연동
// ---------------------------------------------------------------------------

describe('⑩ 앵커 ⑲ ME9 솜틀 요양', () => {
  // ⚠️ 이 절은 종전에 **"ME9 는 ⑲ 만으로 안 돈다"를 잠그는** 절이었다. 사유는 지우지 않는다:
  //    `cushionSettled`·`cushionRecovered` 가 **자기 안에서** `unhitTicks < CUSHION_RECOVER_TICKS`
  //    를 다시 검사해 0 을 돌려줬기 때문에, 임계를 낮춰 분기에 진입시켜도 정산액이 0 이 되어
  //    **조용히 아무 일도 안 일어났다.** 순수 함수 개정 레인이 임계를 **필수 인자**로 만들면서
  //    그 사유가 해소됐고, 아래가 "실제로 돈다" 를 잰다.

  it('⚠️ 되살아남 증명 — 순수 함수가 임계 인자를 실제로 따른다 (종전에는 삼켰다)', () => {
    // ME9 Lv20 의 실효 임계 129. 종전에는 이 두 줄이 0 이었다 — 그것이 미배선의 근거였다.
    expect(cushionSettled(100, 129, 129)).toBeGreaterThan(0);
    expect(cushionRecovered(100, 129, 129)).toBeGreaterThan(0);
    // 긍정 짝의 **하한**: 정산이 실제로 일어났음을 절대값으로 못 박는다(항진 방지).
    expect(cushionRecovered(100, 129, 129)).toBe(60);
    expect(cushionSettled(100, 129, 129)).toBe(40);
    // 음성 짝 — 기본 임계를 넘기면 129틱은 여전히 미달이라 0 이다(게이트가 살아 있다).
    expect(cushionSettled(100, 129, CUSHION_RECOVER_TICKS)).toBe(0);
    expect(cushionRecovered(100, 129, CUSHION_RECOVER_TICKS)).toBe(0);
  });

  it('항등 — 기본 임계를 넘기면 종전 결과와 정확히 같다 (미투자 비트 불변의 뿌리)', () => {
    expect(cushionRecovered(1000, CUSHION_RECOVER_TICKS, CUSHION_RECOVER_TICKS)).toBe(600);
    expect(cushionSettled(1000, CUSHION_RECOVER_TICKS, CUSHION_RECOVER_TICKS)).toBe(400);
    expect(cushionSettled(1000, CUSHION_RECOVER_TICKS - 1, CUSHION_RECOVER_TICKS)).toBe(0);
  });

  it('음성 — ME9 미투자면 벽에 붙어 있어도 기본 임계 그대로다', () => {
    const w = mk([[CU7, 20]]);
    w.wallContactTicks = 600;
    expect(onCushionThreshold(w, player(w), CUSHION_RECOVER_TICKS)).toBe(CUSHION_RECOVER_TICKS);
  });

  it('음성 — ME9 투자해도 벽 접촉이 60틱 미만이면 기본 임계다', () => {
    const w = mk([[ME9, 20]]);
    w.wallContactTicks = 59;
    expect(onCushionThreshold(w, player(w), CUSHION_RECOVER_TICKS)).toBe(CUSHION_RECOVER_TICKS);
  });

  it('양성 — ME9 Lv20 + 벽 60틱이면 임계가 129 로 내려간다', () => {
    const w = mk([[ME9, 20]]);
    w.wallContactTicks = 60;
    // 인하폭 = round(20 + 50×20/32) = round(51.25) = 51 → 180 − 51 = 129.
    expect(onCushionThreshold(w, player(w), CUSHION_RECOVER_TICKS)).toBe(129);
  });

  it('⚠️ 뮤테이션 — 임계를 바꾸면 정산 **시점**이 실제로 달라진다 (엔진 경로)', () => {
    // ⚠️ `w.wallContactTicks` 를 손으로 세우면 소용없다 — `stepWorld` 가 매 틱 벽 판정으로
    //    덮어쓴다. **실제로 벽에 겹쳐야** 한다(앵커 ⑦ 테스트와 같은 수법: 플레이어를 덮는 벽).
    const runAgainstWall = (pts: ReadonlyArray<readonly [number, number]>, wall: boolean) => {
      const w = mk(pts);
      const p = player(w);
      if (wall) spawnWall(w, p.x, p.y, 200, 200);
      for (let i = 0; i < 70; i++) stepWorld(w, emptyInput());
      p.aux0 = 100;
      p.aux1 = 128; // 이번 틱에 +1 되어 129 — ME9 실효 임계엔 닿고 기본 임계엔 못 닿는다
      stepWorld(w, emptyInput());
      return { pool: p.aux0, wall: w.wallContactTicks };
    };
    // 전제 — 벽 접촉이 실제로 60틱을 넘었는가(이게 거짓이면 아래 판정은 무의미하다).
    const wired = runAgainstWall([[ME9, 20]], true);
    expect(wired.wall).toBeGreaterThanOrEqual(60);
    // 양성: ME9 Lv20 + 벽 접촉 → 129틱에 정산이 일어나 풀이 비었다.
    expect(wired.pool).toBe(0);
    // 음성 ①: 같은 벽 접촉인데 ME9 미투자 → 129틱은 미달이라 풀이 그대로다.
    expect(runAgainstWall([[CU7, 20]], true).pool).toBe(100);
    // 음성 ②: ME9 투자했는데 벽에서 떨어짐 → 술어가 살아 있다는 증거.
    const off = runAgainstWall([[ME9, 20]], false);
    expect(off.wall).toBe(0);
    expect(off.pool).toBe(100);
  });

  it('CU7 분모가 실효 임계를 따른다 — 같은 aux1 에서 감소가 커진다', () => {
    const base = mk([[CU7, 20]]);
    base.wallContactTicks = 600;
    player(base).aux1 = 129;
    const wired = mk([
      [CU7, 20],
      [ME9, 20],
    ]);
    wired.wallContactTicks = 600;
    player(wired).aux1 = 129;
    const dBase = onDamageChain(base, player(base), 1000);
    const dWired = onDamageChain(wired, player(wired), 1000);
    // 하한 짝 — 배선이 끊기면 양변이 1000 이 되어 성립하는 항진을 막는다.
    expect(dBase).toBeLessThan(1000); // CU7 이 실제로 깎고 있다
    expect(dWired).toBeLessThan(dBase); // 분모가 129 로 줄어 만충(= 상한 K)에 닿았다
  });
});

// ---------------------------------------------------------------------------
// ⑪ 앵커 ㉕ — ME5 분할 상환
// ---------------------------------------------------------------------------

describe('⑪ 앵커 ㉕ ME5 분할 상환', () => {
  it('절반만 선체로 가고 나머지가 `aux0` 로 미뤄진다 (탕감률만큼 줄어서)', () => {
    const w = mk([[ME5, 20]]);
    const p = player(w);
    p.aux0 = 0; // 정산이 이미 리셋했다 — ㉕ 의 계약이 그 시점이다
    // Lv20 탕감 bp = 6000×20/40 = 3000. defer = floor(100/2) = 50,
    // 탕감 = floor(50 × 3000/10000) = 15, 이월 = 35, 선체행 = 50.
    expect(onCushionSettleDue(w, p, 100, 0)).toBe(50);
    expect(p.aux0).toBe(35);
  });

  it('레벨이 낮으면 탕감이 거의 없다 — 분할 폭은 그대로다 (두 축이 갈린다)', () => {
    const w = mk([[ME5, 1]]);
    const p = player(w);
    p.aux0 = 0;
    // Lv1 탕감 bp = 6000/21 ≈ 285.7 → floor(50 × 285.7/10000) = 1.
    expect(onCushionSettleDue(w, p, 100, 0)).toBe(50);
    expect(p.aux0).toBe(49);
  });

  it('`due <= 1` 은 무연산이다 — 1 을 반으로 계속 나누면 영영 안 비는 풀이 된다', () => {
    const w = mk([[ME5, 20]]);
    const p = player(w);
    p.aux0 = 0;
    expect(onCushionSettleDue(w, p, 1, 0)).toBe(1);
    expect(p.aux0).toBe(0);
    expect(onCushionSettleDue(w, p, 0, 0)).toBe(0);
    expect(p.aux0).toBe(0);
  });

  it('⚠️ 보존 — 미룬 몫은 사라지지도 두 배가 되지도 않는다 (연쇄 정산 총합을 잠근다)', () => {
    const w = mk([[ME5, 20]]);
    const p = player(w);
    let due = 1000;
    let hullSum = 0;
    let forgivenSum = 0;
    let rounds = 0;
    while (due > 1) {
      p.aux0 = 0; // 매 정산의 리셋을 흉내 낸다
      const hull = onCushionSettleDue(w, p, due, 0);
      const carry = p.aux0;
      // ⚠️ 항진 방지 — 분할이 **실제로 일어났다**를 먼저 잠근다. 배선이 끊기면 `carry` 가 0 이
      //    되어 루프가 첫 회전에서 끝나고 아래 총합 단언이 공짜로 성립한다.
      expect(hull).toBeGreaterThan(0);
      expect(carry).toBeGreaterThan(0);
      expect(hull).toBeLessThan(due); // 줄이는 방향이다
      // 매 회차 항등식: due = 선체행 + 탕감 + 이월. 정수 산술이라 잔차가 없다.
      const forgiven = due - hull - carry;
      expect(forgiven).toBeGreaterThanOrEqual(0);
      hullSum += hull;
      forgivenSum += forgiven;
      due = carry;
      rounds++;
    }
    expect(rounds).toBeGreaterThan(3); // 정말 여러 정산에 걸쳐 흘렀다
    // 총합 보존 — 처음 1000 이 선체행 + 탕감 + 마지막 잔량으로 **정확히** 분해된다.
    expect(hullSum + forgivenSum + due).toBe(1000);
  });

  it('⚠️ CU3 과 이중 이월이 되지 않는다 (⑳ 이 받는 `settled` 는 분할 **후** 값이다)', () => {
    const w = mk([
      [ME5, 20],
      [CU3, 20],
    ]);
    const p = player(w);
    p.maxHp = 1000;
    p.hp = 900;
    p.aux0 = 0;
    p.aux1 = 0;
    const due = 500;
    // ㉕ — defer 250, 탕감 75, 이월 175, 선체행 250.
    const hull = onCushionSettleDue(w, p, due, 0);
    expect(hull).toBe(250);
    expect(p.aux0).toBe(175);
    const room = Math.floor(p.hp) - 1;
    const applied = hull > room ? room : hull;
    // ⑳ — CU3 상한 180. 이월분 = 250 − 180 = 70 이 **가산**된다.
    onCushionSettled(w, p, hull, 0, applied > 0 ? applied : 0);
    expect(p.aux0).toBe(245); // 175 + 70
    // 두 겹이 아니라는 증거: 이월 245 + 탕감 75 + 실제 선체행 180 = 500 = due 정확히.
    expect(245 + 75 + 180).toBe(due);
  });

  it('엔진 경로 — 정산 틱의 hp 감소분과 완충 잔량이 **함께** 달라진다', () => {
    // 전제: 정산이 실제로 일어난다(항진 방지). 풀 100·임계 도달 시 탕감 60 · 선체행 40.
    expect(cushionSettled(100, CUSHION_RECOVER_TICKS, CUSHION_RECOVER_TICKS)).toBe(40);

    const base = mk([[ME1, 20]]); // ME5 미투자 대조군
    const bp = player(base);
    bp.aux0 = 100;
    bp.aux1 = CUSHION_RECOVER_TICKS - 1;
    const baseHp = bp.hp;
    stepWorld(base, emptyInput());
    expect(baseHp - bp.hp).toBe(40);
    expect(bp.aux0).toBe(0);

    const w = mk([[ME5, 20]]);
    const p = player(w);
    p.aux0 = 100;
    p.aux1 = CUSHION_RECOVER_TICKS - 1;
    const hp0 = p.hp;
    stepWorld(w, emptyInput());
    // 선체행 40 → 분할 20(탕감 6, 이월 14). 두 축이 **함께** 움직인다.
    expect(hp0 - p.hp).toBe(20);
    expect(p.aux0).toBe(14);
  });

  it('음성 — ME5 미투자 런의 ㉕ 는 `due` 를 그대로 돌려주고 `aux0` 을 안 만진다', () => {
    const w = mk([[CU3, 20]]);
    const p = player(w);
    p.aux0 = 0;
    expect(onCushionSettleDue(w, p, 500, 30)).toBe(500);
    expect(p.aux0).toBe(0);
  });

  it('음성 — 투자 0 런의 정산 궤적이 종전 그대로다 (분할이 한 톨도 안 샌다)', () => {
    // ⚠️ 두 런을 마주 세우지 않는다 — 배선이 통째로 죽으면 양변이 같이 죽어 성립하는 항진이
    //    이 리포에 실제로 있었다. 순수 함수 `cushionSettled` 가 내는 **절대값**으로 잠근다.
    const w = mk([]);
    const p = player(w);
    p.aux0 = 100;
    p.aux1 = CUSHION_RECOVER_TICKS - 1;
    const hp0 = p.hp;
    stepWorld(w, emptyInput());
    expect(hp0 - p.hp).toBe(40); // 분할 없이 선체행 전량이 들어간다
    expect(p.aux0).toBe(0); // 이월도 없다
    const h = hashWorld(w);
    for (let i = 0; i < 20; i++) stepWorld(w, emptyInput());
    expect(hashWorld(w)).not.toBe(h); // 해시 폴드가 살아 있다(고정 해시 단언의 항진 방지)
  });
});
