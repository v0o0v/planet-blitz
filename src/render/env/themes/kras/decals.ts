/**
 * 크라스 데칼 테마 데이터 — 무너진 슬래브 · 쓰러진 철골 · 잔해 더미 · 포격 구덩이 · 기반 균열 ·
 * 파편 · 그을림 · 재.
 *
 * ## 폐허를 기하가 아니라 데이터로 만든 방법
 * 실루엣 프리미티브 9종은 전부 행성 무관이고 이 파일은 **코드를 한 줄도 쓰지 않는다.**
 * "파괴 폐허"는 세 가지로만 만들어진다.
 *
 * 1. **어떤 실루엣을 쓰고 어떤 것을 버리는가.** 크라스는 `flow`(테이퍼 비드 체인 = 방향성
 *    흐름 자국)를 **하나도 쓰지 않는다.** 카르곤에서 그것은 식은 용암 흐름이었고, 폐허에는
 *    흐른 것이 없다 — 무너져 쌓였을 뿐이다. 이 부재가 두 행성의 가장 큰 형태 차이다.
 * 2. **같은 실루엣을 스케일로 쪼개는가.** `crack` 을 굵은 기반 균열(`fracture`, r 45)과 실금
 *    (`hairline`, r 22)으로, `cluster` 를 잔해 파편(`debris`, r 27)과 유리·금속 파편
 *    (`shard`, r 15)으로 나눴다. 카르곤은 각각 하나씩이었다 — 폐허의 지면은 **깨진 정도가
 *    자리마다 다른 것**이 서명이라 한 스케일로는 표현되지 않는다.
 * 3. **격자 밀도와 후보 가중.** 잔 데칼 격자의 밀도를 0.36 → 0.46 으로 올리고 후보 8칸 중
 *    4칸을 파편(`debris`×2·`shard`×2)에 줬다. 부조 격자는 `girder` 를 두 번 넣어 **직선
 *    실루엣의 비중**을 올렸다 — 자연 지형에 없는 것은 직선이고, 그게 "여기 구조물이 있었다"를
 *    말하는 유일한 형태다.
 *
 * ## 크라스 실측이 값을 정한 방식
 * - **바닥 밝기 128 / 암부 80.** `assets/tilesets/kras.png` Wang 16장 RGB 합 평균이 103,
 *   하부 영역만 보면 약 77 이다. 여기에 지형광 겹의 상승분을 얹었다. 카르곤(150/90)보다 낮은
 *   이유는 크라스에 용암 같은 밝은 지대가 없기 때문이다 — 곱연산의 화면차가
 *   `바닥밝기 × α × (1−배수)` 라 이 둘이 데칼 세기 예측의 기준점이고, **타일셋 교체 시
 *   갱신 대상 1순위**다.
 * - **배수 팔레트가 전부 저채도 회흑인 이유**는 크라스 적 4종의 몸통색이 예외 없이
 *   rgb(224,138,106)(휘도 154·채도 0.53)이기 때문이다. 위장 판정은 배경 픽셀이 그 색에서
 *   ΔRGB 합 70 미만인 비율이므로 **중간 밝기의 따뜻한 색이 이 행성에서 가장 위험하다**.
 *   가장 따뜻한 슬롯인 `scorchBand`(0xa8968e)조차 R−B 가 26 뿐이다.
 * - **가산 하이라이트를 남긴 이유**는 광원이 위에 있기 때문이다. 크라스의 명암 이원성은
 *   카르곤만큼 극단적이지 않지만(시트 상/하부 휘도비 1.65), 확산광 아래에서 잔해 더미의
 *   **윗면**을 밝히지 않으면 부조가 지면에 눌러 찍은 얼룩으로 읽힌다. 그래서 `glow` 는
 *   불이 아니라 **하늘색**이다 — 차가운 청회색(0x5a6270).
 */

import type { DecalTheme } from '../../contracts/decals.js';

export const KRAS_DECALS: DecalTheme = {
  themeId: 'kras',
  /** 크라스 Wang 타일 원본 32px(표시 64px 로 2배 확대). */
  sourceTilePx: 32,
  floorLumaSum: 128,
  darkFloorLumaSum: 80,
  /** 접지 음영 — 팔레트에서 가장 진하다. 아주 옅게 차갑다(확산 하늘광 아래의 그림자). */
  ground: 0x38363a,
  /** 곱연산 위에 한 번 더 곱하는 틴트. 잿빛 중성 ↔ 차가운 콘크리트 ↔ 따뜻한 그을음. */
  tints: [0xffffff, 0xe8e4de, 0xd2cfd6, 0xdcd6cc, 0xc8ccd2, 0xcfc9c4],
  /**
   * 가산 하이라이트 팔레트 = **하늘색**. 위에서 오는 확산광이 잔해 윗면에 앉는다.
   * 텍셀당 최대 광량은 `lumaSum × 상한 알파` = 300 × 0.17 = 51 로 상한 60 안이다.
   */
  glow: {
    rim: 0x5a6270,
    face: 0x1e2228,
  },
  kinds: [
    // ── 암부 랜드마크 3종. `r × elong` 이 132~134 근처인 것은 발자국 대역 [200,400] 과
    //    부조 변형 표·흔들림의 산술적 귀결이고, `validateDecalTheme` 이 실제로 검사한다.
    // 무너진 콘크리트 슬래브 — 본체 / 그늘.
    { id: 'slabFall', silhouette: 'boulder', r: 118, elong: 1.12, coverage: 0.5, opacity: 0.9,
      slots: [0x7b7a80, 0x4b4a50] },
    // 쓰러진 철골 대들보 — 이 행성에서 가장 길쭉한 실루엣. 직선이 폐허의 서명이다.
    { id: 'girder', silhouette: 'ridge', r: 72, elong: 1.86, coverage: 0.3, opacity: 0.92,
      slots: [0x84828a, 0x50505a] },
    // 잔해 더미 — 낮게 퍼진 적층. 파편이 흘러내려 쌓인 자리라 가장 넓게 퍼진다.
    { id: 'rubbleHeap', silhouette: 'mound', r: 96, elong: 1.38, coverage: 0.48, opacity: 0.86,
      slots: [0x8e8b88, 0x585349] },
    // 포격 구덩이 — 림(가장 옅다: 안쪽이 더 어두워야 링으로 읽힌다) / 바닥 / 심연.
    { id: 'crater', silhouette: 'ring', r: 46, elong: 1.0, coverage: 0.6, opacity: 0.9,
      slots: [0xa49f9c, 0x6a6560, 0x3d3a38] },
    // 기반 균열 — 겉선(넓게) / 코어(1텍셀). 코어가 팔레트에서 가장 진하다: 갈라진 기반은
    // 테두리가 아니라 그 자체가 가장 깊은 홈이다.
    { id: 'fracture', silhouette: 'crack', r: 45, elong: 2.1, coverage: 0.12, opacity: 0.95,
      slots: [0x6e6a68, 0x2e2c2e] },
    // 실금 — 같은 실루엣의 절반 스케일. 깨진 정도의 편차가 폐허 지면의 서명이다.
    { id: 'hairline', silhouette: 'crack', r: 22, elong: 2.6, coverage: 0.1, opacity: 0.9,
      slots: [0x7c7876, 0x3a3838] },
    // 잔해 파편 — 밝은 파편 / 어두운 파편.
    { id: 'debris', silhouette: 'cluster', r: 27, elong: 1.05, coverage: 0.32, opacity: 0.88,
      slots: [0x8d8983, 0x565049] },
    // 유리·금속 파편 — 더 작고 더 차갑다(깨진 창·노출 배선).
    { id: 'shard', silhouette: 'cluster', r: 15, elong: 1.0, coverage: 0.26, opacity: 0.9,
      slots: [0x9a9aa2, 0x5c5c66] },
    // 폭발 비산 자국 — 본체 / 튄 방울.
    { id: 'blastScar', silhouette: 'splatter', r: 43, elong: 1.28, coverage: 0.3, opacity: 0.92,
      slots: [0x726d6a, 0x4e4a48] },
    // 재 퇴적 — 거의 변화 없는 옅은 안개(겹을 적게, 겹 알파를 낮게).
    { id: 'ashFall', silhouette: 'haze', r: 48, elong: 1.42, coverage: 0.85, opacity: 0.44,
      slots: [0xbcb8b2], soft: { rings: 10, ringAlpha: 0.09, wobble: 0.28 } },
    // 그을음.
    { id: 'soot', silhouette: 'haze', r: 16, elong: 1.2, coverage: 0.7, opacity: 0.9,
      slots: [0x46443f], soft: { rings: 12, ringAlpha: 0.14, wobble: 0.4 } },
    // 대역 변색 — 먼지가 덮인 차가운 쪽.
    { id: 'dustDrift', silhouette: 'haze', r: 122, elong: 1.32, coverage: 0.84, opacity: 0.54,
      slots: [0x9aa0a6] },
    // 대역 변색 — 그을린 따뜻한 쪽. 팔레트에서 유일하게 R−B 가 양수다(26).
    { id: 'scorchBand', silhouette: 'haze', r: 122, elong: 1.28, coverage: 0.84, opacity: 0.54,
      slots: [0xa8968e] },
  ],
  /**
   * 뒤 → 앞. 부조가 맨 앞인 이유: 잔 데칼(균열·파편)은 지면의 무늬이므로 잔해 더미 **아래**를
   * 지나야 한다. 순서를 뒤집으면 균열이 슬래브 위로 지나가 슬래브가 "얹힌 판때기"로 읽힌다.
   *
   * 셀 크기 811·353·137·431 은 전부 소수라 타일 크기 64 및 서로끼리 서로소다(검증이 강제한다).
   * 카르곤(787·337·149·419)과 다른 수를 고른 이유는 두 행성이 같은 자리에 같은 얼룩을 놓지
   * 않게 하기 위해서지 값 자체에 의미가 있어서가 아니다.
   */
  grids: [
    // 대역 변색 — 화면 절반만 한 얼룩. 시차 레이어가 암부 저주파를 맡으므로 알파를 낮게 유지한다.
    { cell: 811, kinds: ['dustDrift', 'scorchBand'], density: 0.9,
      minScale: 2, maxScale: 2, minAlpha: 0.12, maxAlpha: 0.26, salt: 0x3000 },
    // 큰 데칼 — 1920×1080 에 기대 ~11장. 폭격의 흔적(구덩이·비산)이 이 층의 주력이다.
    { cell: 353, kinds: ['crater', 'blastScar', 'ashFall', 'fracture'], density: 0.48,
      minScale: 1, maxScale: 1, minAlpha: 0.3, maxAlpha: 0.56, salt: 0x1000 },
    // 잔 데칼 — 기대 ~44장. 카르곤(밀도 0.36·후보 5)보다 촘촘하고 후보 8칸 중 4칸이 파편이다.
    // **폐허의 지면은 파편이 덮고 있다**가 이 한 줄에 들어 있다.
    { cell: 137, kinds: ['debris', 'debris', 'shard', 'shard', 'hairline', 'hairline', 'soot', 'blastScar'],
      density: 0.46, minScale: 1, maxScale: 1, minAlpha: 0.3, maxAlpha: 0.58, salt: 0x2000 },
    // 부조 — 랜드마크. 후보 5칸 중 2칸이 `girder` 다(카르곤은 `boulder` 편중이었다):
    // 직선 실루엣이 화면에 있어야 "무너진 구조물"로 읽힌다.
    // 5×3 = 15셀 × 0.5 ≈ 7.5 후보 → 지형 게이트가 걸러 화면당 평균 2~3개.
    { cell: 431, kinds: ['girder', 'girder', 'slabFall', 'slabFall', 'rubbleHeap'], density: 0.5,
      minScale: 1, maxScale: 1, minAlpha: 0.34, maxAlpha: 0.56, salt: 0x4000,
      siteGate: 'darkTerrain', highlight: { minAlpha: 0.1, maxAlpha: 0.17 },
      noFlip: true, minDensityScale: 0.7 },
  ],
};
