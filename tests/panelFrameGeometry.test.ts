/**
 * 나무 패널 채움 inset 이 프레임 텍스처 실물과 맞는지 검증한다 (ADR-0014 카툰나무풍 UI).
 *
 * 왜 자산을 직접 읽나: 어두운 내부 채움은 프레임 **밑에** 깔리므로 상수가 어긋나도 코드는
 * 조용히 돌아간다. 결함은 오직 "화면 위에 얹은 팝업의 테두리 안쪽에 뒤 화면이 비치는 몇 px
 * 짜리 띠" 라는 형태로만 드러나고, 평면 배경 위 패널에서는 그마저 안 보인다(실제로 기본값이
 * `border - 2` 이던 시절 6px 띠가 오래 살아남았다). UI 자산을 다시 뽑는 일이 잦은 리포라,
 * 자산이 바뀌면 시각 검증 전에 여기서 깨지게 둔다.
 *
 * 렌더 자체는 여전히 자동 테스트 밖이다 — 이 테스트가 보는 것은 좌표 기하뿐이다
 * (handoff: 신규 테스트는 UI-독립 계산에만).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodePng, type PngImage } from '../scripts/asset-prep.mjs';
import {
  PANEL_BORDER,
  PANEL_FILL_INSET,
  PANEL_FILL_RADIUS,
  PANEL_FRAME_SOLID,
} from '../src/ui/pixi/nineSlicePanel.js';

const frame: PngImage = decodePng(
  readFileSync(fileURLToPath(new URL('../assets/ui_panel.png', import.meta.url))),
);

/** 0(투명) ~ 255(불투명). 프레임은 RGBA 라 알파는 4번째 채널. */
function alpha(x: number, y: number): number {
  return frame.pixels[(y * frame.width + x) * frame.channels + 3] ?? 0;
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

/** 채움 경계가 전부 불투명한 나무 위에 있으면 true — 프레임 밖으로 안 삐져나온다. */
function fitsUnderFrame(inset: number): boolean {
  return fillOutline(frame.width, inset, PANEL_FILL_RADIUS).every(
    ([x, y]) => alpha(Math.round(x), Math.round(y)) === 255,
  );
}

describe('나무 패널 프레임 기하 (ui_panel.png)', () => {
  it('RGBA 정사각이고 알파가 0/255 뿐이다 — 채움을 살 밑에 숨기는 계산의 전제', () => {
    expect([frame.width, frame.height, frame.channels]).toEqual([300, 300, 4]);
    const seen = new Set<number>();
    for (let y = 0; y < frame.height; y++) {
      for (let x = 0; x < frame.width; x++) seen.add(alpha(x, y));
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
    // 살 두께는 변마다 1px씩 다르다(위 39·좌우 38·아래 37). 기준은 항상 제일 얇은 쪽.
    const thinnest = Math.min(
      firstHole((i) => alpha(i, midY)),
      firstHole((i) => alpha(midX, i)),
      firstHole((i) => alpha(frame.width - 1 - i, midY)),
      firstHole((i) => alpha(midX, frame.height - 1 - i)),
    );
    expect(thinnest).toBe(PANEL_FRAME_SOLID);
  });

  it('9-slice 중앙 슬라이스가 나무 살을 물지 않는다 (PANEL_BORDER 여유)', () => {
    expect(PANEL_BORDER).toBeGreaterThan(PANEL_FRAME_SOLID);
    const opaque: [number, number][] = [];
    for (let y = PANEL_BORDER; y < frame.height - PANEL_BORDER; y++) {
      for (let x = PANEL_BORDER; x < frame.width - PANEL_BORDER; x++) {
        if (alpha(x, y) !== 0) opaque.push([x, y]);
      }
    }
    expect(opaque).toEqual([]);
  });

  it('기본 채움이 나무 살 밑까지 번져 틈이 남지 않는다', () => {
    // 채움 바깥 경계가 살보다 안쪽에서 끝나면 그 사이가 투명 링으로 남는다.
    expect(PANEL_FILL_INSET).toBeLessThan(PANEL_FRAME_SOLID);
  });

  it('안전 구간(6~36)이 실물 그대로다 — 기본값은 그 안, 옛 기본값(44)은 밖', () => {
    const safe: number[] = [];
    for (let inset = 0; inset <= PANEL_BORDER; inset++) if (fitsUnderFrame(inset)) safe.push(inset);
    // 아래 끝은 프레임 바깥의 둥근 모서리가, 위 끝은 안쪽 구멍이 정한다.
    expect([safe[0], safe[safe.length - 1]]).toEqual([6, 36]);
    expect(safe).toContain(PANEL_FILL_INSET);
    expect(safe).not.toContain(PANEL_BORDER - 2);
  });
});
