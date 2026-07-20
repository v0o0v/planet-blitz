/**
 * 카툰 UI 공용 테마 상수 (격납고 파일럿, plan §3).
 *
 * Pixi 는 색을 24bit 정수로 다루므로 DOM 인벤토리(`inventory.ts` RARITY_COLOR, hex
 * 문자열)와 같은 등급 색 문법을 정수로 미러링한다. 값은 동일(파밍 시각 언어 보존, 결정 9).
 * 폰트 스택은 한글 지원 시스템 폰트 우선(handoff 지시).
 */

import type { Rarity } from '../../items/types.js';

/** 등급 → 테두리/텍스트 색(정수). inventory.ts RARITY_COLOR 와 값 동일. */
export const RARITY_COLOR_NUM: Record<Rarity, number> = {
  normal: 0xb8c2d8,
  magic: 0x6aa0ff,
  rare: 0xffd24c,
  unique: 0xff8a3c,
};

/**
 * 슬롯 셀 **안에서만** 쓰는 등급색. 레어 하나만 {@link RARITY_COLOR_NUM} 과 다르다.
 *
 * 장착 슬롯은 아이템이 있을 때 `ui_slot_hl.png` 로 바뀌는데 그 텍스처의 프레임이 금색이다
 * (상위색 #F8D641 / #F8C552 / #E49F38). 레어 등급색 #FFD24C 는 프레임 금색과 ΔE 6.8 —
 * 사실상 같은 색이라 등급 테두리가 프레임에 흡수돼 한 덩어리로 읽혔다(인벤토리 그리드는
 * `ui_slot.png` 갈색 프레임이라 원래 정상이다).
 *
 * #FFEE7A 로 밀면 프레임 금색과 ΔE 18.2(2.7배)로 벌어지면서, 유니크 주황과의 거리도
 * 41.4 → 50.3 으로 **함께** 좋아진다(레어를 주황 쪽이 아니라 레몬 쪽으로 밀기 때문).
 * 노말/매직/유니크는 손대지 않는다 — 이미 검증된 구별을 깨지 않기 위해서다. 툴팁·DOM
 * 인벤토리가 쓰는 `RARITY_COLOR_NUM` 도 그대로다(색 문법 자체는 유지, 슬롯 셀만 조정).
 */
export const SLOT_RARITY_COLOR_NUM: Record<Rarity, number> = {
  ...RARITY_COLOR_NUM,
  rare: 0xffee7a,
};

/** 레어 테두리와 슬롯 프레임 사이에 파는 얇은 어두운 홈의 색. */
export const SLOT_RARE_GROOVE = 0x1e1108;

/** 한글 지원 시스템 폰트 스택(handoff). */
export const UI_FONT = '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif';

/** 크림/골드/회갈 등 목업 텍스트 팔레트. */
export const COLOR = {
  cream: 0xebdcbe,
  gold: 0xffd678,
  muted: 0xaa9b87,
  panelFill: 0x1c182e,
  bg: 0x181426,
  connector: 0xffd678,
  /** 밝은 바탕(노란 버튼 등) 위 라벨용 진한 갈색 — 흰 글씨가 묻히는 것을 막는다. */
  darkLabel: 0x4a2a08,
} as const;

/**
 * '#rrggbb' CSS 색 → Pixi 정수색. 형식이 어긋나면 중립 회청색으로 폴백한다.
 *
 * DOM 판이 소유한 팔레트(행성 `accent`, 방어 카드 등급색 …)를 캔버스에서 그대로 쓰기 위한
 * 변환이다. 성계 지도(#4)와 관제탑(#6) 두 화면이 쓰므로 여기로 올렸다(ADR-0014 공용 경계).
 */
export function hexColor(css: string): number {
  const n = Number.parseInt(css.replace('#', ''), 16);
  return Number.isNaN(n) ? 0x8896b8 : n;
}

/** 아이콘 대비 링의 한 밴드(아이콘 상자 기준 바깥으로 `inset` 만큼 나간 중심선). */
export interface IconRingBand {
  /** 아이콘 상자 변에서 밴드 중심선까지의 거리(px, 바깥 방향). */
  readonly inset: number;
  readonly width: number;
  readonly radius: number;
  readonly color: number;
  readonly alpha: number;
}

/** 아이콘 가장자리에 접하는 어두운 홈 색. */
export const ICON_RING_GROOVE = 0x120b07;
/** 홈 바깥을 도는 밝은 크림 링 색. */
export const ICON_RING_CREAM = 0xf6ebd2;

/**
 * 아이콘 대비 링 — 아이콘체(`pb-equip-icon`)가 무거운 다크 아웃라인을 쓰지 않기 때문에
 * 생기는 경계 약화를 **코드로** 상쇄한다. ADR-0016 이 "글로우가 없는 스킬 노드는 실화면
 * 검증에서 따로 본다"고 남겨 둔 지점이고, 코드 해법이라 앞으로 추가될 아이콘에도 자동 적용된다.
 *
 * 왜 어두운 홈 + 밝은 링의 2겹인가(밝은 판 한 장이 아니라):
 * 스킬 아이콘 35종의 불투명 평균 휘도를 실측하면 L 0.078~0.669 로 넓게 퍼져 있고 **전부**
 * 셀 바탕(#502F23, L 0.0386)보다 밝다. 그래서
 *  - 밝은 판을 깔면 판 휘도 근처의 중간 톤 아이콘이 새로 묻힌다(alpha 0.30 크림 판을 대입하면
 *    대비 2.0 미만이 10종 → 23종으로 오히려 늘어난다). 어떤 단일 배경색도 이 폭을 못 덮는다.
 *  - 반대로 **모두가 배경보다 밝다**는 성질 덕에, 아이콘 가장자리에 접하는 어두운 홈은 35종
 *    전부의 경계 대비를 올린다(나빠지는 아이콘 0종). 최악 1.45 → 2.28, 2.0 미만 10종 → 0종.
 *  - 홈만 있으면 아이콘 자리가 어두운 얼룩처럼 보이므로, 그 바깥을 크림 링이 돌아 자리 전체를
 *    나무 셀에서 떼어 놓는다(크림 vs 셀 대비 8.7). 밝은 아이콘은 크림과 융합할 만큼 밝지만
 *    (대비 1.1~1.5) 그 사이에 홈이 끼어 있어 붙어 보이지 않는다.
 */
export function iconContrastRingBands(size: number): IconRingBand[] {
  const w = Math.max(2, Math.round(size * 0.05));
  const radius = Math.max(4, Math.round(size * 0.18));
  return [
    { inset: w * 1.5, width: w, radius: radius + w, color: ICON_RING_CREAM, alpha: 0.92 },
    { inset: w * 0.5, width: w, radius, color: ICON_RING_GROOVE, alpha: 0.85 },
  ];
}

/** 텍스트 기본 다크 섀도(2px). */
export const TEXT_SHADOW = {
  color: 0x000000,
  alpha: 0.75,
  blur: 0,
  distance: 2,
  angle: Math.PI / 2,
} as const;
