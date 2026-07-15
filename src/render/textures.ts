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
  /** Enemy textures indexed by role typeIndex (0 charger .. 3 support). */
  enemy: Texture[];
  /** Boss (large lava-fortress). */
  boss: Texture;
  /** Supply raider transport. */
  supply: Texture;
  /** Death burst effect (render-only juice). */
  explosion: Texture;
  /** Tileable volcanic arena backdrop. */
  background: Texture;
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

/** Per-role colour + base radius (matches data/enemies typeIndex order). */
// Radii match the 2x-scale sim hitboxes (plan D1) so shape placeholders line up
// with the enlarged entities when no PixelLab asset is present.
const ENEMY_STYLE: { color: number; radius: number; shape: 'tri' | 'square' | 'diamond' | 'hex' }[] = [
  { color: 0xff5533, radius: 36, shape: 'tri' }, // 0 charger — aggressive dart
  { color: 0xffb020, radius: 32, shape: 'square' }, // 1 gunner
  { color: 0xff3300, radius: 44, shape: 'diamond' }, // 2 lava spring
  { color: 0x33ffcc, radius: 30, shape: 'hex' }, // 3 support
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

/** Procedural volcanic backdrop tile: dark basalt with a few molten cracks. */
function backgroundTexture(renderer: Renderer): Texture {
  const S = 256;
  const g = new Graphics();
  g.rect(0, 0, S, S).fill({ color: 0x0d0a12 });
  // Fixed (non-random) molten crack polylines for a seam-tolerant volcanic look.
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
    g.stroke({ color: 0x4a1608, width: 4, alpha: 0.9 });
    g.moveTo(first[0], first[1]);
    for (const [x, y] of rest) g.lineTo(x, y);
    g.stroke({ color: 0xff5a1e, width: 1.5, alpha: 0.7 });
  }
  // Scattered embers (fixed positions).
  const embers: [number, number][] = [
    [45, 40], [120, 80], [200, 50], [30, 190], [160, 170], [230, 220], [90, 130], [180, 240],
  ];
  for (const [x, y] of embers) g.circle(x, y, 1.5).fill({ color: 0xffb020, alpha: 0.6 });
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

  // Boss: large lava-fortress hexagon, dark-red body with a molten outline (2x).
  const bossG = new Graphics();
  drawHex(bossG, 128, 0x7a1410);
  drawHex(bossG, 80, 0xff5a1e);

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
    boss: renderer.generateTexture(bossG),
    supply: renderer.generateTexture(supplyG),
    explosion: explosionTexture(renderer),
    background: backgroundTexture(renderer),
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
  bossG.destroy();
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

  const enemyFiles = [
    'enemy_charger.png',
    'enemy_mortar.png',
    'enemy_lavaspring.png',
    'enemy_support.png',
  ];

  const [player, boss, gem, explosion, ...enemies] = await Promise.all([
    tryLoad('player.png'),
    tryLoad('boss.png'),
    tryLoad('gem.png'),
    tryLoad('fx_explosion.png'),
    ...enemyFiles.map((f) => tryLoad(f)),
  ]);

  if (player !== null) tex.player = player;
  if (boss !== null) tex.boss = boss;
  if (gem !== null) tex.gem = gem;
  if (explosion !== null) tex.explosion = explosion;
  enemies.forEach((t, i) => {
    if (t !== null) tex.enemy[i] = t;
  });

  return tex;
}
