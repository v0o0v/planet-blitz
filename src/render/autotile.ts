/**
 * Wang autotiling terrain backdrop (render-only, deterministic).
 *
 * Replaces the flat per-planet TilingSprite with an organic 2-terrain floor
 * (lower ground + upper patches, e.g. basalt under snowfield) built from a
 * PixelLab-generated 16-tile Wang tileset (32px source, drawn at 64px nearest).
 *
 * DETERMINISM: the terrain field is a pure function of the run seed and integer
 * tile-corner coordinates — `upperAt(seed, vx, vy)` — so the same seed always
 * lays down the identical map and a replay reproduces the exact backdrop. The
 * per-tile 180° variant and macro shading tint are likewise pure in
 * (seed, tx, ty). No `Math.random`; camera motion never mutates the field (it
 * only pans the layer).
 *
 * ANTI-REPETITION: one source tile per corner key means a naive lay-down repeats
 * a pixel-identical image every DISPLAY_TILE px and the grid is plainly visible.
 * Four render-only measures break it, none touching the terrain field: a
 * deterministic 180° tile variant (`rot180Key`), extra fill renderings for the
 * two uniform keys (`WangTiles.variants`), the density band that groups those
 * renderings into multi-tile regions (`bandAt`), and a low-frequency macro shading
 * tint (`macroTint`).
 *
 * HOW THE LATTICE IS MEASURED — and how the obvious measure misleads. The first
 * metric used here was the column-luminance autocorrelation at lag 64 against its
 * neighbours at 63/65: a lattice shows up as lag 64 standing above both. That is
 * a NORMALISED quantity, so it also rises when the picture's overall contrast
 * falls. Darkening the crust (see the ART NOTE) cut the terrain's own contrast by
 * more than half, and lag 64 duly went from "between its neighbours" to "above
 * both" — on art whose lattice energy had actually HALVED. Measure it in absolute
 * luminance instead: group pixels by `x mod P`, average, and take the profile's
 * peak-to-peak. At the tile pitch P=64 that is 1.5–2.8 L over four seeds, against
 * a 0.5–1.4 L noise floor at the off-lattice control periods 61 and 67; the same
 * measurement on the previous art was 3.4–5.9 L.
 *
 * ART NOTE — the Kargon sheet is fully synthesised offline, silhouettes included.
 *
 * PixelLab was tried first and abandoned. Every prompt phrasing (14 generations,
 * standard and pro, 16px..64px, "lineless", explicit "no bricks / no masonry / no
 * grid") came back with a REGULAR micro-lattice inside the tile: brick courses,
 * honeycombs, dashed corduroy, cobbles. At 32px repeated every 64 screen px that
 * lattice is what the eye locks onto — the floor read as a masonry wall, not a
 * volcanic plain — and `rot180Key` cannot help, because a rotated rectangle is
 * still a rectangle. Replacing only the INTERIORS (keeping PixelLab silhouettes)
 * removed the lattice but produced the opposite failure: a flat vector-map slab,
 * plus a 64px staircase along every terrain boundary, because the model's
 * silhouettes are near-rectilinear and the boundary can only turn on the lattice.
 *
 * So the whole sheet is now generated: mask AND colour. The shape of every tile
 * comes from an implicit field
 *   f(u,v) = bilinear(corner values) + A · N(u,v),   upper ⇔ f > 0.5
 * where `N` is a tile-PERIODIC, 180°-ROTATION-SYMMETRIC multi-octave noise shared
 * by all 16 tiles. Those three properties are the whole correctness argument:
 *   - shared + periodic ⇒ `f` is continuous across every seam (the bilinear term
 *     already agrees there, because adjacent tiles share the two corner values),
 *     so the Wang set tiles with no notch at any junction;
 *   - symmetric ⇒ `f` is invariant under the 180° redraw, so `rot180Key` stays
 *     legal and only the (asymmetric) colour changes when a tile is flipped;
 *   - A = 0.84 < 1 ⇒ a uniform tile can never develop an island of the other
 *     terrain, which would break edge compatibility.
 * The payoff is that A is large enough to make the boundary a ragged coastline
 * with fingers and detached islands, which is what actually dissolves the 64px
 * staircase — see the note on DISPLAY_TILE.
 *
 * Interior colour obeys one hard rule, learned twice the hard way:
 *   **no low-frequency luminance inside a tile.** Anything broader than ~1/6 of
 *   the tile is cut by the tile border, and because neighbouring cells draw
 *   different variants/rotations the cut lands on the lattice → instant 64px
 *   quilt. Large-scale interest must therefore be carried by THIN HIGH-CONTRAST
 *   LINES (lava veins, basalt fissures with a lit upper lip), which repeat
 *   invisibly, and broad shading is delegated entirely to `macroTint`, which is
 *   not tile-periodic. Both regions are built as plate networks (wrapping Worley)
 *   at two scales, with directional top-lit/bottom-dark bevels.
 *
 * The upper terrain is DARK COOLED CRUST whose orange lives only in the cracks.
 * It was not always dark enough: an earlier pass reported "bright pixels are 2% of
 * the frame" and passed itself on that number, while the crust MEAN sat at L 70
 * against basalt's 21 — so the whole region read as mid-bright orange even though
 * few individual pixels were bright. Kargon's enemies are orange, and they were
 * camouflaged against it; that is a readability defect, not a taste one. Crust
 * mean is now L 32 against basalt 21, and the share of frame pixels within ΔRGB 70
 * of the enemy tank's body colour fell from 3.2–8.6% to 0.5–1.7%. **Judge the
 * region mean, not the bright-pixel count.**
 *
 * Per-variant plate scales give plate sizes that vary from place to place, which a
 * single 32px tile cannot do on its own; `bandAt` then arranges those scales into
 * regions so the floor has quiet stretches and shattered ones instead of one
 * uniform mesh, and the plates are anisotropic so a region reads as having flowed.
 *
 * Regenerating: `.omc/research/kargon-aaa-shots/kargon-tileset-gen.mjs` is the
 * synthesiser (with self-checks for seam continuity, rot180 invariance and a
 * coverage/luminance summary); `kargon-tileset-preview.mjs` in the same directory
 * lays a 1920×1080 frame offline and prints every number quoted above, so the art
 * can be judged without a browser.
 *
 * SIM SEPARATION: nothing here touches `src/sim`. The terrain is pure visual
 * decoration with no collision meaning; hashes are self-contained so the module
 * has zero coupling to the deterministic sim (ADR-0005 render/sim split).
 *
 * PERFORMANCE: a fixed sprite pool covers the viewport plus a small margin ring.
 * Sub-tile scrolling is done by translating the whole layer (like the entity
 * layer), so per-frame work is O(1) except when the camera crosses a tile
 * boundary, when the visible pool is re-textured in O(viewport tiles). Wang keys
 * are only recomputed on those crossings.
 */

import { Assets, Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from './app.js';

/**
 * On-screen tile edge (px): 32px source upscaled 2x (nearest) per art spec.
 *
 * EXPORTED because `src/render/env/kargonLavaLight.ts` must place its glow on the
 * same lattice; it used to keep a private copy of this value (and of the three
 * field constants below), which silently went out of phase the moment either side
 * was retuned. Import from here — do not re-declare.
 *
 * WHY IT IS STILL 64 AFTER THE STAIRCASE COMPLAINT. Terrain boundaries can only
 * turn on this lattice, so a 64px step was visible along every coastline, and
 * halving to 32 is the obvious cure. It was built and compared, and rejected on
 * three counts: (1) it is not the cure — with the ragged silhouettes described in
 * the ART NOTE the step is already dissolved at 64, and 32 mostly makes the art
 * finer, not straighter; (2) it costs 4× the sprite pool (≈550 → ≈2,200 tiles for
 * a 1920×1080 viewport plus the MARGIN ring) and re-textures twice as often,
 * since the camera crosses a tile boundary every 32px instead of 64 — ≈8× the
 * re-tile work per unit of camera travel, against a whole-environment budget of
 * +0.5ms/frame — and it doubles the marching-squares contour resolution in
 * `kargonLavaLight` on top of that; (3) NOISE_SCALE is measured IN TILES, so
 * halving this halves the world-space size of every lava lake and silently
 * recomposes a map the other Kargon layers were tuned against.
 */
export const DISPLAY_TILE = 64;
/** Extra ring of tiles kept beyond the viewport so no pop-in at the edges. */
const MARGIN = 2;
/** Noise cell size in tiles → controls patch scale (≈ this many tiles across). */
export const NOISE_SCALE = 8;
/** Second octave cell size (tiles) — adds finer break-up inside big patches. */
export const NOISE_SCALE_FINE = 3.2;
/**
 * Threshold splitting the noise field into lower (<=) vs upper (>) terrain.
 *
 * 0.57, not the neutral 0.5. On Kargon the two terrains are near-black basalt and
 * molten ground, and a 50/50 split leaves the floor with no dominant value.
 *
 * It was NOT raised further when the upper terrain still looked too loud: the
 * fix for that belongs in the art, not here. Upper is now cooled crust with
 * narrow veins (ART NOTE), so at 32.2% coverage only ~2% of frame pixels are
 * actually bright, and raising the threshold instead would have shrunk the lava
 * lakes — moving the contour `kargonLavaLight` rides and re-tuning that lane's
 * work for free. Measured coverage over 3 seeds × 9600 cells: 0.5 → 46.7% upper,
 * 0.57 → 32.2%, 0.62 → 22.7%, 0.68 → 13.3%. 32.2% is the "dark rock with lava
 * lakes in it" reading the volcanic stages of Hades / Dead Cells use; pushing on
 * to 0.62 starts leaving whole screens with nothing but basalt on them.
 *
 * ⚠️ `kargonLavaLight` finds cracks as `|field - UPPER_THRESHOLD| < CRACK_BAND`, so
 * it MUST import this constant rather than assume 0.5, or its glow lands on a
 * contour the floor does not draw.
 */
export const UPPER_THRESHOLD = 0.57;
/**
 * Macro-shading cell size (tiles). Deliberately coprime-ish with NOISE_SCALE so
 * the broad light/dark drift does NOT line up with the terrain patches — if the
 * two correlated, the shading would just re-outline the same shapes.
 */
const MACRO_SCALE = 13;
/** Second macro octave (tiles) — mid-frequency break-up of the broad drift. */
const MACRO_SCALE_FINE = 3.7;

/** Planet index → tileset asset basename (matches assets/tilesets/<name>.*). */
const PLANET_TILESET = ['kargon', 'berdan', 'niflheim', 'arke', 'toxar', 'kras'] as const;

type Corner = 'upper' | 'lower';
interface WangTileMeta {
  corners: { NE: Corner; NW: Corner; SE: Corner; SW: Corner };
  bounding_box: { x: number; y: number; width: number; height: number };
}
/** Optional extra renderings of one Wang key (see {@link WangTiles.variants}). */
interface FillVariantMeta {
  key: number;
  /** Detail-density class of this rendering (see {@link bandAt}). Default {@link DEFAULT_BAND}. */
  band?: number;
  bounding_box: { x: number; y: number; width: number; height: number };
}
interface TilesetMeta {
  tileset_data: { tiles: WangTileMeta[] };
  /** Density class of the base tile in slot 0 (see {@link bandAt}). */
  base_band?: number;
  fill_variants?: FillVariantMeta[];
}

// Eagerly resolve the tileset PNG urls + parsed JSON metadata that actually
// exist. A missing planet simply has no entry → the caller keeps its TilingSprite
// fallback (regression 0).
const TILESET_URLS = import.meta.glob('../../assets/tilesets/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
const TILESET_META = import.meta.glob('../../assets/tilesets/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, TilesetMeta>;

function lookup<T>(map: Record<string, T>, basename: string): T | undefined {
  for (const key in map) {
    if (key.endsWith(`/${basename}`)) return map[key];
  }
  return undefined;
}

/**
 * Corner-value → 4-bit Wang key. Bit layout (upper=1, lower=0):
 * `NW<<3 | NE<<2 | SE<<1 | SW`. Used both to index the parsed tile table and to
 * classify a live cell, so the two must stay in lockstep.
 */
function cornerKey(nw: number, ne: number, se: number, sw: number): number {
  return (nw << 3) | (ne << 2) | (se << 1) | sw;
}

/**
 * 180° rotation of a Wang key: NW↔SE, NE↔SW.
 *
 * WHY THIS IS LEGAL: a Wang tile is selected purely by its four corner terrain
 * values, so rotating a tile 180° yields a tile whose corners are the rotated
 * set. Therefore drawing `tiles[rot180(key)]` rotated 180° satisfies `key`
 * exactly — it is a second, equally valid rendering of the same cell.
 *
 * WHY WE WANT IT: PixelLab emits ONE 32px source tile per terrain, so without
 * variants every cell of a terrain is pixel-identical and the eye locks onto a
 * hard `DISPLAY_TILE` grid. Measured on the Kargon sheet, the periodic
 * luminance signature at lag=32 drops from 77.9% to ~33% once this is on, and
 * cross-tile seam contrast rises to match the tiles' own interior contrast
 * (9.26 vs 8.28 mean |ΔL|) instead of being artificially smoother — that
 * unnatural smoothness at exact tile boundaries is what drew the grid.
 *
 * WHY 180° AND NOT H/V MIRRORING: mirroring also satisfies the corner rule and
 * gives 4 variants instead of 2, but two mirrored neighbours share a bilaterally
 * symmetric edge, which reads as ornate "damask wallpaper" — visibly worse than
 * the grid it removes. A 180° rotation produces point symmetry, which the eye
 * does not pick up.
 */
function rot180Key(key: number): number {
  const nw = (key >> 3) & 1;
  const ne = (key >> 2) & 1;
  const se = (key >> 1) & 1;
  const sw = key & 1;
  return cornerKey(se, sw, nw, ne);
}

/**
 * A ready-to-render Wang tileset.
 *
 * `base[k]` is the canonical tile for corner key `k` (length 16). `variants[k]`
 * holds OPTIONAL extra renderings of that same key — alternative art for a cell
 * the Wang rule would otherwise always fill with one identical texture.
 *
 * WHY VARIANTS EXIST. The two uniform keys (0 = all lower, 15 = all upper) cover
 * most of the screen, and a single texture for each means the same 32px image is
 * stamped on every DISPLAY_TILE of open ground. `rot180Key` doubles that to two
 * renderings, which is not enough: any feature bigger than a few source pixels
 * still re-exposes the lattice as a quilt, so the art was forced to stay
 * high-frequency (and therefore flat). Variants lift the ceiling — with four
 * extra fills per uniform key the cell has 5×2 = 10 renderings, which is enough
 * that plate/vein structure at a genuinely visible scale no longer reads as
 * repetition. Empty for tilesets whose JSON declares none (every planet but
 * Kargon today), which is exactly the previous behaviour.
 *
 * ⚠️ Variants are only safe for keys whose terrain is UNIFORM. A boundary tile's
 * silhouette must agree pixel-for-pixel with every tile it can touch, so it has
 * exactly one rendering; {@link loadWangTiles} drops any variant declared for a
 * mixed key rather than laying down a tile that notches at the seam.
 */
export interface WangTiles {
  readonly base: readonly Texture[]; // length 16, indexed by cornerKey
  readonly variants: readonly (readonly Texture[])[]; // length 16, usually empty
  /**
   * `byBand[key][band]` — the renderings of `key` (base + variants) whose art is
   * drawn at that detail density. Empty for a band a tileset declares nothing in;
   * the caller then falls back to the base tile. See {@link bandAt} for why the
   * density is chosen by a coherent field rather than per tile.
   */
  readonly byBand: readonly (readonly (readonly Texture[])[])[];
}

/** Number of detail-density classes: 0 = quiet slab, 1 = mid, 2 = finely shattered. */
const BANDS = 3;
/** Density class assumed for art that declares none (mid) — pre-band tilesets. */
const DEFAULT_BAND = 1;
/**
 * Cell size (in tiles) of the detail-density field. ~5 tiles ≈ 320px patches: big
 * enough that a quiet stretch reads as a region rather than a tile.
 */
const BAND_SCALE = 5;

/**
 * Load one planet's Wang tileset from its bundled PNG + metadata. Returns 16
 * sub-textures indexed by `cornerKey` (plus any declared fill variants), or
 * `null` on any missing asset / parse gap so the caller can fall back to the
 * procedural TilingSprite.
 */
export async function loadWangTiles(planet: number): Promise<WangTiles | null> {
  const name = PLANET_TILESET[planet];
  if (name === undefined) return null;
  const url = lookup(TILESET_URLS, `${name}.png`);
  const meta = lookup(TILESET_META, `${name}.json`);
  if (url === undefined || meta === undefined) return null;
  const tileList = meta.tileset_data?.tiles;
  if (!Array.isArray(tileList) || tileList.length < 16) return null;

  let base: Texture;
  try {
    base = await Assets.load<Texture>(url);
  } catch {
    return null;
  }
  base.source.scaleMode = 'nearest';

  const tiles = new Array<Texture | undefined>(16);
  const enc = (c: Corner): number => (c === 'upper' ? 1 : 0);
  for (const t of tileList) {
    const c = t.corners;
    const bb = t.bounding_box;
    if (c === undefined || bb === undefined) continue;
    const key = cornerKey(enc(c.NW), enc(c.NE), enc(c.SE), enc(c.SW));
    tiles[key] = new Texture({
      source: base.source,
      frame: new Rectangle(bb.x, bb.y, bb.width, bb.height),
    });
  }
  // Every one of the 16 corner combinations must resolve, else the Wang lookup
  // would hit an undefined slot at some camera position → bail to fallback.
  for (let i = 0; i < 16; i++) {
    if (tiles[i] === undefined) return null;
  }

  const variants: Texture[][] = Array.from({ length: 16 }, () => []);
  const byBand: Texture[][][] = Array.from({ length: 16 }, () =>
    Array.from({ length: BANDS }, () => [] as Texture[]),
  );
  // Every key's base tile is a candidate in its own declared band.
  const baseBand = clampBand(meta.base_band);
  for (let k = 0; k < 16; k++) {
    const t = tiles[k];
    if (t !== undefined) byBand[k]?.[baseBand]?.push(t);
  }
  for (const v of meta.fill_variants ?? []) {
    const bb = v.bounding_box;
    if (bb === undefined) continue;
    // Uniform keys only — see the warning on `WangTiles`. A variant of a
    // boundary key would carry a second, different silhouette for the same
    // corner set and notch against its neighbours.
    if (v.key !== 0 && v.key !== 15) continue;
    const tex = new Texture({
      source: base.source,
      frame: new Rectangle(bb.x, bb.y, bb.width, bb.height),
    });
    variants[v.key]?.push(tex);
    byBand[v.key]?.[clampBand(v.band)]?.push(tex);
  }
  // Art that declares no density classes at all (every planet but Kargon) must
  // behave exactly as before bands existed: one pool, every rendering eligible.
  // Without this the two undeclared bands would be empty and ~2/3 of the floor
  // would silently fall back to the base tile — a repetition regression, and one
  // that would only ever show up as "why did the variants stop working".
  const declaresBands =
    meta.base_band !== undefined || (meta.fill_variants ?? []).some((v) => v.band !== undefined);
  if (!declaresBands) {
    for (let k = 0; k < 16; k++) {
      const all = byBand[k]?.[DEFAULT_BAND] ?? [];
      for (let b = 0; b < BANDS; b++) if (b !== DEFAULT_BAND) byBand[k]?.[b]?.push(...all);
    }
  }
  return { base: tiles as Texture[], variants, byBand };
}

/** Coerce a declared band to a valid index; anything missing/odd falls to mid. */
function clampBand(b: number | undefined): number {
  if (typeof b !== 'number' || !Number.isInteger(b) || b < 0 || b >= BANDS) return DEFAULT_BAND;
  return b;
}

/** 32-bit integer hash of (seed, x, y) → float in [0,1). Pure, no state. */
function hash2(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 0x100000000;
}

/** Smoothstep fade for value-noise interpolation. */
function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 2D value noise on the integer lattice, bilinearly smoothed → [0,1). */
function valueNoise(seed: number, fx: number, fy: number): number {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const u = fade(fx - x0);
  const v = fade(fy - y0);
  const a = hash2(seed, x0, y0);
  const b = hash2(seed, x0 + 1, y0);
  const c = hash2(seed, x0, y0 + 1);
  const d = hash2(seed, x0 + 1, y0 + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/**
 * Terrain classification at a tile CORNER (vertex) `(vx, vy)`: two octaves of
 * value noise give big organic patches (NOISE_SCALE) broken up by finer detail
 * (NOISE_SCALE_FINE). Pure in (seed, vx, vy) — the determinism contract.
 */
export function upperAt(seed: number, vx: number, vy: number): boolean {
  return terrainFieldAt(seed, vx, vy) > UPPER_THRESHOLD;
}

/**
 * The continuous field `upperAt` thresholds. Exported so consumers that need the
 * DISTANCE to the terrain boundary (lava glow rides the boundary, not the region)
 * can read it instead of re-deriving the octave weights by hand.
 */
export function terrainFieldAt(seed: number, vx: number, vy: number): number {
  const big = valueNoise(seed, vx / NOISE_SCALE, vy / NOISE_SCALE);
  const fine = valueNoise(seed ^ 0x9e3779b9, vx / NOISE_SCALE_FINE, vy / NOISE_SCALE_FINE);
  return big * 0.68 + fine * 0.32;
}

/**
 * Detail-density class for cell `(tx, ty)` — which "band" of art to draw there.
 *
 * WHY THIS IS A FIELD AND NOT A PER-TILE HASH. The Kargon sheet carries variants
 * at wildly different crack densities, from an almost featureless slab to an 8px
 * shatter zone, so that the floor has RHYTHM — dense stretches against deliberate
 * negative space — instead of one uniform procedural mesh over the whole screen.
 * Picking that variant with an independent per-tile hash was built first and is
 * plainly wrong: a lone slab dropped between two shatter tiles reads as an exact
 * 64px SQUARE. That is worse than the luminance quilt the variant system exists to
 * prevent, because the offending shape is a perfect rectangle and the eye finds it
 * instantly. Driving the choice from low-frequency noise instead makes neighbours
 * share a density, so quiet zones become multi-tile organic blobs and the density
 * boundary follows a contour.
 *
 * The per-tile jitter matters too: without it the contour is a clean curve, which
 * is its own tell. ±0.07 dithers the class assignment by roughly one tile along the
 * boundary, so the transition frays.
 *
 * Texture choice WITHIN a band stays a per-tile hash — neighbours must share a
 * density but must not share a texture, or the identical 32px image lands side by
 * side and the whole anti-repetition argument collapses.
 *
 * Pure in (seed, tx, ty) — the determinism contract, like `upperAt`.
 */
function bandAt(seed: number, tx: number, ty: number): number {
  const f =
    valueNoise(seed ^ 0x3c6ef372, tx / BAND_SCALE, ty / BAND_SCALE) +
    (hash2(seed ^ 0x27d4eb2d, tx, ty) - 0.5) * 0.14;
  // Thresholds are the measured 35th/65th percentiles of `f` over four seeds, i.e.
  // a deliberate 35/30/35 split. Half the screen quiet (the first cut) left the
  // upper terrain looking merely empty rather than rhythmic.
  if (f < 0.406) return 0;
  if (f < 0.6) return 1;
  return 2;
}

/**
 * Per-tile macro shading tint at cell `(tx, ty)`, packed 0xRRGGBB for `Sprite.tint`.
 *
 * A real terrain floor is not uniformly lit. Two octaves of low-frequency noise
 * give broad light/dark drift across many tiles, plus a tiny per-tile jitter so
 * neighbours are never exactly equal. Regions that land high in the field also
 * drift warm (more red, less blue), reading as ground nearer the heat.
 *
 * Pixi's `tint` is MULTIPLICATIVE, so it can only darken — the shade band is
 * therefore centred below 1.0 and the source art is authored slightly bright to
 * compensate (see `scripts/asset-prep.mjs` tone pass notes).
 *
 * Pure in (seed, tx, ty), like `upperAt` — the determinism contract holds.
 */
function macroTint(seed: number, tx: number, ty: number): number {
  const m =
    valueNoise(seed ^ 0x1b873593, tx / MACRO_SCALE, ty / MACRO_SCALE) * 0.72 +
    valueNoise(seed ^ 0x7feb352d, tx / MACRO_SCALE_FINE, ty / MACRO_SCALE_FINE) * 0.28;
  const jitter = (hash2(seed ^ 0x2545f491, tx, ty) - 0.5) * 0.05;
  // Band widened from [0.78, 1.00] to [0.58, 1.00]. The narrow band was invisible,
  // and this tint has to carry MORE than shading: the source art deliberately
  // holds no low-frequency structure of its own (ART NOTE — anything broad inside
  // a tile quilts on the lattice), so every "this stretch of ground is hotter /
  // darker than that one" cue at a scale above one tile comes from here. It is
  // safe to be broad precisely because it is NOT tile-periodic: neighbouring
  // cells differ only slightly, so no block edges appear.
  const shade = 0.58 + 0.42 * m + jitter;
  const heat = Math.max(0, m - 0.48) * 0.85;
  const to255 = (v: number): number => {
    const n = Math.round(v * 255);
    return n < 0 ? 0 : n > 255 ? 255 : n;
  };
  const r = to255(shade * (1 + heat * 0.36));
  const g = to255(shade * (1 - heat * 0.16));
  const b = to255(shade * (1 - heat * 0.55));
  return (r << 16) | (g << 8) | b;
}

/**
 * Pooled, deterministic Wang autotile backdrop. Add `layer` beneath the entity
 * layer; call `update(camX, camY)` each frame with the interpolated camera.
 */
export class AutotileBackground {
  readonly layer = new Container();
  private tiles: WangTiles | null = null;
  private seed = 0;
  private readonly displayTile: number;
  private cols = 0;
  private rows = 0;
  private readonly pool: Sprite[] = [];
  // Sentinels that force a full re-tile on the first update after a swap.
  private lastBaseTx = Number.NaN;
  private lastBaseTy = Number.NaN;
  private dirty = true;

  /** `displayTile`: on-screen tile edge px (default 64 = 32px source ×2). Lower
   *  values zoom the terrain out (more, finer tiles); render-only tuning. */
  constructor(displayTile: number = DISPLAY_TILE) {
    this.displayTile = displayTile;
    // Initial coverage for the nominal design viewport; `ensureCoverage` grows
    // the pool when the real window's visible area is larger (aspect overscan).
    this.ensureCoverage(DESIGN_WIDTH, DESIGN_HEIGHT);
    this.layer.visible = false;
  }

  /**
   * Grow the sprite pool so it covers a `viewW`×`viewH` design-space viewport
   * plus a MARGIN tile ring. Call on window resize: when the window aspect is
   * not 16:9, `fitToWindow` leaves the visible design area larger than
   * DESIGN_WIDTH/HEIGHT (letterbox overscan), and the floor must still fill it —
   * otherwise the right/bottom edges show the bare app background. Grows only
   * (never shrinks) so laid tiles keep their pool slots; forces a full re-tile.
   */
  ensureCoverage(viewW: number, viewH: number): void {
    const cols = Math.ceil(viewW / this.displayTile) + MARGIN * 2;
    const rows = Math.ceil(viewH / this.displayTile) + MARGIN * 2;
    if (cols <= this.cols && rows <= this.rows) return;
    this.cols = Math.max(cols, this.cols);
    this.rows = Math.max(rows, this.rows);
    const need = this.cols * this.rows;
    for (let i = this.pool.length; i < need; i++) {
      const s = new Sprite();
      // NOTE: scale is intentionally NOT set here. `setSize` on the 1px
      // placeholder texture would leave scale = displayTile (real 32px tile is
      // assigned in `update`), drawing every tile 32× oversized. `update` sets
      // the correct scale right after assigning the texture.
      //
      // Centre anchor so the 180° variant can be expressed as a NEGATIVE scale
      // about the tile centre; with the default (0,0) anchor a negative scale
      // would mirror the tile out of its own cell.
      s.anchor.set(0.5);
      s.visible = false;
      this.pool.push(s);
      this.layer.addChild(s);
    }
    this.dirty = true;
  }

  /** True when a Wang tileset is active (caller then hides its TilingSprite). */
  get active(): boolean {
    return this.tiles !== null;
  }

  /**
   * Swap in a planet's tileset (or `null` to disable → fall back). Setting the
   * run seed re-derives the terrain field; both force a full re-tile next frame.
   */
  configure(tiles: WangTiles | null, seed: number): void {
    this.tiles = tiles;
    this.seed = seed >>> 0;
    this.dirty = true;
    this.layer.visible = tiles !== null;
    if (tiles === null) {
      for (const s of this.pool) s.visible = false;
    }
  }

  /** Wang tile index for cell (tx, ty) from its four corner vertices. */
  private keyAt(tx: number, ty: number): number {
    const nw = upperAt(this.seed, tx, ty) ? 1 : 0;
    const ne = upperAt(this.seed, tx + 1, ty) ? 1 : 0;
    const sw = upperAt(this.seed, tx, ty + 1) ? 1 : 0;
    const se = upperAt(this.seed, tx + 1, ty + 1) ? 1 : 0;
    return cornerKey(nw, ne, se, sw);
  }

  /**
   * Pan the layer to the interpolated camera (mirrors EntityRenderer so the floor
   * scrolls in lockstep with entities) and lay tiles across the VISIBLE design
   * rect `[viewMinX..viewMaxX] × [viewMinY..viewMaxY]`. The caller derives that
   * rect from the stage's inverse transform of the screen, so the floor fills the
   * whole window at any DPR / aspect / letterbox — not just the nominal 1920×1080
   * design area. Re-textures the pool only when the camera crosses a base tile.
   */
  update(
    camX: number,
    camY: number,
    viewMinX: number,
    viewMinY: number,
    viewMaxX: number,
    viewMaxY: number,
  ): void {
    const tiles = this.tiles;
    if (tiles === null) return;
    this.ensureCoverage(viewMaxX - viewMinX, viewMaxY - viewMinY);
    // Same mapping as EntityRenderer: world point (wx,wy) → wx - camX + W/2.
    const offX = DESIGN_WIDTH / 2 - camX;
    const offY = DESIGN_HEIGHT / 2 - camY;
    this.layer.position.set(offX, offY);

    // A tile at index tx draws at stage-local x = tx*displayTile + offX. Start
    // MARGIN tiles before the top-left of the visible rect; the pool (sized to the
    // rect + 2*MARGIN by ensureCoverage) then reaches past the bottom-right.
    const baseTx = Math.floor((viewMinX - offX) / this.displayTile) - MARGIN;
    const baseTy = Math.floor((viewMinY - offY) / this.displayTile) - MARGIN;
    if (!this.dirty && baseTx === this.lastBaseTx && baseTy === this.lastBaseTy) {
      return; // sub-tile scroll — layer.position already moved, nothing to re-tile
    }
    this.lastBaseTx = baseTx;
    this.lastBaseTy = baseTy;
    this.dirty = false;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const tx = baseTx + c;
        const ty = baseTy + r;
        const sprite = this.pool[r * this.cols + c];
        if (sprite === undefined) continue;
        const key = this.keyAt(tx, ty);
        // Deterministic 180° variant. Drawing tiles[rot180(key)] rotated 180°
        // is an equally valid rendering of `key` (see `rot180Key`) and is what
        // breaks the otherwise pixel-identical DISPLAY_TILE grid.
        const flip = hash2(this.seed ^ 0x5bf03635, tx, ty) < 0.5;
        // Index the variant pool by the key actually DRAWN, not by `key`. For the
        // uniform keys the two coincide (rot180Key(0)=0, rot180Key(15)=15), but
        // deriving it keeps the lookup correct if variants are ever declared for
        // another key that survives the loader's uniform-key filter.
        const drawKey = flip ? rot180Key(key) : key;
        // Density class first (coherent over several tiles — see `bandAt`), then a
        // per-tile pick among that class's renderings so neighbours still differ.
        const pool = tiles.byBand[drawKey]?.[bandAt(this.seed, tx, ty)];
        let tex = tiles.base[drawKey];
        if (pool !== undefined && pool.length > 0) {
          const vi = Math.floor(hash2(this.seed ^ 0x68bc21eb, tx, ty) * pool.length);
          tex = pool[Math.min(vi, pool.length - 1)];
        }
        if (tex === undefined) continue;
        sprite.texture = tex;
        // Scale the real (32px) tile down/up to the on-screen tile edge. Must be
        // set AFTER the texture — v8 does not recompute scale on texture swap, so
        // relying on a ctor `setSize` (1px placeholder) leaves tiles 32× too big.
        const s = this.displayTile / tex.frame.width;
        sprite.scale.set(flip ? -s : s, flip ? -s : s);
        sprite.tint = macroTint(this.seed, tx, ty);
        // Centre-anchored (see `ensureCoverage`), so position is the tile centre.
        sprite.position.set(
          tx * this.displayTile + this.displayTile / 2,
          ty * this.displayTile + this.displayTile / 2,
        );
        sprite.visible = true;
      }
    }
  }

  destroy(): void {
    this.layer.destroy({ children: true });
  }
}
