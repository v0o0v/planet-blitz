/**
 * 브루저 30스킬 배선(ADR-0049 배치 2) — **앵커를 통과하는 관측 테스트**.
 *
 * ## 왜 효과 함수를 직접 부르지 않는가
 * `src/sim/skills/bruiser.ts` 의 함수를 직접 부르면 "효과 산술이 맞다"만 잰다. 이 저장소가
 * 반복해서 밟은 실패는 그쪽이 아니라 **"고쳐 놨는데 아무도 안 부른다"** 였다. 그래서 전부
 * `skillHooks.ts` 의 **공개 앵커**를 통해 자극한다 — `case SIG_BRUISER_ARMOR:` 를 지우면
 * 즉시 빨개진다(뮤테이션으로 확인했다, 아래).
 *
 * ## 뮤테이션으로 계측기를 검사했다 (2026-08-06)
 *  ① **효과 본체 삭제** — `bruiserDashFired` 의 MO1 블록(`aux0` 가산 + `aux1 = 0`)을 지우면
 *     §② 가 실패한다.
 *  ② **배선 이음매 치환** — 앵커 ⑨(`dispatchSignatureStepSkill`)의 `case SIG_BRUISER_ARMOR:`
 *     를 지우면 §⑦ FO1 · §⑧ FO2 정산 · §⑨ MO6 이 함께 실패한다.
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
  onPlayerDamaged,
  onDamageChain,
  onSignatureStep,
  onEnemyDamaged,
  onEnemyDeath,
  onVolleyParams,
  type VolleyParams,
} from '../src/sim/skillHooks.js';
import { SIG_BRUISER_ARMOR, ARMOR_MAX_STACKS } from '../src/sim/shipSignature.js';
import {
  BruiserCarry,
  BruiserStage,
  readSlot,
  writeSlot,
  SKILL_SLOT_COUNT,
} from '../src/sim/skillSlots.js';

/** `data/ships/index.ts` 의 타입 id. `armorCapDerivation.test.ts` 와 같은 상수다. */
const SHIP_BRUISER = 1;

/**
 * flat 인덱스 — **정본은 `data/ships/bruiser.ts` 의 `trees` 배열**이다:
 * `[blade(offense), morph(utility), fortify(defense)]` → BL 0..9 · MO 10..19 · FO 20..29.
 * ⚠️ 스트라이커와 축 종류의 순서가 다르다(스트라이커는 축1=defense).
 */
const BL2 = 1;
const BL3 = 2;
const BL4 = 3;
const BL6 = 5;
const BL9 = 8;
const MO1 = 10;
const MO6 = 15;
const MO8 = 17;
const MO9 = 18;
const FO1 = 20;
const FO2 = 21;
const FO5 = 24;
const FO6 = 25;
const FO7 = 26;

function invest(points: ReadonlyArray<readonly [number, number]>): number[] {
  const v = new Array<number>(30).fill(0);
  for (const [i, n] of points) v[i] = n;
  return v;
}

/** 브루저 런. `armorCapDerivation.test.ts` 의 레시피와 동형(피격이 잦되 죽지 않는다). */
function bruiserConfig(): WorldConfig {
  return {
    ...DEFAULT_CONFIG,
    planet: 0,
    stage: 1,
    shipType: SHIP_BRUISER,
    playerHp: 100_000_000,
    loadout: { ...neutralLoadout(), weaponType: 0 },
  };
}

function mk(points: ReadonlyArray<readonly [number, number]> = []): WorldState {
  return createWorld(1234, { ...bruiserConfig(), skillInvest: invest(points) });
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

function countBullets(state: WorldState): number {
  let n = 0;
  for (const e of state.entities) if (e.kind === 'bullet' && !e.dead) n++;
  return n;
}

// ---------------------------------------------------------------------------
// ⓪ 전제 — 이 테스트가 브루저를 자극하고 있는가
// ---------------------------------------------------------------------------

describe('⓪ 전제', () => {
  it('shipType 1 런은 브루저 시그니처이고 투자 벡터는 30칸이다', () => {
    const w = mk([[MO1, 1]]);
    expect(w.sigBit).toBe(SIG_BRUISER_ARMOR);
    expect(w.skillsOn).toBe(true);
    expect(w.config.skillInvest).toHaveLength(30);
    expect(w.skillDerived.shipType).toBe(SHIP_BRUISER);
  });

  it('투자 0 런은 `skillsOn` 이 거짓이라 앵커가 첫 줄에서 반환한다', () => {
    expect(mk().skillsOn).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ① 불변 계약 — 투자 0 런은 바이트 불변이어야 한다
// ---------------------------------------------------------------------------

describe('① 투자 0 런 불변', () => {
  it('투자 0 브루저 런 두 개가 240틱 뒤 같은 해시다 (슬롯도 전부 0)', () => {
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
    // 것은 "스킬 경로가 한 줄도 안 돌았다" 이고, 그 관측면은 **엔티티·슬롯 상태**다.
    const none = createWorld(77, { ...bruiserConfig() });
    const zero = createWorld(77, { ...bruiserConfig(), skillInvest: invest([]) });
    for (let i = 0; i < 180; i++) {
      stepWorld(none, emptyInput());
      stepWorld(zero, emptyInput());
    }
    expect(zero.entities.length).toBe(none.entities.length);
    expect(player(zero).aux0).toBe(player(none).aux0);
    expect(player(zero).aux1).toBe(player(none).aux1);
    expect(player(zero).hp).toBe(player(none).hp);
    expect(player(zero).maxHp).toBe(player(none).maxHp);
    expect(player(zero).targetX).toBe(player(none).targetX);
    expect(zero.armorMaxStacks).toBe(none.armorMaxStacks);
  });

  it('**다른 스킬만 찍은 런**에서도 미투자 스킬은 작동하지 않는다 (`skillsOn` 만으로는 부족)', () => {
    // MO9 만 찍었는데 MO1(대시 적립)이 돌면 게이트가 `skillsOn` 에 기대고 있다는 뜻이다.
    const w = mk([[MO9, 20]]);
    const p = player(w);
    p.aux0 = 3;
    p.aux1 = 99;
    p.dashCooldown = 40;
    w.wallContactTicks = 5;
    onDashFired(w, p);
    expect(p.aux0).toBe(3); // MO1 미투자 → 적립 없음
    expect(p.aux1).toBe(99); // MO1 미투자 → 타이머 불변
    expect(p.dashCooldown).toBe(40); // MO8 미투자 → 환급 없음
  });
});

// ---------------------------------------------------------------------------
// ② 앵커 ② 대시 — MO1 충각 적재
// ---------------------------------------------------------------------------

describe('② MO1 충각 적재 (앵커 ②)', () => {
  it('대시 발동이 장갑 스택을 올리고 감쇠 타이머를 리셋한다', () => {
    const off = mk();
    const on = mk([[MO1, 1]]);
    for (const w of [off, on]) {
      const p = player(w);
      p.aux0 = 2;
      p.aux1 = 150;
      onDashFired(w, p);
    }
    expect(player(off).aux0).toBe(2);
    expect(player(off).aux1).toBe(150);
    expect(player(on).aux0).toBe(3);
    expect(player(on).aux1).toBe(0);
  });

  it('적립은 이 런의 유효 상한을 넘지 않는다', () => {
    const w = mk([[MO1, 5]]);
    const p = player(w);
    p.aux0 = w.armorMaxStacks;
    onDashFired(w, p);
    expect(p.aux0).toBe(w.armorMaxStacks);
  });
});

// ---------------------------------------------------------------------------
// ③ 앵커 ② 대시 — MO8 벽 되튐
// ---------------------------------------------------------------------------

describe('③ MO8 벽 되튐 (앵커 ②)', () => {
  it('직전 틱 벽 접촉이 있을 때만 대시 쿨다운이 환급된다', () => {
    const hit = mk([[MO8, 10]]);
    const miss = mk([[MO8, 10]]);
    hit.wallContactTicks = 3;
    miss.wallContactTicks = 0;
    player(hit).dashCooldown = 100;
    player(miss).dashCooldown = 100;
    onDashFired(hit, player(hit));
    onDashFired(miss, player(miss));
    // 비율 = 3000 + round(2000×10/20) = 4000bp → 100 − 40 = 60.
    expect(player(hit).dashCooldown).toBe(60);
    expect(player(miss).dashCooldown).toBe(100);
  });

  it('환급은 0 밑으로 내려가지 않는다', () => {
    const w = mk([[MO8, 20]]);
    w.wallContactTicks = 1;
    player(w).dashCooldown = 1;
    onDashFired(w, player(w));
    expect(player(w).dashCooldown).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// ④ 앵커 ③ 젬 — MO9 수확 고정
// ---------------------------------------------------------------------------

describe('④ MO9 수확 고정 (앵커 ③)', () => {
  it('젬 수거가 감쇠 타이머를 되감고, 0 밑으로는 안 내려간다', () => {
    const off = mk();
    const on = mk([[MO9, 7]]);
    const gem: Entity = blankEntity('gem');
    for (const w of [off, on]) {
      player(w).aux1 = 100;
      onGemCollected(w, gem);
    }
    expect(player(off).aux1).toBe(100);
    expect(player(on).aux1).toBe(100 - (6 + 2 * 7)); // 80

    const floor = mk([[MO9, 20]]);
    player(floor).aux1 = 3;
    onGemCollected(floor, gem);
    expect(player(floor).aux1).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 앵커 ④ 피격 — BL4 과적 배출 · FO5 불괴 연쇄
// ---------------------------------------------------------------------------

describe('⑤ BL4 과적 배출 (앵커 ④)', () => {
  it('만재 피격이 파편을 뿌리고, 만재가 아니면 안 뿌린다', () => {
    const full = mk([[BL4, 6]]);
    const partial = mk([[BL4, 6]]);
    const off = mk();
    player(full).aux0 = full.armorMaxStacks;
    player(partial).aux0 = 1;
    player(off).aux0 = off.armorMaxStacks;
    const before = countBullets(full);
    onPlayerDamaged(full, player(full), 20, false);
    onPlayerDamaged(partial, player(partial), 20, false);
    onPlayerDamaged(off, player(off), 20, false);
    // 파편 수 = 4 + ceil(6/3) = 6.
    expect(countBullets(full) - before).toBe(6);
    expect(countBullets(partial)).toBe(before);
    expect(countBullets(off)).toBe(before);
  });
});

describe('⑥ FO5 불괴 연쇄 (앵커 ④)', () => {
  it('죽을 뻔한 틱에만 발동하고, **런당 1회**로 억제된다', () => {
    const w = mk([[FO5, 3]]);
    const p = player(w);
    p.aux0 = 0;
    // 적탄을 반경 안에 둔다.
    w.entities.push({ ...blankEntity('enemyBullet'), x: p.x + 10, y: p.y });

    // ① 평범한 피격 — 미발동.
    onPlayerDamaged(w, p, 10, false);
    expect(p.aux0).toBe(0);
    expect(p.targetX).toBe(0);

    // ② 치명 생존 — 발동.
    onPlayerDamaged(w, p, 10, true);
    expect(p.aux0).toBe(w.armorMaxStacks);
    expect(p.targetX).toBe(1);
    expect(w.entities.some((e) => e.kind === 'enemyBullet' && !e.dead)).toBe(false);

    // ③ 두 번째 치명 생존 — 억제로 미발동.
    p.aux0 = 2;
    w.entities.push({ ...blankEntity('enemyBullet'), x: p.x + 10, y: p.y });
    onPlayerDamaged(w, p, 10, true);
    expect(p.aux0).toBe(2);
    expect(w.entities.some((e) => e.kind === 'enemyBullet' && !e.dead)).toBe(true);
  });

  it('미투자 런은 치명 생존에서도 표식을 세우지 않는다', () => {
    const w = mk([[MO9, 5]]);
    const p = player(w);
    onPlayerDamaged(w, p, 10, true);
    expect(p.targetX).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑦ 앵커 ⑨ — FO1 과적 장갑
// ---------------------------------------------------------------------------

describe('⑦ FO1 과적 장갑 (앵커 ⑨)', () => {
  it('상한이 확장되고, 미투자 런은 기본 상한 그대로다', () => {
    const off = mk();
    const on = mk([[FO1, 20]]);
    onSignatureStep(off, player(off), emptyInput());
    onSignatureStep(on, player(on), emptyInput());
    expect(off.armorMaxStacks).toBe(ARMOR_MAX_STACKS);
    // round(1 + 3×20/32) = round(2.875) = 3.
    expect(on.armorMaxStacks).toBe(ARMOR_MAX_STACKS + 3);
  });

  it('확장된 상한을 적립 경로(MO1)가 실제로 따른다', () => {
    const w = mk([
      [FO1, 20],
      [MO1, 1],
    ]);
    onSignatureStep(w, player(w), emptyInput());
    const p = player(w);
    p.aux0 = ARMOR_MAX_STACKS;
    onDashFired(w, p);
    expect(p.aux0).toBe(ARMOR_MAX_STACKS + 1);
  });
});

// ---------------------------------------------------------------------------
// ⑧ 앵커 ④ + ⑨ — FO2 응혈 장갑
// ---------------------------------------------------------------------------

describe('⑧ FO2 응혈 장갑 (앵커 ④ 적립 → 앵커 ⑨ 정산)', () => {
  it('피격이 풀에 쌓이고, **만재 상승 엣지**에서만 60% 가 회복된다', () => {
    const w = mk([[FO2, 10]]);
    const p = player(w);
    p.aux0 = 0;
    p.hp = p.maxHp - 500;

    // 적립: round(100 × (2000 + 100×10) / 10000) = 30.
    onPlayerDamaged(w, p, 100, false);
    expect(readSlot(w.skillCarry, BruiserCarry.clotPool)).toBe(30);

    // 아직 만재가 아니면 정산이 없다.
    const hpBefore = p.hp;
    onSignatureStep(w, p, emptyInput());
    expect(p.hp).toBe(hpBefore);
    expect(readSlot(w.skillCarry, BruiserCarry.clotPool)).toBe(30);
    expect(readSlot(w.skillStage, BruiserStage.prevArmorStacks)).toBe(0);

    // 만재 상승 엣지 → round(30 × 0.6) = 18 회복, 풀은 0.
    p.aux0 = w.armorMaxStacks;
    onSignatureStep(w, p, emptyInput());
    expect(p.hp).toBe(hpBefore + 18);
    expect(readSlot(w.skillCarry, BruiserCarry.clotPool)).toBe(0);

    // 만재를 **유지**하는 다음 틱은 엣지가 아니다(SUSTAIN 이 매 틱 정산되면 안 된다).
    onPlayerDamaged(w, p, 100, false);
    const hpHold = p.hp;
    onSignatureStep(w, p, emptyInput());
    expect(p.hp).toBe(hpHold);
    expect(readSlot(w.skillCarry, BruiserCarry.clotPool)).toBe(30);
  });

  it('미투자 런은 풀도 안 쌓고 회복도 없다', () => {
    const w = mk([[MO9, 5]]);
    const p = player(w);
    p.hp = p.maxHp - 500;
    onPlayerDamaged(w, p, 100, false);
    p.aux0 = w.armorMaxStacks;
    onSignatureStep(w, p, emptyInput());
    expect(readSlot(w.skillCarry, BruiserCarry.clotPool)).toBe(0);
    expect(p.hp).toBe(p.maxHp - 500);
  });
});

// ---------------------------------------------------------------------------
// ⑨ 앵커 ⑨ — MO6 압쇄장
// ---------------------------------------------------------------------------

describe('⑨ MO6 압쇄장 (앵커 ⑨)', () => {
  it('스택이 있을 때 주기 틱마다 근접 적을 깎고 밀어낸다', () => {
    const w = mk([[MO6, 10]]);
    const p = player(w);
    p.aux0 = 1;
    const near = addEnemy(w, p.x + 50, p.y, 500);
    const far = addEnemy(w, p.x + 5000, p.y, 500);
    const nearX = near.x;
    expect(w.tick % 30).toBe(0);
    onSignatureStep(w, p, emptyInput());
    expect(near.hp).toBe(500 - (4 + 10));
    expect(near.x).toBeGreaterThan(nearX); // 바깥쪽(+X)으로 밀렸다
    expect(far.hp).toBe(500);
  });

  it('스택이 0 이면 돌지 않는다', () => {
    const w = mk([[MO6, 10]]);
    const p = player(w);
    p.aux0 = 0;
    const near = addEnemy(w, p.x + 50, p.y, 500);
    onSignatureStep(w, p, emptyInput());
    expect(near.hp).toBe(500);
  });

  it('주기 밖 틱에는 돌지 않는다', () => {
    const w = mk([[MO6, 10]]);
    const p = player(w);
    p.aux0 = 4;
    w.tick = 7;
    const near = addEnemy(w, p.x + 50, p.y, 500);
    onSignatureStep(w, p, emptyInput());
    expect(near.hp).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// ⑩ 앵커 ⑩ — BL9 중압 리듬
// ---------------------------------------------------------------------------

describe('⑩ BL9 중압 리듬 (앵커 ⑩)', () => {
  it('스택 파생 주기의 N번째 명중에서만 강타가 터진다', () => {
    const w = mk([[BL9, 10]]);
    const p = player(w);
    p.aux0 = 8; // N = max(1, round(48/12)) = 4
    const t = addEnemy(w, p.x + 300, p.y, 1000);
    const src: Entity = { ...blankEntity('bullet'), damage: 10 };
    for (let i = 0; i < 3; i++) {
      onEnemyDamaged(w, t, 10, src);
      expect(t.hp).toBe(1000); // 앵커는 기본 피해를 다시 적용하지 않는다
    }
    onEnemyDamaged(w, t, 10, src);
    // 강타 = round(10 × (8000 + 400×10)/10000) = round(12) = 12.
    expect(t.hp).toBe(1000 - 12);
    expect(readSlot(w.skillStage, BruiserStage.cadenceHits)).toBe(0);
  });

  it('스택이 많을수록 주기가 짧아진다 (스택 0 = 12타, 만재 = 4타)', () => {
    const lowStack = mk([[BL9, 1]]);
    const pl = player(lowStack);
    pl.aux0 = 0;
    const t = addEnemy(lowStack, pl.x + 300, pl.y, 1000);
    const src: Entity = { ...blankEntity('bullet'), damage: 10 };
    for (let i = 0; i < 11; i++) onEnemyDamaged(lowStack, t, 10, src);
    expect(t.hp).toBe(1000);
    onEnemyDamaged(lowStack, t, 10, src);
    expect(t.hp).toBeLessThan(1000);
  });

  it('`dmg === 0` 인 명중(코어 실드 전량 흡수)은 세지 않는다', () => {
    const w = mk([[BL9, 10]]);
    player(w).aux0 = 8;
    const t = addEnemy(w, 0, 0, 1000);
    const src: Entity = { ...blankEntity('bullet'), damage: 10 };
    for (let i = 0; i < 10; i++) onEnemyDamaged(w, t, 0, src);
    expect(readSlot(w.skillStage, BruiserStage.cadenceHits)).toBe(0);
    expect(t.hp).toBe(1000);
  });

  it('미투자 런은 카운터도 안 돌린다', () => {
    const w = mk([[MO9, 5]]);
    const t = addEnemy(w, 0, 0, 1000);
    const src: Entity = { ...blankEntity('bullet'), damage: 10 };
    for (let i = 0; i < 20; i++) onEnemyDamaged(w, t, 10, src);
    expect(t.hp).toBe(1000);
    expect(readSlot(w.skillStage, BruiserStage.cadenceHits)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑪ 앵커 ⑧ — FO6 하중 전이
// ---------------------------------------------------------------------------

describe('⑪ FO6 하중 전이 (앵커 ⑧)', () => {
  it('피해를 깎고 그만큼 대시 쿨다운을 지불한다', () => {
    const off = mk();
    const on = mk([[FO6, 10]]);
    player(off).dashCooldown = 0;
    player(on).dashCooldown = 0;
    expect(onDamageChain(off, player(off), 1000)).toBe(1000);
    expect(player(off).dashCooldown).toBe(0);
    // 경감 = round(1000 × (800 + 80×10)/10000) = 160.
    expect(onDamageChain(on, player(on), 1000)).toBe(1000 - 160);
    expect(player(on).dashCooldown).toBe(20);
  });

  it('경감이 0 으로 접히면 대가도 물리지 않는다', () => {
    const w = mk([[FO6, 1]]);
    player(w).dashCooldown = 0;
    // round(1 × 880/10000) = 0.
    expect(onDamageChain(w, player(w), 1)).toBe(1);
    expect(player(w).dashCooldown).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑫ 앵커 ⑪ — FO7 전리 개장
// ---------------------------------------------------------------------------

describe('⑫ FO7 전리 개장 (앵커 ⑪)', () => {
  it('엘리트 격파가 스택당 최대 HP 를 올리고 이어서 만재로 재무장한다', () => {
    const w = mk([[FO7, 10]]);
    const p = player(w);
    onSignatureStep(w, p, emptyInput()); // 기준선 확보
    expect(readSlot(w.skillCarry, BruiserCarry.trophyBaseHp)).toBe(p.maxHp);

    p.aux0 = 8;
    const before = p.maxHp;
    onEnemyDeath(w, 100, 100, true);
    // per = round(1 + 6×10/24) = round(3.5) = 4 → 8스택 × 4 = 32.
    expect(p.maxHp).toBe(before + 32);
    expect(readSlot(w.skillCarry, BruiserCarry.trophyGranted)).toBe(32);
    expect(p.aux0).toBe(w.armorMaxStacks); // ③ 만재 세팅
  });

  it('엘리트가 아닌 격파에는 반응하지 않는다', () => {
    const w = mk([[FO7, 10]]);
    const p = player(w);
    onSignatureStep(w, p, emptyInput());
    p.aux0 = 3;
    const before = p.maxHp;
    onEnemyDeath(w, 100, 100, false);
    expect(p.maxHp).toBe(before);
    expect(p.aux0).toBe(3);
  });

  it('런당 누적 상한(기준선의 50%)을 넘지 않는다', () => {
    const w = mk([[FO7, 10]]);
    const p = player(w);
    onSignatureStep(w, p, emptyInput());
    const base = readSlot(w.skillCarry, BruiserCarry.trophyBaseHp);
    const cap = Math.round((base * 5000) / 10000);
    writeSlot(w.skillCarry, BruiserCarry.trophyGranted, cap - 5);
    p.aux0 = 8;
    const before = p.maxHp;
    onEnemyDeath(w, 0, 0, true);
    expect(p.maxHp).toBe(before + 5); // 32 를 요구했지만 남은 여유는 5 뿐
    expect(readSlot(w.skillCarry, BruiserCarry.trophyGranted)).toBe(cap);
  });

  it('미투자 런은 격파에 반응하지 않는다', () => {
    const w = mk([[MO9, 5]]);
    const p = player(w);
    p.aux0 = 2;
    const before = p.maxHp;
    onSignatureStep(w, p, emptyInput());
    onEnemyDeath(w, 0, 0, true);
    expect(p.maxHp).toBe(before);
    expect(p.aux0).toBe(2);
    expect(readSlot(w.skillCarry, BruiserCarry.trophyBaseHp)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑯ 앵커 ⑯ — BL3 만재 중탄 · BL6 중량 탄자
// ---------------------------------------------------------------------------
//
// 두 스킬은 **두 앵커에 걸쳐 있다**: ⑯ 에서 탄 `aux0` 에 표식을 찍고, ⑩ 에서 그 표식을 읽어
// 폭발·변위를 낸다. 그래서 §⑯ 은 표식·파라미터를, §⑯-명중 은 표식을 단 탄이 실제로 무엇을
// 하는지를 따로 잰다 — 한쪽만 재면 "찍기는 하는데 아무도 안 읽는" 반쪽 배선이 초록으로 선다.

function volley(over: Partial<VolleyParams> = {}): VolleyParams {
  return {
    damage: 100,
    pierce: 1,
    count: 3,
    speed: 1800,
    radius: 6,
    life: 55,
    spread: 0.3,
    cooldownQ: 1280,
    mark: 0,
    recordSpawnDamage: false,
    // 아크캐스터 레인이 BA10 을 위해 추가한 필드(머지에서 합류). `true` = 이번 아키타입이
    // `count` 를 실제로 읽는다(발칸/스프레드/미사일). 판정 정본은 `world.ts` 의 아키타입
    // 분기이고 여기엔 **결과만** 실린다 — 훅이 `WEAPON_TYPE_*` 를 복제하면 그 사본이
    // 갈리는 순간 결함이 조용해지기 때문이다.
    countUsed: true,
    // S2.1 이 더한 셋. `ballisticsUsed: true` = 빔이 아니다 — ⚠️ **BL6 은 이 값이 `false` 인
    // 볼리(빔)에서 페널티가 통째로 증발하므로**, 그 경로를 재는 케이스는 `over` 로 뒤집어라.
    ballisticsUsed: true,
    targetDist: 200,
    // 발사 방위(rad). 읽기 전용 사실이라 훅이 고치지 않는다 — 기본 0(순수 +x).
    aimAngle: 0,
    // W2 가 더한 칸 — 그 틱 이동 입력 벡터(읽기 전용). 기본은 무입력(정지).
    inputX: 0,
    inputY: 0,
    cloakBreak: false,
    ...over,
  };
}

describe('⑯ BL3 만재 중탄 (앵커 ⑯ 표식)', () => {
  it('장갑이 만재인 볼리에만 중탄 표식이 찍힌다', () => {
    const w = mk([[BL3, 5]]);
    const p = player(w);
    p.aux0 = w.armorMaxStacks;
    const v = volley();
    onVolleyParams(w, p, v);
    expect(v.mark & 2).toBe(2);
  });

  it('만재 미만이면 표식이 없다', () => {
    const w = mk([[BL3, 5]]);
    const p = player(w);
    p.aux0 = w.armorMaxStacks - 1;
    const v = volley();
    onVolleyParams(w, p, v);
    expect(v.mark).toBe(0);
  });

  it('만재 판정은 고정 8 이 아니라 FO1 이 늘린 상한을 따른다', () => {
    const w = mk([
      [BL3, 5],
      [FO1, 20],
    ]);
    const p = player(w);
    onSignatureStep(w, p, emptyInput()); // FO1 이 상한을 세운다
    expect(w.armorMaxStacks).toBeGreaterThan(ARMOR_MAX_STACKS);
    p.aux0 = ARMOR_MAX_STACKS; // 종전 상한 — 확장된 상한 기준으로는 만재가 아니다
    const v = volley();
    onVolleyParams(w, p, v);
    expect(v.mark).toBe(0);
    p.aux0 = w.armorMaxStacks;
    const v2 = volley();
    onVolleyParams(w, p, v2);
    expect(v2.mark & 2).toBe(2);
  });

  it('미투자 런은 만재여도 표식을 안 찍는다', () => {
    const w = mk([[MO9, 5]]);
    const p = player(w);
    p.aux0 = w.armorMaxStacks;
    const v = volley();
    onVolleyParams(w, p, v);
    expect(v.mark).toBe(0);
  });
});

describe('⑯ BL6 중량 탄자 (앵커 ⑯ 파라미터)', () => {
  it('피해가 오르고 탄속이 절반이 되며 수명이 두 배가 된다', () => {
    const w = mk([[BL6, 10]]);
    const p = player(w);
    const v = volley();
    onVolleyParams(w, p, v);
    // 피해 +20% + 2%p/Lv = +40% → 100 + round(100×4000/10000) = 140
    expect(v.damage).toBe(140);
    expect(v.speed).toBe(900);
    expect(v.life).toBe(110);
    expect(v.mark & 4).toBe(4);
  });

  // ⚠️ **이 셋이 이 스킬의 성립 조건을 잠근다.** BL6 은 탄속·수명을 대가로 피해를 올리는
  // **교환**인데, 빔 아키타입은 `speed`·`life` 를 한 칸도 안 읽는다. 게이트가 없으면 빔에서
  // **페널티만 증발하고 이득만 남아** 무연산이 아니라 **일방적 이득**이 된다 — 밸런스가
  // 조용히 깨지는 형태라 테스트 없이는 되돌아가도 아무도 모른다.
  it('빔 볼리(ballisticsUsed=false)에는 피해 증가가 실리지 않는다 — 대가 없는 이득 차단', () => {
    const w = mk([[BL6, 10]]);
    const p = player(w);
    const v = volley({ ballisticsUsed: false });
    onVolleyParams(w, p, v);
    expect(v.damage).toBe(100); // 게이트가 열려 있으면 140 이 된다
  });

  it('빔 볼리에는 표식도 찍히지 않는다 — ⑩ 의 변위까지 함께 막는다', () => {
    const w = mk([[BL6, 10]]);
    const p = player(w);
    const v = volley({ ballisticsUsed: false });
    onVolleyParams(w, p, v);
    expect(v.mark & 4).toBe(0);
  });

  it('빔이 아닌 볼리에서는 종전대로 걸린다 — 게이트가 과잉 차단이 아니다', () => {
    const w = mk([[BL6, 10]]);
    const p = player(w);
    const v = volley({ ballisticsUsed: true });
    onVolleyParams(w, p, v);
    expect(v.damage).toBe(140);
  });

  it('도달 거리(탄속×수명)가 정확히 불변이다 — 사거리 계약', () => {
    const w = mk([[BL6, 3]]);
    const p = player(w);
    const v = volley({ speed: 1234.5, life: 71 });
    const reachBefore = v.speed * v.life;
    onVolleyParams(w, p, v);
    expect(v.speed * v.life).toBe(reachBefore);
  });

  it('BL3 과 같은 볼리에 겹쳐도 표식이 서로를 지우지 않는다', () => {
    const w = mk([
      [BL3, 5],
      [BL6, 5],
    ]);
    const p = player(w);
    p.aux0 = w.armorMaxStacks;
    const v = volley();
    onVolleyParams(w, p, v);
    expect(v.mark & 2).toBe(2);
    expect(v.mark & 4).toBe(4);
  });

  it('미투자 런은 파라미터를 한 칸도 안 건드린다', () => {
    const w = mk([[MO9, 5]]);
    const p = player(w);
    const v = volley();
    onVolleyParams(w, p, v);
    expect(v).toEqual(volley());
  });
});

describe('⑯-명중 BL3·BL6 (앵커 ⑩ 이 표식을 읽는다)', () => {
  it('중탄 표식이 있는 탄만 명중 지점에 폭발을 남긴다', () => {
    const w = mk([[BL3, 10]]);
    const p = player(w);
    const t = addEnemy(w, p.x + 400, p.y, 1000);
    const near = addEnemy(w, t.x + 30, t.y, 1000); // 반경 50+50 = 100 안
    const far = addEnemy(w, t.x + 300, t.y, 1000); // 밖
    const src: Entity = { ...blankEntity('bullet'), damage: 40, aux0: 2 };
    onEnemyDamaged(w, t, 40, src);
    // 폭발 = round(40 × (2500 + 150×10)/10000) = round(16) = 16
    expect(near.hp).toBe(1000 - 16);
    expect(far.hp).toBe(1000);
    // 맞은 표적 자신은 제외 — 넣으면 "단일 표적 피해 +25%" 로 퇴화한다
    expect(t.hp).toBe(1000);
  });

  it('표식 없는 탄은 폭발을 안 남긴다', () => {
    const w = mk([[BL3, 10]]);
    const p = player(w);
    const t = addEnemy(w, p.x + 400, p.y, 1000);
    const near = addEnemy(w, t.x + 30, t.y, 1000);
    const src: Entity = { ...blankEntity('bullet'), damage: 40, aux0: 0 };
    onEnemyDamaged(w, t, 40, src);
    expect(near.hp).toBe(1000);
  });

  it('중량 표식이 있는 탄은 명중한 적을 탄 진행 방향으로 민다', () => {
    const w = mk([[BL6, 10]]);
    const p = player(w);
    const t = addEnemy(w, p.x + 400, p.y, 1000);
    const x0 = t.x;
    const y0 = t.y;
    const src: Entity = { ...blankEntity('bullet'), damage: 40, aux0: 4, angle: 0 };
    onEnemyDamaged(w, t, 40, src);
    // 변위 16 + 2×10 = 36, 각 0 → +X 로 36.
    // ⚠️ 오차 3자리인 이유: `math.ts` 의 `cos`/`sin` 은 결정론 **룩업 테이블**이라 cos(0) 이
    //    정확히 1 이 아니다(≈0.9999965). 이 sim 의 모든 각도 산술이 같은 표를 쓴다.
    expect(t.x).toBeCloseTo(x0 + 36, 3);
    expect(t.y).toBeCloseTo(y0, 3);
  });

  it('엘리트·보스는 변위가 반감된다', () => {
    const w = mk([[BL6, 10]]);
    const p = player(w);
    const elite = addEnemy(w, p.x + 400, p.y, 1000);
    elite.pierce = 1; // isElite = kind 'enemy' && pierce > 0
    const bossE: Entity = { ...blankEntity('boss'), x: p.x + 900, y: p.y, hp: 1000, radius: 40 };
    w.entities.push(bossE);
    const src: Entity = { ...blankEntity('bullet'), damage: 40, aux0: 4, angle: 0 };
    const ex = elite.x;
    const bx = bossE.x;
    onEnemyDamaged(w, elite, 40, src);
    onEnemyDamaged(w, bossE, 40, src);
    expect(elite.x).toBeCloseTo(ex + 18, 3);
    expect(bossE.x).toBeCloseTo(bx + 18, 3);
  });

  it('미투자 런은 표식이 찍힌 탄이 와도 아무 일도 안 한다', () => {
    const w = mk([[MO9, 5]]);
    const p = player(w);
    const t = addEnemy(w, p.x + 400, p.y, 1000);
    const near = addEnemy(w, t.x + 30, t.y, 1000);
    const x0 = t.x;
    const src: Entity = { ...blankEntity('bullet'), damage: 40, aux0: 2 | 4, angle: 0 };
    onEnemyDamaged(w, t, 40, src);
    expect(near.hp).toBe(1000);
    expect(t.x).toBe(x0);
  });
});

// ---------------------------------------------------------------------------
// ⑯-BL2 백병 격발 — 앵커 ⑯ 의 `targetDist` 술어
// ---------------------------------------------------------------------------
//
// BL3·BL6 과 달리 **이 앵커 안에서 실효까지 끝난다**(표식이 아니라 관통·피해 직접 증폭).
// 그래서 §⑯-BL2 는 파라미터 산술과 **실제 발사 경로의 hp 감소**를 둘 다 잰다 — 파라미터만
// 재면 "레코드는 고쳤는데 아키타입이 안 읽는" 무연산이 초록으로 선다.

describe('⑯-BL2 백병 격발 (앵커 ⑯)', () => {
  it('근접 임계 이내 볼리는 관통 +1 · 피해 +8%+1.5%p/Lv 를 얻는다', () => {
    const w = mk([[BL2, 10]]);
    const p = player(w);
    const v = volley({ targetDist: 200 });
    onVolleyParams(w, p, v);
    expect(v.pierce).toBe(2); // 1 → 2
    // 800 + 150×10 = 2300bp → round(100 × 0.23) = 23.
    expect(v.damage).toBe(123);
    // BL2 는 두 축뿐이다 — 표식·탄속·수명은 건드리지 않는다.
    expect(v.mark).toBe(0);
    expect(v.speed).toBe(1800);
    expect(v.life).toBe(55);
  });

  it('임계 밖 볼리는 한 칸도 안 변한다 — 거리 술어가 실제 게이트다 (음성 짝)', () => {
    const w = mk([[BL2, 10]]);
    const p = player(w);
    const v = volley({ targetDist: 351 });
    onVolleyParams(w, p, v);
    expect(v.pierce).toBe(1);
    expect(v.damage).toBe(100);
  });

  it('임계 350 은 포함이고 그 위는 밖이다 — 경계가 `<=` 로 고정돼 있다', () => {
    const w = mk([[BL2, 1]]);
    const p = player(w);
    const on = volley({ targetDist: 350 });
    onVolleyParams(w, p, on);
    expect(on.damage).toBeGreaterThan(100);
    const off = volley({ targetDist: 350.0001 });
    onVolleyParams(w, p, off);
    expect(off.damage).toBe(100);
  });

  it('`targetDist === 0`(적이 겹침)에서 NaN·무한대가 나오지 않는다', () => {
    const w = mk([[BL2, 20]]);
    const p = player(w);
    const v = volley({ targetDist: 0 });
    onVolleyParams(w, p, v);
    expect(Number.isFinite(v.damage)).toBe(true);
    expect(Number.isFinite(v.speed)).toBe(true);
    expect(Number.isInteger(v.pierce)).toBe(true);
    // 800 + 150×20 = 3800bp → 100 + 38.
    expect(v.damage).toBe(138);
    expect(v.pierce).toBe(2);
  });

  it('미투자 런은 근접이어도 볼리가 종전 그대로다 (음성 대조)', () => {
    const w = mk([[BL3, 10]]);
    const p = player(w);
    const v = volley({ targetDist: 10 });
    onVolleyParams(w, p, v);
    expect(v.pierce).toBe(1);
    expect(v.damage).toBe(100);
  });

  it('실제 발사 경로가 앵커를 관통한다 — 근접 표적의 hp 가 더 많이 깎인다 (stepWorld)', () => {
    // ⚠️ 하한을 먼저 세운다: 배선이 끊기면 **양변이 모두 0** 이 되어 "같다/크다" 가 항진으로
    //    성립한다(이 저장소가 실제로 밟은 결함). "볼리가 실제로 나가 hp 를 깎았다" 를 각
    //    변에서 따로 단언한 뒤에야 비교가 의미를 가진다.
    function run(points: ReadonlyArray<readonly [number, number]>, dist: number): number {
      const w = mk(points);
      const p = player(w);
      const e = addEnemy(w, p.x + dist, p.y, 5_000_000);
      p.cooldown = 0;
      for (let i = 0; i < 30; i++) stepWorld(w, emptyInput());
      return 5_000_000 - e.hp;
    }
    const nearOff = run([[BL3, 10]], 150);
    const nearOn = run([[BL2, 10]], 150);
    expect(nearOff).toBeGreaterThan(0); // 하한 — 볼리가 실제로 나갔다
    expect(nearOn).toBeGreaterThan(0);
    expect(nearOn).toBeGreaterThan(nearOff);

    // 음성 짝 — 먼 표적에서는 증폭이 없다. 여기서도 하한을 먼저 본다.
    const farOff = run([[BL3, 10]], 900);
    const farOn = run([[BL2, 10]], 900);
    expect(farOff).toBeGreaterThan(0);
    expect(farOn).toBe(farOff);
  });
});
