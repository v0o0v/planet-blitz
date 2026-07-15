/**
 * Affix pool — M2 start set (plan A2, GDD §5).
 *
 * 21 affixes: 9 prefixes (offence) + 12 suffixes (utility / survival). The three
 * elemental prefixes (화염·냉기·전격) are deliberately excluded — they ship in M3
 * with the status-effect system (OQ-M2-6), completing the 24-affix pool.
 *
 * Data only: each affix names a `StatKey` the loadout pipeline (src/items/
 * loadout.ts) sums into a derived modifier, plus an inclusive integer roll range
 * [min, max]. Percent stats store the integer percent (10 = +10%); flat stats
 * store the absolute add. Balance numbers are M2 first-pass tuning (spec §5),
 * expected to move during the fun-gate loop.
 */

import type { AffixDef } from '../src/items/types.js';

/** 9 offence prefixes. */
export const PREFIXES: readonly AffixDef[] = [
  { id: 'sharp', name: '예리한', kind: 'prefix', stat: 'damagePct', min: 5, max: 10 },
  { id: 'brutal', name: '잔혹한', kind: 'prefix', stat: 'damagePct', min: 11, max: 20 },
  { id: 'deadly', name: '치명적인', kind: 'prefix', stat: 'damagePct', min: 21, max: 35 },
  { id: 'multibarrel', name: '다연장의', kind: 'prefix', stat: 'bulletCount', min: 1, max: 1 },
  { id: 'piercing', name: '관통의', kind: 'prefix', stat: 'pierce', min: 1, max: 1 },
  { id: 'rapid', name: '속사의', kind: 'prefix', stat: 'fireRatePct', min: 6, max: 12 },
  { id: 'overclocked', name: '과부하된', kind: 'prefix', stat: 'fireRatePct', min: 13, max: 22 },
  { id: 'velocity', name: '고속의', kind: 'prefix', stat: 'bulletSpeedPct', min: 8, max: 18 },
  { id: 'ranging', name: '장거리의', kind: 'prefix', stat: 'rangeFlat', min: 120, max: 360 },
];

/** 12 utility / survival suffixes. */
export const SUFFIXES: readonly AffixDef[] = [
  { id: 'of-vitality', name: '활력의', kind: 'suffix', stat: 'maxHpFlat', min: 10, max: 25 },
  { id: 'of-fortitude', name: '견고함의', kind: 'suffix', stat: 'maxHpFlat', min: 26, max: 50 },
  { id: 'of-warding', name: '보호의', kind: 'suffix', stat: 'maxHpPct', min: 4, max: 9 },
  { id: 'of-swiftness', name: '신속의', kind: 'suffix', stat: 'moveSpeedPct', min: 4, max: 9 },
  { id: 'of-celerity', name: '민첩의', kind: 'suffix', stat: 'moveSpeedPct', min: 10, max: 16 },
  { id: 'of-the-dash', name: '도약의', kind: 'suffix', stat: 'dashCdPct', min: 6, max: 14 },
  { id: 'of-magnetism', name: '자력의', kind: 'suffix', stat: 'magnetPct', min: 8, max: 20 },
  { id: 'of-greed', name: '탐욕의', kind: 'suffix', stat: 'magnetPct', min: 21, max: 40 },
  { id: 'of-learning', name: '학습의', kind: 'suffix', stat: 'xpPct', min: 5, max: 12 },
  { id: 'of-wisdom', name: '지혜의', kind: 'suffix', stat: 'xpPct', min: 13, max: 25 },
  { id: 'of-prospecting', name: '탐광의', kind: 'suffix', stat: 'mineralFindPct', min: 10, max: 25 },
  { id: 'of-fortune', name: '행운의', kind: 'suffix', stat: 'mineralFindPct', min: 26, max: 50 },
];

/** The full 21-affix M2 pool (prefixes then suffixes). */
export const AFFIXES: readonly AffixDef[] = [...PREFIXES, ...SUFFIXES];

/** Lookup an affix def by id (undefined if unknown). */
export const AFFIX_BY_ID: ReadonlyMap<string, AffixDef> = new Map(AFFIXES.map((a) => [a.id, a]));
