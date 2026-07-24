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
    // WebGL 고정(plan §AC-0.1; ADR-0031). WebGPU 는 규율 있는 글로우/후처리 파이프라인의
    // 셰이더·블렌드 동작이 브라우저별로 갈려 검증 부담이 크다 — 이펙트 풍성화 전 구간을
    // 단일 백엔드로 고정해 결정론적 렌더 동작을 확보한다. 픽셀 크리스프(nearest·AA off)는
    // 그대로 보존한다.
    preference: 'webgl',
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
    // Pixi v8: app.screen 은 이미 논리(CSS) 픽셀이다. renderer.width 를 resolution 으로
    // 다시 나누면 dpr>1(Windows 배율) 환경에서 스케일이 과소 계산되어 화면 우/하단이
    // 비고 UI 가 축소되는 실결함이 있었다(격납고 파일럿 검증에서 실증).
    const w = app.screen.width;
    const h = app.screen.height;
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
  // Pixi v8 의 resizeTo 경로에서 renderer 'resize' 이벤트가 리스너까지 전달되지 않는
  // 환경이 있어(창 최대화 시 우/하단 공백 + 스케일 고정 실증), window resize 를 직접
  // 구독해 다음 프레임에 재적합한다. resizeTo:window 의 실제 캔버스 리사이즈가 rAF 로
  // 지연되므로 한 프레임 뒤에 fit 해야 새 크기를 읽는다.
  const onWindowResize = (): void => {
    requestAnimationFrame(fitToWindow);
  };
  window.addEventListener('resize', onWindowResize);

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
      window.removeEventListener('resize', onWindowResize);
      app.renderer.off('resize', fitToWindow);
      app.destroy(true, { children: true });
    },
  };
}
