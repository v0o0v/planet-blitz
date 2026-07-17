/**
 * 헤드리스 장시간 시뮬 메모리 프로브 (M5 Phase D2, AC9 — 장시간 세션 메모리 누수 점검).
 *
 * sim 은 렌더/DOM 이 없는 순수 상태 기계이므로, 여기서는 **sim 코어의 힙 누수**만 계측한다
 * (PixiJS/DOM 누수는 코드 정적 감사로 별도 확인 — docs/qa/m5-phase-d-results.md).
 *
 * 방법: 짧은 런(수천 틱)을 여러 라운드 반복 생성·폐기하면서, 각 라운드 끝에 GC 를 강제하고
 * `heapUsed` 를 기록한다. 라운드마다 world 를 새로 만들고 참조를 버리므로, 힙이 라운드 수에
 * 비례해 단조 증가하면 잔존 참조(누수) 신호다. 안정적이면(초기 워밍업 후 평탄) 누수 없음.
 *
 * 실행:  node --expose-gc ./node_modules/vite-node/vite-node.mjs src/bench/memProbe.ts
 */

import { createWorld, stepWorld, emptyInput } from '../sim/world.js';

const ROUNDS = 40;
const TICKS_PER_ROUND = 5000;

function gc(): void {
  const g = (globalThis as { gc?: () => void }).gc;
  if (g) g();
}

function runOneRound(seed: number): number {
  const state = createWorld(seed);
  state.wave.done = true;
  const player = state.entities[0]!;
  player.hp = 1e9;
  player.maxHp = 1e9;
  const idle = emptyInput();
  let acc = 0;
  for (let t = 0; t < TICKS_PER_ROUND; t++) {
    // 이동을 섞어 청크/벽 생성·폐기 경로를 계속 밟는다(scroll-map 컬링 누수 점검).
    const moving = (t % 200) < 120;
    stepWorld(state, moving ? { moveX: 1, moveY: -1, aim: 0, dash: false, special: 0 } : idle);
    acc += state.entities.length;
  }
  return acc; // 최적화로 런이 통째로 제거되지 않도록 참조 반환.
}

function main(): void {
  if (!(globalThis as { gc?: () => void }).gc) {
    console.log('[memProbe] WARN: --expose-gc 없이 실행됨 — 힙 수치가 GC 타이밍에 흔들림. ' +
      'node --expose-gc 로 실행 권장.');
  }
  const samples: number[] = [];
  let sink = 0;
  for (let r = 0; r < ROUNDS; r++) {
    sink += runOneRound(0x1000 + r);
    gc();
    const proc = (globalThis as { process?: { memoryUsage(): { heapUsed: number } } }).process;
    const mb = (proc ? proc.memoryUsage().heapUsed : 0) / (1024 * 1024);
    samples.push(mb);
    if (r % 5 === 0 || r === ROUNDS - 1) {
      console.log(`[memProbe] round ${String(r).padStart(2)}: heapUsed=${mb.toFixed(2)} MB`);
    }
  }
  // 워밍업(앞 10라운드) 이후 구간의 추세를 본다.
  const warm = samples.slice(10);
  const first = warm[0]!;
  const last = warm[warm.length - 1]!;
  const min = Math.min(...warm);
  const max = Math.max(...warm);
  const growth = last - first;
  console.log(`\n[memProbe] 워밍업(10R) 후 구간: first=${first.toFixed(2)}MB last=${last.toFixed(2)}MB ` +
    `min=${min.toFixed(2)} max=${max.toFixed(2)} 증가=${growth.toFixed(2)}MB (sink=${sink})`);
  // 누수 판정: 워밍업 후 힙이 라운드당 유의미하게 계속 증가하면 FAIL. 임계값 8MB(노이즈 여유).
  const THRESHOLD_MB = 8;
  console.log(
    growth <= THRESHOLD_MB
      ? `[memProbe] PASS: 워밍업 후 힙 증가 ${growth.toFixed(2)}MB <= ${THRESHOLD_MB}MB (sim 누수 신호 없음).`
      : `[memProbe] FAIL: 워밍업 후 힙 증가 ${growth.toFixed(2)}MB > ${THRESHOLD_MB}MB (누수 의심).`,
  );
}

main();
