/**
 * PixiJS application bootstrap + letterbox scaling.
 *
 * The game is authored in a fixed 1920x1080 design space. `fitToWindow` scales a
 * root "stage" container to fit the browser window while preserving that aspect
 * ratio (letterbox bars on the excess axis). When the window is large enough to
 * upscale, an integer scale factor is used so pixel-art stays crisp (ADR-0001 /
 * GDD §10 pixel scale rule).
 */

import { Application, Container, Graphics, TextureSource } from 'pixi.js';

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
  // 캔버스 우클릭 메뉴 억제 — 격납고가 우클릭을 조작(인벤토리 → 보관함 이동)에 쓴다. 브라우저
  // 기본 메뉴가 뜨면 그 조작이 매번 메뉴에 가려진다. 게임 캔버스의 표준 처리이고 DOM 오버레이
  // (설정·정산 등)는 캔버스 밖이라 영향이 없다.
  app.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const stage = new Container();
  app.stage.addChild(stage);

  // 디자인 스페이스(1920×1080) 밖은 **잘라낸다**.
  //
  // ⚠️ 레터박스 띠는 "빈 공간"이 아니라 **stage 가 계속 그리는 영역**이다. stage 는 창 중앙에
  // 1920×1080 만큼 자리를 잡을 뿐 클립되지 않으므로, 그 밖으로 삐져나온 자식(카메라 팬 레이어의
  // 월드 스프라이트)이 띠 위에 그대로 보인다. 격납고 같은 전체화면 UI 는 배경을 정확히
  // 1920×1080 으로만 깔기 때문에 위/아래 띠에 **직전 게임 화면이 비쳐 보였다**(사용자 신고
  // 2026-07-27). 화면비가 16:9 가 아닌 창에서 항상 재현된다.
  //
  // 개별 화면마다 배경을 키우는 대신 루트에서 한 번 잘라 모든 화면(격납고·타이틀·정산·런)에
  // 같은 프레이밍을 강제한다. 마스크는 stage 의 자식이라 stage 변환을 그대로 받는다 —
  // fitToWindow 가 스케일·위치를 바꿔도 마스크는 항상 디자인 사각형에 정확히 붙는다.
  const frameMask = new Graphics().rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: 0xffffff });
  stage.addChild(frameMask);
  stage.mask = frameMask;

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
