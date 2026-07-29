/**
 * 적 기체 AAA 비주얼(레인 B) — 자세 추론 · 가독성 계약 · 예산 · **형제 컨테이너 회수**.
 *
 * ## 이 파일이 지키는 것
 * 1. **자세 추론이 sim 을 실제로 되짚는가**(항목 3). `enemyPosture.ts` 는 `src/sim/patterns/index.ts`
 *    의 조종 함수를 위치·각도 델타만으로 재구성한다고 주장한다. 그 주장을 sim 코드가 만들어 내는
 *    **합성 궤적**으로 검증한다 — 자세 상수만 비교하면 "무엇이든 돌려주는" 분류기도 통과한다.
 * 2. **가독성 계약(§2-2)을 수치로 못 박는다.** 시안(색상각 ≈195°)은 아군 전용이므로 적 팔레트에
 *    하나라도 들어오면 빨개진다. 사람이 눈으로 "파랗지 않네" 하고 넘기면 다음 사람이 하늘색을 끼운다.
 * 3. **회수 4경로에서 형제 컨테이너가 실제로 사라지는가.** 순수 유닛으로는 절대 안 잡히고
 *    (모듈 자체는 멀쩡하다) **정규 `render` 경로**로 태워야만 드러난다 — 접지 그림자가 이 회수를
 *    빠뜨려 "사라진 실체의 이펙트가 바닥에 얼어붙는" 결함을 실제로 냈다.
 * 4. **사망 파편이 고아가 되지 않는가.** 파편 풀은 자기 티커가 없어 살아 있는 장식자가 굴려 준다.
 *    아무도 안 남는 순간 전부 회수돼야 한다.
 *
 * ## 결정론
 * render-only 배선만 본다. sim·`hashWorld` 에 손대지 않는다(골든 파일 수정 0).
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Container, Texture } from 'pixi.js';

import { EntityRenderer } from '../src/render/entityRenderer.js';
import { adornerFactoryCount } from '../src/render/entity/adorner.js';
import {
  ENEMY_VISUAL_KINDS,
  MAX_DECORATED_ENEMIES,
  MAX_DEATH_DEBRIS,
  deathDebrisCount,
  enemyAdornerCount,
  movementOf,
  resetEnemyVisualState,
} from '../src/render/entity/enemyVisual.js';
import {
  BAND_TOL,
  BOSS_ACCENT,
  COMMIT_RATIO,
  DMG_CRITICAL,
  DMG_FIRE,
  DMG_OK,
  DMG_SMOKE,
  DMG_SPARK,
  ELITE_ACCENT_COUNT,
  GRUNT_RIM,
  MOVE_EPS,
  POSTURE_CLOSING,
  POSTURE_COMMIT,
  POSTURE_FIRING_BAND,
  POSTURE_NONE,
  POSTURE_RELOCK,
  POSTURE_ROOTED,
  POSTURE_TENDING,
  RELOCK_FRAMES,
  SPAWN_FRAMES,
  THREAT_BOSS,
  THREAT_ELITE,
  THREAT_GRUNT,
  createPostureState,
  damageStage,
  eliteAccent,
  observePosture,
  phaseForId,
  spawnProgress,
  threatAccent,
  threatTier,
} from '../src/render/entity/enemyPosture.js';
import { buildRim, buildSmoke, buildFlame } from '../src/render/entity/enemyParts.js';
import { graphicsSettings } from '../src/render/graphicsSettings.js';
import { graphicsTierController } from '../src/render/graphicsRuntime.js';
import { ELITE_AFFIX_COUNT } from '../src/sim/elite.js';
import { ENEMY_BY_TYPE } from '../data/enemies.js';
import type { PlaceholderTextures } from '../src/render/textures.js';
import type { EntitySnapshot, WorldSnapshot } from '../src/sim/snapshot.js';
import type { EntityKind } from '../src/sim/entities.js';
import { SHIP_TYPES } from '../data/ships/index.js';
import { FACILITY_CATALOG_COUNT } from '../data/invasion/facilities.js';
import { PROP_ROLE_COUNT } from '../data/invasion/props.js';
import { DEFENSE_BOSS_COUNT } from '../data/invasion/defenseBosses.js';

// ---------------------------------------------------------------------------
// 픽스처 — 진짜 Pixi Texture(렌더러가 엔티티마다 new Sprite(tex) 를 만든다)
// ---------------------------------------------------------------------------

function tex(label: string): Texture {
  return new Texture({ source: Texture.EMPTY.source, label });
}

function realTextures(): PlaceholderTextures {
  const arr = (name: string, n: number): Texture[] =>
    Array.from({ length: n }, (_, i) => tex(`${name}[${i}]`));
  return {
    player: tex('player'),
    shipByType: SHIP_TYPES.map((d) => tex(`ship[${d.id}]`)),
    bullet: tex('bullet'),
    enemyBullet: tex('enemyBullet'),
    enemyBulletBehaviors: arr('enemyBulletBehaviors', 4),
    gem: tex('gem'),
    enemy: arr('enemy', 34),
    boss: arr('boss', 6),
    formation: tex('formation'),
    formationDrone: tex('formationDrone'),
    spawnedDrone: tex('spawnedDrone'),
    supply: tex('supply'),
    parachute: null,
    loot: tex('loot'),
    explosion: tex('explosion'),
    background: arr('background', 6),
    wall: tex('wall'),
    destructible: tex('destructible'),
    magnetEmitter: tex('magnetEmitter'),
    bombDevice: tex('bombDevice'),
    turretPickup: tex('turretPickup'),
    shelter: tex('shelter'),
    encounterPortal: tex('encounterPortal'),
    encounterSeal: tex('encounterSeal'),
    encounterAltar: tex('encounterAltar'),
    core: tex('core'),
    guardian: arr('guardian', 2),
    invasionBackdrop: arr('invasionBackdrop', 3),
    facility: arr('facility', FACILITY_CATALOG_COUNT),
    prop: arr('prop', PROP_ROLE_COUNT),
    defenseBoss: arr('defenseBoss', DEFENSE_BOSS_COUNT),
  } as unknown as PlaceholderTextures;
}

function ent(over: Partial<EntitySnapshot> & { id: number }): EntitySnapshot {
  return {
    kind: 'enemy',
    x: 0,
    y: 0,
    angle: 0,
    radius: 30,
    aabbH: 0,
    enemyType: 0,
    hp: 100,
    maxHp: 100,
    active: false,
    flash: false,
    elite: -1,
    ...over,
  };
}

function world(entities: EntitySnapshot[]): WorldSnapshot {
  return {
    tick: 0,
    arenaWidth: 1600,
    arenaHeight: 900,
    cameraX: 0,
    cameraY: 0,
    planet: 0,
    visionRadius: 0,
    safeRadius: 0,
    entities,
    beams: [],
  };
}

/** 레이어 접근(사설 필드 — 회수 검증은 렌더 트리를 직접 봐야 의미가 있다). */
function layers(r: EntityRenderer): { glowLayer: Container; effectLayer: Container } {
  return r as unknown as { glowLayer: Container; effectLayer: Container };
}

/**
 * `performance.now` 를 프레임당 16.7ms 씩 전진하는 결정적 시계로 바꿔 실행한다. 렌더러의 dt 는
 * 벽시계 파생이라 이걸 안 하면 테스트 프레임의 dt 가 0 에 수렴해 시간 기반 거동이 얼어붙는다.
 */
function withClock(body: () => void): void {
  const perf = globalThis.performance as unknown as { now: () => number };
  const original = perf.now.bind(perf);
  let t = original();
  perf.now = (): number => {
    t += 16.7;
    return t;
  };
  try {
    body();
  } finally {
    perf.now = original;
  }
}

/** 실 티어를 못 박는다(glowWiring.test.ts 와 같은 관용구). 자동 강등이 게이트를 흔들면 안 된다. */
function lockTier(tier: 'low' | 'med' | 'high'): void {
  graphicsTierController.tick(60, 1 / 60, tier);
}

beforeEach(() => {
  resetEnemyVisualState();
  graphicsSettings.set({ quality: 'auto', reducedMotion: false, reducedGlow: false });
  lockTier('high');
});

afterEach(() => {
  resetEnemyVisualState();
  graphicsSettings.set({ quality: 'auto', reducedMotion: false, reducedGlow: false });
  lockTier('high');
});

// ===========================================================================
// 등록 — 모듈 최상위 부수효과
// ===========================================================================

describe('등록(모듈 최상위 부수효과)', () => {
  it('import 만으로 적 kind 전부에 팩토리가 등록돼 있다', () => {
    // 초기화 함수 호출 없이 여기까지 왔다 — import 부수효과가 유일한 등록 경로다.
    for (const kind of ENEMY_VISUAL_KINDS) {
      expect(adornerFactoryCount(kind as EntityKind)).toBeGreaterThan(0);
    }
  });

  it('플레이어·탄·젬에는 등록하지 않는다(다른 레인·가독성 계약의 영역)', () => {
    for (const kind of ['player', 'bullet', 'enemyBullet', 'gem', 'loot'] as EntityKind[]) {
      expect(ENEMY_VISUAL_KINDS as readonly string[]).not.toContain(kind);
    }
  });
});

// ===========================================================================
// 항목 1 · 위협도 계층
// ===========================================================================

describe('항목 1 · 위협도 계층', () => {
  it('kind 가 등급을 이긴다 — 보스는 elite 값과 무관하게 보스다', () => {
    expect(threatTier('boss', -1)).toBe(THREAT_BOSS);
    expect(threatTier('defenseBoss', -1)).toBe(THREAT_BOSS);
    expect(threatTier('boss', 3)).toBe(THREAT_BOSS);
    expect(threatTier('enemy', 0)).toBe(THREAT_ELITE);
    expect(threatTier('enemy', 7)).toBe(THREAT_ELITE);
    expect(threatTier('enemy', -1)).toBe(THREAT_GRUNT);
  });

  it('접두사 팔레트가 sim 의 접두사 수와 정확히 같다(사문화·부족 둘 다 실패)', () => {
    expect(ELITE_ACCENT_COUNT).toBe(ELITE_AFFIX_COUNT);
  });

  it('세 등급의 색이 서로 다르다(한눈에 구분 — 항목 1 의 본문)', () => {
    const grunt = threatAccent(THREAT_GRUNT, -1);
    const elite = threatAccent(THREAT_ELITE, 0);
    const boss = threatAccent(THREAT_BOSS, -1);
    expect(new Set([grunt, elite, boss]).size).toBe(3);
    expect(grunt).toBe(GRUNT_RIM);
    expect(boss).toBe(BOSS_ACCENT);
  });

  it('접두사 8색이 서로 구분된다(같은 색 두 개면 접두사가 안 읽힌다)', () => {
    const set = new Set(Array.from({ length: ELITE_AFFIX_COUNT }, (_, i) => eliteAccent(i)));
    expect(set.size).toBe(ELITE_AFFIX_COUNT);
  });

  it('범위 밖 접두사 코드도 유효한 색으로 접힌다(신규 접두사에 화면이 안 깨진다)', () => {
    expect(Number.isInteger(eliteAccent(99))).toBe(true);
    expect(Number.isInteger(eliteAccent(-1))).toBe(true);
  });
});

// ===========================================================================
// 가독성 계약 §2-2 — 시안은 아군 전용
// ===========================================================================

/** 0xRRGGBB → HSL 색상각(도). 무채색이면 null. */
function hueOf(rgb: number): number | null {
  const r = ((rgb >> 16) & 0xff) / 255;
  const g = ((rgb >> 8) & 0xff) / 255;
  const b = (rgb & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const c = max - min;
  if (c < 0.04) return null;
  let h: number;
  if (max === r) h = ((g - b) / c) % 6;
  else if (max === g) h = (b - r) / c + 2;
  else h = (r - g) / c + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

describe('가독성 계약 §2-2 · 시안 금지', () => {
  it('아군 시안(#39d0ff)의 색상각은 금지 대역 안이다(측정기 자체의 대조군)', () => {
    const cyan = hueOf(0x39d0ff);
    expect(cyan).not.toBeNull();
    expect(cyan!).toBeGreaterThan(170);
    expect(cyan!).toBeLessThan(215);
  });

  it('적 팔레트 전체가 시안 대역 [170°,215°] 밖이다', () => {
    const palette = [
      GRUNT_RIM,
      BOSS_ACCENT,
      ...Array.from({ length: ELITE_AFFIX_COUNT }, (_, i) => eliteAccent(i)),
    ];
    const violations = palette
      .map((c) => ({ c, h: hueOf(c) }))
      .filter((x) => x.h !== null && x.h > 170 && x.h < 215)
      .map((x) => `0x${x.c.toString(16)}`);
    expect(violations).toEqual([]);
  });

  it('잡몹 림은 어둡지 않다 — 적을 배경에 잠기게 하면 안 된다(위장률 게이트)', () => {
    // 카르곤 암부에서 적이 사라지는 결함(기준선 6.71%)의 처방이 이 림이다. 어두운 외곽선을
    // 골랐다면 처방이 아니라 악화다.
    const lum =
      0.2126 * ((GRUNT_RIM >> 16) & 0xff) +
      0.7152 * ((GRUNT_RIM >> 8) & 0xff) +
      0.0722 * (GRUNT_RIM & 0xff);
    expect(lum).toBeGreaterThan(180);
  });

  it('연기는 몸통 반경 **밖**에만 산다(유일한 어두운 도형이라 규칙이 엄격하다)', () => {
    const r = 40;
    const g = buildSmoke(r);
    const b = g.getLocalBounds();
    // 가장 왼쪽 가장자리가 원점 오른쪽에 있어야 한다 = 몸통 중심을 덮지 않는다.
    expect(b.minX).toBeGreaterThan(0);
  });

  it('화염은 위로만 뻗는다(아래 실루엣을 남긴다)', () => {
    const b = buildFlame(40).getLocalBounds();
    expect(b.minY).toBeLessThan(0);
    expect(b.maxY).toBeLessThanOrEqual(0.001);
  });

  it('림은 몸통 바깥 원이다(안쪽을 채우지 않는다)', () => {
    const r = 40;
    const b = buildRim(r, GRUNT_RIM).getLocalBounds();
    expect(b.maxX).toBeGreaterThan(r);
  });
});

// ===========================================================================
// 항목 2 · 손상 상태
// ===========================================================================

describe('항목 2 · 손상 상태', () => {
  it('HP 비율이 내려갈수록 단계가 단조 증가한다', () => {
    const stages = [1, 0.8, 0.6, 0.5, 0.3, 0.15, 0.05, 0].map((r) => damageStage(r * 100, 100));
    for (let i = 1; i < stages.length; i++) {
      expect(stages[i]!).toBeGreaterThanOrEqual(stages[i - 1]!);
    }
    expect(stages[0]).toBe(DMG_OK);
    expect(stages[stages.length - 1]).toBe(DMG_CRITICAL);
  });

  it('네 경계가 실제로 다른 단계를 만든다(전 구간 평탄 = 손상이 안 읽힌다)', () => {
    expect(damageStage(70, 100)).toBe(DMG_OK);
    expect(damageStage(50, 100)).toBe(DMG_SPARK);
    expect(damageStage(30, 100)).toBe(DMG_SMOKE);
    expect(damageStage(15, 100)).toBe(DMG_FIRE);
    expect(damageStage(5, 100)).toBe(DMG_CRITICAL);
  });

  it('maxHp 가 0 이하면 무손상으로 접는다(비전투체 방어 — 0 나눗셈 금지)', () => {
    expect(damageStage(0, 0)).toBe(DMG_OK);
    expect(damageStage(10, -5)).toBe(DMG_OK);
  });

  it('엘리트 재생·완강 접두사에서도 비율이 맞는다(관측 최댓값 우회를 쓰지 않는 이유)', () => {
    // 완강한: maxHp 가 스폰 시 크게 오른다. 스냅샷 maxHp 를 쓰므로 스폰 직후에도 무손상이다.
    expect(damageStage(400, 400)).toBe(DMG_OK);
    // 재생하는: HP 가 도로 차오르면 단계가 되돌아온다(관측 최댓값이면 과거에 갇힌다).
    expect(damageStage(30, 400)).toBe(DMG_CRITICAL);
    expect(damageStage(90, 400)).toBe(DMG_SMOKE);
    expect(damageStage(390, 400)).toBe(DMG_OK);
  });
});

// ===========================================================================
// 항목 3 · 예비 동작(telegraph) — sim 조종 함수를 되짚는가
// ===========================================================================

/** 한 스텝 전진시키고 자세를 돌려준다. */
function step(
  s: ReturnType<typeof createPostureState>,
  prev: EntitySnapshot,
  next: EntitySnapshot,
  movement: Parameters<typeof observePosture>[3],
  tick: number,
): number {
  return observePosture(s, next, prev, movement, tick);
}

/**
 * `standoff` 궤적 생성기 — sim 의 `moveStandoff` 를 그대로 따라 만든다:
 * `angle` 은 항상 플레이어 방향, 선호 거리(380±40) 안이면 **수직 스트레이프**, 밖이면 접근/후퇴.
 */
function standoffStep(px: number, py: number, x: number, y: number, speed: number) {
  const dx = px - x;
  const dy = py - y;
  const dist = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  let vx: number;
  let vy: number;
  if (dist > 420) {
    vx = Math.cos(ang) * speed;
    vy = Math.sin(ang) * speed;
  } else if (dist < 340) {
    vx = -Math.cos(ang) * speed;
    vy = -Math.sin(ang) * speed;
  } else {
    vx = Math.cos(ang + Math.PI / 2) * speed * 0.5;
    vy = Math.sin(ang + Math.PI / 2) * speed * 0.5;
  }
  return { x: x + vx, y: y + vy, angle: ang };
}

describe('항목 3 · 예비 동작 — standoff(사수형)', () => {
  it('선호 거리 안에서 수직 스트레이프하면 사격 대역으로 읽는다', () => {
    const s = createPostureState();
    let cur = { x: 380, y: 0, angle: Math.PI };
    let prev = ent({ id: 1, x: cur.x, y: cur.y, angle: cur.angle });
    let posture = POSTURE_NONE;
    for (let i = 0; i < 12; i++) {
      const nx = standoffStep(0, 0, cur.x, cur.y, 3);
      const next = ent({ id: 1, x: nx.x, y: nx.y, angle: nx.angle });
      posture = step(s, prev, next, 'standoff', i);
      prev = next;
      cur = nx;
    }
    expect(posture).toBe(POSTURE_FIRING_BAND);
  });

  it('선호 거리 밖에서 접근하면 사격 대역이 **아니다**(오탐 대조군)', () => {
    const s = createPostureState();
    let cur = { x: 1200, y: 0, angle: Math.PI };
    let prev = ent({ id: 1, x: cur.x, y: cur.y, angle: cur.angle });
    let posture = POSTURE_NONE;
    for (let i = 0; i < 8; i++) {
      const nx = standoffStep(0, 0, cur.x, cur.y, 3);
      const next = ent({ id: 1, x: nx.x, y: nx.y, angle: nx.angle });
      posture = step(s, prev, next, 'standoff', i);
      prev = next;
      cur = nx;
    }
    expect(posture).toBe(POSTURE_CLOSING);
  });

  it('너무 가까워 후퇴할 때도 사격 대역이 아니다', () => {
    const s = createPostureState();
    let cur = { x: 120, y: 0, angle: Math.PI };
    let prev = ent({ id: 1, x: cur.x, y: cur.y, angle: cur.angle });
    let posture = POSTURE_NONE;
    for (let i = 0; i < 6; i++) {
      const nx = standoffStep(0, 0, cur.x, cur.y, 3);
      const next = ent({ id: 1, x: nx.x, y: nx.y, angle: nx.angle });
      posture = step(s, prev, next, 'standoff', i);
      prev = next;
      cur = nx;
    }
    expect(posture).toBe(POSTURE_CLOSING);
  });

  it('접근 → 대역 진입 전 구간을 훑어도 대역 판정이 거리와 정합한다(오탐/미탐 계수)', () => {
    // 1200u 밖에서 출발해 sim 궤적 그대로 200 스텝. 각 스텝의 실거리와 판정을 대조한다.
    const s = createPostureState();
    let cur = { x: 1200, y: 0, angle: Math.PI };
    let prev = ent({ id: 1, x: cur.x, y: cur.y, angle: cur.angle });
    let falsePos = 0;
    let falseNeg = 0;
    let inBand = 0;
    for (let i = 0; i < 200; i++) {
      const nx = standoffStep(0, 0, cur.x, cur.y, 12);
      const next = ent({ id: 1, x: nx.x, y: nx.y, angle: nx.angle });
      const posture = step(s, prev, next, 'standoff', i);
      // sim 기준 진실: 이동 시작 시점의 거리로 대역 여부가 갈린다.
      const truth = Math.hypot(cur.x, cur.y) >= 340 && Math.hypot(cur.x, cur.y) <= 420;
      if (truth) inBand += 1;
      if (!truth && posture === POSTURE_FIRING_BAND) falsePos += 1;
      if (truth && posture !== POSTURE_FIRING_BAND) falseNeg += 1;
      prev = next;
      cur = nx;
    }
    expect(inBand).toBeGreaterThan(100); // 궤적이 실제로 대역에 오래 머문다(표본이 있다)
    expect(falsePos).toBe(0);
    expect(falseNeg).toBe(0);
  });
});

describe('항목 3 · 예비 동작 — chargeStraight(돌격형)', () => {
  it('직진 순항은 커밋으로 읽는다', () => {
    const s = createPostureState();
    let prev = ent({ id: 2, x: 0, y: 0, angle: 0 });
    let posture = POSTURE_NONE;
    for (let i = 0; i < 6; i++) {
      const next = ent({ id: 2, x: (i + 1) * 5, y: 0, angle: 0 });
      posture = step(s, prev, next, 'chargeStraight', i);
      prev = next;
    }
    expect(posture).toBe(POSTURE_COMMIT);
  });

  it('각도가 크게 꺾이면 재조준으로 읽고 그 표시가 여러 프레임 유지된다', () => {
    const s = createPostureState();
    let prev = ent({ id: 2, x: 0, y: 0, angle: 0 });
    for (let i = 0; i < 6; i++) {
      const next = ent({ id: 2, x: (i + 1) * 5, y: 0, angle: 0 });
      step(s, prev, next, 'chargeStraight', i);
      prev = next;
    }
    // 벽 슬라이드/재조준: 한 틱에 90° 꺾인다.
    const turn = ent({ id: 2, x: 35, y: 5, angle: Math.PI / 2 });
    expect(step(s, prev, turn, 'chargeStraight', 6)).toBe(POSTURE_RELOCK);
    prev = turn;
    // 이후 각도가 안정돼도 잔여 창 동안 재조준이 유지된다(한 프레임 번쩍임은 눈이 못 잡는다).
    for (let i = 7; i < 6 + RELOCK_FRAMES; i++) {
      const next = ent({ id: 2, x: 35, y: 5 + (i - 6) * 5, angle: Math.PI / 2 });
      expect(step(s, prev, next, 'chargeStraight', i)).toBe(POSTURE_RELOCK);
      prev = next;
    }
    // 창이 끝나면 다시 커밋.
    const after = ent({ id: 2, x: 35, y: 5 + (RELOCK_FRAMES + 1) * 5, angle: Math.PI / 2 });
    expect(step(s, prev, after, 'chargeStraight', 6 + RELOCK_FRAMES + 1)).toBe(POSTURE_COMMIT);
  });

  it('부동소수 잡음 수준의 각도 흔들림은 재조준으로 오독하지 않는다(오탐 대조군)', () => {
    const s = createPostureState();
    let prev = ent({ id: 2, x: 0, y: 0, angle: 0 });
    let relocks = 0;
    for (let i = 0; i < 40; i++) {
      const jitter = Math.sin(i) * 1e-6;
      const next = ent({ id: 2, x: (i + 1) * 5, y: 0, angle: jitter });
      if (step(s, prev, next, 'chargeStraight', i) === POSTURE_RELOCK) relocks += 1;
      prev = next;
    }
    expect(relocks).toBe(0);
  });

  it('순항 대비 크게 느려지면 커밋이 아니다(막힌 개체를 돌진 중으로 그리지 않는다)', () => {
    const s = createPostureState();
    let prev = ent({ id: 2, x: 0, y: 0, angle: 0 });
    for (let i = 0; i < 6; i++) {
      const next = ent({ id: 2, x: (i + 1) * 10, y: 0, angle: 0 });
      step(s, prev, next, 'chargeStraight', i);
      prev = next;
    }
    // 벽에 눌려 순항의 COMMIT_RATIO 미만으로 기어간다(각도는 유지).
    const crawl = 10 * COMMIT_RATIO * 0.5;
    let posture = POSTURE_NONE;
    for (let i = 6; i < 12; i++) {
      const next = ent({ id: 2, x: prev.x + crawl, y: 0, angle: 0 });
      posture = step(s, prev, next, 'chargeStraight', i);
      prev = next;
    }
    expect(posture).toBe(POSTURE_NONE);
  });
});

describe('항목 3 · 예비 동작 — 지원형·고정형', () => {
  it('seekWounded 가 멈추면 치료 중으로 읽는다(우선 처치 신호)', () => {
    const s = createPostureState();
    const a = ent({ id: 3, x: 100, y: 100, angle: 0 });
    expect(step(s, a, a, 'seekWounded', 0)).toBe(POSTURE_TENDING);
  });

  it('seekWounded 가 이동 중이면 치료 중이 아니다(오탐 대조군)', () => {
    const s = createPostureState();
    const a = ent({ id: 3, x: 0, y: 0, angle: 0 });
    const b = ent({ id: 3, x: 4, y: 0, angle: 0 });
    expect(step(s, a, b, 'seekWounded', 0)).toBe(POSTURE_NONE);
  });

  it('stationary 는 항상 고정 포대다 — **발사 예고를 지어내지 않는다**', () => {
    const s = createPostureState();
    const a = ent({ id: 4, x: 0, y: 0, angle: 0 });
    // 관측 가능한 변화가 전혀 없는 종이라, 어떤 프레임에서도 "충전 중"이 나오면 안 된다.
    for (let i = 0; i < 300; i++) {
      expect(step(s, a, a, 'stationary', i)).toBe(POSTURE_ROOTED);
    }
  });

  it('이동 종류를 모르면 자세를 만들지 않는다(모르는 종에 거짓 예고 금지)', () => {
    const s = createPostureState();
    const a = ent({ id: 5, x: 0, y: 0, angle: 0 });
    const b = ent({ id: 5, x: 50, y: 0, angle: 1.2 });
    expect(step(s, a, b, null, 0)).toBe(POSTURE_NONE);
  });

  it('보스·드론은 카탈로그 밖이라 이동 종류가 null 이다', () => {
    expect(movementOf('boss', 0)).toBeNull();
    expect(movementOf('defenseBoss', 0)).toBeNull();
    expect(movementOf('spawnedDrone', 0)).toBeNull();
  });

  it('일반 적은 카탈로그의 이동 종류를 그대로 읽는다(전 typeIndex)', () => {
    for (let i = 0; i < ENEMY_BY_TYPE.length; i++) {
      expect(movementOf('enemy', i)).toBe(ENEMY_BY_TYPE[i]!.movement);
    }
    expect(movementOf('enemy', 9999)).toBeNull();
  });

  it('BAND_TOL·MOVE_EPS 가 의미 있는 범위다(상수가 판정을 무력화하지 않는다)', () => {
    expect(BAND_TOL).toBeGreaterThan(0);
    expect(BAND_TOL).toBeLessThan(Math.PI / 4); // π/4 를 넘으면 접근/대역이 안 갈린다
    expect(MOVE_EPS).toBeGreaterThan(0);
    expect(MOVE_EPS).toBeLessThan(1);
  });
});

// ===========================================================================
// 항목 4 · 스폰 인 / 항목 6 · 군집 가독성
// ===========================================================================

describe('항목 4 · 스폰 인', () => {
  it('진행도가 0 에서 1 로 단조 증가하고 창 밖은 포화한다', () => {
    expect(spawnProgress(10, 10)).toBe(0);
    expect(spawnProgress(10, 10 + SPAWN_FRAMES / 2)).toBeCloseTo(0.5, 6);
    expect(spawnProgress(10, 10 + SPAWN_FRAMES)).toBe(1);
    expect(spawnProgress(10, 10 + SPAWN_FRAMES * 10)).toBe(1);
    expect(spawnProgress(10, 5)).toBe(0); // 시간 역행 방어
  });

  it('창이 짧다 — 회피 판단을 늦추면 안 된다(60fps 기준 0.5초 미만)', () => {
    expect(SPAWN_FRAMES).toBeGreaterThan(0);
    expect(SPAWN_FRAMES).toBeLessThan(30);
  });
});

describe('항목 6 · 군집 가독성', () => {
  it('위상 오프셋이 [0,2π) 안이고 결정적이다', () => {
    for (const id of [0, 1, 7, 128, 99991]) {
      const p = phaseForId(id);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(Math.PI * 2 + 1e-9);
      expect(phaseForId(id)).toBe(p);
    }
  });

  it('연번으로 스폰된 편대 20기의 위상이 서로 멀리 흩어진다', () => {
    // 편대는 id 를 연번으로 받는다. 선형 함수를 쓰면 다시 같은 박자로 묶인다 — 이 테스트가
    // 그 회귀를 막는다.
    const ps = Array.from({ length: 20 }, (_, i) => phaseForId(1000 + i)).sort((a, b) => a - b);
    let minGap = Infinity;
    for (let i = 1; i < ps.length; i++) minGap = Math.min(minGap, ps[i]! - ps[i - 1]!);
    // 균등 분포라면 간격이 2π/20 ≈ 0.314. 그 절반 이상은 떨어져 있어야 "흩어졌다"고 할 수 있다.
    expect(minGap).toBeGreaterThan(Math.PI / 20);
  });
});

// ===========================================================================
// 정규 render 경로 — 배선 · 회수 4경로 · 예산
// ===========================================================================

describe('정규 render 경로 · 배선과 회수', () => {
  it('적을 세우면 형제 컨테이너가 두 레이어에 실제로 붙는다(배선 증명)', () => {
    const r = new EntityRenderer(realTextures());
    const w = world([ent({ id: 1, elite: 2 })]);
    r.render(w, w, 0);
    const l = layers(r);
    expect(l.glowLayer.children.length).toBeGreaterThan(0);
    expect(l.effectLayer.children.length).toBeGreaterThan(0);
    expect(r.adornerCount).toBeGreaterThan(0);
    r.destroy();
  });

  it('킬 경로: 적이 사라지면 그 개체의 형제 컨테이너가 사라진다(얼어붙지 않는다)', () => {
    const r = new EntityRenderer(realTextures());
    const alive = world([ent({ id: 1 })]);
    r.render(alive, alive, 0);
    const l = layers(r);
    const glowBefore = l.glowLayer.children.length;
    expect(glowBefore).toBeGreaterThan(0);
    const gone = world([]);
    r.render(gone, gone, 0);
    // 파편은 effectLayer 로 가지만 glowLayer 의 개체 소유 컨테이너는 반드시 0 이다.
    expect(l.glowLayer.children.length).toBe(0);
    expect(r.adornerCount).toBe(0);
    r.destroy();
  });

  it('reset 경로: 전 개체 회수 + 파편도 함께 사라진다', () => {
    const r = new EntityRenderer(realTextures());
    const w = world([ent({ id: 1 }), ent({ id: 2 }), ent({ id: 3 })]);
    r.render(w, w, 0);
    expect(r.adornerCount).toBeGreaterThan(0);
    r.reset();
    expect(r.adornerCount).toBe(0);
    expect(enemyAdornerCount()).toBe(0);
    expect(deathDebrisCount()).toBe(0);
    expect(layers(r).glowLayer.children.length).toBe(0);
    r.destroy();
  });

  it('destroy 경로: 장식자·파편 카운터가 0 으로 돌아온다', () => {
    const r = new EntityRenderer(realTextures());
    const w = world([ent({ id: 1 }), ent({ id: 2 })]);
    r.render(w, w, 0);
    r.destroy();
    expect(enemyAdornerCount()).toBe(0);
    expect(deathDebrisCount()).toBe(0);
  });

  it('보스는 스폰 연출이 스프라이트 밝기를 건드리지 않는다(보스 분기가 alpha 를 전유한다)', () => {
    const r = new EntityRenderer(realTextures());
    const w = world([ent({ id: 9, kind: 'boss', active: true, elite: -1 })]);
    r.render(w, w, 0);
    const sprites = (r as unknown as { sprites: Map<number, { sprite: { alpha: number } }> })
      .sprites;
    const t = sprites.get(9);
    expect(t).toBeDefined();
    // 보스 과열 맥동이 정한 값(0.8~1.0)이 그대로 남아야 한다 — 스폰 램프가 덮으면 0.35 가 나온다.
    expect(t!.sprite.alpha).toBeGreaterThanOrEqual(0.8);
    r.destroy();
  });

  it('일반 적은 스폰 창이 끝나면 밝기가 정확히 1 로 돌아온다(밝기 조작 잔여 0)', () => {
    const r = new EntityRenderer(realTextures());
    const w = world([ent({ id: 1 })]);
    for (let i = 0; i <= SPAWN_FRAMES + 2; i++) r.render(w, w, 0);
    const sprites = (r as unknown as { sprites: Map<number, { sprite: { alpha: number } }> })
      .sprites;
    expect(sprites.get(1)!.sprite.alpha).toBe(1);
    r.destroy();
  });
});

describe('예산 — 개체당 비용이 20~40 배로 곱해진다', () => {
  it('잡몹 장식은 정원까지만 붙는다(정원 밖은 할당 0)', () => {
    const r = new EntityRenderer(realTextures());
    const many = Array.from({ length: MAX_DECORATED_ENEMIES + 25 }, (_, i) =>
      ent({ id: i + 1, x: i * 10 }),
    );
    const w = world(many);
    r.render(w, w, 0);
    // 장식자는 전부 붙지만(회수 계약을 위해) 컨테이너를 만든 것은 정원까지다.
    expect(r.adornerCount).toBe(many.length);
    expect(layers(r).glowLayer.children.length).toBe(MAX_DECORATED_ENEMIES);
    r.destroy();
  });

  it('보스·엘리트는 정원과 무관하게 장식된다(자를 것은 수가 많은 쪽이다)', () => {
    const r = new EntityRenderer(realTextures());
    const grunts = Array.from({ length: MAX_DECORATED_ENEMIES + 10 }, (_, i) =>
      ent({ id: i + 1, x: i * 10 }),
    );
    const w = world([...grunts, ent({ id: 9001, elite: 3, x: -500 })]);
    r.render(w, w, 0);
    // 정원이 이미 잡몹으로 가득 찼는데도 엘리트 몫이 더 붙어 있다.
    expect(layers(r).glowLayer.children.length).toBe(MAX_DECORATED_ENEMIES + 1);
    r.destroy();
  });

  it('정원은 개체가 죽으면 반납된다(장시간 런에서 장식이 영영 사라지지 않는다)', () => {
    const r = new EntityRenderer(realTextures());
    const many = Array.from({ length: MAX_DECORATED_ENEMIES }, (_, i) => ent({ id: i + 1 }));
    const full = world(many);
    r.render(full, full, 0);
    expect(layers(r).glowLayer.children.length).toBe(MAX_DECORATED_ENEMIES);
    // 전부 죽이고 새 무리를 세운다 — 반납이 없으면 여기서 0 이 된다.
    const empty = world([]);
    r.render(empty, empty, 0);
    const fresh = world(Array.from({ length: 5 }, (_, i) => ent({ id: 5000 + i })));
    r.render(fresh, fresh, 0);
    expect(layers(r).glowLayer.children.length).toBe(5);
    r.destroy();
  });

  it('low 티어는 잡몹 장식을 만들지 않는다(티어 게이트)', () => {
    lockTier('low');
    const r = new EntityRenderer(realTextures());
    const w = world([ent({ id: 1 }), ent({ id: 2 })]);
    r.render(w, w, 0);
    expect(layers(r).glowLayer.children.length).toBe(0);
    r.destroy();
  });

  it('reducedGlow 는 가산 오라·예비동작을 끈다(광과민 대응)', () => {
    graphicsSettings.set({ quality: 'auto', reducedMotion: false, reducedGlow: true });
    lockTier('high');
    const r = new EntityRenderer(realTextures());
    const w = world([ent({ id: 1, elite: 0 })]);
    r.render(w, w, 0);
    // 가산 레이어에 아무것도 남지 않아야 한다(컨테이너는 있되 비어 있다).
    const glow = layers(r).glowLayer;
    const own = glow.children[0] as Container | undefined;
    expect(own?.children.length ?? 0).toBe(0);
    r.destroy();
  });
});

describe('사망 연출 — 고아 이펙트가 구조적으로 불가능하다', () => {
  it('다른 적이 남아 있을 때 처치하면 파편이 방출된다', () => {
    const r = new EntityRenderer(realTextures());
    const two = world([ent({ id: 1 }), ent({ id: 2, x: 200 })]);
    r.render(two, two, 0);
    expect(deathDebrisCount()).toBe(0);
    const one = world([ent({ id: 2, x: 200 })]);
    r.render(one, one, 0);
    expect(deathDebrisCount()).toBeGreaterThan(0);
    r.destroy();
  });

  it('마지막 적을 처치하면 파편이 남지 않는다(굴려 줄 주체가 없다)', () => {
    const r = new EntityRenderer(realTextures());
    const one = world([ent({ id: 1 })]);
    r.render(one, one, 0);
    const none = world([]);
    r.render(none, none, 0);
    expect(deathDebrisCount()).toBe(0);
    expect(layers(r).effectLayer.children.length).toBe(r.effectCount);
    r.destroy();
  });

  it('파편은 시간이 지나면 스스로 사라진다(누적 없음)', () => {
    const r = new EntityRenderer(realTextures());
    const two = world([ent({ id: 1 }), ent({ id: 2, x: 200 })]);
    r.render(two, two, 0);
    const one = world([ent({ id: 2, x: 200 })]);
    r.render(one, one, 0);
    expect(deathDebrisCount()).toBeGreaterThan(0);
    // 살아남은 적이 계속 프레임을 굴린다 → 수명이 다한 파편이 회수된다.
    // ⚠️ `EntityRenderer.render` 는 dt 를 **벽시계**로 잡는다. 테스트는 프레임이 0ms 간격으로
    // 돌아 dt 가 사실상 0 이므로, 시계를 직접 밀지 않으면 파편이 영원히 늙지 않는다(그 상태로
    // "수명이 다하면 사라진다"를 통과시키면 항진 테스트가 된다).
    withClock(() => {
      for (let i = 0; i < 90; i++) r.render(one, one, 0);
    });
    expect(deathDebrisCount()).toBe(0);
    r.destroy();
  });

  it('파편 수가 상한을 넘지 않는다(대량 전멸에서도 예산 고정)', () => {
    const r = new EntityRenderer(realTextures());
    const many = Array.from({ length: 30 }, (_, i) => ent({ id: i + 1, x: i * 20 }));
    const w = world(many);
    r.render(w, w, 0);
    // 하나만 남기고 전부 처치.
    const last = world([ent({ id: 1 })]);
    r.render(last, last, 0);
    expect(deathDebrisCount()).toBeLessThanOrEqual(MAX_DEATH_DEBRIS);
    expect(deathDebrisCount()).toBeGreaterThan(0);
    r.destroy();
  });

  it('low 티어는 파편을 만들지 않는다(티어 게이트)', () => {
    lockTier('low');
    const r = new EntityRenderer(realTextures());
    const two = world([ent({ id: 1 }), ent({ id: 2, x: 200 })]);
    r.render(two, two, 0);
    const one = world([ent({ id: 2, x: 200 })]);
    r.render(one, one, 0);
    expect(deathDebrisCount()).toBe(0);
    r.destroy();
  });
});
