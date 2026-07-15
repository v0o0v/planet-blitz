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

import { TilingSprite } from 'pixi.js';
import { createGameApp, DESIGN_WIDTH, DESIGN_HEIGHT } from './render/app.js';
import { loadGameTextures } from './render/textures.js';
import { EntityRenderer } from './render/entityRenderer.js';
import { FpsMeter } from './render/fpsMeter.js';
import { InputController } from './input/controller.js';
import { Hud } from './ui/hud.js';
import type { BossHudState } from './ui/hud.js';
import { PowerupOverlay } from './ui/powerupOverlay.js';
import { ResultOverlay } from './ui/resultOverlay.js';
import { createWorld, stepWorld, DT, xpToNext, comboMultiplier } from './sim/world.js';
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
  const powerupOverlay = new PowerupOverlay();
  const resultOverlay = new ResultOverlay();
  const textures = await loadGameTextures(gameApp.app.renderer);
  // Volcanic arena backdrop tiled beneath the entities (Kargon world theme).
  const background = new TilingSprite({
    texture: textures.background,
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
  });
  gameApp.stage.addChild(background);
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

    const runOver = world.gameOver || world.victory;
    if (runOver) {
      accumulator = 0; // sim is inert; stop stepping (settlement is showing)
    }

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

    // Seamless background scroll: the tiling sprite stays fixed over the viewport
    // and only its tile offset moves with the interpolated camera. The camera can
    // grow large, so take the f64 modulo by the tile size BEFORE handing a small
    // value to the renderer — this avoids f32 UV precision "swim" in PIXI. This is
    // a render-only concern; the sim keeps full-precision f64 world coordinates.
    const camX = prevSnap.cameraX + (currSnap.cameraX - prevSnap.cameraX) * alpha;
    const camY = prevSnap.cameraY + (currSnap.cameraY - prevSnap.cameraY) * alpha;
    const tileW = background.texture.width;
    const tileH = background.texture.height;
    background.tilePosition.set((-camX) % tileW, (-camY) % tileH);

    // Level-up: freeze is handled in the sim; show the pick overlay (render is
    // still live underneath). Picking queues a SPECIAL_POWERUP_PICK input.
    if (world.pendingLevelUp && !powerupOverlay.visible && !resultOverlay.visible) {
      powerupOverlay.show([...world.powerupChoices], (offerIndex) => {
        controller.queuePowerupPick(offerIndex);
      });
    }

    // Settlement screen on death or clear.
    if (runOver && !resultOverlay.visible) {
      if (powerupOverlay.visible) powerupOverlay.hide();
      resultOverlay.show(
        {
          victory: world.victory,
          seed,
          xpTotal: world.xpTotal,
          kills: world.kills,
          maxCombo: world.maxCombo,
          resources: world.resources,
          level: world.level,
          timeSec: world.tick / 60,
        },
        () => window.location.reload(),
      );
    }

    // --- HUD ---
    const f = fps.tick(frame);
    const p = world.entities[0];
    frameCount++;
    let enemyN = 0;
    let bulletN = 0;
    let bossEnt: (typeof world.entities)[number] | undefined;
    let supplyActive = false;
    for (const e of world.entities) {
      if (e.kind === 'enemy') enemyN++;
      else if (e.kind === 'enemyBullet' || e.kind === 'bullet') bulletN++;
      else if (e.kind === 'boss') bossEnt = e;
      else if (e.kind === 'supply') supplyActive = true;
    }
    const boss: BossHudState | undefined =
      bossEnt !== undefined
        ? {
            hp: bossEnt.hp,
            maxHp: bossEnt.maxHp,
            phase: bossEnt.phase,
            overheat: bossEnt.iframes > 0,
            transitioning: bossEnt.timer > 0,
          }
        : undefined;
    hud.update({
      hp: p?.hp ?? 0,
      maxHp: p?.maxHp ?? 0,
      xp: world.xp,
      xpNeed: xpToNext(world.level),
      level: world.level,
      timeSec: world.tick / 60,
      combo: world.combo,
      multiplier: comboMultiplier(world.combo),
      boss,
      supplyActive,
    });

    const seg = world.wave.segmentIndex + 1;
    const bossTag = world.wave.boss ? '  [BOSS]' : '';
    hud.set(
      `Planet Blitz — M1  ·  seed ${seed}  tick ${world.tick}  seg ${seg}/6${bossTag}\n` +
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
      world,
      hud,
      powerupOverlay,
      resultOverlay,
      injectInput(input: Partial<import('./sim/world.js').InputFrame>) {
        // NOTE: this DEV-only hook deliberately bypasses `recorder` — frames it
        // injects are NOT written to the replay log, so a replay captured while
        // tooling drove frames this way would not reproduce them. It exists only
        // to step the sim for inspection when rAF is throttled; real play goes
        // through the ticker loop above, which does record every frame.
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
