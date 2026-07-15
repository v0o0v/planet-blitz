/**
 * Placeholder textures generated from PixiJS Graphics.
 *
 * M1 uses primitive shapes so gameplay can be validated before real pixel-art
 * assets exist (they are swapped in during Phase 4). Textures are generated once
 * and reused; the bullet texture in particular is shared by thousands of
 * ParticleContainer particles.
 */

import { Graphics, type Renderer, type Texture } from 'pixi.js';

export interface PlaceholderTextures {
  player: Texture;
  dummy: Texture;
  bullet: Texture;
  enemy: Texture;
}

function drawTriangle(g: Graphics, r: number, color: number): void {
  g.moveTo(r, 0)
    .lineTo(-r * 0.8, r * 0.7)
    .lineTo(-r * 0.8, -r * 0.7)
    .lineTo(r, 0)
    .fill({ color })
    .stroke({ color: 0xffffff, width: 2, alignment: 0 });
}

function drawCircle(g: Graphics, r: number, color: number, outline = 0xffffff): void {
  g.circle(0, 0, r)
    .fill({ color })
    .stroke({ color: outline, width: 2, alignment: 0 });
}

export function createPlaceholderTextures(renderer: Renderer): PlaceholderTextures {
  const playerG = new Graphics();
  drawTriangle(playerG, 18, 0x39d0ff); // cyan — friendly (readability rule)

  const dummyG = new Graphics();
  drawCircle(dummyG, 14, 0xff4d8d); // magenta/red — hostile

  const enemyG = new Graphics();
  drawCircle(enemyG, 12, 0xff7a3d);

  // Bullet: white core + dark outline for readability against pastel bg.
  const bulletG = new Graphics();
  bulletG.circle(0, 0, 5).fill({ color: 0xffffff }).stroke({ color: 0xff2266, width: 2, alignment: 0 });

  const textures: PlaceholderTextures = {
    player: renderer.generateTexture(playerG),
    dummy: renderer.generateTexture(dummyG),
    enemy: renderer.generateTexture(enemyG),
    bullet: renderer.generateTexture(bulletG),
  };

  playerG.destroy();
  dummyG.destroy();
  enemyG.destroy();
  bulletG.destroy();

  return textures;
}
