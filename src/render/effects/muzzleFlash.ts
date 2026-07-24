/**
 * 머즐 플래시 — 발사 순간 총구 섬광 (Phase 4 — plan §AC-4.7 · ADR-0031 combat 레지스터).
 *
 * 사격 피드백의 마지막 한 조각이다: 탄이 나가는 그 프레임, 총구 위치에서 아주 짧게(placeholder ~0.12s)
 * 흰 코어가 확 팽창하며 급페이드하는 가산(add) 섬광. 방향(`angle`)을 주면 총구가 향한 쪽으로 뻗는
 * 원뿔/스타버스트가 되고, 생략하면 무방향 원형 섬광이 된다.
 *
 * ── 계약(넘을 수 없음) ────────────────────────────────────────────────────────
 *  - **render-only**: `src/sim/` 무접촉. hashWorld/hashEntity 결정론과 무관한 순수 표시 효과다.
 *  - **가산 섬광(add blend)**: 섬광 조각은 전부 `blendMode='add'` 로 그린다. tint 곱연산이 아니라
 *    **fill 색 + 가산 합성**이라, 흰색(0xffffff)도 항등원이 아니라 실제로 배경을 밝힌다(밝힘=가산
 *    오버레이 원칙). `opts.color` 역시 tint 가 아니라 fill 색으로 들어가 그대로 가산된다.
 *  - **재현 가능**: `Date`/`Math.random` 을 안 쓴다. 살짝의 스파크 길이 흔들림은 시드 고정
 *    LCG({@link Lcg}) 로만 뽑아, **같은 인자면 언제나 같은 자식 수·같은 지오메트리**가 난다.
 *  - **GL 없는 node 에서도 성립**: 섬광을 `generateTexture`(GL 필요) 없이 절차적 `Graphics`(동심원
 *    소프트닷 · 각진 원뿔/스파이크)로 만든다. `new Graphics()` + 도형 기록 + 컨테이너 추가는 GL 없이
 *    성립하므로 생성자에서 **동기 생성**해 `container.children.length > 0` 이 보장된다.
 *  - **Pixi Text 금지**: 텍스트를 안 쓴다(전량 Graphics geometry).
 *  - **레이어 규율(AC-0.8)**: 총구 섬광은 effectLayer(스프라이트 **위**)에 얹혀 발사 순간을 순간
 *    강조한다. 원샷·초단명이라 가독 레이어를 오래 덮지 않는다.
 *
 * ── 소비 계약(ShardBurst 와 동일 형태) ──────────────────────────────────────────
 *  1. 생성자에서 섬광을 **동기 방출**해 `container.children` 을 채운다(호출측이 effectLayer 에 addChild).
 *  2. `update(dt)` 는 급팽창+급페이드를 진행하고 아직 살아있으면 true, 수명이 끝나면 false 를 돌려준다.
 *     **false 면 호출측이 container 를 effectLayer 에서 떼고 destroy() 해야 한다**(원샷 — 재발화 없음).
 *  3. `container` 는 호출측이 전유한다: 섬광 조각은 로컬 origin(0,0) 기준으로 그려지고, container 를
 *     총구 위치 `(x,y)` 로 옮겨 놓는다(생성자에서 배치). 방향 섬광은 container.rotation 으로 회전한다.
 *
 * ── 밸런스 유예(defer-balance-tuning) ── 섬광 크기·수명·색·팽창률은 전부 placeholder 다. 실제 값은
 * 구현 완료 후 출시 직전 graphicsSettings 와 함께 일괄 조정한다(2026-07-22 지시).
 */

import { Container, Graphics } from 'pixi.js';

// ---------------------------------------------------------------------------
// 튜닝 상수 (placeholder · defer-balance-tuning)
// ---------------------------------------------------------------------------

/** 섬광 총 수명(초). 아주 짧게 — 발사 프레임 근처에서만 번쩍이고 사라진다. */
const FLASH_LIFE = 0.12;

/** 프레임 델타 상한(초) — 탭 복귀 등 큰 dt 가 들어와도 섬광이 순간 종료되지 않게 클램프. */
const MAX_DT = 0.05;

/** 팽창 시작 스케일(baseScale 위에 곱해짐). 작게 시작해 급팽창한다. */
const START_SCALE = 0.55;
/** 팽창 끝 스케일. 수명 동안 START_SCALE → END_SCALE 로 확 커진다(급팽창). */
const END_SCALE = 1.85;

/** 페이드 곡선 지수(<1 = 초반 급강하). 섬광답게 밝게 튀었다가 빠르게 꺼진다(급페이드). */
const FADE_POW = 0.6;

/** 코어 소프트닷 반경(px, baseScale 적용 전). 섬광의 밝은 심. */
const CORE_RADIUS = 7;

/** 무방향 원형 섬광의 방사 스파이크 개수(고정 — 결정론). */
const RADIAL_SPIKES = 8;
/** 스파이크 기본 길이/반두께(px). */
const SPIKE_LEN = 15;
const SPIKE_HALF = 2.4;

/** 방향 섬광 원뿔 길이/반두께(px, +x 축 정렬 후 container.rotation 으로 회전). */
const CONE_LEN = 24;
const CONE_HALF = 8;
/** 방향 섬광의 전방 보조 광선 길이/반두께. */
const SIDE_LEN = 12;
const SIDE_HALF = 2.2;

/** 무작위 시드(스파이크 길이 흔들림용). 고정값 — 같은 인자면 언제나 같은 지오메트리. */
const DEFAULT_SEED = 0x00f1a58e;

// ── combat 팔레트 ───────────────────────────────────────────────────────────
/** 흰 코어(섬광 중심). 가산 합성이라 흰색도 배경을 실제로 밝힌다. */
const CORE = 0xffffff;
/** 기본 섬광 몸체 색(따뜻한 화이트-옐로). `opts.color` 미지정 시 사용. */
const DEFAULT_FLASH_COLOR = 0xffe39a;

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
// 절차적 도형 헬퍼 — 외부 텍스처 의존 0. 전부 Graphics geometry(=node 안전).
// ---------------------------------------------------------------------------

/**
 * 부드러운 가산 점(코어). 동심원 4겹을 낮은 알파로 쌓아 텍스처 없이 방사형 낙하를 흉내낸다 —
 * 가산 blend 로 겹치면 밝은 코어 + 부드러운 가장자리가 된다. (explosion.ts `drawSoftDot` 와 동형.)
 */
function drawSoftDot(g: Graphics, radius: number, color: number): void {
  const layers = 4;
  for (let i = layers; i >= 1; i--) {
    g.circle(0, 0, (radius * i) / layers).fill({ color, alpha: 0.24 });
  }
}

/** 가늘고 각진 광선(연 모양 4각형, +x 축 정렬). 회전은 node.rotation 으로 방향을 맞춘다. */
function drawRay(g: Graphics, len: number, half: number, color: number): void {
  g.poly([len, 0, 0, half, -len * 0.28, 0, 0, -half]).fill({ color, alpha: 0.92 });
}

/** 방향 섬광 원뿔(+x 로 벌어지는 삼각 웨지). 코어에서 총구 방향으로 뻗는 불꽃. */
function drawCone(g: Graphics, len: number, half: number, color: number): void {
  g.poly([0, 0, len, half, len * 1.12, 0, len, -half]).fill({ color, alpha: 0.9 });
}

// ---------------------------------------------------------------------------
// MuzzleFlash — entityRenderer 가 소비할 원샷 총구 섬광.
//
// 생성자에서 섬광 조각(Graphics)을 동기 방출해 container.children 을 채운다(호출측이 effectLayer 에
// addChild). update(dt) 는 컨테이너 단위 스케일(급팽창)·알파(급페이드)를 진행하고 살아있는지 boolean
// 으로 알린다. 수명이 끝나면(false) 호출측이 container 를 떼고 destroy 한다.
// ---------------------------------------------------------------------------

/** {@link MuzzleFlash} 생성 옵션. */
export interface MuzzleFlashOptions {
  /** 섬광 몸체 색(fill 색으로 가산). 미지정 시 {@link DEFAULT_FLASH_COLOR}(따뜻한 화이트-옐로). */
  color?: number;
  /** 섬광 크기 배율(baseScale). 미지정 시 1. 큰 무기일수록 크게. */
  scale?: number;
}

export class MuzzleFlash {
  /** 섬광 조각을 담은 컨테이너. 호출측이 effectLayer 에 addChild 하고, update 가 false 면 제거+destroy. */
  readonly container: Container = new Container();

  private readonly rng: Lcg;
  private readonly baseScale: number;
  private age = 0;
  private destroyed = false;

  /**
   * @param x     총구 위치 월드 X(effectLayer 로컬).
   * @param y     총구 위치 월드 Y.
   * @param angle 발사 방향(라디안). 주면 그 방향으로 뻗는 원뿔/스타버스트, 생략하면 무방향 원형 섬광.
   * @param opts  색·크기(선택).
   */
  constructor(x: number, y: number, angle?: number, opts?: MuzzleFlashOptions) {
    this.rng = new Lcg(DEFAULT_SEED);
    const s = opts?.scale ?? 1;
    this.baseScale = s > 0 ? s : 0.001; // 0 이하 방어(scale.set 붕괴 방지).

    // 섬광 조각은 로컬 origin(0,0) 기준으로 그려지고, container 를 총구 위치로 옮긴다.
    this.container.position.set(x, y);
    // 방향이 있으면 container 를 통째 회전 → +x 로 그린 원뿔/보조광선이 총구 방향을 향한다.
    if (angle !== undefined) this.container.rotation = angle;
    // 시작 스케일 반영(첫 페인트가 옳게 나오게). update 가 이 위에서 팽창시킨다.
    this.container.scale.set(this.baseScale * START_SCALE);

    const color = opts?.color ?? DEFAULT_FLASH_COLOR;
    this.emit(angle, color); // 원샷 — 생성 즉시 섬광 조각을 채운다(children>0, 배선 스모크 근거).
  }

  /** 섬광 조각 1회 방출. 방향 유무에 따라 원뿔+보조광선 / 방사 스타버스트를 그린다. 항상 코어 포함. */
  private emit(angle: number | undefined, color: number): void {
    const rng = this.rng;

    // 1) 흰 코어 — 방향 무관 항상 1개. 섬광의 밝은 심(가산).
    const core = new Graphics();
    drawSoftDot(core, CORE_RADIUS, CORE);
    core.blendMode = 'add';
    this.container.addChild(core);

    if (angle !== undefined) {
      // 2a) 방향 섬광 — 전방 원뿔 1 + 좌우 보조광선 2. (+x 정렬; container.rotation 이 총구 방향으로.)
      const cone = new Graphics();
      drawCone(cone, CONE_LEN, CONE_HALF, color);
      cone.blendMode = 'add';
      this.container.addChild(cone);

      for (const sign of [-1, 1] as const) {
        const g = new Graphics();
        drawRay(g, SIDE_LEN * rng.range(0.85, 1.15), SIDE_HALF, color);
        g.rotation = sign * 0.5; // 전방에서 살짝 벌어진 좌우 광선.
        g.blendMode = 'add';
        this.container.addChild(g);
      }
    } else {
      // 2b) 무방향 원형 섬광 — 균등 각도 방사 스타버스트(고정 개수 → 결정론).
      for (let i = 0; i < RADIAL_SPIKES; i++) {
        const ang = (Math.PI * 2 * i) / RADIAL_SPIKES;
        const g = new Graphics();
        drawRay(g, SPIKE_LEN * rng.range(0.8, 1.2), SPIKE_HALF, color);
        g.rotation = ang;
        g.blendMode = 'add';
        this.container.addChild(g);
      }
    }
  }

  /**
   * 섬광의 급팽창(스케일)·급페이드(알파)를 진행한다. 컨테이너 단위로 균일 적용한다.
   *
   * @param deltaSeconds 프레임 델타(초). 큰 값은 {@link MAX_DT} 로 클램프(탭 복귀 방어).
   * @returns 아직 수명이 남았으면 true, 끝났으면 false. **false 면 호출측이 container 를 effectLayer
   *          에서 제거하고 destroy() 해야 한다**(원샷이라 재발화 없음).
   */
  update(deltaSeconds: number): boolean {
    if (this.destroyed) return false;
    const dt = Math.max(0, Math.min(deltaSeconds, MAX_DT));
    this.age += dt;

    const t = this.age / FLASH_LIFE; // 0→1
    if (t >= 1) {
      // 수명 종료 — 완전 투명 처리 후 소멸 신호.
      this.container.alpha = 0;
      return false;
    }

    // 급팽창: easeOut(t)=1-(1-t)^2 로 초반 빠르게 커지고 끝에서 완만.
    const ease = 1 - (1 - t) * (1 - t);
    const grow = START_SCALE + (END_SCALE - START_SCALE) * ease;
    this.container.scale.set(this.baseScale * grow);

    // 급페이드: fadePow<1 로 초반 급강하(밝게 튀었다가 빠르게 꺼짐).
    this.container.alpha = Math.max(0, 1 - Math.pow(t, FADE_POW));

    return true;
  }

  /** 즉시 정리 — container 서브트리를 통째 파괴(모든 섬광 Graphics 포함)하고 부모에서 분리한다. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.container.destroy({ children: true });
  }
}
