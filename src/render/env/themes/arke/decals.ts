/**
 * ⚠️ **Phase 2 스캐폴딩** — 카르곤 값을 그대로 빌려 쓰는 임시 자리다.
 * 이 행성 레인이 이 파일을 **통째로** 대체한다(카르곤 주석은 카르곤 실측이므로 복사하지 마라).
 * 이게 남으면 "아르케 — 유적 인데 화산색"이 된다 — 레인 완료 판정에 이 주석의 부재를 포함한다.
 */

import type { DecalTheme } from '../../contracts/decals.js';
import { KARGON_DECALS } from '../kargon/decals.js';

export const ARKE_DECALS: DecalTheme = { ...KARGON_DECALS, themeId: 'arke' };
