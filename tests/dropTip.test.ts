/**
 * 정산 획득 장비 hover 상세 팝업(사용자 요청 2026-07-26) — 툴팁 내용 계약.
 *
 * Pixi 표시 객체는 node 환경에서 만들 수 없으므로(방어 사령부 테스트와 같은 규율) 화면이 쓰는
 * 순수 조립 함수 `dropTipContent` 를 직접 검증한다.
 *
 * 검증 축:
 *  (a) 실물 아이템이 실리면 어픽스 줄·요구 레벨·전투력이 나온다(= "격납고 안 가도 판단 가능").
 *  (b) 요구 레벨 미달이면 빨강, 충족이면 무채색.
 *  (c) 아이템이 없으면(구 경로) 기존 최소 표시로 내려앉는다 — 던지지 않는다.
 *  (d) raw StatKey 를 노출하지 않는다(2026-07-26 사용자 지적의 회귀 가드).
 */

import { describe, it, expect } from 'vitest';
import { dropTipContent } from '../src/ui/dropTip.js';
import { rollItem } from '../src/items/roll.js';
import { requiredLevel } from '../src/items/requiredLevel.js';
import { itemCombatPower } from '../src/save/combatPower.js';
import type { ResultDrop } from '../src/ui/resultOverlay.js';

/** 어픽스가 확실히 붙는 레어 1개(드랍 시드 고정 — 같은 시드는 항상 같은 아이템). */
const item = rollItem(987654321, 'rare', { planet: 0, stage: 1 });
const drop: ResultDrop = {
  rarity: item.rarity,
  slot: item.slot,
  ...(item.weaponType !== undefined ? { weaponType: item.weaponType } : {}),
  item,
};

describe('정산 장비 상세 팝업', () => {
  it('어픽스 · 요구 레벨 · 전투력을 모두 보여준다', () => {
    const c = dropTipContent(drop, 100);
    expect(item.affixes.length).toBeGreaterThan(0);
    // 어픽스 1개당 제목 줄 + 설명 줄 2줄.
    expect(c.lines.length).toBe(item.affixes.length * 2);
    expect(c.reqLine?.text).toContain(String(requiredLevel(item)));
    expect(c.compare).toContain(String(itemCombatPower(item)));
  });

  it('요구 레벨 미달이면 빨강, 충족이면 무채색', () => {
    const req = requiredLevel(item);
    const met = dropTipContent(drop, req);
    const unmet = dropTipContent(drop, req - 1);
    expect(met.reqLine?.color).not.toBe(unmet.reqLine?.color);
    expect(unmet.reqLine?.color).toBe(0xff5a5a);
  });

  it('아이템이 없으면 최소 표시로 내려앉는다', () => {
    const bare: ResultDrop = { rarity: 'magic', slot: 'core' };
    const c = dropTipContent(bare, 1);
    expect(c.lines).toEqual([]);
    expect(c.reqLine).toBeUndefined();
    expect(c.compare).toBeUndefined();
    expect(c.title.length).toBeGreaterThan(0);
    expect(c.subtitle.length).toBeGreaterThan(0);
  });

  it('raw StatKey 를 노출하지 않는다', () => {
    const c = dropTipContent(drop, 100);
    for (const line of c.lines) {
      expect(line).not.toMatch(/damagePct|fireRatePct|maxHpFlat|moveSpeedPct/);
    }
  });
});
