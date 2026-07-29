/**
 * 베르단 — 산성 습지. 하부는 **젖은 이탄 진창**, 상부는 **부식된 지각**이고 그 판을 가르는
 * 균열에서만 산성 침출이 형광 녹으로 비친다.
 *
 * ## 색상각을 황록이 아니라 청록 쪽으로 민 이유 (실측)
 * 이 행성의 안전 골짜기는 60.9°→184.2° 로 6개 중 가장 넓지만, **베르단 적 자산의 몸통색이
 * 골짜기 바로 아래 벽에 붙어 있다**. `assets/enemy_berdan_{charger,gunner,special}.png` 의
 * 몸통 대표색은 셋 다 정확히 rgb(142,138,18) = **58.1°·휘도 130** 이고, support 는
 * rgb(251,243,174) = 53.8°·휘도 240 이다. 즉 "산성 황록"의 가장 자연스러운 대역(75~95°,
 * R≈G, B 낮음)은 **적 몸통과 ΔRGB 100 미만**으로 붙는다.
 *
 * 그래서 이 행성의 산성 녹은 G 를 R 위로 크게 띄우고 B 를 죽이지 않는 **105~157°** 대역에
 * 산다. 검산: 침출 심지 rgb(110,255,120) 은 적 몸통과 ΔRGB 251, 잔금 rgb(40,118,60) 은 285,
 * 지각 바탕 rgb(27,36,29) 은 228 이다(위장 판정 문턱 70).
 *
 * ## 광원
 * 이 생성기의 `lipUp`/`lipDown`(틈 위쪽 입술만 밝힌다)은 **광원이 위**를 전제한다.
 * 베르단의 서사가 "포자로 뿌옇게 빛나는 황록 하늘에서 확산광이 내려온다"라 그 전제와
 * 일치하므로 `lipUp` 을 크게 남긴다(`themes/berdan/index.ts` 의 `light` 와 같은 물리다).
 *
 * ## 명도
 * 하부 평균 26 대, 상부 평균 40 대를 목표로 잡았다. 진창은 밝을 이유가 없고, 지각도 밝으면
 * 안 된다 — **밝기는 침출 선 위에만** 둔다(`crustL` 은 34 로 낮게 고정).
 */
export default {
  planet: 'berdan',
  name: 'berdan — 오프라인 합성 Wang 타일셋 (산성 습지)',

  tile: 32,
  cols: 4,
  fillVariants: 7,
  /** 카르곤과 다른 실루엣을 얻기 위한 오프셋. 한 번 정했으면 고정한다(바꾸면 자산 전부 달라진다). */
  seedOffset: 0x1b00,
  normalise: 'multiplicative',

  /**
   * 실루엣 3단은 메커니즘이지 테마가 아니다(I2 가 대칭·공유를 강제한다). 진폭만 카르곤의
   * 0.84 에서 0.79 로 낮췄다 — 습지 경계는 화산 지각보다 손가락이 짧고 뭉툭하다.
   */
  silhouette: {
    amp: 0.79,
    octaves: [
      { seed: 0x51ed270b, cells: 4, weight: 0.46 },
      { seed: 0x1b873593, cells: 8, weight: 0.32 },
      { seed: 0x2545f491, cells: 16, weight: 0.22 },
    ],
  },

  palette: {
    /**
     * 하부 = 젖은 이탄 진창. 판 사이의 "틈"은 카르곤의 용암 균열이 아니라 **고인 물길**이라
     * 폭을 조금 넓게(0.15) 잡고, 그 바닥에 산성 침출의 잔광(`emberRgb`)을 아주 옅게 깐다.
     * `glintRgb` 는 반짝임이 아니라 **젖은 표면의 수막 반사**라 청색 쪽으로 기울였다.
     */
    lower: {
      fissureW: 0.15,
      lipUp: 2.2,
      lipDown: 0.16,
      midACells: 4,
      midBCells: 8,
      fineCells: 16,
      gritCells: 32,
      densCells: 3, // ⚠️ 진폭 변조 전용(zero-mean 항에만 곱한다) — 휘도에 더하면 I4 위반
      baseL: 30,
      idAmp: 7,
      midAAmp: 8,
      midBAmp: 20,
      fineAmp: 14,
      gritAmp: 8,
      fissureAmp: 22,
      lipAmp: 24,
      // 이탄은 현무암보다 결이 고르지 않다 — 거칠기 바닥을 올리고 이득은 낮춰 얼룩덜룩함을 줄인다.
      roughBias: 0.22,
      roughGain: 1.55,
      glintCut: 0.86,
      glintGain: 104,
      glintDensBias: 0.3,
      glintDensGain: 1.5,
      glintDensCap: 1.6,
      emberCut: 0.85,
      emberGain: 3.0,
      rgb: [0.8, 1.02, 0.88], // 진창은 녹회색(G 우세, R 최저)
      glintRgb: [0.85, 1.0, 1.12], // 수막 반사는 차갑다
      emberRgb: [6, 30, 14], // 물길 바닥의 산성 침출(140°)
    },

    /**
     * 상부 = 부식된 지각. **밝은 판이 아니다** — 지배색은 어두운 녹회색이고 형광 녹은
     * 균열선 위에만 있다. 색상각은 위 헤더의 실측대로 105~140° 대역.
     *
     * `veinMix*` 의 채널 배분이 카르곤과 반대다. 메커니즘은 R 에 상수 배분(`veinMixR`)을,
     * G·B 에 심지 의존 배분을 주는데, 카르곤은 주황이라 R 이 주역이었고 여기는 **G 가
     * 주역**이다. 그래서 `veinMixR` 을 낮추고 `veinMixG` 의 상수항을 크게 잡았다.
     */
    upper: {
      veinPow: 3.0,
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
      rgb: [0.78, 1.06, 0.86], // 부식 지각의 어두운 녹회색(137°)
      haloScale: 3.0,
      shadeAmp: 0.34,
      crazePow: 2.4,
      crazeMidBias: 0.35,
      crazeMidGain: 0.45,
      crazeTarget: [40, 118, 60], // 잔금: 굵은 침출보다 훨씬 어두운 녹(135°)
      crazeMix: [0.8, 0.5, 0.35],
      veinLin: 0.34,
      veinCore: 0.9,
      veinMidBias: 0.7,
      veinMidGain: 0.42,
      veinTarget: [110, 255, 120], // 침출 심지: 형광 녹(124°)
      veinMixR: 0.55,
      veinMixG: [0.72, 0.26],
      veinMixB: [0.1, 0.45],
    },

    /**
     * 경계 감쇠. 습지 가장자리는 물에 잠겨 어두워지되 **청록 쪽으로** 죽는다(B 를 R 보다 덜 깎는다).
     */
    edge: [0.44, 0.5, 0.48],
  },

  /**
   * 변형 8종. 밴드 배분은 카르곤과 같은 규칙(정적 3 / 중 3 / 파쇄 2)을 따르되, 흐름 방향을
   * 뒤집었다 — 카르곤의 중 밴드는 가로 흐름이고 여기는 **세로 흐름**(cellsY < cellsX)이다.
   * 물은 경사를 따라 내려가지 지각처럼 옆으로 퍼지지 않는다.
   *
   * 밴드 간 대비는 휘도가 아니라 **균열 밀도**로만 준다(밴드 정규화가 평균을 고정한다).
   */
  styles: [
    // 0 — 기본(16장 Wang 전부 + 채움 슬롯 0). 중(中) 스케일, 세로 흐름.
    { band: 1, lowCells: 6, lowCellsY: 4, lowGrit: 1.0, lowPlate: 1.0, hotCells: 5, hotCellsY: 3, veinW: 0.14, veinAmp: 1.0, crazeCells: 13, crazeCellsY: 9, crazeW: 0.1, crazeAmp: 0.55 },
    // 1 — **평판**: 침출이 거의 없는 넓은 진창. 화면의 정적 담당.
    { band: 0, lowCells: 2, lowGrit: 0.44, lowPlate: 0.36, hotCells: 2, veinW: 0.055, veinAmp: 0.5, crazeCells: 4, crazeW: 0.045, crazeAmp: 0.14 },
    // 2 — 대(大) 스케일: 굵고 성긴 침출 줄기.
    { band: 1, lowCells: 5, lowCellsY: 3, lowGrit: 0.82, lowPlate: 1.15, hotCells: 4, hotCellsY: 2, veinW: 0.18, veinAmp: 1.05, crazeCells: 8, crazeCellsY: 5, crazeW: 0.07, crazeAmp: 0.3 },
    // 3 — 소(小) 스케일: 잘게 갈라진 부식대.
    { band: 2, lowCells: 4, lowCellsY: 6, lowGrit: 1.3, lowPlate: 0.9, hotCells: 4, hotCellsY: 6, veinW: 0.11, veinAmp: 0.95, crazeCells: 10, crazeCellsY: 14, crazeW: 0.085, crazeAmp: 0.6 },
    // 4 — **평판 2**: 결이 다른 정적 구역(진창은 매끈, 지각은 실금만).
    { band: 0, lowCells: 3, lowGrit: 0.52, lowPlate: 0.5, hotCells: 3, veinW: 0.06, veinAmp: 0.48, crazeCells: 6, crazeW: 0.05, crazeAmp: 0.2 },
    // 5 — 극소 스케일: 8px 급 부식 파쇄대. 좁은 띠로 들어가 리듬의 강세를 만든다.
    { band: 2, lowCells: 6, lowCellsY: 8, lowGrit: 1.42, lowPlate: 0.76, hotCells: 6, hotCellsY: 9, veinW: 0.09, veinAmp: 0.85, crazeCells: 13, crazeCellsY: 18, crazeW: 0.07, crazeAmp: 0.5 },
    // 6 — **평판 3**: 정적 밴드의 세 번째 결. 밴드 안에 그림이 둘뿐이면 조용한 구역에서
    //      64px 반복이 다시 눈에 잡힌다(생성기가 3종 이상을 강제한다).
    { band: 0, lowCells: 3, lowCellsY: 4, lowGrit: 0.66, lowPlate: 0.7, hotCells: 3, hotCellsY: 2, veinW: 0.075, veinAmp: 0.58, crazeCells: 4, crazeCellsY: 3, crazeW: 0.055, crazeAmp: 0.18 },
    // 7 — 중 스케일 변주.
    { band: 1, lowCells: 6, lowCellsY: 4, lowGrit: 1.15, lowPlate: 1.05, hotCells: 6, hotCellsY: 4, veinW: 0.13, veinAmp: 1.0, crazeCells: 15, crazeCellsY: 11, crazeW: 0.09, crazeAmp: 0.5 },
  ],
};
