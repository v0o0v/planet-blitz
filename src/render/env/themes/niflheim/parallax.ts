/**
 * 니플헤임 시차 테마 데이터 — 빙원.
 *
 * 서사: **저각 태양이 화면 위 지평선에 걸려 있고, 장면 전체가 푸른 그늘에 잠겨 있다.**
 * 그래서 이 레이어의 방향은 카르곤과 같다 — "밝은 곳(설면)을 누르고 어두운 곳(노출 암반)에
 * 결을 넣는다". 다만 카르곤에서 눌러야 했던 밝은 곳이 주황 용암이었다면 여기서는 눈이다.
 *
 * 세 휘도는 이 행성 타일셋 프리뷰(시드 12345, `assets/tilesets/niflheim.png`)의 실측이다:
 * 화면 전체 평균 L 46.0 → 0.180 · L<40 영역(노출 암반, 화면의 63.5%) 평균 21.7 → 0.085 ·
 * L≥70 영역(설면, 33.6%) 평균 90.9 → 0.356. 타일셋을 다시 구우면 여기부터 재측정한다.
 *
 * 색은 전부 안전 골짜기 204.2°~260.2° 안이다 — 얼음의 자연스러운 시안(≈195°)은 아군
 * 신호색 194.2° 와 사실상 같은 각도라 쓸 수 없다(배경이 아군 표식으로 읽힌다).
 */

import {
  FALLOFF_SOFT,
  FALLOFF_TIGHT,
  FALLOFF_WIDE,
  type ParallaxTheme,
} from '../../contracts/parallax.js';

export const NIFLHEIM_PARALLAX: ParallaxTheme = {
  themeId: 'niflheim',
  baseLuma: 0.18,
  darkLuma: 0.085,
  brightLuma: 0.356,
  bands: [
    {
      // 화면에서 가장 큰 저주파 = 명도 골격. 설면 위에 드리우는 거대한 구름 그림자다.
      // 이 행성은 바닥이 밝아 `normal` 델타(`a*(L−base)`)가 카르곤보다 크게 나온다 —
      // 밝은 바닥 0.356 에서 코어 델타 −0.137 이다. 밝은 행성에서 어둡히는 대역이 잘 듣는
      // 것은 바로 이 산식 때문이고, 반대로 암부에서는 −0.015 로 거의 일하지 않는다.
      key: 'cloud-shadow',
      domain: 'lit',
      parallax: 0.1,
      tile: 5200,
      alpha: 0.5,
      blend: 'normal',
      color: '#0a0d1c',
      blobs: 4,
      rMin: 0.22,
      rMax: 0.4,
      peak: 0.9,
      falloff: FALLOFF_WIDE,
      driftX: -0.024,
      driftY: 0.02,
      pulse: 0.07,
      period: 940,
      minTier: 'low',
      glow: false,
    },
    {
      // 암부 저주파 하늘 산란광. 눈이 벗겨진 암반 그늘에는 직사광이 안 닿고 **하늘색만**
      // 들어온다 — 그래서 색은 순청 쪽이고 휘도는 0.180 뿐이다(B 144 가 R 26 을 압도해
      // 색조 이동은 크지만 명도는 거의 안 올린다). 암부 바닥 rgb(20,21,29) 위에 코어
      // 실증분 ≈(9,14,48) 이 얹혀도 rgb(29,35,77) — 여전히 어둡다.
      key: 'sky-bounce',
      domain: 'shadow',
      parallax: 0.16,
      tile: 3600,
      alpha: 0.5,
      blend: 'add',
      color: '#1a2a90',
      blobs: 7,
      rMin: 0.18,
      rMax: 0.34,
      peak: 0.66,
      falloff: FALLOFF_SOFT,
      driftX: 0.035,
      driftY: -0.018,
      pulse: 0.1,
      period: 860,
      minTier: 'low',
      // 한색 저휘도라 "발광"으로 억제하면 안 된다 — reducedGlow 를 켠 사용자에게 암부가
      // 다시 평면으로 돌아가는 게 이 대역의 유일한 회귀 경로다.
      glow: false,
    },
    {
      // 아주 넓고 은은한 지역 설연(雪煙). 국소 밝음은 지형광이 담당하므로 여기서는
      // "이 지역에 눈보라가 지난다"는 저주파 신호만 낸다.
      // minTier med: 저티어 활성 장수를 `sky-bounce` 에 양보해 fill-rate 를 중립으로 유지.
      key: 'far-drift',
      domain: 'lit',
      parallax: 0.24,
      tile: 2800,
      alpha: 0.06,
      blend: 'add',
      color: '#7f9ce8',
      blobs: 4,
      rMin: 0.28,
      rMax: 0.46,
      peak: 0.45,
      falloff: FALLOFF_WIDE,
      driftX: 0.04,
      driftY: 0.012,
      pulse: 0.18,
      period: 700,
      minTier: 'med',
      glow: true,
    },
    {
      // 좁은 빙정 반짝임 지대. 개수를 늘리고 반경을 줄여 "밝은 면적"이 아니라 "밝은 점"이
      // 되게 한다(실효 커버리지 ≈ 텍스처의 2%). 밝은 바닥에서 넓은 가산은 곧 화이트아웃이라
      // 이 행성에서 밝힐 수 있는 것은 이렇게 좁은 대역뿐이다.
      key: 'near-glint',
      domain: 'lit',
      parallax: 0.33,
      tile: 2200,
      alpha: 0.055,
      blend: 'add',
      color: '#b8d0ff',
      blobs: 10,
      rMin: 0.07,
      rMax: 0.15,
      peak: 0.52,
      falloff: FALLOFF_TIGHT,
      driftX: 0.05,
      driftY: -0.035,
      pulse: 0.28,
      period: 470,
      minTier: 'high',
      glow: true,
    },
  ],
};
