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
import type { WorldState } from '../../sim/world.js';
import type { Entity } from '../../sim/entities.js';
import { PLANET_MODE } from '../../sim/planetMode.js';
import { RACING_REAR_PRESSURE_MARGIN } from '../../sim/modes/racing.js';
import { INVASION_WINDOW_HALF_W } from '../../sim/invasion/scroll.js';
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

/**
 * 이 보스 엔티티와 **실제로 교전할 수 있는가**.
 *
 * ## 왜 `state.wave.boss` 로는 안 되는가 (2026-08-01 수정)
 * 처음에는 "웨이브 디렉터가 보스 세그먼트에 진입했는가"(`state.wave.boss`)를 게이트로 썼다.
 * 그 정의는 **추격 모드(니플헤임)에서 구조적으로 거짓**이다:
 *
 * - 포식자는 `createWorld` 가 코스를 깔 때 이미 스폰된다(`placeChaseCourse` → `bossSpawned=true`).
 *   `wave.boss` 는 그때 false 이고, 세그먼트 전진은 **대피소 도달**로 대체된다(`waves.ts:314`).
 * - 승리는 세그먼트 진행과 **무관하게** 성립한다 — 반격 장치 5개 파괴 → 포식자 취약화
 *   (`aux0=1`) → 처치 → `compact()` 의 보스 분기 → `victory`.
 * - 즉 **승리 런조차 마지막 보스 세그먼트에 도달하기 전에 끝나고**, `wave.boss` 는 끝까지 false 다.
 *
 * 실측이 이것을 그대로 드러냈다: 니플헤임 2,240런 중 **승리 422건이 전부 `bossReachRate=0`**.
 * 승리가 곧 보스 처치인데 관측기는 한 번도 보스를 보지 않았다. 밸런스 신호가 아니라 지표의 결함이다.
 *
 * ## 새 정의
 * "교전 가능한 보스 엔티티가 실재하는가". 추격 모드에서는 **취약화 전(`aux0===0`) 무적 포식자를
 * 제외**한다 — 그것까지 세면 런 시작부터 참이 되어 이번엔 반대 방향으로 거짓(100%)이 된다.
 * `aux0` 판정을 `planetMode === chase` 로 좁히는 이유는 다른 보스가 `aux0` 을 패턴 상태로 쓰기
 * 때문이다(좁히지 않으면 일반 보스가 `aux0=0` 인 동안 "무적"으로 오판된다).
 */
export function bossEngageable(state: WorldState, e: Entity): boolean {
  if (e.kind !== 'boss' || e.dead) return false;
  if (state.config.planetMode === PLANET_MODE.chase) return e.aux0 === 1;
  return true;
}

/**
 * 보스 관측치를 갱신한다(런 루프 안쪽).
 *
 * 호출부가 `state.bossSpawned` 로 선행 게이트를 건다 — 보스가 스폰되기 전에는 엔티티 스캔
 * 자체가 돌지 않는다.
 */
function observeBoss(state: WorldState, t: RunTrace): void {
  let bossHp: number | undefined;
  for (const e of state.entities) {
    if (bossEngageable(state, e)) {
      bossHp = e.hp;
      break;
    }
  }
  if (bossHp !== undefined) {
    t.sawBoss = true;
    if (t.bossReachTick < 0) t.bossReachTick = state.tick;
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
 * 뒤 경계 압박 관측(레이싱 전용).
 *
 * `racingRearPressure`(`src/sim/modes/racing.ts`)와 **같은 부등식**을 쓴다 — 판정을 베껴 적는
 * 대신 상수를 그쪽에서 가져오므로, 압박 구역 정의가 바뀌면 이 관측도 함께 따라간다. sim 을
 * 한 바이트도 건드리지 않고(관측 전용) 런 밖에서 세므로 해시·거동에 영향이 없다.
 */
function observeRearPin(state: WorldState, t: RunTrace): void {
  if (state.config.planetMode !== PLANET_MODE.racing) return;
  const rt = state.scrollRuntime;
  const player = state.entities[0];
  if (rt === undefined || player === undefined || player.dead) return;
  const rearX = rt.scrollX - INVASION_WINDOW_HALF_W;
  if (player.x - rearX <= RACING_REAR_PRESSURE_MARGIN) t.rearPinTicks++;
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
    observeRearPin(state, trace);
    if (state.bossSpawned) observeBoss(state, trace);
    if (state.wave.segmentIndex > trace.maxSegment) trace.maxSegment = state.wave.segmentIndex;
    if (state.victory || state.gameOver) break;
  }

  // PvE 승리는 **정의상 보스 처치**다(`compact()` 의 보스 분기가 유일한 승리 경로).
  //
  // ① 관측 창 닫기 — 처치 틱에 루프가 break 하므로 위 관측기의 "보스가 사라졌다" 분기에
  //    도달하지 못한다. 잔여 hp 를 0 으로 확정하지 않으면 DPS 가 과소평가된다.
  // ② `sawBoss` 보정 — 보스가 **스폰된 바로 그 틱에 처치되면** 관측기는 한 번도 보스를 보지
  //    못한다(`stepWorld` 안에서 스폰→피격→`compact` 제거가 모두 끝나고, 우리는 반환 후에
  //    본다). 실측 12,600런 중 10건이 이 경우였다 — 저단계 보스 HP 에 다중탄이 한 틱에 몰리면
  //    일어난다. 승리했다는 사실이 교전을 증명하므로 여기서 세운다.
  //
  //    ⚠️ 그 10건은 관측 창이 0틱이라 **DPS 를 계산할 수 없다**. 그래서 `bossDps` 는
  //    `winPosMean`(양수 표본만) 으로 집계한다 — 0 을 섞으면 평균이 내려앉는다(metrics.ts).
  if (state.victory) {
    trace.sawBoss = true;
    // 스폰 틱 즉사(관측 창 0틱)면 도달 시각도 못 봤다 — 종료 틱으로 확정한다.
    if (trace.bossReachTick < 0) trace.bossReachTick = state.tick;
    if (trace.bossHp0 >= 0) {
      trace.bossHpLast = 0;
      trace.bossTicks++;
    }
  }

  return {
    seed,
    won: state.victory,
    ticks: state.tick,
    values: extractMetrics(state, trace),
  };
}
