import { describe, it, expect } from 'vitest';
import {
  createWorld,
  stepWorld,
  emptyInput,
  DEFAULT_CONFIG,
  type WorldConfig,
  type WorldState,
} from '../src/sim/world.js';
import { runReplay, idleInputs } from '../src/sim/replay.js';
import { neutralLoadout, computeLoadoutStats } from '../src/items/loadout.js';
import { blankEntity, type Entity } from '../src/sim/entities.js';
import { length } from '../src/sim/math.js';
import { POWERUPS, drawPowerupChoices } from '../src/sim/powerups.js';
import { zeroSkillInvest } from '../src/save/profile.js';
import { treeRange } from '../data/skills.js';

const WEAPON_MISSILE = 3;
const WEAPON_BEAM = 4;

function weaponConfig(weaponType: number, skillInvest?: number[]): WorldConfig {
  const cfg: WorldConfig = {
    ...DEFAULT_CONFIG,
    planet: 0,
    tier: 0,
    loadout: { ...neutralLoadout(), weaponType },
  };
  if (skillInvest !== undefined) cfg.skillInvest = skillInvest;
  return cfg;
}

/** Inject a static enemy (no def → no behaviour) at an absolute position. */
function addEnemy(state: WorldState, x: number, y: number): Entity {
  const e = blankEntity('enemy');
  e.id = state.nextEntityId++;
  e.x = x;
  e.y = y;
  e.radius = 40;
  e.hp = 100000; // survive so we can observe the projectiles homing/hitting
  e.maxHp = 100000;
  e.enemyType = -1; // enemyDefFor → undefined → the enemy stays put
  state.entities.push(e);
  return e;
}

/** Only keep the player + the given entities alive (freeze the environment). */
function isolate(state: WorldState, keep: Entity[]): void {
  const keepIds = new Set(keep.map((e) => e.id));
  const player = state.entities[0]!;
  state.entities = state.entities.filter((e) => e === player || keepIds.has(e.id));
}

describe('missile weapon (type 3) — homing, limited turn (C1, OQ-M3-4)', () => {
  it('fires homing missiles that curve toward the target, preserving speed', () => {
    const state = createWorld(1, weaponConfig(WEAPON_MISSILE));
    const player = state.entities[0]!;
    addEnemy(state, player.x + 400, player.y); // seed a target so a volley launches
    stepWorld(state, emptyInput());
    const missile = state.entities.find((e) => e.kind === 'bullet');
    expect(missile).toBeDefined();

    // Place a far target well below; isolate the environment so the missile has a
    // single, fixed thing to home on (waves cannot introduce a nearer target).
    const below = addEnemy(state, missile!.x, missile!.y + 2000);
    const speed0 = length(missile!.vx, missile!.vy);
    const d0 = length(below.x - missile!.x, below.y - missile!.y);
    for (let t = 0; t < 40; t++) {
      isolate(state, [missile!, below]);
      stepWorld(state, emptyInput());
      if (missile!.dead) break;
    }
    const d1 = length(below.x - missile!.x, below.y - missile!.y);
    expect(d1).toBeLessThan(d0); // homed closer
    expect(missile!.vy).toBeGreaterThan(0); // curved toward the lower target
    // Homing re-aims the velocity, never scales it — speed is invariant (within
    // the deterministic-trig approximation's tiny per-tick drift).
    expect(Math.abs(length(missile!.vx, missile!.vy) - speed0) / speed0).toBeLessThan(0.01);
  });

  it('replays deterministically', () => {
    const replay = { seed: 7, config: weaponConfig(WEAPON_MISSILE), inputs: idleInputs(500) };
    expect(runReplay(replay).hashes).toEqual(runReplay(replay).hashes);
  });
});

describe('beam weapon (type 4) — matic short-life segments (C1, OQ-M3-3)', () => {
  it('lays a line of short-life static segments toward the target', () => {
    const state = createWorld(2, weaponConfig(WEAPON_BEAM));
    const player = state.entities[0]!;
    addEnemy(state, player.x + 220, player.y); // within the beam range
    stepWorld(state, emptyInput());
    const segs = state.entities.filter((e) => e.kind === 'bullet');
    expect(segs.length).toBeGreaterThanOrEqual(3); // a line, not one bolt
    expect(segs.length).toBeLessThanOrEqual(16); // capped
    for (const s of segs) {
      expect(s.vx).toBe(0); // static segment
      expect(s.vy).toBe(0);
      expect(s.life).toBeLessThanOrEqual(2); // short-lived, re-laid each fire
    }
  });

  it('replays deterministically', () => {
    const replay = { seed: 9, config: weaponConfig(WEAPON_BEAM), inputs: idleInputs(500) };
    expect(runReplay(replay).hashes).toEqual(runReplay(replay).hashes);
  });
});

describe('skill investment — determinism + hash inclusion (AC2, plan A2)', () => {
  function investedConfig(): WorldConfig {
    const invest = zeroSkillInvest();
    invest[0] = 4; // firepower damagePct
    invest[41] = 4; // mobility moveSpeedPct
    const cfg = weaponConfig(0, invest);
    // Fold the same investment into the loadout block (mirrors main.ts).
    const { loadout } = computeLoadoutStats([], invest);
    cfg.loadout = loadout;
    return cfg;
  }

  it('a run with skill investment replays to identical hashes', () => {
    const replay = { seed: 3, config: investedConfig(), inputs: idleInputs(400) };
    expect(runReplay(replay).hashes).toEqual(runReplay(replay).hashes);
  });

  it('skill investment changes the run (hashes diverge from a no-skill run)', () => {
    const withSkills = runReplay({ seed: 3, config: investedConfig(), inputs: idleInputs(400) });
    const without = runReplay({ seed: 3, config: weaponConfig(0), inputs: idleInputs(400) });
    expect(withSkills.finalHash).not.toBe(without.finalHash);
  });
});

describe('powerup pool — 24 tagged + build-weighted draw (C2, AC9, OQ-M3-1)', () => {
  it('has 24 entries, indices 0..7 unchanged (replay wire stability)', () => {
    expect(POWERUPS).toHaveLength(24);
    expect(POWERUPS[0]?.id).toBe('rapid-fire');
    expect(POWERUPS[7]?.id).toBe('gem-magnet');
    // Every entry carries exactly one build tag.
    for (const p of POWERUPS) {
      const tags = [p.universal === true, p.weaponType !== undefined, p.tree !== undefined];
      expect(tags.filter(Boolean)).toHaveLength(1);
    }
  });

  it('draws `count` distinct valid indices, deterministically', () => {
    const cfg = weaponConfig(WEAPON_BEAM);
    const a = createWorld(5, cfg);
    const b = createWorld(5, cfg);
    for (let i = 0; i < 20; i++) {
      const da = drawPowerupChoices(a, 3);
      const db = drawPowerupChoices(b, 3);
      expect(da).toEqual(db); // deterministic across identical worlds
      expect(new Set(da).size).toBe(3); // distinct
      for (const idx of da) {
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(24);
      }
    }
  });

  it('soft-weights toward the equipped weapon (beam offered more under a beam build)', () => {
    const beamIdx = POWERUPS.map((p, i) => (p.weaponType === WEAPON_BEAM ? i : -1)).filter((i) => i >= 0);
    expect(beamIdx.length).toBeGreaterThan(0);
    const count = (weaponType: number): number => {
      const state = createWorld(11, weaponConfig(weaponType));
      let hits = 0;
      for (let i = 0; i < 3000; i++) {
        const [idx] = drawPowerupChoices(state, 1);
        if (idx !== undefined && beamIdx.includes(idx)) hits++;
      }
      return hits;
    };
    // Beam powerups appear far more often when a beam is equipped, yet a mismatched
    // build still sees them occasionally (soft weighting, never hard-excluded).
    const beamBuild = count(WEAPON_BEAM);
    const vulcanBuild = count(0);
    expect(beamBuild).toBeGreaterThan(vulcanBuild * 3);
    expect(vulcanBuild).toBeGreaterThan(0);
  });

  it('soft-weights toward an invested skill tree', () => {
    // Fully invest the mobility tree; its tagged powerups should be offered more.
    const invest = zeroSkillInvest();
    const { start, end } = treeRange('mobility');
    for (let i = start; i < end; i++) invest[i] = 5;
    const mobilityIdx = POWERUPS.map((p, i) => (p.tree === 'mobility' ? i : -1)).filter((i) => i >= 0);

    const countMobility = (skillInvest?: number[]): number => {
      const state = createWorld(21, weaponConfig(0, skillInvest));
      let hits = 0;
      for (let i = 0; i < 3000; i++) {
        const [idx] = drawPowerupChoices(state, 1);
        if (idx !== undefined && mobilityIdx.includes(idx)) hits++;
      }
      return hits;
    };
    expect(countMobility(invest)).toBeGreaterThan(countMobility(zeroSkillInvest()));
  });
});
