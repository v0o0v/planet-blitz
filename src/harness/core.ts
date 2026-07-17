/**
 * 하네스 코어 (개발 도구, DEV 전용 — ADR-0008).
 *
 * The harness is the dev-build control + inspection surface for a run: screen
 * jumps, headless fast-forward, realtime speed control, pause/step, a structured
 * state dump, and a notable-event ring buffer. It is exposed as `window.__pb.harness`
 * and is NEVER bundled into production — `main.ts` only imports this module inside
 * an `import.meta.env.DEV` guard (dynamic import, so it is tree-shaken out).
 *
 * Isolation contract (ADR-0008):
 *  - 하네스 프로필: when the harness owns the save, all profile I/O is redirected
 *    to a separate localStorage slot ({@link harnessProfileStore}) so the real
 *    save is never touched.
 *  - 오염 런: any state-mutation cheat during a live run calls `markTainted(world)`
 *    (via {@link HarnessHost.markTaintedIfLive}); a tainted run does not settle and
 *    its replay is not submitted. Autopilot input and fast-forward stepping go
 *    through the normal record path and are NOT tainting.
 *
 * The harness does not step the sim itself — it drives the exact same per-tick
 * advance closure (`stepOnce`) the real ticker uses, so a fast-forwarded or
 * single-stepped run stays bit-identical to a played one (the replay reproduces).
 */

import type { InputFrame, WorldState } from '../sim/world.js';
import { emptyInput } from '../sim/world.js';
import { hashWorld } from '../sim/replay.js';
import { autopilotInput } from '../sim/autopilot.js';
import type { EntityKind } from '../sim/entities.js';
import type { KeyValueStore } from '../save/profile.js';
import { setProfileStoreOverride } from '../save/profile.js';
import type { Profile } from '../save/profile.js';
import { buildPreset } from './presets.js';
import type { PresetKind } from './presets.js';
import { EventRing, diffWorldEvents, emptyWorldEventSummary } from './events.js';
import type { HarnessEvent, WorldEventSummary } from './events.js';

/** The screens the harness can jump to (mirrors main.ts's open* functions). */
export type HarnessScreen =
  | 'title'
  | 'base'
  | 'starMap'
  | 'inventory'
  | 'research'
  | 'refinery'
  | 'defense';

/** Options for {@link Harness.startRun}. */
export interface HarnessRunOpts {
  /** Run seed (defaults to the host's next seed). */
  seed?: number;
  /** Planet index (default 0). */
  planet?: number;
  /** Difficulty tier index (default 0). */
  tier?: number;
  /** Accept the seed-offered anomaly (default false). */
  anomaly?: boolean;
  /** Cap of pre-boss segments (tutorial short run); absent = full run. */
  maxSegments?: number;
}

/** Structured state dump returned by {@link Harness.snapshot}. */
export interface HarnessSnapshot {
  /** Current screen / overlay state (last reported by the host). */
  screen: string;
  tick: number;
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  /** Current wave segment (1-based); 0 when no run is live. */
  segment: number;
  boss: { hp: number; maxHp: number; phase: number } | null;
  kills: number;
  combo: number;
  /** Live entity counts keyed by kind. */
  entityCounts: Record<string, number>;
  /** hashWorld hex (8 chars); empty when no run is live. */
  hash: string;
  seed: number;
  tainted: boolean;
  profileSummary: { credits: number; minerals: number; shipLevel: number };
}

/**
 * The seam between the harness and `main.ts`. `main` implements this with its own
 * loop closures + screen functions, so the harness can drive the real game without
 * the harness importing PixiJS or owning any menu state.
 */
export interface HarnessHost {
  getWorld(): WorldState | null;
  getCurrentSeed(): number;
  /**
   * Advance the live world by exactly one tick with `input`, going through the
   * SAME record + snapshot path the real ticker uses (so the replay stays valid).
   * No-op when no run is live.
   */
  stepOnce(input: InputFrame): void;
  /** Sample the player's live input for one tick (keyboard/mouse — normal path). */
  sampleInput(): InputFrame;
  /** Render exactly one frame from the current snapshots. */
  renderOnce(): void;
  /** Realtime accumulator scale for the main ticker (1 = normal). */
  setSpeedFactor(mult: number): void;
  /** Freeze / unfreeze the ticker-driven sim stepping. */
  setPaused(paused: boolean): void;
  isPaused(): boolean;
  /** Jump to a menu screen (programmatic — reuses main's open* functions). */
  goto(screen: HarnessScreen): void;
  /** Start a run directly from resolved options. */
  startRun(opts: Required<Pick<HarnessRunOpts, 'planet' | 'tier' | 'anomaly'>> & {
    seed: number;
    maxSegments?: number;
  }): void;
  /** A fresh run seed (honours ?seed pinning). */
  nextSeed(): number;
  /** Redirect all default profile I/O to the 하네스 프로필 slot (idempotent). */
  activateHarnessProfile(): void;
  /** Overwrite the live profile in place + persist it (to the active slot). */
  applyProfile(profile: Profile): void;
  /** Re-render the current screen from the (possibly changed) profile. */
  refreshScreen(): void;
  getProfileSummary(): { credits: number; minerals: number; shipLevel: number };
  /** Mark the live run tainted (오염 런) — no-op if no run is in progress. */
  markTaintedIfLive(): void;
  /** Whether the live run is tainted (false when no run/flag unsupported). */
  isTainted(): boolean;
  /** The current screen name for snapshots. */
  currentScreen(): string;
}

/** The public `window.__pb.harness` API surface. */
export interface Harness {
  /** Jump to a menu screen. */
  goto(screen: HarnessScreen): void;
  /** Start a run directly (resolves defaults from opts). */
  startRun(opts?: HarnessRunOpts): void;
  /**
   * Headless fast-forward: synchronously step `ticks` sim ticks with autopilot
   * (default) or neutral input, then render one frame. Inputs go through the
   * normal record path so the replay stays reproducible. NOT tainting.
   */
  ff(ticks: number, opts?: { autopilot?: boolean }): void;
  /** Realtime accelerated playback: scale the main ticker (1 | 4 | 16). */
  setSpeed(mult: 1 | 4 | 16): void;
  /** Freeze the ticker-driven sim. */
  pause(): void;
  /** Resume the ticker-driven sim. */
  resume(): void;
  /** Single-step `n` ticks through the normal (live-input) path. NOT tainting. */
  step(n?: number): void;
  /** Inject a preset into the 하네스 프로필 slot (activates it; taints a live run). */
  preset(kind: PresetKind): void;
  /** Structured state dump. */
  snapshot(): HarnessSnapshot;
  /** The last 200 notable events (oldest first). */
  events(): HarnessEvent[];
  /**
   * Apply a state-mutation cheat to the live world and mark the run tainted
   * (오염 런). The building block worker-3's 치트 패널 uses for HP/spawn edits.
   * No-op when no run is live.
   */
  cheat(mutate: (world: WorldState) => void): void;
  /** Report a screen change (fires a `screenChange` event). Used by main.ts. */
  observeScreen(screen: string): void;
  /** Per-tick observation hook — main.ts calls this from `stepOnce`. */
  observe(world: WorldState): void;
}

/**
 * A localStorage wrapper that appends `:harness` to every key, so profile I/O
 * lands in the isolated 하네스 프로필 slot and never overwrites the real save.
 * Returns null when localStorage is unavailable (sandboxed contexts).
 */
export function harnessProfileStore(): KeyValueStore | null {
  let ls: Storage;
  try {
    if (typeof localStorage === 'undefined') return null;
    ls = localStorage;
  } catch {
    return null;
  }
  const suffix = ':harness';
  return {
    getItem: (key) => ls.getItem(key + suffix),
    setItem: (key, value) => {
      ls.setItem(key + suffix, value);
    },
    removeItem: (key) => {
      ls.removeItem(key + suffix);
    },
  };
}

/** Count live entities by kind (dead entities are compacted out each tick). */
function countEntities(world: WorldState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of world.entities) {
    const k = e.kind as EntityKind;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

/** Find the boss entity's fight state, or null when no boss is present. */
function bossState(world: WorldState): { hp: number; maxHp: number; phase: number } | null {
  for (const e of world.entities) {
    if (e.kind === 'boss') return { hp: e.hp, maxHp: e.maxHp, phase: e.phase };
  }
  return null;
}

/** Extract the flat per-tick summary the event differ compares. */
function summarize(world: WorldState): WorldEventSummary {
  const boss = bossState(world);
  let uniqueLootCount = 0;
  for (const r of world.loot) if (r.rarity === 3) uniqueLootCount++;
  return {
    level: world.level,
    bossPresent: boss !== null,
    bossPhase: boss?.phase ?? -1,
    uniqueLootCount,
    gameOver: world.gameOver,
    victory: world.victory,
  };
}

/**
 * Build the harness. `main.ts` supplies the {@link HarnessHost} (its loop
 * closures + screen functions); this factory returns the object attached to
 * `window.__pb.harness`.
 */
export function createHarness(host: HarnessHost): Harness {
  const events = new EventRing(200);
  let prevSummary = emptyWorldEventSummary();

  return {
    goto(screen) {
      host.goto(screen);
    },

    startRun(opts = {}) {
      const seed = opts.seed ?? host.nextSeed();
      host.startRun({
        seed,
        planet: opts.planet ?? 0,
        tier: opts.tier ?? 0,
        anomaly: opts.anomaly ?? false,
        ...(opts.maxSegments !== undefined ? { maxSegments: opts.maxSegments } : {}),
      });
      // A fresh run resets the event baseline.
      prevSummary = emptyWorldEventSummary();
    },

    ff(ticks, opts = {}) {
      const world = host.getWorld();
      if (world === null) return;
      const useAutopilot = opts.autopilot ?? true;
      for (let i = 0; i < ticks; i++) {
        if (world.gameOver || world.victory) break;
        const input = useAutopilot ? autopilotInput(world) : emptyInput();
        host.stepOnce(input); // records + snapshots + observe (via host)
      }
      host.renderOnce();
    },

    setSpeed(mult) {
      host.setSpeedFactor(mult);
    },

    pause() {
      host.setPaused(true);
    },

    resume() {
      host.setPaused(false);
    },

    step(n = 1) {
      const world = host.getWorld();
      if (world === null) return;
      for (let i = 0; i < n; i++) {
        if (world.gameOver || world.victory) break;
        host.stepOnce(host.sampleInput());
      }
      host.renderOnce();
    },

    preset(kind) {
      // Injecting a preset always uses the isolated 하네스 프로필 slot so the real
      // save is never overwritten (activation is idempotent). If a run is live,
      // mutating the account behind it taints that run.
      host.activateHarnessProfile();
      host.markTaintedIfLive();
      host.applyProfile(buildPreset(kind));
      host.refreshScreen();
    },

    snapshot() {
      const world = host.getWorld();
      const summary = host.getProfileSummary();
      if (world === null) {
        return {
          screen: host.currentScreen(),
          tick: 0,
          hp: 0,
          maxHp: 0,
          level: 1,
          xp: 0,
          segment: 0,
          boss: null,
          kills: 0,
          combo: 0,
          entityCounts: {},
          hash: '',
          seed: host.getCurrentSeed(),
          tainted: false,
          profileSummary: summary,
        };
      }
      const player = world.entities[0];
      return {
        screen: host.currentScreen(),
        tick: world.tick,
        hp: player?.hp ?? 0,
        maxHp: player?.maxHp ?? 0,
        level: world.level,
        xp: world.xp,
        segment: world.wave.segmentIndex + 1,
        boss: bossState(world),
        kills: world.kills,
        combo: world.combo,
        entityCounts: countEntities(world),
        hash: hashWorld(world).toString(16).padStart(8, '0'),
        seed: host.getCurrentSeed(),
        tainted: host.isTainted(),
        profileSummary: summary,
      };
    },

    events() {
      return events.list();
    },

    cheat(mutate) {
      const world = host.getWorld();
      if (world === null) return;
      host.markTaintedIfLive();
      mutate(world);
    },

    observeScreen(screen) {
      events.push({ tick: host.getWorld()?.tick ?? 0, type: 'screenChange', detail: screen });
    },

    observe(world) {
      const curr = summarize(world);
      events.pushAll(diffWorldEvents(prevSummary, curr, world.tick));
      prevSummary = curr;
    },
  };
}

export { setProfileStoreOverride };
