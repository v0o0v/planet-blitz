/**
 * 나무 패널 채움 inset 이 프레임 텍스처 실물과 맞는지 검증한다 (ADR-0014 카툰나무풍 UI).
 *
 * 왜 자산을 직접 읽나: 어두운 내부 채움은 프레임 **밑에** 깔리므로 상수가 어긋나도 코드는
 * 조용히 돌아간다. 결함은 오직 "화면 위에 얹은 팝업의 테두리 안쪽에 뒤 화면이 비치는 몇 px
 * 짜리 띠" 라는 형태로만 드러나고, 평면 배경 위 패널에서는 그마저 안 보인다(실제로 기본값이
 * `border - 2` 이던 시절 6px 띠가 오래 살아남았다). 아이콘·UI 자산을 다시 뽑는 일이 잦은
 * 리포라, 자산이 바뀌면 시각 검증 전에 여기서 깨지게 둔다.
 *
 * 렌더 자체는 여전히 자동 테스트 밖이다 — 이 테스트가 보는 것은 좌표 기하뿐이다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  PANEL_BORDER,
  PANEL_FILL_INSET,
  PANEL_FILL_RADIUS,
  PANEL_FRAME_SOLID,
} from '../src/ui/pixi/nineSlicePanel.js';

const PANEL_PNG = fileURLToPath(new URL('../assets/ui_panel.png', import.meta.url));

const at = (b: Uint8Array, i: number): number => b[i] ?? 0;

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

interface Frame {
  width: number;
  height: number;
  /** 0(투명) ~ 255(불투명). */
  alpha(x: number, y: number): number;
}

/**
 * 8bit RGBA·비인터레이스 PNG 의 알파 채널을 읽는다(테스트 전용 최소 디코더 — 이 한 장을
 * 읽으려고 이미지 의존성을 들이지 않는다). 지원하지 않는 형식이면 던져서 알린다.
 */
function decodeFrame(file: string): Frame {
  const buf = new Uint8Array(readFileSync(file));
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (sig.some((v, i) => at(buf, i) !== v)) throw new Error('PNG 시그니처가 아니다');

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const idat: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  for (let pos = 8; pos + 8 <= buf.length; ) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(...buf.subarray(pos + 4, pos + 8));
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      const [bitDepth, colorType, , , interlace] = [16, 17, 18, 19, 20].map((o) => at(buf, pos + o));
      if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
        throw new Error(`지원하지 않는 PNG 형식(depth=${bitDepth} color=${colorType})`);
      }
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }

  const packed = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  for (let off = 0, i = 0; i < idat.length; i++) {
    const chunk = idat[i];
    if (chunk === undefined) continue;
    packed.set(chunk, off);
    off += chunk.length;
  }
  const raw = inflateSync(packed);
  const bpp = 4;
  const stride = width * bpp;
  const out = new Uint8Array(stride * height);
  for (let y = 0, pos = 0; y < height; y++) {
    const filter = at(raw, pos++);
    const line = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? at(out, line + i - bpp) : 0;
      const b = y > 0 ? at(out, line - stride + i) : 0;
      const c = i >= bpp && y > 0 ? at(out, line - stride + i - bpp) : 0;
      const v = at(raw, pos + i);
      const restored =
        filter === 0
          ? v
          : filter === 1
            ? v + a
            : filter === 2
              ? v + b
              : filter === 3
                ? v + ((a + b) >> 1)
                : filter === 4
                  ? v + paeth(a, b, c)
                  : NaN;
      if (Number.isNaN(restored)) throw new Error(`지원하지 않는 PNG 필터 ${filter}`);
      out[line + i] = restored & 0xff;
    }
    pos += stride;
  }

  return { width, height, alpha: (x, y) => at(out, y * stride + x * bpp + 3) };
}

/** 채움 사각형(roundRect) 테두리를 따라가는 표본 점들. 패널 로컬 좌표. */
function fillOutline(size: number, inset: number, radius: number): [number, number][] {
  const lo = inset;
  const hi = size - 1 - inset;
  const pts: [number, number][] = [];
  for (let x = lo + radius; x <= hi - radius; x++) pts.push([x, lo], [x, hi]);
  for (let y = lo + radius; y <= hi - radius; y++) pts.push([lo, y], [hi, y]);
  for (let deg = 0; deg <= 90; deg++) {
    const t = (deg * Math.PI) / 180;
    const dx = radius - radius * Math.cos(t);
    const dy = radius - radius * Math.sin(t);
    pts.push([lo + dx, lo + dy], [hi - dx, lo + dy], [lo + dx, hi - dy], [hi - dx, hi - dy]);
  }
  return pts;
}

describe('나무 패널 프레임 기하 (ui_panel.png)', () => {
  const frame = decodeFrame(PANEL_PNG);

  it('알파가 0/255 뿐이다 — 채움을 살 밑에 숨기는 계산이 반투명 가장자리를 가정하지 않는다', () => {
    const seen = new Set<number>();
    for (let y = 0; y < frame.height; y++) {
      for (let x = 0; x < frame.width; x++) seen.add(frame.alpha(x, y));
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 255]);
  });

  it('가장 얇은 축의 나무 살이 PANEL_FRAME_SOLID 에서 끝난다 — 9-slice 테두리(46)가 아니다', () => {
    const midX = Math.floor(frame.width / 2);
    const midY = Math.floor(frame.height / 2);
    const firstHole = (probe: (i: number) => number): number => {
      for (let i = 0; i < frame.width; i++) if (probe(i) === 0) return i;
      return -1;
    };
    // 살 두께는 축마다 1px 다르다(가로 38 / 세로 39). 기준은 항상 제일 얇은 쪽.
    const thinnest = Math.min(
      firstHole((i) => frame.alpha(i, midY)),
      firstHole((i) => frame.alpha(midX, i)),
      firstHole((i) => frame.alpha(frame.width - 1 - i, midY)),
      firstHole((i) => frame.alpha(midX, frame.height - 1 - i)),
    );
    expect(thinnest).toBe(PANEL_FRAME_SOLID);
  });

  it('9-slice 중앙 슬라이스가 나무 살을 물지 않는다 (PANEL_BORDER 여유)', () => {
    expect(PANEL_BORDER).toBeGreaterThan(PANEL_FRAME_SOLID);
    for (let y = PANEL_BORDER; y < frame.height - PANEL_BORDER; y++) {
      for (let x = PANEL_BORDER; x < frame.width - PANEL_BORDER; x++) {
        if (frame.alpha(x, y) !== 0) throw new Error(`중앙 슬라이스에 불투명 픽셀: ${x},${y}`);
      }
    }
  });

  it('기본 채움이 나무 살 밑까지 번져 틈이 남지 않는다', () => {
    // 채움 바깥 경계가 살(38)보다 안쪽에서 끝나면 그 사이가 투명 링으로 남는다.
    expect(PANEL_FILL_INSET).toBeLessThan(PANEL_FRAME_SOLID);
  });

  it('기본 채움 경계가 전부 불투명한 나무 위에 있다 — 프레임 밖으로 삐져나오지 않는다', () => {
    // 프레임 바깥 모서리가 둥글어서, inset 을 너무 줄이면 이번엔 채움 모서리가 밖으로 나온다.
    const outside = fillOutline(frame.width, PANEL_FILL_INSET, PANEL_FILL_RADIUS).filter(
      ([x, y]) => frame.alpha(Math.round(x), Math.round(y)) !== 255,
    );
    expect(outside).toEqual([]);
  });

  it('안전 구간(6~36)이 실물 그대로다 — 기본값은 그 안, 옛 기본값(44)은 밖', () => {
    const safe: number[] = [];
    for (let inset = 0; inset <= PANEL_BORDER; inset++) {
      const onWood = fillOutline(frame.width, inset, PANEL_FILL_RADIUS).every(
        ([x, y]) => frame.alpha(Math.round(x), Math.round(y)) === 255,
      );
      if (onWood) safe.push(inset);
    }
    // 아래 끝은 프레임 바깥의 둥근 모서리, 위 끝은 안쪽 구멍이 정한다.
    expect([safe[0], safe[safe.length - 1]]).toEqual([6, 36]);
    expect(safe).toContain(PANEL_FILL_INSET);
    expect(safe).not.toContain(PANEL_BORDER - 2);
  });
});
