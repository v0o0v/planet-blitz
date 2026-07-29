/**
 * 카르곤 — 용암 지각. `scripts/tileset-gen.mjs` 의 기준 프로파일이자 **회귀 게이트**다.
 *
 * 여기 있는 수치는 카르곤 4차(PR#192)에서 4라운드의 비평·실측을 거쳐 굳은 값이고,
 * 이 프로파일로 생성한 `kargon.png`/`kargon.json` 은 `assets/tilesets/` 의 현재 자산과
 * **바이트 단위로 같아야 한다**. 다르면 생성기 쪽 리팩터가 값을 움직인 것이다.
 *
 *   node scripts/tileset-gen.mjs --planet kargon --out <tmp>
 *   diff <tmp>/kargon.png assets/tilesets/kargon.png
 *
 * ⚠️ 새 행성을 만들 때 이 파일을 복사해 색만 바꾸지 마라. 아래 주석은 **카르곤 실측**이지
 * 일반 규칙이 아니다. 규칙(불변식 I1~I4)은 `scripts/tileset-gen.mjs` 헤더에 있다.
 */
export default {
  planet: 'kargon',
  /** 시트/JSON 에 박히는 이름. 카르곤은 바이트 동일 게이트 때문에 4차 문자열 그대로 둔다. */
  name: 'kargon — 오프라인 합성 Wang 타일셋 (4차)',
  /**
   * 바이트 동일 게이트 유지용 legacy 문자열. 생성기는 `scripts/tileset-gen.mjs` 로 승격됐고
   * 아래 경로에는 그리로 보내는 안내문만 남아 있다. 카르곤을 **실제로 재생성해 덮는** 시점에
   * 이 note 를 지워 기본값(새 경로)을 쓰게 하라 — 그 한 줄이 JSON 바이트를 바꾼다.
   */
  note: '실루엣·내부 전부 오프라인 합성. 재생성기는 .omc/research/kargon-aaa-shots/kargon-tileset-gen.mjs.',

  tile: 32,
  cols: 4,
  /** key 0 / key 15 각각의 추가 변형 수. 시트 행 수는 여기서 파생된다. */
  fillVariants: 7,
  /** 타일 시드 오프셋. 0 = 4차 원본. 바꾸면 그림이 통째로 달라진다(카르곤은 절대 건드리지 마라). */
  seedOffset: 0,
  normalise: 'multiplicative',

  /**
   * 실루엣(I1·I2). 스케일 3단 — 4셀 성분이 큰 손가락(≈8px)을, 16셀이 픽셀 단위 톱니를 만든다.
   * 전 타일이 이 하나를 공유하고 180° 대칭이라야 변 정합과 rot180 변형이 동시에 성립한다.
   */
  silhouette: {
    amp: 0.84,
    octaves: [
      { seed: 0x51ed270b, cells: 4, weight: 0.46 },
      { seed: 0x1b873593, cells: 8, weight: 0.32 },
      { seed: 0x2545f491, cells: 16, weight: 0.22 },
    ],
  },

  palette: {
    /** 하부 = 현무암. 평균은 낮게, 국소 대비는 크게. */
    lower: {
      fissureW: 0.13, // 판 사이 틈의 대역폭
      lipUp: 2.1, // 틈 위쪽 입술 밝기 배수(광원이 위)
      lipDown: 0.15, // 아래쪽은 거의 안 밝힌다
      midACells: 4,
      midBCells: 8,
      fineCells: 16,
      gritCells: 32,
      densCells: 3, // ⚠️ 진폭 변조 전용(zero-mean 항에만 곱한다) — 휘도에 더하면 I4 위반
      baseL: 31, // 기준 명도. 발광 요소와의 명도비를 지키려면 낮아야 한다
      idAmp: 7,
      midAAmp: 7,
      midBAmp: 21,
      fineAmp: 15,
      gritAmp: 8,
      fissureAmp: 23,
      lipAmp: 27,
      roughBias: 0.18,
      roughGain: 1.75,
      glintCut: 0.87, // 흑요석 반짝임: 상위 13% 그릿만
      glintGain: 118,
      glintDensBias: 0.3,
      glintDensGain: 1.5,
      glintDensCap: 1.6,
      emberCut: 0.84,
      emberGain: 3.4,
      rgb: [1.05, 0.92, 1.02], // 현무암은 약한 자회색
      glintRgb: [0.9, 0.95, 1.1],
      emberRgb: [30, 10, 2], // 틈 바닥의 잔불(주황)
    },

    /**
     * 상부 = 용융 지대. 껍질 명도 36 은 3차의 60 에서 끌어내린 값이다 — 주황 계열 카르곤 적이
     * 지각 위에서 위장됐던 가독성 결함의 처방. 주황은 **균열선 위에만** 있다.
     * 색상각은 두 위협색(hot-red 355.4°, 앰버 28.5°) 사이의 빈 골짜기 [10°, 18.4°] 안이다.
     */
    upper: {
      veinPow: 3.0, // 심지 집중도
      bevelGain: 1.6,
      midCells: 6,
      fineCells: 16,
      gritCells: 32,
      crustL: 36,
      idAmp: 7,
      midAmp: 15,
      fineAmp: 10,
      gritAmp: 5,
      bevelAmp: 8,
      rgb: [1.3, 0.74, 0.52], // 식은 껍질의 적갈
      haloScale: 3.0, // 균열 바깥 어두운 후광의 폭(균열 대역의 배수)
      shadeAmp: 0.34,
      crazePow: 2.4,
      crazeMidBias: 0.35,
      crazeMidGain: 0.45,
      crazeTarget: [150, 60, 24], // 잔금 색(굵은 줄기보다 훨씬 어둡게)
      crazeMix: [0.8, 0.5, 0.35],
      veinLin: 0.34,
      veinCore: 0.9,
      veinMidBias: 0.7,
      veinMidGain: 0.42,
      veinTarget: [255, 208, 134], // 진홍 → 호박 → 담황(심지에서만 흰끼)
      veinMixR: 0.98,
      veinMixG: [0.3, 0.62],
      veinMixB: [0.12, 0.55],
    },

    /**
     * 지형 경계에 인접한 상부 픽셀의 감쇠. PixelLab 이 그리던 밝은 1px 림이 "가는
     * 와이어프레임"으로 읽혔던 자리 — 대신 식은 테두리로 만든다.
     */
    edge: [0.5, 0.42, 0.42],
  },

  /**
   * 변형 8종과 밴드 배분(정적 3 / 중 3 / 파쇄 2).
   *
   * 타일 **안**에서 섞을 수 있는 주파수는 32px 의 약수뿐이라 한 장으로는 스케일 다양성에
   * 한계가 있다. 그 한계를 **타일 사이**에서 푼다 — 3차는 변형 간 차이가 hotCells 2~4(실질
   * 1.5배)뿐이라 눈에 안 잡혔다. 4차는 2~9 셀로 벌리고 균열을 거의 안 그리는 **슬래브**를
   * 넣어 화면에 의도적 정적(negative space)을 만들었다.
   *
   * 타일 사이 대비는 휘도가 아니라 **균열 밀도**로만 준다(껍질 평균 밝기는 전 변형 동일 —
   * 밴드 정규화가 강제한다). 흐름 방향(cellsX≠cellsY)은 **밴드 단위로** 통일한다:
   * 중 밴드는 가로 흐름, 세밀 밴드는 세로 흐름. 변형마다 방향이 다르면 구역이 어지러워진다.
   *
   * band 0=정적(슬래브) 1=중 2=세밀. `autotile.ts` 의 저주파 밴드 필드가 이 값으로 고른다
   * (셀 단위 독립 해시로 고르면 슬래브 한 장이 정확한 64px 정사각형으로 읽힌다).
   */
  styles: [
    // 0 — 기본(16장 Wang 전부 + 채움 슬롯 0). 중(中) 스케일.
    { band: 1, lowCells: 4, lowCellsY: 6, lowGrit: 1.0, lowPlate: 1.0, hotCells: 3, hotCellsY: 5, veinW: 0.15, veinAmp: 1.0, crazeCells: 9, crazeCellsY: 13, crazeW: 0.1, crazeAmp: 0.55 },
    // 1 — **슬래브**: 균열 거의 없는 큰 판. 화면의 정적 담당.
    { band: 0, lowCells: 2, lowGrit: 0.42, lowPlate: 0.35, hotCells: 2, veinW: 0.055, veinAmp: 0.55, crazeCells: 4, crazeW: 0.045, crazeAmp: 0.14 },
    // 2 — 대(大) 스케일: 32px 급 셀, 굵고 성긴 균열.
    { band: 1, lowCells: 3, lowCellsY: 5, lowGrit: 0.8, lowPlate: 1.15, hotCells: 2, hotCellsY: 4, veinW: 0.19, veinAmp: 1.05, crazeCells: 5, crazeCellsY: 8, crazeW: 0.07, crazeAmp: 0.3 },
    // 3 — 소(小) 스케일: 잘게 깨진 대상(帶狀).
    { band: 2, lowCells: 6, lowCellsY: 4, lowGrit: 1.3, lowPlate: 0.9, hotCells: 6, hotCellsY: 4, veinW: 0.115, veinAmp: 0.95, crazeCells: 14, crazeCellsY: 10, crazeW: 0.085, crazeAmp: 0.6 },
    // 4 — **슬래브 2**: 결이 다른 정적 구역(암부는 매끈, 상부는 실금만).
    { band: 0, lowCells: 3, lowGrit: 0.5, lowPlate: 0.5, hotCells: 3, veinW: 0.06, veinAmp: 0.5, crazeCells: 6, crazeW: 0.05, crazeAmp: 0.2 },
    // 5 — 극소 스케일: 8px 급 파쇄대. 좁은 띠로 들어가 리듬의 강세를 만든다.
    { band: 2, lowCells: 8, lowCellsY: 6, lowGrit: 1.45, lowPlate: 0.75, hotCells: 9, hotCellsY: 6, veinW: 0.09, veinAmp: 0.85, crazeCells: 18, crazeCellsY: 13, crazeW: 0.07, crazeAmp: 0.5 },
    // 6 — **슬래브 3**: 정적 밴드에 세 번째 결. 밴드 안에 그림이 둘뿐이면 조용한 구역에서
    //      64px 반복이 다시 눈에 잡힌다(프리뷰에서 확인).
    { band: 0, lowCells: 4, lowCellsY: 3, lowGrit: 0.65, lowPlate: 0.7, hotCells: 2, hotCellsY: 3, veinW: 0.075, veinAmp: 0.6, crazeCells: 3, crazeCellsY: 4, crazeW: 0.055, crazeAmp: 0.18 },
    // 7 — 중 스케일 변주.
    { band: 1, lowCells: 4, lowCellsY: 6, lowGrit: 1.15, lowPlate: 1.05, hotCells: 4, hotCellsY: 6, veinW: 0.13, veinAmp: 1.0, crazeCells: 11, crazeCellsY: 15, crazeW: 0.09, crazeAmp: 0.5 },
  ],
};
