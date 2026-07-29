/**
 * 침공 L3 — **코어방**. 적 코어가 뛰는 심장부. 3레이어 중 가장 인공적이고 가장 위협적이다.
 *
 * 하부 = 검게 그을린 차폐판, 상부 = 코어의 에너지가 배관을 타고 흐르는 발광 격벽.
 * 밝은 요소는 L1·L2 보다 **좁고 강하다**(줄기 대역은 좁히고 심지 흰끼는 유지) — 화면이
 * 밝아지는 게 아니라 선이 뜨거워 보이게 하는 유일한 방법이고, 면이 밝아지면 그대로 위장이다.
 *
 * 색상각: 팔레트가 **280.2°~305.0° 골짜기** 안(퍼플 적탄 270.2° 와 마젠타 315.0° 사이).
 * 이 골짜기는 폭이 24.8° 뿐이라 여유가 없다 — 색을 손볼 때 반드시 각도를 다시 재라.
 */
export default {
  planet: 'invasion_l3',
  name: 'invasion L3 — 코어방',

  tile: 32,
  cols: 4,
  fillVariants: 7,
  seedOffset: 0x4300,
  normalise: 'multiplicative',

  silhouette: {
    amp: 0.84,
    octaves: [
      { seed: 0x51ed270b, cells: 4, weight: 0.46 },
      { seed: 0x1b873593, cells: 8, weight: 0.32 },
      { seed: 0x2545f491, cells: 16, weight: 0.22 },
    ],
  },

  palette: {
    /** 하부 = 그을린 차폐판. 카르곤 현무암보다 더 어둡다 — 코어 발광의 명도비를 벌어야 한다. */
    lower: {
      fissureW: 0.11,
      lipUp: 2.2,
      lipDown: 0.13,
      midACells: 4,
      midBCells: 8,
      fineCells: 16,
      gritCells: 32,
      densCells: 3,
      baseL: 27,
      idAmp: 7,
      midAAmp: 7,
      midBAmp: 21,
      fineAmp: 14,
      gritAmp: 8,
      fissureAmp: 23,
      lipAmp: 27,
      roughBias: 0.18,
      roughGain: 1.75,
      glintCut: 0.89,
      glintGain: 104,
      glintDensBias: 0.3,
      glintDensGain: 1.5,
      glintDensCap: 1.6,
      emberCut: 0.83,
      emberGain: 3.6,
      rgb: [0.95, 0.8, 1.15],
      glintRgb: [1.02, 0.9, 1.14],
      /** 차폐판 틈에서 새는 코어 잔광(보라). */
      emberRgb: [22, 6, 30],
    },

    /** 상부 = 발광 격벽. 기준 명도는 낮게, 밝기는 배관선 위에만. */
    upper: {
      /** 심지 집중도가 셋 중 가장 높다 — 코어의 선은 가늘고 뜨겁다. */
      veinPow: 3.4,
      bevelGain: 1.6,
      midCells: 6,
      fineCells: 16,
      gritCells: 32,
      crustL: 34,
      idAmp: 7,
      midAmp: 15,
      fineAmp: 10,
      gritAmp: 5,
      bevelAmp: 8,
      rgb: [1.05, 0.78, 1.25],
      /** 후광을 셋 중 가장 넓게 — 선 양옆을 눌러 평균을 안 올리고 대비만 키운다. */
      haloScale: 3.4,
      shadeAmp: 0.38,
      crazePow: 2.4,
      crazeMidBias: 0.35,
      crazeMidGain: 0.45,
      crazeTarget: [90, 40, 120],
      crazeMix: [0.8, 0.5, 0.35],
      veinLin: 0.34,
      veinCore: 0.95,
      veinMidBias: 0.7,
      veinMidGain: 0.42,
      /** 코어 배관(292.0°). */
      veinTarget: [233, 90, 255],
      veinMixR: 0.98,
      veinMixG: [0.3, 0.62],
      veinMixB: [0.12, 0.55],
    },

    edge: [0.48, 0.42, 0.5],
  },

  styles: [
    { band: 1, lowCells: 4, lowCellsY: 6, lowGrit: 1.0, lowPlate: 1.0, hotCells: 3, hotCellsY: 5, veinW: 0.12, veinAmp: 1.0, crazeCells: 9, crazeCellsY: 13, crazeW: 0.09, crazeAmp: 0.55 },
    { band: 0, lowCells: 2, lowGrit: 0.42, lowPlate: 0.35, hotCells: 2, veinW: 0.048, veinAmp: 0.55, crazeCells: 4, crazeW: 0.04, crazeAmp: 0.14 },
    { band: 1, lowCells: 3, lowCellsY: 5, lowGrit: 0.8, lowPlate: 1.15, hotCells: 2, hotCellsY: 4, veinW: 0.16, veinAmp: 1.05, crazeCells: 5, crazeCellsY: 8, crazeW: 0.065, crazeAmp: 0.3 },
    { band: 2, lowCells: 6, lowCellsY: 4, lowGrit: 1.3, lowPlate: 0.9, hotCells: 6, hotCellsY: 4, veinW: 0.095, veinAmp: 0.95, crazeCells: 14, crazeCellsY: 10, crazeW: 0.08, crazeAmp: 0.6 },
    { band: 0, lowCells: 3, lowGrit: 0.5, lowPlate: 0.5, hotCells: 3, veinW: 0.052, veinAmp: 0.5, crazeCells: 6, crazeW: 0.045, crazeAmp: 0.2 },
    { band: 2, lowCells: 8, lowCellsY: 6, lowGrit: 1.45, lowPlate: 0.75, hotCells: 9, hotCellsY: 6, veinW: 0.075, veinAmp: 0.85, crazeCells: 18, crazeCellsY: 13, crazeW: 0.065, crazeAmp: 0.5 },
    { band: 0, lowCells: 4, lowCellsY: 3, lowGrit: 0.65, lowPlate: 0.7, hotCells: 2, hotCellsY: 3, veinW: 0.068, veinAmp: 0.6, crazeCells: 3, crazeCellsY: 4, crazeW: 0.05, crazeAmp: 0.18 },
    { band: 1, lowCells: 4, lowCellsY: 6, lowGrit: 1.15, lowPlate: 1.05, hotCells: 4, hotCellsY: 6, veinW: 0.11, veinAmp: 1.0, crazeCells: 11, crazeCellsY: 15, crazeW: 0.085, crazeAmp: 0.5 },
  ],
};
