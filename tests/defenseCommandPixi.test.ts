/**
 * 방어 사령부(Pixi) 검증 — M7b-command-ui.
 *
 * 이 화면은 캔버스 위에 그려지므로 "그림"을 테스트할 수는 없다. 대신 **화면을 떠받치는 순수
 * 계층**을 전부 노출해 두고 그것을 검증한다:
 *   ① 탭 기하·연결선(신규 탭 세트 규격),
 *   ② 스크롤 영역 기하(반토막 행 금지·스크롤 클램프),
 *   ③ 팝업 기하 + 패널 여백 상자,
 *   ④ 슬롯 편집 왕복 정규화(밀집화 금지가 이 화면의 최대 함정),
 *   ⑤ 탭 전환 상태 보존,
 *   ⑥ 배치 프리뷰가 **실제 sim** 을 세운다는 것(목업이 아님),
 *   ⑦ 시험 침공이 정산·리플레이 제출 경로를 타지 않는다는 것(ADR-0008).
 *
 * Pixi 표시 객체는 만들지 않는다 — vitest 환경은 node 라 캔버스 텍스트 측정이 불가능하다.
 * 그래서 화면 클래스가 아니라 그 클래스가 쓰는 함수들을 직접 부른다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { tabBarLayout, connectorSpans, TAB_H, TAB_SINK } from '../src/ui/pixi/tabs.js';
import { clampScroll, rowBounds, clampToRows } from '../src/ui/pixi/scrollArea.js';
import { modalGeometry } from '../src/ui/pixi/modal.js';
import { panelContent, PANEL_BORDER, PANEL_INNER_PAD } from '../src/ui/pixi/nineSlicePanel.js';
import {
  DEF_TAB_L1,
  DEF_TAB_L2,
  DEF_TAB_L3,
  DEF_TAB_INV,
  DEF_TAB_COUNT,
  DEF_TAB_KEYS,
  createCommandState,
  setTab,
  isDirty,
  revertDraft,
  commitDraft,
  placeRef,
  clearSlot,
  setTemplateId,
  setCoreHp,
  slotRef,
  slotCount,
  slotCatalogKind,
  refEquals,
  isRefPlaced,
  eligibleUnits,
  tabForSlot,
  tabPhase,
  unitAffixLine,
  pickGuardianId,
  guardianFallbackKey,
  placeGuardian,
  testInvadeAction,
  TABS_Y,
  TOP_CHROME_BOTTOM,
  BOARD_TOP,
  type DefenseSlotRef,
} from '../src/ui/pixi/defenseCommand.js';
import { defaultProfile } from '../src/save/profile.js';
import { retireAtCap } from './support/retireAtCap.js';
import type { InvasionGuardianPlacement } from '../src/sim/invasion/types.js';
import { defenseUniqueNameKey, type DefenseUnitInstance } from '../data/defenseUnits.js';
import { CATALOG } from '../src/i18n/catalog.js';
import { getLocale } from '../src/i18n/index.js';
import { buildPreviewWorld, previewFit, PREVIEW_SEED } from '../src/render/defensePreview.js';
import {
  emptyInvasionLayers,
  normalizeInvasionLayers,
  layersEqual,
  INVASION_WAVE_SLOTS,
  INVASION_PROP_SLOTS,
  INVASION_SOCKET_COUNTS,
  MAP_TEMPLATE_STRAIGHT,
  MAP_TEMPLATE_CHOKE,
  PHASE_L1,
  PHASE_L2,
  PHASE_L3,
  type InvasionRef,
} from '../src/sim/invasion/index.js';
import { CATALOG_FORMATION, CATALOG_FACILITY, CATALOG_PROP, CATALOG_BOSS } from '../data/invasion/catalog.js';
import { buildInvasionPreset } from '../src/harness/presets.js';
import { rollDefenseUnit, defenseUnitUnique } from '../src/items/rollDefenseUnit.js';
import type { DefenseUnitOwned } from '../src/net/defenseUnits.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../src/render/app.js';

/** 소스 파일 원문(경로는 URL 로 만들어 node:path 셰이딩에 의존하지 않는다). */
function readSource(rel: string): string {
  const url = new URL(rel, import.meta.url);
  return new TextDecoder().decode(readFileSync(url.pathname.replace(/^\/([A-Za-z]:)/, '$1')));
}

function ref(catalogId: number, seed = 1234, level = 5, ascension = 1, rarity = 2): InvasionRef {
  return { catalogId, level, ascension, affixSeed: seed, rarity };
}

function owned(id: string, kind: number, catalogId: number, affixSeed: number): DefenseUnitOwned {
  const unit = rollDefenseUnit({ kind, catalogId, rarity: 'rare', affixSeed, level: 5, ascension: 1 });
  return { id, kind, catalogId, unit };
}

// ---------------------------------------------------------------------------
// ① 탭 기하 — 신규 세트 규격
// ---------------------------------------------------------------------------

describe('탭 바 기하(신규 카툰나무풍 탭)', () => {
  it('탭 폭 합 + 간격이 바 폭과 정확히 일치한다(마지막 탭이 반올림 오차를 흡수)', () => {
    for (const width of [1848, 1000, 777, 5]) {
      const rects = tabBarLayout(DEF_TAB_COUNT, { width, activeIndex: 0 });
      const last = rects[rects.length - 1]!;
      expect(last.x + last.w).toBe(width);
    }
  });

  it('선택 탭만 위로 올라오고 나머지는 가라앉는다', () => {
    const rects = tabBarLayout(DEF_TAB_COUNT, { width: 1848, activeIndex: 2 });
    rects.forEach((r, i) => {
      expect(r.active).toBe(i === 2);
      expect(r.y).toBe(i === 2 ? 0 : TAB_SINK);
      expect(r.h).toBe(TAB_H);
    });
  });

  it('금색 연결선이 선택 탭 밑에서만 끊긴다(선택 = 색이 아니라 기하)', () => {
    const width = 1000;
    const rects = tabBarLayout(DEF_TAB_COUNT, { width, activeIndex: 1 });
    const spans = connectorSpans(rects, width);
    const active = rects[1]!;
    // 어떤 span 도 활성 탭 구간 [x, x+w) 와 겹치지 않는다.
    for (const s of spans) {
      const overlap = Math.min(s.x + s.w, active.x + active.w) - Math.max(s.x, active.x);
      expect(overlap).toBeLessThanOrEqual(0);
    }
    // 활성 탭 좌우가 모두 채워진다(끊긴 곳은 활성 구간뿐).
    expect(spans.reduce((a, s) => a + s.w, 0)).toBe(width - active.w);
    // 첫/끝 탭이 선택이어도 span 개수가 0 이 되지 않는다(양 끝 중 한쪽은 남는다).
    expect(connectorSpans(tabBarLayout(DEF_TAB_COUNT, { width, activeIndex: 0 }), width).length).toBe(1);
    expect(
      connectorSpans(tabBarLayout(DEF_TAB_COUNT, { width, activeIndex: DEF_TAB_COUNT - 1 }), width).length,
    ).toBe(1);
  });

  it('탭 라벨 키가 탭 수와 일치한다(키 누락 = 빈 탭)', () => {
    expect(DEF_TAB_KEYS.length).toBe(DEF_TAB_COUNT);
    for (const k of DEF_TAB_KEYS) expect(k.startsWith('def3.cmd.tab.')).toBe(true);
  });
});

describe('방어 사령부 상단 크롬 밴드(겹침 불가)', () => {
  // 설정 톱니는 이 화면 소유가 아니라 매 프레임 맨 앞으로 올라오는 전역 크롬이다.
  // 좌표 정본은 src/ui/pixi/settingsPanel.ts 의 GEAR_X/GEAR_Y/GEAR_SIZE = 24/20/76.
  const GEAR = { left: 24, top: 20, right: 24 + 76, bottom: 20 + 76 };

  it('크롬 밴드 바닥이 톱니 바닥(가장 아래 크롬 요소)까지 내려온다', () => {
    expect(TOP_CHROME_BOTTOM).toBe(GEAR.bottom);
  });

  it('탭 바가 크롬 밴드 아래로 완전히 내려간다 — 세로 구간이 서로 겹치지 않는다', () => {
    // 탭 바가 쓰는 세로 구간은 [TABS_Y, TABS_Y + TAB_H). 크롬 밴드는 [0, TOP_CHROME_BOTTOM).
    expect(TABS_Y).toBeGreaterThanOrEqual(TOP_CHROME_BOTTOM);
    // 붙지 않고 여백이 있다(예전 TABS_Y = 100 은 톱니 바닥 96 과 4px 차이였다).
    expect(TABS_Y - TOP_CHROME_BOTTOM).toBeGreaterThanOrEqual(20);
    // 톱니 상자와의 교차 = 0. 가로는 겹치지만(탭 바 x 36.., 톱니 x 24..100) 세로가 끊긴다.
    expect(Math.max(0, Math.min(GEAR.bottom, TABS_Y + TAB_H) - Math.max(GEAR.top, TABS_Y))).toBe(0);
  });

  it('보드 패널이 탭 바에 딱 붙지 않는다 — 사이에 여백이 있다', () => {
    // 예전에는 `BOARD_TOP = TABS_Y + TAB_H` 라 보드 나무 프레임이 탭 버튼 바닥에 **0px 로**
    // 붙어, 활성 탭이 테두리에 얹힌 것처럼 보였다(사용자 신고: "위 버튼과 밑에 내용이 너무
    // 붙어 있다"). 크롬↔탭 경계와 같은 방식으로 부등식으로 막는다.
    expect(BOARD_TOP).toBeGreaterThan(TABS_Y + TAB_H);
    expect(BOARD_TOP - (TABS_Y + TAB_H)).toBeGreaterThanOrEqual(12);
    // 다만 탭과 보드는 한 묶음이라 크롬↔탭 간격(28)만큼 벌어지면 끊겨 보인다 — 상한도 둔다.
    expect(BOARD_TOP - (TABS_Y + TAB_H)).toBeLessThan(TABS_Y - TOP_CHROME_BOTTOM);
  });
});

// ---------------------------------------------------------------------------
// ② 스크롤 영역 기하
// ---------------------------------------------------------------------------

describe('스크롤 영역 기하', () => {
  it('내용이 창보다 작으면 스크롤이 항상 0 이다', () => {
    expect(clampScroll(500, 200, 400)).toBe(0);
    expect(clampScroll(-30, 900, 400)).toBe(0);
  });

  it('스크롤 상한은 내용 - 창 이다', () => {
    expect(clampScroll(10_000, 900, 400)).toBe(500);
    expect(clampScroll(120, 900, 400)).toBe(120);
  });

  it('행 경계는 간격을 행 사이에만 넣는다', () => {
    expect(rowBounds([100, 100, 100], 10)).toEqual([100, 210, 320]);
    expect(rowBounds([], 10)).toEqual([]);
  });

  it('마스크 높이는 반토막 행을 만들지 않는다', () => {
    const bounds = rowBounds([100, 100, 100], 10); // [100,210,320]
    expect(clampToRows(250, bounds)).toBe(210);
    expect(clampToRows(320, bounds)).toBe(320);
    // 한 행도 안 들어가면 가용 높이 그대로(아무것도 안 보이는 것보다 낫다).
    expect(clampToRows(40, bounds)).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// ③ 팝업 기하 + 패널 여백 상자
// ---------------------------------------------------------------------------

describe('팝업·패널 기하', () => {
  it('팝업은 화면 정중앙 정수 좌표에 놓인다', () => {
    const g = modalGeometry(1180, 800);
    expect(Number.isInteger(g.x)).toBe(true);
    expect(Number.isInteger(g.y)).toBe(true);
    expect(g.x * 2 + g.w).toBe(DESIGN_WIDTH);
    expect(g.y * 2 + g.h).toBe(DESIGN_HEIGHT);
  });

  it('콘텐츠 상자는 프레임 + 여백만큼 사방으로 대칭 축소된다', () => {
    const w = 900;
    const h = 700;
    const box = panelContent(w, h);
    const inset = PANEL_BORDER + PANEL_INNER_PAD;
    expect(box.x).toBe(inset);
    expect(box.y).toBe(inset);
    expect(w - box.right).toBe(inset);
    expect(h - box.bottom).toBe(inset);
  });
});

// ---------------------------------------------------------------------------
// ④ 슬롯 편집 — 밀집화 금지 · 왕복 정규화
// ---------------------------------------------------------------------------

describe('슬롯 편집 왕복 정규화', () => {
  it('꽂았다 비우면 원래 배치와 비트 동일하다(전 슬롯 종류)', () => {
    const base = normalizeInvasionLayers(emptyInvasionLayers());
    const slots: DefenseSlotRef[] = [
      { kind: 'wave', index: 3 },
      { kind: 'socket', index: 5 },
      { kind: 'prop', index: 2 },
      { kind: 'boss', index: 0 },
    ];
    for (const slot of slots) {
      const placed = placeRef(base, slot, ref(0));
      expect(layersEqual(placed, base)).toBe(false);
      expect(layersEqual(clearSlot(placed, slot), base)).toBe(true);
    }
  });

  it('슬롯 배열 길이는 편집으로 절대 변하지 않는다(밀집화 금지 — 인덱스가 계약이다)', () => {
    let layers = normalizeInvasionLayers(emptyInvasionLayers());
    const before = {
      waves: layers.l1.waveSlots.length,
      sockets: layers.l2.sockets.length,
      props: layers.l3.props.length,
      guardians: layers.l3.guardians.length,
    };
    layers = placeRef(layers, { kind: 'wave', index: 0 }, ref(0));
    layers = placeRef(layers, { kind: 'wave', index: 5 }, ref(1));
    layers = clearSlot(layers, { kind: 'wave', index: 0 }); // 앞이 비어도 뒤가 앞으로 오면 안 된다
    expect(layers.l1.waveSlots.length).toBe(before.waves);
    expect(layers.l1.waveSlots[0]).toBeNull();
    expect(layers.l1.waveSlots[5]).not.toBeNull();
    expect(layers.l2.sockets.length).toBe(before.sockets);
    expect(layers.l3.props.length).toBe(before.props);
    expect(layers.l3.guardians.length).toBe(before.guardians);
  });

  it('슬롯 수는 스키마 상수와 일치한다', () => {
    const layers = normalizeInvasionLayers(emptyInvasionLayers());
    expect(slotCount(layers, 'wave')).toBe(INVASION_WAVE_SLOTS);
    expect(slotCount(layers, 'prop')).toBe(INVASION_PROP_SLOTS);
    expect(slotCount(layers, 'boss')).toBe(1);
    expect(slotCount(layers, 'socket')).toBe(INVASION_SOCKET_COUNTS[layers.l2.templateId]);
  });

  it('맵 템플릿을 바꾸면 소켓 수가 따라가고 겹치는 앞부분만 승계된다', () => {
    let layers = setTemplateId(normalizeInvasionLayers(emptyInvasionLayers()), MAP_TEMPLATE_STRAIGHT);
    expect(layers.l2.sockets.length).toBe(INVASION_SOCKET_COUNTS[MAP_TEMPLATE_STRAIGHT]);
    layers = placeRef(layers, { kind: 'socket', index: 1 }, ref(0, 999));
    layers = placeRef(layers, { kind: 'socket', index: 11 }, ref(1, 888));
    const narrowed = setTemplateId(layers, MAP_TEMPLATE_CHOKE); // 12 → 8
    expect(narrowed.l2.sockets.length).toBe(INVASION_SOCKET_COUNTS[MAP_TEMPLATE_CHOKE]);
    expect(narrowed.l2.sockets[1]).not.toBeNull();
    // 잘려 나간 소켓 11 은 사라진다(앞으로 당겨 오지 않는다).
    expect(narrowed.l2.sockets.some((s) => s !== null && s.affixSeed === 888)).toBe(false);
  });

  it('코어 내구도는 1 미만으로 내려가지 않는다', () => {
    const base = normalizeInvasionLayers(emptyInvasionLayers());
    expect(setCoreHp(base, 0).l3.core.hp).toBeGreaterThanOrEqual(1);
    expect(setCoreHp(base, 12_345).l3.core.hp).toBe(12_345);
  });

  it('슬롯 종류 → 카탈로그 종류 매핑이 어긋나지 않는다', () => {
    expect(slotCatalogKind('wave')).toBe(CATALOG_FORMATION);
    expect(slotCatalogKind('socket')).toBe(CATALOG_FACILITY);
    expect(slotCatalogKind('prop')).toBe(CATALOG_PROP);
    expect(slotCatalogKind('boss')).toBe(CATALOG_BOSS);
  });
});

describe('중복 배치 방지', () => {
  it('같은 방어체를 두 칸에 꽂을 수 없다(후보 목록에서 빠진다)', () => {
    const units = [
      owned('a', CATALOG_FORMATION, 0, 111),
      owned('b', CATALOG_FORMATION, 1, 222),
      owned('c', CATALOG_FACILITY, 0, 333),
    ];
    let layers = normalizeInvasionLayers(emptyInvasionLayers());
    const slot0: DefenseSlotRef = { kind: 'wave', index: 0 };
    const slot1: DefenseSlotRef = { kind: 'wave', index: 1 };

    // 처음엔 편대 2기만 후보(설비는 종류가 다르다).
    expect(eligibleUnits(units, layers, slot0).map((u) => u.id)).toEqual(['a', 'b']);

    const aRef = { ...slotRefOf(units[0]!) };
    layers = placeRef(layers, slot0, aRef);
    expect(isRefPlaced(layers, aRef)).toBe(true);
    // 다른 칸에서는 a 가 빠진다.
    expect(eligibleUnits(units, layers, slot1).map((u) => u.id)).toEqual(['b']);
    // **자기 칸에서는 남는다**(현재 선택을 보여줘야 한다).
    expect(eligibleUnits(units, layers, slot0).map((u) => u.id)).toEqual(['a', 'b']);
  });

  it('refEquals 는 정수 5필드를 전부 본다(하나만 달라도 다른 방어체)', () => {
    const a = ref(0, 1, 1, 0, 0);
    expect(refEquals(a, { ...a })).toBe(true);
    expect(refEquals(a, { ...a, catalogId: 1 })).toBe(false);
    expect(refEquals(a, { ...a, level: 2 })).toBe(false);
    expect(refEquals(a, { ...a, ascension: 1 })).toBe(false);
    expect(refEquals(a, { ...a, affixSeed: 2 })).toBe(false);
    expect(refEquals(a, { ...a, rarity: 1 })).toBe(false);
    expect(refEquals(a, null)).toBe(false);
    expect(refEquals(null, null)).toBe(true);
  });
});

/** 보유 방어체 → 배치 참조(테스트 편의). */
function slotRefOf(o: DefenseUnitOwned): InvasionRef {
  return {
    catalogId: o.unit.catalogId,
    level: o.unit.level,
    ascension: o.unit.ascension,
    affixSeed: o.unit.affixSeed,
    rarity: 2, // rollDefenseUnit rarity 'rare' → 코드 2
  };
}

// ---------------------------------------------------------------------------
// ⑤ 탭 전환 상태 보존
// ---------------------------------------------------------------------------

describe('탭 전환 상태 보존', () => {
  it('탭을 오가도 편집 초안·탭별 스크롤이 남는다', () => {
    const state = createCommandState(null);
    state.draft = placeRef(state.draft, { kind: 'wave', index: 2 }, ref(0));
    state.scroll[DEF_TAB_L1] = 140;

    setTab(state, DEF_TAB_INV);
    state.scroll[DEF_TAB_INV] = 60;
    setTab(state, DEF_TAB_L1);

    expect(state.tab).toBe(DEF_TAB_L1);
    expect(state.scroll[DEF_TAB_L1]).toBe(140);
    expect(state.scroll[DEF_TAB_INV]).toBe(60);
    expect(slotRef(state.draft, { kind: 'wave', index: 2 })).not.toBeNull();
  });

  it('레이어 탭으로 옮기면 그 레이어의 슬롯이 선택된다(프리뷰 초점)', () => {
    const state = createCommandState(null);
    setTab(state, DEF_TAB_L2);
    expect(state.selected?.kind).toBe('socket');
    setTab(state, DEF_TAB_L3);
    expect(state.selected?.kind).toBe('boss');
    // 같은 탭 안에서 고른 슬롯은 다시 들어와도 유지된다.
    state.selected = { kind: 'prop', index: 4 };
    setTab(state, DEF_TAB_INV);
    setTab(state, DEF_TAB_L3);
    expect(state.selected).toEqual({ kind: 'prop', index: 4 });
  });

  it('범위 밖 탭은 무시된다', () => {
    const state = createCommandState(null);
    setTab(state, 99);
    setTab(state, -1);
    expect(state.tab).toBe(DEF_TAB_L1);
  });

  it('탭 ↔ 페이즈 ↔ 슬롯 종류 매핑이 서로 정합한다', () => {
    expect(tabPhase(DEF_TAB_L1)).toBe(PHASE_L1);
    expect(tabPhase(DEF_TAB_L2)).toBe(PHASE_L2);
    expect(tabPhase(DEF_TAB_L3)).toBe(PHASE_L3);
    expect(tabPhase(DEF_TAB_INV)).toBeNull();
    expect(tabForSlot('wave')).toBe(DEF_TAB_L1);
    expect(tabForSlot('socket')).toBe(DEF_TAB_L2);
    expect(tabForSlot('prop')).toBe(DEF_TAB_L3);
    expect(tabForSlot('guardian')).toBe(DEF_TAB_L3);
    expect(tabForSlot('boss')).toBe(DEF_TAB_L3);
  });
});

describe('저장·되돌리기', () => {
  it('편집하면 미저장, 되돌리면 저장본과 같아진다', () => {
    const state = createCommandState(null);
    expect(isDirty(state)).toBe(false);
    state.draft = placeRef(state.draft, { kind: 'boss', index: 0 }, ref(0));
    expect(isDirty(state)).toBe(true);
    revertDraft(state);
    expect(isDirty(state)).toBe(false);
    expect(slotRef(state.draft, { kind: 'boss', index: 0 })).toBeNull();
  });

  it('저장 확정은 초안을 저장본으로 승격한다(되돌리기 기준 이동)', () => {
    const state = createCommandState(null);
    state.draft = placeRef(state.draft, { kind: 'boss', index: 0 }, ref(0));
    commitDraft(state);
    expect(isDirty(state)).toBe(false);
    revertDraft(state);
    expect(slotRef(state.draft, { kind: 'boss', index: 0 })).not.toBeNull();
  });

  it('저장본과 초안은 서로 다른 객체다(한쪽 편집이 다른 쪽을 오염시키지 않는다)', () => {
    const state = createCommandState(null);
    expect(state.draft).not.toBe(state.saved);
    state.draft = placeRef(state.draft, { kind: 'wave', index: 0 }, ref(0));
    expect(state.saved.l1.waveSlots[0]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ⑥ 배치 프리뷰 — 목업이 아니라 실제 sim
// ---------------------------------------------------------------------------

describe('배치 프리뷰(실제 sim 정지 렌더)', () => {
  const layers = buildInvasionPreset('def3-mid');

  it('L2 프리뷰에 회랑 벽과 설비가 실제로 선다', () => {
    const w = buildPreviewWorld({ layers, phase: PHASE_L2 });
    expect(w.invasion3?.phase).toBe(PHASE_L2);
    const kinds = w.entities.filter((e) => !e.dead).map((e) => e.kind);
    expect(kinds).toContain('wall');
    expect(kinds.some((k) => k.startsWith('facility'))).toBe(true);
  });

  it('L3 프리뷰에 코어가 선다', () => {
    const w = buildPreviewWorld({ layers, phase: PHASE_L3 });
    expect(w.invasion3?.phase).toBe(PHASE_L3);
    expect(w.entities.some((e) => !e.dead && e.kind === 'core')).toBe(true);
  });

  it('L1 프리뷰는 선택 슬롯의 편대를 실제 스폰 좌표로 세운다(물리 0틱)', () => {
    const w = buildPreviewWorld({ layers, phase: PHASE_L1, slotIndex: 0 });
    const enemies = w.entities.filter((e) => !e.dead && e.kind === 'enemy');
    expect(enemies.length).toBeGreaterThan(0);
    // 물리를 돌리지 않았으므로 틱은 페이즈 진입 틱 그대로다(전투 장면이 아니라 배치도다).
    expect(w.tick).toBe(w.invasion3?.phaseEnterTick);
  });

  it('같은 입력이면 같은 그림이다(고정 시드 — 결정론)', () => {
    const a = buildPreviewWorld({ layers, phase: PHASE_L3, seed: PREVIEW_SEED });
    const b = buildPreviewWorld({ layers, phase: PHASE_L3, seed: PREVIEW_SEED });
    const pack = (w: typeof a): string =>
      w.entities
        .filter((e) => !e.dead)
        .map((e) => `${e.kind}:${e.x}:${e.y}:${e.hp}`)
        .join('|');
    expect(pack(a)).toBe(pack(b));
  });

  it('빈 배치도 그려진다(기본 수비대 충원 — 무저항 기지가 아니다)', () => {
    const w = buildPreviewWorld({ layers: null, phase: PHASE_L2 });
    expect(w.entities.some((e) => !e.dead && e.kind.startsWith('facility'))).toBe(true);
  });

  it('프리뷰 변환은 카메라 지점을 뷰포트 정중앙에 둔다', () => {
    const view = { x: 100, y: 200, w: 800, h: 450 };
    const fit = previewFit(view);
    expect(fit.scale).toBeCloseTo(Math.min(800 / DESIGN_WIDTH, 450 / DESIGN_HEIGHT));
    // 스케일 컨테이너 안의 (DW/2, DH/2) 가 뷰포트 중앙으로 온다.
    expect(fit.x + (DESIGN_WIDTH * fit.scale) / 2).toBeCloseTo(view.w / 2);
    expect(fit.y + (DESIGN_HEIGHT * fit.scale) / 2).toBeCloseTo(view.h / 2);
  });
});

// ---------------------------------------------------------------------------
// ⑦ 시험 침공 오염 격리(ADR-0008)
// ---------------------------------------------------------------------------

describe('시험 침공은 정산·제출 경로를 타지 않는다', () => {
  const src = readSource('../src/main.ts');

  it('시험 침공 콜백은 하네스 침공 경로로만 간다', () => {
    const block = /onTestInvade:\s*\(layers\)\s*=>\s*\{[\s\S]*?\},\s*?\r?\n\s*onOpenModules/.exec(src);
    expect(block).not.toBeNull();
    const body = block![0];
    expect(body).toMatch(/startHarnessInvasionRun\(/);
    // 정식 침공 경로(대상 지정 + 제출)를 부르면 안 된다.
    expect(body).not.toMatch(/startInvasionRun\(/);
    expect(body).not.toMatch(/submitInvasion\(/);
  });

  it('하네스 침공 런은 invasionTarget 을 비우고 오염 플래그를 세운다', () => {
    const fn = /function startHarnessInvasionRun\([\s\S]*?setScreen\('run'\);/.exec(src);
    expect(fn).not.toBeNull();
    const body = fn![0];
    expect(body).toMatch(/invasionTarget\s*=\s*null;/);
    expect(body).toMatch(/harnessInvasionRun\s*=\s*true;/);
    expect(body).not.toMatch(/submitInvasion/);
  });

  it('방어 사령부는 코어 모듈 화면을 suspend/resume 으로 오간다(미저장 편집 보존)', () => {
    const ui = readSource('../src/ui/pixi/defenseCommand.ts');
    // 모듈 진입에서 show() 를 다시 부르면 편집이 날아간다 — suspend 후 resume 콜백만 넘긴다.
    expect(ui).toMatch(/this\.suspend\(\);\s*\n\s*cb\?\.onOpenModules\(\(\) => this\.resume\(\)\)/);
  });
});

// ---------------------------------------------------------------------------
// ⑨ 수호 슬롯 신원 (A-3) — 손실 있는 대체 키가 슬롯 2 를 봉인했다
// ---------------------------------------------------------------------------
//
// 재현 경로는 **정규 경로**다: `retireActiveShip` 를 두 번 부르면(장비·투자 0 이라
// `retirementCombatScore` 가 1 로 clamp) hp·performanceCP 가 완전히 같은 수호가 2기 생긴다.
// 구 판정 키(`hp:performanceCP`)로는 두 기체가 구별되지 않아, 1기를 꽂는 순간 나머지 1기도
// 후보에서 사라져 슬롯 2 에는 영영 "배치할 방어체가 없습니다" 만 떴다.

describe('수호 슬롯 신원(중복 판정)', () => {
  /** 연속 퇴역 2회 — 실제 게임이 수호를 만드는 그 경로. */
  function twoIdenticalGuardians() {
    const profile = defaultProfile();
    retireAtCap(profile);
    retireAtCap(profile);
    return profile;
  }

  function placementOf(g: { snapshot: { hp: number }; performanceCP: number }): InvasionGuardianPlacement {
    return {
      x: 0,
      y: 0,
      snapshot: g.snapshot,
      performanceCP: g.performanceCP,
      lineageBonusBp: 0,
      milestones: [],
    } as unknown as InvasionGuardianPlacement;
  }

  it('연속 퇴역 2기는 대체 키가 완전히 겹친다(결함의 전제 — 공허 검증 방지)', () => {
    const p = twoIdenticalGuardians();
    expect(p.guardians.length).toBe(2);
    const [a, b] = p.guardians as [typeof p.guardians[0], typeof p.guardians[0]];
    expect(guardianFallbackKey(a.snapshot.hp, a.performanceCP)).toBe(
      guardianFallbackKey(b.snapshot.hp, b.performanceCP),
    );
    expect(a.id).not.toBe(b.id); // 신원 자체는 다르다 — 키만 손실이었다
  });

  it('슬롯 1 에 꽂은 뒤에도 슬롯 2 에 나머지 1기를 꽂을 수 있다', () => {
    const p = twoIdenticalGuardians();
    const first = p.guardians[0]!;
    const slots: (InvasionGuardianPlacement | null)[] = [placementOf(first), null];
    const ids: (string | null)[] = [first.id, null];
    const next = pickGuardianId(p.guardians, slots, ids, 1);
    expect(next).toBe(p.guardians[1]!.id);
  });

  it('슬롯 자신은 점유에서 제외된다(재배치가 막히지 않는다)', () => {
    const p = twoIdenticalGuardians();
    const a = p.guardians[0]!;
    const slots: (InvasionGuardianPlacement | null)[] = [placementOf(a), null];
    // 슬롯 0 을 다시 채우려 하면 슬롯 0 자신은 무시되므로 첫 후보가 그대로 나온다.
    expect(pickGuardianId(p.guardians, slots, [a.id, null], 0)).toBe(a.id);
  });

  it('저장본 복원(슬롯 id 미상)이어도 같은 키 2기 중 1기만 가려진다', () => {
    const p = twoIdenticalGuardians();
    const slots: (InvasionGuardianPlacement | null)[] = [placementOf(p.guardians[0]!), null];
    // id 를 모르는 슬롯 → 대체 키 다중집합으로 **한 번만** 소진한다.
    const next = pickGuardianId(p.guardians, slots, [null, null], 1);
    expect(next).not.toBeNull();
    expect(p.guardians.some((g) => g.id === next)).toBe(true);
  });

  it('두 슬롯이 모두 차면 더 줄 기체가 없다', () => {
    const p = twoIdenticalGuardians();
    const [a, b] = p.guardians as [typeof p.guardians[0], typeof p.guardians[0]];
    const slots: (InvasionGuardianPlacement | null)[] = [placementOf(a), placementOf(b)];
    expect(pickGuardianId(p.guardians, slots, [a.id, b.id], 0)).toBe(a.id); // 자기 슬롯 재배치
    // 세 번째 슬롯이 있었다면 후보가 없다.
    expect(pickGuardianId(p.guardians, slots, [a.id, b.id], 2)).toBeNull();
  });

  it('소멸(retired)한 기체는 후보가 아니다', () => {
    const p = twoIdenticalGuardians();
    for (const g of p.guardians) g.retired = true;
    expect(pickGuardianId(p.guardians, [null, null], [null, null], 0)).toBeNull();
  });

  it('되돌리기는 수호 id 추적을 함께 버린다(거짓 신원 잔류 금지)', () => {
    const state = createCommandState(null);
    state.guardianIds[0] = 'g-1';
    state.draft = placeGuardian(
      state.draft,
      0,
      placementOf({ snapshot: { hp: 100 }, performanceCP: 10_000 }),
    );
    revertDraft(state);
    expect(state.draft.l3.guardians[0]).toBeNull();
    expect(state.guardianIds.every((v) => v === null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ⑩ 시험 침공이 미저장 편집을 조용히 버리지 않는다 (A-4)
// ---------------------------------------------------------------------------
//
// [시험 침공] 은 `hide()` 로 화면을 끝내고, 복귀는 `main.ts` → `show()` → `createCommandState`
// (저장본에서 새로) 다. 즉 확인이 없으면 초안이 통째로 증발하는데, 침공은 편집한 배치로
// 정상 실행되므로 사용자는 편집이 살아 있다고 믿는다. 돌아오면 '미저장' 경고까지 함께
// 사라져 무엇을 잃었는지도 알 수 없다.

describe('시험 침공 · 미저장 편집 보호', () => {
  const ui = readSource('../src/ui/pixi/defenseCommand.ts');

  it('미저장이면 확인, 깨끗하면 바로 진행', () => {
    const state = createCommandState(null);
    expect(testInvadeAction(state)).toBe('go');
    state.draft = placeRef(state.draft, { kind: 'boss', index: 0 }, ref(0));
    expect(testInvadeAction(state)).toBe('confirm');
    commitDraft(state);
    expect(testInvadeAction(state)).toBe('go');
  });

  it('푸터 [시험 침공] 버튼이 그 판정을 실제로 거친다(배선 확인)', () => {
    // 판정 함수만 있고 버튼이 안 부르면 2000개 테스트가 초록인 채 결함이 남는다.
    expect(ui).toMatch(/testInvadeAction\(this\.state\) === 'confirm'\)\s*this\.openModal\('confirmTest'\)/);
    expect(ui).toMatch(/private renderConfirmTestModal\(/);
    // 확인 팝업은 저장/그대로/취소 세 갈래여야 한다.
    expect(ui).toMatch(/void this\.saveLayout\(\);\s*\n\s*this\.startTestInvade\(\);/);
    expect(ui).toMatch(/run: \(\) => this\.startTestInvade\(\)/);
    expect(ui).toMatch(/run: \(\) => this\.closeModal\(\)/);
  });
});

// ---------------------------------------------------------------------------
// ⑪ busy 플래그 누수 (A-5)
// ---------------------------------------------------------------------------
//
// `if (!this.visible) return;` 이 해제보다 앞에 있으면, 업로드/강화 중 [코어 모듈 열기]로
// suspend 됐다 돌아왔을 때 busy 가 true 로 굳는다(`resume()` 은 busy 를 안 건드리고 리셋은
// `show()` 뿐). 결과: 저장·되돌리기·배치·강화·제작 버튼이 영구 비활성.

describe('busy 잠금은 항상 풀린다', () => {
  const ui = readSource('../src/ui/pixi/defenseCommand.ts');

  function bodyOf(name: string): string {
    const m = new RegExp(`private async ${name}\\([\\s\\S]*?\\n  \\}`).exec(ui);
    expect(m, `${name} 본문을 못 찾음`).not.toBeNull();
    return m![0];
  }

  for (const fn of ['saveLayout', 'runUpgrade']) {
    it(`${fn} 은 finally 로 busy 를 해제한다`, () => {
      const body = bodyOf(fn);
      expect(body).toMatch(/\}\s*finally\s*\{\s*\n\s*this\.busy = false;/);
      // 조기 반환이 해제보다 앞서면(구 결함) 잠금이 남는다.
      expect(body).not.toMatch(/if \(!this\.visible\) return;\s*\n\s*this\.busy = false;/);
    });
  }
});

// ---------------------------------------------------------------------------
// ⑧ 유니크 고유 효과 표시 (M7c 통합 게이트)
// ---------------------------------------------------------------------------
//
// 배선 누락 유형: `data/defenseUnits.ts` 가 유니크 8종을 정의하고, `rollDefenseUnit` 이
// `uniqueId` 를 굴리고, `affix.ts` 가 sim 에서 효과를 실어 나르고, i18n 이 16키를 갖췄는데
// **화면에 꽂는 마지막 한 홉이 없었다**. `defenseUnitUnique()` 는 src/ui 어디에서도
// 호출되지 않았고, 그래서 유니크를 뽑아도 플레이어가 알 방법이 없었다. 더 나쁜 것은 어픽스가
// 0개인 유니크가 "기본 스탯뿐"으로 표기됐다는 점이다 — 있는 것을 없다고 말하는 표기였다.
// 각 레인의 단위 테스트는 자기 모듈만 직접 호출하므로 전부 초록불이었다.

describe('유니크 방어체가 화면 문구에 실제로 실린다', () => {
  /** 지정 유니크가 실제로 붙은 방어체를 시드 스윕으로 찾는다(롤은 순수·결정론). */
  function findUnitWithUnique(kind: number): DefenseUnitInstance | null {
    for (let seed = 1; seed < 4000; seed++) {
      const unit = rollDefenseUnit({ kind, catalogId: 0, rarity: 'unique', affixSeed: seed });
      if (defenseUnitUnique(unit) !== null) return unit;
    }
    return null;
  }

  it('유니크 종류 전부에 대해 어픽스 줄이 유니크 이름을 담는다', () => {
    for (const kind of [CATALOG_FORMATION, CATALOG_FACILITY, CATALOG_PROP, CATALOG_BOSS]) {
      const unit = findUnitWithUnique(kind);
      expect(unit, `유니크가 붙는 표본을 못 찾음(kind ${kind})`).not.toBeNull();
      const uq = defenseUnitUnique(unit!)!;
      const line = unitAffixLine(unit!);
      const name = CATALOG[getLocale()][defenseUniqueNameKey(uq.id) as keyof typeof CATALOG.en];
      // 키가 아니라 **해석된 문구**가 실려야 한다 — 미해석 키가 그대로 새면 화면에 날문자가 뜬다.
      expect(name, `i18n 미등재: ${uq.id}`).toBeTruthy();
      expect(line).toContain(name);
      expect(line).not.toContain('def3.duq.');
    }
  });

  // NOTE: "어픽스 0개인 유니크" 케이스는 **구조적으로 발생 불가**라 테스트를 두지 않는다 —
  // `DEFENSE_UNIT_AFFIX_RANGE.unique = [5, 5]` 라 유니크는 항상 어픽스 5개를 받는다.
  // (게이트에서 이 케이스를 쓰려다 공허 검증 방지 가드에 걸려 사실을 확인했다.)

  it('유니크가 없는 방어체 문구에는 유니크 표기가 새지 않는다(대조군)', () => {
    const unit = rollDefenseUnit({
      kind: CATALOG_FORMATION,
      catalogId: 0,
      rarity: 'rare',
      affixSeed: 4242,
    });
    expect(defenseUnitUnique(unit)).toBeNull();
    expect(unitAffixLine(unit)).not.toContain('[');
  });
});
