/**
 * 적 기체 **AAA 비주얼** — 위협도 계층 · 손상 상태 · 예비 동작 · 스폰 인 · 사망 연출 · 군집 가독성.
 *
 * ## 등록은 모듈 최상위 부수효과다
 * 이 파일을 **import 하는 것만으로** 장식자가 등록된다({@link registerAdornerFactory}). 초기화
 * 함수를 따로 부를 필요가 없다 — 배선 허브는 `import './enemyVisual.js';` 한 줄이면 끝이고,
 * 세 레인이 서로 다른 방식을 쓰면 허브가 지저분해진다.
 *
 * ## 무엇을 그리고 무엇을 안 그리는가 (가독성 계약 §2-2)
 * 이 게임은 탄막 슈터고 **예쁨이 가독성을 이기면 그 변경은 실패다.** 그래서:
 * - 적 몸통을 덮거나 어둡게 하는 것이 없다. 오라·불티·화염·예비동작은 전부 **가산**이고,
 *   림·휘장은 몸통 **바깥**에 산다. 유일한 어두운 도형인 연기는 진행 방향 **반대쪽**으로만
 *   밀려나며 알파 상한이 낮다({@link file://./enemyParts.ts} `buildSmoke` 참조).
 * - **시안은 아군 전용**이라 적 팔레트에 없다({@link file://./enemyPosture.ts} 가 정본이고
 *   테스트가 색상각으로 못 박는다).
 * - **적탄에 손대지 않는다.** 조준선은 몸통에서 뻗는 얇은 장식이라 탄으로 오독될 굵기·밝기를
 *   넘지 않는다.
 *
 * ## 예산 — 개체당 비용이 20~40 배로 곱해진다
 * 1. **장식 정원제**({@link MAX_DECORATED_ENEMIES}). 정원을 넘긴 잡몹은 장식자가 붙되 아무것도
 *    만들지 않는다(할당 0). **보스·엘리트는 정원과 무관하게 항상 장식**한다 — 잘려야 할 것은
 *    수가 많은 쪽이지 정보량이 큰 쪽이 아니다.
 * 2. **정적 기하 + 변환 애니메이션.** `Graphics` 재빌드는 상태 전이에서만 일어나고, 매 프레임
 *    움직이는 것은 position/rotation/scale/alpha 뿐이다.
 * 3. **티어 사다리.** low = 엘리트·보스 표식만(잡몹 장식 0), med = + 오라·예비동작·손상·스폰,
 *    high = + 화염·사망 파편·보스 궤도.
 *
 * ## 형제 컨테이너 회수
 * 여기서 만드는 컨테이너는 스프라이트의 **형제**라 부모 `destroy` 로 걷히지 않는다.
 * {@link EnemyAdorner.dispose} 가 자기 것을 전부 떼고 파괴한다(회수 4경로는 스캐폴딩이 부른다).
 *
 * ## 결정론(ADR-0005)
 * render-only 다. `src/sim/` 는 타입 전용 import 이고, `data/enemies.js` 는 leaf 카탈로그를
 * **읽기만** 한다(`data/invasion/facilities.js` 선례). `hashWorld` 에 아무것도 더하지 않는다.
 */

import { Container, Graphics, type Sprite } from 'pixi.js';

import { ENEMY_BY_TYPE } from '../../../data/enemies.js';
import type { EntitySnapshot } from '../../sim/snapshot.js';
import { registerAdornerFactory, type AdornerContext, type EntityAdorner } from './adorner.js';
import {
  DMG_CRITICAL,
  DMG_FIRE,
  DMG_OK,
  DMG_SMOKE,
  DMG_SPARK,
  POSTURE_COMMIT,
  POSTURE_FIRING_BAND,
  POSTURE_RELOCK,
  POSTURE_ROOTED,
  POSTURE_TENDING,
  THREAT_BOSS,
  THREAT_ELITE,
  type ObservedMovement,
  type PostureState,
  type ThreatTier,
  createPostureState,
  damageStage,
  observePosture,
  phaseForId,
  spawnProgress,
  threatAccent,
  threatTier,
} from './enemyPosture.js';
import {
  buildAimThread,
  buildBossAura,
  buildBossInsignia,
  buildChargeCore,
  buildDashLance,
  buildEliteAura,
  buildEliteInsignia,
  buildFlame,
  buildMendRing,
  buildRelockBracket,
  buildRim,
  buildRootedVents,
  buildShard,
  buildShockRing,
  buildSmoke,
  buildSparks,
  buildSpawnColumn,
  buildSpawnRing,
} from './enemyParts.js';

// ---------------------------------------------------------------------------
// 예산 상수 (placeholder, defer-balance-tuning)
// ---------------------------------------------------------------------------

/**
 * 동시에 장식할 수 있는 **잡몹** 최대 수. 보스·엘리트는 이 정원 밖이다(항상 장식).
 * `MAX_DECORATED_HAZARDS` · `MAX_BULLET_TRAILS` 와 같은 규율이다.
 */
export const MAX_DECORATED_ENEMIES = 28;

/** 동시에 살아 있을 수 있는 사망 파편 수. 넘치면 가장 오래된 것부터 회수한다. */
export const MAX_DEATH_DEBRIS = 48;

/** 사망 파편 수명(초). */
const DEBRIS_LIFE = 0.55;

/** 조준선 길이 = 표시 반경의 배수. sim 의 선호 사거리(380u)를 다 그리면 화면이 실로 덮인다. */
const AIM_THREAD_SCALE = 5.5;
/** 돌진 창 길이 = 표시 반경의 배수. */
const LANCE_SCALE = 3.4;

// ---------------------------------------------------------------------------
// 종 정보 — leaf 카탈로그에서 읽는다(sim 상태 아님)
// ---------------------------------------------------------------------------

/** 이 kind 가 이 모듈의 대상인가. 등록 목록과 반드시 같아야 한다(테스트가 대조한다). */
export const ENEMY_VISUAL_KINDS = [
  'enemy',
  'boss',
  'defenseBoss',
  'formationDrone',
  'spawnedDrone',
] as const;

/**
 * `enemyType`(전역 typeIndex) → 이동 종류. 카탈로그 밖(보스·드론·설비 파생)은 `null` 이고,
 * 그때는 자세 추론을 하지 않는다 — **모르는 종에 대해 지어내지 않는다**(거짓 예고 금지).
 */
export function movementOf(kind: string, enemyType: number): ObservedMovement | null {
  if (kind !== 'enemy') return null;
  const def = ENEMY_BY_TYPE[enemyType];
  return def === undefined ? null : (def.movement as ObservedMovement);
}

// ---------------------------------------------------------------------------
// 사망 파편 풀 — **고아 이펙트를 구조적으로 불가능하게 만든다**
// ---------------------------------------------------------------------------

/**
 * 파편 하나. 장식자가 죽은 뒤에도 살아 있어야 하므로 개체가 아니라 **모듈 풀**이 소유한다.
 */
interface Debris {
  node: Container;
  vx: number;
  vy: number;
  spin: number;
  age: number;
  life: number;
  layer: Container;
}

const debris: Debris[] = [];
/** 이번 프레임에 이미 풀을 진행했는가(프레임당 1회 보장 — 장식자 수만큼 돌면 안 된다). */
let debrisPumpedTick = -1;
/** 살아 있는 장식자 수(장식 여부 무관). 풀을 굴려 줄 주체가 남아 있는지의 유일한 근거다. */
let liveAdorners = 0;

/**
 * 파편 풀을 dt 만큼 진행한다. 프레임당 1회.
 *
 * ⚠️ 이 풀은 **자기 티커가 없다** — 살아 있는 장식자의 `onFrame` 이 굴려 준다. 그래서
 * {@link releaseDebrisIfOrphaned} 가 "굴려 줄 사람이 없으면 즉시 전부 회수" 를 강제한다.
 * 이 한 쌍이 없으면 마지막 적이 죽은 화면에 파편이 **얼어붙는다**(접지 그림자가 낸 결함과
 * 정확히 같은 형태).
 */
function pumpDebris(ctx: AdornerContext): void {
  if (ctx.frameTick === debrisPumpedTick) return;
  debrisPumpedTick = ctx.frameTick;
  const dt = ctx.dt;
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    if (d === undefined) continue;
    d.age += dt;
    if (d.age >= d.life) {
      dropDebris(i);
      continue;
    }
    d.node.x += d.vx * dt;
    d.node.y += d.vy * dt;
    d.node.rotation += d.spin * dt;
    const t = 1 - d.age / d.life;
    d.node.alpha = t * t;
    // 감속 — 파편이 등속으로 날아가면 값싸 보인다(2차 운동).
    d.vx *= 0.94;
    d.vy *= 0.94;
  }
}

/** 파편 하나를 레이어에서 떼고 파괴한다. */
function dropDebris(i: number): void {
  const d = debris[i];
  if (d === undefined) return;
  d.layer.removeChild(d.node);
  d.node.destroy({ children: true });
  debris.splice(i, 1);
}

/** 파편을 전부 즉시 회수한다. */
function clearDebris(): void {
  for (let i = debris.length - 1; i >= 0; i--) dropDebris(i);
}

/**
 * 장식자가 하나도 안 남았으면 파편을 전부 회수한다. 굴려 줄 주체가 사라진 파편은 **화면에
 * 얼어붙기 때문에**, "예뻐 보이는 잔상" 보다 "확실히 사라짐" 을 택한다. reset·destroy 경로도
 * 전 장식자를 회수하므로 이 한 함수가 그 경로까지 함께 덮는다.
 */
function releaseDebrisIfOrphaned(): void {
  if (liveAdorners <= 0) clearDebris();
}

/** 파편 하나를 풀에 넣는다. 상한 초과 시 가장 오래된 것부터 밀어낸다. */
function pushDebris(d: Debris): void {
  while (debris.length >= MAX_DEATH_DEBRIS) dropDebris(0);
  d.layer.addChild(d.node);
  debris.push(d);
}

/** 현재 살아 있는 파편 수(읽기 전용 관측창 — 테스트가 회수를 수치로 못 박는다). */
export function deathDebrisCount(): number {
  return debris.length;
}

/** 현재 살아 있는 적 장식자 수(읽기 전용 관측창). */
export function enemyAdornerCount(): number {
  return liveAdorners;
}

/** 결정적 의사난수 [0,1) — 시드(id·인덱스)만으로 정해져 프레임마다 흔들리지 않는다. */
function hash01(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// ---------------------------------------------------------------------------
// 장식자
// ---------------------------------------------------------------------------

class EnemyAdorner implements EntityAdorner {
  readonly name = 'enemy-visual';

  /** 가산 레이어(스프라이트 **아래**) 소유 컨테이너. 필요할 때만 만든다. */
  private below: Container | null = null;
  /** 상위 레이어(스프라이트 **위**) 소유 컨테이너. */
  private above: Container | null = null;

  private aura: Graphics | null = null;
  private insignia: Container | null = null;
  private rim: Graphics | null = null;
  private spawnRing: Graphics | null = null;
  private spawnColumn: Graphics | null = null;
  private telegraph: Container | null = null;
  private chargeCore: Graphics | null = null;
  private sparks: Graphics | null = null;
  private flame: Graphics | null = null;
  private smoke: Graphics | null = null;

  /** 현재 텔레그래프가 표현하는 자세. 바뀔 때만 기하를 다시 만든다. */
  private telegraphFor = -1;
  /** 현재 불티/화염이 표현하는 손상 단계. */
  private damageFor = -1;

  private readonly posture: PostureState = createPostureState();
  private bornTick = 0;
  private radius = 1;
  private lastX = 0;
  private lastY = 0;
  private lastSeenTick = -1;
  private headingX = 1;
  private headingY = 0;
  private spawnDone = false;
  private disposed = false;
  /** 이번 프레임 맥락. 지연 생성이 레이어를 찾을 유일한 경로다(프레임 밖에서는 `null`). */
  private ctx: AdornerContext | null = null;

  constructor(
    private readonly kind: string,
    private readonly tier: ThreatTier,
    private readonly accent: number,
    private readonly movement: ObservedMovement | null,
    private readonly phase: number,
    /** 정원 안에 들어왔는가. false 면 아무것도 만들지 않는다(할당 0). */
    private readonly decorated: boolean,
  ) {
    liveAdorners += 1;
  }

  onAttach(sprite: Sprite, e: EntitySnapshot, ctx: AdornerContext): void {
    this.bornTick = ctx.frameTick;
    // 표시 반경 — entityRenderer 가 setSize 로 이미 확정했다. 0 방어로 sim 반경 폴백.
    const w = sprite.width;
    this.radius = w > 0 ? w / 2 : Math.max(1, e.radius);
    this.lastX = sprite.x;
    this.lastY = sprite.y;
  }

  onFrame(sprite: Sprite, e: EntitySnapshot, prev: EntitySnapshot, ctx: AdornerContext): void {
    pumpDebris(ctx);
    this.lastSeenTick = ctx.frameTick;
    this.lastX = sprite.x;
    this.lastY = sprite.y;
    if (!this.decorated) return;

    const low = ctx.tier === 'low';
    const glow = ctx.gates.halo;
    // 모션 게이트: 저티어이거나 reducedMotion 이면 흔들림 게이트가 내려간다. 진동·회전·맥동을
    // 전부 여기에 매달아 광과민 대응이 한 곳에서 끝나게 한다.
    const motion = ctx.gates.shake;

    // 진행 방향(단위 벡터) — 연기 꼬리·돌진 창이 쓴다. 정지 시엔 직전 방향을 유지한다.
    const dx = e.x - prev.x;
    const dy = e.y - prev.y;
    const d = Math.hypot(dx, dy);
    if (d > 1e-4) {
      this.headingX = dx / d;
      this.headingY = dy / d;
    }

    const posture = observePosture(this.posture, e, prev, this.movement, ctx.frameTick);
    const stage = damageStage(e.hp, e.maxHp);
    const t = ctx.frameTick * 0.1 + this.phase;

    this.ctx = ctx;
    this.syncLayers(sprite);

    // ── 항목 1 · 위협도 계층 ────────────────────────────────────────────────
    this.updateThreat(sprite, glow, motion, low, t);
    // ── 항목 6 · 군집 가독성 (림은 low 티어에서도 엘리트·보스에 남긴다) ────────
    this.updateRim(sprite, low, motion, t);
    // ── 항목 4 · 스폰 인 ──────────────────────────────────────────────────
    this.updateSpawn(sprite, ctx, glow, low);
    // ── 항목 3 · 예비 동작 ────────────────────────────────────────────────
    this.updateTelegraph(sprite, e, posture, glow, low, motion, t);
    // ── 항목 2 · 손상 상태 ────────────────────────────────────────────────
    this.updateDamage(sprite, ctx, stage, glow, low, motion, t);
  }

  /**
   * 이미 만든 소유 컨테이너를 스프라이트 보간 위치로 미러한다. **만들지는 않는다** —
   * 컨테이너 생성은 실제로 그릴 것이 생긴 순간({@link ensureBelow}/{@link ensureAbove})으로
   * 미룬다. 미리 만들면 low 티어처럼 "아무것도 안 그리는" 구성에서도 개체 수만큼 빈 컨테이너가
   * 레이어에 쌓여 티어 게이트가 사실상 무력해진다.
   */
  private syncLayers(sprite: Sprite): void {
    this.below?.position.set(sprite.x, sprite.y);
    this.above?.position.set(sprite.x, sprite.y);
  }

  /** 가산(아래) 컨테이너 — 첫 사용 시점에 만들어 붙인다. */
  private ensureBelow(sprite: Sprite): Container | null {
    const ctx = this.ctx;
    if (ctx === null) return null;
    if (this.below === null) {
      this.below = new Container();
      this.below.position.set(sprite.x, sprite.y);
      ctx.belowLayer.addChild(this.below);
    }
    return this.below;
  }

  /** 상위(위) 컨테이너 — 첫 사용 시점에 만들어 붙인다. */
  private ensureAbove(sprite: Sprite): Container | null {
    const ctx = this.ctx;
    if (ctx === null) return null;
    if (this.above === null) {
      this.above = new Container();
      this.above.position.set(sprite.x, sprite.y);
      ctx.aboveLayer.addChild(this.above);
    }
    return this.above;
  }

  /** 위협도 오라·휘장. 잡몹은 둘 다 없다(수가 많은 쪽을 자른다). */
  private updateThreat(
    sprite: Sprite,
    glow: boolean,
    motion: boolean,
    low: boolean,
    t: number,
  ): void {
    if (this.tier === 0) return;
    const boss = this.tier === THREAT_BOSS;

    // 오라 — 가산이라 발광 감소축(halo)에 매단다. low 티어에서는 아예 만들지 않는다.
    if (glow && !low) {
      const below = this.aura === null ? this.ensureBelow(sprite) : this.below;
      if (this.aura === null && below !== null) {
        this.aura = boss
          ? buildBossAura(this.radius, this.accent)
          : buildEliteAura(this.radius, this.accent);
        below.addChild(this.aura);
      }
      if (this.aura !== null) {
        this.aura.visible = true;
        // 맥동 — 등급이 높을수록 느리고 크게 숨 쉰다. 위상은 개체마다 달라(군집 가독성) 겹친
        // 엘리트 둘이 한 몸처럼 보이지 않는다.
        const pulse = motion ? 1 + 0.06 * Math.sin(t * (boss ? 0.45 : 0.7)) : 1;
        this.aura.scale.set(pulse);
        this.aura.rotation = motion && boss ? t * 0.05 : 0;
      }
    } else if (this.aura !== null) {
      this.aura.visible = false;
    }

    // 휘장 — 발광이 아니라 **정보**라 halo 게이트에 매달지 않는다(발광을 껐다고 계급이
    // 사라지면 안 된다). low 티어에서도 남긴다: 정적 도형 하나라 사실상 공짜다.
    const above = this.insignia === null ? this.ensureAbove(sprite) : this.above;
    if (this.insignia === null && above !== null) {
      this.insignia = boss
        ? buildBossInsignia(this.radius, this.accent)
        : buildEliteInsignia(this.radius, this.accent);
      above.addChild(this.insignia);
    }
    if (this.insignia !== null) {
      if (boss) this.insignia.rotation = motion ? t * 0.12 : 0;
      else this.insignia.y = motion ? Math.sin(t * 0.8) * this.radius * 0.06 : 0;
    }
  }

  /** 개체 림 — 겹친 군집에서 개체 경계를 남기는 유일한 채널. */
  private updateRim(sprite: Sprite, low: boolean, motion: boolean, t: number): void {
    // low 티어에서는 잡몹 림을 포기한다(개체당 도형 하나가 40배로 곱해진다). 엘리트·보스는 남긴다.
    if (low && this.tier === 0) return;
    const above = this.rim === null ? this.ensureAbove(sprite) : this.above;
    if (this.rim === null && above !== null) {
      this.rim = buildRim(this.radius, this.accent);
      above.addChild(this.rim);
    }
    if (this.rim === null) return;
    // 위상 오프셋 — 같은 종이 겹쳐도 각자 다른 박자로 밝아져 개체 수가 읽힌다.
    this.rim.alpha = motion ? 0.8 + 0.2 * Math.sin(t * 0.6) : 1;
  }

  /** 스폰 인 — 지면 예고 링이 수축하고 워프 기둥이 접힌다. 끝나면 기하를 회수한다. */
  private updateSpawn(sprite: Sprite, ctx: AdornerContext, glow: boolean, low: boolean): void {
    if (this.spawnDone) return;
    const p = spawnProgress(this.bornTick, ctx.frameTick);
    if (low || !glow) {
      // 저티어·발광 감소에서는 연출을 생략하되 **상태는 끝낸 것으로** 만든다(밝기 조작 잔여 0).
      this.finishSpawn(sprite);
      return;
    }
    const below = this.spawnRing === null ? this.ensureBelow(sprite) : this.below;
    if (this.spawnRing === null && below !== null) {
      this.spawnRing = buildSpawnRing(this.radius, this.accent);
      this.spawnColumn = buildSpawnColumn(this.radius, this.accent);
      below.addChild(this.spawnRing);
      below.addChild(this.spawnColumn);
    }
    if (this.spawnRing !== null) {
      // 2.6배에서 1배로 조여든다 — "여기 온다" 가 실체보다 먼저 읽힌다.
      this.spawnRing.scale.set(2.6 - 1.6 * p);
      this.spawnRing.alpha = 1 - p * p;
    }
    if (this.spawnColumn !== null) {
      // 기둥은 세로로 접히고 가로로 번진다(워프 수축).
      this.spawnColumn.scale.set(0.4 + 1.6 * p, 1 - p);
      this.spawnColumn.alpha = 1 - p;
    }
    // 본체는 물질화하듯 떠오른다. **보스는 건드리지 않는다** — entityRenderer 의 보스 분기가
    // alpha 를 전유하고 있어(과열 맥동) 두 로직이 같은 값을 다투면 안 된다.
    if (this.kind !== 'boss' && this.kind !== 'defenseBoss') {
      sprite.alpha = 0.35 + 0.65 * p;
    }
    if (p >= 1) this.finishSpawn(sprite);
  }

  /** 스폰 연출 종료 — 기하를 회수하고 스프라이트 밝기를 정확히 1 로 되돌린다. */
  private finishSpawn(sprite: Sprite): void {
    this.spawnDone = true;
    if (this.kind !== 'boss' && this.kind !== 'defenseBoss') sprite.alpha = 1;
    this.spawnRing = destroyChild(this.below, this.spawnRing);
    this.spawnColumn = destroyChild(this.below, this.spawnColumn);
  }

  /** 예비 동작 — 관측된 자세를 그린다. 자세가 바뀔 때만 기하를 다시 만든다. */
  private updateTelegraph(
    sprite: Sprite,
    e: EntitySnapshot,
    posture: number,
    glow: boolean,
    low: boolean,
    motion: boolean,
    t: number,
  ): void {
    const show = glow && !low && posture !== 0;
    if (!show) {
      this.dropTelegraph();
      return;
    }
    if (posture !== this.telegraphFor) {
      this.dropTelegraph();
      this.telegraphFor = posture;
      const below = this.ensureBelow(sprite);
      if (below === null) return;
      if (posture === POSTURE_FIRING_BAND) {
        this.telegraph = buildAimThread(this.radius, this.accent, this.radius * AIM_THREAD_SCALE);
        this.chargeCore = buildChargeCore(this.radius, this.accent);
        below.addChild(this.telegraph);
        below.addChild(this.chargeCore);
      } else if (posture === POSTURE_COMMIT) {
        this.telegraph = buildDashLance(this.radius, this.accent, this.radius * LANCE_SCALE);
        below.addChild(this.telegraph);
      } else if (posture === POSTURE_RELOCK) {
        this.telegraph = new Container();
        this.telegraph.addChild(buildRelockBracket(this.radius, this.accent));
        below.addChild(this.telegraph);
      } else if (posture === POSTURE_TENDING) {
        this.telegraph = new Container();
        this.telegraph.addChild(buildMendRing(this.radius, this.accent));
        below.addChild(this.telegraph);
      } else if (posture === POSTURE_ROOTED) {
        this.telegraph = new Container();
        this.telegraph.addChild(buildRootedVents(this.radius, this.accent));
        below.addChild(this.telegraph);
      }
    }
    const tel = this.telegraph;
    if (tel === null) return;

    // 유지 시간에 비례해 세진다 — 순간 점멸이 아니라 "고조" 로 읽혀야 예고가 된다.
    const hold = Math.min(1, this.posture.holdFrames / 18);
    if (posture === POSTURE_FIRING_BAND) {
      tel.rotation = e.angle; // sim 의 standoff 는 angle 을 항상 플레이어 방향으로 둔다.
      tel.alpha = 0.35 + 0.65 * hold;
      if (this.chargeCore !== null) {
        const breathe = motion ? 0.85 + 0.15 * Math.sin(t * 1.6) : 1;
        this.chargeCore.scale.set((0.5 + 0.9 * hold) * breathe);
        this.chargeCore.alpha = 0.3 + 0.7 * hold;
      }
    } else if (posture === POSTURE_COMMIT) {
      tel.rotation = Math.atan2(this.headingY, this.headingX);
      tel.alpha = 0.4 + 0.6 * hold;
    } else if (posture === POSTURE_RELOCK) {
      // 조여드는 괄호 — 재조준 프레임이 지날수록 몸통으로 붙으며 사라진다.
      const k = Math.min(1, this.posture.holdFrames / 10);
      tel.scale.set(1.7 - 0.7 * k);
      tel.alpha = 1 - k;
      tel.rotation = e.angle;
    } else if (posture === POSTURE_TENDING) {
      tel.rotation = motion ? t * 0.5 : 0;
      tel.alpha = 0.5 + 0.5 * hold;
    } else if (posture === POSTURE_ROOTED) {
      tel.rotation = motion ? t * 0.12 : 0;
      tel.alpha = 0.85;
    }
  }

  /** 텔레그래프 기하 회수(자세 전이·게이트 하강 공통). */
  private dropTelegraph(): void {
    this.telegraph = destroyChild(this.below, this.telegraph);
    this.chargeCore = destroyChild(this.below, this.chargeCore);
    this.telegraphFor = -1;
  }

  /** 손상 상태 — HP 비율 누진(불티 → 연기 → 화염 → 코어 과부하). */
  private updateDamage(
    sprite: Sprite,
    ctx: AdornerContext,
    stage: number,
    glow: boolean,
    low: boolean,
    motion: boolean,
    t: number,
  ): void {
    if (low || stage === DMG_OK) {
      if (this.damageFor !== DMG_OK) this.dropDamage();
      return;
    }
    if (stage !== this.damageFor) {
      this.dropDamage();
      this.damageFor = stage;
      const below = glow ? this.ensureBelow(sprite) : null;
      const above =
        stage >= DMG_SMOKE && ctx.gates.particles !== 'off' ? this.ensureAbove(sprite) : null;
      if (below !== null && glow) {
        this.sparks = buildSparks(this.radius, 0xffc46a, stage >= DMG_FIRE ? 7 : 4);
        below.addChild(this.sparks);
        if (stage >= DMG_FIRE && ctx.tier === 'high') {
          this.flame = buildFlame(this.radius);
          below.addChild(this.flame);
        }
      }
      // 연기는 유일한 어두운 도형이라 파티클 게이트 뒤에 둔다(발광 감소와는 무관한 축).
      if (above !== null && stage >= DMG_SMOKE && ctx.gates.particles !== 'off') {
        this.smoke = buildSmoke(this.radius);
        above.addChild(this.smoke);
      }
    }
    if (this.sparks !== null) {
      this.sparks.rotation = motion ? t * 0.9 : 0;
      // 치명 단계는 점멸이 빨라진다 — "한 대만 더" 가 읽힌다.
      const flick = stage >= DMG_CRITICAL && motion ? (Math.sin(t * 3.1) > 0 ? 1 : 0.35) : 1;
      this.sparks.alpha = (stage === DMG_SPARK ? 0.55 : 0.85) * flick;
    }
    if (this.flame !== null) {
      this.flame.scale.set(1, motion ? 0.85 + 0.25 * Math.sin(t * 2.3) : 1);
      this.flame.alpha = stage >= DMG_CRITICAL ? 0.95 : 0.7;
    }
    if (this.smoke !== null) {
      // 진행 방향 **반대쪽**으로 꼬리를 끈다. 몸통 위로 올라오면 위장률 게이트가 빨개진다.
      this.smoke.rotation = Math.atan2(-this.headingY, -this.headingX);
      this.smoke.alpha = stage >= DMG_FIRE ? 1 : 0.6;
    }
  }

  /** 손상 기하 회수. */
  private dropDamage(): void {
    this.sparks = destroyChild(this.below, this.sparks);
    this.flame = destroyChild(this.below, this.flame);
    this.smoke = destroyChild(this.above, this.smoke);
    this.damageFor = -1;
  }

  dispose(ctx: AdornerContext): void {
    if (this.disposed) return; // 두 번 불려도 안전(회수 경로가 겹칠 수 있다).
    this.disposed = true;
    liveAdorners -= 1;

    this.emitDeath(ctx);

    // 형제 컨테이너 회수 — 부모 destroy 는 형제를 걷지 않는다.
    if (this.below !== null) {
      ctx.belowLayer.removeChild(this.below);
      this.below.destroy({ children: true });
      this.below = null;
    }
    if (this.above !== null) {
      ctx.aboveLayer.removeChild(this.above);
      this.above.destroy({ children: true });
      this.above = null;
    }
    this.aura = null;
    this.insignia = null;
    this.rim = null;
    this.spawnRing = null;
    this.spawnColumn = null;
    this.telegraph = null;
    this.chargeCore = null;
    this.sparks = null;
    this.flame = null;
    this.smoke = null;

    releaseDebrisIfOrphaned();
  }

  /**
   * 사망 연출 — 종별 파편. **세 겹의 가드**를 통과해야만 방출한다:
   *
   * 1. `ctx.dt > 0` — `reset`/`destroy` 경로는 `dt: 0` 으로 맥락을 만든다(`disposeAllAdorners`).
   *    화면 정리에서 파편을 뿌리면 빈 화면에 잔해만 남는다.
   * 2. **직전 프레임까지 살아 있었다** — 킬 루프는 스냅샷에서 사라진 프레임에 돌므로 마지막
   *    `onFrame` 은 바로 앞 프레임이다. 한참 전이면 정상 처치가 아니다.
   * 3. **다른 장식자가 남아 있다** — 파편 풀은 자기 티커가 없어 살아 있는 장식자가 굴려 준다.
   *    아무도 안 남았으면 방출 자체를 하지 않는다(고아 이펙트가 구조적으로 불가능해진다).
   */
  private emitDeath(ctx: AdornerContext): void {
    if (!this.decorated) return;
    if (ctx.tier === 'low' || ctx.gates.particles === 'off') return;
    if (!(ctx.dt > 0)) return;
    if (ctx.frameTick - this.lastSeenTick > 1) return;
    if (liveAdorners <= 0) return;

    const layer = ctx.aboveLayer;
    const r = this.radius;
    // 종별 서명 — 돌격형은 진행 방향으로 무겁게 흩고, 사수형은 고리로 터지고, 지원형은 안으로
    // 모였다 흩어지며, 특수형은 위로 분출한다. "무엇이 죽었는지" 가 잔해에서 읽힌다.
    const mv = this.movement;
    const boss = this.tier === THREAT_BOSS;
    const count = boss ? 14 : this.tier === THREAT_ELITE ? 9 : 6;

    if (mv === 'standoff' || boss) {
      // 충격파 고리 — 사수형/보스의 서명.
      const ring = buildShockRing(r * 0.6, this.accent);
      pushDebris({
        node: wrap(ring, this.lastX, this.lastY),
        vx: 0,
        vy: 0,
        spin: 0,
        age: 0,
        life: DEBRIS_LIFE * 0.7,
        layer,
      });
      const ringNode = debris[debris.length - 1];
      if (ringNode !== undefined) ringNode.node.scale.set(0.4);
    }

    for (let i = 0; i < count; i++) {
      const h = hash01(i * 7.13 + r);
      const h2 = hash01(i * 3.71 + r * 2.1);
      let ang = h * Math.PI * 2;
      let speed = r * (3 + h2 * 4);
      if (mv === 'chargeStraight') {
        // 진행 방향 ±40° 로 몰아 던진다 — 돌격체는 관성이 남은 채 부서진다.
        ang = Math.atan2(this.headingY, this.headingX) + (h - 0.5) * 1.4;
        speed *= 1.5;
      } else if (mv === 'stationary') {
        // 위로 분출 — 뿌리내린 설비는 옆으로 안 흩어진다.
        ang = -Math.PI / 2 + (h - 0.5) * 1.1;
      } else if (mv === 'seekWounded') {
        // 안으로 모였다 나가는 내파 — 시작 지점을 바깥에 두고 중심으로 던진다.
        ang = h * Math.PI * 2 + Math.PI;
        speed *= 0.55;
      }
      const shard = buildShard(r * (0.28 + h2 * 0.3), r * 0.09, this.accent);
      const node = wrap(shard, this.lastX, this.lastY);
      node.rotation = ang;
      pushDebris({
        node,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        spin: (h2 - 0.5) * 12,
        age: 0,
        life: DEBRIS_LIFE * (0.7 + h2 * 0.6),
        layer,
      });
    }
  }
}

/** 표시 객체를 위치 지정된 컨테이너로 감싼다(파편은 자기 위치·회전을 따로 굴린다). */
function wrap(child: Container, x: number, y: number): Container {
  const c = new Container();
  c.position.set(x, y);
  c.addChild(child);
  return c;
}

/** 자식 하나를 부모에서 떼고 파괴한 뒤 `null` 을 돌려준다(널 안전 관용구). */
function destroyChild<T extends Container>(parent: Container | null, child: T | null): null {
  if (child === null) return null;
  parent?.removeChild(child);
  child.destroy({ children: true });
  return null;
}

// ---------------------------------------------------------------------------
// 등록 — **모듈 최상위 부수효과**(import 한 줄이면 배선 완료)
// ---------------------------------------------------------------------------

/** 현재 장식 정원을 쓰고 있는 잡몹 수. */
let decoratedGrunts = 0;

/** 팩토리 — 등급을 정하고 정원을 배분한다. */
function makeEnemyAdorners(kind: string): (e: EntitySnapshot) => EntityAdorner[] {
  return (e: EntitySnapshot): EntityAdorner[] => {
    const tier = threatTier(kind, e.elite);
    // 보스·엘리트는 정원 밖이다 — 잘려야 할 것은 수가 많은 쪽이지 정보량이 큰 쪽이 아니다.
    const decorated = tier !== 0 || decoratedGrunts < MAX_DECORATED_ENEMIES;
    if (decorated && tier === 0) decoratedGrunts += 1;
    const ad = new EnemyAdorner(
      kind,
      tier,
      threatAccent(tier, e.elite),
      movementOf(kind, e.enemyType),
      phaseForId(e.id),
      decorated,
    );
    if (decorated && tier === 0) {
      // 정원 반납은 dispose 시점이다. 장식자에 후크를 걸지 않고 여기서 감싼다.
      const inner = ad.dispose.bind(ad);
      let released = false;
      ad.dispose = (ctx: AdornerContext): void => {
        inner(ctx);
        if (!released) {
          released = true;
          decoratedGrunts -= 1;
        }
      };
    }
    return [ad];
  };
}

for (const kind of ENEMY_VISUAL_KINDS) {
  registerAdornerFactory(kind, makeEnemyAdorners(kind));
}

/**
 * **테스트 전용** 모듈 상태 초기화. 파편 풀·정원·카운터를 비운다. 프로덕션 경로는 부르지 않는다
 * (프로덕션에서는 `dispose` 4경로가 이미 같은 일을 한다).
 */
export function resetEnemyVisualState(): void {
  clearDebris();
  debrisPumpedTick = -1;
  liveAdorners = 0;
  decoratedGrunts = 0;
}
