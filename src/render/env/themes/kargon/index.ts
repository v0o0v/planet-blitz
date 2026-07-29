/**
 * 카르곤 테마 조합. 레이어 슬라이스 5장을 하나의 {@link EnvTheme} 으로 묶는다.
 */

import type { EnvTheme } from '../../theme.js';
import { KARGON_PARALLAX } from './parallax.js';
import { KARGON_DECALS } from './decals.js';
import { KARGON_TERRAIN_LIGHT } from './terrainLight.js';
import { KARGON_ATMOSPHERE } from './atmosphere.js';
import { KARGON_GRADE } from './grade.js';

export const KARGON_THEME: EnvTheme = {
  id: 'kargon',
  name: '카르곤 — 화산',
  planets: [0],
  /**
   * 광원이 **아래**에 있다. 카르곤은 지형 저지의 용암이 유일한 광원이고 하늘은 검다.
   * 데칼과 지형광이 이 한 값을 공유해야 한다 — 각자 갖고 있으면 화면에 태양이 둘이 된다.
   */
  light: { angle: Math.PI / 2 + 0.32, shadowBias: 0.55 },
  parallax: KARGON_PARALLAX,
  decals: KARGON_DECALS,
  terrainLight: KARGON_TERRAIN_LIGHT,
  atmosphere: KARGON_ATMOSPHERE,
  grade: KARGON_GRADE,
};
