/**
 * 파워업 → 아이콘 키 매핑 테스트 (src/ui/powerupIcons.ts).
 *
 * 아이콘 0장 전략(ADR-0015)의 계약을 고정한다:
 *  1) 24종 전부가 매핑돼 있고, 키가 **텍스처 로더에 실재하는** 이름으로 해석된다
 *     (없는 티어대를 가리키면 아이콘이 조용히 사라지므로 UI_ASSET_NAMES 와 대조한다).
 *  2) weaponType 이 있는 파워업만 무기 배지를 갖고, 배지 무기가 그 weaponType 과 일치한다.
 *  3) 스탯+티어대+배지 조합이 24종 전부를 구별한다(충돌 0).
 *
 * UI 를 거치지 않는 순수 매핑 검증이라 DOM 없이 돈다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { POWERUPS } from '../src/sim/powerups.js';
import {
  powerupIconKeys,
  powerupIconKeysById,
  allPowerupIconKeys,
} from '../src/ui/powerupIcons.js';
import { UI_ASSET_NAMES } from '../src/ui/pixi/uiTextures.js';

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
      expect(keys?.statKey).toMatch(/^skill_[a-z0-9_]+_(low|lowmid|mid|midhigh|high)$/);
    }
  });

  it('모든 키(스탯·배지)가 텍스처 로더에 등재된 실재 자산을 가리킨다', () => {
    // 로더 등재 목록에 없는 이름을 가리키면 텍스처를 아예 찾지 않는다 — 그 회귀를 여기서 잡는다.
    const registered = new Set<string>(UI_ASSET_NAMES);
    for (const def of POWERUPS) {
      const keys = powerupIconKeysById(def.id);
      expect(registered.has(`${keys?.statKey ?? '?'}.png`), `${def.id} statKey 미등재`).toBe(true);
      if (keys?.badgeKey !== undefined) {
        expect(registered.has(`${keys.badgeKey}.png`), `${def.id} badgeKey 미등재`).toBe(true);
      }
    }
  });

  it('모든 키가 **실물 PNG 파일**을 가리킨다 (2026-07-27 사용자 신고 회귀 가드)', () => {
    // ⚠️ 위 "등재" 테스트만으로는 부족하다 — 등재 목록은 *이름* 축이고 PNG 는 *파일* 축이라,
    // 이름만 있고 파일이 없는 조합이 성립한다. 실제로 '집속 렌즈'(beam-focuser)가
    // `skill_range_flat_lowmid`(이름 O · 파일 X)를 가리켜 3택 카드에 그림이 통째로 안 떴고,
    // 그때도 이 파일의 다른 테스트는 전부 그린이었다. 그래서 파일 존재를 직접 확인한다.
    const assetsDir = new URL('../assets/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const has = (name: string): boolean => {
      try {
        readFileSync(`${assetsDir}${name}.png`);
        return true;
      } catch {
        return false;
      }
    };
    for (const def of POWERUPS) {
      const keys = powerupIconKeysById(def.id);
      expect(has(keys?.statKey ?? '?'), `${def.id} statKey PNG 부재: ${keys?.statKey}`).toBe(true);
      if (keys?.badgeKey !== undefined) {
        expect(has(keys.badgeKey), `${def.id} badgeKey PNG 부재: ${keys.badgeKey}`).toBe(true);
      }
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

  it('전체 24종이 서로 구별된다 — 티어대 축이 배지 없는 충돌을 없앤다', () => {
    // 스탯+배지 둘만 쓰던 때는 17종으로 접혔다(최대 HP 3종, 데미지·연사·이속·대시·자석
    // 각 2종 = 충돌 7건). 같은 스탯을 수치 크기 순으로 티어대(5구간 중 기존 아트 밴드
    // low/mid/high 우선)에 나눠 담아 해소했다. 이 수가 24 미만으로 떨어지면 3택 오버레이에
    // 같은 그림이 두 장 뜬다는 뜻이다.
    expect(new Set(combos).size).toBe(24);
  });

  it('같은 스탯의 배지 없는 파워업은 서로 다른 티어대를 쓴다', () => {
    // 예: field-medkit(+15) / reinforced-hull(+25) / sv-plating(+30) 은 최대 HP 저·중·고.
    const byStat = new Map<string, string[]>();
    for (const def of POWERUPS) {
      const k = powerupIconKeysById(def.id);
      if (k === undefined || k.badgeKey !== undefined) continue;
      const stat = k.statKey.replace(/_(low|lowmid|mid|midhigh|high)$/, '');
      byStat.set(stat, [...(byStat.get(stat) ?? []), k.statKey]);
    }
    for (const [stat, keys] of byStat) {
      expect(new Set(keys).size, `${stat} 티어대 충돌: ${keys.join(', ')}`).toBe(keys.length);
    }
  });
});
