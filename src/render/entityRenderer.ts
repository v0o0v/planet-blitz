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
import type { EntityKind } from '../sim/entities.js';
import type { PlaceholderTextures } from './textures.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from './app.js';

interface TrackedSprite {
  sprite: Sprite;
  seenTick: number;
  kind: EntityKind;
}

interface DeathEffect {
  sprite: Sprite;
  life: number;
}

const HAZARD_MORTAR = 0;
/** Sprite display diameter relative to the sim hitbox (art reads a bit larger). */
const ART_SCALE = 1.5;
/** Frames a death burst stays alive (render-only, not sim time). */
const EFFECT_LIFE = 24;

export class EntityRenderer {
  readonly layer = new Container();
  private readonly sprites = new Map<number, TrackedSprite>();
  private readonly spriteLayer = new Container();
  private readonly effectLayer = new Container();
  private readonly effects: DeathEffect[] = [];
  private readonly overlay = new Graphics();
  private frameTick = 0;

  constructor(private readonly textures: PlaceholderTextures) {
    // Draw order (bottom → top): hazard/beam overlay, entity sprites, death bursts.
    this.layer.addChild(this.overlay);
    this.layer.addChild(this.spriteLayer);
    this.layer.addChild(this.effectLayer);
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
      case 'boss':
        return this.textures.boss;
      case 'supply':
        return this.textures.supply;
      case 'wall':
        return this.textures.wall;
      case 'destructible':
        return this.textures.destructible;
      case 'magnetEmitter':
        return this.textures.magnetEmitter;
      case 'bombDevice':
        return this.textures.bombDevice;
      case 'turretPickup':
        return this.textures.turretPickup;
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
    // Camera follow: pan the whole layer so the interpolated camera (= player)
    // sits at the viewport centre. Sprites keep their absolute world coordinates;
    // only the layer is translated (vampire-survivors-style scrolling).
    const camX = prev.cameraX + (curr.cameraX - prev.cameraX) * alpha;
    const camY = prev.cameraY + (curr.cameraY - prev.cameraY) * alpha;
    this.layer.position.set(DESIGN_WIDTH / 2 - camX, DESIGN_HEIGHT / 2 - camY);
    this.drawOverlay(curr);
    this.updateEffects();

    const prevById = new Map<number, EntitySnapshot>();
    for (const e of prev.entities) prevById.set(e.id, e);

    for (const e of curr.entities) {
      if (e.kind === 'hazard') continue; // drawn in the overlay
      let tracked = this.sprites.get(e.id);
      if (tracked === undefined) {
        const sprite = new Sprite(this.textureFor(e));
        sprite.anchor.set(0.5);
        if (e.kind === 'wall') {
          // Walls render at their EXACT AABB (radius = half-width, aabbH =
          // half-height) — no ART_SCALE, so the cover the player sees matches the
          // collision box exactly.
          sprite.setSize(e.radius * 2, e.aabbH * 2);
        } else {
          // Real sprites are 64/128px; scale to the sim hitbox so art matches
          // collisions (player r16 → 48px, matching the GDD ship size).
          const size = e.radius * 2 * ART_SCALE;
          sprite.setSize(size, size);
        }
        this.spriteLayer.addChild(sprite);
        tracked = { sprite, seenTick: this.frameTick, kind: e.kind };
        this.sprites.set(e.id, tracked);
      }
      tracked.seenTick = this.frameTick;

      const p = prevById.get(e.id) ?? e;
      tracked.sprite.x = p.x + (e.x - p.x) * alpha;
      tracked.sprite.y = p.y + (e.y - p.y) * alpha;
      // Gems, boss, supply and the static gimmicks keep a fixed facing; others
      // face their travel/aim angle.
      const fixedFacing =
        e.kind === 'gem' ||
        e.kind === 'boss' ||
        e.kind === 'supply' ||
        e.kind === 'wall' ||
        e.kind === 'destructible' ||
        e.kind === 'magnetEmitter' ||
        e.kind === 'bombDevice' ||
        e.kind === 'turretPickup';
      tracked.sprite.rotation = fixedFacing ? 0 : e.angle;

      if (e.kind === 'boss') {
        // Phase transition = white flash; overheat = bright red pulse (spec).
        if (e.flash) {
          tracked.sprite.tint = (this.frameTick >> 2) % 2 === 0 ? 0xffffff : 0xff8080;
        } else if (e.active) {
          const pulse = 0.5 + 0.5 * Math.sin(this.frameTick * 0.4);
          tracked.sprite.tint = 0xff4020;
          tracked.sprite.alpha = 0.8 + 0.2 * pulse;
        } else {
          tracked.sprite.tint = 0xffffff;
          tracked.sprite.alpha = 1;
        }
      }
    }

    for (const [id, tracked] of this.sprites) {
      if (tracked.seenTick !== this.frameTick) {
        // A combat unit vanishing = a kill: leave a brief death burst behind.
        if (tracked.kind === 'enemy' || tracked.kind === 'boss') {
          this.spawnExplosion(tracked.sprite.x, tracked.sprite.y, tracked.kind === 'boss' ? 3 : 1);
        }
        tracked.sprite.destroy();
        this.sprites.delete(id);
      }
    }
  }

  private spawnExplosion(x: number, y: number, scale: number): void {
    const sprite = new Sprite(this.textures.explosion);
    sprite.anchor.set(0.5);
    sprite.x = x;
    sprite.y = y;
    sprite.setSize(46 * scale, 46 * scale);
    this.effectLayer.addChild(sprite);
    this.effects.push({ sprite, life: EFFECT_LIFE });
  }

  private updateEffects(): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i];
      if (fx === undefined) continue;
      fx.life--;
      if (fx.life <= 0) {
        fx.sprite.destroy();
        this.effects.splice(i, 1);
        continue;
      }
      const t = fx.life / EFFECT_LIFE; // 1 → 0
      fx.sprite.alpha = t;
      fx.sprite.scale.set(fx.sprite.scale.x * (1 + 0.04 * (1 - t)));
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
    for (const { sprite } of this.effects) sprite.destroy();
    this.effects.length = 0;
    this.overlay.destroy();
    this.layer.destroy({ children: true });
  }
}
