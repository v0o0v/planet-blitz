/**
 * 베르단 데칼 테마 데이터 — 침출 자국 · 부식 함몰공 · 포자 퇴적 · 부식 균열 · 껍질 자갈 ·
 * 이탄 둔덕.
 *
 * ## 베르단 실측이 이 값들을 정한 방식
 * - **바닥 밝기 133 / 암부 80.** 타일 프리뷰(seed 12345)의 화면 평균 R+G+B 는 67.7, 어두운
 *   35% 표본은 45.3 이다. 프리뷰에는 환경 레이어가 없으므로 카르곤에서 얻은 환산비
 *   (150/76.6 = 1.96 · 90/51.1 = 1.76)를 곱했다. 타일셋을 교체하면 **이 둘이 갱신 대상 1순위**다.
 * - **배수 팔레트가 저채도 녹회색인 이유**는 배수가 색을 밀면 안 되기 때문이다(크로마 상한
 *   60). 카르곤이 갈회색이었던 자리를 베르단은 녹회색으로 바꾼다 — 습지 바닥은 젖은 이끼와
 *   이탄이지 화산재가 아니다.
 * - **가산 하이라이트를 남긴 이유**는 이 행성도 명암 이원성이 크기 때문이다. 곱연산의 화면차는
 *   `바닥밝기 × α × (1−배수)` 라 합 80 짜리 진창 위에서는 거의 아무 일도 하지 않는다.
 *   `rim` 이 녹색(0x3a6e4c)인 것은 이 행성의 하늘빛이 포자로 황록이기 때문이다.
 * - 광원 **방향**은 여기가 아니라 `themes/berdan/index.ts` 의 공유 `light` 에 있다(위에서
 *   내려온다) — 지형광 레이어가 같은 값을 읽어야 화면에 태양이 하나다.
 */

import type { DecalTheme } from '../../contracts/decals.js';

export const BERDAN_DECALS: DecalTheme = {
  themeId: 'berdan',
  /** 베르단 Wang 타일 원본 32px(표시 64px 로 2배 확대). */
  sourceTilePx: 32,
  floorLumaSum: 133,
  darkFloorLumaSum: 80,
  /** 접지 음영 — 팔레트에서 가장 진하다. 젖은 바닥이라 녹기가 남는다. */
  ground: 0x35403a,
  tints: [0xffffff, 0xe6efe4, 0xd2ded0, 0xdce8ea, 0xe8e2cc, 0xc8d0c6],
  glow: {
    rim: 0x3a6e4c,
    face: 0x18301f,
  },
  kinds: [
    // 흘러내린 침출 자국 — 본체 / 심 / 코어.
    { id: 'seep', silhouette: 'flow', r: 42, elong: 2.4, coverage: 0.5, opacity: 0.95,
      slots: [0x7f8c80, 0x58635c, 0x424b46] },
    // 부식 함몰공 — 림(가장 옅다: 안쪽이 더 어두워야 링으로 읽힌다) / 바닥 / 심연.
    { id: 'sinkhole', silhouette: 'ring', r: 44, elong: 1.0, coverage: 0.62, opacity: 0.9,
      slots: [0x9aa79c, 0x646e67, 0x3f4844] },
    // 포자 퇴적 — 거의 변화 없는 옅은 막(겹을 적게, 겹 알파를 낮게).
    { id: 'sporeCrust', silhouette: 'haze', r: 46, elong: 1.45, coverage: 0.85, opacity: 0.45,
      slots: [0xbcc4b6], soft: { rings: 10, ringAlpha: 0.09, wobble: 0.28 } },
    // 산이 튄 자국 — 본체 / 튄 방울.
    { id: 'splashBurn', silhouette: 'splatter', r: 44, elong: 1.3, coverage: 0.3, opacity: 0.92,
      slots: [0x74806f, 0x515a4f] },
    // 부식 균열 — 겉선(넓게) / 코어(1텍셀). 코어가 팔레트에서 가장 진하다: 산이 파고든 홈은
    // 테두리가 아니라 그 자체가 가장 깊다.
    { id: 'etch', silhouette: 'crack', r: 44, elong: 2.0, coverage: 0.12, opacity: 0.95,
      slots: [0x646d68, 0x2c3230] },
    // 껍질 자갈(산에 삭은 외골격 조각) — 밝은 파편 / 어두운 파편.
    { id: 'shellGrit', silhouette: 'cluster', r: 26, elong: 1.0, coverage: 0.3, opacity: 0.88,
      slots: [0x87927f, 0x515a4f] },
    // 부패 얼룩.
    { id: 'rot', silhouette: 'haze', r: 17, elong: 1.2, coverage: 0.7, opacity: 0.9,
      slots: [0x464f47], soft: { rings: 12, ringAlpha: 0.14, wobble: 0.4 } },
    // 대역 변색 — 차가운 쪽(주력). 물에 잠긴 조류 띠.
    { id: 'stainAlgae', silhouette: 'haze', r: 120, elong: 1.35, coverage: 0.84, opacity: 0.54,
      slots: [0x8b9690] },
    // 대역 변색 — 따뜻한 쪽. 마른 침전토라 푸른 기를 깎아 바닥을 누렇게 만든다.
    { id: 'stainSilt', silhouette: 'haze', r: 120, elong: 1.3, coverage: 0.84, opacity: 0.54,
      slots: [0xa4a08c] },
    // ── 암부 랜드마크 3종. `r × elong` 이 132 근처로 맞춰져 있고(대역 [200,400] 의 산술적
    //    귀결), 그 산술은 `validateDecalTheme` 이 실제로 검사한다.
    { id: 'hummock', silhouette: 'boulder', r: 110, elong: 1.2, coverage: 0.52, opacity: 0.9,
      slots: [0x7b857a, 0x4b544e] },
    { id: 'peatRidge', silhouette: 'ridge', r: 68, elong: 1.95, coverage: 0.34, opacity: 0.92,
      slots: [0x848d80, 0x525b52] },
    { id: 'siltMound', silhouette: 'mound', r: 96, elong: 1.38, coverage: 0.46, opacity: 0.86,
      slots: [0x91998a, 0x585f54] },
  ],
  /**
   * 뒤 → 앞. 부조가 맨 앞인 이유: 잔 데칼(균열·자갈)은 지면의 무늬이므로 둔덕 **아래**를
   * 지나야 한다. 순서를 뒤집으면 균열이 둔덕 위로 지나가 둔덕이 "얹힌 판때기"로 읽힌다.
   *
   * 셀 크기는 카르곤과 다른 소수 4개(761 · 353 · 157 · 431)다 — 타일(64) 및 서로끼리
   * 서로소여야 공명하지 않는데, 행성마다 같은 값을 쓰면 서로 다른 행성에서 정확히 같은
   * 자리에 얼룩이 앉는다.
   */
  grids: [
    // 대역 변색 — 화면 절반만 한 얼룩. 알파를 낮게 유지한다(시차 레이어가 암부 저주파를
    // 맡으므로 대역이 겹치면 둘 다 탁해진다). 배율 2 고정 + 반경 120 으로 발자국을 유지한다.
    { cell: 761, kinds: ['stainAlgae', 'stainSilt'], density: 0.9,
      minScale: 2, maxScale: 2, minAlpha: 0.13, maxAlpha: 0.28, salt: 0x3000 },
    // 큰 데칼 — 1920×1080 에 기대 ~10장.
    { cell: 353, kinds: ['seep', 'sinkhole', 'splashBurn', 'sporeCrust'], density: 0.45,
      minScale: 1, maxScale: 1, minAlpha: 0.3, maxAlpha: 0.58, salt: 0x1000 },
    // 잔 데칼 — 기대 ~34장. `etch` 를 두 번 넣어 균열 비중을 밀도 상한 없이 40% 로 올린다.
    { cell: 157, kinds: ['etch', 'etch', 'shellGrit', 'rot', 'splashBurn'], density: 0.36,
      minScale: 1, maxScale: 1, minAlpha: 0.32, maxAlpha: 0.58, salt: 0x2000 },
    // 부조 — 랜드마크. 5×3 = 15셀 × 0.48 ≈ 7.2 후보 → 지형 게이트가 2/3 를 걸러 화면당 평균 2.5개.
    // 개수를 늘리면 "균질한 시각 밀도"로 되돌아간다.
    { cell: 431, kinds: ['hummock', 'hummock', 'peatRidge', 'siltMound'], density: 0.48,
      minScale: 1, maxScale: 1, minAlpha: 0.34, maxAlpha: 0.55, salt: 0x4000,
      siteGate: 'darkTerrain', highlight: { minAlpha: 0.11, maxAlpha: 0.18 },
      noFlip: true, minDensityScale: 0.7 },
  ],
};
