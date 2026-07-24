/**
 * 보상 세리머니 — 전리품 등급 공개 (Phase 5 · §AC-5.2 · ADR-0031).
 *
 * 갤러리에서 사용자가 고른 `ceremony-lootreveal`(전리품 등급 공개) 룩을 **프로덕션 정규 경로**
 * (정산 화면)로 이식한 것이다. 원본은 [src/harness/gallery/ceremonyVariants.ts]의 `spawnLootReveal`:
 * 카드가 모서리로 접혔다(scaleX→0) 다음 등급으로 펼쳐지며(→1) 공개되고, 공개 직후 대각 광택이
 * 앞면을 훑고, **유니크에서만** 따뜻한 헤일로가 맥동한다.
 *
 * ── 갤러리 판과의 결정적 차이 ─────────────────────────────────────────────────
 *  갤러리 판은 노말→매직→레어→유니크를 **무한 순환**하는 데모다. 프로덕션 판은 **이번 런에서
 *  실제로 떨어진 등급 목록**(`show(tiers)`)을 **순차로 한 장씩** 공개하고, 목록을 다 공개하면
 *  마지막 카드를 열어 둔 채 멎는다(순환하지 않는다). 목록에 유니크가 섞여 있으면 그 카드가
 *  화면에 올라온 동안 헤일로가 맥동한다(유니크만 고유 강조 — CONTEXT.md 등급 문법).
 *
 * ── 계약(넘을 수 없음) ────────────────────────────────────────────────────────
 *  - **render-only**(ADR-0005): `src/sim/` 무접촉. 진행은 전부 순수함수(경과 → 위상 → ease)라
 *    결정론(hashWorld/hashEntity)과 무관하다. `Rarity` 는 `items/types` 의 데이터 타입이라 sim 아님.
 *  - **메타(카툰나무풍) 레지스터**: 따뜻한 나무 톤 + 등급 색만 쓴다. **전투 SF 글로우 차용 금지**
 *    (ADR-0031 시각 레지스터 경계). 등급은 **테두리·젬·헤일로**로 읽히고 유니크만 고유 강조.
 *  - **GL 없는 node 에서도 성립**: 표시 객체를 전부 절차적 `Graphics`/`Text` 로 만들어 텍스처 비동기
 *    로드 없이 **동기 생성**한다(생성자에서 카드·헤일로를 붙여 `container.children.length > 0`).
 *  - **Pixi `Text` 사용 OK**: 갤러리 판(ceremonyVariants)이 `new Text(...)`+stripEmoji 를 쓰고 그
 *    배선 스모크(galleryWiring)가 node 에서 통과한다. 단 컬러 이모지는 두부 → stripEmoji 필수,
 *    라벨은 한글/숫자만.
 *  - **재사용 가능**: 생성자에서 표시 객체를 한 번만 짓고, `show`/`update`/`hide`/`reset` 로 상태만
 *    갈아끼운다(정산 진입마다 인스턴스를 새로 만들지 않아도 되게). `show` 재호출은 이전 상태를
 *    정리하고 처음부터 다시 공개한다.
 *
 * ── 밸런스 유예(defer-balance-tuning) ── 카드 크기·플립/광택/유지 타이밍·헤일로 세기는 전부
 *    placeholder 다. 실제 값은 구현 완료 후 출시 직전 팔레트·graphicsSettings 와 함께 일괄 조정한다.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { Rarity } from '../../items/types.js';
import { RARITY_COLOR_NUM, COLOR, UI_FONT, TEXT_SHADOW } from '../../ui/pixi/theme.js';
import { stripEmoji } from '../../ui/pixi/text.js';

// ── 순수 진행 함수 (경계 명확 · 테스트 대상) ────────────────────────────────

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * 카드 플립의 가로 스케일 = |cos(π·t)|. t = 경과/플립길이 를 [0,1] 로 클램프하므로
 * 스케일은 1(펼침) → 0(모서리) → 1(펼침) 을 그린다. 모서리(0) 순간에 등급을 교체하면
 * 교체가 접힘에 가려진다. 경계: t=0 → 1, t=0.5 → 0, t≥1 → 1.
 */
export function flipScaleX(elapsedInStep: number, flipDuration: number): number {
  const ft = clamp01(elapsedInStep / flipDuration);
  return Math.abs(Math.cos(Math.PI * ft));
}

/** 삼각 엔벨로프(0→1→0) — 광택 스윕의 페이드 인/아웃. 경계: p≤0 → 0, p=0.5 → 1, p≥1 → 0. */
export function triEnvelope(p: number): number {
  const q = clamp01(p);
  return q < 0.5 ? q / 0.5 : (1 - q) / 0.5;
}

/**
 * 유니크 헤일로 맥동 알파 = 0.6 + 0.4·(0.5 + 0.5·sin(elapsed·2.4)). 항상 [0.6, 1.0] 안이라
 * 헤일로가 완전히 꺼지지 않고 은은히 숨쉰다(유니크의 지속적 존재감). 경계: 최소 0.6, 최대 1.0.
 */
export function haloPulse(elapsed: number): number {
  return 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(elapsed * 2.4));
}

/** 별(젬) 폴리곤의 평탄 좌표 배열. points=꼭짓점 수, rot=시작 각(기본 위쪽). */
function starPoints(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  points = 5,
  rot = -Math.PI / 2,
): number[] {
  const pts: number[] = [];
  const step = Math.PI / points;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rot + i * step;
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return pts;
}

// ── 팔레트·라벨 ────────────────────────────────────────────────────────────

/** 따뜻한 나무 톤(카드 프레임). 전투 글로우 대신 이 톤으로만 깊이를 만든다. */
const WOOD = {
  edge: 0x341f0e,
  frame: 0x6b4522,
  bevel: 0x9a6733,
  face: 0x412a18,
} as const;

const TIER_LABEL: Record<Rarity, string> = {
  normal: '노말',
  magic: '매직',
  rare: '레어',
  unique: '유니크',
};

/** update(dt) 의 dt 는 초 단위 벽시계 델타. 탭 복귀 등 큰 점프를 이 값으로 캡한다. */
const DT_CLAMP = 0.1;

// ── 타이밍 상수(placeholder · defer-balance-tuning) ──────────────────────────

/** 한 장을 공개하는 스텝 총 길이(초): [플립] → [광택] → [유지]. */
const STEP = 1.2;
/** 플립(접혔다 펴짐) 길이. 모서리(교체)는 이 절반 시점. */
const FLIP_DURATION = 0.42;
/** 광택 스윕 시작/끝(스텝 로컬 초). 플립이 다 펴진 뒤 훑고 지나간다. */
const GLOSS_START = 0.42;
const GLOSS_END = 0.92;
/** 광택 최대 알파(삼각 엔벨로프에 곱). */
const GLOSS_MAX_ALPHA = 0.9;
/** 접힘 최소 스케일(완전 0 = degenerate 방어). */
const MIN_FLIP_SCALE = 0.02;

// ── 그리기 헬퍼 ────────────────────────────────────────────────────────────

/** 앵커 중앙(0.5)으로 배치되는 라벨 — bounds 를 읽지 않아 헤드리스에서도 안전하다. */
function mkText(text: string, size: number, fill: number, weight: '400' | '600' | '800'): Text {
  const tx = new Text({
    resolution: 2,
    text: stripEmoji(text),
    style: {
      fontFamily: UI_FONT,
      fontSize: size,
      fontWeight: weight,
      fill,
      dropShadow: TEXT_SHADOW,
    },
  });
  tx.anchor.set(0.5);
  return tx;
}

/** 유니크 강조용 따뜻한 헤일로(셰이더 없이 동심원 저알파로 근사). 원점 중심. */
function warmHalo(radius: number, color: number): Graphics {
  const g = new Graphics();
  for (const f of [1.0, 0.78, 0.56, 0.36]) {
    g.circle(0, 0, radius * f).fill({ color, alpha: 0.06 });
  }
  return g;
}

/**
 * 카드 앞면을 다시 그린다. `tier === null` 이면 등급색 없는 **봉인된 뒷면**(중립 나무 + 은은한
 * 각인)이고, 등급이 주어지면 그 등급의 테두리 + 젬으로 앞면을 그린다(등급은 테두리·젬으로 읽힌다,
 * 유니크만 굵고 밝게 + 코어 하이라이트로 고유 강조). 색은 `col` 한 변수로만 만들어 테두리·젬이
 * 언제나 같은 등급색을 쓴다(라벨 색과의 어긋남 방지).
 */
function paintCardFace(g: Graphics, tier: Rarity | null, w: number, h: number): void {
  g.clear();
  // 그림자 → 바깥테 → 프레임 → 안쪽 면 (나무 카드).
  g.roundRect(-w / 2 + 3, -h / 2 + 5, w, h, 14).fill({ color: 0x000000, alpha: 0.25 });
  g.roundRect(-w / 2, -h / 2, w, h, 14).fill({ color: WOOD.edge });
  g.roundRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8, 11).fill({ color: WOOD.frame });
  const iw = w - 16;
  const ih = h - 16;
  g.roundRect(-iw / 2, -ih / 2, iw, ih, 8).fill({ color: WOOD.face });

  const gemY = -ih * 0.16;
  const gemR = iw * 0.22;

  if (tier === null) {
    // 봉인된 뒷면 — 등급색 없이 중립 나무 톤 + 은은한 각인 다이아(아직 공개 전).
    g.roundRect(-iw / 2, -ih / 2, iw, ih, 8)
      .stroke({ color: WOOD.bevel, width: 3, alignment: 0, alpha: 0.7 });
    g.poly(starPoints(0, gemY, gemR, gemR * 0.46, 4))
      .stroke({ color: WOOD.bevel, width: 2, alignment: 0, alpha: 0.55 });
    return;
  }

  const col = RARITY_COLOR_NUM[tier];
  const unique = tier === 'unique';
  // 등급 테두리 — 유니크만 굵고 밝게(고유 강조).
  g.roundRect(-iw / 2, -ih / 2, iw, ih, 8)
    .stroke({ color: col, width: unique ? 5 : 3, alignment: 0, alpha: 0.95 });
  // 등급 젬(유니크는 6각 별, 그 외 4각 다이아).
  g.poly(starPoints(0, gemY, gemR, gemR * 0.46, unique ? 6 : 4))
    .fill({ color: col })
    .stroke({ color: WOOD.edge, width: 2, alignment: 0 });
  if (unique) g.circle(0, gemY, gemR * 0.28).fill({ color: 0xfff2d0, alpha: 0.85 });
}

// ── LootCeremony ────────────────────────────────────────────────────────────

/** 세리머니 UI 크기 산출 컨텍스트(그려질 영역의 디자인 스페이스 px). */
export interface LootCeremonyContext {
  width: number;
  height: number;
}

/**
 * 정산 화면에 얹는 전리품 등급 공개 세리머니.
 *
 * 생성 → `show(실드랍등급)` → 매 프레임 `update(dt)` → `hide()`/`reset()`. 표시 객체는 생성자에서
 * 한 번만 짓고 재사용한다(호출측이 `container` 를 씬에 addChild 하고 위치를 잡는다).
 */
export class LootCeremony {
  /** 세리머니 표시 객체 루트. 호출측이 씬에 addChild 하고 위치·가시성을 관리한다. */
  readonly container: Container = new Container();

  private readonly cardW: number;
  private readonly cardH: number;

  // 재사용되는 표시 객체(생성자에서 한 번만 생성).
  private readonly halo: Graphics;
  private readonly card: Container = new Container();
  private readonly faceG: Graphics = new Graphics();
  private readonly header: Text;
  private readonly tierText: Text;
  private readonly maskG: Graphics = new Graphics();
  private readonly gloss: Container = new Container();
  private readonly band: Graphics = new Graphics();

  // 진행 상태(show 로 리셋).
  private tiers: Rarity[] = [];
  private elapsed = 0;
  private _revealing = false;
  private destroyed = false;

  // 현재 앞면에 칠해진 등급(뒷면=null)과 그 색. builtValid=false 면 다음 applyTier 가 강제 재그림.
  private builtTier: Rarity | null = null;
  private builtValid = false;
  private appliedColor: number | null = null;

  constructor(ctx: LootCeremonyContext) {
    // 카드 크기는 영역에 맞춰 산출(placeholder — 갤러리 판과 같은 비율).
    this.cardW = clamp(Math.min(ctx.width * 0.5, ctx.height * 0.6), 118, 210);
    this.cardH = this.cardW * 1.32;
    const cx = ctx.width / 2;
    const cy = ctx.height / 2;

    // 유니크 헤일로(카드 뒤).
    this.halo = warmHalo(this.cardW * 0.95, RARITY_COLOR_NUM.unique);
    this.halo.visible = false;
    this.halo.position.set(cx, cy);
    this.container.addChild(this.halo);

    // 카드 그룹(원점 중심 요소를 담고, 그룹을 영역 중앙에 놓는다 — 플립은 이 중심축으로 접힌다).
    this.card.position.set(cx, cy);
    this.container.addChild(this.card);

    this.card.addChild(this.faceG);

    this.header = mkText('전리품', 14, COLOR.muted, '600');
    this.header.position.set(0, -this.cardH / 2 + 20);
    this.card.addChild(this.header);

    this.tierText = mkText('', Math.round(this.cardW * 0.16), RARITY_COLOR_NUM.normal, '800');
    this.tierText.position.set(0, this.cardH * 0.2);
    this.card.addChild(this.tierText);

    // 광택 스윕(마스크로 카드 안쪽에 가둔다).
    const miw = this.cardW - 16;
    const mih = this.cardH - 16;
    this.maskG.roundRect(-miw / 2, -mih / 2, miw, mih, 8).fill({ color: 0xffffff });
    this.card.addChild(this.maskG);

    const glossW = this.cardW * 0.34;
    this.band.rect(-glossW / 2, -this.cardH, glossW, this.cardH * 2).fill({ color: 0xffffff, alpha: 0.14 });
    this.band.rect(-glossW / 6, -this.cardH, glossW / 3, this.cardH * 2).fill({ color: 0xffffff, alpha: 0.12 });
    this.band.rotation = -0.32;
    this.gloss.addChild(this.band);
    this.gloss.mask = this.maskG;
    this.gloss.alpha = 0;
    this.card.addChild(this.gloss);

    // 초기: 봉인된 뒷면 + 숨김(show 전).
    this.applyTier(null);
    this.container.visible = false;
  }

  // --- 관측창(테스트용) -----------------------------------------------------

  /** 아직 목록을 공개 중이면 true, 마지막 카드까지 다 열고 멎었으면 false. */
  get revealing(): boolean {
    return this._revealing;
  }

  /** 현재 카드 앞면에 올라온 등급(공개 전 뒷면·빈 목록이면 null). */
  get currentTier(): Rarity | null {
    return this.builtTier;
  }

  /** 현재 앞면에 실제로 칠해진 등급 색(뒷면·빈 목록이면 null). RARITY_COLOR_NUM 반영을 검증. */
  get currentTierColor(): number | null {
    return this.appliedColor;
  }

  /** 유니크 헤일로가 지금 켜져 있으면 true(유니크 카드가 공개된 동안). */
  get uniqueHighlighted(): boolean {
    return this.halo.visible;
  }

  /** 카드 그룹의 현재 가로 스케일(플립 진행 관측 — 1=펼침, 0 근처=접힘). */
  get cardScaleX(): number {
    return this.card.scale.x;
  }

  /** 광택 스윕의 현재 알파(0=꺼짐, >0=스윕 중). */
  get glossAlpha(): number {
    return this.gloss.alpha;
  }

  // --- 공개 API -------------------------------------------------------------

  /**
   * **이번 런의 실제 드랍 등급 목록**을 순차로 공개한다(순환 아님). 빈 목록이면 "드랍 없음"
   * 뒷면을 안전하게 보이고 아무 것도 공개하지 않는다(크래시 금지). 재호출하면 이전 진행을
   * 정리하고 처음부터 다시 공개한다.
   *
   * @param tiers 공개할 등급 목록(정산 `SettlementSummary.drops` 의 `rarity` 를 순서대로). 빈 배열 허용.
   */
  show(tiers: Rarity[]): void {
    if (this.destroyed) return;
    // 이전 상태 정리 후 재시작(멱등·재사용).
    this.tiers = tiers.slice();
    this.elapsed = 0;
    this.halo.visible = false;
    this.halo.alpha = 0;
    this.gloss.alpha = 0;
    this.card.scale.set(1, 1);
    // 강제 재그림(뒷면부터). builtValid=false 로 캐시를 무효화한다.
    this.builtValid = false;
    this.applyTier(null);

    if (this.tiers.length === 0) {
      // 빈 목록: 공개할 것이 없다. 뒷면에 안내만 얹고 멎는다(graceful).
      this.tierText.text = stripEmoji('드랍 없음');
      this.tierText.style.fill = COLOR.muted;
      this._revealing = false;
    } else {
      this.tierText.text = '';
      this._revealing = true;
    }
    this.container.visible = true;
  }

  /**
   * 플립·광택·헤일로 맥동을 진행한다(초 단위 벽시계 델타, {@link DT_CLAMP} 로 캡).
   * 숨겨져 있거나 공개할 목록이 없으면 아무 것도 하지 않는다.
   */
  update(dt: number): void {
    if (this.destroyed || !this.container.visible || this.tiers.length === 0) return;
    this.elapsed += clamp(dt, 0, DT_CLAMP);

    const n = this.tiers.length;
    const stepIndex = Math.floor(this.elapsed / STEP);

    if (stepIndex >= n) {
      // 목록 소진 — 마지막 카드를 펼친 채 유지(순환하지 않는다). 유니크면 헤일로 계속 맥동.
      this._revealing = false;
      const last = this.tiers[n - 1] ?? null;
      this.applyTier(last);
      this.card.scale.set(1, 1);
      this.gloss.alpha = 0;
      this.updateHalo(last, true);
      return;
    }

    this._revealing = true;
    const pStep = this.elapsed - stepIndex * STEP;

    // 플립: scaleX 1→0→1. 모서리(절반)에서 등급을 교체해 교체가 접힘에 가려진다.
    const sx = flipScaleX(pStep, FLIP_DURATION);
    this.card.scale.set(Math.max(MIN_FLIP_SCALE, sx), 1);
    const beforeFold = pStep < FLIP_DURATION * 0.5;
    const shownTier = beforeFold
      ? stepIndex > 0
        ? this.tiers[stepIndex - 1] ?? null
        : null // 첫 장 이전엔 봉인된 뒷면.
      : this.tiers[stepIndex] ?? null;
    this.applyTier(shownTier);

    // 광택 스윕(플립 후): 왼→오 슬라이드 + 삼각 페이드.
    const gp = (pStep - GLOSS_START) / (GLOSS_END - GLOSS_START);
    if (gp >= 0 && gp <= 1) {
      this.gloss.alpha = triEnvelope(gp) * GLOSS_MAX_ALPHA;
      this.band.x = (-0.9 + 1.8 * gp) * this.cardW;
    } else {
      this.gloss.alpha = 0;
    }

    // 유니크만 헤일로(공개된 뒤 = 모서리 지난 뒤).
    this.updateHalo(shownTier, !beforeFold);
  }

  /** 표시를 숨긴다(진행 상태는 보존 — 재-show 없이 다시 보이려면 container.visible 만 켜도 된다). */
  hide(): void {
    this.container.visible = false;
    this.halo.visible = false;
  }

  /** 초기 상태로 되돌린다(진행 리셋 + 뒷면 + 숨김). 다음 정산 진입 시 재사용. */
  reset(): void {
    this.tiers = [];
    this.elapsed = 0;
    this._revealing = false;
    this.halo.visible = false;
    this.halo.alpha = 0;
    this.gloss.alpha = 0;
    this.card.scale.set(1, 1);
    this.builtValid = false;
    this.applyTier(null);
    this.tierText.text = '';
    this.container.visible = false;
  }

  /** 표시 객체를 통째 파괴한다(누수 방지). 파괴 후 API 는 무해한 no-op 이 된다. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.gloss.mask = null;
    this.container.destroy({ children: true });
  }

  // --- 내부 -----------------------------------------------------------------

  /** 앞면 등급을 교체(같은 등급이면 재그림 생략). 테두리·젬·라벨을 하나의 `col` 로 일관되게 칠한다. */
  private applyTier(tier: Rarity | null): void {
    if (this.builtValid && tier === this.builtTier) return;
    paintCardFace(this.faceG, tier, this.cardW, this.cardH);
    if (tier === null) {
      this.tierText.text = '';
      this.appliedColor = null;
    } else {
      const col = RARITY_COLOR_NUM[tier];
      this.tierText.text = stripEmoji(TIER_LABEL[tier]);
      this.tierText.style.fill = col;
      this.appliedColor = col;
    }
    this.builtTier = tier;
    this.builtValid = true;
  }

  /** 유니크 헤일로 맥동을 켜고/끈다. tier 가 유니크이고 allow 일 때만 표시. */
  private updateHalo(tier: Rarity | null, allow: boolean): void {
    if (tier === 'unique' && allow) {
      this.halo.visible = true;
      this.halo.alpha = haloPulse(this.elapsed);
      this.halo.scale.set(1 + 0.05 * Math.sin(this.elapsed * 2.4));
    } else {
      this.halo.visible = false;
    }
  }
}
