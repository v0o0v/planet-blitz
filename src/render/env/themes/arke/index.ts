/**
 * 아르케 — 유적 테마 조합. ⚠️ **Phase 2 스캐폴딩** — 슬라이스 5장이 아직 카르곤 값을 빌려 쓴다.
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
  /** ⚠️ 스캐폴딩 값(카르곤: 아래에서 오는 용암광). 이 행성의 광원 서사로 반드시 다시 정한다. */
  light: { angle: Math.PI / 2 + 0.32, shadowBias: 0.55 },
  parallax: ARKE_PARALLAX,
  decals: ARKE_DECALS,
  terrainLight: ARKE_TERRAIN_LIGHT,
  atmosphere: ARKE_ATMOSPHERE,
  grade: ARKE_GRADE,
};
