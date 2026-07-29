/**
 * 카르곤 컬러 그레이딩·비네트 레이어 (슬롯 `post` — 최상단, HUD 아래).
 *
 * ## 이 레이어가 하는 일
 * 실제 AAA 타이틀이 스크린샷 한 장만으로 "완성된 게임"처럼 보이는 큰 이유는 최종 톤 패스다.
 * 요소마다 색이 따로 노는 화면을 ①가장자리 비네트로 시선을 중앙에 모으고 ②하이라이트·그림자의
 * 색온도를 갈라 화면 전체에 하나의 성격을 주고 ③미세 그레인으로 그라디언트 밴딩을 깨서
 * 한 장의 그림으로 묶는다. 카르곤은 발밑이 용암이라 **아래가 따뜻하고 위가 차갑다** —
 * 그래서 비네트도 완전 대칭이 아니라 밝은 코어를 살짝 아래로 내려 위쪽을 더 눌렀다.
 *
 * ## 이 레이어가 할 수 있는 것의 한계 (설계의 출발점)
 * `post` 슬롯의 스프라이트 합성으로 표현 가능한 연산은 **목적지 색 c 에 대한 위치별 아핀 사상**
 * 하나뿐이다:
 *
 * ```
 *   c' = M(x,y) · c + A(x,y)      // M = multiply 스프라이트들의 곱, A = add 스프라이트들의 합
 * ```
 *
 * 여기서 두 가지가 **원리적으로 불가능**하다.
 *
 * 1. **전경/배경 대비 개선.** 아핀 사상은 두 색의 차를 |M| 배로 줄일 뿐 결코 늘리지 못한다.
 *    즉 "주황 바닥만 눌러 흰 탄환을 띄운다"는 post 에서 성립하지 않는다. 유일하게 남는 선택성은
 *    채널 가중(주황은 R 지배 32.7%, 청록 함선은 R 7.5%)인데, 알파 상한 0.3 안에서 유효 차이가
 *    1% 미만이라 실효가 없다. → **배경 명도 캡은 타일셋·시차 레인(배경 전용 슬롯)의 몫**이다.
 * 2. **진짜 톤 커브(하이라이트 롤오프·블랙포인트 압축).** 둘 다 c 의 비선형 함수라 아핀으로는
 *    표현할 수 없다. 풀스크린 셰이더 없이는 도달 불가.
 *
 * 슬롯을 `floor` 로 옮기면 1 은 풀리지만 비네트·전역 톤을 잃는다. 두 슬롯을 동시에 쓰려면 새
 * 레이어 **파일**이 필요한데(`slot` 은 클래스당 하나이고, `envWiring.test.ts` 가 "레지스트리
 * 레이어 수 = 모듈 수"를 잠근다) 그건 이 레인의 소유 범위 밖이다. 그래서 이 레이어는 post 에
 * 남아 **아핀으로 실제 도달 가능한 것**에 집중한다 — 아래의 스플릿 톤이다.
 *
 * ## 스플릿 톤 = lift/gain 이중성 (아핀으로 도달 가능한 톤 분리)
 * 아핀 사상의 두 항은 서로 다른 명도 대역을 지배한다. 이게 필름 그레이딩의 lift/gain 그 자체다.
 *
 * - **A(add) = lift → 암부를 지배한다.** 검정에 가까운 화소는 c≈0 이라 결과가 사실상 A 의 색이
 *   된다. 밝은 화소에서는 상대 기여가 1/10 로 묻힌다.
 * - **M(multiply) = gain → 하이라이트를 지배한다.** 검정은 어떤 M 을 곱해도 검정이라 절대
 *   변화량이 0 이고, 밝은 화소일수록 절대 변화량이 c 에 **비례해** 커진다.
 *
 * 그래서 {@link SHADOW_TINT}(청보라)를 add 로, {@link TONE_GAIN_TINT}(황백)를 multiply 로 깔면
 * 중성 회색 g 의 전달함수 {@link toneMap} 이 **암부 청보라 → 하이라이트 황백**으로 단조롭게
 * 건너간다(교차점 g≈0.58). 이것이 "명도 2단계(주황/검정)" 인상을 깨는 색상 다리다.
 *
 * 부수 효과 두 가지가 비평 항목을 그대로 덮는다:
 * - **하이라이트 가중 감쇠(롤오프의 아핀 근사).** gain 의 절대 밝기 손실은 c 에 정비례하므로
 *   최상단은 9/255 를 잃고 어두운 바닥은 1/255 도 안 잃는다.
 * - **블랙포인트가 뜨지 않는다.** SHADOW_TINT 를 R=0 인 순청색 계열로 잡아 휘도 기여를 0.14 로
 *   눌렀다 — 암부 채도는 (B−R) 12→22 로 87% 오르는데 암부 휘도는 +3.5% 만 오른다.
 *
 * ## 시차 레인과의 웜 중복 해소
 * 이전 판은 하단 가산 웜(`warm`)이 화면 중턱(ny≥0.15)부터 올라와, 주황을 밝히는 시차 레이어와
 * 같은 방향으로 겹쳐 상단 주황이 노랑 포화 직전까지 갔다. 이번 판은 ①웜 알파를 0.10→0.045 로
 * 절반 이하로 줄이고 ②시작 지점을 ny 0.15→0.45 로 내려 화면 하단 1/4 에만 남겼다. 전역
 * 따뜻함은 가산(밝히기)이 아니라 gain(곱연산, 어둡히기)이 맡으므로 포화를 밀어올리지 않는다 —
 * 오히려 shadow lift 의 파랑이 주황 채도를 0.73→0.69 로 떨어뜨려 노랑 클리핑에서 멀어진다.
 *
 * ## 가장 위험한 레이어다 (가독성 상한)
 * 이 레이어만 화면 **전체**를 덮는다. 즉 잘못 만들면 전투 자체가 안 보인다. 그래서 세 가지를
 * 코드 상수로 못 박고 테스트로 잠갔다:
 *
 *  1. **어떤 요소도 {@link LAYER_MAX_ALPHA} 를 넘지 않는다.** 티어·설정 어떤 조합에서도.
 *  2. **화면 중앙({@link CENTER_SAFE_RADIUS} 반경)은 사실상 손대지 않는다** — 플레이어와 근접
 *     전투가 벌어지는 곳이라 {@link CENTER_MIN_RETENTION} 이상의 밝기를 반드시 남긴다.
 *     비네트·색온도는 중앙에서 0 이고, 전역 gain 만 3.6% 를 먹어 잔존율은 96.4% 다
 *     (이전 판에서는 중앙 감쇠가 정확히 0 이라 이 상한이 항진 조건이었다 — 이제 실제로 잠근다).
 *  3. **가장자리는 "적이 안 보일 만큼" 어둡히지 않는다.** 이 게임은 적이 화면 밖에서 들어온다.
 *     화면 어느 지점에서도 밝기 손실이 {@link EDGE_MAX_DARKENING} 을 넘지 않는다 — 좌우 변
 *     중앙은 약 17%, 최악인 상단 모서리도 약 35% 라 실루엣 대비는 그대로 남는다.
 *     **전역 gain 이 새로 먹는 3.6% 만큼 {@link COOL_MAX_ALPHA} 를 0.12→0.06 으로 줄여**
 *     모서리 최대 감쇠를 이전 판(0.3493)과 사실상 같은 0.3490 으로 유지했다.
 *
 * ## 기술 규율
 * - **화면 고정**: 카메라를 무시하고 {@link EnvFrame} 의 view 사각형에 정확히 맞춘다. 레터박스
 *   띠를 칠하지 않는 유일한 방법은 "화면보다 크게 깔고 넘치게" 가 아니라 매 프레임 그 사각형에
 *   정확히 스냅하는 것이다(리포에 레터박스 오염 선례가 있다).
 * - **결정론(ADR-0005)**: `Math.random`·`performance.now` 금지. 그레인 위상은 `seed` + `tick`
 *   의 순수 해시({@link file://./noise.ts})다.
 * - **성능**: 스프라이트 4장. 텍스처는 첫 `configure` 에서만 굽고 캐시한다. 매 프레임 할당 0
 *   (설정 스냅샷은 구독으로 캐시하고, 티어는 무할당 getter 로 읽는다). 풀스크린 필터 미사용.
 * - **테스트 안전**: `ctx.renderer` 가 없으면 1×1 흰 텍스처로 대체해 기하만 유지한다(던지지 않고,
 *   화면 기여도 없다) — 사각형 정합·상한 검증은 GL 없이도 성립한다.
 */

import { Container, Graphics, Rectangle, Sprite, Texture, TilingSprite } from 'pixi.js';
import type { Renderer } from 'pixi.js';
import { hash3 } from './noise.js';
import { graphicsTierController } from '../graphicsRuntime.js';
import { effectGates, type QualityTier } from '../qualityTier.js';
import { graphicsSettings, type GraphicsSettings } from '../graphicsSettings.js';
import type { EnvContext, EnvFrame, EnvLayer } from './types.js';

/** 카르곤 행성 인덱스. 레지스트리(planetEnvironment.ts)와 같은 값이며 순환 import 를 피해 지역 상수로 둔다. */
const KARGON_PLANET = 0;

// ───────────────────────── 가독성 상한 (전부 하드 상수 — 테스트가 잠근다) ─────────────────────────

/**
 * **이 레이어의 어떤 요소도 이 알파를 넘지 못한다.** 티어·감소 토글 어떤 조합에서도.
 * 화면 전체를 덮는 레이어의 유일한 안전장치라 파생값이 아니라 상수로 둔다.
 */
export const LAYER_MAX_ALPHA = 0.3;

/** 비네트 스프라이트 최대 알파(=모서리 최대 감쇠). 현대 AAA 비네트의 통상 대역(20~40%) 안쪽. */
export const VIGNETTE_MAX_ALPHA = 0.28;

/**
 * 차가운(보라-남색) 곱연산 최대 알파. 상단·좌우 가장자리 한정.
 *
 * 0.12 → 0.06. 전역 {@link TONE_GAIN_MAX_ALPHA} 가 색온도 분리를 떠맡으면서 이 스프라이트는
 * **가장자리 형상**만 담당하면 되고, 줄인 만큼이 정확히 gain 이 새로 먹는 감쇠 예산이 된다
 * (모서리 최대 감쇠 총합 불변 — 위 3번 참고).
 */
export const COOL_MAX_ALPHA = 0.06;

/**
 * 따뜻한(주황) **가산** 최대 알파. 하단 한정.
 *
 * 0.10 → 0.045. 시차 레이어도 주황을 밝히는 방향(+)이라 두 레이어가 겹쳐 상단 주황이 노랑
 * 포화 직전까지 갔다. 전역 따뜻함은 이제 곱연산 gain 이 맡으므로 여기는 "용암 반사광" 이라는
 * 국소 근거가 있는 최소량만 남긴다.
 */
export const WARM_MAX_ALPHA = 0.045;

/**
 * 전역 **gain**(곱연산) 최대 알파. 화면 전체에 균일하게 깔린다(위치 의존 없음).
 *
 * lift/gain 이중성에서 gain 은 하이라이트를 지배한다 — 절대 밝기 손실이 c 에 정비례하므로
 * 이것이 **하이라이트 롤오프의 아핀 근사**이자 하이라이트 색조(황백)의 담당이다.
 * 알파가 상한에 붙어 있는 이유는 tint 자체가 순한(휘도 0.879) 색이라 알파를 키워도 총 감쇠가
 * {@link TONE_GAIN_LUMA_LOSS} 로 4% 미만이기 때문이다.
 */
export const TONE_GAIN_MAX_ALPHA = 0.3;

/**
 * 전역 **lift**(가산) 최대 알파. 화면 전체에 균일하게 깔린다(위치 의존 없음).
 *
 * lift 는 암부를 지배한다 — 검정에 가까운 화소는 결과가 사실상 {@link SHADOW_TINT} 의 색이 된다.
 * 이 값이 곧 암부 청보라 색조의 세기다. 더 키우면 블랙포인트가 뜨므로(우유빛) 여기서 멈춘다.
 */
export const SHADOW_MAX_ALPHA = 0.055;

/** 필름 그레인 최대 알파. 밴딩을 깨는 최소량이며 이 이상은 화면이 지저분해진다. */
export const GRAIN_MAX_ALPHA = 0.035;

/**
 * 중앙 안전 반경(정규 좌표 [-1,1] 기준). 이 사각형 안은 플레이어와 근접 전투 영역이라
 * {@link CENTER_MIN_RETENTION} 이상의 밝기를 반드시 남긴다.
 */
export const CENTER_SAFE_RADIUS = 0.35;

/** 중앙 안전 영역에서 반드시 남겨야 하는 최소 밝기 비율(1 = 원본 그대로). */
export const CENTER_MIN_RETENTION = 0.94;

/**
 * **화면 어느 지점에서도** 이 레이어가 깎는 밝기 비율의 상한. 적은 화면 밖에서 들어오므로
 * 가장자리·모서리가 그대로 판정 대상이다. 테스트가 프레임 전체 격자를 훑어 잠근다.
 */
export const EDGE_MAX_DARKENING = 0.36;

// ───────────────────────── 비네트 형상 ─────────────────────────

/**
 * 비네트 밝은 코어의 세로 오프셋(정규 좌표, +가 아래). 카르곤은 발밑 용암이 더 뜨거우므로
 * 코어를 살짝 **아래로** 내려 위쪽 하늘을 더 누른다 — 완전 대칭보다 장면에 방향감이 생긴다.
 * 중앙 안전 반경보다 훨씬 작게 두어 플레이어가 코어 밖으로 밀려나지 않는다.
 */
export const VIGNETTE_CENTER_Y = 0.1;

/** 비네트가 시작되는 정규 거리. 이 안쪽은 감쇠 0(= 중앙 무보정). */
export const VIGNETTE_INNER = 0.65;

/** 비네트가 최대에 도달하는 정규 거리. 최원거리 모서리(약 1.49)가 거의 최대에 닿도록 잡았다. */
export const VIGNETTE_OUTER = 1.55;

// ───────────────────────── 색 ─────────────────────────

/** 하단 열기(가산). 용암 반사광 계열 주황. */
const WARM_TINT = 0xff8a3c;

/** 상단·가장자리 그림자(곱연산). 보라-남색으로 하이라이트와 색온도를 가른다. */
const COOL_TINT = 0x6a5aa8;

/** 그레인 색(가산). 무채에 가깝게 두어 색을 밀지 않는다. */
const GRAIN_TINT = 0xb0b0c0;

/**
 * **하이라이트 색조(황백)** — 전역 gain(곱연산)의 tint.
 *
 * R=255 로 못 박은 것은 계약이다: 곱연산 R 계수가 1 이면 흰 화소의 R 이 손실 0 이라
 * {@link toneMap}(1) 이 오버플로 없이 정확히 R=1 로 착지하고, 그 덕에 전달함수의 warmth
 * `R−B` 가 [0,1] 전 구간에서 클리핑 없이 **엄밀 단조**가 된다. G·B 만 낮춰 하이라이트를
 * 황백으로 기울이고, 그 낮춘 만큼이 곧 하이라이트 가중 감쇠(롤오프 근사)다.
 */
const TONE_GAIN_TINT = 0xffdcae;

/**
 * **암부 색조(청보라)** — 전역 lift(가산)의 tint.
 *
 * R=0 인 순청-보라 계열을 고른 이유는 **채도 대비 휘도가 싸기** 때문이다. Rec.709 에서 B 의
 * 가중치는 0.0722 로 G(0.7152)의 1/10 이라, B 를 크게 밀어도 밝기가 거의 안 오른다 — 암부
 * 채도는 크게 올리면서 블랙포인트는 거의 그대로 두는 유일한 방향이다(암부 B−R 12→22 = +83%,
 * 암부 휘도 +3.5%). R 을 섞으면 암부가 탁한 보라로 뜨면서 휘도만 손해다.
 */
const SHADOW_TINT = 0x0018ff;

// ───────────────────── tint → 휘도 파생 (손으로 적은 상수 금지) ─────────────────────

/** Rec.709 상대 휘도 가중치. */
const REC709 = [0.2126, 0.7152, 0.0722] as const;

/** 0xRRGGBB → [r,g,b] (각 [0,1]). 순수. */
export function tintChannels(hex: number): [number, number, number] {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

/** 0xRRGGBB → Rec.709 상대 휘도 [0,1]. 순수. */
export function tintLuma(hex: number): number {
  const c = tintChannels(hex);
  return REC709[0] * c[0] + REC709[1] * c[1] + REC709[2] * c[2];
}

/**
 * 차가운 곱연산이 실제로 깎는 밝기 비율(알파 1 기준). 곱연산은 알파만큼 검게 만드는 것이 아니라
 * `tint` 의 휘도만큼만 남기므로, 알파를 그대로 감쇠로 세면 과대평가다. COOL_TINT(0x6a5aa8)의
 * Rec.709 휘도는 약 0.39 이므로 손실은 약 0.61 이다.
 *
 * 상수를 손으로 적지 않고 tint 에서 파생한다 — 색을 바꿨는데 감쇠 상수가 따라오지 않아 가독성
 * 상한이 조용히 뚫리는 것을 구조적으로 막는다.
 */
const COOL_LUMA_LOSS = 1 - tintLuma(COOL_TINT);

/** 전역 gain 이 알파 1 기준으로 깎는 밝기 비율(약 0.121). */
export const TONE_GAIN_LUMA_LOSS = 1 - tintLuma(TONE_GAIN_TINT);

/** 전역 lift 가 알파 1 기준으로 더하는 밝기(약 0.140). */
export const SHADOW_LUMA_GAIN = tintLuma(SHADOW_TINT);

// ───────────────────────── 텍스처 굽기 파라미터 ─────────────────────────

/** 비네트 텍스처 한 변(px). 스프라이트로 늘려 쓰므로 작아도 되고, 선형 보간이 계단을 녹인다. */
const VIGNETTE_TEX = 256;

/** 비네트 링 개수. 링당 알파 증분이 1/64 라 늘렸을 때 밴딩이 보이지 않는다. */
const VIGNETTE_RINGS = 64;

/** 색온도 그라디언트 텍스처 격자(가로 × 세로 셀). 한 번만 굽는다. */
const GRADIENT_COLS = 24;
const GRADIENT_ROWS = 96;

/** 그레인 타일 한 변(px). TilingSprite 로 반복하므로 작게 굽는다. */
const GRAIN_TEX = 64;

/** 그레인 위상 갱신 주기(sim 틱). 매 틱 바꾸면 지글거림이 과하다. */
const GRAIN_PHASE_TICKS = 4;

// ───────────────────────── 순수 프로파일 함수 (테스트가 직접 검증한다) ─────────────────────────

/** [a,b] 구간 smoothstep. a=b 방어 포함. b<a 면 방향이 뒤집힌다(위쪽 그라디언트에 쓴다). */
function smooth01(a: number, b: number, x: number): number {
  if (a === b) return x >= b ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * 비네트 감쇠 프로파일 → [0,1]. 정규 화면 좌표(nx,ny ∈ [-1,1], ny=+1 이 화면 아래)를 받는다.
 * 실제 화면 감쇠는 이 값 × {@link GradeStrengths.vignette} 다.
 */
export function vignetteProfile(nx: number, ny: number): number {
  const dy = ny - VIGNETTE_CENTER_Y;
  return smooth01(VIGNETTE_INNER, VIGNETTE_OUTER, Math.hypot(nx, dy));
}

/**
 * 시차 레이어와의 웜 중복을 피하기 위해 따뜻한 가산이 시작되는 세로 위치(정규 좌표, +가 아래).
 * 0.15 → 0.45: 화면 **하단 1/4** 밖으로는 한 픽셀도 밝히지 않는다.
 */
export const WARM_START_Y = 0.45;

/**
 * 따뜻한 가산 프로파일 → [0,1]. 화면 **하단 중앙**에 몰린다(좌우로 갈수록 약해진다).
 * 중앙(ny=0)은 물론 {@link WARM_START_Y} 위쪽 전체가 정확히 0 이라 전투 영역과 상단 주황
 * 대역(시차 레이어가 이미 밝히는 곳)을 건드리지 않는다.
 */
export function warmProfile(nx: number, ny: number): number {
  return smooth01(WARM_START_Y, 1, ny) * (1 - 0.45 * nx * nx);
}

/**
 * 차가운 곱연산 프로파일 → [0,1]. **상단**과 **좌우 가장자리** 중 강한 쪽을 취한다.
 * 중앙(0,0)에서 0.
 */
export function coolProfile(nx: number, ny: number): number {
  const top = smooth01(-0.2, -1, ny);
  const side = smooth01(0.65, 1.05, Math.abs(nx));
  return Math.max(top, side);
}

/**
 * 그 지점에서 이 레이어가 깎는 밝기의 **상계**. 비네트(검정 알파 합성)와 차가운 곱연산(휘도
 * 손실 {@link COOL_LUMA_LOSS} 배)을 더한다. 가산(warm)·그레인은 밝히는 쪽이라 세지 않으므로
 * 이 값이 곧 최악의 어두워짐이다.
 *
 * 전역 gain 은 위치와 무관하게 항상 들어가므로 화면 어디서나 바닥값으로 깔린다 — 이 항 때문에
 * 중앙 잔존율 상한이 비로소 항진이 아닌 **실제 구속**이 된다.
 *
 * 테스트가 두 가지를 잠근다: 중앙 안전 영역에서 `1 - darkeningBound ≥ CENTER_MIN_RETENTION`,
 * 그리고 프레임 전체에서 `darkeningBound ≤ EDGE_MAX_DARKENING`.
 */
export function darkeningBound(nx: number, ny: number, s: GradeStrengths): number {
  return (
    vignetteProfile(nx, ny) * s.vignette +
    coolProfile(nx, ny) * s.cool * COOL_LUMA_LOSS +
    s.gain * TONE_GAIN_LUMA_LOSS
  );
}

/**
 * **톤 전달함수** — 중성 회색 입력 `g ∈ [0,1]` 이 전역 톤(gain + lift)을 통과한 뒤의 RGB.
 * 위치 의존 요소(비네트·cool·warm)는 제외한 **화면 어디서나 공통인 부분**만 담는다.
 *
 * ```
 *   out_ch = g · (1 − a_gain + a_gain · gainTint_ch) + a_shadow · shadowTint_ch
 * ```
 *
 * 클리핑하지 않는다 — 디스플레이가 [0,1] 로 자르는 것과 별개로, 이 함수는 **전달함수 자체**라
 * 단조성·교차점 같은 성질을 클리핑에 가려지지 않은 채로 검증할 수 있어야 한다.
 * (실제로 {@link TONE_GAIN_TINT} 의 R=255 계약 덕분에 g=1 에서도 오버플로가 없다.)
 */
export function toneMap(g: number, s: GradeStrengths): [number, number, number] {
  const gain = tintChannels(TONE_GAIN_TINT);
  const shadow = tintChannels(SHADOW_TINT);
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    out[c] = g * (1 - s.gain + s.gain * gain[c]!) + s.shadow * shadow[c]!;
  }
  return out;
}

/**
 * 그 명도에서 톤이 얼마나 **따뜻한가** (= R − B). 음수면 차갑다(청보라), 양수면 따뜻하다(황백).
 *
 * 스플릿 톤의 정의가 곧 "이 값이 명도에 대해 **엄밀 단조 증가**하고 중간 명도에서 부호가 바뀐다"
 * 이다. 아핀 사상이라 기울기는 `s.gain · (1 − gainTint_B)` 로 상수이며, 절편은
 * `−s.shadow · shadowTint_B` 다 — 즉 두 항 중 **하나라도 죽으면 스플릿이 사라진다**.
 */
export function toneWarmth(g: number, s: GradeStrengths): number {
  const t = toneMap(g, s);
  return t[0] - t[2];
}

// ───────────────────────── 품질 티어 대응 ─────────────────────────

/** 이 레이어가 프레임마다 쓰는 강도 스냅샷. 티어·설정이 바뀔 때만 다시 계산한다. */
export interface GradeStrengths {
  /** 비네트 스프라이트 알파. */
  vignette: number;
  /** 따뜻한 가산 스프라이트 알파. */
  warm: number;
  /** 차가운 곱연산 스프라이트 알파. */
  cool: number;
  /** 전역 gain(곱연산, 황백) 스프라이트 알파 — 하이라이트 색조 + 하이라이트 가중 감쇠. */
  gain: number;
  /** 전역 lift(가산, 청보라) 스프라이트 알파 — 암부 색조. */
  shadow: number;
  /** 그레인 스프라이트 알파(0 이면 그레인 자체를 끈다). */
  grain: number;
  /** 그레인 위상 애니메이션 여부. `reducedMotion` 에서 정지한다. */
  grainAnimation: boolean;
}

/** 티어별 전체 배율. 상위 티어가 하위의 상위집합이 되도록 단조 증가. */
const TIER_SCALE: Record<QualityTier, number> = { low: 0.7, med: 0.86, high: 1 };

/**
 * (티어 × 그래픽 설정) → 강도 스냅샷(순수함수).
 *
 * 단조성이 계약이다 — low ≤ med ≤ high 이고, `reducedGlow`·`reducedMotion` 은 어떤 필드도
 * 키우지 않는다. 그래야 "접근성 토글을 켰더니 더 세졌다" 같은 결함이 구조적으로 불가능해진다.
 *
 * - `reducedGlow` → 따뜻한 **가산** 기운을 크게 줄인다(halo·bloom 과 같은 발광 감소축).
 *   티어와 직교인 접근성 축이므로 티어와 무관하게 항상 줄어든다.
 * - `reducedMotion` → 그레인 애니메이션을 끄고 양도 줄인다(모션 감소축).
 * - low 티어 → 그레인 자체를 끈다(저사양에서 풀스크린 타일링은 순이익이 없다). 티어 판정은
 *   자체 표를 만들지 않고 {@link effectGates} 의 `trails`(저티어에서 꺼지는 부가 장식 축)를
 *   그대로 쓴다 — 티어 표가 개정되면 이 레이어도 같이 따라간다.
 */
export function gradeStrengths(tier: QualityTier, settings: GraphicsSettings): GradeStrengths {
  const k = TIER_SCALE[tier];
  const gates = effectGates(tier, settings);
  const glow = settings.reducedGlow ? 0.35 : 1;
  const grainBase = gates.trails ? GRAIN_MAX_ALPHA : 0;
  const motion = settings.reducedMotion ? 0.5 : 1;
  return {
    vignette: VIGNETTE_MAX_ALPHA * k,
    warm: WARM_MAX_ALPHA * k * glow,
    cool: COOL_MAX_ALPHA * k,
    // gain·shadow 는 티어에만 반응한다. 둘 다 접근성 축(발광·모션)과 무관한 **톤 성격**이고,
    // 한쪽만 티어 외 배율로 줄이면 스플릿 톤의 교차점이 설정에 따라 움직여 화면 성격이 갈린다.
    gain: TONE_GAIN_MAX_ALPHA * k,
    shadow: SHADOW_MAX_ALPHA * k,
    grain: grainBase * k * motion,
    grainAnimation: grainBase > 0 && !settings.reducedMotion,
  };
}

// ───────────────────────── 레이어 ─────────────────────────

export class KargonGradeLayer implements EnvLayer {
  readonly name = 'kargon-grade';
  readonly slot = 'post' as const;
  readonly view = new Container();

  /** 굽은 텍스처 캐시(첫 configure 1회). destroy 에서만 해제한다. */
  private vignetteTex: Texture | null = null;
  private warmTex: Texture | null = null;
  private coolTex: Texture | null = null;
  private grainTex: Texture | null = null;

  private vignette: Sprite | null = null;
  private warm: Sprite | null = null;
  private cool: Sprite | null = null;
  private grain: TilingSprite | null = null;
  /** 전역 톤 두 장. 균일해서 굽지 않는다 — `Texture.WHITE` 를 늘려 쓴다(bake 0). */
  private toneGain: Sprite | null = null;
  private shadowLift: Sprite | null = null;

  private seed = 0;
  private strengths: GradeStrengths = gradeStrengths('high', graphicsSettings.getSettings());
  /** 강도 재계산 트리거용. 설정은 구독으로, 티어는 매 프레임 무할당 비교로 감시한다. */
  private settingsSnapshot: GraphicsSettings = graphicsSettings.getSettings();
  private lastTier: QualityTier | null = null;
  private unsubscribe: (() => void) | null = null;
  /** 텍스처가 실제로 구워졌는지(=화면에 기여하는지). 없으면 알파를 0 으로 눕힌다. */
  private hasTextures = false;

  configure(ctx: EnvContext): boolean {
    if (ctx.planet !== KARGON_PLANET) return false;
    this.seed = ctx.seed | 0;
    this.build(ctx.renderer);
    // 설정은 이벤트로만 바뀌므로 구독해 캐시한다 — 매 프레임 getSettings() 는 객체를 새로 만든다.
    if (this.unsubscribe === null) {
      this.unsubscribe = graphicsSettings.onChange((s) => {
        this.settingsSnapshot = s;
        this.lastTier = null; // 다음 update 에서 강제 재계산.
      });
    }
    this.settingsSnapshot = graphicsSettings.getSettings();
    this.lastTier = null;
    return true;
  }

  update(f: EnvFrame): void {
    // 티어는 무할당 getter. 바뀌었거나 설정이 바뀌었을 때만 강도를 다시 만든다(프레임 할당 0).
    const tier = graphicsTierController.getActiveTier();
    if (tier !== this.lastTier) {
      this.lastTier = tier;
      this.strengths = gradeStrengths(tier, this.settingsSnapshot);
      this.applyStrengths();
    }

    const x = f.viewMinX;
    const y = f.viewMinY;
    const w = f.viewMaxX - f.viewMinX;
    const h = f.viewMaxY - f.viewMinY;
    // 폭·높이가 0 이하인 프레임(초기화 직전)은 스프라이트 기하를 건드리지 않는다.
    if (!(w > 0) || !(h > 0)) return;

    this.fit(this.toneGain, x, y, w, h);
    this.fit(this.vignette, x, y, w, h);
    this.fit(this.warm, x, y, w, h);
    this.fit(this.cool, x, y, w, h);
    this.fit(this.shadowLift, x, y, w, h);

    const grain = this.grain;
    if (grain !== null) {
      grain.position.set(x, y);
      grain.width = w;
      grain.height = h;
      if (this.strengths.grainAnimation) {
        // 결정적 위상: seed + 틱 버킷 해시. performance.now 금지(리플레이 재현성).
        const bucket = Math.floor(f.tick / GRAIN_PHASE_TICKS);
        const ox = hash3(this.seed, bucket, 0, 11) * GRAIN_TEX;
        const oy = hash3(this.seed, bucket, 0, 23) * GRAIN_TEX;
        grain.tilePosition.set(Math.floor(ox), Math.floor(oy));
      }
    }
  }

  resize(_width: number, _height: number): void {
    // 기하는 매 프레임 view 사각형에 스냅하므로(update) 여기서 할 일이 없다. 오히려 여기서
    // design 크기로 맞추면 레터박스·오버스캔 화면에서 사각형이 어긋난다.
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.view.destroy({ children: true });
    for (const t of [this.vignetteTex, this.warmTex, this.coolTex, this.grainTex]) {
      t?.destroy(true);
    }
    this.vignetteTex = null;
    this.warmTex = null;
    this.coolTex = null;
    this.grainTex = null;
    this.vignette = null;
    this.warm = null;
    this.cool = null;
    this.grain = null;
    this.toneGain = null;
    this.shadowLift = null;
  }

  /**
   * 진단·테스트용: 화면을 덮는 스프라이트들(순서는 렌더 순서).
   * **그레인은 항상 마지막**이다(위상 검증이 마지막 원소를 TilingSprite 로 읽는다).
   */
  get overlays(): readonly (Sprite | TilingSprite)[] {
    const out: (Sprite | TilingSprite)[] = [];
    if (this.toneGain !== null) out.push(this.toneGain);
    if (this.cool !== null) out.push(this.cool);
    if (this.vignette !== null) out.push(this.vignette);
    if (this.shadowLift !== null) out.push(this.shadowLift);
    if (this.warm !== null) out.push(this.warm);
    if (this.grain !== null) out.push(this.grain);
    return out;
  }

  /** 진단·테스트용: 현재 적용 중인 강도 스냅샷. */
  get activeStrengths(): GradeStrengths {
    return this.strengths;
  }

  // ── 내부 ──

  /** 스프라이트를 view 사각형에 **정확히** 맞춘다(넘치지도, 모자라지도 않게). */
  private fit(s: Sprite | null, x: number, y: number, w: number, h: number): void {
    if (s === null) return;
    s.position.set(x, y);
    s.width = w;
    s.height = h;
  }

  /** 첫 configure 1회. 텍스처를 굽고 스프라이트를 만든다(재구성은 하지 않는다). */
  private build(renderer: Renderer | undefined): void {
    if (this.vignette !== null) return;

    this.vignetteTex = renderer ? bakeVignette(renderer) : null;
    this.warmTex = renderer ? bakeGradient(renderer, warmProfile) : null;
    this.coolTex = renderer ? bakeGradient(renderer, coolProfile) : null;
    this.grainTex = renderer ? bakeGrain(renderer, this.seed) : null;

    // 렌더 순: 전역 gain(곱) → 차가운 가장자리(곱) → 비네트(검정) → 전역 lift(가산) →
    // 따뜻한 하단(가산) → 그레인(가산). 곱연산을 먼저 다 태우고 가산을 얹어야 lift 가 gain 에
    // 다시 곱해지지 않는다(= 전달함수 `c·M + A` 와 실제 합성이 일치한다).
    this.toneGain = new Sprite(Texture.WHITE);
    this.toneGain.tint = TONE_GAIN_TINT;
    this.toneGain.blendMode = 'multiply';

    this.cool = new Sprite(this.coolTex ?? Texture.WHITE);
    this.cool.tint = COOL_TINT;
    this.cool.blendMode = 'multiply';

    this.vignette = new Sprite(this.vignetteTex ?? Texture.WHITE);
    this.vignette.tint = 0x000000;

    this.shadowLift = new Sprite(Texture.WHITE);
    this.shadowLift.tint = SHADOW_TINT;
    this.shadowLift.blendMode = 'add';

    this.warm = new Sprite(this.warmTex ?? Texture.WHITE);
    this.warm.tint = WARM_TINT;
    this.warm.blendMode = 'add';

    this.grain = new TilingSprite({ texture: this.grainTex ?? Texture.WHITE, width: 1, height: 1 });
    this.grain.tint = GRAIN_TINT;
    this.grain.blendMode = 'add';

    // 렌더러가 없으면(테스트) 텍스처가 1×1 흰색이라 화면 기여가 의미 없다 — 알파 0 으로 눕혀
    // "GL 없는 환경에서 흰 사각형이 깔리는" 사고를 원천 차단한다. 기하는 그대로 유지된다.
    // 전역 톤 두 장은 Texture.WHITE 라 렌더러 없이도 "진짜" 텍스처지만, 여기서 함께 눕힌다 —
    // 나머지 레이어가 빠진 반쪽 화면에 톤만 적용되는 상태를 만들지 않기 위한 일관성이다.
    if (renderer === undefined) {
      for (const s of [this.toneGain, this.cool, this.vignette, this.shadowLift, this.warm, this.grain]) {
        s.alpha = 0;
      }
      this.hasTextures = false;
    } else {
      this.hasTextures = true;
    }

    this.view.addChild(
      this.toneGain,
      this.cool,
      this.vignette,
      this.shadowLift,
      this.warm,
      this.grain,
    );
    this.applyStrengths();
  }

  /** 강도 스냅샷을 스프라이트 알파에 반영. 상한을 여기서 한 번 더 강제한다(이중 안전장치). */
  private applyStrengths(): void {
    const s = this.strengths;
    const cap = (v: number): number => (this.hasTextures ? Math.min(LAYER_MAX_ALPHA, v) : 0);
    if (this.cool !== null) this.cool.alpha = cap(s.cool);
    if (this.vignette !== null) this.vignette.alpha = cap(s.vignette);
    if (this.warm !== null) this.warm.alpha = cap(s.warm);
    if (this.toneGain !== null) this.toneGain.alpha = cap(s.gain);
    if (this.shadowLift !== null) this.shadowLift.alpha = cap(s.shadow);
    if (this.grain !== null) {
      this.grain.alpha = cap(s.grain);
      this.grain.visible = s.grain > 0;
    }
  }
}

// ───────────────────────── 텍스처 굽기 (configure 1회, 매 프레임 금지) ─────────────────────────

/**
 * 비네트 텍스처. 동심 **링 스트로크**를 바깥→안쪽으로 그린다.
 *
 * 채운 원을 겹치면 중앙이 가장 진해져 비네트와 정반대가 되므로, 링을 각자 자기 알파로 한 번씩만
 * 칠한다(서로 겹치지 않으므로 알파가 곧 프로파일 값이다). 링 폭을 1.12 배로 살짝 키워 이음매를
 * 막고, 텍스처 밖으로 나가는 링은 `frame` 으로 잘라 텍스처가 커지는 것을 막는다.
 */
function bakeVignette(renderer: Renderer): Texture {
  const half = VIGNETTE_TEX / 2;
  const cx = half;
  const cy = half * (1 + VIGNETTE_CENTER_Y);
  const step = VIGNETTE_OUTER / VIGNETTE_RINGS;
  const g = new Graphics();
  for (let i = VIGNETTE_RINGS - 1; i >= 0; i--) {
    const r = (i + 0.5) * step;
    const a = smooth01(VIGNETTE_INNER, VIGNETTE_OUTER, r);
    if (a <= 0.002) continue;
    g.circle(cx, cy, r * half).stroke({
      color: 0xffffff,
      width: step * half * 1.12,
      alpha: a,
      alignment: 0.5,
    });
  }
  const tex = renderer.generateTexture({
    target: g,
    frame: new Rectangle(0, 0, VIGNETTE_TEX, VIGNETTE_TEX),
    resolution: 1,
  });
  g.destroy();
  return tex;
}

/**
 * 색온도 그라디언트 텍스처. 정규 좌표 프로파일을 저해상 격자로 구워 스프라이트로 늘린다
 * (선형 보간이 계단을 녹인다 — 셀당 알파 증분이 1/96 이라 밴딩이 보이지 않는다).
 */
function bakeGradient(renderer: Renderer, profile: (nx: number, ny: number) => number): Texture {
  const g = new Graphics();
  for (let j = 0; j < GRADIENT_ROWS; j++) {
    const ny = ((j + 0.5) / GRADIENT_ROWS) * 2 - 1;
    for (let i = 0; i < GRADIENT_COLS; i++) {
      const nx = ((i + 0.5) / GRADIENT_COLS) * 2 - 1;
      const a = profile(nx, ny);
      if (a <= 0.002) continue;
      g.rect(i, j, 1, 1).fill({ color: 0xffffff, alpha: Math.min(1, a) });
    }
  }
  const tex = renderer.generateTexture({
    target: g,
    frame: new Rectangle(0, 0, GRADIENT_COLS, GRADIENT_ROWS),
    resolution: 1,
  });
  g.destroy();
  return tex;
}

/**
 * 필름 그레인 타일. 시드 해시로 만든 결정적 백색 노이즈이며 TilingSprite 로 반복한다.
 * 절반가량의 픽셀만 칠해 드로 수를 줄이고, 알파도 낮게 흩어 뭉침을 피한다.
 */
function bakeGrain(renderer: Renderer, seed: number): Texture {
  const g = new Graphics();
  for (let y = 0; y < GRAIN_TEX; y++) {
    for (let x = 0; x < GRAIN_TEX; x++) {
      const n = hash3(seed, x, y, 7);
      if (n < 0.5) continue;
      g.rect(x, y, 1, 1).fill({ color: 0xffffff, alpha: (n - 0.5) * 2 });
    }
  }
  const tex = renderer.generateTexture({
    target: g,
    frame: new Rectangle(0, 0, GRAIN_TEX, GRAIN_TEX),
    resolution: 1,
  });
  g.destroy();
  return tex;
}
