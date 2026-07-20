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

/** WCAG 대비비(휘도 두 개). 아이콘 쪽은 PNG 실측 휘도라 색이 아니라 휘도로 받는다. */
function contrastL(la: number, lb: number): number {
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 연구소 노드 셀의 나무 바탕(verify 레인이 샘플한 값). */
const CELL_BG = 0x502f23;
/** 개편된 연구소 목록 행 바탕(카드 화면과 같은 값). */
const ROW_BG = 0x241d33;
/** 스킬 아이콘 35종 불투명 평균 휘도의 최저값(실측 — skill_max_hp_flat_high.png). */
const DARKEST_ICON_L = 0.079;

describe('iconContrastRingBands', () => {
  it('밴드는 어두운 홈 한 겹뿐 — 밝은 링은 사용자 지적으로 제거됐다', () => {
    const bands = iconContrastRingBands(44);
    expect(bands).toHaveLength(1);
    expect(bands[0]!.color).toBe(ICON_RING_GROOVE);
    // 홈이 아이콘 가장자리에 접한다(폭 2 의 절반 → 상자 밖 0~2px 를 덮는다).
    expect(bands[0]!.inset).toBe(1);
  });

  it('홈이 아이콘 상자 밖으로 나가는 총량은 밴드 폭 하나뿐', () => {
    for (const size of [32, 40, 44, 48, 64]) {
      const bands = iconContrastRingBands(size);
      const w = bands[0]!.width;
      const outermost = Math.max(...bands.map((b) => b.inset + b.width / 2));
      expect(outermost).toBe(w);
      // 자리 여백이 이 값 이상이면 아이콘이 셀 밖으로 걸칠 수 없다(삐져나옴 결함 방지).
      // 밴드 폭은 최소 2px 라 아주 작은 아이콘에서는 비율 대신 그 하한이 걸린다.
      expect(outermost).toBeLessThanOrEqual(Math.max(2, size * 0.06));
    }
  });

  it('밴드 폭·반지름은 최소값 아래로 내려가지 않는다', () => {
    const tiny = iconContrastRingBands(8);
    expect(tiny[0]!.width).toBeGreaterThanOrEqual(2);
    expect(tiny[0]!.radius).toBeGreaterThanOrEqual(4);
  });

  it('홈은 어떤 후보 바탕보다도 어둡다 — 그래서 아이콘 35종 전부의 경계를 만든다', () => {
    const groove = relativeLuminance(ICON_RING_GROOVE);
    expect(groove).toBeLessThan(relativeLuminance(CELL_BG));
    expect(groove).toBeLessThan(relativeLuminance(ROW_BG));
  });

  it('가장 어두운 아이콘도 홈 위에서는 대비 2 이상 — 바탕만으로는 미달한다', () => {
    // 실측: 나무 셀 위 1.45 · 목록 행 위 1.99 — 둘 다 2.0 미만이라 홈 없이는 성립하지 않는다.
    expect(contrastL(DARKEST_ICON_L, relativeLuminance(CELL_BG))).toBeLessThan(2);
    expect(contrastL(DARKEST_ICON_L, relativeLuminance(ROW_BG))).toBeLessThan(2);
    // 홈을 끼우면 바탕과 무관하게 2.0 을 넘긴다(실측 최악 2.39).
    expect(contrastL(DARKEST_ICON_L, relativeLuminance(ICON_RING_GROOVE))).toBeGreaterThan(2);
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
