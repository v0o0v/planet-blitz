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
import { blankEntity } from '../src/sim/entities.js';
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
import { StrikerCarry, readSlot, SKILL_SLOT_COUNT } from '../src/sim/skillSlots.js';
import { STRIKER_HANDLERS } from '../src/sim/activeHandlers/striker.js';
import { ALL_ACTIVES } from '../data/ships/actives/index.js';
import type { ActiveSkillDef } from '../data/ships/actives/types.js';

/** flat 인덱스 — `data/ships/striker.ts` 축 순서(F 0..9 · S 10..19 · M 20..29). */
const F1 = 0;
const F2 = 1;
const F3 = 2;
const F4 = 3;
const F6 = 5;
const F9 = 8;
const S1 = 10;
const S2 = 11;
const S3 = 12;
const S4 = 13;
const S8 = 17;
const S10 = 19;
const M1 = 20;
const M3 = 22;
const M5 = 24;

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
    onPlayerDamaged(w, player(w), 7, false);
    expect(player(w).aux0).toBe(MARKSMAN_TRIGGER_AUX0);
  });

  it('S1: 이미 임계를 넘긴 카운터를 되돌리지 않는다 (F1 과의 부호 반전 방지)', () => {
    const w = mk([[S1, 1]]);
    player(w).aux0 = MARKSMAN_TRIGGER_AUX0 + 9;
    onPlayerDamaged(w, player(w), 7, false);
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
    onPlayerDamaged(w, p, 7, false);
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
    onPlayerDamaged(w, p, 7, false);
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
    // 발사 방위(rad). F5(조준선 관통)가 언젠가 읽을 항이지만 아직 미배선 — 기본 0(순수 +x).
    aimAngle: 0,
    cloakBreak: false,
    mark: 0,
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
