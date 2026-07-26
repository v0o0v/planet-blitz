/**
 * 벽 타일링 텍스처 (사용자 신고 2026-07-27: "벽이 한 이미지를 늘려서 쓰기 때문에 매우 어색함.
 * 이미지를 붙여서 쓰도록 수정 요망").
 *
 * 두 층으로 방어한다.
 *  ① 순수 유도: 타일 수 산출과 파생 텍스처의 프레임 크기·캐시 동일성.
 *  ② grep 게이트: **프로덕션 렌더러**(`src/render/entityRenderer.ts`)의 벽 분기가 실제로
 *     타일 텍스처를 물리는지 정적 단언 — 유도 함수만 옳고 배선이 없으면 화면은 그대로다.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { Rectangle, Texture, TextureSource } from 'pixi.js';

import { tiledWallTexture, tileCount, clearWallTextureCache } from '../src/render/wallTexture.js';

/** 64×64 소스 텍스처(assets/wall.png 와 같은 치수). 렌더러 없이 만들 수 있다. */
function baseTexture(size = 64): Texture {
  const source = new TextureSource({ width: size, height: size, resolution: 1 });
  return new Texture({ source, frame: new Rectangle(0, 0, size, size) });
}

function readSrc(rel: string): string {
  const url = new URL(`../${rel}`, import.meta.url);
  return new TextDecoder().decode(readFileSync(url.pathname.replace(/^\/([A-Za-z]:)/, '$1')));
}

beforeEach(() => clearWallTextureCache());

describe('① 타일 수 산출', () => {
  it('반올림이라 잔여 배율이 [0.67, 1.33] 안에 든다', () => {
    for (const size of [120, 137, 190, 256, 300]) {
      const n = tileCount(size, 64);
      const scale = size / (n * 64);
      expect(scale, `${size}px → ${n}타일`).toBeGreaterThan(0.66);
      expect(scale, `${size}px → ${n}타일`).toBeLessThan(1.34);
    }
  });

  it('최소 1타일이고 이상한 입력에도 1로 내려앉는다(0 나눗셈·NaN 없음)', () => {
    expect(tileCount(10, 64)).toBe(1);
    expect(tileCount(64, 0)).toBe(1);
    expect(tileCount(Number.NaN, 64)).toBe(1);
  });
});

describe('② 파생 텍스처', () => {
  it('AABB 를 덮는 타일 수만큼 프레임이 커지고 소스는 repeat 로 바뀐다', () => {
    const base = baseTexture();
    const tex = tiledWallTexture(base, 240, 128); // 가로 4타일 · 세로 2타일
    expect(tex.frame.width).toBe(64 * 4);
    expect(tex.frame.height).toBe(64 * 2);
    expect(tex.source.style.addressMode).toBe('repeat');
    // 원본은 그대로 쓰인다(소스 공유 — 새 이미지를 만들지 않는다).
    expect(tex.source).toBe(base.source);
  });

  it('1×1 이면 원본을 그대로 돌려준다(파생·캐시 없음 = 기존 거동)', () => {
    const base = baseTexture();
    expect(tiledWallTexture(base, 64, 64)).toBe(base);
    expect(tiledWallTexture(base, 40, 40)).toBe(base);
  });

  it('같은 타일 수는 같은 객체를 재사용한다(벽마다 텍스처가 늘지 않는다)', () => {
    const base = baseTexture();
    const a = tiledWallTexture(base, 250, 130);
    const b = tiledWallTexture(base, 258, 126); // 반올림하면 같은 4×2
    expect(a).toBe(b);
    const c = tiledWallTexture(base, 250, 260); // 4×4 는 다른 캐시 항목
    expect(c).not.toBe(a);
  });
});

describe('③ 프로덕션 렌더러 배선 grep 게이트', () => {
  const SRC = readSrc('src/render/entityRenderer.ts');

  it('벽 분기가 tiledWallTexture 로 텍스처를 갈아 끼운다', () => {
    expect(/import \{ tiledWallTexture \} from '\.\/wallTexture\.js';/.test(SRC)).toBe(true);
    const branch = SRC.match(/if \(e\.kind === 'wall'\) \{([\s\S]*?)\} else if \(e\.kind === 'loot'\)/);
    expect(branch, '벽 분기를 찾지 못했다').not.toBeNull();
    const body = branch?.[1] ?? '';
    expect(/sprite\.texture = tiledWallTexture\(/.test(body), '벽 분기가 타일 텍스처를 쓰지 않는다').toBe(
      true,
    );
    // AABB 정확 표시는 그대로 유지된다(충돌 상자와 그림이 어긋나면 안 된다).
    expect(/sprite\.setSize\(w, h\)/.test(body)).toBe(true);
  });
});
