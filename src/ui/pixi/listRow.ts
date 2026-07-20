/**
 * 목록 행 공용 부품 (M7b-command-ui — 공용 승격 #3).
 *
 * 카드 화면(`src/ui/pixi/cardsView.ts:108`)이 파일 안에 숨겨 두고 쓰던 `listRowBg` 를
 * 공용으로 올린 것이다. 방어 사령부가 목록을 다섯 군데(웨이브 슬롯·소켓·기물·보관함·설계도)
 * 에서 쓰는데, 같은 조립을 여섯 번째로 복제하면 선택 링 두께 하나가 화면마다 갈린다.
 *
 * ## 여기 있는 두 함수가 막는 실측 결함
 * ① {@link listRowBg} — 행 바탕 + 선택 링/강조 테두리의 **단일 정의**.
 * ② {@link attachRowClick} — **행 클릭은 행 Container 에 건다**. 바탕 Graphics 에만 걸면
 *    그 위에 얹힌 텍스트가 클릭을 삼킨다(Pixi 히트 테스트는 형제로 내려가지 않는다 —
 *    관제탑 #6 에서 실제로 났던 결함). 함수로 만들어 두면 호출부가 실수할 여지가 없다.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, type FederatedPointerEvent } from 'pixi.js';
import { COLOR } from './theme.js';

/** 행 바탕색(어두운 보라 — 나무 패널 내부 채움보다 한 단 밝다). */
export const ROW_FILL = 0x241d33;
/** 행 바탕 알파. */
export const ROW_FILL_ALPHA = 0.92;
/** 기본 테두리색(갈색 — 나무 프레임 계열). */
export const ROW_STROKE = 0x5a4630;
/** 행 모서리 라운드. */
export const ROW_RADIUS = 10;

export interface ListRowOptions {
  /** 선택 상태(금색 두꺼운 링). */
  selected?: boolean;
  /** 강조 테두리색(등급색·장착색 등). `selected` 가 우선한다. */
  accent?: number;
  /** 바탕 알파(기본 {@link ROW_FILL_ALPHA}). 밝은 화면 위 팝업 안에서는 1 로 올린다. */
  fillAlpha?: number;
}

/** 목록 행 바탕 한 장. 위치는 호출자가 잡는다((0,0) 기준 w×h). */
export function listRowBg(w: number, h: number, opts: ListRowOptions = {}): Graphics {
  const g = new Graphics();
  g.roundRect(0, 0, w, h, ROW_RADIUS).fill({ color: ROW_FILL, alpha: opts.fillAlpha ?? ROW_FILL_ALPHA });
  const stroke = opts.selected === true ? COLOR.gold : (opts.accent ?? ROW_STROKE);
  g.roundRect(0, 0, w, h, ROW_RADIUS).stroke({
    color: stroke,
    width: opts.selected === true ? 3 : 2,
    alignment: 1,
  });
  return g;
}

/**
 * 행 전체를 클릭 대상으로 만든다. **반드시 행 Container 에 걸어야 한다** — 바탕 Graphics 에
 * 걸면 위에 얹힌 텍스트를 누를 때 이벤트가 안 온다(실측). 행 안의 버튼은
 * {@link stopRowPropagation} 으로 끊어 이중 발동을 막는다.
 */
export function attachRowClick(row: Container, onTap: () => void): void {
  row.eventMode = 'static';
  row.cursor = 'pointer';
  row.on('pointertap', () => onTap());
}

/**
 * 행 안에 놓인 버튼이 행 클릭까지 함께 발동시키지 않도록 전파를 끊는다(선택 토글이 두 번
 * 뒤집히는 실측 결함 — cardsView 합성 모드에서 났다).
 */
export function stopRowPropagation(node: Container): void {
  node.on('pointertap', (e: FederatedPointerEvent) => e.stopPropagation());
}
