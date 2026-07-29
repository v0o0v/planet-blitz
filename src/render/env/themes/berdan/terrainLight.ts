/**
 * 베르단 지형광 테마 데이터 — 산성 습지. **경계를 따라 흐르는 것은 용암이 아니라 산성 침출**이다.
 *
 * 마칭 스퀘어즈가 뽑는 등고선은 고지(부식 지각)와 저지(진창)의 경계다. 산은 고지의 갈라진
 * 틈에서 배어 나와 그 경계선을 따라 고이고 아래로 흘러내린다 — 그래서 "경계를 따라 흐르는
 * 띠"라는 메커니즘이 이 행성에서도 그대로 성립한다. 광원이 위(하늘)라 림은 위를 향한 면에,
 * 접지 어둠과 캐스트 섀도는 아래로 떨어진다.
 *
 * 여기 남기는 주석은 **베르단 근거**뿐이다. 왜 이 필드가 존재하고 어떤 관계를 지켜야 하는지는
 * {@link file://../../contracts/terrainLight.ts} 에 있다.
 */

import type { TerrainLightTheme } from '../../contracts/terrainLight.js';

export const BERDAN_TERRAIN_LIGHT: TerrainLightTheme = {
  themeId: 'berdan',

  /**
   * 침출 채널 색 4종. 전부 **107°~157°** 에 있다 — 안전 골짜기(60.9°→184.2°)의 한가운데다.
   *
   * 골짜기가 123° 나 되는데도 가장 자연스러운 "산성 황록"(75~95°)을 안 쓴 이유는 적탄이
   * 아니라 **적 자산** 때문이다. `assets/enemy_berdan_{charger,gunner,special}.png` 의 몸통
   * 대표색은 셋 다 rgb(142,138,18) = 58.1°·휘도 130 이고 support 는 rgb(251,243,174) = 53.8°다.
   * 황록은 R≈G·B 낮음이라 이 몸통색과 ΔRGB 100 미만으로 붙는다. G 를 R 위로 크게 띄운
   * 이 대역은 검산상 ΔRGB 158~285 로 떨어진다(위장 판정 문턱 70).
   *
   * 짝의 방향도 하나다: `glow` 는 젖은 채널 바깥의 넓은 번짐, `core` 는 그 안의 형광 심지.
   */
  channel: [
    { glow: 0x2fbf5e, core: 0x4ee87e },
    { glow: 0x1fb47a, core: 0x3fe0a0 },
    { glow: 0x46c62c, core: 0x69e848 },
    { glow: 0x19a86a, core: 0x36d489 },
  ],

  /**
   * 습지의 낮은 하늘이 지형 전체를 한 단계 눌러 준다. 카르곤의 0.38 보다 낮은 이유는 이 행성의
   * 지각 평균이 이미 어둡기 때문이다(타일 프리뷰 mean 25.84 · 상부 33.5). 틴트는 완전 회색이
   * 아니라 녹기가 남아 있어 진창이 회색으로 죽지 않는다.
   */
  dusk: { alpha: 0.3, tint: 0x44503f },

  /**
   * 헤일로가 카르곤보다 넓고(104 → 122) 옅다(0.40 → 0.34). 산은 젖은 지반으로 번지므로
   * 발광의 경계가 용암보다 훨씬 무르다.
   */
  glow: { alphaCap: 0.34, width: 122, profileExp: 1.9 },
  /** 반대로 심지는 더 좁고(17 → 14) 더 날카롭다(6.2 → 6.8) — 흐르는 산줄기는 실개천이다. */
  core: { alphaCap: 0.72, width: 14, profileExp: 6.8 },

  /**
   * 폭 15 는 화면 배율 ≈0.91 에서 ≈14 화면 px 다. 이 게임의 지형 덩어리가 화면의 3~5할을
   * 차지해 상용(4~8px)보다 넓어야 같은 *상대* 두께가 된다 — 더 좁히면 1080p 다운스케일에서 사라진다.
   * 틴트가 녹회색인 이유는 접지 어둠이 젖은 이끼 그늘이기 때문이다.
   */
  ao: {
    alphaCap: 0.6,
    tint: 0x424e3e,
    width: 15,
    offset: 14,
    plateau: 0.52,
    falloffExp: 2.5,
    floor: 0.58,
  },

  /** 틴트가 AO 보다 옅다 — 캐스트 섀도는 접지 어둠보다 항상 밝다. */
  shadow: { alphaCap: 0.46, tint: 0x4d5a48, width: 50, offset: 34, minStrength: 0.12 },

  /**
   * 광원이 위라 림은 하늘을 향한 면에 앉는다. 색은 채널 팔레트에서 가장 저채도(0.59) —
   * "빛나는 산"이 아니라 **산에 젖어 번들거리는 지각 모서리**다.
   */
  rim: { alphaCap: 0.46, color: 0x5ce09a, width: 10, widthFloor: 0.52, offset: -15, minStrength: 0.18 },

  /**
   * 부식성 증기 — 산이 지반을 갉으며 오르는 김. 카르곤 열기 기둥과 `rise > 0` 은 같지만
   * `stretch` 가 1.55 → 1.12 다: 열기는 기둥으로 솟고 **증기는 퍼진다**. 색은 채널에서 가장
   * 어두운 끝(위로 갈수록 묽어지는 느낌).
   */
  plume: {
    alphaCap: 0.16,
    color: 0x14a05a,
    width: 140,
    stretch: 1.12,
    rise: 74,
    profileExp: 2.2,
    minStrength: 0.64,
  },

  /**
   * 지역 필드 9타일(=576px)은 1920×1080(≈30×17타일) 화면에 활성 침출 덩어리가 두세 개
   * 들어가는 크기다. 카르곤의 8보다 조금 크게 잡은 이유는 습지의 침출이 용암 채널보다
   * 넓고 연속적인 수계를 이루기 때문이다.
   *
   * `emberMin` 0.30 은 "말라붙었지만 아직 산기가 남은 자국"으로 읽히는 대역이다 —
   * 여기서 헤일로 실효 알파 ≈0.102, 심지 ≈0.216 이라 실효 0.08 붕괴선 위에 있다.
   * `emberMax` 0.58 은 `plume.minStrength` 0.64 아래라 증기가 잔여 구간에는 안 붙는다.
   */
  intensity: {
    regionTiles: 9,
    regionThreshold: 0.54,
    regionSpan: 0.16,
    emberMin: 0.3,
    emberMax: 0.58,
    emberModTiles: 3.8,
    emberRemapLo: 0.3,
    emberRemapHi: 0.7,
    widthBase: 0.5,
    widthGain: 0.5,
  },
};
