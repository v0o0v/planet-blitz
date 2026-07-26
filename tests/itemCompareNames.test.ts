/**
 * 장비 비교 + 표시 이름 (사용자 요청 2026-07-27).
 *
 * 두 축을 한 파일에서 고정한다 — 둘 다 "툴팁이 무엇을 말하는가"의 순수 계층이고, Pixi 표시
 * 객체는 node 환경에서 만들 수 없어 화면 클래스로는 검증할 수 없다(방어 사령부 테스트 규율).
 *
 * A. `itemCompare` — 스탯 증감 방향·색, 한쪽에만 있는 스탯, 비교 대상 없음/자기 자신.
 * B. `itemNames`  — 무기 5종·보조무기 5종이 **실제 롤 범위와 같은 수**로 이름을 갖는다.
 *    (이 표가 3종에서 낡아 미사일·빔이 `?`/`발칸` 으로 표시된 것이 이번 신고의 원인이다.)
 */

import { describe, it, expect } from 'vitest';
import {
  compareLines,
  statTotals,
  COMPARE_UP_COLOR,
  COMPARE_DOWN_COLOR,
} from '../src/ui/itemCompare.js';
import {
  WEAPON_KEYS,
  SUB_WEAPON_KEYS,
  itemDisplayName,
  subWeaponLabel,
  weaponLabel,
} from '../src/ui/itemNames.js';
import { SUB_WEAPON_VARIANTS } from '../src/items/loadout.js';
import type { AffixRoll, Item } from '../src/items/types.js';

/** 어픽스 목록으로 최소 아이템을 짓는다(비교는 slot/rarity 를 보지 않는다). */
function item(id: string, affixes: AffixRoll[]): Item {
  return {
    id,
    slot: 'engine',
    rarity: 'rare',
    affixes,
    source: { planet: 0, stage: 1 },
  };
}

const dmg = (v: number): AffixRoll => ({ id: 'sharp', stat: 'damagePct', value: v });
const spd = (v: number): AffixRoll => ({ id: 'swift', stat: 'moveSpeedPct', value: v });

// ---------------------------------------------------------------------------
// A. 장비 비교
// ---------------------------------------------------------------------------

describe('장비 비교 — 스탯 증감', () => {
  it('오른 스탯은 초록 ▲, 내린 스탯은 빨강 ▼', () => {
    const lines = compareLines(item('a', [dmg(18)]), item('b', [dmg(8)]));
    const dmgLine = lines.find((l) => l.text.includes('▲'));
    expect(dmgLine?.color).toBe(COMPARE_UP_COLOR);
    expect(dmgLine?.text).toContain('10%'); // 18 − 8

    const down = compareLines(item('a', [dmg(4)]), item('b', [dmg(9)]));
    const downLine = down.find((l) => l.text.includes('▼'));
    expect(downLine?.color).toBe(COMPARE_DOWN_COLOR);
    expect(downLine?.text).toContain('5%');
  });

  it('장착 장비에만 있는 스탯은 "사라진다"로 보인다(상대를 0 으로 본다)', () => {
    const lines = compareLines(item('a', [dmg(10)]), item('b', [dmg(10), spd(6)]));
    // 피해량은 동일해 줄이 안 나고, 이속만 감소로 남는다.
    const texts = lines.map((l) => l.text);
    expect(texts.some((tx) => tx.includes('▼') && tx.includes('6%'))).toBe(true);
    expect(texts.some((tx) => tx.includes('▲'))).toBe(false);
  });

  it('같은 값 스탯은 줄을 만들지 않는다(판단에 기여하지 않는 줄 제거)', () => {
    const lines = compareLines(item('a', [dmg(10)]), item('b', [dmg(10)]));
    expect(lines.some((l) => l.text.includes('▲') || l.text.includes('▼'))).toBe(false);
  });

  it('비교 대상이 없거나 자기 자신이면 빈 배열', () => {
    const it0 = item('a', [dmg(10)]);
    expect(compareLines(it0, undefined)).toEqual([]);
    expect(compareLines(it0, item('a', [dmg(99)]))).toEqual([]); // 같은 id = 같은 아이템
  });

  it('플래그 스탯(냉기)은 빈 수치가 아니라 추가/사라짐으로 말한다', () => {
    // `statValueText` 가 플래그 stat 에 빈 문자열을 내므로 그대로 쓰면 `냉기 ▲ ` 가 됐다(실측).
    const cold: AffixRoll = { id: 'frozen', stat: 'coldSlow', value: 1 };
    const added = compareLines(item('a', [cold]), item('b', []));
    const coldLine = added.find((l) => l.text.startsWith('냉기'));
    expect(coldLine?.text).not.toMatch(/[▲▼]\s*$/); // 화살표 뒤가 비면 안 된다
    expect(coldLine?.color).toBe(COMPARE_UP_COLOR);

    const lost = compareLines(item('a', []), item('b', [cold]));
    expect(lost.find((l) => l.text.startsWith('냉기'))?.color).toBe(COMPARE_DOWN_COLOR);
  });

  it('전투력 델타 0 은 `0` 이 아니라 `±0` 으로 적는다(델타임이 드러나야 한다)', () => {
    const same = compareLines(item('a', [dmg(10)]), item('b', [dmg(10)]));
    const powerLine = same.find((l) => l.text.includes('전투력'));
    expect(powerLine?.text).toContain('±0');
  });

  it('같은 스탯 어픽스가 여럿이면 합산해 비교한다', () => {
    expect(statTotals([dmg(5), dmg(7)]).get('damagePct')).toBe(12);
    const lines = compareLines(item('a', [dmg(5), dmg(7)]), item('b', [dmg(2)]));
    expect(lines.some((l) => l.text.includes('▲') && l.text.includes('10%'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B. 표시 이름
// ---------------------------------------------------------------------------

describe('장비 표시 이름 — 무기 종류', () => {
  it('주무기 키 표가 실제 롤 범위(0..4)와 같은 수다', () => {
    // roll.ts: `slot === 'main'` 이면 weaponType = rng.int(0, 4) → 5종.
    expect(WEAPON_KEYS.length).toBe(5);
  });

  it('보조무기 키 표가 SUB_WEAPON_VARIANTS 와 같은 수다', () => {
    expect(SUB_WEAPON_KEYS.length).toBe(SUB_WEAPON_VARIANTS);
  });

  it('무기 5종이 서로 다른 이름을 갖는다 — 미사일·빔이 물음표/발칸이 아니다', () => {
    const names = [0, 1, 2, 3, 4].map(weaponLabel);
    expect(new Set(names).size).toBe(5);
    for (const n of names) expect(n).not.toBe('?');
    expect(names[3]).not.toBe(names[0]); // 미사일 ≠ 발칸(폴백 오표기 회귀 가드)
    expect(names[4]).not.toBe(names[0]); // 빔 ≠ 발칸
  });

  it('보조무기 5종이 서로 다른 이름을 갖는다', () => {
    const names = [0, 1, 2, 3, 4].map(subWeaponLabel);
    expect(new Set(names).size).toBe(5);
    for (const n of names) expect(n).not.toBe('?');
  });

  it('범위 밖은 조용한 오표기가 아니라 물음표다', () => {
    expect(weaponLabel(9)).toBe('?');
    expect(subWeaponLabel(-1)).toBe('?');
  });

  it('무기 아이템은 `슬롯 · 종류`, 비무기는 슬롯명', () => {
    const beam = { slot: 'main' as const, weaponType: 4 };
    const mine = { slot: 'sub' as const, weaponType: 2 };
    const core = { slot: 'core' as const };
    expect(itemDisplayName(beam)).toContain(weaponLabel(4));
    expect(itemDisplayName(mine)).toContain(subWeaponLabel(2));
    expect(itemDisplayName(core)).not.toContain('·');
  });
});
