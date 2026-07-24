/**
 * 파편 버스트 사망 폭발 (Phase 2 — plan §AC-2.4 · ADR-0031 combat 레지스터).
 *
 * 기존 사망 FX `spawnExplosion`([src/render/entityRenderer.ts:542])은 **단일 스프라이트 24프레임
 * 페이드** 한 장이었다. 이 모듈은 Phase 1 갤러리에서 사용자가 고른 변형
 * (`explosion-shard` = "파편 버스트", `.omc/state/fx-gallery-choices.json`)을 **프로덕션 정규 경로**로
 * 승격한 것이다: 흰 코어 가산 플래시가 확 팽창하고, 각진 주황/노랑 파편이 방사로 흩어지며, 시안
 * 불티가 빠르게 튄다.
 *
 * ── 갤러리 프로토타입([src/harness/gallery/explosionVariants.ts] `emitShard`/`BurstHandle`)과의
 *    승격 차이 ────────────────────────────────────────────────────────────────
 *  1. **좌표계**: 갤러리는 셀-로컬(width/height, 중심=셀 중앙)이었다. 프로덕션은 절대 월드 좌표
 *     `(x,y)` + `scale` 을 받아, container 를 그 위치에 놓고 `scale` 로 통째 확대한다. 파티클은
 *     origin(0,0) 기준 로컬 좌표에 방출된다(= 폭발 지점).
 *  2. **수명 모델**: 갤러리 `update` 는 `void` 였고 `REFIRE_PERIOD` 마다 스스로 재발화해 셀에서
 *     계속 보이게 했다. 프로덕션 폭발은 **원샷**이다 — 재발화 없음. `update(dt)` 는 `boolean` 을
 *     돌려주고(살아있으면 true, 전부 끝나면 false), 호출측(entityRenderer)이 false 를 받으면
 *     container 를 effectLayer 에서 떼고 destroy 한다.
 *  3. **티어 상한**: 갤러리엔 없던 `QualityTier` 게이트를 도입했다. Low=최소, Med/High=정상
 *     (qualityTier `effectGates.particles` 의 'min'/'normal' 정신). `scale` 도 파티클 수를 완만히
 *     늘린다(보스 폭발이 더 풍성).
 *  4. **컨테이너 구조**: 갤러리는 공유 target 안에 nested `root` 를 뒀지만, 프로덕션은 container 를
 *     호출측이 전유하므로 파티클을 container 에 **직접** 붙인다 → `container.children.length` 가
 *     곧 살아있는 파티클 수다(배선 스모크·수명 관측이 단순해진다).
 *
 * ── 계약(넘을 수 없음) ────────────────────────────────────────────────────────
 *  - **render-only**: `src/sim/` 무접촉. 결정론(hashWorld/hashEntity)과 무관하다.
 *  - **combat 레지스터(SF 픽셀아트)**: 흰 코어 + 주황/노랑 파편 + 시안 악센트, 전부 가산(add) blend.
 *  - **재현 가능**: `Date`/`Math.random` 을 안 쓴다. 무작위는 시드 고정 LCG({@link Lcg}) 에서만
 *    뽑아, 같은 `seed`·`scale`·`tier` 면 같은 파티클 수·같은 배치가 난다.
 *  - **GL 없는 node 에서도 성립**: 파티클을 `generateTexture`(GL 필요) 없이 **절차적 `Graphics`**
 *    (동심원 소프트닷·각진 poly·유색 스파크)로 만든다. `new Graphics()` + 도형 기록 + 컨테이너
 *    추가는 GL 없이 성립하고, 실제 래스터화 때만 GL 이 쓰인다 → 생성자에서 파티클을 **동기 생성**해
 *    `container.children.length > 0` 이 보장된다.
 *  - **레이어 규율(AC-0.8)**: 이 폭발은 effectLayer(스프라이트 **위**)에 그려져 가독 레이어를 순간
 *    덮을 수 있다. 사망 유닛 위 폭발은 허용이다(살아있는 적 피드백은 tint 방식 AC-2.3). glowLayer
 *    (스프라이트 **아래**)와는 반대 규율이다.
 *
 * ── 밸런스 유예(defer-balance-tuning) ── 파티클 수·수명·속도·티어 상한은 전부 placeholder 다.
 * 실제 값은 구현 완료 후 출시 직전 graphicsSettings 티어 상한과 함께 일괄 조정한다(2026-07-22 지시).
 */

import { Container, Graphics } from 'pixi.js';
import type { QualityTier } from '../qualityTier.js';

// ---------------------------------------------------------------------------
// 튜닝 상수 (placeholder · defer-balance-tuning)
// ---------------------------------------------------------------------------

/**
 * 로컬 도달거리 척도(px, container.scale 적용 전). 플래시 반경·파편 속도·불티 속도가 이 값에
 * 비례한다. `scale=1`(잡몹) 에서 기존 46px 스프라이트 폭발과 얼추 같은 footprint 를 내도록 잡은
 * 눈대중값. container.scale 이 이 위에 곱해져 보스(scale 3)면 3배로 커진다.
 */
const BASE_REACH = 24;

/** 한 폭발이 동시에 유지하는 파티클 상한(과밀·누수 방지 안전판). 초과 시 가장 오래된 것부터 회수. */
const MAX_PARTICLES = 96;

/** 프레임 델타 상한(초) — 탭 복귀 등으로 큰 dt 가 들어와도 파티클이 순간이동하지 않게 클램프. */
const MAX_DT = 0.05;

/** 무작위 시드 기본값(미지정 시). 갤러리 `explosion-shard` 시드와 동일해 룩이 이어진다. */
const DEFAULT_SEED = 0x0005eed1;

/**
 * 티어별 파티클 기본 프로파일(placeholder). Low=최소, Med/High=정상(단조 상한). 플래시(코어)는
 * 티어 무관 항상 1개 — 폭발의 필수 앵커라 어느 티어에서도 남긴다. 티어 차이는 파편·불티 수로만.
 */
const TIER_PROFILE: Record<QualityTier, { shards: number; sparks: number }> = {
  low: { shards: 6, sparks: 3 },
  med: { shards: 12, sparks: 7 },
  high: { shards: 16, sparks: 10 },
};

// ── combat 네온 팔레트 ──────────────────────────────────────────────────────
/** 흰 코어(플래시 중심·스파크 심). */
const CORE = 0xffffff;
/** 노랑 불티. */
const EMBER_HOT = 0xffd24a;
/** 주황 불티. */
const EMBER_MID = 0xff8a2a;
/** 시안 악센트(에너지 방출감). */
const ACCENT_CYAN = 0x4ff0d0;

// ---------------------------------------------------------------------------
// 시드 고정 LCG — Date/Math.random 없이 재현 가능한 난수 스트림
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
// 파티클 모델 — 통합 적분기가 플래시·파편·불티를 모두 굴린다.
//
// 각 파티클은 자기 표시 객체(`Graphics`)를 들고, 속도+드래그로 이동, 스케일 성장(플래시 팽창),
// 자전, 그리고 `alpha = 1 - (age/life)^fadePow` 페이드를 따른다. 도형은 생성 시 한 번만 그려두고
// (geometry 재기록 없음) 매 프레임 position/rotation/scale/alpha 만 갱신한다.
// ---------------------------------------------------------------------------

interface Particle {
  readonly node: Graphics;
  /** container 로컬 위치(px). 폭발 지점 origin(0,0) 기준. */
  x: number;
  y: number;
  /** 속도(px/초). */
  vx: number;
  vy: number;
  /** 누적 수명(초). */
  age: number;
  /** 총 수명(초). */
  life: number;
  /** 초당 속도 유지율(0<drag≤1). 1=감쇠 없음, 0.02=1초 뒤 2%만 남음(파편 급감속). */
  drag: number;
  /** 초당 자전(라디안). */
  spin: number;
  /** 초당 스케일 증가량(플래시 팽창). 0=고정 크기. */
  grow: number;
  /** 초기 스케일. */
  scale0: number;
  /** 페이드 곡선 지수. <1=초반 급강하(플래시), >1=늦게 꺼짐. */
  fadePow: number;
}

/** 파티클 설정(생성 편의) — 미지정 필드는 안전한 기본값으로 채운다. */
interface PCfg {
  vx?: number;
  vy?: number;
  life?: number;
  drag?: number;
  spin?: number;
  grow?: number;
  scale0?: number;
  fadePow?: number;
}

/** 표시 객체 + 초기 상태 → Particle. 초기 위치·스케일을 즉시 반영해 첫 페인트가 옳게 나오게. */
function particleAt(node: Graphics, x: number, y: number, cfg: PCfg): Particle {
  const p: Particle = {
    node,
    x,
    y,
    vx: cfg.vx ?? 0,
    vy: cfg.vy ?? 0,
    age: 0,
    life: cfg.life ?? 0.5,
    drag: cfg.drag ?? 1,
    spin: cfg.spin ?? 0,
    grow: cfg.grow ?? 0,
    scale0: cfg.scale0 ?? 1,
    fadePow: cfg.fadePow ?? 1,
  };
  node.position.set(x, y);
  node.scale.set(p.scale0);
  return p;
}

// ---------------------------------------------------------------------------
// 절차적 도형 헬퍼 — 외부 텍스처 의존 0. 전부 Graphics geometry(=node 안전).
// ---------------------------------------------------------------------------

/**
 * 부드러운 가산 점(플래시). 동심원 4겹을 낮은 알파로 쌓아 텍스처 없이 방사형 낙하를 흉내낸다 —
 * 가산 blend 로 겹치면 밝은 코어 + 부드러운 가장자리가 된다.
 */
function drawSoftDot(g: Graphics, radius: number, color: number): void {
  const layers = 4;
  for (let i = layers; i >= 1; i--) {
    g.circle(0, 0, (radius * i) / layers).fill({ color, alpha: 0.22 });
  }
}

/** 가늘고 각진 파편(연 모양 4각형, +x 축 정렬). 진행 방향으로 node.rotation 을 맞춰 날린다. */
function drawShard(g: Graphics, len: number, wid: number, color: number): void {
  g.poly([len, 0, 0, wid, -len * 0.35, 0, 0, -wid]).fill({ color, alpha: 0.95 });
}

/** 작은 불티(유색 외피 + 흰 코어) — 스파크·에너지 파편. */
function drawSpark(g: Graphics, radius: number, color: number): void {
  g.circle(0, 0, radius).fill({ color, alpha: 0.9 });
  g.circle(0, 0, radius * 0.45).fill({ color: CORE, alpha: 0.95 });
}

// ---------------------------------------------------------------------------
// ShardBurst — entityRenderer 가 소비할 원샷 파편 버스트.
//
// 생성자에서 파티클을 **동기 방출**해 container.children 을 채운다(호출측이 effectLayer 에
// addChild). update(dt) 는 물리·페이드를 진행하고 살아있는지 boolean 으로 알린다. 전부 끝나면
// (false) 호출측이 container 를 effectLayer 에서 떼고 destroy 한다.
// ---------------------------------------------------------------------------

/** {@link ShardBurst} 생성 옵션. */
export interface ShardBurstOptions {
  /** 품질 티어. 미지정 시 'high'(정상 밀도). Low 는 파티클 수를 줄인다. */
  tier?: QualityTier;
  /** 무작위 시드. 미지정 시 {@link DEFAULT_SEED}. 같은 시드·scale·tier → 같은 파티클 수·배치. */
  seed?: number;
}

export class ShardBurst {
  /** 파티클을 담은 컨테이너. 호출측이 effectLayer 에 addChild 하고, update 가 false 를 돌려주면 제거+destroy. */
  readonly container: Container = new Container();

  private readonly particles: Particle[] = [];
  private readonly rng: Lcg;
  private readonly tier: QualityTier;
  private readonly scale: number;
  private destroyed = false;

  /**
   * @param x     폭발 지점 월드 X(effectLayer 로컬).
   * @param y     폭발 지점 월드 Y.
   * @param scale 폭발 크기 배율(잡몹 1 · 설비/기물 2 · 보스 3 — {@link explosionScale}). 크기와
   *              파티클 수를 함께 스케일한다.
   * @param opts  티어·시드(선택).
   */
  constructor(x: number, y: number, scale: number, opts?: ShardBurstOptions) {
    this.scale = scale;
    this.tier = opts?.tier ?? 'high';
    this.rng = new Lcg(opts?.seed ?? DEFAULT_SEED);

    this.container.position.set(x, y);
    // scale 로 통째 확대 — 파편/플래시 크기·간격이 폭발 규모에 비례한다. (0 이하 방어: 최소값.)
    this.container.scale.set(scale > 0 ? scale : 0.001);

    this.emit(); // 원샷 — 생성 즉시 파티클을 채운다(container.children>0, 배선 스모크 근거).
  }

  /** 파티클을 container 에 붙이고 추적 목록에 등록. 상한 초과 시 가장 오래된 것부터 회수. */
  private readonly add = (p: Particle): void => {
    if (this.particles.length >= MAX_PARTICLES) {
      const oldest = this.particles.shift();
      oldest?.node.destroy();
    }
    this.container.addChild(p.node);
    this.particles.push(p);
  };

  /** 파편 버스트 1회 방출 — 흰 코어 플래시 + 각진 파편 + 시안 불티. origin(0,0) 기준. */
  private emit(): void {
    const rng = this.rng;
    const reach = BASE_REACH;

    // scale 로 파티클 수를 완만히 늘린다(보스 폭발이 더 풍성). 상한 2배로 클램프.
    const countScale = Math.min(1 + Math.max(0, this.scale - 1) * 0.3, 2);
    const prof = TIER_PROFILE[this.tier];
    const shardCount = Math.max(1, Math.round(prof.shards * countScale));
    const sparkCount = Math.max(1, Math.round(prof.sparks * countScale));

    // 1) 중심 가산 플래시 — 빠르게 팽창하며 급강하 페이드. (티어 무관 항상 1개.)
    const flash = new Graphics();
    drawSoftDot(flash, reach * 0.5, CORE);
    flash.blendMode = 'add';
    this.add(particleAt(flash, 0, 0, { life: 0.34, scale0: 0.35, grow: 3.2, fadePow: 0.55 }));

    // 2) 각진 파편 방사 버스트 — 급감속(drag 낮음) + 살짝 텀블(spin).
    for (let i = 0; i < shardCount; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const speed = rng.range(reach * 2.4, reach * 4.4);
      const g = new Graphics();
      drawShard(g, rng.range(7, 13), rng.range(2.2, 3.6), rng.next() < 0.5 ? EMBER_HOT : EMBER_MID);
      g.rotation = ang;
      g.blendMode = 'add';
      this.add(
        particleAt(g, 0, 0, {
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          life: rng.range(0.42, 0.72),
          drag: 0.02,
          spin: rng.range(-6, 6),
          fadePow: 1.3,
        }),
      );
    }

    // 3) 시안 악센트 불티 — 더 빠르고 짧게, 에너지 방출감.
    for (let i = 0; i < sparkCount; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const speed = rng.range(reach * 3, reach * 5.5);
      const g = new Graphics();
      drawSpark(g, rng.range(1.6, 2.8), rng.next() < 0.4 ? ACCENT_CYAN : EMBER_HOT);
      g.blendMode = 'add';
      this.add(
        particleAt(g, 0, 0, {
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          life: rng.range(0.3, 0.5),
          drag: 0.015,
          fadePow: 1.1,
        }),
      );
    }
  }

  /**
   * 파티클 물리·페이드를 진행하고 수명 만료분을 제거한다.
   *
   * @param deltaSeconds 프레임 델타(초). 큰 값은 {@link MAX_DT} 로 클램프(탭 복귀 방어).
   * @returns 아직 살아있는 파티클이 있으면 true, 전부 끝났으면 false. **false 면 호출측이 container 를
   *          effectLayer 에서 제거하고 destroy() 해야 한다**(원샷이라 재발화 없음).
   */
  update(deltaSeconds: number): boolean {
    if (this.destroyed) return false;
    const dt = Math.max(0, Math.min(deltaSeconds, MAX_DT));

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      if (p === undefined) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.node.destroy(); // container 에서 분리 + geometry 해제.
        this.particles.splice(i, 1);
        continue;
      }
      // 속도 적분 + 지수 드래그(초당 유지율 drag).
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const damp = Math.pow(p.drag, dt);
      p.vx *= damp;
      p.vy *= damp;
      // 표시 상태 갱신.
      const t = p.age / p.life; // 0→1
      p.node.position.set(p.x, p.y);
      p.node.rotation += p.spin * dt;
      p.node.scale.set(p.scale0 + p.grow * p.age);
      p.node.alpha = Math.max(0, 1 - Math.pow(t, p.fadePow));
    }

    return this.particles.length > 0;
  }

  /** 즉시 정리 — container 서브트리를 통째 파괴(모든 파티클 Graphics 포함)하고 부모에서 분리한다. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.particles.length = 0;
    this.container.destroy({ children: true });
  }
}
