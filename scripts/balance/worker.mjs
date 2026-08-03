/**
 * 밸런스 스윕 워커 — job 하나(= 셀 1칸 × 시드 1개)를 받아 런을 돌리고 결과를 돌려준다.
 *
 * 번들 경로는 `workerData.bundle`(file URL)로 받는다. 워커는 리포 구조를 전혀 모르고
 * `runCellSeed` 하나만 안다.
 *
 * 프로토콜(메인 → 워커):
 *   { type: 'job', id, cell, seed }
 *   { type: 'stop' }
 * (워커 → 메인):
 *   { type: 'ready' }
 *   { type: 'result', id, rec, ms }
 *   { type: 'error', id, message }
 */

import { parentPort, workerData } from 'node:worker_threads';

const port = parentPort;
if (port === null) throw new Error('worker.mjs must run as a worker thread');

const { runCellSeed } = await import(workerData.bundle);

port.on('message', (msg) => {
  if (msg.type === 'stop') {
    port.close();
    return;
  }
  if (msg.type !== 'job') return;
  const t0 = performance.now();
  try {
    const r = runCellSeed(msg.cell, msg.seed);
    port.postMessage({
      type: 'result',
      id: msg.id,
      ms: performance.now() - t0,
      rec: {
        planet: msg.cell.planet,
        ship: msg.cell.ship,
        level: msg.cell.level,
        // 선택 축은 **값이 있을 때만** 실린다 — 표준 격자의 `runs.json` 이 축 신설 전과
        // 바이트 동일하게 유지된다(집계·재해석이 옛 산출물과 그대로 짝지어진다).
        ...(msg.cell.stage === undefined ? {} : { stage: msg.cell.stage }),
        ...(msg.cell.powerup === undefined ? {} : { powerup: msg.cell.powerup }),
        seed: r.seed,
        won: r.won,
        ticks: r.ticks,
        values: r.values,
      },
    });
  } catch (err) {
    port.postMessage({
      type: 'error',
      id: msg.id,
      message: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err),
    });
  }
});

port.postMessage({ type: 'ready' });
