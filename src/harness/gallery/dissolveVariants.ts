/**
 * 사망 디졸브 변형군 — Phase 1 프로토타입 갤러리 (plan §AC-1.2 ③, §AC-3.4).
 *
 * "적이 죽을 때 어떻게 사라지는가"의 취향을 라이브로 고르는 combat 레지스터 변형군이다. 각 변형은
 * 셀 중앙에 적대 SF 드론을 **동기적으로** 그리고, Phase 0 인프라의 `createDissolveFilter`(손수 짠
 * WebGL GLSL 디더-알파 필터)를 `tryCreateFilter` 로 부착한다. `update(dt)` 가 순수함수
 * `dissolveCycleProgress` 로 `uProgress` 를 0→1 로 몰아 디더 소멸시키고 ~1.5초 주기로 재발화한다.
 *
 * **AC-1.3(목업 아님):** 여기 쓰는 필터는 그대로 프로덕션 소멸 연출로 승격되는 실 코드다.
 * **AC-3.6(graceful 폴백):** GL 부재/컴파일 실패로 필터가 null 이면 디더 대신 단순 알파 페이드로
 * 대체해 headless(node) 스모크·구형 GPU 에서도 소멸 자체는 성립한다(표시 객체 추가는 항상 성공).
 * **AC-3.5(순수 진행도):** 진행도는 `elapsed → progress` 순수함수로만 계산한다(sim·해시 무접촉).
 */

import { Container, Graphics, type Filter } from 'pixi.js';
import { createDissolveFilter, tryCreateFilter, type DissolveFilterOptions } from '../../render/shaders/index.js';
import type { GalleryGroup, GalleryVariant, GalleryVariantContext, GalleryVariantHandle } from './types.js';

// 소멸 사이클(초). 온전 유지 → 디더 소멸 → 재발화. 합계 ~1.5초 주기(계약: ~1.5초 재발화).
const HOLD_SECONDS = 0.4;
const DISSOLVE_SECONDS = 1.1;
const CYCLE_SECONDS = HOLD_SECONDS + DISSOLVE_SECONDS;

/**
 * 소멸 진행도 순수함수(AC-3.5): 누적 경과(초) → 진행도(0 온전 → 1 완전 소멸).
 * `HOLD_SECONDS` 동안 온전(0) 유지 후 `DISSOLVE_SECONDS` 동안 0→1 선형 상승, 사이클마다 반복.
 * 결정론적이고 NaN/음수에 내성(비정상 입력 → 0).
 */
export function dissolveCycleProgress(elapsed: number): number {
  if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
  const t = elapsed % CYCLE_SECONDS;
  if (t < HOLD_SECONDS) return 0;
  return Math.min(1, (t - HOLD_SECONDS) / DISSOLVE_SECONDS);
}

/** 적대 SF 드론 한 기를 (0,0) 중심으로 그린 표시 객체. 갤러리 셀에서 이 객체가 디졸브된다. */
function buildEnemy(size: number): Container {
  const half = size / 2;
  const g = new Graphics();

  // 후미 스러스터(어두운 헐).
  g.rect(-half * 0.5, half * 0.55, half, half * 0.35).fill({ color: 0x3a0d0d });

  // 본체 — 각진 육각 헐(적대 크림슨).
  g.poly([
    0, -half,
    half * 0.85, -half * 0.25,
    half * 0.6, half * 0.6,
    -half * 0.6, half * 0.6,
    -half * 0.85, -half * 0.25,
  ])
    .fill({ color: 0xb51f1f })
    .stroke({ color: 0x611010, width: Math.max(2, size * 0.04) });

  // 측면 핀(주황 액센트).
  g.poly([half * 0.85, -half * 0.25, half * 1.15, half * 0.1, half * 0.6, half * 0.35]).fill({
    color: 0xe86a1c,
  });
  g.poly([-half * 0.85, -half * 0.25, -half * 1.15, half * 0.1, -half * 0.6, half * 0.35]).fill({
    color: 0xe86a1c,
  });

  // 코어 글로우(밝은 시안 → 흰 중심).
  g.circle(0, -half * 0.05, half * 0.32).fill({ color: 0x8ff0ff });
  g.circle(0, -half * 0.05, half * 0.16).fill({ color: 0xffffff });

  const c = new Container();
  c.addChild(g);
  return c;
}

/** 필터 유니폼 `uProgress` 를 방어적으로 갱신한다(리소스 그룹 부재 시 무시). */
function setDissolveProgress(filter: Filter, progress: number): void {
  const res = filter.resources as Record<string, { uniforms?: Record<string, number> } | undefined>;
  const uniforms = res.dissolveUniforms?.uniforms;
  if (uniforms) uniforms.uProgress = progress;
}

interface DissolveVariantConfig {
  id: string;
  label: string;
  recommended?: boolean;
  /** 필터 룩 파라미터(진행도 제외 — 진행도는 update 가 매 프레임 공급). */
  filterOptions: Omit<DissolveFilterOptions, 'progress'>;
  /** true 면 소멸 중 살짝 확대·기울여 "픽셀 조각 흩어짐" 느낌을 준다. */
  scatter?: boolean;
}

function makeDissolveVariant(config: DissolveVariantConfig): GalleryVariant {
  return {
    id: config.id,
    label: config.label,
    // exactOptionalPropertyTypes: recommended 는 true 일 때만 실어 명시적 undefined 를 피한다.
    ...(config.recommended ? { recommended: true as const } : {}),
    spawn(target: Container, ctx: GalleryVariantContext): GalleryVariantHandle {
      const size = Math.min(ctx.width, ctx.height) * 0.42;
      const enemy = buildEnemy(size);
      enemy.position.set(ctx.width / 2, ctx.height / 2);
      // 동기 부착: spawn 직후 target.children.length 가 증가한다(정규경로 배선 스모크, AC-1.4).
      target.addChild(enemy);

      // 디더 필터 부착. null(GL 부재/컴파일 실패)이면 알파 페이드 폴백(AC-3.6).
      const filter = tryCreateFilter(() =>
        createDissolveFilter({ ...config.filterOptions, progress: 0 }),
      );
      if (filter) enemy.filters = [filter];

      let elapsed = 0;
      let destroyed = false;

      return {
        update(dt: number): void {
          if (destroyed) return;
          if (Number.isFinite(dt) && dt > 0) elapsed += dt;
          const progress = dissolveCycleProgress(elapsed);

          if (filter) {
            // 디더 알파: 필터가 픽셀별로 지운다. 컨테이너 알파는 온전 유지.
            setDissolveProgress(filter, progress);
            enemy.alpha = 1;
          } else {
            // 폴백: 필터 없이 단순 알파 페이드로 소멸.
            enemy.alpha = 1 - progress;
          }

          if (config.scatter) {
            enemy.scale.set(1 + 0.18 * progress);
            enemy.rotation = 0.25 * progress;
          }
        },
        destroy(): void {
          if (destroyed) return;
          destroyed = true;
          enemy.filters = [];
          try {
            filter?.destroy();
          } catch {
            // 미컴파일 필터 정리 실패는 무해 — 삼킨다.
          }
          enemy.destroy({ children: true });
        },
      };
    },
  };
}

/** 사망 디졸브 변형군(AC-1.2 ③). combat 레지스터, 2~3개 변형 중 정확히 하나 recommended. */
export const dissolveGroup: GalleryGroup = {
  id: 'dissolve',
  title: '사망 디졸브',
  register: 'combat',
  variants: [
    makeDissolveVariant({
      id: 'dissolve-dither-up',
      label: '디더 상승 소멸',
      recommended: true,
      filterOptions: { direction: [0, -1], cell: 4, band: 0.35 },
    }),
    makeDissolveVariant({
      id: 'dissolve-dither-radial',
      label: '중심 방사 디더',
      filterOptions: { radial: true, cell: 4, band: 0.4 },
    }),
    makeDissolveVariant({
      id: 'dissolve-pixelate',
      label: '픽셀 조각 흩어짐',
      filterOptions: { direction: [0, -1], cell: 9, band: 0.7 },
      scatter: true,
    }),
  ],
};
