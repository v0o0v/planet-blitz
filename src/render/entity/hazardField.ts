/**
 * 해저드 **장판 재질** — 기하학 도형을 물질로 바꾸는 층.
 *
 * ## 무엇이 문제였나
 * 장판은 `Graphics` 원 + 45° 빗금 + 점선 링이었다. 규칙(색=성질·형태=상태)은 옳았지만
 * 화면에 있는 것은 **도형**이지 재질이 아니었다: 용암이 흐르지 않고, 오염이 부글거리지 않고,
 * 감속장이 아무것도 왜곡하지 않았다. 게다가 장판이 바닥에 **깔려** 있다는 증거가 화면에
 * 하나도 없어(접지 그림자가 엔티티에 대해 해결한 바로 그 문제) 지면 위에 붙인 스티커로 읽혔다.
 *
 * ## 이 모듈이 얹는 여섯 겹 — 그리고 **얹기만 한다**
 * 아래 층은 전부 `drawHazardZone` 이 그린 것 **위에 덧대는** 것이고, 그것을 대체하지 않는다.
 * 색 외 채널(빗금·점선·수렴 링)과 정확한 판정 원·안쪽 립은 손대지 않은 채 그대로 남는다 —
 * 색약 사용자에게 정보가 남는 유일한 경로이기 때문이다.
 *
 * | 겹 | 무엇 | 왜 AAA 인가 |
 * |---|---|---|
 * | 환경 기여 | 넓고 옅은 발광/안개 | 장판이 **주변에 영향을 준다** — 오려 붙인 원이 아니다 |
 * | 접지 | 광원 반대쪽 접촉 그늘 + 광원 쪽 림 | 장판이 지면에 **파여** 있다 |
 * | 본체 | 흐르는/부글거리는/굴절하는 로브 | 재질감. 종류마다 운동이 다르다 |
 * | 경계 | 불규칙 가장자리(판정 반경 **안쪽**) | 딱딱한 원이 아니면서 판정은 정확 |
 * | 고조 | 예열 압력이 차오르는 원반 | 예열→활성이 **연속**이 된다 |
 * | 입자 | 불티·포자·결정 | 위로 솟는 것이 있어야 바닥면과 공간이 갈린다 |
 *
 * ## 비용 규율 — 오염 모드가 이 파일의 설계 제약이다
 * 오염 지형은 반경 100 짜리 셀이 화면에 여럿 깔린다. 개체당 비용이 그대로 곱해지므로:
 *
 * 1. **재질 개수 자체를 {@link MAX_FIELD_MATERIALS}(10) 로 묶는다.** 상한을 넘은 장판은 팩토리가
 *    빈 배열을 돌려주고, `HazardHost` 는 그런 장판을 추적조차 하지 않는다(Map 성장 0 · 프레임당
 *    호출 0). 채움·테두리는 그대로라 장판이 안 보이는 일은 없다.
 * 2. **매 프레임 `Graphics` 를 다시 굽지 않는다.** 로브·접지·환경 기여·고조는 부착 시 **한 번**
 *    굽고 이후에는 `rotation`/`scale`/`alpha` 만 쓴다(`groundShadow.buildGroundShadow` 규율).
 * 3. **경계 폴리곤만 주기적으로** 다시 굽는다 — {@link EDGE_REBUILD_INTERVAL} 프레임마다,
 *    그것도 zone id 로 **엇갈리게** 해서 모든 장판이 같은 프레임에 몰리지 않게 한다.
 * 4. 셰이더 필터를 장판마다 만들지 **않는다**. 필터 인스턴스는 장판 수에 비례해 렌더 타깃을
 *    늘려 예산을 즉시 태운다. 용암류 왜곡은 이미 `lavaOverlay` 에 걸린 **공유 시머 하나**가
 *    담당하고 있고(AC-3.2), 이 모듈은 그 위에 절차적 재질을 얹어 같은 인상을 필터 0개로 만든다.
 *
 * ## 계약
 * - **render-only**(ADR-0005). `src/sim/` 은 상수·타입만 읽는다. `hashWorld` 무접촉.
 * - 모든 겹이 {@link HazardHostContext.gates}·`tier` 뒤에 있고 `reducedMotion`/`reducedGlow` 를
 *   존중한다(`reducedMotion` 이면 운동이 통째로 멈춘다 — 광과민 대응).
 * - 재질 컨테이너는 스프라이트의 형제가 아니라 {@link HazardHostContext.layer} 의 자식이지만,
 *   **부모 destroy 에 기대지 않는다** — {@link HazardFieldMaterial.dispose} 가 직접 떼고 파괴한다.
 * - **재질은 자기 색을 선언하지 않는다.** 전부 `zone.visual.color`↔`accent` 보간이다
 *   ({@link file://./hazardShape.ts} 의 `mixColor`).
 */

import { Container, Graphics } from 'pixi.js';

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
  EDGE_POINTS,
  LOBE_COUNT,
  MAX_FIELD_MATERIALS,
  edgePolygon,
  hazardAmbience,
  hazardAmbienceShape,
  hazardGrounding,
  hazardMaterialKind,
  lobeAt,
  lobeSpin,
  mixColor,
  moteAt,
  moteBudget,
  moteRise,
  stepCharge,
  stepHeat,
  type HazardMaterialKind,
} from './hazardShape.js';

/**
 * 경계 폴리곤을 다시 굽는 주기(프레임). 경계 요동 속도가 프레임당 0.006 라디안이라 8프레임
 * 간격(≈7.5Hz)은 눈에 계단으로 보이지 않으면서 재빌드 비용을 8분의 1로 줄인다.
 */
export const EDGE_REBUILD_INTERVAL = 8;

/** "경계를 아직 한 번도 굽지 않았다" 센티넬(어떤 실제 프레임 값과도 겹치지 않는다). */
const EDGE_NEVER_BUILT = Number.NEGATIVE_INFINITY;

/** 살아있는 재질 수(예산 상한 판정). 팩토리에서 늘고 `dispose` 에서 준다. */
let liveMaterials = 0;

/** 현재 살아있는 재질 수(테스트·진단 관측창). */
export function hazardFieldLiveCount(): number {
  return liveMaterials;
}

// ---------------------------------------------------------------------------
// 종류별 표현 파라미터 — "무엇이 어떻게 움직이는가"
// ---------------------------------------------------------------------------

/** 로브의 운동 방식. 재질감의 정체는 결국 **운동**이라, 종류마다 달라야 구분된다. */
type LobeMotion =
  /** 회전 — 흐르는 용융. */
  | 'flow'
  /** 크기 맥동 — 부글거리는 기포. */
  | 'bubble'
  /** 회전 + 크기 맥동(반대 위상) — 굴절 렌즈. */
  | 'lens'
  /** 정지 — 갈라진 그을음. */
  | 'still';

interface KindStyle {
  readonly motion: LobeMotion;
  /** 로브를 채우는가(false = 테두리만 — 굴절장은 채우면 시야를 가린다). */
  readonly filled: boolean;
  /** 로브 밝기 보간 계수의 상한(accent 쪽으로 얼마나 밝히는가). */
  readonly brightMix: number;
  /** 로브 알파(열 만개 기준). */
  readonly lobeAlpha: number;
  /** 경계 불규칙도 [0,1]. 0 이면 정확한 원. */
  readonly wobble: number;
}

const KIND_STYLE: Readonly<Record<HazardMaterialKind, KindStyle>> = {
  // 용암: 밝은 용융이 덩어리째 흐른다. 가장 밝고 가장 불규칙하다.
  molten: { motion: 'flow', filled: true, brightMix: 0.72, lobeAlpha: 0.5, wobble: 1 },
  // 오염: 기포가 부풀었다 꺼진다. 밝기는 낮게 — 독은 빛나는 것이 아니라 고여 있는 것이다.
  spore: { motion: 'bubble', filled: true, brightMix: 0.35, lobeAlpha: 0.42, wobble: 0.85 },
  // 감속: 채우지 않는다. 렌즈 테두리만 돌고 부풀어 "왜곡"으로 읽히게 한다.
  refract: { motion: 'lens', filled: false, brightMix: 0.55, lobeAlpha: 0.4, wobble: 0.6 },
  // 영구 지형: 움직이지 않는다. 지형은 흐르지 않는다 — 갈라진 자국만 있다.
  scorch: { motion: 'still', filled: true, brightMix: 0.18, lobeAlpha: 0.34, wobble: 0.75 },
  // 박격 낙하점: 달궈진 자국이 천천히 돈다.
  ember: { motion: 'flow', filled: true, brightMix: 0.55, lobeAlpha: 0.44, wobble: 0.7 },
};

/** 반경 대비 접촉 그늘 띠 두께. */
const CONTACT_BAND = 0.16;
/** 반경 대비 림 하이라이트 띠 두께. 그늘보다 **좁아야** 가장자리가 선다. */
const RIM_BAND = 0.055;
/** 접지 겹이 덮는 호의 반각(라디안). π/2 면 정확히 절반씩. */
const GROUND_ARC_HALF = Math.PI * 0.52;
/** 환경 기여 falloff 링 수(`buildGroundShadow` 와 같은 절차적 굽기). */
const AMBIENT_RINGS = 5;

// ---------------------------------------------------------------------------
// 재질 본체
// ---------------------------------------------------------------------------

/**
 * 장판 하나에 붙는 재질. 수명은 장판 엔티티와 평행하고, 회수는 {@link dispose} 가 직접 한다.
 */
class HazardFieldMaterial implements HazardMaterial {
  readonly name: string;

  /** 이 재질의 모든 겹을 담는 루트. `ctx.layer` 의 자식이며 위치는 장판 중심이다. */
  private readonly root = new Container();
  /** 환경 기여(가산 발광 또는 대기 안개). 장판 **밖**까지 나가는 유일한 겹. */
  private readonly ambient = new Container();
  private readonly ambientArt = new Graphics();
  /** 접촉 그늘(곱연산) — 장판이 지면에 파여 있음. */
  private readonly contact = new Graphics();
  /** 림 하이라이트(광원 쪽 안쪽 가장자리). */
  private readonly rim = new Graphics();
  /** 불규칙 경계 프린지. */
  private readonly edge = new Graphics();
  /** 본체 로브들. 각자 독립적으로 돌거나 부푼다. */
  private readonly lobes: Graphics[] = [];
  /** 예열 고조 원반. */
  private readonly charge = new Graphics();
  /** 입자(불티·포자·결정). */
  private readonly moteLayer = new Container();
  private readonly motes: Graphics[] = [];

  /** 열(활성도) [0,1] — 활성 진입에 빠르게 오르고 비활성에서 천천히 식는다. */
  private heat = 0;
  /** 고조(예열 압력) [0,1] — 열의 여집합. */
  private chargeLevel = 0;
  /** 마지막으로 구운 반경. 장판 반경이 바뀌면 다시 굽는다. */
  private builtRadius = 0;
  /** 마지막으로 구운 입자 수(티어 변경 시 재구성). */
  private builtMotes = -1;
  /** 경계를 마지막으로 구운 프레임. */
  private edgeTick = EDGE_NEVER_BUILT;
  private disposed = false;
  /** 실제로 붙은 부모(회수 시 이 값이 아니라 `removeFromParent` 를 쓴다 — 이중 회수 안전). */
  private attached = false;

  constructor(
    private readonly kind: HazardMaterialKind,
    private readonly seed: number,
  ) {
    this.name = `hazardField:${kind}`;
    // 합성 모드는 겹의 물리적 의미에서 나온다: 접촉 그늘은 빛의 차폐라 곱연산(접지 그림자와
    // 같은 규율), 림·입자는 자체 발광이라 가산이다.
    this.contact.blendMode = 'multiply';
    this.rim.blendMode = 'add';
    this.moteLayer.blendMode = 'add';
    // 그리는 순서(아래→위): 환경 기여 → 접촉 그늘 → 본체 로브 → 경계 → 림 → 고조 → 입자.
    // 접촉 그늘이 로브 **아래**여야 "파인 바닥에 물질이 고여 있다"로 읽힌다. 순서를 뒤집으면
    // 그늘이 물질 위에 얹혀 "더러운 유리" 가 된다.
    this.root.addChild(this.ambient);
    this.ambient.addChild(this.ambientArt);
    this.root.addChild(this.contact);
    this.root.addChild(this.edge);
    this.root.addChild(this.rim);
    this.root.addChild(this.charge);
    this.root.addChild(this.moteLayer);
  }

  onAttach(zone: HazardZone, ctx: HazardHostContext): void {
    ctx.layer.addChild(this.root);
    this.attached = true;
    // 예열 상태로 등장한 장판은 압력이 이미 차 있는 것이 자연스럽다(런 도중 생긴 장판이
    // 0 에서 시작하면 첫 1.3초 동안 아무 신호가 없다).
    this.chargeLevel = zone.active ? 0 : 0.35;
    this.heat = zone.active ? 1 : 0;
    this.build(zone, ctx);
  }

  onFrame(zone: HazardZone, ctx: HazardHostContext): void {
    if (this.disposed) return;
    const settings = graphicsSettings.getSettings();
    // reducedMotion 이면 위상을 얼린다 — 운동이 멈출 뿐 겹은 그대로라 정보는 남는다.
    const tick = settings.reducedMotion ? 0 : ctx.frameTick;
    this.heat = stepHeat(this.heat, zone.active, ctx.dt);
    this.chargeLevel = stepCharge(this.chargeLevel, zone.active, ctx.dt);

    this.root.position.set(zone.x, zone.y);

    // 반경·입자 예산이 바뀌었으면 다시 굽는다(장판 반경은 보통 고정이지만 티어는 런 중 바뀐다).
    const wantMotes = moteBudget(ctx.tier, ctx.gates);
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
      // 열이 오르면 밝아지고, 예열 중에는 고조에 비례해 미리 번진다("곧 온다"의 환경 신호).
      const pulse = settings.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(tick * 0.035);
      this.ambient.alpha = amb.alpha * (0.25 + 0.75 * this.heat) * (0.72 + 0.28 * pulse);
      const s = 0.86 + 0.14 * this.heat + 0.06 * pulse;
      this.ambient.scale.set(s, s * 0.88); // 세로 압축 = 바닥에 누운 빛무리(원근 압축).
    }

    // ── 본체 ─────────────────────────────────────────────────────────────────
    const style = KIND_STYLE[this.kind];
    // 여운: 비활성이어도 열이 남아 있는 동안은 옅게 보인다. **재질에만** 실리고 판정을 알리는
    // 채널(테두리·립·빗금·점선)은 `drawHazardZone` 소유라 활성과 동시에 끊긴다.
    const bodyAlpha = zone.decorated ? this.heat : this.heat * 0.35;
    for (let i = 0; i < this.lobes.length; i++) {
      const g = this.lobes[i];
      if (g === undefined) continue;
      const lobe = lobeAt(this.seed, i, this.builtRadius);
      const ph = lobe.phase + tick * lobeSpin(this.seed, i);
      switch (style.motion) {
        case 'flow':
          g.rotation = ph;
          break;
        case 'bubble': {
          // 기포: 부풀었다 꺼진다. 하한 0.55 라 완전히 사라지지 않는다(깜빡임 금지).
          const k = 0.78 + 0.22 * Math.sin(ph * 3.1);
          g.scale.set(k);
          break;
        }
        case 'lens': {
          // 굴절: 회전과 크기 맥동이 **반대 위상**이라 렌즈가 숨쉬듯 왜곡한다.
          g.rotation = ph;
          const k = 0.86 + 0.14 * Math.cos(ph * 2.3);
          g.scale.set(k, 1 / k);
          break;
        }
        case 'still':
          break;
      }
      g.alpha = bodyAlpha * (0.55 + 0.45 * lobe.bright);
    }

    // ── 경계(주기적 재굽기 — zone 별로 엇갈린다) ────────────────────────────
    this.edge.visible = zone.decorated && this.heat > 0.02;
    if (this.edge.visible) {
      this.edge.alpha = this.heat;
      // 엇갈림: zone 마다 다른 잔여류의 프레임에만 굽는다 → 10개 장판의 재빌드가 8프레임에
      // 고루 퍼져 한 프레임에 몰리지 않는다(스파이크 방지).
      const stagger = Math.abs(this.seed) % EDGE_REBUILD_INTERVAL;
      const due = (Math.abs(tick) + stagger) % EDGE_REBUILD_INTERVAL === 0;
      if (this.edgeTick === EDGE_NEVER_BUILT || (due && tick !== this.edgeTick)) {
        this.buildEdge(zone.visual.color, zone.visual.accent, tick);
        this.edgeTick = tick;
      }
    }

    // ── 접지 ─────────────────────────────────────────────────────────────────
    // 열이 없으면 접지도 없다(예열 중에는 아직 아무것도 고여 있지 않다).
    this.contact.alpha = this.heat;
    this.rim.alpha = this.heat * (ctx.gates.halo ? 1 : 0.45);

    // ── 예열 고조 ────────────────────────────────────────────────────────────
    // 압력이 밖에서 안으로 차오른다: 원반이 자라고 알파가 오른다. 활성 순간 열이 이어받는다.
    const ch = this.chargeLevel;
    this.charge.visible = ch > 0.02;
    if (this.charge.visible) {
      const grow = 0.2 + 0.8 * ch;
      this.charge.scale.set(grow, grow * 0.94);
      const beat = settings.reducedMotion ? 1 : 0.72 + 0.28 * Math.sin(tick * (0.05 + 0.09 * ch));
      this.charge.alpha = ch * ch * beat;
    }

    // ── 입자 ─────────────────────────────────────────────────────────────────
    const rise = moteRise(this.kind);
    const moteVis = zone.decorated ? this.heat : 0;
    this.moteLayer.visible = moteVis > 0.02 && this.motes.length > 0;
    if (this.moteLayer.visible) {
      for (let i = 0; i < this.motes.length; i++) {
        const g = this.motes[i];
        if (g === undefined) continue;
        const m = moteAt(this.seed, i, this.builtRadius, tick, rise);
        g.position.set(m.x, m.y);
        g.alpha = m.alpha * moteVis;
        g.scale.set(m.r);
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    liveMaterials--;
    // 형제/자식 어느 쪽이든 **직접** 떼고 파괴한다. 부모 destroy 에 기대면 런 전환에서
    // 사라진 장판의 재질이 화면에 얼어붙는다(접지 그림자가 실제로 낸 결함).
    if (this.attached) {
      this.root.removeFromParent();
      this.attached = false;
    }
    this.root.destroy({ children: true });
    this.lobes.length = 0;
    this.motes.length = 0;
  }

  // -------------------------------------------------------------------------
  // 굽기 — 부착 시 한 번(+반경·티어 변경 시). 매 프레임 호출되지 않는다.
  // -------------------------------------------------------------------------

  private build(zone: HazardZone, ctx: HazardHostContext): void {
    const r = zone.radius > 0 ? zone.radius : 1;
    this.builtRadius = r;
    const color = zone.visual.color;
    const accent = zone.visual.accent;
    const style = KIND_STYLE[this.kind];

    this.buildAmbient(r, color, accent);
    this.buildGrounding(r, color, accent, ctx);
    this.buildLobes(r, color, accent, style);
    this.buildCharge(r, color, accent);
    this.buildMotes(color, accent, moteBudget(ctx.tier, ctx.gates));
    this.edgeTick = -9999; // 다음 프레임에 경계를 즉시 다시 굽게 한다.
  }

  /**
   * 환경 기여: 동심원 falloff. **형태는 게이트와 무관하게** 굽는다(가시성·알파는 매 프레임
   * {@link hazardAmbience} 가 정한다) — 티어가 오르내릴 때마다 다시 굽지 않기 위해서다.
   */
  private buildAmbient(r: number, color: number, accent: number): void {
    const shape = hazardAmbienceShape(this.kind);
    const scale = shape.scale;
    this.ambientArt.clear();
    this.ambient.blendMode = shape.additive ? 'add' : 'normal';
    const tint = mixColor(color, accent, this.kind === 'spore' ? 0 : 0.18);
    for (let i = AMBIENT_RINGS; i >= 1; i--) {
      const t = i / AMBIENT_RINGS;
      this.ambientArt
        .circle(0, 0, r * scale * t)
        .fill({ color: tint, alpha: 1 / AMBIENT_RINGS });
    }
  }

  /** 접촉 그늘 + 림. **방향은 전적으로 테마 광원에서 나온다**(여기 방향 상수는 없다). */
  private buildGrounding(r: number, color: number, accent: number, ctx: HazardHostContext): void {
    this.contact.clear();
    this.rim.clear();
    const gr = hazardGrounding(ctx.theme?.light ?? null);
    if (gr.rimAlpha <= 0 && gr.shadowAlpha <= 0) return;
    // 광원 방향 각도. 그늘은 그 **반대**쪽 안쪽 가장자리를 따라 눕는다.
    const la = Math.atan2(gr.ly, gr.lx);
    const shadowMid = la + Math.PI;
    // 접촉 그늘: 두꺼운 호 3겹으로 부드러운 falloff(마스크 없이 기하로 만든다).
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
    // 림: 좁고 밝게. 재질 색에서 accent 쪽으로 밀어 만든다(새 색 없음).
    this.rim
      .arc(0, 0, r * 0.955, la - GROUND_ARC_HALF * 0.82, la + GROUND_ARC_HALF * 0.82)
      .stroke({
        color: mixColor(color, accent, 0.55),
        width: r * RIM_BAND,
        alpha: gr.rimAlpha,
      });
  }

  /** 본체 로브. 각 로브는 자기 `Graphics` 라 독립적으로 회전·맥동한다(재굽기 0). */
  private buildLobes(r: number, color: number, accent: number, style: KindStyle): void {
    for (const g of this.lobes) {
      g.removeFromParent();
      g.destroy();
    }
    this.lobes.length = 0;
    for (let i = 0; i < LOBE_COUNT; i++) {
      const lobe = lobeAt(this.seed, i, r);
      const g = new Graphics();
      // 로브는 **가산**이다: 겹칠수록 밝아져 "고인 물질"의 두께가 생긴다. 곱연산이면 겹친
      // 부분이 어두워져 구멍처럼 보인다.
      g.blendMode = 'add';
      const outer = edgePolygon(this.seed ^ (i * 0x9e3779b9), lobe.r, 0, 0.9, 1, 14);
      const inner = edgePolygon(this.seed ^ (i * 0x85ebca6b), lobe.r * 0.52, 0, 0.9, 1, 12);
      const shell = mixColor(color, accent, style.brightMix * 0.35);
      const core = mixColor(color, accent, style.brightMix);
      if (style.filled) {
        g.poly(outer).fill({ color: shell, alpha: style.lobeAlpha });
        g.poly(inner).fill({ color: core, alpha: style.lobeAlpha * 0.85 });
      } else {
        g.poly(outer).stroke({ color: shell, width: 2.5, alpha: style.lobeAlpha });
        g.poly(inner).stroke({ color: core, width: 1.5, alpha: style.lobeAlpha * 0.9 });
      }
      // 그을음은 갈라진 자국을 더한다 — 움직이지 않는 대신 형태로 재질을 만든다.
      if (this.kind === 'scorch') {
        for (let k = 0; k < 3; k++) {
          const a = lobe.phase + (k * Math.PI * 2) / 3;
          g.moveTo(0, 0)
            .lineTo(Math.cos(a) * lobe.r * 0.9, Math.sin(a) * lobe.r * 0.9)
            .stroke({ color: core, width: 1.5, alpha: style.lobeAlpha * 0.8 });
        }
      }
      g.position.set(lobe.cx, lobe.cy);
      // 로브는 경계 프린지 **아래**다(경계가 로브를 잘라 주는 것처럼 보여야 한다).
      this.root.addChildAt(g, this.root.getChildIndex(this.edge));
      this.lobes.push(g);
    }
  }

  /** 예열 고조 원반(단위 반경으로 굽고 매 프레임 `scale` 로 키운다 — 재굽기 0). */
  private buildCharge(r: number, color: number, accent: number): void {
    this.charge.clear();
    this.charge.blendMode = 'add';
    this.charge.circle(0, 0, r * 0.94).fill({ color, alpha: 0.14 });
    this.charge.circle(0, 0, r * 0.94).stroke({
      color: mixColor(color, accent, 0.6),
      width: 2.5,
      alpha: 0.55,
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

  /** 불규칙 경계 프린지 — 안쪽으로 3겹 페이드. **판정 반경을 넘지 않는다**(scale ≤ 1). */
  private buildEdge(color: number, accent: number, tick: number): void {
    const style = KIND_STYLE[this.kind];
    const r = this.builtRadius;
    this.edge.clear();
    this.edge.blendMode = 'add';
    const tint = mixColor(color, accent, style.brightMix * 0.5);
    for (let i = 0; i < 3; i++) {
      const scale = 1 - i * 0.07;
      const poly = edgePolygon(this.seed, r, tick, style.wobble, scale, EDGE_POINTS);
      this.edge.poly(poly).stroke({ color: tint, width: 2 + i, alpha: 0.34 - i * 0.09 });
    }
  }
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
 * 재질 팩토리. 예산({@link MAX_FIELD_MATERIALS})을 넘으면 **빈 배열**을 돌려주고, 그러면
 * `HazardHost` 는 그 장판을 추적조차 하지 않는다 — 오염 모드에서 셀이 몇 개가 깔리든 재질
 * 비용은 10개분에서 멈춘다. 먼저 온 장판이 재질을 유지하므로 프레임마다 주인이 바뀌며
 * 깜빡이지 않는다.
 */
function fieldFactory(zone: HazardZone): HazardMaterial[] {
  const kind = hazardMaterialKind(zone.subtype, zone.permanent);
  if (kind === null) return [];
  // 반경이 너무 작으면 재질이 화면에서 구별되지 않는다 — 장식 하한과 같은 판단이다.
  if (!zone.decorated) return [];
  if (liveMaterials >= MAX_FIELD_MATERIALS) return [];
  liveMaterials++;
  return [new HazardFieldMaterial(kind, zone.id | 0)];
}

/**
 * 이미 등록했는가(모듈이 두 번 평가되거나 명시 호출이 겹쳐도 중복 등록하지 않는다).
 *
 * ⚠️ **배선 허브에게**: 이 모듈을 import 하는 지점은 `entityRenderer.ts` 나 `main.ts` 처럼
 * `hazardHost.ts` **바깥**이어야 한다. `hazardHost.ts` 나 `hazardVisual.ts` 에서 부르면
 * `hazardField → hazardHost → hazardVisual → hazardField` 순환이 생기고, 그러면 아래 최상위
 * {@link installHazardMaterials} 호출이 `hazardHost` 의 `registry`(아직 TDZ)에 닿아
 * ReferenceError 로 죽는다. 순환이 아닌 지점에서 부르면 `hazardHost` 가 먼저 완전히 평가된다.
 */
let installed = false;

/**
 * 해저드 재질을 등록한다. **멱등**이다 — 모듈 최상위에서 한 번 자동으로 불리고, 배선 허브가
 * 명시적으로 다시 불러도 안전하다(등록이 두 배가 되면 재질도 두 배가 그려진다).
 */
export function installHazardMaterials(): void {
  if (installed) return;
  installed = true;
  for (const sub of FIELD_SUBTYPES) registerHazardMaterialFactory(sub, fieldFactory);
}

/** 예산 카운터를 되돌린다. **테스트 격리 전용**(런타임에는 `dispose` 가 정확히 상쇄한다). */
export function resetHazardFieldBudget(): void {
  liveMaterials = 0;
}

installHazardMaterials();
