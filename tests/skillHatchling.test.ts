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
} from '../src/sim/skillHooks.js';
import { SIG_HATCHLING_BROOD, BROOD_MARK } from '../src/sim/shipSignature.js';
import { readSlot, SKILL_SLOT_COUNT, HatchlingStage } from '../src/sim/skillSlots.js';
import { COLD_DURATION } from '../src/sim/status.js';
import { TURRET_LIFE_TICKS } from '../src/sim/events.js';

/** flat 인덱스 — `data/ships/hatchling.ts` 축 순서(BD 0..9 · NU 10..19 · SH 20..29). */
const BD5 = 4;
const NU5 = 14;
const NU6 = 15;
const NU8 = 17;
const SH1 = 20;
const SH3 = 22;
const SH5 = 24;
const SH6 = 25;
const SH7 = 26;

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
    // Stage 는 SH6 스냅샷 한 칸뿐이다.
    for (let s = 1; s < SKILL_SLOT_COUNT; s++) {
      expect(readSlot(w.skillStage, s)).toBe(0);
    }
    expect(readSlot(w.skillStage, HatchlingStage.launchAux0Seen)).toBeGreaterThan(0);
  });
});
