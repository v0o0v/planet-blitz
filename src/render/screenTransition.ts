/**
 * 균일 화면 전환 프리미티브 — 슬라이드 커튼 (Phase 5 — plan §AC-5.1 · ADR-0031, meta 레지스터).
 *
 * 전 메타 화면 swap 을 **하나의 균일한 슬라이드 커튼**으로 덮는다. main.ts clearToMenu()
 * (동기 swap)가 {@link ScreenTransition.play} 를 부르면, 카툰나무 나무판(커튼)이 오른쪽에서
 * 밀려들어와 화면을 **덮고(cover)** 짧게 유지(hold)한 뒤 왼쪽으로 밀려나가며 **드러낸다
 * (reveal)** → 사용자는 old → 커튼 → new 를 본다(중간의 동기 swap 은 커튼 밑에서 일어난다).
 *
 * ── 정본 룩 = harness 갤러리 `transition-slide` ──────────────────────────────
 *  갤러리 원본([src/harness/gallery/transitionVariants.ts]`spawnSlide`)의 "B 가 오른쪽 → 제자리
 *  슬라이드 + 3차 ease" 를 프로덕션으로 이식한 것이다. 커튼은 셀 프리뷰가 아니라 **전체 디자인
 *  영역**([app.ts]`DESIGN_WIDTH`×`DESIGN_HEIGHT`)을 덮으므로 mask 없이 컨테이너 통짜 이동으로 구현.
 *
 * ── ⚠️ 왜 easeInOutCubic 을 여기 자체 포함(inline)했나 ────────────────────────
 *  갤러리 코드는 harness/ 아래라 **DEV 전용(프로덕션 번들에서 트리셰이킹)** 이다. 프로덕션인 이
 *  파일이 거기서 import 하면 DEV 코드가 프로덕션 번들에 딸려온다. 그래서 진행 이징을 이 파일에
 *  자체 포함한다(shaderEffects 가 progress 를 자체 포함한 선례와 동형). 갤러리 사본은 그대로 둔다.
 *
 * ── 시각 레지스터 = meta(카툰나무풍) — 넘을 수 없는 계약 ③ ─────────────────────
 *  따뜻한 브라운/그린/크림 나무 톤만 쓴다. 전투 SF 네온 글로우·블룸은 차용하지 않는다. 이건
 *  셰이더가 아니라 **Graphics 오버레이 애니메이션**(절차적 나무판 슬라이드)이다.
 *
 * ── 계약(넘을 수 없음) ────────────────────────────────────────────────────────
 *  - **render-only**: `src/sim/` 무접촉. 결정론(hashWorld/hashEntity)과 무관하다.
 *  - **node 안전**: 절차적 Graphics 라 GL 없이 생성자에서 색판을 동기 생성 → `container.children>0`
 *    (tests/galleryWiring 배선 스모크 근거). `Date`/`Math.random` 미사용.
 *
 * ── 밸런스 유예(defer-balance-tuning) ── cover/hold/reveal 타이밍·팔레트·트림 폭은 전부
 *    placeholder 다. 실제 값은 구현 완료 후 출시 직전 일괄 조정한다(2026-07-22 지시).
 */

import { Container, Graphics } from 'pixi.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from './app.js';

// ---------------------------------------------------------------------------
// 카툰나무풍 팔레트 (전부 기존 메타 UI 실사용 색 + 조화 그린/골드)
//   transitionVariants.ts WOOD 톤과 동일 계열. 커튼은 나무문(sliding door)처럼 읽히게
//   따뜻한 중간 브라운을 바탕으로, 크림 프레임 · 골드 리딩 트림으로 카툰 결을 준다.
// ---------------------------------------------------------------------------
const WOOD = {
  /** 바탕 나무판(따뜻한 중간 브라운) — 커튼 본체. */
  base: 0x6b4a2a,
  /** 판재 홈(어두운 결). */
  groove: 0x3a2a1a,
  /** 판재 하이라이트(밝은 결). */
  highlight: 0xc9b58a,
  /** 크림 외곽 프레임. */
  cream: 0xebdcbe,
  /** 골드 리딩/트레일링 트림(슬라이드 엣지 강조). */
  gold: 0xffd678,
} as const;

// ---------------------------------------------------------------------------
// 전환 타이밍 (placeholder · defer-balance-tuning)
//   왕복이 아니라 원샷 cover → hold → reveal 3구간. 총 ≈ 0.50s.
// ---------------------------------------------------------------------------
/** 오른쪽에서 밀려들어와 완전히 덮기까지(초). */
const COVER_SECONDS = 0.22;
/** 완전히 덮은 채 유지(초) — 이 구간에 lead 가 동기 swap 을 넣는다. */
const HOLD_SECONDS = 0.06;
/** 왼쪽으로 밀려나가며 드러내기까지(초). */
const REVEAL_SECONDS = 0.22;
/** 전체 전환 길이(초). elapsed 가 이 값에 도달하면 원샷 종료. */
const TOTAL_SECONDS = COVER_SECONDS + HOLD_SECONDS + REVEAL_SECONDS;

/** 프레임 델타 상한(초) — 탭 복귀 등 큰 dt 가 한 스텝에 cover 를 건너뛰지 않게 클램프. */
const MAX_DT = 0.1;

/**
 * 레터박스 서브픽셀 갭 방어용 오버스캔(디자인 px). 나무판을 디자인 영역보다 약간 크게 그려,
 * 완전 덮힘(cover 정점)에서 가장자리에 old 화면이 새는 일이 없게 한다.
 */
const OVERSCAN = 32;

/** 슬라이드 엣지 골드 트림 폭(디자인 px). */
const TRIM_WIDTH = 26;

// ---------------------------------------------------------------------------
// 자체 포함 순수 진행 함수 (DEV 갤러리에서 import 하지 않으려고 inline)
// ---------------------------------------------------------------------------

/** [0,1] 로 clamp. */
function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * 3차 ease-in-out. 경계 고정(f(0)=0, f(1)=1)·단조 증가·[0,1]→[0,1]. 범위 밖·NaN 입력은
 * clamp01/유한성 검사로 흡수(NaN → 0 폴백). 갤러리 `easeInOutCubic` 과 수치적으로 동일.
 */
export function easeInOutCubic(t: number): number {
  const c = Number.isFinite(t) ? clamp01(t) : 0;
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

/**
 * 경과 시간(초) → 커튼 컨테이너의 X 오프셋(디자인 px). 슬라이드는 좌향 일관 이동이다:
 *   · cover  : +DESIGN_WIDTH → 0   (오른쪽 밖 → 제자리, 화면을 덮어감)
 *   · hold   : 0                    (완전히 덮은 채 정지)
 *   · reveal : 0 → -DESIGN_WIDTH    (제자리 → 왼쪽 밖, 새 화면을 드러냄)
 * ease 는 cover/reveal 스윕 구간에만 적용(hold 는 평평). elapsed<0·NaN 방어.
 */
function curtainOffsetX(elapsed: number): number {
  const e = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  if (e < COVER_SECONDS) {
    // 오른쪽 밖(W) → 제자리(0).
    return DESIGN_WIDTH * (1 - easeInOutCubic(e / COVER_SECONDS));
  }
  if (e < COVER_SECONDS + HOLD_SECONDS) {
    return 0; // 완전 덮힘.
  }
  // 제자리(0) → 왼쪽 밖(-W). easeInOutCubic 이 t>1 을 1 로 clamp 하므로 종료 후엔 -W.
  const rt = (e - COVER_SECONDS - HOLD_SECONDS) / REVEAL_SECONDS;
  return -DESIGN_WIDTH * easeInOutCubic(rt);
}

/**
 * 주어진 컨테이너 X 에서 나무판이 디자인 가로 영역 [0,DESIGN_WIDTH] 를 덮는 비율 [0,1].
 * 1 = 완전 덮힘(cover 정점/hold), 0 = 완전히 벗어남. 테스트·관측용.
 */
function coverageAt(containerX: number): number {
  const panelLeft = containerX - OVERSCAN;
  const panelRight = containerX + DESIGN_WIDTH + OVERSCAN;
  const covered = Math.min(panelRight, DESIGN_WIDTH) - Math.max(panelLeft, 0);
  return clamp01(covered / DESIGN_WIDTH);
}

// ---------------------------------------------------------------------------
// ScreenTransition — 전 메타 화면 swap 을 균일하게 덮는 슬라이드 커튼.
//
// lead 배선(단일 레인): stage 최상단에 container 를 mount, 매 프레임 raise() +
// update(dt). clearToMenu() 가 play(onCovered) 를 부르고 onCovered 콜백에서 동기 swap 을
// 수행하면 old→커튼→new 시퀀스가 완성된다(swap 이 hold 구간의 완전 덮힘 밑에서 일어남).
// ---------------------------------------------------------------------------

export class ScreenTransition {
  /**
   * 커튼 오버레이 컨테이너. lead 가 stage 최상단에 addChild 하고 매 프레임 raise() 한다.
   * 색판(Graphics)은 생성자에서 동기 생성되어 미재생 시에도 `children.length > 0`(단, 미재생·
   * 종료 시 `visible=false` 로 화면 밖에 숨는다).
   */
  readonly container: Container = new Container();

  /** play() 이후 누적 경과(초). */
  private elapsed = 0;
  /** 재생 중 여부. */
  private playing = false;
  /** cover 정점(완전 덮힘) 도달 시 1회 발화되는 onCovered 발화 여부. */
  private coveredFired = false;
  /** 이번 재생의 onCovered 콜백(lead 동기 swap 훅). 없으면 null. */
  private onCovered: (() => void) | null = null;
  /** 이중 destroy 방어. */
  private destroyed = false;

  constructor() {
    this.buildCurtain();
    // 미재생 초기 상태 — 화면 밖(오른쪽) + invisible.
    this.container.x = DESIGN_WIDTH;
    this.container.y = 0;
    this.container.visible = false;
  }

  /**
   * 전환을 1회 트리거한다. clearToMenu 가 여러 초크포인트에서 불릴 수 있으므로 **멱등·재진입
   * 안전**하다 — 이미 재생 중이어도 색판을 중복 생성하지 않고 **처음부터 재시작**한다(elapsed·
   * onCovered 발화 플래그 리셋). 커튼은 생성자에서 한 번만 만들어 재사용하므로 child 증가 없음.
   *
   * @param onCovered (선택) cover 정점(완전 덮힘)에 **정확히 1회** 호출되는 콜백. lead 가 여기서
   *   동기 화면 swap 을 수행하면 swap 이 커튼 밑에서 일어나 old→커튼→new 가 또렷해진다. 미지정
   *   시 커튼만 재생한다. ⚠️ 이 콜백 안에서 다시 play() 를 부르지 말 것(재귀 재시작 유발).
   */
  play(onCovered?: () => void): void {
    if (this.destroyed) return;
    this.elapsed = 0;
    this.playing = true;
    this.coveredFired = false;
    this.onCovered = onCovered ?? null;
    this.container.visible = true;
    // 시작 프레임 = cover 직전(오른쪽 밖).
    this.container.x = curtainOffsetX(0);
  }

  /**
   * 커튼을 cover→hold→reveal 로 진행한다. 벽시계 dt(초). 비재생·파괴 상태면 no-op.
   * 전환이 끝나면(elapsed≥TOTAL) 재생을 멈추고 커튼을 화면 밖으로 파킹 + invisible.
   */
  update(dt: number): void {
    if (this.destroyed || !this.playing) return;
    const d = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, MAX_DT));
    this.elapsed += d;

    if (this.elapsed >= TOTAL_SECONDS) {
      // 원샷 종료 — cover 를 못 밟고 끝난 예외 경우에도 onCovered 는 보장 발화(방어).
      this.fireCoveredOnce();
      this.playing = false;
      this.container.visible = false;
      this.container.x = DESIGN_WIDTH; // 다음 play 를 위한 파킹(오른쪽 밖).
      return;
    }

    this.container.x = curtainOffsetX(this.elapsed);
    if (this.elapsed >= COVER_SECONDS) this.fireCoveredOnce();
  }

  /** 재생 중 여부(테스트·raise 판단용 관측창). */
  get active(): boolean {
    return this.playing;
  }

  /**
   * 나무판이 디자인 가로 영역을 덮는 비율 [0,1]. 1=완전 덮힘(cover 정점/hold). 파괴 후 0.
   * 테스트가 타이밍 상수를 모르고도 "cover 정점에서 실제로 덮는지" 를 관측할 수 있게 한다.
   */
  get coverage(): number {
    if (this.destroyed) return 0;
    return coverageAt(this.container.x);
  }

  /** 즉시 정리 — container 서브트리를 통째 파괴하고 부모에서 분리한다. 이중 호출 안전. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.playing = false;
    this.onCovered = null;
    this.container.destroy({ children: true });
  }

  /** onCovered 를 (설정돼 있으면) 이번 재생에서 정확히 1회만 호출한다. */
  private fireCoveredOnce(): void {
    if (this.coveredFired) return;
    this.coveredFired = true;
    const cb = this.onCovered;
    if (cb) cb();
  }

  /**
   * 절차적 카툰나무 색판을 동기 생성해 container 에 붙인다(children===1). 통짜 Graphics 라
   * GL 없이 성립. 좌표는 디자인 영역 기준이며 OVERSCAN 만큼 사방으로 넉넉히 그린다.
   */
  private buildCurtain(): void {
    const W = DESIGN_WIDTH;
    const H = DESIGN_HEIGHT;
    const M = OVERSCAN;
    const g = new Graphics();

    // 1. 바탕 나무판(불투명) — 완전 덮힘을 보장하는 실체. OVERSCAN 만큼 오버사이즈.
    g.rect(-M, -M, W + 2 * M, H + 2 * M).fill({ color: WOOD.base, alpha: 1 });

    // 2. 가로 판재 결 — 홈(어두움) + 하이라이트(밝음) 교대로 카툰 나무 질감.
    const planks = 6;
    for (let i = 1; i < planks; i++) {
      const y = (H / planks) * i;
      g.rect(0, y - 3, W, 3).fill({ color: WOOD.groove, alpha: 0.55 });
      g.rect(0, y, W, 2).fill({ color: WOOD.highlight, alpha: 0.35 });
    }

    // 3. 크림 외곽 2겹 프레임(카툰나무 결) — nineSlicePanel 코드 프레임과 동형.
    g.rect(0, 0, W, H).stroke({ color: WOOD.cream, width: 18, alignment: 1 });
    g.rect(12, 12, W - 24, H - 24).stroke({ color: WOOD.groove, width: 6, alignment: 1 });

    // 4. 좌·우 세로 골드 트림 — 슬라이드 시 리딩/트레일링 엣지가 밝게 쓸리는 카툰 느낌.
    g.rect(-M, -M, TRIM_WIDTH, H + 2 * M).fill({ color: WOOD.gold, alpha: 0.9 });
    g.rect(W - TRIM_WIDTH, -M, TRIM_WIDTH + M, H + 2 * M).fill({ color: WOOD.gold, alpha: 0.9 });

    this.container.addChild(g);
  }
}
