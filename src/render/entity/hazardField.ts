/**
 * 해저드 **장판 재질** — 기하학 도형을 물질로 바꾸는 층.
 *
 * ## 1차 통합이 왜 반려됐는가 (이 파일의 현재 설계는 그 반성이다)
 * 1차 구현은 코드가 대부분 옳았는데 **화면에 도달하지 못했다.** 세 가지가 동시에 틀렸다.
 *
 * 1. **모든 겹이 `heat` 에 곱해져 있었다.** 박격 장판은 예열로 등장해 활성 창이 8틱(≈0.13초)
 *    뿐이고 직후 소멸한다 → 상승률 3.2/s 로 피크 0.43, 예열 내내 정확히 0. 실측 겹별 알파가
 *    `로브 5개 전부 0 · edge visible=false · motes visible=false` 였다. **예열은 탄막 게임에서
 *    가장 오래 보이는 상태다** — 거기에 예산을 덜 쓰는 설계가 틀렸다. 지금은
 *    {@link materialIntensity} 가 존재(presence)를 바닥으로 보장하고 예열↔활성을 **강도·색·
 *    운동 속도**로 가른다.
 * 2. **예산을 개체 수로 깎았다**(`MAX_FIELD_MATERIALS = 10`). 실제 장판이 톡사르 41개·크라스
 *    23개라, 나란한 오염 셀 넷 중 하나만 재질을 갖고 셋은 변경 전 그대로 → 같은 해저드가 두
 *    스타일로 그려져 **렌더링 버그로 읽혔다.** 지금은 개체가 아니라 **겹**을 깎고
 *    ({@link hazardLod}), 유기적 실루엣은 `drawHazardZone` 이 **전 장판에** 그려 정체성을 통일한다.
 * 3. **로브 5개가 너무 커서** 서로 겹쳐 하나의 큰 덩어리가 되고 그 위에 밝은 코어가 얹혀
 *    **렌즈 플레어 스티커**로 읽혔다. 지금은 작고(0.12~0.30r) 많고(14개) 각자 태어나-부풀고-
 *    터지는 수명을 갖는다({@link lobeLife}).
 *
 * ## 이 모듈이 얹는 겹 — 그리고 **얹기만 한다**
 * 유기적 실루엣(불규칙 채움·경계선·안쪽 립)은 `drawHazardZone` 소유이고 전 장판에 적용된다.
 * 이 모듈은 그 위에 디테일을 더한다:
 *
 * | 겹 | 무엇 | LOD |
 * |---|---|---|
 * | 환경 기여 | 넓고 옅은 발광/안개(공유 그라디언트 텍스처 1장) | 전부 |
 * | 고조 | 예열 압력이 차오르는 유기 원반 | 전부 |
 * | 본체 로브 | 태어나-부풀고-터지는 작은 개체 14개 | full·mid |
 * | 접지 | 광원 반대쪽 접촉 그늘 + 광원 쪽 림 | full |
 * | 입자 | 불티·포자·결정 | full |
 *
 * ## 비용 규율 — 장판이 41개인 모드가 이 파일의 설계 제약이다
 * 1. **매 프레임 `Graphics` 재굽기 0.** 모든 겹은 부착 시 한 번 굽고 이후 `rotation`/`scale`/
 *    `alpha`/`tint` 만 쓴다. 1차에 있던 경계 폴리곤 주기적 재굽기는 **통째로 사라졌다** —
 *    실루엣을 `drawHazardZone` 이 가져가면서 이 모듈의 마지막 재빌드가 없어졌다.
 * 2. **환경 기여는 공유 텍스처 스프라이트 1장.** 1차의 동심원 5겹은 드로우콜 5개였고, 알파를
 *    올리는 순간 계단 밴딩이 드러날 물건이었다. 텍스처는 전 장판이 공유한다(굽기 1회).
 * 3. **겹 LOD**로 깎는다(개체가 아니라). 먼 것부터 입자 → 접지 → 로브 순으로 빠진다.
 * 4. 셰이더 필터를 장판마다 만들지 **않는다**. 용암류 왜곡은 `lavaOverlay` 에 걸린 **공유
 *    시머 하나**가 담당한다(AC-3.2).
 *
 * ## 계약
 * - **render-only**(ADR-0005). `src/sim/` 은 상수·타입만 읽는다. `hashWorld` 무접촉.
 * - 모든 겹이 `gates`·`tier` 뒤에 있고 `reducedMotion`/`reducedGlow` 를 존중한다.
 * - **재질은 자기 색을 선언하지 않는다.** 전부 `zone.visual.color`↔`accent` 보간이다.
 * - {@link HazardFieldMaterial.dispose} 가 자기 컨테이너를 직접 떼고 파괴한다.
 */

import { Container, Graphics, Sprite, Texture } from 'pixi.js';

import { HAZARD_LAVA, HAZARD_MORTAR, HAZARD_SLOW } from '../../sim/patterns/types.js';
import { HAZARD_CONTAMINATION } from '../../sim/modes/contamination.js';
import { graphicsSettings } from '../graphicsSettings.js';
import {
  registerHazardMaterialFactory,
  type HazardHostContext,
  type HazardMaterial,
  type HazardZone,
} from './hazardHost.js';
import {
  MAX_FIELD_MATERIALS,
  edgePolygon,
  hazardAmbience,
  hazardAmbienceShape,
  hazardGrounding,
  hazardLod,
  hazardMaterialKind,
  lobeAt,
  lobeLife,
  lobeSpin,
  lodHasGrounding,
  lodHasMotes,
  lodLobeCount,
  materialIntensity,
  mixColor,
  moteAt,
  moteBudget,
  moteRise,
  stepCharge,
  stepHeat,
  type HazardLod,
  type HazardMaterialKind,
} from './hazardShape.js';

/** 살아있는 재질 수(안전 밸브 판정). `dispose` 에서 준다. */
let liveMaterials = 0;
/**
 * 부착 순번 카운터 = LOD 배정 축. **회수해도 되돌리지 않는다** — 되돌리면 살아 있는 장판들의
 * LOD 가 재배정돼 화면이 튄다. `resetHazardFieldBudget` 만 0 으로 돌린다.
 */
let attachCursor = 0;

/** 현재 살아있는 재질 수(테스트·진단 관측창). */
export function hazardFieldLiveCount(): number {
  return liveMaterials;
}

// ---------------------------------------------------------------------------
// 공유 radial gradient 텍스처 — 환경 기여의 유일한 그림
// ---------------------------------------------------------------------------

/** 그라디언트 텍스처 한 변(px). 넓게 늘려 쓰는 용도라 해상도가 낮아도 계단이 안 보인다. */
const GLOW_TEX_SIZE = 128;

/**
 * 전 장판이 공유하는 방사 그라디언트. `undefined` = 아직 시도 안 함, `null` = 만들 수 없음.
 *
 * node(vitest)에는 `document` 가 없어 생성이 실패한다 — 그때는 {@link buildAmbientFallback} 의
 * 동심원으로 물러난다(`shaders/index.ts` 의 `tryCreateFilter` 와 같은 "실패는 예외가 아니라
 * 폴백" 관용구). 테스트가 GL·DOM 없이 그대로 돌아야 하기 때문이다.
 */
let sharedGlowTexture: Texture | null | undefined;

function radialGlowTexture(): Texture | null {
  if (sharedGlowTexture !== undefined) return sharedGlowTexture;
  sharedGlowTexture = null;
  try {
    const cv = document.createElement('canvas');
    cv.width = GLOW_TEX_SIZE;
    cv.height = GLOW_TEX_SIZE;
    const c2 = cv.getContext('2d');
    if (c2 === null) return sharedGlowTexture;
    const h = GLOW_TEX_SIZE / 2;
    const grd = c2.createRadialGradient(h, h, 0, h, h, h);
    // 중앙이 완전 불투명이면 넓게 늘렸을 때 가운데가 하얗게 뜬다 — 코어부터 이미 반투명이고
    // 바깥으로 부드럽게 죽는 곡선이라야 "번짐"으로 읽힌다.
    grd.addColorStop(0, 'rgba(255,255,255,0.95)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.42)');
    grd.addColorStop(0.7, 'rgba(255,255,255,0.12)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    c2.fillStyle = grd;
    c2.fillRect(0, 0, GLOW_TEX_SIZE, GLOW_TEX_SIZE);
    sharedGlowTexture = Texture.from(cv);
  } catch {
    sharedGlowTexture = null;
  }
  return sharedGlowTexture;
}

/** 공유 텍스처 캐시를 비운다. **테스트 격리 전용**. */
export function resetHazardFieldGlowTexture(): void {
  sharedGlowTexture = undefined;
}

// ---------------------------------------------------------------------------
// 종류별 표현 파라미터 — "무엇이 어떻게 움직이는가"
// ---------------------------------------------------------------------------

/** 로브의 운동 방식. 재질감의 정체는 결국 **운동**이라, 종류마다 달라야 구분된다. */
type LobeMotion = 'flow' | 'bubble' | 'lens' | 'still';

interface KindStyle {
  readonly motion: LobeMotion;
  /** 로브를 채우는가(false = 테두리만 — 굴절장은 채우면 시야를 가린다). */
  readonly filled: boolean;
  /** 로브 밝기 보간 계수(accent 쪽으로 얼마나 밝히는가). */
  readonly brightMix: number;
  /**
   * 로브 알파. 1차의 0.34~0.5 에서 크게 내렸다 — 개수가 5→14 로 늘어 **가산 누적**이 그만큼
   * 커졌기 때문이다(밝기 총량 예산 §2-4). 같은 화면 밝기를 더 많은 개체가 나눠 갖는다.
   */
  readonly lobeAlpha: number;
}

const KIND_STYLE: Readonly<Record<HazardMaterialKind, KindStyle>> = {
  molten: { motion: 'flow', filled: true, brightMix: 0.72, lobeAlpha: 0.22 },
  spore: { motion: 'bubble', filled: true, brightMix: 0.35, lobeAlpha: 0.2 },
  refract: { motion: 'lens', filled: false, brightMix: 0.55, lobeAlpha: 0.26 },
  scorch: { motion: 'still', filled: true, brightMix: 0.18, lobeAlpha: 0.18 },
  ember: { motion: 'flow', filled: true, brightMix: 0.55, lobeAlpha: 0.2 },
};

/** 반경 대비 접촉 그늘 띠 두께. */
const CONTACT_BAND = 0.16;
/** 반경 대비 림 하이라이트 띠 두께. 그늘보다 **좁아야** 가장자리가 선다. */
const RIM_BAND = 0.055;
/** 접지 겹이 덮는 호의 반각(라디안). */
const GROUND_ARC_HALF = Math.PI * 0.52;
/** 폴백 환경 기여의 동심원 수(텍스처를 못 만드는 환경에서만 쓴다). */
const AMBIENT_FALLBACK_RINGS = 5;
/** 로브 폴리곤 꼭짓점 수. 작은 개체라 적어도 유기적으로 읽힌다. */
const LOBE_POINTS = 10;

/**
 * 재질이 붙는 최소 반경. `DECOR_MIN_RADIUS`(40)와 같은 값이지만 **호스트의 프레임당 예산과는
 * 무관하게** 반경만 본다 — 그 값은 매 프레임 뒤집히기 때문이다(아래 {@link fieldFactory} 주석).
 */
export const FIELD_MIN_RADIUS = 40;

// ---------------------------------------------------------------------------
// 재질 본체
// ---------------------------------------------------------------------------

class HazardFieldMaterial implements HazardMaterial {
  readonly name: string;

  private readonly root = new Container();
  /** 환경 기여(가산 발광 또는 대기 안개). 장판 **밖**까지 나가는 유일한 겹. */
  private readonly ambient = new Container();
  /** 접촉 그늘(곱연산) — 장판이 지면에 파여 있음. */
  private readonly contact = new Graphics();
  /** 림 하이라이트(광원 쪽 안쪽 가장자리). */
  private readonly rim = new Graphics();
  /** 본체 로브들. 각자 독립적으로 태어나고 터진다. */
  private readonly lobeLayer = new Container();
  private readonly lobes: Graphics[] = [];
  /** 예열 고조 원반. */
  private readonly charge = new Graphics();
  /** 입자(불티·포자·결정). */
  private readonly moteLayer = new Container();
  private readonly motes: Graphics[] = [];

  private heat = 0;
  private chargeLevel = 0;
  private builtRadius = 0;
  private builtMotes = -1;
  private disposed = false;
  private attached = false;

  constructor(
    private readonly kind: HazardMaterialKind,
    private readonly seed: number,
    /** 부착 순번이 정한 상세 단계. **수명 내내 바뀌지 않는다.** */
    private readonly lod: HazardLod,
  ) {
    this.name = `hazardField:${kind}:${lod}`;
    // Pixi `label` 을 박는다 — 계약 §2-4 의 **귀속 절차**가 이것을 요구한다: 통합 화면에서
    // 레인별 밝기 기여를 가르려면 겹을 하나씩 `visible=false` 로 끄고 같은 정지 프레임을 다시
    // 찍어야 하고, 그러려면 stage 를 훑어 찾을 이름이 있어야 한다. 1차 판정 때 비평가가 겹별
    // 알파를 손으로 추적해야 했던 것도 이 이름이 없었기 때문이다.
    this.root.label = this.name;
    this.ambient.label = 'hazardAmbient';
    this.contact.label = 'hazardContact';
    this.rim.label = 'hazardRim';
    this.lobeLayer.label = 'hazardLobes';
    this.charge.label = 'hazardCharge';
    this.moteLayer.label = 'hazardMotes';
    this.contact.blendMode = 'multiply';
    this.rim.blendMode = 'add';
    this.lobeLayer.blendMode = 'add';
    this.moteLayer.blendMode = 'add';
    this.charge.blendMode = 'add';
    // 아래→위: 환경 기여 → 접촉 그늘 → 로브 → 림 → 고조 → 입자.
    // 접촉 그늘이 로브 **아래**여야 "파인 바닥에 물질이 고여 있다"로 읽힌다.
    this.root.addChild(this.ambient);
    this.root.addChild(this.contact);
    this.root.addChild(this.lobeLayer);
    this.root.addChild(this.rim);
    this.root.addChild(this.charge);
    this.root.addChild(this.moteLayer);
  }

  onAttach(zone: HazardZone, ctx: HazardHostContext): void {
    ctx.layer.addChild(this.root);
    this.attached = true;
    this.chargeLevel = zone.active ? 0 : 0.35;
    this.heat = zone.active ? 1 : 0;
    this.build(zone, ctx);
  }

  onFrame(zone: HazardZone, ctx: HazardHostContext): void {
    if (this.disposed) return;
    const settings = graphicsSettings.getSettings();
    const tick = settings.reducedMotion ? 0 : ctx.frameTick;
    this.heat = stepHeat(this.heat, zone.active, ctx.dt);
    this.chargeLevel = stepCharge(this.chargeLevel, zone.active, ctx.dt);

    // 예열↔활성은 **존재 여부가 아니라 강도·색·운동 속도**로 갈린다(1차 반려의 핵심 교훈).
    const it = materialIntensity(this.heat);
    this.root.position.set(zone.x, zone.y);

    const wantMotes = lodHasMotes(this.lod) ? moteBudget(ctx.tier, ctx.gates) : 0;
    if (
      Math.abs(zone.radius - this.builtRadius) > this.builtRadius * 0.02 ||
      wantMotes !== this.builtMotes
    ) {
      this.build(zone, ctx);
    }

    // ── 환경 기여 ────────────────────────────────────────────────────────────
    const amb = hazardAmbience(this.kind, ctx.tier, ctx.gates);
    if (amb === null) {
      this.ambient.visible = false;
    } else {
      this.ambient.visible = true;
      const pulse = settings.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(tick * 0.035);
      // 예열에도 기여가 남는다(presence 바닥) — "곧 온다"의 환경 신호다.
      this.ambient.alpha = amb.alpha * it.presence * (0.72 + 0.28 * pulse);
      const s = 0.86 + 0.14 * this.heat + 0.06 * pulse;
      this.ambient.scale.set(s, s * 0.88); // 세로 압축 = 바닥에 누운 빛무리.
    }

    // ── 본체 로브 ────────────────────────────────────────────────────────────
    const style = KIND_STYLE[this.kind];
    this.lobeLayer.visible = this.lobes.length > 0;
    if (this.lobeLayer.visible) {
      this.lobeLayer.alpha = it.presence;
      // 색은 tint 로 민다: 예열은 어둡고 탁하게, 활성은 구운 그대로 밝게. tint 는 곱연산이라
      // **새 색을 만들 수 없다** — 색=성질 규칙이 여기로 샐 구조적 여지가 없다.
      const w = Math.round(255 * (0.45 + 0.55 * it.warmth));
      this.lobeLayer.tint = (w << 16) | (w << 8) | w;
      for (let i = 0; i < this.lobes.length; i++) {
        const g = this.lobes[i];
        if (g === undefined) continue;
        const lobe = lobeAt(this.seed, i, this.builtRadius);
        if (style.motion === 'still') {
          g.alpha = 0.55 + 0.45 * lobe.bright;
          continue;
        }
        const life = lobeLife(this.seed, i, tick, it.speed);
        const ph = lobe.phase + tick * lobeSpin(this.seed, i) * it.speed;
        switch (style.motion) {
          case 'flow':
            g.rotation = ph;
            g.scale.set(life.scale);
            break;
          case 'bubble':
            g.scale.set(life.scale);
            break;
          case 'lens':
            g.rotation = ph;
            // 굴절: 가로세로가 반대로 늘어나 렌즈가 왜곡하는 것으로 읽힌다.
            g.scale.set(life.scale, life.scale * (0.82 + 0.36 * Math.cos(ph * 2.3)));
            break;
        }
        g.alpha = life.alpha * (0.55 + 0.45 * lobe.bright);
      }
    }

    // ── 접지 ─────────────────────────────────────────────────────────────────
    // 예열에도 접지가 남는다: 장판이 지면에 파여 있다는 사실은 뜨거운지와 무관하다.
    this.contact.alpha = it.presence;
    this.rim.alpha = it.presence * (ctx.gates.halo ? 1 : 0.45);

    // ── 예열 고조 ────────────────────────────────────────────────────────────
    const ch = this.chargeLevel;
    this.charge.visible = ch > 0.02;
    if (this.charge.visible) {
      const grow = 0.2 + 0.8 * ch;
      this.charge.scale.set(grow, grow * 0.94);
      const beat = settings.reducedMotion ? 1 : 0.72 + 0.28 * Math.sin(tick * (0.05 + 0.09 * ch));
      this.charge.alpha = ch * ch * beat;
    }

    // ── 입자 ─────────────────────────────────────────────────────────────────
    this.moteLayer.visible = this.motes.length > 0;
    if (this.moteLayer.visible) {
      const rise = moteRise(this.kind);
      this.moteLayer.alpha = it.presence;
      for (let i = 0; i < this.motes.length; i++) {
        const g = this.motes[i];
        if (g === undefined) continue;
        const m = moteAt(this.seed, i, this.builtRadius, tick * it.speed, rise);
        g.position.set(m.x, m.y);
        g.alpha = m.alpha;
        g.scale.set(m.r);
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    liveMaterials--;
    if (this.attached) {
      this.root.removeFromParent();
      this.attached = false;
    }
    this.root.destroy({ children: true });
    this.lobes.length = 0;
    this.motes.length = 0;
  }

  // -------------------------------------------------------------------------
  // 굽기 — 부착 시 한 번(+반경·입자 예산 변경 시). 매 프레임 호출되지 않는다.
  // -------------------------------------------------------------------------

  private build(zone: HazardZone, ctx: HazardHostContext): void {
    const r = zone.radius > 0 ? zone.radius : 1;
    this.builtRadius = r;
    const color = zone.visual.color;
    const accent = zone.visual.accent;

    this.buildAmbient(r, color, accent);
    this.buildGrounding(r, color, accent, ctx);
    this.buildLobes(r, color, accent);
    this.buildCharge(r, color, accent);
    this.buildMotes(color, accent, lodHasMotes(this.lod) ? moteBudget(ctx.tier, ctx.gates) : 0);
  }

  /**
   * 환경 기여. 공유 그라디언트 텍스처 스프라이트 **1장**이다(드로우콜 1 · 밴딩 0). 텍스처를
   * 만들 수 없는 환경에서만 동심원으로 물러난다.
   */
  private buildAmbient(r: number, color: number, accent: number): void {
    for (const c of this.ambient.removeChildren()) c.destroy();
    const shape = hazardAmbienceShape(this.kind);
    this.ambient.blendMode = shape.additive ? 'add' : 'normal';
    const tint = mixColor(color, accent, this.kind === 'spore' ? 0 : 0.18);
    const tex = radialGlowTexture();
    if (tex !== null) {
      const sp = new Sprite(tex);
      sp.anchor.set(0.5);
      sp.tint = tint;
      // 텍스처 한 변이 기여 지름에 대응하도록 맞춘다.
      sp.scale.set((r * shape.scale * 2) / GLOW_TEX_SIZE);
      this.ambient.addChild(sp);
      return;
    }
    this.ambient.addChild(buildAmbientFallback(r * shape.scale, tint));
  }

  /** 접촉 그늘 + 림. **방향은 전적으로 테마 광원에서 나온다**(여기 방향 상수는 없다). */
  private buildGrounding(r: number, color: number, accent: number, ctx: HazardHostContext): void {
    this.contact.clear();
    this.rim.clear();
    if (!lodHasGrounding(this.lod)) return;
    const gr = hazardGrounding(ctx.theme?.light ?? null);
    if (gr.rimAlpha <= 0 && gr.shadowAlpha <= 0) return;
    const la = Math.atan2(gr.ly, gr.lx);
    const shadowMid = la + Math.PI;
    for (let i = 0; i < 3; i++) {
      const t = i / 2;
      this.contact
        .arc(
          0,
          0,
          r * (0.94 - CONTACT_BAND * 0.5 * t),
          shadowMid - GROUND_ARC_HALF * (1 - 0.18 * t),
          shadowMid + GROUND_ARC_HALF * (1 - 0.18 * t),
        )
        .stroke({
          color: 0x05070c,
          width: r * CONTACT_BAND * (1 - 0.25 * t),
          alpha: gr.shadowAlpha * (0.5 - 0.14 * t),
        });
    }
    this.rim
      .arc(0, 0, r * 0.955, la - GROUND_ARC_HALF * 0.82, la + GROUND_ARC_HALF * 0.82)
      .stroke({
        color: mixColor(color, accent, 0.55),
        width: r * RIM_BAND,
        alpha: gr.rimAlpha,
      });
  }

  /**
   * 본체 로브. 각 로브는 자기 `Graphics` 라 독립적으로 태어나고 터진다(재굽기 0).
   *
   * **밝은 `inner` 코어를 넣지 않는다.** 1차에서 그것이 로브 위에 흰 점을 찍어 "렌즈 플레어"로
   * 읽히게 만든 원인이었다. 깊이감은 코어가 아니라 로브마다 다른 `bright` 와 겹침의 통계에서 나온다.
   */
  private buildLobes(r: number, color: number, accent: number): void {
    for (const g of this.lobes) {
      g.removeFromParent();
      g.destroy();
    }
    this.lobes.length = 0;
    const style = KIND_STYLE[this.kind];
    const count = lodLobeCount(this.lod);
    const tone = mixColor(color, accent, style.brightMix);
    for (let i = 0; i < count; i++) {
      const lobe = lobeAt(this.seed, i, r);
      const g = new Graphics();
      const poly = edgePolygon(this.seed ^ (i * 0x9e3779b9), lobe.r, 0, 0.9, 1, LOBE_POINTS);
      if (style.filled) {
        g.poly(poly, true).fill({ color: tone, alpha: style.lobeAlpha });
      } else {
        g.poly(poly, true).stroke({ color: tone, width: 2, alpha: style.lobeAlpha });
      }
      // 그을음은 갈라진 자국을 더한다 — 움직이지 않는 대신 형태로 재질을 만든다.
      if (this.kind === 'scorch') {
        for (let k = 0; k < 3; k++) {
          const a = lobe.phase + (k * Math.PI * 2) / 3;
          g.moveTo(0, 0)
            .lineTo(Math.cos(a) * lobe.r * 0.9, Math.sin(a) * lobe.r * 0.9)
            .stroke({ color: tone, width: 1.5, alpha: style.lobeAlpha * 0.8 });
        }
      }
      g.position.set(lobe.cx, lobe.cy);
      this.lobeLayer.addChild(g);
      this.lobes.push(g);
    }
  }

  /** 예열 고조 원반(단위 크기로 굽고 매 프레임 `scale` 로 키운다 — 재굽기 0). */
  private buildCharge(r: number, color: number, accent: number): void {
    this.charge.clear();
    // 완전한 원이 아니라 유기 폴리곤이다(§2-5 UI 어휘 금지). 고조는 압력이지 게이지가 아니다.
    const poly = edgePolygon(this.seed ^ 0x51ed270b, r * 0.94, 0, 0.8, 1, 18);
    this.charge.poly(poly, true).fill({ color, alpha: 0.14 });
    this.charge.poly(poly, true).stroke({
      color: mixColor(color, accent, 0.6),
      width: 2.5,
      alpha: 0.5,
    });
  }

  /** 입자. 단위 반경 1 로 굽고 매 프레임 `scale` 로 크기를 준다. */
  private buildMotes(color: number, accent: number, count: number): void {
    for (const g of this.motes) {
      g.removeFromParent();
      g.destroy();
    }
    this.motes.length = 0;
    this.builtMotes = count;
    const tint = mixColor(color, accent, 0.55);
    for (let i = 0; i < count; i++) {
      const g = new Graphics();
      g.circle(0, 0, 1).fill({ color: tint, alpha: 0.9 });
      this.moteLayer.addChild(g);
      this.motes.push(g);
    }
  }
}

/**
 * 텍스처를 만들 수 없는 환경(node 테스트 등)의 환경 기여 폴백. 동심원 falloff —
 * `buildGroundShadow` 와 같은 절차적 관용구다.
 */
function buildAmbientFallback(radius: number, tint: number): Graphics {
  const g = new Graphics();
  for (let i = AMBIENT_FALLBACK_RINGS; i >= 1; i--) {
    const t = i / AMBIENT_FALLBACK_RINGS;
    g.circle(0, 0, radius * t).fill({ color: tint, alpha: 1 / AMBIENT_FALLBACK_RINGS });
  }
  return g;
}

// ---------------------------------------------------------------------------
// 등록 — 함수 호출식이라 다른 레인과 같은 줄을 다투지 않는다
// ---------------------------------------------------------------------------

/** 재질을 붙일 subtype 들. `HAZARD_SLOW`(2) 하나가 감속 지대와 영구 지형 **둘 다**를 실어 온다. */
const FIELD_SUBTYPES: readonly number[] = [
  HAZARD_MORTAR,
  HAZARD_LAVA,
  HAZARD_SLOW,
  HAZARD_CONTAMINATION,
];

/**
 * 재질 팩토리.
 *
 * **`zone.decorated` 를 보지 않는다.** 그 값은 호스트의 프레임당 장식 예산이라 장판 수가
 * 경계를 넘나들면 매 프레임 뒤집힌다 — 재질은 부착 후 고착이므로 그 위에 얹으면 겹이 켜졌다
 * 꺼지며 **한 프레임에 튄다**(1차 반려 사유 ④). 대신 반경 하한만 보고, 상세는 부착 순번이
 * 정한 LOD 로 나눈다.
 */
function fieldFactory(zone: HazardZone): HazardMaterial[] {
  const kind = hazardMaterialKind(zone.subtype, zone.permanent);
  if (kind === null) return [];
  // 반경이 너무 작으면 재질이 화면에서 구별되지 않는다(장식 하한과 같은 판단).
  if (zone.radius < FIELD_MIN_RADIUS) return [];
  if (liveMaterials >= MAX_FIELD_MATERIALS) return [];
  const lod = hazardLod(attachCursor);
  attachCursor++;
  liveMaterials++;
  return [new HazardFieldMaterial(kind, zone.id | 0, lod)];
}

/** 이미 등록했는가(멱등 보장). 배선 지점은 `entity/index.ts` 다(순환 회피 — 그 파일 헤더 참조). */
let installed = false;

/** 해저드 재질을 등록한다. **멱등**이다. */
export function installHazardMaterials(): void {
  if (installed) return;
  installed = true;
  for (const sub of FIELD_SUBTYPES) registerHazardMaterialFactory(sub, fieldFactory);
}

/** 예산·순번 카운터를 되돌린다. **테스트 격리 전용**. */
export function resetHazardFieldBudget(): void {
  liveMaterials = 0;
  attachCursor = 0;
}

installHazardMaterials();
