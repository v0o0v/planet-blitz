/**
 * Affix pool — 24종 완성 (plan B4, GDD §5, OQ-M3-5 확정).
 *
 * 12 prefixes (offence, 원소 3종 포함) + 12 suffixes (utility / survival) = 24. M2는
 * 원소 3종을 뺀 21종으로 시작했고, M3에서 원소 프리픽스(화염·냉기·전격)를 상태이상
 * 시스템(src/sim/status.ts)과 함께 투입해 24종을 완성한다.
 *
 * Data only: each affix names a `StatKey` the loadout pipeline (src/items/
 * loadout.ts) sums into a derived modifier, plus an inclusive integer roll range
 * [min, max]. Percent stats store the integer percent (10 = +10%); flat stats
 * store the absolute add. 원소 프리픽스는 명중 시 상태이상을 거는 강도를 정수로 담는다
 * (fireDmg = 틱당 피해, coldSlow = 감속 강도, lightning = 연쇄 피해). Balance numbers
 * are first-pass tuning (spec §5), expected to move during the fun-gate loop.
 */

import type { AffixDef } from '../src/items/types.js';

/** 12 offence prefixes (원소 3종 포함). */
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
  // 원소 3종(M3, 상태이상): 화염=지속피해, 냉기=감속, 전격=연쇄.
  { id: 'flaming', name: '작열의', kind: 'prefix', stat: 'fireDmg', min: 2, max: 5 },
  { id: 'freezing', name: '빙결의', kind: 'prefix', stat: 'coldSlow', min: 1, max: 1 },
  { id: 'shocking', name: '방전의', kind: 'prefix', stat: 'lightning', min: 4, max: 10 },
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

/** The full 24-affix pool (prefixes then suffixes). */
export const AFFIXES: readonly AffixDef[] = [...PREFIXES, ...SUFFIXES];

/** Lookup an affix def by id (undefined if unknown). */
export const AFFIX_BY_ID: ReadonlyMap<string, AffixDef> = new Map(AFFIXES.map((a) => [a.id, a]));
