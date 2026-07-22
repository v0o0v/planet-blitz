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
import {
  SEGMENTS,
  stageParams,
  RUSH_RAMP_TICKS,
  RUSH_ENEMY_STEP,
  RUSH_ENEMY_MAX,
  RUSH_INTERVAL_STEP,
  RUSH_MIN_INTERVAL,
} from '../../data/waves.js';
import type { WaveCard, Formation } from '../../data/waves.js';
import { planetContent } from '../../data/planets/index.js';
import { cos, sin, PI, TWO_PI } from './math.js';
import { OFFSCREEN_X, OFFSCREEN_Y, SPAWN_RING_RADIUS, VIEW_HEIGHT } from './constants.js';
import { maxEnemiesMult, enemyHpMult } from './anomaly.js';
import { makeElite, ELITE_AFFIX_COUNT } from './elite.js';
import { PLANET_MODE } from './planetMode.js';
import {
  blockBreakProgress,
  BLOCKBREAK_SECTION_LENGTH,
  BLOCKBREAK_SPAWN_AHEAD,
} from './modes/blockBreak.js';
import { racingProgress, RACING_SECTION_LENGTH, RACING_SPAWN_AHEAD } from './modes/racing.js';
import { contaminationPurifyRate, CONTAMINATION_PURIFY_THRESHOLD } from './modes/contamination.js';

export interface WaveRuntime {
  segmentIndex: number;
  /**
   * 현재 세그먼트에 머문 틱 수(구 segmentTimer 대체, ADR-0011). 카운트다운이 아니라
   * 진입 시 0에서 매 틱 증가하며 급행 소환 램프의 입력이 된다 — 오래 머물수록 압박↑.
   */
  segmentElapsed: number;
  cardTimer: number;
  /** Boss segment reached — Phase 3 spawns the fight; Phase 2 just flags it. */
  boss: boolean;
  /** Run fully complete (all segments elapsed). */
  done: boolean;
  /**
   * 처치 할당 게이트(ADR-0011): 세그먼트 진입 시점의 state.kills 스냅샷. 진행도 =
   * state.kills - segmentBaseKills 로, 이 값이 segmentKillGoal에 도달하면 다음으로 넘어간다.
   */
  segmentBaseKills: number;
  /** 현재 세그먼트를 넘어가기 위한 처치 수(현재 세그먼트 데이터의 killGoal). */
  segmentKillGoal: number;
}

export function createWaveRuntime(): WaveRuntime {
  const first = SEGMENTS[0];
  return {
    segmentIndex: 0,
    segmentElapsed: 0,
    cardTimer: 0, // draw the opening card immediately
    boss: false,
    done: false,
    segmentBaseKills: 0,
    segmentKillGoal: first ? first.killGoal : 0,
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

  if (seg.boss) {
    w.boss = true; // Phase 3 hook: boss encounter begins here.
  }

  // 급행 소환 램프(ADR-0011): 세그먼트에 오래 머물수록(=처치 할당 미달) 유효 적 상한↑·
  // 카드 간격↓ 으로 압박을 누적한다. 정수 연산·RNG 미소비라 결정론 불변. 단 보스 세그먼트
  // 에는 램프를 적용하지 않는다(rushSteps=0) — 보스전에도 일반몹은 계속 등장하되(아래 카드
  // 추첨은 보스 포함 매 세그먼트 실행), 완만한 고정 간격이라 화력이 충분하면 보스에 집중
  // 가능하고 부족하면 몹이 서서히 쌓여 자연 사망으로 긴 꼬리가 캡된다(별도 enrage 없음).
  const rushSteps = seg.boss ? 0 : Math.floor(w.segmentElapsed / RUSH_RAMP_TICKS);
  const rushEnemyBonus = Math.min(rushSteps * RUSH_ENEMY_STEP, RUSH_ENEMY_MAX);
  // 군체 대발생 변칙 × 침략 단계 밀도↑: raise the onscreen enemy cap. 단계 밀도는
  // 데이터 주도(STAGE_MILESTONES.densityMult) — 밴드0/1(단계1..20)은 1(거동 불변), 밴드2(21+)는 ×1.5.
  const tp = stageParams(state.config.stage ?? 1);
  const maxEnemies = Math.round(
    (seg.maxEnemies + rushEnemyBonus) * maxEnemiesMult(state.anomaly) * tp.densityMult,
  );
  const cardInterval = Math.max(RUSH_MIN_INTERVAL, seg.cardInterval - rushSteps * RUSH_INTERVAL_STEP);

  if (w.cardTimer > 0) w.cardTimer--;
  if (w.cardTimer <= 0 && countEnemies(state) < maxEnemies) {
    // 행성별 카드 풀에서 추첨(카르곤/베르단). 풀 길이가 달라도 waveRng 소비는 카드
    // 인덱스 1회로 동일하므로 스트림 분리 규율 유지.
    const cardPool = planetContent(state.config.planet).cardPool;
    const cardIndex = state.waveRng.int(0, cardPool.length - 1);
    const card = cardPool[cardIndex];
    if (card !== undefined) spawnCard(state, card, maxEnemies, player);
    w.cardTimer = cardInterval;
  }

  w.segmentElapsed++;

  // 처치 할당 게이트(ADR-0011): 고정 타이머 대신 목표 처치 수를 채우면 다음 세그먼트로.
  // 적을 다 쓸어도 기다리지 않으므로 강한 빌드는 런이 짧아진다(창발). 보스 세그먼트는
  // 보스 처치(victory)로만 끝나므로 이 게이트를 타지 않는다.
  if (!seg.boss && w.segmentIndex < SEGMENTS.length - 1) {
    // 세그먼트 전진 게이트: 블록격파(Lane4)·레이싱(Lane5)은 처치 할당 대신 스크롤 주파 거리로
    // 구간을 넘는다(구간 i 돌파 = 진행도 ≥ (i+1)×구간길이). 그 외 모드는 기존 killGoal 게이트
    // 그대로라 뱀서류·침공 거동이 불변이다. 블록격파=−scrollY 진행도, 레이싱=+scrollX 진행도.
    const sw = state.scrollRuntime;
    let cleared: boolean;
    if (sw !== undefined && state.config.planetMode === PLANET_MODE.blockBreak)
      cleared = blockBreakProgress(sw) >= (w.segmentIndex + 1) * BLOCKBREAK_SECTION_LENGTH;
    else if (sw !== undefined && state.config.planetMode === PLANET_MODE.racing)
      cleared = racingProgress(sw) >= (w.segmentIndex + 1) * RACING_SECTION_LENGTH;
    else if (state.config.planetMode === PLANET_MODE.contamination) {
      // 오염(Lane8): 스크롤 거리 대신 **정화율**(파괴된 오염 노드 비율)로 구간을 넘는다. 구간 i
      // 통과 = 정화율 ≥ 임계 × (i+1)/일반세그먼트수. 일반 세그먼트 수 = SEGMENTS.length − 1
      // (마지막은 보스). 마지막 일반 세그먼트 통과 = 정화 임계 도달 → 보스 세그먼트 → 오염원
      // 코어 보스(stepBoss 공통 경로). 곡선·임계는 TODO(밸런스), 구조는 "정화 진행 → 보스".
      const normalSegments = SEGMENTS.length - 1;
      const milestone = (CONTAMINATION_PURIFY_THRESHOLD * (w.segmentIndex + 1)) / normalSegments;
      cleared = contaminationPurifyRate(state) >= milestone;
    } else cleared = state.kills - w.segmentBaseKills >= w.segmentKillGoal;
    if (cleared) {
      w.segmentIndex++;
      // 튜토리얼 단축판(config.maxSegments): 일반 세그먼트를 상한만큼 소화했으면 곧장
      // 보스 세그먼트로 점프한다. RNG 미소비·순수 인덱스 연산이라 결정론 불변이고,
      // 필드 부재 시 아래 분기가 죽어 기존 풀 런 거동이 보존된다.
      const cap = state.config.maxSegments;
      if (cap !== undefined && w.segmentIndex >= cap) {
        w.segmentIndex = SEGMENTS.length - 1;
      }
      const next = SEGMENTS[w.segmentIndex];
      w.segmentElapsed = 0;
      w.cardTimer = 0;
      w.segmentBaseKills = state.kills;
      w.segmentKillGoal = next ? next.killGoal : 0;
    }
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
  // 단계별 정예 승격(밴드1=1 / 밴드2=2, STAGE_MILESTONES.eliteCount). 카드에서 먼저 스폰된
  // eliteCount마리를 전용 스트림(OQ-M2-4)에서 뽑은 어픽스로 엘리트화한다. spawnEnemy
  // 뒤라 변칙/단계 HP 배율이 이미 반영된 상태에서 승격된다. 단계1(밴드0)은 승격 없음(불변).
  const eliteCount = stageParams(state.config.stage ?? 1).eliteCount;
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
  // 군체 대발생 변칙 × 침략 단계 HP 배율. 단계1 ×1(불변), 연속 상향(밴드 대표 1/2.2/4.5).
  const hp = Math.round(def.hp * enemyHpMult(state.anomaly) * stageParams(state.config.stage ?? 1).hpMult);
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
  const hp = Math.round(def.hp * enemyHpMult(state.anomaly) * stageParams(state.config.stage ?? 1).hpMult);
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
  // 강제 스크롤(Lane4/5): 스폰 기준점을 플레이어가 아니라 창 중심 전방으로 옮긴다(적이 코스
  // 앞쪽에서 다가오는 정체성). 블록격파는 전방=−Y, 레이싱은 전방=+X. 창 미존재(뱀서류·침공)·
  // 그 외 모드면 baseX/baseY 가 그대로 플레이어 좌표라 RNG 소비·산술이 바이트 동일하다(회귀 0).
  const mode = state.config.planetMode;
  const scrollWin =
    mode === PLANET_MODE.blockBreak || mode === PLANET_MODE.racing ? state.scrollRuntime : undefined;
  let baseX: number;
  let baseY: number;
  if (scrollWin !== undefined && mode === PLANET_MODE.racing) {
    baseX = scrollWin.scrollX + RACING_SPAWN_AHEAD; // 전방 = +X(오른쪽에서 다가온다)
    baseY = scrollWin.scrollY;
  } else if (scrollWin !== undefined) {
    baseX = scrollWin.scrollX; // 블록격파: 전방 = −Y(위에서 내려온다)
    baseY = scrollWin.scrollY - BLOCKBREAK_SPAWN_AHEAD;
  } else {
    baseX = player.x; // 뱀서류·침공·그 외: 플레이어 기준(바이트 동일)
    baseY = player.y;
  }

  switch (formation) {
    case 'ring': {
      // A ring centred on the player, sized so it sits fully off-screen.
      const start = rng.range(-PI, PI);
      for (let i = 0; i < count; i++) {
        const ang = start + (i * TWO_PI) / count;
        out.push({
          x: baseX + cos(ang) * SPAWN_RING_RADIUS,
          y: baseY + sin(ang) * SPAWN_RING_RADIUS,
        });
      }
      break;
    }
    case 'line': {
      // A column entering from a random off-screen side of the viewport.
      const fromLeft = rng.chance(0.5);
      const x0 = baseX + (fromLeft ? -OFFSCREEN_X : OFFSCREEN_X);
      const y0 = baseY + rng.range(-VIEW_HEIGHT * 0.3, VIEW_HEIGHT * 0.3);
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
        let x = baseX;
        let y = baseY;
        if (side === 0) {
          x = baseX + rng.range(-OFFSCREEN_X, OFFSCREEN_X);
          y = baseY - OFFSCREEN_Y;
        } else if (side === 1) {
          x = baseX + rng.range(-OFFSCREEN_X, OFFSCREEN_X);
          y = baseY + OFFSCREEN_Y;
        } else if (side === 2) {
          x = baseX - OFFSCREEN_X;
          y = baseY + rng.range(-OFFSCREEN_Y, OFFSCREEN_Y);
        } else {
          x = baseX + OFFSCREEN_X;
          y = baseY + rng.range(-OFFSCREEN_Y, OFFSCREEN_Y);
        }
        out.push({ x, y });
      }
      break;
    }
    case 'cluster': {
      // A blob offset from the player so it is not on top of them. Offsets and
      // spread doubled for the 2x-scale entities (spread +/-90 -> +/-180).
      const cx = baseX + rng.range(-1, 1) * 1000 + 520;
      const cy = baseY + rng.range(-1, 1) * 800 - 400;
      for (let i = 0; i < count; i++) {
        out.push({ x: cx + rng.range(-180, 180), y: cy + rng.range(-180, 180) });
      }
      break;
    }
  }
  return out;
}
