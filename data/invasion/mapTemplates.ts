/**
 * 침공 L2 회랑 — 맵 템플릿 3종 + 설치 소켓 좌표 테이블 (M7a · L4-facility).
 *
 * L2 는 **횡스크롤(+X) 회랑**이다. 회랑은 상·하 긴 벽(`wall` kind)으로 닫혀 있고, 방어자는
 * 벽 안쪽 면에 붙은 **소켓**에만 설비를 설치할 수 있다. 소켓은 좌표뿐 아니라 **조준 방향
 * (facingDeg)과 사계(arcDeg)** 를 함께 갖는다 — 벽부착 설비가 벽을 뚫고 반대편을 쏘는 것을
 * 기하로 막는다(구 포탑 6종에는 이 개념이 없었다).
 *
 * ## 좌표계
 * - 회랑은 x = 0 에서 시작해 +X 로 {@link InvasionMapTemplate.lengthUnits} 만큼 뻗는다.
 * - y 는 화면 좌표계와 동일하게 **아래가 +** 다. 따라서 위쪽 벽에 붙은 소켓은 `facingDeg = 90`
 *   (아래 = +Y), 아래쪽 벽에 붙은 소켓은 `facingDeg = 270`(위 = -Y) 을 본다.
 * - 각도 단위는 **정수 도(度)** 다. 라디안 변환은 sim 이 `deg * PI / 180` 으로 1회만 한다
 *   (데이터에 f64 라디안을 박아두지 않는다 — ADR-0005 정수 도메인 규율).
 *
 * ## 벽 규약
 * 벽 1개 = `spawnWall(x, y, halfW, halfH)` 의 AABB 다(entities.ts 필드 매핑 정본:
 * radius=halfW, targetX=halfH). 벽 두께는 **최소 240u**(halfH 120)로 잡아 "벽 최소 폭 120u >
 * 최대 대시 스텝 59u" 터널링 방지 전제를 여유 있게 만족한다.
 *
 * **여기 템플릿의 벽은 전부 정적이다.** M7c 에서 추가된 압축 프레스(이동 벽)는 이 표가 아니라
 * **소켓 배치**로 들어온다 — 설비 카탈로그 6번을 소켓에 꽂으면 그 소켓의 facing 방향으로
 * 왕복하는 벽이 생긴다(src/sim/invasion/movingWall.ts). 이동 벽은 위 정적 전제를 깨므로
 * 정적 폭 비교가 아니라 **상대 프레임 스윕 판정**으로 터널링을 막는다. 소켓 좌표를 옮기면
 * 프레스의 왕복 구간도 함께 옮겨간다는 뜻이므로, 좌표 변경 시 반대편 벽까지의 여유를
 * 다시 확인할 것(tests/invasionMovingWall.test.ts 가 기하 불변식을 강제한다).
 *
 * ## 소켓 수 계약
 * 템플릿별 소켓 수는 `INVASION_SOCKET_COUNTS`(src/sim/invasion/constants.ts)와 **정확히**
 * 일치해야 한다: 직선형 12 / 굴곡형 10 / 병목형 8. 테스트가 강제한다.
 *
 * 데이터 전용 모듈(리프) — sim 을 import 하지 않는다.
 */

/** 회랑 벽 1개(AABB). `spawnWall` 인자와 1:1. 전부 정수 월드 유닛. */
export interface InvasionWallDef {
  readonly x: number;
  readonly y: number;
  /** 반폭(halfW). */
  readonly halfW: number;
  /** 반높이(halfH). */
  readonly halfH: number;
}

/** 설치 소켓 1개. 좌표 + 조준 방향/사계(정수 도). */
export interface InvasionSocketDef {
  readonly x: number;
  readonly y: number;
  /** 조준 기준 방향(정수 도). 0 = +X, 90 = +Y(아래), 180 = -X, 270 = -Y(위). */
  readonly facingDeg: number;
  /** 사계 **전체 폭**(정수 도). 실제 허용 범위는 facing ± arcDeg/2. */
  readonly arcDeg: number;
}

/** 맵 템플릿 1종. */
export interface InvasionMapTemplate {
  /** 템플릿 코드 = 배열 인덱스(계약 — 재배치 금지). */
  readonly id: number;
  /** i18n 키 조각(`def3.map.<key>.name`). 이모지 금지(Pixi 두부). */
  readonly key: string;
  /** 회랑 전체 길이(+X, 월드 유닛). */
  readonly lengthUnits: number;
  /** 회랑 통로 반높이 기준값(렌더·카메라 참고용). 굴곡형은 구간별 중심이 달라 최대치다. */
  readonly halfHeight: number;
  /** 정적 벽 목록(스폰 순서 = 배열 순서 = 결정론 입력). */
  readonly walls: readonly InvasionWallDef[];
  /** 설치 소켓 목록. 인덱스 = `l2.sockets` 배열 인덱스(3자 매핑 계약). */
  readonly sockets: readonly InvasionSocketDef[];
}

/** 벽 안쪽 면에서 소켓 중심까지의 거리(월드 유닛). 전 템플릿 공통. */
export const SOCKET_WALL_INSET = 40;

/** 벽부착 설비의 기본 사계(정수 도). 벽 반대편 반구보다 조금 좁다. */
const DEFAULT_ARC_DEG = 160;

// ---------------------------------------------------------------------------
// ① 직선형 — 개활 회랑. 소켓 12(가장 많음). 엄폐가 적어 화력전이 된다.
// ---------------------------------------------------------------------------
const STRAIGHT: InvasionMapTemplate = {
  id: 0,
  key: 'map.straight',
  lengthUnits: 12000,
  halfHeight: 540,
  walls: [
    // 위 긴 벽: y ∈ [-780, -540] → 안쪽 면 y = -540.
    { x: 6000, y: -660, halfW: 6000, halfH: 120 },
    // 아래 긴 벽: y ∈ [540, 780] → 안쪽 면 y = 540.
    { x: 6000, y: 660, halfW: 6000, halfH: 120 },
  ],
  sockets: [
    // 위 벽 6기(아래를 본다).
    { x: 900, y: -500, facingDeg: 90, arcDeg: DEFAULT_ARC_DEG },
    { x: 2700, y: -500, facingDeg: 90, arcDeg: DEFAULT_ARC_DEG },
    { x: 4500, y: -500, facingDeg: 90, arcDeg: DEFAULT_ARC_DEG },
    { x: 6300, y: -500, facingDeg: 90, arcDeg: DEFAULT_ARC_DEG },
    { x: 8100, y: -500, facingDeg: 90, arcDeg: DEFAULT_ARC_DEG },
    { x: 9900, y: -500, facingDeg: 90, arcDeg: DEFAULT_ARC_DEG },
    // 아래 벽 6기(위를 본다). 위 벽과 엇갈리게 배치해 교차 화망을 만든다.
    { x: 1800, y: 500, facingDeg: 270, arcDeg: DEFAULT_ARC_DEG },
    { x: 3600, y: 500, facingDeg: 270, arcDeg: DEFAULT_ARC_DEG },
    { x: 5400, y: 500, facingDeg: 270, arcDeg: DEFAULT_ARC_DEG },
    { x: 7200, y: 500, facingDeg: 270, arcDeg: DEFAULT_ARC_DEG },
    { x: 9000, y: 500, facingDeg: 270, arcDeg: DEFAULT_ARC_DEG },
    { x: 10800, y: 500, facingDeg: 270, arcDeg: DEFAULT_ARC_DEG },
  ],
};

// ---------------------------------------------------------------------------
// ② 굴곡형 — 3구간이 위아래로 엇갈린 회랑. 소켓 10(보통). 사계 사각지대가 생긴다.
//    구간 중심 y: 0(x 0~4000) → -300(4000~8000) → +300(8000~12000).
// ---------------------------------------------------------------------------
const CURVED: InvasionMapTemplate = {
  id: 1,
  key: 'map.curved',
  lengthUnits: 12000,
  halfHeight: 480,
  walls: [
    // 구간 0(중심 0): 안쪽 면 -480 / +480.
    { x: 2000, y: -600, halfW: 2000, halfH: 120 },
    { x: 2000, y: 600, halfW: 2000, halfH: 120 },
    // 구간 1(중심 -300): 안쪽 면 -780 / +180.
    { x: 6000, y: -900, halfW: 2000, halfH: 120 },
    { x: 6000, y: 300, halfW: 2000, halfH: 120 },
    // 구간 2(중심 +300): 안쪽 면 -180 / +780.
    { x: 10000, y: -300, halfW: 2000, halfH: 120 },
    { x: 10000, y: 900, halfW: 2000, halfH: 120 },
  ],
  sockets: [
    { x: 1200, y: -440, facingDeg: 90, arcDeg: DEFAULT_ARC_DEG },
    { x: 3200, y: -440, facingDeg: 90, arcDeg: DEFAULT_ARC_DEG },
    { x: 2800, y: 440, facingDeg: 270, arcDeg: DEFAULT_ARC_DEG },
    { x: 5200, y: -740, facingDeg: 90, arcDeg: DEFAULT_ARC_DEG },
    { x: 7200, y: -740, facingDeg: 90, arcDeg: DEFAULT_ARC_DEG },
    { x: 4800, y: 140, facingDeg: 270, arcDeg: DEFAULT_ARC_DEG },
    { x: 6800, y: 140, facingDeg: 270, arcDeg: DEFAULT_ARC_DEG },
    { x: 9200, y: -140, facingDeg: 90, arcDeg: DEFAULT_ARC_DEG },
    { x: 11200, y: -140, facingDeg: 90, arcDeg: DEFAULT_ARC_DEG },
    { x: 10800, y: 740, facingDeg: 270, arcDeg: DEFAULT_ARC_DEG },
  ],
};

// ---------------------------------------------------------------------------
// ③ 병목형 — 중앙에 좁은 통로(폭 360u). 소켓 8(가장 적음)이지만 병목 2기가 통로를 직사한다.
// ---------------------------------------------------------------------------
const CHOKE: InvasionMapTemplate = {
  id: 2,
  key: 'map.choke',
  lengthUnits: 12000,
  halfHeight: 540,
  walls: [
    { x: 6000, y: -660, halfW: 6000, halfH: 120 },
    { x: 6000, y: 660, halfW: 6000, halfH: 120 },
    // 병목 블록: x ∈ [5400, 6600]. 위 블록 y ∈ [-540, -180], 아래 블록 y ∈ [180, 540].
    // 통로는 y ∈ (-180, 180) = 폭 360u.
    { x: 6000, y: -360, halfW: 600, halfH: 180 },
    { x: 6000, y: 360, halfW: 600, halfH: 180 },
  ],
  sockets: [
    { x: 1500, y: -500, facingDeg: 90, arcDeg: DEFAULT_ARC_DEG },
    { x: 3500, y: -500, facingDeg: 90, arcDeg: DEFAULT_ARC_DEG },
    { x: 9000, y: -500, facingDeg: 90, arcDeg: DEFAULT_ARC_DEG },
    { x: 11000, y: -500, facingDeg: 90, arcDeg: DEFAULT_ARC_DEG },
    { x: 2500, y: 500, facingDeg: 270, arcDeg: DEFAULT_ARC_DEG },
    { x: 10000, y: 500, facingDeg: 270, arcDeg: DEFAULT_ARC_DEG },
    // 병목 직사 2기. 사계를 좁혀(120도) 통로만 훑는다.
    { x: 6000, y: -140, facingDeg: 90, arcDeg: 120 },
    { x: 6000, y: 140, facingDeg: 270, arcDeg: 120 },
  ],
};

/** 맵 템플릿 3종. 배열 인덱스 = 템플릿 코드(계약 — append-only, 재배치 금지). */
export const INVASION_MAP_TEMPLATES: readonly InvasionMapTemplate[] = [STRAIGHT, CURVED, CHOKE];

/**
 * 템플릿 코드로 조회한다. 범위 밖 코드는 **직선형으로 폴백**한다 — 정규화를 통과한 layers 는
 * 항상 유효 코드지만, 폴백이 있어야 손상 데이터가 sim 을 죽이지 않는다(거동은 결정론 유지).
 */
export function mapTemplateFor(templateId: number): InvasionMapTemplate {
  const t = INVASION_MAP_TEMPLATES[templateId];
  return t !== undefined ? t : STRAIGHT;
}
