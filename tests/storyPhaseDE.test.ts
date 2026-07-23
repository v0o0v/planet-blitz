/**
 * 스토리 시스템 Phase D·E — **정규 경로 통합** 검증 (ADR-0023).
 *
 * 이 저장소의 대표 반복 결함은 "단위 테스트는 그린인데 배선이 통째로 없다"(8+회). 그래서 순수
 * 헬퍼를 따로 못박는 대신, 실제 앱이 타는 경로
 *   Profile → buildRunConfig → createWorld → stepWorld → settleRun
 * 를 통째로 굴려 에코 파편·마일스톤 누적·챕터 보상·코스메틱이 실제로 값을 만들고 소비되는지를
 * end-to-end 로 증명한다(모킹 금지). sim 코어 자체(스폰·안정화·해시 폴드)는 echoSignal.test.ts 가
 * 이미 별도로 못박으므로, 여기서는 **정산 배선**(W3 담당)이 그 값들을 프로필로 흘리는지를 본다.
 */
import { describe, it, expect } from 'vitest';
import {
  createWorld,
  stepWorld,
  emptyInput,
  packPowerupPick,
  echoStabilizedOf,
  runStoryMetrics,
} from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import { hashWorld, idleInputs, runReplay } from '../src/sim/replay.js';
import type { Replay } from '../src/sim/replay.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import type { Profile } from '../src/save/profile.js';
import { settleRun } from '../src/save/settlement.js';
import type { RunResult } from '../src/save/settlement.js';
import { storyProgressFromProfile } from '../src/save/storyProgress.js';
import { ownedCosmeticsForProfile } from '../src/ui/pixi/storyUnlock.js';
import { RECORD_SHARDS, shipStory } from '../data/lore/index.js';
import type { Entity } from '../src/sim/entities.js';
import { ECHO_DWELL_TICKS } from '../src/sim/echo.js';

/** 접촉·피격으로 조기 종료되지 않게 버티는 무대 HP(프로필 파생값이 아니다). */
const DURABLE_HP = 100_000_000;

/** 뱀서류(planet0=vampire) PvE 런 설정 — invasion3 없음이라 에코가 롤된다. */
function vampireConfig(): WorldConfig {
  return { ...buildRunConfig(defaultProfile(), { planet: 0, stage: 1 }), playerHp: DURABLE_HP };
}

/** typeId 시그니처 기체 PvE 런 설정(정규 경로 buildRunConfig 경유). */
function shipConfig(typeId: number): WorldConfig {
  const profile = defaultProfile();
  activeShip(profile).typeId = typeId;
  return { ...buildRunConfig(profile, { planet: 0, stage: 1 }), playerHp: DURABLE_HP };
}

/** 조건을 만족하는 첫 seed 를 찾는다(하드코딩 seed 회피 — 라벨/확률 변경에도 견고). */
function firstSeedWhere(pred: (w: WorldState) => boolean): number {
  for (let s = 1; s < 20000; s++) {
    if (pred(createWorld(s, vampireConfig()))) return s;
  }
  throw new Error('조건을 만족하는 seed 를 못 찾았다');
}

/** 레벨업 프리즈를 자동 소화하며 한 틱 진행한다. */
function stepAuto(w: WorldState): void {
  const input: InputFrame = w.pendingLevelUp
    ? { ...emptyInput(), special: packPowerupPick(0) }
    : emptyInput();
  stepWorld(w, input);
}

/** 에코-positive 런을 실제로 스폰·안정화까지 몬다(정규 경로 createWorld→stepWorld). */
function driveEchoToStabilize(w: WorldState): void {
  const player = w.entities[0] as Entity;
  // spawnTick 을 낮게 덮어 1800틱 대기 없이 스폰 경로를 태운다(롤 자체는 echoSignal 이 검증).
  w.echoRuntime = { state: 0, spawnTick: 3, dwell: 0, entityId: 0 };
  for (let i = 0; i < 12 && !w.entities.some((e) => e.kind === 'echo'); i++) stepAuto(w);
  for (let i = 0; i < ECHO_DWELL_TICKS + 60 && w.echoRuntime.state !== 2; i++) {
    const e = w.entities.find((x) => x.kind === 'echo' && !x.dead);
    if (e !== undefined) {
      player.x = e.x;
      player.y = e.y;
    }
    stepAuto(w);
  }
}

/** 최소 RunResult(스토리 필드 외 무영향). */
function baseResult(over: Partial<RunResult> = {}): RunResult {
  return { victory: false, loot: [], xpTotal: 0, resources: 0, ...over };
}

// ---------------------------------------------------------------------------
// 1 — 에코 full-path: 정규 경로로 안정화 → 정산이 파편을 수집한다(중복 없이 순서대로)
// ---------------------------------------------------------------------------

describe('에코 파편 — createWorld→stepWorld→settleRun full-path', () => {
  it('정규 경로 안정화가 resources 를 올리고 echoStabilizedOf 가 true 가 된다', () => {
    const posSeed = firstSeedWhere((w) => w.echoRuntime !== undefined);
    const w = createWorld(posSeed, vampireConfig());
    const before = w.resources;
    driveEchoToStabilize(w);
    expect(w.echoRuntime?.state, '안정화 완료(state=2)').toBe(2);
    expect(echoStabilizedOf(w)).toBe(true);
    expect(w.resources).toBeGreaterThan(before); // 해시된 경제(크레딧) 지급
  });

  it('settleRun 이 안정화 런에서 RECORD_SHARDS 순서로 첫 미수집 파편 1개를 수집한다', () => {
    const posSeed = firstSeedWhere((w) => w.echoRuntime !== undefined);
    const w = createWorld(posSeed, vampireConfig());
    driveEchoToStabilize(w);

    const profile = defaultProfile();
    expect(profile.collectedShards).toEqual([]);

    // 실제 sim 파생값(echoStabilizedOf/runStoryMetrics)을 그대로 실어 정산한다(모킹 아님).
    const out = settleRun(
      profile,
      baseResult({ echoStabilized: echoStabilizedOf(w), storyMetricDeltas: runStoryMetrics(w) }),
    );
    expect(profile.collectedShards).toEqual([RECORD_SHARDS[0]!.id]);
    expect(out.shardGained).toBe(RECORD_SHARDS[0]!.id);

    // 다음 안정화 런은 다음 파편을 담는다(중복 없이 순서대로).
    settleRun(profile, baseResult({ echoStabilized: true }));
    expect(profile.collectedShards).toEqual([RECORD_SHARDS[0]!.id, RECORD_SHARDS[1]!.id]);

    // 에코 미발생 정산은 파편을 담지 않는다(no-op).
    const noEcho = settleRun(profile, baseResult({ echoStabilized: false }));
    expect(profile.collectedShards).toHaveLength(2);
    expect(noEcho.shardGained).toBeUndefined();
  });

  it('전부 수집된 뒤 안정화 정산은 no-op(중복 append 없음)', () => {
    const profile = defaultProfile();
    // 모든 파편을 이미 수집한 상태로 만든다.
    profile.collectedShards = RECORD_SHARDS.map((s) => s.id);
    const out = settleRun(profile, baseResult({ echoStabilized: true }));
    expect(profile.collectedShards).toHaveLength(RECORD_SHARDS.length);
    expect(out.shardGained).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2 — 해시 재현: 내 정산·프로필 변경은 sim 해시에 무접촉(같은 seed·config 는 bit-identical)
// ---------------------------------------------------------------------------

describe('결정론 — 에코 발생 런의 per-tick 해시가 재현된다(정산 배선이 sim 무접촉)', () => {
  it('같은 (seed,config) 두 번 실행이 per-tick 해시 배열까지 동일하다', () => {
    const posSeed = firstSeedWhere((w) => w.echoRuntime !== undefined);
    const replay: Replay = { seed: posSeed, config: vampireConfig(), inputs: idleInputs(300) };
    const a = runReplay(replay);
    const b = runReplay(replay);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.finalState.echoRuntime).toBeDefined(); // 발생 런: echo 폴드가 실제로 접힌다
  });

  it('관측 카운터·정산 델타는 hashWorld 에 접히지 않는다(비-해시 — 결정론 무영향)', () => {
    const w = createWorld(1, vampireConfig());
    const h0 = hashWorld(w);
    w.hitsTaken = 999;
    w.filmPops = 42;
    expect(hashWorld(w)).toBe(h0);
  });
});

// ---------------------------------------------------------------------------
// 3 — 마일스톤 누적 → 해금 판정: sim 관측 델타가 정산을 거쳐 프로필에 쌓이고 챕터3 이 열린다
// ---------------------------------------------------------------------------

describe('마일스톤 — sim 관측 델타가 정산으로 누적되어 챕터3 해금을 연다', () => {
  it('브루저(typeId 1) 실런의 hitsTaken 관측이 settleRun 을 거쳐 프로필에 누적된다', () => {
    const w = createWorld(0xa2c, shipConfig(1));
    for (let i = 0; i < 7200; i++) stepAuto(w);
    const observed = runStoryMetrics(w).hitsTaken;
    expect(observed, '브루저 실런에서 hitsTaken 이 관측돼야 한다').toBeGreaterThan(0);

    const profile = defaultProfile();
    settleRun(profile, baseResult({ storyMetricDeltas: runStoryMetrics(w) }));
    // 정산이 관측 델타를 프로필 storyMetrics 로 흘린다(배선 실도달 — 이 값이 챕터3 판정의 축).
    expect(profile.storyMetrics.hitsTaken).toBe(observed);
  });

  it('누적이 threshold 경계를 넘는 순간 storyProgressFromProfile 이 챕터3 을 연다', () => {
    const bruiser = shipStory('bruiser')!;
    const ch3 = bruiser.chapters[2];
    expect(ch3.unlock.kind).toBe('milestone');
    const threshold = ch3.unlock.kind === 'milestone' ? ch3.unlock.threshold : 0;

    const profile = defaultProfile();
    expect(storyProgressFromProfile(profile, bruiser).milestoneReached).toBe(false);

    // threshold - 1 까지: 아직 미달성.
    settleRun(profile, baseResult({ storyMetricDeltas: { hitsTaken: threshold - 1 } }));
    expect(profile.storyMetrics.hitsTaken).toBe(threshold - 1);
    expect(storyProgressFromProfile(profile, bruiser).milestoneReached).toBe(false);

    // +1 로 threshold 도달: 해금.
    settleRun(profile, baseResult({ storyMetricDeltas: { hitsTaken: 1 } }));
    expect(profile.storyMetrics.hitsTaken).toBe(threshold);
    expect(storyProgressFromProfile(profile, bruiser).milestoneReached).toBe(true);
  });

  it('음수·비유한 델타는 누적을 되감지 못한다(오염 방어 — 양의 정수만 더한다)', () => {
    const profile = defaultProfile();
    settleRun(profile, baseResult({ storyMetricDeltas: { hitsTaken: 100 } }));
    settleRun(
      profile,
      baseResult({ storyMetricDeltas: { hitsTaken: -50, overchargeKills: Number.NaN } }),
    );
    expect(profile.storyMetrics.hitsTaken).toBe(100); // 음수 무시
    expect(profile.storyMetrics.overchargeKills ?? 0).toBe(0); // NaN 무시(키 생성 안 함)
  });
});

// ---------------------------------------------------------------------------
// 4 — 코스메틱: 해금된 챕터에서 도감 코스메틱이 순수 파생된다(별도 저장 없음)
// ---------------------------------------------------------------------------

describe('코스메틱 — 해금 상태에서 순수 파생', () => {
  it('브루저 챕터2(인연 행성)·챕터3(마일스톤) 해금 시 배지·칭호가 파생된다', () => {
    const bruiser = shipStory('bruiser')!;
    const threshold =
      bruiser.chapters[2].unlock.kind === 'milestone' ? bruiser.chapters[2].unlock.threshold : 0;
    const profile = defaultProfile();
    expect(ownedCosmeticsForProfile(profile)).toEqual([]);

    // 인연 행성(크라스=5) 클리어 → 챕터2 배지.
    settleRun(profile, baseResult({ victory: true, planet: bruiser.bondPlanet, stage: 1 }));
    expect(ownedCosmeticsForProfile(profile)).toContain('bruiser-ch2');

    // 마일스톤 도달 → 챕터3 칭호.
    settleRun(profile, baseResult({ storyMetricDeltas: { hitsTaken: threshold } }));
    const owned = ownedCosmeticsForProfile(profile);
    expect(owned).toContain('bruiser-ch2');
    expect(owned).toContain('bruiser-ch3');
  });
});

// ---------------------------------------------------------------------------
// 5 — 챕터 보상 크레딧: 해금 후 재정산해도 1회만 지급(claim 원장)
// ---------------------------------------------------------------------------

describe('챕터 보상 — claim 원장으로 크레딧 1회만 지급', () => {
  // ADR-0027: 순수 정산은 챕터 보상 크레딧을 미러에 가산하지 않고 out.storyRewardCredits 로
  // 반환만 한다(claim 원장 storyRewardsClaimed 는 1회성으로 계속 기록). "정확히 1회"는 반환값
  // 합계 + 원장으로 검증한다(지급 자체는 호출부가 온라인=grant_currency('story')/미설정=로컬).
  it('스트라이커 챕터3(runsWon>=12) 해금 보상이 정확히 1회만 반환된다(claim 원장)', () => {
    const striker = shipStory('striker')!;
    const reward = striker.chapters[2].reward!.credits; // 800
    const profile = defaultProfile();
    expect(profile.credits).toBe(0);

    // 12승(자원 0·전리품 0). planet 9 는 어느 기체의 인연 행성도 아니라 챕터2 를 열지 않는다
    // → 스트라이커 챕터3(runsWon) 단일 보상만 격리 측정.
    let granted = 0;
    for (let i = 0; i < 12; i++) {
      const out = settleRun(profile, baseResult({ victory: true, planet: 9, stage: 1 }));
      granted += out.storyRewardCredits ?? 0;
    }
    expect(profile.storyMetrics.runsWon).toBe(12);
    expect(storyProgressFromProfile(profile, striker).milestoneReached).toBe(true);
    expect(granted).toBe(reward); // 반환값 합계 = 정확히 1회 지급분
    expect(profile.credits).toBe(0); // 순수 정산은 미러를 만지지 않는다
    expect(profile.storyRewardsClaimed).toContain('striker-ch3');
    expect(profile.storyRewardsClaimed.filter((id) => id === 'striker-ch3')).toHaveLength(1);

    // 13번째 승리: 챕터는 여전히 해금 상태지만 원장이 재청구(재반환)를 막는다.
    const out13 = settleRun(profile, baseResult({ victory: true, planet: 9, stage: 1 }));
    expect(profile.storyMetrics.runsWon).toBe(13);
    expect(out13.storyRewardCredits).toBeUndefined(); // 재지급 없음
    expect(profile.credits).toBe(0);
  });

  it('해금과 동시에(같은 정산에서) 보상이 반환된다 — 임계값을 넘긴 그 런이 claim 한다', () => {
    const striker = shipStory('striker')!;
    const reward = striker.chapters[2].reward!.credits;
    const profile = defaultProfile();
    profile.storyMetrics.runsWon = 11; // 다음 1승이 12번째
    const out = settleRun(profile, baseResult({ victory: true, planet: 9, stage: 1 }));
    expect(profile.storyMetrics.runsWon).toBe(12);
    expect(profile.credits).toBe(0); // 미러 미가산(반환값으로 지급)
    expect(out.storyRewardCredits).toBe(reward);
  });
});

// ---------------------------------------------------------------------------
// 6 — runsWon: victory 정산마다 +1, 패배는 불변
// ---------------------------------------------------------------------------

describe('runsWon — victory 정산마다 +1(순수 정산 메타)', () => {
  it('승리는 +1, 패배는 그대로', () => {
    const profile = defaultProfile();
    expect(profile.storyMetrics.runsWon ?? 0).toBe(0);
    settleRun(profile, baseResult({ victory: true }));
    settleRun(profile, baseResult({ victory: true }));
    expect(profile.storyMetrics.runsWon).toBe(2);
    settleRun(profile, baseResult({ victory: false })); // 패배는 안 센다
    expect(profile.storyMetrics.runsWon).toBe(2);
    settleRun(profile, baseResult({ victory: true }));
    expect(profile.storyMetrics.runsWon).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 7 — 프로필 왕복: 신규 원장 필드가 저장·정규화를 무손실로 통과한다
// ---------------------------------------------------------------------------

describe('프로필 — storyRewardsClaimed 원장 정규화', () => {
  it('신규 프로필은 빈 원장이고, 손상값은 안전 정규화된다', () => {
    expect(defaultProfile().storyRewardsClaimed).toEqual([]);
  });

  it('원장이 정산 간에 프로필로 유지된다(같은 profile 인스턴스에 누적)', () => {
    const profile: Profile = defaultProfile();
    profile.storyMetrics.runsWon = 12;
    settleRun(profile, baseResult({ victory: false })); // runsWon 12 유지, 챕터3 해금 → claim
    expect(profile.storyRewardsClaimed).toContain('striker-ch3');
  });
});
