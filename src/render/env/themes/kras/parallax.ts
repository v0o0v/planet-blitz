/**
 * 크라스 시차 테마 데이터 — 파괴 폐허.
 *
 * 서사: **하늘은 재로 덮여 있고 광원은 위에서 오는 확산광이다.** 카르곤과 정반대다 —
 * 카르곤은 바닥이 유일한 광원이라 "밝은 지형을 누르는" 것이 이 레이어의 전부였지만,
 * 크라스의 지형은 위아래가 다 중성 회색이라 **누를 밝은 곳이 별로 없다**. 그래서 이 행성에서
 * 시차의 임무는 밝기 조절이 아니라 **구역 나누기**다: 재구름의 그늘이 드리운 넓은 암부와,
 * 잔불이 아직 남은 구역을 화면보다 큰 스케일로 갈라 놓는다.
 *
 * 여기 남기는 주석은 **크라스 실측 근거**뿐이다. 왜 그런 산식인지(합성 델타·실효 반경 등)는
 * {@link file://../../contracts/parallax.ts} 에 있다.
 */

import {
  FALLOFF_SOFT,
  FALLOFF_TIGHT,
  FALLOFF_WIDE,
  type ParallaxTheme,
} from '../../contracts/parallax.js';

export const KRAS_PARALLAX: ParallaxTheme = {
  themeId: 'kras',
  /*
   * 세 휘도는 `assets/tilesets/kras.png` 의 Wang 16장 실측(L 평균 32.7 · p05 15.2 · p95 62.3,
   * 0~255 척도)에 지형광 겹의 상승분을 얹은 값이다. 카르곤과 같은 방식으로 재고 같은 방식으로
   * 보정했다(카르곤 시트 평균 34.6 ↔ 선언 0.2).
   *
   * ⚠️ 크라스의 `brightLuma` 가 카르곤(0.48)의 3분의 2인 것은 튜닝이 아니라 **구조**다.
   * 카르곤의 밝은 지형은 용암(시트 p95 85.1)이지만 크라스에는 그런 발광 지대가 없다 —
   * 시트 p95 가 62.3 이고 그중 밝은 것도 균열선뿐이다. 이 값을 카르곤에서 베껴 오면 아래
   * "밝은 지형에서 순 델타가 음수" 검사가 실제보다 훨씬 헐거워진다.
   */
  baseLuma: 0.17,
  darkLuma: 0.09,
  brightLuma: 0.32,
  bands: [
    {
      /*
       * 재 장막 — 화면에서 가장 큰 저주파이자 이 행성 명도 골격의 전부다. 색은 거의 검고
       * 아주 옅게만 자적을 띈다(330.0°, 상대휘도 0.043): 폐허의 그늘은 색이 아니라 명도이고,
       * 그럼에도 완전 무채로 두면 그레이딩의 비네트와 구분되지 않는다.
       *
       * 4개 × 반경 0.22~0.42 ⇒ 실효 커버리지 ≈ 0.39. 막이 아니라 무늬다.
       */
      key: 'ash-shroud',
      domain: 'lit',
      parallax: 0.09,
      tile: 5600,
      alpha: 0.5,
      blend: 'normal',
      color: '#0e0a0c',
      blobs: 4,
      rMin: 0.22,
      rMax: 0.42,
      peak: 0.9,
      falloff: FALLOFF_WIDE,
      // 재는 거의 정지해 있다. 카르곤보다 느린 드리프트·긴 주기 — 폐허는 움직이지 않는다.
      driftX: -0.018,
      driftY: 0.024,
      pulse: 0.06,
      period: 1050,
      minTier: 'low',
      glow: false,
    },
    {
      /*
       * 잔해 바운스 — 암부에 결을 넣는 유일한 대역. 카르곤은 주황 용암의 보색(청보라)을 썼지만
       * 크라스의 광원은 **바닥 잔불**이라 바운스 색이 광원과 같은 계열이어야 한다.
       * 저휘도 자적(#4a1830, 상대휘도 0.143)이라 암부 바닥 0.09 위에 얹혀도 0.14 에 머문다.
       *
       * 7개 × 0.18~0.34 × 중간 감쇠 ⇒ 실효 커버리지 ≈ 0.37.
       */
      key: 'rubble-bounce',
      domain: 'shadow',
      parallax: 0.15,
      tile: 3800,
      alpha: 0.55,
      blend: 'add',
      color: '#4a1830',
      blobs: 7,
      rMin: 0.18,
      rMax: 0.34,
      peak: 0.66,
      falloff: FALLOFF_SOFT,
      driftX: 0.035,
      driftY: -0.018,
      pulse: 0.12,
      period: 880,
      minTier: 'low',
      // 저휘도 대역이라 "발광"으로 억제하면 안 된다 — 억제하는 순간 크라스 암부는
      // 이 레이어에서 아무 결도 받지 못하는 평면으로 되돌아간다.
      glow: false,
    },
    {
      /*
       * 아직 타고 있는 구역 — "저기가 아직 불탄다"는 저주파 신호만 낸다. 국소 밝음은 지형광의
       * 몫이다. 카르곤의 `far-glow`(#e8501c) 대비 훨씬 어두운 자적(상대휘도 0.185)인 이유는
       * 크라스의 불이 **꺼져 가는 중**이기 때문이다.
       */
      key: 'far-smoulder',
      domain: 'lit',
      parallax: 0.23,
      tile: 2900,
      alpha: 0.055,
      blend: 'add',
      color: '#7a1838',
      blobs: 4,
      rMin: 0.28,
      rMax: 0.46,
      peak: 0.45,
      falloff: FALLOFF_WIDE,
      driftX: 0.026,
      driftY: 0.012,
      pulse: 0.2,
      period: 700,
      minTier: 'med',
      glow: true,
    },
    {
      /*
       * 불씨 — 실효 커버리지 2% 의 "밝은 점". 맥동을 카르곤(0.30)보다 크게 잡은 것이
       * "꺼져 간다"의 유일한 시간축 표현이다: 밝기가 일정하면 불은 살아 있는 것으로 읽힌다.
       */
      key: 'near-ember',
      domain: 'lit',
      parallax: 0.32,
      tile: 2300,
      alpha: 0.06,
      blend: 'add',
      color: '#ff5a94',
      blobs: 10,
      rMin: 0.07,
      rMax: 0.15,
      peak: 0.5,
      falloff: FALLOFF_TIGHT,
      driftX: 0.042,
      driftY: -0.03,
      pulse: 0.38,
      period: 380,
      minTier: 'high',
      glow: true,
    },
  ],
};
