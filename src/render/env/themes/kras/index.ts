/**
 * 크라스 — 파괴 폐허 테마 조합. ⚠️ **Phase 2 스캐폴딩** — 슬라이스 5장이 아직 카르곤 값을 빌려 쓴다.
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
  /** ⚠️ 스캐폴딩 값(카르곤: 아래에서 오는 용암광). 이 행성의 광원 서사로 반드시 다시 정한다. */
  light: { angle: Math.PI / 2 + 0.32, shadowBias: 0.55 },
  parallax: KRAS_PARALLAX,
  decals: KRAS_DECALS,
  terrainLight: KRAS_TERRAIN_LIGHT,
  atmosphere: KRAS_ATMOSPHERE,
  grade: KRAS_GRADE,
};
