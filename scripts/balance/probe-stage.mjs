#!/usr/bin/env node
/**
 * Level x invasion-stage probe.
 *
 * The standard `pnpm balance` grid ties the two together (`stage = ceil(Lv/5)`), so questions that
 * need them SEPARATED are structurally unanswerable there. Two such questions:
 *
 *   1. "twink stomp" - boss HP does not scale with the invasion stage while gear/skills scale to
 *      Lv100, so a max-level pilot on a low stage may be trivially overpowered (balance queue R23).
 *   2. MIN_BOSS_KILL_TICKS - the fastest honest victory must be measured at Lv100 / stage 1, which
 *      is exactly the cell the standard grid cannot produce (R24).
 *
 * Console output is ASCII only (repo rule). Raw records go to <out>/runs.json.
 *
 * Usage:
 *   node scripts/balance/probe-stage.mjs --planets=0,1 --ships=0 --levels=5,100 --stages=1,20 --seeds=8
 *
 * Flags:
 *   --planets/--ships/--levels/--stages   axis lists (required to be explicit; no silent defaults)
 *   --seeds=N        seeds per cell (default 8)
 *   --workers=N      worker threads (default cpus-2)
 *   --out=DIR        output dir (default .balance/probe-stage)
 *   --no-build       reuse the previous bundle
 *   --label=TEXT     header line for the printed table
 */

import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit === undefined ? d : hit.slice(n.length + 3);
};
const list = (raw) =>
  String(raw)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));

const planets = list(opt('planets', '0,1,2,3,4,5'));
const ships = list(opt('ships', '0'));
const levels = list(opt('levels', '5,25,50,75,100'));
const stages = list(opt('stages', '1,5,10,15,20'));
const seedCount = Math.max(1, Number(opt('seeds', 8)));
const workerCount = Math.max(1, Number(opt('workers', Math.max(1, cpus().length - 2))));
const outDir = resolve(ROOT, opt('out', '.balance/probe-stage'));
const label = opt('label', 'level x stage probe');
const log = (m) => console.log(`[probe] ${m}`);

const bundlePath = resolve(ROOT, '.balance', 'bundle', 'balance.mjs');
if (!flag('no-build')) {
  log('building sim bundle (vite ssr) ...');
  const r = spawnSync('npx', ['vite', 'build', '--config', 'vite.balance.config.ts'], {
    cwd: ROOT,
    shell: true,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  if (r.status !== 0) {
    console.error('[probe] bundle build FAILED');
    process.exit(r.status ?? 1);
  }
}
if (!existsSync(bundlePath)) {
  console.error(`[probe] bundle missing: ${bundlePath} (drop --no-build)`);
  process.exit(1);
}
const bundleUrl = pathToFileURL(bundlePath).href;
const core = await import(bundleUrl);

const jobs = [];
for (const p of planets)
  for (const s of ships)
    for (const lv of levels)
      for (const st of stages)
        for (let i = 0; i < seedCount; i++)
          jobs.push({ cell: { planet: p, ship: s, level: lv, stage: st }, seed: core.seedAt(i) });

log(
  `${jobs.length} runs = planets ${planets.length} x ships ${ships.length} x levels ${levels.length} x stages ${stages.length} x seeds ${seedCount}`,
);

// --- minimal worker pool (same protocol as scripts/balance/worker.mjs) -------
const workerUrl = pathToFileURL(join(HERE, 'worker.mjs')).href;
const slots = [];
for (let i = 0; i < workerCount; i++) {
  const w = new Worker(new URL(workerUrl), { workerData: { bundle: bundleUrl } });
  const slot = { w, busy: false, onDone: null };
  w.on('message', (msg) => {
    if (msg.type === 'ready') return;
    const cb = slot.onDone;
    slot.onDone = null;
    slot.busy = false;
    if (cb !== null) cb(msg);
  });
  slots.push(slot);
}

const runs = [];
let errors = 0;
const t0 = performance.now();
await new Promise((done) => {
  let next = 0;
  let live = 0;
  const pump = () => {
    while (next < jobs.length) {
      const slot = slots.find((s) => !s.busy);
      if (slot === undefined) break;
      const job = jobs[next++];
      slot.busy = true;
      live++;
      slot.onDone = (msg) => {
        live--;
        if (msg.type === 'error') errors++;
        else runs.push(msg.rec);
        if (runs.length % 500 === 0) log(`${runs.length}/${jobs.length} runs`);
        pump();
      };
      slot.w.postMessage({ type: 'job', id: next, cell: job.cell, seed: job.seed });
    }
    if (live === 0 && next >= jobs.length) done();
  };
  pump();
});
await Promise.all(slots.map((s) => s.w.terminate()));
log(`done in ${((performance.now() - t0) / 1000).toFixed(1)}s (${errors} errors)`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'runs.json'), JSON.stringify(runs), 'utf8');

// --- report (ASCII only) -----------------------------------------------------
const planetNames = new Map(core.planetAxis().map((a) => [a.value, a.label.replace(/[^\x20-\x7e]/g, '')]));
const pct = (x) => `${(x * 100).toFixed(1)}%`;

console.log('');
console.log(`=== ${label} ===`);
console.log('');

// Clear rate: rows = level, cols = stage.
console.log('clear rate  (rows = level, cols = stage)');
console.log(`Lv\\st | ${stages.map((s) => String(s).padStart(7)).join(' |')}`);
for (const lv of levels) {
  const cells = stages.map((st) => {
    const rs = runs.filter((r) => r.level === lv && r.stage === st);
    return rs.length === 0 ? '     -' : pct(rs.filter((r) => r.won).length / rs.length).padStart(7);
  });
  console.log(`${String(lv).padStart(5)} | ${cells.join(' |')}`);
}
console.log('');

// Boss kill time proxy: victory run length (ticks -> seconds).
console.log('victory run seconds, mean (rows = level, cols = stage)');
console.log(`Lv\\st | ${stages.map((s) => String(s).padStart(7)).join(' |')}`);
for (const lv of levels) {
  const cells = stages.map((st) => {
    const rs = runs.filter((r) => r.level === lv && r.stage === st && r.won);
    if (rs.length === 0) return '     -';
    const m = rs.reduce((a, r) => a + r.ticks, 0) / rs.length / 60;
    return m.toFixed(1).padStart(7);
  });
  console.log(`${String(lv).padStart(5)} | ${cells.join(' |')}`);
}
console.log('');

// Boss DPS: how hard the boss actually is per stage.
console.log('bossDps mean (rows = level, cols = stage)');
console.log(`Lv\\st | ${stages.map((s) => String(s).padStart(7)).join(' |')}`);
for (const lv of levels) {
  const cells = stages.map((st) => {
    const rs = runs.filter(
      (r) => r.level === lv && r.stage === st && r.won && (r.values.bossDps ?? 0) > 0,
    );
    if (rs.length === 0) return '     -';
    const m = rs.reduce((a, r) => a + r.values.bossDps, 0) / rs.length;
    return m.toFixed(0).padStart(7);
  });
  console.log(`${String(lv).padStart(5)} | ${cells.join(' |')}`);
}
console.log('');

// Fastest victories overall - the MIN_BOSS_KILL_TICKS question.
const wins = runs.filter((r) => r.won).sort((a, b) => a.ticks - b.ticks);
if (wins.length > 0) {
  const q = (f) => wins[Math.min(wins.length - 1, Math.floor(wins.length * f))].ticks;
  console.log(`victories: ${wins.length}/${runs.length}`);
  console.log(
    `fastest victory ticks: min=${wins[0].ticks} p1=${q(0.01)} p5=${q(0.05)} p10=${q(0.1)} p50=${q(0.5)}`,
  );
  const w0 = wins[0];
  console.log(
    `  min at planet=${planetNames.get(w0.planet) ?? w0.planet} ship=${w0.ship} lv=${w0.level} stage=${w0.stage} seed=${w0.seed}`,
  );
  console.log('per-planet fastest victory ticks (blank = no victory sampled):');
  for (const p of planets) {
    const pw = wins.filter((r) => r.planet === p);
    console.log(
      `  ${String(planetNames.get(p) ?? p).padEnd(12)} n=${String(pw.length).padStart(4)} min=${pw.length === 0 ? '-' : pw[0].ticks}`,
    );
  }
} else {
  console.log('no victories sampled');
}
console.log('');
log(`raw: ${join(outDir, 'runs.json')}`);
