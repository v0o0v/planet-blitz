/**
 * 크라스 — 파괴 폐허 테마 조합. 레이어 슬라이스 5장을 하나의 {@link EnvTheme} 으로 묶는다.
 */

import type { EnvTheme } from '../../theme.js';
import { KRAS_PARALLAX } from './parallax.js';
import { KRAS_DECALS } from './decals.js';
import { KRAS_TERRAIN_LIGHT } from './terrainLight.js';
import { KRAS_ATMOSPHERE } from './atmosphere.js';
import { KRAS_GRADE } from './grade.js';

export const KRAS_THEME: EnvTheme = {
  id: 'kras',
  name: '크라스 — 파괴 폐허',
  planets: [5],
  /**
   * 광원이 **위**에 있다. 크라스의 장면 조명은 무너진 천장·벽 사이로 들어오는 **흐린 하늘의
   * 확산광**이다 — 바닥의 잔불은 국소 광원일 뿐 장면을 조명하지 않는다(카르곤과 정확히 반대).
   *
   * `angle` = −π/2 + 0.28 이라 방향 벡터가 (0.276, −0.961) — 위쪽이고 오른쪽으로 살짝 기울었다.
   * 데칼과 지형광이 이 한 값을 공유해야 한다: 지형광은 여기서 **수직 성분의 부호만**(−1) 취해
   * 띠의 방향을 정하고, 데칼은 기울기까지 그대로 써서 부조의 림·드롭 섀도를 놓는다.
   * 각자 갖고 있으면 화면에 태양이 둘이 된다.
   *
   * `shadowBias` 0.45 는 카르곤(0.55)보다 낮다. 확산광은 방향성이 약해 그림자가 광원 반대편으로
   * 길게 뻗기보다 **물체 밑에 고인다** — 이 값이 그 물리를 담는 유일한 손잡이다.
   */
  light: { angle: -Math.PI / 2 + 0.28, shadowBias: 0.45 },
  parallax: KRAS_PARALLAX,
  decals: KRAS_DECALS,
  terrainLight: KRAS_TERRAIN_LIGHT,
  atmosphere: KRAS_ATMOSPHERE,
  grade: KRAS_GRADE,
};
