/**
 * **보스 TTK 계측기** — 보스가 서서 죽을 때까지 몇 초 버티는가.
 *
 * 사용자 신고(2026-08-08): *"보스의 HP가 낮아서 10단계와 20단계에서 테스트 했을 때 너무 빨리
 * 죽었어. 거의 3초안에 죽은거 같아. 30초 정도는 버틸 수 있게 수정해줘."*
 *
 * ## 왜 계측기부터인가
 * 같은 레인이 바로 앞에서 «계산으로 넣은 보상이 이중 보상이었다» 를 밟았다
 * (`.omc/plans/balance-queue.md` §R52-①). 보스 HP 도 계산으로 배수를 정하지 않는다 —
 * **화면에서 몇 초인지**를 재고 그 눈금으로 상수를 정한다.
 *
 * ## 무엇을 재는가
 * 표준 빌드(치트 패널 「표준 빌드 점프」와 같은 조립 경로)로 런을 굴려 **보스가 선 틱**부터
 * **보스가 죽은 틱**까지를 초로 환산한다. 파일럿은 내구(무적에 가깝게 HP 를 올림) — 재는 것이
 * *"봇이 이길 수 있는가"* 가 아니라 *"플레이어 화력이 보스 HP 를 얼마 만에 지우는가"* 이기
 * 때문이다(ADR-0051 이 게이트에서 내린 그 축과 같은 구분).
 *
 * ⚠️ 이 눈금은 **하한**이다. 봇은 카이팅하느라 사격 가동률이 사람보다 낮을 수 있고, 그러면
 * 실제 사람의 TTK 는 여기서 나온 값보다 짧다. 사용자 체감(3초)과 대조해서 읽어라.
 *
 * ```
 * node node_modules/.pnpm/vite-node@2.1.9_supports-color@7.2.0/node_modules/vite-node/vite-node.mjs bench/bossTtk.ts
 * node .../vite-node.mjs bench/bossTtk.ts -- --stages=1,10,20 --seeds=5
 * ```
 */

import { createWorld, stepWorld } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import { standardEquipped, standardPerTree, investVector } from '../src/bench/standardBuild.js';
import { contactPilotInput } from './contactPilot.js';
import { TICK_RATE } from '../src/sim/constants.js';

/** `bench/runCurve.ts`·`bench/incomingDps.ts` 와 같은 관용구 — DOM lib 아래에서 node 의 `process` 를 좁게 본다. */
interface NodeProcess {
  readonly argv?: readonly string[];
}
const ARGV: readonly string[] = (globalThis as { process?: NodeProcess }).process?.argv ?? [];

function argOf(name: string): string | undefined {
  const pre = `--${name}=`;
  for (const a of ARGV) if (a.startsWith(pre)) return a.slice(pre.length);
  return undefined;
}

/** 사용자가 테스트한 좌표: 단계 10 = Lv50 · 단계 20 = Lv100(치트 패널 표준 빌드 점프 규약). */
const STAGE_LEVEL: Readonly<Record<number, number>> = { 1: 1, 5: 25, 10: 50, 15: 75, 20: 100 };

const STAGES = (argOf('stages') ?? '1,10,20').split(',').map((s) => Number(s.trim()));
const SEEDS = Number(argOf('seeds') ?? '5');
/** 내구 파일럿 — 보스전 도달 전에 죽으면 잴 것이 없다. */
const DURABLE_HP = 100_000_000;
const MAX_TICKS = 60 * 60 * 12; // 12분 — 보스가 안 죽으면 그 사실 자체가 결과다.

/** 스트라이커·카르곤 — 사용자 5런 전부 그 조합이었다. */
const SHIP = 0;
const PLANET = 0;

interface Ttk {
  /** 보스가 선 틱(-1 = 끝까지 안 섰다). */
  spawnTick: number;
  /** 보스가 죽은 틱(-1 = 창 안에서 안 죽었다). */
  deathTick: number;
  bossMaxHp: number;
}

function bossOf(s: WorldState) {
  return s.entities.find((e) => e.kind === 'boss' && !e.dead);
}

function runOne(seed: number, stage: number): Ttk {
  const level = STAGE_LEVEL[stage] ?? Math.max(1, stage * 5);
  const profile = defaultProfile();
  const ship = activeShip(profile);
  ship.typeId = SHIP;
  ship.level = level;
  ship.skillInvest = investVector(SHIP, standardPerTree(level));
  ship.equipped = standardEquipped(level, seed, PLANET);
  const config = buildRunConfig(profile, { planet: PLANET, stage });
  const state = createWorld(seed, { ...config, playerHp: DURABLE_HP });

  let spawnTick = -1;
  let deathTick = -1;
  let bossMaxHp = 0;
  let sawBoss = false;
  for (let t = 0; t < MAX_TICKS; t++) {
    stepWorld(state, contactPilotInput(state));
    const b = bossOf(state);
    if (b !== undefined) {
      if (spawnTick < 0) {
        spawnTick = t;
        bossMaxHp = b.maxHp;
      }
      sawBoss = true;
    } else if (sawBoss && deathTick < 0) {
      deathTick = t;
      break;
    }
    if (state.victory || state.gameOver) break;
  }
  return { spawnTick, deathTick, bossMaxHp };
}

console.log(`보스 TTK — 스트라이커 · 카르곤 · 표준 빌드 · 내구 파일럿 · 시드 ${SEEDS}개`);
console.log('단계   Lv    보스 maxHp   도달  TTK중앙  실효DPS  [시드별 오름차순]');
for (const stage of STAGES) {
  const secs: number[] = [];
  let reached = 0;
  let maxHp = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = runOne(seed, stage);
    if (r.spawnTick >= 0) {
      reached++;
      maxHp = r.bossMaxHp;
      if (r.deathTick >= 0) secs.push((r.deathTick - r.spawnTick) / TICK_RATE);
    }
  }
  const sorted = [...secs].sort((a, b) => a - b);
  const med = sorted.length > 0 ? (sorted[(sorted.length - 1) >> 1] ?? NaN) : NaN;
  const dps = Number.isNaN(med) ? NaN : maxHp / med;
  const list = sorted.map((s) => s.toFixed(1)).join(' ');
  const level = STAGE_LEVEL[stage] ?? Math.max(1, stage * 5);
  console.log(
    `${String(stage).padStart(3)}  ${String(level).padStart(4)}  ${String(maxHp).padStart(10)}  ` +
      `${reached}/${SEEDS}  ${Number.isNaN(med) ? '  미격파' : med.toFixed(1).padStart(6)}  ` +
      `${Number.isNaN(dps) ? '     -' : Math.round(dps).toString().padStart(6)}  [${list}]`,
  );
}
