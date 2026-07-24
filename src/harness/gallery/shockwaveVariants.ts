/**
 * 충격파 링 변형군 — Phase 1 갤러리 (plan §AC-1.2/1.3, §AC-3.3).
 *
 * 보스 처치·대형 폭발 순간의 **짧은 원형 왜곡 링**을 취향 비교하는 2~3개 라이브 변형이다. 전부
 * render-only(sim·해시 무접촉, ADR-0005)이며 선택분은 그대로 프로덕션(AC-3.3)에 승격된다 — 목업
 * 아님(AC-1.3). 실제 왜곡은 손수 짠 WebGL GLSL 필터([shaders/shockwave.ts]{@link createShockwaveFilter})
 * 가 준다.
 *
 * ── 왜곡이 "보이게" 하려면 배경이 필요하다 ── 필터는 그 아래 픽셀을 반경 방향으로 밀어 왜곡하므로,
 * 각 셀은 spawn 시점에 **격자 배경(Graphics)을 동기적으로** 그려 두고 그 위에 필터를 건다. 필터가
 * null(GL 부재·WebGPU·컴파일 실패)이면 단순 팽창 링 Graphics 로 폴백해 이펙트의 "느낌"은 유지하고
 * 게임은 불사망(AC-3.6).
 *
 * ── 진행도는 순수함수로 분리 ── 링 반경 진행도는 {@link shockwaveProgress} 순수함수(경계·단조·
 * NaN 내성)로, 렌더 상태가 아니라 경과 시간만의 함수다([backdropCrossfadeAlpha] 선례, AC-3.5).
 * update(dt) 는 시간을 누적해 ~1.3초 주기로 스스로 재발화한다(원샷 이펙트 규약, types.ts).
 *
 * 굵기·왜곡 세기·속도는 **placeholder** 다 — 밸런스 튜닝은 출시 직전 일괄(defer-balance-tuning).
 */

import { Container, Graphics } from 'pixi.js';
import type { Filter } from 'pixi.js';
import { createShockwaveFilter } from '../../render/shaders/index.js';
import type { GalleryGroup, GalleryVariant, GalleryVariantContext, GalleryVariantHandle } from './types.js';

/**
 * 링 반경 진행도 순수함수(AC-3.5). 한 사이클 내 경과 `elapsed`(초)를 [0,1] 진행도로 사상한다.
 *
 * - 경계: `elapsed <= 0`(음수·0·NaN) → 0, `elapsed >= duration` → 1(상한 클램프).
 * - 단조: `[0, duration]` 에서 elapsed 에 대해 단조 비감소(선형).
 * - 퇴화: `duration <= 0`(또는 NaN) → 1(즉시 완료, 0 나눗셈 방지).
 *
 * 렌더 프레임 수·wall clock 이 아니라 경과 시간만의 함수라, 탭이 멈췄다 돌아와도 진행도가 튀지 않는다.
 */
export function shockwaveProgress(elapsed: number, duration: number): number {
  if (!(elapsed > 0)) return 0; // 음수·0·NaN 방어
  if (!(duration > 0)) return 1; // 퇴화 구간 방어(0 나눗셈)
  if (elapsed >= duration) return 1; // 상한 클램프
  return elapsed / duration; // [0,1] 단조 증가
}

/** 한 변형의 룩 파라미터(전부 placeholder — defer-balance-tuning). */
interface ShockwaveLook {
  /** 재발화 주기(초). ~1.3 고정 지향(AC-3.3). */
  readonly periodS: number;
  /** 링이 중심→가장자리로 퍼지는 시간(초). periodS 보다 짧으면 그만큼 정지 구간이 생긴다. */
  readonly durationS: number;
  /** 최대 변위 진폭(px). 링 중앙 위상에서 가장 강함. */
  readonly amplitudePx: number;
  /** 링 반두께(진행도 0..1 단위). 작을수록 얇은 링. */
  readonly widthUnits: number;
  /** 이중 링 여부(후행 링 추가). */
  readonly double: boolean;
}

/** 링 세기 엔벨로프 — 진행도 p(0..1)에서 0→peak→0 (중심 재발화·가장자리 소멸 시 팝 없음). */
function ringEnvelope(p: number): number {
  return Math.sin(Math.PI * p);
}

/** GLSL 필터 유니폼 갱신(resources 는 Record<string, any> — 캐스팅 불필요). */
function setShockwaveUniforms(filter: Filter, progress: number, amplitude: number): void {
  // dissolve 의 setDissolveProgress 와 동형으로 옵셔널 가드(리소스 그룹 부재 방어·일관성).
  const uniforms = filter.resources.shockwaveUniforms?.uniforms;
  if (!uniforms) return;
  uniforms.uProgress = progress;
  uniforms.uAmplitude = amplitude;
}

/**
 * 격자 배경 — 필터가 밀어 왜곡할 대상. 어두운 판 + 격자선 + 중앙 밝은 블록으로 반경 왜곡이 잘 보인다.
 * spawn 에서 동기적으로 target 에 들어가 `children.length` 를 증가시킨다(정규경로 배선 근거, AC-1.4).
 */
function buildBackdrop(width: number, height: number): Graphics {
  const g = new Graphics();
  g.rect(0, 0, width, height).fill({ color: 0x0b1220 });

  const step = 22;
  for (let x = step; x < width; x += step) g.moveTo(x, 0).lineTo(x, height);
  for (let y = step; y < height; y += step) g.moveTo(0, y).lineTo(width, y);
  g.stroke({ color: 0x2c3f63, width: 1, alpha: 0.9 });

  // 중심 표식 + 대각 강조 — 링이 지나갈 때 왜곡을 뚜렷하게 드러낸다.
  const cx = width / 2;
  const cy = height / 2;
  g.rect(cx - 15, cy - 15, 30, 30).fill({ color: 0x4de1ff, alpha: 0.85 });
  g.circle(cx, cy, 5).fill({ color: 0xffe08a });
  return g;
}

/** 폴백 팽창 링(필터 null 일 때) — 반경 p·maxR, 세기 엔벨로프로 알파 페이드. */
function drawFallbackRing(
  ring: Graphics,
  ctx: GalleryVariantContext,
  look: ShockwaveLook,
  rings: readonly { p: number; env: number }[],
): void {
  ring.clear();
  const cx = ctx.width / 2;
  const cy = ctx.height / 2;
  const maxR = 0.5 * Math.hypot(ctx.width, ctx.height);
  const strokeW = Math.max(2, look.widthUnits * maxR);
  for (const { p, env } of rings) {
    if (p <= 0 || env <= 0.001) continue;
    ring
      .circle(cx, cy, p * maxR)
      .stroke({ color: 0x9fe8ff, width: strokeW, alpha: Math.min(1, env) });
  }
}

/** 한 변형의 spawn — 배경 + (필터 | 폴백 링) 을 target 에 붙이고 살아있는 핸들을 반환한다. */
function spawnShockwave(
  look: ShockwaveLook,
  target: Container,
  ctx: GalleryVariantContext,
): GalleryVariantHandle {
  const root = new Container();
  root.addChild(buildBackdrop(ctx.width, ctx.height));
  target.addChild(root); // 동기적 child 증가(AC-1.4 배선 스모크 근거)

  const center: readonly [number, number] = [0.5, 0.5];

  // 필터는 lazy·guarded 팩토리(createShockwaveFilter 내부 tryCreateFilter). null 이면 폴백.
  const filters: Filter[] = [];
  const primary = createShockwaveFilter({ center, width: look.widthUnits, amplitude: 0, progress: 0 });
  if (primary) filters.push(primary);
  const trailing = look.double
    ? createShockwaveFilter({ center, width: look.widthUnits, amplitude: 0, progress: 0 })
    : null;
  if (trailing) filters.push(trailing);

  let fallback: Graphics | null = null;
  if (filters.length > 0) {
    root.filters = filters;
  } else {
    fallback = new Graphics();
    root.addChild(fallback);
  }

  // 후행 링 지연(주기 대비) — 이중 링 스태거.
  const lagS = look.durationS * 0.4;

  let elapsed = 0;
  return {
    update(dt: number): void {
      elapsed += dt;
      const phase = elapsed % look.periodS;

      const p1 = shockwaveProgress(phase, look.durationS);
      const env1 = ringEnvelope(p1);
      const amp1 = look.amplitudePx * env1;

      // 후행 링: lagS 이후에만 등장(그 전엔 진폭 0 → passthrough).
      const e2 = phase - lagS;
      const active2 = look.double && e2 > 0;
      const p2 = active2 ? shockwaveProgress(e2, look.durationS) : 0;
      const env2 = active2 ? ringEnvelope(p2) : 0;
      const amp2 = active2 ? look.amplitudePx * 0.7 * env2 : 0;

      if (primary) setShockwaveUniforms(primary, p1, amp1);
      if (trailing) setShockwaveUniforms(trailing, p2, amp2);

      if (fallback) {
        const rings = look.double
          ? [
              { p: p1, env: env1 },
              { p: p2, env: env2 },
            ]
          : [{ p: p1, env: env1 }];
        drawFallbackRing(fallback, ctx, look, rings);
      }
    },
    destroy(): void {
      root.filters = [];
      if (primary) primary.destroy();
      if (trailing) trailing.destroy();
      root.destroy({ children: true });
    },
  };
}

/** 변형 하나를 조립하는 헬퍼. */
function makeVariant(
  id: string,
  label: string,
  look: ShockwaveLook,
  recommended?: boolean,
): GalleryVariant {
  return {
    id,
    label,
    ...(recommended ? { recommended: true } : {}),
    spawn: (target, ctx) => spawnShockwave(look, target, ctx),
  };
}

/**
 * 충격파 링 변형군(combat 레지스터). 정확히 하나가 recommended:true(thin-fast).
 */
export const shockwaveGroup: GalleryGroup = {
  id: 'shockwave',
  title: '충격파 링',
  register: 'combat',
  variants: [
    // 얇고 빠른 링 — 짧게 퍼졌다 정지, 날카로운 한 방(추천 기본, AC-1.5).
    makeVariant(
      'shockwave-thin-fast',
      '얇고 빠른 링',
      { periodS: 1.3, durationS: 0.55, amplitudePx: 9, widthUnits: 0.045, double: false },
      true,
    ),
    // 굵고 느린 강왜곡 — 주기 대부분을 채우며 크게 밀어낸다.
    makeVariant('shockwave-thick-slow', '굵고 느린 강왜곡', {
      periodS: 1.3,
      durationS: 1.15,
      amplitudePx: 16,
      widthUnits: 0.16,
      double: false,
    }),
    // 이중 링 — 선행 링 뒤로 후행 링이 스태거로 따라붙는다.
    makeVariant('shockwave-double', '이중 링', {
      periodS: 1.3,
      durationS: 0.9,
      amplitudePx: 11,
      widthUnits: 0.07,
      double: true,
    }),
  ],
};
