/**
 * 톡사르 시차 테마 데이터 — 오염 늪.
 *
 * 서사: **광원은 지형 저지에 고인 독성 웅덩이고 하늘은 두꺼운 독무(毒霧)에 덮여 있다.**
 * 그래서 이 레이어의 방향은 "밝기를 더한다"가 아니라 **"밝은 지대를 누르고 어두운 늪 바닥에
 * 결을 넣는다"** 다. 국소 고주파 밝음은 지형광(독성 개천)이, 암부 전체의 균일한 색조는
 * 그레이딩이 맡으므로 여기는 **화면보다 큰 저주파 덩어리**만 만든다.
 *
 * ## 세 휘도의 출처 — 프리뷰를 카르곤과 나란히 굽고 비(比)로 환산했다
 * 이 레인은 브라우저를 쓸 수 없어(레인끼리 페이지를 갈아엎는다) 하네스 스크린샷 대신
 * 오프라인 배치 프리뷰(`.omc/research/kargon-aaa-shots/kargon-tileset-preview.mjs`, 시드
 * 12345)로 쟀다. 프리뷰는 하네스보다 전체적으로 어두우므로 **절대값을 그대로 쓰면 안 된다.**
 * 그래서 같은 도구로 카르곤도 함께 굽고, 하네스 실측인 카르곤 테마값에 비를 곱했다.
 *
 * | 지표 | 카르곤 프리뷰 | 톡사르 프리뷰 | 비 | 카르곤 테마값(하네스) | ⇒ 톡사르 |
 * |---|---|---|---|---|---|
 * | 평균 relLum | 0.098 | 0.093 | 0.949 | 0.20 | **0.19** |
 * | p25 relLum | 0.074 | 0.068 | 0.919 | 0.10 | **0.092** |
 * | p97 relLum | 0.223 | 0.199 | 0.892 | 0.48 | **0.43** |
 *
 * 세 지점 모두 카르곤보다 낮은 것은 우연이 아니다 — 톡사르의 밝은 요소가 주황(휘도가 비싼
 * R+G)이 아니라 violet(R+B 이고 G 가 비어 있다)이라 같은 채도에서 휘도가 덜 오른다.
 */

import {
  FALLOFF_SOFT,
  FALLOFF_TIGHT,
  FALLOFF_WIDE,
  type ParallaxTheme,
} from '../../contracts/parallax.js';

export const TOXAR_PARALLAX: ParallaxTheme = {
  themeId: 'toxar',
  baseLuma: 0.19,
  darkLuma: 0.092,
  brightLuma: 0.43,
  bands: [
    {
      /**
       * 화면에서 가장 큰 저주파 = 명도 골격. 거의 검은 **암록**을 공격적인 알파로 — 늪의 깊은
       * 웅덩이 그늘이다. 어두운 구역이 깊어질수록 그 위의 적·탄 대비는 오히려 살아난다.
       * 4개 × 반경 0.22~0.40 ⇒ 겹침을 포함해도 텍스처 절반 남짓만 덮는다(= 틈이 남는다).
       * 휘도 0.035 라 암부 바닥(0.092)보다 어두워 부호가 뒤집히지 않는다.
       */
      key: 'bog-shadow',
      domain: 'lit',
      parallax: 0.09,
      tile: 5400,
      alpha: 0.5,
      blend: 'normal',
      color: '#050a08',
      blobs: 4,
      rMin: 0.22,
      rMax: 0.4,
      peak: 0.9,
      falloff: FALLOFF_WIDE,
      driftX: -0.018,
      driftY: 0.03,
      pulse: 0.08,
      period: 940,
      minTier: 'low',
      glow: false,
    },
    {
      /**
       * 암부 저주파 바운스광 — 웅덩이가 늪 바닥에 되던지는 오염광.
       * 색상각 297.4°: 골짜기(280.2~305.0) 안이면서 **톡사르 적 몸통(281.6·283.1°)에서
       * 14° 이상** 떨어져 있다. 적이 골짜기 안에 살고 있다는 것이 이 행성의 특수 사정이고,
       * 그래서 팔레트를 골짜기 중앙이 아니라 마젠타 쪽 끝에 뒀다.
       *
       * B(82)와 R(79)이 함께 서면서 G(12)를 비워 Rec.709 휘도는 0.123 뿐이다 — 색조 이동은
       * 크지만 명도는 거의 안 올린다. 7개 × 0.18~0.34 × 중간 감쇠 ⇒ 실효 커버리지 ≈ 0.37,
       * 막이 아니라 무늬다(암부 전체를 고르게 물들이는 일은 그레이딩의 몫이다).
       */
      key: 'miasma-bounce',
      domain: 'shadow',
      parallax: 0.16,
      tile: 3700,
      alpha: 0.55,
      blend: 'add',
      color: '#4f0c52',
      blobs: 7,
      rMin: 0.18,
      rMax: 0.34,
      peak: 0.66,
      falloff: FALLOFF_SOFT,
      driftX: 0.045,
      driftY: -0.022,
      pulse: 0.12,
      period: 860,
      minTier: 'low',
      /**
       * 저휘도 색조 대역이라 "발광"으로 억제하면 안 된다 — reducedGlow 를 켠 사용자에게
       * 암부가 다시 평면으로 돌아가는 것이 이 대역의 유일한 회귀 경로다.
       */
      glow: false,
    },
    {
      /**
       * 아주 넓고 은은한 지역 오염감(296.8°). 국소 밝음은 지형광(개천)이 담당하므로 여기서는
       * "이 지대가 오염됐다"는 저주파 신호만 낸다.
       * minTier med: 저티어 활성 장수를 `miasma-bounce` 에 양보해 fill-rate 를 중립으로 유지.
       */
      key: 'spore-haze',
      domain: 'lit',
      parallax: 0.24,
      tile: 2900,
      alpha: 0.055,
      blend: 'add',
      color: '#c83ad0',
      blobs: 4,
      rMin: 0.28,
      rMax: 0.46,
      peak: 0.45,
      falloff: FALLOFF_WIDE,
      driftX: 0.028,
      driftY: 0.018,
      pulse: 0.24,
      period: 680,
      minTier: 'med',
      glow: true,
    },
    {
      /**
       * 포자 광점(296.0°). 개수는 늘리고 반경은 줄여 "밝은 면적"이 아니라 "밝은 점"이 되게
       * 한다 — 실효 커버리지가 텍스처의 2% 라, 이 행성에서 가장 밝은 대역인데도 영역 평균을
       * 거의 안 움직인다.
       */
      key: 'spore-mote',
      domain: 'lit',
      parallax: 0.33,
      tile: 2300,
      alpha: 0.06,
      blend: 'add',
      color: '#e878f0',
      blobs: 10,
      rMin: 0.07,
      rMax: 0.15,
      peak: 0.52,
      falloff: FALLOFF_TIGHT,
      driftX: 0.045,
      driftY: -0.05,
      pulse: 0.32,
      period: 460,
      minTier: 'high',
      glow: true,
    },
  ],
};
