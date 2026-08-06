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
import { blankEntity } from '../src/sim/entities.js';
import { hashWorld } from '../src/sim/replay.js';
import { neutralLoadout } from '../src/items/loadout.js';
import {
  onGemCollected,
  onPlayerDamaged,
  onDamageChain,
  onEnemyDamaged,
  onPowerupPicked,
} from '../src/sim/skillHooks.js';
import {
  SIG_MALLOW_CUSHION,
  CUSHION_RECOVER_TICKS,
  CUSHION_TICK_CAP,
} from '../src/sim/shipSignature.js';
import { readSlot, SKILL_SLOT_COUNT } from '../src/sim/skillSlots.js';

/** `data/ships/index.ts` 의 타입 id — `data/ships/mallow.ts` 의 `id: 5` 가 정본이다. */
const SHIP_MALLOW = 5;

/**
 * flat 인덱스 — **정본은 `data/ships/mallow.ts` 의 `trees` 배열**이다:
 * `[squish(offense), mend(utility), cushion(defense)]` → SQ 0..9 · ME 10..19 · CU 20..29.
 * ⚠️ 스트라이커(축1=defense)와 순서가 다르다.
 */
const SQ3 = 2;
const SQ4 = 3;
const ME1 = 10;
const ME10 = 19;
const CU4 = 23;
const CU7 = 26;

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

  it('말로우 배선 6종은 슬롯을 한 칸도 쓰지 않는다 (전 스킬 만렙 런도 슬롯 0)', () => {
    // 슬롯을 잡지 않는다는 것은 `MallowCarry`/`MallowStage` 가 자리표시자로 남아 있다는 뜻이고,
    // 그래야 `hashWorld` 의 스킬 슬롯 폴드가 말로우 런에서 한 번도 실행되지 않는다.
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
