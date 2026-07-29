/**
 * 톡사르 — 오염 늪 테마 조합. 레이어 슬라이스 5장을 하나의 {@link EnvTheme} 으로 묶는다.
 */

import type { EnvTheme } from '../../theme.js';
import { TOXAR_PARALLAX } from './parallax.js';
import { TOXAR_DECALS } from './decals.js';
import { TOXAR_TERRAIN_LIGHT } from './terrainLight.js';
import { TOXAR_ATMOSPHERE } from './atmosphere.js';
import { TOXAR_GRADE } from './grade.js';

export const TOXAR_THEME: EnvTheme = {
  id: 'toxar',
  name: '톡사르 — 오염 늪',
  planets: [4],
  /**
   * 광원이 **아래**에 있다. 톡사르는 지형 저지에 고인 독성 웅덩이·개천이 유일한 광원이고
   * 하늘은 두꺼운 독무에 덮여 빛을 내려보내지 않는다. 데칼과 지형광이 이 한 값을 공유해야
   * 한다 — 각자 갖고 있으면 화면에 태양이 둘이 된다.
   *
   * 카르곤(π/2 + 0.32)과 기울기 부호가 반대인 것은 이 행성 서사가 아니라 **두 행성이 같아
   * 보이지 않게 하기 위한 선택**이고, 수직 성분이 같은 부호(아래)인 것이 서사다 —
   * 지형광은 광원을 수직축에 투영해 쓰므로 그쪽이 뒤집히면 발광 방향이 통째로 뒤집힌다.
   *
   * `shadowBias` 는 카르곤(0.55)보다 낮다. 늪의 두꺼운 공기가 빛을 산란시켜 그림자가 광원
   * 반대쪽으로 덜 쏠리고 접지 쪽에 더 붙기 때문이다.
   */
  light: { angle: Math.PI / 2 - 0.24, shadowBias: 0.38 },
  parallax: TOXAR_PARALLAX,
  decals: TOXAR_DECALS,
  terrainLight: TOXAR_TERRAIN_LIGHT,
  atmosphere: TOXAR_ATMOSPHERE,
  grade: TOXAR_GRADE,
};
