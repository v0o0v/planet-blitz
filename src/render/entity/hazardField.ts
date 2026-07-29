/**
 * 해저드 **장판 재질** — 기하학 도형을 물질로 바꾸는 층.
 *
 * ## 두 번의 반려가 이 파일의 현재 구조를 만들었다
 *
 * **1차** — 재질 여섯 겹 중 다섯이 `heat` 에 곱해져 있었다. 박격 장판은 예열로 등장해 활성 창이
 * 8틱(≈0.13초)뿐이고 직후 소멸하므로 피크가 0.43, 예열 내내 0 이었다. **예열은 탄막 게임에서
 * 가장 오래 보이는 상태다.** → {@link materialIntensity} 가 존재를 바닥으로 보장하고 예열↔활성을
 * **강도·색·운동 속도**로 가른다.
 *
 * **2차** — 세 가지가 겹쳐 재질이 실전 화면에 거의 없었다.
 * 1. `attachCursor` 가 **세션 누적**이라(되돌리는 프로덕션 코드가 0건) 톡사르 첫 런부터
 *    `full 0 · mid 9 · lite 32` 였고 `lite` 는 로브 0 이었다 → 항목 1·3·6 이 화면에서 사라졌다.
 *    → LOD 를 **동시 생존 수**로 배정하고({@link hazardLod}) **모든 LOD 가 로브를 갖는다**.
 * 2. 로브가 장판마다 `Graphics` 라 **드로우콜이 개수만큼** 늘었다. 상세 겹 24장만으로 draw 가
 *    예산의 65% 였는데 실제 판정 장면은 41장이다. → 로브·입자를 **공유 텍스처 스프라이트**로
 *    바꾸고({@link file://./hazardTexture.ts}) 겹마다 **공유 레이어 하나**에 모아 배치(batch)한다.
 *    272개를 그려도 드로우콜은 사실상 하나다.
 * 3. `refract` 로브가 `stroke` 라 보라 셀 안에 **작은 원 윤곽**이 떠 다이어그램 노드로 읽혔다
 *    (§2-5 UI 어휘). → 윤곽선 표현을 전부 없앴다. 굴절은 블롭의 **이방성 스케일**로 만든다.
 *
 * ## 레이어 구조 — 왜 장판별 루트가 아니라 공유 레이어인가
 * 스프라이트는 같은 텍스처·같은 블렌드일 때만 배치된다. 장판마다 루트를 두고 그 안에
 * `Graphics`(접지·고조)와 스프라이트를 섞으면 **장판 경계마다 배치가 끊긴다**. 그래서 겹 단위로
 * 공유 레이어를 두고, 각 재질은 그 안에 자기 **하위 컨테이너**만 소유한다. 부수 효과로 겹 순서가
 * 전 장판에 대해 일관돼 겹친 셀에서도 층이 뒤섞이지 않는다.
 *
 * ## 계약
 * - **render-only**(ADR-0005). `src/sim/` 은 상수·타입만 읽는다. `hashWorld` 무접촉.
 * - 모든 겹이 `gates`·`tier` 뒤에 있고 `reducedMotion`/`reducedGlow` 를 존중한다.
 * - **재질은 자기 색을 선언하지 않는다.** 전부 `zone.visual.color`↔`accent` 보간이다.
 * - {@link HazardFieldMaterial.dispose} 가 자기 하위 컨테이너를 직접 떼고 파괴한다.
 */

import { Container, Graphics, Sprite } from 'pixi.js';

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
  BLOB_TEX_SIZE,
  GLOW_TEX_SIZE,
  MOTE_TEX_SIZE,
  blobTexture,
  glowTexture,
  moteTexture,
} from './hazardTexture.js';
import {
  MAX_FIELD_MATERIALS,
  bandPolygon,
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

/** 살아있는 재질 수. **LOD 배정 축이자 안전 밸브**다(세션 누적이 아니다 — 2차 반려 CRIT-1). */
let liveMaterials = 0;

/** 현재 살아있는 재질 수(테스트·진단 관측창). */
export function hazardFieldLiveCount(): number {
  return liveMaterials;
}

// ---------------------------------------------------------------------------
// 공유 겹 레이어 — 배치(batch)를 끊지 않기 위한 구조
// ---------------------------------------------------------------------------

/**
 * 겹 단위 공유 레이어 묶음. 아래→위 순서가 곧 그리기 순서다.
 *
 * 접촉 그늘이 로브 **아래**여야 "파인 바닥에 물질이 고여 있다"로 읽힌다. 입자는 맨 위 —
 * 떠오르는 것이 물질에 가리면 높이감이 죽는다.
 */
interface FieldStage {
  readonly root: Container;
  readonly ambientAdd: Container;
  readonly ambientFog: Container;
  readonly contact: Container;
  readonly lobes: Container;
  readonly rim: Container;
  readonly charge: Container;
  readonly motes: Container;
}

let stage: FieldStage | null = null;

function makeStage(): FieldStage {
  const root = new Container();
  root.label = 'hazardFieldStage';
  const mk = (label: string, blend: 'add' | 'normal' | 'multiply'): Container => {
    const c = new Container();
    c.label = label;
    c.blendMode = blend;
    root.addChild(c);
    return c;
  };
  // Pixi `label` 을 박는다 — 계약 §2-4 의 귀속 절차가 겹을 하나씩 `visible=false` 로 끄고
  // 같은 정지 프레임을 다시 찍을 것을 요구한다.
  return {
    root,
    ambientAdd: mk('hazardAmbientAdd', 'add'),
    ambientFog: mk('hazardAmbientFog', 'normal'),
    contact: mk('hazardContact', 'multiply'),
    lobes: mk('hazardLobes', 'add'),
    rim: mk('hazardRim', 'add'),
    charge: mk('hazardCharge', 'add'),
    motes: mk('hazardMotes', 'add'),
  };
}

/**
 * 공유 레이어를 얻는다(없거나 파괴됐으면 새로 만든다).
 *
 * 렌더러 `destroy()` 는 `layer.destroy({children:true})` 로 이 root 까지 파괴한다 — 그 뒤에도
 * 같은 객체를 재사용하면 Pixi 내부가 깨지므로 `destroyed` 를 확인하고 다시 만든다.
 */
function fieldStage(layer: Container): FieldStage {
  if (stage === null || stage.root.destroyed) stage = makeStage();
  if (stage.root.parent !== layer) layer.addChild(stage.root);
  return stage;
}

/** 공유 레이어를 버린다. **테스트 격리 전용**. */
export function resetHazardFieldStage(): void {
  stage = null;
}

// ---------------------------------------------------------------------------
// 종류별 표현 파라미터 — "무엇이 어떻게 움직이는가"
// ---------------------------------------------------------------------------

/** 로브의 운동 방식. 재질감의 정체는 결국 **운동**이라, 종류마다 달라야 구분된다. */
type LobeMotion = 'flow' | 'bubble' | 'lens' | 'still';

interface KindStyle {
  readonly motion: LobeMotion;
  /**
   * 로브 색의 보간 계수.
   *
   * 2차의 `molten` 0.72 는 `mixColor(0xff8412, 0xfff0e6, .72)` = (255,210,170) 로 **거의 흰색**
   * 이었고, 주황 장판 위 창백한 얼룩이라 "용융"이 아니라 **렌즈 기름때**로 읽혔다(반려 MINOR).
   * 지금은 종류색 쪽에 훨씬 가깝게 둬서 로브가 장판의 **같은 물질**로 보이게 한다.
   */
  readonly brightMix: number;
  /** 로브 알파(가산). 개수가 많으므로 누적 밝기를 보고 낮게 잡는다(§2-4). */
  readonly lobeAlpha: number;
}

const KIND_STYLE: Readonly<Record<HazardMaterialKind, KindStyle>> = {
  molten: { motion: 'flow', brightMix: 0.38, lobeAlpha: 0.3 },
  spore: { motion: 'bubble', brightMix: 0.28, lobeAlpha: 0.26 },
  refract: { motion: 'lens', brightMix: 0.42, lobeAlpha: 0.3 },
  scorch: { motion: 'still', brightMix: 0.15, lobeAlpha: 0.2 },
  ember: { motion: 'flow', brightMix: 0.4, lobeAlpha: 0.26 },
};

/** 반경 대비 접촉 그늘 띠 두께. */
const CONTACT_BAND = 0.16;
/** 반경 대비 림 하이라이트 띠 두께. 그늘보다 **좁아야** 가장자리가 선다. */
const RIM_BAND = 0.055;
/** 접지 겹이 덮는 호의 반각(라디안). */
const GROUND_ARC_HALF = Math.PI * 0.52;
/** 환경 기여 falloff 링 수(공유 텍스처를 못 만들 때만 쓰는 절차적 폴백). */
const AMBIENT_FALLBACK_RINGS = 5;

// ---------------------------------------------------------------------------
// 재질 본체
// ---------------------------------------------------------------------------

class HazardFieldMaterial implements HazardMaterial {
  readonly name: string;

  /** 겹별 하위 컨테이너. 각각 공유 레이어의 자식이고, 위치만 매 프레임 옮긴다. */
  private readonly ambientNode = new Container();
  private readonly lobeNode = new Container();
  private readonly moteNode = new Container();
  private readonly contactG = new Graphics();
  private readonly rimG = new Graphics();
  private readonly chargeG = new Graphics();

  private readonly lobes: Sprite[] = [];
  private readonly motes: Sprite[] = [];
  /** 폴백(텍스처 없음) 경로에서 쓰는 로브 도형. 스프라이트를 못 만들 때만 채워진다. */
  private readonly lobeShapes: Graphics[] = [];

  private heat = 0;
  private chargeLevel = 0;
  private builtRadius = 0;
  private builtMotes = -1;
  private disposed = false;
  private attached = false;

  constructor(
    private readonly kind: HazardMaterialKind,
    private readonly seed: number,
    /** 부착 시 동시 생존 수가 정한 상세 단계. **수명 내내 바뀌지 않는다.** */
    private readonly lod: HazardLod,
  ) {
    this.name = `hazardField:${kind}:${lod}`;
    this.ambientNode.label = this.name;
    this.lobeNode.label = this.name;
    this.moteNode.label = this.name;
  }

  onAttach(zone: HazardZone, ctx: HazardHostContext): void {
    const s = fieldStage(ctx.layer);
    const shape = hazardAmbienceShape(this.kind);
    (shape.additive ? s.ambientAdd : s.ambientFog).addChild(this.ambientNode);
    s.lobes.addChild(this.lobeNode);
    s.charge.addChild(this.chargeG);
    if (lodHasGrounding(this.lod)) {
      s.contact.addChild(this.contactG);
      s.rim.addChild(this.rimG);
    }
    if (lodHasMotes(this.lod)) s.motes.addChild(this.moteNode);
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

    const wantMotes = lodHasMotes(this.lod) ? moteBudget(ctx.tier, ctx.gates) : 0;
    if (
      Math.abs(zone.radius - this.builtRadius) > this.builtRadius * 0.02 ||
      wantMotes !== this.builtMotes
    ) {
      this.build(zone, ctx);
    }

    // 하위 컨테이너는 공유 레이어의 자식이라 각자 위치를 받는다(장판별 루트가 없다).
    this.ambientNode.position.set(zone.x, zone.y);
    this.lobeNode.position.set(zone.x, zone.y);
    this.moteNode.position.set(zone.x, zone.y);
    this.contactG.position.set(zone.x, zone.y);
    this.rimG.position.set(zone.x, zone.y);
    this.chargeG.position.set(zone.x, zone.y);

    // ── 환경 기여 ────────────────────────────────────────────────────────────
    const amb = hazardAmbience(this.kind, ctx.tier, ctx.gates);
    if (amb === null) {
      this.ambientNode.visible = false;
    } else {
      this.ambientNode.visible = true;
      const pulse = settings.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(tick * 0.035);
      // 예열에도 기여가 남는다(presence 바닥) — "곧 온다"의 환경 신호다.
      this.ambientNode.alpha = amb.alpha * it.presence * (0.72 + 0.28 * pulse);
      const s = 0.86 + 0.14 * this.heat + 0.06 * pulse;
      this.ambientNode.scale.set(s, s * 0.88); // 세로 압축 = 바닥에 누운 빛무리.
    }

    // ── 본체 로브 ────────────────────────────────────────────────────────────
    const style = KIND_STYLE[this.kind];
    this.lobeNode.alpha = it.presence;
    // 색은 tint 로 민다: 예열은 어둡고 탁하게, 활성은 구운 그대로. tint 는 곱연산이라 **새 색을
    // 만들 수 없다** — 색=성질 규칙이 여기로 샐 구조적 여지가 없다.
    const w = Math.round(255 * (0.45 + 0.55 * it.warmth));
    this.lobeNode.tint = (w << 16) | (w << 8) | w;
    const bodies: { readonly length: number; readonly [i: number]: Sprite | Graphics | undefined } =
      this.lobes.length > 0 ? this.lobes : this.lobeShapes;
    for (let i = 0; i < bodies.length; i++) {
      const g = bodies[i];
      if (g === undefined) continue;
      const lobe = lobeAt(this.seed, i, this.builtRadius);
      const base = this.lobes.length > 0 ? (lobe.r * 2) / BLOB_TEX_SIZE : 1;
      if (style.motion === 'still') {
        g.scale.set(base);
        g.alpha = style.lobeAlpha * (0.55 + 0.45 * lobe.bright);
        continue;
      }
      const life = lobeLife(this.seed, i, tick, it.speed);
      const ph = lobe.phase + tick * lobeSpin(this.seed, i) * it.speed;
      const k = base * life.scale;
      switch (style.motion) {
        case 'flow':
          g.rotation = ph;
          g.scale.set(k);
          break;
        case 'bubble':
          g.scale.set(k);
          break;
        case 'lens':
          // 굴절: 가로세로가 반대로 늘어나 렌즈가 왜곡하는 것으로 읽힌다(윤곽선 없이).
          g.rotation = ph;
          g.scale.set(k, k * (0.82 + 0.36 * Math.cos(ph * 2.3)));
          break;
      }
      g.alpha = style.lobeAlpha * life.alpha * (0.55 + 0.45 * lobe.bright);
    }

    // ── 접지 ─────────────────────────────────────────────────────────────────
    // 예열에도 접지가 남는다: 장판이 지면에 파여 있다는 사실은 뜨거운지와 무관하다.
    this.contactG.alpha = it.presence;
    this.rimG.alpha = it.presence * (ctx.gates.halo ? 1 : 0.45);

    // ── 예열 고조 ────────────────────────────────────────────────────────────
    const ch = this.chargeLevel;
    this.chargeG.visible = ch > 0.02;
    if (this.chargeG.visible) {
      const grow = 0.2 + 0.8 * ch;
      this.chargeG.scale.set(grow, grow * 0.94);
      const beat = settings.reducedMotion ? 1 : 0.72 + 0.28 * Math.sin(tick * (0.05 + 0.09 * ch));
      this.chargeG.alpha = ch * ch * beat;
    }

    // ── 입자 ─────────────────────────────────────────────────────────────────
    if (this.motes.length > 0) {
      const rise = moteRise(this.kind);
      this.moteNode.alpha = it.presence;
      for (let i = 0; i < this.motes.length; i++) {
        const g = this.motes[i];
        if (g === undefined) continue;
        const m = moteAt(this.seed, i, this.builtRadius, tick * it.speed, rise);
        g.position.set(m.x, m.y);
        g.alpha = m.alpha;
        g.scale.set((m.r * 2) / MOTE_TEX_SIZE);
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    liveMaterials--;
    if (this.attached) {
      for (const n of [
        this.ambientNode,
        this.lobeNode,
        this.moteNode,
        this.contactG,
        this.rimG,
        this.chargeG,
      ]) {
        n.removeFromParent();
        n.destroy({ children: true });
      }
      this.attached = false;
    }
    this.lobes.length = 0;
    this.motes.length = 0;
    this.lobeShapes.length = 0;
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

  /** 환경 기여. 공유 그라디언트 텍스처 스프라이트 **1장**(드로우콜 1 · 밴딩 0). */
  private buildAmbient(r: number, color: number, accent: number): void {
    for (const c of this.ambientNode.removeChildren()) c.destroy();
    const shape = hazardAmbienceShape(this.kind);
    const tint = mixColor(color, accent, this.kind === 'spore' ? 0 : 0.18);
    const tex = glowTexture();
    if (tex !== null) {
      const sp = new Sprite(tex);
      sp.anchor.set(0.5);
      sp.tint = tint;
      sp.scale.set((r * shape.scale * 2) / GLOW_TEX_SIZE);
      this.ambientNode.addChild(sp);
      return;
    }
    this.ambientNode.addChild(buildAmbientFallback(r * shape.scale, tint));
  }

  /** 접촉 그늘 + 림. **방향은 전적으로 테마 광원에서 나온다**(여기 방향 상수는 없다). */
  private buildGrounding(r: number, color: number, accent: number, ctx: HazardHostContext): void {
    this.contactG.clear();
    this.rimG.clear();
    if (!lodHasGrounding(this.lod)) return;
    const gr = hazardGrounding(ctx.theme?.light ?? null);
    if (gr.rimAlpha <= 0 && gr.shadowAlpha <= 0) return;
    const la = Math.atan2(gr.ly, gr.lx);
    const shadowMid = la + Math.PI;
    for (let i = 0; i < 3; i++) {
      const t = i / 2;
      this.contactG
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
    this.rimG
      .arc(0, 0, r * 0.955, la - GROUND_ARC_HALF * 0.82, la + GROUND_ARC_HALF * 0.82)
      .stroke({
        color: mixColor(color, accent, 0.55),
        width: r * RIM_BAND,
        alpha: gr.rimAlpha,
      });
  }

  /**
   * 본체 로브. **공유 텍스처 스프라이트**라 개수가 늘어도 드로우콜이 늘지 않는다.
   *
   * 밝은 코어도 윤곽선도 없다 — 1차의 코어는 "렌즈 플레어"로, 2차의 `refract` 윤곽선은
   * "다이어그램 노드"로 읽혔다. 깊이감은 로브마다 다른 `bright` 와 겹침의 통계에서 나온다.
   */
  private buildLobes(r: number, color: number, accent: number): void {
    for (const g of this.lobes) {
      g.removeFromParent();
      g.destroy();
    }
    for (const g of this.lobeShapes) {
      g.removeFromParent();
      g.destroy();
    }
    this.lobes.length = 0;
    this.lobeShapes.length = 0;
    const style = KIND_STYLE[this.kind];
    const count = lodLobeCount(this.lod);
    const tone = mixColor(color, accent, style.brightMix);
    const tex = blobTexture();
    for (let i = 0; i < count; i++) {
      const lobe = lobeAt(this.seed, i, r);
      if (tex !== null) {
        const sp = new Sprite(tex);
        sp.anchor.set(0.5);
        sp.tint = tone;
        sp.position.set(lobe.cx, lobe.cy);
        this.lobeNode.addChild(sp);
        this.lobes.push(sp);
        continue;
      }
      // 텍스처를 못 만드는 환경의 폴백(도형). 화면 표현은 같은 계열이다.
      const g = new Graphics();
      g.circle(0, 0, lobe.r).fill({ color: tone, alpha: 1 });
      g.position.set(lobe.cx, lobe.cy);
      this.lobeNode.addChild(g);
      this.lobeShapes.push(g);
    }
  }

  /** 예열 고조 원반(단위 크기로 굽고 매 프레임 `scale` 로 키운다 — 재굽기 0). */
  private buildCharge(r: number, color: number, accent: number): void {
    this.chargeG.clear();
    // 완전한 원이 아니라 유기 폴리곤이다(§2-5 UI 어휘 금지). 고조는 압력이지 게이지가 아니다.
    const poly = bandPolygon(this.seed ^ 0x51ed270b, r, 0, 0.72, 0.94, 18);
    this.chargeG.poly(poly, true).fill({ color, alpha: 0.14 });
    this.chargeG.poly(poly, true).stroke({
      color: mixColor(color, accent, 0.6),
      width: 2.5,
      alpha: 0.5,
    });
  }

  /** 입자. 공유 텍스처 스프라이트(배치됨). */
  private buildMotes(color: number, accent: number, count: number): void {
    for (const g of this.motes) {
      g.removeFromParent();
      g.destroy();
    }
    this.motes.length = 0;
    this.builtMotes = count;
    const tex = moteTexture();
    if (tex === null) return;
    const tint = mixColor(color, accent, 0.55);
    for (let i = 0; i < count; i++) {
      const sp = new Sprite(tex);
      sp.anchor.set(0.5);
      sp.tint = tint;
      this.moteNode.addChild(sp);
      this.motes.push(sp);
    }
  }
}

/** 공유 텍스처를 만들 수 없는 환경의 환경 기여 폴백(동심원 falloff). */
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
 * 재질이 붙는 최소 반경. `DECOR_MIN_RADIUS`(40)와 같은 값이지만 **호스트의 프레임당 예산과는
 * 무관하게** 반경만 본다.
 */
export const FIELD_MIN_RADIUS = 40;

/**
 * 재질 팩토리.
 *
 * **`zone.decorated` 를 보지 않는다.** 그 값은 호스트의 프레임당 장식 예산이라 장판 수가
 * 경계를 넘나들면 매 프레임 뒤집힌다(1차 반려 사유 ④).
 *
 * **LOD 는 `liveMaterials`(동시 생존 수)로 정한다.** 세션 누적 순번을 쓰면 되돌리는 코드가
 * 없어 몇 초 만에 전 장판이 최저 LOD 로 굳는다(2차 반려 CRIT-1).
 */
function fieldFactory(zone: HazardZone): HazardMaterial[] {
  const kind = hazardMaterialKind(zone.subtype, zone.permanent);
  if (kind === null) return [];
  // 반경이 너무 작으면 재질이 화면에서 구별되지 않는다(장식 하한과 같은 판단).
  if (zone.radius < FIELD_MIN_RADIUS) return [];
  if (liveMaterials >= MAX_FIELD_MATERIALS) return [];
  const lod = hazardLod(liveMaterials);
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

/**
 * 생존 카운터를 되돌린다. **테스트 격리 전용** — 프로덕션에서는 `dispose` 가 정확히 상쇄하므로
 * 부를 필요가 없다(2차의 `attachCursor` 는 이 함수에 의존했고, 프로덕션 호출이 0건이라 결함이 됐다).
 */
export function resetHazardFieldBudget(): void {
  liveMaterials = 0;
}

installHazardMaterials();
