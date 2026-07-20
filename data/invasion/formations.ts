/**
 * 침공 L1 편대 카탈로그 — 임시 3종 (M7a · L3-formation 레인).
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
 *   계약이고 tests/m3Content.test.ts 가 연속성을 강제하므로, 신규 적은 M7c 에서 22 부터 append.
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

/** 진입 패턴 개수(코드 0..2). append-only. */
export const ENTRY_PATTERN_COUNT = 3;

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

/**
 * 편대 카탈로그(임시 3종). **배열 인덱스 = catalogId, append-only.**
 * M7c 풀 카탈로그(8종)는 이 뒤에 append 한다.
 */
export const FORMATIONS: readonly FormationDef[] = [SCOUT_DRONES, INTERCEPTORS, ASSAULT];

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
