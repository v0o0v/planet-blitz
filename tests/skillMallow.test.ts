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
  onCushionSplit,
  onCushionRecoverBp,
  onObjectiveResolved,
  onEnemyDeath,
  type VolleyParams,
  type CushionSplitParams,
} from '../src/sim/skillHooks.js';
import {
  SIG_MALLOW_CUSHION,
  CUSHION_RECOVER_TICKS,
  CUSHION_RECOVER_BP,
  CUSHION_TICK_CAP,
  cushionSettled,
  cushionRecovered,
  cushionDeferredDamage,
} from '../src/sim/shipSignature.js';
import { tickEnemyStatus, FIRE_DURATION, COLD_DURATION } from '../src/sim/status.js';
import { MALLOW_HANDLERS, MALLOW_EXPIRE } from '../src/sim/activeHandlers/mallow.js';
import { activeById, wireIdOf } from '../data/ships/actives/index.js';
import { readSlot, SKILL_SLOT_COUNT } from '../src/sim/skillSlots.js';
import { DamageSource } from '../src/sim/skillSlots.js';

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
const SQ6 = 5;
const SQ7 = 6;
const SQ8 = 7;
const SQ9 = 8;
const SQ10 = 9;
const ME1 = 10;
const ME4 = 13;
const ME5 = 14;
const ME6 = 15;
const ME7 = 16;
const ME8 = 17;
const ME9 = 18;
const ME10 = 19;
const CU1 = 20;
const CU2 = 21;
const CU3 = 22;
const CU4 = 23;
const CU5 = 24;
const CU6 = 25;
const CU7 = 26;
const CU9 = 28;
const CU10 = 29;

/** 슬롯 번호 — 정본은 `src/sim/skillSlots.ts` 의 `MallowCarry`/`MallowStage` 다. */
const SLOT_SCAR = 0; // MallowCarry.scarApplied — SQ8 누적 선체행
const SLOT_LOAD = 0; // MallowStage.forgivenessLoad — SQ5 장전 잔량
const SLOT_BANKRUPT_USED = 1; // MallowCarry.bankruptcyUsed — CU6 런당 소진 표식
const SLOT_BANKRUPT_IFRAMES = 1; // MallowStage.bankruptcyIframes — CU6 무적 요구
const SLOT_MATURITY = 2; // MallowStage.maturityDue — SQ10 만기 표식

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

/**
 * 앵커 ⑯ 이 넘기는 레코드 한 벌. SQ1·SQ5·SQ8 은 `damage` 만 만지고, **SQ7 은 `speed` 도**
 * 만진다. 입력 벡터·발사각은 인자로 열어 둔다 — SQ7 의 술어가 그 둘의 내적이다.
 */
function volley(damage = 100, inputX = 0, inputY = 0, aimAngle = 0): VolleyParams {
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
    // 발사 방위(rad) · 그 틱 이동 입력 벡터. **SQ7(관성 사출)이 이 셋의 내적을 읽는다.**
    aimAngle,
    inputX,
    inputY,
    cloakBreak: false,
    mark: 0,
    leadDamageBonus: 0,
    leadPierceBonus: 0,
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
    onPlayerDamaged(w, p, 10, false, DamageSource.bullet);
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
    onPlayerDamaged(w, p, 10, false, DamageSource.bullet);
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
    onPlayerDamaged(w, p, 10, false, DamageSource.bullet);
    // 반환 배율 = 60 + 8×20 = 220% → round(10 × 220/100) = 22.
    expect(near.hp).toBe(78);
    expect(far.hp).toBe(100); // "최근접 1기" — 반경 안이어도 두 번째는 안 맞는다
    expect(near.dead).toBe(false); // hp 가 남았다 — 마킹은 hp≤0 에서만 선다
  });

  it('SQ3 — 반격으로 hp≤0 이 된 적은 dead 로 마킹돼 처치·젬까지 간다 (좀비 회귀)', () => {
    const w = mk([[SQ3, 20]]);
    const p = player(w);
    // ⚠️ **계측기 함정**: 적을 플레이어 코앞에 두면 자동사격 탄이 같은 틱에 마무리해서
    //    수정 전에도 초록이 된다(거짓 통과). 반격 반경 260 의 **바깥 끝**(250)에 두어
    //    사망 경로를 SQ3 하나로 좁힌다 — 탄은 ≈30px/tick 이라 1틱에 못 닿는다.
    const foe = addEnemy(w, p.x + 250, p.y, 20);
    const killsBefore = w.kills;
    const gemsBefore = w.entities.filter((e) => e.kind === 'gem').length;
    onPlayerDamaged(w, p, 10, false, DamageSource.bullet);
    // 하한 ① — SQ3 이 **실제로 발동했다**(반환 배율 220% → round(10×2.2) = 22).
    expect(foe.hp).toBe(20 - 22);
    // 하한 ② — hp 가 실제로 0 이하다(아래 dead 단언이 공회전이 아니다).
    expect(foe.hp).toBeLessThanOrEqual(0);
    // 본단언 — `compact()` 은 `dead === true` 만 수거하므로 여기서 안 세우면 좀비가 된다.
    expect(foe.dead).toBe(true);
    // 수거까지 간다 — 처치가 세어지고 젬이 떨어진다.
    stepWorld(w, emptyInput());
    expect(w.kills).toBe(killsBefore + 1);
    expect(w.entities.includes(foe)).toBe(false);
    expect(w.entities.filter((e) => e.kind === 'gem').length).toBeGreaterThan(gemsBefore);
  });

  it('SQ3 미투자 — 같은 배치에서 적은 멀쩡하고 처치도 젬도 없다 (음성 대조)', () => {
    const w = mk();
    const p = player(w);
    const foe = addEnemy(w, p.x + 250, p.y, 20);
    const killsBefore = w.kills;
    const gemsBefore = w.entities.filter((e) => e.kind === 'gem').length;
    onPlayerDamaged(w, p, 10, false, DamageSource.bullet);
    expect(foe.hp).toBe(20);
    expect(foe.dead).toBe(false);
    stepWorld(w, emptyInput());
    expect(w.kills).toBe(killsBefore);
    expect(w.entities.filter((e) => e.kind === 'gem').length).toBe(gemsBefore);
  });

  it('SQ3 — 안 죽인 적(hp 잔존)은 dead 가 서지 않는다 (회귀)', () => {
    const w = mk([[SQ3, 20]]);
    const p = player(w);
    const foe = addEnemy(w, p.x + 250, p.y, 100);
    onPlayerDamaged(w, p, 10, false, DamageSource.bullet);
    expect(foe.hp).toBe(78); // 하한 — 반격이 실제로 들어갔다
    expect(foe.dead).toBe(false);
  });

  it('SQ3 — 탐색 반경 260 밖의 적은 반격받지 않는다', () => {
    const w = mk([[SQ3, 20]]);
    const p = player(w);
    const away = addEnemy(w, p.x + 400, p.y, 100);
    onPlayerDamaged(w, p, 10, false, DamageSource.bullet);
    expect(away.hp).toBe(100);
  });

  it('SQ3 — 대상은 `kind === "enemy"` 한정 (보스는 안 맞는다)', () => {
    const w = mk([[SQ3, 20]]);
    const p = player(w);
    const boss: Entity = { ...blankEntity('boss'), x: p.x + 50, y: p.y, hp: 500, maxHp: 500 };
    w.entities.push(boss);
    onPlayerDamaged(w, p, 10, false, DamageSource.bullet);
    expect(boss.hp).toBe(500);
  });

  it('CU4 — 부채가 없으면 발동조차 하지 않는다 (발동 술어 자체가 부채 게이트다)', () => {
    const w = mk([[CU4, 20]]);
    const p = player(w);
    p.aux0 = 0;
    const shot = addEnemyBullet(w, p.x + 10, p.y);
    onPlayerDamaged(w, p, 10, false, DamageSource.bullet);
    expect(shot.dead).toBe(false);
  });

  it('CU4 — 부채 보유 중이면 소거되고, 반경이 부채에 비례해 커진다', () => {
    // Lv1: 기본 반경 76. 부채 5 → 확장 10 → 반경 86.
    const small = mk([[CU4, 1]]);
    const ps = player(small);
    ps.aux0 = 5;
    const inside = addEnemyBullet(small, ps.x + 80, ps.y);
    const outside = addEnemyBullet(small, ps.x + 120, ps.y);
    onPlayerDamaged(small, ps, 10, false, DamageSource.bullet);
    expect(inside.dead).toBe(true);
    expect(outside.dead).toBe(false);

    // 같은 레벨·같은 좌표인데 부채만 크면(30 → 확장 60, 상한 152 미만) 반경 136 이라 닿는다.
    const big = mk([[CU4, 1]]);
    const pb = player(big);
    pb.aux0 = 30;
    const reached = addEnemyBullet(big, pb.x + 120, pb.y);
    onPlayerDamaged(big, pb, 10, false, DamageSource.bullet);
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
    expect(cushionSettled(100, 129, 129, CUSHION_RECOVER_BP)).toBeGreaterThan(0);
    expect(cushionRecovered(100, 129, 129, CUSHION_RECOVER_BP)).toBeGreaterThan(0);
    // 긍정 짝의 **하한**: 정산이 실제로 일어났음을 절대값으로 못 박는다(항진 방지).
    expect(cushionRecovered(100, 129, 129, CUSHION_RECOVER_BP)).toBe(60);
    expect(cushionSettled(100, 129, 129, CUSHION_RECOVER_BP)).toBe(40);
    // 음성 짝 — 기본 임계를 넘기면 129틱은 여전히 미달이라 0 이다(게이트가 살아 있다).
    expect(cushionSettled(100, 129, CUSHION_RECOVER_TICKS, CUSHION_RECOVER_BP)).toBe(0);
    expect(cushionRecovered(100, 129, CUSHION_RECOVER_TICKS, CUSHION_RECOVER_BP)).toBe(0);
  });

  it('항등 — 기본 임계를 넘기면 종전 결과와 정확히 같다 (미투자 비트 불변의 뿌리)', () => {
    expect(cushionRecovered(1000, CUSHION_RECOVER_TICKS, CUSHION_RECOVER_TICKS, CUSHION_RECOVER_BP)).toBe(600);
    expect(cushionSettled(1000, CUSHION_RECOVER_TICKS, CUSHION_RECOVER_TICKS, CUSHION_RECOVER_BP)).toBe(400);
    expect(cushionSettled(1000, CUSHION_RECOVER_TICKS - 1, CUSHION_RECOVER_TICKS, CUSHION_RECOVER_BP)).toBe(0);
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
    // ⚠️ **여백 합성**(ME8 레인이 앵커 ㉘ 을 열면서 정본 공식이 실제로 성립하게 됐다):
    //    갱신값 = 현재율 + (10000 − 현재율) × r / 10000 이고 「현재율」은 이 정산에 실제로 쓰인
    //    탕감률이다. ME8 미투자면 그것은 0 이 아니라 **기본 6000** 이다 — 종전 기대값(이월 35)은
    //    현재율 0 을 전제한 축약이었고, 이 레인이 그 전제를 없앴다.
    // Lv20 r = 6000×20/40 = 3000 → eff = 6000 + floor(4000×3000/10000) = 7200.
    // defer = floor(100/2) = 50, 탕감 = floor(50 × 7200/10000) = 36, 이월 = 14, 선체행 = 50.
    expect(onCushionSettleDue(w, p, 100, 0, CUSHION_RECOVER_BP)).toBe(50);
    expect(p.aux0).toBe(14);
  });

  it('레벨이 낮으면 탕감이 거의 없다 — 분할 폭은 그대로다 (두 축이 갈린다)', () => {
    const w = mk([[ME5, 1]]);
    const p = player(w);
    p.aux0 = 0;
    // Lv1 r = 6000/21 ≈ 285.7 → eff = 6000 + floor(4000×285.7/10000) = 6114.
    // 탕감 = floor(50 × 6114/10000) = 30, 이월 = 20. 분할 폭(50)은 레벨과 무관하다.
    expect(onCushionSettleDue(w, p, 100, 0, CUSHION_RECOVER_BP)).toBe(50);
    expect(p.aux0).toBe(20);
  });

  it('`due <= 1` 은 무연산이다 — 1 을 반으로 계속 나누면 영영 안 비는 풀이 된다', () => {
    const w = mk([[ME5, 20]]);
    const p = player(w);
    p.aux0 = 0;
    expect(onCushionSettleDue(w, p, 1, 0, CUSHION_RECOVER_BP)).toBe(1);
    expect(p.aux0).toBe(0);
    expect(onCushionSettleDue(w, p, 0, 0, CUSHION_RECOVER_BP)).toBe(0);
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
      const hull = onCushionSettleDue(w, p, due, 0, CUSHION_RECOVER_BP);
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
    // ㉕ — defer 250, 탕감 180(eff 7200), 이월 70, 선체행 250.
    const hull = onCushionSettleDue(w, p, due, 0, CUSHION_RECOVER_BP);
    expect(hull).toBe(250);
    expect(p.aux0).toBe(70);
    const room = Math.floor(p.hp) - 1;
    const applied = hull > room ? room : hull;
    // ⑳ — CU3 상한 180. 이월분 = 250 − 180 = 70 이 **가산**된다.
    onCushionSettled(w, p, hull, 0, applied > 0 ? applied : 0);
    expect(p.aux0).toBe(140); // 70(ME5) + 70(CU3)
    // 두 겹이 아니라는 증거: 이월 140 + 탕감 180 + 실제 선체행 180 = 500 = due 정확히.
    expect(140 + 180 + 180).toBe(due);
  });

  it('엔진 경로 — 정산 틱의 hp 감소분과 완충 잔량이 **함께** 달라진다', () => {
    // 전제: 정산이 실제로 일어난다(항진 방지). 풀 100·임계 도달 시 탕감 60 · 선체행 40.
    expect(cushionSettled(100, CUSHION_RECOVER_TICKS, CUSHION_RECOVER_TICKS, CUSHION_RECOVER_BP)).toBe(40);

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
    // 선체행 40 → 분할 20(defer 20 · 탕감 14 · 이월 6). 두 축이 **함께** 움직인다.
    expect(hp0 - p.hp).toBe(20);
    expect(p.aux0).toBe(6);
  });

  it('음성 — ME5 미투자 런의 ㉕ 는 `due` 를 그대로 돌려주고 `aux0` 을 안 만진다', () => {
    const w = mk([[CU3, 20]]);
    const p = player(w);
    p.aux0 = 0;
    expect(onCushionSettleDue(w, p, 500, 30, CUSHION_RECOVER_BP)).toBe(500);
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

// ---------------------------------------------------------------------------
// ⑫ SQ7 관성 사출 — 앵커 ⑯ + **입력 배관**(W2)
// ---------------------------------------------------------------------------
//
// 이 절이 잠그는 것은 스킬 하나가 아니라 **배관 자체**다: `autoAttack` 은 오래도록
// `InputFrame` 을 인자로 받지 않았고 `WorldState` 에 그 틱 입력 보관도 없었다. 그래서
// 술어(*"그 틱 입력 벡터와 발사각의 내적"*)의 한 항이 통째로 부재했고, 발사각(`aimAngle`)만
// 실렸을 때도 SQ7 은 열리지 않았다.
//
// ⚠️ 부정 항목(무입력·역방향에 무연산)은 뮤테이션에 **원리적으로 안 걸린다** — 효과를 통째로
//    지워도 통과한다. 그래서 모든 부정 단언 옆에 **같은 세팅의 긍정 짝**을 둔다.
// ⚠️ 비례·단조 단언 앞에는 **하한**을 먼저 놓는다 — 배선이 끊기면 양변이 모두 기본값이 되어
//    성립하는 항진이 이 리포에 실제로 있었다.
//
// 수치 정본(설계서 SQ7): 최대 보정(dot = 1) 피해 bp = 400 + 100×Lv · 탄속 bp = 1000 + 100×Lv.
describe('⑫ SQ7 관성 사출', () => {
  const AIMS = [0, Math.PI / 2, Math.PI, -2.3, 0.77];

  it('양성 — 입력이 발사각과 완전히 일치하면 피해·탄속이 최대로 실린다 (다섯 방위)', () => {
    const w = mk([[SQ7, 20]]);
    const p = player(w);
    for (const aim of AIMS) {
      const v = volley(100, Math.cos(aim), Math.sin(aim), aim);
      onVolleyParams(w, p, v);
      // 방위가 달라도 **일치도가 같으면 결과가 같다** — 각도 자체가 아니라 내적이 술어다.
      // 한 각도만 재면 우연 일치(예: `aimAngle` 을 무시하고 `inputX` 만 읽는 구현)를 못 가른다.
      expect(v.damage).toBe(124); // 100 + round(100 × 2400/10000)
      expect(v.speed).toBeCloseTo(650, 9); // 500 × 13000/10000
    }
  });

  it('양성 — 입력 크기는 무관하다 (정규화 뒤의 내적이 술어다)', () => {
    const w = mk([[SQ7, 20]]);
    const p = player(w);
    const full = volley(100, 1, 0, 0);
    const short = volley(100, 0.3, 0, 0); // 같은 방향, 짧은 벡터
    onVolleyParams(w, p, full);
    onVolleyParams(w, p, short);
    expect(full.damage).toBe(124);
    expect(short.damage).toBe(full.damage);
    expect(short.speed).toBeCloseTo(full.speed, 9);
  });

  it('단조 — 일치도가 낮아질수록 보정이 줄어든다 (하한을 먼저 잠근다)', () => {
    const w = mk([[SQ7, 20]]);
    const p = player(w);
    // 발사각은 +x 고정, 입력만 0° → 45° → 90° 로 돌린다.
    const got = [0, Math.PI / 4, Math.PI / 2].map((a) => {
      const v = volley(100, Math.cos(a), Math.sin(a), 0);
      onVolleyParams(w, p, v);
      return v;
    });
    // ⚠️ 하한 — "볼리가 실제로 보정을 받았다". 이게 없으면 전부 100/500 이어도 단조가 선다.
    expect(got[0]!.damage).toBeGreaterThan(100);
    expect(got[0]!.speed).toBeGreaterThan(500);
    expect(got[1]!.damage).toBeGreaterThan(100);
    expect(got[1]!.speed).toBeGreaterThan(500);
    expect(got[0]!.damage).toBeGreaterThan(got[1]!.damage);
    expect(got[1]!.damage).toBeGreaterThan(got[2]!.damage);
    expect(got[0]!.speed).toBeGreaterThan(got[1]!.speed);
    expect(got[1]!.speed).toBeGreaterThan(got[2]!.speed);
    // 직각(내적 0)은 무보정 — 아래 음성 절과 같은 경계다.
    expect(got[2]!.damage).toBe(100);
    expect(got[2]!.speed).toBe(500);
  });

  it('음성 짝 — 무입력·역방향은 레코드를 한 칸도 안 만진다 (긍정을 옆에 둔다)', () => {
    const w = mk([[SQ7, 20]]);
    const p = player(w);
    const still = volley(100, 0, 0, 0);
    onVolleyParams(w, p, still);
    expect(still).toEqual(volley(100, 0, 0, 0));

    const backward = volley(100, -1, 0, 0);
    onVolleyParams(w, p, backward);
    expect(backward).toEqual(volley(100, -1, 0, 0)); // 감산도 없다(설계서에 페널티가 없다)

    // 긍정 짝 — 같은 런·같은 발사각에서 입력 방향만 뒤집으면 보정이 실린다.
    const forward = volley(100, 1, 0, 0);
    onVolleyParams(w, p, forward);
    expect(forward.damage).toBe(124);
    expect(forward.speed).toBeCloseTo(650, 9);
  });

  it('미투자 무연산 — 다른 스킬만 찍은 런은 입력이 완전히 일치해도 안 만진다', () => {
    const w = mk([[ME1, 20]]);
    const p = player(w);
    const v = volley(100, 1, 0, 0);
    onVolleyParams(w, p, v);
    expect(v).toEqual(volley(100, 1, 0, 0));
    // 긍정 짝 — 같은 입력·같은 앵커에 SQ7 만 얹으면 갈린다(앵커 자체는 살아 있다).
    const inv = mk([[SQ7, 1]]);
    const v2 = volley(100, 1, 0, 0);
    onVolleyParams(inv, player(inv), v2);
    expect(v2.damage).toBe(105); // Lv1: 피해 bp 500 → 100 + 5
    expect(v2.speed).toBeCloseTo(555, 9); // 500 × 11100/10000
  });

  /**
   * 실제 런에서 첫 아군탄 하나를 받아 온다. 이동 입력을 **매 틱 그대로** 넣는다.
   * ⚠️ 표적이 우리가 놓은 적이 맞는지 진행 방위로 확인한다 — 웨이브가 더 가까운 적을 놓으면
   *    발사 방위가 갈리고, 그러면 이 비교는 의미가 없다(조용히 틀리는 대신 크게 실패한다).
   */
  function firstBullet(points: ReadonlyArray<readonly [number, number]>, moveX: number): Entity {
    const w = mk(points);
    const p = player(w);
    addEnemy(w, p.x + 200, p.y, 1_000_000); // dy = 0 → 발사 방위가 정확히 +x
    let b: Entity | undefined;
    for (let i = 0; i < 30 && b === undefined; i++) {
      stepWorld(w, { ...emptyInput(), moveX, aim: 0 });
      b = w.entities.find((e) => e.kind === 'bullet');
    }
    expect(b).toBeDefined();
    expect(Math.abs(Math.atan2(b!.vy, b!.vx))).toBeLessThan(0.05);
    return b!;
  }

  it('⚠️ 엔진 경로 — 그 틱 이동 입력이 **발사 시점까지 살아 있다**', () => {
    // 질문 ①: 입력이 이동에 소비된 뒤 초기화되지 않는가. `stepPlayer` 는 지역 복사본만 쓰고
    // `input` 을 한 칸도 안 고치므로(`src/sim/**` 전수: `input.<필드> =` 대입 0건)
    // `autoAttack` 이 같은 값을 본다 — 그 사실을 훅 단위가 아니라 **실제 런**으로 잠근다.
    const base = mk().weapon.bulletSpeed;
    const idle = firstBullet([[SQ7, 20]], 0);
    const moving = firstBullet([[SQ7, 20]], 1);
    const sIdle = Math.hypot(idle.vx, idle.vy);
    const sMoving = Math.hypot(moving.vx, moving.vy);
    // ⚠️ 정밀도 1(±0.05)인 것은 여유가 아니다 — 탄 속도는 `speed` 를 `math.ts` 의 **근사**
    //    `cos`/`sin` 으로 풀어 저장하므로 되감은 크기가 `speed` 와 소수점 두째 자리에서
    //    갈린다(여기서 1800 대 1800.0064). 배선이 끊기는 실패는 30% 차이라 남김없이 잡힌다.
    // 하한 — 정지 런의 탄속이 **무기 기본값 그대로**다(보정이 새지 않았다).
    expect(sIdle).toBeCloseTo(base, 1);
    // 배선 증명 — 같은 런에서 이동 입력만 켜면 탄이 실제로 빨라진다(Lv20 정방향 = ×1.3).
    expect(sMoving).toBeGreaterThan(sIdle);
    expect(sMoving).toBeCloseTo(base * 1.3, 1);
  });

  it('미투자 비트 불변 — 이동 입력으로 쏴도 투자 0 런의 탄은 기본값 그대로다', () => {
    const w0 = mk();
    const none = firstBullet([], 1);
    // 정밀도 1 의 사유는 위 「엔진 경로」와 같다(근사 `cos`/`sin` 왕복 오차).
    expect(Math.hypot(none.vx, none.vy)).toBeCloseTo(w0.weapon.bulletSpeed, 1);
    expect(none.damage).toBe(w0.weapon.damage);
    // 긍정 짝 — 같은 입력·같은 세팅에 SQ7 만 얹으면 두 축이 다 움직인다.
    const on = firstBullet([[SQ7, 20]], 1);
    expect(Math.hypot(on.vx, on.vy)).toBeGreaterThan(Math.hypot(none.vx, none.vy));
    expect(on.damage).toBeGreaterThan(none.damage);
  });

  it('미투자 런은 이동 입력으로 240틱을 돌려도 결정론이 그대로다', () => {
    const mv = { ...emptyInput(), moveX: 1, moveY: 0.5 };
    const a = mk();
    const b = mk();
    for (let i = 0; i < 240; i++) {
      stepWorld(a, mv);
      stepWorld(b, mv);
    }
    expect(hashWorld(a)).toBe(hashWorld(b));
    // 항진 방지 — 해시가 애초에 안 움직여서 위 단언이 서는 것이 아님을 보인다.
    // ⚠️ 여기서 SQ7 투자 런을 마주 세우면 **안 된다**: `hashWorld` 가 `config.skillInvest`
    //    배열 자체를 접어 배선과 무관하게 갈린다(① 절의 경고). 배선 증명은 위 두 테스트가
    //    관측면(탄속·피해)으로 한다.
    const h = hashWorld(a);
    for (let i = 0; i < 20; i++) stepWorld(a, mv);
    expect(hashWorld(a)).not.toBe(h);
  });
});

// ---------------------------------------------------------------------------
// ⑬ 앵커 ㉗ — 지연 전환 분기: CU1·CU2·CU5·CU6
// ---------------------------------------------------------------------------

/** ㉗ 을 통과시킨 뒤의 **지연분**. 초기값은 `world.ts` 와 같은 `cushionDeferredDamage(dmg)` 다. */
function splitDeferred(w: WorldState, dmg: number, hp = 1000): number {
  const p = player(w);
  const params: CushionSplitParams = { deferred: cushionDeferredDamage(dmg) };
  onCushionSplit(w, p, dmg, params, hp);
  return params.deferred;
}

describe('⑬ 앵커 ㉗ 지연 전환 — CU1·CU2·CU5·CU6', () => {
  it('기본 분리는 CUSHION_DEFER_BP 그대로다 (미투자 대조군 — 하한 짝)', () => {
    expect(cushionDeferredDamage(100)).toBe(35);
    expect(splitDeferred(mk(), 100)).toBe(35);
  });

  it('CU1 — 임계 초과 대형 피해는 초과분 전액이 지연분이 된다', () => {
    const w = mk([[CU1, 20]]);
    // Lv20 임계 = round(40 − 25×20/30) = 23. dmg 100 → 초과 77 > 기본 35.
    expect(splitDeferred(w, 100)).toBe(77);
    // 하한 짝 — 미투자 대조군이 실제로 더 작다(양변이 같은 값이 되는 항진 방지).
    expect(splitDeferred(mk(), 100)).toBeLessThan(77);
  });

  it('CU1 — 임계 미만의 작은 피격은 한 칸도 안 바꾼다 (게이트가 실재한다)', () => {
    const w = mk([[CU1, 20]]);
    expect(splitDeferred(w, 20)).toBe(cushionDeferredDamage(20));
  });

  it('CU2 — 한도 여유만큼만 미뤄지고 나머지는 즉시분에 남는다', () => {
    const w = mk([[CU2, 20]]);
    const p = player(w);
    p.maxHp = 1000;
    // Lv20 한도 = 1000 × round(25 + 30×20/32)% = 440.
    p.aux0 = 430; // 여유 10
    expect(splitDeferred(w, 100)).toBe(10);
    // 하한 짝 — 부채가 없으면 한도가 안 문다(항진 방지).
    p.aux0 = 0;
    expect(splitDeferred(w, 100)).toBe(35);
  });

  it('CU2 — 한도를 이미 넘긴 부채(CU6 직후)에서는 전액 즉시분이다', () => {
    const w = mk([[CU2, 20]]);
    const p = player(w);
    p.maxHp = 1000;
    p.aux0 = 600; // 한도 440 위
    expect(splitDeferred(w, 100)).toBe(0);
  });

  it('CU5 — 방어 액티브(cushion_lo) 버프 창 동안만 지연 비율이 오른다', () => {
    const w = mk([[CU5, 20]]);
    w.config.activeSlots = [wireIdOf('as_mallow_cushion_lo'), -1];
    // 버프가 꺼져 있으면 기본값이다 — 이 짝이 없으면 아래 단언이 "항상 오른다"와 구별되지 않는다.
    w.activeBuff0 = 0;
    expect(splitDeferred(w, 100)).toBe(35);
    w.activeBuff0 = 120;
    // Lv20 bp = 6000 + 3500×20/32 = 8187.5 → round(100 × 8187.5/10000) = 82.
    expect(splitDeferred(w, 100)).toBe(82);
  });

  it('CU5 — 다른 계열 액티브의 버프로는 안 켜진다 (술어가 "방어 액티브" 한정이다)', () => {
    const w = mk([[CU5, 20]]);
    w.config.activeSlots = [wireIdOf('as_mallow_mend_lo'), -1];
    w.activeBuff0 = 120;
    expect(splitDeferred(w, 100)).toBe(35);
  });

  it('CU6 — 치명 피격 1회를 전액 지연으로 돌려 살아남고, 런당 1회로 소진된다', () => {
    const w = mk([[CU6, 20]]);
    // hp 30 · 피해 100 → 기본 즉시분 65 가 hp 를 다 가져간다(치명).
    expect(splitDeferred(w, 100, 30)).toBe(100);
    expect(readSlot(w.skillCarry, SLOT_BANKRUPT_USED)).toBe(1);
    // 요구 무적 = 30 + 3×20 = 90 이 슬롯에 남는다(집행은 앵커 ④).
    expect(readSlot(w.skillStage, SLOT_BANKRUPT_IFRAMES)).toBe(90);
    // 두 번째 치명 피격은 안 살린다.
    expect(splitDeferred(w, 100, 30)).toBe(35);
  });

  it('CU6 — 치명이 아닌 피격에서는 발동하지 않는다 (표식도 안 선다)', () => {
    const w = mk([[CU6, 20]]);
    expect(splitDeferred(w, 100, 1000)).toBe(35);
    expect(readSlot(w.skillCarry, SLOT_BANKRUPT_USED)).toBe(0);
  });

  it('CU6 무적은 앵커 ④ 에서 `hitIframes` 를 이긴다 (짧으면 통째로 무효인 자리)', () => {
    const w = mk([[CU6, 20]]);
    const p = player(w);
    splitDeferred(w, 100, 30);
    // `world.ts` 가 ㉗ 뒤에 하는 대입을 흉내 낸다 — 이 값이 이기면 스킬이 조용히 죽는다.
    p.iframes = w.config.hitIframes;
    onPlayerDamaged(w, p, 0, false, DamageSource.contact);
    expect(p.iframes).toBe(90);
    // 요구는 소비 즉시 지워진다 — 안 지우면 다음 피격마다 90 이 다시 서서 상시 장무적이 된다.
    expect(readSlot(w.skillStage, SLOT_BANKRUPT_IFRAMES)).toBe(0);
    p.iframes = w.config.hitIframes;
    onPlayerDamaged(w, p, 0, false, DamageSource.contact);
    expect(p.iframes).toBe(w.config.hitIframes);
  });

  it('⚠️ 엔진 경로 — `stepWorld` 의 피격이 실제로 ㉗ 을 부른다 (호출부 증명)', () => {
    // ⚠️ 이 절의 나머지는 앵커를 **직접** 부른다 — 그것만으로는 `world.ts` 가 훅을 부르는지를
    //    한 건도 못 잰다(뮤테이션으로 확인했다: 호출부를 지워도 0건 실패였다). 이 테스트가
    //    그 이음매를 잡는다.
    const shot = (pts: ReadonlyArray<readonly [number, number]>) => {
      const w = mk(pts);
      const p = player(w);
      p.iframes = 0;
      const b = addEnemyBullet(w, p.x, p.y);
      b.damage = 100;
      const hp0 = p.hp;
      stepWorld(w, emptyInput());
      return { w, p, taken: hp0 - p.hp };
    };
    const base = shot([[ME1, 20]]); // CU1 미투자 대조군
    const wired = shot([[CU1, 20]]);
    // 하한 짝 — 양쪽 다 실제로 맞았다(안 맞으면 아래 비교가 0 대 0 항진이 된다).
    expect(base.w.hitsTaken).toBe(1);
    expect(wired.w.hitsTaken).toBe(1);
    expect(base.taken).toBeGreaterThan(0);
    // 합 보존: 즉시분 + 지연분 = 원래 피해. 양쪽 다 성립한다.
    expect(base.taken + base.p.aux0).toBe(wired.taken + wired.p.aux0);
    // CU1 이 실제로 더 많이 미뤘고 그만큼 지금 덜 아프다.
    expect(wired.p.aux0).toBeGreaterThan(base.p.aux0);
    expect(wired.taken).toBeLessThan(base.taken);
  });

  it('음성 — 미투자 런은 ㉗ 에서 `deferred` 를 한 칸도 안 만진다', () => {
    const w = mk([[SQ1, 20]]);
    const p = player(w);
    const params: CushionSplitParams = { deferred: 12 };
    onCushionSplit(w, p, 100, params, 5);
    expect(params.deferred).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// ⑭ 앵커 ㉘ — ME8 리듬 탕감
// ---------------------------------------------------------------------------

describe('⑭ 앵커 ㉘ ME8 리듬 탕감', () => {
  it('콤보 스택이 쌓일수록 탕감률이 오른다 (하한 짝 포함)', () => {
    const w = mk([[ME8, 20]]);
    const p = player(w);
    w.combo = 0;
    expect(onCushionRecoverBp(w, p, CUSHION_RECOVER_BP)).toBe(CUSHION_RECOVER_BP);
    w.combo = 5;
    const at5 = onCushionRecoverBp(w, p, CUSHION_RECOVER_BP);
    w.combo = 10;
    const at10 = onCushionRecoverBp(w, p, CUSHION_RECOVER_BP);
    // 하한 짝 — 배선이 끊기면 셋 다 6000 이 되어 단조 단언이 항진이 된다.
    expect(at5).toBeGreaterThan(CUSHION_RECOVER_BP);
    expect(at10).toBeGreaterThan(at5);
    // 10스택 Lv20 = 6000 + 3500×200/320 = 8187.5 → 8188.
    expect(at10).toBe(8188);
  });

  it('⚠️ 상한 — 어떤 스택·레벨에서도 10000 에 닿지 않는다 (부호 반전 방지)', () => {
    const w = mk([[ME8, 99]]);
    const p = player(w);
    w.combo = 100_000;
    const bp = onCushionRecoverBp(w, p, CUSHION_RECOVER_BP);
    expect(bp).toBeLessThan(10000);
    // 그 bp 로도 정산액이 음수가 되지 않는다(= 맞는 것이 이득이 되는 구간이 없다).
    expect(
      cushionSettled(1000, CUSHION_RECOVER_TICKS, CUSHION_RECOVER_TICKS, bp),
    ).toBeGreaterThan(0);
  });

  it('엔진 경로 — 콤보를 쥔 정산은 선체행이 실제로 줄고 탕감이 늘어난다', () => {
    const base = mk([[ME1, 20]]); // ME8 미투자 대조군
    const bp0 = player(base);
    bp0.aux0 = 1000;
    bp0.aux1 = CUSHION_RECOVER_TICKS - 1;
    const baseHp = bp0.hp;
    stepWorld(base, emptyInput());
    const baseTaken = baseHp - bp0.hp;

    const w = mk([[ME8, 20]]);
    const p = player(w);
    p.aux0 = 1000;
    p.aux1 = CUSHION_RECOVER_TICKS - 1;
    w.combo = 10;
    const hp0 = p.hp;
    stepWorld(w, emptyInput());
    const taken = hp0 - p.hp;
    // 하한 짝 — 대조군이 실제로 맞았다(정산 자체가 안 일어나 양변이 0 이 되는 항진 방지).
    expect(baseTaken).toBeGreaterThan(0);
    expect(taken).toBeLessThan(baseTaken);
    // 사연 관측(비-해시)도 함께 커진다.
    expect(w.cushionHealed).toBeGreaterThan(base.cushionHealed);
  });

  it('음성 — ME8 미투자 런은 콤보가 만층이어도 기본 탕감률이다', () => {
    const w = mk([[ME1, 20]]);
    w.combo = 20;
    expect(onCushionRecoverBp(w, player(w), CUSHION_RECOVER_BP)).toBe(CUSHION_RECOVER_BP);
  });
});

// ---------------------------------------------------------------------------
// ⑮ 앵커 ㉙ — ME7 에코 채권
// ---------------------------------------------------------------------------

describe('⑮ 앵커 ㉙ ME7 에코 채권', () => {
  it('부채가 전액 소각되고 소각량 비례 자석 버프 창이 열린다', () => {
    const w = mk([[ME7, 20]]);
    const p = player(w);
    p.aux0 = 100;
    w.magnetBuffTicks = 0;
    onObjectiveResolved(w, p, 'echo');
    expect(p.aux0).toBe(0);
    // Lv20 전환율 = 60 + 40×20/30 ≈ 86.67% → floor(100 × 86.67/100) = 86.
    expect(w.magnetBuffTicks).toBe(86);
  });

  it('조우 완수 지점도 **같은 값**을 낸다 (두 지점이 한 벌이다)', () => {
    const w = mk([[ME7, 20]]);
    const p = player(w);
    p.aux0 = 100;
    w.magnetBuffTicks = 0;
    onObjectiveResolved(w, p, 'encounter');
    expect(p.aux0).toBe(0);
    expect(w.magnetBuffTicks).toBe(86);
  });

  it('버프 창에는 상한이 있다 (600틱)', () => {
    const w = mk([[ME7, 20]]);
    const p = player(w);
    p.aux0 = 100_000;
    onObjectiveResolved(w, p, 'echo');
    expect(w.magnetBuffTicks).toBe(600);
  });

  it('음성 — 미투자 런은 부채도 자석도 안 만진다', () => {
    const w = mk([[ME1, 20]]);
    const p = player(w);
    p.aux0 = 100;
    w.magnetBuffTicks = 0;
    onObjectiveResolved(w, p, 'echo');
    expect(p.aux0).toBe(100);
    expect(w.magnetBuffTicks).toBe(0);
  });

  it('부채가 0 이면 버프도 안 연다 (공짜 창이 생기지 않는다)', () => {
    const w = mk([[ME7, 20]]);
    const p = player(w);
    p.aux0 = 0;
    w.magnetBuffTicks = 0;
    onObjectiveResolved(w, p, 'echo');
    expect(w.magnetBuffTicks).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑯ 앵커 ㉚ + ⑪ — SQ9 이자 소각
// ---------------------------------------------------------------------------

describe('⑯ SQ9 이자 소각 — 부여(⑩) · 만료(㉚) · 사망(⑪)', () => {
  it('부채 보유 중 명중한 적에게 화상이 붙는다', () => {
    const w = mk([[SQ9, 20]]);
    const p = player(w);
    p.aux0 = 100;
    const e = addEnemy(w, 400, 0, 1000);
    onEnemyDamaged(w, e, 10, undefined);
    expect(e.iframes).toBe(FIRE_DURATION);
    // 틱당 피해 = round(2 × (100 + 4×20)/100) = 4.
    expect(e.dashCooldown).toBe(4);
  });

  it('부채가 없으면 화상이 안 붙는다 (부채 게이트가 실재한다)', () => {
    const w = mk([[SQ9, 20]]);
    const p = player(w);
    p.aux0 = 0;
    const e = addEnemy(w, 400, 0, 1000);
    onEnemyDamaged(w, e, 10, undefined);
    expect(e.iframes).toBe(0);
  });

  it('화상이 만료되면 부채가 소액 탕감된다 (엔진 경로 — `tickEnemyStatus`)', () => {
    const w = mk([[SQ9, 20]]);
    const p = player(w);
    p.aux0 = 100;
    const e = addEnemy(w, 400, 0, 1000);
    e.iframes = 1; // 이번 틱에 만료된다
    tickEnemyStatus(w, e);
    expect(e.iframes).toBe(0);
    // 탕감 = 3 + floor(20/2) = 13.
    expect(p.aux0).toBe(87);
  });

  it('만료가 안 온 틱에는 한 톨도 안 깎인다 (만료 트리거가 실재한다)', () => {
    const w = mk([[SQ9, 20]]);
    const p = player(w);
    p.aux0 = 100;
    const e = addEnemy(w, 400, 0, 1000);
    e.iframes = 5;
    tickEnemyStatus(w, e);
    expect(p.aux0).toBe(100);
  });

  it('냉기 만료로는 탕감되지 않는다 (세는 사건이 화상 하나다)', () => {
    const w = mk([[SQ9, 20]]);
    const p = player(w);
    p.aux0 = 100;
    const e = addEnemy(w, 400, 0, 1000);
    e.ownerId = 1;
    tickEnemyStatus(w, e);
    expect(e.ownerId).toBe(0);
    expect(p.aux0).toBe(100);
  });

  it('화상이 남은 채 죽은 적도 1회 탕감한다 (앵커 ⑪ 의 두 번째 경로)', () => {
    const w = mk([[SQ9, 20]]);
    const p = player(w);
    p.aux0 = 100;
    onEnemyDeath(w, 0, 0, false, true);
    expect(p.aux0).toBe(87);
    // 화상 없이 죽은 적은 안 센다 — `burning` 게이트가 실재한다.
    onEnemyDeath(w, 0, 0, false, false);
    expect(p.aux0).toBe(87);
  });

  it('탕감은 0 아래로 안 내려간다 (aux0 감산 규율)', () => {
    const w = mk([[SQ9, 20]]);
    const p = player(w);
    p.aux0 = 5;
    onEnemyDeath(w, 0, 0, false, true);
    expect(p.aux0).toBe(0);
  });

  it('음성 — 미투자 런은 부여도 탕감도 없다', () => {
    const w = mk([[SQ1, 20]]);
    const p = player(w);
    p.aux0 = 100;
    const e = addEnemy(w, 400, 0, 1000);
    onEnemyDamaged(w, e, 10, undefined);
    expect(e.iframes).toBe(0);
    onEnemyDeath(w, 0, 0, false, true);
    expect(p.aux0).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// ⑰ 앵커 ⑳ — SQ10 만기 일제
// ---------------------------------------------------------------------------

/** 이 월드의 살아 있는 아군탄 수. `fanStrike` 의 관측량이다. */
function bulletCount(w: WorldState): number {
  let n = 0;
  for (const e of w.entities) if (e.kind === 'bullet' && !e.dead) n++;
  return n;
}

function expireCushionHi(w: WorldState): void {
  const def = activeById('as_mallow_cushion_hi');
  if (def === undefined) throw new Error('as_mallow_cushion_hi missing');
  const fn = MALLOW_EXPIRE['as_mallow_cushion_hi'];
  if (fn === undefined) throw new Error('expire hook missing');
  fn(w, player(w), def);
}

describe('⑰ 앵커 ⑳ SQ10 만기 일제', () => {
  it('cushion_hi 만기 정산에서만 탄막이 나간다', () => {
    const w = mk([[SQ10, 20]]);
    const p = player(w);
    // 일반 정산 — 표식이 없으므로 한 발도 안 나간다(트리거가 만기 전용이라는 증거).
    const before = bulletCount(w);
    onCushionSettled(w, p, 100, 0, 100);
    expect(bulletCount(w)).toBe(before);
    // 만기 표식이 서면 나간다.
    expireCushionHi(w);
    expect(readSlot(w.skillStage, SLOT_MATURITY)).toBe(1);
    onCushionSettled(w, p, 100, 0, 100);
    // 탄수 = 6 + ceil(100 / (30 − 20×20/35)) = 6 + ceil(100/18.571) = 12.
    expect(bulletCount(w) - before).toBe(12);
  });

  it('표식은 1회만 쓰인다 — 다음 정산은 일반 정산이다', () => {
    const w = mk([[SQ10, 20]]);
    const p = player(w);
    expireCushionHi(w);
    onCushionSettled(w, p, 100, 0, 100);
    const after = bulletCount(w);
    expect(readSlot(w.skillStage, SLOT_MATURITY)).toBe(0);
    onCushionSettled(w, p, 100, 0, 100);
    expect(bulletCount(w)).toBe(after);
  });

  it('탄수가 정산액에 비례한다 (하한 짝 포함)', () => {
    const small = mk([[SQ10, 20]]);
    expireCushionHi(small);
    onCushionSettled(small, player(small), 20, 0, 20);
    const big = mk([[SQ10, 20]]);
    expireCushionHi(big);
    onCushionSettled(big, player(big), 400, 0, 400);
    expect(bulletCount(small)).toBeGreaterThan(0); // 하한 짝
    expect(bulletCount(big)).toBeGreaterThan(bulletCount(small));
  });

  it('음성 — 미투자 런은 표식조차 안 세운다 (`skillStage` 가 0 을 유지한다)', () => {
    const w = mk([[SQ1, 20]]);
    expireCushionHi(w);
    expect(readSlot(w.skillStage, SLOT_MATURITY)).toBe(0);
    const before = bulletCount(w);
    onCushionSettled(w, player(w), 100, 0, 100);
    expect(bulletCount(w)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// ⑱ 액티브 핸들러 — SQ6 즉석 환전 · ME6 잔상 세척
// ---------------------------------------------------------------------------

function fireActive(w: WorldState, id: string): void {
  const def = activeById(id);
  if (def === undefined) throw new Error(`${id} missing`);
  const fn = MALLOW_HANDLERS[id];
  if (fn === undefined) throw new Error(`${id} handler missing`);
  fn(w, player(w), def, { x: 1, y: 0 }, 0);
}

describe('⑱ 액티브 — SQ6 즉석 환전 · ME6 잔상 세척', () => {
  it('SQ6 — 같은 부채로 탄이 더 많이 나가고 관통이 실린다', () => {
    const base = mk([[SQ1, 20]]);
    player(base).aux0 = 100;
    fireActive(base, 'as_mallow_squish_lo');
    const w = mk([[SQ6, 20]]);
    player(w).aux0 = 100;
    fireActive(w, 'as_mallow_squish_lo');
    // 하한 짝 — 대조군도 실제로 쐈다(양변이 0 이 되는 항진 방지).
    expect(bulletCount(base)).toBeGreaterThan(0);
    expect(bulletCount(w)).toBeGreaterThan(bulletCount(base));
    for (const e of w.entities) if (e.kind === 'bullet') expect(e.pierce).toBe(1);
    for (const e of base.entities) if (e.kind === 'bullet') expect(e.pierce).toBe(0);
  });

  it('SQ6 — 탄당 피해도 함께 오른다', () => {
    const base = mk([[SQ1, 20]]);
    player(base).aux0 = 100;
    fireActive(base, 'as_mallow_squish_lo');
    const w = mk([[SQ6, 20]]);
    player(w).aux0 = 100;
    fireActive(w, 'as_mallow_squish_lo');
    const dmgOf = (s: WorldState): number => {
      for (const e of s.entities) if (e.kind === 'bullet') return e.damage;
      throw new Error('탄이 없다');
    };
    expect(dmgOf(base)).toBeGreaterThan(0);
    expect(dmgOf(w)).toBeGreaterThan(dmgOf(base));
  });

  it('ME6 — 블링크 **도착 지점**의 적탄이 지워지고 적에게 냉기가 붙는다', () => {
    const def = activeById('as_mallow_mend_lo');
    if (def === undefined) throw new Error('as_mallow_mend_lo missing');
    const dist = def.coeff.distance ?? 0;
    const w = mk([[ME6, 20]]);
    w.activeWalls = []; // 슬라이드가 도착 좌표를 흔들지 않게 한다
    const p = player(w);
    const dx = p.x;
    const dy = p.y;
    const near = addEnemyBullet(w, dx + dist + 10, dy);
    // 출발 지점 — 반경(140 + 10×20 = 340) 밖에 둔다. 여기가 지워지면 반쪽 배선이다.
    const far = addEnemyBullet(w, dx - 2000, dy);
    const foe = addEnemy(w, dx + dist - 10, dy, 1000);
    fireActive(w, 'as_mallow_mend_lo');
    expect(near.dead).toBe(true);
    expect(far.dead).toBe(false);
    expect(foe.ownerId).toBe(COLD_DURATION);
  });

  it('음성 — ME6 미투자 런의 블링크는 적탄도 적도 안 만진다', () => {
    const def = activeById('as_mallow_mend_lo');
    if (def === undefined) throw new Error('as_mallow_mend_lo missing');
    const dist = def.coeff.distance ?? 0;
    const w = mk([[ME1, 20]]);
    w.activeWalls = [];
    const p = player(w);
    const b = addEnemyBullet(w, p.x + dist + 10, p.y);
    const foe = addEnemy(w, p.x + dist - 10, p.y, 1000);
    fireActive(w, 'as_mallow_mend_lo');
    expect(b.dead).toBe(false);
    expect(foe.ownerId).toBe(0);
  });
});
