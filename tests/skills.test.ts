import { describe, it, expect } from 'vitest';
import {
  SKILLS,
  SKILL_NODE_COUNT,
  SKILL_TOTAL_CAPACITY,
  SKILL_TREES,
  NODES_PER_TREE,
  treeRange,
} from '../data/skills.js';
import { computeSkillStats, zeroStatSums } from '../src/items/skills.js';
import { computeLoadoutStats, neutralLoadout } from '../src/items/loadout.js';
import {
  defaultProfile,
  investSkill,
  respecSkills,
  respecCost,
  totalInvested,
  activeShip,
  zeroSkillInvest,
} from '../src/save/profile.js';

/** Points a level-100 pilot banks (settlement grants 1/level, GDD §4). */
const BANKED_AT_CAP = 99;

describe('skill data — shape + capacity gate (AC1, master §3 gate ②)', () => {
  it('has 60 nodes, 3 trees × 20', () => {
    expect(SKILL_NODE_COUNT).toBe(60);
    expect(SKILL_TREES).toHaveLength(3);
    for (const tree of SKILL_TREES) {
      const { start, end } = treeRange(tree);
      expect(end - start).toBe(NODES_PER_TREE);
      for (let i = start; i < end; i++) expect(SKILLS[i]?.tree).toBe(tree);
    }
  });

  it('every node costs 1..5 points; per tree ~85, total ~250', () => {
    for (const n of SKILLS) {
      expect(n.maxPoints).toBeGreaterThanOrEqual(1);
      expect(n.maxPoints).toBeLessThanOrEqual(5);
    }
    expect(SKILL_TOTAL_CAPACITY).toBe(250);
    for (const tree of SKILL_TREES) {
      const { start, end } = treeRange(tree);
      let cap = 0;
      for (let i = start; i < end; i++) cap += SKILLS[i]?.maxPoints ?? 0;
      expect(cap).toBeGreaterThanOrEqual(80);
      expect(cap).toBeLessThanOrEqual(90);
    }
  });

  it('99 banked points cover ≤40% of the tree (capacity + node count)', () => {
    // Capacity reading: 99 points is ≤40% of the 250-point capacity.
    expect(BANKED_AT_CAP / SKILL_TOTAL_CAPACITY).toBeLessThanOrEqual(0.4);
    // Node-count reading: spending greedily on the cheapest nodes first, 99
    // points fully funds at most 24 nodes = 40% of 60.
    const costs = SKILLS.map((n) => n.maxPoints).sort((a, b) => a - b);
    let pts = BANKED_AT_CAP;
    let count = 0;
    for (const c of costs) {
      if (pts >= c) {
        pts -= c;
        count++;
      } else break;
    }
    expect(count).toBeLessThanOrEqual(Math.floor(SKILL_NODE_COUNT * 0.4));
  });
});

describe('computeSkillStats — derivation + synergy (AC1)', () => {
  it('no investment → all-zero stat sums', () => {
    expect(computeSkillStats(zeroSkillInvest())).toEqual(zeroStatSums());
  });

  it('investing a damage node yields damagePct, and is deterministic', () => {
    const invest = zeroSkillInvest();
    invest[0] = 4; // firepower tier0 node0 (damagePct, perPoint 3)
    const a = computeSkillStats(invest);
    const b = computeSkillStats(invest.slice());
    expect(a).toEqual(b);
    expect(a.damagePct).toBeGreaterThan(0);
  });

  it('lower-tier investment amplifies a higher-tier node (synergy, OQ-M3-2)', () => {
    const capstoneIdx = 16; // firepower tier4 node0 — damagePct capstone
    expect(SKILLS[capstoneIdx]?.tier).toBe(4);
    expect(SKILLS[capstoneIdx]?.stat).toBe('damagePct');

    const soloInvest = zeroSkillInvest();
    soloInvest[capstoneIdx] = 5;
    const solo = computeSkillStats(soloInvest);

    // Add a NON-damage lower-tier node (bulletSpeed, tier0) so the only way the
    // capstone's damagePct can rise is the lower-tier synergy amplifier.
    const withLower = soloInvest.slice();
    withLower[3] = 4; // firepower tier0 node3 — bulletSpeedPct
    const amped = computeSkillStats(withLower);

    expect(amped.damagePct).toBeGreaterThan(solo.damagePct);
  });

  it('integer-typed stats (pierce/bulletCount) stay whole', () => {
    const invest = zeroSkillInvest();
    invest[7] = 2; // firepower tier1 node3 — pierce, perPoint 0.5 → 2×0.5 = 1
    const s = computeSkillStats(invest);
    expect(Number.isInteger(s.pierce)).toBe(true);
    expect(s.pierce).toBe(1);
  });

  it('clamps an over-invested / corrupt vector to node maxima', () => {
    const invest = zeroSkillInvest();
    invest[0] = 999; // node max is 4
    const s = computeSkillStats(invest);
    const capped = zeroSkillInvest();
    capped[0] = SKILLS[0]?.maxPoints ?? 0;
    expect(s).toEqual(computeSkillStats(capped));
  });

  it('never grants mineralFind (meta-only stat)', () => {
    const invest = zeroSkillInvest().map(() => 5);
    expect(computeSkillStats(invest).mineralFindPct).toBe(0);
  });
});

describe('computeLoadoutStats — skill integration (plan A2)', () => {
  it('no invest reproduces the M2 gear-only result', () => {
    expect(computeLoadoutStats([]).loadout).toEqual(neutralLoadout());
    expect(computeLoadoutStats([], zeroSkillInvest()).loadout).toEqual(neutralLoadout());
  });

  it('skill investment strengthens the derived block', () => {
    const invest = zeroSkillInvest();
    invest[0] = 4; // damagePct
    invest[40] = 4; // mobility tier0 node0 — moveSpeedPct
    const { loadout } = computeLoadoutStats([], invest);
    expect(loadout.damageMult).toBeGreaterThan(1);
    expect(loadout.moveSpeedMult).toBeGreaterThan(1);
  });
});

describe('profile — invest + respec (AC1, plan A3)', () => {
  it('invests banked points and refuses when maxed or empty', () => {
    const p = defaultProfile();
    p.skillPoints = 3;
    expect(investSkill(p, 0)).toBe(true);
    expect(p.skillInvest[0]).toBe(1);
    expect(p.skillPoints).toBe(2);
    // Fill to the node max, then further invest is refused.
    const max = SKILLS[0]?.maxPoints ?? 0;
    p.skillPoints = 10;
    while ((p.skillInvest[0] ?? 0) < max) investSkill(p, 0);
    expect(investSkill(p, 0)).toBe(false);
    // Out-of-range index is a no-op.
    expect(investSkill(p, 999)).toBe(false);
  });

  it('refuses to invest with no banked points', () => {
    const p = defaultProfile();
    p.skillPoints = 0;
    expect(investSkill(p, 5)).toBe(false);
  });

  it('respec refunds all points and charges level-scaled credits', () => {
    const p = defaultProfile();
    p.skillPoints = 5;
    investSkill(p, 0);
    investSkill(p, 1);
    investSkill(p, 0);
    const invested = totalInvested(p);
    expect(invested).toBe(3);
    const bankedBefore = p.skillPoints;
    activeShip(p).level = 7;
    p.credits = respecCost(p); // exactly affordable
    expect(respecSkills(p)).toBe(true);
    expect(p.credits).toBe(0);
    expect(totalInvested(p)).toBe(0);
    expect(p.skillPoints).toBe(bankedBefore + invested); // points conserved
    expect(p.skillInvest).toEqual(zeroSkillInvest());
  });

  it('respec refused when nothing invested or credits short', () => {
    const p = defaultProfile();
    expect(respecSkills(p)).toBe(false); // nothing invested
    p.skillPoints = 2;
    investSkill(p, 0);
    activeShip(p).level = 9;
    p.credits = respecCost(p) - 1; // one short
    expect(respecSkills(p)).toBe(false);
    expect(totalInvested(p)).toBe(1); // unchanged
  });
});
