/**
 * Base-map unlocks + planet-clear progress + v3 (FTUE) migration (M3 Phase E2).
 *
 * Covers the pure save-layer logic behind the base map's building gates (plan D1/
 * E2, GDD §7): `computeUnlocks` gating, `recordPlanetClear` best-tier keeping,
 * `settleRun` recording a clear on victory (not defeat), and the tutorialDone
 * migration (existing saves skip the tutorial; fresh profiles do not).
 */

import { describe, it, expect } from 'vitest';
import {
  defaultProfile,
  migrate,
  computeUnlocks,
  recordPlanetClear,
  activeShip,
  RESEARCH_UNLOCK_LEVEL,
} from '../src/save/profile.js';
import { settleRun } from '../src/save/settlement.js';

describe('base unlocks — computeUnlocks (plan E2, GDD §7)', () => {
  it('a fresh pilot has only the hangar; M4 buildings stay locked', () => {
    const p = defaultProfile();
    const u = computeUnlocks(p);
    expect(u.hangar).toBe(true);
    expect(u.research).toBe(false); // Lv1 < 3
    expect(u.refinery).toBe(false); // no clears yet
    expect(u.defenseCommand).toBe(false);
    expect(u.controlTower).toBe(false);
  });

  it('연구소 unlocks at the research level, 정제소 after any planet clear', () => {
    const p = defaultProfile();
    activeShip(p).level = RESEARCH_UNLOCK_LEVEL;
    expect(computeUnlocks(p).research).toBe(true);
    expect(computeUnlocks(p).refinery).toBe(false);
    recordPlanetClear(p, 0, 0);
    expect(computeUnlocks(p).refinery).toBe(true);
  });
});

describe('recordPlanetClear — keeps the highest tier (plan E2)', () => {
  it('records a clear and never lowers the best tier', () => {
    const p = defaultProfile();
    recordPlanetClear(p, 2, 1);
    expect(p.planetProgress[2]?.bestTierCleared).toBe(1);
    recordPlanetClear(p, 2, 0); // lower tier — no downgrade
    expect(p.planetProgress[2]?.bestTierCleared).toBe(1);
    recordPlanetClear(p, 2, 2); // higher tier — upgrades
    expect(p.planetProgress[2]?.bestTierCleared).toBe(2);
  });
});

describe('settleRun — records a planet clear on victory only', () => {
  it('victory records the clear; defeat does not', () => {
    const win = defaultProfile();
    settleRun(win, { victory: true, loot: [], xpTotal: 0, resources: 0, planet: 1, tier: 1 });
    expect(win.planetProgress[1]?.bestTierCleared).toBe(1);

    const loss = defaultProfile();
    settleRun(loss, { victory: false, loot: [], xpTotal: 0, resources: 0, planet: 1, tier: 1 });
    expect(loss.planetProgress[1]).toBeUndefined();
  });
});

describe('migration — tutorialDone (v3 / FTUE, plan E2)', () => {
  it('a fresh profile starts with the tutorial pending', () => {
    expect(defaultProfile().tutorialDone).toBe(false);
  });

  it('a pre-v3 save is stamped as tutorial-complete (already playing)', () => {
    const v2 = { saveVersion: 2, ships: [], inventory: [], skillPoints: 5 };
    expect(migrate(v2).tutorialDone).toBe(true);
  });

  it('a v3 blob preserves an explicit tutorialDone flag', () => {
    const v3 = { saveVersion: 3, ships: [], inventory: [], tutorialDone: false };
    expect(migrate(v3).tutorialDone).toBe(false);
  });
});
