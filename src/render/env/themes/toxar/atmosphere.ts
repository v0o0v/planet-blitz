/**
 * 톡사르 대기 테마 데이터 — 흘러가는 **독무(毒霧)** · 떨어지는 **부패 부유물** ·
 * 웅덩이에서 솟는 **오염 발광** · 떠오르는 **포자**.
 *
 * ## 이 행성의 배분 근거
 * 기여의 주력은 카르곤과 마찬가지로 **크고 옅은 덩어리** 둘이다. 다만 두 덩어리의 성격이
 * 이 행성에서는 서로 반대 방향을 맡는다 — 독무는 가로로 흘러 화면을 가로지르고(비가산),
 * 오염 발광은 하단 대역에서 솟는다(가산). 늪은 정의상 "고인 물 위에 낮게 깔린 공기"라
 * 독무 반경을 카르곤 연기(130~300)보다 키워 140~310 으로 뒀다.
 *
 * 합산 기여도 실측 **7.10**(카르곤 4.74, 하한 3.0 · 상한 12). 늪이 화산보다 공기가 두꺼운
 * 것은 맞지만 그것도 정도가 있다 — 1차 배분(독무 α0.27·12개 / 발광 α0.15)은 **9.15** 로
 * "안개로 도망간" 쪽에 가까워, 두 덩어리의 알파를 각각 0.22·0.13 으로 내려 여기로 맞췄다.
 * 반경·개수가 아니라 알파를 줄인 이유는 큰 덩어리라는 성질(= 탄과 형태 혼동 불가)을
 * 유지해야 하기 때문이다.
 *
 * ## 배경 기준색은 반드시 이 행성 것이어야 한다
 * `referenceBackdrop` 은 기여도 모델(입자가 배경과 얼마나 다른가)의 기준이다. 카르곤 값
 * (0x2a2422, 암반)을 그대로 두면 "보이는데 안 보인다고 계산되는" 혹은 그 반대의 상태가 된다.
 * 톡사르 값은 오프라인 배치 프리뷰(시드 12345) 화면 평균 rgb(25.1, 23.7, 20.8) 을 카르곤
 * 프리뷰↔카르곤 테마 기준색의 휘도비(1.486)로 환산한 rgb(37, 35, 31) 이다
 * (환산 방법은 `./parallax.ts` 머리 참조).
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

/** 톡사르 지형의 대표 어두운 이탄색. 위 주석의 환산 결과다. */
const BACKDROP = { r: 0x25, g: 0x23, b: 0x1f } as const;

/**
 * 네 필드의 **세기**. 타일셋 그림과 개천 발광이 바뀌면 재조정할 자리가 여기 하나다
 * (필드의 성격 — 방향·시차·색·합성·흔들림 — 은 아래 정의에, 세기는 전부 여기에).
 */
export const TOXAR_ATMOSPHERE_TUNING = {
  spore: { count: 28, countMin: 11, minRadius: 1.6, maxRadius: 4.2, alpha: 0.48 },
  rotfleck: { count: 22, countMin: 8, minRadius: 2.4, maxRadius: 5.0, alpha: 0.4 },
  miasma: { count: 11, countMin: 4, minRadius: 140, maxRadius: 310, alpha: 0.22 },
  bogGlow: { count: 10, countMin: 3, minRadius: 60, maxRadius: 140, alpha: 0.13 },
} as const satisfies Record<string, FieldTuning>;

/**
 * **포자 알갱이 프로파일** — `(1−t)^1.5`. 잔불용 `DOT_PROFILE`(`(1−t)²`)보다 가장자리가
 * 덜 급하게 죽어 알갱이가 "단단한 불티"가 아니라 "솜털 붙은 홀씨"로 읽힌다.
 * 원판 평균 채움률 ≈ 0.229(점 프로파일 1/6 의 1.37배).
 *
 * 공용 파일을 고치지 않고 여기서 정의할 수 있는 것이 계약의 설계 의도다 — 병렬 레인이
 * `'dot' | 'puff'` 열거형 세 자리를 동시에 고치려다 충돌하는 일이 없다.
 */
const SPORE_PROFILE: TextureProfile = {
  id: 'toxar-spore',
  alphaAt(t: number): number {
    const s = 1 - (t < 0 ? 0 : t > 1 ? 1 : t);
    return s * Math.sqrt(s);
  },
};

/**
 * 포자의 화면상 상승 속도(px/s). 탄은 초당 수천 px 라 속도비가 40배를 넘는다 — 눈은 속도차가
 * 두 자릿수 배면 두 대상을 다른 범주로 분류한다. 대기의 가장 강한 분리축이 이것이다.
 */
const SPORE_SPEED_PX_PER_SEC = 55;

/** 포자 주기를 뽑을 때 쓴 화면 세로(패딩 포함 근사). */
const SPORE_TRAVEL_PX = 1350;

/**
 * 포자 — 아래에서 위로 아주 느리게 떠오르며 좌우로 흔들리고 명멸한다.
 * 296.8° 자홍이라 흰 코어 + 퍼플/마젠타 링인 적탄과 **코어 유무**로도 갈린다.
 */
const SPORE: AtmosphereField = {
  name: 'spore',
  key: 0x11,
  role: 'spark',
  counts: countsFromTuning(TOXAR_ATMOSPHERE_TUNING.spore),
  riseUp: true,
  periodTicks: periodTicksForScreenSpeed(SPORE_SPEED_PX_PER_SEC, SPORE_TRAVEL_PX),
  periodJitter: 0.38,
  minRadius: TOXAR_ATMOSPHERE_TUNING.spore.minRadius,
  maxRadius: TOXAR_ATMOSPHERE_TUNING.spore.maxRadius,
  aspect: 1,
  maxAlpha: TOXAR_ATMOSPHERE_TUNING.spore.alpha,
  bandStart: 0,
  bandSpan: 1,
  swayPx: 30,
  swayCycles: 2.5,
  driftTurns: 0,
  // 시차를 가장 크게 — 포자가 화면 제일 앞에 떠 있는 층이다.
  parallax: 0.34,
  tint: 0xda70e0,
  additive: true,
  flicker: 0.5,
  glowSensitive: true,
  profile: SPORE_PROFILE,
};

/**
 * 부패 부유물 — 삭은 유기물 조각이 천천히 **떨어진다**. 포자와 방향이 반대라 그것만으로
 * 대비가 생긴다. 틴트는 배경(rgb 37,35,31)보다 확실히 밝은 황회색이라 채널차 합 263 이다.
 */
const ROTFLECK: AtmosphereField = {
  name: 'rotfleck',
  key: 0x22,
  role: 'mote',
  counts: countsFromTuning(TOXAR_ATMOSPHERE_TUNING.rotfleck),
  riseUp: false,
  periodTicks: 1600,
  periodJitter: 0.4,
  minRadius: TOXAR_ATMOSPHERE_TUNING.rotfleck.minRadius,
  maxRadius: TOXAR_ATMOSPHERE_TUNING.rotfleck.maxRadius,
  aspect: 1,
  maxAlpha: TOXAR_ATMOSPHERE_TUNING.rotfleck.alpha,
  bandStart: 0,
  bandSpan: 1,
  swayPx: 36,
  swayCycles: 1.5,
  driftTurns: 0,
  parallax: 0.22,
  tint: 0x8a8064,
  additive: false,
  flicker: 0,
  glowSensitive: false,
  profile: DOT_PROFILE,
};

/**
 * 독무 — 병든 황록 뭉치가 화면을 아주 느리게 가로지른다. **화면 기여의 주력 1**.
 * 시차 계수를 포자보다 작게 둬 뒤에 있는 층으로 읽힌다. 색이 지형(violet 개천)의 보색
 * 쪽이라 개천 위를 지날 때 개천을 지우지 않고 탁하게만 만든다.
 */
const MIASMA: AtmosphereField = {
  name: 'miasma',
  key: 0x33,
  role: 'veil',
  counts: countsFromTuning(TOXAR_ATMOSPHERE_TUNING.miasma),
  riseUp: true,
  periodTicks: 3200,
  periodJitter: 0.45,
  minRadius: TOXAR_ATMOSPHERE_TUNING.miasma.minRadius,
  maxRadius: TOXAR_ATMOSPHERE_TUNING.miasma.maxRadius,
  aspect: 0.6,
  maxAlpha: TOXAR_ATMOSPHERE_TUNING.miasma.alpha,
  bandStart: 0,
  bandSpan: 1,
  swayPx: 42,
  swayCycles: 0.7,
  // 한 수명 동안 화면 폭을 한 번 가로지른다(가로 흐름축).
  driftTurns: 1,
  parallax: 0.12,
  tint: 0x6a7a58,
  additive: false,
  flicker: 0,
  glowSensitive: false,
  profile: PUFF_PROFILE,
};

/**
 * 오염 발광 — 화면 **아래쪽에서만** 솟는 세로로 긴 가산 발광. **화면 기여의 주력 2**.
 * 톡사르의 광원은 저지에 고인 웅덩이이므로 세로 대역을 하단 절반에 가둔다(296.8°).
 */
const BOG_GLOW: AtmosphereField = {
  name: 'bogGlow',
  key: 0x44,
  role: 'veil',
  counts: countsFromTuning(TOXAR_ATMOSPHERE_TUNING.bogGlow),
  riseUp: true,
  periodTicks: 1300,
  periodJitter: 0.3,
  minRadius: TOXAR_ATMOSPHERE_TUNING.bogGlow.minRadius,
  maxRadius: TOXAR_ATMOSPHERE_TUNING.bogGlow.maxRadius,
  aspect: 2.4,
  maxAlpha: TOXAR_ATMOSPHERE_TUNING.bogGlow.alpha,
  bandStart: 0.5,
  bandSpan: 0.5,
  swayPx: 20,
  swayCycles: 3,
  driftTurns: 0,
  parallax: 0.18,
  tint: 0xca60d0,
  additive: true,
  flicker: 0.3,
  glowSensitive: true,
  profile: PUFF_PROFILE,
};

export const TOXAR_ATMOSPHERE: AtmosphereTheme = {
  themeId: 'toxar',
  referenceBackdrop: BACKDROP,
  /** 뒤 → 앞 순서로 그린다: 독무 → 부유물 → 오염 발광 → 포자. */
  fields: [MIASMA, ROTFLECK, BOG_GLOW, SPORE],
};
