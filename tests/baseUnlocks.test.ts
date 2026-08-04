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
  it('a fresh pilot has the hangar + 연구소; M4 buildings stay locked', () => {
    const p = defaultProfile();
    const u = computeUnlocks(p);
    expect(u.hangar).toBe(true);
    // 연구소는 처음부터 열려 있다(RESEARCH_UNLOCK_LEVEL 3 → 1, 사용자 요청 2026-08-04).
    // 스킬 트리는 기체가 성장하는 유일한 화면이라 온보딩 두 레벨 동안 잠가 둘 이유가 없다.
    expect(RESEARCH_UNLOCK_LEVEL).toBe(1);
    expect(u.research).toBe(true);
    expect(u.refinery).toBe(false); // no clears yet
    expect(u.defenseCommand).toBe(false);
    expect(u.controlTower).toBe(false);
  });

  it('연구소 unlocks at the research level, 정제소 after any planet clear', () => {
    const p = defaultProfile();
    activeShip(p).level = RESEARCH_UNLOCK_LEVEL;
    expect(computeUnlocks(p).research).toBe(true);
    expect(computeUnlocks(p).refinery).toBe(false);
    recordPlanetClear(p, 0, 1); // 단계 1 클리어(개방/정제소 게이트는 bestStageCleared >= 1)
    expect(computeUnlocks(p).refinery).toBe(true);
  });
});

describe('recordPlanetClear — keeps the highest 침략 단계 (ADR-0022)', () => {
  it('records a clear and never lowers the best stage', () => {
    const p = defaultProfile();
    recordPlanetClear(p, 2, 5);
    expect(p.planetProgress[2]?.bestStageCleared).toBe(5);
    recordPlanetClear(p, 2, 3); // lower stage — no downgrade
    expect(p.planetProgress[2]?.bestStageCleared).toBe(5);
    recordPlanetClear(p, 2, 12); // higher stage — upgrades
    expect(p.planetProgress[2]?.bestStageCleared).toBe(12);
  });
});

describe('settleRun — records a planet clear on victory only', () => {
  it('victory records the clear; defeat does not', () => {
    const win = defaultProfile();
    settleRun(win, { victory: true, loot: [], xpTotal: 0, resources: 0, planet: 1, stage: 11 });
    expect(win.planetProgress[1]?.bestStageCleared).toBe(11);

    const loss = defaultProfile();
    settleRun(loss, { victory: false, loot: [], xpTotal: 0, resources: 0, planet: 1, stage: 11 });
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
