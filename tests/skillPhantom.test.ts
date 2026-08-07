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
 *  ⑤ **배치6 5종**(2026-08-07) — DI9·PH9·PH5·AS8·AS1. 뮤테이션 목록과 **실측 적색 건수**는
 *     각 절(㉒~㉖) 머리 주석에 적었다. 그중 하나(`!stalledThisTick`)는 **적색이 되지 않는다**는
 *     사실까지 그대로 남겼다 — 안 걸리는 가드를 걸린다고 적는 것이 가장 나쁜 형태다.
 * 초록인데 아무것도 안 재는 테스트가 아니다.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld,
  stepWorld,
  emptyInput,
  DEFAULT_CONFIG,
  SPECIAL_ACTIVE_SLOT1,
  type InputFrame,
  type WorldConfig,
  type WorldState,
} from '../src/sim/world.js';
import { stepActives } from '../src/sim/actives.js';
import { wireIdOf } from '../data/ships/actives/index.js';
import { COLD_DURATION } from '../src/sim/status.js';
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
  onPlayerMoveParams,
  onWallHit,
  onPlayerWallSlide,
  onObjectiveResolved,
  onEnemyDeath,
  onDeathRemnantSpawn,
  type VolleyParams,
  type PlayerMoveParams,
  type WallHitParams,
  type WallSlideParams,
} from '../src/sim/skillHooks.js';
import {
  SIG_PHANTOM_CLOAK,
  CLOAK_UNHIT_TICKS,
  CLOAK_HOLD_TICKS,
} from '../src/sim/shipSignature.js';
import {
  PhantomCarry,
  PhantomStage,
  readSlot,
  writeSlot,
  SKILL_SLOT_COUNT,
} from '../src/sim/skillSlots.js';
import { DamageSource } from '../src/sim/skillSlots.js';

/** `data/ships/index.ts` 의 타입 id (STRIKER 0 · BRUISER 1 · ARCCASTER 2 · **PHANTOM 3**). */
const SHIP_PHANTOM = 3;

/**
 * flat 인덱스 — **정본은 `data/ships/phantom.ts` 의 `trees` 배열**이다:
 * `[assassin(offense), phase(utility), disrupt(defense)]` → AS 0..9 · PH 10..19 · DI 20..29.
 */
const AS1 = 0;
const AS2 = 1;
const AS8 = 7;
const PH5 = 14;
const PH9 = 18;
const DI9 = 28;
const AS3 = 2;
const AS4 = 3;
const AS5 = 4;
const AS6 = 5;
const AS7 = 6;
const AS9 = 8;
const AS10 = 9;
const PH1 = 10;
const PH2 = 11;
const PH3 = 12;
const PH4 = 13;
const PH6 = 15;
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
    onPlayerDamaged(off.w, player(off.w), 5, false, DamageSource.bullet);
    expect(off.e.x).toBe(off.x0);

    const on = setup([[DI4, 10]]);
    onPlayerDamaged(on.w, player(on.w), 5, false, DamageSource.bullet);
    // 변위 60 + 8×10 = 140 (일반 잡몹은 반감 없음).
    expect(on.e.x).toBeCloseTo(on.x0 + 140, 6);
  });

  it('엘리트(pierce > 0)는 반감된다', () => {
    const on = setup([[DI4, 10]]);
    on.e.pierce = 1;
    onPlayerDamaged(on.w, player(on.w), 5, false, DamageSource.bullet);
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
    onPlayerDamaged(w, p, 10, false, DamageSource.bullet); // 피격 전 35% → 25% 로 임계 통과
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
    onPlayerDamaged(w, p, 5, false, DamageSource.bullet); // 25% → 20%, 둘 다 임계 아래
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
    onPlayerDamaged(w, p, 10, false, DamageSource.bullet);
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
      leadDamageBonus: 0,
      leadPierceBonus: 0,
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
      // W2 가 더한 칸 — 그 틱 이동 입력 벡터(읽기 전용). 기본은 무입력(정지).
      inputX: 0,
      inputY: 0,
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
      // W2 가 더한 칸 — 그 틱 이동 입력 벡터(읽기 전용). 기본은 무입력(정지).
      inputX: 0,
      inputY: 0,
      // ⚠️ 기본은 **평범한 볼리**다. AS3 을 재는 케이스만 뒤집는다.
      cloakBreak: false,
      // 아크캐스터 CH3 이 신설한 필수 필드. 팬텀은 각인을 요구하지 않으므로 `false` 다.
      // ⚠️ 이 줄이 `...over` **앞**에 있어야 한다 — `Partial` 스프레드가 뒤에 오면
      //    필수 필드가 optional 로 좁혀져 `tsc` 가 대입을 거부한다(병렬 레인 합류 지점).
      leadDamageBonus: 0,
      leadPierceBonus: 0,
      recordSpawnDamage: false,
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

// ---------------------------------------------------------------------------
// ⑯-좀비 AS4·AS5 추가 피해 사망 마킹 — 「표적이 탄을 견디고 추가분에 죽는」 경우
// ---------------------------------------------------------------------------

/**
 * 둘 다 대상이 **맞은 표적 자신**이라 "격추 판정 뒤라 의도적" 으로 분류돼 있었다. 그 분류는
 * **표적이 이미 죽은 경우**에만 맞다. 표적이 탄 피해를 **견디고**(hp > 0) 추가분이 hp 를 0
 * 이하로 내리면 `world.ts:4170-4197` 의 격추 판정은 이미 지나간 뒤라 아무도 `dead` 를 안
 * 세운다 — `hp<=0 → dead` 를 훑는 일반 스윕이 sim 에 **없으므로** 그 표적은 **좀비**다.
 * (`phantom.ts` 의 옛 주석 *"다음 틱에 죽는다"* 가 바로 그 오해였다.)
 *
 * ⚠️ 계측기 함정: 표적을 플레이어 코앞에 두면 자동사격 탄이 같은 틱에 마무리해 **수정 전에도**
 * 통과한다. 그래서 600px(자동사격 탄 ≈30px/tick) 밖에 둔다.
 * ⚠️ 표적 hp 를 **추가분과 정확히 같게** 잡아, 죽는 경로가 추가분 하나뿐이 되게 한다.
 */
describe('⑯-좀비 AS4·AS5 추가 피해 사망 마킹', () => {
  const DMG = 40;
  /** AS4 Lv10 — round(40 × (1200+1800)/10000) = 12. 선타 게이트는 `hp + dmg === maxHp`. */
  const AS4_EXTRA = 12;
  /** AS5 Lv10 — round(40 × (1000+1500)/10000) = 10. 후방 반구는 dot < 0. */
  const AS5_EXTRA = 10;

  const src = (): Entity => ({ ...blankEntity('bullet'), damage: DMG });

  /** AS4: 표적을 "탄을 맞기 직전 만피" 상태로 세운다 — `maxHp = hp + dmg`. */
  function as4Setup(hp: number): { w: WorldState; t: Entity } {
    const w = mk([[AS4, 10]]);
    const p = player(w);
    const t = addEnemy(w, p.x, p.y + 600, hp);
    t.maxHp = hp + DMG;
    return { w, t };
  }

  /** AS5: 표적이 플레이어에게서 **멀어지는** 방향(vy > 0, 플레이어는 위쪽)이라 dot < 0. */
  function as5Setup(hp: number): { w: WorldState; t: Entity } {
    const w = mk([[AS5, 10]]);
    const p = player(w);
    const t = addEnemy(w, p.x, p.y + 600, hp);
    t.maxHp = 1_000_000; // AS4 선타 게이트와 무관하게 만든다
    t.vx = 0;
    t.vy = 1;
    return { w, t };
  }

  it('전제 — AS4 추가분 12 · AS5 추가분 10 이 실제로 들어간다 (하한)', () => {
    const a = as4Setup(1000);
    a.t.maxHp = 1000 + DMG;
    onEnemyDamaged(a.w, a.t, DMG, src());
    expect(a.t.hp).toBe(1000 - AS4_EXTRA);

    const b = as5Setup(1000);
    expect((b.w.entities[0]!.y - b.t.y) * b.t.vy).toBeLessThan(0); // 후방 반구다
    onEnemyDamaged(b.w, b.t, DMG, src());
    expect(b.t.hp).toBe(1000 - AS5_EXTRA);
  });

  it('AS4 — 탄을 견딘 표적이 추가분으로 hp≤0 이 되면 dead 로 마킹되고 처치·젬까지 간다', () => {
    const { w, t } = as4Setup(AS4_EXTRA);
    expect(t.dead).toBe(false);
    const killsBefore = w.kills;
    const gemsBefore = w.entities.filter((x) => x.kind === 'gem').length;
    onEnemyDamaged(w, t, DMG, src());
    expect(t.hp).toBeLessThanOrEqual(0);
    expect(t.dead).toBe(true);
    stepWorld(w, emptyInput());
    // ⚠️ id 가 아니라 **객체 동일성** — 이 파일의 `addEnemy` 는 id 를 안 매긴다.
    expect(w.entities.includes(t)).toBe(false);
    expect(w.kills).toBeGreaterThanOrEqual(killsBefore + 1);
    expect(w.entities.filter((x) => x.kind === 'gem').length).toBeGreaterThan(gemsBefore);
  });

  it('AS5 — 탄을 견딘 표적이 추가분으로 hp≤0 이 되면 dead 로 마킹되고 처치·젬까지 간다', () => {
    const { w, t } = as5Setup(AS5_EXTRA);
    expect(t.dead).toBe(false);
    const killsBefore = w.kills;
    const gemsBefore = w.entities.filter((x) => x.kind === 'gem').length;
    onEnemyDamaged(w, t, DMG, src());
    expect(t.hp).toBeLessThanOrEqual(0);
    expect(t.dead).toBe(true);
    stepWorld(w, emptyInput());
    expect(w.entities.includes(t)).toBe(false);
    expect(w.kills).toBeGreaterThanOrEqual(killsBefore + 1);
    expect(w.entities.filter((x) => x.kind === 'gem').length).toBeGreaterThan(gemsBefore);
  });

  it('표적이 살아남으면 dead 를 세우지 않는다 (과잉 마킹 금지)', () => {
    const { w, t } = as4Setup(AS4_EXTRA + 1);
    onEnemyDamaged(w, t, DMG, src());
    expect(t.hp).toBe(1);
    expect(t.dead).toBe(false);
    const killsBefore = w.kills;
    stepWorld(w, emptyInput());
    expect(w.entities.includes(t)).toBe(true);
    expect(w.kills).toBe(killsBefore);
  });
});

// ---------------------------------------------------------------------------
// ⑰ AS9 절멸 선고 — 앵커 ⑩ (강화탄 표식 → 명중 지점 폭발)
// ---------------------------------------------------------------------------

/**
 * ⚠️ 계측기 함정 둘을 여기서 막는다.
 *  ① **표적을 플레이어 코앞에 두면 안 된다** — 자동사격 탄(≈30px/tick)이 같은 틱에 마무리해
 *     수정 전에도 통과한다. 그래서 전부 600px 밖에 둔다.
 *  ② **반경 안/밖 짝을 둘 다 세운다** — 안쪽만 재면 "반경이 무한대" 인 오배선도 통과한다.
 */
describe('⑰ AS9 절멸 선고 (앵커 ⑩)', () => {
  const DMG = 100;
  /** AS9 Lv10 — 반경 100 + 10×10 = 200 · 폭발 = round(100 × (2500+1500)/10000) = 40. */
  const RADIUS = 200;
  const BLAST = 40;

  /** 강화탄 표식(`MARK_CLOAK_BREAK = 2`)이 찍힌 아군탄. 정본은 `skills/phantom.ts`. */
  const marked = (): Entity => ({ ...blankEntity('bullet'), damage: DMG, aux0: 2 });
  const plain = (): Entity => ({ ...blankEntity('bullet'), damage: DMG, aux0: 0 });

  /** 표적(600px 밖) · 반경 안 방관자 · 반경 밖 방관자. */
  function scene(points: ReadonlyArray<readonly [number, number]>): {
    w: WorldState;
    t: Entity;
    near: Entity;
    far: Entity;
  } {
    const w = mk(points);
    const p = player(w);
    const t = addEnemy(w, p.x, p.y + 600, 1_000_000);
    const near = addEnemy(w, p.x, p.y + 600 + (RADIUS - 20), 1000);
    const far = addEnemy(w, p.x, p.y + 600 + (RADIUS + 20), 1000);
    return { w, t, near, far };
  }

  it('강화탄 명중 지점 반경 안의 적만 폭발 피해를 받는다 (반경 밖은 무피해)', () => {
    const { w, t, near, far } = scene([[AS9, 10]]);
    onEnemyDamaged(w, t, DMG, marked());
    // 하한 — 배선이 끊기면 양변이 1000 이 되어 "밖은 무피해" 만으로는 항진이다.
    expect(near.hp).toBe(1000 - BLAST);
    expect(far.hp).toBe(1000);
  });

  it('**맞은 표적 자신은 제외**한다 — 광역이 단일 표적 증폭으로 퇴화하지 않는다', () => {
    const { w, t, near } = scene([[AS9, 10]]);
    const hpBefore = t.hp;
    onEnemyDamaged(w, t, DMG, marked());
    expect(t.hp).toBe(hpBefore);
    // 긍정 짝 — 같은 호출에서 주변 적에게는 실제로 들어갔다(부정 항목 단독은 항진이 된다).
    expect(near.hp).toBe(1000 - BLAST);
  });

  it('표식 없는 탄은 폭발이 없다 — 창 안 전 명중이 폭탄이 되지 않는다 (음성 짝)', () => {
    const { w, t, near } = scene([[AS9, 10]]);
    player(w).aux0 = 300; // 은신 창 안 — "지금 창인가" 로 대체 구현했다면 여기서 통과해 버린다
    onEnemyDamaged(w, t, DMG, plain());
    expect(near.hp).toBe(1000);
  });

  it('미투자 런은 강화탄이 명중해도 아무 일도 안 한다 (음성 대조)', () => {
    const { w, t, near } = scene([[AS2, 10]]);
    onEnemyDamaged(w, t, DMG, marked());
    expect(near.hp).toBe(1000);
  });

  it('레벨이 오르면 폭발 피해가 커진다 (단조 — 하한 포함)', () => {
    /** Lv1 반경(110) 안쪽에 방관자를 둔다 — 피해 축만 재려면 반경 축을 고정해야 한다. */
    function dealt(level: number): number {
      const w = mk([[AS9, level]]);
      const p = player(w);
      const t = addEnemy(w, p.x, p.y + 600, 1_000_000);
      const near = addEnemy(w, p.x, p.y + 680, 100_000); // 표적에서 80px
      onEnemyDamaged(w, t, DMG, marked());
      return 100_000 - near.hp;
    }
    const lo = dealt(1);
    // 하한 — Lv1 에서도 0 이 아니어야 아래 비교가 항진이 아니다.
    expect(lo).toBeGreaterThan(0);
    expect(dealt(20)).toBeGreaterThan(lo);
  });

  it('레벨이 오르면 반경도 커진다 — Lv10 에서 밖이던 방관자가 Lv20 에서 안이다', () => {
    const lo = scene([[AS9, 10]]);
    onEnemyDamaged(lo.w, lo.t, DMG, marked());
    expect(lo.far.hp).toBe(1000); // 하한 — Lv10 반경 200 < 220
    const hi = scene([[AS9, 20]]);
    onEnemyDamaged(hi.w, hi.t, DMG, marked());
    expect(hi.far.hp).toBeLessThan(1000); // Lv20 반경 300 > 220
  });

  it('폭발이 주변 적을 죽이면 dead 로 마킹돼 처치·젬까지 간다 (좀비 방지)', () => {
    const w = mk([[AS9, 10]]);
    const p = player(w);
    const t = addEnemy(w, p.x, p.y + 600, 1_000_000);
    const near = addEnemy(w, p.x, p.y + 600 + 100, BLAST); // 폭발 한 방에 정확히 죽는다
    const killsBefore = w.kills;
    const gemsBefore = w.entities.filter((x) => x.kind === 'gem').length;
    onEnemyDamaged(w, t, DMG, marked());
    expect(near.hp).toBeLessThanOrEqual(0);
    expect(near.dead).toBe(true);
    stepWorld(w, emptyInput());
    expect(w.entities.includes(near)).toBe(false);
    expect(w.kills).toBeGreaterThanOrEqual(killsBefore + 1);
    expect(w.entities.filter((x) => x.kind === 'gem').length).toBeGreaterThan(gemsBefore);
  });
});

// ---------------------------------------------------------------------------
// ⑱ PH3 그림자 장부 — 앵커 ⑨(본체: 콤보 시계 정지) + 앵커 ③(스케일: 회복량 가산)
// ---------------------------------------------------------------------------

describe('⑱ PH3 그림자 장부 (앵커 ⑨ + 앵커 ③)', () => {
  /** 콤보를 세워 두고 한 틱 굴린 뒤의 `comboTimer`. `updateCombo` 의 −1 이 앵커 ⑨ 뒤에 온다. */
  function tickWithCombo(
    points: ReadonlyArray<readonly [number, number]>,
    unhit: number,
    timer = 50,
  ): number {
    const w = mk(points);
    const p = player(w);
    p.aux0 = unhit;
    w.combo = 3;
    w.comboTimer = timer;
    stepWorld(w, emptyInput());
    return w.comboTimer;
  }

  it('은신 창 동안 콤보 시계가 멈춘다 (창 밖·미투자는 정상 감소 — 하한)', () => {
    // 하한 둘 — 감소가 실제로 일어나는 것을 먼저 보여야 "멈춘다" 가 무언가를 잰다.
    expect(tickWithCombo([[DI2, 1]], 300)).toBe(49); // 미투자(다른 스킬만) · 창 안
    expect(tickWithCombo([[PH3, 10]], 100)).toBe(49); // 투자 · 창 밖(적립 중)
    // 본체 — 투자 + 창 안이면 그 틱의 순변화가 0 이다.
    expect(tickWithCombo([[PH3, 10]], 300)).toBe(50);
  });

  it('`comboTimer === 0` 이면 올리지 않는다 — 유령 시계를 만들지 않는다', () => {
    expect(tickWithCombo([[PH3, 10]], 300, 0)).toBe(0);
  });

  it('창 중 젬 수거는 콤보 창 회복량이 +2 + Lv 만큼 가산된다 (창 밖·미투자는 불변)', () => {
    function collect(points: ReadonlyArray<readonly [number, number]>, unhit: number): number {
      const w = mk(points);
      const p = player(w);
      p.aux0 = unhit;
      w.comboTimer = 120;
      onGemCollected(w, { ...blankEntity('gem'), x: p.x, y: p.y });
      return w.comboTimer;
    }
    // 음성 짝 둘 — 둘 다 하한 120 이라 아래 단언이 "무언가 늘었다" 를 실제로 잰다.
    expect(collect([[DI2, 1]], 300)).toBe(120);
    expect(collect([[PH3, 10]], 100)).toBe(120);
    // Lv10 → +12.
    expect(collect([[PH3, 10]], 300)).toBe(132);
    // 단조 — Lv1 은 +3.
    expect(collect([[PH3, 1]], 300)).toBe(123);
  });
});

// ---------------------------------------------------------------------------
// ⑲ PH6 정지된 시계 — 앵커 ②(예약) + 앵커 ⑨(집행) + 진입 에지(예산 리셋)
// ---------------------------------------------------------------------------

describe('⑲ PH6 정지된 시계 (앵커 ② + ⑨)', () => {
  const pending = (w: WorldState): number =>
    readSlot(w.skillStage, PhantomStage.frozenClockPending);
  const used = (w: WorldState): number => readSlot(w.skillStage, PhantomStage.frozenClockUsed);

  it('창 안 대시만 정지를 예약한다 (창 밖·미투자는 예약 0)', () => {
    const off = mk([[PH1, 1]]);
    const q = player(off);
    q.aux0 = 300;
    onDashFired(off, q);
    expect(pending(off)).toBe(0);

    const out = mk([[PH6, 10]]);
    const r = player(out);
    r.aux0 = 100; // 창 밖 — 이쪽은 PH1 의 영역이다
    onDashFired(out, r);
    expect(pending(out)).toBe(0);

    const on = mk([[PH6, 10]]);
    const p = player(on);
    p.aux0 = 300;
    onDashFired(on, p);
    expect(pending(on)).toBe(1);
  });

  it('예약된 정지가 다음 시그니처 스텝에서 `aux0` 1 을 되돌린다 (미투자는 불변)', () => {
    const off = mk([[PH1, 1]]);
    const q = player(off);
    q.aux0 = 300;
    onDashFired(off, q);
    onSignatureStep(off, q, emptyInput());
    expect(q.aux0).toBe(300);

    const on = mk([[PH6, 10]]);
    const p = player(on);
    p.aux0 = 300;
    onDashFired(on, p);
    onSignatureStep(on, p, emptyInput());
    expect(p.aux0).toBe(299); // 곧바로 뒤따르는 world 의 `aux0++` 가 300 으로 되돌린다 = 정지
    expect(used(on)).toBe(1);
    expect(pending(on)).toBe(0); // 예약은 소비됐다
  });

  it('진입 임계(240) 정각에서는 얼리지 않는다 — 진입 훅 재발화 방지', () => {
    const w = mk([[PH6, 10]]);
    const p = player(w);
    p.aux0 = CLOAK_UNHIT_TICKS;
    onDashFired(w, p);
    expect(pending(w)).toBe(1); // 예약은 선다(창 안이다)
    onSignatureStep(w, p, emptyInput());
    expect(p.aux0).toBe(CLOAK_UNHIT_TICKS); // 239 로 내려가지 않았다
    expect(used(w)).toBe(0); // 예산도 안 깎였다
    expect(pending(w)).toBe(0); // 예약은 그래도 소비된다
  });

  it('창당 예산이 상한이다 — 소진 후 대시는 정지를 못 산다', () => {
    const w = mk([[PH6, 1]]);
    const p = player(w);
    p.aux0 = 320;
    const budget = 12 + Math.floor((24 * 1) / 10); // = 14
    for (let i = 0; i < budget + 6; i++) {
      onDashFired(w, p);
      onSignatureStep(w, p, emptyInput());
    }
    expect(used(w)).toBe(budget);
    expect(p.aux0).toBe(320 - budget);
    // 상한이 HOLD/2 를 못 넘는다(Lv20 에서 도달) — 설계서 심각-2 유계화.
    expect(12 + Math.floor((24 * 20) / 10)).toBe(Math.floor(CLOAK_HOLD_TICKS / 2));
  });

  it('은신 진입 에지가 예산을 0 으로 되돌린다 (stepWorld 관통)', () => {
    const w = mk([[PH6, 10]]);
    const p = player(w);
    writeSlot(w.skillStage, PhantomStage.frozenClockUsed, 7);
    writeSlot(w.skillStage, PhantomStage.frozenClockPending, 1);
    p.aux0 = CLOAK_UNHIT_TICKS - 1; // 이번 틱에 240 을 통과해 진입 에지가 선다
    stepWorld(w, emptyInput());
    expect(p.aux0).toBe(CLOAK_UNHIT_TICKS); // 하한 — 진입이 실제로 일어났다
    expect(used(w)).toBe(0);
    expect(pending(w)).toBe(0);
  });

  it('실제 입력 경로가 앵커를 관통한다 — 창 안 대시 다음 틱의 시계가 멈춘다 (stepWorld)', () => {
    function run(points: ReadonlyArray<readonly [number, number]>): number {
      const w = mk(points);
      const p = player(w);
      p.aux0 = 300;
      p.dashCooldown = 0;
      stepWorld(w, { ...emptyInput(), dash: true }); // 이 틱에 대시 → 예약
      stepWorld(w, emptyInput()); // 다음 틱에 집행
      return p.aux0;
    }
    // 하한 — 미투자 런은 두 틱 동안 정확히 2 늘어난다(피격이 끼면 0 이 되므로 이 값이 전제다).
    expect(run([[PH1, 1]])).toBe(302);
    // 투자 런은 한 틱이 멈춰 1 만 는다.
    expect(run([[PH6, 10]])).toBe(301);
  });
});

// ---------------------------------------------------------------------------
// ⑳ PH2 위상 착지 (앵커 ㉗ `onActiveFired`)
// ---------------------------------------------------------------------------
//
// 설계서: 위상 액티브(blink) **착지 지점** 주변 적탄 소거 + 냉기. 반경 = 140 + 10×Lv.
//
// ## 왜 `stepWorld` 가 아니라 `stepActives` 를 직접 부르는가
// 앵커 ㉗ 은 `stepActives` **안**에 있으므로 이 함수를 부르는 것이 곧 앵커를 통과하는 것이다.
// `stepWorld` 를 쓰면 같은 틱의 자동사격이 배치한 적탄·적을 **수정 전에도** 치워 버려
// (≈30px/tick) 계측이 무의미해진다 — 그래서 발사부가 안 도는 이 경로를 골랐다.
//
// ## ⚠️ 벽을 비운다
// `blink` 는 `state.activeWalls` 가 비어 있지 않으면 `slideCircleWalls` 로 착지점을 보정한다.
// 착지점을 **예측 가능한 좌표**로 고정해야 "출발 옆은 살고 착지 옆은 죽는다" 를 잴 수 있으므로
// 청크 벽을 비우고 시작한다.

describe('⑳ PH2 위상 착지 (앵커 ㉗)', () => {
  /** 위상 저티어(blink 600) 를 슬롯 0 에 실은 팬텀 런. */
  function phaseWorld(points: ReadonlyArray<readonly [number, number]>): WorldState {
    const w = createWorld(1234, {
      ...phantomConfig(),
      skillInvest: invest(points),
      activeSlots: [wireIdOf('as_phantom_phase_lo'), -1],
    });
    w.activeWalls.length = 0;
    return w;
  }

  /** 발동 방향 +x 고정. 착지점 = 발동 전 `player.x + BLINK_DISTANCE`. */
  const DIR = { x: 1, y: 0 };
  /** `data/ships/actives/phantom.ts` 의 `as_phantom_phase_lo.coeff.distance`. */
  const BLINK_DISTANCE = 600;
  const FIRE: InputFrame = { ...emptyInput(), special: SPECIAL_ACTIVE_SLOT1 };

  function addEnemyBullet(state: WorldState, x: number, y: number): Entity {
    const b: Entity = { ...blankEntity('enemyBullet'), x, y, radius: 6 };
    state.entities.push(b);
    return b;
  }

  /**
   * 착지점 기준 오프셋 배치 → 1회 발동. 반환은 [적탄, 적] 쌍의 배열.
   * 오프셋은 전부 **+y** 라 blink 축(+x)과 직교한다 — 이동 경로에 놓이지 않는다.
   */
  function fireWith(
    w: WorldState,
    offsets: readonly number[],
  ): { bullets: Entity[]; enemies: Entity[]; landingX: number } {
    const p = player(w);
    const landingX = p.x + BLINK_DISTANCE;
    const bullets: Entity[] = [];
    const enemies: Entity[] = [];
    for (const d of offsets) {
      bullets.push(addEnemyBullet(w, landingX, p.y + d));
      enemies.push(addEnemy(w, landingX, p.y + d, 1000));
    }
    stepActives(w, p, FIRE, DIR);
    return { bullets, enemies, landingX };
  }

  it('Lv1(반경 150) — 착지점 100 안쪽 적탄은 소거되고 300 바깥 적탄은 남는다', () => {
    const w = phaseWorld([[PH2, 1]]);
    const { bullets } = fireWith(w, [100, 300]);
    expect(bullets[0]?.dead).toBe(true);
    expect(bullets[1]?.dead).toBe(false);
  });

  it('Lv1 — 반경 안 잡몹에만 냉기가 걸린다 (`ownerId` = 남은 감속 틱)', () => {
    const w = phaseWorld([[PH2, 1]]);
    const { enemies } = fireWith(w, [100, 300]);
    expect(enemies[0]?.ownerId).toBe(COLD_DURATION);
    expect(enemies[1]?.ownerId).toBe(0);
    // ⚠️ 좀비 방지 — PH2 는 hp 를 깎지 않으므로 `dead` 를 세우지 않는 것이 옳다.
    expect(enemies[0]?.hp).toBe(1000);
    expect(enemies[0]?.dead).toBe(false);
  });

  it('하한 — PH2 미투자 런에서는 같은 배치의 적탄이 **둘 다 산다** (항진 방지)', () => {
    // 이 짝이 없으면 "소거됐다" 단언은 배선이 끊겨도 참일 수 있는 형태로 남는다.
    const w = phaseWorld([[PH1, 1]]);
    const { bullets, enemies } = fireWith(w, [100, 300]);
    expect(bullets[0]?.dead).toBe(false);
    expect(bullets[1]?.dead).toBe(false);
    expect(enemies[0]?.ownerId).toBe(0);
  });

  it('반경 단조 — Lv20(340)은 Lv1(150)이 못 닿던 300 지점을 소거한다', () => {
    const lo = phaseWorld([[PH2, 1]]);
    expect(fireWith(lo, [300]).bullets[0]?.dead).toBe(false);
    const hi = phaseWorld([[PH2, 20]]);
    expect(fireWith(hi, [300]).bullets[0]?.dead).toBe(true);
  });

  it('기준점은 **착지 지점**이다 — 출발 자리 옆 적탄은 Lv20 에서도 산다', () => {
    // blink 600 > Lv20 반경 340 이라, 출발 기준이었다면 이 탄이 죽는다. 앵커가 핸들러
    // **뒤**에 있다는 사실 자체를 재는 단언이다.
    const w = phaseWorld([[PH2, 20]]);
    const p = player(w);
    const atStart = addEnemyBullet(w, p.x + 20, p.y);
    const atLanding = addEnemyBullet(w, p.x + BLINK_DISTANCE, p.y + 20);
    stepActives(w, p, FIRE, DIR);
    expect(atStart.dead).toBe(false);
    expect(atLanding.dead).toBe(true);
  });

  it('계열 게이트 — 위상(treeIndex 1) 이 아닌 액티브는 정화를 일으키지 않는다', () => {
    const w = createWorld(1234, {
      ...phantomConfig(),
      skillInvest: invest([[PH2, 20]]),
      activeSlots: [wireIdOf('as_phantom_disrupt_lo'), -1],
    });
    w.activeWalls.length = 0;
    const p = player(w);
    const b = addEnemyBullet(w, p.x + 20, p.y);
    stepActives(w, p, FIRE, DIR);
    // 발동 자체는 일어났다(버프 틱이 섰다) — 그런데 적탄은 살아 있다.
    expect(w.activeBuff0).toBeGreaterThan(0);
    expect(b.dead).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ⑬ PH4 무흔 보행 (앵커 ㉙ `onPlayerMoveParams`) — 배치 5
// ---------------------------------------------------------------------------
//
// 설계서: 은신 창 동안 이속 +8% + 1%p/Lv (bp) + 이동 감속 면역.
//
// 뮤테이션(2026-08-07): `phantomPlayerMoveParams` 의 `params.slowTicks = 0` 을 지우면 감속
// 면역 2건이, `params.speedMult *= …` 를 지우면 이속 3건이, `onPlayerMoveParams` 의
// `case SIG_PHANTOM_CLOAK:` 를 지우면 §⑬ 전체가 빨개진다.

describe('⑬ PH4 무흔 보행 (앵커 ㉙)', () => {
  function moveParams(w: WorldState, slow = 0): PlayerMoveParams {
    const params: PlayerMoveParams = { speedMult: 1, slowTicks: slow };
    onPlayerMoveParams(w, player(w), params);
    return params;
  }

  it('창 밖이면 아무 일도 안 한다 (미투자 런 바이트 불변의 근거)', () => {
    const w = mk([[PH4, 20]]);
    player(w).aux0 = CLOAK_UNHIT_TICKS - 1; // 적립 중 · 창 전
    const params = moveParams(w, 30);
    expect(params.speedMult).toBe(1);
    expect(params.slowTicks).toBe(30); // 왕복 항등
  });

  it('창이 닫힌 뒤(HOLD 만료)에도 안 걸린다 — 창 술어가 상한을 본다', () => {
    const w = mk([[PH4, 20]]);
    player(w).aux0 = CLOAK_UNHIT_TICKS + CLOAK_HOLD_TICKS;
    expect(moveParams(w, 30).speedMult).toBe(1);
  });

  it('하한 짝 — PH4 미투자 런은 창 안이어도 배율 1 · 감속 그대로다 (항진 방지)', () => {
    const w = mk([[PH6, 20]]);
    player(w).aux0 = CLOAK_UNHIT_TICKS + 10;
    const params = moveParams(w, 30);
    expect(params.speedMult).toBe(1);
    expect(params.slowTicks).toBe(30);
  });

  it('창 안이면 이속이 오르고 이동 감속이 사라진다', () => {
    const w = mk([[PH4, 1]]);
    player(w).aux0 = CLOAK_UNHIT_TICKS + 10;
    const params = moveParams(w, 30);
    expect(params.speedMult).toBeGreaterThan(1); // 하한 — 양변 1 인 항진이 아니다
    expect(params.speedMult).toBeCloseTo(1.09, 9); // 800 + 100×1 bp
    expect(params.slowTicks).toBe(0);
  });

  it('레벨에 단조 증가한다 (bp = 800 + 100×Lv)', () => {
    function multAt(level: number): number {
      const w = mk([[PH4, level]]);
      player(w).aux0 = CLOAK_UNHIT_TICKS + 10;
      return moveParams(w).speedMult;
    }
    const lo = multAt(1);
    const hi = multAt(20);
    expect(lo).toBeGreaterThan(1);
    expect(hi).toBeGreaterThan(lo);
    expect(hi).toBeCloseTo(1.28, 9);
  });

  it('`stepPlayer` 가 앵커를 실제로 부른다 — 감속 지대에서 창 안이면 만속이다', () => {
    function vxUnderSlow(points: ReadonlyArray<readonly [number, number]>): number {
      const w = mk(points);
      const p = player(w);
      p.aux0 = CLOAK_UNHIT_TICKS + 10;
      w.playerSlowTicks = 60;
      stepWorld(w, { ...emptyInput(), moveX: 1 });
      return p.vx;
    }
    // 하한 — PH4 미투자 런은 감속 배율이 실제로 물린다.
    const slowed = vxUnderSlow([[PH6, 20]]);
    expect(slowed).toBeLessThan(DEFAULT_CONFIG.playerSpeed);
    // 투자 런은 감속 면역 + 이속 배율이라 만속보다도 빠르다.
    expect(vxUnderSlow([[PH4, 20]])).toBeGreaterThan(DEFAULT_CONFIG.playerSpeed);
  });
});

// ---------------------------------------------------------------------------
// ㉑ AS10 유령 탄도 (앵커 ⑯ 표식 + 벽 축 앵커 `onWallHit`)
// ---------------------------------------------------------------------------
//
// 뮤테이션(2026-08-07, 배치5) — 실제로 돌려 적색을 확인했다:
//  - `phantomVolleyParams` 의 `params.mark |= MARK_GHOST_SHOT` 제거 → 5건 적색
//  - `phantomWallHit` 의 `params.passThrough = true` 제거 → 4건 적색
//  - `phantomWallHit` 의 `bullet.kind !== 'bullet'` 조기 반환 제거 → 1건 적색
//  - `onWallHit` 의 `case SIG_PHANTOM_CLOAK` 제거 → 5건 적색
//
// ⚠️ 부정 항목("창 밖 발사탄은 안 통과한다")은 뮤테이션에 원리적으로 안 걸린다 —
//    같은 `it` 안에 **긍정 짝**(창 안 발사탄은 통과한다)을 나란히 뒀다.

describe('㉑ AS10 유령 탄도 (앵커 ⑯ 표식 + `onWallHit`)', () => {
  /** AS3 표식이 값 2, AS10 이 값 4. 둘은 같은 탄에 공존해야 한다. */
  const GHOST_BIT = 4;

  function vp(over: Partial<VolleyParams> = {}): VolleyParams {
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
      countUsed: true,
      ballisticsUsed: true,
      targetDist: 200,
      aimAngle: 0,
      inputX: 0,
      inputY: 0,
      cloakBreak: false,
      leadDamageBonus: 0,
      leadPierceBonus: 0,
      recordSpawnDamage: false,
      ...over,
    };
  }

  function wh(over: Partial<WallHitParams> = {}): WallHitParams {
    return { damage: 7, passThrough: false, shockAt: null, ...over };
  }

  /** 유령 표식을 단 아군탄. `aux0` 이 표식 칸이다. */
  function ghostBullet(mark: number): Entity {
    return { ...blankEntity('bullet'), aux0: mark, damage: 7 };
  }

  /** 파괴가능 벽(hp > 0). AS10 은 벽 종류를 안 보지만 문면의 주 대상이다. */
  function wall(): Entity {
    return { ...blankEntity('wall'), hp: 50, maxHp: 50, radius: 20 };
  }

  it('은신 창 안 발사탄만 표식을 얻고, 그 표식을 단 탄만 벽을 통과한다 (긍정 + 음성 짝)', () => {
    const w = mk([[AS10, 1]]);
    const p = player(w);

    // 창 **안** 발사 → 표식이 붙는다.
    p.aux0 = 300;
    const inside = vp();
    onVolleyParams(w, p, inside);
    expect(inside.mark & GHOST_BIT).toBe(GHOST_BIT);

    // 창 **밖** 발사 → 표식이 안 붙는다(음성).
    p.aux0 = 0;
    const outside = vp();
    onVolleyParams(w, p, outside);
    expect(outside.mark & GHOST_BIT).toBe(0);

    // 표식 있는 탄은 통과(긍정).
    const hitIn = wh();
    onWallHit(w, p, ghostBullet(inside.mark), wall(), hitIn);
    expect(hitIn.passThrough).toBe(true);

    // 표식 없는 탄은 안 통과(음성 짝 — 위 긍정과 같은 런에 있다).
    const hitOut = wh();
    onWallHit(w, p, ghostBullet(outside.mark), wall(), hitOut);
    expect(hitOut.passThrough).toBe(false);
  });

  it('미투자 런은 표식도 통과도 없다 (앵커가 실제 게이트인가)', () => {
    const w = mk();
    const p = player(w);
    p.aux0 = 300;
    const v = vp();
    onVolleyParams(w, p, v);
    expect(v.mark).toBe(0);

    // 표식이 손으로 켜져 있어도 투자 0 이면 통과하지 않는다.
    const hit = wh();
    onWallHit(w, p, ghostBullet(GHOST_BIT), wall(), hit);
    expect(hit.passThrough).toBe(false);
  });

  it('창이 끝난 뒤에도 그 탄은 계속 통과한다 — 술어는 「발사 시점」이지 「지금 은신」이 아니다', () => {
    const w = mk([[AS10, 1]]);
    const p = player(w);

    p.aux0 = 300;
    const v = vp();
    onVolleyParams(w, p, v);
    const marked = ghostBullet(v.mark);

    // 창 종료. 이미 날아가는 탄은 표식을 그대로 들고 있다.
    p.aux0 = 0;
    const hit = wh();
    onWallHit(w, p, marked, wall(), hit);
    expect(hit.passThrough).toBe(true);
  });

  it('통과는 소멸만 막는다 — `damage` 도 `shockAt` 도 한 바이트 안 건드린다', () => {
    const w = mk([[AS10, 20]]);
    const p = player(w);
    const hit = wh({ damage: 7 });
    onWallHit(w, p, ghostBullet(GHOST_BIT), wall(), hit);
    expect(hit.passThrough).toBe(true);
    // 문면 "파괴가능 벽은 **피해를 주고** 통과한다" — 감산은 호출부가 이 값으로 이미 한다.
    expect(hit.damage).toBe(7);
    expect(hit.shockAt).toBeNull();
  });

  it('적탄에는 안 걸린다 — `aux0` 비트가 우연히 겹쳐도 통과하지 않는다', () => {
    const w = mk([[AS10, 10]]);
    const p = player(w);
    const enemyShot: Entity = { ...blankEntity('enemyBullet'), aux0: GHOST_BIT, damage: 7 };
    const hit = wh();
    onWallHit(w, p, enemyShot, wall(), hit);
    expect(hit.passThrough).toBe(false);

    // 긍정 짝 — 같은 표식을 단 **아군탄**은 통과한다(위 음성이 항진이 아님의 물증).
    const friendly = wh();
    onWallHit(w, p, ghostBullet(GHOST_BIT), wall(), friendly);
    expect(friendly.passThrough).toBe(true);
  });

  it('AS3 강화탄 표식과 **공존**한다 (비트 분리의 요구)', () => {
    const w = mk([
      [AS3, 10],
      [AS10, 1],
    ]);
    const p = player(w);
    p.aux0 = 300;
    const v = vp({ cloakBreak: true });
    onVolleyParams(w, p, v);
    expect(v.mark & 2).toBe(2); // AS3
    expect(v.mark & GHOST_BIT).toBe(GHOST_BIT); // AS10
    // 두 표식이 같이 실린 탄도 통과한다.
    const hit = wh();
    onWallHit(w, p, ghostBullet(v.mark), wall(), hit);
    expect(hit.passThrough).toBe(true);
  });

  it('레벨 계단이 없다 — Lv1 과 Lv20 이 같다 (설계 문면이 이진이다)', () => {
    for (const level of [1, 20]) {
      const w = mk([[AS10, level]]);
      const p = player(w);
      p.aux0 = 300;
      const v = vp();
      onVolleyParams(w, p, v);
      expect(v.mark & GHOST_BIT).toBe(GHOST_BIT);
      const hit = wh();
      onWallHit(w, p, ghostBullet(v.mark), wall(), hit);
      expect(hit.passThrough).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// ㉒ 배치6 — DI9 유령 선체 (신설 앵커 `onPlayerWallSlide`)
// ---------------------------------------------------------------------------
//
// ## 뮤테이션 (실행함, 2026-08-07)
//  - `phantomPlayerWallSlide` 의 `params.passThrough = true` 제거 → 3건 적색
//  - `onPlayerWallSlide` 의 `case SIG_PHANTOM_CLOAK` 제거 → 3건 적색
//
// ⚠️ 부정 항목("무적이 아니면 안 통과한다")은 뮤테이션에 원리적으로 안 걸린다 —
//    같은 `it` 안에 **긍정 짝**을 나란히 뒀다.

describe('㉒ DI9 유령 선체 (앵커 `onPlayerWallSlide`)', () => {
  function ws(): WallSlideParams {
    return { passThrough: false };
  }

  it('피격 무적 동안에만 통과한다 (긍정 + 음성 짝)', () => {
    const w = mk([[DI9, 1]]);
    const p = player(w);

    // 무적 아님 → 통과 안 함.
    p.iframes = 0;
    const cold = ws();
    onPlayerWallSlide(w, p, cold);
    expect(cold.passThrough).toBe(false);

    // 같은 런·같은 훅인데 무적이면 통과한다 — 위 음성이 항진이 아니라는 물증.
    p.iframes = 30;
    const hot = ws();
    onPlayerWallSlide(w, p, hot);
    expect(hot.passThrough).toBe(true);
  });

  it('미투자 런은 무적이어도 `params` 를 한 바이트도 안 건드린다 (긍정 짝 포함)', () => {
    const off = mk();
    const q = player(off);
    q.iframes = 30;
    const a = ws();
    onPlayerWallSlide(off, q, a);
    expect(a.passThrough).toBe(false);

    const on = mk([[DI9, 1]]);
    const p = player(on);
    p.iframes = 30;
    const b = ws();
    onPlayerWallSlide(on, p, b);
    expect(b.passThrough).toBe(true);
  });

  it('레벨 계단이 없다 — Lv1 과 Lv20 이 같다 (설계 문면이 이진이다)', () => {
    for (const level of [1, 20]) {
      const w = mk([[DI9, level]]);
      const p = player(w);
      p.iframes = 1;
      const v = ws();
      onPlayerWallSlide(w, p, v);
      expect(v.passThrough).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// ㉓ 배치6 — PH9 메아리 잠행 (앵커 ㉙ + 앵커 ⑨ · `objectiveActiveOf`)
// ---------------------------------------------------------------------------
//
// ## 뮤테이션 (실행함, 2026-08-07)
//  - `phantomObjectiveResolved` 의 `advanceCloak` 제거 → 2건 적색
//  - 앵커 ⑨ 안 PH9 블록의 `player.dashCooldown` 감산 제거 → 3건 적색
//  - `onObjectiveResolved` 의 `case SIG_PHANTOM_CLOAK` 제거 → 2건 적색

describe('㉓ PH9 메아리 잠행 (앵커 ㉙ · 앵커 ⑨)', () => {
  /** 조우 런타임을 활성 상태로 세운다. `objectiveActiveOf` 는 `state` 값만 본다. */
  function setEncounter(w: WorldState, s: number): void {
    (w as unknown as { encounterRuntime?: { state: number } }).encounterRuntime = { state: s };
  }

  it('목표 완수가 즉시 은신에 진입시킨다 (미투자면 불변)', () => {
    const off = mk();
    const q = player(off);
    q.aux0 = 0;
    onObjectiveResolved(off, q, 'echo');
    expect(q.aux0).toBe(0);

    const on = mk([[PH9, 1]]);
    const p = player(on);
    p.aux0 = 0;
    onObjectiveResolved(on, p, 'echo');
    expect(p.aux0).toBe(CLOAK_UNHIT_TICKS);
  });

  it('진입은 통과 에지를 정상 발화한다 — DI8 이 그 물증이다 (음성 짝 포함)', () => {
    // DI8 은 **은신 진입 에지에서만** 최대 HP 를 올린다. 그것이 오르면 `advanceCloak` 이
    // 임계를 건너뛰지 않고 `fireCloakEntry` 를 태웠다는 뜻이다.
    const w = mk([
      [PH9, 1],
      [DI8, 10],
    ]);
    const p = player(w);
    p.aux0 = 0;
    const before = p.maxHp;
    onObjectiveResolved(w, p, 'encounter');
    expect(p.maxHp).toBeGreaterThan(before);

    // 음성 짝 — PH9 미투자면 같은 완수에도 진입이 없어 DI8 도 안 돈다.
    const off = mk([[DI8, 10]]);
    const q = player(off);
    q.aux0 = 0;
    const b2 = q.maxHp;
    onObjectiveResolved(off, q, 'encounter');
    expect(q.maxHp).toBe(b2);
  });

  it('조우가 활성인 동안에만 대시 쿨다운이 빨리 식는다 (긍정 + 음성 짝)', () => {
    const w = mk([[PH9, 1]]);
    const p = player(w);

    // 비활성 — 이 앵커는 대시 쿨다운을 한 틱도 안 건드린다.
    p.dashCooldown = 100;
    onSignatureStep(w, p, emptyInput());
    expect(p.dashCooldown).toBe(100);

    // 활성 — 틱당 1 + floor(Lv/10) = 1 추가 감소.
    setEncounter(w, 2);
    onSignatureStep(w, p, emptyInput());
    expect(p.dashCooldown).toBe(99);
  });

  it('가속량이 레벨에 단조 증가한다 (하한 짝: 미투자 런은 0 이다)', () => {
    const off = mk();
    const q = player(off);
    q.dashCooldown = 100;
    setEncounter(off, 1);
    onSignatureStep(off, q, emptyInput());
    // ⚠️ 하한 짝이 없으면 "양변이 0 이라 성립" 하는 항진이 된다.
    expect(100 - q.dashCooldown).toBe(0);

    let prev = 0;
    for (const level of [1, 10, 20]) {
      const w = mk([[PH9, level]]);
      const p = player(w);
      p.dashCooldown = 100;
      setEncounter(w, 1);
      onSignatureStep(w, p, emptyInput());
      const drop = 100 - p.dashCooldown;
      expect(drop).toBeGreaterThan(0);
      expect(drop).toBeGreaterThanOrEqual(prev);
      prev = drop;
    }
    // Lv20 = 1 + floor(20/10) = 3.
    expect(prev).toBe(3);
  });

  it('쿨다운이 0 아래로 내려가지 않는다', () => {
    const w = mk([[PH9, 20]]);
    const p = player(w);
    p.dashCooldown = 1;
    setEncounter(w, 2);
    onSignatureStep(w, p, emptyInput());
    expect(p.dashCooldown).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ㉔ 배치6 — PH5 연장 위상 (앵커 ⑨ · 창 마지막 틱 정지)
// ---------------------------------------------------------------------------
//
// ## 뮤테이션 (실행함, 2026-08-07)
//  - `player.aux0 = a - 1` 제거 → 3건 적색
//
// ⚠️ **`!stalledThisTick` 만 지우는 뮤테이션은 적색이 되지 않는다 — 실측했다.** PH6 이 먼저
//    `aux0` 을 한 칸 내려서 PH5 의 `a === 마지막 틱` 이 그 틱에 이미 거짓이기 때문이다. 즉
//    겹침을 실제로 막는 것은 **순서**이고 그 플래그는 두 겹째다(효과 함수 주석에 같은 사실을
//    적어 뒀다). 아래 「PH6 과 같은 틱에 겹치지 않는다」는 그 **불변식**을 잠그는 것이지
//    플래그의 존재를 잠그는 것이 아니다 — 순서가 뒤집히면 그때 이 케이스가 적색이 된다.

describe('㉔ PH5 연장 위상 (앵커 ⑨)', () => {
  const LAST = CLOAK_UNHIT_TICKS + CLOAK_HOLD_TICKS - 1;

  /**
   * 창 마지막 틱부터 굴린다 — 앵커 ⑨ 뒤에 world 의 `aux0++` 가 온다는 순서를 그대로 흉내
   * 낸다. 창이 끝나기까지(= `aux0` 이 임계를 넘기까지) 걸린 틱 수를 돌려준다.
   */
  function ticksToExit(w: WorldState, p: Entity, limit: number): number {
    p.aux0 = LAST;
    for (let i = 1; i <= limit; i++) {
      onSignatureStep(w, p, emptyInput());
      p.aux0 = Math.trunc(p.aux0) + 1; // world 의 적립
      if (Math.trunc(p.aux0) >= CLOAK_UNHIT_TICKS + CLOAK_HOLD_TICKS) return i;
    }
    return limit + 1;
  }

  it('창이 예산만큼 정확히 늘어난다 (하한 짝: 미투자 런은 1틱에 끝난다)', () => {
    const off = mk();
    // ⚠️ 하한 짝 — 배선이 끊기면 아래 비교의 양변이 같아져 항진이 된다.
    expect(ticksToExit(off, player(off), 400)).toBe(1);

    // Lv1 예산 = floor(120 × 1 / 20) = 6 → 마지막 틱을 6번 더 붙잡는다.
    const lv1 = mk([[PH5, 1]]);
    expect(ticksToExit(lv1, player(lv1), 400)).toBe(7);

    // Lv20 예산 = floor(120 × 20 / 20) = 120 → 창이 정확히 두 배가 된다.
    const lv20 = mk([[PH5, 20]]);
    expect(ticksToExit(lv20, player(lv20), 400)).toBe(121);
  });

  it('예산은 창당이다 — 진입 에지가 리셋한다', () => {
    const w = mk([[PH5, 1]]);
    const p = player(w);
    expect(ticksToExit(w, p, 400)).toBe(7);
    expect(readSlot(w.skillStage, PhantomStage.extendedHoldUsed)).toBe(6);

    // 다음 창 진입(자연 적립 통과 에지)이 예산을 되돌린다.
    p.aux0 = CLOAK_UNHIT_TICKS - 1;
    stepWorld(w, emptyInput());
    expect(readSlot(w.skillStage, PhantomStage.extendedHoldUsed)).toBe(0);
    expect(ticksToExit(w, p, 400)).toBe(7);
  });

  it('창 **중간** 틱은 붙잡지 않는다 — DI2 주기 중복을 원천 차단한다 (긍정 짝 포함)', () => {
    const w = mk([[PH5, 20]]);
    const p = player(w);
    // 창 한복판(300) — 여기서 붙잡으면 DI2 의 `(a − 240) % 60` 이 여러 번 참이 된다.
    p.aux0 = 300;
    onSignatureStep(w, p, emptyInput());
    expect(p.aux0).toBe(300);
    // 긍정 짝 — 같은 런·같은 훅인데 마지막 틱에서는 붙잡는다.
    p.aux0 = LAST;
    onSignatureStep(w, p, emptyInput());
    expect(p.aux0).toBe(LAST - 1);
  });

  it('PH6 과 같은 틱에 겹치지 않는다 — 순변화가 −1 이 되지 않는다', () => {
    const w = mk([
      [PH5, 20],
      [PH6, 20],
    ]);
    const p = player(w);
    p.aux0 = LAST;
    writeSlot(w.skillStage, PhantomStage.frozenClockPending, 1);
    onSignatureStep(w, p, emptyInput());
    // 둘 다 걸렸다면 357 이 된다. 하나만 산다.
    expect(p.aux0).toBe(LAST - 1);
    expect(
      readSlot(w.skillStage, PhantomStage.frozenClockUsed) +
        readSlot(w.skillStage, PhantomStage.extendedHoldUsed),
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ㉕ 배치6 — AS8 처형인의 적공 (앵커 ⑪ 적립 + 앵커 ⑯ 소비)
// ---------------------------------------------------------------------------
//
// ## 뮤테이션 (실행함, 2026-08-07)
//  - `phantomEnemyDeath` 의 `writeSlot` 제거 → 4건 적색
//  - 소비부의 `params.damage = …` 제거 → 2건 적색
//  - `onEnemyDeath` 의 `case SIG_PHANTOM_CLOAK` 제거 → 4건 적색

describe('㉕ AS8 처형인의 적공 (앵커 ⑪ · 앵커 ⑯)', () => {
  function vp8(over: Partial<VolleyParams> = {}): VolleyParams {
    return {
      damage: 250,
      pierce: 0,
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
      inputX: 0,
      inputY: 0,
      cloakBreak: false,
      leadDamageBonus: 0,
      leadPierceBonus: 0,
      recordSpawnDamage: false,
      ...over,
    };
  }

  function kill(w: WorldState, n: number): void {
    for (let i = 0; i < n; i++) onEnemyDeath(w, 0, 0, false, false);
  }

  it('처치가 스택으로 쌓인다 (미투자면 슬롯이 0 그대로다)', () => {
    const off = mk();
    kill(off, 3);
    expect(readSlot(off.skillCarry, PhantomCarry.executionerStacks)).toBe(0);

    const on = mk([[AS8, 1]]);
    kill(on, 3);
    expect(readSlot(on.skillCarry, PhantomCarry.executionerStacks)).toBe(3);
  });

  it('스택에 상한이 있다 — 장기 런에서 한 발이 무한히 커지지 않는다', () => {
    const w = mk([[AS8, 20]]);
    kill(w, 50);
    expect(readSlot(w.skillCarry, PhantomCarry.executionerStacks)).toBe(20);
  });

  it('해제 첫 타 볼리에서만 가산되고 그 자리에서 비워진다 (긍정 + 음성 짝)', () => {
    const w = mk([[AS8, 10]]);
    const p = player(w);
    kill(w, 3);

    // 음성 — 평범한 볼리는 스택이 있어도 한 바이트도 안 바뀐다.
    const plain = vp8({ cloakBreak: false });
    onVolleyParams(w, p, plain);
    expect(plain.damage).toBe(250);
    expect(readSlot(w.skillCarry, PhantomCarry.executionerStacks)).toBe(3);

    // 긍정 — 해제 첫 타 볼리는 가산되고 스택이 0 이 된다.
    // 스택당 100 + 25×10 = 350bp · 3스택 = 1050bp → 250 × 26050/25000 = 260.5 → 261.
    const breakShot = vp8({ cloakBreak: true });
    onVolleyParams(w, p, breakShot);
    expect(breakShot.damage).toBe(261);
    expect(readSlot(w.skillCarry, PhantomCarry.executionerStacks)).toBe(0);

    // 비운 뒤 곧바로 또 첫 타가 와도 가산이 없다(같은 스택을 두 번 안 쓴다).
    const again = vp8({ cloakBreak: true });
    onVolleyParams(w, p, again);
    expect(again.damage).toBe(250);
  });

  it('가산이 스택 수와 레벨에 단조 증가한다 (하한 짝: 0스택은 0 이다)', () => {
    const zero = mk([[AS8, 10]]);
    const pz = player(zero);
    const v0 = vp8({ cloakBreak: true });
    onVolleyParams(zero, pz, v0);
    // ⚠️ 하한 짝 — 배선이 끊기면 아래 단조 비교가 전부 0 대 0 으로 성립한다.
    expect(v0.damage - 250).toBe(0);

    let prev = 0;
    for (const [level, stacks] of [
      [1, 1],
      [10, 3],
      [20, 10],
    ] as const) {
      const w = mk([[AS8, level]]);
      const p = player(w);
      kill(w, stacks);
      const v = vp8({ cloakBreak: true });
      onVolleyParams(w, p, v);
      const gain = v.damage - 250;
      expect(gain).toBeGreaterThan(0);
      expect(gain).toBeGreaterThan(prev);
      prev = gain;
    }
  });

  it('침공에서는 스택이 한 칸도 안 쌓인다 — 해시에 접히는 유령 상태를 막는다', () => {
    const w = mk([[AS8, 20]]);
    (w.config as { invasion3?: unknown }).invasion3 = { seed: 1 };
    kill(w, 5);
    expect(readSlot(w.skillCarry, PhantomCarry.executionerStacks)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ㉖ 배치6 — AS1 이중 각인 (앵커 ⑯ + 예약 슬롯)
// ---------------------------------------------------------------------------
//
// ## 뮤테이션 (실행함, 2026-08-07)
//  - 소비부의 `params.damage = …` 제거 → 4건 적색

describe('㉖ AS1 이중 각인 (앵커 ⑯)', () => {
  function vp1(over: Partial<VolleyParams> = {}): VolleyParams {
    return {
      damage: 100,
      pierce: 0,
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
      inputX: 0,
      inputY: 0,
      cloakBreak: false,
      leadDamageBonus: 0,
      leadPierceBonus: 0,
      recordSpawnDamage: false,
      ...over,
    };
  }

  it('해제 첫 타 **다음** 볼리 한 발에만 후속 배율이 실린다 (긍정 + 음성 짝)', () => {
    const w = mk([[AS1, 20]]);
    const p = player(w);

    // ① 첫 타 자체는 안 건드린다(원배율은 world 소진 지점이 이미 먹였다).
    const first = vp1({ cloakBreak: true });
    onVolleyParams(w, p, first);
    expect(first.damage).toBe(100);
    expect(readSlot(w.skillStage, PhantomStage.twinMarkPending)).toBe(1);

    // ② 다음 볼리 — Lv20 후속 배율 bp = 16070 → 100 × 1.607 = 160.7 → 161.
    const second = vp1();
    onVolleyParams(w, p, second);
    expect(second.damage).toBe(161);
    expect(readSlot(w.skillStage, PhantomStage.twinMarkPending)).toBe(0);

    // ③ 그 다음은 평타다 — "한 발 더" 가 두 발이 되지 않는다(음성 짝).
    const third = vp1();
    onVolleyParams(w, p, third);
    expect(third.damage).toBe(100);
  });

  it('미투자 런은 예약도 배율도 없다 (긍정 짝 포함)', () => {
    const off = mk();
    const q = player(off);
    onVolleyParams(off, q, vp1({ cloakBreak: true }));
    expect(readSlot(off.skillStage, PhantomStage.twinMarkPending)).toBe(0);
    const a = vp1();
    onVolleyParams(off, q, a);
    expect(a.damage).toBe(100);

    const on = mk([[AS1, 20]]);
    const p = player(on);
    onVolleyParams(on, p, vp1({ cloakBreak: true }));
    const b = vp1();
    onVolleyParams(on, p, b);
    expect(b.damage).toBe(161);
  });

  it('후속 배율이 레벨에 단조 증가하고 **원배율(2.5배)보다 작다**', () => {
    let prev = 0;
    for (const level of [1, 10, 20]) {
      const w = mk([[AS1, level]]);
      const p = player(w);
      onVolleyParams(w, p, vp1({ cloakBreak: true }));
      const v = vp1();
      onVolleyParams(w, p, v);
      expect(v.damage).toBeGreaterThan(prev);
      // AS3(재장전 = 원배율)과 값이 같아지면 두 스킬이 하나가 된다 — 그 경계를 잠근다.
      expect(v.damage).toBeLessThan(250);
      prev = v.damage;
    }
    // Lv1 = 84(평타보다 작다 — 설계 문면 그대로다) · Lv20 = 161.
    expect(prev).toBe(161);
  });

  it('다음 볼리가 또 해제 첫 타면 얹지 않고 예약만 다시 세운다 (AS3 재장전 연쇄)', () => {
    const w = mk([[AS1, 20]]);
    const p = player(w);
    onVolleyParams(w, p, vp1({ cloakBreak: true }));
    const chained = vp1({ cloakBreak: true });
    onVolleyParams(w, p, chained);
    expect(chained.damage).toBe(100);
    expect(readSlot(w.skillStage, PhantomStage.twinMarkPending)).toBe(1);
    // 연쇄가 끝난 뒤의 한 발이 후속 배율을 받는다.
    const tail = vp1();
    onVolleyParams(w, p, tail);
    expect(tail.damage).toBe(161);
  });
});

// ---------------------------------------------------------------------------
// ㉗ AS6 무성 격살 (앵커 신설 `onDeathRemnantSpawn`, 배치7 F2a 선결)
// ---------------------------------------------------------------------------
//
// ⚠️ AS6 은 **부정 항목**이다("잔재가 안 생긴다") — 원리적으로 뮤테이션 실증에 안 걸린다
// (효과 본체를 지워도 "여전히 안 생긴다" 는 관측이 안 갈린다). 그래서 **긍정 짝**
// ("은신 중이 아니면 잔재가 생긴다" = 훅이 `false` 를 돌려준다)을 반드시 옆에 둔다 — 이 절이
// 재는 것은 정확히 그 술어 하나다. `elite` 인자는 함수가 아예 읽지 않으므로(설계서 "사망
// 원인 귀속 불요") 아무 엔티티나 넘겨도 무방하다.

describe('㉗ AS6 무성 격살 (앵커 `onDeathRemnantSpawn`)', () => {
  const elite = (): Entity => ({ ...blankEntity('enemy'), pierce: 1 }); // ELITE_SPLIT+1 마커

  it('은신 창 안이면 사망 잔재 스폰을 억제한다', () => {
    const w = mk([[AS6, 1]]);
    player(w).aux0 = 300; // 은신 창 안(240..359)
    expect(onDeathRemnantSpawn(w, elite())).toBe(true);
  });

  it('은신 중이 아니면 억제하지 않는다 (긍정 짝 — 부정 항목 뮤테이션의 대체)', () => {
    const w = mk([[AS6, 1]]);
    player(w).aux0 = 100; // 창 밖(적립 중)
    expect(onDeathRemnantSpawn(w, elite())).toBe(false);
  });

  it('미투자 런은 은신 중이어도 억제하지 않는다 (음성 대조)', () => {
    const w = mk();
    player(w).aux0 = 300;
    expect(onDeathRemnantSpawn(w, elite())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ㉘ AS7 원한 청산 (앵커 ④ 표적 갱신 + 앵커 ⑩ 증폭·해제, 배치7 F2a 선결)
// ---------------------------------------------------------------------------

describe('㉘ AS7 원한 청산 (앵커 ④ + 앵커 ⑩)', () => {
  it('피격원 id 가 원한 표적으로 저장된다 (미투자 불변)', () => {
    const off = mk();
    onPlayerDamaged(
      off,
      player(off),
      5,
      false,
      DamageSource.bullet,
      undefined,
      undefined,
      undefined,
      777,
    );
    expect(readSlot(off.skillStage, PhantomStage.grudgeTargetId)).toBe(0);

    const on = mk([[AS7, 10]]);
    onPlayerDamaged(
      on,
      player(on),
      5,
      false,
      DamageSource.bullet,
      undefined,
      undefined,
      undefined,
      777,
    );
    expect(readSlot(on.skillStage, PhantomStage.grudgeTargetId)).toBe(777);
  });

  it('피격원 id 를 모르면(해저드 등) 기존 표적을 갱신하지 않는다', () => {
    const w = mk([[AS7, 10]]);
    writeSlot(w.skillStage, PhantomStage.grudgeTargetId, 5);
    onPlayerDamaged(w, player(w), 5, false, DamageSource.hazard);
    expect(readSlot(w.skillStage, PhantomStage.grudgeTargetId)).toBe(5);
  });

  it('원한 표적에게 주는 피해만 증폭된다 (다른 적은 불변)', () => {
    const w = mk([[AS7, 10]]);
    const p = player(w);
    writeSlot(w.skillStage, PhantomStage.grudgeTargetId, 501);
    const t = addEnemy(w, p.x, p.y + 600, 1000);
    t.id = 501;
    // bp = 2000 + floor(6000×10/22) = 4727. extra = round(20×4727/10000) = 9.
    onEnemyDamaged(w, t, 20, undefined);
    expect(t.hp).toBe(991);

    const other = addEnemy(w, p.x, p.y + 600, 1000);
    other.id = 999;
    onEnemyDamaged(w, other, 20, undefined);
    expect(other.hp).toBe(1000);
  });

  it('미투자 런은 표적으로 저장돼 있어도 증폭이 없다 (음성 대조)', () => {
    const w = mk([[AS2, 10]]);
    const p = player(w);
    writeSlot(w.skillStage, PhantomStage.grudgeTargetId, 501);
    const t = addEnemy(w, p.x, p.y + 600, 1000);
    t.id = 501;
    onEnemyDamaged(w, t, 20, undefined);
    expect(t.hp).toBe(1000);
  });

  it('표적을 처치하면 해제된다 — 이후 같은 id 를 재사용해도 다시 증폭하지 않는다', () => {
    const w = mk([[AS7, 10]]);
    const p = player(w);
    writeSlot(w.skillStage, PhantomStage.grudgeTargetId, 42);
    const t = addEnemy(w, p.x, p.y + 600, 9); // 증폭분(9)에 정확히 죽는다
    t.id = 42;
    onEnemyDamaged(w, t, 20, undefined);
    expect(t.hp).toBeLessThanOrEqual(0);
    expect(t.dead).toBe(true);
    expect(readSlot(w.skillStage, PhantomStage.grudgeTargetId)).toBe(0);

    const t2 = addEnemy(w, p.x, p.y + 600, 1000);
    t2.id = 42; // id 재사용 — 해제됐으니 더 이상 표적이 아니다
    onEnemyDamaged(w, t2, 20, undefined);
    expect(t2.hp).toBe(1000);
  });

  it('표적이 살아남으면 해제되지 않는다 (과잉 해제 금지)', () => {
    const w = mk([[AS7, 10]]);
    const p = player(w);
    writeSlot(w.skillStage, PhantomStage.grudgeTargetId, 42);
    const t = addEnemy(w, p.x, p.y + 600, 10); // 증폭분(9)보다 크다 — 견딘다
    t.id = 42;
    onEnemyDamaged(w, t, 20, undefined);
    expect(t.dead).toBe(false);
    expect(readSlot(w.skillStage, PhantomStage.grudgeTargetId)).toBe(42);
  });

  it('원거리 피격(적탄)으로도 발사자 id 가 원한 표적으로 잡힌다 (stepWorld)', () => {
    const w = mk([[AS7, 10]]);
    const p = player(w);
    const bullet: Entity = {
      ...blankEntity('enemyBullet'),
      x: p.x,
      y: p.y,
      radius: 4,
      damage: 5,
      life: 60,
      hp: 1,
      maxHp: 1,
      ownerId: 321,
    };
    w.entities.push(bullet);
    stepWorld(w, emptyInput());
    expect(readSlot(w.skillStage, PhantomStage.grudgeTargetId)).toBe(321);
  });

  it('접촉 피해도 접촉 적 자신의 id 가 원한 표적으로 잡힌다 (stepWorld)', () => {
    const w = mk([[AS7, 10]]);
    const p = player(w);
    const e = addEnemy(w, p.x, p.y, 10);
    e.id = 654;
    e.damage = 5;
    stepWorld(w, emptyInput());
    expect(readSlot(w.skillStage, PhantomStage.grudgeTargetId)).toBe(654);
  });
});
