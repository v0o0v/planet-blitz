/**
 * 팝업 제목 밴드 계약 — **제목과 본문이 겹칠 수 없다**.
 *
 * `makeModal` 은 제목을 콘텐츠 상자 좌상단(`box.x, box.y`)에 놓는다. 그래서 호출자가 본문도
 * `box.y` 에 놓으면 두 글자 덩어리가 **정확히 같은 y** 에 겹쳐 둘 다 못 읽게 된다 — 파일럿 파일
 * 팝업에서 실제로 일어난 결함이다(사용자 신고 2026-07-26: "파일럿 파일과 그 밑에 글자가 겹쳐
 * 보여. 다른 캐릭터들도 마찬가지야" — 태그라인이 제목 위에 덮쳤고, 초상 스프라이트도 같은 y
 * 였지만 위쪽이 투명해 겹침이 눈에 덜 띄었다).
 *
 * 다른 팝업들은 각자 `box.y + 40`~`+60` 을 눈대중으로 박아 두고 우연히 피해 있었다. 관례를
 * 모르는 새 팝업이 다시 겹치는 것을 막으려면 관례가 아니라 **상수 + 부등식**이어야 한다. 그래서
 * `MODAL_TITLE_BAND` 를 정본으로 올리고 이 파일이 그 값 자체의 타당성을 못 박는다 —
 * 밴드가 제목 글자 높이보다 실제로 크고, `modalBodyTop` 이 정확히 그만큼 내려온다.
 *
 * ⚠️ 옛 "파일럿 파일 팝업 기하" 블록은 2026-08-03 기록 보관소 AAA 전환에서 지웠다. 그 팝업
 * (`storyModal.ts`)의 소비처가 기록 보관소 하나뿐이었는데 그 화면이 팝업을 **2열 상세**로
 * 대체하면서 모듈이 사라졌기 때문이다. 나무 `makeModal` 을 쓰는 다른 화면들의 회귀 가드는
 * 위 두 단언이 그대로 맡는다.
 *
 * Pixi 표시 객체를 만들지 않는다 — vitest 는 node 환경이라 `Text`/`Sprite` 를 만들 수 없다.
 * 순수 상수·순수 함수만 대조하는 방식은 `tests/defenseCommandPixi.test.ts` 의 크롬 밴드 부등식
 * 테스트와 같은 선례를 따른다.
 */

import { describe, it, expect } from 'vitest';
import { MODAL_TITLE_BAND, MODAL_CLOSE_SIZE, modalBodyTop } from '../src/ui/pixi/modal.js';
import { panelContent } from '../src/ui/pixi/nineSlicePanel.js';

/** `makeModal` 의 제목 글자 크기(modal.ts 의 Text style 과 같은 값). */
const TITLE_FONT_SIZE = 26;

describe('팝업 제목 밴드 상수', () => {
  it('제목 글자 높이보다 크다 — 본문이 밴드 아래면 겹칠 수 없다', () => {
    // 26px 글자의 실제 렌더 높이는 폰트 메트릭 때문에 fontSize 보다 크다(어센더+디센더+행간).
    // 그 여유까지 덮어야 "밴드 아래 = 안 겹침" 이 성립하므로 fontSize 보다 넉넉히 커야 한다.
    expect(MODAL_TITLE_BAND).toBeGreaterThan(TITLE_FONT_SIZE);
    // 닫기 아이콘(box.y - 4 에 놓인다)도 이 밴드 안에서 끝나야 제목 줄이 한 밴드로 닫힌다.
    expect(MODAL_TITLE_BAND).toBeGreaterThanOrEqual(MODAL_CLOSE_SIZE - 4);
  });

  it('modalBodyTop 은 콘텐츠 상자 위쪽에서 정확히 밴드만큼 내려온 지점이다', () => {
    const box = panelContent(900, 700);
    expect(modalBodyTop(box)).toBe(box.y + MODAL_TITLE_BAND);
    // 본문 시작점은 제목이 놓인 y(=box.y)보다 반드시 아래다 — 이것이 겹침 불가의 핵심.
    expect(modalBodyTop(box)).toBeGreaterThan(box.y);
  });
});
