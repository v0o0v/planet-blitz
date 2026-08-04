/**
 * 보스 예고 루프 + CC0 실음원 샘플 매핑 계약 (사용자 지시 2026-08-05).
 *
 * 두 가지를 못 박는다:
 *  ① **순수 곡선** — 언제부터 울리고(시작 임계) 얼마나 빨라지는가. AudioContext 없이 검증된다.
 *  ② **구동기 거동** — 진행도가 낮으면 침묵, 넘으면 즉시 1회 + 간격마다, 보스가 열리면 정지.
 *
 * ⚠️ 이 저장소의 지배적 실패 모드는 "순수 함수는 맞는데 호출부가 안 부른다"이다. 그래서 ②는
 *    실제 `BossWarnLoop.tick` 을 돌려 **재생 호출 횟수**를 센다 — 곡선만 검사하면 루프가 통째로
 *    안 돌아도 초록이 된다.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  BossWarnLoop,
  bossWarnIntensity,
  bossWarnIntervalSec,
  bossWarnGain,
  BOSS_WARN_START_FRAC,
  BOSS_WARN_SLOW_SEC,
  BOSS_WARN_FAST_SEC,
  BOSS_WARN_MIN_GAIN,
  BOSS_WARN_MAX_GAIN,
} from '../src/render/bossWarn.js';
import { sampleKeyFor } from '../src/render/audio.js';
import type { GameAudio } from '../src/render/audio.js';

/** 샘플이 준비된(=실음원이 로드된) 가짜 오디오. 재생 호출을 기록한다. */
function mockAudio(hasSample = true): { audio: GameAudio; playSample: ReturnType<typeof vi.fn> } {
  const playSample = vi.fn(() => true);
  const audio = {
    playSample,
    hasSample: () => hasSample,
  } as unknown as GameAudio;
  return { audio, playSample };
}

describe('보스 예고 — 순수 곡선', () => {
  it('시작 임계 이하는 정확히 0 이다 — 런의 절반이 경보 속이면 긴장이 무뎌진다', () => {
    for (const f of [0, 0.1, 0.5, BOSS_WARN_START_FRAC]) {
      expect(bossWarnIntensity(f), `frac ${f}`).toBe(0);
    }
    expect(bossWarnIntensity(BOSS_WARN_START_FRAC + 0.001)).toBeGreaterThan(0);
  });

  it('임계 위에서 단조 증가하고 진행도 1 에서 정확히 1 이다', () => {
    let prev = 0;
    for (let f = BOSS_WARN_START_FRAC + 0.01; f <= 1; f += 0.01) {
      const cur = bossWarnIntensity(f);
      expect(cur, `frac ${f}`).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
    expect(bossWarnIntensity(1)).toBe(1);
    // 범위 밖·NaN 은 조용히 클램프(표시·연출용이라 던지지 않는다).
    expect(bossWarnIntensity(2)).toBe(1);
    expect(bossWarnIntensity(Number.NaN)).toBe(0);
  });

  it('간격은 좁아지고 게인은 커진다 — 두 축이 반대 방향이어야 "다가온다"가 된다', () => {
    expect(bossWarnIntervalSec(0)).toBe(BOSS_WARN_SLOW_SEC);
    expect(bossWarnIntervalSec(1)).toBe(BOSS_WARN_FAST_SEC);
    expect(BOSS_WARN_FAST_SEC).toBeLessThan(BOSS_WARN_SLOW_SEC);
    expect(bossWarnGain(0)).toBe(BOSS_WARN_MIN_GAIN);
    expect(bossWarnGain(1)).toBe(BOSS_WARN_MAX_GAIN);
    expect(BOSS_WARN_MIN_GAIN).toBeLessThan(BOSS_WARN_MAX_GAIN);
    // 중간값이 두 끝 사이에 있다(선형 보간이 뒤집히지 않았다).
    const mid = bossWarnIntervalSec(0.5);
    expect(mid).toBeLessThan(BOSS_WARN_SLOW_SEC);
    expect(mid).toBeGreaterThan(BOSS_WARN_FAST_SEC);
  });
});

describe('보스 예고 — 구동기(배선 실도달)', () => {
  /** `sec` 초를 60fps 로 흘린다. */
  function run(loop: BossWarnLoop, frac: number | undefined, engaged: boolean, sec: number): void {
    for (let i = 0; i < Math.round(sec * 60); i++) loop.tick(frac, engaged, 1 / 60);
  }

  it('임계 이하에서는 한 번도 울리지 않는다', () => {
    const { audio, playSample } = mockAudio();
    const loop = new BossWarnLoop(audio);
    run(loop, BOSS_WARN_START_FRAC - 0.1, false, 10);
    expect(playSample).not.toHaveBeenCalled();
  });

  it('임계를 넘으면 **그 프레임에 즉시** 한 번 울리고, 이후 간격마다 반복한다', () => {
    const { audio, playSample } = mockAudio();
    const loop = new BossWarnLoop(audio);
    loop.tick(1, false, 1 / 60); // 진입 프레임.
    expect(playSample).toHaveBeenCalledTimes(1);
    expect(playSample).toHaveBeenCalledWith('bossWarn', { gainScale: BOSS_WARN_MAX_GAIN });
    // 최속 간격(0.45s)으로 3초 더 → 대략 3/0.45 ≈ 6~7회 추가.
    run(loop, 1, false, 3);
    const n = playSample.mock.calls.length;
    expect(n).toBeGreaterThanOrEqual(6);
    expect(n).toBeLessThanOrEqual(9);
  });

  it('가까울수록 더 자주 운다 — 같은 시간에 더 많이 울려야 "다가온다"가 성립한다', () => {
    const near = mockAudio();
    const far = mockAudio();
    run(new BossWarnLoop(near.audio), 1, false, 6);
    run(new BossWarnLoop(far.audio), BOSS_WARN_START_FRAC + 0.02, false, 6);
    expect(near.playSample.mock.calls.length).toBeGreaterThan(far.playSample.mock.calls.length);
  });

  it('보스전이 열리면 **즉시** 멈춘다 — 이 정적이 곧 등장 신호다', () => {
    const { audio, playSample } = mockAudio();
    const loop = new BossWarnLoop(audio);
    run(loop, 1, false, 2);
    const before = playSample.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    run(loop, 1, true, 5); // 보스전 개시 후 5초.
    expect(playSample.mock.calls.length, '보스가 나왔는데도 예고가 계속 울린다').toBe(before);
  });

  it('침공 런(진행도 undefined)·관전 억제에서는 돌지 않는다', () => {
    const inv = mockAudio();
    run(new BossWarnLoop(inv.audio), undefined, false, 10);
    expect(inv.playSample).not.toHaveBeenCalled();

    const spec = mockAudio();
    const loop = new BossWarnLoop(spec.audio);
    for (let i = 0; i < 600; i++) loop.tick(1, false, 1 / 60, true);
    expect(spec.playSample).not.toHaveBeenCalled();
  });

  it('실음원이 없으면 아예 돌지 않는다 — 합성음 반복은 없느니만 못하다', () => {
    // Safari 등 ogg 미지원 환경. 같은 합성음이 초당 두 번 울리는 형태가 되면 안 된다.
    const { audio, playSample } = mockAudio(false);
    run(new BossWarnLoop(audio), 1, false, 10);
    expect(playSample).not.toHaveBeenCalled();
  });

  it('reset 후에는 밀린 만큼 몰아 울지 않는다(런 경계 계약)', () => {
    const { audio, playSample } = mockAudio();
    const loop = new BossWarnLoop(audio);
    run(loop, 1, false, 2);
    loop.reset();
    playSample.mockClear();
    loop.tick(1, false, 1 / 60);
    expect(playSample).toHaveBeenCalledTimes(1); // 진입 1회일 뿐, 누적분이 터지지 않는다.
  });
});

describe('실음원 샘플 매핑', () => {
  it('발사음만 무기 종류를 탄다 — 0..4 밖·미지정은 발칸으로 접힌다', () => {
    expect(sampleKeyFor('shot', 0)).toBe('shot0');
    expect(sampleKeyFor('shot', 1)).toBe('shot1');
    expect(sampleKeyFor('shot', 2)).toBe('shot2');
    expect(sampleKeyFor('shot', 3)).toBe('shot3');
    expect(sampleKeyFor('shot', 4)).toBe('shot4');
    // `playShot` 의 default 분기와 **같은 규약**이어야 샘플/합성 어느 쪽이든 같은 소리가 난다.
    expect(sampleKeyFor('shot', undefined)).toBe('shot0');
    expect(sampleKeyFor('shot', 99)).toBe('shot0');
    expect(sampleKeyFor('shot', -1)).toBe('shot0');
  });

  it('실음원을 둔 사운드만 키를 낸다 — 나머지는 null(절차 합성 유지)', () => {
    expect(sampleKeyFor('hit')).toBe('hit');
    expect(sampleKeyFor('card')).toBe('card');
    // ⚠️ 보스 등장음은 **없다**(청취실 X0). 여기서 키가 생기면 예고 루프의 정적이 메워진다.
    expect(sampleKeyFor('boss')).toBeNull();
    for (const n of ['kill', 'pickup', 'levelUp', 'victory', 'defeat', 'eject', 'ui', 'warn'] as const) {
      expect(sampleKeyFor(n), n).toBeNull();
    }
  });
});
