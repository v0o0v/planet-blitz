/**
 * 니플헤임 — 빙원 테마 조합. ⚠️ **Phase 2 스캐폴딩** — 슬라이스 5장이 아직 카르곤 값을 빌려 쓴다.
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
  /** ⚠️ 스캐폴딩 값(카르곤: 아래에서 오는 용암광). 이 행성의 광원 서사로 반드시 다시 정한다. */
  light: { angle: Math.PI / 2 + 0.32, shadowBias: 0.55 },
  parallax: NIFLHEIM_PARALLAX,
  decals: NIFLHEIM_DECALS,
  terrainLight: NIFLHEIM_TERRAIN_LIGHT,
  atmosphere: NIFLHEIM_ATMOSPHERE,
  grade: NIFLHEIM_GRADE,
};
