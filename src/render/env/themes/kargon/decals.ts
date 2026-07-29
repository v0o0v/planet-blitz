/**
 * 카르곤 데칼 테마 데이터 — 식은 용암 흐름 · 크레이터 · 화산재 · 균열 · 현무암 자갈 · 암괴.
 *
 * ## 카르곤 실측이 이 값들을 정한 방식
 * - **바닥 밝기 150 / 암부 90.** 카르곤 바닥은 밝은 주황 용암(합 ≈ 380)과 거의 검은 현무암
 *   (합 ≈ 90)이 공존한다. 화면 평균이 150 이고, 부조는 정의상 암부에만 놓이므로 90 으로 잰다.
 *   타일셋을 교체하면 **이 둘이 갱신 대상 1순위**다.
 * - **배수 팔레트가 저채도 갈회색인 이유**는 카르곤 적이 적/주황 계열이기 때문이다. 배경이 색을
 *   밀면 지각 위 주황 적이 위장된다(4차에서 지각 평균 휘도를 70.0 → 31.8 로 낮춘 것과 같은 축).
 * - **가산 하이라이트가 있는 이유**는 카르곤 명암 이원성이 극단적이기 때문이다. 곱연산의 화면차는
 *   `바닥밝기 × α × (1−배수)` 라 합 90 짜리 현무암 위에서는 거의 아무 일도 하지 않는다. 밝은
 *   설원 행성이라면 곱연산만으로 충분하고 가산은 화면을 뭉갠다 — `glow`/`highlight` 를 빼면 된다.
 * - **`rim` 이 주황(0x6e4c30)인 이유**는 카르곤의 유일한 광원이 바닥 용암이라서다. 광원 **방향**
 *   자체는 여기가 아니라 `themes/kargon/index.ts` 의 공유 `light` 필드에 있다 — 지형광 레이어가
 *   같은 값을 읽어야 화면에 태양이 하나다.
 */

import type { DecalTheme } from '../../contracts/decals.js';

export const KARGON_DECALS: DecalTheme = {
  themeId: 'kargon',
  /** 카르곤 Wang 타일 원본 32px(표시 64px 로 2배 확대). */
  sourceTilePx: 32,
  floorLumaSum: 150,
  darkFloorLumaSum: 90,
  /** 접지 음영 — 팔레트에서 가장 진하다. */
  ground: 0x3a3532,
  tints: [0xffffff, 0xf0e4d8, 0xdcd0c4, 0xd8dce4, 0xf4d8c0, 0xcfc8c2],
  glow: {
    rim: 0x6e4c30,
    face: 0x2c1e14,
  },
  kinds: [
    // 식은 용암 흐름 — 본체 / 심 / 코어.
    { id: 'flow', silhouette: 'flow', r: 42, elong: 2.4, coverage: 0.5, opacity: 0.95,
      slots: [0x8a7c72, 0x5f544c, 0x453d38] },
    // 크레이터 — 림(가장 옅다: 안쪽이 더 어두워야 링으로 읽힌다) / 바닥 / 심연.
    { id: 'crater', silhouette: 'ring', r: 44, elong: 1.0, coverage: 0.62, opacity: 0.9,
      slots: [0xa89c92, 0x6b6058, 0x3e3833] },
    // 화산재 퇴적 — 거의 변화 없는 옅은 안개(겹을 적게, 겹 알파를 낮게).
    { id: 'ash', silhouette: 'haze', r: 46, elong: 1.45, coverage: 0.85, opacity: 0.45,
      slots: [0xc4bcb0], soft: { rings: 10, ringAlpha: 0.09, wobble: 0.28 } },
    // 비산 자국 — 본체 / 튄 방울.
    { id: 'splatter', silhouette: 'splatter', r: 44, elong: 1.3, coverage: 0.3, opacity: 0.92,
      slots: [0x7a6e66, 0x554d47] },
    // 균열 — 겉선(넓게) / 코어(1텍셀). 코어가 팔레트에서 가장 진하다: 균열은 테두리가 아니라
    // 그 자체가 가장 깊은 홈이다.
    { id: 'crack', silhouette: 'crack', r: 44, elong: 2.0, coverage: 0.12, opacity: 0.95,
      slots: [0x6a625e, 0x2e2b2a] },
    // 현무암 자갈 — 밝은 파편 / 어두운 파편.
    { id: 'gravel', silhouette: 'cluster', r: 26, elong: 1.0, coverage: 0.3, opacity: 0.88,
      slots: [0x8f857c, 0x554d47] },
    // 그을음.
    { id: 'soot', silhouette: 'haze', r: 17, elong: 1.2, coverage: 0.7, opacity: 0.9,
      slots: [0x4a4340], soft: { rings: 12, ringAlpha: 0.14, wobble: 0.4 } },
    // 대역 변색 — 차가운 쪽(주력).
    { id: 'stainDark', silhouette: 'haze', r: 120, elong: 1.35, coverage: 0.84, opacity: 0.54,
      slots: [0x8c9096] },
    // 대역 변색 — 따뜻한 쪽(붉은 기를 남기고 푸른 기를 깎아 바닥을 데운다).
    { id: 'stainWarm', silhouette: 'haze', r: 120, elong: 1.3, coverage: 0.84, opacity: 0.54,
      slots: [0xb0967e] },
    // ── 암부 랜드마크 3종. `r × elong` 이 132 근처로 맞춰져 있고(대역 [200,400] 의 산술적 귀결),
    //    그 산술은 `validateDecalTheme` 이 실제로 검사한다.
    { id: 'boulder', silhouette: 'boulder', r: 115, elong: 1.15, coverage: 0.52, opacity: 0.9,
      slots: [0x7e746c, 0x4e4642] },
    { id: 'ridge', silhouette: 'ridge', r: 70, elong: 1.9, coverage: 0.34, opacity: 0.92,
      slots: [0x877a70, 0x554b45] },
    { id: 'mound', silhouette: 'mound', r: 98, elong: 1.35, coverage: 0.46, opacity: 0.86,
      slots: [0x958a7e, 0x5c5249] },
  ],
  /**
   * 뒤 → 앞. 부조가 맨 앞인 이유: 잔 데칼(균열·자갈)은 지면의 무늬이므로 암괴 **아래**를
   * 지나야 한다. 순서를 뒤집으면 균열이 바위 위로 지나가 바위가 "얹힌 판때기"로 읽힌다.
   */
  grids: [
    // 대역 변색 — 화면 절반만 한 얼룩. 알파를 낮게 유지한다(시차 레이어가 암부 저주파를 맡으므로
    // 대역이 겹치면 둘 다 탁해진다). 배율 2 고정 + 반경 120 으로 발자국을 유지한다.
    { cell: 787, kinds: ['stainDark', 'stainWarm'], density: 0.9,
      minScale: 2, maxScale: 2, minAlpha: 0.13, maxAlpha: 0.28, salt: 0x3000 },
    // 큰 데칼 — 1920×1080 에 기대 ~11장.
    { cell: 337, kinds: ['flow', 'crater', 'splatter', 'ash'], density: 0.45,
      minScale: 1, maxScale: 1, minAlpha: 0.3, maxAlpha: 0.58, salt: 0x1000 },
    // 잔 데칼 — 기대 ~37장. `crack` 을 두 번 넣어 균열 비중을 밀도 상한 없이 40% 로 올린다.
    { cell: 149, kinds: ['crack', 'crack', 'gravel', 'soot', 'splatter'], density: 0.36,
      minScale: 1, maxScale: 1, minAlpha: 0.32, maxAlpha: 0.58, salt: 0x2000 },
    // 부조 — 랜드마크. 5×3 = 15셀 × 0.48 ≈ 7.2 후보 → 지형 게이트가 2/3 를 걸러 화면당 평균 2.5개.
    // 개수를 늘리면 "균질한 시각 밀도"로 되돌아간다.
    { cell: 419, kinds: ['boulder', 'boulder', 'ridge', 'mound'], density: 0.48,
      minScale: 1, maxScale: 1, minAlpha: 0.34, maxAlpha: 0.55, salt: 0x4000,
      siteGate: 'darkTerrain', highlight: { minAlpha: 0.11, maxAlpha: 0.18 },
      noFlip: true, minDensityScale: 0.7 },
  ],
};
