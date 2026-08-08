/**
 * **초당 피격량 프로브** — 명목표의 시그니처 비율을 정할 때 유일하게 실측이 필요한 값.
 *
 * ## 왜 이것을 재야 하는가
 * `src/bench/nominalPower.ts` 는 닫힌 식이라 실측이 필요 없지만, **플랫 시그니처를 비율로
 * 재설계할 때만은 예외**다. 버블 막(주기적 흡수)이 상쇄하는 초당 피해와 **실제로 받는** 초당
 * 피해의 비가 곧 그 시그니처의 실효 배율이고, 후자는 sim 을 돌려야만 나온다.
 *
 * 초판 막(`FILM_ABSORB_FLAT = 60` / 7초 = 8.57 DPS 상쇄)이 위험했던 이유가 정확히 이것이다 —
 * 받는 피해가 8.57 미만이면 EHP 의 분모가 0 이하가 되어 **문자 그대로 불사**다. 그 임계가
 * 실제 교전 구간의 어디에 있는지는 재 봐야만 안다.
 *
 * ## 무엇을 재는가 — **총 피격량**(mitigation 이전이 아니라 "선체가 잃은 양")
 * 매 틱 `player.hp` 의 **감소분만** 누적한다(회복·픽업으로 오르는 틱은 0 으로 센다). 그래서
 * 값의 뜻은 *"선체가 초당 몇 HP 를 잃는가"* 다.
 *
 * 기체는 **스트라이커 고정**이다 — 시그니처가 공격 축뿐이라 방어 감산이 한 톨도 안 끼고,
 * 이 레인의 기준점 기체이기도 하다(다른 기체로 재면 그 기체의 방어 시그니처가 값에 섞인다).
 *
 * ## ⚠️ 내구 파일럿이 필수다 — 안 쓰면 표본이 죽는 시점에 잘린다
 * `PLAYER_DAMAGE_TAKEN_MULT` 2배 이후 무입력 파일럿은 런을 완주하지 못한다(ADR-0051). 기본
 * HP 로 재면 표본 창이 "죽기까지"로 잘려 초반 저밀도 구간에 치우친다. 그래서 HP 를 크게 올려
 * **고정 창**(`--ticks`)을 끝까지 돌린다. HP 를 올려도 적의 화력·밀도는 안 변하므로 초당
 * 피격량 자체는 왜곡되지 않는다.
 *
 * ## 결정론
 * `Math.random`·`Date.now` 를 쓰지 않는다. 시드는 인자에서만 온다.
 *
 * ## 사용
 * ```
 * node node_modules/.pnpm/vite-node@2.1.9_supports-color@7.2.0/node_modules/vite-node/vite-node.mjs \
 *   bench/incomingDps.ts -- --levels=5,50,100 --seeds=6
 * ```
 * 인자: `--levels=` · `--seeds=`(시드 개수) · `--ticks=`(런당 틱) · `--gear=none|standard`
 */

import { defaultProfile, activeShip } from '../src/save/profile.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import { beginMeasureRun } from '../src/sim/measurePilot.js';
import { measurePilotInput } from '../src/sim/measurePilot.js';
import { standardEquipped, standardPerTree, investVector } from '../src/bench/standardBuild.js';
import { standardStage } from '../src/save/progressionPath.js';
import { starterEquipped } from '../src/items/starterKit.js';
import { TICK_RATE } from '../src/sim/constants.js';

/** 기준점 기체 = 스트라이커(typeId 0). 방어 시그니처가 없어 값에 감산이 안 낀다. */
const SHIP_STRIKER = 0;

/** 내구 파일럿 HP. 표본 창이 죽음으로 잘리지 않을 만큼만 크면 된다(§내구 파일럿). */
const DURABLE_HP = 200_000;

/** 런당 기본 측정 틱. 60틱 = 1초이므로 5400틱 = 90초 ≈ 표준 런 par(95초). */
const DEFAULT_TICKS = 5400;

/** `bench/runCurve.ts` 와 같은 관용구 — DOM lib 타이핑 아래에서 node 의 `process` 를 좁게 본다. */
interface NodeProcess {
  readonly argv?: readonly string[];
}

const proc = (globalThis as { process?: NodeProcess }).process;
const ARGV: readonly string[] = proc?.argv ?? [];

function argOf(name: string): string | undefined {
  const pre = `--${name}=`;
  for (const a of ARGV) if (a.startsWith(pre)) return a.slice(pre.length);
  return undefined;
}

function numList(raw: string | undefined, fallback: readonly number[]): number[] {
  if (raw === undefined) return [...fallback];
  const out = raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return out.length > 0 ? out : [...fallback];
}

/** 한 런의 측정 결과. */
interface Sample {
  /** 선체가 잃은 총 HP. */
  readonly hpLost: number;
  /**
   * 창 평균 **동시 생존 적 수**. 밀도 패스(`src/sim/enemyScale.ts`)가 실제로 화면 밀도를
   * 올렸는지의 직접 증거다 — 피격량만 보면 "적이 늘고 약해져 상쇄됐다" 와 "적이 안 늘었다"
   * 를 구분할 수 없다.
   */
  readonly avgEnemies: number;
  /** 창 평균 **동시 생존 적탄 수**. 위와 같은 사유(탄 축). */
  readonly avgBullets: number;
  /**
   * 창 평균 **동시 생존 바닥 해저드 수**(용암·박격 장판). `HAZARD_RATE_MULT` 가 실제로 걸렸는지의
   * 직접 증거다 — 주기를 늘려도 화면에 남는 장판 수는 지속 시간에도 달려 있어 계산으로는 못 낸다.
   */
  readonly avgHazards: number;
  /** 처치 수 — 적 수 ×1.3 · HP ×1/1.3 짝이 성립하면 약 1.3배가 돼야 한다. */
  readonly kills: number;
  /** 측정한 틱 수(런이 일찍 끝나면 그 시점까지). */
  readonly ticks: number;
  /** 그 창에서 실제로 피격이 있었던 틱 수(교전 밀도의 대리 지표). */
  readonly hitTicks: number;
}

function measureOne(level: number, seed: number, ticks: number, gearless: boolean): Sample {
  const stageNo = standardStage(level);
  const p = defaultProfile();
  const s = activeShip(p);
  s.typeId = SHIP_STRIKER;
  s.level = level;
  s.skillInvest = investVector(SHIP_STRIKER, standardPerTree(level));
  if (gearless) {
    s.equipped = {};
  } else {
    // 하네스 「표준 빌드 점프」와 **같은 폴백 규칙**을 쓴다 — 표준 세트가 비는 Lv1~4 에서는
    // 스타터 킷이 실제 플레이어 상태다(`cheatPanel.ts` 의 `applyStandardBuild` §Lv1~4 폴백).
    const std = standardEquipped(level, seed, 0);
    s.equipped = Object.keys(std).length === 0 ? starterEquipped() : std;
  }
  const config = buildRunConfig(p, { planet: 0, stage: stageNo });
  // 내구 파일럿(§내구 파일럿). 적 화력·밀도는 안 변하므로 초당 피격량은 왜곡되지 않는다.
  config.playerHp = DURABLE_HP;
  const state = createWorld(seed, config);
  beginMeasureRun(state);

  let hpLost = 0;
  let hitTicks = 0;
  let enemySum = 0;
  let bulletSum = 0;
  let hazardSum = 0;
  let prev = state.entities[0]?.hp ?? 0;
  let t = 0;
  for (; t < ticks; t++) {
    stepWorld(state, measurePilotInput(state));
    const hp = state.entities[0]?.hp ?? 0;
    // **감소분만** 센다 — 회복·픽업으로 오르는 틱은 0(§무엇을 재는가).
    if (hp < prev) {
      hpLost += prev - hp;
      hitTicks++;
    }
    prev = hp;
    let en = 0;
    let bu = 0;
    let hz = 0;
    for (const e of state.entities) {
      if (e.dead) continue;
      if (e.kind === 'enemy') en++;
      else if (e.kind === 'enemyBullet') bu++;
      else if (e.kind === 'hazard') hz++;
    }
    enemySum += en;
    bulletSum += bu;
    hazardSum += hz;
    if (state.victory || state.gameOver) {
      t++;
      break;
    }
  }
  return {
    hpLost,
    ticks: t,
    hitTicks,
    avgEnemies: t > 0 ? enemySum / t : 0,
    avgBullets: t > 0 ? bulletSum / t : 0,
    avgHazards: t > 0 ? hazardSum / t : 0,
    kills: state.kills,
  };
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const v = [...xs].sort((a, b) => a - b);
  const mid = v.length >> 1;
  const lo = v[mid - 1] ?? 0;
  const hi = v[mid] ?? 0;
  return v.length % 2 === 1 ? (v[mid] ?? 0) : (lo + hi) / 2;
}

function main(): void {
  const levels = numList(argOf('levels'), [5, 50, 100]);
  const seedCount = Math.max(1, Math.floor(Number(argOf('seeds') ?? 6)));
  const ticks = Math.max(60, Math.floor(Number(argOf('ticks') ?? DEFAULT_TICKS)));
  const gearless = argOf('gear') === 'none';

  console.log(
    `# incomingDps — striker · planet 0 · ${gearless ? 'gear=none' : 'gear=standard(+starter fallback)'} · ` +
      `durableHp=${DURABLE_HP} · ticks<=${ticks} · seeds=${seedCount}`,
  );
  console.log('LV  STAGE   RUNS   DPS(med)   DPS(min)   DPS(max)   ENEMIES   BULLETS   HAZARDS   KILLS');
  for (const level of levels) {
    const dps: number[] = [];
    const hitRates: number[] = [];
    const tickSpans: number[] = [];
    const enemies: number[] = [];
    const bullets: number[] = [];
    const hazards: number[] = [];
    const kills: number[] = [];
    const perSeed: string[] = [];
    for (let i = 0; i < seedCount; i++) {
      // 시드는 인자 파생 상수열이다(RNG 를 쓰지 않는다 — §결정론).
      const seed = (0x51ce_0000 + i * 0x9e37_79b1) >>> 0;
      const r = measureOne(level, seed, ticks, gearless);
      if (r.ticks <= 0) continue;
      dps.push(r.hpLost / (r.ticks / TICK_RATE));
      hitRates.push(r.hitTicks / r.ticks);
      tickSpans.push(r.ticks);
      enemies.push(r.avgEnemies);
      bullets.push(r.avgBullets);
      hazards.push(r.avgHazards);
      kills.push(r.kills);
      perSeed.push(`${(r.hpLost / (r.ticks / TICK_RATE)).toFixed(1)}@${r.ticks}t`);
    }
    const stageNo = standardStage(level);
    console.log(
      `${String(level).padStart(3)} ${String(stageNo).padStart(5)}  ${String(dps.length).padStart(5)}   ` +
        `${median(dps).toFixed(2).padStart(8)}   ${Math.min(...dps).toFixed(2).padStart(8)}   ` +
        `${Math.max(...dps).toFixed(2).padStart(8)}   ${median(enemies).toFixed(1).padStart(7)}   ` +
        `${median(bullets).toFixed(1).padStart(7)}   ${median(hazards).toFixed(2).padStart(7)}   ` +
        `${median(kills).toFixed(0).padStart(5)}`,
    );
    // 시드별 원값 — 중앙값이 0 인 구간이 "안 맞았다" 인지 "표본 창이 잘렸다" 인지 가른다.
    console.log(
      `      seeds: ${perSeed.join(' ')} | hit ${(median(hitRates) * 100).toFixed(1)}% | ticks ${median(tickSpans).toFixed(0)}`,
    );
  }
}

main();
