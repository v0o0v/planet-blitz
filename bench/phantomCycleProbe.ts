/**
 * 팬텀 은신 사이클 실측 프로브 (P1) — `.omc/plans/skill-rebuild-2026-08-05/prerequisites.md` §3.
 *
 * ## 실행 (`vite-node` 는 PATH 에 없다 — 경로를 직접 준다)
 *   node node_modules/.pnpm/vite-node@2.1.9_supports-color@7.2.0/node_modules/vite-node/vite-node.mjs bench/phantomCycleProbe.ts -- --mode=main
 *
 * 인자: `--mode=main|mutation|selftest` · `--levels=10,50,100` · `--planets=0,2,5`
 *       `--pilots=still,evade` · `--ticks=14400` · `--json`
 * 환경: `SEEDS=n` 으로 시드 수 축소(기본 20 = seedAt(0..19) — P2·P3 프로브와 동일 좌표계).
 *
 * ## 판정 기준 (`phantom.md` ⑥ 선결 1)
 *   ① 진입 에지 발화 횟수 >= 1
 *   ② 은신 점유율 <= 구조 상한 HOLD/(UNHIT+HOLD) = 120/360
 *   ③ 토큰 발화 = 소진 + 피격 리셋 + 되감기 + 종료 잔량 (누수 0)
 *   ④ aux0 이 240 을 건너뛴 틱 0건 — **이 프로브로는 미측정**(아래)
 *
 * ## ④ 가 공허한 이유 (인계 `.omc/handoffs/adr-0051-engine-prereqs.md` §8)
 * aux0 을 건너뛸 수 있는 주체는 셋뿐이다: 자연 적립(+1 고정 · 구조적으로 못 건너뜀) ·
 * `enterCloak`(240 대입 · 못 건너뜀) · `phase_lo` 의 `setUnhitTicks(aux0 + advance)`.
 * 셋째는 액티브인데 **오토파일럿도 정지 파일럿도 액티브를 안 누른다**(전 분기 SPECIAL_NONE).
 * 그래서 ④ 는 자동으로 0건이 되지만 **아무것도 안 재고 얻은 0** 이다. 이 프로브는 관측한
 * 점프 사건 수를 그대로 찍되 판정은 「미측정」으로 보고한다.
 *
 * ## 계측 모델 — 왜 틱 끝 1회 표본으로 사건을 복원할 수 있는가
 * `stepWorld` 안 순서가 고정이다: stepPlayer, stepShipSignature(aux0 증가 · 진입 에지에서
 * aux1=1 · 360 도달 시 되감기), autoAttack(토큰 소진 · `state.cloakBreaks` 증가),
 * resolveCollisions(피격 시 aux0=0 · aux1=0). 세 사건이 한 틱에 겹칠 수 있어 틱 끝 aux1 만
 * 보면 놓친다. 그래서 **직전 틱 끝의 aux0 값**으로 이번 틱 사건을 복원한다:
 *   prevAux0 === 239 이면 이번 틱에 진입 에지 발화 / prevAux0 === 359 이면 이번 틱에 되감기
 *   cloakBreaks 델타는 소진 / aux0 이 0 인데 되감기가 아니면 피격 리셋
 * 복원한 토큰 상태를 틱 끝의 실제 aux1 과 **매 틱 대조**한다(`ledgerMismatch`). 이 값이
 * 0 이 아니면 모델이 틀린 것이므로 수치를 읽지 마라.
 *
 * 레벨업 프리즈·보물 detour 틱은 `stepShipSignature` 자체가 안 돈다(둘 다 조기 반환).
 * 그 틱은 사건 복원에서 빼고 aux0 불변만 자기점검한다(`frozenAux0Drift`).
 *
 * 출력은 ASCII 전용(PowerShell 콘솔 mojibake 회피). `src/sim/**` 는 한 줄도 안 건드린다 —
 * 뮤테이션도 sim 밖(이 파일)에서 상태를 덮어쓰는 방식으로만 건다.
 */

import { createWorld, stepWorld, SPECIAL_NONE, packPowerupPick } from '../src/sim/world.js';
import type { InputFrame, WorldState } from '../src/sim/world.js';
import type { Entity } from '../src/sim/entities.js';
import { autopilotInput } from '../src/sim/autopilot.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import { CLOAK_HOLD_TICKS, CLOAK_UNHIT_TICKS, SIG_PHANTOM_CLOAK } from '../src/sim/shipSignature.js';
import {
  investVector,
  standardEquipped,
  standardPerTree,
  standardStage,
} from '../src/bench/standardBuild.js';
import { seedAt } from '../src/bench/balance/seeds.js';

interface NodeProcess {
  readonly argv?: readonly string[];
  readonly env?: Record<string, string | undefined>;
  exitCode?: number;
  exit?: (code: number) => void;
}
const proc = (globalThis as { process?: NodeProcess }).process;
const ARGV: readonly string[] = proc?.argv ?? [];

function argOf(name: string): string | undefined {
  const pre = `--${name}=`;
  for (const a of ARGV) if (a.startsWith(pre)) return a.slice(pre.length);
  return undefined;
}

function numList(raw: string | undefined, dflt: readonly number[]): readonly number[] {
  if (raw === undefined) return dflt;
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
}

/** 관측이 비면 조용히 0바이트로 끝내지 않고 크게 죽는다(`bench/runCurve.ts` 와 같은 계약). */
function failEmpty(reason: string): never {
  console.error(`[NO-OUTPUT] ${reason}`);
  console.error('[NO-OUTPUT] nothing was measured -- exiting non-zero on purpose.');
  if (proc !== undefined) proc.exitCode = 1;
  proc?.exit?.(1);
  throw new Error(`[NO-OUTPUT] ${reason}`);
}

const PHANTOM_TYPE_ID = 3;
const STRIKER_TYPE_ID = 0;
const CYCLE_TICKS = CLOAK_UNHIT_TICKS + CLOAK_HOLD_TICKS;
const OCCUPANCY_BOUND = CLOAK_HOLD_TICKS / CYCLE_TICKS;

type Pilot = 'still' | 'evade';
type Mutant = 'none' | 'blockEntry' | 'blockToken';

function pilotInput(world: WorldState, pilot: Pilot): InputFrame {
  if (pilot === 'evade') return autopilotInput(world);
  if (world.pendingLevelUp) {
    return { moveX: 0, moveY: 0, aim: 0, dash: false, special: packPowerupPick(0) };
  }
  return { moveX: 0, moveY: 0, aim: 0, dash: false, special: SPECIAL_NONE };
}

interface RunObs {
  readonly planet: number;
  readonly level: number;
  readonly seed: number;
  readonly pilot: Pilot;
  readonly mutant: Mutant;
  readonly sigOk: boolean;
  readonly outcome: string;
  readonly ticks: number;
  readonly frozenTicks: number;
  readonly entries: number;
  readonly cloakTicks: number;
  readonly activeTicks: number;
  readonly cloakActiveTicks: number;
  readonly maxAux0: number;
  readonly consumes: number;
  readonly consumeInWindow: number;
  readonly consumeDelaySum: number;
  readonly hitClears: number;
  readonly rewindClears: number;
  readonly finalToken: number;
  readonly cloakBreaks: number;
  readonly hitResets: number;
  readonly hitsTaken: number;
  readonly skip240: number;
  readonly aux0Jumps: number;
  readonly ledgerMismatch: number;
  readonly breakWithoutToken: number;
  readonly frozenAux0Drift: number;
  readonly playerRefDrift: number;
}

function runOne(
  shipId: number,
  planet: number,
  level: number,
  seed: number,
  pilot: Pilot,
  mutant: Mutant,
  maxTicks: number,
): RunObs {
  const p = defaultProfile();
  const s = activeShip(p);
  s.typeId = shipId;
  s.level = level;
  s.skillInvest = investVector(shipId, standardPerTree(level));
  s.equipped = standardEquipped(level, seed, planet);
  const config = buildRunConfig(p, { planet, stage: standardStage(level) });
  const state = createWorld(seed, config);
  const sigOk = state.sigBit === SIG_PHANTOM_CLOAK;
  const player: Entity | undefined = state.entities[0];
  if (player === undefined) failEmpty('player entity missing at tick 0.');

  let prevAux0 = player.aux0;
  let prevBreaks = state.cloakBreaks;

  let entries = 0;
  let cloakTicks = 0;
  let activeTicks = 0;
  let cloakActiveTicks = 0;
  let maxAux0 = player.aux0;
  let consumes = 0;
  let consumeInWindow = 0;
  let consumeDelaySum = 0;
  let lastEntryTick = -1;
  let hitClears = 0;
  let rewindClears = 0;
  let hitResets = 0;
  let skip240 = 0;
  let aux0Jumps = 0;
  let ledgerMismatch = 0;
  let breakWithoutToken = 0;
  let frozenTicks = 0;
  let frozenAux0Drift = 0;
  let playerRefDrift = 0;

  for (let i = 0; i < maxTicks; i++) {
    const frozen = state.pendingLevelUp || state.encounterRuntime?.inDetour === 1;
    const prevAux1 = player.aux1;
    stepWorld(state, pilotInput(state, pilot));
    if (state.entities[0] !== player) playerRefDrift++;

    // 뮤테이션은 sim 밖에서만 건다(`src/sim/**` 미변경 계약).
    if (mutant === 'blockEntry' && player.aux0 >= CLOAK_UNHIT_TICKS - 40) player.aux0 = 0;
    if (mutant === 'blockToken') player.aux1 = 0;

    const aux0c = player.aux0;
    const aux1c = player.aux1;
    const db = state.cloakBreaks - prevBreaks;

    if (frozen) {
      frozenTicks++;
      if (aux0c !== prevAux0) frozenAux0Drift++;
    } else {
      let token = prevAux1;
      const entered = prevAux0 === CLOAK_UNHIT_TICKS - 1;
      const rewound = prevAux0 === CYCLE_TICKS - 1;
      if (entered) {
        entries++;
        lastEntryTick = i;
        token = 1;
      } else if (rewound && token === 1) {
        rewindClears++;
        token = 0;
      }
      if (db > 0) {
        if (token === 1) {
          consumes += db;
          if (aux0c >= CLOAK_UNHIT_TICKS && aux0c < CYCLE_TICKS) consumeInWindow += db;
          if (lastEntryTick >= 0) consumeDelaySum += i - lastEntryTick;
          token = 0;
        } else {
          breakWithoutToken += db;
        }
      }
      if (aux0c === 0 && !rewound) {
        hitResets++;
        if (token === 1) {
          hitClears++;
          token = 0;
        }
      }
      if (token !== aux1c) ledgerMismatch++;
      if (aux0c !== prevAux0 + 1 && aux0c !== 0) aux0Jumps++;
      if (prevAux0 < CLOAK_UNHIT_TICKS && aux0c > CLOAK_UNHIT_TICKS) skip240++;
    }

    const inWindow = aux0c >= CLOAK_UNHIT_TICKS && aux0c < CYCLE_TICKS;
    if (inWindow) cloakTicks++;
    // 프리즈·detour 틱은 사이클이 전진하지 않는데 state.tick 은 오른다. 구조 상한(②)의
    // 분모는 **사이클이 실제로 도는 틱**이어야 하므로 활성 틱을 따로 센다.
    if (!frozen) {
      activeTicks++;
      if (inWindow) cloakActiveTicks++;
    }
    if (aux0c > maxAux0) maxAux0 = aux0c;
    prevAux0 = aux0c;
    prevBreaks = state.cloakBreaks;
    if (state.victory || state.gameOver) break;
  }

  return {
    planet,
    level,
    seed,
    pilot,
    mutant,
    sigOk,
    outcome: state.victory ? 'victory' : state.gameOver ? 'death' : 'timeout',
    ticks: state.tick,
    frozenTicks,
    entries,
    cloakTicks,
    activeTicks,
    cloakActiveTicks,
    maxAux0,
    consumes,
    consumeInWindow,
    consumeDelaySum,
    hitClears,
    rewindClears,
    finalToken: player.aux1,
    cloakBreaks: state.cloakBreaks,
    hitResets,
    hitsTaken: state.hitsTaken,
    skip240,
    aux0Jumps,
    ledgerMismatch,
    breakWithoutToken,
    frozenAux0Drift,
    playerRefDrift,
  };
}

interface Dist {
  readonly n: number;
  readonly mean: number;
  readonly sd: number;
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
  readonly min: number;
  readonly max: number;
}

function dist(xs: readonly number[]): Dist {
  const n = xs.length;
  if (n === 0) return { n: 0, mean: 0, sd: 0, p25: 0, p50: 0, p75: 0, min: 0, max: 0 };
  const v = [...xs].sort((a, b) => a - b);
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const varr = v.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
  const q = (f: number): number => v[Math.min(n - 1, Math.max(0, Math.floor(f * (n - 1))))] ?? 0;
  return {
    n,
    mean,
    sd: Math.sqrt(varr),
    p25: q(0.25),
    p50: q(0.5),
    p75: q(0.75),
    min: v[0] ?? 0,
    max: v[n - 1] ?? 0,
  };
}

function f2(x: number): string {
  return x.toFixed(2);
}

function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

const PLANET_NAME: Record<number, string> = {
  0: 'kargon-vampire',
  2: 'niflheim-chase',
  5: 'kras-blockBreak',
};

function planetName(id: number): string {
  return PLANET_NAME[id] ?? String(id);
}

/** 계측 모델 자기점검 합계. 0 이 아니면 아래 수치를 읽으면 안 된다. */
function faultsOf(rows: readonly RunObs[]): number {
  return rows.reduce(
    (a, r) => a + r.ledgerMismatch + r.breakWithoutToken + r.frozenAux0Drift + r.playerRefDrift,
    0,
  );
}

/** ③ 토큰 누수가 있는 런 수 — 발화 != 소진 + 피격리셋 + 되감기 + 종료잔량. */
function leakRunsOf(rows: readonly RunObs[]): number {
  return rows.filter((r) => r.entries !== r.consumes + r.hitClears + r.rewindClears + r.finalToken)
    .length;
}

function summarize(label: string, rows: readonly RunObs[]): void {
  const e = dist(rows.map((r) => r.entries));
  const occ = dist(rows.map((r) => (r.ticks > 0 ? r.cloakTicks / r.ticks : 0)));
  const occA = dist(
    rows.map((r) => (r.activeTicks > 0 ? r.cloakActiveTicks / r.activeTicks : 0)),
  );
  const tk = dist(rows.map((r) => r.ticks));
  const zero = rows.filter((r) => r.entries === 0).length;
  const breaks = rows.reduce((a, r) => a + r.cloakBreaks, 0);
  console.log(
    label.padEnd(34) +
      ' n=' + String(rows.length).padStart(3) +
      ' entry mean=' + f2(e.mean).padStart(6) +
      ' sd=' + f2(e.sd).padStart(6) +
      ' p25/50/75=' + String(e.p25).padStart(3) + '/' + String(e.p50).padStart(3) +
      '/' + String(e.p75).padStart(3) +
      ' max=' + String(e.max).padStart(3) +
      ' zeroRuns=' + String(zero).padStart(2) +
      ' occMean=' + pct(occ.mean).padStart(6) +
      ' occMax=' + pct(occ.max).padStart(6) +
      ' occAmax=' + pct(occA.max).padStart(6) +
      ' breaks=' + String(breaks).padStart(5) +
      ' tickP50=' + String(tk.p50).padStart(5) +
      ' leak=' + leakRunsOf(rows) +
      ' faults=' + faultsOf(rows),
  );
}

/**
 * 죽은 계측기 대조 3종. **이것이 통과하지 않으면 본 측정의 0 은 아무 뜻이 없다.**
 *  A: 시그니처가 실제로 켜지는가(`state.sigBit`).
 *  B: aux0 을 238 로 인위 주입하면 두 틱 뒤 진입 에지가 실제로 서는가(aux1 = 1).
 *  C: 시그니처가 없는 기체(스트라이커)에서는 관측량이 0 인가 — 계측기가 팬텀 전용인가.
 */
function selftest(maxTicks: number): boolean {
  console.log('--- DEAD-INSTRUMENT CONTROL ---');
  let ok = true;

  const p = defaultProfile();
  const s = activeShip(p);
  s.typeId = PHANTOM_TYPE_ID;
  s.level = 50;
  s.skillInvest = investVector(PHANTOM_TYPE_ID, standardPerTree(50));
  s.equipped = standardEquipped(50, seedAt(0), 0);
  const state = createWorld(seedAt(0), buildRunConfig(p, { planet: 0, stage: standardStage(50) }));
  const sigOk = state.sigBit === SIG_PHANTOM_CLOAK;
  console.log('A sigBit=' + state.sigBit + ' want=' + SIG_PHANTOM_CLOAK + ' -> ' + (sigOk ? 'OK' : 'FAIL'));
  if (!sigOk) ok = false;

  const pl = state.entities[0];
  if (pl === undefined) return false;
  pl.aux0 = 238;
  pl.aux1 = 0;
  stepWorld(state, pilotInput(state, 'still'));
  const a1 = pl.aux0;
  const t1 = pl.aux1;
  stepWorld(state, pilotInput(state, 'still'));
  const a2 = pl.aux0;
  const t2 = pl.aux1;
  const entryOk = a1 === 239 && t1 === 0 && a2 >= CLOAK_UNHIT_TICKS && t2 === 1;
  console.log(
    'B inject aux0=238 -> t1 aux0=' + a1 + ' aux1=' + t1 + ' / t2 aux0=' + a2 + ' aux1=' + t2 +
      ' -> ' + (entryOk ? 'OK entry-edge fires' : 'FAIL instrument is dead'),
  );
  if (!entryOk) ok = false;

  const strk = runOne(STRIKER_TYPE_ID, 0, 50, seedAt(0), 'evade', 'none', Math.min(3600, maxTicks));
  const offOk = !strk.sigOk && strk.cloakBreaks === 0 && strk.cloakTicks === 0;
  console.log(
    'C striker-off sigOk=' + strk.sigOk + ' breaks=' + strk.cloakBreaks +
      ' cloakTicks=' + strk.cloakTicks + ' maxAux0=' + strk.maxAux0 + ' ticks=' + strk.ticks +
      ' -> ' + (offOk ? 'OK' : 'FAIL'),
  );
  if (!offOk) ok = false;

  console.log('SELFTEST=' + (ok ? 'PASS' : 'FAIL'));
  return ok;
}

function main(): void {
  const mode = argOf('mode') ?? 'main';
  const maxTicks = Number(argOf('ticks') ?? 14400);
  const levels = numList(argOf('levels'), [10, 50, 100]);
  const planets = numList(argOf('planets'), [0, 2, 5]);
  const pilots = (argOf('pilots') ?? 'still,evade').split(',') as Pilot[];
  const rawSeeds = proc?.env?.SEEDS;
  const nSeeds =
    rawSeeds === undefined || rawSeeds === '' ? 20 : Math.max(1, Number.parseInt(rawSeeds, 10));
  const seeds: number[] = [];
  for (let i = 0; i < nSeeds; i++) seeds.push(seedAt(i));
  const wantJson = ARGV.includes('--json');

  if (levels.length === 0) failEmpty('--levels resolved to an empty list.');
  if (planets.length === 0) failEmpty('--planets resolved to an empty list.');
  if (seeds.length === 0) failEmpty('SEEDS resolved to an empty list.');
  if (!Number.isFinite(maxTicks) || maxTicks < 1) failEmpty('--ticks is not a positive number.');

  console.error(
    '[p1] mode=' + mode + ' ship=phantom(' + PHANTOM_TYPE_ID + ') planets=' + planets.join(',') +
      ' levels=' + levels.join(',') + ' pilots=' + pilots.join(',') +
      ' seeds=' + seeds.length + ' ticks=' + maxTicks,
  );
  console.log(
    'CONFIG mode=' + mode + ' planets=' + planets.join(',') + ' levels=' + levels.join(',') +
      ' pilots=' + pilots.join(',') + ' seeds=' + seeds.length + ' maxTicks=' + maxTicks,
  );
  console.log(
    'CONSTANTS UNHIT=' + CLOAK_UNHIT_TICKS + ' HOLD=' + CLOAK_HOLD_TICKS +
      ' CYCLE=' + CYCLE_TICKS + ' occupancyBound=' + pct(OCCUPANCY_BOUND),
  );

  if (mode === 'selftest') {
    const ok = selftest(maxTicks);
    if (!ok) {
      if (proc !== undefined) proc.exitCode = 1;
      proc?.exit?.(1);
    }
    console.log('done.');
    return;
  }

  const mutants: Mutant[] =
    mode === 'mutation' ? ['none', 'blockEntry', 'blockToken'] : ['none'];

  const rows: RunObs[] = [];
  const t0 = Date.now();
  for (const mutant of mutants) {
    for (const pilot of pilots) {
      for (const planet of planets) {
        for (const level of levels) {
          for (const seed of seeds) {
            rows.push(runOne(PHANTOM_TYPE_ID, planet, level, seed, pilot, mutant, maxTicks));
          }
          const cell = rows.filter(
            (r) =>
              r.mutant === mutant && r.pilot === pilot && r.planet === planet && r.level === level,
          );
          console.error(
            '[p1] ' + mutant + '/' + pilot + '/' + planetName(planet) + '/Lv' + level +
              ': entries=' + cell.reduce((a, r) => a + r.entries, 0) +
              ' breaks=' + cell.reduce((a, r) => a + r.cloakBreaks, 0),
          );
        }
      }
    }
  }
  const elapsedMs = Date.now() - t0;

  const totalTicks = rows.reduce((a, r) => a + r.ticks, 0);
  if (rows.length === 0) failEmpty('zero runs were executed.');
  if (totalTicks === 0) failEmpty('zero ticks were stepped across all runs.');
  const sigBad = rows.filter((r) => !r.sigOk).length;
  if (sigBad > 0) failEmpty(sigBad + ' runs did not have SIG_PHANTOM_CLOAK active.');

  console.log('');
  console.log('SAMPLE runs=' + rows.length + ' totalTicks=' + totalTicks + ' sigOkRuns=' + rows.length);
  console.log('');
  console.log('--- per cell ---');
  for (const mutant of mutants) {
    for (const pilot of pilots) {
      for (const planet of planets) {
        for (const level of levels) {
          const cell = rows.filter(
            (r) =>
              r.mutant === mutant && r.pilot === pilot && r.planet === planet && r.level === level,
          );
          if (cell.length === 0) continue;
          summarize(mutant + '/' + pilot + '/' + planetName(planet) + '/L' + level, cell);
        }
      }
    }
  }

  console.log('');
  console.log('--- rollups ---');
  for (const mutant of mutants) {
    for (const pilot of pilots) {
      const cell = rows.filter((r) => r.mutant === mutant && r.pilot === pilot);
      if (cell.length > 0) summarize('ALL ' + mutant + '/' + pilot, cell);
    }
    const all = rows.filter((r) => r.mutant === mutant);
    if (all.length > 0) summarize('ALL ' + mutant + '/*', all);
  }

  const base = rows.filter((r) => r.mutant === 'none');
  console.log('');
  console.log('--- token ledger detail (mutant=none) ---');
  for (const pilot of pilots) {
    const cell = base.filter((r) => r.pilot === pilot);
    if (cell.length === 0) continue;
    console.log(
      pilot.padEnd(8) + ' entries=' + cell.reduce((a, r) => a + r.entries, 0) +
        ' = consume ' + cell.reduce((a, r) => a + r.consumes, 0) +
        ' + hitClear ' + cell.reduce((a, r) => a + r.hitClears, 0) +
        ' + rewindClear ' + cell.reduce((a, r) => a + r.rewindClears, 0) +
        ' + finalToken ' + cell.reduce((a, r) => a + r.finalToken, 0) +
        ' ; consumeInWindow=' + cell.reduce((a, r) => a + r.consumeInWindow, 0) +
        ' meanDelayTicks=' +
        (cell.reduce((a, r) => a + r.consumes, 0) > 0
          ? f2(
              cell.reduce((a, r) => a + r.consumeDelaySum, 0) /
                cell.reduce((a, r) => a + r.consumes, 0),
            )
          : 'n/a') +
        ' ; simCloakBreaks=' + cell.reduce((a, r) => a + r.cloakBreaks, 0) +
        ' hitResets=' + cell.reduce((a, r) => a + r.hitResets, 0) +
        ' hitsTaken=' + cell.reduce((a, r) => a + r.hitsTaken, 0),
    );
  }

  console.log('');
  console.log('--- verdicts (baseline mutant=none) ---');
  const c1Runs = base.filter((r) => r.entries >= 1).length;
  const occs = base.map((r) => (r.ticks > 0 ? r.cloakTicks / r.ticks : 0));
  const occMax = occs.reduce((a, b) => (b > a ? b : a), 0);
  const occsA = base.map((r) => (r.activeTicks > 0 ? r.cloakActiveTicks / r.activeTicks : 0));
  const occAMax = occsA.reduce((a, b) => (b > a ? b : a), 0);
  // 절단 무관 불변식: 진입 1회가 낼 수 있는 활성 창 틱은 최대 HOLD 다.
  const overHold = base.filter((r) => r.cloakActiveTicks > CLOAK_HOLD_TICKS * r.entries).length;
  const truncated = base.filter(
    (r) => r.activeTicks > 0 && r.cloakActiveTicks / r.activeTicks > OCCUPANCY_BOUND,
  ).length;
  const skips = base.reduce((a, r) => a + r.skip240, 0);
  const jumps = base.reduce((a, r) => a + r.aux0Jumps, 0);
  console.log(
    '(1) entry-edge >= 1 : ' + c1Runs + '/' + base.length + ' runs (' +
      pct(base.length > 0 ? c1Runs / base.length : 0) + ') totalEntries=' +
      base.reduce((a, r) => a + r.entries, 0),
  );
  console.log(
    '(2a) raw occupancy (denominator = every tick) bound=' + pct(OCCUPANCY_BOUND) +
      ' max=' + pct(occMax) + ' mean=' + pct(dist(occs).mean),
  );
  console.log(
    '(2b) active occupancy (denominator = ticks where the cycle advances) max=' +
      pct(occAMax) + ' mean=' + pct(dist(occsA).mean) +
      ' runsAboveBound=' + truncated + '/' + base.length,
  );
  console.log(
    '(2c) truncation-immune invariant cloakActiveTicks <= HOLD*entries : violations=' +
      overHold + '/' + base.length + ' -> ' + (overHold === 0 ? 'HOLDS' : 'VIOLATED'),
  );
  console.log(
    '(3) ledger leak runs=' + leakRunsOf(base) + '/' + base.length +
      ' instrumentFaults=' + faultsOf(base),
  );
  console.log(
    '(4) aux0 skipped-240 ticks=' + skips + ' ; aux0 delta anomalies=' + jumps +
      ' -- NOT MEASURED (no pilot presses actives; see file header)',
  );
  console.log('');
  console.log('elapsed: ' + (elapsedMs / 1000).toFixed(1) + 's');

  if (wantJson) {
    console.log('===JSON===');
    console.log(
      JSON.stringify({ meta: { mode, maxTicks, seeds, levels, planets, pilots, elapsedMs }, rows }),
    );
  }
  console.log('done.');
}

main();
