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
} from '../src/sim/skillHooks.js';
import { SIG_STRIKER_MARKSMAN, MARKSMAN_TRIGGER_AUX0 } from '../src/sim/shipSignature.js';
import { StrikerCarry, readSlot, SKILL_SLOT_COUNT } from '../src/sim/skillSlots.js';

/** flat 인덱스 — `data/ships/striker.ts` 축 순서(F 0..9 · S 10..19 · M 20..29). */
const F1 = 0;
const F4 = 3;
const S1 = 10;
const S2 = 11;
const S4 = 13;
const S8 = 17;
const S10 = 19;
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
    onBulletExpired(w, bullet);
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
