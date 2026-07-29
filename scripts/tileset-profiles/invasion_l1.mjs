/**
 * 침공 L1 — **대기권**. 적 기지 상공, 성층권 구름 갑판 위를 스치는 고도.
 *
 * 하부 = 그늘진 짙은 야간 구름(거의 검은 남색), 상부 = 위에서 빛을 받아 얇게 빛나는 구름 갑판.
 * 카르곤(용암)과 정반대로 **광원이 위**에 있고, 그래서 여기서 밝은 것은 "달궈진 틈"이 아니라
 * "빛이 닿은 면의 가장자리"다. 다만 규율은 같다 — 밝기는 **선 위에만** 두고 면은 평균으로만
 * 밝다(README 함정 2). 구름의 부드러움은 휘도 덩어리가 아니라 실루엣 진폭이 진다.
 *
 * 색상각: 팔레트가 전부 **204.2°~260.2° 골짜기**(아군 시안 194.2° 와 퍼플 270.2° 사이) 안이다.
 * 자연스러운 하늘 시안(≈195°)은 아군 신호색과 사실상 같은 각도라 쓰지 않았다 — 침공은
 * 아군 표식이 화면에 많은 모드라 그 혼동이 특히 비싸다.
 */
export default {
  planet: 'invasion_l1',
  name: 'invasion L1 — 대기권 구름 갑판',

  tile: 32,
  cols: 4,
  fillVariants: 7,
  /** L1·L2·L3 가 서로 다른 구조를 갖도록 레이어마다 다른 오프셋. 한 번 정했으면 고정. */
  seedOffset: 0x4100,
  normalise: 'multiplicative',

  /** 메커니즘 값(I1·I2). 스케일 3단은 행성 무관 구조라 그대로 쓴다. */
  silhouette: {
    amp: 0.84,
    octaves: [
      { seed: 0x51ed270b, cells: 4, weight: 0.46 },
      { seed: 0x1b873593, cells: 8, weight: 0.32 },
      { seed: 0x2545f491, cells: 16, weight: 0.22 },
    ],
  },

  palette: {
    /** 하부 = 빛이 닿지 않는 구름 골. 평균은 낮게, 결은 국소 대비로. */
    lower: {
      fissureW: 0.13,
      /** 광원이 위라 골의 **위쪽** 입술이 밝다 — 카르곤과 같은 부호지만 근거가 반대다. */
      lipUp: 2.3,
      lipDown: 0.12,
      midACells: 4,
      midBCells: 8,
      fineCells: 16,
      gritCells: 32,
      densCells: 3,
      baseL: 29,
      idAmp: 7,
      midAAmp: 8,
      midBAmp: 20,
      fineAmp: 13,
      gritAmp: 6,
      fissureAmp: 21,
      lipAmp: 26,
      roughBias: 0.18,
      roughGain: 1.7,
      /** 구름은 현무암 같은 유리질 반짝임이 없다 — 상위 8% 만, 낮은 이득으로. */
      glintCut: 0.92,
      glintGain: 74,
      glintDensBias: 0.3,
      glintDensGain: 1.5,
      glintDensCap: 1.6,
      emberCut: 0.86,
      emberGain: 2.6,
      rgb: [0.72, 0.88, 1.35],
      glintRgb: [0.86, 0.96, 1.16],
      /** 골 바닥에 스미는 상층광(주황 잔불의 자리 — 여기서는 차가운 푸른빛). */
      emberRgb: [6, 14, 30],
    },

    /**
     * 상부 = 빛을 받는 구름 갑판. 기준 명도 40 은 카르곤 껍질(36)보다 조금 높지만 여전히
     * 중간 밝기 아래다 — 침공 적탄·아군 표식이 이 면 위를 지나므로 면이 밝아지면 그대로 위장이다.
     */
    upper: {
      veinPow: 3.0,
      bevelGain: 1.6,
      midCells: 6,
      fineCells: 16,
      gritCells: 32,
      crustL: 40,
      idAmp: 7,
      midAmp: 15,
      fineAmp: 10,
      gritAmp: 5,
      bevelAmp: 9,
      rgb: [0.78, 0.95, 1.3],
      haloScale: 3.0,
      shadeAmp: 0.34,
      crazePow: 2.4,
      crazeMidBias: 0.35,
      crazeMidGain: 0.45,
      /** 잔금 = 구름 사이 그늘. 줄기보다 훨씬 어둡다. */
      crazeTarget: [40, 70, 110],
      crazeMix: [0.8, 0.5, 0.35],
      veinLin: 0.34,
      veinCore: 0.9,
      veinMidBias: 0.7,
      veinMidGain: 0.42,
      /** 빛이 닿은 가장자리(210.8°). 심지에서만 흰끼가 돈다. */
      veinTarget: [140, 196, 255],
      veinMixR: 0.98,
      veinMixG: [0.3, 0.62],
      veinMixB: [0.12, 0.55],
    },

    /** 경계에 인접한 상부 픽셀 감쇠 — 밝은 1px 림이 와이어프레임으로 읽히는 것을 막는다. */
    edge: [0.5, 0.46, 0.46],
  },

  /**
   * 변형 8종·밴드 배분(정적 3 / 중 3 / 파쇄 2). 밴드 간 대비는 휘도가 아니라 **밀도**로만 준다
   * (밴드 정규화가 밴드 안의 평균 밝기를 고정한다). 흐름 방향은 밴드 단위로 통일한다.
   */
  styles: [
    { band: 1, lowCells: 4, lowCellsY: 6, lowGrit: 1.0, lowPlate: 1.0, hotCells: 3, hotCellsY: 5, veinW: 0.15, veinAmp: 1.0, crazeCells: 9, crazeCellsY: 13, crazeW: 0.1, crazeAmp: 0.55 },
    { band: 0, lowCells: 2, lowGrit: 0.42, lowPlate: 0.35, hotCells: 2, veinW: 0.055, veinAmp: 0.55, crazeCells: 4, crazeW: 0.045, crazeAmp: 0.14 },
    { band: 1, lowCells: 3, lowCellsY: 5, lowGrit: 0.8, lowPlate: 1.15, hotCells: 2, hotCellsY: 4, veinW: 0.19, veinAmp: 1.05, crazeCells: 5, crazeCellsY: 8, crazeW: 0.07, crazeAmp: 0.3 },
    { band: 2, lowCells: 6, lowCellsY: 4, lowGrit: 1.3, lowPlate: 0.9, hotCells: 6, hotCellsY: 4, veinW: 0.115, veinAmp: 0.95, crazeCells: 14, crazeCellsY: 10, crazeW: 0.085, crazeAmp: 0.6 },
    { band: 0, lowCells: 3, lowGrit: 0.5, lowPlate: 0.5, hotCells: 3, veinW: 0.06, veinAmp: 0.5, crazeCells: 6, crazeW: 0.05, crazeAmp: 0.2 },
    { band: 2, lowCells: 8, lowCellsY: 6, lowGrit: 1.45, lowPlate: 0.75, hotCells: 9, hotCellsY: 6, veinW: 0.09, veinAmp: 0.85, crazeCells: 18, crazeCellsY: 13, crazeW: 0.07, crazeAmp: 0.5 },
    { band: 0, lowCells: 4, lowCellsY: 3, lowGrit: 0.65, lowPlate: 0.7, hotCells: 2, hotCellsY: 3, veinW: 0.075, veinAmp: 0.6, crazeCells: 3, crazeCellsY: 4, crazeW: 0.055, crazeAmp: 0.18 },
    { band: 1, lowCells: 4, lowCellsY: 6, lowGrit: 1.15, lowPlate: 1.05, hotCells: 4, hotCellsY: 6, veinW: 0.13, veinAmp: 1.0, crazeCells: 11, crazeCellsY: 15, crazeW: 0.09, crazeAmp: 0.5 },
  ],
};
