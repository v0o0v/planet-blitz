/**
 * 행성 보스 표시명 (HUD 체력바 머리글 · 승리 문구).
 *
 * ## 왜 별도 모듈인가
 * 보스 이름은 **런의 행성에서 파생**돼야 한다. 화면마다 문자열을 직접 적으면 한 곳만 고쳐도
 * 다른 곳이 남는데, 실제로 그렇게 됐다 — `src/ui/hud.ts` 의 체력바 머리글과 `result.win.sub`
 * 두 곳이 카르곤 보스를 하드코딩하고 있어 **어느 행성을 돌아도 "카르곤 · 용암 요새 전차"** 가
 * 떴다(사용자 신고 2026-07-27). 유도 규칙을 여기 하나에 둔다.
 *
 * ## 키는 `BossDef.id` 파생이다
 * 행성 레지스트리(`data/planets/index.ts`)가 행성 → 보스를 이미 알고 있으므로, 표시명 키는
 * 그 보스의 `id` 에서 유도한다(`boss.<id>`). 하드코딩 목록을 두면 행성이 늘 때 조용히 빈칸이
 * 된다. 미등재 키는 `tShipKey` 규율대로 slug 자리표시자로 내려앉아 화면에 키가 노출되지 않는다.
 *
 * 순수 문자열 유도(Pixi·DOM 미의존) — 캔버스 없이 테스트한다.
 */

import { planetContent } from '../../data/planets/index.js';
import { t } from '../i18n/index.js';
import { tShipKey, humanizeSlug } from './pixi/shipLabels.js';

/** 보스 표시명(행성 인덱스 → 그 행성 보스). 키 = `boss.<BossDef.id>`. */
export function bossName(planet: number | undefined): string {
  const def = planetContent(planet).boss;
  return tShipKey(`boss.${def.id}`, humanizeSlug(def.id));
}

/** 행성 표시명(성계 지도·HUD 공통 정본 = 콘텐츠 레지스트리). */
export function planetDisplayName(planet: number | undefined): string {
  return planetContent(planet).name;
}

/** 보스 체력바 머리글 = `행성 · 보스`. 런의 행성 인덱스만으로 파생된다. */
export function bossHudName(planet: number | undefined): string {
  return t('boss.hudName', { planet: planetDisplayName(planet), boss: bossName(planet) });
}
