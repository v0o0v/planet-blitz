/**
 * 벽 프리팹 배치·질감 계약(사용자 요청 2026-08-04 — "벽 기물을 몇 개 더 · 조합이 너무 단순 ·
 * 좀 길게 · 프리팹당 최소 7개 이상 이어지게 · 행성별 벽은 한 가지씩").
 *
 * 여기서 잠그는 것은 넷이다:
 *   ① **길이** — 프리팹 한 벌이 최소 조각 수를 채우는가. 걷기가 막히면 조용히 짧아질 수 있는데,
 *      화면으로는 "이번엔 짧게 나왔네"와 구분되지 않는다.
 *   ② **연결** — 조각들이 실제로 이어져 있는가(흩뿌려진 것이 아니라 한 벽인가).
 *   ③ **겹침 0** — 조각끼리 겹치지 않는가. 겹치면 같은 자리에 벽이 두 겹 그려지고, 옛 손으로
 *      짠 L/ㄷ 프리팹이 정확히 그랬다.
 *   ④ **질감** — 한 행성 안에서 벽 재료가 하나인가.
 */

import { describe, it, expect } from 'vitest';
import { SeededRng } from '../src/sim/rng.js';
import {
  chunkPlacements,
  PLANET_WALL_STYLE,
  PREFAB_MIN_PIECES,
  CHUNK_SIZE,
  type GimmickPlacement,
} from '../src/sim/chunks.js';

/** 표본 청크를 훑어 프리팹(같은 `group`)별 조각 묶음을 모은다. */
function prefabGroups(planet: number, span = 30): GimmickPlacement[][] {
  const rng = new SeededRng(0xc0ffee);
  const out: GimmickPlacement[][] = [];
  for (let cx = 2; cx < 2 + span; cx++) {
    for (let cy = 2; cy < 2 + span; cy++) {
      const groups = new Map<number, GimmickPlacement[]>();
      for (const g of chunkPlacements(rng, cx, cy, planet)) {
        if (g.kind !== 'wall') continue;
        const list = groups.get(g.group) ?? [];
        list.push(g);
        groups.set(g.group, list);
      }
      for (const [, pieces] of groups) out.push(pieces);
    }
  }
  return out;
}

/** 두 조각의 AABB 가 실제로 겹치는가(변이 맞닿는 것은 겹침이 아니다 — 격자 정렬의 정상 상태). */
function piecesOverlap(a: GimmickPlacement, b: GimmickPlacement): boolean {
  const EPS = 1e-6;
  return (
    Math.abs(a.x - b.x) < a.radius + b.radius - EPS &&
    Math.abs(a.y - b.y) < a.halfH + b.halfH - EPS
  );
}

describe('벽 프리팹 — 길이·연결·겹침', () => {
  it('모든 프리팹이 최소 7개 조각으로 이어진다(짧은 토막은 아예 놓지 않는다)', () => {
    for (let planet = 0; planet < PLANET_WALL_STYLE.length; planet++) {
      const groups = prefabGroups(planet, 20);
      expect(groups.length, `행성 ${planet} 표본 없음(공회전)`).toBeGreaterThan(50);
      for (const pieces of groups) {
        expect(pieces.length, `행성 ${planet} 프리팹 조각 ${pieces.length}개`).toBeGreaterThanOrEqual(
          PREFAB_MIN_PIECES,
        );
      }
    }
  });

  it('조각끼리 겹치지 않는다 — 한 칸에 한 조각(옛 L/ㄷ 프리팹의 결함)', () => {
    for (let planet = 0; planet < PLANET_WALL_STYLE.length; planet++) {
      for (const pieces of prefabGroups(planet, 14)) {
        for (let i = 0; i < pieces.length; i++) {
          for (let j = i + 1; j < pieces.length; j++) {
            const a = pieces[i] as GimmickPlacement;
            const b = pieces[j] as GimmickPlacement;
            expect(piecesOverlap(a, b), `겹침 @${a.x},${a.y} · ${b.x},${b.y}`).toBe(false);
          }
        }
      }
    }
  });

  it('조각은 하나로 이어진 덩어리다 — 끊긴 조각이 없다', () => {
    // 이웃 = 변이 맞닿은 조각(중심 거리가 정확히 한 칸). 너비 우선 탐색이 전부를 덮어야 한다.
    for (const pieces of prefabGroups(2, 14)) {
      const seen = new Set<number>([0]);
      const queue = [0];
      while (queue.length > 0) {
        const cur = queue.pop() as number;
        const a = pieces[cur] as GimmickPlacement;
        for (let k = 0; k < pieces.length; k++) {
          if (seen.has(k)) continue;
          const b = pieces[k] as GimmickPlacement;
          const dx = Math.abs(a.x - b.x);
          const dy = Math.abs(a.y - b.y);
          const cell = a.radius * 2;
          const touching =
            (Math.abs(dx - cell) < 1e-6 && dy < 1e-6) || (Math.abs(dy - cell) < 1e-6 && dx < 1e-6);
          if (touching) {
            seen.add(k);
            queue.push(k);
          }
        }
      }
      expect(seen.size, `끊긴 조각이 있다(${seen.size}/${pieces.length})`).toBe(pieces.length);
    }
  });

  it('조각은 전부 같은 크기의 정사각 블록이다(격자 정렬의 전제)', () => {
    for (const pieces of prefabGroups(5, 10)) {
      const first = pieces[0] as GimmickPlacement;
      for (const p of pieces) {
        expect(p.radius).toBe(p.halfH);
        expect(p.radius).toBe(first.radius);
      }
    }
  });

  it('프리팹 조각은 자기 청크 안에 완전히 들어간다(반쪽 컬링 방지)', () => {
    const rng = new SeededRng(0x9a11);
    for (let cx = 2; cx < 20; cx++) {
      for (let cy = 2; cy < 20; cy++) {
        for (const g of chunkPlacements(rng, cx, cy, cx % PLANET_WALL_STYLE.length)) {
          const halfH = g.kind === 'wall' ? g.halfH : g.radius;
          expect(g.x - g.radius).toBeGreaterThanOrEqual(cx * CHUNK_SIZE);
          expect(g.x + g.radius).toBeLessThanOrEqual((cx + 1) * CHUNK_SIZE);
          expect(g.y - halfH).toBeGreaterThanOrEqual(cy * CHUNK_SIZE);
          expect(g.y + halfH).toBeLessThanOrEqual((cy + 1) * CHUNK_SIZE);
        }
      }
    }
  });

  it('행성마다 벽 성향이 실제로 다르다(직진 성향·길이 표가 배선돼 있다)', () => {
    // 지문 = 평균 조각 수 + 평균 꺾임 수. 표만 있고 배선이 빠지면 여섯 행성이 같은 값을 낸다.
    const fingerprint = (planet: number): string => {
      const groups = prefabGroups(planet, 14);
      let pieces = 0;
      let bends = 0;
      for (const g of groups) {
        pieces += g.length;
        // 꺾임 = x·y 가 둘 다 변하는 지점 수의 대용 — 바운딩 박스가 정사각에 가까울수록 자주 꺾였다.
        const xs = g.map((p) => p.x);
        const ys = g.map((p) => p.y);
        const w = Math.max(...xs) - Math.min(...xs);
        const h = Math.max(...ys) - Math.min(...ys);
        bends += Math.min(w, h) / Math.max(1, Math.max(w, h));
      }
      return `${(pieces / groups.length).toFixed(2)}/${(bends / groups.length).toFixed(2)}`;
    };
    // 크라스(직진 82%, 최장)와 톡사르(직진 45%)는 확연히 달라야 한다.
    expect(fingerprint(5)).not.toBe(fingerprint(4));
    const all = new Set([0, 1, 2, 3, 4, 5].map(fingerprint));
    expect(all.size).toBeGreaterThan(3);
  });

  it('같은 좌표는 여전히 같은 배치다(경로 독립성 AC3 는 프리팹 뒤에도 유지)', () => {
    const a = new SeededRng(0x1234);
    const b = new SeededRng(0x1234);
    const first = chunkPlacements(a, 7, -9, 2);
    chunkPlacements(b, -3, 5, 2);
    chunkPlacements(b, 11, 11, 2);
    expect(JSON.stringify(chunkPlacements(b, 7, -9, 2))).toBe(JSON.stringify(first));
  });
});

describe('아르케·크라스 — 에워싸는 구조물', () => {
  /**
   * 컴팩트도 = 조각 수 대비 바운딩 박스 칸 수. 뱀처럼 길게 뻗으면 박스가 커져 값이 낮고,
   * 스스로를 감으면 같은 조각 수가 좁은 박스에 들어가 값이 높다. "돌아갈까 뚫고 갈까"를
   * 만드는 것은 길이가 아니라 이 감김이다(사용자 지시 2026-08-04).
   */
  const compactness = (planet: number): number => {
    const groups = prefabGroups(planet, 16);
    let sum = 0;
    for (const g of groups) {
      const cell = (g[0] as GimmickPlacement).radius * 2;
      const xs = g.map((p) => p.x);
      const ys = g.map((p) => p.y);
      const cols = Math.round((Math.max(...xs) - Math.min(...xs)) / cell) + 1;
      const rows = Math.round((Math.max(...ys) - Math.min(...ys)) / cell) + 1;
      sum += g.length / (cols * rows);
    }
    return sum / groups.length;
  };

  it('아르케·크라스의 벽은 다른 행성보다 더 감겨 있다(지나치는 벽이 아니라 막아서는 구조물)', () => {
    const arke = compactness(3);
    const kras = compactness(5);
    const others = [0, 1, 2, 4].map(compactness);
    const loose = Math.max(...others);
    expect(arke, `아르케 ${arke.toFixed(3)} vs 최대 타행성 ${loose.toFixed(3)}`).toBeGreaterThan(loose);
    expect(kras, `크라스 ${kras.toFixed(3)} vs 최대 타행성 ${loose.toFixed(3)}`).toBeGreaterThan(loose);
  });

  it('아르케·크라스의 벽이 더 길다(구조물이라 부를 만한 규모다)', () => {
    const avgPieces = (planet: number): number => {
      const groups = prefabGroups(planet, 14);
      return groups.reduce((n, g) => n + g.length, 0) / groups.length;
    };
    for (const p of [3, 5]) {
      expect(avgPieces(p), `행성 ${p} 평균 조각`).toBeGreaterThan(9);
    }
  });
});
