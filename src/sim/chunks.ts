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
 *
 * ## 48 → 160 (2026-08-04, 벽 프리팹 도입)
 * 이 상한은 **밀도의 실질 지배자**다. 컬 반경(3000) 안에는 청크가 약 27개 들어가는데, 프리팹
 * 이전에도 청크당 평균 1.5개라 약 40개로 상한에 거의 닿아 있었다. 벽 슬롯 하나가 조각 2~4개를
 * 낳게 되면서 평균이 약 2.6개/청크(≈70개)로 올랐으므로, 상한을 그대로 두면 **뒤쪽 청크가 통째로
 * 생성 보류**돼 지형이 듬성듬성해진다(원자적 생성이라 부분 생성이 아니라 전부 아니면 전무다).
 * 상한은 **엔티티 수**를 세는데 벽 프리팹 하나가 조각을 7~16개 낳으므로, 벽 추첨 비율을 22% 로
 * 낮춘 뒤에도 청크당 평균이 약 4개다(≈110). 160 은 그 평균에 여유를 주되 최악을 여전히 묶는다.
 */
export const MAX_ACTIVE_GIMMICKS = 160;

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
const ROLL_WALL = 22;
const ROLL_DESTRUCTIBLE = 52; // 22 + 30
const ROLL_HAZARD = 56; // 52 + 4  ← 해저드 4%
const ROLL_MAGNET = 71; // 56 + 15
const ROLL_BOMB = 86; // 71 + 15
// 나머지(86..99) = 포탑 픽업 14%.

/*
 * ## 47% → 22% (2026-08-04, 벽 프리팹이 길어지면서)
 * 벽 한 슬롯이 **낱개 사각형 하나**에서 **조각 7~16개짜리 구조물**로 바뀌었다. 추첨 비율을 그대로
 * 두면 청크당 벽 조각이 7개를 넘어 기믹 상한({@link MAX_ACTIVE_GIMMICKS})을 상시 초과하고, 청크
 * 생성은 원자적이라 **뒤쪽 청크가 통째로 밀려** 지형이 듬성듬성해진다. 즉 "벽을 더 자주"와 "벽을
 * 더 길게"는 같은 예산을 다투는 축이고, 사용자가 고른 것은 **길게**다(2026-08-04).
 * 빼낸 25%p 는 파괴체·이벤트 오브젝트로 돌렸다 — 성장·보상 곡선이 벽 길이 변경에 끌려가지
 * 않도록 총 기믹 수 자체는 유지한다.
 */

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
  /**
   * 이 배치가 나온 **기믹 슬롯 번호**(청크 안에서만 유일). 벽 프리팹은 조각 여러 개가 같은
   * 번호를 공유하므로, 이 값이 곧 "한 구조물"의 경계다.
   *
   * 왜 필요한가: 프리팹 도입 뒤 배치 목록의 길이는 더 이상 **추첨 횟수**가 아니다(벽 한 번이
   * 조각 넷을 낳는다). 그래서 ① 종류 배분 비율(해저드 3% 등)을 재는 쪽은 조각이 아니라 이
   * 번호의 가짓수를 세야 하고 ② 겹침 불변식은 "같은 번호끼리는 면제, 다른 번호끼리는 금지"로
   * 말해야 한다. 렌더·sim 은 이 값을 읽지 않는다(world.ts 는 엔티티만 만든다).
   */
  group: number;
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
  // 같은 슬롯에서 나온 프리팹 조각끼리는 **붙어 있어야** 구조물로 읽힌다 — 면제한다(규율 ②).
  if (a.group === b.group) return false;
  const ahw = a.radius;
  const ahh = a.kind === 'wall' ? a.halfH : a.radius;
  const bhw = b.radius;
  const bhh = b.kind === 'wall' ? b.halfH : b.radius;
  return (
    Math.abs(a.x - b.x) < ahw + bhw + PLACE_GAP && Math.abs(a.y - b.y) < ahh + bhh + PLACE_GAP
  );
}

// ---------------------------------------------------------------------------
// 벽 프리팹 (2026-08-04, 사용자 요청 "조합이 너무 단순 — 더 벽처럼 보이게 · 좀 길게")
//
// 예전에는 벽 하나 = **낱개 사각형 하나**였다. 반폭·반높이를 각각 굴려 놓을 뿐이라 화면에는
// 크기만 다른 덩어리가 흩어져 있었고, 어떤 것도 "지어진 것"으로 읽히지 않았다. 이제 벽 슬롯
// 하나가 **격자 위를 걸어간 긴 벽**을 낳는다 — 조각 {@link PREFAB_MIN_PIECES}개 이상이 끊김
// 없이 이어지고, 꺾이는 자리에서 모양이 생긴다.
//
// ## 왜 격자 걷기인가 (모양을 손으로 짜지 않는 이유)
// 처음에는 L 자·ㄷ 자 같은 **모양을 손으로 정의**했다. 그때 두 가지가 걸렸다: ① 팔이 만나는
// 자리에서 조각이 서로 **겹쳐** 반투명하지 않은 벽이 두 겹으로 그려졌고(화면에서 얼룩으로
// 보인다) ② 모양마다 조각 수가 2~4개로 짧았다. 격자 걷기는 둘 다 구조적으로 없앤다 —
// **한 칸에 정확히 한 조각**이라 겹칠 수가 없고, 걸음 수가 곧 길이다.
//
// ## 규율 (전부 이유가 있다)
//  ① **프리팹 전체가 청크 안에 들어간다.** 조각이 청크 경계를 넘으면 컬링이 조각의 좌표로
//     청크를 되짚으므로(`floor(pos / CHUNK_SIZE)`) 프리팹이 **반쪽만 지워진다**. 그래서 걸음
//     범위를 {@link PREFAB_GRID_SPAN} 칸으로 묶고, 배치 판정은 바운딩 박스로 한다.
//  ② **조각은 정사각 블록이고 칸에 정렬된다.** 이웃 칸끼리 변이 정확히 맞닿아 틈도 겹침도
//     없다. 축정렬 AABB(`radius`=반폭, `targetX`=반높이)라는 sim 전제도 그대로 지킨다.
//  ③ **한 칸을 두 번 밟지 않는다.** 되밟으면 그 자리에 조각이 두 개 생겨 ②가 깨진다.
//
// ## 결정론
// 걸음 수가 시도에 따라 달라지지만 청크 스트림은 좌표에서 fork 된 독립 스트림이라 **경로
// 독립성**(AC3)은 그대로다. 값이 달라지므로 PvE 해시는 바뀐다(침공은 청크 생성을 아예 돌리지
// 않아 불변).
// ---------------------------------------------------------------------------

/**
 * 프리팹 한 벌의 **최소 조각 수**(사용자 요청 2026-08-04 — "프리팹당 최소 7개 이상은 이어져
 * 있게"). 걷기가 막혀 이 수를 못 채우면 그 프리팹은 **놓지 않는다** — 짧은 토막을 놓느니
 * 비우는 편이 요청에 맞다.
 */
export const PREFAB_MIN_PIECES = 7;
/** 최대 조각 수. 청크 안에 들어가야 하므로 격자 범위와 함께 상한을 만든다. */
const PREFAB_MAX_PIECES = 16;
/** 조각(정사각 블록) 반변 길이 범위. 전폭이 대시 한 틱(~59)보다 커야 뚫리지 않는다. */
const PREFAB_BLOCK_MIN = 46;
const PREFAB_BLOCK_MAX = 64;
/**
 * 걸음이 퍼질 수 있는 격자 범위(칸). 최악 폭 = (SPAN-1)×칸 + 블록전폭 이고, 이것이 청크
 * 절반(512)을 넘으면 프리팹을 놓을 자리가 사라진다 — 6칸 × 128 + 128 = 768, 반폭 384 < 512.
 */
const PREFAB_GRID_SPAN = 6;
/** 걷기 재시도 — 막혀서 최소 조각 수를 못 채우면 다른 시작 방향으로 다시 걷는다. */
const PREFAB_WALK_ATTEMPTS = 10;

const STEP_DX = [1, 0, -1, 0] as const;
const STEP_DY = [0, 1, 0, -1] as const;

/**
 * 행성별 벽 성향.
 *  - `straight` — **직진 확률(%)**. 높을수록 곧고 긴 벽.
 *  - `min`/`max` — 조각 수 범위.
 *  - `enclose` — 꺾을 때 **같은 방향으로만** 꺾을 확률(%). 높으면 걸음이 스스로를 감아
 *    ㄷ 자·나선·방 같은 **에워싸는 구조물**이 되고, 낮으면 좌우로 흔들리는 뱀 모양이 된다.
 *  - `roll` — 기믹 슬롯이 **벽이 될 확률(%)**. 기본은 {@link ROLL_WALL}(22%)이고, 아르케·크라스만
 *    15% 다 — 두 행성의 구조물은 크고 감겨 있어 같은 빈도로 두면 화면이 미로가 된다(사용자
 *    지시 2026-08-04 "지금보다 30% 정도 적게"). 줄어든 몫은 파괴체로 간다(추첨 경계는 고정).
 *
 * ## 아르케·크라스가 다른 이유 (사용자 지시 2026-08-04)
 * 두 행성은 컨셉 자체가 **구조물이 앞을 막는 곳**이다(아르케 = 쓰러진 기둥·유적, 크라스 =
 * 무너진 요새). 그래서 이 둘만 `enclose` 를 높게 잡아 "돌아갈까, 뚫린 틈으로 들어갈까"를
 * 판단하게 만든다 — 나머지 행성의 벽은 지나가며 엄폐로 쓰는 것에 가깝다. 두 축(`straight`,
 * `enclose`)은 서로 다른 것을 만든다: 직진은 **길이**를, 감기는 **갇힘**을 만든다.
 *
 * 행성 인덱스는 `config.planet` 이고 범위 밖이면 첫 줄을 쓴다.
 */
export const PLANET_WALL_STYLE: readonly {
  straight: number;
  min: number;
  max: number;
  enclose: number;
  roll: number;
}[] = [
  /* 0 카르곤   */ { straight: 62, min: 7, max: 12, enclose: 50, roll: ROLL_WALL },
  /* 1 베르단   */ { straight: 55, min: 7, max: 13, enclose: 50, roll: ROLL_WALL },
  /* 2 니플헤임 */ { straight: 70, min: 8, max: 14, enclose: 50, roll: ROLL_WALL },
  /* 3 아르케   */ { straight: 52, min: 10, max: 16, enclose: 88, roll: 15 },
  /* 4 톡사르   */ { straight: 45, min: 7, max: 12, enclose: 50, roll: ROLL_WALL },
  /* 5 크라스   */ { straight: 60, min: 11, max: 16, enclose: 92, roll: 15 },
];

/** 프리팹 조각 하나(프리팹 로컬 좌표). 평행이동만 하면 절대 좌표 벽 배치가 된다. */
interface PrefabPiece {
  dx: number;
  dy: number;
  halfW: number;
  halfH: number;
}

/**
 * 격자 위를 걸어 이어진 벽 한 벌을 **로컬 좌표**로 만든다(바운딩 박스 중심이 원점).
 * 조각 수가 {@link PREFAB_MIN_PIECES} 에 못 미치면 빈 배열을 돌려준다(= 놓지 않는다).
 */
function prefabPieces(rng: SeededRng, planet: number): PrefabPiece[] {
  const style = PLANET_WALL_STYLE[planet] ?? PLANET_WALL_STYLE[0];
  const block = rng.range(PREFAB_BLOCK_MIN, PREFAB_BLOCK_MAX);
  const cell = block * 2; // 칸 = 블록 전폭 → 이웃 칸끼리 정확히 맞닿는다(규율 ②)
  const lo = style?.min ?? PREFAB_MIN_PIECES;
  const hi = Math.min(style?.max ?? PREFAB_MAX_PIECES, PREFAB_MAX_PIECES);
  const target = rng.int(Math.max(PREFAB_MIN_PIECES, lo), Math.max(PREFAB_MIN_PIECES, hi));
  const straight = style?.straight ?? 60;
  const enclose = style?.enclose ?? 50;
  // 이 프리팹이 감을 방향(시계/반시계)을 한 번만 정한다 — 매번 굴리면 감기지 않고 흔들린다.
  const spin = rng.int(0, 1) === 0 ? 1 : 3;

  let best: { gx: number; gy: number }[] = [];
  for (let attempt = 0; attempt < PREFAB_WALK_ATTEMPTS && best.length < target; attempt++) {
    const taken = new Set<string>(['0:0']);
    const cells = [{ gx: 0, gy: 0 }];
    let gx = 0;
    let gy = 0;
    let dir = rng.int(0, 3);
    let minX = 0;
    let maxX = 0;
    let minY = 0;
    let maxY = 0;
    for (let i = 1; i < target; i++) {
      let stepped = false;
      // 방향 후보를 몇 번 굴려 본다 — 되밟기(규율 ③)나 범위 초과(규율 ①)면 다시 굴린다.
      for (let tryDir = 0; tryDir < 10 && !stepped; tryDir++) {
        // 꺾을 때 `enclose` 확률로 **이 프리팹이 정한 방향**으로만 꺾는다 → 경로가 스스로를
        // 감아 에워싸는 구조가 된다. 나머지 확률은 반대쪽이라 완전한 나선으로 굳지 않는다.
        const bend = rng.int(0, 99) < enclose ? spin : 4 - spin;
        const turn = rng.int(0, 99) < straight ? 0 : bend;
        const d = (dir + turn) & 3;
        const nx = gx + (STEP_DX[d] ?? 0);
        const ny = gy + (STEP_DY[d] ?? 0);
        if (taken.has(`${nx}:${ny}`)) continue;
        const nMinX = Math.min(minX, nx);
        const nMaxX = Math.max(maxX, nx);
        const nMinY = Math.min(minY, ny);
        const nMaxY = Math.max(maxY, ny);
        if (nMaxX - nMinX >= PREFAB_GRID_SPAN || nMaxY - nMinY >= PREFAB_GRID_SPAN) continue;
        gx = nx;
        gy = ny;
        dir = d;
        minX = nMinX;
        maxX = nMaxX;
        minY = nMinY;
        maxY = nMaxY;
        taken.add(`${nx}:${ny}`);
        cells.push({ gx, gy });
        stepped = true;
      }
      if (!stepped) break; // 사방이 막혔다 — 이 시도는 여기까지다
    }
    if (cells.length > best.length) best = cells;
  }
  if (best.length < PREFAB_MIN_PIECES) return [];

  // 바운딩 박스 중심을 원점으로 옮긴다(배치 판정이 대칭이 된다).
  let minX = best[0]?.gx ?? 0;
  let maxX = minX;
  let minY = best[0]?.gy ?? 0;
  let maxY = minY;
  for (const c of best) {
    minX = Math.min(minX, c.gx);
    maxX = Math.max(maxX, c.gx);
    minY = Math.min(minY, c.gy);
    maxY = Math.max(maxY, c.gy);
  }
  const ox = (minX + maxX) / 2;
  const oy = (minY + maxY) / 2;
  return best.map((c) => ({
    dx: (c.gx - ox) * cell,
    dy: (c.gy - oy) * cell,
    halfW: block,
    halfH: block,
  }));
}

/** 조각 목록의 바운딩 박스 반폭·반높이(로컬 원점 기준, 비대칭이면 더 먼 쪽을 쓴다). */
function prefabHalfExtent(pieces: readonly PrefabPiece[]): { halfW: number; halfH: number } {
  let hw = 0;
  let hh = 0;
  for (const p of pieces) {
    hw = Math.max(hw, Math.abs(p.dx) + p.halfW);
    hh = Math.max(hh, Math.abs(p.dy) + p.halfH);
  }
  return { halfW: hw, halfH: hh };
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
export function chunkPlacements(
  worldRng: SeededRng,
  cx: number,
  cy: number,
  planet = 0,
): GimmickPlacement[] {
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
    // 벽 확률만 행성별로 갈린다(나머지 경계는 공통) — 아르케·크라스의 큰 구조물이 같은 빈도로
    // 쏟아지면 지나갈 길보다 막힌 길이 많아진다.
    const wallRoll = PLANET_WALL_STYLE[planet]?.roll ?? ROLL_WALL;
    const g: GimmickPlacement = { kind: 'wall', x: 0, y: 0, radius: 0, halfH: 0, hp: 0, value: 0, sub: 0, group: i };
    if (roll < wallRoll) {
      // Wall (most common): **프리팹** — 조각 여러 개가 한 구조물을 이룬다(위 프리팹 절).
      // 배치 판정은 바운딩 박스로 하고, 자리를 잡으면 조각 전부를 한꺼번에 push 한다.
      const pieces = prefabPieces(rng, planet);
      if (pieces.length === 0) continue; // 최소 길이를 못 채웠다 — 토막 대신 비운다
      const ext = prefabHalfExtent(pieces);
      const probe: GimmickPlacement = { ...g, radius: ext.halfW, halfH: ext.halfH };
      let anchored = false;
      for (let attempt = 0; attempt < PLACE_ATTEMPTS * 2; attempt++) {
        // 프리팹 **전체**가 청크 안에 들어가야 한다(규율 ①) — 여백은 바운딩 박스 기준이다.
        const mx = Math.max(PLACE_MARGIN, ext.halfW);
        const my = Math.max(PLACE_MARGIN, ext.halfH);
        // 프리팹이 청크보다 크면 **놓지 않는다.** 중심에 욱여넣으면 조각이 경계를 넘고, 그러면
        // 컬링이 조각의 좌표로 청크를 되짚어 프리팹이 반쪽만 지워진다(규율 ①). 치수 상한이
        // 이미 그런 프리팹을 만들지 않지만, 누가 치수를 키웠을 때 조용히 깨지지 않게 막는다.
        if (mx * 2 >= CHUNK_SIZE || my * 2 >= CHUNK_SIZE) break;
        probe.x = baseX + rng.range(mx, CHUNK_SIZE - mx);
        probe.y = baseY + rng.range(my, CHUNK_SIZE - my);
        if (!out.some((o) => placementsOverlap(o, probe))) {
          anchored = true;
          break;
        }
      }
      if (anchored) {
        for (const p of pieces) {
          out.push({
            kind: 'wall',
            x: probe.x + p.dx,
            y: probe.y + p.dy,
            radius: p.halfW,
            halfH: p.halfH,
            hp: 0,
            value: 0,
            sub: 0,
            group: i,
          });
        }
      }
      continue; // 위치 굴림을 프리팹 경로에서 이미 끝냈다(아래 낱개 배치 루프를 태우지 않는다).
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
