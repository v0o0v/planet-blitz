/**
 * Phase G e2e — 배치전/침공 결과 결정론 탐침(probe).
 *
 * 실제 NPC 방어 layout 과 "코어 근접·무포탑" 승리 layout 에 idle 입력을 넣어
 * 승패·종료 틱을 실측한다. 배치전 5매치를 "결정론적으로 성립하는 결과(gameOver 또는
 * victory)"로 만들기 위해, 어떤 런이 몇 틱에 어떤 결과로 끝나는지 먼저 관측한다.
 *
 * 실행: deno run --allow-read scripts/e2e/probe.ts
 */
import { createWorld, stepWorld, emptyInput } from '../../src/sim/world.ts';
import type { InputFrame, WorldConfig } from '../../src/sim/world.ts';
import { DEFAULT_TIME_LIMIT_TICKS } from '../../src/sim/defense.ts';
import type { DefenseLayout } from '../../src/sim/defense.ts';

function invasionConfig(layout: DefenseLayout, timeLimitTicks = DEFAULT_TIME_LIMIT_TICKS): WorldConfig {
  return {
    arenaWidth: 1920, arenaHeight: 1080, playerSpeed: 720, dashSpeed: 2800,
    dashCooldownTicks: 42, dashIframes: 10, hitIframes: 40, playerHp: 100,
    invasion: { layout, timeLimitTicks, maintenance: 10000 },
  };
}

/** idle 입력으로 종료(victory 또는 gameOver)까지 스텝. 결과 요약 반환. */
function runIdle(seed: number, layout: DefenseLayout, cap = DEFAULT_TIME_LIMIT_TICKS) {
  const idle: InputFrame = emptyInput();
  const state = createWorld(seed, invasionConfig(layout, cap));
  let endTick = -1;
  for (let i = 0; i < cap; i++) {
    stepWorld(state, idle);
    if (state.victory || state.gameOver) { endTick = i + 1; break; }
  }
  return { victory: state.victory, gameOver: state.gameOver, endTick };
}

// NPC #01 (rank20, 최약체): core (0,480), vulcan ×2
const npc01: DefenseLayout = {
  core: { x: 0, y: 480 },
  turrets: [{ x: -256, y: 360, type: 0 }, { x: 256, y: 360, type: 0 }],
  obstacles: [],
};
// NPC #20 (rank1, 최강) 대략 — 조회로 대체 예정. 여기선 #01만.

// 승리 layout: core 근접 + 무포탑 (invasion.test.ts 검증된 패턴)
const winLayout: DefenseLayout = { core: { x: 400, y: 0 }, turrets: [], obstacles: [] };

console.log('=== NPC#01 idle 런(여러 시드) ===');
for (const s of [1, 3, 7, 11, 42]) {
  console.log(`seed=${s}`, JSON.stringify(runIdle(s, npc01)));
}
console.log('=== 승리 layout(core400 무포탑) idle 런 ===');
for (const s of [1, 3, 7]) {
  console.log(`seed=${s}`, JSON.stringify(runIdle(s, winLayout)));
}
