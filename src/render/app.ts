/**
 * PixiJS application bootstrap + letterbox scaling.
 *
 * The game is authored in a fixed 1920x1080 design space. `fitToWindow` scales a
 * root "stage" container to fit the browser window while preserving that aspect
 * ratio (letterbox bars on the excess axis). When the window is large enough to
 * upscale, an integer scale factor is used so pixel-art stays crisp (ADR-0001 /
 * GDD §10 pixel scale rule).
 */

import { Application, Container, TextureSource } from 'pixi.js';

export const DESIGN_WIDTH = 1920;
export const DESIGN_HEIGHT = 1080;

export interface GameApp {
  app: Application;
  /** Root container scaled/letterboxed to the design space. Add game layers here. */
  stage: Container;
  /** Convert window (client) coordinates into 1920x1080 design-space coordinates. */
  clientToDesign(clientX: number, clientY: number): { x: number; y: number };
  destroy(): void;
}

export async function createGameApp(mount: HTMLElement): Promise<GameApp> {
  // Crisp pixel-art scaling for all textures by default.
  TextureSource.defaultOptions.scaleMode = 'nearest';

  const app = new Application();
  await app.init({
    background: 0x0a0c14,
    resizeTo: window,
    antialias: false,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });
  mount.appendChild(app.canvas);

  const stage = new Container();
  app.stage.addChild(stage);

  function fitToWindow(): void {
    const w = app.renderer.width / app.renderer.resolution;
    const h = app.renderer.height / app.renderer.resolution;
    const raw = Math.min(w / DESIGN_WIDTH, h / DESIGN_HEIGHT);
    // Integer scale when upscaling (pixel-art crispness); fractional when the
    // window is smaller than the design space and we must shrink to fit.
    const scale = raw >= 1 ? Math.floor(raw) : raw;
    stage.scale.set(scale);
    stage.position.set(
      Math.round((w - DESIGN_WIDTH * scale) / 2),
      Math.round((h - DESIGN_HEIGHT * scale) / 2),
    );
  }

  fitToWindow();
  app.renderer.on('resize', fitToWindow);

  return {
    app,
    stage,
    clientToDesign(clientX, clientY) {
      const rect = app.canvas.getBoundingClientRect();
      const scale = stage.scale.x || 1;
      return {
        x: (clientX - rect.left - stage.position.x) / scale,
        y: (clientY - rect.top - stage.position.y) / scale,
      };
    },
    destroy() {
      app.renderer.off('resize', fitToWindow);
      app.destroy(true, { children: true });
    },
  };
}
