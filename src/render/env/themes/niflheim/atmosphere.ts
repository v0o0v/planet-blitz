/**
 * 니플헤임 대기 테마 데이터 — 떨어지는 **눈발**·바람에 반짝이는 **서릿가루**·지면을 스치는
 * **설연(雪煙)**·저각 태양이 빙정에 부딪혀 서는 **빛기둥**.
 *
 * ## 기준 배경색을 눈 쪽으로 옮긴 것이 이 파일에서 가장 중요한 한 줄이다
 * 카르곤 1차의 "보이지 않는 입자" 결함은 화산재 틴트가 배경(암반 0x2a2422)과 채널차 6 이라
 * 22개를 그리면서 화면에 아무것도 없던 상태였다. 기준을 카르곤 암반에 고정한 채 눈 행성을
 * 만들면 **그 결함이 색만 뒤집혀 그대로 재현된다** — 흰 입자의 차이가 크게 계산되는데 실제
 * 흰 눈 위에서는 0 이기 때문이다.
 *
 * 그래서 기준은 이 행성 타일셋 프리뷰(시드 12345)의 **설면 영역 실측** rgb(85,91,109) 이다.
 * 같은 프레임의 노출 암반은 rgb(20,21,29), 화면 전체 평균은 rgb(43,46,58) 인데 셋 중
 * **설면을 골랐다** — 밝은 입자에게 가장 가혹한 기준이고, 이 행성 대기는 전부 밝은 입자다.
 * 어두운 암반을 기준으로 삼으면 흰 눈발이 "채널차 400" 으로 통과한 뒤 정작 눈밭 위에서
 * 사라진다. 기준이 가혹한 쪽이어야 검증이 항진이 아니다.
 *
 * ## 눈송이 프로파일은 이 파일 안에서 끝난다
 * `TextureProfile` 이 열거형이 아니라 함수인 이유가 정확히 이것이다 — 눈송이 모양을 위해
 * 공용 파일(열거형·스위치·텍스처 슬롯)을 셋 다 고칠 필요가 없다.
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
 * 이 행성 배경의 대표색 = **설면**. 위 헤더의 "가혹한 쪽" 논거 참조.
 * 타일셋을 다시 구우면 이 값부터 재측정한다.
 */
const BACKDROP = { r: 0x55, g: 0x5b, b: 0x6d } as const;

/**
 * **눈송이 프로파일.** `(1−t)^1.5` — 알갱이(`(1−t)²`)보다 가장자리가 덜 급하게 죽어
 * 원판 평균 채움률이 0.167 → 0.229 로 오른다. 눈송이는 잔불처럼 점광원이 아니라 **면을 가진
 * 조각**이고, 그 차이가 같은 반경·같은 알파에서 1.4배의 실제 칠해진 면적으로 나타난다.
 */
const FLAKE_PROFILE: TextureProfile = {
  id: 'flake',
  alphaAt(t: number): number {
    const s = 1 - (t < 0 ? 0 : t > 1 ? 1 : t);
    return s * Math.sqrt(s);
  },
};

/**
 * 네 필드의 **세기**. 타일셋 그림과 지형광이 바뀌면 재조정할 자리가 여기 하나다
 * (필드의 성격 — 방향·시차·색·합성·흔들림 — 은 아래 정의에, 세기는 전부 여기에).
 */
export const NIFLHEIM_ATMOSPHERE_TUNING = {
  snowfall: { count: 26, countMin: 10, minRadius: 2.4, maxRadius: 5.0, alpha: 0.42 },
  rimeSpark: { count: 24, countMin: 9, minRadius: 1.6, maxRadius: 4.0, alpha: 0.34 },
  groundDrift: { count: 11, countMin: 4, minRadius: 130, maxRadius: 300, alpha: 0.26 },
  lightPillar: { count: 8, countMin: 3, minRadius: 55, maxRadius: 130, alpha: 0.14 },
} as const satisfies Record<string, FieldTuning>;

/** 서릿가루가 바람에 실려 화면을 오르는 속도(px/s). */
const RIME_SPEED_PX_PER_SEC = 58;
/** 주기를 뽑을 때 쓴 화면 세로(패딩 포함 실측 근사). */
const RIME_TRAVEL_PX = 1350;

/**
 * 눈발 — 천천히 **떨어진다**. 이 행성 대기의 얼굴이며, 비가산이라 밝은 설면 위에서도
 * 화면을 들어 올리지 않는다(가산으로 두면 눈 위에서 곧바로 화이트아웃이다).
 * 배경 rgb(85,91,109) 대비 채널차 합 437 — "보이지 않는 입자" 결함에서 가장 먼 자리다.
 */
const SNOWFALL: AtmosphereField = {
  name: 'snowfall',
  key: 0x5e,
  role: 'mote',
  counts: countsFromTuning(NIFLHEIM_ATMOSPHERE_TUNING.snowfall),
  riseUp: false,
  periodTicks: 1700,
  periodJitter: 0.42,
  minRadius: NIFLHEIM_ATMOSPHERE_TUNING.snowfall.minRadius,
  maxRadius: NIFLHEIM_ATMOSPHERE_TUNING.snowfall.maxRadius,
  aspect: 1,
  maxAlpha: NIFLHEIM_ATMOSPHERE_TUNING.snowfall.alpha,
  bandStart: 0,
  bandSpan: 1,
  // 눈송이는 잔불보다 크게 흔들린다 — 무게가 없어 바람에 그대로 실린다.
  swayPx: 44,
  swayCycles: 1.8,
  driftTurns: 0,
  parallax: 0.24,
  tint: 0xe8eefc,
  additive: false,
  flicker: 0,
  glowSensitive: false,
  profile: FLAKE_PROFILE,
};

/**
 * 서릿가루 — 저각 태양을 받아 명멸하며 **떠오르는** 미세 빙정. 눈발과 방향이 반대라
 * 그것만으로 대비가 생긴다.
 *
 * 이 행성의 유일한 가산 알갱이라 상한이 가장 좁다: 탄 대비 면적비 0.198(<0.25) · 24개(≤30) ·
 * 채널 스팬 163(≥60). 채도를 강제하는 이유는 **무채색 밝은 알갱이가 탄의 흰 코어 신호**이기
 * 때문이고, 순청은 그 조건을 자연스럽게 만족하면서 안전 골짜기(222.4°) 안에 있다.
 */
const RIME_SPARK: AtmosphereField = {
  name: 'rimeSpark',
  key: 0x6f,
  role: 'spark',
  counts: countsFromTuning(NIFLHEIM_ATMOSPHERE_TUNING.rimeSpark),
  riseUp: true,
  periodTicks: periodTicksForScreenSpeed(RIME_SPEED_PX_PER_SEC, RIME_TRAVEL_PX),
  periodJitter: 0.35,
  minRadius: NIFLHEIM_ATMOSPHERE_TUNING.rimeSpark.minRadius,
  maxRadius: NIFLHEIM_ATMOSPHERE_TUNING.rimeSpark.maxRadius,
  aspect: 1,
  maxAlpha: NIFLHEIM_ATMOSPHERE_TUNING.rimeSpark.alpha,
  bandStart: 0,
  bandSpan: 1,
  swayPx: 30,
  swayCycles: 2.5,
  driftTurns: 0,
  // 시차를 가장 크게 — 서릿가루가 화면 제일 앞에 떠 있는 층이다.
  parallax: 0.34,
  tint: 0x5c8cff,
  additive: true,
  flicker: 0.55,
  glowSensitive: true,
  profile: DOT_PROFILE,
};

/**
 * 설연(雪煙) — 지면을 스치며 가로로 흐르는 눈보라 장막. **화면 기여의 주력**이다.
 * 세로 대역을 하단 절반에 가둔 것이 이 필드의 정체다: 지표풍이 만드는 현상이라 하늘에
 * 뜨면 그냥 안개가 된다. 납작한 종횡비(0.45)가 같은 사실을 형태로 반복한다.
 */
const GROUND_DRIFT: AtmosphereField = {
  name: 'groundDrift',
  key: 0x71,
  role: 'veil',
  counts: countsFromTuning(NIFLHEIM_ATMOSPHERE_TUNING.groundDrift),
  riseUp: false,
  periodTicks: 3200,
  periodJitter: 0.45,
  minRadius: NIFLHEIM_ATMOSPHERE_TUNING.groundDrift.minRadius,
  maxRadius: NIFLHEIM_ATMOSPHERE_TUNING.groundDrift.maxRadius,
  aspect: 0.45,
  maxAlpha: NIFLHEIM_ATMOSPHERE_TUNING.groundDrift.alpha,
  bandStart: 0.5,
  bandSpan: 0.5,
  swayPx: 36,
  swayCycles: 0.7,
  // 한 수명 동안 화면 폭을 한 번 반 가로지른다(바람 = 이 행성의 가로 흐름축).
  driftTurns: 1.5,
  parallax: 0.12,
  tint: 0xc4d2ec,
  additive: false,
  flicker: 0,
  glowSensitive: false,
  profile: PUFF_PROFILE,
};

/**
 * 빛기둥(light pillar) — 저각 태양의 빛이 공중의 판상 빙정에 반사돼 **세로로 서는** 실제
 * 극지 현상. 이 행성에서 광원이 위에 있다는 서사를 대기 레이어가 반복하는 자리다.
 *
 * 유일한 가산 덩어리라 화이트아웃 여유가 판정이다: 설면 기준 최대 채널 109 위에
 * 0.14 × 240 = 34 를 더해 여유 112(하한 100)를 남긴다. 알파를 0.2 로 올리면 여유가
 * 무너진다 — 밝은 배경에서 넓은 가산이 위험하다는 것이 이 한 줄의 산술이다.
 */
const LIGHT_PILLAR: AtmosphereField = {
  name: 'lightPillar',
  key: 0x82,
  role: 'veil',
  counts: countsFromTuning(NIFLHEIM_ATMOSPHERE_TUNING.lightPillar),
  riseUp: true,
  periodTicks: 1400,
  periodJitter: 0.3,
  minRadius: NIFLHEIM_ATMOSPHERE_TUNING.lightPillar.minRadius,
  maxRadius: NIFLHEIM_ATMOSPHERE_TUNING.lightPillar.maxRadius,
  aspect: 2.6,
  maxAlpha: NIFLHEIM_ATMOSPHERE_TUNING.lightPillar.alpha,
  // 태양이 화면 위에 있으므로 빛기둥은 상단 대역에서만 선다.
  bandStart: 0,
  bandSpan: 0.7,
  swayPx: 16,
  swayCycles: 1.2,
  driftTurns: 0,
  parallax: 0.18,
  tint: 0x8fb0f0,
  additive: true,
  flicker: 0.25,
  glowSensitive: true,
  profile: PUFF_PROFILE,
};

export const NIFLHEIM_ATMOSPHERE: AtmosphereTheme = {
  themeId: 'niflheim',
  referenceBackdrop: BACKDROP,
  /** 뒤 → 앞 순서로 그린다: 설연 → 빛기둥 → 눈발 → 서릿가루. */
  fields: [GROUND_DRIFT, LIGHT_PILLAR, SNOWFALL, RIME_SPARK],
};
