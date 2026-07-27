/**
 * G4 게이트 ④ — 전 행성 × 전 티어 완주 가능 검증 (Phase G, AC4·AC5).
 *
 * 기존 완주 커버리지:
 *   - 카르곤(0) 정찰(0): tests/fullRun.test.ts (완주·승리)
 *   - 베르단(1) 교전(1): tests/berdan.test.ts (여왕 완주·승리)
 * 본 파일이 메우는 공백:
 *   - 니플헤임(2)·아르케(3) 신규 보스(유령 기함·수호자 오벨리스크) 완주
 *   - 섬멸(2) 최고 티어 완주(subBullets·densityMult×1.5·eliteCount 2·hpMult×4.5)
 *
 * 대표 조합 근거: 신규 두 행성을 정찰(최저)·섬멸(최고) 양극 티어에서 완주 검증하면
 * (a) 4개 행성 전부 완주 커버리지가 채워지고 (b) 3개 티어 전부(정찰·교전은 기존 +
 * 본 파일, 섬멸은 본 파일)가 입증된다. 보스 HP는 티어 배율 비대상(world.ts stepBoss:
 * bossDef.hp)이라 섬멸 완주는 잡몹 밀도·체력만 상향된 상태에서 파일럿이 보스에
 * 도달·처치하는 검증이다.
 *
 * 파일럿 모델:
 *   - 정찰(0)은 기본 로드아웃 내구 파일럿(신규 기체도 초입 티어를 깬다).
 *   - 섬멸(2)은 Lv60 진입 게이트가 있는 엔드게임 티어이므로, 화력 계열을 만렙 투자한
 *     파일럿(순수 computeSkillStats API, 배율 조작 없음 — damageMult ~2.2·fireRate ~2.8x)
 *     으로 모델링한다. 이는 "섬멸에 진입할 자격의 육성된 기체"를 대표한다. 기본
 *     로드아웃(1x DPS)은 hpMult×4.5 잡몹을 뚫지 못해 시간 상한에 걸리는데, 이는 밸런스
 *     설계(섬멸=엔드게임)이지 결함이 아니다.
 *
 * 방식: fullRun/berdan과 동일한 순수-함수 조종 파일럿(보스 방향 조타 + 레벨업 즉시
 * 0번 선택). 100M HP 내구 기체로 보스 세그먼트 도달을 보장한다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, packPowerupPick, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldConfig, WorldState, InputFrame } from '../src/sim/world.js';
import { atan2, length } from '../src/sim/math.js';
import { computeLoadoutStats } from '../src/items/loadout.js';
import { zeroSkillInvest } from '../src/save/profile.js';
import { SKILLS, treeRange } from '../data/skills.js';

/** 구 섬멸 티어와 sim 파라미터가 byte-identical 한 침략 단계(STAGE_MILESTONES 밴드2 = minStage21). */
const STAGE_ANNIHILATION = 21;

/** 내구 파일럿으로 런을 끝까지 진행(보스 세그먼트 도달·처치 보장). */
function playToEnd(seed: number, config: WorldConfig): WorldState {
  const state = createWorld(seed, config);
  const maxTicks = 60 * 600; // 넉넉한 10분 상한
  for (let t = 0; t < maxTicks; t++) {
    const player = state.entities[0]!;
    const boss = state.entities.find((e) => e.kind === 'boss');
    let frame: InputFrame;
    if (state.pendingLevelUp) {
      frame = { ...emptyInput(), special: packPowerupPick(0) };
    } else if (boss !== undefined) {
      const dx = boss.x - player.x;
      const dy = boss.y - player.y;
      const len = length(dx, dy) || 1;
      frame = { moveX: dx / len, moveY: dy / len, aim: atan2(dy, dx), dash: false, special: 0 };
    } else {
      frame = emptyInput();
    }
    stepWorld(state, frame);
    if (state.gameOver || state.victory) break;
  }
  return state;
}

/** 섬멸 진입 자격을 갖춘 엔드게임 파일럿: 화력 계열 만렙 투자(순수 API). */
function endgameFirepowerConfig(planet: number, base: Partial<WorldConfig> = {}): WorldConfig {
  const invest = zeroSkillInvest();
  const { start, end } = treeRange('firepower');
  for (let i = start; i < end; i++) invest[i] = SKILLS[i]!.maxPoints;
  const { loadout } = computeLoadoutStats([], invest);
  return {
    ...DEFAULT_CONFIG,
    ...base,
    planet,
    stage: STAGE_ANNIHILATION,
    playerHp: 100_000_000,
    loadout,
    skillInvest: invest,
  };
}

function expectVictory(state: WorldState): void {
  expect(state.bossSpawned).toBe(true); // 보스 세그먼트 도달
  expect(state.victory).toBe(true); // 보스 처치 완주
  expect(state.gameOver).toBe(false);
  expect(state.entities.some((e) => e.kind === 'boss')).toBe(false); // 보스 사망
}

/**
 * 정찰(단계1) 완주 증인 시드. **섬멸 케이스는 기존 시드(`0x2f10`·`0x3a17`)를 그대로 쓴다** —
 * 만렙 화력 빌드는 여전히 완주하므로 증인을 갈 이유가 없고, 두 티어의 증인을 분리해 두면
 * 다음 sim 변경에서 어느 쪽이 깨졌는지가 바로 보인다.
 *
 * 2026-07-27 밸런스 패스(ADR-0037)에서 신설했다. 적 축의 `SEGMENTS.killGoal` 합계가 80 → 240
 * 이 되면서 **기본 기체(무장비·무투자) 내구 파일럿이 처치 할당을 못 채워 정체**한다 — 구 증인
 * `0x2f10` 은 144,000틱(2,400초)을 돌려도 세그먼트 0 에서 처치 **2** 로 멈춘다(실측). 죽는 것이
 * 아니라 못 나아가는 것이라 **틱 예산으로는 풀리지 않고**, 시드 재선정이 유일한 재기준화다.
 *
 * 재표본(각 구 증인부터 연속 400시드 · 완주 + 보스 처치 + 미사망 전부 만족):
 *   니플헤임 12시드(`0x2f13`·`0x2f27`·`0x2f81` …) → 첫 값 **`0x2f13`**
 *   아르케    6시드(`0x3a88`·`0x3ae8`·`0x3b2f` …) → 첫 값 **`0x3a88`**
 * 완주 시드는 눈덩이형이다 — 초반 포위를 벗어나면 처치가 급격히 는다.
 */
const RECON_SEED_NIFLHEIM = 0x2f13;
const RECON_SEED_ARKE = 0x3a88;

describe('전 행성 × 전 티어 완주 (G4 게이트 ④, AC4·AC5)', () => {
  it('니플헤임(2) 정찰 완주 — 기본 기체로 유령 기함을 처치한다', () => {
    expectVictory(
      playToEnd(RECON_SEED_NIFLHEIM, {
        ...DEFAULT_CONFIG,
        planet: 2,
        stage: 1,
        playerHp: 100_000_000,
      }),
    );
  });

  it('아르케(3) 정찰 완주 — 기본 기체로 수호자 오벨리스크를 처치한다', () => {
    expectVictory(
      playToEnd(RECON_SEED_ARKE, {
        ...DEFAULT_CONFIG,
        planet: 3,
        stage: 1,
        playerHp: 100_000_000,
      }),
    );
  });

  it('니플헤임(2) 섬멸 완주 — 육성 기체가 최고 티어를 뚫고 완주한다', () => {
    expectVictory(playToEnd(0x2f10, endgameFirepowerConfig(2)));
  });

  it('아르케(3) 섬멸 완주 — 육성 기체가 최고 티어를 뚫고 완주한다', () => {
    expectVictory(playToEnd(0x3a17, endgameFirepowerConfig(3)));
  });
});
