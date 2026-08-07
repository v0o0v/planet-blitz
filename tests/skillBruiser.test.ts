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
 *
 * ## 뮤테이션 추가 확인 — W3 이 얹은 4종 (2026-08-07)
 *  ③ **MO4** — `state.playerSlowTicks = 0` 한 줄을 지우면 §⑰ 두 건이 실패한다.
 *  ④ **FO4** — 반전 분기 게이트를 `false &&` 로 막으면 §⑱ 두 건(앵커 직접·`stepWorld` 관통)과
 *     §⑲ 의 축 내 긴장 1건이 함께 실패한다.
 *  ⑤ **FO8** — 회복량 `3 + fo8` 을 0 으로 바꾸면 §⑲ 네 건이 실패한다.
 *  ⑥ **FO9** — 세 지점(적립·감쇠 정지·사슬 감소)의 게이트를 동시에 막으면 §⑳ 의 ①②③ 이
 *     **각각** 실패한다(다섯 건) — 세 지점이 서로 다른 앵커에 실제로 붙어 있다는 뜻이다.
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
import {
  SIG_BRUISER_ARMOR,
  ARMOR_MAX_STACKS,
  ARMOR_DECAY_TICKS,
} from '../src/sim/shipSignature.js';
import {
  BruiserCarry,
  BruiserStage,
  readSlot,
  writeSlot,
  SKILL_SLOT_COUNT,
} from '../src/sim/skillSlots.js';
import { DamageSource } from '../src/sim/skillSlots.js';

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
const BL8 = 7;
const BL9 = 8;
const MO1 = 10;
const MO4 = 13;
const MO6 = 15;
const MO8 = 17;
const MO9 = 18;
const FO1 = 20;
const FO2 = 21;
const FO4 = 23;
const FO5 = 24;
const FO6 = 25;
const FO7 = 26;
const FO8 = 27;
const FO9 = 28;

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
    onPlayerDamaged(full, player(full), 20, false, DamageSource.bullet);
    onPlayerDamaged(partial, player(partial), 20, false, DamageSource.bullet);
    onPlayerDamaged(off, player(off), 20, false, DamageSource.bullet);
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
    onPlayerDamaged(w, p, 10, false, DamageSource.bullet);
    expect(p.aux0).toBe(0);
    expect(p.targetX).toBe(0);

    // ② 치명 생존 — 발동.
    onPlayerDamaged(w, p, 10, true, DamageSource.bullet);
    expect(p.aux0).toBe(w.armorMaxStacks);
    expect(p.targetX).toBe(1);
    expect(w.entities.some((e) => e.kind === 'enemyBullet' && !e.dead)).toBe(false);

    // ③ 두 번째 치명 생존 — 억제로 미발동.
    p.aux0 = 2;
    w.entities.push({ ...blankEntity('enemyBullet'), x: p.x + 10, y: p.y });
    onPlayerDamaged(w, p, 10, true, DamageSource.bullet);
    expect(p.aux0).toBe(2);
    expect(w.entities.some((e) => e.kind === 'enemyBullet' && !e.dead)).toBe(true);
  });

  it('미투자 런은 치명 생존에서도 표식을 세우지 않는다', () => {
    const w = mk([[MO9, 5]]);
    const p = player(w);
    onPlayerDamaged(w, p, 10, true, DamageSource.bullet);
    expect(p.targetX).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑥-b BL8 격돌 담금질 (앵커 ④ 적립 · 앵커 ⑯ 소모)
// ---------------------------------------------------------------------------

describe('⑥-b BL8 격돌 담금질', () => {
  function charges(w: WorldState): number {
    return readSlot(w.skillStage, BruiserStage.temperCharges);
  }

  it('접촉 피격에서만 적립된다 (양성 · 음성 짝)', () => {
    // ⚠️ 부정 항목("적탄에서는 안 쌓인다")은 뮤테이션에 원리적으로 안 걸린다 — 게이트를
    //    지워도 그 단언만으로는 빨개지지 않는다. 그래서 **양성 짝을 바로 옆에 둔다.**
    const w = mk([[BL8, 1]]);
    const p = player(w);

    onPlayerDamaged(w, p, 10, false, DamageSource.contact);
    expect(charges(w), '접촉인데 적립이 없다 — 적립처 미배선').toBe(1);

    const off = mk([[BL8, 1]]);
    onPlayerDamaged(off, player(off), 10, false, DamageSource.bullet);
    expect(charges(off)).toBe(0);

    const hz = mk([[BL8, 1]]);
    onPlayerDamaged(hz, player(hz), 10, false, DamageSource.hazard);
    expect(charges(hz)).toBe(0);
  });

  it('⭐ 적탄이 `max` 를 이긴 틱에도 접촉 비트가 서 있으면 적립된다', () => {
    // 설계서가 명시한 술어("max 가 적탄이어도 접촉 기여가 있으면 적립") 그대로다.
    // 앵커에 단일 유니온을 실었다면 이 케이스가 조용히 0 이 된다.
    const w = mk([[BL8, 1]]);
    onPlayerDamaged(w, player(w), 20, false, DamageSource.contact | DamageSource.bullet);
    expect(charges(w)).toBe(1);
  });

  it('적립 상한은 레벨 파생이다 — Lv1 = 1, Lv20 = 4', () => {
    const lo = mk([[BL8, 1]]);
    for (let i = 0; i < 10; i++) onPlayerDamaged(lo, player(lo), 5, false, DamageSource.contact);
    expect(charges(lo)).toBe(1);

    const hi = mk([[BL8, 20]]);
    for (let i = 0; i < 10; i++) onPlayerDamaged(hi, player(hi), 5, false, DamageSource.contact);
    expect(charges(hi)).toBe(4);
  });

  it('소모처: 볼리 하나가 **1 발만** 꺼내 선두탄 칸에 싣는다', () => {
    const w = mk([[BL8, 4]]);
    const p = player(w);
    onPlayerDamaged(w, p, 5, false, DamageSource.contact);
    onPlayerDamaged(w, p, 5, false, DamageSource.contact);
    expect(charges(w), '적립이 없으면 아래 소모 단언이 항진이다').toBe(2);

    const v = volley();
    onVolleyParams(w, p, v);
    expect(charges(w)).toBe(1); // 볼리당 정확히 1 발
    // 피해 +60% + 3%p/Lv → Lv4 = 72% of 100 = 72. 선두탄 칸에만 실린다.
    expect(v.leadDamageBonus).toBe(72);
    expect(v.leadPierceBonus).toBe(1);
    // 볼리 전체 값은 한 칸도 안 건드린다 — 부채꼴에서 `count` 배로 부푸는 것을 막는 계약이다.
    expect(v.damage).toBe(100);
    expect(v.pierce).toBe(1);
  });

  it('음성 대조: 적립이 0 이면 볼리가 선두탄 칸을 안 건드린다', () => {
    const w = mk([[BL8, 4]]);
    const v = volley();
    onVolleyParams(w, player(w), v);
    expect(v.leadDamageBonus).toBe(0);
    expect(v.leadPierceBonus).toBe(0);
  });

  it('⭐ 선두탄 증분이 **실제 탄까지 닿는다** — 아키타입 분기가 삼키지 않는다', () => {
    // ⚠️ `VolleyParams` 만 단언하면 반쪽이다. `world.ts` 가 그 칸을 안 읽거나 `spawnBullet` 이
    //    clamp 로 삼키면 훅은 초록인데 탄은 종전 그대로다 — 앵커 ⑰ 이 정확히 그 형태로
    //    무효였다. 그래서 **태어난 탄의 피해**를 직접 잰다.
    function firstVolleyDamages(charge: boolean): number[] {
      const w = mk([[BL8, 20]]);
      const p = player(w);
      if (charge) writeSlot(w.skillStage, BruiserStage.temperCharges, 1);
      addEnemy(w, p.x + 300, p.y, 1_000_000);
      for (let i = 0; i < 240; i++) {
        stepWorld(w, emptyInput());
        const shots = w.entities.filter((e) => e.kind === 'bullet' && !e.dead);
        if (shots.length > 1) return shots.map((e) => e.damage);
      }
      return [];
    }
    const off = firstVolleyDamages(false);
    const on = firstVolleyDamages(true);
    // 하한 먼저 — 볼리가 안 났으면 아래 비교는 빈 배열끼리의 항진이다.
    expect(off.length, '볼리가 나지 않았다 — 잴 것이 없다').toBeGreaterThan(1);
    expect(on.length).toBe(off.length);
    // 미적립 볼리는 전 탄이 같은 피해다(선두 개념이 관측되지 않는다).
    expect(new Set(off).size).toBe(1);
    // 적립 볼리는 **정확히 한 발만** 더 아프다.
    const base = off[0]!;
    expect(on.filter((d) => d > base)).toHaveLength(1);
    expect(on.filter((d) => d === base)).toHaveLength(off.length - 1);
  });

  it('미투자 런은 접촉 피격에서도 슬롯을 안 건드리고 비트가 불변이다', () => {
    const a = mk([[MO9, 5]]);
    onPlayerDamaged(a, player(a), 10, false, DamageSource.contact);
    expect(charges(a)).toBe(0);
    const b = mk([[MO9, 5]]);
    expect(hashWorld(a)).toBe(hashWorld(b));
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
    onPlayerDamaged(w, p, 100, false, DamageSource.bullet);
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
    onPlayerDamaged(w, p, 100, false, DamageSource.bullet);
    const hpHold = p.hp;
    onSignatureStep(w, p, emptyInput());
    expect(p.hp).toBe(hpHold);
    expect(readSlot(w.skillCarry, BruiserCarry.clotPool)).toBe(30);
  });

  it('미투자 런은 풀도 안 쌓고 회복도 없다', () => {
    const w = mk([[MO9, 5]]);
    const p = player(w);
    p.hp = p.maxHp - 500;
    onPlayerDamaged(w, p, 100, false, DamageSource.bullet);
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
    onEnemyDeath(w, 100, 100, true, false);
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
    onEnemyDeath(w, 100, 100, false, false);
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
    onEnemyDeath(w, 0, 0, true, false);
    expect(p.maxHp).toBe(before + 5); // 32 를 요구했지만 남은 여유는 5 뿐
    expect(readSlot(w.skillCarry, BruiserCarry.trophyGranted)).toBe(cap);
  });

  it('미투자 런은 격파에 반응하지 않는다', () => {
    const w = mk([[MO9, 5]]);
    const p = player(w);
    p.aux0 = 2;
    const before = p.maxHp;
    onSignatureStep(w, p, emptyInput());
    onEnemyDeath(w, 0, 0, true, false);
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
    leadDamageBonus: 0,
    leadPierceBonus: 0,
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

// ---------------------------------------------------------------------------
// ⑯ MO6 압쇄장 사망 마킹 — 좀비 결함
// ---------------------------------------------------------------------------

/**
 * `compact()`(`world.ts`)는 **`e.dead === true` 만 수거**한다 — `hp <= 0` 단독으로는 안 걷는다.
 * MO6 는 `e.hp -=` 만 했으므로 압쇄장으로만 hp≤0 이 된 적이 **좀비**로 남았다: 계속 움직이고
 * 공격하며 `state.kills`·젬·전리품이 전부 사라진다. 정본 형태는 `status.ts` 111-112 의 두 줄이다.
 *
 * ⚠️ **계측기 함정** — 적을 플레이어 코앞에 두면 자동사격 탄(≈30px/tick)이 같은 틱에 마무리해
 * 수정 전에도 통과한다. 그래서 반경(Lv10 = 200)의 **바깥 끝 190px** 에 둬 사망 경로를 압쇄장
 * 하나로 좁힌다.
 *
 * ⚠️ **보스는 대상이 아니다** — MO6 은 `kind !== 'enemy'` 를 걸러내므로(설계서가 명시한 enemy
 * 한정) 보스 마킹 질문 자체가 생기지 않는다. `blastDamageAt`(enemy+boss)과 다른 이유다.
 */
describe('⑯ MO6 사망 마킹 (좀비 결함)', () => {
  const CRUSH_EDGE = 190; // 반경 200(Lv10)의 바깥 끝 — 자동사격 탄이 1틱에 못 닿는다

  it('전제 — 그 거리의 적이 실제로 압쇄장에 맞고 hp 가 줄어든다 (하한)', () => {
    const w = mk([[MO6, 10]]);
    const p = player(w);
    p.aux0 = 1;
    const e = addEnemy(w, p.x + CRUSH_EDGE, p.y, 500);
    expect(Math.hypot(e.x - p.x, e.y - p.y)).toBeLessThanOrEqual(120 + 8 * 10);
    expect(w.tick % 30).toBe(0);
    onSignatureStep(w, p, emptyInput());
    expect(e.hp).toBe(500 - (4 + 10));
    expect(e.hp).toBeGreaterThan(0); // 이 케이스는 죽이지 않는다
  });

  it('재현 — 압쇄장만으로 hp≤0 이 되면 그 자리에서 dead 로 마킹된다', () => {
    const w = mk([[MO6, 10]]);
    const p = player(w);
    p.aux0 = 1;
    const e = addEnemy(w, p.x + CRUSH_EDGE, p.y, 10);
    expect(e.dead).toBe(false);
    onSignatureStep(w, p, emptyInput());
    expect(e.hp).toBeLessThanOrEqual(0); // 실제로 죽을 만큼 맞았다 (하한)
    expect(e.dead).toBe(true);
  });

  it('재현 — 다음 stepWorld 에서 수거되고 처치·젬으로 집계된다 (좀비로 안 남는다)', () => {
    const w = mk([[MO6, 10]]);
    const p = player(w);
    p.aux0 = 1;
    const e = addEnemy(w, p.x + CRUSH_EDGE, p.y, 10);
    const id = e.id;
    const gx = e.x;
    const gy = e.y;
    const killsBefore = w.kills;
    onSignatureStep(w, p, emptyInput());
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
    const w = mk([[MO6, 10]]);
    const p = player(w);
    p.aux0 = 1;
    const e = addEnemy(w, p.x + CRUSH_EDGE, p.y, 500);
    const killsBefore = w.kills;
    onSignatureStep(w, p, emptyInput());
    expect(e.hp).toBe(500 - 14); // 실제로 맞았다 (하한)
    expect(e.dead).toBe(false);
    stepWorld(w, emptyInput());
    expect(w.entities.some((x) => x.id === e.id)).toBe(true);
    expect(w.kills).toBe(killsBefore);
  });

  it('음성 대조 — MO6 미투자면 hp 도 안 줄고 dead 도 안 선다', () => {
    const w = mk([]);
    const p = player(w);
    p.aux0 = 1;
    const e = addEnemy(w, p.x + CRUSH_EDGE, p.y, 10);
    onSignatureStep(w, p, emptyInput());
    expect(e.hp).toBe(10);
    expect(e.dead).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ⑯-좀비 BL3 폭발 사망 마킹 — `compact` 의 1차 게이트는 `dead` 다
// ---------------------------------------------------------------------------

/**
 * BL3 은 앵커 ⑩(`onEnemyDamaged`) **안**이라 "격추 판정 뒤라 의도적" 으로 보이기 쉽다. 그러나
 * 이 스킬이 깎는 것은 **맞은 표적이 아니라 「주변 적」**이고, 그 주변 적들은 `world.ts:4170-4197`
 * 의 격추 판정을 **한 번도 거치지 않는다** — 그 판정은 `t`(맞은 표적) 하나만 본다.
 *
 * ⚠️ 계측기 함정: 적을 플레이어 코앞에 두면 자동사격 탄이 같은 틱에 마무리해 **수정 전에도**
 * 통과한다. 그래서 표적을 600px(자동사격 탄 ≈30px/tick) 밖에 두고, 주변 적은 폭발 반경
 * (50+5×Lv = 100) 의 **바깥 끝** 90px 에 둔다 — 사망 경로가 BL3 폭발 하나뿐이 된다.
 * ⚠️ 그리고 **맞은 표적이 아니라 주변 적이 죽는 것**을 잰다(표적이 죽으면 그건 다른 경로다).
 */
describe('⑯-좀비 BL3 폭발 사망 마킹', () => {
  /** BL3 Lv10 · 탄 피해 40 → 폭발 = round(40 × 4000/10000) = 16. */
  const BLAST = 16;

  function bl3Setup(nearHp: number): { w: WorldState; t: Entity; near: Entity } {
    const w = mk([[BL3, 10]]);
    const p = player(w);
    const t = addEnemy(w, p.x, p.y + 600, 1_000_000);
    const near = addEnemy(w, t.x + 90, t.y, nearHp); // 반경 100 안, 바깥 끝
    return { w, t, near };
  }

  const src = (): Entity => ({ ...blankEntity('bullet'), damage: 40, aux0: 2 });

  it('전제 — 주변 적은 반경 안이고 표적은 안 죽는다 (하한)', () => {
    const { w, t, near } = bl3Setup(1000);
    expect(Math.hypot(near.x - t.x, near.y - t.y)).toBeLessThanOrEqual(100);
    onEnemyDamaged(w, t, 40, src());
    expect(near.hp).toBe(1000 - BLAST);
    expect(t.hp).toBe(1_000_000); // 표적은 이 경로로 안 죽는다
  });

  it('폭발만으로 hp≤0 이 된 주변 적은 그 자리에서 dead 로 마킹된다', () => {
    const { w, t, near } = bl3Setup(BLAST);
    expect(near.dead).toBe(false);
    onEnemyDamaged(w, t, 40, src());
    expect(near.hp).toBeLessThanOrEqual(0); // 실제로 죽을 만큼 맞았다 (하한)
    expect(near.dead).toBe(true);
  });

  it('다음 stepWorld 에서 수거되고 처치·젬으로 집계된다 (좀비로 안 남는다)', () => {
    const { w, t, near } = bl3Setup(BLAST);
    const gx = near.x;
    const gy = near.y;
    const killsBefore = w.kills;
    const gemsBefore = w.entities.filter((x) => x.kind === 'gem').length;
    onEnemyDamaged(w, t, 40, src());
    expect(near.hp).toBeLessThanOrEqual(0);
    stepWorld(w, emptyInput());
    // ⚠️ `id` 가 아니라 **객체 동일성**으로 본다 — 이 파일의 `addEnemy` 는 id 를 안 매겨
    //    표적과 주변 적의 id 가 둘 다 0 이다(id 로 보면 표적 생존이 이 단언을 통과시킨다).
    expect(w.entities.includes(near)).toBe(false);
    expect(w.entities.includes(t)).toBe(true); // 표적은 살아 있다 — 죽은 것은 주변 적이다
    expect(w.kills).toBeGreaterThanOrEqual(killsBefore + 1);
    const gems = w.entities.filter(
      (x) => x.kind === 'gem' && Math.hypot(x.x - gx, x.y - gy) <= 200,
    );
    expect(gems.length).toBeGreaterThanOrEqual(1);
    expect(w.entities.filter((x) => x.kind === 'gem').length).toBeGreaterThan(gemsBefore);
  });

  it('보스도 같은 마킹을 받는다 — `blastDamageAt` 과 사실이 두 벌이 되지 않는다', () => {
    const w = mk([[BL3, 10]]);
    const p = player(w);
    const t = addEnemy(w, p.x, p.y + 600, 1_000_000);
    const bossE: Entity = {
      ...blankEntity('boss'),
      x: t.x + 90,
      y: t.y,
      hp: BLAST,
      maxHp: BLAST,
      radius: 40,
    };
    w.entities.push(bossE);
    onEnemyDamaged(w, t, 40, src());
    expect(bossE.hp).toBeLessThanOrEqual(0);
    expect(bossE.dead).toBe(true);
  });

  it('회귀 — hp 가 남은 주변 적은 dead 가 안 서고 stepWorld 뒤에도 살아 있다', () => {
    const { w, t, near } = bl3Setup(1000);
    const killsBefore = w.kills;
    onEnemyDamaged(w, t, 40, src());
    expect(near.hp).toBe(1000 - BLAST); // 실제로 맞았다 (하한)
    expect(near.dead).toBe(false);
    stepWorld(w, emptyInput());
    expect(w.entities.includes(near)).toBe(true);
    expect(w.kills).toBe(killsBefore);
  });
});

// ---------------------------------------------------------------------------
// ⑯-좀비 BL9 강타 사망 마킹 — 「표적이 탄을 견디고 강타에 죽는」 경우
// ---------------------------------------------------------------------------

/**
 * BL9 는 대상이 **맞은 표적 자신**이라 "격추 판정 뒤라 의도적" 으로 분류돼 있었다. 그 분류는
 * **표적이 이미 죽은 경우**에만 맞다. 표적이 탄 피해를 **견디고**(hp > 0) 강타가 hp 를 0 이하로
 * 내리면 `world.ts:4170-4197` 의 격추 판정은 이미 지나간 뒤라 아무도 `dead` 를 안 세운다 —
 * `hp<=0 → dead` 를 훑는 일반 스윕이 sim 에 **없으므로** 그 표적은 **좀비**다.
 *
 * ⚠️ 계측기 함정: 표적을 플레이어 코앞에 두면 자동사격 탄이 같은 틱에 마무리해 **수정 전에도**
 * 통과한다. 그래서 600px(자동사격 탄 ≈30px/tick) 밖에 둔다.
 * ⚠️ 그리고 표적 hp 를 **강타분과 정확히 같게** 잡아, 죽는 경로가 강타 하나뿐이 되게 한다.
 */
describe('⑯-좀비 BL9 강타 사망 마킹', () => {
  /** BL9 Lv10 · 명중 피해 40 → 강타 = round(40 × 12000/10000) = 48. */
  const BONUS = 48;
  /** 장갑 스택 0 → 주기 = round(48/(4+0)) = 12. 11 을 미리 채워 다음 명중이 강타가 되게 한다. */
  const PERIOD = 12;

  function bl9Setup(hp: number): { w: WorldState; t: Entity } {
    const w = mk([[BL9, 10]]);
    const p = player(w);
    writeSlot(w.skillStage, BruiserStage.cadenceHits, PERIOD - 1);
    const t = addEnemy(w, p.x, p.y + 600, hp);
    return { w, t };
  }

  const src = (): Entity => ({ ...blankEntity('bullet'), damage: 40 });

  it('전제 — 이번 명중이 강타 주기이고 강타분은 48 이다 (하한)', () => {
    const { w, t } = bl9Setup(1_000_000);
    onEnemyDamaged(w, t, 40, src());
    expect(t.hp).toBe(1_000_000 - BONUS);
  });

  it('탄을 견딘 표적이 강타로 hp≤0 이 되면 그 자리에서 dead 로 마킹된다', () => {
    const { w, t } = bl9Setup(BONUS);
    expect(t.dead).toBe(false); // 탄 피해는 견뎠다 — 앵커가 세운 dead 가 아니다
    onEnemyDamaged(w, t, 40, src());
    expect(t.hp).toBeLessThanOrEqual(0);
    expect(t.dead).toBe(true);
  });

  it('다음 stepWorld 에서 수거되고 처치·젬으로 집계된다 (좀비로 안 남는다)', () => {
    const { w, t } = bl9Setup(BONUS);
    const gx = t.x;
    const gy = t.y;
    const killsBefore = w.kills;
    const gemsBefore = w.entities.filter((x) => x.kind === 'gem').length;
    onEnemyDamaged(w, t, 40, src());
    expect(t.hp).toBeLessThanOrEqual(0);
    stepWorld(w, emptyInput());
    // ⚠️ id 가 아니라 **객체 동일성** — 이 파일의 `addEnemy` 는 id 를 안 매긴다.
    expect(w.entities.includes(t)).toBe(false);
    expect(w.kills).toBeGreaterThanOrEqual(killsBefore + 1);
    const gems = w.entities.filter(
      (x) => x.kind === 'gem' && Math.hypot(x.x - gx, x.y - gy) <= 200,
    );
    expect(gems.length).toBeGreaterThanOrEqual(1);
    expect(w.entities.filter((x) => x.kind === 'gem').length).toBeGreaterThan(gemsBefore);
  });

  it('표적이 살아남으면 dead 를 세우지 않는다 (과잉 마킹 금지)', () => {
    const { w, t } = bl9Setup(BONUS + 1);
    onEnemyDamaged(w, t, 40, src());
    expect(t.hp).toBe(1);
    expect(t.dead).toBe(false);
    const killsBefore = w.kills;
    stepWorld(w, emptyInput());
    expect(w.entities.includes(t)).toBe(true);
    expect(w.kills).toBe(killsBefore);
  });
});

// ---------------------------------------------------------------------------
// ⑰ 앵커 ⑨ — MO4 장갑 활주 (W3)
// ---------------------------------------------------------------------------

/**
 * 무효화의 관측점은 **`state.playerSlowTicks` 가 0 이 되는 것**이다 — 그 값이 `stepPlayer` 의
 * `slowMult` 게이트 그 자체다(이동 배율을 여기서 다시 재면 술어가 두 벌이 된다).
 */
describe('⑰ MO4 장갑 활주 (앵커 ⑨)', () => {
  it('감속이 걸려 있으면 스택 1개를 태워 지우고 전용 쿨을 건다', () => {
    const w = mk([[MO4, 1]]);
    const p = player(w);
    p.aux0 = 3;
    w.playerSlowTicks = 30;
    onSignatureStep(w, p, emptyInput());
    expect(p.aux0).toBe(2);
    expect(w.playerSlowTicks).toBe(0);
    // 쿨 = round(60 + 2400/(1+19)) = 180.
    expect(readSlot(w.skillStage, BruiserStage.skidCooldown)).toBe(180);
  });

  it('쿨 중에는 다시 안 먹고 쿨만 1씩 준다 — 장판이 매 틱 재부여해도 스택이 안 증발한다', () => {
    const w = mk([[MO4, 1]]);
    const p = player(w);
    p.aux0 = 3;
    w.playerSlowTicks = 30;
    onSignatureStep(w, p, emptyInput()); // 1회 소모
    for (let i = 0; i < 8; i++) {
      w.playerSlowTicks = 30; // 장판이 매 틱 재부여한다
      onSignatureStep(w, p, emptyInput());
      expect(w.playerSlowTicks).toBe(30); // 쿨 중이라 무효화가 안 돈다
    }
    expect(p.aux0).toBe(2); // 8틱에 8스택이 증발하지 않았다
    expect(readSlot(w.skillStage, BruiserStage.skidCooldown)).toBe(180 - 8);
  });

  it('스택이 0 이면 무효화도 쿨도 없다 (긍정 짝: 1 이면 돈다)', () => {
    const empty = mk([[MO4, 5]]);
    const pe = player(empty);
    pe.aux0 = 0;
    empty.playerSlowTicks = 30;
    onSignatureStep(empty, pe, emptyInput());
    expect(empty.playerSlowTicks).toBe(30);
    expect(readSlot(empty.skillStage, BruiserStage.skidCooldown)).toBe(0);

    const has = mk([[MO4, 5]]);
    const ph = player(has);
    ph.aux0 = 1;
    has.playerSlowTicks = 30;
    onSignatureStep(has, ph, emptyInput());
    expect(has.playerSlowTicks).toBe(0);
    expect(ph.aux0).toBe(0);
  });

  it('쿨 길이가 레벨 파생이다 — Lv1 = 180, Lv20 = 122', () => {
    for (const [level, ticks] of [
      [1, 180],
      [20, 122],
    ] as const) {
      const w = mk([[MO4, level]]);
      const p = player(w);
      p.aux0 = 2;
      w.playerSlowTicks = 10;
      onSignatureStep(w, p, emptyInput());
      expect(readSlot(w.skillStage, BruiserStage.skidCooldown)).toBe(ticks);
    }
  });

  it('미투자 런은 감속을 지우지도 스택을 태우지도 않는다', () => {
    const w = mk([[MO9, 5]]);
    const p = player(w);
    p.aux0 = 3;
    w.playerSlowTicks = 30;
    onSignatureStep(w, p, emptyInput());
    expect(w.playerSlowTicks).toBe(30);
    expect(p.aux0).toBe(3);
    expect(readSlot(w.skillStage, BruiserStage.skidCooldown)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑱ 앵커 ⑨ — FO4 부동 역적립 (W3)
// ---------------------------------------------------------------------------

/**
 * 이 앵커는 `world.ts` 의 감쇠 분기 **바로 앞**이다. 술어는 분기와 같은
 * `aux1 + 1 >= ARMOR_DECAY_TICKS` 이고, `aux1 = 0` 으로 되돌리면 분기의 `aux1++` 가 1 을 만들어
 * 소멸이 성사되지 않는다. **아래 `stepWorld` 짝이 그 이음매를 실제로 통과시킨다.**
 */
describe('⑱ FO4 부동 역적립 (앵커 ⑨)', () => {
  const DUE = ARMOR_DECAY_TICKS - 1;

  it('정지 중 감쇠 성사 틱은 소멸 대신 적립이다 (부호 반전)', () => {
    const w = mk([[FO4, 1]]);
    const p = player(w);
    p.aux0 = 2;
    p.aux1 = DUE;
    onSignatureStep(w, p, emptyInput());
    expect(p.aux0).toBe(3);
    expect(p.aux1).toBe(0);
  });

  it('감쇠 성사 틱이 아니면 아무 일도 없다 (하한 짝 — 항진 방지)', () => {
    const w = mk([[FO4, 20]]);
    const p = player(w);
    p.aux0 = 2;
    p.aux1 = DUE - 1;
    onSignatureStep(w, p, emptyInput());
    expect(p.aux0).toBe(2);
    expect(p.aux1).toBe(DUE - 1);
  });

  it('이동 입력이 있으면 반전하지 않는다 — 정지 술어가 실제 게이트다 (음성 짝)', () => {
    const w = mk([[FO4, 20]]);
    const p = player(w);
    p.aux0 = 2;
    p.aux1 = DUE;
    onSignatureStep(w, p, { ...emptyInput(), moveX: 1 });
    expect(p.aux0).toBe(2);
    expect(p.aux1).toBe(DUE); // 엔진 분기가 그대로 가져간다
  });

  it('대시 입력도 정지가 아니다', () => {
    const w = mk([[FO4, 20]]);
    const p = player(w);
    p.aux0 = 2;
    p.aux1 = DUE;
    onSignatureStep(w, p, { ...emptyInput(), dash: true });
    expect(p.aux0).toBe(2);
  });

  it('적립은 이 런의 유효 상한을 넘지 않는다', () => {
    const w = mk([
      [FO4, 5],
      [FO1, 20],
    ]);
    const p = player(w);
    onSignatureStep(w, p, emptyInput()); // FO1 이 상한을 세운다
    p.aux0 = w.armorMaxStacks;
    p.aux1 = DUE;
    onSignatureStep(w, p, emptyInput());
    expect(p.aux0).toBe(w.armorMaxStacks);
  });

  it('⭐ 실제 엔진 경로가 앵커를 관통한다 — 같은 셋업이 투자 유무로 +1 vs −1 로 갈린다', () => {
    const on = mk([[FO4, 5]]);
    const pOn = player(on);
    pOn.aux0 = 2;
    pOn.aux1 = DUE;
    stepWorld(on, emptyInput());
    expect(pOn.aux0).toBe(3);
    expect(pOn.aux1).toBe(1); // 우리가 0 으로 되돌린 뒤 분기의 aux1++ 가 1 을 만들었다

    const off = mk([[MO9, 5]]);
    const pOff = player(off);
    pOff.aux0 = 2;
    pOff.aux1 = DUE;
    stepWorld(off, emptyInput());
    expect(pOff.aux0).toBe(1); // 종전 감쇠 그대로
    expect(pOff.aux1).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑲ 앵커 ⑨ — FO8 탈피 재생 (W3)
// ---------------------------------------------------------------------------

describe('⑲ FO8 탈피 재생 (앵커 ⑨)', () => {
  const DUE = ARMOR_DECAY_TICKS - 1;

  function fo8World(level: number): { w: WorldState; p: Entity } {
    const w = mk([[FO8, level]]);
    const p = player(w);
    p.maxHp = 1000;
    p.hp = 500;
    p.aux0 = 3;
    p.aux1 = DUE;
    return { w, p };
  }

  it('감쇠 성사 틱에 소멸 스택 1개가 (3 + Lv) 회복으로 전환된다', () => {
    const { w, p } = fo8World(10);
    onSignatureStep(w, p, emptyInput());
    expect(p.hp).toBe(500 + 13);
  });

  it('레벨이 오르면 회복도 오른다 — Lv1 = 4, Lv20 = 23', () => {
    const lo = fo8World(1);
    onSignatureStep(lo.w, lo.p, emptyInput());
    expect(lo.p.hp).toBe(504);
    const hi = fo8World(20);
    onSignatureStep(hi.w, hi.p, emptyInput());
    expect(hi.p.hp).toBe(523);
  });

  it('감쇠 성사 틱이 아니거나 스택이 0 이면 회복이 없다 (음성 짝)', () => {
    const notDue = fo8World(10);
    notDue.p.aux1 = DUE - 1;
    onSignatureStep(notDue.w, notDue.p, emptyInput());
    expect(notDue.p.hp).toBe(500);

    const noStack = fo8World(10);
    noStack.p.aux0 = 0;
    onSignatureStep(noStack.w, noStack.p, emptyInput());
    expect(noStack.p.hp).toBe(500);
  });

  it('회복은 최대 HP 를 넘지 않는다', () => {
    const { w, p } = fo8World(20);
    p.hp = 995;
    onSignatureStep(w, p, emptyInput());
    expect(p.hp).toBe(1000);
  });

  it('축 내 긴장 — FO4 가 정지에서 반전시키면 회복이 없고, 이동하면 회복된다 (양·음성 짝)', () => {
    const still = mk([
      [FO4, 5],
      [FO8, 10],
    ]);
    const ps = player(still);
    ps.maxHp = 1000;
    ps.hp = 500;
    ps.aux0 = 3;
    ps.aux1 = DUE;
    onSignatureStep(still, ps, emptyInput());
    expect(ps.aux0).toBe(4); // 반전이 이겼다
    expect(ps.hp).toBe(500); // 소멸이 없으니 회복도 없다

    const moving = mk([
      [FO4, 5],
      [FO8, 10],
    ]);
    const pm = player(moving);
    pm.maxHp = 1000;
    pm.hp = 500;
    pm.aux0 = 3;
    pm.aux1 = DUE;
    onSignatureStep(moving, pm, { ...emptyInput(), moveY: -1 });
    expect(pm.aux0).toBe(3); // 반전 안 함 — 엔진 분기가 가져간다
    expect(pm.hp).toBe(513);
  });

  it('미투자 런은 감쇠 성사 틱에도 회복하지 않는다', () => {
    const w = mk([[MO9, 5]]);
    const p = player(w);
    p.maxHp = 1000;
    p.hp = 500;
    p.aux0 = 3;
    p.aux1 = DUE;
    onSignatureStep(w, p, emptyInput());
    expect(p.hp).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// ⑳ FO9 사투 본능 — 세 지점 (앵커 ⑨① · 앵커 ④② · 앵커 ⑧③)
// ---------------------------------------------------------------------------

describe('⑳ FO9 사투 본능', () => {
  const DUE = ARMOR_DECAY_TICKS - 1;

  /** 빈사(기본 HP 20%)로 세팅된 런. 임계는 30% **이하**다. */
  function lastStand(level: number, hpBp = 2000): { w: WorldState; p: Entity } {
    const w = mk([[FO9, level]]);
    const p = player(w);
    p.maxHp = 1000;
    p.hp = (1000 * hpBp) / 10000;
    return { w, p };
  }

  it('① 빈사 중에는 감쇠 성사 틱에도 스택이 안 준다 (임계 밖이면 준다 — 짝)', () => {
    const low = lastStand(1);
    low.p.aux0 = 3;
    low.p.aux1 = DUE;
    stepWorld(low.w, emptyInput());
    expect(low.p.aux0).toBe(3);
    expect(low.p.aux1).toBe(1); // 우리가 되돌린 뒤 분기의 aux1++

    const high = lastStand(1, 8000); // HP 80% — 임계 밖
    high.p.aux0 = 3;
    high.p.aux1 = DUE;
    stepWorld(high.w, emptyInput());
    expect(high.p.aux0).toBe(2); // 종전 감쇠 그대로
    expect(high.p.aux1).toBe(0);
  });

  it('① 임계는 30% **이하** 포함이고 그 위는 밖이다', () => {
    const at = lastStand(1, 3000);
    at.p.aux0 = 3;
    at.p.aux1 = DUE;
    onSignatureStep(at.w, at.p, emptyInput());
    expect(at.p.aux1).toBe(0); // 정지시켰다

    const over = lastStand(1, 3001);
    over.p.aux0 = 3;
    over.p.aux1 = DUE;
    onSignatureStep(over.w, over.p, emptyInput());
    expect(over.p.aux1).toBe(DUE); // 안 건드렸다 — 엔진이 가져간다
  });

  it('② 빈사 피격은 적립이 2스택이 된다 (임계 밖이면 엔진의 1스택 그대로)', () => {
    // 앵커 ④ 는 엔진 적립(+1) **뒤**라, 여기서 관측되는 것은 "한 개 더" 다.
    const low = lastStand(1);
    low.p.aux0 = 2;
    low.p.aux1 = 7;
    onPlayerDamaged(low.w, low.p, 50, false, DamageSource.bullet);
    expect(low.p.aux0).toBe(3);
    expect(low.p.aux1).toBe(0);

    const high = lastStand(1, 8000);
    high.p.aux0 = 2;
    high.p.aux1 = 7;
    onPlayerDamaged(high.w, high.p, 50, false, DamageSource.bullet);
    expect(high.p.aux0).toBe(2);
    expect(high.p.aux1).toBe(7);
  });

  it('② 추가 적립도 유효 상한을 넘지 않는다', () => {
    const { w, p } = lastStand(20);
    p.aux0 = w.armorMaxStacks;
    onPlayerDamaged(w, p, 50, false, DamageSource.bullet);
    expect(p.aux0).toBe(w.armorMaxStacks);
  });

  it('③ 빈사 중 감쇠 사슬이 스택에 비례해 더 깎는다 (스택 0 이면 안 깎는다 — 하한 짝)', () => {
    const full = lastStand(20);
    full.p.aux0 = 8;
    // round(1000 × 8 × (20 + 5×20) / 10000) = 96.
    expect(onDamageChain(full.w, full.p, 1000)).toBe(1000 - 96);

    const bare = lastStand(20);
    bare.p.aux0 = 0;
    expect(onDamageChain(bare.w, bare.p, 1000)).toBe(1000);
  });

  it('③ 임계 밖에서는 한 칸도 안 깎는다 (음성 짝)', () => {
    const high = lastStand(20, 8000);
    high.p.aux0 = 8;
    expect(onDamageChain(high.w, high.p, 1000)).toBe(1000);
  });

  it('③ 레벨이 오르면 감소도 커진다 — 단조 + 하한', () => {
    const lo = lastStand(1);
    lo.p.aux0 = 8;
    const hi = lastStand(20);
    hi.p.aux0 = 8;
    const outLo = onDamageChain(lo.w, lo.p, 1000);
    const outHi = onDamageChain(hi.w, hi.p, 1000);
    expect(outLo).toBeLessThan(1000); // 하한 — 양변이 1000 이 되는 항진 차단
    expect(outHi).toBeLessThan(outLo);
  });

  it('미투자 런은 세 지점 어디에서도 안 돈다', () => {
    const w = mk([[MO9, 5]]);
    const p = player(w);
    p.maxHp = 1000;
    p.hp = 100;
    p.aux0 = 3;
    p.aux1 = DUE;
    onPlayerDamaged(w, p, 50, false, DamageSource.bullet);
    expect(p.aux0).toBe(3); // 적립 없음
    expect(onDamageChain(w, p, 1000)).toBe(1000); // 감소 없음
    onSignatureStep(w, p, emptyInput());
    expect(p.aux1).toBe(DUE); // 감쇠 정지 없음
  });
});
