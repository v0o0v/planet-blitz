/**
 * 촉매 효과 줄 → 표시 라벨 (사용자 요청 2026-07-28).
 *
 * `data/catalystSummary.ts` 가 만든 축별 배율 줄을 화면 문구로 옮긴다. 픽커(Pixi)와 런 중
 * 정보판(DOM HUD)이 **같은 문구**를 쓰도록 여기 한 곳에서만 i18n 키를 유도한다 — 두 화면이
 * 각자 매핑을 들고 있으면 한쪽만 고쳐져 "픽커는 적 체력, HUD 는 Enemy HP" 가 된다.
 *
 * 순수 문자열 유도라 Pixi 없이 vitest 로 검증된다(`bossLabels.ts` 와 같은 관례).
 */

import {
  formatCatalystMult,
  type CatalystPenaltyLine,
  type CatalystRewardLine,
} from '../data/catalystSummary.js';
import { t, type MessageKey } from '../i18n/index.js';

/** 표시 한 줄 — 축 이름 + 배율 문자열. 배치(2열/세로)는 소비 측이 정한다. */
export interface CatalystEffectRow {
  readonly label: string;
  /** `+40%` 형태. */
  readonly value: string;
}

/** 페널티 줄 → 라벨+값. */
export function penaltyRow(line: CatalystPenaltyLine): CatalystEffectRow {
  return {
    label: t(`catalyst.pen.${line.axis}` as MessageKey),
    value: formatCatalystMult(line.mult),
  };
}

/**
 * 보상 줄 → 라벨+값. `power` 축만 세부 스탯으로 한 단계 더 갈라진다(`powerStat` 누락은
 * 데이터상 불가능하지만, 방어적으로 damage 로 되돌린다 — `catalystIconFallbackKey` 와 같은 규율).
 */
export function rewardRow(line: CatalystRewardLine): CatalystEffectRow {
  const key =
    line.axis === 'power'
      ? `catalyst.rew.power.${line.powerStat ?? 'damage'}`
      : `catalyst.rew.${line.axis}`;
  return { label: t(key as MessageKey), value: formatCatalystMult(line.mult) };
}
