/**
 * 베르단 시차 테마 데이터 — 산성 습지.
 *
 * 서사: **광원은 위다.** 포자로 뿌옇게 빛나는 황록 하늘이 확산광을 내리고, 산성 침출은
 * 고지의 부식된 능선에서 스며 나와 저지의 진창으로 흘러내린다. 그래서 이 레이어가 하는 일은
 * **밝은 지각을 누르고 어두운 진창에 결을 넣는 것**이다. 국소 고주파 밝음은 침출 발광
 * 레이어가, 전역 색온도는 그레이딩이 담당하므로 여기는 **화면보다 큰 저주파 덩어리**만 만든다.
 *
 * 여기 남기는 주석은 **베르단 실측 근거**뿐이다. 왜 그런 산식인지(합성 델타·실효 반경 등)는
 * {@link file://../../contracts/parallax.ts} 에 있다.
 */

import {
  FALLOFF_SOFT,
  FALLOFF_TIGHT,
  FALLOFF_WIDE,
  type ParallaxTheme,
} from '../../contracts/parallax.js';

export const BERDAN_PARALLAX: ParallaxTheme = {
  themeId: 'berdan',
  /*
   * 세 휘도의 출처. 브라우저를 못 쓰는 레인이라 화면을 직접 못 재므로 **재현 가능한 오프라인
   * 측정 + 카르곤에서 얻은 환산비**로 얻었다(눈대중을 피하기 위한 절차다).
   *
   *   ① `scripts/tileset-gen.mjs --planet berdan` 산출물로 타일 프리뷰를 굽고
   *      (`.omc/research/kargon-aaa-shots/kargon-tileset-preview.mjs`, seed 12345)
   *      `analyze.mjs tone` 으로 재면 mean 25.84 / p05 12.72 / p95 42.65 다.
   *      같은 절차로 잰 카르곤은 mean 25.13 / p05 12.57 / p95 38.56 — **같은 차수**다.
   *   ② 카르곤의 선언값(0.20 / 0.10 / 0.48)과 ① 의 카르곤 값 사이 비는 2.03 / 2.03 / 3.17 이다
   *      (프리뷰에는 환경 레이어가 없어 밝은 끝일수록 비가 커진다).
   *   ③ 베르단 값에 그 비를 곱하고, 밝은 끝만 침출 발광이 용암보다 약한 만큼(헤일로 상한
   *      0.34/0.40 = 0.85) 되곱했다.
   *
   * ⚠️ 통합 후 직렬 시각 검증에서 실제 화면으로 재측정할 자리다 — 이 셋이 화면과 어긋나면
   * 아래 도메인 에너지 균형 판정이 통째로 기준을 잃는다.
   */
  baseLuma: 0.21,
  darkLuma: 0.1,
  brightLuma: 0.45,
  bands: [
    {
      // 화면에서 가장 큰 저주파 = 명도 골격. 거의 검은 **암녹**을 공격적인 알파로. 고인 물이
      // 빛을 삼키는 구역이라 진창이 더 깊어지고, 그 위의 적·탄·젬 대비는 오히려 산다.
      // 4개 × 반경 0.22~0.40 ⇒ 겹침 포함해도 텍스처의 절반 남짓만 덮는다(= 틈이 남는다).
      key: 'mire-shadow',
      domain: 'lit',
      parallax: 0.09,
      tile: 5400,
      alpha: 0.5,
      blend: 'normal',
      // 상대휘도 0.046 — 암부 바닥(0.10)보다 확실히 어두워 밝은 곳/어두운 곳에서 부호가
      // 뒤집히지 않는다.
      color: '#050e0a',
      blobs: 4,
      rMin: 0.22,
      rMax: 0.4,
      peak: 0.9,
      falloff: FALLOFF_WIDE,
      driftX: -0.018,
      driftY: 0.026,
      pulse: 0.08,
      period: 940,
      minTier: 'low',
      glow: false,
    },
    {
      // 암부 저주파 산란광 — 포자 안개가 되돌려 주는 빛. **저휘도 청록**이라 색조는 크게
      // 밀면서 Rec.709 휘도는 0.147 뿐이다. 코어 실증분 `alpha*peak*color ≈ (4,17,12)` 라
      // 암부 진창 rgb(14,17,15) 위에 얹혀도 rgb(18,34,27) — 여전히 어둡다.
      //
      // 7개 × 0.18~0.34 × 중간 감쇠 ⇒ 실효 커버리지 ≈ 0.37. 막이 아니라 무늬다 — 암부 전체를
      // 고르게 물들이는 일은 그레이딩(전역 톤)의 몫이고 여기는 덩어리만 나눈다.
      key: 'spore-bounce',
      domain: 'shadow',
      parallax: 0.15,
      tile: 3700,
      alpha: 0.55,
      blend: 'add',
      color: '#0a2e22',
      blobs: 7,
      rMin: 0.18,
      rMax: 0.34,
      peak: 0.66,
      falloff: FALLOFF_SOFT,
      driftX: 0.036,
      driftY: -0.018,
      pulse: 0.12,
      period: 860,
      minTier: 'low',
      // 한색 저휘도라 "발광"으로 억제하면 안 된다 — reducedGlow 를 켠 사용자에게 암부가
      // 다시 평면으로 돌아가는 게 이 대역의 유일한 회귀 경로다.
      glow: false,
    },
    {
      // 아주 넓고 아주 은은한 지역 침출감. 국소 밝음은 지형광 레이어가 담당하므로 여기서는
      // "이 지역이 산에 절었다"는 저주파 신호만 낸다.
      // minTier med: 저티어 활성 장수를 `spore-bounce` 에 양보해 fill-rate 를 중립으로 유지.
      key: 'far-bloom',
      domain: 'lit',
      parallax: 0.23,
      tile: 2900,
      alpha: 0.055,
      blend: 'add',
      color: '#3fbf6a',
      blobs: 4,
      rMin: 0.28,
      rMax: 0.46,
      peak: 0.45,
      falloff: FALLOFF_WIDE,
      driftX: 0.028,
      driftY: 0.014,
      pulse: 0.2,
      period: 700,
      minTier: 'med',
      glow: true,
    },
    {
      // 방울져 맺힌 침출 점. 개수는 늘리고 반경은 줄여 "밝은 면적"이 아니라 "밝은 점"이 되게
      // 한다(실효 커버리지 ≈ 텍스처의 2%).
      key: 'near-drip',
      domain: 'lit',
      parallax: 0.32,
      tile: 2300,
      alpha: 0.06,
      blend: 'add',
      color: '#7cf0a4',
      blobs: 10,
      rMin: 0.07,
      rMax: 0.15,
      peak: 0.5,
      falloff: FALLOFF_TIGHT,
      driftX: 0.045,
      driftY: -0.036,
      pulse: 0.28,
      period: 470,
      minTier: 'high',
      glow: true,
    },
  ],
};
