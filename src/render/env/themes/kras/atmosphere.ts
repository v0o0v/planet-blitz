/**
 * 크라스 대기 테마 데이터 — 드리운 **재 장막** · 낙하하는 **콘크리트 먼지** ·
 * 잔불이 물들인 **연무** · 아주 느리게 떠오르는 **불티**.
 *
 * 여기 남기는 주석은 **크라스 실측 근거**뿐이다. 왜 이런 모양의 데이터인가(면적이 기여도의
 * 지배항인 이유·상태 없는 입자·역할별 상한)는 메커니즘이라 `src/render/env/atmosphere.ts` 와
 * `../../contracts/atmosphere.ts` 에 있다.
 *
 * ## 이 행성의 배분
 * 화면 기여의 주력은 **넓은 두 겹**(`pall`·`smoulderVeil`)이다. 알갱이 두 종은 개수와 속도로
 * 존재를 주장할 뿐 면적을 갖지 않는다 — 크라스 적 4종의 몸통색이 전부 rgb(224,138,106) 로
 * **밝고 따뜻한 단일 신호**라, 밝은 알갱이를 많이 뿌리면 그 신호와 경쟁한다.
 *
 * | 필드 | 역할 | 개수 | 이 행성에서의 이유 |
 * |---|---|---|---|
 * | pall         | veil(비가산) | 11 | 재가 하늘을 덮었다. 화면 기여 주력 1 |
 * | dust         | mote         | 24 | 무너진 콘크리트에서 계속 떨어진다 — 유일하게 **아래로** 가는 축 |
 * | smoulderVeil | veil(가산)   |  9 | 바닥 잔불이 재를 물들인다. 하단 대역에만 |
 * | emberDrift   | spark        | 26 | 꺼져 가는 불티. 25초에 화면을 지난다 |
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
 * 크라스 지형의 대표색. `assets/tilesets/kras.png` 의 Wang 16장 평균 rgb(41,30,32) 에 지형광
 * 겹의 앰비언트 상승분을 얹은 값이다.
 *
 * ⚠️ **이 값은 테마와 함께 반드시 옮겨야 한다.** 기여도 모델(입자가 배경과 얼마나 다른가)이
 * 전부 여기서 재므로, 카르곤 암반색(0x2a2422)에 고정한 채 다른 행성 입자를 고르면 "보이지
 * 않는 입자를 수십 개 그리는" 상태가 조용히 통과한다. 크라스는 카르곤보다 푸른 쪽이라
 * (B > G) 회갈색 입자를 그대로 가져오면 채널차가 실제보다 작다.
 */
const BACKDROP = { r: 0x2c, g: 0x24, b: 0x27 } as const;

/**
 * 네 필드의 **세기**. 타일셋 그림과 잔불 발광이 바뀌면 재조정할 자리가 여기 하나다
 * (필드의 성격 — 방향·시차·색·합성·흔들림 — 은 아래 정의에, 세기는 전부 여기에).
 */
export const KRAS_ATMOSPHERE_TUNING = {
  pall: { count: 11, countMin: 4, minRadius: 120, maxRadius: 300, alpha: 0.25 },
  dust: { count: 24, countMin: 9, minRadius: 2.4, maxRadius: 5.0, alpha: 0.4 },
  smoulderVeil: { count: 9, countMin: 3, minRadius: 60, maxRadius: 140, alpha: 0.13 },
  emberDrift: { count: 26, countMin: 10, minRadius: 1.5, maxRadius: 3.8, alpha: 0.46 },
} as const satisfies Record<string, FieldTuning>;

/**
 * 불티의 화면상 상승 속도(px/s). 카르곤 잔불(62)보다 느리다 — 꺼져 가는 불에서 떠오르는
 * 것은 열기가 아니라 부력을 거의 잃은 재라서다. 탄은 초당 수천 px 이므로 속도비가 40배를
 * 넘고, 눈은 속도차가 두 자릿수 배면 두 대상을 다른 범주로 분류한다.
 */
const EMBER_SPEED_PX_PER_SEC = 54;

/** 불티 주기를 뽑을 때 쓴 화면 세로(패딩 포함 근사). */
const EMBER_TRAVEL_PX = 1350;

/**
 * 재 장막 — 크고 옅은 반투명 뭉치가 화면을 아주 느리게 가로지른다. **화면 기여의 주력 1**.
 * 배경(rgb 44,36,39)보다 확실히 밝은 중성 회색이라 채널차 합 188 을 얻는다. 비가산이라
 * 밝히지 않고 **가린다** — 폐허의 하늘은 빛나지 않는다.
 */
const PALL: AtmosphereField = {
  name: 'pall',
  key: 0x5a,
  role: 'veil',
  counts: countsFromTuning(KRAS_ATMOSPHERE_TUNING.pall),
  riseUp: true,
  periodTicks: 3200,
  periodJitter: 0.45,
  minRadius: KRAS_ATMOSPHERE_TUNING.pall.minRadius,
  maxRadius: KRAS_ATMOSPHERE_TUNING.pall.maxRadius,
  aspect: 0.66,
  maxAlpha: KRAS_ATMOSPHERE_TUNING.pall.alpha,
  bandStart: 0,
  bandSpan: 1,
  swayPx: 36,
  swayCycles: 0.6,
  // 한 수명 동안 화면 폭을 한 번 가로지른다(가로 흐름축).
  driftTurns: 1,
  parallax: 0.11,
  tint: 0x6b6266,
  additive: false,
  flicker: 0,
  glowSensitive: false,
  profile: PUFF_PROFILE,
};

/**
 * 콘크리트 먼지 — 무너진 구조물에서 계속 떨어진다. **이 테마에서 유일하게 아래로 가는 축**이라
 * 그것만으로 다른 세 필드와 대비가 생긴다. 밝은 중성 회색이라 배경과 채널차 합 350.
 */
const DUST: AtmosphereField = {
  name: 'dust',
  key: 0x6b,
  role: 'mote',
  counts: countsFromTuning(KRAS_ATMOSPHERE_TUNING.dust),
  riseUp: false,
  periodTicks: 1700,
  periodJitter: 0.4,
  minRadius: KRAS_ATMOSPHERE_TUNING.dust.minRadius,
  maxRadius: KRAS_ATMOSPHERE_TUNING.dust.maxRadius,
  aspect: 1,
  maxAlpha: KRAS_ATMOSPHERE_TUNING.dust.alpha,
  bandStart: 0,
  bandSpan: 1,
  swayPx: 30,
  swayCycles: 1.4,
  driftTurns: 0,
  parallax: 0.21,
  tint: 0xa39c96,
  additive: false,
  flicker: 0,
  glowSensitive: false,
  profile: DOT_PROFILE,
};

/**
 * 잔불 연무 — 바닥의 꺼져 가는 불이 위쪽 재를 물들인다. **화면 기여의 주력 2**.
 * 세로 대역을 화면 아래 55% 에 가두는 것이 "광원이 바닥에 남아 있다"의 유일한 표현이다.
 * 색상각 337.0° 로 크라스 안전 골짜기 한가운데이고, 가산이지만 알파 0.13 이라 화이트아웃
 * 여유가 187 남는다(가산 베일 요구치 100).
 */
const SMOULDER_VEIL: AtmosphereField = {
  name: 'smoulderVeil',
  key: 0x7c,
  role: 'veil',
  counts: countsFromTuning(KRAS_ATMOSPHERE_TUNING.smoulderVeil),
  riseUp: true,
  periodTicks: 1400,
  periodJitter: 0.32,
  minRadius: KRAS_ATMOSPHERE_TUNING.smoulderVeil.minRadius,
  maxRadius: KRAS_ATMOSPHERE_TUNING.smoulderVeil.maxRadius,
  aspect: 2.2,
  maxAlpha: KRAS_ATMOSPHERE_TUNING.smoulderVeil.alpha,
  bandStart: 0.45,
  bandSpan: 0.55,
  swayPx: 20,
  swayCycles: 2.4,
  driftTurns: 0,
  parallax: 0.17,
  tint: 0xb8406e,
  additive: true,
  flicker: 0.3,
  glowSensitive: true,
  profile: PUFF_PROFILE,
};

/**
 * 불티 — 아주 느리게 떠오르며 좌우로 흔들리고 명멸하다 사라진다. 흰 코어 없는 채도 높은
 * 자적(340.1°, 채널 스팬 163)이라 색만으로도 탄(흰 코어 + 지정 아웃라인)과 갈린다.
 * 이 행성 적 몸통색 rgb(224,138,106) 과의 ΔRGB 합은 117 로 위장 문턱 70 의 1.7배다.
 */
const EMBER_DRIFT: AtmosphereField = {
  name: 'emberDrift',
  key: 0x8d,
  role: 'spark',
  counts: countsFromTuning(KRAS_ATMOSPHERE_TUNING.emberDrift),
  riseUp: true,
  periodTicks: periodTicksForScreenSpeed(EMBER_SPEED_PX_PER_SEC, EMBER_TRAVEL_PX),
  periodJitter: 0.35,
  minRadius: KRAS_ATMOSPHERE_TUNING.emberDrift.minRadius,
  maxRadius: KRAS_ATMOSPHERE_TUNING.emberDrift.maxRadius,
  aspect: 1,
  maxAlpha: KRAS_ATMOSPHERE_TUNING.emberDrift.alpha,
  bandStart: 0,
  bandSpan: 1,
  swayPx: 24,
  swayCycles: 2.5,
  driftTurns: 0,
  // 시차를 가장 크게 — 불티가 화면 제일 앞에 떠 있는 층이다.
  parallax: 0.33,
  tint: 0xff5c92,
  additive: true,
  // 카르곤 잔불(0.55)보다 세게 명멸한다. 꺼져 간다는 것은 밝기가 일정하지 않다는 뜻이다.
  flicker: 0.6,
  glowSensitive: true,
  profile: DOT_PROFILE,
};

export const KRAS_ATMOSPHERE: AtmosphereTheme = {
  themeId: 'kras',
  referenceBackdrop: BACKDROP,
  /** 뒤 → 앞 순서로 그린다: 재 장막 → 먼지 → 잔불 연무 → 불티. */
  fields: [PALL, DUST, SMOULDER_VEIL, EMBER_DRIFT],
};
