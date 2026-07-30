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
import { HAZARD_SQUASH_Y, bandPolygon, edgePolygon, quantizeTick } from './entity/hazardShape.js';

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
    fillAlpha: harmful ? FILL_ALPHA_HARMFUL : FILL_ALPHA_HINDER,
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
/**
 * 채움 폴리곤 꼭짓점 **하한**. 아래 {@link hazardFillPoints} 가 정본이다.
 */
export const FILL_POINTS = 16;

/**
 * 변 길이를 일정하게 유지하기 위한 목표 변 길이(px).
 *
 * ## 왜 고정 개수가 틀렸나 (3차 반려 MAJOR-6)
 * 3차는 `FILL_POINTS = 16` 고정이었다. 반경 200 장판에서 변 길이가 78px 이라 화면에서 그대로
 * **16각형**으로 읽혔다("여전히 평면 채움 + 16각 윤곽"). 그런데 개수를 통째로 올리면 작은
 * 오염 셀 41장이 값을 함께 물어야 한다 — 그쪽은 이미 변 길이가 39px 이라 올릴 이유가 없다.
 *
 * 그래서 개수가 아니라 **변 길이**를 상수로 잡는다: 비용은 둘레(∝반경)에 비례해 붙고, 큰
 * 장판만 촘촘해진다. 20px 는 1280×720 에서 곡선으로 읽히는 상한이다.
 */
const FILL_EDGE_PX = 20;
/** 채움 꼭짓점 상한(성능 방어선). 반경 130 이상은 여기서 묶인다. */
const FILL_POINTS_MAX = 40;

/**
 * 이 반경에 쓸 채움 폴리곤 꼭짓점 수. **4의 배수로 맞춘다** — 예열 윤곽(36점)과 활성 윤곽이
 * 같은 함수에서 나왔음을 각도 대조로 증명하는 테스트가 `gcd` 를 4 로 보기 때문이고, 실용적으로도
 * 사분점이 정렬돼 있어야 두 실루엣이 겹칠 때 어긋난 인상이 안 생긴다.
 */
export function hazardFillPoints(radius: number): number {
  const want = Math.round(((Math.PI * 2 * radius) / FILL_EDGE_PX) / 4) * 4;
  return Math.max(FILL_POINTS, Math.min(FILL_POINTS_MAX, want));
}
/**
 * 경계선 알파 배율. 유기 폴리곤은 완전한 원보다 **낮은 밝기로 같은 가독성**을 낸다(눈은 직선·
 * 정원 같은 인공 형태를 배경으로 흘려보내고 불규칙 윤곽에 더 붙는다). 밝기 총량 예산(§2-4)에
 * 대한 이 레인의 주된 순감 항목이다.
 */
export const BOUNDARY_ALPHA_SCALE = 0.76;
/** 바깥 글로우 링 알파 배율(§2-4 순감). */
export const GLOW_ALPHA_SCALE = 0.7;

/** 빗금 간격(px). 반경이 커져도 선 개수가 선형으로만 늘도록 상한과 함께 쓴다. */
const HATCH_SPACING = 18;
/**
 * 장판 하나당 빗금 선 개수 상한(성능 방어선). 16 → 7 → **5**.
 *
 * 6차 반려 MAJOR-1: 5차에도 이 45° 직선 격자가 **41/41 셀에서 가장 강한 내부 무늬**였다(기준선은
 * 12셀). 알파만 내렸을 뿐 셀당 밀도는 그대로였기 때문이다. 개수를 함께 줄여 재질 뒤로 물린다 —
 * 간격은 `span / HATCH_MAX_LINES` 로 파생되므로 개수를 줄이면 **전면을 덮는 성질은 유지되고**
 * (3차 반려 MAJOR-4 의 좌상단 편중이 돌아오지 않는다) 밀도만 내려간다.
 */
export const HATCH_MAX_LINES = 5;
/**
 * 빗금 알파. 0.55 → 0.42 → **0.30**. "45° 직선 격자가 화면에서 가장 강한 무늬이고 직선 격자는
 * 정의상 재질이 아니다"는 지적(6차에도 유지된 MAJOR-1)에 대한 응답이자 §2-4 순감 항목이다.
 * 색 외 채널이라 **지우지는 않는다** — 존재는 유지하되 재질보다 뒤로 물린다.
 *
 * 이 교환을 명시한다: 접근성(색 외 채널이 전 셀에 균일하게 있다)을 위해 채택한 표현이 재질보다
 * 강했다. 지우면 색약 사용자의 "아프다" 채널이 사라지고, 그대로 두면 재질이 안 보인다. 개수와
 * 알파를 함께 내려 **존재는 남기고 지배력만 뺀다**가 이 레인의 결론이다.
 */
export const HATCH_ALPHA = 0.3;

/**
 * 셀당 빗금 **잉크 예산**(선 개수 × 알파). 5차 2.94(7 × 0.42) → 6차 **1.50**(5 × 0.30).
 *
 * ## 왜 이 상수가 필요한가 (6차 뮤테이션이 드러낸 구멍)
 * §2-4 가산 회계(`hazardShape.additiveLayerSpecs`)는 **재질 스프라이트 겹만** 센다. 빗금·채움·
 * 경계는 `drawHazardZone` 이 `Graphics` 로 그리므로 그 모델에 항이 없다 — 실제로 6차 뮤테이션에서
 * `HATCH_MAX_LINES` 를 5 → 7 로 되올렸는데 **어떤 테스트도 빨개지지 않았다.**
 *
 * 두 축(개수·알파)의 **곱**에 천장을 두면 한쪽을 올릴 때 다른 쪽을 내려야 하므로, 상수를 그대로
 * 다시 적는 항진이 아니라 예산이 된다. 이 채널은 색 외 채널이라 0 으로 갈 수 없고(접근성),
 * 재질을 이기지도 않아야 한다 — 그 두 요구 사이의 폭이 곧 이 값이다.
 */
export const HATCH_INK_BUDGET = 1.5;
/**
 * 맥동 립이 놓이는 반경 비율. **정확히 1** — 이것이 판정 반경의 울타리다.
 * 물질 윤곽(`EDGE_MAX_RATIO` = 0.96)보다 밖, 글로우({@link GLOW_MIN_RATIO})보다 안이다.
 */
export const LIP_RATIO = 1;
/** 맥동 립 두께. 세 선 중 유일하게 흔들리지 않으므로 얇아도 읽힌다. */
export const LIP_WIDTH = 2;
/**
 * 립 알파의 바닥값과 맥동 진폭.
 *
 * ## 왜 내렸는가 (5차 반려 — §2-5)
 * 립은 **판정 반경의 울타리**라 지울 수 없고 계약 §2-5 가 명시적으로 허용한 정원이다. 그런데
 * 4차에 립이 `radius - strokeWidth` → **정확히 `radius`** 로 올라오면서 더 또렷해지고, 같은
 * 셀의 가산 림(4차에 0.34 → 0.6)과 거품 막(작은 링)까지 겹쳐 **한 자리에 정원 윤곽 여러 줄**이
 * 됐다. 겹친 셀끼리 흰 호가 교차하는 인상의 주 원인이 이 셋이다.
 *
 * 지우는 대신 **지배력만 뺀다**: 0.45~0.75 → 0.24~0.39. 폭은 그대로 2px 다 — 얇은 선의 알파를
 * 내리는 것이 굵은 선을 지우는 것보다 판정 경계 가독성을 덜 깎는다(선의 위치는 변하지 않고
 * 대비만 낮아진다). 나머지 둘은 각자의 자리에서 함께 내려간다
 * ({@link file://./entity/hazardShape.ts} `HAZARD_RIM_ALPHA` · `hazardTexture.bubbleLuminance`).
 */
export const LIP_ALPHA_BASE = 0.24;
export const LIP_ALPHA_PULSE = 0.15;
/** 바깥 글로우 대역(판정 반경 대비). **립보다 확실히 바깥**이어야 세 선이 안 꼬인다. */
export const GLOW_MIN_RATIO = 1.02;
export const GLOW_MAX_RATIO = 1.06;

/**
 * 경계선 두께(px). 반경에 따라 얇아진다.
 *
 * ## 왜 상수가 아닌가
 * 굴곡의 크기는 **반경에 비례**하지만(대역 폭 × 반경) 선 두께가 고정이면, 작은 장판에서
 * 비율이 뒤집혀 **흔들림이 자기 선 안에 묻힌다** — 2차 반려 CRIT-2 가 정확히 그 현상이었다
 * (진폭 2.41px vs 두께 4px). 반경 60 에서 대역 폭은 7.8px 이므로 4px 선으로는 1.95배밖에 안 된다.
 *
 * 두께를 반경에 묶으면 **모든 크기에서 진폭 대 두께 비가 3 이상**으로 유지된다. 큰 장판에서는
 * `strokeWidth` 가 상한이라 색 외 채널(피해=굵게 / 방해=얇게)도 그대로 남는다.
 */
export function boundaryWidth(radius: number, strokeWidth: number): number {
  return Math.min(strokeWidth, Math.max(1.2, radius * BOUNDARY_WIDTH_PER_RADIUS));
}

/**
 * 반경 대비 경계선 두께 계수. 대역 폭의 약 3분의 1이라 비율 3 이 구조적으로 성립한다.
 *
 * `EDGE_MIN_RATIO` 를 0.83 → 0.88 로 올려(3차 반려 MINOR — 위험지대 과소 표시 17% → 12%)
 * 대역 폭이 0.13r → 0.08r 로 좁아졌으므로 여기도 함께 내렸다. **둘은 같이 움직여야 한다** —
 * 한쪽만 만지면 진폭이 자기 선 안에 묻히던 2차 반려 CRIT-2 가 그대로 돌아온다.
 */
const BOUNDARY_WIDTH_PER_RADIUS = 0.02;
/** 빗금이 흐르는 속도(프레임당 px). 흐름이 "여기 살아 있다"를 만든다. */
const HATCH_FLOW = 0.35;

/** 예열 점선의 세그먼트 수(원주를 몇 조각으로 끊는가). */
const DASH_SEGMENTS = 18;
/** 점선이 도는 속도(프레임당 라디안). */
const DASH_SPIN = 0.012;
/** 수렴 예고 링의 주기(프레임). 반경이 밖→안으로 줄며 "곧 켜진다"를 만든다. */
const CONVERGE_PERIOD = 60;
/**
 * 수렴 예고 링 알파. 0.5 → 0.34. 예열 컷에서 동심 윤곽이 너무 많다는 지적(3차 반려 MAJOR-6)에
 * 대한 응답이자 §2-4 순감 항목이다. **지우지는 않는다** — "곧 온다"의 리듬이고 색 외 채널이다.
 */
const CONVERGE_ALPHA = 0.34;
/**
 * 수렴 링의 꼭짓점 배율(채움 점 수 대비). 6차 반려 MINOR-1.
 *
 * 5차는 점선 폴리곤(`DASH_SEGMENTS * 2` = **36점 고정**)을 재사용했다. 그 개수는 점선 조각
 * 수에서 나온 값이라 반경과 무관하고, 채움 점 수 상한(`FILL_POINTS_MAX` = 40)도 큰 장판에서는
 * 각도 해상도 9° 에 머문다 — 얇은 링 하나는 주변이 매끄러울수록 꼭짓점이 도드라진다.
 *
 * **왜 채움 점 수를 올리지 않고 링만 올리는가**: 채움은 반경 200 에서 41셀이 값을 함께 물지만
 * (겹이 {@link FILL_RINGS} 장이다) 이 링은 예열 경로의 `poly` **하나**다. 비용이 붙는 자리와
 * 각져 보이는 자리가 다르므로 상한도 달라야 한다.
 */
const CONVERGE_POINT_SCALE = 2;

/**
 * 활성 채움 알파(위험 / 방해). {@link visualHeat} 가 열을 되읽는 기준값이다.
 *
 * ## 0.3 → 0.24 (6차 반려 CRITICAL-1 의 두 번째 처방)
 * 판정 장면(톡사르)의 오염 셀에서 **원판 밝기의 지배항은 재질이 아니라 이 채움**이었다. 재질
 * 겹의 알파(0.158 · 0.151)는 그 위에서 대비를 만들 수 없다 — 즉 재질이 안 보이는 원인의 절반은
 * 재질이 약한 것이 아니라 **바탕이 밝은 것**이다. 채움을 내려 재질(특히 감산 겹
 * `sporeShade`)이 올라올 자리를 만든다.
 *
 * 20% 만 내린다. 채움은 "지금 아프다"의 주 신호이고, 색 외 채널(빗금·경계·립·글로우)은 전부
 * 제자리에 있으므로 이 정도는 §2-2 안이다. 더 내리면 난색 자체가 흐려져 색=성질 규칙이 약해진다.
 */
export const FILL_ALPHA_HARMFUL = 0.24;
export const FILL_ALPHA_HINDER = 0.22;

/** 빗금 알파가 차오르기 시작·완료하는 열. */
const HATCH_HEAT_ON = 0.35;
const HATCH_HEAT_FULL = 0.85;
/** 점선↔실선 교차 페이드 구간. 두 알파가 같아지는 지점이 중간값(≈0.55)이다. */
const DASH_CROSS_LO = 0.35;
const DASH_CROSS_HI = 0.75;

/** [0,1] 로 자른다. */
function sat(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 구간 [a,b] 를 [0,1] 로 펴는 선형 램프. */
function ramp(v: number, a: number, b: number): number {
  return b === a ? (v < a ? 0 : 1) : sat((v - a) / (b - a));
}

/**
 * 호스트가 채움 알파에 실어 보낸 **열**(0~1)을 되읽는다.
 *
 * ## 왜 이런 우회를 하는가
 * 열의 소유자는 `hazardHost` 이고({@link file://./entity/hazardHost.ts} 의 `HazardZone.heat`),
 * 그 값을 재질에게는 직접 넘기지만 **이 함수에는 넘길 통로가 없다** — `drawHazardZone` 의 호출
 * 지점이 호스트 안이고, 인자를 늘리면 소유권 밖 파일을 고쳐야 한다. 대신 호스트는 이미
 * `fillAlpha` 를 `base × heat` 로 밀어 주고 있으므로, 기준값으로 나누면 열이 정확히 복원된다.
 *
 * 예열(`dashed`)은 정의상 열 0 이다 — 호스트가 `fillAlpha === 0` 경로에서 원본을 그대로 넘긴다.
 *
 * ⚠️ 식는 쪽(활성→예열)에는 연속이 없고, **그것이 의도다**: 여운은 재질(안쪽 질감)에만 실리고
 * 판정을 알리는 채널은 활성 플래그와 동시에 끊긴다(`hazardShape.HEAT_FALL_PER_SEC` 주석 정본).
 * 여운이 "아직 아프다"로 읽히면 안 된다.
 */
export function visualHeat(v: HazardVisual): number {
  if (v.dashed) return 0;
  const base = v.harmful ? FILL_ALPHA_HARMFUL : FILL_ALPHA_HINDER;
  return base <= 0 ? 1 : sat(v.fillAlpha / base);
}

/**
 * 유기 윤곽 위를 도는 점선 한 바퀴. 예열 경로와 활성 교차 페이드가 **같은 함수**를 쓴다 —
 * 두 그림이 정확히 포개져야 전이가 형태의 도약이 아니게 된다.
 */
function drawDashRing(
  g: HazardCanvas,
  x: number,
  y: number,
  poly: number[],
  spin: number,
  color: number,
  width: number,
  alpha: number,
): void {
  if (alpha <= 0) return;
  const n = DASH_SEGMENTS * 2;
  const rot = Math.round((spin / (Math.PI * 2)) * n);
  for (let i = 0; i < DASH_SEGMENTS; i++) {
    // 꼭짓점 두 개마다 한 조각씩 그리고 한 조각을 건너뛴다 → 점선.
    const a = (((rot + i * 2) % n) + n) % n;
    const b = (a + 1) % n;
    g.moveTo(x + (poly[a * 2] ?? 0), y + (poly[a * 2 + 1] ?? 0))
      .lineTo(x + (poly[b * 2] ?? 0), y + (poly[b * 2 + 1] ?? 0))
      .stroke({ color, width, alpha });
  }
}

/**
 * 그리기 대상의 최소 계약(PixiJS `Graphics` 하위 집합). 테스트가 호출 기록만 모으는 스텁을
 * 넘길 수 있도록 좁혀 뒀다 — 렌더 코드가 실제로 무엇을 그렸는지 GL 없이 검증하기 위해서다.
 */
export interface HazardCanvas {
  circle(x: number, y: number, radius: number): HazardCanvas;
  arc(x: number, y: number, radius: number, start: number, end: number): HazardCanvas;
  moveTo(x: number, y: number): HazardCanvas;
  lineTo(x: number, y: number): HazardCanvas;
  /**
   * 폴리곤(flat `[x0,y0,x1,y1,...]`). 유기적 실루엣의 유일한 수단이다.
   *
   * ⚠️ `close` 를 **반드시 넘겨라.** Pixi 의 `poly` 는 `polygon.closePath = close` 를 그대로
   * 대입하므로 생략하면 `undefined`(거짓)가 되고, `stroke` 에서 **마지막 꼭짓점과 첫 꼭짓점
   * 사이가 벌어진다** — 경계선에 틈이 나는데 채움에서는 안 드러나 놓치기 쉽다.
   */
  poly(points: number[], close?: boolean): HazardCanvas;
  fill(style: { color: number; alpha: number }): HazardCanvas;
  stroke(style: { color: number; width: number; alpha: number }): HazardCanvas;
}

/**
 * 장판 위치에서 뽑는 형태 시드. **호출 시그니처를 늘리지 않기 위한 장치다** — 장판마다 다른
 * 실루엣이 필요한데 `drawHazardZone` 은 엔티티 id 를 받지 않고, 그 인자를 늘리면 호출측
 * (`hazardHost.ts`, 다른 레인 소유)을 건드려야 한다.
 *
 * 4px 격자로 양자화한다: 해저드는 스폰 위치에 고정되므로 값이 안정적이고, 부동소수 미세
 * 흔들림이 실루엣을 떨게 만들지 않는다.
 */
function shapeSeed(x: number, y: number): number {
  return Math.imul(Math.round(x / 4) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(y / 4) | 0, 0x165667b1);
}

/** 폴리곤 점들을 원점 기준에서 (x,y) 로 옮긴 새 배열. `edgePolygon` 결과는 로컬 좌표다. */
function translated(poly: number[], x: number, y: number): number[] {
  const out: number[] = new Array<number>(poly.length);
  for (let i = 0; i < poly.length; i += 2) {
    out[i] = (poly[i] ?? 0) + x;
    out[i + 1] = (poly[i + 1] ?? 0) + y;
  }
  return out;
}

/**
 * 원근 압축 계수(세로 / 가로) — 정본은 {@link file://./entity/hazardShape.ts} 다(재질 겹도 같은
 * 값을 써야 채움과 재질이 같은 타원 안에 머문다). **물질 겹에만** 적용한다.
 *
 * ## 왜 필요한가 (6차 반려 MAJOR-2)
 * 5차까지 채움·경계·립에 원근 압축이 **0** 이었다. 압축을 쓰는 것은 환경 기여(`ambient` 0.88)와
 * 예열 고조(`charge` 0.92)뿐이라, 장판 본체는 위에서 정면으로 내려다본 **평면 원** 그대로였다.
 * AAA 대조(Hades 용암 웅덩이 · Returnal 산성 지대)는 웅덩이 자체를 세로로 눌러 바닥에 누인다.
 *
 * ## 왜 립에는 걸지 않는가 (처방에서 의도적으로 하나를 뺀다)
 * 맥동 립은 **판정 반경의 울타리**다(`LIP_RATIO === 1`). 세로로 누르면 화면이 위·아래 방향의
 * 위험 범위를 실제보다 **작게** 말한다 — 물질 윤곽이 이미 최대 12% 과소 표시하는 것을 립이
 * 정확히 보정하는 구조인데(`hazardShape.EDGE_MIN_RATIO` 주석 정본), 립까지 누르면 보정자가
 * 사라지고 §2-2("예쁨이 가독성을 이기면 실패")를 깬다. 그래서 압축은 물질(채움·경계·점선·수렴
 * 링)까지이고, 립은 정원으로 남는다. 결과적으로 물질이 립 안쪽에 **눌려 앉은** 형태가 되어
 * 원근과 울타리가 동시에 성립한다.
 *
 * 바깥 글로우 링도 제외다 — 대역이 [1.02, 1.06] 이라 0.94 를 곱하면 세로에서 립 안쪽으로
 * 내려와 세 선의 대역 분리(2차 반려 CRIT-3)가 깨진다.
 */
export { HAZARD_SQUASH_Y };

/** 폴리곤의 y 성분만 {@link HAZARD_SQUASH_Y} 로 누른 새 배열(원점 기준 로컬 좌표 전용). */
function squashY(poly: number[]): number[] {
  const out: number[] = new Array<number>(poly.length);
  for (let i = 0; i < poly.length; i += 2) {
    out[i] = poly[i] ?? 0;
    out[i + 1] = (poly[i + 1] ?? 0) * HAZARD_SQUASH_Y;
  }
  return out;
}

/** 폴리곤을 원점 기준으로 배율 조정해 (x,y) 로 옮긴 새 배열. */
function scaledTo(poly: number[], x: number, y: number, k: number): number[] {
  const out: number[] = new Array<number>(poly.length);
  for (let i = 0; i < poly.length; i += 2) {
    out[i] = (poly[i] ?? 0) * k + x;
    out[i + 1] = (poly[i + 1] ?? 0) * k + y;
  }
  return out;
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
 * ## `allowDecor` 는 더 이상 그림을 바꾸지 않는다 (2차 반려 MAJOR-1)
 * 예전에는 이 인자가 빗금·글로우·수렴 링을 켜고 껐고, 호출측이 프레임당
 * {@link MAX_DECORATED_HAZARDS}(12)개까지만 true 를 넘겼다. 그런데 실제 판정 장면인 톡사르는
 * 장판이 **41개**다 — 나란히 붙은 같은 오염 셀 중 12개만 빗금을 갖는다. 관객은 그것을 예산으로
 * 읽지 않고 **렌더링 버그**로 읽고, 색약 사용자에게는 **셀마다 정보량이 달라지는** 접근성
 * 회귀가 된다(빗금은 "아프다"의 색 외 채널이다).
 *
 * 그래서 표현을 전 셀 공통으로 통일하고, 대신 셀당 비용을 낮췄다(빗금 16→7줄·알파 0.55→0.42).
 * 인자는 호출측 호환을 위해 남겨 두었고 **예약 상태**다. 비용을 다시 깎아야 하면 셀을 갈라
 * 다른 그림을 그리지 말고, 겹 단위로 낮추는 재질 쪽 LOD(`hazardShape.hazardLod`)를 써라.
 */
export function drawHazardZone(
  g: HazardCanvas,
  x: number,
  y: number,
  radius: number,
  v: HazardVisual,
  frameTick: number,
  _allowDecor = true,
): void {
  // 형태 시드는 위치에서, 애니메이션 위상은 양자화한 프레임에서 — 둘 다 인자를 늘리지 않고
  // 장판별로 다른 실루엣과 저비용 요동을 얻기 위한 장치다.
  const seed = shapeSeed(x, y);
  const qTick = quantizeTick(frameTick);
  const points = hazardFillPoints(radius);
  // 호스트가 채움 알파에 실어 보낸 열을 되읽는다 — 아래 `visualHeat` 주석이 정본이다.
  const heat = visualHeat(v);

  if (v.dashed) {
    // ── 예열 ──────────────────────────────────────────────────────────────
    const spin = frameTick * DASH_SPIN;
    // 점선은 **활성과 같은 유기 윤곽 위를 달린다**(2차 반려 MAJOR-2).
    //
    // 2차까지 이 경로는 `arc(x, y, radius, ...)` 18조각이라 **수학적으로 완전한 원**이었다.
    // "예열이 가장 오래 보이는 상태"라고 스스로 논증해 놓고 그 상태의 경계만 안 고쳤던 것이다.
    // 지금은 활성 채움과 **같은 시드·같은 대역**의 폴리곤을 따라 조각을 끊으므로, 예열에서
    // 활성으로 넘어갈 때 실루엣이 이어진다(전이가 형태의 도약이 아니게 된다).
    const dashPoly = squashY(edgePolygon(seed, radius, qTick, 1, 1, DASH_SEGMENTS * 2));
    drawDashRing(g, x, y, dashPoly, spin, v.color, v.strokeWidth, v.strokeAlpha);
    // 수렴 링: 바깥에서 안으로 줄어들며 반복 — 남은 시간이 아니라 "곧 온다"는 리듬을 준다.
    // 유기 폴리곤이고(§2-5), `decorated` 조건이 없다(전 셀 공통 — MAJOR-1).
    //
    // ⚠️ 점선 폴리곤(36점 고정)을 재사용하지 않는다 (6차 반려 MINOR-1). 점선의 점 수는 조각
    // 개수(`DASH_SEGMENTS`)에서 나온 값이라 반경과 무관하고, 반경 200 장판에서 변 길이가 35px
    // 이라 수렴 링이 **각진 다각형**으로 읽혔다. 채움과 같은 반경 파생 점 수를 쓰면 사라진다.
    const t = (frameTick % CONVERGE_PERIOD) / CONVERGE_PERIOD;
    const convergePoly = squashY(
      edgePolygon(seed, radius, qTick, 1, 1, points * CONVERGE_POINT_SCALE),
    );
    g.poly(scaledTo(convergePoly, x, y, 1 - 0.45 * t), true).stroke({
      color: v.accent,
      width: 2,
      alpha: CONVERGE_ALPHA * (1 - t),
    });
    // ⚠️ **예열에는 정원 립이 없다.** 3차가 여기에 새로 하나 넣었고, 그 결과 예열 컷의 동심
    // 윤곽이 2차보다 늘었다(3차 반려 MAJOR-6: 흰 정원 3 + 각진 수렴 폴리곤 3 + 붉은 점선 +
    // 플레이어 시안 링). 원 하나가 문제가 아니라 **겹치는 장판마다 한 줄씩 쌓이는 구조**가
    // 문제였다 — 오염 셀은 서로 겹치므로 셀 수만큼 정원이 포개진다.
    //
    // 예열은 정의상 **아직 아프지 않은 상태**라 판정 울타리의 정밀도 요구가 활성보다 낮고,
    // 점선 자체가 같은 시드의 유기 윤곽 위를 달려 위치를 이미 알려 준다. 활성에서만 립을 둬서
    // "정원 = 지금 아프다"가 오히려 더 강한 신호가 된다(색 외 채널이 하나 늘어난 셈이다).
    return;
  }

  // ── 활성 ────────────────────────────────────────────────────────────────
  // 소프트 엣지 **유기 폴리곤** 채움. 두 결함을 한 번에 푼다:
  //  ① 겹침 — 겹 알파는 누적이 정확히 `fillAlpha` 에 수렴하도록 역산한다(1-(1-p)^N = fillAlpha).
  //     바깥 밴드는 겹이 하나뿐이라 알파가 p 이고, 두 셀이 겹쳐도 2p < fillAlpha 라 이음매가 없다.
  //  ② 실루엣 — 완전한 원이 아니라 노이즈로 흔든 폴리곤이다. **이것이 전 장판에 적용되는
  //     유일한 유기 신호**이고, 그래서 재질(LOD)이 낮은 장판도 정체성이 같다. 개체 상한으로
  //     재질을 빼던 1차 설계에서 "같은 해저드가 두 스타일"로 보이던 결함이 여기서 사라진다.
  // 물질은 세로로 눌려 바닥에 누워 있다({@link HAZARD_SQUASH_Y} 주석이 정본 — 립·글로우는 제외).
  const fillPoly = squashY(edgePolygon(seed, radius, qTick, 1, 1, points));
  const perRing = 1 - Math.pow(1 - v.fillAlpha, 1 / FILL_RINGS);
  for (let i = 0; i < FILL_RINGS; i++) {
    const k = 1 - (FILL_SOFT_SPAN * i) / (FILL_RINGS - 1 || 1);
    g.poly(scaledTo(fillPoly, x, y, k), true).fill({ color: v.color, alpha: perRing });
  }

  if (v.hatch) {
    // 흐르는 빗금(45°) — **색 외 채널**이다. 원 안쪽만 그리도록 각 선의 y 범위를 원의
    // 현(chord)으로 잘라 넣는다(클리핑이 없는 Graphics 라 기하로 직접 자른다).
    //
    // **`decorated` 조건을 뗐다**(MAJOR-1). 41셀 중 12개만 빗금을 갖는 것은 나란한 같은 셀
    // 사이에 스타일 차이를 만들고, 색약 사용자에게는 **셀마다 정보량이 달라지는** 접근성
    // 회귀다. 대신 개수 상한을 16→7 로, 알파를 0.55→0.42 로 낮춰 전 셀에 깔 여유를 만들었다
    // (총 선 개수는 41×7=287 로 이전 12×16=192 와 같은 규모다). 알파를 낮춘 것은 §2-4 순감
    // 항목이기도 하다 — 이 직선 격자가 화면에서 가장 강한 무늬라는 지적을 함께 받는다.
    //
    // ⚠️ **오프셋 구간을 유효 하한에서 시작해야 한다** (3차 반려 MAJOR-4 — 3차에서 새로 생긴 회귀).
    // 3차는 `HATCH_MAX_LINES` 를 16→7 로 내리면서 루프의 시작점을 `-2r` 로 그대로 뒀다. 그러면
    // 처음 7줄만 그려지고 **모든 셀에서 좌상단만 빗금이 있고 반대쪽이 비었다**(r=200 에서 27개
    // 후보 중 7개 = 26%, o 범위 −400..−292 / 가능 −483..83). 빗금은 "아프다"의 색 외 채널이므로,
    // 셀 **간** 정보량 불균형을 없애려다 셀 **내부** 불균형을 만든 것이다.
    //
    // 유효 구간은 `chordSpan` 의 판별식에서 닫힌 형태로 나온다: (o−r)² − 2o² > 0 ⟺
    // o ∈ (−r(1+√2), r(√2−1)). 폭이 정확히 2√2·r 이므로 간격을 **폭 ÷ 상한**으로 파생시키면
    // 개수 상한을 지키면서 전면을 덮는다.
    const lo = -radius * (1 + Math.SQRT2);
    const span = radius * 2 * Math.SQRT2;
    const spacing = Math.max(HATCH_SPACING, span / HATCH_MAX_LINES);
    const flow = (frameTick * HATCH_FLOW) % spacing;
    // 빗금은 열 0.35 에서 차오르기 시작한다 — 채움·경계와 **위상을 어긋나게** 해 셋이 같은
    // 프레임에 팝인하지 않게 한다(3차 반려 MAJOR-4 의 다른 절반).
    const hatchAlpha = HATCH_ALPHA * ramp(heat, HATCH_HEAT_ON, HATCH_HEAT_FULL);
    let lines = 0;
    for (let o = lo + flow; o < lo + span && lines < HATCH_MAX_LINES; o += spacing) {
      // 45° 선: (x + o + t, y - radius + t). 원과의 교차 구간만 남긴다.
      const seg = chordSpan(o, radius);
      if (seg === null) continue;
      // y 를 물질과 같은 계수로 눌러야 빗금이 눌린 원판 **안에** 머문다(MAJOR-2). 누르지 않으면
      // 세로 최대 1.0r 까지 뻗어 압축된 채움(≤0.90r) 밖으로 삐져나온다.
      g.moveTo(x + seg.x0, y + seg.y0 * HAZARD_SQUASH_Y)
        .lineTo(x + seg.x1, y + seg.y1 * HAZARD_SQUASH_Y)
        .stroke({ color: v.color, width: 2, alpha: hatchAlpha });
      lines++;
    }
  }

  if (!v.harmful) {
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

  // ── 세 선의 대역 분리 (2차 반려 CRIT-3) ──────────────────────────────────
  // 이전에는 경계 폴리곤(95.0~97.4)·맥동 립(96.0)·글로우 링(대부분 경계선 **안쪽**)이 같은 5px
  // 안에서 원주를 따라 서로 넘나들어 **꼬인 밧줄**로 보였다. 이제 셋이 각자 겹치지 않는 대역을
  // 갖는다(@r=100): 물질 [83,96] · 립 100 · 글로우 [102,106].

  // 경계선 = **채움의 바깥 겹 그 자체**다. 별도 폴리곤을 하나 더 그리면 물질의 윤곽과 미세하게
  // 어긋난 선이 하나 더 생긴다(그게 밧줄의 세 번째 가닥이었다). 같은 배열을 stroke 해서 물질과
  // 윤곽이 정의상 일치하게 한다 — 진폭도 채움 대역 전체(0.13r)를 그대로 받아 선 두께의 3배를 넘는다.
  //
  // 점선→실선은 **교차 페이드**다(3차 반려 MAJOR-4). 열이 오르는 동안 실선이 차오르고 점선이
  // 빠지며, 두 알파가 같아지는 지점이 열 ≈0.55 다. 3차까지는 `hazardVisual(active)` 가 `dashed`
  // 를 한 프레임에 뒤집어서, 재질이 아무리 연속으로 고조해도 그 끝에 스위치가 남았다.
  const solid = ramp(heat, DASH_CROSS_LO, DASH_CROSS_HI);
  g.poly(scaledTo(fillPoly, x, y, 1), true).stroke({
    color: v.color,
    width: boundaryWidth(radius, v.strokeWidth),
    alpha: v.strokeAlpha * BOUNDARY_ALPHA_SCALE * solid,
  });
  if (solid < 1) {
    // 아직 남은 점선. 활성 윤곽과 **같은 시드·같은 대역**이라 두 그림이 정확히 포개진다.
    drawDashRing(
      g,
      x,
      y,
      squashY(edgePolygon(seed, radius, qTick, 1, 1, DASH_SEGMENTS * 2)),
      frameTick * DASH_SPIN,
      v.color,
      v.strokeWidth,
      v.strokeAlpha * (1 - solid),
    );
  }

  // 맥동 립 — **판정 반경에 정확히 놓이는 울타리**이자 색 외 채널이다. 완전한 원인 것이
  // 여기서는 의도적이고 계약 §2-5 가 명시적으로 허용한다: 유기적 물질 윤곽은 어디가 진짜
  // 반경인지 말해 주지 않으므로, 흔들리지 않는 기준선이 정확히 하나 필요하다.
  //
  // 2차까지는 `radius - strokeWidth` 였다. 물질 윤곽이 `EDGE_MAX_RATIO`(0.96)까지 올라오면서
  // 그 자리는 윤곽선과 붙어 버리므로 **정확히 `radius`** 로 옮겼다. 이제 이것이 세 대역 중
  // 가운데이고, 물질보다 밖·글로우보다 안이다.
  //
  // `decorated` 조건이 없다 — 예산은 디테일을 깎는 것이지 판정 정보를 깎는 것이 아니다.
  const pulse = 0.5 + 0.5 * Math.sin(frameTick * 0.12);
  g.circle(x, y, radius * LIP_RATIO).stroke({
    color: v.accent,
    width: LIP_WIDTH,
    alpha: (LIP_ALPHA_BASE + LIP_ALPHA_PULSE * pulse) * (v.harmful ? 1 : 0.7),
  });

  if (v.harmful) {
    // 바깥 글로우 — 멀리서도 "저기 위험"이 먼저 눈에 든다. **립보다 확실히 바깥** 대역에 둔다
    // (2차에는 `fillPoly` 를 곱해서 92.7% 각도에서 경계선 안쪽에 있었다).
    //
    // `decorated` 조건도 뗐다: 41셀 중 12개만 글로우를 갖는 것은 "같은 해저드 두 스타일"을
    // 다시 만드는 일이고, 색약 사용자에게는 셀마다 정보량이 달라진다(MAJOR-1).
    const breathe = (GLOW_MAX_RATIO - GLOW_MIN_RATIO) * pulse;
    g.poly(
      translated(
        bandPolygon(seed, radius, qTick, GLOW_MIN_RATIO + breathe, GLOW_MAX_RATIO + breathe, points),
        x,
        y,
      ),
      true,
    ).stroke({
      color: v.color,
      width: 2,
      alpha: (0.18 + 0.14 * pulse) * GLOW_ALPHA_SCALE,
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
