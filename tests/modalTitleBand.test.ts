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
 * `MODAL_TITLE_BAND` 를 정본으로 올리고 이 파일이 두 가지를 못 박는다:
 *   ① 밴드가 제목 글자 높이보다 실제로 크다(밴드 값 자체의 타당성).
 *   ② 파일럿 파일 팝업의 본문 시작점이 밴드 아래다(회귀 가드).
 *
 * Pixi 표시 객체를 만들지 않는다 — vitest 는 node 환경이라 `Text`/`Sprite` 를 만들 수 없다.
 * 순수 상수·순수 함수만 대조하는 방식은 `tests/defenseCommandPixi.test.ts` 의 크롬 밴드 부등식
 * 테스트와 같은 선례를 따른다.
 */

import { describe, it, expect } from 'vitest';
import { MODAL_TITLE_BAND, MODAL_CLOSE_SIZE, modalBodyTop, modalGeometry } from '../src/ui/pixi/modal.js';
import { panelContent } from '../src/ui/pixi/nineSlicePanel.js';
import { PILOT_FILE_MODAL_W, PILOT_FILE_MODAL_H, PILOT_FILE_PORTRAIT } from '../src/ui/pixi/storyModal.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../src/render/app.js';

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

describe('파일럿 파일 팝업 기하 (회귀 가드)', () => {
  const box = panelContent(PILOT_FILE_MODAL_W, PILOT_FILE_MODAL_H);
  const bodyTop = modalBodyTop(box);

  it('초상·태그라인이 제목 밴드 아래에서 시작한다', () => {
    // storyModal 은 초상을 bodyTop 에, 태그라인을 bodyTop + 8 에 놓는다. 둘 다 제목 줄
    // (box.y .. box.y + MODAL_TITLE_BAND) 과 교차하지 않아야 한다.
    expect(bodyTop).toBeGreaterThanOrEqual(box.y + MODAL_TITLE_BAND);
    expect(bodyTop + 8).toBeGreaterThan(box.y + MODAL_TITLE_BAND);
  });

  it('챕터 스크롤 영역이 초상 아래에 실제로 남는다 — 밴드가 본문을 다 먹지 않는다', () => {
    // 챕터 목록 top = bodyTop + 초상 높이 + 여백. 그 아래로 읽을 만한 높이가 남아야 한다.
    const listY = bodyTop + PILOT_FILE_PORTRAIT + 24;
    const listH = box.bottom - listY;
    // 본문 3줄(행간 22)은 최소한 들어가야 스크롤 영역이 의미가 있다.
    expect(listH).toBeGreaterThan(22 * 3);
    // 세로 640 → 700 으로 키운 순증(+60)이 밴드(44)보다 커서, 이전보다 오히려 넓어졌다.
    expect(listH).toBeGreaterThan(640 - 2 * box.y - PILOT_FILE_PORTRAIT - 24);
  });

  it('팝업이 디자인 스페이스 안에 들어간다', () => {
    const geom = modalGeometry(PILOT_FILE_MODAL_W, PILOT_FILE_MODAL_H);
    expect(geom.x).toBeGreaterThanOrEqual(0);
    expect(geom.y).toBeGreaterThanOrEqual(0);
    expect(geom.x + geom.w).toBeLessThanOrEqual(DESIGN_WIDTH);
    expect(geom.y + geom.h).toBeLessThanOrEqual(DESIGN_HEIGHT);
  });
});
