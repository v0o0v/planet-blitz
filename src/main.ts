/**
 * Entry point.
 *
 * Wires the deterministic sim to the PixiJS renderer with a fixed-timestep loop:
 * the sim steps at exactly 60 Hz (accumulator pattern) while rendering happens
 * every animation frame, interpolating between the two most recent sim snapshots
 * so motion is smooth on any refresh rate.
 *
 * `?bench=1` launches the performance bench scene instead (Phase 4 harness).
 */

import { createGameApp } from './render/app.js';
import { createPlaceholderTextures } from './render/textures.js';
import { EntityRenderer } from './render/entityRenderer.js';
import { FpsMeter } from './render/fpsMeter.js';
import { InputController } from './input/controller.js';
import { Hud } from './ui/hud.js';
import { createWorld, stepWorld, DT } from './sim/world.js';
import { snapshotWorld } from './sim/snapshot.js';
import { ReplayRecorder, hashWorld } from './sim/replay.js';
import { runBench } from './bench/bench.js';

async function main(): Promise<void> {
  const mount = document.getElementById('app');
  if (mount === null) throw new Error('#app mount element not found');

  const params = new URLSearchParams(window.location.search);
  if (params.get('bench') === '1') {
    await runBench(mount);
    return;
  }

  const gameApp = await createGameApp(mount);
  const hud = new Hud();
  const textures = createPlaceholderTextures(gameApp.app.renderer);
  const entityRenderer = new EntityRenderer(textures);
  gameApp.stage.addChild(entityRenderer.layer);

  // Seed a run. A live game would derive this from a run/session id; for the
  // prototype we pick a fixed seed so reloads reproduce the same dummy layout.
  const seed = Number(params.get('seed') ?? 0x50c1a1) >>> 0;
  const world = createWorld(seed);
  const recorder = new ReplayRecorder(seed, world.config);
  const controller = new InputController(gameApp);
  const fps = new FpsMeter();

  let prevSnap = snapshotWorld(world);
  let currSnap = prevSnap;
  let accumulator = 0;
  let frameCount = 0;

  gameApp.app.ticker.add((ticker) => {
    let frame = ticker.deltaMS / 1000;
    if (frame > 0.25) frame = 0.25; // clamp to avoid spiral-of-death after stalls
    accumulator += frame;

    while (accumulator >= DT) {
      const player = world.entities[0];
      const input = controller.sample(player?.x ?? 0, player?.y ?? 0);
      recorder.record(input);
      stepWorld(world, input);
      prevSnap = currSnap;
      currSnap = snapshotWorld(world);
      accumulator -= DT;
    }

    const alpha = accumulator / DT;
    entityRenderer.render(prevSnap, currSnap, alpha);

    const f = fps.tick(frame);
    const p = world.entities[0];
    frameCount++;
    let enemyN = 0;
    let bulletN = 0;
    for (const e of world.entities) {
      if (e.kind === 'enemy') enemyN++;
      else if (e.kind === 'enemyBullet' || e.kind === 'bullet') bulletN++;
    }
    const seg = world.wave.segmentIndex + 1;
    const bossTag = world.wave.boss ? '  [BOSS — Phase 3]' : '';
    hud.set(
      `Planet Blitz — M1 combat prototype\n` +
        `WASD/arrows move · mouse aim · Space dash · auto-fire\n` +
        `seed ${seed}  tick ${world.tick}  segment ${seg}/6${bossTag}\n` +
        `HP ${Math.max(0, p?.hp ?? 0).toFixed(0)}/${p?.maxHp ?? 0}  kills ${world.kills}  gems ${world.gems}\n` +
        `enemies ${enemyN}  bullets ${bulletN}/${world.bulletCap}  entities ${world.entities.length}\n` +
        `hash ${hashWorld(world).toString(16).padStart(8, '0')}  FPS ${f.toFixed(1)}`,
    );
  });

  // DEV-only inspection hook: lets tooling drive frames / read sim state when
  // the tab is throttled (background preview) and rAF is paused. Never bundled
  // into production builds (import.meta.env.DEV is statically false there).
  if (import.meta.env.DEV) {
    (window as unknown as { __pb: unknown }).__pb = {
      gameApp,
      controller,
      entityRenderer,
      injectInput(input: Partial<import('./sim/world.js').InputFrame>) {
        const merged = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0, ...input };
        stepWorld(world, merged);
        prevSnap = currSnap;
        currSnap = snapshotWorld(world);
        // Also render so tooling that drives frames sees the same visuals as play.
        entityRenderer.render(prevSnap, currSnap, 1);
        gameApp.app.renderer.render(gameApp.app.stage);
      },
      get state() {
        return { tick: world.tick, frameCount, entities: currSnap.entities, kills: world.kills };
      },
    };
  }
}

main().catch((err: unknown) => {
  console.error(err);
  const hudEl = document.getElementById('hud');
  if (hudEl !== null) hudEl.textContent = `Fatal: ${String(err)}`;
});
