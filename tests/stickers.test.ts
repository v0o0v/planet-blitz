/**
 * 도발 스티커 사전 세트 검증 (data/stickers.ts — M4 Phase F2, AC12).
 *
 * 인덱스 계약(배열 위치=서버 smallint) + 방어적 조회 헬퍼 + 톤/형식 일관성을 검증한다.
 */

import { describe, it, expect } from 'vitest';
import {
  STICKERS,
  STICKER_COUNT,
  isValidStickerIndex,
  stickerByIndex,
  stickerLabel,
} from '../data/stickers.js';

describe('스티커 사전 세트 — 계약', () => {
  it('정확히 12종(자유 입력 금지·고정 세트)', () => {
    expect(STICKER_COUNT).toBe(12);
    expect(STICKERS).toHaveLength(12);
  });

  it('모든 항목이 id·emoji·text 를 갖고 문구가 비어 있지 않다', () => {
    for (const s of STICKERS) {
      expect(typeof s.id).toBe('string');
      expect(s.id.length).toBeGreaterThan(0);
      expect(s.emoji.length).toBeGreaterThan(0);
      expect(s.text.length).toBeGreaterThan(0);
    }
  });

  it('id 가 전부 고유(디버그 식별자 충돌 없음)', () => {
    const ids = new Set(STICKERS.map((s) => s.id));
    expect(ids.size).toBe(STICKER_COUNT);
  });
});

describe('스티커 인덱스 검증(순수)', () => {
  it('isValidStickerIndex: 정수 0..11 만 통과', () => {
    expect(isValidStickerIndex(0)).toBe(true);
    expect(isValidStickerIndex(11)).toBe(true);
    expect(isValidStickerIndex(12)).toBe(false);
    expect(isValidStickerIndex(-1)).toBe(false);
    expect(isValidStickerIndex(3.5)).toBe(false);
    expect(isValidStickerIndex('2')).toBe(false);
    expect(isValidStickerIndex(null)).toBe(false);
    expect(isValidStickerIndex(undefined)).toBe(false);
    expect(isValidStickerIndex(NaN)).toBe(false);
  });
});

describe('스티커 조회 헬퍼(순수·방어적)', () => {
  it('stickerByIndex: 유효 인덱스는 해당 항목, 그 외 null', () => {
    expect(stickerByIndex(0)).toBe(STICKERS[0]);
    expect(stickerByIndex(11)).toBe(STICKERS[11]);
    expect(stickerByIndex(99)).toBeNull();
    expect(stickerByIndex(-3)).toBeNull();
    expect(stickerByIndex(null)).toBeNull();
    expect(stickerByIndex('x')).toBeNull();
  });

  it('stickerLabel: "emoji text" / 손상·미설정은 빈 문자열', () => {
    const first = STICKERS[0]!;
    expect(stickerLabel(0)).toBe(`${first.emoji} ${first.text}`);
    expect(stickerLabel(null)).toBe('');
    expect(stickerLabel(50)).toBe('');
  });
});
