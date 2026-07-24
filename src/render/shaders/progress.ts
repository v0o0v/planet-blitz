/**
 * 셰이더 진행도 순수함수 — AC-3.5 유닛 참조 구현 (Phase 3).
 *
 * 이벤트 셰이더 3종(충격파 링·사망 디졸브·용암/보스 과열 시머)의 시간→진행도 사상을 렌더 상태와
 * 완전히 분리한 **순수함수**로 모은다. 셰이더 유니폼(`uProgress`·`uTime` 등)에 공급될 값은 오직
 * **경과 시간의 함수**이지, 프레임 수·wall clock·난수에 의존하지 않는다.
 *
 * ⚠️ **배선 현황(오해 방지):** 이 모듈은 AC-3.5 순수함수 유닛(`tests/shaderProgress.test.ts`)의
 * 참조 구현이며, **현재 어떤 프로덕션 코드도 import 하지 않는다**. 실 이벤트 컨트롤러
 * ([src/render/effects/shaderEffects.ts])는 레인 병렬 레이스 회피를 위해 자체 로컬 진행 로직
 * (`oneShotProgress`·`ringEnvelope`)을 인라인한다. 특히 아래 {@link dissolveProgress} 는 HOLD→DISSOLVE
 * **2구간** 모델인데, 배선된 `DissolveEffect` 는 HOLD 없는 단순 원샷이다 — **의미가 다르므로**,
 * 훗날 "정본" 이라 여겨 shaderEffects.ts 를 이 모듈로 통합하면 디졸브에 0.4초 HOLD 가 조용히 생기는
 * 거동 회귀가 든다. 통합하려면 먼저 HOLD 의미차부터 정합할 것.
 *
 * ## 왜 순수함수인가
 * - **결정론 불변(ADR-0005):** 이 모듈은 render-only 다 — sim 상태·`hashWorld`/`hashEntity` 에
 *   절대 접히지 않는다. Date/random 미사용.
 * - **탭 복귀 안정:** 렌더 프레임 수가 아니라 누적 경과(초)만의 함수라, 탭이 멈췄다 돌아와도
 *   진행도가 튀지 않고 정확한 위치에서 이어진다([backdropCrossfadeAlpha] 선례).
 * - **NaN·퇴화 내성:** 비정상 입력(음수·NaN·∞·0 나눗셈)에서도 출력이 항상 유계(진행도 [0,1],
 *   시머 위상 유한)라, 유니폼에 오염값을 흘리지 않는다.
 *
 * ## 갤러리 변형과의 관계
 * 갤러리 변형([src/harness/gallery/shockwaveVariants.ts]·[dissolveVariants.ts])은 DEV 전용이며
 * 각자 로컬 진행도 함수를 갖는다. `shockwaveProgress` 는 갤러리판과 동형(이식)이고, `dissolveProgress`
 * 는 갤러리의 주기 반복형(`dissolveCycleProgress`)과 달리 **원샷 사망 연출용**이라 0→1 을 한 번만
 * 밟고 이후 1 에 머문다(재발화 없음). 위 배선 현황 주석대로 이 구현들은 참조·검증용이다.
 *
 * 굵기·주기·시머 속도 등 밸런스 상수는 전부 **placeholder** 다(defer-balance-tuning — 출시 직전 일괄).
 */

// ──────────────────────────────────────────────────────────────────────────
// placeholder 상수 (defer-balance-tuning). 밸런스 튜닝은 출시 직전 일괄.
// ──────────────────────────────────────────────────────────────────────────

/** 사망 디졸브 기본 HOLD(초) — 온전 유지 구간. */
export const DEFAULT_DISSOLVE_HOLD_S = 0.4;

/** 사망 디졸브 기본 DISSOLVE(초) — 0→1 소멸 구간 길이. */
export const DEFAULT_DISSOLVE_SPAN_S = 1.1;

/** 시머 각속도(rad/s) — 누적 위상 증가율. sin(... + phase) 규약이라 위상은 라디안. */
export const SHIMMER_ANGULAR_RATE = 2 * Math.PI;

// ──────────────────────────────────────────────────────────────────────────
// 진행도 순수함수
// ──────────────────────────────────────────────────────────────────────────

/**
 * 충격파 링 반경 진행도(AC-3.3/3.5). 경과 `elapsed`(초)를 [0,1] 진행도로 사상한다.
 * 갤러리판 `shockwaveProgress` 와 **동형(이식)** — 프로덕션 정본.
 *
 * - 경계: `elapsed <= 0`(음수·0·NaN) → 0, `elapsed >= duration` → 1(상한 클램프).
 * - 단조: `[0, duration]` 에서 elapsed 에 대해 단조 비감소(선형).
 * - 퇴화: `duration <= 0`(또는 NaN) → 1(즉시 완료, 0 나눗셈 방지).
 * - ∞ 내성: elapsed=∞ → 1(≥duration), duration=∞ → 0(미완). 항상 유계 [0,1].
 *
 * 두 인자가 동시에 퇴화할 때(elapsed≤0 AND duration≤0/NaN)는 elapsed 게이트가 우선해 0 을 준다
 * (아직 아무것도 시작되지 않음) — 갤러리판과 동일 선후.
 */
export function shockwaveProgress(elapsed: number, duration: number): number {
  if (!(elapsed > 0)) return 0; // 음수·0·NaN elapsed → 시작 전(0)
  if (!(duration > 0)) return 1; // 퇴화 duration(≤0·NaN) → 즉시 완료(0 나눗셈 방지)
  if (elapsed >= duration) return 1; // 상한 클램프(∞ 포함)
  return elapsed / duration; // [0,1) 단조 증가
}

/**
 * 사망 디졸브 진행도(AC-3.4/3.5). 누적 경과 `elapsed`(초)를 진행도로 사상한다:
 * `HOLD`(0..hold) 구간 0 유지 → `DISSOLVE`(hold..hold+dissolve) 구간 0→1 단조 → 이후 1.
 *
 * 갤러리의 주기 반복형(`dissolveCycleProgress`)과 달리 **원샷**이라 재발화 없이 1 에 머문다
 * (프로덕션 소멸은 엔티티가 한 번 사라지는 연출이라 반복이 없다).
 *
 * - `hold`/`dissolve` 기본 = placeholder 상수(defer-balance-tuning). 호출부가 override 가능.
 * - 경계: `elapsed <= hold` → 0, `elapsed >= hold+dissolve` → 1.
 * - 단조: 전 구간 단조 비감소(HOLD 평탄 0 → DISSOLVE 선형 상승 → 평탄 1).
 * - 내성: 음수·NaN elapsed → 0, 음수·NaN hold → 0(즉시 소멸), 퇴화 dissolve(≤0·NaN) →
 *   hold 넘겼으면 1, ∞ 입력 → 유계로 클램프. 출력 항상 [0,1].
 */
export function dissolveProgress(
  elapsed: number,
  hold: number = DEFAULT_DISSOLVE_HOLD_S,
  dissolve: number = DEFAULT_DISSOLVE_SPAN_S,
): number {
  if (!(elapsed > 0)) return 0; // 음수·0·NaN elapsed → 온전(0)
  const h = hold > 0 ? hold : 0; // 음수·NaN hold → 0(즉시 디졸브 시작)
  if (elapsed <= h) return 0; // HOLD 구간: 온전 유지
  if (!(dissolve > 0)) return 1; // 퇴화 dissolve(≤0·NaN): hold 넘겼으니 즉시 완료
  const t = (elapsed - h) / dissolve; // DISSOLVE 정규화 진행도
  if (!(t < 1)) return 1; // t≥1·NaN·∞ → 완료(상한·비유한 방어)
  return t > 0 ? t : 0; // [0,1) 단조
}

/**
 * 시머 누적 위상(AC-3.2/3.5). 경과 `elapsed`(초)를 셰이더 `uTime`(라디안)으로 사상한다.
 * 용암 해저드·보스 과열 창 위 변위 필터(`createShimmerFilter`)의 애니메이션 위상이다.
 *
 * **누적 위상**(elapsed·rate)이라 단조 증가한다 — [0,2π) 로 wrap 하면 경계에서 리셋돼 단조성이
 * 깨지므로, 유니폼에 그대로 실을 연속·단조 위상을 택했다. 소비부가 `sin(위상)` 을 계산하므로
 * 주기성은 GLSL 쪽에서 자연히 생긴다.
 *
 * - 단조: 유한 양수 elapsed 에 대해 강 증가, elapsed≤0 은 0.
 * - 내성: NaN·∞·음수·0 → 0(유니폼에 비유한/오염값 유입 차단).
 * - 정밀: 매우 큰 elapsed 에서 f32 위상 정밀도 손실은 시머 룩에 무해(defer).
 */
export function shimmerPhase(elapsed: number): number {
  if (!Number.isFinite(elapsed) || elapsed <= 0) return 0; // NaN·∞·음수·0 방어
  return elapsed * SHIMMER_ANGULAR_RATE; // 누적 위상(라디안), 단조 증가
}
