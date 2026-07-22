import { describe, it, expect } from 'vitest';
import { SeededRng } from '../src/sim/rng.js';
import {
  rollAnomaly,
  enemyBulletSpeedMult,
  maxEnemiesMult,
  enemyHpMult,
  dropRateMult,
  uniqueChanceMult,
  ANOMALY_NONE,
  ANOMALY_GRAVITY,
  ANOMALY_SWARM,
  ANOMALY_NEBULA,
} from '../src/sim/anomaly.js';
import { createWorld, stepWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import { hashWorld, idleInputs, runReplay } from '../src/sim/replay.js';

describe('anomaly rolls (AC10)', () => {
  it('offer is seed-only: acceptance does not change the drawn kind', () => {
    for (let s = 1; s <= 50; s++) {
      const accepted = rollAnomaly(new SeededRng(s), true);
      const rejected = rollAnomaly(new SeededRng(s), false);
      expect(accepted.kind).toBe(rejected.kind);
    }
  });

  it('active requires both an offer and acceptance', () => {
    // Find a seed that offers an anomaly.
    let offeredSeed = -1;
    for (let s = 1; s < 500 && offeredSeed < 0; s++) {
      if (rollAnomaly(new SeededRng(s), false).kind !== ANOMALY_NONE) offeredSeed = s;
    }
    expect(offeredSeed).toBeGreaterThan(0);
    expect(rollAnomaly(new SeededRng(offeredSeed), true).active).toBe(true);
    expect(rollAnomaly(new SeededRng(offeredSeed), false).active).toBe(false);
  });

  it('effect getters key off kind + active', () => {
    const gravity = { kind: ANOMALY_GRAVITY, active: true };
    expect(enemyBulletSpeedMult(gravity)).toBeLessThan(1);
    expect(dropRateMult(gravity)).toBeGreaterThan(1);

    const swarm = { kind: ANOMALY_SWARM, active: true };
    expect(maxEnemiesMult(swarm)).toBe(2);
    expect(enemyHpMult(swarm)).toBeLessThan(1);

    const nebula = { kind: ANOMALY_NEBULA, active: true };
    expect(uniqueChanceMult(nebula)).toBeGreaterThan(1);

    // Inactive → identity everywhere.
    const off = { kind: ANOMALY_GRAVITY, active: false };
    expect(enemyBulletSpeedMult(off)).toBe(1);
    expect(dropRateMult(off)).toBe(1);
  });
});

describe('anomaly run reproduction (AC10 — accept vs reject differ)', () => {
  it('an accepted anomaly changes the run hash vs rejecting it', () => {
    // Seed whose anomaly is offered.
    let seed = -1;
    for (let s = 1; s < 2000 && seed < 0; s++) {
      const w = createWorld(s, { ...DEFAULT_CONFIG, anomalyAccepted: false });
      if (w.anomaly.kind !== ANOMALY_NONE) seed = s;
    }
    expect(seed).toBeGreaterThan(0);
    const inputs = idleInputs(600);
    const accepted = runReplay({ seed, config: { ...DEFAULT_CONFIG, anomalyAccepted: true }, inputs });
    const rejected = runReplay({ seed, config: { ...DEFAULT_CONFIG, anomalyAccepted: false }, inputs });
    expect(accepted.finalHash).not.toBe(rejected.finalHash);
  });
});

describe('loadout + tier + anomaly determinism (AC2 extension)', () => {
  it('a fully-configured run replays to identical per-tick hashes', () => {
    const config = {
      ...DEFAULT_CONFIG,
      planet: 1,
      stage: 11,
      anomalyAccepted: true,
      loadout: {
        weaponType: 2,
        subWeaponType: 1,
        damageMult: 1.5,
        fireRateMult: 0.9,
        bulletCountAdd: 1,
        pierceAdd: 2,
        bulletSpeedMult: 1.2,
        spreadAdd: 0.1,
        rangeAdd: 200,
        moveSpeedMult: 1.1,
        maxHpAdd: 40,
        dashCdMult: 0.85,
        magnetMult: 1.3,
        xpMult: 1.25,
        uniqueMask: 0,
        fireDmg: 0,
        coldSlow: 0,
        lightning: 0,
      },
    };
    const inputs = idleInputs(60 * 20);
    const a = runReplay({ seed: 0x5151, config, inputs });
    const b = runReplay({ seed: 0x5151, config, inputs });
    expect(a.hashes).toEqual(b.hashes);

    // Independent manual step matches too.
    const state = createWorld(0x5151, config);
    const manual: number[] = [];
    for (const input of inputs) {
      stepWorld(state, input);
      manual.push(hashWorld(state));
    }
    expect(manual).toEqual(a.hashes);
  });

  it('a loadout run diverges from a no-loadout run on the same seed', () => {
    const inputs = idleInputs(300);
    const base = runReplay({ seed: 9, config: DEFAULT_CONFIG, inputs });
    const withLoadout = runReplay({
      seed: 9,
      config: {
        ...DEFAULT_CONFIG,
        loadout: {
          weaponType: 0,
          subWeaponType: -1,
          damageMult: 2,
          fireRateMult: 1,
          bulletCountAdd: 0,
          pierceAdd: 0,
          bulletSpeedMult: 1,
          spreadAdd: 0,
          rangeAdd: 0,
          moveSpeedMult: 1,
          maxHpAdd: 0,
          dashCdMult: 1,
          magnetMult: 1,
          xpMult: 1,
          uniqueMask: 0,
          fireDmg: 0,
          coldSlow: 0,
          lightning: 0,
        },
      },
      inputs,
    });
    expect(base.finalHash).not.toBe(withLoadout.finalHash);
  });
});
