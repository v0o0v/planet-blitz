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
 * v1 에서는 보물 격실 하나뿐이다. v1 에는 워프가 모드별 좌표계(강제 스크롤 창·수축 안전
 * 반경)와 충돌한다고 보고 뱀서류 외 모드에서 후보를 빼는 `allowWarp` 게이트가 있었으나,
 * 경계 규칙이 `stepWorld` 로 모여 detour 가 구조적으로 제외되면서 근거가 사라져 **제거**됐다
 * (ADR-0034). 이제 워프 유형은 6개 행성 모드 전부에서 후보에 든다.
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

/**
 * 이 런에 조우가 출현할 확률.
 *
 * ⚠️ **2026-08-08 밸런스 확정: 0.02 → 0.20.** ADR-0033 은 "희소(≈2%)"로 잡았지만 그 값은
 * 플레이스홀더였고, 50런에 한 번은 조우가 콘텐츠로 인지되지 않는다 — 대부분의 플레이어가
 * 존재 자체를 모른 채 출시를 맞는다. 사용자 지시로 20% 로 올린다.
 * 유형별 가중치(`ENCOUNTERS`)는 손대지 않았으므로 조우가 떴을 때의 분포는 종전과 같다.
 *
 * ## ⚠️ 이것은 **예약률**이고 체감 출현률이 아니다
 * `rollEncounter` 는 런 시작에 **예약만** 만들고 실제 등장은 `spawnTick = int(1800, 9000)`
 * (30초~2.5분)에 걸린다. 런이 그 전에 끝나면 예약은 조용히 버려진다. 즉
 * **체감 = 0.20 × P(런 길이 > spawnTick)** 이고, 이 값은 20% 보다 **낮다**.
 *
 * 얼마나 낮은지는 아직 안 쟀다 — `pnpm bench:curve` 의 `clearSec` 분포로 재야 한다.
 * 참고로 의뢰서 마이그레이션 주석에 남은 `finalTick` 실측(2026-08-01, 210런)은 **p50 782틱**
 * 이지만 그것은 승리 런의 **속공 하한** 표본이라 정규 파밍 런 길이의 대표값이 아니다.
 * "5런에 한 번"이 목표라면 체감을 재고 이 값 또는 `ENCOUNTER_MIN_SPAWN_TICK` 을 되짚어야 한다.
 * TODO(밸런스): 체감률 실측 후 확정.
 *
 * ⚠️ 해시: `rollEncounter` 는 `worldRng.fork('encounter')` 한 **전용 스트림**에서 굴린다 —
 * `fork` 가 부모를 전진시키지 않으므로 확률을 바꿔도 부모 스트림은 안 밀린다(소비량 자체는
 * 미당첨 1롤 · 당첨 3롤로 갈린다 — 그 스트림 안에서만). 다만 조우가 **뜨는 런 자체가 10배로
 * 늘어**나 조우 이후의 월드 해시는 당연히 갈린다.
 */
export const ENCOUNTER_SPAWN_PROB = 0.2;
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
/**
 * **거부 대기 창**(출현 → 개시 사이에 `SPECIAL_ENCOUNTER_DECLINE` 이 먹는 틱 수).
 *
 * ⚠️ 이 상수는 연출 타이밍이 아니라 **AC5("거부/무시 런이 조우 미발생 런과 동일 결과")의
 * 성립 조건**이다. 오브젝트가 있는 유형(보물 격실·오스카 제단·봉인 수호자)은 플레이어가
 * 입력을 넣기 전까지 `state=1`(출현)에 머물러 창이 사실상 무한이지만, **인라인 유형(기록
 * 파편우·유령 보급선단)은 아무 입력도 요구하지 않아** 출현 틱에 곧바로 개시해 버린다 —
 * 같은 틱에 `maybeSpawnEncounter` 가 1 로 올리고 `stepLightEncounter` 가 2 로 올리므로
 * 거부 기회가 **1틱(1/60초)**뿐이었다. 그 상태에서 무시하면 파편 8개가 월드에 뿌려지고
 * 자동 수거 반경에 닿는 순간 `state.loot` 에 들어가, "무시했는데 결과가 달라진다".
 *
 * 그래서 인라인 2종은 출현 후 이 창이 지나야 개시한다. 창 동안 DECLINE 이 들어오면
 * `state=4` 로 끝나고 **엔티티를 단 하나도 스폰하지 않는다**. 인라인 유형의 모든 스케줄
 * (파편 간격·하드 타임아웃)은 `rt.spawnTick` 이 아니라 창이 끝난 **개시 틱** 기준이다 —
 * 창을 그냥 빼면 파편 8개가 연속 8틱에 몰려 쏟아진다. TODO(밸런스).
 */
export const ENCOUNTER_DECLINE_WINDOW_TICKS = 300;

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
