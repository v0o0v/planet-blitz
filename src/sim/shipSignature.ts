/**
 * 기체 시그니처 패시브 — `uniqueMask` 비트 상수 정본 + 순수 정수 헬퍼 (M8, 설계 §4).
 *
 * 기체 타입(ADR-0019)마다 하나씩 붙는 고유 패시브를 시뮬이 게이트하는 축이다. 배치는
 * 캡스톤(src/sim/capstones.ts)과 완전히 동형이다 — 비트 상수는 sim 에 살고, 파생
 * 레이어(src/items/loadout.ts)가 이 상수를 import 해 `LoadoutConfig.uniqueMask` 에 OR 한다.
 *
 * ⚠️ 결정론·해시 불변(ADR-0005): 시그니처는 **유니크·캡스톤과 같은 `uniqueMask` 필드의
 * 미사용 상위 비트(18~23)** 를 재활용한다. 신규 LoadoutConfig 필드도 신규 hashWorld 폴드도
 * 만들지 않으므로 **시그니처 없는 런(스트라이커 = 기존 fixtures 전부)의 상태 해시가 바이트
 * 단위로 완전 불변**이다. 비트 가용 현황(실측):
 *   - 0~14  유니크 15종      (src/sim/uniques.ts)
 *   - 15~17 캡스톤 3종       (src/sim/capstones.ts)
 *   - 18~23 시그니처 6종     (이 파일)
 *   - 24~30 미사용 7비트
 *   - 31    **사용 금지** — `1 << 31` 이 음수라 마스크 연산이 취약해진다
 * 절대 재번호 금지 — uniqueMask 는 해시에 접힌다(src/sim/replay.ts).
 *
 * ## 산술 규약
 * 이 모듈의 모든 함수는 **정수 in / 정수 out** 이며 배율은 정수 basis-point(10000 = 1배)로만
 * 표현한다. 적용은 언제나 `Math.round((x * bp) / 10000)` **단일 나눗셈** 한 번이다.
 * 금지: `damage *= 0.975` 를 스택 수만큼 반복(f64 누적) · `Math.pow` · 중간 f64 보관.
 * 이유는 브라우저 클라이언트와 서버(Edge Function) 재검증이 **비트 단위로** 같은 값을
 * 내야 하기 때문이다. 부동소수 누적은 반올림 경로가 갈릴 여지를 만든다.
 *
 * ## 이 파일이 하지 않는 것
 * world.ts 배선(스택 적립·해제·조준 제외·소환)은 여기 없다. 이 모듈은 leaf 순수 함수만
 * 담고, 실제 훅은 sim 레인이 world.ts 에서 이 상수·함수를 읽어 적용한다.
 * 수치는 전부 밸런스 패스 대상 제안값이다 — 확정된 것은 축과 부호뿐(설계 §3).
 */

// --- 비트 인덱스 (정본. loadout.ts 가 import) --------------------------------
/** 브루저 — 피격 시 장갑 스택 적립, 스택당 피해 감소. */
export const SIG_BRUISER_ARMOR = 18;
/** 아크 캐스터 — 일정 시간 정지 시 과충전(피해 증폭), 이동 즉시 해제. */
export const SIG_ARC_OVERCHARGE = 19;
/** 팬텀 — 무피격 지속 시 은신(적 조준 제외) + 해제 첫 타 배율. */
export const SIG_PHANTOM_CLOAK = 20;
/** 해츨링 — 처치 적립, 임계 도달 시 병아리 드론 자동 출격. (비트 값 21 은 wire 계약이라 개명 후에도 불변) */
export const SIG_HATCHLING_BROOD = 21;
/** 말로우 — 피격 피해 일부를 지연 피해로 돌리고, 무피격 지속 시 회복. */
export const SIG_MALLOW_CUSHION = 22;
/** 버블 — 주기적으로 피해 흡수막이 생기고, 터질 때 주변을 밀어낸다. */
export const SIG_BUBBLE_FILM = 23;

/**
 * 시그니처 비트 전량(선언 순서 = 타입 id 1~6 순서). 테스트·검증이 하드코딩 목록 대신
 * 이 배열을 순회하도록 두면 비트가 늘 때 게이트가 자동으로 따라온다.
 */
export const SIGNATURE_BITS = [
  SIG_BRUISER_ARMOR,
  SIG_ARC_OVERCHARGE,
  SIG_PHANTOM_CLOAK,
  SIG_HATCHLING_BROOD,
  SIG_MALLOW_CUSHION,
  SIG_BUBBLE_FILM,
] as const;

/**
 * 시그니처가 쓸 수 있는 최상위 비트. 31 은 `1 << 31` 이 음수가 되어 마스크 비교·OR 이
 * 취약해지므로 영구 제외한다.
 */
export const SIGNATURE_BIT_MAX = 30;

/** uniqueMask 에 시그니처 `bit` 이 켜져 있는지(hasUnique·hasCapstone 과 동일 연산, 의미 분리용). */
export function hasSignature(mask: number, bit: number): boolean {
  return (mask & (1 << bit)) !== 0;
}

// --- ① 브루저: 장갑 스택 ------------------------------------------------------
/** 장갑 스택 상한. */
export const ARMOR_MAX_STACKS = 8;
/** 스택당 피해 감소(basis-point). 상한 8스택 = 2000bp = 20% 감소. */
export const ARMOR_PER_STACK_BP = 250;
/** 이 틱 수만큼 피격이 없으면 스택 1개가 소멸한다(world.ts 배선이 참조). */
export const ARMOR_DECAY_TICKS = 180;

/** 스택 수를 [0, ARMOR_MAX_STACKS] 정수로 정규화. */
export function clampArmorStacks(stacks: number): number {
  const s = Math.trunc(stacks);
  if (s <= 0) return 0;
  if (s >= ARMOR_MAX_STACKS) return ARMOR_MAX_STACKS;
  return s;
}

/**
 * 장갑 스택이 적용된 실제 피해량(정수). 스택 배율을 곱셈으로 **반복하지 않고** 합산 bp 로
 * 한 번에 적용한다 — 반복 곱은 f64 누적이라 결정론이 깨진다.
 */
export function armorReducedDamage(damage: number, stacks: number): number {
  const d = Math.trunc(damage);
  if (d <= 0) return 0;
  const bp = clampArmorStacks(stacks) * ARMOR_PER_STACK_BP;
  if (bp === 0) return d;
  return d - Math.round((d * bp) / 10000);
}

// --- ② 아크 캐스터: 과충전 ----------------------------------------------------
/** 과충전 진입에 필요한 연속 정지 틱(60fps 기준 1.5초). */
export const OVERCHARGE_STILL_TICKS = 90;
/** 진입 즉시 얻는 피해 증폭(basis-point). */
export const OVERCHARGE_BASE_BP = 1500;
/** 진입 이후 정지 1틱당 추가 증폭(basis-point). */
export const OVERCHARGE_RAMP_BP = 25;
/** 증폭 상한(basis-point). BASE + RAMP × 100틱 에서 도달 = 정지 190틱. */
export const OVERCHARGE_MAX_BP = 4000;

/**
 * 연속 정지 틱 수에 대응하는 피해 증폭 bp(정수). 임계 미만이면 0 — 즉 이동 중인 런은
 * 이 경로에서 아무 연산도 하지 않는다.
 */
export function overchargeBp(stillTicks: number): number {
  const t = Math.trunc(stillTicks);
  if (t < OVERCHARGE_STILL_TICKS) return 0;
  const bp = OVERCHARGE_BASE_BP + (t - OVERCHARGE_STILL_TICKS) * OVERCHARGE_RAMP_BP;
  if (bp >= OVERCHARGE_MAX_BP) return OVERCHARGE_MAX_BP;
  return bp;
}

/** 과충전이 적용된 피해량(정수). 나눗셈 1회. */
export function overchargedDamage(damage: number, stillTicks: number): number {
  const d = Math.trunc(damage);
  if (d <= 0) return 0;
  const bp = overchargeBp(stillTicks);
  if (bp === 0) return d;
  return d + Math.round((d * bp) / 10000);
}

// --- ③ 팬텀: 은신 -------------------------------------------------------------
/** 은신 진입에 필요한 연속 무피격 틱(60fps 기준 4초). */
export const CLOAK_UNHIT_TICKS = 240;
/** 은신 해제 첫 타 배율(basis-point, 10000 = 1배). 25000 = 2.5배. */
export const CLOAK_BREAK_BP = 25000;

/** 연속 무피격 틱 수가 임계 이상이면 은신 상태. */
export function cloakActive(unhitTicks: number): boolean {
  return Math.trunc(unhitTicks) >= CLOAK_UNHIT_TICKS;
}

/** 은신 해제 첫 타의 피해량(정수). 나눗셈 1회. */
export function cloakBreakDamage(damage: number): number {
  const d = Math.trunc(damage);
  if (d <= 0) return 0;
  return Math.round((d * CLOAK_BREAK_BP) / 10000);
}

// --- ④ 해츨링: 부화 ----------------------------------------------------------
/** 첫 출격에 필요한 처치 수. */
export const HATCH_BASE_KILLS = 12;
/** 스케일 구간을 하나 넘길 때마다 늘어나는 요구 처치 수. */
export const HATCH_STEP_KILLS = 4;
/** 요구치가 한 단계 오르는 누적 처치 간격. */
export const HATCH_SCALE_KILLS = 60;
/** 요구 처치 수 상한(후반에 출격이 사실상 멈추지 않도록 고정). */
export const HATCH_MAX_KILLS = 40;

/**
 * 런 누적 처치 `kills` 시점에서 **병아리 드론 1기 출격에 필요한 처치 수**(정수).
 *
 * 배선 계약(world.ts 레인용): 출격 이후 처치 카운터를 0으로 리셋하고, 그 카운터가
 * `hatchThreshold(누적 처치)` 이상이 되는 틱에 출격시킨다. 누적이 늘수록 요구치가
 * 계단식으로 올라 후반 소환 폭주를 막는다. 단조 비감소이며 상한에서 평평해진다.
 */
export function hatchThreshold(kills: number): number {
  const k = Math.trunc(kills);
  if (k <= 0) return HATCH_BASE_KILLS;
  const need = HATCH_BASE_KILLS + Math.floor(k / HATCH_SCALE_KILLS) * HATCH_STEP_KILLS;
  if (need >= HATCH_MAX_KILLS) return HATCH_MAX_KILLS;
  return need;
}

// --- ⑤ 말로우: 완충(지연 피해 + 무피격 회복) ---------------------------------
/** 피격 피해 중 **즉시 들어가지 않고 지연분으로 적립되는** 비율(basis-point). */
export const CUSHION_DEFER_BP = 3500;
/** 지연분이 회복으로 전환되기 시작하는 연속 무피격 틱(60fps 기준 3초). */
export const CUSHION_RECOVER_TICKS = 180;
/** 임계를 넘겼을 때 지연분에서 회복되는 비율(basis-point). 나머지는 그대로 남는다. */
export const CUSHION_RECOVER_BP = 6000;

/**
 * 이 피격에서 **지연분으로 적립되는** 피해(정수). 나눗셈 1회.
 * 즉시분과 합하면 원래 피해와 정확히 같다({@link cushionImmediateDamage} 참조).
 */
export function cushionDeferredDamage(damage: number): number {
  const d = Math.trunc(damage);
  if (d <= 0) return 0;
  return Math.round((d * CUSHION_DEFER_BP) / 10000);
}

/**
 * 이 피격에서 **즉시 들어가는** 피해(정수). 지연분을 뺀 나머지로 정의해 두 값의 합이
 * 항상 원래 피해와 같다 — 두 쪽을 각각 반올림하면 1 이 새거나 늘어난다.
 */
export function cushionImmediateDamage(damage: number): number {
  const d = Math.trunc(damage);
  if (d <= 0) return 0;
  return d - cushionDeferredDamage(d);
}

/**
 * 연속 무피격 `unhitTicks` 시점에 적립된 지연분 `deferred` 중 회복되는 양(정수).
 * 임계 미만이면 0 — 계속 맞는 런은 이 경로에서 아무 연산도 하지 않는다.
 */
export function cushionRecovered(deferred: number, unhitTicks: number): number {
  const v = Math.trunc(deferred);
  if (v <= 0) return 0;
  if (Math.trunc(unhitTicks) < CUSHION_RECOVER_TICKS) return 0;
  return Math.round((v * CUSHION_RECOVER_BP) / 10000);
}

/**
 * 정산 시점에 **실제로 선체(hp)에 들어가는** 지연분(정수) = 적립분 − 회복분.
 *
 * 이 파일의 나머지 완충 함수는 적립(`cushionDeferredDamage`)과 회복(`cushionRecovered`)만
 * 정의하고 "미룬 피해가 언제 들어오는가" 를 비워 두었다. world.ts 배선(M8)이 택한 소진 규칙은
 * **연속 무피격이 `CUSHION_RECOVER_TICKS` 를 채운 그 틱에 풀을 통째로 정산한다** 이고, 이
 * 함수가 그 정산에서 남는 몫이다. 회복분과 합하면 항상 적립분과 같아 "미룬 피해는 회복된
 * 만큼만 사라진다" 가 성립한다(즉시분/지연분 합 보존과 같은 사상).
 *
 * 임계 미만이면 0 — 아직 정산 자체가 일어나지 않는다(`cushionRecovered` 와 동일 게이트라
 * 호출부가 임계를 두 번 판정할 필요가 없다).
 */
export function cushionSettled(deferred: number, unhitTicks: number): number {
  const v = Math.trunc(deferred);
  if (v <= 0) return 0;
  if (Math.trunc(unhitTicks) < CUSHION_RECOVER_TICKS) return 0;
  return v - cushionRecovered(v, unhitTicks);
}

// --- ⑥ 버블: 방막(주기적 흡수 + 파열 밀어내기) --------------------------------
/** 막이 다시 생기기까지의 틱(60fps 기준 7초). */
export const FILM_PERIOD_TICKS = 420;
/** 막 1장이 흡수하는 피해 총량(정수 HP 단위 — 배율이 아니라 흡수량이다). */
export const FILM_ABSORB_FLAT = 60;
/** 막이 터질 때 밀어내는 반경(sim 좌표). */
export const FILM_BURST_RADIUS = 220;
/** 막이 터질 때 주변 적에게 실리는 밀어내기 속도(sim 좌표/틱 × 100, 정수 유지용 눈금). */
export const FILM_BURST_PUSH = 260;

/** 마지막 파열 이후 `ticksSinceBurst` 만큼 지났을 때 막이 다시 서 있는가. */
export function filmReady(ticksSinceBurst: number): boolean {
  return Math.trunc(ticksSinceBurst) >= FILM_PERIOD_TICKS;
}

/** 남은 막 내구 `shield` 가 이 피격에서 실제로 흡수하는 양(정수). 나눗셈 없음. */
export function filmAbsorbed(damage: number, shield: number): number {
  const d = Math.trunc(damage);
  const s = Math.trunc(shield);
  if (d <= 0 || s <= 0) return 0;
  return d < s ? d : s;
}

/** 막을 통과해 실제로 선체에 들어가는 피해(정수). 흡수량과 합하면 원래 피해와 같다. */
export function filmRemainingDamage(damage: number, shield: number): number {
  const d = Math.trunc(damage);
  if (d <= 0) return 0;
  return d - filmAbsorbed(d, shield);
}
