/**
 * Renders simulation snapshots to PixiJS sprites with interpolation.
 *
 * The sim advances at a fixed 60 Hz, but the display may refresh at any rate.
 * Each render frame we interpolate between the previous and current sim snapshot
 * by `alpha` (the fractional progress toward the next tick), so motion looks
 * smooth regardless of monitor refresh. The sim itself is never touched here —
 * render reads immutable snapshots only (sim/render separation, ADR-0005).
 */

import { Container, Sprite } from 'pixi.js';
import type { WorldSnapshot, EntitySnapshot } from '../sim/snapshot.js';
import type { PlaceholderTextures } from './textures.js';

interface TrackedSprite {
  sprite: Sprite;
  seenTick: number;
}

export class EntityRenderer {
  readonly layer = new Container();
  private readonly sprites = new Map<number, TrackedSprite>();
  private frameTick = 0;

  constructor(private readonly textures: PlaceholderTextures) {}

  private textureFor(kind: EntitySnapshot['kind']) {
    return kind === 'player' ? this.textures.player : this.textures.dummy;
  }

  /**
   * Draw the world, interpolating each entity between `prev` and `curr` by
   * `alpha` in [0, 1]. Entities absent from `curr` are removed.
   */
  render(prev: WorldSnapshot, curr: WorldSnapshot, alpha: number): void {
    this.frameTick++;
    const prevById = new Map<number, EntitySnapshot>();
    for (const e of prev.entities) prevById.set(e.id, e);

    for (const e of curr.entities) {
      let tracked = this.sprites.get(e.id);
      if (tracked === undefined) {
        const sprite = new Sprite(this.textureFor(e.kind));
        sprite.anchor.set(0.5);
        this.layer.addChild(sprite);
        tracked = { sprite, seenTick: this.frameTick };
        this.sprites.set(e.id, tracked);
      }
      tracked.seenTick = this.frameTick;

      const p = prevById.get(e.id) ?? e;
      tracked.sprite.x = p.x + (e.x - p.x) * alpha;
      tracked.sprite.y = p.y + (e.y - p.y) * alpha;
      tracked.sprite.rotation = e.angle;
    }

    // Remove sprites for entities no longer present.
    for (const [id, tracked] of this.sprites) {
      if (tracked.seenTick !== this.frameTick) {
        tracked.sprite.destroy();
        this.sprites.delete(id);
      }
    }
  }

  destroy(): void {
    for (const { sprite } of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
    this.layer.destroy({ children: true });
  }
}
