/**
 * Renders simulation snapshots to PixiJS sprites with interpolation.
 *
 * The sim advances at a fixed 60 Hz, but the display may refresh at any rate.
 * Each render frame we interpolate between the previous and current sim snapshot
 * by `alpha` (the fractional progress toward the next tick), so motion looks
 * smooth regardless of monitor refresh. The sim itself is never touched here —
 * render reads immutable snapshots only (sim/render separation, ADR-0005).
 *
 * Sprites cover point-like entities (player, enemies, bullets, gems). Hazards
 * (telegraphed zones) and support heal beams have per-frame variable geometry,
 * so they are drawn into a Graphics overlay from the current snapshot each frame.
 */

import { Container, Graphics, Sprite } from 'pixi.js';
import type { WorldSnapshot, EntitySnapshot } from '../sim/snapshot.js';
import type { PlaceholderTextures } from './textures.js';

interface TrackedSprite {
  sprite: Sprite;
  seenTick: number;
}

const HAZARD_MORTAR = 0;

export class EntityRenderer {
  readonly layer = new Container();
  private readonly sprites = new Map<number, TrackedSprite>();
  private readonly overlay = new Graphics();
  private frameTick = 0;

  constructor(private readonly textures: PlaceholderTextures) {
    // Hazards/beams draw beneath the sprites so ships stay legible on top.
    this.layer.addChild(this.overlay);
  }

  private textureFor(e: EntitySnapshot) {
    switch (e.kind) {
      case 'player':
        return this.textures.player;
      case 'bullet':
        return this.textures.bullet;
      case 'enemyBullet':
        return this.textures.enemyBullet;
      case 'gem':
        return this.textures.gem;
      case 'enemy': {
        const arr = this.textures.enemy;
        const idx = e.enemyType >= 0 && e.enemyType < arr.length ? e.enemyType : 0;
        return arr[idx] ?? this.textures.player;
      }
      default:
        return this.textures.player;
    }
  }

  render(prev: WorldSnapshot, curr: WorldSnapshot, alpha: number): void {
    this.frameTick++;
    this.drawOverlay(curr);

    const prevById = new Map<number, EntitySnapshot>();
    for (const e of prev.entities) prevById.set(e.id, e);

    for (const e of curr.entities) {
      if (e.kind === 'hazard') continue; // drawn in the overlay
      let tracked = this.sprites.get(e.id);
      if (tracked === undefined) {
        const sprite = new Sprite(this.textureFor(e));
        sprite.anchor.set(0.5);
        this.layer.addChild(sprite);
        tracked = { sprite, seenTick: this.frameTick };
        this.sprites.set(e.id, tracked);
      }
      tracked.seenTick = this.frameTick;

      const p = prevById.get(e.id) ?? e;
      tracked.sprite.x = p.x + (e.x - p.x) * alpha;
      tracked.sprite.y = p.y + (e.y - p.y) * alpha;
      // Gems do not rotate; everything else faces its travel/aim angle.
      tracked.sprite.rotation = e.kind === 'gem' ? 0 : e.angle;
    }

    for (const [id, tracked] of this.sprites) {
      if (tracked.seenTick !== this.frameTick) {
        tracked.sprite.destroy();
        this.sprites.delete(id);
      }
    }
  }

  private drawOverlay(curr: WorldSnapshot): void {
    const g = this.overlay;
    g.clear();
    // Support heal beams.
    for (const b of curr.beams) {
      g.moveTo(b.x1, b.y1).lineTo(b.x2, b.y2).stroke({ color: 0x33ffcc, width: 3, alpha: 0.5 });
    }
    // Hazard zones: telegraph = outlined warning ring; active = filled danger.
    for (const e of curr.entities) {
      if (e.kind !== 'hazard') continue;
      const color = e.enemyType === HAZARD_MORTAR ? 0xff3355 : 0xff7a1a;
      if (e.active) {
        g.circle(e.x, e.y, e.radius).fill({ color, alpha: 0.4 }).stroke({ color, width: 2, alpha: 0.9 });
      } else {
        g.circle(e.x, e.y, e.radius).stroke({ color, width: 2, alpha: 0.85 });
      }
    }
  }

  destroy(): void {
    for (const { sprite } of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
    this.overlay.destroy();
    this.layer.destroy({ children: true });
  }
}
