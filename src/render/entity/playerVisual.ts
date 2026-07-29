/**
 * 플레이어 비행체 **AAA 비주얼** — 레인 A(`.omc/plans/entity-aaa-contract.md` §3).
 *
 * 장식자 심({@link file://./adorner.ts})에 `'player'` kind 로 등록되는 두 장식자를 제공한다.
 * 공유 파일(`entityRenderer.ts`)은 한 줄도 건드리지 않는다 — 등록이 함수 호출식이라 3레인이
 * 같은 줄을 다투지 않는다.
 *
 * ## 무엇을 만드는가 (계약 §3 레인 A 6항목)
 * | # | 항목 | 담당 | 자리 |
 * |---|---|---|---|
 * | 1 | 뱅킹/롤 | {@link PlayerBodyAdorner} | 스프라이트 변환(2차 스프링) |
 * | 2 | 엔진 추진 | {@link PlayerThrustAdorner} | belowLayer(가산) |
 * | 3 | 림라이트 | {@link PlayerBodyAdorner} | belowLayer(가산, 광원 쪽 오프셋) |
 * | 4 | 피격 반응 + 무적 표현 | {@link PlayerBodyAdorner} | 변환 임펄스 + aboveLayer 실드 셸 |
 * | 5 | 대시 잔상 | {@link PlayerThrustAdorner} | belowLayer(가산 고스트) |
 * | 6 | 아이들 부유 | {@link PlayerBodyAdorner} | 변환 + 엔진 열기 요동 |
 *
 * ## 가독성이 예쁨을 이긴다 (계약 §2-2)
 * 이 게임은 탄막 슈터다. 그래서 이 파일의 모든 발광은 **belowLayer(스프라이트 아래·가산)** 에
 * 있고, 기수 **반대편**에 있고, 본체보다 어둡다. 실루엣을 덮는 것은 aboveLayer 의 실드 셸
 * 하나뿐인데 그것도 **획(stroke)뿐이고 선체 밖**이라 몸통을 한 픽셀도 가리지 않는다.
 *
 * 특히 **무적 프레임을 깜빡임으로 표현하지 않는다.** 깜빡임은 실루엣을 주기적으로 지워
 * 고밀도 탄막에서 자기 위치를 잃게 만든다 — 정확히 이 게임이 감당할 수 없는 실패다. 대신
 * 선체 밖에서 **선체로 닫혀 들어오는 에너지 실드 셸**로 표현한다. 반지름이 남은 시간의
 * 단조 함수라 "언제 풀리는지"가 화면에서 읽힌다(깜빡임에는 없는 정보다).
 *
 * ## sim 불가침 (계약 §2-1 · ADR-0005)
 * `src/sim/` 에서 **타입만** 가져온다. 속도·대시·피격은 전부 `prev`/`curr` 스냅샷 델타에서
 * **렌더가 다시 계산**한다(`shipFacing`·`turretAimAngle` 과 같은 패턴). sim 에 필드를 더하면
 * 골든·리플레이가 즉시 깨진다.
 *
 * ## 기체 타입 7종을 왜 공통 규칙으로 다루는가
 * 계약은 타입별 특성(엔진 개수·크기) 반응을 권했지만, **렌더가 기체 타입을 알 방법이 없다**:
 * - {@link EntitySnapshot} 에 `typeId` 가 없다. 넣으려면 `src/sim/snapshot.ts`(공유 파일)를
 *   고쳐야 하고, 그건 이 레인의 소유가 아니다.
 * - `texture.source.label` 은 번들러가 해시한 URL 이거나 인라인 base64 data URI 다
 *   (`assetsInlineLimit` 로 이 리포의 자산 상당수가 실제로 인라인된다) — 기체 슬러그가 남는다는
 *   보장이 없다. 거기에 의존하면 "코드에는 있는데 화면에는 없는" 결함이 된다.
 *
 * 그래서 노즐 배치·불꽃 치수는 전부 **표시 반치수(`sprite.width/2`)의 배율**로 파생한다.
 * 노즐은 중앙 1 + 외현 2 의 3구 구성이라 어느 기체 실루엣에도 어긋나지 않는다. 타입별
 * 반응이 필요하면 스냅샷에 `typeId` 를 싣는 공유 파일 변경이 선행되어야 한다(오케스트레이터 보고 항목).
 *
 * ## 티어·접근성 게이트 (계약 §2-3)
 * `AdornerContext` 는 `EffectGates` 만 주고 원본 설정을 주지 않으므로 두 감소 토글을 게이트에서
 * 되짚는다 — {@link reducedMotion}·{@link reducedGlow} 의 주석이 그 도출의 정본이다.
 */

import { Container, Graphics, Sprite } from 'pixi.js';

import type { EntitySnapshot } from '../../sim/snapshot.js';
import type { EnvLightSpec } from '../env/theme.js';
import { lightX, lightY } from '../env/theme.js';
import type { EffectGates, QualityTier } from '../qualityTier.js';
import { registerAdornerFactory, type AdornerContext, type EntityAdorner } from './adorner.js';

// ---------------------------------------------------------------------------
// 튜닝 상수 — 전부 placeholder(defer-balance-tuning). 픽셀 절대값은 **표시 반치수의 배율**로만
// 쓴다: 기체 표시 크기가 48px 로 고정돼 보이더라도 `displaySize` 는 kind·radius 의 함수라
// 절대값을 박으면 크기가 바뀌는 순간 전부 어긋난다(접지 그림자 헤더의 같은 규율).
// ---------------------------------------------------------------------------

/** sim 틱레이트(Hz). 스냅샷 위치 델타를 초당 속도로 환산하는 데만 쓴다(값 재선언 — sim 무임포트). */
const SIM_HZ = 60;

/**
 * 순항 기준 속도(u/s). sim 기본 `playerSpeed`(720)에 파워업 여유를 얹은 렌더측 기준선이다.
 * 이 값에서 뱅킹·불꽃이 각각 최대치에 닿는다. sim 상수를 import 하지 않는 이유는 계약 §2-1 —
 * 값이 갈라져도 화면 세기만 달라질 뿐 결정론에는 아무 영향이 없다.
 */
const CRUISE_SPEED = 900;

/**
 * 대시 판정 임계(u/s). sim `dashSpeed` 는 2800 u/s 임펄스이고 순항 최고는 파워업을 다 먹어도
 * 1000 을 크게 넘지 않는다 — 그 사이의 넉넉한 골짜기에 임계를 둔다. 렌더 전용 근사라 한두
 * 프레임 오판은 무해하다.
 */
const DASH_SPEED = 1500;

/** 추적 속도 상한(u/s). 리스폰·순간이동이 만드는 위치 점프가 불꽃·잔상을 폭발시키지 않게 막는다. */
const MAX_TRACK_SPEED = 4000;

/** 속도 평활 시간상수(초). 불꽃 길이가 프레임마다 튀지 않게 한다(대시 판정은 평활 전 값을 쓴다). */
const SPEED_TAU = 0.09;

/** 스프링·감쇠 적분의 dt 상한(초). 탭 복귀의 큰 dt 에서 스프링이 발산하는 것을 막는다. */
const MAX_STEP_DT = 0.05;

// ── 1. 뱅킹/롤 ──────────────────────────────────────────────────────────────
/** 최대 롤에서의 추가 회전(라디안, ≈12.6°). 기수 방향은 `shipFacing` 이 정하고 그 위에 얹는다. */
const ROLL_ANGLE = 0.22;
/** 최대 롤에서의 세로(횡폭) 압축률. 롤 축은 기체 **길이 방향**이라 눌리는 것은 로컬 y 다. */
const BANK_SQUASH = 0.18;
/** 롤 스프링 강성. `ω=√k≈11 rad/s` — 방향 전환에 반 박자 늦게 따라붙는 체감. */
const ROLL_STIFFNESS = 120;
/**
 * 롤 스프링 감쇠. 임계감쇠(`2√k≈21.9`)보다 **낮게** 둬 살짝 오버슈트하게 한다 —
 * 계약 §3 "2차 운동"의 실체가 이 오버슈트다(임계감쇠면 그냥 지연된 1차 운동이다).
 */
const ROLL_DAMPING = 16;

// ── 6. 아이들 부유 ──────────────────────────────────────────────────────────
/** 부유 진폭(표시 반치수 배율). 아주 작아야 한다 — 크면 조준선이 흔들려 보인다. */
const BOB_AMPLITUDE = 0.055;
/** 부유 각속도(rad/s). 호흡에 가까운 느린 주기. */
const BOB_RATE = 2.1;
/** 이 속도(u/s) 이상이면 부유가 완전히 꺼진다. 그 아래는 선형으로 살아난다. */
const IDLE_SPEED_CUTOFF = 120;

// ── 4. 피격 반응 ────────────────────────────────────────────────────────────
/** 피격 임펄스 크기(표시 반치수 배율). 기수 반대 방향으로 튄다. */
const HIT_KICK = 0.38;
/** 임펄스 복원 스프링 강성(빠르게 제자리로). */
const HIT_STIFFNESS = 300;
/** 임펄스 복원 감쇠. 임계(`2√300≈34.6`)보다 낮아 한 번 되튄다. */
const HIT_DAMPING = 22;
/** 임펄스의 횡 성분 비율. 매번 같은 방향으로 튀면 기계적으로 보인다(시드는 결정적). */
const HIT_LATERAL = 0.45;

/**
 * 무적 창 길이(초). sim `hitIframes` 40틱 ≈ 0.667s 의 렌더측 근사다. 스냅샷에 `iframes` 가
 * 없으므로(§2-1 — 넣으면 공유 파일 변경) HP 감소 시점에서 렌더가 창을 자체 계산한다.
 */
const SHIELD_WINDOW_S = 40 / SIM_HZ;
/** 실드 셸 시작 반지름(표시 반치수 배율). 선체 **밖**이라 실루엣을 덮지 않는다. */
const SHIELD_R_START = 1.62;
/** 실드 셸 종료 반지름. 선체에 닿기 직전까지 **닫혀 들어온다** = 남은 시간이 읽힌다. */
const SHIELD_R_END = 1.08;
/** 실드 셸 최대 알파. 획뿐이라 이 값이어도 몸통 가독을 해치지 않는다. */
const SHIELD_ALPHA = 0.85;
/** 실드 셸 자전 각속도(rad/s). 깜빡임 대신 **회전**으로 "살아 있는 보호막"을 만든다. */
const SHIELD_SPIN = 2.4;
/** 실드 셸 색 — 아군 시안. 적탄 흰 코어와 헷갈리지 않는다(계약 §2-2). */
const SHIELD_COLOR = 0x39d0ff;
/** 실드 셸 패싯(면) 개수. 육각 이상이면 "에너지 막"으로 읽히고 그 아래면 조준 링으로 오독된다. */
const SHIELD_FACETS = 8;

// ── 2. 엔진 추진 ────────────────────────────────────────────────────────────
/** 정지 시 불꽃 길이 배율(아이들 코어). 0 이 아니어야 "시동이 걸린 기체"로 읽힌다. */
const THRUST_IDLE = 0.34;
/** 순항 속도에서의 불꽃 길이 배율. */
const THRUST_CRUISE = 1;
/** 대시 시 곱해지는 배율. 폭발적 확장 — 대시가 화면에서 사건이 되게 한다. */
const THRUST_DASH_MULT = 2.2;
/** 불꽃 기준 길이(표시 반치수 배율, extent 1.0 기준). */
const THRUST_LENGTH = 1.15;
/** 불꽃 기준 반폭(표시 반치수 배율). */
const THRUST_HALF_WIDTH = 0.3;
/** 노즐이 기체 중심에서 뒤로 물러난 거리(표시 반치수 배율). 선체 뒤끝에 붙인다. */
const NOZZLE_BACK = 0.72;
/** 외현 노즐의 횡 오프셋(표시 반치수 배율). 중앙 1 + 좌우 2 의 3구 공통 배치. */
const NOZZLE_SIDE = 0.34;
/** 외현 노즐의 크기 배율(중앙 대비). */
const NOZZLE_SIDE_SCALE = 0.52;
/** 열기 요동 각속도(rad/s) 2종 — 서로소에 가까운 비율이라 눈에 띄는 반복 주기가 안 생긴다. */
const HEAT_RATE_A = 9.3;
const HEAT_RATE_B = 14.7;
/** 열기 요동 진폭(길이·폭). 정지 시 최대, 대시 시 최소(빠를수록 불꽃이 곧게 뻗는다). */
const HEAT_WOBBLE = 0.14;

/** 불꽃 외곽(가장 넓고 어두운 층) 색·알파 — 아군 시안 계열. */
const FLAME_OUTER = 0x1c7fe0;
const FLAME_OUTER_ALPHA = 0.34;
/** 불꽃 중간층. */
const FLAME_MID = 0x39d0ff;
const FLAME_MID_ALPHA = 0.46;
/**
 * 불꽃 심. **순백이 아니다** — 적탄 흰 코어와 같은 색으로 포화하면 탄막에서 둘이 섞인다
 * (계약 §2-2). 아주 옅은 시안-화이트로 두면 "뜨겁다"는 읽히면서 색 정체는 아군으로 남는다.
 */
const FLAME_CORE = 0xbfefff;
const FLAME_CORE_ALPHA = 0.5;

// ── 0. 실루엣 외곽선 (탄막 속 자기 위치 확보) ───────────────────────────────
/**
 * 변경 전 기준선(`.omc/research/entity-aaa-baseline-2026-07-30.md`)이 잡은 **가장 값비싼 결함**:
 * "보스 컷에서 플레이어를 찾는 데 시간이 걸린다 — 좌하단 적 군집에 시안 조각이 묻혀 있다."
 * 탄막 슈터에서 자기 기체를 못 찾는 것은 미관 문제가 아니라 **조작 불능**이다.
 *
 * 해법으로 밝기를 올리면 안 된다 — 그건 같은 문제의 다른 얼굴이다(계약 §2-2: 이펙트가 본체보다
 * 밝으면 자기 실루엣을 자기 이펙트에 잃는다). 그래서 **면적이 아니라 경계**를 준다: 스프라이트를
 * 조금 키운 가산 복제를 **아래**에 깔아, 선체 밖으로 삐져나온 부분만 얇은 시안 테두리로 남긴다.
 * 추가되는 빛의 총량은 테두리 폭만큼이라 본체보다 밝아질 수 없는데, **실루엣의 형태**가
 * 살아나므로 군집 속에서 한눈에 분리된다(계약 §3 공통원칙 "실루엣 우선").
 *
 * 이미 있는 원형 헤일로와 다른 일을 한다 — 헤일로는 방향도 형태도 없는 둥근 얼룩이고,
 * 이건 기체 **모양 그대로**의 경계다.
 */
const OUTLINE_GROW = 0.16;
/** 외곽선 색 — 아군 시안(계약 §2-2 아군 전용색). */
const OUTLINE_COLOR = 0x39d0ff;
/** 외곽선 알파(가산). 본체보다 확실히 어둡게. */
const OUTLINE_ALPHA = 0.5;
/** 숨쉬기 진폭·각속도. 미세한 변조가 정지 화면에서도 눈을 끈다(깜빡임이 아니라 연속 변조다). */
const OUTLINE_BREATH = 0.16;
const OUTLINE_BREATH_RATE = 3;
/** 발광 감소 시 곱해지는 배율. **0 이 아니다** — 자기 위치 확보는 장식이 아니라 조작 가능성이다. */
const OUTLINE_REDUCED_GLOW = 0.55;

// ── 3. 림라이트 ─────────────────────────────────────────────────────────────
/**
 * 림 색. 테마에는 광원 **방향**(`EnvLightSpec.angle`)만 있고 색이 없다 — 색 필드를 더하려면
 * `env/theme.ts`(공유 파일) 변경이 필요하다(오케스트레이터 보고 항목). 그때까지는 어느
 * 행성에서도 튀지 않는 차가운 화이트를 쓴다.
 */
const RIM_COLOR = 0xcfe6ff;
/** 림 알파(가산). 낮게 — 림은 실루엣을 **세우는** 것이지 본체를 밝히는 것이 아니다. */
const RIM_ALPHA = 0.42;
/** 림 오프셋(표시 반치수 배율). 광원 **쪽**으로 밀어 그 방향 가장자리만 삐져나오게 한다. */
const RIM_OFFSET = 0.14;

// ── 5. 대시 잔상 ────────────────────────────────────────────────────────────
/** 티어별 고스트 개수. low 는 0(계약 §2-3 — low 에서 꺼지거나 현저히 축소). */
const GHOSTS_HIGH = 5;
const GHOSTS_MED = 3;
/** 고스트 갱신 간격(프레임). 매 프레임 찍으면 겹쳐서 한 덩어리가 된다. */
const GHOST_INTERVAL = 2;
/** 고스트 최초 알파. 본체보다 확실히 어두워야 한다(계약 §2-2). */
const GHOST_ALPHA = 0.3;
/** 고스트 감쇠 시간상수(초). */
const GHOST_TAU = 0.11;
/** 고스트 색(가산). 시안 계열이되 어둡게 — 잔상이 본체보다 밝으면 자기 위치를 잃는다. */
const GHOST_TINT = 0x2f8fd0;

// ---------------------------------------------------------------------------
// 순수 함수 — 전부 Pixi 없이 성립한다(테스트가 여기를 직접 잡는다).
// ---------------------------------------------------------------------------

/** [0,1] 클램프. */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * **`reducedMotion` 도출.** `AdornerContext` 는 `GraphicsSettings` 를 주지 않지만 게이트에서
 * 되짚을 수 있다: `effectGates` 표에서 `hitFlash` 는 **전 티어 on** 이고 오직 `reducedMotion`
 * 만 그것을 끈다. 따라서 `hitFlash === false` ⇔ `reducedMotion` 이다(qualityTier.ts 정본).
 */
export function reducedMotion(gates: EffectGates): boolean {
  return !gates.hitFlash;
}

/**
 * **`reducedGlow` 도출(보수적).** `halo` 는 `reducedGlow` 로도 꺼지고 low 티어에서도 꺼진다.
 * 둘을 가를 수는 없지만 **가를 필요가 없다** — 어느 쪽이든 가산 발광을 내려야 하는 상황이다.
 */
export function reducedGlow(gates: EffectGates): boolean {
  return !gates.halo;
}

/**
 * 스냅샷 델타에서 속도를 파생한다(u/s). sim 에 속도 필드를 더하지 않기 위한 유일한 경로다(§2-1).
 *
 * `prev` 는 **직전 sim 스냅샷**이라 sim-step 이 없는 렌더 프레임에서는 같은 델타가 반복된다 —
 * 그게 옳다(속도는 안 변했다). 0 으로 떨어지지 않으므로 불꽃이 프레임마다 깜빡이지 않는다.
 * 리스폰·순간이동의 거대 점프는 {@link MAX_TRACK_SPEED} 로 잘라 불꽃·잔상 폭주를 막는다.
 */
export function snapshotVelocity(e: EntitySnapshot, prev: EntitySnapshot): { vx: number; vy: number } {
  let vx = (e.x - prev.x) * SIM_HZ;
  let vy = (e.y - prev.y) * SIM_HZ;
  const sp = Math.hypot(vx, vy);
  if (sp > MAX_TRACK_SPEED) {
    const k = MAX_TRACK_SPEED / sp;
    vx *= k;
    vy *= k;
  }
  return { vx, vy };
}

/**
 * 기수(`facing`) 기준 **횡 속도 성분**. 화면 좌표계는 +y 가 아래라 기수를 +90° 돌린 우현
 * 단위벡터가 `(-sin, cos)` 이다. 양수 = 우현으로 미끄러지는 중.
 */
export function lateralSpeed(vx: number, vy: number, facing: number): number {
  return vx * -Math.sin(facing) + vy * Math.cos(facing);
}

/** 횡 속도 → 롤 목표치 [-1,1]. 순항 속도에서 최대 롤에 닿는다. */
export function bankTarget(lateral: number): number {
  const t = lateral / CRUISE_SPEED;
  return t < -1 ? -1 : t > 1 ? 1 : t;
}

/** 감쇠 스프링 1스텝(2차 운동). `dt` 는 {@link MAX_STEP_DT} 로 잘라 발산을 막는다. */
export function springStep(
  value: number,
  vel: number,
  target: number,
  stiffness: number,
  damping: number,
  dt: number,
): { value: number; vel: number } {
  const h = dt > MAX_STEP_DT ? MAX_STEP_DT : dt < 0 ? 0 : dt;
  const nextVel = vel + ((target - value) * stiffness - vel * damping) * h;
  return { value: value + nextVel * h, vel: nextVel };
}

/** 불꽃 길이 배율. 정지 아이들 코어 → 순항 연장 → 대시 폭발적 확장. */
export function thrustExtent(speed: number, dashing: boolean): number {
  const base = THRUST_IDLE + (THRUST_CRUISE - THRUST_IDLE) * clamp01(speed / CRUISE_SPEED);
  return dashing ? base * THRUST_DASH_MULT : base;
}

/** 부유 강도 [0,1]. 정지에서 1, {@link IDLE_SPEED_CUTOFF} 이상에서 0. */
export function idleness(speed: number): number {
  return 1 - clamp01(speed / IDLE_SPEED_CUTOFF);
}

/** 실드 셸 한 프레임의 상태(없으면 `null` = 무적 창 밖). */
export interface ShieldShellState {
  /** 표시 반치수 배율 반지름. 창이 흐를수록 **단조 감소**한다 = 남은 시간이 읽힌다. */
  readonly radius: number;
  /** 알파(0..1). 끝으로 갈수록 옅어져 툭 끊기지 않는다. */
  readonly alpha: number;
}

/**
 * 피격 후 경과 시간 → 실드 셸 상태. **깜빡임이 아니다** — 반지름이 시간의 단조 감소 함수라
 * 화면만 보고 무적이 얼마나 남았는지 읽을 수 있다(계약 §3 레인 A ④ "읽히는 표현").
 */
export function shieldShell(elapsed: number): ShieldShellState | null {
  if (!(elapsed >= 0) || elapsed >= SHIELD_WINDOW_S) return null;
  const t = elapsed / SHIELD_WINDOW_S;
  return {
    radius: SHIELD_R_START + (SHIELD_R_END - SHIELD_R_START) * t,
    alpha: SHIELD_ALPHA * (1 - t * t),
  };
}

/**
 * 실드 셸의 티어 등급. **완전히 끄지는 않는다** — 이건 장식이 아니라 "지금 맞아도 안 아프다"는
 * 전투 정보이고, 계약 §2-2 는 가독성을 예쁨보다 위에 둔다. 대신 비용이 드는 축(자전·맥동)을
 * 티어·모션 감소로 내리고, 발광 감소에서는 알파를 낮춘다.
 */
export function shieldGate(gates: EffectGates, tier: QualityTier): 'plain' | 'full' {
  return tier === 'low' || reducedMotion(gates) ? 'plain' : 'full';
}

/** 티어별 대시 고스트 개수. `trails` 게이트가 꺼졌거나 모션 감소면 0. */
export function ghostBudget(gates: EffectGates, tier: QualityTier): number {
  if (!gates.trails || reducedMotion(gates)) return 0;
  return tier === 'high' ? GHOSTS_HIGH : tier === 'med' ? GHOSTS_MED : 0;
}

/**
 * 림라이트 오프셋(px). 광원 **쪽**이다 — 접지 그림자({@link file://../groundShadow.ts})가
 * `-light` 로 가는 것과 정확히 반대 부호이며, 그래서 둘이 같은 태양을 증언한다.
 */
export function rimOffset(light: EnvLightSpec, halfSpan: number): { dx: number; dy: number } {
  const mag = halfSpan * RIM_OFFSET;
  return { dx: lightX(light) * mag, dy: lightY(light) * mag };
}

/**
 * 피격 임펄스 방향(단위벡터). 피해원(源)은 스냅샷에 없다 — 있으려면 sim 표면을 넓혀야 한다(§2-1).
 * 그래서 **기수 반대**(정면에서 맞았다는 근사)에 결정적 시드로 뽑은 횡 성분을 섞는다. 기체는
 * 자동 조준으로 늘 위협을 바라보므로 이 근사는 대개 실제 피해 방향과 일치하고, 어긋나도
 * "충격을 받아 밀렸다"는 읽기는 유지된다.
 */
export function hitImpulseDir(facing: number, seed: number): { dx: number; dy: number } {
  // 결정적 해시 → [-1,1]. Math.random 금지(재현 가능 계약).
  const h = (Math.imul(seed | 0, 2654435761) >>> 0) / 4294967296;
  const lat = (h * 2 - 1) * HIT_LATERAL;
  const bx = -Math.cos(facing);
  const by = -Math.sin(facing);
  const rx = -Math.sin(facing) * lat;
  const ry = Math.cos(facing) * lat;
  const dx = bx + rx;
  const dy = by + ry;
  const len = Math.hypot(dx, dy) || 1;
  return { dx: dx / len, dy: dy / len };
}

// ---------------------------------------------------------------------------
// 공유 운동 상태 — 두 장식자가 같은 프레임에 속도를 두 번 재계산하지 않게 한다.
// ---------------------------------------------------------------------------

/**
 * 한 프레임의 플레이어 운동 파생값. 두 장식자가 공유하되, **호출 순서에 의존하지 않는다** —
 * `frameTick` 가드로 그 프레임의 첫 호출자가 계산하고 나머지는 읽기만 한다(등록 순서가
 * 바뀌어도 값이 같다).
 */
class PlayerMotion {
  /** 평활 속력(u/s) — 불꽃 길이용. */
  speed = 0;
  /** 평활 전 속력(u/s) — 대시 판정용(평활하면 임펄스 첨두가 뭉개진다). */
  rawSpeed = 0;
  /** 이번 프레임 대시 중인가. */
  dashing = false;
  /** 기수 기준 횡 속도(u/s). */
  lateral = 0;
  private tick = -1;

  update(e: EntitySnapshot, prev: EntitySnapshot, facing: number, ctx: AdornerContext): void {
    if (this.tick === ctx.frameTick) return;
    this.tick = ctx.frameTick;
    const { vx, vy } = snapshotVelocity(e, prev);
    this.rawSpeed = Math.hypot(vx, vy);
    this.dashing = this.rawSpeed >= DASH_SPEED;
    this.lateral = lateralSpeed(vx, vy, facing);
    // 지수 평활(프레임률 무관). dt 가 크면 즉시 수렴하고 작으면 천천히 따라간다.
    const k = 1 - Math.exp(-(ctx.dt > MAX_STEP_DT ? MAX_STEP_DT : ctx.dt) / SPEED_TAU);
    this.speed += (this.rawSpeed - this.speed) * k;
  }
}

// ---------------------------------------------------------------------------
// 1·3·4·6 — 본체 장식자
// ---------------------------------------------------------------------------

/**
 * 기체 **본체**의 2차 운동과 상태 표현: 뱅킹/롤 · 아이들 부유 · 피격 임펄스 · 무적 실드 셸 ·
 * 림라이트.
 *
 * 변환(위치·회전·스케일)은 렌더러가 매 프레임 먼저 확정하고 그 **뒤에** `onFrame` 이 불린다
 * (entityRenderer 엔티티 루프 주석이 정본). 그래서 여기서는 값을 **누적하지 않고** 매 프레임
 * 기준값 위에 다시 얹는다 — 누적하면 몇 초 만에 기체가 화면 밖으로 나간다.
 */
class PlayerBodyAdorner implements EntityAdorner {
  readonly name = 'playerBody';

  private readonly motion: PlayerMotion;
  private sprite: Sprite | null = null;
  /** 생성 시점의 스케일(setSize 결과). 압축은 항상 이 기준에 곱한다. */
  private baseScaleX = 1;
  private baseScaleY = 1;
  /** 표시 반치수(px). 모든 배율 상수의 기준 길이. */
  private halfSpan = 1;

  private roll = 0;
  private rollVel = 0;
  private bobPhase = 0;
  private clock = 0;

  private kickX = 0;
  private kickY = 0;
  private kickVX = 0;
  private kickVY = 0;
  /** 직전 프레임의 HP. `prev.hp` 가 아니라 **자체 추적**이다 — 이유는 {@link onFrame} 주석. */
  private hp = 0;
  /** 무적 창 시작 이후 경과(초). 창 밖이면 `SHIELD_WINDOW_S` 이상. */
  private sinceHit = Number.POSITIVE_INFINITY;

  private shield: Container | null = null;
  private rim: Sprite | null = null;
  private outline: Sprite | null = null;

  constructor(motion: PlayerMotion) {
    this.motion = motion;
  }

  onAttach(sprite: Sprite, e: EntitySnapshot): void {
    this.sprite = sprite;
    this.baseScaleX = sprite.scale.x;
    this.baseScaleY = sprite.scale.y;
    this.halfSpan = Math.max(sprite.width, sprite.height) / 2 || 1;
    this.hp = e.hp;
  }

  onFrame(sprite: Sprite, e: EntitySnapshot, prev: EntitySnapshot, ctx: AdornerContext): void {
    const dt = ctx.dt > MAX_STEP_DT ? MAX_STEP_DT : ctx.dt;
    this.clock += dt;
    // 렌더러가 이미 얹은 기수 각도. 롤은 이 위에 더한다(기수 결정은 shipFacing 의 몫).
    const facing = sprite.rotation;
    this.motion.update(e, prev, facing, ctx);

    // ── 4. 피격 감지 ────────────────────────────────────────────────────────
    // **`prev.hp` 가 아니라 자체 추적 HP 로** 판정한다. render 는 sim(60Hz)과 분리돼 매 rAF
    // 프레임 불리는데, sim-step 없는 프레임엔 prev/curr 가 그대로여서 `prev.hp > e.hp` 가
    // 같은 피해를 프레임마다 재발화한다(entityRenderer 의 데미지 숫자가 같은 함정을 밟았다 —
    // 리뷰 HIGH-1). 자체 추적은 직전 프레임에 이미 내려가 있어 재발화가 구조적으로 막힌다.
    if (this.hp > e.hp) {
      this.sinceHit = 0;
      const dir = hitImpulseDir(facing, e.id + Math.round(e.hp));
      const mag = this.halfSpan * HIT_KICK;
      this.kickX = dir.dx * mag;
      this.kickY = dir.dy * mag;
      this.kickVX = 0;
      this.kickVY = 0;
    }
    this.hp = e.hp;
    if (this.sinceHit < SHIELD_WINDOW_S) this.sinceHit += dt;

    const motionOn = !reducedMotion(ctx.gates);

    // ── 1. 뱅킹/롤 (감쇠 스프링 = 2차 운동) ────────────────────────────────
    const target = motionOn ? bankTarget(this.motion.lateral) : 0;
    const st = springStep(this.roll, this.rollVel, target, ROLL_STIFFNESS, ROLL_DAMPING, dt);
    this.roll = st.value;
    this.rollVel = st.vel;
    sprite.rotation = facing + this.roll * ROLL_ANGLE;
    // 롤 축은 기체 **길이 방향**이라 눌리는 것은 로컬 y(횡폭)다. 기준 스케일에 곱한다(누적 금지).
    sprite.scale.set(this.baseScaleX, this.baseScaleY * (1 - Math.abs(this.roll) * BANK_SQUASH));

    // ── 6. 아이들 부유 + 4. 피격 임펄스 감쇠 ───────────────────────────────
    let ox = 0;
    let oy = 0;
    if (motionOn) {
      this.bobPhase += dt * BOB_RATE;
      oy += Math.sin(this.bobPhase) * this.halfSpan * BOB_AMPLITUDE * idleness(this.motion.speed);
      const kx = springStep(this.kickX, this.kickVX, 0, HIT_STIFFNESS, HIT_DAMPING, dt);
      const ky = springStep(this.kickY, this.kickVY, 0, HIT_STIFFNESS, HIT_DAMPING, dt);
      this.kickX = kx.value;
      this.kickVX = kx.vel;
      this.kickY = ky.value;
      this.kickVY = ky.vel;
      ox += this.kickX;
      oy += this.kickY;
    } else {
      this.kickX = 0;
      this.kickY = 0;
      this.kickVX = 0;
      this.kickVY = 0;
    }
    sprite.position.set(sprite.x + ox, sprite.y + oy);

    // ── 0. 실루엣 외곽선 ────────────────────────────────────────────────────
    // 티어·테마와 무관하게 **항상** 있다(상수 주석이 근거). 발광 감소에서는 알파만 낮춘다.
    let outline = this.outline;
    if (outline === null) {
      outline = new Sprite(sprite.texture);
      outline.label = 'playerOutline';
      outline.anchor.set(0.5);
      outline.blendMode = 'add';
      outline.tint = OUTLINE_COLOR;
      ctx.belowLayer.addChild(outline);
      this.outline = outline;
    }
    if (outline.texture !== sprite.texture) outline.texture = sprite.texture;
    outline.position.set(sprite.x, sprite.y);
    outline.rotation = sprite.rotation;
    // 스프라이트 스케일에 성장분을 곱한다 — 뱅킹 압축까지 따라가야 테두리가 실루엣에 붙는다.
    outline.scale.set(sprite.scale.x * (1 + OUTLINE_GROW), sprite.scale.y * (1 + OUTLINE_GROW));
    const breath = motionOn ? 1 + Math.sin(this.clock * OUTLINE_BREATH_RATE) * OUTLINE_BREATH : 1;
    outline.alpha = OUTLINE_ALPHA * breath * (reducedGlow(ctx.gates) ? OUTLINE_REDUCED_GLOW : 1);

    // ── 3. 림라이트 ─────────────────────────────────────────────────────────
    // 테마가 없으면(=담당 배경이 없는 행성) 광원이 없는 것이므로 스스로 꺼진다(계약 §3 광원 일관성).
    if (ctx.theme !== null && !reducedGlow(ctx.gates)) {
      let rim = this.rim;
      if (rim === null) {
        rim = new Sprite(sprite.texture);
        rim.label = 'playerRim';
        rim.anchor.set(0.5);
        rim.blendMode = 'add';
        rim.tint = RIM_COLOR;
        rim.alpha = RIM_ALPHA;
        // 아래 레이어 — 광원 쪽으로 밀린 가산 복제가 **실루엣 밖으로만** 삐져나와 초승달
        // 하이라이트가 된다. 위에 두면 본체를 통째로 밝혀 실루엣이 흐려진다.
        ctx.belowLayer.addChild(rim);
        this.rim = rim;
      }
      if (rim.texture !== sprite.texture) rim.texture = sprite.texture;
      const off = rimOffset(ctx.theme.light, this.halfSpan);
      rim.position.set(sprite.x + off.dx, sprite.y + off.dy);
      rim.rotation = sprite.rotation;
      rim.scale.set(sprite.scale.x, sprite.scale.y);
    } else if (this.rim !== null) {
      this.destroyRim();
    }

    // ── 4. 무적 실드 셸 (깜빡임 금지) ───────────────────────────────────────
    const shell = shieldShell(this.sinceHit);
    if (shell === null) {
      if (this.shield !== null) this.destroyShield();
    } else {
      let shield = this.shield;
      if (shield === null) {
        shield = buildShieldShell();
        ctx.aboveLayer.addChild(shield);
        this.shield = shield;
      }
      const full = shieldGate(ctx.gates, ctx.tier) === 'full';
      shield.position.set(sprite.x, sprite.y);
      shield.scale.set(shell.radius * this.halfSpan);
      // 자전은 "살아 있는 막"의 신호다. 모션 감소·low 티어에서는 정지시킨다(정보는 반지름이 진다).
      shield.rotation = full ? this.clock * SHIELD_SPIN : 0;
      // 발광 감소에서는 알파를 낮추되 0 으로 만들지 않는다 — 무적 여부는 전투 정보다.
      shield.alpha = shell.alpha * (reducedGlow(ctx.gates) ? 0.55 : 1);
    }
  }

  dispose(): void {
    this.destroyRim();
    this.destroyShield();
    this.destroyOutline();
    // 스프라이트가 살아 있는 경로(리셋 등)에서는 기준 스케일을 되돌린다 — 압축된 채로 남으면
    // 다음 런에서 눌린 기체로 시작한다.
    const s = this.sprite;
    if (s !== null && !s.destroyed) s.scale.set(this.baseScaleX, this.baseScaleY);
    this.sprite = null;
  }

  /** 형제 컨테이너는 부모 `destroy` 로 회수되지 않는다 — 여기서 떼고 파괴한다(계약 §2-3). */
  private destroyRim(): void {
    const rim = this.rim;
    if (rim === null) return;
    this.rim = null;
    rim.parent?.removeChild(rim);
    if (!rim.destroyed) rim.destroy();
  }

  private destroyOutline(): void {
    const outline = this.outline;
    if (outline === null) return;
    this.outline = null;
    outline.parent?.removeChild(outline);
    if (!outline.destroyed) outline.destroy();
  }

  private destroyShield(): void {
    const shield = this.shield;
    if (shield === null) return;
    this.shield = null;
    shield.parent?.removeChild(shield);
    if (!shield.destroyed) shield.destroy({ children: true });
  }
}

/**
 * 실드 셸을 **단위 반지름 1** 로 굽는다. 이후엔 컨테이너 스케일만 바꾼다 — 매 프레임
 * `Graphics` 를 다시 그리면 프레임 예산에서 가장 비싼 축을 매 프레임 태우게 된다
 * (`buildGroundShadow` 와 같은 규율).
 *
 * 채움이 없고 **획뿐**이라 선체를 한 픽셀도 가리지 않는다.
 */
function buildShieldShell(): Container {
  const c = new Container();
  c.label = 'playerShield';
  c.blendMode = 'add';
  const g = new Graphics();
  // 바깥 실선 링 + 안쪽 얇은 링(이중 링이 "막"으로 읽히게 한다).
  g.circle(0, 0, 1).stroke({ color: SHIELD_COLOR, width: 0.055, alpha: 0.8 });
  g.circle(0, 0, 0.9).stroke({ color: SHIELD_COLOR, width: 0.025, alpha: 0.45 });
  // 패싯 — 링 위의 짧은 방사 눈금. 색 외 채널로 "에너지 막"을 구분하게 한다(색약 대응 규율).
  for (let i = 0; i < SHIELD_FACETS; i++) {
    const a = (i / SHIELD_FACETS) * Math.PI * 2;
    const cx = Math.cos(a);
    const sy = Math.sin(a);
    g.moveTo(cx * 0.9, sy * 0.9)
      .lineTo(cx * 1.08, sy * 1.08)
      .stroke({ color: SHIELD_COLOR, width: 0.05, alpha: 0.7 });
  }
  c.addChild(g);
  return c;
}

// ---------------------------------------------------------------------------
// 2·5 — 추진 장식자
// ---------------------------------------------------------------------------

/**
 * 엔진 추진 불꽃과 대시 잔상. 둘 다 **belowLayer(가산)** 이고 기수 **반대편**에 있어 본체
 * 실루엣을 침범하지 않는다.
 *
 * 본체 장식자가 위치·회전을 확정한 뒤에 도는 것이 이상적이라 팩토리가 그 순서로 돌려주지만,
 * 순서가 뒤집혀도 한 프레임 지연일 뿐 결함이 아니다(값은 다음 프레임에 따라잡는다).
 */
class PlayerThrustAdorner implements EntityAdorner {
  readonly name = 'playerThrust';

  private readonly motion: PlayerMotion;
  private halfSpan = 1;
  private clock = 0;

  private flame: Container | null = null;
  private readonly ghosts: Sprite[] = [];
  private ghostAlpha: number[] = [];
  private ghostCursor = 0;
  private lastGhostTick = -1000;

  constructor(motion: PlayerMotion) {
    this.motion = motion;
  }

  onAttach(sprite: Sprite): void {
    this.halfSpan = Math.max(sprite.width, sprite.height) / 2 || 1;
  }

  onFrame(sprite: Sprite, e: EntitySnapshot, prev: EntitySnapshot, ctx: AdornerContext): void {
    const dt = ctx.dt > MAX_STEP_DT ? MAX_STEP_DT : ctx.dt;
    this.clock += dt;
    this.motion.update(e, prev, sprite.rotation, ctx);

    this.syncFlame(sprite, ctx);
    this.syncGhosts(sprite, ctx, dt);
  }

  /** ── 2. 엔진 추진 ── 속도 반응형 불꽃. 발광축이라 `halo` 게이트 뒤에 둔다. */
  private syncFlame(sprite: Sprite, ctx: AdornerContext): void {
    if (reducedGlow(ctx.gates)) {
      if (this.flame !== null) this.destroyFlame();
      return;
    }
    let flame = this.flame;
    if (flame === null) {
      flame = buildThrustFlame();
      ctx.belowLayer.addChild(flame);
      this.flame = flame;
    }
    const f = sprite.rotation;
    // 노즐은 기수 **반대편**. 여기가 본체 실루엣을 침범하지 않는 유일한 자리다.
    flame.position.set(
      sprite.x - Math.cos(f) * this.halfSpan * NOZZLE_BACK,
      sprite.y - Math.sin(f) * this.halfSpan * NOZZLE_BACK,
    );
    flame.rotation = f;
    const extent = thrustExtent(this.motion.speed, this.motion.dashing);
    // ── 6(부수). 엔진 열기 요동 ── 정지 시 최대, 대시 시 최소. 서로 다른 두 각속도의 합이라
    // 눈에 띄는 반복 주기가 생기지 않는다. 결정적(Math.random 없음).
    const heat =
      HEAT_WOBBLE * (0.35 + 0.65 * idleness(this.motion.speed)) * (this.motion.dashing ? 0.3 : 1);
    const wobbleL = 1 + Math.sin(this.clock * HEAT_RATE_A) * heat;
    const wobbleW = 1 + Math.sin(this.clock * HEAT_RATE_B + 1.7) * heat;
    flame.scale.set(this.halfSpan * extent * wobbleL, this.halfSpan * wobbleW);
  }

  /** ── 5. 대시 잔상 ── 위치 이력 기반 감쇠 고스트. 티어 예산 안에서만. */
  private syncGhosts(sprite: Sprite, ctx: AdornerContext, dt: number): void {
    const budget = ghostBudget(ctx.gates, ctx.tier);
    if (budget === 0) {
      if (this.ghosts.length > 0) this.destroyGhosts();
      return;
    }
    if (this.ghosts.length > budget) this.destroyGhosts(); // 티어 강등 — 예산 초과분을 통째로 회수.

    if (this.motion.dashing && ctx.frameTick - this.lastGhostTick >= GHOST_INTERVAL) {
      this.lastGhostTick = ctx.frameTick;
      let g = this.ghosts[this.ghostCursor];
      if (g === undefined) {
        g = new Sprite(sprite.texture);
        g.label = 'playerGhost';
        g.anchor.set(0.5);
        g.blendMode = 'add';
        g.tint = GHOST_TINT;
        ctx.belowLayer.addChild(g);
        this.ghosts[this.ghostCursor] = g;
        this.ghostAlpha[this.ghostCursor] = 0;
      }
      if (g.texture !== sprite.texture) g.texture = sprite.texture;
      g.position.set(sprite.x, sprite.y);
      g.rotation = sprite.rotation;
      g.scale.set(sprite.scale.x, sprite.scale.y);
      this.ghostAlpha[this.ghostCursor] = GHOST_ALPHA;
      this.ghostCursor = (this.ghostCursor + 1) % budget;
    }

    // 감쇠(프레임률 무관). 다 꺼진 고스트는 alpha 0 으로 남겨 둔다 — 대시가 반복되므로 매번
    // 생성·파괴하면 GC 를 태운다(BulletTrail 풀링과 같은 규율).
    const decay = Math.exp(-dt / GHOST_TAU);
    for (let i = 0; i < this.ghosts.length; i++) {
      const g = this.ghosts[i];
      if (g === undefined) continue;
      const a = (this.ghostAlpha[i] ?? 0) * decay;
      this.ghostAlpha[i] = a < 0.004 ? 0 : a;
      g.alpha = this.ghostAlpha[i] ?? 0;
      g.visible = g.alpha > 0;
    }
  }

  dispose(): void {
    this.destroyFlame();
    this.destroyGhosts();
  }

  private destroyFlame(): void {
    const flame = this.flame;
    if (flame === null) return;
    this.flame = null;
    flame.parent?.removeChild(flame);
    if (!flame.destroyed) flame.destroy({ children: true });
  }

  private destroyGhosts(): void {
    for (const g of this.ghosts) {
      g.parent?.removeChild(g);
      if (!g.destroyed) g.destroy();
    }
    this.ghosts.length = 0;
    this.ghostAlpha = [];
    this.ghostCursor = 0;
  }
}

/**
 * 엔진 불꽃을 **단위 치수**(길이·반폭 1)로 굽는다 — 이후엔 컨테이너 스케일만 바꾼다
 * (매 프레임 `Graphics` 재빌드 금지, 실드 셸과 같은 규율).
 *
 * 기하는 로컬 **-x** 방향으로 뻗는 삼각 화염 3층(외곽→중간→심)이고, 컨테이너 회전이
 * 기수를 따르므로 언제나 기체 뒤로 뻗는다. 노즐은 중앙 1 + 외현 2 의 공통 3구 배치다
 * (기체 타입 7종을 가를 수 없는 이유는 파일 헤더 참조).
 *
 * `generateTexture`(GL 필요) 없이 절차적 `Graphics` 만 쓴다 — node 테스트에서도 자식이 실제로 생긴다.
 */
function buildThrustFlame(): Container {
  const c = new Container();
  c.label = 'playerThrust';
  // 가산 — 불꽃은 자체 발광체다(계약 §3 레인 A ②: "광원과 무관한 자체 발광체").
  c.blendMode = 'add';
  const nozzle = (sx: number, sy: number, scale: number): void => {
    const g = new Graphics();
    const L = THRUST_LENGTH * scale;
    const W = THRUST_HALF_WIDTH * scale;
    const layer = (len: number, half: number, color: number, alpha: number): void => {
      // 로컬 -x 로 뻗는 삼각 화염. 뒤끝을 살짝 +x 로 물려(0.12) 노즐 입구가 선체에 붙어 보인다.
      g.poly([len * 0.12, -half, -len, 0, len * 0.12, half]).fill({ color, alpha });
    };
    layer(L, W, FLAME_OUTER, FLAME_OUTER_ALPHA);
    layer(L * 0.72, W * 0.62, FLAME_MID, FLAME_MID_ALPHA);
    layer(L * 0.4, W * 0.3, FLAME_CORE, FLAME_CORE_ALPHA);
    g.position.set(sx, sy);
    c.addChild(g);
  };
  nozzle(0, 0, 1);
  nozzle(0, -NOZZLE_SIDE, NOZZLE_SIDE_SCALE);
  nozzle(0, NOZZLE_SIDE, NOZZLE_SIDE_SCALE);
  return c;
}

// ---------------------------------------------------------------------------
// 등록
// ---------------------------------------------------------------------------

/**
 * 플레이어 장식자 팩토리. 본체 → 추진 순서로 돌려준다(본체가 확정한 변환을 추진이 읽는다).
 * 두 장식자는 {@link PlayerMotion} 인스턴스를 **엔티티 단위로** 공유한다.
 */
export function playerAdorners(): EntityAdorner[] {
  const motion = new PlayerMotion();
  return [new PlayerBodyAdorner(motion), new PlayerThrustAdorner(motion)];
}

// 모듈 최상위 부수효과 등록(심 계약). 이 모듈을 import 하는 프로덕션 지점이 있어야 등록이
// 일어난다 — 배선 허브는 오케스트레이터가 3레인 산출물을 합칠 때 한 번에 넣는다.
registerAdornerFactory('player', playerAdorners);
