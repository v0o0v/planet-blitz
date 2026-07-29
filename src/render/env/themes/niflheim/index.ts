/**
 * 니플헤임 테마 조합 — 빙원. 레이어 슬라이스 5장을 하나의 {@link EnvTheme} 으로 묶는다.
 */

import type { EnvTheme } from '../../theme.js';
import { NIFLHEIM_PARALLAX } from './parallax.js';
import { NIFLHEIM_DECALS } from './decals.js';
import { NIFLHEIM_TERRAIN_LIGHT } from './terrainLight.js';
import { NIFLHEIM_ATMOSPHERE } from './atmosphere.js';
import { NIFLHEIM_GRADE } from './grade.js';

export const NIFLHEIM_THEME: EnvTheme = {
  id: 'niflheim',
  name: '니플헤임 — 빙원',
  planets: [2],
  /**
   * 광원이 **위**에 있다. 니플헤임은 지평선에 걸린 저각 태양이 유일한 광원이고 바닥은
   * 빛을 내지 않는다 — 카르곤("바닥 용암이 광원, 하늘은 검다")의 정확한 반대다.
   * 화면 좌표는 +y 가 아래이므로 표면 → 광원 벡터의 y 가 **음수**여야 한다.
   *
   * `shadowBias` 0.82 는 카르곤(0.55)보다 크다: 태양이 낮게 걸려 있으면 그림자가 접지에서
   * 멀리, 광원 반대편으로 길게 늘어난다. 이 한 값이 "저각"을 기하로 만든다.
   *
   * 데칼과 지형광이 이 한 값을 공유해야 한다 — 각자 갖고 있으면 화면에 태양이 둘이 된다.
   */
  light: { angle: -Math.PI / 2 + 0.28, shadowBias: 0.82 },
  parallax: NIFLHEIM_PARALLAX,
  decals: NIFLHEIM_DECALS,
  terrainLight: NIFLHEIM_TERRAIN_LIGHT,
  atmosphere: NIFLHEIM_ATMOSPHERE,
  grade: NIFLHEIM_GRADE,
};
