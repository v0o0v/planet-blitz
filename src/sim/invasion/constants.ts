/**
 * 침공 3레이어 — 상수 정본 (M7a · L0-schema).
 *
 * 여기 있는 값은 전부 **결정론 정수**다(ADR-0005). 배율·감쇠는 f64 누적을 피하려고
 * centi-percent(1/100 %) 정수로만 표현한다 — src/sim/defense.ts 의 scaleFireCooldown
 * 선례와 동일한 규율이다.
 *
 * 구 침공(단일 아레나)의 `DEFAULT_TIME_LIMIT_TICKS`(src/sim/defense.ts:254)는 **건드리지
 * 않는다**. 신·구 침공 경로가 M7a 웨이브 0~2 동안 병존해야 빌드가 그린이고, 구 상수는
 * 마지막 레거시 삭제 레인(L11)이 파일과 함께 정리한다.
 */

// ---------------------------------------------------------------------------
// 슬롯 수 (기획 §10 미결 해소 — 레인 문서 "채택 결정값")
// ---------------------------------------------------------------------------

/** L1 웨이브 슬롯 수. 빈 슬롯은 스폰 단계에서 기본 수비대가 충원한다(정규화 아님). */
export const INVASION_WAVE_SLOTS = 6;

/** L2 맵 템플릿 코드 — 직선형. 소켓이 가장 많다(개활 회랑). */
export const MAP_TEMPLATE_STRAIGHT = 0;
/** L2 맵 템플릿 코드 — 굴곡형. 소켓 보통. */
export const MAP_TEMPLATE_CURVED = 1;
/** L2 맵 템플릿 코드 — 병목형. 소켓이 가장 적다(좁은 통로). */
export const MAP_TEMPLATE_CHOKE = 2;

/** 맵 템플릿 개수(코드 0..2). append-only — 신규 템플릿은 뒤에만 추가한다. */
export const INVASION_TEMPLATE_COUNT = 3;

/**
 * 템플릿별 L2 설치 소켓 수. 배열 인덱스 = 템플릿 코드(계약 — 재배치 금지).
 * 직선형 12 / 굴곡형 10 / 병목형 8.
 */
export const INVASION_SOCKET_COUNTS: readonly number[] = [12, 10, 8];

/** 소켓 배열 최대 길이(정규화 상한 계산·버퍼 크기용). */
export const INVASION_MAX_SOCKETS = 12;

/** L3 기물 소켓 수. 빈 소켓은 비워 둔다(기본 수비대 충원 대상 아님 — 과충전 방지). */
export const INVASION_PROP_SLOTS = 6;

/**
 * L3 수호 기체 슬롯 수. data/guardian.ts 의 MAX_GUARDIAN_SLOTS 와 **같은 값을 유지**해야
 * SQL `inject_guardian_authority`(limit 2) · EF `injectGuardianAuthority` · 클라 3자 매핑이
 * 비트 동일하다. 값을 바꾸려면 세 곳을 동시에 바꿔야 한다.
 */
export const INVASION_GUARDIAN_SLOTS = 2;

/** L3 방어 보스 슬롯 수. */
export const INVASION_BOSS_SLOTS = 1;

/** 코어 모듈 슬롯 수(구 '방어 카드' 계승 자리). 확장은 이 상수 1줄. */
export const INVASION_CORE_MODULE_SLOTS = 2;

// ---------------------------------------------------------------------------
// 시간 예산 (틱 = 1/60초)
// ---------------------------------------------------------------------------

/** L1(대기권 돌파) 레이어 예산 — 90초. soft: 소진 시 강제 전이. */
export const INVASION_L1_TICKS = 5400;
/** L2(회랑 돌파) 레이어 예산 — 90초. soft: 소진 시 강제 전이. */
export const INVASION_L2_TICKS = 5400;
/** L3(코어방) 레이어 예산 — 120초. soft: 소진 시 강제 전이(실질적으로 총 예산에 걸린다). */
export const INVASION_L3_TICKS = 7200;

/**
 * 레이어별 예산 배열. 인덱스 = {@link InvasionPhase} 코드.
 * **soft 예산**이다 — 소진되면 gameOver 가 아니라 다음 레이어로 강제 전이한다(진행이 막히지
 * 않게). 유일한 hard 상한은 {@link INVASION_TOTAL_TICKS}.
 */
export const INVASION_LAYER_TICKS: readonly number[] = [
  INVASION_L1_TICKS,
  INVASION_L2_TICKS,
  INVASION_L3_TICKS,
];

/**
 * 침공 런 총 예산 — 300초 = 18000틱. **hard**: 도달 시 gameOver.
 * EF 의 입력 길이 게이트(`inputs.length > server.timeLimitTicks`)와 같은 값을 써야 정직한
 * 5분 런이 `invasion-inputs-too-long` 으로 오거부되지 않는다.
 */
export const INVASION_TOTAL_TICKS = 18000;

// ---------------------------------------------------------------------------
// 페이즈
// ---------------------------------------------------------------------------

/** 페이즈 코드 — L1 대기권(종스크롤 +Y→-Y). */
export const PHASE_L1 = 0;
/** 페이즈 코드 — L2 회랑(횡스크롤 +X). */
export const PHASE_L2 = 1;
/** 페이즈 코드 — L3 코어방(고정 카메라). */
export const PHASE_L3 = 2;
/** 페이즈 개수. */
export const INVASION_PHASE_COUNT = 3;

/** 스크롤 축 — 종(세로). */
export const SCROLL_AXIS_VERTICAL = 0;
/** 스크롤 축 — 횡(가로). */
export const SCROLL_AXIS_HORIZONTAL = 1;
/** 스크롤 축 — 고정(스크롤 없음, L3). */
export const SCROLL_AXIS_NONE = 2;

/** 페이즈별 스크롤 축. 인덱스 = 페이즈 코드. */
export const INVASION_PHASE_SCROLL_AXIS: readonly number[] = [
  SCROLL_AXIS_VERTICAL,
  SCROLL_AXIS_HORIZONTAL,
  SCROLL_AXIS_NONE,
];

// ---------------------------------------------------------------------------
// 전멸 가속 (centi-percent 정수 — f64 누적 금지)
// ---------------------------------------------------------------------------

/** 스크롤 속도 배율 기본값 = 100cp = ×1.00. */
export const INVASION_ACCEL_BASE_CP = 100;
/** 스크롤 속도 배율 상한 = 200cp = ×2.00. */
export const INVASION_ACCEL_MAX_CP = 200;
/** 구간 전멸 상태에서 매 틱 가산되는 배율(cp). */
export const INVASION_ACCEL_GAIN_CP = 2;
/** 비전멸 상태에서 매 틱 감산되는 배율(cp). 가산보다 빨라 복구가 즉각적이다. */
export const INVASION_ACCEL_DECAY_CP = 4;

// ---------------------------------------------------------------------------
// 코어 · 레이어 클리어 보상
// ---------------------------------------------------------------------------

/**
 * L3 코어 기본 내구도. 구 CORE_HP(3000) 대비 상향 — 3분 단일 아레나의 최종 목표에서
 * 5분 원정의 마지막 관문으로 성격이 바뀌었고, 보스 1 + 수호 2 + 기물 6 이 함께 붙는다.
 */
export const INVASION_CORE_HP = 8000;

/** 코어 히트박스 반지름(구 CORE_RADIUS 와 동일 — 조준감 유지). */
export const INVASION_CORE_RADIUS = 90;

/** 레이어 클리어 회복량(최대 HP 대비 %). 정수 산술: Math.round(maxHp * 20 / 100). */
export const LAYER_CLEAR_HEAL_PERCENT = 20;
/** 레이어 클리어 폭탄 보너스(보유 상한 내). */
export const LAYER_CLEAR_BOMB_BONUS = 1;

// ---------------------------------------------------------------------------
// Ref 필드 도메인 (정규화 클램프 범위)
// ---------------------------------------------------------------------------

/** 방어체 레벨 하한. */
export const INVASION_LEVEL_MIN = 1;
/** 방어체 레벨 상한. */
export const INVASION_LEVEL_MAX = 99;
/** 승급 단계 하한. */
export const INVASION_ASCENSION_MIN = 0;
/** 승급 단계 상한. */
export const INVASION_ASCENSION_MAX = 5;
/** 등급 코드 개수(0=normal, 1=magic, 2=rare, 3=unique — src/items/types.ts RARITY_CODE 사다리와 동일). */
export const INVASION_RARITY_COUNT = 4;

/** 어픽스 시드 도메인 상한(uint32). 정규화가 `>>> 0` 로 접는다. */
export const INVASION_AFFIX_SEED_MASK = 0xffffffff;

// ---------------------------------------------------------------------------
// 해시 계약
// ---------------------------------------------------------------------------

/**
 * 침공 해시 블록 버전. M7a 에서 구 침공 블록(조건부 접기 4단)을 통째로 v2 로 교체한다.
 * v3(ADR-0025): 수호 스냅샷에 발사 서술자 3필드(weaponType·bulletCount·spread)를 추가하고
 * 수호 발사 sim 을 무기 아키타입별로 분기해 해시가 바뀐다 — 미출시 전제라 fixture 를 전량
 * 재생성한다(접기 5단보다 안전 — 레인 문서 §채택 결정값). **PvE 블록은 한 바이트도 바뀌지 않는다.**
 */
export const INVASION_HASH_VERSION = 3;
