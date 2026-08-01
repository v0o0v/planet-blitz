#!/usr/bin/env node
/**
 * Planet Blitz balance round comparison.
 *
 * 한 회차 = "한 축을 바꾸고 전후를 같은 표로 대조한다". 그 대조표를 손으로 만들면 회차마다
 * node -e 한 줄짜리 집계 스크립트를 새로 짜게 되는데(2026-08-02 레인에서 회차마다 그랬다),
 * 그건 재현이 안 되고 시간·토큰을 그대로 태운다. 이 스크립트가 그 자리를 대신한다.
 *
 * 콘솔 출력은 사용자 콘솔에서 깨지지 않도록 **ASCII only** 로 유지한다(전역 규율).
 * 한글이 필요한 자리는 `--md` 로 내는 마크다운 표에만 둔다 — 그건 파일/문서용이다.
 *
 * Usage:
 *   node scripts/balance/compare.mjs .balance/before .balance/after
 *   node scripts/balance/compare.mjs .balance/before .balance/after --md
 *
 * Flags:
 *   --md        emit a Korean markdown table (paste into .omc/plans/balance-queue.md)
 *   --levels    also print the planet x level clear-rate grid for the AFTER set
 *
 * 두 산출 폴더는 `run.mjs --out=DIR` 이 남긴 `runs.json` 을 읽는다.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const dirs = argv.filter((a) => !a.startsWith('--'));
const wantMd = argv.includes('--md');
const wantLevels = argv.includes('--levels');

if (dirs.length !== 2) {
  console.error('usage: node scripts/balance/compare.mjs <beforeDir> <afterDir> [--md] [--levels]');
  process.exit(2);
}

/** 행성 이름은 리포트와 같은 순서(레지스트리 index)를 쓴다. 이름은 표시용일 뿐이다. */
const PLANET_NAMES = ['kargon', 'berdan', 'niflheim', 'arke', 'toxar', 'kras'];
const PLANET_NAMES_KO = ['카르곤', '베르단', '니플헤임', '아르케', '톡사르', '크라스'];

function load(dir) {
  const p = join(dir, 'runs.json');
  if (!existsSync(p)) {
    // 백그라운드 런이 0바이트로 조용히 죽는 사고가 이 리포에서 반복됐다 — 결과를 읽기 전에
    // 산출 폴더 존재부터 확인하라는 규율을 여기서 강제한다.
    console.error(`missing ${p} (the run may have died before writing output)`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}

const mean = (arr) => (arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length);

/**
 * 한 행성의 요약. `bossReachSec` 은 **승리 런의 양수 표본만** 본다 — 리포트의 `winPosMean` 과
 * 같은 규칙이다(패배 런을 섞으면 페이싱의 뜻이 무너진다).
 */
function summarize(runs, planet) {
  const s = runs.filter((r) => r.planet === planet);
  if (s.length === 0) return undefined;
  const won = s.filter((r) => r.won);
  const reach = won.map((r) => r.values.bossReachSec).filter((v) => v > 0);
  return {
    n: s.length,
    clear: (100 * won.length) / s.length,
    reach: mean(reach),
    levelUps: mean(s.map((r) => r.values.runLevelUps)),
    kills: mean(s.map((r) => r.values.kills)),
    timeout: 100 * mean(s.map((r) => r.values.timeoutRate)),
  };
}

let before = load(dirs[0]);
let after = load(dirs[1]);

/**
 * **공통 시드로 잘라서 비교한다.**
 *
 * 두 회차는 예산 안에서 도는 라운드 수가 달라 시드 수가 어긋난다(실측 13 vs 14). 그대로
 * 비교하면 **축을 건드리지 않은 행성까지 움직여** 대조군이 성립하지 않고, "레버가 의도한
 * 무대에만 걸렸다"는 증거를 잃는다 — 회차마다 가장 먼저 확인해야 하는 그 증거를.
 *
 * 교집합으로 자르면 미적용 행성은 **정확히 불변**이 되고, 움직인 값은 전부 축 때문이다.
 */
function commonSeeds(a, b) {
  const sa = new Set(a.map((r) => r.seed));
  const sb = new Set(b.map((r) => r.seed));
  return new Set([...sa].filter((x) => sb.has(x)));
}
const shared = commonSeeds(before, after);
const droppedA = new Set(before.filter((r) => !shared.has(r.seed)).map((r) => r.seed)).size;
const droppedB = new Set(after.filter((r) => !shared.has(r.seed)).map((r) => r.seed)).size;
before = before.filter((r) => shared.has(r.seed));
after = after.filter((r) => shared.has(r.seed));
if (droppedA + droppedB > 0) {
  console.log(
    `[compare] common seeds ${shared.size} (dropped ${droppedA} before-only, ${droppedB} after-only)`,
  );
}
if (shared.size === 0) {
  console.error('no shared seeds between the two runs - cannot compare');
  process.exit(1);
}

/**
 * **축 구성이 다르면 비교 자체가 성립하지 않는다.**
 *
 * 예산이 격자보다 작으면 러너가 축을 솎는다(`shrinkAxes`). 좁은 프로브는 레벨 10점을 다 도는데
 * 전 행성 런은 5점으로 솎이므로, 같은 코드에서도 니플헤임 38.8% vs 40.8% 처럼 갈린다 —
 * 무엇이 바뀌어서가 아니라 **모집단이 다르기 때문**이다. 그걸 회차 효과로 읽으면 없는 변화를
 * 튜닝하게 된다. 시드는 위에서 맞췄지만 축은 맞출 수 없으므로(없는 표본은 만들 수 없다) 여기서
 * 크게 경고한다.
 */
const axisOf = (runs, k) => [...new Set(runs.map((r) => r[k]))].sort((x, y) => x - y).join(',');
for (const k of ['level', 'ship', 'planet']) {
  const a = axisOf(before, k);
  const b = axisOf(after, k);
  if (a !== b) {
    console.log(`\n!! AXIS MISMATCH on "${k}": before=[${a}] after=[${b}]`);
    console.log('   the two runs cover different populations - differences below are NOT the axis.');
    console.log('   re-run both sides with the same --planets/--ships/--levels and budget.\n');
  }
}

const rows = [];
for (let p = 0; p < PLANET_NAMES.length; p++) {
  const a = summarize(before, p);
  const b = summarize(after, p);
  if (a === undefined || b === undefined) continue;
  rows.push({ p, a, b });
}

const d = (x) => (x >= 0 ? `+${x.toFixed(1)}` : x.toFixed(1));

if (wantMd) {
  console.log('| 행성 | 클리어율 | 보스도달 | 런내 레벨업 | 처치 | 타임아웃 |');
  console.log('|---|---|---|---|---|---|');
  for (const { p, a, b } of rows) {
    console.log(
      `| ${PLANET_NAMES_KO[p]} | ${a.clear.toFixed(1)}% → **${b.clear.toFixed(1)}%** ` +
        `| ${a.reach.toFixed(1)}s → ${b.reach.toFixed(1)}s ` +
        `| ${a.levelUps.toFixed(1)} → ${b.levelUps.toFixed(1)} ` +
        `| ${a.kills.toFixed(0)} → ${b.kills.toFixed(0)} ` +
        `| ${a.timeout.toFixed(1)}% → ${b.timeout.toFixed(1)}% |`,
    );
  }
} else {
  console.log(
    'planet     n     clear%                bossReach          levelUps     kills       timeout%',
  );
  for (const { p, a, b } of rows) {
    console.log(
      PLANET_NAMES[p].padEnd(11) +
        String(b.n).padEnd(6) +
        `${a.clear.toFixed(1)}->${b.clear.toFixed(1)} (${d(b.clear - a.clear)})`.padEnd(22) +
        `${a.reach.toFixed(1)}->${b.reach.toFixed(1)}s`.padEnd(19) +
        `${a.levelUps.toFixed(1)}->${b.levelUps.toFixed(1)}`.padEnd(13) +
        `${a.kills.toFixed(0)}->${b.kills.toFixed(0)}`.padEnd(12) +
        `${a.timeout.toFixed(1)}->${b.timeout.toFixed(1)}`,
    );
  }
  // 대조군 확인 — 축을 안 건드린 행성은 **런 하나하나가 그대로**여야 한다.
  //
  // ⚠️ 집계값 비교로는 안 된다. `runs.json` 의 배열 순서가 회차마다 달라 평균의 부동소수 합산
  // 순서가 바뀌고, 완전히 동일한 런 집합에서도 `90.53109649122808` vs `...811` 처럼 갈린다.
  // 그래서 `(셀, 시드)` 로 짝지어 **승패와 소요 틱**을 직접 대조한다 — 이건 정확하고, 레버가
  // 의도한 무대 밖으로 샜는지를 애매함 없이 가른다.
  const keyOf = (r) => `${r.planet}/${r.ship}/${r.level}/${r.seed}`;
  const beforeByKey = new Map(before.map((r) => [keyOf(r), r]));
  const changed = new Map();
  for (const r of after) {
    const a = beforeByKey.get(keyOf(r));
    if (a === undefined) continue;
    if (a.won !== r.won || a.ticks !== r.ticks) {
      changed.set(r.planet, (changed.get(r.planet) ?? 0) + 1);
    }
  }
  const still = rows.filter(({ p }) => !changed.has(p));
  const moved = rows.filter(({ p }) => changed.has(p));
  console.log(
    `\ncontrol (run-for-run identical): ${still.length === 0 ? 'NONE' : still.map(({ p }) => PLANET_NAMES[p]).join(', ')}`,
  );
  if (moved.length > 0) {
    console.log(
      `moved: ${moved.map(({ p }) => `${PLANET_NAMES[p]}(${changed.get(p)} runs)`).join(', ')}`,
    );
  }
  if (still.length === 0) {
    console.log('  warning: no control planet held still - the lever may not be mode-scoped.');
  }
}

if (wantLevels) {
  const levels = [...new Set(after.map((r) => r.level))].sort((x, y) => x - y);
  console.log('\nclear% by level (AFTER)');
  console.log('lv    ' + PLANET_NAMES.map((n) => n.slice(0, 8).padEnd(9)).join(''));
  for (const L of levels) {
    const cells = PLANET_NAMES.map((_, p) => {
      const s = after.filter((r) => r.level === L && r.planet === p);
      if (s.length === 0) return '-'.padEnd(9);
      return `${((100 * s.filter((r) => r.won).length) / s.length).toFixed(1)}%`.padEnd(9);
    });
    const all = after.filter((r) => r.level === L);
    const overall = (100 * all.filter((r) => r.won).length) / all.length;
    console.log(`lv${String(L).padEnd(4)}` + cells.join('') + `| all ${overall.toFixed(1)}%`);
  }
}
