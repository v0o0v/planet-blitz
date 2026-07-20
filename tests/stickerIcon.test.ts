/**
 * 도발 스티커 아이콘 매핑 검증 (관제탑 알림 아이콘 배선).
 *
 * `stickerIconName` 은 UI-독립 순수 함수라(인덱스 → basename 문자열) 단위 테스트로 고정한다.
 * 로더가 실제로 파일을 잡는지는 `UI_ASSET_NAMES` 등재 여부로만 확인한다 — 스프라이트 배치는
 * 브라우저 수동 확인 몫. 자산 PNG 가 아직 없어도 통과해야 한다(파일 존재를 보지 않는다).
 */

import { describe, it, expect } from 'vitest';
import { STICKERS, STICKER_COUNT } from '../data/stickers.js';
import { UI_ASSET_NAMES, stickerIconName } from '../src/ui/pixi/uiTextures.js';

describe('stickerIconName', () => {
  it('maps every sticker index to a snake_case basename', () => {
    expect(stickerIconName(0)).toBe('sticker_good_game.png');
    expect(stickerIconName(4)).toBe('sticker_five_stars.png');
    expect(stickerIconName(STICKER_COUNT - 1)).toBe('sticker_safe_travels.png');
  });

  it('derives the name from the sticker id for all 12 entries', () => {
    STICKERS.forEach((s, i) => {
      expect(stickerIconName(i)).toBe(`sticker_${s.id.replace(/-/g, '_')}.png`);
    });
  });

  it('registers every sticker icon in the UI texture loader list', () => {
    const registered = new Set<string>(UI_ASSET_NAMES);
    for (let i = 0; i < STICKER_COUNT; i += 1) {
      const name = stickerIconName(i);
      expect(name).not.toBeNull();
      expect(registered.has(name as string)).toBe(true);
    }
  });

  it('returns null for missing or corrupted indices (fallback to text)', () => {
    expect(stickerIconName(null)).toBeNull();
    expect(stickerIconName(undefined)).toBeNull();
    expect(stickerIconName(-1)).toBeNull();
    expect(stickerIconName(STICKER_COUNT)).toBeNull();
    expect(stickerIconName(1.5)).toBeNull();
    expect(stickerIconName('0')).toBeNull();
  });
});
