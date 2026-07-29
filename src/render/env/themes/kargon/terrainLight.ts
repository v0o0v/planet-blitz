/**
 * 카르곤 지형광 테마 데이터 — 화산. 지형 저지의 용암이 유일한 광원이다.
 *
 * 여기 남기는 주석은 **카르곤 실측 근거**뿐이다. 메커니즘 근거(왜 이 필드가 존재하는가,
 * 어떤 관계를 지켜야 하는가)는 계약과 레이어 구현에 있다.
 *
 * 이 값들은 4라운드에 걸친 화면 실측의 결과이고 회귀 게이트가 픽셀 단위로 잠근다
 * (`.omc/research/env-shots/BASELINE.md`). 손대려면 그 게이트를 다시 통과시켜라.
 */

import type { TerrainLightTheme } from '../../contracts/terrainLight.js';

export const KARGON_TERRAIN_LIGHT: TerrainLightTheme = {
  themeId: 'kargon',

  /**
   * 용암 채널 색 4종. 전부 색상각 `[10.0°, 18.1°]` 에 있다 — hot-red 적탄(355.4°)과 앰버
   * 적탄(28.5°) 사이의 빈 골짜기다. 2차 심지 `0xff8a30`(26.1°)이 앰버 적탄과 **2.4°** 차이라
   * 배경 발광과 전경 위험물이 같은 시각 서명을 가졌던 것이 이 팔레트가 존재하는 이유다.
   *
   * 붉은 쪽으로 민 부수 효과로 G 채널이 `0x74` 이하로 내려가 가산 합성의 흰색 포화 여유가
   * 오히려 커졌다(심지 두 장이 이음매에서 겹쳐도 R 만 클리핑한다 = 흰색이 아니라 진한 주황).
   */
  channel: [
    { glow: 0xff4f1f, core: 0xff6d33 },
    { glow: 0xe83a17, core: 0xff5f2e },
    { glow: 0xff6026, core: 0xff7438 },
    { glow: 0xd43511, core: 0xff5729 },
  ],

  /**
   * 지각(주황)이 밝아 주황 적 탱크·포탑 픽업이 **위장**되던 전투 프레임 신고의 처방.
   * 0.26 → 0.38. 틴트가 완전 회색이 아니라 살짝 따뜻해 암괴가 차갑게 죽지 않는다.
   */
  dusk: { alpha: 0.38, tint: 0x4a3c36 },

  glow: { alphaCap: 0.4, width: 104, profileExp: 2.1 },
  /** 알파 0.60 → 0.78 로 올리며 폭을 20 → 17 로 좁혔다: 밝은 면적은 그대로, 첨두 명도만. */
  core: { alphaCap: 0.78, width: 17, profileExp: 6.2 },

  /**
   * 폭 16 은 화면 배율 ≈0.91 에서 ≈15 화면 px 다. 상용(Dead Cells·Hades)의 4~8px 보다 넓지만
   * 이 게임의 지형 덩어리가 화면의 3~5할을 차지해 같은 *상대* 두께를 맞추려면 이 정도가 필요하다.
   * 더 좁히면 1080p 다운스케일에서 사라진다.
   */
  ao: {
    alphaCap: 0.66,
    tint: 0x54463e,
    width: 16,
    offset: 15,
    plateau: 0.5,
    falloffExp: 2.6,
    floor: 0.62,
  },

  /** 틴트가 AO 보다 옅다 — 캐스트 섀도는 접지 어둠보다 항상 밝다. */
  shadow: { alphaCap: 0.5, tint: 0x584a42, width: 52, offset: 40, minStrength: 0.12 },

  /** 색은 창 안에서 가장 저채도 = 가장 "달궈진 돌"에 가깝다. */
  rim: { alphaCap: 0.5, color: 0xff7842, width: 11, widthFloor: 0.5, offset: -17, minStrength: 0.18 },

  /**
   * 열기 기둥 — 뜨거우니까 **위로**(`rise` 양수) 올라가고 세로로 늘어난다(`stretch` 1.55).
   * 이 두 값이 곧 "용암"이라는 전제다. 색은 창의 가장 붉은 끝(위로 갈수록 식는 느낌).
   */
  plume: {
    alphaCap: 0.18,
    color: 0xff3d12,
    width: 148,
    stretch: 1.55,
    rise: 92,
    profileExp: 2.4,
    minStrength: 0.62,
  },

  /**
   * 지역 필드 8타일(=512px)은 1920×1080(≈30×17타일) 화면 안에 뜨거운 덩어리가 서너 개
   * 들어가는 크기다. 15타일로 키웠더니 한 화면이 통째로 용암이거나 통째로 식어 지역 편차가
   * 사라졌다(시드 하나에서 등고선의 90%가 용암이 됐다).
   *
   * `emberMin` 0.28 은 "식었지만 아직 온기가 있는 균열"로 읽히는 대역이다 —
   * 여기서 헤일로 실효 알파 ≈0.095, 심지 ≈0.186.
   */
  intensity: {
    regionTiles: 8,
    regionThreshold: 0.55,
    regionSpan: 0.15,
    emberMin: 0.28,
    emberMax: 0.52,
    emberModTiles: 3.4,
    emberRemapLo: 0.32,
    emberRemapHi: 0.68,
    widthBase: 0.55,
    widthGain: 0.45,
  },
};
