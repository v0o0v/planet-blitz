/**
 * 정제소 화면 — 정련 공정(ADR-0040, push-your-luck 연쇄).
 *
 * 왼쪽에서 장비를 고르면 오른쪽에 **공정**이 열린다: 노 출력(약불·중불·강불)을 고르고 굴리면
 * 미고착 어픽스가 재추첨되고, 굴린 뒤 어픽스 하나까지 `고착`할 수 있다(해제 불가). 고착이
 * 쌓일수록 다음 굴림의 **용해** 위험이 오르고, 용해하면 그 공정의 고착이 전부 풀려 시작 직전
 * 상태로 돌아간다. 고착이 0개면 위험이 정확히 0 이라 구 단발 리롤이 규칙 하나에서 파생된다.
 *
 * 상태기계는 순수 모듈 `src/items/refiningChain.ts` 가 소유하고, 이 파일은 그 위에 입력·좌표·
 * 연출만 얹는다. 비용·위험 수치는 `data/economy.ts`(`rollCost`·`meltRisk`)가 정본이다.
 *
 * ⚠️ **결과 확정·저장이 언제나 연출보다 먼저다**(`persist()` → 연출 시작). 새로고침으로 나쁜
 * 롤을 무를 수 없는 이유가 이 순서에 있다. 연출은 이미 정해진 결과를 보여줄 뿐이라 render-only
 * 이고 결과에 영향을 주지 않는다.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Rectangle, NineSliceSprite, Text, Ticker } from 'pixi.js';
import type { Item } from '../../items/types.js';
import { AFFIXES, AFFIX_BY_ID } from '../../../data/affixes.js';
import { affixLines, affixTitleLine } from '../affixText.js';
import { itemDisplayName, slotLabel } from '../itemNames.js';
import {
  openChain,
  fasten as fastenAffix,
  rollChain,
  isComplete,
  type ChainState,
} from '../../items/refiningChain.js';
import { saveProfile, type KeyValueStore, type Profile } from '../../save/profile.js';
import { spendCurrencyOnServer } from '../../net/index.js';
import { t, type MessageKey } from '../../i18n/index.js';
import { rollCost, meltRisk, canAfford, HEATS, type Heat } from '../../../data/economy.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, RARITY_COLOR_NUM, UI_FONT, TEXT_SHADOW } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { nineSlicePanel, panelContent, PANEL_BORDER } from './nineSlicePanel.js';
import { PixiButton } from './button.js';
import { makeSlotCell, gridPositions, equipIconTexture } from './slotGrid.js';
import { PixiTooltip } from './tooltip.js';
import { makeBanner, makeCurrencyChip, makeIconButton } from './titleBar.js';
import { stripEmoji } from './text.js';
import { graphicsSettings } from '../../render/graphicsSettings.js';

// 슬롯·무기 표시명은 `src/ui/itemNames.ts` 단일 정본을 쓴다(화면마다 다른 이름 금지).

// --- 레이아웃 상수(디자인 스페이스) ---
/** 배너 폭은 제목("정제소") 길이에 맞춘다 — 짧은 제목에 넓은 배너는 허전하다. */
const BANNER_W = 440;
const BANNER_H = 72;
const BANNER_Y = 12;
const CHIP_W = 190;
const CHIP_H = 52;
const PANEL_Y = 118;
const PANEL_H = 776;
const LIST_W = 700;
const DETAIL_W = 940;
const PANEL_GAP = 24;
const PANEL_X0 = Math.round((DESIGN_WIDTH - (LIST_W + DETAIL_W + PANEL_GAP)) / 2);
const DETAIL_X = PANEL_X0 + LIST_W + PANEL_GAP;

/**
 * 두 패널의 콘텐츠 상자. 제목·그리드·어픽스 행·비용·버튼을 전부 이 상자 기준으로 잡는다 —
 * 프레임 침범도, 테두리에 붙는 것도 좌표 재유도 없이 구조적으로 막힌다(nineSlicePanel).
 */
const BOX_L = panelContent(LIST_W, PANEL_H);
const BOX_D = panelContent(DETAIL_W, PANEL_H);
/** 제목 top = 콘텐츠 상자 top(스킬 §4 — 제목이 나무 테두리에 붙던 결함 재발 방지). */
const TITLE_Y = BOX_L.y;
/** 제목(60..~94) 아래에서 본문이 시작한다. */
const CONTENT_TOP = 118;

// 장비 그리드.
const CELL = 88;
const CELL_GAP = 10;
const GRID_COLS = 6;
const GRID_W = GRID_COLS * (CELL + CELL_GAP) - CELL_GAP;
/** 마스크 하한 = 콘텐츠 상자 바닥, 셀 행 배수로 클램프(반토막 셀 금지). */
const GRID_H =
  Math.floor((BOX_L.bottom - CONTENT_TOP + CELL_GAP) / (CELL + CELL_GAP)) * (CELL + CELL_GAP) - CELL_GAP;

// --- 상세 패널(정련 공정) ---
const NAME_Y = CONTENT_TOP;
const SUB_Y = 158;
const AFFIX_TOP = 196;
/**
 * 어픽스 행 높이·간격. 구 값(52/60)에서 줄였다 — 정련 공정이 노 출력 3버튼과 공정 멈추기
 * 버튼을 새로 얹으면서 레어 6어픽스에서 마지막 버튼이 나무 테두리를 뚫었기 때문이다
 * (`refineryDetailLayout` 이 그 부등식을 계산하고 `tests/pixiScreenPersistence.test.ts` 가 잠근다).
 */
const AFFIX_H = 44;
const AFFIX_STEP = 50;

// 어픽스 목록 아래 블록: [노 출력 3버튼] → [비용·위험 줄] → [굴리기 · 공정 멈추기].
const HEAT_H = 52;
const HEAT_W = 176;
const HEAT_GAP = 12;
/** 어픽스 마지막 행 bottom 과 노 출력 행 사이 최소 숨틈. */
const AFFIX_TO_BLOCK = 20;
const HEAT_TO_COST = 14;
const COST_H = 26;
const COST_TO_ACTION = 12;
const ROLL_W = 380;
const ROLL_H = 64;
const STOP_W = 260;
const ACTION_GAP = 24;
/** 어픽스 목록 아래에 반드시 들어가야 하는 세로 뭉치 높이(=168). */
const BLOCK_H = HEAT_H + HEAT_TO_COST + COST_H + COST_TO_ACTION + ROLL_H;

// 하단 액션.
const BACK_W = 300;
const BACK_H = 60;
const BACK_Y = 908;

/** {@link refineryDetailLayout} 결과 — 전부 상세 패널 로컬 y 좌표. */
export interface RefineryDetailLayout {
  /** 어픽스 마지막 행의 bottom. */
  readonly rowsEnd: number;
  /** 노 출력 3버튼 행의 top. */
  readonly heatY: number;
  /** 비용·위험 줄의 top. */
  readonly costY: number;
  /** 굴리기·공정 멈추기 버튼 행의 top. */
  readonly actionY: number;
  /** 상세 패널 마지막 요소의 bottom(= 버튼 행 bottom). */
  readonly lastBottom: number;
  /** 콘텐츠 상자 바닥 — 이 값을 넘으면 나무 테두리를 뚫는다. */
  readonly boxBottom: number;
}

/**
 * 어픽스 수에서 상세 패널 세로 좌표를 **파생**한다(하드코딩 금지 — 이 리포의 관례).
 *
 * 뭉치는 어픽스 목록 바로 아래로 흐르되(`rowsEnd + AFFIX_TO_BLOCK`), 콘텐츠 상자 바닥에서
 * 뭉치 높이만큼 올라온 지점을 넘지 못하게 클램프한다. 그래서 어픽스가 몇 개든
 * `lastBottom <= boxBottom` 이 **산술적으로** 성립한다 — 6어픽스에서 버튼이 테두리를 뚫던
 * 결함이 좌표 재유도 없이 구조적으로 막힌다.
 */
export function refineryDetailLayout(affixCount: number): RefineryDetailLayout {
  const n = Math.max(0, Math.trunc(affixCount));
  const rowsEnd = AFFIX_TOP + n * AFFIX_STEP;
  const heatY = Math.min(rowsEnd + AFFIX_TO_BLOCK, BOX_D.bottom - BLOCK_H);
  const costY = heatY + HEAT_H + HEAT_TO_COST;
  const actionY = costY + COST_H + COST_TO_ACTION;
  return { rowsEnd, heatY, costY, actionY, lastBottom: actionY + ROLL_H, boxBottom: BOX_D.bottom };
}

/** 노 출력 → 버튼 텍스처·폴백색. 나무→노랑→빨강이 그 자체로 열 구배를 이룬다. */
const HEAT_SKIN: Record<Heat, { readonly tex: string; readonly fallback: number; readonly dark: boolean }> = {
  low: { tex: 'ui_btn_wood.png', fallback: 0x4a3a24, dark: false },
  mid: { tex: 'ui_btn_yellow.png', fallback: 0x9a7a2a, dark: true },
  high: { tex: 'ui_btn_red.png', fallback: 0x8a2a2a, dark: false },
};

/** 연출 종류. 전부 render-only — 결과는 시작 전에 이미 확정·저장돼 있다. */
type FxKind = 'spin' | 'melt' | 'complete';
const FX_FRAMES: Record<FxKind, number> = { spin: 12, melt: 8, complete: 10 };

export class RefineryScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private readonly tooltip = new PixiTooltip();
  private profile: Profile;
  private readonly store: KeyValueStore | null;
  private onClose: (() => void) | null = null;
  private selectedId: string | null = null;
  /** 현재 열려 있는 정련 공정. 장비를 새로 고르거나 화면을 나가면 버린다(인벤토리는 이미 최신). */
  private chain: ChainState | null = null;
  /** 노 출력. 공정을 새로 열 때마다 `mid` 로 리셋한다(중불이 비용 ×1 앵커). */
  private heat: Heat = 'mid';
  private spinning = false;
  /**
   * 굴림 재화 차감(`spend_currency`)의 서버 왕복이 진행 중인지 — 동시(재진입) 클릭 가드.
   * `spinning` 은 차감 확정 **뒤에야**(await 이후) 세워지므로 왕복 중에는 재진입을 막지 못한다.
   * 이 플래그가 그 창을 잠가 광물 이중 차감을 차단하고, 이후는 `spinning` 이 이어받는다.
   * 정련 공정은 스텝이 늘어 이 창이 더 자주 열린다 — **제거하지 마라.**
   */
  private busy = false;
  private hint = '';
  private spinTimer: ReturnType<typeof setInterval> | null = null;
  /** 진행 중인 연출(render-only). */
  private fx: { kind: FxKind; ticks: number } | null = null;
  /** 연출 오버레이(패널 전면 색 플래시). 프레임마다 알파만 갈아끼운다. */
  private fxOverlay: Graphics | null = null;
  /** 스핀 프레임이 글자만 갈아끼울 어픽스 행 텍스트(고착 행은 null). */
  private spinTexts: (Text | null)[] = [];
  private listScrollY = 0;
  private ui: UiTextures = {};

  // ── 위험 가시화(render-only) ──────────────────────────────────────────────
  /** 굴리기 버튼 뒤 열기 후광. 위험이 오를수록 짙어진다. */
  private heatHalo: Graphics | null = null;
  /** 미세 진동을 받는 굴리기 버튼 컨테이너와 그 기준 좌표. */
  private rollNode: Container | null = null;
  private rollBase = { x: 0, y: 0 };
  private haloPhase = 0;
  private haloTicking = false;

  constructor(profile: Profile, stage: Container, store: KeyValueStore | null = null) {
    this.profile = profile;
    this.store = store;
    this.stage = stage;
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
    this.root.addChild(this.tooltip.container);
    void loadUiTextures().then((tex) => {
      this.ui = tex;
      if (this.root.visible) this.render();
    });
  }

  get visible(): boolean {
    return this.root.visible;
  }

  show(profile: Profile, onClose: () => void): void {
    this.profile = profile;
    this.onClose = onClose;
    this.selectedId = null;
    this.chain = null;
    this.heat = 'mid';
    this.stopSpin();
    this.hint = '';
    this.render();
    this.root.visible = true;
    this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
    // DOM HUD 는 런 전용 — 캔버스 메타 화면 위에 떠 보이므로 숨긴다(스킬 §7).
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = 'hidden';
  }

  hide(): void {
    this.stopSpin();
    this.stopHeatAnim();
    // 공정 상태만 버린다 — 굴린 결과는 굴릴 때마다 이미 인벤토리에 반영·저장돼 있다(ADR-0040).
    this.chain = null;
    this.root.visible = false;
    this.tooltip.hide();
    this.onClose = null;
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = '';
  }

  private stopSpin(): void {
    if (this.spinTimer !== null) {
      clearInterval(this.spinTimer);
      this.spinTimer = null;
    }
    this.fx = null;
    this.spinning = false;
  }

  private persist(): void {
    // ⚠️ 명시적 null 은 `saveProfile` 의 기본 인자를 밀어내고 즉시 return 된다 — main.ts 가
    // store 없이 이 화면을 만들기 때문에 그대로 넘기면 정제 결과가 저장되지 않는다.
    saveProfile(this.profile, this.store ?? undefined);
  }

  // --- 선택 / 노 출력 / 고착 / 굴림 ---------------------------------------

  /** 어픽스가 하나라도 있는 인벤토리 장비(굴릴 가치가 있는 것만). */
  private rerollable(): Item[] {
    return this.profile.inventory.filter((it) => it.affixes.length > 0);
  }

  private selected(): Item | undefined {
    if (this.selectedId === null) return undefined;
    return this.profile.inventory.find((it) => it.id === this.selectedId);
  }

  /**
   * 지금 굴림에 드는 광물(= 등급·어픽스 수 기본값 × 노 출력 배수).
   *
   * ⚠️ `heat` 를 **인자로 받는다.** `reroll()` 은 서버 왕복 전에 비용을 계산하고 왕복 후에 굴림을
   * 판정하는데, 둘이 각자 `this.heat` 를 읽으면 그 사이 노 출력이 바뀌었을 때 **지불한 열과
   * 적용된 열이 갈린다**(약불 값으로 강불 밴드를 사거나 그 반대). 호출부가 스냅샷한 같은 값을
   * 넘기게 해서 두 출처를 하나로 합친다 — 가드는 창을 좁힐 뿐 없애지 못한다.
   */
  private currentCost(heat: Heat = this.heat): number {
    const item = this.selected();
    if (item === undefined) return 0;
    return rollCost(item.rarity, item.affixes.length, heat);
  }

  /** 지금 굴리면 용해할 확률 [0,1]. 고착 0 이면 정확히 0. */
  private currentRisk(): number {
    const item = this.selected();
    if (item === undefined) return 0;
    return meltRisk(this.chain?.fastened.length ?? 0, item.affixes.length, this.heat);
  }

  private fastenedCount(): number {
    return this.chain?.fastened.length ?? 0;
  }

  /**
   * 장비 선택. 공정을 새로 연다 — 이전 공정 상태(고착·위험)는 버리고 노 출력도 `mid` 로 리셋한다.
   * ⚠️ 메서드 이름은 회귀 테스트가 캐스팅으로 직접 부른다. 바꾸지 마라.
   */
  private select(item: Item): void {
    // 서버 왕복 중(`busy`)에는 선택을 바꾸지 않는다 — 왕복 뒤 복귀한 굴림이 남의 슬롯에 쓰는
    // 경로의 1차 방어다(본 방어는 `reroll()` 의 복귀 후 재검증).
    if (this.spinning || this.busy) return;
    this.selectedId = item.id;
    this.chain = openChain(item);
    this.heat = 'mid';
    this.hint = '';
    this.render();
  }

  private setHeat(heat: Heat): void {
    // 결제가 끝난 왕복 중에 노 출력을 바꾸면 화면에 띄운 위험·비용이 실제 판정과 달라진다.
    if (this.spinning || this.busy) return;
    this.heat = heat;
    this.render();
  }

  /**
   * 어픽스 고착(굴림당 1개, 해제 불가). 상태기계가 무시하면(`next === chain`) 아무 일도 없다.
   * 완주 판정은 **여기서** 한다 — 굴림은 고착 수를 바꾸지 않으므로 `RollOutcome.complete` 는
   * "입력이 이미 완주였다"는 뜻일 뿐이다(레인 C 계약 §1).
   */
  private fasten(index: number): void {
    if (this.spinning || this.busy) return;
    const chain = this.chain;
    if (chain === null) return;
    const next = fastenAffix(chain, index);
    if (next === chain) return; // 무시됨(범위 밖·중복·굴림 전) — 참조 비교가 판별식이다.
    this.chain = next;
    if (isComplete(next)) {
      this.hint = t('refine.chain.complete');
      this.startFx('complete');
      return;
    }
    this.hint = '';
    this.render();
  }

  /** 공정 멈추기 — 현재 상태를 확정하고 새 공정을 연다(고착·위험이 0으로 돌아간다). */
  private stopRefining(): void {
    if (this.spinning || this.busy) return;
    const item = this.selected();
    if (item === undefined) return;
    this.chain = openChain(item);
    this.hint = '';
    this.render();
  }

  /**
   * 굴림 1회. 현재 선택된 노 출력을 쓴다.
   * ⚠️ 메서드 이름은 회귀 테스트가 캐스팅으로 직접 부른다. 바꾸지 마라.
   */
  private async reroll(): Promise<void> {
    const item = this.selected();
    // 동시(재진입) 클릭 가드: `spinning` 은 await 뒤에야 세워지므로 서버 왕복 창은 `busy` 로 막는다.
    if (item === undefined || this.spinning || this.busy) return;
    // 공정 상태는 **선택된 장비의 것이어야 한다.** 외부 경로(main.ts 의 직접 `hide()`·하네스·
    // 테스트)가 선택을 바꿔 둘이 갈리면, 이 chain 으로 굴린 결과가 남의 슬롯에 쓰여 장비가
    // 사라지고 id 가 중복된다. 갈렸으면 선택된 장비로 공정을 다시 연다.
    let chain = this.chain;
    if (chain === null || chain.baseline.id !== item.id) {
      chain = openChain(item);
      this.chain = chain;
    }
    // 완주 후 굴림은 얻을 것이 0인데 위험은 최댓값이다. 상태기계도 막지만 여기서도 막는다(이중 방어).
    if (isComplete(chain)) return;

    // 노 출력을 **진입 시점에 스냅샷**한다 — 비용과 굴림 판정이 반드시 같은 값을 써야 한다.
    const heat = this.heat;
    const cost = this.currentCost(heat);
    if (!canAfford(this.profile.minerals, cost)) {
      this.hint = t('refine.err.noMinerals', { n: cost });
      this.render();
      return;
    }
    // 네트워크 창을 잠근다 — spend 확정 후에는 `spinning` 이 재진입을 막으므로 여기서만 유효하면 된다.
    this.busy = true;
    try {
      // 재화 서버 권위(ADR-0027): 온라인이면 spend_currency 로 광물 차감을 확정(ok 일 때만 굴림),
      // 미설정이면 기존 로컬 차감. 잔액 부족·오프라인(rejected)이면 굴리지도 용해하지도 않는다.
      const res = await spendCurrencyOnServer(0, cost, 'reroll');
      if (res.status === 'ok') {
        this.profile.credits = res.creditsLeft;
        this.profile.minerals = res.mineralsLeft;
      } else if (res.status === 'unconfigured') {
        this.profile.minerals -= cost;
      } else if (res.reason === 'insufficient') {
        // 서버 원장이 판정해 거부했다. 로컬 미러는 치트·오프라인 가산으로 부풀 수 있으므로
        // **서버 잔액을 그대로 보여준다** — "광물이 부족합니다" 한 줄만 내면 광물을 잔뜩 든
        // 유저에게 거짓말이 된다(격납고 창고 확장에서 실제로 신고된 오탐과 같은 부류).
        this.hint = t('spend.err.rejectedMinerals', { n: cost, have: res.mineralsLeft });
        this.render();
        return;
      } else {
        // 판정 자체를 못 받았다(오프라인·네트워크 오류). 차감도 굴림도 용해도 없다.
        this.hint = t('spend.err.unavailable');
        this.render();
        return;
      }

      // ⚠️ 여기서부터 "떠날 때의 세계"를 믿지 않는다. 가드는 창을 좁힐 뿐 없애지 못한다 —
      //    `main.ts` 는 `close()` 를 거치지 않고 `hide()` 를 직접 부르고, 하네스·테스트는
      //    메서드를 직접 찌른다. 그래서 복귀 직후에 다시 확인한다.
      const stillSame = this.selectedId === item.id;
      const stillVisible = this.root.visible;

      // 굴림 시드·용해 주사위는 UI 레이어에서 만든다(sim 밖이라 Math.random 자유).
      const seed = (Math.random() * 0xffffffff) >>> 0;
      const riskRoll = Math.random();
      const outcome = rollChain(chain, heat, seed, riskRoll);

      // 인벤토리 반영·저장은 **무조건** 한다 — 이 장비의 굴림 값을 이미 지불했으므로 결과를
      // 삼키면 안 된다. **연출보다 먼저**여야 한다(ADR-0040 §결과 확정과 연출의 순서).
      const idx = this.profile.inventory.findIndex((it) => it.id === item.id);
      if (idx >= 0) this.profile.inventory[idx] = outcome.next.current;
      this.persist();

      // 화면 상태 갱신은 아직 같은 장비를 보고 있을 때만. 다르면 chain 을 덮어쓰지 않는다 —
      // 덮어쓰면 selectedId 와 chain 이 갈려 다음 굴림이 남의 슬롯에 쓴다(장비 영구 소실의 뿌리).
      if (!stillSame) return;
      this.chain = outcome.next;
      this.hint = outcome.melted ? t('refine.chain.melted') : '';
      // 이미 나간 화면에서 연출을 시작하면 Ticker·setInterval 이 샌다(render 누수).
      if (stillVisible) this.startFx(outcome.melted ? 'melt' : 'spin');
    } finally {
      this.busy = false;
    }
  }

  private itemName(item: Item): string {
    return itemDisplayName(item);
  }

  private affixText(item: Item, i: number): string {
    const a = item.affixes[i];
    if (a === undefined) return '';
    return affixTitleLine(a);
  }

  /** 값 범위가 퇴화(`min === max`)인 어픽스인가 — 노 출력 밴드가 값을 못 바꾼다. */
  private isDegenerate(item: Item, i: number): boolean {
    const a = item.affixes[i];
    if (a === undefined) return false;
    const def = AFFIX_BY_ID.get(a.id);
    return def !== undefined && def.min === def.max;
  }

  // --- 연출(render-only) ---------------------------------------------------

  /**
   * 연출을 시작한다. **호출 시점에 결과는 이미 확정·저장돼 있다** — 여기서 결과가 바뀌는 일은
   * 없고, 바뀌게 만들지도 마라(새로고침으로 나쁜 롤을 무를 수 없는 근거가 그 순서다).
   */
  private startFx(kind: FxKind): void {
    this.stopSpin();
    this.fx = { kind, ticks: 0 };
    this.spinning = true;
    this.render();
    const total = FX_FRAMES[kind];
    this.spinTimer = setInterval(() => {
      const fx = this.fx;
      if (fx === null) {
        this.stopSpin();
        return;
      }
      fx.ticks++;
      if (fx.ticks >= total) {
        this.stopSpin();
        this.render();
        return;
      }
      if (fx.kind === 'spin') this.renderSpinFrame();
      else this.updateFxOverlay();
    }, 70);
  }

  /** 슬롯머신 프레임: 고착되지 않은 어픽스 행 문구를 무작위 어픽스 이름으로 덮어쓴다. */
  private renderSpinFrame(): void {
    for (const label of this.spinTexts) {
      if (label === null || label === undefined || label.destroyed) continue;
      const def = AFFIXES[(Math.random() * AFFIXES.length) | 0];
      if (def === undefined) continue;
      label.scale.x = 1;
      label.text = `${def.name} (${def.stat} +?)`;
    }
  }

  /** 용해·완주 플래시: 짧고 명확하게 사라진다(반복 피로 방지 — 용해는 자주 본다). */
  private updateFxOverlay(): void {
    const o = this.fxOverlay;
    const fx = this.fx;
    if (o === null || o.destroyed || fx === null) return;
    o.alpha = Math.max(0, 0.45 * (1 - fx.ticks / FX_FRAMES[fx.kind]));
  }

  /**
   * 열기 후광 + 미세 진동을 프레임 구동한다. 위험이 오를수록 짙고 크게 흔들린다 —
   * 정련 연출의 무게중심은 결과 공개가 아니라 **누르기 전 긴장**이다(ADR-0040).
   *
   * 프레임 루프가 없는 환경(node 테스트·SSR)에서는 아예 구독하지 않는다(button.ts 와 동형).
   * 광과민 대응(`reducedMotion`)이면 정적 세기로 한 번만 칠하고 끝낸다.
   */
  private startHeatAnim(): void {
    if (this.haloTicking) return;
    if (typeof requestAnimationFrame !== 'function') return;
    if (graphicsSettings.getSettings().reducedMotion) return;
    this.haloTicking = true;
    Ticker.shared.add(this.onHeatFrame);
  }

  private stopHeatAnim(): void {
    this.heatHalo = null;
    this.rollNode = null;
    if (!this.haloTicking) return;
    this.haloTicking = false;
    Ticker.shared.remove(this.onHeatFrame);
  }

  private readonly onHeatFrame = (ticker: Ticker): void => {
    const halo = this.heatHalo;
    const node = this.rollNode;
    if ((halo === null || halo.destroyed) && (node === null || node.destroyed)) {
      this.stopHeatAnim();
      return;
    }
    this.haloPhase += ticker.deltaMS / 1000;
    const risk = this.currentRisk();
    if (halo !== null && !halo.destroyed) {
      halo.alpha = Math.max(0, 0.18 + 0.42 * risk + 0.12 * risk * Math.sin(this.haloPhase * 6));
    }
    if (node !== null && !node.destroyed) {
      const amp = 2.6 * risk;
      node.position.set(
        this.rollBase.x + Math.sin(this.haloPhase * 23) * amp,
        this.rollBase.y + Math.cos(this.haloPhase * 31) * amp,
      );
    }
  };

  // --- 툴팁 ----------------------------------------------------------------

  private showTip(item: Item, globalX: number, globalY: number): void {
    // 툴팁은 제목 + 설명 2줄 묶음(목록 행은 한 줄짜리 affixText 그대로).
    const lines = affixLines(item.affixes);
    this.showTipLines(this.itemName(item), item, lines, globalX, globalY);
  }

  private showTipLines(
    title: string,
    item: Item,
    lines: string[],
    globalX: number,
    globalY: number,
  ): void {
    const p = this.root.toLocal({ x: globalX, y: globalY });
    this.tooltip.show(
      {
        title,
        titleColor: RARITY_COLOR_NUM[item.rarity],
        subtitle: `${slotLabel(item.slot)} · ${t(`item.rarity.${item.rarity}` as MessageKey)}`,
        lines,
      },
      p.x,
      p.y,
      RARITY_COLOR_NUM[item.rarity],
    );
    this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
  }

  private moveTip(globalX: number, globalY: number): void {
    if (!this.tooltip.container.visible) return;
    const p = this.root.toLocal({ x: globalX, y: globalY });
    this.tooltip.container.position.set(
      Math.min(p.x + 14, DESIGN_WIDTH - this.tooltip.container.width),
      Math.min(p.y + 14, DESIGN_HEIGHT - this.tooltip.container.height),
    );
  }

  // --- 렌더 ----------------------------------------------------------------

  private render(): void {
    // 프레임 구동 참조가 이번 render 에서 전부 파괴되므로 먼저 끊는다(파괴된 노드 접근 방지).
    this.stopHeatAnim();
    this.fxOverlay = null;
    for (const child of [...this.root.children]) {
      if (child !== this.tooltip.container) {
        this.root.removeChild(child);
        child.destroy({ children: true });
      }
    }
    this.tooltip.hide();
    this.spinTexts = [];

    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static'; // 뒤로 이벤트가 새지 않게 막는다.
    this.root.addChildAt(bg, 0);

    this.renderTitleBar();
    this.renderListPanel();
    this.renderDetailPanel();
    this.renderActions();
    this.renderHint();

    this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
    if (this.currentRisk() > 0) this.startHeatAnim();
  }

  private renderTitleBar(): void {
    const banner = makeBanner(BANNER_W, BANNER_H, t('refine.title'), this.ui['ui_banner.png']);
    banner.position.set((DESIGN_WIDTH - BANNER_W) / 2, BANNER_Y);
    this.root.addChild(banner);

    const chipY = BANNER_Y + (BANNER_H - CHIP_H) / 2;
    const minerals = makeCurrencyChip(
      CHIP_W,
      CHIP_H,
      String(this.profile.minerals),
      this.ui['ui_chip.png'],
      this.ui['ui_icon_crystal.png'],
    );
    minerals.position.set((DESIGN_WIDTH - BANNER_W) / 2 - CHIP_W - 20, chipY);
    this.root.addChild(minerals);

    const credits = makeCurrencyChip(
      CHIP_W,
      CHIP_H,
      String(this.profile.credits),
      this.ui['ui_chip.png'],
      this.ui['ui_icon_coin.png'],
    );
    credits.position.set((DESIGN_WIDTH + BANNER_W) / 2 + 20, chipY);
    this.root.addChild(credits);

    const close = makeIconButton(
      56,
      () => this.close(),
      this.ui['ui_icon_close.png'],
    );
    close.position.set(DESIGN_WIDTH - 24 - 56, 12);
    this.root.addChild(close);
  }

  private close(): void {
    // 연출 중 이탈 금지 + 서버 왕복 중 이탈 금지(숨겨진 화면에서 Ticker·setInterval 이 샌다).
    // ⚠️ `main.ts` 는 화면 전환·런 시작에서 `close()` 를 거치지 않고 `hide()` 를 직접 부른다 —
    //    그래서 이 가드는 1차 방어일 뿐이고, 누수를 실제로 막는 것은 `reroll()` 의 `stillVisible` 이다.
    if (this.spinning || this.busy) return;
    const cb = this.onClose;
    this.hide();
    cb?.();
  }

  private panelTitle(parent: Container, text: string): void {
    const title = new Text({
      resolution: 2,
      text,
      style: { fontFamily: UI_FONT, fontSize: 26, fontWeight: '800', fill: COLOR.cream, dropShadow: TEXT_SHADOW },
    });
    title.position.set(BOX_L.x, TITLE_Y);
    parent.addChild(title);
  }

  private renderListPanel(): void {
    const panel = new Container();
    panel.position.set(PANEL_X0, PANEL_Y);
    this.root.addChild(panel);
    panel.addChild(nineSlicePanel(LIST_W, PANEL_H, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER }));

    const items = this.rerollable();
    this.panelTitle(panel, t('refine.listHeader', { n: items.length }));

    if (items.length === 0) {
      const empty = new Text({
        resolution: 2,
        text: t('refine.noItems'),
        style: {
          fontFamily: UI_FONT,
          fontSize: 20,
          fill: COLOR.muted,
          align: 'center',
          wordWrap: true,
          wordWrapWidth: BOX_L.w,
          dropShadow: TEXT_SHADOW,
        },
      });
      empty.anchor.set(0.5, 0);
      empty.position.set(LIST_W / 2, CONTENT_TOP + 60);
      panel.addChild(empty);
      return;
    }

    // 그리드는 콘텐츠 상자 안에서 가로 중앙 정렬(6열 × 셀 88).
    const contentX = BOX_L.x + Math.floor((BOX_L.w - GRID_W) / 2);
    const clip = new Container();
    clip.position.set(contentX, CONTENT_TOP);
    panel.addChild(clip);
    const mask = new Graphics();
    mask.rect(contentX, CONTENT_TOP, GRID_W, GRID_H).fill({ color: 0xffffff });
    panel.addChild(mask);
    clip.mask = mask;

    const content = new Container();
    clip.addChild(content);

    const positions = gridPositions(items.length, GRID_COLS, CELL, CELL_GAP);
    items.forEach((item, i) => {
      const isSel = item.id === this.selectedId;
      const cell = makeSlotCell({
        size: CELL,
        item,
        slotTex: this.ui[isSel ? 'ui_slot_hl.png' : 'ui_slot.png'],
        iconTex: equipIconTexture(this.ui, item),
        highlight: isSel,
        highlightTex: this.ui['ui_slot_hl.png'],
        onClick: () => this.select(item),
        onHover: (gx, gy) => this.showTip(item, gx, gy),
        onMove: (gx, gy) => this.moveTip(gx, gy),
        onOut: () => this.tooltip.hide(),
      });
      if (isSel) {
        // 선택 표시: 금색 링(등급색 테두리 바깥). 등급 시각 언어를 가리지 않는다.
        const ring = new Graphics();
        ring.roundRect(2, 2, CELL - 4, CELL - 4, 9).stroke({ color: COLOR.gold, width: 3, alignment: 1 });
        cell.addChild(ring);
      }
      const pos = positions[i];
      if (pos !== undefined) cell.position.set(pos.x, pos.y);
      content.addChild(cell);
    });

    const rows = Math.ceil(items.length / GRID_COLS);
    const total = rows * (CELL + CELL_GAP) - CELL_GAP;
    const maxScroll = Math.max(0, total - GRID_H);
    this.listScrollY = Math.min(this.listScrollY, maxScroll);
    content.y = -this.listScrollY;
    if (maxScroll > 0) {
      // 휠은 **클립 Container** 가 받는다 — 마스크로 쓰이는 Graphics 는 히트 테스트에서 제외돼
      // (`isMask`) 리스너가 영영 불리지 않는다(카드 화면 #7 에서 실측).
      clip.eventMode = 'static';
      clip.hitArea = new Rectangle(0, 0, GRID_W, GRID_H);
      clip.on('wheel', (e) => {
        this.listScrollY = Math.max(0, Math.min(maxScroll, this.listScrollY + e.deltaY));
        content.y = -this.listScrollY;
      });
    }
  }

  private renderDetailPanel(): void {
    const panel = new Container();
    panel.position.set(DETAIL_X, PANEL_Y);
    this.root.addChild(panel);
    panel.addChild(nineSlicePanel(DETAIL_W, PANEL_H, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER }));

    this.panelTitle(panel, t('refine.reroll'));

    const item = this.selected();
    if (item === undefined) {
      const prompt = new Text({
        resolution: 2,
        text: t('refine.selectPrompt'),
        style: {
          fontFamily: UI_FONT,
          fontSize: 20,
          fill: COLOR.muted,
          align: 'center',
          wordWrap: true,
          wordWrapWidth: BOX_D.w,
          dropShadow: TEXT_SHADOW,
        },
      });
      prompt.anchor.set(0.5, 0);
      prompt.position.set(DETAIL_W / 2, CONTENT_TOP + 60);
      panel.addChild(prompt);
      return;
    }

    const name = new Text({
      resolution: 2,
      text: this.itemName(item),
      style: {
        fontFamily: UI_FONT,
        fontSize: 30,
        fontWeight: '800',
        fill: RARITY_COLOR_NUM[item.rarity],
        dropShadow: TEXT_SHADOW,
      },
    });
    name.position.set(BOX_D.x, NAME_Y);
    panel.addChild(name);

    const sub = new Text({
      resolution: 2,
      text: `${slotLabel(item.slot)} · ${t(`item.rarity.${item.rarity}` as MessageKey)} · ${t('refine.chain.fastenHint')}`,
      style: {
        fontFamily: UI_FONT,
        fontSize: 17,
        fill: COLOR.muted,
        wordWrap: true,
        wordWrapWidth: BOX_D.w,
        dropShadow: TEXT_SHADOW,
      },
    });
    sub.position.set(BOX_D.x, SUB_Y);
    panel.addChild(sub);

    for (let i = 0; i < item.affixes.length; i++) {
      const row = this.makeAffixRow(item, i);
      row.position.set(BOX_D.x, AFFIX_TOP + i * AFFIX_STEP);
      panel.addChild(row);
    }

    const L = refineryDetailLayout(item.affixes.length);
    this.renderHeatRow(panel, L.heatY);
    this.renderCostRow(panel, item, L.costY);
    this.renderActionRow(panel, L.actionY);

    // 연출 오버레이는 패널 맨 위. 용해=붉음, 완주=금색. 알파는 프레임마다 줄어든다.
    const fx = this.fx;
    if (fx !== null && fx.kind !== 'spin') {
      const o = new Graphics();
      o.roundRect(BOX_D.x - 8, BOX_D.y - 8, BOX_D.w + 16, BOX_D.h + 16, 12)
        .fill({ color: fx.kind === 'melt' ? 0xd8452a : COLOR.gold });
      o.alpha = 0.45;
      o.eventMode = 'none';
      panel.addChild(o);
      this.fxOverlay = o;
    }
  }

  /** 노 출력 3버튼(라디오). 선택 표시는 금색 링 — `PixiButton` 에는 토글 상태가 없다. */
  private renderHeatRow(panel: Container, y: number): void {
    const rowW = HEATS.length * HEAT_W + (HEATS.length - 1) * HEAT_GAP;
    HEATS.forEach((heat, i) => {
      const skin = HEAT_SKIN[heat];
      const isSel = this.heat === heat;
      const btn = new PixiButton({
        texture: this.ui[skin.tex],
        fallbackColor: skin.fallback,
        width: HEAT_W,
        height: HEAT_H,
        fontSize: 21,
        ...(skin.dark ? { labelColor: COLOR.darkLabel } : {}),
        label: stripEmoji(t(`refine.chain.heat.${heat}` as MessageKey)),
        sound: 'uiNavigate',
        onClick: () => this.setHeat(heat),
      });
      const node = btn.container;
      node.position.set(BOX_D.x + i * (HEAT_W + HEAT_GAP), y);
      if (isSel) {
        const ring = new Graphics();
        ring.roundRect(2, 2, HEAT_W - 4, HEAT_H - 4, 9).stroke({ color: COLOR.gold, width: 3, alignment: 1 });
        node.addChild(ring);
      } else {
        node.alpha = 0.72; // 미선택은 한 톤 낮춰 대비를 준다(어픽스 행과 동일 기법).
      }
      panel.addChild(node);
      if (this.spinning) btn.setEnabled(false);
    });

    // 노 출력 설명은 버튼 오른쪽 남는 폭에 접어 넣는다(세로를 더 먹지 않는다).
    const hintX = BOX_D.x + rowW + 16;
    const hintW = BOX_D.right - hintX;
    if (hintW >= 120) {
      const hint = new Text({
        resolution: 2,
        text: t('refine.chain.heat.hint'),
        style: {
          fontFamily: UI_FONT,
          fontSize: 15,
          fill: COLOR.muted,
          wordWrap: true,
          wordWrapWidth: hintW,
          dropShadow: TEXT_SHADOW,
        },
      });
      hint.position.set(hintX, y);
      panel.addChild(hint);
    }
  }

  /**
   * 비용 + 위험 + 고착 수를 **한 줄에** 합친다(세로 −28px). 위험은 고착이 0개면
   * 표시 자체를 숨긴다 — 위험이 없다는 사실이 시각적으로도 없어야 한다.
   */
  private renderCostRow(panel: Container, item: Item, y: number): void {
    const risk = this.currentRisk();
    const costText =
      risk > 0
        ? `${t('refine.chain.cost', { n: this.currentCost() })} · ${t('refine.chain.risk', { n: Math.round(risk * 100) })}`
        : t('refine.chain.cost', { n: this.currentCost() });
    const cost = new Text({
      resolution: 2,
      text: costText,
      style: {
        fontFamily: UI_FONT,
        fontSize: 20,
        fontWeight: '700',
        // 위험이 붙으면 색도 함께 뜨겁게 — 숫자를 읽지 않아도 상태가 읽힌다.
        fill: risk > 0 ? 0xff9a5a : COLOR.gold,
        dropShadow: TEXT_SHADOW,
      },
    });
    cost.position.set(BOX_D.x, y);
    panel.addChild(cost);

    const fastened = new Text({
      resolution: 2,
      text: t('refine.chain.fastenedCount', { n: this.fastenedCount(), total: item.affixes.length }),
      style: { fontFamily: UI_FONT, fontSize: 18, fontWeight: '700', fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    fastened.anchor.set(1, 0);
    fastened.position.set(BOX_D.right, y + 2);
    panel.addChild(fastened);
  }

  /** 굴리기 + 공정 멈추기를 **같은 행에** 좌우로(세로 −60px). 멈추기는 고착 ≥ 1 일 때만. */
  private renderActionRow(panel: Container, y: number): void {
    const showStop = this.fastenedCount() >= 1;
    const totalW = showStop ? ROLL_W + ACTION_GAP + STOP_W : ROLL_W;
    const x0 = BOX_D.x + Math.max(0, Math.floor((BOX_D.w - totalW) / 2));

    // 열기 후광은 버튼 **뒤**에 먼저 그린다(위험이 오를수록 짙어진다).
    const risk = this.currentRisk();
    if (risk > 0) {
      const halo = new Graphics();
      halo.roundRect(x0 - 14, y - 14, ROLL_W + 28, ROLL_H + 28, 18).fill({ color: 0xff6a2a });
      halo.alpha = 0.18 + 0.42 * risk;
      halo.eventMode = 'none';
      panel.addChild(halo);
      this.heatHalo = halo;
    }

    const chain = this.chain;
    const complete = chain !== null && isComplete(chain);
    const roll = new PixiButton({
      texture: this.ui['ui_btn_yellow.png'],
      fallbackColor: 0x9a7a2a,
      width: ROLL_W,
      height: ROLL_H,
      fontSize: 24,
      // 노란 버튼은 바탕이 밝아 흰 라벨이 묻힌다(기지 맵·연구소와 동일 처리).
      labelColor: COLOR.darkLabel,
      label: stripEmoji(this.spinning ? t('refine.spinning') : t('refine.chain.rollBtn')),
      sound: 'uiConfirm',
      onClick: () => void this.reroll(),
    });
    roll.container.position.set(x0, y);
    panel.addChild(roll.container);
    this.rollNode = roll.container;
    this.rollBase = { x: x0, y };
    // 완주 후 굴림은 순수 손해라 막는다(상태기계도 막는다 — 이중 방어이지 둘 중 하나가 아니다).
    if (this.spinning || complete || !canAfford(this.profile.minerals, this.currentCost())) {
      roll.setEnabled(false);
    }

    if (!showStop) return;
    const stop = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: STOP_W,
      height: ROLL_H,
      fontSize: 21,
      label: stripEmoji(t('refine.chain.stop')),
      sound: 'uiPositive',
      onClick: () => this.stopRefining(),
    });
    stop.container.position.set(x0 + ROLL_W + ACTION_GAP, y);
    panel.addChild(stop.container);
    if (this.spinning) stop.setEnabled(false);
  }

  /** 어픽스 한 행: 칩 9-slice + 어픽스 문구 + 고착 버튼(또는 고착됨 표시). */
  private makeAffixRow(item: Item, index: number): Container {
    const chain = this.chain;
    const isFastened = chain !== null && chain.fastened.indexOf(index) >= 0;
    const canFasten = chain !== null && chain.canFasten && !isFastened && !this.spinning;
    const row = new Container();
    const w = BOX_D.w;

    const chipTex = this.ui['ui_chip.png'];
    if (chipTex) {
      const bg = new NineSliceSprite({ texture: chipTex, leftWidth: 24, topHeight: 0, rightWidth: 24, bottomHeight: 0 });
      bg.width = w;
      bg.height = AFFIX_H;
      row.addChild(bg);
    } else {
      const g = new Graphics();
      g.roundRect(0, 0, w, AFFIX_H, 10).fill({ color: 0x2a2440 }).stroke({ color: 0x000000, width: 2, alpha: 0.5 });
      row.addChild(g);
    }

    if (isFastened) {
      const ring = new Graphics();
      ring.roundRect(2, 2, w - 4, AFFIX_H - 4, 9).stroke({ color: COLOR.gold, width: 3, alignment: 1 });
      row.addChild(ring);
    } else if (this.fastenedCount() > 0) {
      // 고착된 행이 눈에 띄도록 나머지는 한 톤 낮춘다(나무 칩끼리는 금색 링만으로 약하다).
      row.alpha = 0.82;
    }

    const btnW = 104;
    const btnH = 32;
    const iconSize = 30;
    // 오른쪽 끝 요소(고착 버튼 또는 잠김 아이콘)가 시작하는 x.
    const rightX = isFastened ? w - 16 - iconSize : w - 16 - btnW;

    const label = new Text({
      resolution: 2,
      text: this.affixText(item, index),
      style: {
        fontFamily: UI_FONT,
        fontSize: 18,
        fontWeight: '700',
        fill: this.spinning && !isFastened ? COLOR.muted : isFastened ? COLOR.gold : COLOR.cream,
        dropShadow: TEXT_SHADOW,
      },
    });
    label.anchor.set(0, 0.5);
    label.position.set(18, AFFIX_H / 2);
    // 긴 어픽스 문구가 오른쪽 요소와 겹치지 않게 가로만 축소한다(잘라내면 무슨 어픽스인지 모른다).
    const maxLabelW = rightX - 12 - 18;
    try {
      if (label.width > maxLabelW) label.scale.x = maxLabelW / label.width;
    } catch {
      /* 캔버스 없는 환경(node 테스트)에서는 측정이 던진다 — 축소는 순수 장식이라 건너뛴다. */
    }
    row.addChild(label);
    this.spinTexts[index] = isFastened ? null : label;

    if (isFastened) {
      const lock = makeIconButton(iconSize, () => {}, this.ui['ui_lock.png'], '🔒');
      lock.eventMode = 'none'; // 고착은 해제 불가 — 눌러도 되는 것처럼 보이면 안 된다.
      lock.position.set(rightX, (AFFIX_H - iconSize) / 2);
      row.addChild(lock);
    } else {
      const btn = new PixiButton({
        texture: this.ui['ui_btn_wood.png'],
        fallbackColor: 0x4a3a24,
        width: btnW,
        height: btnH,
        fontSize: 17,
        label: stripEmoji(t('refine.chain.fasten')),
        sound: 'uiPositive',
        onClick: () => this.fasten(index),
      });
      btn.container.position.set(rightX, (AFFIX_H - btnH) / 2);
      row.addChild(btn.container);
      if (!canFasten) btn.setEnabled(false);
    }

    // 퇴화 범위 어픽스(min === max)는 강불로 굴려도 값이 안 변한다 — 그게 정상임을 알린다.
    if (this.isDegenerate(item, index)) {
      row.eventMode = 'static';
      row.cursor = 'help';
      row.on('pointerover', (e) =>
        this.showTipLines(this.affixText(item, index), item, [t('refine.chain.noBand')], e.global.x, e.global.y),
      );
      row.on('pointermove', (e) => this.moveTip(e.global.x, e.global.y));
      row.on('pointerout', () => this.tooltip.hide());
    }

    return row;
  }

  private renderActions(): void {
    const back = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: BACK_W,
      height: BACK_H,
      fontSize: 22,
      label: t('common.backToBase'),
      onClick: () => this.close(),
    });
    back.container.position.set((DESIGN_WIDTH - BACK_W) / 2, BACK_Y);
    this.root.addChild(back.container);
    if (this.spinning) back.setEnabled(false);
  }

  private renderHint(): void {
    if (this.hint === '') return;
    const h = new Text({
      resolution: 2,
      text: this.hint,
      style: { fontFamily: UI_FONT, fontSize: 20, fontWeight: '700', fill: 0xff9a7a, dropShadow: TEXT_SHADOW },
    });
    h.anchor.set(0.5, 1);
    h.position.set(DESIGN_WIDTH / 2, DESIGN_HEIGHT - 12);
    this.root.addChild(h);
  }
}
