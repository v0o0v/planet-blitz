/**
 * 아르케 — 유적 테마 조합. 레이어 슬라이스 5장을 하나의 {@link EnvTheme} 으로 묶는다.
 */

import type { EnvTheme } from '../../theme.js';
import { ARKE_PARALLAX } from './parallax.js';
import { ARKE_DECALS } from './decals.js';
import { ARKE_TERRAIN_LIGHT } from './terrainLight.js';
import { ARKE_ATMOSPHERE } from './atmosphere.js';
import { ARKE_GRADE } from './grade.js';

export const ARKE_THEME: EnvTheme = {
  id: 'arke',
  name: '아르케 — 유적',
  planets: [3],
  /**
   * 광원이 **위**에 있다. 아르케는 무너진 상부 구조 사이로 드는 **저각 태양과 하늘광**이
   * 유일한 광원이고 지형은 스스로 빛나지 않는다 — 카르곤(발밑 용암)의 정확한 반대다.
   *
   * `sin(angle) = −0.909 < 0` 이라 화면 좌표계(+y 가 아래)에서 광원이 위쪽이고,
   * `cos(angle) = −0.416` 이 저각 태양의 왼쪽 기울기다. 데칼과 지형광이 이 한 값을 공유해야
   * 한다 — 각자 갖고 있으면 화면에 태양이 둘이 된다.
   *
   * `shadowBias` 가 카르곤(0.55)보다 큰 것은 태양 고도가 낮기 때문이다: 그림자가 접지에서
   * 멀리 밀려나야 저녁 유적으로 읽힌다.
   */
  light: { angle: -Math.PI / 2 - 0.43, shadowBias: 0.62 },
  parallax: ARKE_PARALLAX,
  decals: ARKE_DECALS,
  terrainLight: ARKE_TERRAIN_LIGHT,
  atmosphere: ARKE_ATMOSPHERE,
  grade: ARKE_GRADE,
};
