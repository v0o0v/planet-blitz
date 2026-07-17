/**
 * 도발 스티커 사전 세트 (M4 Phase F2, AC12 · GDD §8 · di-fun-factors #8).
 *
 * 채팅·자유 입력 없는 비동기 PvP 도발 수단. 침공/방어 **성공한 쪽**이 12종 중 1개를 골라
 * 상대 알림에 남긴다(자유 입력 금지 — 독성·검열 비용 차단, fun-factors Constraints).
 *
 * ── 톤(확정, OQ-M4-6) ── "가벼운 유머·도발, 조롱·모욕 아님". 우주/행성/기지 테마의
 * 장난스러운 승자 멘트로 통일한다. 인신공격·비하·욕설·정치/종교/성적 코드는 배제.
 *
 * ── 인덱스 계약(f-server 합의) ── **배열 위치(0..11) = 서버 저장 smallint**. 서버는
 * 문구 의미를 몰라도 되고 인덱스만 보관한다(정본 문구는 이 파일이 소유). 따라서 이
 * 배열의 **순서를 절대 재배치하지 말 것** — 이미 저장된 스티커의 의미가 어긋난다.
 * 신규 문구는 배열 최후미에만 append(단 12종 고정이므로 확장은 계약 재합의 후).
 *
 * 순수 데이터 + 조회 헬퍼만 둔다(DOM/네트워크 무관 — 테스트 대상).
 */

/** 도발 스티커 1종(사전 세트 항목). */
export interface Sticker {
  /** 안정적 식별자(디버그·로그용 — 인덱스가 계약이지만 가독 id 병기). */
  id: string;
  /** 그리드·알림에 표시할 이모지(단일 글리프). */
  emoji: string;
  /** 상대 알림에 표시되는 한글 도발 문구(승자 멘트, 가벼운 유머). */
  text: string;
}

/**
 * 사전 세트 12종(순서 = 인덱스 계약, 재배치 금지). 승자가 패자에게 남기는 장난 멘트로
 * 통일 — 공격 성공(코어 파괴)·방어 성공(격퇴) 어느 쪽이 달아도 자연스럽게 읽힌다.
 */
export const STICKERS: readonly Sticker[] = [
  { id: 'good-game', emoji: '🤝', text: 'GG! 다음 판도 부탁해' },
  { id: 'nice-try', emoji: '😎', text: '잘 싸웠다 — 그래도 내가 이겼지만' },
  { id: 'galaxy-small', emoji: '🌌', text: '은하가 좁네, 또 보자고' },
  { id: 'lock-door', emoji: '🔒', text: '다음엔 문 좀 잠가두렴' },
  { id: 'five-stars', emoji: '⭐', text: '네 기지 별점 5개! (돌파 난이도 별점 아님)' },
  { id: 'maintenance', emoji: '🔧', text: '정비도 좀 챙기지 그랬어' },
  { id: 'sightseeing', emoji: '🚀', text: '행성 관광 잘 마쳤습니다' },
  { id: 'turret-regards', emoji: '📡', text: '우리 포탑이 안부 전하래' },
  { id: 'take-a-seat', emoji: '☕', text: '앉아서 커피 한 잔 하고 갈걸' },
  { id: 'rematch-anytime', emoji: '⏳', text: '복수? 얼마든지 기다릴게' },
  { id: 'core-walk', emoji: '💠', text: '코어까지 산책 편했다' },
  { id: 'safe-travels', emoji: '🛰️', text: '돌아가는 길 조심하고' },
] as const;

/** 사전 세트 크기(계약 고정: 12종). */
export const STICKER_COUNT = STICKERS.length;

/** 인덱스가 유효한 스티커 코드(정수 0..11)인지(순수). */
export function isValidStickerIndex(index: unknown): index is number {
  return (
    typeof index === 'number' &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < STICKER_COUNT
  );
}

/**
 * 인덱스 → 스티커. 범위 밖/비정수/null 이면 null(서버가 준 값이 손상됐거나 미설정일 때
 * 방어적으로 처리 — 알림에서 스티커 없음으로 표시).
 */
export function stickerByIndex(index: unknown): Sticker | null {
  if (!isValidStickerIndex(index)) return null;
  return STICKERS[index] ?? null;
}

/** 알림 한 줄용 표시 문자열("emoji text"). 미설정/손상은 빈 문자열. */
export function stickerLabel(index: unknown): string {
  const s = stickerByIndex(index);
  return s !== null ? `${s.emoji} ${s.text}` : '';
}
