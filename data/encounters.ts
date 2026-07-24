/**
 * 조우(Encounter) 카탈로그·상수 — 런 중 opt-in 희귀 이벤트 프레임워크의 순수 데이터 층
 * (ADR-0033, 에코 신호 ADR-0023 의 일반화).
 *
 * ## 이 파일이 "순수 데이터"여야 하는 이유 (순환 방지의 핵심)
 * `src/sim/world.ts` 는 `SPECIAL_*` 입력 비트를 **재수출**하고(기존 소비자 호환),
 * `src/sim/encounter.ts` 와 `src/sim/encounterDetour.ts` 는 그 비트를 읽어 판정한다.
 * 정의를 world.ts 에 두면 encounter.ts → world.ts 런타임 import 가 생겨 순환이 된다
 * (world.ts 는 이미 encounter.ts 를 런타임 import 한다). 그래서 **정의는 여기(leaf 데이터)**
 * 에 두고 world.ts 는 얇게 re-export 만 한다. 이 파일은 다른 sim 모듈을 절대 import 하지
 * 않는다 — 이 규율이 깨지는 순간 순환이 되살아난다.
 *
 * ## 수치 규율
 * 등장률·타이머·오프셋·가중치는 **전부 플레이스홀더**다. TODO(밸런스): 출시 전 일괄 튜닝
 * 대상이며 이 파일은 구조(비트 배치·유형 id·필드 의미)만 고정한다(에코 계수 선례).
 */

// ---------------------------------------------------------------------------
// InputFrame.special 비트 배치 (APPEND-ONLY — 리플레이 wire 계약)
// ---------------------------------------------------------------------------
// 기존 점유:
//   비트 0    = SPECIAL_POWERUP_PICK (world.ts)
//   비트 1..2 = 파워업 선택 인덱스 0..3 (packPowerupPick: `(index & 0x3) << 1`)
// 조우는 그래서 **비트 3 부터** 쓴다. 이미 기록된 리플레이의 special 값이 새 의미로
// 재해석되면 서버 재검증이 갈리므로, 아래 비트는 재배치·재사용을 절대 금지한다.

/** 조우 오브젝트(포탈 등) 진입 의사. 포탈 근접 + 이 비트 = 보물 격실 detour 진입. */
export const SPECIAL_ENCOUNTER_ENTER = 1 << 3;
/** 조우 거부(무시하고 런 계속). 이 프레임 이후 해당 조우는 다시 열리지 않는다. */
export const SPECIAL_ENCOUNTER_DECLINE = 1 << 4;
/** 오스카 제단 3택 선택 표식. 선택 인덱스는 비트 6..7 에 실린다(아래 packEncounterAltar). */
export const SPECIAL_ENCOUNTER_ALTAR_PICK = 1 << 5;
// 비트 6..7 = 제단 선택 인덱스(0..3). ALTAR_PICK 과 한 프레임에 실린다.
/**
 * detour 조기 이탈(가진 것 보존). 비트 6..7 이 제단 인덱스에 예약돼 있으므로 **비트 8**
 * 이다 — 5 다음이 8 인 것은 실수가 아니라 인덱스 필드를 건너뛴 결과다.
 */
export const SPECIAL_ENCOUNTER_EXIT = 1 << 8;

/**
 * 오스카 제단 3택 선택(index 0..3)을 input `special` 값으로 포장한다. `packPowerupPick`
 * 선례와 동형이지만 인덱스 자리가 비트 6..7 이다(파워업은 1..2). 4번째 슬롯까지 와이어
 * 호환되게 2비트를 쓴다 — 3택이 4택으로 늘어도 리플레이 포맷이 안 바뀐다.
 */
export function packEncounterAltar(index: number): number {
  return SPECIAL_ENCOUNTER_ALTAR_PICK | ((index & 0x3) << 6);
}

// ---------------------------------------------------------------------------
// 조우 유형 카탈로그
// ---------------------------------------------------------------------------

/**
 * 조우 유형 id. **해시·리플레이 계약**이므로 재번호 금지(append-only, KIND_CODE 선례).
 * `EncounterRuntime.type` 에 그대로 실려 hashWorld 가 접는다.
 *  - treasureVault  보물 격실: 포탈 진입 → 별도 보너스 공간 detour(유일한 warp 유형)
 *  - oscarAltar     오스카 제단: 3택 도박(즉시 전리품 / 드랍·광물 부스트 / 봉인 상자)
 *  - sealedGuardian 봉인 수호자: 라이브 런 위 오버레이 미니 보스(detour 아님)
 *  - shardRain      기록 파편우: 인라인 파편 스폰
 *  - ghostConvoy    유령 보급선단: 인라인 보급선(spawnSupply 선례)
 */
export const ENCOUNTER_TYPE = {
  treasureVault: 1,
  oscarAltar: 2,
  sealedGuardian: 3,
  shardRain: 4,
  ghostConvoy: 5,
} as const;

export type EncounterType = (typeof ENCOUNTER_TYPE)[keyof typeof ENCOUNTER_TYPE];

/** 조우 결(bucket) — ADR-0033 1차 3분류. 가중·연출 그룹화용 정수. */
export const ENCOUNTER_BUCKET = {
  /** 탐욕 수집형(보물 격실·파편우·보급선단). */
  greed: 0,
  /** 도박 선택형(오스카 제단). */
  gamble: 1,
  /** 전투 도전형(봉인 수호자). */
  combat: 2,
} as const;

/**
 * 조우 유형 정의. `warp: true` 는 **플레이어 좌표를 워프하는 detour 유형**이라는 뜻이고,
 * v1 에서는 보물 격실 하나뿐이다. 워프는 모드별 좌표계(강제 스크롤 창·수축 안전 반경·
 * 추격 포식자)와 구조적으로 충돌하므로 `rollEncounter(rng, allowWarp)` 의 `allowWarp=false`
 * 에서 후보에서 통째로 빠진다(ADR-0033 Principle 5 · 계획 R2).
 */
export interface EncounterDef {
  /** ENCOUNTER_TYPE 값. */
  readonly id: number;
  /** ENCOUNTER_BUCKET 값. */
  readonly bucket: number;
  /** 가중 롤에서의 상대 가중치(정수). TODO(밸런스). */
  readonly weight: number;
  /** 플레이어 좌표를 워프하는 detour 유형인가. v1 은 보물 격실만 true. */
  readonly warp: boolean;
}

/**
 * 조우 유형 카탈로그. **배열 순서가 가중 롤의 순회 순서**라 해시 계약이다 — 재배치 금지,
 * 신규 유형은 꼬리에 append. 가중치는 전부 플레이스홀더. TODO(밸런스).
 */
export const ENCOUNTERS: readonly EncounterDef[] = [
  { id: ENCOUNTER_TYPE.treasureVault, bucket: ENCOUNTER_BUCKET.greed, weight: 30, warp: true },
  { id: ENCOUNTER_TYPE.oscarAltar, bucket: ENCOUNTER_BUCKET.gamble, weight: 20, warp: false },
  { id: ENCOUNTER_TYPE.sealedGuardian, bucket: ENCOUNTER_BUCKET.combat, weight: 20, warp: false },
  { id: ENCOUNTER_TYPE.shardRain, bucket: ENCOUNTER_BUCKET.greed, weight: 15, warp: false },
  { id: ENCOUNTER_TYPE.ghostConvoy, bucket: ENCOUNTER_BUCKET.greed, weight: 15, warp: false },
];

// ---------------------------------------------------------------------------
// 롤 파라미터 (전부 플레이스홀더 — TODO(밸런스))
// ---------------------------------------------------------------------------

/** 이 런에 조우가 출현할 확률. ADR-0033 이 못박은 "희소(≈2%)". TODO(밸런스). */
export const ENCOUNTER_SPAWN_PROB = 0.02;
/** 스폰 가능 최소 틱(런 초반 배제, 60fps 기준 30초). TODO(밸런스). */
export const ENCOUNTER_MIN_SPAWN_TICK = 1800;
/** 스폰 가능 최대 틱(int 롤 상한, 60fps 기준 2.5분). TODO(밸런스). */
export const ENCOUNTER_MAX_SPAWN_TICK = 9000;
/** 조우 오브젝트를 플레이어 곁에 놓을 고정 오프셋(난수·삼각함수 없음). TODO(밸런스). */
export const ENCOUNTER_SPAWN_OFFSET = 540;
/** 조우 오브젝트(포탈·제단)의 렌더/풋프린트 반경. inert — 충돌 판정엔 쓰지 않는다. TODO(밸런스). */
export const ENCOUNTER_OBJECT_RADIUS = 120;
/** 조우 오브젝트 상호작용(진입/선택) 판정 반경. 이 안에서만 special 비트가 먹는다. TODO(밸런스). */
export const ENCOUNTER_INTERACT_RADIUS = 320;

// ---------------------------------------------------------------------------
// 보물 격실 detour 상수 (전부 플레이스홀더 — TODO(밸런스))
// ---------------------------------------------------------------------------

/** 격실 체류 제한 틱(만료 시 자동 이젝트, 60fps 기준 45초). TODO(밸런스). */
export const VAULT_TIMER_TICKS = 2700;
/**
 * 워프 오프셋(월드 유닛). **메인 탄 컬 반경(PROJECTILE_CULL_RADIUS ≈ 2,400)보다 훨씬 커야
 * 한다** — 워프 순간 메인 월드에 떠 있던 적탄이 다음 판정에서 자연 소멸(컬링)되지 않으면
 * 복귀 시 눈앞에 그대로 남아 억울한 피격이 된다. 메인 적은 stepDetour 단일 분기가 아예
 * 돌리지 않아 프리즈되므로(AC6) 거리와 무관하지만, 탄은 거리로 처리한다. TODO(밸런스).
 */
export const VAULT_WARP_OFFSET_X = 120000;
export const VAULT_WARP_OFFSET_Y = 120000;

/** 안전지대 전리품 개수(입구 — 자유 수집). TODO(밸런스). */
export const VAULT_SAFE_LOOT_COUNT = 3;
/** 안전지대 전리품 등급 코드(0 normal .. 3 unique). TODO(밸런스). */
export const VAULT_SAFE_LOOT_RARITY = 1;
/** 안전지대 전리품 배치 간격(포켓 중심 기준 X 오프셋 스텝). TODO(밸런스). */
export const VAULT_SAFE_LOOT_SPACING = 220;
/** 안전지대 전리품 배치 Y 오프셋(포켓 중심 기준, 입구쪽). TODO(밸런스). */
export const VAULT_SAFE_LOOT_Y = -260;

/** 위험지대 확정 고희귀 전리품 개수. ADR-0033 "확정 고희귀 장비 1개". TODO(밸런스). */
export const VAULT_PRIZE_LOOT_COUNT = 1;
/** 위험지대 전리품 등급 코드(고희귀). TODO(밸런스). */
export const VAULT_PRIZE_LOOT_RARITY = 3;
/** 위험지대 전리품 Y 오프셋(포켓 중심 기준, 안쪽 깊숙이). TODO(밸런스). */
export const VAULT_PRIZE_LOOT_Y = 900;

/** 위험지대를 지키는 경비 적 수. TODO(밸런스). */
export const VAULT_GUARD_COUNT = 4;
/** 경비 적 HP. TODO(밸런스). */
export const VAULT_GUARD_HP = 260;
/** 경비 적 접촉 피해. TODO(밸런스). */
export const VAULT_GUARD_DAMAGE = 12;
/** 경비 적 반경. TODO(밸런스). */
export const VAULT_GUARD_RADIUS = 34;
/** 경비 적 추적 속도(units/second). TODO(밸런스). */
export const VAULT_GUARD_SPEED = 240;
/** 경비 적 배치 Y 오프셋(포켓 중심 기준 — 전리품 앞을 막는 줄). TODO(밸런스). */
export const VAULT_GUARD_Y = 620;
/** 경비 적 배치 X 간격. TODO(밸런스). */
export const VAULT_GUARD_SPACING = 200;

/** 경비 적 1기 처치 시 지급되는 크레딧(정산 경제 — 전투력 무개입). TODO(밸런스). */
export const VAULT_GUARD_CREDITS = 2;
/** 경비 적 1기 처치 시 떨구는 전리품 등급 코드. TODO(밸런스). */
export const VAULT_GUARD_LOOT_RARITY = 0;
/** 격실 전리품 픽업 반경(접촉 자동 수거). TODO(밸런스). */
export const VAULT_LOOT_PICKUP_RADIUS = 44;
