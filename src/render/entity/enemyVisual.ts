/**
 * 적 기체 **AAA 비주얼** — 위협도 계층 · 손상 상태 · 예비 동작 · 스폰 인 · 사망 연출 · 군집 가독성.
 *
 * ## 등록은 모듈 최상위 부수효과다
 * 이 파일을 **import 하는 것만으로** 장식자가 등록된다({@link registerAdornerFactory}). 초기화
 * 함수를 따로 부를 필요가 없다.
 *
 * ## 2차 개정(비평가 반려 반영, 2026-07-30) — **정보를 몸으로 옮겼다**
 * 1차는 여섯 항목을 전부 "스프라이트 둘레에 기하 도형" 으로 풀었고, 그 결과가 §2-5 가 금지한
 * 것 자체였다(십자선·괄호·조준선·선택 링). AAA 는 같은 정보를 **몸**에 싣는다 —
 * *Gungeon* 의 발사 예고는 몸을 젖히고 스프라이트가 명멸하는 것이고, *Nova Drift* 의 등급은
 * 링이 아니라 실루엣과 팔레트다. 그래서 이 개정은 도형을 **줄이고** 다음을 몸으로 옮겼다:
 *
 * - **스폰 인** = 본체 스케일·알파 물질화 (+ 눈금 없는 소프트 헤일로 하나)
 * - **재조준(웅크림)** = 본체 **스쿼시** + 가산 명멸
 * - **손상** = 본체 전체를 덮는 **가산 열 오버레이**(같은 텍스처) — 1차의 3.8px 불티는
 *   카르곤 용암 위에서 화면 델타가 노이즈 바닥 **밑**이었다(§4-2 = 화면에 없는 것)
 * - **개체 경계** = 완전한 원이 아니라 광원 방향 림라이트
 *
 * ## 3차 개정 — **림라이트도 몸으로**, 그리고 게이트는 걷는다
 * 2차의 "반쪽 림라이트" 는 여전히 `arc()` stroke, 즉 **고정 반경 원호**라 실루엣을 따라가지
 * 않았다(1차의 완전한 원을 반으로 자른 것에 불과했다). 3차는 그 자리를 **본체 텍스처의 가산
 * 사본**으로 바꿨다 — 이 레인의 `enemyBodyGlow` 가 수치로 성공시킨 바로 그 기법이고, 텍스처
 * 사본은 정의상 실루엣을 따라간다. 함께 고친 것:
 * - **보스 룬**: 원 궤도(기준량이 폭 하나) → **경계 상자 축별** 배치. 비정사각 스프라이트에서
 *   배수를 아무리 줄여도 짧은 축은 몸 안·긴 축은 몸 밖이 되는 성질을 없앴다.
 * - **엘리트 오라**: 외곽 1.45r → 1.12r. 몸에서 떨어진 동심 완전 원은 "선택 링" 그 자체였다.
 * - **게이트 하강 시 철거**: 생성만 막고 걷지 않으면, 자동 티어 강등(= FPS 가 떨어져 완화가
 *   가장 필요한 순간)에 이미 만든 장식이 그대로 남아 비용을 계속 낸다.
 * - **런 경계**({@link lastAlive}): 재적 기록이 id 뿐이라 새 런의 스폰을 억제하고 있었다.
 *
 * ## 스폰 시점은 렌더 부착 시점이 아니다 (1차 CRITICAL)
 * `onAttach` 는 `entityRenderer.reset()` 마다 다시 불린다(`main.ts` 화면 전환 5곳). 1차는 거기서
 * 태어난 것으로 쳐서 **화면 전환마다 전 적이 동시에 스폰 인을 재생**했고, 보스전 실측 bright
 * 1.88% → 12.22% 로 §2-4 상한(7%)을 1.75배 넘겼다. 그래서 {@link lastAlive} 로 "직전
 * 프레임까지 살아 있던 id" 를 기억해 **재부착과 신생을 가른다**. 화면 재구성은 스폰이 아니다.
 *
 * ## 예산 — 개체당 비용이 20~40 배로 곱해진다
 * 1. **장식 정원제**({@link MAX_DECORATED_ENEMIES}). 보스·엘리트는 정원 밖(항상 장식).
 * 2. **동시 연출 정원** — 스폰({@link MAX_CONCURRENT_SPAWNS})·열 오버레이
 *    ({@link MAX_BODY_GLOW}). §2-4 는 개체당이 아니라 **화면 총량** 예산이라 동시 수를 막아야 한다.
 * 3. **정적 기하 + 변환 애니메이션.** 재빌드는 상태 전이에서만.
 * 4. **티어 사다리.** low = 엘리트·보스 표식만, med = + 오라·예비동작·손상, high = + 화염·파편.
 *
 * ## 형제 컨테이너 회수 · 귀속 라벨
 * 여기서 만드는 컨테이너는 스프라이트의 **형제**라 부모 `destroy` 로 걷히지 않는다.
 * {@link EnemyAdorner.dispose} 가 전부 떼고 파괴한다. 모든 표시 객체에 `label` 을 박아
 * (§2-4 귀속 규약) 하네스에서 하나씩 꺼 밝기 기여를 가를 수 있게 한다.
 *
 * ## 결정론(ADR-0005)
 * render-only 다. `src/sim/` 는 타입 전용 import 이고 `data/enemies.js` 는 leaf 카탈로그를
 * 읽기만 한다. `hashWorld` 에 아무것도 더하지 않는다.
 */

import { Container, Graphics, Sprite, type Texture } from 'pixi.js';

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
import { lightX, lightY } from '../env/theme.js';
import {
  buildBossAura,
  buildBossInsignia,
  buildDashSmear,
  buildEliteAura,
  buildEliteInsignia,
  buildFlame,
  buildMendAura,
  buildMuzzleCharge,
  buildRootedHeat,
  buildShard,
  buildShockRing,
  buildSmoke,
  buildSparks,
  buildSpawnHalo,
} from './enemyParts.js';

// ---------------------------------------------------------------------------
// 예산 상수 (placeholder, defer-balance-tuning)
// ---------------------------------------------------------------------------

/** 동시에 장식할 수 있는 **잡몹** 최대 수. 보스·엘리트는 이 정원 밖이다. */
export const MAX_DECORATED_ENEMIES = 28;

/**
 * 동시에 재생할 수 있는 스폰 인 최대 수. 웨이브가 한 프레임에 20기를 낳으면 물질화 발광이
 * 한꺼번에 켜져 §2-4 밝기 상한을 넘는다 — 정원 밖은 즉시 완료 처리해 **본체만 나타난다**.
 */
export const MAX_CONCURRENT_SPAWNS = 6;

/**
 * 동시에 켤 수 있는 본체 열 오버레이 최대 수. 화면 전체가 대파 상태가 되는 구간이 실제로 있고
 * (보스전 후반), 몸 전체를 덮는 가산이라 개당 밝기 기여가 크다.
 */
export const MAX_BODY_GLOW = 10;

/** 동시에 살아 있을 수 있는 사망 파편 수. 넘치면 가장 오래된 것부터 회수한다. */
export const MAX_DEATH_DEBRIS = 48;

/** 사망 파편 수명(초). */
const DEBRIS_LIFE = 0.55;

/**
 * 재부착 판정 창(프레임). 이 프레임 수 안에 살아 있던 id 가 다시 부착되면 **신생이 아니다**
 * (`reset()` 은 다음 렌더 프레임에 전 엔티티를 재부착한다 — 간격 1프레임).
 */
export const REATTACH_WINDOW = 3;

/**
 * 림라이트 오프셋(표시 반치수 배율). 본체 텍스처의 가산 사본을 광원 **쪽**으로 이만큼 밀어
 * 그 방향 가장자리만 실루엣 밖으로 삐져나오게 한다(레인 A `playerRim` 과 같은 값·같은 원리).
 */
const RIM_OFFSET = 0.14;
/** 림 사본 알파. 20기가 동시에 켜져도 §2-4 예산 안에 들도록 낮게 잡는다. */
const RIM_ALPHA = 0.22;

// ---------------------------------------------------------------------------
// 종 정보 — leaf 카탈로그에서 읽는다(sim 상태 아님)
// ---------------------------------------------------------------------------

/** 이 kind 가 이 모듈의 장식 대상인가. 등록 목록과 반드시 같아야 한다(테스트가 대조한다). */
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
// 플레이어 위치 관측 — 돌진 커밋 판정의 유일한 입력
// ---------------------------------------------------------------------------

/**
 * 직전 프레임의 플레이어 보간 위치. `null` = 아직 못 봤다.
 *
 * 왜 필요한가: 돌진 커밋의 뜻은 "빠르다" 가 아니라 **"이 선 위에 있으면 맞는다"** 이고, 그
 * 판정에는 플레이어 위치가 있어야 한다. 그런데 장식자의 `onFrame` 은 자기 엔티티만 받는다.
 * 그래서 `player` kind 에 **위치만 기록하는 최소 장식자**({@link PlayerProbeAdorner})를 하나
 * 등록한다 — 그리는 것이 하나도 없어 레인 A(`playerVisual.ts`)와 화면에서 겹치지 않고,
 * 레지스트리는 kind 당 여러 팩토리를 누적하므로 등록도 다투지 않는다.
 */
let playerPos: { x: number; y: number } | null = null;

/** 플레이어 위치 관측창(테스트·하네스용). */
export function observedPlayerPos(): { x: number; y: number } | null {
  return playerPos;
}

// ---------------------------------------------------------------------------
// 신생 판별 — 재부착(화면 전환)과 진짜 스폰을 가른다
// ---------------------------------------------------------------------------

/**
 * 개체 재적 기록 한 건. 프레임만으로는 부족하다 — 아래 {@link lastAlive} 참조.
 */
interface Presence {
  /** 마지막으로 살아 있던 렌더 프레임. */
  frame: number;
  /** 그때의 종(typeIndex). */
  type: number;
  /** 그때의 최대 HP. */
  maxHp: number;
}

/**
 * id → 마지막 재적. `dispose` 로 지우지 **않는다** — `reset()` 이 전 장식자를 회수한 직후에도
 * "직전 프레임엔 있었다" 를 기억해야 재부착을 알아본다. {@link prunePresence} 가 오래된 항목을
 * 걷어 무한 성장을 막는다.
 *
 * ## 왜 프레임만으로 부족한가
 * 키가 `id` 뿐이면 **새 런의 id 1~N 이 앞 런의 id 1~N 으로 오인**돼 스폰 연출이 통째로
 * 사라진다(실측: 연속 `startRun` 에서 `activeSpawnCount` 전 프레임 0). 그래서 종·최대 HP 까지
 * 함께 대조한다 — 화면 전환은 **같은 실체**가 돌아오는 것이라 셋이 모두 일치하고, 새 런은
 * 대개 다른 종·다른 HP 다.
 *
 * ⚠️ **완전한 해법은 아니다.** 새 런의 첫 적이 id·종·최대 HP 까지 우연히 일치하고 그것이 직전
 * 런 종료로부터 {@link REATTACH_WINDOW} 프레임 안에 나타나면 여전히 억제된다. 그 경우를 확실히
 * 가르려면 "런이 시작됐다" 는 신호가 필요한데, 그 신호를 주는 곳(`main.ts`·하네스)은 이 레인의
 * 소유 파일이 아니다 — 잔여 위험으로 보고한다.
 *
 * ## 한 번 넣었다 뺀 것: "공백으로 런 경계를 가른다"
 * 적이 0 인 프레임이 {@link REATTACH_WINDOW} 넘게 이어지면 맵을 통째로 비우는 장치를 넣었다가
 * **뮤테이션이 죽지 않아 걷어냈다.** 아래 개별 판정이 `frameTick - seen <= REATTACH_WINDOW` 로
 * 이미 **id 별로 같은 일**을 하므로 순수한 중복이었다. 지워도 아무 테스트가 안 깨지는 방어는
 * 방어가 아니다.
 */
const lastAlive = new Map<number, Presence>();

/** 이 프레임 수보다 오래된 재적 기록은 버린다(맵 무한 성장 방지). */
const PRESENCE_TTL = 240;

function prunePresence(frameTick: number): void {
  if (frameTick % 120 !== 0) return; // 2초에 한 번이면 충분하다(맵 크기 = 동시 적 수 수준).
  for (const [id, p] of lastAlive) {
    if (frameTick - p.frame > PRESENCE_TTL) lastAlive.delete(id);
  }
}

// ---------------------------------------------------------------------------
// 사망 파편 풀 — **고아 이펙트를 구조적으로 불가능하게 만든다**
// ---------------------------------------------------------------------------

/** 파편 하나. 장식자가 죽은 뒤에도 살아야 하므로 개체가 아니라 **모듈 풀**이 소유한다. */
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
/** 이번 프레임에 이미 풀을 진행했는가(프레임당 1회 보장). */
let debrisPumpedTick = -1;
/** 살아 있는 장식자 수(장식 여부 무관). 풀을 굴려 줄 주체가 남아 있는지의 유일한 근거다. */
let liveAdorners = 0;
/** 지금까지 방출된 파편 누적 수. */
let debrisEmitted = 0;
/** 사망 서명별 방출 횟수 — 종별 사망 연출이 실제로 갈리는지의 관측창. */
const deathSignatures = new Map<string, number>();

/**
 * 파편 풀을 dt 만큼 진행한다. 프레임당 1회.
 *
 * ⚠️ 이 풀은 **자기 티커가 없다** — 살아 있는 장식자의 `onFrame` 이 굴려 준다. 그래서
 * {@link releaseDebrisIfOrphaned} 가 "굴려 줄 사람이 없으면 즉시 전부 회수" 를 강제한다.
 */
function pumpDebris(ctx: AdornerContext): void {
  if (ctx.frameTick === debrisPumpedTick) return;
  debrisPumpedTick = ctx.frameTick;
  prunePresence(ctx.frameTick);
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

function dropDebris(i: number): void {
  const d = debris[i];
  if (d === undefined) return;
  d.layer.removeChild(d.node);
  d.node.destroy({ children: true });
  debris.splice(i, 1);
}

function clearDebris(): void {
  for (let i = debris.length - 1; i >= 0; i--) dropDebris(i);
}

/**
 * 장식자가 하나도 안 남았으면 파편을 전부 회수한다. 굴려 줄 주체가 사라진 파편은 **화면에
 * 얼어붙기 때문에**, "예뻐 보이는 잔상" 보다 "확실히 사라짐" 을 택한다.
 */
function releaseDebrisIfOrphaned(): void {
  if (liveAdorners <= 0) clearDebris();
}

function pushDebris(d: Debris): void {
  while (debris.length >= MAX_DEATH_DEBRIS) dropDebris(0);
  d.layer.addChild(d.node);
  debris.push(d);
  debrisEmitted += 1;
}

/** 현재 살아 있는 파편 수(읽기 전용 관측창). */
export function deathDebrisCount(): number {
  return debris.length;
}

/**
 * 지금까지 **방출된** 파편 누적 수(읽기 전용 관측창).
 *
 * 왜 살아 있는 수와 따로 필요한가: 고아 방지에는 두 장치가 있는데(사전 가드 + 사후 회수)
 * **살아 있는 수만 보면 둘을 구분할 수 없다** — 뿌린 뒤 즉시 걷어도 0 이기 때문이다.
 */
export function deathDebrisEmitted(): number {
  return debrisEmitted;
}

/**
 * 사망 서명별 방출 횟수(읽기 전용 관측창) — 키는 이동 종류(`chargeStraight` 등)나 `'boss'`.
 *
 * 왜 필요한가: 1차 검증에서 비평가가 `cheat` 로 hp 를 0 으로 밀어도 sim 이 처치로 처리하지
 * 않아 **종별 사망 서명을 확인할 방법이 없었다.** "검증 불가능한 항목은 검증되지 않은 항목"
 * 이므로 자연 사망에서도 종을 특정할 수 있는 창을 연다(하네스에서 그대로 읽을 수 있다).
 */
export function deathSignatureCounts(): Record<string, number> {
  return Object.fromEntries(deathSignatures);
}

/** 결정적 의사난수 [0,1). 시드만으로 정해져 프레임마다 흔들리지 않는다. */
function hash01(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// ---------------------------------------------------------------------------
// 동시 연출 정원 (§2-4 화면 총량)
// ---------------------------------------------------------------------------

let activeSpawns = 0;
let activeBodyGlows = 0;

/** 현재 살아 있는 적 장식자 수(읽기 전용 관측창). */
export function enemyAdornerCount(): number {
  return liveAdorners;
}

/** 현재 재생 중인 스폰 인 수(관측창). */
export function activeSpawnCount(): number {
  return activeSpawns;
}
/** 현재 켜진 본체 열 오버레이 수(관측창). */
export function activeBodyGlowCount(): number {
  return activeBodyGlows;
}

// ---------------------------------------------------------------------------
// 장식자
// ---------------------------------------------------------------------------

class EnemyAdorner implements EntityAdorner {
  readonly name = 'enemy-visual';

  private below: Container | null = null;
  private above: Container | null = null;

  private aura: Graphics | null = null;
  private insignia: Container | null = null;
  private rim: Sprite | null = null;
  private spawnHalo: Graphics | null = null;
  private telegraph: Container | null = null;
  private sparks: Graphics | null = null;
  private flame: Graphics | null = null;
  private smoke: Graphics | null = null;
  /** 본체 전체를 덮는 가산 열 오버레이(같은 텍스처). 손상이 **몸의 상태**로 읽히는 장치다. */
  private bodyGlow: Sprite | null = null;
  private bodyGlowOwned = false;

  private telegraphFor = -1;
  private damageFor = -1;

  private readonly posture: PostureState = createPostureState();
  private bornTick = 0;
  private radius = 1;
  /** 본체 표시 반치수. **원 궤도의 기준량이 폭 하나면 비정사각 스프라이트에서 축마다 어긋난다.** */
  private halfW = 1;
  private halfH = 1;
  private lastX = 0;
  private lastY = 0;
  private lastSeenTick = -1;
  private headingX = 1;
  private headingY = 0;
  private spawnDone = false;
  private spawnOwned = false;
  private disposed = false;
  private ctx: AdornerContext | null = null;
  /** 본체 기본 스케일(스폰 물질화·스쿼시가 되돌릴 기준). */
  private baseScaleX = 1;
  private baseScaleY = 1;
  /** 본체 변환·밝기를 우리가 건드렸는가(회수 시 원복 판단). */
  private spriteTouched = false;

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

  /** 보스 계열은 `entityRenderer` 의 보스 분기가 `alpha`·`tint` 를 전유한다 — 몸을 건드리지 않는다. */
  private get bodyOwnedByRenderer(): boolean {
    return this.kind === 'boss' || this.kind === 'defenseBoss';
  }

  onAttach(sprite: Sprite, e: EntitySnapshot, ctx: AdornerContext): void {
    const w = sprite.width;
    const h = sprite.height;
    this.radius = w > 0 ? w / 2 : Math.max(1, e.radius);
    this.halfW = w > 0 ? w / 2 : Math.max(1, e.radius);
    this.halfH = h > 0 ? h / 2 : Math.max(1, e.radius);
    this.lastX = sprite.x;
    this.lastY = sprite.y;
    this.baseScaleX = sprite.scale.x;
    this.baseScaleY = sprite.scale.y;
    this.bornTick = ctx.frameTick;

    // ── 신생인가 재부착인가 ────────────────────────────────────────────────
    // `reset()` 은 다음 프레임에 전 엔티티를 다시 부착한다. 그때를 스폰으로 치면 화면 전환마다
    // 전 적이 동시에 물질화해 §2-4 밝기 상한을 넘긴다(실측 1.88% → 12.22%).
    const seen = lastAlive.get(e.id);
    // 같은 실체가 돌아온 것인가 — 프레임 간격뿐 아니라 **종·최대 HP 까지** 같아야 한다.
    const reattach =
      seen !== undefined &&
      ctx.frameTick - seen.frame <= REATTACH_WINDOW &&
      seen.type === e.enemyType &&
      seen.maxHp === e.maxHp;
    if (reattach || !this.decorated || activeSpawns >= MAX_CONCURRENT_SPAWNS) {
      // 재부착·비장식·정원 초과 → 연출 없이 즉시 완료(본체만 나타난다).
      this.spawnDone = true;
    } else {
      this.spawnOwned = true;
      activeSpawns += 1;
    }
  }

  onFrame(sprite: Sprite, e: EntitySnapshot, prev: EntitySnapshot, ctx: AdornerContext): void {
    pumpDebris(ctx);
    this.lastSeenTick = ctx.frameTick;
    lastAlive.set(e.id, { frame: ctx.frameTick, type: e.enemyType, maxHp: e.maxHp });
    this.lastX = sprite.x;
    this.lastY = sprite.y;
    this.ctx = ctx;
    if (!this.decorated) return;

    const low = ctx.tier === 'low';
    const glow = ctx.gates.halo;
    // 모션 게이트: 저티어이거나 reducedMotion 이면 흔들림 게이트가 내려간다. 진동·회전·맥동을
    // 전부 여기에 매달아 광과민 대응이 한 곳에서 끝나게 한다.
    const motion = ctx.gates.shake;

    const dx = e.x - prev.x;
    const dy = e.y - prev.y;
    const d = Math.hypot(dx, dy);
    if (d > 1e-4) {
      this.headingX = dx / d;
      this.headingY = dy / d;
    }

    const posture = observePosture(this.posture, e, prev, this.movement, ctx.frameTick, playerPos);
    const stage = damageStage(e.hp, e.maxHp);
    const t = ctx.frameTick * 0.1 + this.phase;

    this.syncLayers(sprite);
    this.updateThreat(sprite, glow, motion, low, t);
    this.updateRim(sprite, ctx, low, glow);
    this.updateSpawn(sprite, ctx, glow, low);
    this.updateTelegraph(sprite, e, posture, glow, low, motion, t);
    this.updateDamage(sprite, ctx, stage, glow, low, motion, t);
  }

  /** 이미 만든 소유 컨테이너를 스프라이트 보간 위치로 미러한다. **만들지는 않는다.** */
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
      this.below.label = 'enemyBelow'; // §2-4 귀속 라벨
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
      this.above.label = 'enemyAbove';
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

    if (glow && !low) {
      const below = this.aura === null ? this.ensureBelow(sprite) : this.below;
      if (this.aura === null && below !== null) {
        this.aura = boss
          ? buildBossAura(this.radius, this.accent)
          : buildEliteAura(this.radius, this.accent);
        this.aura.label = 'enemyAura';
        below.addChild(this.aura);
      }
      if (this.aura !== null) {
        const pulse = motion ? 1 + 0.05 * Math.sin(t * (boss ? 0.45 : 0.7)) : 1;
        this.aura.scale.set(pulse);
      }
    } else {
      // 게이트가 내려가면 **감추는 게 아니라 걷는다.** `visible=false` 로 두면 티어 강등
      // (= FPS 가 떨어져 완화가 가장 필요한 순간)에 표시 객체가 그대로 남아 비용을 계속 낸다.
      this.aura = destroyChild(this.below, this.aura);
    }

    // 휘장은 발광이 아니라 **정보**라 halo 게이트에 매달지 않는다(발광을 껐다고 계급이
    // 사라지면 안 된다). low 티어에서도 남긴다: 정적 도형 하나라 사실상 공짜다.
    const above = this.insignia === null ? this.ensureAbove(sprite) : this.above;
    if (this.insignia === null && above !== null) {
      this.insignia = boss
        ? buildBossInsignia(this.halfW, this.halfH, this.accent)
        : buildEliteInsignia(this.radius, this.accent);
      this.insignia.label = 'enemyInsignia';
      above.addChild(this.insignia);
    }
    if (this.insignia !== null) {
      if (boss) this.insignia.rotation = motion ? t * 0.12 : 0;
      else this.insignia.y = motion ? Math.sin(t * 0.8) * this.radius * 0.06 : 0;
    }
  }

  /**
   * **림라이트 — 본체 텍스처의 가산 사본을 광원 쪽으로 민다.**
   *
   * 2차까지는 고정 반경 `arc()` stroke 였고, 그래서 **실루엣을 따라가지 않았다**: 확대하면
   * 몸 경계에서 떨어진 구간과 몸을 가로지르는 구간이 동시에 생기고, 보스 스케일에서는 굵은
   * 띠가 몸 아래 빈 공간을 가로질렀다. 원호로는 원리적으로 림라이트를 만들 수 없다.
   *
   * 텍스처 사본은 정의상 실루엣을 따라간다. 같은 기법이 이 레인의 `enemyBodyGlow` 에서 이미
   * 수치로 통했고(HP5% 컷 단독 기여 mean 1.57 / 국소 49.82), 레인 A 의 `playerRim` 도 같다.
   *
   * **아래 레이어**에 둔다 — 위에 두면 사본이 본체를 통째로 밝혀 실루엣이 흐려진다. 아래면
   * 광원 쪽으로 밀린 만큼만 삐져나와 초승달 하이라이트가 된다.
   *
   * 테마가 없으면(담당 배경 없는 행성) 광원이 없는 것이므로 **스스로 꺼진다**(계약 §3 광원 일관성).
   */
  private updateRim(sprite: Sprite, ctx: AdornerContext, low: boolean, glow: boolean): void {
    // low 티어에서는 잡몹 림을 포기한다(개체당 사본 하나가 40배로 곱해진다). 엘리트·보스는 남긴다.
    // ⚠️ 게이트가 **내려갈 때 이미 만든 것을 걷는 분기**가 있어야 한다. 자동 티어 강등은 FPS 가
    // 떨어지는 순간 — 완화가 가장 필요한 그 순간 — 에 발동하는데, 생성만 막으면 그때 안 걷힌다.
    if ((low && this.tier === 0) || !glow || ctx.theme === null) {
      this.dropRim();
      return;
    }
    const above = this.rim === null ? this.ensureBelow(sprite) : this.below;
    if (this.rim === null && above !== null) {
      const rim = new Sprite(sprite.texture);
      rim.label = 'enemyRim';
      rim.anchor.set(0.5);
      rim.blendMode = 'add';
      rim.tint = this.accent;
      rim.alpha = RIM_ALPHA;
      above.addChild(rim);
      this.rim = rim;
    }
    const rim = this.rim;
    if (rim === null) return;
    // 애니메이션 프레임 교체를 따라간다 — 안 따라가면 어긋난 잔상이 생긴다.
    if (rim.texture !== sprite.texture) rim.texture = sprite.texture;
    const mag = Math.max(this.halfW, this.halfH) * RIM_OFFSET;
    // 컨테이너가 이미 본체 위치에 있으므로 오프셋만 로컬로 준다.
    rim.position.set(lightX(ctx.theme.light) * mag, lightY(ctx.theme.light) * mag);
    rim.rotation = sprite.rotation;
    rim.scale.set(sprite.scale.x, sprite.scale.y);
  }

  /** 림 회수(게이트 하강·테마 소실 공통). */
  private dropRim(): void {
    this.rim = destroyChild(this.below, this.rim);
  }

  /**
   * 스폰 인 — **본체 스케일·알파 물질화** + 눈금 없는 소프트 헤일로. 1차의 십자 눈금 링과
   * 흰 스트라이프 기둥은 §2-5 위반이라 삭제했다.
   */
  private updateSpawn(sprite: Sprite, ctx: AdornerContext, glow: boolean, low: boolean): void {
    if (this.spawnDone) return;
    if (low || !glow) {
      this.finishSpawn(sprite);
      return;
    }
    const p = spawnProgress(this.bornTick, ctx.frameTick);
    const below = this.spawnHalo === null ? this.ensureBelow(sprite) : this.below;
    if (this.spawnHalo === null && below !== null) {
      this.spawnHalo = buildSpawnHalo(this.radius, this.accent);
      this.spawnHalo.label = 'enemySpawn';
      below.addChild(this.spawnHalo);
    }
    if (this.spawnHalo !== null) {
      // 2.2배에서 1배로 조여든다 — "여기 온다" 가 실체보다 먼저 읽힌다.
      this.spawnHalo.scale.set(2.2 - 1.2 * p);
      this.spawnHalo.alpha = 1 - p * p;
    }
    // 본체가 작게·희미하게 시작해 제 크기로 자란다. 보스는 렌더러 보스 분기가 alpha 를
    // 전유하므로 건드리지 않는다.
    if (!this.bodyOwnedByRenderer) {
      const s = 0.62 + 0.38 * p;
      sprite.scale.set(this.baseScaleX * s, this.baseScaleY * s);
      sprite.alpha = 0.4 + 0.6 * p;
      this.spriteTouched = true;
    }
    if (p >= 1) this.finishSpawn(sprite);
  }

  /** 스폰 종료 — 헤일로를 회수하고 본체 변환·밝기를 정확히 원래대로 되돌린다. */
  private finishSpawn(sprite: Sprite): void {
    if (this.spawnDone) return;
    this.spawnDone = true;
    if (this.spawnOwned) {
      this.spawnOwned = false;
      activeSpawns -= 1;
    }
    this.restoreBody(sprite);
    this.spawnHalo = destroyChild(this.below, this.spawnHalo);
  }

  /** 본체 변환·밝기 원복(스폰·스쿼시가 건드린 것). */
  private restoreBody(sprite: Sprite): void {
    if (!this.spriteTouched || this.bodyOwnedByRenderer) return;
    sprite.scale.set(this.baseScaleX, this.baseScaleY);
    sprite.alpha = 1;
    this.spriteTouched = false;
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
      if (this.spawnDone) this.restoreBody(sprite);
      return;
    }
    if (posture !== this.telegraphFor) {
      this.dropTelegraph();
      this.telegraphFor = posture;
      const below = this.ensureBelow(sprite);
      if (below !== null) {
        const made = this.buildTelegraph(posture);
        if (made !== null) {
          made.label = 'enemyTelegraph';
          this.telegraph = made;
          below.addChild(made);
        }
      }
    }

    // 유지 시간에 비례해 세진다 — 순간 점멸이 아니라 "고조" 로 읽혀야 예고가 된다.
    const hold = Math.min(1, this.posture.holdFrames / 18);
    const tel = this.telegraph;

    if (posture === POSTURE_RELOCK) {
      // **재조준 = 몸이 웅크린다.** 1차의 4모서리 괄호(락온 브래킷)를 몸으로 옮긴 것이다.
      // 그 동안 몸이 가산으로 명멸한다(Gungeon 어휘).
      //
      // 스쿼시는 **스프라이트 로컬 축**에 준다. `enemy` 는 고정 기수 kind 가 아니라
      // (`entityRenderer` `FIXED_FACING_KINDS`) 렌더러가 `sprite.rotation = e.angle` 을 걸고,
      // `moveCharge` 는 `angle = atan2(vy, vx)` 라 **로컬 +x 가 곧 진행 방향**이다. 즉 아래
      // `scale.x` 압축은 화면 가로가 아니라 진행축 압축이다 — 다만 그 등식은 회전이 걸리는
      // kind 에서만 성립하므로, 회전이 0 으로 고정되는 보스 계열은 애초에 제외돼 있다.
      const k = Math.min(1, this.posture.holdFrames / 10);
      if (!this.bodyOwnedByRenderer && motion) {
        const squash = 1 - 0.18 * (1 - k);
        sprite.scale.set(this.baseScaleX * squash, this.baseScaleY * (2 - squash));
        this.spriteTouched = true;
      }
      if (tel !== null) tel.alpha = (1 - k) * 0.9;
    } else if (this.spawnDone) {
      this.restoreBody(sprite);
    }

    if (tel === null) return;
    if (posture === POSTURE_FIRING_BAND) {
      tel.rotation = e.angle; // sim 의 standoff 는 angle 을 항상 플레이어 방향으로 둔다.
      const breathe = motion ? 0.88 + 0.12 * Math.sin(t * 1.6) : 1;
      tel.scale.set((0.55 + 0.65 * hold) * breathe);
      tel.alpha = 0.35 + 0.65 * hold;
    } else if (posture === POSTURE_COMMIT) {
      tel.rotation = Math.atan2(this.headingY, this.headingX);
      tel.alpha = 0.45 + 0.55 * hold;
    } else if (posture === POSTURE_TENDING) {
      tel.alpha = (0.5 + 0.5 * hold) * (motion ? 0.85 + 0.15 * Math.sin(t * 1.1) : 1);
    } else if (posture === POSTURE_ROOTED) {
      tel.rotation = motion ? t * 0.12 : 0;
      tel.alpha = 0.85;
    }
  }

  /** 자세별 텔레그래프 기하. 몸으로 표현하는 재조준은 발광 한 겹만 만든다. */
  private buildTelegraph(posture: number): Container | null {
    if (posture === POSTURE_FIRING_BAND) return buildMuzzleCharge(this.radius, this.accent);
    if (posture === POSTURE_COMMIT) return buildDashSmear(this.radius, this.accent);
    if (posture === POSTURE_RELOCK) {
      const c = new Container();
      c.addChild(buildSpawnHalo(this.radius * 0.9, this.accent));
      return c;
    }
    if (posture === POSTURE_TENDING) {
      const c = new Container();
      c.addChild(buildMendAura(this.radius, this.accent));
      return c;
    }
    if (posture === POSTURE_ROOTED) {
      const c = new Container();
      c.addChild(buildRootedHeat(this.radius, this.accent));
      return c;
    }
    return null;
  }

  private dropTelegraph(): void {
    this.telegraph = destroyChild(this.below, this.telegraph);
    this.telegraphFor = -1;
  }

  /**
   * 손상 상태 — HP 비율 누진. **핵심은 본체 열 오버레이**다: 1차의 3.8px 불티는 카르곤 용암
   * 발광 위에서 화면 델타가 노이즈 바닥 밑이었다(§4-2 = 화면에 없는 것). 손상은 장식이 아니라
   * **몸의 상태**이므로 몸 전체를 같은 텍스처의 가산 사본으로 덮어 달아오르게 한다.
   */
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
      this.damageFor = DMG_OK;
      return;
    }
    // 재빌드 키에 **게이트를 포함**한다. 단계만 키로 쓰면 런 중간에 `reducedGlow` 를 켜도
    // 단계가 그대로라 재평가가 안 돌아 이미 만든 발광이 남는다(실측 잔존: bodyGlow 2 · damage 12).
    const key =
      stage + (glow ? 1000 : 0) + (ctx.gates.particles !== 'off' ? 100 : 0) + (ctx.tier === 'high' ? 10 : 0);
    if (key !== this.damageFor) {
      this.dropDamage();
      this.damageFor = key;
      const below = glow ? this.ensureBelow(sprite) : null;
      if (below !== null) {
        this.sparks = buildSparks(this.radius, 0xffc46a, stage >= DMG_FIRE ? 7 : 4);
        this.sparks.label = 'enemyDamage';
        below.addChild(this.sparks);
        if (stage >= DMG_FIRE && ctx.tier === 'high') {
          this.flame = buildFlame(this.radius);
          this.flame.label = 'enemyDamage';
          below.addChild(this.flame);
        }
      }
      // 연기는 유일한 어두운 도형이라 파티클 게이트 뒤에 둔다(발광 감소와는 무관한 축).
      if (stage >= DMG_SMOKE && ctx.gates.particles !== 'off') {
        const above = this.ensureAbove(sprite);
        if (above !== null) {
          this.smoke = buildSmoke(this.radius);
          this.smoke.label = 'enemyDamage';
          above.addChild(this.smoke);
        }
      }
      // 본체 열 오버레이 — 대파(FIRE) 이상 + 발광 게이트 + 동시 정원 안에서만.
      if (stage >= DMG_FIRE && glow && !this.bodyOwnedByRenderer) this.ensureBodyGlow(sprite);
    }

    if (this.sparks !== null) {
      this.sparks.rotation = motion ? t * 0.9 : 0;
      const flick = stage >= DMG_CRITICAL && motion ? (Math.sin(t * 3.1) > 0 ? 1 : 0.4) : 1;
      this.sparks.alpha = (stage === DMG_SPARK ? 0.6 : 0.9) * flick;
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
    if (this.bodyGlow !== null) {
      // 본체와 정확히 겹치게 변환을 미러한다(형제라 자동 상속이 없다). 애니메이션 프레임
      // 교체도 따라간다 — 안 따라가면 팔다리가 어긋난 잔상이 생긴다.
      const tex: Texture = sprite.texture;
      if (this.bodyGlow.texture !== tex) this.bodyGlow.texture = tex;
      this.bodyGlow.rotation = sprite.rotation;
      this.bodyGlow.scale.set(sprite.scale.x, sprite.scale.y);
      // 치명 단계는 맥동이 빨라진다 — "한 대만 더" 가 몸에서 읽힌다.
      const beat = motion ? 0.75 + 0.25 * Math.sin(t * (stage >= DMG_CRITICAL ? 3.4 : 1.7)) : 1;
      this.bodyGlow.alpha = (stage >= DMG_CRITICAL ? 0.5 : 0.32) * beat;
    }
  }

  /** 본체 열 오버레이 생성(동시 정원 안에서만). */
  private ensureBodyGlow(sprite: Sprite): void {
    if (this.bodyGlow !== null) return;
    if (activeBodyGlows >= MAX_BODY_GLOW) return;
    const above = this.ensureAbove(sprite);
    if (above === null) return;
    const s = new Sprite(sprite.texture);
    s.label = 'enemyBodyGlow';
    s.anchor.set(0.5);
    s.blendMode = 'add';
    // 웜 틴트 — 가산이라 곱해진 뒤 더해진다. 결과는 그 적의 색이 **달아오른** 모습이고,
    // 어둡게 만들지 않으므로 위장률 게이트를 건드리지 않는다(tint 를 직접 미는 것과의 차이다).
    s.tint = 0xff8a3c;
    above.addChild(s);
    this.bodyGlow = s;
    this.bodyGlowOwned = true;
    activeBodyGlows += 1;
  }

  private dropBodyGlow(): void {
    if (this.bodyGlow !== null) {
      this.above?.removeChild(this.bodyGlow);
      this.bodyGlow.destroy();
      this.bodyGlow = null;
    }
    if (this.bodyGlowOwned) {
      this.bodyGlowOwned = false;
      activeBodyGlows -= 1;
    }
  }

  private dropDamage(): void {
    this.sparks = destroyChild(this.below, this.sparks);
    this.flame = destroyChild(this.below, this.flame);
    this.smoke = destroyChild(this.above, this.smoke);
    this.dropBodyGlow();
    this.damageFor = -1;
  }

  dispose(ctx: AdornerContext): void {
    if (this.disposed) return; // 두 번 불려도 안전(회수 경로가 겹칠 수 있다).
    this.disposed = true;
    liveAdorners -= 1;
    if (this.spawnOwned) {
      this.spawnOwned = false;
      activeSpawns -= 1;
    }
    this.dropBodyGlow();

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
    this.spawnHalo = null;
    this.telegraph = null;
    this.sparks = null;
    this.flame = null;
    this.smoke = null;

    releaseDebrisIfOrphaned();
  }

  /**
   * 사망 연출 — 종별 파편. **세 겹의 가드**를 통과해야만 방출한다:
   *
   * 1. `ctx.dt > 0` — `reset`/`destroy` 경로는 `dt: 0` 으로 맥락을 만든다(`disposeAllAdorners`).
   * 2. **직전 프레임까지 살아 있었다** — 킬 루프는 스냅샷에서 사라진 프레임에 돈다.
   * 3. **다른 장식자가 남아 있다** — 파편 풀은 자기 티커가 없다. 아무도 안 남았으면 방출조차
   *    하지 않는다(고아 이펙트가 구조적으로 불가능해진다).
   */
  private emitDeath(ctx: AdornerContext): void {
    if (!this.decorated) return;
    if (ctx.tier === 'low' || ctx.gates.particles === 'off') return;
    if (!(ctx.dt > 0)) return;
    if (ctx.frameTick - this.lastSeenTick > 1) return;
    if (liveAdorners <= 0) return;

    const layer = ctx.aboveLayer;
    const r = this.radius;
    const mv = this.movement;
    const boss = this.tier === THREAT_BOSS;
    const signature = boss ? 'boss' : (mv ?? 'unknown');
    deathSignatures.set(signature, (deathSignatures.get(signature) ?? 0) + 1);
    const count = boss ? 14 : this.tier === THREAT_ELITE ? 9 : 6;

    if (mv === 'standoff' || boss) {
      // 충격파 고리 — 사수형/보스의 서명.
      const ring = buildShockRing(r * 0.6, this.accent);
      ring.label = 'enemyDebris';
      const node = wrap(ring, this.lastX, this.lastY);
      node.scale.set(0.4);
      pushDebris({ node, vx: 0, vy: 0, spin: 0, age: 0, life: DEBRIS_LIFE * 0.7, layer });
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
        // 안으로 모였다 나가는 내파.
        ang = h * Math.PI * 2 + Math.PI;
        speed *= 0.55;
      }
      const shard = buildShard(r * (0.28 + h2 * 0.3), r * 0.09, this.accent);
      shard.label = 'enemyDebris';
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
  c.label = 'enemyDebris';
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
// 플레이어 위치 관측 장식자 — 그리는 것이 하나도 없다
// ---------------------------------------------------------------------------

/**
 * `player` kind 에 붙는 **관측 전용** 장식자. 컨테이너를 만들지 않고 레이어에 아무것도 붙이지
 * 않으므로 레인 A 의 플레이어 비주얼과 화면에서 겹치지 않는다(밝기 기여 0). 존재 이유는 돌진
 * 커밋 판정이 필요로 하는 플레이어 위치 하나뿐이다.
 */
class PlayerProbeAdorner implements EntityAdorner {
  readonly name = 'enemy-player-probe';
  onFrame(sprite: Sprite): void {
    playerPos = { x: sprite.x, y: sprite.y };
  }
  dispose(): void {
    // 플레이어가 사라지면(사망·리셋) 마지막 위치를 들고 있으면 안 된다 — 없는 표적을 향한
    // 커밋 예고가 화면에 남는다.
    playerPos = null;
  }
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
registerAdornerFactory('player', () => [new PlayerProbeAdorner()]);

/**
 * 관측창을 **전역에 노출**한다 — `globalThis.__pbEnemy`.
 *
 * 왜 필요한가: 비평가가 이 창들을 읽으려고 Vite dev 서버의 동적 import 로 우회했는데,
 * **프로덕션 빌드에서는 그 우회가 안 된다** — 검증 도구가 dev 서버에만 존재하는 셈이다.
 * 모듈 최상위 부수효과로 붙이면 번들 어디서나 읽힌다.
 *
 * ⚠️ `window.__pb` 에 직접 합치지 않은 이유: `main.ts` 가 `__pb = { ... }` 로 **통째 대입**하므로
 * (모듈 평가가 그보다 먼저다) 여기서 넣어도 덮인다. `__pb` 안으로 넣으려면 `main.ts` 에
 * `enemy: __pbEnemy` 한 줄이 필요한데 그건 공유 파일이라 **오케스트레이터 몫**이다.
 */
const debugSurface = {
  activeSpawnCount,
  activeBodyGlowCount,
  deathDebrisCount,
  deathDebrisEmitted,
  deathSignatureCounts,
  enemyAdornerCount,
  observedPlayerPos,
};
(globalThis as unknown as { __pbEnemy?: typeof debugSurface }).__pbEnemy = debugSurface;

/**
 * **테스트 전용** 모듈 상태 초기화. 프로덕션 경로는 부르지 않는다(프로덕션에서는 `dispose`
 * 4경로가 이미 같은 일을 한다).
 */
export function resetEnemyVisualState(): void {
  clearDebris();
  debrisPumpedTick = -1;
  debrisEmitted = 0;
  liveAdorners = 0;
  decoratedGrunts = 0;
  activeSpawns = 0;
  activeBodyGlows = 0;
  playerPos = null;
  lastAlive.clear();
  deathSignatures.clear();
}
