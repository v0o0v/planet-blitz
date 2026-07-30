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

import { Container, DisplacementFilter, Graphics, Sprite } from 'pixi.js';

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
  CRUST_TEX_SIZE,
  GLOW_TEX_SIZE,
  GROUND_TEX_SIZE,
  LENS_DISP_SIZE,
  MOTE_TEX_SIZE,
  blobTexture,
  contactTexture,
  crustTexture,
  glowTexture,
  lensDisplacementTexture,
  moteTexture,
  rimTexture,
} from './hazardTexture.js';
import {
  CRUST_COVER,
  CRUST_FLOW_FALLOFF,
  GROUND_COVER,
  MAX_FIELD_MATERIALS,
  hazardAmbience,
  hazardAmbienceShape,
  hazardCrustSpec,
  hazardGrounding,
  hazardLobeStyle,
  hazardLod,
  hazardMaterialKind,
  kindUsesDistortion,
  lobeAlphaScale,
  lobeAt,
  lobeLife,
  lobeSpin,
  lodHasGrounding,
  lodHasMotes,
  lodLobeCount,
  lodMoteScale,
  materialIntensity,
  mixColor,
  moteAt,
  moteBudget,
  moteRise,
  stepCharge,
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
  readonly crustShade: Container;
  readonly crustAdd: Container;
  /** 굴절 전용 가산 겹. **공유 변위 필터가 여기 하나에만 걸린다**(§2-3 예산). */
  readonly lens: Container;
  readonly lobes: Container;
  readonly rim: Container;
  readonly charge: Container;
  readonly motes: Container;
  /** 변위맵 스프라이트(렌즈 겹의 자식). 필터를 못 만들면 null. */
  readonly lensDisp: Sprite | null;
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
  //
  // 순서(아래→위)가 곧 물리다: 그늘·껍질(곱연산)이 먼저 바닥을 파고, 그 위에 발광 균열과
  // 로브가 얹히고, 림이 가장자리를 세우고, 입자가 맨 위에서 솟는다.
  const ambientAdd = mk('hazardAmbientAdd', 'add');
  const ambientFog = mk('hazardAmbientFog', 'normal');
  const contact = mk('hazardContact', 'multiply');
  const crustShade = mk('hazardCrustShade', 'multiply');
  const crustAdd = mk('hazardCrustAdd', 'add');
  const lens = mk('hazardLens', 'add');
  const lobes = mk('hazardLobes', 'add');
  const rim = mk('hazardRim', 'add');
  const charge = mk('hazardCharge', 'add');
  const motes = mk('hazardMotes', 'add');
  return {
    root,
    ambientAdd,
    ambientFog,
    contact,
    crustShade,
    crustAdd,
    lens,
    lobes,
    rim,
    charge,
    motes,
    lensDisp: attachLensFilter(lens),
  };
}

/**
 * 굴절 겹에 **공유 변위 필터 하나**를 건다(§2-3: 장판마다 필터를 만들면 예산이 무조건 터진다).
 *
 * ## 무엇이 실제로 휘는가 — 한계를 먼저 적는다
 * 이 필터는 **자기 겹의 내용만** 휜다(집광 무늬·유리 테두리). 장판 **뒤의 포탑**이 휘려면
 * 월드 컨테이너나 `overlay`/`lavaOverlay` 캔버스에 필터가 걸려야 하는데, 그 셋은 전부
 * `entityRenderer.ts` 소유다(레인 C 밖). 열려야 하는 심은 정확히 하나다: **`lavaOverlay` 에
 * 시머를 거는 자리와 같은 방식으로, 굴절 장판이 있을 때 월드 컨테이너에 변위 필터를 걸어 주는
 * 훅.** 레인 C 는 변위맵({@link lensDisplacementTexture})과 필터 파라미터를 이미 갖고 있으므로,
 * 그 심이 열리면 스프라이트 하나를 넘기는 것으로 끝난다.
 *
 * 실패해도 게임은 돈다(`tryCreateFilter` 정신) — 변위맵이 없거나 필터 생성이 던지면 `null` 을
 * 돌려주고 겹은 왜곡 없이 그려진다.
 */
function attachLensFilter(lens: Container): Sprite | null {
  const tex = lensDisplacementTexture();
  if (tex === null) return null;
  try {
    const sp = new Sprite(tex);
    sp.anchor.set(0.5);
    sp.renderable = false; // 변위맵은 화면에 나오지 않는다(필터 입력일 뿐).
    lens.addChild(sp);
    lens.filters = [new DisplacementFilter({ sprite: sp, scale: LENS_DISP_SCALE })];
    return sp;
  } catch {
    lens.filters = [];
    return null;
  }
}

/** 변위 세기(px). 크게 잡으면 유리가 아니라 열파(heat haze)로 읽힌다. */
const LENS_DISP_SCALE = 14;

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
  lensFrame = -1;
}

/**
 * 변위맵 스프라이트를 굴절 장판 전체가 덮이게 옮긴다.
 *
 * 변위 필터는 **변위 스프라이트의 화면 위치**로 좌표를 읽으므로, 월드가 스크롤하는 이 게임에서
 * 고정 위치는 성립하지 않는다. 프레임마다 굴절 장판들의 경계 상자를 모아 씌운다 — 프레임의
 * 첫 굴절 재질이 상자를 초기화하고, 이후 재질이 확장하며, **마지막 호출이 이긴다**(재질마다
 * 필터를 만들지 않고 하나로 덮는 유일한 방법이다).
 */
let lensFrame = -1;
let lensMinX = 0;
let lensMinY = 0;
let lensMaxX = 0;
let lensMaxY = 0;

function coverLens(frameTick: number, x: number, y: number, r: number): void {
  const s = stage;
  if (s === null || s.lensDisp === null) return;
  if (lensFrame !== frameTick) {
    lensFrame = frameTick;
    lensMinX = x - r;
    lensMinY = y - r;
    lensMaxX = x + r;
    lensMaxY = y + r;
  } else {
    if (x - r < lensMinX) lensMinX = x - r;
    if (y - r < lensMinY) lensMinY = y - r;
    if (x + r > lensMaxX) lensMaxX = x + r;
    if (y + r > lensMaxY) lensMaxY = y + r;
  }
  const w = lensMaxX - lensMinX;
  const h = lensMaxY - lensMinY;
  s.lensDisp.position.set((lensMinX + lensMaxX) / 2, (lensMinY + lensMaxY) / 2);
  s.lensDisp.scale.set(Math.max(w, h) / LENS_DISP_SIZE);
}

// ---------------------------------------------------------------------------
// 종류별 표현 파라미터 — "무엇이 어떻게 움직이는가"
// ---------------------------------------------------------------------------
//
// 알파·보간 계수·덮는 비율은 전부 `hazardShape.ts` 소유다(5차): §2-4 가산 회계
// (`additiveLayerSpecs`)가 같은 값을 읽어야 예산과 화면이 어긋나지 않고, 그 회계는 Pixi 를
// 모르는 파일에 있어야 GL 없이 검증된다.

/** 환경 기여 falloff 링 수(공유 텍스처를 못 만들 때만 쓰는 절차적 폴백). */
const AMBIENT_FALLBACK_RINGS = 5;

// ---------------------------------------------------------------------------
// 재질 본체
// ---------------------------------------------------------------------------

class HazardFieldMaterial implements HazardMaterial {
  readonly name: string;

  /** 겹별 하위 컨테이너. 각각 공유 레이어의 자식이고, 위치만 매 프레임 옮긴다. */
  private readonly ambientNode = new Container();
  private readonly crustShadeNode = new Container();
  private readonly crustAddNode = new Container();
  private readonly lobeNode = new Container();
  private readonly moteNode = new Container();
  private readonly groundNode = new Container();
  /**
   * 림 스프라이트의 컨테이너. 접촉 그늘(곱연산)과 림(가산)은 **블렌드가 달라** 같은 겹에
   * 못 들어가므로 하위 컨테이너가 둘 필요하다.
   */
  private readonly rimHolder = new Container();
  private readonly chargeNode = new Container();

  private readonly lobes: Sprite[] = [];
  private readonly motes: Sprite[] = [];
  /** 면적 재질의 가산 겹(흐름 때문에 여러 장). */
  private readonly crustAdds: Sprite[] = [];
  private crustShadeSprite: Sprite | null = null;
  private contactSprite: Sprite | null = null;
  private rimSprite: Sprite | null = null;
  private chargeSprite: Sprite | null = null;
  /** 폴백(텍스처 없음) 경로에서 쓰는 로브 도형. 스프라이트를 못 만들 때만 채워진다. */
  private readonly lobeShapes: Graphics[] = [];

  /** 열은 **호스트가 소유한다**(`HazardZone.heat`). 재질은 읽기만 한다. */
  private heat = 0;
  private chargeLevel = 0;
  private builtRadius = 0;
  private builtMotes = -1;
  private builtLobes = -1;
  private disposed = false;
  private attached = false;

  constructor(
    private readonly kind: HazardMaterialKind,
    private readonly seed: number,
    /** 부착 시 동시 생존 수가 정한 상세 단계. **수명 내내 바뀌지 않는다.** */
    private readonly lod: HazardLod,
  ) {
    this.name = `hazardField:${kind}:${lod}`;
    for (const n of this.nodes()) n.label = this.name;
  }

  /** 이 재질의 모든 하위 컨테이너(부착·위치 갱신·회수가 같은 목록을 쓴다). */
  private nodes(): readonly Container[] {
    return [
      this.ambientNode,
      this.crustShadeNode,
      this.crustAddNode,
      this.lobeNode,
      this.moteNode,
      this.groundNode,
      this.rimHolder,
      this.chargeNode,
    ];
  }

  onAttach(zone: HazardZone, ctx: HazardHostContext): void {
    const s = fieldStage(ctx.layer);
    const shape = hazardAmbienceShape(this.kind);
    (shape.additive ? s.ambientAdd : s.ambientFog).addChild(this.ambientNode);
    s.crustShade.addChild(this.crustShadeNode);
    // 굴절만 변위 필터가 걸린 전용 겹으로 간다(다른 종류를 함께 넣으면 예산 없이 전부 왜곡된다).
    (kindUsesDistortion(this.kind) ? s.lens : s.crustAdd).addChild(this.crustAddNode);
    s.lobes.addChild(this.lobeNode);
    s.charge.addChild(this.chargeNode);
    // 접지는 이제 **전 LOD** 다 — 공유 텍스처 스프라이트라 41장에 붙여도 드로우콜이 안 늘어난다.
    if (lodHasGrounding(this.lod)) {
      s.contact.addChild(this.groundNode);
      s.rim.addChild(this.rimHolder);
    }
    if (lodHasMotes(this.lod)) s.motes.addChild(this.moteNode);
    this.attached = true;
    this.chargeLevel = zone.active ? 0 : 0.35;
    // 열은 호스트가 소유한다 — 처음 보는 장판도 이미 자기 목표값에서 시작해 넘어온다.
    this.heat = zone.heat;
    this.build(zone, ctx);
  }

  onFrame(zone: HazardZone, ctx: HazardHostContext): void {
    if (this.disposed) return;
    const settings = graphicsSettings.getSettings();
    const tick = settings.reducedMotion ? 0 : ctx.frameTick;
    // 열은 읽는다. **적분하지 않는다** — 호스트가 단일 진실이라야 같은 장판의 겹들(재질 + 채움
    // + 빗금 + 점선)이 같은 위상을 갖는다(3차 반려 MAJOR-4 의 처방).
    this.heat = zone.heat;
    this.chargeLevel = stepCharge(this.chargeLevel, zone.active, ctx.dt);

    // 예열↔활성은 **존재 여부가 아니라 강도·색·운동 속도**로 갈린다(1차 반려의 핵심 교훈).
    const it = materialIntensity(this.heat);

    const wantMotes = this.moteTarget(ctx, settings.reducedMotion);
    const wantLobes = lodLobeCount(this.lod, ctx.tier, ctx.gates);
    if (
      Math.abs(zone.radius - this.builtRadius) > this.builtRadius * 0.02 ||
      wantMotes !== this.builtMotes ||
      wantLobes !== this.builtLobes
    ) {
      this.build(zone, ctx);
    }

    // 하위 컨테이너는 공유 레이어의 자식이라 각자 위치를 받는다(장판별 루트가 없다).
    for (const n of this.nodes()) n.position.set(zone.x, zone.y);
    if (kindUsesDistortion(this.kind)) coverLens(ctx.frameTick, zone.x, zone.y, zone.radius * 1.2);

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

    // ── 면적 재질(껍질·균열·거품·렌즈) ───────────────────────────────────────
    // §3-C-1 이 요구한 "노이즈 텍스처 기반 재질"의 본체다. 종류마다 **다른 텍스처·다른 블렌드**
    // 라 색조가 아니라 구성이 갈린다(3차 반려 MAJOR-5).
    const crust = hazardCrustSpec(this.kind);
    const glowScale = lobeAlphaScale(ctx.gates);
    // 곱연산 겹은 발광이 아니므로 halo 게이트와 무관하고, 밝기 총량에는 순감으로 기여한다.
    if (this.crustShadeSprite !== null) {
      this.crustShadeSprite.alpha = crust.shadeAlpha * it.presence;
    }
    for (let i = 0; i < this.crustAdds.length; i++) {
      const sp = this.crustAdds[i];
      if (sp === undefined) continue;
      // 두 장이 서로 **반대로** 돈다 → 무늬가 회전이 아니라 변형으로 읽힌다(돌아가는 도장 방지).
      const dir = i % 2 === 0 ? 1 : -1.37;
      sp.rotation = tick * crust.spin * dir * it.speed;
      const k = (this.builtRadius * CRUST_COVER * 2) / CRUST_TEX_SIZE;
      if (this.kind === 'refract') {
        // 렌즈는 종횡비가 어긋난 채 숨쉬어야 "굴절"로 읽힌다(3차는 이 이방성이 로브에만 있었다).
        const breathe = 0.86 + 0.2 * Math.cos(tick * 0.021 + i);
        sp.scale.set(k * breathe, (k * 1.06) / breathe);
      } else {
        sp.scale.set(k * (i === 0 ? 1 : 0.78));
      }
      sp.alpha = crust.addAlpha * it.presence * glowScale * (i === 0 ? 1 : CRUST_FLOW_FALLOFF);
    }

    // ── 본체 로브 ────────────────────────────────────────────────────────────
    const style = hazardLobeStyle(this.kind);
    this.lobeNode.alpha = it.presence * glowScale;
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
    // 그늘은 곱연산이라 게이트와 무관하다(발광이 아니다). 림만 halo 를 따른다.
    this.groundNode.alpha = it.presence;
    this.rimHolder.alpha = it.presence * glowScale;

    // ── 예열 고조 ────────────────────────────────────────────────────────────
    // 3차는 이 겹이 장판마다 `Graphics` 였고(41장 = 41 드로우콜) 폴리곤 **fill + stroke** 라
    // 예열 컷의 "동심 윤곽 8줄"에 각진 수렴 폴리곤을 한 줄씩 보태고 있었다(3차 반려 MAJOR-6).
    // 공유 그라디언트 스프라이트로 바꾸면 드로우콜이 사라지고 **윤곽선이 하나 줄어든다** —
    // 고조는 게이지가 아니라 압력이므로 선이 아니라 번짐이 옳은 표현이기도 하다.
    const ch = this.chargeLevel;
    if (this.chargeSprite !== null) {
      this.chargeSprite.visible = ch > 0.02;
      if (this.chargeSprite.visible) {
        const grow = ((this.builtRadius * (0.5 + 0.5 * ch) * 2) / GLOW_TEX_SIZE) * 1.1;
        this.chargeSprite.scale.set(grow, grow * 0.92);
        const beat = settings.reducedMotion ? 1 : 0.72 + 0.28 * Math.sin(tick * (0.05 + 0.09 * ch));
        this.chargeSprite.alpha = ch * ch * beat * 0.55 * glowScale;
      }
    }

    // ── 입자 ─────────────────────────────────────────────────────────────────
    if (this.motes.length > 0) {
      const rise = moteRise(this.kind);
      this.moteNode.alpha = it.presence * glowScale;
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

  /** 이번 프레임의 입자 목표 수(LOD 배율 × 티어·게이트·모션 예산). */
  private moteTarget(ctx: HazardHostContext, reducedMotion: boolean): number {
    if (!lodHasMotes(this.lod)) return 0;
    return Math.round(moteBudget(ctx.tier, ctx.gates, reducedMotion) * lodMoteScale(this.lod));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    liveMaterials--;
    if (this.attached) {
      for (const n of this.nodes()) {
        n.removeFromParent();
        n.destroy({ children: true });
      }
      this.attached = false;
    }
    this.lobes.length = 0;
    this.motes.length = 0;
    this.crustAdds.length = 0;
    this.lobeShapes.length = 0;
    this.crustShadeSprite = null;
    this.contactSprite = null;
    this.rimSprite = null;
    this.chargeSprite = null;
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
    this.buildCrust(color, accent);
    this.buildGrounding(color, accent, ctx);
    this.buildLobes(r, color, accent, ctx);
    this.buildCharge(color, accent);
    this.buildMotes(color, accent, this.moteTarget(ctx, graphicsSettings.getSettings().reducedMotion));
  }

  /**
   * 면적 재질 겹. 종류별 텍스처를 스프라이트로 얹는다 — **가산·곱연산 두 겹이 따로**이므로
   * "빛나는 균열 + 굳은 껍질"처럼 서로 반대 부호의 무늬가 한 장판에 공존할 수 있다.
   */
  private buildCrust(color: number, accent: number): void {
    for (const sp of this.crustAdds) {
      sp.removeFromParent();
      sp.destroy();
    }
    this.crustAdds.length = 0;
    this.crustShadeSprite?.removeFromParent();
    this.crustShadeSprite?.destroy();
    this.crustShadeSprite = null;

    const crust = hazardCrustSpec(this.kind);
    if (crust.shade !== null) {
      const tex = crustTexture(crust.shade);
      if (tex !== null) {
        const sp = new Sprite(tex);
        sp.anchor.set(0.5);
        sp.scale.set((this.builtRadius * CRUST_COVER * 2) / CRUST_TEX_SIZE);
        this.crustShadeNode.addChild(sp);
        this.crustShadeSprite = sp;
      }
    }
    if (crust.add === null) return;
    const tex = crustTexture(crust.add);
    if (tex === null) return;
    // 균열·거품은 장판의 **같은 물질**로 보여야 한다 — 강조색 쪽으로 조금만 민다.
    const tone = mixColor(color, accent, this.kind === 'scorch' ? 0.1 : 0.4);
    for (let i = 0; i < crust.flow; i++) {
      const sp = new Sprite(tex);
      sp.anchor.set(0.5);
      sp.tint = tone;
      this.crustAddNode.addChild(sp);
      this.crustAdds.push(sp);
    }
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

  /**
   * 접촉 그늘 + 림. **방향은 전적으로 테마 광원에서 나온다**(여기 방향 상수는 없다 — 텍스처는
   * 광원이 +x 라고 가정해 굽고, 방향은 스프라이트 `rotation` 이 실는다).
   *
   * 3차는 `arc` stroke 세 겹 + 한 겹이었고 톡사르에서 실측이 **정확히 바닥**이었다. 원인은
   * 알파가 아니라 면적이다: 호 하나가 원주의 33~43% 만 덮었고 띠 두께도 반경의 16%/5.5% 였다.
   * 텍스처는 광원 반대쪽 **절반 전체**를 42% 두께로 채운다.
   */
  private buildGrounding(color: number, accent: number, ctx: HazardHostContext): void {
    for (const old of [this.contactSprite, this.rimSprite]) {
      old?.removeFromParent();
      old?.destroy();
    }
    this.contactSprite = null;
    this.rimSprite = null;
    if (!lodHasGrounding(this.lod)) return;
    const gr = hazardGrounding(ctx.theme?.light ?? null);
    if (gr.rimAlpha <= 0 && gr.shadowAlpha <= 0) return;
    const la = Math.atan2(gr.ly, gr.lx);
    const k = (this.builtRadius * GROUND_COVER * 2) / GROUND_TEX_SIZE;
    const cTex = contactTexture();
    if (cTex !== null) {
      const sp = new Sprite(cTex);
      sp.anchor.set(0.5);
      sp.rotation = la;
      sp.scale.set(k);
      sp.alpha = gr.shadowAlpha;
      this.groundNode.addChild(sp);
      this.contactSprite = sp;
    }
    const rTex = rimTexture();
    if (rTex !== null) {
      const sp = new Sprite(rTex);
      sp.anchor.set(0.5);
      sp.rotation = la;
      sp.scale.set(k);
      sp.tint = mixColor(color, accent, 0.55);
      sp.alpha = gr.rimAlpha;
      this.rimHolder.addChild(sp);
      this.rimSprite = sp;
    }
  }

  /**
   * 본체 로브. **공유 텍스처 스프라이트**라 개수가 늘어도 드로우콜이 늘지 않는다.
   *
   * 밝은 코어도 윤곽선도 없다 — 1차의 코어는 "렌즈 플레어"로, 2차의 `refract` 윤곽선은
   * "다이어그램 노드"로 읽혔다. 깊이감은 로브마다 다른 `bright` 와 겹침의 통계에서 나온다.
   */
  private buildLobes(r: number, color: number, accent: number, ctx: HazardHostContext): void {
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
    const style = hazardLobeStyle(this.kind);
    const count = lodLobeCount(this.lod, ctx.tier, ctx.gates);
    this.builtLobes = count;
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

  /**
   * 예열 고조 — **선이 아니라 번짐**이다.
   *
   * 3차는 유기 폴리곤 `fill` + `stroke` 였다. 그 stroke 가 예열 컷에서 "각진 수렴 폴리곤"으로
   * 세어졌고(3차 반려 MAJOR-6), 장판마다 `Graphics` 하나라 41장에서 드로우콜 41 이었다(MAJOR-7).
   * 공유 그라디언트 스프라이트는 둘을 한 번에 없애고, 무엇보다 **고조는 게이지가 아니라 압력**
   * 이라는 원래 논증에 표현이 더 맞다.
   */
  private buildCharge(color: number, accent: number): void {
    this.chargeSprite?.removeFromParent();
    this.chargeSprite?.destroy();
    this.chargeSprite = null;
    const tex = glowTexture();
    if (tex === null) return;
    const sp = new Sprite(tex);
    sp.anchor.set(0.5);
    sp.tint = mixColor(color, accent, 0.5);
    this.chargeNode.addChild(sp);
    this.chargeSprite = sp;
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
    const tint = mixColor(color, accent, 0.62);
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
