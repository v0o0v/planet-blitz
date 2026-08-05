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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BossWarnLoop,
  bossWarnSuppressed,
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

describe('보스 예고 — 런이 끝나면 침묵한다(회귀: 결과 화면에서 계속 울었다)', () => {
  /** 사용자 신고 2026-08-05 재현 조건 — 보스를 잡은 직후의 프레임 상태. */
  const AFTER_BOSS_KILL = {
    // `bossProgress` 는 `w.done` 이면 계속 frac 1 을 돌려준다 — 런이 끝나도 0 으로 안 떨어진다.
    frac: 1,
    // 보스 엔티티가 사라졌으므로 `bossEngaged` 는 **거짓**이다. 이 조합이 정확히 함정이었다.
    engaged: false,
  } as const;

  it('진리표 — 런 종료·런 화면 이탈·관전 중 어느 하나라도 참이면 침묵한다', () => {
    const live = { runOver: false, onRunScreen: true, spectating: false };
    expect(bossWarnSuppressed(live), '라이브 런에서 침묵하면 예고가 통째로 죽는다').toBe(false);
    expect(bossWarnSuppressed({ ...live, runOver: true })).toBe(true);
    expect(bossWarnSuppressed({ ...live, onRunScreen: false })).toBe(true);
    expect(bossWarnSuppressed({ ...live, spectating: true })).toBe(true);
    // 겹쳐도 참이다(OR 이 AND 로 뒤집히지 않았다).
    expect(bossWarnSuppressed({ runOver: true, onRunScreen: false, spectating: true })).toBe(true);
  });

  it('보스를 잡아 런이 끝나면 즉시 멈춘다 — frac 은 1 로 남고 bossEngaged 는 거짓이 된다', () => {
    const { audio, playSample } = mockAudio();
    const loop = new BossWarnLoop(audio);
    // ① 보스 직전 — 울고 있어야 한다(그래야 아래 침묵이 의미를 가진다).
    for (let i = 0; i < 120; i++) loop.tick(1, false, 1 / 60, false);
    const beforeKill = playSample.mock.calls.length;
    expect(beforeKill, '보스 직전인데 예고가 안 운다').toBeGreaterThan(0);

    // ② 처치 → 런 종료. 결과 화면이 떠 있는 10초 동안 호출부는 계속 tick 을 부른다.
    const suppress = bossWarnSuppressed({ runOver: true, onRunScreen: true, spectating: false });
    for (let i = 0; i < 600; i++) {
      loop.tick(AFTER_BOSS_KILL.frac, AFTER_BOSS_KILL.engaged, 1 / 60, suppress);
    }
    expect(
      playSample.mock.calls.length,
      '런이 끝났는데 결과 화면에서 예고가 계속 운다',
    ).toBe(beforeKill);
  });

  it('가드가 없으면 실제로 계속 운다 — 이 테스트가 지키는 것이 무엇인지 고정한다', () => {
    // 같은 프레임 상태를 suppress=false 로 흘리면 최고 속도로 계속 운다. 위 테스트가
    // "원래 안 울리는 조건"을 검사하는 항진 테스트가 아님을 증명한다.
    const { audio, playSample } = mockAudio();
    const loop = new BossWarnLoop(audio);
    for (let i = 0; i < 600; i++) {
      loop.tick(AFTER_BOSS_KILL.frac, AFTER_BOSS_KILL.engaged, 1 / 60, false);
    }
    expect(playSample.mock.calls.length).toBeGreaterThan(10);
  });

  it('죽어서 끝난 런도 마찬가지다 — 보스 근처에서 죽으면 frac 이 임계 위에 남는다', () => {
    const { audio, playSample } = mockAudio();
    const loop = new BossWarnLoop(audio);
    const nearBoss = BOSS_WARN_START_FRAC + 0.15;
    for (let i = 0; i < 120; i++) loop.tick(nearBoss, false, 1 / 60, false);
    expect(playSample.mock.calls.length).toBeGreaterThan(0);
    playSample.mockClear();
    const suppress = bossWarnSuppressed({ runOver: true, onRunScreen: true, spectating: false });
    for (let i = 0; i < 600; i++) loop.tick(nearBoss, false, 1 / 60, suppress);
    expect(playSample, '패배로 끝난 런에서도 예고가 계속 운다').not.toHaveBeenCalled();
  });

  it('런 화면을 떠나도 멈춘다 — 기지·성계 지도에서 경보가 나면 안 된다', () => {
    const { audio, playSample } = mockAudio();
    const loop = new BossWarnLoop(audio);
    const suppress = bossWarnSuppressed({ runOver: false, onRunScreen: false, spectating: false });
    for (let i = 0; i < 600; i++) loop.tick(1, false, 1 / 60, suppress);
    expect(playSample).not.toHaveBeenCalled();
  });
});

/**
 * 호출부 게이트 — **이 결함의 진짜 자리는 순수 함수가 아니라 `main.ts` 였다.**
 *
 * 위 구동기 테스트는 `suppress` 를 손으로 넘겨 준다. 그래서 호출부가 그 인자를 안 넘겨도
 * 전부 초록이다 — 실제로 신고가 들어온 상태가 바로 그것이었다(순수 로직은 처음부터 옳았고,
 * `main.ts` 가 `spectating` 만 넘기고 있었다). 렌더 프레임에서만 만들어지는 조건이라
 * 단위 테스트로는 도달할 수 없으므로, 이 리포의 확립된 관행대로 소스 게이트로 잠근다
 * (`tests/commissionWorldRebind.test.ts` 와 같은 방식·같은 이유).
 */
describe('main.ts 배선 — 예고 루프에 억제 조건이 실제로 넘어간다', () => {
  function src(rel: string): string {
    return readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
  }
  /** 주석 제거 — 주석 속 문구가 게이트를 통과시키면 그건 게이트가 아니다. */
  function stripComments(text: string): string {
    return text
      .split('\n')
      .map((l) => {
        const i = l.indexOf('//');
        return i < 0 ? l : l.slice(0, i);
      })
      .join('\n');
  }

  const main = stripComments(src('src/main.ts'));
  /** `bossWarn.tick(` 부터 닫는 괄호까지의 인자 구간. 앵커가 없으면 던진다(드리프트 = 실패). */
  const tickCall = (() => {
    const a = main.indexOf('bossWarn.tick(');
    if (a < 0) throw new Error('앵커를 찾지 못했다: bossWarn.tick(');
    const b = main.indexOf(');', a);
    if (b < 0) throw new Error('bossWarn.tick( 의 닫는 괄호를 찾지 못했다');
    return main.slice(a, b);
  })();

  it('억제 인자로 `bossWarnSuppressed` 를 넘긴다 — 안 넘기면 결과 화면에서 계속 운다', () => {
    expect(tickCall, 'bossWarn.tick 이 bossWarnSuppressed 를 안 쓴다').toContain(
      'bossWarnSuppressed(',
    );
  });

  it('세 축을 모두 채운다 — 하나라도 빠지면 그 경로에서 소리가 샌다', () => {
    for (const key of ['runOver', 'onRunScreen', 'spectating']) {
      expect(tickCall, `bossWarnSuppressed 인자에 ${key} 가 없다`).toContain(key);
    }
  });

  it('`runOver` 를 그 자리에서 월드로부터 다시 읽는다 — 스텝 전 상수는 이번 프레임을 놓친다', () => {
    // 위쪽 `const runOver` 는 스텝 **전** 월드에서 뽑은 값이라, 이번 프레임에 끝난 런을 못 본다
    // (계약 §6-2 재조회 규약). 그 상수를 그냥 재사용하면 종료 프레임에서 한 번 더 울린다.
    expect(tickCall, 'runOver 가 gameOver/victory 에서 직접 파생되지 않는다').toMatch(
      /runOver:\s*w\.gameOver\s*\|\|\s*w\.victory/,
    );
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
