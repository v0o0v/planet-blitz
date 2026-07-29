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
  MAX_BODY_GLOW,
  MAX_CONCURRENT_SPAWNS,
  REATTACH_WINDOW,
  activeBodyGlowCount,
  activeSpawnCount,
  deathDebrisCount,
  enemyAdornerCount,
  deathDebrisEmitted,
  deathSignatureCounts,
  observedPlayerPos,
  movementOf,
  resetEnemyVisualState,
} from '../src/render/entity/enemyVisual.js';
import {
  AIM_LOCK,
  BAND_TOL,
  COMMIT_RANGE,
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
import {
  buildEliteAura,
  buildSmoke,
  buildFlame,
  buildMuzzleCharge,
  buildDashSmear,
  buildSpawnHalo,
  buildBossInsignia,
  buildEliteInsignia,
} from '../src/render/entity/enemyParts.js';
import { createWorld, stepWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import { autopilotInput } from '../src/sim/autopilot.js';
import { snapshotWorld } from '../src/sim/snapshot.js';
import { graphicsSettings } from '../src/render/graphicsSettings.js';
import { themeFor } from '../src/render/env/themes/index.js';
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

/**
 * 라벨로 센 개체 소유 컨테이너 수. 레이어 자식 수를 그냥 세면 **사망 파편**(같은 레이어에
 * 산다)이 섞여 예산 단언이 조용히 틀린다 — 실제로 한 번 그렇게 틀렸다. §2-4 귀속 라벨이
 * 여기서 그대로 쓰인다.
 */
function ownCount(r: EntityRenderer, label: string): number {
  const l = layers(r);
  let n = 0;
  for (const c of [...l.glowLayer.children, ...l.effectLayer.children]) {
    if (c.label === label) n += 1;
  }
  return n;
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
    // **원반의 가장자리까지** 몸통 반경 밖이어야 한다. 1차는 `minX > 0`(중심만 밖)이라
    // 원반이 0.85r 까지 몸통을 파고들어도 통과했다 — 주석이 코드보다 강했던 자리다.
    expect(b.minX).toBeGreaterThanOrEqual(r);
  });

  it('화염은 위로만 뻗는다(아래 실루엣을 남긴다)', () => {
    const b = buildFlame(40).getLocalBounds();
    expect(b.minY).toBeLessThan(0);
    expect(b.maxY).toBeLessThanOrEqual(0.001);
  });

  it('엘리트 오라가 몸 경계에 붙는다(§2-5 선택 링 금지)', () => {
    // 1차 반려 사유의 정의가 "몸통 밖 완전한 원" 이었는데 오라는 삭제 목록에 없었다는 이유로
    // 1.45r 동심 원 3줄로 살아남았다. 몸에 붙어야 링이 아니라 발광으로 읽힌다.
    const r = 40;
    const b = buildEliteAura(r, GRUNT_RIM).getLocalBounds();
    expect(b.maxX).toBeLessThanOrEqual(r * 1.2);
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
  player: { x: number; y: number } | null = null,
): number {
  return observePosture(s, next, prev, movement, tick, player);
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
  /** 조준선 위에 선 플레이어(진행 방향 앞 400u). */
  const ON_LINE = { x: 400, y: 0 };

  it('나를 조준선 안에 두고 달려오면 커밋으로 읽는다', () => {
    const s = createPostureState();
    let prev = ent({ id: 2, x: 0, y: 0, angle: 0 });
    let posture = POSTURE_NONE;
    for (let i = 0; i < 6; i++) {
      const next = ent({ id: 2, x: (i + 1) * 5, y: 0, angle: 0 });
      posture = step(s, prev, next, 'chargeStraight', i, ON_LINE);
      prev = next;
    }
    expect(posture).toBe(POSTURE_COMMIT);
  });

  it('**같은 속도로 달려도 조준선이 빗나가면 커밋이 아니다** — 1차 88.9% 듀티의 원인', () => {
    // 1차는 "빠르게 직진 중" 만으로 커밋을 냈다. `moveCharge` 는 속도를 바꾸지 않으므로 그
    // 조건은 순항 내내 참이고, 그래서 예고가 상시 켜져 배경이 됐다. 같은 궤적·같은 속도에서
    // 표적만 옆으로 치우면 꺼져야 한다.
    const s = createPostureState();
    let prev = ent({ id: 2, x: 0, y: 0, angle: 0 });
    let posture = POSTURE_NONE;
    const OFF_LINE = { x: 400, y: 400 }; // 조준선에서 45° 벗어남
    for (let i = 0; i < 6; i++) {
      const next = ent({ id: 2, x: (i + 1) * 5, y: 0, angle: 0 });
      posture = step(s, prev, next, 'chargeStraight', i, OFF_LINE);
      prev = next;
    }
    expect(posture).toBe(POSTURE_NONE);
  });

  it('조준선 안이어도 너무 멀면 커밋이 아니다(피할 시간이 충분하다)', () => {
    const s = createPostureState();
    let prev = ent({ id: 2, x: 0, y: 0, angle: 0 });
    let posture = POSTURE_NONE;
    const FAR = { x: COMMIT_RANGE + 200, y: 0 };
    for (let i = 0; i < 6; i++) {
      const next = ent({ id: 2, x: (i + 1) * 5, y: 0, angle: 0 });
      posture = step(s, prev, next, 'chargeStraight', i, FAR);
      prev = next;
    }
    expect(posture).toBe(POSTURE_NONE);
  });

  it('플레이어를 못 봤으면 커밋을 주장하지 않는다', () => {
    const s = createPostureState();
    let prev = ent({ id: 2, x: 0, y: 0, angle: 0 });
    let posture = POSTURE_NONE;
    for (let i = 0; i < 6; i++) {
      const next = ent({ id: 2, x: (i + 1) * 5, y: 0, angle: 0 });
      posture = step(s, prev, next, 'chargeStraight', i, null);
      prev = next;
    }
    expect(posture).toBe(POSTURE_NONE);
  });

  it('조준선 오차 임계가 판정을 무력화하지 않는 범위다', () => {
    expect(AIM_LOCK).toBeGreaterThan(0);
    expect(AIM_LOCK).toBeLessThan(Math.PI / 8); // 22.5° 를 넘으면 사실상 항상 참이 된다
    expect(COMMIT_RANGE).toBeGreaterThan(0);
  });

  it('각도가 크게 꺾이면 재조준으로 읽고 그 표시가 여러 프레임 유지된다', () => {
    const s = createPostureState();
    let prev = ent({ id: 2, x: 0, y: 0, angle: 0 });
    for (let i = 0; i < 6; i++) {
      const next = ent({ id: 2, x: (i + 1) * 5, y: 0, angle: 0 });
      step(s, prev, next, 'chargeStraight', i, ON_LINE);
      prev = next;
    }
    // 벽 슬라이드/재조준: 한 틱에 90° 꺾인다.
    const turn = ent({ id: 2, x: 35, y: 5, angle: Math.PI / 2 });
    expect(step(s, prev, turn, 'chargeStraight', 6, ON_LINE)).toBe(POSTURE_RELOCK);
    prev = turn;
    // 이후 각도가 안정돼도 잔여 창 동안 재조준이 유지된다(한 프레임 번쩍임은 눈이 못 잡는다).
    for (let i = 7; i < 6 + RELOCK_FRAMES; i++) {
      const next = ent({ id: 2, x: 35, y: 5 + (i - 6) * 5, angle: Math.PI / 2 });
      expect(step(s, prev, next, 'chargeStraight', i, ON_LINE)).toBe(POSTURE_RELOCK);
      prev = next;
    }
    // 창이 끝나면 새 진행 방향(+y) 위의 표적에 대해 다시 커밋.
    const below = { x: 35, y: 400 };
    const after = ent({ id: 2, x: 35, y: 5 + (RELOCK_FRAMES + 1) * 5, angle: Math.PI / 2 });
    expect(step(s, prev, after, 'chargeStraight', 6 + RELOCK_FRAMES + 1, below)).toBe(
      POSTURE_COMMIT,
    );
  });

  it('부동소수 잡음 수준의 각도 흔들림은 재조준으로 오독하지 않는다(오탐 대조군)', () => {
    const s = createPostureState();
    let prev = ent({ id: 2, x: 0, y: 0, angle: 0 });
    let relocks = 0;
    for (let i = 0; i < 40; i++) {
      const jitter = Math.sin(i) * 1e-6;
      const next = ent({ id: 2, x: (i + 1) * 5, y: 0, angle: jitter });
      if (step(s, prev, next, 'chargeStraight', i, ON_LINE) === POSTURE_RELOCK) relocks += 1;
      prev = next;
    }
    expect(relocks).toBe(0);
  });

  it('순항 대비 크게 느려지면 커밋이 아니다(막힌 개체를 돌진 중으로 그리지 않는다)', () => {
    const s = createPostureState();
    let prev = ent({ id: 2, x: 0, y: 0, angle: 0 });
    for (let i = 0; i < 6; i++) {
      const next = ent({ id: 2, x: (i + 1) * 10, y: 0, angle: 0 });
      step(s, prev, next, 'chargeStraight', i, ON_LINE);
      prev = next;
    }
    // 벽에 눌려 순항의 COMMIT_RATIO 미만으로 기어간다(각도는 유지).
    const crawl = 10 * COMMIT_RATIO * 0.5;
    let posture = POSTURE_NONE;
    for (let i = 6; i < 12; i++) {
      const next = ent({ id: 2, x: prev.x + crawl, y: 0, angle: 0 });
      posture = step(s, prev, next, 'chargeStraight', i, ON_LINE);
      prev = next;
    }
    expect(posture).toBe(POSTURE_NONE);
  });
});

// ===========================================================================
// 항목 3 · 예비 동작 듀티 — **진짜 sim 을 돌려서 잰다**
// ===========================================================================

describe('항목 3 · 돌진 예고 듀티 (실 sim · 실전투 구간)', () => {
  /**
   * ## 이 테스트는 두 번 틀렸다 — 세 번째다
   *
   * 1차: **합성 궤적**으로 쟀다. "내가 만든 상황" 이라 아무것도 증명하지 못했고 하네스 실측이
   *   88.9% 였다.
   * 2차: 실 sim 으로 옮긴 것까지는 옳았는데 **측정 창을 `createWorld` 직후 첫 120틱**으로 잡았다.
   *   그 구간엔 차저가 멀리 있어 조준선 오차가 커 커밋이 거의 안 뜬다 → 5.57%. 워밍업 300틱 뒤
   *   실전투 구간에서 다시 재면 **25~53%** 였다. 게다가 "3시드" 중 둘이 **차저 표본 0** 이라
   *   집계 592 가 전부 한 시드에서 나왔고, 합산에만 걸린 `total > 200` 항진 가드가 그 구멍을
   *   못 막았다.
   *
   * 그래서 3차는 셋을 동시에 바꾼다:
   *  - **워밍업 300틱 뒤**의 120틱을 잰다(플레이어가 예고를 실제로 필요로 하는 구간).
   *  - 표본 하한을 **시드마다 개별로** 단언한다(합산 뒤에 숨지 못하게).
   *  - 시드를 표본이 실제로 잡히는 것으로 고른다.
   *
   * 게이트는 **15%** 다. 예고는 드물어야 예고다(`enemyPosture.ts` 가 스스로 그렇게 쓰고 있다).
   */
  function commitDuty(seed: number, warmup: number, ticks: number): { commit: number; total: number } {
    const state = createWorld(seed, DEFAULT_CONFIG);
    const states = new Map<number, ReturnType<typeof createPostureState>>();
    let prevSnap = snapshotWorld(state);
    let commit = 0;
    let total = 0;
    for (let t = 0; t < warmup + ticks; t++) {
      stepWorld(state, autopilotInput(state));
      const snap = snapshotWorld(state);
      const player = snap.entities.find((x) => x.kind === 'player') ?? null;
      const prevById = new Map(prevSnap.entities.map((x) => [x.id, x]));
      for (const e of snap.entities) {
        if (e.kind !== 'enemy') continue;
        const mv = movementOf(e.kind, e.enemyType);
        if (mv !== 'chargeStraight') continue;
        let ps = states.get(e.id);
        if (ps === undefined) {
          ps = createPostureState();
          states.set(e.id, ps);
        }
        // 자세 상태는 워밍업 동안에도 갱신해야 순항 추정이 실전투 구간에서 정확하다.
        const posture = observePosture(ps, e, prevById.get(e.id) ?? e, mv, t, player);
        if (t >= warmup) {
          total += 1;
          if (posture === POSTURE_COMMIT) commit += 1;
        }
      }
      prevSnap = snap;
      if (state.gameOver || state.victory) break;
    }
    return { commit, total };
  }

  const WARMUP = 300;
  const WINDOW = 120;
  const SEEDS = [1, 2, 3, 0xa07077];

  for (const seed of SEEDS) {
    it(`시드 ${seed}: 실전투 구간 커밋 듀티가 15% 이하다`, () => {
      const r = commitDuty(seed, WARMUP, WINDOW);
      // **시드마다** 표본을 요구한다. 합산에만 걸면 표본 0 인 시드가 조용히 묻힌다(2차의 구멍).
      expect(r.total).toBeGreaterThan(50);
      // 실측(3차): 시드 1/2/3/0xa07077 = 0.37% / 12.08% / 2.92% / 6.65%.
      // 같은 창에서 2차 코드는 25.09% / 52.92% / 9.44% / 27.47% 였다.
      expect(r.commit / r.total).toBeLessThanOrEqual(0.15);
    });
  }

  it('예고가 아예 안 뜨는 것도 아니다(듀티 0 은 기능 소실이다)', () => {
    // 상한만 걸면 "항상 꺼짐" 이 만점이 된다. 네 시드 합산으로 하한도 건다.
    let commit = 0;
    for (const seed of SEEDS) commit += commitDuty(seed, WARMUP, WINDOW).commit;
    expect(commit).toBeGreaterThan(0);
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
    r.setEnvPlanet(0); // 림라이트는 광원(테마)이 있어야 켜진다 — 개체당 컨테이너의 근거다
    const many = Array.from({ length: MAX_DECORATED_ENEMIES + 25 }, (_, i) =>
      ent({ id: i + 1, x: i * 10 }),
    );
    const w = world(many);
    r.render(w, w, 0);
    // 장식자는 전부 붙지만(회수 계약을 위해) 컨테이너를 만든 것은 정원까지다.
    expect(r.adornerCount).toBe(many.length);
    // 개체당 **항상** 생기는 것은 상위 레이어의 림 컨테이너다(가산 쪽은 스폰 정원 때문에
    // 일부만 만들어진다 — 그것도 §2-4 예산 장치라 정상이다).
    expect(ownCount(r, 'enemyBelow')).toBe(MAX_DECORATED_ENEMIES);
    r.destroy();
  });

  it('보스·엘리트는 정원과 무관하게 장식된다(자를 것은 수가 많은 쪽이다)', () => {
    const r = new EntityRenderer(realTextures());
    r.setEnvPlanet(0);
    const grunts = Array.from({ length: MAX_DECORATED_ENEMIES + 10 }, (_, i) =>
      ent({ id: i + 1, x: i * 10 }),
    );
    const w = world([...grunts, ent({ id: 9001, elite: 3, x: -500 })]);
    r.render(w, w, 0);
    // 정원이 이미 잡몹으로 가득 찼는데도 엘리트 몫이 더 붙어 있다.
    expect(ownCount(r, 'enemyBelow')).toBe(MAX_DECORATED_ENEMIES + 1);
    r.destroy();
  });

  it('정원은 개체가 죽으면 반납된다(장시간 런에서 장식이 영영 사라지지 않는다)', () => {
    const r = new EntityRenderer(realTextures());
    r.setEnvPlanet(0);
    const many = Array.from({ length: MAX_DECORATED_ENEMIES }, (_, i) => ent({ id: i + 1 }));
    const full = world(many);
    r.render(full, full, 0);
    expect(ownCount(r, 'enemyBelow')).toBe(MAX_DECORATED_ENEMIES);
    // 전부 죽이고 새 무리를 세운다 — 반납이 없으면 여기서 0 이 된다.
    const empty = world([]);
    r.render(empty, empty, 0);
    const fresh = world(Array.from({ length: 5 }, (_, i) => ent({ id: 5000 + i })));
    r.render(fresh, fresh, 0);
    expect(ownCount(r, 'enemyBelow')).toBe(5);
    r.destroy();
  });

  it('low 티어는 잡몹 장식을 **두 레이어 모두** 만들지 않는다(티어 게이트)', () => {
    // 가산 레이어만 보면 티어 게이트를 무력화해도 통과한다 — low 티어는 `gates.halo` 가
    // 이미 false 라 가산 쪽이 저절로 비기 때문이다(뮤테이션에서 실제로 살아남았다).
    // 잡몹 림이 사는 **상위 레이어**까지 봐야 티어 사다리가 검증된다.
    lockTier('low');
    const r = new EntityRenderer(realTextures());
    const w = world([ent({ id: 1 }), ent({ id: 2 })]);
    r.render(w, w, 0);
    expect(layers(r).glowLayer.children.length).toBe(0);
    expect(layers(r).effectLayer.children.length).toBe(0);
    r.destroy();
  });

  it('low 티어에서도 엘리트 계급장은 남는다(정보는 티어 사다리에서 마지막에 잘린다)', () => {
    lockTier('low');
    const r = new EntityRenderer(realTextures());
    const w = world([ent({ id: 1, elite: 5 })]);
    r.render(w, w, 0);
    expect(layers(r).effectLayer.children.length).toBeGreaterThan(0);
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

  it('마지막 적을 처치하면 파편을 **방출조차 하지 않는다**(굴려 줄 주체가 없다)', () => {
    // 살아 있는 수(=0)만 보면 "뿌린 뒤 즉시 걷었다" 와 구분이 안 된다 — 사전 가드를 검증하려면
    // 누적 방출 수를 봐야 한다. 실제로 이 구분이 없을 때 사전 가드가 뮤테이션에서 살아남았다.
    const r = new EntityRenderer(realTextures());
    const one = world([ent({ id: 1 })]);
    r.render(one, one, 0);
    const none = world([]);
    r.render(none, none, 0);
    expect(deathDebrisEmitted()).toBe(0);
    expect(deathDebrisCount()).toBe(0);
    expect(layers(r).effectLayer.children.length).toBe(r.effectCount);
    r.destroy();
  });

  it('이미 뿌려진 파편도 마지막 적이 죽는 순간 함께 걷힌다(사후 회수)', () => {
    // 사전 가드만으로는 못 막는 경우다: 남은 적이 있을 때 뿌린 파편이 화면에 떠 있는 상태에서
    // 나머지가 전멸하면, 굴려 줄 주체가 사라져 그 파편이 **얼어붙는다**. 사후 회수가 그 자리를
    // 막는 유일한 장치이고, 이 시나리오를 만들지 않으면 회수를 지워도 테스트가 그린이다.
    const r = new EntityRenderer(realTextures());
    const three = world([ent({ id: 1 }), ent({ id: 2, x: 200 }), ent({ id: 3, x: 400 })]);
    r.render(three, three, 0);
    const two = world([ent({ id: 2, x: 200 }), ent({ id: 3, x: 400 })]);
    r.render(two, two, 0);
    expect(deathDebrisCount()).toBeGreaterThan(0); // 살아 있는 파편이 실제로 떠 있다
    const none = world([]);
    r.render(none, none, 0);
    expect(deathDebrisEmitted()).toBeGreaterThan(0); // 방출은 있었고
    expect(deathDebrisCount()).toBe(0); // 남은 것은 0 이어야 한다
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

// ===========================================================================
// §2-5 UI 어휘 금지 — 1차 반려의 본체
// ===========================================================================

describe('§2-5 · UI 어휘 금지', () => {
  /**
   * 이 절의 테스트는 "예쁨" 을 재지 않는다. **어휘가 구조로 드러나는 성질**만 잰다 —
   * 십자선은 사방 대칭 눈금이고, 조준 마커는 몸에서 멀리 뻗는 선이며, 선택 링은 완전한 원이다.
   * 그 성질을 도형의 경계 상자와 도달 거리로 못 박아, 다음 사람이 "링 하나만 더" 를 넣으면
   * 빨개지게 한다.
   */

  it('스폰 연출이 몸에서 멀리 뻗는 축을 만들지 않는다(레티클 수직선 금지)', () => {
    const r = 40;
    const b = buildSpawnHalo(r, GRUNT_RIM).getLocalBounds();
    // 세로/가로 종횡비가 1 에 가깝다 = 방향축이 없는 등방 헤일로. 1차의 워프 기둥은
    // 세로가 가로의 5배가 넘어 레티클 수직선으로 읽혔다.
    const ratio = (b.maxY - b.minY) / (b.maxX - b.minX);
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThan(1.25);
  });

  it('사격 예고가 몸 앞 1.2r 안에 머문다(HUD 조준선 금지)', () => {
    const r = 40;
    const b = buildMuzzleCharge(r, GRUNT_RIM).getLocalBounds();
    // 1차 조준선은 5.5r 까지 뻗어 화면에 선을 그었다.
    expect(b.maxX).toBeLessThanOrEqual(r * 1.25);
  });

  it('돌진 예고가 **뒤로** 흐른다(앞을 가리키는 표식이 아니다)', () => {
    const r = 40;
    const b = buildDashSmear(r, GRUNT_RIM).getLocalBounds();
    // 진행 방향(+x) 앞쪽 도달이 뒤쪽보다 훨씬 작아야 한다 = 속도 잔상이지 조준 쐐기가 아니다.
    expect(Math.abs(b.minX)).toBeGreaterThan(Math.abs(b.maxX) * 2);
  });

  it('보스 룬이 **비정사각** 본체에서도 두 축 모두 몸 위에 앉는다', () => {
    // 2차 테스트는 항진이었다: 룬 경계 상자를 **자기 궤도 파라미터**와 비교해서
    // `orbit + s <= 1.25r` 인 한 무조건 통과했다. 본체 치수와 대조하지 않는 단언은
    // "몸에 붙었다"를 증명하지 못한다. 그래서 3:4 비정사각을 주고 축을 따로 잰다 —
    // 원 궤도를 폭 하나로 잡던 구현은 짧은 축에서 몸 안, 긴 축에서 몸 밖으로 나가 여기서 깨진다.
    const halfW = 60;
    const halfH = 80;
    const b = buildBossInsignia(halfW, halfH, GRUNT_RIM).getLocalBounds();
    expect(b.maxX).toBeGreaterThanOrEqual(halfW * 0.8);
    expect(b.maxX).toBeLessThanOrEqual(halfW * 1.05);
    expect(b.maxY).toBeGreaterThanOrEqual(halfH * 0.8);
    expect(b.maxY).toBeLessThanOrEqual(halfH * 1.05);
    // 대칭 — 네 가장자리 전부에 앉는다.
    expect(b.minX).toBeCloseTo(-b.maxX, 6);
    expect(b.minY).toBeCloseTo(-b.maxY, 6);
  });

  it('엘리트 계급장이 본체에 겹쳐 붙는다(몸에서 떠 있으면 선택 링 인상을 굳힌다)', () => {
    const r = 40;
    const b = buildEliteInsignia(r, GRUNT_RIM).getLocalBounds();
    // 1차는 -1.3r 부터 시작해 몸 위 허공에 떠 있었다.
    expect(b.minY).toBeGreaterThan(-r * 1.25);
  });
});

// ===========================================================================
// 스폰 시점 — 화면 재구성은 스폰이 아니다 (1차 CRITICAL)
// ===========================================================================

describe('스폰 시점 · reset 은 스폰이 아니다', () => {
  it('reset 직후 재부착에서는 스폰 연출이 재생되지 않는다', () => {
    // 1차는 `onAttach` 를 탄생으로 쳐서 화면 전환마다 전 적이 동시에 물질화했다
    // (보스전 실측 bright 1.88% → 12.22%, §2-4 상한 7% 의 1.75배).
    const r = new EntityRenderer(realTextures());
    const w = world([ent({ id: 1 }), ent({ id: 2, x: 200 }), ent({ id: 3, x: 400 })]);
    r.render(w, w, 0);
    expect(activeSpawnCount()).toBe(3); // 진짜 스폰
    // 연출을 끝까지 돌린 뒤 화면 전환(reset) → 다음 프레임 재부착.
    for (let i = 0; i <= SPAWN_FRAMES + 2; i++) r.render(w, w, 0);
    expect(activeSpawnCount()).toBe(0);
    r.reset();
    r.render(w, w, 0);
    expect(activeSpawnCount()).toBe(0); // 재부착은 신생이 아니다
    r.destroy();
  });

  it('재부착 창이 지난 뒤 같은 id 가 다시 나오면 신생으로 본다(id 재사용)', () => {
    const r = new EntityRenderer(realTextures());
    const w = world([ent({ id: 1 })]);
    const empty = world([]);
    r.render(w, w, 0);
    for (let i = 0; i <= SPAWN_FRAMES + 2; i++) r.render(w, w, 0);
    r.render(empty, empty, 0);
    // 창(REATTACH_WINDOW)보다 넉넉히 지나간다.
    for (let i = 0; i < REATTACH_WINDOW + 5; i++) r.render(empty, empty, 0);
    r.render(w, w, 0);
    expect(activeSpawnCount()).toBe(1);
    r.destroy();
  });

  it('한 프레임에 대량 스폰해도 동시 연출은 정원까지다(§2-4 화면 총량)', () => {
    const r = new EntityRenderer(realTextures());
    const many = Array.from({ length: 20 }, (_, i) => ent({ id: i + 1, x: i * 40 }));
    const w = world(many);
    r.render(w, w, 0);
    expect(activeSpawnCount()).toBe(MAX_CONCURRENT_SPAWNS);
    r.destroy();
  });

  it('재조준 스쿼시가 끝나면 본체가 원래 비율로 돌아온다(자세가 계속 켜져 있어도)', () => {
    // 이 원복은 자세가 **꺼질 때**(show=false)의 원복과 별개 경로다. 커밋 → 재조준 → 커밋
    // 처럼 예고가 내내 켜진 채 자세만 갈리면, 웅크림에서 편 몸을 되돌리는 것은 이 한 줄뿐이다.
    // 그 시나리오를 안 만들면 지워도 그린이다(뮤테이션에서 실제로 살아남았다).
    const r = new EntityRenderer(realTextures());
    const sprites = (
      r as unknown as { sprites: Map<number, { sprite: { scale: { x: number; y: number } } }> }
    ).sprites;
    // typeIndex 0 = 카르곤 차저(chargeStraight).
    const charger = (x: number, y: number, angle: number): EntitySnapshot =>
      ent({ id: 2, enemyType: 0, x, y, angle });
    const player = (x: number, y: number): EntitySnapshot => ent({ id: 1, kind: 'player', x, y });

    // ① +x 로 순항하며 조준선 위의 플레이어를 향해 커밋. 스폰 창을 넘긴다.
    let prev = world([player(300, 0), charger(0, 0, 0)]);
    r.render(prev, prev, 0);
    let x = 0;
    for (let i = 1; i <= SPAWN_FRAMES + 8; i++) {
      x = i * 8;
      const w = world([player(x + 300, 0), charger(x, 0, 0)]);
      r.render(prev, w, 1);
      prev = w;
    }
    const base = sprites.get(2)!.sprite.scale.y;

    // ② 한 틱에 90° 꺾인다 = 재조준. 몸이 눌린다.
    let y = 8;
    let w = world([player(x, y + 300), charger(x, y, Math.PI / 2)]);
    r.render(prev, w, 1);
    prev = w;
    expect(sprites.get(2)!.sprite.scale.y).not.toBeCloseTo(base, 6);

    // ③ 새 방향으로 계속 달린다 → 재조준 창이 끝나고 다시 커밋(예고는 내내 켜져 있다).
    for (let i = 0; i < RELOCK_FRAMES + 4; i++) {
      y += 8;
      w = world([player(x, y + 300), charger(x, y, Math.PI / 2)]);
      r.render(prev, w, 1);
      prev = w;
    }
    expect(sprites.get(2)!.sprite.scale.y).toBeCloseTo(base, 6);
    r.destroy();
  });

  it('연출이 **중간에 끊겨도** 본체 변환이 원래대로 돌아온다(발광 감소 토글)', () => {
    // 정상 종료만 보면 이 원복은 검증되지 않는다 — 마지막 프레임의 물질화 스케일이 이미
    // 1.0 이라 원복이 수치상 no-op 이기 때문이다(뮤테이션에서 실제로 살아남았다). 원복이
    // 유일하게 관측되는 자리는 **연출이 도중에 잘리는** 경로다.
    const r = new EntityRenderer(realTextures());
    const sprites = (
      r as unknown as {
        sprites: Map<number, { sprite: { alpha: number; scale: { x: number; y: number } } }>;
      }
    ).sprites;

    // ① 대조군 — 같은 반경의 적이 연출을 끝까지 마쳤을 때의 기준 스케일.
    const a = world([ent({ id: 1 })]);
    for (let i = 0; i <= SPAWN_FRAMES + 2; i++) r.render(a, a, 0);
    const base = sprites.get(1)!.sprite.scale.x;

    // ② 물질화 **도중에** 발광을 끈다 → finishSpawn 이 즉시 불린다.
    const b = world([ent({ id: 1 }), ent({ id: 2, x: 300 })]);
    r.render(b, b, 0);
    r.render(b, b, 0);
    expect(sprites.get(2)!.sprite.scale.x).toBeLessThan(base); // 실제로 작아져 있었다
    graphicsSettings.set({ quality: 'auto', reducedMotion: false, reducedGlow: true });
    r.render(b, b, 0);
    expect(sprites.get(2)!.sprite.scale.x).toBeCloseTo(base, 6);
    expect(sprites.get(2)!.sprite.alpha).toBe(1);
    r.destroy();
  });

  it('스폰 연출이 끝나면 본체 변환·밝기가 정확히 원래대로 돌아온다', () => {
    const r = new EntityRenderer(realTextures());
    const w = world([ent({ id: 1 })]);
    r.render(w, w, 0);
    const sprites = (
      r as unknown as {
        sprites: Map<number, { sprite: { alpha: number; scale: { x: number; y: number } } }>;
      }
    ).sprites;
    const t = sprites.get(1)!;
    const scaleDuringSpawn = t.sprite.scale.x;
    for (let i = 0; i <= SPAWN_FRAMES + 2; i++) r.render(w, w, 0);
    expect(t.sprite.alpha).toBe(1);
    // 물질화가 실제로 크기를 건드렸다가 되돌렸다(둘 다 확인해야 항진이 아니다).
    expect(scaleDuringSpawn).toBeLessThan(t.sprite.scale.x);
    r.destroy();
  });
});

// ===========================================================================
// 손상 = 몸의 상태 (1차 MAJOR — 화면에 없었다)
// ===========================================================================

describe('항목 2 · 손상은 몸의 상태다', () => {
  it('대파 이상에서 본체 전체를 덮는 가산 열 오버레이가 붙는다', () => {
    // 1차는 3.8px 불티뿐이라 카르곤 용암 위에서 화면 델타가 노이즈 바닥 **밑**이었다.
    const r = new EntityRenderer(realTextures());
    const ok = world([ent({ id: 1, hp: 100, maxHp: 100 })]);
    r.render(ok, ok, 0);
    expect(activeBodyGlowCount()).toBe(0);
    const wrecked = world([ent({ id: 1, hp: 15, maxHp: 100 })]);
    r.render(wrecked, wrecked, 0);
    expect(activeBodyGlowCount()).toBe(1);
    r.destroy();
  });

  it('열 오버레이는 본체 텍스처를 쓰고 가산이라 실루엣을 어둡게 만들지 않는다', () => {
    const r = new EntityRenderer(realTextures());
    const wrecked = world([ent({ id: 1, hp: 15, maxHp: 100 })]);
    r.render(wrecked, wrecked, 0);
    const above = layers(r).effectLayer.children[0] as Container;
    const glow = above.children.find((c) => c.label === 'enemyBodyGlow') as
      | (Container & { blendMode: string; texture: Texture })
      | undefined;
    expect(glow).toBeDefined();
    expect(glow!.blendMode).toBe('add');
    const sprites = (r as unknown as { sprites: Map<number, { sprite: { texture: Texture } }> })
      .sprites;
    expect(glow!.texture).toBe(sprites.get(1)!.sprite.texture);
    r.destroy();
  });

  it('열 오버레이 동시 수가 정원을 넘지 않는다(§2-4 화면 총량)', () => {
    const r = new EntityRenderer(realTextures());
    const many = Array.from({ length: 25 }, (_, i) =>
      ent({ id: i + 1, x: i * 40, hp: 8, maxHp: 100 }),
    );
    const w = world(many);
    r.render(w, w, 0);
    expect(activeBodyGlowCount()).toBe(MAX_BODY_GLOW);
    r.destroy();
  });

  it('회복하면 열 오버레이가 걷힌다(정원도 반납된다)', () => {
    const r = new EntityRenderer(realTextures());
    const hurt = world([ent({ id: 1, hp: 15, maxHp: 100 })]);
    r.render(hurt, hurt, 0);
    expect(activeBodyGlowCount()).toBe(1);
    const healed = world([ent({ id: 1, hp: 95, maxHp: 100 })]);
    r.render(healed, healed, 0);
    expect(activeBodyGlowCount()).toBe(0);
    r.destroy();
  });

  it('보스 본체는 건드리지 않는다(렌더러 보스 분기가 alpha·tint 를 전유한다)', () => {
    const r = new EntityRenderer(realTextures());
    const w = world([ent({ id: 9, kind: 'boss', hp: 100, maxHp: 9000, active: true })]);
    r.render(w, w, 0);
    expect(activeBodyGlowCount()).toBe(0);
    r.destroy();
  });
});

// ===========================================================================
// 플레이어 관측 · 종별 사망 서명 관측창
// ===========================================================================

describe('관측창', () => {
  it('플레이어 위치를 정규 render 경로에서 관측한다(돌진 커밋의 유일한 입력)', () => {
    const r = new EntityRenderer(realTextures());
    const w = world([ent({ id: 1, kind: 'player', x: 120, y: -40 })]);
    r.render(w, w, 0);
    const p = observedPlayerPos();
    expect(p).not.toBeNull();
    // 레인 A 의 아이들 부유가 본체를 서브픽셀로 흔든다 — 관측 대상은 그 **표시 위치**가
    // 맞으므로(같은 스프라이트를 적이 조준한다) 픽셀 단위로 확인한다.
    expect(p!.x).toBeCloseTo(120, 0);
    expect(p!.y).toBeCloseTo(-40, 0);
    r.destroy();
  });

  it('플레이어가 사라지면 관측을 버린다(없는 표적을 향한 예고 금지)', () => {
    const r = new EntityRenderer(realTextures());
    const w = world([ent({ id: 1, kind: 'player', x: 120, y: -40 })]);
    r.render(w, w, 0);
    const gone = world([]);
    r.render(gone, gone, 0);
    expect(observedPlayerPos()).toBeNull();
    r.destroy();
  });

  it('사망 서명이 종별로 갈린다(검증 불가능한 항목은 검증되지 않은 항목이다)', () => {
    // 1차 검증에서 비평가가 cheat 로 hp 를 밀어도 sim 이 처치로 처리하지 않아 종별 서명을
    // 확인할 방법이 없었다. 이 창이 하네스에서도 그대로 읽힌다.
    const r = new EntityRenderer(realTextures());
    // typeIndex 0 = 카르곤 차저(chargeStraight), 1 = 박격포(standoff),
    // 2 = 용암샘(stationary), 3 = 수리드론(seekWounded)
    const all = world([
      ent({ id: 1, enemyType: 0 }),
      ent({ id: 2, enemyType: 1, x: 200 }),
      ent({ id: 3, enemyType: 3, x: 400 }),
      ent({ id: 4, enemyType: 2, x: 600 }),
      ent({ id: 5, enemyType: 0, x: 800 }),
    ]);
    r.render(all, all, 0);
    const survivor = world([ent({ id: 5, enemyType: 0, x: 800 })]);
    r.render(survivor, survivor, 0);
    const counts = deathSignatureCounts();
    expect(counts['chargeStraight']).toBe(1);
    expect(counts['standoff']).toBe(1);
    expect(counts['seekWounded']).toBe(1);
    expect(counts['stationary']).toBe(1);
    r.destroy();
  });
});

// ===========================================================================
// 림라이트 — 원호가 아니라 **본체 텍스처 사본** (3차 MAJOR-1)
// ===========================================================================

/** `below`(가산) 컨테이너 안에서 라벨로 자식을 찾는다. */
function ownChild(
  r: EntityRenderer,
  layer: 'glowLayer' | 'effectLayer',
  label: string,
): (Container & { blendMode: string; texture?: Texture; tint?: number }) | undefined {
  for (const c of layers(r)[layer].children) {
    const hit = (c as Container).children.find((x) => x.label === label);
    if (hit !== undefined)
      return hit as Container & { blendMode: string; texture?: Texture; tint?: number };
  }
  return undefined;
}

describe('군집 가독성 · 림라이트는 실루엣을 따라간다', () => {
  it('림이 본체와 **같은 텍스처**의 가산 사본이다(원호 stroke 가 아니다)', () => {
    // 원호는 고정 반경이라 실루엣을 따라가지 않는다 — 몸 경계에서 떨어진 구간과 몸을 가로지르는
    // 구간이 동시에 생긴다. 텍스처 사본은 정의상 실루엣을 따라간다.
    const r = new EntityRenderer(realTextures());
    r.setEnvPlanet(0);
    const w = world([ent({ id: 1 })]);
    r.render(w, w, 0);
    const rim = ownChild(r, 'glowLayer', 'enemyRim');
    expect(rim).toBeDefined();
    expect(rim!.blendMode).toBe('add');
    const sprites = (r as unknown as { sprites: Map<number, { sprite: { texture: Texture } }> })
      .sprites;
    expect(rim!.texture).toBe(sprites.get(1)!.sprite.texture);
    r.destroy();
  });

  it('본체 텍스처가 교체되면 림도 따라간다(애니메이션 프레임)', () => {
    // 생성 시점 텍스처만 보면 이 동기화를 지워도 통과한다 — 뮤테이션에서 실제로 살아남았다.
    // 안 따라가면 애니메이션 중 어긋난 잔상이 몸 옆에 남는다.
    const r = new EntityRenderer(realTextures());
    r.setEnvPlanet(0);
    const w = world([ent({ id: 1 })]);
    r.render(w, w, 0);
    const sprites = (r as unknown as { sprites: Map<number, { sprite: { texture: Texture } }> })
      .sprites;
    const swapped = tex('enemy-frame-2');
    sprites.get(1)!.sprite.texture = swapped; // 렌더러의 애니메이션 프레임 진행과 같은 동작
    r.render(w, w, 0);
    expect(ownChild(r, 'glowLayer', 'enemyRim')!.texture).toBe(swapped);
    r.destroy();
  });

  it('림이 광원 **쪽**으로 밀린다(접지 그림자와 같은 태양)', () => {
    const r = new EntityRenderer(realTextures());
    r.setEnvPlanet(0);
    const w = world([ent({ id: 1 })]);
    r.render(w, w, 0);
    const rim = ownChild(r, 'glowLayer', 'enemyRim')!;
    const theme = themeFor(0)!;
    // 오프셋 방향이 광원 단위벡터와 같은 부호여야 한다(0 오프셋이면 초승달이 안 생긴다).
    const dot = rim.x * Math.cos(theme.light.angle) + rim.y * Math.sin(theme.light.angle);
    expect(dot).toBeGreaterThan(0);
    r.destroy();
  });

  it('테마가 없으면 림이 없다(광원 없는 행성에서 스스로 꺼진다)', () => {
    const r = new EntityRenderer(realTextures());
    const w = world([ent({ id: 1 })]);
    r.render(w, w, 0);
    expect(ownChild(r, 'glowLayer', 'enemyRim')).toBeUndefined();
    r.destroy();
  });
});

// ===========================================================================
// 게이트 하강 시 **철거** — 완화가 필요한 순간에 비용이 남으면 안 된다 (3차 MINOR-1)
// ===========================================================================

describe('게이트 하강 · 이미 만든 장식을 걷는다', () => {
  /** 레이어 두 곳을 통틀어 그 라벨을 가진 표시 객체 수. */
  function labelCount(r: EntityRenderer, label: string): number {
    const l = layers(r);
    let n = 0;
    for (const c of [...l.glowLayer.children, ...l.effectLayer.children]) {
      for (const x of (c as Container).children) if (x.label === label) n += 1;
    }
    return n;
  }

  it('런 중간에 reducedGlow 를 켜면 열 오버레이·손상 발광이 사라진다', () => {
    const r = new EntityRenderer(realTextures());
    r.setEnvPlanet(0);
    const hurt = world([ent({ id: 1, hp: 12, maxHp: 100 }), ent({ id: 2, x: 300, hp: 12, maxHp: 100 })]);
    r.render(hurt, hurt, 0);
    expect(activeBodyGlowCount()).toBe(2);
    expect(labelCount(r, 'enemyDamage')).toBeGreaterThan(0);

    graphicsSettings.set({ quality: 'auto', reducedMotion: false, reducedGlow: true });
    r.render(hurt, hurt, 0);
    // 생성만 막는 구현은 여기서 잔존한다(실측 잔존: bodyGlow 2 · damage 12).
    expect(activeBodyGlowCount()).toBe(0);
    expect(labelCount(r, 'enemyBodyGlow')).toBe(0);
    expect(labelCount(r, 'enemyRim')).toBe(0);
    r.destroy();
  });

  it('런 중간에 low 로 강등되면 잡몹 림이 사라진다(FPS 가 떨어진 바로 그 순간이다)', () => {
    const r = new EntityRenderer(realTextures());
    r.setEnvPlanet(0);
    const many = world(Array.from({ length: 12 }, (_, i) => ent({ id: i + 1, x: i * 60 })));
    r.render(many, many, 0);
    expect(labelCount(r, 'enemyRim')).toBe(12);

    lockTier('low');
    r.render(many, many, 0);
    expect(labelCount(r, 'enemyRim')).toBe(0);
    r.destroy();
  });

  it('엘리트 오라도 게이트가 내려가면 걷힌다(visible=false 로 남기지 않는다)', () => {
    const r = new EntityRenderer(realTextures());
    r.setEnvPlanet(0);
    const w = world([ent({ id: 1, elite: 2 })]);
    r.render(w, w, 0);
    expect(labelCount(r, 'enemyAura')).toBe(1);
    graphicsSettings.set({ quality: 'auto', reducedMotion: false, reducedGlow: true });
    r.render(w, w, 0);
    expect(labelCount(r, 'enemyAura')).toBe(0);
    r.destroy();
  });
});

// ===========================================================================
// 런 경계 · 관측창 노출 · 보스 사망 서명 (3차 MINOR-2/4/5)
// ===========================================================================

describe('런 경계 · 새 런의 스폰을 억제하지 않는다', () => {
  it('공백이 재부착 창보다 길면 같은 id 라도 다시 물질화한다', () => {
    const r = new EntityRenderer(realTextures());
    const w = world([ent({ id: 1 }), ent({ id: 2, x: 200 })]);
    const empty = world([]);
    r.render(w, w, 0);
    expect(activeSpawnCount()).toBe(2);
    for (let i = 0; i <= SPAWN_FRAMES + 2; i++) r.render(w, w, 0);
    for (let i = 0; i < REATTACH_WINDOW + 6; i++) r.render(empty, empty, 0);
    r.render(w, w, 0);
    expect(activeSpawnCount()).toBe(2);
    r.destroy();
  });

  /**
   * **공백 없이** 새 런이 시작되는 경우(연속 `startRun`). 재적 판정이 프레임 간격만 보면 화면
   * 전환과 구분되지 않아 스폰이 통째로 억제된다(실측: `activeSpawnCount` 전 프레임 0).
   * 그래서 판정이 **종·최대 HP 까지** 대조하는데, 두 축을 한 테스트에서 동시에 바꾸면
   * **한쪽을 지워도 다른 쪽이 통과시킨다** — 실제로 그렇게 두 뮤테이션이 살아남았다.
   * 그래서 축마다 증인을 따로 세운다.
   */
  function newRunSameId(over: Partial<EntitySnapshot>): number {
    const r = new EntityRenderer(realTextures());
    const runA = world([ent({ id: 1, enemyType: 0, maxHp: 100 })]);
    r.render(runA, runA, 0);
    for (let i = 0; i <= SPAWN_FRAMES + 2; i++) r.render(runA, runA, 0);
    expect(activeSpawnCount()).toBe(0);
    r.reset(); // 공백은 1프레임뿐 — 화면 전환과 구분 불가한 조건이다
    const runB = world([ent({ id: 1, enemyType: 0, maxHp: 100, ...over })]);
    r.render(runB, runB, 0);
    const n = activeSpawnCount();
    r.destroy();
    return n;
  }

  it('공백 없이 새 런 — **종만** 달라도 물질화한다', () => {
    expect(newRunSameId({ enemyType: 1 })).toBe(1);
  });

  it('공백 없이 새 런 — **최대 HP 만** 달라도 물질화한다', () => {
    expect(newRunSameId({ maxHp: 260 })).toBe(1);
  });

  it('셋이 전부 같으면 재부착으로 본다(화면 전환 억제가 바로 이 경로다)', () => {
    expect(newRunSameId({})).toBe(0);
  });

  it('화면 전환(1프레임 공백)은 여전히 억제된다(두 규칙이 서로를 무효화하지 않는다)', () => {
    const r = new EntityRenderer(realTextures());
    const w = world([ent({ id: 1 }), ent({ id: 2, x: 200 })]);
    r.render(w, w, 0);
    for (let i = 0; i <= SPAWN_FRAMES + 2; i++) r.render(w, w, 0);
    r.reset();
    r.render(w, w, 0);
    expect(activeSpawnCount()).toBe(0);
    r.destroy();
  });
});

describe('관측창이 프로덕션 번들에서도 읽힌다', () => {
  it('전역 __pbEnemy 에 관측 함수가 붙어 있다', () => {
    // 비평가가 이 창들을 Vite dev 의 동적 import 로 우회해 읽었는데, 프로덕션 빌드에선 그
    // 우회가 안 된다 — 검증 도구가 dev 서버에만 존재하게 된다.
    const g = (globalThis as unknown as { __pbEnemy?: Record<string, unknown> }).__pbEnemy;
    expect(g).toBeDefined();
    for (const k of [
      'activeSpawnCount',
      'activeBodyGlowCount',
      'deathDebrisCount',
      'deathDebrisEmitted',
      'deathSignatureCounts',
      'enemyAdornerCount',
      'observedPlayerPos',
    ]) {
      expect(typeof g![k]).toBe('function');
    }
  });

  it('전역이 실제 상태를 돌려준다(껍데기가 아니다)', () => {
    const g = (globalThis as unknown as { __pbEnemy: { activeSpawnCount: () => number } }).__pbEnemy;
    const r = new EntityRenderer(realTextures());
    const w = world([ent({ id: 1 })]);
    r.render(w, w, 0);
    expect(g.activeSpawnCount()).toBe(activeSpawnCount());
    expect(g.activeSpawnCount()).toBe(1);
    r.destroy();
  });
});

describe('보스 사망 서명', () => {
  it("보스가 처치되면 'boss' 서명이 집계된다", () => {
    // 하네스에서는 보스가 hp=0.5 로도 안 죽어(이 리포에 기록된 함정) 끝내 확인이 안 됐다.
    // 정규 render 경로에서는 소멸이 곧 처치라 여기서 계약을 못 박을 수 있다.
    const r = new EntityRenderer(realTextures());
    const both = world([ent({ id: 9, kind: 'boss', hp: 100, maxHp: 9000 }), ent({ id: 1, x: 400 })]);
    r.render(both, both, 0);
    const survivor = world([ent({ id: 1, x: 400 })]);
    r.render(survivor, survivor, 0);
    expect(deathSignatureCounts()['boss']).toBe(1);
    r.destroy();
  });
});
