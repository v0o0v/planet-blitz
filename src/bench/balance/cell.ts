/**
 * 셀 한 칸 × 시드 한 개의 **런 실행**.
 *
 * ## 정본 경유 규율
 * 프로필 조립 → `buildRunConfig` → `createWorld` → `stepWorld` 로만 간다. 런 입력의 단일
 * 정본이 `src/run/runConfig.ts` 이므로(balance-impl §0-3), 새 런 입력이 생기면 이 파일을
 * 고치지 않아도 기본값이 자동으로 반영된다.
 *
 * ## 표준 빌드
 * 레벨에서 **표준 장비 · 표준 투자 · 표준 단계**를 파생한다(`src/bench/standardBuild.ts`).
 * 장비 시드 = 런 시드라 시드를 늘리면 장비 롤 운까지 함께 평균이 잡힌다.
 *
 * ## ⚠️ 측정 사각지대 — 액티브 스킬
 * `autopilotInput` 은 `special` 로 **파워업 선택만** 낸다(`src/sim/autopilot.ts:44,81`).
 * 즉 액티브 스킬(ADR-0041)은 장착해도 **발동되지 않는다**. 그래서 여기서는 액티브를 빈 슬롯
 * 으로 두고 그 사실을 리포트 메타에 싣는다 — 절반만 발동되는 상태로 재면 "액티브가 약하다"는
 * 거짓 결론이 나오기 때문이다. 봇에 액티브 발동이 들어오면 이 파일은 고칠 것이 없고
 * `defaultProfile()` 대신 표준 액티브 세트를 꽂는 한 줄만 추가하면 된다.
 */

import { createWorld, stepWorld } from '../../sim/world.js';
import { autopilotInput } from '../../sim/autopilot.js';
import { buildRunConfig } from '../../run/runConfig.js';
import { defaultProfile, activeShip } from '../../save/profile.js';
import {
  standardEquipped,
  standardPerTree,
  standardStage,
  investVector,
} from '../standardBuild.js';
import type { BalanceCell } from './axes.js';
import { extractMetrics, newTrace, type RunTrace } from './metrics.js';

/**
 * 런 틱 상한. 저장소 표준 18,000틱(=300초)이다. 게임 자체에는 타임아웃이 없고(보스 처치
 * 또는 사망만 종료) 이 상한은 **측정이 끝나기 위한 장치**다 — 여기 걸린 런은 `timeoutRate`
 * 지표로 드러난다.
 */
export const MAX_TICKS = 60 * 300;

/** 셀 × 시드 한 번의 결과. */
export interface CellRunResult {
  readonly seed: number;
  readonly won: boolean;
  /** 소요 틱(= 이 런의 CPU 비용 프록시). 러너의 예산 회계가 쓴다. */
  readonly ticks: number;
  readonly values: Readonly<Record<string, number>>;
}

/** 보스 관측치를 갱신한다(런 루프 안쪽 — 핫 패스라 보스 세그먼트에서만 돈다). */
function observeBoss(state: ReturnType<typeof createWorld>, t: RunTrace): void {
  t.sawBoss = true;
  let bossHp: number | undefined;
  for (const e of state.entities) {
    if (e.kind === 'boss' && !e.dead) {
      bossHp = e.hp;
      break;
    }
  }
  if (bossHp !== undefined) {
    if (t.bossHp0 < 0) t.bossHp0 = bossHp;
    t.bossHpLast = bossHp;
    t.bossTicks++;
  } else if (t.bossHp0 >= 0) {
    // 보스가 사라졌다 = 처치. 남은 hp 를 0 으로 확정하고 그 틱까지 센다.
    t.bossHpLast = 0;
    t.bossTicks++;
  }
}

/**
 * 셀 한 칸을 시드 하나로 돌린다. 결정론적이다 — 같은 `(cell, seed)` 는 항상 같은 결과다.
 */
export function runCellSeed(cell: BalanceCell, seed: number): CellRunResult {
  const profile = defaultProfile();
  const ship = activeShip(profile);
  ship.typeId = cell.ship;
  ship.level = cell.level;
  ship.skillInvest = investVector(cell.ship, standardPerTree(cell.level));
  ship.equipped = standardEquipped(cell.level, seed, cell.planet);

  const config = buildRunConfig(profile, {
    planet: cell.planet,
    stage: standardStage(cell.level),
  });

  const state = createWorld(seed, config);
  const trace = newTrace();

  for (let i = 0; i < MAX_TICKS; i++) {
    stepWorld(state, autopilotInput(state));
    if (state.wave.boss) observeBoss(state, trace);
    if (state.wave.segmentIndex > trace.maxSegment) trace.maxSegment = state.wave.segmentIndex;
    if (state.victory || state.gameOver) break;
  }

  return {
    seed,
    won: state.victory,
    ticks: state.tick,
    values: extractMetrics(state, trace),
  };
}
