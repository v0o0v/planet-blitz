/**
 * 연구소 스킬 노드 아이콘 매핑 검증 (노드 → 아이콘 basename).
 *
 * `skillIconName` 은 UI-독립 순수 함수라(노드 → 문자열) 단위 테스트로 고정한다. 이 테스트가
 * 지키는 것은 두 가지다:
 *  1. 63노드 **전부**가 로더에 등재된 유효한 이름으로 해석된다(빠진 노드 = 빈 셀).
 *  2. 스탯 노드 60개가 정확히 32개 키로 접히고 캡스톤 3개는 개별 키로 떨어진다 —
 *     티어대 경계(저 0~1 / 중 2~3 / 고 4)가 나중에 어긋나면 여기서 깨진다.
 *
 * 자산 PNG 가 아직 없어도 통과해야 한다(파일 존재를 보지 않는다).
 */

import { describe, it, expect } from 'vitest';
import { SKILLS, SKILL_NODE_COUNT, capstoneIndex, SKILL_TREES } from '../data/skills.js';
import { SHIP_TYPES, flattenShipNodes } from '../data/ships/index.js';
import { UI_ASSET_NAMES, SKILL_ICON_NAMES, skillIconBand, skillIconName } from '../src/ui/pixi/uiTextures.js';

describe('skillIconBand', () => {
  it('groups tiers 0~1 low, 2~3 mid, 4 high', () => {
    expect(skillIconBand(0)).toBe('low');
    expect(skillIconBand(1)).toBe('low');
    expect(skillIconBand(2)).toBe('mid');
    expect(skillIconBand(3)).toBe('mid');
    expect(skillIconBand(4)).toBe('high');
  });
});

describe('skillIconName', () => {
  it('derives stat icons as skill_<snake_stat>_<band>.png', () => {
    // firepower-0-0 = 집중 사격(damagePct, tier 0), firepower-4-0 = 초토화 프로토콜(tier 4).
    expect(skillIconName(SKILLS[0]!)).toBe('skill_damage_pct_low.png');
    expect(skillIconName(SKILLS[16]!)).toBe('skill_damage_pct_high.png');
    // survival-1-1 = 생체 강화(maxHpPct, tier 1) — camelCase 가 snake_case 로 접히는지.
    expect(skillIconName(SKILLS[25]!)).toBe('skill_max_hp_pct_low.png');
  });

  it('gives each capstone its own art (stat/perPoint are placeholders there)', () => {
    for (const tree of SKILL_TREES) {
      expect(skillIconName(SKILLS[capstoneIndex(tree)]!)).toBe(`skill_capstone_${tree}.png`);
    }
  });

  it('shares one icon across nodes with the same stat and tier band (by design)', () => {
    // 예리한/잔혹한 류 — firepower-0-0(집중 사격)과 firepower-0-1(정밀 조준)은 둘 다
    // damagePct tier 0 이라 같은 그림을 쓴다. 구별은 이름과 포인트 배지가 한다.
    expect(skillIconName(SKILLS[1]!)).toBe(skillIconName(SKILLS[0]!));
  });

  it('resolves all 63 nodes to a name registered in the texture loader', () => {
    const registered = new Set<string>(UI_ASSET_NAMES);
    expect(SKILLS).toHaveLength(SKILL_NODE_COUNT);
    for (const node of SKILLS) {
      const name = skillIconName(node);
      expect(name).toMatch(/^skill_[a-z_]+\.png$/);
      expect(registered.has(name)).toBe(true);
    }
  });

  it('folds the 60 stat nodes into exactly 32 distinct icons + 3 capstones', () => {
    const stat = new Set(SKILLS.filter((n) => n.capstone !== true).map(skillIconName));
    const caps = new Set(SKILLS.filter((n) => n.capstone === true).map(skillIconName));
    expect(stat.size).toBe(32);
    expect(caps.size).toBe(3);
    for (const name of caps) expect(stat.has(name)).toBe(false);
  });

  it('keeps SKILL_ICON_NAMES exactly equal to what ALL ship types need (no dead art, no null fallback)', () => {
    // ⚠️ M8(설계서 §10-7): 스트라이커(`SKILLS`)만 순회하면 신규 기체 트리가 만든 새 (스탯,
    // 티어대) 조합이 목록에 없어도 **그린이다** — 렌더는 null 을 예외 없이 삼키므로 화면에서
    // 빈 셀로만 드러난다. 실측으로 4건(range_flat_mid/high · bullet_speed_pct_high ·
    // bullet_count_low)이 이 상태였다. 그래서 전 SHIP_TYPES 를 순회한다.
    const needed = new Set<string>();
    for (const def of SHIP_TYPES) {
      for (const node of flattenShipNodes(def)) needed.add(skillIconName(node));
    }
    expect([...SKILL_ICON_NAMES].sort()).toEqual([...needed].sort());
  });

  it('resolves every node of every ship type to a registered loader name', () => {
    const registered = new Set<string>(UI_ASSET_NAMES);
    for (const def of SHIP_TYPES) {
      for (const node of flattenShipNodes(def)) {
        const name = skillIconName(node);
        expect(name, `${def.slug} / ${node.id}`).toMatch(/^skill_[a-z_]+\.png$/);
        expect(registered.has(name), `${def.slug} / ${node.id} → ${name}`).toBe(true);
      }
    }
  });
});
