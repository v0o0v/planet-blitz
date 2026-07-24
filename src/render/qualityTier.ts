/**
 * 품질 티어 선택 + 이펙트 게이팅 (Phase 0 — plan §AC-0.4·0.6; ADR-0031).
 *
 * 두 순수함수를 제공한다:
 *  1. {@link selectTier} — FPS 롤링 평균 → 티어(low/med/high). **이력현상(hysteresis)**으로
 *     단조 1단계씩만 강등/승격해 임계 근처 진동을 막는다. 수동 오버라이드가 자동을 잠근다.
 *  2. {@link effectGates} — (티어 × 감소 토글) → boolean 이펙트 게이트 구조. 티어가 상한을
 *     정하고, 접근성 감소 토글이 티어와 **직교**로 특정 이펙트를 덮어 끈다.
 *
 * ── 결정론(ADR-0005) ── 순수함수뿐이라 sim·해시 무접촉(render-only 파생). 입력만으로 출력이
 * 정해져 결정적이다(부작용·시각 없음).
 *
 * ── 밸런스 유예(defer-balance-tuning) ── FPS 임계({@link TIER_DOWNGRADE_FPS}/
 * {@link TIER_UPGRADE_FPS})와 티어별 게이트 기본표는 전부 placeholder 다. 실제 강등 체감·저사양
 * 프레임 예산은 출시 직전 하네스 벤치(AC-6.4)에서 일괄 튜닝한다.
 */

import type { GraphicsSettings } from './graphicsSettings.js';

/** 자동 적응 대상 실 티어(설정의 'auto' 는 이 셋 중 하나로 해석된다). */
export type QualityTier = 'low' | 'med' | 'high';

/**
 * 강등 임계(FPS). 롤링 평균이 이 값 **미만**이면 한 단계 강등. placeholder, defer-balance-tuning.
 * 60fps 타깃에서 "의미 있게 떨어졌다"의 잠정 경계.
 */
export const TIER_DOWNGRADE_FPS = 45;

/**
 * 승격(복귀) 임계(FPS). 롤링 평균이 이 값 **초과**여야 한 단계 승격. **강등 임계보다 높게** 둬
 * 그 사이 [45,55] 를 무변화 이력현상 대역으로 만든다 → 단일 임계 근처 왕복(진동) 방지.
 * placeholder, defer-balance-tuning.
 */
export const TIER_UPGRADE_FPS = 55;

/** 저→고 순서(1단계 이동용 인덱스 축). */
const TIER_ORDER: readonly QualityTier[] = ['low', 'med', 'high'];

/**
 * 티어 선택(순수함수). 이력현상으로 진동을 막고 단조 1단계씩만 이동한다.
 *
 * - `manualOverride` 가 구체 티어('low'|'med'|'high')면 그대로 반환 — **수동이 자동을 잠근다**
 *   (FPS 무시).
 * - 'auto' 면 FPS 기반:
 *   - fps < {@link TIER_DOWNGRADE_FPS} → 한 단계 강등(high→med→low). 이미 low 면 그대로.
 *   - fps > {@link TIER_UPGRADE_FPS} → 한 단계 승격(low→med→high). 이미 high 면 그대로.
 *   - 그 사이(이력 대역) → 변화 없음(진동 금지).
 * - fps 가 유한하지 않으면(NaN/∞) 방어적으로 현재 티어 유지.
 *
 * @param currentTier 직전 프레임까지의 활성 실 티어.
 * @param fpsAvg      FPS 롤링 평균(예: 2초 창; 이 함수는 창 산출을 모른다 — 값만 받는다).
 * @param manualOverride 설정의 quality('auto' 면 자동, 구체 티어면 잠금).
 */
export function selectTier(
  currentTier: QualityTier,
  fpsAvg: number,
  manualOverride: 'auto' | QualityTier,
): QualityTier {
  // 수동 오버라이드가 자동을 잠근다.
  if (manualOverride !== 'auto') return manualOverride;
  // 방어: 비유한 FPS 는 판단 불가 → 현재 티어 유지.
  if (!Number.isFinite(fpsAvg)) return currentTier;

  const idx = TIER_ORDER.indexOf(currentTier);
  // 손상된 현재 티어는 최고 티어로 취급(자동 강등이 끌어내린다).
  const safeIdx = idx < 0 ? TIER_ORDER.length - 1 : idx;

  if (fpsAvg < TIER_DOWNGRADE_FPS && safeIdx > 0) {
    const down = TIER_ORDER[safeIdx - 1];
    if (down) return down; // 단조 1단계 강등.
  }
  if (fpsAvg > TIER_UPGRADE_FPS && safeIdx < TIER_ORDER.length - 1) {
    const up = TIER_ORDER[safeIdx + 1];
    if (up) return up; // 단조 1단계 승격.
  }
  // 이력 대역/경계: 무변화. safeIdx 는 항상 유효 범위라 ?? 는 noUncheckedIndexedAccess 형식 방어일 뿐.
  return TIER_ORDER[safeIdx] ?? currentTier;
}

/**
 * 이펙트 게이트 구조(불리언 on/off + 파티클 3단). 각 렌더 서브시스템이 이 게이트를 읽어
 * 자신의 이펙트를 켜고 끈다. `particles` 만 3단계('off'|'min'|'normal')이고 나머지는 불리언.
 */
export interface EffectGates {
  /** 화면 흔들림(카메라 트라우마 오프셋). 모션 감소축. */
  shake: boolean;
  /** 히트 플래시(피격 대상 화이트 틴트). 모션 감소축. */
  hitFlash: boolean;
  /** 파티클 폭발 밀도. 'off'=없음, 'min'=최소, 'normal'=정상. */
  particles: 'off' | 'min' | 'normal';
  /** 가산 스프라이트 헤일로(발광 기본, 필터 0). 발광 감소축. */
  halo: boolean;
  /** 블룸 필터 1패스(고티어 발광). 발광 감소축. */
  bloom: boolean;
  /** 이벤트 셰이더(히트 시머·충격파·디졸브 GLSL). 고티어 전용. */
  eventShaders: boolean;
  /** 탄 트레일(가산 스트릭). 티어별 on/off. */
  trails: boolean;
}

/**
 * 티어 × 감소 토글 → 이펙트 게이트(순수함수).
 *
 * **티어 기본표(placeholder, defer-balance-tuning)** — 상위 티어가 하위의 상위집합(단조):
 *  - Low : 발광(halo)·흔들림(shake)·블룸(bloom) 없음, 파티클 min, 트레일/이벤트셰이더 off.
 *  - Med : halo + shake + 파티클 normal + 트레일. 블룸/이벤트셰이더는 아직 off.
 *  - High: 위 전부 + bloom + eventShaders.
 *  - hitFlash 는 저렴한 핵심 전투 피드백이라 **전 티어 on**(피격 귀속 가독). 감소축(모션)에서만 끈다.
 *
 * **감소 토글은 티어와 직교로 덮어쓴다**(AC-0.6):
 *  - `reducedMotion` → shake·hitFlash 끔(어느 티어든).
 *  - `reducedGlow`   → halo·bloom 끔(어느 티어든).
 * 나머지 게이트(particles·eventShaders·trails)는 감소 토글의 영향을 받지 않는다.
 */
export function effectGates(tier: QualityTier, settings: GraphicsSettings): EffectGates {
  // 티어 기본표(placeholder, defer-balance-tuning).
  const base: EffectGates =
    tier === 'low'
      ? {
          shake: false,
          hitFlash: true,
          particles: 'min',
          halo: false,
          bloom: false,
          eventShaders: false,
          trails: false,
        }
      : tier === 'med'
        ? {
            shake: true,
            hitFlash: true,
            particles: 'normal',
            halo: true,
            bloom: false,
            eventShaders: false,
            trails: true,
          }
        : {
            shake: true,
            hitFlash: true,
            particles: 'normal',
            halo: true,
            bloom: true,
            eventShaders: true,
            trails: true,
          };

  // 감소 토글은 티어와 직교로 특정 이펙트를 끈다.
  if (settings.reducedMotion) {
    base.shake = false;
    base.hitFlash = false;
  }
  if (settings.reducedGlow) {
    base.halo = false;
    base.bloom = false;
  }
  return base;
}
