/**
 * 침공 1회 e2e — L1→L2→L3→코어 파괴→승리 (M7a · L11 검증 항목 ④).
 *
 * 레인별 단위 테스트는 소유 모듈을 직접 부르고, `invasionIntegration.test.ts` 는 훅 배선·
 * 피격·해시 폴드를 **구간별로** 관찰한다. 이 파일이 메우는 자리는 그 위다: **한 판을 처음부터
 * 끝까지, 정규 경로(`createWorld`→`stepWorld`)로만, 실제로 이겨 보는 것**. 구 라이브 e2e
 * 스크립트(`scripts/e2e/invasionE2E.ts`)가 L11 에서 삭제되면서 비어 있던 자리다.
 *
 * 왜 '끝까지 이기는' 관찰이 따로 필요한가 — 구간별 테스트는 전부 그린인데도 런이 구조적으로
 * 클리어 불가일 수 있기 때문이다. 실제로 이 파일을 세우면서 그 상태가 발견됐다:
 *   ① `isPlayerTargetable`(world.ts)이 M7a 신규 kind(설비·방어보스·기물)를 빠뜨려, 맞기는
 *      하지만 **조준되지는 않는** 방어체가 됐다. 충돌 격자·아군탄 화이트리스트 두 목록만
 *      확장되고 조준 술어가 빠진 3목록 불일치였다.
 *   ② 실드 발생기(기물 역할 0)가 살아 있는 동안 코어 보호막이 매 틱 전량 재충전되는데
 *      (의도된 '먼저 파괴 강제' 설계), 그 국면의 코어가 여전히 자동 조준 최우선 표적이라
 *      플레이어가 무적 코어만 영원히 때렸다.
 * 둘이 겹쳐 **소켓에 실드 발생기가 하나라도 있으면 침공이 수학적으로 클리어 불가**였다
 * (무적 플레이어로 L3 를 7200틱 돌려도 코어 8000/8000·발생기 900/900 무피해).
 *
 * 입력은 오토파일럿(ADR-0008, 순수 결정론 입력 봇)이 만든다. 무입력(IDLE)으로는 플레이어가
 * 제자리에 서서 코어 뒤 소켓의 발생기를 영원히 못 때린다 — 실제 플레이를 재려면 움직여야 한다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldConfig, WorldState, InputFrame } from '../src/sim/world.js';
import { autopilotInput } from '../src/sim/autopilot.js';
import { hashWorld, runReplay } from '../src/sim/replay.js';
import type { Replay } from '../src/sim/replay.js';
import {
  INVASION_TOTAL_TICKS,
  PHASE_L1,
  PHASE_L2,
  PHASE_L3,
  normalizeInvasionLayers,
  layersEqual,
  enumerateLayerFields,
  mutateLayerField,
  SAMPLE_GUARDIAN,
} from '../src/sim/invasion/index.js';
import type { InvasionLayers } from '../src/sim/invasion/index.js';

// ---------------------------------------------------------------------------
// 하네스
// ---------------------------------------------------------------------------

function makeConfig(layers: InvasionLayers): WorldConfig {
  const config = { ...DEFAULT_CONFIG } as WorldConfig;
  config.invasion3 = {
    layers,
    timeLimitTicks: INVASION_TOTAL_TICKS,
    maintenance: 10000,
  };
  return config;
}

/** 카탈로그 참조 1건(레벨 1·노말). */
const ref = (catalogId: number) => ({
  catalogId,
  level: 1,
  ascension: 0,
  affixSeed: 1,
  rarity: 0,
});

/** 전 슬롯 빈 정규형 — 신규 유저·NPC 초기 기지의 실제 모습(기본 수비대가 충원한다). */
function emptyLayers(): InvasionLayers {
  return normalizeInvasionLayers(undefined);
}

/**
 * 전 슬롯을 채운 배치: 편대 6 · 설비 12 · 기물 6 · 보스 1 · 수호 2.
 * 기물은 역할 3종(실드 발생기·중력 앵커·고정 주포)을 골고루 돌려 넣는다 — 한 역할로만
 * 채우면 특정 역할의 결함을 다른 역할이 가린다.
 */
function filledLayers(): InvasionLayers {
  return normalizeInvasionLayers({
    l1: { waveSlots: Array.from({ length: 6 }, (_, i) => ref(i % 3)) },
    l2: { templateId: 0, sockets: Array.from({ length: 12 }, (_, i) => ref(i % 6)) },
    l3: {
      boss: ref(0),
      guardians: [SAMPLE_GUARDIAN, SAMPLE_GUARDIAN],
      props: Array.from({ length: 6 }, (_, i) => ref(i % 3)),
    },
  });
}

interface RunResult {
  readonly state: WorldState;
  /** 오토파일럿이 실제로 낸 입력 로그(리플레이 재현의 입력원). */
  readonly inputs: InputFrame[];
  /** 매 틱 종료 후 해시. length === inputs.length. */
  readonly hashes: number[];
  /** 각 페이즈에 처음 들어간 틱(미진입이면 -1). */
  readonly enteredAt: readonly [number, number, number];
}

/**
 * 오토파일럿으로 한 판을 끝까지 돌린다. 승패가 갈리거나 총 예산이 소진되면 멈춘다.
 * 입력을 그대로 모아 두므로 같은 로그로 `runReplay` 재현 대조가 가능하다.
 */
function playRun(seed: number, layers: InvasionLayers): RunResult {
  const state = createWorld(seed, makeConfig(layers));
  const inputs: InputFrame[] = [];
  const hashes: number[] = [];
  const enteredAt: [number, number, number] = [-1, -1, -1];
  if (state.invasion3 !== undefined) enteredAt[state.invasion3.phase] = 0;
  for (let t = 0; t < INVASION_TOTAL_TICKS; t++) {
    const input = autopilotInput(state);
    inputs.push(input);
    stepWorld(state, input);
    hashes.push(hashWorld(state));
    const phase = state.invasion3?.phase;
    if (phase !== undefined && enteredAt[phase] < 0) enteredAt[phase] = t;
    if (state.gameOver || state.victory) break;
  }
  return { state, inputs, hashes, enteredAt };
}

/**
 * 클리어까지 가는 시드는 배치마다 다르다(플레이어가 먼저 죽는 시드도 정상적으로 존재한다 —
 * 침공은 이길 수도 질 수도 있어야 한다). 여기 박아 둔 시드는 아래 두 케이스가 실제로
 * 승리에 도달하는 것으로 확인된 값이다.
 *
 * ⚠️ **sim 이 바뀌면 증인 시드도 다시 골라야 한다.** 채운 배치는 네 번 갈았다 —
 * 단언을 약화한 것이 아니라 매번 **같은 성질의 증인을 다시 고른 것**이다.
 *   - `fix/weapon-range-semantics`(무제한 조준 폐지): 7 → 10.
 *   - `feat/scroll-anchor-policy`(ADR-0034 강제 스크롤 정책 축 ANCHOR/WORLD): 10 → 9.
 *     플레이어가 스크롤 창 이동량의 70% 를 받게 되어 창 대비 **순전진**이 가능해졌고
 *     (이전에는 전방 상대속도 최댓값이 0 이라 뒤 경계에 고착됐다), 침공 3레이어도 적용
 *     범위라 시드 10 은 코어 파괴 전에 판이 갈렸다. 시드 1~120 을 순차 탐색해 전 단언
 *     (3페이즈 통과·코어 실파괴·발생기 실파괴·예산 안 종료·L3 도달이 빈 배치보다 늦음)을
 *     만족하는 시드는 1·9·21 이었다. **1 은 빈 배치 증인과 값이 겹쳐** 두 상수가 뒤바뀌는
 *     회귀를 못 잡게 되므로 그다음 값인 9 를 골랐다.
 *   - `fix/invasion-shielded-core-blocks-bullets`(발생기 국면 코어가 아군탄을 통과시킴):
 *     9 → 4. 같은 절차로 1~120 을 순차 탐색해 1·4·16·53·66·74 가 전 단언을 만족했고,
 *     **1 은 위와 같은 이유로 제외**해 그다음 값인 4 를 골랐다. 시드 9 는 이 변경 뒤
 *     발생기까지는 부수지만(형제 단언 통과) 코어 파괴 전에 18,000틱 예산이 소진된다.
 *   - `fix/spatial-hash-large-radius-broadphase`(공간 해시 broad-phase 가 큰 반경 엔티티를
 *     후보에서 누락하던 결함): 4 → **53**. 이번 변경은 **판정이 세지는 방향**이라 만석 배치가
 *     전반적으로 어려워졌다 — 적·해저드가 셀 경계 너머에서도 제대로 맞히기 시작했기 때문이다
 *     (근거·분리 실측은 `.omc/research/spatial-hash-large-radius-broadphase-2026-07-28.md`).
 *     같은 절차로 1~120 을 순차 탐색해 만족하는 시드는 **53·108 둘뿐**이었고 작은 53 을 골랐다
 *     (1 과 겹치지 않으므로 위와 같은 제외는 필요 없었다). 앞선 네 세대는 후보가 3~6개였는데
 *     이번엔 120개 중 2개다 — 만석 배치가 그만큼 어려워졌다는 신호이고, 다음에 sim 이 또
 *     세지는 방향으로 바뀌면 **증인이 아예 없을 수 있으니** 그때는 시드 교체가 아니라 배치
 *     난이도 자체를 재검토해야 한다.
 *
 * 빈 배치 1 은 다섯 번의 sim 변경을 모두 넘겨 그대로 승리한다.
 */
const WINNING_SEED_EMPTY = 1;
const WINNING_SEED_FILLED = 53;

/** 코어 파괴 승리를 공통 단언으로 묶는다. */
function expectCoreKillVictory(run: RunResult): void {
  // ① 세 페이즈를 순서대로 실제로 통과했다.
  expect(run.enteredAt[PHASE_L1]).toBe(0);
  expect(run.enteredAt[PHASE_L2]).toBeGreaterThan(0);
  expect(run.enteredAt[PHASE_L3]).toBeGreaterThan(run.enteredAt[PHASE_L2]);
  expect(run.state.invasion3?.phase).toBe(PHASE_L3);

  // ② 코어가 실제로 파괴됐다(살아 있는 코어 엔티티가 없다). victory 플래그만 보면
  //    시간 초과·다른 경로로 선 플래그가 오탐을 만든다.
  const liveCore = run.state.entities.find((e) => e.kind === 'core' && !e.dead);
  expect(liveCore).toBeUndefined();

  // ③ 승리로 끝났고 패배가 아니다.
  expect(run.state.victory).toBe(true);
  expect(run.state.gameOver).toBe(false);

  // ④ 총 예산 안에서 끝났다(hard 상한에 걸려 끝난 것이 아니다).
  expect(run.inputs.length).toBeLessThan(INVASION_TOTAL_TICKS);
}

// ---------------------------------------------------------------------------
// ⓐ 빈 배치 — 기본 수비대만 있는 기지를 끝까지 뚫는다
// ---------------------------------------------------------------------------

describe('침공 e2e — 빈 배치(기본 수비대) 완주', () => {
  it('L1→L2→L3 를 통과하고 코어를 부숴 승리한다', () => {
    expectCoreKillVictory(playRun(WINNING_SEED_EMPTY, emptyLayers()));
  });

  it('충원은 스폰 단계 주입이라 config 배치는 끝까지 빈 정규형이다', () => {
    // 클라·서버 중 한쪽만 충원본을 직렬화하면 전 침공이 defense-mismatch 로 오거부된다.
    const run = playRun(WINNING_SEED_EMPTY, emptyLayers());
    expect(run.state.config.invasion3?.layers).toEqual(emptyLayers());
  });
});

// ---------------------------------------------------------------------------
// ⓑ 채운 배치 — 편대·설비·기물·보스·수호가 전부 있는 기지를 끝까지 뚫는다
// ---------------------------------------------------------------------------

describe('침공 e2e — 채운 배치(편대·설비·기물·보스·수호) 완주', () => {
  it('L1→L2→L3 를 통과하고 코어를 부숴 승리한다', () => {
    expectCoreKillVictory(playRun(WINNING_SEED_FILLED, filledLayers()));
  });

  it('실드 발생기가 실제로 파괴돼 코어 보호막 국면이 끝난다', () => {
    // 회귀 가드: 조준 3목록 불일치가 되살아나면 발생기가 무피해로 남아 코어가 영구 무적이 된다.
    // `core.timer === 1` 이 발생기 국면 플래그다(coreRoom.updateCoreShield).
    const run = playRun(WINNING_SEED_FILLED, filledLayers());
    const liveGenerator = run.state.entities.find(
      (e) => e.kind === 'prop' && !e.dead && e.enemyType === 0,
    );
    expect(liveGenerator).toBeUndefined();
  });

  it('방어 보스·설비가 실제로 교전에 참여한다(조용한 무적이 아니다)', () => {
    // 채운 배치가 빈 배치보다 확실히 오래 버텨야 배치에 의미가 있다.
    const filled = playRun(WINNING_SEED_FILLED, filledLayers());
    const empty = playRun(WINNING_SEED_EMPTY, emptyLayers());
    expect(filled.enteredAt[PHASE_L3]).toBeGreaterThan(empty.enteredAt[PHASE_L3]);
  });
});

// ---------------------------------------------------------------------------
// ⓒ 리플레이 재현 — 같은 시드+입력이 바이트 동일 해시를 낸다
// ---------------------------------------------------------------------------

describe('침공 e2e — 리플레이 재현', () => {
  for (const [name, seed, make] of [
    ['빈 배치', WINNING_SEED_EMPTY, emptyLayers],
    ['채운 배치', WINNING_SEED_FILLED, filledLayers],
  ] as const) {
    it(`${name} 런을 입력 로그로 재실행하면 매 틱 해시가 바이트 동일하다`, () => {
      const run = playRun(seed, make());
      const replay: Replay = { seed, config: makeConfig(make()), inputs: run.inputs };
      const result = runReplay(replay);
      // 길이·전 구간 해시가 모두 일치해야 한다(마지막 해시만 보면 중간 갈림을 놓친다).
      expect(result.hashes.length).toBe(run.hashes.length);
      expect(result.hashes).toEqual(run.hashes);
      expect(result.finalHash).toBe(run.hashes[run.hashes.length - 1]);
      // 재실행도 같은 결말에 도달한다.
      expect(result.finalState.victory).toBe(run.state.victory);
    });
  }

  it('리플레이를 두 번 돌려도 서로 바이트 동일하다(ADR-0005)', () => {
    const run = playRun(WINNING_SEED_EMPTY, emptyLayers());
    const replay: Replay = {
      seed: WINNING_SEED_EMPTY,
      config: makeConfig(emptyLayers()),
      inputs: run.inputs,
    };
    expect(runReplay(replay).hashes).toEqual(runReplay(replay).hashes);
  });
});

// ---------------------------------------------------------------------------
// ⓓ 배치 위조 — 배치를 건드리면 같은 입력이라도 해시가 갈린다
// ---------------------------------------------------------------------------

describe('침공 e2e — 배치 위조 검출', () => {
  /**
   * 위조 배치로 같은 입력 로그를 재실행해 **처음 갈리는 틱**을 찾는다. 끝까지 안 갈리면 -1.
   * 갈리는 순간 멈추므로 전 구간을 다시 돌지 않는다(위조는 대개 이른 틱에 드러난다).
   */
  function firstDivergingTick(
    seed: number,
    forged: InvasionLayers,
    inputs: readonly InputFrame[],
    baseline: readonly number[],
  ): number {
    const state = createWorld(seed, makeConfig(forged));
    for (let t = 0; t < inputs.length; t++) {
      stepWorld(state, inputs[t] as InputFrame);
      if (hashWorld(state) !== baseline[t]) return t;
    }
    return -1;
  }

  it('레이어별 대표 필드를 위조하면 해시가 갈린다', () => {
    const base = filledLayers();
    const run = playRun(WINNING_SEED_FILLED, base);

    // 레이어마다 최소 1건씩 — 한 레이어만 봉인돼 있어도 통과하는 일이 없게 한다.
    const targets = [
      'l1.waveSlots[0]',
      'l2.sockets[0]',
      'l3.core.hp',
      'l3.props[0]',
      'l3.boss',
      'l3.guardians[0]',
    ];
    const fields = enumerateLayerFields(base);
    for (const path of targets) {
      const field = fields.find((f) => f.path === path);
      expect(field, `필드 경로가 스키마에서 사라졌다: ${path}`).toBeDefined();
      const forged = mutateLayerField(base, field!);
      expect(forged, `위조본을 만들 수 없다: ${path}`).not.toBeNull();
      // 위조본은 원본과 다르다(대조 술어가 실제로 구별한다).
      expect(layersEqual(forged!, base)).toBe(false);
      // 같은 입력인데 런이 갈린다.
      const at = firstDivergingTick(WINNING_SEED_FILLED, forged!, run.inputs, run.hashes);
      expect(at, `위조가 런에 드러나지 않는다: ${path}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('위조하지 않은 동일 배치는 끝까지 한 틱도 갈리지 않는다(위 대조의 대조군)', () => {
    const run = playRun(WINNING_SEED_EMPTY, emptyLayers());
    const at = firstDivergingTick(WINNING_SEED_EMPTY, emptyLayers(), run.inputs, run.hashes);
    expect(at).toBe(-1);
  });
});
