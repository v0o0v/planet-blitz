/**
 * 연구소 스킬 아이콘 이름 규약 검증 (스킬 → 아이콘 basename).
 *
 * ## 이 파일이 두 번 뒤집힌 내력 — 축을 바꿀 때마다 여기가 정본이다
 *
 * 구 `skillIconName`(`uiTextures.ts`)은 `SkillNode.stat`+`tier` 에서 62종을 유도했다.
 * ADR-0049 가 스킬을 메커닉으로 옮기며 그 두 필드가 사라져, 한동안 유도 가능한 축이
 * **affinity 뿐**이라 210노드가 축 아이콘 3장을 공유했다.
 *
 * 2026-08-08 에 그 3장 공유가 화면에서 실패로 드러났다 — 목록 210행이 전부 같은 그림이고,
 * 그 그림이 어두운 원판 위 작은 문양이라 48px 상자에서 **깨진 아이콘처럼** 보였다. 그래서
 * 축을 **스킬 인스턴스**로 올렸다(액티브 42종이 먼저 밟은 ADR-0015 예외). 이 파일은 그
 * 규약을 못 박는다 — 축 폴백은 살아 있되, 개별 이름이 정본이라는 것.
 *
 * 실물 PNG 존재는 여기서 보지 않는다. 그 축은 `tests/uiAssetPresence.test.ts` 가
 * **등재 = 실물** 로 양방향 강제한다(등재만 하고 아트가 없으면 거기서 깨진다).
 */

import { describe, it, expect } from 'vitest';
import { skillNodeIconName, skillAxisIconName, SKILL_ICON_NAMES } from '../src/ui/pixi/uiTextures.js';
import { SHIP_TYPES, STRIKER, flattenShipNodes, TREE_AFFINITIES } from '../data/ships/index.js';

const ALL_NODES = SHIP_TYPES.flatMap((def) => flattenShipNodes(def));

describe('skillNodeIconName', () => {
  it('derives one icon name per skill from its global slug id', () => {
    const nodes = flattenShipNodes(STRIKER);
    expect(nodes[0]!.id).toBe('striker-kill-momentum');
    expect(skillNodeIconName(nodes[0]!)).toBe('skill_striker_kill_momentum.png');
  });

  it('matches the registered file-name shape for every node', () => {
    for (const node of ALL_NODES) {
      expect(skillNodeIconName(node), node.id).toMatch(/^skill_[a-z0-9_]+\.png$/);
    }
  });

  it('is injective — 210 skills, 210 distinct icons, no sharing', () => {
    // 이것이 이 레인의 결정 그 자체다. 다시 공유로 되돌리면 여기서 깨진다.
    expect(ALL_NODES.length).toBe(210);
    expect(new Set(ALL_NODES.map(skillNodeIconName)).size).toBe(210);
  });

  it('registers every derived name in SKILL_ICON_NAMES', () => {
    // 목록이 파생이므로 항진처럼 보이지만, 유도 규칙과 목록 조립이 서로 다른 함수를 타면
    // (예: 목록만 손으로 나열로 되돌리면) 즉시 갈린다 — 그 갈림을 잡는 자리다.
    const registered = new Set(SKILL_ICON_NAMES);
    const unregistered = ALL_NODES.map(skillNodeIconName).filter((n) => !registered.has(n));
    expect(unregistered).toEqual([]);
  });
});

describe('skillAxisIconName (폴백)', () => {
  it('folds to exactly one icon per affinity', () => {
    const byAffinity = new Map<string, string>();
    for (const node of ALL_NODES) {
      const name = skillAxisIconName(node);
      expect(name, node.id).toBe(`skill_axis_${node.axis}.png`);
      const prior = byAffinity.get(node.axis);
      if (prior === undefined) byAffinity.set(node.axis, name);
      else expect(name, node.id).toBe(prior);
    }
    expect(byAffinity.size).toBe(TREE_AFFINITIES.length);
  });

  it('keeps the three axis fallbacks registered (아트가 늦게 오는 슬롯이 받는다)', () => {
    const registered = new Set(SKILL_ICON_NAMES);
    for (const axis of TREE_AFFINITIES) {
      expect(registered.has(`skill_axis_${axis}.png`), axis).toBe(true);
    }
  });
});
