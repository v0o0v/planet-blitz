/**
 * 지형광 레이어 (슬롯 `floor` — 지형 바닥 위·엔티티 아래).
 *
 * 지형 필드의 등고선을 따라 **흐르는 띠**를 그린다. 무엇이 흐르는지는 행성마다 다르고
 * ({@link file://./themes/} 의 테마 데이터), 여기 있는 것은 그 띠를 뽑고 놓고 합성하는
 * **메커니즘**뿐이다.
 *
 * ## 뼈대 — 마칭 스퀘어즈 등고선
 * 띠는 블롭이 아니라 {@link terrainFieldAt} 의 {@link UPPER_THRESHOLD} 등고선을 따라 흐른다.
 * 타일 격자 위에서 마칭 스퀘어즈로 등고선을 뽑으면 **인접 셀이 공유 변에서 정확히 같은
 * 교차점**을 낸다(같은 두 꼭짓점 값으로 같은 선형보간을 하므로 부동소수 비트까지 동일).
 * 그래서 세그먼트가 끝점을 공유하며 사슬로 이어지고, 화면에서 **강처럼 연결돼** 보인다.
 * 이 성질은 눈이 아니라 단위 테스트로 잠근다({@link marchCorners} 연결성 테스트).
 *
 * 방사형 블롭으로 흩뿌린 초기 구현은 이 연결성이 없어 "주황 얼룩"으로 읽혔고, 픽셀 기여도
 * 실측에서 애니메이션 노이즈 바닥과 구별되지 않았다. **형태가 연속이어야 한다**는 것이
 * 이 파일의 첫 번째 계약이다.
 *
 * ## 겹과 합성 순서 — 순서는 물리다
 * 각 세그먼트는 여러 겹으로 그려지고, 그 순서는 {@link TERRAIN_LIGHT_STAGES} 가 고정한다.
 * **곱연산 겹이 넓은 가산 겹보다 먼저 칠해지면 화면에서 통째로 사라진다** — 곱연산의 자취가
 * 가산의 부분집합일 때 나중에 칠해진 가산이 어둠을 되돌리기 때문이다. 이 실패는 스프라이트
 * 속성(`visible`·`alpha`)으로는 원리적으로 관측되지 않아 단위 테스트가 전부 그린인 채로
 * 화면에서만 드러났다. 그래서 순서를 {@link TerrainLightLayer.layerOrder} 로 노출해 잠그고,
 * 테마에게는 순서를 주지 않는다(어느 겹을 켜는지만 고른다).
 *
 * 좁은 겹이 넓은 겹 안에 갇히는 것도 같은 종류의 실패다. 자취(오프셋 ± 폭/2)의 포함 관계는
 * `validateTerrainLightTheme` 이 테마 단계에서 막는다.
 *
 * ## 조명
 * 광원 방향은 **{@link EnvTheme.light} 공유 필드**에서 온다. 데칼 레이어가 같은 값을 읽으며,
 * 한쪽만 고치면 화면에 태양이 둘이 된다(`tests/envLightAgreement.test.ts` 가 잠근다).
 * 이 레이어는 등고선을 따라 전방위로 도는 띠라 좌우 성분을 쓰면 조명이 기울어 보이므로,
 * 공유 광원을 수직축에 투영해 방향만 취한다({@link verticalLightDir}).
 *
 * 경계면이 광원을 마주보면 림, 등지면 AO 강화 + 캐스트 섀도다. 두 신호를 **여집합**으로
 * 갈라야 방향 정보가 남는다 — 둘 다 같은 항에 비례시키면 가장 밝은 면이 동시에 가장 짙게
 * 그늘져 서로를 상쇄하고, 화면의 방향 정보가 0비트가 된다.
 *
 * ## 세기 — "꺼진 경계"를 만들지 않는다
 * 저주파 지역 필드로 일부 구간만 승격시키되, 승격 못 한 구간을 0 으로 두면 안 된다.
 * 관객은 "어떤 가장자리는 살아 있고 어떤 건 아니다"를 미학적 선택이 아니라 **누락**으로
 * 읽는다. 그래서 모든 경계에 하한(`intensity.emberMin`)을 깔고, 그 위에 지역 필드와
 * **다른 스케일·다른 시드**의 노이즈로 강약을 싣는다. 균일하게 다 켜면 반대로 촌스러워지므로
 * 알파와 **띠 폭**을 둘 다 세기에 비례시킨다.
 *
 * ## 결정론(ADR-0005)
 * - `Math.random` 없음. 공간 필드는 전부 {@link file://./noise.ts} + `ctx.seed`.
 * - **맥동 위상은 `EnvFrame.tick`(보간 sim 틱)의 순수 함수**({@link emitterPulse}). 벽시계
 *   (`performance.now`)를 쓰면 탭 백그라운드 복귀·프레임 스킵에서 밝기가 튄다. `f.dt` 는 이
 *   레이어에서 아예 안 쓴다.
 * - 발광은 **월드 좌표에 붙는다**. 카메라가 돌아오면 같은 자리가 같은 밝기다.
 *
 * ## 성능
 * - 텍스처 4장을 테마당 한 번만 굽는다(매 프레임 generateTexture 0).
 * - 등고선 추적은 **타일 격자를 넘을 때만**(카메라 64px 이동마다) 돌고, 그 사이 프레임은
 *   레이어 position 만 움직인다. 꼭짓점 필드는 행 버퍼 두 줄로 재사용해 셀당 4회가 아니라
 *   **꼭짓점당 1회**만 평가한다.
 * - AO·림·캐스트 섀도는 맥동하지 않으므로 **재구성에서 한 번만** 배치하고 매 프레임 루프에서
 *   뺀다. 프레임마다 만지는 것은 헤일로·코어·기둥뿐.
 * - 매 프레임 할당 0(레코드·스프라이트는 풀이 자라는 순간에만 생성).
 *
 * ## 게임플레이 가독성
 * 밝기를 올리되 ①흰색 포화 금지 ②밝은 면적을 **좁게** ③화면 대부분은 여전히 어둡게
 * (황혼 곱연산). 밝은 띠가 좁고 배경이 어두우면 전경 엔티티가 오히려 더 잘 보인다.
 * 황혼은 `floor` 슬롯이라 **지형만** 누르고 적·탄·젬은 건드리지 않는다 — 화면 전체를
 * 어둡게 하는 그레이딩·시차가 대체할 수 없는 유일한 성질이고, 그래서 무드 장치가 아니라
 * **가독성 장치**다.
 */

import { Container, Graphics, Sprite, Texture, type Renderer } from 'pixi.js';
import type { EnvContext, EnvFrame, EnvLayer } from './types.js';
import { fade, fbm, hash3 } from './noise.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../app.js';
import {
  DISPLAY_TILE,
  NOISE_SCALE,
  NOISE_SCALE_FINE,
  UPPER_THRESHOLD,
  terrainFieldAt,
} from '../autotile.js';
import { graphicsTierController } from '../graphicsRuntime.js';
import { effectGates, type EffectGates, type QualityTier } from '../qualityTier.js';
import { graphicsSettings, type GraphicsSettings } from '../graphicsSettings.js';
import type { EnvTheme } from './theme.js';
import { themeFor } from './themes/index.js';
import {
  terrainLightOrder,
  verticalLightDir,
  type TerrainLightLayerId,
} from './contracts/terrainLight.js';

// autotile 의 필드 상수는 **import 로 받는다**. 한때 여기 복제본이 있었고 타일셋 레인이
// `UPPER_THRESHOLD` 를 0.5 → 0.57 로 올렸을 때 이 파일만 옛 값을 들고 있어서, 등고선이
// **지형이 그리지 않는 경계**에 붙었다. 테스트는 전부 그린이었다(각 파일이 자기 상수와만
// 일관했으므로). 값 하나를 두 곳에 적으면 언젠가 갈라진다는 것의 실물 사례다.
// 재-export 는 `tests/envAutotileField.test.ts` 가 통로를 검사하는 지점이라 지우지 마라.
export { DISPLAY_TILE, NOISE_SCALE, NOISE_SCALE_FINE, UPPER_THRESHOLD, terrainFieldAt };
export { verticalLightDir };

/** 그래디언트 중앙차분 폭(타일). 지형 잔결 노이즈보다 충분히 작아야 경계를 제대로 읽는다. */
const GRAD_STEP = 0.4;

/**
 * 지형 필드의 **수치 그래디언트**를 단위 법선으로 정규화해 `out[0]=nx`, `out[1]=ny` 에 쓴다.
 * 필드는 upper 쪽에서 크므로 **법선은 솟아오른(upper) 쪽을 가리킨다**.
 *
 * 화면 좌표는 y 가 아래로 자란다. `ny < 0` 이면 고지가 이 경계의 **북쪽**에 있다는 뜻이고,
 * 그러면 노출된 절벽면은 남쪽을 향한다({@link segmentLit}).
 *
 * 필드가 국소적으로 평평해 그래디언트가 0 이면 위쪽(0,-1)으로 폴백한다(0 나눗셈 방지).
 */
export function terrainGradient(seed: number, vx: number, vy: number, out: number[]): void {
  const h = GRAD_STEP;
  const gx = terrainFieldAt(seed, vx + h, vy) - terrainFieldAt(seed, vx - h, vy);
  const gy = terrainFieldAt(seed, vx, vy + h) - terrainFieldAt(seed, vx, vy - h);
  const m = Math.sqrt(gx * gx + gy * gy);
  if (m < 1e-9) {
    out[0] = 0;
    out[1] = -1;
    return;
  }
  out[0] = gx / m;
  out[1] = gy / m;
}

// ---------------------------------------------------------------------------
// 메커니즘 상수
//
// 여기 남은 것은 **행성이 골라선 안 되는 것**뿐이다. 색·폭·알파·오프셋·세기 필드는 전부
// 테마로 나갔다({@link TerrainLightTheme}). 품질 티어·광과민 정책은 행성이 아니라 사용자
// 설정의 함수라 여기 남는다.
// ---------------------------------------------------------------------------

/** 가시 영역 밖으로 유지하는 타일 링(팝인 방지). */
const MARGIN_TILES = 2;

/** 세그먼트 상한(병적인 시야 확대에서도 풀이 폭주하지 않게). */
const MAX_SEGMENTS = 420;
/** 저티어 세그먼트 상한. */
const MAX_SEGMENTS_LOW = 170;

/**
 * 저티어에서 버리는 세기 하한. 세기에 하한이 생기며 "세기 0 인 세그먼트를 버린다"는 조건이
 * 사문화됐으므로(조건이 영영 거짓이 되는 컬링은 "성능 최적화가 조용히 사라진" 상태다)
 * **약한 절반**을 버려 같은 목적을 유지한다.
 */
const LOW_TIER_STRENGTH_MIN = 0.45;
/** 저티어에서 세기가 약해도 살려두는 림 세기(윤곽 정보라 가치가 다르다). */
const LOW_TIER_RIM_MIN = 0.5;

/** 티어별 발광 배율(항상 ≤ 1 — 상한 불변식을 깨지 않는다). */
function tierScale(tier: QualityTier): number {
  return tier === 'low' ? 0.62 : tier === 'med' ? 0.88 : 1;
}

// --- `gates.halo` 게이팅: 끄기가 아니라 줄이기 -------------------------------
//
// 초기 구현은 `gates.halo === false`(= low 티어 **또는** `reducedGlow`)에서 발광 겹을 통째로
// 내렸다. 실측 결과 그 상태에서 **가시 발광 0** — 배경이 무채색 암괴만 남았다. 이 레이어는
// 행성의 아트 디렉션 자체라 "없어도 되는 장식"이 아니다.
//
// 광과민 대응의 취지(밝은 면적·깜빡임을 줄인다)는 다음 셋으로 지킨다:
//  ① 넓은 겹을 강하게 눌러 **밝은 면적**을 줄인다.
//  ② 좁은 겹(코어)만 남겨 형태를 유지한다 — 면적이 작아 광과민 부담이 작다.
//  ③ `reducedGlow` 에서는 **맥동을 아예 정지**시킨다({@link REDUCED_GLOW_PULSE}).
//     광과민의 실제 위험은 평균 밝기가 아니라 **주기적 변조**다.

/** `gates.halo` 가 꺼졌을 때(주로 low 티어) 코어에 곱하는 배율. **0 이 아니다.** */
export const HALO_OFF_CORE_SCALE = 0.55;
/** 같은 상황에서 헤일로 배율(넓은 겹이라 더 깎는다). */
export const HALO_OFF_GLOW_SCALE = 0.3;
/** 같은 상황에서 림 배율. */
export const HALO_OFF_RIM_SCALE = 0.4;

/** `reducedGlow`(광과민 대응)에서 코어에 곱하는 배율. 저티어보다 더 누르되 **0 이 아니다.** */
export const REDUCED_GLOW_CORE_SCALE = 0.34;
/** `reducedGlow` 헤일로 배율. */
export const REDUCED_GLOW_GLOW_SCALE = 0.16;
/** `reducedGlow` 림 배율. */
export const REDUCED_GLOW_RIM_SCALE = 0.22;
/** `reducedGlow` 에서 맥동 대신 쓰는 **고정** 밝기(깜빡임 0). */
export const REDUCED_GLOW_PULSE = 0.85;

/**
 * 현재 게이트 상태에서 각 겹에 곱할 배율. 셋 다 [0,1] 이고 **어느 경로에서도 코어가 0 이
 * 되지 않는다** — 그게 이 함수의 계약이며 테스트가 잠근다.
 *
 * @param haloGate  `EffectGates.halo`.
 * @param reducedGlow 접근성 토글(티어와 직교). 게이트가 켜져 있으면 이 값은 항상 false 다.
 */
export function glowGateScales(
  haloGate: boolean,
  reducedGlow: boolean,
): { core: number; glow: number; rim: number; plume: boolean } {
  if (reducedGlow) {
    return {
      core: REDUCED_GLOW_CORE_SCALE,
      glow: REDUCED_GLOW_GLOW_SCALE,
      rim: REDUCED_GLOW_RIM_SCALE,
      plume: false,
    };
  }
  if (!haloGate) {
    return {
      core: HALO_OFF_CORE_SCALE,
      glow: HALO_OFF_GLOW_SCALE,
      rim: HALO_OFF_RIM_SCALE,
      plume: false,
    };
  }
  return { core: 1, glow: 1, rim: 1, plume: true };
}

// ---------------------------------------------------------------------------
// 맥동
// ---------------------------------------------------------------------------

/** 맥동 하한(보장 불변식). 실제 파형은 이 값에 닿지 않는다. */
export const PULSE_MIN = 0.2;
/** 맥동 상한(보장 불변식). */
export const PULSE_MAX = 1;
/** 빠른 맥동 각속도(rad/tick). 60틱/초 기준 주기 ≈ 5.8초. */
const PULSE_W1 = 0.018;
/** 느린 맥동 각속도(rad/tick). 주기 ≈ 14.7초. 두 주기가 **약분되지 않아** 반복이 안 느껴진다. */
const PULSE_W2 = 0.0071;
const TAU = Math.PI * 2;

/**
 * 맥동 밝기 — **`tick` 의 순수 함수**. 같은 tick·phase 면 언제나 같은 값이다.
 *
 * 서로 약분되지 않는 두 사인을 겹쳐(주기 ≈5.8초 / ≈14.7초) 숨 쉬는 듯한 비반복 파형을 만든다.
 * 단일 사인은 몇 초만 봐도 기계적으로 읽힌다. 두 주기의 비는 지각 특성이지 행성 특성이 아니라
 * 테마로 나가지 않았다.
 *
 * 파형 중심은 0.74 다. 0.6 이던 시절 이 항은 실효 알파를 40% 깎는 감쇠원이었다 — 맥동은
 * "밝기를 깎는 장치"가 아니라 "숨 쉬는 장치"여야 한다.
 *
 * @param tick  보간된 sim 틱({@link EnvFrame.tick}). 벽시계가 아니다 — 그래야 프레임 스킵·탭
 *              백그라운드 복귀에서 밝기가 튀지 않고 리플레이가 같은 그림을 낸다.
 * @param phase 세그먼트별 위상 [0,1). 전체가 한꺼번에 숨쉬지 않게 흩는다.
 * @returns [{@link PULSE_MIN}, {@link PULSE_MAX}] 안의 값(하드 클램프).
 */
export function emitterPulse(tick: number, phase: number): number {
  const a = Math.sin(tick * PULSE_W1 + phase * TAU);
  const b = Math.sin(tick * PULSE_W2 + phase * TAU * 1.7 + 1.3);
  const raw = 0.74 + 0.17 * a + 0.09 * b; // 파형 자연 범위 [0.48, 1.00]
  return raw < PULSE_MIN ? PULSE_MIN : raw > PULSE_MAX ? PULSE_MAX : raw;
}

/**
 * 최종 알파 = 상한 × 세기 × 맥동 × 티어배율. 세 인자가 모두 [0,1] 이라 **결과는 상한을 절대
 * 넘지 않는다** — 포화 방지 불변식의 정본이며 테스트가 이걸 잠근다.
 *
 * ⚠️ 여기에 인자를 하나 더 끼우지 마라. 이 레이어가 처음 기각된 이유가 "개별로는 합리적인
 * 보수적 판단이 곱해져 화면 기여가 0 이 된 것"이다. 테마는 `cap` 을 **치환**한다.
 */
export function emitterAlpha(cap: number, strength: number, pulse: number, tier: number): number {
  const v = cap * strength * pulse * tier;
  return v < 0 ? 0 : v > cap ? cap : v;
}

// ---------------------------------------------------------------------------
// 마칭 스퀘어즈 — 띠의 중심선
// ---------------------------------------------------------------------------

/**
 * 한 변에서 임계가 교차하는 지점의 보간 계수. 두 꼭짓점 값이 같으면(교차 없음) 0.5 를 준다.
 *
 * **연결성의 근거가 이 함수다.** 이웃한 두 셀은 공유 변의 **같은 두 꼭짓점 값**으로 이 함수를
 * 부르므로 부동소수 비트까지 동일한 교차점을 얻는다 → 세그먼트 끝점이 정확히 맞물린다.
 */
function edgeT(a: number, b: number): number {
  const d = b - a;
  return d === 0 ? 0.5 : (UPPER_THRESHOLD - a) / d;
}

/** 세그먼트 하나가 `out` 에서 차지하는 숫자 개수(x0,y0,x1,y1). */
export const SEG_STRIDE = 4;
/** 한 셀이 낼 수 있는 최대 세그먼트 수(안장점 케이스 5·10). */
export const MAX_SEG_PER_CELL = 2;

/**
 * 타일 셀 (i,j) 의 네 꼭짓점 필드값에서 {@link UPPER_THRESHOLD} 등고선 세그먼트를 뽑아
 * `out` 에 **월드 px** 로 쓴다. 꼭짓점 값을 인자로 받는 이유는 레이어가 행 버퍼로 값을
 * 재사용하기 때문이다(꼭짓점당 1회 평가).
 *
 * 안장점(케이스 5·10)은 두 세그먼트를 내며, 어느 쪽으로 잇든 **공유 변의 교차점은 동일**하므로
 * 연결성은 깨지지 않는다(모호성 해소를 굳이 하지 않는 이유).
 *
 * @param f00 (i,   j)   @param f10 (i+1, j)
 * @param f11 (i+1, j+1) @param f01 (i,   j+1)
 * @param off `out` 쓰기 시작 인덱스.
 * @returns 쓴 세그먼트 수 (0~{@link MAX_SEG_PER_CELL}).
 */
export function marchCorners(
  i: number,
  j: number,
  f00: number,
  f10: number,
  f11: number,
  f01: number,
  out: number[],
  off = 0,
): number {
  const code =
    (f00 > UPPER_THRESHOLD ? 1 : 0) |
    (f10 > UPPER_THRESHOLD ? 2 : 0) |
    (f11 > UPPER_THRESHOLD ? 4 : 0) |
    (f01 > UPPER_THRESHOLD ? 8 : 0);
  if (code === 0 || code === 15) return 0;

  // 네 변의 교차점(타일 단위). 케이스가 고르는 것만 실제로 쓰인다.
  const tx = i + edgeT(f00, f10);
  const ty = j;
  const rx = i + 1;
  const ry = j + edgeT(f10, f11);
  const bx = i + edgeT(f01, f11);
  const by = j + 1;
  const lx = i;
  const ly = j + edgeT(f00, f01);

  switch (code) {
    case 1:
    case 14:
      return write1(out, off, lx, ly, tx, ty);
    case 2:
    case 13:
      return write1(out, off, tx, ty, rx, ry);
    case 3:
    case 12:
      return write1(out, off, lx, ly, rx, ry);
    case 4:
    case 11:
      return write1(out, off, rx, ry, bx, by);
    case 6:
    case 9:
      return write1(out, off, tx, ty, bx, by);
    case 7:
    case 8:
      return write1(out, off, lx, ly, bx, by);
    case 5:
      write1(out, off, lx, ly, tx, ty);
      write1(out, off + SEG_STRIDE, rx, ry, bx, by);
      return 2;
    default:
      // case 10
      write1(out, off, tx, ty, rx, ry);
      write1(out, off + SEG_STRIDE, bx, by, lx, ly);
      return 2;
  }
}

/** 타일 단위 세그먼트 하나를 월드 px 로 환산해 쓴다. */
function write1(
  out: number[],
  off: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  out[off] = ax * DISPLAY_TILE;
  out[off + 1] = ay * DISPLAY_TILE;
  out[off + 2] = bx * DISPLAY_TILE;
  out[off + 3] = by * DISPLAY_TILE;
  return 1;
}

/** 필드를 직접 평가하는 {@link marchCorners} 편의 래퍼(테스트·진단용 — 레이어는 행 버퍼를 쓴다). */
export function marchCell(seed: number, i: number, j: number, out: number[], off = 0): number {
  return marchCorners(
    i,
    j,
    terrainFieldAt(seed, i, j),
    terrainFieldAt(seed, i + 1, j),
    terrainFieldAt(seed, i + 1, j + 1),
    terrainFieldAt(seed, i, j + 1),
    out,
    off,
  );
}

// ---------------------------------------------------------------------------
// 세그먼트 레코드
// ---------------------------------------------------------------------------

/** 등고선 세그먼트 하나(재사용 레코드 — 매 프레임 할당 0을 위해 풀에 눌러 담는다). */
export interface ContourSegment {
  /** 끝점(월드 px). 인접 세그먼트와 **정확히** 공유된다. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 중점(월드 px) — 스프라이트 배치 기준. */
  midX: number;
  midY: number;
  /** 길이(월드 px). */
  len: number;
  /** 회전(rad) — 띠를 등고선 접선 방향으로 눕힌다. */
  angle: number;
  /** 단위 법선(솟아오른 upper 쪽을 가리킨다). */
  nx: number;
  ny: number;
  /** 발광 세기 [0,1]. 하한이 있어 **0 이 되지 않는다**(꺼진 경계 금지 계약). */
  strength: number;
  /** 림 세기 [0,1] = `fade(lit)`. 절벽면이 광원을 마주볼수록 크다. */
  rim: number;
  /** AO 세기 [0,1]. 테마 하한 + 그늘 성분 — **림의 여집합**에 실린다. */
  ao: number;
  /** 캐스트 섀도 세기 [0,1]. 빛을 등진 면에서만 0 보다 크다. */
  shadow: number;
  /** 캐스트 섀도 오프셋 방향(단위 벡터, −n 과 빛 반대 방향의 혼합). */
  shadowX: number;
  shadowY: number;
  /** 맥동 위상 [0,1). */
  phase: number;
  /** 넓은 겹 색·좁은 겹 색(테마 채널 팔레트에서 해시로 고른다). */
  color: number;
  coreColor: number;
}

/** 빈 레코드(풀 확장·테스트 스크래치용). */
export function createSegment(): ContourSegment {
  return {
    x0: 0,
    y0: 0,
    x1: 0,
    y1: 0,
    midX: 0,
    midY: 0,
    len: 0,
    angle: 0,
    nx: 0,
    ny: -1,
    strength: 0,
    rim: 0,
    ao: 0,
    shadow: 0,
    shadowX: 0,
    shadowY: 1,
    phase: 0,
    color: 0,
    coreColor: 0,
  };
}

/** {@link terrainGradient} 결과를 받는 모듈 스크래치(할당 0). 동기 함수라 재진입 위험 없음. */
const gradScratch: number[] = [0, -1];

/**
 * 경계면이 광원을 마주보는 정도 [0,1] — 조명 모델의 정본.
 *
 * 절벽면의 바깥 법선은 `−n`(고지에서 저지를 향한다). 표면 → 광원 벡터는 `(0, toLightY)`.
 * 램버트 항 `max(0, (−n)·(0,toLightY))`.
 *
 * 이 함수가 방향에 반응하지 않게 되면(= 전방위 균일) 림 방향성이 사라진다 — 그게 이걸 별도
 * export 로 뽑아 둔 이유다.
 *
 * @param toLightY {@link verticalLightDir} 의 결과(−1 · 0 · +1).
 */
export function segmentLit(_nx: number, ny: number, toLightY: number): number {
  const d = -ny * toLightY;
  return d > 0 ? (d > 1 ? 1 : d) : 0;
}

/**
 * 등고선 세그먼트 하나의 시각 속성을 채운다. **(테마, seed, 끝점) 의 순수 함수.**
 *
 * 절차:
 *  1. 기하(중점·길이·각).
 *  2. 그래디언트 → 법선.
 *  3. 방향성 라이팅 — 림과 AO·캐스트 섀도를 **여집합**으로 가른다.
 *  4. 저주파 지역 필드로 등고선 중 **일부 구간만** 최대 세기로 승격시킨다. 지역 필드가
 *     저주파라 승격 구간이 **연속 덩어리**로 나오고, 그래서 띠가 강처럼 이어진다. 모든
 *     경계를 균일하게 빛나게 하면 오히려 평평해 보인다.
 */
export function evaluateSegment(
  theme: EnvTheme,
  seed: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  out: ContourSegment,
): void {
  const t = theme.terrainLight;
  const it = t.intensity;
  const toLightY = verticalLightDir(theme.light);

  out.x0 = x0;
  out.y0 = y0;
  out.x1 = x1;
  out.y1 = y1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  out.len = Math.sqrt(dx * dx + dy * dy);
  out.angle = Math.atan2(dy, dx);
  const mx = (x0 + x1) * 0.5;
  const my = (y0 + y1) * 0.5;
  out.midX = mx;
  out.midY = my;

  const vx = mx / DISPLAY_TILE;
  const vy = my / DISPLAY_TILE;
  terrainGradient(seed, vx, vy, gradScratch);
  const nx = gradScratch[0] ?? 0;
  const ny = gradScratch[1] ?? -1;
  out.nx = nx;
  out.ny = ny;

  // ── 방향성 라이팅.
  // 빛을 받는 면은 림, 등진 면은 AO 강화 + 캐스트 섀도. 두 신호를 같은 항에 비례시키면
  // 가장 밝은 면이 동시에 가장 짙게 그늘져 서로를 상쇄한다 — 그 상태가 "광원 벡터가 존재하지
  // 않는다"의 실체였다.
  const lit = segmentLit(nx, ny, toLightY);
  const litSmooth = fade(lit);
  // 그늘 성분은 림의 여집합이다. 광원이 뒤집힌 행성에서도 성립하도록 `toLightY` 로 판정한다.
  const away = -ny * toLightY;
  const shade = fade(away < 0 ? -away : 0);
  out.rim = litSmooth;
  out.ao = t.ao.floor + (1 - t.ao.floor) * shade;
  out.shadow = shade;

  // 캐스트 섀도 방향 = 저지 쪽(−n) + 빛 반대 방향 편향. 정규화해 오프셋 길이를 상수로 유지.
  const sxRaw = -nx;
  const syRaw = -ny - theme.light.shadowBias * toLightY;
  const sm = Math.sqrt(sxRaw * sxRaw + syRaw * syRaw);
  if (sm < 1e-9) {
    out.shadowX = 0;
    out.shadowY = -1;
  } else {
    out.shadowX = sxRaw / sm;
    out.shadowY = syRaw / sm;
  }

  // ── 지역 필드(저주파) — "지금 살아 있는 구간"이 어디냐.
  const region = fbm(seed ^ 0x1a5ec0de, vx / it.regionTiles, vy / it.regionTiles, 2);
  const excessRaw = (region - it.regionThreshold) / it.regionSpan;
  const excess = excessRaw <= 0 ? 0 : excessRaw >= 1 ? 1 : excessRaw;
  const hot = fade(excess);

  // ── 하한 변조(저주파, 다른 스케일·다른 시드) — 지역 필드와 **독립**이라 두 필드의 마루가
  //    어긋나고, 그래서 "살아 있는 지역 밖"에서도 강약이 생긴다. 이게 없으면 하한이 상수가
  //    되어 모든 경계가 똑같은 밝기로 켜지고, 균일하게 다 켜서 촌스러워지는 실패로 간다.
  const emberRaw = fbm(
    seed ^ 0x51e3b0a7,
    vx / it.emberModTiles + 37.5,
    vy / it.emberModTiles - 12.25,
    2,
  );
  const eRemap = (emberRaw - it.emberRemapLo) / (it.emberRemapHi - it.emberRemapLo);
  const eClamped = eRemap <= 0 ? 0 : eRemap >= 1 ? 1 : eRemap;
  const ember = it.emberMin + (it.emberMax - it.emberMin) * fade(eClamped);

  // 하한을 바닥으로 깔고 지역 필드가 1 까지 끌어올린다. `hot === 0` 이어도 strength ≥ emberMin
  // 이므로 **완전히 꺼진 경계가 없다**. 살아 있는 지역은 여전히 압도적으로 밝다(hot=1 → 1).
  out.strength = ember + (1 - ember) * hot;

  // 위상·색은 셀 단위로 잡아 같은 셀의 두 세그먼트(안장점)가 따로 놀지 않게 한다.
  const ci = Math.floor(mx / DISPLAY_TILE);
  const cj = Math.floor(my / DISPLAY_TILE);
  out.phase = hash3(seed, ci, cj, 47);
  const pairs = t.channel;
  const k = Math.floor(hash3(seed, ci, cj, 59) * pairs.length) % pairs.length;
  // 폴백이 팔레트 **안**이어야 한다. 팔레트 밖 상수를 쓰면 색상각 검사가 훑지 못하는 구멍이
  // 되고, 실제로 카르곤에서 그 폴백이 앰버 적탄 2.1° 옆 색이었다.
  const pair = pairs[k] ?? pairs[0];
  out.color = pair.glow;
  out.coreColor = pair.core;
}

// ---------------------------------------------------------------------------
// 텍스처
// ---------------------------------------------------------------------------

/** 띠 텍스처 폭(px). 가운데 {@link STREAK_LINE} 이 직선부, 양끝이 둥근 캡. */
const STREAK_W = 192;
/** 띠 텍스처 높이(px) = 최대 두께. */
const STREAK_H = 64;
/** 띠 텍스처의 직선부 길이(px). 스케일 계산의 기준. */
const STREAK_LINE = 128;
/** 방사 텍스처 한 변의 절반(px). */
const RADIAL_R = 64;
/** 그라디언트 링 수(많을수록 부드럽지만 굽는 비용만 늘고 런타임 비용은 같다). */
const RINGS = 26;

/**
 * 캡슐(스타디움) 그라디언트를 굽는다. 바깥 링부터 안으로 좁혀 들어가며 알파를 누적시키는
 * 방식이라 그라디언트 API 없이도 매끈한 falloff 가 나온다. `exp` 가 클수록 중심선에 집중된
 * (=날카로운) 띠가 된다.
 *
 * 둥근 캡이 있어야 세그먼트 이음매에서 두 띠가 겹쳐 **끊김 없는 강**으로 읽힌다.
 *
 * `plateau > 0` 이면 중심에서 그 비율까지 알파가 **1 로 평평**하고 거기서부터 falloff 한다.
 * 이것이 "흐린 블롭"과 "또렷한 띠"를 가르는 유일한 인자다 — 부드러운 방사 falloff 는 알파를
 * 올려도 가장자리가 없어 **띠로 읽힐 수 없다**.
 */
function bakeStreak(renderer: Renderer, exp: number, plateau = 0): Texture {
  const g = new Graphics();
  const half = STREAK_H / 2;
  const x0 = (STREAK_W - STREAK_LINE) / 2;
  const profile = (t: number): number => bandProfile(t, exp, plateau);
  for (let i = RINGS; i >= 1; i--) {
    const tOuter = i / RINGS;
    const tInner = (i - 1) / RINGS;
    const a = profile(tInner) - profile(tOuter);
    if (a <= 0) continue;
    const r = half * tOuter;
    g.roundRect(x0 - r, half - r, STREAK_LINE + r * 2, r * 2, r).fill({
      color: 0xffffff,
      alpha: a,
    });
  }
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

/** 소프트 방사 그라디언트(세 번째 넓은 겹용). */
function bakeRadial(renderer: Renderer, exp: number): Texture {
  const g = new Graphics();
  const profile = (t: number): number => Math.pow(1 - t, exp);
  for (let i = RINGS; i >= 1; i--) {
    const tOuter = i / RINGS;
    const tInner = (i - 1) / RINGS;
    const a = profile(tInner) - profile(tOuter);
    if (a <= 0) continue;
    g.circle(RADIAL_R, RADIAL_R, RADIAL_R * tOuter).fill({ color: 0xffffff, alpha: a });
  }
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

/**
 * 띠 단면의 알파 프로파일 — `t` 는 중심선(0)에서 가장자리(1)까지의 정규화 거리.
 *
 * **캔버스 없는 테스트에서 구운 텍스처는 검사할 수 없다**(`generateTexture` 에 렌더러가
 * 필요하다). 그래서 프로파일을 순수 함수로 뽑아 export 한다 — "흐린 블롭이 아니라 또렷한 띠"가
 * 걸린 유일한 인자가 `plateau` 이고, 이걸 잠그지 않으면 0 으로 되돌려도 아무 테스트가 안
 * 깨진다(실제로 뮤테이션이 살아남았다).
 */
export function bandProfile(t: number, exp: number, plateau: number): number {
  if (t <= plateau) return 1;
  const span = 1 - plateau;
  if (span <= 0) return 0;
  return Math.pow(1 - (t - plateau) / span, exp);
}

/** 스프라이트 위치가 세그먼트 중점에서 법선축으로 얼마나 떨어졌는가(부호가 곧 "어느 쪽"). */
function dotN(seg: ContourSegment, px: number, py: number): number {
  return (px - seg.midX) * seg.nx + (py - seg.midY) * seg.ny;
}

/** 풀 스프라이트 하나 생성(공통 설정). */
function makeSprite(tex: Texture, blend: 'add' | 'multiply', parent: Container): Sprite {
  const s = new Sprite(tex);
  s.anchor.set(0.5);
  s.blendMode = blend;
  s.visible = false;
  parent.addChild(s);
  return s;
}

// ---------------------------------------------------------------------------
// 레이어
// ---------------------------------------------------------------------------

export class TerrainLightLayer implements EnvLayer {
  readonly name = 'terrain-light';
  readonly slot = 'floor' as const;
  readonly view = new Container();

  /**
   * 겹 컨테이너. `view` 에 붙는 **순서는 {@link terrainLightOrder} 가 정한다** — 테마가
   * 고르는 것은 어느 겹을 켜는가뿐이고, 순서는 {@link TERRAIN_LIGHT_STAGES} 의 물리다.
   */
  private readonly dusk = new Sprite(Texture.WHITE);
  private readonly glowLayer = new Container();
  private readonly shadowLayer = new Container();
  private readonly aoLayer = new Container();
  private readonly coreLayer = new Container();
  private readonly rimLayer = new Container();
  private readonly plumeLayer = new Container();
  private readonly byId: Record<TerrainLightLayerId, Container>;

  private readonly aoPool: Sprite[] = [];
  private readonly shadowPool: Sprite[] = [];
  private readonly glowPool: Sprite[] = [];
  private readonly corePool: Sprite[] = [];
  private readonly rimPool: Sprite[] = [];
  private readonly plumePool: Sprite[] = [];

  /** 재사용 세그먼트 레코드(길이 = 풀 용량, 유효 개수는 `count`). */
  private readonly segments: ContourSegment[] = [];
  private count = 0;
  /** 마칭 스퀘어즈 출력 스크래치(셀당 최대 2 세그먼트). */
  private readonly cellOut: number[] = new Array<number>(SEG_STRIDE * MAX_SEG_PER_CELL).fill(0);
  /** 꼭짓점 필드 행 버퍼 두 줄(꼭짓점당 1회 평가). */
  private rowA: Float64Array = new Float64Array(0);
  private rowB: Float64Array = new Float64Array(0);

  private enabled = false;
  private seed = 0;
  /** 현재 테마. `null` 이면 이 행성에 담당 테마가 없어 레이어가 꺼진 상태다. */
  private theme: EnvTheme | null = null;
  /** 구운 텍스처. 렌더러가 없으면 `Texture.WHITE` 폴백. */
  private streakSoft: Texture = Texture.WHITE;
  private streakCore: Texture = Texture.WHITE;
  /** 평정부가 있는 **또렷한 띠**(AO 전용). 소프트 캡슐과 섞어 쓰면 띠가 다시 블롭이 된다. */
  private streakBand: Texture = Texture.WHITE;
  private radialSoft: Texture = Texture.WHITE;
  /**
   * 어느 테마로 구웠는가. 영구 boolean 으로 두면 **행성이 바뀌어도 첫 테마의 텍스처가 그대로
   * 남는다**(프로파일 지수가 테마 데이터라 모양이 다르다).
   */
  private bakedThemeId: string | null = null;

  /** 타일 범위 캐시 — 여기 안에서 움직이는 동안은 등고선을 다시 뽑지 않는다. */
  private lastI0 = Number.NaN;
  private lastJ0 = Number.NaN;
  private lastI1 = Number.NaN;
  private lastJ1 = Number.NaN;
  private dirty = true;

  private tier: QualityTier = 'high';
  private settings: GraphicsSettings = graphicsSettings.getSettings();
  private gates: EffectGates = effectGates(this.tier, this.settings);
  private gatesDirty = true;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    this.dusk.anchor.set(0);
    this.dusk.blendMode = 'multiply';
    this.dusk.label = 'dusk';
    this.glowLayer.label = 'glow';
    this.shadowLayer.label = 'shadow';
    this.aoLayer.label = 'ao';
    this.coreLayer.label = 'core';
    this.rimLayer.label = 'rim';
    this.plumeLayer.label = 'plume';
    this.byId = {
      dusk: this.dusk,
      glow: this.glowLayer,
      shadow: this.shadowLayer,
      ao: this.aoLayer,
      core: this.coreLayer,
      rim: this.rimLayer,
      plume: this.plumeLayer,
    };
  }

  configure(ctx: EnvContext): boolean {
    const theme = themeFor(ctx.planet);
    this.theme = theme ?? null;
    this.enabled = theme !== undefined;
    if (theme === undefined) {
      // 구독을 남기면 담당 테마가 없는 런 내내 설정 변경 콜백이 살아 있게 된다(누수).
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.hideAll();
      return false;
    }
    const t = theme.terrainLight;
    this.seed = ctx.seed >>> 0;
    this.dirty = true;
    this.lastI0 = Number.NaN;

    // 겹 등록 — 테마가 켠 겹만, 단 순서대로. `plume` 이 없는 행성은 그 자리만 빈다.
    this.view.removeChildren();
    for (const id of terrainLightOrder((l) => l !== 'plume' || t.plume !== undefined)) {
      this.view.addChild(this.byId[id]);
    }
    this.dusk.tint = t.dusk.tint;
    this.dusk.alpha = t.dusk.alpha;

    // 텍스처는 **테마당 한 번만** 굽는다. 런을 반복할 때마다 구우면 GPU 메모리가 누적되고,
    // 테마가 바뀌었는데 안 구우면 이전 행성의 단면 모양이 그대로 남는다.
    // 캔버스 없는 테스트에서는 `renderer` 가 없다 — 던지지 않고 흰 텍스처로 폴백한다.
    if (this.bakedThemeId !== t.themeId && ctx.renderer !== undefined) {
      this.destroyTextures();
      this.streakSoft = bakeStreak(ctx.renderer, t.glow.profileExp);
      // 코어 프로파일 지수가 헤일로보다 커야 **같은 알파에서 첨두 명도만** 올라간다:
      // falloff 가 가팔라져 에너지가 중심선에 몰리므로 "블룸"이 아니라 "광원"으로 읽힌다.
      this.streakCore = bakeStreak(ctx.renderer, t.core.profileExp);
      // AO 띠는 **평정부**가 있어야 "칠해진 영역"이 아니라 "패인 홈"으로 읽힌다.
      this.streakBand = bakeStreak(ctx.renderer, t.ao.falloffExp, t.ao.plateau);
      // 세 번째 넓은 겹이 없는 행성에서는 굽지 않는다(스프라이트가 영영 안 보인다).
      if (t.plume !== undefined) this.radialSoft = bakeRadial(ctx.renderer, t.plume.profileExp);
      this.bakedThemeId = t.themeId;
      for (const s of this.glowPool) s.texture = this.streakSoft;
      for (const s of this.shadowPool) s.texture = this.streakSoft;
      for (const s of this.aoPool) s.texture = this.streakBand;
      for (const s of this.corePool) s.texture = this.streakCore;
      for (const s of this.rimPool) s.texture = this.streakCore;
      for (const s of this.plumePool) s.texture = this.radialSoft;
    }

    this.settings = graphicsSettings.getSettings();
    this.gatesDirty = true;
    this.unsubscribe?.();
    this.unsubscribe = graphicsSettings.onChange((s) => {
      this.settings = s;
      this.gatesDirty = true;
    });
    return true;
  }

  update(f: EnvFrame): void {
    if (!this.enabled) return;
    this.syncGates();

    // 월드 → stage 매핑은 EntityRenderer·autotile 과 동일. 스프라이트는 **월드 좌표**를 들고
    // 있고 레이어만 움직인다 → 카메라가 돌아오면 같은 자리가 같은 밝기다.
    const offX = DESIGN_WIDTH / 2 - f.camX;
    const offY = DESIGN_HEIGHT / 2 - f.camY;
    this.view.position.set(offX, offY);

    // 황혼은 화면 전체를 덮는다(레이어 로컬 = 월드 좌표라 오프셋을 빼서 잡는다).
    const wx0 = f.viewMinX - offX;
    const wy0 = f.viewMinY - offY;
    this.dusk.position.set(wx0, wy0);
    this.dusk.width = f.viewMaxX - f.viewMinX;
    this.dusk.height = f.viewMaxY - f.viewMinY;
    this.dusk.visible = true;

    const i0 = Math.floor(wx0 / DISPLAY_TILE) - MARGIN_TILES;
    const j0 = Math.floor(wy0 / DISPLAY_TILE) - MARGIN_TILES;
    const i1 = Math.floor((f.viewMaxX - offX) / DISPLAY_TILE) + MARGIN_TILES;
    const j1 = Math.floor((f.viewMaxY - offY) / DISPLAY_TILE) + MARGIN_TILES;
    if (
      this.dirty ||
      i0 !== this.lastI0 ||
      j0 !== this.lastJ0 ||
      i1 !== this.lastI1 ||
      j1 !== this.lastJ1
    ) {
      this.lastI0 = i0;
      this.lastJ0 = j0;
      this.lastI1 = i1;
      this.lastJ1 = j1;
      this.dirty = false;
      this.rebuild(i0, j0, i1, j1);
    }

    this.animate(f.tick);
  }

  resize(_width: number, _height: number): void {
    // 가시 사각형은 매 프레임 `EnvFrame` 이 준다 — 여기서는 다음 프레임 재구성만 예약한다.
    this.dirty = true;
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.destroyTextures();
    this.view.destroy({ children: true });
  }

  /**
   * 구운 텍스처를 회수한다. **폴백(`Texture.WHITE`)은 공유 자원이라 절대 destroy 하지 않는다** —
   * 세 번째 넓은 겹이 없는 테마에서는 `radialSoft` 가 폴백인 채로 남으므로 개별로 검사한다.
   */
  private destroyTextures(): void {
    if (this.streakSoft !== Texture.WHITE) this.streakSoft.destroy(true);
    if (this.streakCore !== Texture.WHITE) this.streakCore.destroy(true);
    if (this.streakBand !== Texture.WHITE) this.streakBand.destroy(true);
    if (this.radialSoft !== Texture.WHITE) this.radialSoft.destroy(true);
    this.streakSoft = Texture.WHITE;
    this.streakCore = Texture.WHITE;
    this.streakBand = Texture.WHITE;
    this.radialSoft = Texture.WHITE;
    this.bakedThemeId = null;
  }

  /** 진단·테스트용: 현재 프레임에 살아 있는 등고선 세그먼트 수. */
  get segmentCount(): number {
    return this.count;
  }

  /**
   * 진단·테스트용: 현재 프레임에 **실제로 보이는** 코어 스프라이트의 최대 알파.
   *
   * 이 값이 0 이면 "발광이 화면에서 사라졌다"는 뜻이다. 저티어·`reducedGlow` 결함이 정확히
   * 그 상태였는데 단위 테스트는 전부 그린이었다 — **가시성 자체를 아무도 안 재고 있었기
   * 때문**이다. 그래서 관측 가능한 수치로 노출해 테스트가 하한을 잠근다.
   */
  get peakCoreAlpha(): number {
    let m = 0;
    for (let i = 0; i < this.count; i++) {
      const s = this.corePool[i];
      if (s?.visible === true && s.alpha > m) m = s.alpha;
    }
    return m;
  }

  /** 진단·테스트용: 현재 프레임에 보이는 발광 스프라이트(헤일로+코어+림) 수. */
  get visibleGlowCount(): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.glowPool[i]?.visible === true) n++;
      if (this.corePool[i]?.visible === true) n++;
      if (this.rimPool[i]?.visible === true) n++;
    }
    return n;
  }

  /**
   * 진단·테스트용: 현재 프레임에 보이는 세 번째 넓은 겹의 수.
   *
   * 가장 넓은 겹이라 **모든 경계에 붙이면 화면이 균일한 안개**가 된다 — 세기 하한을 깐 목적
   * (강약 대비)이 스스로 무너지는 실패 모드다. 세그먼트 수보다 확실히 작다는 것을 테스트가
   * 잠근다.
   */
  get visiblePlumeCount(): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.plumePool[i]?.visible === true) n++;
    return n;
  }

  /**
   * 진단·테스트용: 보이는 헤일로 띠 **두께의 최대/최소 비**.
   *
   * 세기 하한을 전 경계에 깐 뒤 화면이 촌스러워지지 않게 막는 장치는 둘이다 — 알파 변조와
   * **폭 변조**. 폭까지 균일하면 약한 경계가 화면을 도배한다. 알파만 보는 테스트는 폭 변조가
   * 사라져도 통과하므로(실제로 뮤테이션이 살아남았다) 이 축을 따로 노출한다.
   */
  get glowWidthSpread(): number {
    let lo = Infinity;
    let hi = 0;
    for (let i = 0; i < this.count; i++) {
      const s = this.glowPool[i];
      if (s?.visible !== true) continue;
      const w = Math.abs(s.scale.y);
      if (w < lo) lo = w;
      if (w > hi) hi = w;
    }
    return lo > 0 && Number.isFinite(lo) ? hi / lo : 1;
  }

  // -------------------------------------------------------------------------
  // 덮임 진단 축 — **"그려졌는가"가 아니라 "덮이지 않았는가"를 잰다**
  //
  // AO·림이 `visible=true`·`alpha>0` 이고 테스트가 그린인데 화면에는 없던 적이 있다.
  // 원인은 합성 순서(가산 헤일로가 곱연산 AO 를 되돌림)와 기하(림이 코어 안에 갇힘)였다.
  // 아래 축들은 그 두 실패를 직접 관측한다.
  // -------------------------------------------------------------------------

  /**
   * `view` 자식들의 라벨 순서(뒤 → 앞). 곱연산 겹이 넓은 가산 겹보다 **뒤(=나중)** 여야 한다.
   * 이 결함은 코드 한 줄의 순서였고, 그건 스프라이트 속성으로는 절대 안 잡힌다.
   */
  get layerOrder(): readonly string[] {
    return this.view.children.map((c) => String(c.label ?? ''));
  }

  /** 진단·테스트용: 보이는 AO 띠 수. 모든 세그먼트에 붙는 것이 계약이다. */
  get visibleAoCount(): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.aoPool[i]?.visible === true) n++;
    return n;
  }

  /**
   * 진단·테스트용: 보이는 AO 띠의 실제 **월드 폭**(px). 스프라이트 스케일에서 역산하므로
   * "상수를 그대로 읽는" 항진이 아니다 — 배치 코드가 폭을 안 걸면 값이 어긋난다.
   */
  get aoBandWidthWorld(): number {
    for (let i = 0; i < this.count; i++) {
      const s = this.aoPool[i];
      if (s?.visible === true) return Math.abs(s.scale.y) * STREAK_H;
    }
    return 0;
  }

  /**
   * AO 띠가 **곱연산으로 실제로 어둡게 하는 비율**의 최솟값(1 = 안 어두워짐).
   * 알파만 재면 틴트를 흰색으로 바꿔도 통과한다 — 틴트까지 넣은 실효 배율을 잰다.
   */
  get aoDarkestFactor(): number {
    let m = 1;
    for (let i = 0; i < this.count; i++) {
      const s = this.aoPool[i];
      if (s?.visible !== true) continue;
      const tintR = ((s.tint as number) >> 16) & 0xff;
      const f = 1 - s.alpha * (1 - tintR / 255);
      if (f < m) m = f;
    }
    return m;
  }

  /** 보이는 캐스트 섀도 수. */
  get visibleShadowCount(): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.shadowPool[i]?.visible === true) n++;
    return n;
  }

  /**
   * 스프라이트가 **틀린 쪽**에 놓인 건수. AO 띠는 고지(+n), 캐스트 섀도·림은 저지(−n) 여야 한다.
   * 셋 다 0 이어야 하며, 오프셋 부호를 뒤집으면 즉시 깨진다.
   */
  get sideViolations(): { ao: number; shadow: number; rim: number } {
    let ao = 0;
    let shadow = 0;
    let rim = 0;
    for (let i = 0; i < this.count; i++) {
      const seg = this.segments[i];
      if (!seg) continue;
      const a = this.aoPool[i];
      if (a?.visible === true && dotN(seg, a.position.x, a.position.y) <= 0) ao++;
      const sh = this.shadowPool[i];
      if (sh?.visible === true && dotN(seg, sh.position.x, sh.position.y) >= 0) shadow++;
      const r = this.rimPool[i];
      if (r?.visible === true && dotN(seg, r.position.x, r.position.y) >= 0) rim++;
    }
    return { ao, shadow, rim };
  }

  /**
   * 림의 **방향 편향** 관측: 빛을 받는 면(`ny < −0.5`)과 등진 면(`ny > 0.5`) 각각의
   * 평균 알파·평균 폭. 전방위 균일 구현이면 두 그룹이 같아져 테스트가 깨진다.
   */
  get rimByFacing(): { litAlpha: number; shadeAlpha: number; litWidth: number; litSpread: number } {
    let la = 0;
    let ln = 0;
    let sa = 0;
    let sn = 0;
    let wLo = Infinity;
    let wHi = 0;
    for (let i = 0; i < this.count; i++) {
      const seg = this.segments[i];
      const r = this.rimPool[i];
      if (!seg || !r) continue;
      const a = r.visible === true ? r.alpha : 0;
      if (seg.ny < -0.5) {
        la += a;
        ln++;
        if (r.visible === true) {
          const w = Math.abs(r.scale.y) * STREAK_H;
          if (w < wLo) wLo = w;
          if (w > wHi) wHi = w;
        }
      } else if (seg.ny > 0.5) {
        sa += a;
        sn++;
      }
    }
    return {
      litAlpha: ln > 0 ? la / ln : 0,
      shadeAlpha: sn > 0 ? sa / sn : 0,
      litWidth: wHi,
      litSpread: wLo > 0 && Number.isFinite(wLo) ? wHi / wLo : 1,
    };
  }

  /** 진단·테스트용: 현재 프레임 세그먼트들의 최소 발광 세기(하한 관측). */
  get minSegmentStrength(): number {
    let m = Infinity;
    for (let i = 0; i < this.count; i++) {
      const h = this.segments[i]?.strength ?? 0;
      if (h < m) m = h;
    }
    return Number.isFinite(m) ? m : 0;
  }

  // -------------------------------------------------------------------------

  /** 티어·설정 변화가 있을 때만 게이트를 다시 계산한다(매 프레임 객체 할당 회피). */
  private syncGates(): void {
    const t = graphicsTierController.getActiveTier();
    if (t === this.tier && !this.gatesDirty) return;
    this.tier = t;
    this.gates = effectGates(t, this.settings);
    this.gatesDirty = false;
    // 세그먼트 상한과 정적 스프라이트(AO·림) 배치가 티어에 걸리므로 목록도 다시 만든다.
    this.dirty = true;
  }

  /**
   * 가시 타일 범위의 등고선을 마칭 스퀘어즈로 뽑아 세그먼트 목록을 다시 만들고,
   * **맥동하지 않는 스프라이트까지 여기서 배치**한다(매 프레임 루프에서 빼기 위함).
   */
  private rebuild(i0: number, j0: number, i1: number, j1: number): void {
    const theme = this.theme;
    if (theme === null) return;
    const cols = i1 - i0 + 2;
    if (this.rowA.length < cols) {
      this.rowA = new Float64Array(cols);
      this.rowB = new Float64Array(cols);
    }
    const cap = this.tier === 'low' ? MAX_SEGMENTS_LOW : MAX_SEGMENTS;
    const seed = this.seed;
    const out = this.cellOut;

    let top = this.rowA;
    let bot = this.rowB;
    for (let k = 0; k < cols; k++) top[k] = terrainFieldAt(seed, i0 + k, j0);

    let n = 0;
    for (let j = j0; j <= j1 && n < cap; j++) {
      for (let k = 0; k < cols; k++) bot[k] = terrainFieldAt(seed, i0 + k, j + 1);
      for (let i = i0; i <= i1 && n < cap; i++) {
        const k = i - i0;
        const m = marchCorners(
          i,
          j,
          top[k] ?? 0,
          top[k + 1] ?? 0,
          bot[k + 1] ?? 0,
          bot[k] ?? 0,
          out,
          0,
        );
        for (let s = 0; s < m && n < cap; s++) {
          const o = s * SEG_STRIDE;
          const rec = this.segments[n] ?? this.growSlot(n);
          evaluateSegment(
            theme,
            seed,
            out[o] ?? 0,
            out[o + 1] ?? 0,
            out[o + 2] ?? 0,
            out[o + 3] ?? 0,
            rec,
          );
          if (rec.rim < theme.terrainLight.rim.minStrength) rec.rim = 0;
          // 저티어에서는 **약한** 세그먼트(림도 없는)를 버려 예산을 강한 것에 몰아준다.
          if (
            this.tier === 'low' &&
            rec.strength < LOW_TIER_STRENGTH_MIN &&
            rec.rim < LOW_TIER_RIM_MIN
          ) {
            continue;
          }
          this.applyStatic(n, rec, theme);
          n++;
        }
      }
      const swap = top;
      top = bot;
      bot = swap;
    }
    // 행 버퍼 참조를 스왑 결과로 되돌린다(다음 재구성에서 길이 검사만 하면 되게).
    this.rowA = top;
    this.rowB = bot;

    // 남는 풀은 숨긴다(다음 프레임에 유령 스프라이트가 남지 않게).
    for (let idx = n; idx < this.segments.length; idx++) {
      const a = this.aoPool[idx];
      const sh = this.shadowPool[idx];
      const g = this.glowPool[idx];
      const c = this.corePool[idx];
      const r = this.rimPool[idx];
      const h = this.plumePool[idx];
      if (a) a.visible = false;
      if (sh) sh.visible = false;
      if (g) g.visible = false;
      if (c) c.visible = false;
      if (r) r.visible = false;
      if (h) h.visible = false;
    }
    this.count = n;
  }

  /**
   * 맥동하지 않는 겹(AO·캐스트 섀도·림)을 배치한다. 재구성에서만 호출된다.
   *
   * AO 가 맥동하지 않는 이유: 그림자는 기하 정보다. 같이 숨쉬면 지형이 출렁이는 것처럼 보여
   * 오히려 입체감이 깨진다. 림도 같은 이유로 고정 — 모서리는 흔들리지 않는다.
   */
  private applyStatic(idx: number, seg: ContourSegment, theme: EnvTheme): void {
    const t = theme.terrainLight;
    const ao = this.aoPool[idx];
    const rim = this.rimPool[idx];
    const shadow = this.shadowPool[idx];
    if (!ao || !rim || !shadow) return;

    // AO 띠 — 경계 **안쪽**(고지 +n) 의 좁고 또렷한 홈(곱연산). 모든 경계에 붙는다.
    this.place(ao, seg, t.ao.width, t.ao.offset);
    ao.tint = t.ao.tint;
    ao.alpha = emitterAlpha(t.ao.alphaCap, seg.ao, 1, 1);
    ao.visible = true;

    // 캐스트 섀도 — 경계 **바깥**(저지 −n) 으로 떨군 넓고 부드러운 곱연산.
    // AO 와 **다른 것**이다: 저쪽은 경계 안쪽·좁음·전 구간, 이쪽은 바깥·넓음·그늘진 면만.
    if (seg.shadow > t.shadow.minStrength) {
      this.placeAt(
        shadow,
        seg,
        t.shadow.width,
        seg.shadowX * t.shadow.offset,
        seg.shadowY * t.shadow.offset,
      );
      shadow.tint = t.shadow.tint;
      shadow.alpha = emitterAlpha(t.shadow.alphaCap, seg.shadow, 1, 1);
      shadow.visible = true;
    } else {
      shadow.visible = false;
    }

    // 림 — 광원을 마주본 절벽면에만. 코어 **바깥**에 앉는다.
    // 세기뿐 아니라 **폭도** `lit` 로 변조한다 — 알파만 변조하면 "전방위 균일"에 가까워 보인다.
    // `gates.halo` 가 꺼져도 **끄지 않고 줄인다**({@link glowGateScales}).
    if (seg.rim > 0) {
      const gs = glowGateScales(this.gates.halo, this.settings.reducedGlow);
      const w = t.rim.width * (t.rim.widthFloor + (1 - t.rim.widthFloor) * seg.rim);
      this.place(rim, seg, w, t.rim.offset);
      rim.tint = t.rim.color;
      rim.alpha = emitterAlpha(t.rim.alphaCap, seg.rim, 1, tierScale(this.tier) * gs.rim);
      rim.visible = true;
    } else {
      rim.visible = false;
    }
  }

  /**
   * 띠 스프라이트를 세그먼트 위에 눕힌다.
   *
   * `scale.x` 를 **직선부 길이 기준**으로 잡아 세그먼트를 완전히 덮고, 둥근 캡이 양끝 바깥으로
   * 흘러나가 이웃 세그먼트와 겹친다 → 이음매가 끊겨 보이지 않는다. 오버행은 폭에 비례해
   * 잡아 얇은 코어일수록 짧다(불필요하게 번지지 않게).
   */
  private place(s: Sprite, seg: ContourSegment, width: number, offset: number): void {
    this.placeAt(s, seg, width, seg.nx * offset, seg.ny * offset);
  }

  /** 임의 방향 오프셋 판({@link place} 의 일반형 — 캐스트 섀도는 −n 이 아니라 혼합 벡터를 쓴다). */
  private placeAt(
    s: Sprite,
    seg: ContourSegment,
    width: number,
    ox: number,
    oy: number,
  ): void {
    s.position.set(seg.midX + ox, seg.midY + oy);
    s.rotation = seg.angle;
    s.scale.set((seg.len + width * 0.6) / STREAK_LINE, width / STREAK_H);
  }

  /** 프레임 갱신 — 맥동하는 겹(헤일로·코어·기둥)만 만진다. */
  private animate(tick: number): void {
    const theme = this.theme;
    if (theme === null) return;
    const t = theme.terrainLight;
    const it = t.intensity;
    // `gates.halo` 가 꺼져도 **끄지 않고 줄인다**. 이 레이어는 행성의 아트 디렉션 자체라
    // 통째로 사라지면 화면이 무너진다({@link glowGateScales} 주석 참조).
    const reducedGlow = this.settings.reducedGlow;
    const gs = glowGateScales(this.gates.halo, reducedGlow);
    const plume = t.plume;
    const plumeOn = gs.plume && this.tier === 'high' && plume !== undefined;
    const ts = tierScale(this.tier);

    for (let i = 0; i < this.count; i++) {
      const seg = this.segments[i];
      const glow = this.glowPool[i];
      const core = this.corePool[i];
      const plumeSprite = this.plumePool[i];
      if (!seg || !glow || !core || !plumeSprite) continue;

      // 세기 하한이 있으므로 이 분기는 방어에만 걸린다 — 정상 경로에서는 **모든 경계가
      // 최소한 하한만큼 빛난다**.
      if (seg.strength > 0) {
        // 광과민 대응에서는 맥동 자체를 정지시킨다(고정값). 밝기를 남기되 **변조를 없앤다**.
        const p = reducedGlow ? REDUCED_GLOW_PULSE : emitterPulse(tick, seg.phase);

        // 넓은 헤일로 + 좁은 코어 2단. 한 겹짜리 흐린 띠는 "얼룩"으로 읽힌다.
        // 폭을 세기에 비례시켜 **약한 경계는 가는 선, 강한 채널은 넓은 강**이 되게 한다.
        // 폭까지 균일하면 하한이 화면을 도배한다.
        const wScale = it.widthBase + it.widthGain * seg.strength;
        this.place(glow, seg, t.glow.width * wScale * (0.92 + 0.14 * p), 0);
        glow.tint = seg.color;
        glow.alpha = emitterAlpha(t.glow.alphaCap, seg.strength, p, ts * gs.glow);
        glow.visible = true;

        this.place(core, seg, t.core.width * wScale * (0.85 + 0.24 * p), 0);
        core.tint = seg.coreColor;
        core.alpha = emitterAlpha(t.core.alphaCap, seg.strength, p, ts * gs.core);
        core.visible = true;

        // 세 번째 넓은 겹 — 경계에서 떨어져 뜨는 옅은 기운. 맥동 주기를 발광보다 느리게 잡아
        // (틱 0.55배) 두 신호가 따로 움직이는 것처럼 보이게 한다.
        // **약한 경계에는 붙이지 않는다** — 전 구간에 붙으면 화면이 균일한 안개가 된다.
        if (plumeOn && plume !== undefined && seg.strength >= plume.minStrength) {
          const hp = emitterPulse(tick * 0.55, seg.phase + 0.37);
          plumeSprite.position.set(seg.midX, seg.midY - plume.rise * (0.9 + 0.2 * hp));
          plumeSprite.rotation = 0;
          const sc = plume.width / (RADIAL_R * 2);
          plumeSprite.scale.set(sc, sc * plume.stretch);
          plumeSprite.tint = plume.color;
          plumeSprite.alpha = emitterAlpha(plume.alphaCap, seg.strength, hp, ts);
          plumeSprite.visible = true;
        } else {
          plumeSprite.visible = false;
        }
      } else {
        glow.visible = false;
        core.visible = false;
        plumeSprite.visible = false;
      }
    }
  }

  /** 풀 슬롯 확장(레코드 + 스프라이트 6장). 목록이 커지는 순간에만 할당된다. */
  private growSlot(i: number): ContourSegment {
    const rec = createSegment();
    this.segments[i] = rec;
    this.aoPool[i] = makeSprite(this.streakBand, 'multiply', this.aoLayer);
    this.shadowPool[i] = makeSprite(this.streakSoft, 'multiply', this.shadowLayer);
    this.glowPool[i] = makeSprite(this.streakSoft, 'add', this.glowLayer);
    this.corePool[i] = makeSprite(this.streakCore, 'add', this.coreLayer);
    this.rimPool[i] = makeSprite(this.streakCore, 'add', this.rimLayer);
    this.plumePool[i] = makeSprite(this.radialSoft, 'add', this.plumeLayer);
    return rec;
  }

  private hideAll(): void {
    this.count = 0;
    this.dusk.visible = false;
    for (const s of this.aoPool) s.visible = false;
    for (const s of this.shadowPool) s.visible = false;
    for (const s of this.glowPool) s.visible = false;
    for (const s of this.corePool) s.visible = false;
    for (const s of this.rimPool) s.visible = false;
    for (const s of this.plumePool) s.visible = false;
  }
}
