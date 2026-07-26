/**
 * 파일럿 파일(사연) 팝업 — 초상 + 태그라인 + 3챕터 (스토리 시스템 Phase C).
 *
 * 챔피언 선택과 기록 보관소(Phase C2)가 **같은 팝업**을 쓰도록 재사용 가능한 빌더로 둔다.
 * `makeModal` 규약(암막·바깥클릭 닫기·`fillAlpha:1`)을 그대로 따르고, 긴 사연 본문은
 * `makeScrollArea`(thumb)로 스크롤한다 — 스크롤 상태는 재렌더 사이 유지돼야 하므로 호출자가
 * 갖고 get/set 으로 넘긴다(챔피언 선택 `render()` 가 매번 wipe-then-rebuild 이기 때문).
 *
 * 잠긴 챕터는 제목·본문을 감추고 **과제 힌트만** 보여 준다(스포일러 방지) — 해금 판정은
 * `storyUnlock.chapterUnlocked` 가, 진행 상태는 호출자가 만든 `StoryProgress` 가 소유한다.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다. 컬러 이모지 금지(text.ts stripEmoji).
 */

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import type { ShipTypeDef } from '../../../data/ships/index.js';
import type { ShipStory } from '../../../data/lore/index.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { makeModal, modalBodyTop } from './modal.js';
import { makeScrollArea } from './scrollArea.js';
import { shipPortraitName, type UiTextures } from './uiTextures.js';
import { shipTypeName, tShipKey } from './shipLabels.js';
import {
  chapterNo,
  storyTagline,
  storyChapterTitle,
  storyChapterBody,
  storyQuestHint,
} from './loreLabels.js';
import { chapterUnlocked, type StoryProgress } from './storyUnlock.js';

const MODAL_W = 900;
/**
 * 세로 640 → 700. 초상·태그라인·챕터를 제목 밴드({@link modalBodyTop}) 아래로 내리면서
 * 그만큼 잃는 챕터 스크롤 높이를 되메운 값이다(순증 +60 > 밴드 44 라 이전보다 넓다).
 */
const MODAL_H = 700;
const PORTRAIT = 208;
const GAP = 24;

// 기하 상수 재수출 — `tests/modalTitleBand.test.ts` 가 "본문이 제목 밴드 아래에서 시작한다"를
// 대조한다. 값을 테스트에 베껴 적으면 두 갈래 진실이 생겨 회귀 가드가 조용히 늙는다.
export { MODAL_W as PILOT_FILE_MODAL_W, MODAL_H as PILOT_FILE_MODAL_H, PORTRAIT as PILOT_FILE_PORTRAIT };

export interface PilotFileModalOptions {
  ui: UiTextures;
  def: ShipTypeDef;
  story: ShipStory;
  progress: StoryProgress;
  /** 재렌더 사이 유지되는 챕터 스크롤 위치(호출자 소유). */
  scrollY: number;
  onScroll: (v: number) => void;
  onClose: () => void;
}

/** 초상 Sprite(없으면 절차적 폴백 Graphics). 쇼케이스 폴백 규약과 동형. */
function portraitNode(ui: UiTextures, def: ShipTypeDef): Container {
  const tex = ui[shipPortraitName(def.id)];
  if (tex) {
    const sp = new Sprite(tex);
    sp.width = PORTRAIT;
    sp.height = PORTRAIT;
    return sp;
  }
  const g = new Graphics();
  g.roundRect(0, 0, PORTRAIT, PORTRAIT, 12)
    .fill({ color: 0x2a2233 })
    .stroke({ color: COLOR.gold, width: 2 });
  g.circle(PORTRAIT / 2, PORTRAIT / 2 - 12, 44).fill({ color: 0x4a3f57 });
  return g;
}

/** 파일럿 파일 팝업 root(암막 포함). 호출자가 자기 화면 root 에 addChild 한다. */
export function makePilotFileModal(opts: PilotFileModalOptions): Container {
  const { ui, def, story, progress } = opts;
  const parts = makeModal({
    width: MODAL_W,
    height: MODAL_H,
    title: tShipKey('champion.story.title', '{name} — Pilot File', { name: shipTypeName(def) }),
    onClose: opts.onClose,
    panelTexture: ui['ui_panel.png'],
    closeTexture: ui['ui_icon_close.png'],
  });
  const box = parts.box;

  // 초상(좌상) + 태그라인(우측). 초상은 폴백이 있어 아트가 없어도 자리를 지킨다.
  //
  // ⚠️ y 기준은 `box.y` 가 아니라 **`modalBodyTop(box)`** 다. 제목도 `box.y` 에 놓이므로
  // 그대로 쓰면 태그라인이 제목을 덮어 둘 다 못 읽는다(실측 결함 — 사용자 신고).
  const bodyTop = modalBodyTop(box);
  const portrait = portraitNode(ui, def);
  portrait.position.set(box.x, bodyTop);
  parts.panel.addChild(portrait);

  const tagline = new Text({
    resolution: 2,
    text: storyTagline(story),
    style: {
      fontFamily: UI_FONT,
      fontSize: 20,
      fontStyle: 'italic',
      fill: COLOR.gold,
      wordWrap: true,
      wordWrapWidth: box.w - PORTRAIT - GAP,
      lineHeight: 27,
      dropShadow: TEXT_SHADOW,
    },
  });
  tagline.position.set(box.x + PORTRAIT + GAP, bodyTop + 8);
  parts.panel.addChild(tagline);

  // 챕터 스크롤 영역 — 초상 아래 남는 세로 전부.
  const listY = bodyTop + PORTRAIT + GAP;
  const listH = box.bottom - listY;
  const contentW = box.w - 18; // thumb 자리 확보

  // 먼저 챕터 본문을 content 좌표계에 쌓아 총 높이를 재고, 그 높이로 스크롤 영역을 만든다.
  const blocks: Text[] = [];
  let y = 0;
  for (const ch of story.chapters) {
    const unlocked = chapterUnlocked(ch, progress);
    const n = chapterNo(ch.index);

    const headText = unlocked
      ? `${tShipKey('archive.story.chapter', 'Chapter {n}', { n })} · ${storyChapterTitle(story, ch)}`
      : `${tShipKey('archive.story.chapter', 'Chapter {n}', { n })} · ${tShipKey('archive.story.locked', 'Locked')}`;
    const head = new Text({
      resolution: 2,
      text: headText,
      style: {
        fontFamily: UI_FONT,
        fontSize: 19,
        fontWeight: '800',
        fill: unlocked ? COLOR.gold : COLOR.muted,
        wordWrap: true,
        wordWrapWidth: contentW,
        lineHeight: 24,
        dropShadow: TEXT_SHADOW,
      },
    });
    head.position.set(0, y);
    blocks.push(head);
    y += head.getLocalBounds().height + 8;

    const bodyText = unlocked ? storyChapterBody(story, ch) : storyQuestHint(story, ch);
    const body = new Text({
      resolution: 2,
      text: bodyText,
      style: {
        fontFamily: UI_FONT,
        fontSize: 15,
        fill: unlocked ? COLOR.cream : COLOR.muted,
        wordWrap: true,
        wordWrapWidth: contentW,
        lineHeight: 22,
        dropShadow: TEXT_SHADOW,
      },
    });
    body.position.set(0, y);
    blocks.push(body);
    y += body.getLocalBounds().height + 26;
  }

  const content = makeScrollArea(parts.panel, {
    x: box.x,
    y: listY,
    w: box.w,
    h: listH,
    totalH: y,
    get: () => opts.scrollY,
    set: opts.onScroll,
    thumb: true,
  });
  for (const b of blocks) content.addChild(b);

  return parts.root;
}
