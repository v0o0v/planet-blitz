/**
 * Deterministic procedural chunk placement for the infinite scroll map (plan
 * Phase E). The world is diced into fixed-size square chunks; the gimmicks in a
 * chunk are a PURE FUNCTION of (seed, chunk coordinate) — never of the path the
 * player took to reach it. Two players who arrive at the same chunk by different
 * routes therefore see the exact same layout (AC3, path independence).
 *
 * Purity is achieved with `SeededRng.fork`: `worldRng.fork('chunk:cx:cy')`
 * derives an independent generator from the (constant) world stream and the
 * chunk id, and `fork` does NOT advance the parent — so the draw depends only on
 * the coordinate, not on visitation order. This module is a leaf: it produces
 * plain placement descriptors and never touches world state, so world.ts owns
 * spawning/culling.
 */

import type { SeededRng } from './rng.js';

/** Chunk edge length in world units. */
export const CHUNK_SIZE = 1024;

/**
 * Chunks within this Chebyshev radius of the origin chunk stay EMPTY — a safe
 * spawn zone so the player never materialises inside a wall/hazard at (0,0).
 * Radius 1 clears a 3x3 block of chunks around the origin.
 */
export const SAFE_CHUNK_RADIUS = 1;

/**
 * Generation vs. cull radii (world units), with hysteresis: CULL > GEN.
 *
 * A chunk is generated once its centre is within `CHUNK_GEN_RADIUS` of the
 * player and culled once its centre passes `CHUNK_CULL_RADIUS`. Keeping the cull
 * radius strictly LARGER than the generation radius gives a dead-band: a freshly
 * generated chunk is not immediately eligible for culling, so a player loitering
 * near the boundary cannot thrash a chunk generate→cull→generate every tick.
 * Both stay below PROJECTILE_CULL_RADIUS (~3304) so nothing surprising overlaps.
 */
export const CHUNK_GEN_RADIUS = 2200;
export const CHUNK_CULL_RADIUS = 3000;

/**
 * Hard cap on simultaneously active gimmick entities across the whole active
 * region. When generation would exceed it, remaining chunks in the fixed scan
 * order are deferred (not generated this tick) — bounding the per-tick cost of
 * wall slides, LOS checks and culling regardless of placement density.
 */
export const MAX_ACTIVE_GIMMICKS = 48;

/** Keep a placement this far inside the chunk so its centre's chunk is unambiguous. */
const PLACE_MARGIN = 170;

/**
 * Wall half-extent bounds. Min ≥ 60 so a full width (120) exceeds the max dash
 * step (~59u/tick at dashSpeed 2800) and the player cannot tunnel a wall.
 *
 * ⚠️ **이 부등식은 대시에만 성립한다 — 탄에는 성립하지 않는다.** 만점 빌드의 한 틱 탄 이동량은
 * 132~262 유닛/틱으로 **전 기체가** 이 전폭 120 을 넘는다(실측 표는
 * `tests/bulletTunnelInvariant.test.ts`). 그래서 탄 대 벽 판정은 지점이 아니라 **선분**이어야
 * 하고, 실제로 그렇게 돼 있다(`los.sweptCircleOverlapsWall`). 이 상수를 올려 탄 터널링을 막으려는
 * 시도는 하지 마라 — 262 를 덮으려면 전폭 524 가 필요해 청크 배치가 무너진다. 판정 차원이 답이다.
 */
export const WALL_HALF_MIN = 60;
const WALL_HALF_MAX = 150;

/** Gimmick tuning constants (world units / hit points). */
export const DESTRUCTIBLE_RADIUS = 48;
export const DESTRUCTIBLE_HP = 30;
export const DESTRUCTIBLE_GEM_XP = 5;
export const TERRAIN_HAZARD_RADIUS = 120;
export const TERRAIN_HAZARD_DAMAGE = 10;
/** Hazard subtype tag for chunk-placed terrain hazards (distinct from mortar/lava). */
export const HAZARD_TERRAIN = 2;
export const EVENT_TRIGGER_RADIUS = 70;

/**
 * 기믹 종류 추첨의 **누적 백분율 경계**(0..99 굴림에 대한 상한, 배타).
 *
 * 예전에는 `rng.int(0, 9)` 10구간이었고 배분이 벽4 / 파괴체2 / 해저드1 / 자석1 / 폭탄1 /
 * 포탑1 이었다. 사용자 요청("바닥에 깔리는 데미지 주는 것들을 현재의 30% 정도 수준으로")대로
 * 해저드를 10% → **3%** 로 줄이려면 10구간으로는 표현이 안 되므로 100구간으로 바꿨다.
 * `SeededRng.int` 는 span 과 무관하게 u32 를 **정확히 한 번** 소비하므로 굴림 횟수·스트림
 * 정렬은 그대로다(값이 달라져 PvE 해시는 바뀐다 — 침공은 청크 생성을 아예 돌리지 않는다).
 *
 * 해저드에서 뺀 7%는 **벽**으로 넘겼다. 벽은 피해가 없는 순수 지형이라 "위험은 줄고 지형
 * 다양성은 유지" 가 되고, 파괴체(경험치)·이벤트 오브젝트 비율을 건드리지 않아 성장·보상
 * 곡선이 이 변경에 끌려가지 않는다.
 */
const ROLL_WALL = 47;
const ROLL_DESTRUCTIBLE = 67; // 47 + 20
const ROLL_HAZARD = 70; // 67 + 3  ← 해저드 3%
const ROLL_MAGNET = 80; // 70 + 10
const ROLL_BOMB = 90; // 80 + 10
// 나머지(90..99) = 포탑 픽업 10%.

/** One placed gimmick, in absolute world coordinates. `world.ts` turns these into
 *  entities. Fields not relevant to a kind stay at their zero defaults. */
export interface GimmickPlacement {
  kind: 'wall' | 'destructible' | 'hazard' | 'magnetEmitter' | 'bombDevice' | 'turretPickup';
  x: number;
  y: number;
  /** Wall half-width (radius) / event or hazard trigger radius / destructible radius. */
  radius: number;
  /** Wall half-height (targetX); 0 for non-walls. */
  halfH: number;
  /** Destructible hit points / 0. */
  hp: number;
  /** Destructible gem XP / hazard damage / 0. */
  value: number;
  /** Hazard subtype tag / 0. */
  sub: number;
}

/** 겹침 회피 재시도 상한(한 기믹당). 넘으면 그 기믹은 놓지 않는다. */
const PLACE_ATTEMPTS = 8;
/**
 * 기믹 사이 최소 여백(월드 유닛). 0 이면 딱 붙어 한 덩어리로 보이므로 눈에 띄는 간격을 둔다.
 * 플레이어 전폭(반경 16 × 2 = 32)보다 커서 붙은 두 벽 사이로 지나갈 수 있다는 뜻이기도 하다.
 */
const PLACE_GAP = 40;

/**
 * 두 배치가 (여백 포함) 겹치는가. 벽은 `radius`=반폭·`halfH`=반높이의 AABB 이고, 나머지는
 * `radius` 반경의 원인데 **원도 AABB 로 근사**한다 — 겹침 판정을 보수적으로(조금 넉넉하게)
 * 하는 쪽이 안전하고, 판정이 축정렬 사각 하나로 통일돼 결정론·정수 규율이 단순해진다.
 */
export function placementsOverlap(a: GimmickPlacement, b: GimmickPlacement): boolean {
  const ahw = a.radius;
  const ahh = a.kind === 'wall' ? a.halfH : a.radius;
  const bhw = b.radius;
  const bhh = b.kind === 'wall' ? b.halfH : b.radius;
  return (
    Math.abs(a.x - b.x) < ahw + bhw + PLACE_GAP && Math.abs(a.y - b.y) < ahh + bhh + PLACE_GAP
  );
}

/**
 * Derive the independent, order-independent RNG for one chunk. Pure in
 * (worldRng state, cx, cy) — `fork` never advances `worldRng`.
 */
export function chunkRngFor(worldRng: SeededRng, cx: number, cy: number): SeededRng {
  return worldRng.fork(`chunk:${cx}:${cy}`);
}

/**
 * Deterministic gimmick layout for chunk (cx, cy). Origin-safe chunks return an
 * empty list. Otherwise 0..3 gimmicks are drawn, each with a type and a position
 * kept a margin inside the chunk (so `floor(pos / CHUNK_SIZE)` recovers this
 * chunk — used by the culling code to map a gimmick back to its chunk).
 *
 * 종류 배분은 {@link ROLL_WALL} 이하 누적 경계 상수들이 정본이다(해저드 3%).
 */
export function chunkPlacements(worldRng: SeededRng, cx: number, cy: number): GimmickPlacement[] {
  const out: GimmickPlacement[] = [];
  if (Math.max(Math.abs(cx), Math.abs(cy)) <= SAFE_CHUNK_RADIUS) return out;

  const rng = chunkRngFor(worldRng, cx, cy);
  const baseX = cx * CHUNK_SIZE;
  const baseY = cy * CHUNK_SIZE;
  const count = rng.int(0, 3);
  for (let i = 0; i < count; i++) {
    // ⚠️ 굴림 순서가 **종류·크기 먼저, 위치 나중**인 이유: 겹침 판정을 하려면 후보의 크기를
    // 알아야 한다. 예전에는 위치를 먼저 굴리고 종류를 나중에 굴렸는데, 그러면 겹침을 알아도
    // 다시 굴릴 수가 없어 한 청크 안 기믹 4개가 서로 겹친 채 그대로 스폰됐다(사용자 신고
    // 2026-07-27: "벽이 겹쳐서 나올 때가 있음"). 청크 RNG 는 좌표에서 fork 된 독립 스트림이라
    // 순서를 바꿔도 **경로 독립성**(AC3)은 그대로다 — 같은 좌표는 항상 같은 배치다.
    const roll = rng.int(0, 99);
    const g: GimmickPlacement = { kind: 'wall', x: 0, y: 0, radius: 0, halfH: 0, hp: 0, value: 0, sub: 0 };
    if (roll < ROLL_WALL) {
      // Wall (most common): rectangular cover.
      g.kind = 'wall';
      g.radius = rng.range(WALL_HALF_MIN, WALL_HALF_MAX);
      g.halfH = rng.range(WALL_HALF_MIN, WALL_HALF_MAX);
    } else if (roll < ROLL_DESTRUCTIBLE) {
      // Destructible object.
      g.kind = 'destructible';
      g.radius = DESTRUCTIBLE_RADIUS;
      g.hp = DESTRUCTIBLE_HP;
      g.value = DESTRUCTIBLE_GEM_XP;
    } else if (roll < ROLL_HAZARD) {
      // Terrain hazard (permanent — no telegraph, never expires).
      g.kind = 'hazard';
      g.radius = TERRAIN_HAZARD_RADIUS;
      g.value = TERRAIN_HAZARD_DAMAGE;
      g.sub = HAZARD_TERRAIN;
    } else if (roll < ROLL_MAGNET) {
      g.kind = 'magnetEmitter';
      g.radius = EVENT_TRIGGER_RADIUS;
    } else if (roll < ROLL_BOMB) {
      g.kind = 'bombDevice';
      g.radius = EVENT_TRIGGER_RADIUS;
    } else {
      g.kind = 'turretPickup';
      g.radius = EVENT_TRIGGER_RADIUS;
    }
    // 위치는 **이미 놓인 것과 겹치지 않는 자리**를 찾을 때까지 다시 굴린다(거절 표집). 시도
    // 상한을 넘으면 그 기믹은 **놓지 않는다** — 겹쳐 놓느니 비우는 편이 낫다(청크당 최대 4개라
    // 밀도 손실은 미미하다). 굴림 횟수가 늘어도 청크 스트림은 독립이라 다른 청크에 영향이 없다.
    let placed = false;
    for (let attempt = 0; attempt < PLACE_ATTEMPTS; attempt++) {
      g.x = baseX + rng.range(PLACE_MARGIN, CHUNK_SIZE - PLACE_MARGIN);
      g.y = baseY + rng.range(PLACE_MARGIN, CHUNK_SIZE - PLACE_MARGIN);
      if (!out.some((o) => placementsOverlap(o, g))) {
        placed = true;
        break;
      }
    }
    if (placed) out.push(g);
  }
  return out;
}
