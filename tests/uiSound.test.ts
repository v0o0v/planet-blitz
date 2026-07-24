/**
 * 메타 UI 사운드 훅 검증 (사운드 풍성화 Phase 2 — AC16).
 *
 * playUi 가 주입된 사운드 보드로 의미 범주를 라우팅하는지, 미주입(테스트/부팅 전)이면 조용히
 * no-op 인지 순수 검증한다(AudioContext 없이). PixiButton→playUi 배선은 하네스에서 청감 확인.
 */

import { describe, it, expect, vi } from 'vitest';
import { setUiAudio, playUi } from '../src/render/uiSound.js';
import type { GameAudio } from '../src/render/audio.js';

describe('uiSound 훅(AC16)', () => {
  it('미주입이면 no-op(throw 없음)', () => {
    // setUiAudio 전에는 조용히 무시 — 테스트/부팅 전 안전(이 케이스가 주입보다 먼저 실행돼야 함).
    expect(() => playUi('uiNavigate')).not.toThrow();
    expect(() => playUi()).not.toThrow();
  });

  it('주입 후 카테고리를 audio.play 로 라우팅(기본 navigate)', () => {
    const play = vi.fn();
    setUiAudio({ play } as unknown as GameAudio);
    playUi('uiConfirm');
    expect(play).toHaveBeenLastCalledWith('uiConfirm');
    playUi('uiNegative');
    expect(play).toHaveBeenLastCalledWith('uiNegative');
    playUi(); // 인자 생략 → 기본 navigate.
    expect(play).toHaveBeenLastCalledWith('uiNavigate');
  });
});
