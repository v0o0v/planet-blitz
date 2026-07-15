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
