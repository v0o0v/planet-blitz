/**
 * 액티브 스킬 **화면 배선** 검증 (ADR-0041 · 레인 D · AC-16·17·18).
 *
 * 여기서 잠그는 것은 셋이다.
 *  · AC-16 잠긴 칸이 `unlocked=false` 이고 **필요 투자량이 노출**된다(문구가 아니라 값으로).
 *  · AC-17 장착/해제가 **프로필에 반영되고 재로드 후 살아남는다**(연구소 저장 경로 그대로).
 *  · AC-18 `HudState` 에 액티브가 실리고 쿨다운 진행률이 계산된다.
 *
 * ⚠️ **레이아웃 겹침은 렌더로 증명하지 않는다.** UI 테스트의 캔버스 스텁은 글자를 실제보다
 * 작게 재서 겹침을 통과시킨다(실측 결함). 그래서 좌표 부등식만 단언한다 — 상수를 건드려
 * 칸이 상자를 넘거나 줄이 겹치면 여기서 즉시 깨진다.
 */

import { describe, it, expect } from 'vitest';
import {
  ACTIVES_PANEL,
  activeCellWidth,
  activeGridCells,
} from '../src/ui/pixi/researchLab.js';
import { activeSlotViews, equipActive, unequipActive } from '../src/items/activeSkills.js';
import { activeCooldownFraction, hudActives, type HudState } from '../src/ui/hud.js';
import { ACTIVES_BY_SHIP, activeCooldownTicks, investedInTree, wireIdOf } from '../data/ships/actives/index.js';
import { ACTIVE_SLOT_COUNT, activeSkillIconName } from '../data/ships/actives/types.js';
import { SHIP_TYPES, shipTreeRange, zeroSkillInvest } from '../data/ships/index.js';
import { defaultProfile, saveProfile, loadProfile, activeShip } from '../src/save/profile.js';
import { createWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { KeyValueStore } from '../src/save/profile.js';

/** 메모리 KV 스토어 — 저장 → 재로드 왕복을 실제 직렬화 경로로 태운다. */
function memStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

/** 액티브가 저작된 첫 기체 타입(레지스트리가 자라도 따라온다). 없으면 null. */
function firstAuthoredShip(): number | null {
  for (let i = 0; i < ACTIVES_BY_SHIP.length; i++) {
    if ((ACTIVES_BY_SHIP[i]?.length ?? 0) > 0) return i;
  }
  return null;
}

/** 그 계열의 첫 base 노드에 `pt` 를 몰아넣은 투자 벡터(게이트를 넘기는 최소 조작). */
function investTree(shipTypeId: number, treeIndex: number, pt: number): number[] {
  const def = SHIP_TYPES[shipTypeId]!;
  const invest = zeroSkillInvest(def.id);
  const { start, end } = shipTreeRange(def, treeIndex);
  let left = pt;
  for (let i = start; i < end && left > 0; i++) {
    const take = Math.min(left, 5);
    invest[i] = take;
    left -= take;
  }
  return invest;
}

// ---------------------------------------------------------------------------
// AC-16 — 잠긴 칸은 잠겨 있고, 필요 투자량이 값으로 노출된다
// ---------------------------------------------------------------------------

describe('AC-16 · 연구소 액티브 칸의 해금 표시', () => {
  it('투자 0 이면 6칸 전부 잠기고 threshold 가 양수로 노출된다', () => {
    const ship = firstAuthoredShip();
    if (ship === null) return; // 저작 전(빈 레지스트리)이면 이 단언은 성립할 대상이 없다.
    const def = SHIP_TYPES[ship]!;
    const views = activeSlotViews(ship, zeroSkillInvest(def.id), [null, null]);
    expect(views.length).toBe(ACTIVES_BY_SHIP[ship]!.length);
    for (const v of views) {
      expect(v.unlocked, `${v.def.id} 가 투자 0 에서 열려 있다`).toBe(false);
      expect(v.threshold).toBeGreaterThan(0);
      expect(v.invested).toBe(0);
      expect(v.equippedSlot).toBe(-1);
    }
  });

  it('고티어 문턱은 기체별 capstoneGate 를 추종한다(해츨링만 44 — 숫자 하드코딩 금지의 근거)', () => {
    for (let ship = 0; ship < ACTIVES_BY_SHIP.length; ship++) {
      const list = ACTIVES_BY_SHIP[ship] ?? [];
      if (list.length === 0) continue;
      const def = SHIP_TYPES[ship]!;
      const views = activeSlotViews(ship, zeroSkillInvest(def.id), [null, null]);
      for (const v of views) {
        expect(v.threshold, `${v.def.id}`).toBe(v.def.tier === 'lo' ? 8 : def.capstoneGate);
      }
    }
  });

  it('계열 문턱을 넘기면 그 계열의 저티어만 열린다', () => {
    const ship = firstAuthoredShip();
    if (ship === null) return;
    const invest = investTree(ship, 0, 8);
    const views = activeSlotViews(ship, invest, [null, null]);
    const tree0 = views.filter((v) => v.def.treeIndex === 0);
    expect(tree0.find((v) => v.def.tier === 'lo')?.unlocked).toBe(true);
    expect(tree0.find((v) => v.def.tier === 'hi')?.unlocked).toBe(false);
    for (const v of views.filter((x) => x.def.treeIndex !== 0)) {
      expect(v.unlocked, `${v.def.id} 가 다른 계열 투자로 열렸다`).toBe(false);
    }
  });

  it('쿨다운은 투자에 대해 단조 감소하고 위력은 단조 증가한다(칸에 표시되는 값)', () => {
    const ship = firstAuthoredShip();
    if (ship === null) return;
    const lo = activeSlotViews(ship, investTree(ship, 0, 8), [null, null]).find(
      (v) => v.def.treeIndex === 0 && v.def.tier === 'lo',
    )!;
    const hi = activeSlotViews(ship, investTree(ship, 0, 40), [null, null]).find(
      (v) => v.def.treeIndex === 0 && v.def.tier === 'lo',
    )!;
    expect(hi.cooldownTicks).toBeLessThanOrEqual(lo.cooldownTicks);
    expect(hi.powerCenti).toBeGreaterThan(lo.powerCenti);
  });
});

// ---------------------------------------------------------------------------
// AC-16 — 격자 배치(계열 = 열, 티어 = 행). 겹침은 좌표 부등식으로만 단언한다.
// ---------------------------------------------------------------------------

describe('AC-16 · 액티브 팝업 레이아웃', () => {
  it('셀 폭 × 열 수 + 간격이 콘텐츠 상자를 넘지 않는다', () => {
    for (const cols of [1, 2, 3, 4]) {
      const w = activeCellWidth(cols);
      expect(w * cols + ACTIVES_PANEL.colGap * (cols - 1)).toBeLessThanOrEqual(ACTIVES_PANEL.boxW);
    }
  });

  it('슬롯 2칸이 콘텐츠 상자 폭 안에 들어간다', () => {
    const total =
      ACTIVES_PANEL.slotW * ACTIVE_SLOT_COUNT + ACTIVES_PANEL.slotGap * (ACTIVE_SLOT_COUNT - 1);
    expect(total).toBeLessThanOrEqual(ACTIVES_PANEL.boxW);
  });

  it('세로 순서가 겹치지 않는다: 상자 상단 ≤ 부제 < 슬롯 < 계열 머리글 < 격자 < 상자 바닥', () => {
    const p = ACTIVES_PANEL;
    // 2026-08-02 AAA 전환: 제목이 콘텐츠 상자 안의 Text 에서 **각인 제목 띠**(상자 위)로 옮겨
    // 갔다. 그래서 부제가 상자 첫 줄이고 `subY === boxY` 다 — 부등호가 아니라 이하가 옳다.
    expect(p.boxY).toBeLessThanOrEqual(p.subY);
    expect(p.subY).toBeLessThan(p.slotY);
    expect(p.slotY + p.slotH).toBeLessThan(p.treeHeadY);
    expect(p.treeHeadY).toBeLessThan(p.gridTop);
    const gridBottom = p.gridTop + p.rows * p.cellH + (p.rows - 1) * p.cellGapY;
    expect(gridBottom).toBeLessThanOrEqual(p.boxBottom);
  });

  it('셀 안쪽 줄이 위에서 아래로 겹치지 않고 셀 높이 안에 머문다', () => {
    const p = ACTIVES_PANEL;
    // 아이콘 상자 아래에 상태 줄이 오고, 이후 메타 → 설명 순.
    expect(p.pad + p.icon).toBeLessThanOrEqual(p.statusY);
    expect(p.statusY).toBeLessThan(p.metaY);
    expect(p.metaY).toBeLessThan(p.descY);
    expect(p.descY).toBeLessThan(p.cellH);
    // 이름은 아이콘 오른쪽에서 시작하고 티어 배지 자리를 침범하지 않는다.
    expect(p.nameX).toBeGreaterThanOrEqual(p.pad + p.icon);
    expect(activeCellWidth(3) - p.nameX - p.pad - p.tierW).toBeGreaterThan(0);
  });

  it('격자가 계열을 열로, 티어를 행으로 나눈다(같은 자리에 두 칸이 겹치지 않는다)', () => {
    const ship = firstAuthoredShip();
    if (ship === null) return;
    const def = SHIP_TYPES[ship]!;
    const views = activeSlotViews(ship, zeroSkillInvest(def.id), [null, null]);
    const cells = activeGridCells(views, def.trees.length);
    expect(cells.length).toBe(views.length);
    const seen = new Set<string>();
    for (const c of cells) {
      const at = `${c.col}:${c.row}`;
      expect(seen.has(at), `격자 자리 ${at} 중복`).toBe(false);
      seen.add(at);
      expect(c.row).toBe(c.view.def.tier === 'lo' ? 0 : 1);
      expect(c.x).toBeGreaterThanOrEqual(ACTIVES_PANEL.boxX);
      expect(c.x + c.w).toBeLessThanOrEqual(ACTIVES_PANEL.boxX + ACTIVES_PANEL.boxW);
      expect(c.y + ACTIVES_PANEL.cellH).toBeLessThanOrEqual(ACTIVES_PANEL.boxBottom);
    }
  });

  it('아이콘 파일명이 규약(`active_<slug>_<n>.png`, n = 1..6)을 따른다', () => {
    for (let ship = 0; ship < ACTIVES_BY_SHIP.length; ship++) {
      const list = ACTIVES_BY_SHIP[ship] ?? [];
      const slug = SHIP_TYPES[ship]!.slug;
      list.forEach((_unused: unknown, i: number) => {
        expect(activeSkillIconName(slug, i)).toBe(`active_${slug}_${i + 1}.png`);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// AC-17 — 장착/해제가 프로필에 반영되고 재로드 후 유지된다
// ---------------------------------------------------------------------------

describe('AC-17 · 장착이 즉시 저장되고 재로드 후 유지된다', () => {
  it('장착 → saveProfile → loadProfile 왕복에서 슬롯이 살아남는다', () => {
    const ship = firstAuthoredShip();
    if (ship === null) return;
    const store = memStore();
    const profile = defaultProfile();
    const s = activeShip(profile);
    s.typeId = ship;
    s.skillInvest = investTree(ship, 0, 8);

    const lo = activeSlotViews(ship, s.skillInvest, s.activeSlots).find(
      (v) => v.def.treeIndex === 0 && v.def.tier === 'lo',
    )!;
    const res = equipActive(ship, s.skillInvest, s.activeSlots, lo.def.id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    s.activeSlots = res.slots;
    // 연구소가 쓰는 저장 경로 그대로(새 경로를 만들지 않는다).
    saveProfile(profile, store);

    const back = loadProfile(store);
    expect(activeShip(back).activeSlots[0]).toBe(lo.def.id);
    // 재로드된 프로필에서도 그 칸이 "장착됨"으로 보인다.
    const view = activeSlotViews(ship, activeShip(back).skillInvest, activeShip(back).activeSlots).find(
      (v) => v.def.id === lo.def.id,
    )!;
    expect(view.equippedSlot).toBe(0);
  });

  it('해제도 왕복에서 유지된다(다시 빈 슬롯)', () => {
    const ship = firstAuthoredShip();
    if (ship === null) return;
    const store = memStore();
    const profile = defaultProfile();
    const s = activeShip(profile);
    s.typeId = ship;
    s.skillInvest = investTree(ship, 0, 8);
    const lo = activeSlotViews(ship, s.skillInvest, s.activeSlots).find(
      (v) => v.def.treeIndex === 0 && v.def.tier === 'lo',
    )!;
    const eq = equipActive(ship, s.skillInvest, s.activeSlots, lo.def.id);
    expect(eq.ok).toBe(true);
    if (!eq.ok) return;
    s.activeSlots = unequipActive(eq.slots, 0);
    saveProfile(profile, store);
    expect(activeShip(loadProfile(store)).activeSlots).toEqual([null, null]);
  });

  it('잠긴 칸은 장착이 거부되고 프로필이 바뀌지 않는다', () => {
    const ship = firstAuthoredShip();
    if (ship === null) return;
    const def = SHIP_TYPES[ship]!;
    const invest = zeroSkillInvest(def.id);
    const first = ACTIVES_BY_SHIP[ship]![0]!;
    const res = equipActive(ship, invest, [null, null], first.id);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('locked');
  });
});

// ---------------------------------------------------------------------------
// AC-18 — HUD 쿨다운 칸
// ---------------------------------------------------------------------------

describe('AC-18 · HUD 액티브 쿨다운', () => {
  it('진행률은 0..1 로 클램프되고 분모 0 은 0 이다', () => {
    expect(activeCooldownFraction(0, 120)).toBe(0);
    expect(activeCooldownFraction(60, 120)).toBe(0.5);
    expect(activeCooldownFraction(120, 120)).toBe(1);
    // 경계 방어: 음수·초과·분모 0/음수에서도 화면에 쓸 수 있는 값만 나온다.
    expect(activeCooldownFraction(-5, 120)).toBe(0);
    expect(activeCooldownFraction(999, 120)).toBe(1);
    expect(activeCooldownFraction(30, 0)).toBe(0);
    expect(activeCooldownFraction(30, -1)).toBe(0);
  });

  it('미장착 런은 빈 배열이라 HUD 가 칸을 감춘다', () => {
    const w = createWorld(1, DEFAULT_CONFIG);
    expect(hudActives(w)).toEqual([]);
  });

  it('장착 런은 슬롯 수만큼 칸이 실리고 이름·쿨다운 최대가 파생된다', () => {
    const ship = firstAuthoredShip();
    if (ship === null) return;
    const shipDef = SHIP_TYPES[ship]!;
    const invest = investTree(ship, 0, 8);
    const lo = ACTIVES_BY_SHIP[ship]!.find((d: { treeIndex: number; tier: string }) => d.treeIndex === 0 && d.tier === 'lo')!;
    const w = createWorld(1, {
      ...DEFAULT_CONFIG,
      shipType: ship,
      skillInvest: invest,
      activeSlots: [wireIdOf(lo.id), -1],
    });
    w.activeCd0 = 30;

    const cells = hudActives(w);
    expect(cells.length).toBe(1);
    const cell = cells[0]!;
    expect(cell.key).toBe('Z');
    expect(cell.name.length).toBeGreaterThan(0);
    // 이름은 i18n 을 거친 값이라 id 그대로가 아니다(폴백이 새는지 잡는다).
    expect(cell.name).not.toBe(lo.id);
    expect(cell.cd).toBe(30);
    expect(cell.cdMax).toBe(activeCooldownTicks(lo, investedInTree(invest, lo)));
    expect(activeCooldownFraction(cell.cd, cell.cdMax)).toBeGreaterThan(0);
    expect(shipDef.slug.length).toBeGreaterThan(0);
  });

  it('다른 기체의 스킬이 실린 손상 구성은 칸을 만들지 않는다', () => {
    const a = firstAuthoredShip();
    if (a === null) return;
    const other = ACTIVES_BY_SHIP.findIndex((l: readonly unknown[] | undefined, i: number) => i !== a && (l?.length ?? 0) > 0);
    if (other < 0) return;
    const alien = ACTIVES_BY_SHIP[other]![0]!;
    const w = createWorld(1, {
      ...DEFAULT_CONFIG,
      shipType: a,
      skillInvest: investTree(a, 0, 40),
      activeSlots: [wireIdOf(alien.id), -1],
    });
    expect(hudActives(w)).toEqual([]);
  });

  it('HudState 에 actives 를 실을 수 있고, 없어도 타입이 성립한다(optional 계약)', () => {
    const base: HudState = {
      hp: 10,
      maxHp: 10,
      xp: 0,
      xpNeed: 10,
      level: 1,
      timeSec: 0,
      combo: 0,
      multiplier: 1,
      supplyActive: false,
    };
    expect(base.actives).toBeUndefined();
    const withActives: HudState = {
      ...base,
      actives: [{ key: 'Z', name: 'x', cd: 12, cdMax: 60 }],
    };
    expect(withActives.actives?.[0]?.cd).toBe(12);
  });
});
