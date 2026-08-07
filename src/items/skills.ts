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
import { SKILL_AFFIX_LV_MAX } from './types.js';
import {
  DEFAULT_SHIP_TYPE,
  shipTypeDef,
  shipAxisIndexOf,
  shipTreeRange,
  flattenShipNodes,
  TREE_AFFINITIES,
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
    // ADR-0049 스킬 어픽스(축 단위 +N 레벨)도 장비 어픽스 전용 → 항상 0. 실제 파생값은
    // `WorldConfig.skillAffixLv`(이중 벡터, `deriveSkillAffixLv` in loadout.ts)이고 이
    // 블록에는 절대 섞이지 않는다(affixes.md ①-5 — skillInvest 오염 재발 방지).
    skillLvOffense: 0,
    skillLvDefense: 0,
    skillLvUtility: 0,
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

/**
 * 한 스킬의 **실효 레벨** — 투자 포인트 + 축 어픽스. **sim 의 모든 스킬 훅이 이것만 부른다.**
 * 중복 구현 금지(`affixes.md` ①-4 의 정본 4조).
 *
 * ## 계약 (네 줄이 전부다)
 *  1. **투자 ≥ 1 인 스킬에만 가산한다.** `base <= 0` 이면 **0 을 반환하고 끝** — 어픽스를
 *     더하지 않는다. 이 한 줄이 "해금은 포인트로만"(ADR-0049 · E7)의 전부다.
 *  2. **상한 20 을 초과한다.** **결과(`base + add`)를 clamp 하지 않는다** — 20 초과가 설계다.
 *     여기서 자르면 그 초과분이 조용히 사라진다.
 *
 *     ⚠️⚠️ **가산분(`add`)의 상한은 별개이고, 그것은 여기서 건다.** 두 문장을 뭉치지 마라.
 *     2026-08-07 이전 이 자리는 *"실효 상한 24 는 입력 쪽 `clampSkillAffixLv`(loadout.ts)가
 *     이미 보장한다"* 라고 적혀 있었는데 **그 전제가 틀렸다** — 그 클램프는 **클라의 파생
 *     시점**에만 걸리고, `WorldConfig.skillAffixLv` 는 리플레이 config 로 그대로 들어오는
 *     **신뢰 경계 밖의 입력**이다. 손으로 고친 config 는 `[9999, …]` 을 실을 수 있었고 sim 이
 *     그대로 더했다. ADR-0050 으로 서버 재실행 대조가 사라져 **잡아 줄 뒷단도 없다.**
 *     그래서 클램프를 **읽는 쪽**(= 신뢰 경계 안쪽)으로 옮겼다.
 *     ⭐ 정상 런은 파생값이 이미 0~4 라 이 클램프가 **무연산**이다 → **해시 불변**.
 *     (사용자 판정 2026-08-07: 의뢰 봉인은 **하지 않는다** — 승패 주장 자체를 서버가 믿는
 *     상태라 이 한 축만 봉인해도 실효 방어가 거의 안 는다. 대신 클램프로 무제한만 막는다.)
 *  3. **발동 여부는 어픽스가 못 바꾼다.** 이 함수는 레벨만 돌려준다 — 트레이드 스킬 본체의
 *     발동은 투자 유무로만 판정한다.
 *  4. **침공 판정을 상속한다.** 게이트된 스킬은 레벨이 얼마든 침공에서 no-op 이다. 그 게이트는
 *     호출부(앵커)의 몫이고 이 함수는 관여하지 않는다.
 *
 * ## ⚠️ `axisOfIndex` 의 `undefined` 를 반드시 명시 처리한다
 * `axisOfIndex(flatIndex, typeId)` 는 범위 밖·손상 인덱스에 `undefined` 를 준다. 그 JSDoc 이
 * *"호출부가 조용히 offense 로 흘리지 않도록 기본값을 주지 않는다"* 를 계약으로 못 박았으므로,
 * 여기서는 **어픽스 가산 없이 base 를 반환**한다(0 축으로 흘리면 손상 인덱스가 공격 어픽스를
 * 얻는다). `affixes.md:123-131` 의 의사코드는 인자 순서와 반환 타입이 실제 구현과 **반대**다 —
 * 베끼지 마라.
 *
 * ## 축 → 인덱스
 * `TREE_AFFINITIES` 순서가 정본이다 — `deriveSkillAffixLv`(loadout.ts)가 정확히 그 순서로
 * 배열을 만든다. **축 수 3 을 하드코딩하지 않는다.**
 *
 * ## 성능
 * sim 루프가 매 틱 부른다. 이 함수 자체는 정수 덧셈과 배열 조회뿐이라 루프에 두어도 된다.
 * **나눗셈이 낀 레벨 스케일은 여기가 아니라 `createWorld` 의 `skillDerived` 에서 1회 확정**한다
 * (구현 고지 ③).
 *
 * @param invest `WorldConfig.skillInvest` (미지정 = 투자 없음)
 * @param flatIndex 기체 내 flat 스킬 인덱스
 * @param affixLv `WorldConfig.skillAffixLv` (미지정 = 어픽스 없음 — 조건부 스탬프라 흔하다)
 * @param typeId 기체 타입 id (미지정 = 스트라이커)
 */
export function skillLv(
  invest: readonly number[] | undefined,
  flatIndex: number,
  affixLv?: readonly number[],
  typeId: number = DEFAULT_SHIP_TYPE,
): number {
  const base = invest === undefined ? 0 : skillPoints(invest, flatIndex);
  // 정본 1: 미해금(0레벨)은 어픽스로 켜지지 않는다.
  if (base <= 0) return 0;
  if (affixLv === undefined) return base;
  const axis = axisOfIndex(flatIndex, typeId);
  // 손상 인덱스 — 어픽스를 붙이지 않는다(조용히 offense 로 흘리지 않는다).
  if (axis === undefined) return base;
  const ai = TREE_AFFINITIES.indexOf(axis);
  if (ai < 0) return base;
  const add = affixLv[ai];
  if (typeof add !== 'number' || !Number.isFinite(add) || add <= 0) return base;
  // 가산분만 축당 구조 상한으로 자른다(§2 ⚠️ 참조) — `skillAffixLv` 는 리플레이 config 로
  // 들어오는 신뢰 경계 밖 입력이고, 파생 쪽 클램프는 클라에만 걸린다. 정상 런은 이미 0~4 라
  // 무연산이다(해시 불변). ⛔ **결과(`base + add`)는 여전히 자르지 않는다 — 24 가 실효 상한이다.**
  const capped = Math.min(Math.trunc(add), SKILL_AFFIX_LV_MAX);
  return base + capped;
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
