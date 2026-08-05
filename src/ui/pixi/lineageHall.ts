/**
 * 계보 전당 화면 — Pixi (ADR-0007 · 2026-08-03 AAA 시네마틱).
 *
 * 격납고에서 진입하는 **하위 화면**이다(챔피언 선택·예비역 로스터·촉매 보관함과 동일
 * suspend/resume 규약). 퇴역(기본 지급)·소멸(성능 비례 회수)로 모은 계보 포인트를 **쓰는 유일한
 * 플레이어 표면**이다 — 이 화면이 생기기 전까지 `investLineageBranch` 의 호출부는 치트 패널
 * 하나뿐이었고, 플레이어는 포인트를 모으기만 하고 쓸 자리가 없었다.
 *
 * ## 왜 격납고 하위 화면인가
 * 기체 가지는 **현역 기체**를 강화하고(로드아웃 빌드 시 외부 적용), 수호 가지는 **예비역 수호기
 * 전원**을 강화한다. 두 대상이 모두 격납고 소관이고, 포인트를 회수하는 로스터가 바로 옆 형제
 * 화면이라 "소멸 → 회수 → 투자" 동선이 한 화면 전환 안에서 닫힌다.
 *
 * ## 되돌릴 수 없다 — 확인 팝업은 선택이 아니라 규율이다
 * 계보에는 **리스펙이 없다**(ADR-0007 R2 — 순환 재화). 한번 쓴 포인트는 영영 그 가지에 묶인다.
 * 그래서 로스터의 소멸 확인 팝업과 **같은 규율**을 그대로 승계한다: 완전 불투명 암막(0.92) ·
 * 암막이 이벤트를 먹는다 · 패널 안쪽 탭은 전파를 끊는다.
 *
 * ## 세 패널이 각각 다른 일을 한다 — 같은 수를 두 번 적지 않는다
 * 로스터는 목록이 무제한이라 "목록 + 상세"가 필요했지만 계보의 가지는 **정확히 둘**이다. 상세
 * 패널을 따로 두면 좌우가 같은 수를 두 번 적는 화면이 된다. 대신 셋으로 나눈다:
 *   - 좌: 두 가지 판 — 이름·현재 보너스 막대·다음 레벨이 사는 것·[투자].
 *   - 우상: 계보 포인트(이 화면의 화폐) — 큰 숫자 · 용도 · **리스펙 없음 경고** · 직전 결과.
 *   - 우하: 수호 가지 마일스톤 3종 — 레벨 도달만으로 자동 해금되는 질적 노드라 "다음에 무엇이
 *     열리는가"가 투자 판단의 절반이다. 보너스 곡선(연속)이 말해 주지 못하는 정보다.
 *
 * ## 막대는 두 색이다 — 지금과 **이 투자가 사는 것**
 * 로그 점근 곡선(+50% 상한)은 숫자만으로는 "다음 1레벨이 얼마나 남았나"가 안 읽힌다. 채운 막대
 * 위에 다음 레벨 증가분을 옅은 유령 구간으로 겹쳐, 되돌릴 수 없는 지출이 사는 것을 눈으로 잰다.
 *
 * ## 시각 언어 — 나무는 은퇴했다
 * `makeCinematicPanel`(석재 슬래브) · `makeHangarTitle` · `cinematicButtonTexture`.
 * `ui_panel.png`·`ui_btn_*.png` 는 쓰지 않는다.
 *
 * ## 재렌더 규율
 * `buildChrome()` 은 1회(배경·패널·헤더), `syncBranches()` 가 값만 갈아끼운다. 투자 한 번에
 * 1376×768 배경과 석재 패널을 다시 굽지 않는다.
 *
 * 순수 render/UI 레이어(ADR-0005 · ADR-0014) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { saveProfile, type KeyValueStore, type Profile } from '../../save/profile.js';
import { investLineageOnServer, isLineageOnline, pullLineageState } from '../../net/lineage.js';
import { applyServerInvest, applyServerLineageState } from '../../net/lineageMirror.js';
import {
  branchBonusBp,
  branchInvestedPoints,
  canInvest,
  guardianMilestones,
  hasMilestone,
  nextLevelCost,
  CORE_GUARD_LEVEL,
  LINEAGE_BONUS_CAP_BP,
  MILESTONE_CORE_GUARD,
  MILESTONE_REBOOT,
  MILESTONE_SHIELD_SHARE,
  REBOOT_LEVEL,
  SHIELD_SHARE_LEVEL,
  type LineageBranch,
  type LineageState,
} from '../../../data/lineage.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { PixiButton } from './button.js';
import { stopRowPropagation } from './listRow.js';
import { t, type MessageKey } from '../../i18n/index.js';
import { loadHangarTextures, HANGAR_BACKDROP_NAME, type HangarTextures } from './hangarTextures.js';
import { HangarBackdrop } from './hangarBackdrop.js';
import { makeCinematicPanel, type CinematicPanel } from './cinematicPanel.js';
import { HELP_HEAD_W, openHelpOverlay, type HelpSpec } from './helpModal.js';
import {
  makeHangarTitle,
  cinematicButtonTexture,
  chromeFallbackColor,
  chromeLabelColor,
  type ChromeTone,
} from './hangarChrome.js';

// ---------------------------------------------------------------------------
// 레이아웃(디자인 스페이스 1920×1080)
//
// 여백 어휘(32 / 28 / 20 / 하단 28)와 헤더 높이 104 는 격납고·로스터·촉매 보관함과 **같은
// 값**이다. 형제 화면끼리 다르면 전환에서 튄다.
// ---------------------------------------------------------------------------

const HEADER_H = 104;
/** 헤더 컨트롤의 세로 띠 — 전부 이 하나를 쓴다(격납고 헤더 겹침 결함 이력). */
const HEAD_Y = 26;
const HEAD_H = 52;
const EDGE_X = 32;
const GUTTER_X = 28;

const MAIN_X = EDGE_X;
const MAIN_Y = HEADER_H + 8;
const MAIN_W = 1150;
const MAIN_H = 940;
const SIDE_X = MAIN_X + MAIN_W + GUTTER_X;
const SIDE_W = DESIGN_WIDTH - EDGE_X - SIDE_X;
const POINTS_Y = MAIN_Y;
/**
 * 포인트 패널 높이는 **콘텐츠가 정한다**: 큰 숫자(68px) + 용도 1줄 + 경고 2줄 + 결과 문구.
 * 로스터의 계보 패널이 같은 내용을 232 로 담다가 문구가 가운데서 겹쳤던 이력이 있어(양쪽에서
 * 쌓으면 세로가 짧을 때 겹침이 구조적으로 생긴다) 여기서는 예산을 넉넉히 준다.
 *
 * 320 에서 348 로 올린 이유: 실화면에서 KO 경고(2줄) 바닥과 결과 문구 사이가 30px 밖에 안 남아,
 * 경고가 3줄이 되는 EN 로케일이면 여유가 6px 로 줄어든다. 겹침은 로케일이 바뀔 때만 드러나
 * 눈으로도 못 잡는 유형이라 예산으로 막는다.
 */
const POINTS_H = 348;
const ROW_GAP_Y = 20;
const MS_Y = POINTS_Y + POINTS_H + ROW_GAP_Y;
/** 마일스톤 패널 바닥은 가지 패널 바닥과 **같아야** 한다 — 파생으로 강제한다(하드코딩 금지). */
const MS_H = MAIN_Y + MAIN_H - MS_Y;

/** 헤더 닫기 한 변. */
const CLOSE_W = 56;
/** 헤더 컨트롤 사이 틈 · 도움말 버튼 x(여섯 화면 공통 자리 · {@link HELP_HEAD_W} 주석). */
const HEAD_GAP = 12;
const CLOSE_X = DESIGN_WIDTH - EDGE_X - CLOSE_W;
const HELP_X = CLOSE_X - HEAD_GAP - 2 - HELP_HEAD_W;

/** 계보 전당 도움말 절 목록. 기구는 공용 모듈이 쥔다 — 여기서는 무엇을 말할지만 정한다. */
export const LINEAGE_HELP: HelpSpec = {
  prefix: 'lineage.help',
  sections: ['s1', 's2', 's3', 's4'],
};

/**
 * 좌상단 예약 밴드 — `main.ts` SettingsScreen 의 설정 톱니가 쓰는 **전 화면 공용 자리**다.
 * 톱니는 매 프레임 stage 최상위로 올라오므로, 여기에 컨트롤을 두면 통째로 클릭 불가가 된다.
 */
export const GEAR_BAND_W = 120;
export const GEAR_BAND_H = 120;

/** 화면 좌표 사각형(디자인 스페이스). */
export interface LineageHallRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 이 화면의 레이아웃 전량 — **Pixi 없이 검증되는 순수 서술**이다(로스터 선례).
 *
 * 캔버스 없는 vitest 는 화면을 세울 수 없어 겹침·이탈은 눈으로만 잡히는 유형이 된다. 좌표를
 * 순수 값으로 꺼내 두면 단위 테스트가 잠근다(`tests/lineageHallLayout.test.ts`).
 */
export function lineageHallLayout(): {
  readonly screen: LineageHallRect;
  readonly headerH: number;
  readonly panels: readonly {
    readonly id: 'branches' | 'points' | 'milestones';
    readonly rect: LineageHallRect;
  }[];
  readonly headerControls: readonly { readonly id: string; readonly rect: LineageHallRect }[];
} {
  const closeX = CLOSE_X;
  return {
    screen: { x: 0, y: 0, w: DESIGN_WIDTH, h: DESIGN_HEIGHT },
    headerH: HEADER_H,
    panels: [
      { id: 'branches', rect: { x: MAIN_X, y: MAIN_Y, w: MAIN_W, h: MAIN_H } },
      { id: 'points', rect: { x: SIDE_X, y: POINTS_Y, w: SIDE_W, h: POINTS_H } },
      { id: 'milestones', rect: { x: SIDE_X, y: MS_Y, w: SIDE_W, h: MS_H } },
    ],
    headerControls: [
      { id: 'help', rect: { x: HELP_X, y: HEAD_Y, w: HELP_HEAD_W, h: HEAD_H } },
      { id: 'close', rect: { x: closeX, y: HEAD_Y, w: CLOSE_W, h: HEAD_H } },
    ],
  };
}

/** 가지 판 사이 틈. 판 높이는 패널 콘텐츠 상자에서 **파생**한다(하드코딩 금지). */
const BRANCH_GAP = 24;
/** 제목 띠와 첫 판 사이 숨 — 붙여 놓으면 판이 띠에서 흘러나온 것처럼 읽힌다. */
const BRANCH_TOP_PAD = 10;

const PLATE_RADIUS = 10;
const PLATE_PAD_X = 18;

/** 투자 버튼(우측 컨트롤 열). */
const INVEST_W = 220;
const INVEST_H = 60;
const CTRL_PAD = 20;

/** 보너스 막대. */
const BAR_H = 22;
/** 마일스톤 진행 막대 — 가지 막대보다 얇다(주인공이 아니다). */
const MS_BAR_H = 12;

const CONFIRM_W = 780;
/** 팝업 높이 — 본문 3줄(EN 로케일 최악) + 바닥 버튼 띠. 로스터 팝업과 같은 예산. */
const CONFIRM_H = 300;

/**
 * 석재 슬래브 위 **보조 텍스트색**. `hangar.ts` 의 `SLAB_BODY_FILL` 복제다(레인 계약 "복제하고
 * 헤더에 출처를 밝혀라" — 그 파일은 화면이지 공용 모듈이 아니다).
 *
 * 옛 `COLOR.muted`(#aa9b87)는 슬래브 면 동작점이 L* 19 → 28 로 올라가면서 대비 3.00:1 로 WCAG
 * AA 미달이 됐다. 배경을 도로 어둡게 하면 "화면 과반이 평평한 암면"이 되돌아오므로 전경만 올린다.
 */
const SLAB_BODY_FILL = 0xe4dac7;

/** 경고 문구색 — 투자는 되돌릴 수 없다. 붉은 계열이되 슬래브 위에서 읽히는 밝기로. */
const WARN_FILL = 0xffa98a;

/** 판 바탕색·홈 — 촉매 보관함/로스터 `rowPlate` 복제(형제 화면끼리 행 어휘가 갈리면 안 된다). */
const PLATE_FACE = 0x3b3327;
const PLATE_GROOVE = 0x17130d;

/** 막대: 채운 구간(현재) · 유령 구간(이번 투자가 사는 것) · 홈. */
const BAR_GROOVE = 0x1b1710;
const BAR_GHOST = 0x8affc0;

/** 해금된 마일스톤 · 잠긴 마일스톤 글자색. */
const MS_ON = 0x8affc0;
const MS_OFF = 0x9a8d78;

// --- 판 조명 램프(모듈 1회 굽기) ---------------------------------------------

/**
 * 판의 **방향성 조명**을 위한 세로 알파 램프.
 *
 * ⚠️ 띠를 겹쳐 그라디언트를 근사하지 않는다 — 1px 겹침이 알파를 두 배로 만들어 가로줄이 생긴다
 * (실제 사용자 신고). 폭 1px 캔버스에 픽셀로 굽고 `linear` 로 늘린다.
 * (촉매 보관함 → 로스터 `rowRamp` 복제. 화면 파일이라 import 하지 않는다.)
 */
let rampTex: Texture | null | undefined;

function plateRamp(): Texture | null {
  if (rampTex !== undefined) return rampTex;
  // ⚠️ 이 가드는 **캔버스를 굽는 함수에만** 붙인다. DOM 조회(`hudEl`)에 붙이면 HUD 숨김이 죽는다.
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    rampTex = null;
    return null;
  }
  try {
    const n = 64;
    const cv = document.createElement('canvas');
    cv.width = 1;
    cv.height = n;
    const ctx = cv.getContext('2d');
    if (ctx === null) {
      rampTex = null;
      return null;
    }
    const img = ctx.createImageData(1, n);
    for (let i = 0; i < n; i++) {
      const u = 1 - i / (n - 1);
      const a = Math.round(255 * u * u);
      img.data[i * 4] = 255;
      img.data[i * 4 + 1] = 255;
      img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
    rampTex = Texture.from(cv);
    return rampTex;
  } catch {
    rampTex = null;
    return null;
  }
}

/**
 * 판 한 장의 바탕 — 2단 접지 그림자 + 석재 면 + 방향성 램프 + 안쪽 어두운 홈.
 * **선은 긋지 않는다.** 판 구분은 그림자와 간격이 만든다(형제 화면 규약).
 */
function plateBack(w: number, h: number): Container {
  const root = new Container();

  const diffuse = new Graphics();
  diffuse.roundRect(-3, 6, w + 6, h, PLATE_RADIUS + 3).fill({ color: 0x000000, alpha: 0.22 });
  root.addChild(diffuse);
  const contact = new Graphics();
  contact.roundRect(1, 3, w - 2, h, PLATE_RADIUS).fill({ color: 0x000000, alpha: 0.3 });
  root.addChild(contact);

  const face = new Graphics();
  face.roundRect(0, 0, w, h, PLATE_RADIUS).fill({ color: PLATE_FACE });
  root.addChild(face);

  const ramp = plateRamp();
  if (ramp !== null) {
    const clip = new Container();
    const mask = new Graphics();
    mask.roundRect(0, 0, w, h, PLATE_RADIUS).fill({ color: 0xffffff });
    clip.addChild(mask);
    clip.mask = mask;

    const lit = new Sprite(ramp);
    lit.width = w;
    lit.height = h;
    lit.alpha = 0.11;
    clip.addChild(lit);

    const shade = new Sprite(ramp);
    shade.width = w;
    shade.height = h;
    shade.tint = 0x000000;
    shade.alpha = 0.3;
    shade.scale.y = -Math.abs(shade.scale.y);
    shade.y = h;
    clip.addChild(shade);

    root.addChild(clip);
  }

  const groove = new Graphics();
  groove
    .roundRect(0, 0, w, h, PLATE_RADIUS)
    .stroke({ color: PLATE_GROOVE, width: 2, alignment: 1, alpha: 0.85 });
  root.addChild(groove);

  return root;
}

// --- 순수 파생 --------------------------------------------------------------

/** basis-point → 퍼센트 표시 문자열(소수 2자리, 정수면 꼬리 없음). */
export function bpPct(bp: number): string {
  const v = bp / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/**
 * 한 가지의 화면 표시값 전량 — **순수**다. 되돌릴 수 없는 지출을 보여 주는 수라 여기서 잠근다
 * (`tests/lineageHallLayout.test.ts`).
 *
 * `ratio`/`nextRatio` 는 상한(+50%) 대비 [0,1] 이고 막대 두 구간의 폭이 된다. 곡선이 점근이라
 * `nextRatio` 는 1 에 닿지 않는다.
 */
export function branchView(
  state: LineageState,
  branch: LineageBranch,
): {
  readonly level: number;
  readonly bonusBp: number;
  readonly nextBonusBp: number;
  readonly deltaBp: number;
  readonly cost: number;
  readonly affordable: boolean;
  readonly shortBy: number;
  readonly ratio: number;
  readonly nextRatio: number;
} {
  const level = branch === 'ship' ? state.shipLevel : state.guardianLevel;
  const bonusBp = branchBonusBp(level);
  const nextBonusBp = branchBonusBp(level + 1);
  const cost = nextLevelCost(level);
  const affordable = canInvest(state, branch);
  return {
    level,
    bonusBp,
    nextBonusBp,
    deltaBp: nextBonusBp - bonusBp,
    cost,
    affordable,
    shortBy: affordable ? 0 : cost - state.available,
    ratio: bonusBp / LINEAGE_BONUS_CAP_BP,
    nextRatio: nextBonusBp / LINEAGE_BONUS_CAP_BP,
  };
}

/** 마일스톤 표시 행(수호 가지). 순수 — 요구 레벨·해금 여부는 `data/lineage.ts` 정본에서 유도한다. */
export function milestoneRows(
  guardianLevel: number,
): readonly { readonly id: 'reboot' | 'coreGuard' | 'shieldShare'; readonly req: number; readonly unlocked: boolean }[] {
  const mask = guardianMilestones(guardianLevel);
  return [
    { id: 'reboot', req: REBOOT_LEVEL, unlocked: hasMilestone(mask, MILESTONE_REBOOT) },
    { id: 'coreGuard', req: CORE_GUARD_LEVEL, unlocked: hasMilestone(mask, MILESTONE_CORE_GUARD) },
    { id: 'shieldShare', req: SHIELD_SHARE_LEVEL, unlocked: hasMilestone(mask, MILESTONE_SHIELD_SHARE) },
  ];
}

/** 가지 표시명 키. */
function branchNameKey(branch: LineageBranch): MessageKey {
  return (branch === 'ship' ? 'lineage.branch.ship' : 'lineage.branch.guardian') as MessageKey;
}

function branchDescKey(branch: LineageBranch): MessageKey {
  return (branch === 'ship' ? 'lineage.branch.ship.desc' : 'lineage.branch.guardian.desc') as MessageKey;
}

export interface LineageHallCallbacks {
  /** 화면을 닫을 때. 격납고가 `resume()` 하는 자리. */
  onClose: () => void;
}

/** 한 가지 판의 갈아끼울 위젯 묶음. */
interface BranchWidgets {
  readonly branch: LineageBranch;
  readonly level: Text;
  readonly bonus: Text;
  readonly next: Text;
  readonly sunk: Text;
  readonly cost: Text;
  readonly bar: Graphics;
  readonly barW: number;
  readonly button: PixiButton;
  readonly short: Text;
}

/** 마일스톤 한 행의 갈아끼울 위젯 묶음(진행 막대 포함). */
interface MilestoneWidgets {
  readonly name: Text;
  readonly req: Text;
  readonly bar: Graphics;
  readonly barW: number;
}

export class LineageHallScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private profile: Profile;
  private readonly store: KeyValueStore | null;
  private cb: LineageHallCallbacks | null = null;
  private art: HangarTextures = {};
  /** 투자 확인 팝업 대상 가지(null = 팝업 닫힘). */
  private confirming: LineageBranch | null = null;
  /** 투자 직후 피드백 한 줄. 포인트 패널 바닥에 뜬다. */
  private hint = '';
  /** 서버 왕복 중 — 버튼을 잠가 같은 투자를 두 번 보내지 않는다(되돌릴 수 없는 지출이다). */
  private busy = false;
  /** 진입 시점의 런 HUD `visibility`(닫을 때 그대로 되돌린다 — 챔피언 선택 C-4 규약). */
  private hudPrevVisibility: string | null = null;

  // --- 유지되는 크롬(파일 헤더 "재렌더 규율") ---
  private backdrop: HangarBackdrop | null = null;
  private panels: CinematicPanel[] = [];
  /** 팝업 패널은 나고 지므로 따로 잡는다(연출 dt 를 받아야 한다). */
  private modalPanel: CinematicPanel | null = null;
  private modalHost: Container | null = null;
  private helpOpen = false;
  private helpScroll = 0;
  private branches: BranchWidgets[] = [];
  private pointsValue: Text | null = null;
  private hintText: Text | null = null;
  private msRows: MilestoneWidgets[] = [];
  private chromeBuilt = false;

  constructor(profile: Profile, stage: Container, store: KeyValueStore | null = null) {
    this.profile = profile;
    this.store = store;
    this.stage = stage;
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
    void loadHangarTextures().then((tex) => {
      this.art = tex;
      this.rebuild();
    });
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /**
   * 매 프레임 연출 진행. `dt` 는 **벽시계 초**다.
   *
   * ⚠️ 격납고가 **자기 가시성 가드보다 먼저** 이 메서드를 부른다 — 이 화면이 떠 있는 동안 격납고
   * root 는 `suspend()` 로 숨겨져 있기 때문이다. 숨겨져 있으면 즉시 반환하므로 비용은 0 이다.
   */
  update(dt: number): void {
    if (!this.root.visible) return;
    this.backdrop?.update(dt);
    for (const p of this.panels) p.update(dt);
    this.modalPanel?.update(dt);
  }

  show(profile: Profile, cb: LineageHallCallbacks): void {
    this.profile = profile;
    this.cb = cb;
    this.hint = '';
    this.confirming = null;
    this.busy = false;
    this.buildChrome();
    this.sync();
    this.renderModal();
    this.root.visible = true;
    this.raise();
    this.hideRunHud();
    // 서버 정본 pull 은 화면을 **띄운 뒤** 시작한다 — 왕복을 기다리며 검은 화면을 보여 주지
    // 않는다. 도착하면 `sync()` 가 값만 갈아끼운다.
    this.pullFromServer();
  }

  hide(): void {
    this.root.visible = false;
    this.cb = null;
    this.restoreRunHud();
  }

  private raise(): void {
    this.stage.setChildIndex(this.root, this.stage.children.length - 1);
  }

  private close(): void {
    const cb = this.cb;
    this.hide();
    cb?.onClose();
  }

  /**
   * ⚠️ 여기에는 캔버스 가드를 붙이지 않는다 — `typeof document.createElement !== 'function'`
   * 까지 검사하면 HUD 숨김이 통째로 죽는다(로스터에서 실제로 밟았다).
   */
  private hudEl(): HTMLElement | null {
    if (typeof document === 'undefined') return null;
    return document.getElementById('pb-hud');
  }

  private hideRunHud(): void {
    const hud = this.hudEl();
    if (hud === null) return;
    this.hudPrevVisibility = hud.style.visibility;
    hud.style.visibility = 'hidden';
  }

  private restoreRunHud(): void {
    const hud = this.hudEl();
    if (hud === null || this.hudPrevVisibility === null) return;
    hud.style.visibility = this.hudPrevVisibility;
    this.hudPrevVisibility = null;
  }

  // --- 동작 ----------------------------------------------------------------

  /**
   * 투자 확정 — **서버가 차감한다**(ADR-0007 서버 권위).
   *
   * 클라는 `invest_lineage` RPC 를 부르고 **서버가 돌려준 `{level, points}` 로 미러를 맞춘다**.
   * 로컬 산식으로 다시 빼지 않는다 — 같은 비용 곡선을 두 번 적용하는 결함이 되고, 애초에 클라가
   * 계산한 잔액을 서버가 믿는 경로는 존재하지 않는다.
   *
   * 실패(오프라인·거부)면 **Profile 을 전혀 건드리지 않는다.** 계보는 리스펙이 없어 낙관적
   * 반영을 되돌릴 수단이 없으므로, 서버가 확정하기 전에는 로컬도 움직이지 않는 것이 유일하게
   * 안전한 순서다.
   *
   * `store` 가 null 이면 `?? undefined` 로 기본 store 를 태운다 — `saveProfile` 은 **명시적
   * null 을 "저장하지 마라"로 읽고 즉시 return** 하기 때문이다(격납고/로스터 선례).
   */
  private performInvest(branch: LineageBranch): void {
    this.confirming = null;
    if (this.busy) return;
    const before = branchView(this.profile.lineage, branch);
    this.busy = true;
    this.hint = t('lineage.busy');
    this.renderModal();
    this.sync();
    void investLineageOnServer(branch).then((res) => {
      this.busy = false;
      if (res === null) {
        // 서버가 확정하지 않았다 = 아무 일도 일어나지 않았다. 잔고·레벨은 그대로다.
        this.hint = t('lineage.failed');
        this.sync();
        return;
      }
      applyServerInvest(this.profile, branch, res);
      saveProfile(this.profile, this.store ?? undefined);
      this.hint = t('lineage.invested', {
        name: t(branchNameKey(branch)),
        lv: before.level + 1,
        cost: before.cost,
      });
      this.sync();
    });
  }

  /**
   * 서버 정본을 당겨 미러를 맞춘다(진입 시 1회). 계보 포인트는 다른 기기의 퇴역·소멸로도 늘기
   * 때문에, 이 화면에 들어온 순간의 서버 잔고가 유일하게 옳은 값이다.
   *
   * ⚠️ 실패하면 **아무것도 하지 않는다.** 빈 결과로 미러를 덮으면 수호 목록이 통째로 지워진다
   * (`applyServerLineageState` 헤더). 그래서 파사드가 실패를 `null` 로 낸다.
   */
  private pullFromServer(): void {
    if (!isLineageOnline()) return;
    void pullLineageState().then((state) => {
      if (state === null) return;
      applyServerLineageState(this.profile, state);
      saveProfile(this.profile, this.store ?? undefined);
      this.sync();
    });
  }

  // --- 크롬(1회 조립) -------------------------------------------------------

  /** 자산이 도착하면 크롬을 통째로 다시 세운다(구운 텍스처가 바뀌므로 갱신으로는 안 된다). */
  private rebuild(): void {
    if (!this.chromeBuilt) return;
    this.destroyChrome();
    this.buildChrome();
    this.sync();
    this.renderModal();
  }

  private destroyChrome(): void {
    // 연출 참조를 먼저 끊는다 — destroy 된 컨테이너를 update 가 만지면 안 된다.
    this.backdrop?.destroy();
    this.backdrop = null;
    for (const p of this.panels) p.destroy();
    this.panels = [];
    this.modalPanel?.destroy();
    this.modalPanel = null;
    this.modalHost = null;
    this.branches = [];
    this.pointsValue = null;
    this.hintText = null;
    this.msRows = [];
    for (const child of [...this.root.children]) {
      this.root.removeChild(child);
      child.destroy({ children: true });
    }
    this.chromeBuilt = false;
  }

  private buildChrome(): void {
    if (this.chromeBuilt) return;

    // 바닥 — 배경 자산이 없거나 실패해도 화면이 비지 않게(불투명, 뒤 아레나를 가린다).
    // 이벤트도 여기서 막는다(뒤 화면으로 클릭·휠이 새지 않게).
    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static';
    this.root.addChild(bg);

    // ⚠️ `view` 는 root 맨 뒤에 그대로 붙이고 스케일·이동을 걸지 마라(공기 마스크가 `view` 의
    // 자식이라 어긋난다). 창은 없다 — 배경 노출은 헤더 밴드와 패널 사이 틈뿐이다.
    const backdrop = new HangarBackdrop(this.art[HANGAR_BACKDROP_NAME], {
      windows: [],
      headerH: HEADER_H,
    });
    this.root.addChild(backdrop.view);
    this.backdrop = backdrop;

    // ⚠️ **위 → 아래 순서로 붙인다.** 패널 접지 그림자는 아래로 59px 번지는데 행 간격은 20 이라,
    // 순서가 뒤집히면 위 패널의 그림자가 아래 패널 **위에** 얹혀 얼룩으로 읽힌다.
    const mainBox = this.addPanel(MAIN_X, MAIN_Y, MAIN_W, MAIN_H, t('lineage.branches.title'));
    const pointsBox = this.addPanel(SIDE_X, POINTS_Y, SIDE_W, POINTS_H, t('lineage.points.title'));
    const msBox = this.addPanel(SIDE_X, MS_Y, SIDE_W, MS_H, t('lineage.ms.title'));

    this.buildBranches(mainBox);
    this.buildPoints(pointsBox);
    this.buildMilestones(msBox);
    this.buildHeader();

    // 팝업은 항상 맨 위에 뜬다 — 그릇을 마지막에 붙인다.
    const modal = new Container();
    this.root.addChild(modal);
    this.modalHost = modal;

    this.chromeBuilt = true;
  }

  /**
   * 석재 패널 한 장을 세우고 **패널 로컬** 콘텐츠 상자를 돌려준다.
   *
   * ⚠️ `screenX`/`screenY` 를 **반드시 넘긴다.** 안 넘기면 같은 치수의 패널끼리 조명·랜드마크
   * 시드가 같아져 위치별 조명이 조용히 무효가 된다 — 화면은 정상적으로 서고 테스트도 통과하므로
   * 눈으로만 잡히는 유형이다.
   */
  private addPanel(
    px: number,
    py: number,
    pw: number,
    ph: number,
    title: string,
  ): { x: number; y: number; w: number; h: number } {
    const panel = makeCinematicPanel({
      width: pw,
      height: ph,
      variant: 'slab',
      ...(title === '' ? {} : { title }),
      screenX: px,
      screenY: py,
      lightOrigin: { x: DESIGN_WIDTH / 2, y: 60 },
    });
    panel.container.position.set(px, py);
    this.root.addChild(panel.container);
    this.panels.push(panel);
    const b = panel.box;
    return { x: b.x, y: b.y, w: b.w, h: b.h };
  }

  /** 시네마틱 버튼 — 기존 `PixiButton` 에 석재 텍스처만 주입한다(로직은 그대로). */
  private chromeButton(o: {
    tone: ChromeTone;
    width: number;
    height: number;
    fontSize: number;
    label: string;
    onClick: () => void;
  }): PixiButton {
    return new PixiButton({
      // ⚠️ 텍스처는 128×64 로 구워져 있다 — `cap: 32` 여야 모서리가 안 뭉개진다.
      texture: cinematicButtonTexture(o.tone),
      cap: 32,
      fallbackColor: chromeFallbackColor(o.tone),
      labelColor: chromeLabelColor(o.tone),
      width: o.width,
      height: o.height,
      fontSize: o.fontSize,
      label: o.label,
      onClick: o.onClick,
    });
  }

  /**
   * 헤더 밴드(y 0..{@link HEADER_H}) — 각인 제목(중앙) · 닫기.
   *
   * 계보 포인트는 **헤더 칩이 아니라 우상단 패널의 큰 숫자**다(로스터와 같은 판단 — 전 화면 공용
   * 재화만 헤더에 둔다). 양쪽에 같은 수를 두면 노이즈가 된다.
   *
   * ⚠️ 컨트롤은 **전부 같은 세로 띠**를 쓰고 가로로만 배치한다(격납고 헤더 겹침 결함 이력).
   * ⚠️ 좌상단 {@link GEAR_BAND_W}×{@link GEAR_BAND_H} 에는 아무것도 두지 않는다 — 설정 톱니가
   * 나중에 stage 최상위로 그려져 그 컨트롤을 통째로 클릭 불가로 만든다.
   */
  private buildHeader(): void {
    const title = makeHangarTitle(t('lineage.title'));
    title.position.set(DESIGN_WIDTH / 2, HEAD_Y - 4);
    this.root.addChild(title);

    const closeX = CLOSE_X;
    const close = this.chromeButton({
      tone: 'stone',
      width: CLOSE_W,
      height: HEAD_H,
      fontSize: 22,
      // 컬러 이모지는 Pixi 에서 두부가 된다(`text.ts` stripEmoji) — U+2715 는 흑백 글리프다.
      label: '✕',
      onClick: () => this.close(),
    });
    close.container.position.set(closeX, HEAD_Y);
    this.root.addChild(close.container);

    // 도움말 — 닫기와 **같은 세로 띠**를 쓰고 가로로만 자리를 잡는다.
    const help = this.chromeButton({
      tone: 'stone',
      width: HELP_HEAD_W,
      height: HEAD_H,
      fontSize: 20,
      label: t('lineage.help'),
      onClick: () => this.openHelp(),
    });
    help.container.position.set(HELP_X, HEAD_Y);
    this.root.addChild(help.container);
  }

  /** 화면 안내 팝업 — 읽기 전용이라 계보 투자를 건드리지 않는다. */
  private openHelp(): void {
    this.helpOpen = true;
    this.helpScroll = 0;
    this.renderModal();
  }

  /**
   * 가지 판 둘 — 이 화면의 본체.
   *
   * 판 높이는 패널 콘텐츠 상자에서 **파생**한다. 고정 상수로 두면 패널 제목 띠 두께가 바뀔 때
   * 아래 판이 조용히 상자 밖으로 밀린다(형제 화면들이 겪은 유형).
   */
  private buildBranches(box: { x: number; y: number; w: number; h: number }): void {
    const panel = this.panels[0];
    if (panel === undefined) return;
    const P = panel.container;

    const plateH = Math.floor((box.h - BRANCH_TOP_PAD - BRANCH_GAP) / 2);
    const list: LineageBranch[] = ['ship', 'guardian'];
    list.forEach((branch, i) => {
      const host = new Container();
      host.position.set(box.x, box.y + BRANCH_TOP_PAD + i * (plateH + BRANCH_GAP));
      P.addChild(host);
      this.branches.push(this.buildBranchPlate(host, branch, box.w, plateH));
    });
  }

  /** 가지 판 한 장. 좌측이 글·막대, 우측이 컨트롤 열이다. */
  private buildBranchPlate(
    host: Container,
    branch: LineageBranch,
    w: number,
    h: number,
  ): BranchWidgets {
    host.addChild(plateBack(w, h));

    // 글 열의 오른쪽 끝 — 컨트롤 열에서 **파생**한다. 하드코딩하면 버튼을 넓힐 때 글자가 버튼
    // 밑으로 들어간다(로스터 행에서 같은 규율).
    const textW = w - PLATE_PAD_X * 2 - INVEST_W - CTRL_PAD;

    const name = new Text({
      resolution: 2,
      text: t(branchNameKey(branch)),
      style: { fontFamily: UI_FONT, fontSize: 30, fontWeight: '800', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
    });
    name.position.set(PLATE_PAD_X, 18);
    host.addChild(name);

    const desc = new Text({
      resolution: 2,
      text: t(branchDescKey(branch)),
      style: {
        fontFamily: UI_FONT, fontSize: 18, fill: SLAB_BODY_FILL, wordWrap: true,
        wordWrapWidth: textW, lineHeight: 26, dropShadow: TEXT_SHADOW,
      },
    });
    desc.position.set(PLATE_PAD_X, 62);
    host.addChild(desc);

    /**
     * 글 열은 판 세로를 **끝까지** 쓴다. 처음에는 위 260px 안에 다 쌓았더니 판 아래 100px 넘게가
     * 통째로 비어 "무언가 로딩 중"처럼 읽혔다(실화면 1차 확인 — 로스터 상세 패널이 겪은 것과 같은
     * 유형). 아래 y 들은 판 높이 예산(≈370)을 균등하게 쓰도록 고른 값이다.
     */
    const levelY = 150;
    const barY = 196;
    const nextY = barY + BAR_H + 30;
    const sunkY = nextY + 44;

    const level = new Text({
      resolution: 2,
      text: '',
      style: { fontFamily: UI_FONT, fontSize: 20, fontWeight: '700', fill: COLOR.cream, dropShadow: TEXT_SHADOW },
    });
    level.position.set(PLATE_PAD_X, levelY);
    host.addChild(level);

    const bonus = new Text({
      resolution: 2,
      text: '',
      style: { fontFamily: UI_FONT, fontSize: 34, fontWeight: '800', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
    });
    bonus.anchor.set(1, 0);
    bonus.position.set(PLATE_PAD_X + textW, levelY - 10);
    host.addChild(bonus);

    const bar = new Graphics();
    bar.position.set(PLATE_PAD_X, barY);
    host.addChild(bar);

    const cap = new Text({
      resolution: 2,
      text: t('lineage.cap', { pct: bpPct(LINEAGE_BONUS_CAP_BP) }),
      style: { fontFamily: UI_FONT, fontSize: 16, fill: SLAB_BODY_FILL, dropShadow: TEXT_SHADOW },
    });
    cap.anchor.set(1, 0);
    cap.position.set(PLATE_PAD_X + textW, barY + BAR_H + 8);
    host.addChild(cap);

    const next = new Text({
      resolution: 2,
      text: '',
      style: {
        fontFamily: UI_FONT, fontSize: 18, fontWeight: '700', fill: BAR_GHOST, wordWrap: true,
        wordWrapWidth: textW, lineHeight: 26, dropShadow: TEXT_SHADOW,
      },
    });
    next.position.set(PLATE_PAD_X, nextY);
    host.addChild(next);

    // 이미 묻은 포인트 — 리스펙이 없어 영영 이 가지에 남는 값이다(`investedPoints` 헤더).
    const sunk = new Text({
      resolution: 2,
      text: '',
      style: {
        fontFamily: UI_FONT, fontSize: 17, fill: SLAB_BODY_FILL, wordWrap: true,
        wordWrapWidth: textW, lineHeight: 24, dropShadow: TEXT_SHADOW,
      },
    });
    sunk.position.set(PLATE_PAD_X, sunkY);
    host.addChild(sunk);

    // --- 컨트롤 열(우측) ---
    const ctrlX = w - PLATE_PAD_X - INVEST_W;
    const btnY = Math.round(h / 2) - Math.round(INVEST_H / 2);

    /**
     * ⚠️ 비용은 버튼 **위 띠**에 놓고 y 를 버튼 상단에서 **파생**한다. 처음에는 `h/2 - 14` 로
     * 뒀는데 버튼 상단이 `h/2 - 30` 이라 숫자가 버튼에 통째로 깔렸다(실화면 1차 확인 — 값이
     * 보이지 않는데도 테스트는 전부 통과했다). 컨트롤 열은 세로로 쌓는 유일한 자리라 여기만
     * 파생이 필요하다.
     */
    const cost = new Text({
      resolution: 2,
      text: '',
      style: { fontFamily: UI_FONT, fontSize: 20, fontWeight: '700', fill: COLOR.gold, align: 'center', dropShadow: TEXT_SHADOW },
    });
    cost.anchor.set(0.5, 1);
    cost.position.set(ctrlX + INVEST_W / 2, btnY - 10);
    host.addChild(cost);

    const button = this.chromeButton({
      tone: 'gold',
      width: INVEST_W,
      height: INVEST_H,
      fontSize: 21,
      label: t('lineage.invest'),
      onClick: () => {
        // 투자는 되돌릴 수 없다 — 여기서는 팝업만 연다. 실행은 팝업의 확정 버튼이다.
        // 게이트가 두 곳에서 어긋나도 지출만은 막히도록 여기서도 세 조건을 다시 본다.
        if (!isLineageOnline() || this.busy) return;
        if (!canInvest(this.profile.lineage, branch)) return;
        this.confirming = branch;
        this.renderModal();
      },
    });
    button.container.position.set(ctrlX, btnY);
    host.addChild(button.container);

    const short = new Text({
      resolution: 2,
      text: '',
      style: {
        fontFamily: UI_FONT, fontSize: 16, fill: WARN_FILL, wordWrap: true,
        wordWrapWidth: INVEST_W, align: 'center', lineHeight: 22, dropShadow: TEXT_SHADOW,
      },
    });
    short.anchor.set(0.5, 0);
    short.position.set(ctrlX + INVEST_W / 2, btnY + INVEST_H + 10);
    host.addChild(short);

    return { branch, level, bonus, next, sunk, cost, bar, barW: textW, button, short };
  }

  /**
   * 계보 포인트 패널 — 이 화면의 **화폐**다.
   *
   * ⚠️ 문구는 **위에서 아래로만** 쌓고 결과 한 줄만 바닥에 붙인다. 양쪽에서 쌓으면 세로가 짧을 때
   * 겹침이 구조적으로 생긴다(로스터 계보 패널이 실제로 겪었다).
   */
  private buildPoints(box: { x: number; y: number; w: number; h: number }): void {
    const panel = this.panels[1];
    if (panel === undefined) return;
    const P = panel.container;
    const cx = box.x + box.w / 2;

    const value = new Text({
      resolution: 2,
      text: '—',
      style: { fontFamily: UI_FONT, fontSize: 68, fontWeight: '800', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
    });
    value.anchor.set(0.5, 0);
    value.position.set(cx, box.y + 6);
    P.addChild(value);
    this.pointsValue = value;

    const use = new Text({
      resolution: 2,
      text: t('lineage.points.use'),
      style: {
        fontFamily: UI_FONT, fontSize: 17, fill: SLAB_BODY_FILL, wordWrap: true,
        wordWrapWidth: box.w, align: 'center', lineHeight: 24, dropShadow: TEXT_SHADOW,
      },
    });
    use.anchor.set(0.5, 0);
    use.position.set(cx, box.y + 84);
    P.addChild(use);

    const warn = new Text({
      resolution: 2,
      text: t('lineage.points.warn'),
      style: {
        fontFamily: UI_FONT, fontSize: 17, fill: WARN_FILL, wordWrap: true,
        wordWrapWidth: box.w, align: 'center', lineHeight: 24, dropShadow: TEXT_SHADOW,
      },
    });
    warn.anchor.set(0.5, 0);
    warn.position.set(cx, box.y + 140);
    P.addChild(warn);

    const hint = new Text({
      resolution: 2,
      text: '',
      style: {
        fontFamily: UI_FONT, fontSize: 19, fontWeight: '700', fill: 0x8affc0, wordWrap: true,
        wordWrapWidth: box.w, align: 'center', lineHeight: 26, dropShadow: TEXT_SHADOW,
      },
    });
    hint.anchor.set(0.5, 1);
    hint.position.set(cx, box.y + box.h - 6);
    P.addChild(hint);
    this.hintText = hint;
  }

  /**
   * 수호 가지 마일스톤 패널 — 레벨 도달만으로 자동 해금되는 **질적 노드** 3종.
   *
   * 보너스 곡선은 연속이라 "다음 1레벨이 무엇을 여는가"를 말하지 못한다. 되돌릴 수 없는 투자를
   * 결정하는 정보의 절반이 여기 있다.
   */
  private buildMilestones(box: { x: number; y: number; w: number; h: number }): void {
    const panel = this.panels[2];
    if (panel === undefined) return;
    const P = panel.container;

    const rows = milestoneRows(0);
    const rowH = Math.floor((box.h - 8) / rows.length);
    rows.forEach((row, i) => {
      const y = box.y + 4 + i * rowH;
      const name = new Text({
        resolution: 2,
        text: t(`lineage.ms.${row.id}` as MessageKey),
        style: { fontFamily: UI_FONT, fontSize: 21, fontWeight: '800', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
      });
      name.position.set(box.x + 4, y);
      P.addChild(name);

      const req = new Text({
        resolution: 2,
        text: '',
        style: { fontFamily: UI_FONT, fontSize: 17, fontWeight: '700', fill: MS_OFF, dropShadow: TEXT_SHADOW },
      });
      req.anchor.set(1, 0);
      req.position.set(box.x + box.w - 4, y + 3);
      P.addChild(req);

      const desc = new Text({
        resolution: 2,
        text: t(`lineage.ms.${row.id}.desc` as MessageKey),
        style: {
          fontFamily: UI_FONT, fontSize: 16, fill: SLAB_BODY_FILL, wordWrap: true,
          wordWrapWidth: box.w - 8, lineHeight: 23, dropShadow: TEXT_SHADOW,
        },
      });
      desc.position.set(box.x + 4, y + 30);
      P.addChild(desc);

      /**
       * 해금까지 남은 거리 — 잠긴 노드는 "요구 레벨 50" 만으로는 지금 어디쯤인지 안 읽힌다.
       * 되돌릴 수 없는 투자를 결정하는 자리라 남은 거리가 곧 판단 근거다. 얇은 막대라 설명 줄과
       * 겹치지 않게 행 아래쪽에 붙인다.
       */
      const barW = box.w - 8;
      const bar = new Graphics();
      bar.position.set(box.x + 4, y + 92);
      P.addChild(bar);

      this.msRows.push({ name, req, bar, barW });
    });
  }

  // --- 값 갱신 --------------------------------------------------------------

  /** 크롬의 **값만** 갱신한다(포인트·가지·마일스톤). 배경·패널은 다시 만들지 않는다. */
  private sync(): void {
    const st = this.profile.lineage;
    const online = isLineageOnline();

    if (this.pointsValue !== null) this.pointsValue.text = String(st.available);
    if (this.hintText !== null) {
      this.hintText.text = this.hint;
      this.hintText.visible = this.hint !== '';
    }

    for (const b of this.branches) {
      const v = branchView(st, b.branch);
      b.level.text = t('lineage.level', { lv: v.level });
      b.bonus.text = `+${bpPct(v.bonusBp)}%`;
      b.next.text = t('lineage.next', { pct: bpPct(v.nextBonusBp), delta: bpPct(v.deltaBp) });
      b.sunk.text = t('lineage.sunk', { pt: branchInvestedPoints(v.level) });
      b.cost.text = t('lineage.cost', { cost: v.cost });
      b.cost.style.fill = v.affordable ? COLOR.gold : WARN_FILL;
      /**
       * 잠금 사유는 셋이고 **순서가 있다**: 오프라인 → 왕복 중 → 포인트 부족. 오프라인을 먼저
       * 보는 이유는, 서버가 없으면 잔고 자체가 신뢰할 수 없는 값이라 "N pt 부족"이 거짓 정보가
       * 되기 때문이다(로컬 미러는 다른 기기의 소멸을 모른다).
       *
       * 비활성 버튼은 hover 이벤트도 죽으므로(툴팁 불가) 사유를 버튼 바로 아래 한 줄로 남긴다
       * (격납고 `swapNeedMaxLevel` 과 같은 규율).
       */
      const reason = !online
        ? t('lineage.offline')
        : this.busy
          ? t('lineage.busy')
          : v.affordable
            ? ''
            : t('lineage.short', { need: v.shortBy });
      b.button.setEnabled(online && !this.busy && v.affordable);
      b.short.text = reason;
      b.short.visible = reason !== '';
      this.drawBar(b, v.ratio, v.nextRatio);
    }

    const rows = milestoneRows(st.guardianLevel);
    this.msRows.forEach((w, i) => {
      const row = rows[i];
      if (row === undefined) return;
      w.req.text = row.unlocked
        ? t('lineage.ms.unlocked')
        : t('lineage.ms.remain', { lv: row.req, n: row.req - st.guardianLevel });
      w.req.style.fill = row.unlocked ? MS_ON : MS_OFF;
      // 잠긴 노드는 이름도 눌러 둔다 — 해금 여부가 색 하나로 읽혀야 한다.
      w.name.style.fill = row.unlocked ? COLOR.gold : MS_OFF;

      const ratio = row.unlocked ? 1 : Math.min(1, st.guardianLevel / row.req);
      const g = w.bar;
      g.clear();
      g.roundRect(0, 0, w.barW, MS_BAR_H, MS_BAR_H / 2).fill({ color: BAR_GROOVE });
      const fill = Math.round(w.barW * ratio);
      if (fill >= 1) {
        g.roundRect(0, 0, fill, MS_BAR_H, MS_BAR_H / 2).fill({ color: row.unlocked ? MS_ON : COLOR.gold, alpha: row.unlocked ? 0.9 : 0.75 });
      }
      g.roundRect(0, 0, w.barW, MS_BAR_H, MS_BAR_H / 2).stroke({ color: PLATE_GROOVE, width: 2, alignment: 1, alpha: 0.9 });
    });
  }

  /**
   * 보너스 막대 — 홈 위에 [현재] + [이번 투자가 사는 것] 두 구간.
   *
   * 유령 구간이 1px 미만이면 아예 안 그린다(고레벨에서 증가분이 미미해지는 구간). 0.5px 짜리
   * 실선은 안티에일리어싱으로 얼룩처럼 읽힌다.
   */
  private drawBar(b: BranchWidgets, ratio: number, nextRatio: number): void {
    const w = b.barW;
    const g = b.bar;
    g.clear();
    g.roundRect(0, 0, w, BAR_H, BAR_H / 2).fill({ color: BAR_GROOVE });
    const nextW = Math.round(w * Math.min(1, nextRatio));
    const curW = Math.round(w * Math.min(1, ratio));
    if (nextW - curW >= 1) {
      g.roundRect(0, 0, nextW, BAR_H, BAR_H / 2).fill({ color: BAR_GHOST, alpha: 0.35 });
    }
    if (curW >= 1) {
      g.roundRect(0, 0, curW, BAR_H, BAR_H / 2).fill({ color: COLOR.gold });
    }
    g.roundRect(0, 0, w, BAR_H, BAR_H / 2).stroke({ color: PLATE_GROOVE, width: 2, alignment: 1, alpha: 0.9 });
  }

  // --- 투자 확인 팝업 --------------------------------------------------------

  /**
   * 시네마틱 확인 팝업. **`makeModal` 을 쓰지 않는다** — 그 모듈은 나무 nine-slice 에 묶여 있고
   * 다른 화면 5곳이 쓰기 때문에 고치면 그 화면들이 같이 갈린다. 대신 `modal.ts` 헤더의 실측 규칙
   * 세 가지를 그대로 승계한다:
   *  ① 암막은 **완전 불투명 채움**(뒤 화면 글자가 비쳐 읽히는 결함).
   *  ② 암막이 **이벤트를 먹는다**(안 그러면 뒤 화면이 눌린다).
   *  ③ 패널 안쪽 탭은 암막까지 **전파를 끊는다**(안 그러면 팝업 안을 누를 때마다 닫힌다).
   */
  private renderModal(): void {
    const host = this.modalHost;
    if (host === null) return;

    this.modalPanel?.destroy();
    this.modalPanel = null;
    for (const child of [...host.children]) {
      host.removeChild(child);
      child.destroy({ children: true });
    }
    // 도움말은 화면의 확인 팝업과 같은 그릇을 쓰되 **먼저** 본다 — 기구는 공용 모듈이 통째로
    // 세운다(암막+패널+내용). 여섯 화면이 같은 팝업을 쓰므로 여기서 다시 조립하면 갈린다.
    if (this.helpOpen) {
      this.root.setChildIndex(host, this.root.children.length - 1);
      this.modalPanel = openHelpOverlay(host, {
        spec: LINEAGE_HELP,
        get: () => this.helpScroll,
        set: (v) => {
          this.helpScroll = v;
        },
        onClose: () => {
          this.helpOpen = false;
          this.renderModal();
        },
      });
      return;
    }
    const branch = this.confirming;
    if (branch === null) return;

    const v = branchView(this.profile.lineage, branch);
    // 팝업이 떠 있는 사이 잔고가 갈릴 일은 없지만, 확정 버튼이 유일한 실행 경로이므로 여기서도
    // 한 번 더 본다(게이트가 두 곳에서 어긋나도 지출만은 막히도록).
    if (!v.affordable) {
      this.confirming = null;
      return;
    }

    // ① · ② 암막.
    const scrim = new Graphics();
    scrim.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: 0x05060f, alpha: 0.92 });
    scrim.eventMode = 'static';
    scrim.on('pointertap', () => {
      this.confirming = null;
      this.renderModal();
    });
    host.addChild(scrim);

    const px = Math.round((DESIGN_WIDTH - CONFIRM_W) / 2);
    const py = Math.round((DESIGN_HEIGHT - CONFIRM_H) / 2);
    const panel = makeCinematicPanel({
      width: CONFIRM_W,
      height: CONFIRM_H,
      variant: 'slab',
      title: t('lineage.confirm.title'),
      screenX: px,
      screenY: py,
      lightOrigin: { x: DESIGN_WIDTH / 2, y: 60 },
    });
    panel.container.position.set(px, py);
    // ③ 패널 안쪽 탭이 암막까지 내려가지 않게 막는다.
    stopRowPropagation(panel.container);
    host.addChild(panel.container);
    this.modalPanel = panel;

    const box = panel.box;
    const cx = box.x + box.w / 2;

    const body = new Text({
      resolution: 2,
      text: t('lineage.confirm.body', {
        name: t(branchNameKey(branch)),
        lv: v.level + 1,
        cost: v.cost,
        pct: bpPct(v.nextBonusBp),
        left: this.profile.lineage.available - v.cost,
      }),
      style: {
        fontFamily: UI_FONT, fontSize: 20, fill: COLOR.cream, wordWrap: true,
        wordWrapWidth: box.w, align: 'center', lineHeight: 30, dropShadow: TEXT_SHADOW,
      },
    });
    body.anchor.set(0.5, 0);
    body.position.set(cx, box.y + 10);
    panel.container.addChild(body);

    /**
     * 버튼은 패널 **바닥 기준**으로 놓는다. 본문 줄 수가 로케일·가지명 길이에 따라 변하는데
     * 본문 아래에 이어 붙이면 긴 문장에서 패널 밖으로 밀린다(로스터 팝업과 같은 규율).
     */
    const btnH = 56;
    const btnY = box.y + box.h - btnH - 4;
    const gap = 20;
    const yesW = 260;
    const noW = 200;
    const startX = cx - (yesW + gap + noW) / 2;

    const yes = this.chromeButton({
      tone: 'gold',
      width: yesW,
      height: btnH,
      fontSize: 19,
      label: t('lineage.confirm.yes'),
      onClick: () => this.performInvest(branch),
    });
    yes.container.position.set(startX, btnY);
    panel.container.addChild(yes.container);

    const no = this.chromeButton({
      tone: 'stone',
      width: noW,
      height: btnH,
      fontSize: 19,
      label: t('lineage.cancel'),
      onClick: () => {
        this.confirming = null;
        this.renderModal();
      },
    });
    no.container.position.set(startX + yesW + gap, btnY);
    panel.container.addChild(no.container);
  }
}
