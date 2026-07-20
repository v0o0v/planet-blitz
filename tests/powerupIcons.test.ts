/**
 * 파워업 → 아이콘 키 매핑 테스트 (src/ui/powerupIcons.ts).
 *
 * 아이콘 0장 전략(ADR-0015)의 계약을 고정한다:
 *  1) 24종 전부가 매핑돼 있고, 키가 스킬/장비 세트의 명명 규약을 따른다.
 *  2) weaponType 이 있는 파워업만 무기 배지를 갖고, 배지 무기가 그 weaponType 과 일치한다.
 *  3) 스탯+배지 조합의 충돌 수가 문서화된 값과 같다(무기 파생 8종은 모두 구별된다).
 *
 * UI 를 거치지 않는 순수 매핑 검증이라 DOM 없이 돈다.
 */

import { describe, it, expect } from 'vitest';
import { POWERUPS } from '../src/sim/powerups.js';
import {
  powerupIconKeys,
  powerupIconKeysById,
  allPowerupIconKeys,
} from '../src/ui/powerupIcons.js';

/** 매니페스트의 무기 코드 → equip_main_* 키(장비 세트 명명). */
const WEAPON_BADGE: Record<number, string> = {
  0: 'equip_main_vulcan',
  1: 'equip_main_spread',
  2: 'equip_main_railgun',
  3: 'equip_main_missile',
  4: 'equip_main_beam',
};

describe('powerupIcons — 24종 매핑 커버리지', () => {
  it('풀의 모든 파워업이 유효한 스탯 아이콘 키로 해석된다', () => {
    expect(POWERUPS.length).toBe(24);
    for (let i = 0; i < POWERUPS.length; i++) {
      const keys = powerupIconKeys(i);
      expect(keys, `powerup #${i} 매핑 누락`).toBeDefined();
      expect(keys?.statKey).toMatch(/^skill_[a-z0-9_]+_(low|mid|high)$/);
    }
  });

  it('매핑 표에 풀 밖의 잉여 항목이 없다', () => {
    const ids = new Set(POWERUPS.map((p) => p.id));
    for (const id of Object.keys(allPowerupIconKeys())) {
      expect(ids.has(id), `풀에 없는 id: ${id}`).toBe(true);
    }
  });

  it('범위 밖 인덱스는 undefined(텍스트 폴백)', () => {
    expect(powerupIconKeys(-1)).toBeUndefined();
    expect(powerupIconKeys(999)).toBeUndefined();
    expect(powerupIconKeysById('nope')).toBeUndefined();
  });
});

describe('powerupIcons — 무기 배지', () => {
  it('weaponType 이 있는 파워업만 배지를 갖고, 배지 무기가 일치한다', () => {
    for (const def of POWERUPS) {
      const keys = powerupIconKeysById(def.id);
      if (def.weaponType === undefined) {
        expect(keys?.badgeKey, `${def.id} 는 배지가 없어야 한다`).toBeUndefined();
        continue;
      }
      // 발칸(0)은 기본 무기라 매니페스트가 배지를 달지 않는다.
      if (def.weaponType === 0) {
        expect(keys?.badgeKey).toBeUndefined();
        continue;
      }
      expect(keys?.badgeKey).toBe(WEAPON_BADGE[def.weaponType]);
    }
  });
});

describe('powerupIcons — 조합 구별도', () => {
  const combos = POWERUPS.map((def) => {
    const k = powerupIconKeysById(def.id);
    return `${k?.statKey ?? '?'}|${k?.badgeKey ?? ''}`;
  });

  it('무기 파생 8종은 서로 모두 구별된다(같은 스탯도 배지로 갈린다)', () => {
    const badged = POWERUPS.map((def, i) => ({ def, combo: combos[i] as string })).filter(
      (e) => powerupIconKeysById(e.def.id)?.badgeKey !== undefined,
    );
    expect(badged.length).toBe(8);
    expect(new Set(badged.map((e) => e.combo)).size).toBe(8);
  });

  it('전체 조합은 17종 — 배지 없는 파워업끼리의 충돌 7건은 의도된 상태다', () => {
    // 예: reinforced-hull / sv-plating / field-medkit 은 모두 "최대 HP" 아이콘을 쓴다.
    // 배지를 붙일 무기 축이 없어 아이콘만으로는 갈리지 않고, 카드의 이름·설명 텍스트가
    // 구별을 담당한다. 이 수가 바뀌면 매핑 변경이 의도된 것인지 확인하라.
    expect(new Set(combos).size).toBe(17);
  });
});
