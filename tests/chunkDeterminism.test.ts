import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import { chunkPlacements, placementsOverlap, CHUNK_SIZE } from '../src/sim/chunks.js';
import type { GimmickPlacement } from '../src/sim/chunks.js';
import type { Entity } from '../src/sim/entities.js';
import { runReplay } from '../src/sim/replay.js';
import type { Replay } from '../src/sim/replay.js';
import type { InputFrame } from '../src/sim/world.js';
import { SeededRng } from '../src/sim/rng.js';

/**
 * Phase E — chunk placement is a pure function of (seed, chunk coordinate): the
 * layout of a chunk never depends on how (or in what order) it was reached
 * (AC3, path independence). Full-scale digest comparison is the G worker's job;
 * these are smokes.
 */

function digest(gs: GimmickPlacement[]): string {
  return gs
    .map((g) => `${g.kind}:${g.x}:${g.y}:${g.radius}:${g.halfH}`)
    .sort()
    .join('|');
}

describe('chunk placement determinism (plan E, AC3)', () => {
  it('is a pure function of chunk coordinate (same seed → same layout)', () => {
    const a = createWorld(0xabc);
    const b = createWorld(0xabc);
    for (const [cx, cy] of [
      [2, 0],
      [-3, 5],
      [7, -4],
    ] as const) {
      expect(digest(chunkPlacements(a.worldRng, cx, cy))).toBe(
        digest(chunkPlacements(b.worldRng, cx, cy)),
      );
    }
  });

  it('does not depend on the order chunks are queried', () => {
    const w = createWorld(0xabc);
    const forward = [
      digest(chunkPlacements(w.worldRng, 2, 3)),
      digest(chunkPlacements(w.worldRng, 5, -1)),
      digest(chunkPlacements(w.worldRng, -6, 2)),
    ];
    const reverse = [
      digest(chunkPlacements(w.worldRng, -6, 2)),
      digest(chunkPlacements(w.worldRng, 5, -1)),
      digest(chunkPlacements(w.worldRng, 2, 3)),
    ];
    expect(forward).toEqual([reverse[2], reverse[1], reverse[0]]);
  });

  it('diverges between seeds for at least one chunk', () => {
    const a = createWorld(1);
    const b = createWorld(2);
    let anyDiff = false;
    for (let cx = 2; cx < 8; cx++) {
      if (digest(chunkPlacements(a.worldRng, cx, 0)) !== digest(chunkPlacements(b.worldRng, cx, 0))) {
        anyDiff = true;
        break;
      }
    }
    expect(anyDiff).toBe(true);
  });

  it('a run that roams into gimmick territory replays to identical hashes', () => {
    // Move far off the origin safe zone so walls/hazards/events generate, cull,
    // and re-generate — all under the deterministic hash.
    const gen = new SeededRng(555);
    const inputs: InputFrame[] = [];
    for (let t = 0; t < 60 * 12; t++) {
      inputs.push({
        moveX: gen.range(-1, 1),
        moveY: gen.range(-1, 1),
        aim: gen.range(-Math.PI, Math.PI),
        dash: gen.chance(0.04),
        special: 0,
      });
    }
    const replay: Replay = { seed: 0x1234, inputs };
    const a = runReplay(replay);
    const b = runReplay(replay);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.finalHash).toBe(b.finalHash);
  });

  it('reaching the same chunk by different paths yields the identical placement digest', () => {
    // AC3 formal check: drive two worlds (same seed) along DIFFERENT movement
    // paths, then compare the sorted (kind, x, y) placement digest per chunk for
    // every chunk both worlds have active. Digest excludes entityId/insertion
    // order — path independence must hold on coordinates + kind alone.
    const GIMMICK_KINDS = ['wall', 'destructible', 'magnetEmitter', 'bombDevice', 'turretPickup'];
    const isGimmick = (e: Entity): boolean =>
      GIMMICK_KINDS.includes(e.kind) || (e.kind === 'hazard' && e.life < 0);

    /** Map<chunkKey, sorted (kind,x,y) digest of that chunk's live gimmicks>. */
    function digestByChunk(legs: readonly { mx: number; my: number; ticks: number }[]): Map<string, string> {
      const state: WorldState = createWorld(0x2468);
      state.wave.done = true; // silence waves; only chunk gimmicks matter
      for (const leg of legs) {
        for (let t = 0; t < leg.ticks; t++) {
          stepWorld(state, { moveX: leg.mx, moveY: leg.my, aim: 0, dash: false, special: 0 });
        }
      }
      const byChunk = new Map<string, string[]>();
      for (const e of state.entities) {
        if (e.dead || !isGimmick(e)) continue;
        const cx = Math.floor(e.x / CHUNK_SIZE);
        const cy = Math.floor(e.y / CHUNK_SIZE);
        const ckey = `${cx},${cy}`;
        const arr = byChunk.get(ckey) ?? [];
        arr.push(`${e.kind}:${e.x}:${e.y}:${e.radius}:${e.targetX}`);
        byChunk.set(ckey, arr);
      }
      const out = new Map<string, string>();
      for (const [ckey, arr] of byChunk) out.set(ckey, arr.sort().join('|'));
      return out;
    }

    // Path A: right, then up. Path B: up, then right. Both cover an overlapping
    // region so many chunks are active in both worlds.
    const a = digestByChunk([
      { mx: 1, my: 0, ticks: 260 },
      { mx: 0, my: -1, ticks: 260 },
    ]);
    const b = digestByChunk([
      { mx: 0, my: -1, ticks: 260 },
      { mx: 1, my: 0, ticks: 260 },
    ]);

    let shared = 0;
    for (const [ckey, digestA] of a) {
      const digestB = b.get(ckey);
      if (digestB === undefined) continue;
      shared++;
      expect(digestB).toBe(digestA);
    }
    // The two paths must genuinely overlap (otherwise the assertion is vacuous).
    expect(shared).toBeGreaterThan(3);
  });

  it('actually generates gimmick entities once the player leaves the safe zone', () => {
    const state: WorldState = createWorld(0x777);
    // Walk straight right for a few seconds to reach chunk territory.
    for (let t = 0; t < 60 * 6; t++) stepWorld(state, { moveX: 1, moveY: 0, aim: 0, dash: false, special: 0 });
    const gimmicks = state.entities.filter((e) =>
      ['wall', 'destructible', 'magnetEmitter', 'bombDevice', 'turretPickup'].includes(e.kind) ||
      (e.kind === 'hazard' && e.life < 0),
    );
    expect(gimmicks.length).toBeGreaterThan(0);
  });

  /**
   * 기믹 종류 분포 — 사용자 요청 2026-07-26("바닥에 깔리는 데미지 주는 것들을 현재의 30% 정도
   * 수준으로")으로 지형 해저드를 10% → **3%** 로 내렸다. 굴림을 `int(0,9)` 10구간에서
   * `int(0,99)` 100구간으로 바꿔야 3% 가 표현된다.
   *
   * 이 분포는 눈대중으로 확인할 수 없다 — 게임 화면의 `hazard` 엔티티에는 적 패턴이 만드는
   * **한시적** 박격포·용암 장판이 섞여 있어서(지형 해저드만 `life < 0`), 화면 카운트로는
   * 청크 배분을 못 읽는다. 그래서 순수 함수를 대량 표본해 비율 자체를 못 박는다.
   */
  it('지형 해저드가 전체 기믹의 3% 수준이다 (10%에서 내렸다)', () => {
    const rng = new SeededRng(0xd1571b);
    const counts: Record<string, number> = {};
    let total = 0;
    // 안전 청크(|cx|,|cy| <= 1)를 피해 넓게 훑는다. 표본이 커야 3% 를 좁은 구간으로 단언할 수 있다.
    for (let cx = 2; cx < 62; cx++) {
      for (let cy = 2; cy < 62; cy++) {
        // ⚠️ 비율의 분모는 **조각이 아니라 슬롯**이다. 벽은 프리팹이라 한 번 뽑히면 조각을
        // 2~4개 낳으므로, 조각을 세면 벽 비율이 배분과 무관하게 부풀어 오른다(프리팹 도입 시
        // 실제로 61.7% 로 튀어 이 테스트가 잡았다). 슬롯 = `group` 의 가짓수다.
        const seen = new Set<number>();
        for (const g of chunkPlacements(rng, cx, cy)) {
          if (seen.has(g.group)) continue;
          seen.add(g.group);
          counts[g.kind] = (counts[g.kind] ?? 0) + 1;
          total++;
        }
      }
    }
    expect(total).toBeGreaterThan(4000); // 표본이 충분하다(공회전 방지).
    const share = (k: string): number => ((counts[k] ?? 0) / total) * 100;
    // 해저드 3% — 표본 오차를 감안해 1.5~5% 구간. 예전 값(10%)은 이 구간 밖이라 회귀를 잡는다.
    expect(share('hazard')).toBeGreaterThan(2);
    expect(share('hazard')).toBeLessThan(7);
    // 해저드에서 뺀 7% 는 벽으로 갔다(피해 없는 순수 지형). 파괴체·이벤트 비율은 불변이라
    // 성장·보상 곡선이 이 변경에 끌려가지 않는다 — 그것이 벽에 넘긴 이유다.
    // 벽은 하한·상한 양쪽을 잠근다 — 하한만 두면 "벽이 폭주하는 오배분" 을 이 단언이 못 잡고
    // 다른 종류 밴드로 간접 검출되기만 한다(경계 합 100 불변식이 한 방향으로만 걸린다).
    // ⚠️ 추첨 비율은 22% 인데 **실현 비율은 그보다 낮다**(실측 19%). 벽이 프리팹(조각 7개 이상이
    // 이어진 큰 구조물)이 되면서, 청크 안에 놓을 자리를 못 찾거나 걷기가 막혀 최소 길이를 못 채우면
    // 그 슬롯은 **비운다**(짧은 토막을 놓지 않는다는 계약). 밴드는 실현 비율 기준이다.
    //
    // 47% → 22% 로 내린 이유는 `ROLL_WALL` 주석에 있다 — 벽 하나가 조각 7~16개를 낳게 되면서
    // "자주"와 "길게"가 같은 예산을 다투게 됐고, 고른 것은 길게다.
    expect(share('wall')).toBeGreaterThan(14);
    expect(share('wall')).toBeLessThan(26);
    expect(share('destructible')).toBeGreaterThan(26);
    expect(share('destructible')).toBeLessThan(36);
    for (const k of ['magnetEmitter', 'bombDevice', 'turretPickup']) {
      expect(share(k), `${k} 비율`).toBeGreaterThan(10);
      expect(share(k), `${k} 비율`).toBeLessThan(20);
    }
  });
});

// ---------------------------------------------------------------------------
// 겹침 금지 (사용자 신고 2026-07-27: "벽이 겹쳐서 나올 때가 있음")
// ---------------------------------------------------------------------------

describe('청크 기믹은 서로 겹치지 않는다', () => {
  it('넓은 좌표 표본에서 같은 청크 안 배치가 하나도 겹치지 않는다', () => {
    const w = createWorld(0x51ee);
    let checked = 0;
    let placements = 0;
    for (let cx = -12; cx <= 12; cx++) {
      for (let cy = -12; cy <= 12; cy++) {
        const gs = chunkPlacements(w.worldRng, cx, cy);
        placements += gs.length;
        for (let i = 0; i < gs.length; i++) {
          for (let j = i + 1; j < gs.length; j++) {
            checked++;
            const a = gs[i] as GimmickPlacement;
            const b = gs[j] as GimmickPlacement;
            expect(
              placementsOverlap(a, b),
              `청크(${cx},${cy})의 ${a.kind}@${a.x},${a.y} 와 ${b.kind}@${b.x},${b.y} 가 겹친다`,
            ).toBe(false);
          }
        }
      }
    }
    // 표본이 비어 있으면 위 단언이 공회전한다 — 실제로 배치와 쌍이 존재했음을 못박는다.
    expect(placements).toBeGreaterThan(200);
    expect(checked).toBeGreaterThan(100);
  });

  it('프리팹은 한 덩어리다 — 같은 슬롯 조각은 서로 붙고, 다른 슬롯과는 여백을 지킨다', () => {
    // 겹침 면제를 `group` 으로 뚫어 놨으므로(placementsOverlap), 그 면제가 **프리팹 안에서만**
    // 쓰이는지 여기서 따로 못박는다. 면제가 새면 예전 결함(겹쳐 나오는 벽)이 그대로 돌아온다.
    const w = createWorld(0x51ee);
    let multiPiece = 0;
    let touching = 0;
    for (let cx = -14; cx <= 14; cx++) {
      for (let cy = -14; cy <= 14; cy++) {
        const gs = chunkPlacements(w.worldRng, cx, cy);
        const groups = new Map<number, GimmickPlacement[]>();
        for (const g of gs) {
          const list = groups.get(g.group) ?? [];
          list.push(g);
          groups.set(g.group, list);
        }
        for (const [, pieces] of groups) {
          if (pieces.length < 2) continue;
          multiPiece++;
          // ① 프리팹 조각은 전부 벽이다(다른 종류가 한 슬롯을 공유하지 않는다).
          for (const p of pieces) expect(p.kind).toBe('wall');
          // ② 조각들은 한 덩어리로 모여 있다 — 각 조각이 같은 프리팹의 다른 조각과
          //    PREFAB_SPAN 안에 있다(흩뿌려진 것이 아니라 구조물이다).
          for (const a of pieces) {
            const near = pieces.some(
              (b) => b !== a && Math.abs(a.x - b.x) < 900 && Math.abs(a.y - b.y) < 900,
            );
            expect(near, `프리팹 조각이 홀로 떨어져 있다 @${a.x},${a.y}`).toBe(true);
          }
          touching++;
        }
      }
    }
    expect(multiPiece, '다중 조각 프리팹이 표본에 없다(공회전)').toBeGreaterThan(20);
    expect(touching).toBe(multiPiece);
  });

  it('청크 경계를 넘는 겹침도 불가능하다(여백 ≥ 최대 반폭)', () => {
    // PLACE_MARGIN(170) > WALL_HALF_MAX(150) 이라 모든 배치는 자기 청크 안에 완전히 들어간다.
    // 이 불변식이 깨지면 이웃 청크끼리 겹칠 수 있고, 청크 RNG 는 서로를 볼 수 없어 거절 표집으로도
    // 막을 수 없다. 그래서 좌표 범위 자체를 단언한다.
    const w = createWorld(0x51ee);
    for (let cx = -6; cx <= 6; cx++) {
      for (let cy = -6; cy <= 6; cy++) {
        for (const g of chunkPlacements(w.worldRng, cx, cy)) {
          const halfW = g.radius;
          const halfH = g.kind === 'wall' ? g.halfH : g.radius;
          const loX = cx * CHUNK_SIZE;
          const loY = cy * CHUNK_SIZE;
          expect(g.x - halfW).toBeGreaterThanOrEqual(loX);
          expect(g.x + halfW).toBeLessThanOrEqual(loX + CHUNK_SIZE);
          expect(g.y - halfH).toBeGreaterThanOrEqual(loY);
          expect(g.y + halfH).toBeLessThanOrEqual(loY + CHUNK_SIZE);
        }
      }
    }
  });
});
