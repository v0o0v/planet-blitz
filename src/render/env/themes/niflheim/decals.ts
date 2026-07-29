/**
 * 니플헤임 데칼 테마 데이터 — 눈 흐름 자국 · 융해 함몰 · 날린 눈가루 · 서릿발 균열 ·
 * 빙탑(serac) · 압력 능선.
 *
 * ## 이 행성 실측이 값들을 정한 방식
 * - **바닥 밝기 146 / 암부 71.** 타일셋 프리뷰(시드 12345) 실측: 화면 전체 rgb(43,46,58)
 *   합 146, L<40 영역(노출 암반, 63.5%) rgb(20,21,29) 합 71, L≥70 영역(설면, 33.6%)
 *   rgb(85,91,109) 합 285. 타일셋을 교체하면 **이 둘이 갱신 대상 1순위**다.
 * - **`glow`(가산 하이라이트)를 통째로 뺐다.** 카르곤이 그것을 넣은 이유는 곱연산의 화면차가
 *   `바닥밝기 × α × (1−배수)` 라 합 90 짜리 현무암 위에서 거의 아무 일도 못 했기 때문이다.
 *   빙원은 정확히 반대다 — 부조가 놓이는 설면은 합 **285**(카르곤 암부의 3.2배)라 곱연산만으로
 *   더 강한 대비가 나온다. 실증: 카르곤 부조 α 0.45 × 어둡기 0.543 × 90 ≈ 22,
 *   니플헤임 부조 α 0.28 × 0.54 × 285 ≈ 43. **알파를 오히려 낮추고도 2배**다.
 *   여기에 가산을 얹으면 밝은 바닥이 창백한 얼음 시안 적(L 181~201) 쪽으로 밀려 위장이 난다.
 * - **부조의 지형 게이트가 `brightTerrain` 이다.** 카르곤은 암부 게이트였는데, 이 뒤집기가
 *   `SiteGate` 가 타일 대역이 아니라 "원하는 성질"로 선언되는 이유다. 빙탑·압력 능선은
 *   빙원 위에 서고, 노출 암반 위에 세우면 얼음 지형물이라는 서사가 깨진다.
 * - **배수 팔레트가 저채도 청회색인 이유**는 배수가 명도 변조여야지 색 필터면 안 되기 때문이다
 *   (크로마 상한 60). 눈의 푸른 기는 배수가 아니라 타일셋 팔레트와 지형광이 만든다.
 * - 광원 **방향**은 여기가 아니라 `themes/niflheim/index.ts` 의 공유 `light` 에 있다 —
 *   지형광 레이어가 같은 값을 읽어야 화면에 태양이 하나다.
 */

import type { DecalTheme } from '../../contracts/decals.js';

export const NIFLHEIM_DECALS: DecalTheme = {
  themeId: 'niflheim',
  /** 니플헤임 Wang 타일 원본 32px(표시 64px 로 2배 확대). */
  sourceTilePx: 32,
  floorLumaSum: 146,
  darkFloorLumaSum: 71,
  /** 접지 음영 — 팔레트에서 가장 진하다. 눈 위 그림자라 청색 쪽으로 기울였다. */
  ground: 0x32363f,
  /** 곱연산 위에 한 번 더 곱하므로 더 어둡게만 만든다. 전부 한색 계열. */
  tints: [0xffffff, 0xe4ecf8, 0xd0dcee, 0xc8d4e6, 0xdce4f0, 0xbfc8da],
  kinds: [
    // 바람에 밀린 눈 흐름 자국 — 본체 / 심 / 코어.
    { id: 'driftTrail', silhouette: 'flow', r: 42, elong: 2.4, coverage: 0.5, opacity: 0.95,
      slots: [0x8e919c, 0x63666f, 0x484b53] },
    // 융해 함몰(moulin) — 림(가장 옅다: 안쪽이 더 어두워야 링으로 읽힌다) / 바닥 / 심연.
    { id: 'sinkhole', silhouette: 'ring', r: 44, elong: 1.0, coverage: 0.62, opacity: 0.9,
      slots: [0xa9adb8, 0x6d707a, 0x41444c] },
    // 날린 눈가루 퇴적 — 거의 변화 없는 옅은 안개(겹을 적게, 겹 알파를 낮게).
    { id: 'powder', silhouette: 'haze', r: 46, elong: 1.45, coverage: 0.85, opacity: 0.45,
      slots: [0xc2c6d2], soft: { rings: 10, ringAlpha: 0.09, wobble: 0.28 } },
    // 얼음 파쇄 비산 — 본체 / 튄 조각.
    { id: 'iceSpray', silhouette: 'splatter', r: 44, elong: 1.3, coverage: 0.3, opacity: 0.92,
      slots: [0x7d818c, 0x585b64] },
    // 서릿발 균열 — 겉선(넓게) / 코어(1텍셀). 코어가 팔레트에서 가장 진하다: 크레바스는
    // 테두리가 아니라 그 자체가 가장 깊은 홈이다.
    { id: 'rimeCrack', silhouette: 'crack', r: 44, elong: 2.0, coverage: 0.12, opacity: 0.95,
      slots: [0x6c6f7a, 0x2e3038] },
    // 깨진 얼음 파편 — 밝은 조각 / 어두운 조각.
    { id: 'shatterIce', silhouette: 'cluster', r: 26, elong: 1.0, coverage: 0.3, opacity: 0.88,
      slots: [0x92959f, 0x585b64] },
    // 빙하 표면 먼지 띠(cryoconite) — 눈 위의 유일한 무채 오염.
    { id: 'cryoconite', silhouette: 'haze', r: 17, elong: 1.2, coverage: 0.7, opacity: 0.9,
      slots: [0x4b4d55], soft: { rings: 12, ringAlpha: 0.14, wobble: 0.4 } },
    // 대역 변색 — 그늘 쪽(주력). 푸른 기를 남기고 붉은 기를 깎는다.
    { id: 'stainShade', silhouette: 'haze', r: 120, elong: 1.35, coverage: 0.84, opacity: 0.54,
      slots: [0x8b909c] },
    // 대역 변색 — 저각 태양이 스친 쪽(붉은 기를 남겨 눈에 미세한 온기를 준다).
    { id: 'stainSun', silhouette: 'haze', r: 120, elong: 1.3, coverage: 0.84, opacity: 0.54,
      slots: [0xa89e96] },
    // ── 설면 랜드마크 3종. `r × elong` 이 133 근처로 맞춰져 있고(대역 [200,400] 의
    //    산술적 귀결), 그 산술은 `validateDecalTheme` 이 실제로 검사한다.
    { id: 'serac', silhouette: 'boulder', r: 118, elong: 1.13, coverage: 0.52, opacity: 0.9,
      slots: [0x82868f, 0x4f525a] },
    { id: 'pressureRidge', silhouette: 'ridge', r: 68, elong: 1.95, coverage: 0.34, opacity: 0.92,
      slots: [0x8a8d96, 0x565962] },
    { id: 'snowMound', silhouette: 'mound', r: 96, elong: 1.38, coverage: 0.46, opacity: 0.86,
      slots: [0x989ba4, 0x5d6069] },
  ],
  /**
   * 뒤 → 앞. 부조가 맨 앞인 이유: 잔 데칼(균열·파편)은 지면의 무늬이므로 빙탑 **아래**를
   * 지나야 한다. 순서를 뒤집으면 균열이 빙탑 위로 지나가 빙탑이 "얹힌 판때기"로 읽힌다.
   *
   * 셀 크기 4종은 전부 소수라 서로소이고 표시 타일 64 와도 서로소다(공명 금지).
   * 카르곤과 다른 소수를 골랐다 — 같은 값을 쓰면 두 행성의 얼룩 위상이 같아진다.
   */
  grids: [
    // 대역 변색 — 화면 절반만 한 얼룩. 알파를 낮게 유지한다(시차 레이어가 암부 저주파를
    // 맡으므로 대역이 겹치면 둘 다 탁해진다). 배율 2 고정 + 반경 120 으로 발자국을 유지.
    { cell: 811, kinds: ['stainShade', 'stainSun'], density: 0.9,
      minScale: 2, maxScale: 2, minAlpha: 0.12, maxAlpha: 0.26, salt: 0x3100 },
    // 큰 데칼 — 1920×1080 에 기대 ~11장.
    { cell: 353, kinds: ['driftTrail', 'sinkhole', 'iceSpray', 'powder'], density: 0.45,
      minScale: 1, maxScale: 1, minAlpha: 0.28, maxAlpha: 0.54, salt: 0x1100 },
    // 잔 데칼 — 기대 ~35장. `rimeCrack` 을 두 번 넣어 균열 비중을 밀도 상한 없이 40% 로 올린다.
    { cell: 157, kinds: ['rimeCrack', 'rimeCrack', 'shatterIce', 'cryoconite', 'iceSpray'],
      density: 0.36, minScale: 1, maxScale: 1, minAlpha: 0.3, maxAlpha: 0.54, salt: 0x2100 },
    // 부조 — 랜드마크. `brightTerrain` 게이트라 빙원 위에만 선다. 알파가 카르곤(0.34~0.55)보다
    // 낮은데도 화면차는 2배다 — 설면이 밝아 곱연산이 잘 듣기 때문(헤더의 산술 참조).
    // `noFlip` 은 하이라이트가 없어도 켠다: 광원에 x 성분(cos ≈ 0.276)이 있어 좌우반전이
    // 그늘 슬롯의 방향을 거울로 뒤집는다.
    { cell: 431, kinds: ['serac', 'serac', 'pressureRidge', 'snowMound'], density: 0.48,
      minScale: 1, maxScale: 1, minAlpha: 0.2, maxAlpha: 0.34, salt: 0x4100,
      siteGate: 'brightTerrain', noFlip: true, minDensityScale: 0.7 },
  ],
};
