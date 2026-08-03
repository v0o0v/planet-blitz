/**
 * Google 공식 로그인 버튼 (Sign in with Google — 브랜딩 가이드라인 준수).
 *
 * ## 왜 게임 버튼(`PixiButton`)을 쓰지 않는가
 * 이 버튼만은 **게임의 나무 UI 를 따르면 안 된다**. Google 의 브랜딩 가이드라인은 로고·색·
 * 문구·비율을 규정하고, 그 밖의 변형을 허용하지 않는다. 사용자가 "구글에서 제공하는 기본
 * 버튼"을 요구한 이유이기도 하다 — 익숙한 모양이어야 신뢰하고 누른다.
 *
 * 지키는 것:
 *  - **라이트 테마**: 배경 `#FFFFFF`, 테두리 `#747775` 1px, 글자 `#1F1F1F`.
 *    (다크 테마도 허용되지만, 이 버튼이 얹히는 타이틀 하단 스크림이 어두워 흰 버튼이 가장
 *    또렷하다. 설정 팝업의 어두운 나무판 위에서도 같다.)
 *  - **로고**: 공식 4색 G(파랑·초록·노랑·빨강). 단색화·재도색 금지.
 *  - **문구**: "Sign in with Google" / "Google 계정으로 로그인" — 공식 번역 그대로.
 *  - **비율**: 높이 40 기준 규격(로고 18, 글자 14, 좌우 여백 12, 로고-글자 간격 10,
 *    모서리 4)을 그대로 스케일한다. 값을 따로 고르지 않고 {@link SPEC} 한 곳에서 곱한다.
 *  - **글꼴**: Roboto(없으면 Arial → sans-serif). 게임 폰트(`UI_FONT`)를 쓰지 않는다.
 *
 * ## 로고를 왜 캔버스에 굽는가
 * 4색 G 는 색이 다른 path 4개다. Pixi `Graphics` 로 베지어를 옮겨 그리는 것보다 공식 SVG
 * path 를 `Path2D` 로 그대로 그리는 편이 **형태가 원본과 어긋날 여지가 없다**. 굽는 규약은
 * `scrim.ts` 와 같다 — ⚠️ **`CanvasSource` 로 감싸야 한다**. 베이스 `TextureSource` 에 캔버스를
 * 넣으면 Pixi 가 업로드 방법을 몰라 **경고 없이 빈 텍스처**가 된다(.omc/skills 의 실측 기록).
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다.
 */

import { CanvasSource, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';

/** 높이 40 기준 공식 규격. 다른 크기는 전부 이 값을 배율로 곱해 얻는다. */
const SPEC = {
  height: 40,
  logo: 18,
  fontSize: 14,
  padX: 12,
  gap: 10,
  radius: 4,
  border: 1,
} as const;

const WHITE = 0xffffff;
const BORDER = 0x747775;
const TEXT = 0x1f1f1f;

/**
 * 공식 4색 G 의 SVG path(viewBox 48×48).
 *
 * 색과 path 를 쌍으로 둔다 — 순서는 겹침이 없어 상관없지만, Google 자산의 순서를 그대로
 * 유지해 나중에 원본과 대조하기 쉽게 한다.
 */
const LOGO_PATHS: ReadonlyArray<{ color: string; d: string }> = [
  {
    color: '#4285F4',
    d: 'M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z',
  },
  {
    color: '#34A853',
    d: 'M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z',
  },
  {
    color: '#FBBC05',
    d: 'M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z',
  },
  {
    color: '#EA4335',
    d: 'M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z',
  },
];

/** 구운 로고 텍스처(크기별 1회). 버튼이 두 화면에 뜨므로 캐시한다. */
const logoCache = new Map<number, Texture | null>();

/**
 * 공식 G 로고를 `size × size` 텍스처로 굽는다. 캔버스를 못 쓰는 환경(vitest 스텁 등)이면 null.
 *
 * `Path2D` 가 없는 환경도 있으므로(구형·스텁) 함께 방어한다 — 로고가 없으면 버튼은 글자만
 * 나오지만, 그것 때문에 화면 전체가 죽는 편이 훨씬 나쁘다.
 */
export function googleLogoTexture(size: number): Texture | null {
  const cached = logoCache.get(size);
  if (cached !== undefined) return cached;

  const made = ((): Texture | null => {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    if (typeof Path2D !== 'function') return null;
    const canvas = document.createElement('canvas');
    // 2배로 구워 축소 표시한다 — 로고는 곡선이 많아 등배로 구우면 가장자리가 거칠다.
    const px = Math.max(1, Math.round(size * 2));
    canvas.width = px;
    canvas.height = px;
    const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (ctx === null) return null;
    const s = px / 48;
    ctx.scale(s, s);
    for (const { color, d } of LOGO_PATHS) {
      ctx.fillStyle = color;
      ctx.fill(new Path2D(d));
    }
    const tex = new Texture({ source: new CanvasSource({ resource: canvas }) });
    tex.source.scaleMode = 'linear';
    return tex;
  })();

  logoCache.set(size, made);
  return made;
}

export interface GoogleSignInButtonOpts {
  /** 버튼 폭(디자인 스페이스). 내용은 가운데 정렬된다. */
  width: number;
  /** 버튼 높이. 규격 40 기준으로 모든 치수가 이 값에 비례한다. */
  height: number;
  /** 공식 문구(i18n 이 이미 로케일별 공식 번역을 준다). */
  label: string;
  onClick: () => void;
}

/**
 * 공식 규격의 Google 로그인 버튼을 만든다.
 *
 * 반환 `container` 를 화면에 붙이면 된다 — 위치는 호출부가 정한다(`PixiButton` 과 같은 관용구).
 */
export class GoogleSignInButton {
  readonly container = new Container();

  constructor(opts: GoogleSignInButtonOpts) {
    const { width: w, height: h, label } = opts;
    // 높이 40 규격을 이 버튼 높이에 맞춰 통째로 스케일한다. 개별 값을 눈대중으로 고르면
    // 비율이 어긋나 "공식 버튼처럼 생긴 다른 것"이 된다.
    const k = h / SPEC.height;
    const logoSize = SPEC.logo * k;
    const gap = SPEC.gap * k;
    const radius = SPEC.radius * k;
    const border = Math.max(1, SPEC.border * k);

    const bg = new Graphics();
    bg.roundRect(border / 2, border / 2, w - border, h - border, radius)
      .fill({ color: WHITE })
      .stroke({ color: BORDER, width: border });
    this.container.addChild(bg);

    const text = new Text({
      resolution: 2,
      text: label,
      style: {
        // 브랜딩 가이드는 Roboto Medium 을 요구한다. 없으면 Arial → 시스템 sans 로 내려간다.
        // 게임 폰트(UI_FONT)는 여기서 쓰지 않는다 — 브랜딩 위반이자 낯선 모양이 된다.
        fontFamily: ['Roboto', 'Arial', 'Helvetica', 'sans-serif'],
        fontSize: SPEC.fontSize * k,
        fontWeight: '500',
        fill: TEXT,
      },
    });

    const logoTex = googleLogoTexture(logoSize);
    const logo = logoTex === null ? null : new Sprite(logoTex);
    if (logo !== null) {
      logo.width = logoSize;
      logo.height = logoSize;
    }

    // [로고][gap][글자] 묶음을 버튼 한가운데 놓는다. 버튼이 내용보다 넓을 때 왼쪽에 붙이면
    // 오른쪽이 텅 비어 눌리는 영역이 어디까지인지 읽히지 않는다.
    const groupW = (logo === null ? 0 : logoSize + gap) + text.width;
    let x = (w - groupW) / 2;
    if (logo !== null) {
      logo.position.set(x, (h - logoSize) / 2);
      this.container.addChild(logo);
      x += logoSize + gap;
    }
    text.anchor.set(0, 0.5);
    text.position.set(x, h / 2);
    this.container.addChild(text);

    // 상태 표시: 가이드라인은 hover/press 에 미묘한 변화를 허용한다(형태·색은 유지).
    // 흰 배경 위 얇은 검정 오버레이로 표현한다 — 배경색을 바꾸면 브랜드 색을 건드리게 된다.
    const overlay = new Graphics();
    overlay.roundRect(0, 0, w, h, radius).fill({ color: 0x000000 });
    overlay.alpha = 0;
    overlay.eventMode = 'none';
    this.container.addChild(overlay);

    this.container.eventMode = 'static';
    this.container.cursor = 'pointer';
    this.container.hitArea = { contains: (px, py) => px >= 0 && px <= w && py >= 0 && py <= h };
    this.container.on('pointerover', () => (overlay.alpha = 0.06));
    this.container.on('pointerout', () => (overlay.alpha = 0));
    this.container.on('pointerdown', () => (overlay.alpha = 0.12));
    this.container.on('pointerup', () => (overlay.alpha = 0.06));
    this.container.on('pointertap', () => opts.onClick());
  }
}
