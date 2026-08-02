/**
 * 코어 모듈 화면 — 조회 실패 표시 · 스크롤 단서 검증 (레인 D).
 *
 * ## 이 파일이 막는 것
 * ① **조회 실패를 "비어 있음"이라고 말하는 것.** 이전 구현은 uid 만 얻으면 `online = true` 를
 *    세우고 보관함 조회가 실패해도 `inv ?? []` 로 빈 배열과 똑같이 취급했다. 그래서 서버 오류인데
 *    화면은 "모듈이 없습니다"·"방어 배치를 저장하세요"라고 단정했다 — 사용자는 자기 모듈이
 *    사라진 줄 안다. 로딩/실패/빈 상태는 **서로 다른 문구**여야 한다.
 * ② **스크롤 가능한데 단서가 없는 것.** 마스크를 행 경계로 자르면(`clampToRows`) 마지막 행이
 *    온전히 보여 "잘렸다"는 시각 신호가 사라진다. 위치 표시(thumb)가 유일한 단서이고, 스크롤할
 *    게 없을 때는 반대로 **나오면 안 된다**(항상 떠 있는 막대는 아무것도 알려 주지 않는다).
 *
 * ## 왜 이런 모양의 테스트인가
 * vitest 환경은 node 라 캔버스가 없어 `Text` 측정이 터진다 → 화면 클래스를 세울 수 없다. 그래서
 *   - 판정은 화면이 **실제로 부르는 순수 함수**를 직접 돌리고,
 *   - 스크롤 영역은 Pixi `Container`/`Graphics`(캔버스 불요)로 **진짜 조립**해 보고,
 *   - 화면이 그 함수·옵션을 정말 쓰는지는 소스 원문으로 대조한다(이 프로젝트의 반복 결함이
 *     "단위 테스트는 그린인데 배선이 통째로 없다"이므로 마지막 한 홉을 눈으로 확인한다).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Container, Graphics } from 'pixi.js';

import {
  inventoryPanelKind,
  slotPanelKind,
  panelMessageKey,
} from '../src/ui/pixi/modulesView.js';
import {
  makeScrollArea,
  thumbGeometry,
  SCROLL_THUMB_MIN_H,
  clampScroll,
} from '../src/ui/pixi/scrollArea.js';
import { t } from '../src/i18n/index.js';
import type { ModuleEquipState } from '../src/net/modules.js';

/** 소스 파일 원문(경로는 URL 로 만들어 node:path 셰이딩에 의존하지 않는다). */
function readSource(rel: string): string {
  const url = new URL(rel, import.meta.url);
  return new TextDecoder().decode(readFileSync(url.pathname.replace(/^\/([A-Za-z]:)/, '$1')));
}

function equipState(defenseId: string | null): ModuleEquipState {
  return { defenseId, equipped: [null, null] };
}

// ---------------------------------------------------------------------------
// ① 조회 실패 ≠ 비어 있음
// ---------------------------------------------------------------------------

describe('보관함: 조회 실패 / 빈 보관함 / 정상 목록', () => {
  it('세 상태가 각각 다르게 판정된다', () => {
    expect(inventoryPanelKind({ count: 0, failed: true })).toBe('failed');
    expect(inventoryPanelKind({ count: 0, failed: false })).toBe('empty');
    expect(inventoryPanelKind({ count: 3, failed: false })).toBe('list');
  });

  it('조회가 실패해도 직전에 받아 둔 목록이 있으면 그것을 계속 보여 준다', () => {
    // 있던 것을 지워 놓고 오류를 띄우면 "내 모듈이 날아갔다"로 읽힌다.
    expect(inventoryPanelKind({ count: 3, failed: true })).toBe('list');
  });

  it('실패 문구와 빈 보관함 문구가 서로 다른 말을 한다', () => {
    const failed = panelMessageKey(inventoryPanelKind({ count: 0, failed: true }));
    const empty = panelMessageKey(inventoryPanelKind({ count: 0, failed: false }));
    expect(failed).not.toBeNull();
    expect(empty).not.toBeNull();
    expect(failed).not.toBe(empty);
    // 키가 아니라 **해석된 문구**가 갈려야 한다(같은 문구로 매핑되면 사용자에겐 구분이 없다).
    expect(t(failed!)).not.toBe(t(empty!));
    // 실패 상태에서 "모듈이 없습니다"라고 단정하지 않는다.
    expect(t(failed!)).not.toBe(t('mod.inv.empty'));
  });

  it('목록을 그리는 상태에는 안내 문구가 없다(문구와 목록이 겹치지 않는다)', () => {
    expect(panelMessageKey('list')).toBeNull();
    expect(panelMessageKey('slots')).toBeNull();
  });
});

describe('슬롯: 조회 실패 / 방어 미배치 / 정상 슬롯', () => {
  it('장착 상태 조회 실패는 "방어 미배치"와 다른 상태다', () => {
    expect(slotPanelKind({ equip: null, failed: true })).toBe('failed');
    expect(slotPanelKind({ equip: equipState(null), failed: false })).toBe('noBase');
    expect(slotPanelKind({ equip: equipState('def-1'), failed: false })).toBe('slots');
  });

  it('실패 문구가 "먼저 방어 배치를 저장하세요"로 새지 않는다(사용자가 할 일이 정반대다)', () => {
    const failed = panelMessageKey(slotPanelKind({ equip: null, failed: true }));
    const noBase = panelMessageKey(slotPanelKind({ equip: equipState(null), failed: false }));
    expect(failed).not.toBe(noBase);
    expect(t(failed!)).not.toBe(t('mod.slot.noBase'));
  });

  it('세 안내 문구(실패·빈 보관함·미배치)가 모두 서로 다르다', () => {
    const texts = new Set(
      (['failed', 'empty', 'noBase'] as const).map((k) => t(panelMessageKey(k)!)),
    );
    expect(texts.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// ② 스크롤 위치 표시(thumb) 기하
// ---------------------------------------------------------------------------

describe('스크롤 위치 표시 기하', () => {
  it('스크롤할 게 없으면 아예 없다(항상 떠 있는 막대는 단서가 아니다)', () => {
    expect(thumbGeometry(400, 400, 0)).toBeNull();
    expect(thumbGeometry(400, 200, 0)).toBeNull();
  });

  it('보이는 비율만큼 짧아지되 최소 높이 아래로는 안 내려간다', () => {
    const half = thumbGeometry(400, 800, 0)!;
    expect(half.h).toBeCloseTo(200);
    const tiny = thumbGeometry(400, 40_000, 0)!;
    expect(tiny.h).toBe(SCROLL_THUMB_MIN_H);
  });

  it('맨 위는 창 위, 맨 아래는 창 바닥에 딱 붙는다', () => {
    const viewH = 400;
    const totalH = 1000;
    const top = thumbGeometry(viewH, totalH, 0)!;
    expect(top.y).toBe(0);
    const bottom = thumbGeometry(viewH, totalH, totalH - viewH)!;
    expect(bottom.y + bottom.h).toBeCloseTo(viewH);
  });

  it('스크롤이 내려가면 표시도 단조 증가한다', () => {
    let prev = -1;
    for (const s of [0, 100, 200, 400, 600]) {
      const g = thumbGeometry(400, 1000, s)!;
      expect(g.y).toBeGreaterThan(prev);
      prev = g.y;
    }
  });

  it('범위 밖 스크롤 값에도 창 안에 머문다(클램프 공유)', () => {
    const g = thumbGeometry(400, 1000, 99_999)!;
    expect(g.y + g.h).toBeCloseTo(400);
    expect(thumbGeometry(400, 1000, -50)!.y).toBe(0);
    expect(clampScroll(-50, 1000, 400)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ③ 스크롤 영역 실조립 (Pixi Container/Graphics — 캔버스 불요)
// ---------------------------------------------------------------------------

describe('makeScrollArea 실조립', () => {
  /** 스크롤 상태를 밖에 둔 채 영역을 만든다(화면이 하는 것과 같은 방식). */
  function build(opts: { totalH: number; thumb?: boolean }): {
    parent: Container;
    content: Container;
    state: { y: number };
  } {
    const parent = new Container();
    const state = { y: 0 };
    const content = makeScrollArea(parent, {
      x: 10,
      y: 20,
      w: 300,
      h: 400,
      totalH: opts.totalH,
      get: () => state.y,
      set: (v) => {
        state.y = v;
      },
      ...(opts.thumb === true ? { thumb: true } : {}),
    });
    return { parent, content, state };
  }

  it('옵션을 안 주면 표시를 그리지 않는다(기존 화면 겉모습 불변)', () => {
    // 기본값이 바뀌면 사령부·연구소·챔피언 화면에 막대가 새로 생긴다 — 남의 화면을 건드리지 않는다.
    expect(build({ totalH: 2000 }).parent.children.length).toBe(2); // 클립 + 마스크
  });

  it('스크롤 가능할 때만 표시가 붙는다', () => {
    expect(build({ totalH: 2000, thumb: true }).parent.children.length).toBe(3);
    // 내용이 창보다 짧으면 휠 리스너도 표시도 없다.
    expect(build({ totalH: 300, thumb: true }).parent.children.length).toBe(2);
  });

  it('표시는 마스크보다 위에 있고 실제로 무언가 그려진다', () => {
    const { parent } = build({ totalH: 2000, thumb: true });
    const thumb = parent.children[2];
    expect(thumb).toBeInstanceOf(Graphics);
    const bounds = (thumb as Graphics).getLocalBounds();
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
  });

  it('휠을 굴리면 내용이 움직이고 표시가 다시 그려진다', () => {
    const { parent, content, state } = build({ totalH: 2000, thumb: true });
    const thumb = parent.children[2] as Graphics;
    let redraws = 0;
    const origClear = thumb.clear.bind(thumb);
    thumb.clear = (): Graphics => {
      redraws++;
      return origClear();
    };

    const clip = parent.children[0] as Container;
    clip.emit('wheel', { deltaY: 120 } as never);

    expect(state.y).toBe(120);
    expect(content.y).toBe(-120);
    expect(redraws).toBeGreaterThan(0); // 표시가 그 자리에 얼어붙으면 거짓 정보다.
  });

  it('휠 상한을 넘겨도 마지막 행 아래로는 안 내려간다', () => {
    const { content, state, parent } = build({ totalH: 2000, thumb: true });
    (parent.children[0] as Container).emit('wheel', { deltaY: 99_999 } as never);
    expect(state.y).toBe(1600); // totalH - h
    expect(content.y).toBe(-1600);
  });
});

// ---------------------------------------------------------------------------
// ④ 배선 대조 — 화면이 정말 이 판정과 옵션을 쓰는가
// ---------------------------------------------------------------------------
//
// 순수 함수만 검증하면 "함수는 맞는데 화면은 옛 코드를 그대로 쓴다"가 통째로 지나간다 —
// 이 프로젝트에서 여덟 번 재발한 유형이다.

describe('코어 모듈 화면 배선', () => {
  const src = readSource('../src/ui/pixi/modulesView.ts');

  it('보관함·슬롯 패널이 상태 판정 함수를 거쳐 문구를 고른다', () => {
    expect(src).toMatch(/inventoryPanelKind\(\{\s*count:/);
    expect(src).toMatch(/slotPanelKind\(\{\s*equip/);
    expect(src).toMatch(/panelMessageKey\(/);
  });

  it('조회 실패를 빈 배열로 뭉개지 않는다(원 결함의 문법 자체를 금지)', () => {
    expect(src).not.toMatch(/this\.inventory\s*=\s*inv\s*\?\?\s*\[\]/);
    expect(src).toMatch(/this\.invFailed\s*=\s*inv === null/);
    expect(src).toMatch(/this\.equipFailed\s*=\s*equip === null/);
  });

  it('목록 스크롤 영역이 위치 표시를 켠다', () => {
    expect(src).toMatch(/thumb:\s*true/);
  });

  it('행 클릭은 행 Container 에, 휠은 클립 hitArea 에 걸려 있다(함정 1·6)', () => {
    // 행 클릭: 바탕 Graphics(listRowBg)에 리스너를 거는 형태가 없어야 한다.
    expect(src).toMatch(/attachRowClick\(row,/);
    expect(src).not.toMatch(/listRowBg\([^)]*\)\.on\(/);
    // 휠: 공용 스크롤 영역이 마스크가 아니라 클립에 건다.
    const scroll = readSource('../src/ui/pixi/scrollArea.ts');
    expect(scroll).toMatch(/clip\.hitArea\s*=\s*new Rectangle/);
    expect(scroll).toMatch(/clip\.on\('wheel'/);
    expect(scroll).not.toMatch(/mask\.on\(/);
  });

  it('텍스처 로드 후 재건이 리스너를 두 번 등록하지 않는다(함정 2)', () => {
    // 2026-08-03 AAA 전환으로 재렌더 규율이 바뀌었다: 루트를 매번 다시 그리는 대신
    // `buildChrome()` 1회 + `refresh()` 가 host 안만 갈아끼운다. 텍스처가 도착하면 구운 텍스처가
    // 바뀌므로 **크롬을 통째로 재건**하는데(`rebuild()`), 그 앞의 `destroyChrome()` 이 리스너째
    // 파괴하므로 이중 등록은 그대로 막힌다 — 막는 성질은 같고 기구만 달라졌다.
    expect(src).toMatch(/loadUiTextures\(\)\.then\(\(tex\) => \{[\s\S]*?this\.rebuild\(\);/);
    expect(src).toMatch(/private rebuild\(\)[\s\S]*?this\.destroyChrome\(\);[\s\S]*?this\.buildChrome\(\);/);
    expect(src).toMatch(/child\.destroy\(\{ children: true \}\)/);
  });
});
