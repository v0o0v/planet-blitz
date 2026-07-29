/**
 * 베르단 — 산성 습지 테마 조합. ⚠️ **Phase 2 스캐폴딩** — 슬라이스 5장이 아직 카르곤 값을 빌려 쓴다.
 */

import type { EnvTheme } from '../../theme.js';
import { BERDAN_PARALLAX } from './parallax.js';
import { BERDAN_DECALS } from './decals.js';
import { BERDAN_TERRAIN_LIGHT } from './terrainLight.js';
import { BERDAN_ATMOSPHERE } from './atmosphere.js';
import { BERDAN_GRADE } from './grade.js';

export const BERDAN_THEME: EnvTheme = {
  id: 'berdan',
  name: '베르단 — 산성 습지',
  planets: [1],
  /** ⚠️ 스캐폴딩 값(카르곤: 아래에서 오는 용암광). 이 행성의 광원 서사로 반드시 다시 정한다. */
  light: { angle: Math.PI / 2 + 0.32, shadowBias: 0.55 },
  parallax: BERDAN_PARALLAX,
  decals: BERDAN_DECALS,
  terrainLight: BERDAN_TERRAIN_LIGHT,
  atmosphere: BERDAN_ATMOSPHERE,
  grade: BERDAN_GRADE,
};
