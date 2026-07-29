/**
 * 톡사르 데칼 테마 데이터 — 오염 침출 · 함몰 웅덩이 · 포자 퇴적 · 부패 균열 · 잔해 · 이탄 둔덕.
 *
 * ## 톡사르 실측이 이 값들을 정한 방식
 * - **바닥 밝기 136 / 암부 75.** 오프라인 배치 프리뷰(시드 12345)를 카르곤과 나란히 굽고
 *   비로 환산했다(브라우저를 못 쓰는 레인이라 하네스 실측 대신 쓴 방법이며, 환산표는
 *   `./parallax.ts` 머리에 있다). 프리뷰 RGB 합 평균 69.6(카르곤 76.6), 하위 40% 평균
 *   44.2(카르곤 52.8) ⇒ 150×0.909 ≈ 136, 90×0.837 ≈ 75.
 *   **타일셋을 교체하면 이 둘이 갱신 대상 1순위다.**
 * - **배수 팔레트가 저채도 회록인 이유**는 톡사르 지각이 이끼 회록이라 그 위에 얹히는 얼룩이
 *   색을 밀면 "지면의 자국"이 아니라 색 필터로 읽히기 때문이다. 크로마는 전부 30 이하다.
 * - **가산 하이라이트를 쓴다.** 곱연산의 화면차는 `바닥밝기 × α × (1−배수)` 라 RGB 합 75 짜리
 *   늪 바닥 위에서는 거의 아무 일도 하지 않는다. 어두운 이탄과 밝은 개천의 이원성이 카르곤만큼
 *   극단적이라 이 겹이 필요하다(밝은 설원 행성이라면 곱연산만으로 충분하다).
 * - **`glow.rim` 이 violet(297.0°)인 이유**는 톡사르의 유일한 광원이 바닥의 독성 웅덩이라서다.
 *   광원 **방향** 자체는 여기가 아니라 `./index.ts` 의 공유 `light` 필드에 있다 — 지형광
 *   레이어가 같은 값을 읽어야 화면에 태양이 하나다.
 * - **격자 셀은 카르곤과 다른 소수 4개**(811·359·163·433)다. 서로소 요구는 메커니즘이지만,
 *   카르곤과 같은 수를 쓰면 두 행성이 정확히 같은 자리에 얼룩을 놓는다.
 */

import type { DecalTheme } from '../../contracts/decals.js';

export const TOXAR_DECALS: DecalTheme = {
  themeId: 'toxar',
  /** 톡사르 Wang 타일 원본 32px(표시 64px 로 2배 확대). */
  sourceTilePx: 32,
  floorLumaSum: 136,
  darkFloorLumaSum: 75,
  /** 접지 음영 — 팔레트에서 가장 진하다(젖은 이끼 그늘). */
  ground: 0x33382f,
  tints: [0xffffff, 0xdce8d4, 0xc8d8c0, 0xd4ccdc, 0xe0dcc8, 0xc4c8c0],
  glow: {
    /** 297.0° — 웅덩이 빛을 마주본 2텍셀 모서리. 이 레이어에서 유일하게 또렷하게 밝다. */
    rim: 0x5c365e,
    /** 297.9° — 마주본 면의 아주 옅은 워시. 넓게 깔리므로 색 자체를 어둡게 잡는다. */
    face: 0x331834,
  },
  kinds: [
    // 오염 침출 흐름 — 본체 / 심 / 코어.
    { id: 'seep', silhouette: 'flow', r: 42, elong: 2.4, coverage: 0.5, opacity: 0.95,
      slots: [0x8a8c78, 0x5f6250, 0x45483c] },
    // 함몰 웅덩이 — 림(가장 옅다: 안쪽이 더 어두워야 링으로 읽힌다) / 바닥 / 심연.
    { id: 'sinkhole', silhouette: 'ring', r: 44, elong: 1.0, coverage: 0.62, opacity: 0.9,
      slots: [0xa8ac94, 0x6b6f5c, 0x3e4136] },
    // 포자 퇴적 — 거의 변화 없는 옅은 안개(겹을 적게, 겹 알파를 낮게).
    { id: 'sporeDust', silhouette: 'haze', r: 46, elong: 1.45, coverage: 0.85, opacity: 0.45,
      slots: [0xc0c4b4], soft: { rings: 10, ringAlpha: 0.09, wobble: 0.28 } },
    // 오염 비산 자국 — 본체 / 튄 방울.
    { id: 'splash', silhouette: 'splatter', r: 44, elong: 1.3, coverage: 0.3, opacity: 0.92,
      slots: [0x7a7e68, 0x555949] },
    // 부패한 뿌리 균열 — 겉선(넓게) / 코어(1텍셀). 코어가 팔레트에서 가장 진하다:
    // 균열은 테두리가 아니라 그 자체가 가장 깊은 홈이다.
    { id: 'rootCrack', silhouette: 'crack', r: 44, elong: 2.0, coverage: 0.12, opacity: 0.95,
      slots: [0x6a6e5e, 0x2e302a] },
    // 썩은 잔해 — 밝은 파편 / 어두운 파편.
    { id: 'rubble', silhouette: 'cluster', r: 26, elong: 1.0, coverage: 0.3, opacity: 0.88,
      slots: [0x8f927c, 0x555848] },
    // 곰팡이 반점.
    { id: 'mold', silhouette: 'haze', r: 17, elong: 1.2, coverage: 0.7, opacity: 0.9,
      slots: [0x464a3e], soft: { rings: 12, ringAlpha: 0.14, wobble: 0.4 } },
    // 대역 변색 — 오염이 번진 쪽(자회색 기미를 남기고 녹기를 깎는다).
    { id: 'stainToxic', silhouette: 'haze', r: 120, elong: 1.35, coverage: 0.84, opacity: 0.54,
      slots: [0x9490a0] },
    // 대역 변색 — 마른 부패 쪽(황록 기미를 남기고 푸른 기를 깎는다).
    { id: 'stainRot', silhouette: 'haze', r: 120, elong: 1.3, coverage: 0.84, opacity: 0.54,
      slots: [0xa0a082] },
    // ── 암부 랜드마크 3종. `r × elong` 이 대역 [200,400] 의 산술적 귀결에 맞춰져 있고,
    //    그 산술은 `validateDecalTheme` 이 실제로 검사한다.
    { id: 'hummock', silhouette: 'boulder', r: 115, elong: 1.15, coverage: 0.52, opacity: 0.9,
      slots: [0x7e8070, 0x4e5044] },
    { id: 'logRidge', silhouette: 'ridge', r: 70, elong: 1.9, coverage: 0.34, opacity: 0.92,
      slots: [0x878a76, 0x555848] },
    { id: 'peatMound', silhouette: 'mound', r: 98, elong: 1.35, coverage: 0.46, opacity: 0.86,
      slots: [0x958f7e, 0x5c5a49] },
  ],
  /**
   * 뒤 → 앞. 부조가 맨 앞인 이유: 잔 데칼(균열·잔해)은 지면의 무늬이므로 둔덕 **아래**를
   * 지나야 한다. 순서를 뒤집으면 균열이 둔덕 위로 지나가 둔덕이 "얹힌 판때기"로 읽힌다.
   */
  grids: [
    // 대역 변색 — 화면 절반만 한 얼룩. 알파를 낮게 유지한다(시차 레이어가 암부 저주파를
    // 맡으므로 대역이 겹치면 둘 다 탁해진다). 배율 2 고정 + 반경 120 으로 발자국을 유지한다.
    { cell: 811, kinds: ['stainToxic', 'stainRot'], density: 0.9,
      minScale: 2, maxScale: 2, minAlpha: 0.13, maxAlpha: 0.28, salt: 0x3100 },
    // 큰 데칼.
    { cell: 359, kinds: ['seep', 'sinkhole', 'splash', 'sporeDust'], density: 0.45,
      minScale: 1, maxScale: 1, minAlpha: 0.3, maxAlpha: 0.58, salt: 0x1100 },
    // 잔 데칼 — `rootCrack` 을 두 번 넣어 균열 비중을 밀도 상한을 건드리지 않고 40% 로 올린다.
    { cell: 163, kinds: ['rootCrack', 'rootCrack', 'rubble', 'mold', 'splash'], density: 0.36,
      minScale: 1, maxScale: 1, minAlpha: 0.32, maxAlpha: 0.58, salt: 0x2100 },
    // 부조 — 랜드마크. 지형 게이트가 후보의 상당수를 걸러 화면당 몇 개만 남는다.
    // 개수를 늘리면 "균질한 시각 밀도"로 되돌아간다.
    { cell: 433, kinds: ['hummock', 'hummock', 'logRidge', 'peatMound'], density: 0.48,
      minScale: 1, maxScale: 1, minAlpha: 0.34, maxAlpha: 0.55, salt: 0x4100,
      siteGate: 'darkTerrain', highlight: { minAlpha: 0.11, maxAlpha: 0.18 },
      noFlip: true, minDensityScale: 0.7 },
  ],
};
