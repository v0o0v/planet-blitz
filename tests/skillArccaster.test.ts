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
import { blankEntity, spawnBullet } from '../src/sim/entities.js';
import { hashWorld } from '../src/sim/replay.js';
import {
  onGemCollected,
  onPlayerDamaged,
  onDamageChain,
  onSignatureStep,
  onEnemyDamaged,
  onEnemyDeath,
  onVolleyParams,
  onBulletExpired,
  onBulletHitParams,
  onEliteLootRarity,
  onOverchargeAccrual,
  onComboDecay,
} from '../src/sim/skillHooks.js';
import type { VolleyParams, BulletHitParams } from '../src/sim/skillHooks.js';
import { onChainParams } from '../src/sim/chainHooks.js';
import { applyChain, CHAIN_RADIUS, CHAIN_MAX_TARGETS } from '../src/sim/status.js';
import { DamageSource } from '../src/sim/skillSlots.js';
import { SIG_ARC_OVERCHARGE } from '../src/sim/shipSignature.js';
import { readSlot, SKILL_SLOT_COUNT } from '../src/sim/skillSlots.js';
import { FIRE_CD_Q } from '../src/sim/constants.js';

/** flat 인덱스 — `data/ships/arccaster.ts` 축 순서(CH 0..9 · BA 10..19 · BR 20..29). */
const CH1 = 0;
const CH2 = 1;
const CH3 = 2;
const CH4 = 3;
const CH5 = 4;
const CH6 = 5;
const CH8 = 7;
const CH9 = 8;
const BA3 = 12;
const BA5 = 14;
const BA7 = 16;
const BA8 = 17;
const BA9 = 18;
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
    onPlayerDamaged(w, p, 40, true, DamageSource.bullet);
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
    onPlayerDamaged(w, p, 7, false, DamageSource.bullet);
    expect(near.hp).toBe(1000 - (15 + 4));
    expect(far.hp).toBe(1000);
  });

  it('BR2 미투자면 같은 적이 멀쩡하다', () => {
    const w = mk([[BR7, 1]]);
    const p = player(w);
    const near = enemyNear(w, 100, 0);
    onPlayerDamaged(w, p, 7, false, DamageSource.bullet);
    expect(near.hp).toBe(1000);
  });

  it('BR7 완충 콘덴서: 깎인 피해가 aux0 으로 전환된다 (600 클램프)', () => {
    const w = mk([[BR7, 1]]);
    const p = player(w);
    p.aux0 = 0;
    onPlayerDamaged(w, p, 10, false, DamageSource.bullet);
    // round(10 × (5000 + 500)/10000) = round(5.5) = 6
    expect(p.aux0).toBe(6);
    p.aux0 = 599;
    onPlayerDamaged(w, p, 400, false, DamageSource.bullet);
    expect(p.aux0).toBe(600);
  });

  it('BR6 전하 역류: 30% 경계를 **통과**하면 aux0 을 전소하고 회복한다', () => {
    const w = mk([[BR6, 1]]);
    const p = player(w);
    p.maxHp = 100;
    p.hp = 20; // 피격 후 hp. dmg 50 이므로 이전 hp = 70 (> 30) → 통과
    p.aux0 = 600;
    onPlayerDamaged(w, p, 50, false, DamageSource.bullet);
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
    onPlayerDamaged(w, p, 50, false, DamageSource.bullet);
    const cdAfter = readSlot(w.skillCarry, 0); // ArccasterCarry.backflowCooldown
    expect(cdAfter).toBe(1200 + Math.floor(43200 / 12));
    // 두 번째 빈사 진입 — 쿨다운이 남아 있어 무발동
    p.hp = 20;
    p.aux0 = 600;
    onPlayerDamaged(w, p, 50, false, DamageSource.bullet);
    expect(p.aux0).toBe(600);
    expect(p.hp).toBe(20);
  });

  it('BR6 은 이미 30% 밑이던 피격(경계 미통과)에는 발동하지 않는다', () => {
    const w = mk([[BR6, 1]]);
    const p = player(w);
    p.maxHp = 100;
    p.hp = 20;
    p.aux0 = 600;
    onPlayerDamaged(w, p, 5, false, DamageSource.bullet); // 이전 hp = 25 — 이미 30 이하였다
    expect(p.aux0).toBe(600);
    expect(p.hp).toBe(20);
  });

  it('BR10 최후 접지: 치명 생존 틱에 aux0 상한 주입 + 무적 연장, **런당 1회**', () => {
    const w = mk([[BR10, 1]]);
    const p = player(w);
    p.aux0 = 0;
    p.iframes = 0;
    onPlayerDamaged(w, p, 5, true, DamageSource.bullet);
    expect(p.aux0).toBe(600);
    expect(p.iframes).toBe(2);
    expect(p.targetX).toBe(1);
    // 두 번째 치명 생존 — 억제 표식이 이미 서 있어 무발동
    p.aux0 = 0;
    p.iframes = 0;
    onPlayerDamaged(w, p, 5, true, DamageSource.bullet);
    expect(p.aux0).toBe(0);
    expect(p.iframes).toBe(0);
  });

  it('BR10 은 치명 생존이 아닌 평범한 피격에는 발동하지 않는다', () => {
    const w = mk([[BR10, 1]]);
    const p = player(w);
    p.aux0 = 0;
    onPlayerDamaged(w, p, 5, false, DamageSource.bullet);
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
    onPlayerDamaged(w, p, 50, false, DamageSource.bullet);
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
    // S2.1 이 더한 셋. 기본값은 "아무 스킬도 안 걸린 발칸/스프레드 볼리" 를 뜻한다 —
    // `ballisticsUsed: true`(빔이 아니다) · 표적이 중거리 · 은신 해제 첫 타가 아니다.
    ballisticsUsed: true,
    targetDist: 200,
    // 발사 방위(rad). 읽기 전용 사실이라 훅이 고치지 않는다 — 기본 0(순수 +x).
    aimAngle: 0,
    // W2 가 더한 칸 — 그 틱 이동 입력 벡터(읽기 전용). 기본은 무입력(정지).
    inputX: 0,
    inputY: 0,
    cloakBreak: false,
    mark: 0,
    // S3-2 가 더한 칸 — "발사 시점 피해를 탄 `aux1` 에 새겨라"(기본은 안 새긴다).
    leadDamageBonus: 0,
    leadPierceBonus: 0,
    recordSpawnDamage: false,
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

// ---------------------------------------------------------------------------
// ⑥ 앵커 — 탄 소멸(사유 구분) · CH3 종말점 방전
// ---------------------------------------------------------------------------

/**
 * CH3 은 **두 앵커에 걸쳐 있다** — ⑯ 이 발사 시점 피해를 탄 `aux1` 에 새기고, ⑥ 의
 * `reason === 'life'` 경로가 그 값으로 방전을 터뜨린다. 그래서 두 축을 따로 잠근다.
 *
 * ⚠️ 부정 항목("안 터진다")은 뮤테이션에 원리적으로 안 걸리므로 **긍정 짝을 옆에 뒀다** —
 * 같은 무대에서 `'life'` 는 터지고 `'pierce'` 는 안 터진다를 한 번에 잰다.
 */

/** 임의 좌표에 놓인 **소멸 직전의 아군탄**(발사 시점 피해 각인 포함). */
function expiredBullet(state: WorldState, x: number, y: number, spawnDamage: number): Entity {
  const b = blankEntity('bullet');
  b.id = 70000 + state.entities.length;
  b.x = x;
  b.y = y;
  b.damage = spawnDamage;
  b.aux1 = spawnDamage; // 앵커 ⑯ 이 새기는 값과 같은 자리
  return b;
}

describe('⑥ CH3 종말점 방전', () => {
  it('CH3: 수명이 다한 탄의 **마지막 위치**에서 방전이 적을 실제로 때린다', () => {
    const w = mk([[CH3, 1]]);
    // 적은 탄 소멸 지점(+400, 0) 곁에 있고, **플레이어 곁에도 하나** 세운다 — 폭발 중심이
    // 플레이어면(`blastDamage` 를 그대로 쓴 구현) 두 적의 피해가 정확히 뒤바뀐다.
    const near = enemyNear(w, 420, 0);
    const far = enemyNear(w, 0, 0);
    onBulletExpired(w, expiredBullet(w, player(w).x + 400, player(w).y, 200), 'life');

    // 하한 먼저 — 배선이 끊기면 양변이 모두 1000 이라 아래 비교가 항진이 된다.
    expect(near.hp).toBeLessThan(1000);
    // 피해 = round(200 × (2500 + 200×1) / 10000) = 54.
    expect(near.hp).toBe(1000 - 54);
    // 플레이어 곁의 적은 반경(50 + 5×1 = 55) 밖이라 무사하다 = 중심이 탄이라는 물증.
    expect(far.hp).toBe(1000);
  });

  it('CH3: 방전 피해가 투자 레벨에 **단조 증가**한다 (양변 모두 실제로 깎인다)', () => {
    const dealt = (level: number): number => {
      const w = mk([[CH3, level]]);
      const e = enemyNear(w, 400, 0);
      onBulletExpired(w, expiredBullet(w, player(w).x + 400, player(w).y, 200), 'life');
      return 1000 - e.hp;
    };
    const lo = dealt(1);
    const hi = dealt(10);
    expect(lo).toBeGreaterThan(0); // 하한 ①
    expect(hi).toBeGreaterThan(0); // 하한 ②
    expect(hi).toBeGreaterThan(lo);
    expect(lo).toBe(54); // round(200 × 2700/10000)
    expect(hi).toBe(90); // round(200 × 4500/10000)
  });

  it('CH3: 반경도 레벨을 따라 넓어진다 (Lv1 에선 안 닿던 적이 Lv20 에선 맞는다)', () => {
    const hitAt = (level: number): boolean => {
      const w = mk([[CH3, level]]);
      const e = enemyNear(w, 500, 0); // 탄에서 100u
      onBulletExpired(w, expiredBullet(w, player(w).x + 400, player(w).y, 200), 'life');
      return e.hp < 1000;
    };
    expect(hitAt(1)).toBe(false); // 반경 55
    expect(hitAt(20)).toBe(true); // 반경 150
  });

  it('회귀: **관통 소진** 소멸에서는 안 터진다 (같은 무대에서 `life` 는 터진다)', () => {
    const w = mk([[CH3, 5]]);
    const e = enemyNear(w, 400, 0);
    const px = player(w).x;
    const py = player(w).y;

    onBulletExpired(w, expiredBullet(w, px + 400, py, 200), 'pierce');
    expect(e.hp).toBe(1000); // 부정 항목

    // 긍정 짝 — 같은 좌표·같은 각인인데 사유만 `life` 면 터진다. 이게 없으면 위 단언은
    // "CH3 을 통째로 지워도 초록" 인 항진이다.
    onBulletExpired(w, expiredBullet(w, px + 400, py, 200), 'life');
    expect(e.hp).toBe(1000 - 70); // round(200 × 3500/10000)
  });

  it('음성 대조: CH3 미투자 런은 수명 만료에서도 아무 일이 없다', () => {
    const w = mk([[CH1, 5]]);
    const e = enemyNear(w, 400, 0);
    onBulletExpired(w, expiredBullet(w, player(w).x + 400, player(w).y, 200), 'life');
    expect(e.hp).toBe(1000);
  });

  it('음성 대조: 각인이 없는 탄(과충전 밖 발사)은 CH3 투자에도 안 터진다', () => {
    const w = mk([[CH3, 5]]);
    const e = enemyNear(w, 400, 0);
    const b = expiredBullet(w, player(w).x + 400, player(w).y, 200);
    b.aux1 = 0; // 과충전 밖에서 나간 탄
    onBulletExpired(w, b, 'life');
    expect(e.hp).toBe(1000);
  });

  it('CH3: 기준은 `aux1`(발사 시점) 이지 비행 중 갱신된 `damage` 가 아니다', () => {
    const w = mk([[CH3, 5]]);
    const e = enemyNear(w, 400, 0);
    const b = expiredBullet(w, player(w).x + 400, player(w).y, 200);
    b.damage = 900; // CH6 이월·CH8 증폭이 비행 중 부풀린 값
    onBulletExpired(w, b, 'life');
    expect(e.hp).toBe(1000 - 70); // 200 기준 그대로 — 900 이었다면 315 였다
  });

  it('⑯: CH3 투자 + 과충전 볼리에만 각인 지시가 선다', () => {
    const w = mk([[CH3, 1]]);
    const p = player(w);
    p.aux0 = 200; // 과충전 중
    const v = volley();
    onVolleyParams(w, p, v);
    expect(v.recordSpawnDamage).toBe(true);

    // 음성 대조 ① — 과충전 밖.
    const cold = volley();
    p.aux0 = 0;
    onVolleyParams(w, p, cold);
    expect(cold.recordSpawnDamage).toBe(false);

    // 음성 대조 ② — CH3 미투자 런.
    const noSkill = mk([[CH1, 1]]);
    const p2 = player(noSkill);
    p2.aux0 = 200;
    const v2 = volley();
    onVolleyParams(noSkill, p2, v2);
    expect(v2.recordSpawnDamage).toBe(false);
    expect(v2.mark).toBe(2); // 하한: 이 런에서 앵커 자체는 살아 있다
  });

  it('world 배선: 각인 지시가 실제로 태어난 탄의 `aux1` 에 실린다', () => {
    const w = mk([[CH3, 5]]);
    const p = player(w);
    enemyNear(w, 300, 0, 100000); // 사거리 안 — 오토어택이 실제로 발사한다
    p.aux0 = 200; // 과충전 유지(정지 입력이라 계속 오른다)
    for (let i = 0; i < 40; i++) stepWorld(w, emptyInput());

    const bullets = w.entities.filter((e) => e.kind === 'bullet' && !e.dead);
    expect(bullets.length).toBeGreaterThan(0); // 하한: 정말 쐈다
    expect(bullets.every((b) => b.aux1 === Math.round(b.damage))).toBe(true);
    expect(bullets[0]!.aux1).toBeGreaterThan(0);
  });

  it('순회 중 변형 없음: 같은 틱에 여러 탄이 만료돼도 크래시·누락이 없다', () => {
    const w = mk([[CH3, 5]]);
    const p = player(w);
    // 오토어택 사거리(1650) 밖 · 컬링 반경 안 무대 — 플레이어 볼리가 계측을 오염시키지 않는다.
    // 세로로 200u 씩 벌린다 — 폭발 반경(50 + 5×5 = 75)이 서로 겹치지 않아야 "정확히 한 번씩"
    // 맞았음을 잴 수 있다(겹치면 두 번 맞은 것과 한 번 맞은 것이 구분되지 않는다).
    const stage = 1800;
    const marks: Entity[] = [];
    for (let i = 0; i < 4; i++) {
      const dy = i * 200 - 300;
      marks.push(enemyNear(w, stage, dy + 20, 100000));
      const b = spawnBullet(w, p.x + stage, p.y + dy, 0, 0, 200, 0, 5, 1, 0, 0);
      b.aux1 = 200;
    }
    expect(() => stepWorld(w, emptyInput())).not.toThrow();

    // 넷 **전부** 맞았다 = 순회 중 배열이 흔들려 일부가 건너뛰이지 않았다.
    for (const e of marks) expect(e.hp).toBe(100000 - 70);
    // 심은 넷은 하나도 안 남는다(플레이어 자기 볼리는 계측 대상이 아니라 `aux1` 로 가른다).
    expect(w.entities.filter((e) => e.kind === 'bullet' && !e.dead && e.aux1 === 200)).toHaveLength(
      0,
    );
  });
});

// ---------------------------------------------------------------------------
// ⑰ 앵커 ⑰ 연쇄 파라미터 — CH2 연쇄 확장 회로
// ---------------------------------------------------------------------------

/** `applyChain` 의 원점으로 쓸 적. 원점은 자기 자신을 때리지 않는다(`id` 로 거른다). */
function chainOrigin(state: WorldState): Entity {
  return enemyNear(state, 0, 0, 1000);
}

describe('앵커 ⑰ — CH2 연쇄 확장 회로', () => {
  it('미투자 런은 상수 그대로다 (반경·대상 수 불변)', () => {
    const w = mk();
    const seed = { radius: CHAIN_RADIUS, maxTargets: CHAIN_MAX_TARGETS };
    onChainParams(w, seed);
    expect(seed).toEqual({ radius: CHAIN_RADIUS, maxTargets: CHAIN_MAX_TARGETS });
  });

  it('도약 반경이 늘어난다 — 기본 반경 **밖**의 적이 맞는다', () => {
    // ⚠️ 반경 260 **바깥 끝**(270)에 둔다. 안쪽에 두면 CH2 없이도 맞아 수정 전에 통과한다.
    const off = mk([[BR1, 1]]); // CH2 아닌 다른 스킬만 투자한 대조군
    const oOff = chainOrigin(off);
    const tOff = enemyNear(off, 270, 0, 1000);
    applyChain(off, oOff, 10);
    expect(tOff.hp, '기본 반경 밖인데 맞았다 — 거리 설정이 틀렸다').toBe(1000);

    const on = mk([[CH2, 1]]); // 반경 260 + 26 = 286
    const oOn = chainOrigin(on);
    const tOn = enemyNear(on, 270, 0, 1000);
    applyChain(on, oOn, 10);
    expect(tOn.hp).toBe(990);
  });

  it('도약 대상 수가 늘어난다 (3 → 4)', () => {
    const hit = (state: WorldState): number => {
      const o = chainOrigin(state);
      const ts = [50, 60, 70, 80].map((dx) => enemyNear(state, dx, 0, 1000));
      applyChain(state, o, 10);
      return ts.filter((e) => e.hp < 1000).length;
    };
    expect(hit(mk([[BR1, 1]]))).toBe(3);
    expect(hit(mk([[CH2, 1]]))).toBe(4);
  });

  it('CH2 는 **모든 출처**를 덮는다 — BR2 피뢰 접지 경유 연쇄도 넓어진다', () => {
    // 앵커 ④(피격 후속)가 부르는 BR2 연쇄가 같은 `applyChain` 을 지난다.
    const off = mk([[BR2, 1]]);
    const tOff = enemyNear(off, 270, 0, 1000);
    onPlayerDamaged(off, player(off), 10, false, DamageSource.contact);
    expect(tOff.hp).toBe(1000);

    const on = mk([
      [BR2, 1],
      [CH2, 1],
    ]);
    const tOn = enemyNear(on, 270, 0, 1000);
    onPlayerDamaged(on, player(on), 10, false, DamageSource.contact);
    expect(tOn.hp).toBe(1000 - 19); // BR2 = 15 + 4×1
  });

  it('연쇄로 hp 가 0 이하가 된 적은 `dead` 가 선다 (좀비 방지 · 확장 반경에서도)', () => {
    const w = mk([[CH2, 1]]);
    const o = chainOrigin(w);
    const t = enemyNear(w, 270, 0, 5);
    applyChain(w, o, 10);
    expect(t.hp).toBeLessThanOrEqual(0);
    expect(t.dead, 'dead 를 안 세우면 compact 가 처치·젬·전리품을 통째로 버린다').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ⑱ 앵커 ⑱ 명중 파라미터 — CH5 전위차 저격
// ---------------------------------------------------------------------------

/** 앵커 ⑱ 이 받는 레코드 한 벌. */
function hitParams(damage = 100, pierce = 1): BulletHitParams {
  return { damage, pierce };
}

/** 발사 시점 수명 `life0` 을 새긴 아군탄. 현재 잔여 수명은 `life`. */
function flownBullet(life0: number, life: number): Entity {
  const b = blankEntity('bullet');
  b.targetX = life0;
  b.life = life;
  return b;
}

describe('앵커 ⑱ — CH5 전위차 저격', () => {
  it('⑯ 에서 각인 플래그가 선다 (과충전과 무관)', () => {
    const w = mk([[CH5, 1]]);
    const p = player(w);
    p.aux0 = 0; // 과충전이 아니어도 CH5 는 각인한다
    const v = volley();
    onVolleyParams(w, p, v);
    expect(v.recordSpawnOrigin).toBe(true);

    const off = mk([[BR1, 1]]);
    const v2 = volley();
    onVolleyParams(off, player(off), v2);
    expect(v2.recordSpawnOrigin).toBeFalsy();
  });

  it('⭐ **아군탄 게이트** — 적탄은 이 경로에 닿지 않는다 (부정)', () => {
    const w = mk([[CH5, 1]]);
    const target = enemyNear(w, 400, 0, 1000);
    // 적탄의 `targetX` 는 거동 파라미터 A(가속도/선회율)다. 게이트가 없으면 이 값이
    // "발사 시점 수명" 으로 오독돼 적탄 거동이 조용히 갈린다.
    const eb = blankEntity('enemyBullet');
    eb.targetX = 300; // BK_ACCEL 가속도
    eb.targetY = 0.02; // BK_CURVE 각가속도
    eb.life = 10;
    const params = hitParams();
    onBulletHitParams(w, eb, target, params);
    expect(params, '적탄이 CH5 경로를 탔다 — 아군탄 게이트가 없다').toEqual(hitParams());
    expect(eb.targetX, '적탄의 거동 파라미터 A 가 훼손됐다').toBe(300);
    expect(eb.targetY, '적탄의 거동 파라미터 B 가 훼손됐다').toBe(0.02);
  });

  it('⭐ **긍정 짝** — 같은 조건의 아군탄은 증폭된다', () => {
    const w = mk([[CH5, 1]]);
    const target = enemyNear(w, 400, 0, 1000);
    const b = flownBullet(300, 10); // 비행 비율 (300−10)/300 ≈ 97%
    const params = hitParams();
    onBulletHitParams(w, b, target, params);
    expect(params.damage).toBe(100 + 28); // 2500 + 250×1 bp = 27.5% → round = 28
    expect(params.pierce).toBe(1 + 1);
  });

  it('비행 비율 50% 미만이면 무연산이다 (임계 양쪽)', () => {
    const w = mk([[CH5, 1]]);
    const target = enemyNear(w, 400, 0, 1000);
    const near = hitParams();
    onBulletHitParams(w, flownBullet(100, 51), target, near); // 49% — 미달
    expect(near).toEqual(hitParams());
    const far = hitParams();
    onBulletHitParams(w, flownBullet(100, 50), target, far); // 정확히 50% — 성립
    expect(far.damage).toBe(128);
  });

  it('각인되지 않은 탄(`targetX === 0`)은 무연산이다 — 자기 표식 게이트', () => {
    // CH4 부채탄·분열 파편·보조무기·빔 세그먼트가 여기 해당한다.
    const w = mk([[CH5, 1]]);
    const target = enemyNear(w, 400, 0, 1000);
    const b = blankEntity('bullet');
    b.life = 1;
    const params = hitParams();
    onBulletHitParams(w, b, target, params);
    expect(params).toEqual(hitParams());
  });

  it('관통 가산은 **탄당 1회**다 (피해 증폭은 매 명중)', () => {
    const w = mk([[CH5, 1]]);
    const target = enemyNear(w, 400, 0, 1000);
    const b = flownBullet(300, 10);
    const first = hitParams();
    onBulletHitParams(w, b, target, first);
    expect(first.pierce).toBe(2);
    const second = hitParams();
    onBulletHitParams(w, b, target, second);
    expect(second.pierce, '명중마다 관통을 주면 탄이 영영 안 죽는다').toBe(1);
    expect(second.damage, '피해 증폭은 매 명중에 실린다').toBe(128);
  });

  it('미투자 런은 한 칸도 안 바뀐다', () => {
    const w = mk([[BR1, 1]]);
    const target = enemyNear(w, 400, 0, 1000);
    const params = hitParams();
    onBulletHitParams(w, flownBullet(300, 10), target, params);
    expect(params).toEqual(hitParams());
  });

  it('배선 통과 ①: 발사된 탄에 발사 시점 수명이 실제로 새겨진다 (world.ts 각인부)', () => {
    const fired = (points: ReadonlyArray<readonly [number, number]>): Entity[] => {
      const w = mk(points);
      enemyNear(w, 200, 0, 100000); // 자동 조준 표적 — 없으면 발사 자체가 안 난다
      stepWorld(w, emptyInput());
      return w.entities.filter((e) => e.kind === 'bullet');
    };
    const on = fired([[CH5, 1]]);
    expect(on.length, '탄이 한 발도 안 났다 — 아래 단언이 빈 배열 항진이 된다').toBeGreaterThan(0);
    for (const b of on) expect(b.targetX).toBeGreaterThan(0);

    const off = fired([[BR1, 1]]);
    expect(off.length).toBeGreaterThan(0);
    for (const b of off) expect(b.targetX, '미투자 런이 칸을 썼다 — 리플레이 바이트가 갈린다').toBe(0);
  });

  it('배선 통과 ②: 멀리 날아온 탄이 실제로 더 아프다 (world.ts 명중 호출부)', () => {
    const run = (points: ReadonlyArray<readonly [number, number]>): number => {
      const w = mk(points);
      const p = player(w);
      // ⚠️ 플레이어 **코앞이 아니라** 700u 밖에 둔다 — 코앞이면 자동사격 탄이 같은 틱에
      // 마무리해 수정 전에도 통과한다. 이 틱의 자동사격 탄은 30u 밖에 못 가 여기 못 닿는다.
      const e = enemyNear(w, 700, 0, 100000);
      e.radius = 30;
      // 발사 시점 수명 120 · 현재 60 → 이번 틱 적분 후 59 → 비행 61/120 ≈ 51% (임계 통과)
      const b = spawnBullet(w, p.x + 680, p.y, 0, 1800, 200, 0, 5, 60, 1, 0);
      b.targetX = 120;
      stepWorld(w, emptyInput());
      return e.hp;
    };
    const off = run([[BR1, 1]]);
    expect(off, '명중 자체가 없었다 — 아래 비교는 항진이다').toBeLessThan(100000);
    expect(run([[CH5, 1]])).toBeLessThan(off);
  });
});

// ---------------------------------------------------------------------------
// ⑲ 앵커 ⑲ 전리품 등급 — CH9 낙뢰 인양
// ---------------------------------------------------------------------------

describe('앵커 ⑲ — CH9 낙뢰 인양', () => {
  it('과충전 중에만 희귀도 배율이 실린다', () => {
    const w = mk([[CH9, 1]]);
    const p = player(w);
    p.aux0 = 0;
    expect(onEliteLootRarity(w, p, 1)).toBe(1);
    p.aux0 = 200; // 과충전(≥90)
    expect(onEliteLootRarity(w, p, 1)).toBeCloseTo(1.075, 10);
  });

  it('촉매 배율 위에 **곱**으로 얹힌다 (하한 짝 — 미투자는 항등)', () => {
    const on = mk([[CH9, 1]]);
    const pOn = player(on);
    pOn.aux0 = 200;
    expect(onEliteLootRarity(on, pOn, 2)).toBeCloseTo(2.15, 10);

    const off = mk([[BR1, 1]]);
    const pOff = player(off);
    pOff.aux0 = 200;
    expect(onEliteLootRarity(off, pOff, 2)).toBe(2);
  });

  it('레벨이 오르면 배율이 **단조 증가**한다 (하한 짝 포함)', () => {
    const at = (level: number): number => {
      const w = mk([[CH9, level]]);
      const p = player(w);
      p.aux0 = 200;
      return onEliteLootRarity(w, p, 1);
    };
    const lo = at(1);
    const hi = at(20);
    expect(lo, '양변이 1 이면 항진이다 — 하한을 함께 잠근다').toBeGreaterThan(1);
    expect(hi).toBeGreaterThan(lo);
  });
});

// ---------------------------------------------------------------------------
// ⑳ 앵커 ⑳ 과충전 적립 — BA8 앞 절반 · BA9
// ---------------------------------------------------------------------------

describe('앵커 ⑳ — BA8 적립 2배 · BA9 이동 감쇠', () => {
  it('기본값은 종전 거동 그대로다 (정지 +1 · 이동 리셋)', () => {
    const w = mk([[BR1, 1]]);
    const p = player(w);
    expect(onOverchargeAccrual(w, p, true)).toEqual({ still: true, delta: 1 });
    expect(onOverchargeAccrual(w, p, false)).toEqual({ still: false, delta: 0 });
  });

  it('BA8: 감속 장판 근사(`playerSlowTicks > 0`) + 정지에서만 적립이 2배다', () => {
    const w = mk([[BA8, 1]]);
    const p = player(w);
    w.playerSlowTicks = 0;
    expect(onOverchargeAccrual(w, p, true).delta).toBe(1);
    w.playerSlowTicks = 30;
    expect(onOverchargeAccrual(w, p, true).delta).toBe(2);
  });

  it('⚠️ BA8 은 **이동 중에는** 안 실린다 (BA9 가 `still` 을 뒤집어도)', () => {
    // 순서가 뒤바뀌면 "이동하면서 과충전이 쌓인다" 가 되어 시그니처가 통째로 뒤집힌다.
    const w = mk([
      [BA8, 1],
      [BA9, 1],
    ]);
    const p = player(w);
    w.playerSlowTicks = 30;
    const acc = onOverchargeAccrual(w, p, false);
    expect(acc.still).toBe(true); // BA9 가 리셋 분기를 우회시켰다
    expect(acc.delta).toBeLessThanOrEqual(0); // 그래도 적립은 없다
  });

  it('BA9: 이동 틱이 리셋 대신 감쇠가 된다 (Lv1 = 2틱당 −1)', () => {
    const w = mk([[BA9, 1]]);
    const p = player(w);
    let minus = 0;
    for (let t = 0; t < 10; t++) {
      w.tick = t;
      const acc = onOverchargeAccrual(w, p, false);
      expect(acc.still).toBe(true);
      expect(acc.delta).toBeLessThanOrEqual(0);
      if (acc.delta < 0) minus++;
    }
    expect(minus, '10틱에 5번 줄어야 적립 속도의 절반이다').toBe(5);
  });

  it('BA9 배선 통과: 이동해도 `aux0` 이 0 으로 떨어지지 않는다 (스텝 경유)', () => {
    const move = { ...emptyInput(), moveX: 1 };
    const off = mk([[BR1, 1]]);
    const pOff = player(off);
    pOff.aux0 = 100;
    stepWorld(off, move);
    expect(pOff.aux0, '대조군: BA9 없으면 즉시 리셋이다').toBe(0);

    const on = mk([[BA9, 1]]);
    const pOn = player(on);
    pOn.aux0 = 100;
    stepWorld(on, move);
    expect(pOn.aux0).toBeGreaterThanOrEqual(99);
  });
});

// ---------------------------------------------------------------------------
// ㉑ 앵커 ㉑ 콤보 감소 — BA5 정전 콤보 감속
// ---------------------------------------------------------------------------

describe('앵커 ㉑ — BA5 정전 콤보 감속', () => {
  it('과충전 중에만 감소를 건너뛴다', () => {
    const w = mk([[BA5, 1]]);
    const p = player(w);
    w.tick = 1; // 건너뛰는 쪽 틱
    p.aux0 = 0;
    expect(onComboDecay(w, p), '과충전이 아닌데 멈췄다').toBe(false);
    p.aux0 = 200;
    expect(onComboDecay(w, p)).toBe(true);
  });

  it('Lv1 은 정확히 **절반 속도**다 (10틱에 5회만 감소)', () => {
    const w = mk([[BA5, 1]]);
    const p = player(w);
    p.aux0 = 200;
    let decays = 0;
    for (let t = 0; t < 10; t++) {
      w.tick = t;
      if (!onComboDecay(w, p)) decays++;
    }
    expect(decays).toBe(5);
  });

  it('레벨이 오르면 감소 횟수가 **줄어든다** (하한 짝 — 미투자는 전부 감소)', () => {
    const decays = (points: ReadonlyArray<readonly [number, number]>): number => {
      const w = mk(points);
      const p = player(w);
      p.aux0 = 200;
      let n = 0;
      for (let t = 0; t < 28; t++) {
        w.tick = t;
        if (!onComboDecay(w, p)) n++;
      }
      return n;
    };
    expect(decays([[BR1, 1]]), '미투자 런은 28틱 전부 감소해야 한다').toBe(28);
    expect(decays([[BA5, 1]])).toBe(14);
    expect(decays([[BA5, 20]])).toBe(4); // period = 2 + 5 = 7
  });

  it('배선 통과: 콤보 시계가 실제로 천천히 준다 (스텝 경유)', () => {
    const run = (points: ReadonlyArray<readonly [number, number]>): number => {
      const w = mk(points);
      const p = player(w);
      p.aux0 = 300; // 과충전 유지(무입력이라 매 틱 +1)
      w.combo = 5;
      w.comboTimer = 100;
      for (let i = 0; i < 20; i++) stepWorld(w, emptyInput());
      return w.comboTimer;
    };
    const off = run([[BR1, 1]]);
    const on = run([[BA5, 1]]);
    expect(off, '대조군이 20틱 전부 줄지 않았다 — 계측기가 고장났다').toBe(80);
    expect(on).toBe(90);
  });
});

// ---------------------------------------------------------------------------
// ⑧′ 앵커 ⑧ 인자 확장 — BA8 뒤 절반(해저드 출처 경감)
// ---------------------------------------------------------------------------

describe('앵커 ⑧ 확장 — BA8 절연 포좌(해저드 경감)', () => {
  it('해저드 출처일 때만 경감된다', () => {
    const w = mk([[BA8, 1]]);
    const p = player(w);
    expect(onDamageChain(w, p, 100, DamageSource.hazard)).toBe(100 - 17); // 1500 + 150 bp
    expect(onDamageChain(w, p, 100, DamageSource.contact)).toBe(100);
    expect(onDamageChain(w, p, 100, DamageSource.bullet)).toBe(100);
  });

  it('비트합이라 해저드가 **섞여만 있어도** 걸린다', () => {
    const w = mk([[BA8, 1]]);
    const p = player(w);
    expect(onDamageChain(w, p, 100, DamageSource.hazard | DamageSource.bullet)).toBe(83);
  });

  it('인자를 안 넘기면(기본 0) 걸리지 않는다 — 다섯 기체 산술 불변의 근거', () => {
    const w = mk([[BA8, 1]]);
    const p = player(w);
    expect(onDamageChain(w, p, 100)).toBe(100);
  });

  it('미투자 런은 해저드 출처여도 항등이다 (하한 짝)', () => {
    const w = mk([[BR1, 1]]);
    const p = player(w);
    expect(onDamageChain(w, p, 100, DamageSource.hazard)).toBe(100);
  });
});
