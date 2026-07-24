/**
 * 런 사운드 관찰 순수 로직 검증 (P2 sfx-expansion — plan Verification 2, AC12·AC13·AC14·AC19).
 *
 * AudioContext 없이 순수 로직만 검증한다. GameAudio 는 `{ play: vi.fn() }` mock 을 cast 해 주입한다.
 * 핵심은 **이원 드랍 관측**(바닥 엔티티 등장 + 보스 무엔티티 직행) 과 **더블카운트 금지**(수거는 무음),
 * weaponType 5종 발사음 매핑, 특수탄 경고 판별·rising-edge, hasBoss 전이·관전 억제다.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  DropObserver,
  RunSoundObserver,
  shouldWarn,
  type SoundFrame,
} from '../src/render/soundScape.js';
import type { GameAudio } from '../src/render/audio.js';
import { BK_NONE, BK_ACCEL, BK_HOMING, BK_CURVE, BK_SPLIT } from '../src/sim/bullets.js';

/** play 만 스텁한 GameAudio mock. */
function mockAudio(): { audio: GameAudio; play: ReturnType<typeof vi.fn> } {
  const play = vi.fn();
  const audio = { play } as unknown as GameAudio;
  return { audio, play };
}

/** SoundFrame 기본값(테스트에서 필요한 필드만 override). */
function frame(over: Partial<SoundFrame> = {}): SoundFrame {
  return {
    kills: 0,
    level: 0,
    playerHp: 100,
    resources: 0,
    hasBoss: false,
    bulletCount: 0,
    weaponType: 0,
    gameOver: false,
    victory: false,
    ...over,
  };
}

describe('DropObserver (이원 드랍 관측·CRITICAL)', () => {
  it('(a) 바닥 loot 엔티티 등장(onscreen) → 해당 rarity + pan 1건', () => {
    const obs = new DropObserver();
    // playerX=0, halfWidth=100. x=50 → dx=50 → pan=0.5(화면 안).
    const drops = obs.observe([{ id: 1, x: 50, rarity: 1 }], [], 0, 100);
    expect(drops).toEqual([{ rarity: 1, pan: 0.5 }]);
  });

  it('(b) 보스 무엔티티 직행(stateLoot 증분 rarity=3) → 중앙(pan 없음) 유니크 1건', () => {
    const obs = new DropObserver();
    const drops = obs.observe([], [{ rarity: 3 }], 0, 100);
    expect(drops).toEqual([{ rarity: 3 }]);
    expect(drops[0]?.pan).toBeUndefined(); // 좌표 없음 → 중앙.
  });

  it('(c) 바닥 드랍 후 수거는 무음(더블카운트 금지 — 실드랍 1회당 1회)', () => {
    const obs = new DropObserver();
    // 프레임1: 엔티티 등장 → 드랍 1건.
    const f1 = obs.observe([{ id: 7, x: 0, rarity: 0 }], [], 0, 100);
    expect(f1).toEqual([{ rarity: 0, pan: 0 }]);
    // 프레임2: 엔티티 소멸 + stateLoot 증분(수거) → 드랍 없음.
    const f2 = obs.observe([], [{ rarity: 0 }], 0, 100);
    expect(f2).toEqual([]);
  });

  it('화면 밖 loot 는 무음(|dx|>halfWidth) — 단 seen 기록되어 이후 수거도 무음', () => {
    const obs = new DropObserver();
    // x=500, halfWidth=100 → 화면 밖 → 무음.
    const f1 = obs.observe([{ id: 9, x: 500, rarity: 2 }], [], 0, 100);
    expect(f1).toEqual([]);
    // 수거되어 stateLoot 증분 → 여전히 무음(더블카운트 금지).
    const f2 = obs.observe([], [{ rarity: 2 }], 0, 100);
    expect(f2).toEqual([]);
  });

  it('pan 은 -1..1 로 클램프(halfWidth 경계 넘어도 화면 안 케이스 방어)', () => {
    const obs = new DropObserver();
    // 정확히 경계(dx=halfWidth) → 화면 안, pan=1.
    const drops = obs.observe([{ id: 3, x: -100, rarity: 0 }], [], 0, 100);
    expect(drops).toEqual([{ rarity: 0, pan: -1 }]);
  });

  it('수거 + 직행이 같은 프레임에 섞여도 다중집합 차집합으로 직행만 남긴다', () => {
    const obs = new DropObserver();
    // 프레임1: 바닥 loot 2건 등장(rarity 0, 2) → 드랍 2건.
    const f1 = obs.observe(
      [
        { id: 1, x: 0, rarity: 0 },
        { id: 2, x: 0, rarity: 2 },
      ],
      [],
      0,
      100,
    );
    expect(f1.map((d) => d.rarity)).toEqual([0, 2]);
    // 프레임2: id=1 수거(rarity 0) + 보스 직행 rarity 0 & rarity 3.
    //   stateLoot 증분=[0(수거), 0(직행), 3(직행)]. 수거 rarity 0 하나를 빼면 직행 [0, 3] 남음.
    const f2 = obs.observe([{ id: 2, x: 0, rarity: 2 }], [{ rarity: 0 }, { rarity: 0 }, { rarity: 3 }], 0, 100);
    expect(f2).toEqual([{ rarity: 0 }, { rarity: 3 }]);
  });

  it('reset() 후 seen·prevLootLen 초기화(새 런 재관측)', () => {
    const obs = new DropObserver();
    obs.observe([{ id: 1, x: 0, rarity: 0 }], [{ rarity: 9 }], 0, 100);
    obs.reset();
    // 리셋 후 같은 id 도 신규로 재감지, stateLoot 도 처음부터.
    const drops = obs.observe([{ id: 1, x: 0, rarity: 3 }], [], 0, 100);
    expect(drops).toEqual([{ rarity: 3, pan: 0 }]);
  });
});

describe('shouldWarn (AC19 특수탄/보스탄 판별)', () => {
  it('특수 거동탄(BK_ACCEL/HOMING/CURVE/SPLIT) 이 하나라도 있으면 true', () => {
    for (const b of [BK_ACCEL, BK_HOMING, BK_CURVE, BK_SPLIT]) {
      expect(shouldWarn([{ behavior: b, boss: false }])).toBe(true);
    }
  });

  it('보스 소유탄이면 거동이 직진이라도 true', () => {
    expect(shouldWarn([{ behavior: BK_NONE, boss: true }])).toBe(true);
  });

  it('잡몹 직진탄(BK_NONE)만 있으면 false', () => {
    expect(shouldWarn([{ behavior: BK_NONE, boss: false }])).toBe(false);
    expect(shouldWarn([])).toBe(false);
  });

  it('혼재 시 하나라도 대상이면 true', () => {
    expect(
      shouldWarn([
        { behavior: BK_NONE, boss: false },
        { behavior: BK_HOMING, boss: false },
      ]),
    ).toBe(true);
  });
});

describe('RunSoundObserver (weaponType 발사음·드랍·경고·전이)', () => {
  it('(d) weaponType 0~4 각각 발사음 매핑 play("shot", {weaponType:n})', () => {
    for (let wt = 0; wt <= 4; wt++) {
      const { audio, play } = mockAudio();
      const obs = new RunSoundObserver(audio);
      obs.observe(frame({ bulletCount: 0, weaponType: wt })); // 기준선.
      obs.observe(frame({ bulletCount: 1, weaponType: wt })); // 발사.
      expect(play).toHaveBeenCalledWith('shot', { weaponType: wt });
    }
  });

  it('드랍 이벤트 → rarity 매핑(0·1 common / 2 rare / 3 unique) + pan 전달', () => {
    const { audio, play } = mockAudio();
    const obs = new RunSoundObserver(audio);
    obs.observe(frame()); // 기준선.
    obs.observe(frame(), {
      drops: [
        { rarity: 0, pan: -0.5 },
        { rarity: 1 },
        { rarity: 2, pan: 0.3 },
        { rarity: 3 },
      ],
    });
    expect(play).toHaveBeenCalledWith('dropCommon', { pan: -0.5 });
    expect(play).toHaveBeenCalledWith('dropCommon', undefined); // pan 없음 → 중앙.
    expect(play).toHaveBeenCalledWith('dropRare', { pan: 0.3 });
    expect(play).toHaveBeenCalledWith('dropUnique', undefined);
  });

  it('(e) 경고음은 rising-edge 에서 1회(연속 present 는 매프레임 발사 금지)', () => {
    const { audio, play } = mockAudio();
    const obs = new RunSoundObserver(audio);
    obs.observe(frame()); // 기준선.
    obs.observe(frame(), { warn: true }); // false→true → 1회.
    obs.observe(frame(), { warn: true }); // true→true → 없음.
    obs.observe(frame(), { warn: false }); // 하강.
    obs.observe(frame(), { warn: true }); // 다시 false→true → 1회.
    const warnCalls = play.mock.calls.filter((c) => c[0] === 'warn');
    expect(warnCalls).toHaveLength(2);
  });

  it('(f) hasBoss false→true → play("boss")', () => {
    const { audio, play } = mockAudio();
    const obs = new RunSoundObserver(audio);
    obs.observe(frame({ hasBoss: false }));
    obs.observe(frame({ hasBoss: true }));
    expect(play).toHaveBeenCalledWith('boss');
  });

  it('suppressSfx=true 는 모든 SFX 억제하되 prev 기준선은 갱신(관전 게이트 P4)', () => {
    const { audio, play } = mockAudio();
    const obs = new RunSoundObserver(audio);
    obs.observe(frame({ kills: 0 })); // 기준선.
    obs.observe(frame({ kills: 5, hasBoss: true }), { suppressSfx: true, warn: true }); // 억제.
    // 억제 프레임에서 아무 SFX 도 안 남(boss·kill·warn 전부).
    expect(play).not.toHaveBeenCalled();
    // prev 가 갱신됐으므로 다음 프레임 kills 5→5 델타 없음 → kill 없음(prev 미갱신이면 5>0 로 오발).
    obs.observe(frame({ kills: 5 }));
    expect(play.mock.calls.filter((c) => c[0] === 'kill')).toHaveLength(0);
  });

  it('억제 중 warn 은 재생 안 되고, 억제 해제 후 연속 warn 은 재트리거 안 함(prevWarn 유지)', () => {
    const { audio, play } = mockAudio();
    const obs = new RunSoundObserver(audio);
    obs.observe(frame()); // 기준선.
    obs.observe(frame(), { suppressSfx: true, warn: true }); // 억제 + warn present.
    obs.observe(frame(), { warn: true }); // 해제, 여전히 present → 연속이라 재트리거 X.
    expect(play.mock.calls.filter((c) => c[0] === 'warn')).toHaveLength(0);
  });

  it('reset() 후 첫 프레임은 기준선만(소리 없음)', () => {
    const { audio, play } = mockAudio();
    const obs = new RunSoundObserver(audio);
    obs.observe(frame({ kills: 3 }));
    obs.reset();
    obs.observe(frame({ kills: 9 })); // reset 후 첫 프레임 → 기준선.
    expect(play).not.toHaveBeenCalled();
  });
});
