/**
 * 유니크 고유 효과 — 시뮬 게이트 상수·순수 헬퍼 (M2 plan F1, AC7).
 *
 * Lane 1이 깐 배선: 장착 유니크의 `bit`이 `LoadoutConfig.uniqueMask`에 OR되고
 * (src/items/loadout.ts), 시뮬은 `config.loadout.uniqueMask`를 읽어 거동을 게이트
 * 한다. 이 모듈은 그 비트 인덱스와 튜닝 상수, 순수 판정 헬퍼만 담는다(leaf — 다른
 * 시뮬 모듈에 의존하지 않음). 실제 훅은 world.ts의 각 단계(autoAttack·stepPlayer·
 * resolveCollisions 등)에서 이 상수를 읽어 적용한다.
 *
 * 비트 값은 data/uniques.ts의 UniqueDef 등록과 반드시 일치한다(데이터가 이 상수를
 * import). 절대 재번호 금지 — uniqueMask는 해시에 접힌다(replay.ts).
 *
 * 결정론(ADR-0005): 모든 효과는 정수/고정 산술·기존 결정론 필드만 사용하며 RNG를
 * 새로 뽑지 않는다. 신규 WorldState 필드도 추가하지 않는다 — 각 효과는 이미 해시되는
 * 미사용 엔티티 필드(player.phase·player.ownerId·bullet.phase·bullet.ownerId)를
 * 재활용하므로 hashWorld 레이아웃이 불변이다.
 */

// --- 비트 인덱스 (data/uniques.ts와 일치) ---------------------------------
/** 과열 드럼(발칸): 연속 명중마다 발사속도 스택↑, 피격 시 리셋. */
export const UQ_OVERHEAT_DRUM = 0;
/** 분열 코어(스프레드): 탄 명중 시 파편 2발 분열. */
export const UQ_SPLIT_CORE = 1;
/** 관통 자이로(레일건): 관통 무제한 + 관통당 피해 증폭. */
export const UQ_PIERCE_GYRO = 2;
/** 자율 드론 베이(보조무기): 주기적으로 임시 포탑 소환. */
export const UQ_DRONE_BAY = 3;
/** 위상 장갑(장갑): 대시 직후 짧은 무적 + 대시 쿨다운 감소. */
export const UQ_PHASE_ARMOR = 4;
// --- M3 유니크 10점(plan B4, bit 5~14; 절대 재번호 금지 — 해시 접힘) ---
/** 군집 벌통(주무기·미사일): 미사일 격추 시 마이크로 미사일 분열(weaponType 3 의존). */
export const UQ_HIVE_SWARM = 5;
/** 수렴 프리즘(주무기·빔): 관통 적 수만큼 빔 폭·피해 증가(weaponType 4 의존). */
export const UQ_CONVERGE_PRISM = 6;
/** 쌍둥이 항성(주무기·스프레드): 발사체 2배·피해 -30%(발사 로직 = Lane1/Lane4 통합). */
export const UQ_TWIN_STAR = 7;
/** 특이점 발생기(보조무기): 소형 중력장 — 주변 적을 플레이어로 흡인. */
export const UQ_SINGULARITY = 8;
/** 반응 장갑(장갑): 피격 시 방사형 반격 펄스(아군탄). */
export const UQ_REACTIVE_ARMOR = 9;
/** 위상 전환막(실드): 저체력 진입 시 광역 폭발 + 절반 회복(내부 쿨다운). */
export const UQ_PHASE_MEMBRANE = 10;
/** 잔상 추진기(엔진): 대시 시 주변 적탄 소거. */
export const UQ_AFTERIMAGE = 11;
/** 탐욕의 심장(코어): 젬 획득마다 콤보 지속 연장 + 자석 반경 스택. */
export const UQ_GREED_HEART = 12;
/** 도박사의 칩(모듈): 파워업 선택지 +1(파워업 레이어 = Lane1 통합). */
export const UQ_GAMBLER_CHIP = 13;
/** 유물 증폭기(모듈): 경험치·자석·유니크 드랍률 소폭↑. */
export const UQ_RELIC_AMP = 14;

/** uniqueMask에 `bit`이 켜져 있는지. */
export function hasUnique(mask: number, bit: number): boolean {
  return (mask & (1 << bit)) !== 0;
}

// --- ① 과열 드럼 ------------------------------------------------------------
/** 스택당 발사 쿨다운 감소율(누적). */
export const OVERHEAT_STEP = 0.06;
/** 최대 스택(발사 쿨다운 감소 상한). */
export const OVERHEAT_MAX_STACK = 8;

/** 스택 수에 따른 유효 발사 쿨다운(최소 2틱 보장, 정수). */
export function overheatCooldown(base: number, stacks: number): number {
  const s = stacks < OVERHEAT_MAX_STACK ? stacks : OVERHEAT_MAX_STACK;
  const cd = Math.round(base * (1 - s * OVERHEAT_STEP));
  return cd < 2 ? 2 : cd;
}

// --- ② 분열 코어 ------------------------------------------------------------
/** 명중 시 분열하는 파편 수. */
export const SPLIT_FRAGMENTS = 2;
/** 파편 측면 분산 각(라디안, 진행 방향 기준 ±). */
export const SPLIT_SPREAD = 0.7;
export const SPLIT_FRAGMENT_SPEED = 1200;
export const SPLIT_FRAGMENT_LIFE = 26;
export const SPLIT_FRAGMENT_RADIUS = 4;
/**
 * 파편 아군탄 마커: bullet.ownerId에 저장해 파편이 또 분열하는 무한 연쇄를 막는다
 * (원본 아군탄은 ownerId 0). 큰 상수라 실제 엔티티 id와 충돌하지 않는다.
 */
export const SPLIT_FRAGMENT_MARK = 0xf12a6;

// --- ③ 관통 자이로 ----------------------------------------------------------
/** 관통 1회당 피해 증가율(누적, bullet.phase가 관통 횟수). */
export const GYRO_DAMAGE_AMP = 0.25;

// --- ④ 자율 드론 베이 -------------------------------------------------------
/** 드론(임시 포탑) 소환 주기(틱): 8초. */
export const DRONE_INTERVAL = 480;
/** 플레이어로부터 드론 스폰 오프셋(월드 유닛). */
export const DRONE_SPAWN_OFFSET = 120;
/**
 * 드론(유니크 소환 포탑) 마커: 드론 엔티티의 ownerId에 저장해 청크 기믹(turretPickup)과
 * 구분한다. 청크 배치 포탑의 ownerId는 항상 0이므로, isGimmick이 이 마커를 가진
 * turretPickup을 기믹 분류에서 제외 → MAX_ACTIVE_GIMMICKS 카운트·청크 컬링 대상에서 빠지고
 * TURRET_LIFE_TICKS 수명만 따른다. 큰 상수라 실제 엔티티 id와 충돌하지 않는다(이미 해시됨).
 */
export const DRONE_MARK = 0xd4090e;

// --- ⑤ 위상 장갑 ------------------------------------------------------------
/** 대시 무적 프레임 보너스(기본 dashIframes에 가산). */
export const PHASE_ARMOR_BONUS_IFRAMES = 16;
/** 대시 쿨다운 배율(< 1 = 더 빨리 충전). */
export const PHASE_ARMOR_DASH_CD_MULT = 0.7;

// --- ⑤ 군집 벌통(주무기·미사일) --------------------------------------------
// 미사일(weaponType 3)이 적을 격추하는 순간 격추 위치에서 마이크로 미사일을 방사한다.
// M3 통합(Lane1 미사일 실재)에서 시뮬 훅 연결. 마이크로탄은 유도하지 않고(HIVE_MICRO_MARK
// ≠ MISSILE_MARK) 재분열도 하지 않아(트리거는 MISSILE_MARK 원본만) 무한 연쇄가 없다.
/** 격추 1회당 방사하는 마이크로 미사일 수. */
export const HIVE_MICRO_COUNT = 4;
export const HIVE_MICRO_SPEED = 900;
export const HIVE_MICRO_LIFE = 22;
export const HIVE_MICRO_RADIUS = 4;
/** 마이크로 미사일 피해 = 주무기 피해 × 이 비율. */
export const HIVE_MICRO_DAMAGE_FRAC = 0.4;
/**
 * 마이크로 미사일 마커(bullet.ownerId). MISSILE_MARK/SPLIT_FRAGMENT_MARK/DRONE_MARK/
 * 어느 것과도 겹치지 않는 큰 상수 → 유도 로직·재분열 트리거에서 자연히 제외되고 실제
 * 엔티티 id와도 충돌하지 않는다(이미 해시되는 필드 재활용, hashWorld 레이아웃 불변).
 */
export const HIVE_MICRO_MARK = 0x81ce77;

// --- ⑥ 수렴 프리즘(주무기·빔) ----------------------------------------------
// 빔(weaponType 4) 세그먼트가 관통한 적 수(bullet.phase)에 비례해 피해가 증폭된다.
// 관통 자이로(③)와 동일한 phase-누적 재활용 패턴 — 둘 다 주무기 슬롯이라 동시 장착 불가.
/** 빔 세그먼트가 관통한 적 1기당 누적 피해 증가율. */
export const PRISM_DAMAGE_AMP = 0.2;

// --- ⑦ 쌍둥이 항성(주무기·스프레드) ----------------------------------------
// 부채꼴 발사(발칸/스프레드) 시 발사체 수를 2배로 늘리고 발당 피해를 낮춘다.
/** 발사체 2배에 대응하는 발당 피해 배율(총 DPS는 순증, 분산↑). */
export const TWIN_STAR_DAMAGE_MULT = 0.7;

// --- ⑬ 도박사의 칩(모듈) ----------------------------------------------------
// 레벨업 파워업 선택지를 늘린다. 로드아웃 고정값이라 런 내내 결정론적으로 같은 수를 뽑는다.
/** 레벨업 시 추가로 제시하는 파워업 선택지 수. */
export const GAMBLER_EXTRA_CHOICES = 1;

// --- ⑧ 특이점 발생기 --------------------------------------------------------
/** 중력장 흡인 반경(월드 유닛). */
export const SINGULARITY_RADIUS = 460;
/** 반경 안 적을 플레이어 쪽으로 끌어당기는 속도(units/second). */
export const SINGULARITY_PULL_SPEED = 240;

// --- ⑨ 반응 장갑 ------------------------------------------------------------
/** 피격 시 방출하는 반격 펄스 아군탄 수. */
export const REACTIVE_PULSE_COUNT = 12;
export const REACTIVE_PULSE_SPEED = 900;
export const REACTIVE_PULSE_DAMAGE = 14;
export const REACTIVE_PULSE_RADIUS = 6;
export const REACTIVE_PULSE_LIFE = 40;

// --- ⑩ 위상 전환막 ----------------------------------------------------------
/** 이 비율 이하로 체력이 떨어지면 발동(내부 쿨다운 사용). */
export const PHASE_MEMBRANE_HP_FRAC = 0.3;
/** 발동 재사용 대기(틱, 12초). 플레이어 targetY에 카운트다운으로 실어 신규 필드 없이 관리. */
export const PHASE_MEMBRANE_COOLDOWN = 720;
/** 발동 시 회복하는 최대 체력 비율. */
export const PHASE_MEMBRANE_HEAL_FRAC = 0.5;

// --- ⑪ 잔상 추진기 ----------------------------------------------------------
/** 대시 시 적탄을 소거하는 반경(월드 유닛). */
export const AFTERIMAGE_RADIUS = 220;

// --- ⑫ 탐욕의 심장 ----------------------------------------------------------
/** 젬 획득 시 콤보 지속에 더하는 틱. */
export const GREED_COMBO_BONUS_TICKS = 18;
/** 젬 획득마다 늘어나는 자석 반경(월드 유닛), 상한까지 누적. */
export const GREED_MAGNET_STEP = 3;
export const GREED_MAGNET_CAP = 900;

// --- ⑭ 유물 증폭기 ----------------------------------------------------------
/** 경험치 획득 배율(소폭↑). */
export const RELIC_XP_MULT = 1.15;
