/**
 * 크라스 — 파괴 폐허. 무너진 구조물·잔해 더미·재·꺼져가는 불.
 *
 * ## 이 행성이 카르곤과 다른 점 (값을 정한 근거)
 * - **하부 = 재와 먼지가 덮인 갈라진 포장**, **상부 = 무너진 콘크리트 구조체**다. 둘 다
 *   중성 회색이고 명도차가 크지 않다(카르곤은 검은 현무암 ↔ 주황 용융지대라 명도비 1.59).
 *   그래서 이 행성의 구조 정보는 **명도 대비가 아니라 균열선·틈·부스러기의 밀도**로 실린다.
 * - **채도 있는 색은 균열 심지에만.** 크라스 안전 색상 골짜기는
 *   `computeSafeHueWindows(FOREGROUND_SIGNAL_COLORS, 10)` 의 여섯 골짜기 중 마지막인
 *   **325.0°→345.4°(폭 20.4°)** 뿐이다 — 마젠타 적탄(315.0°)과 hot-red 적탄(355.4°) 사이의
 *   좁은 자적색 대역. `veinTarget`·`crazeTarget`·`emberRgb` 가 전부 그 안(337~343°)에 있고,
 *   나머지 면은 전부 저채도 회흑이다.
 * - **크라스 적 4종의 몸통색이 전부 rgb(224,138,106)(휘도 154·채도 0.53·색상각 16.3°)** 로
 *   같다. 위장 판정은 배경 픽셀이 그 색에서 ΔRGB 합 70 미만인 비율이므로, 이 행성에서
 *   가장 위험한 것은 **중간 밝기의 연어색**이다. 자적 잔불의 G 채널을 100 아래로 묶어
 *   두면(적은 G=138) 색이 아무리 붉어도 거리 68 이상이 G 하나로 확보된다 — `veinTarget`
 *   G=96, `crazeTarget` G=40 이 그 이유다.
 *
 * ## 광원
 * 크라스의 장면 조명은 **무너진 천장 사이로 들어오는 흐린 하늘 확산광이고 위에서 온다**
 * (`themes/kras/index.ts` 의 `light` 가 정본). 확산광이라 방향 대비가 약하므로 하부 틈의
 * 위쪽 입술(`lipUp`)을 카르곤의 2.1 에서 1.6 으로 낮추고 아래쪽(`lipDown`)을 0.15 → 0.4 로
 * 올렸다 — 그림자가 완전히 죽지 않는 것이 확산광의 서명이다.
 *
 * 규칙(불변식 I1~I4)은 `scripts/tileset-gen.mjs` 헤더에 있다. 여기 있는 것은 크라스 수치뿐이다.
 */
export default {
  planet: 'kras',
  name: 'kras — 오프라인 합성 Wang 타일셋 (파괴 폐허)',

  tile: 32,
  cols: 4,
  fillVariants: 7,
  /** 카르곤(0)과 구조까지 갈라 놓기 위한 오프셋. 한 번 정했으면 고정한다. */
  seedOffset: 0x5c00,
  normalise: 'multiplicative',

  /**
   * 실루엣은 메커니즘이다(전 타일 공유 + 180° 대칭 + 진폭 < 1). 옥타브 **시드**만 카르곤과
   * 다르게 잡아 폐허의 지형 윤곽이 화산의 그것과 겹쳐 보이지 않게 했다.
   *
   * ⚠️ 시드는 취향이 아니라 **측정으로 고른 값**이다. 실루엣은 전 타일이 공유하는 (u,v) 의
   * 고정 함수라, 타일 안 위치마다 상부(밝음)로 분류될 확률이 치우치면 그 치우침이 그대로
   * **64px 주기의 명암 무늬**가 된다(I1~I4 는 이걸 못 잡는다 — 균일 타일 내부만 보기 때문).
   * 12조합을 오프라인 프리뷰로 실측해 격자 excess 를 비교했고 폭은 0.94~2.00 이었다.
   * 채택값의 excess x 0.62 / y 0.94 는 같은 파이프라인으로 잰 **카르곤 1.51 보다 낮다**.
   * 진폭 0.78 은 0.86 과 excess 차이가 0.02 였으나(무의미) 상부 점유율을 카르곤(0.471)에
   * 가깝게 유지하는 쪽을 골랐다.
   */
  silhouette: {
    amp: 0.78,
    octaves: [
      { seed: 0xe42d1d4b, cells: 4, weight: 0.46 },
      { seed: 0xb70f8fa9, cells: 8, weight: 0.32 },
      { seed: 0x99ab1654, cells: 16, weight: 0.22 },
    ],
  },

  palette: {
    /**
     * 하부 = 재·먼지가 덮인 갈라진 포장. 평균은 낮게, 국소 대비는 부스러기와 파편 반짝임으로.
     * `glintRgb` 가 카르곤(약한 자색 흑요석)과 반대로 **차가운** 이유는 여기서 반짝이는 것이
     * 깨진 유리와 노출된 금속이기 때문이다.
     */
    lower: {
      fissureW: 0.15, // 카르곤 0.13 보다 넓다 — 깨진 포장의 틈은 용암 판 사이보다 벌어져 있다
      lipUp: 1.6, // 확산광이라 위쪽 입술도 강하게 빛나지 않는다
      lipDown: 0.4, // 그림자가 완전히 죽지 않는 것이 확산광의 서명
      midACells: 4,
      midBCells: 8,
      fineCells: 16,
      gritCells: 32,
      densCells: 3, // ⚠️ 진폭 변조 전용(zero-mean 항에만 곱한다) — 휘도에 더하면 I4 위반
      baseL: 29,
      idAmp: 6,
      midAAmp: 6,
      midBAmp: 18,
      fineAmp: 14,
      gritAmp: 9, // 카르곤보다 높다 — 잿가루·모래가 표면을 덮고 있다
      fissureAmp: 21,
      lipAmp: 20,
      roughBias: 0.22,
      roughGain: 1.6,
      glintCut: 0.9, // 상위 10% 만 — 유리 파편은 흑요석보다 성기게 박혀 있다
      glintGain: 96,
      glintDensBias: 0.35,
      glintDensGain: 1.4,
      glintDensCap: 1.5,
      emberCut: 0.88,
      emberGain: 2.6,
      rgb: [1.0, 0.97, 0.99], // 거의 중성인 잿빛
      glintRgb: [0.92, 0.96, 1.12], // 깨진 유리·노출 금속의 차가운 반짝임
      emberRgb: [26, 5, 12], // 틈 바닥에 남은 자적 잔불(340.6°)
    },

    /**
     * 상부 = 무너진 콘크리트 구조체. **밝은 판이 아니다** — 지배색은 중성 회색 콘크리트이고
     * 밝기는 균열 심지에만 있다. `crustL` 38 은 카르곤 36 보다 겨우 2 높은데, 이 행성 적이
     * 밝은 연어색(휘도 154)이라 지각 평균을 올리는 순간 그 위에서 위장되기 때문이다.
     */
    upper: {
      veinPow: 3.2, // 심지 집중도를 카르곤보다 올렸다 — 잔불은 균열 **바닥**에만 남아 있다
      bevelGain: 1.5,
      midCells: 6,
      fineCells: 16,
      gritCells: 32,
      crustL: 38,
      idAmp: 6,
      midAmp: 13,
      fineAmp: 10,
      gritAmp: 6,
      bevelAmp: 7,
      rgb: [1.06, 1.0, 1.02], // 콘크리트: 거의 중성, 아주 약한 자기(紫氣)
      haloScale: 3.2, // 균열 바깥 어두운 후광 — 평균을 안 올리고 선을 읽히게 하는 유일한 수단
      shadeAmp: 0.36,
      crazePow: 2.5,
      crazeMidBias: 0.35,
      crazeMidGain: 0.45,
      crazeTarget: [120, 40, 62], // 잔금(343.5°). G=40 이라 적 몸통색과 G 만으로 98 벌어진다
      crazeMix: [0.78, 0.5, 0.42],
      veinLin: 0.3,
      veinCore: 0.92,
      veinMidBias: 0.7,
      veinMidGain: 0.42,
      veinTarget: [255, 96, 152], // 균열 심지의 자적 잔불(338.9°) — 골짜기 한가운데
      veinMixR: 0.95,
      veinMixG: [0.28, 0.6],
      veinMixB: [0.2, 0.6],
    },

    /**
     * 경계에 인접한 상부 픽셀의 감쇠. 카르곤(0.5/0.42/0.42, 식은 테두리)보다 얕고 중성이다 —
     * 폐허의 경계는 "식은 자리"가 아니라 **부서져 나간 단면**이라 색이 아니라 명도만 떨어진다.
     */
    edge: [0.55, 0.52, 0.54],
  },

  /**
   * 변형 8종과 밴드 배분(정적 3 / 중 3 / 파쇄 2).
   *
   * 폐허의 리듬은 **온전히 남은 바닥판 ↔ 완전히 부서진 구역**의 교대다. 그래서 정적 밴드는
   * 카르곤 슬래브보다 더 조용하게(`veinAmp` 0.45~0.55, `crazeAmp` 0.14~0.2), 파쇄 밴드는 더
   * 잘게(`crazeCells` 15·19) 잡아 두 밴드의 거리를 벌렸다. 밴드 간 대비는 휘도가 아니라
   * **밀도**로만 준다(밴드 정규화가 평균 밝기를 밴드 안에서 고정한다).
   *
   * 판 셀 수를 카르곤보다 전반적으로 낮게 잡은 이유(중 밴드 3~4셀)는 무너진 구조가
   * **각지고 큰 판**으로 남기 때문이다. 흐름 방향(cellsX ≠ cellsY)은 밴드 단위로 통일한다.
   */
  styles: [
    // 0 — 기본(16장 Wang 전부 + 채움 슬롯 0). 중(中) 스케일, 세로 흐름.
    { band: 1, lowCells: 3, lowCellsY: 5, lowGrit: 1.0, lowPlate: 1.0, hotCells: 3, hotCellsY: 5, veinW: 0.14, veinAmp: 0.95, crazeCells: 10, crazeCellsY: 14, crazeW: 0.1, crazeAmp: 0.6 },
    // 1 — **온전한 바닥판**: 균열이 거의 없다. 화면의 정적 담당.
    { band: 0, lowCells: 2, lowGrit: 0.4, lowPlate: 0.32, hotCells: 2, veinW: 0.05, veinAmp: 0.5, crazeCells: 4, crazeW: 0.045, crazeAmp: 0.14 },
    // 2 — 대(大) 스케일: 통째로 기울어진 큰 콘크리트 판, 굵고 성긴 균열.
    { band: 1, lowCells: 2, lowCellsY: 4, lowGrit: 0.85, lowPlate: 1.2, hotCells: 2, hotCellsY: 4, veinW: 0.2, veinAmp: 1.05, crazeCells: 5, crazeCellsY: 8, crazeW: 0.07, crazeAmp: 0.32 },
    // 3 — 소(小) 스케일: 잘게 깨진 파쇄대.
    { band: 2, lowCells: 6, lowCellsY: 4, lowGrit: 1.35, lowPlate: 0.85, hotCells: 6, hotCellsY: 4, veinW: 0.11, veinAmp: 0.95, crazeCells: 15, crazeCellsY: 11, crazeW: 0.085, crazeAmp: 0.62 },
    // 4 — **바닥판 2**: 결이 다른 정적 구역(잔금만 살짝).
    { band: 0, lowCells: 3, lowGrit: 0.48, lowPlate: 0.45, hotCells: 3, veinW: 0.055, veinAmp: 0.45, crazeCells: 6, crazeW: 0.05, crazeAmp: 0.2 },
    // 5 — 극소 스케일: 잔해가 밀집한 좁은 띠. 리듬의 강세.
    { band: 2, lowCells: 8, lowCellsY: 6, lowGrit: 1.5, lowPlate: 0.7, hotCells: 9, hotCellsY: 6, veinW: 0.09, veinAmp: 0.85, crazeCells: 19, crazeCellsY: 14, crazeW: 0.07, crazeAmp: 0.55 },
    // 6 — **바닥판 3**: 정적 밴드의 세 번째 결. 밴드 안에 그림이 둘뿐이면 조용한 구역에서
    //      64px 반복이 눈에 잡힌다(생성기가 3종 이상을 강제한다).
    { band: 0, lowCells: 4, lowCellsY: 3, lowGrit: 0.6, lowPlate: 0.68, hotCells: 2, hotCellsY: 3, veinW: 0.07, veinAmp: 0.55, crazeCells: 3, crazeCellsY: 4, crazeW: 0.055, crazeAmp: 0.18 },
    // 7 — 중 스케일 변주.
    { band: 1, lowCells: 4, lowCellsY: 6, lowGrit: 1.1, lowPlate: 1.0, hotCells: 4, hotCellsY: 6, veinW: 0.13, veinAmp: 1.0, crazeCells: 12, crazeCellsY: 16, crazeW: 0.09, crazeAmp: 0.5 },
  ],
};
