/**
 * Planet + tier metadata (M2 Phase D3 — plan §4, AC8/AC9).
 *
 * Data-driven so the star map (src/ui/planetSelect.ts) renders whatever planets
 * exist here without code changes. Berdan (id 1) ships its meta now; its enemy
 * roster / queen boss land with Lane 3. Until then a Berdan run still launches —
 * the sim stamps `planet: 1` on drops but falls back to the Kargon roster for
 * spawning, so the star map stays functional ahead of the content.
 */

export interface PlanetMeta {
  /** Stable id, stamped onto drops (0 = 카르곤, 1 = 베르단, …). Never renumber. */
  readonly id: number;
  readonly name: string;
  /** Short flavour line for the star-map card. */
  readonly subtitle: string;
  /** Accent colour (hex) for the card / rarity-neutral theming. */
  readonly accent: string;
  /**
   * Whether the planet's own content (roster/boss) is wired. Selectable either
   * way; false means the sim falls back to Kargon spawning (Lane 3 flips it).
   */
  readonly contentReady: boolean;
}

export const PLANETS: readonly PlanetMeta[] = [
  { id: 0, name: '카르곤', subtitle: '용암 지대 · 기계 군단', accent: '#ff6a3c', contentReady: true },
  { id: 1, name: '베르단', subtitle: '곤충 군체 · 여왕의 둥지', accent: '#8fd94c', contentReady: false },
];

export interface TierMeta {
  readonly id: number;
  readonly name: string;
  readonly desc: string;
}

export const TIERS: readonly TierMeta[] = [
  { id: 0, name: '정찰', desc: '표준 난이도 · 기본 드랍' },
  { id: 1, name: '교전', desc: '적 강화 · 엘리트 어픽스 · 드랍 상향' },
];

/** Lookup a planet by id (falls back to the first planet = 카르곤). */
export function planetById(id: number): PlanetMeta {
  return PLANETS.find((p) => p.id === id) ?? PLANETS[0]!;
}
