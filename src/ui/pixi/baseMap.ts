/**
 * 기지 맵 허브 화면 — 시네마틱 전환(`.omc/plans/base-screen-aaa-2026-08-02.md`).
 *
 * ## 왜 나무 패널을 걷어냈나
 * 타이틀·인트로를 풀블리드 시네마틱 키아트로 올린 뒤(PR#236·#238·#240) **기지 화면이
 * 상대적으로 아마추어로 보인다**는 사용자 판정이 나왔다. 이전 판은 평면 `COLOR.bg` 바탕에
 * 나무 nine-slice 카드 7장 + 144px 픽셀 아이콘 + 텍스트 두 줄이었다 — 깊이도 조명도 없고,
 * 픽셀 아이콘과 페인터리 키아트의 붓이 정면으로 충돌했다.
 *
 * 그래서 이 화면만 **시네마틱 언어로 전환**한다(사용자 확정, 다른 화면은 이 결과를 보고
 * 순차 롤아웃). 나무 프레임은 기지 화면에서 은퇴하고, 타이틀과 같은 붓으로 통일한다.
 *
 * ## 레이어 구조 (뒤 → 앞)
 * ```
 *   backdrop  BaseBackdrop      풀블리드 격납고 홀 + 패럴랙스 · 티끌 · 광선 · 중앙 베일
 *   tiles     CinematicTile ×7  건물 일러스트 밴드 + 금박 헤어라인 + 접지 그림자 + 호버
 *   chrome    제목 · 재화 칩 · 출격 CTA · 메타 줄
 * ```
 *
 * ## 세 모듈로 쪼갠 이유
 * 배경(`baseBackdrop`)·타일(`cinematicTile`)·크롬(`cinematicChrome`)은 **병렬 레인이 각자
 * 소유**했다. 이 파일은 조립만 한다 — 세 모듈은 서로를 import 하지 않고, 여기서만 만난다.
 * 덕분에 다른 화면으로 롤아웃할 때 타일·크롬을 그대로 재사용할 수 있다(그게 다음 단계다).
 *
 * ## 연출은 `update(dt)` 로만 산다
 * 배경 패럴랙스·타일 호버·CTA 맥동은 전부 벽시계 기반이고 **렌더 루프가 불러 줘야** 돈다
 * (`main.ts` 의 `baseMap.update(frame)`). 화면이 숨겨져 있으면 즉시 반환하므로 런 중 비용은
 * 0 이다. 배경 티어는 생성 시점 1회 판정이라(설정 오버라이드 직접 읽기) 품질 설정을 바꾸면
 * 다음 `show()` 에서 다시 만들어진다 — `render()` 가 배경을 새로 세우기 때문이다.
 *
 * 공개 인터페이스(show/hide/visible)와 콜백 타입은 DOM 판과 동일해 `main.ts` 호출부는 그대로다.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다. Profile 은 읽기만 한다.
 */

import { Container, Graphics, Text } from 'pixi.js';
import { computeUnlocks, activeShip, RESEARCH_UNLOCK_LEVEL, type Profile } from '../../save/profile.js';
import { t, type MessageKey } from '../../i18n/index.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import {
  loadBaseTextures,
  baseBuildingAssetName,
  BASE_BACKDROP_NAME,
  BASE_LAUNCH_NAME,
  type BaseTextures,
} from './baseTextures.js';
import { BaseBackdrop } from './baseBackdrop.js';
import { makeCinematicTile, type CinematicTile } from './cinematicTile.js';
import { makeScreenTitle, makeCinematicChip, makeHeroTile, type HeroButton } from './cinematicChrome.js';
import type { BaseMapCallbacks } from '../baseMap.js';

/** 건물 타일 정의. 일러스트는 `baseTextures` 의 이름 규약으로 파생한다(basename 하드코딩 없음). */
interface Building {
  key: 'hangar' | 'research' | 'refinery' | 'defense' | 'control' | 'archive' | 'commission';
  nameKey: MessageKey;
  descKey: MessageKey;
  /** 잠금/폴백 시 쓰는 강조색. */
  accent: number;
}

const BUILDINGS: readonly Building[] = [
  { key: 'hangar', nameKey: 'base.bld.hangar.name', descKey: 'base.bld.hangar.desc', accent: 0x4cd7ff },
  { key: 'research', nameKey: 'base.bld.research.name', descKey: 'base.bld.research.desc', accent: 0xff7a4c },
  { key: 'refinery', nameKey: 'base.bld.refinery.name', descKey: 'base.bld.refinery.desc', accent: 0xffd24c },
  { key: 'defense', nameKey: 'base.bld.defense.name', descKey: 'base.bld.defense.desc', accent: 0x8fd94c },
  { key: 'control', nameKey: 'base.bld.control.name', descKey: 'base.bld.control.desc', accent: 0xc86aff },
  // 기록 보관소(스토리 시스템 Phase C2) — 상시 개방 서사 열람 시설.
  { key: 'archive', nameKey: 'base.bld.archive.name', descKey: 'base.bld.archive.desc', accent: 0xffb24c },
  // 지시 수신소(의뢰서 시스템 Phase E) — 상시 개방(성계 지도와 별개의 PvE 출격구).
  { key: 'commission', nameKey: 'base.bld.commission.name', descKey: 'base.bld.commission.desc', accent: 0x7affea },
];

// --- 레이아웃 상수(디자인 스페이스 1920×1080) ---
/**
 * 제목 블록. `makeScreenTitle` 은 앵커 (0.5, 0) 이고 블록 높이가 약 112px 이다(제목 + 부제 +
 * 화면을 가로지르는 장식선). 재화 칩을 장식선과 같은 y 에 두면 겹치므로 **제목 줄과 같은
 * 높이**의 좌우 바깥에 둔다(Lane C 인계 제약 ①).
 */
const TITLE_Y = 26;
const CHIP_W = 200;
const CHIP_H = 54;
const CHIP_Y = 52;
/** 좌우 여백. 좌상단 설정 톱니(크롬 UI, 매 프레임 최상단)를 피할 만큼은 떨어져야 한다. */
const CHIP_MARGIN = 150;

/**
 * 타일 격자. 이전 판(430×340)보다 **키가 크다** — 일러스트 밴드가 카드 상단 60% 를 먹으므로
 * 세로가 짧으면 정사각 원본이 과하게 잘린다(Lane B 인계 제약 ③: 가로로 길수록 건물 위아래가
 * 더 잘린다). 접지 그림자가 카드 아래로 `h*0.13` 번지므로 행 간격도 그만큼 벌렸다(제약 ②).
 *
 * ⚠️ **넘침 함정(과거 실측)**: 7건물을 "1행 최대 3칸 고정"으로 분배하면 2행에 4칸이 몰려
 * `DESIGN_WIDTH` 를 넘는다. `rowSplit` 의 균등 반반이 그 재발을 막는다.
 */
export const TILE_W = 424;
/**
 * ⚠️ **세로 예산이 이 화면의 진짜 제약이다.** 1080 안에 제목 블록(112) · 타일 2행 ·
 * 출격 CTA · 메타 줄이 전부 들어가야 한다. 첫 조립에서 `TILE_H=386` 으로 잡았더니 2행이
 * y=1010 까지 내려와 **CTA 가 기록 보관소 카드 위에 겹쳤다**(실화면에서 잡았다).
 *
 * 폭은 못 줄인다 — 1행이 4칸이라 `4×424+3×34 = 1798` 이 이미 여유의 끝이다. 그래서 높이로
 * 맞춘다. 밴드가 상단 60% 라 `424×198` 짜리 슬라이스가 되는데, 이건 Lane B 가 기준으로 삼은
 * 430×340(밴드 204) 과 사실상 같은 잘림이라 건물이 여전히 읽힌다.
 */
const TILE_H = 352;
const TILE_GAP = 34;
/**
 * 1행 상단. 제목이 84px 새김으로 커지면서 헤더 블록(제목 → 부제 → 각인 장식선 → 눈금)이
 * y 26..176 을 쓴다. 거기서 **50px** 을 띄운다 — 1차 판(158)은 장식선과 격자 사이가 27px
 * 뿐이라 "헤더가 그리드에 눌려 있다"는 판정을 받았다(AAA 비평 §8).
 */
const ROW1_Y = 226;
/**
 * 행 간격. 가로 거터(34)와 맞추는 것이 리듬상 맞지만(비평 §8), 접지 그림자가 카드 아래로
 * `h*0.13`(≈41px) 번지므로 34 로 두면 아래 행 위에 그림자가 얹힌다. 그 둘의 타협점이다.
 */
const ROW_GAP = 44;
const ROW2_Y = ROW1_Y + TILE_H + ROW_GAP;
/**
 * 하단 메타. 2행 바닥(978)에 카드 그림자가 48px 번지므로 그보다 아래여야 한다 —
 * 그림자 위에 글자를 놓으면 글자가 얼룩 위에 앉는다.
 */
const META_Y = 1036;

/**
 * 격자에 놓이는 칸 수 = 건물 7 + **출격 카드 1**.
 *
 * ## 왜 CTA 가 격자 안으로 들어왔나
 * 4+3 배치는 2행 좌우에 **227px 짜리 죽은 기둥 두 개**를 남겼다. 배경을 그 자리에서 밝혀
 * 채우려 했더니 오히려 **빈 배경이 카드보다 밝아지는 도-지 반전**이 났다(AAA 비평 2라운드
 * N2·N3 — "가장 밝은 화소가 아무것도 없는 좌하단 배경"). 조명 문제가 아니라 레이아웃
 * 문제였다.
 *
 * 4+4 로 채우고 8번째 칸을 출격 카드로 만들면 결함 셋이 한꺼번에 사라진다:
 *  ① 죽은 기둥 소멸 ② CTA 가 격자 안에서 가장 밝은 것이 됨 ③ 하단 CTA 막대가 없어져 남는
 *  세로 여유로 카드 높이를 314 → 372 로 키울 수 있고, 그 덕에 건물 잘림도 함께 풀린다.
 */
const CELLS = BUILDINGS.length + 1;

/**
 * 2행 분배(각 행 칸 수). **균등 반반**이 계약이다 — 남는 칸을 전부 둘째 행에 몰면(옛
 * "1행 최대 3칸 고정") 칸 수가 홀수로 늘 때 둘째 행이 더 커져 넘침이 재발한다.
 */
export function rowSplit(n: number): readonly [number, number] {
  const row0 = Math.ceil(n / 2);
  return [row0, n - row0];
}

/** i 번째 칸의 좌상단(2행 배치, 각 행 가운데 정렬). 마지막 칸이 출격 카드다. */
export function tilePosition(i: number): { x: number; y: number } {
  const [cols0, cols1] = rowSplit(CELLS);
  const row = i < cols0 ? 0 : 1;
  const cols = row === 0 ? cols0 : cols1;
  const col = row === 0 ? i : i - cols0;
  const rowW = cols * TILE_W + (cols - 1) * TILE_GAP;
  const x0 = (DESIGN_WIDTH - rowW) / 2;
  return { x: x0 + col * (TILE_W + TILE_GAP), y: row === 0 ? ROW1_Y : ROW2_Y };
}

/**
 * 배경 베일이 눌러야 할 사각형 — **격자에서 파생한다.**
 *
 * 배경은 이 사각형 **안쪽만** 어둡게 눌러 타일 대비를 만들고, 바깥(특히 2행 좌우의 넓은
 * 알코브)은 거의 누르지 않아 장소가 비친다. 좌표를 배경 모듈에 하드코딩해 두면 여기 격자를
 * 바꿀 때 조용히 어긋나므로(실제로 Lane A 가 그렇게 인계했다) 격자 상수에서 계산해 넘긴다.
 */
export function veilRects(): readonly { x0: number; y0: number; x1: number; y1: number }[] {
  const [cols0, cols1] = rowSplit(CELLS);
  const span = (cols: number): { x0: number; x1: number } => {
    const w = cols * TILE_W + (cols - 1) * TILE_GAP;
    const x0 = (DESIGN_WIDTH - w) / 2;
    return { x0, x1: x0 + w };
  };
  const a = span(cols0);
  const b = span(cols1);
  return [
    { x0: a.x0, y0: ROW1_Y, x1: a.x1, y1: ROW1_Y + TILE_H },
    { x0: b.x0, y0: ROW2_Y, x1: b.x1, y1: ROW2_Y + TILE_H },
  ];
}

export class BaseMapScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private ui: UiTextures = {};
  private art: BaseTextures = {};
  private profile: Profile | null = null;
  private cb: BaseMapCallbacks | null = null;

  /** 연출을 가진 것들 — `update(dt)` 가 매 프레임 이 셋만 돌린다. */
  private backdrop: BaseBackdrop | null = null;
  private tiles: CinematicTile[] = [];
  private hero: HeroButton | null = null;

  constructor(stage: Container) {
    this.stage = stage;
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
    // 자산 비동기 로드 — 완료 후 열려 있으면 실 아트로 다시 그린다(그 전엔 절차적 폴백).
    void loadUiTextures().then((tex) => {
      this.ui = tex;
      if (this.root.visible) this.render();
    });
    void loadBaseTextures().then((tex) => {
      this.art = tex;
      if (this.root.visible) this.render();
    });
  }

  get visible(): boolean {
    return this.root.visible;
  }

  show(profile: Profile, cb: BaseMapCallbacks): void {
    this.profile = profile;
    this.cb = cb;
    this.render();
    this.root.visible = true;
    // DOM HUD(HP/LV, 좌하단)는 런 전용 — 캔버스 메타 화면 위에 떠 보이므로 숨긴다.
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = 'hidden';
  }

  hide(): void {
    this.root.visible = false;
    this.cb = null;
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = '';
  }

  /**
   * 매 프레임 연출 진행(`main.ts` 렌더 루프). `dt` 는 **벽시계 초**다. 화면이 숨겨져 있으면
   * 아무것도 하지 않는다 — 기지 밖에서는 비용이 0 이다.
   */
  update(dt: number): void {
    if (!this.root.visible) return;
    this.backdrop?.update(dt);
    for (const tile of this.tiles) tile.update(dt);
    this.hero?.update(dt);
  }

  /** 건물 잠금 사유(해금이면 null). DOM 판 `lockReason` 과 동일 규칙. */
  private lockReason(key: Building['key'], profile: Profile): string | null {
    const u = computeUnlocks(profile);
    switch (key) {
      case 'hangar':
        return u.hangar ? null : t('base.lock.pre');
      case 'research':
        return u.research ? null : t('base.lock.level', { lvl: RESEARCH_UNLOCK_LEVEL });
      case 'refinery':
        return u.refinery ? null : t('base.lock.clear');
      case 'defense':
        return u.defenseCommand ? null : t('base.lock.clear');
      case 'control':
        // 관제탑(침공·래더) — 방어 사령부와 동일 해금 조건(행성 1회 클리어).
        return u.defenseCommand ? null : t('base.lock.clear');
      case 'archive':
        // 기록 보관소 — 서사 열람 시설이라 상시 개방(잠금 없음).
        return null;
      case 'commission':
        // 지시 수신소 — 의뢰서는 보스 처치로만 발령되므로 시설 자체는 상시 개방(잠금 없음).
        return null;
      default:
        return null;
    }
  }

  private enter(key: Building['key']): void {
    const cb = this.cb;
    if (cb === null) return;
    switch (key) {
      case 'hangar':
        cb.onHangar();
        break;
      case 'research':
        cb.onResearch();
        break;
      case 'refinery':
        cb.onRefinery();
        break;
      case 'defense':
        cb.onDefense();
        break;
      case 'control':
        cb.onControl();
        break;
      case 'archive':
        cb.onArchive();
        break;
      case 'commission':
        cb.onCommission();
        break;
    }
  }

  // --- 렌더 ----------------------------------------------------------------

  private render(): void {
    // 연출 참조를 먼저 끊는다 — destroy 된 컨테이너를 update 가 만지면 안 된다.
    this.backdrop?.destroy();
    this.backdrop = null;
    this.tiles = [];
    this.hero = null;
    for (const child of [...this.root.children]) {
      this.root.removeChild(child);
      child.destroy({ children: true });
    }
    const profile = this.profile;
    if (profile === null) return;

    // 바닥 — 배경 자산이 없거나 실패해도 화면이 비지 않게. 이벤트도 여기서 막는다.
    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static';
    this.root.addChild(bg);

    // --- 배경(격납고 홀 + 공기 + 중앙 베일) ---
    const backdrop = new BaseBackdrop(this.art[BASE_BACKDROP_NAME], { veilRects: veilRects() });
    this.root.addChild(backdrop.view);
    this.backdrop = backdrop;

    this.renderTitleBar(profile);
    BUILDINGS.forEach((b, i) => this.renderBuilding(b, i, profile));
    this.renderLaunch();
    this.renderMeta(profile);
  }

  private renderTitleBar(profile: Profile): void {
    const title = makeScreenTitle(t('base.title'), t('base.sub'));
    title.position.set(DESIGN_WIDTH / 2, TITLE_Y);
    this.root.addChild(title);

    const credits = makeCinematicChip(
      CHIP_W,
      CHIP_H,
      String(profile.credits),
      this.ui['ui_icon_coin.png'] ?? undefined,
      'gold',
    );
    credits.position.set(CHIP_MARGIN, CHIP_Y);
    this.root.addChild(credits);

    const minerals = makeCinematicChip(
      CHIP_W,
      CHIP_H,
      String(profile.minerals),
      this.ui['ui_icon_crystal.png'] ?? undefined,
      'teal',
    );
    minerals.position.set(DESIGN_WIDTH - CHIP_MARGIN - CHIP_W, CHIP_Y);
    this.root.addChild(minerals);
  }

  private renderBuilding(b: Building, i: number, profile: Profile): void {
    const { x: px, y: py } = tilePosition(i);
    const reason = this.lockReason(b.key, profile);
    const locked = reason !== null;

    const tile = makeCinematicTile({
      width: TILE_W,
      height: TILE_H,
      art: this.art[baseBuildingAssetName(b.key)],
      accent: b.accent,
      title: t(b.nameKey),
      desc: t(b.descKey),
      locked,
      lockReason: reason,
      // 잠금 타일은 클릭 자체를 달지 않아 호버 연출도 함께 꺼진다(DOM 판과 동일).
      ...(locked ? {} : { onClick: () => this.enter(b.key) }),
    });
    tile.container.position.set(px, py);
    this.root.addChild(tile.container);
    this.tiles.push(tile);
  }

  /** 출격 카드 — 격자의 마지막 칸(8번째). 건물 타일과 같은 골격, 다른 무게. */
  private renderLaunch(): void {
    const { x, y } = tilePosition(CELLS - 1);
    // ⚠️ 아트를 안 넘기면 **조용히 절차적 엠블럼 폴백**으로 떨어진다(어두운 판). 이 리포가
    // 반복해서 밟은 "배선이 없는데 테스트는 그린" 유형이라, 화면으로 확인한 뒤에 닫는다.
    const hero = makeHeroTile(
      TILE_W,
      TILE_H,
      t('base.launch'),
      t('base.launchSub'),
      () => this.cb?.onStarMap(),
      this.art[BASE_LAUNCH_NAME],
    );
    hero.container.position.set(x, y);
    this.root.addChild(hero.container);
    this.hero = hero;
  }

  private renderMeta(profile: Profile): void {
    const ship = activeShip(profile);
    const meta = new Text({
      resolution: 2,
      // 크레딧·광물은 상단 칩이 이미 보여 준다 — 같은 화면에서 두 번 적으면 디버그
      // 텍스트로 읽힌다(AAA 비평 지적). `meta.line` 대신 짧은 전용 키를 쓴다.
      text: t('base.metaShort', { lv: ship.level, sp: profile.skillPoints }),
      style: { fontFamily: UI_FONT, fontSize: 19, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    meta.anchor.set(0.5, 0);
    meta.position.set(DESIGN_WIDTH / 2, META_Y);
    this.root.addChild(meta);
  }
}
