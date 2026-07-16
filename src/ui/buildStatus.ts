/**
 * 레벨업 오버레이 보조 로직 (순수 함수 — DOM·sim 비의존, 단위 테스트 가능).
 *
 * 두 가지를 담당한다:
 *  1) `readBuildStatus` — 현재 무기/스탯을 레벨업 카드 옆에 보여줄 표시용 스냅샷으로
 *     추출(렌더 전용, sim 상태 미변경). "적절한 선택"을 돕는 기능 요구.
 *  2) `levelUpOverlayAction` — 오버레이 표시/숨김을 sim 상태(`pendingLevelUp`)의
 *     순수 함수로 결정. 클릭 시 낙관적으로 숨기던 기존 구조가 `pendingLevelUp`이
 *     아직 참인 프레임에 렌더 루프의 재표시와 경쟁해 "오버레이가 남고 뒤에서 게임이
 *     진행"되던 레이스를 제거한다.
 */

import type { WorldState } from '../sim/world.js';
import { POWERUPS } from '../sim/powerups.js';
import type { SkillTree } from '../../data/skills.js';

/** 무기 아키타입 표시명(weaponType 인덱스 → 한글). autoAttack 분기와 동일 코드. */
export const WEAPON_TYPE_NAMES: Record<number, string> = {
  0: '발칸',
  1: '스프레드',
  2: '레일건',
  3: '미사일',
  4: '빔',
};

export function weaponTypeName(t: number): string {
  return WEAPON_TYPE_NAMES[t] ?? `무기 ${t}`;
}

/** 스킬 계열 표시명(카드 관련성 배지용). */
export const SKILL_TREE_NAMES: Record<SkillTree, string> = {
  firepower: '화력',
  survival: '생존',
  mobility: '기동',
};

/** 레벨업 카드 옆에 보여줄 현재 빌드 스냅샷(표시 전용). */
export interface BuildStatus {
  level: number;
  weaponType: number;
  weaponName: string;
  /** 초당 발사수(60 / fireCooldown) — 낮은 쿨다운을 직관적 수치로 환산. */
  shotsPerSec: number;
  damage: number;
  bulletCount: number;
  pierce: number;
  /** 확산 각(도). */
  spreadDeg: number;
  moveSpeed: number;
  hp: number;
  maxHp: number;
  dashCooldownTicks: number;
  magnetRadius: number;
}

/** 라이브 sim 상태에서 표시용 빌드 스냅샷을 읽는다(순수 추출, 미변경). */
export function readBuildStatus(state: WorldState): BuildStatus {
  const w = state.weapon;
  const player = state.entities[0];
  const cd = w.fireCooldown > 0 ? w.fireCooldown : 1;
  return {
    level: state.level,
    weaponType: w.weaponType,
    weaponName: weaponTypeName(w.weaponType),
    shotsPerSec: Math.round((60 / cd) * 10) / 10,
    damage: w.damage,
    bulletCount: w.bulletCount,
    pierce: w.pierce,
    spreadDeg: Math.round((w.spread * 180) / Math.PI),
    moveSpeed: state.config.playerSpeed,
    hp: player !== undefined ? Math.round(player.hp) : 0,
    maxHp: player !== undefined ? Math.round(player.maxHp) : 0,
    dashCooldownTicks: state.config.dashCooldownTicks,
    magnetRadius: state.magnetRadius,
  };
}

/** 카드 한 장의 빌드 관련성(배지 표시 + 현재 무기 강조). */
export interface ChoiceRelevance {
  label: string;
  /** 현재 장착 무기 타입과 일치(soft-weight 상향 대상) — 강조 표시. */
  matchesWeapon: boolean;
}

/** 오퍼된 파워업(풀 인덱스)의 관련성 배지를 계산. */
export function choiceRelevance(poolIndex: number, currentWeaponType: number): ChoiceRelevance {
  const def = POWERUPS[poolIndex];
  if (def === undefined) return { label: '', matchesWeapon: false };
  if (def.weaponType !== undefined) {
    const matches = def.weaponType === currentWeaponType;
    return {
      label: matches ? '현재 무기' : `${weaponTypeName(def.weaponType)} 무기`,
      matchesWeapon: matches,
    };
  }
  if (def.tree !== undefined) return { label: SKILL_TREE_NAMES[def.tree], matchesWeapon: false };
  return { label: '범용', matchesWeapon: false };
}

/**
 * 오버레이가 취할 동작을 sim 상태의 순수 함수로 결정한다.
 *
 * 핵심: 표시/숨김을 `pendingLevelUp`에 종속시켜, 클릭으로 낙관적으로 숨긴 뒤
 * `pendingLevelUp`이 아직 참인 프레임에 재표시되며 오버레이가 고아로 남는 레이스를
 * 없앤다. 픽은 다음 sim 틱에서 소비되어 `pendingLevelUp`을 내리고, 그 시점에만 숨는다.
 *
 * - `pendingLevelUp` 참 + 미표시 → 'show'(신규 레벨업)
 * - `pendingLevelUp` 참 + 표시 중이나 오퍼가 바뀜 → 'show'(멀티 레벨업: 갱신)
 * - `pendingLevelUp` 참 + 표시 중 + 동일 오퍼 → 'none'(선택 대기 유지)
 * - `pendingLevelUp` 거짓 + 표시 중 → 'hide'(픽 소비 완료)
 */
export function levelUpOverlayAction(
  pendingLevelUp: boolean,
  choices: readonly number[],
  overlayVisible: boolean,
  shownChoices: readonly number[],
): 'show' | 'hide' | 'none' {
  if (pendingLevelUp) {
    if (!overlayVisible) return 'show';
    return sameChoices(choices, shownChoices) ? 'none' : 'show';
  }
  return overlayVisible ? 'hide' : 'none';
}

function sameChoices(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
