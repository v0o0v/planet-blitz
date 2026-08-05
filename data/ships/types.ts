/**
 * 기체 타입 레지스트리 스키마 (M8 설계서 §2, ADR-0019).
 *
 * ## flat 벡터 레이아웃 계약 (세이브·리플레이의 축) — ADR-0049 재정의
 *
 *   [축0 스킬 0..9][축1 스킬 10..19][축2 스킬 20..29]   = 30칸, 기체 7종 전부 동일
 *
 * 축 블록이 그대로 이어 붙는다. 구 레이아웃은 `[base 0..59][캡스톤 60..62]` 라 축 블록이
 * 연속이 아니었고(캡스톤이 맨 뒤로 빠졌다) 그래서 단순 concat 이 금지였는데, ADR-0049 가
 * 캡스톤을 폐기해 그 사유가 사라졌다. 그래도 {@link flattenShipNodes} 를 쓴다 — 누락 노드를
 * 조립 시점에 던져서 잡는 자리이기 때문이다.
 *
 * ## 이 인덱스는 여전히 **삼중 해시 계약**이다
 *   1. 직접 폴드   — `src/sim/replay.ts` 가 `skillInvest` 를 **길이 프리픽스 + u32** 로 접는다.
 *      값이 같아도 길이만 바뀌면 첫 틱부터 갈린다.
 *   2. 파생 스탯   — `src/items/loadout.ts` → 같은 폴드
 *   3. sim RNG 슬라이스 — `src/sim/powerups.ts` 의 `investedInAffinity()` 가 축 슬라이스를 읽어
 *      파워업 가중을 만들고, 그 가중이 `powerupRng` 소비 순서를 바꾼다. **해시 폴드를 완벽히
 *      보존해도 슬라이스가 한 칸 밀리면 레벨업 틱부터 스트림이 갈린다.**
 *
 * 그래서 레이아웃 변경은 `SHIP_HASH_VERSION` bump · 골든 3종 재생성 · 세이브 마이그레이션 ·
 * EF 재배포와 **반드시 한 커밋**이다(`.omc/handoffs/skill-rebuild-commit2.md`).
 *
 * 데이터·순수 정수 연산만. 무작위·시계 없음(ADR-0005, eslint 가 `data/**` 에도 강제).
 */

import type { SkillTree } from '../skills.js';

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

/**
 * 스킬 1종 (ADR-0049). **1포인트에 메커닉이 온전히 해금**되고, 이후 레벨은 그 메커닉의 핵심
 * 수치 파라미터만 성장시킨다(브레이크포인트 금지 — 질적 변화는 레벨이 아니라 스킬 자체가
 * 담당한다).
 *
 * ## 왜 `stat`/`perPoint` 가 없는가
 * 구 {@link SkillNode} 는 "투자 × perPoint 를 `StatKey` 에 더한다"는 **수치 노드**였다.
 * ADR-0049 가 스킬을 메커닉으로 옮기면서 그 축이 통째로 사라졌다 — 스킬의 효과는
 * `computeSkillStats` 가 접는 파생 스탯이 아니라 **sim 안의 규칙**이다. 수치 부속 효과는
 * 그 메커닉의 일부로 sim 이 직접 읽는다(헌장 「유니크 잣대」: 순수 수치는 부속으로만 허용,
 * 본체로는 금지).
 *
 * ## `code` 를 따로 두는 이유
 * 설계서(`.omc/plans/skill-rebuild-2026-08-05/<slug>.md`)가 `F1`·`M5`·`S10` 같은 축+번호로
 * 스킬을 지칭하고, 침공 판정 표·아키타입·비평 지적이 전부 그 ID 를 쓴다. 코드에 그 ID 가
 * 없으면 설계서와 구현을 대조할 때마다 사람이 이름으로 유추해야 한다.
 */
export interface ShipSkillDef {
  /** 전역 유니크 en-slug(`<기체>-<스킬>`). sim 배선·i18n·어픽스가 이 문자열을 축으로 쓴다. */
  readonly id: string;
  /** 설계서 ID(`F1`·`M5`·`S10` …). 축 문자 + 번호. 설계서 대조용. */
  readonly code: string;
  /** 소속 축. `ShipTreeDef.affinity` 와 반드시 같다(테스트가 못 박는다 — 저작 실수 검출용). */
  readonly axis: TreeAffinity;
  readonly name: string;
  readonly desc: string;
  /** 투자 상한 = {@link SKILL_MAX_LEVEL}. 스킬 어픽스는 이 상한을 **초과할 수 있다**. */
  readonly maxPoints: number;
}

/** 한 계열(축) 정의. `nodes` = 스킬 정확히 {@link SKILLS_PER_AXIS} 개(캡스톤 없음). */
export interface ShipTreeDef {
  /** 아이콘 파일명·i18n 키의 축(ADR-0015 — 인스턴스가 아니라 속성이 축). */
  readonly slug: string;
  /** 파워업 가중의 축. 트리 이름과 분리한다(위 {@link TreeAffinity} 주석). */
  readonly affinity: TreeAffinity;
  /** 이 축의 스킬 {@link SKILLS_PER_AXIS} 개. 순서가 곧 flat 인덱스다. */
  readonly nodes: readonly ShipSkillDef[];
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
  /**
   * 상위(`hi`) 액티브 스킬의 해금 게이트 = 해당 **축** 누적 투자 하한(ADR-0041 + ADR-0049).
   *
   * 구 이름은 `capstoneGate` 였다 — 캡스톤과 상위 액티브가 같은 임계를 공유했기 때문이다.
   * ADR-0049 가 캡스톤을 폐기하면서 그 임계의 소비자가 액티브 하나만 남았으므로 이름을
   * 소비자에 맞춘다. **수치는 구 값을 그대로 잇는다** — 밸런스는 출시 직전 일괄
   * (`defer-balance-tuning`)이고, 여기서 같이 건드리면 재편의 회귀와 밸런스 변화가 섞여
   * "무엇이 무엇을 바꿨는지"가 안 가려진다.
   */
  readonly activeHiGate: number;
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

/** 타입당 트리(축) 수(ADR-0019). */
export const TREES_PER_SHIP = 3;

/** 축당 스킬 수(ADR-0049). 기체 7종 전부 동일 — 기체별로 다르지 않다. */
export const SKILLS_PER_AXIS = 10;

/**
 * 스킬 투자 상한(ADR-0049). **스킬 어픽스(축 단위 +N 레벨)는 이 상한을 초과할 수 있다** —
 * 장비만이 여는 영역이 엔드게임 파밍 동기다. 따라서 레벨 수치 공식은 20 을 넘어도 같은
 * 공식으로 자연 연장돼야 하고(특이점·clamp 금지), 이 상수는 **포인트 투자**의 상한이지
 * 실효 레벨의 상한이 아니다.
 */
export const SKILL_MAX_LEVEL = 20;

/**
 * 상위(`hi`) 액티브 해금 게이트의 기본값 = 구 `CAPSTONE_GATE`(40) 승계.
 *
 * ⚠️ **해츨링만 44 였고, 그 예외는 여기서 사라진다.** 근거는 해츨링의 트리가 25노드(나머지
 * 20)로 더 컸다는 것이었는데(`data/ships/hatchling.ts` 헤더), ADR-0049 가 축당 10스킬로
 * 통일해 **용량 차이 자체가 없어졌다.** 예외를 남기면 근거 없는 수치가 되므로 걷는다.
 * 값 40 자체의 적정성은 밸런스 일괄 레인 소관이다(`defer-balance-tuning`).
 */
export const ACTIVE_HI_GATE_DEFAULT = 40;

/** 시그니처 비트 가용 구간(양끝 포함) — 설계서 §4 실측. */
export const SIGNATURE_BIT_MIN = 18;
export const SIGNATURE_BIT_MAX = 30;

/** 시그니처 없음(스트라이커). */
export const NO_SIGNATURE_BIT = -1;

/**
 * flat `skillInvest` 벡터 길이 = 축수 × 축당 스킬수 = **30, 기체 7종 전부 동일**(ADR-0049).
 *
 * `def` 를 여전히 받는 이유: 호출부 수십 곳이 "타입마다 길이가 다르다"는 전제로 쓰여 있고,
 * 앞으로 기체별 예외가 생길 여지를 시그니처로 남겨 둔다. 값은 현재 def 에 무관하다.
 */
export function shipNodeCount(_def: ShipTypeDef): number {
  return TREES_PER_SHIP * SKILLS_PER_AXIS;
}

/** 한 축의 flat 인덱스 구간 `[start, end)`. 축 블록이 순서대로 이어 붙는다. */
export function shipTreeRange(_def: ShipTypeDef, treeIndex: number): { start: number; end: number } {
  const start = treeIndex * SKILLS_PER_AXIS;
  return { start, end: start + SKILLS_PER_AXIS };
}

/**
 * flat 인덱스 → 축 인덱스. **이 산술의 단일 정본이다** — `Math.floor(i / SKILLS_PER_AXIS)` 가
 * sim·loadout·UI 세 곳에 복제되면 재편에서 조용히 갈린다(`affixes.md` ⑥-1 항목 4).
 * 범위 밖이면 -1.
 */
export function shipAxisIndexOf(def: ShipTypeDef, flatIndex: number): number {
  if (!Number.isInteger(flatIndex) || flatIndex < 0 || flatIndex >= shipNodeCount(def)) return -1;
  return Math.floor(flatIndex / SKILLS_PER_AXIS);
}

/**
 * flat 벡터 순서대로 스킬을 펼친다 = **축0 10개 → 축1 10개 → 축2 10개**.
 *
 * 구 레이아웃은 "base 블록 전부 → 캡스톤 3개" 라 축 블록이 연속이 아니었다(캡스톤이 맨 뒤로
 * 빠졌다). ADR-0049 는 캡스톤을 폐기했으므로 축 블록이 그대로 이어 붙고, `shipTreeRange` 와
 * 이 함수의 순서가 **정의상 일치**한다 — 구 레이아웃에서 단순 concat 을 금지했던 사유가
 * 사라졌다.
 */
export function flattenShipNodes(def: ShipTypeDef): readonly ShipSkillDef[] {
  const out: ShipSkillDef[] = [];
  for (const tree of def.trees) {
    for (let i = 0; i < SKILLS_PER_AXIS; i++) {
      const n = tree.nodes[i];
      if (n === undefined) throw new Error(`${def.slug}/${tree.slug}: 스킬 ${i} 누락`);
      out.push(n);
    }
  }
  return out;
}

/**
 * 스킬 1종의 압축 저작 형식 — `[code, idSlug, name, desc]`.
 * `id` 는 `<기체slug>-<idSlug>` 로 조립되므로 여기에는 기체 이름을 적지 않는다.
 */
export type SkillSpec = readonly [code: string, idSlug: string, name: string, desc: string];

/**
 * 한 축을 조립한다. **10개가 아니면 던진다** — 축당 스킬 수는 ADR-0049 의 구조 계약이고,
 * 9개나 11개를 저작하면 flat 인덱스가 통째로 밀려 삼중 해시 계약이 조용히 깨진다. 그 실수는
 * 전부 같은 타입이라 타입 검사에 걸리지 않으므로 **조립 시점에 던지는 것이 유일한 방벽**이다.
 * (구 레이아웃에서 "트리별 배열을 concat 하지 마라" 가 하던 역할을 여기가 이어받는다.)
 */
export function buildShipAxis(
  shipSlug: string,
  axisSlug: string,
  affinity: TreeAffinity,
  specs: readonly SkillSpec[],
): ShipTreeDef {
  if (specs.length !== SKILLS_PER_AXIS) {
    throw new Error(
      `${shipSlug}/${axisSlug}: 축당 스킬은 ${SKILLS_PER_AXIS}개여야 한다 (현재 ${specs.length})`,
    );
  }
  return {
    slug: axisSlug,
    affinity,
    nodes: specs.map(([code, idSlug, name, desc]) => ({
      id: `${shipSlug}-${idSlug}`,
      code,
      axis: affinity,
      name,
      desc,
      maxPoints: SKILL_MAX_LEVEL,
    })),
  };
}

// (삭제됨) `placeholderTree()` — L1 이 신규 타입을 "유효하지만 최소" 스텁으로 세우기 위한
// 자리표시자 헬퍼였다. M8-L6 이 bruiser·arccaster·phantom·hatchling 에 실데이터를 채우면서
// 호출부가 0 이 됐다(L1 헤더 주석의 "L6 이 함께 지운다" 지시대로 제거). grep 잔존 0건.
