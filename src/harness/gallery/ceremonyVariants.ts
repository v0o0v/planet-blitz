/**
 * 보상 세리머니 변형군 (Phase 1 갤러리 — plan §AC-1.2 ⑥ / §AC-5.2).
 *
 * "런이 끝나고 보상을 펼쳐 보이는" 순간의 룩을 사용자가 고르게 하는 라이브 변형 2~3개다.
 * 전부 **메타(카툰나무풍)** 레지스터 — 따뜻한 나무 톤 + 등급 색만 쓰고 **전투 SF 글로우를
 * 차용하지 않는다**(ADR-0031 시각 레지스터 경계). 등급 문법은 CONTEXT.md 를 그대로 따른다:
 * 등급은 **테두리·글로우로 읽히고, 유니크만 고유하게 강조**한다(노말·매직·레어는 색 차이만).
 *
 * render-only(ADR-0005) — `src/sim/` 를 import 하지 않는다. 모든 진행은 순수함수(경과 → 위상 →
 * ease)라 결정론과 무관하고, 타이밍·ease 는 placeholder(defer-balance-tuning)다.
 *
 * Pixi Text 는 컬러 이모지를 두부로 떨군다 — 라벨은 한글/숫자/기본 글리프만 쓴다(셰이더 안 씀).
 * 표시 객체는 전부 Graphics/Text 로 절차적으로 그려 텍스처 비동기 로드 없이 **동기 spawn** 한다
 * (헤드리스 배선 스모크 AC-1.4 가 spawn 직후 child 증가를 검사하므로 GL 없이도 성립해야 한다).
 *
 * Phase 5 에서 resultOverlay 에 통합되므로(§AC-5.2), spawn/update/destroy 로 재사용 가능한 클린
 * 구조를 유지한다 — 각 변형은 셀 크기(ctx)에 맞춰 자기 세리머니 UI 를 그리고, ~3초 주기로 반복한다.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type {
  GalleryGroup,
  GalleryVariant,
  GalleryVariantContext,
  GalleryVariantHandle,
} from './types.js';
import type { Rarity } from '../../items/types.js';
import { RARITY_COLOR_NUM, COLOR, UI_FONT, TEXT_SHADOW } from '../../ui/pixi/theme.js';

// ── 순수 진행 함수 ─────────────────────────────────────────────────────────

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
/** 끝에서 부드럽게 멎는 감속(카운트업·슬라이드). */
function easeOutCubic(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}
/** 끝에서 살짝 넘어갔다 되돌아오는 오버슈트(도장 임팩트·정착 팝). 1 을 넘거나 밑돌 수 있다. */
function easeOutBack(t: number): number {
  const p = clamp01(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = p - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}
/** 삼각 엔벨로프(0→1→0) — 광택·반짝임의 페이드 인/아웃. */
function triEnvelope(p: number): number {
  const q = clamp01(p);
  return q < 0.5 ? q / 0.5 : (1 - q) / 0.5;
}

/** 천 단위 콤마(로케일 비의존, 인덱스 접근 안전하게 charAt 사용). */
function groupThousands(n: number): string {
  const s = Math.round(n).toString();
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s.charAt(i);
  }
  return out;
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

/** 따뜻한 나무 톤(명판·카드·메달 프레임). 전투 글로우 대신 이 톤으로만 깊이를 만든다. */
const WOOD = {
  edge: 0x341f0e,
  frame: 0x6b4522,
  bevel: 0x9a6733,
  face: 0x412a18,
} as const;

const TIER_ORDER: readonly Rarity[] = ['normal', 'magic', 'rare', 'unique'];
/** 모듈로로 항상 범위 안이지만 noUncheckedIndexedAccess 를 위해 폴백을 둔다. */
function tierAt(i: number): Rarity {
  return TIER_ORDER[((i % 4) + 4) % 4] ?? 'normal';
}
const TIER_LABEL: Record<Rarity, string> = {
  normal: '노말',
  magic: '매직',
  rare: '레어',
  unique: '유니크',
};

/** update(dt) 의 dt 는 초 단위 델타(types.ts JSDoc). 탭 복귀 등 큰 점프를 이 값으로 캡한다. */
const DT_CLAMP = 0.1;

// ── 공용 그리기 헬퍼 ───────────────────────────────────────────────────────

type Weight = '400' | '600' | '700' | '800';

/** 앵커 중앙(0.5)으로 배치되는 라벨 — bounds 를 읽지 않아 헤드리스에서도 안전하다. */
function mkText(text: string, size: number, fill: number, weight: Weight = '700'): Text {
  const tx = new Text({
    resolution: 2,
    text,
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

/** 원점 중심의 나무 명판(그림자→바깥테→프레임→베벨→안쪽 면). */
function woodPlaque(w: number, h: number): Graphics {
  const g = new Graphics();
  const r = 18;
  g.roundRect(-w / 2 + 4, -h / 2 + 6, w, h, r).fill({ color: 0x000000, alpha: 0.25 });
  g.roundRect(-w / 2, -h / 2, w, h, r).fill({ color: WOOD.edge });
  g.roundRect(-w / 2 + 5, -h / 2 + 5, w - 10, h - 10, r - 3).fill({ color: WOOD.frame });
  g.roundRect(-w / 2 + 8, -h / 2 + 8, w - 16, h - 16, r - 5)
    .stroke({ color: WOOD.bevel, width: 3, alignment: 0, alpha: 0.8 });
  g.roundRect(-w / 2 + 12, -h / 2 + 12, w - 24, h - 24, r - 7).fill({ color: WOOD.face });
  return g;
}

/** 원점 중심의 금화 한 닢(반경 r). 등급 무관 메타 재화 상징. */
function drawCoin(g: Graphics, cx: number, cy: number, r: number): void {
  g.circle(cx, cy, r).fill({ color: 0xffcf5a });
  g.circle(cx, cy, r).stroke({ color: 0x8a5a1e, width: Math.max(2, r * 0.18), alignment: 0 });
  g.circle(cx, cy, r * 0.62).stroke({ color: 0xfff0b0, width: Math.max(1, r * 0.08), alignment: 0, alpha: 0.7 });
  // 안쪽 마름모(₡ 대용 — 이모지 없이 재화 느낌).
  g.poly([cx, cy - r * 0.32, cx + r * 0.24, cy, cx, cy + r * 0.32, cx - r * 0.24, cy])
    .fill({ color: 0xb8801e, alpha: 0.85 });
}

/** 유니크 강조용 따뜻한 헤일로(셰이더 없이 동심원 저알파로 근사). 원점 중심. */
function warmHalo(radius: number, color: number): Graphics {
  const g = new Graphics();
  for (const f of [1.0, 0.78, 0.56, 0.36]) {
    g.circle(0, 0, radius * f).fill({ color, alpha: 0.06 });
  }
  return g;
}

// ── 변형 1: 코인 카운트업 + 나무 명판 (추천) ───────────────────────────────

/**
 * 나무 명판이 정착 팝으로 내려앉고, 크레딧 숫자가 0 에서 목표까지 감속 카운트업한다. 다 세면
 * 금색 반짝임 스파크가 톡 뜬다. 순수 메타(금화·크림·골드) — 등급 색은 쓰지 않는다.
 * 위상: [정착 팝]→[카운트업]→[유지+반짝임]→[페이드] 를 ~3.4초로 반복.
 */
function spawnCoinCount(target: Container, ctx: GalleryVariantContext): GalleryVariantHandle {
  const PERIOD = 3.4;
  const TARGET = 1840; // placeholder 크레딧(defer-balance-tuning).
  const w = clamp(ctx.width * 0.82, 180, 320);
  const h = clamp(ctx.height * 0.5, 110, 168);

  const root = new Container();
  root.position.set(ctx.width / 2, ctx.height / 2);
  target.addChild(root);

  const plaque = new Container();
  root.addChild(plaque);
  plaque.addChild(woodPlaque(w, h));

  plaque.addChild(mkText('보상 정산', 16, COLOR.muted, '600')).position.set(0, -h / 2 + 24);

  const coin = new Graphics();
  drawCoin(coin, -58, 8, Math.min(20, h * 0.16));
  plaque.addChild(coin);

  const num = mkText('0', 40, COLOR.gold, '800');
  num.position.set(16, 8);
  plaque.addChild(num);

  plaque.addChild(mkText('크레딧', 14, COLOR.muted, '400')).position.set(6, 44);

  const spark = new Graphics();
  spark.poly(starPoints(0, 0, 10, 4, 4)).fill({ color: 0xfff2c0 });
  spark.position.set(w / 2 - 34, -h / 2 + 30);
  spark.alpha = 0;
  plaque.addChild(spark);

  let elapsed = 0;
  return {
    update(dt: number): void {
      elapsed += clamp(dt, 0, DT_CLAMP);
      const p = elapsed % PERIOD;

      // 정착 팝(0~0.42s) — 오버슈트로 톡 내려앉는다.
      const pop = p < 0.42 ? 0.92 + 0.08 * easeOutBack(p / 0.42) : 1;
      plaque.scale.set(pop);

      // 페이드: 앞 0.28s 진입, 뒤 0.36s 이탈(숫자 리셋을 숨긴다).
      const fadeIn = easeOutCubic(clamp01(p / 0.28));
      const fadeOut = p > PERIOD - 0.36 ? 1 - clamp01((p - (PERIOD - 0.36)) / 0.36) : 1;
      root.alpha = Math.min(fadeIn, fadeOut);

      // 카운트업(0.22s~1.72s).
      const cp = easeOutCubic(clamp01((p - 0.22) / 1.5));
      num.text = groupThousands(TARGET * cp);
      num.scale.set(1 + 0.05 * Math.sin(elapsed * 3) * (cp >= 1 ? 1 : 0)); // 다 세면 숨쉬기.

      // 금화 살짝 흔들-반짝(항상).
      coin.rotation = Math.sin(elapsed * 2.2) * 0.12;

      // 완료 스파크(1.7s~2.6s) 톡 떴다 사라짐.
      const se = triEnvelope((p - 1.7) / 0.9);
      spark.alpha = se;
      spark.scale.set(0.5 + se * 0.8);
      spark.rotation = elapsed * 1.5;
    },
    destroy(): void {
      root.destroy({ children: true });
    },
  };
}

// ── 변형 2: 전리품 등급 공개 (카드 플립/광택) ──────────────────────────────

/** 카드 앞면을 등급색 테두리 + 젬으로 다시 그린다(등급은 테두리·젬으로 읽힌다). */
function paintLootFace(g: Graphics, tier: Rarity, w: number, h: number): void {
  const col = RARITY_COLOR_NUM[tier];
  const unique = tier === 'unique';
  g.clear();
  g.roundRect(-w / 2 + 3, -h / 2 + 5, w, h, 14).fill({ color: 0x000000, alpha: 0.25 });
  g.roundRect(-w / 2, -h / 2, w, h, 14).fill({ color: WOOD.edge });
  g.roundRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8, 11).fill({ color: WOOD.frame });
  const iw = w - 16;
  const ih = h - 16;
  g.roundRect(-iw / 2, -ih / 2, iw, ih, 8).fill({ color: WOOD.face });
  // 등급 테두리 — 유니크만 굵고 밝게(고유 강조).
  g.roundRect(-iw / 2, -ih / 2, iw, ih, 8)
    .stroke({ color: col, width: unique ? 5 : 3, alignment: 0, alpha: 0.95 });
  // 등급 젬(유니크는 6각 별, 그 외 4각 다이아).
  const gemY = -ih * 0.16;
  const gemR = iw * 0.22;
  g.poly(starPoints(0, gemY, gemR, gemR * 0.46, unique ? 6 : 4))
    .fill({ color: col })
    .stroke({ color: WOOD.edge, width: 2, alignment: 0 });
  if (unique) g.circle(0, gemY, gemR * 0.28).fill({ color: 0xfff2d0, alpha: 0.85 });
}

/**
 * 전리품 카드가 모서리로 접혔다(scaleX→0) 다음 등급으로 펼쳐지며(→1) 공개되고, 공개 직후 대각
 * 광택이 앞면을 훑는다. 노말→매직→레어→유니크를 순서대로 돌며, 유니크에서만 따뜻한 헤일로가
 * 맥동한다(유니크만 고유 강조). 위상: [플립아웃]→(등급 교체)→[플립인]→[광택 스윕]→[유지] ~3.0초.
 */
function spawnLootReveal(target: Container, ctx: GalleryVariantContext): GalleryVariantHandle {
  const PERIOD = 3.0;
  const FLIP = 0.5; // 앞 0.5초에 플립 완료.
  const cardW = clamp(Math.min(ctx.width * 0.5, ctx.height * 0.6), 118, 210);
  const cardH = cardW * 1.32;

  const root = new Container();
  root.position.set(ctx.width / 2, ctx.height / 2);
  target.addChild(root);

  // 유니크 헤일로(카드 뒤).
  const halo = warmHalo(cardW * 0.95, RARITY_COLOR_NUM.unique);
  halo.visible = false;
  root.addChild(halo);

  const card = new Container();
  root.addChild(card);

  const faceG = new Graphics();
  card.addChild(faceG);

  card.addChild(mkText('전리품', 14, COLOR.muted, '600')).position.set(0, -cardH / 2 + 20);
  const tierText = mkText('', Math.round(cardW * 0.16), RARITY_COLOR_NUM.normal, '800');
  tierText.position.set(0, cardH * 0.2);
  card.addChild(tierText);

  // 광택 스윕(마스크로 카드 안쪽에 가둔다).
  const maskG = new Graphics();
  const miw = cardW - 16;
  const mih = cardH - 16;
  maskG.roundRect(-miw / 2, -mih / 2, miw, mih, 8).fill({ color: 0xffffff });
  card.addChild(maskG);

  const gloss = new Container();
  const glossW = cardW * 0.34;
  const band = new Graphics();
  band.rect(-glossW / 2, -cardH, glossW, cardH * 2).fill({ color: 0xffffff, alpha: 0.14 });
  band.rect(-glossW / 6, -cardH, glossW / 3, cardH * 2).fill({ color: 0xffffff, alpha: 0.12 });
  band.rotation = -0.32;
  gloss.addChild(band);
  gloss.mask = maskG;
  gloss.alpha = 0;
  card.addChild(gloss);

  let elapsed = 0;
  let builtTier: Rarity | null = null;

  const applyTier = (tier: Rarity): void => {
    if (tier === builtTier) return;
    paintLootFace(faceG, tier, cardW, cardH);
    tierText.text = TIER_LABEL[tier];
    tierText.style.fill = RARITY_COLOR_NUM[tier];
    builtTier = tier;
  };
  applyTier(tierAt(-1)); // 첫 프레임 전 초기 앞면(직전 등급).

  return {
    update(dt: number): void {
      elapsed += clamp(dt, 0, DT_CLAMP);
      const cycle = Math.floor(elapsed / PERIOD);
      const p = elapsed % PERIOD;

      // 플립 위상: scaleX = |cos(pi·t)| (1→0→1). 모서리(0)를 지나며 등급을 교체한다.
      const ft = clamp01(p / FLIP);
      const scaleX = Math.abs(Math.cos(Math.PI * ft));
      card.scale.set(Math.max(0.02, scaleX), 1);
      // 모서리 이전엔 직전 등급, 이후엔 이번 등급을 보여준다(교체가 모서리에서 숨겨진다).
      applyTier(tierAt(p < FLIP * 0.5 ? cycle - 1 : cycle));

      const tier = tierAt(cycle);

      // 광택 스윕(플립 후 0.55s~1.9s): 왼→오 슬라이드 + 삼각 페이드.
      const gp = (p - 0.55) / 1.35;
      if (gp >= 0 && gp <= 1) {
        gloss.alpha = triEnvelope(gp) * 0.9;
        band.x = (-0.9 + 1.8 * gp) * cardW;
      } else {
        gloss.alpha = 0;
      }

      // 유니크만 헤일로 맥동.
      if (tier === 'unique' && p > FLIP) {
        halo.visible = true;
        const pulse = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(elapsed * 2.4));
        halo.alpha = pulse;
        halo.scale.set(1 + 0.05 * Math.sin(elapsed * 2.4));
      } else {
        halo.visible = false;
      }
    },
    destroy(): void {
      gloss.mask = null;
      root.destroy({ children: true });
    },
  };
}

// ── 변형 3: 배지 도장 찍기 ─────────────────────────────────────────────────

/** 원점 중심의 나무 메달(등급색 별 + 금 테). tier 로 별·라벨 색을 정한다. */
function paintBadge(g: Graphics, tier: Rarity, r: number): void {
  const col = RARITY_COLOR_NUM[tier];
  const unique = tier === 'unique';
  g.clear();
  g.circle(0, 0, r).fill({ color: WOOD.frame });
  g.circle(0, 0, r).stroke({ color: WOOD.edge, width: Math.max(2, r * 0.14), alignment: 0 });
  g.circle(0, 0, r * 0.72).fill({ color: WOOD.face });
  g.circle(0, 0, r * 0.72).stroke({ color: COLOR.gold, width: Math.max(2, r * 0.06), alignment: 0, alpha: 0.9 });
  g.poly(starPoints(0, 0, r * 0.5, r * 0.22, unique ? 6 : 5))
    .fill({ color: col })
    .stroke({ color: WOOD.edge, width: 2, alignment: 0 });
  if (unique) g.circle(0, 0, r * 0.14).fill({ color: 0xfff2d0, alpha: 0.85 });
}

/**
 * "정산 완료" 인장이 크게 떠 있다 오버슈트로 쾅 찍히고, 착지 순간 따뜻한 링 파동이 퍼진다.
 * 별·라벨 색이 등급을 따라가고(노말→…→유니크 순환), 유니크에서만 헤일로가 맥동한다.
 * 위상: [강하+슬램]→[링 파동]→[유지(숨쉬기)]→[페이드] 를 ~3.0초로 반복.
 */
function spawnBadge(target: Container, ctx: GalleryVariantContext): GalleryVariantHandle {
  const PERIOD = 3.0;
  const LAND = 0.42; // 착지 시점.
  const r = clamp(Math.min(ctx.width, ctx.height) * 0.24, 44, 92);

  const root = new Container();
  root.position.set(ctx.width / 2, ctx.height / 2);
  target.addChild(root);

  const halo = warmHalo(r * 1.7, RARITY_COLOR_NUM.unique);
  halo.visible = false;
  root.addChild(halo);

  // 착지 링 파동(배지와 함께 커지지 않도록 root 직속).
  const ring = new Graphics();
  root.addChild(ring);

  const title = mkText('정산 완료', Math.round(r * 0.4), COLOR.cream, '800');
  title.position.set(0, -r * 1.45);
  root.addChild(title);

  const badge = new Container();
  root.addChild(badge);
  const badgeG = new Graphics();
  badge.addChild(badgeG);
  const tierLabel = mkText('', Math.round(r * 0.34), RARITY_COLOR_NUM.normal, '700');
  tierLabel.position.set(0, r * 1.12);
  root.addChild(tierLabel);

  let elapsed = 0;
  let builtTier: Rarity | null = null;
  const applyTier = (tier: Rarity): void => {
    if (tier === builtTier) return;
    paintBadge(badgeG, tier, r);
    tierLabel.text = TIER_LABEL[tier];
    tierLabel.style.fill = RARITY_COLOR_NUM[tier];
    builtTier = tier;
  };
  applyTier(tierAt(0));

  return {
    update(dt: number): void {
      elapsed += clamp(dt, 0, DT_CLAMP);
      const cycle = Math.floor(elapsed / PERIOD);
      const p = elapsed % PERIOD;
      const tier = tierAt(cycle);

      // 페이드 아웃 구간에서 다음 등급으로 교체(숨겨진 리셋).
      const fadeOut = p > PERIOD - 0.4 ? 1 - clamp01((p - (PERIOD - 0.4)) / 0.4) : 1;
      if (fadeOut < 0.15) applyTier(tier);
      else applyTier(builtTier ?? tier);

      // 슬램(0~LAND): scale 2.3 → ~1(오버슈트로 착지 임팩트).
      let scale: number;
      let alpha: number;
      if (p < LAND) {
        const t = p / LAND;
        scale = 1 + (2.3 - 1) * (1 - easeOutBack(t));
        alpha = easeOutCubic(clamp01(p / 0.12));
      } else {
        scale = 1 + 0.02 * Math.sin(elapsed * 2); // 유지 숨쉬기.
        alpha = 1;
      }
      badge.scale.set(scale);
      badge.alpha = alpha;
      root.alpha = fadeOut;

      // 제목·등급 라벨은 착지 후 페이드 인.
      const labelIn = easeOutCubic(clamp01((p - LAND) / 0.3));
      title.alpha = labelIn;
      tierLabel.alpha = labelIn;

      // 착지 링 파동(LAND~LAND+0.5): 반경 확장 + 알파 감쇠.
      const rp = (p - LAND) / 0.5;
      ring.clear();
      if (rp >= 0 && rp <= 1) {
        const rr = r * (1 + rp * 1.5);
        ring.circle(0, 0, rr).stroke({
          color: COLOR.gold,
          width: Math.max(2, r * 0.08 * (1 - rp)),
          alignment: 0,
          alpha: (1 - rp) * 0.55,
        });
      }

      // 유니크만 헤일로 맥동.
      if (tier === 'unique' && p >= LAND) {
        halo.visible = true;
        halo.alpha = (0.6 + 0.4 * (0.5 + 0.5 * Math.sin(elapsed * 2.4))) * fadeOut;
        halo.scale.set(1 + 0.05 * Math.sin(elapsed * 2.4));
      } else {
        halo.visible = false;
      }
    },
    destroy(): void {
      root.destroy({ children: true });
    },
  };
}

// ── 그룹 export ───────────────────────────────────────────────────────────

const variants: GalleryVariant[] = [
  {
    id: 'ceremony-coincount',
    label: '코인 카운트업',
    recommended: true,
    spawn: spawnCoinCount,
  },
  {
    id: 'ceremony-lootreveal',
    label: '전리품 등급 공개',
    spawn: spawnLootReveal,
  },
  {
    id: 'ceremony-badge',
    label: '배지 도장',
    spawn: spawnBadge,
  },
];

export const ceremonyGroup: GalleryGroup = {
  id: 'ceremony',
  title: '보상 세리머니',
  register: 'meta',
  variants,
};
