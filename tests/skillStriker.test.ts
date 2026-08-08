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
import { createWorld, stepWorld, emptyInput, DEFAULT_CONFIG, DEFAULT_WEAPON } from '../src/sim/world.js';
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
  onPlayerMoveParams,
  onBulletHitParams,
  onGemPull,
  onObjectiveResolved,
  onContactInvuln,
  onActiveExpired,
} from '../src/sim/skillHooks.js';
import type {
  VolleyParams,
  PlayerMoveParams,
  BulletHitParams,
  GemPullParams,
} from '../src/sim/skillHooks.js';
import { SIG_STRIKER_MARKSMAN, MARKSMAN_TRIGGER_AUX0 } from '../src/sim/shipSignature.js';
import {
  StrikerCarry,
  StrikerStage,
  readSlot,
  SKILL_SLOT_COUNT,
  DamageSource,
} from '../src/sim/skillSlots.js';
import { STRIKER_HANDLERS, STRIKER_SUSTAIN } from '../src/sim/activeHandlers/striker.js';
import { COLD_DURATION, enemyStatusStopMult } from '../src/sim/status.js';
import { ALL_ACTIVES } from '../data/ships/actives/index.js';
import type { ActiveSkillDef } from '../data/ships/actives/types.js';

/** flat 인덱스 — `data/ships/striker.ts` 축 순서(F 0..9 · S 10..19 · M 20..29). */
const F1 = 0;
const F2 = 1;
const F3 = 2;
const F4 = 3;
const F5 = 4;
const F6 = 5;
const F7 = 6;
const F8 = 7;
const F9 = 8;
const S1 = 10;
const S2 = 11;
const S3 = 12;
const S4 = 13;
const S5 = 14;
const S6 = 15;
const S7 = 16;
const S8 = 17;
const S9 = 18;
const S10 = 19;
const M1 = 20;
const M2 = 21;
const M3 = 22;
const M4 = 23;
const M5 = 24;
const M6 = 25;
const M7 = 26;
const M8 = 27;
const M9 = 28;
const M10 = 29;
// F10 은 F 대역(0..9)의 마지막 칸이라 F9 바로 뒤에 둔다.
const F10 = 9;

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
    onEnemyDeath(w, 100, 100, true, false);
    expect(p.hp).toBe(p.maxHp - 20);
  });

  it('일반 잡몹 격추로는 회복하지 않는다', () => {
    const w = mk([[S3, 6]]);
    const p = player(w);
    p.hp = p.maxHp - 30;
    onEnemyDeath(w, 100, 100, false, false);
    expect(p.hp).toBe(p.maxHp - 30);
  });

  it('최대 HP 를 넘지 않는다', () => {
    const w = mk([[S3, 20]]);
    const p = player(w);
    p.hp = p.maxHp - 3;
    onEnemyDeath(w, 100, 100, true, false);
    expect(p.hp).toBe(p.maxHp);
  });

  it('미투자면 회복이 없다', () => {
    const w = mk([[F1, 1]]);
    const p = player(w);
    p.hp = p.maxHp - 30;
    onEnemyDeath(w, 100, 100, true, false);
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

// ---------------------------------------------------------------------------
// ⑯ M10 이중 추진 (앵커 ㉙ `onPlayerMoveParams`) — 배치 5
// ---------------------------------------------------------------------------
//
// 설계서: 대시가 충전식 2회 · 2번째 충전 재충전 = `240 + 4000/(Lv+5)` 틱 · 소비 순서는
// **기본 충전 우선**.
//
// 뮤테이션(2026-08-07):
//  ① `strikerPlayerMoveParams` 의 임시 개방(`player.dashCooldown = 0`)을 지우면 §⑯ 의
//     「2연 대시」 2건 + `stepWorld` 관통 1건이 빨개진다.
//  ② 기본 충전 복원(`player.dashCooldown = rest`)을 지우면 「기본 충전 잔여 복원」이 빨개진다.
//  ③ `onPlayerMoveParams` 의 `case SIG_STRIKER_MARKSMAN:` 를 지우면 §⑯ 전체가 빨개진다.

describe('⑯ M10 이중 추진 (앵커 ㉙)', () => {
  /** 앵커를 한 번 통과시킨다(`stepPlayer` 의 훅 지점과 같은 파라미터). */
  function moveTick(w: WorldState): void {
    const params: PlayerMoveParams = { speedMult: 1, slowTicks: w.playerSlowTicks };
    onPlayerMoveParams(w, player(w), params);
  }

  it('미투자 런은 대시 쿨다운도 슬롯도 안 건드린다 (바이트 불변의 근거)', () => {
    const w = mk([[M6, 20]]);
    const p = player(w);
    p.dashCooldown = 30;
    moveTick(w);
    expect(p.dashCooldown).toBe(30);
    expect(readSlot(w.skillStage, StrikerStage.twinRecharge)).toBe(0);
    expect(readSlot(w.skillStage, StrikerStage.twinHold)).toBe(0);
  });

  it('기본 충전이 쿨다운 중이면 2충전이 게이트를 연다', () => {
    const w = mk([[M10, 1]]);
    const p = player(w);
    p.dashCooldown = 30;
    moveTick(w);
    expect(p.dashCooldown).toBe(0); // 같은 틱의 대시 게이트가 열린다
    expect(readSlot(w.skillStage, StrikerStage.twinHold)).toBe(31); // 잔여 30 + 1
  });

  it('기본 충전이 이미 준비돼 있으면 2충전을 안 쓴다 (소비 순서 = 기본 우선)', () => {
    const w = mk([[M10, 20]]);
    const p = player(w);
    p.dashCooldown = 0;
    moveTick(w);
    expect(readSlot(w.skillStage, StrikerStage.twinHold)).toBe(0);
    expect(readSlot(w.skillStage, StrikerStage.twinRecharge)).toBe(0); // 충전 그대로 보유
  });

  it('2충전으로 대시가 나가면 기본 충전 잔여가 복원되고 재충전이 시작된다', () => {
    const w = mk([[M10, 20]]);
    const p = player(w);
    p.dashCooldown = 30;
    moveTick(w); // 임시 개방
    p.dashCooldown = DEFAULT_CONFIG.dashCooldownTicks; // 대시 블록이 덮어쓴 상태
    moveTick(w); // 다음 틱 — 대시가 나갔음을 확인하고 정산
    expect(p.dashCooldown).toBe(29); // 30 에서 한 틱 흐른 값 — 만충이 아니다
    // Lv20 재충전 = 240 + floor(4000/25) = 400. 감산은 다음 틱부터라 값이 그대로 선다.
    expect(readSlot(w.skillStage, StrikerStage.twinRecharge)).toBe(400);
    expect(readSlot(w.skillStage, StrikerStage.twinHold)).toBe(0);
  });

  it('재충전 중에는 다시 열지 않는다 (하한 짝 — 여는 쪽이 실제로 돌았다는 대조 포함)', () => {
    const w = mk([[M10, 20]]);
    const p = player(w);
    p.dashCooldown = 30;
    moveTick(w);
    expect(p.dashCooldown).toBe(0); // 긍정 짝 — 첫 개방은 실제로 일어난다
    p.dashCooldown = DEFAULT_CONFIG.dashCooldownTicks;
    moveTick(w);
    const restored = p.dashCooldown;
    expect(restored).toBeGreaterThan(0);
    moveTick(w);
    expect(p.dashCooldown).toBe(restored); // 재충전 중이라 개방이 없다
  });

  it('재충전이 레벨에 단조 감소한다 (240 + 4000/(Lv+5))', () => {
    function rechargeAt(level: number): number {
      const w = mk([[M10, level]]);
      const p = player(w);
      p.dashCooldown = 30;
      moveTick(w);
      p.dashCooldown = DEFAULT_CONFIG.dashCooldownTicks;
      moveTick(w);
      return readSlot(w.skillStage, StrikerStage.twinRecharge);
    }
    const lo = rechargeAt(1);
    const hi = rechargeAt(20);
    expect(lo).toBe(906); // 240 + floor(4000/6)
    expect(hi).toBe(400);
    expect(hi).toBeLessThan(lo);
  });

  it('`stepPlayer` 가 앵커를 실제로 부른다 — 연속 두 틱 대시가 나간다', () => {
    function secondDashVx(points: ReadonlyArray<readonly [number, number]>): number {
      const w = mk(points);
      const p = player(w);
      const dashIn = { ...emptyInput(), moveX: 1, dash: true };
      stepWorld(w, dashIn); // 1틱: 기본 충전으로 대시
      const first = p.vx;
      expect(first).toBeGreaterThan(DEFAULT_CONFIG.playerSpeed); // 하한 — 첫 대시는 양쪽 다 나간다
      stepWorld(w, dashIn); // 2틱: 쿨다운이라 보통은 못 나간다
      return p.vx;
    }
    // 하한 짝 — 미투자 런은 두 번째 틱에 대시 임펄스가 없다(정확히 이동 속도다).
    expect(secondDashVx([[M6, 20]])).toBe(DEFAULT_CONFIG.playerSpeed);
    // 투자 런은 2충전으로 연속 대시가 나간다.
    expect(secondDashVx([[M10, 20]])).toBeGreaterThan(DEFAULT_CONFIG.playerSpeed);
  });
});

// ---------------------------------------------------------------------------
// ⑰ 배치6 — F7 · S7(앵커 ⑱) · S5(앵커 ㉙ + 감쇠 사슬) · M2 · M7(앵커 ②) · M4(`onGemPull`)
// ---------------------------------------------------------------------------
//
// 뮤테이션(2026-08-07 · 아래는 전부 실제로 부수고 빨간 것을 확인했다):
//  ① `strikerBulletHitParams` 의 F7 증폭 한 줄(`params.damage += …`)을 지우면 §⑰-F7 이 빨개진다.
//  ② `onBulletHitParams` 의 `case SIG_STRIKER_MARKSMAN:` 를 지우면 §⑰-F7·§⑰-S7 전체가 빨개진다.
//  ③ S7 의 `params.damage = target.hp` 를 지우면 「처형된다」가 빨개진다.
//  ④ `strikerPlayerMoveParams` 의 `params.slowTicks = 0` 을 지우면 §⑰-S5 의 「역전」이 빨개진다.
//  ⑤ `strikerDamageChain` 의 S5 감소 블록을 지우면 §⑰-S5 의 「해저드 경감」이 빨개진다.
//  ⑥ `layThrustWake` 의 `spawnBullet` 호출을 지우면 §⑰-M2 전체가 빨개진다.
//  ⑦ `strikerGemPull` 의 `params.pull = true` 를 지우면 §⑰-M4 의 「전방 확장」이 빨개진다.
//  ⑧ `strikerObjectiveResolved` 의 `player.dashCooldown = 0` 을 지우면 §⑰-M7 「환급」이 빨개진다.

/** 앵커 ⑱ 을 한 번 통과시키고 확정된 피해를 돌려준다. */
function hit(w: WorldState, bullet: Entity, target: Entity, damage: number): number {
  const params: BulletHitParams = { damage, pierce: 0 };
  onBulletHitParams(w, bullet, target, params);
  return params.damage;
}

/** 잡몹 하나를 월드에 넣고 돌려준다(id 는 `addEntity` 가 준다). */
function spawnEnemy(w: WorldState, hp: number, maxHp: number): Entity {
  const e = blankEntity('enemy');
  e.hp = hp;
  e.maxHp = maxHp;
  return addEntity(w, e);
}

/** 정조준 표식(`aux0 === 1`)을 단 아군탄. */
function markBullet(marked: boolean): Entity {
  const b = blankEntity('bullet');
  b.aux0 = marked ? 1 : 0;
  return b;
}

describe('⑰-F7 표적 고정 (앵커 ⑱)', () => {
  it('같은 표적을 연속으로 때리면 증폭이 단조 증가한다 (하한 짝 포함)', () => {
    const w = mk([[F7, 20]]); // 스택당 bp = 300 + 1000 = 1300 (13%)
    const t = spawnEnemy(w, 1000, 1000);
    const b = markBullet(false);
    // 첫 명중은 증폭 0 — 「쌓인 결과가 증폭」이라는 문면 그대로다.
    expect(hit(w, b, t, 100)).toBe(100);
    const second = hit(w, b, t, 100);
    const third = hit(w, b, t, 100);
    // 하한 짝 — 배선이 끊기면 둘 다 100 이 되어 아래 부등식이 항진이 된다.
    expect(second).toBeGreaterThan(100);
    expect(second).toBe(113); // 1스택 × 13%
    expect(third).toBe(126); // 2스택 × 13%
    expect(third).toBeGreaterThan(second);
  });

  it('표적이 바뀌면 스택이 0 으로 리셋된다', () => {
    const w = mk([[F7, 20]]);
    const a = spawnEnemy(w, 1000, 1000);
    const c = spawnEnemy(w, 1000, 1000);
    const b = markBullet(false);
    hit(w, b, a, 100);
    hit(w, b, a, 100);
    expect(readSlot(w.skillStage, StrikerStage.lockStack)).toBe(1);
    // 다른 표적 — 첫 명중이라 증폭 0
    expect(hit(w, b, c, 100)).toBe(100);
    expect(readSlot(w.skillStage, StrikerStage.lockStack)).toBe(0);
    expect(readSlot(w.skillStage, StrikerStage.lockTarget)).toBe(c.id + 1);
  });

  it('스택 상한 10 에서 멈춘다 (부정 항목의 긍정 짝 — 10 까지는 실제로 오른다)', () => {
    const w = mk([[F7, 20]]);
    const t = spawnEnemy(w, 100000, 100000);
    const b = markBullet(false);
    for (let i = 0; i < 12; i++) hit(w, b, t, 100);
    expect(readSlot(w.skillStage, StrikerStage.lockStack)).toBe(10);
    // 긍정 짝 — 상한 자체가 실제 값(10스택 × 13% = 130% 증폭)이다.
    expect(hit(w, b, t, 100)).toBe(230);
  });

  it('미투자면 슬롯도 피해도 안 움직인다', () => {
    const w = mk([[F1, 1]]);
    const t = spawnEnemy(w, 1000, 1000);
    const b = markBullet(false);
    expect(hit(w, b, t, 100)).toBe(100);
    expect(hit(w, b, t, 100)).toBe(100);
    expect(readSlot(w.skillStage, StrikerStage.lockStack)).toBe(0);
    expect(readSlot(w.skillStage, StrikerStage.lockTarget)).toBe(0);
  });
});

describe('⑰-S7 최후 처형 (앵커 ⑱)', () => {
  /** 빈사(HP 비율)로 만든 뒤 표적을 한 대 때려 **확정된 피해**를 돌려준다. */
  function execute(
    level: number,
    opts: { playerHpPct: number; targetHp: number; marked: boolean; boss?: boolean },
  ): number {
    const w = mk([[S7, level]]);
    const p = player(w);
    p.hp = (p.maxHp * opts.playerHpPct) / 100;
    const t = blankEntity(opts.boss === true ? 'boss' : 'enemy');
    t.hp = opts.targetHp;
    t.maxHp = 1000;
    addEntity(w, t);
    return hit(w, markBullet(opts.marked), t, 1);
  }

  it('빈사 + 정조준탄 + 임계 이하면 잔여 HP 만큼으로 끌어올려 처형한다', () => {
    // Lv20 임계 = 1000 × 15% = 150.
    expect(execute(20, { playerHpPct: 20, targetHp: 140, marked: true })).toBe(140);
  });

  it('임계를 넘으면 무연산이다 (하한 짝 — 경계 안은 실제로 처형된다)', () => {
    expect(execute(20, { playerHpPct: 20, targetHp: 160, marked: true })).toBe(1);
    expect(execute(20, { playerHpPct: 20, targetHp: 150, marked: true })).toBe(150);
  });

  it('HP 30% 초과 · 무표식 탄 · 보스는 대상이 아니다 (긍정 짝 포함)', () => {
    expect(execute(20, { playerHpPct: 40, targetHp: 100, marked: true })).toBe(1);
    expect(execute(20, { playerHpPct: 20, targetHp: 100, marked: false })).toBe(1);
    expect(execute(20, { playerHpPct: 20, targetHp: 100, marked: true, boss: true })).toBe(1);
    // 긍정 짝 — 셋을 다 만족하면 실제로 처형된다.
    expect(execute(20, { playerHpPct: 20, targetHp: 100, marked: true })).toBe(100);
  });

  it('좀비를 만들지 않는다 — 훅은 `hp` 도 `dead` 도 안 만진다', () => {
    const w = mk([[S7, 20]]);
    const p = player(w);
    p.hp = p.maxHp * 0.2;
    const t = spawnEnemy(w, 100, 1000);
    hit(w, markBullet(true), t, 1);
    expect(t.hp).toBe(100); // 차감은 호출부 몫이다
    expect(t.dead).toBe(false);
  });

  it('임계가 레벨에 단조 증가한다', () => {
    // Lv1 임계 55 < 60 → 미발동 · Lv20 임계 150 ≥ 60 → 처형
    expect(execute(1, { playerHpPct: 20, targetHp: 60, marked: true })).toBe(1);
    expect(execute(20, { playerHpPct: 20, targetHp: 60, marked: true })).toBe(60);
  });
});

describe('⑰-S5 극지 적응 (앵커 ㉙ · 감쇠 사슬)', () => {
  function moveOnce(w: WorldState, slowTicks: number): PlayerMoveParams {
    const params: PlayerMoveParams = { speedMult: 1, slowTicks };
    onPlayerMoveParams(w, player(w), params);
    return params;
  }

  it('감속 잔여가 0 으로 지워지고 배율이 1 위로 올라간다 (역전)', () => {
    const w = mk([[S5, 20]]); // bp 11500 + 3000 = 14500 → ×1.45
    const out = moveOnce(w, 30);
    expect(out.slowTicks).toBe(0);
    expect(out.speedMult).toBeCloseTo(1.45, 10);
    expect(out.speedMult).toBeGreaterThan(1); // 하한 짝
  });

  it('감속 중이 아니면 무연산이다 (긍정 짝을 옆에 둔다)', () => {
    const w = mk([[S5, 20]]);
    expect(moveOnce(w, 0).speedMult).toBe(1);
    expect(moveOnce(w, 1).speedMult).toBeGreaterThan(1);
  });

  it('미투자면 감속이 그대로 산다', () => {
    const w = mk([[F1, 1]]);
    const out = moveOnce(w, 30);
    expect(out.slowTicks).toBe(30);
    expect(out.speedMult).toBe(1);
  });

  it('해저드 출처 피해만 경감된다 — 접촉·적탄은 그대로다', () => {
    const w = mk([[S5, 20]]); // 15% + 30% = 45%
    const p = player(w);
    expect(onDamageChain(w, p, 100, DamageSource.hazard)).toBe(55);
    expect(onDamageChain(w, p, 100, DamageSource.contact)).toBe(100);
    expect(onDamageChain(w, p, 100, DamageSource.bullet)).toBe(100);
  });

  it('경감이 레벨에 단조 증가한다 (하한 짝 — 미투자는 100 이다)', () => {
    function at(points: ReadonlyArray<readonly [number, number]>): number {
      const w = mk(points);
      return onDamageChain(w, player(w), 100, DamageSource.hazard);
    }
    expect(at([[F1, 1]])).toBe(100);
    expect(at([[S5, 1]])).toBe(83); // 16.5% → round(16.5) = 17 깎임
    expect(at([[S5, 20]])).toBe(55);
    expect(at([[S5, 20]])).toBeLessThan(at([[S5, 1]]));
  });
});

describe('⑰-M2 추진 항적 (앵커 ②)', () => {
  function wake(w: WorldState): Entity[] {
    return w.entities.filter((e) => e.kind === 'bullet' && !e.dead && e.vx === 0 && e.vy === 0);
  }

  it('대시 방향으로 정지 탄 열을 깐다 (개수 = 2 + floor(Lv/4))', () => {
    const w = mk([[M2, 20]]);
    const p = player(w);
    const px = p.x;
    const py = p.y;
    onDashFired(w, p, 1, 0);
    const laid = wake(w);
    expect(laid).toHaveLength(7);
    // 좌표가 대시 방향으로 늘어선다 — 방향 인자를 실제로 읽었다는 증거다.
    expect(laid.map((e) => e.x - px)).toEqual([56, 112, 168, 224, 280, 336, 392]);
    expect(laid.every((e) => e.y === py)).toBe(true);
  });

  it('방향 인자가 없으면 한 발도 안 깐다 (긍정 짝 — 주면 깐다)', () => {
    const off = mk([[M2, 20]]);
    onDashFired(off, player(off));
    expect(wake(off)).toHaveLength(0);
    const on = mk([[M2, 20]]);
    onDashFired(on, player(on), 0, 1);
    expect(wake(on)).toHaveLength(7);
  });

  it('미투자면 아무것도 안 깐다 · 개수가 레벨에 단조 증가한다', () => {
    const none = mk([[F1, 1]]);
    onDashFired(none, player(none), 1, 0);
    expect(wake(none)).toHaveLength(0);
    const lo = mk([[M2, 1]]);
    onDashFired(lo, player(lo), 1, 0);
    const hi = mk([[M2, 20]]);
    onDashFired(hi, player(hi), 1, 0);
    expect(wake(lo)).toHaveLength(2);
    expect(wake(hi).length).toBeGreaterThan(wake(lo).length);
  });
});

describe('⑰-M4 슬립스트림 (`onGemPull`)', () => {
  /** 젬 하나를 놓고 앵커를 통과시킨 뒤 흡인 여부를 돌려준다. */
  function pulled(w: WorldState, offX: number, offY: number): boolean {
    const p = player(w);
    const gem = blankEntity('gem');
    gem.x = p.x + offX;
    gem.y = p.y + offY;
    addEntity(w, gem);
    const dx = p.x - gem.x;
    const dy = p.y - gem.y;
    const params: GemPullParams = { pull: false, dx, dy, d2: dx * dx + dy * dy };
    onGemPull(w, p, gem, params);
    return params.pull;
  }

  it('진행 방향 **전방**의 젬만 확장 반경으로 흡인된다 (비등방)', () => {
    const w = mk([[M4, 20]]); // 실효 반경 420 × 1.70 = 714
    const p = player(w);
    p.vx = 100;
    p.vy = 0;
    expect(pulled(w, 500, 0)).toBe(true); // 전방 500 — 기본 420 밖인데 확장 안
    expect(pulled(w, -500, 0)).toBe(false); // 후방은 확장 없음
    expect(pulled(w, 800, 0)).toBe(false); // 전방이어도 확장 반경 밖
  });

  it('정지 중이면 원형 그대로다 (긍정 짝 — 움직이면 켜진다)', () => {
    const w = mk([[M4, 20]]);
    const p = player(w);
    p.vx = 0;
    p.vy = 0;
    expect(pulled(w, 500, 0)).toBe(false);
    p.vx = 100;
    expect(pulled(w, 500, 0)).toBe(true);
  });

  it('이미 흡인 대상이면 되돌리지 않는다', () => {
    const w = mk([[M4, 20]]);
    const p = player(w);
    p.vx = -100; // 후방 판정이 될 방향
    const gem = blankEntity('gem');
    gem.x = p.x + 100;
    gem.y = p.y;
    addEntity(w, gem);
    const params: GemPullParams = { pull: true, dx: -100, dy: 0, d2: 10000 };
    onGemPull(w, p, gem, params);
    expect(params.pull).toBe(true);
  });

  it('미투자면 판정이 그대로다 · 확장이 레벨에 단조 증가한다', () => {
    const none = mk([[F1, 1]]);
    player(none).vx = 100;
    expect(pulled(none, 500, 0)).toBe(false);
    // Lv1 = 420×1.32 = 554.4 · Lv20 = 420×1.70 = 714
    const lo = mk([[M4, 1]]);
    player(lo).vx = 100;
    const hi = mk([[M4, 20]]);
    player(hi).vx = 100;
    expect(pulled(lo, 600, 0)).toBe(false);
    expect(pulled(hi, 600, 0)).toBe(true);
  });

  it('자석 버프 창에서도 꺼지지 않는다 (실효 반경 기준으로 확장한다)', () => {
    const w = mk([[M4, 20]]);
    const p = player(w);
    p.vx = 100;
    w.magnetBuffTicks = 5; // 실효 420×3 = 1260 → 확장 2142
    expect(pulled(w, 2000, 0)).toBe(true);
    expect(pulled(w, 2500, 0)).toBe(false);
  });
});

describe('⑰-M7 신호 추적 (앵커 ② · ㉙ 목표 완수)', () => {
  it('에코가 활성이면 대시 쿨다운이 반감된다 (하한 짝 — 비활성은 그대로다)', () => {
    const off = mk([[M7, 20]]);
    player(off).dashCooldown = 100;
    onDashFired(off, player(off), 1, 0);
    expect(player(off).dashCooldown).toBe(100);

    const on = mk([[M7, 20]]);
    on.echoRuntime = { state: 1, spawnTick: 3, dwell: 0, entityId: 0 };
    player(on).dashCooldown = 100;
    onDashFired(on, player(on), 1, 0);
    expect(player(on).dashCooldown).toBe(50);
  });

  it('안정화 완료(state 2)는 활성이 아니다 — 완수 리더와 겹치지 않는다', () => {
    const w = mk([[M7, 20]]);
    w.echoRuntime = { state: 2, spawnTick: 3, dwell: 0, entityId: 0 };
    player(w).dashCooldown = 100;
    onDashFired(w, player(w), 1, 0);
    expect(player(w).dashCooldown).toBe(100);
  });

  it('목표 완수 틱에 전액 환급된다 (에코·조우 둘 다)', () => {
    for (const kind of ['echo', 'encounter'] as const) {
      const w = mk([[M7, 20]]);
      player(w).dashCooldown = 100;
      onObjectiveResolved(w, player(w), kind);
      expect(player(w).dashCooldown).toBe(0);
    }
  });

  it('미투자면 환급도 반감도 없다', () => {
    const w = mk([[F1, 1]]);
    w.echoRuntime = { state: 1, spawnTick: 3, dwell: 0, entityId: 0 };
    player(w).dashCooldown = 100;
    onDashFired(w, player(w), 1, 0);
    expect(player(w).dashCooldown).toBe(100);
    onObjectiveResolved(w, player(w), 'echo');
    expect(player(w).dashCooldown).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// ⑱ 배치7 — F10·M8·M9·S9 (배선 레인 · 30종 최종 4종)
// ---------------------------------------------------------------------------
//
// 뮤테이션(2026-08-07 · 아래는 전부 실제로 부수고 빨간 것을 확인했다 — 결과는 보고 참조):
//  ① `strikerVolleyParams` 의 F10 `emitVolley(...)` 호출을 지우면 §⑱-F10 전체가 빨개진다.
//  ② `strikerVaultShot` 의 `emitVolley(...)` 호출을 지우면 §⑱-M8 전체가 빨개진다.
//  ③ `onContactInvuln` 의 `case SIG_STRIKER_MARKSMAN:` 을 지우면 §⑱-M9 전체가 빨개진다.
//  ④ `strikerContactInvuln` 의 `target.dead = true` 를 지우면 「좀비 금지」가 빨개진다.
//  ⑤ `strikerActiveExpired` 의 `def.id` 게이트를 반대로 뒤집으면(survival 대신 firepower 만
//     통과) §⑱-S9 의 「화력 액티브는 무연산」이 빨개진다.

describe('⑱-F10 연장 탄창 (앵커 ⑯ onVolleyParams)', () => {
  it('정조준 볼리 발사 틱에 같은 방향으로 감쇠 피해의 후속 볼리가 추가로 나간다', () => {
    const w = mk([[F10, 1]]); // bp = 10000 − round(120000/20) = 4000 (40%)
    const p = player(w);
    const before = w.entities.length;
    onVolleyParams(w, p, volley({ mark: 1, damage: 100, count: 1, pierce: 1 }));
    const spawned = w.entities.slice(before).filter((e) => e.kind === 'bullet');
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.damage).toBe(40);
    // 마커도 물려받는다 — 후속탄도 F6·F7·F8·F9·S7 명중 연계가 걸린다.
    expect(spawned[0]?.aux0).toBe(1);
  });

  it('평상시 볼리(mark=0)에는 추가 발사가 없다 (긍정 짝은 위 테스트다)', () => {
    const w = mk([[F10, 20]]);
    const p = player(w);
    const before = w.entities.length;
    onVolleyParams(w, p, volley({ mark: 0, count: 1 }));
    expect(w.entities.length).toBe(before);
  });

  it('미투자면 정조준 볼리여도 추가 발사가 없다', () => {
    const w = mk([[F1, 1]]);
    const p = player(w);
    const before = w.entities.length;
    onVolleyParams(w, p, volley({ mark: 1, count: 1 }));
    expect(w.entities.length).toBe(before);
  });

  it('레벨이 오르면 후속 피해가 커진다 (하한 짝)', () => {
    const dmgAt = (level: number): number => {
      const w = mk([[F10, level]]);
      const p = player(w);
      const before = w.entities.length;
      onVolleyParams(w, p, volley({ mark: 1, damage: 1000, count: 1 }));
      const spawned = w.entities.slice(before).filter((e) => e.kind === 'bullet');
      return spawned[0]?.damage ?? 0;
    };
    const lo = dmgAt(1);
    const hi = dmgAt(20);
    expect(lo).toBeGreaterThan(0); // 긍정 하한 — 배선이 끊기면 0
    expect(hi).toBeGreaterThan(lo);
  });

  it('F2·F5 로 이미 강화된 볼리를 물려받는다 (최종 파라미터를 복제한다)', () => {
    // F2 대시 직후 창(집속 + 피해 증폭) 안에서 발사 — F10 이 그 강화분까지 감쇠해 물려받는지 확인.
    const w = mk([
      [F2, 10],
      [F10, 20],
    ]); // F10 Lv20 bp = 10000 − round(120000/39) = 6923
    const p = player(w);
    p.dashCooldown = w.config.dashCooldownTicks;
    const before = w.entities.length;
    onVolleyParams(w, p, volley({ mark: 1, damage: 100, count: 1, pierce: 1 }));
    const spawned = w.entities.slice(before).filter((e) => e.kind === 'bullet');
    // F2 가 먼저 100 → 120 으로 올린 뒤, F10 이 그 120 을 감쇠한다: round(120 × 6923/10000) = 83.
    expect(spawned[0]?.damage).toBe(83);
  });

  it('`player.cooldown` 을 한 비트도 안 만진다 (쿨다운 미소비)', () => {
    const w = mk([[F10, 20]]);
    const p = player(w);
    p.cooldown = 17;
    onVolleyParams(w, p, volley({ mark: 1, count: 1 }));
    expect(p.cooldown).toBe(17);
  });
});

describe('⑱-M8 도약 사격 (액티브 핸들러 as_striker_mobility_hi)', () => {
  function vault(points: ReadonlyArray<readonly [number, number]>): Entity[] {
    const w = mk(points);
    const p = player(w);
    const before = w.entities.length;
    const handler = STRIKER_HANDLERS['as_striker_mobility_hi'];
    if (handler === undefined) throw new Error('handler missing');
    handler(w, p, activeDef('as_striker_mobility_hi'), { x: 1, y: 0 }, 0);
    return w.entities.slice(before).filter((e) => e.kind === 'bullet');
  }

  it('2단 도약의 단 사이(1단 착지 직후)에 정조준 볼리 1회가 자동 발사된다', () => {
    const shots = vault([[M8, 1]]);
    expect(shots).toHaveLength(1); // vaults=2 라 「사이」는 정확히 한 번뿐이다
    expect(shots[0]?.aux0).toBe(1); // mark=1 — 정조준탄 연계가 걸린다
    // 자동 볼리 피해 = round(기본 피해 × (60% + 레벨당 3%)).
    // ⚠️ 기본 피해를 리터럴로 박지 마라 — 밸런스를 만질 때마다 여기가 빨개진다(2026-08-08 에
    //    8 → 18.24 로 오르며 실제로 그랬다). 재는 것은 **비율 배선**이지 그 곱의 결과값이 아니다.
    expect(shots[0]?.damage).toBe(Math.round(DEFAULT_WEAPON.damage * (0.6 + 0.03)));
  });

  it('레벨이 오르면 자동 볼리 피해가 오른다 (하한 짝)', () => {
    const lo = vault([[M8, 1]])[0]?.damage ?? 0;
    const hi = vault([[M8, 20]])[0]?.damage ?? 0;
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeGreaterThan(lo);
  });

  it('미투자면 도약만 하고 추가 발사가 없다', () => {
    expect(vault([[F1, 1]])).toHaveLength(0);
  });

  it('`player.cooldown` 을 한 비트도 안 만진다 (쿨다운 미소비)', () => {
    const w = mk([[M8, 20]]);
    const p = player(w);
    p.cooldown = 12;
    const handler = STRIKER_HANDLERS['as_striker_mobility_hi'];
    if (handler === undefined) throw new Error('handler missing');
    handler(w, p, activeDef('as_striker_mobility_hi'), { x: 1, y: 0 }, 0);
    expect(p.cooldown).toBe(12);
  });
});

describe('⑱-M9 충각 기동 (앵커 onContactInvuln)', () => {
  it('무적프레임 중 접촉하면 플레이어 대신 적이 피해를 받는다', () => {
    const w = mk([[M9, 5]]); // 충각 피해 = 10 + 15 = 25
    const p = player(w);
    p.iframes = 10;
    const t = blankEntity('enemy');
    t.hp = 100;
    addEntity(w, t);
    onContactInvuln(w, p, t);
    expect(t.hp).toBe(75);
  });

  it('처치되면 dead 가 hp 와 함께 선다 (좀비 금지)', () => {
    const w = mk([[M9, 20]]); // 충각 피해 = 10 + 60 = 70
    const p = player(w);
    const t = blankEntity('enemy');
    t.hp = 10;
    addEntity(w, t);
    onContactInvuln(w, p, t);
    expect(t.hp).toBeLessThanOrEqual(0);
    expect(t.dead).toBe(true);
  });

  it('적 1기당 재충돌 간격은 30틱이다 (그 안엔 무연산 · 지나면 다시 발동)', () => {
    const w = mk([[M9, 5]]);
    const p = player(w);
    const t = blankEntity('enemy');
    t.hp = 1000;
    addEntity(w, t);
    w.tick = 100;
    onContactInvuln(w, p, t);
    expect(t.hp).toBe(975); // 첫 충돌 — 실제로 깎인다(긍정 짝)
    w.tick = 110; // +10 < 30
    onContactInvuln(w, p, t);
    expect(t.hp).toBe(975); // 쿨 중 — 무연산
    w.tick = 131; // +31 ≥ 30
    onContactInvuln(w, p, t);
    expect(t.hp).toBe(950); // 쿨 지남 — 다시 깎인다
  });

  it('guardian·boss·defenseBoss 는 대상이 아니다 (부활 분기 보호)', () => {
    const w = mk([[M9, 20]]);
    const p = player(w);
    for (const kind of ['guardian', 'boss', 'defenseBoss'] as const) {
      const t = blankEntity(kind);
      t.hp = 100;
      addEntity(w, t);
      onContactInvuln(w, p, t);
      expect(t.hp).toBe(100);
    }
  });

  it('미투자면 무연산이다', () => {
    const w = mk([[F1, 1]]);
    const p = player(w);
    const t = blankEntity('enemy');
    t.hp = 100;
    addEntity(w, t);
    onContactInvuln(w, p, t);
    expect(t.hp).toBe(100);
  });
});

describe('⑱-S9 만료 정지장 (앵커 onActiveExpired)', () => {
  it('생존 액티브가 끝나는 틱에 반경 안 잡몹이 정지한다(속도 배율 0)', () => {
    const w = mk([[S9, 4]]); // 정지 45+20=65틱 · 반경 160+48=208
    const p = player(w);
    const inner = blankEntity('enemy'); // 거리 200 < 208
    inner.x = p.x + 200;
    inner.y = p.y;
    addEntity(w, inner);
    const outer = blankEntity('enemy'); // 거리 300 > 208
    outer.x = p.x + 300;
    outer.y = p.y;
    addEntity(w, outer);
    onActiveExpired(w, p, activeDef('as_striker_survival_hi'), 0);
    expect(enemyStatusStopMult(inner)).toBe(0);
    expect(enemyStatusStopMult(outer)).toBe(1); // 긍정 짝 — 반경 밖은 안 걸린다
  });

  it('저티어 생존 액티브(as_striker_survival_lo) 만료에도 걸린다', () => {
    const w = mk([[S9, 20]]);
    const p = player(w);
    const t = blankEntity('enemy');
    t.x = p.x + 100;
    t.y = p.y;
    addEntity(w, t);
    onActiveExpired(w, p, activeDef('as_striker_survival_lo'), 0);
    expect(enemyStatusStopMult(t)).toBe(0);
  });

  it('화력·기동 액티브 만료에는 무연산이다 (생존만 트리거)', () => {
    const w = mk([[S9, 20]]);
    const p = player(w);
    const t = blankEntity('enemy');
    t.x = p.x;
    t.y = p.y;
    addEntity(w, t);
    onActiveExpired(w, p, activeDef('as_striker_firepower_hi'), 0);
    expect(enemyStatusStopMult(t)).toBe(1);
  });

  it('guardian 은 대상이 아니다', () => {
    const w = mk([[S9, 20]]);
    const p = player(w);
    const g = blankEntity('guardian');
    g.x = p.x;
    g.y = p.y;
    addEntity(w, g);
    onActiveExpired(w, p, activeDef('as_striker_survival_hi'), 0);
    expect(enemyStatusStopMult(g)).toBe(1);
  });

  it('미투자면 무연산이다', () => {
    const w = mk([[F1, 1]]);
    const p = player(w);
    const t = blankEntity('enemy');
    t.x = p.x;
    t.y = p.y;
    addEntity(w, t);
    onActiveExpired(w, p, activeDef('as_striker_survival_hi'), 0);
    expect(enemyStatusStopMult(t)).toBe(1);
  });

  it('만료가 적을 죽이지 않는다 (배치7 F1 선결 계약과 정합)', () => {
    const w = mk([[S9, 20]]);
    const p = player(w);
    const t = blankEntity('enemy');
    t.hp = 50;
    t.x = p.x;
    t.y = p.y;
    addEntity(w, t);
    onActiveExpired(w, p, activeDef('as_striker_survival_hi'), 0);
    expect(t.hp).toBe(50);
    expect(t.dead).toBe(false);
  });
});
