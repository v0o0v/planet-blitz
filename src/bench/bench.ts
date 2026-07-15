/**
 * Performance bench scene (entered via ?bench=1).
 *
 * Fixed stress scenario reused by M1 Phase 4's 60fps target: 2,000 live bullets
 * rendered through a ParticleContainer plus 200 dummy enemy sprites, all moving
 * every frame. This exercises the ParticleContainer path that real bullet-hell
 * combat will depend on (ADR-0001). FPS is shown on-screen and logged.
 *
 * NOTE: this is a *render* throughput harness, not the deterministic sim. It uses
 * plain Math.random for spawn scatter on purpose — no sim state is involved.
 */

import { ParticleContainer, Particle, Sprite, Container } from 'pixi.js';
import { createGameApp, DESIGN_WIDTH, DESIGN_HEIGHT } from '../render/app.js';
import { createPlaceholderTextures } from '../render/textures.js';
import { FpsMeter } from '../render/fpsMeter.js';
import { Hud } from '../ui/hud.js';

const BULLET_COUNT = 2000;
const ENEMY_COUNT = 200;

interface BulletState {
  particle: Particle;
  vx: number;
  vy: number;
}

interface EnemyState {
  sprite: Sprite;
  vx: number;
  vy: number;
}

export async function runBench(mount: HTMLElement): Promise<void> {
  const gameApp = await createGameApp(mount);
  const hud = new Hud();
  const textures = createPlaceholderTextures(gameApp.app.renderer);
  const fps = new FpsMeter();

  const rand = (min: number, max: number): number => min + Math.random() * (max - min);

  // --- 2,000 bullets in a ParticleContainer ---
  const bulletContainer = new ParticleContainer({
    dynamicProperties: { position: true, rotation: false, color: false },
  });
  gameApp.stage.addChild(bulletContainer);

  const bullets: BulletState[] = [];
  for (let i = 0; i < BULLET_COUNT; i++) {
    const particle = new Particle({
      texture: textures.bullet,
      x: rand(0, DESIGN_WIDTH),
      y: rand(0, DESIGN_HEIGHT),
      anchorX: 0.5,
      anchorY: 0.5,
    });
    bulletContainer.addParticle(particle);
    const angle = rand(0, Math.PI * 2);
    const speed = rand(120, 420);
    bullets.push({ particle, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed });
  }

  // --- 200 enemy sprites ---
  const enemyLayer = new Container();
  gameApp.stage.addChild(enemyLayer);
  const enemies: EnemyState[] = [];
  for (let i = 0; i < ENEMY_COUNT; i++) {
    const sprite = new Sprite(textures.enemy);
    sprite.anchor.set(0.5);
    sprite.x = rand(0, DESIGN_WIDTH);
    sprite.y = rand(0, DESIGN_HEIGHT);
    enemyLayer.addChild(sprite);
    const angle = rand(0, Math.PI * 2);
    const speed = rand(40, 160);
    enemies.push({ sprite, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed });
  }

  const wrap = (v: number, max: number): number => (v < 0 ? v + max : v >= max ? v - max : v);

  gameApp.app.ticker.add((ticker) => {
    const dt = ticker.deltaMS / 1000;
    for (const b of bullets) {
      b.particle.x = wrap(b.particle.x + b.vx * dt, DESIGN_WIDTH);
      b.particle.y = wrap(b.particle.y + b.vy * dt, DESIGN_HEIGHT);
    }
    bulletContainer.update();
    for (const e of enemies) {
      e.sprite.x = wrap(e.sprite.x + e.vx * dt, DESIGN_WIDTH);
      e.sprite.y = wrap(e.sprite.y + e.vy * dt, DESIGN_HEIGHT);
    }
    const f = fps.tick(dt);
    hud.set(
      `BENCH  bullets=${BULLET_COUNT}  enemies=${ENEMY_COUNT}\nFPS ${f.toFixed(1)}`,
    );
  });

  // Periodic console log for headless/perf capture.
  setInterval(() => {
    console.log(`[bench] fps=${fps.fps.toFixed(1)} bullets=${BULLET_COUNT} enemies=${ENEMY_COUNT}`);
  }, 1000);
}
