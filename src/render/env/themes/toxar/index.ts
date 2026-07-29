/**
 * 톡사르 — 오염 늪 테마 조합. ⚠️ **Phase 2 스캐폴딩** — 슬라이스 5장이 아직 카르곤 값을 빌려 쓴다.
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
  /** ⚠️ 스캐폴딩 값(카르곤: 아래에서 오는 용암광). 이 행성의 광원 서사로 반드시 다시 정한다. */
  light: { angle: Math.PI / 2 + 0.32, shadowBias: 0.55 },
  parallax: TOXAR_PARALLAX,
  decals: TOXAR_DECALS,
  terrainLight: TOXAR_TERRAIN_LIGHT,
  atmosphere: TOXAR_ATMOSPHERE,
  grade: TOXAR_GRADE,
};
