/**
 * **레벨 성장 곡선 계측기** — §R51 「장비 축 포화」의 공비를 고르는 데 쓴 계측기.
 *
 * ## 무엇을 재는가
 * 표준 빌드(`standardGearSet(level, seed)`)를 정규 경로(`computeLoadoutStats`)로 접어
 * **실효 전투력** 세 눈금을 낸다:
 *  · `dps` = 발당 피해 × 발수 × 초당 발사 (sim 의 반올림 자리까지 미러 — `nominalPower.rawStats` 와 같은 식)
 *  · `ehp` = 기준 HP + `maxHpAdd`
 *  · `power` = `dps × ehp`  ← "실효 전투력" 의 정본 정의(이 리포의 명목 파워 모델과 같은 곱)
 *
 * 그리고 이 레인의 **합격선**인 「Lv100 이 Lv50 보다 약할 확률」을 시드 전수 교차로 센다:
 * 시드 N 개 × N 개 쌍 전부에서 `power(100, s_i) < power(50, s_j)` 를 세어 비율을 낸다.
 * 서로 다른 시드를 물리는 이유는 그것이 「두 사람의 Lv100·Lv50 조종사를 비교한다」는
 * 사용자 체감의 형태이기 때문이다(같은 시드끼리 물리면 롤 운이 상쇄돼 문제가 안 보인다).
 *
 * ## ⚠️ 봇 계측이 아니다 — 그래서 절대 초·절대 피해량을 여기서 읽지 마라
 * sim 을 한 틱도 안 돌린다. 여기서 나오는 것은 **조립된 빌드의 닫힌 식**이고, 가동률·명중률·
 * 표적 크기가 전부 빠져 있다(그 셋이 화력 계측의 주 변수라는 기록은 `src/sim/enemyScale.ts`
 * `BOSS_HP_GROWTH_PER_STAGE` 주석에 있다). 이 계측기가 답할 수 있는 것은 **비(比)** 뿐이다 —
 * "Lv100 이 Lv50 의 몇 배인가", "그 배수가 롤 분산을 이기는가".
 *
 * ## 공비 후보 비교
 * `--cands=1,1.0165,1.0233,1.033` 처럼 넘기면 후보별 표를 나란히 낸다. 1 = 현행(무성장).
 * 후보는 **레벨당** 공비다(`data/waves.ts` `LEVEL_PER_STAGE` = 5 라 단계당 공비 = q^5).
 *
 * ```
 * pnpm bench:gearlevel
 * pnpm bench:gearlevel -- --cands=1,1.033 --seeds=16
 * ```
 */

import { computeLoadoutStats } from '../src/items/loadout.js';
import { standardGearSet } from '../src/bench/standardBuild.js';
import { BASE_DAMAGE, BASE_FIRE_CD_TICKS, MIN_FIRE_CD_TICKS, BASE_PLAYER_HP } from '../src/bench/nominalPower.js';
import { TICK_RATE } from '../src/sim/constants.js';
import { stageHpMult } from '../data/waves.js';
import { bossStageHpMult } from '../src/sim/enemyScale.js';
import { LEVEL_PER_STAGE, standardStage } from '../src/save/progressionPath.js';

/**
 * 카르곤 보스의 단계 1 실효 HP(= `data/bosses` 저작값 × `BOSS_HP_MULT`). `enemyScale.ts`
 * `BOSS_HP_GROWTH_PER_STAGE` 주석 표의 «단계 1 = 7,200» 과 같은 값이다.
 */
const KARGON_BOSS_HP_AT_STAGE_1 = 7200;
/**
 * 보스전 실효 DPS 의 **사용자 실측 눈금** — `enemyScale.ts` 가 정본이다(HP 7,200 을 «거의 3초»).
 * ⚠️ **레벨 무관**이라는 것이 이 눈금의 핵심이다 — 그 평평함이 이 레인이 고치려는 결함 자체다.
 */
const USER_MEASURED_BOSS_DPS = 2400;

interface NodeProcess {
  readonly argv?: readonly string[];
}
const ARGV: readonly string[] = (globalThis as { process?: NodeProcess }).process?.argv ?? [];

function argOf(name: string): string | undefined {
  const pre = `--${name}=`;
  for (const a of ARGV) if (a.startsWith(pre)) return a.slice(pre.length);
  return undefined;
}

/** 후보 공비를 레벨 1 기준 배수로 접는다 — **반복 곱**(`Math.pow` 금지, 구현부와 같은 산술). */
function levelMult(level: number, q: number): number {
  const n = Math.max(0, Math.min(400, Math.floor(level) - 1));
  let m = 1;
  for (let i = 0; i < n; i++) m *= q;
  return m;
}

interface Power {
  readonly dps: number;
  readonly ehp: number;
  readonly power: number;
}

/** 정규 경로로 조립한 뒤 후보 배수를 얹어 실효 전투력을 낸다(구현부와 같은 자리·같은 산술). */
function powerAt(level: number, seed: number, q: number): Power {
  const { loadout } = computeLoadoutStats(standardGearSet(level, seed), undefined, 0);
  const m = levelMult(level, q);
  const damageMult = loadout.damageMult * m;
  const maxHpAdd = loadout.maxHpAdd + Math.round((BASE_PLAYER_HP + loadout.maxHpAdd) * (m - 1));
  const damage = Math.round(BASE_DAMAGE * damageMult * 100) / 100;
  const cdQ = Math.max(MIN_FIRE_CD_TICKS * 256, Math.round(BASE_FIRE_CD_TICKS * 256 * loadout.fireRateMult));
  const shotsPerSec = TICK_RATE / (cdQ / 256);
  const dps = damage * (1 + loadout.bulletCountAdd) * shotsPerSec;
  const ehp = BASE_PLAYER_HP + maxHpAdd;
  return { dps, ehp, power: dps * ehp };
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 === 1 ? (s[h] as number) : ((s[h - 1] as number) + (s[h] as number)) / 2;
}

function fmt(n: number): string {
  if (n >= 10000) return n.toFixed(0);
  if (n >= 100) return n.toFixed(1);
  return n.toFixed(3);
}

function main(): void {
  const cands = (argOf('cands') ?? '1,1.0165,1.0233,1.033').split(',').map(Number);
  const nSeeds = Number(argOf('seeds') ?? '24');
  const seeds = Array.from({ length: nSeeds }, (_, i) => 0x5eed + i * 0x9e37);
  const levels = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  console.log('# 레벨 성장 곡선 후보 비교');
  console.log(`시드 ${nSeeds}개 · 스트라이커(typeId 0) · 표준 빌드`);
  console.log(`참고: 적 HP 배율 stage(Lv/5) — Lv5 ×${stageHpMult(1).toFixed(2)} · Lv50 ×${stageHpMult(standardStage(50)).toFixed(2)} · Lv100 ×${stageHpMult(standardStage(100)).toFixed(2)}`);
  console.log('');

  for (const q of cands) {
    const perStage = levelMult(1 + LEVEL_PER_STAGE, q);
    console.log(`## 후보 q(레벨당) = ${q}   [단계당 = ${perStage.toFixed(4)} · Lv5→100 = ×${fmt(levelMult(100, q) / levelMult(5, q))}]`);
    console.log('| Lv | dps 중위 | ehp 중위 | power 중위 | Lv5 대비 power |');
    console.log('|---|---|---|---|---|');
    const base = median(seeds.map((s) => powerAt(5, s, q).power));
    for (const lv of levels) {
      const rows = seeds.map((s) => powerAt(lv, s, q));
      console.log(
        `| ${lv} | ${fmt(median(rows.map((r) => r.dps)))} | ${fmt(median(rows.map((r) => r.ehp)))} | ${fmt(median(rows.map((r) => r.power)))} | ×${fmt(median(rows.map((r) => r.power)) / base)} |`,
      );
    }
    // 합격선 — 「Lv100 이 Lv50 보다 약할 확률」(시드 전수 교차)
    const hi = seeds.map((s) => powerAt(100, s, q).power);
    const lo = seeds.map((s) => powerAt(50, s, q).power);
    let worse = 0;
    for (const a of hi) for (const b of lo) if (a < b) worse++;
    const pct = (100 * worse) / (hi.length * lo.length);
    // dps 만으로도 같이 본다(생존을 뺀 화력 축 단독).
    const hiD = seeds.map((s) => powerAt(100, s, q).dps);
    const loD = seeds.map((s) => powerAt(50, s, q).dps);
    let worseD = 0;
    for (const a of hiD) for (const b of loD) if (a < b) worseD++;
    console.log('');
    console.log(`**「Lv100 < Lv50」 확률: power 기준 ${pct.toFixed(1)}% · dps 기준 ${((100 * worseD) / (hiD.length * loD.length)).toFixed(1)}%**`);
    // 보스 TTK 부작용 — 사용자 눈금(2,400 실효DPS, 레벨 무관 실측)에 이 배수를 곱한다.
    // 보스 HP 는 `bossStageHpMult`(PR#390) × 카르곤 7,200 × `BOSS_HP_MULT`(이미 반영된 값 7,200).
    const ttk: string[] = [];
    for (const st of [1, 10, 20]) {
      const hp = KARGON_BOSS_HP_AT_STAGE_1 * bossStageHpMult(st);
      const dpsNow = USER_MEASURED_BOSS_DPS * levelMult(st * LEVEL_PER_STAGE, q);
      ttk.push(`단계${st}(Lv${st * LEVEL_PER_STAGE}) ${(hp / dpsNow).toFixed(1)}초`);
    }
    console.log(`보스 TTK(사용자 눈금 ${USER_MEASURED_BOSS_DPS}DPS × 이 배수): ${ttk.join(' · ')}`);
    console.log('');
  }
}

main();
