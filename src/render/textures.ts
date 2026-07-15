/**
 * Placeholder textures generated from PixiJS Graphics.
 *
 * M1 uses primitive shapes so gameplay can be validated before real pixel-art
 * assets exist (they are swapped in during Phase 4). Textures are generated once
 * and reused; the bullet textures in particular are shared by thousands of
 * sprites/particles.
 *
 * Readability rule (spec): bullets are a WHITE CORE with a coloured OUTLINE —
 * friendly bullets outline cyan, enemy bullets outline hot-red — so hostile fire
 * stays legible against the arena at bullet-hell density.
 */

import { Graphics, type Renderer, type Texture } from 'pixi.js';

export interface PlaceholderTextures {
  player: Texture;
  bullet: Texture;
  enemyBullet: Texture;
  gem: Texture;
  /** Enemy textures indexed by role typeIndex (0 charger .. 3 support). */
  enemy: Texture[];
}

/** Per-role colour + base radius (matches data/enemies typeIndex order). */
const ENEMY_STYLE: { color: number; radius: number; shape: 'tri' | 'square' | 'diamond' | 'hex' }[] = [
  { color: 0xff5533, radius: 18, shape: 'tri' }, // 0 charger — aggressive dart
  { color: 0xffb020, radius: 16, shape: 'square' }, // 1 gunner
  { color: 0xff3300, radius: 22, shape: 'diamond' }, // 2 lava spring
  { color: 0x33ffcc, radius: 15, shape: 'hex' }, // 3 support
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

export function createPlaceholderTextures(renderer: Renderer): PlaceholderTextures {
  const playerG = new Graphics();
  drawTriangle(playerG, 18, 0x39d0ff); // cyan — friendly (readability rule)

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
  drawDiamond(gemG, 8, 0x66ff88);

  const textures: PlaceholderTextures = {
    player: renderer.generateTexture(playerG),
    bullet: renderer.generateTexture(bulletG),
    enemyBullet: renderer.generateTexture(enemyBulletG),
    gem: renderer.generateTexture(gemG),
    enemy: ENEMY_STYLE.map((s) => enemyTexture(renderer, s)),
  };

  playerG.destroy();
  bulletG.destroy();
  enemyBulletG.destroy();
  gemG.destroy();

  return textures;
}
