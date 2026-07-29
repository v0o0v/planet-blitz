/**
 * 카르곤 시차 테마 데이터 — 화산 행성.
 *
 * 서사: **바닥 용암이 유일한 광원이고 하늘은 검다.** 그래서 이 레이어의 방향은 "밝기를
 * 더한다"가 아니라 **"밝은 주황 지형을 누르고 검은 암부에 결을 넣는다"** 다. 국소 고주파
 * 밝음은 용암 발광 레이어가, 암부 전체의 균일한 색조는 그레이딩 레이어가 담당하므로 여기는
 * **화면보다 큰 저주파 덩어리**만 만든다.
 *
 * 여기 남기는 주석은 **카르곤 실측 근거**뿐이다. 왜 그런 산식인지(합성 델타·실효 반경 등)는
 * {@link file://../../contracts/parallax.ts} 에 있다.
 */

import {
  FALLOFF_SOFT,
  FALLOFF_TIGHT,
  FALLOFF_WIDE,
  type ParallaxTheme,
} from '../../contracts/parallax.js';

export const KARGON_PARALLAX: ParallaxTheme = {
  themeId: 'kargon',
  // 하네스 `h-none.png` 타일 바닥 평균 ≈ rgb(60,50,48) → 0.204.
  baseLuma: 0.2,
  // 같은 스크린샷 암부 표본(x 0–700·y 250–950, x 1250–1700·y 200–950) 중앙값 ≈ 0.104.
  darkLuma: 0.1,
  // 같은 스크린샷 하단 주황 표본 중앙값 ≈ 0.484.
  brightLuma: 0.48,
  bands: [
    {
      // 화면에서 가장 큰 저주파 = 명도 골격. 거의 검은 남색을 공격적인 알파로.
      // 어두운 구역이 깊어지면 그 위의 적·탄·젬 대비는 오히려 살아난다.
      // 4개 × 반경 0.22~0.40 ⇒ 겹침 포함해도 텍스처의 절반 남짓만 덮는다(= 틈이 남는다).
      key: 'cool-shadow',
      domain: 'lit',
      parallax: 0.1,
      tile: 5200,
      alpha: 0.5,
      blend: 'normal',
      color: '#080512',
      blobs: 4,
      rMin: 0.22,
      rMax: 0.4,
      peak: 0.9,
      falloff: FALLOFF_WIDE,
      driftX: -0.02,
      driftY: 0.028,
      pulse: 0.08,
      period: 900,
      minTier: 'low',
      glow: false,
    },
    {
      // 암부 저주파 바운스광. 주황의 보색 쪽 **저휘도 청보라** — B(114) 가 R(22) 을 압도해
      // 색조 이동은 크지만 Rec.709 휘도는 0.124 뿐이라 명도를 거의 안 올린다. 코어 실증분
      // `alpha*peak*color ≈ (8,9,41)` 이라 암부 바닥 rgb(27,27,35) 위에 얹혀도 rgb(35,36,76)
      // — 여전히 어둡고 함선·탄의 가독성을 해치지 않는다.
      //
      // 7개 × 0.18~0.34 × 중간 감쇠 ⇒ 실효 커버리지 ≈ 0.37. 막이 아니라 무늬다 — 암부 전체를
      // 고르게 차갑게 하는 일은 그레이딩(전역 톤)의 몫이고 여기는 덩어리만 나눈다.
      key: 'shadow-bounce',
      domain: 'shadow',
      parallax: 0.16,
      tile: 3600,
      alpha: 0.55,
      blend: 'add',
      color: '#161a72',
      blobs: 7,
      rMin: 0.18,
      rMax: 0.34,
      peak: 0.66,
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
      // minTier med: 저티어 활성 장수를 `shadow-bounce` 에 양보해 fill-rate 를 중립으로 유지.
      key: 'far-glow',
      domain: 'lit',
      parallax: 0.24,
      tile: 2800,
      alpha: 0.06,
      blend: 'add',
      color: '#e8501c',
      blobs: 4,
      rMin: 0.28,
      rMax: 0.46,
      peak: 0.45,
      falloff: FALLOFF_WIDE,
      driftX: 0.03,
      driftY: 0.015,
      pulse: 0.22,
      period: 640,
      minTier: 'med',
      glow: true,
    },
    {
      // 좁은 열점. 개수는 늘리고 반경은 줄여 "밝은 면적"이 아니라 "밝은 점"이 되게 한다
      // (실효 커버리지 ≈ 텍스처의 2%).
      key: 'near-ember',
      domain: 'lit',
      parallax: 0.33,
      tile: 2200,
      alpha: 0.065,
      blend: 'add',
      color: '#ff9440',
      blobs: 10,
      rMin: 0.07,
      rMax: 0.15,
      peak: 0.52,
      falloff: FALLOFF_TIGHT,
      driftX: 0.05,
      driftY: -0.04,
      pulse: 0.3,
      period: 430,
      minTier: 'high',
      glow: true,
    },
  ],
};
