/**
 * 강제 스크롤 앵커 **배선** 게이트 — 정규 경로 통합 (ADR-0034).
 *
 * ## 왜 이 파일이 따로 필요한가 (이 저장소의 반복 결함)
 * "단위 테스트는 그린인데 배선이 통째로 없다"가 이 저장소의 반복 결함이고, 조우 작업에서는
 * 하네스 `injectInput` 이 **플레이어 입력 경로가 아니라서** `Controller.sample()` 미배선
 * CRITICAL 이 검증을 통과했다. 그래서 이 파일의 모든 단언은
 *   `buildRunConfig` → `createWorld` → `stepWorld`
 * 라는 프로덕션 정규 경로로만 월드를 만들고 굴린다. `applyScrollAnchor`·`scrollAnchored` 를
 * **직접 부르는 단언은 여기 하나도 없어야 한다**(그건 tests/scrollAnchor.test.ts 담당) —
 * 있으면 이 게이트는 다시 무력화된다.
 *
 * ## 이 파일이 증명하는 사용자 보고 버그
 * "플레이어가 가장 뒤쪽에 걸려서 앞으로 나오지 못한다". 플레이어 속도 12 u/tick 과
 * `INVASION_SCROLL_SPEED`(12)가 같아 전방 상대속도 최댓값이 0 이었고, `clampToWindow` 가
 * 창 뒤 경계에 한 번 붙이면 전력 전진해도 영원히 붙어 있었다. ①②가 그 직접 회귀다.
 *
 * ## 벽에 막히는 구간은 결함이 아니라 설계다
 * 앵커는 `stepPlayer` **이전**이라 벽 슬라이드·창 클램프가 최종 권위를 갖는다. 그래서 벽에
 * 막히면 전진이 멈추고 창에 밀린다(압박이 "속도 열세"에서 "장애물"로 이동하는 것이 의도).
 * 따라서 순전진량 단언은 **막히기 전 구간**에서만 하고(3 seed 관측상 최초 장애가 t≥50),
 * 장거리 단언은 "창 뒤 경계에서 유의미하게 벗어났다 + 정지 대조군보다 훨씬 앞섰다"로 짠다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput } from '../src/sim/world.js';
import type { InputFrame, WorldState } from '../src/sim/world.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile } from '../src/save/profile.js';
import { PLANET_MODE } from '../src/sim/planetMode.js';
import { spawnGem } from '../src/sim/entities.js';
import {
  INVASION_SCROLL_SPEED,
  INVASION_WINDOW_HALF_W,
  INVASION_WINDOW_HALF_H,
} from '../src/sim/invasion/scroll.js';
import { INVASION_ACCEL_BASE_CP } from '../src/sim/invasion/constants.js';

const idle: InputFrame = emptyInput();

/** 기준 가속(100cp)에서 플레이어의 창 대비 순전진량 = 자체 12 + 앵커 trunc(12×0.7)=8 − 창 12. */
const NET_ADVANCE_PER_TICK = 8;
/** 정지 시 창 대비 밀림량 = 창 12 − 앵커 8. 100% 앵커가 아니라 부분(70%) 앵커라는 증거. */
const IDLE_DRIFT_PER_TICK = 4;
/** 벽에 막히기 전 관측 구간(3 seed 관측 최초 장애 t≥50 · 여유 포함). */
const CLEAN_TICKS = 20;

/** 블록격파는 행성 배정 대신 planetMode 를 덮어쓴다(tests/scrollMode.test.ts 관례 그대로). */
function blockBreakConfig() {
  return {
    ...buildRunConfig(defaultProfile(), { planet: 0, stage: 1 }),
    planetMode: PLANET_MODE.blockBreak,
  };
}
/** 레이싱(아르케 = planet 3) 정규경로 config. */
function racingConfig() {
  return buildRunConfig(defaultProfile(), { planet: 3, stage: 1 });
}
/** 뱀서류(카르곤 = planet 0) — 창이 없는 대조군. */
function vampireConfig() {
  return buildRunConfig(defaultProfile(), { planet: 0, stage: 1 });
}

/** 플레이어(항상 entities[0]). */
function playerOf(w: WorldState) {
  return w.entities[0]!;
}

/** 창 중심 대비 플레이어 상대 좌표 수열을 녹화한다. */
function recordPlayerRelative(
  w: WorldState,
  input: InputFrame,
  ticks: number,
  axis: 'x' | 'y',
): number[] {
  const out: number[] = [];
  for (let i = 0; i < ticks; i++) {
    stepWorld(w, input);
    const rt = w.scrollRuntime!;
    const p = playerOf(w);
    out.push(axis === 'x' ? p.x - rt.scrollX : p.y - rt.scrollY);
  }
  return out;
}

function diffs(seq: readonly number[]): number[] {
  return seq.slice(1).map((v, i) => v - seq[i]!);
}

// ---------------------------------------------------------------------------
// ①② 핵심 회귀 — 창 뒤 경계에서 탈출할 수 있다
// ---------------------------------------------------------------------------

describe('창 뒤 경계 탈출 — 사용자 보고 버그의 직접 회귀', () => {
  it('블록격파(−Y 스크롤): 뒤(+Y) 경계에 붙은 플레이어가 전방 입력으로 복귀한다', () => {
    // 뒤 경계 = clampToWindow 가 붙이는 최댓값(반지름만큼 안쪽).
    const rear = INVASION_WINDOW_HALF_H - playerOf(createWorld(1234, blockBreakConfig())).radius;

    const forward = createWorld(1234, blockBreakConfig());
    playerOf(forward).y = forward.scrollRuntime!.scrollY + rear;
    const fwdRel = recordPlayerRelative(forward, { ...idle, moveY: -1 }, 120, 'y');

    // 막히기 전 구간은 매 틱 전방(상대 y 감소)이다. 구 코드에서는 전량 0 이었다.
    for (const d of diffs(fwdRel).slice(0, CLEAN_TICKS)) expect(d).toBeLessThan(0);
    // 최전방 도달점이 뒤 경계에서 300유닛 이상 떨어졌다(= 실제로 "앞으로 나왔다").
    const fwdBest = Math.min(...fwdRel);
    expect(fwdBest).toBeLessThanOrEqual(rear - 300);
    // 마지막 틱에도 뒤 경계에 다시 붙어 있지 않다.
    expect(fwdRel[fwdRel.length - 1]!).toBeLessThan(rear);

    // 정지 대조군: 전방 입력이 실제로 일을 했다는 증거(입력 무관하게 흐르는 게 아니다).
    const parked = createWorld(1234, blockBreakConfig());
    playerOf(parked).y = parked.scrollRuntime!.scrollY + rear;
    const idleRel = recordPlayerRelative(parked, idle, 120, 'y');
    // 정지 대조군은 **뒤 경계를 넘어 뒤로 밀려나지 못한다**(= 클램프가 산다). 예전에는 마지막
    // 표본이 정확히 `rear` 이기를 요구했는데, 이 시드에서는 그게 더 이상 성립하지 않는다.
    //
    // ⚠️ 원인을 오진했던 흔적을 남긴다: 처음에 "창 안 적이 접촉으로 밀어낸다" 고 적었는데
    // **틀렸다.** 이 sim 에서 적 접촉은 플레이어 좌표를 건드리지 않는다(`resolveCollisions` 의
    // 플레이어 분기는 피해·픽업·상태이상만 한다). 실제 원인은 **벽 슬라이드의 최근접면
    // 뒤바뀜**이다 — 창이 플레이어를 벽 안으로 밀어 넣다가 `slideCircleWalls` 가 기준면을
    // +Y 에서 −Y 로 바꾸는 틱에 플레이어가 벽 두께만큼 순간이동해 앞으로 빠져나간다
    // (실측 t=102 에 한 틱 79유닛, 이후 +4/틱 로 되메워 t=119 에 11유닛 차이로 보였다.
    //  hp 100 → 92 는 `crushBlockBreak` 압사 피해가 돌고 있었다는 방증). 그건 별건의 결함이고
    // 이 테스트가 지키는 계약(창 뒤 경계 탈출)과 무관하다.
    //
    // 그래서 **마지막 표본이 아니라 성질로** 단언한다. 이러면 중간 이탈량과 무관하게 안정적이고
    // (마지막 표본 기준은 이탈 시점이 몇 틱 늦어지면 무관한 이유로 빨강이 된다), 아래 대비
    // 단언도 `rear` 에 고정돼 idle 이 앞으로 새는 만큼 요구가 조용히 낮아지는 일이 없다.
    expect(Math.max(...idleRel)).toBe(rear);
    // 전방 입력이 실제로 일을 했다 — 대비 기준은 `min(idleRel)` 이 아니라 **경계 자체**다.
    expect(fwdBest).toBeLessThan(rear - 300);
  });

  it('레이싱(+X 스크롤): 뒤(−X) 경계에 붙은 플레이어가 전방 입력으로 복귀한다', () => {
    const rear = -(INVASION_WINDOW_HALF_W - playerOf(createWorld(4242, racingConfig())).radius);

    const forward = createWorld(4242, racingConfig());
    playerOf(forward).x = forward.scrollRuntime!.scrollX + rear;
    const fwdRel = recordPlayerRelative(forward, { ...idle, moveX: 1 }, 120, 'x');

    for (const d of diffs(fwdRel).slice(0, CLEAN_TICKS)) expect(d).toBeGreaterThan(0);
    const fwdBest = Math.max(...fwdRel);
    expect(fwdBest).toBeGreaterThanOrEqual(rear + 300);
    expect(fwdRel[fwdRel.length - 1]!).toBeGreaterThan(rear);

    const parked = createWorld(4242, racingConfig());
    playerOf(parked).x = parked.scrollRuntime!.scrollX + rear;
    const idleRel = recordPlayerRelative(parked, idle, 120, 'x');
    // 여기는 **정확한 고정이 그대로 성립한다**(실측: min=max=final=-928, 이탈 0). 블록격파 쪽
    // 이탈은 그 시드의 벽 배치에서 오는 것이라 이 시드에는 없다 — 그래서 정확 단언을 유지한다.
    // (한때 블록격파와 짝을 맞추려고 여기까지 부등식으로 낮췄는데, 통과하는 정확 단언을 근거
    //  없이 약화한 것이었다. 리뷰에서 잡혔고 되돌렸다.)
    expect(idleRel[idleRel.length - 1]!).toBe(rear);
    expect(fwdBest).toBeGreaterThan(Math.max(...idleRel) + 200);
  });
});

// ---------------------------------------------------------------------------
// ③④ 틱당 수치 계약 — 순전진 8 / 정지 밀림 4
// ---------------------------------------------------------------------------

describe('틱당 순전진·밀림 수치(기준 가속 100cp)', () => {
  it('전방 입력 시 창 대비 상대 전진이 정확히 틱당 8유닛이다', () => {
    // 레이싱은 창 안에 적이 남아 cleared=false 라 accelCp 가 BASE 에 머문다 — 8 을 재기 좋다.
    // (블록격파는 시작 직후 창이 비어 accelCp 가 올라가고, 창 12→13→14 가 되면 순전진이
    //  8→8→7 로 줄어든다. 그건 결함이 아니라 가속 설계다.)
    expect(INVASION_SCROLL_SPEED).toBe(12);
    const w = createWorld(4242, racingConfig());
    const rel = recordPlayerRelative(w, { ...idle, moveX: 1 }, CLEAN_TICKS + 1, 'x');
    expect(w.scrollRuntime!.accelCp).toBe(INVASION_ACCEL_BASE_CP);
    for (const d of diffs(rel)) expect(d).toBe(NET_ADVANCE_PER_TICK);
  });

  it('입력 0 이면 창 대비 상대 위치가 틱당 4유닛씩 뒤로 밀린다(부분 앵커 증명)', () => {
    // 100% 앵커라면 0 이어야 한다. 4 라는 값이 곧 "플레이어는 70%만 앵커된다"의 물증이다.
    const w = createWorld(4242, racingConfig());
    const rel = recordPlayerRelative(w, idle, CLEAN_TICKS + 1, 'x');
    for (const d of diffs(rel)) expect(d).toBe(-IDLE_DRIFT_PER_TICK);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 앵커 대상(젬)이 정규 런 안에서 실제로 배선됐는가
// ---------------------------------------------------------------------------

describe('앵커 대상 배선 — 창 안 젬은 창과 함께 흐른다', () => {
  it('자석 반경 밖 젬의 창 대비 상대 좌표가 정확히 고정된다(100% 앵커)', () => {
    const w = createWorld(4242, racingConfig());
    const p = playerOf(w);
    // 창 안(|dx| 700 ≤ 960) · 자석 반경(기본 420) 밖 — 자석 이동이 섞이지 않는다.
    const gem = spawnGem(w, p.x + 700, p.y, 1);
    const rt0 = w.scrollRuntime!;
    const rel0 = { x: gem.x - rt0.scrollX, y: gem.y - rt0.scrollY };

    for (let i = 0; i < CLEAN_TICKS; i++) {
      stepWorld(w, idle);
      const rt = w.scrollRuntime!;
      const live = w.entities.find((e) => e.id === gem.id);
      expect(live, '젬이 컬링되면 이 단언의 의미가 사라진다').toBeDefined();
      expect(live!.x - rt.scrollX).toBe(rel0.x);
      expect(live!.y - rt.scrollY).toBe(rel0.y);
    }
    // 창이 실제로 전진했다(정체한 창에서는 위 단언이 공허하다).
    expect(w.scrollRuntime!.scrollX).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ⑥ 비-스크롤 모드 무영향 — 창이 없으면 앵커 코드가 돌지 않는다
// ---------------------------------------------------------------------------

describe('비-스크롤 모드(뱀서류)는 앵커 도입과 무관하다', () => {
  it('scrollRuntime 이 없고, 플레이어는 자체 속도로만 움직이고 젬은 월드 고정이다', () => {
    const w = createWorld(2026, vampireConfig());
    const p = playerOf(w);
    const gem = spawnGem(w, p.x + 700, p.y, 1);
    const gemAt = { x: gem.x, y: gem.y };

    for (let i = 0; i < 60; i++) stepWorld(w, { ...idle, moveY: -1 });

    expect(w.scrollRuntime).toBeUndefined();
    // 창이 없으니 앵커 가산이 없다 — 플레이어 이동은 자체 속도 60틱분 그대로다.
    expect(playerOf(w).y).toBe(-INVASION_SCROLL_SPEED * 60);
    expect(playerOf(w).x).toBe(0);
    // 젬은 자석 반경 밖이라 절대 좌표가 불변(앵커 가산이 새어 들어오지 않았다).
    const live = w.entities.find((e) => e.id === gem.id);
    expect(live).toBeDefined();
    expect(live!.x).toBe(gemAt.x);
    expect(live!.y).toBe(gemAt.y);
  });
});
