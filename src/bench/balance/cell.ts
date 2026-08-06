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
 * ## ⚠️ 측정 사각지대 — 액티브 스킬 (**손잡이는 생겼고, 아직 안 당겼다**)
 * `autopilotInput` 은 `special` 로 **파워업 선택만** 낸다(전 분기 `SPECIAL_NONE`·`dash: false`).
 * 즉 액티브 스킬(ADR-0041)은 장착해도 **발동되지 않는다**. 그래서 여기서는 액티브를 빈 슬롯
 * 으로 두고 그 사실을 리포트 메타에 싣는다 — 절반만 발동되는 상태로 재면 "액티브가 약하다"는
 * 거짓 결론이 나오기 때문이다.
 *
 * 2026-08-06 에 **측정 전용 파일럿**(`src/sim/measurePilot.ts`, ADR-0049 §0-A 결정 B)이 생겼다.
 * 이 파일을 그쪽으로 옮기려면 두 줄이다: `autopilotInput` → `measurePilotInput` 으로 바꾸고
 * `createWorld` 직후 `beginMeasureRun(state)` 를 부른다(측정 런은 오염 런 취급). 표준 액티브
 * 세트를 꽂는 한 줄도 함께 필요하다.
 *
 * ⚠️ **아직 안 바꿨다.** 파일럿을 갈면 **모든 셀의 수치가 한 번에 움직인다**(발동 + 벽 접근
 * 정책이 생존·페이싱을 둘 다 바꾼다). 그건 밸런스 판단이 붙는 결정이라 스킬 배선 레인이
 * 근거를 들고 하는 것이 맞다. 여기 주석과 리포트 자인이 갈리지 않게 **같이** 고쳐라.
 *
 * ## 파워업 선택 축 (2026-08-03 신설)
 * 오토파일럿은 항상 오퍼 0번을 고르므로 파워업 조합의 강약이 갈리지 않았다. `cell.powerup` 을
 * 주면 이 파일의 {@link pickOverride} 가 픽 프레임만 갈아 끼운다 — sim(`autopilot.ts`)은 한 줄도
 * 바뀌지 않는다. 정책 카탈로그와 그 축의 자인은 `powerupPolicy.ts` 헤더에 있다.
 */

import { createWorld, stepWorld, hazardActive, packPowerupPick } from '../../sim/world.js';
import type { InputFrame, WorldState } from '../../sim/world.js';
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
import { choosePowerupOffer } from './powerupPolicy.js';

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
 * 이번 틱에 잃은 선체 HP 를 **피해원에 귀속**시킨다(관측 전용).
 *
 * ## 왜 필요한가
 * "무엇이 플레이어를 죽이는가"를 sim 밖에서 답하기 위해서다. 톡사르(오염)에서 웨이브 유입과
 * 오염 지형 피해를 각각 극단값으로 프로브했는데 **둘 다 무반응**이었다 — 즉 사인이 그 둘이
 * 아닌데도 수치만 계속 만지면 없는 문제를 튜닝하게 된다.
 *
 * ## 귀속 규칙 — sim 과 같은 "겹친 피해원 중 최대"
 * `resolveCollisions` 는 한 틱에 겹친 피해원들의 `damage` **최댓값** 하나만 적용한다. 여기서도
 * 같은 규칙으로 지형(활성 해저드)과 접촉(적·보스·수호 몸통)의 최대치를 비교한다. 술어
 * `hazardActive` 는 sim 에서 import 한다(베껴 적으면 그쪽이 바뀔 때 관측이 조용히 거짓말한다).
 *
 * ## ⚠️ 탄은 잔차다 — 그래서 **피해량 대조**로 과대계상을 막는다
 * 적탄은 명중한 틱에 `dead` 로 지워지고 `compact()` 가 배열에서 뺀다. 즉 **스텝이 끝난 뒤에는
 * 그 탄이 없다**. 그래서 탄은 독립 버킷이 아니라 잔차(1 − 지형 − 접촉)로 읽는다.
 *
 * 겹침만 보면 과대계상이 난다 — 자유추적 무대의 봇은 장판 위에 서 있는 시간이 길어서, 실제로
 * 죽인 것이 탄이어도 "지형이 겹쳐 있었다"는 이유로 지형에 실린다. 그래서 **후보의 `damage` 가
 * 이번에 잃은 HP 이상일 때만** 그 후보를 범인으로 인정한다. 적용치는 감액(장갑·막)만 받고
 * 절대 커지지 않으므로, `damage < 잃은 HP` 인 후보는 **원리적으로** 범인이 될 수 없다.
 * 남는 모호함은 두 후보가 모두 조건을 만족하는 경우뿐이고 그때는 sim 과 같은 최대 규칙을 쓴다.
 */
function attributeHpLoss(state: WorldState, player: Entity, lost: number, t: RunTrace): void {
  t.hpLost += lost;
  let hazardMax = 0;
  let contactMax = 0;
  for (const e of state.entities) {
    if (e.dead || e === player) continue;
    const isHazard = e.kind === 'hazard' && hazardActive(e);
    const isBody =
      e.kind === 'enemy' || e.kind === 'boss' || e.kind === 'guardian' || e.kind === 'defenseBoss';
    if (!isHazard && !isBody) continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    const r = e.radius + player.radius;
    if (dx * dx + dy * dy > r * r) continue;
    if (isHazard) {
      if (e.damage > hazardMax) hazardMax = e.damage;
    } else if (e.damage > contactMax) contactMax = e.damage;
  }
  // `damage < lost` 인 후보는 범인일 수 없다(적용치는 감액만 받는다). 둘 다 가능하면 sim 과
  // 같은 최대 규칙. 아무도 조건을 못 채우면 잔차 = 탄이다.
  const hazardCan = hazardMax >= lost;
  const contactCan = contactMax >= lost;
  if (hazardCan && hazardMax >= contactMax) t.hpLostHazard += lost;
  else if (contactCan) t.hpLostContact += lost;
}

/**
 * 레벨업 프리즈 중이면 **정책이 고른 오퍼 인덱스**로 픽 프레임을 갈아 끼운다.
 *
 * 정책이 미지정이면 입력 프레임을 **그 객체 그대로** 돌려준다 — 새 객체를 만들지도 않으므로
 * 표준 격자의 런은 이 함수가 없던 때와 구조적으로 동일하다. 프리즈가 아닐 때도 마찬가지다
 * (그 틱의 `special` 은 오토파일럿이 이미 `SPECIAL_NONE` 으로 낸다).
 */
function pickOverride(
  state: WorldState,
  input: InputFrame,
  policy: number | undefined,
): InputFrame {
  if (policy === undefined || !state.pendingLevelUp) return input;
  return { ...input, special: packPowerupPick(choosePowerupOffer(state, policy)) };
}

/**
 * 표준 장비 롤에 쓸 시드. **런 시드에 기체를 섞는다.**
 *
 * ## 왜 필요한가 — 한 레벨의 장비 표본이 7배 부풀려져 있었다 (2026-08-02 실측)
 * `standardEquipped(level, seed, planet)` 은 기체를 인자로 받지 않는다. 그래서 예전에는 한
 * 라운드(시드 하나) 안에서 **기체 7종이 모두 똑같은 장비**로 돌았다. 셀당 표본이 11시드라면
 * `(행성, 레벨)` 한 점의 런은 77건이지만 **장비 추첨은 11번뿐**이다 — 즉 유효 표본이 √7 배
 * 부풀려져 있었다.
 *
 * 그리고 이 무대들에서 승패는 사실상 장비 추첨이 정한다. 실측(3,780런 격자)에서 시드별 승수가
 * 톡사르 Lv25 는 `0/7 ×9, 6/7, 7/7`, 크라스 Lv25 는 `0/7` 아니면 `6~7/7` 로 **거의 완전한
 * 이분**이었다 — 기체가 아니라 시드가 결과를 가른다. 표준 세트의 피해 배율이 주무기 타입
 * 추첨 때문에 시드 간 2배 가까이 벌어지고, 목표 게이트형 무대는 그 위에 DPS 문턱을 세우기
 * 때문이다(밸런스 큐 R8).
 *
 * 그 상태에서 **레벨별** 클리어율 게이트를 읽으면 장비 운이 레벨 곡선의 굴곡으로 위장한다 —
 * 실제로 Lv15·Lv70·Lv80 에 "전 기체 0%" 구멍이 보였고 그것이 구조적 약점처럼 읽혔다.
 *
 * ## 대가 — 기체 비교의 짝짓기를 포기한다
 * 예전 배선은 기체 비교에서 장비를 통제(같은 장비로 7종 비교)하는 이점이 있었다. 로스터 편차는
 * 기체당 전 행성·전 레벨 수백 런으로 접으므로 장비 운이 그 층에서 평균된다 — 반면 레벨별
 * 게이트는 접을 곳이 없어 그대로 오염된다. 그래서 정밀도를 게이트 쪽에 준다.
 *
 * 혼합은 `standardBuild.ts` 의 `mix32` 와 같은 계열(SplitMix32)이다. 정수 연산만 쓰므로
 * 결정론이 유지된다 — 같은 `(cell, seed)` 는 여전히 항상 같은 장비다.
 */
function gearSeed(cell: BalanceCell, seed: number): number {
  let h = (seed ^ Math.imul(cell.ship + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * 셀 한 칸을 시드 하나로 돌린다. 결정론적이다 — 같은 `(cell, seed)` 는 항상 같은 결과다.
 *
 * `maxTicks` 는 **테스트 전용 축소 손잡이**다(ADR-0051 갈래 ③). 기본값이 {@link MAX_TICKS} 라
 * 계측 경로(`scripts/balance/worker.mjs`)는 인자를 안 넘기고 거동이 바이트 동일하다. 배선 증명은
 * "값이 적용점에 도달했는가"만 보면 되므로 완주가 필요 없고, 수백 틱이면 족하다 —
 * 완주를 요구하면 그 한 축이 스위트 벽시계의 대부분을 먹는다(2026-08-06 실측: 92s/97s).
 */
export function runCellSeed(
  cell: BalanceCell,
  seed: number,
  maxTicks: number = MAX_TICKS,
): CellRunResult {
  const profile = defaultProfile();
  const ship = activeShip(profile);
  ship.typeId = cell.ship;
  ship.level = cell.level;
  ship.skillInvest = investVector(cell.ship, standardPerTree(cell.level));
  ship.equipped = standardEquipped(cell.level, gearSeed(cell, seed), cell.planet);

  const config = buildRunConfig(profile, {
    planet: cell.planet,
    // 단계는 기본적으로 레벨에서 파생된다(`ceil(Lv/5)`). `cell.stage` 는 그 둘을 떼어 놓아야만
    // 답할 수 있는 질문(트윙크 스톰프)을 위한 override 이고, 표준 격자는 항상 undefined 다.
    stage: cell.stage ?? standardStage(cell.level),
  });

  const state = createWorld(seed, config);
  const trace = newTrace();
  const policy = cell.powerup;

  let prevHp = state.entities[0]?.hp ?? 0;
  for (let i = 0; i < maxTicks; i++) {
    // 파워업 픽 오버라이드는 **여기**에 있지 `autopilot.ts` 에 있지 않다. 오토파일럿은 sim 계층
    // 이고 그 파일을 건드리면 골든 해시 계약이 걸린다 — 반면 여기서 프레임을 갈아 끼우면
    // 정책 미지정 런은 `autopilotInput(state)` 결과가 **그대로** 들어가 바이트 동일이 구조적으로
    // 보장된다(`tests/balanceHarness.test.ts` 의 교환 대조가 이를 못 박는다).
    stepWorld(state, pickOverride(state, autopilotInput(state), policy));
    const player = state.entities[0];
    if (player !== undefined) {
      if (player.hp < prevHp) attributeHpLoss(state, player, prevHp - player.hp, trace);
      prevHp = player.hp;
    }
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
