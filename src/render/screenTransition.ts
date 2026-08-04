/**
 * 균일 화면 전환 프리미티브 — 슬라이드 커튼 (Phase 5 — plan §AC-5.1 · ADR-0031, meta 레지스터).
 *
 * 전 메타 화면 swap 에 **하나의 균일한 슬라이드 커튼**을 얹는다. main.ts clearToMenu() 가
 * {@link ScreenTransition.play} 를 부르면, 카툰나무 나무판(커튼)이 오른쪽에서 밀려들어와 화면을
 * **덮고(cover)** 짧게 유지(hold)한 뒤 왼쪽으로 밀려나가며 **드러낸다(reveal)**.
 *
 * ── ⚠️ 실제 배선 거동(오해 방지) ────────────────────────────────────────────────
 *  clearToMenu 의 화면 teardown 과 **호출자의 새 화면 show() 는 같은 프레임에 동기로 완결**되므로
 *  swap 은 원자적이다(끊김·플래시 없음). 커튼은 그 swap 을 은닉하는 게 아니라, 이미 바뀐 **새 화면
 *  위를 카툰 나무결로 한 번 쓸어 전환을 읽히게 하는 장식 와이프**다(균일 적용이 목적). 실사용은
 *  {@link ScreenTransition.play} 를 콜백 없이 부른다. {@link ScreenTransition.play} 의 `onCovered`
 *  훅(cover 정점 발화)은 훗날 "커튼 밑에서 swap 을 은닉"하는 old→커튼→new 확장을 위해 구현·유닛
 *  검증만 해 둔 것이고 **현재 프로덕션은 쓰지 않는다**(그 은닉은 호출자 show() 까지 커튼 밑으로
 *  옮기는 리팩터가 필요해 defer-balance-tuning 이후 별도 검토 대상).
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
 * ── 시각 레지스터 = 시네마틱 키아트 (2026-08-04 사용자 지시로 전환) ───────────────
 *  예전엔 카툰나무 색판이었다. 그런데 타이틀·인트로·기지가 전부 풀블리드 키아트로 올라간 뒤
 *  (PR#236·#240·#245) **화면 전환만 밋밋한 노란 나무판**으로 남아, 전환할 때마다 게임이 한
 *  단계 아래로 내려갔다 보인다는 판정이 나왔다. 그래서 커튼 면을 **타이틀 하늘 키아트**
 *  ({@link CURTAIN_ART})로 갈아끼운다 — 이미 게임 안에 있는 붓이라 새 자산을 요구하지 않고,
 *  전환이 "화면과 화면 사이의 우주"로 읽힌다.
 *
 *  자산은 **비동기로 얹는다**: 생성자는 여전히 절차적 색판을 동기로 세우고(아래 node 계약),
 *  로드가 끝나면 그 위에 스프라이트를 덮는다. 로드가 실패해도 커튼은 그대로 화면을 덮는다 —
 *  자산은 덧붙임이지 전제가 아니다(리포 공통 규율).
 *
 * ── 계약(넘을 수 없음) ────────────────────────────────────────────────────────
 *  - **render-only**: `src/sim/` 무접촉. 결정론(hashWorld/hashEntity)과 무관하다.
 *  - **node 안전**: 절차적 Graphics 라 GL 없이 생성자에서 색판을 동기 생성 → `container.children>0`
 *    (tests/galleryWiring 배선 스모크 근거). `Date`/`Math.random` 미사용. 자산 로드는 실패가
 *    기본값인 경로라 node 에서도 조용히 지나간다.
 *
 * ── 밸런스 유예(defer-balance-tuning) ── cover/hold/reveal 타이밍·팔레트·트림 폭은 전부
 *    placeholder 다. 실제 값은 구현 완료 후 출시 직전 일괄 조정한다(2026-07-22 지시).
 */

import { Assets, Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from './app.js';
import { titleAssetUrl } from '../ui/pixi/titleTextures.js';

// ---------------------------------------------------------------------------
// 시네마틱 팔레트
//   커튼 면은 키아트 스프라이트가 맡고, 여기 색들은 ①자산 로드 전·실패 시의 폴백 바탕
//   ②자산 위에 얹는 비네트·리딩 엣지 역할만 한다. 톤은 타이틀 하늘(짙은 남보라 + 금)과 맞춘다.
// ---------------------------------------------------------------------------
const INK = {
  /** 폴백 바탕(짙은 청록 — {@link CURTAIN_ART} 성운의 그늘색). 자산이 없어도 확실히 덮는 실체. */
  base: 0x0b171c,
  /** 폴백 바탕 하단(더 깊은 잉크) — 세로 램프로 평면을 깬다. */
  deep: 0x050a0d,
  /** 좌우 비네트 — 슬라이드 중 커튼이 화면과 섞이지 않게 가장자리를 눌러 준다. */
  vignette: 0x000000,
  /** 리딩/트레일링 엣지의 금빛 — 슬라이드 방향을 읽히게 하는 유일한 밝은 요소. */
  gold: 0xffd678,
} as const;

/**
 * 커튼 면에 쓰는 키아트. **타이틀 하늘 레이어를 재사용한다** — 새 자산을 만들지 않으면서
 * 게임 안에 이미 있는 붓을 쓰는 유일한 선택지고, 1376×768 풀블리드라 커튼(1920×1080)에
 * cover-fit 으로 늘려도 구도가 성립한다.
 */
const CURTAIN_ART = 'title_sky.webp';

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
// update(dt). 현재 clearToMenu() 는 play() 를 **콜백 없이** 불러 새 화면 위 장식 와이프로 쓴다(swap
// 은 clearToMenu+호출자 show 동기 완결이라 원자적). onCovered 로 커튼 밑 swap 은닉(old→커튼→new)을
// 하려면 호출자 show() 까지 콜백 안으로 옮기는 리팩터가 필요하다 — 훅만 준비돼 있고 미사용이다.
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
   * @param onCovered (선택·**현재 프로덕션 미사용**) cover 정점(완전 덮힘)에 **정확히 1회** 호출되는
   *   콜백. lead 가 여기서 동기 화면 swap 을 수행하면 swap 이 커튼 밑에서 일어나 old→커튼→new 은닉이
   *   된다 — 다만 현 clearToMenu 는 콜백 없이 부른다(장식 와이프). 훗날 은닉 확장을 위한 훅으로
   *   구현·유닛 검증만 해 둔 상태다. 미지정 시 커튼만 재생한다. ⚠️ 이 콜백 안에서 다시 play() 를
   *   부르지 말 것(재귀 재시작 유발).
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
   * 불투명 폴백 색판을 **동기로** 세워 container 에 붙이고(children≥1 — node 계약), 이어서
   * 키아트를 비동기로 얹는다. 통짜 Graphics 라 GL 없이 성립하고, 좌표는 디자인 영역 기준이며
   * OVERSCAN 만큼 사방으로 넉넉히 그린다(레터박스 서브픽셀 갭 방어).
   *
   * 레이어 순서(뒤 → 앞): 폴백 잉크 램프 → 키아트 스프라이트(로드 후) → 비네트·엣지 크롬.
   * 크롬을 **먼저 만들어 두고** 스프라이트를 그 아래에 끼워 넣으므로(`addChildAt`), 자산이
   * 늦게 와도 위아래가 뒤집히지 않는다.
   */
  private buildCurtain(): void {
    const W = DESIGN_WIDTH;
    const H = DESIGN_HEIGHT;
    const M = OVERSCAN;

    // 1. 폴백 바탕(불투명) — 완전 덮힘을 보장하는 실체. 자산이 없어도 이것만으로 성립한다.
    //    단색 사각이 아니라 위→아래 2단 램프라, 자산 실패 시에도 평면 판때기로 읽히지 않는다.
    const base = new Graphics();
    base.rect(-M, -M, W + 2 * M, H + 2 * M).fill({ color: INK.base, alpha: 1 });
    base.rect(-M, H * 0.55, W + 2 * M, H * 0.45 + M).fill({ color: INK.deep, alpha: 0.85 });
    this.container.addChild(base);

    // 2. 크롬 — 좌우 비네트 + 리딩/트레일링 금빛 엣지. 자산 위에 얹혀야 하므로 먼저 붙인다.
    const chrome = new Graphics();
    // 좌우 비네트: 커튼 가장자리를 눌러 슬라이드 중 배경과 섞이지 않게 한다.
    const vw = Math.round(W * 0.16);
    for (let i = 0; i < 8; i++) {
      const a = 0.5 * (1 - i / 8) ** 1.6;
      const step = vw / 8;
      chrome.rect(-M + i * step, -M, step, H + 2 * M).fill({ color: INK.vignette, alpha: a });
      chrome
        .rect(W - (i + 1) * step, -M, step + (i === 0 ? M : 0), H + 2 * M)
        .fill({ color: INK.vignette, alpha: a });
    }
    // 슬라이드 엣지 — 얇은 금빛 립 + 그 안쪽으로 사라지는 광휘. 두꺼운 트림 대신 얇게 간다.
    chrome.rect(-M, -M, 3, H + 2 * M).fill({ color: INK.gold, alpha: 0.85 });
    chrome.rect(W - 3, -M, 3 + M, H + 2 * M).fill({ color: INK.gold, alpha: 0.85 });
    for (let i = 1; i <= 5; i++) {
      const a = 0.16 * (1 - i / 5);
      chrome.rect(3 + (i - 1) * (TRIM_WIDTH / 5), -M, TRIM_WIDTH / 5, H + 2 * M).fill({
        color: INK.gold,
        alpha: a,
      });
      chrome.rect(W - 3 - i * (TRIM_WIDTH / 5), -M, TRIM_WIDTH / 5, H + 2 * M).fill({
        color: INK.gold,
        alpha: a,
      });
    }
    this.container.addChild(chrome);

    // 3. 키아트 — 비동기. 실패·미존재는 조용히 넘어가고 위 폴백이 그대로 커튼이 된다.
    void this.attachArt(base);
  }

  /**
   * 키아트를 로드해 폴백 바탕 **바로 위**에 cover-fit 으로 얹는다. 파괴된 뒤 도착한 응답은
   * 버린다(전환은 화면 수명보다 짧을 수 있다).
   *
   * cover-fit 인 이유: 자산 비율(1376×768 ≈ 1.79)과 디자인 비율(1920×1080 ≈ 1.78)이 거의
   * 같지만 정확히 같지는 않다. contain 으로 맞추면 한쪽에 폴백 색이 띠로 남아 **커튼에
   * 이음매**가 생긴다 — 덮는 것이 목적인 물건이라 넘치는 쪽을 잘라야 맞다.
   */
  private async attachArt(base: Graphics): Promise<void> {
    const url = titleAssetUrl(CURTAIN_ART);
    if (url === undefined) return;
    let tex: Texture;
    try {
      tex = await Assets.load<Texture>(url);
    } catch {
      return; // 자산은 덧붙임이지 전제가 아니다.
    }
    if (this.destroyed) return;
    // 페인터리 원화를 확대해 쓴다 — nearest 면 붓자국이 계단으로 부서진다(titleTextures 근거).
    tex.source.scaleMode = 'linear';

    const W = DESIGN_WIDTH + OVERSCAN * 2;
    const H = DESIGN_HEIGHT + OVERSCAN * 2;
    const sw = tex.width > 0 ? tex.width : W;
    const sh = tex.height > 0 ? tex.height : H;
    const scale = Math.max(W / sw, H / sh);

    const art = new Sprite(tex);
    art.anchor.set(0.5);
    art.width = sw * scale;
    art.height = sh * scale;
    art.position.set(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2);

    const at = this.container.getChildIndex(base) + 1;
    this.container.addChildAt(art, at);
  }
}
