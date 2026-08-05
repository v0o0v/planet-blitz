/**
 * 연구소 스킬 노드 아이콘 매핑 검증 (노드 → 아이콘 basename) — ADR-0049 flat 재편.
 *
 * 구 `skillIconName`(`src/ui/pixi/uiTextures.ts`)은 `SkillNode.stat`+`tier` 에서 62종 아이콘
 * 이름을 유도했다. ADR-0049 가 스킬을 메커닉으로 옮기면서 그 두 필드가 통째로 사라져(스킬은
 * 더 이상 `StatKey` 에 수치를 더하지 않는다) 그 함수를 재사용할 수 없다. 연구소 화면
 * (`src/ui/pixi/researchLab.ts`)이 직접 갖는 새 순수 함수 `skillNodeIconName` 은 지금 데이터에서
 * 유도 가능한 유일한 시각 축인 **축(affinity)** 으로 접는다 — 없는 스탯 데이터를 추측해 옛날
 * 처럼 스탯별 아이콘을 고르지 않는다.
 *
 * 실제 PNG 자산(`skill_axis_*.png`)은 아직 없다 — `uiTextures.ts` 의 `SKILL_ICON_NAMES`/
 * `UI_ASSET_NAMES` 레지스트리(이 레인의 담당 밖)에 등재되지 않았으므로 렌더는 계열색
 * placeholder 로 우아하게 폴백한다(`makeSkillIcon` null 폴백 규약). 그래서 이 테스트는 파일
 * 존재를 보지 않고 **이름 유도 규칙**만 고정한다.
 */

import { describe, it, expect } from 'vitest';
import { skillNodeIconName } from '../src/ui/pixi/researchLab.js';
import { SHIP_TYPES, STRIKER, flattenShipNodes, TREE_AFFINITIES } from '../data/ships/index.js';

describe('skillNodeIconName', () => {
  it('derives icon names as skill_axis_<affinity>.png', () => {
    // 스트라이커 축0 = firepower(offense), 축1 = survival(defense), 축2 = mobility(utility).
    const nodes = flattenShipNodes(STRIKER);
    expect(skillNodeIconName(nodes[0]!)).toBe('skill_axis_offense.png');
    expect(skillNodeIconName(nodes[10]!)).toBe('skill_axis_defense.png');
    expect(skillNodeIconName(nodes[20]!)).toBe('skill_axis_utility.png');
  });

  it('shares one icon across every node in the same axis (by design)', () => {
    // 축당 10스킬이 전부 같은 그림을 쓴다 — 구별은 이름과 설명 툴팁이 한다.
    const nodes = flattenShipNodes(STRIKER);
    const axisOffense = nodes.slice(0, 10).map(skillNodeIconName);
    expect(new Set(axisOffense).size).toBe(1);
  });

  it('resolves to a name matching the registered file-name shape', () => {
    for (const def of SHIP_TYPES) {
      for (const node of flattenShipNodes(def)) {
        const name = skillNodeIconName(node);
        expect(name, `${def.slug} / ${node.id}`).toMatch(/^skill_axis_[a-z]+\.png$/);
      }
    }
  });

  it('folds every ship type down to exactly 3 icons — one per affinity, no more', () => {
    for (const def of SHIP_TYPES) {
      const names = new Set(flattenShipNodes(def).map(skillNodeIconName));
      expect(names.size, def.slug).toBe(TREE_AFFINITIES.length);
    }
  });

  it('is a pure function of axis alone — same affinity always yields the same name across ship types', () => {
    const byAffinity = new Map<string, string>();
    for (const def of SHIP_TYPES) {
      for (const node of flattenShipNodes(def)) {
        const name = skillNodeIconName(node);
        const prior = byAffinity.get(node.axis);
        if (prior === undefined) byAffinity.set(node.axis, name);
        else expect(name, `${def.slug} / ${node.id}`).toBe(prior);
      }
    }
    expect(byAffinity.size).toBe(TREE_AFFINITIES.length);
  });
});
