/**
 * Minimal DOM HUD overlay (ADR-0001: RPG/UI is DOM, not canvas).
 * M1 Phase 1 shows debug telemetry; real HUD (HP, XP, combo, boss bar) is Phase 3.
 */

export class Hud {
  private readonly el: HTMLElement;

  constructor(elementId = 'hud') {
    const el = document.getElementById(elementId);
    if (el === null) throw new Error(`HUD element #${elementId} not found`);
    this.el = el;
  }

  set(text: string): void {
    this.el.textContent = text;
  }
}
