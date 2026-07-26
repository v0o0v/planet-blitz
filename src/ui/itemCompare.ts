/**
 * 장비 비교 — 후보 아이템 vs 현재 장착 (사용자 요청 2026-07-27).
 *
 * ## 왜 필요했는가
 * 격납고 툴팁의 비교는 `장착 중: 코어 (어픽스 3개)` 한 줄이 전부였다. 어픽스 **개수**는
 * 좋고 나쁨을 말해 주지 않는다 — 어픽스 3개짜리 노말이 2개짜리 레어보다 나을 수도, 아닐 수도
 * 있고, 그 판단에 필요한 건 "무슨 수치가 얼마나 오르내리는가"다. 그래서 스탯별 증감을 낸다.
 *
 * ## 무엇을 비교하는가
 * 두 아이템의 어픽스를 **stat 단위로 합산**해 뺀다(같은 stat 의 어픽스가 여럿이면 더한다).
 * 한쪽에만 있는 stat 은 상대를 0 으로 본다 — 그래야 "장착 장비에만 있던 이속이 사라진다"가
 * 보인다. 증가는 초록, 감소는 빨강, 동일은 회색이다.
 *
 * 전투력(`itemCombatPower`)은 종합 한 줄로 맨 앞에 세운다. 스탯 증감이 엇갈릴 때(공격↑ 생존↓)
 * 최소한의 단일 기준을 주기 위함이다 — 밸런스 판단을 대체하지는 않는다.
 *
 * 순수 UI 레이어 — sim·세이브를 쓰지 않고 상태를 바꾸지 않는다(ADR-0005). Pixi/DOM 미의존이라
 * 두 판 화면이 같은 결과를 쓰고, 테스트가 직접 부른다.
 */

import type { AffixRoll, Item, StatKey } from '../items/types.js';
import { t } from '../i18n/index.js';
import { statLabel, statValueText } from './affixText.js';
import { itemCombatPower } from '../save/combatPower.js';

/** 비교 한 줄(색 포함 — 툴팁이 그대로 그린다). */
export interface CompareLine {
  text: string;
  color: number;
}

/** 증가(초록) · 감소(빨강) · 동일(회색). 격납고 팔레트와 정합. */
export const COMPARE_UP_COLOR = 0x6ee7a0;
export const COMPARE_DOWN_COLOR = 0xff7a6a;
export const COMPARE_SAME_COLOR = 0x8896b8;

/** 어픽스 목록을 stat 단위 합계로 접는다(같은 stat 이 여럿이면 더한다). */
export function statTotals(affixes: readonly AffixRoll[]): Map<StatKey, number> {
  const out = new Map<StatKey, number>();
  for (const a of affixes) out.set(a.stat, (out.get(a.stat) ?? 0) + a.value);
  return out;
}

/**
 * 증감 표기(`피해량 ▲ 8%`). 단위 서식은 `statValueText` 와 동일 규칙을 쓴다.
 *
 * ⚠️ **플래그 stat**(수치가 의미 없는 켜짐 표식 — 냉기)은 `statValueText` 가 빈 문자열을 내므로
 * 그대로 쓰면 `냉기 ▲ ` 처럼 화살표 뒤가 비어 버린다(실측). 그런 stat 은 수치 대신 "추가/사라짐"
 * 으로 말한다 — 켜짐/꺼짐이 곧 변화의 전부이기 때문이다.
 */
function deltaText(stat: StatKey, delta: number): string {
  const magnitude = statValueText(stat, Math.abs(delta)).replace(/^\+/, '');
  if (magnitude === '') return delta > 0 ? t('inv.tip.compareAdded') : t('inv.tip.compareLost');
  return `${delta > 0 ? '▲' : '▼'} ${magnitude}`;
}

/**
 * 후보 아이템을 장착 중인 아이템과 비교한 줄 목록.
 *
 * `equipped` 가 없거나(빈 슬롯) 후보와 같은 아이템이면 **빈 배열**을 낸다 — 비교할 것이 없을 때
 * 억지로 줄을 만들지 않는다(호출측은 빈 배열이면 비교 블록 자체를 생략한다).
 */
export function compareLines(candidate: Item, equipped: Item | undefined): CompareLine[] {
  if (equipped === undefined || equipped.id === candidate.id) return [];

  const lines: CompareLine[] = [];
  lines.push({ text: t('inv.tip.compareTitle'), color: COMPARE_SAME_COLOR });

  // 종합 전투력 — 스탯 증감이 엇갈릴 때의 단일 기준. 0 은 `0` 이 아니라 `±0` 으로 적는다
  // (실측에서 "전투력 0" 이 "전투력이 0" 으로 읽혔다 — 델타라는 것이 드러나야 한다).
  const dPower = itemCombatPower(candidate) - itemCombatPower(equipped);
  lines.push({
    text: t('inv.tip.comparePower', {
      n: dPower > 0 ? `+${dPower}` : dPower < 0 ? `${dPower}` : '±0',
    }),
    color: dPower > 0 ? COMPARE_UP_COLOR : dPower < 0 ? COMPARE_DOWN_COLOR : COMPARE_SAME_COLOR,
  });

  const mine = statTotals(candidate.affixes);
  const theirs = statTotals(equipped.affixes);
  // 후보에 있는 stat 을 먼저(등장 순), 그다음 장착에만 있는 stat 을 붙인다 — 후보 중심으로 읽힌다.
  const order: StatKey[] = [...mine.keys()];
  for (const s of theirs.keys()) if (!mine.has(s)) order.push(s);

  for (const stat of order) {
    const a = mine.get(stat) ?? 0;
    const b = theirs.get(stat) ?? 0;
    const delta = a - b;
    if (delta === 0) continue; // 같은 값은 판단에 기여하지 않는다 — 줄만 늘린다.
    lines.push({
      text: `${statLabel(stat)} ${deltaText(stat, delta)}`,
      color: delta > 0 ? COMPARE_UP_COLOR : COMPARE_DOWN_COLOR,
    });
  }

  // 증감이 하나도 없으면(전투력 동일 + 스탯 동일) 그 사실을 한 줄로 말한다.
  if (lines.length === 2 && dPower === 0) {
    lines.push({ text: t('inv.tip.compareSame'), color: COMPARE_SAME_COLOR });
  }
  return lines;
}
