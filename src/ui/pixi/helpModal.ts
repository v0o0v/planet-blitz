/**
 * 화면 도움말 팝업 — 공용 모듈 (사용자 요청 2026-08-05).
 *
 * 방어 사령부에서 처음 만들고, "다른 화면에도 같은 것을" 요청을 받아 여기로 뽑았다. 화면마다
 * 복제했다면 여섯 벌이 그날부터 따로 놀았을 것이다 — 이 리포는 `recessedWell` 을 화면마다
 * 베껴 두고 그 사본들이 실제로 어긋난 이력이 있다(그건 **장식**이라 어긋나도 화면이 서지만,
 * 도움말은 **글 폭·스크롤·문단 규칙**이라 어긋나면 글이 잘리거나 막대에 붙는다).
 *
 * ## 화면이 제공하는 것 · 이 모듈이 정하는 것
 * 화면은 **무엇을 말할지**(절 목록 + 번역 함수)만 준다. 팝업 크기, 파낸 챔버, 스크롤, 문단
 * 나눔, 손잡이 자리, 닫기 버튼은 전부 여기가 정한다. 그래서 새 화면에 도움말을 붙이는 일이
 * "카탈로그에 절을 쓰고 `renderHelpSections` 를 부른다"로 끝난다.
 *
 * ## 실측으로 정해진 규칙 둘 (지우지 마라)
 * ① **문단 구분은 홑 개행이다.** Pixi 라벨은 전부 {@link stripEmoji} 를 거치는데 그 함수가
 *    `\s{2,}` 를 공백 하나로 접는다 — 문자열 안 빈 줄(`\n\n`)은 화면에 도달하지 못하고 조용히
 *    사라진다(m7b 통합 테스트가 def3 문자열 전체에 이 불변식을 걸어 두고 실제로 잡아냈다).
 *    그래서 문단 사이 여백은 문자열이 아니라 **노드 간격**({@link HELP_PARA_GAP})이 만든다.
 * ② **글은 창보다 손잡이 자리만큼 일찍 접는다.** `makeScrollArea` 는 손잡이를 창 **안쪽**
 *    오른쪽 끝에 얹으므로(`thumbOutside` 기본 false), 줄바꿈 폭을 창 폭과 같게 주면 긴 줄이
 *    막대 아래로 파고든다. 겹침 예외도 경고도 없고 **긴 줄에서만** 나타나서 짧은 줄만 보면
 *    멀쩡해 보인다(사용자 신고 2026-08-05 "스크롤바가 너무 붙어있어").
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { CinematicPanel } from './cinematicPanel.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { PixiButton } from './button.js';
import { stripEmoji } from './text.js';
import {
  makeScrollArea,
  SCROLL_THUMB_W,
  SCROLL_THUMB_PAD,
} from './scrollArea.js';
import { cinematicButtonTexture, chromeFallbackColor, chromeLabelColor } from './hangarChrome.js';
import { t, type MessageKey } from '../../i18n/index.js';

/** 제목 띠가 있는 시네마틱 패널의 콘텐츠 상자 기하(화면 파일들이 들고 있는 복제 상수와 같은 값). */
const PANEL_EDGE_PAD = 24;
const PANEL_TITLE_BAND_H = 52;
const PANEL_CONTENT_GAP = 16;
const TITLED_BOX_Y = PANEL_TITLE_BAND_H + PANEL_CONTENT_GAP;

/**
 * 팝업 세로 뭉치(스크롤 창 → 닫기 버튼).
 *
 * 형제 팝업들과 달리 높이를 **내용에서 역산하지 않는다** — 본문이 로케일마다 줄 수가 달라
 * 역산하면 팝업 크기가 언어를 따라 출렁이고, 어느 로케일이든 화면 세로를 넘으므로 어차피
 * 스크롤이 전제다. 창 높이를 못 박고 그 안에서 스크롤한다.
 */
const HELP_BODY_H = 700;
const HELP_BTN_H = 56;
const HELP_BTN_W = 240;
const HELP_BTN_GAP = 16;
const HELP_BLOCK_H = HELP_BODY_H + HELP_BTN_GAP + HELP_BTN_H;

/** 도움말 팝업 기하. 화면 파일들이 팝업을 세울 때 이 값을 쓴다. */
export const HELP_MODAL = {
  w: 1180,
  h: TITLED_BOX_Y + HELP_BLOCK_H + PANEL_EDGE_PAD,
  blockH: HELP_BLOCK_H,
  bodyH: HELP_BODY_H,
  btnH: HELP_BTN_H,
  btnW: HELP_BTN_W,
  boxY: TITLED_BOX_Y,
  edgePad: PANEL_EDGE_PAD,
} as const;

/**
 * 간격 셋 — 제목→본문 · 문단 사이 · 절 사이. 셋이 **서로 달라야** 글 뭉치가 계층으로 읽힌다
 * (전부 같으면 절 경계가 문단 경계와 구분되지 않는다).
 */
const HELP_HEAD_GAP = 8;
const HELP_PARA_GAP = 12;
const HELP_SECTION_GAP = 28;

/** 스크롤 창의 안쪽 좌우 여백(파낸 챔버 테두리와 글 사이). */
const HELP_PAD = 20;
/**
 * 글 오른쪽에 비워 두는 **손잡이 자리**. 모듈 주석 ② 가 근거다. 값을 손잡이 상수에서 유도해
 * 두어야 그 상수가 바뀔 때 이 여백이 조용히 부족해지지 않는다.
 */
const HELP_TEXT_GUTTER = SCROLL_THUMB_W + SCROLL_THUMB_PAD * 2 + 16;

/**
 * 본문이 접히는 폭. 순수 함수로 뽑아 둔 이유는 **손잡이가 글을 침범하지 않는다**는 것을 Pixi
 * 없이 단언하기 위해서다(vitest 는 node 라 캔버스 텍스트를 세울 수 없어, 이 유형은 순수 함수로
 * 뽑지 않으면 눈으로만 잡힌다).
 */
export function helpTextWidth(boxW: number): number {
  return boxW - HELP_PAD * 2 - HELP_TEXT_GUTTER;
}

/** 스크롤 창 폭(파낸 챔버에서 좌우 여백을 뺀 값). */
export function helpWindowWidth(boxW: number): number {
  return boxW - HELP_PAD * 2;
}

/**
 * 한 화면의 도움말 절 목록.
 *
 * `prefix` 아래에 `.<id>.h`(제목)·`.<id>.b`(본문) 짝이 카탈로그에 있어야 한다. 배열로 두는
 * 이유는 둘이다: ① 화면이 순서를 한 곳에서만 읽어 절을 넣고 빼는 일이 렌더 코드를 안 건드린다
 * ② **i18n 테스트가 두 로케일에 짝이 다 있는지 이 목록으로 훑는다**(문자열을 화면에 하드코딩
 * 하면 EN/KO 한쪽이 빠져도 조용히 키 이름이 그려진다).
 */
export interface HelpSpec {
  /** 카탈로그 키 접두사 — 예: `def3.cmd.help` · `lab.help`. */
  readonly prefix: string;
  /** 절 id 목록 — 예: `['s1', 's2', …]`. 그리는 순서다. */
  readonly sections: readonly string[];
}

/** 절 제목 키. 카탈로그·테스트·렌더가 **같은 함수**로 키를 만든다(직접 문자열 조립 금지). */
export function helpHeadKey(spec: HelpSpec, id: string): string {
  return `${spec.prefix}.${id}.h`;
}

/** 절 본문 키. */
export function helpBodyKey(spec: HelpSpec, id: string): string {
  return `${spec.prefix}.${id}.b`;
}

/** 팝업 제목 키(`<prefix>.title`). */
export function helpTitleKey(spec: HelpSpec): string {
  return `${spec.prefix}.title`;
}

function label(text: string, size: number, color: number, weight: '400' | '800', maxW: number): Text {
  const el = new Text({
    resolution: 2,
    text: stripEmoji(text),
    style: { fontFamily: UI_FONT, fontSize: size, fontWeight: weight, fill: color, dropShadow: TEXT_SHADOW },
  });
  if (el.width > maxW) el.scale.x = maxW / el.width;
  return el;
}

function wrapped(text: string, size: number, color: number, w: number): Text {
  return new Text({
    resolution: 2,
    text: stripEmoji(text),
    style: {
      fontFamily: UI_FONT,
      fontSize: size,
      fontWeight: '400',
      fill: color,
      wordWrap: true,
      wordWrapWidth: w,
      dropShadow: TEXT_SHADOW,
    },
  });
}

/**
 * 파낸 보관 챔버 — 이 리포에서 "글만 있는 자리"의 공통 어휘다. 화면 파일마다 사본이 있지만
 * (그 파일들은 공용 모듈이 아니라 화면이다) 도움말은 여기 하나만 쓴다.
 */
function recessedWell(x: number, y: number, w: number, h: number): Graphics {
  const g = new Graphics();
  g.roundRect(x, y, w, h, 12)
    .fill({ color: 0x14100a, alpha: 0.82 })
    .stroke({ color: 0x0a0705, width: 2, alignment: 1, alpha: 0.9 });
  g.moveTo(x + 14, y + h - 1.5)
    .lineTo(x + w - 14, y + h - 1.5)
    .stroke({ color: 0xc9a04a, width: 1, alpha: 0.3 });
  return g;
}

/** 슬래브 위 보조 텍스트색(화면들이 공유하는 `SLAB_BODY_FILL` 과 같은 값). */
const SLAB_BODY_FILL = 0xe4dac7;

export interface HelpRenderOptions {
  /** 절 목록. */
  readonly spec: HelpSpec;
  /** 스크롤 위치를 읽는다(재렌더 사이 유지되는 화면 상태). */
  get(): number;
  /** 클램프된 스크롤 위치를 되돌려 받는다. */
  set(v: number): void;
  /** 닫기 버튼. */
  onClose(): void;
}

/**
 * 도움말 팝업 내용을 `panel` 안에 그린다. 팝업(암막 + 패널)을 세우는 것은 화면 소관이다 —
 * 화면마다 팝업 기구가 이미 있고 암막 알파가 뒤 화면 밝기에 따라 다르기 때문이다.
 */
export function renderHelpSections(panel: CinematicPanel, opts: HelpRenderOptions): void {
  const box = panel.box;
  const { spec } = opts;

  // ① 먼저 전부 조판해 높이를 잰다 — 스크롤 총량은 측정값이어야 한다(상수로 두면 로케일이
  //    길어지는 순간 마지막 절이 예외 없이 잘린다).
  const textW = helpTextWidth(box.w);
  const nodes: { node: Text; y: number }[] = [];
  let cy = 0;
  for (const id of spec.sections) {
    const head = label(t(helpHeadKey(spec, id) as MessageKey), 23, COLOR.gold, '800', textW);
    nodes.push({ node: head, y: cy });
    cy += head.height + HELP_HEAD_GAP;
    // 문단은 **노드로** 나눈다(모듈 주석 ①).
    const paras = t(helpBodyKey(spec, id) as MessageKey).split('\n');
    for (const [i, para] of paras.entries()) {
      const body = wrapped(para, 18, SLAB_BODY_FILL, textW);
      nodes.push({ node: body, y: cy });
      cy += body.height + (i === paras.length - 1 ? HELP_SECTION_GAP : HELP_PARA_GAP);
    }
  }
  const total = Math.max(0, cy - HELP_SECTION_GAP);

  // ② 파낸 챔버 위에 얹는다.
  panel.container.addChild(recessedWell(box.x, box.y, box.w, HELP_MODAL.bodyH));
  const content: Container = makeScrollArea(panel.container, {
    x: box.x + HELP_PAD,
    y: box.y + 16,
    w: helpWindowWidth(box.w),
    h: HELP_MODAL.bodyH - 32,
    totalH: total,
    thumb: true,
    get: opts.get,
    set: opts.set,
  });
  for (const n of nodes) {
    n.node.position.set(0, n.y);
    content.addChild(n.node);
  }

  // ③ 닫기. 암막 탭으로도 닫히지만(공용 규약) 처음 오는 사람에게는 나가는 길이 **보여야** 한다
  //    — 이 팝업을 여는 사람은 정의상 그 화면을 처음 보는 사람이다.
  const btn = new PixiButton({
    texture: cinematicButtonTexture('stone'),
    cap: 32,
    fallbackColor: chromeFallbackColor('stone'),
    labelColor: chromeLabelColor('stone'),
    width: HELP_MODAL.btnW,
    height: HELP_MODAL.btnH,
    fontSize: 21,
    label: stripEmoji(t('common.close')),
    onClick: opts.onClose,
  });
  btn.container.position.set(
    box.x + Math.round((box.w - HELP_MODAL.btnW) / 2),
    box.bottom - HELP_MODAL.btnH,
  );
  panel.container.addChild(btn.container);
}
