/**
 * BGM 존 디렉터 검증 (src/render/musicDirector — Phase 3 bgm-zone, AC4·AC6·AC7·R6).
 *
 * node 환경엔 AudioContext 가 없어 WebAudio 재생 자체는 검증 불가다. 대신 존 전환 판정을
 * 순수 함수({@link shouldSwitchZone})로 추출해 단언하고, MusicDirector 는 mock GameAudio 를
 * 주입해 (a) ctx 미준비 핸드셰이크, (b) 보스존 최소 유지 가드, (c) 트랙 부재 시 graceful
 * 무음(throw 없음)을 검증한다. 실제 오디오·매니페스트 URL 은 glob 이 test 환경에서 빈 집합을
 * 돌려주므로 전부 "무음" 경로로 흐른다 — 이것이 곧 placeholder 출시 상태의 실 시나리오다.
 */

import { describe, it, expect } from 'vitest';
import {
  MusicDirector,
  shouldSwitchZone,
  TRACK_MANIFEST,
  MUSIC_ZONES,
  type TrackKey,
} from '../src/render/musicDirector.js';
import type { GameAudio } from '../src/render/audio.js';

/** 매크로태스크 1틱 대기(비동기 loadBuffer/fetchBytes 체인을 settle). */
const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));

/** currentTime 을 외부에서 조작 가능한 mock AudioContext. */
function mockCtx(clock: { t: number }): AudioContext {
  return {
    get currentTime(): number {
      return clock.t;
    },
  } as unknown as AudioContext;
}

/** getContext/getBus/unlock 만 노출하는 mock GameAudio(P1 계약 표면). */
function mockAudio(getCtx: () => AudioContext | null): GameAudio {
  return {
    getContext: getCtx,
    getBus: () => null,
    unlock: () => {},
  } as unknown as GameAudio;
}

describe('shouldSwitchZone (보스존 최소 유지 가드, 순수)', () => {
  const HOLD = 6;

  it('같은 존이면 false(멱등)', () => {
    expect(shouldSwitchZone('combatPvE', 'combatPvE', 0, 100, HOLD)).toBe(false);
    expect(shouldSwitchZone('boss', 'boss', 0, 0, HOLD)).toBe(false);
  });

  it('보스 진입 직후 다른 존 전환 요청은 false(유지)', () => {
    // 진입 시각 100, 현재 101 → 경과 1 < 6 → 유지.
    expect(shouldSwitchZone('boss', 'combatPvE', 100, 101, HOLD)).toBe(false);
  });

  it('보스 최소 유지시간 경과 후 전환 요청은 true', () => {
    // 진입 100, 현재 107 → 경과 7 >= 6 → 전환.
    expect(shouldSwitchZone('boss', 'combatPvE', 100, 107, HOLD)).toBe(true);
  });

  it('비-보스 존은 최소 유지 가드 없이 즉시 전환', () => {
    expect(shouldSwitchZone('combatPvE', 'invasion', 100, 100.1, HOLD)).toBe(true);
    expect(shouldSwitchZone('menu', 'combatPvE', 100, 100, HOLD)).toBe(true);
  });

  it('현재 존 없음(null)이면 전환', () => {
    expect(shouldSwitchZone(null, 'menu', 0, 0, HOLD)).toBe(true);
  });
});

describe('TRACK_MANIFEST / MUSIC_ZONES', () => {
  it('4 존 + 정산 스팅어 2변종 전부 ogg+mp3 항목 보유', () => {
    const keys: TrackKey[] = [
      'menu',
      'combatPvE',
      'boss',
      'invasion',
      'stingerVictory',
      'stingerDefeat',
    ];
    for (const k of keys) {
      const src = TRACK_MANIFEST[k];
      expect(src).toBeDefined();
      expect(src.ogg.endsWith('.ogg')).toBe(true);
      expect(src.mp3.endsWith('.mp3')).toBe(true);
      expect(src.ogg.length).toBeGreaterThan(4);
      expect(src.mp3.length).toBeGreaterThan(4);
    }
    // 매니페스트에 정확히 이 6키만 존재(누락·잉여 없음).
    expect(Object.keys(TRACK_MANIFEST).sort()).toEqual([...keys].sort());
  });

  it('MUSIC_ZONES 는 4개 지속 존', () => {
    expect([...MUSIC_ZONES].sort()).toEqual(['boss', 'combatPvE', 'invasion', 'menu']);
  });
});

describe('MusicDirector — ctx 핸드셰이크', () => {
  it('ctx 미준비 시 setZone 은 throw 없이 큐잉만, unlock 에서 시작', () => {
    let ctx: AudioContext | null = null;
    const md = new MusicDirector(mockAudio(() => ctx));

    expect(() => md.setZone('combatPvE')).not.toThrow();
    expect(md.getZone()).toBe(null); // 큐잉만, 아직 미적용.

    ctx = mockCtx({ t: 0 }); // 첫 제스처로 ctx 준비.
    expect(() => md.unlock()).not.toThrow();
    expect(md.getZone()).toBe('combatPvE'); // 핸드셰이크로 큐잉 존 시작.
  });

  it('unlock 시 pendingZone 없으면 no-op(throw 없음)', () => {
    const md = new MusicDirector(mockAudio(() => mockCtx({ t: 0 })));
    expect(() => md.unlock()).not.toThrow();
    expect(md.getZone()).toBe(null);
  });
});

describe('MusicDirector — 보스존 최소 유지 가드(통합)', () => {
  it('진입 직후 전환 요청은 무시하고, 최소 유지시간 경과 후 전환', () => {
    const clock = { t: 0 };
    const md = new MusicDirector(mockAudio(() => mockCtx(clock)));

    md.setZone('boss');
    expect(md.getZone()).toBe('boss');

    clock.t = 0.001; // 진입 직후(어떤 합리적 minHold 보다 짧음) → 유지.
    md.setZone('combatPvE');
    expect(md.getZone()).toBe('boss');

    clock.t = 10000; // 충분히 경과(어떤 합리적 minHold 보다 김) → 전환.
    md.setZone('combatPvE');
    expect(md.getZone()).toBe('combatPvE');
  });

  it('같은 존 재요청은 멱등(전환 없음)', () => {
    const md = new MusicDirector(mockAudio(() => mockCtx({ t: 0 })));
    md.setZone('menu');
    expect(md.getZone()).toBe('menu');
    md.setZone('menu');
    expect(md.getZone()).toBe('menu');
  });
});

describe('MusicDirector — 트랙 부재 graceful(무음, throw 없음)', () => {
  it('setZone/playStinger/prefetch/stop 모두 throw·unhandled 없음', async () => {
    const md = new MusicDirector(mockAudio(() => mockCtx({ t: 0 })));

    // glob 이 test 환경에서 빈 집합 → trackUrl null → fetch 미도달 → 무음 경로.
    expect(() => md.setZone('boss')).not.toThrow();
    expect(() => md.playStinger('victory')).not.toThrow();
    expect(() => md.playStinger('defeat')).not.toThrow();
    expect(() => md.prefetch('invasion')).not.toThrow();
    expect(() => md.stop()).not.toThrow();

    // 비동기 loadBuffer/fetchBytes 체인이 전부 null 로 settle 되는지(unhandled rejection 없음).
    await flush();
  });

  it('ctx 미준비 상태의 playStinger 는 menu 복귀 의도만 큐잉(throw 없음)', () => {
    let ctx: AudioContext | null = null;
    const md = new MusicDirector(mockAudio(() => ctx));
    expect(() => md.playStinger('victory')).not.toThrow();
    // ctx 준비 후 unlock → 큐잉된 menu 존으로 복귀.
    ctx = mockCtx({ t: 0 });
    md.unlock();
    expect(md.getZone()).toBe('menu');
  });
});
