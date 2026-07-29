/**
 * 니플헤임 — 빙원. `scripts/tileset-gen.mjs` 의 행성 프로파일.
 *
 * ## 이 행성이 카르곤의 정확한 반대인 지점
 * 카르곤 상부는 "어두운 껍질 + 밝은 균열선"이다. 눈은 **밝은 면 + 어두운 크레바스**다.
 * 그래도 규율은 그대로 유지된다 — 큰 스케일은 **선**(크레바스)이 지고, 면은 **평균으로만**
 * 밝다. 그래서 뒤집기는 `veinTarget` 을 밝은 색이 아니라 **어두운 청색**으로 두고
 * `crustL` 을 올리는 방향으로 한다. 밝은 면은 I4(저주파 휘도) 지표를 올리지 않는다.
 *
 * ## 밝기 상한을 정한 것은 취향이 아니라 위장 지표다
 * 니플헤임 적 4종의 몸통 대표색은 `#88c0c8`(L 181) 과 `#a8d0e0`(L 201) — **창백한 얼음
 * 시안**이다. 눈을 순백(L≈200)으로 구우면 적이 배경과 ΔRGB 70 안에 들어와 그대로 사라진다.
 * 구 타일셋(07-28 자)이 정확히 그 상태였다: upperL 200.9, 위장 3.29%(warn), 격자 excess x 14.98.
 * 그래서 이 행성의 서사는 순백 설원이 아니라 **저각 태양의 박명 빙원**이다 — 눈은 암반에
 * 비해 밝지만 장면 전체가 푸른 그늘에 있어, 창백한 적이 화면에서 여전히 가장 밝다.
 * 상부 기준 명도 114 의 근거가 이것이고, 올릴 때마다 위장 예산을 쓰는 것이다.
 * 결과(프리뷰 시드 12345): 화면 mean 46.9 · p95 99.9 · 위장 **0.00%**.
 *
 * ## 색상각
 * 얼음의 자연스러운 시안(≈195°)은 **아군 신호색 194.2° 와 사실상 같은 각도**라 쓸 수 없다
 * (배경이 아군 표식으로 읽힌다). 안전 골짜기 204.2°~260.2° 안의 **깊은 청보라**로 옮겼다 —
 * 면 ≈222°, 크레바스 ≈226°. 튜닝이 아니라 팔레트 설계 결정이다.
 */
export default {
  planet: 'niflheim',
  name: 'niflheim — 오프라인 합성 Wang 타일셋 (빙원)',

  tile: 32,
  cols: 4,
  fillVariants: 7,
  /** 카르곤과 구조까지 다르게 하려고 띄웠다. 한 번 정했으므로 고정한다. */
  seedOffset: 0x3100,
  normalise: 'multiplicative',

  /**
   * 실루엣(I1·I2). 스케일 3단 구조는 메커니즘이라 그대로 두고 **시드와 진폭만** 이 행성 것이다.
   * 진폭 0.58 은 카르곤(0.84)보다 낮다. 서사로는 "빙원 가장자리는 용암 지각처럼 톱니가
   * 아니라 바람에 다듬어진 완만한 설벽"이고, **측정으로는 격자 예산**이다 —
   * 실루엣 노이즈는 전 타일이 공유하므로(I2) 진폭이 클수록 "타일 안 이 자리는 상부일
   * 확률이 높다"는 위치 편향이 커지고, 그 편향 × 상·하부 명도차가 곧 64px 위상 진폭이다.
   * 실측(프리뷰 시드 12345): amp 0.78 → excess x 3.02 · 0.58 → 2.40 · 0.45 → 2.37(포화).
   * 0.58 아래로는 수익이 거의 없고 경계가 코너 이중선형에 가까워져 오히려 기하학적이 된다.
   */
  silhouette: {
    amp: 0.58,
    octaves: [
      { seed: 0x6f4e37a1, cells: 4, weight: 0.5 },
      { seed: 0x2b7c19d3, cells: 8, weight: 0.31 },
      { seed: 0x51a3d76f, cells: 16, weight: 0.19 },
    ],
  },

  palette: {
    /**
     * 하부 = **푸른 그늘 속 노출 암반**. 눈이 벗겨진 자리라 어둡고, 하늘 산란광만 받아
     * 청보라로 기운다. 평균은 낮게(31) 두고 국소 대비는 틈·립·서리 반짝임으로 만든다.
     */
    lower: {
      fissureW: 0.14, // 암반 균열 대역
      lipUp: 2.3, // 태양이 위에 있으므로 틈의 위쪽 입술이 밝다
      lipDown: 0.12,
      midACells: 4,
      midBCells: 8,
      fineCells: 16,
      gritCells: 32,
      densCells: 3, // ⚠️ 진폭 변조 전용(zero-mean 항에만 곱한다) — 휘도에 더하면 I4 위반
      baseL: 32,
      idAmp: 6,
      midAAmp: 7,
      midBAmp: 19,
      fineAmp: 14,
      gritAmp: 8,
      fissureAmp: 21,
      lipAmp: 26,
      roughBias: 0.2,
      roughGain: 1.7,
      /** 서리 결정 반짝임 — 상위 12% 그릿만. 눈가루가 앉은 암반이라 카르곤 흑요석보다 잦다. */
      glintCut: 0.88,
      glintGain: 126,
      glintDensBias: 0.32,
      glintDensGain: 1.5,
      glintDensCap: 1.6,
      /** 틈 바닥에 드러난 **빙층**. 하늘빛만 받으므로 옅고 순청에 가깝다. */
      emberCut: 0.86,
      emberGain: 3.0,
      rgb: [0.86, 0.94, 1.3], // 청보라 그늘 암반
      glintRgb: [0.92, 1.0, 1.18],
      emberRgb: [3, 11, 27],
    },

    /**
     * 상부 = **빙원**. 카르곤과 부호가 반대다 — 지배색이 밝은 설면이고 좁은 크레바스에서만
     * 어두운 심청이 드러난다. `crustL` 118 은 위 헤더의 위장 예산에서 나온 값이다.
     *
     * `shadeAmp` 가 **음수**인 것은 오타가 아니다. 카르곤에서 이 항은 균열 바깥을 눌러
     * 밝은 선을 읽히게 하는 "어두운 후광"이었다. 눈에서는 선이 어두우므로 같은 위치가
     * 반대로 작동해야 한다 — 크레바스 양옆의 바람에 다져진 **밝은 설연 둔덕**이다.
     * 부호만 뒤집으면 같은 기하가 그대로 성립한다.
     */
    upper: {
      veinPow: 2.6, // 심지 집중도(크레바스 바닥)
      bevelGain: 1.5,
      midCells: 6,
      fineCells: 16,
      gritCells: 32,
      crustL: 114,
      idAmp: 6,
      midAmp: 13,
      fineAmp: 9,
      gritAmp: 5,
      bevelAmp: 9,
      rgb: [0.86, 0.96, 1.2], // 설면 ≈222° — 안전 골짜기 안쪽
      haloScale: 2.6,
      shadeAmp: -0.16, // 음수 = 크레바스 옆 밝은 둔덕(위 주석 참조)
      crazePow: 2.2,
      crazeMidBias: 0.38,
      crazeMidGain: 0.42,
      /** 잔금 = 표면 결(sastrugi). 크레바스보다 훨씬 얕아 설면에서 살짝만 내려간다. */
      crazeTarget: [70, 86, 122],
      crazeMix: [0.7, 0.5, 0.34],
      veinLin: 0.3,
      veinCore: 0.92,
      veinMidBias: 0.72,
      veinMidGain: 0.4,
      /** 크레바스 심부 — 깊을수록 R 이 먼저 빠져 심청으로 간다(두꺼운 얼음의 실제 거동). */
      veinTarget: [26, 40, 84],
      veinMixR: 0.95,
      veinMixG: [0.5, 0.42],
      veinMixB: [0.4, 0.35],
    },

    /**
     * 지형 경계에 인접한 상부 픽셀의 감쇠. 눈은 경계에서 "식는" 게 아니라 **그림자가 진다** —
     * 그래서 R 을 가장 많이 깎아 그늘이 푸른 쪽으로 남게 한다(균일 감쇠면 회색으로 죽는다).
     */
    edge: [0.62, 0.7, 0.86],
  },

  /**
   * 변형 8종과 밴드 배분(정적 3 / 중 3 / 파쇄 2). 밴드 서사:
   *  band 0 — **설원**: 크레바스가 거의 없는 넓은 눈판. 화면의 정적.
   *  band 1 — **빙하 본류**: 흐름 방향으로 늘어난 중간 스케일 크레바스망.
   *  band 2 — **빙탑지대(serac)**: 잘게 갈라진 파쇄대. 리듬의 강세.
   *
   * 흐름 방향은 밴드 단위로 통일했다. 카르곤은 중 밴드가 가로·세밀이 세로였는데, 빙하는
   * 흐르는 방향이 하나라 **중·세밀 모두 세로 흐름**(cellsY < cellsX)으로 묶었다.
   * 밴드 간 대비는 휘도가 아니라 크레바스 **밀도**로만 준다(밴드 정규화가 평균을 고정한다).
   */
  styles: [
    // 0 — 기본(16장 Wang 전부 + 채움 슬롯 0). 빙하 본류의 중(中) 스케일.
    { band: 1, lowCells: 4, lowCellsY: 3, lowGrit: 1.0, lowPlate: 1.0, hotCells: 5, hotCellsY: 3, veinW: 0.14, veinAmp: 1.0, crazeCells: 13, crazeCellsY: 9, crazeW: 0.1, crazeAmp: 0.5 },
    // 1 — **설원**: 크레바스 거의 없는 큰 눈판.
    { band: 0, lowCells: 2, lowGrit: 0.44, lowPlate: 0.36, hotCells: 2, veinW: 0.05, veinAmp: 0.5, crazeCells: 4, crazeW: 0.045, crazeAmp: 0.15 },
    // 2 — 대(大) 스케일: 넓은 빙판을 가르는 굵고 성긴 크레바스.
    { band: 1, lowCells: 3, lowCellsY: 2, lowGrit: 0.82, lowPlate: 1.15, hotCells: 4, hotCellsY: 2, veinW: 0.18, veinAmp: 1.05, crazeCells: 8, crazeCellsY: 5, crazeW: 0.07, crazeAmp: 0.28 },
    // 3 — 소(小) 스케일: 잘게 갈라진 대상(帶狀) 파쇄.
    { band: 2, lowCells: 6, lowCellsY: 4, lowGrit: 1.3, lowPlate: 0.9, hotCells: 6, hotCellsY: 4, veinW: 0.11, veinAmp: 0.95, crazeCells: 15, crazeCellsY: 11, crazeW: 0.085, crazeAmp: 0.58 },
    // 4 — **설원 2**: 결이 다른 정적 구역(암반은 매끈, 설면은 실금만).
    { band: 0, lowCells: 3, lowGrit: 0.52, lowPlate: 0.5, hotCells: 3, veinW: 0.055, veinAmp: 0.46, crazeCells: 6, crazeW: 0.05, crazeAmp: 0.2 },
    // 5 — 극소 스케일: 빙탑지대. 좁은 띠로 들어가 강세를 만든다.
    { band: 2, lowCells: 8, lowCellsY: 6, lowGrit: 1.45, lowPlate: 0.75, hotCells: 9, hotCellsY: 6, veinW: 0.088, veinAmp: 0.85, crazeCells: 19, crazeCellsY: 14, crazeW: 0.07, crazeAmp: 0.5 },
    // 6 — **설원 3**: 정적 밴드의 세 번째 결. 밴드 안에 그림이 둘뿐이면 조용한 구역에서
    //      64px 반복이 다시 눈에 잡힌다(생성기가 3종을 강제한다).
    { band: 0, lowCells: 4, lowCellsY: 3, lowGrit: 0.66, lowPlate: 0.7, hotCells: 2, hotCellsY: 3, veinW: 0.07, veinAmp: 0.56, crazeCells: 3, crazeCellsY: 4, crazeW: 0.055, crazeAmp: 0.18 },
    // 7 — 중 스케일 변주.
    { band: 1, lowCells: 4, lowCellsY: 3, lowGrit: 1.15, lowPlate: 1.05, hotCells: 6, hotCellsY: 4, veinW: 0.125, veinAmp: 1.0, crazeCells: 11, crazeCellsY: 8, crazeW: 0.09, crazeAmp: 0.46 },
  ],
};
