/**
 * 젬/전리품 수집 팝 + 레벨업 링 (Phase 4 — plan §AC-4.6 · ADR-0031 combat 레지스터).
 *
 * Phase 2 `ShardBurst`([src/render/effects/explosion.ts])가 **사망** 순간의 원샷 파티클 폭발이라면,
 * 이 모듈은 **수집·성장** 순간의 짧은 가산 축하 FX 두 종을 프로덕션 정규 경로용으로 만든 것이다.
 *  - {@link PickupPop} : 젬/전리품을 주운 순간 그 자리에서 톡 터지는 **작은** 가산 팝(코어 + 링 + 스파크).
 *  - {@link LevelUpRing} : 레벨업 순간 플레이어 주위로 퍼지는 **큰** 가산 충격 링.
 *
 * ── 왜 별 모듈인가 ───────────────────────────────────────────────────────────
 *  폭발(effects/explosion.ts)은 "무작위 방사 + 급감속 파편"이라 시드 LCG·드래그·티어가 필요했다.
 *  수집/레벨업 팝은 **대칭·결정적 확장**(중심에서 균일하게 부풀며 페이드)이라 무작위가 필요 없다.
 *  그래서 여기선 LCG 를 아예 두지 않고, 고정 각도 스파크·중심 링만으로 결정론을 자명하게 만든다
 *  (같은 인자면 같은 children 수·같은 프레임별 배치가 나온다 — RNG 부재라 증명이 단순).
 *
 * ── 계약(넘을 수 없음) ────────────────────────────────────────────────────────
 *  - **render-only**: `src/sim/` 무접촉. 결정론(hashWorld/hashEntity)과 무관하다(순수 표시 FX).
 *  - **가산 발광**: 모든 Graphics 는 `blendMode='add'`. 색은 fill/stroke 에 **직접** 넣고 tint 는 안 쓴다.
 *    (Pixi tint 는 곱연산이라 흰색이 항등원 — 밝힘 효과가 tint 로는 안 난다는 Phase 2 MED-1 교훈.
 *     가산 blend 는 겹칠수록 밝아져 "발광 팝" 룩을 텍스처 없이 낸다.)
 *  - **재현 가능**: `Date`/`Math.random` 미사용. 무작위 자체가 없다(대칭 확장이라 불필요).
 *  - **GL 없는 node 에서도 성립**: 파티클을 `generateTexture`(GL 필요) 없이 **절차적 `Graphics`**
 *    (동심원 소프트닷·스트로크 링·작은 스파크)로 만든다. `new Graphics()` + 도형 기록 + 컨테이너
 *    추가는 GL 없이 성립 → 생성자에서 원소를 **동기 생성**해 `container.children.length > 0` 이 보장된다.
 *  - **Pixi `Text` 금지**: 레벨업 "LEVEL UP" 문자 같은 건 절차적 링으로만 표현(폰트 래스터=GL 의존).
 *  - **원점(0,0) 중심**: 두 클래스 모두 원소를 container 로컬 origin 기준으로 배치한다. 실제 화면
 *    위치는 **호출측**(entityRenderer 등)이 `container.position` 으로 옮긴다 — 이 모듈은 위치를 모른다.
 *
 * ── 밸런스 유예(defer-balance-tuning) ── 크기·수명·확장속도·색은 전부 placeholder 다. 실제 값은
 *    구현 완료 후 출시 직전 graphicsSettings·팔레트와 함께 일괄 조정한다(2026-07-22 지시).
 */

import { Container, Graphics } from 'pixi.js';

// ---------------------------------------------------------------------------
// 공통 상수·헬퍼 (두 클래스 공유)
// ---------------------------------------------------------------------------

/** 프레임 델타 상한(초) — 탭 복귀 등 큰 dt 가 들어와도 확장이 순간이동하지 않게 클램프. */
const MAX_DT = 0.05;

/** 코어 흰색(소프트닷 중심·스파크 심). 가산 blend 에서 겹치면 화이트 하이라이트. */
const CORE = 0xffffff;

/**
 * 부드러운 가산 점. 동심원 4겹을 낮은 알파로 쌓아 텍스처 없이 방사형 낙하를 흉내낸다 —
 * 가산 blend 로 겹치면 밝은 코어 + 부드러운 가장자리가 된다(explosion.ts drawSoftDot 와 같은 idiom).
 */
function drawSoftDot(g: Graphics, radius: number, color: number): void {
  const layers = 4;
  for (let i = layers; i >= 1; i--) {
    g.circle(0, 0, (radius * i) / layers).fill({ color, alpha: 0.24 });
  }
}

/**
 * 스트로크 링(충격파). **최종 반경으로 한 번만 그려두고** node.scale 로 0→1 확장한다(explosion.ts 의
 * "geometry 재기록 없이 transform 만 갱신" 규율). scale 이 1 을 넘지 않으므로 스트로크 굵기가
 * 그려둔 `width` 이상으로 뚱뚱해지지 않아, 확장 내내 링이 크리스프하게 유지된다.
 */
function drawRing(g: Graphics, radius: number, width: number, color: number): void {
  g.circle(0, 0, radius).stroke({ color, width, alpha: 0.95 });
}

/** 작은 스파크(유색 외피 + 흰 코어) — 수집 팝의 사방 튐. */
function drawSpark(g: Graphics, radius: number, color: number): void {
  g.circle(0, 0, radius).fill({ color, alpha: 0.9 });
  g.circle(0, 0, radius * 0.5).fill({ color: CORE, alpha: 0.95 });
}

/** 큐빅 ease-out — 초반에 확 퍼지고 끝에서 완만해지는 "톡" 확장감. t∈[0,1] → [0,1]. */
function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

// ---------------------------------------------------------------------------
// 애니메이션 원소 — 두 클래스가 공유하는 최소 서술자.
//
// 각 원소는 자기 Graphics 를 들고, 정규화 진행도 t∈[0,1] 에 대해
//   위치 = lerp((x0,y0)→(x1,y1), easeOutCubic(t))   // 스파크 비행(중심 원소는 x0=x1=0)
//   스케일 = lerp(s0→s1, easeOutCubic(t))            // 확장(그려둔 최종 크기 기준 0→1 이하)
//   알파 = a0 · (1 - t^fadePow)                       // 페이드(<1=초반 급강하, >1=늦게 꺼짐)
// 만 갱신한다. geometry 는 생성 시 한 번만 그린다(재기록 없음).
// ---------------------------------------------------------------------------

interface Anim {
  readonly node: Graphics;
  /** 시작/끝 로컬 위치(px). 중심 원소는 전부 0, 스파크만 (x1,y1) 로 날아간다. */
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** 시작/끝 스케일. 확장 원소는 s0<s1. */
  readonly s0: number;
  readonly s1: number;
  /** 기저 알파(페이드 곡선에 곱해질 최대 불투명도). */
  readonly a0: number;
  /** 페이드 곡선 지수. <1=초반 급강하(플래시감), 1=선형, >1=늦게 꺼짐. */
  readonly fadePow: number;
}

/** 진행도 t 에서 원소의 표시 상태(위치·스케일·알파)를 갱신한다. */
function tickAnim(a: Anim, t: number): void {
  const e = easeOutCubic(t);
  a.node.position.set(a.x0 + (a.x1 - a.x0) * e, a.y0 + (a.y1 - a.y0) * e);
  a.node.scale.set(a.s0 + (a.s1 - a.s0) * e);
  a.node.alpha = a.a0 * Math.max(0, 1 - Math.pow(t, a.fadePow));
}

// ---------------------------------------------------------------------------
// PickupPop — 젬/전리품 수집 순간의 작은 가산 팝.
//
// 흰 코어 소프트닷(부풀며 급강하) + 유색 링(퍼지며 페이드) + 고정 4방향 스파크(사방으로 톡 튐).
// 생성자에서 원소를 동기 방출해 container.children 를 채운다(호출측이 effectLayer 에 addChild).
// update(dt) 는 확장·페이드를 진행하고 살아있는지 boolean 으로 알린다. 전부 끝나면(false) 원소를
// 정리하고, 호출측이 container 를 effectLayer 에서 떼고 destroy() 한다.
// ---------------------------------------------------------------------------

/** {@link PickupPop} 생성 옵션. */
export interface PickupPopOptions {
  /**
   * 유색 링·스파크 색(가산). 미지정 시 {@link PICKUP_DEFAULT_COLOR}(젬 골드). 젬/전리품 등급별로
   * 다른 색을 주입해 룩을 구분할 수 있다(placeholder — 실제 매핑은 밸런스/아트 패스에서).
   */
  color?: number;
  /**
   * 팝 크기 배율(container 통째 확대). 기본 1. 큰 전리품은 더 크게. 원소 수는 바꾸지 않고 크기만
   * 키운다(수집 팝은 폭발과 달리 밀도 스케일이 필요 없다 — 항상 소수의 대칭 원소).
   */
  scale?: number;
}

/** 젬 골드(placeholder) — 수집 팝 기본색. */
export const PICKUP_DEFAULT_COLOR = 0xffe6a2;

// 튜닝 상수(placeholder · defer-balance-tuning)
/** 팝 총 수명(초). 짧게 "톡". */
const PICKUP_LIFE = 0.35;
/** 소프트닷 최종 반경(px). */
const PICKUP_DOT_R = 7;
/** 유색 링 최종 반경(px). */
const PICKUP_RING_R = 15;
/** 링 스트로크 굵기(px). */
const PICKUP_RING_W = 1.6;
/** 스파크 개수(고정·대칭 — 결정론). */
const PICKUP_SPARKS = 4;
/** 스파크 비행 도달거리(px). */
const PICKUP_SPARK_REACH = 16;
/** 스파크 점 반경(px). */
const PICKUP_SPARK_R = 2;

export class PickupPop {
  /** 원소를 담은 컨테이너. 호출측이 effectLayer 에 addChild 하고, update 가 false 를 돌려주면 제거+destroy. */
  readonly container: Container = new Container();

  private readonly anims: Anim[] = [];
  private age = 0;
  private destroyed = false;

  /**
   * @param x    수집 지점 월드 X(effectLayer 로컬). container.position 에 그대로 반영.
   * @param y    수집 지점 월드 Y.
   * @param opts 색·크기 배율(선택).
   */
  constructor(x: number, y: number, opts?: PickupPopOptions) {
    const color = opts?.color ?? PICKUP_DEFAULT_COLOR;
    const scale = opts?.scale ?? 1;

    this.container.position.set(x, y);
    // scale 로 통째 확대 — 원소 크기·간격이 팝 규모에 비례한다. (0 이하 방어: 최소값.)
    this.container.scale.set(scale > 0 ? scale : 0.001);

    this.build(color); // 원샷 — 생성 즉시 원소를 채운다(container.children>0, 배선 스모크 근거).
  }

  /** Graphics 를 container 에 붙이고 애니 목록에 등록. 초기 표시 상태(t=0)를 즉시 반영. */
  private addAnim(a: Anim): void {
    this.container.addChild(a.node);
    this.anims.push(a);
    tickAnim(a, 0); // 첫 페인트가 옳게 나오도록 시작 상태를 즉시 적용.
  }

  /** 코어 소프트닷 + 유색 링 + 고정 4방향 스파크를 origin(0,0) 기준으로 동기 방출. */
  private build(color: number): void {
    // 1) 흰 코어 소프트닷 — 부풀며 급강하 페이드(플래시감).
    const dot = new Graphics();
    drawSoftDot(dot, PICKUP_DOT_R, CORE);
    dot.blendMode = 'add';
    this.addAnim({ node: dot, x0: 0, y0: 0, x1: 0, y1: 0, s0: 0.4, s1: 1.7, a0: 1, fadePow: 0.6 });

    // 2) 유색 링 — 퍼지며 페이드. 최종 반경으로 그려두고 0.3→1.0 확장(스트로크 크리스프 유지).
    const ring = new Graphics();
    drawRing(ring, PICKUP_RING_R, PICKUP_RING_W, color);
    ring.blendMode = 'add';
    this.addAnim({ node: ring, x0: 0, y0: 0, x1: 0, y1: 0, s0: 0.3, s1: 1, a0: 0.95, fadePow: 1.2 });

    // 3) 고정 대칭 스파크 — 45° 오프셋 대각선으로 사방 균등 배치(무작위 없이 결정론).
    for (let i = 0; i < PICKUP_SPARKS; i++) {
      const ang = (Math.PI * 2 * i) / PICKUP_SPARKS + Math.PI / 4;
      const g = new Graphics();
      drawSpark(g, PICKUP_SPARK_R, color);
      g.blendMode = 'add';
      this.addAnim({
        node: g,
        x0: 0,
        y0: 0,
        x1: Math.cos(ang) * PICKUP_SPARK_REACH,
        y1: Math.sin(ang) * PICKUP_SPARK_REACH,
        s0: 1,
        s1: 0.4, // 날아가며 잦아든다.
        a0: 0.9,
        fadePow: 1.1,
      });
    }
  }

  /**
   * 확장·페이드를 진행한다.
   *
   * @param deltaSeconds 프레임 델타(초). 큰 값은 {@link MAX_DT} 로 클램프(탭 복귀 방어).
   * @returns 아직 수명이 남았으면 true, 다했으면 false. **false 면 호출측이 container 를 effectLayer
   *          에서 제거하고 destroy() 해야 한다**(원샷이라 재발화 없음).
   */
  update(deltaSeconds: number): boolean {
    if (this.destroyed) return false;
    const dt = Math.max(0, Math.min(deltaSeconds, MAX_DT));
    this.age += dt;

    if (this.age >= PICKUP_LIFE) {
      // 수명 만료 — 원소를 즉시 정리(container.children→0, 누수 방지). 호출측 destroy 는 별개로 안전.
      for (const a of this.anims) a.node.destroy();
      this.anims.length = 0;
      return false;
    }

    const t = this.age / PICKUP_LIFE; // 0→1
    for (const a of this.anims) tickAnim(a, t);
    return true;
  }

  /** 즉시 정리 — container 서브트리를 통째 파괴(모든 원소 Graphics 포함)하고 부모에서 분리한다. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.anims.length = 0;
    this.container.destroy({ children: true });
  }
}

// ---------------------------------------------------------------------------
// LevelUpRing — 레벨업 순간 플레이어 주위로 퍼지는 큰 가산 충격 링.
//
// 반경 0→최대로 팽창하는 이중 링(외곽 + 안쪽 지연 링)이 페이드한다. 수집 팝보다 크고 느리다
// (~0.6s). 생성자에서 링을 동기 생성해 children>0. update(dt) 로 팽창·페이드, 전부 끝나면 false.
// ---------------------------------------------------------------------------

/** {@link LevelUpRing} 생성 옵션. */
export interface LevelUpRingOptions {
  /** 링 색(가산). 미지정 시 {@link LEVELUP_DEFAULT_COLOR}(레벨업 시안). */
  color?: number;
  /** 최대 팽창 반경(px). 미지정 시 {@link LEVELUP_DEFAULT_RADIUS}. 플레이어 크기에 맞춰 조정. */
  radius?: number;
}

/** 레벨업 시안(placeholder) — 충격 링 기본색. */
export const LEVELUP_DEFAULT_COLOR = 0x9be8ff;
/** 최대 팽창 반경 기본값(px, placeholder). */
export const LEVELUP_DEFAULT_RADIUS = 48;

// 튜닝 상수(placeholder · defer-balance-tuning)
/** 링 총 수명(초). 수집 팝보다 느긋하게. */
const LEVELUP_LIFE = 0.6;
/** 외곽 링 스트로크 굵기(px). */
const LEVELUP_OUTER_W = 3;
/** 안쪽 링 스트로크 굵기(px). */
const LEVELUP_INNER_W = 2;
/** 안쪽 링 반경 비율(외곽 대비) — 깊이감 주는 이중 파문. */
const LEVELUP_INNER_RATIO = 0.72;
/** 팽창 시작 스케일(0 이면 degenerate — 아주 작게 시작). */
const LEVELUP_START_SCALE = 0.05;

export class LevelUpRing {
  /** 링을 담은 컨테이너. 호출측이 effectLayer 에 addChild 하고, update 가 false 를 돌려주면 제거+destroy. */
  readonly container: Container = new Container();

  private readonly anims: Anim[] = [];
  private age = 0;
  private destroyed = false;

  /**
   * @param x    플레이어 월드 X(effectLayer 로컬). container.position 에 그대로 반영.
   * @param y    플레이어 월드 Y.
   * @param opts 색·최대 반경(선택).
   */
  constructor(x: number, y: number, opts?: LevelUpRingOptions) {
    const color = opts?.color ?? LEVELUP_DEFAULT_COLOR;
    const maxR = opts?.radius && opts.radius > 0 ? opts.radius : LEVELUP_DEFAULT_RADIUS;

    this.container.position.set(x, y);
    this.build(color, maxR); // 원샷 — 생성 즉시 링을 채운다(container.children>0).
  }

  /** Graphics 를 container 에 붙이고 애니 목록에 등록. 초기 표시 상태(t=0)를 즉시 반영. */
  private addAnim(a: Anim): void {
    this.container.addChild(a.node);
    this.anims.push(a);
    tickAnim(a, 0);
  }

  /**
   * 외곽 + 안쪽 이중 링을 origin(0,0) 기준으로 동기 생성. 두 링 모두 최종 반경으로 그려두고
   * {@link LEVELUP_START_SCALE}→1 로 팽창한다(스트로크 크리스프 유지, node-safe geometry 재기록 없음).
   */
  private build(color: number, maxR: number): void {
    // 1) 외곽 충격 링 — 가장 크고 굵게, 앞장서 퍼진다.
    const outer = new Graphics();
    drawRing(outer, maxR, LEVELUP_OUTER_W, color);
    outer.blendMode = 'add';
    this.addAnim({
      node: outer,
      x0: 0,
      y0: 0,
      x1: 0,
      y1: 0,
      s0: LEVELUP_START_SCALE,
      s1: 1,
      a0: 0.95,
      fadePow: 1.1,
    });

    // 2) 안쪽 지연 링 — 살짝 작고 얇게, 늦게 꺼져 이중 파문의 깊이감.
    const inner = new Graphics();
    drawRing(inner, maxR * LEVELUP_INNER_RATIO, LEVELUP_INNER_W, CORE);
    inner.blendMode = 'add';
    this.addAnim({
      node: inner,
      x0: 0,
      y0: 0,
      x1: 0,
      y1: 0,
      s0: LEVELUP_START_SCALE,
      s1: 1,
      a0: 0.8,
      fadePow: 1.6,
    });
  }

  /**
   * 반경 팽창·페이드를 진행한다.
   *
   * @param deltaSeconds 프레임 델타(초). 큰 값은 {@link MAX_DT} 로 클램프(탭 복귀 방어).
   * @returns 아직 수명이 남았으면 true, 다했으면 false. **false 면 호출측이 container 를 effectLayer
   *          에서 제거하고 destroy() 해야 한다**(원샷이라 재발화 없음).
   */
  update(deltaSeconds: number): boolean {
    if (this.destroyed) return false;
    const dt = Math.max(0, Math.min(deltaSeconds, MAX_DT));
    this.age += dt;

    if (this.age >= LEVELUP_LIFE) {
      for (const a of this.anims) a.node.destroy();
      this.anims.length = 0;
      return false;
    }

    const t = this.age / LEVELUP_LIFE; // 0→1
    for (const a of this.anims) tickAnim(a, t);
    return true;
  }

  /** 즉시 정리 — container 서브트리를 통째 파괴(모든 링 Graphics 포함)하고 부모에서 분리한다. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.anims.length = 0;
    this.container.destroy({ children: true });
  }
}
