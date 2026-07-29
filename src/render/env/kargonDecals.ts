/**
 * 카르곤 지형 데칼 산포 레이어 (슬롯 `floor` — 지형 바닥 위·엔티티 아래).
 *
 * ## 무엇을 푸는가
 * 바닥은 16장 Wang 타일셋을 {@link DISPLAY_TILE} 격자로 반복 배치한다
 * ({@link file://../autotile.ts}). 화면 하나에 같은 타일이 수십 장 깔리니 격자 주기가 눈에
 * 그대로 보인다. 이 레이어는 그 위에 **격자와 공명하지 않는 주기**로 데칼(식은 용암 흐름·
 * 균열·비산 자국·크레이터·현무암 자갈·화산재·그을음·대역 변색)을 흩뿌려 반복감을 깨고
 * 지형에 서사를 준다.
 *
 * ## 3차가 고친 것 — 데칼은 "덧칠한 도형"이 아니라 "지면의 국소 명도 변조"다
 * 2차는 화면 기여도를 1.54 → 12.7 로 올렸지만 **품질로 기각**됐다. 기각 사유 둘과 그 근인:
 *
 * ### ① "지면에 붙어 있지 않고 떠 있다 / 어두운 지형 위에서 오히려 밝게 뜬다"
 * 2차 보고는 "곱연산 틴트만 쓰므로 밝아지는 경로가 없다"고 했는데 이건 **틴트와 블렌드 모드를
 * 혼동한 것**이다. Pixi 의 `tint` 는 소스 색을 곱해 낮출 뿐이고, 실제 화면 합성은 그 뒤에
 * 일어나는 **알파 블렌드**다:
 *
 *     normal:   결과 = 바닥 × (1−α) + 소스 × α        ← 소스가 바닥보다 밝으면 **밝아진다**
 *
 * 카르곤 바닥은 밝은 주황 용암(합 ≈ 380)과 거의 검은 현무암(합 ≈ 90)이 공존한다. 2차의
 * `ash`(0x554b40, 합 224)·`craterRim`(합 175)·`stainWarm`(합 208)은 **현무암보다 두 배 밝아서**
 * 어두운 지형 위에서 갈색 얼룩으로 떠올랐다. `MAX_FILL_CHANNEL` 상한은 "젬·적탄과 혼동 금지"만
 * 보장했지 "바닥보다 밝아질 수 없음"은 한 번도 보장한 적이 없다.
 *
 * 3차의 처방은 손잡이 조정이 아니라 **합성 모드 교체**다({@link DECAL_BLEND}):
 *
 *     multiply: 결과 = 바닥 × (1 − α + α × 소스/255)   ← 괄호 안이 항상 ≤ 1 → **절대 못 밝힌다**
 *
 * 이 형태 덕분에 밝아지는 경로가 **수식 수준에서** 사라진다(테스트가 배경 스윕으로 증명한다).
 * 부수 효과가 오히려 본질에 가깝다: 밝은 용암 위에서는 진하게, 어두운 현무암 위에서는 옅게
 * 나타난다 — 그게 "지면 재질의 국소 변조"의 정의다.
 *
 * ⚠️ **팔레트의 의미가 뒤집혔다.** {@link FILL} 은 이제 "칠할 색"이 아니라 **곱할 배수**다.
 * 0xffffff = 변화 없음, 0x000000 = 완전 검정. 그래서 상한/하한이 둘 다 필요하다:
 * {@link MIN_MULTIPLIER_CHANNEL}(검은 구멍 금지) · {@link MAX_MULTIPLIER_CHANNEL}(안 보이는
 * 데칼 금지 — 1차의 실패 모드).
 *
 * ### ② "균열 데칼의 픽셀 해상도가 지형과 다르다"
 * 지형은 {@link SOURCE_TILE_PX}px 원본을 {@link DISPLAY_TILE}px 로 nearest 확대하므로 화면의
 * 최소 단위는 {@link TERRAIN_PIXEL} design px 짜리 **계단 블록**이다. 2차 데칼은 design 좌표에
 * 그대로 그린 뒤 안티에일리어싱된 텍스처를 임의 배율·임의 각도로 얹어서, 같은 화면에 두 개의
 * 픽셀 해상도가 공존했다("엔진이 프로시저럴로 그린 오버레이"라고 읽히는 결정적 단서).
 *
 * 3차는 세 규율로 격자를 통일한다:
 *  1. **저해상도 베이크.** 텍스처를 `resolution = 1/TERRAIN_PIXEL` 로 구워 **1 텍셀 = 지형
 *     원본 1픽셀**이 되게 하고 `scaleMode: 'nearest'`·`antialias: false` 로 뽑는다.
 *  2. **정수 배율.** 스프라이트 스케일은 정수만 허용({@link GridSpec.minScale} 이 정수).
 *     그래야 텍셀 한 변이 `TERRAIN_PIXEL × 정수` 로 유지된다. 게다가 **경계가 또렷한 실루엣
 *     (haze 가 아닌 것)은 배율 1만** 허용해 지형과 정확히 같은 블록 크기로 못 박는다.
 *  3. **런타임 회전 금지.** 임의 각도 회전은 픽셀 격자를 통째로 무너뜨린다. 각도는 **텍스처를
 *     구울 때 기하에 넣고**({@link VARIANT_SPEC}) 래스터라이즈하므로 결과 픽셀은 여전히 축
 *     정렬이다. 좌우 반전과 곱해 겉보기 방향 12종을 얻는다.
 *  또 폴리곤 꼭짓점·선 굵기·반경을 전부 {@link snapPx} 로 지형 격자에 스냅해 굽는다 —
 *  텍셀 경계와 도형 경계가 어긋나 반투명 프린지가 생기는 경로를 없앤다.
 *
 * ### ③ "형태가 사실상 1종"
 * 2차의 큰 데칼 넷(flow·crater·ash·tube)은 전부 "부드러운 타원"이라 실루엣이 구별되지 않았다.
 * 3차는 실루엣을 {@link Silhouette} 6종으로 **명시적 축**으로 만들고(꼬리가 가늘어지는 흐름 ·
 * 위성 방울이 튄 비산 · 각진 균열선 · 파편 무더기 · 테두리 링 · 경계 없는 안개) 표에서 강제한다.
 * 각 실루엣은 그리기 코드가 실제로 다른 함수를 탄다.
 *
 * ### ④ 접지 음영
 * 경계가 또렷한 실루엣에는 바깥 1텍셀 테두리를 {@link FILL.ground}(가장 진한 배수)로 두른다.
 * 가장자리가 안쪽보다 어두우면 "얹힌 판때기"가 아니라 "패인 자국"으로 읽힌다.
 *
 * ## 왜 셀 크기를 타일 크기의 배수로 두면 안 되는가
 * 데칼도 결국 격자(셀)에서 뽑는다. 셀 크기가 타일 크기의 배수면 "반복되는 격자 위에 반복되는
 * 얼룩"이 하나 더 얹힐 뿐이라 **오히려 더 나빠진다**. 그래서 세 산포 격자의 셀 크기를
 * {@link DISPLAY_TILE} 과, 그리고 서로끼리도 **서로소**로 잡았다: {@link MICRO_GRID}=149px,
 * {@link MACRO_GRID}=337px, {@link STAIN_GRID}=787px(전부 소수).
 *
 * ## 왜 크기 층이 셋인가
 * 잔 데칼만 뿌리면 넓게 보면 바닥 톤이 여전히 균일해서 타일 되풀이가 그대로 읽힌다.
 * {@link STAIN_GRID} 는 화면 절반만 한 얼룩을 아주 부드러운 반경 감쇠({@link softBlob})로 깔아
 * 바닥 전체에 큰 스케일 명암 기울기를 만든다.
 *
 * ⚠️ 병렬 레인 주의: 시차 레이어가 **암부 저주파 디테일**을 맡는다. 이 레이어의 대역 변색층과
 * 대역이 겹치면 둘 다 탁해지므로, 3차에서 대역 변색의 알파 상한을 올리지 않았다(오히려 낮췄다).
 * 여기서 번 세기는 중·소 스케일(흐름·비산·균열)의 대비에서 온다.
 *
 * ## 4차가 더한 것 — **암부의 큰 실루엣**(성격이 다른 네 번째 층)
 * 3차는 "떠 보인다 / 픽셀 해상도가 다르다"를 곱연산 전환으로 풀었지만, 비평가는 **해결의 방식이
 * 소거**라고 지적했다: `f-decals` ↔ `f-none` 차이가 육안으로 거의 없다(기여 12.7 → 4.0).
 * 근인은 수식에 있다 — 곱연산의 화면 차이는 `바닥밝기 × α × (1−배수)` 이고, 카르곤 암부는
 * 바닥밝기가 90 언저리라 **어두운 곳에서는 곱연산이 거의 아무 일도 하지 않는다**. 즉 3차의
 * 처방은 밝은 지각 위에서만 일하고 암부에는 도달할 수 없는 구조였다.
 *
 * 그래서 4차는 세기를 올리는 대신 **일의 종류를 하나 더 만든다**: 암부에 형태를 주는
 * 200~400px 급 실루엣({@link RELIEF_GRID} — 암괴 덩어리 · 굳은 흐름 능선 · 재 무더기).
 * 세 가지가 3차와 근본적으로 다르다.
 *
 * ### ① 암부 전용 — 지형 필드를 읽어 배치한다
 * 밝은 지각 위에 놓으면 지각의 균열망과 경쟁한다. 존재 판정에 **지형 필드 게이트**를 건다
 * ({@link reliefSiteIsDark}) — `autotile` 의 {@link terrainFieldAt}/{@link UPPER_THRESHOLD} 를
 * **import** 해서 판정하므로(복제 금지 — `kargonLavaLight` 가 복제로 위상을 잃은 전례가 있다),
 * 타일셋 레인이 임계값을 옮기면 실루엣도 같이 따라간다. 중심 한 점이 아니라 발자국 5점을
 * 전부 검사한다: 큰 실루엣은 3~6타일을 덮으므로 중심만 보면 절반이 용암 위에 걸친다.
 *
 * ### ② 가산 하이라이트 + 곱연산 그림자의 **조합**
 * 곱연산만으로는 암부에서 형태가 서지 않는다(위 수식). 어두운 곳에서 형태를 세우는 것은
 * **빛**이다. 그래서 실루엣 하나가 스프라이트 **두 장**으로 그려진다:
 *
 *  - 그림자(`multiply`) : 드롭 섀도 + 그늘진 면. 바닥이 밝은 쪽에서만 일한다.
 *  - 하이라이트(`add`)  : 광원을 향한 **얇은 모서리**(2텍셀) + 아주 옅은 면 워시.
 *
 * 가산은 밝히는 총량을 늘리므로 가독성 예산을 직접 갉아먹는다. 그래서 ㉠알파 상한을 곱연산의
 * 1/3 로 따로 두고({@link MAX_HIGHLIGHT_ALPHA}) ㉡화면 가산 잉크 총량에 상한을 두고
 * ({@link ADDITIVE_INK_BUDGET}) ㉢밝은 부분은 **모서리에만** 둔다. 넓게 밝히는 것은 면 워시
 * 하나뿐이고 그건 알파를 한 자릿수 퍼센트로 눌렀다.
 *
 * ### ③ 광원 방향은 상수 하나 — 병렬 레인과 맞추는 접점
 * {@link LIGHT_ANGLE} 이 유일한 근원이고 림/드롭섀도/면워시가 전부 여기서 파생된다.
 * **회전은 기하에 굽지만 광원은 굽지 않는다** — 변형 각도 `R` 은 실루엣 모양에만 적용하고,
 * 림·그림자 오프셋은 회전 **뒤** 월드 좌표에서 더한다. 그래야 12방향으로 흩어 놓아도 빛은
 * 한 방향에서 온다. 같은 이유로 relief 격자만 **좌우반전을 금지**한다(반전은 광원의 x 성분을
 * 거울로 뒤집어 화면에 두 개의 태양을 만든다 — 테스트가 이 규율을 잠근다).
 *
 * ### ④ 밀도는 재질이 아니라 랜드마크
 * 화면당 몇 개 수준({@link RELIEF_GRID} 셀 419px). 많으면 다시 벽지가 된다. 비평가의
 * "시각 밀도가 균질해 초점 위계가 없다"에 대한 답은 개수를 늘리는 것이 아니라 **큰 것 몇 개**다.
 *
 * ## 결정론(ADR-0005)
 * `Math.random` 을 쓰지 않는다. 데칼의 존재·종류·변형·위치·배율·알파·틴트·좌우반전은 전부
 * `(ctx.seed, 정수 셀 좌표)` 의 순수 해시({@link file://./noise.ts})다. 텍스처 모양도 고정
 * 상수 시드로 굽는다.
 *
 * ## 월드 고정
 * 스프라이트 위치는 **셀의 월드 좌표 + 해시 지터**로만 정해지고(그 뒤 지형 격자로 스냅),
 * 카메라는 레이어 컨테이너를 통째로 평행이동할 뿐이다.
 *
 * ## 성능
 * 격자별 고정 스프라이트 풀(뷰포트 + 1셀 마진 링). 매 프레임 하는 일은 컨테이너 위치 갱신
 * O(1) 뿐이고, **카메라가 셀 경계를 넘을 때만** 풀을 재배치한다. 텍스처는 첫 `configure` 에서
 * 렌더러당 한 번만 굽고 캐시한다. 저해상도 베이크라 2차보다 텍스처 메모리가 **1/4** 이다.
 *
 * ## 타일셋 교체 대비
 * {@link DISPLAY_TILE} 은 autotile 에서 **import** 한다(복제 금지 — 값이 어긋나면 데칼만 다른
 * 픽셀 크기로 그려진다). 원본 타일 픽셀 수가 바뀌면 {@link SOURCE_TILE_PX} 하나만 고치면 되고
 * {@link TERRAIN_PIXEL}·베이크 해상도·스냅 격자가 전부 따라온다. 바닥 밝기가 바뀌면
 * {@link FLOOR_LUMA_SUM} 만 갱신한다.
 */

import { Container, Graphics, Sprite, Texture, type Renderer } from 'pixi.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../app.js';
import { DISPLAY_TILE, UPPER_THRESHOLD, terrainFieldAt } from '../autotile.js';
import { graphicsTierController } from '../graphicsRuntime.js';
import { effectGates, type QualityTier } from '../qualityTier.js';
import { graphicsSettings, type GraphicsSettings } from '../graphicsSettings.js';
import { hash3 } from './noise.js';
import type { EnvContext, EnvFrame, EnvLayer } from './types.js';

/**
 * 카르곤 행성 인덱스. `planetEnvironment.ts` 에도 같은 상수가 있지만 **거기서 import 하지
 * 않는다** — 그 모듈이 이 모듈을 import 하므로 순환이 생긴다(레지스트리 → 레이어 방향만 둔다).
 */
const KARGON_PLANET = 0;

const TAU = Math.PI * 2;

// ─────────────────────────────────────────────────────────────────────────────
// 픽셀 격자 — 지형과 같은 해상도로 그리기 위한 파생 상수
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wang 타일 원본 한 변(px). autotile 은 이 값을 상수로 export 하지 않고 주석으로만 명시하므로
 * (`32px source upscaled 2x`) 여기 한 곳에 둔다. **타일셋 원본 크기가 바뀌면 여기만 고친다.**
 */
export const SOURCE_TILE_PX = 32;

/**
 * 지형 원본 픽셀 하나가 화면에서 차지하는 design px. **파생값이다** — 타일셋 레인이
 * {@link DISPLAY_TILE} 을 바꿔도 자동으로 따라온다(하드코딩 금지).
 */
export const TERRAIN_PIXEL = DISPLAY_TILE / SOURCE_TILE_PX;

/**
 * 텍스처를 구울 해상도. `1/TERRAIN_PIXEL` 이면 **텍셀 1개 = 지형 원본 픽셀 1개**가 된다
 * (Pixi 는 `texture.width = pixelWidth / resolution` 이라, 배율 1 스프라이트가 design 크기를
 * 그대로 차지하면서 내부는 성기게 샘플된다).
 */
export const BAKE_RESOLUTION = 1 / TERRAIN_PIXEL;

/** design 좌표를 지형 픽셀 격자에 스냅한다. 굽기 전 모든 꼭짓점·반경·굵기가 이걸 통과한다. */
export function snapPx(v: number): number {
  return Math.round(v / TERRAIN_PIXEL) * TERRAIN_PIXEL;
}

/** 최소 1텍셀은 남기는 스냅(가는 선이 0으로 사라지는 것을 막는다). */
function snapMin(v: number): number {
  return Math.max(TERRAIN_PIXEL, snapPx(v));
}

// ─────────────────────────────────────────────────────────────────────────────
// 합성 모드 — 이 레이어의 가독성 불변식은 여기서 나온다
// ─────────────────────────────────────────────────────────────────────────────

/** 합성 모드 이름(테스트가 참조하는 축). */
export type DecalBlend = 'multiply' | 'normal' | 'add';

/**
 * **데칼의 합성 모드.** `multiply` 는 결과가 바닥보다 밝아질 수 없음을 수식으로 보장한다
 * ({@link compositeChannel} 참조). `normal` 로 되돌리면 2차의 "밝게 뜨는 갈색 얼룩"이 그대로
 * 재발하며, 테스트가 그 회귀를 배경 스윕으로 잡는다.
 */
export const DECAL_BLEND: DecalBlend = 'multiply';

/**
 * **부조 하이라이트의 합성 모드.** 곱연산은 암부에서 구조적으로 아무 일도 못 하므로
 * (`바닥밝기 × α × (1−배수)`, 바닥밝기 ≈ 90) 어두운 곳에 형태를 세우려면 **더하는 수밖에 없다**.
 * 대신 이 경로는 가독성 예산을 직접 쓰므로 알파·색·총량 세 상한으로 묶여 있다.
 */
export const HIGHLIGHT_BLEND: DecalBlend = 'add';

/**
 * 한 채널의 합성 결과(0~255). Pixi 의 프리멀티플라이드 블렌드를 그대로 옮긴 것이다.
 *
 *  - `multiply` : `blendFunc(DST_COLOR, ONE_MINUS_SRC_ALPHA)`
 *      → dst·(src·α) + dst·(1−α) = dst·(1 − α + α·src) . 괄호 안 ≤ 1 이므로 **항상 ≤ dst**.
 *  - `normal`   : `blendFunc(ONE, ONE_MINUS_SRC_ALPHA)` (프리멀티플라이드)
 *      → src·α + dst·(1−α) . src > dst 면 **밝아진다** ← 2차의 결함 경로.
 *  - `add`      : `blendFunc(ONE, ONE)` (프리멀티플라이드)
 *      → dst + src·α . **항상 ≥ dst** — 4차의 하이라이트가 타는 경로다. 밝히는 총량이 곧
 *        가독성 예산이므로 여기서만 예외적으로 허용하고, 대신 상한 셋으로 묶는다
 *        ({@link MAX_HIGHLIGHT_ALPHA} · {@link MAX_ADDITIVE_LUMA_GAIN} · {@link ADDITIVE_INK_BUDGET}).
 */
export function compositeChannel(
  dst: number,
  src: number,
  alpha: number,
  blend: DecalBlend,
): number {
  if (blend === 'multiply') return dst * (1 - alpha + (alpha * src) / 255);
  if (blend === 'add') return Math.min(255, dst + src * alpha);
  return dst * (1 - alpha) + src * alpha;
}

/**
 * 배경 RGB 위에 (fill × tint) 를 alpha 로 합성했을 때의 R+G+B 합(0~765).
 * 테스트가 "어떤 배경·어떤 종류·어떤 알파·어떤 틴트에서도 밝아지지 않는다"를 이 함수로 증명한다.
 */
export function compositeLumaSum(
  backdrop: readonly [number, number, number],
  fill: number,
  alpha: number,
  tint: number,
  blend: DecalBlend = DECAL_BLEND,
): number {
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    const shift = 16 - i * 8;
    const src = (((fill >> shift) & 0xff) * ((tint >> shift) & 0xff)) / 255;
    sum += compositeChannel(backdrop[i] ?? 0, src, alpha, blend);
  }
  return sum;
}

// ─────────────────────────────────────────────────────────────────────────────
// 튜닝 상수 — 타일셋이 바뀌면 **여기만** 고친다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 카르곤 바닥 타일의 대표 밝기, R+G+B 합(0~765). 곱연산에서 데칼이 만드는 화면 차이는
 * `바닥 밝기 × α × (1 − 배수)` 에 비례하므로 세기 예측({@link estimateScreenInk})의 기준점이다.
 * **타일셋 교체 시 갱신 대상 1순위.**
 */
export const FLOOR_LUMA_SUM = 150;

/**
 * 배수 채널의 **하한**. 이 아래로 내려가면 데칼이 "지면의 얼룩"이 아니라 **검은 구멍**이 되어
 * 그 자리의 지형 정보가 통째로 사라진다(적·탄이 그 위에 있으면 대비가 무너진다).
 */
export const MIN_MULTIPLIER_CHANNEL = 0x28;

/**
 * 배수 채널의 **상한**. 이 위로 가면 곱해도 거의 변화가 없어 1차의 "안 보이는 데칼"이 재발한다.
 * 0xd2 ≈ 0.82 → 알파 1에서 최소 18% 는 어둡게 만든다.
 */
export const MAX_MULTIPLIER_CHANNEL = 0xd2;

/**
 * **데칼 fill = 곱할 배수 팔레트.** (0xffffff = 변화 없음, 낮을수록 더 어둡게)
 *
 * 채도는 여전히 낮게 유지한다 — 배수의 채널 편차가 크면 바닥의 색상이 통째로 밀려
 * "지형 얼룩"이 아니라 "색 필터"로 읽힌다.
 */
export const FILL = {
  /** 접지 음영(모든 또렷한 실루엣의 바깥 1텍셀 테두리). 팔레트에서 가장 진하다. */
  ground: 0x3a3532,
  /** 식은 용암 흐름 본체 / 심 / 코어. */
  flowBody: 0x8a7c72,
  flowVein: 0x5f544c,
  flowCore: 0x453d38,
  /** 크레이터 림(가장 옅다 — 안쪽이 더 어두워야 링으로 읽힌다) / 바닥 / 심연. */
  craterRim: 0xa89c92,
  craterFloor: 0x6b6058,
  craterPit: 0x3e3833,
  /** 화산재 퇴적(거의 변화 없는 옅은 안개). */
  ash: 0xc4bcb0,
  /** 비산 자국 본체 / 튄 방울. */
  splatterBody: 0x7a6e66,
  splatterDrop: 0x554d47,
  /** 균열선 — 겉선(넓게)과 코어(1텍셀, 가장 진하게). */
  crackSoft: 0x6a625e,
  crack: 0x2e2b2a,
  /** 현무암 자갈. */
  gravel: 0x8f857c,
  gravelDark: 0x554d47,
  /** 그을음. */
  soot: 0x4a4340,
  /** 대역 변색 — 차가운 쪽(주력). */
  stainDark: 0x8c9096,
  /** 대역 변색 — 따뜻한 쪽(붉은 기를 남기고 푸른 기를 깎아 바닥을 데운다). */
  stainWarm: 0xb0967e,
  /** 암괴 덩어리 본체 / 그늘진 면(4차 실루엣 층). */
  rockBody: 0x7e746c,
  rockShade: 0x4e4642,
  /** 굳은 용암 흐름 능선 본체 / 그늘진 면. */
  ridgeBody: 0x877a70,
  ridgeShade: 0x554b45,
  /** 재 무더기 본체 / 그늘진 면. */
  moundBody: 0x958a7e,
  moundShade: 0x5c5249,
} as const;

/**
 * 틴트 팔레트. 곱연산 위에 한 번 더 곱해지므로 **더 어둡게만** 만든다. 편차를 좁게 잡아
 * 데칼이 색으로 튀지 않게 한다.
 */
const TINTS: readonly number[] = [0xffffff, 0xf0e4d8, 0xdcd0c4, 0xd8dce4, 0xf4d8c0, 0xcfc8c2];

/**
 * 알파 상한의 절대 상한. 이 위로 가면 데칼이 "지형의 얼룩"이 아니라 "화면 위의 물체"로 읽혀
 * 아이템·적과 경합한다.
 */
export const MAX_DECAL_ALPHA = 0.6;

// ─────────────────────────────────────────────────────────────────────────────
// 4차 — 광원 · 가산 하이라이트 예산
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **광원 방향(rad).** 화면 좌표계(y 아래로 증가)에서 **표면 → 광원**을 가리키는 각도다.
 * 이 상수 하나가 림 하이라이트가 붙는 모서리·드롭 섀도가 떨어지는 방향·면 워시의 치우침을
 * 전부 정한다. 값 하나만 바꾸면 셋이 함께 돈다(파생 관계는 {@link LIGHT_X}/{@link LIGHT_Y}).
 *
 * **왜 아래쪽인가.** 카르곤에서 유일하게 밝은 것은 **바닥의 용암**이고 하늘은 검다. 그래서
 * 물체는 위가 아니라 **아래에서** 조명된다 — `kargonLavaLight` 4차가 넣는 방향성 림/드롭섀도와
 * 같은 가정이다. 두 레이어가 다른 광원을 쓰면 같은 화면에 태양이 둘이 된다.
 *
 * **왜 정확히 π/2(수직 아래)가 아닌가.** 축에 정확히 정렬된 빛은 모든 실루엣의 하이라이트를
 * 아래 절반에 대칭으로 붙여 도장 찍은 것처럼 보인다. 0.32rad(≈18°) 왼쪽으로 기울여 비대칭을
 * 준다. **이 x 성분이 0이 아니기 때문에 relief 격자는 좌우반전을 쓸 수 없다**(반전은 x 를
 * 거울로 뒤집는다) — {@link GridSpec.noFlip}.
 *
 * 병렬 레인과 값을 맞출 때는 **여기만** 고친다.
 */
export const LIGHT_ANGLE = Math.PI * 0.5 + 0.32;
/** 표면 → 광원 단위벡터 x. **파생값이다**(하드코딩 금지). */
export const LIGHT_X = Math.cos(LIGHT_ANGLE);
/** 표면 → 광원 단위벡터 y. 화면 좌표라 양수 = 아래쪽. */
export const LIGHT_Y = Math.sin(LIGHT_ANGLE);

/**
 * **가산 하이라이트 알파의 절대 상한.** 곱연산 상한({@link MAX_DECAL_ALPHA} 0.6)의 1/3 이다.
 * 가산은 화면을 밝히므로 적·탄·아이템의 대비 예산을 직접 갉아먹는다 — 곱연산과 같은 대역을
 * 주면 안 된다.
 */
export const MAX_HIGHLIGHT_ALPHA = 0.2;

/**
 * 하이라이트 팔레트. **{@link FILL} 과 의미가 다르다** — 이건 곱할 배수가 아니라 **더할 빛**이다.
 * 그래서 배수 팔레트의 상·하한({@link MIN_MULTIPLIER_CHANNEL}·{@link MAX_MULTIPLIER_CHANNEL})이
 * 적용되지 않고, 대신 {@link MAX_ADDITIVE_LUMA_GAIN} 이 적용된다. 두 팔레트를 한 객체에 섞으면
 * "배수는 절대 밝히지 않는다"를 배경 스윕으로 증명하는 테스트가 통째로 의미를 잃는다.
 */
export const GLOW = {
  /** 광원을 향한 모서리(2텍셀). 이 레이어에서 유일하게 또렷하게 밝은 것. */
  rim: 0x6e4c30,
  /** 광원을 향한 면의 아주 옅은 워시. 넓게 깔리므로 색 자체를 어둡게 잡았다. */
  face: 0x2c1e14,
} as const;

/**
 * 한 하이라이트 텍셀이 배경에 더할 수 있는 R+G+B 최대 증가분. `lumaSum(GLOW.rim) × 상한 알파`
 * 보다 여유 있게 잡되, "암부에서 형태가 보인다"에 필요한 만큼은 남긴다 — 현무암 합 ≈ 90 위에서
 * +40 은 국소 대비 45% 라 모서리가 확실히 읽힌다.
 */
export const MAX_ADDITIVE_LUMA_GAIN = 60;

/**
 * 화면 한 장이 가산으로 더할 수 있는 잉크 총량(0~765 단위, {@link estimateHighlightInk} 와 같은 척도).
 * 곱연산 3층의 실측 기여가 4.0 이었으므로, 가산이 그 20% 를 넘으면 "절제된 하이라이트"가 아니라
 * "화면을 밝히는 레이어"가 된다.
 */
export const ADDITIVE_INK_BUDGET = 0.8;

// ─────────────────────────────────────────────────────────────────────────────
// 종류 · 실루엣 · 변형
// ─────────────────────────────────────────────────────────────────────────────

/** 데칼 종류. 종류마다 {@link VARIANTS} 장의 서로 다른 절차적 텍스처를 굽는다. */
export type DecalKind =
  | 'flow'
  | 'crater'
  | 'ash'
  | 'splatter'
  | 'crack'
  | 'gravel'
  | 'soot'
  | 'stainDark'
  | 'stainWarm'
  | 'boulder'
  | 'ridge'
  | 'mound';

/**
 * **실루엣 축.** "형태가 사실상 1종"이라는 3차 기각 사유에 대한 구조적 답이다. 각 값은
 * {@link drawDecal} 의 서로 다른 분기이며, 테스트가 ①3종 이상 ②전부 실제로 쓰임을 강제한다.
 *
 *  - `flow`     : 머리가 굵고 꼬리로 갈수록 가늘어지는 방향성 자국(대칭 타원이 아니다).
 *  - `splatter` : 중심 덩어리 + 한쪽으로 튄 위성 방울들.
 *  - `crack`    : 각진 얇은 선망(1텍셀 코어).
 *  - `cluster`  : 흩어진 각진 파편 무더기.
 *  - `ring`     : 테두리 밴드가 있는 함몰(크레이터).
 *  - `haze`     : 경계를 알 수 없는 감쇠 얼룩. **유일하게 배율 > 1 이 허용되는 실루엣.**
 *
 * 4차가 더한 **부조(relief) 실루엣 3종**({@link RELIEF_SILHOUETTES})은 앞의 여섯과 성격이 다르다 —
 * 국소 명도 변조가 아니라 **암부에 형태를 주는 200~400px 급 랜드마크**이고, 곱연산 그림자와
 * 가산 하이라이트를 **함께** 쓴다.
 *  - `boulder`  : 무너진 암괴 덩어리(큰 덩어리 + 주변 파편).
 *  - `ridge`    : 굳은 용암 흐름 능선(방향성 있는 융기 등줄기).
 *  - `mound`    : 재·부스러기 무더기(낮게 퍼진 층상 더미).
 */
export type Silhouette =
  | 'flow'
  | 'splatter'
  | 'crack'
  | 'cluster'
  | 'ring'
  | 'haze'
  | 'boulder'
  | 'ridge'
  | 'mound';

/** 배율 > 1 을 허용하는 실루엣(경계가 없어 텍셀 크기 차이가 드러나지 않는다). */
export const SCALABLE_SILHOUETTE: Silhouette = 'haze';

/**
 * **부조 실루엣 집합.** 이 셋만 ①암부 전용 배치 ②하이라이트 텍스처 ③좁은 크기 대역
 * ({@link RELIEF_VARIANT_SPEC})을 갖는다. 나머지는 3차 그대로다.
 */
export const RELIEF_SILHOUETTES: ReadonlySet<Silhouette> = new Set<Silhouette>([
  'boulder',
  'ridge',
  'mound',
]);

/** 이 종류가 부조(암부 랜드마크)인가. */
export function isRelief(kind: DecalKind): boolean {
  return RELIEF_SILHOUETTES.has(KIND_SHAPE[kind].silhouette);
}

/** 한 변형이 텍스처에 굽는 크기 배수와 **회전각**. */
export interface VariantSpec {
  readonly sizeMul: number;
  /** 굽는 시점에 기하에 적용되는 각도(rad). 런타임 회전은 하지 않는다 — 픽셀 격자 보존. */
  readonly angle: number;
}

/**
 * 변형 표. 각도를 0~π 에 흩고 좌우반전과 곱해 **겉보기 방향 12종**을 만든다(π~2π 는 반전이
 * 덮는다). 크기 배수는 2배 이상 벌려 "전부 같은 크기"로 보이지 않게 한다.
 *
 * 각도를 균등 간격으로 두지 않은 이유: 균등하면 여러 데칼이 같은 각도 계열로 정렬돼 보인다
 * (2차 기각 사유 "전부 같은 방향으로 기울어져 있다"의 지각적 원인).
 */
export const VARIANT_SPEC: readonly VariantSpec[] = [
  { sizeMul: 1.0, angle: 0 },
  { sizeMul: 0.72, angle: 0.61 },
  { sizeMul: 1.28, angle: 1.31 },
  { sizeMul: 0.88, angle: 2.05 },
  { sizeMul: 1.45, angle: 2.62 },
  { sizeMul: 0.66, angle: 3.02 },
];

/**
 * **부조 전용 변형 표.** 각도는 {@link VARIANT_SPEC} 과 **일부러 다르게** 잡았다 — 같은 각도 표를
 * 쓰면 큰 실루엣과 잔 데칼이 같은 방향 계열로 정렬돼 화면에 격자감이 되돌아온다.
 *
 * 크기 배수 대역이 좁은(0.86~1.34, 1.56배) 이유는 순수하게 산술이다. 부조는 발자국이
 * {@link RELIEF_MIN_SPAN}~{@link RELIEF_MAX_SPAN} 안에 있어야 하고, 각진 다각형의 흔들림
 * ±{@link RELIEF_WOBBLE} 이 양끝에서 대역을 더 먹으므로 허용 배수비는
 * `(400/200) × (1−wob)/(1+wob) ≈ 1.70` 이 상한이다. 일반 변형 표의 2.2배를 그대로 쓰면
 * 작은 변형이 200px 아래로, 큰 변형이 400px 위로 새어 나간다.
 */
export const RELIEF_VARIANT_SPEC: readonly VariantSpec[] = [
  { sizeMul: 1.12, angle: 0.18 },
  { sizeMul: 0.86, angle: 0.79 },
  { sizeMul: 1.34, angle: 1.44 },
  { sizeMul: 0.98, angle: 2.11 },
  { sizeMul: 1.24, angle: 2.55 },
  { sizeMul: 0.9, angle: 2.95 },
];

/** 종류별로 굽는 모양 변형 수. 두 표의 길이는 **같아야 한다**(변형 인덱스가 공용 축이다). */
export const VARIANTS = VARIANT_SPEC.length;

/** 이 종류가 쓰는 변형 표. 그리기 코드·배치 코드·테스트가 전부 이 함수를 통해 본다. */
export function variantSpecFor(kind: DecalKind): readonly VariantSpec[] {
  return isRelief(kind) ? RELIEF_VARIANT_SPEC : VARIANT_SPEC;
}

/** 겉보기 방향 종류 수(변형 각도 × 좌우반전). */
export const ORIENTATIONS = VARIANTS * 2;

/** 모양 생성용 **고정** 해시 시드. 런 시드와 무관해야 텍스처를 런 사이에 재사용할 수 있다. */
const SHAPE_SEED = 0x5eed1ce;

/** 뷰포트 밖으로 유지하는 셀 마진 링(팝인 방지). */
export const DECAL_MARGIN = 1;

// ─────────────────────────────────────────────────────────────────────────────
// 산포 격자 사양
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 한 산포 격자의 사양. 셀 크기·후보 종류·밀도·배율/알파 대역·해시 소금을 묶는다.
 * `salt` 는 격자끼리 같은 셀 좌표에서 같은 난수를 뽑지 않게 하는 축 분리자다.
 */
export interface GridSpec {
  /** 셀 한 변(월드 px). **{@link DISPLAY_TILE} 의 배수 금지.** */
  readonly cell: number;
  /**
   * 이 격자가 뽑는 데칼 종류 후보. **같은 값을 여러 번 넣으면 그만큼 자주 뽑힌다**(가중치).
   * 균열이 부족하다는 3차 지적을 밀도 상한을 건드리지 않고 푸는 손잡이다.
   */
  readonly kinds: readonly DecalKind[];
  /** 셀당 데칼 존재 확률(티어 배율 적용 전). */
  readonly density: number;
  /** 배율 대역 — **정수만** 허용한다(텍셀 크기 = TERRAIN_PIXEL × 배율). */
  readonly minScale: number;
  readonly maxScale: number;
  readonly minAlpha: number;
  readonly maxAlpha: number;
  /** 해시 축 분리자(격자마다 달라야 한다). */
  readonly salt: number;
  /**
   * 지형 친화도. `'lower'` 면 **암부(하부 지형)에만** 놓인다 — 발자국 5점을 전부
   * {@link reliefSiteIsDark} 로 검사해 하나라도 밝은 지각에 걸리면 존재 판정을 취소한다.
   */
  readonly terrain?: 'lower';
  /**
   * 가산 하이라이트 알파 대역. 있으면 배치마다 스프라이트가 **두 장**(곱연산 그림자 + 가산
   * 하이라이트) 나간다. `maxAlpha` 는 {@link MAX_HIGHLIGHT_ALPHA} 이하여야 한다.
   */
  readonly highlight?: { readonly minAlpha: number; readonly maxAlpha: number };
  /**
   * 좌우반전 금지. 하이라이트를 쓰는 격자는 **반드시 참**이어야 한다 — 반전은 광원의 x 성분을
   * 거울로 뒤집어 화면에 두 개의 광원을 만든다({@link LIGHT_ANGLE} 주석).
   */
  readonly noFlip?: boolean;
  /**
   * 티어 밀도 배율의 하한. 랜드마크는 저티어에서도 사라지면 안 된다 — 몇 개뿐이라 솎으면
   * 화면에서 아예 없어지고, 그러면 티어에 따라 **구도가 달라진다**(잔 데칼 솎임과 다른 문제).
   */
  readonly minDensityScale?: number;
}

/**
 * 큰 데칼 격자 — 용암 흐름 자국·크레이터·비산 자국·재 퇴적. 셀 337px(소수).
 * 1920×1080 화면에 기대 ~11장.
 *
 * 3차 변경: 배율 0.85~1.9 → **1 고정**(또렷한 실루엣이라 지형과 같은 텍셀이어야 한다).
 * 크기 다양성은 {@link VARIANT_SPEC} 의 `sizeMul`(0.66~1.45)이 대신한다. `tube` 는 삭제하고
 * (flow 와 실루엣이 구별되지 않았다) `splatter` 를 넣었다.
 */
export const MACRO_GRID: GridSpec = {
  cell: 337,
  kinds: ['flow', 'crater', 'splatter', 'ash'],
  density: 0.45,
  minScale: 1,
  maxScale: 1,
  minAlpha: 0.3,
  maxAlpha: 0.58,
  salt: 0x1000,
};

/**
 * 잔 데칼 격자 — 균열망·현무암 자갈·그을음·잔 비산. 셀 149px(소수).
 * 1920×1080 화면에 기대 ~37장.
 *
 * 3차 변경: `crack` 을 후보에 **두 번** 넣어 균열 비중을 25% → 40% 로 올렸다(밀도 상한
 * 0.36 은 그대로 — "개수로 벌지 않는다" 규율 유지).
 */
export const MICRO_GRID: GridSpec = {
  cell: 149,
  kinds: ['crack', 'crack', 'gravel', 'soot', 'splatter'],
  density: 0.36,
  minScale: 1,
  maxScale: 1,
  minAlpha: 0.32,
  maxAlpha: 0.58,
  salt: 0x2000,
};

/**
 * **대역 변색 격자** — 화면 절반만 한(셀 787px, 소수) 얼룩. 화면 하나에 최대 9장.
 * {@link softBlob} 의 반경 감쇠 덕분에 경계가 어디인지 알 수 없다.
 *
 * 3차 변경: 알파 0.13~0.28 → 0.12~0.26 으로 **낮췄다**. 시차 레이어가 암부 저주파를 맡으므로
 * 대역이 겹치면 둘 다 탁해진다. 배율은 정수 2 고정(haze 라 텍셀 4px 이 드러나지 않는다)이고
 * 반경을 74 → 120 으로 올려 발자국을 유지했다.
 */
export const STAIN_GRID: GridSpec = {
  cell: 787,
  kinds: ['stainDark', 'stainWarm'],
  density: 0.9,
  minScale: 2,
  maxScale: 2,
  minAlpha: 0.13,
  maxAlpha: 0.28,
  salt: 0x3000,
};

// ─────────────────────────────────────────────────────────────────────────────
// 4차 — 부조(암부 랜드마크) 격자
// ─────────────────────────────────────────────────────────────────────────────

/** 부조 발자국 지름의 목표 대역(design px). 비평가가 지정한 "200~400px 급". */
export const RELIEF_MIN_SPAN = 200;
export const RELIEF_MAX_SPAN = 400;

/** 부조 다각형의 반경 흔들림. 대역 산술의 입력이다({@link RELIEF_VARIANT_SPEC} 주석). */
export const RELIEF_WOBBLE = 0.08;

/**
 * **부조 격자** — 암부에 형태를 주는 랜드마크. 셀 419px(소수 → {@link DISPLAY_TILE}·149·337·787
 * 전부와 서로소).
 *
 * 밀도 계산: 1920×1080 에 5×3 = 15셀 × 0.48 ≈ 7.2 후보 → 지형 게이트가 2/3 를 걸러
 * **화면당 평균 2.5개**(48시드 실측 0~6). 이건 재질이 아니라 랜드마크라 이 정도가 상한이다 —
 * 개수를 늘리면 비평가가 지적한 "균질한 시각 밀도"로 되돌아간다. 화면에 하나도 없는 시드가
 * 있는 것은 **의도된 것**이다: 랜드마크가 매 화면 보장되면 그건 이미 랜드마크가 아니다.
 *
 * 배율은 정수 1 고정: 경계가 또렷한 실루엣이므로 지형과 정확히 같은 텍셀이어야 한다
 * (3차 규율 유지). 크기 다양성은 {@link RELIEF_VARIANT_SPEC} 의 `sizeMul` 이 담당한다.
 */
export const RELIEF_GRID: GridSpec = {
  cell: 419,
  kinds: ['boulder', 'boulder', 'ridge', 'mound'],
  density: 0.48,
  minScale: 1,
  maxScale: 1,
  minAlpha: 0.34,
  maxAlpha: 0.55,
  salt: 0x4000,
  terrain: 'lower',
  highlight: { minAlpha: 0.11, maxAlpha: 0.18 },
  noFlip: true,
  minDensityScale: 0.7,
};

/**
 * 지형 필드 임계에서 얼마나 더 들어가야 "암부"로 치는가. 0이면 경계선에 딱 붙은 자리도
 * 통과해 실루엣의 절반이 밝은 지각에 걸친다.
 */
export const RELIEF_FIELD_MARGIN = 0.05;

/** 발자국 검사점 오프셋(반경 비율). 중심 + 상하좌우 — 큰 실루엣은 3~6타일을 덮는다. */
const RELIEF_PROBES: readonly number[] = [0, 0, -0.62, 0, 0.62, 0, 0, -0.62, 0, 0.62];

/**
 * **암부 판정.** `autotile` 의 {@link terrainFieldAt}/{@link UPPER_THRESHOLD} 를 **import** 해서
 * 쓴다 — 값을 복제하면 타일셋 레인이 임계를 옮겼을 때 실루엣만 다른 경계를 본다
 * (`kargonLavaLight` 가 0.5 복제를 들고 지형이 그리지 않는 등고선에 발광을 붙였던 전례).
 *
 * @param radius 실루엣 발자국 **반경**(design px). 검사점 간격이 여기서 나온다.
 */
export function reliefSiteIsDark(
  seed: number,
  worldX: number,
  worldY: number,
  radius: number,
): boolean {
  const limit = UPPER_THRESHOLD - RELIEF_FIELD_MARGIN;
  for (let i = 0; i + 1 < RELIEF_PROBES.length; i += 2) {
    const px = worldX + (RELIEF_PROBES[i] ?? 0) * radius;
    const py = worldY + (RELIEF_PROBES[i + 1] ?? 0) * radius;
    if (terrainFieldAt(seed, px / DISPLAY_TILE, py / DISPLAY_TILE) >= limit) return false;
  }
  return true;
}

/** 실루엣 발자국 반경(design px) — 지형 게이트의 검사 간격이자 대역 검증의 기준. */
export function reliefFootprintRadius(kind: DecalKind, variant: number): number {
  const shape = KIND_SHAPE[kind];
  const spec = variantSpecFor(kind)[variant] ?? variantSpecFor(kind)[0];
  return shape.r * (spec?.sizeMul ?? 1) * Math.max(shape.elong, 1);
}

/** 해시 축(k) 상수. 같은 셀에서 뽑는 독립 속성들이 서로 상관되지 않게 분리한다. */
const K_PRESENT = 0;
const K_JITTER_X = 1;
const K_JITTER_Y = 2;
const K_KIND = 3;
const K_SCALE = 5;
const K_ALPHA = 6;
const K_TINT = 7;
const K_FLIP = 8;
const K_VARIANT = 9;
const K_GLOW = 10;

/** 한 셀의 데칼 배치 결과(가변 out 객체로 재사용 — 재배치 시 할당을 만들지 않는다). */
export interface DecalPlacement {
  present: boolean;
  kind: DecalKind;
  variant: number;
  worldX: number;
  worldY: number;
  /**
   * 이 데칼의 겉보기 각도(rad). **런타임에 스프라이트를 돌리지 않는다** — 변형 텍스처에 이미
   * 구워져 있는 각도를 알려 주는 파생 필드다(방향 분포 검증용).
   */
  rotation: number;
  /** 정수 배율. 텍셀 한 변 = `TERRAIN_PIXEL × scale`. */
  scale: number;
  alpha: number;
  tint: number;
  /** 좌우 반전(스케일 x 부호). 각도 표를 π~2π 로 확장한다. */
  flip: boolean;
  /**
   * 가산 하이라이트 스프라이트의 알파. 격자에 {@link GridSpec.highlight} 가 없으면 **0** 이고
   * 그때는 하이라이트 스프라이트가 아예 나가지 않는다.
   */
  glowAlpha: number;
}

/** 재사용 가능한 빈 배치 객체. */
export function emptyPlacement(): DecalPlacement {
  return {
    present: false,
    kind: 'ash',
    variant: 0,
    worldX: 0,
    worldY: 0,
    rotation: 0,
    scale: 1,
    alpha: 1,
    tint: 0xffffff,
    flip: false,
    glowAlpha: 0,
  };
}

/**
 * 배치의 겉보기 방향 계급(0 ~ {@link ORIENTATIONS}−1). 좌우반전은 각도를 거울로 뒤집으므로
 * 변형 각도와 독립된 방향을 만든다. 테스트가 이 계급의 분포로 "회전이 실제로 흩어지는가"를 잰다.
 */
export function orientationClass(p: DecalPlacement): number {
  return p.variant + (p.flip ? VARIANTS : 0);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 배열에서 해시로 하나 고르기(경계 방어 포함). */
function pick<T>(arr: readonly T[], t: number): T {
  const i = Math.min(arr.length - 1, Math.max(0, Math.floor(t * arr.length)));
  return arr[i] ?? (arr[0] as T);
}

/**
 * **결정론의 정본.** 셀 `(cx, cy)` 의 데칼을 `(seed, cx, cy)` 의 순수 함수로 계산한다.
 * 카메라·프레임·시간이 입력에 없으므로 월드 고정과 리플레이 재현이 구조적으로 보장된다.
 *
 * @param densityScale 티어 밀도 배율. 존재 판정에만 관여한다 — 그래야 티어가 바뀔 때
 *   "다른 데칼"이 아니라 "솎아진 같은 데칼"이 돼 화면이 튀지 않는다.
 * @param out 결과를 담을 객체(재사용). 생략하면 새로 만든다.
 */
export function decalAt(
  spec: GridSpec,
  seed: number,
  cx: number,
  cy: number,
  densityScale = 1,
  out: DecalPlacement = emptyPlacement(),
): DecalPlacement {
  const s = seed ^ spec.salt;
  out.present = hash3(s, cx, cy, K_PRESENT) < spec.density * densityScale;
  if (!out.present) return out;
  // 지터는 셀 안 10%~90% 구간 — 셀 경계에 몰려 격자선이 드러나는 것을 막는다.
  // 그 뒤 **지형 픽셀 격자로 스냅**한다: 데칼 텍셀 경계가 지형 픽셀 경계와 어긋나면
  // nearest 샘플링이 블록을 반 픽셀씩 잘라 "다른 해상도"로 읽힌다.
  const jx = lerp(0.1, 0.9, hash3(s, cx, cy, K_JITTER_X));
  const jy = lerp(0.1, 0.9, hash3(s, cx, cy, K_JITTER_Y));
  out.worldX = snapPx((cx + jx) * spec.cell);
  out.worldY = snapPx((cy + jy) * spec.cell);
  out.kind = pick(spec.kinds, hash3(s, cx, cy, K_KIND));
  out.variant = Math.min(VARIANTS - 1, Math.floor(hash3(s, cx, cy, K_VARIANT) * VARIANTS));
  out.rotation = variantSpecFor(out.kind)[out.variant]?.angle ?? 0;
  // 정수 배율만 뽑는다(텍셀 크기가 지형 픽셀의 정수배로 유지된다).
  const steps = spec.maxScale - spec.minScale + 1;
  out.scale = spec.minScale + Math.min(steps - 1, Math.floor(hash3(s, cx, cy, K_SCALE) * steps));
  out.alpha = lerp(spec.minAlpha, spec.maxAlpha, hash3(s, cx, cy, K_ALPHA));
  out.tint = pick(TINTS, hash3(s, cx, cy, K_TINT));
  // 하이라이트를 쓰는 격자는 좌우반전을 **못 쓴다** — 반전은 광원 x 성분을 거울로 뒤집는다.
  out.flip = spec.noFlip === true ? false : hash3(s, cx, cy, K_FLIP) < 0.5;
  out.glowAlpha =
    spec.highlight === undefined
      ? 0
      : lerp(spec.highlight.minAlpha, spec.highlight.maxAlpha, hash3(s, cx, cy, K_GLOW));
  // 지형 게이트는 **마지막**이다: 종류·변형이 정해져야 발자국 반경을 알고, 반경을 알아야
  // 검사점 간격이 정해진다. 게이트에 걸려도 다른 속성은 그대로 남으므로(존재만 취소)
  // 티어 밀도 배율처럼 "솎아진 같은 데칼" 성질이 유지된다.
  if (spec.terrain === 'lower') {
    const rad = reliefFootprintRadius(out.kind, out.variant) * out.scale;
    if (!reliefSiteIsDark(seed, out.worldX, out.worldY, rad)) out.present = false;
  }
  return out;
}

/** 티어별 데칼 밀도 배율. 저티어일수록 솎아낸다(스프라이트 수 = 드로콜 예산). */
export function densityForTier(tier: QualityTier): number {
  return tier === 'low' ? 0.45 : tier === 'med' ? 0.8 : 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// 모양 사양 — 그리기 코드와 세기 예측 모델이 **같은 표**를 본다
// ─────────────────────────────────────────────────────────────────────────────

/** 종별 발자국·불투명도·실루엣 사양. */
export interface KindShape {
  /** 텍스처 기준 반경(design px, sizeMul 1 기준). */
  readonly r: number;
  /** 긴 축 늘림. */
  readonly elong: number;
  /** 세기 모델이 쓰는 대표 배수 색. */
  readonly fill: number;
  /** 발자국 타원 중 실제로 칠해지는 면적 비율(0~1). */
  readonly coverage: number;
  /** 칠해진 곳의 평균 불투명도(0~1). */
  readonly opacity: number;
  /** 실루엣 축 — {@link drawDecal} 의 분기이자 배율 규율의 근거. */
  readonly silhouette: Silhouette;
}

/**
 * `coverage`·`opacity` 는 모양 코드에서 해석적으로 유도한 근삿값이다(정확한 적분이 아니라
 * 세기 비교용 척도).
 */
export const KIND_SHAPE: Readonly<Record<DecalKind, KindShape>> = {
  flow: { r: 42, elong: 2.4, fill: FILL.flowBody, coverage: 0.5, opacity: 0.95, silhouette: 'flow' },
  crater: {
    r: 44,
    elong: 1.0,
    fill: FILL.craterFloor,
    coverage: 0.62,
    opacity: 0.9,
    silhouette: 'ring',
  },
  ash: { r: 46, elong: 1.45, fill: FILL.ash, coverage: 0.85, opacity: 0.45, silhouette: 'haze' },
  splatter: {
    r: 44,
    elong: 1.3,
    fill: FILL.splatterBody,
    coverage: 0.3,
    opacity: 0.92,
    silhouette: 'splatter',
  },
  crack: {
    r: 44,
    elong: 2.0,
    fill: FILL.crack,
    coverage: 0.12,
    opacity: 0.95,
    silhouette: 'crack',
  },
  gravel: {
    r: 26,
    elong: 1.0,
    fill: FILL.gravel,
    coverage: 0.3,
    opacity: 0.88,
    silhouette: 'cluster',
  },
  soot: { r: 17, elong: 1.2, fill: FILL.soot, coverage: 0.7, opacity: 0.9, silhouette: 'haze' },
  stainDark: {
    r: 120,
    elong: 1.35,
    fill: FILL.stainDark,
    coverage: 0.84,
    opacity: 0.54,
    silhouette: 'haze',
  },
  stainWarm: {
    r: 120,
    elong: 1.3,
    fill: FILL.stainWarm,
    coverage: 0.84,
    opacity: 0.54,
    silhouette: 'haze',
  },
  // ── 4차 부조. `r × elong` 이 발자국 반경이고 132 근처로 맞춰져 있다:
  //    지름 = 2 × 132 × sizeMul(0.86~1.34) × (1 ± RELIEF_WOBBLE) ⊂ [200, 400].
  //    r 이나 elong 을 바꾸면 **곱이 132 근처로 유지되게** 같이 고쳐라(테스트가 대역을 잠근다).
  boulder: {
    r: 115,
    elong: 1.15,
    fill: FILL.rockBody,
    coverage: 0.52,
    opacity: 0.9,
    silhouette: 'boulder',
  },
  ridge: {
    r: 70,
    elong: 1.9,
    fill: FILL.ridgeBody,
    coverage: 0.34,
    opacity: 0.92,
    silhouette: 'ridge',
  },
  mound: {
    r: 98,
    elong: 1.35,
    fill: FILL.moundBody,
    coverage: 0.46,
    opacity: 0.86,
    silhouette: 'mound',
  },
};

export const ALL_KINDS: readonly DecalKind[] = [
  'flow',
  'crater',
  'ash',
  'splatter',
  'crack',
  'gravel',
  'soot',
  'stainDark',
  'stainWarm',
  'boulder',
  'ridge',
  'mound',
];

// ─────────────────────────────────────────────────────────────────────────────
// 절차적 텍스처(렌더러당 1회 굽고 캐시)
// ─────────────────────────────────────────────────────────────────────────────

/** 굽는 시점의 회전(코사인·사인 캐시). 런타임 회전 대신 여기서 기하에 적용한다. */
interface Rot {
  readonly c: number;
  readonly s: number;
}

/** 로컬 좌표를 회전 → 지형 격자 스냅 순서로 꼭짓점 배열에 밀어 넣는다. */
function emit(pts: number[], x: number, y: number, R: Rot): void {
  pts.push(snapPx(x * R.c - y * R.s), snapPx(x * R.s + y * R.c));
}

/** 각진 n각형의 **스냅된 꼭짓점**(회전 적용 후). 부조는 이 배열을 재가공해 림/그림자를 만든다. */
function ngonPoints(
  s: number,
  cx: number,
  cy: number,
  r: number,
  sides: number,
  wob: number,
  elong: number,
  R: Rot,
): number[] {
  const pts: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * TAU;
    const rr = r * (1 - wob + wob * 2 * hash3(SHAPE_SEED, s, i, 11));
    emit(pts, cx + Math.cos(a) * rr * elong, cy + Math.sin(a) * rr, R);
  }
  return pts;
}

/** 각진 n각형(스냅된 꼭짓점). `wob` 으로 반경을 흔들어 유기적으로 만든다. */
function ngon(
  g: Graphics,
  s: number,
  cx: number,
  cy: number,
  r: number,
  sides: number,
  wob: number,
  elong: number,
  R: Rot,
  color: number,
  alpha = 1,
): void {
  g.poly(ngonPoints(s, cx, cy, r, sides, wob, elong, R)).fill({ color, alpha });
}

/**
 * 꼭짓점 구름을 **월드 좌표에서** 평행이동한다(스냅 유지).
 *
 * ⚠️ 회전 **뒤**에 적용한다는 것이 핵심이다. 광원은 실루엣과 함께 돌면 안 되므로, 림·드롭섀도
 * 오프셋은 {@link emit} 의 회전 경로를 타지 않고 여기서 더해진다.
 */
function shiftPoints(pts: readonly number[], dx: number, dy: number): number[] {
  const sx = snapPx(dx);
  const sy = snapPx(dy);
  const out: number[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) out.push((pts[i] ?? 0) + sx, (pts[i + 1] ?? 0) + sy);
  return out;
}

/** 꼭짓점 구름을 `(ccx, ccy)` 기준으로 축소(스냅 유지). 그늘진 안쪽 면을 만드는 데 쓴다. */
function scalePoints(pts: readonly number[], ccx: number, ccy: number, k: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) {
    out.push(snapPx(ccx + ((pts[i] ?? 0) - ccx) * k), snapPx(ccy + ((pts[i + 1] ?? 0) - ccy) * k));
  }
  return out;
}

/** 회전 후 조각 중심(부조는 조각마다 광원 판정을 따로 해야 한다). */
function rotX(x: number, y: number, R: Rot): number {
  return snapPx(x * R.c - y * R.s);
}
function rotY(x: number, y: number, R: Rot): number {
  return snapPx(x * R.s + y * R.c);
}

/** 반경 감쇠 얼룩의 겹 수와 겹당 알파. 중심 누적 = `1 − (1−k)^N`. */
const SOFT_RINGS = 16;
const SOFT_RING_ALPHA = 0.17;

/**
 * **경계가 안 보이는 큰 얼룩.** 같은 각도 흔들림 프로파일을 공유하는 동심 폴리곤 여러 겹을
 * 바깥→안 순으로 낮은 알파로 겹쳐 칠한다.
 *
 * 왜 겹마다 흔들림을 새로 뽑지 않는가: 겹마다 독립으로 흔들면 안쪽 겹이 바깥 겹을 삐져나와
 * 가장자리에 톱니가 생긴다. 프로파일을 공유하면 **실루엣은 불규칙한데 겹은 정확히 중첩**된다.
 */
function softBlob(
  g: Graphics,
  s: number,
  r: number,
  elongX: number,
  R: Rot,
  color: number,
  rings = SOFT_RINGS,
  ringAlpha = SOFT_RING_ALPHA,
  wobble = 0.22,
): void {
  const points = 26;
  const profile: number[] = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * TAU;
    const w1 = hash3(SHAPE_SEED, s, 0, 51) * TAU;
    const w2 = hash3(SHAPE_SEED, s, 1, 51) * TAU;
    const d = Math.sin(a * 2 + w1) * 0.6 + Math.sin(a * 3 + w2) * 0.4;
    profile.push(1 + wobble * d);
  }
  for (let ring = rings; ring >= 1; ring--) {
    const t = ring / rings;
    const pts: number[] = [];
    for (let i = 0; i < points; i++) {
      const a = (i / points) * TAU;
      const rr = r * t * (profile[i] ?? 1);
      emit(pts, Math.cos(a) * rr * elongX, Math.sin(a) * rr, R);
    }
    g.poly(pts).fill({ color, alpha: ringAlpha });
  }
}

/** 접지 음영 테두리 두께(텍셀 1개). 안쪽보다 어두우면 "패인 자국"으로 읽힌다. */
const GROUND_RIM = TERRAIN_PIXEL;

// ─────────────────────────────────────────────────────────────────────────────
// 4차 — 부조 기하(그림자 텍스처와 하이라이트 텍스처가 **같은 조각 목록**에서 나온다)
// ─────────────────────────────────────────────────────────────────────────────

/** 드롭 섀도가 광원 반대쪽으로 밀리는 거리(텍셀 3개). */
const RELIEF_SHADOW_OFFSET = TERRAIN_PIXEL * 3;
/** 광원을 향한 모서리 하이라이트의 굵기(텍셀 2개). **얇아야 한다** — 넓히면 총 광량이 는다. */
const RELIEF_RIM_WIDTH = TERRAIN_PIXEL * 2;
/**
 * 굽기 프레임 반경 배수. 그림자·하이라이트 두 텍스처가 **정확히 같은 크기·같은 중심**으로
 * 구워지게 하는 장치다: 하이라이트 기하는 본체의 부분집합이라, 프레임이 없으면 두 텍스처의
 * `generateTexture` 바운드가 달라지고 앵커 0.5 정렬이 어긋나 하이라이트가 실루엣에서 미끄러진다.
 */
const RELIEF_FRAME_MUL = 1.25;

/**
 * 굽기 프레임의 색. 알파 0으로 칠하므로 화면에는 영향이 없지만 **기하 바운드에는 들어간다**.
 * 테스트가 본체/테두리 반경을 잴 때 이 색을 걸러야 하므로 상수로 export 한다.
 */
export const BAKE_FRAME_COLOR = 0x000001;

/**
 * **면 워시 겹.** 광원 쪽으로 밀린 축소 폴리곤 두 장으로 "빛을 받는 면"을 만든다.
 *
 * 예산의 대부분을 여기가 먹는다 — 림은 둘레 × 2텍셀이라 면적이 미미하고, 워시는 발자국 면적에
 * 비례한다({@link estimateHighlightInk} 의 두 항 참조). 그래서 **알파를 한 자릿수 퍼센트대로
 * 누르고 발자국도 안쪽으로 당겼다**. 세기를 올리고 싶으면 여기가 아니라 림을 건드려라(면적당
 * 비용이 10배 이상 싸다).
 *
 * ⚠️ {@link estimateHighlightInk} 가 이 표를 **직접 읽는다**. 값을 바꾸면 예산 계산이 따라온다.
 */
export const RELIEF_WASH: readonly { scale: number; alpha: number; push: number }[] = [
  { scale: 0.8, alpha: 0.22, push: 0.2 },
  { scale: 0.5, alpha: 0.26, push: 0.36 },
];

/** 부조 조각 하나(회전이 이미 적용된 꼭짓점 + 회전 후 중심 + 반경). */
interface ReliefPiece {
  readonly pts: readonly number[];
  readonly ccx: number;
  readonly ccy: number;
  readonly r: number;
}

/**
 * 부조 실루엣의 조각 목록. **그림자 바이크와 하이라이트 바이크가 이 함수 하나를 공유한다** —
 * 두 곳에서 따로 만들면 언젠가 갈라지고, 갈라지면 빛이 실루엣에서 미끄러진다(눈으로는
 * "떠 있다"로 읽히는, 이 레인이 두 번 기각당한 바로 그 증상).
 */
function reliefPieces(kind: DecalKind, v: number): ReliefPiece[] {
  const table = variantSpecFor(kind);
  const spec = table[v] ?? table[0];
  const angle = spec?.angle ?? 0;
  const R: Rot = { c: Math.cos(angle), s: Math.sin(angle) };
  const s = v * 977 + 13;
  const shape = KIND_SHAPE[kind];
  const r = snapMin(shape.r * (spec?.sizeMul ?? 1));
  const el = shape.elong;
  const out: ReliefPiece[] = [];
  const push = (cx: number, cy: number, rr: number, sides: number, e: number, k: number): void => {
    out.push({
      pts: ngonPoints(s + k, cx, cy, rr, sides, RELIEF_WOBBLE, e, R),
      ccx: rotX(cx, cy, R),
      ccy: rotY(cx, cy, R),
      r: rr,
    });
  };

  if (shape.silhouette === 'boulder') {
    // 큰 덩어리 하나 + 발치에 흩어진 파편 넷. "무너진 암괴"의 읽히는 형태.
    push(0, 0, r, 9, el, 0);
    for (let i = 0; i < 4; i++) {
      const a = hash3(SHAPE_SEED, s, i, 81) * TAU;
      const d = r * el * (0.5 + 0.22 * hash3(SHAPE_SEED, s, i, 82));
      const rr = snapMin(r * (0.13 + 0.07 * hash3(SHAPE_SEED, s, i, 83)));
      push(Math.cos(a) * d, Math.sin(a) * d * 0.8, rr, 6, 1, 10 + i);
    }
  } else if (shape.silhouette === 'ridge') {
    // 굳은 흐름의 등줄기. 가운데가 두껍고 양끝으로 가늘어지는 구슬 사슬 → 방향이 읽힌다.
    const n = 7;
    const A = snapPx(r * el * 0.86);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const taper = 0.5 - 0.34 * Math.abs(2 * t - 1) ** 1.4;
      const rr = snapMin(r * taper * (0.86 + 0.28 * hash3(SHAPE_SEED, s, i, 84)));
      const wy = (hash3(SHAPE_SEED, s, i, 85) - 0.5) * r * 0.34;
      push(-A + 2 * A * t, wy, rr, 7, 1, 20 + i);
    }
  } else {
    // 재 무더기: 낮게 퍼진 바닥 층 위에 좁은 층이 얹힌 더미. 위로 갈수록 광원(아래)에서 멀다.
    const layers = 3;
    for (let i = 0; i < layers; i++) {
      const k = 1 - i * 0.29;
      const rr = snapMin(r * k);
      const lift = snapPx(-r * 0.16 * i);
      push(snapPx((hash3(SHAPE_SEED, s, i, 86) - 0.5) * r * 0.18), lift, rr, 8, el, 30 + i);
    }
  }
  return out;
}

/** 이 변형의 굽기 프레임 반경(그림자·하이라이트 공통). */
function reliefFrameHalf(kind: DecalKind, v: number): number {
  return snapPx(reliefFootprintRadius(kind, v) * RELIEF_FRAME_MUL);
}

/**
 * 두 텍스처의 바운드를 같게 만드는 투명 프레임.
 *
 * `rect` 이 아니라 `poly` 인 이유: Pixi 의 `Rectangle` shape 에는 `points` 배열이 없어서
 * 구운 기하를 읽는 테스트가 프레임의 크기를 **잴 수 없다**. 이 프레임의 존재 목적이 바로
 * "두 텍스처의 바운드가 같다"를 성립시키는 것이므로, 그걸 검증할 수 없는 형태로 그리면
 * 장치와 검증이 따로 논다.
 */
function drawFrame(g: Graphics, half: number): void {
  g.poly([-half, -half, half, -half, half, half, -half, half]).fill({
    color: BAKE_FRAME_COLOR,
    alpha: 0,
  });
}

/**
 * 광원을 향한 모서리만 골라 굵기 {@link RELIEF_RIM_WIDTH} 로 긋는다.
 *
 * 판정은 **모서리 중점의 조각 중심 대비 방향**과 광원 벡터의 내적이다(폴리곤 감김 방향에
 * 의존하지 않는다 — 감김이 뒤집히면 법선 부호가 통째로 뒤집혀 빛이 반대편에 붙는다).
 *
 * @returns 실제로 그린 모서리가 있었는가(빈 패스에 `stroke` 를 걸지 않기 위한 신호).
 */
function strokeLitEdges(g: Graphics, piece: ReliefPiece, color: number, alpha: number): boolean {
  const pts = piece.pts;
  const n = pts.length / 2;
  let drew = false;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = pts[2 * i] ?? 0;
    const y0 = pts[2 * i + 1] ?? 0;
    const x1 = pts[2 * j] ?? 0;
    const y1 = pts[2 * j + 1] ?? 0;
    const mx = (x0 + x1) * 0.5 - piece.ccx;
    const my = (y0 + y1) * 0.5 - piece.ccy;
    if (mx * LIGHT_X + my * LIGHT_Y <= 0) continue;
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    drew = true;
  }
  if (drew) g.stroke({ color, width: RELIEF_RIM_WIDTH, alpha, cap: 'butt', join: 'miter' });
  return drew;
}

/**
 * **부조의 곱연산 층.** 드롭 섀도(광원 반대쪽) → 본체 → 그늘진 면(광원 반대쪽으로 치우친 안쪽).
 * 암부에서는 이 층이 거의 아무 일도 하지 않는다(그래서 하이라이트가 있다) — 여기서 버는 것은
 * 실루엣이 **덜 어두운 지면에 걸쳤을 때의 접지감**이다.
 */
function drawReliefBase(g: Graphics, kind: DecalKind, v: number): void {
  drawFrame(g, reliefFrameHalf(kind, v));
  const shape = KIND_SHAPE[kind];
  const body = shape.fill;
  const shade =
    shape.silhouette === 'boulder'
      ? FILL.rockShade
      : shape.silhouette === 'ridge'
        ? FILL.ridgeShade
        : FILL.moundShade;
  const pieces = reliefPieces(kind, v);
  for (const p of pieces) {
    g.poly(
      shiftPoints(p.pts, -LIGHT_X * RELIEF_SHADOW_OFFSET, -LIGHT_Y * RELIEF_SHADOW_OFFSET),
    ).fill({ color: FILL.ground, alpha: 1 });
  }
  for (const p of pieces) g.poly([...p.pts]).fill({ color: body, alpha: 1 });
  for (const p of pieces) {
    const inner = scalePoints(p.pts, p.ccx, p.ccy, 0.72);
    g.poly(shiftPoints(inner, -LIGHT_X * p.r * 0.24, -LIGHT_Y * p.r * 0.24)).fill({
      color: shade,
      alpha: 1,
    });
  }
}

/**
 * **부조의 가산 층.** 광원을 향한 면의 아주 옅은 워시(넓게·거의 안 보이게) → 광원을 향한
 * 모서리(얇게·또렷하게). 암부에서 형태를 세우는 것은 사실상 이 모서리 하나다.
 *
 * 순서가 중요하다: 워시를 먼저 깔고 모서리를 나중에 그어야 모서리가 워시에 먹히지 않는다.
 */
function drawReliefGlow(g: Graphics, kind: DecalKind, v: number): void {
  drawFrame(g, reliefFrameHalf(kind, v));
  const pieces = reliefPieces(kind, v);
  for (const p of pieces) {
    for (const w of RELIEF_WASH) {
      const poly = scalePoints(p.pts, p.ccx, p.ccy, w.scale);
      g.poly(shiftPoints(poly, LIGHT_X * p.r * w.push, LIGHT_Y * p.r * w.push)).fill({
        color: GLOW.face,
        alpha: w.alpha,
      });
    }
  }
  for (const p of pieces) strokeLitEdges(g, p, GLOW.rim, 1);
}

/**
 * 종류별 모양. **텍스처는 거의 불투명하게 굽는다** — 세기 손잡이는 스프라이트 alpha 하나뿐이어야
 * 한다(1차는 fill alpha 와 스프라이트 alpha 가 곱해져 실효 3% 로 사라졌다).
 *
 * **export 하는 이유**: 테스트가 캔버스 없이 `Graphics.context.instructions` 로 구운 기하를
 * 직접 읽어 ①모든 꼭짓점이 지형 픽셀 격자 위에 있고 ②접지 테두리가 본체보다 바깥에 있으며
 * ③변형마다 주축 각도가 실제로 다르고 ④실루엣마다 그리기 분기가 다름을 검증한다. 이 셋은
 * 렌더러가 필요한 스크린샷 없이는 달리 확인할 방법이 없다(2차의 "회전이 적용되는지 모르겠다"가
 * 정확히 그 사각지대였다).
 *
 * @param v 변형 인덱스. {@link VARIANT_SPEC} 의 크기 배수와 **회전각**을 여기서 기하에 넣는다.
 */
export function drawDecalInto(g: Graphics, kind: DecalKind, v: number): void {
  const table = variantSpecFor(kind);
  const spec = table[v] ?? table[0];
  const angle = spec?.angle ?? 0;
  const R: Rot = { c: Math.cos(angle), s: Math.sin(angle) };
  const s = v * 977 + 13;
  const shape = KIND_SHAPE[kind];
  const r = snapMin(shape.r * (spec?.sizeMul ?? 1));
  const el = shape.elong;

  switch (shape.silhouette) {
    case 'flow': {
      // 머리에서 꼬리로 가늘어지는 자국. 대칭 타원이 아니라 **방향이 읽히는 실루엣**이 목표다.
      const n = 8;
      const spineX = (t: number): number => -r * el + 2 * r * el * t;
      const spineY = (t: number): number =>
        Math.sin(t * 3.1 + hash3(SHAPE_SEED, s, 0, 61) * TAU) * r * 0.3;
      // 접지 테두리 두께는 **스냅 뒤에** 더한다. 스냅 안에서 더하면 반올림이 테두리를 삼켜
      // 테두리와 본체가 정확히 같은 반경으로 구워질 수 있다(구운 기하 테스트가 잡는다).
      const bead = (t: number): number =>
        snapMin(r * (0.92 - 0.74 * t) * (0.8 + 0.4 * hash3(SHAPE_SEED, s, Math.round(t * 100), 62)));
      // 1) 접지 테두리(1텍셀 크게, 가장 진하게) → 2) 본체 → 3) 심 → 4) 코어
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        ngon(g, s + i, spineX(t), spineY(t), bead(t) + GROUND_RIM, 8, 0.18, 1, R, FILL.ground);
      }
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        ngon(g, s + i, spineX(t), spineY(t), bead(t), 8, 0.18, 1, R, FILL.flowBody);
      }
      for (let i = 0; i < 5; i++) {
        const t = (i / 4) * 0.62;
        ngon(g, s + 40 + i, spineX(t), spineY(t), snapMin(bead(t) * 0.55), 7, 0.22, 1, R, FILL.flowVein);
      }
      for (let i = 0; i < 3; i++) {
        const t = (i / 2) * 0.34;
        ngon(g, s + 80 + i, spineX(t), spineY(t), snapMin(bead(t) * 0.26), 6, 0.25, 1, R, FILL.flowCore);
      }
      break;
    }
    case 'ring': {
      // 함몰: 바깥 접지 테두리 → 림(가장 옅음) → 바닥 → 심연. 안쪽이 어두워야 링으로 읽힌다.
      ngon(g, s, 0, 0, snapMin(r + GROUND_RIM), 12, 0.1, 1, R, FILL.ground);
      ngon(g, s, 0, 0, r, 12, 0.1, 1, R, FILL.craterRim);
      ngon(g, s + 1, 0, 0, snapMin(r * 0.74), 12, 0.14, 1, R, FILL.craterFloor);
      const ox = (hash3(SHAPE_SEED, s, 2, 63) - 0.5) * r * 0.2;
      const oy = (hash3(SHAPE_SEED, s, 3, 63) - 0.5) * r * 0.2;
      ngon(g, s + 2, ox, oy, snapMin(r * 0.34), 10, 0.2, 1, R, FILL.craterPit);
      break;
    }
    case 'splatter': {
      // 중심 덩어리 + 한쪽으로 튄 위성 방울. 방울이 이 실루엣의 정체성이다.
      const bias = hash3(SHAPE_SEED, s, 0, 71) * TAU;
      const core = snapMin(r * 0.46);
      ngon(g, s, 0, 0, snapMin(core + GROUND_RIM), 9, 0.34, el, R, FILL.ground);
      ngon(g, s, 0, 0, core, 9, 0.34, el, R, FILL.splatterBody);
      for (let i = 0; i < 10; i++) {
        const a = bias + (hash3(SHAPE_SEED, s, i, 72) - 0.5) * 2.3;
        const d = r * (0.6 + 0.8 * hash3(SHAPE_SEED, s, i, 73));
        const rr = snapMin(r * (0.05 + 0.15 * hash3(SHAPE_SEED, s, i, 74)) * (1 - d / (1.6 * r)));
        const dx = Math.cos(a) * d * el;
        const dy = Math.sin(a) * d;
        ngon(g, s + i, dx, dy, snapMin(rr + GROUND_RIM), 6, 0.3, 1, R, FILL.ground);
        ngon(g, s + i, dx, dy, rr, 6, 0.3, 1, R, FILL.splatterDrop);
      }
      break;
    }
    case 'crack': {
      // 각진 선망. 겉선(2텍셀)+코어(1텍셀) 이중선이라 홈처럼 읽힌다. 전부 격자 스냅.
      const len = r * 2;
      const seg = 7;
      const xs: number[] = [];
      const ys: number[] = [];
      let x = -len / 2;
      let y = 0;
      xs.push(x);
      ys.push(y);
      for (let i = 1; i <= seg; i++) {
        x += len / seg;
        y += (hash3(SHAPE_SEED, s, i, 21) - 0.5) * len * 0.22;
        xs.push(x);
        ys.push(y);
      }
      const stroke = (w: number, color: number, alpha: number): void => {
        g.moveTo(snapPx((xs[0] ?? 0) * R.c - (ys[0] ?? 0) * R.s), snapPx((xs[0] ?? 0) * R.s + (ys[0] ?? 0) * R.c));
        for (let i = 1; i < xs.length; i++) {
          const px = xs[i] ?? 0;
          const py = ys[i] ?? 0;
          g.lineTo(snapPx(px * R.c - py * R.s), snapPx(px * R.s + py * R.c));
        }
        g.stroke({ color, width: w, alpha, cap: 'butt', join: 'miter' });
      };
      stroke(TERRAIN_PIXEL * 2, FILL.crackSoft, 1);
      stroke(TERRAIN_PIXEL, FILL.crack, 1);
      // 가지 5갈래 + 떨어진 조각 3개 → 균열 밀도를 개수 상한 없이 올린다.
      for (let b = 0; b < 8; b++) {
        const detached = b >= 5;
        const t = detached ? 0.15 + 0.3 * hash3(SHAPE_SEED, s, b, 25) : 0.14 + 0.19 * b;
        const bx = -len / 2 + len * (detached ? 0.1 + 0.8 * hash3(SHAPE_SEED, s, b, 26) : t);
        const by =
          (hash3(SHAPE_SEED, s, b, 22) - 0.5) * len * (detached ? 0.5 : 0.14);
        const ang = (hash3(SHAPE_SEED, s, b, 23) - 0.5) * 2.8;
        const bl = len * (0.12 + 0.16 * hash3(SHAPE_SEED, s, b, 24));
        const ex = bx + Math.cos(ang) * bl;
        const ey = by + Math.sin(ang) * bl;
        g.moveTo(snapPx(bx * R.c - by * R.s), snapPx(bx * R.s + by * R.c));
        g.lineTo(snapPx(ex * R.c - ey * R.s), snapPx(ex * R.s + ey * R.c));
        g.stroke({ color: FILL.crack, width: TERRAIN_PIXEL, alpha: 1, cap: 'butt' });
      }
      break;
    }
    case 'cluster': {
      // 각진 파편 무더기. 조각마다 1텍셀 접지 그림자를 아래로 깔아 지면에 놓인 것으로 읽힌다.
      for (let i = 0; i < 12; i++) {
        const a = hash3(SHAPE_SEED, s, i, 31) * TAU;
        const d = Math.sqrt(hash3(SHAPE_SEED, s, i, 32)) * r;
        const gx = Math.cos(a) * d;
        const gy = Math.sin(a) * d * 0.75;
        const rr = snapMin(TERRAIN_PIXEL + hash3(SHAPE_SEED, s, i, 33) * r * 0.2);
        ngon(g, s * 8 + i, gx, gy + GROUND_RIM, snapMin(rr + GROUND_RIM), 5, 0.35, 1, R, FILL.ground);
        const dark = hash3(SHAPE_SEED, s, i, 36) < 0.5;
        ngon(g, s * 8 + i, gx, gy, rr, 5, 0.35, 1, R, dark ? FILL.gravelDark : FILL.gravel);
      }
      break;
    }
    case 'haze': {
      // 경계가 안 보이는 감쇠 얼룩. 접지 테두리를 두르지 않는다(테두리가 보이면 haze 가 아니다).
      const color =
        kind === 'stainWarm'
          ? FILL.stainWarm
          : kind === 'stainDark'
            ? FILL.stainDark
            : kind === 'soot'
              ? FILL.soot
              : FILL.ash;
      if (kind === 'ash') softBlob(g, s, r, el, R, color, 10, 0.09, 0.28);
      else if (kind === 'soot') softBlob(g, s, r, el, R, color, 12, 0.14, 0.4);
      else softBlob(g, s, r, el, R, color);
      break;
    }
    case 'boulder':
    case 'ridge':
    case 'mound':
      drawReliefBase(g, kind, v);
      break;
  }
}

/**
 * **부조의 가산 하이라이트 텍스처.** 부조가 아닌 종류에는 아무것도 그리지 않는다(그래서
 * 텍스처도 굽지 않는다 — 사문화된 빈 텍스처를 만들지 않는다).
 *
 * `drawDecalInto` 와 마찬가지로 테스트가 `Graphics.context.instructions` 로 직접 읽는다.
 * 여기서만 확인할 수 있는 것: ①빛이 실제로 {@link LIGHT_ANGLE} 쪽 모서리에만 붙는가
 * ②변형 각도를 돌려도 그 방향이 유지되는가(회전이 광원까지 돌려 버리는 것이 이 설계의
 * 가장 그럴듯한 오작동이다).
 */
export function drawHighlightInto(g: Graphics, kind: DecalKind, v: number): void {
  if (!isRelief(kind)) return;
  drawReliefGlow(g, kind, v);
}

/** 곱연산 본체 텍스처와 가산 하이라이트 텍스처 한 벌. */
export interface DecalTextures {
  readonly base: ReadonlyMap<DecalKind, Texture[]>;
  /** 부조 종류만 들어 있다(나머지는 하이라이트가 없다). */
  readonly glow: ReadonlyMap<DecalKind, Texture[]>;
}

/** 렌더러당 텍스처 캐시. 런을 반복해도 다시 굽지 않는다(GPU 메모리 누수 방지). */
const TEXTURE_CACHE = new WeakMap<Renderer, DecalTextures>();

/**
 * 종류 × 변형 텍스처를 한 번만 굽는다. 실패하면 `null` → 레이어가 비활성으로 떨어진다.
 *
 * **`resolution`·`antialias`·`scaleMode` 셋이 한 묶음이다.** 하나라도 빠지면 데칼이 지형과
 * 다른 픽셀 해상도로 보인다(3차 기각 사유 ②).
 */
function bakeTextures(renderer: Renderer): DecalTextures | null {
  const cached = TEXTURE_CACHE.get(renderer);
  if (cached !== undefined) return cached;
  const base = new Map<DecalKind, Texture[]>();
  const glow = new Map<DecalKind, Texture[]>();
  const bake = (draw: (g: Graphics) => void): Texture => {
    const g = new Graphics();
    draw(g);
    const tex = renderer.generateTexture({
      target: g,
      resolution: BAKE_RESOLUTION,
      antialias: false,
      textureSourceOptions: { scaleMode: 'nearest' },
    });
    tex.source.scaleMode = 'nearest';
    g.destroy();
    return tex;
  };
  try {
    for (const kind of ALL_KINDS) {
      const list: Texture[] = [];
      const glowList: Texture[] = [];
      for (let v = 0; v < VARIANTS; v++) {
        list.push(bake((g) => drawDecalInto(g, kind, v)));
        if (isRelief(kind)) glowList.push(bake((g) => drawHighlightInto(g, kind, v)));
      }
      base.set(kind, list);
      if (glowList.length > 0) glow.set(kind, glowList);
    }
  } catch {
    return null;
  }
  const out: DecalTextures = { base, glow };
  TEXTURE_CACHE.set(renderer, out);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 화면 기여도 예측 모델
// ─────────────────────────────────────────────────────────────────────────────

/** 색의 R+G+B 합(0~765). */
export function lumaSum(color: number): number {
  return ((color >> 16) & 0xff) + ((color >> 8) & 0xff) + (color & 0xff);
}

/**
 * 곱연산 배수 색이 만드는 **상대 어둡기**(0 = 변화 없음, 1 = 완전 검정).
 * 알파 1에서의 값이며, 실제 감쇠는 여기에 스프라이트 alpha 가 곱해진다.
 */
export function darkening(fill: number): number {
  return 1 - lumaSum(fill) / 765;
}

/**
 * **한 화면의 잉크 총량 예측.** 오케스트레이터가 재는 "레이어 on/off 의 RGB 합산 절대차 평균"
 * 과 같은 단위(0~765)로 이 레이어가 만들어낼 화면 차이를 계산한다.
 *
 *   기여 = Σ (발자국 면적 × coverage) × opacity × alpha × darkening(fill) × 바닥밝기 / 화면 면적
 *
 * 곱연산이라 **바닥 밝기에 비례**한다는 점이 2차 모델과의 차이다(2차는 `|바닥 − fill|` 이었다).
 *
 * **한계를 정확히 알고 써라.** 이건 측정이 아니라 모델이고 두 방향으로 틀린다:
 *  - 겹침을 선형으로 더하므로 **과대평가**한다(실제 합성은 포화한다).
 *  - 바닥을 균일한 {@link FLOOR_LUMA_SUM} 으로 가정한다. 실제 카르곤은 밝은 용암과 검은 현무암이
 *    공존하고, 곱연산은 어두운 쪽에서 거의 아무 일도 하지 않는다 → 어두운 화면에서는 과대평가.
 */
export function estimateScreenInk(
  seed: number,
  densityScale = 1,
  viewW = DESIGN_WIDTH,
  viewH = DESIGN_HEIGHT,
  grids: readonly GridSpec[] = [STAIN_GRID, MACRO_GRID, MICRO_GRID],
): number {
  const screenArea = viewW * viewH;
  const scratch = emptyPlacement();
  let ink = 0;
  for (const spec of grids) {
    const cols = Math.ceil(viewW / spec.cell);
    const rows = Math.ceil(viewH / spec.cell);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const p = decalAt(spec, seed, c, r, densityScale, scratch);
        if (!p.present) continue;
        const shape = KIND_SHAPE[p.kind];
        const size = shape.r * p.scale;
        const area = Math.PI * size * shape.elong * size * shape.coverage;
        ink += (area * shape.opacity * p.alpha * darkening(shape.fill) * FLOOR_LUMA_SUM) / screenArea;
      }
    }
  }
  return ink;
}

/**
 * 카르곤 **암부**의 대표 밝기(R+G+B 합). 부조는 정의상 여기에만 놓이므로 부조의 곱연산
 * 기여를 {@link FLOOR_LUMA_SUM}(150, 화면 평균)으로 재면 두 배 넘게 부풀려진다.
 */
export const DARK_FLOOR_LUMA_SUM = 90;

/** 한 화면의 부조 개수(지형 게이트 통과 후). */
export function reliefCount(
  seed: number,
  densityScale = 1,
  viewW = DESIGN_WIDTH,
  viewH = DESIGN_HEIGHT,
): number {
  const scratch = emptyPlacement();
  let n = 0;
  for (let c = 0; c < Math.ceil(viewW / RELIEF_GRID.cell); c++) {
    for (let r = 0; r < Math.ceil(viewH / RELIEF_GRID.cell); r++) {
      if (decalAt(RELIEF_GRID, seed, c, r, densityScale, scratch).present) n++;
    }
  }
  return n;
}

/**
 * **가산 하이라이트가 화면에 더하는 잉크.** {@link estimateScreenInk} 와 같은 단위(0~765)이며
 * 예산 {@link ADDITIVE_INK_BUDGET} 과 직접 비교된다.
 *
 * 두 항으로 나눈다 — 둘의 성격이 정반대라서다:
 *  - **림**: 둘레 × 굵기 만큼의 아주 좁은 면적인데 국소 대비는 크다. 총량 기여는 작다.
 *  - **면 워시**: 넓은 면적인데 색·알파가 낮다. **여기가 예산을 먹는 쪽**이다.
 *
 * 한계는 {@link estimateScreenInk} 와 같다(겹침 선형 가산 → 과대평가).
 */
export function estimateHighlightInk(
  seed: number,
  densityScale = 1,
  viewW = DESIGN_WIDTH,
  viewH = DESIGN_HEIGHT,
): number {
  const screenArea = viewW * viewH;
  const scratch = emptyPlacement();
  let ink = 0;
  for (let c = 0; c < Math.ceil(viewW / RELIEF_GRID.cell); c++) {
    for (let r = 0; r < Math.ceil(viewH / RELIEF_GRID.cell); r++) {
      const p = decalAt(RELIEF_GRID, seed, c, r, densityScale, scratch);
      if (!p.present) continue;
      const rad = reliefFootprintRadius(p.kind, p.variant) * p.scale;
      // 림: 발자국 둘레의 광원 쪽 절반 × 굵기.
      const rim = Math.PI * rad * RELIEF_RIM_WIDTH * lumaSum(GLOW.rim);
      // 면 워시: **표를 직접 읽는다**(겹마다 면적 = (rad×scale)², 알파는 누적).
      let wash = 0;
      let acc = 0;
      for (const w of RELIEF_WASH) {
        const a = w.alpha * (1 - acc);
        acc += a;
        wash += Math.PI * (rad * w.scale) ** 2 * KIND_SHAPE[p.kind].coverage * a;
      }
      ink += ((rim + wash * lumaSum(GLOW.face)) * p.glowAlpha) / screenArea;
    }
  }
  return ink;
}

/**
 * **부조의 곱연산 기여.** 암부 밝기({@link DARK_FLOOR_LUMA_SUM})로 잰다 — 화면 평균으로 재면
 * "암부에서 곱연산이 거의 일하지 않는다"는 이 레인의 출발점 자체를 숨기게 된다.
 */
export function estimateReliefShadowInk(
  seed: number,
  densityScale = 1,
  viewW = DESIGN_WIDTH,
  viewH = DESIGN_HEIGHT,
): number {
  const screenArea = viewW * viewH;
  const scratch = emptyPlacement();
  let ink = 0;
  for (let c = 0; c < Math.ceil(viewW / RELIEF_GRID.cell); c++) {
    for (let r = 0; r < Math.ceil(viewH / RELIEF_GRID.cell); r++) {
      const p = decalAt(RELIEF_GRID, seed, c, r, densityScale, scratch);
      if (!p.present) continue;
      const shape = KIND_SHAPE[p.kind];
      const rad = reliefFootprintRadius(p.kind, p.variant) * p.scale;
      const area = Math.PI * rad * rad * shape.coverage;
      ink +=
        (area * shape.opacity * p.alpha * darkening(shape.fill) * DARK_FLOOR_LUMA_SUM) / screenArea;
    }
  }
  return ink;
}

// ─────────────────────────────────────────────────────────────────────────────
// 스프라이트 적용 — 불변식이 실제 스프라이트에 닿는 유일한 지점
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 배치를 스프라이트에 적용한다. **레이어와 테스트가 같은 함수를 본다** — "곱연산으로 합성한다",
 * "런타임 회전을 하지 않는다", "정수 배율만 쓴다" 같은 불변식이 문서가 아니라 코드 한 곳에서
 * 강제되고, 테스트는 그 한 곳을 직접 두드린다.
 */
export function applyPlacement(sprite: Sprite, p: DecalPlacement, texture: Texture): void {
  sprite.texture = texture;
  // 텍스처 지정 **뒤**에 스케일을 건다(v8 은 텍스처 교체로 스케일을 재계산하지 않는다).
  sprite.scale.set(p.flip ? -p.scale : p.scale, p.scale);
  // 런타임 회전 금지 — 각도는 텍스처에 구워져 있다(픽셀 격자 보존).
  sprite.rotation = 0;
  sprite.alpha = p.alpha;
  sprite.tint = p.tint;
  sprite.blendMode = DECAL_BLEND;
  sprite.position.set(p.worldX, p.worldY);
  sprite.visible = true;
}

/**
 * 가산 하이라이트 스프라이트에 배치를 적용한다. {@link applyPlacement} 와 **다른 점만**:
 * 블렌드가 `add`, 알파가 {@link DecalPlacement.glowAlpha}, 그리고 **좌우반전을 하지 않는다**
 * (반전은 광원을 거울로 뒤집는다 — 배치 단계에서 이미 막았지만 여기서도 안 쓴다).
 *
 * 위치·배율은 본체와 동일해야 두 텍스처가 겹친다. 두 텍스처의 크기가 같다는 것은 굽기 프레임
 * ({@link RELIEF_FRAME_MUL})이 보장한다.
 */
export function applyHighlight(sprite: Sprite, p: DecalPlacement, texture: Texture): void {
  sprite.texture = texture;
  sprite.scale.set(p.scale, p.scale);
  sprite.rotation = 0;
  sprite.alpha = p.glowAlpha;
  sprite.tint = p.tint;
  sprite.blendMode = HIGHLIGHT_BLEND;
  sprite.position.set(p.worldX, p.worldY);
  sprite.visible = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 산포 격자(풀링·컬링)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 한 산포 격자의 스프라이트 풀. autotile 의 `ensureCoverage`/`baseTx` 규율을 그대로 따른다 —
 * 매 프레임 할당 0, 카메라가 셀 경계를 넘을 때만 재배치.
 */
export class ScatterGrid {
  readonly view = new Container();
  /** 곱연산 그림자 층. */
  private readonly baseView = new Container();
  /**
   * 가산 하이라이트 층. **별도 컨테이너인 이유**: 자식 순서가 곧 z 순서라, 그림자/하이라이트를
   * 셀마다 번갈아 넣으면 이웃 실루엣의 그림자가 내 하이라이트를 덮는다(겹칠 때만 보이는,
   * 재현이 어려운 종류의 결함). 층을 통째로 나누면 그 경로가 사라진다.
   */
  private readonly glowView = new Container();
  private readonly pool: Sprite[] = [];
  private readonly glowPool: Sprite[] = [];
  private cols = 0;
  private rows = 0;
  private lastBaseCx = Number.NaN;
  private lastBaseCy = Number.NaN;
  private dirty = true;
  private seed = 0;
  private densityScale = 1;
  private textures: DecalTextures | null = null;
  /** 재배치 루프가 재사용하는 단일 out 객체(할당 0). */
  private readonly scratch = emptyPlacement();

  constructor(private readonly spec: GridSpec) {
    this.view.addChild(this.baseView);
    this.view.addChild(this.glowView);
    this.ensureCoverage(DESIGN_WIDTH, DESIGN_HEIGHT);
  }

  configure(textures: DecalTextures, seed: number): void {
    this.textures = textures;
    this.seed = seed >>> 0;
    this.dirty = true;
  }

  /** 티어 밀도 배율. 바뀌면 다음 프레임에 전체 재배치(솎임/복원). */
  setDensityScale(scale: number): void {
    if (scale === this.densityScale) return;
    this.densityScale = scale;
    this.dirty = true;
  }

  /** 가시 영역 + 마진 링을 덮도록 풀을 키운다(줄이지 않는다 — autotile 과 동형). */
  ensureCoverage(viewW: number, viewH: number): void {
    const cols = Math.ceil(viewW / this.spec.cell) + DECAL_MARGIN * 2 + 1;
    const rows = Math.ceil(viewH / this.spec.cell) + DECAL_MARGIN * 2 + 1;
    if (cols <= this.cols && rows <= this.rows) return;
    this.cols = Math.max(cols, this.cols);
    this.rows = Math.max(rows, this.rows);
    const need = this.cols * this.rows;
    for (let i = this.pool.length; i < need; i++) {
      const s = new Sprite();
      s.anchor.set(0.5);
      s.blendMode = DECAL_BLEND;
      s.visible = false;
      this.pool.push(s);
      this.baseView.addChild(s);
    }
    if (this.spec.highlight !== undefined) {
      for (let i = this.glowPool.length; i < need; i++) {
        const s = new Sprite();
        s.anchor.set(0.5);
        s.blendMode = HIGHLIGHT_BLEND;
        s.visible = false;
        this.glowPool.push(s);
        this.glowView.addChild(s);
      }
    }
    this.dirty = true;
  }

  /** 풀 크기(진단·테스트용). */
  get poolSize(): number {
    return this.pool.length;
  }

  /** 이 격자의 티어 밀도 하한(랜드마크는 저티어에서도 구도가 유지돼야 한다). */
  get minDensityScale(): number {
    return this.spec.minDensityScale ?? 0;
  }

  /** 이 격자의 사양(레이어가 어떤 격자를 실제로 돌리는지 밖에서 확인하는 창). */
  get gridSpec(): GridSpec {
    return this.spec;
  }

  /**
   * 현재 보이는 스프라이트 수(그림자 / 하이라이트).
   *
   * **테스트를 위해 존재한다.** 이 리포에서 여덟 번 반복된 결함이 "단위 테스트는 그린인데
   * 배선이 통째로 없다"이고, 이 레인에도 정확히 그 구멍이 있었다 — 배치 계산·기하·상한을
   * 아무리 잠가도 `applyHighlight` 호출을 지우면 **테스트가 전부 통과했다**(뮤테이션으로 확인).
   * 스프라이트 풀을 밖에서 셀 수 있어야 그 경로가 잠긴다.
   */
  visibleCounts(): { base: number; glow: number } {
    let base = 0;
    let glow = 0;
    for (const s of this.pool) if (s.visible) base++;
    for (const s of this.glowPool) if (s.visible) glow++;
    return { base, glow };
  }

  /**
   * 월드 사각형을 덮도록 데칼을 놓는다. 입력이 **월드 좌표**뿐이라(카메라 없음) 같은 셀은
   * 카메라가 어디에 있든 같은 자리·같은 모습으로 다시 놓인다 = 월드 고정.
   */
  layout(worldMinX: number, worldMinY: number, worldMaxX: number, worldMaxY: number): void {
    const tex = this.textures;
    if (tex === null) return;
    this.ensureCoverage(worldMaxX - worldMinX, worldMaxY - worldMinY);
    const baseCx = Math.floor(worldMinX / this.spec.cell) - DECAL_MARGIN;
    const baseCy = Math.floor(worldMinY / this.spec.cell) - DECAL_MARGIN;
    if (!this.dirty && baseCx === this.lastBaseCx && baseCy === this.lastBaseCy) return;
    this.lastBaseCx = baseCx;
    this.lastBaseCy = baseCy;
    this.dirty = false;

    const p = this.scratch;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c;
        const sprite = this.pool[i];
        const glow = this.glowPool[i];
        if (sprite === undefined) continue;
        decalAt(this.spec, this.seed, baseCx + c, baseCy + r, this.densityScale, p);
        const variants = p.present ? tex.base.get(p.kind) : undefined;
        const t = variants?.[p.variant];
        if (t === undefined) {
          sprite.visible = false;
          if (glow !== undefined) glow.visible = false;
          continue;
        }
        applyPlacement(sprite, p, t);
        if (glow === undefined) continue;
        const gt = tex.glow.get(p.kind)?.[p.variant];
        if (gt === undefined) glow.visible = false;
        else applyHighlight(glow, p, gt);
      }
    }
  }

  hideAll(): void {
    for (const s of this.pool) s.visible = false;
    for (const s of this.glowPool) s.visible = false;
    this.dirty = true;
  }

  destroy(): void {
    // 텍스처는 렌더러 캐시 공유물이라 파괴하지 않는다(다음 런이 재사용한다).
    this.view.destroy({ children: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 레이어
// ─────────────────────────────────────────────────────────────────────────────

export class KargonDecalLayer implements EnvLayer {
  readonly name = 'kargon-decals';
  readonly slot = 'floor' as const;
  readonly view = new Container();
  /**
   * 뒤 → 앞: 대역 변색(가장 큼) → 큰 데칼 → 잔 데칼 → **부조**.
   *
   * 부조가 맨 앞인 이유: 잔 데칼(균열·자갈)은 지면의 무늬이므로 암괴 **아래**를 지나야 한다.
   * 순서를 뒤집으면 균열이 바위 위로 지나가 바위가 다시 "얹힌 판때기"로 읽힌다.
   */
  private readonly grids: ScatterGrid[] = [
    new ScatterGrid(STAIN_GRID),
    new ScatterGrid(MACRO_GRID),
    new ScatterGrid(MICRO_GRID),
    new ScatterGrid(RELIEF_GRID),
  ];
  private enabled = false;
  /** 설정 스냅샷 캐시 — 매 프레임 `getSettings()` 를 부르면 프레임마다 객체가 새로 생긴다. */
  private settings: GraphicsSettings = graphicsSettings.getSettings();
  private readonly unsubscribe: () => void;

  constructor() {
    for (const g of this.grids) this.view.addChild(g.view);
    this.unsubscribe = graphicsSettings.onChange((s) => {
      this.settings = s;
    });
  }

  /**
   * 카르곤 전용. 렌더러가 없으면(테스트 환경 — 캔버스 없음) 던지지 않고 그냥 비활성으로 떨어진다.
   */
  configure(ctx: EnvContext): boolean {
    this.enabled = false;
    if (ctx.planet !== KARGON_PLANET) return false;
    if (ctx.renderer === undefined) return false;
    const tex = bakeTextures(ctx.renderer);
    if (tex === null) return false;
    for (const g of this.grids) g.configure(tex, ctx.seed);
    this.enabled = true;
    return true;
  }

  update(f: EnvFrame): void {
    if (!this.enabled) return;
    const tier = graphicsTierController.getActiveTier();
    const gates = effectGates(tier, this.settings);
    // 파티클을 완전히 끈 예산에서는 장식 데칼도 함께 내린다(게이트 일관).
    if (gates.particles === 'off') {
      for (const g of this.grids) g.hideAll();
      return;
    }
    // 카메라 팬은 컨테이너 평행이동으로만 한다(EntityRenderer·autotile 과 동일 매핑).
    const offX = DESIGN_WIDTH / 2 - f.camX;
    const offY = DESIGN_HEIGHT / 2 - f.camY;
    this.view.position.set(offX, offY);
    const scale = densityForTier(tier);
    for (const g of this.grids) {
      g.setDensityScale(Math.max(scale, g.minDensityScale));
      g.layout(f.viewMinX - offX, f.viewMinY - offY, f.viewMaxX - offX, f.viewMaxY - offY);
    }
  }

  /**
   * 이 레이어가 실제로 돌리는 격자 사양(뒤 → 앞 순서 그대로).
   *
   * 테스트가 "부조 격자가 배선돼 있는가"를 여기서 본다 — 격자를 목록에서 지우면 배치·기하
   * 테스트는 전부 통과한 채로 화면에서만 사라진다(이 리포의 반복 결함 유형).
   */
  get gridSpecs(): readonly GridSpec[] {
    return this.grids.map((g) => g.gridSpec);
  }

  resize(width: number, height: number): void {
    for (const g of this.grids) g.ensureCoverage(width, height);
  }

  destroy(): void {
    this.unsubscribe();
    for (const g of this.grids) g.destroy();
    this.view.destroy({ children: true });
  }
}
