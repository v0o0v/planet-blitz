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
  /** 생산 지점의 facing 방향 오프셋(유닛). **스크롤 축이 없는 경로 전용**(카탈로그 5번 주석). */
  readonly spawnOffset: number;
  /**
   * 사출 드론의 기본 내구도(0 = 로스터 `EnemyDef.hp` 그대로). 강화 3축은 이 값에 곱해진다.
   *
   * 방어 설비의 사출 드론은 같은 typeIndex 의 야생 개체보다 단단해야 한다 — 실측에서 로스터
   * 기본값(파쇄차 34)은 참조봇 화력에 **평균 800유닛 밖에서 전멸**해 접촉 자체가 일어나지
   * 않았고, 그래서 레벨을 올려도 lv17 까지 누적 피해가 0 이었다.
   */
  readonly spawnDroneHp: number;

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
  spawnDroneHp: 0,
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
  // 1 — 관통 레일포: 조준각을 잠그고 예고선을 그린 뒤 굵은 관통 고속탄 1발.
  //
  //     ⚠️ lv1~lv99 전 구간 L2 누적 피해가 **0** 이던 설비다(2026-07-27 실측). 근인은 명중률
  //     저하가 아니라 기하다 — 예고 36틱 + 사거리 1600 의 비행 37틱 동안 표적이 470유닛
  //     움직이는데 히트 창은 탄 반경 7 + 플레이어 판정점 8 = **15유닛**이었다. 실측 최소
  //     접근 거리 331유닛(24시드 · 144발 전량이 그 밖). 세 축을 함께 옮겨 살렸다:
  //       · 조준 — `telegraphLeadAngle` + 예고 전용 흔들림(sim). 앞을 겨누고 발마다 어긋낸다.
  //       · 예고 32틱 — 36 에서 소폭만 줄였다. **의도(회피 가능한 강타)는 그대로다.**
  //       · 사거리 1200 · 탄 반경 60 — 비행 시간을 줄이고 히트 창을 68유닛으로 넓힌다.
  //         반경 40 초과는 `muzzleOffset`(sim)이 총구 밖으로 내보내야 성립한다 — 소켓(y=±500)과
  //         회랑 벽 안쪽 면(y=±540) 사이 여유가 40뿐이라, 그 처리가 없으면 굵은 탄이 자기 벽에
  //         즉사해 발사 수가 **0** 이 된다(실측: r=24 는 144발, r=40 은 0발).
  //     발당 피해·연사는 원본 그대로다(34 / 110틱).
  {
    ...BASE,
    key: 'fac.rail',
    behavior: FACILITY_BEHAVIOR_TURRET,
    hp: 220,
    radius: 32,
    range: 1200,
    fireCooldown: 110,
    damage: 34,
    bulletSpeed: 2600,
    bulletRadius: 60,
    bulletLife: 90,
    pellets: 1,
    telegraphTicks: 32,
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
  // 5 — 드론 사출구: 플레이어가 활성 사거리 안에 있는 동안 소형 드론(파쇄차, typeIndex 0)을
  //     **회랑 전방으로** 사출한다.
  //
  //     ⚠️ 사출 지점은 소켓 옆이 아니라 **스크롤 창 진행 방향 앞**이다(2026-07-28 재설계).
  //     예전에는 소켓 옆(`spawnOffset`)에 낳았는데, L2 강제 스크롤 720 u/s 가 로스터 최고 적
  //     이동 속도 420 u/s 보다 빨라 드론이 **구조적으로 영원히 못 따라붙었다** — 24시드에
  //     1,327기를 낳고도 L2 누적 피해가 12(사실상 0)였고 lv1~lv99 전 구간이 평탄했다.
  //     정본은 `.omc/research/invasion-spawner-redesign-2026-07-28.md`.
  //     → `spawnOffset` 은 이제 **스크롤 축이 없는 경로**(고정 카메라·단위 테스트) 전용이다.
  //
  //     `range` 는 방어포와 같은 활성 사거리다. 이게 없으면 회랑을 20,000유닛 지나친 뒤에도
  //     사출이 계속돼(레이어 예산 5,400틱 중 플레이어가 회랑 안에 있는 시간은 17%뿐이다)
  //     소켓과의 공간 인과가 끊긴다.
  {
    ...BASE,
    key: 'fac.spawner',
    behavior: FACILITY_BEHAVIOR_SPAWNER,
    hp: 340,
    radius: 38,
    range: 2600,
    spawnIntervalTicks: 150,
    spawnEnemyType: 0,
    spawnMaxAlive: 3,
    spawnOffset: 120,
    spawnDroneHp: 75,
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
    //
    //      ⚠️ **이 설비만 `hazardDamage` 가 0 이다.** 실효 스탯 파생(`resolveFacilityStats`)은
    //      해저드의 강화 3축을 `hazardDamage` 한 곳에만 싣기 때문에, 예전에는 레벨·등급·승급이
    //      바꾸는 것이 **내구도뿐**이었고 그래서 축이 **역전**돼 있었다(96시드 감속 비율
    //      12.71% → 8.36%). 지금은 `src/sim/invasion/facility.ts` 의 **효용 해저드** 경로가
    //      감속 지속 · `onTicks` · `hazardRadius` 에 3축을 태운다(12.71% → 20.14%).
    //      상세는 `.omc/research/invasion-gravwell-slow-axis-2026-07-27.md`.
    //      → **`hazardDamage` 를 0 이 아닌 값으로 바꾸면 그 경로가 통째로 꺼진다.**
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
  // 8 — 충격파 발생기: 긴 예열(60틱) 뒤 짧게 터지는 고피해 광역. 상시 압박(화염)이나
  //     중간 리듬(레이저)과 달리 **한 번의 회피 타이밍**을 묻는다.
  //
  //     ⚠️ `onTicks`·`hazardDamage` 는 밸런스 손잡이가 아니라 **강화축의 생사를 가르는 값**이다
  //     (`.omc/research/invasion-nonmonotonic-hazards-2026-07-27.md`). 예전 값 8틱 · 40피해는
  //     두 가지를 동시에 깼다:
  //       ① **즉사 포화** — 3축(레벨·등급·승급)을 태운 실효 피해가 시드 램프 nn≥15 에서 161~254
  //          가 되어 참조 플레이어 최대 HP **160** 을 넘었다. 그 위로는 161 이나 254 나 똑같이
  //          접촉 즉사라 **강화축이 아무 일도 하지 않는다.**
  //       ② **표본 붕괴** — 활성 듀티가 8/300 = 2.7% 라 96시드에서도 피격 틱이 24~68 개뿐이었다.
  //          그래서 "레벨을 올렸는데 누적 피해가 줄어드는" 비단조가 관측됐다.
  //     듀티를 3배로 넓히고 발당 피해를 그만큼 내려 **lv1 출력은 그대로 두고**(96시드 2560 →
  //     2552) 축만 되살렸다: lv99 4070 → **7914** · 사망 시드 24 → **46**(96 중).
  //     피격 무적창(`hitIframes` 40틱)이 `onTicks` 보다 여전히 길어 **주기당 최대 1히트**라는
  //     "한 번의 회피 타이밍" 정체성은 보존된다 — 넓어진 것은 붙잡히는 창뿐이다.
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
    onTicks: 24,
    hazardDamage: 22,
    hazardOffset: 420,
  },
  // -------------------------------------------------------------------------
  // Lane9 append (append-only — 9..16). 위 0..8 을 한 칸도 옮기지 않는다.
  //   톡사르(부식·중독) = 지속 해저드 계열 9..12 · 크라스(파괴·관통) = 고화력 방어포 13..16.
  //   전 수치 플레이스홀더(// TODO(밸런스)) — 거동은 기존 4갈래 재사용(신규 sim 축 없음).
  // -------------------------------------------------------------------------
  // 9 — 부식 분사구(톡사르): 벽 안쪽에 꺼지지 않는 산성 장판을 계속 뿜는다(화염 방사구 계열).
  {
    ...BASE,
    key: 'fac.venomvent',
    behavior: FACILITY_BEHAVIOR_HAZARD,
    hp: 240, // TODO(밸런스)
    radius: 30, // TODO(밸런스)
    hazardSubtype: HAZARD_LAVA,
    hazardRadius: 240, // TODO(밸런스)
    periodTicks: 60, // TODO(밸런스)
    windupTicks: 0,
    onTicks: 60, // TODO(밸런스)
    hazardDamage: 6, // TODO(밸런스)
    hazardOffset: 240, // TODO(밸런스)
  },
  // 10 — 오염 늪(톡사르): 피해 낮은 감속 전용 주기 장판(HAZARD_SLOW). 회피 여유를 깎아 다른
  //      부식 장판의 명중을 올린다.
  {
    ...BASE,
    key: 'fac.blightpool',
    behavior: FACILITY_BEHAVIOR_HAZARD,
    hp: 210, // TODO(밸런스)
    radius: 30, // TODO(밸런스)
    hazardSubtype: HAZARD_SLOW,
    hazardRadius: 340, // TODO(밸런스)
    periodTicks: 180, // TODO(밸런스)
    windupTicks: 20, // TODO(밸런스)
    onTicks: 120, // TODO(밸런스)
    hazardDamage: 2, // TODO(밸런스)
    hazardOffset: 300, // TODO(밸런스)
  },
  // 11 — 부식 안개(톡사르): 넓게 퍼지는 저피해 주기 장판. 예열 뒤 회랑 폭을 오래 덮는다.
  {
    ...BASE,
    key: 'fac.corrosivemist',
    behavior: FACILITY_BEHAVIOR_HAZARD,
    hp: 200, // TODO(밸런스)
    radius: 30, // TODO(밸런스)
    hazardSubtype: HAZARD_LAVA,
    hazardRadius: 360, // TODO(밸런스)
    periodTicks: 150, // TODO(밸런스)
    windupTicks: 30, // TODO(밸런스)
    onTicks: 60, // TODO(밸런스)
    hazardDamage: 4, // TODO(밸런스)
    hazardOffset: 320, // TODO(밸런스)
  },
  // 12 — 독성 연사포(톡사르): 근거리를 빠르게 훑는 저피해 연사 방어포(속사포 계열).
  {
    ...BASE,
    key: 'fac.toxinturret',
    behavior: FACILITY_BEHAVIOR_TURRET,
    hp: 250, // TODO(밸런스)
    radius: 34, // TODO(밸런스)
    range: 900, // TODO(밸런스)
    fireCooldown: 18, // TODO(밸런스)
    damage: 5, // TODO(밸런스)
    bulletSpeed: 1100, // TODO(밸런스)
    bulletRadius: 8, // TODO(밸런스)
    bulletLife: 70, // TODO(밸런스)
    pellets: 1,
  },
  // 13 — 중장 레일포(크라스): 조준을 잠그고 예고선을 그은 뒤 초고피해 관통탄 1발(관통 레일포 계열).
  //      전 구간 0 이던 이유·복구 근거는 위 1번(관통 레일포) 주석과 동일하다. 예고가 더 길고
  //      (36틱) 발당 피해가 무겁다 — 계열 차별화는 그대로 두고 기하만 사격 가능 범위로 옮겼다.
  {
    ...BASE,
    key: 'fac.heavyrail',
    behavior: FACILITY_BEHAVIOR_TURRET,
    hp: 220, // TODO(밸런스)
    radius: 32, // TODO(밸런스)
    range: 1200,
    fireCooldown: 120, // TODO(밸런스)
    damage: 40, // TODO(밸런스)
    bulletSpeed: 2600, // TODO(밸런스)
    bulletRadius: 60, // 40 초과 = 총구 오프셋 경로(위 1번 주석)
    bulletLife: 90, // TODO(밸런스)
    pellets: 1,
    telegraphTicks: 36,
  },
  // 14 — 공성 주포(크라스): 느리지만 무거운 단발 고화력 포격.
  //
  //      ⚠️ 전 구간 0 이던 설비다. 예고선은 없지만 근인은 같은 계열이다 — 탄속 1000(=17유닛/틱)
  //      으로 사거리 1200 을 날면 비행만 72틱이라, 조준 흔들림(PR#161)을 얹어도 표적이 그 사이
  //      1000유닛 가까이 이동한다. 실측 최소 접근 거리 45유닛 대 히트 창 20유닛(탄 반경 12 +
  //      판정점 8) — 아깝게 빗나가는 것이 아니라 **항상** 빗나갔다.
  //      복구: 사거리 1200 → 800(비행 시간 절반) · 탄속 1000 → 1800 · 탄 반경 12 → 20.
  //      "느리고 무거운 한 방"이라는 성격은 연사(80틱)와 발당 피해로 유지한다.
  {
    ...BASE,
    key: 'fac.siegecannon',
    behavior: FACILITY_BEHAVIOR_TURRET,
    hp: 320, // TODO(밸런스)
    radius: 36, // TODO(밸런스)
    range: 800,
    fireCooldown: 80, // TODO(밸런스)
    damage: 30, // TODO(밸런스)
    bulletSpeed: 1800,
    bulletRadius: 20,
    bulletLife: 120, // TODO(밸런스)
    pellets: 1,
  },
  // 15 — 돌파 산탄포(크라스): 중간 화력의 부채꼴 다발로 회랑 면을 제압한다.
  {
    ...BASE,
    key: 'fac.breachturret',
    behavior: FACILITY_BEHAVIOR_TURRET,
    hp: 270, // TODO(밸런스)
    radius: 34, // TODO(밸런스)
    range: 1000, // TODO(밸런스)
    fireCooldown: 50, // TODO(밸런스)
    damage: 12, // TODO(밸런스)
    bulletSpeed: 1200, // TODO(밸런스)
    bulletRadius: 9, // TODO(밸런스)
    bulletLife: 90, // TODO(밸런스)
    pellets: 3, // TODO(밸런스)
    spreadDeg: 30, // TODO(밸런스)
  },
  // 16 — 파괴 폭뢰기(크라스): 긴 예열 뒤 짧게 터지는 고피해 광역(충격파 발생기 계열).
  //      `onTicks`·`hazardDamage` 의 근거는 8번(충격파 발생기) 주석과 같다 — 예전 값 10틱 ·
  //      42피해는 3축을 태우면 169~265 로 참조 플레이어 최대 HP 160 을 넘어 즉사 포화였고,
  //      듀티 3.3% 라 표본도 붕괴했다. 듀티 3배 · 발당 피해 하향으로 lv1 출력을 유지한 채
  //      (96시드 2856 → 2806) 축을 되살렸다: lv99 4070 → **8403** · 사망 시드 24 → **49**.
  {
    ...BASE,
    key: 'fac.demolisher',
    behavior: FACILITY_BEHAVIOR_HAZARD,
    hp: 200, // TODO(밸런스)
    radius: 28, // TODO(밸런스)
    hazardSubtype: HAZARD_LAVA,
    hazardRadius: 500, // TODO(밸런스)
    periodTicks: 300, // TODO(밸런스)
    windupTicks: 60, // TODO(밸런스)
    onTicks: 30,
    hazardDamage: 23,
    hazardOffset: 420, // TODO(밸런스)
  },
];

/** 카탈로그 개수(M7c 확장 후 9종). 앞으로도 **append 만** 한다. */
export const FACILITY_CATALOG_COUNT = INVASION_FACILITIES.length;

/** 압축 프레스 catalogId(M7c append 분 — 이동 벽 배선·테스트가 참조한다). */
export const PRESS_FACILITY_CATALOG_ID = 6;

/** 빈 소켓 자동 충원 catalogId(결정 #22 — 속사포 lv1 노말). */
export const GARRISON_FACILITY_CATALOG_ID = 0;

/**
 * 드론 스포너 catalogId. **L2 의 유일한 이동 적 공급원**이라 밀도 축이 직접 참조한다
 * (`src/sim/invasion/density.ts` `l2GarrisonSpawners`).
 *
 * 밴드 램프의 설비 선택이 `catalogId = (i + shift) % kinds` 라 이 id 가 창에 걸릴 때만
 * 스포너가 1기 들어온다 — 그래서 구 밸런스에서 L2 동시 이동 적이 밴드에 따라 "0 아니면 3"
 * 이었다. 빈 소켓 충원이 이 id 를 우선 쓰는 것이 그 바닥을 메우는 축이다.
 */
export const SPAWNER_FACILITY_CATALOG_ID = 5;

/** catalogId 로 스펙을 조회한다. 범위 밖이면 undefined(호출부가 스킵). */
export function facilitySpecFor(catalogId: number): FacilitySpec | undefined {
  return INVASION_FACILITIES[catalogId];
}

/** 감속 해저드 subtype 재수출(카탈로그 확장 시 참조 편의). */
export { HAZARD_SLOW };
