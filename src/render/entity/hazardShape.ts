/**
 * 해저드 **재질의 순수 기하** — Pixi 없이 전부 계산되는 부분.
 *
 * ## 왜 Pixi 를 안 쓰는 파일이 따로 있는가
 * 이 레인이 지켜야 할 계약 중 **눈으로는 절대 확인 못 하는 것**이 둘 있다:
 *
 * 1. **불규칙 가장자리가 판정 반경을 넘지 않는다.** 넘는 순간 "밟으면 아픈 곳"이 화면에서
 *    거짓말을 시작한다. 1픽셀 넘친 프레임은 스크린샷으로 잡히지 않지만
 *    {@link edgePolygon} 의 모든 꼭짓점을 재는 단위 테스트로는 잡힌다.
 * 2. **재질이 자기 색을 선언하지 않는다.** 색=성질 규칙(난색=피해·보라=방해·시안은 아군 전용)은
 *    사용자 피드백으로 만들어졌고, 재질이 팔레트를 새로 들이면 그 규칙이 조용히 무너진다.
 *    그래서 여기서 나오는 모든 색은 {@link HazardVisual} 의 `color`/`accent` **사이의 보간**뿐이며
 *    ({@link mixColor}), 그 성질을 테스트가 전 조합에 대해 잠근다.
 *
 * 두 계약 다 "그리는 코드"와 섞여 있으면 GL 없이 검증할 수 없다. 그래서 분리한다 —
 * `groundShadow.ts` 가 기하(`groundShadowGeometry`)와 굽기(`buildGroundShadow`)를 가른 것과 같은 규율.
 *
 * ## 애니메이션 위상의 출처
 * 공간 난수는 전부 {@link file://../env/noise.ts} + zone id 시드다(`Math.random` 없음).
 * 반복 위상은 **렌더 프레임 카운터**의 순수 함수이고, 상태를 적분하는 것은
 * {@link stepHeat}/{@link stepCharge} 둘뿐이다(둘 다 dt 를 상한으로 잘라 탭 복귀에서 튀지 않는다).
 * `atmosphere.ts` 가 입자를 "상태 없는 순수 함수"로 만든 이유와 같다.
 *
 * ── 결정론(ADR-0005) ── render-only. `src/sim/` 은 **상수만** 읽고 해시에 기여하지 않는다.
 */

import { HAZARD_LAVA, HAZARD_MORTAR, HAZARD_SLOW } from '../../sim/patterns/types.js';
import { HAZARD_CONTAMINATION } from '../../sim/modes/contamination.js';
import { lightX, lightY, type EnvLightSpec } from '../env/theme.js';
import { valueNoise, hash3 } from '../env/noise.js';
import type { EffectGates, QualityTier } from '../qualityTier.js';

const TAU = Math.PI * 2;

/** [0,1] 로 자른다. */
function sat(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ---------------------------------------------------------------------------
// 재질 종류 — subtype × permanent → 무엇으로 보이는가
// ---------------------------------------------------------------------------

/**
 * 재질 종류. **subtype 과 1:1 이 아니다** — `HAZARD_SLOW`(2)가 감속 지대와 영구 피해 지형
 * 둘 다를 실어 나르기 때문이다(`hazardVisual.ts` 헤더가 정본). 그 둘은 성질이 정반대라
 * (아프다 / 안 아프다) 재질도 갈라야 한다.
 */
export type HazardMaterialKind =
  /** 용암 — 흐르는 용융. */
  | 'molten'
  /** 오염 — 부글거리는 포자. */
  | 'spore'
  /** 감속장 — 굴절/왜곡(피해 없음). */
  | 'refract'
  /** 영구 피해 지형 — 갈라진 그을음. */
  | 'scorch'
  /** 박격 낙하점 — 달궈진 충격 자국. */
  | 'ember';

/** subtype·영구 여부 → 재질 종류. 미지의 subtype 은 null(재질 없음 = 기존 그림 그대로). */
export function hazardMaterialKind(subtype: number, permanent: boolean): HazardMaterialKind | null {
  if (subtype === HAZARD_LAVA) return 'molten';
  if (subtype === HAZARD_CONTAMINATION) return 'spore';
  if (subtype === HAZARD_MORTAR) return 'ember';
  if (subtype === HAZARD_SLOW) return permanent ? 'scorch' : 'refract';
  return null;
}

/** 이 재질이 피해 장판인가(= 난색 계열). `refract` 만 방해군이다. */
export function kindIsHarmful(kind: HazardMaterialKind): boolean {
  return kind !== 'refract';
}

// ---------------------------------------------------------------------------
// 색 — 재질은 자기 팔레트를 갖지 않는다
// ---------------------------------------------------------------------------

/**
 * 두 RGB 를 채널별 선형 보간한다. **재질이 색을 만드는 유일한 경로**이며 입력은 언제나
 * `visual.color` 와 `visual.accent` 다 — 즉 재질이 만드는 모든 색은 그 두 색을 잇는 선분 위에
 * 있고, 색=성질 규칙을 벗어날 방법이 구조적으로 없다.
 */
export function mixColor(a: number, b: number, t: number): number {
  const k = sat(t);
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * k);
  const g = Math.round(ag + (bg - ag) * k);
  const bl = Math.round(ab + (bb - ab) * k);
  return (r << 16) | (g << 8) | bl;
}

/**
 * 재질이 `mixColor` 에 넘길 수 있는 보간 계수의 **상한**. 재질이 만드는 모든 색은
 * `mixColor(color, accent, t)` 이고 `t ∈ [0, MATERIAL_MIX_MAX]` 이다 — 테스트는 목록이 아니라
 * **구간 전체**를 훑어 색 규칙을 잠근다(목록을 잠그면 새 계수를 쓰는 순간 규칙이 조용히 샌다).
 */
export const MATERIAL_MIX_MAX = 0.75;

// ---------------------------------------------------------------------------
// 예열↔활성 연속 전이 — 데이터는 불리언이지만 화면은 연속이어야 한다
// ---------------------------------------------------------------------------

/**
 * dt 상한(초). 탭 복귀·프레임 스킵의 거대 dt 를 그대로 적분하면 여운·고조가 한 프레임에
 * 끝나 전이 연출이 통째로 사라진다(`atmosphere.ts` 가 상태 적분을 아예 버린 이유의 축소판).
 */
export const HAZARD_DT_CAP = 0.05;

/** 활성 진입 시 상승률(1/s). 0.3초 남짓에 만개 — 켜지는 순간은 빨라야 "지금 아프다"가 읽힌다. */
export const HEAT_RISE_PER_SEC = 3.2;
/**
 * 비활성 전환 후 감쇠율(1/s). **상승보다 느리다** — 꺼진 용암이 즉시 사라지면 장판이
 * 깜빡이는 도형으로 읽힌다. 여운 약 1.1초.
 *
 * ⚠️ 여운은 **재질(안쪽 질감)에만** 실린다. 판정을 알리는 채널(테두리·안쪽 립·빗금·점선)은
 * `drawHazardZone` 이 소유하고 활성 플래그와 동시에 끊긴다 — 여운이 "아직 아프다"로 읽힐
 * 여지가 없다.
 */
export const HEAT_FALL_PER_SEC = 0.9;
/** 예열 고조율(1/s). 약 1.3초에 만충 — 점선이 도는 동안 밑에서 압력이 차오른다. */
export const CHARGE_RISE_PER_SEC = 0.75;
/** 활성 진입 시 고조 해소율(1/s). 압력이 터져 나가는 것이므로 빠르다. */
export const CHARGE_FALL_PER_SEC = 4;

/** 목표값으로 선형 접근(상한 dt). 공용 적분자. */
function approach(prev: number, target: number, rate: number, dt: number): number {
  const d = dt > HAZARD_DT_CAP ? HAZARD_DT_CAP : dt < 0 ? 0 : dt;
  if (target > prev) {
    const up = prev + rate * d;
    return up > target ? target : up;
  }
  const down = prev - rate * d;
  return down < target ? target : down;
}

/**
 * 열(활성도) 적분. 활성이면 {@link HEAT_RISE_PER_SEC} 로 1 을 향해, 비활성이면
 * {@link HEAT_FALL_PER_SEC} 로 0 을 향해 간다.
 */
export function stepHeat(prev: number, active: boolean, dt: number): number {
  return approach(sat(prev), active ? 1 : 0, active ? HEAT_RISE_PER_SEC : HEAT_FALL_PER_SEC, dt);
}

/**
 * 고조(예열 압력) 적분. **비활성일 때 차오르고** 활성이 되면 빠르게 빠진다 — `heat` 의 여집합이라
 * 둘을 곱하거나 더해 쓰면 예열↔활성이 한 축의 연속 변화로 읽힌다.
 */
export function stepCharge(prev: number, active: boolean, dt: number): number {
  return approach(sat(prev), active ? 0 : 1, active ? CHARGE_FALL_PER_SEC : CHARGE_RISE_PER_SEC, dt);
}

// ---------------------------------------------------------------------------
// 불규칙 경계 — 판정 반경을 **절대** 넘지 않는다
// ---------------------------------------------------------------------------

/** 경계 폴리곤 꼭짓점 수. 24 면 반경 200 에서 변 길이 약 52px — 곡선으로 읽히는 하한. */
export const EDGE_POINTS = 24;
/**
 * 불규칙 가장자리가 오갈 수 있는 반경 비율의 **하한**.
 *
 * 이 값과 {@link EDGE_MAX_RATIO} 의 **차이가 곧 화면에서 보이는 굴곡의 크기**다. 2차 구현은
 * 이 대역을 별도의 좁은 경계 대역(0.94~0.985)으로 또 한 번 좁혔다가 실측 진폭 2.41px 로
 * 자기 선 두께(4px)에도 못 미쳤다(반려 CRIT-2). 지금은 대역이 하나이고, 그 폭이
 * `0.13 × 반경` = 반경 100 에서 13px 라 선 두께의 3배를 넘는다.
 *
 * 안쪽으로 파이는 만큼 화면은 안전지대를 과장한다 — 그 오차의 정밀 보정은 판정 반경에 정확히
 * 놓이는 **맥동 립**이 맡는다(`hazardVisual.LIP_RATIO`). 립이 울타리고, 이 대역은 물질이다.
 */
export const EDGE_MIN_RATIO = 0.83;
/**
 * **상한. 1 을 넘길 수 없다.** 재질이 판정 반경 밖으로 한 픽셀이라도 나가면 "밟으면 아픈 곳"이
 * 화면에서 거짓말을 한다.
 *
 * 1 이 아니라 0.96 인 이유는 따로 있다: 판정 반경에는 **맥동 립**이 놓이고, 채움 윤곽선이
 * (두께 4px 의 절반만큼 밖으로 번지므로) 거기까지 올라오면 두 선이 붙어 하나로 뭉친다.
 * 0.96 이면 최대치에서도 립과 2px 이상 떨어진다 — 세 선이 같은 5px 안에서 꼬여 **밧줄처럼**
 * 보이던 결함(반려 CRIT-3)의 처방이다.
 */
export const EDGE_MAX_RATIO = 0.96;
/** 경계 노이즈 주파수(원 위 샘플링 좌표의 배율). 낮을수록 큰 굴곡. */
const EDGE_NOISE_FREQ = 2.6;
/** 경계가 출렁이는 속도(프레임당 라디안). 두 옥타브를 반대로 돌려 회전이 아니라 요동이 된다. */
const EDGE_FLOW = 0.006;

/**
 * 각도 `a` 에서의 경계 반경 비율 ∈ [{@link EDGE_MIN_RATIO}, {@link EDGE_MAX_RATIO}].
 *
 * 노이즈를 **원 위에서** 샘플링하므로 a=0 과 a=2π 가 같은 좌표를 찍는다 → 폴리곤이 이음매 없이
 * 닫힌다(선형 각도 좌표로 샘플링하면 시작점에 각진 이음매가 남는다).
 *
 * 두 옥타브를 서로 **반대 방향**으로 흘려 형태가 회전이 아니라 요동으로 읽히게 한다 — 통째로
 * 도는 가장자리는 "돌아가는 도장"처럼 보이고 재질감이 죽는다.
 */
export function edgeRatioAt(seed: number, a: number, frameTick: number, wobble: number): number {
  const p = frameTick * EDGE_FLOW;
  const c0 = Math.cos(a + p);
  const s0 = Math.sin(a + p);
  const c1 = Math.cos(a - p * 1.7);
  const s1 = Math.sin(a - p * 1.7);
  const n =
    0.62 * valueNoise(seed, c0 * EDGE_NOISE_FREQ + 8, s0 * EDGE_NOISE_FREQ + 8) +
    0.38 * valueNoise(seed ^ 0x5bf03635, c1 * EDGE_NOISE_FREQ * 2.1 + 3, s1 * EDGE_NOISE_FREQ * 2.1 + 3);
  // wobble=0 이면 상한에 붙어 정확한 원이 된다(재질이 꺼진 상태와 매끄럽게 이어진다).
  const span = (EDGE_MAX_RATIO - EDGE_MIN_RATIO) * sat(wobble);
  return EDGE_MAX_RATIO - span * stretch(n);
}

/**
 * 노이즈 대비 스트레치. **이 함수가 없으면 선언한 대역이 거짓말이 된다.**
 *
 * `valueNoise` 두 옥타브의 가중 평균은 중심극한 효과로 0.5 근처에 몰린다 — 2차 구현은 대역을
 * `[0.94, 0.985]` 로 **선언**했는데 실측 진폭이 2.41px(@r=100)에 그쳤고, 그건 자기 선 두께
 * (4px)보다 작아 **흔들림이 선 안에 묻혔다**(2차 반려 CRIT-2). 선언한 대역과 실제로 쓰이는
 * 대역이 달랐던 것이다.
 *
 * 0.5 를 중심으로 늘려 구간 양끝까지 실제로 도달하게 한다. 클램프 때문에 분포가 양끝에 살짝
 * 쌓이는데, 가장자리 굴곡에서는 그게 오히려 "덩어리진" 인상을 만들어 유리하다.
 */
function stretch(n: number): number {
  return sat((n - 0.5) * NOISE_CONTRAST + 0.5);
}

/**
 * 대비 계수. 값이 클수록 굴곡이 선언 대역을 꽉 채운다. 2.6 은 실측 진폭이 대역의 약 90% 에
 * 도달하는 값이다(테스트가 "선 두께의 3배 이상"으로 직접 재서 잠근다).
 */
const NOISE_CONTRAST = 2.6;

/**
 * 임의 대역 `[minRatio, maxRatio]` 의 유기 폴리곤(중심 기준 로컬 좌표).
 *
 * 세 선(경계·립·글로우)이 **같은 5px 안에서 서로 넘나들어 꼬인 밧줄로 보이던 결함**(2차 반려
 * CRIT-3)을 푸는 도구다. 각 선이 자기 대역을 명시적으로 갖고, 대역끼리 겹치지 않게 배치한다.
 * 같은 `seed` 를 주면 각도별 위상이 맞아 한 덩어리로 읽힌다.
 */
export function bandPolygon(
  seed: number,
  radius: number,
  frameTick: number,
  minRatio: number,
  maxRatio: number,
  points = EDGE_POINTS,
): number[] {
  const n = points < 3 ? 3 : points;
  const out: number[] = new Array<number>(n * 2);
  const span = maxRatio - minRatio;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    // edgeRatioAt 의 [EDGE_MIN, EDGE_MAX] 출력을 [0,1] 로 되돌린 뒤 원하는 대역에 다시 실는다.
    const t = (EDGE_MAX_RATIO - edgeRatioAt(seed, a, frameTick, 1)) / (EDGE_MAX_RATIO - EDGE_MIN_RATIO);
    const r = radius * (maxRatio - span * t);
    out[i * 2] = Math.cos(a) * r;
    out[i * 2 + 1] = Math.sin(a) * r;
  }
  return out;
}

/**
 * 애니메이션 위상을 몇 프레임 단위로 양자화할 것인가. 경계 요동은 프레임당 0.006 라디안이라
 * 4프레임 계단은 눈에 안 보이면서 노이즈 평가를 4분의 1로 줄인다. 장판이 40개를 넘는 모드
 * (톡사르 41 · 크라스 23)에서 이 상수가 프레임 예산을 지킨다.
 */
export const SHAPE_TICK_QUANTUM = 4;

/** 위상 양자화(순수). */
export function quantizeTick(frameTick: number): number {
  return Math.floor(frameTick / SHAPE_TICK_QUANTUM) * SHAPE_TICK_QUANTUM;
}

/**
 * 불규칙 경계 폴리곤(중심 기준 로컬 좌표, flat `[x0,y0,x1,y1,...]`).
 *
 * @param scale 반경 배율(겹겹이 안쪽으로 깔 때 1 미만을 준다). 결과는 항상
 *   `radius * scale * EDGE_MAX_RATIO` 이하다 — 즉 `scale ≤ 1` 이면 판정 반경을 넘지 못한다.
 */
export function edgePolygon(
  seed: number,
  radius: number,
  frameTick: number,
  wobble: number,
  scale = 1,
  points = EDGE_POINTS,
): number[] {
  const n = points < 3 ? 3 : points;
  const out: number[] = new Array<number>(n * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const r = radius * scale * edgeRatioAt(seed, a, frameTick, wobble);
    out[i * 2] = Math.cos(a) * r;
    out[i * 2 + 1] = Math.sin(a) * r;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 흐름 로브 — 재질의 본체("도형이 아니라 물질"을 만드는 층)
// ---------------------------------------------------------------------------

/** 흐름 로브 하나(중심 기준 로컬 좌표). */
export interface HazardLobe {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  /** 이 로브의 상대 밝기 [0,1] — 로브마다 달라야 "덩어리진 용융"으로 읽힌다. */
  readonly bright: number;
  /** 회전 위상 오프셋(라디안). 로브가 동시에 돌면 무늬가 통째로 도는 것처럼 보인다. */
  readonly phase: number;
}

/**
 * 장판 하나에 놓는 로브 수.
 *
 * ## 왜 5 가 아니라 14 인가 (1차 통합 반려 사유)
 * 처음엔 5개였고 각각이 컸다(여유 반경의 40~92%). 다섯 개가 서로 겹쳐 **하나의 큰 덩어리**가
 * 됐고, 각 로브 안에 밝은 `inner` 코어를 또 얹어서 그 위에 흰 점이 찍혔다. 결과는 "부글거리는
 * 포자"가 아니라 **렌즈 플레어 스티커**였다.
 *
 * 물질감은 큰 덩어리 몇 개가 아니라 **작은 개체 여럿의 통계**에서 나온다. 작고(0.12~0.30r)
 * 많고(14개) 각자 다른 주기로 태어나-부풀고-사라져야 표면이 살아 있는 것으로 읽힌다.
 * 개수가 늘었으므로 개당 알파는 크게 내렸다(가산 누적 밝기 예산 — 계약 §2-4).
 */
export const LOBE_COUNT = 14;

/** 로브 반지름의 하한·상한(판정 반경 대비). 작아야 개체로 읽힌다. */
export const LOBE_MIN_R = 0.12;
export const LOBE_MAX_R = 0.3;
/** 로브 중심이 놓일 수 있는 최대 거리(판정 반경 대비). */
const LOBE_SPREAD = 0.62;

/**
 * 로브 배치(정적 — 부착 시 한 번). **로브는 전부 판정 반경 안에 완전히 들어간다**:
 * `|중심| + r ≤ radius * EDGE_MAX_RATIO` 를 구성적으로 만족시킨다(마지막 클램프가 보증).
 *
 * 중심 거리에 `sqrt` 를 씌워 **면적 균일 분포**로 뿌린다. 안 씌우면 중앙에 몰려 다시 하나의
 * 덩어리가 된다 — 5개 시절의 실패를 개수만 늘려 재현하는 함정이다.
 */
export function lobeAt(seed: number, i: number, radius: number): HazardLobe {
  const ang = hash3(seed, i, 0, 1) * TAU;
  const dist = radius * LOBE_SPREAD * Math.sqrt(hash3(seed, i, 0, 2));
  const want = radius * (LOBE_MIN_R + (LOBE_MAX_R - LOBE_MIN_R) * hash3(seed, i, 0, 3));
  const room = radius * EDGE_MAX_RATIO - dist;
  const r = want < room ? want : room;
  return {
    cx: Math.cos(ang) * dist,
    cy: Math.sin(ang) * dist,
    r: r > 0 ? r : 0.001,
    bright: 0.35 + 0.65 * hash3(seed, i, 0, 4),
    phase: hash3(seed, i, 0, 5) * TAU,
  };
}

/** 로브가 도는 속도(프레임당 라디안). 로브마다 부호·크기가 달라야 흐름으로 읽힌다. */
export function lobeSpin(seed: number, i: number): number {
  return (hash3(seed, i, 0, 6) - 0.5) * 0.018;
}

/** 로브 하나의 이번 프레임 수명 상태. */
export interface HazardLobeLife {
  /** 크기 배율. **단조 증가**한다 — 계속 자라다 알파가 죽어 "터진" 것으로 읽힌다. */
  readonly scale: number;
  /** 알파 배율 [0,1]. 양 끝에서 정확히 0 이라 팝인·팝아웃이 없다. */
  readonly alpha: number;
}

/** 로브 수명 주기의 하한·상한(프레임). 로브마다 달라야 전체가 동시에 숨쉬지 않는다. */
const LOBE_PERIOD_MIN = 80;
const LOBE_PERIOD_SPAN = 90;

/**
 * 로브 하나의 수명(순수 함수 — 상태 없음, `atmosphere.ts` 규율).
 *
 * 태어나서(scale 작고 alpha 0) → 부풀고(둘 다 오름) → 터진다(scale 은 최대인데 alpha 0).
 * 크기를 단조 증가로 둔 것이 핵심이다: 크기가 알파를 따라 되돌아오면 "숨쉬는 원"이 되어
 * 다시 도형으로 읽힌다.
 *
 * @param speed 운동 속도 배율. 예열 중에는 느리게(<1) 굴려 "아직 끓지 않는다"를 만든다.
 */
export function lobeLife(seed: number, i: number, frameTick: number, speed = 1): HazardLobeLife {
  const period = LOBE_PERIOD_MIN + LOBE_PERIOD_SPAN * hash3(seed, i, 2, 0);
  const phase = hash3(seed, i, 2, 1);
  const u = ((((frameTick * speed) / period + phase) % 1) + 1) % 1;
  return { scale: 0.28 + 0.85 * u, alpha: Math.sin(Math.PI * u) };
}

// ---------------------------------------------------------------------------
// 존재감 — 재질은 예열 중에도 화면에 있어야 한다
// ---------------------------------------------------------------------------

/**
 * 열이 0 일 때도 남는 재질의 최소 존재감.
 *
 * ## 왜 0 이면 안 되는가 (1차 통합 반려의 근본 원인)
 * 1차 구현은 재질 여섯 겹 중 다섯을 `heat` 에 곱했다. 그런데 **박격 장판은 예열로 등장해
 * 활성 창이 8틱(≈0.13초)뿐이고 그 직후 엔티티가 소멸한다.** 상승률 3.2/s 로 8프레임이면
 * 피크가 0.43 이고, 예열 내내는 정확히 0 이다 → 화면에 재질이 없었다. 실측 겹별 알파가
 * `로브 5개 전부 0 · edge visible=false · motes visible=false` 였다.
 *
 * **예열은 탄막 게임에서 가장 오래 보이는 상태다.** 거기에 예산을 덜 쓰는 설계가 틀렸다.
 * 그래서 존재는 열과 무관하게 보장하고, 예열↔활성은 **강도·색·운동 속도**로 가른다
 * ({@link materialIntensity}).
 */
export const MATERIAL_PRESENCE_FLOOR = 0.28;

/** 열 → 이번 프레임 존재감 [FLOOR, 1]. */
export function materialPresence(heat: number): number {
  return MATERIAL_PRESENCE_FLOOR + (1 - MATERIAL_PRESENCE_FLOOR) * sat(heat);
}

/** 예열↔활성을 가르는 세 축(존재 여부가 **아니다**). */
export interface HazardIntensity {
  /** 겹 알파 배율 [FLOOR,1]. */
  readonly presence: number;
  /** 색 보간 배율 [0.35,1] — 예열은 종류색에 가깝고(탁하고) 활성은 강조색 쪽으로 밝아진다. */
  readonly warmth: number;
  /** 운동 속도 배율 [0.35,1] — 예열은 느리게 끓고 활성은 빠르게 휘몰아친다. */
  readonly speed: number;
}

/** 열 → 강도 3축. 예열(heat=0)에서도 셋 다 0 이 아니다. */
export function materialIntensity(heat: number): HazardIntensity {
  const h = sat(heat);
  return {
    presence: materialPresence(h),
    warmth: 0.35 + 0.65 * h,
    speed: 0.35 + 0.65 * h,
  };
}

// ---------------------------------------------------------------------------
// 겹 LOD — 예산은 "개체를 빼는" 것이 아니라 "겹을 빼는" 것이다
// ---------------------------------------------------------------------------

/**
 * 재질 상세 단계.
 *
 * ## 왜 개수 상한이 아니라 LOD 인가 (1차 통합 반려 사유)
 * 1차는 `MAX_FIELD_MATERIALS = 10` 개체 상한이었다. 그런데 실제 장판이 톡사르 **41개**,
 * 크라스 **23개**다. 나란히 붙은 동일 오염 셀 넷 중 **하나만** 재질을 갖고 셋은 변경 전
 * 그대로라, 화면에서 같은 해저드가 두 가지 스타일로 그려져 **렌더링 버그로 읽혔다.**
 *
 * 개체를 빼면 "종류가 다른 것"으로 보이고, 겹을 빼면 "멀리 있는 것"으로 보인다. 후자만이
 * 정당한 예산 절감이다. 게다가 유기적 실루엣(불규칙 채움·경계선)은 이제 `drawHazardZone` 이
 * **전 장판에** 그리므로, LOD 가 낮아져도 **정체성은 동일**하다 — 빠지는 것은 디테일뿐이다.
 */
export type HazardLod =
  /** 전 겹. */
  | 'full'
  /** 입자·접지 없음(로브는 절반, 환경·고조는 유지). */
  | 'mid'
  /** 로브 최소 + 환경·고조. **비어 있지 않다** — 아래 주석이 이유다. */
  | 'lite';

/** `full` 을 받는 장판 수. */
export const LOD_FULL_COUNT = 6;
/** `full`+`mid` 누적 수. 이 위는 전부 `lite`. */
export const LOD_MID_COUNT = 18;
/**
 * 재질을 붙일 장판 수의 **안전 밸브**. 상한이 아니라 폭주 방어다 — 실측 최대가 톡사르 41개라
 * 그 위로 넉넉히 잡았다. 넘어가도 `drawHazardZone` 의 유기적 실루엣은 그대로라 스타일이
 * 갈리지 않는다(개체 상한의 원죄였던 문제가 구조적으로 사라졌다).
 */
export const MAX_FIELD_MATERIALS = 64;

/**
 * **동시 생존 수** → LOD. 부착 시점에 한 번 정해지고 그 재질의 수명 내내 바뀌지 않는다.
 *
 * ## 인자가 "세션 누적 순번"이면 안 되는 이유 (2차 반려 CRIT-1 — 이 레인 최악의 결함)
 * 2차 구현은 단조 증가하는 `attachCursor` 를 넘겼다. 되돌리는 곳이 프로덕션에 **한 군데도
 * 없었고**(`resetHazardFieldBudget` 호출은 테스트뿐), 박격 장판이 몇 초마다 생기고 사라지며
 * 순번을 태웠다. 결과: 톡사르 seed1 **첫 런부터** `full 0 · mid 9 · lite 32`, 새 런을 열어도
 * 전부 `lite`. 당시 `lite` 는 로브 0 · 접지 0 · 입자 0 이었으므로 **항목 1·3·6 이 통째로 화면에서
 * 사라졌다.** 1차의 동시 개수 상한보다 나빴다 — 그건 상한이었고 이건 **세션 수명 누적**이라
 * 시간이 지날수록 나빠졌다.
 *
 * 더 나쁜 것은 **테스트가 구조적으로 못 잡았다**는 점이다: 케이스마다 카운터를 0 으로 되돌리는
 * `beforeEach` 가 있어서 "두 번째 런"이 존재하지 않았다. 82건 전부 그린인데 결함은 전량 통과했다.
 * 그래서 지금은 **연속 두 런의 LOD 분포가 같은지**를 재는 테스트가 따로 있다.
 *
 * 동시 생존 수는 재질이 회수되면 자연히 줄어들므로 세션 드리프트가 원리적으로 없다.
 */
export function hazardLod(liveCount: number): HazardLod {
  if (liveCount < LOD_FULL_COUNT) return 'full';
  if (liveCount < LOD_MID_COUNT) return 'mid';
  return 'lite';
}

/** 이 LOD 가 로브를 그리는가. **전부 그린다** — 아래 {@link lodLobeCount} 주석이 이유다. */
export function lodHasLobes(_lod: HazardLod): boolean {
  return true;
}
/** 이 LOD 가 접지(접촉 그늘·림)를 그리는가. */
export function lodHasGrounding(lod: HazardLod): boolean {
  return lod === 'full';
}
/** 이 LOD 가 입자를 그리는가. */
export function lodHasMotes(lod: HazardLod): boolean {
  return lod === 'full';
}
/** `lite` 가 유지하는 최소 로브 수. **0 이 아니다.** */
export const LOD_LITE_LOBES = 4;

/**
 * 이 LOD 의 로브 수. **어떤 LOD 도 0 이 아니다.**
 *
 * 2차 구현은 `lite` 에서 로브를 0 으로 만들었고, CRIT-1 과 겹쳐 실전 화면의 41장 중 32장이
 * 재질 본체 없이 그려졌다. 설령 CRIT-1 이 없었더라도 이건 **MAJOR-1(같은 해저드 두 스타일)**
 * 을 자리만 옮긴 것이다 — 나란히 붙은 같은 오염 셀 중 하나만 물질이고 셋은 도형이면, 관객은
 * 그것을 LOD 로 읽지 않고 **렌더링 버그**로 읽는다.
 *
 * 로브가 스프라이트로 바뀌어(`hazardTexture.ts`) 배치되므로 전 셀에 최소분을 둘 여유가 생겼다:
 * 톡사르 41장 = 6×14 + 12×8 + 23×4 = 272 스프라이트지만 텍스처·블렌드가 같아 드로우콜은
 * 사실상 하나다. 개수가 아니라 **드로우콜**이 비용이었다.
 */
export function lodLobeCount(lod: HazardLod): number {
  return lod === 'full' ? LOBE_COUNT : lod === 'mid' ? 8 : LOD_LITE_LOBES;
}

// ---------------------------------------------------------------------------
// 입자 — 상태 없는 순수 함수 (atmosphere.ts 규율)
// ---------------------------------------------------------------------------

/** 입자 하나의 이번 프레임 상태. */
export interface HazardMote {
  readonly x: number;
  readonly y: number;
  readonly alpha: number;
  readonly r: number;
}

/**
 * 티어·게이트 → 장판 하나의 입자 수.
 *
 * ## 분기 순서가 계약이다 (1차 통합 반려 사유)
 * 1차 구현은 `'min'` 을 `tier === 'low'` **보다 먼저** 봤다. 그런데 low 티어의 기본 게이트가
 * 바로 `particles: 'min'` 이라, `tier === 'low' ? 0` 분기가 **영영 도달하지 않았다** —
 * quality low 에서 입자 3개가 그대로 떴다. 단위 테스트도 같은 착각을 그대로 단언해
 * (`moteBudget('low', LOW) === 3`) 결함을 굳혀 놓고 있었고, 보고서의 "low: 입자 소멸"은
 * 그래서 **거짓 주장**이었다.
 *
 * 티어를 먼저 본다. 저사양에서 입자는 가장 먼저 버릴 것이고, 그 판단이 게이트의 세부 단계에
 * 가려지면 안 된다.
 */
export function moteBudget(tier: QualityTier, gates: EffectGates): number {
  if (gates.particles === 'off') return 0;
  if (tier === 'low') return 0;
  if (gates.particles === 'min') return 3;
  return tier === 'med' ? 5 : 10;
}

/** 입자 한 주기의 프레임 수(기본). 입자마다 위상이 달라 뭉치지 않는다. */
const MOTE_PERIOD = 150;
/**
 * 입자가 떠오르는 높이(반경 대비). **높이감의 주 신호**다 — 장판 위로 솟았다가 사라지는
 * 무언가가 있어야 바닥에 깔린 면과 그 위 공간이 분리돼 보인다(접지 그림자의 대칭 장치).
 */
const MOTE_LIFT = 0.55;

/**
 * 입자 하나의 이번 프레임 상태(순수 함수). 수명은 상태가 아니라 `tick` 을 입자별 위상만큼
 * 밀고 주기로 나눈 나머지다 — 프레임을 건너뛰어도 튀지 않고, 같은 tick 이면 같은 화면이다.
 *
 * `rise` 가 0 이면 바닥에 눌린 입자(그을음·결정), 1 이면 완전히 떠오르는 입자(불티·포자)다.
 */
export function moteAt(
  seed: number,
  i: number,
  radius: number,
  frameTick: number,
  rise: number,
): HazardMote {
  const phase = hash3(seed, i, 1, 0);
  const speed = 0.6 + 0.8 * hash3(seed, i, 1, 1);
  const u = (((frameTick * speed) / MOTE_PERIOD + phase) % 1 + 1) % 1;
  const ang = hash3(seed, i, 1, 2) * TAU;
  // 반경 방향 위치는 √u 분포가 아니라 고정 — 입자가 원 안에서 균일하게 흩어지되 프레임마다
  // 자리를 바꾸지 않아야 "떠오르는 개체"로 읽힌다(자리까지 흔들면 노이즈로 보인다).
  const rr = radius * 0.82 * Math.sqrt(hash3(seed, i, 1, 3));
  const drift = (hash3(seed, i, 1, 4) - 0.5) * radius * 0.22 * u;
  const lift = radius * MOTE_LIFT * sat(rise) * u;
  return {
    x: Math.cos(ang) * rr + drift,
    // 화면 좌표는 +y 가 아래라 "떠오름"은 −y 다.
    y: Math.sin(ang) * rr * 0.72 - lift,
    // 태어나고 사라지는 포물선 — 양끝에서 정확히 0 이라 팝인·팝아웃이 없다.
    alpha: Math.sin(Math.PI * u),
    r: (1.6 + 2.4 * hash3(seed, i, 1, 5)) * (1 - 0.45 * u),
  };
}

/** 재질 종류별 입자의 부양 계수(0=바닥에 눌림, 1=완전히 떠오름). */
export function moteRise(kind: HazardMaterialKind): number {
  switch (kind) {
    case 'molten':
      return 1; // 불티는 완전히 솟는다.
    case 'spore':
      return 0.85; // 포자는 느리게 부유한다.
    case 'ember':
      return 0.7;
    case 'refract':
      return 0.3; // 냉기 결정은 장 안에 떠 있을 뿐 솟지 않는다.
    case 'scorch':
      return 0.25; // 그을린 재는 거의 눌려 있다.
  }
}

// ---------------------------------------------------------------------------
// 높이감 — 테마 광원에서만 파생된다(화면에 태양이 둘이 되면 안 된다)
// ---------------------------------------------------------------------------

/** 장판의 접지 기하. 전부 {@link EnvLightSpec} 의 함수다(방향 상수 선언 없음). */
export interface HazardGrounding {
  /** 광원을 향하는 단위벡터 x(테마 없으면 0). */
  readonly lx: number;
  /** 광원을 향하는 단위벡터 y(테마 없으면 0). */
  readonly ly: number;
  /** 림 하이라이트 알파(광원 쪽 안쪽 가장자리). */
  readonly rimAlpha: number;
  /** 접촉 그늘 알파(광원 **반대**쪽 안쪽 가장자리 — 장판이 지면에 파여 있음을 만든다). */
  readonly shadowAlpha: number;
}

/** 림 하이라이트 기본 알파. 좁고 밝아야 "패인 가장자리"가 선다. */
export const HAZARD_RIM_ALPHA = 0.34;
/** 접촉 그늘 기본 알파. 곱연산이라 어두운 행성에서 스스로 약해진다(groundShadow 와 같은 성질). */
export const HAZARD_CONTACT_ALPHA = 0.3;

/**
 * 테마 광원 → 장판 접지 기하. **테마가 없으면 방향 신호를 통째로 끈다**(0) — 광원을 모르면서
 * 임의 방향으로 그늘을 넣으면 배경과 태양이 어긋나고, 그게 "붙여넣은 스티커" 로 읽히는 원인이다.
 */
export function hazardGrounding(light: EnvLightSpec | null): HazardGrounding {
  if (light === null || !Number.isFinite(light.angle)) {
    return { lx: 0, ly: 0, rimAlpha: 0, shadowAlpha: 0 };
  }
  const bias = sat(light.shadowBias);
  return {
    lx: lightX(light),
    ly: lightY(light),
    // 빗겨 드는 빛일수록(bias 큼) 림이 좁고 강하며 그늘은 넓고 옅다 — groundShadow 의
    // SHADOW_BIAS_SOFTEN 과 같은 물리 근거다.
    rimAlpha: HAZARD_RIM_ALPHA * (0.55 + 0.45 * bias),
    shadowAlpha: HAZARD_CONTACT_ALPHA * (1 - 0.28 * bias),
  };
}

// ---------------------------------------------------------------------------
// 환경 반응 — 넓은 면적 × 낮은 진폭 (atmosphere.ts 가 실측으로 얻은 규칙)
// ---------------------------------------------------------------------------

/** 장판이 주변 환경에 더하는 기여 한 겹. */
export interface HazardAmbience {
  /** 판정 반경 대비 배율(1 초과 — 환경 기여는 장판 **밖**으로 나간다). */
  readonly scale: number;
  /** 최대 알파(열이 만개했을 때). */
  readonly alpha: number;
  /** 가산 합성인가(발광 = 지형광 기여 / 비가산 = 대기 안개). */
  readonly additive: boolean;
}

/**
 * 재질 종류 → 환경 기여의 **형태**(게이트와 무관). 굽는 쪽은 이 값만 보고 한 번 굽고, 켜고 끄는
 * 것은 {@link hazardAmbience} 가 매 프레임 정한다 — 티어가 오르내릴 때마다 다시 굽지 않기 위해서다.
 *
 * 수치는 `atmosphere.ts` 가 실측으로 얻은 규칙을 그대로 따른다: 화면 기여도의 지배항은 **면적**
 * 이므로 넓게(1.35~2.2배) 깔고 진폭은 낮게(≤0.16) 둔다. 좁고 진한 기여는 지표를 못 움직이면서
 * 전경 가독성만 갉아먹는다.
 */
export function hazardAmbienceShape(kind: HazardMaterialKind): HazardAmbience {
  switch (kind) {
    case 'molten':
      return { scale: 2.2, alpha: 0.16, additive: true };
    case 'ember':
      return { scale: 1.6, alpha: 0.1, additive: true };
    case 'scorch':
      return { scale: 1.35, alpha: 0.06, additive: true };
    case 'spore':
      return { scale: 1.9, alpha: 0.13, additive: false };
    case 'refract':
      return { scale: 1.5, alpha: 0.09, additive: false };
  }
}

/**
 * 이번 프레임의 환경 기여. **`null` 이면 기여 없음**(게이트 차단).
 *
 * 게이팅 축이 둘로 갈린다:
 * - **가산 발광**(용암·박격·그을음)은 `gates.halo` — 발광 감소(`reducedGlow`) 축이다.
 * - **비가산 안개**(포자·굴절)는 발광이 아니라 대기라서 halo 와 무관하고, `low` 티어에서만 꺼진다.
 */
export function hazardAmbience(
  kind: HazardMaterialKind,
  tier: QualityTier,
  gates: EffectGates,
): HazardAmbience | null {
  const shape = hazardAmbienceShape(kind);
  if (shape.additive) return gates.halo ? shape : null;
  return tier === 'low' ? null : shape;
}

// 예산은 개체 상한이 아니라 겹 LOD 다 — 위 `hazardLod` 절이 정본이고, 안전 밸브
// `MAX_FIELD_MATERIALS` 도 거기 있다.
