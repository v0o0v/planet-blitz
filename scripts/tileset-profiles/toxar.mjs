/**
 * 톡사르 — 오염 늪 지각. 하부는 썩은 이탄(泥炭), 상부는 오염 지각 위를 흐르는 독성 침출 개천.
 *
 * ## 이 행성이 색을 고른 방식 — 골짜기가 좁고, 그 안에 적이 이미 살고 있다
 * 안전 색상 골짜기는 `computeSafeHueWindows(FOREGROUND_SIGNAL_COLORS, 10)` 로 계산해
 * **280.19° → 305.00°**(폭 24.81°) 하나뿐이다. 양옆이 퍼플 적탄(270.19°)과 마젠타
 * 적탄(315.00°)이라 좌우로 도망갈 곳이 없다.
 *
 * 그런데 여기엔 계약이 재지 않는 축이 하나 더 있다 — **톡사르 적 스프라이트 몸통색이
 * 281.6°·283.1° 로 이미 그 골짜기 안이다**(`enemy_toxar_gunner` rgb 138,52,176 /
 * 나머지 3종 rgb 230,184,248). `FOREGROUND_SIGNAL_COLORS` 는 탄·아군 표식만 담으므로
 * 검증기는 이걸 통과시킨다. 그래서 팔레트를 골짜기 **중앙(292.6°)이 아니라 마젠타 쪽
 * 끝(≈297°)** 에 둔다:
 *
 * | 대상 | 각도 | 팔레트(297°)와의 거리 |
 * |---|---|---|
 * | 퍼플 적탄 | 270.19° | 26.8° |
 * | **적 몸통** | 281.6~283.1° | **13.9~15.4°** |
 * | 마젠타 적탄 | 315.00° | 18.0° |
 *
 * 골짜기 중앙에 뒀다면 적 몸통과 9.5° 로 붙었을 자리다. 세 위험원 중 **가장 가까운 것을
 * 최대화**하는 지점이 여기다.
 *
 * ## 명도 구조
 * 개천(밝은 violet)은 **선 위에만** 있고 지각 평균은 낮게 유지한다(`crustL` 34). 적 4종 중
 * 3종이 휘도 198 의 밝은 라벤더라, 지각이 중간 밝기로 뜨면 그쪽과 붙는다.
 *
 * ## 흐름 방향
 * 밴드 1 은 **세로**(cellsY < cellsX ⇒ 셀이 세로로 길다), 밴드 2 는 가로다. 늪물은 고지에서
 * 저지로 스며 내려가므로 주 흐름이 세로다. 카르곤(밴드1 가로)과 방향이 반대인 것은 그
 * 서사 차이지 취향이 아니다.
 *
 * 규칙(불변식 I1~I4)은 `scripts/tileset-gen.mjs` 헤더에 있다. 여기 있는 것은 톡사르 실측뿐이다.
 */
export default {
  planet: 'toxar',
  name: 'toxar — 오프라인 합성 Wang 타일셋',

  tile: 32,
  cols: 4,
  fillVariants: 7,
  /** 톡사르 전용 시드. 카르곤(0)과 겹치면 두 행성의 실루엣 배치가 같아진다. */
  seedOffset: 0x4100,
  normalise: 'multiplicative',

  /**
   * 실루엣 스케일 3단. 셀 수·가중은 카르곤과 같다 — 이건 테마가 아니라 **메커니즘**이다
   * (변 정합과 rot180 대칭이 성립하는 구성이고, 늪이라고 달라질 이유가 없다).
   * 시드만 톡사르 것으로 갈아 실루엣 그림 자체는 다르게 나온다.
   */
  silhouette: {
    amp: 0.82,
    octaves: [
      { seed: 0x41c6a7d3, cells: 4, weight: 0.46 },
      { seed: 0x4192b5c1, cells: 8, weight: 0.32 },
      { seed: 0x41f0d3e9, cells: 16, weight: 0.22 },
    ],
  },

  palette: {
    /**
     * 하부 = 썩은 이탄·진흙. 카르곤 현무암보다 조금 더 어둡다(`baseL` 29) — 늪 바닥은
     * 젖어 있어 빛을 되돌리지 않는다. 색은 갈올리브(R≈G>B)라 상부의 violet 개천과
     * **보색 관계**가 되어 개천이 명도를 올리지 않고도 읽힌다.
     */
    lower: {
      fissureW: 0.14,
      lipUp: 1.9, // 틈 위쪽 입술(광원이 아래에 있어도 입술 자체는 기하적 상단이다)
      lipDown: 0.18,
      midACells: 5,
      midBCells: 9,
      fineCells: 16,
      gritCells: 32,
      densCells: 3, // ⚠️ 진폭 변조 전용 — 휘도에 더하면 I4 위반
      baseL: 27,
      idAmp: 6,
      midAAmp: 8,
      midBAmp: 19,
      fineAmp: 14,
      gritAmp: 9,
      fissureAmp: 21,
      lipAmp: 24,
      roughBias: 0.2,
      roughGain: 1.7,
      /** 젖은 광물 반짝임. 상위 12% 그릿만 — 늪 바닥의 물기는 카르곤 흑요석보다 성기다. */
      glintCut: 0.88,
      glintGain: 104,
      glintDensBias: 0.32,
      glintDensGain: 1.45,
      glintDensCap: 1.55,
      /** 틈 바닥에 고인 독성 침출. 카르곤 잔불(주황)의 자리에 오염(violet)이 들어간다. */
      emberCut: 0.85,
      emberGain: 3.1,
      rgb: [0.9, 1.06, 0.84], // 어두운 올리브 이탄 — G>R 이라 화면 평균이 카르곤(갈적)과 갈린다
      glintRgb: [0.92, 0.94, 1.12],
      emberRgb: [29, 3, 30], // 297.8° — 골짜기 안, 적 몸통에서 14° 이상
    },

    /**
     * 상부 = 오염 지대. 지배색은 **어두운 이끼 회록**이고, 판을 가르는 좁은 개천에서만
     * violet 이 비친다. `crustL` 34 는 카르곤(36)보다 낮다 — 톡사르 적 3종이 휘도 198 의
     * 밝은 라벤더라 지각이 중간 밝기로 뜨면 그쪽과 붙기 때문이다.
     */
    upper: {
      veinPow: 3.2, // 카르곤(3.0)보다 높다 = 심지를 더 좁게 = 중간 밝기 violet 면적을 줄인다
      bevelGain: 1.5,
      midCells: 6,
      fineCells: 16,
      gritCells: 32,
      crustL: 34,
      idAmp: 6,
      midAmp: 18,
      fineAmp: 12,
      gritAmp: 7,
      bevelAmp: 8,
      rgb: [0.94, 1.08, 0.92], // 이끼 회록 — violet 개천의 보색 쪽
      haloScale: 3.2,
      shadeAmp: 0.44,
      crazePow: 2.4,
      crazeMidBias: 0.35,
      crazeMidGain: 0.45,
      crazeTarget: [46, 12, 50], // 293.7° 부패 실금 — **껍질보다 어둡다**(카르곤 잔금은 반대로 밝다)
      crazeMix: [0.82, 0.74, 0.82],
      veinLin: 0.32,
      veinCore: 0.9,
      veinMidBias: 0.7,
      veinMidGain: 0.42,
      /**
       * 개천 심지 296.6°. 휘도 142 로 카르곤(208)보다 한참 낮다 — 밝은 라벤더 적(198)과
       * 명도로도 갈라야 해서, 이 행성에서 심지를 밝히는 것은 위장을 만드는 방향이다.
       */
      veinTarget: [250, 140, 252],
      veinMixR: 0.96,
      veinMixG: [0.26, 0.58], // G 를 낮게 유지 = 밝은 라벤더 적(rgb 230,184,248)과의 유일한 분리 채널
      veinMixB: [0.3, 0.62],
    },

    /** 경계 인접 상부 픽셀 감쇠. 늪 가장자리는 식는 게 아니라 이끼 그늘이 진다(G 를 덜 깎는다). */
    edge: [0.46, 0.52, 0.46],
  },

  /**
   * 변형 8종, 밴드 배분 정적 3 / 중 3 / 파쇄 2.
   *
   * 밴드 사이 대비는 휘도가 아니라 **개천 밀도**로만 준다(밴드 정규화가 껍질 평균을 고정한다).
   * 흐름 방향은 밴드 단위로 통일: 밴드 1 = 세로(`lowCellsY < lowCells`), 밴드 2 = 가로.
   */
  styles: [
    // 0 — 기본(Wang 16장 + 채움 슬롯 0). 중 스케일·세로 흐름.
    { band: 1, lowCells: 6, lowCellsY: 4, lowGrit: 1.0, lowPlate: 1.0, hotCells: 5, hotCellsY: 3, veinW: 0.14, veinAmp: 1.0, crazeCells: 13, crazeCellsY: 9, crazeW: 0.095, crazeAmp: 0.52 },
    // 1 — **정체 수면**: 개천이 거의 없는 넓은 진창. 화면의 정적 담당.
    { band: 0, lowCells: 2, lowGrit: 0.4, lowPlate: 0.34, hotCells: 2, veinW: 0.05, veinAmp: 0.52, crazeCells: 4, crazeW: 0.042, crazeAmp: 0.13 },
    // 2 — 대 스케일: 넓은 판을 가르는 굵고 성긴 개천.
    { band: 1, lowCells: 5, lowCellsY: 3, lowGrit: 0.82, lowPlate: 1.12, hotCells: 4, hotCellsY: 2, veinW: 0.18, veinAmp: 1.04, crazeCells: 8, crazeCellsY: 5, crazeW: 0.066, crazeAmp: 0.28 },
    // 3 — 소 스케일: 잘게 갈라진 균열 습지.
    { band: 2, lowCells: 4, lowCellsY: 7, lowGrit: 1.28, lowPlate: 0.9, hotCells: 4, hotCellsY: 6, veinW: 0.11, veinAmp: 0.94, crazeCells: 10, crazeCellsY: 15, crazeW: 0.082, crazeAmp: 0.58 },
    // 4 — **정체 수면 2**: 결이 다른 정적 구역(바닥은 매끈, 지각엔 실금만).
    { band: 0, lowCells: 3, lowGrit: 0.48, lowPlate: 0.48, hotCells: 3, veinW: 0.056, veinAmp: 0.48, crazeCells: 6, crazeW: 0.048, crazeAmp: 0.19 },
    // 5 — 극소 스케일: 8px 급 부식대. 좁은 띠로 들어가 리듬의 강세를 만든다.
    { band: 2, lowCells: 6, lowCellsY: 9, lowGrit: 1.42, lowPlate: 0.74, hotCells: 6, hotCellsY: 9, veinW: 0.086, veinAmp: 0.84, crazeCells: 13, crazeCellsY: 18, crazeW: 0.068, crazeAmp: 0.48 },
    // 6 — **정체 수면 3**: 정적 밴드의 세 번째 결. 밴드 안에 그림이 둘뿐이면 조용한 구역에서
    //      64px 반복이 눈에 잡힌다(생성기가 3종 이상을 강제한다).
    { band: 0, lowCells: 3, lowCellsY: 4, lowGrit: 0.62, lowPlate: 0.68, hotCells: 3, hotCellsY: 2, veinW: 0.07, veinAmp: 0.58, crazeCells: 4, crazeCellsY: 3, crazeW: 0.052, crazeAmp: 0.17 },
    // 7 — 중 스케일 변주.
    { band: 1, lowCells: 6, lowCellsY: 4, lowGrit: 1.12, lowPlate: 1.04, hotCells: 6, hotCellsY: 4, veinW: 0.125, veinAmp: 0.98, crazeCells: 15, crazeCellsY: 11, crazeW: 0.086, crazeAmp: 0.48 },
  ],
};
