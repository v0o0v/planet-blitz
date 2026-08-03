#!/usr/bin/env node
/**
 * Planet Blitz balance check runner.
 *
 * 한글 설명은 리포 문서(`docs/balance-check.md`)에 있다. 이 파일의 콘솔 출력은 사용자 콘솔에서
 * 깨지지 않도록 **ASCII only** 로 유지한다(전역 규율). 리포트 파일(.md)만 한글이다.
 *
 * Usage:
 *   pnpm balance                       10-minute budget, full grid
 *   pnpm balance -- --minutes=2        shorter budget
 *   pnpm balance -- --planets=0,3 --ships=0
 *   pnpm balance -- --gate             exit 1 when a gate fails (CI)
 *   pnpm balance -- --no-build         reuse the previous bundle
 *
 * Flags:
 *   --minutes=N      wall-clock budget in minutes (default 10)
 *   --seconds=N      budget in seconds (overrides --minutes)
 *   --workers=N      worker threads (default cpus-2, min 1)
 *   --planets=a,b    axis subset (default: every planet in data/planets)
 *   --ships=a,b      axis subset (default: every ship in data/ships)
 *   --levels=a,b     axis subset (default: every band level)
 *   --powerups=a,b   powerup pick policy axis (OPT-IN: omitted = current behaviour, offer slot 0)
 *   --min-rounds=N   seeds per cell to protect when shrinking the grid (default 8)
 *   --max-rounds=N   hard cap on seeds per cell (default 96)
 *   --out=DIR        output directory (default .balance)
 *   --no-raw         skip runs.json (the per-run dump)
 *   --no-build       reuse .balance/bundle/balance.mjs
 *   --gate           exit 1 if any gate fails
 *   --verbose        log every round (default: one line per 5s)
 *   --reanalyze=DIR  re-render report/summary from DIR/runs.json without running any sim
 */

import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};
const numList = (raw) =>
  raw === undefined
    ? undefined
    : String(raw)
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n));

const budgetSec = Number(opt('seconds', Number(opt('minutes', 10)) * 60));
const workerCount = Math.max(1, Number(opt('workers', Math.max(1, cpus().length - 2))));
const minRounds = Math.max(1, Number(opt('min-rounds', 8)));
const maxRounds = Math.max(1, Number(opt('max-rounds', 96)));
const outDir = resolve(ROOT, opt('out', '.balance'));
const wantRaw = !flag('no-raw');
const wantGate = flag('gate');
const verbose = flag('verbose');

/** Progress-log throttle. Small grids finish rounds several times a second. */
const PROGRESS_LOG_MS = 5000;
let lastLogMs = 0;

const selection = {};
const selPlanets = numList(opt('planets', undefined));
const selShips = numList(opt('ships', undefined));
const selLevels = numList(opt('levels', undefined));
if (selPlanets !== undefined) selection.planets = selPlanets;
if (selShips !== undefined) selection.ships = selShips;
if (selLevels !== undefined) selection.levels = selLevels;
// Opt-in axis: omitting --powerups leaves `powerup` off every cell, which keeps the grid
// byte-identical to the pre-axis behaviour (see src/bench/balance/powerupPolicy.ts).
const selPowerups = numList(opt('powerups', undefined));
if (selPowerups !== undefined) selection.powerups = selPowerups;

const log = (msg) => console.log(`[balance] ${msg}`);

// ---------------------------------------------------------------------------
// bundle
// ---------------------------------------------------------------------------

// 번들 위치는 `vite.balance.config.ts` 의 outDir 이 정본이라 `--out` 과 무관하게 고정이다
// (리포트를 다른 폴더에 쓰면서 번들을 못 찾는 사고를 실제로 한 번 냈다).
const bundlePath = resolve(ROOT, '.balance', 'bundle', 'balance.mjs');

if (!flag('no-build')) {
  const t0 = performance.now();
  log('building sim bundle (vite ssr) ...');
  const r = spawnSync('npx', ['vite', 'build', '--config', 'vite.balance.config.ts'], {
    cwd: ROOT,
    shell: true,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  if (r.status !== 0) {
    console.error('[balance] bundle build FAILED');
    process.exit(r.status ?? 1);
  }
  log(`bundle ok (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
}
if (!existsSync(bundlePath)) {
  console.error(`[balance] bundle missing: ${bundlePath} (drop --no-build)`);
  process.exit(1);
}

const bundleUrl = pathToFileURL(bundlePath).href;
const core = await import(bundleUrl);

// ---------------------------------------------------------------------------
// re-analysis (no simulation)
// ---------------------------------------------------------------------------

/**
 * Renders report.md + summary.json from a run set. Shared by the live path and --reanalyze,
 * so both always produce byte-identical structure from the same runs.
 * Returns the number of failed gates.
 */
function emitReport(rs, m, extra, dir, writeRaw) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.md'), core.renderReport(rs, m), 'utf8');
  const gates = core.evaluateGates(rs);
  const summary = {
    meta: { ...m, ...extra, totalRuns: rs.length },
    gates,
    cells: core.cellStats(rs),
    folds: {
      level: core.foldBy(rs, 'level'),
      planet: core.foldBy(rs, 'planet'),
      ship: core.foldBy(rs, 'ship'),
      // Opt-in axis: absent from standard-grid summaries, so those stay byte-identical.
      ...(rs.some((r) => r.powerup !== undefined) ? { powerup: core.foldBy(rs, 'powerup') } : {}),
    },
    spreads: {
      planet: core.spreadOf(rs, 'planet'),
      ship: core.spreadOf(rs, 'ship'),
      level: core.spreadOf(rs, 'level'),
      ...(rs.some((r) => r.powerup !== undefined) ? { powerup: core.spreadOf(rs, 'powerup') } : {}),
    },
  };
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  if (writeRaw) writeFileSync(join(dir, 'runs.json'), JSON.stringify(rs), 'utf8');

  if (extra.stopReason !== undefined) log(`stopped: ${extra.stopReason}`);
  const failed = gates.filter((g) => !g.pass);
  log(`GATES: ${gates.length - failed.length} pass / ${failed.length} fail`);
  for (const g of gates) {
    const pctBand = g.min <= 1 && g.max <= 1;
    const band = pctBand ? `${(g.min * 100).toFixed(0)}-${(g.max * 100).toFixed(0)}%` : `${g.min}-${g.max}`;
    const detail =
      g.violations.length === 0
        ? g.unjudged > 0
          ? `unjudged ${g.unjudged}`
          : 'ok'
        : g.violations
            .slice(0, 5)
            .map((v) => `${v.at}=${pctBand ? (v.observed * 100).toFixed(1) + '%' : v.observed.toFixed(2)}`)
            .join(' ') + (g.violations.length > 5 ? ` (+${g.violations.length - 5})` : '');
    log(`  ${g.pass ? 'PASS' : 'FAIL'} ${g.metric} [${band}] (${g.scope}) ${detail}`);
  }
  log(`report: ${join(dir, 'report.md')}`);
  return failed.length;
}

// `--reanalyze=DIR` re-reads DIR/runs.json and re-renders. No sim runs at all.
// This is what makes "changing the aggregation rules does not require re-measuring" true rather
// than merely documented — the gate scope fix (timeoutRate overall -> level) was validated this way.
const reanalyzeDir = opt('reanalyze', undefined);
if (reanalyzeDir !== undefined) {
  const dir = resolve(ROOT, reanalyzeDir);
  const prevRuns = JSON.parse(readFileSync(join(dir, 'runs.json'), 'utf8'));
  const prevMeta = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')).meta;
  log(`reanalyzing ${prevRuns.length} runs from ${dir} (no simulation)`);
  const n = emitReport(prevRuns, prevMeta, { stopReason: 'reanalyzed', reanalyzedAt: new Date().toISOString() }, dir, false);
  process.exit(wantGate && n > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// worker pool
// ---------------------------------------------------------------------------

const workerUrl = pathToFileURL(join(HERE, 'worker.mjs')).href;

class Pool {
  constructor(count) {
    this.slots = [];
    this.errors = 0;
    this.firstError = '';
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL(workerUrl), { workerData: { bundle: bundleUrl } });
      const slot = { w, busy: false, onDone: null };
      w.on('message', (msg) => {
        if (msg.type === 'ready') {
          slot.ready = true;
          return;
        }
        const cb = slot.onDone;
        slot.onDone = null;
        slot.busy = false;
        if (cb !== null) cb(msg);
      });
      w.on('error', (err) => {
        this.errors++;
        if (this.firstError === '') this.firstError = String(err);
        const cb = slot.onDone;
        slot.onDone = null;
        slot.busy = false;
        if (cb !== null) cb({ type: 'error', message: String(err) });
      });
      this.slots.push(slot);
    }
  }

  /**
   * Runs every job through the pool. `onResult(msg)` fires per completion.
   * `shouldAbort()` is polled before each dispatch — remaining jobs are dropped when it returns true.
   */
  run(jobs, onResult, shouldAbort) {
    return new Promise((done) => {
      let next = 0;
      let live = 0;
      let aborted = false;
      const pump = () => {
        while (true) {
          if (!aborted && shouldAbort !== undefined && shouldAbort()) aborted = true;
          if (aborted || next >= jobs.length) break;
          const slot = this.slots.find((s) => !s.busy);
          if (slot === undefined) break;
          const job = jobs[next++];
          slot.busy = true;
          live++;
          slot.onDone = (msg) => {
            live--;
            if (msg.type === 'error') {
              this.errors++;
              if (this.firstError === '') this.firstError = msg.message;
            } else {
              onResult(msg);
            }
            pump();
          };
          slot.w.postMessage({ type: 'job', id: next, cell: job.cell, seed: job.seed });
        }
        if (live === 0 && (aborted || next >= jobs.length)) done({ aborted });
      };
      pump();
    });
  }

  async terminate() {
    await Promise.all(this.slots.map((s) => s.w.terminate()));
  }
}

// ---------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------

const started = performance.now();
const elapsedMs = () => performance.now() - started;
const budgetMs = budgetSec * 1000;
// Hard stop: a round that badly overshoots is cut mid-flight so the process still ends on time.
const hardDeadlineMs = budgetMs * 1.2;

let axes = core.resolveAxes(selection);
const axisLine = (a) =>
  `planets=${a.planets.length} ships=${a.ships.length} levels=${a.levels.length} -> ${a.planets.length * a.ships.length * a.levels.length} cells`;
log(`axes: ${axisLine(axes)}`);

const pool = new Pool(workerCount);

// Calibration: a stratified mini-grid measures this machine's tick cost and the average run length.
// Cheap (a few hundred ms) and it means no hardware constant is baked into the repo.
const warmAxes = core.shrinkAxes(axes, workerCount * 2);
const warmCells = [];
for (const p of warmAxes.planets)
  for (const s of warmAxes.ships)
    for (const l of warmAxes.levels) warmCells.push({ planet: p.value, ship: s.value, level: l.value });

let warmTicks = 0;
let warmMs = 0;
let warmRuns = 0;
await pool.run(
  warmCells.map((cell) => ({ cell, seed: core.seedAt(0) })),
  (msg) => {
    warmTicks += msg.rec.ticks;
    warmMs += msg.ms;
    warmRuns++;
  },
  undefined,
);
const tickCostUs = warmTicks > 0 ? (warmMs * 1000) / warmTicks : 100;
const avgTicks = warmRuns > 0 ? warmTicks / warmRuns : 4000;
log(
  `calibration: ${tickCostUs.toFixed(1)} us/tick, ${avgTicks.toFixed(0)} ticks/run -> ${((avgTicks * tickCostUs) / 1000).toFixed(0)} ms/run (${warmRuns} runs)`,
);

const affordable = core.affordableCells({ budgetMs, workers: workerCount, tickCostUs, avgTicks, minRounds });
let cells = core.enumerateCells(selection);
if (cells.length > affordable) {
  axes = core.shrinkAxes(axes, affordable);
  const keepP = new Set(axes.planets.map((v) => v.value));
  const keepS = new Set(axes.ships.map((v) => v.value));
  const keepL = new Set(axes.levels.map((v) => v.value));
  cells = cells.filter((c) => keepP.has(c.planet) && keepS.has(c.ship) && keepL.has(c.level));
  log(`grid too large for budget (affordable ~${affordable} cells at ${minRounds} seeds) -> shrunk: ${axisLine(axes)}`);
} else {
  log(`budget fits the full grid (affordable ~${affordable} cells at ${minRounds} seeds)`);
}

// ---------------------------------------------------------------------------
// rounds
// ---------------------------------------------------------------------------

const runs = [];
const cellMs = new Map();
const seedsPerCell = new Map();
let round = 0;
let lastRoundMs = 0;
let stopReason = 'max rounds';
let aborted = false;

// Optional axes must be part of the cost key too: two cells that differ only by powerup policy
// have different run lengths, and the LPT ordering reads this map.
const keyOf = (c) => `${c.planet}/${c.ship}/${c.level}/${c.stage ?? ''}/${c.powerup ?? ''}`;

while (true) {
  const decision = core.decideNextRound({
    elapsedMs: elapsedMs(),
    budgetMs,
    lastRoundMs,
    completedRounds: round,
    maxRounds,
  });
  if (!decision.proceed) {
    stopReason = decision.reason;
    break;
  }

  const seed = core.seedAt(round);
  // Longest-processing-time first: sorting by the previous round's cost shortens the round tail,
  // which is the only waste the round barrier introduces.
  const ordered = [...cells].sort((a, b) => (cellMs.get(keyOf(b)) ?? 0) - (cellMs.get(keyOf(a)) ?? 0));
  const jobs = ordered.map((cell) => ({ cell, seed }));

  const t0 = performance.now();
  const res = await pool.run(
    jobs,
    (msg) => {
      runs.push(msg.rec);
      const k = keyOf(msg.rec);
      cellMs.set(k, msg.ms);
      seedsPerCell.set(k, (seedsPerCell.get(k) ?? 0) + 1);
    },
    () => elapsedMs() > hardDeadlineMs,
  );
  lastRoundMs = performance.now() - t0;
  round++;
  // 진행 로그는 5초에 한 번만 — 작은 격자는 라운드가 초당 여러 번 끝나서 로그가 수백 줄이 된다.
  if (verbose || elapsedMs() - lastLogMs >= PROGRESS_LOG_MS) {
    lastLogMs = elapsedMs();
    log(
      `round ${round} seed=${seed}: ${runs.length} runs so far, last round ${(lastRoundMs / 1000).toFixed(1)}s (elapsed ${(elapsedMs() / 1000).toFixed(0)}s / ${budgetSec}s)`,
    );
  }
  if (res.aborted) {
    aborted = true;
    stopReason = 'hard deadline reached mid-round';
    break;
  }
}

await pool.terminate();
if (pool.errors > 0) {
  console.error(`[balance] ${pool.errors} run(s) failed. first error:\n${pool.firstError}`);
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

let gitHead = 'unknown';
try {
  gitHead = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
} catch {
  /* not a git checkout - fine */
}

const counts = [...seedsPerCell.values()];
const meta = {
  at: new Date().toISOString(),
  gitHead,
  budgetSec,
  elapsedSec: elapsedMs() / 1000,
  workers: workerCount,
  cells: cells.length,
  rounds: round,
  seedsPerCell: {
    min: counts.length > 0 ? Math.min(...counts) : 0,
    max: counts.length > 0 ? Math.max(...counts) : 0,
  },
  axes,
  budgetExhausted: aborted || round < maxRounds,
};

const failedCount = emitReport(runs, meta, { stopReason, failedRuns: pool.errors }, outDir, wantRaw);
log(`total ${runs.length} runs in ${(elapsedMs() / 1000).toFixed(1)}s (budget ${budgetSec}s)`);
process.exit(wantGate && failedCount > 0 ? 1 : 0);
