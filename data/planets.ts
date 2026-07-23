/**
 * Star-map presentation meta (M2 Phase D3 — plan §4, AC8/AC9).
 *
 * Single source of truth for *planet identity* (which planets exist, their index
 * and 한글 이름) is the combat-content registry `data/planets/index.ts`. This file
 * only layers UI-only presentation (subtitle/accent) on top, keyed by planet id.
 * Add a planet to the registry and the star map picks it up automatically — no
 * duplicated planet list to drift out of sync.
 *
 * Consumed by the star-map overlay (src/ui/planetSelect.ts). Never touches the sim.
 */

import { PLANETS as PLANET_CONTENT } from './planets/index.js';

export interface PlanetMeta {
  /** Stable id, stamped onto drops (0 = 카르곤, 1 = 베르단, …). Mirrors registry index. */
  readonly id: number;
  readonly name: string;
  /** Short flavour line for the star-map card. */
  readonly subtitle: string;
  /** Accent colour (hex) for the card / rarity-neutral theming. */
  readonly accent: string;
}

/** UI-only presentation, keyed by planet id. Identity/name come from the registry. */
const PRESENTATION: Record<number, { subtitle: string; accent: string }> = {
  0: { subtitle: '용암 지대 · 기계 군단', accent: '#ff6a3c' },
  1: { subtitle: '곤충 군체 · 여왕의 둥지', accent: '#8fd94c' },
  4: { subtitle: '오염 지대 · 부패의 모체', accent: '#b04dd6' },
  5: { subtitle: '파괴 전선 · 공성 콜로서스', accent: '#d6484a' },
};

const FALLBACK_PRESENTATION = { subtitle: '미지의 성역', accent: '#8896b8' } as const;

/** Star-map planet cards, derived from the content registry (single source). */
export const PLANETS: readonly PlanetMeta[] = PLANET_CONTENT.map((c) => ({
  id: c.index,
  name: c.name,
  ...(PRESENTATION[c.index] ?? FALLBACK_PRESENTATION),
}));

/** Lookup a planet by id (falls back to the first planet = 카르곤). */
export function planetById(id: number): PlanetMeta {
  return PLANETS.find((p) => p.id === id) ?? PLANETS[0]!;
}
