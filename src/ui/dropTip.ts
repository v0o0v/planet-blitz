/**
 * 정산 획득 장비 hover 상세 팝업 내용(사용자 요청 2026-07-26).
 *
 * 화면(`src/ui/pixi/resultOverlay.ts`)에서 분리해 둔 **순수 함수**다. 툴팁이 무엇을 보여주는지가
 * 이 기능의 전부인데, Pixi 표시 객체는 vitest(node 환경)에서 만들 수 없어 화면 클래스로는 그걸
 * 검증할 수 없다. 그래서 내용 조립만 여기로 내려 테스트가 직접 부른다(방어 사령부 테스트와 같은
 * 규율 — "화면을 떠받치는 순수 계층을 노출해 검증한다").
 *
 * 순수 UI 레이어 — sim·세이브를 쓰지 않는다(읽기만).
 */

import { t, type MessageKey } from '../i18n/index.js';
import { affixLines } from './affixText.js';
import { requiredLevel } from '../items/requiredLevel.js';
import { itemCombatPower } from '../save/combatPower.js';
import { dropName, type ResultDrop } from './resultOverlay.js';
import type { TooltipContent } from './pixi/tooltip.js';
import { RARITY_COLOR_NUM } from './pixi/theme.js';

/** 요구 레벨 줄 색 — 충족(무채색) / 미달(빨강). 격납고 툴팁과 같은 값. */
const REQ_MET_COLOR = 0x8896b8;
const REQ_UNMET_COLOR = 0xff5a5a;

/**
 * 드랍 1개의 툴팁 내용.
 *
 * 실물 아이템(`ResultDrop.item`)이 실려 있으면 격납고 툴팁과 **같은 정보**를 낸다 — 어픽스
 * 제목·설명 줄, 요구 레벨(파일럿 레벨 대비 충족 색), 전투력. 아이템이 없으면(구 경로·픽스처)
 * 제목·부제만 남는 기존 최소 표시로 내려앉는다.
 *
 * `pilotLevel` 은 요구 레벨 충족 판정용 활성 기체 레벨(정산 `ResultState.level`).
 */
export function dropTipContent(d: ResultDrop, pilotLevel: number): TooltipContent {
  const title = dropName(d);
  const slot = t(`item.slot.${d.slot}` as MessageKey);
  const rarity = t(`item.rarity.${d.rarity}` as MessageKey);
  const item = d.item;

  // 요구 레벨은 유니크 미저작 시 LOUD-FAIL(throw) 하는 계약이다(requiredLevel 주석). 정산은 런
  // 직후 한 번뿐인 화면이라 툴팁 하나 때문에 화면 전체가 죽으면 안 되므로 여기서 감싸 생략한다.
  let reqLine: { text: string; color: number } | undefined;
  if (item !== undefined) {
    try {
      const req = requiredLevel(item);
      reqLine = {
        text: t('item.reqLevel', { n: req }),
        color: pilotLevel >= req ? REQ_MET_COLOR : REQ_UNMET_COLOR,
      };
    } catch {
      reqLine = undefined;
    }
  }

  return {
    title,
    titleColor: RARITY_COLOR_NUM[d.rarity],
    // 비무기 슬롯은 제목이 곧 슬롯명이라 부제에 또 적으면 "코어 / 코어 · 매직"이 된다.
    // 주무기만 제목이 무기 종류("발칸")라 슬롯을 함께 알려 줄 값이 있다.
    subtitle: title === slot ? rarity : `${slot} · ${rarity}`,
    reqLine,
    lines: item !== undefined ? affixLines(item.affixes) : [],
    // 전투력은 어픽스 아래 별도 요약 줄(툴팁의 `compare` 자리 — 무채색 마무리 줄).
    compare: item !== undefined ? t('result.tip.power', { n: itemCombatPower(item) }) : undefined,
  };
}
