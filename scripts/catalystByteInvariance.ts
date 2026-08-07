/**
 * **무촉매 런 바이트 불변 대조** — ADR-0052 §결정론 규율(공통-A)의 근거 산출기.
 *
 * 헌장이 못 박은 것: *"골든 재생성은 검증이 아니다. 근거는 재생성 **전에** 통과시킨 불변식
 * (무촉매 런 바이트 불변 대조)이어야 한다."*
 *
 * `tests/determinismGate.test.ts` 는 **자기 재현성**(같은 시드 두 번 → 같은 해시)만 본다 —
 * 그것은 "이 브랜치가 스스로 결정론적인가"이지 **"main 과 같은가"가 아니다.** 촉매 재작성이
 * 무촉매 런을 건드리지 않았다는 것은 후자이고, 그래서 이 스크립트가 따로 필요하다.
 *
 * ## 쓰는 법
 * 두 워크트리에서 각각 돌려 JSON 을 뽑고 diff 한다.
 * ```
 * npx tsx scripts/catalystByteInvariance.ts > <어딘가>/impl.json     # 이 브랜치
 * npx tsx scripts/catalystByteInvariance.ts > <어딘가>/main.json     # main 체크아웃
 * ```
 * **두 파일이 바이트 동일해야 한다.** 다르면 촉매와 무관한 런의 거동이 갈린 것이므로,
 * 골든 재생성으로 덮지 말고 원인을 찾아라.
 *
 * ⚠️ 출력은 **per-tick 해시 전량이 아니라 창별 요약**이다(전량은 수십 MB). 대신 창을 넷으로
 * 쪼개 접어서, 발산이 언제 시작됐는지가 diff 에서 바로 읽힌다.
 * ⚠️ `config.catalysts` 를 **넣지 않는다** — 이 스크립트가 재는 것은 무촉매 축 하나다.
 */

import {
  BASELINE_PLANETS,
  BASELINE_BUILDS,
  gearedBaselineConfig,
  driveBaseline,
} from './recordStrikerBaseline.js';
import type { BuildSpec } from './recordStrikerBaseline.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import type { InputFrame } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';

/** 골든 창과 같은 길이로 잡는다 — 짧으면 후반에만 나는 발산을 놓친다. */
const TICKS = 6000;
/** 창을 넷으로 접어 발산 시작 구간을 좁힌다. */
const SEGMENTS = 4;

function u32(h: number, v: number): number {
  let x = (h ^ v) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

interface Row {
  planet: string;
  build: string;
  seed: number;
  /** 창을 SEGMENTS 등분해 각 구간의 per-tick 해시를 접은 값. */
  segments: number[];
  /** 마지막 틱의 해시(원값). */
  final: number;
}

const rows: Row[] = [];
const seg = Math.floor(TICKS / SEGMENTS);

for (const planet of BASELINE_PLANETS) {
  for (let b = 0; b < BASELINE_BUILDS.length; b++) {
    const build = BASELINE_BUILDS[b] as BuildSpec;
    // 시드·설정·입력 조립을 `recordRun`(골든 녹화기)과 **같은 식**으로 맞춘다 — 다르게 조립하면
    // 이 대조가 골든이 실제로 덮는 축과 어긋난다.
    const seed = (planet.seedBase + b * 0x1_0001) >>> 0;
    // 촉매를 넣지 않는다 — 이 대조의 축이 그것이다.
    const config = gearedBaselineConfig(planet, build.invest, seed);
    const inputs = driveBaseline(seed, config, TICKS);
    const state = createWorld(seed, config);
    const folds = new Array<number>(SEGMENTS).fill(0);
    let final = 0;
    for (let t = 0; t < inputs.length; t++) {
      stepWorld(state, inputs[t] as InputFrame);
      final = hashWorld(state);
      const s = Math.min(SEGMENTS - 1, Math.floor(t / seg));
      folds[s] = u32(folds[s] ?? 0, final);
    }
    rows.push({ planet: planet.id, build: build.id, seed, segments: folds, final });
  }
}

process.stdout.write(`${JSON.stringify({ ticks: TICKS, segments: SEGMENTS, rows }, null, 2)}\n`);
