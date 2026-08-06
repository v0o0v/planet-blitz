/**
 * 팬텀 30스킬 배선(ADR-0049 배치 4) — **앵커를 통과하는 관측 테스트**.
 *
 * ## 왜 효과 함수를 직접 부르지 않는가
 * `src/sim/skills/phantom.ts` 의 함수를 직접 부르면 "효과 산술이 맞다"만 잰다. 이 저장소가
 * 반복해서 밟은 실패는 그쪽이 아니라 **"고쳐 놨는데 아무도 안 부른다"** 였다. 그래서 전부
 * `skillHooks.ts` 의 **공개 앵커**(또는 `stepWorld`)를 통해 자극한다.
 *
 * ## 뮤테이션으로 계측기를 검사했다 (2026-08-07)
 *  ① **효과 본체 삭제** — `phantomWallContact` 의 `advanceCloak` 한 줄을 지우면 §④ 가 실패한다.
 *  ② **배선 이음매 치환** — 앵커 ⑨(`dispatchSignatureStepSkill`)의 `case SIG_PHANTOM_CLOAK:`
 *     를 지우면 §⑦ DI2 · §⑧ DI5 쿨다운 진행이 함께 실패한다.
 *  ③ **앵커 ㉑ 배선 제거**(S2 레인, 2026-08-07) — `onCloakBreakReset` 의 `case SIG_PHANTOM_CLOAK:`
 *     호출을 지우면 §⑪ 의 3건이 실패한다(DI1 반경 · PH10 환급 · stepWorld 관통).
 *  ④ **앵커 ⑯ 배선 제거** — `onVolleyParams` 의 호출을 지우면 §⑫ 의 2건이 실패한다.
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
  onDashFired,
  onGemCollected,
  onWallContact,
  onPlayerDamaged,
  onDamageChain,
  onSignatureStep,
  onEnemyDamaged,
  onCloakBreakReset,
  onVolleyParams,
  type VolleyParams,
} from '../src/sim/skillHooks.js';
import { SIG_PHANTOM_CLOAK, CLOAK_UNHIT_TICKS } from '../src/sim/shipSignature.js';
import { PhantomCarry, readSlot, SKILL_SLOT_COUNT } from '../src/sim/skillSlots.js';

/** `data/ships/index.ts` 의 타입 id (STRIKER 0 · BRUISER 1 · ARCCASTER 2 · **PHANTOM 3**). */
const SHIP_PHANTOM = 3;

/**
 * flat 인덱스 — **정본은 `data/ships/phantom.ts` 의 `trees` 배열**이다:
 * `[assassin(offense), phase(utility), disrupt(defense)]` → AS 0..9 · PH 10..19 · DI 20..29.
 */
const AS2 = 1;
const AS3 = 2;
const AS4 = 3;
const AS5 = 4;
const PH1 = 10;
const PH10 = 19;
const DI1 = 20;
const PH7 = 16;
const PH8 = 17;
const DI2 = 21;
const DI3 = 22;
const DI4 = 23;
const DI5 = 24;
const DI6 = 25;
const DI7 = 26;
const DI8 = 27;

function invest(points: ReadonlyArray<readonly [number, number]>): number[] {
  const v = new Array<number>(30).fill(0);
  for (const [i, n] of points) v[i] = n;
  return v;
}

function phantomConfig(): WorldConfig {
  return {
    ...DEFAULT_CONFIG,
    planet: 0,
    stage: 1,
    shipType: SHIP_PHANTOM,
    playerHp: 100_000_000,
    loadout: { ...neutralLoadout(), weaponType: 0 },
  };
}

function mk(points: ReadonlyArray<readonly [number, number]> = []): WorldState {
  return createWorld(1234, { ...phantomConfig(), skillInvest: invest(points) });
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

// ---------------------------------------------------------------------------
// ⓪ 전제
// ---------------------------------------------------------------------------

describe('⓪ 전제', () => {
  it('shipType 3 런은 팬텀 시그니처이고 투자 벡터는 30칸이다', () => {
    const w = mk([[PH1, 1]]);
    expect(w.sigBit).toBe(SIG_PHANTOM_CLOAK);
    expect(w.skillsOn).toBe(true);
    expect(w.config.skillInvest).toHaveLength(30);
    expect(w.skillDerived.shipType).toBe(SHIP_PHANTOM);
  });

  it('투자 0 런은 `skillsOn` 이 거짓이라 앵커가 첫 줄에서 반환한다', () => {
    expect(mk().skillsOn).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ① 불변 계약 — 투자 0 런은 바이트 불변이어야 한다
// ---------------------------------------------------------------------------

describe('① 투자 0 런 불변', () => {
  it('투자 0 팬텀 런 두 개가 400틱 뒤 같은 해시다 (슬롯도 전부 0)', () => {
    const a = mk();
    const b = mk();
    for (let i = 0; i < 400; i++) {
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
    // 것은 "스킬 경로가 한 줄도 안 돌았다" 이고, 그 관측면은 **엔티티·슬롯 상태**다.
    const none = createWorld(77, { ...phantomConfig() });
    const zero = createWorld(77, { ...phantomConfig(), skillInvest: invest([]) });
    for (let i = 0; i < 400; i++) {
      stepWorld(none, emptyInput());
      stepWorld(zero, emptyInput());
    }
    expect(zero.entities.length).toBe(none.entities.length);
    for (let i = 0; i < none.entities.length; i++) {
      const a = none.entities[i];
      const b = zero.entities[i];
      expect(b?.x).toBe(a?.x);
      expect(b?.y).toBe(a?.y);
      expect(b?.hp).toBe(a?.hp);
      expect(b?.maxHp).toBe(a?.maxHp);
      expect(b?.aux0).toBe(a?.aux0);
      expect(b?.aux1).toBe(a?.aux1);
    }
    for (let s = 0; s < SKILL_SLOT_COUNT; s++) {
      expect(readSlot(zero.skillCarry, s)).toBe(readSlot(none.skillCarry, s));
      expect(readSlot(zero.skillStage, s)).toBe(readSlot(none.skillStage, s));
    }
  });
});

// ---------------------------------------------------------------------------
// ② PH1 잔상 이탈 — 앵커 ②(대시 발동)
// ---------------------------------------------------------------------------

describe('② PH1 잔상 이탈 (앵커 ②)', () => {
  it('대시 발동이 무피격 스트릭을 전진시킨다 (미투자면 불변)', () => {
    const off = mk();
    const p0 = player(off);
    p0.aux0 = 0;
    onDashFired(off, p0);
    expect(p0.aux0).toBe(0);

    const on = mk([[PH1, 5]]);
    const p1 = player(on);
    p1.aux0 = 0;
    onDashFired(on, p1);
    // 20 + 4×5 = 40.
    expect(p1.aux0).toBe(40);
  });

  it('창 안(aux0 ≥ 240) 대시는 무효다 — 창 조작은 PH6 의 전유 축이다', () => {
    const w = mk([[PH1, 20]]);
    const p = player(w);
    p.aux0 = 260;
    onDashFired(w, p);
    expect(p.aux0).toBe(260);
  });
});

// ---------------------------------------------------------------------------
// ③ PH8 흔적 흡수 — 앵커 ③(젬 수거)
// ---------------------------------------------------------------------------

describe('③ PH8 흔적 흡수 (앵커 ③)', () => {
  it('젬 수거가 스트릭을 전진시킨다 (미투자면 불변)', () => {
    const off = mk();
    const g0 = blankEntity('gem');
    player(off).aux0 = 0;
    onGemCollected(off, g0);
    expect(player(off).aux0).toBe(0);

    const on = mk([[PH8, 10]]);
    player(on).aux0 = 0;
    onGemCollected(on, blankEntity('gem'));
    // 1 + ceil(10/5) = 3.
    expect(player(on).aux0).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// ④ DI6 차폐 잠행 — 앵커 ⑦(벽 접촉)
// ---------------------------------------------------------------------------

describe('④ DI6 차폐 잠행 (앵커 ⑦)', () => {
  it('벽 접촉 틱이 적립을 가속한다 (미투자면 불변)', () => {
    const off = mk();
    player(off).aux0 = 0;
    onWallContact(off, player(off));
    expect(player(off).aux0).toBe(0);

    const on = mk([[DI6, 20]]);
    const p = player(on);
    p.aux0 = 0;
    onWallContact(on, p);
    // 1 + floor(20/10) = 3.
    expect(p.aux0).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// ⑤ DI3 초탄 감쇄 — 앵커 ⑧(감쇠 사슬)
// ---------------------------------------------------------------------------

describe('⑤ DI3 초탄 감쇄 (앵커 ⑧)', () => {
  it('스트릭이 길수록 받는 피해가 줄고, 스트릭 0 이면 감소가 없다', () => {
    const off = mk();
    player(off).aux0 = 300;
    expect(onDamageChain(off, player(off), 100)).toBe(100);

    const on = mk([[DI3, 10]]);
    const p = player(on);
    p.aux0 = 0;
    // 피격 직후(스트릭 0)에는 무력하다 — 연타 억제가 공식에 내장돼 있다.
    expect(onDamageChain(on, p, 100)).toBe(100);
    p.aux0 = 240;
    const mid = onDamageChain(on, p, 100);
    expect(mid).toBeLessThan(100);
    p.aux0 = 359;
    expect(onDamageChain(on, p, 100)).toBeLessThan(mid);
  });
});

// ---------------------------------------------------------------------------
// ⑥ DI4 반발 위상 — 앵커 ④(피격 후속)
// ---------------------------------------------------------------------------

describe('⑥ DI4 반발 위상 (앵커 ④)', () => {
  function setup(points: ReadonlyArray<readonly [number, number]>): {
    w: WorldState;
    e: Entity;
    x0: number;
  } {
    const w = mk(points);
    // 벽 슬라이드 재해결이 변위를 되돌리는 무대 의존을 없앤다 — 이 절이 재는 것은 "밀렸는가" 다.
    w.activeWalls = [];
    const p = player(w);
    p.maxHp = 100;
    p.hp = 90;
    const e = addEnemy(w, p.x + 60, p.y, 500);
    return { w, e, x0: e.x };
  }

  it('실피격 틱에 주변 적이 밀려난다 (미투자면 제자리)', () => {
    const off = setup([]);
    onPlayerDamaged(off.w, player(off.w), 5, false);
    expect(off.e.x).toBe(off.x0);

    const on = setup([[DI4, 10]]);
    onPlayerDamaged(on.w, player(on.w), 5, false);
    // 변위 60 + 8×10 = 140 (일반 잡몹은 반감 없음).
    expect(on.e.x).toBeCloseTo(on.x0 + 140, 6);
  });

  it('엘리트(pierce > 0)는 반감된다', () => {
    const on = setup([[DI4, 10]]);
    on.e.pierce = 1;
    onPlayerDamaged(on.w, player(on.w), 5, false);
    expect(on.e.x).toBeCloseTo(on.x0 + 70, 6);
  });
});

// ---------------------------------------------------------------------------
// ⑦ DI2 은둔 재생 — 앵커 ⑨(시그니처 틱)
// ---------------------------------------------------------------------------

describe('⑦ DI2 은둔 재생 (앵커 ⑨)', () => {
  it('은신 창 안 60틱 주기에만 회복한다 (미투자면 회복 0)', () => {
    const off = mk();
    const q = player(off);
    q.maxHp = 100;
    q.hp = 50;
    q.aux0 = 300;
    onSignatureStep(off, q, emptyInput());
    expect(q.hp).toBe(50);

    const on = mk([[DI2, 10]]);
    const p = player(on);
    p.maxHp = 100;
    p.hp = 50;
    // 진입 틱(240)은 공짜 회복이 없다 — 첫 회복은 진입 60틱 뒤다.
    p.aux0 = CLOAK_UNHIT_TICKS;
    onSignatureStep(on, p, emptyInput());
    expect(p.hp).toBe(50);
    // 창 밖(적립 중)도 회복 없음.
    p.aux0 = 120;
    onSignatureStep(on, p, emptyInput());
    expect(p.hp).toBe(50);
    // 진입 60틱 뒤 = 2 + Lv.
    p.aux0 = CLOAK_UNHIT_TICKS + 60;
    onSignatureStep(on, p, emptyInput());
    expect(p.hp).toBe(62);
  });
});

// ---------------------------------------------------------------------------
// ⑧ DI5 최후 위상 — 앵커 ④(트리거) + 앵커 ⑨(쿨다운 진행)
// ---------------------------------------------------------------------------

describe('⑧ DI5 최후 위상 (앵커 ④ + ⑨)', () => {
  function hurt(w: WorldState): Entity {
    const p = player(w);
    p.maxHp = 100;
    p.hp = 25;
    onPlayerDamaged(w, p, 10, false); // 피격 전 35% → 25% 로 임계 통과
    return p;
  }

  it('30% 임계를 통과하는 피격 틱에 즉시 은신 진입 + 내부 쿨다운이 선다', () => {
    const off = mk();
    const q = hurt(off);
    expect(q.aux0).toBe(0);
    expect(readSlot(off.skillCarry, PhantomCarry.lastPhaseCooldown)).toBe(0);

    const on = mk([[DI5, 20]]);
    const p = hurt(on);
    expect(p.aux0).toBe(CLOAK_UNHIT_TICKS);
    // 3600 − floor(3600×20/50) = 2160.
    expect(readSlot(on.skillCarry, PhantomCarry.lastPhaseCooldown)).toBe(2160);
  });

  it('이미 임계 아래였던 피격은 통과가 아니라 재발동시키지 않는다', () => {
    const w = mk([[DI5, 20]]);
    const p = player(w);
    p.maxHp = 100;
    p.hp = 20;
    onPlayerDamaged(w, p, 5, false); // 25% → 20%, 둘 다 임계 아래
    expect(p.aux0).toBe(0);
    expect(readSlot(w.skillCarry, PhantomCarry.lastPhaseCooldown)).toBe(0);
  });

  it('내부 쿨다운이 앵커 ⑨ 에서 깎이고, 남아 있는 동안은 재발동하지 않는다', () => {
    const w = mk([[DI5, 20]]);
    const p = hurt(w);
    const cd = readSlot(w.skillCarry, PhantomCarry.lastPhaseCooldown);
    onSignatureStep(w, p, emptyInput());
    expect(readSlot(w.skillCarry, PhantomCarry.lastPhaseCooldown)).toBe(cd - 1);
    // 쿨 중 재시도 — 스트릭을 되돌려도 진입이 다시 서지 않는다.
    p.aux0 = 0;
    p.hp = 25;
    onPlayerDamaged(w, p, 10, false);
    expect(p.aux0).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑨ AS4 급소 해부 · AS5 배후 격살 — 앵커 ⑩(적 피격)
// ---------------------------------------------------------------------------

describe('⑨ AS4 · AS5 (앵커 ⑩)', () => {
  it('AS4 — 만피 적에게 명중한 첫 타에만 추가 피해가 붙는다', () => {
    const off = mk();
    const e0 = addEnemy(off, 400, 400, 100);
    e0.hp = 90;
    onEnemyDamaged(off, e0, 10, undefined);
    expect(e0.hp).toBe(90);

    const on = mk([[AS4, 10]]);
    const e1 = addEnemy(on, 400, 400, 100);
    e1.hp = 90; // 피격 전 100 = 만피
    onEnemyDamaged(on, e1, 10, undefined);
    // round(10 × (1200 + 1800)/10000) = 3.
    expect(e1.hp).toBe(87);

    // 만피가 아니면 붙지 않는다.
    const e2 = addEnemy(on, 400, 400, 100);
    e2.hp = 50;
    onEnemyDamaged(on, e2, 10, undefined);
    expect(e2.hp).toBe(50);
  });

  it('AS4 — 피해가 전량 흡수된 명중(dmg 0)은 제외된다', () => {
    const on = mk([[AS4, 10]]);
    const e = addEnemy(on, 400, 400, 100);
    onEnemyDamaged(on, e, 0, undefined);
    expect(e.hp).toBe(100);
  });

  it('AS5 — 적의 후방 반구에서만 추가 피해가 붙는다 (정지 적은 제외)', () => {
    const on = mk([[AS5, 10]]);
    const p = player(on);

    // 적이 플레이어에게서 멀어지는 방향(+x)으로 이동 = 플레이어가 후방에 있다.
    const back = addEnemy(on, p.x + 100, p.y, 100);
    back.hp = 50;
    back.vx = 1;
    onEnemyDamaged(on, back, 20, undefined);
    // round(20 × (1000 + 1500)/10000) = 5.
    expect(back.hp).toBe(45);

    // 플레이어를 향해 오는 적(−x)은 배후가 없다.
    const front = addEnemy(on, p.x + 100, p.y, 100);
    front.hp = 50;
    front.vx = -1;
    onEnemyDamaged(on, front, 20, undefined);
    expect(front.hp).toBe(50);

    // 정지 적은 내적이 0 이라 증폭 없음.
    const still = addEnemy(on, p.x + 100, p.y, 100);
    still.hp = 50;
    onEnemyDamaged(on, still, 20, undefined);
    expect(still.hp).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// ⑩ 진입 에지 3종(PH7·DI7·DI8) — `stepWorld` 가 임계를 넘는 틱
// ---------------------------------------------------------------------------

describe('⑩ 진입 에지 PH7 · DI7 · DI8 (fireCloakEntry)', () => {
  /** 자연 적립이 이번 틱에 240 을 통과하도록 세팅하고 한 틱 돌린다. */
  function crossEntry(points: ReadonlyArray<readonly [number, number]>): {
    w: WorldState;
    e: Entity;
    maxHpBefore: number;
  } {
    const w = mk(points);
    const p = player(w);
    p.aux0 = CLOAK_UNHIT_TICKS - 1;
    const e = addEnemy(w, p.x + 120, p.y, 5000);
    const maxHpBefore = p.maxHp;
    stepWorld(w, emptyInput());
    return { w, e, maxHpBefore };
  }

  it('은신 진입 틱에 폭발(PH7) · 냉기(DI7) · 최대 HP 침전(DI8)이 함께 발화한다', () => {
    const off = crossEntry([]);
    expect(player(off.w).aux0).toBe(CLOAK_UNHIT_TICKS);
    expect(off.e.hp).toBe(5000);
    expect(off.e.ownerId).toBe(0);
    expect(player(off.w).maxHp).toBe(off.maxHpBefore);

    const on = crossEntry([
      [PH7, 10],
      [DI7, 10],
      [DI8, 20],
    ]);
    expect(player(on.w).aux0).toBe(CLOAK_UNHIT_TICKS);
    // PH7 — 반경 150 + 120 = 270 안, 피해 15 + 30 = 45.
    expect(on.e.hp).toBeLessThan(5000);
    // DI7 — 반경 200 + 150 = 350 안이라 냉기(감속 잔여 틱)가 선다.
    expect(on.e.ownerId).toBeGreaterThan(0);
    // DI8 — round(2 + 16×20/44) = 9.
    expect(player(on.w).maxHp).toBe(on.maxHpBefore + 9);
  });

  it('진입하지 않은 틱에는 아무것도 발화하지 않는다', () => {
    const w = mk([
      [PH7, 10],
      [DI7, 10],
      [DI8, 20],
    ]);
    const p = player(w);
    p.aux0 = 100;
    const e = addEnemy(w, p.x + 120, p.y, 5000);
    const maxHpBefore = p.maxHp;
    stepWorld(w, emptyInput());
    expect(e.hp).toBe(5000);
    expect(e.ownerId).toBe(0);
    expect(player(w).maxHp).toBe(maxHpBefore);
  });
});

// ---------------------------------------------------------------------------
// ⑪ DI1 위상 정산 · PH10 발각 즉응 — 앵커 ㉑(S2, 팬텀 리셋 **직전**)
// ---------------------------------------------------------------------------
//
// ## 이 절이 재는 것은 산술이 아니라 **순서**다
// 두 스킬은 앵커 ④ 에서 배선할 수 없었다 — ④ 는 리셋 **뒤**라 거기 도달한 `aux0` 이 항상 0 이고,
// 그래서 DI1 은 상시 최소 반경 · PH10 은 상시 미발동이었다. 그러니 여기서 훅만 직접 불러
// 산술을 재면 **정확히 그 결함을 못 잡는다**(리셋 뒤로 옮겨도 초록이다). 그래서 §⑪-3 은
// `stepWorld` 로 실제 피격을 만들어 **엔진이 리셋 전에 부르는가**를 잰다.

describe('⑪ DI1 · PH10 (앵커 ㉑)', () => {
  function addEnemyBullet(w: WorldState, x: number, y: number, damage: number): Entity {
    const b: Entity = {
      ...blankEntity('enemyBullet'),
      x,
      y,
      radius: 4,
      damage,
      life: 600,
      hp: 1,
      maxHp: 1,
    };
    w.entities.push(b);
    return b;
  }

  it('DI1 — 소거 반경이 리셋 전 스트릭에 비례해 커진다 (미투자면 소거 0)', () => {
    // 반경 = (40 + 4×Lv) + streak/2. Lv1·streak 300 → 44 + 150 = 194.
    const off = mk();
    const q = player(off);
    const bq = addEnemyBullet(off, q.x + 100, q.y, 1);
    onCloakBreakReset(off, q, 7, 300, false);
    expect(bq.dead).toBe(false);

    const on = mk([[DI1, 1]]);
    const p = player(on);
    const near = addEnemyBullet(on, p.x + 100, p.y, 1);
    const far = addEnemyBullet(on, p.x + 250, p.y, 1);
    onCloakBreakReset(on, p, 7, 300, false);
    expect(near.dead).toBe(true);
    expect(far.dead).toBe(false);
  });

  it('DI1 — 스트릭 0 이면 기본항 반경만 남는다', () => {
    const w = mk([[DI1, 1]]);
    const p = player(w);
    const b = addEnemyBullet(w, p.x + 100, p.y, 1);
    onCloakBreakReset(w, p, 7, 0, false);
    // 기본항 44 < 100 이라 안 닿는다 — 스트릭 보정이 실제로 반경을 키우고 있다는 음성 대조.
    expect(b.dead).toBe(false);
  });

  it('PH10 — 창 안 피격에만 대시 쿨 환급 + 무적 가산 (창 밖·미투자는 불변)', () => {
    const off = mk();
    const q = player(off);
    q.dashCooldown = 55;
    q.iframes = 40;
    onCloakBreakReset(off, q, 7, 300, false);
    expect(q.dashCooldown).toBe(55);
    expect(q.iframes).toBe(40);

    // 창 밖(스트릭 239)에서는 발동하지 않는다.
    const outside = mk([[PH10, 8]]);
    const r = player(outside);
    r.dashCooldown = 55;
    r.iframes = 40;
    onCloakBreakReset(outside, r, 7, CLOAK_UNHIT_TICKS - 1, false);
    expect(r.dashCooldown).toBe(55);
    expect(r.iframes).toBe(40);

    const on = mk([[PH10, 8]]);
    const p = player(on);
    p.dashCooldown = 55;
    p.iframes = 40;
    onCloakBreakReset(on, p, 7, 300, false);
    expect(p.dashCooldown).toBe(0);
    // 대입이 아니라 **가산**이다 — 이 시점의 iframes 는 이미 hitIframes 로 서 있다.
    // 1 + floor(8/4) = 3.
    expect(p.iframes).toBe(43);
  });

  it('실제 피격 경로가 **리셋 전에** 앵커를 부른다 (stepWorld 관통)', () => {
    function run(points: ReadonlyArray<readonly [number, number]>): {
      w: WorldState;
      p: Entity;
      far: Entity;
    } {
      const w = mk(points);
      const p = player(w);
      // 창 한복판. 한 틱 적립돼 301 로 리셋에 닿는다 — 되감기(360) 경계와 멀다.
      p.aux0 = 300;
      p.iframes = 0;
      p.dashCooldown = 55;
      // 판정점 안의 적탄이 실피해를 만든다(막·완충 없는 기체라 그대로 hp 로 간다).
      addEnemyBullet(w, p.x, p.y, 10);
      // 기본항 반경(44)으로는 못 닿고 스트릭 보정(+150)이 있어야 닿는 거리.
      const far = addEnemyBullet(w, p.x + 100, p.y + 60, 1);
      stepWorld(w, emptyInput());
      return { w, p, far };
    }

    const off = run([]);
    expect(off.p.aux0).toBe(0); // 리셋은 실제로 일어났다 = 피격이 성립했다
    expect(off.far.dead).toBe(false);
    // 틱 진행이 쿨을 1 깎았을 뿐 환급은 없다(55 → 54).
    expect(off.p.dashCooldown).toBe(54);

    const on = run([
      [DI1, 1],
      [PH10, 8],
    ]);
    expect(on.p.aux0).toBe(0);
    // DI1 — 리셋 뒤에 불렸다면 반경이 44 로 줄어 이 탄이 살아남는다.
    expect(on.far.dead).toBe(true);
    // PH10 — 리셋 뒤에 불렸다면 창 술어가 거짓이라 환급이 없다.
    expect(on.p.dashCooldown).toBe(0);
    expect(on.p.iframes).toBe(on.w.config.hitIframes + 3);
  });
});

// ---------------------------------------------------------------------------
// ⑫ AS2 은막 침투 — 앵커 ⑯(S2, 볼리 파라미터 확정 직후)
// ---------------------------------------------------------------------------

describe('⑫ AS2 은막 침투 (앵커 ⑯)', () => {
  function params(): VolleyParams {
    return {
      damage: 10,
      pierce: 0,
      count: 3,
      speed: 100,
      radius: 4,
      life: 60,
      spread: 0.5,
      cooldownQ: 12,
      mark: 0,
      recordSpawnDamage: false,
      // 아크캐스터 레인이 BA10 을 위해 추가한 필드(머지에서 합류). `true` = 이번 아키타입이
      // `count` 를 실제로 읽는다(발칸/스프레드/미사일). AS2 는 `pierce`·`speed` 만 만져서
      // 이 값과 무관하지만, 레코드 타입이 요구하므로 **읽는 쪽**을 기본으로 둔다.
      countUsed: true,
      // S2.1 이 더한 셋. ⚠️ **`cloakBreak` 이 AS3(처형 재장전)을 여는 신호다** — 이 픽스처의
      // 기본은 `false`(강화탄이 아닌 평범한 볼리)이므로, AS3 을 재는 케이스는 뒤집어야 한다.
      ballisticsUsed: true,
      targetDist: 200,
      // 발사 방위(rad). 읽기 전용 사실이라 훅이 고치지 않는다 — 기본 0(순수 +x).
      aimAngle: 0,
      cloakBreak: false,
    };
  }

  it('은신 창 안 발사에만 관통 +1 · 탄속 가산이 붙는다', () => {
    const off = mk();
    const q = player(off);
    q.aux0 = 300;
    const a = params();
    onVolleyParams(off, q, a);
    expect(a.pierce).toBe(0);
    expect(a.speed).toBe(100);

    const on = mk([[AS2, 10]]);
    const p = player(on);
    p.aux0 = 300;
    const b = params();
    onVolleyParams(on, p, b);
    expect(b.pierce).toBe(1);
    // 탄속 +6% + 1.5%p×10 = ×1.21.
    expect(b.speed).toBeCloseTo(121, 9);
    // 다른 필드는 건드리지 않는다 — AS2 는 두 축뿐이다.
    expect(b.damage).toBe(10);
    expect(b.count).toBe(3);
    expect(b.mark).toBe(0);
  });

  it('창 밖 발사는 불변이다 — 창 술어가 실제 게이트다', () => {
    const w = mk([[AS2, 10]]);
    const p = player(w);
    p.aux0 = CLOAK_UNHIT_TICKS - 1;
    const a = params();
    onVolleyParams(w, p, a);
    expect(a.pierce).toBe(0);
    expect(a.speed).toBe(100);
  });

  it('실제 발사 경로가 앵커를 관통한다 — 창 안 아군탄이 더 빠르다 (stepWorld)', () => {
    function fire(points: ReadonlyArray<readonly [number, number]>): Entity[] {
      const w = mk(points);
      const p = player(w);
      p.aux0 = 300;
      p.cooldown = 0;
      addEnemy(w, p.x + 150, p.y, 100_000);
      stepWorld(w, emptyInput());
      return w.entities.filter((e) => e.kind === 'bullet');
    }
    const off = fire([]);
    const on = fire([[AS2, 10]]);
    expect(off.length).toBeGreaterThan(0);
    expect(on.length).toBe(off.length);
    const a = off[0];
    const b = on[0];
    if (a === undefined || b === undefined) throw new Error('bullet missing');
    expect(b.pierce).toBe(a.pierce + 1);
    // 속도는 성분으로만 관측 가능하다 — 같은 각도이므로 크기 비가 곧 탄속 비다.
    const sa = Math.hypot(a.vx, a.vy);
    const sb = Math.hypot(b.vx, b.vy);
    expect(sb).toBeCloseTo(sa * 1.21, 6);
  });
});

// ---------------------------------------------------------------------------
// ⑬ AS3 처형 재장전 — 앵커 ⑯(강화탄 표식) + 앵커 ⑩(토큰 재장전)
// ---------------------------------------------------------------------------
//
// 이 스킬은 **두 앵커에 걸쳐 있다**. 한쪽만 재면 반쪽 배선이 초록으로 선다:
//  · ⑯ 만 재면 "표식은 찍는데 아무도 안 읽는" 무연산이 통과한다.
//  · ⑩ 만 재면 "읽기는 하는데 아무도 안 찍는" 상시 미발동이 통과한다.
// 그래서 절을 둘로 나누고, 마지막에 실제 발사 경로(stepWorld)로 이음매를 한 번 더 관통시킨다.

describe('⑬ AS3 처형 재장전 (앵커 ⑯ 표식)', () => {
  function av(over: Partial<VolleyParams> = {}): VolleyParams {
    return {
      damage: 100,
      pierce: 1,
      count: 3,
      speed: 100,
      radius: 4,
      life: 60,
      spread: 0.5,
      cooldownQ: 12,
      mark: 0,
      countUsed: true,
      ballisticsUsed: true,
      targetDist: 200,
      aimAngle: 0,
      // ⚠️ 기본은 **평범한 볼리**다. AS3 을 재는 케이스만 뒤집는다.
      cloakBreak: false,
      ...over,
    };
  }

  it('해제 첫 타 볼리에만 강화탄 표식과 관통 계단이 붙는다', () => {
    const w = mk([[AS3, 10]]);
    const p = player(w);
    const v = av({ cloakBreak: true });
    onVolleyParams(w, p, v);
    expect(v.mark & 2).toBe(2);
    expect(v.pierce).toBe(1 + Math.floor(10 / 5)); // 3
    // AS3 은 두 축뿐이다 — 피해는 이미 world 가 실었으므로 여기서 또 곱하면 두 배가 된다.
    expect(v.damage).toBe(100);
    expect(v.speed).toBe(100);
  });

  it('평범한 볼리에는 표식도 관통도 안 붙는다 — `cloakBreak` 이 실제 게이트다 (음성 짝)', () => {
    const w = mk([[AS3, 10]]);
    const p = player(w);
    const v = av({ cloakBreak: false });
    onVolleyParams(w, p, v);
    expect(v.mark).toBe(0);
    expect(v.pierce).toBe(1);
  });

  it('관통 계단은 5레벨 폭이다 (Lv4 = +0 · Lv5 = +1 · Lv20 = +4)', () => {
    for (const [level, bonus] of [
      [4, 0],
      [5, 1],
      [20, 4],
    ] as const) {
      const w = mk([[AS3, level]]);
      const v = av({ cloakBreak: true });
      onVolleyParams(w, player(w), v);
      expect(v.pierce).toBe(1 + bonus);
      // 계단이 0 인 레벨에서도 **표식은 찍힌다** — 표식이 스킬 본체이고 관통은 레벨 스케일이다.
      expect(v.mark & 2).toBe(2);
    }
  });

  it('미투자 런은 해제 첫 타여도 표식이 없다 (음성 대조)', () => {
    const w = mk([[AS2, 10]]);
    const p = player(w);
    p.aux0 = 0; // 창 밖 — AS2 도 안 걸리게 둔다
    const v = av({ cloakBreak: true });
    onVolleyParams(w, p, v);
    expect(v.mark).toBe(0);
    expect(v.pierce).toBe(1);
  });
});

describe('⑬-처치 AS3 (앵커 ⑩ 이 표식을 읽어 토큰을 재장전한다)', () => {
  /** 강화탄 표식이 찍힌 아군탄. `MARK_CLOAK_BREAK = 2`(정본은 `skills/phantom.ts`). */
  function markedBullet(): Entity {
    return { ...blankEntity('bullet'), damage: 40, aux0: 2 };
  }

  it('강화탄으로 처치하면 배율 토큰이 그 자리에서 다시 선다', () => {
    const w = mk([[AS3, 10]]);
    const p = player(w);
    // 하한 — 소진 직후를 재현한다. 여기서 토큰이 이미 서 있으면 아래 단언이 항진이 된다.
    p.aux1 = 0;
    const t = addEnemy(w, p.x + 300, p.y, 40);
    t.hp = 0;
    t.dead = true;
    onEnemyDamaged(w, t, 40, markedBullet());
    expect(p.aux1).toBe(1);
  });

  it('강화탄이어도 **죽지 않았으면** 재장전이 없다 (음성 짝)', () => {
    const w = mk([[AS3, 10]]);
    const p = player(w);
    p.aux1 = 0;
    const t = addEnemy(w, p.x + 300, p.y, 1000);
    onEnemyDamaged(w, t, 40, markedBullet());
    expect(p.aux1).toBe(0);
  });

  it('표식 없는 탄으로 처치하면 재장전이 없다 — 창 안 전 발사가 강화탄이 되지 않는다', () => {
    const w = mk([[AS3, 10]]);
    const p = player(w);
    p.aux0 = 300; // 은신 창 안 — "지금 창인가" 로 대체 구현했다면 여기서 통과해 버린다
    p.aux1 = 0;
    const t = addEnemy(w, p.x + 300, p.y, 40);
    t.hp = 0;
    t.dead = true;
    onEnemyDamaged(w, t, 40, { ...blankEntity('bullet'), damage: 40, aux0: 0 });
    expect(p.aux1).toBe(0);
  });

  it('미투자 런은 강화탄 표식이 붙은 탄이 죽여도 아무 일도 안 한다 (음성 대조)', () => {
    const w = mk([[AS2, 10]]);
    const p = player(w);
    p.aux1 = 0;
    const t = addEnemy(w, p.x + 300, p.y, 40);
    t.hp = 0;
    t.dead = true;
    onEnemyDamaged(w, t, 40, markedBullet());
    expect(p.aux1).toBe(0);
  });

  it('실제 발사 경로가 앵커를 관통한다 — 해제 첫 타 탄에 표식이 실려 나간다 (stepWorld)', () => {
    function fire(points: ReadonlyArray<readonly [number, number]>): {
      breaks: number;
      bullets: Entity[];
    } {
      const w = mk(points);
      const p = player(w);
      p.aux0 = 300; // 은신 창 안
      p.aux1 = 1; // 배율 토큰 장전 — 이번 볼리가 해제 첫 타가 된다
      p.cooldown = 0;
      addEnemy(w, p.x + 150, p.y, 100_000);
      stepWorld(w, emptyInput());
      return { breaks: w.cloakBreaks, bullets: w.entities.filter((e) => e.kind === 'bullet') };
    }
    // 하한 두 개를 먼저 세운다 — "강화탄이 실제로 나갔다" 가 성립하지 않으면 표식 단언은
    // 아무것도 재지 않는다.
    const on = fire([[AS3, 10]]);
    expect(on.breaks).toBe(1);
    expect(on.bullets.length).toBeGreaterThan(0);
    for (const b of on.bullets) expect(b.aux0 & 2).toBe(2);

    // 음성 대조 — 미투자 런에서도 시그니처 배율은 소진되지만(같은 하한) 표식은 안 붙는다.
    const off = fire([[AS2, 10]]);
    expect(off.breaks).toBe(1);
    expect(off.bullets.length).toBe(on.bullets.length);
    for (const b of off.bullets) expect(b.aux0 & 2).toBe(0);
  });
});
