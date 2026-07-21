/**
 * 침공 L1 편대 카탈로그 — 풀 카탈로그 8종 (M7a 임시 3종 + M7c 신규 5종 append).
 *
 * ## 편대란
 * 방어자가 L1 웨이브 슬롯 6칸에 꽂는 배치 단위다. **진형(오프셋 배열)과 진입 거동이 데이터에
 * 내장**돼 있어 방어자는 순서만 정한다(기획 §4). 구 PvE 웨이브의 `formationPositions`
 * (src/sim/waves.ts:264)와 달리 좌표가 **플레이어 상대가 아니라 스크롤 오프셋 절대 기준**이고
 * RNG 를 한 번도 소비하지 않는다 — 강제 스크롤·전멸 가속과 정면 충돌하지 않기 위한 신규 어휘다.
 *
 * ## 계약
 * - {@link FORMATIONS} 의 **배열 인덱스 = catalogId** 이고 append-only 다. 중간 삽입·재정렬은
 *   `defenses.layout` jsonb·해시 스트림·EF 재실행을 동시에 깨뜨린다(data/enemies.ts:91 선례).
 * - 구성원은 `data/enemies.ts` 의 기존 적 22종을 **참조만** 한다. ENEMY_BY_TYPE 인덱스가 해시
 *   계약이고 tests/m3Content.test.ts 가 연속성을 강제한다. M7c 풀 카탈로그도 기존 22종으로
 *   8종의 역할 분화를 전부 표현할 수 있어 **적을 append 하지 않았다** — 신규 적은 해시 계약
 *   표면(스프라이트 매핑·조준 술어·EF 재실행)을 넓히므로 역할이 실제로 비는 경우에만 늘린다.
 * - 모든 수치는 정수다(ADR-0005 결정론 — f64 누적 금지).
 * - 표시 문자열은 여기 두지 않는다. `def3.<id>.name` / `def3.<id>.desc` i18n 키를 쓰며 등재는
 *   L9-garrison-catalog 레인 소관이다.
 */

/** 진입 패턴 — 정면 직진(창 위쪽 중앙에서 내려온다). */
export const ENTRY_STRAIGHT = 0;
/** 진입 패턴 — 좌우 협공(창 바깥 좌·우에서 안쪽으로 모여든다). */
export const ENTRY_FLANK = 1;
/** 진입 패턴 — 정면 돌진(더 멀리서 밀집 대형으로 가속 진입). */
export const ENTRY_CHARGE = 2;
/** 진입 패턴 — 활공 급강하(더 높은 곳에서 좌우로 벌어져 안쪽으로 빠르게 파고든다). */
export const ENTRY_GLIDE = 3;
/** 진입 패턴 — 고정 저격선(창 가까이 얕게 등장해 거의 내려오지 않고 상단에 머무른다). */
export const ENTRY_SNIPE = 4;
/** 진입 패턴 — 살포 표류(느리게 흘러내리며 구간을 봉쇄한다). */
export const ENTRY_DRIFT = 5;

/** 진입 패턴 개수(코드 0..5). append-only. */
export const ENTRY_PATTERN_COUNT = 6;

/** 편대 구성원 1기. 좌표는 편대 기준점 대비 **정수 오프셋**(월드 유닛). */
export interface FormationMemberDef {
  /** `ENEMY_BY_TYPE` 인덱스(= EnemyDef.typeIndex). */
  readonly enemyTypeIndex: number;
  /** 기준점 대비 x 오프셋. 음수 = 왼쪽. */
  readonly dx: number;
  /** 기준점 대비 y 오프셋. 음수 = 진행 방향 앞쪽(더 멀리). */
  readonly dy: number;
  /** 편대 트리거 틱 이후 지연(틱). 0 = 즉시. */
  readonly delayTicks: number;
}

/** 편대 1종의 정의. */
export interface FormationDef {
  /** i18n 키 접미(`def3.<id>.name`). 영문 kebab-case, 이모지 금지(Pixi 두부). */
  readonly id: string;
  /** {@link FORMATIONS} 배열 인덱스와 반드시 같다(자기 기술 — 테스트가 강제). */
  readonly catalogId: number;
  /** 진형(오프셋 배열). 배열 순서 = 스폰 순서 = 해시 순서. */
  readonly members: readonly FormationMemberDef[];
  /** {@link ENTRY_STRAIGHT} 등 진입 패턴 코드. */
  readonly entryPattern: number;
}

/** 편대 catalogId — 정찰 드론편대. */
export const FORMATION_SCOUT_DRONES = 0;
/** 편대 catalogId — 요격 편대. */
export const FORMATION_INTERCEPTORS = 1;
/** 편대 catalogId — 강습 돌격편대. */
export const FORMATION_ASSAULT = 2;
/** 편대 catalogId — 조류형 활공편대(M7c append). */
export const FORMATION_GLIDE_FLOCK = 3;
/** 편대 catalogId — 기뢰 살포선(M7c append). */
export const FORMATION_MINE_LAYER = 4;
/** 편대 catalogId — 실드 호위편대(M7c append). */
export const FORMATION_SHIELD_ESCORT = 5;
/** 편대 catalogId — 저격 편대(M7c append). */
export const FORMATION_SNIPER_NEST = 6;
/** 편대 catalogId — 지원 편대(M7c append). */
export const FORMATION_SUPPORT_ESCORT = 7;

/** 정찰 드론편대 — 수리드론 5기 V자 직진. 가장 가벼운 기본 편대(빈 슬롯 충원 대상). */
const SCOUT_DRONES: FormationDef = {
  id: 'formation-scout-drones',
  catalogId: FORMATION_SCOUT_DRONES,
  entryPattern: ENTRY_STRAIGHT,
  members: [
    { enemyTypeIndex: 3, dx: 0, dy: 0, delayTicks: 0 },
    { enemyTypeIndex: 3, dx: -160, dy: -90, delayTicks: 0 },
    { enemyTypeIndex: 3, dx: 160, dy: -90, delayTicks: 0 },
    { enemyTypeIndex: 3, dx: -320, dy: -180, delayTicks: 0 },
    { enemyTypeIndex: 3, dx: 320, dy: -180, delayTicks: 0 },
  ],
};

/** 요격 편대 — 박격포 6기가 좌우 3기씩 협공. 지연을 계단식으로 줘 압박이 길게 이어진다. */
const INTERCEPTORS: FormationDef = {
  id: 'formation-interceptors',
  catalogId: FORMATION_INTERCEPTORS,
  entryPattern: ENTRY_FLANK,
  members: [
    { enemyTypeIndex: 1, dx: -220, dy: 0, delayTicks: 0 },
    { enemyTypeIndex: 1, dx: 220, dy: 0, delayTicks: 0 },
    { enemyTypeIndex: 1, dx: -220, dy: -140, delayTicks: 30 },
    { enemyTypeIndex: 1, dx: 220, dy: -140, delayTicks: 30 },
    { enemyTypeIndex: 1, dx: -220, dy: -280, delayTicks: 60 },
    { enemyTypeIndex: 1, dx: 220, dy: -280, delayTicks: 60 },
  ],
};

/** 강습 돌격편대 — 파쇄차 4기 밀집 돌진. 짧은 간격으로 연달아 들이받는다. */
const ASSAULT: FormationDef = {
  id: 'formation-assault',
  catalogId: FORMATION_ASSAULT,
  entryPattern: ENTRY_CHARGE,
  members: [
    { enemyTypeIndex: 0, dx: -120, dy: 0, delayTicks: 0 },
    { enemyTypeIndex: 0, dx: 120, dy: 0, delayTicks: 12 },
    { enemyTypeIndex: 0, dx: -60, dy: -120, delayTicks: 24 },
    { enemyTypeIndex: 0, dx: 60, dy: -120, delayTicks: 36 },
  ],
};

// ---------------------------------------------------------------------------
// M7c append — 신규 5종 (기획서 §5 편대 8종 표). 역할이 서로 겹치지 않게 골랐다:
//   0 물량 · 1 기본 화력 · 2 정면 돌진 · 3 회피 강요 · 4 지역 봉쇄 · 5 전열 탱킹
//   6 원거리 견제 · 7 지원(우선 격파 판단)
// 구성원은 전부 기존 ENEMY_BY_TYPE(0~21)에서 고른다 — 적 append 없음(머리말 계약 참고).
// ---------------------------------------------------------------------------

/**
 * 조류형 활공편대 — 망령 요격기(10, 최고속 돌격형) 6기가 좌우 끝에서 안쪽으로 급강하한다.
 * 궤도가 대각선이라 "가만히 서서 쏘면 반드시 스친다" — 회피 강요 담당(기획 §5 '궤도 읽기 회피').
 * 개체 내구도가 가장 낮아(hp 20) 물량 편대와 달리 **빨리 지나가는 압박**이다.
 */
const GLIDE_FLOCK: FormationDef = {
  id: 'formation-glide-flock',
  catalogId: FORMATION_GLIDE_FLOCK,
  entryPattern: ENTRY_GLIDE,
  members: [
    { enemyTypeIndex: 10, dx: -720, dy: 0, delayTicks: 0 },
    { enemyTypeIndex: 10, dx: 720, dy: 0, delayTicks: 0 },
    { enemyTypeIndex: 10, dx: -480, dy: -120, delayTicks: 15 },
    { enemyTypeIndex: 10, dx: 480, dy: -120, delayTicks: 15 },
    { enemyTypeIndex: 10, dx: -240, dy: -240, delayTicks: 30 },
    { enemyTypeIndex: 10, dx: 240, dy: -240, delayTicks: 30 },
  ],
};

/**
 * 기뢰 살포선 — 유령 수송선(15, hp240)이 앞서 흐르고 그 뒤로 **고정형** 균열(12)·연마 토템(18)
 * 4기를 넓게 깔아 통로를 봉쇄한다. 고정형은 이동 컴포넌트가 `stationary` 라 제자리에 남고
 * 스크롤이 플레이어를 그 위로 밀어 넣는다 — 이게 곧 '기뢰밭'이다(신규 엔티티 불요).
 * 느린 표류 진입이라 편대가 화면에 오래 남는 유일한 편대다.
 */
const MINE_LAYER: FormationDef = {
  id: 'formation-mine-layer',
  catalogId: FORMATION_MINE_LAYER,
  entryPattern: ENTRY_DRIFT,
  members: [
    { enemyTypeIndex: 15, dx: 0, dy: 0, delayTicks: 0 },
    { enemyTypeIndex: 12, dx: -560, dy: -160, delayTicks: 40 },
    { enemyTypeIndex: 12, dx: 560, dy: -160, delayTicks: 40 },
    { enemyTypeIndex: 18, dx: -200, dy: -260, delayTicks: 60 },
    { enemyTypeIndex: 18, dx: 200, dy: -260, delayTicks: 60 },
  ],
};

/**
 * 실드 호위편대 — 전면에 고대 파괴자(21, hp300) 2기 + 파쇄 골렘(16)이 벽을 세우고, 그 **뒤로**
 * 정밀 포탑(17, 단발 고화력) 2기가 따라온다. 진행 방향이 -Y 이므로 dy 가 더 음수인 구성원이
 * 나중에 도달한다 = 사수가 후방이다. 전열을 뚫을지 우회할지 고르게 만드는 탱킹 담당.
 */
const SHIELD_ESCORT: FormationDef = {
  id: 'formation-shield-escort',
  catalogId: FORMATION_SHIELD_ESCORT,
  entryPattern: ENTRY_STRAIGHT,
  members: [
    { enemyTypeIndex: 21, dx: -260, dy: 0, delayTicks: 0 },
    { enemyTypeIndex: 21, dx: 260, dy: 0, delayTicks: 0 },
    { enemyTypeIndex: 16, dx: 0, dy: -60, delayTicks: 12 },
    { enemyTypeIndex: 17, dx: -140, dy: -300, delayTicks: 36 },
    { enemyTypeIndex: 17, dx: 140, dy: -300, delayTicks: 36 },
  ],
};

/**
 * 저격 편대 — 수호 포대(20, 사거리 210·착탄 예고 windup 50) 2기를 축으로 한 원거리 견제.
 * 얕게 등장해 거의 내려오지 않으므로(ENTRY_SNIPE) 화면 상단에 눌러앉아 예고선을 계속 긋는다.
 * 접근하면 쉽게 부수지만 방치하면 계속 맞는 — 긴장 리듬 담당.
 */
const SNIPER_NEST: FormationDef = {
  id: 'formation-sniper-nest',
  catalogId: FORMATION_SNIPER_NEST,
  entryPattern: ENTRY_SNIPE,
  members: [
    { enemyTypeIndex: 20, dx: -600, dy: 0, delayTicks: 0 },
    { enemyTypeIndex: 20, dx: 600, dy: 0, delayTicks: 0 },
    { enemyTypeIndex: 14, dx: 0, dy: -120, delayTicks: 45 },
    { enemyTypeIndex: 17, dx: -300, dy: -240, delayTicks: 90 },
    { enemyTypeIndex: 17, dx: 300, dy: -240, delayTicks: 90 },
  ],
};

/**
 * 지원 편대 — 산란 모체(9, hp220)를 복원 드로이드(19)·냉각 정비병(13)이 따라다니며 회복시킨다.
 * 회복 사거리(240·250) 안에서만 붙으므로 "치유원을 먼저 지울지, 모체를 먼저 지울지" 라는
 * 처치 순서 판단을 강요한다. 앞선 산성 분사체(5)·서리 사수(11)는 그 판단 시간을 뺏는 견제다.
 */
const SUPPORT_ESCORT: FormationDef = {
  id: 'formation-support-escort',
  catalogId: FORMATION_SUPPORT_ESCORT,
  entryPattern: ENTRY_STRAIGHT,
  members: [
    { enemyTypeIndex: 9, dx: 0, dy: 0, delayTicks: 0 },
    { enemyTypeIndex: 5, dx: -300, dy: -140, delayTicks: 20 },
    { enemyTypeIndex: 11, dx: 300, dy: -140, delayTicks: 20 },
    { enemyTypeIndex: 19, dx: -140, dy: -300, delayTicks: 40 },
    { enemyTypeIndex: 13, dx: 140, dy: -300, delayTicks: 40 },
  ],
};

/**
 * 편대 카탈로그(풀 8종). **배열 인덱스 = catalogId, append-only.**
 * 앞 3종은 M7a 임시분이고 뒤 5종이 M7c append — 앞쪽 순서는 절대 건드리지 않는다.
 */
export const FORMATIONS: readonly FormationDef[] = [
  SCOUT_DRONES,
  INTERCEPTORS,
  ASSAULT,
  GLIDE_FLOCK,
  MINE_LAYER,
  SHIELD_ESCORT,
  SNIPER_NEST,
  SUPPORT_ESCORT,
];

/** 편대 종류 수. */
export const FORMATION_COUNT = FORMATIONS.length;

/** catalogId → 편대 정의. 범위 밖이면 undefined(호출부가 조용히 건너뛴다). */
export function formationById(catalogId: number): FormationDef | undefined {
  return FORMATIONS[catalogId];
}

// ---------------------------------------------------------------------------
// 강화 3축 → 전투력 배율 (정수 centi-percent, 100 = ×1.00)
// ---------------------------------------------------------------------------

/** 레벨 1당 가산치(cp). 레벨 99 → +490. */
export const FORMATION_LEVEL_GAIN_CP = 5;
/** 승급 1단계당 가산치(cp). 승급 5 → +125. */
export const FORMATION_ASCENSION_GAIN_CP = 25;
/** 등급 1단계당 가산치(cp). unique(3) → +60. */
export const FORMATION_RARITY_GAIN_CP = 20;

/**
 * 편대 Ref 의 강화 3축(레벨·승급·등급)을 전투력 배율로 접는다.
 * 단위는 `src/sim/invasion/constants.ts` 의 INVASION_ACCEL_*_CP 와 동일한 **100 = ×1.00** 이고,
 * 전 항이 정수 가산이라 플랫폼 간 비트 동일하다(f64 누적 없음).
 *
 * 호출부는 반드시 정규화된 Ref(정수·클램프 완료)를 넘긴다 — 정규화는 normalizeInvasionLayers.
 */
export function formationPowerCp(level: number, ascension: number, rarity: number): number {
  return (
    100 +
    (level - 1) * FORMATION_LEVEL_GAIN_CP +
    ascension * FORMATION_ASCENSION_GAIN_CP +
    rarity * FORMATION_RARITY_GAIN_CP
  );
}
