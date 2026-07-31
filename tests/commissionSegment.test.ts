/**
 * 의뢰 런 **구간 전환 코어** 테스트 (PA 레인 계약 §4·§5·§6·§8·§9).
 *
 * 이 파일이 지는 축:
 *  - **A-3 종료 3분기** — ③(마지막 구간 표적 도주 = 실패)을 ②(성공)로 떨어뜨리면 **의뢰 실패가
 *    성공으로 판정**되고, ADR-0046 이 위조 가치 최고로 지목한 확정 유니크가 지급된다. 전용 3건.
 *  - **A-2 무대 차집합 + `preDerived`** — 굽기를 두 번 하면 스탯이 구간마다 곱해진다.
 *  - **A-4 `stepRun`** — 전환 시 새 월드 반환 · 항등 반환 · 프리즈 중 전환 보류.
 *  - **A-6 꼬리 폴드** — `segmentIndex`/`segmentDone` 이 실제로 접히는가(스트림 판별자).
 *  - **A-7 억제** — 의뢰 런에 에코·조우·중반 격전이 서지 않는가.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld,
  stepWorld,
  endCommissionSegment,
  emptyInput,
  DEFAULT_CONFIG,
} from '../src/sim/world.js';
import type { LoadoutConfig, WorldConfig, WorldState } from '../src/sim/world.js';
import { stepRun, advanceCommissionSegment } from '../src/sim/commissionSegment.js';
import { hashWorld, stepThrough } from '../src/sim/replay.js';
import type { CommissionRunConfig } from '../src/run/commission.js';
import { planetContent } from '../data/planets/index.js';
import { SEGMENTS } from '../data/waves.js';
import { MID_CLASH_LEADER_MARK } from '../src/sim/modes/midClash.js';

function commissionCfg(
  segments: readonly { planet: number; stage: number }[],
  segmentIndex = 0,
  extra: Partial<WorldConfig> = {},
): WorldConfig {
  const first = segments[segmentIndex] ?? { planet: 0, stage: 1 };
  const commission: CommissionRunConfig = {
    commissionId: '00000000-0000-4000-8000-00000000dead',
    order: 'bounty',
    grade: 2,
    segments: [...segments],
    replayBudgetTicks: 27000,
    segmentIndex,
  };
  return {
    ...DEFAULT_CONFIG,
    planet: first.planet,
    stage: first.stage,
    planetMode: planetContent(first.planet).mode,
    commission,
    ...extra,
  };
}

const TWO = [
  { planet: 0, stage: 1 },
  { planet: 1, stage: 3 },
];

/** 보스 사망 분기를 실제로 태운다 — `endCommissionSegment` 단독 호출이 아니라 `compact()` 경유. */
function killBoss(w: WorldState): void {
  const boss = { ...w.entities[0] } as WorldState['entities'][number];
  boss.id = w.nextEntityId++;
  boss.kind = 'boss';
  boss.hp = 0;
  boss.dead = true;
  w.entities.push(boss);
  stepWorld(w, emptyInput());
}

describe('A-3 구간 종료 3분기 — ③ 을 ② 로 떨어뜨리면 의뢰 실패가 성공이 된다', () => {
  it('① 중간 구간: 보스 처치 → segmentDone=1, victory/gameOver 는 서지 않는다', () => {
    const w = createWorld(1, commissionCfg(TWO, 0));
    endCommissionSegment(w, 'cleared');
    expect(w.commissionRuntime?.segmentDone).toBe(1);
    expect(w.victory).toBe(false);
    expect(w.gameOver).toBe(false);
  });

  it('① 중간 구간: 표적 **도주**도 구간 종료다(실패가 아니다 — 다음 구간이 열린다)', () => {
    const w = createWorld(1, commissionCfg(TWO, 0));
    endCommissionSegment(w, 'escaped');
    expect(w.commissionRuntime?.segmentDone).toBe(1);
    expect(w.gameOver).toBe(false);
  });

  it('② 마지막 구간 완수: victory=true, segmentDone 은 서지 않는다', () => {
    const w = createWorld(1, commissionCfg(TWO, 1));
    endCommissionSegment(w, 'cleared');
    expect(w.victory).toBe(true);
    expect(w.gameOver).toBe(false);
    expect(w.commissionRuntime?.segmentDone).toBe(0);
  });

  it('③ 마지막 구간 표적 도주: **gameOver=true** — victory 로 떨어지면 의뢰 실패가 성공이 된다', () => {
    const w = createWorld(1, commissionCfg(TWO, 1));
    endCommissionSegment(w, 'escaped');
    expect(w.gameOver).toBe(true);
    expect(w.victory).toBe(false);
  });

  it('무의뢰 런은 보스 처치 = 즉시 승리 그대로다 (기존 거동 불변)', () => {
    const w = createWorld(1, { ...DEFAULT_CONFIG });
    endCommissionSegment(w, 'cleared');
    expect(w.victory).toBe(true);
    expect(w.commissionRuntime).toBeUndefined();
  });

  it('compact() 의 보스 사망 분기가 실제로 이 판정을 태운다 (배선 — 함수만 있고 안 불리는 것을 막는다)', () => {
    const mid = createWorld(7, commissionCfg(TWO, 0));
    killBoss(mid);
    expect(mid.commissionRuntime?.segmentDone).toBe(1);
    expect(mid.victory).toBe(false);

    const last = createWorld(7, commissionCfg(TWO, 1));
    killBoss(last);
    expect(last.victory).toBe(true);

    const plain = createWorld(7, { ...DEFAULT_CONFIG });
    killBoss(plain);
    expect(plain.victory).toBe(true);
  });
});

describe('A-3b 종료 플래그 우선순위 — gameOver/victory 가 segmentDone 을 무조건 이긴다', () => {
  it('보스를 죽인 그 틱에 플레이어가 죽으면 다음 구간이 열리지 않는다', () => {
    const w = createWorld(3, commissionCfg(TWO, 0));
    endCommissionSegment(w, 'cleared');
    w.gameOver = true; // checkGameOver 가 같은 틱에 세우는 상황
    expect(advanceCommissionSegment(w)).toBe(w);
  });

  it('victory 가 서 있어도 전환하지 않는다', () => {
    const w = createWorld(3, commissionCfg(TWO, 0));
    endCommissionSegment(w, 'cleared');
    w.victory = true;
    expect(advanceCommissionSegment(w)).toBe(w);
  });
});

describe('A-2/A-4 전환 — 새 월드 · 무대 차집합 · config 별칭 비공유', () => {
  function transition(): { prev: WorldState; next: WorldState } {
    const prev = createWorld(0xabc, commissionCfg(TWO, 0));
    endCommissionSegment(prev, 'cleared');
    const next = advanceCommissionSegment(prev);
    return { prev, next };
  }

  it('무대가 다음 구간 사양으로 바뀐다 (planet·stage·planetMode·segmentIndex)', () => {
    const { next } = transition();
    expect(next.config.planet).toBe(1);
    expect(next.config.stage).toBe(3);
    expect(next.config.planetMode).toBe(planetContent(1).mode);
    expect(next.config.commission?.segmentIndex).toBe(1);
  });

  it('직전 구간의 config 는 **한 바이트도 안 바뀐다** (리플레이 스냅샷이 그 객체를 싣고 있다)', () => {
    const { prev, next } = transition();
    expect(prev.config.commission?.segmentIndex).toBe(0);
    expect(prev.config.planet).toBe(0);
    expect(next.config.commission).not.toBe(prev.config.commission);
  });

  it('tick 은 0 으로, 승계분(hp·xp·loot)은 그대로 (§7 승계 계약과 짝)', () => {
    const prev = createWorld(0xabc, commissionCfg(TWO, 0));
    prev.tick = 4000;
    prev.xpTotal = 777;
    prev.loot = [{ seed: 5, rarity: 2, planet: 0, stage: 1 }];
    const pp = prev.entities[0];
    if (pp === undefined) throw new Error('player');
    pp.hp = 13;
    endCommissionSegment(prev, 'cleared');
    const next = advanceCommissionSegment(prev);
    expect(next.tick).toBe(0);
    expect(next.xpTotal).toBe(777);
    expect(next.loot).toBe(prev.loot);
    expect(next.entities[0]?.hp).toBe(13);
  });

  it('구간 시드가 인덱스에 따라 갈린다 (안 섞으면 같은 행성·단계 반복이 같은 무대가 된다)', () => {
    const segs = [
      { planet: 0, stage: 1 },
      { planet: 0, stage: 1 },
    ];
    const prev = createWorld(0xabc, commissionCfg(segs, 0));
    endCommissionSegment(prev, 'cleared');
    const next = advanceCommissionSegment(prev);
    expect(next.rng.getState()).not.toBe(prev.rng.getState());
  });

  it('마지막 구간에서는 전환이 없다 (항등 반환)', () => {
    const w = createWorld(0xabc, commissionCfg(TWO, 1));
    expect(advanceCommissionSegment(w)).toBe(w);
  });

  it('무의뢰 런은 전환 대상이 아니다 (항등 반환)', () => {
    const w = createWorld(0xabc, { ...DEFAULT_CONFIG });
    expect(advanceCommissionSegment(w)).toBe(w);
  });
});

describe('A-2 preDerived — 굽기를 두 번 하면 스탯이 구간마다 곱해진다', () => {
  /** 전 축이 1 이 아닌 로드아웃. `preDerived` 를 끄면 여기 배율이 2구간에서 **다시** 곱해진다. */
  const LOADOUT: LoadoutConfig = {
    weaponType: 0,
    subWeaponType: 0,
    damageMult: 1.5,
    fireRateMult: 0.8,
    bulletCountAdd: 0,
    pierceAdd: 0,
    bulletSpeedMult: 1.2,
    spreadAdd: 0,
    rangeAdd: 0,
    moveSpeedMult: 1.3,
    maxHpAdd: 50,
    dashCdMult: 0.9,
    magnetMult: 1.4,
    xpMult: 1,
    uniqueMask: 0,
    fireDmg: 0,
    coldSlow: 0,
    lightning: 0,
  };
  const cfgWithLoadout = (): WorldConfig => commissionCfg(TWO, 0, { loadout: LOADOUT });

  it('파워업 0회면 2구간 파생 스탯이 1구간과 **동일**하다 (preDerived 무력화 시 실패한다)', () => {
    const prev = createWorld(0xfeed, cfgWithLoadout());
    endCommissionSegment(prev, 'cleared');
    const next = advanceCommissionSegment(prev);
    // config 에 구워진 값들 — 재굽기가 일어나면 여기서 정확히 배율만큼 어긋난다.
    expect(next.config.playerSpeed).toBe(prev.config.playerSpeed);
    expect(next.config.playerHp).toBe(prev.config.playerHp);
    expect(next.config.dashCooldownTicks).toBe(prev.config.dashCooldownTicks);
  });

  it('그럼에도 catalystMods·planetMult 는 계승 config 에서 정상 재도출된다 (굽기 밖 영역)', () => {
    const prev = createWorld(0xfeed, commissionCfg(TWO, 0, { planetMultCenti: 130 }));
    endCommissionSegment(prev, 'cleared');
    const next = advanceCommissionSegment(prev);
    expect(next.planetMult).toBe(prev.planetMult);
    expect(next.planetMult).toBeCloseTo(1.3, 10);
  });
});

describe('A-4 stepRun — 반환 참조가 전환의 유일한 신호다', () => {
  it('무의뢰 런은 항등 반환 (호출부가 `next !== prev` 로만 판별한다)', () => {
    const w = createWorld(9, { ...DEFAULT_CONFIG });
    expect(stepRun(w, emptyInput())).toBe(w);
  });

  it('segmentDone 이 서 있으면 다음 스텝에서 새 월드가 나온다', () => {
    const w = createWorld(9, commissionCfg(TWO, 0));
    endCommissionSegment(w, 'cleared');
    const next = stepRun(w, emptyInput());
    expect(next).not.toBe(w);
    expect(next.config.commission?.segmentIndex).toBe(1);
  });

  it('레벨업 프리즈 중에는 전환을 보류한다 (선택지가 무대와 함께 사라지면 안 된다)', () => {
    const w = createWorld(9, commissionCfg(TWO, 0));
    endCommissionSegment(w, 'cleared');
    w.pendingLevelUp = true;
    expect(stepRun(w, emptyInput())).toBe(w);
    expect(w.commissionRuntime?.segmentDone).toBe(1); // 신호는 살아 있다
  });

  it('totalTicks 는 구간을 넘어 누적된다 (tick 은 0 으로 돌아간다)', () => {
    let w = createWorld(9, commissionCfg(TWO, 0));
    for (let i = 0; i < 10; i++) w = stepRun(w, emptyInput());
    expect(w.commissionRuntime?.totalTicks).toBe(10);
    endCommissionSegment(w, 'cleared');
    w = stepRun(w, emptyInput());
    expect(w.tick).toBe(0);
    expect(w.commissionRuntime?.totalTicks).toBe(11);
  });

  it('stepThrough 는 의뢰 런을 거부한다 (제자리 전진이라 전환을 표현할 수 없다)', () => {
    const w = createWorld(9, commissionCfg(TWO, 0));
    expect(() => stepThrough(w, [emptyInput()])).toThrow(/의뢰 런/);
  });
});

describe('A-6 의뢰 꼬리 폴드 — 접지 않으면 구간이 스트림에서 구분되지 않는다', () => {
  it('무의뢰 런의 해시는 폴드를 한 번도 실행하지 않는다 (동일 시드 두 월드가 같다)', () => {
    const a = createWorld(0x1357, { ...DEFAULT_CONFIG });
    const b = createWorld(0x1357, { ...DEFAULT_CONFIG });
    expect(hashWorld(a)).toBe(hashWorld(b));
  });

  it('segmentIndex 만 다르면 해시가 갈린다 (폴드를 빼면 이 단언이 실패한다)', () => {
    // 같은 행성·같은 단계가 반복되는 의뢰 — `tick` 도 0 으로 같다. `segmentIndex` 가 **유일한**
    // 판별자인 정확히 그 상황이다.
    const segs = [
      { planet: 0, stage: 1 },
      { planet: 0, stage: 1 },
    ];
    const a = createWorld(0x1357, commissionCfg(segs, 0));
    const b = createWorld(0x1357, commissionCfg(segs, 1));
    expect(hashWorld(a)).not.toBe(hashWorld(b));
  });

  it('segmentDone 도 접힌다 (프리즈 중 구간 종료 대기 틱이 종료 전과 구분된다)', () => {
    const a = createWorld(0x1357, commissionCfg(TWO, 0));
    const before = hashWorld(a);
    if (a.commissionRuntime === undefined) throw new Error('commissionRuntime 미배선');
    a.commissionRuntime.segmentDone = 1;
    expect(hashWorld(a)).not.toBe(before);
  });

  it('order·grade 도 접힌다 (같은 무대·같은 진행도라도 다른 의뢰다)', () => {
    const base = commissionCfg(TWO, 0);
    const cm = base.commission;
    if (cm === undefined) throw new Error('commission 미배선');
    const a = createWorld(0x1357, base);
    const b = createWorld(0x1357, { ...base, commission: { ...cm, order: 'elite' } });
    const c = createWorld(0x1357, { ...base, commission: { ...cm, grade: 4 } });
    expect(hashWorld(a)).not.toBe(hashWorld(b));
    expect(hashWorld(a)).not.toBe(hashWorld(c));
  });

  it('totalTicks 는 **접지 않는다** (스트림 인덱스에서 i+1 인 순수 파생 — 파생 폴드 금지)', () => {
    const a = createWorld(0x1357, commissionCfg(TWO, 0));
    const before = hashWorld(a);
    if (a.commissionRuntime === undefined) throw new Error('commissionRuntime 미배선');
    a.commissionRuntime.totalTicks = 12345;
    expect(hashWorld(a)).toBe(before);
  });
});

describe('A-7 억제 — 의뢰 런에 에코·조우·중반 격전이 서지 않는다', () => {
  // 무의뢰 런에서 **실제로 양성**인 시드들(실측). 억제를 무력화하면 아래 단언이 실패한다.
  const ECHO_SEEDS = [6, 23, 54, 101, 118];
  const ENCOUNTER_SEEDS = [25, 45, 92, 136, 190];

  it('대조군: 무의뢰 런에서는 그 시드들이 실제로 양성이다 (항진 방지)', () => {
    for (const s of ECHO_SEEDS) {
      expect(createWorld(s, { ...DEFAULT_CONFIG }).echoRuntime, `seed ${s}`).toBeDefined();
    }
    for (const s of ENCOUNTER_SEEDS) {
      expect(createWorld(s, { ...DEFAULT_CONFIG }).encounterRuntime, `seed ${s}`).toBeDefined();
    }
  });

  it('의뢰 런은 같은 시드에서도 에코·조우 런타임을 세우지 않는다', () => {
    for (const s of [...ECHO_SEEDS, ...ENCOUNTER_SEEDS]) {
      const w = createWorld(s, commissionCfg(TWO, 0));
      expect(w.echoRuntime, `echo seed ${s}`).toBeUndefined();
      expect(w.encounterRuntime, `encounter seed ${s}`).toBeUndefined();
    }
  });

  it('중반 격전 리더가 소환되지 않는다 (소환 게이트와 전진 게이트가 함께 움직인다)', () => {
    const clashIndex = SEGMENTS.findIndex((s) => s.clash === true);
    expect(clashIndex).toBeGreaterThanOrEqual(0);

    const leaderCount = (w: WorldState): number =>
      w.entities.filter((e) => e.kind === 'enemy' && e.aux1 === MID_CLASH_LEADER_MARK).length;

    // 대조군(무의뢰): 격전 세그먼트 진입 틱에 리더가 선다.
    const plain = createWorld(0x2468, { ...DEFAULT_CONFIG });
    plain.wave.segmentIndex = clashIndex;
    plain.wave.segmentElapsed = 0;
    stepWorld(plain, emptyInput());
    expect(leaderCount(plain), '대조군에 리더가 없다 — 이 테스트가 항진이다').toBeGreaterThan(0);

    // 의뢰 런: 같은 자리에서 리더가 서지 않는다.
    const cm = createWorld(0x2468, commissionCfg(TWO, 0));
    cm.wave.segmentIndex = clashIndex;
    cm.wave.segmentElapsed = 0;
    stepWorld(cm, emptyInput());
    expect(leaderCount(cm)).toBe(0);
  });
});
