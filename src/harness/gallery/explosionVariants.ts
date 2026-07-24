/**
 * 파티클 폭발 변형군 (Phase 1 갤러리 — plan §AC-1.2 ①파티클 폭발 / ADR-0031 combat 레지스터).
 *
 * 기존 사망 FX `spawnExplosion`([src/render/entityRenderer.ts])은 **단일 스프라이트 24프레임
 * 페이드** 한 장이다. 이 파일은 그것을 능가하는 **절차적 파티클 폭발** 3종을 만든다. Phase 2
 * (AC-2.4)에서 이 중 사용자가 고른 변형이 `spawnExplosion` 을 그대로 교체할 프로덕션 코드다.
 *
 * ── 계약(넘을 수 없음) ────────────────────────────────────────────────────────
 *  - **render-only**: sim·hashWorld/hashEntity 무접촉. `src/sim/` 을 import 하지 않는다.
 *  - **시각 레지스터 = combat(SF 픽셀아트)**: 흰 코어 + 주황/노랑 불티 + 시안 악센트, 전부
 *    가산(additive) blend 로 플래시가 겹쳐 밝아진다.
 *  - **결정론 무관하되 재현 가능**: `Date`/`Math.random` 을 쓰지 않는다. 무작위가 필요하면
 *    시드 고정 LCG({@link Lcg}) 스트림에서 뽑아, 같은 `update(dt)` 시퀀스면 같은 그림이 난다.
 *  - **GL 없는 node 에서도 성립**: 파티클을 `Sprite`+`generateTexture`(렌더러=GL 필요)로 만들지
 *    않고 **절차적 `Graphics`**(동심원 소프트닷·각진 poly·스트로크 링)로 만든다. `new Graphics()`
 *    와 도형 기록·컨테이너 추가는 GL 없이 성립하고, 실제 픽셀 래스터화 때만 GL 이 쓰인다.
 *    → spawn 직후 `target.children.length` 가 동기적으로 증가한다(AC-1.4 배선 스모크 근거).
 */

import { Container, Graphics } from 'pixi.js';
import type { GalleryGroup, GalleryVariantContext, GalleryVariantHandle } from './types.js';

// ---------------------------------------------------------------------------
// 튜닝 상수 (placeholder)
//
// defer-balance-tuning: 파티클 수·수명·속도·상한의 실제 밸런스는 **구현 완료 후 출시 직전**에
// graphicsSettings 티어 상한과 함께 일괄 조정한다(사용자 지시 2026-07-22). 지금 값은 갤러리에서
// 룩을 비교하기 위한 눈대중이며, Phase 2 승격 시 티어별 파티클 상한으로 재게이트된다.
// ---------------------------------------------------------------------------

/** 한 변형이 동시에 유지하는 파티클 상한(과밀·누수 방지 안전판). 초과 시 가장 오래된 것부터 회수. */
const MAX_PARTICLES = 96;
/** 원샷 폭발 재발화 주기(초) — 갤러리 셀에서 계속 보이게 스스로 다시 터진다. */
const REFIRE_PERIOD = 1.2;
/** 프레임 델타 상한(초) — 탭 복귀 등으로 큰 dt 가 들어와도 파티클이 순간이동하지 않게 클램프. */
const MAX_DT = 0.05;

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
// 파티클 모델 — 하나의 통합 적분기가 세 변형의 파편·불티·소프트닷·링을 모두 굴린다.
//
// 각 파티클은 자기 표시 객체(`Graphics`)를 들고, 속도+드래그로 이동, 스케일 성장(퍼프·링 팽창),
// 자전, 그리고 `alpha = 1 - (age/life)^fadePow` 페이드를 따른다. 도형은 생성 시 한 번만 그려두고
// (geometry 재기록 없음) 매 프레임 position/rotation/scale/alpha 만 갱신한다.
// ---------------------------------------------------------------------------

interface Particle {
  readonly node: Graphics;
  /** 셀 로컬 위치(px). */
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
  /** 초당 스케일 증가량(퍼프·충격 링 팽창). 0=고정 크기. */
  grow: number;
  /** 초기 스케일. */
  scale0: number;
  /** 페이드 곡선 지수. <1=초반 급강하(플래시), >1=늦게 꺼짐(연기 잔류). */
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
 * 부드러운 가산 점(플래시·연기 퍼프). 동심원 4겹을 낮은 알파로 쌓아 텍스처 없이 방사형 낙하를
 * 흉내낸다 — 가산 blend 로 겹치면 밝은 코어 + 부드러운 가장자리가 된다.
 */
function drawSoftDot(g: Graphics, radius: number, color: number): void {
  const layers = 4;
  for (let i = layers; i >= 1; i--) {
    g.circle(0, 0, (radius * i) / layers).fill({ color, alpha: 0.22 });
  }
}

/**
 * 가늘고 각진 파편(연 모양 4각형, +x 축 정렬). 진행 방향으로 node.rotation 을 맞춰 날린다.
 */
function drawShard(g: Graphics, len: number, wid: number, color: number): void {
  g.poly([len, 0, 0, wid, -len * 0.35, 0, 0, -wid]).fill({ color, alpha: 0.95 });
}

/** 작은 불티(유색 외피 + 흰 코어) — 스파크·에너지 파편. */
function drawSpark(g: Graphics, radius: number, color: number): void {
  g.circle(0, 0, radius).fill({ color, alpha: 0.9 });
  g.circle(0, 0, radius * 0.45).fill({ color: CORE, alpha: 0.95 });
}

/** 충격 링(스트로크 원) — scale 성장으로 팽창시킨다. */
function drawRing(g: Graphics, radius: number, width: number, color: number): void {
  g.circle(0, 0, radius).stroke({ color, width, alpha: 0.9 });
}

// ---------------------------------------------------------------------------
// 방출기(emit) — 변형마다 하나. `add` 로 파티클을 핸들에 넘긴다. rng 는 시드 고정 스트림.
//
// 셀 중앙 부근에서 방사한다. `reach` = 셀 짧은 변 기준 도달거리 척도라 셀 크기에 비례해 스케일한다.
// ---------------------------------------------------------------------------

type EmitFn = (ctx: GalleryVariantContext, rng: Lcg, add: (p: Particle) => void) => void;

/** 각진 파편 버스트 + 강한 가산 플래시(recommended) — 날카롭고 즉발적인 전투 폭발. */
const emitShard: EmitFn = (ctx, rng, add) => {
  const cx = ctx.width / 2;
  const cy = ctx.height / 2;
  const reach = Math.min(ctx.width, ctx.height) * 0.42;

  // 1) 중심 가산 플래시 — 빠르게 팽창하며 급강하 페이드.
  const flash = new Graphics();
  drawSoftDot(flash, reach * 0.5, CORE);
  flash.blendMode = 'add';
  add(particleAt(flash, cx, cy, { life: 0.34, scale0: 0.35, grow: 3.2, fadePow: 0.55 }));

  // 2) 각진 파편 방사 버스트 — 급감속(drag 낮음) + 살짝 텀블(spin).
  const shardCount = 16;
  for (let i = 0; i < shardCount; i++) {
    const ang = rng.range(0, Math.PI * 2);
    const speed = rng.range(reach * 2.4, reach * 4.4);
    const g = new Graphics();
    drawShard(g, rng.range(7, 13), rng.range(2.2, 3.6), rng.next() < 0.5 ? EMBER_HOT : EMBER_MID);
    g.rotation = ang;
    g.blendMode = 'add';
    add(
      particleAt(g, cx, cy, {
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
  const sparkCount = 10;
  for (let i = 0; i < sparkCount; i++) {
    const ang = rng.range(0, Math.PI * 2);
    const speed = rng.range(reach * 3, reach * 5.5);
    const g = new Graphics();
    drawSpark(g, rng.range(1.6, 2.8), rng.next() < 0.4 ? ACCENT_CYAN : EMBER_HOT);
    g.blendMode = 'add';
    add(
      particleAt(g, cx, cy, {
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        life: rng.range(0.3, 0.5),
        drag: 0.015,
        fadePow: 1.1,
      }),
    );
  }
};

/** 둥근 연기 퍼프 + 불티 — 부드럽게 부풀어 오르는 잔류형 폭발. */
const emitPuff: EmitFn = (ctx, rng, add) => {
  const cx = ctx.width / 2;
  const cy = ctx.height / 2;
  const reach = Math.min(ctx.width, ctx.height) * 0.4;

  // 1) 짧은 중심 플래시.
  const flash = new Graphics();
  drawSoftDot(flash, reach * 0.42, CORE);
  flash.blendMode = 'add';
  add(particleAt(flash, cx, cy, { life: 0.28, scale0: 0.3, grow: 2.4, fadePow: 0.5 }));

  // 2) 둥근 연기 퍼프 — 느리게 바깥+위로 흩어지며 팽창(grow), 늦게 꺼짐(fadePow>1).
  const puffCount = 11;
  for (let i = 0; i < puffCount; i++) {
    const ang = rng.range(0, Math.PI * 2);
    const speed = rng.range(reach * 0.8, reach * 1.8);
    const g = new Graphics();
    drawSoftDot(g, reach * rng.range(0.22, 0.3), rng.next() < 0.5 ? EMBER_MID : EMBER_HOT);
    g.blendMode = 'add';
    add(
      particleAt(g, cx, cy, {
        vx: Math.cos(ang) * speed,
        // 위쪽(-y) 바이어스: 연기가 떠오르는 느낌.
        vy: Math.sin(ang) * speed - reach * 0.7,
        life: rng.range(0.7, 1.05),
        drag: 0.08,
        grow: rng.range(0.6, 1.0),
        scale0: rng.range(0.5, 0.8),
        spin: rng.range(-1.2, 1.2),
        fadePow: 1.5,
      }),
    );
  }

  // 3) 불티 — 작고 밝게 위로 튀어 오른다.
  const emberCount = 9;
  for (let i = 0; i < emberCount; i++) {
    const ang = rng.range(-Math.PI, 0); // 상반원 위주(위로)
    const speed = rng.range(reach * 1.5, reach * 3);
    const g = new Graphics();
    drawSpark(g, rng.range(1.4, 2.4), rng.next() < 0.5 ? EMBER_HOT : CORE);
    g.blendMode = 'add';
    add(
      particleAt(g, cx, cy, {
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        life: rng.range(0.45, 0.75),
        drag: 0.05,
        fadePow: 1.2,
      }),
    );
  }
};

/** 짧은 충격 링 + 파편 흩뿌림 — 링이 확 퍼지고 파편이 함께 날린다. */
const emitRing: EmitFn = (ctx, rng, add) => {
  const cx = ctx.width / 2;
  const cy = ctx.height / 2;
  const reach = Math.min(ctx.width, ctx.height) * 0.4;

  // 1) 충격 링 2겹 — 시안(굵고 느림) + 흰(가늘고 빠름). scale 성장으로 팽창.
  const ring1 = new Graphics();
  drawRing(ring1, reach * 0.5, 3, ACCENT_CYAN);
  ring1.blendMode = 'add';
  add(particleAt(ring1, cx, cy, { life: 0.42, scale0: 0.12, grow: 3.6, fadePow: 0.8 }));

  const ring2 = new Graphics();
  drawRing(ring2, reach * 0.5, 2, CORE);
  ring2.blendMode = 'add';
  add(particleAt(ring2, cx, cy, { life: 0.34, scale0: 0.12, grow: 4.4, fadePow: 0.7 }));

  // 2) 코어 플래시.
  const flash = new Graphics();
  drawSoftDot(flash, reach * 0.4, CORE);
  flash.blendMode = 'add';
  add(particleAt(flash, cx, cy, { life: 0.3, scale0: 0.3, grow: 2.6, fadePow: 0.55 }));

  // 3) 파편 흩뿌림 — 링과 함께 바깥으로.
  const shardCount = 14;
  for (let i = 0; i < shardCount; i++) {
    const ang = rng.range(0, Math.PI * 2);
    const speed = rng.range(reach * 2.6, reach * 4.6);
    const g = new Graphics();
    drawShard(g, rng.range(6, 11), rng.range(2, 3.2), rng.next() < 0.5 ? EMBER_HOT : EMBER_MID);
    g.rotation = ang;
    g.blendMode = 'add';
    add(
      particleAt(g, cx, cy, {
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        life: rng.range(0.38, 0.62),
        drag: 0.02,
        spin: rng.range(-5, 5),
        fadePow: 1.25,
      }),
    );
  }

  // 4) 소수 스파크로 반짝임 보강.
  const sparkCount = 6;
  for (let i = 0; i < sparkCount; i++) {
    const ang = rng.range(0, Math.PI * 2);
    const speed = rng.range(reach * 3.5, reach * 5.5);
    const g = new Graphics();
    drawSpark(g, rng.range(1.4, 2.2), ACCENT_CYAN);
    g.blendMode = 'add';
    add(
      particleAt(g, cx, cy, {
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        life: rng.range(0.28, 0.46),
        drag: 0.015,
        fadePow: 1.1,
      }),
    );
  }
};

// ---------------------------------------------------------------------------
// 라이브 핸들 — 세 변형이 공유하는 수명 주기(방출기만 다르다).
//
// 생성 시 root 를 target 에 붙이고(=children 증가, AC-1.4) 즉시 첫 버스트를 방출한다. update 는
// 파티클 물리·페이드를 진행하고 원샷을 REFIRE_PERIOD 마다 재발화한다. destroy 는 root 서브트리를
// 통째로 파괴해 누수 0.
// ---------------------------------------------------------------------------

class BurstHandle implements GalleryVariantHandle {
  private readonly root = new Container();
  private readonly particles: Particle[] = [];
  private readonly rng: Lcg;
  private sinceRefire = 0;

  constructor(
    private readonly target: Container,
    private readonly ctx: GalleryVariantContext,
    private readonly emit: EmitFn,
    seed: number,
  ) {
    this.rng = new Lcg(seed);
    this.target.addChild(this.root);
    this.fire(); // 최초 버스트 — spawn 직후 target.children 증가(정규경로 배선 스모크 근거).
  }

  /** 파티클을 root 에 붙이고 추적 목록에 등록. 상한 초과 시 가장 오래된 것부터 회수. */
  private readonly add = (p: Particle): void => {
    if (this.particles.length >= MAX_PARTICLES) {
      const oldest = this.particles.shift();
      oldest?.node.destroy();
    }
    this.root.addChild(p.node);
    this.particles.push(p);
  };

  /** 한 번의 폭발 방출. */
  private fire(): void {
    this.emit(this.ctx, this.rng, this.add);
  }

  update(elapsedSeconds: number): void {
    const dt = Math.max(0, Math.min(elapsedSeconds, MAX_DT));

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      if (p === undefined) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.node.destroy();
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

    // 원샷 재발화 — 갤러리에서 계속 보이게.
    this.sinceRefire += dt;
    if (this.sinceRefire >= REFIRE_PERIOD) {
      this.sinceRefire -= REFIRE_PERIOD;
      this.fire();
    }
  }

  destroy(): void {
    // root 서브트리를 통째 파괴하면 모든 파티클 Graphics 도 함께 파괴되고 target 에서 분리된다.
    this.particles.length = 0;
    this.root.destroy({ children: true });
  }
}

// ---------------------------------------------------------------------------
// 갤러리 그룹 export — 취향 대비 3종. recommended = 'explosion-shard'.
// ---------------------------------------------------------------------------

export const explosionGroup: GalleryGroup = {
  id: 'explosion',
  title: '파티클 폭발',
  register: 'combat',
  variants: [
    {
      id: 'explosion-shard',
      label: '파편 버스트',
      recommended: true,
      spawn: (target, ctx) => new BurstHandle(target, ctx, emitShard, 0x0005eed1),
    },
    {
      id: 'explosion-puff',
      label: '연기 퍼프',
      spawn: (target, ctx) => new BurstHandle(target, ctx, emitPuff, 0x00009a2f),
    },
    {
      id: 'explosion-ring',
      label: '충격 링',
      spawn: (target, ctx) => new BurstHandle(target, ctx, emitRing, 0x0001c0de),
    },
  ],
};
