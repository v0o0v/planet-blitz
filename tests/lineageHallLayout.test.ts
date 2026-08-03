/**
 * 계보 전당 레이아웃·순수 파생 검증 (ADR-0007 · 2026-08-03).
 *
 * ## 왜 이 테스트가 있는가
 * 이 리포는 "겹치면 안 되는 세로 띠"가 실제로 겹친 결함을 격납고 헤더에서 겪었고, 캔버스 없는
 * vitest 는 Pixi 화면을 세울 수 없어 그 유형이 **눈으로만** 잡힌다. 그래서 좌표를
 * `lineageHallLayout()` 이 순수 값으로 내보내고, 여기서 겹침·이탈·예약 밴드 침범을 잠근다.
 *
 * 그리고 이 화면이 보여 주는 수는 **되돌릴 수 없는 지출**의 근거다. 계보에는 리스펙이 없어
 * (ADR-0007 R2) 화면이 잘못된 비용·보너스를 적으면 플레이어는 그 오표기대로 영구히 손해를 본다.
 * `branchView`·`milestoneRows` 를 `data/lineage.ts` 정본과 함께 잠그는 이유다.
 *
 * 여기서 검증하는 것은 **좌표 산술과 순수 파생**이지 그림이 아니다. 그림 판정은 하네스 실화면
 * 스크린샷이다.
 */

import { describe, expect, it } from 'vitest';
import {
  lineageHallLayout,
  branchView,
  bpPct,
  milestoneRows,
  GEAR_BAND_H,
  GEAR_BAND_W,
  type LineageHallRect,
} from '../src/ui/pixi/lineageHall.js';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../src/render/app.js';
import {
  branchBonusBp,
  branchInvestedPoints as investedPoints,
  emptyLineage,
  nextLevelCost,
  CORE_GUARD_LEVEL,
  LINEAGE_BONUS_CAP_BP,
  REBOOT_LEVEL,
  SHIELD_SHARE_LEVEL,
  type LineageState,
} from '../data/lineage.js';

const right = (r: LineageHallRect): number => r.x + r.w;
const bottom = (r: LineageHallRect): number => r.y + r.h;

function overlaps(a: LineageHallRect, b: LineageHallRect): boolean {
  return a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);
}

function state(o: Partial<LineageState>): LineageState {
  return { ...emptyLineage(), ...o };
}

describe('계보 전당 레이아웃', () => {
  const L = lineageHallLayout();

  it('화면 치수가 디자인 스페이스와 같다', () => {
    expect(L.screen).toEqual({ x: 0, y: 0, w: DESIGN_WIDTH, h: DESIGN_HEIGHT });
  });

  it('패널이 서로 겹치지 않는다', () => {
    const rects = L.panels.map((p) => p.rect);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        expect(overlaps(a, b), `패널 ${L.panels[i]!.id} ↔ ${L.panels[j]!.id} 겹침`).toBe(false);
      }
    }
  });

  it('패널이 헤더 밴드를 침범하지 않고 화면 안에 있다', () => {
    for (const p of L.panels) {
      expect(p.rect.y, p.id).toBeGreaterThanOrEqual(L.headerH);
      expect(p.rect.x, p.id).toBeGreaterThanOrEqual(0);
      expect(right(p.rect), p.id).toBeLessThanOrEqual(DESIGN_WIDTH);
      expect(bottom(p.rect), p.id).toBeLessThanOrEqual(DESIGN_HEIGHT);
    }
  });

  /**
   * 우측 두 패널의 바닥은 좌측 가지 패널 바닥과 **같아야** 한다. 파생이 아니라 하드코딩으로
   * 흘러들면 한쪽 높이를 바꿀 때 바닥이 조용히 어긋난다(형제 화면들이 겪은 유형).
   */
  it('우측 마일스톤 패널 바닥이 좌측 가지 패널 바닥과 같다', () => {
    const byId = new Map(L.panels.map((p) => [p.id, p.rect]));
    expect(bottom(byId.get('milestones')!)).toBe(bottom(byId.get('branches')!));
  });

  it('헤더 컨트롤이 헤더 밴드 안에 있고 좌상단 예약 밴드를 침범하지 않는다', () => {
    for (const c of L.headerControls) {
      expect(bottom(c.rect), c.id).toBeLessThanOrEqual(L.headerH);
      expect(right(c.rect), c.id).toBeLessThanOrEqual(DESIGN_WIDTH);
      // 설정 톱니가 매 프레임 stage 최상위로 올라오는 자리 — 겹치면 통째로 클릭 불가가 된다.
      const gearBand: LineageHallRect = { x: 0, y: 0, w: GEAR_BAND_W, h: GEAR_BAND_H };
      expect(overlaps(c.rect, gearBand), `${c.id} 가 톱니 예약 밴드 침범`).toBe(false);
    }
  });

  it('헤더 컨트롤끼리 겹치지 않는다', () => {
    const rects = L.headerControls.map((c) => c.rect);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlaps(rects[i]!, rects[j]!)).toBe(false);
      }
    }
  });
});

describe('가지 표시값(branchView)', () => {
  it('레벨 0 은 보너스 0 · 비용 40(정본 곡선과 일치)', () => {
    const v = branchView(state({ available: 100 }), 'ship');
    expect(v.level).toBe(0);
    expect(v.bonusBp).toBe(0);
    expect(v.cost).toBe(nextLevelCost(0));
    expect(v.nextBonusBp).toBe(branchBonusBp(1));
    expect(v.deltaBp).toBe(branchBonusBp(1));
    expect(v.ratio).toBe(0);
  });

  it('가지를 구분해 읽는다 — 기체와 수호가 섞이지 않는다', () => {
    const st = state({ shipLevel: 3, guardianLevel: 11, available: 500 });
    expect(branchView(st, 'ship').level).toBe(3);
    expect(branchView(st, 'guardian').level).toBe(11);
    expect(branchView(st, 'ship').bonusBp).toBe(branchBonusBp(3));
    expect(branchView(st, 'guardian').bonusBp).toBe(branchBonusBp(11));
    // 비용은 **그 가지의** 레벨에서만 나온다.
    expect(branchView(st, 'ship').cost).toBe(nextLevelCost(3));
    expect(branchView(st, 'guardian').cost).toBe(nextLevelCost(11));
  });

  it('포인트가 모자라면 부족분을 정확히 센다', () => {
    const st = state({ shipLevel: 2, available: 50 });
    const v = branchView(st, 'ship');
    expect(v.cost).toBe(60);
    expect(v.affordable).toBe(false);
    expect(v.shortBy).toBe(10);
  });

  it('정확히 비용만큼 있으면 투자 가능이고 부족분은 0', () => {
    const st = state({ shipLevel: 2, available: nextLevelCost(2) });
    const v = branchView(st, 'ship');
    expect(v.affordable).toBe(true);
    expect(v.shortBy).toBe(0);
  });

  /**
   * 막대 두 구간의 폭이 된다 — 상한을 넘기면 막대가 패널 밖으로 나간다.
   *
   * ⚠️ 다음 레벨이 **항상 더 크지는 않다.** `branchBonusBp` 는 결정론 정수(내림)라 극고레벨
   * (수천 단위)에서는 1레벨을 더 사도 basis-point 가 그대로다 — 이 테스트를 쓰다 실제로 잡았다
   * (L=5000 과 5001 이 둘 다 4980bp). 화면은 그 구간에서 "다음 레벨 +0%p" 를 정직하게 적고,
   * 유령 막대는 1px 미만이면 그리지 않는다(`drawBar`).
   */
  it('막대 비율은 [0,1) 이고 다음 레벨이 뒤로 가지 않는다(점근이라 1 에 닿지 않는다)', () => {
    for (const lv of [0, 1, 10, 25, 50, 200, 5000]) {
      const v = branchView(state({ guardianLevel: lv, available: 0 }), 'guardian');
      expect(v.ratio).toBeGreaterThanOrEqual(0);
      expect(v.ratio).toBeLessThan(1);
      expect(v.nextRatio).toBeGreaterThanOrEqual(v.ratio);
      expect(v.nextRatio).toBeLessThanOrEqual(1);
      expect(v.deltaBp).toBeGreaterThanOrEqual(0);
      expect(v.bonusBp).toBeLessThanOrEqual(LINEAGE_BONUS_CAP_BP);
    }
  });

  /** 실질 성장이 있는 구간(레벨 수백 이하)에서는 다음 레벨이 반드시 더 커야 한다. */
  it('현실적 레벨 구간에서는 다음 레벨이 실제로 더 크다', () => {
    for (const lv of [0, 1, 10, 25, 50, 200]) {
      const v = branchView(state({ guardianLevel: lv, available: 0 }), 'guardian');
      expect(v.deltaBp, `Lv${lv}`).toBeGreaterThan(0);
    }
  });

  it('증가분은 레벨이 오를수록 줄어든다(로그 점근 — 감소 수익)', () => {
    const low = branchView(state({ shipLevel: 1 }), 'ship').deltaBp;
    const mid = branchView(state({ shipLevel: 40 }), 'ship').deltaBp;
    expect(low).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThanOrEqual(0);
  });
});

describe('묻은 포인트(investedPoints)', () => {
  it('레벨 0 은 0', () => {
    expect(investedPoints(0)).toBe(0);
  });

  /**
   * 닫힌 식이 정본 비용 곡선과 **어긋나면** 화면이 매몰 포인트를 틀리게 적는다. 누산과 대조해
   * 잠근다 — 식을 손으로 유도한 자리라 대조 없이는 오타가 조용히 산다.
   */
  it('정본 비용을 레벨까지 누산한 값과 같다', () => {
    for (let lv = 0; lv <= 60; lv++) {
      let sum = 0;
      for (let i = 0; i < lv; i++) sum += nextLevelCost(i);
      expect(investedPoints(lv), `Lv${lv}`).toBe(sum);
    }
  });

  it('음수·소수는 안전하게 절삭한다', () => {
    expect(investedPoints(-5)).toBe(0);
    expect(investedPoints(3.9)).toBe(investedPoints(3));
  });
});

describe('퍼센트 표시(bpPct)', () => {
  it('정수는 꼬리를 붙이지 않고 소수는 두 자리로 적는다', () => {
    expect(bpPct(0)).toBe('0');
    expect(bpPct(5000)).toBe('50');
    expect(bpPct(1667)).toBe('16.67');
  });
});

describe('수호 가지 마일스톤 행', () => {
  it('요구 레벨이 정본 상수와 같다', () => {
    const rows = milestoneRows(0);
    expect(rows.map((r) => r.req)).toEqual([REBOOT_LEVEL, CORE_GUARD_LEVEL, SHIELD_SHARE_LEVEL]);
    expect(rows.every((r) => !r.unlocked)).toBe(true);
  });

  it('요구 레벨에 **도달하면** 해금이다(경계 포함)', () => {
    expect(milestoneRows(REBOOT_LEVEL - 1)[0]!.unlocked).toBe(false);
    expect(milestoneRows(REBOOT_LEVEL)[0]!.unlocked).toBe(true);
    expect(milestoneRows(CORE_GUARD_LEVEL)[1]!.unlocked).toBe(true);
    expect(milestoneRows(SHIELD_SHARE_LEVEL)[2]!.unlocked).toBe(true);
  });

  it('해금은 누적이다 — 뒤를 열면 앞도 열려 있다(리스펙 없음 = 단조 증가)', () => {
    const rows = milestoneRows(SHIELD_SHARE_LEVEL);
    expect(rows.every((r) => r.unlocked)).toBe(true);
  });
});
