/**
 * 스킬트리 최상위 질적 노드(캡스톤) — 시뮬 게이트 상수·순수 헬퍼 (GDD §4).
 *
 * 계열별 캡스톤 1종씩(화력·생존·기동). data/skills.ts 의 캡스톤 노드(인덱스 60·61·62)에
 * 충분히 투자(계열 base 20노드 합 ≥ CAPSTONE_GATE) + 캡스톤 자체 1포인트가 찍히면,
 * src/items/loadout.ts 가 활성 캡스톤 비트를 `LoadoutConfig.uniqueMask` 에 OR 한다.
 *
 * ⚠️ 결정론·해시 불변(ADR-0005): 캡스톤은 **유니크와 동일한 `uniqueMask` 필드의 상위
 * 비트(15·16·17)** 를 재활용한다 — 신규 LoadoutConfig 필드·신규 hashWorld 폴드를 만들지
 * 않으므로 캡스톤 미보유 런(기존 fixtures 전부)의 상태 해시가 **바이트 단위로 완전 불변**이다.
 * 유니크 비트는 0~14(data/uniques.ts)로 확정돼 있고 15~17 은 미사용이라 충돌하지 않는다.
 * 절대 재번호 금지 — uniqueMask 는 해시에 접힌다(replay.ts).
 *
 * 모든 효과는 정수/고정 산술과 이미 해시되는 필드(state.tick, enemyBullet.dead,
 * player.iframes, player.targetX)만 사용한다. RNG·wall-clock·신규 WorldState 필드 없음.
 */

/** 캡스톤 uniqueMask 비트(유니크 0~14 뒤 상위 3비트; 절대 재번호 금지 — 해시 접힘). */
/** 화력 캡스톤 — 탄막 상쇄 레이저(주기적 전방 레이저로 적탄 소거). */
export const CAP_FIREPOWER_LASER = 15;
/** 생존 캡스톤 — 치명타 1회 무효(런당 1회 치명 피격 무효 + 짧은 무적). */
export const CAP_SURVIVAL_CRIT = 16;
/** 기동 캡스톤 — 대시 잔상 탄막 소거(대시 시 경로 주변 적탄 소거). */
export const CAP_MOBILITY_DASH = 17;

/** uniqueMask 에 캡스톤 `bit` 이 켜져 있는지(유니크의 hasUnique 와 동일 연산, 의미 분리용). */
export function hasCapstone(mask: number, bit: number): boolean {
  return (mask & (1 << bit)) !== 0;
}

// --- 화력: 탄막 상쇄 레이저 -------------------------------------------------
/**
 * 레이저 발사 주기(틱). 60fps 기준 1.5초마다 전방으로 소거 레이저를 쏜다. state.tick 이
 * 이 값의 배수인 틱에 발화(결정론 — wall-clock 무관).
 */
export const LASER_PERIOD = 90;
/** 레이저 사거리(월드 유닛): 조준 방향으로 이 거리까지의 적탄을 소거. */
export const LASER_RANGE = 1100;
/** 레이저 반폭(월드 유닛): 조준축 기준 좌우 이 폭 안의 적탄을 소거. */
export const LASER_HALF_WIDTH = 90;

/**
 * 조준 방향(dirX,dirY, 단위벡터) 기준 전방 레이저 직사각형 안에 점 (bx,by)이 들어오는지.
 * 축 투영 거리 t 가 [0, LASER_RANGE], 수직 거리 |perp| ≤ LASER_HALF_WIDTH 이면 true.
 * 순수 함수 — 정수/부동 산술만 사용(결정론).
 */
export function laserHits(
  px: number,
  py: number,
  dirX: number,
  dirY: number,
  bx: number,
  by: number,
): boolean {
  const ex = bx - px;
  const ey = by - py;
  const t = ex * dirX + ey * dirY; // 전방 투영 거리
  if (t < 0 || t > LASER_RANGE) return false;
  const perp = ex * -dirY + ey * dirX; // 수직 거리(부호 있음)
  return perp <= LASER_HALF_WIDTH && perp >= -LASER_HALF_WIDTH;
}

// --- 생존: 치명타 1회 무효 --------------------------------------------------
/** 치명 무효 발동 시 부여하는 무적 프레임(틱). 짧은 재정비 시간. */
export const CRIT_NEGATE_IFRAMES = 90;

// --- 기동: 대시 잔상 탄막 소거 ----------------------------------------------
/**
 * 대시 시 적탄을 소거하는 반경(월드 유닛). 유니크 '잔상 추진기'(AFTERIMAGE_RADIUS=220)보다
 * 넓다. 중첩 규칙: 잔상 추진기 유니크와 이 캡스톤을 함께 보유하면 **더 큰 반경(이 값)으로
 * 한 번만** 소거한다(반경을 더하지 않는다 — world.ts 대시 블록 참조).
 */
export const DASH_CLEAR_RADIUS = 320;
