/**
 * 탄 트레일 — 가산 스트릭 짧은 꼬리 (Phase 4 — plan §AC-4.4 · ADR-0031 combat 레지스터).
 *
 * 탄이 지나간 최근 위치를 히스토리로 이어 **탄 뒤에 짧은 가산 잔상(streak)** 을 그린다. 발광체
 * 글로우([src/render/effects/glow.ts])가 "탄은 발광 금지"(가독 계약, 수천 개가 발광하면 판정점
 * 회피의 '틈'이 사라진다)로 못박은 것과 달리, 트레일은 **탄 자체를 밝히지 않고 탄이 이미 지나간
 * 뒤쪽에만** 짧게 남는 꼬리라 가독을 해치지 않는다. 단 조밀 잡몹 직진탄까지 꼬리를 달면 다시
 * 화면이 번지므로 {@link isTrailBullet} 가 대상(플레이어 탄·특수 거동 적탄)만 골라낸다.
 *
 * ── 계약(넘을 수 없음) ────────────────────────────────────────────────────────
 *  - **render-only**: `src/sim/` 무접촉(타입조차 import 하지 않는다). 결정론(hashWorld/hashEntity)과
 *    무관하다. {@link isTrailBullet} 는 sim `EntityKind`/`BK_*` 상수 대신 **plain string·number** 를
 *    받아 완전 디커플한다(soundScape.ts `shouldWarn` 선례 — 거동 코드 -1 을 리터럴 {@link BK_NONE}
 *    로 재선언해 sim import 를 피한다).
 *  - **재현 가능·결정론적**: 트레일은 탄의 실제 위치 히스토리라 무작위가 애초에 필요 없다. `Date`/
 *    `Math.random` 을 안 쓴다 → 같은 (dt, x, y) 시퀀스를 먹이면 항상 같은 스트릭·같은 소멸 프레임이
 *    난다. `Text` 도 안 쓴다(가독 계약: 트레일은 글자 아님).
 *  - **combat 레지스터(가산 스트릭)**: 꼬리는 `blendMode='add'` 가산으로 그려, 겹칠수록 밝아지는
 *    에너지 잔광이 된다. 색은 placeholder(플레이어=웜, 특수 적탄=붉은 톤 등 호출측이 덮을 수 있게
 *    `color` 옵션).
 *  - **GL 없는 node 에서도 성립**: 스트릭을 `generateTexture`(GL 필요) 없이 절차적 `Graphics`
 *    (선분 stroke)로 그린다. 생성자에서 스트릭 Graphics 를 container 에 **동기 추가**해
 *    `container.children.length > 0` 이 보장된다(배선 스모크 근거, headless 안전).
 *  - **레이어 규율(AC-0.8)**: 트레일은 탄 뒤의 잔상이라 effectLayer(월드 좌표계)에 얹는다. container 는
 *    origin(0,0) 에 고정하고, 점은 **월드 절대 좌표**로 저장·드로우한다 — 호출측이 container 를
 *    effectLayer(=월드 좌표)에 addChild 하면 스트릭이 탄 궤적 위에 정확히 놓인다.
 *
 * ── 밸런스 유예(defer-balance-tuning) ── 꼬리 길이(히스토리 상한·수명)·페이드·두께·색은 전부
 * placeholder 다. 실제 값은 구현 완료 후 출시 직전 graphicsSettings 티어 상한과 함께 일괄 조정한다
 * (2026-07-22 지시).
 */

import { Container, Graphics } from 'pixi.js';
import type { QualityTier } from '../qualityTier.js';

// ---------------------------------------------------------------------------
// render-only 디커플 상수 — sim import 없이 거동 코드를 리터럴로 재선언
// (soundScape.ts:58-59 선례. sim `bullets.ts` BK_NONE 과 동일 값이지만 결정론 무관이라 복제.)
// ---------------------------------------------------------------------------

/**
 * sim `BK_NONE`(순수 직진 잡몹탄 거동 코드, [src/sim/bullets.ts:32])과 동일한 값. render-only
 * 디커플을 위해 sim import 대신 리터럴로 재선언한다. 적탄의 `enemyType` 이 이 값이면 거동 없는
 * 순수 직진 잡몹탄 → 트레일 제외(조밀 직진탄이 번지는 것 방지). BK_ACCEL(0)·HOMING(1)·CURVE(2)·
 * SPLIT(3) 등 그 밖의 값은 큰/특수탄이라 트레일 허용.
 */
const BK_NONE = -1;

// ---------------------------------------------------------------------------
// 튜닝 상수 (placeholder · defer-balance-tuning)
// ---------------------------------------------------------------------------

/** 프레임 델타 상한(초) — 탭 복귀 등 큰 dt 에도 잔상이 튀지 않게 클램프(explosion.ts MAX_DT 동형). */
const MAX_DT = 0.05;

/**
 * 히스토리 점 수명(초). 점은 추가된 뒤 이 시간에 걸쳐 알파 1→0 으로 페이드하고 만료되면 회수된다.
 * 짧게 잡아 "탄 뒤 짧은 꼬리"를 만든다(길면 궤적이 화면에 오래 남아 번진다). placeholder.
 */
const TRAIL_LIFE = 0.18;

/** 최신(탄 바로 뒤) 세그먼트의 최대 가산 알파. 꼬리로 갈수록 이 값에 잔여 수명비를 곱해 옅어진다. placeholder. */
const TRAIL_ALPHA = 0.5;

/** 최신 세그먼트의 최대 선 두께(px, container.scale 적용 전). 꼬리로 갈수록 얇아진다. placeholder. */
const TRAIL_WIDTH = 2.4;

/**
 * 히스토리 절대 상한(안전판). 티어 상한이 이보다 커도 여기서 잘라 누수·과밀을 막는다. 어느 프레임에도
 * 점이 이 수를 넘지 않는다.
 */
const HARD_MAX_POINTS = 12;

/**
 * 티어별 히스토리 상한(placeholder). Low 는 꼬리를 짧게(점 적게), Med/High 는 정상 길이. 점이 많을수록
 * 꼬리가 길고 부드럽지만 stroke 세그먼트 비용이 는다. 전부 {@link HARD_MAX_POINTS} 이하.
 */
const TIER_MAX_POINTS: Record<QualityTier, number> = {
  low: 4,
  med: 8,
  high: 10,
};

/**
 * 기본 트레일 색(웜 화이트, combat 발광 톤). 플레이어 탄은 웜, 특수 적탄은 붉은/보라 톤 등으로
 * 구분하고 싶으면 생성자 `color` 옵션으로 덮는다. placeholder.
 */
const DEFAULT_TRAIL_COLOR = 0xfff2c0;

// ---------------------------------------------------------------------------
// isTrailBullet — 트레일 대상 판정(순수·render-only)
// ---------------------------------------------------------------------------

/**
 * 이 탄이 트레일(가산 스트릭 꼬리) 대상인지 판정한다. render-only 디커플을 위해 sim `EntityKind`/
 * `BK_*` 상수 대신 **plain string·number** 를 받는다 — 호출측(entityRenderer)이 `e.kind`(string 에
 * 대입 가능)와 `e.enemyType`(거동 코드 number)을 그대로 넘긴다.
 *
 * 규칙:
 *  - `kind === 'bullet'`(플레이어 탄) → **항상 true**. 플레이어 탄은 수가 적고 가독을 해치지 않아 전부 허용.
 *  - `kind === 'enemyBullet'` → `behavior !== BK_NONE(-1)` 일 때만 true. -1(BK_NONE)= 거동 없는 순수
 *    직진 잡몹탄 = **제외**(조밀 직진탄에 꼬리를 달면 화면이 번져 판정점 회피의 틈이 사라진다).
 *    BK_ACCEL(0)·HOMING(1)·CURVE(2)·SPLIT(3) 등 그 밖의 값은 큰/특수탄이라 트레일 허용.
 *  - 그 외 kind(gem·enemy·loot·player 등) → false. 트레일은 탄 전용이다.
 *
 * @param kind     엔티티 kind 문자열(예: 'bullet', 'enemyBullet', 'gem').
 * @param behavior 적탄 거동 코드(스냅샷 `enemyBullet.enemyType`). 플레이어 탄에서는 무시된다.
 * @returns 트레일 대상이면 true.
 */
export function isTrailBullet(kind: string, behavior: number): boolean {
  if (kind === 'bullet') return true; // 플레이어 탄: 항상.
  if (kind === 'enemyBullet') return behavior !== BK_NONE; // 특수 거동 적탄만(직진 잡몹탄 제외).
  return false; // 탄이 아니면 트레일 없음.
}

// ---------------------------------------------------------------------------
// 히스토리 점 — 월드 절대 좌표 + 나이
// ---------------------------------------------------------------------------

interface TrailPoint {
  /** 월드 절대 X(effectLayer 좌표계). container 는 origin(0,0) 고정이라 그대로 드로우 좌표다. */
  x: number;
  /** 월드 절대 Y. */
  y: number;
  /** 추가된 뒤 누적 나이(초). 0=방금 추가(탄 현재 위치), {@link TRAIL_LIFE} 도달 시 만료·회수. */
  age: number;
}

// ---------------------------------------------------------------------------
// BulletTrail — entityRenderer 가 소비할 탄별 가산 스트릭 트레일
//
// 탄이 살아 있는 동안 호출측이 매 프레임 `update(dt, x, y)` 로 현재 위치를 먹인다 → 위치가
// 히스토리에 쌓이고, 최근→과거로 알파·두께가 줄어드는 스트릭을 재그린다. 탄이 죽으면 좌표 없이
// `update(dt)` 만 계속 부르면 남은 잔상이 페이드하다 전부 사라지면 false 를 돌려준다 → 호출측이
// container 를 effectLayer 에서 떼고 destroy 한다.
// ---------------------------------------------------------------------------

/** {@link BulletTrail} 생성 옵션. */
export interface BulletTrailOptions {
  /** 품질 티어. 미지정 시 'high'(정상 길이). Low 는 꼬리를 짧게(점 수 상한↓). */
  tier?: QualityTier;
  /** 스트릭 색(0xRRGGBB). 미지정 시 {@link DEFAULT_TRAIL_COLOR}(웜 화이트). 탄 종류별로 덮을 수 있다. */
  color?: number;
}

export class BulletTrail {
  /**
   * 스트릭을 담은 컨테이너. **origin(0,0) 고정** — 점은 월드 절대 좌표라 호출측이 이 container 를
   * effectLayer(월드 좌표계)에 addChild 하면 스트릭이 탄 궤적 위에 정확히 놓인다. update 가 false 를
   * 돌려주면 호출측이 effectLayer 에서 제거 후 destroy() 한다.
   */
  readonly container: Container = new Container();

  /** 궤적 전체를 그리는 단일 Graphics(매 프레임 clear 후 세그먼트 재기록). container 자식 1개다. */
  private readonly streak: Graphics = new Graphics();

  /** 최근 위치 히스토리. 오래된(꼬리) → 최신(탄 바로 뒤) 순서. push 는 끝(최신)에, 만료 회수는 앞(꼬리)에서. */
  private readonly points: TrailPoint[] = [];

  private readonly maxPoints: number;
  private readonly color: number;
  private destroyed = false;

  /**
   * @param opts 티어·색(선택). 티어는 꼬리 길이(점 수 상한)를, 색은 스트릭 톤을 정한다.
   */
  constructor(opts?: BulletTrailOptions) {
    const tier: QualityTier = opts?.tier ?? 'high';
    this.maxPoints = Math.min(TIER_MAX_POINTS[tier], HARD_MAX_POINTS);
    this.color = opts?.color ?? DEFAULT_TRAIL_COLOR;

    // 가산 스트릭 — Graphics 자체에 add 블렌드를 걸어(explosion.ts 파티클 선례) 겹칠수록 밝아진다.
    this.streak.blendMode = 'add';
    // 생성 즉시 표시 객체를 붙여 children>0 보장(배선 스모크 근거, node 안전).
    this.container.addChild(this.streak);
  }

  /**
   * 한 프레임 진행. 좌표가 있으면 탄이 살아 있는 것으로 보고 현재 위치를 히스토리에 push, 없으면
   * 탄이 죽은 것으로 보고 잔상만 페이드한다. 매 프레임 히스토리로 가산 스트릭을 재그린다.
   *
   * @param deltaSeconds 프레임 델타(초). 큰 값은 {@link MAX_DT} 로 클램프(탭 복귀 방어).
   * @param x 탄의 현재 월드 X. 생략하면 탄이 죽은 것으로 간주(잔상만 페이드).
   * @param y 탄의 현재 월드 Y. x 와 함께 제공해야 유효(하나만 주면 무시).
   * @returns 아직 보이는(살아 있는) 점이 남았으면 true, 전부 페이드돼 사라졌으면 false. **false 면
   *          호출측이 container 를 effectLayer 에서 제거하고 destroy() 해야 한다.**
   */
  update(deltaSeconds: number, x?: number, y?: number): boolean {
    if (this.destroyed) return false;
    const dt = Math.max(0, Math.min(deltaSeconds, MAX_DT));

    // 1) 기존 점 나이 증가.
    for (const p of this.points) p.age += dt;

    // 2) 탄이 살아 있으면(좌표 제공) 현재 위치를 최신 점으로 push. 상한 초과 시 가장 오래된 꼬리 회수.
    if (x !== undefined && y !== undefined) {
      this.points.push({ x, y, age: 0 });
      if (this.points.length > this.maxPoints) this.points.shift();
    }

    // 3) 완전히 페이드된(수명 만료) 점을 꼬리(앞)부터 제거. 점은 나이순이라 앞에서만 만료된다.
    while (this.points.length > 0 && (this.points[0]?.age ?? 0) >= TRAIL_LIFE) {
      this.points.shift();
    }

    // 4) 히스토리로 스트릭 재그리기(최근→과거로 알파·두께 감소).
    this.redraw();

    // 5) 살아 있는 점이 남았으면 true. 전부 사라지면 false(원샷 소멸 — 호출측이 제거+destroy).
    return this.points.length > 0;
  }

  /**
   * 스트릭을 히스토리로부터 재기록한다. 인접 두 점을 선분으로 잇되, **새 끝점의 잔여 수명비**로 알파·
   * 두께를 정해 탄 바로 뒤(최신)가 가장 밝고 굵고 꼬리로 갈수록 옅고 가늘어진다. 점이 2개 미만이면
   * 그릴 세그먼트가 없어 스트릭은 비워진다(잔상 소멸 직전).
   */
  private redraw(): void {
    const g = this.streak;
    g.clear();

    for (let i = 0; i < this.points.length - 1; i++) {
      const a = this.points[i]; // 더 오래된(꼬리 쪽) 점
      const b = this.points[i + 1]; // 더 새로운(탄 쪽) 점
      if (a === undefined || b === undefined) continue;

      // 새 끝점 b 의 잔여 수명비(1=방금 추가 .. 0=만료 직전)로 세그먼트 세기를 정한다.
      const vis = 1 - b.age / TRAIL_LIFE;
      if (vis <= 0) continue; // 이미 안 보이는 세그먼트는 건너뛴다.

      const alpha = vis * TRAIL_ALPHA;
      const width = TRAIL_WIDTH * (0.25 + 0.75 * vis); // 꼬리로 갈수록 얇아지되 완전히 0 은 아님.
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: this.color, width, alpha });
    }
  }

  /** 현재 히스토리에 살아 있는 점 수(테스트·배선 스모크 관측용). 0 이면 트레일이 소멸한 상태다. */
  get pointCount(): number {
    return this.points.length;
  }

  /** 즉시 정리 — container 서브트리를 통째 파괴(스트릭 Graphics 포함)하고 히스토리를 비운다. 이중 호출 무해. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.points.length = 0;
    this.container.destroy({ children: true });
  }
}
