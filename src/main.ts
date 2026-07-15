/**
 * Entry point.
 *
 * Wires the deterministic sim to the PixiJS renderer with a fixed-timestep loop:
 * the sim steps at exactly 60 Hz (accumulator pattern) while rendering happens
 * every animation frame, interpolating between the two most recent sim snapshots
 * so motion is smooth on any refresh rate.
 *
 * M2 wraps the run in a meta loop (plan Phase C/D): a persistent `Profile`
 * (localStorage) feeds the star-map screen (planet/tier/anomaly) and the
 * inventory/equip screen. The active ship's equipped gear becomes a `LoadoutConfig`
 * (computeLoadoutStats) injected into the run's WorldConfig; when the run ends the
 * collected loot + XP are settled back into the profile and saved, then the
 * player returns to the star map.
 *
 * `?bench=1` launches the performance bench scene instead (Phase 4 harness).
 * `?seed=<n>` pins the run seed (else a fresh random seed per launch).
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
import { PlanetSelect } from './ui/planetSelect.js';
import type { LaunchSelection } from './ui/planetSelect.js';
import { InventoryOverlay } from './ui/inventory.js';
import { createWorld, stepWorld, DT, xpToNext, comboMultiplier, DEFAULT_CONFIG } from './sim/world.js';
import type { WorldState, WorldConfig } from './sim/world.js';
import { snapshotWorld } from './sim/snapshot.js';
import type { WorldSnapshot } from './sim/snapshot.js';
import { ReplayRecorder, hashWorld } from './sim/replay.js';
import { SeededRng } from './sim/rng.js';
import { rollAnomaly } from './sim/anomaly.js';
import { runBench } from './bench/bench.js';
import { EQUIP_SLOTS } from './items/types.js';
import type { Item } from './items/types.js';
import { computeLoadoutStats } from './items/loadout.js';
import { loadProfile, saveProfile, activeShip } from './save/profile.js';
import { settleRun } from './save/settlement.js';
import type { SettlementOutcome } from './save/settlement.js';

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
  const planetSelect = new PlanetSelect();
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

  const controller = new InputController(gameApp);
  const fps = new FpsMeter();

  // --- Persistent meta state (M2) ---
  const profile = loadProfile();
  const inventory = new InventoryOverlay(profile);

  // An empty snapshot rendered on menu frames clears the arena behind overlays.
  const emptySnap: WorldSnapshot = {
    tick: 0,
    arenaWidth: DEFAULT_CONFIG.arenaWidth,
    arenaHeight: DEFAULT_CONFIG.arenaHeight,
    cameraX: 0,
    cameraY: 0,
    entities: [],
    beams: [],
  };

  // --- Live run state (null while in menus) ---
  let world: WorldState | null = null;
  let recorder: ReplayRecorder | null = null;
  let currentSeed = 0;
  let settled = false;
  let lastOutcome: SettlementOutcome | null = null;
  let prevSnap: WorldSnapshot = emptySnap;
  let currSnap: WorldSnapshot = emptySnap;
  let accumulator = 0;
  let frameCount = 0;

  /** Seed for the next run: pinned by ?seed, else fresh random (UI layer). */
  function nextSeed(): number {
    const p = params.get('seed');
    if (p !== null) return Number(p) >>> 0;
    return (Math.random() * 0xffffffff) >>> 0;
  }

  /** Meta status line for the star map / no gameplay numbers. */
  function metaLine(): string {
    const ship = activeShip(profile);
    return `크레딧 ${profile.credits} · 광물 ${profile.minerals} · 기체 Lv ${ship.level} · 스킬 ${profile.skillPoints}`;
  }

  /** Show the star map for the next run (world cleared while it is up). */
  function openStarMap(): void {
    world = null;
    recorder = null;
    prevSnap = emptySnap;
    currSnap = emptySnap;
    accumulator = 0;
    const seed = nextSeed();
    // Pre-compute the anomaly the seed offers (same fork the sim uses) so the
    // player can accept/reject it before the run (OQ-M2-3).
    const offer = rollAnomaly(new SeededRng(seed).fork('anomaly'), false);
    planetSelect.show({
      anomalyOffered: offer.kind,
      meta: metaLine(),
      onLaunch: (sel) => startRun(seed, sel),
      onInventory: () => {
        planetSelect.hide();
        inventory.show(profile, () => openStarMap());
      },
    });
  }

  /** Assemble the run config from the selection + active loadout, then start. */
  function startRun(seed: number, sel: LaunchSelection): void {
    const ship = activeShip(profile);
    const equipped: Item[] = [];
    for (const id of EQUIP_SLOTS) {
      const it = ship.equipped[id];
      if (it !== undefined) equipped.push(it);
    }
    const { loadout } = computeLoadoutStats(equipped);
    const config: WorldConfig = {
      ...DEFAULT_CONFIG,
      planet: sel.planet,
      tier: sel.tier,
      anomalyAccepted: sel.anomalyAccepted,
      loadout,
    };
    currentSeed = seed;
    world = createWorld(seed, config);
    recorder = new ReplayRecorder(seed, world.config);
    prevSnap = snapshotWorld(world);
    currSnap = prevSnap;
    accumulator = 0;
    settled = false;
    lastOutcome = null;
    resultOverlay.hide();
  }

  /** Settle a finished run into the profile once, then show the result screen. */
  function endRun(w: WorldState): void {
    if (!settled) {
      settled = true;
      lastOutcome = settleRun(profile, {
        victory: w.victory,
        loot: w.loot,
        xpTotal: w.xpTotal,
        resources: w.resources,
      });
      saveProfile(profile);
    }
    if (powerupOverlay.visible) powerupOverlay.hide();
    const o = lastOutcome;
    resultOverlay.show(
      {
        victory: w.victory,
        seed: currentSeed,
        xpTotal: w.xpTotal,
        kills: w.kills,
        maxCombo: w.maxCombo,
        resources: w.resources,
        level: activeShip(profile).level,
        timeSec: w.tick / 60,
        ...(o !== null
          ? {
              settlement: {
                itemsGained: o.itemsGained.length,
                levelsGained: o.levelsGained,
                skillPointsGained: o.skillPointsGained,
                creditsGained: o.creditsGained,
                overflow: o.overflow,
              },
            }
          : {}),
      },
      () => openStarMap(),
      () => {
        resultOverlay.hide();
        inventory.show(profile, () => openStarMap());
      },
    );
  }

  // Kick off at the star map.
  openStarMap();

  gameApp.app.ticker.add((ticker) => {
    let frame = ticker.deltaMS / 1000;
    if (frame > 0.25) frame = 0.25; // clamp to avoid spiral-of-death after stalls

    const w = world;
    const runOver = w !== null && (w.gameOver || w.victory);

    // Step the sim only while a live run is in progress and not yet over.
    if (w !== null && !runOver) {
      accumulator += frame;
      while (accumulator >= DT) {
        const player = w.entities[0];
        const input = controller.sample(player?.x ?? 0, player?.y ?? 0);
        recorder?.record(input);
        stepWorld(w, input);
        prevSnap = currSnap;
        currSnap = snapshotWorld(w);
        accumulator -= DT;
      }
    } else {
      accumulator = 0; // menus / settled run: sim is inert
    }

    // --- Render ---
    const alpha = accumulator / DT;
    entityRenderer.render(prevSnap, currSnap, alpha);

    // Seamless background scroll: the tiling sprite stays fixed over the viewport
    // and only its tile offset moves with the interpolated camera. Take the f64
    // modulo by the tile size BEFORE handing a small value to the renderer to
    // avoid f32 UV precision "swim" in PIXI. Render-only; the sim keeps full f64.
    const camX = prevSnap.cameraX + (currSnap.cameraX - prevSnap.cameraX) * alpha;
    const camY = prevSnap.cameraY + (currSnap.cameraY - prevSnap.cameraY) * alpha;
    const tileW = background.texture.width;
    const tileH = background.texture.height;
    background.tilePosition.set(-camX % tileW, -camY % tileH);

    // Level-up: freeze is handled in the sim; show the pick overlay (render is
    // still live underneath). Picking queues a SPECIAL_POWERUP_PICK input.
    if (
      w !== null &&
      w.pendingLevelUp &&
      !powerupOverlay.visible &&
      !resultOverlay.visible
    ) {
      powerupOverlay.show([...w.powerupChoices], (offerIndex) => {
        controller.queuePowerupPick(offerIndex);
      });
    }

    // Settlement screen on death or clear.
    if (runOver && w !== null && !resultOverlay.visible) {
      endRun(w);
    }

    // --- HUD (only during a live run) ---
    const f = fps.tick(frame);
    frameCount++;
    if (w !== null) {
      const p = w.entities[0];
      let enemyN = 0;
      let bulletN = 0;
      let bossEnt: (typeof w.entities)[number] | undefined;
      let supplyActive = false;
      for (const e of w.entities) {
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
        xp: w.xp,
        xpNeed: xpToNext(w.level),
        level: w.level,
        timeSec: w.tick / 60,
        combo: w.combo,
        multiplier: comboMultiplier(w.combo),
        boss,
        supplyActive,
      });

      const seg = w.wave.segmentIndex + 1;
      const bossTag = w.wave.boss ? '  [BOSS]' : '';
      hud.set(
        `Planet Blitz — M2  ·  seed ${currentSeed}  tick ${w.tick}  seg ${seg}/6${bossTag}\n` +
          `enemies ${enemyN}  bullets ${bulletN}/${w.bulletCap}  entities ${w.entities.length}\n` +
          `hash ${hashWorld(w).toString(16).padStart(8, '0')}  FPS ${f.toFixed(1)}`,
      );
    } else {
      hud.set('');
    }
  });

  // DEV-only inspection hook: lets tooling drive frames / read sim state when
  // the tab is throttled (background preview) and rAF is paused. Never bundled
  // into production builds (import.meta.env.DEV is statically false there).
  if (import.meta.env.DEV) {
    (window as unknown as { __pb: unknown }).__pb = {
      gameApp,
      controller,
      entityRenderer,
      hud,
      powerupOverlay,
      resultOverlay,
      planetSelect,
      inventory,
      get world() {
        return world;
      },
      startRun,
      openStarMap,
      injectInput(input: Partial<import('./sim/world.js').InputFrame>) {
        // NOTE: DEV-only; injected frames are NOT written to the replay log, so a
        // replay captured while tooling drove frames would not reproduce them. It
        // exists only to step the sim for inspection when rAF is throttled.
        const w = world;
        if (w === null) return;
        const merged = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0, ...input };
        stepWorld(w, merged);
        prevSnap = currSnap;
        currSnap = snapshotWorld(w);
        entityRenderer.render(prevSnap, currSnap, 1);
        gameApp.app.renderer.render(gameApp.app.stage);
      },
      get state() {
        return {
          tick: world?.tick ?? 0,
          frameCount,
          entities: currSnap.entities,
          kills: world?.kills ?? 0,
        };
      },
    };
  }
}

main().catch((err: unknown) => {
  console.error(err);
  const hudEl = document.getElementById('hud');
  if (hudEl !== null) hudEl.textContent = `Fatal: ${String(err)}`;
});
