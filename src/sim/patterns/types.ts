/**
 * Data-driven enemy pattern definitions (M1 Phase 2).
 *
 * The "pattern component engine" (spec: 발사체 × 궤적 × 발사 타이밍) is expressed
 * as two composable axes of data:
 *
 *   - a MovementKind  — how the enemy steers each tick, and
 *   - an AttackDef     — a discriminated union describing what it emits on its
 *                        fire cadence.
 *
 * A concrete enemy (EnemyDef) is just a row of data pairing one movement with
 * one attack plus tuning numbers. M1 ships 4 enemies (the Kargon role slots);
 * M2/M3 scale to 20 by adding rows here and, rarely, a new component function —
 * never by editing the world loop.
 */

/** The four Kargon role slots (spec R6). Index is stable for hashing/render. */
export type EnemyRole = 'charger' | 'gunner' | 'special' | 'support';

/** Steering behaviour applied every tick. */
export type MovementKind =
  | 'chargeStraight' // rush in a straight line toward the player; bounce off walls
  | 'stationary' // rooted turret (lava spring)
  | 'standoff' // approach to a preferred range, then hold (mortar)
  | 'seekWounded'; // drift toward the most-wounded ally to heal it (support)

/** Hazard subtype codes (also used as render/hash tags on hazard entities). */
export const HAZARD_MORTAR = 0;
export const HAZARD_LAVA = 1;
/**
 * 감속 지대(plan B1, 니플헤임 유령 기함). 활성 상태에서 플레이어가 닿으면 소량 피해 +
 * 일정 시간 감속(state.playerSlowTicks). 서브타입 코드는 append-only(재번호 금지).
 */
export const HAZARD_SLOW = 2;

export type AttackDef =
  /** Charger: no periodic fire; emits fragments on wall impact (see movement). */
  | { readonly kind: 'fragments'; readonly count: number; readonly speed: number; readonly damage: number; readonly bulletRadius: number; readonly bulletLife: number }
  /** Gunner: telegraphs a circular impact zone at the player, then bursts. */
  | { readonly kind: 'mortar'; readonly windup: number; readonly radius: number; readonly damage: number }
  /** Special: telegraphs a line of lava pillars across the arena. */
  | { readonly kind: 'lava'; readonly windup: number; readonly activeTicks: number; readonly pillars: number; readonly radius: number; readonly damage: number }
  /** Support: heals the nearest wounded ally within range each active tick. */
  | { readonly kind: 'heal'; readonly range: number; readonly healPerTick: number };

export interface EnemyDef {
  /** Data id (for logs/tooling). */
  readonly id: string;
  readonly role: EnemyRole;
  /** Stable numeric code stored on the entity (render colour, hash). */
  readonly typeIndex: number;
  readonly radius: number;
  readonly hp: number;
  /** Contact damage dealt to the player on touch. */
  readonly contactDamage: number;
  /** Movement speed (units/second). */
  readonly speed: number;
  readonly movement: MovementKind;
  readonly attack: AttackDef;
  /** Ticks between attack activations. */
  readonly fireCooldown: number;
  /** Experience granted by the gem this enemy drops when slain. */
  readonly xpValue: number;
}

// ---------------------------------------------------------------------------
// 중반 격전 리더 — 마커 + 이동 속도 (ADR-0032, 2026-08-08 결함 수정)
// ---------------------------------------------------------------------------
//
// ## 왜 이 둘이 **여기(leaf)** 에 사는가
// 마커는 `modes/midClash.ts` 가 소유하고 그 파일 주석이 사유의 정본이지만, **패턴 엔진이
// 이동 단계에서 읽어야 한다**. `patterns/index.ts` 가 `midClash.ts` 를 import 하면
// `midClash → waves → …` 의 기존 순환에 패턴 엔진이 끌려 들어간다. 두 상수를 양쪽이 이미
// 쓰는 이 leaf 로 내리면 순환이 아예 생기지 않는다(`midClash.ts` 는 재수출만 한다).

/**
 * 격전 리더 마커(`enemy.aux1` 센티넬). 값의 유래·왜 `ownerId` 가 아니라 `aux1` 인지는
 * `src/sim/modes/midClash.ts` 헤더가 정본이다.
 */
export const MID_CLASH_LEADER_MARK = 0xc1a58e;

/**
 * 격전 리더의 **이동 속도 덮어쓰기**(units/sec). `def.speed` 를 대신한다.
 *
 * ## 왜 필요한가 — 리더가 플레이어에게 **원리적으로 도달할 수 없었다** (2026-08-08 실측)
 * 격전 세그먼트의 전진 게이트는 **리더 처치 하나뿐**이다(`killGoal: 0`). 그런데 리더 기반
 * 정의는 `planet.elites[0]` 이고, 실측 결과 **6행성 전부** 그 자리가 `standoff` 이동에
 * 속도 140~170 인 포대형이었다:
 *
 *     카르곤 lava-battery(standoff 160) · 베르단 sentinel(170) · 니플헤임 frost-sentinel(160)
 *     아르케 guardian-battery(140) · 톡사르 toxin-sentinel(170) · 크라스 siege-battery(140)
 *
 * 플레이어 기본 속도는 **720**(`DEFAULT_CONFIG.playerSpeed`)이다. `moveStandoff` 는 선호 거리
 * 380 으로 접근하려 하지만 속도가 1/4 이라 **움직이는 플레이어를 영영 따라잡지 못한다.**
 * 리더는 스폰 지점(플레이어 기준 −1100) 부근에 남고, 실측 리더 최대거리가 1367~1976px 였다 —
 * 기본 무기 사거리(1650) 언저리 밖이다. 게다가 자동 조준은 **최근접**을 고르므로, 주변에
 * 잡몹이 있는 한 리더는 조준 대상조차 되지 않는다.
 *
 * 결과가 사용자 신고 그대로다: *"4단계부터 스테이지 단계가 너무 안 올라가"*. 난이도가 아니라
 * **게이트 도달 불가**였다.
 *
 * ⚠️ 이것은 밀도 패스가 만든 결함이 **아니다** — 원래 있었고, 적 수 +30%(`ENEMY_COUNT_MULT`)가
 * "최근접이 항상 잡몹" 을 더 자주 만들어 **드러나게** 했다.
 *
 * ## 왜 정의 교체가 아니라 속도 덮어쓰기인가
 * `elites[1]` 로 바꾸면 5행성은 `chargeStraight`(250~300)로 낫지만 **카르곤은 `stationary`
 * (속도 0)** 이라 더 나쁘다. 즉 데이터 선택으로는 6행성을 동시에 못 고친다. 그리고 `midClash.ts`
 * 헤더가 전용 `EnemyDef` 신설을 이미 기각했다(typeIndex 계약이 늘어난다). 남는 최소 수단이
 * 이동 속도 덮어쓰기이고, 그것이 설계 문면(*"리더가 수렴한다"*)과도 정확히 맞는다.
 *
 * ## 값 (TODO(밸런스) — 체감으로 확정할 자리)
 * 520 = 플레이어의 약 72%. 플레이어가 거리를 벌 수는 있지만 **영구히 도망칠 수는 없다**.
 * 리더는 `standoff` 라 선호 거리 380 에서 멈추므로 들이받지 않는다 — 사거리 안에 들어와
 * 조준 후보가 되는 것이 목적이지 추격자로 만드는 것이 목적이 아니다.
 */
export const MID_CLASH_LEADER_SPEED = 520;
