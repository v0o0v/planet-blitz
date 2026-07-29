/**
 * 카르곤 용암 발광·지형 라이팅 레이어 (슬롯 `floor` — 지형 바닥 위·엔티티 아래).
 *
 * ## 1차가 왜 기각됐는가 (이 파일의 존재 이유)
 * 1차 구현은 균열 근처에 **방사형 블롭**을 흩뿌렸다. 픽셀 측정 결과 이 레이어를 켠 화면과 끈
 * 화면의 RGB 합산 절대차 평균이 **0.94**(애니메이션 노이즈 바닥 0.12) — 육안으로 구별되지
 * 않았다. 원인은 둘이다.
 *
 *  1. **알파 붕괴.** 상한 0.32 × 세기(0.2~0.5) × 맥동(≈0.6) × 티어 = 실효 0.05. 보수적 상한을
 *     곱셈으로 쌓으면 "존재하지 않는 것"이 된다.
 *  2. **형태가 용암이 아니었다.** 흐릿한 원은 잘 보이게 만들어도 "주황 얼룩"이지 용암이 아니다.
 *     실제 화산 스테이지의 용암은 **연속된 흐름**(채널·강·틈)이다.
 *
 * ## 2차의 뼈대 — 마칭 스퀘어즈 등고선
 * 이제 용암은 블롭이 아니라 **{@link terrainFieldAt} 의 0.5 등고선을 따라 흐르는 띠**다.
 * 타일 격자 위에서 마칭 스퀘어즈로 등고선을 뽑으면 **인접 셀이 공유 변에서 정확히 같은
 * 교차점**을 낸다(같은 두 꼭짓점 값으로 같은 선형보간을 하므로 부동소수까지 동일). 그래서
 * 세그먼트가 끝점을 공유하며 사슬로 이어지고, 화면에서 **강처럼 연결돼** 보인다. 이 성질은
 * 눈이 아니라 단위 테스트로 잠근다({@link marchCorners} 연결성 테스트).
 *
 * 각 세그먼트는 2차 당시 다섯 겹으로 그려졌다(**4차에서 여섯 겹·다른 순서로 바뀌었다** —
 * 아래 "4차" 절이 정본이다):
 *  - **황혼(dusk)**: 화면 전체 곱연산 어둠. 명도 구조는 밝은 쪽을 올리는 것만으로 안 생긴다 —
 *    **어두운 쪽을 눌러야** 생긴다. `floor` 슬롯이라 지형만 어두워지고 적·탄·젬은 그대로다
 *    (= 가독성이 오히려 올라간다).
 *  - **AO**: 균열의 **아래쪽**(법선 반대편)에 떨군 접촉 그림자.
 *    ⚠️ 4차에서 **경계 안쪽(고지 +n)의 또렷한 띠**로 바뀌었다 — 이 배치가 3차 실패의 원인.
 *  - **헤일로**: 넓고 은은한 주황 띠.
 *  - **코어**: 좁고 확실히 밝은 호박색 심지. 2단 구조라야 "빛나는 선"으로 읽힌다.
 *  - **림 라이트**: `ny < 0` 인 경계에만 얹는 얇고 따뜻한 가산 선.
 *    ⚠️ 4차에서 **저지 쪽(−n, 코어 바깥)** 으로 옮겼고, 근거도 "광원이 위"가 아니라
 *    **"광원은 아래의 용암"** 으로 바로잡았다(수식은 우연히 같다 — 4차 절 참조).
 *
 * 1차에서 "지형 법선 추정이 필요해 제외"했던 림 라이트는 사실 공짜다 —
 * {@link terrainGradient} 의 **수치 그래디언트**가 곧 경계 법선이다.
 *
 * ⚠️ `autotile.ts` 는 아직 필드 상수를 export 하지 않아 여기서 **값을 복제**했다
 * ({@link DISPLAY_TILE}·{@link NOISE_SCALE}·{@link NOISE_SCALE_FINE}·{@link UPPER_THRESHOLD}).
 * **autotile 이 export 하면 이 복제를 지우고 import 로 교체할 것** — 값이 어긋나면 발광과
 * 지형의 위상이 통째로 틀어진다. 값을 임의로 바꾸지 마라.
 *
 * ## 3차 — 비평 3건
 * 2차는 화면에서 크게 성공했지만(기여도 0.94 → 45.4) 세 가지가 남았다.
 *
 *  1. **발광 경계가 절반만 적용됐다.** 지역 필드가 임계를 못 넘은 경계는 `heat = 0` 이라
 *     통째로 검었고, 하필 플레이어가 서 있던 중앙 하단의 거대한 경계가 그랬다. 관객은
 *     "어떤 가장자리는 뜨겁고 어떤 건 아니다"를 미학적 선택이 아니라 **누락**으로 읽는다.
 *     → **모든 경계에 잔열 하한**({@link EMBER_MIN})을 깔고, 그 위에 지역 필드와 **다른
 *     스케일·다른 시드**의 저주파 노이즈로 강약을 실었다. 균일하게 다 켜면 반대로 촌스러워지
 *     므로 알파와 **띠 폭**을 둘 다 세기에 비례시킨다.
 *  2. **코어 명도 부족 — 블룸만 있고 광원이 없다.** → 알파 0.60 → 0.78, 폭 20 → 17,
 *     프로파일 지수 4.4 → 6.2. **총 밝은 면적은 그대로 두고 첨두 명도만** 올린다.
 *  3. **[중대] 발광 림이 적 투사체와 색이 같다.** 2차 코어 `0xff8a30` 은 가속 적탄
 *     `0xff8a20` 과 색상각 2.4° 차이였다 — 눈에는 같은 색이다. → 배경 용암을 적탄 사이의
 *     빈 색상 골짜기 **[10°, 18.4°]** 로 옮겼다({@link LAVA_PALETTE} 위 표 참조).
 *
 * 부수로 두 가지를 더 바꿨다.
 *  - **`gates.halo` 게이팅을 끄기 → 줄이기로.** 2차는 저티어·`reducedGlow` 에서 발광이 통째로
 *    사라져 카르곤 화면이 무너졌다({@link glowGateScales}).
 *  - **황혼(dusk) 0.42 → 0.26.** 화면 전체 어둡기는 그레이딩·시차 레인의 자리다. 이 레이어의
 *    본령은 국소 발광이고, 남긴 0.26 은 `floor` 슬롯만이 할 수 있는 **지형 선택적** 눌림이다.
 *
 * ## 결정론(ADR-0005)
 * - `Math.random` 없음. 공간 필드는 전부 {@link file://./noise.ts} + `ctx.seed`.
 * - **맥동 위상은 `EnvFrame.tick`(보간 sim 틱)의 순수 함수**({@link heatPulse}). 벽시계
 *   (`performance.now`)를 쓰면 탭 백그라운드 복귀·프레임 스킵에서 밝기가 튄다. `f.dt` 는 이
 *   레이어에서 아예 안 쓴다.
 * - 발광은 **월드 좌표에 붙는다**. 카메라가 돌아오면 같은 자리가 같은 밝기로 뜨겁다.
 *
 * ## 성능
 * - 텍스처 3장을 첫 `configure` 에서만 굽는다(매 프레임 generateTexture 0).
 * - 등고선 추적은 **타일 격자를 넘을 때만**(카메라 64px 이동마다) 돌고, 그 사이 프레임은
 *   레이어 position 만 움직인다. 꼭짓점 필드는 행 버퍼 두 줄로 재사용해 셀당 4회가 아니라
 *   **꼭짓점당 1회**만 평가한다.
 * - AO·림은 맥동하지 않으므로 **재구성에서 한 번만** 배치하고 매 프레임 루프에서 뺀다.
 *   프레임마다 만지는 것은 헤일로·코어·열기뿐.
 * - 매 프레임 할당 0(레코드·스프라이트는 풀이 자라는 순간에만 생성).
 *
 * ## 게임플레이 가독성
 * 밝기를 올리되 ①흰색 포화 금지(주황~호박~진홍 대역) ②밝은 면적을 **좁게**(코어 폭 20px)
 * ③화면 대부분은 여전히 어둡게(황혼 곱연산). 밝은 띠가 좁고 배경이 어두우면 청록 적·흰 탄·
 * 노란 젬은 오히려 더 잘 보인다.
 *
 * ## 4차 — "AO 도 림도 화면에 없다"의 진짜 원인은 **합성 순서와 기하**였다
 *
 * 3차는 AO 와 림을 분명히 그렸다(`visible=true`, `alpha>0`). 그런데 비평가는 화면에서 둘 다
 * 못 봤고, 단위 테스트는 전부 그린이었다. 원인은 세기가 아니라 **덮임**이다.
 *
 *  - **AO 는 헤일로 밑에 깔려 있었다.** AO 는 폭 58·오프셋 −20 이라 법선축 [−49, +9] 를
 *    덮는데, 헤일로는 폭 104·오프셋 0 이라 [−52, +52] 다. 즉 **AO 의 자취는 헤일로의 진부분
 *    집합**이고, `view.addChild` 순서가 `aoLayer` → `glowLayer` 라 **가산 헤일로가 나중에
 *    칠해져 곱연산 어둠을 통째로 되돌렸다**. 알파를 아무리 올려도 화면에는 안 나온다.
 *  - **림은 코어 안에 갇혀 있었다.** 림은 폭 7·오프셋 +5 라 [+1.5, +8.5], 코어는 폭 17·
 *    오프셋 0 이라 [−8.5, +8.5]. 림(가산 α≤0.34)이 코어(가산 α≤0.78, 프로파일 지수 6.2)
 *    **바로 위에** 얹히니 기여가 묻힌다.
 *  - **테스트가 못 잡은 이유:** 3차 단언은 전부 *레코드 속성*(`seg.ao > 0`, `seg.rim > 0.3`)
 *    이거나 *스프라이트 알파*였다. **"이 픽셀이 다른 겹에 덮이는가"를 아무도 안 쟀다.**
 *    그래서 4차는 **자취(오프셋·폭)와 합성 순서 자체를 불변식으로 잠근다**
 *    ({@link TerrainLightLayer.layerOrder}·`*SideViolations`·{@link AO_BAND_WIDTH}).
 *
 * 부수로 **방향 신호가 서로를 상쇄하고 있었다**: 3차는 `ao = AO_FLOOR + (1−AO_FLOOR)·up` 이라
 * **림이 가장 밝은 면이 동시에 AO 도 가장 짙었다**. 빛과 그림자가 같은 쪽에 몰리면 방향 정보는
 * 0비트다 — 비평가의 ④(광원 벡터 부재)가 그것이다.
 *
 * ### 4차의 세 요소 (모두 기하로 분리된다)
 *  1. **AO 띠** — 경계 **안쪽(고지, +n)** 오프셋 {@link AO_BAND_OFFSET}, 폭
 *     {@link AO_BAND_WIDTH}(≈15 화면 px)의 **평정부 있는 또렷한 띠**. 흐린 방사 falloff 가
 *     아니라 {@link bakeStreak} 의 `plateau` 인자로 구운 **납작한 머리**의 캡슐이다.
 *     **헤일로보다 나중에** 칠해진다.
 *  2. **드롭 섀도** — 경계 **바깥(저지, −n)** 으로, 빛 반대 방향 편향을 섞은 벡터를 따라
 *     {@link SHADOW_OFFSET} 만큼 떨군 넓고 부드러운 곱연산. **그늘진 면에만** 붙는다.
 *  3. **방향성 림** — 이제 **저지 쪽(−n)** 오프셋 {@link RIM_OFFSET} 에 앉아 코어 밖으로
 *     나온다. 세기와 **폭을 둘 다** `lit` 로 변조하므로 전방위 균일이면 테스트가 깨진다.
 *
 * ### 광원 방향 — 왜 "아래(용암)"인가
 * 이 스테이지의 유일한 실광원은 용암이고, 용암은 저지대와 균열에 있다. 그래서 **표면에서
 * 광원을 향하는 벡터는 화면 아래**({@link TO_LIGHT_Y} = +1)다. 절벽면의 바깥 법선은 −n 이므로
 * `lit = max(0, (−n)·(0,1)) = max(0, −ny)` — 결과 식은 3차와 **같다**. 3차 주석은 "광원이 위에
 * 있다"고 적었는데, 수식이 우연히 겹쳤을 뿐 **AO·그림자의 방향을 그 잘못된 전제로 정했다**
 * (그늘진 면이 오히려 덜 어두웠다). 4차는 전제를 용암 광원으로 바로잡고 **AO·드롭 섀도를 림의
 * 여집합**(`max(0, +ny)`)에 걸어 두 신호가 서로를 상쇄하지 않게 한다.
 *
 * ### 가독성 — 주황 적이 주황 지각에 위장되는 문제
 * 카르곤 적·픽업은 적/주황 계열이라 밝은 지각과 정면 충돌한다. 4차는 **어둡게 하는 쪽을
 * 공격적으로** 쓴다: 황혼 0.26 → {@link DUSK_ALPHA}, 황혼 틴트를 더 진하게, AO 알파를 올리고
 * 드롭 섀도를 신설. 밝은 것은 **좁은 균열 코어에만** 남는다.
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
import { FOREGROUND_SIGNAL_COLORS } from '../textures.js';
import { graphicsTierController } from '../graphicsRuntime.js';
import { effectGates, type EffectGates, type QualityTier } from '../qualityTier.js';
import { graphicsSettings, type GraphicsSettings } from '../graphicsSettings.js';

/**
 * 카르곤 행성 인덱스. `planetEnvironment.ts` 의 `KARGON` 과 같은 값이지만 **import 하지 않는다**
 * — 그쪽이 이 모듈을 import 하므로 순환이 된다(상수 하나 때문에 순환 의존을 만들 이유가 없다).
 */
const KARGON = 0;

// ---------------------------------------------------------------------------
// autotile.ts 복제 상수
//
// ⚠️ autotile 이 이 넷을 export 하면 **복제를 지우고 import 로 교체**한다(파일 상단 주석 참조).
// 통합은 오케스트레이터가 한다. 여기서 값을 바꾸면 지형과 발광의 위상이 어긋난다.
// ---------------------------------------------------------------------------

// 통합 완료(오케스트레이터): 복제를 지우고 autotile 에서 **직접 import** 한다.
// 복제였을 때 실제로 어긋났다 — 타일셋 레인이 `UPPER_THRESHOLD` 를 0.5 → 0.57 로 올렸는데
// 이 파일은 0.5 를 그대로 들고 있어서, 용암 등고선이 **지형이 그리지 않는 경계**에 붙었다.
// 테스트는 전부 그린이었다(각 파일이 자기 상수와만 일관했으므로). 값 하나를 두 곳에 적으면
// 언젠가 갈라진다는 것의 실물 사례라 여기 남긴다.
export { DISPLAY_TILE, NOISE_SCALE, NOISE_SCALE_FINE, UPPER_THRESHOLD, terrainFieldAt };

/** 그래디언트 중앙차분 폭(타일). 잔결 노이즈(3.2타일)보다 충분히 작아야 경계를 제대로 읽는다. */
const GRAD_STEP = 0.4;

/**
 * 지형 필드의 **수치 그래디언트**를 단위 법선으로 정규화해 `out[0]=nx`, `out[1]=ny` 에 쓴다.
 * 필드는 upper 쪽에서 크므로 **법선은 솟아오른(upper) 쪽을 가리킨다**.
 *
 * 화면 좌표는 y 가 아래로 자란다. `ny < 0` 이면 고지가 이 경계의 **북쪽**에 있다는 뜻이고,
 * 그러면 노출된 절벽면은 **남쪽(= 용암 쪽)** 을 향한다 → 빛을 받는다({@link segmentLit}).
 * `ny > 0` 이면 절벽면이 북쪽을 향해 용암을 등진다 → 그늘이다(AO 강화 + 드롭 섀도).
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
// 튜닝 상수 — 밝기·어둠은 **전부 여기 모여 있다**
//
// 타일셋 그림이 병렬로 바뀌는 중이라 새 바닥 위에서 재조정이 필요하다. 그때 손댈 곳이
// 이 블록 하나가 되도록 알파·폭·색을 한 자리에 묶었다(코드 본문에 숫자를 흩지 않는다).
// ---------------------------------------------------------------------------

/**
 * 화면 전체 곱연산 어둠 알파. **명도 구조의 절반은 여기서 나온다.**
 * 1차 화면이 단조로웠던 이유는 전체가 좁은 중간-어두운 갈색 대역에 갇혀 있었기 때문이고,
 * 그 해법은 용암을 밝히는 것만이 아니라 **암괴를 더 어둡게 누르는 것**이다.
 * `floor` 슬롯이라 지형만 어두워지고 엔티티는 그대로다 — 가독성이 오히려 올라간다.
 *
 * **3차에서 0.42 → 0.26 으로 내렸다.** 화면 전체를 어둡게 하는 일은 그레이딩·시차 레인이
 * 더 적합한 자리이고(스플릿 톤·배경 명도 상한을 그쪽이 건다), 세 레이어가 각자 곱연산을
 * 쌓으면 암부가 뭉개진다. 다만 **0 으로 지우지는 않는다** — 이 곱연산은 `floor` 슬롯이라
 * **지형만** 누르고 적·탄·젬은 건드리지 않는다. 그레이딩(전체 화면)이 대체할 수 없는
 * 유일한 성질이고, 그래서 이건 무드 장치가 아니라 **가독성 장치**다.
 *
 * **4차에서 0.26 → 0.38.** 3차는 이 값을 그레이딩 레인에 넘겼는데, 그 결과 지각(주황)이 너무
 * 밝아 **주황 적 탱크·포탑 픽업이 지각 위에서 위장**됐다(전투 프레임 실측 신고). `floor` 슬롯
 * 곱연산은 **지형만** 누르고 엔티티는 안 건드리는 유일한 장치라, 전경-배경 분리를 만드는 데
 * 그레이딩(전체 화면)으로 대체 불가능하다. 밝은 것은 좁은 코어에만 남긴다.
 */
export const DUSK_ALPHA = 0.38;
/**
 * 황혼 틴트(곱연산). 완전 회색이 아니라 살짝 따뜻해 암괴가 차갑게 죽지 않는다.
 * 4차에서 `0x5c4c44` → 더 진하게. 실효 배율 = 1 − α·(1 − tint/255).
 */
const DUSK_TINT = 0x4a3c36;

/**
 * 발광 헤일로 알파 상한(넓은 면적). 1차 0.32 → 0.40.
 * 가산이라 이웃 세그먼트와 겹치면 밝아진다 — 넓은 레이어라 여기가 상한의 실질 병목이다.
 */
export const GLOW_ALPHA = 0.4;
/**
 * 발광 코어 알파 상한(좁은 면적). 1차 0.44 → 2차 0.60 → **3차 0.78**.
 *
 * 3차 비평: "블룸만 있고 광원이 없다". 심지가 **광원으로 읽히려면** 헤일로 대비 명도차가
 * 커야 하는데 0.60 은 헤일로(0.40)의 1.5배라 같은 밝기의 두 겹처럼 보였다. 이제 1.95배다.
 *
 * 흰색 포화 안전성은 계산으로 확인했다: 코어 최대 기여 (255,116,56)×0.78 = (199,90,44),
 * 여기에 헤일로 (255,96,38)×0.40 = (102,38,15) 를 더해도 G≈128·B≈59 로 R 만 클리핑한다.
 * **R 만 클리핑하는 가산은 흰색이 아니라 더 진한 주황이 된다** — 색상 창을 붉은 쪽으로
 * 민 것이 여기서도 안전 마진으로 돌아왔다.
 */
export const CORE_ALPHA = 0.78;
/**
 * 림 라이트 알파 상한(폭 {@link RIM_WIDTH}px 의 실선 — 면적이 극히 좁아 높여도 안전).
 * 3차 0.34 → 4차 0.5. 3차에는 이 값이 문제가 아니었다(코어 밑에 깔려 있었다) — 기하를
 * 고쳐 코어 밖으로 꺼낸 뒤에야 알파가 의미를 갖는다.
 */
export const RIM_ALPHA = 0.5;
/** 열기 상승 알파 상한(가장 옅다 — 공기의 기운이지 광원이 아니다). 1차 0.14 → 0.18. */
export const HEAT_ALPHA = 0.18;
/**
 * AO **띠** 알파 상한(곱연산). 1차 0.38 → 3차 0.52 → **4차 0.66**.
 *
 * 4차에서 AO 는 폭 58 의 흐린 방사 블롭이 아니라 폭 {@link AO_BAND_WIDTH} 의 **좁은 띠**다.
 * 좁아졌으므로 상한을 올려도 화면이 탁해지지 않는다 — "넓은 겹은 낮게, 좁은 겹은 세게"
 * 규칙에서 AO 가 **넓은 쪽에서 좁은 쪽으로 이사**한 것이다.
 * 실효 배율 = 1 − 0.66·(1 − {@link AO_TINT}R/255) ≈ 0.56 (지각 밝기를 거의 절반으로).
 */
export const AO_ALPHA = 0.66;
/**
 * 드롭 섀도 알파 상한(곱연산, 넓은 겹). 고지가 저지로 떨구는 캐스트 섀도.
 * AO(경계 **안쪽**, 좁고 진함)와 **다른 것**이다 — 이건 경계 **바깥**, 넓고 부드럽다.
 */
export const SHADOW_ALPHA = 0.5;

/** 헤일로 띠 폭(월드 px). 넓고 은은. */
const GLOW_WIDTH = 104;
/**
 * 코어 심지 폭(월드 px). **좁게** 유지하는 것이 흰색 포화와 화면 탁해짐을 동시에 막는다.
 * 3차에서 알파를 0.60→0.78 로 올리며 폭을 20→17 로 **좁혔다** — 총 밝은 면적은 거의 그대로
 * 두고 **첨두 명도만** 올리는 것이 "광원처럼 보인다"의 실체다.
 */
const CORE_WIDTH = 17;
/**
 * 림 라이트 선 최대 폭(월드 px). 실제 폭은 `lit` 로 변조되므로 그늘진 쪽은 더 가늘다
 * ({@link RIM_WIDTH_FLOOR}) — 세기와 폭을 **둘 다** 변조해야 "전방위 균일"이 안 된다.
 */
const RIM_WIDTH = 11;
/** 림 폭 변조의 하한 비율. 폭 변조를 지우면(=1) 방향성 테스트가 깨진다. */
const RIM_WIDTH_FLOOR = 0.5;
/**
 * AO **띠** 폭(월드 px). 화면 배율 ≈0.91 이라 ≈15 화면 px — 상용(Dead Cells·Hades)의
 * 4~8px 보다 넓지만, 이 게임의 지형 덩어리가 화면의 3~5할을 차지할 만큼 크므로 같은
 * *상대* 두께를 맞추려면 이 정도가 필요하다. 이보다 좁히면 1080p 다운스케일에서 사라진다.
 *
 * ⚠️ 3차의 AO 는 폭 58 이었다 — 헤일로(104)의 진부분집합이라 **띠로 읽힐 수가 없었다**.
 * "띠"의 조건은 알파가 아니라 **폭과 또렷한 가장자리**다({@link AO_BAND_PLATEAU}).
 */
export const AO_BAND_WIDTH = 16;
/**
 * AO 띠 프로파일의 **평정부 비율**. 0 이면 3차의 흐린 falloff 로 되돌아간다.
 *
 * "띠"와 "블롭"을 가르는 것은 폭도 알파도 아니고 **가장자리가 있는가**다. 부드러운 falloff 는
 * 폭을 아무리 좁혀도 중심만 진한 그라디언트라 "칠해진 영역"으로 읽힌다. 평정부가 있어야
 * 상용의 "경계선을 따라 일정 폭의 또렷한 어두운 띠"가 된다.
 */
export const AO_BAND_PLATEAU = 0.5;
/** AO 띠 falloff 지수(평정부 바깥). */
export const AO_BAND_EXP = 2.6;
/** 드롭 섀도 폭(월드 px). AO 띠와 달리 넓고 부드럽다. */
export const SHADOW_WIDTH = 52;
/** 열기 기둥 폭(월드 px). */
const HEAT_WIDTH = 148;
/** 열기 기둥 세로 늘임(가로 대비). */
const HEAT_STRETCH = 1.55;
/** 열기 기둥을 균열 위로 띄우는 거리(월드 px). */
const HEAT_RISE = 92;

/**
 * AO 띠를 **고지(+n) 쪽**으로 미는 거리(월드 px). "경계 **안쪽**의 접지 어둠"이 되려면
 * 오프셋이 코어 반폭({@link CORE_WIDTH}/2 ≈ 8.5)보다 커서 코어를 먹지 않아야 하고,
 * 동시에 경계에서 너무 멀면 "띠"가 아니라 "고지 한복판의 얼룩"이 된다. 그 사이가 이 값이다.
 */
export const AO_BAND_OFFSET = 15;
/**
 * 드롭 섀도를 **저지(−n) 쪽**으로 떨구는 거리(월드 px). 고지의 두께로 읽히는 값이므로
 * AO 띠 오프셋보다 확실히 커야 층이 분리된다.
 */
export const SHADOW_OFFSET = 40;
/**
 * 드롭 섀도 방향에 섞는 **빛 반대 방향** 편향. 0 이면 순수 −n(경계 수직)이라 그림자가
 * 전방위 균일해지고 광원 벡터가 다시 사라진다. 1 이면 지형과 무관한 평행 그림자가 된다.
 * 그 사이가 "고지가 저지로 떨군, 그런데 광원 방향을 아는" 그림자다.
 */
const SHADOW_LIGHT_BIAS = 0.55;
/**
 * 림을 **저지(−n) 쪽**으로 미는 거리(월드 px). 3차는 +5(고지 쪽)라 코어(±8.5) 안에 갇혔다.
 * 이제 코어 바깥에 나와 "용암을 마주 본 절벽면이 달궈진" 선으로 읽힌다.
 */
export const RIM_OFFSET = -17;

/**
 * 표면에서 **광원을 향하는** 단위 벡터의 y 성분. 이 스테이지의 유일한 실광원은 용암이고
 * 용암은 저지·균열에 있다 → 빛은 아래에서 위로 올라온다 → 광원은 화면 **아래**(+y).
 *
 * 절벽면의 바깥 법선은 `−n` 이므로 `lit = max(0, (−n)·(0,1)) = max(0, −ny)`.
 * (x 성분은 0 이다 — 용암은 좌우 어느 쪽에도 치우쳐 있지 않다. 상수로 두면 시드마다 조명이
 *  기울어 지형이 "왼쪽으로 쓰러진" 것처럼 보인다.)
 */
export const TO_LIGHT_Y = 1;

/**
 * ## 색상 분리 — 전경 위험물과 배경 발광은 **색으로 갈라야** 한다 (3차, 가독성 최우선)
 *
 * 2차 팔레트는 적탄과 색이 겹쳤다. 실측(`src/render/textures.ts`):
 *
 * | 요소 | 색 | 색상각 | 채도 |
 * |---|---|---|---|
 * | 적탄 기본(hot-red 아웃라인) | `0xff2233` | **355.4°** | 0.867 |
 * | 적탄 가속(앰버) | `0xff8a20` | **28.5°** | 0.875 |
 * | 적탄 곡사(옐로) | `0xffe033` | 50.9° | 0.800 |
 * | 적탄 유도(마젠타) | `0xff33cc` | 315.0° | 0.800 |
 * | 적탄 분열(퍼플) | `0xb060ff` | 270.2° | 0.624 |
 * | 아군탄(시안) | `0x39d0ff` | 195.4° | 0.776 |
 * | **2차 코어 `0xff8a30`** | — | **26.1°** | 0.812 |
 *
 * 2차 코어 색 하나가 **가속 적탄과 색상각 2.4° 차이**였다(26.1° vs 28.5°). 사람 눈에 2.4° 는
 * 같은 색이다. 배경 띠와 전경 위험물이 같은 시각 서명을 갖는 건 미학 문제가 아니라 **사고**다.
 *
 * 배경 용암은 이제 **[10°, 19°] 창**에만 산다 — 앰버 적탄(28.5°)에서 ≥10°, hot-red 적탄
 * (355.4°)에서 ≥12° 떨어진 **적탄 사이의 빈 골짜기**다. 두 위험 색이 양쪽에서 창을 좁히므로
 * "붉은 쪽으로 더 밀면 된다"가 성립하지 않는다 — hot-red 에 붙기 때문이다. 창의 폭 자체가
 * 이 팔레트의 제약이며, 그래서 여기 수치를 손대면 {@link tests/kargonLavaLight.test.ts} 의
 * 분리 거리 테스트가 즉시 깨진다.
 *
 * 부수 효과: 붉은 쪽으로 밀면 G 가 자동으로 내려가(≤ 0x74) 흰색 포화 여유가 오히려 커졌다.
 */
const GLOW_COLORS: readonly number[] = [0xff4f1f, 0xe83a17, 0xff6026, 0xd43511];
/**
 * 코어 색(같은 인덱스로 짝지어 쓴다). 헤일로와 같은 색상 창 안이되 명도가 높다.
 * **G 를 0xb4 이하로** 묶는 불변식은 유지 — 이음매에서 두 코어가 겹칠 때 G 까지 포화하면
 * 흰색이 되기 때문이다(실제 최댓값은 0x74 라 여유가 크다).
 */
const CORE_COLORS: readonly number[] = [0xff6d33, 0xff5f2e, 0xff7438, 0xff5729];
/** 열기 상승 색(창의 가장 붉은 끝 — 위로 갈수록 식는 느낌). */
const HEAT_COLOR = 0xff3d12;
/** 림 라이트 색("달궈진 돌 모서리"). 창 안에서 가장 저채도 = 가장 돌에 가깝다. */
const RIM_COLOR = 0xff7842;

/**
 * 배경 발광 색상 창(도). 이 창 밖으로 나가면 전경 적탄과 시각 서명이 겹친다.
 * 테스트가 팔레트 전체를 이 창 안에 가둔다.
 */
export const LAVA_HUE_MIN = 10;
export const LAVA_HUE_MAX = 18.4;
/** 전경 위험물(적탄) 색과 유지해야 하는 최소 색상각 거리(도). */
export const HOSTILE_HUE_GAP = 10;

// 전경 위험물·아군 식별 색(가독성 계약의 반대편)은 **복제하지 않고 `textures.ts` 에서 import**
// 한다. 3차 개발 중에는 여기 복제본이 있었는데, 같은 레인에서 `UPPER_THRESHOLD` 복제본이 실제로
// 갈라져 발광이 지형이 그리지 않는 등고선에 붙은 전례가 있어 통합 시 정본으로 합쳤다.
// 적탄 색이 바뀌면 아래 분리 거리 테스트가 자동으로 재평가된다 — 그게 이 import 의 목적이다.
export { FOREGROUND_SIGNAL_COLORS };

/** 색상각(도, [0,360)) — 분리 거리 계산·테스트의 정본. */
export function hueOf(color: number): number {
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** HSV 채도 [0,1]. */
export function saturationOf(color: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const max = Math.max(r, g, b);
  if (max === 0) return 0;
  return (max - Math.min(r, g, b)) / max;
}

/** 원형 색상각 거리(도, 0~180). */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(hueOf(a) - hueOf(b)) % 360;
  return d > 180 ? 360 - d : d;
}

/** 이 레이어가 화면에 얹는 모든 색(테스트가 통째로 훑는다). */
export const LAVA_PALETTE: readonly number[] = [
  ...GLOW_COLORS,
  ...CORE_COLORS,
  HEAT_COLOR,
  RIM_COLOR,
];
/**
 * AO 틴트(곱연산). 완전 검정이 아니라 따뜻한 회갈색이라 그림자가 죽지 않는다.
 * 4차에서 `0x60524a` → 더 진하게(띠가 좁아진 만큼 세게 눌러도 화면이 탁해지지 않는다).
 */
const AO_TINT = 0x54463e;
/** 드롭 섀도 틴트(곱연산). AO 보다 옅다 — 캐스트 섀도는 접지 어둠보다 항상 밝다. */
const SHADOW_TINT = 0x584a42;

// ---------------------------------------------------------------------------
// 등고선·용암 지대 튜닝
// ---------------------------------------------------------------------------

/** 가시 영역 밖으로 유지하는 타일 링(팝인 방지). */
const MARGIN_TILES = 2;
/**
 * 뜨거운 지역 필드의 스케일(타일). 이 크기의 덩어리로 용암 지대가 뭉쳐 **강이 이어진다**.
 *
 * 8타일 = 512px 는 화면(1920×1080 ≈ 30×17타일) 안에 뜨거운 덩어리가 서너 개 들어가는 크기다.
 * 더 키우면(첫 시도 15타일) 한 화면이 통째로 용암이거나 통째로 식은 상태가 되어 지역 편차가
 * 사라진다 — 실제로 시드 하나에서 등고선의 90%가 용암이 됐다.
 */
const HEAT_REGION_TILES = 8;
/** 이 값을 넘는 지역의 등고선만 용암이 된다. 높일수록 용암 강이 희소해진다(실측 평균 비율 ≈0.39). */
const HEAT_REGION_THRESHOLD = 0.55;
/** 임계를 넘은 뒤 완전히 뜨거워지기까지의 폭(좁을수록 "안쪽은 확실히 뜨겁다"). */
const HEAT_REGION_SPAN = 0.15;
// --- 3차: "꺼진 경계"를 없앤다 --------------------------------------------
//
// 2차는 `region ≤ THRESHOLD` 인 세그먼트의 heat 를 **정확히 0** 으로 만들어 발광을 통째로
// 껐다. 실측 승격 비율이 약 0.39 였으므로 경계의 **6할이 완전히 검었다**. 화면에서는 그게
// "어떤 가장자리는 뜨겁고 어떤 건 아니다"가 아니라 **누락**으로 읽힌다 — 특히 플레이어가
// 서 있던 중앙 하단의 거대한 경계가 통째로 꺼져 있었다.
//
// 재질 규칙은 전역적으로 일관해야 한다: **모든 orange↔dark 모서리는 최소한 잔열을 갖는다.**
// 다만 균일하게 다 켜면 반대로 촌스러우므로, 잔열 자체를 **지역 필드와 다른 스케일·다른
// 시드의 저주파 노이즈**로 변조해 "지금 뜨거운 균열"과 "식은 균열"이 섞이게 한다.

/**
 * 모든 경계가 갖는 **잔열 하한**. 0 이 아닌 것이 3차의 핵심이다.
 * 이 값에서 헤일로 실효 알파 ≈ 0.40×0.28×0.85 ≈ 0.095, 코어 ≈ 0.78×0.28×0.85 ≈ 0.186 —
 * 어둡게 깔린 암괴 위에서 "식었지만 아직 온기가 있는 균열"로 읽히는 대역이다.
 */
export const EMBER_MIN = 0.28;
/** 잔열 상한(저주파 변조의 마루). 여기까지는 "뜨거운 지역"이 아니어도 도달할 수 있다. */
export const EMBER_MAX = 0.52;
/**
 * 잔열 변조 필드 스케일(타일). {@link HEAT_REGION_TILES}(8) 과 **서로소가 아니어도 좋지만
 * 크게 달라야** 한다 — 같은 스케일이면 두 필드의 마루가 겹쳐 변조가 지역 필드의 복사본이
 * 되고, 결국 "뜨거운 곳은 더 뜨겁고 식은 곳은 더 식은" 2차의 이분법으로 되돌아간다.
 */
const EMBER_MOD_TILES = 3.4;
/** fbm 은 0.5 근처에 몰린다 — 변조 대비를 살리려면 이 창을 [0,1] 로 늘여야 한다. */
const EMBER_REMAP_LO = 0.32;
const EMBER_REMAP_HI = 0.68;

/**
 * 열기 기둥(가장 넓고 가장 옅은 겹)을 그리는 세기 하한. **잔열에는 안 붙인다** —
 * 모든 경계에서 기둥이 피어오르면 화면이 균일한 주황 안개가 되고, 그러면 잔열을 깐 의도
 * (강약 대비)가 스스로 무너진다. 기둥은 "진짜 뜨거운 채널"의 표식으로만 남긴다.
 */
const HEAT_PLUME_MIN = 0.62;

/**
 * 저티어에서 버리는 잔열 세기 하한. 2차는 `heat === 0` 인 세그먼트를 버려 예산을 아꼈는데
 * 이제 heat 가 0 이 되지 않으므로(잔열 하한) 그 조건이 사문화된다. 대신 **약한 절반**을
 * 버려 같은 목적을 유지한다.
 */
const LOW_TIER_HEAT_MIN = 0.45;
/** 저티어에서 잔열이 약해도 살려두는 림 세기(윤곽 정보라 가치가 다르다). */
const LOW_TIER_RIM_MIN = 0.5;
/**
 * AO 세기 하한. **모든 경계에 AO 띠가 있다**는 것이 4차의 계약이므로 이 값은 크다 —
 * 방향은 그 위에 실리는 변조일 뿐, 방향 때문에 AO 가 사라지지는 않는다.
 * 3차는 0.45 였고, 게다가 방향 항이 **림과 같은 쪽**이라 그늘진 면이 오히려 덜 어두웠다.
 */
export const AO_FLOOR = 0.62;
/** 이보다 약한 림은 그리지 않는다(법선이 아래를 향하는 경계 — 빛을 못 받는다). */
const RIM_MIN = 0.18;
/** 이보다 약한 드롭 섀도는 그리지 않는다(빛을 정면으로 받는 면은 그림자를 안 떨군다). */
const SHADOW_MIN = 0.12;

/** 세그먼트 상한(병적인 시야 확대에서도 풀이 폭주하지 않게). */
const MAX_SEGMENTS = 420;
/** 저티어 세그먼트 상한. */
const MAX_SEGMENTS_LOW = 170;

/** 티어별 발광 배율(항상 ≤ 1 — 상한 불변식을 깨지 않는다). */
function tierScale(tier: QualityTier): number {
  return tier === 'low' ? 0.62 : tier === 'med' ? 0.88 : 1;
}

// --- 3차: `gates.halo` 게이팅 완화 -----------------------------------------
//
// 2차는 `gates.halo === false`(= low 티어 **또는** `reducedGlow`)에서 발광 네 겹을 통째로
// 내렸다. 실측 결과 그 상태에서 **가시 발광 0** — 카르곤 화면이 무채색 암괴만 남았다.
// 용암은 이 행성의 아트 디렉션 자체라 "없어도 되는 장식"이 아니다.
//
// 그래서 정책을 **끄기 → 줄이기**로 바꾼다. 광과민 대응의 취지(밝은 면적·깜빡임을 줄인다)는
// 다음 셋으로 지킨다:
//  ① 넓은 겹(헤일로·열기)을 강하게 눌러 **밝은 면적**을 줄인다.
//  ② 좁은 겹(코어)만 남겨 형태를 유지한다 — 면적이 작아 광과민 부담이 작다.
//  ③ `reducedGlow` 에서는 **맥동을 아예 정지**시킨다({@link REDUCED_GLOW_PULSE}).
//     광과민의 실제 위험은 평균 밝기가 아니라 **주기적 변조**다. 2차는 이걸 못 껐고
//     대신 레이어를 통째로 지웠다 — 부작용이 훨씬 컸다.

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
 * 용암 맥동 밝기 — **`tick` 의 순수 함수**. 같은 tick·phase 면 언제나 같은 값이다.
 *
 * 서로 약분되지 않는 두 사인을 겹쳐(주기 ≈5.8초 / ≈14.7초) 숨 쉬는 듯한 비반복 파형을 만든다.
 * 단일 사인은 몇 초만 봐도 기계적으로 읽힌다.
 *
 * 파형 중심을 0.6 → **0.74** 로 올렸다. 1차에서는 이 항이 평균 0.6 을 곱해 실효 알파를
 * 40% 깎는 세 번째 감쇠원이었다. 맥동은 "밝기를 깎는 장치"가 아니라 "숨 쉬는 장치"여야 한다.
 *
 * @param tick  보간된 sim 틱({@link EnvFrame.tick}). 벽시계가 아니다 — 그래야 프레임 스킵·탭
 *              백그라운드 복귀에서 밝기가 튀지 않고 리플레이가 같은 그림을 낸다.
 * @param phase 세그먼트별 위상 [0,1). 용암 전체가 한꺼번에 숨쉬지 않게 흩는다.
 * @returns [{@link PULSE_MIN}, {@link PULSE_MAX}] 안의 값(하드 클램프).
 */
export function heatPulse(tick: number, phase: number): number {
  const a = Math.sin(tick * PULSE_W1 + phase * TAU);
  const b = Math.sin(tick * PULSE_W2 + phase * TAU * 1.7 + 1.3);
  const raw = 0.74 + 0.17 * a + 0.09 * b; // 파형 자연 범위 [0.48, 1.00]
  return raw < PULSE_MIN ? PULSE_MIN : raw > PULSE_MAX ? PULSE_MAX : raw;
}

/**
 * 최종 알파 = 상한 × 세기 × 맥동 × 티어배율. 세 인자가 모두 [0,1] 이라 **결과는 상한을 절대
 * 넘지 않는다** — 포화 방지 불변식의 정본이며 테스트가 이걸 잠근다.
 */
export function emitterAlpha(cap: number, strength: number, pulse: number, tier: number): number {
  const v = cap * strength * pulse * tier;
  return v < 0 ? 0 : v > cap ? cap : v;
}

// ---------------------------------------------------------------------------
// 마칭 스퀘어즈 — 용암 채널의 중심선
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
 * 타일 셀 (i,j) 의 네 꼭짓점 필드값에서 0.5 등고선 세그먼트를 뽑아 `out` 에 **월드 px** 로 쓴다.
 * 꼭짓점 값을 인자로 받는 이유는 레이어가 행 버퍼로 값을 재사용하기 때문이다(꼭짓점당 1회 평가).
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
export interface LavaSegment {
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
  /** 용암 세기 [0,1]. 0 이면 이 구간은 식은 균열이다(발광 없음, AO·림만). */
  heat: number;
  /** 림 세기 [0,1] = `fade(lit)`. 절벽면이 용암(화면 아래)을 마주볼수록 크다. */
  rim: number;
  /** AO 세기 [0,1]. 하한 {@link AO_FLOOR} + 그늘 성분 — **림의 여집합**에 실린다. */
  ao: number;
  /** 드롭 섀도 세기 [0,1]. 빛을 등진 면(`ny > 0`)에서만 0 보다 크다. */
  shadow: number;
  /** 드롭 섀도 오프셋 방향(단위 벡터, −n 과 빛 반대 방향의 혼합). */
  shadowX: number;
  shadowY: number;
  /** 맥동 위상 [0,1). */
  phase: number;
  /** 헤일로 색·코어 색(주황~호박). */
  color: number;
  coreColor: number;
}

/** 빈 레코드(풀 확장·테스트 스크래치용). */
export function createSegment(): LavaSegment {
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
    heat: 0,
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
 * 경계면이 **광원(아래의 용암)** 을 마주보는 정도 [0,1] — 조명 모델의 정본.
 *
 * 절벽면의 바깥 법선은 `−n`(고지에서 저지를 향한다). 표면 → 광원 벡터는 `(0, TO_LIGHT_Y)`.
 * 램버트 항 `max(0, (−n)·(0,1)) = max(0, −ny)`.
 *
 * 이 함수를 상수로 만들면(= 전방위 균일) 림 방향성 테스트가 즉시 깨진다 — 그게 이걸 별도
 * export 로 뽑아 둔 이유다(비평 ④ "광원 벡터가 존재하지 않는다"의 회귀 지점).
 */
export function segmentLit(_nx: number, ny: number): number {
  const d = -ny * TO_LIGHT_Y;
  return d > 0 ? (d > 1 ? 1 : d) : 0;
}

/**
 * 등고선 세그먼트 하나의 시각 속성을 채운다. **(seed, 끝점) 의 순수 함수.**
 *
 * 절차:
 *  1. 기하(중점·길이·각).
 *  2. 그래디언트 → 법선. `ny < 0` 이면 위를 향한 면 → 림을 받고 AO 는 아래로 떨어진다.
 *  3. 저주파 "뜨거운 지역" 필드로 등고선 중 **일부 구간만** 용암으로 승격시킨다. 지역 필드가
 *     저주파라 승격 구간이 **연속 덩어리**로 나오고, 그래서 용암이 강처럼 이어진다. 모든
 *     경계를 균일하게 빛나게 하면 오히려 평평해 보인다.
 */
export function evaluateSegment(
  seed: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  out: LavaSegment,
): void {
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

  // ── 방향성 라이팅. 광원은 **아래(용암)** 다({@link TO_LIGHT_Y}).
  // 절벽면의 바깥 법선은 −n 이므로 lit = max(0, (−n)·(0,+1)) = max(0, −ny).
  //
  // ⚠️ 3차는 `rim` 과 `ao` 를 **둘 다** 이 값에 비례시켰다 — 가장 밝은 면이 동시에 가장 짙게
  // 그늘져 방향 정보가 서로를 상쇄했다. 4차는 **여집합**으로 갈라 놓는다: 빛을 받는 면은
  // 림, 등진 면은 AO 강화 + 드롭 섀도. 이 갈라짐이 "광원 벡터가 존재한다"의 실체다.
  const lit = segmentLit(nx, ny);
  const litSmooth = fade(lit);
  const shade = fade(ny > 0 ? ny : 0);
  out.rim = litSmooth;
  out.ao = AO_FLOOR + (1 - AO_FLOOR) * shade;
  out.shadow = shade;

  // 드롭 섀도 방향 = 저지 쪽(−n) + 빛 반대 방향(위) 편향. 정규화해 오프셋 길이를 상수로 유지.
  const sxRaw = -nx;
  const syRaw = -ny - SHADOW_LIGHT_BIAS * TO_LIGHT_Y;
  const sm = Math.sqrt(sxRaw * sxRaw + syRaw * syRaw);
  if (sm < 1e-9) {
    out.shadowX = 0;
    out.shadowY = -1;
  } else {
    out.shadowX = sxRaw / sm;
    out.shadowY = syRaw / sm;
  }

  // ── 뜨거운 지역(저주파, 8타일) — "지금 분출 중인 채널"이 어디냐.
  const region = fbm(seed ^ 0x1a5ec0de, vx / HEAT_REGION_TILES, vy / HEAT_REGION_TILES, 2);
  const excessRaw = (region - HEAT_REGION_THRESHOLD) / HEAT_REGION_SPAN;
  const excess = excessRaw <= 0 ? 0 : excessRaw >= 1 ? 1 : excessRaw;
  const hot = fade(excess);

  // ── 잔열 변조(저주파, 3.4타일 · 다른 시드) — 지역 필드와 **독립**이라 두 필드의 마루가
  //    어긋나고, 그래서 "뜨거운 지역 밖"에서도 강약이 생긴다. 이게 없으면 잔열이 상수가 되어
  //    모든 경계가 똑같은 밝기로 켜지고, 비평가가 경고한 "균일하게 다 켜서 촌스러움"이 된다.
  const emberRaw = fbm(
    seed ^ 0x51e3b0a7,
    vx / EMBER_MOD_TILES + 37.5,
    vy / EMBER_MOD_TILES - 12.25,
    2,
  );
  const eRemap = (emberRaw - EMBER_REMAP_LO) / (EMBER_REMAP_HI - EMBER_REMAP_LO);
  const eClamped = eRemap <= 0 ? 0 : eRemap >= 1 ? 1 : eRemap;
  const ember = EMBER_MIN + (EMBER_MAX - EMBER_MIN) * fade(eClamped);

  // 잔열을 바닥으로 깔고 뜨거운 지역이 1 까지 끌어올린다. `hot === 0` 이어도 heat ≥ EMBER_MIN
  // 이므로 **완전히 꺼진 경계가 없다**. 뜨거운 지역은 여전히 압도적으로 밝다(hot=1 → heat=1).
  out.heat = ember + (1 - ember) * hot;

  // 위상·색은 셀 단위로 잡아 같은 셀의 두 세그먼트(안장점)가 따로 놀지 않게 한다.
  const ci = Math.floor(mx / DISPLAY_TILE);
  const cj = Math.floor(my / DISPLAY_TILE);
  out.phase = hash3(seed, ci, cj, 47);
  const k = Math.floor(hash3(seed, ci, cj, 59) * GLOW_COLORS.length) % GLOW_COLORS.length;
  out.color = GLOW_COLORS[k] ?? 0xff6a1e;
  out.coreColor = CORE_COLORS[k] ?? 0xffa445;
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
 * 이것이 "흐린 블롭"과 "또렷한 띠"를 가르는 유일한 인자다 — 3차 AO 는 `plateau = 0` 의
 * 부드러운 방사 falloff 라, 알파를 올려도 가장자리가 없어 **띠로 읽힐 수 없었다**.
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

/** 소프트 방사 그라디언트(열기 기둥용). */
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
 * 필요하다). 그래서 프로파일을 순수 함수로 뽑아 export 한다 — 4차의 요점("흐린 블롭이
 * 아니라 또렷한 띠")이 걸린 유일한 인자가 `plateau` 이고, 이걸 잠그지 않으면 0 으로
 * 되돌려도 아무 테스트가 안 깨진다(실제로 뮤테이션이 살아남았다).
 */
export function bandProfile(t: number, exp: number, plateau: number): number {
  if (t <= plateau) return 1;
  const span = 1 - plateau;
  if (span <= 0) return 0;
  return Math.pow(1 - (t - plateau) / span, exp);
}

/** 스프라이트 위치가 세그먼트 중점에서 법선축으로 얼마나 떨어졌는가(부호가 곧 "어느 쪽"). */
function dotN(seg: LavaSegment, px: number, py: number): number {
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
   * 렌더 순서(뒤 → 앞): 황혼 → **헤일로** → 드롭 섀도 → AO 띠 → 코어 → 림 → 열기.
   *
   * ⚠️ **곱연산 두 겹이 가산 헤일로보다 뒤에 있으면 화면에서 사라진다.** 3차가 정확히 그
   * 순서였다(`ao` → `glow`): AO 의 자취가 헤일로의 진부분집합이라, 나중에 칠해진 가산
   * 헤일로가 곱연산 어둠을 통째로 되돌렸다. 알파를 올려도 안 보였던 이유가 이 한 줄이다.
   * 순서 자체를 {@link layerOrder} 로 노출해 테스트가 잠근다.
   *
   * 코어는 AO 보다 **뒤**(=나중)라, AO 띠와 코어가 겹치는 좁은 구간에서는 용암 심지가 이긴다.
   */
  private readonly dusk = new Sprite(Texture.WHITE);
  private readonly glowLayer = new Container();
  private readonly shadowLayer = new Container();
  private readonly aoLayer = new Container();
  private readonly coreLayer = new Container();
  private readonly rimLayer = new Container();
  private readonly heatLayer = new Container();

  private readonly aoPool: Sprite[] = [];
  private readonly shadowPool: Sprite[] = [];
  private readonly glowPool: Sprite[] = [];
  private readonly corePool: Sprite[] = [];
  private readonly rimPool: Sprite[] = [];
  private readonly heatPool: Sprite[] = [];

  /** 재사용 세그먼트 레코드(길이 = 풀 용량, 유효 개수는 `count`). */
  private readonly segments: LavaSegment[] = [];
  private count = 0;
  /** 마칭 스퀘어즈 출력 스크래치(셀당 최대 2 세그먼트). */
  private readonly cellOut: number[] = new Array<number>(SEG_STRIDE * MAX_SEG_PER_CELL).fill(0);
  /** 꼭짓점 필드 행 버퍼 두 줄(꼭짓점당 1회 평가). */
  private rowA: Float64Array = new Float64Array(0);
  private rowB: Float64Array = new Float64Array(0);

  private enabled = false;
  private seed = 0;
  /** 구운 텍스처. 렌더러가 없으면 `Texture.WHITE` 폴백. */
  private streakSoft: Texture = Texture.WHITE;
  private streakCore: Texture = Texture.WHITE;
  /** 평정부가 있는 **또렷한 띠**(AO 전용). 소프트 캡슐과 섞어 쓰면 4차의 요점이 사라진다. */
  private streakBand: Texture = Texture.WHITE;
  private radialSoft: Texture = Texture.WHITE;
  private baked = false;

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
    this.dusk.tint = DUSK_TINT;
    this.dusk.alpha = DUSK_ALPHA;
    this.dusk.label = 'dusk';
    this.glowLayer.label = 'glow';
    this.shadowLayer.label = 'shadow';
    this.aoLayer.label = 'ao';
    this.coreLayer.label = 'core';
    this.rimLayer.label = 'rim';
    this.heatLayer.label = 'heat';
    this.view.addChild(
      this.dusk,
      this.glowLayer,
      this.shadowLayer,
      this.aoLayer,
      this.coreLayer,
      this.rimLayer,
      this.heatLayer,
    );
  }

  configure(ctx: EnvContext): boolean {
    this.enabled = ctx.planet === KARGON;
    if (!this.enabled) {
      // 구독을 남기면 카르곤이 아닌 런 내내 설정 변경 콜백이 살아 있게 된다(누수).
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.hideAll();
      return false;
    }
    this.seed = ctx.seed >>> 0;
    this.dirty = true;
    this.lastI0 = Number.NaN;

    // 텍스처는 **한 번만** 굽는다. 런을 반복할 때마다 구우면 GPU 메모리가 누적된다.
    // 캔버스 없는 테스트에서는 `renderer` 가 없다 — 던지지 않고 흰 텍스처로 폴백한다.
    if (!this.baked && ctx.renderer !== undefined) {
      this.streakSoft = bakeStreak(ctx.renderer, 2.1);
      // 코어 프로파일 지수 2차 4.4 → 3차 6.2. **같은 알파에서 첨두 명도만 올리는** 지렛대다:
      // falloff 가 가팔라져 에너지가 중심선에 몰리므로 "블룸"이 아니라 "광원"으로 읽힌다.
      this.streakCore = bakeStreak(ctx.renderer, 6.2);
      // AO 띠는 **평정부**가 있어야 "칠해진 영역"이 아니라 "패인 홈"으로 읽힌다.
      this.streakBand = bakeStreak(ctx.renderer, AO_BAND_EXP, AO_BAND_PLATEAU);
      this.radialSoft = bakeRadial(ctx.renderer, 2.4);
      this.baked = true;
      for (const s of this.glowPool) s.texture = this.streakSoft;
      for (const s of this.shadowPool) s.texture = this.streakSoft;
      for (const s of this.aoPool) s.texture = this.streakBand;
      for (const s of this.corePool) s.texture = this.streakCore;
      for (const s of this.rimPool) s.texture = this.streakCore;
      for (const s of this.heatPool) s.texture = this.radialSoft;
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
    // 있고 레이어만 움직인다 → 카메라가 돌아오면 같은 자리가 같은 밝기로 뜨겁다.
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
    // 폴백(Texture.WHITE)은 공유 자원이라 **절대** destroy 하지 않는다.
    if (this.baked) {
      this.streakSoft.destroy(true);
      this.streakCore.destroy(true);
      this.streakBand.destroy(true);
      this.radialSoft.destroy(true);
      this.baked = false;
    }
    this.view.destroy({ children: true });
  }

  /** 진단·테스트용: 현재 프레임에 살아 있는 등고선 세그먼트 수. */
  get segmentCount(): number {
    return this.count;
  }

  /** @deprecated 1차 API 호환용 별칭. {@link segmentCount} 를 써라. */
  get emitterCount(): number {
    return this.count;
  }

  /**
   * 진단·테스트용: 현재 프레임에 **실제로 보이는** 코어 스프라이트의 최대 알파.
   *
   * 이 값이 0 이면 "용암이 화면에서 사라졌다"는 뜻이다. 2차의 저티어·`reducedGlow` 결함이
   * 정확히 그 상태였는데, 단위 테스트는 전부 그린이었다 — **가시성 자체를 아무도 안 재고
   * 있었기 때문**이다. 그래서 관측 가능한 수치로 노출해 테스트가 하한을 잠근다.
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
   * 진단·테스트용: 현재 프레임에 보이는 열기 기둥 수.
   *
   * 기둥은 가장 넓은 겹이라 **모든 경계에 붙이면 화면이 균일한 주황 안개**가 된다 —
   * 잔열을 깐 목적(강약 대비)이 스스로 무너지는 실패 모드다. 세그먼트 수보다 확실히
   * 작다는 것을 테스트가 잠근다.
   */
  get visiblePlumeCount(): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.heatPool[i]?.visible === true) n++;
    return n;
  }

  /**
   * 진단·테스트용: 보이는 헤일로 띠 **두께의 최대/최소 비**.
   *
   * 잔열을 전 경계에 깐 뒤 화면이 촌스러워지지 않게 막는 장치는 둘이다 — 알파 변조(세기)와
   * **폭 변조**. 폭까지 균일하면 잔열이 화면을 주황으로 도배한다. 알파만 보는 테스트는 폭
   * 변조가 사라져도 통과하므로(실제로 뮤테이션이 살아남았다) 이 축을 따로 노출한다.
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
  // 4차 진단 축 — **"그려졌는가"가 아니라 "덮이지 않았는가"를 잰다**
  //
  // 3차의 AO·림은 `visible=true`·`alpha>0` 이었고 테스트는 그린이었는데 화면에는 없었다.
  // 원인은 합성 순서(가산 헤일로가 곱연산 AO 를 되돌림)와 기하(림이 코어 안에 갇힘)였다.
  // 아래 축들은 그 두 실패를 직접 관측한다.
  // -------------------------------------------------------------------------

  /**
   * `view` 자식들의 라벨 순서(뒤 → 앞). **AO·드롭 섀도가 헤일로보다 뒤(=나중)** 여야 한다.
   * 3차의 결함은 코드 한 줄의 순서였고, 그건 스프라이트 속성으로는 절대 안 잡힌다.
   */
  get layerOrder(): readonly string[] {
    return this.view.children.map((c) => String(c.label ?? ''));
  }

  /** 진단·테스트용: 보이는 AO 띠 수. 모든 세그먼트에 붙는 것이 4차 계약이다. */
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

  /** 보이는 드롭 섀도 수. */
  get visibleShadowCount(): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.shadowPool[i]?.visible === true) n++;
    return n;
  }

  /**
   * 스프라이트가 **틀린 쪽**에 놓인 건수. AO 띠는 고지(+n), 드롭 섀도·림은 저지(−n) 여야 한다.
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

  /** 진단·테스트용: 현재 프레임 세그먼트들의 최소 용암 세기(잔열 하한 관측). */
  get minSegmentHeat(): number {
    let m = Infinity;
    for (let i = 0; i < this.count; i++) {
      const h = this.segments[i]?.heat ?? 0;
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
   * 가시 타일 범위의 0.5 등고선을 마칭 스퀘어즈로 뽑아 세그먼트 목록을 다시 만들고,
   * **맥동하지 않는 스프라이트(AO·림)까지 여기서 배치**한다(매 프레임 루프에서 빼기 위함).
   */
  private rebuild(i0: number, j0: number, i1: number, j1: number): void {
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
            seed,
            out[o] ?? 0,
            out[o + 1] ?? 0,
            out[o + 2] ?? 0,
            out[o + 3] ?? 0,
            rec,
          );
          if (rec.rim < RIM_MIN) rec.rim = 0;
          // 저티어에서는 **약한** 잔열 + 림 없음인 세그먼트를 버려 예산을 강한 것에 몰아준다.
          // (2차의 `heat === 0` 조건은 잔열 하한이 생기며 사문화됐다 — 조건이 영영 거짓이
          //  되는 컬링은 "성능 최적화가 조용히 사라진" 상태다.)
          if (
            this.tier === 'low' &&
            rec.heat < LOW_TIER_HEAT_MIN &&
            rec.rim < LOW_TIER_RIM_MIN
          ) {
            continue;
          }
          this.applyStatic(n, rec);
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
      const h = this.heatPool[idx];
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
   * 맥동하지 않는 두 겹(AO·림)을 배치한다. 재구성에서만 호출된다.
   *
   * AO 가 맥동하지 않는 이유: 그림자는 기하 정보다. 같이 숨쉬면 지형이 출렁이는 것처럼 보여
   * 오히려 입체감이 깨진다. 림도 같은 이유로 고정 — 모서리는 흔들리지 않는다.
   */
  private applyStatic(idx: number, seg: LavaSegment): void {
    const ao = this.aoPool[idx];
    const rim = this.rimPool[idx];
    const shadow = this.shadowPool[idx];
    if (!ao || !rim || !shadow) return;

    // ② AO 띠 — 경계 **안쪽**(고지 +n) 의 좁고 또렷한 홈(곱연산). 모든 경계에 붙는다.
    this.place(ao, seg, AO_BAND_WIDTH, AO_BAND_OFFSET);
    ao.tint = AO_TINT;
    ao.alpha = emitterAlpha(AO_ALPHA, seg.ao, 1, 1);
    ao.visible = true;

    // ③ 드롭 섀도 — 경계 **바깥**(저지 −n) 으로 떨군 캐스트 섀도(곱연산).
    // AO 와 **다른 것**이다: 저쪽은 경계 안쪽·좁음·전 구간, 이쪽은 바깥·넓음·그늘진 면만.
    if (seg.shadow > SHADOW_MIN) {
      this.placeAt(
        shadow,
        seg,
        SHADOW_WIDTH,
        seg.shadowX * SHADOW_OFFSET,
        seg.shadowY * SHADOW_OFFSET,
      );
      shadow.tint = SHADOW_TINT;
      shadow.alpha = emitterAlpha(SHADOW_ALPHA, seg.shadow, 1, 1);
      shadow.visible = true;
    } else {
      shadow.visible = false;
    }

    // ④ 림 라이트 — 용암(화면 아래)을 마주본 절벽면에만. 이제 **저지 쪽**(코어 바깥)에 앉는다.
    // 세기뿐 아니라 **폭도** `lit` 로 변조한다 — 알파만 변조하면 "전방위 균일"에 가까워 보인다.
    // `gates.halo` 가 꺼져도 **끄지 않고 줄인다**(3차 정책, {@link glowGateScales}).
    if (seg.rim > 0) {
      const gs = glowGateScales(this.gates.halo, this.settings.reducedGlow);
      const w = RIM_WIDTH * (RIM_WIDTH_FLOOR + (1 - RIM_WIDTH_FLOOR) * seg.rim);
      this.place(rim, seg, w, RIM_OFFSET);
      rim.tint = RIM_COLOR;
      rim.alpha = emitterAlpha(RIM_ALPHA, seg.rim, 1, tierScale(this.tier) * gs.rim);
      rim.visible = true;
    } else {
      rim.visible = false;
    }
  }

  /**
   * 띠 스프라이트를 세그먼트 위에 눕힌다.
   *
   * `scale.x` 를 **직선부 길이 기준**으로 잡아 세그먼트를 완전히 덮고, 둥근 캡이 양끝 바깥으로
   * 흘러나가 이웃 세그먼트와 겹친다 → 이음매가 끊겨 보이지 않는다. `over` 는 폭에 비례해
   * 잡아 얇은 코어일수록 오버행이 짧다(불필요하게 번지지 않게).
   */
  private place(s: Sprite, seg: LavaSegment, width: number, offset: number): void {
    this.placeAt(s, seg, width, seg.nx * offset, seg.ny * offset);
  }

  /** 임의 방향 오프셋 판({@link place} 의 일반형 — 드롭 섀도는 −n 이 아니라 혼합 벡터를 쓴다). */
  private placeAt(
    s: Sprite,
    seg: LavaSegment,
    width: number,
    ox: number,
    oy: number,
  ): void {
    s.position.set(seg.midX + ox, seg.midY + oy);
    s.rotation = seg.angle;
    s.scale.set((seg.len + width * 0.6) / STREAK_LINE, width / STREAK_H);
  }

  /** 프레임 갱신 — 맥동하는 세 겹(헤일로·코어·열기)만 만진다. */
  private animate(tick: number): void {
    // 3차 정책: `gates.halo` 가 꺼져도 **끄지 않고 줄인다**. 용암은 이 행성의 아트 디렉션
    // 자체라 통째로 사라지면 화면이 무너진다({@link glowGateScales} 주석 참조).
    const reducedGlow = this.settings.reducedGlow;
    const gs = glowGateScales(this.gates.halo, reducedGlow);
    const plumeOn = gs.plume && this.tier === 'high';
    const ts = tierScale(this.tier);

    for (let i = 0; i < this.count; i++) {
      const seg = this.segments[i];
      const glow = this.glowPool[i];
      const core = this.corePool[i];
      const heat = this.heatPool[i];
      if (!seg || !glow || !core || !heat) continue;

      // 잔열 하한이 있으므로 이 분기는 이제 "카르곤이 아닌 경우" 같은 방어에만 걸린다 —
      // 정상 경로에서는 **모든 경계가 최소한 잔열로 빛난다**(3차의 요구).
      if (seg.heat > 0) {
        // 광과민 대응에서는 맥동 자체를 정지시킨다(고정값). 밝기를 남기되 **변조를 없앤다**.
        const p = reducedGlow ? REDUCED_GLOW_PULSE : heatPulse(tick, seg.phase);

        // ① 용암 채널 — 넓은 헤일로 + 좁은 코어 2단. 한 겹짜리 흐린 띠는 "얼룩"으로 읽힌다.
        //    폭을 세기에 비례시켜(0.55~1.0) **식은 균열은 가는 선, 뜨거운 채널은 넓은 강**이
        //    되게 한다. 폭까지 균일하면 잔열이 화면을 주황으로 도배한다.
        const wScale = 0.55 + 0.45 * seg.heat;
        this.place(glow, seg, GLOW_WIDTH * wScale * (0.92 + 0.14 * p), 0);
        glow.tint = seg.color;
        glow.alpha = emitterAlpha(GLOW_ALPHA, seg.heat, p, ts * gs.glow);
        glow.visible = true;

        this.place(core, seg, CORE_WIDTH * wScale * (0.85 + 0.24 * p), 0);
        core.tint = seg.coreColor;
        core.alpha = emitterAlpha(CORE_ALPHA, seg.heat, p, ts * gs.core);
        core.visible = true;

        // ③ 열기 상승 — 채널 위로 번지는 세로로 늘인 붉은 기운. 맥동 주기를 발광보다 느리게
        // 잡아(틱 0.55배) 빛과 열이 따로 움직이는 것처럼 보이게 한다.
        // **잔열에는 붙이지 않는다** — 모든 경계에서 기둥이 피면 화면이 주황 안개가 된다.
        if (plumeOn && seg.heat >= HEAT_PLUME_MIN) {
          const hp = heatPulse(tick * 0.55, seg.phase + 0.37);
          heat.position.set(seg.midX, seg.midY - HEAT_RISE * (0.9 + 0.2 * hp));
          heat.rotation = 0;
          const sc = HEAT_WIDTH / (RADIAL_R * 2);
          heat.scale.set(sc, sc * HEAT_STRETCH);
          heat.tint = HEAT_COLOR;
          heat.alpha = emitterAlpha(HEAT_ALPHA, seg.heat, hp, ts);
          heat.visible = true;
        } else {
          heat.visible = false;
        }
      } else {
        glow.visible = false;
        core.visible = false;
        heat.visible = false;
      }
    }
  }

  /** 풀 슬롯 확장(레코드 + 스프라이트 5장). 목록이 커지는 순간에만 할당된다. */
  private growSlot(i: number): LavaSegment {
    const rec = createSegment();
    this.segments[i] = rec;
    this.aoPool[i] = makeSprite(this.streakBand, 'multiply', this.aoLayer);
    this.shadowPool[i] = makeSprite(this.streakSoft, 'multiply', this.shadowLayer);
    this.glowPool[i] = makeSprite(this.streakSoft, 'add', this.glowLayer);
    this.corePool[i] = makeSprite(this.streakCore, 'add', this.coreLayer);
    this.rimPool[i] = makeSprite(this.streakCore, 'add', this.rimLayer);
    this.heatPool[i] = makeSprite(this.radialSoft, 'add', this.heatLayer);
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
    for (const s of this.heatPool) s.visible = false;
  }
}
