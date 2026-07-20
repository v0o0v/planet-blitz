/**
 * 아이콘 대비 링 / 슬롯 등급색 검증 (실물 시각 검증 결함 3건 중 #1·#3).
 *
 * `iconContrastRingBands` 와 `SLOT_RARITY_COLOR_NUM` 은 UI-독립 순수 값이라(Pixi 미의존)
 * 여기서 고정한다. 실제 렌더 결과(링이 아이콘을 가리지 않는가, 레어가 프레임과 갈리는가)는
 * 브라우저 확대 크롭 확인 몫(handoff: 신규 테스트는 UI-독립 헬퍼에만).
 */

import { describe, it, expect } from 'vitest';
import {
  iconContrastRingBands,
  ICON_RING_CREAM,
  ICON_RING_GROOVE,
  RARITY_COLOR_NUM,
  SLOT_RARITY_COLOR_NUM,
} from '../src/ui/pixi/theme.js';

/** WCAG 상대 휘도 — 링 밴드가 실제로 "밝은 쪽/어두운 쪽"인지 값으로 확인한다. */
function relativeLuminance(rgb: number): number {
  const ch = [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a: number, b: number): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 연구소 노드 셀의 나무 바탕(verify 레인이 샘플한 값). */
const CELL_BG = 0x502f23;

describe('iconContrastRingBands', () => {
  it('연구소 노드 아이콘(44px)에서 홈이 안쪽·크림 링이 바깥쪽', () => {
    const bands = iconContrastRingBands(44);
    expect(bands).toHaveLength(2);
    const cream = bands.find((b) => b.color === ICON_RING_CREAM);
    const groove = bands.find((b) => b.color === ICON_RING_GROOVE);
    expect(cream).toBeDefined();
    expect(groove).toBeDefined();
    // 홈이 아이콘 가장자리에 접하고, 크림 링은 그 바깥을 돈다.
    expect(groove!.inset).toBeLessThan(cream!.inset);
    expect(groove!.inset).toBe(1); // 폭 2 의 절반 → 0~2px 를 덮는다
    expect(cream!.inset).toBe(3); // 2~4px
  });

  it('링이 아이콘 상자 밖으로 나가는 총량은 밴드 폭의 2배뿐', () => {
    for (const size of [40, 44, 64, 72]) {
      const bands = iconContrastRingBands(size);
      const w = bands[0]!.width;
      const outermost = Math.max(...bands.map((b) => b.inset + b.width / 2));
      expect(outermost).toBe(w * 2);
      // 44px 아이콘 → 4px. 셀 여백 안에서 끝나야 레이아웃 상수를 건드리지 않는다.
      expect(outermost).toBeLessThanOrEqual(size * 0.12);
    }
  });

  it('밴드 폭·반지름은 최소값 아래로 내려가지 않는다', () => {
    const tiny = iconContrastRingBands(8);
    expect(tiny[0]!.width).toBeGreaterThanOrEqual(2);
    expect(tiny[0]!.radius).toBeGreaterThanOrEqual(4);
  });

  it('크림 링은 나무 셀 대비 7 이상, 홈은 셀보다 어둡다', () => {
    // 링이 셀에서 아이콘 자리를 떼어 내는 근거, 홈이 "밝은 아이콘 전부"의 경계를 만드는 근거.
    expect(contrast(ICON_RING_CREAM, CELL_BG)).toBeGreaterThan(7);
    expect(relativeLuminance(ICON_RING_GROOVE)).toBeLessThan(relativeLuminance(CELL_BG));
  });
});

describe('SLOT_RARITY_COLOR_NUM', () => {
  it('레어만 공용 등급색과 다르다 — 나머지는 그대로', () => {
    expect(SLOT_RARITY_COLOR_NUM.rare).not.toBe(RARITY_COLOR_NUM.rare);
    expect(SLOT_RARITY_COLOR_NUM.normal).toBe(RARITY_COLOR_NUM.normal);
    expect(SLOT_RARITY_COLOR_NUM.magic).toBe(RARITY_COLOR_NUM.magic);
    expect(SLOT_RARITY_COLOR_NUM.unique).toBe(RARITY_COLOR_NUM.unique);
  });

  it('레어를 레몬 쪽으로 밀어 슬롯 프레임 금색·유니크 주황 양쪽에서 멀어진다', () => {
    const frameGold = 0xf8d641; // ui_slot_hl.png 최다 프레임색
    // 프레임 금색보다 밝아야(레몬 쪽) 프레임 위에서 띠로 읽힌다.
    expect(relativeLuminance(SLOT_RARITY_COLOR_NUM.rare)).toBeGreaterThan(
      relativeLuminance(frameGold),
    );
    // 파랑 채널을 올려 주황(유니크)에서 멀어진 것이지 주황 쪽으로 간 것이 아니다.
    expect(SLOT_RARITY_COLOR_NUM.rare & 0xff).toBeGreaterThan(RARITY_COLOR_NUM.rare & 0xff);
  });
});
