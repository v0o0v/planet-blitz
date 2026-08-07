/**
 * 스트라이커 30스킬 배선(ADR-0049 배치 1) — **앵커를 통과하는 관측 테스트**.
 *
 * ## 왜 효과 함수를 직접 부르지 않는가
 * `src/sim/skills/striker.ts` 의 함수를 직접 부르면 "효과 산술이 맞다"만 잰다. 이 저장소가
 * 반복해서 밟은 실패는 그쪽이 아니라 **"고쳐 놨는데 아무도 안 부른다"** 였다. 그래서 전부
 * `skillHooks.ts` 의 **공개 앵커**를 통해 자극한다 — `case SIG_STRIKER_MARKSMAN:` 이 빠지면
 * 즉시 빨개진다.
 *
 * ## 뮤테이션으로 계측기를 검사했다
 * `strikerKillsDelta` 의 `player.aux0 += …` 한 줄을 지우고 돌려 §② 가 실패하는 것을 확인했다
 * (2026-08-06). 초록인데 아무것도 안 재는 테스트가 아니다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import type { Entity } from '../src/sim/entities.js';
import { blankEntity, addEntity } from '../src/sim/entities.js';
import { hashWorld } from '../src/sim/replay.js';
import {
  onDashFired,
  onGemCollected,
  onPlayerDamaged,
  onKillsDelta,
  onBulletExpired,
  onDamageChain,
  onSignatureStep,
  onVolleyParams,
  onEnemyDamaged,
  onEnemyDeath,
} from '../src/sim/skillHooks.js';
import type { VolleyParams } from '../src/sim/skillHooks.js';
import { SIG_STRIKER_MARKSMAN, MARKSMAN_TRIGGER_AUX0 } from '../src/sim/shipSignature.js';
import { StrikerCarry, readSlot, SKILL_SLOT_COUNT, DamageSource } from '../src/sim/skillSlots.js';
import { STRIKER_HANDLERS, STRIKER_SUSTAIN } from '../src/sim/activeHandlers/striker.js';
import { COLD_DURATION } from '../src/sim/status.js';
import { ALL_ACTIVES } from '../data/ships/actives/index.js';
import type { ActiveSkillDef } from '../data/ships/actives/types.js';

/** flat 인덱스 — `data/ships/striker.ts` 축 순서(F 0..9 · S 10..19 · M 20..29). */
const F1 = 0;
const F2 = 1;
const F3 = 2;
const F4 = 3;
const F5 = 4;
const F6 = 5;
const F8 = 7;
const F9 = 8;
const S1 = 10;
const S2 = 11;
const S3 = 12;
const S4 = 13;
const S6 = 15;
const S8 = 17;
const S10 = 19;
const M1 = 20;
const M3 = 22;
const M5 = 24;
const M6 = 25;

/** 지정한 flat 인덱스에만 포인트를 넣은 30칸 투자 벡터. */
function invest(points: ReadonlyArray<readonly [number, number]>): number[] {
  const v = new Array<number>(30).fill(0);
  for (const [i, n] of points) v[i] = n;
  return v;
}

function mk(points: ReadonlyArray<readonly [number, number]> = []): WorldState {
  return createWorld(1234, { ...DEFAULT_CONFIG, skillInvest: invest(points) });
}

function player(state: WorldState): Entity {
  const p = state.entities[0];
  if (p === undefined) throw new Error('player missing');
  return p;
}

// ---------------------------------------------------------------------------
// ⓪ 전제 — 이 테스트가 스트라이커를 자극하고 있는가
// ---------------------------------------------------------------------------

describe('⓪ 전제', () => {
  it('DEFAULT_CONFIG 런은 스트라이커 시그니처이고 투자 벡터는 30칸이다', () => {
    const w = mk([[F1, 1]]);
    expect(w.sigBit).toBe(SIG_STRIKER_MARKSMAN);
    expect(w.skillsOn).toBe(true);
    expect(w.config.skillInvest).toHaveLength(30);
  });

  it('투자 0 런은 `skillsOn` 이 거짓이라 앵커가 첫 줄에서 반환한다', () => {
    expect(mk().skillsOn).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ① 불변 계약 — 투자 0 런은 바이트 불변이어야 한다
// ---------------------------------------------------------------------------

describe('① 투자 0 런 해시 불변', () => {
  it('투자 0 런 두 개가 240틱 뒤 같은 해시다 (슬롯도 전부 0)', () => {
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
    // ⚠️ 여기서 `hashWorld` 를 마주 세우면 안 된다 — **배선과 무관하게** 갈린다. `hashWorld`
    // 가 `config.skillInvest` 자체를 접기 때문에 `undefined` 와 `[0×30]` 은 입력이 다른 두
    // 런이다(실측 2026-08-06: 180틱 뒤 1672872801 vs 1812805535). 배선이 재야 하는 것은
    // "스킬 경로가 한 줄도 안 돌았다" 이고, 그것의 관측면은 **엔티티·슬롯 상태**다.
    const none = createWorld(77, { ...DEFAULT_CONFIG });
    const zero = createWorld(77, { ...DEFAULT_CONFIG, skillInvest: invest([]) });
    for (let i = 0; i < 180; i++) {
      stepWorld(none, emptyInput());
      stepWorld(zero, emptyInput());
    }
    expect(none.entities.length).toBe(zero.entities.length);
    expect(player(zero).aux0).toBe(player(none).aux0);
    expect(player(zero).hp).toBe(player(none).hp);
    expect(player(zero).maxHp).toBe(player(none).maxHp);
    expect(player(zero).x).toBe(player(none).x);
    expect(player(zero).y).toBe(player(none).y);
    expect(zero.kills).toBe(none.kills);
    expect(zero.xp).toBe(none.xp);
    for (let s = 0; s < SKILL_SLOT_COUNT; s++) {
      expect(readSlot(zero.skillCarry, s)).toBe(0);
      expect(readSlot(zero.skillStage, s)).toBe(0);
    }
  });

  it('투자 런은 앵커가 실제로 상태를 움직여 해시가 갈린다 (배선의 관측면)', () => {
    // S10 은 매 틱 앵커 ⑨ 에서 돌므로 xp 만 있으면 슬롯이 움직인다.
    const off = mk();
    const on = mk([[S10, 5]]);
    off.xp = 1000;
    on.xp = 1000;
    onSignatureStep(off, player(off), emptyInput());
    onSignatureStep(on, player(on), emptyInput());
    expect(hashWorld(off)).not.toBe(hashWorld(on));
  });
});

// ---------------------------------------------------------------------------
// ② F1 전과 확장 — 앵커 ⑤(처치 증분)
// ---------------------------------------------------------------------------

describe('② F1 전과 확장', () => {
  it('처치 증분마다 사이클 카운터가 `delta × (1 + ceil(Lv/4))` 만큼 충전된다', () => {
    const w = mk([[F1, 4]]); // 충전량 = 1 + ceil(4/4) = 2
    player(w).aux0 = 0;
    onKillsDelta(w, 3);
    expect(player(w).aux0).toBe(6);
  });

  it('미투자 런은 카운터가 한 칸도 안 움직인다', () => {
    const w = mk([[S1, 1]]); // 스킬은 켜져 있으나 F1 은 0
    player(w).aux0 = 0;
    onKillsDelta(w, 3);
    expect(player(w).aux0).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ③ S1 응전 조준 · S2 반사 도금 — 앵커 ④(hp 가 깎인 피격)
// ---------------------------------------------------------------------------

describe('③ S1 · S2', () => {
  it('S1: 피격 틱에 사이클이 만충된다', () => {
    const w = mk([[S1, 1]]);
    player(w).aux0 = 2;
    onPlayerDamaged(w, player(w), 7, false, DamageSource.bullet);
    expect(player(w).aux0).toBe(MARKSMAN_TRIGGER_AUX0);
  });

  it('S1: 이미 임계를 넘긴 카운터를 되돌리지 않는다 (F1 과의 부호 반전 방지)', () => {
    const w = mk([[S1, 1]]);
    player(w).aux0 = MARKSMAN_TRIGGER_AUX0 + 9;
    onPlayerDamaged(w, player(w), 7, false, DamageSource.bullet);
    expect(player(w).aux0).toBe(MARKSMAN_TRIGGER_AUX0 + 9);
  });

  it('S2: 반경(90 + 8×Lv) 안 적탄만 소거된다', () => {
    const w = mk([[S2, 1]]); // 반경 98
    const p = player(w);
    const near = blankEntity('enemyBullet');
    near.x = p.x + 50;
    near.y = p.y;
    const far = blankEntity('enemyBullet');
    far.x = p.x + 400;
    far.y = p.y;
    w.entities.push(near, far);
    onPlayerDamaged(w, p, 7, false, DamageSource.bullet);
    expect(near.dead).toBe(true);
    expect(far.dead).toBe(false);
  });

  it('S2 미투자면 같은 적탄이 살아 있다', () => {
    const w = mk([[S1, 1]]);
    const p = player(w);
    const near = blankEntity('enemyBullet');
    near.x = p.x + 50;
    near.y = p.y;
    w.entities.push(near);
    onPlayerDamaged(w, p, 7, false, DamageSource.bullet);
    expect(near.dead).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ④ F4 파편 격발 — 앵커 ⑥(관통 소진 소멸)
// ---------------------------------------------------------------------------

describe('④ F4 파편 격발', () => {
  function shoot(points: ReadonlyArray<readonly [number, number]>): { hp: number; far: number } {
    const w = mk(points);
    const bullet = blankEntity('bullet');
    bullet.x = 9000;
    bullet.y = 9000;
    bullet.damage = 100;
    const near = blankEntity('enemy');
    near.hp = 500;
    near.x = 9040;
    near.y = 9000;
    const far = blankEntity('enemy');
    far.hp = 500;
    far.x = 9600;
    far.y = 9000;
    w.entities.push(bullet, near, far);
    // 사유 `'pierce'` — F4 는 **관통 예산 소진에서만** 터진다(S3-2 가 앵커에 사유를 넣었고,
    // 수명 만료(`'life'`)에서는 안 터지는 것이 거동 불변의 정의다).
    onBulletExpired(w, bullet, 'pierce');
    return { hp: near.hp, far: far.hp };
  }

  it('탄 피해의 (30% + 2%p/Lv) 가 반경(60 + 6×Lv) 안 적에게 들어간다', () => {
    // Lv5 → 반경 90 · bp 4000 → 100 × 40% = 40
    expect(shoot([[F4, 5]])).toEqual({ hp: 460, far: 500 });
  });

  it('미투자면 소멸 지점에 아무 일도 없다', () => {
    expect(shoot([[S1, 1]])).toEqual({ hp: 500, far: 500 });
  });
});

// ---------------------------------------------------------------------------
// ⑤ S4 엄폐 교리 · S8 콤보 차폐 — 앵커 ⑧(감쇠 사슬, 감소 → 흡수 순서)
// ---------------------------------------------------------------------------

describe('⑤ S4 · S8 (감쇠 사슬)', () => {
  it('S4: 벽 접촉 중이면 (10% + 1%p/Lv) 만큼 깎인다', () => {
    const w = mk([[S4, 10]]); // bp 2000
    w.wallContactTicks = 3;
    expect(onDamageChain(w, player(w), 100)).toBe(80);
  });

  it('S4: 벽에 안 닿아 있으면 무연산이다', () => {
    const w = mk([[S4, 10]]);
    w.wallContactTicks = 0;
    expect(onDamageChain(w, player(w), 100)).toBe(100);
  });

  it('S8: 콤보 스택을 실제로 소모해 흡수한다', () => {
    const w = mk([[S8, 1]]); // 스택당 round(3 + 40/21) = 5
    w.combo = 3;
    expect(onDamageChain(w, player(w), 20)).toBe(5); // 3스택 × 5 = 15 흡수
    expect(w.combo).toBe(0);
  });

  it('S8: 필요한 만큼만 태운다 (남는 스택은 보존)', () => {
    const w = mk([[S8, 1]]);
    w.combo = 9;
    expect(onDamageChain(w, player(w), 8)).toBe(0); // ceil(8/5) = 2 스택
    expect(w.combo).toBe(7);
  });

  it('순서 고정: 감소(S4)가 먼저 깎은 뒤 흡수(S8)가 남은 것만 태운다', () => {
    const w = mk([
      [S4, 10],
      [S8, 1],
    ]);
    w.wallContactTicks = 1;
    w.combo = 9;
    // 100 → S4 로 80 → ceil(80/5)=16 이지만 스택 9 뿐 → 45 흡수 → 35
    expect(onDamageChain(w, player(w), 100)).toBe(35);
    expect(w.combo).toBe(0);
  });

  it('둘 다 미투자면 사슬이 인자를 그대로 돌려준다', () => {
    const w = mk([[F1, 1]]);
    w.wallContactTicks = 5;
    w.combo = 9;
    expect(onDamageChain(w, player(w), 100)).toBe(100);
    expect(w.combo).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// ⑥ M3 수집 항로 · M5 벽차기 — 앵커 ③ · ②
// ---------------------------------------------------------------------------

describe('⑥ M3 · M5', () => {
  it('M3: 젬 수거마다 대시 쿨다운이 (2 + floor(Lv/2)) 줄어든다', () => {
    const w = mk([[M3, 6]]); // 5틱
    player(w).dashCooldown = 20;
    onGemCollected(w, blankEntity('gem'));
    expect(player(w).dashCooldown).toBe(15);
  });

  it('M3: 음수로 내려가지 않는다 (0 클램프 — 대시 게이트가 `=== 0` 동등이다)', () => {
    const w = mk([[M3, 20]]);
    player(w).dashCooldown = 3;
    onGemCollected(w, blankEntity('gem'));
    expect(player(w).dashCooldown).toBe(0);
  });

  it('M5: 직전 틱 벽 접촉이 있으면 대시 무적프레임이 (2 + floor(Lv/4)) 늘어난다', () => {
    const w = mk([[M5, 8]]); // +4
    w.wallContactTicks = 1;
    player(w).iframes = 10;
    onDashFired(w, player(w));
    expect(player(w).iframes).toBe(14);
  });

  it('M5: 벽 접촉이 없으면 무연산이다', () => {
    const w = mk([[M5, 8]]);
    w.wallContactTicks = 0;
    player(w).iframes = 10;
    onDashFired(w, player(w));
    expect(player(w).iframes).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// ⑦ S10 선체 증축 — 앵커 ⑨(매 틱)
// ---------------------------------------------------------------------------

describe('⑦ S10 선체 증축', () => {
  it('누적 획득 XP 400 마다 최대 HP 가 round(2 + 24×Lv/(Lv+28)) 늘어난다', () => {
    const w = mk([[S10, 20]]); // 회당 12
    const p = player(w);
    const base = p.maxHp;
    w.xp = 850;
    onSignatureStep(w, p, emptyInput());
    expect(p.maxHp).toBe(base + 24); // 2회 지급
    expect(readSlot(w.skillCarry, StrikerCarry.hullXpSeen)).toBe(850);
    expect(readSlot(w.skillCarry, StrikerCarry.hullXpPool)).toBe(50);
  });

  it('레벨업으로 xp 가 줄어도 누적이 되감기지 않는다', () => {
    const w = mk([[S10, 20]]);
    const p = player(w);
    const base = p.maxHp;
    w.xp = 300;
    onSignatureStep(w, p, emptyInput());
    w.xp = 20; // 레벨업으로 `-= need`
    onSignatureStep(w, p, emptyInput());
    w.xp = 120; // 다시 획득
    onSignatureStep(w, p, emptyInput());
    // 적립분 = 300 + (120 - 20) = 400 → 정확히 1회 지급
    expect(p.maxHp).toBe(base + 12);
    expect(readSlot(w.skillCarry, StrikerCarry.hullXpPool)).toBe(0);
  });

  it('미투자면 슬롯이 0 인 채다', () => {
    const w = mk([[F1, 1]]);
    w.xp = 5000;
    onSignatureStep(w, player(w), emptyInput());
    expect(readSlot(w.skillCarry, StrikerCarry.hullXpSeen)).toBe(0);
    expect(readSlot(w.skillCarry, StrikerCarry.hullXpPool)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑧ F2 반동 전달 · S8 콤보 창 회복 — 앵커 ⑯(볼리 파라미터 확정 직후)
// ---------------------------------------------------------------------------

/** 앵커 ⑯ 이 넘기는 레코드의 **중립 초기값**. 각 테스트가 필요한 칸만 바꾼다. */
function volley(over: Partial<VolleyParams> = {}): VolleyParams {
  return {
    damage: 100,
    pierce: 1,
    count: 3,
    speed: 100,
    radius: 6,
    life: 60,
    spread: 0.5,
    cooldownQ: 40,
    countUsed: true,
    ballisticsUsed: true,
    targetDist: 300,
    // 발사 방위(rad). **F5(조준선 관통)가 이 값을 술어로 읽는다** — 기본 0(순수 +x)이라
    // `player.angle` 기본값 0 과 짝이 맞으면 콘 안이다. F2·S8 절은 F5 미투자 런이라 무영향.
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

describe('⑧ F2 반동 전달 (앵커 ⑯)', () => {
  it('대시 직후 창 안이면 확산이 0 으로 집속되고 피해·탄속이 같은 bp 로 오른다', () => {
    const w = mk([[F2, 10]]);
    const p = player(w);
    p.dashCooldown = w.config.dashCooldownTicks; // 발동 직후 = 만충
    const v = volley();
    onVolleyParams(w, p, v);
    expect(v.spread).toBe(0);
    // bp 2000 → 100 + round(100 × 2000/10000) = 120
    expect(v.damage).toBe(120);
    // 탄속 100 × (11000 + 1000)/10000 = 120
    expect(v.speed).toBeCloseTo(120, 10);
  });

  it('창을 벗어난 뒤(쿨다운 잔여 1틱)에는 한 칸도 안 바뀐다', () => {
    const w = mk([[F2, 10]]);
    const p = player(w);
    p.dashCooldown = 1;
    const v = volley();
    onVolleyParams(w, p, v);
    expect(v).toEqual(volley());
  });

  it('대시를 안 쓴 런(쿨다운 0)에는 발동하지 않는다', () => {
    const w = mk([[F2, 20]]);
    const p = player(w);
    p.dashCooldown = 0;
    const v = volley();
    onVolleyParams(w, p, v);
    expect(v).toEqual(volley());
  });

  it('미투자면 만충이어도 무연산이다', () => {
    const w = mk([[F1, 1]]);
    const p = player(w);
    p.dashCooldown = w.config.dashCooldownTicks;
    const v = volley();
    onVolleyParams(w, p, v);
    expect(v).toEqual(volley());
  });
});

describe('⑧ S8 콤보 유지 창 회복 (앵커 ⑯)', () => {
  it('정조준 볼리(mark=1)에만 창이 절반 회복된다', () => {
    const w = mk([[S8, 3]]);
    w.combo = 4;
    w.comboTimer = 10;
    onVolleyParams(w, player(w), volley({ mark: 1 }));
    expect(w.comboTimer).toBe(70); // 10 + 120/2
  });

  it('평상시 볼리(mark=0)는 창을 건드리지 않는다', () => {
    const w = mk([[S8, 3]]);
    w.combo = 4;
    w.comboTimer = 10;
    onVolleyParams(w, player(w), volley({ mark: 0 }));
    expect(w.comboTimer).toBe(10);
  });

  it('전액 리셋이 아니라 창 상한에서 멈춘다 — XP 축 트레이드가 이 형태에 달려 있다', () => {
    const w = mk([[S8, 3]]);
    w.combo = 4;
    w.comboTimer = 100;
    onVolleyParams(w, player(w), volley({ mark: 1 }));
    expect(w.comboTimer).toBe(120);
  });

  it('콤보 스택이 0 이면 유지할 창이 없어 회복하지 않는다', () => {
    const w = mk([[S8, 3]]);
    w.combo = 0;
    w.comboTimer = 10;
    onVolleyParams(w, player(w), volley({ mark: 1 }));
    expect(w.comboTimer).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// ⑧-b F5 조준선 관통 — 앵커 ⑯ (S3-1 이 실은 `aimAngle` 을 술어로 읽는다)
// ---------------------------------------------------------------------------
//
// ⚠️ 이 절이 잡으려는 실패는 셋이다:
//  ① 콘 판정이 아예 안 걸린다(무배선) — 양성이 잡는다.
//  ② 콘이 무한대다(어떤 방위든 발동) — 음성 짝이 잡는다. **부정 단언은 뮤테이션에 원리적으로
//     안 걸리므로** 반드시 양성과 같은 세팅에서 방위만 바꿔 짝지어 둔다.
//  ③ 각도 차를 래핑 없이 뺀다 — `±π` 경계 짝이 잡는다. 단순 뺄셈이면 두 단언의 결과가 정확히
//     서로 뒤집힌다.

/** F5 콘 반각(rad). 설계서 고정 20°. */
const F5_CONE_HALF = Math.PI / 9;

describe('⑧-b F5 조준선 관통 (앵커 ⑯)', () => {
  it('양성: 표적 방위가 조준각과 같으면 관통 +1 · 피해가 오른다', () => {
    const w = mk([[F5, 10]]);
    const p = player(w);
    p.angle = 0;
    const base = volley();
    const v = volley({ aimAngle: 0 });
    onVolleyParams(w, p, v);
    // 하한 먼저 — 두 값이 **실제로 늘었다**. 배선이 끊겨 양변이 0 이 되는 항진을 막는다.
    expect(v.pierce).toBeGreaterThan(base.pierce);
    expect(v.damage).toBeGreaterThan(base.damage);
    // 정확값: 관통 1→2 · bp 600 + 150×10 = 2100 → 100 + round(100×2100/10000) = 121.
    expect(v.pierce).toBe(2);
    expect(v.damage).toBe(121);
    // 안 건드리는 축은 그대로다(F5 는 페널티가 한 칸도 없다).
    expect(v.speed).toBe(base.speed);
    expect(v.spread).toBe(base.spread);
    expect(v.count).toBe(base.count);
    // 읽기 전용 필드를 쓰지 않았다.
    expect(v.aimAngle).toBe(0);
    expect(v.targetDist).toBe(base.targetDist);
  });

  it('음성 짝: 같은 세팅에서 방위만 90° 틀면 한 칸도 안 바뀐다', () => {
    const w = mk([[F5, 10]]);
    const p = player(w);
    p.angle = 0;
    const v = volley({ aimAngle: Math.PI / 2 });
    onVolleyParams(w, p, v);
    expect(v).toEqual(volley({ aimAngle: Math.PI / 2 }));
  });

  it('레벨이 오르면 피해 증폭도 오른다 (bp 600 + 150×Lv)', () => {
    const dmg = (n: number): number => {
      const w = mk([[F5, n]]);
      const p = player(w);
      p.angle = 0;
      const v = volley({ aimAngle: 0 });
      onVolleyParams(w, p, v);
      return v.damage;
    };
    // Lv1 = 100 + round(100×750/10000) = 108 · Lv20 = 100 + round(100×3600/10000) = 136.
    expect(dmg(1)).toBe(108);
    expect(dmg(20)).toBe(136);
    expect(dmg(20)).toBeGreaterThan(dmg(1));
  });

  it('경계: 반각 20° 는 안(포함), 그 바깥은 밖이다', () => {
    const at = (aim: number): VolleyParams => {
      const w = mk([[F5, 10]]);
      const p = player(w);
      p.angle = 0;
      const v = volley({ aimAngle: aim });
      onVolleyParams(w, p, v);
      return v;
    };
    expect(at(F5_CONE_HALF - 1e-9).pierce).toBe(2);
    expect(at(-(F5_CONE_HALF - 1e-9)).pierce).toBe(2);
    expect(at(F5_CONE_HALF + 1e-6).pierce).toBe(1);
    expect(at(-(F5_CONE_HALF + 1e-6)).pierce).toBe(1);
  });

  it('경계: ±π 를 가로지르는 짝에서 판정이 뒤집히지 않는다 (래핑)', () => {
    // 조준각 +179.4° · 발사 방위 −179.4°. **단순 뺄셈이면 −358.7°** 라 콘 밖으로 잘못 보이지만
    // 실제 사잇각은 1.3° 라 콘 **안**이다.
    const w1 = mk([[F5, 10]]);
    const p1 = player(w1);
    p1.angle = 3.13;
    const v1 = volley({ aimAngle: -3.13 });
    onVolleyParams(w1, p1, v1);
    expect(v1.pierce).toBe(2);

    // 짝: 같은 경계를 가로지르지만 실제 사잇각이 25.9° 라 콘 **밖**이다. 앞 단언만 있으면
    // "래핑 뒤 항상 참" 인 구현도 통과하므로 이 음성이 반드시 옆에 있어야 한다.
    const w2 = mk([[F5, 10]]);
    const p2 = player(w2);
    p2.angle = 3.13;
    const v2 = volley({ aimAngle: -2.7 });
    onVolleyParams(w2, p2, v2);
    expect(v2).toEqual(volley({ aimAngle: -2.7 }));
  });

  it('음성 대조: 미투자 런은 콘 정중앙이어도 종전 거동이다', () => {
    const w = mk([[F1, 20]]);
    const p = player(w);
    p.angle = 0;
    const v = volley({ aimAngle: 0 });
    onVolleyParams(w, p, v);
    expect(v).toEqual(volley({ aimAngle: 0 }));
  });

  it('짝 증명: 그 탄이 실제 `stepWorld` 에서 **한 번 더 뚫는다**', () => {
    // ⚠️ `params.pierce` 를 고쳐도 아키타입 분기가 그 값을 안 읽으면 조용한 무연산이다. 단위
    // 단언만으로는 그것을 못 가르므로 진짜 런에서 관통 예산이 **소비되는지** 를 잰다.
    //
    // ⚠️ 「적을 하나 더」가 아니라 「명중이 한 번 더」로 재는 것은 관측한 엔진 사실 때문이다:
    // 아군탄은 매 틱 선분 판정을 하고 **같은 적을 연속 틱에 다시 때린다**(반경 32 적을 틱당
    // 30 유닛 전진하는 탄이 두 틱에 걸쳐 지난다). 그래서 관통 +1 은 실제로 「적 한 마리 더」가
    // 아니라 「명중 1회 더」로 나타난다 — 이것은 F5 가 만든 성질이 아니라 모든 관통 소스가
    // 공유하는 기존 거동이고, 여기서 잴 것은 **예산이 실제로 소비되는가** 다.
    const dealt = (points: ReadonlyArray<readonly [number, number]>): number => {
      const w = createWorld(0xf500, { ...DEFAULT_CONFIG, skillInvest: invest(points) });
      const p = player(w);
      // +x 축 정면. 조준각(`input.aim`)도 0 이라 콘 정중앙이다. hp 를 크게 둬 죽지 않게 한다.
      const e = blankEntity('enemy');
      e.x = p.x + 150;
      e.y = p.y;
      e.radius = 32;
      e.hp = 1_000_000;
      e.maxHp = 1_000_000;
      e.damage = 0;
      const target = addEntity(w, e);
      const input = { ...emptyInput(), aim: 0 };
      // 6틱 = **첫 볼리 한 벌만**. 다음 볼리는 7틱째에 난다(실측).
      for (let t = 0; t < 6; t++) stepWorld(w, input);
      return target.maxHp - target.hp;
    };
    const baseline = dealt([[F1, 1]]);
    const withF5 = dealt([[F1, 1], [F5, 20]]);
    // 하한 먼저 — **볼리가 실제로 나갔고 적이 실제로 맞았다.** 없으면 아래 부등식이 0 ≥ 0 항진.
    expect(baseline).toBeGreaterThan(0);
    // 발당 피해 증폭은 Lv20 에 +36% 뿐이다. 총 피해가 **2배 이상**이면 명중이 1회가 아니라
    // 2회였다는 뜻 — 관통 예산 +1 이 실제로 소비된 물증이다(증폭만이면 1.36배에 그친다).
    expect(withF5).toBeGreaterThanOrEqual(2 * baseline);
  });
});

// ---------------------------------------------------------------------------
// ⑨ F6 소이 정조준 · F9 제압 사격 — 앵커 ⑩(아군탄 명중, 피해 확정 직후)
// ---------------------------------------------------------------------------

/** 정조준 표식(aux0=1)이 찍힌 아군탄. 각도 0 = +X 방향. */
function marksmanBullet(): Entity {
  const b = blankEntity('bullet');
  b.aux0 = 1;
  b.angle = 0;
  b.damage = 100;
  return b;
}

describe('⑨ F6 소이 정조준 (앵커 ⑩)', () => {
  it('화상이 없던 적에게는 화상을 부여한다(틱당 1 + floor(Lv/4) · FIRE_DURATION)', () => {
    const w = mk([[F6, 8]]);
    const t = blankEntity('enemy');
    t.hp = 500;
    onEnemyDamaged(w, t, 10, marksmanBullet());
    expect(t.iframes).toBe(120);
    expect(t.dashCooldown).toBe(3);
    expect(t.hp).toBe(500);
  });

  it('이미 화상 중이면 잔여를 일괄 정산하고 화상을 끝낸다', () => {
    const w = mk([[F6, 8]]);
    const t = blankEntity('enemy');
    t.hp = 500;
    t.iframes = 10; // 남은 틱
    t.dashCooldown = 4; // 틱당 피해
    onEnemyDamaged(w, t, 10, marksmanBullet());
    // 잔여 40 × (100% + 5%p×8) = 56
    expect(t.hp).toBe(444);
    expect(t.iframes).toBe(0);
    expect(t.dashCooldown).toBe(0);
    expect(t.dead).toBe(false);
  });

  it('정산이 치명적이면 hp 와 dead 가 **함께** 움직인다(hp≤0 좀비 금지)', () => {
    const w = mk([[F6, 20]]);
    const t = blankEntity('enemy');
    t.hp = 10;
    t.iframes = 30;
    t.dashCooldown = 4;
    onEnemyDamaged(w, t, 1, marksmanBullet());
    expect(t.hp).toBeLessThanOrEqual(0);
    expect(t.dead).toBe(true);
  });

  it('표식 없는 평상시 탄에는 발동하지 않는다', () => {
    const w = mk([[F6, 8]]);
    const t = blankEntity('enemy');
    t.hp = 500;
    const b = marksmanBullet();
    b.aux0 = 0;
    onEnemyDamaged(w, t, 10, b);
    expect(t.iframes).toBe(0);
    expect(t.dashCooldown).toBe(0);
  });

  it('보스에는 화상을 걸지 않는다 — `iframes` 가 보스에서는 과열 취약 창이다', () => {
    const w = mk([[F6, 8]]);
    const t = blankEntity('boss');
    t.hp = 5000;
    t.iframes = 40; // 과열 창 잔여
    onEnemyDamaged(w, t, 10, marksmanBullet());
    expect(t.iframes).toBe(40);
    expect(t.hp).toBe(5000);
  });
});

describe('⑨ F9 제압 사격 (앵커 ⑩)', () => {
  function push(points: ReadonlyArray<readonly [number, number]>, t: Entity): number {
    const w = mk(points);
    const b = blankEntity('bullet');
    b.aux0 = 1;
    b.angle = 0; // +X
    const x0 = t.x;
    onEnemyDamaged(w, t, 10, b);
    return t.x - x0;
  }

  it('일반 적은 24 + 4×Lv 만큼 탄 진행 방향으로 밀린다', () => {
    const t = blankEntity('enemy');
    t.hp = 100;
    expect(push([[F9, 5]], t)).toBeCloseTo(44, 2);
  });

  it('엘리트(pierce>0)는 반감된다', () => {
    const t = blankEntity('enemy');
    t.hp = 100;
    t.pierce = 1;
    expect(push([[F9, 5]], t)).toBeCloseTo(22, 2);
  });

  it('보스도 반감되어 밀린다', () => {
    const t = blankEntity('boss');
    t.hp = 9000;
    expect(push([[F9, 5]], t)).toBeCloseTo(22, 2);
  });

  it('미투자면 밀리지 않는다', () => {
    const t = blankEntity('enemy');
    t.hp = 100;
    expect(push([[F1, 1]], t)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑩ S3 전리 응급 — 앵커 ⑪(잡몹 격추 사건)
// ---------------------------------------------------------------------------

describe('⑩ S3 전리 응급 (앵커 ⑪)', () => {
  it('엘리트 격파에 4 + 1×Lv 회복한다', () => {
    const w = mk([[S3, 6]]);
    const p = player(w);
    p.hp = p.maxHp - 30;
    onEnemyDeath(w, 100, 100, true);
    expect(p.hp).toBe(p.maxHp - 20);
  });

  it('일반 잡몹 격추로는 회복하지 않는다', () => {
    const w = mk([[S3, 6]]);
    const p = player(w);
    p.hp = p.maxHp - 30;
    onEnemyDeath(w, 100, 100, false);
    expect(p.hp).toBe(p.maxHp - 30);
  });

  it('최대 HP 를 넘지 않는다', () => {
    const w = mk([[S3, 20]]);
    const p = player(w);
    p.hp = p.maxHp - 3;
    onEnemyDeath(w, 100, 100, true);
    expect(p.hp).toBe(p.maxHp);
  });

  it('미투자면 회복이 없다', () => {
    const w = mk([[F1, 1]]);
    const p = player(w);
    p.hp = p.maxHp - 30;
    onEnemyDeath(w, 100, 100, true);
    expect(p.hp).toBe(p.maxHp - 30);
  });
});

// ---------------------------------------------------------------------------
// ⑪ F3 과열 배출 · M1 관성 방출 — 액티브 핸들러(발동 틱)
// ---------------------------------------------------------------------------

function activeDef(id: string): ActiveSkillDef {
  const def = ALL_ACTIVES.find((d) => d.id === id);
  if (def === undefined) throw new Error(`active def missing: ${id}`);
  return def;
}

describe('⑪ F3 과열 배출 (화력 액티브)', () => {
  function fire(points: ReadonlyArray<readonly [number, number]>, cooldown: number) {
    const w = mk(points);
    const p = player(w);
    p.cooldown = cooldown;
    const before = w.entities.length;
    const handler = STRIKER_HANDLERS['as_striker_firepower_lo'];
    if (handler === undefined) throw new Error('handler missing');
    handler(w, p, activeDef('as_striker_firepower_lo'), { x: 1, y: 0 }, 0);
    const shots = w.entities.slice(before).filter((e) => e.kind === 'bullet');
    return { cooldown: p.cooldown, damage: shots[0]?.damage ?? 0, count: shots.length };
  }

  it('주무기 쿨다운 잔여를 환급하고 fanStrike 탄을 (10% + 2%p/Lv) 증폭한다', () => {
    // ⚠️ 대조군은 **같은 축에 같은 점수**여야 한다. 액티브 위력(`powerCentiOf`)이 축 투자
    // 총점에서 나오므로, 화력축 1점 vs 5점을 마주 세우면 F3 이 아니라 축 총점 차이를 잰다
    // (실측: 기준 피해 16 vs 18 로 갈렸다).
    const off = fire([[F1, 5]], 7);
    const on = fire([[F3, 5]], 7);
    expect(off.cooldown).toBe(7);
    expect(on.cooldown).toBe(0);
    expect(on.count).toBe(off.count); // 탄 수는 그대로 — 피해만 오른다
    expect(off.damage).toBeGreaterThan(0);
    // bp 2000 → 기준 피해 + round(기준 × 2000/10000)
    expect(on.damage).toBe(off.damage + Math.round((off.damage * 2000) / 10000));
  });

  it('⚠️ 음수 carry(선지급분)를 버리지 않는다 — `cooldown > 0` 가드', () => {
    expect(fire([[F3, 5]], -3).cooldown).toBe(-3);
  });
});

describe('⑪ M1 관성 방출 (기동 액티브)', () => {
  function blinkOnce(points: ReadonlyArray<readonly [number, number]>) {
    const w = mk(points);
    const p = player(w);
    const near = blankEntity('enemy');
    near.hp = 500;
    near.x = p.x + 100;
    near.y = p.y;
    const far = blankEntity('enemy');
    far.hp = 500;
    far.x = p.x + 900;
    far.y = p.y;
    const shot = blankEntity('enemyBullet');
    shot.x = p.x + 100;
    shot.y = p.y;
    w.entities.push(near, far, shot);
    const handler = STRIKER_HANDLERS['as_striker_mobility_lo'];
    if (handler === undefined) throw new Error('handler missing');
    handler(w, p, activeDef('as_striker_mobility_lo'), { x: 1, y: 0 }, 0);
    return { near: near.hp, far: far.hp, cleared: shot.dead };
  }

  it('출발 지점 반경(120 + 10×Lv) 안에 폭발과 적탄 소거를 남긴다', () => {
    // Lv4 → 반경 160 · 피해 36
    expect(blinkOnce([[M1, 4]])).toEqual({ near: 464, far: 500, cleared: true });
  });

  it('미투자면 도약만 하고 출발 지점에 아무 일도 없다', () => {
    expect(blinkOnce([[F1, 1]])).toEqual({ near: 500, far: 500, cleared: false });
  });
});

// ---------------------------------------------------------------------------
// ⑫ F8 과열 파쇄 — 앵커 ⑩(명중). 보스 `iframes` = 과열 창 잔여 틱
// ---------------------------------------------------------------------------

describe('⑫ F8 과열 파쇄 (앵커 ⑩)', () => {
  /** 표식 **없는** 평상시 탄. F8 은 정조준을 요구하지 않는다(설계서 문면). */
  function plainBullet(): Entity {
    const b = blankEntity('bullet');
    b.aux0 = 0;
    b.angle = 0;
    return b;
  }

  function hitBoss(
    points: ReadonlyArray<readonly [number, number]>,
    kind: 'boss' | 'defenseBoss',
    window: number,
  ): number {
    const w = mk(points);
    const t = blankEntity(kind);
    t.hp = 9000;
    t.iframes = window;
    onEnemyDamaged(w, t, 10, plainBullet());
    return t.iframes - window;
  }

  it('과열 창이 열린 보스를 명중하면 잔여 틱이 1 + floor(Lv/8) 만큼 늘어난다', () => {
    expect(hitBoss([[F8, 8]], 'boss', 40)).toBe(2);
  });

  it('레벨이 오르면 연장 폭이 커진다 — **하한 짝**(끊기면 양변이 0 이 되는 항진 방지)', () => {
    const lo = hitBoss([[F8, 1]], 'boss', 40);
    const hi = hitBoss([[F8, 16]], 'boss', 40);
    expect(lo).toBeGreaterThanOrEqual(1); // 긍정 하한
    expect(hi).toBeGreaterThan(lo); // 단조
  });

  it('침공 코어룸 보스(defenseBoss)도 같은 인코딩이라 함께 연장된다', () => {
    expect(hitBoss([[F8, 8]], 'defenseBoss', 40)).toBe(2);
  });

  it('⚠️ 닫힌 창은 열지 않는다 — 연장이지 개창이 아니다', () => {
    expect(hitBoss([[F8, 8]], 'boss', 0)).toBe(0);
  });

  it('⚠️ 잡몹의 `iframes` 는 화상 잔여라 절대 건드리지 않는다 (F6 과 대칭)', () => {
    const w = mk([[F8, 20]]);
    const t = blankEntity('enemy');
    t.hp = 300;
    t.iframes = 30; // 화상 남은 틱
    t.dashCooldown = 4; // 틱당 화상 피해
    onEnemyDamaged(w, t, 10, plainBullet());
    expect(t.iframes).toBe(30);
    expect(t.dashCooldown).toBe(4);
  });

  it('미투자면 과열 창이 그대로다', () => {
    expect(hitBoss([[F1, 1]], 'boss', 40)).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 상한 — "창이 영영 안 닫힌다" 를 막는 축. 위 6건이 **긍정 짝**이다
  // (연장이 0 이 되면 저기가 먼저 빨개지므로 아래 단언이 항진이 아니다).
  // -------------------------------------------------------------------------

  /** 효과 함수와 **독립**으로 적은 천장. 코드에서 import 하면 상한 단언이 항진이 된다. */
  const CAP = 300;

  it('천장(300)을 넘겨 늘리지 않는다 — 한 발로도 경계에서 멈춘다', () => {
    const w = mk([[F8, 20]]); // 연장 폭 3
    const t = blankEntity('boss');
    t.hp = 9000;
    t.iframes = CAP - 1;
    onEnemyDamaged(w, t, 10, plainBullet());
    expect(t.iframes).toBe(CAP);
  });

  it('⚠️ 이미 천장 위인 창을 **깎지 않는다** (강화가 약화로 뒤집히는 부호 반전 방지)', () => {
    const w = mk([[F8, 20]]);
    const t = blankEntity('boss');
    t.hp = 9000;
    t.iframes = CAP + 60; // 미래 콘텐츠·어픽스가 더 길게 연 창
    onEnemyDamaged(w, t, 10, plainBullet());
    expect(t.iframes).toBe(CAP + 60);
  });

  it('다탄 볼리를 연속 틱 먹여도 창이 천장을 안 넘고, 사격을 멈추면 **실제로 닫힌다**', () => {
    const w = mk([[F8, 20]]); // 명중당 3틱 — 감소(틱당 1)를 크게 웃돈다
    const t = blankEntity('boss');
    t.hp = 900000;
    t.iframes = 300; // 방금 열린 창
    // ① 240틱 × 명중 4발/틱 — 보스 스텝의 감소(틱당 1)를 손으로 재현한다.
    //    (`stepBoss` 를 부르지 않는 것은 이 테스트가 재려는 것이 F8 의 상한 산술이라서다.)
    let peak = 0;
    for (let tick = 0; tick < 240; tick++) {
      for (let shot = 0; shot < 4; shot++) onEnemyDamaged(w, t, 10, plainBullet());
      if (t.iframes > 0) t.iframes--; // 보스 스텝의 과열 감쇠
      if (t.iframes > peak) peak = t.iframes;
    }
    expect(peak).toBeLessThanOrEqual(CAP);
    // ② 사격을 멈추면 창은 천장 길이 안에 반드시 닫힌다 — "영구 유지 안 됨" 의 직접 증거.
    for (let tick = 0; tick < CAP && t.iframes > 0; tick++) t.iframes--;
    expect(t.iframes).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑬ M6 활공 정화 — 앵커 ②(대시 발동)
// ---------------------------------------------------------------------------

describe('⑬ M6 활공 정화 (앵커 ②)', () => {
  /**
   * ⚠️ 적은 반경 **바깥 끝 근처**에 둔다. 플레이어 코앞에 두면 이 훅이 아니라 자동사격이
   * 결과를 만들 수 있다(레인 규약 4). 여기서는 `stepWorld` 를 돌리지 않아 자동사격이 아예
   * 없지만, 반경 경계를 재는 것이 이 테스트의 목적이라 안팎 한 쌍으로 둔다.
   */
  function dash(points: ReadonlyArray<readonly [number, number]>) {
    const w = mk(points);
    const p = player(w);
    const inner = blankEntity('enemy'); // Lv5 반경 200 안쪽
    inner.hp = 500;
    inner.x = p.x + 190;
    inner.y = p.y;
    const outer = blankEntity('enemy'); // 바깥
    outer.hp = 500;
    outer.x = p.x + 260;
    outer.y = p.y;
    const bossIn = blankEntity('boss'); // 반경 안이지만 냉기 대상 아님
    bossIn.hp = 9000;
    bossIn.x = p.x + 100;
    bossIn.y = p.y;
    const shotIn = blankEntity('enemyBullet');
    shotIn.x = p.x + 190;
    shotIn.y = p.y;
    const shotOut = blankEntity('enemyBullet');
    shotOut.x = p.x + 260;
    shotOut.y = p.y;
    w.entities.push(inner, outer, bossIn, shotIn, shotOut);
    onDashFired(w, p);
    return {
      innerChill: inner.ownerId,
      outerChill: outer.ownerId,
      bossChill: bossIn.ownerId,
      innerCleared: shotIn.dead,
      outerCleared: shotOut.dead,
    };
  }

  it('반경(150 + 10×Lv) 안 잡몹에 냉기를 걸고 안쪽 적탄만 소거한다', () => {
    expect(dash([[M6, 5]])).toEqual({
      innerChill: COLD_DURATION,
      outerChill: 0,
      bossChill: 0, // 보스는 `ownerId` 를 다른 뜻으로 쓴다 — 덮으면 안 된다
      innerCleared: true,
      outerCleared: false,
    });
  });

  it('반경이 레벨로 넓어진다 — 하한 짝(저레벨은 못 닿고 고레벨은 닿는다)', () => {
    // Lv1 반경 160 < 190 ≤ Lv5 반경 200.
    expect(dash([[M6, 1]]).innerChill).toBe(0);
    expect(dash([[M6, 5]]).innerChill).toBe(COLD_DURATION);
  });

  it('미투자면 냉기도 소거도 없다', () => {
    expect(dash([[M5, 1]])).toEqual({
      innerChill: 0,
      outerChill: 0,
      bossChill: 0,
      innerCleared: false,
      outerCleared: false,
    });
  });
});

// ---------------------------------------------------------------------------
// ⑭ S6 유지 보강 — 생존 액티브 **지속 틱**(sustain 표)
// ---------------------------------------------------------------------------

describe('⑭ S6 유지 보강 (생존 액티브 sustain)', () => {
  function sustain(
    points: ReadonlyArray<readonly [number, number]>,
    id: 'as_striker_survival_lo' | 'as_striker_survival_hi',
    seed: { slow: number; magnet: number },
  ) {
    const w = mk(points);
    const p = player(w);
    w.playerSlowTicks = seed.slow;
    w.magnetBuffTicks = seed.magnet;
    const hook = STRIKER_SUSTAIN[id];
    if (hook === undefined) throw new Error(`sustain missing: ${id}`);
    hook(w, p, activeDef(id));
    return { slow: w.playerSlowTicks, magnet: w.magnetBuffTicks, iframes: p.iframes };
  }

  it('지속 틱마다 감속 잔여를 지우고 자석 배율 게이트를 세운다', () => {
    // ⚠️ 2 인 것이 계약이다 — 감소(world.ts:3895)가 이 훅보다 뒤라 1 이면 같은 틱에 꺼진다.
    expect(sustain([[S6, 3]], 'as_striker_survival_lo', { slow: 90, magnet: 0 })).toMatchObject({
      slow: 0,
      magnet: 2,
    });
  });

  it('상위 등급 액티브에도 걸려 있다', () => {
    expect(sustain([[S6, 3]], 'as_striker_survival_hi', { slow: 90, magnet: 0 })).toMatchObject({
      slow: 0,
      magnet: 2,
    });
  });

  it('자석 방사기 버프(600틱)를 **줄이지 않는다**', () => {
    expect(sustain([[S6, 3]], 'as_striker_survival_lo', { slow: 0, magnet: 600 }).magnet).toBe(600);
  });

  it('미투자면 감속도 자석도 그대로다 — 무적 유지(기존 sustain)는 그대로 돈다', () => {
    const off = sustain([[S4, 3]], 'as_striker_survival_lo', { slow: 90, magnet: 0 });
    expect(off.slow).toBe(90);
    expect(off.magnet).toBe(0);
    // 긍정 짝: 같은 호출이 기존 효과(무적 프레임 재설정)는 여전히 만든다 — 훅 자체가
    // 안 불린 것을 "S6 미발동" 으로 착각하지 않기 위한 대조다.
    expect(off.iframes).toBeGreaterThan(0);
  });
});
