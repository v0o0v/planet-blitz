/**
 * 아르케 — 유적. 석회암 축조물이 무너져 지층에 반쯤 묻힌 행성.
 *
 * ## 이 행성의 제약은 색이 아니라 **채도**다
 * 아르케의 자연스러운 금갈색(≈38~41°)은 앰버 적탄(28.5°)과 옐로 적탄(50.9°) 사이 폭 2.4° 슬롯에
 * 정확히 끼인다. 색상각으로는 전경과 분리할 수 없다는 뜻이라, 정체성을 **명도·질감·기하**로
 * 세우고 팔레트는 무채에 가깝게 내렸다. `rgb` 배수의 채널 편차가 작을수록(= 채도가 낮을수록)
 * 색상각 충돌 자체가 약해진다 — 아래 두 팔레트의 HSV 채도는 하부 0.04 · 상부 0.08 이다.
 *
 * ## 정체성을 어디에 실었나
 * - **판 사이 이음매**(worley `fissure`/`vein`). 거석 축조(cyclopean masonry)의 다각형 판이라
 *   벽돌처럼 직사각형이 아니다 — 직사각형은 180° 회전 변주로도 지울 수 없어(카르곤 회고)
 *   반복이 그대로 보인다.
 * - **판마다 위쪽 입술만 밝은 베벨**(`lipUp`·`bevelAmp`). 광원이 위에 있다는 사실을 픽셀에서
 *   반복 진술하는 자리이며, 석재가 "그려진 무늬"가 아니라 "깎인 덩어리"로 읽히게 하는 유일한
 *   단서다. 카르곤에서 결정적이었던 지형 경계 릴리프의 타일 내부 판이다.
 * - **밝기는 선 위에만.** 껍질 명도(`crustL`)는 카르곤과 같은 대역에 두고, 밝은 것은 이음매
 *   상단 립뿐이다. 유적을 "밝은 돌판"으로 만들면 영역 평균이 올라가 그 위의 적이 위장된다.
 *
 * 액센트(녹청·이끼)는 이음매 **바닥에만** 소량 넣는다(`emberRgb`). 넓은 골짜기의 차가운 끝이라
 * 전경 신호색과 충돌하지 않으면서 "산화한 청동"이라는 서사를 준다.
 */
export default {
  planet: 'arke',
  name: 'arke — 오프라인 합성 Wang 타일셋 (유적)',

  tile: 32,
  cols: 4,
  fillVariants: 7,
  /** 아르케 고유 시드. 카르곤과 다른 그림이 나오도록 오프셋만 다르다. 한 번 정했으면 고정. */
  seedOffset: 0x3300,
  normalise: 'multiplicative',

  /**
   * 실루엣은 메커니즘이다(I1·I2) — 스케일 3단·전 타일 공유·180° 대칭. 카르곤과 옥타브 시드를
   * 달리해 경계 모양만 바꾼다. 진폭을 0.80 으로 조금 낮춘 이유는 유적 지형의 경계가 화산 지각의
   * 흘러내린 손가락보다 덜 너덜거려야 하기 때문이다(경계가 잔잔할수록 축조물처럼 읽힌다).
   */
  silhouette: {
    amp: 0.8,
    octaves: [
      { seed: 0x6f1b2c05, cells: 4, weight: 0.48 },
      { seed: 0x27d4eb2d, cells: 8, weight: 0.31 },
      { seed: 0x9e3779b1, cells: 16, weight: 0.21 },
    ],
  },

  palette: {
    /**
     * 하부 = 묻힌 포장(paving). `fissure` 가 여기서는 용암 틈이 아니라 **석재 이음매**다 —
     * 대역을 카르곤보다 넓히고(0.13 → 0.155) 위쪽 립을 더 세게 세워(2.1 → 2.6) 판 하나하나가
     * 두께를 가진 것처럼 보이게 했다. 얇은 선이라 크기가 커도 64px 반복에 잡히지 않는다(I4).
     */
    lower: {
      fissureW: 0.135,
      lipUp: 2.6,
      lipDown: 0.1,
      midACells: 5,
      midBCells: 9,
      fineCells: 16,
      gritCells: 32,
      densCells: 3,
      baseL: 26,
      idAmp: 4,
      midAAmp: 6,
      midBAmp: 17,
      fineAmp: 13,
      gritAmp: 7,
      fissureAmp: 26,
      lipAmp: 30,
      roughBias: 0.2,
      roughGain: 1.55,
      /** 석영·운모 반짝임. 카르곤 흑요석보다 드물고(0.90) 약하다 — 젖은 유리가 아니라 마른 돌. */
      glintCut: 0.9,
      glintGain: 96,
      glintDensBias: 0.32,
      glintDensGain: 1.4,
      glintDensCap: 1.5,
      /** 이음매 바닥의 녹청·이끼. 카르곤 잔불 자리를 그대로 쓰되 색만 차가운 끝으로. */
      emberCut: 0.86,
      emberGain: 2.6,
      /** 채널 편차 0.04 — 거의 무채. 색상각이 아니라 채도로 전경과 갈린다. */
      rgb: [1.0, 0.99, 0.96],
      glintRgb: [0.96, 1.0, 1.02],
      emberRgb: [2, 18, 13],
    },

    /**
     * 상부 = 노출된 축조면. 카르곤과 **구조는 같고 부호가 다르다**: `veinTarget` 이 밝은 용암이
     * 아니라 **어두운 이음매**다. 대신 밝은 것은 `bevelAmp` 가 만드는 판 상단 립뿐이라
     * 영역 평균이 올라가지 않는다.
     *
     * `bevelGain`/`bevelAmp` 를 카르곤보다 크게 잡은 것이 이 행성의 주 무기다 — 판마다 위가
     * 밝고 아래가 어두우면 같은 평균 밝기에서도 "깎인 돌"로 읽힌다.
     */
    upper: {
      veinPow: 2.2,
      bevelGain: 2.3,
      midCells: 6,
      fineCells: 16,
      gritCells: 32,
      crustL: 47,
      idAmp: 7,
      midAmp: 17,
      fineAmp: 14,
      gritAmp: 9,
      bevelAmp: 16,
      /** 채널 편차 0.09 — 햇빛에 바랜 석회암. 여전히 저채도라 금갈색으로 읽히지 않는다. */
      rgb: [1.06, 1.03, 0.97],
      haloScale: 2.4,
      shadeAmp: 0.22,
      crazePow: 2.6,
      crazeMidBias: 0.35,
      crazeMidGain: 0.45,
      /** 잔금 = 풍화 실금. 껍질보다 어둡다. */
      crazeTarget: [26, 25, 24],
      crazeMix: [0.62, 0.62, 0.62],
      veinLin: 0.36,
      veinCore: 0.85,
      veinMidBias: 0.7,
      veinMidGain: 0.4,
      /** 이음매(모르타르 홈). 카르곤과 정확히 반대로 **어둡다**. */
      veinTarget: [20, 21, 22],
      veinMixR: 0.88,
      veinMixG: [0.62, 0.24],
      veinMixB: [0.62, 0.24],
    },

    /** 지형 경계에 인접한 상부 픽셀의 감쇠. 무너진 단면은 풍화돼 그늘진다. */
    edge: [0.52, 0.5, 0.5],
  },

  /**
   * 변형 8종. 밴드는 **축조 밀도**의 축이다:
   *   band 0(정적) = 큰 포장 슬래브 — 이음매가 성기다. 화면의 정적 담당(3종 필수).
   *   band 1(중)   = 정연한 축조 — 판이 중간 크기이고 가로로 흐른다.
   *   band 2(파쇄) = 무너진 잔해 — 판이 잘고 잔금이 많으며 세로로 흐른다.
   *
   * 밴드 간 대비는 휘도가 아니라 **이음매 밀도**로만 준다(밴드 정규화가 평균을 고정한다).
   * 흐름 방향(cellsX≠cellsY)은 밴드 단위로 통일 — 변형마다 방향이 다르면 구역이 어지럽다.
   */
  styles: [
    // 0 — 기본(Wang 16장 + 채움 슬롯 0). 정연한 축조, 가로 흐름.
    { band: 1, lowCells: 4, lowCellsY: 3, lowGrit: 1.0, lowPlate: 1.0, hotCells: 4, hotCellsY: 3, veinW: 0.13, veinAmp: 1.0, crazeCells: 10, crazeCellsY: 8, crazeW: 0.08, crazeAmp: 0.45 },
    // 1 — **대형 슬래브**: 이음매가 거의 없는 큰 포장. 정적.
    { band: 0, lowCells: 2, lowGrit: 0.4, lowPlate: 0.4, hotCells: 2, veinW: 0.06, veinAmp: 0.5, crazeCells: 4, crazeW: 0.04, crazeAmp: 0.12 },
    // 2 — 거석 축조: 32px 급 판, 굵고 성긴 이음매.
    { band: 1, lowCells: 3, lowCellsY: 2, lowGrit: 0.85, lowPlate: 0.92, hotCells: 3, hotCellsY: 2, veinW: 0.17, veinAmp: 1.05, crazeCells: 5, crazeCellsY: 4, crazeW: 0.06, crazeAmp: 0.28 },
    // 3 — 무너진 잔해: 잘게 깨진 판.
    { band: 2, lowCells: 6, lowCellsY: 8, lowGrit: 1.25, lowPlate: 0.9, hotCells: 5, hotCellsY: 7, veinW: 0.11, veinAmp: 0.95, crazeCells: 12, crazeCellsY: 16, crazeW: 0.08, crazeAmp: 0.55 },
    // 4 — **슬래브 2**: 결이 다른 정적 구역(바닥은 매끈, 벽면은 실금만).
    { band: 0, lowCells: 3, lowGrit: 0.48, lowPlate: 0.52, hotCells: 3, veinW: 0.065, veinAmp: 0.48, crazeCells: 6, crazeW: 0.05, crazeAmp: 0.18 },
    // 5 — 파쇄대: 8px 급 자갈. 좁은 띠로 들어가 리듬의 강세를 만든다.
    { band: 2, lowCells: 8, lowCellsY: 10, lowGrit: 1.4, lowPlate: 0.75, hotCells: 8, hotCellsY: 10, veinW: 0.085, veinAmp: 0.85, crazeCells: 16, crazeCellsY: 20, crazeW: 0.065, crazeAmp: 0.5 },
    // 6 — **슬래브 3**: 정적 밴드의 세 번째 결. 밴드 안에 그림이 둘뿐이면 조용한 구역에서
    //      64px 반복이 다시 눈에 잡힌다(카르곤 프리뷰에서 확인된 함정).
    { band: 0, lowCells: 4, lowCellsY: 3, lowGrit: 0.6, lowPlate: 0.68, hotCells: 2, hotCellsY: 3, veinW: 0.07, veinAmp: 0.55, crazeCells: 3, crazeCellsY: 4, crazeW: 0.05, crazeAmp: 0.16 },
    // 7 — 정연한 축조 변주(판이 더 길다).
    { band: 1, lowCells: 5, lowCellsY: 3, lowGrit: 1.1, lowPlate: 1.05, hotCells: 5, hotCellsY: 3, veinW: 0.12, veinAmp: 1.0, crazeCells: 11, crazeCellsY: 7, crazeW: 0.075, crazeAmp: 0.42 },
  ],
};
