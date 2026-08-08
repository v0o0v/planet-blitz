/**
 * 벽 슬라이드 **관통 방지**(끼임 규칙) — 사용자 신고 회귀의 직접 가드.
 *
 * ## 무엇이 결함이었나
 * `slideCircleWalls` 는 겹친 원을 **최소 침투** 축·쪽으로 밀어낸다. 그 규칙은 "원이 스스로
 * 움직여 얕게 파고들었다" 를 전제하는데, 강제 스크롤 모드에서는 전제가 깨진다: 창 앵커가
 * 플레이어를 벽 안으로 계속 밀어 넣고 창 클램프가 슬라이드 결과를 매 틱 되돌리므로, 침투가
 * 두께의 절반을 넘는 순간 최소 침투가 **먼 쪽 면**을 골라 플레이어를 벽 반대편으로 뱉는다.
 *
 * 실측(seed 1234 · blockBreak · 무입력 120틱): 창 뒤 경계(rel 508)에 몰린 플레이어가 t=102 에
 * **한 틱에 79유닛** 전방으로 순간이동했다(rel 508 → 429).
 *
 * 설계 위반인 이유: 블록격파의 압사(`crushBlockBreak`)는 "창 경계와 **부술 수 있는 벽** 사이에
 * 몰렸다" 는 뜻이고 탈출 수단은 벽을 부수는 것이다. 관통은 그 압박을 공짜로 무효화한다.
 *
 * ## 이 파일이 지키는 것
 *  ① 순수 프리미티브 계약 — 인자 없이 부르면 **기존 최소 침투 그대로**(기존 호출자 불변).
 *  ② 진입면 규칙 — 직전 좌표가 벽 밖이면 그쪽 면으로 되민다.
 *  ③ 끼임 규칙 — 직전 좌표도 벽 안이면 창 전진의 **반대쪽** 면으로 되민다(관통 금지).
 *  ④ 정규 경로 회귀 — 실제 blockBreak 런에서 한 틱 순간이동이 사라졌고 압사가 계속 돈다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldState, Entity, InputFrame } from '../src/sim/world.js';
import { slideCircleWalls } from '../src/sim/los.js';
import { blankEntity } from '../src/sim/entities.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile } from '../src/save/profile.js';
import { PLANET_MODE } from '../src/sim/planetMode.js';
import { INVASION_WINDOW_HALF_H } from '../src/sim/invasion/scroll.js';
import { SCROLL_AXIS_VERTICAL, SCROLL_AXIS_HORIZONTAL } from '../src/sim/invasion/constants.js';

/** 테스트용 벽(AABB 필드 매핑: radius = halfW, targetX = halfH — los.ts 정본). */
function wall(x: number, y: number, halfW: number, halfH: number): Entity {
  const w = blankEntity('wall');
  w.x = x;
  w.y = y;
  w.radius = halfW;
  w.targetX = halfH;
  return w;
}

const idle: InputFrame = emptyInput();
const playerOf = (w: WorldState): Entity => w.entities[0]!;

/** 블록격파 정규경로 config(카르곤 = planet 0 위에 모드만 덮어쓴다 — 기존 테스트 관례). */
function blockBreakConfig() {
  return {
    ...buildRunConfig(defaultProfile(), { planet: 0, stage: 1 }),
    planetMode: PLANET_MODE.blockBreak,
  };
}

describe('① 프리미티브 하위 호환 — 인자 없이 부르면 최소 침투 그대로', () => {
  // 벽: 중심 (0,0) · halfW 60 · halfH 60. 원 반경 32 → 확장 half-extents 92 × 92.
  const walls = [wall(0, 0, 60, 60)];

  it('얕게 파고든 쪽으로 밀어낸다', () => {
    // y 로 얕게(+80) 파고들었다 → penY(12) < penX(92) → +Y 면(92)으로.
    const a = slideCircleWalls(0, 80, 32, walls);
    expect(a.hit).toBe(true);
    expect(a.y).toBe(92);
    expect(a.x).toBe(0);
  });

  it('중심선을 넘으면 먼 쪽 면을 고른다 — 이것이 관통의 정체다', () => {
    // dy = −9(중심선 넘음) → −Y 면으로. 이 동작 자체는 프리미티브 계약이라 유지된다.
    const b = slideCircleWalls(0, -9, 32, walls);
    expect(b.y).toBe(-92);
  });

  it('겹치지 않으면 좌표를 건드리지 않는다', () => {
    const c = slideCircleWalls(0, 200, 32, walls);
    expect(c.hit).toBe(false);
    expect(c.y).toBe(200);
  });
});

describe('② 진입면 규칙 — 직전 좌표가 벽 밖이면 그쪽 면으로 되민다', () => {
  const walls = [wall(0, 0, 60, 60)];

  it('위(+Y)에서 들어왔으면 깊이와 무관하게 +Y 면으로 되민다', () => {
    // 현재 dy = −9(중심선을 넘었다) → 인자 없이는 −92(관통). 직전이 +150(벽 밖)이면 +92.
    expect(slideCircleWalls(0, -9, 32, walls).y).toBe(-92);
    expect(slideCircleWalls(0, -9, 32, walls, 0, 150).y).toBe(92);
  });

  it('아래(−Y)에서 들어왔으면 −Y 면으로 되민다 (대칭)', () => {
    // 현재 dy = +9 → 인자 없이는 +92. 직전이 −150(벽 밖 아래)이면 −92.
    expect(slideCircleWalls(0, 9, 32, walls).y).toBe(92);
    expect(slideCircleWalls(0, 9, 32, walls, 0, -150).y).toBe(-92);
  });

  it('직전 좌표가 벽 밖이면 교차 축 슬라이드는 그대로 살아 있다', () => {
    // 옆(+X)에서 스쳐 들어옴: penX 가 최소라 X 축으로 밀려난다(정상 슬라이드).
    const s = slideCircleWalls(85, 0, 32, walls, 200, 0);
    expect(s.x).toBe(92);
    expect(s.y).toBe(0);
  });
});

describe('③ 끼임 규칙 — 직전 좌표도 벽 안이면 창 전진의 반대쪽 면', () => {
  const walls = [wall(0, 0, 60, 60)];

  it('창이 −Y 로 전진하면(블록격파) 끼인 원을 +Y 면으로 되민다', () => {
    // 직전(+3)·현재(−9) 모두 벽 안 = 끼임. 인자 없이는 −92(관통), 끼임 규칙이면 +92.
    const pinned = slideCircleWalls(0, -9, 32, walls, 0, 3, {
      axis: SCROLL_AXIS_VERTICAL,
      dir: -1,
    });
    expect(pinned.y).toBe(92);
    // 깊이가 더 깊어져도 절대 먼 쪽으로 뱉지 않는다(관통 금지가 깊이와 무관하다).
    for (const cur of [-9, -40, -80, -91]) {
      const p = slideCircleWalls(0, cur, 32, walls, 0, cur + 12, {
        axis: SCROLL_AXIS_VERTICAL,
        dir: -1,
      });
      expect(p.y, `cur=${cur}`).toBe(92);
    }
  });

  it('창이 +X 로 전진하면(레이싱) 끼인 원을 −X 면으로 되민다', () => {
    const pinned = slideCircleWalls(9, 0, 32, walls, -3, 0, {
      axis: SCROLL_AXIS_HORIZONTAL,
      dir: 1,
    });
    expect(pinned.x).toBe(-92);
  });

  it('창 정보가 없으면 끼임이어도 기존 최소 침투 경로다 (창 없는 모드 불변)', () => {
    expect(slideCircleWalls(0, -9, 32, walls, 0, 3).y).toBe(-92);
  });

  it('모서리를 스친 끼임은 교차 축으로 비켜선다 — 창 축으로 통째로 되밀지 않는다', () => {
    // 레이싱 트랙 벽 실측 기하: 폭 1000(hw 500) · 반높이 90. 확장하면 532 × 122.
    const track = [wall(0, 0, 500, 90)];
    // 플레이어가 벽 **위 모서리**를 살짝 스쳤다(dy = 118, 침투 4). 창은 +X 로 전진.
    // 창 축(X)을 무조건 강제하면 −532 로 되밀려 뒤로 500유닛 넘게 순간이동한다. 최소 침투 축이
    // 교차 축(Y)이므로 위로 4유닛만 비켜서는 것이 옳다.
    const grazed = slideCircleWalls(0, 118, 32, track, 0, 116, {
      axis: SCROLL_AXIS_HORIZONTAL,
      dir: 1,
    });
    expect(grazed.y).toBe(122);
    expect(grazed.x).toBe(0);

    // 반대로 **정면**으로 막힌 끼임(최소 침투 축 = 창 축)은 창 축으로 되민다.
    const blocked = slideCircleWalls(-520, 0, 32, track, -528, 0, {
      axis: SCROLL_AXIS_HORIZONTAL,
      dir: 1,
    });
    expect(blocked.x).toBe(-532);
  });
});

describe('④ 정규 경로 회귀 — 블록격파에서 한 틱 순간이동이 사라진다', () => {
  const rear = INVASION_WINDOW_HALF_H - playerOf(createWorld(1234, blockBreakConfig())).radius;

  /** 무입력 정지 플레이어를 창 뒤 경계에 놓고 상대 좌표 궤적을 녹화한다. */
  function parkedRelTrace(ticks: number): { rel: number[]; hp: number } {
    const w = createWorld(1234, blockBreakConfig());
    playerOf(w).y = w.scrollRuntime!.scrollY + rear;
    const rel: number[] = [];
    for (let i = 0; i < ticks; i++) {
      stepWorld(w, idle);
      rel.push(playerOf(w).y - w.scrollRuntime!.scrollY);
    }
    return { rel, hp: playerOf(w).hp };
  }

  it('한 틱에 벽 두께만큼 순간이동하지 않는다 (실측 79유닛 → 소멸)', () => {
    const { rel } = parkedRelTrace(120);
    // 틱당 상대 변위의 최댓값. 결함 상태에서는 t=102 에 79 였다. 정지 플레이어의 정상 변위는
    // 창 클램프가 만드는 한 자릿수 수준이라 20 은 넉넉한 상한이다.
    let maxStep = 0;
    for (let i = 1; i < rel.length; i++) {
      const d = Math.abs(rel[i]! - rel[i - 1]!);
      if (d > maxStep) maxStep = d;
    }
    expect(maxStep, `틱당 최대 상대 변위 (궤적 앞부분: ${rel.slice(0, 6).join(',')})`).toBeLessThan(20);
  });

  it('뒤 경계를 넘어 뒤로 밀려나지도 않는다 (클램프가 최종 권위)', () => {
    const { rel } = parkedRelTrace(120);
    expect(Math.max(...rel)).toBe(rear);
  });

  it('압사 압박이 계속 돈다 — 관통을 막았을 뿐 압박을 없앤 게 아니다', () => {
    // 관통으로 탈출하지 못하니 압사 피해가 누적돼야 한다(즉사 아님 · iframes 존중).
    //
    // ⚠️ 관측 창은 240틱이다(120 → 240, 2026-07-27 앵커 정책 개정). 예전 120틱 안의 hp 감소는
    // 실은 **창 안에 남아 있던 적과의 접촉**이 큰 몫이었는데, 이제 적이 창과 함께 움직여
    // 정지한 플레이어에게서 서서히 멀어진다. 순수 압사(파괴가능 벽에 끼임)는 벽이 도달해야
    // 시작되고 이 시드에서는 그게 약 160틱이다(실측). 창을 넉넉히 잡아 **압사 자체**를 본다.
    const { hp } = parkedRelTrace(240);
    // ⚠️ 기준선은 **정본 최대 HP**다 — 리터럴 100 은 옛 `playerHp` 였고 2026-08-08 에 151 이
    //    되면서 «피해를 입었다» 와 «HP 가 100 미만» 이 갈렸다(실측 hp 145 = 6 만큼 압사 중인데
    //    빨갛게 떴다). 이 테스트가 재는 것은 «압사 피해가 0 이 아니다 · 즉사도 아니다» 이지
    //    절대 HP 값이 아니다.
    expect(hp).toBeLessThan(DEFAULT_CONFIG.playerHp);
    expect(hp).toBeGreaterThan(0);
  });
});
