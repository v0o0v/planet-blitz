/**
 * Keyboard + mouse input -> per-tick sim InputFrame.
 *
 * This layer lives entirely outside the sim core. It samples live device state
 * and produces an {@link InputFrame} that the game loop feeds to `stepWorld` and
 * records into the replay log. It must never write to sim state directly.
 */

import type { InputFrame } from '../sim/world.js';
import { packPowerupPick } from '../sim/world.js';
import { atan2 } from '../sim/math.js';
import type { GameApp } from '../render/app.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../render/app.js';

export class InputController {
  private readonly keys = new Set<string>();
  private mouseClientX = 0;
  private mouseClientY = 0;
  private dashQueued = false;
  /** Pending powerup pick (offer index 0..2), consumed by the next sample. */
  private powerupPick: number | null = null;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
    if (e.code === 'Space') {
      this.dashQueued = true;
      e.preventDefault();
    }
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };
  private readonly onMouseMove = (e: MouseEvent): void => {
    this.mouseClientX = e.clientX;
    this.mouseClientY = e.clientY;
  };

  constructor(private readonly gameApp: GameApp) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
  }

  /** Queue a powerup pick (offer index 0..2). Consumed by the next sample. */
  queuePowerupPick(index: number): void {
    this.powerupPick = index;
  }

  /**
   * Sample the current input for one sim tick. Consumes the queued dash so a
   * single Space press maps to exactly one dash request, and any queued powerup
   * pick (packed into `special` for the replay log).
   */
  sample(playerX: number, playerY: number): InputFrame {
    let moveX = 0;
    let moveY = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveY -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveY += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) moveX -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) moveX += 1;

    // Mouse → world coordinates. `clientToDesign` maps the cursor into the fixed
    // 1920x1080 design viewport; the camera (= player) sits at the viewport
    // centre, so undo that offset to recover where the cursor points in the
    // infinite world. Aim is then a world-space angle, keeping auto-aim and dash
    // consistent with the scrolled camera.
    const design = this.gameApp.clientToDesign(this.mouseClientX, this.mouseClientY);
    const worldX = design.x - DESIGN_WIDTH / 2 + playerX;
    const worldY = design.y - DESIGN_HEIGHT / 2 + playerY;
    const aim = atan2(worldY - playerY, worldX - playerX);

    const dash = this.dashQueued;
    this.dashQueued = false;

    let special = 0;
    if (this.powerupPick !== null) {
      special = packPowerupPick(this.powerupPick);
      this.powerupPick = null;
    }

    return { moveX, moveY, aim, dash, special };
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
  }
}
