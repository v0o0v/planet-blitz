/**
 * 메타 화면 전환 변형군 (Phase 1 — plan §AC-1.2 ⑤ 메타 전환; ADR-0031).
 *
 * 취향 결정 대상 6종 중 "⑤ 메타 전환(페이드/슬라이드/와이프)"의 라이브 변형이다. 셀 안에서
 * "화면 A → 화면 B swap" 을 흉내내는 두 개의 나무 톤 색판(Graphics)을 동기적으로 그리고,
 * update(dt) 로 ~2초 주기 A↔B 왕복 전환을 반복 재생한다. 전부 render-only(sim·해시 무접촉).
 *
 * ── 시각 레지스터 = meta(카툰나무풍) ── 따뜻한 브라운/그린/크림 톤만 쓴다. 전투 SF 네온
 * 글로우·블룸은 차용하지 않는다(시각 레지스터 경계 보존, ADR-0031 / types.ts register 계약).
 * 메타 전환은 셰이더가 아니라 **Graphics 오버레이 애니메이션**(alpha 크로스페이드·position
 * 슬라이드·mask 와이프)으로 구현한다.
 *
 * ── Phase 5 승격 ── 전환 진행 프리미티브({@link easeInOutCubic}·{@link transitionPhase})는
 * main.ts clearToMenu() 단일 초크포인트(AC-5.1)로 승격돼 전 메타 화면 swap 에 균일 적용되므로,
 * 변형 표시 로직과 분리한 재사용 가능한 순수함수로 뽑아 둔다.
 *
 * 속도·ease 상수는 placeholder 다(defer-balance-tuning — 밸런스는 출시 직전 일괄 조정).
 */

import { Container, Graphics } from 'pixi.js';
import type {
  GalleryGroup,
  GalleryVariant,
  GalleryVariantContext,
  GalleryVariantHandle,
} from './types.js';

// ────────────────────────────────────────────────────────────────────────────
// 카툰나무풍 팔레트 (전부 기존 메타 UI 실사용 색 + 조화 그린 placeholder)
//   · 나무 프레임 0x6b4a2a / 0x3a2a1a : src/ui/pixi/nineSlicePanel.ts 코드 프레임
//   · cream 0xebdcbe / gold 0xffd678 / bark 0x4a2a08 : src/ui/pixi/theme.ts COLOR
//   · woodCell 0x502f23 / creamBright 0xf6ebd2 : theme.ts 주석 실측색
//   · moss/olive : 나무 톤과 조화되는 따뜻한 이끼 그린(브라운·크림과 3색 카툰나무 팔레트 완성)
// ────────────────────────────────────────────────────────────────────────────
const WOOD = {
  frameLight: 0x6b4a2a,
  frameDark: 0x3a2a1a,
  cream: 0xebdcbe,
  creamBright: 0xf6ebd2,
  creamPanel: 0xe8d8b4,
  tan: 0xc9b58a,
  woodCell: 0x502f23,
  bark: 0x4a2a08,
  gold: 0xffd678,
  moss: 0x6f8047,
  mossDeep: 0x3f4a26,
  mossBar: 0x9aab6e,
} as const;

// ── 전환 타이밍(placeholder, defer-balance-tuning) ──────────────────────────
/** 순수 전환 타이밍. 값은 전부 placeholder(밸런스 패스에서 조정). */
export interface TransitionTiming {
  /** 한 방향 스윕(A→B)에 걸리는 초. */
  sweepSeconds: number;
  /** 스윕 후 안착 화면을 보여주는 정지 초. */
  holdSeconds: number;
}

/** 왕복 ≈ 2.0s (스윕 0.7 + 정지 0.3 = 한 방향 1.0s, ×2). placeholder. */
export const DEFAULT_TRANSITION_TIMING: TransitionTiming = {
  sweepSeconds: 0.7,
  holdSeconds: 0.3,
};

// ── 순수 진행 함수 (Phase 5 clearToMenu 재사용 대상) ─────────────────────────

/** [0,1] 로 clamp. */
function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * 3차 ease-in-out. 경계 고정(f(0)=0, f(1)=1)·단조 증가·[0,1]→[0,1]. NaN 입력은 clamp01 이
 * 흡수(NaN<0·NaN>1 모두 false → NaN 반환 방지 위해 아래에서 0 폴백).
 */
export function easeInOutCubic(t: number): number {
  const c = Number.isFinite(t) ? clamp01(t) : 0;
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

/**
 * 왕복 전환 진행. elapsed(초) → 이징된 A↔B 위치 [0,1] (0=완전 화면 A, 1=완전 화면 B).
 *
 * 한 사이클 = A→B 스윕 → B 정지 → B→A 스윕 → A 정지. period 로 무한 반복하며, 갤러리에서
 * "전환이 계속 보이도록" 스스로 재발화한다(types.ts 원샷 이펙트 자가 재발화 계약과 동형).
 * 음수 elapsed 도 안전(모듈러 정규화). ease 는 스윗 구간에만 적용(정지 구간은 평평).
 */
export function transitionPhase(
  elapsed: number,
  timing: TransitionTiming = DEFAULT_TRANSITION_TIMING,
): number {
  const sweep = Math.max(1e-4, timing.sweepSeconds);
  const hold = Math.max(0, timing.holdSeconds);
  const leg = sweep + hold; // 한 방향(스윕 + 정지)
  const period = leg * 2; // 왕복
  const e = Number.isFinite(elapsed) ? elapsed : 0;
  const t = ((e % period) + period) % period; // 음수 방어 정규화
  let raw: number;
  if (t < sweep)
    raw = t / sweep; // A→B 스윕
  else if (t < leg)
    raw = 1; // B 정지
  else if (t < leg + sweep)
    raw = 1 - (t - leg) / sweep; // B→A 스윕
  else raw = 0; // A 정지
  return easeInOutCubic(raw);
}

// ── 화면 색판(나무 톤 UI 모형) ───────────────────────────────────────────────

/** 한 "화면"의 팔레트. */
interface ScreenPalette {
  fill: number;
  header: number;
  bar: number;
}

/** 화면 A = 밝은 크림-나무 톤. */
const SCREEN_A: ScreenPalette = {
  fill: WOOD.creamPanel,
  header: WOOD.frameLight,
  bar: WOOD.tan,
};

/** 화면 B = 따뜻한 이끼-나무 톤(그린). A 와 명도·색상 모두 벌려 swap 이 또렷하게 읽히게. */
const SCREEN_B: ScreenPalette = {
  fill: WOOD.mossDeep,
  header: WOOD.moss,
  bar: WOOD.mossBar,
};

/**
 * 나무 프레임 색판 하나를 그린다 — 헤더 스트립 + 콘텐츠 바 3줄로 "메타 화면" 처럼 읽히게.
 * nineSlicePanel.ts 의 코드 프레임(2겹 나무 stroke)과 동형이라 카툰나무풍 결이 유지된다.
 * 좌상단 (0,0) 기준으로 [w,h] 안에 그린다.
 */
function makeScreen(w: number, h: number, pal: ScreenPalette): Container {
  const c = new Container();
  const g = new Graphics();
  const r = Math.max(6, Math.round(Math.min(w, h) * 0.06));

  // 바탕 나무 패널.
  g.roundRect(0, 0, w, h, r).fill({ color: pal.fill });
  // 나무 프레임 2겹(밝은 살 + 어두운 안쪽 홈).
  g.roundRect(0, 0, w, h, r).stroke({ color: WOOD.frameLight, width: 4, alignment: 1 });
  g.roundRect(2, 2, w - 4, h - 4, Math.max(2, r - 2))
    .stroke({ color: WOOD.frameDark, width: 2, alignment: 1 });

  const pad = Math.round(w * 0.09);
  const headerH = Math.round(h * 0.2);
  // 헤더 스트립.
  g.roundRect(pad, pad, Math.max(0, w - pad * 2), headerH, Math.round(r * 0.6)).fill({
    color: pal.header,
  });
  // 콘텐츠 바 3줄(마지막 줄은 짧게 — 목록 느낌).
  const barH = Math.round(h * 0.09);
  const gap = Math.round(h * 0.06);
  let by = pad + headerH + Math.round(h * 0.08);
  for (let i = 0; i < 3; i++) {
    const bw = Math.max(0, (w - pad * 2) * (i === 2 ? 0.6 : 1));
    g.roundRect(pad, by, bw, barH, Math.round(barH * 0.4)).fill({ color: pal.bar });
    by += barH + gap;
  }

  c.addChild(g);
  return c;
}

/** 셀 안쪽 여백(디자인 px). 색판이 셀 테두리에 붙지 않도록. placeholder. */
const CELL_MARGIN = 8;

/** 셀 컨텍스트 → 색판이 차지할 안쪽 사각형(margin 적용). */
function innerRect(ctx: GalleryVariantContext): { x: number; y: number; w: number; h: number } {
  const m = Math.min(CELL_MARGIN, Math.floor(Math.min(ctx.width, ctx.height) * 0.1));
  return {
    x: m,
    y: m,
    w: Math.max(1, ctx.width - m * 2),
    h: Math.max(1, ctx.height - m * 2),
  };
}

// ── 공용 핸들 골격 ───────────────────────────────────────────────────────────

/**
 * 두 색판 A·B 를 만들어 target 에 붙이고, 매 프레임 `apply(eased, A, B, ...)` 로 전환을 그린다.
 * elapsed 누적·transitionPhase 호출·정리는 여기서 공통 처리(변형은 apply 만 다르다).
 */
function makeTransitionHandle(
  target: Container,
  ctx: GalleryVariantContext,
  build: (
    root: Container,
    inner: { x: number; y: number; w: number; h: number },
    a: Container,
    b: Container,
  ) => (eased: number) => void,
): GalleryVariantHandle {
  const rect = innerRect(ctx);
  const root = new Container();
  root.x = rect.x;
  root.y = rect.y;

  const a = makeScreen(rect.w, rect.h, SCREEN_A);
  const b = makeScreen(rect.w, rect.h, SCREEN_B);

  const apply = build(root, rect, a, b);

  // spawn 직후 target.children 증가(정규경로 배선 스모크 근거, AC-1.4).
  target.addChild(root);

  let elapsed = 0;
  apply(transitionPhase(0)); // 초기 프레임 = 완전 화면 A.

  return {
    update(dt: number): void {
      elapsed += Number.isFinite(dt) ? dt : 0;
      apply(transitionPhase(elapsed));
    },
    destroy(): void {
      // mask 참조를 먼저 끊어 destroy 경고를 피한다.
      a.mask = null;
      b.mask = null;
      if (root.parent) root.parent.removeChild(root);
      root.destroy({ children: true });
    },
  };
}

// ── 변형 1: 페이드(추천) ─────────────────────────────────────────────────────
// A·B 를 같은 자리에 겹쳐 두고 alpha 크로스페이드. 가장 담백하고 균일 초크포인트에 이식하기
// 쉬워 recommended. 카툰 느낌으로 들어오는 화면에 아주 얕은 스케일 팝(0.98→1)을 얹는다.
function spawnFade(target: Container, ctx: GalleryVariantContext): GalleryVariantHandle {
  return makeTransitionHandle(target, ctx, (root, inner, a, b) => {
    root.addChild(a, b);
    // 스케일 팝의 중심을 색판 정중앙으로.
    b.pivot.set(inner.w / 2, inner.h / 2);
    b.position.set(inner.w / 2, inner.h / 2);
    return (eased: number) => {
      a.alpha = 1 - eased;
      b.alpha = eased;
      b.scale.set(0.98 + 0.02 * eased);
    };
  });
}

// ── 변형 2: 슬라이드 ─────────────────────────────────────────────────────────
// B 가 오른쪽에서 밀고 들어와 A 를 덮는다. A 는 살짝 왼쪽으로 밀려나는 시차(parallax). 색판이
// 셀 밖으로 새지 않도록 안쪽 사각형으로 mask.
function spawnSlide(target: Container, ctx: GalleryVariantContext): GalleryVariantHandle {
  return makeTransitionHandle(target, ctx, (root, inner, a, b) => {
    const clip = new Graphics();
    clip.roundRect(0, 0, inner.w, inner.h, Math.round(Math.min(inner.w, inner.h) * 0.06)).fill({
      color: 0xffffff,
    });
    root.addChild(a, b, clip);
    a.mask = clip;
    b.mask = clip;
    return (eased: number) => {
      // B: 오른쪽(x=w) → 제자리(x=0).
      b.x = inner.w * (1 - eased);
      // A: 제자리 → 살짝 왼쪽(시차). 덮이는 동안만 미세 이동.
      a.x = -inner.w * 0.15 * eased;
    };
  });
}

// ── 변형 3: 와이프 ───────────────────────────────────────────────────────────
// B 를 A 위에 두되 왼쪽→오른쪽으로 이동하는 mask 로 점진 노출. 경계에 나무-골드 와이프 엣지를
// 그려 카툰 느낌을 준다(전환 중에만 보임).
function spawnWipe(target: Container, ctx: GalleryVariantContext): GalleryVariantHandle {
  return makeTransitionHandle(target, ctx, (root, inner, a, b) => {
    const clip = new Graphics();
    const edge = new Graphics();
    root.addChild(a, b, clip, edge);
    b.mask = clip;
    const edgeW = Math.max(3, Math.round(inner.w * 0.02));
    return (eased: number) => {
      const revealX = inner.w * eased;
      // B 노출 mask: 왼쪽부터 revealX 까지.
      clip.clear();
      clip.rect(0, 0, revealX, inner.h).fill({ color: 0xffffff });
      // 와이프 엣지(전환 중 0<eased<1 에서만).
      edge.clear();
      if (eased > 0.001 && eased < 0.999) {
        const ex = Math.min(inner.w - edgeW, Math.max(0, revealX - edgeW * 0.5));
        edge.rect(ex, 0, edgeW, inner.h).fill({ color: WOOD.gold, alpha: 0.9 });
      }
    };
  });
}

// ── 그룹 export ──────────────────────────────────────────────────────────────

const fadeVariant: GalleryVariant = {
  id: 'transition-fade',
  label: '페이드(크로스페이드)',
  recommended: true,
  spawn: spawnFade,
};

const slideVariant: GalleryVariant = {
  id: 'transition-slide',
  label: '슬라이드(밀어내기)',
  spawn: spawnSlide,
};

const wipeVariant: GalleryVariant = {
  id: 'transition-wipe',
  label: '와이프(쓸어내기)',
  spawn: spawnWipe,
};

/** 메타 화면 전환 변형군(register=meta, 카툰나무풍). recommended=페이드. */
export const transitionGroup: GalleryGroup = {
  id: 'transition',
  title: '메타 화면 전환',
  register: 'meta',
  variants: [fadeVariant, slideVariant, wipeVariant],
};
