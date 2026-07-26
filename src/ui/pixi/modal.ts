/**
 * 팝업(모달) 껍데기 공용 부품 (M7b-command-ui — 공용 승격 #2).
 *
 * 관제탑(`src/ui/pixi/controlTower.ts:1318 renderModal`)이 private 로 갖고 있던 조립
 * ─ 암막 + 가운데 나무 패널 + 제목 + 닫기 아이콘 ─ 을 공용으로 올렸다.
 *
 * ## 실측 규칙 세 가지
 * ① **밝은 화면 위 팝업은 `fillAlpha: 1`.** 기본값 0.96 이면 뒤 화면 글자가 비쳐 읽힌다
 *    (연구소 스킬 팝업에서 파생 스탯 글자가 그대로 읽혔던 결함).
 * ② **암막은 이벤트를 먹어야 한다.** `eventMode='static'` 이 아니면 뒤 보드로 클릭·휠이 새서,
 *    닫힌 줄 알았던 목록이 스크롤된다.
 * ③ **패널 안쪽 탭은 암막까지 전파를 끊는다.** 안 그러면 팝업 안을 누를 때마다 창이 닫힌다.
 *
 * 화면 배치가 아니라 껍데기만 만든다 — 내용은 호출자가 반환된 `panel`·`box` 안에 채운다.
 */

import { Container, Graphics, Text, type FederatedPointerEvent, type Texture } from 'pixi.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { nineSlicePanel, panelContent, PANEL_BORDER, type PanelContentBox } from './nineSlicePanel.js';
import { makeIconButton } from './titleBar.js';
import { stripEmoji } from './text.js';

/** 암막 색·알파(관제탑 값 계승). */
export const MODAL_SCRIM_COLOR = 0x05060f;
export const MODAL_SCRIM_ALPHA = 0.78;
/** 닫기 아이콘 한 변. */
export const MODAL_CLOSE_SIZE = 44;

/**
 * 제목이 쓰는 세로 밴드(px) — **콘텐츠는 이 아래에서 시작해야 한다**.
 *
 * `makeModal` 은 제목을 `box.y` 에 놓는다. 그래서 호출자가 콘텐츠도 `box.y` 에 놓으면
 * 제목과 정확히 겹친다 — 파일럿 파일 팝업에서 태그라인이 제목 위에 덮쳐 둘 다 못 읽게 됐던
 * 실측 결함이다(초상 스프라이트도 같은 y 였지만 위쪽이 투명해 겹침이 눈에 덜 띄었다).
 *
 * 값은 제목 글자 크기(26) + 숨 쉴 틈에서 나온다. 다른 팝업들은 각자 40~60 을 눈대중으로
 * 박아 두고 있었는데, 새 팝업이 그 관례를 모르면 다시 겹친다 — 그래서 상수로 올려 두고
 * `tests/modalTitleBand.test.ts` 가 "이 값 이상"이라는 부등식을 지킨다.
 */
export const MODAL_TITLE_BAND = 44;

/** 제목 밴드를 제외한 **본문 시작 y**(패널 로컬). 콘텐츠 배치의 기준점. */
export function modalBodyTop(box: PanelContentBox): number {
  return box.y + MODAL_TITLE_BAND;
}

/** 팝업 사각형(디자인 스페이스 기준 좌표). */
export interface ModalGeometry {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 화면 정중앙에 놓인 팝업 사각형(정수 좌표 — 반픽셀 흐림 방지). 순수. */
export function modalGeometry(w: number, h: number): ModalGeometry {
  return {
    x: Math.round((DESIGN_WIDTH - w) / 2),
    y: Math.round((DESIGN_HEIGHT - h) / 2),
    w,
    h,
  };
}

export interface ModalOptions {
  width: number;
  height: number;
  title: string;
  onClose: () => void;
  panelTexture?: Texture | null | undefined;
  closeTexture?: Texture | null | undefined;
  /** 제목 색(기본 크림). */
  titleColor?: number;
}

export interface ModalParts {
  /** 암막 + 패널을 담은 루트. 호출자가 화면 루트에 붙인다(맨 위에). */
  readonly root: Container;
  /** 패널 Container(로컬 (0,0) = 팝업 좌상단). 내용은 여기에 붙인다. */
  readonly panel: Container;
  /** 패널 안 콘텐츠 상자(프레임·여백 제외 — 여기 밖에 그리면 나무 테두리를 침범한다). */
  readonly box: PanelContentBox;
  /** 팝업 사각형(DOM 오버레이를 얹을 때 화면 좌표 환산에 쓴다). */
  readonly geom: ModalGeometry;
}

/** 암막 + 가운데 패널 + 제목 + 닫기. 내용은 비어 있다. */
export function makeModal(opts: ModalOptions): ModalParts {
  const root = new Container();
  const geom = modalGeometry(opts.width, opts.height);

  // ② 암막 — 뒤로 포인터/휠이 새지 않게 막고, 바깥을 누르면 닫는다.
  const scrim = new Graphics();
  scrim.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: MODAL_SCRIM_COLOR, alpha: MODAL_SCRIM_ALPHA });
  scrim.eventMode = 'static';
  scrim.on('pointertap', () => opts.onClose());
  root.addChild(scrim);

  const panel = new Container();
  panel.position.set(geom.x, geom.y);
  root.addChild(panel);
  // ① 밝은 화면 위 팝업은 완전 불투명.
  panel.addChild(
    nineSlicePanel(opts.width, opts.height, {
      texture: opts.panelTexture,
      border: PANEL_BORDER,
      fillAlpha: 1,
    }),
  );
  // ③ 팝업 안쪽 클릭이 암막으로 새어 창이 닫히는 것을 막는다.
  panel.eventMode = 'static';
  panel.on('pointertap', (e: FederatedPointerEvent) => e.stopPropagation());

  const box = panelContent(opts.width, opts.height);

  const title = new Text({
    resolution: 2,
    text: stripEmoji(opts.title),
    style: {
      fontFamily: UI_FONT,
      fontSize: 26,
      fontWeight: '800',
      fill: opts.titleColor ?? COLOR.cream,
      dropShadow: TEXT_SHADOW,
    },
  });
  title.position.set(box.x, box.y);
  const titleMax = box.w - MODAL_CLOSE_SIZE - 16;
  if (title.width > titleMax) title.scale.x = titleMax / title.width;
  panel.addChild(title);

  const close = makeIconButton(MODAL_CLOSE_SIZE, () => opts.onClose(), opts.closeTexture);
  close.position.set(box.right - MODAL_CLOSE_SIZE, box.y - 4);
  panel.addChild(close);

  return { root, panel, box, geom };
}
