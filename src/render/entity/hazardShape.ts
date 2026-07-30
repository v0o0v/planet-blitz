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
import type { CrustTextureId } from './hazardTexture.js';
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
 *
 * 0.83 → 0.88 (3차 반려 MINOR): 최대 17% 과소 표시가 12% 로 줄었다. 대역 폭이 0.13r → 0.08r 로
 * 좁아지므로 "진폭이 자기 선 두께의 3배"(2차 반려 CRIT-2)를 유지하려면 선 두께도 같이 내려야
 * 한다 — {@link file://../hazardVisual.ts} 의 `BOUNDARY_WIDTH_PER_RADIUS` 가 그 짝이다.
 */
export const EDGE_MIN_RATIO = 0.88;
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
 * 많고 각자 다른 주기로 태어나-부풀고-사라져야 표면이 살아 있는 것으로 읽힌다.
 * 개수가 늘었으므로 개당 알파는 크게 내렸다(가산 누적 밝기 예산 — 계약 §2-4).
 *
 * ## 14 → 10 (6차 반려 MAJOR-3 — 예산은 쓰고 화면에는 없었다)
 * 실측: 톡사르 272 스프라이트가 셀 가산 부하의 **20%**(spore full 셀 0.0276 / 0.1380)를 쓰는데
 * molten 원판에서의 가시 기여는 mean maxCh **0.80 · ≥8레벨 3.3%** — 재질 신호(15.20)의 5% 미만
 * 이다. §3-C-1 의 "재질 본체"를 실제로 지는 것은 원판을 통째로 덮는 `crustAdd` 이고, 이 회계는
 * {@link additiveLayerSpecs} 로 재현된다.
 *
 * **알파를 올려 보이게 하는 길은 택하지 않았다.** 5차의 밝기 성과(3레인 통합 후 bright 가
 * 출발점보다 낮다)를 되돌리는 방향이고, 6차 처방이 명시적으로 금지한 축과 같은 계열이다.
 * 대신 개수를 줄여 그 예산을 **감산 구조**(`sporeShade`)와 **셀 간 균일성**(전 LOD 입자 —
 * {@link lodMoteScale})으로 옮긴다. 통계로 읽히는 하한은 10 이다(5개 시절의 "큰 덩어리 하나"는
 * 개수가 아니라 **개당 크기**(0.40~0.92r)의 문제였고 그 축은 {@link LOBE_MAX_R} 가 지킨다).
 */
export const LOBE_COUNT = 10;

/** 로브의 운동 방식. 재질감의 정체는 결국 **운동**이라, 종류마다 달라야 구분된다. */
export type HazardLobeMotion = 'flow' | 'bubble' | 'lens' | 'still';

/** 종류별 로브 표현. **Pixi 를 모르는 순수 데이터**라 예산 회계가 같은 값을 읽을 수 있다. */
export interface HazardLobeStyle {
  readonly motion: HazardLobeMotion;
  /**
   * 로브 색의 보간 계수.
   *
   * 2차의 `molten` 0.72 는 `mixColor(0xff8412, 0xfff0e6, .72)` = (255,210,170) 로 **거의 흰색**
   * 이었고, 주황 장판 위 창백한 얼룩이라 "용융"이 아니라 **렌즈 기름때**로 읽혔다(반려 MINOR).
   * 지금은 종류색 쪽에 훨씬 가깝게 둬서 로브가 장판의 **같은 물질**로 보이게 한다.
   */
  readonly brightMix: number;
  /**
   * 로브 알파(가산).
   *
   * 4차는 0.2~0.3 이었고, 3차와 달리 **41셀 전부**가 로브를 갖게 되면서(`lodLobeCount` 가
   * 어떤 LOD 도 0 으로 두지 않는다) 총량이 폭증했다 — 5차 계측에서 톡사르 해저드 순기여가
   * `+0.37pp → +5.95pp`(16배)였다.
   *
   * **0.8배만** 내린다. {@link additiveLayerSpecs} 회계로 재 보면 로브는 톡사르 셀 부하의
   * 15% 에 불과하고(지배항은 원판을 두 번 덮는 `crustAdd`), 로브를 더 깎아도 예산은 거의 안
   * 내려가면서 3차 반려 사유("재질이 화면에 없다")에는 곧장 가까워진다. **개수가 아니라 알파**를
   * 내리는 것도 같은 이유다 — 겹의 존재와 공간 분포는 유지하고 진폭만 뺀다.
   */
  readonly lobeAlpha: number;
}

const LOBE_STYLE: Readonly<Record<HazardMaterialKind, HazardLobeStyle>> = {
  molten: { motion: 'flow', brightMix: 0.38, lobeAlpha: 0.24 },
  spore: { motion: 'bubble', brightMix: 0.28, lobeAlpha: 0.21 },
  refract: { motion: 'lens', brightMix: 0.42, lobeAlpha: 0.24 },
  scorch: { motion: 'still', brightMix: 0.15, lobeAlpha: 0.16 },
  ember: { motion: 'flow', brightMix: 0.4, lobeAlpha: 0.21 },
};

/** 종류 → 로브 표현. */
export function hazardLobeStyle(kind: HazardMaterialKind): HazardLobeStyle {
  return LOBE_STYLE[kind];
}

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
// 면적 재질 — 종류가 "색만 다르던" 결함의 처방 (3차 반려 MAJOR-5)
// ---------------------------------------------------------------------------

/**
 * 종류별 면적 재질 서술. **§3-C-1 이 요구한 것은 "노이즈 텍스처 + 셰이더 기반 재질"이고
 * 3차까지는 절차적 도형뿐이었다.**
 *
 * 비평가가 세 종을 나란히 주입해 본 결과가 판정의 근거다: 구성이 **같았고**(평면 채움 + 45°
 * 직선 빗금 + 16각 윤곽 + 흰 정원 립) 다른 것은 색조뿐이었다. AAA 참조(Hades 용암 웅덩이 ·
 * Returnal 산성 지대 · Nova Drift 장 이펙트)가 공통으로 갖는 셋 중 ⓑ **내부의 면적 텍스처**가
 * 통째로 없었다 — 로브는 개체이고 빗금은 직선 격자라서 둘 다 면적 텍스처가 아니다.
 *
 * - `add` — 가산 겹(발광 균열·거품 막·집광 무늬). `gates.halo` 로 강도를 낮춘다.
 * - `shade` — 곱연산 겹(식은 껍질·그을음의 검은 금). 밝기 총량에 **순감**으로 기여한다.
 * - `flow` — 가산 겹을 몇 장 겹칠 것인가. 2 면 두 장이 서로 반대로 돌아 무늬가 **회전이 아니라
 *   변형**으로 읽힌다(`edgeRatioAt` 가 두 옥타브를 반대로 흘리는 것과 같은 장치 — 한 장만
 *   돌리면 "돌아가는 도장"이 된다).
 */
export interface HazardCrustSpec {
  readonly add: CrustTextureId | null;
  readonly shade: CrustTextureId | null;
  readonly addAlpha: number;
  readonly shadeAlpha: number;
  readonly flow: number;
  /** 가산 겹의 회전 속도(프레임당 라디안). 0 이면 정지(그을음은 흐르지 않는다). */
  readonly spin: number;
}

/**
 * 가산 겹을 여러 장 쌓을 때 둘째 장부터 곱하는 감쇠. 첫 장이 1, 이후가 이 값이다 —
 * {@link additiveLayerSpecs} 가 부하를 셀 때 같은 식을 써야 예산 회계가 화면과 어긋나지 않는다.
 */
export const CRUST_FLOW_FALLOFF = 0.7;

/**
 * 면적 재질이 덮는 반경 비율. 물질 윤곽(`EDGE_MAX_RATIO`=0.96) 안쪽에 머문다.
 * (굽는 쪽과 **예산 회계**가 같은 값을 봐야 하므로 기하 쪽에 둔다.)
 */
export const CRUST_COVER = 0.95;
/** 접지 텍스처가 덮는 반경 비율. 판정 반경에 맞춰야 "가장자리가 파였다"가 립과 정합한다. */
export const GROUND_COVER = 0.99;

/**
 * 물질 겹의 **원근 압축 계수**(세로 / 가로). 6차 반려 MAJOR-2 의 처방.
 *
 * 5차까지 채움·경계·립·재질에 원근 압축이 **0** 이었다(압축을 쓰는 것은 환경 기여 0.88 과 예열
 * 고조 0.92 뿐). 그래서 장판이 바닥에 누운 웅덩이가 아니라 정면에서 본 **평면 원**으로 읽혔다 —
 * AAA 대조(Hades 용암 웅덩이 · Returnal 산성 지대)는 웅덩이 자체를 세로로 누른다.
 *
 * 여기(Pixi 를 모르는 파일)에 두는 이유: `hazardVisual.drawHazardZone` 의 채움·경계와
 * `hazardField` 의 재질 스프라이트가 **같은 값**을 써야 두 그림이 같은 타원 안에 머문다. 값이
 * 갈리면 재질이 채움 밖으로 삐져나오고, 그것은 화면에서만 보이는 결함이다.
 *
 * ⚠️ **맥동 립과 바깥 글로우는 압축 대상이 아니다.** 립은 판정 반경의 울타리라 누르면 화면이
 * 세로 방향 위험 범위를 실제보다 작게 말하고(§2-2 위반), 글로우 대역 [1.02,1.06] 은 압축하면
 * 세로에서 립 안쪽으로 내려와 세 선의 대역 분리(2차 반려 CRIT-3)가 깨진다.
 */
export const HAZARD_SQUASH_Y = 0.94;

const CRUST_SPEC: Readonly<Record<HazardMaterialKind, HazardCrustSpec>> = {
  // 용암: 굳은 껍질(곱연산) 사이로 균열이 빛난다(가산 2장 역회전 = 흐름).
  //
  // 4차의 가산 알파(0.5/0.42/0.4/0.46)는 **원판 전체를 한두 번 통째로 덮는** 겹이라 셀당 가산
  // 부하의 **지배항**이었다({@link additiveLayerSpecs} 로 재면 톡사르 셀의 51%). 로브가 아니라
  // 여기가 5차 초과분(+5.95pp)의 최대 기여다 — 알파만 세면 순위가 뒤집혀 보인다.
  //
  // 0.56배로 내린다. 무늬의 존재는 그대로고(3차 반려 "재질이 화면에 없다"로 되돌아가지 않는다)
  // 총량만 빠진다. 오염은 텍스처까지 바뀌어(`bubbleLuminance` 막 → 얼룩) 원판 평균 휘도가
  // 0.137 → 0.087 로 함께 내려가므로 실효 감산이 더 크다.
  molten: { add: 'crackAdd', shade: 'plateShade', addAlpha: 0.28, shadeAlpha: 0.85, flow: 2, spin: 0.0022 },
  // 박격 낙하점: 달궈진 자국. 껍질은 없다(막 생긴 자리라 굳을 시간이 없다).
  ember: { add: 'crackAdd', shade: null, addAlpha: 0.23, shadeAlpha: 0, flow: 2, spin: 0.004 },
  // 그을음: **갈라진 검은 금**. 발광이 아니라 감광이라 가산 겹이 아예 없다.
  scorch: { add: null, shade: 'crackShade', addAlpha: 0, shadeAlpha: 0.95, flow: 0, spin: 0 },
  // 오염: 부글거리는 거품이 **가라앉은 웅덩이 판** 위에 뜬다.
  //
  // 6차 반려 CRITICAL-1 — `shade` 가 `null` 이었던 것이 근인이다. 판정 장면(톡사르 41셀)의 오염
  // 셀은 채움이 깔린 밝은 원판이고, 그 위에서 가산 겹만으로는 대비가 생기지 않는다(셀 내부
  // on/off 채널 델타 mean maxCh 6.32 vs 카르곤 molten full 15.20). `molten` 이 `plateShade` 로
  // 구조를 얻는 통로가 오염에는 통째로 없었다.
  //
  // 감산 겹은 §2-4 밝기 총량에 **순감**으로 들어가므로, 5차의 밝기 성과를 되돌리지 않고 진폭을
  // 얻는 유일한 축이다. 가산 알파는 그대로 두고(총량 회귀 금지) 구조를 전부 감산으로 만든다.
  spore: { add: 'bubbleAdd', shade: 'sporeShade', addAlpha: 0.22, shadeAlpha: 0.92, flow: 2, spin: 0.0015 },
  // 감속장: 집광 무늬 + 유리 테두리. 실제 왜곡은 `hazardField` 의 공유 변위 필터가 준다.
  refract: { add: 'lensAdd', shade: null, addAlpha: 0.26, shadeAlpha: 0, flow: 1, spin: 0.0026 },
};

/** 종류 → 면적 재질 서술. */
export function hazardCrustSpec(kind: HazardMaterialKind): HazardCrustSpec {
  return CRUST_SPEC[kind];
}

/**
 * 이 종류가 **실제 왜곡**(변위 필터)을 쓰는가. `refract` 뿐이다 — 굴절은 정의상 "뒤가 휘어
 * 보이는 것"이고, 그것만은 텍스처로 흉내 낼 수 없다.
 */
export function kindUsesDistortion(kind: HazardMaterialKind): boolean {
  return kind === 'refract';
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
/**
 * 이 LOD 가 접지(접촉 그늘·림)를 그리는가. **전부 그린다.**
 *
 * 3차는 `lod === 'full'` 이라 톡사르 41장 중 **6장에만** 접지가 있었다. 그건 이 레인이
 * {@link lodLobeCount} 를 두고 스스로 세운 논리("나란한 같은 셀 중 일부만 다르면 관객은 LOD 가
 * 아니라 렌더링 버그로 읽는다")를 그대로 위반한 것이다. 접지가 `Graphics` 두 개였던 것이
 * 그 타협의 원인이었고, 공유 텍스처 스프라이트로 바뀌면서(`hazardTexture.contactTexture`)
 * 이유가 사라졌다. 예산은 **겹**이 아니라 **개당 비용**에서 회수한다.
 */
export function lodHasGrounding(_lod: HazardLod): boolean {
  return true;
}
/**
 * 이 LOD 가 입자를 그리는가. **전부 그린다**(6차 반려 MINOR-2).
 *
 * 5차는 `lod !== 'lite'` 라 톡사르 41셀 중 18셀에만 입자가 있었다. 근거는 "입자가 없어도 같은
 * 물질의 원거리 표현으로 읽힌다"였는데, 실제 판정 장면의 오염 셀은 **서로 붙어 있고 거리가
 * 같다** — 같은 거리의 나란한 셀 사이 정보량 차이는 접지·빗금에서 이미 스스로 반려한 항목과
 * 같은 계열이다. 개수는 {@link lodMoteScale} 이 낮춘다(겹을 빼는 것이 아니라 밀도를 낮춘다).
 */
export function lodHasMotes(_lod: HazardLod): boolean {
  return true;
}
/**
 * LOD 별 입자 수 배율. `mid` 는 절반이라 전이가 계단으로 읽히지 않는다.
 *
 * `lite` 가 0 → **0.25** (6차 반려 MINOR-2): 5차는 입자가 41셀 중 18셀에만 있었고, 그것은
 * "나란한 같은 셀 중 일부만 다르면 관객은 LOD 가 아니라 렌더링 버그로 읽는다"는 이 레인
 * 자신의 논거(MAJOR-1)의 잔여분이었다. 로브 감축(14→10)으로 비운 가산 예산을 여기로 옮긴다 —
 * 셀당 3개는 `moteBudget` 의 `min` 단계와 같은 규모라 총량이 아니라 **분포**만 고른다.
 */
export function lodMoteScale(lod: HazardLod): number {
  return lod === 'full' ? 1 : lod === 'mid' ? 0.5 : 0.25;
}
/** `lite` 가 유지하는 최소 로브 수(고사양 기준). **0 이 아니다.** */
export const LOD_LITE_LOBES = 3;

/**
 * 이 LOD 의 로브 수. **티어를 게이트보다 먼저 본다**({@link moteBudget} 와 같은 규율).
 *
 * ## 3차 반려 CRIT — 가장 크고 비싼 겹에 게이트가 없었다
 * 3차의 시그니처는 `lodLobeCount(lod)` 였다. `tier`·`gates` 를 **아예 받지 않아서** 실측
 * `hazardLobes` 겹이 high 272 스프라이트 / low **272(동일)** / `reducedGlow`+`reducedMotion`
 * **272(동일)** 이었다. 전부 가산 합성이므로 정의상 발광이고, 광과민 대응 토글이 이 겹을 못
 * 덮는 것은 미관이 아니라 **접근성 결함**이다. 계약 §2-3 은 "게이트 없는 이펙트는 즉시 반려"다.
 *
 * `low` 에서는 **`lite` 를 0 으로 만든다.** {@link lodLobeCount} 가 "어떤 LOD 도 0 이 아니다"를
 * 지켰던 근거(MAJOR-1: 나란한 셀 중 일부만 다르면 렌더링 버그로 읽힌다)는 **LOD 축에만**
 * 적용된다 — LOD 는 "멀리 있는 것"의 표현이지만 티어는 "성능이 없는 것"이고, 저사양에서는
 * 화면 전체가 함께 내려가므로 셀 간 불균형이 생기지 않는다.
 *
 * 톡사르 41장: high 6×10 + 12×6 + 23×3 = **201**(5차 272) → low 6×3 + 12×2 + 23×0 = **42**.
 */
export function lodLobeCount(lod: HazardLod, tier: QualityTier, gates: EffectGates): number {
  if (tier === 'low') return lod === 'full' ? 3 : lod === 'mid' ? 2 : 0;
  const base = lod === 'full' ? LOBE_COUNT : lod === 'mid' ? 6 : LOD_LITE_LOBES;
  // 티어는 개수를, `reducedGlow`(= halo 차단)는 개수와 강도를 함께 깎는다. 가산 스프라이트는
  // 겹칠 때마다 밝기가 누적되므로, 광과민 대응에서는 **장수 자체**를 줄이는 것이 알파만 내리는
  // 것보다 효과가 크다(강도는 {@link lobeAlphaScale} 가 추가로 내린다).
  const k = (tier === 'med' ? 0.7 : 1) * (gates.halo ? 1 : 0.6);
  return k >= 1 ? base : Math.max(2, Math.round(base * k));
}

/**
 * 가산 겹 전체의 **기본** 알파 배율.
 *
 * 4차는 이 값이 1 이었다 — 즉 게이트가 열려 있으면 각 겹이 선언한 알파가 그대로 화면에 갔다.
 * 5차 계측에서 톡사르 41셀 해저드 순기여가 `+5.95pp`(§2-4 상한을 셀 하나 없이 초과)였고,
 * 초과분은 특정 겹 하나가 아니라 **가산 겹 전부의 합**이었다. 그래서 겹마다 개별 계수를
 * 만지는 것과 별개로, **기본값 자체**를 1 미만으로 내려 총량에 천장을 만든다.
 *
 * 0.72 인 이유: 겹 사이 **상대 비율**을 건드리지 않는 유일한 감산이라 어떤 항목도 상대적으로
 * 사라지지 않는다(3차 반려 "재질·입자·접지가 화면에 없다"로 되돌아가지 않기 위한 조건이다).
 */
export const ADDITIVE_ALPHA_BASE = 0.72;

/**
 * 가산 겹(로브·림·입자·균열)의 알파 배율. `reducedGlow` → `gates.halo === false` 에서 더 내린다.
 *
 * 0 이 아닌 이유: 로브는 §3-C-1 의 **재질 본체**라 통째로 끄면 항목이 화면에서 사라진다.
 * 광과민 대응의 목적은 "번쩍임 억제"이므로 진폭을 낮추는 것으로 충족된다.
 */
export function lobeAlphaScale(gates: EffectGates): number {
  return ADDITIVE_ALPHA_BASE * (gates.halo ? 1 : 0.4);
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
export function moteBudget(
  tier: QualityTier,
  gates: EffectGates,
  /**
   * 모션 감소 토글. **`EffectGates` 에는 이 축이 없다** — `effectGates()` 는 `reducedMotion` 을
   * `shake`·`hitFlash` 로만 흘려보내므로 입자는 게이트로 못 덮는다. 3차 실측이 `reducedMotion`
   * 에서 `hazardMotes` 60개 그대로였던 것이 그 결과다. 입자는 유일하게 매 프레임 **위치가
   * 움직이는** 겹이므로 모션 축에서 먼저 꺼져야 한다.
   */
  reducedMotion = false,
): number {
  if (gates.particles === 'off') return 0;
  if (reducedMotion) return 0;
  if (tier === 'low') return 0;
  if (gates.particles === 'min') return 3;
  return tier === 'med' ? 7 : MOTE_BUDGET_HIGH;
}

/**
 * high 티어 장판당 입자 수.
 *
 * ## 3차 반려 — 개수가 문제가 아니었다
 * 3차는 이 값이 10 이었고 화면 전체 60개였는데, 실측 mean·국소·변화블록이 **셋 다 노이즈
 * 바닥과 동일**했다(카르곤 0.60/0.59 · 국소 31.64/31.64 · 3.00%/3.00%). 원인은 예산이 아니라
 * **규모**다: 실측 스프라이트가 직경 2.4~6.8px, 총 면적이 화면의 **0.08%** 였다. 어떤 지표로도
 * 안 잡히고 눈으로도 안 보인다.
 *
 * 그래서 개수는 조금만 올리고 {@link MOTE_R_MIN}/{@link MOTE_R_MAX} 를 **반경 비례**로 바꿨다.
 */
export const MOTE_BUDGET_HIGH = 14;

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
    // 태어나고 사라지는 곡선 — 양끝에서 정확히 0 이라 팝인·팝아웃이 없다.
    //
    // 3차는 순수 `sin(πu)` 였다. 그러면 알파 0.5 이상인 구간이 수명의 절반뿐이고, 그 절반이
    // **직경 3px 짜리 점**에 실려 있어 화면 어디에도 흔적이 없었다. 지수 0.55 를 씌워 **고원**
    // 을 만든다: 알파 0.5 이상 구간이 수명의 76% 로 늘고, 양 끝은 여전히 정확히 0 이다.
    alpha: Math.pow(Math.sin(Math.PI * u), MOTE_ALPHA_SHAPE),
    // 크기를 **반경 비례**로 뒤집은 것이 3차 반려 처방의 핵심이다(위 MOTE_BUDGET_HIGH 주석).
    r: radius * (MOTE_R_MIN + (MOTE_R_MAX - MOTE_R_MIN) * hash3(seed, i, 1, 5)) * (1 - 0.3 * u),
  };
}

/**
 * 입자 반지름의 하한·상한(**판정 반경 대비**). 3차는 절대 px(1.6~4.0)였고 반경 100 장판에서
 * 직경 3~8px 였다. 지금은 반경 100 에서 직경 **11~24px** 다 — 총 면적이 화면의 0.08% 에서
 * 3% 대로 올라 `analyze.mjs` 의 mean·국소 양쪽에서 바닥을 벗어난다.
 *
 * 상한은 `moteAt` 의 산포 반경(0.82r)과 합쳐도 판정 반경을 넘지 않도록 잡았다
 * (0.82 + 0.13 = 0.95 < 1).
 */
export const MOTE_R_MIN = 0.065;
export const MOTE_R_MAX = 0.13;
/** 수명 알파 곡선의 지수. 1 미만이라 고원이 생긴다(값이 작을수록 평평). */
const MOTE_ALPHA_SHAPE = 0.55;

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

/**
 * 림 하이라이트 기본 알파. 좁고 밝아야 "패인 가장자리"가 선다.
 *
 * 0.34 → 0.6 → **0.26**. 3차 실측이 톡사르에서 정확히 바닥이었던 원인은 알파와 면적 **둘 다**
 * 였는데, 4차에 둘을 동시에 올렸다: 면적은 텍스처가 고쳤고(`rimLuminance` 는 광원 쪽 절반
 * 전체의 안쪽 띠를 채운다 — 3차의 `arc` 는 원주의 43% 였다) 알파도 1.76배가 됐다. 결과가
 * 5차 계측의 "셀마다 강한 흰 호"이고, 겹친 셀에서 그 호들이 교차해 §2-5 의 동심 윤곽으로 읽혔다.
 *
 * 면적 수정만 남긴다. **접지감(§3-C 항목 3)은 곱연산 {@link HAZARD_CONTACT_ALPHA}(0.62)가 이미
 * 지고 있고** 그쪽은 어둡게 하므로 밝기 총량 기여가 0 이다 — 즉 림을 내려도 접지는 안 죽는다.
 */
export const HAZARD_RIM_ALPHA = 0.17;
/**
 * 접촉 그늘 기본 알파. **곱연산**이라 어두운 행성에서 스스로 약해지고(groundShadow 와 같은
 * 성질) 밝기 총량(§2-4)에는 순감으로 기여한다 — 3차의 `+0.76pp` 순기여를 되돌리는 항목이다.
 *
 * 0.62 → **0.8** (6차 반려 MAJOR-2). 높이감이 미달인데(진폭 ≥8레벨 7.3% · 톡사르 육안 0) 이
 * 겹은 **올려도 예산을 쓰지 않는 유일한 축**이다 — 곱연산이므로 올린 만큼 밝기 총량이 내려간다.
 * 텍스처 쪽에서는 방향성 그늘에 전 둘레 **내벽**(`WALL_TEX_BAND`)이 더해졌고, 알파는 그 내벽이
 * 화면에서 두께로 읽히는 데 필요한 진폭이다. 가산 림은 반대로 내려(0.26 → 0.17) 접지감의
 * 무게중심을 감산으로 완전히 옮긴다.
 */
export const HAZARD_CONTACT_ALPHA = 0.8;

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

// ---------------------------------------------------------------------------
// 가산 밝기 총량 회계 — §2-4 를 상수가 아니라 실측 파생으로 잠근다
// ---------------------------------------------------------------------------

/**
 * ## 왜 회계 모델이 필요한가 (5차 반려)
 *
 * 4차는 겹마다 "이 알파면 안 밝다"를 개별로 판단했고, 개별 판단은 전부 통과했다. 그런데
 * **41셀 × 가산 겹 5종**이 같은 화면에 겹치자 해저드 순기여가 `+0.37pp → +5.95pp`(16배)로
 * 튀어 §2-4 상한(전체 bright ≤ 7%)을 통째로 깼다. 겹 하나만 봐서는 절대 안 보이는 결함이다.
 *
 * 그래서 총량을 **모델로** 세운다. 셀 하나가 화면에 더하는 가산 부하를
 *
 * ```
 * load = Σ_겹  (스프라이트 수) × (스프라이트 하나의 알파 × 면적) × (텍스처 평균 휘도)
 * ```
 *
 * 로 정의한다(면적 단위는 **판정 반경²**). 세 인자가 곱해지는 것이 핵심이다 — 4차가 밟은 함정이
 * 정확히 이것으로, `hazardRim` 은 알파가 0.6 이고 원판 전체를 덮지만 텍스처가 광원 쪽 좁은 띠만
 * 채우고, 반대로 `crustAdd` 는 알파가 낮아도 **원판을 두 번 통째로** 덮는다. 알파만 세면 순위가
 * 뒤집힌다.
 *
 * ## 왜 텍스처 휘도를 주입받는가
 * 텍스처 굽기는 `hazardTexture.ts`(Pixi 를 import 한다) 소유이고, 이 파일은 Pixi 를 모르는 것이
 * 존재 이유다(헤더 참조). 그래서 평균 휘도는 **인자로 받는다** — 테스트가
 * `hazardTexture.additiveTextureMeans()` 로 실제 샘플러를 적분해 넘기므로, 텍스처를 밝게 다시
 * 구우면 알파를 안 만져도 예산 테스트가 빨개진다.
 *
 * ## 왜 상수가 아니라 표본인가
 * 로브·입자의 알파와 면적은 {@link lobeAt}·{@link lobeLife}·{@link moteAt} 의 수명 곡선에서
 * 나온다. 그 평균을 손으로 적은 상수로 두면 곡선을 만졌을 때 회계가 조용히 거짓이 된다.
 * {@link lobeUnitLoad}·{@link moteUnitLoad} 는 그 함수들을 **직접 표본**한다.
 */

/** 부하를 재는 가산 겹. */
export type AdditiveLayerId = 'ambient' | 'crustAdd' | 'lobes' | 'rim' | 'motes';

/** 그 겹이 쓰는 텍스처(평균 휘도의 조회 키). */
export type AdditiveTextureId = 'glow' | 'rim' | 'blob' | 'mote' | CrustTextureId;

/** 가산 겹 하나의 부하 서술. */
export interface AdditiveLayerSpec {
  readonly layer: AdditiveLayerId;
  readonly texture: AdditiveTextureId;
  /** 스프라이트 수. */
  readonly count: number;
  /** 스프라이트 **하나**의 알파 × 면적(판정 반경² 단위). 텍스처 휘도는 곱하지 않는다. */
  readonly unit: number;
}

/** 부하 표본 수(로브·입자 수명 곡선). */
const LOAD_SAMPLES = 48;
/** 표본 구간(프레임). 로브 최장 주기(170)·입자 주기(150)의 여러 배라 위상이 골고루 섞인다. */
const LOAD_SPAN = 1700;
/** 표본에 쓰는 시드들. 배치는 시드 함수라 한 시드만 보면 우연에 걸린다. */
const LOAD_SEEDS: readonly number[] = [1, 7, 23, 101];

/**
 * 로브 스프라이트 **하나**의 (알파 배율 × 면적) 기댓값 — 판정 반경 1 기준.
 * `KIND_STYLE.lobeAlpha` 와 가산 게이트는 곱하지 않는다(호출측이 곱한다).
 */
export function lobeUnitLoad(count: number): number {
  if (count <= 0) return 0;
  let sum = 0;
  let n = 0;
  for (const seed of LOAD_SEEDS) {
    for (let i = 0; i < count; i++) {
      const lobe = lobeAt(seed, i, 1);
      for (let t = 0; t < LOAD_SAMPLES; t++) {
        const life = lobeLife(seed, i, (t / LOAD_SAMPLES) * LOAD_SPAN);
        const r = lobe.r * life.scale;
        // `hazardField.onFrame` 의 알파식과 같은 꼴이다: life.alpha × (0.55 + 0.45·bright).
        sum += Math.PI * r * r * life.alpha * (0.55 + 0.45 * lobe.bright);
        n++;
      }
    }
  }
  return sum / n;
}

/** 입자 스프라이트 **하나**의 (알파 × 면적) 기댓값 — 판정 반경 1 기준. */
export function moteUnitLoad(count: number, kind: HazardMaterialKind): number {
  if (count <= 0) return 0;
  const rise = moteRise(kind);
  let sum = 0;
  let n = 0;
  for (const seed of LOAD_SEEDS) {
    for (let i = 0; i < count; i++) {
      for (let t = 0; t < LOAD_SAMPLES; t++) {
        const m = moteAt(seed, i, 1, (t / LOAD_SAMPLES) * LOAD_SPAN, rise);
        sum += Math.PI * m.r * m.r * m.alpha;
        n++;
      }
    }
  }
  return sum / n;
}

/**
 * 셀 하나의 가산 겹 목록. **활성 최대치**(`presence = 1`)를 기준으로 한다 — 예산은 최악의
 * 프레임에서 지켜져야 하고, 예열은 `presence` 가 더 낮으므로 자동으로 안쪽이다.
 *
 * 예열 고조(`hazardCharge`)는 활성에서 0 이라 여기 없다. 대신 예열 컷에서는 로브·입자가
 * `presence` 만큼 내려가므로 총량이 활성보다 크지 않다.
 */
export function additiveLayerSpecs(
  kind: HazardMaterialKind,
  lod: HazardLod,
  tier: QualityTier,
  gates: EffectGates,
  light: EnvLightSpec | null,
  reducedMotion = false,
): readonly AdditiveLayerSpec[] {
  const glow = lobeAlphaScale(gates);
  const out: AdditiveLayerSpec[] = [];

  const amb = hazardAmbience(kind, tier, gates);
  if (amb !== null && amb.additive) {
    // 세로 0.88 압축(바닥에 누운 빛무리)까지 반영한 타원 면적이다.
    out.push({
      layer: 'ambient',
      texture: 'glow',
      count: 1,
      unit: amb.alpha * Math.PI * amb.scale * amb.scale * 0.88,
    });
  }

  const crust = hazardCrustSpec(kind);
  if (crust.add !== null && crust.flow > 0) {
    let fade = 0;
    for (let i = 0; i < crust.flow; i++) fade += i === 0 ? 1 : CRUST_FLOW_FALLOFF;
    out.push({
      layer: 'crustAdd',
      texture: crust.add,
      count: crust.flow,
      unit: ((crust.addAlpha * glow * fade) / crust.flow) * Math.PI * CRUST_COVER * CRUST_COVER,
    });
  }

  const lobes = lodLobeCount(lod, tier, gates);
  if (lobes > 0) {
    out.push({
      layer: 'lobes',
      texture: 'blob',
      count: lobes,
      unit: hazardLobeStyle(kind).lobeAlpha * glow * lobeUnitLoad(lobes),
    });
  }

  if (lodHasGrounding(lod)) {
    const gr = hazardGrounding(light);
    if (gr.rimAlpha > 0) {
      out.push({
        layer: 'rim',
        texture: 'rim',
        count: 1,
        unit: gr.rimAlpha * glow * Math.PI * GROUND_COVER * GROUND_COVER,
      });
    }
  }

  const motes = lodHasMotes(lod)
    ? Math.round(moteBudget(tier, gates, reducedMotion) * lodMoteScale(lod))
    : 0;
  if (motes > 0) {
    out.push({
      layer: 'motes',
      texture: 'mote',
      count: motes,
      unit: glow * moteUnitLoad(motes, kind),
    });
  }

  return out;
}

/** 겹 목록 × 텍스처 평균 휘도 → 셀 하나의 가산 부하(판정 반경² 단위). */
export function additiveLoad(
  specs: readonly AdditiveLayerSpec[],
  meanLuminance: (texture: AdditiveTextureId) => number,
): number {
  let sum = 0;
  for (const s of specs) sum += s.count * s.unit * meanLuminance(s.texture);
  return sum;
}

/**
 * 셀 하나의 **게이트 걸린** 가산 부하 상한(= `ambient` 를 뺀 합). **종류별**이다.
 *
 * ## 왜 하나의 상수에서 종류별 표로 바뀌었나 (6차 반려 MINOR-3)
 * 5차는 `0.32` 단일 상수였다. 그 값은 최악 조합(`molten`·`full`·`high` = 0.291)에서 파생됐지만,
 * **판정 장면인 톡사르는 전부 `spore`(실측 0.138)** 라 상한이 실측의 **2.3배**였다. 즉 오염 셀의
 * 어떤 알파 회귀도 셀 테스트를 통과했다 — 5차가 밟은 함정("겹별 개별 판단은 전부 정당했는데
 * 총량이 터졌다")과 같은 계열의 다음 결함을 모델이 여전히 통과시키고 있었던 것이다.
 *
 * 그래서 **종류마다 실측 × 1.05** 로 조인다. 여유 5% 는 표본 흔들림(로브·입자 수명 곡선의
 * `LOAD_SEEDS` 표본)만 흡수하는 폭이고, 의도적인 알파 인상은 반드시 여기 부딪친다.
 *
 * 6차 실측(`full`·`high`·`gates.halo` 열림, `additiveTextureMean` 적분):
 * molten 0.2745 · spore 0.1229 · refract 0.2128 · scorch 0.0519 · ember 0.2332.
 *
 * bright(L≥96)는 가산 누적의 **초선형** 함수라 부하를 내리면 순기여는 그보다 더 떨어지지만,
 * 회계는 보수적으로 선형 비례로 읽는다(목표는 톡사르 순기여 ≤1.5pp).
 */
export const MAX_CELL_ADDITIVE_LOAD: Readonly<Record<HazardMaterialKind, number>> = {
  molten: 0.29,
  spore: 0.13,
  refract: 0.225,
  scorch: 0.055,
  ember: 0.245,
};

/**
 * 환경 기여(`hazardAmbience`) 겹의 셀당 상한. **왜 따로인가**: 이 겹은
 * ① `lobeAlphaScale` 이 아니라 `gates.halo` **단독**으로만 게이팅되고(코드가 그렇다),
 * ② 2차에 비평가가 화면에서 **통과 판정한 유일한 항목**이라 경로·수치를 건드리지 않았고,
 * ③ 넓고 옅은 겹이라 밝기 총량의 성격이 다르다(면적 지배 · 국소 포화 아님).
 *
 * 5차 실측 최악은 `molten` 의 **0.418** 이고, 그 값을 쓰는 카르곤 보스전은 bright 3.58% ·
 * p95 85.00 으로 §2-4 를 통과했다. 즉 이 겹은 **현재 값이 증거로 통과한 상태**이므로 감산
 * 대상이 아니고, 상한은 회귀 방어다.
 *
 * 0.45 → **0.44** (6차 MINOR-3): 실측 0.4178 × 1.05 로 조인다. 이 겹만 손대지 않는 것과
 * 이 겹의 회귀를 안 잡는 것은 다른 얘기다.
 */
export const MAX_AMBIENT_LOAD = 0.44;

/**
 * 판정 장면(톡사르 41셀)의 LOD 분포. `hazardLod` 의 경계에서 파생된다 — 6 full · 12 mid · 23 lite.
 * 상수로 적지 않는 이유는 {@link LOD_FULL_COUNT}/{@link LOD_MID_COUNT} 를 만지면 여기가 따라
 * 움직여야 하기 때문이다.
 */
export function toxarLodMix(cells = 41): readonly { lod: HazardLod; cells: number }[] {
  let full = 0;
  let mid = 0;
  let lite = 0;
  for (let i = 0; i < cells; i++) {
    const lod = hazardLod(i);
    if (lod === 'full') full++;
    else if (lod === 'mid') mid++;
    else lite++;
  }
  return [
    { lod: 'full', cells: full },
    { lod: 'mid', cells: mid },
    { lod: 'lite', cells: lite },
  ];
}

/**
 * 41셀 장면 합계 상한(톡사르 LOD 분포 기준). **종류별**이다.
 *
 * 셀당 상한 × 41 이 아니다 — LOD 가 낮은 셀이 다수이므로 실제 구성으로 잰다.
 *
 * ## 왜 `spore` 하나가 아니라 5종 전부인가 (6차 반려 MINOR-3)
 * 5차는 상수 하나(4.8)였고 테스트도 `'spore'` 한 종만 훑었다. 그러면 다른 네 종의 겹 알파가
 * 올라가도 **장면 축에서는 아무도 보지 않는다**. 41셀은 톡사르에서 실측된 **최악의 셀 수**이므로
 * 종류를 갈아 끼워도 유효한 상계 장면이고, 종류별 상한을 두면 어느 종을 만져도 같은 자리에서
 * 빨개진다.
 *
 * 6차 실측 × 1.05: molten 10.2353 · spore 4.0874 · refract 7.7067 · scorch 1.2822 · ember 8.6084.
 * (4차의 같은 모델 `spore` 값은 **14.96** 이었다 — 그 비가 §2-4 순기여 목표 ≤1.5pp 의 근거다.)
 */
export const MAX_SCENE_ADDITIVE_LOAD: Readonly<Record<HazardMaterialKind, number>> = {
  molten: 10.75,
  spore: 4.3,
  refract: 8.1,
  scorch: 1.35,
  ember: 9.05,
};
