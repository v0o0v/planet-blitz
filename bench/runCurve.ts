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

  if (levels.length === 0) failEmpty('--levels resolved to an empty list.');
  if (seeds.length === 0) failEmpty('SEEDS resolved to an empty list.');

  console.error(
    `[runCurve] ship=${ship} planet=${planet} seeds=${seeds.length}/${ROSTER_SEEDS.length} ` +
      `levels=${levels.join(',')} maxTicks=${MAX_TICKS}`,
  );

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
