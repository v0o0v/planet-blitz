/**
 * 명목 파워 CLI — 기체 7종의 초당공격력 · 실효체력 · 총 파워 표 (출시 전 밸런스 기준 2).
 *
 * ## 실행
 *   node node_modules/.pnpm/vite-node@<버전>/node_modules/vite-node/vite-node.mjs bench/nominalPower.ts
 * (`<버전>` 은 `ls node_modules/.pnpm | grep '^vite-node'` 로 확인한다. `vite-node` 는 PATH 에 없다.)
 *
 * `bench/` 의 다른 셋과 달리 **sim 을 한 틱도 돌리지 않는다** — 전부 닫힌 식이라 수 밀리초다.
 *
 * 인자:
 *   `--levels=50,100`  대상 레벨(기본 50,100)
 *   `--band=1.35`      합격 밴드(곱 최대/최소 상한, 기본 1.35)
 *   `--sens`           가정치 감도 — 각 가정치를 아래위로 흔들어 순위 뒤집힘을 본다
 *   `--armor=4 --overcharge-uptime=0.25 --cloak=0.35 --kps=3 --cushion=0.4`
 *                      가정치 개별 덮어쓰기
 *
 * 출력은 **ASCII 전용**이다 — 사용자가 PowerShell 콘솔에서 돌리는데 콘솔 코드페이지가 UTF-8
 * 이 아니면 한글이 mojibake 로 깨져 판정을 방해한다. 한글은 이 주석에만 쓴다.
 *
 * ## 읽는 법
 *
 * `POWER` 열이 판정 대상이고 `RATIO` 는 스트라이커(기준점 기체, `baseBp` 전 축 0) 대비다.
 * 사람이 스트라이커로 3지점을 앉아 "적절한 난이도"의 **절대 원점**을 찍으면, 나머지 6기체는
 * 이 `RATIO` 로 환산된다 — RATIO 1.27 은 "27% 쉽다"는 뜻이다.
 *
 * ⚠️ `SPREAD`(최대/최소)가 밴드 안이어도 **가정치가 틀리면 표 전체가 같은 방향으로 틀린다.**
 * 반드시 `--sens` 를 함께 보고, 사람 플레이로 부호를 교정하라. 상세는 `src/bench/nominalPower.ts`
 * 머리말 「이 모델이 구조적으로 못 보는 것」.
 */

import {
  DEFAULT_ASSUMPTIONS,
  nominalTable,
  powerSpread,
  relativeToStriker,
} from '../src/bench/nominalPower.js';
import type { NominalAssumptions, NominalResult, GearMode } from '../src/bench/nominalPower.js';

// `bench/` 의 다른 셋과 **같은 관용구**다 — `vite-node` 는 스크립트 경로를 argv 에서 통째로
// 지우고, 이 프로젝트 tsconfig 는 node 타입을 싣지 않는다(`runCurve.ts` 머리말이 정본).
interface NodeProcess {
  readonly argv?: readonly string[];
}
const ARGV: readonly string[] = (globalThis as { process?: NodeProcess }).process?.argv ?? [];

function argVal(name: string): string | undefined {
  const pre = `--${name}=`;
  for (const a of ARGV) if (a.startsWith(pre)) return a.slice(pre.length);
  return undefined;
}

function argNum(name: string, fallback: number): number {
  const raw = argVal(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function hasFlag(name: string): boolean {
  return ARGV.includes(`--${name}`);
}

function resolveLevels(): number[] {
  const raw = argVal('levels');
  if (raw === undefined) return [50, 100];
  const out = raw
    .split(',')
    .map((s) => Math.floor(Number(s.trim())))
    .filter((n) => Number.isFinite(n) && n >= 1);
  return out.length > 0 ? out : [50, 100];
}

function resolveAssumptions(): NominalAssumptions {
  return {
    ...DEFAULT_ASSUMPTIONS,
    armorAvgStacks: argNum('armor', DEFAULT_ASSUMPTIONS.armorAvgStacks),
    overchargeUptime: argNum('overcharge-uptime', DEFAULT_ASSUMPTIONS.overchargeUptime),
    cloakCycleRate: argNum('cloak', DEFAULT_ASSUMPTIONS.cloakCycleRate),
    killsPerSec: argNum('kps', DEFAULT_ASSUMPTIONS.killsPerSec),
    cushionRecoverRate: argNum('cushion', DEFAULT_ASSUMPTIONS.cushionRecoverRate),
    runSeconds: argNum('run-seconds', DEFAULT_ASSUMPTIONS.runSeconds),
  };
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : ' '.repeat(w - s.length) + s;
}
function padR(s: string, w: number): string {
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}

function resolveGear(): GearMode {
  const raw = argVal('gear');
  if (raw === 'starter' || raw === 'standard' || raw === 'none') return raw;
  return 'none';
}

function printLevel(level: number, a: NominalAssumptions, band: number, mode: GearMode): number {
  const results = nominalTable(level, a, 0, mode);
  const rows = results.map((r) => r.row);
  const rel = relativeToStriker(rows);
  const spread = powerSpread(rows);

  console.log('');
  console.log(`== Lv${level} ==`);
  console.log(
    [
      padR('SHIP', 11),
      pad('DMG', 7),
      pad('CD', 6),
      pad('BLT', 4),
      pad('DPS0', 8),
      pad('SIGATK', 7),
      pad('DPS', 8),
      pad('HP', 6),
      pad('SIGDEF', 7),
      pad('EHP', 7),
      pad('POWER', 10),
      pad('RATIO', 7),
    ].join(' '),
  );
  for (const { row } of results) {
    console.log(
      [
        padR(row.slug, 11),
        pad(row.damage.toFixed(2), 7),
        pad(row.fireCdTicks.toFixed(3), 6),
        pad(String(row.bulletCount), 4),
        pad(row.baseDps.toFixed(1), 8),
        pad(row.sigAtk.toFixed(3), 7),
        pad(row.dps.toFixed(1), 8),
        pad(String(row.hp), 6),
        pad(row.sigDef.toFixed(3), 7),
        pad(row.ehp.toFixed(1), 7),
        pad(row.power.toFixed(0), 10),
        pad((rel.get(row.typeId) ?? Number.NaN).toFixed(3), 7),
      ].join(' '),
    );
  }
  const verdict = spread <= band ? 'PASS' : 'FAIL';
  console.log(`SPREAD max/min = ${spread.toFixed(3)}  (band <= ${band.toFixed(2)})  ${verdict}`);
  console.log('-- signature notes (assumption-dependent) --');
  for (const r of results) console.log(`   ${padR(r.row.slug, 11)} ${r.sig.note}`);
  return spread;
}

/**
 * 감도 — 가정치를 하나씩 아래위로 흔들어 **순위가 뒤집히는지** 본다.
 * 순위가 안 뒤집히면 그 가정치는 판정을 좌우하지 않는다(= 그만큼 표를 믿어도 된다).
 */
function printSensitivity(level: number, base: NominalAssumptions): void {
  const order = (a: NominalAssumptions): string =>
    nominalTable(level, a)
      .slice()
      .sort((x, y) => y.row.power - x.row.power)
      .map((r) => r.row.slug)
      .join('>');

  const baseOrder = order(base);
  console.log('');
  console.log(`== sensitivity @ Lv${level} ==`);
  console.log(`base order: ${baseOrder}`);

  const sweeps: Array<[string, NominalAssumptions[]]> = [
    [
      'armorAvgStacks',
      [
        { ...base, armorAvgStacks: 1 },
        { ...base, armorAvgStacks: 8 },
      ],
    ],
    [
      'overchargeUptime',
      [
        { ...base, overchargeUptime: 0.05 },
        { ...base, overchargeUptime: 0.6 },
      ],
    ],
    [
      'cloakCycleRate',
      [
        { ...base, cloakCycleRate: 0.05 },
        { ...base, cloakCycleRate: 0.9 },
      ],
    ],
    [
      'killsPerSec',
      [
        { ...base, killsPerSec: 1 },
        { ...base, killsPerSec: 8 },
      ],
    ],
    [
      'cushionRecoverRate',
      [
        { ...base, cushionRecoverRate: 0.1 },
        { ...base, cushionRecoverRate: 0.9 },
      ],
    ],
    [
      'runSeconds',
      [
        { ...base, runSeconds: 40 },
        { ...base, runSeconds: 180 },
      ],
    ],
  ];

  for (const [name, variants] of sweeps) {
    const orders = variants.map(order);
    const flipped = orders.some((o) => o !== baseOrder);
    console.log(`${padR(name, 20)} ${flipped ? 'FLIPS' : 'stable'}`);
    if (flipped) for (const o of orders) console.log(`   -> ${o}`);
  }
}

function main(): void {
  const a = resolveAssumptions();
  const band = argNum('band', 1.35);
  const levels = resolveLevels();

  console.log('nominal power table -- closed form, no sim ticks');
  console.log(
    `assumptions: armor=${a.armorAvgStacks} overchargeUptime=${a.overchargeUptime} ` +
      `overchargeStillTicks=${a.overchargeAvgStillTicks} cloakCycleRate=${a.cloakCycleRate} ` +
      `killsPerSec=${a.killsPerSec} cumulativeKills=${a.cumulativeKills} ` +
      `cushionRecoverRate=${a.cushionRecoverRate} runSeconds=${a.runSeconds}`,
  );

  const mode = resolveGear();
  console.log(`gear mode: ${mode}`);
  let worst = 0;
  for (const lv of levels) worst = Math.max(worst, printLevel(lv, a, band, mode));
  if (hasFlag('sens')) for (const lv of levels) printSensitivity(lv, a);

  console.log('');
  console.log(`WORST SPREAD across levels = ${worst.toFixed(3)}  band <= ${band.toFixed(2)}`);
  console.log(worst <= band ? 'VERDICT PASS' : 'VERDICT FAIL');
}

main();

// 미사용 import 경고 방지용 타입 참조(구조 문서화 목적).
export type { NominalResult };
