/**
 * 글로우·블룸 룩 변형군 (Phase 1 갤러리 — plan §AC-1.2 ②글로우, ADR-0031 ②③).
 *
 * "발광체에만 발광" 규율의 프리뷰다: 셀 중앙에 **발광체**(젬/보스 코어류 절차적 코어 + 가산
 * 헤일로)를 하나 놓고, 그 위에 서로 다른 글로우 처리를 얹어 사용자가 룩을 비교·선택하게 한다.
 * 탄·적 실루엣 같은 가독 레이어에는 글로우를 걸지 않는다(CONTEXT.md "발광체" — 탄은 발광체 아님).
 *
 * ── 계층형 글로우(ADR-0031 ③) ──
 *  - **기본**: 가산 스프라이트 헤일로(`blendMode='add'` Container). 필터 0 이라 **전 티어·headless
 *    에서도** 동작한다(GL 없이도 표시 객체 추가는 성립 — types.ts 계약).
 *  - **고품질**: 그 발광 컨테이너에 **진짜 블룸 필터 1패스**(High 티어, AC-3.1). 블룸은
 *    pixi-filters `AdvancedBloomFilter` 래퍼(`createBloomFilter`)를 `tryCreateFilter` 로 한 번 더
 *    감싸, GL 부재/컴파일 실패 시 **null → 헤일로만**으로 graceful 폴백한다(AC-3.6, headless node 안전).
 *
 * render-only(src/sim 무접촉, ADR-0005). 시각 레지스터 = combat(SF 픽셀아트).
 *
 * ⚠️ 세기·반경·threshold·색온도·맥동 주파수는 **전부 placeholder** 다 — 실 밸런스는 이 갤러리에서
 *    룩이 선택된 뒤 Phase 3(AC-3.1) 승격 시 채운다(defer-balance-tuning: 튜닝은 출시 직전 일괄).
 */

import { Container, Graphics, type Filter } from 'pixi.js';
import type {
  GalleryGroup,
  GalleryVariant,
  GalleryVariantContext,
  GalleryVariantHandle,
} from './types.js';
import { createBloomFilter, tryCreateFilter } from '../../render/shaders/index.js';

const TWO_PI = Math.PI * 2;

/** 헤일로 링 1개당 가산 알파(placeholder — defer-balance-tuning). 링이 겹쳐 중심이 밝아진다. */
const RING_ALPHA = 0.09;
/** 헤일로 링 수(placeholder). 많을수록 falloff 가 부드럽지만 draw 비용↑. */
const RING_COUNT = 7;

/**
 * 글로우 변형 1개의 룩 파라미터. 세 변형이 **동일한 발광체 형상**(젬 코어 + 가산 헤일로)을 공유하고,
 * 색온도·헤일로 크기·맥동·필터만 달리해 "글로우 처리" 자체를 비교하게 한다(형상 변수 제거).
 *
 * 모든 수치 placeholder(defer-balance-tuning).
 */
interface GlowSpec {
  /** 코어 젬 본체 색(발광체 톤 — combat SF). */
  readonly coreColor: number;
  /** 코어 상단 파셋 하이라이트 색(밝은 톤). */
  readonly coreHi: number;
  /** 헤일로(가산) 색. */
  readonly haloColor: number;
  /** 헤일로 최대 반경 = min(cellW, cellH) × 이 값. */
  readonly haloRadiusFactor: number;
  /** 코어 젬 반경 = min(cellW, cellH) × 이 값. */
  readonly coreRadiusFactor: number;
  /** 맥동 저점 헤일로 알파(0..1). */
  readonly haloAlphaMin: number;
  /** 맥동 고점 헤일로 알파(0..1). */
  readonly haloAlphaMax: number;
  /** 맥동 시 헤일로 스케일 진폭(1 + 이 값까지 부푼다). */
  readonly haloScaleAmp: number;
  /** 맥동 주파수(Hz). */
  readonly pulseHz: number;
  /**
   * 블룸 필터 팩토리. **null 이면 헤일로만**(필터 0 — 전 티어). 팩토리는 호출 시점에만 인스턴스화하고
   * 실패 시 null 을 돌려준다(headless 안전). 반드시 `tryCreateFilter(() => createBloomFilter(...))` 로 감싼다.
   */
  readonly makeFilter: (() => Filter | null) | null;
}

/** 셀 중앙에 놓을 발광체(가산 헤일로 뒤 + 코어 젬 앞)를 만든다. 표시 객체는 반환 body 에 담긴다. */
function buildGlowBody(
  ctx: GalleryVariantContext,
  spec: GlowSpec,
): { body: Container; halo: Container; core: Graphics } {
  const unit = Math.min(ctx.width, ctx.height);
  const maxR = unit * spec.haloRadiusFactor;
  const coreR = unit * spec.coreRadiusFactor;

  const body = new Container();
  body.position.set(ctx.width / 2, ctx.height / 2);

  // ── 가산 헤일로: 동심원 링을 add 블렌드로 쌓아 중심이 밝은 부드러운 falloff 를 만든다(텍스처 불필요).
  // glowLayer 규율(AC-0.8)과 동형 — 발광은 코어 **아래**(먼저 addChild)라 불투명 코어를 안 덮는다.
  const halo = new Container();
  halo.blendMode = 'add';
  const haloG = new Graphics();
  for (let i = RING_COUNT; i >= 1; i--) {
    const t = i / RING_COUNT; // 1(외곽) .. 1/RING_COUNT(중심)
    haloG.circle(0, 0, maxR * t).fill({ color: spec.haloColor, alpha: RING_ALPHA });
  }
  halo.addChild(haloG);
  body.addChild(halo);

  // ── 코어 젬(발광체): 다이아몬드 본체 + 상단 파셋 하이라이트 + 핫 센터. textures.ts drawDiamond idiom.
  const core = new Graphics();
  core
    .moveTo(0, -coreR)
    .lineTo(coreR * 0.72, 0)
    .lineTo(0, coreR)
    .lineTo(-coreR * 0.72, 0)
    .lineTo(0, -coreR)
    .fill({ color: spec.coreColor });
  // 상단 파셋(위 절반)만 밝게 — 젬 광택.
  core
    .moveTo(0, -coreR)
    .lineTo(coreR * 0.72, 0)
    .lineTo(0, 0)
    .lineTo(-coreR * 0.72, 0)
    .lineTo(0, -coreR)
    .fill({ color: spec.coreHi, alpha: 0.85 });
  // 핫 센터(블룸 threshold 를 확실히 넘는 밝은 점).
  core.circle(0, 0, coreR * 0.22).fill({ color: 0xffffff, alpha: 0.95 });
  body.addChild(core);

  return { body, halo, core };
}

/** 한 변형을 만든다. spawn 은 spec 을 클로저로 캡처해 발광체를 target 에 동기 추가하고 핸들을 돌려준다. */
function makeGlowVariant(
  id: string,
  label: string,
  spec: GlowSpec,
  recommended?: boolean,
): GalleryVariant {
  return {
    id,
    label,
    ...(recommended ? { recommended: true } : {}),
    spawn(target: Container, ctx: GalleryVariantContext): GalleryVariantHandle {
      const { body, halo, core } = buildGlowBody(ctx, spec);

      // 고품질 변형: 발광 컨테이너에 블룸 1패스. tryCreateFilter 로 감싸 null 이면 헤일로만(폴백).
      // makeFilter 자체가 이미 tryCreateFilter(() => createBloomFilter(...)) 라 여기선 호출만 한다.
      let filter: Filter | null = null;
      if (spec.makeFilter) {
        filter = spec.makeFilter();
        if (filter) body.filters = [filter];
      }

      // 동기 추가 — spawn 직후 target.children.length 가 증가해야 한다(정규경로 배선 스모크 근거, AC-1.4).
      target.addChild(body);

      let elapsed = 0;
      return {
        update(elapsedSeconds: number): void {
          // 지속 이펙트(글로우)는 맥동/유지한다(types.ts 계약). elapsedSeconds 는 프레임 델타 → 누적.
          elapsed += elapsedSeconds;
          const pulse = 0.5 + 0.5 * Math.sin(elapsed * TWO_PI * spec.pulseHz);
          // 밝기 맥동: 헤일로 알파 + 코어 알파를 사인으로 흔든다(placeholder 진폭).
          halo.alpha = spec.haloAlphaMin + (spec.haloAlphaMax - spec.haloAlphaMin) * pulse;
          core.alpha = 0.82 + 0.18 * pulse;
          // 스케일 맥동: 헤일로만 부푼다(코어는 형상 고정 — 발광체 실루엣 가독 보존).
          halo.scale.set(1 + spec.haloScaleAmp * pulse);
        },
        destroy(): void {
          if (body.parent) body.parent.removeChild(body);
          body.destroy({ children: true });
          // 필터는 컨테이너 destroy 로 정리되지 않으므로 별도 해제(headless 안전 위해 guard).
          if (filter) {
            try {
              filter.destroy();
            } catch {
              /* 폴백: 이미 소실/미생성이면 무시 */
            }
            filter = null;
          }
        },
      };
    },
  };
}

/**
 * glow-halo-soft — 부드러운 가산 헤일로만(필터 0, 전 티어·headless 동작). 시원한 시안 젬.
 * **추천 기본값**(AC-1.5): 필터 없이 어디서나 도는 계층형 글로우의 기본선이라 무선택 시 안전.
 */
const haloSoft = makeGlowVariant(
  'glow-halo-soft',
  '소프트 헤일로(가산·전 티어)',
  {
    // placeholder 색온도/반경/맥동 — defer-balance-tuning.
    coreColor: 0x3fe0ff,
    coreHi: 0xc8f6ff,
    haloColor: 0x39c8ff,
    haloRadiusFactor: 0.34,
    coreRadiusFactor: 0.13,
    haloAlphaMin: 0.55,
    haloAlphaMax: 0.9,
    haloScaleAmp: 0.1,
    pulseHz: 0.5,
    makeFilter: null, // 헤일로만
  },
  true,
);

/**
 * glow-bloom-tight — 타이트 블룸(작은 반경·높은 threshold). 코어가 또렷하게 남고 발광이 코어 근처에만.
 * 밝은 청백 코어. High 티어 발광체 룩 후보 A.
 */
const bloomTight = makeGlowVariant('glow-bloom-tight', '타이트 블룸(또렷 코어)', {
  // placeholder — defer-balance-tuning. threshold↑·blur↓ = 코어 또렷.
  coreColor: 0x8fd0ff,
  coreHi: 0xffffff,
  haloColor: 0x66b8ff,
  haloRadiusFactor: 0.26,
  coreRadiusFactor: 0.14,
  haloAlphaMin: 0.5,
  haloAlphaMax: 0.85,
  haloScaleAmp: 0.07,
  pulseHz: 0.7,
  makeFilter: () =>
    tryCreateFilter(() =>
      createBloomFilter({ threshold: 0.6, blur: 4, bloomScale: 1.25, brightness: 1.0, quality: 4 }),
    ),
});

/**
 * glow-bloom-wide — 넓고 따뜻한 블룸(큰 반경·낮은 threshold·따뜻 색온도). 발광이 셀 전체로 번진다.
 * 골드/오렌지 보스 코어. High 티어 발광체 룩 후보 B.
 */
const bloomWide = makeGlowVariant('glow-bloom-wide', '와이드 웜 블룸(번지는 발광)', {
  // placeholder — defer-balance-tuning. threshold↓·blur↑·따뜻 색 = 넓게 번지는 발광.
  coreColor: 0xffb020,
  coreHi: 0xffe6a0,
  haloColor: 0xff8a30,
  haloRadiusFactor: 0.4,
  coreRadiusFactor: 0.14,
  haloAlphaMin: 0.6,
  haloAlphaMax: 1.0,
  haloScaleAmp: 0.13,
  pulseHz: 0.4,
  makeFilter: () =>
    tryCreateFilter(() =>
      createBloomFilter({ threshold: 0.3, blur: 14, bloomScale: 1.6, brightness: 1.05, quality: 5 }),
    ),
});

/** 글로우·블룸 룩 변형군(combat). 정확히 하나(haloSoft)가 recommended. */
export const glowGroup: GalleryGroup = {
  id: 'glow',
  title: '글로우·블룸 룩',
  register: 'combat',
  variants: [haloSoft, bloomTight, bloomWide],
};
