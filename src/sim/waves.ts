/**
 * Wave director — segment progression + seeded card draws (spec R3).
 *
 * Runs on a dedicated RNG stream (`world.waveRng`, forked once at creation) so
 * enemy composition is a pure function of the seed and independent of how many
 * numbers other subsystems draw. Per tick it advances the segment clock, draws a
 * spawn card when due, and materialises its enemies at formation positions —
 * always respecting the segment's onscreen enemy cap. The 6th segment is the
 * boss slot: it stops normal spawns and raises `boss` for Phase 3 to hook.
 */

import type { WorldState } from './world.js';
import type { Entity } from './entities.js';
import { blankEntity, addEntity } from './entities.js';
import type { EnemyDef } from './patterns/types.js';
import { ENEMY_BY_TYPE } from '../../data/enemies.js';
import { SEGMENTS, tierParams } from '../../data/waves.js';
import type { WaveCard, Formation } from '../../data/waves.js';
import { planetContent } from '../../data/planets/index.js';
import { cos, sin, PI, TWO_PI } from './math.js';
import { OFFSCREEN_X, OFFSCREEN_Y, SPAWN_RING_RADIUS, VIEW_HEIGHT } from './constants.js';
import { maxEnemiesMult, enemyHpMult } from './anomaly.js';
import { makeElite, ELITE_AFFIX_COUNT } from './elite.js';

export interface WaveRuntime {
  segmentIndex: number;
  segmentTimer: number;
  cardTimer: number;
  /** Boss segment reached — Phase 3 spawns the fight; Phase 2 just flags it. */
  boss: boolean;
  /** Run fully complete (all segments elapsed). */
  done: boolean;
}

export function createWaveRuntime(): WaveRuntime {
  const first = SEGMENTS[0];
  return {
    segmentIndex: 0,
    segmentTimer: first ? first.durationTicks : 0,
    cardTimer: 0, // draw the opening card immediately
    boss: false,
    done: false,
  };
}

/** Count live enemies (excludes bullets/hazards/gems). */
export function countEnemies(state: WorldState): number {
  let n = 0;
  for (const e of state.entities) if (e.kind === 'enemy') n++;
  return n;
}

/** Advance the wave director by one tick, spawning enemies as due. */
export function updateWaves(state: WorldState, player: Entity): void {
  const w = state.wave;
  if (w.done) return;

  const seg = SEGMENTS[w.segmentIndex];
  if (seg === undefined) {
    w.done = true;
    return;
  }
  state.bulletCap = seg.bulletCap;

  // 군체 대발생 변칙 × 섬멸 티어 밀도↑: raise the onscreen enemy cap. 티어 밀도는
  // 데이터 주도(TIER_PARAMS.densityMult) — 정찰/교전은 1(거동 불변), 섬멸은 ×1.5.
  const tp = tierParams(state.config.tier);
  const maxEnemies = Math.round(seg.maxEnemies * maxEnemiesMult(state.anomaly) * tp.densityMult);

  if (seg.boss) {
    w.boss = true; // Phase 3 hook: boss encounter begins here.
  } else {
    if (w.cardTimer > 0) w.cardTimer--;
    if (w.cardTimer <= 0 && countEnemies(state) < maxEnemies) {
      // 행성별 카드 풀에서 추첨(카르곤/베르단). 풀 길이가 달라도 waveRng 소비는 카드
      // 인덱스 1회로 동일하므로 스트림 분리 규율 유지.
      const cardPool = planetContent(state.config.planet).cardPool;
      const cardIndex = state.waveRng.int(0, cardPool.length - 1);
      const card = cardPool[cardIndex];
      if (card !== undefined) spawnCard(state, card, maxEnemies, player);
      w.cardTimer = seg.cardInterval;
    }
  }

  if (w.segmentTimer > 0) w.segmentTimer--;
  if (w.segmentTimer <= 0 && w.segmentIndex < SEGMENTS.length - 1) {
    w.segmentIndex++;
    const next = SEGMENTS[w.segmentIndex];
    w.segmentTimer = next ? next.durationTicks : 0;
    w.cardTimer = 0;
  }
}

function spawnCard(state: WorldState, card: WaveCard, maxEnemies: number, player: Entity): void {
  // Flatten the card into an ordered list of defs, then place by formation.
  // 스폰 그룹은 role(역할 로스터) 또는 elite(정예 인덱스)로 대상을 지정한다(WaveSpawn
  // 판별 유니온). 행성 콘텐츠에서 해당 행성의 로스터·엘리트를 조회한다.
  const planet = planetContent(state.config.planet);
  const defs: EnemyDef[] = [];
  for (const s of card.spawns) {
    const def = 'elite' in s ? planet.elites[s.elite] : planet.roster[s.role];
    if (def === undefined) continue; // 정의되지 않은 정예 인덱스는 무시(안전).
    for (let i = 0; i < s.count; i++) defs.push(def);
  }
  const positions = formationPositions(state, card.formation, defs.length, player);
  const room = maxEnemies - countEnemies(state);
  const spawnN = Math.min(defs.length, room);
  const spawned: Entity[] = [];
  for (let i = 0; i < spawnN; i++) {
    const def = defs[i];
    const pos = positions[i];
    if (def === undefined || pos === undefined) continue;
    // 활성 벽에 끼인 채 스폰되지 않도록 결정론적으로 벽 밖으로 밀어낸다(C1).
    const adj = avoidWalls(state.activeWalls, pos.x, pos.y, def.radius);
    const e = spawnEnemy(state, def, adj.x, adj.y);
    spawned.push(e);
  }
  // 티어별 정예 승격(교전=1 / 섬멸=2, TIER_PARAMS.eliteCount). 카드에서 먼저 스폰된
  // eliteCount마리를 전용 스트림(OQ-M2-4)에서 뽑은 어픽스로 엘리트화한다. spawnEnemy
  // 뒤라 변칙/티어 HP 배율이 이미 반영된 상태에서 승격된다. 정찰(0)은 승격 없음(불변).
  const eliteCount = tierParams(state.config.tier).eliteCount;
  const promote = eliteCount < spawned.length ? eliteCount : spawned.length;
  for (let i = 0; i < promote; i++) {
    const affix = state.eliteRng.int(0, ELITE_AFFIX_COUNT - 1);
    makeElite(spawned[i] as Entity, affix);
  }
}

/** 벽 면에서 스폰 좌표를 살짝 떨어뜨릴 여유(px). */
const SPAWN_WALL_MARGIN = 4;
/** 벽 밖으로 밀어내는 최대 반복 횟수(다중 벽 코너 대비). 초과분은 슬라이드에 위임. */
const MAX_SPAWN_WALL_TRIES = 4;

/**
 * 스폰 좌표(반경 r)가 활성 벽 AABB(적 반경 마진 포함)와 겹치면 결정론적으로 벽
 * 밖으로 밀어낸다. 매 시도마다 겹친 벽을 배열 순서로 훑어 최소 관통 축을 따라
 * Minkowski 확장 면 바깥(+SPAWN_WALL_MARGIN)으로 옮긴다. 다중 벽 코너는 최대
 * MAX_SPAWN_WALL_TRIES회 반복으로 완화하고, 그래도 남는 겹침은 그대로 두어 이동
 * 슬라이드(slideCircleWalls)에 맡긴다. RNG를 쓰지 않고 입력이 위치+벽 기하만의
 * 함수이므로 결정론(시드·해시 스트림 불변).
 */
export function avoidWalls(
  walls: readonly Entity[],
  x: number,
  y: number,
  r: number,
): { x: number; y: number } {
  if (walls.length === 0) return { x, y };
  for (let attempt = 0; attempt < MAX_SPAWN_WALL_TRIES; attempt++) {
    let pushed = false;
    for (const w of walls) {
      const hw = w.radius + r; // Minkowski 확장 half-extents
      const hh = w.targetX + r;
      const dx = x - w.x;
      const dy = y - w.y;
      if (dx > -hw && dx < hw && dy > -hh && dy < hh) {
        // 최소 관통 축으로 벽 밖(+마진)에 재배치.
        const penX = hw - (dx < 0 ? -dx : dx);
        const penY = hh - (dy < 0 ? -dy : dy);
        if (penX < penY) {
          x = w.x + (dx >= 0 ? hw + SPAWN_WALL_MARGIN : -(hw + SPAWN_WALL_MARGIN));
        } else {
          y = w.y + (dy >= 0 ? hh + SPAWN_WALL_MARGIN : -(hh + SPAWN_WALL_MARGIN));
        }
        pushed = true;
      }
    }
    if (!pushed) break;
  }
  return { x, y };
}

function spawnEnemy(state: WorldState, def: EnemyDef, x: number, y: number): Entity {
  const e = blankEntity('enemy');
  e.x = x;
  e.y = y;
  e.radius = def.radius;
  // 군체 대발생 변칙 × 섬멸 티어 HP 배율(완만). 정찰/교전은 ×1(거동 불변), 섬멸 ×4.5.
  const hp = Math.round(def.hp * enemyHpMult(state.anomaly) * tierParams(state.config.tier).hpMult);
  e.hp = hp;
  e.maxHp = hp;
  e.damage = def.contactDamage;
  e.enemyType = def.typeIndex;
  // Stagger first fire so a freshly spawned pack does not volley in lockstep.
  e.cooldown = def.fireCooldown + state.waveRng.int(0, 30);
  return addEntity(state, e);
}

/** Look up the behaviour definition backing a live enemy entity. */
export function enemyDefFor(e: Entity): EnemyDef | undefined {
  return ENEMY_BY_TYPE[e.enemyType];
}

/**
 * 보스 소환(plan E2)용 결정론 잡몹 스폰. spawnEnemy와 달리 RNG(waveRng)를 소비하지
 * 않고 첫 발사 쿨다운을 정의값으로 고정해, 보스 공격 컴포넌트가 스트림 분리 규율을
 * 깨지 않고 무리개체를 부를 수 있게 한다. 변칙 HP 배율은 동일하게 적용한다.
 */
export function summonEnemy(state: WorldState, def: EnemyDef, x: number, y: number): Entity {
  const e = blankEntity('enemy');
  e.x = x;
  e.y = y;
  e.radius = def.radius;
  const hp = Math.round(def.hp * enemyHpMult(state.anomaly) * tierParams(state.config.tier).hpMult);
  e.hp = hp;
  e.maxHp = hp;
  e.damage = def.contactDamage;
  e.enemyType = def.typeIndex;
  e.cooldown = def.fireCooldown; // 고정 쿨다운(결정론, RNG 미소비)
  return addEntity(state, e);
}

// ---------------------------------------------------------------------------
// Formations — deterministic spawn placement (seeded, avoids the player).
// ---------------------------------------------------------------------------

function formationPositions(
  state: WorldState,
  formation: Formation,
  count: number,
  player: Entity,
): { x: number; y: number }[] {
  // Infinite map: every formation is placed RELATIVE to the player, just outside
  // the on-screen viewport (off-screen ring / edges). No arena clamps — the world
  // is unbounded, so enemies stream in from beyond the visible frame in any
  // direction. Placement stays a pure function of the wave RNG + player position.
  const rng = state.waveRng;
  const out: { x: number; y: number }[] = [];

  switch (formation) {
    case 'ring': {
      // A ring centred on the player, sized so it sits fully off-screen.
      const start = rng.range(-PI, PI);
      for (let i = 0; i < count; i++) {
        const ang = start + (i * TWO_PI) / count;
        out.push({
          x: player.x + cos(ang) * SPAWN_RING_RADIUS,
          y: player.y + sin(ang) * SPAWN_RING_RADIUS,
        });
      }
      break;
    }
    case 'line': {
      // A column entering from a random off-screen side of the viewport.
      const fromLeft = rng.chance(0.5);
      const x0 = player.x + (fromLeft ? -OFFSCREEN_X : OFFSCREEN_X);
      const y0 = player.y + rng.range(-VIEW_HEIGHT * 0.3, VIEW_HEIGHT * 0.3);
      for (let i = 0; i < count; i++) {
        // Formation spacing doubled for the 2x-scale entities (line 46 -> 92).
        out.push({ x: x0 + (fromLeft ? -1 : 1) * i * 92, y: y0 + i * 40 });
      }
      break;
    }
    case 'edges': {
      // Each enemy spawns along one of the four off-screen viewport edges.
      for (let i = 0; i < count; i++) {
        const side = rng.int(0, 3);
        let x = player.x;
        let y = player.y;
        if (side === 0) {
          x = player.x + rng.range(-OFFSCREEN_X, OFFSCREEN_X);
          y = player.y - OFFSCREEN_Y;
        } else if (side === 1) {
          x = player.x + rng.range(-OFFSCREEN_X, OFFSCREEN_X);
          y = player.y + OFFSCREEN_Y;
        } else if (side === 2) {
          x = player.x - OFFSCREEN_X;
          y = player.y + rng.range(-OFFSCREEN_Y, OFFSCREEN_Y);
        } else {
          x = player.x + OFFSCREEN_X;
          y = player.y + rng.range(-OFFSCREEN_Y, OFFSCREEN_Y);
        }
        out.push({ x, y });
      }
      break;
    }
    case 'cluster': {
      // A blob offset from the player so it is not on top of them. Offsets and
      // spread doubled for the 2x-scale entities (spread +/-90 -> +/-180).
      const cx = player.x + rng.range(-1, 1) * 1000 + 520;
      const cy = player.y + rng.range(-1, 1) * 800 - 400;
      for (let i = 0; i < count; i++) {
        out.push({ x: cx + rng.range(-180, 180), y: cy + rng.range(-180, 180) });
      }
      break;
    }
  }
  return out;
}
