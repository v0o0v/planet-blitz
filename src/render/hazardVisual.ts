/**
 * 해저드 장판의 시각 규칙 — 색 = 성질, 형태 = 상태 (사용자 피드백 2026-07-26).
 *
 * ## 왜 다시 만드는가
 * 이전 규칙은 **색 = subtype** 하나뿐이었다. 세 가지가 동시에 깨져 있었다:
 *
 * 1. **피해 지형이 아군 색으로 칠해졌다.** `HAZARD_SLOW`(2)와 `HAZARD_TERRAIN`(2)이 **같은 값**
 *    이라(`chunks.ts` / `patterns/types.ts`) 렌더가 둘을 구분할 수 없었고, 코드 2 를 무조건
 *    감속=시안(`0x39d0ff`)으로 칠했다. 그런데 그 시안은 이 게임의 **아군 색**이다 — 플레이어
 *    기체·아군 탄·안전 반경 링이 전부 같은 값을 쓴다. 접촉 시 10 피해를 주는 지형이 아군과 같은
 *    색으로 보였다. 구분은 `permanent`(영구 지형 = 청크 배치, 일시 장판 = 보스 감속 지대)로 한다.
 * 2. **"지금 아픈가"가 색에 없었다.** 예열(테두리만)↔활성(채움) 대비만으로는 약했다.
 * 3. **색 하나에 전부 실려** 색약 사용자에게는 정보가 통째로 사라졌다.
 *
 * ## 새 규칙
 * - **아프다** = 난색 + 빗금 + 굵은 실선 + 안쪽 밝은 립
 * - **안 아프다(감속=방해)** = 보라 + 빗금 없음 + 얇은 선 — 위험군에서 분리한다
 * - **하늘색은 아군 전용으로 회수** — 위험 장판은 어떤 subtype 도 시안을 쓰지 않는다
 * - **예열** = 점선 + 채움 없음 + 안으로 수렴하는 예고 링, **활성** = 실선 + 채움
 *
 * 빗금·점선·수렴 링은 전부 **색 외 채널**이라 색약에게도 그대로 남는다.
 *
 * ── 결정론(ADR-0005) ── render-only 순수 데이터. sim·hashWorld 에 닿지 않는다.
 */

import { HAZARD_LAVA, HAZARD_MORTAR, HAZARD_SLOW } from '../sim/patterns/types.js';
import { HAZARD_CONTAMINATION } from '../sim/modes/contamination.js';

/** 장판 1개의 표시 서술(순수 데이터 — 그리기는 {@link drawHazardZone} 이 한다). */
export interface HazardVisual {
  /** 종류색(위험군은 난색, 방해군은 보라). */
  readonly color: number;
  /** 강조색(안쪽 립·예고 링) — 종류색 위에 얹혀 경계를 또렷하게 한다. */
  readonly accent: number;
  /** 피해를 주는 장판인가. 빗금·굵은 테두리·립이 이 값에 달려 있다. */
  readonly harmful: boolean;
  /** 채움 알파(0 = 예열 = 테두리만). */
  readonly fillAlpha: number;
  readonly strokeAlpha: number;
  readonly strokeWidth: number;
  /** 흐르는 빗금을 칠하는가(활성 위험 전용). */
  readonly hatch: boolean;
  /** 점선 테두리인가(예열 전용). */
  readonly dashed: boolean;
}

/** 위험(피해) 장판 색 — 전부 난색 계열. 아군 시안과 절대 겹치지 않는다. */
export const HAZARD_COLOR_MORTAR = 0xff3f5a;
export const HAZARD_COLOR_LAVA = 0xff8412;
/** 청크 배치 영구 피해 지형(구 시안). 용암보다 붉고 박격보다 탁해 셋이 서로 구분된다. */
export const HAZARD_COLOR_TERRAIN = 0xe0563c;
/** 오염 지형(독성 녹색) — 난색은 아니지만 아군 시안과 충분히 멀고 "독"이 읽힌다. */
export const HAZARD_COLOR_CONTAMINATION = 0x9ad12a;
/** 감속 지대: **피해가 없다**. 위험군에서 빼 보라(방해) 색으로 분리한다. */
export const HAZARD_COLOR_SLOW = 0x8a6aff;

/** 위험 장판 강조색(따뜻한 흰빛). */
const ACCENT_WARM = 0xfff0e6;
/** 방해 장판 강조색(차가운 흰빛). */
const ACCENT_COOL = 0xe6e0ff;

/**
 * subtype·활성·영구 여부 → 표시 서술.
 *
 * @param permanent 영구 지형(`life < 0`)인가. **`HAZARD_SLOW` 와 `HAZARD_TERRAIN` 이 같은 코드(2)
 *   라서 필요한 인자다** — 영구면 청크 배치 피해 지형, 일시면 보스 감속 지대다. 스냅샷이
 *   실어 오지 않는 옛 호출(기본 false)은 감속으로 본다(기존 거동).
 */
export function hazardVisual(subtype: number, active: boolean, permanent = false): HazardVisual {
  const slowLike = subtype === HAZARD_SLOW && !permanent;
  const color = slowLike
    ? HAZARD_COLOR_SLOW
    : subtype === HAZARD_LAVA
      ? HAZARD_COLOR_LAVA
      : subtype === HAZARD_SLOW // permanent → 청크 피해 지형
        ? HAZARD_COLOR_TERRAIN
        : subtype === HAZARD_CONTAMINATION
          ? HAZARD_COLOR_CONTAMINATION
          : subtype === HAZARD_MORTAR
            ? HAZARD_COLOR_MORTAR
            : HAZARD_COLOR_MORTAR; // 미지의 subtype = 박격 색 폴백(안 보이는 것보다 낫다)
  const harmful = !slowLike;
  if (!active) {
    // 예열: 채움 없이 점선만. 아직 아프지 않다는 것이 형태로 읽힌다.
    return {
      color,
      accent: harmful ? ACCENT_WARM : ACCENT_COOL,
      harmful,
      fillAlpha: 0,
      strokeAlpha: 0.95,
      strokeWidth: 3,
      hatch: false,
      dashed: true,
    };
  }
  return {
    color,
    accent: harmful ? ACCENT_WARM : ACCENT_COOL,
    harmful,
    // 위험은 더 진하게 깔고 빗금까지 얹는다. 방해(감속)는 옅게 — 밟아도 되는 곳이다.
    fillAlpha: harmful ? 0.3 : 0.22,
    strokeAlpha: 0.95,
    strokeWidth: harmful ? 4 : 2,
    hatch: harmful,
    dashed: false,
  };
}

/**
 * 장식(빗금·립·글로우)을 붙이는 최소 반경(월드 유닛). 오염 셀처럼 작고 많은 장판까지 빗금을
 * 치면 한 프레임 선 개수가 폭발한다 — 작은 장판은 채움+테두리만으로도 충분히 읽힌다.
 */
export const DECOR_MIN_RADIUS = 40;

/**
 * 한 프레임에 장식(빗금·립·글로우·수렴 링)을 붙일 장판 수 상한. 오염 모드는 반경 100 짜리
 * 셀이 화면에 여럿 깔리므로 반경 하한만으로는 선 개수가 묶이지 않는다 — 예산을 넘긴 장판은
 * 채움+테두리만 그린다(장판이 안 보이는 일은 없다). placeholder, defer-balance-tuning.
 */
export const MAX_DECORATED_HAZARDS = 12;

/**
 * 채움을 몇 겹의 동심원으로 나눌 것인가. **1 이 아닌 이유가 이 상수의 전부다.**
 *
 * 오염 지형은 반경 100 짜리 셀이 화면에 여럿 깔리고 **서로 겹친다**. 채움이 한 겹의 하드 엣지
 * 원이면 겹친 자리에서 알파가 그대로 누적돼 경계선이 이중으로 그어지고, 화면이 "포토샵 선택
 * 영역을 붙여 놓은 것"으로 읽힌다(2026-07-30 기준선 캡처의 톡사르 컷이 이 증거다).
 *
 * 겹을 나누면 **가장자리 밴드의 알파가 내부의 1/N 로 떨어진다.** 두 셀의 가장자리가 겹쳐도
 * 합이 한 셀의 내부 알파를 넘지 못하므로 이음매가 생기지 않는다 — 겹침 문제가 합성 규칙이
 * 아니라 **기하**로 풀린다(필터·마스크 0개).
 */
export const FILL_RINGS = 3;
/**
 * 부드러운 가장자리 밴드의 폭(반경 대비). 이 구간 **안쪽**은 완전한 두께이고, 이 구간에서만
 * 겹이 하나씩 빠지며 옅어진다. 넓히면 장판이 실제보다 작아 보이므로 좁게 둔다.
 */
export const FILL_SOFT_SPAN = 0.22;

/** 빗금 간격(px). 반경이 커져도 선 개수가 선형으로만 늘도록 상한과 함께 쓴다. */
const HATCH_SPACING = 18;
/** 장판 하나당 빗금 선 개수 상한(성능 방어선). */
const HATCH_MAX_LINES = 16;
/** 빗금이 흐르는 속도(프레임당 px). 흐름이 "여기 살아 있다"를 만든다. */
const HATCH_FLOW = 0.35;

/** 예열 점선의 세그먼트 수(원주를 몇 조각으로 끊는가). */
const DASH_SEGMENTS = 18;
/** 점선이 도는 속도(프레임당 라디안). */
const DASH_SPIN = 0.012;
/** 수렴 예고 링의 주기(프레임). 반경이 밖→안으로 줄며 "곧 켜진다"를 만든다. */
const CONVERGE_PERIOD = 60;

/**
 * 그리기 대상의 최소 계약(PixiJS `Graphics` 하위 집합). 테스트가 호출 기록만 모으는 스텁을
 * 넘길 수 있도록 좁혀 뒀다 — 렌더 코드가 실제로 무엇을 그렸는지 GL 없이 검증하기 위해서다.
 */
export interface HazardCanvas {
  circle(x: number, y: number, radius: number): HazardCanvas;
  arc(x: number, y: number, radius: number, start: number, end: number): HazardCanvas;
  moveTo(x: number, y: number): HazardCanvas;
  lineTo(x: number, y: number): HazardCanvas;
  fill(style: { color: number; alpha: number }): HazardCanvas;
  stroke(style: { color: number; width: number; alpha: number }): HazardCanvas;
}

/**
 * 장판 하나를 그린다(render-only). `frameTick` 이 애니메이션의 유일한 입력이라 같은 프레임에
 * 항상 같은 그림이 나온다(순수 그리기 — 내부 상태 없음).
 *
 * - **활성 위험**: 소프트 엣지 채움({@link FILL_RINGS} 겹) → 흐르는 빗금 → 굵은 실선 →
 *   안쪽 맥동 립 → 바깥 글로우 링
 * - **활성 방해(감속)**: 옅은 채움 → 도는 소용돌이 호 → 얇은 실선
 * - **예열**: 도는 점선 링 → 안으로 수렴하는 예고 링
 *
 * 반경이 {@link DECOR_MIN_RADIUS} 미만이거나 `allowDecor` 가 false 면 장식을 생략한다 — 채움과
 * 테두리는 그대로라 장판 자체는 항상 보인다. 호출측이 프레임당 장식 예산
 * ({@link MAX_DECORATED_HAZARDS})을 소진하면 false 를 넘긴다(오염 모드는 반경 100 짜리 셀이
 * 여럿 깔릴 수 있어 반경 하한만으로는 부족하다).
 */
export function drawHazardZone(
  g: HazardCanvas,
  x: number,
  y: number,
  radius: number,
  v: HazardVisual,
  frameTick: number,
  allowDecor = true,
): void {
  const decorated = allowDecor && radius >= DECOR_MIN_RADIUS;

  if (v.dashed) {
    // ── 예열 ──────────────────────────────────────────────────────────────
    const spin = frameTick * DASH_SPIN;
    const step = (Math.PI * 2) / DASH_SEGMENTS;
    for (let i = 0; i < DASH_SEGMENTS; i++) {
      const a0 = spin + i * step;
      g.arc(x, y, radius, a0, a0 + step * 0.55).stroke({
        color: v.color,
        width: v.strokeWidth,
        alpha: v.strokeAlpha,
      });
    }
    if (decorated) {
      // 수렴 링: 바깥에서 안으로 줄어들며 반복 — 남은 시간이 아니라 "곧 온다"는 리듬을 준다.
      const t = (frameTick % CONVERGE_PERIOD) / CONVERGE_PERIOD;
      const rr = radius * (1 - 0.45 * t);
      g.circle(x, y, rr).stroke({ color: v.accent, width: 2, alpha: 0.5 * (1 - t) });
    }
    return;
  }

  // ── 활성 ────────────────────────────────────────────────────────────────
  // 소프트 엣지 채움(겹침 방어 — {@link FILL_RINGS} 주석이 근거). 겹 알파는 누적이 정확히
  // `fillAlpha` 에 수렴하도록 역산한다: 1-(1-p)^N = fillAlpha (buildGroundShadow 와 같은 역산).
  // 바깥 밴드는 겹이 하나뿐이라 알파가 p 이고, 두 셀이 겹쳐도 2p < fillAlpha 라 이음매가 없다.
  const perRing = 1 - Math.pow(1 - v.fillAlpha, 1 / FILL_RINGS);
  for (let i = 0; i < FILL_RINGS; i++) {
    const rr = radius * (1 - (FILL_SOFT_SPAN * i) / (FILL_RINGS - 1 || 1));
    g.circle(x, y, rr).fill({ color: v.color, alpha: perRing });
  }

  if (v.hatch && decorated) {
    // 흐르는 빗금(45°). 원 안쪽만 그리도록 각 선의 y 범위를 원의 현(chord)으로 잘라 넣는다
    // (클리핑이 없는 Graphics 라 기하로 직접 자른다).
    const spacing = HATCH_SPACING;
    const flow = (frameTick * HATCH_FLOW) % spacing;
    let lines = 0;
    for (let o = -radius * 2 + flow; o < radius * 2 && lines < HATCH_MAX_LINES; o += spacing) {
      // 45° 선: (x + o + t, y - radius + t). 원과의 교차 구간만 남긴다.
      const seg = chordSpan(o, radius);
      if (seg === null) continue;
      g.moveTo(x + seg.x0, y + seg.y0)
        .lineTo(x + seg.x1, y + seg.y1)
        .stroke({ color: v.color, width: 2, alpha: 0.55 });
      lines++;
    }
  }

  if (!v.harmful && decorated) {
    // 감속: 도는 소용돌이 호 3개 — 위험처럼 보이지 않으면서 "여기 들어가면 느려진다"를 준다.
    const spin = frameTick * 0.02;
    for (let i = 0; i < 3; i++) {
      const a0 = spin + (i * Math.PI * 2) / 3;
      g.arc(x, y, radius * 0.62, a0, a0 + 1.1).stroke({
        color: v.accent,
        width: 2,
        alpha: 0.45,
      });
    }
  }

  g.circle(x, y, radius).stroke({ color: v.color, width: v.strokeWidth, alpha: v.strokeAlpha });

  if (v.harmful && decorated) {
    // 안쪽 립(맥동) — 경계가 정확히 어디인지 한 픽셀 수준으로 읽히게 한다.
    const pulse = 0.5 + 0.5 * Math.sin(frameTick * 0.12);
    g.circle(x, y, radius - v.strokeWidth).stroke({
      color: v.accent,
      width: 1.5,
      alpha: 0.35 + 0.3 * pulse,
    });
    // 바깥 글로우 링(맥동으로 반경이 숨쉰다) — 멀리서도 "저기 위험"이 먼저 눈에 든다.
    g.circle(x, y, radius + 3 + 3 * pulse).stroke({
      color: v.color,
      width: 2,
      alpha: 0.18 + 0.14 * pulse,
    });
  }
}

/**
 * 45° 빗금 선이 반경 `r` 원과 만나는 구간(원 중심 기준 로컬 좌표). 만나지 않으면 null.
 *
 * 선은 `(o + t, -r + t)` (기울기 1)로 매개화된다. 이 선과 원 `x² + y² = r²` 의 교점을 2차식으로
 * 푼다 — 판별식이 음수면 원 밖이다. 순수 기하(부수효과 0).
 */
function chordSpan(
  o: number,
  r: number,
): { x0: number; y0: number; x1: number; y1: number } | null {
  // (o + t)² + (-r + t)² = r²  →  2t² + 2(o - r)t + o² = 0
  const b = o - r;
  const disc = b * b - 2 * o * o;
  if (disc <= 0) return null;
  const root = Math.sqrt(disc);
  const t0 = (-b - root) / 2;
  const t1 = (-b + root) / 2;
  return { x0: o + t0, y0: -r + t0, x1: o + t1, y1: -r + t1 };
}
