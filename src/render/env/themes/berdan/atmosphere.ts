/**
 * 베르단 대기 테마 데이터 — 낮게 깔린 **습지 안개** · 떠다니는 **포자** · 바닥에서 오르는
 * **부식성 증기** · 산웅덩이 위의 **발광 알갱이**.
 *
 * 여기 남기는 주석은 **베르단 근거**뿐이다. 왜 이런 모양의 데이터인가(면적이 기여도의 지배항인
 * 이유·상태 없는 입자·링 알파 역산)는 메커니즘이라 `src/render/env/atmosphere.ts` 와
 * `../../contracts/atmosphere.ts` 에 있다.
 *
 * ## 이 행성에서 배분이 이렇게 나온 이유
 * 대기가 안전한 자리는 탄의 정확한 반대("넓은 면적 × 낮은 진폭 × 최저 속도")뿐이라 축의 성격은
 * 행성 무관이다. 베르단이 카르곤과 다른 것은 셋이다:
 *  1. **안개가 주력**이다. 습지는 공기가 무겁고, 그게 이 행성의 첫인상이어야 한다.
 *  2. **알갱이가 위로도 아래로도 가지 않는다.** 포자는 뜨는 것도 떨어지는 것도 아니라
 *     떠다니므로 좌우 흐름(`driftTurns`)을 주고 상승 속도를 최저로 눌렀다.
 *  3. **전용 알갱이 프로파일**을 쓴다({@link SPORE_PROFILE}) — 잔불의 뾰족한 점도, 연기의
 *     넓은 덩어리도 아닌 중간이다.
 */

import {
  DOT_PROFILE,
  PUFF_PROFILE,
  countsFromTuning,
  periodTicksForScreenSpeed,
  type AtmosphereField,
  type AtmosphereTheme,
  type FieldTuning,
  type TextureProfile,
} from '../../contracts/atmosphere.js';

/**
 * 이 행성 지형의 대표 어두운 진창색.
 *
 * ⚠️ **기여도 모델의 기준이라 반드시 이 행성 것이어야 한다.** 카르곤 1차의 "보이지 않는 입자"
 * 결함이 바로 이 기준과 틴트의 채널차가 6 이었던 것이다. 여기 값은 타일 프리뷰(seed 12345)의
 * 어두운 35% 표본 rgb(13.5, 17.3, 14.5) 에, 카르곤이 같은 표본(20.1, 15.4, 15.6)에서 선언값
 * 0x2a2422 로 간 배율 ≈2.2 를 곱해 얻었다(프리뷰에는 환경 레이어가 없어 실제 화면보다 어둡다).
 */
const BACKDROP = { r: 0x1e, g: 0x26, b: 0x20 } as const;

/**
 * **포자 알갱이 프로파일.** `(1−t)^1.35` — 잔불 알갱이(`(1−t)²`, 채움 1/6)보다 살짝 넓고
 * 덩어리(채움 0.4)보다 훨씬 좁다(채움 ≈ 0.34). 포자는 점도 뭉치도 아니라 **가장자리가 무른
 * 알갱이**다.
 *
 * 이 프로파일이 여기 있는 것 자체가 계약의 요점이다 — 예전 구현은 `'dot' | 'puff'` 로 닫혀
 * 있어 행성 고유의 알갱이를 넣으려면 공용 파일 세 자리를 고쳐야 했고, 그러면 병렬 레인이
 * 충돌한다. 지금은 테마 파일 안에서 끝난다.
 */
const SPORE_PROFILE: TextureProfile = {
  id: 'berdan-spore',
  alphaAt(t: number): number {
    const s = 1 - (t < 0 ? 0 : t > 1 ? 1 : t);
    return Math.pow(s, 1.35);
  },
};

/**
 * 네 필드의 **세기**. 타일셋 그림과 침출 발광이 바뀌면 재조정할 자리가 여기 하나다
 * (필드의 성격 — 방향·시차·색·합성·흔들림 — 은 아래 정의에, 세기는 전부 여기에).
 */
export const BERDAN_ATMOSPHERE_TUNING = {
  mist: { count: 12, countMin: 5, minRadius: 120, maxRadius: 290, alpha: 0.28 },
  spore: { count: 24, countMin: 9, minRadius: 2.2, maxRadius: 5.0, alpha: 0.42 },
  vapour: { count: 9, countMin: 3, minRadius: 55, maxRadius: 135, alpha: 0.14 },
  glimmer: { count: 26, countMin: 10, minRadius: 1.5, maxRadius: 4.0, alpha: 0.46 },
} as const satisfies Record<string, FieldTuning>;

/** 포자의 화면상 **떠도는** 속도(px/s). 탄(초당 수천 px)과 두 자릿수 배 차이를 확보한다. */
const SPORE_SPEED_PX_PER_SEC = 48;
/** 주기를 뽑을 때 쓴 화면 세로(패딩 포함 근사). */
const SPORE_TRAVEL_PX = 1350;

/**
 * 습지 안개 — 크고 옅은 반투명 뭉치가 화면을 아주 느리게 가로지른다. **화면 기여의 주력**이며
 * 이 행성의 첫인상이다. 시차 계수를 가장 작게 둬 제일 뒤에 깔린 층으로 읽힌다.
 * 세로로 납작한 이유(`aspect` 0.5)는 습지 안개가 지면에 눕기 때문이다.
 */
const MIST: AtmosphereField = {
  name: 'mist',
  key: 0x1a,
  role: 'veil',
  counts: countsFromTuning(BERDAN_ATMOSPHERE_TUNING.mist),
  riseUp: true,
  periodTicks: 3400,
  periodJitter: 0.45,
  minRadius: BERDAN_ATMOSPHERE_TUNING.mist.minRadius,
  maxRadius: BERDAN_ATMOSPHERE_TUNING.mist.maxRadius,
  aspect: 0.5,
  maxAlpha: BERDAN_ATMOSPHERE_TUNING.mist.alpha,
  bandStart: 0,
  bandSpan: 1,
  swayPx: 44,
  swayCycles: 0.6,
  // 한 수명 동안 화면 폭을 한 번 가로지른다(가로 흐름축).
  driftTurns: 1,
  parallax: 0.1,
  tint: 0x6e8478,
  additive: false,
  flicker: 0,
  glowSensitive: false,
  profile: PUFF_PROFILE,
};

/**
 * 포자 — **뜨지도 떨어지지도 않는다.** 상승 속도를 최저로 누르고 가로 흐름을 얹어 "떠다닌다"를
 * 만든다. 틴트는 배경(0x1e2620)과 채널차 합 390 으로 확실히 갈린다.
 */
const SPORE: AtmosphereField = {
  name: 'spore',
  key: 0x2b,
  role: 'mote',
  counts: countsFromTuning(BERDAN_ATMOSPHERE_TUNING.spore),
  riseUp: true,
  periodTicks: periodTicksForScreenSpeed(SPORE_SPEED_PX_PER_SEC, SPORE_TRAVEL_PX),
  periodJitter: 0.42,
  minRadius: BERDAN_ATMOSPHERE_TUNING.spore.minRadius,
  maxRadius: BERDAN_ATMOSPHERE_TUNING.spore.maxRadius,
  aspect: 1,
  maxAlpha: BERDAN_ATMOSPHERE_TUNING.spore.alpha,
  bandStart: 0,
  bandSpan: 1,
  swayPx: 38,
  swayCycles: 1.8,
  driftTurns: 0.35,
  parallax: 0.24,
  tint: 0x8cc49a,
  additive: false,
  flicker: 0,
  glowSensitive: false,
  profile: SPORE_PROFILE,
};

/**
 * 부식성 증기 — 산이 지반을 갉으며 솟는 김. 세로 대역을 하단 절반에 가둔다(산은 저지에 고인다).
 * 지형광의 `plume` 과 같은 물리를 대기 쪽에서 잇는 필드라 세로 늘임(2.2)도 그쪽(1.12)처럼
 * 카르곤 열기 기둥(2.6)보다 무르다.
 */
const VAPOUR: AtmosphereField = {
  name: 'vapour',
  key: 0x3c,
  role: 'veil',
  counts: countsFromTuning(BERDAN_ATMOSPHERE_TUNING.vapour),
  riseUp: true,
  periodTicks: 1300,
  periodJitter: 0.3,
  minRadius: BERDAN_ATMOSPHERE_TUNING.vapour.minRadius,
  maxRadius: BERDAN_ATMOSPHERE_TUNING.vapour.maxRadius,
  aspect: 2.2,
  maxAlpha: BERDAN_ATMOSPHERE_TUNING.vapour.alpha,
  bandStart: 0.5,
  bandSpan: 0.5,
  swayPx: 20,
  swayCycles: 2.6,
  driftTurns: 0,
  parallax: 0.17,
  tint: 0x3ecf86,
  additive: true,
  flicker: 0.3,
  glowSensitive: true,
  profile: PUFF_PROFILE,
};

/**
 * 발광 알갱이 — 산웅덩이 위에서 명멸하는 생물 발광. 흰 코어 없는 채도 높은 형광 녹이라
 * 색만으로도 탄(흰 코어 + 청록/적색 링)과 갈리고, 채널 스팬 140 으로 "무채색 밝은 점 = 탄의
 * 흰 코어 신호" 함정도 피한다. 시차를 가장 크게 — 화면 제일 앞에 떠 있는 층이다.
 */
const GLIMMER: AtmosphereField = {
  name: 'glimmer',
  key: 0x4d,
  role: 'spark',
  counts: countsFromTuning(BERDAN_ATMOSPHERE_TUNING.glimmer),
  riseUp: true,
  periodTicks: 1900,
  periodJitter: 0.35,
  minRadius: BERDAN_ATMOSPHERE_TUNING.glimmer.minRadius,
  maxRadius: BERDAN_ATMOSPHERE_TUNING.glimmer.maxRadius,
  aspect: 1,
  maxAlpha: BERDAN_ATMOSPHERE_TUNING.glimmer.alpha,
  bandStart: 0,
  bandSpan: 1,
  swayPx: 24,
  swayCycles: 2.2,
  driftTurns: 0,
  parallax: 0.33,
  tint: 0x66f2a8,
  additive: true,
  flicker: 0.5,
  glowSensitive: true,
  profile: DOT_PROFILE,
};

export const BERDAN_ATMOSPHERE: AtmosphereTheme = {
  themeId: 'berdan',
  referenceBackdrop: BACKDROP,
  /** 뒤 → 앞 순서로 그린다: 안개 → 증기 → 포자 → 발광 알갱이. */
  fields: [MIST, VAPOUR, SPORE, GLIMMER],
};
