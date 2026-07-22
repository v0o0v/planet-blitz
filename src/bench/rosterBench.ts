/**
 * 로스터 밸런스 **측정** 하네스 (M8 · 측정 전용 — 튜닝하지 않는다).
 *
 * 기체 7종을 결정론 오토파일럿(`autopilotInput`, ADR-0008)으로 헤드리스 대량 실행해
 * 무대(행성 × 난이도) · 투자 프로파일별로 **클리어율 · 클리어 소요 시간 · 생존 시간 · DPS**
 * 를 분리 집계한다. 이 파일은 `data/skills.ts` · `data/ships/*.ts` 를 **읽기만** 한다.
 *
 * Run:
 *   npx vite-node src/bench/rosterBench.ts                      (전 무대, 진행 로그만)
 *   npx vite-node src/bench/rosterBench.ts --stages=0,1 --json  (부분 실행 + JSON stdout)
 *   npx vite-node src/bench/rosterBench.ts --json > out.json
 *   npx vite-node src/bench/rosterBench.ts --md                 (요약 마크다운 stdout)
 *
 * ## 결정론
 * 시드는 아래 {@link SEEDS} 하드코딩 목록이다 — `Math.random` 을 쓰지 않는다.
 * `buildRunConfig` 를 통해서만 config 를 조립한다(`src/run/runConfig.ts` 단일 정본 규율).
 * 같은 시드 + 같은 프로필은 항상 같은 런이 되며 `hashWorld` 까지 비트 일치한다.
 *
 * ## 파일 출력이 없는 이유
 * 이 저장소는 `@types/node` 를 두지 않는다(플랫폼 무참조 규율). 따라서 `node:fs` 를 쓰면
 * `npm run typecheck` 가 깨진다. 대신 `--json` / `--md` 로 stdout 에 뱉고 셸에서 리다이렉트한다.
 * 진행 로그는 `console.error`(stderr)로 나가므로 리다이렉트와 섞이지 않는다.
 */

import { createWorld, stepWorld } from '../sim/world.js';
import type { WorldState } from '../sim/world.js';
import { autopilotInput } from '../sim/autopilot.js';
import { buildRunConfig } from '../run/runConfig.js';
import { defaultProfile, activeShip } from '../save/profile.js';
import {
  SHIP_TYPES,
  shipTypeDef,
  zeroSkillInvest,
  flattenShipNodes,
  shipTreeRange,
  shipCapstoneIndex,
} from '../../data/ships/index.js';

// ---------------------------------------------------------------------------
// 매트릭스 정의
// ---------------------------------------------------------------------------

/**
 * 24개 고정 시드. 재현성이 계약이므로 **절대 난수로 만들지 않는다**.
 * `tests/invasionBalance.test.ts` 의 `BALANCE_SEEDS`(소수 위주 12개)를 확장한 형태 —
 * 앞 12개는 그 목록과 동일해 침공 밸런스 측정과 시드를 공유한다.
 */
const SEEDS: readonly number[] = [
  1, 5, 11, 17, 23, 31, 41, 43, 53, 61, 71, 79,
  83, 97, 101, 113, 127, 131, 149, 151, 163, 173, 181, 191,
];

/** 게임 자체에는 타임아웃이 없다(보스 처치 or 사망만 종료) — 저장소 표준 상한 18000틱. */
const MAX_TICKS = 60 * 300;

interface Stage {
  readonly key: string;
  readonly label: string;
  readonly planet: number;
  readonly stage: number;
}

/**
 * 무대 4종. 전 조합(4행성 × 3밴드 = 12)을 돌리면 비용이 4배가 되므로 **효과를 분리할 수
 * 있는 최소 집합**만 고른다(침략 단계 밴드 대표: 1=구 정찰, 11=구 교전, 21=구 섬멸):
 *  - S0·S1 은 행성을 고정(kargon)하고 단계만 1↔21 로 벌려 **난이도 효과를 단독 관측**한다.
 *  - S1·S3 은 단계를 고정(21)하고 행성만 kargon↔arke 로 벌려 **행성 효과를 단독 관측**한다.
 *  - S2 는 스트라이커 골든 픽스처(`tests/fixtures/striker-prem8.json`)가 쓰는 두 무대 중
 *    하나(`berdan-engage` = planet 1 / 단계 11)를 그대로 채택한 중간 기준점이다.
 *    (골든의 다른 무대 `kargon-recon` = planet 0 / 단계 1 은 S0 과 동일하다.)
 * 즉 S0=바닥, S2=중간(골든 기준), S1=단계 밴드 상한, S3=행성·단계 동시 상한.
 */
const STAGES: readonly Stage[] = [
  { key: 'kargon-s1', label: '카르곤 · 단계1', planet: 0, stage: 1 },
  { key: 'kargon-s21', label: '카르곤 · 단계21', planet: 0, stage: 21 },
  { key: 'berdan-s11', label: '베르단 · 단계11', planet: 1, stage: 11 },
  { key: 'arke-s21', label: '아르케 · 단계21', planet: 3, stage: 21 },
];

interface InvestProfile {
  readonly key: string;
  readonly label: string;
  /** 트리 0(offense) / 1(utility) / 2(defense) 에 넣을 base 포인트. */
  readonly perTree: readonly [number, number, number];
}

/**
 * 투자 프로파일 2종. 스킬 포인트는 레벨업 1회당 1점 · 레벨 캡 100 → **계정 총 예산 ≈ 99점**
 * (`src/save/settlement.ts`, `data/waves.ts` LEVEL_CAP). 따라서 트리당 40점 같은 배치는
 * 게임에 존재하지 않는다.
 *  - P0: 무투자(0점) — 회귀 탐지 겸 섀시 baseBp 단독 효과 관측.
 *  - P1: 중반 42점(14/14/14 균등) — 계정 예산의 약 42%. 한 트리에 몰지 않은 이유는
 *    화력 계열 30pt 부근에서 `rangeFlat` 노드가 `weapon.range` 를 무제한(0)에서 유한값으로
 *    떨어뜨려(`world.ts` nearestTarget: `range > 0 ? range*range : Infinity`) 기체 밸런스가
 *    아니라 그 결함을 측정하게 되기 때문이다. 실제 붙은 `weapon.range` 는 파생 스탯으로
 *    함께 기록해 오염 여부를 사후 검증할 수 있게 한다.
 *  - P2: 만렙 99점(45/27/27) — 계정 예산 전량. 공격 계열 45pt 는 `capstoneGate`(40, 해츨링
 *    44)를 전 기체에서 넘겨 캡스톤 1점이 실제로 붙는다. P0·P1 만으로는 상위 무대(티어 2 ·
 *    아르케)가 전 기체 0% 로 바닥에 눌려 기체 간 차이가 신호로 남지 않기 때문에 필요하다.
 *    ⚠️ 공격 계열 45pt 는 위의 `rangeFlat` 함정 구간을 지난다 — 파생 스탯의 `range` 열이
 *    0 이 아닌 기체는 그 결함에 오염된 상태로 측정된 것이다.
 */
const PROFILES: readonly InvestProfile[] = [
  { key: 'P0', label: '무투자(0pt)', perTree: [0, 0, 0] },
  { key: 'P1', label: '중반(42pt · 14/14/14)', perTree: [14, 14, 14] },
  { key: 'P2', label: '만렙(99pt · 45/27/27)', perTree: [45, 27, 27] },
];

// ---------------------------------------------------------------------------
// 투자 벡터
// ---------------------------------------------------------------------------

/**
 * flat `skillInvest` 벡터를 만든다. 트리별로 base 노드를 앞에서부터 `maxPoints` 까지 채우고,
 * 계열 투자가 `capstoneGate` 이상이면 그 트리 캡스톤에 1점.
 *
 * ⚠️ `flattenShipNodes` 로 얻은 인덱스를 그대로 쓴다 — 트리 배열을 concat 하면 안 된다
 * (레이아웃 `[트리0 base][트리1 base][트리2 base][캡스톤 3]` 이 해시 계약이다).
 */
function investVector(typeId: number, perTree: readonly number[]): number[] {
  const def = shipTypeDef(typeId);
  const v = zeroSkillInvest(typeId);
  const nodes = flattenShipNodes(def);
  for (let t = 0; t < def.trees.length; t++) {
    let rest = perTree[t] ?? 0;
    if (rest <= 0) continue;
    const spent = rest;
    const { start, end } = shipTreeRange(def, t);
    for (let i = start; i < end && rest > 0; i++) {
      const node = nodes[i];
      if (node === undefined) break;
      const put = Math.min(node.maxPoints, rest);
      v[i] = put;
      rest -= put;
    }
    if (spent >= def.capstoneGate) v[shipCapstoneIndex(def, t)] = 1;
  }
  return v;
}

// ---------------------------------------------------------------------------
// 단일 런
// ---------------------------------------------------------------------------

type Outcome = 'victory' | 'death' | 'timeout';

interface RunResult {
  readonly ship: number;
  readonly stage: string;
  readonly profile: string;
  readonly seed: number;
  readonly outcome: Outcome;
  /** 소요 틱 = 생존 시간(사망·타임아웃 포함). */
  readonly ticks: number;
  readonly kills: number;
  readonly level: number;
  readonly xpTotal: number;
  readonly segment: number;
  /** 보스 세그먼트에 도달했는가. */
  readonly sawBoss: boolean;
  /** 보스 hp 감소 / 보스 관측 초. 보스 미도달이면 null. */
  readonly bossDps: number | null;
  /** 처치/초 — 일반 구간 화력 프록시. */
  readonly killsPerSec: number;
}

/** 런에서 파생된 시작 스탯(기체 × 프로파일마다 1회만 기록). */
interface DerivedStats {
  readonly weaponDamage: number;
  readonly fireCooldown: number;
  readonly weaponRange: number;
  readonly bulletCount: number;
  readonly pierce: number;
  readonly bulletSpeed: number;
  readonly playerHp: number;
  readonly playerSpeed: number;
}

function readDerived(state: WorldState): DerivedStats {
  const p = state.entities[0];
  return {
    weaponDamage: state.weapon.damage,
    fireCooldown: state.weapon.fireCooldown,
    weaponRange: state.weapon.range,
    bulletCount: state.weapon.bulletCount,
    pierce: state.weapon.pierce,
    bulletSpeed: state.weapon.bulletSpeed,
    playerHp: p?.maxHp ?? 0,
    playerSpeed: state.config.playerSpeed,
  };
}

function runOne(
  ship: number,
  stage: Stage,
  profile: InvestProfile,
  seed: number,
): { result: RunResult; derived: DerivedStats } {
  const p = defaultProfile();
  const s = activeShip(p);
  s.typeId = ship;
  s.skillInvest = investVector(ship, profile.perTree);
  const config = buildRunConfig(p, { planet: stage.planet, stage: stage.stage });

  const state = createWorld(seed, config);
  const derived = readDerived(state);

  // 보스 DPS 프록시: 보스 세그먼트에 들어간 뒤에만 스캔한다(매 틱 전체 find 는 측정을 왜곡).
  let bossHp0 = -1;
  let bossHpLast = -1;
  let bossTicks = 0;
  let sawBoss = false;

  for (let i = 0; i < MAX_TICKS; i++) {
    stepWorld(state, autopilotInput(state));
    if (state.wave.boss) {
      sawBoss = true;
      let boss: number | undefined;
      for (const e of state.entities) {
        if (e.kind === 'boss' && !e.dead) {
          boss = e.hp;
          break;
        }
      }
      if (boss !== undefined) {
        if (bossHp0 < 0) bossHp0 = boss;
        bossHpLast = boss;
        bossTicks++;
      } else if (bossHp0 >= 0) {
        // 보스가 사라졌다 = 처치. 남은 hp 를 0 으로 확정하고 그 틱까지 센다.
        bossHpLast = 0;
        bossTicks++;
      }
    }
    if (state.victory || state.gameOver) break;
  }

  const ticks = state.tick;
  const outcome: Outcome = state.victory ? 'victory' : state.gameOver ? 'death' : 'timeout';
  const bossDps =
    bossHp0 >= 0 && bossTicks > 0 ? ((bossHp0 - bossHpLast) * 60) / bossTicks : null;

  return {
    result: {
      ship,
      stage: stage.key,
      profile: profile.key,
      seed,
      outcome,
      ticks,
      kills: state.kills,
      level: state.level,
      xpTotal: state.xpTotal,
      segment: state.wave.segmentIndex,
      sawBoss,
      bossDps,
      killsPerSec: ticks > 0 ? (state.kills * 60) / ticks : 0,
    },
    derived,
  };
}

// ---------------------------------------------------------------------------
// 통계
// ---------------------------------------------------------------------------

interface Dist {
  readonly n: number;
  readonly mean: number;
  readonly sd: number;
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
}

const EMPTY_DIST: Dist = { n: 0, mean: 0, sd: 0, p25: 0, p50: 0, p75: 0 };

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (idx - lo);
}

function dist(values: readonly number[]): Dist {
  const n = values.length;
  if (n === 0) return EMPTY_DIST;
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / n;
  let acc = 0;
  for (const v of values) acc += (v - mean) * (v - mean);
  const sd = n > 1 ? Math.sqrt(acc / (n - 1)) : 0;
  const sorted = [...values].sort((x, y) => x - y);
  return { n, mean, sd, p25: quantile(sorted, 0.25), p50: quantile(sorted, 0.5), p75: quantile(sorted, 0.75) };
}

interface Cell {
  readonly ship: number;
  readonly shipSlug: string;
  readonly stage: string;
  readonly profile: string;
  readonly runs: number;
  readonly wins: number;
  readonly clearRate: number;
  /** 승리 런의 클리어 소요 초. */
  readonly clearSec: Dist;
  /** 전 런의 생존 초(승패 무관 — 런 길이). */
  readonly survivalSec: Dist;
  /** 패배 런만의 생존 초(얼마나 버텼는가). */
  readonly deathSec: Dist;
  readonly bossDps: Dist;
  readonly killsPerSec: Dist;
  readonly kills: Dist;
  readonly bossReachRate: number;
  readonly derived: DerivedStats;
}

function aggregate(
  rows: readonly RunResult[],
  derivedBy: ReadonlyMap<string, DerivedStats>,
): Cell[] {
  const out: Cell[] = [];
  for (const stage of STAGES) {
    for (const profile of PROFILES) {
      for (let ship = 0; ship < SHIP_TYPES.length; ship++) {
        const cell = rows.filter(
          (r) => r.ship === ship && r.stage === stage.key && r.profile === profile.key,
        );
        if (cell.length === 0) continue;
        const wins = cell.filter((r) => r.outcome === 'victory');
        const losses = cell.filter((r) => r.outcome !== 'victory');
        const bossRuns = cell.filter((r) => r.bossDps !== null);
        const def = SHIP_TYPES[ship];
        const derived = derivedBy.get(`${ship}|${profile.key}`);
        out.push({
          ship,
          shipSlug: def?.slug ?? `ship${ship}`,
          stage: stage.key,
          profile: profile.key,
          runs: cell.length,
          wins: wins.length,
          clearRate: cell.length > 0 ? wins.length / cell.length : 0,
          clearSec: dist(wins.map((r) => r.ticks / 60)),
          survivalSec: dist(cell.map((r) => r.ticks / 60)),
          deathSec: dist(losses.map((r) => r.ticks / 60)),
          bossDps: dist(bossRuns.map((r) => r.bossDps ?? 0)),
          killsPerSec: dist(cell.map((r) => r.killsPerSec)),
          kills: dist(cell.map((r) => r.kills)),
          bossReachRate: cell.length > 0 ? cell.filter((r) => r.sawBoss).length / cell.length : 0,
          derived: derived ?? {
            weaponDamage: 0,
            fireCooldown: 0,
            weaponRange: 0,
            bulletCount: 0,
            pierce: 0,
            bulletSpeed: 0,
            playerHp: 0,
            playerSpeed: 0,
          },
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 마크다운
// ---------------------------------------------------------------------------

function f1(v: number): string {
  return v.toFixed(1);
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function renderMarkdown(cells: readonly Cell[], elapsedMs: number, stages: readonly Stage[]): string {
  const L: string[] = [];
  L.push('# M8 로스터 베이스라인 실측');
  L.push('');
  L.push(
    `- 매트릭스: 기체 ${SHIP_TYPES.length}종 × 시드 ${SEEDS.length} × 무대 ${stages.length} × 투자 ${PROFILES.length} = **${SHIP_TYPES.length * SEEDS.length * stages.length * PROFILES.length} 런**`,
  );
  L.push(`- 총 실행 시간: ${(elapsedMs / 1000).toFixed(1)}s`);
  L.push(`- 시드(고정): \`${SEEDS.join(', ')}\``);
  L.push(`- 상한: ${MAX_TICKS}틱(=${MAX_TICKS / 60}s) 도달 시 timeout`);
  L.push('');
  L.push('## 무대');
  L.push('');
  L.push('| key | 행성 | 단계 | 설명 |');
  L.push('|---|---|---|---|');
  for (const s of stages) L.push(`| \`${s.key}\` | ${s.planet} | ${s.stage} | ${s.label} |`);
  L.push('');
  L.push('## 투자 프로파일');
  L.push('');
  L.push('| key | 총점 | 배분(offense/utility/defense) |');
  L.push('|---|---|---|');
  for (const p of PROFILES) {
    const total = p.perTree.reduce((a, b) => a + b, 0);
    L.push(`| \`${p.key}\` | ${total} | ${p.perTree.join(' / ')} — ${p.label} |`);
  }
  L.push('');
  L.push('## 파생 시작 스탯 (기체 × 프로파일)');
  L.push('');
  L.push('| 기체 | 프로파일 | dmg | fireCd | range | bullets | pierce | bulletSpd | HP | speed |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  const seen = new Set<string>();
  for (const c of cells) {
    const k = `${c.ship}|${c.profile}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const d = c.derived;
    L.push(
      `| ${c.shipSlug} | ${c.profile} | ${d.weaponDamage} | ${d.fireCooldown} | ${d.weaponRange} | ${d.bulletCount} | ${d.pierce} | ${d.bulletSpeed} | ${d.playerHp} | ${d.playerSpeed} |`,
    );
  }
  L.push('');
  L.push('## 밴드별 로스터 분산 (이 작업의 목표 지표)');
  L.push('');
  L.push('| 무대 | 투자 | 클리어율 min~max | 로스터간 sd(pp) | 생존초 min~max | 생존초 sd |');
  L.push('|---|---|---|---|---|---|');
  for (const stage of stages) {
    for (const profile of PROFILES) {
      const rows = cells.filter((c) => c.stage === stage.key && c.profile === profile.key);
      if (rows.length === 0) continue;
      const cr = rows.map((c) => c.clearRate * 100);
      const sv = rows.map((c) => c.survivalSec.mean);
      const dc = dist(cr);
      const ds = dist(sv);
      L.push(
        `| ${stage.key} | ${profile.key} | ${f1(Math.min(...cr))}~${f1(Math.max(...cr))} | ${f1(dc.sd)} | ` +
          `${f1(Math.min(...sv))}~${f1(Math.max(...sv))} | ${f1(ds.sd)} |`,
      );
    }
  }
  L.push('');
  for (const stage of stages) {
    for (const profile of PROFILES) {
      const rows = cells.filter((c) => c.stage === stage.key && c.profile === profile.key);
      if (rows.length === 0) continue;
      L.push(`## ${stage.label} · ${profile.label}`);
      L.push('');
      L.push(
        '| 기체 | 클리어율 | 클리어초 평균±sd | 클리어초 p25/p50/p75 | 생존초 평균±sd | 패배런 생존초 | 보스도달 | 보스DPS 평균±sd (n) | 처치/초 |',
      );
      L.push('|---|---|---|---|---|---|---|---|---|');
      for (const c of rows) {
        L.push(
          `| ${c.shipSlug} | ${pct(c.clearRate)} (${c.wins}/${c.runs}) | ` +
            `${c.wins > 0 ? `${f1(c.clearSec.mean)}±${f1(c.clearSec.sd)}` : '—'} | ` +
            `${c.wins > 0 ? `${f1(c.clearSec.p25)}/${f1(c.clearSec.p50)}/${f1(c.clearSec.p75)}` : '—'} | ` +
            `${f1(c.survivalSec.mean)}±${f1(c.survivalSec.sd)} | ` +
            `${c.deathSec.n > 0 ? `${f1(c.deathSec.mean)}±${f1(c.deathSec.sd)}` : '—'} | ` +
            `${pct(c.bossReachRate)} | ` +
            `${c.bossDps.n > 0 ? `${f1(c.bossDps.mean)}±${f1(c.bossDps.sd)} (${c.bossDps.n})` : '— (0)'} | ` +
            `${f1(c.killsPerSec.mean)} |`,
        );
      }
      L.push('');
    }
  }
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function argOf(argv: readonly string[], name: string): string | undefined {
  const pre = `--${name}=`;
  for (const a of argv) if (a.startsWith(pre)) return a.slice(pre.length);
  return undefined;
}

function main(): void {
  const argv = (globalThis as { process?: { argv?: readonly string[] } }).process?.argv ?? [];
  const wantJson = argv.includes('--json');
  const wantMd = argv.includes('--md');

  const stageArg = argOf(argv, 'stages');
  const stages =
    stageArg === undefined
      ? STAGES
      : STAGES.filter((_, i) => stageArg.split(',').includes(String(i)));
  const seedArg = argOf(argv, 'seeds');
  const seeds = seedArg === undefined ? SEEDS : SEEDS.slice(0, Number(seedArg));

  const rows: RunResult[] = [];
  const derivedBy = new Map<string, DerivedStats>();
  const t0 = performance.now();

  for (const stage of stages) {
    for (const profile of PROFILES) {
      const cellStart = performance.now();
      for (let ship = 0; ship < SHIP_TYPES.length; ship++) {
        for (const seed of seeds) {
          const { result, derived } = runOne(ship, stage, profile, seed);
          rows.push(result);
          const k = `${ship}|${profile.key}`;
          if (!derivedBy.has(k)) derivedBy.set(k, derived);
        }
      }
      console.error(
        `[rosterBench] ${stage.key} / ${profile.key}: ${SHIP_TYPES.length * seeds.length} runs in ${((performance.now() - cellStart) / 1000).toFixed(1)}s`,
      );
    }
  }

  const elapsedMs = performance.now() - t0;
  const cells = aggregate(rows, derivedBy);
  console.error(`[rosterBench] total ${rows.length} runs in ${(elapsedMs / 1000).toFixed(1)}s`);

  if (wantJson) {
    console.log(
      JSON.stringify(
        {
          meta: {
            seeds,
            maxTicks: MAX_TICKS,
            stages,
            profiles: PROFILES,
            ships: SHIP_TYPES.map((s) => ({ id: s.id, slug: s.slug })),
            totalRuns: rows.length,
            elapsedMs,
          },
          cells,
          runs: rows,
        },
        null,
        2,
      ),
    );
  }
  // 두 플래그를 함께 주면 **한 번의 시뮬레이션 패스**로 JSON + 마크다운을 모두 낸다.
  // 워킹트리가 다른 세션에 의해 움직일 수 있는 환경에서 두 산출물이 서로 다른 코드 상태로
  // 만들어지는 것을 막는 장치다(실제로 한 번 당했다 — 측정 도중 시그니처 배선 커밋이 들어와
  // JSON 과 MD 의 말로우 수치가 갈렸다). 아래 구분선으로 잘라 쓴다.
  if (wantJson && wantMd) console.log('===MARKDOWN===');
  if (wantMd) console.log(renderMarkdown(cells, elapsedMs, stages));
  if (!wantJson && !wantMd) {
    for (const c of cells) {
      console.error(
        `[rosterBench] ${c.stage} ${c.profile} ${c.shipSlug}: clear=${pct(c.clearRate)} survive=${f1(c.survivalSec.mean)}s bossDps=${c.bossDps.n > 0 ? f1(c.bossDps.mean) : '—'}`,
      );
    }
  }
}

main();
