/**
 * 하네스 이벤트 링 버퍼 + 상태 diffing (개발 도구, DEV 전용).
 *
 * The harness watches the live simulation and records "notable" transitions
 * (levelup / uniqueDrop / bossSpawn / bossPhase / playerDeath / victory /
 * screenChange) into a bounded ring buffer so tooling can assert on what a run
 * did without polling every frame. Detection is pure state-diffing: each tick the
 * host hands the current {@link WorldEventSummary} and the previous one, and
 * {@link diffWorldEvents} emits the transitions between them.
 *
 * This module never imports the sim runtime — it consumes a flat summary (plain
 * numbers/booleans) the harness extracts from the world, so it is trivially unit
 * testable under the `node` vitest environment (no DOM, no PixiJS).
 */

/** The notable transition kinds the harness records. */
export type HarnessEventType =
  | 'levelup'
  | 'uniqueDrop'
  | 'bossSpawn'
  | 'bossPhase'
  | 'playerDeath'
  | 'victory'
  | 'screenChange';

/** One recorded event: when (sim tick), what kind, and an optional detail blurb. */
export interface HarnessEvent {
  /** Sim tick the event was observed on (0 for pre-run screen changes). */
  tick: number;
  type: HarnessEventType;
  /** Free-form context (e.g. new level, boss phase index, screen name). */
  detail?: string;
}

/**
 * Flat per-tick world summary the event differ compares. Extracted from a live
 * {@link import('../sim/world.js').WorldState} by the harness (see core.ts). All
 * fields are plain values so this file stays sim-runtime-free and testable.
 */
export interface WorldEventSummary {
  level: number;
  /** A boss entity is present in the world this tick. */
  bossPresent: boolean;
  /** Current boss phase (0/1/2); -1 when no boss present. */
  bossPhase: number;
  /** Count of collected loot records that are unique (rarity code 3). */
  uniqueLootCount: number;
  gameOver: boolean;
  victory: boolean;
}

/** A zeroed summary — the baseline before the first observed tick. */
export function emptyWorldEventSummary(): WorldEventSummary {
  return {
    level: 1,
    bossPresent: false,
    bossPhase: -1,
    uniqueLootCount: 0,
    gameOver: false,
    victory: false,
  };
}

/**
 * Emit the notable transitions between two consecutive world summaries. Pure: the
 * same (prev, curr, tick) always yields the same event list. `screenChange` is
 * NOT derived here (it has no world signal) — the host pushes it directly.
 */
export function diffWorldEvents(
  prev: WorldEventSummary,
  curr: WorldEventSummary,
  tick: number,
): HarnessEvent[] {
  const out: HarnessEvent[] = [];
  // Level-up: the run-level counter climbed (possibly by more than one on a
  // multi-level tick — record the destination level).
  if (curr.level > prev.level) {
    out.push({ tick, type: 'levelup', detail: String(curr.level) });
  }
  // Unique drop: at least one more unique loot record than last tick.
  if (curr.uniqueLootCount > prev.uniqueLootCount) {
    out.push({ tick, type: 'uniqueDrop', detail: String(curr.uniqueLootCount) });
  }
  // Boss spawn: a boss appeared where there was none.
  if (curr.bossPresent && !prev.bossPresent) {
    out.push({ tick, type: 'bossSpawn' });
  }
  // Boss phase: the phase index changed while the boss is present (skip the
  // spawn tick's -1 → 0, which reads as the spawn event above).
  if (curr.bossPresent && prev.bossPresent && curr.bossPhase !== prev.bossPhase) {
    out.push({ tick, type: 'bossPhase', detail: String(curr.bossPhase) });
  }
  // Player death: the run flipped to game-over.
  if (curr.gameOver && !prev.gameOver) {
    out.push({ tick, type: 'playerDeath' });
  }
  // Victory: the run flipped to cleared.
  if (curr.victory && !prev.victory) {
    out.push({ tick, type: 'victory' });
  }
  return out;
}

/**
 * Fixed-capacity ring buffer of the most recent harness events. Oldest entries
 * are dropped once `capacity` is exceeded; {@link list} returns them in
 * chronological (oldest-first) order.
 */
export class EventRing {
  private readonly buf: HarnessEvent[] = [];

  constructor(private readonly capacity = 200) {}

  push(event: HarnessEvent): void {
    this.buf.push(event);
    if (this.buf.length > this.capacity) this.buf.shift();
  }

  pushAll(events: readonly HarnessEvent[]): void {
    for (const e of events) this.push(e);
  }

  /** The buffered events, oldest first (a copy — safe to hand to callers). */
  list(): HarnessEvent[] {
    return this.buf.slice();
  }

  clear(): void {
    this.buf.length = 0;
  }
}
