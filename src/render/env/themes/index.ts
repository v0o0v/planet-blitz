/**
 * 테마 레지스트리 — **새 행성 테마는 여기에만 추가한다.**
 *
 * 레이어는 더 이상 자기 행성 인덱스를 알지 않는다. `themeFor(ctx.planet)` 가 `undefined` 면
 * 스스로 꺼진다. 이 한 곳 덕분에 레이어 5장이 각각 갖고 있던 `KARGON = 0` 복제 5개가 사라진다
 * (순환 import 회피용이었는데, 레지스트리를 별도 모듈로 빼면 순환 자체가 없다).
 */

import type { EnvTheme } from '../theme.js';
import { KARGON_THEME } from './kargon/index.js';

/** 등록된 테마 전부. 테스트가 이 배열을 돌며 계약 검증을 강제한다. */
export const ENV_THEMES: readonly EnvTheme[] = [KARGON_THEME];

/** 행성 인덱스 → 테마. 담당 테마가 없으면 `undefined`(레이어가 스스로 꺼진다). */
export function themeFor(planet: number): EnvTheme | undefined {
  for (const t of ENV_THEMES) if (t.planets.includes(planet)) return t;
  return undefined;
}
