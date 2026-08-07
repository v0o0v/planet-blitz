/**
 * 버블 30스킬 배선(ADR-0049 배치 4) — **앵커를 통과하는 관측 테스트**.
 *
 * ## 왜 효과 함수를 직접 부르지 않는가
 * `src/sim/skills/bubble.ts` 의 함수를 직접 부르면 "효과 산술이 맞다"만 잰다. 이 저장소가
 * 반복해서 밟은 실패는 그쪽이 아니라 **"고쳐 놨는데 아무도 안 부른다"** 였다. 그래서 전부
 * `skillHooks.ts` 의 **공개 앵커**(`onSignatureStep`·`onEnemyDamaged`·`onFilmBurst`)로
 * 자극하고, 파열 훅은 한 단계 더 내려가 **`resolveFilmBurst` 자체**를 부른다 — 그래야
 * `filmBurst.ts → skillHooks.ts` 이음매(이 레인이 새로 뚫은 앵커 ⑮)까지 함께 잰다.
 *
 * ## 뮤테이션으로 계측기를 검사했다 (2026-08-07)
 *  ① **효과 본체 삭제** — `bubbleFilmBurst` 의 FI1 블록(`player.aux1 = earlyCondenseTicks`)을
 *     지우면 §④ FI1 이 실패한다.
 *  ② **배선 이음매 치환** — 앵커 ⑮(`onFilmBurst`)의 `case SIG_BUBBLE_FILM:` 을
 *     `case SIG_STRIKER_MARKSMAN:` 으로 바꾸면 §④ 일곱 항목과 §⑤ 가 함께 실패한다.
 * 초록인데 아무것도 안 재는 테스트가 아니다.
 *
 * ## S2 앵커 추가분의 뮤테이션 (2026-08-07 · §⑥ ⑯ · §⑦ ⑱)
 *  ③ 앵커 ⑯·⑱ 의 `case SIG_BUBBLE_FILM:` 본문 호출을 지우면 **5항목이 실패**한다
 *     (PO2 전환 · PO5 관통+피해 · PO5 빔 · FI3 소거 · FI4 변위).
 *  ⚠️ 그 실측이 **항진 1건을 잡았다**: FI4 「흡수량 비례」는 배선이 끊기면 두 변위가 모두 0 이라
 *     비례식이 성립해 버렸다 — 그래서 `d1 > 0` 하한을 먼저 못 박았다. **부정 테스트(무연산을
 *     기대하는 항목)는 뮤테이션에 원리적으로 안 걸린다** — §⑥·§⑦ 의 "꺼진다" 항목들이 그것이고,
 *     짝이 되는 긍정 항목이 옆에 있어야 의미가 선다.
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
  onSignatureStep,
  onEnemyDamaged,
  onFilmBurst,
  onVolleyParams,
  onFilmAbsorbed,
  onFilmEntry,
  onFilmEfficiency,
  onActiveFired,
  onGemMagnetParams,
  onPlayerMoveParams,
  type VolleyParams,
  type ActiveFiredOrigin,
  type GemMagnetParams,
  type PlayerMoveParams,
  type FilmBurstParams,
} from '../src/sim/skillHooks.js';
import { resolveFilmBurst } from '../src/sim/filmBurst.js';
import { BUBBLE_ACTIVES } from '../data/ships/actives/bubble.js';
import { DT } from '../src/sim/constants.js';
import {
  SIG_BUBBLE_FILM,
  FILM_ABSORB_FLAT,
  FILM_BURST_RADIUS,
  filmBurstPush,
  FILM_PERIOD_TICKS,
  FILM_EFFICIENCY_BASE_BP,
  filmAbsorbed,
  filmRemainingDamage,
} from '../src/sim/shipSignature.js';
import { readSlot, SKILL_SLOT_COUNT } from '../src/sim/skillSlots.js';

/** `data/ships/index.ts` 의 타입 id — `data/ships/bubble.ts` 의 `id: 6`. */
const SHIP_BUBBLE = 6;

/**
 * flat 인덱스 — **정본은 `data/ships/bubble.ts` 의 `trees` 배열**이다:
 * `[pop(offense), drift(utility), film(defense)]` → PO 0..9 · DR 10..19 · FI 20..29.
 * ⚠️ 스트라이커와 축 종류의 순서가 다르다(스트라이커는 축1=defense).
 */
const PO1 = 0;
const PO2 = 1;
const PO3 = 2;
const PO5 = 4;
const PO6 = 5;
const PO7 = 6;
const PO9 = 8;
const DR1 = 10;
const DR4 = 13;
const DR5 = 14;
const DR6 = 15;
const DR9 = 18;
const DR10 = 19;
const FI1 = 20;
const FI2 = 21;
const FI3 = 22;
const FI4 = 23;
const FI5 = 24;
const FI8 = 27;
const FI9 = 28;
const FI10 = 29;

function invest(points: ReadonlyArray<readonly [number, number]>): number[] {
  const v = new Array<number>(30).fill(0);
  for (const [i, n] of points) v[i] = n;
  return v;
}

function bubbleConfig(): WorldConfig {
  return {
    ...DEFAULT_CONFIG,
    planet: 0,
    stage: 1,
    shipType: SHIP_BUBBLE,
    playerHp: 100_000_000,
    loadout: { ...neutralLoadout(), weaponType: 0 },
  };
}

function mk(points: ReadonlyArray<readonly [number, number]> = []): WorldState {
  return createWorld(1234, { ...bubbleConfig(), skillInvest: invest(points) });
}

function player(state: WorldState): Entity {
  const p = state.entities[0];
  if (p === undefined) throw new Error('player missing');
  return p;
}

function addEnemy(state: WorldState, x: number, y: number, hp: number): Entity {
  const e: Entity = { ...blankEntity('enemy'), x, y, hp, maxHp: hp, radius: 20 };
  state.entities.push(e);
  return e;
}

function addEnemyBullet(state: WorldState, x: number, y: number): Entity {
  const e: Entity = { ...blankEntity('enemyBullet'), x, y, radius: 6 };
  state.entities.push(e);
  return e;
}

/**
 * 젬 하나. `damage` 가 XP 값이다(`collectGem` 의 `baseXp = gem.damage`) — 0 으로 두면
 * "수거됐는데 XP 가 안 올랐다" 가 배선 결함과 구분되지 않는다.
 */
function addGem(state: WorldState, x: number, y: number): Entity {
  const e: Entity = { ...blankEntity('gem'), x, y, radius: 8, damage: 5 };
  state.entities.push(e);
  return e;
}

function countBullets(state: WorldState): number {
  let n = 0;
  for (const e of state.entities) if (e.kind === 'bullet' && !e.dead) n++;
  return n;
}


/**
 * 앵커 ⑮ 가 배치6 부터 요구하는 **밀어내기 파라미터**의 기본 픽스처(버블 FI7 이 고칠 칸).
 * 초기값은 호출부(`resolveFilmBurst`)와 같아야 한다 — 다르면 훅이 재는 배율의 기준이 갈린다.
 */
function burstParams(): FilmBurstParams {
  return { radius: FILM_BURST_RADIUS, push: filmBurstPush() };
}

// ---------------------------------------------------------------------------
// ⓪ 전제 — 이 테스트가 버블을 자극하고 있는가
// ---------------------------------------------------------------------------

describe('⓪ 전제', () => {
  it('shipType 6 런은 버블 시그니처이고 투자 벡터는 30칸이다', () => {
    const w = mk([[FI1, 1]]);
    expect(w.sigBit).toBe(SIG_BUBBLE_FILM);
    expect(w.skillsOn).toBe(true);
    expect(w.config.skillInvest).toHaveLength(30);
    expect(w.skillDerived.shipType).toBe(SHIP_BUBBLE);
  });

  it('투자 0 런은 `skillsOn` 이 거짓이라 앵커가 첫 줄에서 반환한다', () => {
    expect(mk().skillsOn).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ① 불변 계약
// ---------------------------------------------------------------------------

describe('① 투자 0 런 불변', () => {
  it('투자 0 버블 런 두 개가 240틱 뒤 같은 해시다 (슬롯도 전부 0)', () => {
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
    // ⚠️ `hashWorld` 를 마주 세우면 안 된다 — `hashWorld` 가 `config.skillInvest` 배열 자체를
    // 접어서 **배선과 무관하게** 갈린다(스트라이커 레인이 밟았다).
    const none = createWorld(77, { ...bubbleConfig() });
    const zero = createWorld(77, { ...bubbleConfig(), skillInvest: invest([]) });
    for (let i = 0; i < 480; i++) {
      stepWorld(none, emptyInput());
      stepWorld(zero, emptyInput());
    }
    expect(zero.entities.length).toBe(none.entities.length);
    expect(player(zero).aux0).toBe(player(none).aux0);
    expect(player(zero).aux1).toBe(player(none).aux1);
    expect(player(zero).hp).toBe(player(none).hp);
    expect(player(zero).iframes).toBe(player(none).iframes);
    expect(player(zero).targetX).toBe(player(none).targetX);
    expect(zero.playerSlowTicks).toBe(none.playerSlowTicks);
  });

  it('**다른 스킬만 찍은 런**에서도 미투자 스킬은 작동하지 않는다 (`skillsOn` 만으로는 부족)', () => {
    // FI2 만 찍었는데 파열 훅 7종 중 하나라도 돌면 게이트가 `skillsOn` 에 기대고 있다는 뜻이다.
    const w = mk([[FI2, 20]]);
    const p = player(w);
    p.aux1 = 77;
    p.iframes = 0;
    p.dashCooldown = 40;
    w.playerSlowTicks = 30;
    const foe = addEnemy(w, p.x + 40, p.y, 500);
    const shot = addEnemyBullet(w, p.x + 20, p.y);
    const before = countBullets(w);
    onFilmBurst(w, p.x, p.y, burstParams());
    expect(p.aux1).toBe(77); // FI1 미투자
    expect(p.iframes).toBe(0); // FI5 미투자
    expect(p.dashCooldown).toBe(40); // DR6 미투자
    expect(w.playerSlowTicks).toBe(30); // FI10 미투자
    expect(shot.dead).toBe(false); // FI10 미투자
    expect(foe.hp).toBe(500); // PO1·PO7 미투자
    expect(countBullets(w)).toBe(before); // PO3 미투자
  });
});

// ---------------------------------------------------------------------------
// ② 앵커 ⑨ — FI2 내구 재응결
// ---------------------------------------------------------------------------

describe('② FI2 내구 재응결 (앵커 ⑨)', () => {
  /** Lv1 주기 = 6 + floor(72/3) = 30. */
  function stepAt(w: WorldState, tick: number): void {
    w.tick = tick;
    onSignatureStep(w, player(w), emptyInput());
  }

  it('막이 서 있고 만재가 아니면 주기 틱마다 내구 +1', () => {
    const w = mk([[FI2, 1]]);
    const p = player(w);
    p.aux0 = 10;
    stepAt(w, 30);
    expect(p.aux0).toBe(11);
    stepAt(w, 31);
    expect(p.aux0).toBe(11); // 주기가 아닌 틱은 무연산
    stepAt(w, 60);
    expect(p.aux0).toBe(12);
  });

  it('레벨이 오르면 주기가 짧아진다 (Lv20 = 9틱)', () => {
    const w = mk([[FI2, 20]]);
    const p = player(w);
    p.aux0 = 10;
    stepAt(w, 9);
    expect(p.aux0).toBe(11);
    stepAt(w, 18);
    expect(p.aux0).toBe(12);
  });

  it('**만재는 넘기지 않는다** — `aux0 ≤ FILM_ABSORB_FLAT` 엔진 불변식을 지킨다', () => {
    const w = mk([[FI2, 20]]);
    const p = player(w);
    p.aux0 = FILM_ABSORB_FLAT;
    for (let t = 0; t < 200; t++) stepAt(w, t);
    expect(p.aux0).toBe(FILM_ABSORB_FLAT);
  });

  it('막이 없으면(터진 뒤) 되살리지 않는다 — 소진=파열 규칙 불변', () => {
    const w = mk([[FI2, 20]]);
    const p = player(w);
    p.aux0 = 0;
    for (let t = 0; t < 200; t++) stepAt(w, t);
    expect(p.aux0).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ③ 앵커 ⑩ — PO6 격발 재응결
// ---------------------------------------------------------------------------

describe('③ PO6 격발 재응결 (앵커 ⑩)', () => {
  it('무막 중 아군탄 명중마다 재생 타이머가 전진한다 (Lv1 = +1)', () => {
    const w = mk([[PO6, 1]]);
    const p = player(w);
    p.aux0 = 0;
    p.aux1 = 100;
    const foe = addEnemy(w, p.x + 50, p.y, 500);
    onEnemyDamaged(w, foe, 10, undefined);
    expect(p.aux1).toBe(101);
  });

  it('레벨 계단은 5폭이다 (Lv20 = 1 + floor(20/5) = +5)', () => {
    const w = mk([[PO6, 20]]);
    const p = player(w);
    p.aux0 = 0;
    p.aux1 = 0;
    const foe = addEnemy(w, p.x + 50, p.y, 500);
    onEnemyDamaged(w, foe, 10, undefined);
    expect(p.aux1).toBe(5);
  });

  it('**막이 서 있으면 한 칸도 안 넣는다** (계약 2 무막 게이트 — 파열 직전 선지불 차단)', () => {
    const w = mk([[PO6, 20]]);
    const p = player(w);
    p.aux0 = FILM_ABSORB_FLAT;
    p.aux1 = 0;
    const foe = addEnemy(w, p.x + 50, p.y, 500);
    for (let i = 0; i < 50; i++) onEnemyDamaged(w, foe, 10, undefined);
    expect(p.aux1).toBe(0);
  });

  it('잡몹이 아닌 표적(보스·구조물)에는 걸리지 않는다 — 설계서 ④ 표의 `enemy` 한정', () => {
    const w = mk([[PO6, 20]]);
    const p = player(w);
    p.aux0 = 0;
    p.aux1 = 0;
    const boss: Entity = { ...blankEntity('boss'), x: p.x + 50, y: p.y, hp: 999, maxHp: 999 };
    w.entities.push(boss);
    onEnemyDamaged(w, boss, 10, undefined);
    expect(p.aux1).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ④ 앵커 ⑮ — 파열 훅 7종
// ---------------------------------------------------------------------------

describe('④ 파열 훅 (앵커 ⑮)', () => {
  it('PO1 파열 탄두 — **파열 중심** 반경 안 잡몹만 즉발 피해(18 + 4×Lv)', () => {
    const w = mk([[PO1, 3]]);
    const p = player(w);
    // 플레이어에서 멀리 떨어진 곳에서 터뜨린다 — 중심이 플레이어면 near 가 안 맞는다.
    const cx = p.x + 2000;
    const cy = p.y + 2000;
    const near = addEnemy(w, cx + 10, cy, 500);
    const far = addEnemy(w, cx + FILM_BURST_RADIUS + 50, cy, 500);
    const boss: Entity = { ...blankEntity('boss'), x: cx, y: cy, hp: 999, maxHp: 999 };
    w.entities.push(boss);
    onFilmBurst(w, cx, cy, burstParams());
    expect(near.hp).toBe(500 - (18 + 4 * 3));
    expect(far.hp).toBe(500);
    expect(boss.hp).toBe(999); // 보스 제외 — `blastDamage` 를 재사용하지 않은 이유
  });

  it('PO3 거품 산탄 파열 — 탄수 6 + floor(Lv/3)', () => {
    const w = mk([[PO3, 9]]);
    const p = player(w);
    const before = countBullets(w);
    onFilmBurst(w, p.x, p.y, burstParams());
    expect(countBullets(w) - before).toBe(6 + 3);
  });

  it('PO7 정전 파열 — 주변 잡몹에 전격 연쇄(12 + 3×Lv)', () => {
    const w = mk([[PO7, 4]]);
    const p = player(w);
    const foe = addEnemy(w, p.x + 30, p.y, 500);
    onFilmBurst(w, p.x, p.y, burstParams());
    expect(foe.hp).toBe(500 - (12 + 3 * 4));
  });

  it('DR1 역류 수거 — 반경 술어는 **파열 중심**, 목적지는 **플레이어**', () => {
    const w = mk([[DR1, 1]]);
    const p = player(w);
    // 파열 중심을 플레이어에서 멀리 둔다 — 둘이 같으면 "중심 기준"인지 "플레이어 기준"인지
    // 구분되지 않고, 젬이 이미 픽업·자석 반경 안이라 배선을 끊어도 통과한다(항진 방지).
    const cx = p.x + 2000;
    const cy = p.y + 2000;
    const radius = FILM_BURST_RADIUS * 1.08; // Lv1 = 220 × (100% + 8%p) = 237.6
    const inside = addGem(w, cx + radius - 30, cy);
    const outside = addGem(w, cx + radius + 30, cy);
    const outX = outside.x;
    onFilmBurst(w, cx, cy, burstParams());
    expect(inside.x).toBe(p.x);
    expect(inside.y).toBe(p.y);
    expect(inside.vx).toBe(0); // 잔여 자석 속도 소거
    expect(outside.x).toBe(outX); // 반경 밖은 한 칸도 안 움직인다
  });

  it('DR1 — 수거 반경이 레벨에 비례해 늘어난다 (Lv1 = 1.08배 · Lv20 = 2.6배)', () => {
    /** `cx` 에서 `d` 만큼 떨어진 젬이 걷혔는가. */
    function pulled(level: number, d: number): boolean {
      const w = mk([[DR1, level]]);
      const p = player(w);
      const cx = p.x + 2000;
      const cy = p.y + 2000;
      const gem = addGem(w, cx + d, cy);
      onFilmBurst(w, cx, cy, burstParams());
      return gem.x === p.x && gem.y === p.y;
    }
    const mid = FILM_BURST_RADIUS * 2; // 440 — Lv1(237.6) 밖 · Lv20(572) 안
    expect(pulled(1, mid)).toBe(false);
    expect(pulled(20, mid)).toBe(true);
    // ⚠️ 부정 항목만 두면 배선이 끊겨도(전부 false) 성립한다 — 긍정 짝을 옆에 둔다.
    expect(pulled(1, FILM_BURST_RADIUS)).toBe(true); // 220 < 237.6
    expect(pulled(20, FILM_BURST_RADIUS * 3)).toBe(false); // 660 > 572 — 상한도 있다
  });

  it('DR1 — 미투자 런은 젬을 한 칸도 안 옮긴다', () => {
    const w = mk([[DR6, 5]]); // 다른 스킬만 찍어 `skillsOn` 은 참으로 만든다
    const p = player(w);
    const gem = addGem(w, p.x + 100, p.y + 100);
    onFilmBurst(w, p.x, p.y, burstParams());
    expect(gem.x).toBe(p.x + 100);
    expect(gem.y).toBe(p.y + 100);
  });

  it('DR6 파열 추진 — 대시 쿨다운 환급(30 + 5×Lv), **0 아래로 안 내려간다**', () => {
    const w = mk([[DR6, 2]]);
    const p = player(w);
    p.dashCooldown = 100;
    onFilmBurst(w, p.x, p.y, burstParams());
    expect(p.dashCooldown).toBe(100 - 40);
    p.dashCooldown = 5;
    onFilmBurst(w, p.x, p.y, burstParams());
    expect(p.dashCooldown).toBe(0); // 음수면 `dashCooldown === 0` 게이트가 영영 안 걸린다
  });

  it('FI1 조기 응결 — 재생 타이머가 선급값에서 시작한다(가산 아님, 점근 300 < 420)', () => {
    const w1 = mk([[FI1, 1]]);
    const p1 = player(w1);
    p1.aux1 = 999; // `film_lo` SUSTAIN 이 선지불해 둔 값을 흉내 낸다 — 대입이 이것을 지운다
    onFilmBurst(w1, p1.x, p1.y, burstParams());
    expect(p1.aux1).toBe(16); // round(300×1/19)

    const w20 = mk([[FI1, 20]]);
    const p20 = player(w20);
    onFilmBurst(w20, p20.x, p20.y, burstParams());
    expect(p20.aux1).toBe(158); // round(300×20/38) — 420 미만이라 즉시 재생 불가
  });

  it('FI5 파열 위상 — 무적 창이 `hitIframes + 6 + 2×Lv` 로 **max 갱신**된다', () => {
    const w = mk([[FI5, 5]]);
    const p = player(w);
    const want = w.config.hitIframes + 6 + 2 * 5;
    p.iframes = 0;
    onFilmBurst(w, p.x, p.y, burstParams());
    expect(p.iframes).toBe(want);
    // 이미 더 긴 무적이면 깎지 않는다(가산이었다면 여기서 want 만큼 늘어난다).
    p.iframes = want + 100;
    onFilmBurst(w, p.x, p.y, burstParams());
    expect(p.iframes).toBe(want + 100);
  });

  it('FI10 정화 파열 — 반경 안 적탄 소거 + 감속 해제', () => {
    const w = mk([[FI10, 2]]);
    const p = player(w);
    const radius = FILM_BURST_RADIUS + 15 * 2;
    const inside = addEnemyBullet(w, p.x + radius - 10, p.y);
    const outside = addEnemyBullet(w, p.x + radius + 50, p.y);
    w.playerSlowTicks = 60;
    onFilmBurst(w, p.x, p.y, burstParams());
    expect(inside.dead).toBe(true);
    expect(outside.dead).toBe(false);
    expect(w.playerSlowTicks).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 이음매 — `resolveFilmBurst` 가 실제로 앵커 ⑮ 를 태우는가
// ---------------------------------------------------------------------------

describe('⑤ filmBurst → skillHooks 이음매', () => {
  it('`resolveFilmBurst` 한 번이 밀어내기와 파열 훅을 **둘 다** 수행한다', () => {
    const w = mk([
      [PO1, 1],
      [FI1, 1],
    ]);
    const p = player(w);
    p.aux1 = 0;
    const foe = addEnemy(w, p.x + 30, p.y, 500);
    const x0 = foe.x;
    resolveFilmBurst(w, p.x, p.y);
    expect(foe.x).toBeGreaterThan(x0); // 밀어내기(기존 거동)
    expect(foe.hp).toBe(500 - 22); // PO1 파열 훅(이 레인)
    expect(p.aux1).toBe(16); // FI1 파열 훅(이 레인)
  });

  it('투자 0 런에서는 `resolveFilmBurst` 가 밀어내기만 한다 (거동 불변)', () => {
    const w = mk();
    const p = player(w);
    p.aux1 = 0;
    const foe = addEnemy(w, p.x + 30, p.y, 500);
    const x0 = foe.x;
    resolveFilmBurst(w, p.x, p.y);
    expect(foe.x).toBeGreaterThan(x0);
    expect(foe.hp).toBe(500);
    expect(p.aux1).toBe(0);
  });

  it('DR1 이 옮긴 젬은 **정본 픽업 경로**로 걷힌다 — 콤보·XP 가 함께 오른다', () => {
    // 이 테스트가 DR1 배선의 핵심 근거다. 스킬은 젬을 지우지 않고 좌표만 옮기므로,
    // "옮겼다" 만으로는 수확이 실제로 일어났는지 알 수 없다 — `stepWorld` 를 태워
    // `collectGem`(콤보·XP·촉매)이 그대로 도는 것을 확인한다.
    const w = mk([[DR1, 20]]);
    const p = player(w);
    // 자석 반경(420) **밖** · DR1 Lv20 반경(220 × 2.6 = 572) **안**. 자석 안에 두면
    // 배선을 끊어도 자석이 걷어 와 통과한다(항진).
    const gem = addGem(w, p.x + 500, p.y);
    const gems0 = w.gems;
    const xp0 = w.xp;
    resolveFilmBurst(w, p.x, p.y);
    for (let i = 0; i < 5; i++) stepWorld(w, emptyInput());
    expect(gem.dead).toBe(true);
    expect(w.gems).toBeGreaterThanOrEqual(gems0 + 1);
    expect(w.xp).toBeGreaterThan(xp0);
    expect(w.combo).toBeGreaterThanOrEqual(1);
  });

  it('DR1 미투자 대조 — 같은 자리 젬은 자석이 못 닿아 그대로 남는다', () => {
    const w = mk([[DR6, 5]]);
    const p = player(w);
    const gem = addGem(w, p.x + 500, p.y);
    const gems0 = w.gems;
    resolveFilmBurst(w, p.x, p.y);
    for (let i = 0; i < 5; i++) stepWorld(w, emptyInput());
    expect(gem.dead).toBe(false);
    expect(w.gems).toBe(gems0);
  });
});

// ---------------------------------------------------------------------------
// ⑥ 앵커 ⑯ — PO2 압력 전환 사출 · PO5 만재 투과
// ---------------------------------------------------------------------------

/**
 * 발칸(탄도 파라미터를 전부 읽는 아키타입)이 넘길 법한 한 벌. `ballisticsUsed: true`.
 * ⚠️ 읽기 전용 세 필드(`countUsed`·`ballisticsUsed`·`cloakBreak`)를 훅이 고치지 않는지도
 * 이 레코드로 함께 잰다.
 */
function volley(over: Partial<VolleyParams> = {}): VolleyParams {
  return {
    damage: 100,
    pierce: 1,
    count: 3,
    speed: 1800,
    radius: 8,
    life: 55,
    spread: 0.4,
    cooldownQ: 60,
    countUsed: true,
    ballisticsUsed: true,
    targetDist: 400,
    // 발사 방위(rad). 읽기 전용 사실이라 훅이 고치지 않는다 — 기본 0(순수 +x).
    aimAngle: 0,
    // W2 가 더한 칸 — 그 틱 이동 입력 벡터(읽기 전용). 기본은 무입력(정지).
    inputX: 0,
    inputY: 0,
    cloakBreak: false,
    mark: 0,
    leadDamageBonus: 0,
    leadPierceBonus: 0,
    recordSpawnDamage: false,
    ...over,
  };
}

describe('⑥ 볼리 파라미터 (앵커 ⑯)', () => {
  it('PO2 — 막이 서 있으면 기준 탄속(1800) 초과분의 20% + 2%p/Lv 가 피해로 전환된다', () => {
    const w = mk([[PO2, 5]]);
    const p = player(w);
    p.aux0 = 1; // 막이 한 점이라도 남아 있으면 켜진다(만재 요구는 PO5 쪽)
    const v = volley({ speed: 3600 }); // 초과분 = +10000bp
    onVolleyParams(w, p, v);
    // 전환율 3000bp × 초과 10000bp = 피해 +3000bp
    expect(v.damage).toBeCloseTo(130, 9);
    expect(v.speed).toBe(3600); // 탄속은 대가로 깎지 않는다(설계서: 전환이지 교환이 아니다)
  });

  it('PO2 — **막이 없으면 꺼진다** · 기준 탄속 이하에서도 꺼진다', () => {
    const w = mk([[PO2, 20]]);
    const p = player(w);
    p.aux0 = 0;
    const off = volley({ speed: 5400 });
    onVolleyParams(w, p, off);
    expect(off.damage).toBe(100);

    p.aux0 = FILM_ABSORB_FLAT;
    const slow = volley({ speed: 1500 }); // 초과분이 음수 → 피해를 **깎지 않는다**
    onVolleyParams(w, p, slow);
    expect(slow.damage).toBe(100);
  });

  it('PO2 — 빔(`ballisticsUsed: false`)에서는 통째로 꺼진다 (대가 없는 순이득 차단)', () => {
    const w = mk([[PO2, 20]]);
    const p = player(w);
    p.aux0 = FILM_ABSORB_FLAT;
    const beam = volley({ speed: 5400, ballisticsUsed: false, countUsed: false });
    onVolleyParams(w, p, beam);
    expect(beam.damage).toBe(100);
  });

  it('PO5 — **만재**인 동안 관통 +1 · 피해 +6% + 1.5%p/Lv', () => {
    const w = mk([[PO5, 4]]);
    const p = player(w);
    p.aux0 = FILM_ABSORB_FLAT;
    const v = volley();
    onVolleyParams(w, p, v);
    expect(v.pierce).toBe(2);
    expect(v.damage).toBeCloseTo(112, 9); // 100 × 11200/10000
  });

  it('PO5 — 만재가 아니면(첫 피격이 깬 뒤) 꺼진다 — 내장 억제', () => {
    const w = mk([[PO5, 20]]);
    const p = player(w);
    p.aux0 = FILM_ABSORB_FLAT - 1;
    const v = volley();
    onVolleyParams(w, p, v);
    expect(v.pierce).toBe(1);
    expect(v.damage).toBe(100);
  });

  it('PO5 — 빔에서는 관통 가산만 빠지고 피해 보정은 남는다 (부호 반전 없음)', () => {
    const w = mk([[PO5, 4]]);
    const p = player(w);
    p.aux0 = FILM_ABSORB_FLAT;
    const beam = volley({ ballisticsUsed: false, countUsed: false });
    onVolleyParams(w, p, beam);
    expect(beam.pierce).toBe(1);
    expect(beam.damage).toBeCloseTo(112, 9);
  });

  it('**다른 스킬만 찍은 런**에서는 ⑯ 이 한 필드도 안 건드린다', () => {
    const w = mk([[FI2, 20]]);
    const p = player(w);
    p.aux0 = FILM_ABSORB_FLAT;
    const v = volley({ speed: 5400 });
    onVolleyParams(w, p, v);
    expect(v).toEqual(volley({ speed: 5400 }));
  });
});

// ---------------------------------------------------------------------------
// ⑦ 앵커 ⑱ — FI3 반사 응막 · FI4 압력 배출
// ---------------------------------------------------------------------------

describe('⑦ 막 흡수 직후 (앵커 ⑱)', () => {
  it('FI3 — 흡수한 틱에 반경 80 + 8×Lv 안의 적탄이 소거된다', () => {
    const w = mk([[FI3, 2]]);
    const p = player(w);
    p.aux0 = 20;
    const radius = 80 + 8 * 2;
    const inside = addEnemyBullet(w, p.x + radius - 10, p.y);
    const outside = addEnemyBullet(w, p.x + radius + 50, p.y);
    onFilmAbsorbed(w, p, 10, 0);
    expect(inside.dead).toBe(true);
    expect(outside.dead).toBe(false);
  });

  it('FI3 — 막이 한 점도 안 닳은 피격(`absorbed === 0`)에는 안 걸린다', () => {
    const w = mk([[FI3, 20]]);
    const p = player(w);
    p.aux0 = 20;
    const shot = addEnemyBullet(w, p.x + 10, p.y);
    onFilmAbsorbed(w, p, 0, 5);
    expect(shot.dead).toBe(false);
  });

  it('FI4 — 흡수량 × (1.2 + 0.15×Lv) 만큼 반경 120 안 잡몹을 민다', () => {
    const w = mk([[FI4, 2]]);
    const p = player(w);
    p.aux0 = 20;
    const near = addEnemy(w, p.x + 50, p.y, 500);
    const far = addEnemy(w, p.x + 300, p.y, 500);
    const farX0 = far.x;
    onFilmAbsorbed(w, p, 10, 0);
    // 변위 = 10 × 1.5 = 15 (방향은 플레이어 → 적)
    expect(near.x).toBeCloseTo(p.x + 65, 6);
    expect(far.x).toBe(farX0); // 반경 120 밖
  });

  it('FI4 — 흡수량에 비례한다 (같은 레벨에서 흡수 2배 = 변위 2배)', () => {
    const w = mk([[FI4, 8]]);
    const p = player(w);
    p.aux0 = 20;
    const a = addEnemy(w, p.x + 50, p.y, 500);
    onFilmAbsorbed(w, p, 5, 0);
    const d1 = a.x - (p.x + 50);
    const b = addEnemy(w, p.x + 50, p.y, 500);
    onFilmAbsorbed(w, p, 10, 0);
    const d2 = b.x - (p.x + 50);
    // ⚠️ 하한을 먼저 못 박는다 — 배선이 끊기면 `d1 = d2 = 0` 이라 비례식만으로는 **항진**이다
    //    (뮤테이션 실측: 이 줄이 없을 때 case 를 지워도 이 항목만 초록으로 남았다).
    expect(d1).toBeGreaterThan(0);
    expect(d2).toBeCloseTo(d1 * 2, 6);
  });

  it('FI4 — **파열하는 틱(`aux0 === 0`)에는 밀지 않는다** — 파열 훅의 반경 술어를 비우지 않기 위해', () => {
    const w = mk([[FI4, 20]]);
    const p = player(w);
    p.aux0 = 0; // 이번 흡수로 막이 소진됐다 = 곧 `resolveFilmBurst` 가 돈다
    const foe = addEnemy(w, p.x + 50, p.y, 500);
    const x0 = foe.x;
    onFilmAbsorbed(w, p, FILM_ABSORB_FLAT, 0);
    expect(foe.x).toBe(x0);
  });

  it('FI4 — 잡몹만 민다 (보스·구조물 제외)', () => {
    const w = mk([[FI4, 20]]);
    const p = player(w);
    p.aux0 = 20;
    const boss: Entity = { ...blankEntity('boss'), x: p.x + 50, y: p.y, hp: 999, maxHp: 999 };
    w.entities.push(boss);
    onFilmAbsorbed(w, p, 30, 0);
    expect(boss.x).toBe(p.x + 50);
  });

  it('**다른 스킬만 찍은 런**에서는 ⑱ 이 아무것도 안 한다', () => {
    const w = mk([[FI2, 20]]);
    const p = player(w);
    p.aux0 = 20;
    const shot = addEnemyBullet(w, p.x + 10, p.y);
    const foe = addEnemy(w, p.x + 50, p.y, 500);
    const x0 = foe.x;
    onFilmAbsorbed(w, p, 30, 0);
    expect(shot.dead).toBe(false);
    expect(foe.x).toBe(x0);
  });
});

// ---------------------------------------------------------------------------
// ⑧ 막 진입 술어 직전 (앵커 ㉒) — FI9 최후의 거품
// ---------------------------------------------------------------------------
//
// ⚠️ **이 절만 게이트 밖을 잰다.** ⑰⑱ 은 호출부 게이트(`aux0 > 0`) 안이라 *막이 없는* 피격을
// 원리적으로 못 본다 — FI9 가 배선되지 못하고 있던 사유가 그것이고, ㉒ 는 그 게이트 **앞**이다.
//
// ## 생존을 어떻게 재는가
// ㉒ 는 `aux0` 을 세우기만 한다 — 흡수는 바로 다음 줄의 기존 코드가 한다. 그래서 이 절은
// 세운 내구를 **world 가 쓰는 그 순수 함수**(`filmAbsorbed`/`filmRemainingDamage`)에 그대로
// 통과시켜 "선체로 가는 피해가 0 이 되어 살아남는다" 를 잰다 — 산술을 재구현하지 않는다.
// world 가 이 훅을 실제로 부르는가(이음매)는 `skillAnchors.test.ts` 가 호출 1회로 못 박는다.
//
// ## 뮤테이션으로 계측기를 검사했다 (2026-08-07)
// 앵커 ㉒ 의 `case SIG_BUBBLE_FILM:` 본문 호출(`bubbleFilmEntry`)을 지우면 **양성 4항목이
// 실패**한다(막이 선다+생존 · 레벨 단조 · 두 번째 치명의 긍정 짝 · 만재 상한). 실측이다.
// 부정 항목(무연산을 기대하는 것들)은 원리적으로 뮤테이션에 안 걸린다 — 그래서 짝이 되는
// 긍정 항목을 같은 절에 뒀고, 대조군(미투자)도 그 자체로는 안 걸린다는 것을 알고 둔다.

describe('⑧ FI9 최후의 거품 (앵커 ㉒)', () => {
  /** 막 없음 + 이 피해로 죽는 상황. `aux1` = 재생 진행분(마지막 파열 이후 경과 틱). */
  function lethal(w: WorldState, regenTicks: number): Entity {
    const p = player(w);
    p.aux0 = 0;
    p.aux1 = regenTicks;
    p.hp = 30;
    return p;
  }

  it('**막이 없는 치명 피격에서 막이 서고 살아남는다** — Lv20 · 진행분 210틱', () => {
    const w = mk([[FI9, 20]]);
    const p = lethal(w, 210);
    onFilmEntry(w, p, 30);
    // ⚠️ 하한 먼저 — 배선이 끊기면 아래 생존 단언이 0 대 0 으로 성립하는 항진이 된다.
    expect(p.aux0).toBeGreaterThan(0);
    // floor(210×60/420) = 30 → floor(30 × 12000bp) = 36
    expect(p.aux0).toBe(36);
    expect(p.aux1).toBe(0); // 대가 — 재생 진행분 전액 소모
    // 생존 — 선체로 가는 피해가 0 이라 hp 가 한 점도 안 깎인다.
    expect(filmAbsorbed(30, p.aux0, FILM_EFFICIENCY_BASE_BP)).toBe(30);
    expect(filmRemainingDamage(30, p.aux0, FILM_EFFICIENCY_BASE_BP)).toBe(0);
    expect(p.hp - filmRemainingDamage(30, p.aux0, FILM_EFFICIENCY_BASE_BP)).toBeGreaterThan(0);
  });

  it('**대조군: 미투자 런은 같은 피격에서 죽는다**', () => {
    const w = mk();
    const p = lethal(w, 210);
    onFilmEntry(w, p, 30);
    expect(p.aux0).toBe(0);
    expect(p.aux1).toBe(210); // 대가도 안 치른다
    expect(p.hp - filmRemainingDamage(30, p.aux0, FILM_EFFICIENCY_BASE_BP)).toBeLessThanOrEqual(0);
  });

  it('투자 레벨이 높을수록 비상막이 두껍다 (하한 짝 포함)', () => {
    const shieldAt = (level: number): number => {
      const w = mk([[FI9, level]]);
      const p = lethal(w, 210);
      onFilmEntry(w, p, 30);
      return p.aux0;
    };
    const s1 = shieldAt(1);
    const s10 = shieldAt(10);
    const s20 = shieldAt(20);
    // ⚠️ 하한 — 셋 다 0 이어도 단조는 성립한다(FI4 에서 실제로 밟은 항진).
    expect(s1).toBeGreaterThan(0);
    expect(s1).toBe(18); // 30 × 6300bp
    expect(s10).toBe(27); // 30 × 9000bp
    expect(s20).toBe(36); // 30 × 12000bp
    expect(s10).toBeGreaterThan(s1);
    expect(s20).toBeGreaterThan(s10);
  });

  it('**막이 이미 서 있는 피격은 종전 거동** — ㉒ 는 그 경우에도 불린다', () => {
    const w = mk([[FI9, 20]]);
    const p = lethal(w, 210);
    p.aux0 = 10;
    onFilmEntry(w, p, 30);
    expect(p.aux0).toBe(10);
    expect(p.aux1).toBe(210);
  });

  it('**치명이 아닌 피격에는 안 선다**', () => {
    const w = mk([[FI9, 20]]);
    const p = lethal(w, 210);
    p.hp = 1000;
    onFilmEntry(w, p, 30);
    expect(p.aux0).toBe(0);
    expect(p.aux1).toBe(210);
  });

  it('내구가 0 으로 떨어지면 **`aux1` 을 태우지 않는다** (대가만 치르는 손해 방지)', () => {
    const w = mk([[FI9, 20]]);
    const p = lethal(w, 5); // floor(5×60/420) = 0
    onFilmEntry(w, p, 30);
    expect(p.aux0).toBe(0);
    expect(p.aux1).toBe(5);
  });

  it('**두 번째 치명에는 안 선다** — 진행분을 다 태웠기 때문이다 (첫 번째는 선다)', () => {
    const w = mk([[FI9, 20]]);
    const p = lethal(w, 210);
    onFilmEntry(w, p, 30);
    expect(p.aux0).toBeGreaterThan(0); // 긍정 짝
    // 세운 막이 이 피격으로 소진됐다고 두고 다시 치명을 받는다.
    p.aux0 = 0;
    onFilmEntry(w, p, 30);
    expect(p.aux0).toBe(0);
    expect(p.aux1).toBe(0);
  });

  it('**만재를 넘기지 않는다** — `aux0 ≤ FILM_ABSORB_FLAT` 엔진 불변식이 산식을 이긴다', () => {
    const w = mk([[FI9, 20]]);
    const p = lethal(w, FILM_PERIOD_TICKS - 1); // floor(419×60/420)=59 → ×1.2 = 70
    onFilmEntry(w, p, 30);
    expect(p.aux0).toBe(FILM_ABSORB_FLAT);
  });

  it('**`aux0` 은 언제나 비음 정수**다 — u32 폴드 발산을 원천 차단한다', () => {
    for (const level of [0, 1, 5, 13, 20]) {
      for (const ticks of [0, 1, 5, 7, 209, 210, 419, FILM_PERIOD_TICKS]) {
        const w = mk(level > 0 ? [[FI9, level]] : []);
        const p = lethal(w, ticks);
        onFilmEntry(w, p, 30);
        expect(Number.isInteger(p.aux0)).toBe(true);
        expect(p.aux0).toBeGreaterThanOrEqual(0);
        expect(p.aux0).toBeLessThanOrEqual(FILM_ABSORB_FLAT);
        expect(Number.isInteger(p.aux1)).toBe(true);
        expect(p.aux1).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('**다른 스킬만 찍은 런**에서는 ㉒ 가 아무것도 안 한다', () => {
    const w = mk([[FI2, 20]]);
    const p = lethal(w, 210);
    onFilmEntry(w, p, 30);
    expect(p.aux0).toBe(0);
    expect(p.aux1).toBe(210);
  });
});

// ---------------------------------------------------------------------------
// ⑨ FI8 발수 코팅 (앵커 ⑰) — **되살아난 앵커**
// ---------------------------------------------------------------------------
//
// ⚠️ 앵커 ⑰ 은 한 배치 동안 **원리적으로 무효**였다. 사유를 지우지 않는다:
// 훅이 *유효 내구*를 돌려주는 계약이었고 `filmAbsorbed = min(dmg, shield)` 였으므로
// **흡수량 ≡ 내구 소모량**이었다. 내구를 부풀려도 (a) `dmg ≤ aux0` 이면 흡수량이 그대로거나
// (b) `dmg > aux0` 이면 `aux0` 이 음수가 되어 u32 폴드가 발산했다. 그 앵커가 살린 스킬은 0종.
// 순수 함수 개정 레인이 **효율 인자**를 넣어 *태운 내구*와 *막은 피해*를 분리했고, 이 절이
// "min 이 개입을 더 이상 삼키지 않는다" 를 실측으로 못 박는다.

describe('⑨ FI8 발수 코팅 (앵커 ⑰) — 되살아난 앵커', () => {
  it('⚠️ 되살아남 증명 — 효율을 올리면 **막은 피해**가 실제로 늘어난다', () => {
    // 내구 60, 피해 100. 항등 효율에서는 60 만 막고 40 이 통과한다(종전 결과 그대로).
    expect(filmAbsorbed(100, 60, FILM_EFFICIENCY_BASE_BP)).toBe(60);
    expect(filmRemainingDamage(100, 60, FILM_EFFICIENCY_BASE_BP)).toBe(40);
    // 효율 200% → 같은 내구 60 이 120 까지 막는다. 통과 피해가 **실제로** 0 이 된다.
    expect(filmRemainingDamage(100, 60, 20000)).toBe(0);
    // 그리고 **태운 내구는 독립적으로** 50 이다(60 이 아니다) — 두 축이 갈렸다는 물증.
    expect(filmAbsorbed(100, 60, 20000)).toBe(50);
  });

  it('두 축이 각각 독립적으로 움직인다 (막은 피해 ↑ · 태운 내구 =)', () => {
    // 피해 150 > 용량 120 → 막이 소진된다. 태운 내구는 양쪽 다 전량 60 이지만…
    expect(filmAbsorbed(150, 60, FILM_EFFICIENCY_BASE_BP)).toBe(60);
    expect(filmAbsorbed(150, 60, 20000)).toBe(60);
    // …막은 피해는 60 → 120 으로 갈린다(통과 피해 90 → 30).
    expect(filmRemainingDamage(150, 60, FILM_EFFICIENCY_BASE_BP)).toBe(90);
    expect(filmRemainingDamage(150, 60, 20000)).toBe(30);
  });

  it('⚠️ `aux0` 음수 경로가 없다 — 태운 내구는 어떤 효율에서도 내구를 넘지 않는다', () => {
    for (const eff of [1, 100, 5000, 9999, 10000, 10001, 20000, 40000, 999_999]) {
      for (const s of [1, 7, 60, 137]) {
        for (const d of [0, 1, 13, 60, 100, 1000, 100_000]) {
          const burned = filmAbsorbed(d, s, eff);
          expect(Number.isInteger(burned), `eff=${eff} s=${s} d=${d} → ${burned}`).toBe(true);
          expect(burned).toBeGreaterThanOrEqual(0);
          expect(burned).toBeLessThanOrEqual(s);
          const rest = filmRemainingDamage(d, s, eff);
          expect(Number.isInteger(rest)).toBe(true);
          expect(rest).toBeGreaterThanOrEqual(0);
          expect(rest).toBeLessThanOrEqual(d);
          // 내구가 남았는데(태운 내구 < 전량) 피해가 통과하는 일은 없다 — 그런 상태는
          // "막을 힘은 없는데 파열도 안 하는 유령 막" 이라 파열 판정(`aux0 === 0`)이 어긋난다.
          // ⚠️ `burned > 0` 조건이 필요하다: 효율이 극히 낮아 용량이 0 으로 접히면(예: eff=1)
          //    막이 애초에 아무것도 못 막으므로 태운 내구도 0 이고 전량 통과가 옳다.
          if (burned > 0 && burned < s) expect(rest).toBe(0);
        }
      }
    }
  });

  it('양성 — FI8 투자 + 해저드 피격이면 효율이 오른다', () => {
    const w = mk([[FI8, 20]]);
    const p = player(w);
    p.aux0 = 60;
    // 200% + 10%p/Lv → Lv20 = 40000bp.
    expect(onFilmEfficiency(w, p, 100, p.aux0, true)).toBe(40000);
  });

  it('음성 ① — 같은 런이라도 해저드가 아니면 항등이다 (설계축이 "해저드에서만")', () => {
    const w = mk([[FI8, 20]]);
    const p = player(w);
    p.aux0 = 60;
    expect(onFilmEfficiency(w, p, 100, p.aux0, false)).toBe(FILM_EFFICIENCY_BASE_BP);
  });

  it('음성 ② — 다른 스킬만 찍은 런은 해저드 피격에도 항등이다', () => {
    const w = mk([[FI2, 20]]);
    const p = player(w);
    p.aux0 = 60;
    expect(onFilmEfficiency(w, p, 100, p.aux0, true)).toBe(FILM_EFFICIENCY_BASE_BP);
  });

  it('레벨 단조 — 하한 짝 포함', () => {
    const at = (level: number): number => {
      const w = mk([[FI8, level]]);
      const p = player(w);
      p.aux0 = 60;
      return onFilmEfficiency(w, p, 100, p.aux0, true);
    };
    // 하한 먼저 — 배선이 끊기면 아래 단조가 10000 대 10000 으로 성립하는 항진이 된다.
    expect(at(1)).toBeGreaterThan(FILM_EFFICIENCY_BASE_BP);
    expect(at(1)).toBe(21000);
    expect(at(20)).toBeGreaterThan(at(1));
  });

  it('⚠️ 엔진 경로 — 해저드 피격에서 막이 **실제로 덜 닳는다**', () => {
    const burnedBy = (pts: ReadonlyArray<readonly [number, number]>): number => {
      const w = mk(pts);
      const p = player(w);
      p.aux0 = 60; // 막이 서 있다
      p.hp = 100_000;
      const hz: Entity = {
        ...blankEntity('hazard'),
        x: p.x,
        y: p.y,
        radius: 60,
        damage: 20,
        timer: 0,
        life: -1, // 영구 지형 해저드 = 항상 활성
      };
      w.entities.push(hz);
      stepWorld(w, emptyInput());
      return 60 - p.aux0;
    };
    const base = burnedBy([[FI2, 20]]);
    // 하한 먼저 — "막이 실제로 닳았다" 를 못 박지 않으면 아래 비교가 0 대 0 항진이 된다.
    expect(base).toBeGreaterThan(0);
    // FI8 Lv20 = 효율 400% → 같은 해저드 피해를 1/4 내구로 막는다.
    expect(burnedBy([[FI8, 20]])).toBeLessThan(base);
  });
});

// ---------------------------------------------------------------------------
// PO1 파열 탄두 사망 마킹 — 좀비 결함
// ---------------------------------------------------------------------------

/**
 * `compact()`(`world.ts`)는 **`e.dead === true` 만 수거**한다 — `hp <= 0` 단독으로는 안 걷는다.
 * PO1 은 `e.hp -=` 만 했으므로 파열 폭발로만 hp≤0 이 된 적이 **좀비**로 남았다: 계속 움직이고
 * 공격하며 `state.kills`·젬·전리품이 전부 사라진다. 정본 형태는 `status.ts` 111-112 의 두 줄이다.
 *
 * ⚠️ **계측기 함정** — 파열 중심을 플레이어 근처에 두면 자동사격 탄(≈30px/tick)이 같은 틱에
 * 마무리해 수정 전에도 통과한다. 그래서 파열 중심을 플레이어에서 2000px 떼어 사망 경로를
 * PO1 하나로 좁힌다. **PO1 만 투자**하는 것도 같은 이유다(PO3 산탄·PO7 연쇄 배제).
 *
 * ⚠️ **보스는 대상이 아니다** — PO1 은 `kind !== 'enemy'` 를 걸러낸다(설계서 PO1 본체와 ④ 침공
 * 판정표가 enemy 한정을 명시). `blastDamageAt`(enemy+boss)과 대상 집합이 다른 것이 그 이유다.
 */
describe('PO1 사망 마킹 (좀비 결함)', () => {
  /** 자동사격 탄이 1틱에 못 닿는 거리 — 사망 경로를 PO1 하나로 좁히는 장치. */
  const AWAY = 2000;

  it('전제 — 파열 반경 안의 적이 실제로 맞고 hp 가 줄어든다 (하한)', () => {
    const w = mk([[PO1, 10]]);
    const p = player(w);
    const cx = p.x + AWAY;
    const cy = p.y + AWAY;
    const e = addEnemy(w, cx + 10, cy, 500);
    expect(Math.hypot(e.x - cx, e.y - cy)).toBeLessThanOrEqual(FILM_BURST_RADIUS);
    onFilmBurst(w, cx, cy, burstParams());
    expect(e.hp).toBe(500 - (18 + 4 * 10));
    expect(e.hp).toBeGreaterThan(0); // 이 케이스는 죽이지 않는다
  });

  it('재현 — PO1 만으로 hp≤0 이 되면 그 자리에서 dead 로 마킹된다', () => {
    const w = mk([[PO1, 10]]);
    const p = player(w);
    const cx = p.x + AWAY;
    const cy = p.y + AWAY;
    const e = addEnemy(w, cx + 10, cy, 10);
    expect(e.dead).toBe(false);
    onFilmBurst(w, cx, cy, burstParams());
    expect(e.hp).toBeLessThanOrEqual(0); // 실제로 죽을 만큼 맞았다 (하한)
    expect(e.dead).toBe(true);
  });

  it('재현 — 다음 stepWorld 에서 수거되고 처치·젬으로 집계된다 (좀비로 안 남는다)', () => {
    const w = mk([[PO1, 10]]);
    const p = player(w);
    const cx = p.x + AWAY;
    const cy = p.y + AWAY;
    const e = addEnemy(w, cx + 10, cy, 10);
    const id = e.id;
    const gx = e.x;
    const gy = e.y;
    const killsBefore = w.kills;
    onFilmBurst(w, cx, cy, burstParams());
    expect(e.hp).toBeLessThanOrEqual(0);
    stepWorld(w, emptyInput());
    // 엔티티 동일성으로 본다 — 같은 틱에 다른 적이 죽어도 이 단언은 안 흔들린다.
    expect(w.entities.some((x) => x.id === id)).toBe(false);
    expect(w.kills).toBeGreaterThanOrEqual(killsBefore + 1);
    const gems = w.entities.filter(
      (x) => x.kind === 'gem' && Math.hypot(x.x - gx, x.y - gy) <= 200,
    );
    expect(gems.length).toBeGreaterThanOrEqual(1);
  });

  it('회귀 — 안 죽인 적은 종전 그대로 살아 있다', () => {
    const w = mk([[PO1, 10]]);
    const p = player(w);
    const cx = p.x + AWAY;
    const cy = p.y + AWAY;
    const e = addEnemy(w, cx + 10, cy, 500);
    const killsBefore = w.kills;
    onFilmBurst(w, cx, cy, burstParams());
    expect(e.hp).toBe(500 - 58); // 실제로 맞았다 (하한)
    expect(e.dead).toBe(false);
    stepWorld(w, emptyInput());
    expect(w.entities.some((x) => x.id === e.id)).toBe(true);
    expect(w.kills).toBe(killsBefore);
  });

  it('회귀 — 반경 밖 적과 보스는 hp 도 안 줄고 dead 도 안 선다', () => {
    const w = mk([[PO1, 10]]);
    const p = player(w);
    const cx = p.x + AWAY;
    const cy = p.y + AWAY;
    const far = addEnemy(w, cx + FILM_BURST_RADIUS + 50, cy, 10);
    const boss: Entity = { ...blankEntity('boss'), x: cx, y: cy, hp: 10, maxHp: 10 };
    w.entities.push(boss);
    onFilmBurst(w, cx, cy, burstParams());
    expect(far.hp).toBe(10);
    expect(far.dead).toBe(false);
    expect(boss.hp).toBe(10); // 보스 제외 — `blastDamage` 를 재사용하지 않은 이유
    expect(boss.dead).toBe(false);
  });

  it('음성 대조 — PO1 미투자면 hp 도 안 줄고 dead 도 안 선다', () => {
    const w = mk([]);
    const p = player(w);
    const cx = p.x + AWAY;
    const cy = p.y + AWAY;
    const e = addEnemy(w, cx + 10, cy, 10);
    onFilmBurst(w, cx, cy, burstParams());
    expect(e.hp).toBe(10);
    expect(e.dead).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ⑩ 액티브 발동 직후 (앵커 ㉗) — PO9 고압 격발 조율 · DR9 이탈 잔파동
// ---------------------------------------------------------------------------
//
// ## 뮤테이션으로 계측기를 검사했다 (2026-08-07 · 배치5)
// 앵커 ㉗ 의 `case SIG_BUBBLE_FILM:` 본문 호출(`bubbleActiveFired`)을 지우면 **양성 6항목이
// 실패**한다(PO9 Lv1 추가탄 · PO9 Lv 단조 · DR9 밀어내기 · DR9 적탄 소거 · DR9 막 보정 반경 ·
// DR9 계열 게이트의 긍정 짝). 부정 항목("안 쏜다"·"파열이 아니다")은 원리적으로 안 걸리므로
// 전부 긍정 짝을 같은 절에 뒀다.

describe('⑩ 액티브 발동 직후 (앵커 ㉗)', () => {
  const POP_LO = BUBBLE_ACTIVES[0];
  const POP_HI = BUBBLE_ACTIVES[1];
  const DRIFT_LO = BUBBLE_ACTIVES[2];
  const RIGHT = { x: 1, y: 0 };

  /** 핸들러가 이미 돈 뒤의 스냅샷. `preAux0` = 핸들러가 비우기 전의 막 내구. */
  function origin(w: WorldState, preAux0: number, preX: number, preY: number): ActiveFiredOrigin {
    return { preX, preY, preAux0, spawnWatermark: w.entities.length };
  }

  it('PO9 — `pop_hi` 발동 뒤 환산 초과분만큼 탄이 **더** 난다 (Lv1 에서도 0 이 아니다)', () => {
    const w = mk([[PO9, 1]]);
    const p = player(w);
    const before = countBullets(w);
    // 만재(60) ÷ 분모(4) = 15발이 이미 나갔다는 전제. Lv1 = +5% → round(0.75) = 1발.
    onActiveFired(w, p, POP_HI, RIGHT, 0, origin(w, FILM_ABSORB_FLAT, p.x, p.y));
    expect(countBullets(w) - before).toBe(1);
  });

  it('PO9 — 레벨이 오르면 추가 탄수가 **엄격히** 는다 (하한부터 못 박는다)', () => {
    const lo = mk([[PO9, 1]]);
    const pl = player(lo);
    const b0 = countBullets(lo);
    onActiveFired(lo, pl, POP_HI, RIGHT, 0, origin(lo, FILM_ABSORB_FLAT, pl.x, pl.y));
    const dLo = countBullets(lo) - b0;

    const hi = mk([[PO9, 20]]);
    const ph = player(hi);
    const b1 = countBullets(hi);
    onActiveFired(hi, ph, POP_HI, RIGHT, 0, origin(hi, FILM_ABSORB_FLAT, ph.x, ph.y));
    const dHi = countBullets(hi) - b1;

    // ⚠️ 하한이 없으면 배선이 끊겨 둘 다 0 일 때 단조식이 성립한다(§⑦ FI4 가 실제로 밟았다).
    expect(dLo).toBeGreaterThan(0);
    expect(dHi).toBeGreaterThan(dLo);
    expect(dHi).toBe(4); // round(15 × 24%) — 총 8 + 15 + 4 = 27발
  });

  it('PO9 — 소모한 내구가 0 이면 추가분도 0 이다 (`preAux0` 을 실제로 읽는다)', () => {
    const w = mk([[PO9, 20]]);
    const p = player(w);
    const before = countBullets(w);
    onActiveFired(w, p, POP_HI, RIGHT, 0, origin(w, 0, p.x, p.y));
    expect(countBullets(w)).toBe(before);
  });

  it('PO9 — `pop_lo`·drift 계열에는 안 걸린다 (같은 런에서 `pop_hi` 는 걸린다)', () => {
    const w = mk([[PO9, 20]]);
    const p = player(w);
    const b0 = countBullets(w);
    onActiveFired(w, p, POP_LO, RIGHT, 0, origin(w, FILM_ABSORB_FLAT, p.x, p.y));
    onActiveFired(w, p, DRIFT_LO, RIGHT, 0, origin(w, FILM_ABSORB_FLAT, p.x, p.y));
    expect(countBullets(w)).toBe(b0); // 두 계열 다 무연산
    onActiveFired(w, p, POP_HI, RIGHT, 0, origin(w, FILM_ABSORB_FLAT, p.x, p.y));
    expect(countBullets(w)).toBeGreaterThan(b0); // 긍정 짝 — 게이트가 통째로 죽은 게 아니다
  });

  it('DR9 — **출발 지점**(착지점이 아니다) 둘레의 적을 밀고 적탄을 지운다', () => {
    const w = mk([[DR9, 1]]);
    const p = player(w);
    // 도약이 끝나 `player` 는 이미 착지점이다. 출발 지점은 300 떨어져 있다.
    const sx = p.x + 300;
    const sy = p.y;
    const foe = addEnemy(w, sx + 50, sy, 500); // 출발 지점 반경 108 안
    const shot = addEnemyBullet(w, sx + 40, sy);
    const near = addEnemy(w, p.x + 50, p.y, 500); // 착지점 둘레 — 잔파동 밖이어야 한다
    const nearX0 = near.x;
    onActiveFired(w, p, DRIFT_LO, RIGHT, 0, origin(w, 0, sx, sy));
    expect(foe.x).toBeCloseTo(sx + 50 + 90, 6); // 변위 90, 중심에서 바깥으로
    expect(shot.dead).toBe(true);
    expect(near.x).toBe(nearX0); // 기준점이 `player` 였다면 여기가 깨진다
  });

  it('DR9 — 막이 서 있으면 반경이 1.5배다 (무막 대조군과 짝)', () => {
    // 반경 base = 108. 130 은 무막이면 밖, 막이 서 있으면(×1.5 = 162) 안이다.
    const bare = mk([[DR9, 1]]);
    const pb = player(bare);
    pb.aux0 = 0;
    const sxb = pb.x + 400;
    const fb = addEnemy(bare, sxb + 130, pb.y, 500);
    onActiveFired(bare, pb, DRIFT_LO, RIGHT, 0, origin(bare, 0, sxb, pb.y));
    expect(fb.x).toBe(sxb + 130); // 무막 = 안 밀린다

    const filmed = mk([[DR9, 1]]);
    const pf = player(filmed);
    pf.aux0 = FILM_ABSORB_FLAT;
    const sxf = pf.x + 400;
    const ff = addEnemy(filmed, sxf + 130, pf.y, 500);
    onActiveFired(filmed, pf, DRIFT_LO, RIGHT, 0, origin(filmed, 0, sxf, pf.y));
    expect(ff.x).toBeCloseTo(sxf + 130 + 90, 6); // 막 있음 = 밀린다
  });

  it('DR9 — **파열이 아니다**: `aux0`·`aux1` 이 한 점도 안 변한다 (미는 것은 긍정 짝이 증명)', () => {
    const w = mk([[DR9, 20]]);
    const p = player(w);
    p.aux0 = 33;
    p.aux1 = 77;
    const sx = p.x + 400;
    const foe = addEnemy(w, sx + 20, p.y, 500);
    onActiveFired(w, p, DRIFT_LO, RIGHT, 0, origin(w, 33, sx, p.y));
    expect(foe.x).toBeGreaterThan(sx + 20); // 긍정 짝 — 훅이 실제로 돌았다
    expect(p.aux0).toBe(33);
    expect(p.aux1).toBe(77);
  });

  it('DR9 — pop 계열 액티브로는 잔파동이 안 난다 (drift 로는 난다)', () => {
    const w = mk([[DR9, 20]]);
    const p = player(w);
    const sx = p.x + 400;
    const a = addEnemy(w, sx + 20, p.y, 500);
    onActiveFired(w, p, POP_LO, RIGHT, 0, origin(w, 0, sx, p.y));
    expect(a.x).toBe(sx + 20);
    onActiveFired(w, p, DRIFT_LO, RIGHT, 0, origin(w, 0, sx, p.y));
    expect(a.x).toBeGreaterThan(sx + 20);
  });

  it('**다른 스킬만 찍은 런**에서는 ㉗ 이 아무것도 안 한다', () => {
    const w = mk([[FI2, 20]]);
    const p = player(w);
    const sx = p.x + 400;
    const foe = addEnemy(w, sx + 20, p.y, 500);
    const shot = addEnemyBullet(w, sx + 20, p.y);
    const b0 = countBullets(w);
    onActiveFired(w, p, POP_HI, RIGHT, 0, origin(w, FILM_ABSORB_FLAT, sx, p.y));
    onActiveFired(w, p, DRIFT_LO, RIGHT, 0, origin(w, FILM_ABSORB_FLAT, sx, p.y));
    expect(countBullets(w)).toBe(b0);
    expect(foe.x).toBe(sx + 20);
    expect(shot.dead).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ⑪ 젬 자석 파라미터 (앵커 ㉘) — DR5 무지개 공명 · DR10 공막 유속(흡인)
// ---------------------------------------------------------------------------
//
// ## 뮤테이션으로 계측기를 검사했다 (2026-08-07 · 배치5)
// 앵커 ㉘ 의 `case SIG_BUBBLE_FILM:` 본문 호출을 지우면 **양성 5항목이 실패**한다
// (DR5 반경 확대 · DR5 레벨 단조 · DR5 상한의 긍정 짝 · DR10 변위 · DR10 과다 변위 스냅).

describe('⑪ 젬 자석 파라미터 (앵커 ㉘)', () => {
  function magnet(radius: number): GemMagnetParams {
    return { radius, broodRadius: 0 };
  }

  it('DR5 — 콤보 스택에 비례해 반경이 커진다 (하한부터 못 박는다)', () => {
    const w = mk([[DR5, 20]]);
    w.combo = 10;
    const m = magnet(400);
    onGemMagnetParams(w, player(w), m);
    // 스택당 1.5% + 0.15%p/Lv → Lv20 = 4.5%/스택 · 10스택 = +45%.
    expect(m.radius).toBeGreaterThan(400); // 하한 — 배선이 끊기면 여기가 먼저 깨진다
    expect(m.radius).toBeCloseTo(580, 6);
  });

  it('DR5 — 콤보 0 이면 무연산이고, 콤보가 붙으면 커진다 (부정·긍정 짝)', () => {
    const w = mk([[DR5, 20]]);
    w.combo = 0;
    const zero = magnet(400);
    onGemMagnetParams(w, player(w), zero);
    expect(zero.radius).toBe(400);
    w.combo = 4;
    const some = magnet(400);
    onGemMagnetParams(w, player(w), some);
    expect(some.radius).toBeGreaterThan(400);
  });

  it('DR5 — 콤보 상한 10 을 넘겨도 더 안 커진다 (상한이 실제로 걸린다)', () => {
    const w = mk([[DR5, 20]]);
    w.combo = 10;
    const cap = magnet(400);
    onGemMagnetParams(w, player(w), cap);
    w.combo = 999;
    const over = magnet(400);
    onGemMagnetParams(w, player(w), over);
    expect(cap.radius).toBeGreaterThan(400); // 긍정 짝
    expect(over.radius).toBe(cap.radius);
  });

  it('DR10 — 막이 없는 동안 젬이 **추가로** 당겨진다 (막이 서 있으면 안 당겨진다)', () => {
    const w = mk([[DR10, 1]]);
    const p = player(w);
    const g = addGem(w, p.x + 200, p.y);
    g.vx = -1000; // 지난 틱 흡인 속도(엔진이 실어 둔 값) — 크기만 쓴다
    g.vy = 0;
    p.aux0 = 0;
    onGemMagnetParams(w, p, magnet(400));
    const step = (1000 * DT * (2000 + 300 * 1)) / 10000;
    expect(g.x).toBeCloseTo(p.x + 200 - step, 6);
    expect(step).toBeGreaterThan(0); // 하한 — DT·bp 가 0 이면 위 단언이 항진이다

    const filmed = mk([[DR10, 1]]);
    const pf = player(filmed);
    const gf = addGem(filmed, pf.x + 200, pf.y);
    gf.vx = -1000;
    pf.aux0 = FILM_ABSORB_FLAT;
    onGemMagnetParams(filmed, pf, magnet(400));
    expect(gf.x).toBe(pf.x + 200);
  });

  it('DR10 — 반경 밖 젬은 안 건드린다 (반경 안 젬은 건드린다)', () => {
    const w = mk([[DR10, 20]]);
    const p = player(w);
    const far = addGem(w, p.x + 500, p.y);
    far.vx = -1000;
    const near = addGem(w, p.x + 100, p.y);
    near.vx = -1000;
    p.aux0 = 0;
    onGemMagnetParams(w, p, magnet(400));
    expect(far.x).toBe(p.x + 500);
    expect(near.x).toBeLessThan(p.x + 100);
  });

  it('DR10 — 남은 거리보다 큰 변위는 플레이어 좌표로 **스냅**한다 (지나치지 않는다)', () => {
    const w = mk([[DR10, 20]]);
    const p = player(w);
    const g = addGem(w, p.x + 5, p.y);
    g.vx = -100000; // 남은 거리(5)를 훨씬 넘는 한 틱 변위
    p.aux0 = 0;
    onGemMagnetParams(w, p, magnet(400));
    expect(g.x).toBe(p.x);
    expect(g.y).toBe(p.y);
    expect(g.vx).toBe(0); // 잔여 속도도 지운다(DR1 과 같은 규율)
  });

  it('`broodRadius` 는 한 칸도 안 건드린다 (해츨링 NU1 의 자리다)', () => {
    const w = mk([[DR5, 20], [DR10, 20]]);
    w.combo = 10;
    const m = magnet(400);
    onGemMagnetParams(w, player(w), m);
    expect(m.broodRadius).toBe(0);
  });

  it('**다른 스킬만 찍은 런**에서는 ㉘ 이 아무것도 안 한다', () => {
    const w = mk([[FI2, 20]]);
    const p = player(w);
    w.combo = 10;
    const g = addGem(w, p.x + 100, p.y);
    g.vx = -1000;
    p.aux0 = 0;
    const m = magnet(400);
    onGemMagnetParams(w, p, m);
    expect(m.radius).toBe(400);
    expect(g.x).toBe(p.x + 100);
  });

  it('이음매 — `stepWorld` 한 틱이 DR5 로 넓힌 반경을 실제로 쓴다', () => {
    // 기본 반경 밖 · DR5(Lv20 · 10스택 = +45%) 안쪽에 젬을 둔다.
    function run(points: ReadonlyArray<readonly [number, number]>): number {
      const w = createWorld(4242, { ...bubbleConfig(), skillInvest: invest(points) });
      const p = player(w);
      w.combo = 10;
      const g = addGem(w, p.x + w.magnetRadius * 1.2, p.y);
      const x0 = g.x;
      stepWorld(w, emptyInput());
      return g.x - x0;
    }
    // 대조군: 자석 축이 아닌 스킬만 찍은 런 — 젬은 반경 밖이라 속도 0 · 좌표 불변.
    expect(run([[FI2, 20]])).toBe(0);
    // DR5 를 찍으면 같은 자리의 젬이 흡인된다(플레이어 쪽 = -x 방향).
    expect(run([[DR5, 20]])).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// ⑫ 재생 완료 틱의 견인 펄스 (앵커 ⑨) — DR10 나머지 절반
// ---------------------------------------------------------------------------
//
// ⚠️ 앵커 ⑨ 는 `stepShipSignature` 의 **기체 분기보다 앞**이라, 이 훅이 도는 시점에는 아직
// `aux1++` 도 `aux0 = FLAT` 도 일어나지 않았다. 그래서 술어가 "막이 섰다" 가 아니라
// **"이 틱에 선다"**(`aux0 === 0 && filmReady(aux1 + 1)`)다.

describe('⑫ DR10 견인 펄스 (앵커 ⑨)', () => {
  it('재생이 완료되는 그 틱에 자석 2배 반경의 젬을 한 번 끌어당긴다', () => {
    const w = mk([[DR10, 1]]);
    const p = player(w);
    p.aux0 = 0;
    p.aux1 = FILM_PERIOD_TICKS - 1; // 다음 증가로 막이 선다
    const g = addGem(w, p.x + 300, p.y);
    onSignatureStep(w, p, emptyInput());
    expect(g.x).toBeCloseTo(p.x + 300 - 66, 6); // 변위 = 60 + 6×1
  });

  it('완료 **직전** 틱에는 안 걸린다 (완료 틱의 긍정 짝과 같은 런)', () => {
    const w = mk([[DR10, 20]]);
    const p = player(w);
    p.aux0 = 0;
    p.aux1 = FILM_PERIOD_TICKS - 2;
    const g = addGem(w, p.x + 300, p.y);
    onSignatureStep(w, p, emptyInput());
    expect(g.x).toBe(p.x + 300);
    // 한 틱 더 진행한 상태를 만들면 같은 젬이 끌린다.
    p.aux1 = FILM_PERIOD_TICKS - 1;
    onSignatureStep(w, p, emptyInput());
    expect(g.x).toBeCloseTo(p.x + 300 - 180, 6); // 60 + 6×20
  });

  it('막이 서 있는 동안(재생이 안 도는 동안)에는 안 걸린다', () => {
    const w = mk([[DR10, 20]]);
    const p = player(w);
    p.aux0 = FILM_ABSORB_FLAT;
    p.aux1 = FILM_PERIOD_TICKS - 1;
    const g = addGem(w, p.x + 300, p.y);
    onSignatureStep(w, p, emptyInput());
    expect(g.x).toBe(p.x + 300);
  });

  it('자석 2배 반경 밖 젬은 안 걸린다 (안쪽 젬은 걸린다)', () => {
    const w = mk([[DR10, 20]]);
    const p = player(w);
    p.aux0 = 0;
    p.aux1 = FILM_PERIOD_TICKS - 1;
    const inside = addGem(w, p.x + w.magnetRadius, p.y);
    const outside = addGem(w, p.x + w.magnetRadius * 2 + 50, p.y);
    onSignatureStep(w, p, emptyInput());
    expect(inside.x).toBeLessThan(p.x + w.magnetRadius);
    expect(outside.x).toBe(p.x + w.magnetRadius * 2 + 50);
  });

  it('FI2 와 서로를 가리지 않는다 — 술어가 정반대인데 한 함수에 산다', () => {
    // FI2(막 있음·만재 아님)만 찍은 런에서 DR10 펄스가 돌면 안 되고, 그 반대도 같다.
    const w = mk([[FI2, 20], [DR10, 20]]);
    const p = player(w);
    // ① 막 있음 — FI2 는 돌고 DR10 펄스는 안 돈다.
    p.aux0 = 10;
    p.aux1 = FILM_PERIOD_TICKS - 1;
    w.tick = 0; // Lv20 주기 = 6 + floor(72/22) = 9 → tick 0 은 주기 틱
    const g1 = addGem(w, p.x + 200, p.y);
    onSignatureStep(w, p, emptyInput());
    expect(p.aux0).toBe(11); // FI2 가 돌았다
    expect(g1.x).toBe(p.x + 200); // DR10 펄스는 안 돌았다
    // ② 막 없음 — DR10 펄스는 돌고 FI2 는 안 돈다.
    p.aux0 = 0;
    const g2 = addGem(w, p.x + 200, p.y);
    onSignatureStep(w, p, emptyInput());
    expect(p.aux0).toBe(0); // FI2 는 0 인 막을 되살리지 않는다
    expect(g2.x).toBeLessThan(p.x + 200);
  });
});

// ---------------------------------------------------------------------------
// ⑬ 플레이어 이동 파라미터 (앵커 ㉙) — DR4 공막 경량화
// ---------------------------------------------------------------------------
//
// ## 뮤테이션으로 계측기를 검사했다 (2026-08-07 · 배치5)
// 앵커 ㉙ 의 `case SIG_BUBBLE_FILM:` 본문 호출을 지우면 **양성 3항목이 실패**한다
// (감속 면역 · 이속 배율 · `stepWorld` 이음매).

describe('⑬ DR4 공막 경량화 (앵커 ㉙)', () => {
  function move(slowTicks: number): PlayerMoveParams {
    return { speedMult: 1, slowTicks };
  }

  it('막이 없는 동안 감속 잔여 틱이 0 이 되고 이속 배율이 오른다', () => {
    const w = mk([[DR4, 20]]);
    const p = player(w);
    p.aux0 = 0;
    const m = move(30);
    onPlayerMoveParams(w, p, m);
    expect(m.slowTicks).toBe(0);
    expect(m.speedMult).toBeGreaterThan(1); // 하한
    expect(m.speedMult).toBeCloseTo(1.2, 6); // 4% + 0.8%p×20 = +20%
  });

  it('막이 서 있으면 둘 다 그대로다 (무막 긍정 짝과 같은 런)', () => {
    const w = mk([[DR4, 20]]);
    const p = player(w);
    p.aux0 = FILM_ABSORB_FLAT;
    const m = move(30);
    onPlayerMoveParams(w, p, m);
    expect(m.slowTicks).toBe(30);
    expect(m.speedMult).toBe(1);
    p.aux0 = 0;
    const bare = move(30);
    onPlayerMoveParams(w, p, bare);
    expect(bare.slowTicks).toBe(0);
    expect(bare.speedMult).toBeGreaterThan(1);
  });

  it('레벨이 오르면 배율이 엄격히 는다', () => {
    const lo = mk([[DR4, 1]]);
    player(lo).aux0 = 0;
    const a = move(0);
    onPlayerMoveParams(lo, player(lo), a);
    const hi = mk([[DR4, 20]]);
    player(hi).aux0 = 0;
    const b = move(0);
    onPlayerMoveParams(hi, player(hi), b);
    expect(a.speedMult).toBeGreaterThan(1);
    expect(b.speedMult).toBeGreaterThan(a.speedMult);
  });

  it('**다른 스킬만 찍은 런**에서는 ㉙ 이 아무것도 안 한다', () => {
    const w = mk([[FI2, 20]]);
    player(w).aux0 = 0;
    const m = move(30);
    onPlayerMoveParams(w, player(w), m);
    expect(m.slowTicks).toBe(30);
    expect(m.speedMult).toBe(1);
  });

  it('이음매 — `stepWorld` 한 틱이 감속 잔여 틱을 실제로 0 으로 되쓴다', () => {
    function run(points: ReadonlyArray<readonly [number, number]>): number {
      const w = createWorld(99, { ...bubbleConfig(), skillInvest: invest(points) });
      player(w).aux0 = 0;
      w.playerSlowTicks = 30;
      stepWorld(w, emptyInput());
      return w.playerSlowTicks;
    }
    expect(run([[FI2, 20]])).toBe(29); // 대조군 — 엔진이 1 깎는다
    expect(run([[DR4, 20]])).toBe(0); // DR4 — 훅이 0 으로 되쓰고 감산도 건너뛴다
  });
});
