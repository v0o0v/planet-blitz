/**
 * 액티브 스킬 레지스트리 스키마 (ADR-0041 · 계획 `.omc/plans/active-skills-2026-07-31.md` 0a-1).
 *
 * 기체 타입 7종 × 6종 = **42종**. 계열(트리) 투자로 열리고, 열린 것 중 **2개**를 장착해
 * z(슬롯1) · x(슬롯2) 로 발동한다. 비용은 쿨다운뿐이다.
 *
 * ## 왜 `data/ships/actives/` 인가 (기존 `data/ships/*.ts` 무수정)
 * `data/ships/types.ts:1-30` 이 못 박은 `skillInvest` flat 인덱스는 **삼중 계약**이다 —
 * 해시 폴드 · 파생 스탯 · 파워업 RNG 슬라이스. 인덱스가 한 칸이라도 밀리면 레벨업 틱부터
 * 스트림이 갈린다. 액티브를 기존 트리 데이터에 얹으면 그 계약을 건드릴 위험이 상존하므로
 * **완전히 분리된 디렉터리**에 둔다. 기존 `data/ships/*.ts` 는 이 레인에서 무수정이다.
 *
 * ## `aux0`/`aux1` 인코딩 표 — 42종이 실제로 묶이는 계약 (`src/sim/world.ts:1721-1731` 인용)
 * ```
 *   브루저     aux0 = 장갑 스택(0..8)                    · aux1 = 마지막 피격 이후 경과 틱
 *   아크캐스터 aux0 = 연속 정지 틱                        · aux1 = 미사용(0)
 *   팬텀       aux0 = 연속 무피격 틱(0..CLOAK_TICK_CAP)   · aux1 = 은신 해제 첫 타 대기 플래그(0/1)
 *   해츨링     aux0 = 마지막 출격 시점의 state.kills 스냅샷 · aux1 = 미사용(0)
 *   말로우     aux0 = 적립된 지연 피해(비음 정수)          · aux1 = 연속 무피격 틱
 *   버블       aux0 = 남은 막 내구(0..FILM_ABSORB_FLAT)   · aux1 = 마지막 파열 이후 경과 틱
 *   스트라이커 — 정조준 사이클(비트 24). `aux0` = 볼리 사이클 카운터(0..11).
 *     ⚠️ ADR-0049 이전에는 시그니처가 없어(-1) 이 액티브들이 aux 를 건드리지 않는 것이 설계였다.
 *     지금은 `aux0` 에 임자가 있으므로, 스트라이커 액티브가 그 칸을 쓰려면 사이클 의미와의 충돌을
 *     먼저 판정해야 한다.
 * ```
 * 핸들러가 이 표를 어기면 시그니처 상태가 **조용히** 손상된다. `aux0/aux1` 은 이미
 * `ENTITY_HASH_LAYOUT` 의 조건부 꼬리라(`src/sim/replay.ts:120-128,164`) 신규 해시 폴드가 없다.
 *
 * ## 표시 문자열은 `t()` 경유다 (트리 노드와 규약이 갈리는 이유)
 * `data/ships/authoring.ts:16-18` 의 트리 노드는 `node.name` 을 `t()` 없이 그대로 그린다.
 * 액티브는 **`t()` 경유**로 간다(ADR-0041). 근거: **Pixi 연구소는 이미 자기 크롬 전체를 `t()`
 * 로 그리고 `node.name` 만 예외다**(`src/ui/pixi/researchLab.ts:855-868`). 즉 이 결정은 기존
 * 코드와 **오히려 정합적**이고, 훗날 트리 노드를 `t()` 로 이관하면 규약이 하나로 되돌아온다.
 * 그래서 이 파일에는 사람이 읽는 한글/영문 리터럴이 없다 — 이름·설명은 i18n 카탈로그에만 있다.
 *
 * 데이터·순수 정수 연산만. 무작위·시계 없음(ADR-0005, eslint 가 `data/**` 에도 강제).
 */

/**
 * 효과의 결(ADR-0041 — 3결로 한정, 그 외 kind 를 만들지 않는다).
 *  · `strike` 즉발 공격  · `dash` 이동기  · `buff` 짧은 자기버프
 */
export type ActiveKind = 'strike' | 'dash' | 'buff';

/**
 * 배선 전수 테스트 ②가 읽는 **관측량 축**. `kind` 로 1:1 결정된다(대응 전수 테스트가 강제).
 *
 * ⚠️ 이 필드가 존재하는 이유가 계획의 핵심 정정(개정 3 CR-1)이다. 효과 탐지를
 * `hashWorld` 비교로 하면 **핸들러가 텅 비어도 항상 참**이다 — 쿨다운 설정만으로 해시가
 * 바뀌기 때문이다. 그래서 미발동 대조군 대비 **관측량 델타**로 단언한다.
 */
export type ActiveObservable = 'projectileCount' | 'displacement' | 'buffTicks';

/** `kind` → `observable` 정본 대응. 저작자가 따로 적지 않는다(파생 필드는 항진의 원천). */
export const OBSERVABLE_BY_KIND: Readonly<Record<ActiveKind, ActiveObservable>> = {
  strike: 'projectileCount',
  dash: 'displacement',
  buff: 'buffTicks',
};

/** 티어 — 저티어는 계열 base 누적 8, 고티어는 그 기체의 `capstoneGate`(해츨링만 44). */
export type ActiveTier = 'lo' | 'hi';

/** 저티어 해금 게이트 = 그 계열 base 노드 누적 투자 하한(ADR-0041). */
export const ACTIVE_LO_GATE = 8;

/** 기체당 액티브 스킬 수(ADR-0041 — 3계열 × 2티어). */
export const ACTIVES_PER_SHIP = 6;

/** 장착 슬롯 수(z/x). */
export const ACTIVE_SLOT_COUNT = 2;

/** 빈 슬롯의 wire 값. `>>> 0` 이 결정론적으로 접으므로 해시 폴드에 그대로 쓸 수 있다. */
export const ACTIVE_WIRE_EMPTY = -1;

/**
 * 액티브 스킬 1종.
 *
 * ⚠️ **`touchesSignature` 같은 파생 필드를 두지 않는다.** 우변이 `shipTypeId` 로 100% 파생
 * 가능한 필드는 "저작자가 베껴 적었는가"만 검사하는 항진을 낳는다(계획 개정 3). 시그니처를
 * 실제로 건드렸는지는 **시그니처 델타 테스트**(미발동 대조군 vs 발동군의 `aux0/aux1` 차이)가
 * 판정한다.
 */
export interface ActiveSkillDef {
  /** 42종 전역 고유 문자열 id. 규약 `as_<shipSlug>_<treeSlug>_<lo|hi>`. 세이브에 저장된다. */
  readonly id: string;
  /** `SHIP_TYPES` 인덱스. 이 스킬을 쓸 수 있는 유일한 기체 타입. */
  readonly shipTypeId: number;
  /** 그 기체의 `trees` 배열 인덱스(0..2). 게이트가 읽는 계열. */
  readonly treeIndex: number;
  /** 저/고 티어. 게이트 임계가 여기서 파생한다(`activeGateThreshold`). */
  readonly tier: ActiveTier;
  /** 효과의 결. 3결 외 없음(AC-3). */
  readonly kind: ActiveKind;
  /** 배선 전수 테스트 ②의 관측 축. `OBSERVABLE_BY_KIND[kind]` 와 반드시 일치(전수 단언). */
  readonly observable: ActiveObservable;
  /** 기본 쿨다운(틱). 투자량이 이것을 단조 감소시킨다(AC-13). */
  readonly baseCooldown: number;
  /**
   * 핸들러가 읽는 계수 묶음. 의미는 `kind` 별로 다르다(예: strike = 탄수·피해, dash = 거리,
   * buff = 지속 틱). **수치는 밸런스 패스로 defer** — 지금 값은 하네스 육안 확인이 가능한
   * 과장된 placeholder 다(`PLACEHOLDER_BALANCE`).
   */
  readonly coeff: Readonly<Record<string, number>>;
}

/**
 * 해시·`WorldConfig` 에 실리는 **정수 wire 값**. `shipTypeId * ACTIVES_PER_SHIP + slotIndex`
 * 로 파생하므로 별도 저장이 없고, `SHIP_TYPES` 가 append-only 인 한 안정적이다.
 * 범위는 0..41.
 */
export function activeWireId(shipTypeId: number, indexInShip: number): number {
  return shipTypeId * ACTIVES_PER_SHIP + indexInShip;
}

/** i18n 키 규약 — 표시 문자열은 전부 `t()` 경유다(위 헤더 참조). */
export function activeSkillNameKey(id: string): string {
  return `activeSkill.${id}.name`;
}

/** i18n 키 규약(설명). */
export function activeSkillDescKey(id: string): string {
  return `activeSkill.${id}.desc`;
}

/** 아이콘 파일명 규약 — `active_<shipSlug>_<n>.png`, n = 1..6 (ADR-0015 인스턴스 예외 편입). */
export function activeSkillIconName(shipSlug: string, indexInShip: number): string {
  return `active_${shipSlug}_${indexInShip + 1}.png`;
}
