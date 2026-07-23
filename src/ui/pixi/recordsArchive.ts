/**
 * 기록 보관소 — 서사 열람 시설 (스토리 시스템 Phase C2).
 *
 * 기지 맵에서 진입하는 전체 화면. 탭 3개: **파일럿 파일**(7기체 사연 — 행 클릭 시 사연 팝업),
 * **기록 파편**(에코 신호로 수집하는 도감 — 수집분만 열림), **프롤로그**(인트로 다시보기).
 * 사연 팝업은 챔피언 선택과 동일한 `makePilotFileModal` 을 재사용한다.
 *
 * ## 수집 상태의 출처
 * 기록 파편 **수집**은 에코 신호(Phase D)가 만들고 프로필(Phase E)이 영속화한다. Phase C2 는
 * 열람 UI 만 완성한다 — {@link collectedShardIds} 가 프로필에서 안전하게 읽되, 그 필드가 아직
 * 없으면 빈 집합이라 전부 잠긴 상태로 보인다(진행 표시 0/N). Phase E 가 필드를 채우면 그대로 열린다.
 *
 * 순수 render/UI 레이어(ADR-0005). wipe-then-rebuild 규약(탭/스크롤/팝업 상태만 인스턴스 보존).
 */

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import type { Profile } from '../../save/profile.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { loadUiTextures, shipPortraitName, type UiTextures } from './uiTextures.js';
import { nineSlicePanel, panelContent, PANEL_BORDER } from './nineSlicePanel.js';
import { makeBanner, makeIconButton } from './titleBar.js';
import { makeTabBar } from './tabs.js';
import { makeScrollArea } from './scrollArea.js';
import { listRowBg, attachRowClick } from './listRow.js';
import { PixiButton } from './button.js';
import { t } from '../../i18n/index.js';
import { SHIP_TYPES, type ShipTypeDef } from '../../../data/ships/index.js';
import { SHIP_STORIES, RECORD_SHARDS, shipStory } from '../../../data/lore/index.js';
import type { ShipStory } from '../../../data/lore/index.js';
import { shipTypeName } from './shipLabels.js';
import { storyTagline, recordShardTitle, recordShardBody } from './loreLabels.js';
import {
  storyProgressFromProfile,
  unlockedChapterCount,
} from './storyUnlock.js';
import { makePilotFileModal } from './storyModal.js';

const BANNER_W = 620;
const BANNER_H = 72;
const TAB_W = 900;
const CONTENT_W = 1400;
const CONTENT_H = 760;
const CONTENT_Y = 210;
const ROW_H = 108;

export interface RecordsArchiveCallbacks {
  onBack: () => void;
  onReplayIntro: () => void;
}

/** ShipStory → 그 기체 타입 정의(사연 팝업이 요구). slug 로 레지스트리를 찾는다. */
function defForStory(story: ShipStory): ShipTypeDef | undefined {
  return SHIP_TYPES.find((d) => d.slug === story.slug);
}

/**
 * 수집한 기록 파편 id 집합. Phase E 가 프로필에 `collectedShards: string[]` 을 넣기 전까지는
 * 빈 집합이다(전부 잠김). 필드가 생기면 그대로 읽힌다 — 안전 접근(배열이 아니면 빈 집합).
 */
function collectedShardIds(profile: Profile): ReadonlySet<string> {
  const raw = (profile as { collectedShards?: unknown }).collectedShards;
  return Array.isArray(raw) ? new Set(raw.filter((x): x is string => typeof x === 'string')) : new Set();
}

export class RecordsArchiveScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private ui: UiTextures = {};
  private profile: Profile | null = null;
  private cb: RecordsArchiveCallbacks | null = null;
  private tab = 0;
  private scrollY = 0;
  /** 열린 사연 팝업의 기체 slug(없으면 null) + 팝업 챕터 스크롤. */
  private storyOpen: string | null = null;
  private storyScrollY = 0;

  constructor(stage: Container) {
    this.stage = stage;
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
    void loadUiTextures().then((tex) => {
      this.ui = tex;
      if (this.root.visible) this.render();
    });
  }

  get visible(): boolean {
    return this.root.visible;
  }

  show(profile: Profile, cb: RecordsArchiveCallbacks): void {
    this.profile = profile;
    this.cb = cb;
    this.tab = 0;
    this.scrollY = 0;
    this.storyOpen = null;
    this.storyScrollY = 0;
    this.render();
    this.root.visible = true;
    this.raise();
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = 'hidden';
  }

  hide(): void {
    this.root.visible = false;
    this.cb = null;
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = '';
  }

  private raise(): void {
    this.stage.setChildIndex(this.root, this.stage.children.length - 1);
  }

  private setTab(i: number): void {
    if (i === this.tab) return;
    this.tab = i;
    this.scrollY = 0;
    this.render();
  }

  private render(): void {
    for (const child of [...this.root.children]) {
      this.root.removeChild(child);
      child.destroy({ children: true });
    }

    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static';
    this.root.addChild(bg);

    const banner = makeBanner(BANNER_W, BANNER_H, t('archive.title'), this.ui['ui_banner.png']);
    banner.position.set((DESIGN_WIDTH - BANNER_W) / 2, 12);
    this.root.addChild(banner);

    const close = makeIconButton(56, () => this.cb?.onBack(), this.ui['ui_icon_close.png']);
    close.position.set(DESIGN_WIDTH - 24 - 56, 14);
    this.root.addChild(close);

    const sub = new Text({
      resolution: 2,
      text: t('archive.subtitle'),
      style: { fontFamily: UI_FONT, fontSize: 17, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    sub.anchor.set(0.5, 0);
    sub.position.set(DESIGN_WIDTH / 2, 96);
    this.root.addChild(sub);

    const tabs = makeTabBar({
      width: TAB_W,
      labels: [t('archive.tab.stories'), t('archive.tab.shards'), t('archive.tab.intro')],
      activeIndex: this.tab,
      onSelect: (i) => this.setTab(i),
      activeTexture: this.ui['ui_btn_yellow.png'],
      idleTexture: this.ui['ui_btn_wood.png'],
    });
    tabs.position.set((DESIGN_WIDTH - TAB_W) / 2, 140);
    this.root.addChild(tabs);

    const panel = new Container();
    panel.position.set((DESIGN_WIDTH - CONTENT_W) / 2, CONTENT_Y);
    this.root.addChild(panel);
    panel.addChild(
      nineSlicePanel(CONTENT_W, CONTENT_H, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER }),
    );
    const box = panelContent(CONTENT_W, CONTENT_H);

    if (this.tab === 0) this.renderStories(panel, box);
    else if (this.tab === 1) this.renderShards(panel, box);
    else this.renderIntro(panel, box);

    if (this.storyOpen !== null) this.renderStoryModal();
  }

  /** 파일럿 파일 목록 — 초상 썸네일 + 이름 + 태그라인 + 해금 챕터 수. 행 클릭 시 사연 팝업. */
  private renderStories(panel: Container, box: ReturnType<typeof panelContent>): void {
    const profile = this.profile;
    if (profile === null) return;
    const rowW = box.w - 8;
    const totalH = SHIP_STORIES.length * ROW_H;
    const content = makeScrollArea(panel, {
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      totalH,
      get: () => this.scrollY,
      set: (v) => {
        this.scrollY = v;
      },
      thumb: true,
    });

    SHIP_STORIES.forEach((story, i) => {
      const row = new Container();
      row.position.set(0, i * ROW_H);
      content.addChild(row);
      row.addChild(listRowBg(rowW, ROW_H - 12));

      const tex = this.ui[shipPortraitName(defForStory(story)?.id ?? 0)];
      const thumb = 80;
      if (tex) {
        const sp = new Sprite(tex);
        sp.width = thumb;
        sp.height = thumb;
        sp.position.set(14, (ROW_H - 12 - thumb) / 2);
        row.addChild(sp);
      } else {
        const g = new Graphics();
        g.roundRect(14, (ROW_H - 12 - thumb) / 2, thumb, thumb, 8).fill({ color: 0x2a2233 });
        row.addChild(g);
      }

      const def = defForStory(story);
      const name = new Text({
        resolution: 2,
        text: def ? shipTypeName(def) : story.slug,
        style: { fontFamily: UI_FONT, fontSize: 22, fontWeight: '800', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
      });
      name.position.set(112, 18);
      row.addChild(name);

      const tag = new Text({
        resolution: 2,
        text: storyTagline(story),
        style: { fontFamily: UI_FONT, fontSize: 15, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
      });
      tag.position.set(112, 50);
      row.addChild(tag);

      const prog = storyProgressFromProfile(profile, story);
      const count = new Text({
        resolution: 2,
        text: `${unlockedChapterCount(story, prog)} / ${story.chapters.length}`,
        style: { fontFamily: UI_FONT, fontSize: 18, fontWeight: '700', fill: COLOR.cream, dropShadow: TEXT_SHADOW },
      });
      count.anchor.set(1, 0.5);
      count.position.set(rowW - 24, (ROW_H - 12) / 2);
      row.addChild(count);

      attachRowClick(row, () => {
        this.storyOpen = story.slug;
        this.storyScrollY = 0;
        this.render();
      });
    });
  }

  /** 기록 파편 도감 — 수집분만 제목·본문 공개, 미수집은 잠금 문구. 진행 n/N. */
  private renderShards(panel: Container, box: ReturnType<typeof panelContent>): void {
    const profile = this.profile;
    if (profile === null) return;
    const collected = collectedShardIds(profile);

    const progress = new Text({
      resolution: 2,
      text: t('archive.shards.progress', { n: collected.size, total: RECORD_SHARDS.length }),
      style: { fontFamily: UI_FONT, fontSize: 17, fontWeight: '700', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
    });
    progress.position.set(box.x, box.y);
    panel.addChild(progress);

    const listY = box.y + 40;
    const listH = box.bottom - listY;
    // 각 파편 블록 높이를 먼저 재려면 텍스트를 만들어야 하므로, content 에 직접 쌓고 마지막 y 로 totalH.
    const blocks: Container[] = [];
    let y = 0;
    for (const shard of RECORD_SHARDS) {
      const has = collected.has(shard.id);
      const block = new Container();
      block.position.set(0, y);
      const bg = listRowBg(box.w - 8, 10); // 임시 높이 — 아래서 실제 높이로 다시 그린다
      block.addChild(bg);

      const title = new Text({
        resolution: 2,
        text: has ? recordShardTitle(shard) : t('archive.story.locked'),
        style: {
          fontFamily: UI_FONT,
          fontSize: 19,
          fontWeight: '800',
          fill: has ? COLOR.gold : COLOR.muted,
          dropShadow: TEXT_SHADOW,
        },
      });
      title.position.set(16, 12);
      block.addChild(title);

      const body = new Text({
        resolution: 2,
        text: has ? recordShardBody(shard) : t('archive.shards.locked'),
        style: {
          fontFamily: UI_FONT,
          fontSize: 15,
          fill: has ? COLOR.cream : COLOR.muted,
          wordWrap: true,
          wordWrapWidth: box.w - 40,
          lineHeight: 21,
          dropShadow: TEXT_SHADOW,
        },
      });
      body.position.set(16, 42);
      block.addChild(body);

      const h = 42 + body.getLocalBounds().height + 18;
      bg.destroy();
      const realBg = listRowBg(box.w - 8, h - 10);
      block.addChildAt(realBg, 0);

      blocks.push(block);
      y += h + 12;
    }

    const content = makeScrollArea(panel, {
      x: box.x,
      y: listY,
      w: box.w,
      h: listH,
      totalH: y,
      get: () => this.scrollY,
      set: (v) => {
        this.scrollY = v;
      },
      thumb: true,
    });
    for (const b of blocks) content.addChild(b);
  }

  /** 프롤로그 탭 — 세계관 인트로 다시보기. */
  private renderIntro(panel: Container, box: ReturnType<typeof panelContent>): void {
    const desc = new Text({
      resolution: 2,
      text: t('intro.records.body'),
      style: {
        fontFamily: UI_FONT,
        fontSize: 18,
        fill: COLOR.cream,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: box.w - 160,
        lineHeight: 28,
        dropShadow: TEXT_SHADOW,
      },
    });
    desc.anchor.set(0.5, 0);
    desc.position.set(box.x + box.w / 2, box.y + 80);
    panel.addChild(desc);

    const replay = new PixiButton({
      texture: this.ui['ui_btn_yellow.png'],
      fallbackColor: 0xc9a227,
      width: 360,
      height: 68,
      fontSize: 20,
      labelColor: COLOR.darkLabel,
      label: t('archive.intro.replay'),
      onClick: () => this.cb?.onReplayIntro(),
    });
    replay.container.position.set(box.x + (box.w - 360) / 2, box.y + 220);
    panel.addChild(replay.container);
  }

  private renderStoryModal(): void {
    const profile = this.profile;
    const slug = this.storyOpen;
    if (profile === null || slug === null) return;
    const story = shipStory(slug);
    const def = story ? defForStory(story) : undefined;
    if (story === undefined || def === undefined) {
      this.storyOpen = null;
      return;
    }
    const modal = makePilotFileModal({
      ui: this.ui,
      def,
      story,
      progress: storyProgressFromProfile(profile, story),
      scrollY: this.storyScrollY,
      onScroll: (v) => {
        this.storyScrollY = v;
      },
      onClose: () => {
        this.storyOpen = null;
        this.render();
      },
    });
    this.root.addChild(modal);
  }
}
