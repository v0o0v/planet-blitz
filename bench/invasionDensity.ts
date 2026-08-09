/**
 * 침공 밀도 계측 CLI — **측정값을 찍기만 한다. 단언이 없다**(ADR-0051 갈래 ①).
 *
 * ## 실행
 *   pnpm bench:density
 *   pnpm bench:density -- --intervals=40,80,120,200 --ticks=2700
 *
 * 출력은 **ASCII 전용**이다 — PowerShell 콘솔 코드페이지가 UTF-8 이 아니면 한글이 mojibake 로
 * 깨져 판정을 방해한다. 한글은 이 주석에만 쓴다.
 *
 * ## 무엇을 재는가 — 봇 승률이 **아니다**
 * `bench:invasion` 은 참조봇 클리어율을 재는데, 그 머리말이 스스로 적어 뒀듯 시드 간 분산이
 * 통째로 `state.powerupRng` 에서 나온다. 즉 그 수치는 배치 난이도가 아니라 **파워업 추첨 운의
 * 분포**라, 밀도를 바꿔도 신호가 안 보인다.
 *
 * 그래서 이 도구는 RNG 와 무관하게 재현되는 **결정론적 압력 지표** 세 가지를 찍는다:
 *   spawns  — 구간 동안 새로 등장한 적의 총수
 *   peak    — 동시에 살아 있던 적의 최댓값 ("화면이 얼마나 빽빽한가")
 *   press   — 생존 적 수의 틱 적분 ("몇 마리가 · 얼마나 오래")
 *
 * ## peak 과 press 를 **둘 다** 봐야 하는 이유 (2026-08-10 실측으로 배운 것)
 * 슬롯 간격을 720 → 200 으로 줄였을 때 **press 는 크게 올랐는데 peak 은 5에서 안 움직였다.**
 * 편대가 200틱 안에 화면을 지나가 버려 두 웨이브가 겹치지 않았기 때문이다. 즉:
 *   - 간격만 줄이면 "더 자주 나온다"(press↑)이지 "더 빽빽하다"(peak↑)가 아니다.
 *   - **행성런 수준의 동시 적 수(세그먼트별 12~44, `data/waves.ts` SEGMENTS)를 원하면
 *     간격이 웨이브 수명보다 짧아져야 한다.**
 * 사용자가 처음 제기한 "상대하는 기체가 너무 적다"는 peak 쪽 감각에 가까우므로, 튜닝의
 * 1차 목표선은 peak 이다. 이 CLI 는 그 지점을 손으로 찾으라고 만든 것이다.
 *
 * ## 무대
 * **기본 수비대만 있는 빈 배치**(아무것도 배치 안 한 방어)를 잰다 — 사용자가 정한 기준선이
 * 바로 그 상태다. 플레이어는 무입력·무적(HP 를 크게 준다)이라 "적이 얼마나 나오는가"만
 * 남는다. 적을 잡지 않으므로 press 는 **상한선**이지 실전값이 아니다.
 */

import { createWorld, stepWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import {
  INVASION_DENSITY_DEFAULT,
  INVASION_DENSITY_LEGACY,
  INVASION_L1_TICKS,
  INVASION_TOTAL_TICKS,
  INVASION_WAVE_SLOTS,
  PHASE_L1,
  emptyInvasionLayers,
  invasionL1ScheduleSpan,
  invasionL1WaveCount,
  type InvasionDensity,
} from '../src/sim/invasion/index.js';

const IDLE: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };

/**
 * `process` 는 sim 리프 타입 환경에 없다(브라우저 번들과 타입을 공유한다). `bench/runCurve.ts`
 * 와 같은 방식으로 globalThis 에서 좁혀 읽는다.
 */
interface NodeProcess {
  readonly argv?: readonly string[];
}
const ARGV: readonly string[] = (globalThis as { process?: NodeProcess }).process?.argv ?? [];

/** `--key=value` 인자 하나를 읽는다. 없으면 undefined. */
function arg(key: string): string | undefined {
  const pre = `--${key}=`;
  const hit = ARGV.find((a) => a.startsWith(pre));
  return hit === undefined ? undefined : hit.slice(pre.length);
}

/** 쉼표 목록을 정수 배열로. 비거나 손상되면 fallback. */
function intList(raw: string | undefined, fallback: readonly number[]): number[] {
  if (raw === undefined) return [...fallback];
  const out = raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.trunc(n));
  return out.length === 0 ? [...fallback] : out;
}

function invasionConfig(density: InvasionDensity): WorldConfig {
  return {
    ...DEFAULT_CONFIG,
    // 플레이어가 죽으면 그 뒤 구간이 통째로 안 측정된다. 방어 쪽은 손대지 않으므로
    // 스폰 경로는 정본 그대로다.
    playerHp: 100_000_000,
    invasion3: {
      layers: emptyInvasionLayers(),
      timeLimitTicks: INVASION_TOTAL_TICKS,
      maintenance: 10000,
      density,
    },
  } as WorldConfig;
}

interface Sample {
  /** 실제로 잰 틱 수(= L1 이 지속된 길이). */
  ticks: number;
  spawns: number;
  peak: number;
  press: number;
}

/**
 * 무입력으로 돌리며 **L1 구간만** 세 지표를 잰다.
 *
 * ## 왜 L1 에서 끊는가 (안 끊었을 때 실제로 겪은 것)
 * 처음에는 고정 창(5400틱)으로 쟀는데 간격을 100→55 로 훑을 때 peak 이
 * 15 → 20 → 24 → 101 → 78 → 34 로 **비단조**하게 튀었다. 창이 L1 을 넘어 L2·L3 까지 물었기
 * 때문이다 — 그리고 그 넘어가는 시점 자체가 밀도에 의존한다: 적이 많으면 "구간 전멸"이 안
 * 걸려 스크롤 가속(`INVASION_ACCEL_*`)이 안 붙고, 그러면 L1 이 길어져 창 안에 다른 레이어가
 * 다른 비율로 섞인다. 즉 고정 창은 밀도를 재는 게 아니라 **밀도와 레이어 구성의 혼합물**을
 * 잰다.
 *
 * 새 등장 수는 **엔티티 id 집합**으로 센다 — 살아 있는 수의 증분으로 세면 같은 틱에
 * 죽고 태어난 경우를 놓쳐 과소 계수된다.
 */
function measure(state: WorldState, maxTicks: number): Sample {
  const seen = new Set<number>();
  let peak = 0;
  let press = 0;
  let t = 0;
  for (; t < maxTicks; t++) {
    stepWorld(state, IDLE);
    // L1 을 벗어나면 즉시 멈춘다(전이 틱의 잔여는 세지 않는다).
    if (state.invasion3 !== undefined && state.invasion3.phase !== PHASE_L1) break;
    let alive = 0;
    for (const e of state.entities) {
      if (e.kind !== 'enemy' || e.dead) continue;
      alive++;
      seen.add(e.id);
    }
    press += alive;
    if (alive > peak) peak = alive;
  }
  return { ticks: t, spawns: seen.size, peak, press };
}

function pad(s: string | number, n: number): string {
  const t = String(s);
  return t.length >= n ? t : ' '.repeat(n - t.length) + t;
}

// ---------------------------------------------------------------------------

const ticks = Math.max(60, Number(arg('ticks') ?? INVASION_L1_TICKS));
const intervals = intList(arg('intervals'), [720, 300, 200, 120, 80, 60, 40, 30]);
const repeats = Math.max(1, Number(arg('repeats') ?? INVASION_DENSITY_DEFAULT.l1Repeats));
const seed = Number(arg('seed') ?? 4242);

console.log('=== invasion L1 density sweep (empty defense = garrison only) ===');
console.log(`window=${ticks}t  repeats=${repeats}  seed=${seed}  slots=${INVASION_WAVE_SLOTS}`);
console.log('planet-run reference: maxEnemies 12->44 per segment, cardInterval 150-220t');
console.log('');
console.log('interval  waves  span   L1t   spawns  peak   press   note');

for (const interval of intervals) {
  const density: InvasionDensity = {
    ...INVASION_DENSITY_DEFAULT,
    l1IntervalTicks: interval,
    l1Repeats: repeats,
  };
  const s = measure(createWorld(seed, invasionConfig(density)), ticks);
  const span = invasionL1ScheduleSpan(density, INVASION_WAVE_SLOTS);
  const waves = invasionL1WaveCount(density, INVASION_WAVE_SLOTS);
  const notes: string[] = [];
  if (span > INVASION_L1_TICKS) notes.push('SPAN OVER BUDGET');
  if (interval === INVASION_DENSITY_LEGACY.l1IntervalTicks) notes.push('legacy');
  if (interval === INVASION_DENSITY_DEFAULT.l1IntervalTicks) notes.push('current default');
  console.log(
    `${pad(interval, 8)}  ${pad(waves, 5)}  ${pad(span, 5)}  ${pad(s.ticks, 4)}  ${pad(s.spawns, 6)}  ${pad(s.peak, 4)}  ${pad(s.press, 6)}   ${notes.join(' / ')}`,
  );
}

console.log('');
console.log('read: peak = how crowded the screen gets; press = spawns x lifetime.');
console.log('      shrinking interval alone raises press but NOT peak until waves overlap.');
