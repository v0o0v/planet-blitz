/**
 * 카르곤 대기 테마 데이터 — 떠오르는 **잔불**·낙하하는 **화산재**·흘러가는 **연기 결**·
 * 바닥에서 솟는 **열기 기둥**.
 *
 * 여기 남기는 주석은 **카르곤 실측 근거**뿐이다. 왜 이런 모양의 데이터인가(면적이 기여도의
 * 지배항인 이유·상태 없는 입자·링 알파 역산)는 메커니즘이라 `src/render/env/atmosphere.ts` 와
 * `../../contracts/atmosphere.ts` 에 있다.
 *
 * ## 카르곤 실측 요약
 * 1차 구현은 화면 기여도 **0.45**(RGB 합산 절대차 평균, 노이즈 바닥 0.12)로 측정돼 기각됐다.
 * 개별 결정은 전부 합리적이었고 곱해진 결과가 0 이었다 — 네 개의 보수적 판단(잔불 축소·연기
 * 알파 0.09·화산재 틴트가 배경과 채널차 6·구운 텍스처 중심 알파 0.61)이 겹쳤다.
 * 2차는 축을 최소화하는 대신 **재배분**했다:
 *
 * | 필드 | 1차 (합 0.45) | 2차 | 이 행성에서의 이유 |
 * |---|---|---|---|
 * | ember | 30개·2.6px·a0.42 | 30개·4.0px·a0.50 | 개수는 그대로, 개체만 확대 |
 * | ash   | 22개·2.8px·a0.34 | 24개·5.0px·a0.40 | 틴트를 배경(≈0x2a2422)에서 분리 |
 * | smoke | 6개·210px·a0.09  | 11개·300px·a0.26 | 주력 — 큰 면적·낮은 진폭 |
 * | heat  | 4개·96px·a0.055  | 9개·130px·a0.14  | 주력 — 카르곤은 화산이라 열이 아래에서 온다 |
 */

import {
  DOT_PROFILE,
  PUFF_PROFILE,
  countsFromTuning,
  periodTicksForScreenSpeed,
  type AtmosphereField,
  type AtmosphereTheme,
  type FieldTuning,
} from '../../contracts/atmosphere.js';

/**
 * 카르곤 지형의 대표 어두운 암반색. 실측 스크린샷에서 지형이 화면의 대부분을 차지하므로 이 한
 * 색으로 근사한다. 화산재 틴트가 이 색과 채널차 6 이었던 것이 1차의 "보이지 않는 입자" 결함이다.
 */
const BACKDROP = { r: 0x2a, g: 0x24, b: 0x22 } as const;

/**
 * 네 필드의 **세기**. 타일셋 그림과 용암 발광이 바뀌면 재조정할 자리가 여기 하나다
 * (필드의 성격 — 방향·시차·색·합성·흔들림 — 은 아래 정의에, 세기는 전부 여기에).
 */
export const KARGON_ATMOSPHERE_TUNING = {
  ember: { count: 30, countMin: 12, minRadius: 1.6, maxRadius: 4.0, alpha: 0.5 },
  ash: { count: 24, countMin: 9, minRadius: 2.4, maxRadius: 5.0, alpha: 0.4 },
  smoke: { count: 11, countMin: 4, minRadius: 130, maxRadius: 300, alpha: 0.26 },
  heat: { count: 9, countMin: 3, minRadius: 55, maxRadius: 130, alpha: 0.14 },
} as const satisfies Record<string, FieldTuning>;

/**
 * 잔불의 화면상 상승 속도(px/s). **2차에서 더 벌린 축**이다(74 → 62). 크기·알파를 올린 만큼
 * 여기서 되갚았다 — 탄은 초당 수천 px 라 속도비가 30배를 넘고, 눈은 속도차가 두 자릿수 배면
 * 두 대상을 다른 범주로 분류한다.
 */
const EMBER_SPEED_PX_PER_SEC = 62;

/** 잔불 주기를 뽑을 때 쓴 화면 세로(패딩 포함 실측 근사). */
const EMBER_TRAVEL_PX = 1350;

/**
 * 잔불 — 아래에서 위로 아주 느리게 상승하며 좌우로 흔들리고, 밝기가 명멸하다 사라진다.
 * 흰 코어 없는 채도 높은 주황이라 색만으로도 탄(흰 코어 + 청록/적색 링)과 갈린다.
 */
const EMBER: AtmosphereField = {
  name: 'ember',
  key: 0x1a,
  role: 'spark',
  counts: countsFromTuning(KARGON_ATMOSPHERE_TUNING.ember),
  riseUp: true,
  periodTicks: periodTicksForScreenSpeed(EMBER_SPEED_PX_PER_SEC, EMBER_TRAVEL_PX),
  periodJitter: 0.35,
  minRadius: KARGON_ATMOSPHERE_TUNING.ember.minRadius,
  maxRadius: KARGON_ATMOSPHERE_TUNING.ember.maxRadius,
  aspect: 1,
  maxAlpha: KARGON_ATMOSPHERE_TUNING.ember.alpha,
  bandStart: 0,
  bandSpan: 1,
  swayPx: 26,
  swayCycles: 2.5,
  driftTurns: 0,
  // 시차를 가장 크게 — 잔불이 화면 제일 앞에 떠 있는 층이다.
  parallax: 0.34,
  tint: 0xff7a1e,
  additive: true,
  flicker: 0.55,
  glowSensitive: true,
  profile: DOT_PROFILE,
};

/**
 * 화산재 — 작은 입자가 천천히 **떨어진다**. 잔불과 방향이 반대라 그것만으로 대비가 생긴다.
 *
 * 1차 틴트 0x2a2220 은 배경(≈0x2a2422)과 채널차가 6 이라, 알파를 아무리 올려도 보이지 않는
 * 입자를 22개 그리고 있었다. 배경보다 확실히 밝은 회갈색으로 올려 채널차 합 266 을 얻었다.
 */
const ASH: AtmosphereField = {
  name: 'ash',
  key: 0x2b,
  role: 'mote',
  counts: countsFromTuning(KARGON_ATMOSPHERE_TUNING.ash),
  riseUp: false,
  periodTicks: 1600,
  periodJitter: 0.4,
  minRadius: KARGON_ATMOSPHERE_TUNING.ash.minRadius,
  maxRadius: KARGON_ATMOSPHERE_TUNING.ash.maxRadius,
  aspect: 1,
  maxAlpha: KARGON_ATMOSPHERE_TUNING.ash.alpha,
  bandStart: 0,
  bandSpan: 1,
  swayPx: 34,
  swayCycles: 1.5,
  driftTurns: 0,
  parallax: 0.22,
  tint: 0x8a7d73,
  additive: false,
  flicker: 0,
  glowSensitive: false,
  profile: DOT_PROFILE,
};

/**
 * 연기·연무 결 — 크고 옅은 반투명 뭉치가 화면을 아주 느리게 가로지른다. **화면 기여의 주력 1**.
 * 시차 계수를 잔불보다 작게 둬 뒤에 있는 층으로 읽힌다.
 */
const SMOKE: AtmosphereField = {
  name: 'smoke',
  key: 0x3c,
  role: 'veil',
  counts: countsFromTuning(KARGON_ATMOSPHERE_TUNING.smoke),
  riseUp: true,
  periodTicks: 3000,
  periodJitter: 0.45,
  minRadius: KARGON_ATMOSPHERE_TUNING.smoke.minRadius,
  maxRadius: KARGON_ATMOSPHERE_TUNING.smoke.maxRadius,
  aspect: 0.62,
  maxAlpha: KARGON_ATMOSPHERE_TUNING.smoke.alpha,
  bandStart: 0,
  bandSpan: 1,
  swayPx: 40,
  swayCycles: 0.7,
  // 한 수명 동안 화면 폭을 한 번 가로지른다(가로 흐름축).
  driftTurns: 1,
  parallax: 0.12,
  tint: 0x6b5348,
  additive: false,
  flicker: 0,
  glowSensitive: false,
  profile: PUFF_PROFILE,
};

/**
 * 열기 기둥 — 화면 **아래쪽에서만** 솟는 세로로 긴 가산 열기. **화면 기여의 주력 2**.
 * 카르곤은 화산이고 열은 아래에서 오므로 세로 대역을 하단 절반에 가둔다.
 */
const HEAT: AtmosphereField = {
  name: 'heat',
  key: 0x4d,
  role: 'veil',
  counts: countsFromTuning(KARGON_ATMOSPHERE_TUNING.heat),
  riseUp: true,
  periodTicks: 1200,
  periodJitter: 0.3,
  minRadius: KARGON_ATMOSPHERE_TUNING.heat.minRadius,
  maxRadius: KARGON_ATMOSPHERE_TUNING.heat.maxRadius,
  aspect: 2.6,
  maxAlpha: KARGON_ATMOSPHERE_TUNING.heat.alpha,
  bandStart: 0.5,
  bandSpan: 0.5,
  swayPx: 18,
  swayCycles: 3,
  driftTurns: 0,
  parallax: 0.18,
  tint: 0xffb066,
  additive: true,
  flicker: 0.35,
  glowSensitive: true,
  profile: PUFF_PROFILE,
};

export const KARGON_ATMOSPHERE: AtmosphereTheme = {
  themeId: 'kargon',
  referenceBackdrop: BACKDROP,
  /** 뒤 → 앞 순서로 그린다: 연기 → 재 → 열기 → 잔불. */
  fields: [SMOKE, ASH, HEAT, EMBER],
};
