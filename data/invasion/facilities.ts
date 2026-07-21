/**
 * 침공 L2 설비 카탈로그 — 9종 (M7a L4-facility 6종 + M7c C2-facility-wall 3종 append).
 *
 * 설비는 L2 회랑의 **소켓에 부착**되는 방어체다. 구 포탑 6종(src/sim/defense.ts TURRET_SPECS)
 * 과 결정적으로 다른 점 두 가지:
 *   ① **사계(arc) 제한** — 벽부착이므로 소켓이 정한 facing ± arc/2 안에 들어온 표적만 쏜다.
 *      구 포탑은 항상 전방위 `atan2(player - t)` 였다.
 *   ② **주기 온오프 해저드** — 구 해저드는 windup 1회 → active 1회로 끝나 레이저 격자의 반복
 *      토글을 표현할 수 없었다. 여기서는 주기(period)·활성(on)·예열(windup)을 데이터로 준다.
 *
 * 거동은 4갈래(`behavior`)이고 나머지는 전부 수치다 — 카탈로그 확장은 이 표에 **append** 만
 * 한다(배열 인덱스 = catalogId 계약, 재배치·중간 삽입·삭제 금지).
 *
 * 밸런스 값은 M7a 임시 추정치다. 모든 각도는 **정수 도(度)**, 모든 배율은 정수다(ADR-0005).
 *
 * i18n: 표시명은 `def3.<key>.name` / `def3.<key>.desc`(L9-garrison-catalog 소유). 이름에
 * 이모지 금지(Pixi 두부).
 */

import { HAZARD_LAVA, HAZARD_SLOW } from '../../src/sim/patterns/types.js';

// ---------------------------------------------------------------------------
// 거동 분류
// ---------------------------------------------------------------------------

/** 거동 — 방향 제한 방어포(탄 발사). */
export const FACILITY_BEHAVIOR_TURRET = 0;
/** 거동 — 기믹 해저드(주기 온오프 장판). */
export const FACILITY_BEHAVIOR_HAZARD = 1;
/** 거동 — 드론 스포너(파괴 전까지 소형 드론 생산). */
export const FACILITY_BEHAVIOR_SPAWNER = 2;
/**
 * 거동 — 압축 프레스(이동 벽). M7a 에서 M7c 로 이월된 항목이다.
 *
 * 다른 3갈래와 달리 **설비 엔티티를 만들지 않는다** — 소켓에서 회랑 안쪽으로 왕복하는
 * `wall` 엔티티(압축 판) 하나를 스폰한다(src/sim/invasion/movingWall.ts). 그래서 파괴할 수
 * 없고(정적 벽과 같은 취급), 사격·해저드 수치는 전부 0 이다.
 */
export const FACILITY_BEHAVIOR_PRESS = 3;

/** 설비 1종의 스펙. 미사용 필드는 0 이다. */
export interface FacilitySpec {
  /** i18n 키 조각(`def3.<key>.name`). */
  readonly key: string;
  /** 거동 분류(FACILITY_BEHAVIOR_*). */
  readonly behavior: number;
  /** 내구도(플레이어 탄에 파괴됨). */
  readonly hp: number;
  /** 히트박스 반지름. */
  readonly radius: number;

  // --- 방어포 ---
  /** 조준 사거리(유닛). 밖의 표적은 무시. */
  readonly range: number;
  /** 발사 간격(틱). */
  readonly fireCooldown: number;
  /** 발당 피해. */
  readonly damage: number;
  /** 탄속(유닛/초). */
  readonly bulletSpeed: number;
  /** 탄 반지름. */
  readonly bulletRadius: number;
  /** 탄 수명(틱). */
  readonly bulletLife: number;
  /** 부채꼴 발수(1 = 단발). */
  readonly pellets: number;
  /** 부채꼴 총 벌어짐(정수 도). */
  readonly spreadDeg: number;
  /**
   * 예고선 길이(틱). >0 이면 발사 전에 조준각을 **잠그고** 이 틱만큼 예고한 뒤 쏜다
   * (관통 레일포). 예고 중에는 탄이 없으므로 피해도 없다.
   */
  readonly telegraphTicks: number;

  // --- 해저드 ---
  /** 해저드 subtype(HAZARD_LAVA=피해 장판 / HAZARD_SLOW=감속 장판). */
  readonly hazardSubtype: number;
  /** 장판 반지름. */
  readonly hazardRadius: number;
  /** 주기 길이(틱). 이 주기마다 장판을 1회 융기시킨다. */
  readonly periodTicks: number;
  /** 주기 안에서 예열(예고) 틱. 이 구간에는 피해가 없다. */
  readonly windupTicks: number;
  /** 주기 안에서 활성(피해) 틱. `windup + on <= period` 이어야 한다. */
  readonly onTicks: number;
  /** 장판 틱당 피해. */
  readonly hazardDamage: number;
  /**
   * 장판을 소켓 자리에 고정할지(true), 회랑 안쪽으로 밀어 넣을지(false)의 오프셋(유닛).
   * 벽에 붙은 소켓에서 facing 방향으로 이만큼 떨어진 곳에 장판이 생긴다.
   */
  readonly hazardOffset: number;

  // --- 스포너 ---
  /** 드론 생산 간격(틱). */
  readonly spawnIntervalTicks: number;
  /** 생산할 적 typeIndex(data/enemies.ts ENEMY_BY_TYPE 인덱스). */
  readonly spawnEnemyType: number;
  /** 동시 생존 상한. 초과하면 생산을 보류한다(폭주 방지). */
  readonly spawnMaxAlive: number;
  /** 생산 지점의 facing 방향 오프셋(유닛). */
  readonly spawnOffset: number;

  // --- 압축 프레스(이동 벽) ---
  /** 압축 판의 **이동 축 방향** 반두께(유닛). 벽 AABB 의 절반 두께다. */
  readonly pressHalfAlong: number;
  /** 압축 판의 **직교 방향** 반폭(유닛). 회랑을 얼마나 가로막는지. */
  readonly pressHalfAcross: number;
  /** 소켓에서 회랑 안쪽으로 뻗는 편도 이동 거리(유닛). */
  readonly pressTravel: number;
  /** 왕복 1주기(틱). 전반은 뻗고 후반은 되돌아온다. */
  readonly pressPeriodTicks: number;
  /** 끼임(밀어낼 공간 없음) 상태의 틱당 고정 피해. */
  readonly pressCrushDamage: number;
}

/** 전 필드 0 인 기본 스펙(부분 지정용). */
const BASE = {
  range: 0,
  fireCooldown: 0,
  damage: 0,
  bulletSpeed: 0,
  bulletRadius: 0,
  bulletLife: 0,
  pellets: 0,
  spreadDeg: 0,
  telegraphTicks: 0,
  hazardSubtype: 0,
  hazardRadius: 0,
  periodTicks: 0,
  windupTicks: 0,
  onTicks: 0,
  hazardDamage: 0,
  hazardOffset: 0,
  spawnIntervalTicks: 0,
  spawnEnemyType: 0,
  spawnMaxAlive: 0,
  spawnOffset: 0,
  pressHalfAlong: 0,
  pressHalfAcross: 0,
  pressTravel: 0,
  pressPeriodTicks: 0,
  pressCrushDamage: 0,
} as const;

/**
 * 설비 카탈로그. **배열 인덱스 = catalogId**(계약 — append-only, 재배치 금지).
 * 0 번(속사포)은 기본 수비대 충원값이다(L9 결정 #22) — 인덱스를 옮기면 빈 소켓의 충원이 바뀐다.
 */
export const INVASION_FACILITIES: readonly FacilitySpec[] = [
  // 0 — 속사포: 기본 연사. 빈 소켓 자동 충원값.
  {
    ...BASE,
    key: 'fac.rapid',
    behavior: FACILITY_BEHAVIOR_TURRET,
    hp: 260,
    radius: 34,
    range: 900,
    fireCooldown: 14,
    damage: 6,
    bulletSpeed: 1200,
    bulletRadius: 8,
    bulletLife: 70,
    pellets: 1,
  },
  // 1 — 관통 레일포: 조준각을 잠그고 예고선을 그린 뒤 관통 고속탄 1발.
  {
    ...BASE,
    key: 'fac.rail',
    behavior: FACILITY_BEHAVIOR_TURRET,
    hp: 220,
    radius: 32,
    range: 1600,
    fireCooldown: 110,
    damage: 34,
    bulletSpeed: 2600,
    bulletRadius: 7,
    bulletLife: 90,
    pellets: 1,
    telegraphTicks: 36,
  },
  // 2 — 곡사 박격포: 부채꼴 다발(회랑 폭을 덮는 면 제압).
  {
    ...BASE,
    key: 'fac.mortar',
    behavior: FACILITY_BEHAVIOR_TURRET,
    hp: 300,
    radius: 36,
    range: 1100,
    fireCooldown: 64,
    damage: 8,
    bulletSpeed: 820,
    bulletRadius: 10,
    bulletLife: 110,
    pellets: 5,
    spreadDeg: 44,
  },
  // 3 — 레이저 격자: 주기 온오프. 예열 24틱 → 활성 40틱 → 휴지 56틱(주기 120).
  {
    ...BASE,
    key: 'fac.laser',
    behavior: FACILITY_BEHAVIOR_HAZARD,
    hp: 200,
    radius: 30,
    hazardSubtype: HAZARD_LAVA,
    hazardRadius: 300,
    periodTicks: 120,
    windupTicks: 24,
    onTicks: 40,
    hazardDamage: 14,
    hazardOffset: 320,
  },
  // 4 — 화염 방사구: 지속 장판(주기 = 활성이라 사실상 상시). 감속 없이 지속 피해.
  {
    ...BASE,
    key: 'fac.flame',
    behavior: FACILITY_BEHAVIOR_HAZARD,
    hp: 240,
    radius: 30,
    hazardSubtype: HAZARD_LAVA,
    hazardRadius: 220,
    periodTicks: 60,
    windupTicks: 0,
    onTicks: 60,
    hazardDamage: 5,
    hazardOffset: 240,
  },
  // 5 — 드론 사출구: 파괴 전까지 소형 드론(파쇄차, typeIndex 0)을 계속 생산.
  {
    ...BASE,
    key: 'fac.spawner',
    behavior: FACILITY_BEHAVIOR_SPAWNER,
    hp: 340,
    radius: 38,
    spawnIntervalTicks: 150,
    spawnEnemyType: 0,
    spawnMaxAlive: 3,
    spawnOffset: 120,
  },
  // -------------------------------------------------------------------------
  // M7c 확장분 (append-only — 6..8). 위 0..5 를 한 칸도 옮기지 않는다.
  // -------------------------------------------------------------------------
  // 6 — 압축 프레스: 소켓에서 회랑 안쪽으로 왕복하는 이동 벽. 사격도 장판도 없고 **공간을
  //     빼앗는다**. 파괴 불가. 두께 260u(반두께 130)는 최대 대시 스텝 59u + 프레스 최대
  //     이동 6u 를 크게 웃돌아, 스윕 판정(movingWall.ts)과 별개로 정적 여유도 남긴다.
  {
    ...BASE,
    key: 'fac.press',
    behavior: FACILITY_BEHAVIOR_PRESS,
    hp: 0, // 파괴 불가(회랑 정적 벽과 같은 취급)
    radius: 130,
    pressHalfAlong: 130,
    pressHalfAcross: 240,
    pressTravel: 620,
    pressPeriodTicks: 240,
    pressCrushDamage: 12,
  },
  // 7 — 견인 자기장: 피해 0 의 **감속 전용** 주기 장판. 화력이 아니라 회피 여유를 깎아
  //     다른 설비의 명중률을 올린다(레이저 격자·화염과 역할이 겹치지 않는다).
  {
    ...BASE,
    key: 'fac.gravwell',
    behavior: FACILITY_BEHAVIOR_HAZARD,
    hp: 210,
    radius: 30,
    hazardSubtype: HAZARD_SLOW,
    hazardRadius: 380,
    periodTicks: 180,
    windupTicks: 20,
    onTicks: 100,
    hazardDamage: 0,
    hazardOffset: 300,
  },
  // 8 — 충격파 발생기: 긴 예열(60틱) 뒤 8틱만 터지는 초고피해 광역. 상시 압박(화염)이나
  //     중간 리듬(레이저)과 달리 **한 번의 회피 타이밍**을 묻는다.
  {
    ...BASE,
    key: 'fac.shock',
    behavior: FACILITY_BEHAVIOR_HAZARD,
    hp: 190,
    radius: 28,
    hazardSubtype: HAZARD_LAVA,
    hazardRadius: 520,
    periodTicks: 300,
    windupTicks: 60,
    onTicks: 8,
    hazardDamage: 40,
    hazardOffset: 420,
  },
];

/** 카탈로그 개수(M7c 확장 후 9종). 앞으로도 **append 만** 한다. */
export const FACILITY_CATALOG_COUNT = INVASION_FACILITIES.length;

/** 압축 프레스 catalogId(M7c append 분 — 이동 벽 배선·테스트가 참조한다). */
export const PRESS_FACILITY_CATALOG_ID = 6;

/** 빈 소켓 자동 충원 catalogId(결정 #22 — 속사포 lv1 노말). */
export const GARRISON_FACILITY_CATALOG_ID = 0;

/** catalogId 로 스펙을 조회한다. 범위 밖이면 undefined(호출부가 스킵). */
export function facilitySpecFor(catalogId: number): FacilitySpec | undefined {
  return INVASION_FACILITIES[catalogId];
}

/** 감속 해저드 subtype 재수출(카탈로그 확장 시 참조 편의). */
export { HAZARD_SLOW };
