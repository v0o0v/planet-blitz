/**
 * Rolling FPS meter (render layer — wall-clock time is fine here, unlike the
 * sim core). Used by the game HUD and the performance bench scene.
 */
export class FpsMeter {
  private frames = 0;
  private elapsed = 0;
  private _fps = 0;

  /** Feed the frame delta in seconds; returns the current smoothed FPS. */
  tick(deltaSeconds: number): number {
    this.frames++;
    this.elapsed += deltaSeconds;
    if (this.elapsed >= 0.5) {
      this._fps = this.frames / this.elapsed;
      this.frames = 0;
      this.elapsed = 0;
    }
    return this._fps;
  }

  get fps(): number {
    return this._fps;
  }
}
