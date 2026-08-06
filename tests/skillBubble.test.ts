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
  type VolleyParams,
} from '../src/sim/skillHooks.js';
import { resolveFilmBurst } from '../src/sim/filmBurst.js';
import {
  SIG_BUBBLE_FILM,
  FILM_ABSORB_FLAT,
  FILM_BURST_RADIUS,
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
const DR6 = 15;
const FI1 = 20;
const FI2 = 21;
const FI3 = 22;
const FI4 = 23;
const FI5 = 24;
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

function countBullets(state: WorldState): number {
  let n = 0;
  for (const e of state.entities) if (e.kind === 'bullet' && !e.dead) n++;
  return n;
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
    onFilmBurst(w, p.x, p.y);
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
    onFilmBurst(w, cx, cy);
    expect(near.hp).toBe(500 - (18 + 4 * 3));
    expect(far.hp).toBe(500);
    expect(boss.hp).toBe(999); // 보스 제외 — `blastDamage` 를 재사용하지 않은 이유
  });

  it('PO3 거품 산탄 파열 — 탄수 6 + floor(Lv/3)', () => {
    const w = mk([[PO3, 9]]);
    const p = player(w);
    const before = countBullets(w);
    onFilmBurst(w, p.x, p.y);
    expect(countBullets(w) - before).toBe(6 + 3);
  });

  it('PO7 정전 파열 — 주변 잡몹에 전격 연쇄(12 + 3×Lv)', () => {
    const w = mk([[PO7, 4]]);
    const p = player(w);
    const foe = addEnemy(w, p.x + 30, p.y, 500);
    onFilmBurst(w, p.x, p.y);
    expect(foe.hp).toBe(500 - (12 + 3 * 4));
  });

  it('DR6 파열 추진 — 대시 쿨다운 환급(30 + 5×Lv), **0 아래로 안 내려간다**', () => {
    const w = mk([[DR6, 2]]);
    const p = player(w);
    p.dashCooldown = 100;
    onFilmBurst(w, p.x, p.y);
    expect(p.dashCooldown).toBe(100 - 40);
    p.dashCooldown = 5;
    onFilmBurst(w, p.x, p.y);
    expect(p.dashCooldown).toBe(0); // 음수면 `dashCooldown === 0` 게이트가 영영 안 걸린다
  });

  it('FI1 조기 응결 — 재생 타이머가 선급값에서 시작한다(가산 아님, 점근 300 < 420)', () => {
    const w1 = mk([[FI1, 1]]);
    const p1 = player(w1);
    p1.aux1 = 999; // `film_lo` SUSTAIN 이 선지불해 둔 값을 흉내 낸다 — 대입이 이것을 지운다
    onFilmBurst(w1, p1.x, p1.y);
    expect(p1.aux1).toBe(16); // round(300×1/19)

    const w20 = mk([[FI1, 20]]);
    const p20 = player(w20);
    onFilmBurst(w20, p20.x, p20.y);
    expect(p20.aux1).toBe(158); // round(300×20/38) — 420 미만이라 즉시 재생 불가
  });

  it('FI5 파열 위상 — 무적 창이 `hitIframes + 6 + 2×Lv` 로 **max 갱신**된다', () => {
    const w = mk([[FI5, 5]]);
    const p = player(w);
    const want = w.config.hitIframes + 6 + 2 * 5;
    p.iframes = 0;
    onFilmBurst(w, p.x, p.y);
    expect(p.iframes).toBe(want);
    // 이미 더 긴 무적이면 깎지 않는다(가산이었다면 여기서 want 만큼 늘어난다).
    p.iframes = want + 100;
    onFilmBurst(w, p.x, p.y);
    expect(p.iframes).toBe(want + 100);
  });

  it('FI10 정화 파열 — 반경 안 적탄 소거 + 감속 해제', () => {
    const w = mk([[FI10, 2]]);
    const p = player(w);
    const radius = FILM_BURST_RADIUS + 15 * 2;
    const inside = addEnemyBullet(w, p.x + radius - 10, p.y);
    const outside = addEnemyBullet(w, p.x + radius + 50, p.y);
    w.playerSlowTicks = 60;
    onFilmBurst(w, p.x, p.y);
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
    cloakBreak: false,
    mark: 0,
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
