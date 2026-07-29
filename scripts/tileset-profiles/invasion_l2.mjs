/**
 * 침공 L2 — **회랑**. 적 기지 내부, 방어 설비가 늘어선 인공 통로.
 *
 * L1 이 자연물(구름)이라면 여기부터는 사람이 만든 것이다. 하부 = 그늘진 금속 갑판,
 * 상부 = 조명이 닿는 통로 바닥 + 그 위를 달리는 **신호선**. 인공물의 정체성은 색이 아니라
 * **선의 성격**이 진다 — 줄기(`veinW`)를 L1 보다 좁게, 잔금(`crazeW`)을 촘촘하게 두어
 * 유기적 균열이 아니라 배선·이음매로 읽히게 했다.
 *
 * ⚠️ 인공물이라고 직선 격자를 넣으면 안 된다. 타일 안의 규칙적 미세 격자는 64px 로 반복되면서
 * 눈이 즉시 잡는 것이고(카르곤이 PixelLab 14 세대로 확인한 실패), 여기서 쓰는 Worley 판은
 * 방향 이방성(cellsX≠cellsY)만으로 "흐름 있는 인공 구조"를 낸다.
 *
 * 색상각: 팔레트가 **60.9°~184.2° 골짜기** 안(아군 시안 194.2° 에서 10° 이상 떨어진 청록 쪽 끝).
 */
export default {
  planet: 'invasion_l2',
  name: 'invasion L2 — 기지 회랑',

  tile: 32,
  cols: 4,
  fillVariants: 7,
  seedOffset: 0x4200,
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
    /** 하부 = 조명이 닿지 않는 금속 갑판. 판 사이 이음매가 깊고 그 위쪽 모서리만 밝다. */
    lower: {
      /** 이음매는 균열보다 좁고 또렷하다 — 인공물의 선은 가늘다. */
      fissureW: 0.1,
      lipUp: 2.4,
      lipDown: 0.14,
      midACells: 4,
      midBCells: 8,
      fineCells: 16,
      gritCells: 32,
      densCells: 3,
      baseL: 30,
      idAmp: 8,
      midAAmp: 6,
      midBAmp: 22,
      fineAmp: 11,
      gritAmp: 7,
      fissureAmp: 25,
      lipAmp: 29,
      roughBias: 0.16,
      roughGain: 1.6,
      /** 금속이라 반짝임이 강하다 — 상위 12%, 높은 이득. */
      glintCut: 0.88,
      glintGain: 126,
      glintDensBias: 0.3,
      glintDensGain: 1.5,
      glintDensCap: 1.6,
      emberCut: 0.85,
      emberGain: 3.0,
      rgb: [0.85, 1.0, 0.98],
      glintRgb: [0.92, 1.06, 1.02],
      /** 이음매 바닥에서 새는 계기 불빛(청록). */
      emberRgb: [4, 26, 22],
    },

    /** 상부 = 조명이 닿는 통로면. 면은 어둡고 밝은 것은 신호선뿐이다. */
    upper: {
      veinPow: 3.2,
      bevelGain: 1.7,
      midCells: 6,
      fineCells: 16,
      gritCells: 32,
      crustL: 38,
      idAmp: 8,
      midAmp: 13,
      fineAmp: 9,
      gritAmp: 5,
      bevelAmp: 9,
      rgb: [0.8, 1.05, 1.0],
      haloScale: 3.2,
      shadeAmp: 0.36,
      crazePow: 2.4,
      crazeMidBias: 0.35,
      crazeMidGain: 0.45,
      /** 잔금 = 패널 이음매 그늘. */
      crazeTarget: [34, 82, 72],
      crazeMix: [0.8, 0.5, 0.35],
      veinLin: 0.34,
      veinCore: 0.9,
      veinMidBias: 0.7,
      veinMidGain: 0.42,
      /** 신호선(161.8°) — 심지에서만 흰끼. */
      veinTarget: [120, 255, 214],
      veinMixR: 0.98,
      veinMixG: [0.3, 0.62],
      veinMixB: [0.12, 0.55],
    },

    edge: [0.5, 0.44, 0.46],
  },

  styles: [
    { band: 1, lowCells: 4, lowCellsY: 7, lowGrit: 1.0, lowPlate: 1.0, hotCells: 3, hotCellsY: 6, veinW: 0.13, veinAmp: 1.0, crazeCells: 10, crazeCellsY: 14, crazeW: 0.085, crazeAmp: 0.55 },
    { band: 0, lowCells: 2, lowGrit: 0.42, lowPlate: 0.35, hotCells: 2, veinW: 0.05, veinAmp: 0.55, crazeCells: 4, crazeW: 0.04, crazeAmp: 0.14 },
    { band: 1, lowCells: 3, lowCellsY: 5, lowGrit: 0.8, lowPlate: 1.15, hotCells: 2, hotCellsY: 4, veinW: 0.17, veinAmp: 1.05, crazeCells: 5, crazeCellsY: 9, crazeW: 0.06, crazeAmp: 0.3 },
    { band: 2, lowCells: 6, lowCellsY: 4, lowGrit: 1.3, lowPlate: 0.9, hotCells: 6, hotCellsY: 4, veinW: 0.1, veinAmp: 0.95, crazeCells: 15, crazeCellsY: 10, crazeW: 0.075, crazeAmp: 0.6 },
    { band: 0, lowCells: 3, lowGrit: 0.5, lowPlate: 0.5, hotCells: 3, veinW: 0.055, veinAmp: 0.5, crazeCells: 6, crazeW: 0.045, crazeAmp: 0.2 },
    { band: 2, lowCells: 8, lowCellsY: 6, lowGrit: 1.45, lowPlate: 0.75, hotCells: 9, hotCellsY: 6, veinW: 0.08, veinAmp: 0.85, crazeCells: 19, crazeCellsY: 13, crazeW: 0.065, crazeAmp: 0.5 },
    { band: 0, lowCells: 4, lowCellsY: 3, lowGrit: 0.65, lowPlate: 0.7, hotCells: 2, hotCellsY: 3, veinW: 0.07, veinAmp: 0.6, crazeCells: 3, crazeCellsY: 4, crazeW: 0.05, crazeAmp: 0.18 },
    { band: 1, lowCells: 4, lowCellsY: 6, lowGrit: 1.15, lowPlate: 1.05, hotCells: 4, hotCellsY: 6, veinW: 0.12, veinAmp: 1.0, crazeCells: 12, crazeCellsY: 16, crazeW: 0.08, crazeAmp: 0.5 },
  ],
};
