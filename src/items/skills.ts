/**
 * 스킬 투자 벡터의 **파생·조회 층** (ADR-0049 재정의).
 *
 * ## 이 모듈에서 사라진 것 — 파생 스탯 파이프라인
 * 구 버전의 본체는 `computeSkillStats(invest)` 였다: 60칸 벡터를 `StatKey` 별 합으로 접고
 * 하위 티어 시너지(Diablo2 식)를 곱해 `src/items/loadout.ts` 가 만드는 파생 블록에 겹쳤다.
 * ADR-0049 가 스킬을 **스탯에서 메커닉으로** 옮기면서 그 축이 통째로 사라졌다 — 스킬 효과는
 * 이제 사전 계산된 스탯이 아니라 sim 안의 규칙이고, `WorldConfig.skillInvest` 를 sim 이 직접
 * 읽는다. 함께 폐기된 것:
 *
 *   - **티어 시너지** — flat 구조에는 티어가 없다.
 *   - **캡스톤 3종**(게이트·비트 OR·`shipCapstoneActive`) — ADR-0049 가 캡스톤을 폐기했다.
 *   - **사슬 선행 조건**(ADR-0047) — ADR-0049 가 명시적으로 폐기했다. 축당 10스킬은 처음부터
 *     전부 투자 가능하다.
 *
 * 껍데기만 남겨 두지 않고 **지운다.** 항상 0 을 돌려주는 함수를 호출부가 계속 부르면
 * "효과가 반영된다"는 오해가 남고, 이 리포의 반복 결함 8건이 전부 그 형태였다.
 *
 * ## 남은 것
 * 축(affinity) 조회와 투자 합계 — sim·UI·어픽스가 공유하는 **순수 파생**이다. RNG·시계 없음.
 * 클라와 검증 EF 가 같은 벡터에서 바이트 동일한 값을 얻어야 한다(ADR-0005).
 */

import type { StatKey } from './types.js';
import {
  DEFAULT_SHIP_TYPE,
  shipTypeDef,
  shipAxisIndexOf,
  shipTreeRange,
  flattenShipNodes,
} from '../../data/ships/index.js';
import type { ShipTypeDef, TreeAffinity } from '../../data/ships/index.js';

/**
 * 전 축 0 인 스탯 합. **스킬은 더 이상 이 블록에 기여하지 않는다** — 어픽스 합산의 초기값이
 * 필요한 곳이 아직 이 모듈을 통해 형태를 참조하므로 형태 정본으로만 남긴다.
 * (어픽스 누산기의 실제 초기값은 `src/items/loadout.ts` 의 `zeroSums()` 다 — 두 곳이
 * 갈리지 않게 `tests/loadout.test.ts` 가 키 집합 동일을 못 박는다.)
 */
export function zeroStatSums(): Record<StatKey, number> {
  return {
    damagePct: 0,
    fireRatePct: 0,
    bulletCount: 0,
    pierce: 0,
    bulletSpeedPct: 0,
    rangeFlat: 0,
    moveSpeedPct: 0,
    maxHpFlat: 0,
    maxHpPct: 0,
    dashCdPct: 0,
    magnetPct: 0,
    xpPct: 0,
    mineralFindPct: 0,
    // 원소 상태이상은 장비 어픽스 전용(스킬 트리에서 나오지 않음) → 항상 0.
    fireDmg: 0,
    coldSlow: 0,
    lightning: 0,
  };
}

/**
 * flat 인덱스 → 축(affinity). **이 매핑의 단일 정본이다.**
 *
 * `Math.floor(i / SKILLS_PER_AXIS)` → `def.trees[t].affinity` 를 sim·loadout·UI 세 곳에
 * 복제하면 재편에서 조용히 갈린다(`affixes.md` ⑥-1 항목 4). 인덱스 산술 자체는
 * `shipAxisIndexOf`(`data/ships/types.ts`)가 갖고, 이 함수는 그 결과를 affinity 로 옮긴다.
 *
 * 범위 밖·손상 인덱스는 `undefined`. 호출부가 조용히 offense 로 흘리지 않도록 기본값을
 * 주지 않는다.
 */
export function axisOfIndex(
  flatIndex: number,
  typeId: number = DEFAULT_SHIP_TYPE,
): TreeAffinity | undefined {
  const def = shipTypeDef(typeId);
  const ti = shipAxisIndexOf(def, flatIndex);
  if (ti < 0) return undefined;
  return def.trees[ti]?.affinity;
}

/** 한 축의 누적 투자. 손상/짧은 벡터도 안전(누락 = 0). */
export function axisInvested(
  invest: readonly number[],
  def: ShipTypeDef,
  treeIndex: number,
): number {
  const { start, end } = shipTreeRange(def, treeIndex);
  let sum = 0;
  for (let i = start; i < end; i++) sum += invest[i] ?? 0;
  return sum;
}

/**
 * 한 스킬의 **투자 레벨**(어픽스 가산 전). 상한 clamp 는 하지 않는다 — 스킬 어픽스가
 * `SKILL_MAX_LEVEL` 을 초과할 수 있는 것이 ADR-0049 의 설계이고, 여기서 자르면 그 초과분이
 * 조용히 사라진다. 저장 벡터의 상한은 `normalizeSkillInvest`(`src/save/profile.ts`)가 본다.
 */
export function skillPoints(
  invest: readonly number[],
  flatIndex: number,
): number {
  const v = invest[flatIndex];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0;
}

/** flat 인덱스 → 스킬 정의. 범위 밖이면 `undefined`. */
export function skillDefAt(flatIndex: number, typeId: number = DEFAULT_SHIP_TYPE) {
  return flattenShipNodes(shipTypeDef(typeId))[flatIndex];
}

/** 하나라도 투자돼 있는가 — "스킬 보유" 저비용 판정. */
export function hasAnyInvestment(invest: readonly number[] | undefined): boolean {
  if (invest === undefined) return false;
  for (let i = 0; i < invest.length; i++) {
    if ((invest[i] ?? 0) > 0) return true;
  }
  return false;
}
