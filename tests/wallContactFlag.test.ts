/**
 * 엔진 선결 E5 — 벽 접촉 플래그(`WorldState.wallContactTicks`, ADR-0049).
 *
 * ## 이 파일이 막는 것
 * 이 정수 하나를 다섯 스킬이 공유한다(스트라이커 M5·S4 · 브루저 MO8 · 버블 FI7 · 말로우 ME9).
 * 다섯의 술어는 전부 **"접촉 중"** 인데, 원재료인 `SlideResult.hit` 의 의미는 **"이번 틱에
 * 벽에서 밀려났다"** 다. 둘은 벽을 계속 미는 동안에만 일치하고, **벽에 붙어 정지한 순간
 * 갈린다** — `slideCircleWalls` 가 겹침을 풀 때 좌표를 벽 경계값에 정확히 스냅하고 겹침 판정이
 * 엄격 부등호(`dx < hw`)라, 실제로 붙어 있는데 `hit=false` 가 된다.
 *
 * 그 혼동이 들어가면 다섯 스킬이 "벽을 계속 밀 때만" 작동하고 붙어 서 있을 때는 **화면상
 * 아무 표시 없이 조용히 꺼진다** — 테스트 없이는 영영 안 보이는 결함이라 여기서 잠근다.
 * 실측 근거는 `.omc/research/mallow-wall-streak-p3-rerun-2026-08-06.md` §①(카르곤에서 좌표가
 * t=100~1500 비트 단위로 동결되고 `gapY` 가 정확히 0 이었다).
 *
 * ## 이 커밋 시점에는 아무도 이 값을 소비하지 않는다
 * 그래서 마지막 절이 **해시 불변**을 함께 못 박는다 — `hashWorld` 가 이 필드를 접지 않아야
 * 기존 골든·리플레이가 한 바이트도 안 바뀐다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { InputFrame, WorldState } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import { slideCircleWalls, circleOverlapsWall } from '../src/sim/los.js';
import { blankEntity, spawnWall } from '../src/sim/entities.js';
import type { Entity } from '../src/sim/entities.js';

// ---------------------------------------------------------------------------
// ① 지뢰 자체를 직접 태운다 — 경계 스냅 함정 (los.ts 단위)
// ---------------------------------------------------------------------------

describe('경계 스냅 함정 — `SlideResult.hit` 은 "접촉 중"이 아니다', () => {
  /** 벽 하나(중심 0,0 · 반폭 60 · 반높이 200). 좌표를 전부 정수로 잡아 부동소수 반올림을 배제한다. */
  function wall(): Entity {
    const w = blankEntity('wall');
    w.x = 0;
    w.y = 0;
    w.radius = 60; // half-width
    w.targetX = 200; // half-height
    return w;
  }

  const R = 14; // 원 반경

  it('벽 안으로 파고든 원은 밀려나고 `hit=true` 다', () => {
    const res = slideCircleWalls(50, 0, R, [wall()]);
    expect(res.hit).toBe(true);
    // 밀려난 좌표는 확장 경계값에 **정확히** 스냅된다 — 이것이 함정의 원인이다.
    expect(res.x).toBe(60 + R);
  });

  it('⚠️ 경계에 정확히 붙은 원은 실제로 접촉인데 `hit=false` 다 (함정 재현)', () => {
    const snapped = 60 + R; // 직전 케이스가 뱉은 바로 그 좌표
    expect(slideCircleWalls(snapped, 0, R, [wall()]).hit).toBe(false);
  });

  it('반경에 `CONTACT_EPS` 여유를 더하면 그 상태가 접촉으로 잡힌다 (복구)', () => {
    const snapped = 60 + R;
    expect(slideCircleWalls(snapped, 0, R + 0.1, [wall()]).hit).toBe(true);
  });

  it('멀리 떨어진 원은 여유를 더해도 접촉이 아니다 (오탐 없음)', () => {
    expect(slideCircleWalls(60 + R + 50, 0, R + 0.1, [wall()]).hit).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ①-B 왜 `circleOverlapsWall` 로 대체하지 않았는가 (설계 검토 2026-08-06)
//
// 「엄격 부등호가 문제라면 경계 포함(`<=`)인 `circleOverlapsWall` 을 쓰면 eps 가 필요 없다」는
// 대안이 검토됐다. 더 싸고 매직 상수도 없어 매력적이지만 **두 자리에서 접촉을 잃는다**.
// 그 둘을 여기서 영구히 태운다 — 이 절이 없으면 대안이 조용히 다시 들어온다(실제로 대안
// 구현은 이 파일의 나머지 전부를 초록으로 통과했다).
// ---------------------------------------------------------------------------

describe('`circleOverlapsWall` 대체안이 접촉을 잃는 두 자리', () => {
  function wallAt(x: number, hw: number, hh = 200): Entity {
    const w = blankEntity('wall');
    w.x = x;
    w.y = 0;
    w.radius = hw;
    w.targetX = hh;
    return w;
  }

  it('① 모서리 띠에서 정지: 실제로 막혀 있는데 정확 원 판정은 거짓이다', () => {
    const w = wallAt(0, 60);
    const r = 14;
    // 벽 끝을 살짝 넘어선 높이(|dy| 205 — 벽 반높이 200 과 확장 214 사이)에서 X 로 밀려난다.
    const pushed = slideCircleWalls(70, 205, r, [w]);
    expect(pushed.hit).toBe(true);
    expect(pushed.x).toBe(74); // 확장 경계값에 스냅

    // 그 자리에 가만히 있으면: 밀려남도 거짓, **정확 원 판정도 거짓**.
    expect(slideCircleWalls(pushed.x, pushed.y, r, [w]).hit).toBe(false);
    expect(circleOverlapsWall(pushed.x, pushed.y, r, w)).toBe(false);

    // 그런데 플레이어는 **실제로 막혀 있다** — 벽 쪽으로 밀면 같은 자리로 되밀린다.
    const shove = slideCircleWalls(pushed.x - 1, pushed.y, r, [w]);
    expect(shove.hit).toBe(true);
    expect(shove.x).toBe(74);

    // 채택안(경계상자 + eps)만 이 상태를 접촉으로 잡는다.
    expect(slideCircleWalls(pushed.x, pushed.y, r + 0.1, [w]).hit).toBe(true);
  });

  it('② 비정수 기하에서 스냅 좌표가 반경을 1 ULP 넘어선다', () => {
    // `<=` 의 경계 포함은 `dx` 가 **정확히** r 일 때만 구원이다. 스냅은 `fl(x + fl(hw + r))`,
    // 최근접점은 `fl(x + hw)` 로 각각 반올림되므로 차이는 `r ± ulp` 다.
    let lost = 0;
    let total = 0;
    for (let i = 0; i < 500; i++) {
      const wx = i * 7.3;
      const hw = 60.3 + (i % 13) * 1.7;
      const r = 14 + (i % 5) * 0.37;
      const w = wallAt(wx, hw);
      const snapped = slideCircleWalls(wx + hw, 0, r, [w]);
      if (!snapped.hit) continue;
      total++;
      if (!circleOverlapsWall(snapped.x, 0, r, w)) lost++;
      // 채택안은 표본 전체에서 접촉을 잃지 않는다.
      expect(slideCircleWalls(snapped.x, 0, r + 0.1, [w]).hit).toBe(true);
    }
    expect(total).toBeGreaterThan(100);
    // 정확 원 판정은 표본의 상당수를 놓친다 — "경계 포함이라 안전" 이 성립하지 않는다는 물증.
    expect(lost).toBeGreaterThan(total * 0.2);
  });
});

// ---------------------------------------------------------------------------
// ② sim 통합 — `wallContactTicks` 4케이스
// ---------------------------------------------------------------------------

/** 이동 입력만 실은 프레임(대시·액티브 없음 — 이 파일이 재는 축은 접촉 하나다). */
function move(x: number, y = 0): InputFrame {
  return { ...emptyInput(), moveX: x, moveY: y };
}

interface Rig {
  state: WorldState;
  player: Entity;
  /** 이 판에서 유일하게 살려 두는 벽(없는 무대 케이스에서는 `null`). */
  wall: Entity | null;
  /** 오염원(적·탄·절차 지형)을 전부 죽인 뒤 한 틱 굴린다. */
  tick(input?: InputFrame): void;
}

/**
 * 플레이어 오른쪽 `gap` 만큼 떨어진 자리에 벽 하나만 세운 판.
 *
 * 정규 경로(`createWorld` → `stepWorld`)를 그대로 쓰되, 매 틱 **플레이어와 이 벽 말고는 전부
 * 죽인다** — 절차 청크가 깔아 놓는 다른 벽·적·탄이 접촉 판정과 생존에 섞이면 재는 것이
 * 달라진다. 죽인 김리믹은 청크 마커가 남아 재생성되지 않는다.
 */
function rig(gap: number | null, wallYOffset = 0, halfH = 400): Rig {
  const state = createWorld(1, { ...DEFAULT_CONFIG });
  const player = state.entities[0] as Entity;
  let wall: Entity | null = null;
  if (gap !== null) {
    // 반높이를 넉넉히 잡아 좌우 이동 중 벽 끝을 벗어나는 일이 없게 한다.
    wall = spawnWall(state, player.x + gap, player.y + wallYOffset, 60, halfH);
  }
  const tick = (input: InputFrame = emptyInput()): void => {
    for (const e of state.entities) {
      if (e === player || e === wall) continue;
      e.dead = true;
    }
    stepWorld(state, input);
  };
  return { state, player, wall, tick };
}

describe('wallContactTicks — 연속 벽 접촉 틱', () => {
  it('벽을 계속 미는 중: 매 틱 누적된다', () => {
    const r = rig(200);
    for (let i = 0; i < 40; i++) r.tick(move(1));
    expect(r.state.wallContactTicks).toBeGreaterThan(1);
    // 실제로 벽에 막혀 있는가(밀고 있는데 통과했으면 재는 것이 달라진다).
    const wall = r.wall as Entity;
    expect(r.player.x).toBeLessThan(wall.x);
    // 계속 미는 동안 단조 증가.
    const before = r.state.wallContactTicks;
    r.tick(move(1));
    expect(r.state.wallContactTicks).toBe(before + 1);
  });

  it('⚠️ 벽에 붙어서 정지: 입력을 놔도 접촉이 계속 선다 (이 파일의 핵심)', () => {
    const r = rig(200);
    for (let i = 0; i < 40; i++) r.tick(move(1)); // 붙을 때까지 민다
    const pressed = r.state.wallContactTicks;
    expect(pressed).toBeGreaterThan(0);

    // 여기서부터 무입력 — 좌표가 경계값에 동결된다.
    const restX = (() => {
      r.tick();
      return r.player.x;
    })();
    for (let i = 0; i < 60; i++) r.tick();

    // 좌표는 정지해 있어야 한다(정지 상태를 실제로 재고 있다는 증거).
    expect(r.player.x).toBe(restX);
    // 그리고 접촉은 끊기지 않는다 — 61틱을 더 세었으므로 K=60(ME9) 문턱도 넘는다.
    expect(r.state.wallContactTicks).toBe(pressed + 61);
    expect(r.state.wallContactTicks).toBeGreaterThanOrEqual(60);

    // 왜 이 단언이 필요한가: 같은 좌표를 `hit` 단독으로 재면 **거짓**이다. 즉 이 테스트가
    // 없으면 "밀려남" 의미로 구현해도 위 두 케이스가 전부 초록으로 통과해 버린다.
    const bare = slideCircleWalls(
      r.player.x,
      r.player.y,
      r.player.radius,
      r.state.activeWalls,
    ).hit;
    expect(bare).toBe(false);
  });

  it('벽에서 떨어짐: 0 으로 리셋된다', () => {
    const r = rig(200);
    for (let i = 0; i < 40; i++) r.tick(move(1));
    expect(r.state.wallContactTicks).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) r.tick(move(-1)); // 반대로 도망
    expect(r.state.wallContactTicks).toBe(0);
    // 리셋이지 감산이 아니다 — 떨어진 뒤로는 계속 0.
    r.tick(move(-1));
    expect(r.state.wallContactTicks).toBe(0);
  });

  it('벽이 없음: 끝까지 0 이다', () => {
    const r = rig(null);
    for (let i = 0; i < 60; i++) r.tick(move(1));
    expect(r.state.activeWalls.length).toBe(0);
    expect(r.state.wallContactTicks).toBe(0);
  });

  it('런 시작값은 0 이다', () => {
    expect(createWorld(7, { ...DEFAULT_CONFIG }).wallContactTicks).toBe(0);
  });

  it('모서리 띠에 붙어서 정지: sim 에서도 접촉이 끊기지 않는다', () => {
    // 벽을 위로 205 올려, 플레이어가 벽 **끝을 살짝 넘어선 높이**에서 좌측 면에 막히게 한다
    // (반높이 200 · 확장 214 → dy 205 는 그 사이의 모서리 띠다).
    const r = rig(200, -205, 200);
    for (let i = 0; i < 40; i++) r.tick(move(1));
    expect(r.state.wallContactTicks).toBeGreaterThan(0);

    r.tick();
    const restX = r.player.x;
    const pressed = r.state.wallContactTicks;
    for (let i = 0; i < 20; i++) r.tick();
    expect(r.player.x).toBe(restX); // 정지 상태를 실제로 재고 있다
    expect(r.state.wallContactTicks).toBe(pressed + 20);

    // 판별점: 이 자리에서 **정확 원 판정은 거짓**이다 — `circleOverlapsWall` 대체안이었다면
    // 카운터가 0 으로 떨어졌을 자리다(위 ①-B 절 참조).
    const exact = r.state.activeWalls.some((w) =>
      circleOverlapsWall(r.player.x, r.player.y, r.player.radius, w),
    );
    expect(exact).toBe(false);
  });

  it('레벨업 프리즈 중에는 값이 동결된다 (리셋도 증가도 아니다)', () => {
    // 프리즈 틱은 `stepPlayer` 자체가 안 돈다(world.ts 의 pendingLevelUp 조기 반환).
    // 플레이어도 벽도 안 움직이므로 접촉 상태 유지가 맞다 — 다음 레인이 프리즈 처리 순서를
    // 바꾸면 여기서 깨진다.
    const r = rig(200);
    for (let i = 0; i < 40; i++) r.tick(move(1));
    const frozen = r.state.wallContactTicks;
    expect(frozen).toBeGreaterThan(0);

    r.state.pendingLevelUp = true;
    const tickBefore = r.state.tick;
    for (let i = 0; i < 10; i++) r.tick(move(-1)); // 반대로 밀어도 무시돼야 한다
    expect(r.state.tick).toBe(tickBefore + 10); // 프리즈 틱도 tick 은 전진한다
    expect(r.state.wallContactTicks).toBe(frozen);

    // 프리즈가 풀리면 다시 정상 갱신된다.
    r.state.pendingLevelUp = false;
    r.tick(move(1));
    expect(r.state.wallContactTicks).toBe(frozen + 1);
  });
});

// ---------------------------------------------------------------------------
// ③ 해시 불변 — `hashWorld` 는 이 필드를 접지 않는다
// ---------------------------------------------------------------------------

describe('해시 불변 (E5 는 순수 메타 — 골든·리플레이 바이트 불변)', () => {
  it('`wallContactTicks` 를 바꿔도 `hashWorld` 가 그대로다', () => {
    const state = createWorld(3, { ...DEFAULT_CONFIG });
    for (let i = 0; i < 20; i++) stepWorld(state, emptyInput());
    const h = hashWorld(state);
    for (const v of [0, 1, 59, 60, 1234, 0x7fffffff]) {
      state.wallContactTicks = v;
      expect(hashWorld(state)).toBe(h);
    }
  });

  it('벽에 붙어 카운터가 오른 런과 그렇지 않은 런의 해시 차이가 카운터 때문이 아니다', () => {
    // 같은 시드·같은 입력을 두 번 굴리면 카운터까지 포함해 완전히 같아야 한다(결정론).
    const a = rig(200);
    const b = rig(200);
    for (let i = 0; i < 40; i++) {
      a.tick(move(1));
      b.tick(move(1));
    }
    expect(a.state.wallContactTicks).toBe(b.state.wallContactTicks);
    expect(a.state.wallContactTicks).toBeGreaterThan(0);
    expect(hashWorld(a.state)).toBe(hashWorld(b.state));
  });
});
