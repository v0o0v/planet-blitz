/**
 * 아르케 데칼 테마 데이터 — 무너진 인방 · 침하한 기단 · 석분 · 포장 균열 · 잔석 · 쓰러진 기둥.
 *
 * ## 아르케 실측이 이 값들을 정한 방식
 * - **바닥 밝기 98 / 암부 61.** `assets/tilesets/arke.png` 실측이다(면적 가중 평균 RGB
 *   33.4/33.0/31.5 = 합 98, 하위 40% 20.6/20.4/19.8 = 합 61). 카르곤이 150/90 인 것은 그쪽
 *   화면 절반이 발광 용암이기 때문이고, 아르케 지형은 스스로 빛나지 않아 절대값이 낮다.
 *   **타일셋을 교체하면 이 둘이 갱신 대상 1순위다.**
 * - **배수 팔레트가 저채도 회석색인 이유**는 두 겹이다. 하나는 카르곤과 같은 이유(배경이 색을
 *   밀면 그 색 계열 적이 위장된다). 다른 하나는 아르케 고유 — 이 행성의 자연색인 금갈색은
 *   앰버 적탄과 옐로 적탄 사이 폭 2.4° 슬롯에 끼여 **색상각으로 분리가 불가능**하다. 채도를
 *   내리는 것이 유일하게 남은 분리축이다. 아래 배수색의 크로마는 전부 12 이하다.
 * - **가산 하이라이트를 남긴 이유**는 아르케 암부(합 61)가 카르곤(합 90)보다 **더** 어둡기
 *   때문이다. 곱연산의 화면차는 `바닥밝기 × α × (1−배수)` 라 합 61 위에서는 거의 아무 일도
 *   하지 않는다. 밝은 눈 행성이라면 이걸 빼야 하지만 여기서는 반대다.
 * - **`glow.rim` 이 옅은 녹청(0x5c7a72)인 이유**는 저각 태양이 이끼 낀 석재 모서리에 닿기
 *   때문이다. 광원 **방향** 자체는 여기가 아니라 `themes/arke/index.ts` 의 공유 `light` 에
 *   있다 — 지형광 레이어가 같은 값을 읽어야 화면에 태양이 하나다.
 * - **기하로 직선성을 만든다.** `column`(ridge, elong 2.15)이 쓰러진 기둥, `lintel`(flow,
 *   elong 2.6)이 무너진 인방이다. 유적의 "직선"은 색이 아니라 **길고 곧은 실루엣**으로만
 *   들어온다 — 반복하는 직사각형 무늬는 180° 회전 변주로도 지워지지 않아 격자를 되살린다.
 */

import type { DecalTheme } from '../../contracts/decals.js';

export const ARKE_DECALS: DecalTheme = {
  themeId: 'arke',
  /** 아르케 Wang 타일 원본 32px(표시 64px 로 2배 확대). */
  sourceTilePx: 32,
  floorLumaSum: 98,
  darkFloorLumaSum: 61,
  /** 접지 음영 — 팔레트에서 가장 진하다(합 170, 모든 종류의 바깥 윤곽보다 어둡다). */
  ground: 0x3b3936,
  tints: [0xffffff, 0xece9e2, 0xd6d3cc, 0xd2d8da, 0xe4dfd4, 0xc8cbc6],
  glow: {
    // 합 328 × 하이라이트 상한 0.17 = 텍셀당 55.8 (절대 상한 60 안).
    rim: 0x5c7a72,
    face: 0x22302c,
  },
  kinds: [
    // 무너진 인방(引枋) — 본체 / 심 / 코어. 길고 곧다.
    { id: 'lintel', silhouette: 'flow', r: 40, elong: 2.6, coverage: 0.48, opacity: 0.95,
      slots: [0x8a8983, 0x605e59, 0x454340] },
    // 침하한 원형 기단 — 림(가장 옅다: 안쪽이 더 어두워야 링으로 읽힌다) / 바닥 / 심연.
    { id: 'basin', silhouette: 'ring', r: 45, elong: 1.0, coverage: 0.6, opacity: 0.9,
      slots: [0xa7a69f, 0x6a6863, 0x3f3d3a] },
    // 석분 퇴적 — 거의 변화 없는 옅은 층(겹을 적게, 겹 알파를 낮게).
    { id: 'dust', silhouette: 'haze', r: 46, elong: 1.5, coverage: 0.85, opacity: 0.45,
      slots: [0xc2c0b8], soft: { rings: 10, ringAlpha: 0.09, wobble: 0.26 } },
    // 붕괴 파편 — 본체 / 튄 조각.
    { id: 'debris', silhouette: 'splatter', r: 43, elong: 1.25, coverage: 0.3, opacity: 0.92,
      slots: [0x7c7a74, 0x565450] },
    // 포장 균열 — 겉선(넓게) / 코어(1텍셀). 코어가 팔레트에서 가장 진하다: 갈라진 자리는
    // 테두리가 아니라 그 자체가 가장 깊은 홈이다.
    { id: 'fissure', silhouette: 'crack', r: 44, elong: 2.2, coverage: 0.12, opacity: 0.95,
      slots: [0x6b6965, 0x2f2e2c] },
    // 잔석 무더기 — 밝은 파편 / 어두운 파편.
    { id: 'rubble', silhouette: 'cluster', r: 25, elong: 1.0, coverage: 0.3, opacity: 0.88,
      slots: [0x8d8b84, 0x565450] },
    // 이끼 반점. 배수 팔레트라 색이 아니라 명도로만 드러난다(녹청은 지형광이 낸다).
    { id: 'lichen', silhouette: 'haze', r: 17, elong: 1.25, coverage: 0.7, opacity: 0.9,
      slots: [0x4a4c48], soft: { rings: 12, ringAlpha: 0.14, wobble: 0.4 } },
    // 대역 변색 — 물 얼룩(주력, 차가운 쪽).
    { id: 'stainDamp', silhouette: 'haze', r: 120, elong: 1.35, coverage: 0.84, opacity: 0.54,
      slots: [0x8b9095] },
    // 대역 변색 — 흙 얼룩(따뜻한 쪽. 붉은 기를 남기고 푸른 기를 깎는다).
    { id: 'stainSoil', silhouette: 'haze', r: 120, elong: 1.3, coverage: 0.84, opacity: 0.54,
      slots: [0xa89c8e] },
    // ── 암부 랜드마크 3종. `r × elong` 이 132~134 대역에 맞춰져 있다([200,400] 발자국과
    //    부조 변형 표·흔들림의 산술적 귀결이며, `validateDecalTheme` 이 실제로 검사한다).
    // 무너진 거석.
    { id: 'block', silhouette: 'boulder', r: 115, elong: 1.15, coverage: 0.52, opacity: 0.9,
      slots: [0x817f78, 0x504e4a] },
    // **쓰러진 기둥** — 이 테마에서 가장 가늘고 긴 실루엣(elong 2.15). 유적의 직선성이
    // 화면에 실제로 들어오는 자리다.
    { id: 'column', silhouette: 'ridge', r: 62, elong: 2.15, coverage: 0.32, opacity: 0.92,
      slots: [0x8a8880, 0x565349] },
    // 무너진 계단·단.
    { id: 'terrace', silhouette: 'mound', r: 98, elong: 1.36, coverage: 0.46, opacity: 0.86,
      slots: [0x97958c, 0x5d5b52] },
  ],
  /**
   * 뒤 → 앞. 부조가 맨 앞인 이유: 잔 데칼(균열·잔석)은 지면의 무늬이므로 거석 **아래**를
   * 지나야 한다. 순서를 뒤집으면 균열이 바위 위로 지나가 바위가 "얹힌 판때기"로 읽힌다.
   *
   * 셀 크기 811·349·157·433 은 전부 소수라 서로끼리도, 표시 타일 64 와도 서로소다
   * (공명하면 격자가 되살아난다 — 검증기가 실제로 검사한다).
   */
  grids: [
    // 대역 변색 — 화면 절반만 한 얼룩. 알파를 낮게 유지한다(시차 레이어가 암부 저주파를
    // 맡으므로 대역이 겹치면 둘 다 탁해진다). 배율 2 고정 + 반경 120 으로 발자국을 유지한다.
    { cell: 811, kinds: ['stainDamp', 'stainSoil'], density: 0.9,
      minScale: 2, maxScale: 2, minAlpha: 0.13, maxAlpha: 0.28, salt: 0x3000 },
    // 큰 데칼 — 1920×1080 에 기대 ~10장.
    { cell: 349, kinds: ['lintel', 'basin', 'debris', 'dust'], density: 0.45,
      minScale: 1, maxScale: 1, minAlpha: 0.3, maxAlpha: 0.58, salt: 0x1000 },
    // 잔 데칼. `fissure` 를 두 번 넣어 균열 비중을 밀도 상한 없이 40% 로 올린다 —
    // 포장이 갈라진 자국이 이 행성 지면의 지배적 무늬다.
    { cell: 157, kinds: ['fissure', 'fissure', 'rubble', 'lichen', 'debris'], density: 0.36,
      minScale: 1, maxScale: 1, minAlpha: 0.32, maxAlpha: 0.58, salt: 0x2000 },
    // 부조 — 랜드마크. 개수를 늘리면 "균질한 시각 밀도"로 되돌아간다.
    // `column` 을 두 번 넣어 쓰러진 기둥이 이 행성 랜드마크의 절반을 차지하게 했다.
    { cell: 433, kinds: ['column', 'column', 'block', 'terrace'], density: 0.46,
      minScale: 1, maxScale: 1, minAlpha: 0.34, maxAlpha: 0.55, salt: 0x4000,
      siteGate: 'darkTerrain', highlight: { minAlpha: 0.11, maxAlpha: 0.17 },
      noFlip: true, minDensityScale: 0.7 },
  ],
};
