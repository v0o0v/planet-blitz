/**
 * 기체 타입 레지스트리 스키마 (M8 설계서 §2, ADR-0019).
 *
 * ## 왜 별도 모듈인가
 * `data/skills.ts` 는 **단일 기체 전제**로 만들어진 3계열 63노드 트리다. ADR-0019 가
 * 타입마다 트리 전체를 고유로 만들기로 했으므로, 트리 데이터는 "타입 → 3트리 → 노드" 로
 * 일반화돼야 한다. 그러나 `data/skills.ts` 의 **인덱스는 삼중 해시 계약**이다:
 *
 *   1. 직접 폴드   — `src/sim/replay.ts` 가 `skillInvest` 를 길이 프리픽스 + u32 로 접는다
 *   2. 파생 스탯   — `src/items/loadout.ts` → 같은 폴드
 *   3. sim RNG 슬라이스 — `src/sim/powerups.ts` 의 `investedInTree()` 가 트리 슬라이스를 읽어
 *      파워업 가중을 만들고, 그 가중이 `powerupRng` 소비 순서를 바꾼다. **해시 폴드를 완벽히
 *      보존해도 슬라이스가 한 칸 밀리면 레벨업 틱부터 스트림이 갈린다.**
 *
 * 따라서 이 모듈은 스트라이커(타입 0)의 노드 리터럴을 **옮겨 적지 않는다**. `data/ships/striker.ts`
 * 가 `data/skills.ts` 의 기존 export 를 import 해 **조립만** 한다. 무수정이 가장 싼 불변 보장이다.
 *
 * ## flat 벡터 레이아웃 계약 (세이브·리플레이의 축)
 * `skillInvest` 인덱스는 트리 단위로 뭉쳐 있지 **않다**. `data/skills.ts` 의 실제 배치는
 *
 *   [트리0 base 0..19][트리1 base 20..39][트리2 base 40..59][트리0·1·2 캡스톤 60·61·62]
 *
 * 즉 **base 블록 전부가 먼저, 캡스톤 3개가 맨 뒤**다. {@link ShipTreeDef.nodes} 는 한 트리의
 * `base × nodesPerTree + 캡스톤 1개`(= `nodesPerTree + 1` 개)를 담고, flat 벡터는
 * {@link flattenShipNodes} 가 위 순서로 재조립한다. 트리별 배열을 단순 concat 하면 인덱스가
 * 밀려 위 3중 계약이 전부 깨진다 — 그래서 concat 을 쓰지 말고 이 함수를 쓴다.
 *
 * 데이터·순수 정수 연산만. 무작위·시계 없음(ADR-0005, eslint 가 `data/**` 에도 강제).
 */

import type { SkillNode, SkillTree } from '../skills.js';

/**
 * 트리의 **역할 축**. 트리 이름(slug)과 분리한 이유: 파워업 가중(`src/sim/powerups.ts`)이
 * 현재 `'firepower'|'survival'|'mobility'` 문자열에 결속돼 있어, 신규 타입은 이름이 다르다는
 * 이유만으로 빌드 친화 가중을 통째로 잃는다. 가중의 축을 affinity 로 옮기면 신규 타입이
 * 자동으로 가중을 얻고, 스트라이커 매핑(firepower→offense·survival→defense·mobility→utility)이
 * `SKILL_TREES` 순서와 1:1 이라 **가중값은 바이트 동일**하다(설계서 §2).
 */
export type TreeAffinity = 'offense' | 'defense' | 'utility';

/** affinity 의 정본 순서 — 타입 정의가 3종 전부를 덮는지 테스트가 확인하는 축. */
export const TREE_AFFINITIES: readonly TreeAffinity[] = ['offense', 'defense', 'utility'];

/**
 * 스트라이커의 레거시 트리 이름 → affinity. `SKILL_TREES.indexOf` 순서와 1:1 이어야
 * 파워업 가중이 바이트 동일하게 유지된다(테스트 ⑥이 못 박는다).
 */
export const LEGACY_TREE_AFFINITY: Readonly<Record<SkillTree, TreeAffinity>> = {
  firepower: 'offense',
  survival: 'defense',
  mobility: 'utility',
};

/** affinity → 레거시 `SkillNode.tree` 값(역매핑). 신규 타입 노드도 `tree` 필드를 채워야
 *  하는데 그 타입이 3리터럴로 고정돼 있어, 역할이 같은 레거시 슬롯을 쓴다. */
export const AFFINITY_LEGACY_TREE: Readonly<Record<TreeAffinity, SkillTree>> = {
  offense: 'firepower',
  defense: 'survival',
  utility: 'mobility',
};

/** 한 계열(트리) 정의. `nodes` = base `nodesPerTree` 개 + **맨 뒤 캡스톤 1개**. */
export interface ShipTreeDef {
  /** 아이콘 파일명·i18n 키의 축(ADR-0015 — 인스턴스가 아니라 속성이 축). */
  readonly slug: string;
  /** 파워업 가중의 축. 트리 이름과 분리한다(위 {@link TreeAffinity} 주석). */
  readonly affinity: TreeAffinity;
  /** base 노드 `nodesPerTree` 개 + 캡스톤 1개, 이 순서. */
  readonly nodes: readonly SkillNode[];
}

/** 기체 타입의 기본 스탯 보정(basis-point). 전 축 0 이면 무연산(스트라이커). */
export interface ShipBaseBp {
  readonly damageBp: number;
  readonly fireRateBp: number;
  readonly maxHpBp: number;
  readonly moveSpeedBp: number;
}

/** 기체 타입 1종. `id` === `SHIP_TYPES` 배열 인덱스 === 세이브에 저장되는 wire 값. */
export interface ShipTypeDef {
  /** `SHIP_TYPES` 인덱스 계약 — 재번호 금지, append-only. */
  readonly id: number;
  /** 아트·i18n 키의 축(`ship_showcase_<slug>.png` 등). */
  readonly slug: string;
  /** 길이 3 고정(ADR-0019 "3계열"). */
  readonly trees: readonly ShipTreeDef[];
  /** 트리당 base 노드 수(캡스톤 제외). */
  readonly nodesPerTree: number;
  /** 캡스톤 진입 게이트 = 해당 계열 base 노드 누적 투자 하한. */
  readonly capstoneGate: number;
  /**
   * `uniqueMask` 에서 이 타입의 시그니처 패시브가 쓰는 비트. **스트라이커는 -1(시그니처 없음)** —
   * 설계서 §11 채택안 A(스트라이커 바이트 불변). 신규 폴드 없이 미사용 상위 비트를 쓰는 기법은
   * `src/sim/capstones.ts` 가 명문화했다. 0~17 은 유니크·캡스톤이 점유, 31 은 `1<<31` 이 음수라
   * 쓰지 않는다 → 가용 구간 **[18, 30]**.
   */
  readonly signatureBit: number;
  /** 기본 스탯 보정. 전 축 0 = 보정 없음(적용부가 조기 반환). */
  readonly baseBp: ShipBaseBp;
}

/** 타입당 트리 수(ADR-0019). */
export const TREES_PER_SHIP = 3;

/** 시그니처 비트 가용 구간(양끝 포함) — 설계서 §4 실측. */
export const SIGNATURE_BIT_MIN = 18;
export const SIGNATURE_BIT_MAX = 30;

/** 시그니처 없음(스트라이커). */
export const NO_SIGNATURE_BIT = -1;

/** flat `skillInvest` 벡터 길이 = 트리수 × (base + 캡스톤 1). 스트라이커는 3 × 21 = 63. */
export function shipNodeCount(def: ShipTypeDef): number {
  return def.trees.length * (def.nodesPerTree + 1);
}

/** 한 트리의 base 노드 flat 인덱스 구간 `[start, end)`. */
export function shipTreeRange(def: ShipTypeDef, treeIndex: number): { start: number; end: number } {
  const start = treeIndex * def.nodesPerTree;
  return { start, end: start + def.nodesPerTree };
}

/** 한 트리 캡스톤의 flat 인덱스(base 블록 전부 뒤, 트리 순서). */
export function shipCapstoneIndex(def: ShipTypeDef, treeIndex: number): number {
  return def.trees.length * def.nodesPerTree + treeIndex;
}

/**
 * flat 벡터 순서대로 노드를 펼친다 = **base 블록 전부 → 캡스톤 3개**.
 * 스트라이커에 대해 `data/skills.ts` 의 `SKILLS` 와 원소 동일(=== 참조까지)해야 한다.
 */
export function flattenShipNodes(def: ShipTypeDef): readonly SkillNode[] {
  const out: SkillNode[] = [];
  for (const tree of def.trees) {
    for (let i = 0; i < def.nodesPerTree; i++) {
      const n = tree.nodes[i];
      if (n === undefined) throw new Error(`${def.slug}/${tree.slug}: base 노드 ${i} 누락`);
      out.push(n);
    }
  }
  for (const tree of def.trees) {
    const c = tree.nodes[def.nodesPerTree];
    if (c === undefined) throw new Error(`${def.slug}/${tree.slug}: 캡스톤 노드 누락`);
    out.push(c);
  }
  return out;
}

// (삭제됨) `placeholderTree()` — L1 이 신규 타입을 "유효하지만 최소" 스텁으로 세우기 위한
// 자리표시자 헬퍼였다. M8-L6 이 bruiser·arccaster·phantom·hatchling 에 실데이터를 채우면서
// 호출부가 0 이 됐다(L1 헤더 주석의 "L6 이 함께 지운다" 지시대로 제거). grep 잔존 0건.
