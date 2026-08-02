/**
 * 예비역 로스터 레이아웃·순수 파생 검증 (2026-08-02 AAA 시네마틱 전환).
 *
 * ## 왜 이 테스트가 있는가
 * 이 리포는 "겹치면 안 되는 세로 띠"가 실제로 겹친 결함을 격납고 헤더에서 이미 겪었고, 캔버스
 * 없는 vitest 는 Pixi 화면을 세울 수 없어 그 유형이 **눈으로만** 잡힌다. 그래서 좌표를
 * `guardianRosterLayout()` 이 순수 값으로 내보내고, 여기서 겹침·이탈·예약 밴드 침범을 잠근다.
 *
 * 잠긴 장비 목록(`lockedGearList`)도 여기서 잠근다 — 상세 패널이 "소멸하면 무엇이 돌아오는가"를
 * 말하는 자리라 **슬롯 순서가 세이브 직렬화 순서에 끌려다니면** 같은 수호기가 화면마다 다른
 * 순서로 읽힌다.
 *
 * 여기서 검증하는 것은 **좌표 산술과 순수 파생**이지 그림이 아니다. 그림 판정은 하네스 실화면
 * 스크린샷이다.
 */

import { describe, expect, it } from 'vitest';
import {
  guardianRosterLayout,
  countLockedGear,
  lockedGearList,
  GEAR_BAND_H,
  GEAR_BAND_W,
  type GuardianRosterRect,
} from '../src/ui/pixi/guardianRoster.js';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../src/render/app.js';
import { EQUIP_SLOTS, type EquipSlotId, type Item } from '../src/items/types.js';
import type { GuardianRecord } from '../src/save/profile.js';

const right = (r: GuardianRosterRect): number => r.x + r.w;
const bottom = (r: GuardianRosterRect): number => r.y + r.h;

function overlaps(a: GuardianRosterRect, b: GuardianRosterRect): boolean {
  return a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);
}

function item(slot: Item['slot']): Item {
  return { id: `it-${slot}`, slot, rarity: 'normal', affixes: [] } as unknown as Item;
}

function guardian(equipped: Partial<Record<EquipSlotId, Item>> | undefined): GuardianRecord {
  const base = {
    id: 'g1',
    snapshot: {},
    performanceCP: 10000,
    combatScore: 100,
    preset: 0,
    retired: false,
  } as unknown as GuardianRecord;
  if (equipped === undefined) return base;
  return {
    ...base,
    build: { typeId: 0, equipped, skillInvest: [], activeSlots: [null, null] },
  } as unknown as GuardianRecord;
}

describe('예비역 로스터 레이아웃', () => {
  const L = guardianRosterLayout();

  it('화면 치수가 디자인 스페이스와 같다', () => {
    expect(L.screen).toEqual({ x: 0, y: 0, w: DESIGN_WIDTH, h: DESIGN_HEIGHT });
  });

  it('패널 두 장이 서로 겹치지 않는다', () => {
    for (let i = 0; i < L.panels.length; i++) {
      for (let j = i + 1; j < L.panels.length; j++) {
        const a = L.panels[i];
        const b = L.panels[j];
        expect(a).toBeDefined();
        expect(b).toBeDefined();
        if (a === undefined || b === undefined) continue;
        expect(overlaps(a.rect, b.rect), `${a.id} ↔ ${b.id}`).toBe(false);
      }
    }
  });

  it('패널이 전부 화면 안이고 헤더 밴드를 침범하지 않는다', () => {
    for (const p of L.panels) {
      expect(p.rect.x, p.id).toBeGreaterThanOrEqual(0);
      expect(p.rect.y, p.id).toBeGreaterThanOrEqual(L.headerH);
      expect(right(p.rect), p.id).toBeLessThanOrEqual(DESIGN_WIDTH);
      expect(bottom(p.rect), p.id).toBeLessThanOrEqual(DESIGN_HEIGHT);
    }
  });

  it('우측 열 바닥이 목록 패널 바닥과 정확히 같다', () => {
    // 파생으로 강제한 값이다(`AUX_H = LIST_Y + LIST_H - AUX_Y`). 하드코딩으로 되돌리면 깨진다.
    const byId = new Map(L.panels.map((p) => [p.id, p.rect]));
    const list = byId.get('list');
    const lineage = byId.get('lineage');
    expect(list).toBeDefined();
    expect(lineage).toBeDefined();
    if (list === undefined || lineage === undefined) return;
    expect(bottom(lineage)).toBe(bottom(list));
  });

  it('우측 두 패널이 같은 열에 정렬돼 있다', () => {
    const byId = new Map(L.panels.map((p) => [p.id, p.rect]));
    const detail = byId.get('detail');
    const lineage = byId.get('lineage');
    if (detail === undefined || lineage === undefined) return;
    expect(lineage.x).toBe(detail.x);
    expect(lineage.w).toBe(detail.w);
    // 계보 패널은 상세 패널 **아래**다 — 순서가 뒤집히면 접지 그림자 겹침 규율이 무의미해진다.
    expect(lineage.y).toBeGreaterThan(bottom(detail) - 1);
  });

  it('헤더 컨트롤끼리 겹치지 않고 전부 헤더 밴드 안이다', () => {
    for (let i = 0; i < L.headerControls.length; i++) {
      for (let j = i + 1; j < L.headerControls.length; j++) {
        const a = L.headerControls[i];
        const b = L.headerControls[j];
        if (a === undefined || b === undefined) continue;
        expect(overlaps(a.rect, b.rect), `${a.id} ↔ ${b.id}`).toBe(false);
      }
    }
    for (const c of L.headerControls) {
      expect(c.rect.y, c.id).toBeGreaterThanOrEqual(0);
      expect(bottom(c.rect), c.id).toBeLessThanOrEqual(L.headerH);
      expect(right(c.rect), c.id).toBeLessThanOrEqual(DESIGN_WIDTH);
    }
  });

  it('헤더 컨트롤이 설정 톱니 예약 밴드를 침범하지 않는다', () => {
    // 톱니는 매 프레임 stage 최상위로 올라온다 — 겹치면 그 컨트롤이 통째로 클릭 불가가 된다.
    for (const c of L.headerControls) {
      const inBand = c.rect.x < GEAR_BAND_W && c.rect.y < GEAR_BAND_H;
      expect(inBand, `${c.id} 가 톱니 예약 밴드와 겹친다`).toBe(false);
    }
  });
});

describe('잠긴 장비 파생', () => {
  it('build 가 없는 구 수호기는 0개·빈 목록이다', () => {
    const g = guardian(undefined);
    expect(countLockedGear(g)).toBe(0);
    expect(lockedGearList(g)).toEqual([]);
  });

  it('목록 순서가 EQUIP_SLOTS 순서다 — 세이브 직렬화 순서에 끌려다니지 않는다', () => {
    // 일부러 역순으로 넣는다. `Object.keys` 를 쓰면 이 순서가 그대로 나온다.
    const equipped: Partial<Record<EquipSlotId, Item>> = {};
    equipped.module1 = item('module');
    equipped.engine = item('engine');
    equipped.main = item('main');
    const g = guardian(equipped);
    expect(lockedGearList(g).map((e) => e.slot)).toEqual(['main', 'engine', 'module1']);
    expect(countLockedGear(g)).toBe(3);
  });

  it('목록 길이가 슬롯 수를 넘을 수 없다 — 상세 패널이 미리 만드는 행 수의 근거다', () => {
    const equipped: Partial<Record<EquipSlotId, Item>> = {};
    for (const slot of EQUIP_SLOTS) equipped[slot] = item('core');
    expect(lockedGearList(guardian(equipped))).toHaveLength(EQUIP_SLOTS.length);
  });
});
