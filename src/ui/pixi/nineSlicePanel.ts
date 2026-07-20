/**
 * 9-slice 나무 패널 (격납고 파일럿, plan §3 · 결정 4).
 *
 * `ui_panel.png`(중앙 투명) 을 Pixi `NineSliceSprite` 로 임의 크기까지 늘려 프레임을
 * 만들고, 그 안쪽에 어두운 내부(#1c182e 계열)를 코드로 깐다 — 목업 사양대로. 텍스처가
 * 없으면(로드 실패) 둥근 사각 Graphics 프레임으로 폴백한다. 좌표계는 1920×1080 디자인
 * 스페이스(부모 stage 가 레터박스 스케일).
 */

import { Container, Graphics, NineSliceSprite, type Texture } from 'pixi.js';
import { COLOR } from './theme.js';

/**
 * `ui_panel.png` 의 9-slice 테두리(px). 늘어나는 중앙 슬라이스가 나무 살을 물지 않도록
 * 실제 살 두께({@link PANEL_FRAME_SOLID})보다 넉넉하게 잡은 값이다 — 살 두께가 아니다.
 */
export const PANEL_BORDER = 46;

/**
 * 프레임 텍스처에서 **불투명한 나무 살이 끝나는 지점**(px, 실측).
 *
 * `ui_panel.png`(300×300)은 알파가 0/255 뿐이고, 중앙 구멍이 가장자리로부터 37~39px 에서
 * 시작한다(그림이라 변이 조금씩 다르다 — 위 39·좌우 38·아래 37). 기준은 항상 **제일 얇은
 * 쪽**이다. 9-slice 테두리(46)보다 9px 안쪽이라는 뜻이고, 그래서 채움 inset 을 `border`
 * 에서 유도하면 안 된다({@link PANEL_FILL_INSET} 참고). 자산을 다시 뽑으면 이 값이 바뀔 수
 * 있어 `tests/panelFrameGeometry.test.ts` 가 실제 PNG 알파로 검증한다.
 */
export const PANEL_FRAME_SOLID = 37;

/**
 * 내부 채움을 프레임 안쪽으로 들이는 기본 깊이(px).
 *
 * 나무 살({@link PANEL_FRAME_SOLID}) 밑으로 7px 밀어 넣는다. 채움은 프레임보다 **먼저**
 * 그려지므로 이 겹침 구간은 불투명한 나무에 완전히 가려져 보이지 않는다 — 대신 채움과 살
 * 사이에 틈이 생기지 않는다. 한때 기본값이 `border - 2`(=44) 였는데, 그러면 채움이 살보다
 * 한참 안쪽인 44 에서 끝나 **6px 짜리 투명 링**이 남았다. 평면 배경 위 패널에서는 배경색이
 * 비쳐도 티가 안 나 오래 살아 있었지만, 화면 위에 얹는 팝업(설정·타이틀·연구소 스킬 목록)
 * 에서는 뒤 화면이 그대로 비치는 띠가 됐다(연구소 팝업 아래로 파생 스탯 글자가 읽혔다 —
 * 실측 결함).
 *
 * 무작정 줄이면 되는 것도 아니다: 프레임 **바깥** 모서리가 둥글어 inset 이 5 이하가 되면
 * 이번엔 채움 모서리가 프레임 밖으로 삐져나온다. 실측 안전 구간은 6~36 이고(양끝 모두
 * 테스트가 확인한다) 30 은 그 안에서 가운데쯤 잡은 값이다 — 위로 6px, 아래로 24px 여유.
 */
export const PANEL_FILL_INSET = 30;

/** 내부 채움 모서리 라운드(px). 프레임 안쪽 구멍의 둥근 모서리와 맞춘다. */
export const PANEL_FILL_RADIUS = 10;

/**
 * 프레임 **안쪽에 추가로** 비워야 하는 여백(px).
 *
 * 프레임 경계(46)에 콘텐츠를 딱 붙이면 — 특히 패널 제목처럼 큰 텍스트는 — 나무 테두리에
 * 얹힌 것처럼 보인다(사용자 지적 2회: 격납고 파일럿, 연구소 롤아웃). 침범이 아니라
 * "숨 쉴 틈"의 문제라 `border` 만으로는 못 막는다. 모든 화면은 콘텐츠를
 * {@link panelContent} 가 주는 상자 안에만 배치한다.
 */
export const PANEL_INNER_PAD = 14;

/** 패널 안쪽 콘텐츠 상자(프레임 + 여백을 뺀 영역). 좌표는 패널 로컬. */
export interface PanelContentBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 콘텐츠 오른쪽 한계(x + w). */
  right: number;
  /** 콘텐츠 아래쪽 한계(y + h) — 마스크 하한·마지막 행 계산의 기준. */
  bottom: number;
}

/**
 * 패널(w×h) 안에서 콘텐츠가 들어가도 되는 상자를 돌려준다. 제목·본문·슬롯·버튼·마스크
 * 하한을 전부 이 상자 기준으로 잡으면 프레임 침범도, 테두리에 붙는 것도 구조적으로 막힌다.
 */
export function panelContent(w: number, h: number, border = PANEL_BORDER, pad = PANEL_INNER_PAD): PanelContentBox {
  const inset = border + pad;
  const cw = Math.max(0, w - inset * 2);
  const ch = Math.max(0, h - inset * 2);
  return { x: inset, y: inset, w: cw, h: ch, right: inset + cw, bottom: inset + ch };
}

export interface PanelOptions {
  /** 프레임 텍스처(없으면 Graphics 폴백). */
  texture?: Texture | null | undefined;
  /** 9-slice 사방 테두리(px). ui_panel 기준 46. */
  border?: number;
  /** 내부 어두운 채움 색. */
  fillColor?: number;
  /** 내부 채움 알파(0~1). 목업 alpha 245 ≈ 0.96. */
  fillAlpha?: number;
  /** 프레임 안쪽으로 내부 채움을 얼마나 들일지(px). 기본 {@link PANEL_FILL_INSET}. */
  fillInset?: number;
}

/**
 * 어두운 내부 + 나무 프레임 패널을 만든다. 반환 Container 는 (0,0) 기준 w×h 를 차지한다.
 * 위치는 호출자가 `.position.set(x,y)` 로 잡는다.
 */
export function nineSlicePanel(w: number, h: number, opts: PanelOptions = {}): Container {
  const border = opts.border ?? PANEL_BORDER;
  const fillColor = opts.fillColor ?? COLOR.panelFill;
  const fillAlpha = opts.fillAlpha ?? 0.96;
  const inset = opts.fillInset ?? PANEL_FILL_INSET;

  const root = new Container();

  // 내부 어두운 채움(프레임 아래 깔린다 — 나무 살 밑까지 번져야 둘 사이에 틈이 안 생긴다).
  const fill = new Graphics();
  fill
    .roundRect(
      inset,
      inset,
      Math.max(0, w - inset * 2),
      Math.max(0, h - inset * 2),
      PANEL_FILL_RADIUS,
    )
    .fill({ color: fillColor, alpha: fillAlpha });
  root.addChild(fill);

  // 나무 프레임.
  if (opts.texture) {
    const frame = new NineSliceSprite({
      texture: opts.texture,
      leftWidth: border,
      topHeight: border,
      rightWidth: border,
      bottomHeight: border,
    });
    frame.width = w;
    frame.height = h;
    root.addChild(frame);
  } else {
    const g = new Graphics();
    g.roundRect(0, 0, w, h, 14)
      .stroke({ color: 0x6b4a2a, width: 6, alignment: 1 })
      .roundRect(3, 3, w - 6, h - 6, 12)
      .stroke({ color: 0x3a2a1a, width: 2, alignment: 1 });
    root.addChild(g);
  }

  return root;
}
