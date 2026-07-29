/**
 * 아르케 대기 테마 데이터 — 흘러가는 **석분 연무** · 무너진 천장 틈으로 드는 **햇살 기둥** ·
 * 떨어지는 **석분 알갱이** · 이음매에서 떠오르는 **이끼 포자**.
 *
 * 여기 남기는 주석은 **아르케 실측 근거**뿐이다. 왜 이런 모양의 데이터인가(면적이 기여도의
 * 지배항인 이유·상태 없는 입자·역할별 상한)는 메커니즘이라
 * {@link file://../../contracts/atmosphere.ts} 에 있다.
 *
 * ## 이 행성에서 축이 어떻게 갈라지는가
 * 카르곤은 열이 아래에서 왔다(`heat` 가 하단 대역). 아르케는 **빛이 위에서 온다** — 햇살
 * 기둥을 화면 상단 6할 대역에 가두고 아래로 내려오게 두었다. 그 반대 방향(위로 떠오르는
 * 이끼 포자)이 두 번째 축이라, 두 알갱이 축이 서로 반대로 움직인다.
 *
 * ## 세기는 실측으로 두 번 잡았다
 * 1차 값(연무 12개·r 310·α0.26 / 햇살 9개·r 140·α0.15)은 합산 화면 기여도가 **10.33** 으로
 * 나왔다. 계약 상한(12)은 넘지 않았지만 카르곤 실측(4.95)의 2.1배라, 같은 게임 안에서 이
 * 행성만 안개 낀 것처럼 보인다. 상한을 통과했다는 것과 다른 행성과 같은 차수라는 것은 서로
 * 다른 판정이다 — 개수·반경·알파를 함께 내려 5.4 로 맞췄다.
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
 * 아르케 지형의 대표 석재색. `assets/tilesets/arke.png` 면적 가중 평균 RGB(33.4/33.0/31.5)에
 * 카르곤이 자기 시트 평균 대비 잡은 것과 같은 배율(1.11 — 지형광·그레이딩이 합성된 화면이
 * 시트보다 밝다)을 적용한 값이다.
 *
 * ⚠️ **이 값을 안 옮기면 입자가 화면에서 사라진다.** 카르곤 1차 화산재 결함이 정확히 그것이었고
 * (틴트가 배경과 채널차 6), 기준을 카르곤 암반색(0x2a2422)에 둔 채 회석색 행성을 만들면 같은
 * 결함이 색만 바뀌어 재현된다.
 */
const BACKDROP = { r: 0x26, g: 0x25, b: 0x21 } as const;

/**
 * 네 필드의 **세기**. 타일셋 그림과 지형광이 바뀌면 재조정할 자리가 여기 하나다
 * (필드의 성격 — 방향·시차·색·합성·흔들림 — 은 아래 정의에, 세기는 전부 여기에).
 */
export const ARKE_ATMOSPHERE_TUNING = {
  grit: { count: 22, countMin: 8, minRadius: 2.2, maxRadius: 5.0, alpha: 0.38 },
  spore: { count: 22, countMin: 8, minRadius: 1.5, maxRadius: 4.0, alpha: 0.42 },
  haze: { count: 9, countMin: 4, minRadius: 140, maxRadius: 280, alpha: 0.2 },
  shaft: { count: 8, countMin: 3, minRadius: 60, maxRadius: 130, alpha: 0.12 },
} as const satisfies Record<string, FieldTuning>;

/**
 * 이끼 포자의 화면상 상승 속도(px/s). 탄은 초당 수천 px 라 속도비가 30배를 넘는다 — 눈은
 * 속도차가 두 자릿수 배면 두 대상을 다른 범주로 분류한다.
 */
const SPORE_SPEED_PX_PER_SEC = 58;

/** 포자 주기를 뽑을 때 쓴 화면 세로(패딩 포함 실측 근사). */
const SPORE_TRAVEL_PX = 1350;

/**
 * 석분 연무 — 크고 옅은 반투명 뭉치가 화면을 아주 느리게 가로지른다. **화면 기여의 주력 1**.
 * 시차 계수를 작게 둬 뒤에 있는 층으로 읽힌다.
 */
const HAZE: AtmosphereField = {
  name: 'haze',
  key: 0x5a,
  role: 'veil',
  counts: countsFromTuning(ARKE_ATMOSPHERE_TUNING.haze),
  riseUp: true,
  periodTicks: 3200,
  periodJitter: 0.45,
  minRadius: ARKE_ATMOSPHERE_TUNING.haze.minRadius,
  maxRadius: ARKE_ATMOSPHERE_TUNING.haze.maxRadius,
  aspect: 0.6,
  maxAlpha: ARKE_ATMOSPHERE_TUNING.haze.alpha,
  bandStart: 0,
  bandSpan: 1,
  swayPx: 38,
  swayCycles: 0.7,
  // 한 수명 동안 화면 폭을 한 번 가로지른다(가로 흐름축).
  driftTurns: 1,
  parallax: 0.12,
  // 배경(0x262521)과 RGB 합산 절대차 301 — "보이지 않는 입자" 결함의 반대편.
  tint: 0x8f8b7f,
  additive: false,
  flicker: 0,
  glowSensitive: false,
  profile: PUFF_PROFILE,
};

/**
 * 햇살 기둥 — 화면 **위쪽 6할에서만** 내려오는 세로로 긴 가산 빛. **화면 기여의 주력 2**.
 * 카르곤 열기 기둥의 정확한 거울상이다: 그쪽은 열이 아래에서 솟았고 여기는 빛이 위에서 든다.
 */
const SHAFT: AtmosphereField = {
  name: 'shaft',
  key: 0x6b,
  role: 'veil',
  counts: countsFromTuning(ARKE_ATMOSPHERE_TUNING.shaft),
  riseUp: false,
  periodTicks: 1400,
  periodJitter: 0.3,
  minRadius: ARKE_ATMOSPHERE_TUNING.shaft.minRadius,
  maxRadius: ARKE_ATMOSPHERE_TUNING.shaft.maxRadius,
  aspect: 2.8,
  maxAlpha: ARKE_ATMOSPHERE_TUNING.shaft.alpha,
  bandStart: 0,
  bandSpan: 0.6,
  swayPx: 16,
  swayCycles: 2,
  driftTurns: 0,
  parallax: 0.18,
  // 저채도 미색. 화이트아웃 여유 225 — 넓은 면적이 화면을 들어올리지 않는다.
  tint: 0xbfc6b8,
  additive: true,
  flicker: 0.22,
  glowSensitive: true,
  profile: PUFF_PROFILE,
};

/**
 * 석분 알갱이 — 작은 입자가 천천히 **떨어진다**. 포자와 방향이 반대라 그것만으로 대비가 생긴다.
 * 배경보다 확실히 밝은 회석색이라 채널차 합 351 을 얻는다.
 */
const GRIT: AtmosphereField = {
  name: 'grit',
  key: 0x7c,
  role: 'mote',
  counts: countsFromTuning(ARKE_ATMOSPHERE_TUNING.grit),
  riseUp: false,
  periodTicks: 1700,
  periodJitter: 0.4,
  minRadius: ARKE_ATMOSPHERE_TUNING.grit.minRadius,
  maxRadius: ARKE_ATMOSPHERE_TUNING.grit.maxRadius,
  aspect: 1,
  maxAlpha: ARKE_ATMOSPHERE_TUNING.grit.alpha,
  bandStart: 0,
  bandSpan: 1,
  swayPx: 30,
  swayCycles: 1.5,
  driftTurns: 0,
  parallax: 0.22,
  tint: 0xa39c8c,
  additive: false,
  flicker: 0,
  glowSensitive: false,
  profile: DOT_PROFILE,
};

/**
 * 이끼 포자 — 이음매에서 아주 느리게 떠오르며 좌우로 흔들리고 밝기가 명멸하다 사라진다.
 * 흰 코어 없는 채도 높은 녹청(채널 스팬 137)이라 색만으로도 탄(흰 코어 + 청록/적색 링)과
 * 갈리고, 지형광 이음매 색과 같은 계열이라 "저 빛이 어디서 왔는지"가 화면에서 읽힌다.
 */
const SPORE: AtmosphereField = {
  name: 'spore',
  key: 0x8d,
  role: 'spark',
  counts: countsFromTuning(ARKE_ATMOSPHERE_TUNING.spore),
  riseUp: true,
  periodTicks: periodTicksForScreenSpeed(SPORE_SPEED_PX_PER_SEC, SPORE_TRAVEL_PX),
  periodJitter: 0.35,
  minRadius: ARKE_ATMOSPHERE_TUNING.spore.minRadius,
  maxRadius: ARKE_ATMOSPHERE_TUNING.spore.maxRadius,
  aspect: 1,
  maxAlpha: ARKE_ATMOSPHERE_TUNING.spore.alpha,
  bandStart: 0,
  bandSpan: 1,
  swayPx: 24,
  swayCycles: 2.5,
  driftTurns: 0,
  // 시차를 가장 크게 — 포자가 화면 제일 앞에 떠 있는 층이다.
  parallax: 0.34,
  tint: 0x4fd8b4,
  additive: true,
  flicker: 0.5,
  glowSensitive: true,
  profile: DOT_PROFILE,
};

export const ARKE_ATMOSPHERE: AtmosphereTheme = {
  themeId: 'arke',
  referenceBackdrop: BACKDROP,
  /** 뒤 → 앞 순서로 그린다: 연무 → 석분 → 햇살 → 포자. */
  fields: [HAZE, GRIT, SHAFT, SPORE],
};
