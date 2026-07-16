/**
 * Game textures: real pixel-art sprites with a procedural fallback.
 *
 * Phase 4 swapped the primitive-shape placeholders for PixelLab-generated
 * sprites in `assets/`. `loadGameTextures` builds the procedural set first, then
 * overrides each slot with the real PNG when it loads — so a missing or corrupt
 * asset silently falls back to its placeholder and the game never dies (task 18
 * requirement). `createPlaceholderTextures` remains the synchronous, dependency
 * free path used by the bench harness.
 *
 * The directional sprites (ship, enemies) are authored pointing +x (east) to
 * match the renderer's `rotation = angle` convention; PixelLab's north-facing
 * output was rotated 90° CW at asset-prep time.
 *
 * Readability rule (spec): bullets stay a WHITE CORE with a coloured OUTLINE —
 * friendly bullets outline cyan, enemy bullets outline hot-red — so hostile fire
 * stays legible at bullet-hell density. Bullets are therefore kept procedural on
 * purpose (a textured bullet would undermine the readability contract).
 */

import { Assets, Graphics, type Renderer, type Texture } from 'pixi.js';

export interface PlaceholderTextures {
  player: Texture;
  bullet: Texture;
  enemyBullet: Texture;
  gem: Texture;
  /**
   * Enemy textures indexed by global typeIndex (0..21): 카르곤 0~3, 베르단 4~9,
   * 니플헤임 10~15, 아르케 16~21 (data/enemies ENEMY_BY_TYPE 순서와 1:1).
   */
  enemy: Texture[];
  /**
   * Boss textures indexed by planetIndex (0 카르곤 요새 .. 3 아르케 오벨리스크).
   * A missing per-planet PNG falls back to the Kargon boss (slot 0).
   */
  boss: Texture[];
  /** Supply raider transport. */
  supply: Texture;
  /**
   * Parachute canopy for the supply drop (render-only decoration). `null` when
   * no `fx_parachute.png` is present — the supply then renders unchanged.
   */
  parachute: Texture | null;
  /** Floor loot pickup (neutral gold glyph; renderer tints by rarity code). */
  loot: Texture;
  /** Death burst effect (render-only juice). */
  explosion: Texture;
  /**
   * Tileable arena backdrop indexed by planetIndex (0 카르곤 화산 .. 3 아르케).
   * A missing per-planet PNG falls back to the Kargon backdrop (slot 0).
   */
  background: Texture[];
  // --- Scroll-map gimmicks (plan Phase E/F) ---
  /** Cover wall — a unit square stretched to the AABB by the renderer. */
  wall: Texture;
  /** Destructible object (drops a gem when broken). */
  destructible: Texture;
  /** Magnet emitter event object. */
  magnetEmitter: Texture;
  /** Bomb device event object. */
  bombDevice: Texture;
  /** Turret pickup event object. */
  turretPickup: Texture;
}

/**
 * Per-typeIndex colour + base radius + shape, covering ALL 22 enemies
 * (ENEMY_BY_TYPE order). Radii match the 2x-scale sim hitboxes (plan D1) so the
 * shape placeholders line up with the enlarged entities when no PixelLab asset
 * is present. Role reads from the SHAPE (tri charger / square gunner / diamond
 * special / hex support; elites reuse the gunner/charger shape one size up), and
 * PLANET reads from the palette — 카르곤 화염 red/amber, 베르단 산성 green,
 * 니플헤임 서리 ice-blue, 아르케 고대기계 bronze — so the fallback still tells the
 * four planets apart (task Phase F ①).
 */
const ENEMY_STYLE: { color: number; radius: number; shape: 'tri' | 'square' | 'diamond' | 'hex' }[] = [
  // 카르곤 0~3 (M1 원본 유지)
  { color: 0xff5533, radius: 36, shape: 'tri' }, // 0 charger — aggressive dart
  { color: 0xffb020, radius: 32, shape: 'square' }, // 1 gunner
  { color: 0xff3300, radius: 44, shape: 'diamond' }, // 2 lava spring
  { color: 0x33ffcc, radius: 30, shape: 'hex' }, // 3 support
  // 베르단 4~9 — 산성 그린
  { color: 0x7ec53a, radius: 32, shape: 'tri' }, // 4 charger
  { color: 0x9bd94a, radius: 30, shape: 'square' }, // 5 gunner
  { color: 0x5fa82c, radius: 42, shape: 'diamond' }, // 6 special
  { color: 0xb6e86a, radius: 28, shape: 'hex' }, // 7 support
  { color: 0xcfff70, radius: 44, shape: 'square' }, // 8 elite gunner
  { color: 0xcfff70, radius: 50, shape: 'tri' }, // 9 elite charger
  // 니플헤임 10~15 — 서리 아이스블루
  { color: 0x5cc4f2, radius: 30, shape: 'tri' }, // 10 charger
  { color: 0x7ad3f7, radius: 32, shape: 'square' }, // 11 gunner
  { color: 0x3f9dd0, radius: 44, shape: 'diamond' }, // 12 special
  { color: 0xa6e6ff, radius: 28, shape: 'hex' }, // 13 support
  { color: 0xd0f4ff, radius: 46, shape: 'square' }, // 14 elite gunner
  { color: 0xd0f4ff, radius: 52, shape: 'tri' }, // 15 elite charger
  // 아르케 16~21 — 고대기계 브론즈
  { color: 0xc07a28, radius: 38, shape: 'tri' }, // 16 charger
  { color: 0xd6923a, radius: 34, shape: 'square' }, // 17 gunner
  { color: 0x9a5f1e, radius: 46, shape: 'diamond' }, // 18 special
  { color: 0xe0ad5a, radius: 30, shape: 'hex' }, // 19 support
  { color: 0xf0c268, radius: 48, shape: 'square' }, // 20 elite gunner
  { color: 0xf0c268, radius: 54, shape: 'tri' }, // 21 elite charger
];

function drawTriangle(g: Graphics, r: number, color: number): void {
  g.moveTo(r, 0)
    .lineTo(-r * 0.8, r * 0.7)
    .lineTo(-r * 0.8, -r * 0.7)
    .lineTo(r, 0)
    .fill({ color })
    .stroke({ color: 0xffffff, width: 2, alignment: 0 });
}

function drawSquare(g: Graphics, r: number, color: number): void {
  g.rect(-r, -r, r * 2, r * 2).fill({ color }).stroke({ color: 0xffffff, width: 2, alignment: 0 });
}

function drawDiamond(g: Graphics, r: number, color: number): void {
  g.moveTo(0, -r)
    .lineTo(r, 0)
    .lineTo(0, r)
    .lineTo(-r, 0)
    .lineTo(0, -r)
    .fill({ color })
    .stroke({ color: 0xffffff, width: 2, alignment: 0 });
}

function drawHex(g: Graphics, r: number, color: number): void {
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath().fill({ color }).stroke({ color: 0xffffff, width: 2, alignment: 0 });
}

function enemyTexture(renderer: Renderer, style: (typeof ENEMY_STYLE)[number]): Texture {
  const g = new Graphics();
  switch (style.shape) {
    case 'tri':
      drawTriangle(g, style.radius, style.color);
      break;
    case 'square':
      drawSquare(g, style.radius, style.color);
      break;
    case 'diamond':
      drawDiamond(g, style.radius, style.color);
      break;
    case 'hex':
      drawHex(g, style.radius, style.color);
      break;
  }
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

/** Per-planet backdrop palette (base fill, crack under/over, ember). */
interface BackdropPalette {
  base: number;
  crackUnder: number;
  crackOver: number;
  ember: number;
}

// One palette per planetIndex. Slot 0 = the original M1 volcanic look (unchanged
// values), so the Kargon backdrop is byte-identical to before (no regression).
const BACKDROP_PALETTES: readonly BackdropPalette[] = [
  { base: 0x0d0a12, crackUnder: 0x4a1608, crackOver: 0xff5a1e, ember: 0xffb020 }, // 0 카르곤 화산
  { base: 0x0a1207, crackUnder: 0x24401a, crackOver: 0x7ec53a, ember: 0xb6e86a }, // 1 베르단 산성 습지
  { base: 0x081018, crackUnder: 0x1a3a52, crackOver: 0x5cc4f2, ember: 0xa6e6ff }, // 2 니플헤임 빙원
  { base: 0x120e08, crackUnder: 0x4a3418, crackOver: 0xc07a28, ember: 0xe0ad5a }, // 3 아르케 유적
];

/**
 * Procedural tiled backdrop: a dark base with a few seam-tolerant cracks and
 * embers. The crack/ember geometry is fixed (non-random) so tiles seam cleanly;
 * only the palette changes per planet.
 */
function backgroundTexture(renderer: Renderer, pal: BackdropPalette): Texture {
  const S = 256;
  const g = new Graphics();
  g.rect(0, 0, S, S).fill({ color: pal.base });
  const cracks: [number, number][][] = [
    [[20, 0], [60, 70], [40, 140], [90, 210], [70, 256]],
    [[180, 0], [150, 60], [200, 120], [170, 200], [210, 256]],
    [[0, 120], [80, 150], [140, 110], [220, 160], [256, 130]],
  ];
  for (const line of cracks) {
    const [first, ...rest] = line;
    if (first === undefined) continue;
    g.moveTo(first[0], first[1]);
    for (const [x, y] of rest) g.lineTo(x, y);
    g.stroke({ color: pal.crackUnder, width: 4, alpha: 0.9 });
    g.moveTo(first[0], first[1]);
    for (const [x, y] of rest) g.lineTo(x, y);
    g.stroke({ color: pal.crackOver, width: 1.5, alpha: 0.7 });
  }
  const embers: [number, number][] = [
    [45, 40], [120, 80], [200, 50], [30, 190], [160, 170], [230, 220], [90, 130], [180, 240],
  ];
  for (const [x, y] of embers) g.circle(x, y, 1.5).fill({ color: pal.ember, alpha: 0.6 });
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

/** Per-planet boss placeholder palette (dark hull + molten/energy core). */
const BOSS_PALETTES: readonly [number, number][] = [
  [0x7a1410, 0xff5a1e], // 0 카르곤 용암 요새
  [0x1f5a12, 0x9bd94a], // 1 베르단 여왕
  [0x123a5a, 0x7ad3f7], // 2 니플헤임 기함
  [0x5a3a12, 0xf0c268], // 3 아르케 오벨리스크
];

/** Large hexagonal boss placeholder — dark hull ring + bright inner core (2x). */
function bossTexture(renderer: Renderer, hull: number, core: number): Texture {
  const g = new Graphics();
  drawHex(g, 128, hull);
  drawHex(g, 80, core);
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

/**
 * Floor loot placeholder — a neutral gold diamond glyph with a bright rim. The
 * renderer tints this by rarity code, so the sprite itself stays rarity-neutral
 * (a real `loot.png` overrides it and is tinted the same way).
 */
function lootTexture(renderer: Renderer): Texture {
  const g = new Graphics();
  drawDiamond(g, 22, 0xffcf4a);
  g.circle(0, 0, 6).fill({ color: 0xffffff, alpha: 0.85 });
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

/** Procedural death burst fallback: layered orange radial flare. */
function explosionTexture(renderer: Renderer): Texture {
  const g = new Graphics();
  g.circle(0, 0, 22).fill({ color: 0xff7a1a, alpha: 0.35 });
  g.circle(0, 0, 14).fill({ color: 0xffb020, alpha: 0.7 });
  g.circle(0, 0, 6).fill({ color: 0xffffff, alpha: 0.9 });
  const tex = renderer.generateTexture(g);
  g.destroy();
  return tex;
}

/** Synchronous procedural texture set — bullets, fallbacks, and the bench path. */
export function createPlaceholderTextures(renderer: Renderer): PlaceholderTextures {
  const playerG = new Graphics();
  drawTriangle(playerG, 36, 0x39d0ff); // cyan — friendly (readability rule); 2x scale

  // Friendly bullet: white core + cyan outline.
  const bulletG = new Graphics();
  bulletG.circle(0, 0, 5).fill({ color: 0xffffff }).stroke({ color: 0x39d0ff, width: 2, alignment: 0 });

  // Enemy bullet: white core + hot-red outline (hostile fire readability).
  const enemyBulletG = new Graphics();
  enemyBulletG
    .circle(0, 0, 5)
    .fill({ color: 0xffffff })
    .stroke({ color: 0xff2233, width: 2, alignment: 0 });

  const gemG = new Graphics();
  drawDiamond(gemG, 16, 0x66ff88); // 2x scale

  // Supply raider: a wide neutral transport (amber outline, dark hull); 2x scale.
  const supplyG = new Graphics();
  supplyG
    .roundRect(-92, -52, 184, 104, 16)
    .fill({ color: 0x2a3550 })
    .stroke({ color: 0xffcc44, width: 3, alignment: 0 });
  supplyG.rect(-60, -24, 120, 48).fill({ color: 0x4a5a80 });

  // Cover wall: a 64x64 basalt tile with a lighter rim. Drawn as a unit square
  // (the renderer stretches it to each wall's exact AABB), so a border reads on
  // any size. Solid, opaque — visually distinct from the darker backdrop.
  const wallG = new Graphics();
  wallG
    .rect(-32, -32, 64, 64)
    .fill({ color: 0x565b6e })
    .stroke({ color: 0x9aa2bd, width: 4, alignment: 0 });

  // Destructible: an amber crate with a cross brace (reads as "shootable").
  const destructibleG = new Graphics();
  destructibleG
    .rect(-40, -40, 80, 80)
    .fill({ color: 0x8a5a1e })
    .stroke({ color: 0xffcc55, width: 4, alignment: 0 });
  destructibleG.moveTo(-40, -40).lineTo(40, 40).moveTo(40, -40).lineTo(-40, 40).stroke({
    color: 0xffcc55,
    width: 3,
  });

  // Magnet emitter: cyan concentric rings (evokes an attraction field).
  const magnetG = new Graphics();
  magnetG.circle(0, 0, 40).stroke({ color: 0x39d0ff, width: 5, alignment: 0 });
  magnetG.circle(0, 0, 24).stroke({ color: 0x8ae7ff, width: 4, alignment: 0 });
  magnetG.circle(0, 0, 8).fill({ color: 0x39d0ff });

  // Bomb device: red core with a spiked warning ring.
  const bombG = new Graphics();
  bombG.circle(0, 0, 40).fill({ color: 0x2a0e0e }).stroke({ color: 0xff3322, width: 5, alignment: 0 });
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    bombG.moveTo(Math.cos(a) * 40, Math.sin(a) * 40).lineTo(Math.cos(a) * 54, Math.sin(a) * 54);
  }
  bombG.stroke({ color: 0xffb020, width: 4 });
  bombG.circle(0, 0, 14).fill({ color: 0xff5522 });

  // Turret pickup: green hex with a barrel nub (reads as a deployable ally).
  const turretG = new Graphics();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const x = Math.cos(a) * 38;
    const y = Math.sin(a) * 38;
    if (i === 0) turretG.moveTo(x, y);
    else turretG.lineTo(x, y);
  }
  turretG.closePath().fill({ color: 0x1f7a4a }).stroke({ color: 0x66ffaa, width: 4, alignment: 0 });
  turretG.rect(-6, -46, 12, 20).fill({ color: 0x66ffaa });

  const textures: PlaceholderTextures = {
    player: renderer.generateTexture(playerG),
    bullet: renderer.generateTexture(bulletG),
    enemyBullet: renderer.generateTexture(enemyBulletG),
    gem: renderer.generateTexture(gemG),
    enemy: ENEMY_STYLE.map((s) => enemyTexture(renderer, s)),
    boss: BOSS_PALETTES.map(([hull, core]) => bossTexture(renderer, hull, core)),
    supply: renderer.generateTexture(supplyG),
    parachute: null, // only populated when fx_parachute.png loads (loadGameTextures)
    loot: lootTexture(renderer),
    explosion: explosionTexture(renderer),
    background: BACKDROP_PALETTES.map((p) => backgroundTexture(renderer, p)),
    wall: renderer.generateTexture(wallG),
    destructible: renderer.generateTexture(destructibleG),
    magnetEmitter: renderer.generateTexture(magnetG),
    bombDevice: renderer.generateTexture(bombG),
    turretPickup: renderer.generateTexture(turretG),
  };

  playerG.destroy();
  bulletG.destroy();
  enemyBulletG.destroy();
  gemG.destroy();
  supplyG.destroy();
  wallG.destroy();
  destructibleG.destroy();
  magnetG.destroy();
  bombG.destroy();
  turretG.destroy();

  return textures;
}

// Eagerly resolve URLs for whatever PNGs actually exist in assets/. Missing
// files simply do not appear here, so unfilled slots keep their placeholder.
const ASSET_URLS = import.meta.glob('../../assets/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function assetUrl(basename: string): string | undefined {
  for (const key in ASSET_URLS) {
    if (key.endsWith(`/${basename}`)) return ASSET_URLS[key];
  }
  return undefined;
}

/** Load one PNG as a nearest-filtered texture; null on any failure (graceful). */
async function tryLoad(basename: string): Promise<Texture | null> {
  const url = assetUrl(basename);
  if (url === undefined) return null;
  try {
    const tex = await Assets.load<Texture>(url);
    tex.source.scaleMode = 'nearest';
    return tex;
  } catch {
    return null;
  }
}

/**
 * Build the full texture set, overriding placeholder slots with real sprites
 * where the asset loads. Any load failure keeps the procedural placeholder.
 */
export async function loadGameTextures(renderer: Renderer): Promise<PlaceholderTextures> {
  const tex = createPlaceholderTextures(renderer);

  // Enemy filenames by global typeIndex (0..21). 0~3 keep the M1 names; 4~21
  // follow the planet/role contract `enemy_<planet>_<role>` with elites tagged
  // `elite_<role>` (see data/planets — order == ENEMY_BY_TYPE). Any missing file
  // silently keeps its planet-tinted shape placeholder.
  const enemyFiles = [
    'enemy_charger.png', // 0
    'enemy_mortar.png', // 1
    'enemy_lavaspring.png', // 2
    'enemy_support.png', // 3
    'enemy_berdan_charger.png', // 4
    'enemy_berdan_gunner.png', // 5
    'enemy_berdan_special.png', // 6
    'enemy_berdan_support.png', // 7
    'enemy_berdan_elite_gunner.png', // 8
    'enemy_berdan_elite_charger.png', // 9
    'enemy_niflheim_charger.png', // 10
    'enemy_niflheim_gunner.png', // 11
    'enemy_niflheim_special.png', // 12
    'enemy_niflheim_support.png', // 13
    'enemy_niflheim_elite_gunner.png', // 14
    'enemy_niflheim_elite_charger.png', // 15
    'enemy_arke_charger.png', // 16
    'enemy_arke_gunner.png', // 17
    'enemy_arke_special.png', // 18
    'enemy_arke_support.png', // 19
    'enemy_arke_elite_gunner.png', // 20
    'enemy_arke_elite_charger.png', // 21
  ];

  // Boss + backdrop by planetIndex (0 카르곤 .. 3 아르케). Slot 0 keeps the M1
  // filenames (`boss.png`, `bg_kargon.png`); others follow the planet contract.
  const bossFiles = ['boss.png', 'boss_berdan.png', 'boss_niflheim.png', 'boss_arke.png'];
  const bgFiles = ['bg_kargon.png', 'bg_berdan.png', 'bg_niflheim.png', 'bg_arke.png'];

  const [
    player,
    gem,
    explosion,
    loot,
    parachute,
    supply,
    wall,
    destructible,
    magnetEmitter,
    bombDevice,
    turretPickup,
    bosses,
    backgrounds,
    enemies,
  ] = await Promise.all([
    tryLoad('player.png'),
    tryLoad('gem.png'),
    tryLoad('fx_explosion.png'),
    tryLoad('loot.png'),
    tryLoad('fx_parachute.png'),
    tryLoad('supply.png'),
    tryLoad('wall.png'),
    tryLoad('destructible.png'),
    tryLoad('magnet_emitter.png'),
    tryLoad('bomb_device.png'),
    tryLoad('turret_pickup.png'),
    Promise.all(bossFiles.map((f) => tryLoad(f))),
    Promise.all(bgFiles.map((f) => tryLoad(f))),
    Promise.all(enemyFiles.map((f) => tryLoad(f))),
  ]);

  if (player !== null) tex.player = player;
  if (gem !== null) tex.gem = gem;
  if (explosion !== null) tex.explosion = explosion;
  if (loot !== null) tex.loot = loot;
  if (parachute !== null) tex.parachute = parachute;
  // Scroll-map gimmicks: PNG overrides the shape placeholder; missing file keeps
  // the procedural fallback (regression 0). All render fixedFacing (no rotation);
  // wall stretches to its AABB unit-square, supply keeps the fx_parachute child.
  if (supply !== null) tex.supply = supply;
  if (wall !== null) tex.wall = wall;
  if (destructible !== null) tex.destructible = destructible;
  if (magnetEmitter !== null) tex.magnetEmitter = magnetEmitter;
  if (bombDevice !== null) tex.bombDevice = bombDevice;
  if (turretPickup !== null) tex.turretPickup = turretPickup;
  bosses.forEach((t, i) => {
    if (t !== null) tex.boss[i] = t;
  });
  backgrounds.forEach((t, i) => {
    if (t !== null) tex.background[i] = t;
  });
  enemies.forEach((t, i) => {
    if (t !== null) tex.enemy[i] = t;
  });

  return tex;
}
