/**
 * 어픽스 표시 문자열 — 이름·수치·설명 (사용자 피드백 2026-07-26).
 *
 * 이전에는 네 화면(격납고·정제소 Pixi/DOM)이 각자 `${def.name} (${a.stat} +${a.value})` 를
 * 만들어 **raw StatKey 를 그대로** 노출했다(`damagePct +8`). 무엇이 좋아지는지 읽히지 않아
 * 사용자가 이해를 못 했다는 지적이라, 표시명(`피해량`)·수치 서식(`+8%`)·한 줄 설명(`탄이
 * 주는 피해가 8% 증가한다`)을 한곳에서 만들고 네 호출부가 공유한다.
 *
 * ── 결정론(ADR-0005) ── 순수 UI 레이어. sim 은 이 파일을 모른다(i18n 을 import 하므로
 * `src/items/` 가 아니라 `src/ui/` 에 둔다 — sim 이 items 를 읽는 경로와 섞이지 않게).
 */

import type { AffixRoll, StatKey } from '../items/types.js';
import { t, type MessageKey } from '../i18n/index.js';
import { AFFIX_BY_ID } from '../../data/affixes.js';

/**
 * 퍼센트로 읽는 stat 집합. 여기 없는 stat 은 절대값(`+120`)으로 쓴다.
 * `loadout.ts` 의 `applyStatSums` 가 `/100` 배율로 접는 stat 들이 정확히 이 집합이다 —
 * 둘이 어긋나면 툴팁이 실제 효과와 다른 단위를 보여주므로 테스트로 묶어 둔다.
 */
const PERCENT_STATS: ReadonlySet<StatKey> = new Set<StatKey>([
  'damagePct',
  'fireRatePct',
  'bulletSpeedPct',
  'moveSpeedPct',
  'maxHpPct',
  'dashCdPct',
  'magnetPct',
  'xpPct',
  'mineralFindPct',
]);

/**
 * 수치가 의미를 갖지 않는 stat(켜짐 표식). 냉기(`coldSlow`)는 값이 항상 1 인 불리언 게이트라
 * (`data/affixes.ts` 주석 — 감속 배율·지속은 `status.ts` 상수 고정) `+1` 을 보여주면 오히려
 * 오해를 만든다. 이런 stat 은 수치 없이 이름만 쓰고 설명이 실제 효과를 말한다.
 */
const FLAG_STATS: ReadonlySet<StatKey> = new Set<StatKey>(['coldSlow']);

/**
 * ADR-0049 스킬 어픽스 3종 → 담당 축(`TreeAffinity`). `PERCENT_STATS`/`FLAG_STATS` 어느
 * 쪽에도 넣지 않는다 — 값이 1 vs 2 로 의미를 갖는 정수 레벨이라 `+1`/`+2` 그대로 보여준다
 * (레인 3 지시). 격납고 툴팁이 "그 축 투자가 0이면 무효과"를 표시할 때만 쓰는 조회 테이블이고,
 * `src/items/loadout.ts` 의 `AXIS_SKILL_AFFIX_STAT`(비공개) 와 같은 매핑을 반대 방향으로 든다 —
 * 그쪽을 export 로 바꾸지 않고 여기서 독립적으로 정의한 것은 loadout.ts 가 이 레인의 편집
 * 금지 파일이 아니라도 손대지 않기 위해서다(스코프 최소화).
 */
const SKILL_AXIS_STAT: Readonly<Record<'offense' | 'defense' | 'utility', StatKey>> = {
  offense: 'skillLvOffense',
  defense: 'skillLvDefense',
  utility: 'skillLvUtility',
};
const STAT_SKILL_AXIS = new Map<StatKey, 'offense' | 'defense' | 'utility'>(
  (Object.entries(SKILL_AXIS_STAT) as ['offense' | 'defense' | 'utility', StatKey][]).map(
    ([axis, stat]) => [stat, axis],
  ),
);

/** stat 이 ADR-0049 스킬 축 어픽스면 그 축, 아니면 `undefined`. */
export function skillAxisOfStat(stat: StatKey): 'offense' | 'defense' | 'utility' | undefined {
  return STAT_SKILL_AXIS.get(stat);
}

/** stat 표시명(예: `damagePct` → `피해량`). */
export function statLabel(stat: StatKey): string {
  return t(`stat.${stat}.name` as MessageKey);
}

/** 수치 서식(`+8%` / `+120`). 플래그 stat 은 빈 문자열. */
export function statValueText(stat: StatKey, value: number): string {
  if (FLAG_STATS.has(stat)) return '';
  return PERCENT_STATS.has(stat) ? `+${value}%` : `+${value}`;
}

/** stat 한 줄 설명(수치 치환 포함). */
export function statDesc(stat: StatKey, value: number): string {
  return t(`stat.${stat}.desc` as MessageKey, { n: value });
}

/**
 * 어픽스 제목 줄: `예리한 · 피해량 +8%`. 정의를 못 찾으면(데이터가 줄어든 구 아이템) 표시명과
 * 수치만 남긴다 — 빈 줄 대신 최소 정보를 보여준다.
 */
export function affixTitleLine(roll: AffixRoll): string {
  const def = AFFIX_BY_ID.get(roll.id);
  const stat = `${statLabel(roll.stat)} ${statValueText(roll.stat, roll.value)}`.trim();
  return def !== undefined ? `${def.name} · ${stat}` : stat;
}

/** 어픽스 설명 줄(제목 아래에 붙인다). */
export function affixDescLine(roll: AffixRoll): string {
  return statDesc(roll.stat, roll.value);
}

/**
 * 툴팁용 2줄 묶음(제목 + 설명). Pixi 툴팁은 줄 배열을 그대로 받으므로 여기서 평탄화한다.
 * 설명 줄은 `└` 로 들여써 제목과 시각적으로 묶인다.
 */
export function affixLines(rolls: readonly AffixRoll[]): string[] {
  const out: string[] = [];
  for (const roll of rolls) {
    out.push(affixTitleLine(roll));
    out.push(`└ ${affixDescLine(roll)}`);
  }
  return out;
}

/** 색이 붙은 줄 하나(`PixiTooltip.TooltipContent.lines` 의 확장 원소 형태와 맞춘다). */
export interface AffixLine {
  readonly text: string;
  readonly color?: number;
}

/** 스킬 축 어픽스가 무효(그 축 투자 0)일 때 회색으로 쓰는 색상. */
const INACTIVE_COLOR = 0x6b7390;

/**
 * 격납고 툴팁 전용(설계 ①-10 · 정본 1). 스킬 축 어픽스인데 그 축에 투자가 하나도 없으면
 * 회색 + `hangar.affix.noInvest` 안내를 덧붙인다 — **값을 숨기지 않고 왜 무효과인지 보여준다.**
 * 스킬 축이 아닌 어픽스는 기존 `affixLines` 와 동일하게(무채색) 나온다.
 *
 * @param axisInvested 축 하나의 누적 투자 포인트를 돌려주는 콜백(활성 기체·트리 조회는
 *   호출부(`hangar.ts`)가 `src/items/skills.ts` 의 `axisInvested` 로 계산해 넘긴다 — 이
 *   모듈은 기체/세이브 구조를 모른다).
 */
export function affixLinesForHangar(
  rolls: readonly AffixRoll[],
  axisInvested: (axis: 'offense' | 'defense' | 'utility') => number,
): AffixLine[] {
  const out: AffixLine[] = [];
  for (const roll of rolls) {
    const axis = skillAxisOfStat(roll.stat);
    const inactive = axis !== undefined && axisInvested(axis) <= 0;
    const title = affixTitleLine(roll);
    const desc = affixDescLine(roll);
    if (inactive) {
      out.push({ text: `${title} ${t('hangar.affix.noInvest' as MessageKey)}`, color: INACTIVE_COLOR });
      out.push({ text: `└ ${desc}`, color: INACTIVE_COLOR });
    } else {
      out.push({ text: title });
      out.push({ text: `└ ${desc}` });
    }
  }
  return out;
}
