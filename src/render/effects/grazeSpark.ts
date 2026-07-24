/**
 * 그레이징 스파크 — 근접 회피(스침) 연출 (Phase 4 — plan §AC-4.5 · ADR-0031 combat 레지스터).
 *
 * 적 탄이 아군 함선을 **맞히지는 않았지만 아슬하게 스쳐 지나가는** 순간, 함선 표면에 짧은 가산
 * 불티가 튀어 "회피에 성공했다"는 촉각적 피드백을 준다. 이는 갤러리에서 확정된 Phase 4 전투
 * 피드백 항목(데미지 숫자·트레일·**그레이징**) 중 세 번째를 프로덕션 render-only 연출로 만든 것이다.
 *
 * ── 넘을 수 없는 계약 ────────────────────────────────────────────────────────
 *  - **그레이징은 보상이 없다**(용어집). 이 모듈은 순수 render-only 연출일 뿐 — sim·보상·판정·
 *    해시(hashWorld/hashEntity)에 **절대 개입하지 않는다**. {@link isGraze} 는 판정 결과를
 *    plain number 인자로 받아 boolean 만 돌려주는 순수함수이고, `src/sim/` 을 import 하지 않는다.
 *  - **결정론 + node 안전**: `Date`/`Math.random` 금지. 무작위 스파크 방향/속도는 시드 고정 LCG
 *    ({@link Lcg}) 에서만 뽑아, 같은 `seed`·`tier` 면 같은 스파크 수·같은 배치가 난다. Pixi `Text`
 *    금지. 파티클은 `generateTexture`(GL 필요) 없이 절차적 `Graphics` 로 만들어, node(GL 없음)
 *    에서도 `new Graphics()` + 도형 기록 + 컨테이너 추가가 성립한다 → 생성자에서 스파크를 **동기
 *    방출**해 `container.children.length > 0` 이 보장된다.
 *  - **가산 스파크**: 각 불티는 `blendMode='add'` 라 겹치면 밝아진다(어두운 배경 위 짧은 섬광).
 *    combat 네온 레지스터(흰 코어 + 청록 그레이징 하이라이트).
 *  - **레이어 규율**: effectLayer(스프라이트 위)에 얹혀 함선 표면의 스침을 순간 강조한다.
 *
 * ── rising-edge 1회 발화 ── 그레이징은 한 탄이 대역 안에 머무는 여러 프레임 동안 **계속 참**이다.
 * 매 프레임 스파크를 재발화하면 불티가 뭉개진다. {@link GrazeTracker} 가 탄 id 별로 비-그레이징→
 * 그레이징 **상태 전이(진입) 순간에만** 발화를 허용한다(soundScape.ts `prevWarn` rising-edge 선례).
 *
 * ── 밸런스 유예(defer-balance-tuning) ── 그레이징 대역폭·스파크 수·수명·색은 전부 placeholder 다.
 * 실제 값은 구현 완료 후 출시 직전 일괄 조정한다(2026-07-22 지시).
 */

import { Container, Graphics } from 'pixi.js';
import type { QualityTier } from '../qualityTier.js';

// ---------------------------------------------------------------------------
// 튜닝 상수 (placeholder · defer-balance-tuning)
// ---------------------------------------------------------------------------

/** 로컬 도달거리 척도(px). 스파크 속도가 이 값에 비례한다. 잡몹 스침에 어울리는 짧은 눈대중값. */
const BASE_REACH = 14;

/** 스파크 기본 수명(초). ~0.3s 짧은 불티(placeholder). 개별 스파크는 이 값에 약간의 지터를 곱한다. */
const SPARK_LIFE = 0.3;

/** 한 그레이징 스파크가 유지하는 파티클 상한(누수 방지 안전판). */
const MAX_PARTICLES = 24;

/** 프레임 델타 상한(초) — 탭 복귀 등 큰 dt 가 들어와도 스파크가 순간이동하지 않게 클램프. */
const MAX_DT = 0.05;

/** 무작위 시드 기본값(미지정 시). */
const DEFAULT_SEED = 0x00d6a2e5;

/** 상승 드리프트(px/초) — "불티가 살짝 위로 솟는" 느낌의 초기 상향 속도 바이어스(placeholder). */
const RISE_DRIFT = BASE_REACH * 1.2;

/**
 * 티어별 스파크 수(placeholder). Low=최소, Med/High 로 갈수록 풍성(단조). 어느 티어든 최소 1개는
 * 남겨 그레이징이 느껴지게 한다(children>0 보장).
 */
const TIER_SPARKS: Record<QualityTier, number> = {
  low: 3,
  med: 5,
  high: 8,
};

// ── combat 네온 팔레트(placeholder) ─────────────────────────────────────────
/** 흰 코어(불티 심). */
const CORE = 0xffffff;
/** 청록 그레이징 하이라이트(아슬한 스침의 냉광). */
const GRAZE_TINT = 0x9fe4ff;

// ---------------------------------------------------------------------------
// 순수 근접 회피 판정 — sim 무접촉, plain number 인자만.
// ---------------------------------------------------------------------------

/**
 * "스침(그레이징)" 여부 — 탄이 아군을 **맞히지는 않았으나 근접 대역 안**을 지나갔는가.
 *
 * 판정: `pr + br < dist && dist <= pr + br + band`.
 *  - `dist ≤ pr + br`(합 반경 안 = 실충돌/판정점 안) 이면 **false**(스치는 게 아니라 맞았다).
 *  - `dist > pr + br + band`(근접 대역 바깥 = 멀리) 이면 **false**.
 *  - 그 사이(판정점 밖 + 근접 대역 안) 일 때만 **true**.
 *
 * 순수함수 — 부작용·sim 접촉 없음. 보상 없음(용어집): 이 판정은 오직 연출 발화 여부만 가른다.
 *
 * @param px,py 아군(회피 주체) 중심 좌표.
 * @param pr    아군 충돌 반경(≥0).
 * @param bx,by 탄 중심 좌표.
 * @param br    탄 충돌 반경(≥0).
 * @param band  근접 대역폭(px, ≥0) — 충돌 경계 바깥으로 이만큼까지가 "스침".
 * @returns 스침이면 true, 아니면 false. NaN·비유한·음수 반경/대역은 방어적으로 false(항상 boolean).
 */
export function isGraze(
  px: number,
  py: number,
  pr: number,
  bx: number,
  by: number,
  br: number,
  band: number,
): boolean {
  // 방어: 어떤 인자든 비유한(NaN/∞) 이면 판정 불가 → false.
  if (
    !Number.isFinite(px) ||
    !Number.isFinite(py) ||
    !Number.isFinite(pr) ||
    !Number.isFinite(bx) ||
    !Number.isFinite(by) ||
    !Number.isFinite(br) ||
    !Number.isFinite(band)
  ) {
    return false;
  }
  // 방어: 음수 반경/대역은 무의미 → false.
  if (pr < 0 || br < 0 || band < 0) return false;

  const dist = Math.hypot(bx - px, by - py);
  const contact = pr + br; // 실충돌 경계(합 반경)
  const outer = contact + band; // 근접 대역 바깥 경계(포함)
  // 판정점 밖(스침) + 근접 대역 안(경계 포함) 일 때만 true.
  return contact < dist && dist <= outer;
}

// ---------------------------------------------------------------------------
// GrazeTracker — 탄 id 별 rising-edge 1회 발화 게이트.
//
// 그레이징은 탄이 대역 안에 머무는 여러 프레임 동안 계속 true 다. 스파크를 매 프레임 재발화하면
// 뭉개지므로, 탄 id 가 **비-그레이징 → 그레이징으로 진입하는 순간에만** 발화를 허용한다.
// (soundScape.ts `prevWarn` false→true rising-edge 선례.)
// ---------------------------------------------------------------------------

export class GrazeTracker {
  /** 현재 그레이징 중인 탄 id 집합(직전 프레임 상태 기록). */
  private readonly grazing = new Set<number>();

  /**
   * 이번 프레임에 탄 `id` 의 스파크를 발화할지 판정하고 상태를 갱신한다.
   *
   * @param id          탄 식별자.
   * @param grazingnow  이번 프레임의 그레이징 여부({@link isGraze} 결과).
   * @returns 직전 비-그레이징이었다가 이번에 그레이징으로 **진입하는 순간**에만 true. 연속 그레이징
   *          중이거나(이미 집합에 있음) 비-그레이징이면 false.
   */
  shouldSpark(id: number, grazingNow: boolean): boolean {
    const wasGrazing = this.grazing.has(id);
    if (grazingNow) {
      this.grazing.add(id);
      return !wasGrazing; // rising-edge: 진입 순간에만 1회.
    }
    // 비-그레이징: 상태를 내려 다음 진입이 다시 rising-edge 가 되게 한다.
    this.grazing.delete(id);
    return false;
  }

  /** 탄 소멸 시 상태 제거(id 재사용 시 유령 상태 방지). */
  forget(id: number): void {
    this.grazing.delete(id);
  }

  /** 런 시작 시 전체 초기화. */
  reset(): void {
    this.grazing.clear();
  }
}

// ---------------------------------------------------------------------------
// 시드 고정 LCG — Date/Math.random 없이 재현 가능한 난수 스트림.
// (Numerical Recipes 계수. 32-bit 곱은 Math.imul 로 오버플로 안전하게.)
// ---------------------------------------------------------------------------

class Lcg {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  /** [0,1). */
  next(): number {
    this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
    return this.s / 0x1_0000_0000;
  }
  /** [lo,hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
}

// ---------------------------------------------------------------------------
// 스파크 파티클 — 방사 산란 + 상승 드리프트 + 페이드.
//
// 도형은 생성 시 한 번만 그려두고(geometry 재기록 없음) 매 프레임 position/alpha 만 갱신한다.
// alpha = 1 - (age/life)^fadePow 로 짧게 꺼진다("불티 상승/페이드"의 페이드 축).
// ---------------------------------------------------------------------------

interface Spark {
  readonly node: Graphics;
  /** container 로컬 위치(px). 스침 지점 origin(0,0) 기준. */
  x: number;
  y: number;
  /** 속도(px/초). */
  vx: number;
  vy: number;
  /** 누적 수명(초). */
  age: number;
  /** 총 수명(초). */
  life: number;
  /** 초당 속도 유지율(0<drag≤1). 낮을수록 급감속. */
  drag: number;
  /** 페이드 곡선 지수(>1=늦게 꺼짐). */
  fadePow: number;
}

/** 작은 불티(청록/흰 외피 + 흰 코어) — 가산 스파크. */
function drawSpark(g: Graphics, radius: number, color: number): void {
  g.circle(0, 0, radius).fill({ color, alpha: 0.9 });
  g.circle(0, 0, radius * 0.45).fill({ color: CORE, alpha: 0.95 });
}

// ---------------------------------------------------------------------------
// GrazeSpark — entityRenderer 가 소비할 원샷 그레이징 불티 버스트.
//
// 생성자에서 스파크를 **동기 방출**해 container.children 을 채운다(호출측이 effectLayer 에
// addChild). update(dt) 는 이동·페이드를 진행하고 살아있는지 boolean 으로 알린다. 전부 끝나면
// (false) 호출측이 container 를 effectLayer 에서 떼고 destroy 한다.
// ---------------------------------------------------------------------------

/** {@link GrazeSpark} 생성 옵션. */
export interface GrazeSparkOptions {
  /** 품질 티어. 미지정 시 'high'(정상 밀도). Low 는 스파크 수를 줄인다. */
  tier?: QualityTier;
  /** 무작위 시드. 미지정 시 {@link DEFAULT_SEED}. 같은 시드·tier → 같은 스파크 수·배치. */
  seed?: number;
}

export class GrazeSpark {
  /** 스파크를 담은 컨테이너. 호출측이 effectLayer 에 addChild 하고, update 가 false 면 제거+destroy. */
  readonly container: Container = new Container();

  private readonly sparks: Spark[] = [];
  private readonly rng: Lcg;
  private readonly tier: QualityTier;
  private destroyed = false;

  /**
   * @param x    스침 지점 월드 X(effectLayer 로컬).
   * @param y    스침 지점 월드 Y.
   * @param opts 티어·시드(선택).
   */
  constructor(x: number, y: number, opts?: GrazeSparkOptions) {
    this.tier = opts?.tier ?? 'high';
    this.rng = new Lcg(opts?.seed ?? DEFAULT_SEED);
    this.container.position.set(x, y);
    this.emit(); // 원샷 — 생성 즉시 스파크를 채운다(container.children>0, 배선 스모크 근거).
  }

  /** 스파크를 container 에 붙이고 추적 목록에 등록. 상한 초과 시 가장 오래된 것부터 회수. */
  private readonly add = (p: Spark): void => {
    if (this.sparks.length >= MAX_PARTICLES) {
      const oldest = this.sparks.shift();
      oldest?.node.destroy();
    }
    this.container.addChild(p.node);
    this.sparks.push(p);
  };

  /** 그레이징 불티 1회 방출 — 방사 산란 + 상승 드리프트. origin(0,0) 기준. */
  private emit(): void {
    const rng = this.rng;
    const count = TIER_SPARKS[this.tier];
    for (let i = 0; i < count; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const speed = rng.range(BASE_REACH * 1.5, BASE_REACH * 3);
      const g = new Graphics();
      drawSpark(g, rng.range(1.2, 2.2), rng.next() < 0.5 ? GRAZE_TINT : CORE);
      g.blendMode = 'add';
      const node = particleAt(g, 0, 0, {
        vx: Math.cos(ang) * speed,
        // 상향 바이어스로 불티가 살짝 위로 솟는다("상승").
        vy: Math.sin(ang) * speed - RISE_DRIFT,
        life: SPARK_LIFE * rng.range(0.7, 1),
        drag: 0.02,
        fadePow: 1.1,
      });
      this.add(node);
    }
  }

  /**
   * 스파크 이동·페이드를 진행하고 수명 만료분을 제거한다.
   *
   * @param deltaSeconds 프레임 델타(초). 큰 값은 {@link MAX_DT} 로 클램프(탭 복귀 방어).
   * @returns 아직 살아있는 스파크가 있으면 true, 전부 끝났으면 false. **false 면 호출측이 container 를
   *          effectLayer 에서 제거하고 destroy() 해야 한다**(원샷이라 재발화 없음).
   */
  update(deltaSeconds: number): boolean {
    if (this.destroyed) return false;
    const dt = Math.max(0, Math.min(deltaSeconds, MAX_DT));

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i];
      if (p === undefined) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.node.destroy(); // container 에서 분리 + geometry 해제.
        this.sparks.splice(i, 1);
        continue;
      }
      // 속도 적분 + 지수 드래그(초당 유지율 drag).
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const damp = Math.pow(p.drag, dt);
      p.vx *= damp;
      p.vy *= damp;
      // 표시 상태 갱신(페이드).
      const t = p.age / p.life; // 0→1
      p.node.position.set(p.x, p.y);
      p.node.alpha = Math.max(0, 1 - Math.pow(t, p.fadePow));
    }

    return this.sparks.length > 0;
  }

  /** 즉시 정리 — container 서브트리를 통째 파괴(모든 스파크 Graphics 포함)하고 부모에서 분리한다. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.sparks.length = 0;
    this.container.destroy({ children: true });
  }
}

/** 스파크 설정(생성 편의) — 미지정 필드는 안전한 기본값으로 채운다. */
interface SparkCfg {
  vx?: number;
  vy?: number;
  life?: number;
  drag?: number;
  fadePow?: number;
}

/** 표시 객체 + 초기 상태 → Spark. 초기 위치를 즉시 반영해 첫 페인트가 옳게 나오게. */
function particleAt(node: Graphics, x: number, y: number, cfg: SparkCfg): Spark {
  const p: Spark = {
    node,
    x,
    y,
    vx: cfg.vx ?? 0,
    vy: cfg.vy ?? 0,
    age: 0,
    life: cfg.life ?? SPARK_LIFE,
    drag: cfg.drag ?? 1,
    fadePow: cfg.fadePow ?? 1,
  };
  node.position.set(x, y);
  return p;
}
