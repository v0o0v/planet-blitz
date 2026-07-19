/**
 * Pixi 라벨 텍스트 정리 유틸 (카툰나무풍 롤아웃 — 정제소 #3 에서 발견, 행성 선택 #4 에서 공용화).
 *
 * i18n 카탈로그는 DOM 판과 공유한다. DOM 버튼에서는 OS 컬러 이모지로 예쁘게 뜨던 글자가
 * Pixi 캔버스 텍스트(Malgun Gothic 폴백)에서는 **흑백 두부 글리프**로 떨어지므로, 캔버스
 * 화면은 라벨에서만 이모지를 걷어낸다(카탈로그는 건드리지 않는다 — DOM 판 회귀 0).
 */

/**
 * 이모지로 분류되지만 캔버스에서 **정상 렌더되는** 기하 기호들. Unicode 는 ▶(U+25B6)·
 * ◀(U+25C0) 같은 삼각형까지 `Extended_Pictographic` 으로 분류하지만, 이들은 폰트 폴백이
 * 흑백 글리프를 제대로 갖고 있어 두부가 되지 않는다. 방향 표시로 의미가 있으므로 남긴다.
 */
const KEEP = new Set(['▶', '◀', '▲', '▼', '■', '□', '●', '○']);

/**
 * 라벨에서 컬러 이모지를 걷어낸다({@link KEEP} 의 기하 기호는 보존).
 * 이모지 뒤에 붙는 variation selector-16(U+FE0F)과 이모지가 남긴 이중 공백도 함께 정리한다.
 */
export function stripEmoji(s: string): string {
  return s
    .replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, (ch) => (KEEP.has(ch) ? ch : ''))
    .replace(/\s{2,}/g, ' ')
    .trim();
}
