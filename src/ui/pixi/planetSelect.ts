/**
 * 성계 지도 / 행성 선택 화면 (Pixi 카툰나무풍 리스킨 — `.omc/plans/cartoonwood-rollout.md` #4).
 *
 * `src/ui/planetSelect.ts` 의 DOM `PlanetSelect` 와 기능 1:1 동등하게 출격 전 화면을 Pixi
 * 캔버스(1920×1080 디자인 스페이스)로 재구현한다: 행성 카드 선택, 침략 단계 선택(ADR-0022 —
 * 행성별 1..개방 상한 스텝퍼), 출격/장비 정비/기지 복귀. 공개 인터페이스(`show`/`hide`/`visible`)
 * 와 `LaunchSelection` 은 DOM 판 그대로다(롤아웃 공통 규칙 2). DOM 클래스는 회귀 대비로 남긴다.
 *
 * 촉매 주입 패널(변칙 패널 자리, ADR-0029)은 **Lane 4 픽커 소관** — 이 파일은 아직 그 자리를
 * 비워 둔다(하단 패널 행에 단계 스텝퍼만 렌더). Lane 4 가 여기 하단에 촉매 픽커/주입/해제를 얹는다.
 *
 * 앞선 3화면(기지 맵·연구소·정제소)과 달리 **카드형 레이아웃**이다 — 카드 골격은 기지 맵
 * 건물 타일과 겹쳐 `./card.ts` 로 승격했다.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { PLANETS, planetById, type PlanetMeta } from '../../../data/planets.js';
import { stageOpenCap } from '../../../data/waves.js';
import { multCentiFor } from '../../net/planetMultipliers.js';
import { NEUTRAL_MULT_CENTI } from '../../economy/planetPopularity.js';
import { catalystById, normalizeCatalystArray, SLOT_CAP } from '../../data/catalysts.js';
import { t, type MessageKey } from '../../i18n/index.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import type { LaunchSelection, BestStageClearedFn } from '../planetSelect.js';
import type { CatalystInventory } from '../../net/index.js';
import { COLOR, UI_FONT, TEXT_SHADOW, hexColor } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { panelContent, PANEL_BORDER, nineSlicePanel } from './nineSlicePanel.js';
import { makePanelCard } from './card.js';
import { PixiButton } from './button.js';
import { makeBanner } from './titleBar.js';
import { stripEmoji } from './text.js';
import { CatalystPicker } from './catalystPicker.js';

export type { LaunchSelection };

// --- 레이아웃 상수(디자인 스페이스) ---
/** 배너 폭은 제목("성계 지도") 길이에 맞춘다 — 짧은 제목에 넓은 배너는 허전하다(정제소 #3 과 동일). */
const BANNER_W = 440;
const BANNER_H = 72;
const BANNER_Y = 12;
const SUB_Y = 94;

// 행성 카드 행.
const CARD_Y = 126;
/** 콘텐츠(오브 → 이름 → 부제 2줄)가 콘텐츠 상자 바닥에 딱 맞는 높이. */
const CARD_H = 364;
const CARD_MAX_W = 460;
const CARD_GAP = 32;
/** 카드 행이 쓸 수 있는 최대 폭(좌우 48px 여백). */
const CARD_ROW_MAX_W = 1824;
/** 행성 오브 지름. 자산이 64px 이므로 ×2 정수 배율(픽셀아트가 뭉개지지 않는다). */
const ORB_D = 128;
const CARD_NAME_Y = 212;
const CARD_SUB_Y = 254;
/**
 * 행성 인기 배율 줄의 세로 띠(ADR-0038). 카드는 **겹치면 안 되는 세로 띠**로 설계돼 있다
 * (오브 → 이름 212 → 부제 254~ → 배율 318). 부제는 2줄까지 감기므로(18px × 2 ≈ 44) 바닥이
 * 약 298 이고, 318 은 그 아래 20px 여유를 둔 자리다. **부제 폰트·wordWrap 을 키우면 이 값을
 * 함께 내려라** — 안 그러면 두 줄이 겹친다(격납고 헤더에서 두 번 재발한 결함 유형).
 */
const CARD_MULT_Y = 318;

// 하단 패널 행: 단계 스텝퍼(좌) + 촉매 주입 패널(우, ADR-0029 Lane 4 — 구 변칙 패널 자리).
const LOW_Y = 546;
export const LOW_H = 280;
/** 단계 패널 폭(좌). 티어 3버튼 행(884)이 콘텐츠 상자에 들어가는 최소 폭 이상. */
export const STAGE_W = 1040;
/** 촉매 주입 패널 폭(우). */
const CAT_W = 560;
/** 두 하단 패널 사이 간격. */
const LOW_GAP = 40;
/** 단계 조절 행 높이/세로 위치(콘텐츠 상자 안 — 제목 아래, 캡션 위). */
export const STAGE_ROW_H = 64;
export const STAGE_ROW_Y = 108;
export const STAGE_DESC_Y = 186;
/** 최소/최대 점프 버튼 폭(`≪` / `≫`). */
const STAGE_JUMP_W = 96;
/** 큰 걸음 버튼 폭(`−5` / `+5` — 걸음 폭은 상한에서 파생, {@link stageBigStep}). */
const STAGE_BIG_W = 120;
/** 한 칸 조절 버튼 폭(`−` / `+` — 정밀 조정용, 절대 없애지 않는다). */
const STAGE_STEP_W = 96;
/** 현재 단계 표시 버튼 폭(노란 버튼·비활성). */
const STAGE_VALUE_W = 200;
const STAGE_BTN_GAP = 14;

// 하단 액션.
const LAUNCH_W = 460;
const LAUNCH_H = 84;
const LAUNCH_Y = 872;
const SIDE_W = 240;
const SIDE_H = 64;
const SIDE_GAP = 24;
const SIDE_Y = LAUNCH_Y + (LAUNCH_H - SIDE_H) / 2;
const META_Y = 1000;

/** 카드 n 장이 한 행에 들어가도록 카드 폭을 정한다(행성이 늘어도 삐져나가지 않게). */
function cardWidth(n: number): number {
  if (n <= 0) return CARD_MAX_W;
  return Math.min(CARD_MAX_W, Math.floor((CARD_ROW_MAX_W - CARD_GAP * (n - 1)) / n));
}

// --- 침략 단계 조절 컨트롤(순수 층) ---------------------------------------
//
// 단계 조절의 **의미**를 픽시와 분리해 여기 순수 함수로 둔다. 렌더는 이 사양을 버튼으로
// 옮겨 그릴 뿐이고, 모든 이동은 예외 없이 `clampStageTo` 를 통과한 절대 목표 단계다 —
// "새 컨트롤이 클램프를 우회한다"는 결함이 구조적으로 불가능해지고, 단위 테스트가 캔버스
// 없이 전 컨트롤의 도달 범위를 검사할 수 있다.

/** 단계를 [1, cap] 안으로 가둔다(모든 단계 이동의 유일한 관문). */
export function clampStageTo(stage: number, cap: number): number {
  const lo = 1;
  const hi = cap < lo ? lo : cap;
  const s = Number.isFinite(stage) ? Math.round(stage) : lo;
  return s < lo ? lo : s > hi ? hi : s;
}

/**
 * 큰 걸음 폭. 개방 상한은 클리어가 쌓이면 계속 커지므로(`stageOpenCap` = max(10, best+5))
 * 고정 5로 두면 상한 100 에서 다시 "여러 번 눌러야" 문제로 돌아간다. 상한의 1/10 로 두되
 * 하한 5 를 지켜 초반(상한 10~50)에는 익숙한 ±5 가 유지된다.
 */
export function stageBigStep(cap: number): number {
  return Math.max(5, Math.ceil((cap < 1 ? 1 : cap) / 10));
}

/** 단계 조절 버튼 한 칸의 사양(좌→우 순서로 배열). */
export interface StageControlSpec {
  /** 안정 식별자(테스트·하네스가 라벨 문자열에 의존하지 않게). */
  key: 'min' | 'bigDec' | 'dec' | 'value' | 'inc' | 'bigInc' | 'max';
  label: string;
  width: number;
  fontSize: number;
  /** 누르면 도달할 **절대** 단계(이미 클램프됨). */
  target: number;
  /** 눌러서 의미가 있는가(끝에 닿았으면 false → 비활성). */
  enabled: boolean;
  /** 현재 단계 표시 칸인가(노란 버튼·클릭 없음). */
  readonly current?: true;
}

/**
 * 현재 단계·상한에서 조절 행 사양을 만든다. `−`/`+` 한 칸 조절은 정밀 조정용으로 항상 남고,
 * 큰 걸음(±{@link stageBigStep})과 최소/최대 점프(`≪`/`≫`)가 먼 단계로의 도달을 짧게 만든다.
 * 라벨은 기호·숫자뿐이라 새 i18n 문자열이 필요 없다(걸음 폭이 라벨에 그대로 드러난다).
 */
export function stageControlSpecs(stage: number, cap: number): StageControlSpec[] {
  const cur = clampStageTo(stage, cap);
  const hi = clampStageTo(cap, cap);
  const big = stageBigStep(cap);
  const canDec = cur > 1;
  const canInc = cur < hi;
  return [
    { key: 'min', label: '≪', width: STAGE_JUMP_W, fontSize: 28, target: 1, enabled: canDec },
    { key: 'bigDec', label: `−${big}`, width: STAGE_BIG_W, fontSize: 24, target: clampStageTo(cur - big, cap), enabled: canDec },
    { key: 'dec', label: '−', width: STAGE_STEP_W, fontSize: 34, target: clampStageTo(cur - 1, cap), enabled: canDec },
    { key: 'value', label: String(cur), width: STAGE_VALUE_W, fontSize: 26, target: cur, enabled: false, current: true },
    { key: 'inc', label: '+', width: STAGE_STEP_W, fontSize: 34, target: clampStageTo(cur + 1, cap), enabled: canInc },
    { key: 'bigInc', label: `+${big}`, width: STAGE_BIG_W, fontSize: 24, target: clampStageTo(cur + big, cap), enabled: canInc },
    { key: 'max', label: '≫', width: STAGE_JUMP_W, fontSize: 28, target: hi, enabled: canInc },
  ];
}

/** 조절 행 전체 폭(버튼 폭 합 + 간격). 콘텐츠 상자 폭을 넘으면 안 된다. */
export function stageRowWidth(specs: readonly StageControlSpec[]): number {
  if (specs.length === 0) return 0;
  let w = 0;
  for (const s of specs) w += s.width;
  return w + STAGE_BTN_GAP * (specs.length - 1);
}

/** 두 색을 tt(0=a, 1=b) 로 섞는다 — 오브 그라데이션용. */
function mixColor(a: number, b: number, tt: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * tt);
  const g = Math.round(ag + (bg - ag) * tt);
  const bl = Math.round(ab + (bb - ab) * tt);
  return (r << 16) | (g << 8) | bl;
}

/**
 * 행성 오브 **폴백**. 실 자산(`ui_planet_<id>.png`)이 없을 때만 쓴다. DOM 판의
 * `radial-gradient(circle at 35% 30%, accent, #05060a)` 를 동심원 레이어로 근사한다
 * (Pixi Graphics 에는 방사 그라데이션이 없다). 하이라이트 중심을 좌상단으로 밀어 구체감을 낸다.
 */
function makeOrb(diameter: number, accent: number): Graphics {
  const g = new Graphics();
  const r = diameter / 2;
  // 바깥 glow(DOM box-shadow 0 0 22px currentColor).
  g.circle(r, r, r + 6).fill({ color: accent, alpha: 0.16 });
  const steps = 12;
  for (let i = steps; i >= 1; i--) {
    const tt = i / steps; // 1 = 가장 바깥
    const rr = r * tt;
    // 하이라이트 중심(35%, 30%)으로 갈수록 중심이 이동한다.
    const cx = r + (1 - tt) * (-r * 0.3);
    const cy = r + (1 - tt) * (-r * 0.4);
    g.circle(cx, cy, rr).fill({ color: mixColor(0x05060a, accent, 1 - tt) });
  }
  g.circle(r, r, r).stroke({ color: accent, width: 2, alpha: 0.55, alignment: 0 });
  return g;
}

export class PlanetSelectScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private ui: UiTextures = {};
  private planet = 0;
  /** 선택된 침략 단계(1..개방 상한). `stage`(Pixi Container)와 이름이 겹치지 않게 별칭. */
  private selectedStage = 1;
  /** 행성별 개방 상한 산정 콜백(미지정 = 최고 클리어 0 → 상한 10). */
  private bestStageCleared: BestStageClearedFn = () => 0;
  private meta = '';
  private onLaunch: ((sel: LaunchSelection) => void) | null = null;
  private onInventory: (() => void) | null = null;
  private onBack: (() => void) | null = null;
  /** 이 런에 주입한 촉매 id(중복=스택, ADR-0029). 픽커가 편집하고 launch 가 sel 에 실어 넘긴다. */
  private injectedCatalysts: number[] = [];
  /** 보유 수량 스냅샷(서버 권위 — show 시 온라인 조회). 없으면 빈 맵(주입 불가). */
  private inventory: CatalystInventory = new Map<number, number>();
  /** 보유 원장 조회 provider(온라인=net, 하네스=모의). 미지정이면 조회하지 않는다. */
  private fetchInventory: (() => Promise<CatalystInventory | null>) | null = null;
  /** 촉매 주입 픽커 팝업(하위 컴포넌트). */
  private readonly picker: CatalystPicker;

  constructor(stage: Container) {
    this.stage = stage;
    this.picker = new CatalystPicker(stage);
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
    // UI 킷 텍스처 비동기 로드 — 완료 후 열려 있으면 실 아트로 다시 그린다(그 전엔 폴백).
    void loadUiTextures().then((tex) => {
      this.ui = tex;
      if (this.root.visible) this.render();
    });
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /**
   * 다음 런의 성계 지도를 연다(DOM 판과 동일 시그니처).
   * @param opts.meta 하단 상태 줄(크레딧 / 기체 레벨 등).
   */
  show(opts: {
    meta: string;
    /** 행성별 개방 상한 산정 콜백(ADR-0022). 생략 시 최고 클리어 0(상한 10). */
    bestStageCleared?: BestStageClearedFn;
    onLaunch: (sel: LaunchSelection) => void;
    onInventory: () => void;
    /** 기지 맵 복귀(왕복 동선). */
    onBack?: () => void;
    /**
     * 촉매 보유 원장 조회 provider(ADR-0029). 온라인은 net `fetchCatalystInventoryOnline`,
     * 하네스는 모의를 넘긴다. 미지정이면 조회하지 않는다(빈 보유 = 주입 불가, 오프라인 폴백 보존).
     */
    fetchCatalystInventory?: () => Promise<CatalystInventory | null>;
  }): void {
    this.bestStageCleared = opts.bestStageCleared ?? (() => 0);
    // 선택 단계를 현재 행성 개방 상한으로 클램프한다(DOM 판과 동일).
    this.selectedStage = this.clampStage(this.selectedStage);
    this.meta = opts.meta;
    this.onLaunch = opts.onLaunch;
    this.onInventory = opts.onInventory;
    this.onBack = opts.onBack ?? null;
    this.fetchInventory = opts.fetchCatalystInventory ?? null;
    // 이전 런 주입이 이번 행성 특산 정합을 깨지 않게 정리(무촉매로 시작하는 것이 안전하다).
    this.pruneInjectedForPlanet();
    this.render();
    this.root.visible = true;
    // 보유 원장은 서버 권위라 비동기 조회한다 — 도착하면 픽커·패널이 반영한다(그 전엔 빈 보유).
    const fetchInv = this.fetchInventory;
    if (fetchInv !== null) {
      void fetchInv().then((inv) => {
        if (inv !== null) this.inventory = inv;
        if (this.root.visible) this.render();
      });
    }
    // DOM HUD 는 런 전용 — 캔버스 메타 화면 위에 떠 보이므로 숨긴다(스킬 §7).
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = 'hidden';
  }

  hide(): void {
    this.root.visible = false;
    this.picker.hide(); // 픽커 모달이 떠 있으면 함께 내린다(화면 전환 시 잔상 방지).
    this.onLaunch = null;
    this.onInventory = null;
    this.onBack = null;
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = '';
  }

  // --- 선택 / 출격 (DOM 판과 동일 규칙) ------------------------------------

  private selectPlanet(id: number): void {
    this.planet = id;
    // 행성마다 개방 상한이 다르므로 선택 단계를 새 행성 상한으로 클램프한다.
    this.selectedStage = this.clampStage(this.selectedStage);
    // 특산 촉매는 출신 행성 전용이라 행성이 바뀌면 정합이 깨진 특산 주입을 걷어낸다(consume 거부 예방).
    this.pruneInjectedForPlanet();
    this.render();
  }

  /** 현재 선택 행성에서 잠기는 특산 촉매 주입을 제거한다(공용은 유지). */
  private pruneInjectedForPlanet(): void {
    this.injectedCatalysts = this.injectedCatalysts.filter((id) => {
      const def = catalystById(id);
      if (def === undefined) return false;
      return def.kind === 'common' || def.planet === this.planet;
    });
  }

  /** 현재 선택 행성의 개방 상한(max(10, 최고 클리어 + 5), ADR-0022). */
  private openCap(): number {
    return stageOpenCap(this.bestStageCleared(this.planet));
  }

  /** 단계를 [1, 개방 상한]으로 클램프한다. */
  private clampStage(stage: number): number {
    return clampStageTo(stage, this.openCap());
  }

  /**
   * 목표 단계로 이동한다(절대값). 큰 걸음·점프·한 칸 조절이 전부 이 한 지점을 지나므로
   * 클램프 불변이 컨트롤 종류와 무관하게 유지된다.
   */
  private setStage(stage: number): void {
    this.selectedStage = this.clampStage(stage);
    this.render();
  }

  /** 현재 선택 단계(하네스·테스트가 읽는 접점). */
  getSelectedStage(): number {
    return this.selectedStage;
  }

  private launch(): void {
    const cb = this.onLaunch;
    // 주입 촉매를 sel 에 실어 넘긴다(중복=스택). 출격 오케스트레이터(main.ts)가 비지 않으면
    // consume_catalysts 를 거쳐 런을 시작한다. 무촉매면 catalysts 를 싣지 않아 기존 경로 불변.
    const cats = this.injectedCatalysts.slice();
    const sel: LaunchSelection = {
      planet: this.planet,
      stage: this.selectedStage,
      ...(cats.length > 0 ? { catalysts: cats } : {}),
    };
    this.hide();
    cb?.(sel);
  }

  private back(): void {
    const cb = this.onBack;
    this.hide();
    cb?.();
  }

  // --- 렌더 ----------------------------------------------------------------

  private render(): void {
    for (const child of [...this.root.children]) {
      this.root.removeChild(child);
      child.destroy({ children: true });
    }

    // 배경(불투명 — 뒤 아레나를 가린다). 별 장식 금지(세트 팔레트 확정).
    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static'; // 뒤로 이벤트가 새지 않게 막는다.
    this.root.addChild(bg);

    this.renderTitleBar();
    this.renderPlanetCards();
    this.renderLowPanels();
    this.renderActions();
    this.renderMeta();
  }

  private renderTitleBar(): void {
    const banner = makeBanner(BANNER_W, BANNER_H, t('planet.title'), this.ui['ui_banner.png']);
    banner.position.set((DESIGN_WIDTH - BANNER_W) / 2, BANNER_Y);
    this.root.addChild(banner);

    const sub = new Text({
      resolution: 2,
      text: t('planet.sub'),
      style: { fontFamily: UI_FONT, fontSize: 20, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    sub.anchor.set(0.5, 0);
    sub.position.set(DESIGN_WIDTH / 2, SUB_Y);
    this.root.addChild(sub);
  }

  private renderPlanetCards(): void {
    const n = PLANETS.length;
    const w = cardWidth(n);
    const rowW = n * w + (n - 1) * CARD_GAP;
    const x0 = (DESIGN_WIDTH - rowW) / 2;
    PLANETS.forEach((p, i) => {
      const card = this.makePlanetCard(p, w);
      card.position.set(x0 + i * (w + CARD_GAP), CARD_Y);
      this.root.addChild(card);
    });
  }

  private makePlanetCard(p: PlanetMeta, w: number): Container {
    const selected = p.id === this.planet;
    const accent = hexColor(p.accent);
    const card = makePanelCard({
      width: w,
      height: CARD_H,
      texture: this.ui['ui_panel.png'],
      selected,
      onClick: () => this.selectPlanet(p.id),
    });
    // 콘텐츠는 전부 이 상자 안에만 — 프레임 침범도, 테두리에 붙는 것도 여기서 막힌다.
    const box = panelContent(w, CARD_H);

    // 실 자산(PixelLab 생성 64px 행성)이 있으면 ×2 nearest 로 확대해 쓰고, 없으면 코드 오브.
    const orbTex = this.ui[`ui_planet_${p.id}.png`];
    const orb = orbTex ? new Sprite(orbTex) : makeOrb(ORB_D, accent);
    if (orbTex) {
      orb.width = ORB_D;
      orb.height = ORB_D;
    }
    orb.position.set((w - ORB_D) / 2, box.y);
    card.addChild(orb);

    const name = new Text({
      resolution: 2,
      text: p.name,
      style: {
        fontFamily: UI_FONT,
        fontSize: 30,
        fontWeight: '800',
        fill: selected ? COLOR.gold : COLOR.cream,
        dropShadow: TEXT_SHADOW,
      },
    });
    name.anchor.set(0.5, 0);
    name.position.set(w / 2, CARD_NAME_Y);
    card.addChild(name);

    const sub = new Text({
      resolution: 2,
      text: p.subtitle,
      style: {
        fontFamily: UI_FONT,
        fontSize: 18,
        fill: COLOR.muted,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: box.w,
        dropShadow: TEXT_SHADOW,
      },
    });
    sub.anchor.set(0.5, 0);
    sub.position.set(w / 2, CARD_SUB_Y);
    card.addChild(sub);

    // 행성 인기 보상 배율(ADR-0038) — **실수치 상시 노출**이 결정 사항이다. 감추면 플레이어가
    // "왜 여기가 더 잘 나오지?"를 추측하게 되고, 그 추측은 대개 미신이 된다. 중립(×1.00)이든
    // 아니든 항상 같은 자리에 같은 형식으로 찍어 비교 가능하게 둔다.
    // 색은 방향 신호: 상향=금색(가라), 하향=흐림(덜 준다), 중립=크림.
    const centi = multCentiFor(p.id);
    const mult = new Text({
      resolution: 2,
      text: `보상 ×${(centi / 100).toFixed(2)}`,
      style: {
        fontFamily: UI_FONT,
        fontSize: 20,
        fontWeight: '700',
        fill:
          centi > NEUTRAL_MULT_CENTI
            ? COLOR.gold
            : centi < NEUTRAL_MULT_CENTI
              ? COLOR.muted
              : COLOR.cream,
        dropShadow: TEXT_SHADOW,
      },
    });
    mult.anchor.set(0.5, 0);
    mult.position.set(w / 2, CARD_MULT_Y);
    card.addChild(mult);

    return card;
  }

  /** 하단 패널 행: 단계 스텝퍼(좌) + 촉매 주입 패널(우, ADR-0029). */
  private renderLowPanels(): void {
    const rowW = STAGE_W + LOW_GAP + CAT_W;
    const x0 = Math.round((DESIGN_WIDTH - rowW) / 2);

    const stage = this.makeStagePanel(STAGE_W);
    stage.position.set(x0, LOW_Y);
    this.root.addChild(stage);

    const cat = this.makeCatalystPanel(CAT_W);
    cat.position.set(x0 + STAGE_W + LOW_GAP, LOW_Y);
    this.root.addChild(cat);
  }

  /**
   * 촉매 주입 패널(구 변칙 패널 자리, ADR-0029). 현재 주입 요약 + [주입 편집] 버튼. 편집은 픽커
   * 팝업(`CatalystPicker`)에서 하고, 확정된 배열을 여기 상태에 반영해 출격 때 sel 로 넘긴다.
   */
  private makeCatalystPanel(w: number): Container {
    const panel = new Container();
    panel.addChild(nineSlicePanel(w, LOW_H, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER }));
    const box = panelContent(w, LOW_H);
    this.panelTitle(panel, w, t('catalyst.panel.title'));

    // 주입 요약: 개수 + 주입한 촉매 이름(잘림). 미주입인데 보유가 있으면 첫 주입을 유도하는 힌트
    // (해금 게이트 부재 — 첫 획득 즉시 주입 가능, ADR-0029 온보딩). 보유도 없으면 기본 안내.
    const n = this.injectedCatalysts.length;
    const ownedTypes = this.inventory.size;
    const summary =
      n > 0
        ? `${t('catalyst.panel.count', { n, cap: SLOT_CAP })}\n${this.injectedNames()}`
        : ownedTypes > 0
          ? t('catalyst.panel.available', { n: ownedTypes })
          : t('catalyst.panel.none');
    // 색: 주입 있으면 크림, 보유만 있으면 골드(첫 주입 넛지), 둘 다 없으면 뮤트.
    const summaryFill = n > 0 ? COLOR.cream : ownedTypes > 0 ? COLOR.gold : COLOR.muted;
    const sumText = new Text({
      resolution: 2,
      text: summary,
      style: {
        fontFamily: UI_FONT,
        fontSize: 18,
        fill: summaryFill,
        wordWrap: true,
        wordWrapWidth: box.w,
        lineHeight: 24,
        dropShadow: TEXT_SHADOW,
      },
    });
    sumText.position.set(box.x, box.y + 44);
    panel.addChild(sumText);

    const edit = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: box.w,
      height: 56,
      fontSize: 22,
      label: t('catalyst.panel.edit'),
      onClick: () => this.openCatalystPicker(),
    });
    edit.container.position.set(box.x, box.bottom - 56);
    panel.addChild(edit.container);

    return panel;
  }

  /** 주입한 촉매 이름을 콤마로 이어 붙인다(패널 요약용, i18n name). */
  private injectedNames(): string {
    return this.injectedCatalysts
      .map((id) => {
        const def = catalystById(id);
        return def === undefined ? '' : t(`catalyst.${def.slug}.name` as MessageKey);
      })
      .filter((s) => s !== '')
      .join(', ');
  }

  /**
   * 촉매 주입 픽커 팝업을 연다(하네스 훅 지점 — public). 확정된 배열을 주입 상태에 반영하고
   * 성계 지도를 다시 그린다. 보유 스냅샷·현재 행성을 픽커에 넘겨 슬롯 상한·특산 정합을 강제한다.
   */
  openCatalystPicker(): void {
    this.picker.show({
      planet: this.planet,
      injected: this.injectedCatalysts,
      inventory: this.inventory,
      onConfirm: (ids) => {
        // 정규화(오름차순·중복 보존·미지 제거)로 저장 — consume·해시 정본과 같은 형태.
        this.injectedCatalysts = normalizeCatalystArray(ids);
        this.render();
      },
    });
  }

  // --- 하네스 훅(Lane 5 접점) ----------------------------------------------

  /** 현재 주입된 촉매 id(복사본). 하네스가 출격 상태를 읽는 접점. */
  getInjectedCatalysts(): number[] {
    return this.injectedCatalysts.slice();
  }

  /** 주입 촉매를 직접 세팅한다(하네스 셋업용). 현재 행성 특산 정합에 맞게 정리한다. */
  setInjectedCatalysts(ids: readonly number[]): void {
    this.injectedCatalysts = normalizeCatalystArray([...ids]);
    this.pruneInjectedForPlanet();
    if (this.root.visible) this.render();
  }

  /** 보유 원장 스냅샷을 직접 주입한다(하네스 모의 — 서버 조회 우회). */
  setCatalystInventory(inv: CatalystInventory): void {
    this.inventory = inv;
    if (this.root.visible) this.render();
  }

  /** 패널 제목 — top = 콘텐츠 상자 top(스킬 §4, 제목이 나무 테두리에 붙던 결함 재발 방지). */
  private panelTitle(parent: Container, w: number, text: string, color: number = COLOR.cream): void {
    const box = panelContent(w, LOW_H);
    const title = new Text({
      resolution: 2,
      text,
      style: {
        fontFamily: UI_FONT,
        fontSize: 26,
        fontWeight: '800',
        fill: color,
        wordWrap: true,
        wordWrapWidth: box.w,
        dropShadow: TEXT_SHADOW,
      },
    });
    title.position.set(box.x, box.y);
    parent.addChild(title);
  }

  /**
   * 선택형 버튼 한 개. 선택된 것은 노란 버튼(밝은 바탕 → 진한 라벨), 나머지는 나무 버튼.
   * 롤아웃 #1~#3 과 같은 규칙이다(노란 버튼에 흰 라벨은 묻힌다).
   */
  private choiceButton(opts: {
    label: string;
    width: number;
    height: number;
    selected: boolean;
    onClick: () => void;
    fontSize?: number;
  }): PixiButton {
    return new PixiButton({
      texture: this.ui[opts.selected ? 'ui_btn_yellow.png' : 'ui_btn_wood.png'],
      fallbackColor: opts.selected ? 0x9a7a2a : 0x4a3a24,
      width: opts.width,
      height: opts.height,
      fontSize: opts.fontSize ?? 24,
      ...(opts.selected ? { labelColor: COLOR.darkLabel } : {}),
      label: opts.label,
      onClick: opts.onClick,
    });
  }

  /**
   * 침략 단계 조절 패널(ADR-0022). 초기 3버튼(`−`/값/`+`)은 한 번에 한 단계만 움직여, 개방
   * 상한이 10 이상인 지금은 목표 단계까지 여러 번 눌러야 했다. 그래서 같은 한 행에 **큰 걸음
   * (±{@link stageBigStep})과 최소/최대 점프(`≪`/`≫`)** 를 더한다 — `−`/`+` 한 칸 조절은
   * 정밀 조정용으로 그대로 남는다. 사양은 순수 함수({@link stageControlSpecs})가 만들고 여기서는
   * 버튼으로 옮겨 그릴 뿐이라, 모든 이동이 `setStage`(→ clamp) 한 지점을 지난다.
   *
   * 새 아트 없이 기존 나무/노란 버튼 어휘만 쓰고, 라벨은 기호·숫자라 새 i18n 문자열도 없다.
   */
  private makeStagePanel(w: number): Container {
    const panel = new Container();
    panel.addChild(nineSlicePanel(w, LOW_H, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER }));
    const box = panelContent(w, LOW_H);
    this.panelTitle(panel, w, t('planet.stageLabel'));

    const cap = this.openCap();
    const specs = stageControlSpecs(this.selectedStage, cap);
    // 행 전체를 콘텐츠 상자 안에서 가운데 정렬 — 상자 밖(나무 테두리)으로는 절대 나가지 않는다.
    const rowW = stageRowWidth(specs);
    let bx = box.x + Math.max(0, Math.floor((box.w - rowW) / 2));

    for (const spec of specs) {
      const btn = this.choiceButton({
        label: spec.label,
        width: spec.width,
        height: STAGE_ROW_H,
        selected: spec.current === true,
        fontSize: spec.fontSize,
        // 현재 단계 칸은 표시 전용(비활성). 나머지는 절대 목표 단계로 이동한다.
        onClick: spec.current === true ? () => {} : () => this.setStage(spec.target),
      });
      if (!spec.enabled) btn.setEnabled(false);
      btn.container.position.set(bx, STAGE_ROW_Y);
      panel.addChild(btn.container);
      bx += spec.width + STAGE_BTN_GAP;
    }

    const desc = new Text({
      resolution: 2,
      text: t('planet.stageDesc', { stage: this.selectedStage, cap }),
      style: {
        fontFamily: UI_FONT,
        fontSize: 19,
        fill: COLOR.muted,
        dropShadow: TEXT_SHADOW,
      },
    });
    desc.anchor.set(0.5, 0);
    if (desc.width > box.w) desc.scale.x = box.w / desc.width;
    desc.position.set(w / 2, STAGE_DESC_Y);
    panel.addChild(desc);

    return panel;
  }

  private renderActions(): void {
    const launchX = (DESIGN_WIDTH - LAUNCH_W) / 2;

    if (this.onBack !== null) {
      const back = new PixiButton({
        texture: this.ui['ui_btn_wood.png'],
        fallbackColor: 0x4a3a24,
        width: SIDE_W,
        height: SIDE_H,
        fontSize: 22,
        label: t('planet.back'),
        onClick: () => this.back(),
      });
      back.container.position.set(launchX - SIDE_GAP - SIDE_W, SIDE_Y);
      this.root.addChild(back.container);
    }

    const inv = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: SIDE_W,
      height: SIDE_H,
      fontSize: 22,
      // '🛠 장비 정비' 의 컬러 이모지는 캔버스에서 두부가 된다.
      label: stripEmoji(t('planet.inventory')),
      onClick: () => this.onInventory?.(),
    });
    inv.container.position.set(launchX + LAUNCH_W + SIDE_GAP, SIDE_Y);
    this.root.addChild(inv.container);

    const launch = new PixiButton({
      texture: this.ui['ui_btn_yellow.png'],
      fallbackColor: 0x9a7a2a,
      width: LAUNCH_W,
      height: LAUNCH_H,
      fontSize: 30,
      // 노란 버튼은 바탕이 밝아 흰 라벨이 묻힌다(롤아웃 #1~#3 과 동일 처리).
      labelColor: COLOR.darkLabel,
      label: t('planet.launch', { name: planetById(this.planet).name }),
      sound: 'uiConfirm', // 출격 = 결정성 확정 액션(AC16 팔레트 재사용 — 기본 navigate 와 구분).
      onClick: () => this.launch(),
    });
    launch.container.position.set(launchX, LAUNCH_Y);
    this.root.addChild(launch.container);
  }

  private renderMeta(): void {
    const meta = new Text({
      resolution: 2,
      text: this.meta,
      style: { fontFamily: UI_FONT, fontSize: 20, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    meta.anchor.set(0.5, 0);
    meta.position.set(DESIGN_WIDTH / 2, META_Y);
    this.root.addChild(meta);
  }
}
