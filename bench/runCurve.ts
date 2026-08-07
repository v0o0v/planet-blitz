/**
 * 표준 빌드 곡선 스윕 CLI — 런 길이 par · 완주 가능성 · 런당 경제 유입 재측정 진입점.
 *
 * ## 실행
 *   node node_modules/.pnpm/vite-node@<버전>/node_modules/vite-node/vite-node.mjs bench/runCurve.ts
 * (`<버전>` 은 `ls node_modules/.pnpm | grep '^vite-node'` 로 확인한다. `vite-node` 는 PATH 에 없다.)
 *
 * 축소 실행(배선 확인용) — `bench/` 의 다른 둘과 같은 관용구다:
 *   SEEDS=3 node .../vite-node.mjs bench/runCurve.ts -- --levels=10,40
 * 기본값은 96시드 x 표준 레벨 20점이라 수십 분 걸린다.
 *
 * 인자: `--levels=10,40` · `--ship=0` · `--planet=0` · `--json` · `--md`
 * 기본 출력은 **ASCII 요약표**다. `--md` 는 연구 문서용 마크다운(한글 포함)을 **추가로** 낸다.
 *
 * ## 촉매 파워 스윕 모드 — `--catalysts=17,22,29` (ADR-0052 레인 F2, 감사표 §미해결 1)
 * 지정하면 위 무촉매 모드 대신 **무촉매 기준선과 짝지은 배수**를 낸다 — 설계 명세 `파워:` 칸의
 * 정의가 절대값이 아니라 "무촉매 대비 클리어 시간 등 배수"이기 때문이다. 같은 레벨·같은 시드로
 * base(`catalysts:[]`)·cat(`catalysts:[...]`) 두 런을 돌려 clearRate·clearSec·bossReachRate·
 * xpTotal·lootCount 의 catalyst/base 배수를 낸다. `--json`/`--md` 는 아직 이 모드에 없다.
 *   SEEDS=5 node .../vite-node.mjs bench/runCurve.ts -- --levels=10,40 --catalysts=17,22,29
 *
 * ⚠️ **지금은 배수가 전부 1.00(±xp/loot 는 그대로) 이 정상이다** — `src/sim/catalystHooks.ts`
 * 전 분기가 아직 스텁이라 촉매가 sim 산술에 실제로 개입하지 않는다(ADR-0052 배선 레인이 나중에
 * 채운다). 대신 이 모드는 **계측기가 촉매 id 를 실제로 싣고 있다는 것**을 `hashDiverge` 열로
 * 증명한다 — `config.catalysts` 는 `createWorld` 직후 정규화되어 해시 꼬리에 즉시 접히므로
 * (`src/sim/replay.ts` :530-538), 시뮬레이션을 한 틱도 안 돌려도 촉매 유무 두 런의 tick0 해시가
 * 갈린다. `hashDiverge=NO(bug!)` 가 뜨면 그건 계측기 결함이지 sim 배선 문제가 아니다.
 *
 * ⚠️ **조향은 `measurePilotInput` 을 쓴다**(얼어붙은 `autopilotInput` 이 아니다) — 대시 발동
 * 촉매(id 27·29 등)를 재려면 봇이 실제로 대시를 눌러야 하는데 `autopilotInput` 은 전 분기
 * `dash:false` 로 동결돼 있다(`src/sim/autopilot.ts`). `src/sim/measurePilot.ts` 가 이미
 * "쿨다운 0 이면 누른다" 정책의 측정 전용 파일럿을 제공하므로 그것을 그대로 쓴다(정책은
 * `autopilot.ts` 를 고치지 않고도 이 파일 안에서만 바꿀 수 있다). base·cat 두 런이 같은
 * 파일럿을 쓰므로 비교는 여전히 촉매 유무만의 차이다. 단 `id 1`(plunder — 엘리트/보스를
 * **몸으로 부딪혀야** 강탈)처럼 접촉 자체가 필요한 카드는 `measurePilotInput` 으로도 못 잰다
 * — 그 파일럿도 카이팅 조향(`pilotSteer`)이라 근접전을 만들지 않는다. 자세한 사유는 아래 보고.
 *
 * ## 왜 이 파일이 생겼는가 — "조용한 성공"이 있었다 (2026-08-06)
 * 곡선 스윕은 원래 `src/bench/rosterBench.ts` 의 `main()` 안 `--curve` 분기였고, 그 분기는
 * `isCliEntry()` 뒤에 있었다. 그런데 `isCliEntry()` 는 `argv[1]` 이 `rosterBench.ts` 인지만
 * 보는데 **`vite-node` 는 스크립트 경로를 argv 에서 통째로 지운다**:
 *   `node vite-node.mjs src/bench/rosterBench.ts -- --curve --md`
 *   -> `argv = [node, vite-node.mjs, --curve, --md]`
 * 그래서 게이트가 조용히 거짓이 되고 **stdout 0바이트 · 종료 코드 0** 으로 끝났다(실측).
 * 죽은 계측기의 가장 나쁜 형태다 — 빨갛게 죽지 않고 **성공한 척** 한다. 인계 문서에 "곡선
 * 진입점은 바로 쓸 수 있다"고 적혀 있었는데도 재측정마다 임시 vitest 파일을 만들었다 지우는
 * 절차가 남아 있던 이유가 이것이다. 아무도 버튼이 안 눌린다는 걸 몰랐다.
 *
 * 그래서 **곡선 손잡이를 여기 하나로 모았다.** `rosterBench.ts` 의 `--curve` 분기는 지웠다 —
 * 손잡이가 둘이면 조용히 갈린다(이 저장소가 "같은 술어를 세 곳에 적어 화면과 규칙이 갈렸다"로
 * 이미 겪은 실패다. 실제로 `--levels` 축소 손잡이를 한쪽에만 붙일 뻔했다).
 *
 * ## 이 파일의 계약: 관측이 비면 **크게** 실패한다
 * 위 사건의 본질이 "출력이 없는데 종료 코드가 0" 이었으므로, 점이 하나도 안 나오면
 * `[NO-OUTPUT]` 토큰을 stderr 에 찍고 **종료 코드 1** 로 죽는다. 조용히 0바이트로 끝나는
 * 경로를 남기지 않는다.
 */

import {
  CURVE_LEVELS,
  MAX_TICKS,
  ROSTER_SEEDS,
  renderCurveMarkdown,
  runCurveSweep,
} from '../src/bench/rosterBench.js';
import type { CurvePoint } from '../src/bench/rosterBench.js';
import {
  standardEquipped,
  standardPerTree,
  standardStage,
  investVector,
} from '../src/bench/standardBuild.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import { beginMeasureRun, measurePilotInput } from '../src/sim/measurePilot.js';
import { catalystById, SLOT_CAP } from '../src/data/catalysts.js';

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

/** `SEEDS=n` 으로 시드 수를 줄인다(`bench/` 의 다른 둘과 같은 관용구). 미지정이면 96시드 전량. */
function resolveSeeds(): readonly number[] {
  const raw = proc?.env?.SEEDS;
  if (raw === undefined || raw === '') return ROSTER_SEEDS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return ROSTER_SEEDS;
  return ROSTER_SEEDS.slice(0, Math.min(n, ROSTER_SEEDS.length));
}

/** `--levels=10,40` 으로 표준 레벨을 좁힌다. 미지정이면 20점 전량. */
function resolveLevels(): readonly number[] {
  const raw = argOf('levels');
  if (raw === undefined) return CURVE_LEVELS;
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * `--catalysts=17,22,29` 로 이 런에 실을 촉매 id 를 받는다(ADR-0052 레인 F2, 감사표 미해결 1).
 * 미지정이면 undefined(= 기존 무촉매 곡선 모드, 거동 불변). 지정되면 아래 `runPairedCurveSweep`
 * 로 분기해 **무촉매 기준선과 짝지은 배수**를 낸다 — `파워:` 칸의 정의가 절대값이 아니라
 * "무촉매 대비 배수"이기 때문이다(설계 감사표 §미해결 1).
 *
 * 미지 id 는 걸러내고 경고만 남긴다(죽이지 않는다 — 오타 하나로 축소 실행 전체를 잃을 이유가
 * 없다). `SLOT_CAP`(런당 최대 3장) 초과도 마찬가지로 경고만 한다 — 벤치는 감도 분석 목적으로
 * 정식 슬롯 캡보다 많은 조합을 재고 싶을 수 있다.
 */
function resolveCatalysts(): readonly number[] | undefined {
  const raw = argOf('catalysts');
  if (raw === undefined) return undefined;
  const ids = raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
  const known = ids.filter((id) => {
    const def = catalystById(id);
    if (def === undefined) {
      console.error(`[runCurve] WARNING unknown catalyst id ${id} -- dropped.`);
      return false;
    }
    return true;
  });
  if (known.length > SLOT_CAP) {
    console.error(
      `[runCurve] WARNING ${known.length} catalysts > SLOT_CAP(${SLOT_CAP}) -- ` +
        'this exceeds what a real run can carry, proceeding for sensitivity analysis anyway.',
    );
  }
  return known;
}

// ---------------------------------------------------------------------------
// 촉매 짝지은 배수 스윕 (ADR-0052 레인 F2)
// ---------------------------------------------------------------------------

/**
 * 한 시드에 대해 **무촉매 기준선**과 **촉매 런**을 같은 장비·투자·시드로 짝지어 돌린다.
 *
 * ⚠️ 조향은 `measurePilotInput`(+`beginMeasureRun`) 을 쓴다 — 얼어붙은 `autopilotInput`(전
 * 분기 dash:false)로는 대시 발동 촉매(예 id 27·29)가 봇 런에서 영원히 이득 0 으로 측정된다
 * (감사표 §미해결 2, 아래 `AUTOPILOT NOTE` 참고). 두 런(base·cat)이 같은 파일럿을 쓰므로
 * 비교는 여전히 공정하다 — 파일럿 차이가 아니라 촉매 유무만 갈린다.
 *
 * `hashWorld` 를 tick0(스텝 이전)에서도 찍어 낸다 — `config.catalysts` 는 `createWorld` 호출
 * 즉시 해시 꼬리에 접히므로(정규화 후, `replay.ts`), 시뮬레이션을 한 틱도 돌리지 않아도 이미
 * 갈린다. 이것이 "계측기가 촉매를 실제로 싣고 있다"의 물증이다(sim 배선 여부와 무관).
 */
function runPaired(
  ship: number,
  planet: number,
  level: number,
  seed: number,
  catalysts: readonly number[],
): {
  readonly hashBaseTick0: number;
  readonly hashCatTick0: number;
  readonly base: { victory: boolean; ticks: number; xpTotal: number; lootCount: number; sawBoss: boolean };
  readonly cat: { victory: boolean; ticks: number; xpTotal: number; lootCount: number; sawBoss: boolean };
} {
  const stageNo = standardStage(level);
  const perTree = standardPerTree(level);

  function runOne(cats: readonly number[]) {
    const p = defaultProfile();
    const s = activeShip(p);
    s.typeId = ship;
    s.skillInvest = investVector(ship, perTree);
    s.level = level;
    s.equipped = standardEquipped(level, seed, planet);
    const config = buildRunConfig(p, { planet, stage: stageNo, catalysts: [...cats] });
    const state = createWorld(seed, config);
    beginMeasureRun(state);
    const hashTick0 = hashWorld(state);

    let sawBoss = false;
    for (let i = 0; i < MAX_TICKS; i++) {
      stepWorld(state, measurePilotInput(state));
      if (state.wave.boss) sawBoss = true;
      if (state.victory || state.gameOver) break;
    }
    return {
      hashTick0,
      victory: state.victory,
      ticks: state.tick,
      xpTotal: state.xpTotal,
      lootCount: state.loot.length,
      sawBoss,
    };
  }

  const base = runOne([]);
  const cat = runOne(catalysts);
  return {
    hashBaseTick0: base.hashTick0,
    hashCatTick0: cat.hashTick0,
    base: { victory: base.victory, ticks: base.ticks, xpTotal: base.xpTotal, lootCount: base.lootCount, sawBoss: base.sawBoss },
    cat: { victory: cat.victory, ticks: cat.ticks, xpTotal: cat.xpTotal, lootCount: cat.lootCount, sawBoss: cat.sawBoss },
  };
}

interface RatioPoint {
  readonly level: number;
  readonly stage: number;
  readonly runs: number;
  readonly clearRateBase: number;
  readonly clearRateCat: number;
  readonly clearSecRatio: number | null;
  readonly bossReachRatio: number | null;
  readonly xpTotalRatio: number | null;
  readonly lootCountRatio: number | null;
  readonly hashesDiverge: boolean;
}

function ratioOf(catV: number, baseV: number): number | null {
  if (baseV === 0) return null;
  return catV / baseV;
}

/** `runPaired` 를 레벨×시드 그리드로 돌려 무촉매 대비 배수를 낸다 — `파워:` 칸의 정의. */
function runPairedCurveSweep(opts: {
  readonly ship: number;
  readonly planet: number;
  readonly seeds: readonly number[];
  readonly levels: readonly number[];
  readonly catalysts: readonly number[];
  readonly onPoint?: (p: RatioPoint) => void;
}): RatioPoint[] {
  const out: RatioPoint[] = [];
  for (const level of opts.levels) {
    const stageNo = standardStage(level);
    let baseWins = 0;
    let catWins = 0;
    let baseBossReach = 0;
    let catBossReach = 0;
    let baseClearSecSum = 0;
    let catClearSecSum = 0;
    let baseXpSum = 0;
    let catXpSum = 0;
    let baseLootSum = 0;
    let catLootSum = 0;
    let hashesDiverge = true;

    for (const seed of opts.seeds) {
      const r = runPaired(opts.ship, opts.planet, level, seed, opts.catalysts);
      if (r.hashBaseTick0 === r.hashCatTick0) hashesDiverge = false;
      if (r.base.victory) {
        baseWins++;
        baseClearSecSum += r.base.ticks / 60;
      }
      if (r.cat.victory) {
        catWins++;
        catClearSecSum += r.cat.ticks / 60;
      }
      if (r.base.sawBoss) baseBossReach++;
      if (r.cat.sawBoss) catBossReach++;
      baseXpSum += r.base.xpTotal;
      catXpSum += r.cat.xpTotal;
      baseLootSum += r.base.lootCount;
      catLootSum += r.cat.lootCount;
    }

    const n = opts.seeds.length;
    const point: RatioPoint = {
      level,
      stage: stageNo,
      runs: n,
      clearRateBase: n > 0 ? baseWins / n : 0,
      clearRateCat: n > 0 ? catWins / n : 0,
      clearSecRatio: ratioOf(
        catWins > 0 ? catClearSecSum / catWins : 0,
        baseWins > 0 ? baseClearSecSum / baseWins : 0,
      ),
      bossReachRatio: ratioOf(catBossReach, baseBossReach),
      xpTotalRatio: ratioOf(catXpSum, baseXpSum),
      lootCountRatio: ratioOf(catLootSum, baseLootSum),
      hashesDiverge,
    };
    out.push(point);
    opts.onPoint?.(point);
  }
  return out;
}

function r2(x: number | null): string {
  return x === null ? '-' : x.toFixed(2);
}

function asciiRatioTable(points: readonly RatioPoint[], catalysts: readonly number[]): void {
  console.log(
    `--- catalyst power sweep (ratio vs 무촉매 기준선, ADR-0052 파워: 칸 정의) -- catalysts=[${catalysts.join(',')}] ---`,
  );
  console.log(
    'lv  | stg | clear%(base->cat)     | clearSecX | bossReachX | xpTotalX | lootCountX | hashDiverge',
  );
  for (const p of points) {
    console.log(
      `${String(p.level).padStart(3)} | ${String(p.stage).padStart(3)} | ` +
        `${`${(p.clearRateBase * 100).toFixed(1)}->${(p.clearRateCat * 100).toFixed(1)}`.padStart(21)} | ` +
        `${r2(p.clearSecRatio).padStart(9)} | ${r2(p.bossReachRatio).padStart(10)} | ` +
        `${r2(p.xpTotalRatio).padStart(8)} | ${r2(p.lootCountRatio).padStart(10)} | ` +
        `${p.hashesDiverge ? 'yes' : 'NO(bug!)'}`,
    );
  }
  console.log('');
  console.log(
    'NOTE ratio == 1.00 across the board is EXPECTED right now -- catalystHooks.ts branches are',
  );
  console.log(
    '     all still stubs (ADR-0052 wiring lane lands later). hashDiverge=yes proves the harness',
  );
  console.log('     is actually loading the catalyst ids into the run config either way.');
  console.log(
    'AUTOPILOT NOTE this sweep uses measurePilotInput (dash+actives on cooldown), not the frozen',
  );
  console.log(
    '     autopilotInput -- see report for why (dash-gated catalysts measure as 0 gain otherwise).',
  );
}

/**
 * 관측이 비었다 — 조용히 끝내지 않고 크게 죽는다. 이 파일이 존재하는 이유가 그 실패 방식이다.
 * `exitCode` 와 `exit()` 를 둘 다 세운다(어느 쪽이 없는 런타임이어도 0 으로 안 끝나게).
 */
function failEmpty(reason: string): never {
  console.error(`[NO-OUTPUT] ${reason}`);
  console.error('[NO-OUTPUT] nothing was measured -- exiting non-zero on purpose.');
  if (proc !== undefined) proc.exitCode = 1;
  proc?.exit?.(1);
  throw new Error(`[NO-OUTPUT] ${reason}`);
}

function f1(x: number): string {
  return x.toFixed(1);
}

function pctOf(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function asciiTable(points: readonly CurvePoint[]): void {
  console.log('--- standard build curve (ADR-0037 pass band: clear 60..80%) ---');
  console.log(
    'lv  | stg | clear%  |  clearS |  survS | bossReach | ' +
      'xp p25/p50/p75            | loot p25/p50/p75',
  );
  for (const p of points) {
    console.log(
      `${String(p.level).padStart(3)} | ${String(p.stage).padStart(3)} | ` +
        `${pctOf(p.clearRate).padStart(7)} | ` +
        `${(p.wins > 0 ? f1(p.clearSec.mean) : '-').padStart(7)} | ` +
        `${f1(p.survivalSec.mean).padStart(6)} | ` +
        `${pctOf(p.bossReachRate).padStart(9)} | ` +
        `${`${f1(p.xpTotal.p25)}/${f1(p.xpTotal.p50)}/${f1(p.xpTotal.p75)}`.padStart(25)} | ` +
        `${f1(p.lootCount.p25)}/${f1(p.lootCount.p50)}/${f1(p.lootCount.p75)}`,
    );
  }
  console.log('');
  // "정확히 0"은 이 저장소에서 구조적 무발사 신호다. 다만 저단계 장비 0 은 설계값이므로
  // (드랍원이 엘리트 단독인데 저단계는 eliteCount 0) 죽이지 않고 눈에 띄게만 남긴다.
  const deadXp = points.filter((p) => p.xpTotal.p50 === 0).map((p) => p.level);
  const deadLoot = points.filter((p) => p.lootCount.p75 === 0).map((p) => p.level);
  if (deadXp.length > 0) {
    console.log(`WARNING xp p50 == 0 at levels: ${deadXp.join(',')} (check the instrument)`);
  }
  if (deadLoot.length > 0) {
    console.log(
      `NOTE loot p75 == 0 at levels: ${deadLoot.join(',')}` +
        ' (expected at low stages -- elite drops are the only source)',
    );
  }
  console.log('NOTE loot counts COLLECTED drops -- a lower bound on what the run generated.');
  console.log('NOTE card count (EXPECTED_CARDS_PER_RUN) is NOT here: sim keeps no cumulative counter.');
}

function main(): void {
  const seeds = resolveSeeds();
  const levels = resolveLevels();
  const ship = Number(argOf('ship') ?? 0);
  const planet = Number(argOf('planet') ?? 0);
  const wantJson = ARGV.includes('--json');
  const wantMd = ARGV.includes('--md');
  const catalysts = resolveCatalysts();

  if (levels.length === 0) failEmpty('--levels resolved to an empty list.');
  if (seeds.length === 0) failEmpty('SEEDS resolved to an empty list.');

  if (catalysts !== undefined) {
    // 촉매 파워 스윕 모드(ADR-0052 레인 F2) — 무촉매 기준선과 짝지은 배수를 낸다.
    // `--json`/`--md` 는 이 모드에서 아직 안 만든다(요구되면 asciiRatioTable 과 같은 자리에 추가).
    console.error(
      `[runCurve] CATALYST SWEEP catalysts=[${catalysts.join(',')}] ship=${ship} planet=${planet} ` +
        `seeds=${seeds.length}/${ROSTER_SEEDS.length} levels=${levels.join(',')} maxTicks=${MAX_TICKS} ` +
        '(paired base vs catalyst runs; measurePilotInput, not frozen autopilot)',
    );
    const t0 = Date.now();
    const points = runPairedCurveSweep({
      ship,
      planet,
      seeds,
      levels,
      catalysts,
      onPoint: (p) =>
        console.error(
          `[runCurve] Lv${p.level} stage${p.stage}: clear ${(p.clearRateBase * 100).toFixed(1)}%->` +
            `${(p.clearRateCat * 100).toFixed(1)}% clearSecX=${r2(p.clearSecRatio)} ` +
            `xpX=${r2(p.xpTotalRatio)} lootX=${r2(p.lootCountRatio)} hashDiverge=${p.hashesDiverge}`,
        ),
    });
    const elapsedMs = Date.now() - t0;
    if (points.length === 0) failEmpty('runPairedCurveSweep returned zero points.');
    asciiRatioTable(points, catalysts);
    console.log('');
    console.log(`elapsed: ${(elapsedMs / 1000).toFixed(1)}s`);
    console.log('done.');
    return;
  }

  const t0 = Date.now();
  const points = runCurveSweep({
    ship,
    planet,
    seeds,
    levels,
    onPoint: (p) =>
      console.error(
        `[runCurve] Lv${p.level} stage${p.stage}: clear=${pctOf(p.clearRate)} ` +
          `survive=${f1(p.survivalSec.mean)}s ` +
          // XP·장비를 진행 로그에도 싣는다 — 정확히 0이면 스윕이 다 끝난 뒤 표에서 발견하는
          // 것보다 여기서 즉시 보이는 편이 싸다.
          `xp=${f1(p.xpTotal.p50)}(p50) loot=${f1(p.lootCount.p50)}(p50)`,
      ),
  });
  const elapsedMs = Date.now() - t0;

  if (points.length === 0) failEmpty('runCurveSweep returned zero points.');

  asciiTable(points);
  console.log('');
  console.log(`elapsed: ${(elapsedMs / 1000).toFixed(1)}s`);

  if (wantJson) {
    console.log('===JSON===');
    console.log(
      JSON.stringify(
        { meta: { mode: 'curve', ship, planet, seeds, maxTicks: MAX_TICKS, elapsedMs }, points },
        null,
        2,
      ),
    );
  }
  if (wantMd) {
    // 마크다운은 연구 문서에 그대로 붙이는 형태라 한글 헤더를 담는다 — PowerShell 콘솔
    // 코드페이지가 UTF-8 이 아니면 깨져 보이므로 **판정에는 위 ASCII 표를 쓴다.**
    console.log('===MARKDOWN=== (non-ASCII; for research docs. Judge from the ASCII table above.)');
    console.log(renderCurveMarkdown(points, { ship, planet, seeds: seeds.length, elapsedMs }));
  }
  console.log('done.');
}

main();
