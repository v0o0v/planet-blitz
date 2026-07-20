/**
 * 카툰나무풍 탭 바 (M7b-command-ui — **완전 신규**).
 *
 * Pixi 화면 어디에도 탭이 없었다(격납고·연구소·정제소·관제탑은 전부 보드 한 장 또는 팝업).
 * 방어 사령부는 성격이 다른 화면 다섯을 한 곳에 담아야 해서 탭이 필요하고, 그래서 세트
 * (ADR-0014 카툰나무풍) 안에서 탭이 어떻게 생겨야 하는지를 이 파일이 정한다.
 *
 * ## 시각 규격 — 왜 이렇게 정했나
 * 세트의 기본 어휘는 "나무 판때기(`ui_btn_*.png`) + 나무 프레임 패널(`ui_panel.png`) + 금색
 * 연결선(`COLOR.connector`)" 셋뿐이다. 탭도 그 셋으로만 만든다(신규 자산 요구 없음).
 *
 * ① **선택 탭은 아래 패널과 한 덩어리로 읽혀야 한다.** 그래서 선택 탭만 노란 판때기
 *    (`ui_btn_yellow.png`)로 올리고, 바 바닥을 가로지르는 금색 연결선을 **선택 탭 밑에서만
 *    끊는다**. 종이 폴더 탭과 같은 원리로, 색 대비가 아니라 "선이 끊긴다"는 기하가 선택을
 *    말하므로 색약·저채도 환경에서도 성립한다.
 * ② **비선택 탭은 아래로 가라앉힌다**({@link TAB_SINK}). 높이를 줄이는 게 아니라 y 를 내리고
 *    바닥을 바 밖으로 흘려 보내 위쪽만 보이게 한다 — 판때기 텍스처를 세로로 눌러 늘리면
 *    나무결 비율이 깨진다(9-slice 캡이 좌우뿐이라 세로는 그냥 늘어난다).
 * ③ 노란 판때기 위 흰 라벨은 묻힌다(세트 규칙) — 선택 탭 라벨은 {@link COLOR.darkLabel}.
 *
 * 기하({@link tabBarLayout})는 Pixi 없이 도는 순수 함수다. 폭 분배가 **정확히** 바 폭을
 * 채우는지(반올림 오차가 마지막 탭에 몰리는지)를 테스트가 직접 본다.
 */

import { Container, Graphics, Text, type Texture } from 'pixi.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { PixiButton } from './button.js';
import { stripEmoji } from './text.js';

/** 탭 판때기 기본 높이(px, 디자인 스페이스). */
export const TAB_H = 58;
/** 탭 사이 간격. */
export const TAB_GAP = 8;
/** 비선택 탭이 가라앉는 깊이(px). */
export const TAB_SINK = 10;
/** 바 바닥 금색 연결선 두께. */
export const TAB_CONNECTOR_H = 3;

/** 탭 1칸의 배치(순수 계산 결과). */
export interface TabRect {
  /** 바 로컬 x. */
  readonly x: number;
  /** 바 로컬 y(비선택은 {@link TAB_SINK} 만큼 내려간다). */
  readonly y: number;
  readonly w: number;
  /** 판때기 높이(가라앉은 만큼 바 안에서 보이는 높이는 h - y). */
  readonly h: number;
  readonly active: boolean;
}

export interface TabBarLayoutOptions {
  /** 바 전체 폭. */
  width: number;
  /** 선택 인덱스(범위 밖이면 선택 없음). */
  activeIndex: number;
  gap?: number;
  height?: number;
  sink?: number;
}

/**
 * 탭 폭을 균등 분배한다. 반올림 오차는 **마지막 탭이 흡수**해 탭 오른쪽 끝이 바 폭과 정확히
 * 일치한다(끝이 1~2px 어긋나면 아래 패널과의 정렬이 눈에 띈다).
 */
export function tabBarLayout(count: number, opts: TabBarLayoutOptions): TabRect[] {
  const gap = opts.gap ?? TAB_GAP;
  const h = opts.height ?? TAB_H;
  const sink = opts.sink ?? TAB_SINK;
  if (count <= 0) return [];
  const inner = Math.max(0, opts.width - gap * (count - 1));
  const base = Math.floor(inner / count);
  const out: TabRect[] = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    // 바가 탭 수에 비해 지나치게 좁으면(간격 합이 폭을 넘김) x 가 바 밖으로 나간다 —
    // 폭으로 잘라 두면 마지막 탭의 오른쪽 끝이 언제나 바 폭과 정확히 일치한다.
    const x = Math.min(cursor, opts.width);
    const last = i === count - 1;
    const w = last ? Math.max(0, opts.width - x) : Math.min(base, opts.width - x);
    const active = i === opts.activeIndex;
    out.push({ x, y: active ? 0 : sink, w, h, active });
    cursor = x + w + gap;
  }
  return out;
}

/** 연결선이 그려지는 구간 목록(선택 탭 밑은 비운다). 순수. */
export function connectorSpans(rects: readonly TabRect[], width: number): { x: number; w: number }[] {
  const active = rects.find((r) => r.active);
  if (active === undefined) return [{ x: 0, w: width }];
  const spans: { x: number; w: number }[] = [];
  if (active.x > 0) spans.push({ x: 0, w: active.x });
  const right = active.x + active.w;
  if (right < width) spans.push({ x: right, w: width - right });
  return spans;
}

export interface TabBarOptions {
  width: number;
  labels: readonly string[];
  activeIndex: number;
  onSelect: (index: number) => void;
  /** 선택 탭 텍스처(없으면 Graphics 폴백). */
  activeTexture?: Texture | null | undefined;
  /** 비선택 탭 텍스처. */
  idleTexture?: Texture | null | undefined;
  fontSize?: number;
  /** 비활성(잠금) 탭 인덱스 — 클릭 불가·흐림. */
  disabled?: readonly number[];
}

/**
 * 탭 바 한 줄을 만든다. 반환 Container 는 (0,0) 기준 width × ({@link TAB_H}) 를 차지하고,
 * 바로 아래에 보드 패널을 붙이면 선택 탭이 패널과 이어져 보인다.
 */
export function makeTabBar(opts: TabBarOptions): Container {
  const root = new Container();
  const rects = tabBarLayout(opts.labels.length, {
    width: opts.width,
    activeIndex: opts.activeIndex,
  });

  // ① 바 바닥 금색 연결선 — 선택 탭 밑에서만 끊긴다(모듈 주석 ①).
  const line = new Graphics();
  for (const span of connectorSpans(rects, opts.width)) {
    line.rect(span.x, TAB_H - TAB_CONNECTOR_H, span.w, TAB_CONNECTOR_H).fill({ color: COLOR.connector });
  }
  root.addChild(line);

  rects.forEach((r, i) => {
    const locked = opts.disabled?.includes(i) === true;
    const btn = new PixiButton({
      texture: r.active ? opts.activeTexture : opts.idleTexture,
      fallbackColor: r.active ? 0x9a7a2a : 0x4a3a24,
      width: r.w,
      height: r.h,
      fontSize: opts.fontSize ?? 20,
      // ③ 노란 판때기 위 흰 라벨은 묻힌다.
      ...(r.active ? { labelColor: COLOR.darkLabel } : {}),
      label: stripEmoji(opts.labels[i] ?? ''),
      onClick: () => opts.onSelect(i),
    });
    btn.container.position.set(r.x, r.y);
    if (!r.active) btn.container.alpha = 0.82;
    if (locked) btn.setEnabled(false);
    root.addChild(btn.container);
  });

  return root;
}

/** 탭 바 위쪽에 붙이는 작은 상태 꼬리표(미저장 표시 등). */
export function makeTabBadge(text: string, color: number = COLOR.gold): Text {
  return new Text({
    resolution: 2,
    text: stripEmoji(text),
    style: { fontFamily: UI_FONT, fontSize: 17, fontWeight: '700', fill: color, dropShadow: TEXT_SHADOW },
  });
}
