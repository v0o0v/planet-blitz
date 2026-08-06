/**
 * 아크캐스터 30스킬 배선(ADR-0049 배치 3) — **앵커를 통과하는 관측 테스트**.
 *
 * ## 왜 효과 함수를 직접 부르지 않는가
 * `src/sim/skills/arccaster.ts` 의 함수를 직접 부르면 "효과 산술이 맞다"만 잰다. 이 저장소가
 * 반복해서 밟은 실패는 그쪽이 아니라 **"고쳐 놨는데 아무도 안 부른다"** 였다. 그래서 전부
 * `skillHooks.ts` 의 **공개 앵커**를 통해 자극한다 — `case SIG_ARC_OVERCHARGE:` 가 빠지면
 * 즉시 빨개진다(스트라이커 레인이 세운 규율 그대로).
 *
 * ## 뮤테이션으로 계측기를 검사했다 (2026-08-06)
 *  1. **효과 본체 삭제** — `arccasterPlayerDamaged` 의 BR7 `player.aux0 = …` 한 줄을 지우니
 *     §④ BR7 이 실패했다.
 *  2. **배선 이음매 치환** — 앵커 ⑨ 의 `case SIG_ARC_OVERCHARGE:` 를 지우니 §⑨ 6건이 한꺼번에
 *     실패했다.
 * 둘 다 복원했다. 초록인데 아무것도 안 재는 테스트가 아니다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import type { Entity } from '../src/sim/entities.js';
import { blankEntity } from '../src/sim/entities.js';
import { hashWorld } from '../src/sim/replay.js';
import {
  onGemCollected,
  onPlayerDamaged,
  onDamageChain,
  onSignatureStep,
  onEnemyDamaged,
  onEnemyDeath,
  onVolleyParams,
} from '../src/sim/skillHooks.js';
import type { VolleyParams } from '../src/sim/skillHooks.js';
import { SIG_ARC_OVERCHARGE } from '../src/sim/shipSignature.js';
import { readSlot, SKILL_SLOT_COUNT } from '../src/sim/skillSlots.js';
import { FIRE_CD_Q } from '../src/sim/constants.js';

/** flat 인덱스 — `data/ships/arccaster.ts` 축 순서(CH 0..9 · BA 10..19 · BR 20..29). */
const CH1 = 0;
const CH4 = 3;
const CH6 = 5;
const CH8 = 7;
const BA3 = 12;
const BA7 = 16;
const BA10 = 19;
const BR1 = 20;
const BR2 = 21;
const BR3 = 22;
const BR4 = 23;
const BR5 = 24;
const BR6 = 25;
const BR7 = 26;
const BR8 = 27;
const BR9 = 28;
const BR10 = 29;

/** 지정한 flat 인덱스에만 포인트를 넣은 30칸 투자 벡터. */
function invest(points: ReadonlyArray<readonly [number, number]>): number[] {
  const v = new Array<number>(30).fill(0);
  for (const [i, n] of points) v[i] = n;
  return v;
}

/** 아크캐스터(기체 타입 2) 런. */
function mk(points: ReadonlyArray<readonly [number, number]> = []): WorldState {
  return createWorld(1234, {
    ...DEFAULT_CONFIG,
    shipType: 2,
    skillInvest: invest(points),
  });
}

function player(state: WorldState): Entity {
  const p = state.entities[0];
  if (p === undefined) throw new Error('player missing');
  return p;
}

/** 플레이어 근처에 적 1기를 놓는다(`applyChain` 이 `id` 로 원점을 거르므로 id 를 준다). */
function enemyNear(state: WorldState, dx: number, dy: number, hp = 1000): Entity {
  const p = player(state);
  const e = blankEntity('enemy');
  e.id = 90000 + state.entities.length;
  e.hp = hp;
  e.maxHp = hp;
  e.x = p.x + dx;
  e.y = p.y + dy;
  state.entities.push(e);
  return e;
}

// ---------------------------------------------------------------------------
// ⓪ 전제 — 이 테스트가 아크캐스터를 자극하고 있는가
// ---------------------------------------------------------------------------

describe('⓪ 전제', () => {
  it('shipType 2 런은 과충전 시그니처이고 투자 벡터는 30칸이다', () => {
    const w = mk([[BR2, 1]]);
    expect(w.sigBit).toBe(SIG_ARC_OVERCHARGE);
    expect(w.skillsOn).toBe(true);
    expect(w.skillDerived.shipType).toBe(2);
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
  it('투자 0 아크캐스터 런 두 개가 240틱 뒤 같은 해시다 (슬롯도 전부 0)', () => {
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
    // ⚠️ `hashWorld` 를 마주 세우면 안 된다 — `config.skillInvest` 자체를 접기 때문에
    // `undefined` 와 `[0×30]` 은 배선과 무관하게 갈린다(스트라이커 레인이 밟은 함정).
    const none = createWorld(77, { ...DEFAULT_CONFIG, shipType: 2 });
    const zero = createWorld(77, { ...DEFAULT_CONFIG, shipType: 2, skillInvest: invest([]) });
    for (let i = 0; i < 180; i++) {
      stepWorld(none, emptyInput());
      stepWorld(zero, emptyInput());
    }
    expect(zero.entities.length).toBe(none.entities.length);
    expect(player(zero).aux0).toBe(player(none).aux0);
    expect(player(zero).hp).toBe(player(none).hp);
    expect(player(zero).maxHp).toBe(player(none).maxHp);
    expect(player(zero).iframes).toBe(player(none).iframes);
    expect(player(zero).cooldown).toBe(player(none).cooldown);
    expect(player(zero).targetX).toBe(player(none).targetX);
    expect(zero.kills).toBe(none.kills);
    for (let s = 0; s < SKILL_SLOT_COUNT; s++) {
      expect(readSlot(zero.skillCarry, s)).toBe(0);
      expect(readSlot(zero.skillStage, s)).toBe(0);
    }
  });

  it('투자 0 런은 앵커를 손으로 때려도 아무것도 안 움직인다', () => {
    const w = mk();
    const p = player(w);
    p.aux0 = 600;
    p.hp = 10;
    p.maxHp = 100;
    p.cooldown = 1000;
    const e = enemyNear(w, 60, 0);
    onPlayerDamaged(w, p, 40, true);
    onSignatureStep(w, p, emptyInput());
    onGemCollected(w, blankEntity('gem'));
    expect(p.aux0).toBe(600);
    expect(p.hp).toBe(10);
    expect(p.cooldown).toBe(1000);
    expect(p.targetX).toBe(0);
    expect(e.hp).toBe(1000);
    expect(onDamageChain(w, p, 100)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// ③ 앵커 ③ 젬 수거 — BA3 정지 관측 사격
// ---------------------------------------------------------------------------

describe('앵커 ③ — BA3 정지 관측 사격', () => {
  it('정지 중(aux0 > 0) 수거는 발사 쿨다운을 환급한다', () => {
    const w = mk([[BA3, 1]]);
    const p = player(w);
    p.aux0 = 30;
    p.cooldown = 1000;
    onGemCollected(w, blankEntity('gem'));
    expect(p.cooldown).toBe(1000 - 2 * FIRE_CD_Q);
  });

  it('이동 중(aux0 === 0) 수거는 환급하지 않는다 — 정지 결속이 이 스킬의 본체다', () => {
    const w = mk([[BA3, 1]]);
    const p = player(w);
    p.aux0 = 0;
    p.cooldown = 1000;
    onGemCollected(w, blankEntity('gem'));
    expect(p.cooldown).toBe(1000);
  });

  it('carry 하한 `(−FIRE_CD_Q, 0]` 을 뚫지 않는다 (연사 폭주 방지)', () => {
    const w = mk([[BA3, 20]]);
    const p = player(w);
    p.aux0 = 30;
    p.cooldown = 0;
    onGemCollected(w, blankEntity('gem'));
    expect(p.cooldown).toBe(-FIRE_CD_Q + 1);
  });
});

// ---------------------------------------------------------------------------
// ④ 앵커 ④ 피격 후속 — BR2 · BR7 · BR6 · BR10
// ---------------------------------------------------------------------------

describe('앵커 ④ — 피격 후속 4종', () => {
  it('BR2 피뢰 접지: 주변 적에게 반격 연쇄가 들어간다', () => {
    const w = mk([[BR2, 1]]);
    const p = player(w);
    const near = enemyNear(w, 100, 0);
    const far = enemyNear(w, 900, 0);
    onPlayerDamaged(w, p, 7, false);
    expect(near.hp).toBe(1000 - (15 + 4));
    expect(far.hp).toBe(1000);
  });

  it('BR2 미투자면 같은 적이 멀쩡하다', () => {
    const w = mk([[BR7, 1]]);
    const p = player(w);
    const near = enemyNear(w, 100, 0);
    onPlayerDamaged(w, p, 7, false);
    expect(near.hp).toBe(1000);
  });

  it('BR7 완충 콘덴서: 깎인 피해가 aux0 으로 전환된다 (600 클램프)', () => {
    const w = mk([[BR7, 1]]);
    const p = player(w);
    p.aux0 = 0;
    onPlayerDamaged(w, p, 10, false);
    // round(10 × (5000 + 500)/10000) = round(5.5) = 6
    expect(p.aux0).toBe(6);
    p.aux0 = 599;
    onPlayerDamaged(w, p, 400, false);
    expect(p.aux0).toBe(600);
  });

  it('BR6 전하 역류: 30% 경계를 **통과**하면 aux0 을 전소하고 회복한다', () => {
    const w = mk([[BR6, 1]]);
    const p = player(w);
    p.maxHp = 100;
    p.hp = 20; // 피격 후 hp. dmg 50 이므로 이전 hp = 70 (> 30) → 통과
    p.aux0 = 600;
    onPlayerDamaged(w, p, 50, false);
    expect(p.aux0).toBe(0);
    // round(600 × (500 + 50)/10000) = 33
    expect(p.hp).toBe(53);
  });

  it('BR6 은 내부 쿨다운 동안 재발동하지 않는다', () => {
    const w = mk([[BR6, 1]]);
    const p = player(w);
    p.maxHp = 100;
    p.hp = 20;
    p.aux0 = 600;
    onPlayerDamaged(w, p, 50, false);
    const cdAfter = readSlot(w.skillCarry, 0); // ArccasterCarry.backflowCooldown
    expect(cdAfter).toBe(1200 + Math.floor(43200 / 12));
    // 두 번째 빈사 진입 — 쿨다운이 남아 있어 무발동
    p.hp = 20;
    p.aux0 = 600;
    onPlayerDamaged(w, p, 50, false);
    expect(p.aux0).toBe(600);
    expect(p.hp).toBe(20);
  });

  it('BR6 은 이미 30% 밑이던 피격(경계 미통과)에는 발동하지 않는다', () => {
    const w = mk([[BR6, 1]]);
    const p = player(w);
    p.maxHp = 100;
    p.hp = 20;
    p.aux0 = 600;
    onPlayerDamaged(w, p, 5, false); // 이전 hp = 25 — 이미 30 이하였다
    expect(p.aux0).toBe(600);
    expect(p.hp).toBe(20);
  });

  it('BR10 최후 접지: 치명 생존 틱에 aux0 상한 주입 + 무적 연장, **런당 1회**', () => {
    const w = mk([[BR10, 1]]);
    const p = player(w);
    p.aux0 = 0;
    p.iframes = 0;
    onPlayerDamaged(w, p, 5, true);
    expect(p.aux0).toBe(600);
    expect(p.iframes).toBe(2);
    expect(p.targetX).toBe(1);
    // 두 번째 치명 생존 — 억제 표식이 이미 서 있어 무발동
    p.aux0 = 0;
    p.iframes = 0;
    onPlayerDamaged(w, p, 5, true);
    expect(p.aux0).toBe(0);
    expect(p.iframes).toBe(0);
  });

  it('BR10 은 치명 생존이 아닌 평범한 피격에는 발동하지 않는다', () => {
    const w = mk([[BR10, 1]]);
    const p = player(w);
    p.aux0 = 0;
    onPlayerDamaged(w, p, 5, false);
    expect(p.aux0).toBe(0);
    expect(p.targetX).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑧ 앵커 ⑧ 감쇠 사슬 — BR3 · BR5 감소 → BR4 흡수
// ---------------------------------------------------------------------------

describe('앵커 ⑧ — 감쇠 사슬 3종', () => {
  it('BR3 위상 결합: 방벽 액티브 지속 중에만 피해가 준다', () => {
    const w = mk([[BR3, 1]]);
    const p = player(w);
    expect(onDamageChain(w, p, 100)).toBe(100); // 버프 없음
    w.activeBuff0 = 30;
    expect(onDamageChain(w, p, 100)).toBe(100 - 16); // 1500 + 100 bp
  });

  it('BR5 접지 케이블: 벽 접촉 **×** 정지 이중 조건이다', () => {
    const w = mk([[BR5, 1]]);
    const p = player(w);
    w.wallContactTicks = 3;
    p.aux0 = 0;
    expect(onDamageChain(w, p, 100)).toBe(100); // 정지가 아니면 무효
    p.aux0 = 5;
    expect(onDamageChain(w, p, 100)).toBe(100 - 13); // 1200 + 120 bp
    w.wallContactTicks = 0;
    expect(onDamageChain(w, p, 100)).toBe(100); // 벽에서 떨어지면 무효
  });

  it('BR4 잉여 전하 방벽: 적립분이 HP 보다 먼저 소모된다', () => {
    const w = mk([[BR4, 1]]);
    const p = player(w);
    p.aux0 = 600; // ≥ 190 이라 매 틱 적립
    for (let i = 0; i < 10; i++) onSignatureStep(w, p, emptyInput());
    expect(readSlot(w.skillStage, 0)).toBe(10); // ArccasterStage.surplusStore
    expect(onDamageChain(w, p, 4)).toBe(0);
    expect(readSlot(w.skillStage, 0)).toBe(6);
    expect(onDamageChain(w, p, 100)).toBe(94);
    expect(readSlot(w.skillStage, 0)).toBe(0);
  });

  it('BR4 적립은 상한 20 + 4×Lv 에서 멈춘다', () => {
    const w = mk([[BR4, 1]]);
    const p = player(w);
    p.aux0 = 600;
    for (let i = 0; i < 60; i++) onSignatureStep(w, p, emptyInput());
    expect(readSlot(w.skillStage, 0)).toBe(24);
  });

  it('감소가 흡수보다 **먼저** 돈다 (순서 계약)', () => {
    // BR3 감소 16 → 84 가 흡수에 들어간다. 흡수가 먼저였다면 자원 소모량이 달라진다.
    const w = mk([
      [BR3, 1],
      [BR4, 1],
    ]);
    const p = player(w);
    p.aux0 = 600;
    for (let i = 0; i < 100; i++) onSignatureStep(w, p, emptyInput());
    expect(readSlot(w.skillStage, 0)).toBe(24);
    w.activeBuff0 = 30;
    expect(onDamageChain(w, p, 100)).toBe(84 - 24);
  });
});

// ---------------------------------------------------------------------------
// ⑨ 앵커 ⑨ 시그니처 틱 — CH4 · BR1 · BR8 · BR9
// ---------------------------------------------------------------------------

describe('앵커 ⑨ — 시그니처 틱 6종', () => {
  it('CH4 진입 뇌격: 90 **통과** 틱에 탄 1발이 사출된다 (한 번만)', () => {
    const w = mk([[CH4, 1]]);
    const p = player(w);
    const before = w.entities.length;
    p.aux0 = 0;
    onSignatureStep(w, p, emptyInput()); // 스냅샷 0 기록, 미발화
    expect(w.entities.length).toBe(before);
    p.aux0 = 120; // 폭 큰 가산이 90 을 건너뛰어도 통과 판정이라 발화한다
    onSignatureStep(w, p, emptyInput());
    expect(w.entities.length).toBe(before + 1);
    p.aux0 = 300; // 이미 과충전 중 — 재발화 없음
    onSignatureStep(w, p, emptyInput());
    expect(w.entities.length).toBe(before + 1);
  });

  it('CH4 미투자면 탄이 안 생긴다', () => {
    const w = mk([[BR9, 1]]);
    const p = player(w);
    const before = w.entities.length;
    p.aux0 = 0;
    onSignatureStep(w, p, emptyInput());
    p.aux0 = 120;
    onSignatureStep(w, p, emptyInput());
    expect(w.entities.length).toBe(before);
  });

  it('BR1 정전 척력장: 과충전 중 45틱 위상에 반경 안 적만 밀려난다', () => {
    const w = mk([[BR1, 1]]);
    const p = player(w);
    p.aux0 = 200;
    w.tick = 45;
    const near = enemyNear(w, 100, 0);
    const far = enemyNear(w, 400, 0);
    const nx = near.x;
    const fx = far.x;
    onSignatureStep(w, p, emptyInput());
    expect(near.x).toBeCloseTo(nx + 23, 6); // 변위 20 + 3
    expect(far.x).toBe(fx);
  });

  it('BR1 은 과충전이 아니면(또는 위상이 아니면) 침묵한다', () => {
    const w = mk([[BR1, 1]]);
    const p = player(w);
    const near = enemyNear(w, 100, 0);
    const nx = near.x;
    p.aux0 = 10; // 과충전 미달
    w.tick = 45;
    onSignatureStep(w, p, emptyInput());
    expect(near.x).toBe(nx);
    p.aux0 = 200;
    w.tick = 46; // 주기 위상 밖
    onSignatureStep(w, p, emptyInput());
    expect(near.x).toBe(nx);
  });

  it('BR8 정지 수복: 과충전 유지 중 주기마다 HP 1 (maxHp 클램프)', () => {
    const w = mk([[BR8, 1]]);
    const p = player(w);
    p.maxHp = 100;
    p.hp = 50;
    p.aux0 = 200;
    w.tick = 100; // 주기 = 20 + floor(1200/15) = 100
    onSignatureStep(w, p, emptyInput());
    expect(p.hp).toBe(51);
    w.tick = 101;
    onSignatureStep(w, p, emptyInput());
    expect(p.hp).toBe(51);
    p.hp = 100;
    w.tick = 200;
    onSignatureStep(w, p, emptyInput());
    expect(p.hp).toBe(100); // 클램프
  });

  it('BR8 은 과충전이 아니면 회복하지 않는다', () => {
    const w = mk([[BR8, 1]]);
    const p = player(w);
    p.maxHp = 100;
    p.hp = 50;
    p.aux0 = 10;
    w.tick = 100;
    onSignatureStep(w, p, emptyInput());
    expect(p.hp).toBe(50);
  });

  it('BR9 척력 외피: 무적 중에만 주변 적탄이 소거된다', () => {
    const w = mk([[BR9, 1]]);
    const p = player(w);
    const near = blankEntity('enemyBullet');
    near.x = p.x + 20;
    near.y = p.y;
    const far = blankEntity('enemyBullet');
    far.x = p.x + 300;
    far.y = p.y;
    w.entities.push(near, far);
    p.iframes = 0;
    onSignatureStep(w, p, emptyInput());
    expect(near.dead).toBe(false);
    p.iframes = 5;
    onSignatureStep(w, p, emptyInput());
    expect(near.dead).toBe(true);
    expect(far.dead).toBe(false);
  });

  it('BR6 내부 쿨다운은 앵커 ⑨ 에서 줄어든다', () => {
    const w = mk([[BR6, 1]]);
    const p = player(w);
    p.maxHp = 100;
    p.hp = 20;
    p.aux0 = 600;
    onPlayerDamaged(w, p, 50, false);
    const cd0 = readSlot(w.skillCarry, 0);
    onSignatureStep(w, p, emptyInput());
    expect(readSlot(w.skillCarry, 0)).toBe(cd0 - 1);
  });
});

// ---------------------------------------------------------------------------
// ⑩ 앵커 ⑩ 적 피격 — CH6 과잉 전하 이월
// ---------------------------------------------------------------------------

describe('앵커 ⑩ — CH6 과잉 전하 이월', () => {
  function shot(lvl: number, leftoverHp: number, kind: Entity['kind'] = 'enemy') {
    const w = mk([[CH6, lvl]]);
    const target = blankEntity(kind);
    target.id = 90001;
    target.hp = leftoverHp;
    const bullet = blankEntity('bullet');
    bullet.id = 90002;
    bullet.damage = 100;
    w.entities.push(target, bullet);
    onEnemyDamaged(w, target, 130, bullet);
    return bullet.damage;
  }

  it('처치 후 초과 피해가 탄에 되실린다', () => {
    // 초과 30 × (4000 + 300)/10000 = 12.9 → 13
    expect(shot(1, -30)).toBe(113);
  });

  it('Lv20 이면 이월이 100% 다', () => {
    expect(shot(20, -30)).toBe(130);
  });

  it('살아남은 표적(hp > 0)에는 이월이 없다', () => {
    expect(shot(1, 40)).toBe(100);
  });

  it('구조물·보스(kind 밖)는 이월 대상이 아니다', () => {
    expect(shot(1, -30, 'boss')).toBe(100);
  });

  it('미투자면 이월이 없다', () => {
    expect(shot(0, -30)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// ⑯ 앵커 ⑯ 볼리 파라미터 — CH1·CH8 표식 · BA7 소비 · BA10 교환
// ---------------------------------------------------------------------------

/** 앵커 ⑯ 이 받는 레코드 한 벌. 초기값은 "아무 스킬도 안 걸린 볼리". */
function volley(over: Partial<VolleyParams> = {}): VolleyParams {
  return {
    damage: 100,
    pierce: 1,
    count: 4,
    speed: 900,
    radius: 6,
    life: 60,
    spread: 0.5,
    cooldownQ: 256,
    countUsed: true,
    mark: 0,
    ...over,
  };
}

describe('앵커 ⑯ — 발사부 4종', () => {
  it('CH1: 과충전 중 발사한 볼리에만 표식이 선다', () => {
    const w = mk([[CH1, 1]]);
    const p = player(w);
    p.aux0 = 200; // 과충전 중(≥90)
    const on = volley();
    onVolleyParams(w, p, on);
    expect(on.mark).toBe(2);

    p.aux0 = 10; // 정지 중이지만 과충전은 아니다
    const off = volley();
    onVolleyParams(w, p, off);
    expect(off.mark).toBe(0);
  });

  it('CH8 단독 투자도 같은 표식을 세운다 (한 칸을 둘이 나눠 쓴다)', () => {
    const w = mk([[CH8, 1]]);
    const p = player(w);
    p.aux0 = 200;
    const v = volley();
    onVolleyParams(w, p, v);
    expect(v.mark).toBe(2);
  });

  it('CH1·CH8 미투자면 과충전이어도 표식이 없다', () => {
    const w = mk([[BA7, 1]]);
    const p = player(w);
    p.aux0 = 600;
    const v = volley();
    onVolleyParams(w, p, v);
    expect(v.mark).toBe(0);
  });

  it('BA10: 탄수 ×2 · 간격 배율(Lv1 ≈ ×1.9455) — 순이득이 아닌 교환이다', () => {
    const w = mk([[BA10, 1]]);
    const p = player(w);
    const v = volley();
    onVolleyParams(w, p, v);
    expect(v.count).toBe(8);
    // 20000 − round(6000×1/11) = 19455 → round(256 × 19455 / 10000) = 498
    expect(v.cooldownQ).toBe(498);
    expect(v.cooldownQ).toBeGreaterThan(256); // 간격은 **늘어나기만** 한다
  });

  it('BA10 Lv20 은 간격 배율이 ×1.6 이다 (몰빵할수록 페널티가 준다)', () => {
    const w = mk([[BA10, 20]]);
    const p = player(w);
    const v = volley();
    onVolleyParams(w, p, v);
    expect(v.cooldownQ).toBe(Math.round((256 * 16000) / 10000));
  });

  it('⚠️ `countUsed` 가 거짓이면(레일건·빔) BA10 은 간격도 안 건드린다', () => {
    const w = mk([[BA10, 20]]);
    const p = player(w);
    const v = volley({ countUsed: false });
    onVolleyParams(w, p, v);
    expect(v.count).toBe(4);
    expect(v.cooldownQ).toBe(256); // 탄수는 안 늘고 간격만 느는 **순손실**이 되면 안 된다
  });

  it('BA7: 처치 6기가 모여야 다음 볼리 한 번에만 탄수가 실린다', () => {
    const w = mk([[BA7, 1]]);
    const p = player(w);
    for (let i = 0; i < 5; i++) onEnemyDeath(w, 0, 0, false);
    const early = volley();
    onVolleyParams(w, p, early);
    expect(early.count).toBe(4); // 5기로는 장전되지 않는다

    onEnemyDeath(w, 0, 0, false); // 6기째
    const loaded = volley();
    onVolleyParams(w, p, loaded);
    expect(loaded.count).toBe(6); // 2 + floor(1/5)

    const next = volley();
    onVolleyParams(w, p, next);
    expect(next.count).toBe(4); // 방전됐다 — 다음 볼리에는 안 실린다
  });

  it('BA7 충전은 6 에서 멈춘다 (초과 처치는 이월하지 않는다)', () => {
    const w = mk([[BA7, 1]]);
    for (let i = 0; i < 20; i++) onEnemyDeath(w, 0, 0, false);
    expect(readSlot(w.skillStage, 2)).toBe(6);
  });

  it('BA7 미투자 런은 처치가 쌓여도 슬롯이 0 이다 (무폴드 계약)', () => {
    const w = mk([[CH1, 1]]);
    for (let i = 0; i < 20; i++) onEnemyDeath(w, 0, 0, false);
    expect(readSlot(w.skillStage, 2)).toBe(0);
  });

  it('투자 0 런은 앵커 ⑯ 을 손으로 때려도 레코드가 그대로다', () => {
    const w = mk();
    const p = player(w);
    p.aux0 = 600;
    const v = volley();
    onVolleyParams(w, p, v);
    expect(v).toEqual(volley());
  });
});

// ---------------------------------------------------------------------------
// ⑯+⑩ 표식의 소비 — CH1 유도 낙뢰 · CH8 접지 관통로
// ---------------------------------------------------------------------------

describe('앵커 ⑩ — CH1 유도 낙뢰 · CH8 접지 관통로', () => {
  /** 표식 유무를 지정한 아군탄이 `target` 에 명중한 상황. */
  function hit(w: WorldState, target: Entity, mark: number, phase = 0): Entity {
    const bullet = blankEntity('bullet');
    bullet.id = 90500;
    bullet.damage = 100;
    bullet.aux0 = mark;
    bullet.phase = phase;
    w.entities.push(bullet);
    onEnemyDamaged(w, target, 100, bullet);
    return bullet;
  }

  it('CH1: 표식 붙은 탄이 명중하면 주변 적에게 연쇄가 터진다', () => {
    const w = mk([[CH1, 1]]);
    const target = enemyNear(w, 0, 0);
    const near = enemyNear(w, 120, 0);
    const far = enemyNear(w, 900, 0);
    hit(w, target, 2);
    // 탄 피해 100 × (2000 + 200)/10000 = 22
    expect(near.hp).toBe(1000 - 22);
    expect(far.hp).toBe(1000);
  });

  it('CH1: 표식 없는 탄(비과충전 발사)은 연쇄를 만들지 않는다', () => {
    const w = mk([[CH1, 1]]);
    const target = enemyNear(w, 0, 0);
    const near = enemyNear(w, 120, 0);
    hit(w, target, 0);
    expect(near.hp).toBe(1000);
  });

  it('CH8: 표식 붙은 탄은 관통할 때마다 피해가 증폭된다', () => {
    const w = mk([[CH8, 1]]);
    const target = enemyNear(w, 0, 0);
    // Lv1 증폭률 = 6% + 0.6%p = 6.6%. 100 → +round(6.6) = 107.
    const b = hit(w, target, 2);
    expect(b.damage).toBe(107);
    onEnemyDamaged(w, target, 107, b); // 두 번째 관통: 107 → +round(7.062) = 114
    expect(b.damage).toBe(114);
  });

  it('CH8: 자이로·프리즘 경로(phase > 0)에서는 중첩 곱이 없다', () => {
    const w = mk([[CH8, 1]]);
    const target = enemyNear(w, 0, 0);
    const b = hit(w, target, 2, 3);
    expect(b.damage).toBe(100);
  });

  it('CH8 미투자 런은 표식이 붙어도 피해가 안 변한다', () => {
    const w = mk([[CH1, 1]]);
    const target = enemyNear(w, 0, 0);
    const b = hit(w, target, 2);
    expect(b.damage).toBe(100);
  });
});
