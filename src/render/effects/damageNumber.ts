/**
 * 데미지 숫자 팝업 (Phase 4 — plan §AC-4.1 · ADR-0031 combat 레지스터).
 *
 * 적이 피해를 받은 순간 그 위치에 **HP 델타(정수)** 를 띄워, 위로 상승하며 페이드아웃하는 원샷
 * 피드백이다. 타격이 "먹혔다"는 정량 정보를 플레이어에게 즉시 준다. 치명타(`crit`)는 색·크기로
 * 강조한다.
 *
 * ── 왜 절차적 Graphics 인가(Pixi `Text` 금지) ────────────────────────────────
 *  이 프로젝트의 vitest 는 `environment: 'node'`(GL 없음)다. Pixi `Text` 는 폰트 메트릭 측정을
 *  위해 canvas 2D 측정 컨텍스트를 요구해서 node-env 에서 실패할 위험이 있고, 무엇보다 배선 스모크
 *  ([tests] 헤드리스)에서 글리프가 실제로 붙었는지 확인할 수 없다. 그래서 숫자를 **7-세그먼트
 *  절차적 Graphics**(각 자릿수 = 사각형 세그먼트 on/off)로 그린다. `new Graphics()` + `rect().fill()`
 *  기록은 GL 없이 성립하므로 생성자에서 글리프를 **동기 생성**해 `container.children.length > 0` 이
 *  보장된다(ShardBurst 와 동일한 배선 안전 근거, [src/render/effects/explosion.ts:34]).
 *
 * ── ShardBurst 계약 미러([src/render/effects/explosion.ts]) ───────────────────
 *  - `readonly container: Container` — 생성자에서 글리프를 동기로 붙인다(children>0 보장).
 *  - `update(dt): boolean` — 살아있으면 true, 원샷 수명이 끝나면 false(호출측이 effectLayer 에서
 *    제거 + destroy). dt 는 내부에서 {@link MAX_DT} 로 클램프(탭 복귀 방어).
 *  - `destroy(): void` — `container.destroy({ children: true })`, `destroyed` 플래그로 이중 destroy 안전.
 *
 * ── 계약(넘을 수 없음) ────────────────────────────────────────────────────────
 *  - **render-only**: `src/sim/` 무접촉. 결정론(hashWorld/hashEntity)과 무관하다.
 *  - **결정론 + node 안전**: `Date`/`Math.random` 을 안 쓴다. 데미지 숫자는 입력(x,y,amount)만으로
 *    완전히 결정되므로 애초에 무작위가 필요 없다 → 같은 입력이면 같은 글리프 수·같은 배치.
 *  - **가독 우선(가산 blend 함정 회피)**: 데미지 숫자는 "읽어야 하는" 텍스트라 기본은 **불투명 흰/
 *    노랑 글리프**(normal blend)다. ShardBurst 파편처럼 `blendMode='add'` 를 쓰면 밝은 배경 위에서
 *    글자가 배경에 녹아 오히려 안 읽힌다. (참고: tint 곱연산으로 "밝히기"는 흰색이 항등원이라 안 먹는
 *    함정이 있는데 — [graphics-effects-project 메모] — 여기서는 tint 를 아예 안 쓰고 fill 색을 직접
 *    지정하므로 그 함정과 무관하다.)
 *
 * ── 밸런스 유예(defer-balance-tuning) ── 글리프 크기·상승 속도·수명·색·치명타 배율은 전부
 *    placeholder 다. 실제 값은 구현 완료 후 출시 직전 일괄 조정한다(2026-07-22 지시).
 */

import { Container, Graphics } from 'pixi.js';

// ---------------------------------------------------------------------------
// 튜닝 상수 (placeholder · defer-balance-tuning)
// ---------------------------------------------------------------------------

/** 한 자릿수 글리프 폭(px, container.scale 적용 전). */
const DIGIT_WIDTH = 9;
/** 한 자릿수 글리프 높이(px). 통상 폭의 ~1.5배(7-세그 비율). */
const DIGIT_HEIGHT = 14;
/** 세그먼트(획) 두께(px). */
const SEG_THICKNESS = 2.2;
/** 자릿수 사이 간격(px). */
const DIGIT_GAP = 3;

/** 상승 속도(px/초). 위로 뜨므로 실제 vy 는 음수(-RISE_SPEED). */
const RISE_SPEED = 46;
/** 총 수명(초). 이 시간이 지나면 update 가 false 를 돌려준다(원샷 종료). */
const LIFE = 0.8;
/** 수명 중 완전 불투명을 유지하는 비율(0~1). 이후 구간에서 선형으로 0까지 페이드. */
const HOLD_FRAC = 0.35;

/** 프레임 델타 상한(초) — 큰 dt 가 들어와도 순간이동/과도 페이드하지 않게 클램프. */
const MAX_DT = 0.05;

/** 일반 데미지 색(흰색). */
const COLOR_NORMAL = 0xffffff;
/** 치명타 색(노랑/금색) — 강조. */
const COLOR_CRIT = 0xffe24a;

/** 치명타 기본 스케일 배율(일반=1). 치명타는 더 크게 떠서 눈에 띈다. */
const CRIT_SCALE = 1.6;
/** 등장 "팝" 배율 — 초기 POP_TIME 동안 base*POP_MULT 에서 base 로 줄어들며 튀어나오는 느낌. */
const POP_MULT = 1.25;
/** 팝 이징 지속(초). */
const POP_TIME = 0.12;

// ---------------------------------------------------------------------------
// 7-세그먼트 글리프 테이블 — 각 숫자(0~9)를 7개 획(a~g)의 on/off 로 표현.
//
//    aaa
//   f   b
//   f   b
//    ggg
//   e   c
//   e   c
//    ddd
//
// 인덱스 = 획 [a, b, c, d, e, f, g], 값 1=켜짐. 절차적 Graphics 사각형으로 그린다.
// ---------------------------------------------------------------------------

/** 숫자별 세그먼트 on/off 테이블. 인덱스 = 숫자, 값 = [a,b,c,d,e,f,g]. */
const SEVEN_SEG: readonly (readonly number[])[] = [
  [1, 1, 1, 1, 1, 1, 0], // 0
  [0, 1, 1, 0, 0, 0, 0], // 1
  [1, 1, 0, 1, 1, 0, 1], // 2
  [1, 1, 1, 1, 0, 0, 1], // 3
  [0, 1, 1, 0, 0, 1, 1], // 4
  [1, 0, 1, 1, 0, 1, 1], // 5
  [1, 0, 1, 1, 1, 1, 1], // 6
  [1, 1, 1, 0, 0, 0, 0], // 7
  [1, 1, 1, 1, 1, 1, 1], // 8
  [1, 1, 1, 1, 0, 1, 1], // 9
];

/**
 * 숫자 하나(0~9)를 7-세그먼트 사각형으로 Graphics 에 그린다. 글리프 로컬 원점은 좌상단(0,0),
 * 크기는 {@link DIGIT_WIDTH}×{@link DIGIT_HEIGHT}.
 *
 * @param g     그릴 대상 Graphics(글리프 하나 전용).
 * @param digit 0~9. 범위를 벗어나면 '8'(모든 획 on)로 방어.
 * @param color fill 색(불투명).
 */
function drawDigit(g: Graphics, digit: number, color: number): void {
  const w = DIGIT_WIDTH;
  const h = DIGIT_HEIGHT;
  const t = SEG_THICKNESS;
  const mid = h / 2;
  // 범위 밖 방어: 유효하지 않으면 '8'(전 획 on)로. noUncheckedIndexedAccess 하에서 undefined 방어.
  const on = SEVEN_SEG[digit] ?? SEVEN_SEG[8] ?? [];

  // 각 세그먼트 사각형 [x, y, width, height] (좌상단 원점).
  const segs: readonly (readonly [number, number, number, number])[] = [
    [t, 0, w - 2 * t, t], // a 상단
    [w - t, t, t, mid - t], // b 우상
    [w - t, mid, t, mid - t], // c 우하
    [t, h - t, w - 2 * t, t], // d 하단
    [0, mid, t, mid - t], // e 좌하
    [0, t, t, mid - t], // f 좌상
    [t, mid - t / 2, w - 2 * t, t], // g 중단
  ];

  for (let i = 0; i < segs.length; i++) {
    if (!on[i]) continue;
    const seg = segs[i];
    if (seg === undefined) continue;
    g.rect(seg[0], seg[1], seg[2], seg[3]).fill({ color, alpha: 1 });
  }
}

// ---------------------------------------------------------------------------
// DamageNumber — entityRenderer 가 소비할 원샷 데미지 숫자 팝업.
//
// 생성자에서 각 자릿수를 개별 Graphics 글리프로 동기 생성해 container 에 붙인다
// (container.children.length === 자릿수). update(dt) 는 통째로 위로 상승 + 페이드시키고,
// 수명이 끝나면 false 를 돌려준다 → 호출측이 effectLayer 에서 제거하고 destroy().
// ---------------------------------------------------------------------------

/** {@link DamageNumber} 생성 옵션. */
export interface DamageNumberOptions {
  /** 치명타면 색·크기를 키워 강조한다. 미지정 시 false(일반). */
  crit?: boolean;
  /** fill 색 오버라이드(예: 원소별 색). 미지정 시 crit 여부에 따라 흰/노랑. */
  color?: number;
}

export class DamageNumber {
  /**
   * 글리프를 담은 컨테이너. 호출측이 effectLayer 에 addChild 하고, update 가 false 를 돌려주면
   * 제거 + destroy. children.length === 자릿수(글리프 수).
   */
  readonly container: Container = new Container();

  /** 고정 X(상승 중 불변). */
  private readonly x: number;
  /** 현재 Y(매 프레임 상승으로 감소). */
  private posY: number;
  /** 수직 속도(px/초). 위로 뜨므로 음수. */
  private readonly vy: number;
  /** 누적 수명(초). */
  private age = 0;
  /** 총 수명(초). */
  private readonly life: number;
  /** 기본 스케일(일반=1, 치명타=CRIT_SCALE). 팝 이징이 이 위에 곱해진다. */
  private readonly baseScale: number;
  /** 이중 destroy 방어. */
  private destroyed = false;

  /**
   * @param x      팝업 지점 월드 X(effectLayer 로컬). 숫자는 이 X 를 중심으로 좌우 대칭 배치된다.
   * @param y      팝업 지점 월드 Y. 여기서부터 위로 상승한다.
   * @param amount 표시할 피해량. **정수로 반올림**해 그린다. 호출측이 델타>0 만 넘기는 것을 전제하되,
   *               0 이하(반올림 결과 0 포함)면 최소 방어로 '0' 한 글자를 그린다(children>0 유지).
   * @param opts   치명타·색 오버라이드(선택).
   */
  constructor(x: number, y: number, amount: number, opts?: DamageNumberOptions) {
    this.x = x;
    this.posY = y;
    this.vy = -RISE_SPEED; // 위로 상승 = y 감소.
    this.life = LIFE;

    const crit = opts?.crit ?? false;
    const color = opts?.color ?? (crit ? COLOR_CRIT : COLOR_NORMAL);
    this.baseScale = crit ? CRIT_SCALE : 1;

    // 정수 반올림 + 0 이하 최소 방어. value===0 이면 "0" 한 글자라 children===1 로 유지된다.
    const value = Math.max(0, Math.round(amount));
    const str = String(value);
    const n = str.length;

    // 좌우 중앙 정렬: 전체 폭을 기준으로 시작 X 를 왼쪽으로 당긴다. 세로도 글리프 높이의 절반만큼 올려
    // (x,y) 가 숫자의 중심에 오게 한다.
    const stride = DIGIT_WIDTH + DIGIT_GAP;
    const totalW = n * DIGIT_WIDTH + (n - 1) * DIGIT_GAP;
    const startX = -totalW / 2;
    const glyphY = -DIGIT_HEIGHT / 2;

    for (let i = 0; i < n; i++) {
      const digit = str.charCodeAt(i) - 48; // '0'..'9' → 0..9
      const g = new Graphics();
      drawDigit(g, digit, color);
      g.position.set(startX + i * stride, glyphY);
      this.container.addChild(g);
    }

    // 초기 표시 상태 — (x,y) 에 놓고, 팝 최대 배율로 시작(update 가 base 로 줄여간다).
    this.container.position.set(this.x, this.posY);
    this.container.scale.set(this.baseScale * POP_MULT);
    this.container.alpha = 1;
  }

  /**
   * 상승 + 페이드 + 팝 이징을 진행한다.
   *
   * @param deltaSeconds 프레임 델타(초). 큰 값은 {@link MAX_DT} 로 클램프(탭 복귀 방어).
   * @returns 아직 수명 내면 true, 수명이 다하면 false. **false 면 호출측이 container 를 effectLayer
   *          에서 제거하고 destroy() 해야 한다**(원샷이라 재발화 없음).
   */
  update(deltaSeconds: number): boolean {
    if (this.destroyed) return false;
    const dt = Math.max(0, Math.min(deltaSeconds, MAX_DT));
    this.age += dt;
    if (this.age >= this.life) return false;

    // 상승.
    this.posY += this.vy * dt;
    this.container.position.set(this.x, this.posY);

    // 페이드: HOLD_FRAC 까지 불투명 유지, 이후 선형으로 0.
    const t = this.age / this.life; // 0→1
    this.container.alpha =
      t < HOLD_FRAC ? 1 : Math.max(0, 1 - (t - HOLD_FRAC) / (1 - HOLD_FRAC));

    // 팝 이징: 초기 POP_TIME 동안 base*POP_MULT → base 로 수렴(튀어나오는 강조).
    if (this.age < POP_TIME) {
      const k = this.age / POP_TIME; // 0→1
      const mult = POP_MULT + (1 - POP_MULT) * k; // POP_MULT → 1
      this.container.scale.set(this.baseScale * mult);
    } else {
      this.container.scale.set(this.baseScale);
    }

    return true;
  }

  /** 즉시 정리 — container 서브트리를 통째 파괴(모든 글리프 Graphics 포함)하고 부모에서 분리한다. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.container.destroy({ children: true });
  }
}
