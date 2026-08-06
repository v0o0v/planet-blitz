/**
 * 해츨링 30스킬 배선(ADR-0049 배치 5) — **앵커를 통과하는 관측 테스트**.
 *
 * ## 왜 효과 함수를 직접 부르지 않는가
 * `src/sim/skills/hatchling.ts` 의 함수를 직접 부르면 "효과 산술이 맞다"만 잰다. 이 저장소가
 * 반복해서 밟은 실패는 그쪽이 아니라 **"고쳐 놨는데 아무도 안 부른다"** 였다. 그래서 전부
 * `skillHooks.ts` 의 **공개 앵커**를 통해 자극한다 — `case SIG_HATCHLING_BROOD:` 가 빠지면
 * 즉시 빨개진다(스트라이커 레인이 세운 규율 그대로).
 *
 * ## 병아리를 손으로 만드는 이유
 * 시그니처 출격(`stepHatchBrood`)은 처치 적립이 임계(12+)에 닿아야 도는데, 테스트에서 적을
 * 12기 죽이는 것은 웨이브·드랍 RNG 를 통째로 끌고 온다. 병아리의 **정체는 계약으로 고정**돼
 * 있으므로(`turretPickup` + `ownerId = BROOD_MARK` + `phase === 1`) 그 셋을 직접 세운다 —
 * 이 셋 중 하나라도 코드가 다르게 읽으면 여기서 빨개진다.
 *
 * ## 뮤테이션으로 계측기를 검사했다 (2026-08-07 — 결과는 레인 보고서)
 *  1. **효과 본체 삭제** — `hatchlingVolleyFired` 의 `e.cooldown = …` 한 줄을 지운다.
 *  2. **배선 이음매 치환** — 앵커 ⑨ 의 `case SIG_HATCHLING_BROOD:` 를 지운다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import type { Entity } from '../src/sim/entities.js';
import { blankEntity } from '../src/sim/entities.js';
import { hashWorld } from '../src/sim/replay.js';
import {
  onVolleyFired,
  onDashFired,
  onDamageChain,
  onSignatureStep,
  onEnemyDamaged,
  onBroodLaunchParams,
  onBroodLaunched,
  onTurretShotParams,
} from '../src/sim/skillHooks.js';
import type { BroodParams, TurretShotParams } from '../src/sim/skillHooks.js';
import { DRONE_MARK } from '../src/sim/uniques.js';
import { SIG_HATCHLING_BROOD, BROOD_MARK } from '../src/sim/shipSignature.js';
import { readSlot, SKILL_SLOT_COUNT, HatchlingStage } from '../src/sim/skillSlots.js';
import { COLD_DURATION } from '../src/sim/status.js';
import { TURRET_LIFE_TICKS } from '../src/sim/events.js';

/** flat 인덱스 — `data/ships/hatchling.ts` 축 순서(BD 0..9 · NU 10..19 · SH 20..29). */
const BD5 = 4;
const NU5 = 14;
const NU6 = 15;
const NU8 = 17;
const BD1 = 0;
const BD2 = 1;
const BD6 = 5;
const BD10 = 9;
const NU2 = 11;
const NU7 = 16;
const NU10 = 19;
const SH1 = 20;
const SH3 = 22;
const SH5 = 24;
const SH6 = 25;
const SH7 = 26;
const SH10 = 29;

/** 지정한 flat 인덱스에만 포인트를 넣은 30칸 투자 벡터. */
function invest(points: ReadonlyArray<readonly [number, number]>): number[] {
  const v = new Array<number>(30).fill(0);
  for (const [i, n] of points) v[i] = n;
  return v;
}

/** 해츨링(기체 타입 4) 런. */
function mk(points: ReadonlyArray<readonly [number, number]> = []): WorldState {
  return createWorld(4321, {
    ...DEFAULT_CONFIG,
    shipType: 4,
    skillInvest: invest(points),
  });
}

function player(state: WorldState): Entity {
  const p = state.entities[0];
  if (p === undefined) throw new Error('player missing');
  return p;
}

/**
 * 병아리 1기 — `stepHatchBrood` 가 세우는 것과 **같은 세 값**(kind·ownerId·phase)을 세운다.
 * `phase = 1` 은 `activateTurret` 이 세우는 생사 스위치이고 `isActiveTurret` 이 그것을 읽는다.
 */
function chick(state: WorldState, dx: number, dy: number): Entity {
  const p = player(state);
  const c = blankEntity('turretPickup');
  c.id = 70000 + state.entities.length;
  c.ownerId = BROOD_MARK;
  c.phase = 1;
  c.life = TURRET_LIFE_TICKS;
  c.cooldown = 0;
  c.radius = 44;
  c.x = p.x + dx;
  c.y = p.y + dy;
  state.entities.push(c);
  return c;
}

/** 적 1기. */
function enemyNear(state: WorldState, dx: number, dy: number): Entity {
  const p = player(state);
  const e = blankEntity('enemy');
  e.id = 90000 + state.entities.length;
  e.hp = 1000;
  e.maxHp = 1000;
  e.x = p.x + dx;
  e.y = p.y + dy;
  state.entities.push(e);
  return e;
}

/** 병아리 탄(아군탄) — 마커는 `fireTurretShot` 이 찍는 그 값이다. */
function broodBullet(state: WorldState): Entity {
  const b = blankEntity('bullet');
  b.id = 80000 + state.entities.length;
  b.ownerId = BROOD_MARK;
  b.damage = 3;
  return b;
}

// ---------------------------------------------------------------------------
// ⓪ 전제 — 이 테스트가 해츨링을 자극하고 있는가
// ---------------------------------------------------------------------------

describe('⓪ 전제', () => {
  it('shipType 4 런은 부화 시그니처이고 투자 벡터는 30칸이다', () => {
    const w = mk([[BD5, 1]]);
    expect(w.sigBit).toBe(SIG_HATCHLING_BROOD);
    expect(w.skillsOn).toBe(true);
    expect(w.skillDerived.shipType).toBe(4);
    expect(w.config.skillInvest).toHaveLength(30);
  });

  it('투자 0 런은 `skillsOn` 이 거짓이라 앵커가 첫 줄에서 반환한다', () => {
    expect(mk().skillsOn).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ① 불변 계약 — 투자 0 런은 바이트 불변이어야 한다
// ---------------------------------------------------------------------------

describe('① 투자 0 런 불변', () => {
  it('투자 0 해츨링 런 두 개가 240틱 뒤 같은 해시다 (슬롯도 전부 0)', () => {
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

  it('투자 0 런에서는 병아리·플레이어 상태가 앵커를 지나도 한 칸도 안 움직인다', () => {
    const w = mk();
    const c = chick(w, 900, 0); // 이탈 임계(480) 밖 — NU8 이 켜졌다면 걸어왔을 자리
    c.cooldown = 10;
    c.life = 500;
    const p = player(w);
    p.aux0 = 5;
    p.iframes = 0;
    const before = { x: c.x, y: c.y, cd: c.cooldown, life: c.life, aux0: p.aux0 };

    onVolleyFired(w, p);
    onDashFired(w, p);
    onSignatureStep(w, p, emptyInput());
    expect(onDamageChain(w, p, 40)).toBe(40);

    expect(c.x).toBe(before.x);
    expect(c.y).toBe(before.y);
    expect(c.cooldown).toBe(before.cd);
    expect(c.life).toBe(before.life);
    expect(p.aux0).toBe(before.aux0);
    expect(p.iframes).toBe(0);
    expect(readSlot(w.skillStage, HatchlingStage.launchAux0Seen)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ② 앵커 ① — BD5 격발 공명
// ---------------------------------------------------------------------------

describe('② 앵커 ① BD5 격발 공명', () => {
  it('볼리 1회가 병아리 전원의 쿨다운을 1 + floor(Lv/5) 만큼 깎는다', () => {
    const w = mk([[BD5, 10]]); // cut = 1 + 2 = 3
    const a = chick(w, 60, 0);
    const b = chick(w, -60, 0);
    a.cooldown = 10;
    b.cooldown = 4;
    onVolleyFired(w, player(w));
    expect(a.cooldown).toBe(7);
    expect(b.cooldown).toBe(1);
  });

  it('0 아래로 내려가지 않는다 — 음수 쿨다운은 발사 판정을 통째로 건너뛴다', () => {
    const w = mk([[BD5, 20]]); // cut = 5
    const a = chick(w, 60, 0);
    a.cooldown = 2;
    onVolleyFired(w, player(w));
    expect(a.cooldown).toBe(0);
  });

  it('미투자면 쿨다운이 그대로다', () => {
    const w = mk([[SH5, 1]]); // 다른 스킬만 투자 → skillsOn 은 참
    const a = chick(w, 60, 0);
    a.cooldown = 10;
    onVolleyFired(w, player(w));
    expect(a.cooldown).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// ③ 앵커 ② — NU5 알 굴리기(전진 절반)
// ---------------------------------------------------------------------------

describe('③ 앵커 ② NU5 알 굴리기', () => {
  it('대시 발동 틱에 부화 스냅샷이 정확히 1 전진한다 (레벨 불변)', () => {
    const lo = mk([[NU5, 1]]);
    const hi = mk([[NU5, 20]]);
    player(lo).aux0 = 9;
    player(hi).aux0 = 9;
    onDashFired(lo, player(lo));
    onDashFired(hi, player(hi));
    expect(player(lo).aux0).toBe(8);
    expect(player(hi).aux0).toBe(8); // 전진량 1 고정 — 레벨로 키우지 않는다
  });

  it('0 에서 클램프한다 (음수 스냅샷 금지)', () => {
    const w = mk([[NU5, 1]]);
    player(w).aux0 = 0;
    onDashFired(w, player(w));
    expect(player(w).aux0).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ④ 앵커 ⑧ — SH1 호위 희생 → SH7 회생 부화 (흡수 2단, 순서 고정)
// ---------------------------------------------------------------------------

describe('④ 앵커 ⑧ 흡수 사슬', () => {
  it('SH1 — 병아리 1기만 소멸하고 흡수량만큼 피해가 줄어든다', () => {
    const w = mk([[SH1, 1]]); // 흡수 = round(8 + 60/19) = 11
    const a = chick(w, 60, 0);
    const b = chick(w, -60, 0);
    const out = onDamageChain(w, player(w), 30);
    expect(out).toBe(19);
    expect(a.dead).toBe(true);
    expect(b.dead).toBe(false); // 건별 잔돈 — 한 기만 쓴다
    expect(a.aux1).toBe(1); // 소멸 사유 코드(= 희생). 자연 만료는 0.
  });

  it('SH1 — 병아리가 0기면 미발동(대가 내장)', () => {
    const w = mk([[SH1, 20]]);
    expect(onDamageChain(w, player(w), 30)).toBe(30);
  });

  it('SH7 — 치사 피격에서 전원 소멸하고 HP 를 남기고 생존한다', () => {
    const w = mk([[SH7, 1]]); // 기당 잔존 = 4 + round(16/13) = 5
    const p = player(w);
    p.hp = 10;
    const a = chick(w, 60, 0);
    const b = chick(w, -60, 0);
    const out = onDamageChain(w, p, 999);
    expect(a.dead).toBe(true);
    expect(b.dead).toBe(true);
    // 잔존 = min(5×2, maxHp×31%) 이고 maxHp 는 10 보다 크므로 상한이 아니라 기당 합이 산다.
    expect(out).toBe(p.hp - 10);
    expect(p.hp - out).toBeGreaterThan(0); // 반드시 살아남는다
  });

  it('SH7 — 병아리가 0기면 그대로 죽는다', () => {
    const w = mk([[SH7, 20]]);
    const p = player(w);
    p.hp = 10;
    expect(onDamageChain(w, p, 999)).toBe(999);
  });

  it('순서 — SH1 흡수가 먼저 돈다(둘 다 투자해도 소피해는 SH1 이 먹는다)', () => {
    const w = mk([
      [SH1, 1],
      [SH7, 1],
    ]);
    const p = player(w);
    p.hp = 100;
    const a = chick(w, 60, 0);
    const b = chick(w, -60, 0);
    expect(onDamageChain(w, p, 30)).toBe(19); // SH1 만 발동(치사가 아니다)
    expect(a.dead).toBe(true);
    expect(b.dead).toBe(false); // SH7 은 안 돌았다 — 전멸하지 않았다
  });
});

// ---------------------------------------------------------------------------
// ⑤ 앵커 ⑨ — SH6 · SH3 · NU6 · NU8
// ---------------------------------------------------------------------------

describe('⑤ 앵커 ⑨ 매 틱 축', () => {
  it('SH6 — `aux0` 이 오른 다음 틱에 모선 무적이 선다 (한 틱 늦지만 유실 없음)', () => {
    const w = mk([[SH6, 1]]); // 무적 = 20 + 3 = 23
    const p = player(w);
    p.iframes = 0;
    p.aux0 = 0;
    onSignatureStep(w, p, emptyInput()); // 스냅샷 0 관측 — 아직 출격 없음
    expect(p.iframes).toBe(0);

    p.aux0 = 17; // 출격 성공 = `aux0 = state.kills` (증가)
    onSignatureStep(w, p, emptyInput());
    expect(p.iframes).toBe(23);
    expect(readSlot(w.skillStage, HatchlingStage.launchAux0Seen)).toBe(17);

    p.iframes = 0;
    onSignatureStep(w, p, emptyInput()); // 같은 aux0 → 재발동 금지
    expect(p.iframes).toBe(0);
  });

  it('SH6 — `aux0` 감소(액티브·NU5 전진)는 출격이 아니므로 발동하지 않는다', () => {
    const w = mk([[SH6, 20]]);
    const p = player(w);
    p.aux0 = 30;
    onSignatureStep(w, p, emptyInput());
    p.iframes = 0;
    p.aux0 = 10; // advanceHatch 방향
    onSignatureStep(w, p, emptyInput());
    expect(p.iframes).toBe(0);
  });

  it('SH3 — 만석(4기)에서만 주기 틱에 회복한다', () => {
    const full = mk([[SH3, 1]]); // 주기 = 60 + floor(4800/21) = 288 · tick 0 은 주기 틱
    const pf = player(full);
    pf.hp = 10;
    for (let i = 0; i < 4; i++) chick(full, 60 + i, 0);
    onSignatureStep(full, pf, emptyInput());
    expect(pf.hp).toBe(12);

    const short = mk([[SH3, 1]]);
    const ps = player(short);
    ps.hp = 10;
    for (let i = 0; i < 3; i++) chick(short, 60 + i, 0);
    onSignatureStep(short, ps, emptyInput());
    expect(ps.hp).toBe(10); // 3기는 만석이 아니다
  });

  it('NU6 — 콤보 창 중에는 짝수 틱에 수명이 +1 상쇄된다(감소 절반)', () => {
    const w = mk([[NU6, 1]]); // 정지 임계 = 12 스택
    const c = chick(w, 60, 0);
    c.life = 500;
    w.comboTimer = 60;
    w.combo = 2; // 임계 미만 → 홀짝 상쇄
    w.tick = 10; // 짝수
    onSignatureStep(w, player(w), emptyInput());
    expect(c.life).toBe(501);

    c.life = 500;
    w.tick = 11; // 홀수
    onSignatureStep(w, player(w), emptyInput());
    expect(c.life).toBe(500);
  });

  it('NU6 — 콤보 창이 없으면 상쇄가 없다', () => {
    const w = mk([[NU6, 20]]);
    const c = chick(w, 60, 0);
    c.life = 500;
    w.comboTimer = 0;
    w.combo = 30;
    w.tick = 10;
    onSignatureStep(w, player(w), emptyInput());
    expect(c.life).toBe(500);
  });

  it('NU6 — 임계 스택 이상이면 홀수 틱에도 상쇄한다(수명 감소 정지)', () => {
    const w = mk([[NU6, 20]]); // 임계 = 12 − 5 = 7
    const c = chick(w, 60, 0);
    c.life = 500;
    w.comboTimer = 60;
    w.combo = 9;
    w.tick = 11; // 홀수인데도 상쇄
    onSignatureStep(w, player(w), emptyInput());
    expect(c.life).toBe(501);
  });

  it('NU8 — 이탈 임계(480) 밖 병아리만 플레이어 쪽으로 걷는다', () => {
    const w = mk([[NU8, 1]]);
    const far = chick(w, 900, 0);
    const near = chick(w, 300, 0);
    const nearX = near.x;
    onSignatureStep(w, player(w), emptyInput());
    expect(far.x).toBeLessThan(player(w).x + 900);
    expect(far.y).toBe(player(w).y); // 축 위 — 직선 접근
    expect(near.x).toBe(nearX); // 임계 안 → 제자리
  });

  it('NU8 — 걸음이 플레이어를 추월하지 않는다(속도가 playerSpeed 미만 파생)', () => {
    const w = mk([[NU8, 20]]); // 80%
    const c = chick(w, 900, 0);
    const px = player(w).x;
    onSignatureStep(w, player(w), emptyInput());
    expect(c.x).toBeGreaterThan(px);
  });
});

// ---------------------------------------------------------------------------
// ⑥ 앵커 ⑩ — SH5 경계 지저귐
// ---------------------------------------------------------------------------

describe('⑥ 앵커 ⑩ SH5 경계 지저귐', () => {
  it('병아리 탄 명중이 적에게 냉기 지속 COLD_DURATION + 6×Lv 를 건다', () => {
    const w = mk([[SH5, 5]]);
    const e = enemyNear(w, 200, 0);
    onEnemyDamaged(w, e, 3, broodBullet(w));
    expect(e.ownerId).toBe(COLD_DURATION + 30);
  });

  it('병아리 탄이 아니면 냉기가 걸리지 않는다 (마커 판정)', () => {
    const w = mk([[SH5, 5]]);
    const e = enemyNear(w, 200, 0);
    const plain = blankEntity('bullet');
    plain.id = 81000;
    onEnemyDamaged(w, e, 3, plain);
    expect(e.ownerId).toBe(0);
  });

  it('미투자면 걸리지 않는다', () => {
    const w = mk([[BD5, 1]]);
    const e = enemyNear(w, 200, 0);
    onEnemyDamaged(w, e, 3, broodBullet(w));
    expect(e.ownerId).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑦ 슬롯 규약 — 이 배치는 `Stage` 한 칸만 쓴다
// ---------------------------------------------------------------------------

describe('⑦ 슬롯 규약', () => {
  it('9종을 전부 켠 런에서도 `skillCarry` 는 한 칸도 안 쓴다', () => {
    const w = mk([
      [BD5, 3],
      [NU5, 3],
      [NU6, 3],
      [NU8, 3],
      [SH1, 3],
      [SH3, 3],
      [SH5, 3],
      [SH6, 3],
      [SH7, 3],
    ]);
    const p = player(w);
    chick(w, 60, 0);
    p.aux0 = 12;
    onVolleyFired(w, p);
    onDashFired(w, p);
    onSignatureStep(w, p, emptyInput());
    onEnemyDamaged(w, enemyNear(w, 200, 0), 3, broodBullet(w));
    for (let s = 0; s < SKILL_SLOT_COUNT; s++) {
      expect(readSlot(w.skillCarry, s)).toBe(0);
    }
    // 이 9종이 쓰는 Stage 칸은 SH6 스냅샷 하나뿐이다(BD2·NU10 칸은 W레인 소유 — ⑨절이 잠근다).
    for (let s = 1; s < SKILL_SLOT_COUNT; s++) {
      expect(readSlot(w.skillStage, s)).toBe(0);
    }
    expect(readSlot(w.skillStage, HatchlingStage.launchAux0Seen)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ⑧ 앵커 ㉓ — 출격 파라미터(BD1 · SH10 · NU10 · BD2)
// ---------------------------------------------------------------------------
//
// ⚠️ **뮤테이션으로 계측기를 검사했다(2026-08-07 W레인)**: ①`hatchlingBroodLaunchParams` 의
// 각 축 한 줄씩 삭제 ②앵커 ㉓·㉔ 의 `case SIG_HATCHLING_BROOD:` 삭제 — 결과는 레인 보고서.
// ⚠️ **비례·단조 단언에는 하한을 짝으로 붙였다**: "배선이 끊기면 양변이 0" 이 되어 성립하는
// 항진(버블 FI4 선례)을 막으려고 "드론이 최소 1대 떴다"·"젬이 최소 1개 떨어졌다"를 먼저 잰다.

/** 앵커 ㉓ 이 받는 것과 같은 초기값(`stepHatchBrood` 최상단 리터럴). */
function broodParams(threshold = 40): BroodParams {
  return { threshold, maxDrones: 4, launchCount: 1 };
}

describe('⑧ 앵커 ㉓ 출격 파라미터', () => {
  it('BD1 — 요구치가 (1 + floor(Lv/5)) 만큼 줄고, 미투자 런은 그대로다', () => {
    const w = mk([[BD1, 5]]); // 감산 = 1 + 1 = 2
    const a = broodParams(40);
    onBroodLaunchParams(w, player(w), a);
    expect(a.threshold).toBe(38);
    expect(a.threshold).toBeLessThan(40); // 단조 — 위 등식이 항진이 아님을 짝으로 고정
    expect(a.threshold).toBeGreaterThanOrEqual(6);

    const n = mk(); // 음성 대조 — 미투자면 종전 거동
    const b = broodParams(40);
    onBroodLaunchParams(n, player(n), b);
    expect(b.threshold).toBe(40);
    expect(b.maxDrones).toBe(4);
    expect(b.launchCount).toBe(1);
  });

  it('BD1 — 하한 6 은 훅이 스스로 건다(엔진에 클램프가 없다)', () => {
    const w = mk([[BD1, 20]]); // 감산 = 1 + 4 = 5
    const p = broodParams(7); // 7 − 5 = 2 → 바닥 6 이 이긴다
    onBroodLaunchParams(w, player(w), p);
    expect(p.threshold).toBe(6);
  });

  it('SH10 — 상한 +1 과 요구치 페널티가 동시에 걸린다(Lv20 은 +1)', () => {
    const lo = mk([[SH10, 1]]); // 페널티 = 6 − 0 = 6
    const a = broodParams(40);
    onBroodLaunchParams(lo, player(lo), a);
    expect(a.maxDrones).toBe(5);
    expect(a.threshold).toBe(46);

    const hi = mk([[SH10, 20]]); // 페널티 = 6 − 5 = 1
    const b = broodParams(40);
    onBroodLaunchParams(hi, player(hi), b);
    expect(b.maxDrones).toBe(5);
    expect(b.threshold).toBe(41);
  });

  it('SH10 — SH3 만석 술어가 **같은 실효 상한**을 읽는다 (상한 5 에서 4기는 만석이 아니다)', () => {
    // 함정: 상한을 ㉓ 에서만 올리고 SH3 이 리터럴 4 를 읽으면 "만석이 아닌데 만석"이 된다.
    const four = mk([
      [SH3, 1],
      [SH10, 1],
    ]);
    const p4 = player(four);
    p4.hp = 10;
    for (let i = 0; i < 4; i++) chick(four, 60 + i, 0);
    onSignatureStep(four, p4, emptyInput());
    expect(p4.hp).toBe(10); // 상한 5 → 4기는 만석 아님

    const five = mk([
      [SH3, 1],
      [SH10, 1],
    ]);
    const p5 = player(five);
    p5.hp = 10;
    for (let i = 0; i < 5; i++) chick(five, 60 + i, 0);
    onSignatureStep(five, p5, emptyInput());
    expect(p5.hp).toBe(12); // 긍정 짝 — 부정 단언만 두면 뮤테이션에 안 걸린다
  });

  it('BD2 — N번째 출격 사건마다 2기가 나가고, 미투자 런은 항상 1기다', () => {
    const w = mk([[BD2, 20]]); // N = 2 + round(18/22) = 3
    const p = player(w);
    p.aux0 = 0;
    w.kills = 100; // 임계는 넉넉히 넘기고 병아리는 0기 → 매 호출이 출격 성사다
    const counts: number[] = [];
    for (let i = 0; i < 6; i++) {
      const q = broodParams(12);
      onBroodLaunchParams(w, p, q);
      counts.push(q.launchCount);
    }
    expect(counts).toEqual([1, 1, 2, 1, 1, 2]);
    expect(readSlot(w.skillStage, HatchlingStage.twinLaunchCount)).toBe(6);

    const n = mk([[BD2, 0]]);
    const np = player(n);
    n.kills = 100;
    const nc: number[] = [];
    for (let i = 0; i < 6; i++) {
      const q = broodParams(12);
      onBroodLaunchParams(n, np, q);
      nc.push(q.launchCount);
    }
    expect(nc).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('BD2 — 출격이 성사되지 않는 틱은 사건 카운터를 올리지 않는다', () => {
    const w = mk([[BD2, 20]]); // N = 3
    const p = player(w);
    w.kills = 0; // 임계 미달 = 출격 없음
    for (let i = 0; i < 5; i++) onBroodLaunchParams(w, p, broodParams(12));
    expect(readSlot(w.skillStage, HatchlingStage.twinLaunchCount)).toBe(0);

    w.kills = 100; // 이제 성사 — 3번째에 쌍둥이가 나와야 한다(앞의 5틱이 안 셌다는 증거)
    const counts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const q = broodParams(12);
      onBroodLaunchParams(w, p, q);
      counts.push(q.launchCount);
    }
    expect(counts).toEqual([1, 1, 2]);
  });

  it('NU10 — 만석 보류 중 적립하고, 자리가 나면 임계에 선납한다(잔액 보존)', () => {
    const w = mk([[NU10, 20]]); // 저금 상한 = round(8 + 800/36) = 30
    const p = player(w);
    p.aux0 = 0;
    for (let i = 0; i < 4; i++) chick(w, 60 + i, 0); // 만석(상한 4)

    onBroodLaunchParams(w, p, broodParams(12)); // kills 0 관측만
    expect(readSlot(w.skillStage, HatchlingStage.eggBank)).toBe(0);

    w.kills = 20; // 보류 중 20처치 — 임계 12 초과분이 저금된다
    onBroodLaunchParams(w, p, broodParams(12));
    const bank = readSlot(w.skillStage, HatchlingStage.eggBank);
    expect(bank).toBeGreaterThan(0); // 하한 짝 — 아래 등식이 0 == 0 항진이 되는 것을 막는다
    expect(bank).toBe(20);

    for (const e of w.entities) if (e.ownerId === BROOD_MARK) e.dead = true; // 자리가 났다
    const q = broodParams(12);
    onBroodLaunchParams(w, p, q);
    expect(q.threshold).toBe(1); // 선납 = min(20, 12−1) = 11 → 12 − 11
    expect(readSlot(w.skillStage, HatchlingStage.eggBank)).toBe(9); // 잔액 보존(소각 없음)
  });

  it('NU10 — 미투자 런은 임계도 슬롯도 건드리지 않는다', () => {
    const w = mk();
    const p = player(w);
    for (let i = 0; i < 4; i++) chick(w, 60 + i, 0);
    w.kills = 50;
    const q = broodParams(12);
    onBroodLaunchParams(w, p, q);
    expect(q.threshold).toBe(12);
    expect(readSlot(w.skillStage, HatchlingStage.eggBank)).toBe(0);
    expect(readSlot(w.skillStage, HatchlingStage.eggBankKillsSeen)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑨ 앵커 ㉔ — 출격 직후(NU7 · BD6 · NU2)
// ---------------------------------------------------------------------------

/** 젬 1개(런 풀 XP 젬과 같은 kind). */
function gemAt(state: WorldState, dx: number, dy: number): Entity {
  const p = player(state);
  const g = blankEntity('gem');
  g.id = 60000 + state.entities.length;
  g.radius = 20;
  g.hp = 1;
  g.damage = 4;
  g.x = p.x + dx;
  g.y = p.y + dy;
  state.entities.push(g);
  return g;
}

/** 적탄 1개. */
function enemyBulletAt(state: WorldState, x: number, y: number): Entity {
  const b = blankEntity('enemyBullet');
  b.id = 50000 + state.entities.length;
  b.x = x;
  b.y = y;
  state.entities.push(b);
  return b;
}

function countGems(state: WorldState): number {
  let n = 0;
  for (const e of state.entities) if (e.kind === 'gem' && !e.dead) n++;
  return n;
}

describe('⑨ 앵커 ㉔ 출격 직후', () => {
  it('BD6 — 출격 좌표에서 폭발하고 적탄을 지운다(모선 곁이 아니다)', () => {
    const w = mk([[BD6, 1]]); // 반경 119 · 피해 15
    const p = player(w);
    const c = chick(w, 500, 0); // 모선에서 500 떨어진 원격 출격
    const near = enemyNear(w, 550, 0); // 병아리 기준 50 · 모선 기준 550
    const far = enemyNear(w, 60, 0); // 모선 곁 — 병아리 기준 440 이라 안 맞아야 한다
    const bullet = enemyBulletAt(w, c.x + 40, c.y);
    onBroodLaunched(w, p, c);
    expect(near.hp).toBeLessThan(1000); // 긍정 하한 — 아래 등식의 항진 방지
    expect(near.hp).toBe(985);
    expect(far.hp).toBe(1000); // 부정 짝(긍정은 바로 위)
    expect(bullet.dead).toBe(true);

    const n = mk(); // 음성 대조
    const np = player(n);
    const nc = chick(n, 500, 0);
    const ne = enemyNear(n, 550, 0);
    const nb = enemyBulletAt(n, nc.x + 40, nc.y);
    onBroodLaunched(n, np, nc);
    expect(ne.hp).toBe(1000);
    expect(nb.dead).toBe(false);
  });

  it('NU2 — 출격 좌표에 젬 (2 + floor(Lv/5))개가 떨어진다', () => {
    const w = mk([[NU2, 10]]); // 2 + 2 = 4개
    const p = player(w);
    const c = chick(w, 120, 0);
    const before = countGems(w);
    onBroodLaunched(w, p, c);
    const after = countGems(w);
    expect(after).toBeGreaterThan(before); // 하한 짝
    expect(after - before).toBe(4);
    for (const e of w.entities) {
      if (e.kind === 'gem' && e.id >= 0) {
        expect(Math.abs(e.x - c.x)).toBeLessThanOrEqual(30);
        expect(Math.abs(e.y - c.y)).toBeLessThanOrEqual(30);
      }
    }

    const n = mk(); // 음성 대조
    const nb = countGems(n);
    onBroodLaunched(n, player(n), chick(n, 120, 0));
    expect(countGems(n)).toBe(nb);
  });

  it('NU2 — 기당 1회이므로 쌍둥이 틱에는 두 배가 떨어진다', () => {
    const w = mk([[NU2, 1]]); // 2개
    const p = player(w);
    const before = countGems(w);
    onBroodLaunched(w, p, chick(w, 120, 0));
    onBroodLaunched(w, p, chick(w, -120, 0));
    expect(countGems(w) - before).toBe(4);
  });

  it('NU7 — 허용 거리 안의 최근접 젬 좌표로 부화 지점이 옮겨진다', () => {
    const w = mk([[NU7, 1]]); // 허용 거리 440
    const p = player(w);
    const far = gemAt(w, 400, 0);
    const near = gemAt(w, 300, 0); // 더 가깝다 — 배열 뒤에 있어도 이긴다
    const c = chick(w, 40, 0);
    onBroodLaunched(w, p, c);
    expect(c.x).toBe(near.x);
    expect(c.y).toBe(near.y);
    expect(c.x).not.toBe(far.x);

    const n = mk(); // 음성 대조 — 미투자면 좌표 그대로
    const np = player(n);
    gemAt(n, 300, 0);
    const nc = chick(n, 40, 0);
    const ox = nc.x;
    onBroodLaunched(n, np, nc);
    expect(nc.x).toBe(ox);
  });

  it('NU7 — 젬이 없거나 거리 밖이면 기본 배치 폴백이다(부정 짝은 위 긍정과 한 쌍)', () => {
    const none = mk([[NU7, 1]]);
    const c1 = chick(none, 40, 0);
    const x1 = c1.x;
    onBroodLaunched(none, player(none), c1);
    expect(c1.x).toBe(x1);

    const outOfRange = mk([[NU7, 1]]); // 허용 440
    gemAt(outOfRange, 1000, 0);
    const c2 = chick(outOfRange, 40, 0);
    const x2 = c2.x;
    onBroodLaunched(outOfRange, player(outOfRange), c2);
    expect(c2.x).toBe(x2);
  });

  it('NU7 — BD6·NU2 의 발생지가 함께 옮겨간다(설계 「출격 좌표 상호작용 절」)', () => {
    const w = mk([
      [NU7, 1],
      [BD6, 1],
      [NU2, 1],
    ]);
    const p = player(w);
    gemAt(w, 300, 0);
    const target = enemyNear(w, 340, 0); // 젬 곁 — 모선 기준 340 이라 BD6 반경 119 밖
    const c = chick(w, 40, 0);
    const before = countGems(w);
    onBroodLaunched(w, p, c);
    expect(c.x).toBe(p.x + 300);
    expect(target.hp).toBeLessThan(1000); // 원격 폭격이 성립했다
    expect(countGems(w) - before).toBe(2); // 젬도 모이밭에 떨어졌다
  });
});

// ---------------------------------------------------------------------------
// ⑩ BD10 여왕 사출 — **3축 전부**(상한 ㉓ · 수명 ㉔ · 탄 피해 ㉖)
// ---------------------------------------------------------------------------
//
// ⚠️ **셋을 한 절에 두는 것이 이 절의 요점이다.** 앞 레인이 BD10 을 통째로 미배선으로 남긴
// 사유가 *"상한만 깎으면 순손해"* 였다 — 축 하나가 빠지면 스킬이 반쪽이 아니라 **마이너스**다.
// 어느 하나가 회귀로 빠지면 여기서 빨개져야 한다.
//
// ⚠️ **뮤테이션으로 계측기를 검사했다(2026-08-07 W2)**: ①`hatchlingTurretShotParams` 의
// 곱셈 한 줄 삭제 ②앵커 ㉖ 의 `case SIG_HATCHLING_BROOD:` 삭제 ③`ownerId !== BROOD_MARK`
// 조기 반환 삭제 ④`broodMaxDrones` 의 BD10 항 삭제 ⑤㉔ 의 수명 가산 삭제 — 결과는 레인 보고서.

/** 앵커 ㉖ 이 받는 것과 같은 초기값(`fireTurretShot` 의 `TURRET_BULLET_DAMAGE`). */
function shotParams(): TurretShotParams {
  return { damage: 10 };
}

/** 포탑 1기 — `ownerId` 만 다르게 세운다(병아리 vs 센트리·드론 베이). */
function turretOf(state: WorldState, ownerId: number): Entity {
  const t = chick(state, 120, 0);
  t.ownerId = ownerId;
  return t;
}

describe('⑩ BD10 여왕 사출 — 3축', () => {
  it('축① 상한 — 실효 상한이 실제로 3 으로 줄고, 미투자 런은 4 다', () => {
    const w = mk([[BD10, 1]]);
    const a = broodParams(40);
    onBroodLaunchParams(w, player(w), a);
    expect(a.maxDrones).toBe(3);
    expect(a.maxDrones).toBeLessThan(4); // 단조 짝 — 위 등식이 항진이 아님을 고정

    const n = mk(); // 음성 대조
    const b = broodParams(40);
    onBroodLaunchParams(n, player(n), b);
    expect(b.maxDrones).toBe(4);
  });

  it('축① 상한 — SH3 만석 술어가 **같은 3** 을 읽는다(상한을 ㉓ 에서만 깎으면 갈린다)', () => {
    const w = mk([
      [SH3, 1],
      [BD10, 1],
    ]);
    const p = player(w);
    p.hp = 10;
    for (let i = 0; i < 3; i++) chick(w, 60 + i, 0);
    onSignatureStep(w, p, emptyInput());
    expect(p.hp).toBe(12); // 3기 = 만석(상한 3) → SH3 이 돈다

    const two = mk([
      [SH3, 1],
      [BD10, 1],
    ]);
    const p2 = player(two);
    p2.hp = 10;
    for (let i = 0; i < 2; i++) chick(two, 60 + i, 0);
    onSignatureStep(two, p2, emptyInput());
    expect(p2.hp).toBe(10); // 부정 짝 — 2기는 만석이 아니다
  });

  it('축② 수명 — 태어난 병아리의 수명이 결손×(60 + 10×Lv) 만큼 실제로 늘어난다', () => {
    const w = mk([[BD10, 4]]); // 결손 1 · 가산 = 1 × (60 + 40) = 100
    const c = chick(w, 60, 0);
    expect(c.life).toBe(TURRET_LIFE_TICKS); // 하한 짝 — 기준선이 살아 있다
    onBroodLaunched(w, player(w), c);
    expect(c.life).toBeGreaterThan(TURRET_LIFE_TICKS); // 단조 짝
    expect(c.life).toBe(TURRET_LIFE_TICKS + 100);

    const n = mk(); // 음성 대조
    const nc = chick(n, 60, 0);
    onBroodLaunched(n, player(n), nc);
    expect(nc.life).toBe(TURRET_LIFE_TICKS);
  });

  it('축③ 탄 피해 — 배율이 결손×(30% + 3%p/Lv) 만큼 실제로 실린다', () => {
    const w = mk([[BD10, 10]]); // 결손 1 · 배율 = 1 + (0.3 + 0.3) = 1.6
    const t = turretOf(w, BROOD_MARK);
    const q = shotParams();
    onTurretShotParams(w, t, q);
    expect(q.damage).toBeGreaterThan(10); // 단조 짝 — 아래 등식의 항진 방지
    expect(q.damage).toBeCloseTo(16, 10);

    const n = mk(); // 음성 대조 — 미투자 런은 종전 값 그대로
    const nq = shotParams();
    onTurretShotParams(n, turretOf(n, BROOD_MARK), nq);
    expect(nq.damage).toBe(10);
  });

  it('축③ 회귀(핵심) — **센트리·드론 베이 탄은 안 갈린다**', () => {
    // 같은 BD10 런에서 병아리는 오르고 DRONE_MARK 포탑은 그대로여야 한다. 부정 단언만 두면
    // 뮤테이션에 안 걸리므로 **같은 런의 긍정 짝**을 옆에 세운다.
    const w = mk([[BD10, 10]]);
    const sentry = shotParams();
    onTurretShotParams(w, turretOf(w, DRONE_MARK), sentry);
    expect(sentry.damage).toBe(10);

    const brood = shotParams();
    onTurretShotParams(w, turretOf(w, BROOD_MARK), brood);
    expect(brood.damage).toBeCloseTo(16, 10); // 긍정 짝 — 훅이 죽어서 10 인 게 아니다
  });

  it('SH10 동시 투자는 결손 0 → **세 축이 전부 0** 이다(설계의 구조적 배타)', () => {
    const w = mk([
      [BD10, 20],
      [SH10, 20],
    ]);
    const a = broodParams(40);
    onBroodLaunchParams(w, player(w), a);
    expect(a.maxDrones).toBe(4); // −1 +1

    const c = chick(w, 60, 0);
    onBroodLaunched(w, player(w), c);
    expect(c.life).toBe(TURRET_LIFE_TICKS); // 수명 가산 0

    const q = shotParams();
    onTurretShotParams(w, turretOf(w, BROOD_MARK), q);
    expect(q.damage).toBe(10); // 피해 배율 0
  });

  it('축③ 통합 — 병아리가 **실제로 쏘고** 적 hp 가 **실제로 더** 준다', () => {
    // ⚠️ 하한을 먼저 잰다: 배선이 끊기면 양변이 0 이 되어 성립하는 항진을 막는다.
    function run(points: ReadonlyArray<readonly [number, number]>): {
      drop: number;
      shots: number;
    } {
      const w = mk(points);
      const c = chick(w, 600, 0);
      c.cooldown = 0;
      const target = enemyNear(w, 1000, 0); // 병아리 기준 400(사거리 900 안)
      target.hp = 100_000;
      target.maxHp = 100_000;
      target.radius = 40;
      let shots = 0;
      for (let i = 0; i < 40; i++) {
        stepWorld(w, emptyInput());
        for (const e of w.entities) {
          if (e.kind === 'bullet' && e.ownerId === BROOD_MARK && !e.dead) shots++;
        }
      }
      return { drop: 100_000 - target.hp, shots };
    }

    const base = run([[NU8, 1]]); // BD10 무투자 대조(투자 0 이면 skillsOn 이 꺼진다)
    const boosted = run([
      [NU8, 1],
      [BD10, 10],
    ]);
    expect(base.shots).toBeGreaterThan(0); // 하한 — 포탑이 실제로 쐈다
    expect(base.drop).toBeGreaterThan(0); // 하한 — 적 hp 가 실제로 줄었다
    expect(boosted.drop).toBeGreaterThan(base.drop); // 본 단언
  });
});
