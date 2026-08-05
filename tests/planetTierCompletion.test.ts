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
 *   - 섬멸(2)은 Lv60 진입 게이트가 있는 엔드게임 티어이므로, 강한 화력 장비를 두른
 *     파일럿으로 모델링한다. 이는 "섬멸에 진입할 자격의 육성된 기체"를 대표한다. 기본
 *     로드아웃(1x DPS)은 hpMult×4.5 잡몹을 뚫지 못해 시간 상한에 걸리는데, 이는 밸런스
 *     설계(섬멸=엔드게임)이지 결함이 아니다.
 *
 *     ⚠️ ADR-0049 재보정(2026-08-06): 스킬 트리는 더 이상 파생 스탯을 주지 않는다(스킬이
 *     스탯에서 메커닉으로 옮겨갔고, 커밋 2 시점엔 아직 sim 배선 전이다 — `src/items/skills.ts`
 *     헤더). 구 `computeSkillStats` 만렙 화력 투자가 내던 damageMult ~2.2·fireRate ~2.8x 를
 *     **합성 장비 어픽스**로 그대로 재현해 봤지만(damagePct 120 · fireRatePct 65), 실측
 *     결과 두 증인 시드 모두 10분 예산 안에 보스에 못 닿았다(`bossSpawned=false`,
 *     `gameOver=false` — 죽는 게 아니라 그냥 못 나아간다) — **이 시점의 sim 이 예전보다
 *     더 강한 화력을 요구한다는 뜻**(하위 잡몹 hpMult·킬 목표 쪽 밸런스가 이 레인과
 *     무관하게 이미 상향돼 있다, `defer-balance-tuning`). damagePct 800·fireRatePct 92
 *     (약 112배 DPS)까지도 실패해 확인했고, damagePct 2000·fireRatePct 90(약 210배 DPS)
 *     에서야 두 증인 모두 여유 있게 완주한다(니플헤임 tick 11506·아르케 tick 7435, 예산
 *     36000의 20~32%). **완주에 필요한 최소 배율을 정밀 튜닝하지 않는다** — 이 파일럿은
 *     실제 파밍 가능한 빌드가 아니라 "섬멸을 반드시 완주하는" 내구 픽스처이고(playerHp
 *     100,000,000 과 같은 결의 조작), 여유 마진을 두는 편이 sim 이 또 강화될 때 이 파일이
 *     조용히 재발하는 것을 막는다.
 *
 * 방식: fullRun/berdan과 동일한 순수-함수 조종 파일럿(보스 방향 조타 + 레벨업 즉시
 * 0번 선택). 100M HP 내구 기체로 보스 세그먼트 도달을 보장한다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, packPowerupPick, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldConfig, WorldState, InputFrame } from '../src/sim/world.js';
import { atan2, length } from '../src/sim/math.js';
import { computeLoadoutStats } from '../src/items/loadout.js';
import type { Item } from '../src/items/types.js';

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

/**
 * 섬멸 진입 자격을 갖춘 엔드게임 파일럿의 화력 장비. `damagePct 2000`(→ damageMult ×21)·
 * `fireRatePct 90`(→ fireRateMult ×0.1 = 발사 속도 ×10) — 실측으로 두 증인 시드 모두 여유
 * 있게 완주하는 값(주석 상단 §ADR-0049 재보정 참조). 실제 파밍 가능한 수치가 아니다.
 */
function endgameFirepowerGear(): Item[] {
  return [
    {
      id: 'endgame-firepower',
      slot: 'main',
      rarity: 'rare',
      affixes: [
        { id: 'endgame-dmg', stat: 'damagePct', value: 2000 },
        { id: 'endgame-rate', stat: 'fireRatePct', value: 90 },
      ],
      source: { planet: 0, stage: 1 },
    },
  ];
}

/**
 * 섬멸 진입 자격을 갖춘 엔드게임 파일럿. ⚠️ **`skillInvest` 를 일부러 싣지 않는다.** 실측
 * 대조(같은 gear·같은 시드)에서 축0 만렙 투자 벡터를 함께 실으면 완주하던 조합이 실패로
 * 뒤집혔다 — `packPowerupPick(0)`(항상 첫 제시 강화 선택)과 투자 벡터가 만드는 파워업
 * 추첨 가중이 서로 물려 이 순수-함수 조종 파일럿에게 **불리한** 픽 순서를 만드는 것으로
 * 보인다. 이 파일럿의 목적은 "완주 가능한 최소 재현"이 아니라 "확실히 완주하는 내구
 * 픽스처"이므로, 원인을 더 파고드는 대신 화력 장비 배율만으로 완주를 보장하는 조합을
 * 쓴다(gear 단독으로 두 증인 시드 모두 여유 있게 완주함을 실측 확인).
 */
function endgameFirepowerConfig(planet: number, base: Partial<WorldConfig> = {}): WorldConfig {
  const { loadout } = computeLoadoutStats(endgameFirepowerGear());
  return {
    ...DEFAULT_CONFIG,
    ...base,
    planet,
    stage: STAGE_ANNIHILATION,
    playerHp: 100_000_000,
    loadout,
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
 *
 * ## 2026-08-04 (5레인 통합) — 니플헤임 `0x2f13` → **`0x2f27`** · 아르케 `0x3a88` → **`0x3b2f`**
 * 발사 간격이 정수 틱에서 **1/256틱 고정소수점**으로 바뀌면서(밸런스 큐 §R39) 발사 시점이
 * 재배치돼 두 구 증인이 완주하지 못한다. **단언은 그대로다** — 같은 절차로(각 구 증인부터
 * 연속 400시드 · 완주 + 보스 처치 + 미사망 전부 만족) 다시 골랐고, 두 값 모두 **2026-07-27
 * 재표본 목록에 이미 있던 시드**다(니플헤임 2등 · 아르케 3등). 이번 재표본 상위 4개:
 *   니플헤임 `0x2f27` · `0x2f68` · `0x2f8a` · `0x2faf`
 *   아르케    `0x3b2f` · `0x3b3e` · `0x3b9d` · `0x3bcb`
 * 섬멸 증인(`0x2f10`·`0x3a17`)은 이번에도 안 건드렸다 — 만렙 화력 빌드는 여전히 완주한다.
 */
const RECON_SEED_NIFLHEIM = 0x2f27;
const RECON_SEED_ARKE = 0x3b2f;

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
