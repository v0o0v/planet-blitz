/**
 * 아르케 시차 테마 데이터 — 유적 행성.
 *
 * 서사: **광원이 위에 있다.** 저각 태양과 하늘광이 무너진 상부 구조 사이로 들어오고, 지형은
 * 스스로 빛나지 않는다. 그래서 이 레이어의 방향은 "밝은 축조면을 누르고 암부에 결을 넣는다"
 * 지만 **예산이 훨씬 빡빡하다.** 아르케 지형은 발광이 없어 밝은 지형 휘도가 0.24 뿐이고,
 * `normal` 대역의 델타가 `alpha × (색휘도 − 바닥)` 이라 바닥이 낮은 만큼 어둡히는 힘이 줄기
 * 때문이다. 그 몫을 명도 골격 대역의 알파(0.58)로 되갚았다.
 *
 * 여기 남기는 주석은 **아르케 실측 근거**뿐이다. 산식의 근거는
 * {@link file://../../contracts/parallax.ts} 에 있다.
 */

import {
  FALLOFF_SOFT,
  FALLOFF_TIGHT,
  FALLOFF_WIDE,
  type ParallaxTheme,
} from '../../contracts/parallax.js';

export const ARKE_PARALLAX: ParallaxTheme = {
  themeId: 'arke',
  /**
   * `assets/tilesets/arke.png` 면적 가중 평균 L = 32.5/255. 상부(축조면) 41.4 · 하부(묻힌
   * 포장) 23.5 를 상부 점유율 0.502 로 섞은 값이다.
   */
  baseLuma: 0.13,
  /** 같은 시트 하부 영역 평균 23.5/255 ≈ 0.092 를 오프라인 프리뷰 실측(20.3/255)까지 내린 값. */
  darkLuma: 0.08,
  /**
   * 상부 축조면(41.4/255 = 0.162) 위에 지형광 심지가 얹힌 곳. 발광 지형이 없어 이 값이 낮고,
   * 그것이 아래 대역 알파 배분 전체를 결정한다.
   */
  brightLuma: 0.24,
  bands: [
    {
      // 화면보다 큰 명도 골격 — 무너진 상부 구조가 드리우는 그림자 구역.
      // 알파가 공격적인 이유는 위 `brightLuma` 주석 그대로다: 밝은 바닥이 낮으면 `normal`
      // 델타가 작아져, 같은 알파로는 순 델타 부호를 음수로 만들지 못한다.
      // 4개 × 반경 0.22~0.40 ⇒ 실효 커버리지 0.37 — 막이 아니라 구역이다.
      key: 'ruin-shadow',
      domain: 'lit',
      parallax: 0.09,
      tile: 5400,
      alpha: 0.58,
      blend: 'normal',
      color: '#0a0d10',
      blobs: 4,
      rMin: 0.22,
      rMax: 0.4,
      peak: 0.9,
      falloff: FALLOFF_WIDE,
      driftX: -0.018,
      driftY: 0.022,
      pulse: 0.06,
      period: 1020,
      minTier: 'low',
      glow: false,
    },
    {
      // 암부 하늘광 바운스. 아르케는 **하늘 자체가 광원**이라 암부에 실제로 청록이 떨어진다.
      // 저채도 저휘도(0.143)라 색조는 옮기고 명도는 거의 안 올린다.
      // `normal` 은 검정 위에서 뺄 빛이 없어 암부 담당이 될 수 없으므로 가산이어야 한다.
      key: 'sky-bounce',
      domain: 'shadow',
      parallax: 0.15,
      tile: 3700,
      alpha: 0.5,
      blend: 'add',
      color: '#12292c',
      blobs: 7,
      rMin: 0.18,
      rMax: 0.34,
      peak: 0.62,
      falloff: FALLOFF_SOFT,
      driftX: 0.035,
      driftY: -0.016,
      pulse: 0.1,
      period: 880,
      minTier: 'low',
      // 한색 저휘도라 "발광"으로 억제하면 안 된다 — reducedGlow 사용자에게 암부가 다시
      // 평면으로 돌아가는 것이 이 대역의 유일한 회귀 경로다.
      glow: false,
    },
    {
      // 먼지에 걸린 저각 햇살. 넓고 아주 은은하다 — 국소 밝음은 지형광이 담당하므로
      // 여기서는 "이 구역에 빛이 든다"는 저주파 신호만 낸다.
      key: 'dust-shaft',
      domain: 'lit',
      parallax: 0.23,
      tile: 2900,
      alpha: 0.05,
      blend: 'add',
      color: '#b8ae9a',
      blobs: 4,
      rMin: 0.28,
      rMax: 0.46,
      peak: 0.45,
      falloff: FALLOFF_WIDE,
      driftX: 0.026,
      driftY: 0.012,
      pulse: 0.16,
      period: 760,
      minTier: 'med',
      glow: true,
    },
    {
      // 좁은 반사점 — 석영·녹청이 빛을 되쏘는 자리. 개수는 늘리고 반경은 줄여
      // "밝은 면적"이 아니라 "밝은 점"이 되게 한다(실효 커버리지 ≈ 텍스처의 2%).
      key: 'stone-glint',
      domain: 'lit',
      parallax: 0.32,
      tile: 2300,
      alpha: 0.055,
      blend: 'add',
      color: '#cfe6da',
      blobs: 10,
      rMin: 0.07,
      rMax: 0.15,
      peak: 0.5,
      falloff: FALLOFF_TIGHT,
      driftX: 0.042,
      driftY: -0.03,
      pulse: 0.26,
      period: 520,
      minTier: 'high',
      glow: true,
    },
  ],
};
