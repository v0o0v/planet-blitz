/**
 * 침공 밀도 계측 CLI — **측정값을 찍기만 한다. 단언이 없다**(ADR-0051 갈래 ①).
 *
 * ## 실행
 *   pnpm bench:density                          # L1 (기본)
 *   pnpm bench:density -- --layer=2             # L2 세 축
 *   pnpm bench:density -- --layer=3             # L3 두 축
 *   pnpm bench:density -- --layer=2 --axis=l2SpawnAliveAdd --values=0,5,10,20
 *   pnpm bench:density -- --layer=1 --values=40,80,120,200 --ticks=2700
 *   pnpm bench:density -- --layer=2 --axis=l2SpawnAliveAdd --l2FormationIntervalTicks=0
 *
 * 출력은 **ASCII 전용**이다 — PowerShell 콘솔 코드페이지가 UTF-8 이 아니면 한글이 mojibake 로
 * 깨져 판정을 방해한다. 한글은 이 주석에만 쓴다.
 *
 * ## 무엇을 재는가 — 봇 승률이 **아니다**
 * `bench:invasion` 은 참조봇 클리어율을 재는데, 현행 무대에서 그 값은 20기지 전부 0 이다
 * (참조봇이 빈 방어에도 L1 에서 죽는다). 밀도를 바꿔도 승률에는 신호가 없다.
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
 * ## 왜 레이어를 **각각 격리해서** 재는가 (안 그랬을 때 실제로 겪은 것)
 * 처음에는 고정 창(5400틱)으로 L1 부터 쭉 쟀는데 간격을 100→55 로 훑을 때 peak 이
 * 15 → 20 → 24 → 101 → 78 → 34 로 **비단조**하게 튀었다. 창이 L1 을 넘어 L2·L3 까지 물었기
 * 때문이다 — 그리고 그 넘어가는 시점 자체가 밀도에 의존한다: 적이 많으면 "구간 전멸"이 안
 * 걸려 스크롤 가속(`INVASION_ACCEL_*`)이 안 붙고, 그러면 L1 이 길어져 창 안에 다른 레이어가
 * 다른 비율로 섞인다. 즉 고정 창은 밀도를 재는 게 아니라 **밀도와 레이어 구성의 혼합물**을
 * 잰다.
 *
 * 그래서 이 도구는 **한 번에 한 레이어만** 잰다:
 *   - L1 은 처음부터 돌리고 페이즈가 L1 을 벗어나는 순간 끊는다.
 *   - L2·L3 는 **그 레이어로 점프한 뒤** 그 구간만 잰다(하네스 `jumpLayer` · 프리뷰
 *     `buildPreviewWorld` 와 같은 절차 — `clearLayerEntities` → phase 증가 →
 *     `enterLayerFrame` → `enterInvasionLayer`). 점프는 클리어 보너스를 주지 않는다.
 * 창은 레이어 예산(L1·L2 5400 · L3 7200)이 기본이고 `--ticks` 로 덮는다.
 *
 * ## 무대
 * **기본 수비대만 있는 빈 배치**(아무것도 배치 안 한 방어)를 잰다 — 사용자가 정한 기준선이
 * 바로 그 상태다. 플레이어는 무입력·무적(HP 를 크게 준다)이라 "적이 얼마나 나오는가"만
 * 남는다. 적을 잡지 않으므로 press 는 **상한선**이지 실전값이 아니다.
 *
 * ⚠️ 무입력·무적이라 L2·L3 는 스스로 끝나지 않는다(코어를 아무도 안 깎는다). 그래서 두
 *    레이어의 `ticks` 는 항상 창 전체이고, 읽을 것은 spawns·peak·press 뿐이다.
 */

import { createWorld, stepWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import {
  INVASION_ACCEL_BASE_CP,
  INVASION_DENSITY_DEFAULT,
  INVASION_DENSITY_LEGACY,
  INVASION_L1_TICKS,
  INVASION_L2_TICKS,
  INVASION_L3_TICKS,
  INVASION_TOTAL_TICKS,
  INVASION_WAVE_SLOTS,
  clearLayerEntities,
  emptyInvasionLayers,
  enterInvasionLayer,
  enterLayerFrame,
  invasionL1ScheduleSpan,
  invasionL1WaveCount,
  makeInvasionContext,
  type InvasionDensity,
  type InvasionPhase,
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

/** 쉼표 목록을 정수 배열로. 비거나 손상되면 fallback. 0 을 허용한다(축 끄기 값이다). */
function intList(raw: string | undefined, fallback: readonly number[]): number[] {
  if (raw === undefined) return [...fallback];
  const out = raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0)
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
  /** 실제로 잰 틱 수(= 그 레이어가 지속된 길이, 또는 창 전체). */
  ticks: number;
  spawns: number;
  peak: number;
  press: number;
}

/**
 * 목표 레이어로 점프한 월드를 만든다. 절차는 하네스 `jumpLayer` · 프리뷰 `buildPreviewWorld`
 * 와 **같다** — 사본을 두면 한쪽만 고쳐졌을 때 "같은 무대를 쟀다"가 조용히 거짓이 된다.
 * (프리뷰 쪽은 Pixi 렌더 입력을 함께 만들어야 해서 함수를 직접 못 빌려 온다.)
 */
function worldAtLayer(seed: number, density: InvasionDensity, phase: InvasionPhase): WorldState {
  const world = createWorld(seed, invasionConfig(density));
  const runtime = world.invasion3;
  const cfg = world.config.invasion3;
  if (runtime === undefined || cfg === undefined) return world;
  while (runtime.phase < phase) {
    clearLayerEntities(world);
    runtime.phase = (runtime.phase + 1) as InvasionPhase;
    runtime.phaseEnterTick = world.tick;
    runtime.accelCp = INVASION_ACCEL_BASE_CP;
    enterLayerFrame(world, cfg, runtime);
    enterInvasionLayer(world, makeInvasionContext(cfg, runtime));
  }
  return world;
}

/**
 * 무입력으로 돌리며 **해당 레이어에 머무는 동안만** 세 지표를 잰다.
 *
 * 새 등장 수는 **엔티티 id 집합**으로 센다 — 살아 있는 수의 증분으로 세면 같은 틱에
 * 죽고 태어난 경우를 놓쳐 과소 계수된다.
 */
function measure(state: WorldState, phase: InvasionPhase, maxTicks: number): Sample {
  const seen = new Set<number>();
  let peak = 0;
  let press = 0;
  let t = 0;
  for (; t < maxTicks; t++) {
    stepWorld(state, IDLE);
    // 그 레이어를 벗어나면 즉시 멈춘다(전이 틱의 잔여는 세지 않는다).
    if (state.invasion3 !== undefined && state.invasion3.phase !== phase) break;
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
// 레이어별 스윕 축 — 무엇을 흔들면 그 레이어의 밀도가 움직이는가
// ---------------------------------------------------------------------------

/** 스윕 축 하나. `key` 는 {@link InvasionDensity} 의 필드다. */
interface Axis {
  readonly key: keyof InvasionDensity;
  readonly values: readonly number[];
  /** 그 축이 무엇을 미는지 한 줄(ASCII). */
  readonly note: string;
}

/**
 * 레이어별 기본 스윕. 값 목록은 **현행 기본값을 가운데 두고** 양옆을 훑도록 잡았다 —
 * 기본값이 어느 쪽 끝에 붙어 있으면 "더 밀 여지가 있는가"를 못 읽는다.
 */
const LAYER_AXES: Record<number, readonly Axis[]> = {
  1: [
    {
      key: 'l1IntervalTicks',
      values: [720, 300, 200, 120, 80, 60, 40, 30],
      note: 'wave slot spacing. shorter = more often; peak rises only once waves overlap',
    },
  ],
  2: [
    {
      key: 'l2FormationIntervalTicks',
      values: [0, 300, 200, 120, 80, 50, 30],
      note: 'background formation spacing in the corridor (0 = off)',
    },
    {
      key: 'l2SpawnAliveAdd',
      values: [0, 3, 7, 12, 20, 32],
      note: 'per-spawner alive cap ADD on top of catalog spawnMaxAlive',
    },
    {
      key: 'l2GarrisonSpawners',
      values: [0, 2, 4, 7, 10, 12],
      note: 'how many EMPTY sockets the garrison fills with spawners (placed sockets untouched)',
    },
  ],
  3: [
    {
      key: 'l3AddIntervalTicks',
      values: [0, 120, 60, 30, 20, 10, 5],
      note: 'core reinforcement spacing (shrinks further as core HP drops)',
    },
    {
      key: 'l3AddMaxAlive',
      values: [0, 10, 20, 40, 60, 64],
      note: 'core reinforcement alive cap',
    },
  ],
};

const LAYER_BUDGET: Record<number, number> = {
  1: INVASION_L1_TICKS,
  2: INVASION_L2_TICKS,
  3: INVASION_L3_TICKS,
};

// ---------------------------------------------------------------------------

const layer = (() => {
  const n = Math.trunc(Number(arg('layer') ?? 1));
  return n === 2 || n === 3 ? n : 1;
})();
const phase = (layer - 1) as InvasionPhase;
const ticks = Math.max(60, Number(arg('ticks') ?? LAYER_BUDGET[layer] ?? INVASION_L1_TICKS));
const repeats = Math.max(1, Number(arg('repeats') ?? INVASION_DENSITY_DEFAULT.l1Repeats));
const seed = Number(arg('seed') ?? 4242);

/**
 * 스윕하지 않는 축의 base 를 덮는다 — `--l2FormationIntervalTicks=0` 처럼 필드명을 그대로 쓴다.
 *
 * 이게 필요한 이유: 한 축이 **다른 축에 가려 안 보일 수 있다.** 실제로 `l2SpawnAliveAdd` 는
 * 기본 무대에서 0~32 전 구간이 바이트 동일하게 나오는데, 배경 편대(간격 50)가 만드는 압력이
 * 스포너 몫을 덮어 상한이 애초에 안 걸리기 때문이다. 배경을 끄고(`=0`) 다시 재야 그 축이
 * 스스로 무엇을 하는지 보인다.
 */
function baseOverrides(): Partial<InvasionDensity> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(INVASION_DENSITY_DEFAULT)) {
    const raw = arg(key);
    if (raw === undefined) continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) out[key] = Math.trunc(n);
  }
  return out as Partial<InvasionDensity>;
}
const OVERRIDES = baseOverrides();

/** `--axis=` 로 한 축만 고른다. 미지정이면 그 레이어의 전 축. */
const axisFilter = arg('axis');
const axes = (LAYER_AXES[layer] ?? []).filter((a) => axisFilter === undefined || a.key === axisFilter);

console.log(`=== invasion L${layer} density sweep (empty defense = garrison only) ===`);
console.log(`window=${ticks}t  repeats=${repeats}  seed=${seed}  slots=${INVASION_WAVE_SLOTS}`);
console.log('planet-run reference: maxEnemies 12->44 per segment, cardInterval 150-220t');
if (layer > 1) {
  console.log(`stage: jumped straight to L${layer} (clearLayerEntities -> phase++ -> enterLayerFrame -> enterInvasionLayer)`);
  console.log('       idle+invincible player never ends the layer, so ticks is always the full window');
}
const overrideKeys = Object.keys(OVERRIDES);
if (overrideKeys.length > 0) {
  console.log(
    `base overrides: ${overrideKeys.map((k) => `${k}=${(OVERRIDES as Record<string, number>)[k]}`).join(' ')}`,
  );
}
if (axes.length === 0) {
  console.log(`no axis matched --axis=${axisFilter ?? ''}. available: ${(LAYER_AXES[layer] ?? []).map((a) => a.key).join(', ')}`);
}

for (const axis of axes) {
  console.log('');
  console.log(`--- axis ${axis.key} ---`);
  console.log(`    ${axis.note}`);
  const isL1Interval = axis.key === 'l1IntervalTicks';
  console.log(
    isL1Interval
      ? 'value     waves  span   ticks  spawns  peak   press   note'
      : 'value                    ticks  spawns  peak   press   note',
  );

  // `--values=` 는 축 하나만 고른 상태에서만 뜻이 있다(두 축에 같은 목록을 쓰면 헛값이다).
  const values = axes.length === 1 ? intList(arg('values'), axis.values) : axis.values;
  for (const value of values) {
    // 다른 축은 **현행 기본값**에 둔다. legacy 에 두면 "이 축이 혼자 무엇을 하는가"가 아니라
    // "밀도 축이 통째로 꺼진 무대에서 이 축이 무엇을 하는가"를 재게 된다.
    const density: InvasionDensity = {
      ...INVASION_DENSITY_DEFAULT,
      l1Repeats: repeats,
      ...OVERRIDES,
      [axis.key]: value,
    };
    const s = measure(worldAtLayer(seed, density, phase), phase, ticks);
    const notes: string[] = [];
    if (value === INVASION_DENSITY_DEFAULT[axis.key]) notes.push('current default');
    if (value === INVASION_DENSITY_LEGACY[axis.key]) notes.push('legacy');
    if (isL1Interval) {
      const span = invasionL1ScheduleSpan(density, INVASION_WAVE_SLOTS);
      const waves = invasionL1WaveCount(density, INVASION_WAVE_SLOTS);
      if (span > INVASION_L1_TICKS) notes.push('SPAN OVER BUDGET');
      console.log(
        `${pad(value, 8)}  ${pad(waves, 5)}  ${pad(span, 5)}  ${pad(s.ticks, 5)}  ${pad(s.spawns, 6)}  ${pad(s.peak, 4)}  ${pad(s.press, 6)}   ${notes.join(' / ')}`,
      );
    } else {
      console.log(
        `${pad(value, 8)}                 ${pad(s.ticks, 5)}  ${pad(s.spawns, 6)}  ${pad(s.peak, 4)}  ${pad(s.press, 6)}   ${notes.join(' / ')}`,
      );
    }
  }
}

console.log('');
console.log('read: peak = how crowded the screen gets; press = spawns x lifetime.');
console.log('      shrinking an interval alone raises press but NOT peak until waves overlap.');
console.log('      other axes stay at the current defaults, so each row is that axis alone.');
