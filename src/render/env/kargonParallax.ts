/**
 * 카르곤 대규모 저주파 환경 변조 + 원경 연무 (슬롯 `floor`).
 *
 * ## 왜 `far` 가 아니라 `floor` 인가 (슬롯 변경 근거)
 * 원래 이 레이어의 슬롯은 `far`(지형 바닥 뒤)였다. 그런데 카르곤은
 * `assets/tilesets/kargon.png` 로 **Wang autotile 바닥이 활성**이고, `AutotileBackground.update`
 * 는 가시 사각형 전체(+MARGIN 2타일 링)를 **불투명 스프라이트로 빈틈없이** 채운다
 * ({@link file://../autotile.ts} `ensureCoverage`/`update`). main.ts 는 `env.slot('far')` 를
 * autotile 레이어 **아래** 인덱스에 끼우므로, `far` 에 무엇을 그리든 화면에 단 한 픽셀도
 * 나오지 않는다. 즉 `far` 에 구현하면 "만들었는데 안 보인다"는 이 리포의 단골 결함
 * (invasionBackdrop 3장 사건)을 그대로 재현하게 된다.
 *
 * 그래서 슬롯을 `floor`(지형 위·엔티티 아래)로 옮기고, 역할을 **지형을 통해 비치는 원경**이
 * 아니라 **지형 위에 얹는 거대 스케일 저주파 명암·색온도 변조**로 재정의했다. 시차는 여전히
 * 성립한다 — 지형은 카메라 1.0배로 흐르는데 이 변조 필드는 0.10~0.33배로 흐르므로,
 * 카메라가 움직이면 "지형이 뜨거운 지역 ↔ 식은 지역을 지나간다"로 읽힌다. 정지한 막이
 * 아니라 **속도가 다른 네 대역의 상대 운동**이 깊이를 만든다.
 *
 * 같은 `floor` 슬롯의 다른 레이어와 대역이 겹치지 않는다:
 * 데칼(`kargon-decals`)=고주파 산포물, 용암 발광(`kargon-lava-light`)=국소 균열 발광,
 * 이 레이어=**화면보다 큰(1900~5200px 주기) 저주파 대역만**. 레지스트리 등록 순서상 이
 * 레이어가 `floor` 의 맨 뒤라 데칼·용암 발광이 그 위에 얹힌다(의도).
 *
 * ## 대역 구성 (뒤 → 앞, 시차 계수 오름차순 = 대기 원근)
 * | 대역          | 시차 | 주기(px) | 합성   | 색                       | 담당 바닥 | 역할                            |
 * |---------------|------|----------|--------|--------------------------|-----------|---------------------------------|
 * | cool-shadow   | 0.10 | 5200     | normal | 거의 검은 남색 `#080512` | `lit`     | **밝은 지형을 누르는** 명도 골격 |
 * | shadow-bounce | 0.16 | 3600     | add    | 차가운 청보라 `#161a72`  | `shadow`  | **암부 저주파 바운스광**(3차 신설) |
 * | far-glow      | 0.24 | 2800     | add    | 깊은 주황 `#e8501c`      | `lit`     | 아주 넓고 은은한 지역 열감        |
 * | near-ember    | 0.33 | 2200     | add    | 밝은 호박 `#ff9440`      | `lit`     | 좁은 열점(개수 많고 반경 작음)    |
 *
 * ### 3차 개정 — 왜 암부가 구조적으로 반응하지 않았나 (가장 큰 단일 레버)
 * 하네스 스크린샷(`h-none` ↔ `h-parallax`)을 픽셀로 재보니 이 레이어의 효과가 밝은 곳에만
 * 걸려 있었다: 주황 지형 평균 휘도 −0.052, **어두운 바닥 +0.005**(10배 비대칭). 화면의 절반
 * 남짓인 암부가 "값 하나짜리 평면"으로 남아 배경이 미완성으로 읽혔다.
 *
 * 원인은 알파가 아니라 **합성 산식**이다. `normal` 합성의 델타는 `a*(L − base)` 라 **바닥이
 * 밝을수록 커지고 바닥이 어두우면 0 으로 수렴**한다 — 검정 위에서는 뺄 빛이 없다. 2차의
 * 골격 대역(`#080512`)은 주황(base 0.48)에서 −0.19 를 내지만 암부(base 0.10)에서는 −0.034 뿐이다.
 * `ash-pocket`(`#4a4250`, L 0.269)은 더 나빠서 암부에서 +0.006, 주황에서 −0.006 — **어디서도
 * 보이지 않는 죽은 대역**이었다. 남은 두 가산 대역은 절대 증분이라 바닥과 무관하지만 둘 다
 * 따뜻한 색인 데다 `near-ember` 는 실효 커버리지가 텍스처의 2%(!)라 암부에 닿는 면적이 없었다.
 * 정리하면 **바닥 밝기에 비례하는 합성만 쓰고 있어 암부는 구조적으로 반응할 수 없었다.**
 *
 * 그래서 죽은 `ash-pocket` 자리에 **`shadow-bounce`** 를 넣었다. 가산이라 델타가 바닥과 무관하고
 * (= 암부에서도 그대로 실린다), 색을 주황의 보색인 **저휘도 청보라**(`#161a72`, L 0.124)로 잡아
 * **명도는 조금 올리면서 색조는 크게 바꾼다**. 암부에서는 명도차보다 색조차가 먼저 읽히고,
 * 같은 절대 증분이라도 검정 위에서는 상대(Weber) 대비가 몇 배 크다. 반대로 주황 위에서는
 * 같은 증분이 6% 남짓이라 거의 묻힌다 — **한 대역이 암부에서만 일하게 되는 이유가 이것이다.**
 *
 * 동시에 따뜻한 가산 두 대역을 눌렀다(`far-glow` 0.10→0.06, `near-ember` 0.13→0.065).
 * 용암 발광 레이어가 3차에 모든 경계로 확장되어 밝은 쪽 경쟁이 늘고, 무엇보다 **플레이어
 * 함선이 화면에서 가장 밝아야 한다**는 탑다운 슈터의 원칙이 지금 깨져 있기 때문이다.
 * 이 레이어의 3차 방향은 "밝기를 더한다"가 아니라 **"밝은 곳을 누르고 어두운 곳에 결을 넣는다"** 다.
 *
 * ### 담당 바닥 축(`BandSpec.domain`) — 밝은 곳/어두운 곳 역할 분담
 * | domain   | 뜻                                   | 합성 규율                                   |
 * |----------|--------------------------------------|---------------------------------------------|
 * | `lit`    | 밝은 지형(주황) 위에서 보이는 대역   | `normal` 어둡힘 또는 **면적이 좁은** 따뜻한 가산 |
 * | `shadow` | 어두운 바닥 위에서 보이는 대역       | **저휘도 한색 가산**(B > R, L < 0.2)         |
 *
 * 이 축을 자료로 박아 둔 이유는, 대역을 재조정할 때 "어디서 보이는지"를 다시 추론하지 않게
 * 하기 위해서다. 2차의 실패는 값이 틀린 게 아니라 **어느 바닥에서 일하는 대역인지 아무도
 * 적어 두지 않아 네 대역이 모두 밝은 쪽에 몰려 있었다는 사실이 보이지 않았던 것**이다.
 *
 * ### 그레이딩 레인과의 분담 (3차 병렬)
 * `kargon-grade` 가 3차에 **스플릿 톤(암부 청보라 / 하이라이트 황백) + 배경 명도 상한 압축**을
 * 맡는다. 방향이 같으므로 축을 나눈다: **그쪽은 전역 톤(화면 전체에 같은 값), 여기는 저주파
 * 공간 변조(자리마다 다른 값)**. 즉 그레이딩이 암부 전체를 한 톤 차갑게 만들면, 이 레이어는
 * 그 안에서 "여기는 더 차갑고 저기는 덜 차갑다"는 **덩어리 구분**을 만든다. 그래서
 * `shadow-bounce` 의 커버리지를 0.4 밑으로 눌러 막이 아니라 무늬로 유지한다(막이면 그건
 * 그레이딩이 이미 하는 일의 중복이다).
 *
 * ### 2차 개정 (왜 연무를 걷어내고 어둠에 무게를 실었나 — 기록)
 * 1차 구현의 `ash-haze` 는 주기 5200 · 반경 0.30~0.62 · 9개짜리 **넓은 감쇠**라서 텍스처를
 * 사실상 빈틈없이 덮었다. 탑다운 게임은 화면 안의 모든 것이 같은 거리라 "원경 연무"가
 * 깊이로 읽히지 않고 **화면 전체에 균일한 막**이 된다 — 깊이는 안 주면서 대비만 깎는다.
 * 그래서 이 대역을 `ash-pocket` 으로 재정의했다: 반경을 1/3(0.09~0.18)로, 개수를 5개로 줄여
 * **텍스처 면적의 약 1/4 에만 뭉치는 국소 웅덩이**로 만들었다. 덮는 막이 아니라 무늬다.
 *
 * 비워진 "가장 크고 가장 먼 대역"(주기 5200) 자리에는 `cool-shadow` 를 올렸다. AAA 화산
 * 스테이지의 핵심은 색이 아니라 **명도 구조**(어두운 암괴 덩어리 ↔ 밝은 용융 채널)이고,
 * 화면에서 가장 큰 저주파를 담당하는 이 레이어가 그 골격을 만들 최적의 위치이기 때문이다.
 * 블롭 수를 4개까지 줄여 **화면에 어두운 지대와 그렇지 않은 지대가 번갈아 읽히게** 했다
 * (덮으면 골격이 아니라 또 하나의 막이다).
 *
 * ### 용암 발광 레이어와의 역할 분담
 * `kargon-lava-light` 가 "흐르는 용암 채널"로 재설계되면서 **국소 고주파 밝음은 그쪽이
 * 담당**한다. 여기서 가산 대역을 같이 키우면 두 레이어가 경쟁해 화면이 통째로 뜬다.
 * 그래서 이 레이어의 계약을 **저주파 명도 골격 = 어둠 쪽에 무게**로 못박았다:
 * {@link parallaxLuminanceSwing} 의 `dark` 크기가 `bright` 크기보다 크다는 것을 테스트로
 * 잠근다. 어두운 구역이 깊어지면 그 위의 적·탄·젬 대비는 오히려 살아나므로, 어둡게 하는
 * 쪽은 공격적으로 쓰고(alpha 0.5) 밝은 쪽은 좁고 낮게 유지한다(가산 알파 합 0.23).
 *
 * ## 결정론(ADR-0005)
 * `Math.random` 없음. 텍스처 무늬는 **고정 상수 시드**의 {@link hash2} 로 구워 런마다 동일하고
 * (= 다시 구울 이유가 없어 GPU 누수도 구조적으로 불가능), 런별 변화는 `ctx.seed` 로 뽑은
 * **월드 오프셋**만으로 준다. 애니메이션(느린 드리프트·맥동)은 전부 `EnvFrame.tick` 의
 * 순수 함수라 리플레이가 그대로 재현된다. `f.dt` 는 쓰지 않는다.
 *
 * ## 성능
 * - 텍스처는 모듈 수준 캐시에 **한 번만** 굽는다(256×256 RGBA ×4 ≈ 1MB). 런을 반복해도 재굽지
 *   않으며 `generateTexture` 를 쓰지 않아 `ctx.renderer` 가 없어도(테스트) 던지지 않는다.
 * - 매 프레임: TilingSprite 4장의 `tilePosition`/`alpha` 갱신뿐. **할당 0**(설정·티어는 변할
 *   때만 재계산). 화면 채우기 비용이 유일한 실비용이라 저티어에서 장수를 줄인다.
 * - `tilePosition` 에 넣기 전 **f64 모듈로를 먼저** 취한다(f32 UV swim 방지, invasionBackdrop 규율).
 */

import { Container, Texture, TilingSprite } from 'pixi.js';
import { hash2 } from './noise.js';
import { graphicsTierController } from '../graphicsRuntime.js';
import { effectGates, type QualityTier } from '../qualityTier.js';
import { graphicsSettings, type GraphicsSettings } from '../graphicsSettings.js';
import type { EnvContext, EnvFrame, EnvLayer } from './types.js';

/**
 * 카르곤 행성 인덱스. `planetEnvironment.ts` 의 `KARGON` 과 같은 값이지만 여기서 import 하면
 * 레지스트리↔레이어 순환 import 가 생기므로 지역 상수로 둔다(값은 계약상 고정 0).
 */
const KARGON_PLANET = 0;

/** 구운 필드 텍스처 한 변(px). 초저주파라 해상도가 필요 없다 — 크게 늘려도 그라디언트는 매끈하다. */
const TEX_SIZE = 256;

/** 무늬 굽기용 **고정** 시드. 런 시드와 무관해야 텍스처를 한 번만 굽는다. */
const BAKE_SEED = 0x4b41_5247 | 0; // 'KARG'

/** 티어 축(저→고). 대역의 `minTier` 와 비교한다. */
const TIER_RANK: Readonly<Record<QualityTier, number>> = { low: 0, med: 1, high: 2 };

/** 방사 그라디언트 감쇠 프로파일: `[offset, alpha]` 색 정지점. */
type Falloff = readonly (readonly [number, number])[];

/* ══════════════════════════ 튜닝 상수 (재조정은 여기만 만진다) ══════════════════════════
 * 타일셋 그림·용암 발광이 병렬로 교체 중이라, 통합 후 재조정할 때 파일을 뒤지지 않아도 되게
 * 색·알파·피크를 한 블록에 모아 둔다. 대역 표는 이 상수들을 참조만 한다.
 * ─────────────────────────────────────────────────────────────────────────────────────── */

/**
 * 카르곤 바닥의 기준 상대 휘도(0..1). 명도 스윙 계산의 기준선이다.
 * 하네스 스크린샷의 타일 바닥 평균 ≈ rgb(60,50,48) → 0.204 를 반올림했다.
 * 타일셋이 더 어두워지면 이 값을 내리고 {@link parallaxLuminanceSwing} 테스트 범위를 재조정한다.
 */
export const KARGON_BASE_LUMA = 0.2;

/**
 * 카르곤 **암부** 바닥의 실측 휘도(중앙값). `h-none.png` 의 어두운 구역
 * (x 0–700·y 250–950, x 1250–1700·y 200–950) 표본 중앙값 ≈ 0.104 → 0.10.
 * 이 바닥에서 레이어가 실제로 반응하는지가 3차의 핵심 계약이다.
 */
export const KARGON_DARK_LUMA = 0.1;

/**
 * 카르곤 **주황 지형** 바닥의 실측 휘도(중앙값). 같은 스크린샷 하단 주황 표본 ≈ 0.484 → 0.48.
 * 타일셋 3차가 상부 밝기를 낮추면 이 값을 내린다(테스트는 상수를 참조만 한다).
 */
export const KARGON_BRIGHT_LUMA = 0.48;

/**
 * 상대(Weber) 대비 계산의 순응 바닥. `0` 근처에서 분모가 폭주하는 것을 막고, 실제 디스플레이·
 * 눈이 완전한 검정을 구분하지 못하는 성질도 근사한다. 크기 자체에 의미는 없고 **대역 간 비교의
 * 일관성**만 있으면 된다.
 */
const LUMA_ADAPT_FLOOR = 0.03;

/** 명도 골격 대역(`cool-shadow`, domain=lit) — 거의 검은 남색을 공격적인 알파로. */
const SHADE_COLOR = '#080512';
const SHADE_ALPHA = 0.5;
const SHADE_PEAK = 0.9;

/**
 * **암부 저주파 바운스광**(`shadow-bounce`, domain=shadow) — 3차 신설.
 *
 * 색은 주황의 보색 쪽 **저휘도 청보라**. B(114) 가 R(22) 을 압도해 색조 이동은 크지만
 * Rec.709 휘도는 0.124 뿐이라 **명도를 거의 안 올리면서** 암부를 물들인다. 가산이라 델타가
 * 바닥과 무관해서 검정 위에서도 그대로 실린다(= 2차가 못 하던 일).
 *
 * 알파가 커 보이지만 코어 실증분은 `alpha*peak*color ≈ (8, 9, 41)` 로, 암부 바닥 rgb(27,27,35)
 * 위에 얹혀도 rgb(35,36,76) — **여전히 어둡다**. 함선·탄의 가독성을 해치지 않는다.
 */
const BOUNCE_COLOR = '#161a72';
const BOUNCE_ALPHA = 0.55;
const BOUNCE_PEAK = 0.66;

/**
 * 넓고 은은한 지역 열감(`far-glow`, domain=lit) — 3차에서 0.10 → 0.06 으로 눌렀다.
 * 용암 발광이 모든 경계로 확장되어 밝은 쪽 경쟁이 늘었고, 함선이 화면에서 가장 밝아야 한다.
 */
const FAR_GLOW_COLOR = '#e8501c';
const FAR_GLOW_ALPHA = 0.06;
const FAR_GLOW_PEAK = 0.45;

/** 좁은 열점(`near-ember`, domain=lit) — 3차에서 0.13 → 0.065. 밝지만 면적이 아주 작다. */
const EMBER_COLOR = '#ff9440';
const EMBER_ALPHA = 0.065;
const EMBER_PEAK = 0.52;

/** 넓고 부드럽게 퍼지는 감쇠(그림자·지역 열감용 — 면적을 넓게). */
const FALLOFF_WIDE: Falloff = [
  [0, 1],
  [0.45, 0.62],
  [0.8, 0.2],
  [1, 0],
];
/** 중간 감쇠(먼 방열). */
const FALLOFF_SOFT: Falloff = [
  [0, 1],
  [0.5, 0.5],
  [1, 0],
];
/** 코어에 몰린 감쇠(가까운 열점 — 밝은 면적을 좁게). */
const FALLOFF_TIGHT: Falloff = [
  [0, 1],
  [0.25, 0.45],
  [0.6, 0.08],
  [1, 0],
];

/**
 * 대역이 **어느 밝기의 바닥에서 일하도록 설계됐는가**. 3차에 신설한 축이다.
 *
 * - `lit`   — 밝은 지형(주황) 위에서 보인다. `normal` 어둡힘(델타가 `a*(L-base)` 라 바닥이
 *             밝을수록 커진다) 또는 면적이 좁은 따뜻한 가산.
 * - `shadow` — 어두운 바닥 위에서 보인다. **저휘도 한색 가산** — 절대 증분이 바닥과 무관하고
 *             검정 위에서 상대 대비가 크며, 명도보다 **색조**로 읽힌다.
 *
 * 이 축이 없던 2차에는 네 대역이 전부 `lit` 이었는데도 그 사실이 코드 어디에도 드러나지 않았다.
 */
export type BandDomain = 'lit' | 'shadow';

/** 한 시차 대역의 정적 사양. 전부 상수라 런타임 할당이 없다. */
export interface BandSpec {
  /** 진단용 이름(스프라이트 `label`·텍스처 `source.label` 에 실린다). */
  readonly key: string;
  /** 이 대역이 일하도록 설계된 바닥 밝기. {@link BandDomain} 참조. */
  readonly domain: BandDomain;
  /** 카메라 대비 이동 배율. 작을수록 멀다. */
  readonly parallax: number;
  /** 화면상 반복 주기(design px). 화면(1920)보다 크게 잡아 "훨씬 큰 스케일"을 만든다. */
  readonly tile: number;
  /** 기본 알파(티어·감소 토글로 더 낮아질 수 있다). */
  readonly alpha: number;
  /** 합성 모드. `add`=열, `normal`=식은 지역·연무. */
  readonly blend: 'add' | 'normal';
  /** 구울 색(CSS). tint 곱연산 대신 텍스처에 직접 굽는다. */
  readonly color: string;
  /** 블롭 개수. */
  readonly blobs: number;
  /** 블롭 반지름 범위(텍스처 한 변에 대한 비율). */
  readonly rMin: number;
  readonly rMax: number;
  /** 블롭 1개의 최대 알파(누적 클리핑 방지). */
  readonly peak: number;
  /** 감쇠 프로파일. */
  readonly falloff: Falloff;
  /** 카메라와 무관한 자체 드리프트(design px / sim tick). */
  readonly driftX: number;
  readonly driftY: number;
  /** 맥동 진폭(0..1, 알파에 곱해진다). */
  readonly pulse: number;
  /** 맥동 주기(sim tick). */
  readonly period: number;
  /** 이 대역이 살아나는 최소 티어. */
  readonly minTier: QualityTier;
  /** 발광 대역인가(감소 토글·저티어에서 더 눌린다). */
  readonly glow: boolean;
}

/**
 * 대역 표(뒤 → 앞). 시차 오름차순이라 뒤로 갈수록 가깝고, 가까울수록 주기가 작고 대비가 높다.
 *
 * **블롭 수·반경이 알파만큼 중요하다.** 같은 알파라도 블롭이 텍스처를 빈틈없이 덮으면
 * "막"이 되고, 틈을 남기면 "무늬"가 된다. 골격 대역(`cool-shadow`)은 반경 대비 개수를 4개로
 * 눌러 어두운 지대와 그렇지 않은 지대가 번갈아 나오게 했고, 가산 대역은 면적을 좁게 잡았다.
 */
export const KARGON_PARALLAX_BANDS: readonly BandSpec[] = [
  {
    // 화면에서 가장 큰 저주파 = 명도 골격. 어둡게 하는 쪽은 공격적으로 쓴다 —
    // 어두운 구역이 깊어지면 그 위의 적·탄·젬 대비는 오히려 살아난다.
    // domain=lit: `normal` 어둡힘이라 **주황 지형에서만** 크게 문다(암부에선 뺄 빛이 없다).
    // 3차의 "주황을 눌러라"를 담당하는 대역이 바로 이것이므로 알파는 그대로 둔다.
    key: 'cool-shadow',
    domain: 'lit',
    parallax: 0.1,
    tile: 5200,
    alpha: SHADE_ALPHA,
    blend: 'normal',
    color: SHADE_COLOR,
    // 4개 × 반경 0.22~0.40 ⇒ 겹침 포함해도 텍스처의 절반 남짓만 덮는다(= 틈이 남는다).
    blobs: 4,
    rMin: 0.22,
    rMax: 0.4,
    peak: SHADE_PEAK,
    falloff: FALLOFF_WIDE,
    driftX: -0.02,
    driftY: 0.028,
    pulse: 0.08,
    period: 900,
    minTier: 'low',
    glow: false,
  },
  {
    // 3차 신설. 2차의 `ash-pocket`(normal · L 0.269 · 알파 0.06)은 암부에서 +0.006, 주황에서
    // −0.006 이라 **어디서도 안 보이는 죽은 대역**이었다. 그 자리를 화면의 절반 남짓인
    // 암부 전용으로 재정의한다.
    //
    // domain=shadow: 가산이라 델타가 바닥과 무관하고, 색이 저휘도 한색이라 어두움을 유지한
    // 채 **색조**로 덩어리를 나눈다. 진폭(peak 델타 ≈ +0.045)은 따뜻한 두 가산 대역 각각의
    // 2배 이상 — 비평가가 지목한 "암부에 2~3배 진폭"을 이 한 줄이 담당한다.
    //
    // minTier='low': 이게 3차의 가장 큰 단일 레버라 저티어에서도 빠지면 안 된다. 대신
    // `far-glow` 를 'med' 로 올려 **저티어 장수는 2장 그대로**(fill-rate 중립)로 맞췄다.
    key: 'shadow-bounce',
    domain: 'shadow',
    parallax: 0.16,
    tile: 3600,
    alpha: BOUNCE_ALPHA,
    blend: 'add',
    color: BOUNCE_COLOR,
    // 7개 × 0.18~0.34 × 중간 감쇠 ⇒ 실효 커버리지 ≈ 0.37. 막(≥0.6)이 아니라 무늬다 —
    // 암부 전체를 고르게 차갑게 하는 일은 그레이딩 레인(전역 톤)의 몫이고, 여기는
    // "여기는 더 차갑고 저기는 덜 차갑다"는 저주파 덩어리만 만든다.
    blobs: 7,
    rMin: 0.18,
    rMax: 0.34,
    peak: BOUNCE_PEAK,
    falloff: FALLOFF_SOFT,
    driftX: 0.04,
    driftY: -0.02,
    pulse: 0.12,
    period: 820,
    minTier: 'low',
    // 한색 저휘도라 "발광"으로 억제하면 안 된다 — reducedGlow 를 켠 사용자에게 암부가
    // 다시 평면으로 돌아가는 게 이 대역의 유일한 회귀 경로다.
    glow: false,
  },
  {
    // 아주 넓고 아주 은은한 지역 열감. 국소 밝음은 용암 채널 레이어가 담당하므로
    // 여기서는 "이 지역이 뜨겁다"는 저주파 신호만 낸다.
    // 3차: 알파 0.10 → 0.06, minTier low → med(저티어 장수를 `shadow-bounce` 에 양보).
    key: 'far-glow',
    domain: 'lit',
    parallax: 0.24,
    tile: 2800,
    alpha: FAR_GLOW_ALPHA,
    blend: 'add',
    color: FAR_GLOW_COLOR,
    blobs: 4,
    rMin: 0.28,
    rMax: 0.46,
    peak: FAR_GLOW_PEAK,
    falloff: FALLOFF_WIDE,
    driftX: 0.03,
    driftY: 0.015,
    pulse: 0.22,
    period: 640,
    minTier: 'med',
    glow: true,
  },
  {
    // 좁은 열점. 개수는 늘리고 반경은 줄여 "밝은 면적"이 아니라 "밝은 점"이 되게 한다.
    // 3차: 알파 0.13 → 0.065. 실효 커버리지가 텍스처의 2% 뿐이라 암부에 닿는 면적이 거의
    // 없었는데도 진폭만 커서 밝은 쪽 예산을 잡아먹고 있었다.
    key: 'near-ember',
    domain: 'lit',
    parallax: 0.33,
    tile: 2200,
    alpha: EMBER_ALPHA,
    blend: 'add',
    color: EMBER_COLOR,
    blobs: 10,
    rMin: 0.07,
    rMax: 0.15,
    peak: EMBER_PEAK,
    falloff: FALLOFF_TIGHT,
    driftX: 0.05,
    driftY: -0.04,
    pulse: 0.3,
    period: 430,
    minTier: 'high',
    glow: true,
  },
];

/* ────────────────────────── 명도 구조(테스트로 잠그는 계약) ────────────────────────── */

/**
 * `#rrggbb` 의 상대 휘도(0..1, Rec.709 가중). 파싱 실패는 0.
 *
 * 감마 보정을 하지 않는 선형 근사다 — 여기서 필요한 건 절대 측광값이 아니라 **대역끼리
 * 비교 가능한 일관된 척도**이고, Pixi 의 `normal`/`add` 합성도 sRGB 값에 그대로 적용된다.
 */
export function relLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (m === null) return 0;
  const v = Number.parseInt(m[1] as string, 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * 대역이 **블롭 코어에서** 바닥 휘도를 얼마나 밀어 올리거나 내리는지(부호 있는 델타).
 *
 * - `normal`: `base*(1-a) + L*a` 이므로 델타는 `a*(L - base)`. 색이 바닥보다 어두우면 음수.
 * - `add`: 가산이므로 델타는 항상 `+a*L`.
 *
 * `a` 는 알파와 굽기 피크의 곱이다 — 텍스처의 최댓값이 `peak` 이라 실제 화면 알파는
 * `alpha * peak` 을 넘지 않는다(블롭 사이 틈은 이보다 훨씬 작다).
 */
export function bandPeakLuminanceDelta(spec: BandSpec, base: number = KARGON_BASE_LUMA): number {
  const a = spec.alpha * spec.peak;
  const l = relLuminance(spec.color);
  return spec.blend === 'add' ? a * l : a * (l - base);
}

/**
 * 감쇠 프로파일이 **알파 0.5 로 떨어지는 반경 비율**(0..1). 블롭의 "실효 반경"이다.
 *
 * 전체 반경으로 면적을 재면 꼬리까지 세어 커버리지가 과대평가된다 — 1차 구현이
 * "알파는 낮은데 화면이 다 뿌옇다"였던 이유가 정확히 이것이다(넓은 감쇠 × 큰 반경 × 9개).
 */
export function falloffHalfRadius(spec: BandSpec): number {
  let prevOff = 0;
  let prevA = 1;
  for (const [off, a] of spec.falloff) {
    if (a < 0.5) {
      const span = prevA - a;
      const t = span > 0 ? (prevA - 0.5) / span : 0;
      return prevOff + (off - prevOff) * t;
    }
    prevOff = off;
    prevA = a;
  }
  return 1;
}

/**
 * 대역이 텍스처 면적의 몇 배를 **실효 반경으로** 덮는지(겹침 미보정이라 1 을 넘을 수 있다).
 *
 * 이 값이 1 근처면 그 대역은 무늬가 아니라 **막**이다. 어두운 골격 대역조차 0.6 을 넘으면
 * "여기는 식은 지대 / 저기는 뜨거운 지대"가 읽히지 않고 전체가 한 톤 어두워질 뿐이다.
 */
export function bandCoverage(spec: BandSpec): number {
  const rMid = ((spec.rMin + spec.rMax) / 2) * falloffHalfRadius(spec);
  return spec.blobs * Math.PI * rMid * rMid;
}

/**
 * 레이어 전체의 명도 스윙 = "가장 어두운 지대"와 "가장 밝은 지대"의 휘도 차.
 *
 * 대역이 서로 다른 시차로 흐르므로 실제 화면에서는 겹침 조합이 계속 바뀐다. 여기서는
 * **최악(=최대 진폭) 조합**, 즉 어두운 대역만 겹친 지점과 밝은 대역만 겹친 지점을 잡는다.
 * 이 값이 작으면 화면은 좁은 중간톤 대역에 갇혀 단조로워지고, 그게 1차 구현의 실패였다.
 *
 * `dark` 는 0 이하, `bright` 는 0 이상, `swing = bright - dark`.
 */
export function parallaxLuminanceSwing(
  bands: readonly BandSpec[] = KARGON_PARALLAX_BANDS,
  base: number = KARGON_BASE_LUMA,
): { dark: number; bright: number; swing: number } {
  let dark = 0;
  let bright = 0;
  for (const b of bands) {
    const d = bandPeakLuminanceDelta(b, base);
    if (d < 0) dark += d;
    else bright += d;
  }
  return { dark, bright, swing: bright - dark };
}

/**
 * 대역 하나가 화면에 만드는 **면적 가중 명도 변조량**(항상 ≥ 0).
 *
 * 진폭만 보면 안 되는 이유가 2차의 `near-ember` 다 — peak 델타는 +0.044 로 표에서 가장 컸는데
 * 실효 커버리지가 텍스처의 **2%** 라 화면에 닿는 면적이 사실상 없었다. "얼마나 세게"와
 * "얼마나 넓게"를 곱해야 비로소 "화면이 얼마나 달라 보이는가"에 대응한다.
 *
 * 커버리지는 1 로 자른다(겹침 미보정이라 1 을 넘을 수 있는데, 화면보다 넓게 덮을 수는 없다).
 */
export function bandModulationEnergy(spec: BandSpec, base: number): number {
  return Math.abs(bandPeakLuminanceDelta(spec, base)) * Math.min(bandCoverage(spec), 1);
}

/** 바닥 휘도 `base` 에서 레이어 전체가 만드는 면적 가중 명도 변조량. */
export function parallaxModulationEnergy(
  base: number,
  bands: readonly BandSpec[] = KARGON_PARALLAX_BANDS,
): number {
  let e = 0;
  for (const b of bands) e += bandModulationEnergy(b, base);
  return e;
}

/**
 * 같은 변조량을 **상대(Weber) 대비**로 환산한 값 = `energy / (base + 순응바닥)`.
 *
 * 절대 휘도 델타로만 재면 암부는 영원히 진다 — 검정 위에서 큰 절대 변조를 내려면 화면을
 * 밝혀야 하고, 그건 가독성 규율에 정면으로 반한다. 하지만 눈은 절대량이 아니라 **바닥 대비
 * 비율**로 대비를 읽으므로, 어두운 곳에서는 작은 절대 증분도 충분히 보인다. 3차의 계약
 * ("어둠을 유지한 채 결을 넣는다")을 재는 척도는 이쪽이다.
 */
export function parallaxRelativeModulation(
  base: number,
  bands: readonly BandSpec[] = KARGON_PARALLAX_BANDS,
): number {
  return parallaxModulationEnergy(base, bands) / (Math.max(base, 0) + LUMA_ADAPT_FLOOR);
}

/** 특정 {@link BandDomain} 대역들만의 변조량(역할 분담이 실제로 성립하는지 재는 데 쓴다). */
export function domainModulationEnergy(
  domain: BandDomain,
  base: number,
  bands: readonly BandSpec[] = KARGON_PARALLAX_BANDS,
): number {
  let e = 0;
  for (const b of bands) if (b.domain === domain) e += bandModulationEnergy(b, base);
  return e;
}

/**
 * 모든 대역의 코어가 한 자리에 겹쳤을 때의 **부호 있는 순 델타**(최악의 경우).
 *
 * 밝은 바닥에서는 음수(= 주황을 누른다), 어두운 바닥에서는 작은 양수(= 결을 넣되 어둠을
 * 유지한다)여야 한다. 이 부호가 뒤집히면 레이어가 배경을 띄워 함선·탄의 가독성을 깎는다.
 */
export function parallaxNetPeakDelta(
  base: number,
  bands: readonly BandSpec[] = KARGON_PARALLAX_BANDS,
): number {
  const { dark, bright } = parallaxLuminanceSwing(bands, base);
  return dark + bright;
}

/* ────────────────────────── 순수 함수(단위 테스트 대상) ────────────────────────── */

/** 항상 `[0, period)` 인 모듈로(음수 입력 방어). period 가 유효하지 않으면 0. */
export function wrapOffset(value: number, period: number): number {
  if (!(period > 0) || !Number.isFinite(value)) return 0;
  const m = value % period;
  return m < 0 ? m + period : m;
}

/**
 * 런 시드로 정해지는 대역별 월드 오프셋(design px). 같은 시드면 같은 배치, 다른 시드면 무늬가
 * 다른 자리에서 시작한다 — **텍스처를 다시 굽지 않고** 런별 변화를 주는 유일한 수단이다.
 *
 * @param axis 0=x, 1=y.
 */
export function bandSeedOffset(seed: number, band: number, axis: number, period: number): number {
  return hash2(seed, band * 2 + axis + 1, 0x51ed) * period;
}

/**
 * 대역의 최종 `tilePosition` 성분(design px, `[0, period)`).
 *
 * `-(카메라×시차 + 시드오프셋 + 드리프트×틱 + 뷰 원점)` 을 **f64 로 먼저 모듈로** 취한다.
 * 월드 좌표는 수만 단위까지 커지므로 그대로 넘기면 f32 UV 정밀도가 무너져 무늬가 떨린다
 * (invasionBackdrop.scroll 과 동일한 규율).
 */
export function bandTileOffset(
  cam: number,
  parallax: number,
  seedOffset: number,
  drift: number,
  tick: number,
  viewMin: number,
  period: number,
): number {
  return wrapOffset(-(cam * parallax + seedOffset + drift * tick + viewMin), period);
}

/**
 * 맥동 배율(≈`1-amplitude` .. `1`). `tick` 의 순수 함수라 리플레이가 재현되고, 프레임 스킵·탭
 * 복귀에도 위상이 어긋나지 않는다. 대역마다 주기가 서로 배수가 아니어서 합성 결과가 눈에
 * 띄게 반복되지 않는다.
 */
export function bandPulse(tick: number, period: number, amplitude: number, phase: number): number {
  if (!(period > 0) || !Number.isFinite(tick)) return 1;
  const s = Math.sin((tick / period + phase) * Math.PI * 2);
  return 1 - amplitude * 0.5 * (1 - s);
}

/* ────────────────────────── 텍스처 굽기(1회) ────────────────────────── */

/**
 * 모듈 수준 텍스처 캐시. 무늬가 런 시드와 무관하므로 **프로세스 전체에서 1회**만 굽는다.
 * 런을 반복해도, 레이어 인스턴스를 여러 개 만들어도 재굽지 않는다(GPU 메모리 누수 방지).
 * `null` = 이 환경(테스트·캔버스 없음)에서 굽지 못함.
 */
const TEXTURE_CACHE = new Map<string, Texture | null>();

/** 색 정지점을 그라디언트에 적는다(흰색 + 알파 → 이후 `source-in` 으로 색을 갈아 끼운다). */
function applyStops(
  g: CanvasGradient,
  falloff: Falloff,
  peak: number,
  intensity: number,
): void {
  for (const [offset, a] of falloff) {
    g.addColorStop(offset, `rgba(255,255,255,${(a * peak * intensity).toFixed(4)})`);
  }
}

/**
 * 한 대역의 **이음매 없는** 저주파 블롭 필드를 굽는다.
 *
 * 1. 투명 캔버스에 `lighter` 로 흰 방사 그라디언트를 누적 → 알파 채널이 곧 필드 세기.
 *    각 블롭을 3×3 로 감싸 그려(오프셋 −S/0/+S) 경계를 넘어가는 꼬리가 반대편에 이어진다.
 * 2. `source-in` 으로 대역 색을 통째로 채워 **알파는 유지하고 RGB 만** 교체.
 *    → `tint`(곱연산) 없이 원하는 색이 나오고, `add` 합성에서는 알파가 그대로 세기가 된다.
 *
 * 캔버스가 없는 환경(node 테스트)에서는 `null` 을 반환하고 아무것도 던지지 않는다.
 */
function bakeBandTexture(spec: BandSpec, bandIndex: number): Texture | null {
  const cached = TEXTURE_CACHE.get(spec.key);
  if (cached !== undefined) return cached;

  let tex: Texture | null = null;
  try {
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = TEX_SIZE;
      canvas.height = TEX_SIZE;
      const g2d = canvas.getContext('2d');
      if (g2d !== null) {
        g2d.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
        g2d.globalCompositeOperation = 'lighter';
        for (let i = 0; i < spec.blobs; i++) {
          // 위치·크기·세기는 전부 고정 시드 해시 — 런과 무관하게 항상 같은 무늬.
          const cx = hash2(BAKE_SEED, bandIndex * 97 + i, 1) * TEX_SIZE;
          const cy = hash2(BAKE_SEED, bandIndex * 97 + i, 2) * TEX_SIZE;
          const r =
            (spec.rMin + (spec.rMax - spec.rMin) * hash2(BAKE_SEED, bandIndex * 97 + i, 3)) *
            TEX_SIZE;
          const intensity = 0.55 + 0.45 * hash2(BAKE_SEED, bandIndex * 97 + i, 4);
          for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
              const x = cx + ox * TEX_SIZE;
              const y = cy + oy * TEX_SIZE;
              // 타일 밖으로 완전히 벗어난 사본은 건너뛴다(굽기 비용 절감).
              if (x + r < 0 || x - r > TEX_SIZE || y + r < 0 || y - r > TEX_SIZE) continue;
              const grad = g2d.createRadialGradient(x, y, 0, x, y, r);
              applyStops(grad, spec.falloff, spec.peak, intensity);
              g2d.fillStyle = grad;
              g2d.fillRect(x - r, y - r, r * 2, r * 2);
            }
          }
        }
        // 알파는 남기고 RGB 만 대역 색으로 교체.
        g2d.globalCompositeOperation = 'source-in';
        g2d.fillStyle = spec.color;
        g2d.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
        g2d.globalCompositeOperation = 'source-over';

        tex = Texture.from(canvas);
        // 진단: 하네스에서 `texture.source.label` 로 어느 대역이 실제로 바인딩됐는지 대조한다.
        tex.source.label = `kargon-parallax:${spec.key}`;
        tex.source.addressMode = 'repeat';
      }
    }
  } catch {
    // 캔버스 API 부재·보안 예외 등 어떤 실패도 레이어를 조용히 끄기만 한다(런은 계속된다).
    tex = null;
  }
  TEXTURE_CACHE.set(spec.key, tex);
  return tex;
}

/** 대역 하나의 런타임 상태(스프라이트 + 시드 오프셋). 전부 사전 할당. */
interface BandRuntime {
  readonly spec: BandSpec;
  readonly sprite: TilingSprite;
  seedX: number;
  seedY: number;
  /** 티어·감소 토글 반영 후의 알파 상한(맥동은 여기에 곱해진다). */
  gatedAlpha: number;
  /** 티어가 이 대역을 허용하는가. */
  enabled: boolean;
}

/**
 * 카르곤 거대 스케일 저주파 환경 변조 레이어.
 *
 * 슬롯이 `floor` 인 이유·대역 구성은 파일 상단 주석 참조.
 */
export class KargonParallaxLayer implements EnvLayer {
  readonly name = 'kargon-parallax';
  readonly slot = 'floor' as const;
  readonly view = new Container();

  private readonly bands: BandRuntime[] = [];
  private built = false;
  private active = false;
  private width = 0;
  private height = 0;

  /** 마지막으로 게이트를 계산한 티어(변할 때만 재계산 → 매 프레임 할당 0). */
  private lastTier: QualityTier | null = null;
  /** 그래픽 설정 변경 구독 해제 함수. */
  private readonly unsubscribe: () => void;
  /** 설정이 바뀌었으니 게이트를 다시 계산해야 한다는 플래그. */
  private gatesDirty = true;
  private settings: GraphicsSettings;

  constructor() {
    this.settings = graphicsSettings.getSettings();
    this.unsubscribe = graphicsSettings.onChange((s) => {
      this.settings = s;
      this.gatesDirty = true;
    });
  }

  /** 진단·테스트용: 실제로 스프라이트가 만들어진 대역 이름들(텍스처를 못 구우면 빈 배열). */
  get bandKeys(): readonly string[] {
    return this.bands.map((b) => b.spec.key);
  }

  configure(ctx: EnvContext): boolean {
    if (ctx.planet !== KARGON_PLANET) {
      this.active = false;
      return false;
    }
    this.build();
    // 런 시드로 대역별 월드 오프셋을 다시 뽑는다(텍스처는 그대로 재사용).
    for (let i = 0; i < this.bands.length; i++) {
      const b = this.bands[i];
      if (b === undefined) continue;
      b.seedX = bandSeedOffset(ctx.seed, i, 0, b.spec.tile);
      b.seedY = bandSeedOffset(ctx.seed, i, 1, b.spec.tile);
    }
    this.gatesDirty = true;
    this.lastTier = null;
    this.active = true;
    // 텍스처를 하나도 못 구웠으면(캔버스 없는 환경) 그릴 게 없다 — 그래도 활성으로 두면 빈
    // 컨테이너가 매 프레임 도니 꺼 둔다.
    return this.bands.length > 0;
  }

  /** 스프라이트·텍스처 1회 구축. `configure` 를 여러 번 불러도 다시 굽지 않는다. */
  private build(): void {
    if (this.built) return;
    this.built = true;
    for (let i = 0; i < KARGON_PARALLAX_BANDS.length; i++) {
      const spec = KARGON_PARALLAX_BANDS[i];
      if (spec === undefined) continue;
      const tex = bakeBandTexture(spec, i);
      if (tex === null) continue;
      const sprite = new TilingSprite({ texture: tex, width: 1, height: 1 });
      sprite.label = `kargon-parallax:${spec.key}`;
      sprite.blendMode = spec.blend;
      sprite.tileScale.set(spec.tile / TEX_SIZE);
      sprite.alpha = spec.alpha;
      this.view.addChild(sprite);
      this.bands.push({ spec, sprite, seedX: 0, seedY: 0, gatedAlpha: spec.alpha, enabled: true });
    }
    if (this.width > 0 && this.height > 0) this.applySize();
  }

  /**
   * 티어·감소 토글 → 대역별 활성 여부와 알파 상한. **변할 때만** 부른다(매 프레임 호출하면
   * `effectGates`/`getSettings` 가 객체를 할당한다).
   */
  private recomputeGates(tier: QualityTier): void {
    const gates = effectGates(tier, this.settings);
    const rank = TIER_RANK[tier];
    // 저티어에서는 화면 채우기 자체가 비용이라 장수를 줄이고 남은 장도 살짝 눌러 둔다.
    const tierScale = tier === 'low' ? 0.8 : 1;
    for (const b of this.bands) {
      b.enabled = rank >= TIER_RANK[b.spec.minTier];
      // `gates.halo` 는 저티어와 `reducedGlow` 를 한 번에 담는다 — 발광 대역만 추가로 억제.
      const glowScale = b.spec.glow && !gates.halo ? 0.45 : 1;
      b.gatedAlpha = b.spec.alpha * tierScale * glowScale;
      b.sprite.visible = b.enabled;
    }
  }

  update(f: EnvFrame): void {
    if (!this.active || this.bands.length === 0) return;
    const tier = graphicsTierController.getActiveTier();
    if (this.gatesDirty || tier !== this.lastTier) {
      this.lastTier = tier;
      this.gatesDirty = false;
      this.recomputeGates(tier);
    }
    // 모션 감소 시 드리프트·맥동을 얼린다(위상 0 고정). 시차 자체는 카메라 조작의 직접 결과라
    // 그대로 둔다 — 그걸 끄면 배경이 지형에 붙어 깊이가 통째로 사라진다.
    const tick = this.settings.reducedMotion ? 0 : f.tick;
    // 스프라이트를 가시 사각형 원점에 맞춘다(레터박스·오버스캔 포함).
    const vx = f.viewMinX;
    const vy = f.viewMinY;
    for (let i = 0; i < this.bands.length; i++) {
      const b = this.bands[i];
      if (b === undefined || !b.enabled) continue;
      const s = b.spec;
      b.sprite.position.set(vx, vy);
      b.sprite.tilePosition.set(
        bandTileOffset(f.camX, s.parallax, b.seedX, s.driftX, tick, vx, s.tile),
        bandTileOffset(f.camY, s.parallax, b.seedY, s.driftY, tick, vy, s.tile),
      );
      // 대역마다 위상을 어긋나게 해 네 장이 동시에 밝아지지 않게 한다.
      b.sprite.alpha = b.gatedAlpha * bandPulse(tick, s.period, s.pulse, i * 0.37);
    }
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.applySize();
  }

  private applySize(): void {
    if (!(this.width > 0) || !(this.height > 0)) return;
    for (const b of this.bands) {
      b.sprite.width = this.width;
      b.sprite.height = this.height;
    }
  }

  destroy(): void {
    this.unsubscribe();
    // 텍스처는 모듈 캐시가 소유하므로 파괴하지 않는다(다음 런이 재사용 — 재굽기 = 누수).
    this.view.destroy({ children: true });
    this.bands.length = 0;
  }
}
