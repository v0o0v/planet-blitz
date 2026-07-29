/**
 * 테마 레지스트리 — **새 행성 테마는 여기에만 추가한다.**
 *
 * 레이어는 더 이상 자기 행성 인덱스를 알지 않는다. `themeFor(ctx.planet)` 가 `undefined` 면
 * 스스로 꺼진다. 이 한 곳 덕분에 레이어 5장이 각각 갖고 있던 `KARGON = 0` 복제 5개가 사라진다
 * (순환 import 회피용이었는데, 레지스트리를 별도 모듈로 빼면 순환 자체가 없다).
 */

import type { EnvTheme } from '../theme.js';
import { KARGON_THEME } from './kargon/index.js';
import { BERDAN_THEME } from './berdan/index.js';
import { NIFLHEIM_THEME } from './niflheim/index.js';
import { ARKE_THEME } from './arke/index.js';
import { TOXAR_THEME } from './toxar/index.js';
import { KRAS_THEME } from './kras/index.js';

/**
 * 등록된 테마 전부. 테스트가 이 배열을 돌며 계약 검증을 강제한다.
 *
 * **행성 6종이 여기 미리 등록돼 있는 이유는 병렬 레인 때문이다.** 레인마다 이 파일에 한 줄씩
 * 더하게 두면 6개 브랜치가 정확히 같은 줄에서 충돌한다. 등록을 선행 커밋으로 끝내 두면 각
 * 레인이 소유하는 파일이 `themes/<planet>/` 와 `scripts/tileset-profiles/<planet>.mjs` 뿐이라
 * **충돌이 구조적으로 불가능**해진다.
 */
export const ENV_THEMES: readonly EnvTheme[] = [
  KARGON_THEME,
  BERDAN_THEME,
  NIFLHEIM_THEME,
  ARKE_THEME,
  TOXAR_THEME,
  KRAS_THEME,
];

/** 행성 인덱스 → 테마. 담당 테마가 없으면 `undefined`(레이어가 스스로 꺼진다). */
export function themeFor(planet: number): EnvTheme | undefined {
  for (const t of ENV_THEMES) if (t.planets.includes(planet)) return t;
  return undefined;
}
