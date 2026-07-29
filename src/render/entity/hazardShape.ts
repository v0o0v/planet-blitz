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
 * 불규칙 가장자리가 오갈 수 있는 반경 비율의 **하한**. 이보다 안으로 들어가면 장판이
 * 실제보다 작아 보여 회피가 헐거워진다.
 */
export const EDGE_MIN_RATIO = 0.78;
/**
 * **상한. 1 을 넘길 수 없다.** 이 상수가 이 파일에서 가장 중요한 한 줄이다 — 재질이 판정
 * 반경 밖으로 한 픽셀이라도 나가면 "밟으면 아픈 곳"이 화면에서 거짓말을 한다. `drawHazardZone`
 * 이 그리는 정확한 원과 안쪽 립이 진짜 경계이고, 재질은 언제나 그 **안쪽**에서만 논다.
 */
export const EDGE_MAX_RATIO = 0.985;
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
  return EDGE_MAX_RATIO - span * sat(n);
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

/** 장판 하나에 놓는 흐름 로브 수. 이 이상은 화면에서 구별되지 않으면서 비용만 는다. */
export const LOBE_COUNT = 5;

/**
 * 로브 배치(정적 — 부팅 시 한 번). **로브는 전부 판정 반경 안에 완전히 들어간다**:
 * `|중심| + r ≤ radius * EDGE_MAX_RATIO` 를 구성적으로 만족시킨다.
 */
export function lobeAt(seed: number, i: number, radius: number): HazardLobe {
  const ang = hash3(seed, i, 0, 1) * TAU;
  // 중심 거리는 반경의 0~52%, 로브 반지름은 나머지 여유의 40~92% — 합이 상한을 넘지 못한다.
  const dist = radius * 0.52 * hash3(seed, i, 0, 2);
  const room = radius * EDGE_MAX_RATIO - dist;
  const r = room * (0.4 + 0.52 * hash3(seed, i, 0, 3));
  return {
    cx: Math.cos(ang) * dist,
    cy: Math.sin(ang) * dist,
    r,
    bright: 0.35 + 0.65 * hash3(seed, i, 0, 4),
    phase: hash3(seed, i, 0, 5) * TAU,
  };
}

/** 로브가 도는 속도(프레임당 라디안). 로브마다 부호·크기가 달라야 흐름으로 읽힌다. */
export function lobeSpin(seed: number, i: number): number {
  return (hash3(seed, i, 0, 6) - 0.5) * 0.018;
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
 * 티어·게이트 → 장판 하나의 입자 수. `particles: 'off'` 면 0(접근성·저사양에서 통째로 사라진다).
 */
export function moteBudget(tier: QualityTier, gates: EffectGates): number {
  if (gates.particles === 'off') return 0;
  if (gates.particles === 'min') return 3;
  return tier === 'low' ? 0 : tier === 'med' ? 5 : 10;
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

// ---------------------------------------------------------------------------
// 예산 — 오염 모드는 반경 100 짜리 셀이 화면에 여럿 깔린다
// ---------------------------------------------------------------------------

/**
 * 한 프레임에 **재질을 붙일 장판 수 상한**. `MAX_DECORATED_HAZARDS`(12)보다 작게 둬서 재질
 * 집합이 장식 집합의 진부분집합이 되게 한다 — 재질만 있고 빗금이 없는 장판이 생기면 색 외
 * 채널이 사라진 것처럼 보이기 때문이다.
 *
 * 상한을 넘는 장판은 팩토리가 **빈 배열**을 돌려주고, 그러면 `HazardHost` 는 그 장판을 추적조차
 * 하지 않는다(Map 성장 0 · 매 프레임 호출 0). 채움·테두리는 그대로라 장판이 안 보이는 일은 없다.
 */
export const MAX_FIELD_MATERIALS = 10;
