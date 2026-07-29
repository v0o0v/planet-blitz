/**
 * 적 기체 **자세 추론**(posture inference) — 순수 모듈. Pixi 를 import 하지 않는다.
 *
 * ## 왜 추론인가
 * 탄막 슈터에서 **예고 없는 공격은 불공정하게 느껴진다.** 그런데 sim 은 "지금 조준 중"·"지금
 * 돌진 커밋" 같은 상태를 스냅샷에 싣지 않고, 싣게 만들면 `hashWorld` 계약이 깨진다(계약 §2-1).
 * 그래서 `shipFacing`·`turretAimAngle` 이 이미 쓰는 패턴을 그대로 따른다 — **렌더가 sim 과 같은
 * 규칙으로 다시 구한다.**
 *
 * ## 무엇이 관측 가능한가 (이 모듈의 근거)
 * 스냅샷 두 장(`prev`, `e`)에서 얻을 수 있는 것은 **위치 델타**와 **`angle`** 뿐이다. 여기에
 * `data/enemies.ts` 의 `movement` 종류(leaf 데이터, 4종)를 결합하면 sim 의 조종 함수를 되짚을 수
 * 있다. `src/sim/patterns/index.ts` 의 실제 코드가 근거다:
 *
 * | movement | sim 이 하는 일 | 관측 가능한 서명 | 추론 자세 |
 * |---|---|---|---|
 * | `standoff` | 선호 거리 380±40 밖이면 접근/후퇴, **안이면 수직 스트레이프**. `angle = 플레이어 방향`(항상) | 속도 방향이 `angle` 과 **직교** | {@link POSTURE_FIRING_BAND} |
 * | `standoff` | 위와 같음 | 속도 방향이 `angle` 과 평행/역평행 | {@link POSTURE_CLOSING} |
 * | `chargeStraight` | 스폰 시 조준 후 **직진**. 벽에 슬라이드하거나 지나치면 **재조준**. `angle = 진행 방향` | `angle` 이 한 틱에 크게 꺾임 | {@link POSTURE_RELOCK} |
 * | `chargeStraight` | 위와 같음 | 관측 순항 속도 근처로 직진 유지 | {@link POSTURE_COMMIT} |
 * | `seekWounded` | 부상 아군 120u 앞까지 접근 후 **정지**하고 힐빔 | 이동량 ≈ 0 | {@link POSTURE_TENDING} |
 * | `stationary` | 속도 0 고정 | 항상 정지 | {@link POSTURE_ROOTED} |
 *
 * ## 무엇을 **주장하지 않는가** (과장 금지)
 * - `stationary`(용암샘류)의 발사 시점은 **관측 불가능하다.** windup·fireCooldown 은 순수 타이머라
 *   위치에도 각도에도 흔적을 남기지 않는다. 그래서 이 모듈은 그 종에 대해 "충전 중" 을 만들지
 *   **않는다** — 거짓 예고는 예고 없음보다 나쁘다. 화면에서는 상시 "가동 중인 고정 포대" 로만 읽힌다.
 * - `standoff` 의 {@link POSTURE_FIRING_BAND} 는 "이번 틱에 쏜다" 가 아니라 **"사격 대역에 들어와
 *   있다 = 쿨다운이 도는 대로 포격이 온다"** 는 뜻이다. 실제 착탄 지점은 sim 이 이미 해저드
 *   예고원으로 그려 주므로, 이 자세는 "**누가**" 를 채우고 해저드가 "**어디**" 를 채운다.
 *
 * ## 결정론(ADR-0005)
 * 전부 render-only 파생이다. `src/sim/` 은 **타입 전용 import** 만 하고 해시에 기여하지 않는다.
 * 상태({@link PostureState})는 렌더 프레임 사이에만 살고 리플레이에 실리지 않는다.
 */

import type { EntitySnapshot } from '../../sim/snapshot.js';

// ---------------------------------------------------------------------------
// 위협도 계층 (항목 1)
// ---------------------------------------------------------------------------

/** 잡몹. 화면에 20~40 마리가 동시에 있는 기본 등급 — 개체당 장식은 가장 싸야 한다. */
export const THREAT_GRUNT = 0;
/** 엘리트(`elite >= 0`). 접두사 하나를 달고 스탯이 오른 변종. */
export const THREAT_ELITE = 1;
/** 보스(`boss` · `defenseBoss`). 런에 한둘뿐이라 예산을 넉넉히 쓴다. */
export const THREAT_BOSS = 2;

/** {@link THREAT_GRUNT} · {@link THREAT_ELITE} · {@link THREAT_BOSS} 중 하나. */
export type ThreatTier = 0 | 1 | 2;

/** 보스 등급으로 취급하는 kind 목록. `defenseBoss` 는 PvE `boss` 와 별 kind 지만 위협도는 같다. */
const BOSS_KINDS: ReadonlySet<string> = new Set<string>(['boss', 'defenseBoss']);

/**
 * 위협도 등급을 정한다. **kind 가 등급을 이기고**(보스는 elite 값과 무관하게 보스), 그다음이
 * 엘리트 표식이다.
 *
 * @param kind  엔티티 kind(문자열 — render-only 디커플).
 * @param elite `EntitySnapshot.elite`(엘리트면 0..7, 아니면 -1).
 */
export function threatTier(kind: string, elite: number): ThreatTier {
  if (BOSS_KINDS.has(kind)) return THREAT_BOSS;
  return elite >= 0 ? THREAT_ELITE : THREAT_GRUNT;
}

// ---------------------------------------------------------------------------
// 엘리트 접두사 색 (항목 1) — **시안 금지 계약**(§2-2)
// ---------------------------------------------------------------------------

/**
 * 엘리트 접두사 8종의 오라 색. `src/sim/elite.ts` 의 `ELITE_*` 코드 순서다
 * (분열/가속/자기장/완강/재생/보호막/폭발성/광폭).
 *
 * ⚠️ **시안(`#39d0ff`, 색상각 ≈195°)은 아군 전용**이다(§2-2). 여기 여덟 색은 전부 색상각
 * **[170°,215°] 밖**이며 그 사실을 테스트가 수치로 못 박는다 — 사람이 눈으로 "파랗지 않네" 하고
 * 넘기면 다음 사람이 하늘색 하나를 끼워 넣는다.
 */
const ELITE_ACCENTS: readonly number[] = [
  0xff7a2e, // 0 분열하는 — 주황
  0xffd23f, // 1 가속하는 — 노랑
  0xb85cff, // 2 자기장 — 보라
  0x8bff5c, // 3 완강한 — 연두
  0x3fff8f, // 4 재생하는 — 초록
  0xff5cd0, // 5 보호막의 — 마젠타
  0xff3b30, // 6 폭발성의 — 적색
  0xff2e7a, // 7 광폭한 — 진분홍
];

/** 보스 오라 색(웜 오렌지). 엘리트 팔레트 어느 것과도 겹치지 않아 보스가 따로 읽힌다. */
export const BOSS_ACCENT = 0xff5a2a;

/**
 * 잡몹 림 색(웜 화이트). **적을 어둡게 만들지 않는다** — 몸통 바깥에 얹는 밝은 테두리라
 * 위장률 게이트(적 몸통색 ↔ 배경 상위색 근접도)를 오히려 **완화**한다. 니플헤임의 여유가
 * ΔRGB 35 로 가장 얇아서, 여기서 어두운 외곽선을 골랐다면 그 행성에서 적이 배경에 잠긴다.
 */
export const GRUNT_RIM = 0xffe6c8;

/**
 * 엘리트 접두사 색. 범위 밖 코드는 첫 색으로 접는다(신규 접두사가 추가돼도 화면이 깨지지 않는다).
 */
export function eliteAccent(affix: number): number {
  return ELITE_ACCENTS[affix] ?? ELITE_ACCENTS[0] ?? GRUNT_RIM;
}

/** 접두사 팔레트 크기(테스트가 `ELITE_AFFIX_COUNT` 와 대조한다). */
export const ELITE_ACCENT_COUNT = ELITE_ACCENTS.length;

/**
 * 위협도 등급의 강조색. 잡몹은 림, 엘리트는 접두사색, 보스는 {@link BOSS_ACCENT}.
 */
export function threatAccent(tier: ThreatTier, affix: number): number {
  if (tier === THREAT_BOSS) return BOSS_ACCENT;
  return tier === THREAT_ELITE ? eliteAccent(affix) : GRUNT_RIM;
}

// ---------------------------------------------------------------------------
// 손상 단계 (항목 2)
// ---------------------------------------------------------------------------

/** 무손상. 장식 없음(잡몹 20~40 마리의 기본 상태라 여기가 가장 싸야 한다). */
export const DMG_OK = 0;
/** 경손상 — 불티. */
export const DMG_SPARK = 1;
/** 중손상 — 불티 + 연기(몸통 **뒤**로만 흘린다 — 실루엣을 덮으면 위장률 게이트가 빨개진다). */
export const DMG_SMOKE = 2;
/** 대파 — 화염. */
export const DMG_FIRE = 3;
/** 치명 — 코어 과부하 점멸. "한 대만 더" 가 읽힌다. */
export const DMG_CRITICAL = 4;

/** 손상 단계 경계(HP 비율). 내림차순이며 각 원소는 그 단계로 **떨어지는** 상한이다. */
const DMG_THRESHOLDS: readonly number[] = [0.66, 0.4, 0.2, 0.1];

/**
 * HP 비율 → 손상 단계. `maxHp` 가 0 이하면(설비·기물 등 비전투체 방어) {@link DMG_OK}.
 *
 * 왜 스냅샷의 `maxHp` 를 쓰는가: 이미 실려 있다(`EntitySnapshot.maxHp`). "렌더가 관측한 최댓값을
 * 기억" 하는 우회는 **엘리트 재생 접두사**(매 틱 회복)와 **완강한**(스폰 시 최대 HP 상향)에서
 * 곧바로 어긋난다 — 관측 최댓값은 스폰 직후에 미달이고, 회복하면 과거 최댓값에 갇힌다.
 */
export function damageStage(hp: number, maxHp: number): number {
  if (!(maxHp > 0)) return DMG_OK;
  const ratio = hp / maxHp;
  let stage = DMG_OK;
  for (const t of DMG_THRESHOLDS) {
    if (ratio < t) stage += 1;
  }
  return stage;
}

// ---------------------------------------------------------------------------
// 자세 추론 (항목 3)
// ---------------------------------------------------------------------------

/** 특기할 자세 없음. */
export const POSTURE_NONE = 0;
/** `standoff`: 선호 거리 밖 — 접근/후퇴 중. 아직 사격 대역이 아니다. */
export const POSTURE_CLOSING = 1;
/** `standoff`: 선호 거리 안에서 수직 스트레이프 = **사격 대역**. 포격이 온다. */
export const POSTURE_FIRING_BAND = 2;
/** `chargeStraight`: 조준선을 고정한 채 순항 = **돌진 커밋**. 이 선 위에 있으면 맞는다. */
export const POSTURE_COMMIT = 3;
/** `chargeStraight`: 방금 진행 방향을 크게 꺾음 = **재조준**(돌진 직전의 "웅크림"). */
export const POSTURE_RELOCK = 4;
/** `seekWounded`: 정지 = 아군을 **치료 중**(우선 처치 대상이라는 신호). */
export const POSTURE_TENDING = 5;
/** `stationary`: 뿌리내린 고정 포대. 발사 시점은 관측 불가(위 헤더 참조). */
export const POSTURE_ROOTED = 6;

/** 이 모듈이 아는 이동 종류(= `data/enemies.ts` 의 `MovementKind`). 미상은 {@link POSTURE_NONE}. */
export type ObservedMovement = 'chargeStraight' | 'standoff' | 'seekWounded' | 'stationary';

/**
 * 재조준으로 판정하는 **한 틱 각도 변화**(라디안). `chargeStraight` 는 직진 중 각도가 정확히
 * 불변이라(속도 벡터를 안 바꾼다) 어떤 변화든 재조준·벽 슬라이드다. 0.35rad(20°)는 부동소수
 * 잡음과 실제 재조준을 가르는 여유값이다.
 */
export const RELOCK_ANGLE = 0.35;
/** 재조준 표시를 유지하는 렌더 프레임 수. 한 프레임 번쩍임은 눈이 못 잡는다. */
export const RELOCK_FRAMES = 10;
/** 순항 대비 이 비율 이상으로 움직여야 "달리는 중" 이다(커밋의 필요조건이지 충분조건이 아니다). */
export const COMMIT_RATIO = 0.7;
/**
 * 돌진 커밋으로 인정하는 **조준선 오차** 상한(라디안). 진행 방향과 "나를 향하는 방향" 의 차다.
 *
 * ⚠️ 1차 구현은 "빠르게 직진 중" 만으로 커밋을 냈고, 그래서 3시드 실측 듀티가 **88.9%** 였다 —
 * `moveCharge` 는 속도를 바꾸지 않으므로 순항 판정이 사실상 항상 참이기 때문이다. 상시 켜진
 * 예고는 예고가 아니라 배경이다. 커밋의 뜻은 "빠르다" 가 아니라 **"이 선 위에 있으면 맞는다"**
 * 이므로, 판정을 속도에서 **조준선 오차**로 옮겼다. 0.28rad ≈ 16°.
 */
export const AIM_LOCK = 0.28;
/**
 * 커밋 판정 사거리(월드 유닛). 화면 밖에서 나를 향해 달리는 개체까지 예고를 켜면 듀티가 다시
 * 올라가고 정보 가치도 없다(피할 시간이 충분하다).
 */
export const COMMIT_RANGE = 700;
/** 순항 추정치의 감쇠(프레임당). 벽에 막혀 느려진 개체가 영영 "커밋 아님" 이 되지 않게 한다. */
export const CRUISE_DECAY = 0.995;
/** 이 이동량(유닛/틱) 밑은 "정지" 로 본다. 보간 잔여·부동소수 잡음 흡수. */
export const MOVE_EPS = 0.05;
/** `standoff` 대역 판정의 각도 허용치(라디안). 스트레이프는 정확히 90° 라 여유가 넉넉하다. */
export const BAND_TOL = 0.45;

/**
 * 개체 하나의 자세 관측 상태. **렌더 프레임 사이에만 산다** — sim·리플레이와 무관하다.
 */
export interface PostureState {
  /** 관측된 순항 이동량(유닛/틱). 개체별 최고치를 완만히 감쇠시키며 추적한다. */
  cruise: number;
  /** 직전 관측 이동량(유닛/틱). */
  speed: number;
  /** 이 프레임 이후까지 재조준 표시를 유지한다(0 = 없음). */
  relockUntil: number;
  /** 현재 자세. */
  posture: number;
  /** 현재 자세를 유지한 프레임 수. 표시 세기를 서서히 올리는 데 쓴다(순간 점멸 방지). */
  holdFrames: number;
}

/** 새 관측 상태. 개체가 처음 보일 때 한 번 만든다. */
export function createPostureState(): PostureState {
  return { cruise: 0, speed: 0, relockUntil: 0, posture: POSTURE_NONE, holdFrames: 0 };
}

/** 각도차를 [-π, π] 로 정규화. */
function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

/**
 * 한 프레임 관측. `s` 를 제자리 갱신하고 이번 자세를 돌려준다.
 *
 * @param s        개체의 관측 상태(제자리 갱신).
 * @param e        이번 스냅샷.
 * @param prev     직전 스냅샷(없으면 호출측이 `e` 를 그대로 넘긴다 — 이동량 0 이 된다).
 * @param movement 이 종의 이동 종류(`data/enemies.ts`). 미상이면 `null`.
 * @param frameTick 렌더 프레임 카운터.
 */
export function observePosture(
  s: PostureState,
  e: EntitySnapshot,
  prev: EntitySnapshot,
  movement: ObservedMovement | null,
  frameTick: number,
  player: { readonly x: number; readonly y: number } | null = null,
): number {
  const dx = e.x - prev.x;
  const dy = e.y - prev.y;
  const d = Math.hypot(dx, dy);
  s.speed = d;
  // 순항 = 개체별 관측 최고치를 완만히 감쇠 추적. 벽에 막혀 한 번 느려진 개체가 영영 낮은
  // 순항에 갇히지 않고, 반대로 순간 최고치가 영원히 기준이 되지도 않는다.
  s.cruise = Math.max(d, s.cruise * CRUISE_DECAY);

  const next = classify(s, e, prev, movement, d, dx, dy, frameTick, player);
  if (next === s.posture) s.holdFrames += 1;
  else {
    s.posture = next;
    s.holdFrames = 0;
  }
  return next;
}

/** 이동 종류별 판정. {@link observePosture} 가 상태 갱신을 맡고 여기는 순수 분류만 한다. */
function classify(
  s: PostureState,
  e: EntitySnapshot,
  prev: EntitySnapshot,
  movement: ObservedMovement | null,
  d: number,
  dx: number,
  dy: number,
  frameTick: number,
  player: { readonly x: number; readonly y: number } | null,
): number {
  if (movement === 'stationary') return POSTURE_ROOTED;

  if (movement === 'chargeStraight') {
    // sim 의 moveCharge 는 속도 벡터를 **바꾸지 않는다**(스폰 시 1회 조준 + 벽 슬라이드/재조준).
    // 따라서 각도가 꺾였다 = 방금 재조준했다 = 곧 이 방향으로 달려온다.
    if (Math.abs(wrapAngle(e.angle - prev.angle)) >= RELOCK_ANGLE) {
      s.relockUntil = frameTick + RELOCK_FRAMES;
      return POSTURE_RELOCK;
    }
    if (frameTick < s.relockUntil) return POSTURE_RELOCK;
    // 커밋 = "이 선 위에 있으면 맞는다" 가 참인 순간. 속도만으로는 순항 내내 참이라 예고가
    // 배경이 된다(1차 실측 듀티 88.9%). 세 조건을 모두 만족해야 한다:
    //   ① 실제로 달리고 있다  ② 나를 조준선 안에 두고 있다  ③ 피할 시간이 촉박한 거리다
    if (!(s.cruise > MOVE_EPS && d >= s.cruise * COMMIT_RATIO)) return POSTURE_NONE;
    if (player === null) return POSTURE_NONE; // 플레이어를 모르면 커밋을 주장할 수 없다
    const toPlayer = Math.hypot(player.x - e.x, player.y - e.y);
    if (toPlayer > COMMIT_RANGE) return POSTURE_NONE;
    const err = Math.abs(wrapAngle(Math.atan2(player.y - e.y, player.x - e.x) - e.angle));
    return err <= AIM_LOCK ? POSTURE_COMMIT : POSTURE_NONE;
  }

  if (movement === 'standoff') {
    // sim 의 moveStandoff 는 `angle` 을 **항상 플레이어 방향**으로 둔다. 선호 거리 안이면
    // 속도가 그 각도에 **수직**(스트레이프), 밖이면 평행(접근) 또는 역평행(후퇴)이다.
    // 즉 속도와 angle 사이 각이 곧 "지금 사격 대역인가" 다.
    if (d <= MOVE_EPS) return POSTURE_NONE;
    const off = Math.abs(wrapAngle(Math.atan2(dy, dx) - e.angle));
    if (Math.abs(off - Math.PI / 2) <= BAND_TOL) return POSTURE_FIRING_BAND;
    return POSTURE_CLOSING;
  }

  if (movement === 'seekWounded') {
    // 부상 아군 120u 앞에서 멈춰 힐빔을 쏜다 — 정지가 곧 치료 중이다.
    return d <= MOVE_EPS ? POSTURE_TENDING : POSTURE_NONE;
  }

  return POSTURE_NONE;
}

// ---------------------------------------------------------------------------
// 스폰 인 (항목 4)
// ---------------------------------------------------------------------------

/** 스폰 인 연출 길이(렌더 프레임). 60fps 기준 약 0.4초 — 예고는 되지만 회피 판단을 늦추지 않는다. */
export const SPAWN_FRAMES = 24;

/**
 * 스폰 진행도 [0,1]. 1 이면 연출이 끝난 것이다.
 *
 * @param bornTick  이 개체가 처음 관측된 프레임.
 * @param frameTick 현재 프레임.
 */
export function spawnProgress(bornTick: number, frameTick: number): number {
  const t = (frameTick - bornTick) / SPAWN_FRAMES;
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

// ---------------------------------------------------------------------------
// 군집 가독성 (항목 6)
// ---------------------------------------------------------------------------

/**
 * 개체 id → 위상 오프셋 [0, 2π). 같은 종 20 마리가 **한 몸처럼 같은 박자로** 맥동하면 겹쳤을 때
 * 개체 수가 안 읽힌다. id 로 위상을 흩으면 각자 다른 박자로 뛰어 경계가 드러난다.
 *
 * 결정적(같은 id → 같은 위상)이라 프레임마다 흔들리지 않는다. 황금비 곱셈 해시라 이웃 id
 * (스폰이 연번을 준다)가 최대한 멀리 흩어진다 — 연번에 선형 함수를 쓰면 나란히 스폰된 편대가
 * 다시 같은 박자로 묶인다.
 */
export function phaseForId(id: number): number {
  const frac = (id * 0.6180339887498949) % 1;
  return (frac < 0 ? frac + 1 : frac) * Math.PI * 2;
}
