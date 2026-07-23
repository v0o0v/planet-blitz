/**
 * Wang autotiling terrain backdrop (render-only, deterministic).
 *
 * Replaces the flat per-planet TilingSprite with an organic 2-terrain floor
 * (lower ground + upper patches, e.g. basalt under snowfield) built from a
 * PixelLab-generated 16-tile Wang tileset (32px source, drawn at 64px nearest).
 *
 * DETERMINISM: the terrain field is a pure function of the run seed and integer
 * tile-corner coordinates — `upperAt(seed, vx, vy)` — so the same seed always
 * lays down the identical map and a replay reproduces the exact backdrop. No
 * `Math.random`; camera motion never mutates the field (it only pans the layer).
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

/** On-screen tile edge (px): 32px source upscaled 2x (nearest) per art spec. */
const DISPLAY_TILE = 64;
/** Extra ring of tiles kept beyond the viewport so no pop-in at the edges. */
const MARGIN = 2;
/** Noise cell size in tiles → controls patch scale (≈ this many tiles across). */
const NOISE_SCALE = 8;
/** Second octave cell size (tiles) — adds finer break-up inside big patches. */
const NOISE_SCALE_FINE = 3.2;
/** Threshold splitting the noise field into lower (<=) vs upper (>) terrain. */
const UPPER_THRESHOLD = 0.5;

/** Planet index → tileset asset basename (matches assets/tilesets/<name>.*). */
const PLANET_TILESET = ['kargon', 'berdan', 'niflheim', 'arke', 'toxar', 'kras'] as const;

type Corner = 'upper' | 'lower';
interface WangTileMeta {
  corners: { NE: Corner; NW: Corner; SE: Corner; SW: Corner };
  bounding_box: { x: number; y: number; width: number; height: number };
}
interface TilesetMeta {
  tileset_data: { tiles: WangTileMeta[] };
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

/** A ready-to-render Wang tileset: 16 sub-textures indexed by cornerKey. */
export type WangTiles = readonly Texture[]; // length 16

/**
 * Load one planet's Wang tileset from its bundled PNG + metadata. Returns 16
 * sub-textures indexed by `cornerKey`, or `null` on any missing asset / parse
 * gap so the caller can fall back to the procedural TilingSprite.
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
  return tiles as Texture[];
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
function upperAt(seed: number, vx: number, vy: number): boolean {
  const big = valueNoise(seed, vx / NOISE_SCALE, vy / NOISE_SCALE);
  const fine = valueNoise(seed ^ 0x9e3779b9, vx / NOISE_SCALE_FINE, vy / NOISE_SCALE_FINE);
  return big * 0.68 + fine * 0.32 > UPPER_THRESHOLD;
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
        const tex = tiles[this.keyAt(tx, ty)];
        if (tex === undefined) continue;
        sprite.texture = tex;
        // Scale the real (32px) tile down/up to the on-screen tile edge. Must be
        // set AFTER the texture — v8 does not recompute scale on texture swap, so
        // relying on a ctor `setSize` (1px placeholder) leaves tiles 32× too big.
        sprite.scale.set(this.displayTile / tex.frame.width);
        sprite.position.set(tx * this.displayTile, ty * this.displayTile);
        sprite.visible = true;
      }
    }
  }

  destroy(): void {
    this.layer.destroy({ children: true });
  }
}
