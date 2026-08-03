/**
 * 런 길이 창발 (ADR-0011) — 처치 할당 게이트 + 급행 소환 + 보스전 몹 + 오토파일럿 완주.
 *
 * 고정 타이머(구 segmentTimer 2700틱)를 폐지하고 세그먼트 진행을 처치 할당(killGoal)에
 * 묶었음을 검증한다: (1) 아무도 안 죽으면 시간이 아무리 흘러도 안 넘어간다(타이머 부재),
 * (2) 할당을 채우면 넘어간다, (3) 급행 소환이 결정론적이고 미달 시 적이 쌓인다,
 * (4) 보스전에도 일반몹이 계속 등장한다, (5) 오토파일럿이 par 근처에 완주한다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, DEFAULT_CONFIG } from '../src/sim/world.js';
import { autopilotInput } from '../src/sim/autopilot.js';
import { hashWorld } from '../src/sim/replay.js';
import { SEGMENTS } from '../data/waves.js';
import { PVE_DENSITY_MULT } from '../src/sim/waves.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import { standardEquipped, standardSkillInvest } from '../src/bench/standardBuild.js';
import { LEVEL_PER_STAGE } from '../src/save/progressionPath.js';

const BOSS_INDEX = SEGMENTS.length - 1;
/** 내구(글래스캐논 방지) — 게이트/스폰 관찰이 사망으로 중단되지 않게. */
const DURABLE = { ...DEFAULT_CONFIG, planet: 0, stage: 1, playerHp: 100_000_000 };

const countEnemies = (state: ReturnType<typeof createWorld>): number =>
  state.entities.filter((e) => e.kind === 'enemy').length;

describe('처치 할당 게이트 (ADR-0011)', () => {
  it('고정 타이머가 아니다 — 아무도 안 죽으면 세그먼트가 넘어가지 않는다', () => {
    const state = createWorld(1, DURABLE);
    // 무기 무력화: 어떤 적도 죽지 않아 처치 할당이 0으로 고정된다.
    state.weapon.damage = 0;
    // 구 타이머(세그먼트당 2700틱)라면 7200틱 뒤 이미 seg 2에 있었을 것.
    for (let t = 0; t < 60 * 120; t++) stepWorld(state, emptyInput());
    expect(state.kills).toBe(0);
    expect(state.wave.segmentIndex).toBe(0);
  });

  it('처치 할당을 채우면 다음 세그먼트로 넘어간다', () => {
    const state = createWorld(0x1234, DURABLE);
    const goal0 = SEGMENTS[0]!.killGoal;
    for (let t = 0; t < 60 * 120 && state.wave.segmentIndex === 0; t++) {
      stepWorld(state, autopilotInput(state));
    }
    expect(state.wave.segmentIndex).toBe(1);
    // 넘어간 시점의 처치 수는 세그먼트0 목표 이상이어야 한다.
    expect(state.kills).toBeGreaterThanOrEqual(goal0);
    // 다음 세그먼트 게이트는 진입 시점 kills를 기준선으로 재설정된다.
    expect(state.wave.segmentBaseKills).toBe(state.kills);
    expect(state.wave.segmentKillGoal).toBe(SEGMENTS[1]!.killGoal);
  });
});

describe('급행 소환 (ADR-0011)', () => {
  it('결정론적이다 — 같은 시드는 매 틱 동일한 hashWorld를 낸다', () => {
    const drive = (): number[] => {
      const state = createWorld(0x777, DURABLE);
      const hashes: number[] = [];
      for (let t = 0; t < 60 * 45; t++) {
        stepWorld(state, autopilotInput(state));
        hashes.push(hashWorld(state));
      }
      return hashes;
    };
    expect(drive()).toEqual(drive());
  });

  it('처치 할당 미달이 길어질수록 적이 더 쌓인다 (램프)', () => {
    const state = createWorld(2, DURABLE);
    state.weapon.damage = 0; // 아무도 안 죽어 세그먼트0에 계속 머문다.
    for (let t = 0; t < 300; t++) stepWorld(state, emptyInput());
    const early = countEnemies(state);
    for (let t = 0; t < 60 * 30; t++) stepWorld(state, emptyInput());
    const late = countEnemies(state);
    // 급행 램프로 유효 상한이 올라 세그먼트0 기본 상한(12)을 넘어 더 쌓인다.
    expect(late).toBeGreaterThan(early);
    expect(late).toBeGreaterThan(SEGMENTS[0]!.maxEnemies);
  });

  it('유입 축 배율은 올림이다 — 단일 스폰 역할은 실효 2배 (waves.ts 주석과 코드 정합)', () => {
    // `spawnCard` 는 `for (let i = 0; i < s.count * PVE_DENSITY_MULT; i++)` 로 유입을 늘린다.
    // 루프 상한이 소수면 **올림**이 되는데, 이 사실이 한때 주석에 정반대로("내림, 3 → 4") 적혀
    // 있어 리뷰에서 잡혔다. 주석은 다시 어긋날 수 있으니 실효 배율 표 자체를 여기서 고정한다.
    // 배율을 바꾸는 사람은 이 표가 함께 깨지는 것을 보고 유입 축을 다시 계산하게 된다.
    const spawnedFor = (count: number): number => {
      let n = 0;
      for (let i = 0; i < count * PVE_DENSITY_MULT; i++) n++;
      return n;
    };
    // data/waves.ts 에 실재하는 count 값들.
    expect(spawnedFor(1)).toBe(2); // 단일 스폰 역할 = 실효 2배
    expect(spawnedFor(2)).toBe(3);
    expect(spawnedFor(3)).toBe(5); // 내림이면 4 였을 것
    expect(spawnedFor(4)).toBe(6);
    expect(spawnedFor(6)).toBe(9);
    // 어떤 count 에서도 유입이 줄어들지는 않는다(배율이 1 미만으로 잘못 설정되는 회귀 방지).
    for (const c of [1, 2, 3, 4, 6]) expect(spawnedFor(c)).toBeGreaterThanOrEqual(c);
  });

  it('밀도 배율이 화면 위 적 수에 실제로 반영된다 (사용자 요청 2026-07-26)', () => {
    // 배율은 상한·유입 두 축에 걸려 있는데(waves.ts `PVE_DENSITY_MULT` 주석), 한쪽만 걸리면
    // 체감이 거의 안 바뀌므로 "상수는 1.5 인데 화면은 그대로" 라는 조용한 회귀가 가능하다.
    // 그래서 상수를 되읽는 대신 **실제 누적 적 수**를 상한 파생값과 대조한다.
    expect(PVE_DENSITY_MULT).toBeGreaterThan(1); // 배율이 켜져 있다(0 배율 회귀 방지).
    const state = createWorld(3, DURABLE);
    state.weapon.damage = 0; // 아무도 안 죽으니 적 수가 유효 상한까지 단조 증가한다.
    let peak = 0;
    for (let t = 0; t < 60 * 30; t++) {
      stepWorld(state, emptyInput());
      const n = countEnemies(state);
      if (n > peak) peak = n;
    }
    // 램프 없는 세그먼트0 원본 상한(12)에 배율만 걸어도 18 이다. 배율이 유입·상한 양쪽에
    // 실제로 걸렸다면 램프까지 얹혀 그보다 확실히 많이 쌓인다.
    expect(peak).toBeGreaterThan(Math.round(SEGMENTS[0]!.maxEnemies * PVE_DENSITY_MULT));
    // 배율이 1 이었을 때의 실측 상한(램프 포함 ~28)도 넘어야 한다 — 그래야 "배율 상수만 켜고
    // 실제 스폰에는 안 걸린 상태" 를 잡는다. 28 을 상수로 박으면 무관한 스폰 변경이 배율 1
    // 에서도 29 를 만들 때 가드가 조용히 무의미해지므로, 원본 상한에서 파생시켜 여유를 둔다
    // (12 × 1.5 × 1.6 = 28.8 — 배율 1 실측 상한 28 바로 위).
    const noMultCeiling = Math.round(SEGMENTS[0]!.maxEnemies * PVE_DENSITY_MULT * 1.6);
    expect(peak).toBeGreaterThan(noMultCeiling);
  });
});

describe('보스전 몹 등장 (ADR-0011)', () => {
  it('보스 세그먼트에서도 일반몹이 계속 스폰된다', () => {
    const state = createWorld(0xb055, DURABLE);
    // 보스 세그먼트로 점프(처치 할당 게이트 진입 상태 리셋).
    state.wave.segmentIndex = BOSS_INDEX;
    state.wave.segmentBaseKills = state.kills;
    state.wave.segmentKillGoal = SEGMENTS[BOSS_INDEX]!.killGoal;
    state.wave.segmentElapsed = 0;
    state.wave.cardTimer = 0;
    let sawEnemyDuringBoss = false;
    // 무입력 내구 파일럿: 보스(3600 HP)를 10초 안에 못 죽이므로 관찰이 유지된다.
    for (let t = 0; t < 60 * 10 && !state.victory && !state.gameOver; t++) {
      stepWorld(state, emptyInput());
      if (countEnemies(state) > 0) sawEnemyDuringBoss = true;
    }
    expect(state.wave.boss).toBe(true);
    expect(sawEnemyDuringBoss).toBe(true);
  });
});

describe('오토파일럿 완주 (ADR-0011, par 창발)', () => {
  it('적정 화력으로 par 근처에 완주한다', () => {
    // 무장갑(기본 HP 100) 오토파일럿 = 적정 티어 기준선. 고정 타이머 폐지로 런 길이가
    // 상대적 강함의 결과로 창발한다 — 러프 범위로 단언(정확한 par 강제 아님).
    // ⚠️ 증인 시드는 sim 이 바뀌면 다시 골라야 한다. `fix/weapon-range-semantics`
    // (무제한 조준 폐지)로 0x50c1a1 → 0x50c1a2 로 갈았다 — 무장갑 오토파일럿의 완주는
    // 원래 시드마다 갈리는 값이고(kargon-t0 P0 클리어율 33~63%), 표본 12시드 중 7시드가
    // 여전히 40~70초에 완주하므로 단언이 약해진 것이 아니라 증인만 바뀐 것이다.
    //
    // 2026-07-26 에 0x50c1a2 → **0x50c1a3** 으로 다시 갈았다. 원인은 같은 브랜치의 두 변경이다:
    // PvE 밀도 배율 1.5(`PVE_DENSITY_MULT`)와 플레이어탄 선분 판정(`sweptCircleOverlap`).
    // 재표본(0x50c1a0..0x50c1c7 연속 40시드): 완주 **8/40**, 그리고 **완주한 8시드 전부가
    // 44~59초** 로 이 테스트의 40~150초 밴드 안에 들어온다. 즉 "짧고 강렬한 루프" 라는 계약은
    // 그대로고 시드 운만 빡빡해졌다. 클리어율이 기록된 33~63% 보다 낮아진 것은 밀도 상승의
    // 직접 결과이며, 고단계·저투자 빌드 생존성 보정과 함께 출시 직전 밸런스 패스에서 다룬다
    // (tests/shipHashBaseline.test.ts 의 `MIN_LEVELUPS` 주석에 같은 신호가 기록돼 있다).
    //
    // 2026-07-27 에 0x50c1a3 → **0x50c1af** 로 다시 갈았다. 원인은 경험치 이원화(ADR-0036)의
    // 런 풀 커브 상향(`xpToNext` 10+6L → 10+13L)이다 — 런당 레벨업이 줄어 파워업이 덜 쌓이므로
    // 무장갑 오토파일럿이 약해진다. 재표본(0x50c1a0..0x50c1ff 연속 96시드): 완주 **3/96**,
    // 완주 3시드 전부가 **49.7·63.6·66.4초** 로 이 테스트의 40~150초 밴드 안에 들어온다.
    // 즉 "짧고 강렬한 루프" 계약은 그대로고 시드 운만 더 빡빡해졌다. 클리어율 자체(20%→3%)는
    // **적 축에서** 되돌린다(ADR-0037 — 난이도 곡선은 적 축에서만) — 표준 진행 경로의 합격선은
    // "표준 레벨·표준 장비·표준 투자 봇의 클리어율 60~80%"이고 무장갑 무투자 봇은 그 기준이
    // 아니다(ADR-0035 2026-07-27 개정).
    //
    // ⚠️ 2026-07-27 (밸런스 패스 ADR-0037): **시드가 아니라 파일럿을 갈았다.**
    // 무장갑 무투자 오토파일럿은 이제 이 무대를 **구조적으로 완주하지 못한다** — 적 축
    // `SEGMENTS.killGoal` 합계가 80 → 240(×3)이 되면서 96시드 실측 **승리 0 · 사망 96 ·
    // 최장 생존 43.9초**이고, `0x50c1a0` 부터 연속 **2,000시드**를 더 훑어도 완주 0건이다.
    // 즉 증인 재선정으로는 풀리지 않는다.
    //
    // 그래서 파일럿을 **ADR-0035 표준 빌드**(표준 레벨 5 = 단계1 · 표준 장비 · 표준 투자)로
    // 바꿨다. 이것은 밴드 완화가 아니라 **"적정 화력"의 정의를 따라간 것**이다 — ADR-0035
    // 2026-07-27 개정이 합격선을 "표준 레벨·표준 장비·표준 투자 봇"으로 재정의했고, 바로 위
    // 문단이 이미 "무장갑 무투자 봇은 그 기준이 아니다"라고 적어 두고 있었다.
    // **40~150초 밴드와 단언은 한 글자도 바꾸지 않았고, 증인 시드 `0x50c1af` 도 그대로다**
    // (표준 빌드 실측 **93.3초** — 32시드 중 22승, 승리 런 86.4~116.0초로 전부 밴드 안).
    //
    // ## 이제 커버되지 않는 것
    // **무장갑 무투자 파일럿의 완주 경로.** 현 밸런스에 그 경로는 존재하지 않는다(위 2,096시드
    // 실측). 무장갑 거동 자체는 `tests/autopilot.test.ts`(1,200틱 생존)가 계속 밟는다.
    //
    // ## ⚠️ `gearSeed` 는 런 시드와 같게 둔다
    // 상수로 고정하면 "그 장비 세트 한 벌의 운"을 재게 된다 — 같은 설계값에서도 `gearSeed`
    // 만 바꾸면 클리어율이 48.3~100.0% 로 갈린다
    // (`.omc/research/economy-recalibrated-2026-07-27.md` §0.1).
    // 2026-08-03 에 0x50c1af → **0x50c1b0** 으로 갈았다. 원인은 봇의 **전리품 수거** 신설
    // (`LOOT_SEEK_RADIUS`, autopilot ③)이다 — 이동 경로가 바뀌므로 시드별 결과가 재추첨된다.
    // 재표본(0x50c1a0..0x50c1ff 연속 96시드): 완주 **71/96** 이고 전부 40~150초 밴드 안이다
    // (직전 재선정 때의 3/96 보다 오히려 넉넉해졌다 — 수거가 성장을 늘렸기 때문). 즉 계약은
    // 건재하고 **증인 하나만 어긋났다**. 0x50c1b0 은 87.3초.
    const RUN_SEED = 0x50c1b0;
    const STANDARD_LEVEL = LEVEL_PER_STAGE * 1; // 표준 레벨 = 5 × 단계
    const profile = defaultProfile();
    const ship = activeShip(profile);
    ship.level = STANDARD_LEVEL;
    ship.skillInvest = standardSkillInvest(ship.typeId, STANDARD_LEVEL);
    ship.equipped = standardEquipped(STANDARD_LEVEL, RUN_SEED, 0);
    const state = createWorld(RUN_SEED, buildRunConfig(profile, { planet: 0, stage: 1 }));
    let ticks = 0;
    for (let t = 0; t < 60 * 300; t++) {
      stepWorld(state, autopilotInput(state));
      ticks++;
      if (state.victory || state.gameOver) break;
    }
    // 실패 시 원인이 메시지로 드러나게(victory/death/timeout 구분 — 리뷰 MEDIUM 반영)
    const outcome = state.victory ? 'victory' : state.gameOver ? 'death' : 'timeout';
    expect(outcome).toBe('victory');
    const sec = ticks / 60;
    // 웨이브 ≈ 1분 + 보스(무장갑은 생존 한계로 짧게). 40~150초 러프 범위 — 구 고정
    // 타이머(런 5분+)와 확연히 다른 짧고 강렬한 루프임을 확인.
    expect(sec).toBeGreaterThan(40);
    expect(sec).toBeLessThan(150);
  });
});
