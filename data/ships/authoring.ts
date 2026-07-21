/**
 * 신규 기체 타입(1~6)의 트리 **저작 헬퍼** (M8-L6 콘텐츠 + 7종 확장).
 *
 * ## 왜 별도 모듈인가
 * `bruiser`/`arccaster`/`phantom`/`hatchling`/`mallow`/`bubble` 여섯 파일이 같은 조립 규약을 쓴다. 규약을 여섯 벌 복사하면
 * 한 벌만 어긋나도 flat 인덱스 계약이 조용히 갈린다(`data/ships/types.ts` §flat 벡터 레이아웃).
 * 조립은 여기 한 곳, 데이터는 각 기체 파일 — `data/skills.ts` 가 로컬 `buildTree` 로 하는 것과
 * 같은 구조를 파일 경계 밖으로 한 칸 올린 것뿐이다.
 *
 * ## 규약
 * - `nodes` = base(티어 행을 순서대로 펼침) + **맨 뒤 캡스톤 1개**. `flattenShipNodes` 가
 *   `[base 블록 전부][캡스톤 3개]` 로 다시 접으므로 이 순서를 지켜야 한다.
 * - 노드의 레거시 `tree` 필드는 affinity 의 역매핑으로 채운다. 이것이 **파생 스탯·캡스톤
 *   게이트·파워업 가중의 축**이다(`src/items/loadout.ts` 의 `capstoneActive(invest, tree)`).
 * - 캡스톤은 `perPoint: 0`(수치 미기여). 효과는 sim 이 `uniqueMask` 비트로 게이트한다.
 * - 표시 문자열은 `data/skills.ts` 와 동일하게 **한글 리터럴**이다(UI 가 `node.name` 을 그대로
 *   그린다 — `src/ui/pixi/researchLab.ts:636,861`. `t()` 를 거치지 않으므로 i18n 키를 넣으면
 *   화면에 키가 그대로 뜬다). 컬러 이모지 금지(`src/ui/pixi/text.ts` stripEmoji → 두부).
 *
 * 데이터·순수 조립만. 무작위·시계 없음(ADR-0005).
 */

import type { SkillNode } from '../skills.js';
import { AFFINITY_LEGACY_TREE } from './types.js';
import type { ShipTreeDef, TreeAffinity } from './types.js';
import type { StatKey } from '../../src/items/types.js';

/**
 * 노드 1개의 저작 스펙: `[이름, 설명, 스탯, 포인트당 기여, 최대 포인트]`.
 * `data/skills.ts` 의 동명 튜플과 같은 형식이라 두 파일을 나란히 읽을 수 있다.
 */
export type NodeSpec = readonly [
  name: string,
  desc: string,
  stat: StatKey,
  perPoint: number,
  maxPoints: number,
];

/** 캡스톤 1개의 저작 스펙: `[이름, 설명]`. 수치는 없다(질적 노드). */
export type CapstoneSpec = readonly [name: string, desc: string];

/**
 * 티어 행 목록 + 캡스톤으로 트리 1개를 조립한다.
 *
 * @param shipSlug 노드 id 접두사(타입 간 id 충돌 방지)
 * @param slug     트리 slug — 아이콘·i18n(`lab.tree.<slug>`)의 축
 * @param affinity 파워업 가중·캡스톤 효과의 축
 * @param tiers    티어 0..N-1 의 노드 스펙 행. 행 길이는 트리 안에서 균일해야 한다
 * @param capstone 이 계열의 질적 캡스톤
 */
export function buildShipTree(
  shipSlug: string,
  slug: string,
  affinity: TreeAffinity,
  tiers: readonly (readonly NodeSpec[])[],
  capstone: CapstoneSpec,
): ShipTreeDef {
  const legacy = AFFINITY_LEGACY_TREE[affinity];
  const nodes: SkillNode[] = [];
  let tier = 0;
  for (const row of tiers) {
    let i = 0;
    for (const [name, desc, stat, perPoint, maxPoints] of row) {
      nodes.push({
        id: `${shipSlug}-${slug}-${tier}-${i}`,
        tree: legacy,
        name,
        desc,
        stat,
        perPoint,
        maxPoints,
        tier,
      });
      i++;
    }
    tier++;
  }
  const [capName, capDesc] = capstone;
  nodes.push({
    id: `${shipSlug}-${slug}-capstone`,
    tree: legacy,
    name: capName,
    desc: capDesc,
    // 캡스톤은 파생 스탯에 기여하지 않는다(computeSkillStats 가 건너뛴다) — stat 은 자리표시자.
    stat: 'damagePct',
    perPoint: 0,
    maxPoints: 1,
    tier: tiers.length,
    capstone: true,
  });
  return { slug, affinity, nodes };
}
