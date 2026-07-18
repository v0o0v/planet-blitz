/**
 * Skill-tree data (M3 Phase A1 — plan §4, AC1).
 *
 * Three trees (화력 firepower · 생존 survival · 기동 mobility), 20 nodes each = 60
 * nodes total. Every node holds 4 or 5 max points; the pool sums to 250 points of
 * capacity (per tree ~83), so the ~99 points a max-level pilot banks can fully
 * fund at most 24 nodes — 40% of the tree (master §3 gate ②, verified in
 * tests/skills.test.ts). Nodes are laid out tree-contiguously and in ascending
 * tier so downstream code (`computeSkillStats`, powerup weighting) can slice a
 * tree by index range without a lookup.
 *
 * Data only — no RNG, no sim import. Each node names a `StatKey` the skill
 * pipeline (src/items/skills.ts) sums into the SAME derived block the loadout
 * pipeline uses, so skill investment and gear stack through one code path.
 */

import type { StatKey } from '../src/items/types.js';

/** The three skill trees, in their stable node-block order. */
export type SkillTree = 'firepower' | 'survival' | 'mobility';

/** Tree order === node-block order in {@link SKILLS}. NEVER reorder (index-keyed
 *  save vector + powerup weighting slice by this). */
export const SKILL_TREES: readonly SkillTree[] = ['firepower', 'survival', 'mobility'];

/** Nodes per tree. The 60-node vector is `SKILL_TREES.length * NODES_PER_TREE`. */
export const NODES_PER_TREE = 20;

/** Tiers per tree (depth 0..DEPTH-1); 4 nodes per tier. Synergy amplifies a
 *  node by the points invested in LOWER tiers of the same tree (Diablo2-style,
 *  OQ-M3-2 default). */
export const TREE_DEPTH = 5;

/** One skill node (designer data). Investing `invest` points (0..maxPoints)
 *  contributes `invest * perPoint` in the affix `stat`'s units into the derived
 *  stat block, before the tier-synergy amplifier. */
export interface SkillNode {
  readonly id: string;
  readonly tree: SkillTree;
  readonly name: string;
  readonly desc: string;
  /** Affix stat this node feeds (shared vocabulary with the loadout pipeline). */
  readonly stat: StatKey;
  /** Contribution per invested point, in `stat` units (percent or flat). */
  readonly perPoint: number;
  /** Max points investable in this node (4 or 5). */
  readonly maxPoints: number;
  /** Depth 0..TREE_DEPTH-1 for base nodes; CAPSTONE_TIER for the capstone. */
  readonly tier: number;
  /**
   * 질적 캡스톤 노드 표식(GDD §4). `true` 면 `stat`/`perPoint` 는 무의미(수치 미기여) —
   * computeSkillStats 가 건너뛴다. 효과는 sim(src/sim/capstones.ts)이 uniqueMask 비트로
   * 게이트한다. 진입 조건은 {@link capstoneUnlocked}(계열 base 20노드 합 ≥ CAPSTONE_GATE).
   */
  readonly capstone?: boolean;
}

/** Compact node spec: [name, desc, stat, perPoint, maxPoints]. */
type Spec = readonly [string, string, StatKey, number, number];

/** Build 20 nodes for a tree from 5 tiers × 4 specs, stamping id/tree/tier. */
function buildTree(tree: SkillTree, tiers: readonly (readonly Spec[])[]): SkillNode[] {
  const nodes: SkillNode[] = [];
  for (let tier = 0; tier < tiers.length; tier++) {
    const row = tiers[tier];
    if (row === undefined) continue;
    for (let i = 0; i < row.length; i++) {
      const spec = row[i];
      if (spec === undefined) continue;
      const [name, desc, stat, perPoint, maxPoints] = spec;
      nodes.push({ id: `${tree}-${tier}-${i}`, tree, name, desc, stat, perPoint, maxPoints, tier });
    }
  }
  return nodes;
}

// --- 화력 (firepower): damage · cadence · pierce · projectiles · velocity ---
// 16 nodes ×4 + 3 capstones ×5 + 1 capstone ×4 = 83 capacity.
const FIREPOWER: readonly (readonly Spec[])[] = [
  [
    ['집중 사격', '탄환 데미지 +3%/pt', 'damagePct', 3, 4],
    ['정밀 조준', '탄환 데미지 +3%/pt', 'damagePct', 3, 4],
    ['속사 훈련', '연사 속도 +2%/pt', 'fireRatePct', 2, 4],
    ['탄속 개량', '탄속 +3%/pt', 'bulletSpeedPct', 3, 4],
  ],
  [
    ['강화 탄두', '탄환 데미지 +4%/pt', 'damagePct', 4, 4],
    ['총열 냉각', '연사 속도 +2%/pt', 'fireRatePct', 2, 4],
    ['사거리 연장', '사거리 +40/pt', 'rangeFlat', 40, 4],
    ['관통 코어', '관통 +1/2pt(내림)', 'pierce', 0.5, 4],
  ],
  [
    ['파열탄', '탄환 데미지 +4%/pt', 'damagePct', 4, 4],
    ['연장 포신', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 4],
    ['고압 사출', '탄속 +4%/pt', 'bulletSpeedPct', 4, 4],
    ['속결 격발', '연사 속도 +3%/pt', 'fireRatePct', 3, 4],
  ],
  [
    ['철갑탄', '탄환 데미지 +5%/pt', 'damagePct', 5, 4],
    ['관통 강화', '관통 +1/2pt(내림)', 'pierce', 0.5, 4],
    ['광역 산포', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 4],
    ['가속 격발', '연사 속도 +3%/pt', 'fireRatePct', 3, 4],
  ],
  [
    ['초토화 프로토콜', '탄환 데미지 +6%/pt', 'damagePct', 6, 5],
    ['일제 사격 교리', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 5],
    ['궤멸 관통', '관통 +1/2pt(내림)', 'pierce', 0.5, 5],
    ['과열 격발 교리', '연사 속도 +4%/pt', 'fireRatePct', 4, 4],
  ],
];

// --- 생존 (survival): max HP · dash cadence · defensive move ---
// 16 nodes ×4 + 3 capstones ×5 + 1 capstone ×4 = 83 capacity.
const SURVIVAL: readonly (readonly Spec[])[] = [
  [
    ['보강 장갑', '최대 HP +6/pt', 'maxHpFlat', 6, 4],
    ['내구 격벽', '최대 HP +6/pt', 'maxHpFlat', 6, 4],
    ['긴급 회피', '대시 재충전 -2%/pt', 'dashCdPct', 2, 4],
    ['기민한 조종', '이동 속도 +2%/pt', 'moveSpeedPct', 2, 4],
  ],
  [
    ['복합 장갑', '최대 HP +8/pt', 'maxHpFlat', 8, 4],
    ['생체 강화', '최대 HP +2%/pt', 'maxHpPct', 2, 4],
    ['회피 기동', '대시 재충전 -3%/pt', 'dashCdPct', 3, 4],
    ['충격 완화', '최대 HP +8/pt', 'maxHpFlat', 8, 4],
  ],
  [
    ['나노 재생', '최대 HP +2%/pt', 'maxHpPct', 2, 4],
    ['중장갑 도금', '최대 HP +10/pt', 'maxHpFlat', 10, 4],
    ['위상 회피', '대시 재충전 -3%/pt', 'dashCdPct', 3, 4],
    ['안정 추진', '이동 속도 +2%/pt', 'moveSpeedPct', 2, 4],
  ],
  [
    ['적응 장갑', '최대 HP +3%/pt', 'maxHpPct', 3, 4],
    ['생존 본능', '대시 재충전 -4%/pt', 'dashCdPct', 4, 4],
    ['강화 프레임', '최대 HP +12/pt', 'maxHpFlat', 12, 4],
    ['회피 숙련', '이동 속도 +3%/pt', 'moveSpeedPct', 3, 4],
  ],
  [
    ['불멸 교리', '최대 HP +4%/pt', 'maxHpPct', 4, 5],
    ['타이탄 도금', '최대 HP +14/pt', 'maxHpFlat', 14, 5],
    ['찰나 회피 교리', '대시 재충전 -5%/pt', 'dashCdPct', 5, 5],
    ['생존 전술', '이동 속도 +3%/pt', 'moveSpeedPct', 3, 4],
  ],
];

// --- 기동 (mobility): move speed · dash · magnet · xp · velocity ---
// 16 nodes ×4 + 4 capstones ×5 = 84 capacity.
const MOBILITY: readonly (readonly Spec[])[] = [
  [
    ['추진기 조율', '이동 속도 +3%/pt', 'moveSpeedPct', 3, 4],
    ['경량 프레임', '이동 속도 +3%/pt', 'moveSpeedPct', 3, 4],
    ['자력 코일', '젬 자석 반경 +4%/pt', 'magnetPct', 4, 4],
    ['학습 회로', '경험치 +2%/pt', 'xpPct', 2, 4],
  ],
  [
    ['가속 추진', '이동 속도 +3%/pt', 'moveSpeedPct', 3, 4],
    ['대시 증폭', '대시 재충전 -3%/pt', 'dashCdPct', 3, 4],
    ['확장 자기장', '젬 자석 반경 +5%/pt', 'magnetPct', 5, 4],
    ['전술 분석', '경험치 +2%/pt', 'xpPct', 2, 4],
  ],
  [
    ['고기동 스러스터', '이동 속도 +4%/pt', 'moveSpeedPct', 4, 4],
    ['연쇄 대시', '대시 재충전 -3%/pt', 'dashCdPct', 3, 4],
    ['탄속 동조', '탄속 +3%/pt', 'bulletSpeedPct', 3, 4],
    ['수집 효율', '젬 자석 반경 +5%/pt', 'magnetPct', 5, 4],
  ],
  [
    ['초음속 항법', '이동 속도 +4%/pt', 'moveSpeedPct', 4, 4],
    ['순간 재충전', '대시 재충전 -4%/pt', 'dashCdPct', 4, 4],
    ['숙련 파일럿', '경험치 +3%/pt', 'xpPct', 3, 4],
    ['광역 자석', '젬 자석 반경 +6%/pt', 'magnetPct', 6, 4],
  ],
  [
    ['광속 기동 교리', '이동 속도 +5%/pt', 'moveSpeedPct', 5, 5],
    ['무한 대시 교리', '대시 재충전 -5%/pt', 'dashCdPct', 5, 5],
    ['전장 지배', '경험치 +4%/pt', 'xpPct', 4, 5],
    ['특이점 자석', '젬 자석 반경 +7%/pt', 'magnetPct', 7, 5],
  ],
];

// --- 최상위 질적 캡스톤 (GDD §4) --------------------------------------------
/**
 * 캡스톤 노드의 티어 값(base 티어 0..4 위의 특수 티어). 렌더/시너지 계산에는 쓰이지 않고
 * (computeSkillStats 가 캡스톤을 건너뜀), 표기·정렬 편의를 위한 상수다.
 */
export const CAPSTONE_TIER = TREE_DEPTH;
/**
 * 캡스톤 진입 게이트: 해당 계열의 base 20노드에 누적 투자한 포인트가 이 값 이상이어야
 * 캡스톤 1포인트를 찍을 수 있고, sim 효과도 활성화된다(GDD §4 "충분한 투자"). 트리 용량
 * (계열 ~83)의 절반 수준으로, 한 계열에 집중 투자한 빌드에만 열린다.
 */
export const CAPSTONE_GATE = 40;

/** 캡스톤 노드 1개를 만든다(수치 미기여 — stat/perPoint 는 자리표시자). */
function capstoneNode(tree: SkillTree, name: string, desc: string): SkillNode {
  return { id: `${tree}-capstone`, tree, name, desc, stat: 'damagePct', perPoint: 0, maxPoints: 1, tier: CAPSTONE_TIER, capstone: true };
}

/** 계열별 캡스톤 노드(순서 = firepower·survival·mobility → 인덱스 60·61·62). */
const CAPSTONES: readonly SkillNode[] = [
  capstoneNode('firepower', '탄막 상쇄 레이저', '1.5초마다 전방 레이저가 적탄을 소거'),
  capstoneNode('survival', '치명타 1회 무효', '런당 1회 치명 피격을 무효화 + 짧은 무적'),
  capstoneNode('mobility', '대시 잔상 소거', '대시 시 반경 320 내 적탄을 소거'),
];

/**
 * All nodes in stable order: firepower[0..19], survival[20..39], mobility[40..59],
 * then the three qualitative capstones firepower/survival/mobility at 60/61/62.
 * Index === position in the profile's `skillInvest` vector. 기존 60노드 인덱스는
 * 세이브·리플레이 호환을 위해 절대 재번호하지 않는다 — 캡스톤은 항상 끝에 append.
 */
export const SKILLS: readonly SkillNode[] = [
  ...buildTree('firepower', FIREPOWER),
  ...buildTree('survival', SURVIVAL),
  ...buildTree('mobility', MOBILITY),
  ...CAPSTONES,
];

/** Total node count (63 = 60 base + 3 capstones). */
export const SKILL_NODE_COUNT = SKILLS.length;

/** 계열별 캡스톤의 flat-vector 인덱스(base 60노드 뒤, 트리 순서). */
export const FIREPOWER_CAPSTONE = 60;
export const SURVIVAL_CAPSTONE = 61;
export const MOBILITY_CAPSTONE = 62;

/** 트리 → 그 계열 캡스톤 인덱스. */
export function capstoneIndex(tree: SkillTree): number {
  return NODES_PER_TREE * SKILL_TREES.length + SKILL_TREES.indexOf(tree);
}

/**
 * 한 계열의 base 20노드에 누적 투자한 포인트 합(캡스톤 게이트 판정용 — 캡스톤 자체는 제외).
 * 손상/짧은 벡터도 안전(누락 = 0).
 */
export function treeBaseInvested(invest: readonly number[], tree: SkillTree): number {
  const { start, end } = treeRange(tree);
  let sum = 0;
  for (let i = start; i < end; i++) sum += invest[i] ?? 0;
  return sum;
}

/** 계열 캡스톤이 게이트를 통과했는지(base 투자 ≥ CAPSTONE_GATE) — 투자 가능/해금 표시용. */
export function capstoneUnlocked(invest: readonly number[], tree: SkillTree): boolean {
  return treeBaseInvested(invest, tree) >= CAPSTONE_GATE;
}

/**
 * 계열 캡스톤 효과가 실제 활성인지 = 게이트 통과 AND 캡스톤에 1포인트 투자. sim(loadout)이
 * 이걸로 uniqueMask 비트를 세운다. 게이트 미달인데 캡스톤만 찍힌 손상 벡터는 비활성(robust).
 */
export function capstoneActive(invest: readonly number[], tree: SkillTree): boolean {
  return capstoneUnlocked(invest, tree) && (invest[capstoneIndex(tree)] ?? 0) > 0;
}

/** Total investable capacity across all nodes (sum of maxPoints ≈ 250). */
export const SKILL_TOTAL_CAPACITY = SKILLS.reduce((s, n) => s + n.maxPoints, 0);

/** Index range [start, end) of a tree's nodes in the flat vector. */
export function treeRange(tree: SkillTree): { start: number; end: number } {
  const t = SKILL_TREES.indexOf(tree);
  const start = t * NODES_PER_TREE;
  return { start, end: start + NODES_PER_TREE };
}
