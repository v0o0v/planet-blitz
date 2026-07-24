/**
 * 이벤트 셰이더 이펙트 컨트롤러 3종 (Phase 3 — plan §AC-3.2/3.3/3.4/3.6 · ADR-0031).
 *
 * Phase 0 인프라(src/render/shaders/*)가 준 손수 짠 WebGL GLSL 필터 팩토리(`createShockwaveFilter`·
 * `createDissolveFilter`·`createShimmerFilter`, 전부 `tryCreateFilter` 로 감싼 lazy·guarded)를
 * **정규 렌더 경로에 배선**하는 얇은 수명 컨트롤러다. 각 컨트롤러는:
 *   1. 대상 `Container` 에 필터를 부착하되 **기존 filters 배열을 훼손하지 않고** 추가하고,
 *   2. 진행도/시간으로 유니폼을 구동하며,
 *   3. 수명 종료(원샷) 또는 명시 detach 시 **자기 필터만** 제거하고 정리한다(누수 0·이중 detach 안전).
 *
 * ── 진행도는 자체 포함(계약) ────────────────────────────────────────────────────
 * 진행도 순수함수(`oneShotProgress`·`ringEnvelope`)를 **이 모듈 안에** 둔다. 병렬 레인이 만드는
 * src/render/shaders/progress.ts 에 의존하지 않는다(레이스 회피 — progress.ts 는 순수함수 유닛
 * 테스트용이고, 이펙트는 자체 진행 로직을 가져도 된다는 태스크 지침). 결정론(render-only)이라
 * 경과 시간만의 함수다.
 *
 * ── 선택된 프로덕션 룩(사용자 지정 2026-07-24, AC-1.5) ────────────────────────────
 *  - 충격파 = `shockwave-thick-slow`(굵고 느린). src/harness/gallery/shockwaveVariants.ts 의
 *    해당 변형 파라미터를 승격: durationS=1.15 · amplitudePx=16 · widthUnits=0.16.
 *  - 디졸브 = `dissolve-dither-up`(디더 상승). src/harness/gallery/dissolveVariants.ts 의 해당
 *    변형 파라미터를 승격: direction=[0,-1](아래→위) · cell=4 · band=0.35. 소멸 시간은 갤러리
 *    사이클의 소멸 구간 DISSOLVE_SECONDS=1.1 을 원샷 duration 으로 승격.
 *  - 시머 = AC-3.2 지속형(용암 해저드·보스 과열 창). 갤러리 선택 변형이 없어(연속 앰비언트)
 *    strength/speed 는 placeholder(defer-balance-tuning).
 *  전부 **placeholder** 다 — 밸런스 튜닝은 출시 직전 일괄(defer-balance-tuning).
 *
 * ── 계약(넘을 수 없음) ────────────────────────────────────────────────────────
 *  - **render-only**: src/sim/ 무접촉. 결정론(hashWorld/hashEntity)과 무관하다.
 *  - **graceful 폴백(AC-3.6)**: 필터 생성이 null(GL 부재·WebGPU·컴파일 실패)이면 효과를 생략하거나
 *    단순 대체(충격파=팽창 링 Graphics, 디졸브=alpha 페이드, 시머=no-op)로 낮추고 게임은 불사망.
 *    필터 인스턴스화는 팩토리 내부 `tryCreateFilter` 가 이미 guard 하므로, node-env import·생성이
 *    throw 하지 않는다.
 *  - **filters 배열 비훼손**: {@link attachFilter}/{@link detachFilter} 가 대상의 기존 filters 를
 *    보존하며 자기 것만 넣고 뺀다(다른 이펙트 필터와 공존, 이중 detach·미부착 detach 무해).
 */

import { Container, Graphics } from 'pixi.js';
import type { Filter } from 'pixi.js';
import { createShockwaveFilter, createDissolveFilter, createShimmerFilter } from '../shaders/index.js';

// ---------------------------------------------------------------------------
// filters 배열 비훼손 부착/해제 — 대상의 기존 필터를 보존하며 자기 것만 넣고 뺀다.
//
// Pixi v8 `Container.filters` 실증(node-env): 미설정 getter=undefined, 배열 설정 시 getter=배열,
// 빈 배열 설정도 안전(getter=array(0)). 단일 Filter 설정도 허용되므로 읽을 때 단일/배열/부재를
// 전부 흡수해 배열로 정규화한다.
// ---------------------------------------------------------------------------

/** `target.filters` 를 항상 새 배열로 정규화해 읽는다(단일·배열·null·undefined 흡수). */
function readFilters(target: Container): Filter[] {
  const f = target.filters as Filter | readonly Filter[] | null | undefined;
  if (f == null) return [];
  return Array.isArray(f) ? [...f] : [f as Filter];
}

/**
 * 기존 filters 를 훼손하지 않고 `filter` 를 추가한다(멱등 — 이미 있으면 무시).
 * 다른 이펙트가 이미 건 필터는 그대로 두고 뒤에 덧붙인다.
 */
export function attachFilter(target: Container, filter: Filter): void {
  const arr = readFilters(target);
  if (arr.includes(filter)) return; // 멱등: 중복 부착 방지
  arr.push(filter);
  target.filters = arr;
}

/**
 * `target` 에서 `filter` 만 제거한다(다른 필터 보존). 부착 안 된 필터·이미 뗀 필터 제거는 무해(no-op).
 * 남은 필터가 있으면 그 배열을, 없으면 빈 배열을 설정한다(둘 다 실증상 안전).
 */
export function detachFilter(target: Container, filter: Filter): void {
  const arr = readFilters(target);
  const idx = arr.indexOf(filter);
  if (idx < 0) return; // 미부착/이중 detach 무해
  arr.splice(idx, 1);
  target.filters = arr;
}

/**
 * 필터 유니폼 그룹의 값들을 방어적으로 갱신한다. 리소스 그룹이 없으면(타입 불일치·미컴파일 필터)
 * 조용히 무시 — throw 하지 않는다(변형 파일 `setDissolveProgress` 관용구와 동형).
 */
function writeUniforms(filter: Filter, group: string, values: Record<string, number>): void {
  const res = filter.resources as Record<string, { uniforms?: Record<string, number> } | undefined>;
  const uniforms = res[group]?.uniforms;
  if (!uniforms) return;
  for (const key of Object.keys(values)) {
    const v = values[key];
    if (v !== undefined) uniforms[key] = v;
  }
}

// ---------------------------------------------------------------------------
// 진행도 순수함수 — 자체 포함(progress.ts 의존 없음). render-only·결정론.
// ---------------------------------------------------------------------------

/**
 * 원샷 진행도(0..1): 경과 `elapsed`(초)를 `duration` 으로 정규화한다.
 * 경계: elapsed≤0·NaN → 0, elapsed≥duration → 1(상한 클램프), duration≤0·NaN → 1(0 나눗셈 방어).
 * `[0, duration]` 에서 단조 비감소(선형). shockwaveVariants.ts `shockwaveProgress` 와 동형 계약.
 */
function oneShotProgress(elapsed: number, duration: number): number {
  if (!(elapsed > 0)) return 0; // 음수·0·NaN 방어
  if (!(duration > 0)) return 1; // 퇴화 방어(0 나눗셈)
  if (elapsed >= duration) return 1; // 상한 클램프
  return elapsed / duration;
}

/** 링 세기 엔벨로프 sin(π·p): p 0→0.5→1 에서 0→peak→0(중심 재발화·가장자리 소멸 시 팝 없음). */
function ringEnvelope(p: number): number {
  const clamped = p < 0 ? 0 : p > 1 ? 1 : p;
  return Math.sin(Math.PI * clamped);
}

/** 프레임 델타 클램프(초) — 탭 복귀 등 큰 dt 로 이펙트가 순간완료되지 않게(explosion.ts 선례). */
const MAX_DT = 0.05;
function clampDt(dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  return dt > MAX_DT ? MAX_DT : dt;
}

// 폴백 링 룩(placeholder · defer-balance-tuning).
const FALLBACK_RING_COLOR = 0x9fe8ff;

/** 폴백 팽창 링 재그리기(필터 null 일 때). 반경·알파를 매 프레임 갱신. */
function drawFallbackRing(
  ring: Graphics,
  cx: number,
  cy: number,
  radius: number,
  alpha: number,
): void {
  ring.clear();
  if (radius <= 0 || alpha <= 0.001) return;
  ring
    .circle(cx, cy, radius)
    .stroke({ color: FALLBACK_RING_COLOR, width: Math.max(2, radius * 0.06), alpha: Math.min(1, alpha) });
}

// ===========================================================================
// ShockwaveEffect — 원샷 충격파 링(보스 처치·대형 폭발 순간). AC-3.3.
// ===========================================================================

/** {@link ShockwaveEffect} 옵션. 룩 파라미터는 `shockwave-thick-slow` 승격값이 기본(placeholder). */
export interface ShockwaveEffectOptions {
  /** 링 중심(텍스처 좌표 0..1). 기본 중앙 [0.5, 0.5]. */
  center?: readonly [number, number];
  /** 링이 중심→가장자리로 퍼지는 시간(초). 기본 1.15(thick-slow). */
  durationS?: number;
  /** 최대 변위 진폭(px). 링 중앙 위상에서 최대. 기본 16(thick-slow). */
  amplitude?: number;
  /** 링 반두께(진행도 0..1 단위). 기본 0.16(thick-slow, 굵은 링). */
  width?: number;
  /** 폴백 링 중심(대상 로컬 px). 기본 [0,0]. */
  fallbackCenterPx?: readonly [number, number];
  /** 폴백 링 최대 반경(px). 기본 160. */
  fallbackRadiusPx?: number;
  /** 필터 생성기 주입 seam(테스트·폴백 강제). 기본 실 팩토리. `() => null` 로 폴백 경로 강제. */
  createFilter?: () => Filter | null;
}

/**
 * 원샷 충격파 링. 생성 시 대상에 필터를 부착(또는 폴백 링 child 추가)하고, `update(dt)` 가
 * 진행도로 `uProgress`·`uAmplitude` 를 구동한다. 진행이 duration 을 넘으면 `update` 가 **false** 를
 * 돌려주고, 호출측이 그때 {@link destroy} 로 필터를 해제한다(원샷 — 재발화 없음).
 */
export class ShockwaveEffect {
  private readonly target: Container;
  private readonly filter: Filter | null;
  private readonly fallbackRing: Graphics | null;
  private readonly durationS: number;
  private readonly amplitude: number;
  private readonly fallbackCenterPx: readonly [number, number];
  private readonly fallbackRadiusPx: number;
  private elapsed = 0;
  private done = false;
  private destroyed = false;

  constructor(target: Container, options?: ShockwaveEffectOptions) {
    this.target = target;
    const center = options?.center ?? [0.5, 0.5];
    this.durationS = options?.durationS ?? 1.15;
    this.amplitude = options?.amplitude ?? 16;
    const width = options?.width ?? 0.16;
    this.fallbackCenterPx = options?.fallbackCenterPx ?? [0, 0];
    this.fallbackRadiusPx = options?.fallbackRadiusPx ?? 160;

    const make = options?.createFilter ?? (() => createShockwaveFilter({ center, width, amplitude: 0, progress: 0 }));
    this.filter = make();

    if (this.filter) {
      attachFilter(target, this.filter);
      this.fallbackRing = null;
    } else {
      // 폴백: 필터 없이 단순 팽창 링 Graphics 로 "느낌"만 유지(AC-3.6).
      this.fallbackRing = new Graphics();
      target.addChild(this.fallbackRing);
    }
  }

  /**
   * 진행도로 유니폼(또는 폴백 링)을 갱신한다.
   * @returns 아직 진행 중이면 true, 원샷 수명이 끝났으면 false(호출측이 {@link destroy} 해야 함).
   */
  update(dt: number): boolean {
    if (this.done || this.destroyed) return false;
    this.elapsed += clampDt(dt);
    const p = oneShotProgress(this.elapsed, this.durationS);
    const env = ringEnvelope(p);

    if (this.filter) {
      writeUniforms(this.filter, 'shockwaveUniforms', { uProgress: p, uAmplitude: this.amplitude * env });
    } else if (this.fallbackRing) {
      const [cx, cy] = this.fallbackCenterPx;
      drawFallbackRing(this.fallbackRing, cx, cy, p * this.fallbackRadiusPx, env);
    }

    if (this.elapsed >= this.durationS) {
      this.done = true;
      return false;
    }
    return true;
  }

  /** 자기 필터/폴백 링만 제거하고 정리한다(다른 필터 보존, 이중 destroy 안전). */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.filter) {
      detachFilter(this.target, this.filter);
      try {
        this.filter.destroy();
      } catch {
        // 미컴파일 필터 정리 실패는 무해 — 삼킨다.
      }
    }
    if (this.fallbackRing) this.fallbackRing.destroy();
  }
}

// ===========================================================================
// DissolveEffect — 원샷 사망 디졸브(디더 알파, 아래→위 상승). AC-3.4.
// ===========================================================================

/** {@link DissolveEffect} 옵션. 룩 파라미터는 `dissolve-dither-up` 승격값이 기본(placeholder). */
export interface DissolveEffectOptions {
  /** 소멸 시간(초). 기본 1.1(갤러리 DISSOLVE_SECONDS 승격). */
  durationS?: number;
  /** 방향 모드 스윕 방향(단위 벡터). 기본 [0,-1] = 아래→위 소멸(dither-up). */
  direction?: readonly [number, number];
  /** 디더 셀 크기(px). 기본 4(dither-up). */
  cell?: number;
  /** 디더 지터 대역. 기본 0.35(dither-up). */
  band?: number;
  /** true 면 중심→바깥 방사. 기본 false(dither-up 는 방향 모드). */
  radial?: boolean;
  /** 필터 생성기 주입 seam(테스트·폴백 강제). 기본 실 팩토리. `() => null` 로 폴백 경로 강제. */
  createFilter?: () => Filter | null;
}

/**
 * 원샷 사망 디졸브. 생성 시 대상(스프라이트)에 디더 필터를 부착하고, `update(dt)` 가 `uProgress`
 * 를 0→1 로 몰아 디더 소멸시킨다. 진행이 duration 을 넘으면 `update` 가 **false** 를 돌려주고,
 * 호출측이 그때 대상을 소멸시킬 수 있다(디졸브 완료). 필터 null 이면 컨테이너 alpha 페이드로 폴백.
 */
export class DissolveEffect {
  private readonly target: Container;
  private readonly filter: Filter | null;
  private readonly durationS: number;
  private elapsed = 0;
  private done = false;
  private destroyed = false;

  constructor(target: Container, options?: DissolveEffectOptions) {
    this.target = target;
    this.durationS = options?.durationS ?? 1.1;
    const direction = options?.direction ?? [0, -1];
    const cell = options?.cell ?? 4;
    const band = options?.band ?? 0.35;
    const radial = options?.radial ?? false;

    const make =
      options?.createFilter ?? (() => createDissolveFilter({ direction, cell, band, radial, progress: 0 }));
    this.filter = make();

    if (this.filter) attachFilter(target, this.filter);
  }

  /**
   * 소멸 진행도로 `uProgress`(필터) 또는 컨테이너 alpha(폴백)를 구동한다.
   * @returns 아직 소멸 중이면 true, 완전 소멸(원샷 종료)이면 false(호출측이 대상 소멸 가능).
   */
  update(dt: number): boolean {
    if (this.done || this.destroyed) return false;
    this.elapsed += clampDt(dt);
    const p = oneShotProgress(this.elapsed, this.durationS);

    if (this.filter) {
      // 디더 알파는 필터가 픽셀별로 지운다 — 컨테이너 alpha 는 온전 유지.
      writeUniforms(this.filter, 'dissolveUniforms', { uProgress: p });
      this.target.alpha = 1;
    } else {
      // 폴백: 필터 없이 단순 alpha 페이드로 소멸.
      this.target.alpha = 1 - p;
    }

    if (this.elapsed >= this.durationS) {
      this.done = true;
      return false;
    }
    return true;
  }

  /** 자기 필터만 제거하고 정리한다(대상 표시 객체는 호출측 소유 — 파괴하지 않는다). 이중 destroy 안전. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.filter) {
      detachFilter(this.target, this.filter);
      try {
        this.filter.destroy();
      } catch {
        // 미컴파일 필터 정리 실패는 무해 — 삼킨다.
      }
    }
  }
}

// ===========================================================================
// ShimmerEffect — 지속형 히트 시머(용암 해저드·보스 과열 창 국소 변위). AC-3.2.
// ===========================================================================

/** {@link ShimmerEffect} 옵션. 지속형이라 갤러리 선택 없음 — 룩은 placeholder(defer-balance-tuning). */
export interface ShimmerEffectOptions {
  /** 수평 변위 세기(px). 기본 3(placeholder). 0 이면 필터가 passthrough. */
  strength?: number;
  /** uTime 진행 속도(초당 위상 배율). 기본 6(placeholder — 흔들림 주기). */
  speed?: number;
  /** 필터 생성기 주입 seam(테스트·폴백 강제). 기본 실 팩토리. `() => null` 로 폴백 경로 강제. */
  createFilter?: () => Filter | null;
}

/**
 * 지속형 히트 시머. 생성 시 대상(용암 해저드/보스)에 변위 필터를 부착하고, `update(dt)` 가 `uTime`
 * 을 연속 구동한다(원샷 아님 — 종료 신호 없음). 명시적으로 {@link detach} 해 필터를 제거한다.
 * 필터 null 이면 no-op 폴백(효과 생략, 게임 불사망).
 */
export class ShimmerEffect {
  private readonly target: Container;
  private readonly filter: Filter | null;
  private readonly speed: number;
  private time = 0;
  private detached = false;

  constructor(target: Container, options?: ShimmerEffectOptions) {
    this.target = target;
    const strength = options?.strength ?? 3;
    this.speed = options?.speed ?? 6;

    const make = options?.createFilter ?? (() => createShimmerFilter({ strength, time: 0 }));
    this.filter = make();

    if (this.filter) attachFilter(target, this.filter);
  }

  /** 위상을 누적해 `uTime` 을 갱신한다(지속형 — 반환값 없음). 필터 null 이면 no-op. */
  update(dt: number): void {
    if (this.detached) return;
    if (!this.filter) return; // 폴백 no-op
    this.time += clampDt(dt) * this.speed;
    writeUniforms(this.filter, 'shimmerUniforms', { uTime: this.time });
  }

  /** 자기 필터만 제거하고 정리한다(다른 필터 보존, 이중 detach 안전). */
  detach(): void {
    if (this.detached) return;
    this.detached = true;
    if (this.filter) {
      detachFilter(this.target, this.filter);
      try {
        this.filter.destroy();
      } catch {
        // 미컴파일 필터 정리 실패는 무해 — 삼킨다.
      }
    }
  }

  /** {@link detach} 별칭 — 세 컨트롤러의 정리 API 를 통일한다. */
  destroy(): void {
    this.detach();
  }
}
