/**
 * 기체 시그니처 패시브 — `uniqueMask` 비트 상수 정본 + 순수 정수 헬퍼 (M8, 설계 §4).
 *
 * 기체 타입(ADR-0019)마다 하나씩 붙는 고유 패시브를 시뮬이 게이트하는 축이다. 배치는
 * (구)캡스톤과 완전히 동형이었다 — 비트 상수는 sim 에 살고, 파생
 * 레이어(src/items/loadout.ts)가 이 상수를 import 해 `LoadoutConfig.uniqueMask` 에 OR 한다.
 *
 * ⚠️ 결정론·해시 불변(ADR-0005): 시그니처는 **유니크·(구)캡스톤과 같은 `uniqueMask` 필드의
 * 미사용 상위 비트(18~23)** 를 재활용한다. 신규 LoadoutConfig 필드도 신규 hashWorld 폴드도
 * 만들지 않으므로 **시그니처 없는 런(스트라이커 = 기존 fixtures 전부)의 상태 해시가 바이트
 * 단위로 완전 불변**이다. 비트 가용 현황(실측):
 *   - 0~14  유니크 15종        (src/sim/uniques.ts)
 *   - 15~17 (구)캡스톤 3종·폐기 — 아래 문단 참조
 *   - 18~24 시그니처 7종       (이 파일, 스트라이커 포함 — ADR-0049 §1 "정조준 사이클")
 *   - 25~30 미사용 6비트
 *   - 31    **사용 금지** — `1 << 31` 이 음수라 마스크 연산이 취약해진다
 * 절대 재번호 금지 — uniqueMask 는 해시에 접힌다(src/sim/replay.ts).
 *
 * ⚠️ **비트 15~17(구 캡스톤 3종)은 ADR-0049 로 캡스톤 시스템 자체가 폐기되며 함께 죽었다** —
 * `src/items/loadout.ts` 가 더 이상 이 비트들을 세우지 않고, world.ts 도 이 비트를 읽던 게이트를
 * 전부 걷어냈다(캡스톤 전용 등가 헬퍼는 이 파일의 `hasSignature` 와 완전히 같은 연산이라
 * 통합됐고, 그 헬퍼가 있던 파일 자체도 삭제됐다). **지금 다른 용도로 재할당하지 마라** — 구
 * 리플레이·세이브가 이 비트를 세운 uniqueMask 를 담은 채 재생될 가능성을 배제할 수 없고, 재할당
 * 즉시 그 낡은 데이터가 새 의미로 조용히 재해석된다(예: 예전에 화력 캡스톤을 켰던 세이브가 새
 * 시그니처를 켠 것처럼 로드된다). 재사용하려면 먼저 replay/세이브 마이그레이션 경로에서 15~17
 * 비트를 명시적으로 지우거나 무시하는지 확인해야 한다.
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
 * 스트라이커 — 정조준 사이클. 주무기 볼리 12회마다 다음 1볼리가 「정조준 볼리」가 되어
 * 볼리 내 모든 탄이 피해 +50%·관통 +1 을 받는다(ADR-0049 §1, 승인본 4판). 별도 커밋으로
 * 부여된 7번째 시그니처 — 스트라이커는 이제 "시그니처 없음" 이 아니다(구 §11 채택안 A 폐기).
 */
export const SIG_STRIKER_MARKSMAN = 24;

/**
 * 시그니처 비트 전량 — **오름차순 정본**(18→24). `computeActiveSignature`(world.ts)가 이
 * 배열을 순회해 **첫 매치를 승자**로 고르므로("최저 비트 승자" 계약), 배열 자체가 오름차순이
 * 아니면 그 계약이 조용히 깨진다.
 *
 * ⚠️ **선언 순서가 더는 타입 id 순서와 같지 않다.** 스트라이커(타입 id 0)가 최상위 비트
 * 24 를 받으면서, 타입 id 순(0→6)은 `[24,18,19,20,21,22,23]` 인데 이 배열은 오름차순
 * `[18,19,20,21,22,23,24]` 이다. 레지스트리 교차 테스트(`shipSignatureRegistry.test.ts`)는
 * 두 목록을 **집합으로만** 대조하고, 이 배열이 오름차순인지는 별도 단언으로 못 박는다.
 *
 * 테스트·검증이 하드코딩 목록 대신 이 배열을 순회하도록 두면 비트가 늘 때 게이트가 자동으로
 * 따라온다.
 */
export const SIGNATURE_BITS = [
  SIG_BRUISER_ARMOR,
  SIG_ARC_OVERCHARGE,
  SIG_PHANTOM_CLOAK,
  SIG_HATCHLING_BROOD,
  SIG_MALLOW_CUSHION,
  SIG_BUBBLE_FILM,
  SIG_STRIKER_MARKSMAN,
] as const;

/**
 * 시그니처가 쓸 수 있는 최상위 비트. 31 은 `1 << 31` 이 음수가 되어 마스크 비교·OR 이
 * 취약해지므로 영구 제외한다.
 */
export const SIGNATURE_BIT_MAX = 30;

/** uniqueMask 에 시그니처 `bit` 이 켜져 있는지(hasUnique 와 동일 연산 — (구)캡스톤 전용 등가
 *  헬퍼는 이 함수와 완전히 같은 연산이었기에 통합됐고, 그 헬퍼가 있던 파일은 삭제됐다). */
export function hasSignature(mask: number, bit: number): boolean {
  return (mask & (1 << bit)) !== 0;
}

// --- ① 브루저: 장갑 스택 ------------------------------------------------------
/**
 * 장갑 스택 **기본** 상한 = 시그니처 단독일 때의 값.
 *
 * ⚠️ **이 상수를 "현재 런의 상한" 으로 읽지 마라.** ADR-0049 FO1(과적 장갑)이 상한 자체를
 * 넓히므로, 런 중 유효 상한의 정본은 `WorldState.armorMaxStacks`(createWorld 가 config 에서
 * 한 번 정수로 확정)다. 이 상수는 그 파생의 **기본값**이고, 아래 함수들의 `cap` 기본 인자로만
 * 남는다(미투자 런은 8 이라 기존 산술과 비트 동일).
 */
export const ARMOR_MAX_STACKS = 8;
/** 스택당 피해 감소(basis-point). 기본 상한 8스택 = 2000bp = 20% 감소. */
export const ARMOR_PER_STACK_BP = 250;
/** 이 틱 수만큼 피격이 없으면 스택 1개가 소멸한다(world.ts 배선이 참조). */
export const ARMOR_DECAY_TICKS = 180;

/**
 * 스택 수를 `[0, cap]` 정수로 정규화. `cap` 도 정수로 절삭하며 음수 cap 은 0 으로 접는다
 * (상한이 0 이면 장갑이 통째로 꺼진 것과 같다 — 예외를 던지지 않는 이유는 이 모듈이 leaf
 * 순수 함수만 담고 sim 루프 한복판에서 불리기 때문이다).
 */
export function clampArmorStacks(stacks: number, cap: number = ARMOR_MAX_STACKS): number {
  const c = Math.trunc(cap);
  if (c <= 0) return 0;
  const s = Math.trunc(stacks);
  if (s <= 0) return 0;
  if (s >= c) return c;
  return s;
}

/**
 * 스택 수 → **합산 감소 bp**(정수). 감소를 적용하는 **두 경로의 단일 정본**이다.
 *
 * ## 왜 이 함수가 따로 있는가 (E4, ADR-0049 선결)
 * 감소 산술은 두 곳에 산다 — 이 파일의 {@link armorReducedDamage}(정수 전용 순수 함수)와
 * `world.ts` 의 피격 통로(소수 피해 보존 때문에 `Math.trunc` 만 뺀 동형 코드). 상한이
 * 상수였을 때는 두 곳이 같은 상수를 읽어 자동으로 일치했지만, 상한이 런마다 달라지는 순간
 * **한쪽만 상한을 반영하면 감소 상한과 스택 상한이 조용히 갈린다**(그리고 그 어긋남은 화면에
 * 아무 흔적을 남기지 않는다). 그래서 "스택과 상한으로부터 bp 를 낸다" 는 계산 자체를 여기
 * 하나로 모으고, 두 경로가 **이 함수를 호출**하게 한다 — 테스트로 뒤쫓는 대신 구조적으로
 * 갈릴 수 없게 만드는 편이 싸다.
 */
export function armorReductionBp(stacks: number, cap: number = ARMOR_MAX_STACKS): number {
  return clampArmorStacks(stacks, cap) * ARMOR_PER_STACK_BP;
}

/**
 * 장갑 스택이 적용된 실제 피해량(정수). 스택 배율을 곱셈으로 **반복하지 않고** 합산 bp 로
 * 한 번에 적용한다 — 반복 곱은 f64 누적이라 결정론이 깨진다.
 *
 * `cap` 은 이 런의 유효 스택 상한(`WorldState.armorMaxStacks`). 생략하면 기본 상한이라
 * 미투자 런에서 종전과 비트 동일이다.
 */
export function armorReducedDamage(
  damage: number,
  stacks: number,
  cap: number = ARMOR_MAX_STACKS,
): number {
  const d = Math.trunc(damage);
  if (d <= 0) return 0;
  const bp = armorReductionBp(stacks, cap);
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

/**
 * 은신 **유지** 시간(진입 후 이 틱 수만큼만 은신이 선다). 60fps 기준 2초.
 *
 * ## 왜 상한이 필요한가 (초판 두 규칙이 모두 틀렸다)
 *  · 초판 ①"발사하면 풀린다" — 자동 조준 sim 에서는 사거리 안에 적이 있으면 무조건 쏘므로 실질
 *    조건이 "4초간 사거리 안에 적이 하나도 없을 것" 이 되어 **은신이 사실상 발동하지 않았다**
 *    (실측 14400틱 중 0~14틱).
 *  · 초판 ②"피격으로만 풀린다" — 반대로 **영구 은신**이 됐다. 원거리 견제형(standoff/gunner)만
 *    있는 무대에서는 접촉이 일어나지 않아 스트릭이 영영 끊기지 않고, 적이 한 발도 못 쏘는
 *    무적 런이 된다(실측: 정지 파일럿 p0t1 seed42 에서 3600틱 중 3361틱 은신).
 * 그래서 규칙은 **"연속 무피격 240틱을 채우면 120틱 동안 은신, 그 뒤 자동 해제 후 다시 240틱을
 * 채워야 한다"** 이다. 피격은 그 사이클을 즉시 0 으로 되돌린다. 최선의 경우에도 은신 점유율이
 * 120/360 = 1/3 로 구조적으로 유계이고, 한 대라도 맞으면 그보다 훨씬 낮아진다.
 */
export const CLOAK_HOLD_TICKS = 120;

/** 연속 무피격 틱 수가 진입 임계 이상인가(사이클 진입 판정). */
export function cloakActive(unhitTicks: number): boolean {
  return Math.trunc(unhitTicks) >= CLOAK_UNHIT_TICKS;
}

/** 지금 실제로 은신 중인가 — 진입 임계 이상 **그리고** 유지 창 안. */
export function cloakWindowActive(unhitTicks: number): boolean {
  const t = Math.trunc(unhitTicks);
  return t >= CLOAK_UNHIT_TICKS && t < CLOAK_UNHIT_TICKS + CLOAK_HOLD_TICKS;
}

/** 은신 해제 첫 타의 피해량(정수). 나눗셈 1회. */
export function cloakBreakDamage(damage: number): number {
  const d = Math.trunc(damage);
  if (d <= 0) return 0;
  return Math.round((d * CLOAK_BREAK_BP) / 10000);
}

// --- ④ 해츨링: 부화 ----------------------------------------------------------
/**
 * 병아리 드론 마커(`entity.ownerId`). 유니크 ④ 자율 드론 베이·보조무기 ③ 센트리가 쓰는
 * `DRONE_MARK` 와 **일부러 다른 값**이다.
 *
 * ⚠️ 처음에는 `DRONE_MARK` 를 재사용했고 그것이 결함이었다(적대적 리뷰 invariants-6): 동시 생존
 * 상한(BROOD_MAX_DRONES=4)을 `DRONE_MARK` 인 활성 포탑 전체로 세는 바람에, **드론 베이나 센트리를
 * 장착한 해츨링 런에서는 시그니처가 한 기도 출격하지 않을 수 있다** — 그리고 그 미발현은 화면에도
 * 테스트에도 아무 흔적을 남기지 않는다(이 저장소가 8번 겪은 "조용한 미발현"). 마커를 분리해
 * 상한을 출처별로 나눈다.
 *
 * ⚠️ `isGimmick`(world.ts)은 이 마커도 **반드시** 기믹 분류에서 제외해야 한다 — 빠뜨리면 병아리가
 * 청크 컬링에 잘리고 MAX_ACTIVE_GIMMICKS 를 잡아먹는데, 컬링은 조용히 일어나 "가끔 안 나온다"
 * 로만 관측된다. DRONE_MARK/HIVE_MICRO_MARK/MISSILE_MARK 어느 것과도 겹치지 않는 큰 상수라
 * 실제 엔티티 id 와 충돌하지 않는다(이미 해시되는 필드 재활용, hashWorld 레이아웃 불변).
 */
export const BROOD_MARK = 0xb400d5;

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
/**
 * 파열 밀어내기를 **1회성 변위**로 접을 때 곱하는 지속 틱.
 *
 * 왜 지속이 아니라 1회 변위인가(world.ts 배선이 정한 규칙, 코드 근거):
 * 적 속도(`e.vx`/`e.vy`)는 이동 컴포넌트가 **매 틱 대입으로 덮어쓴다**
 * (`patterns/index.ts` moveStandoff·moveSeekWounded·stationary). 따라서 속도에 밀어내기를
 * 실으면 다음 틱에 흔적 없이 사라지고 **화면상 아무 일도 안 일어나는데 그 1틱의 해시만
 * 갈린다.** 밀어내기는 좌표를 직접 옮기는 방식으로만 관측 가능하며, 그 선례가
 * `applySingularityPull`(world.ts)이다.
 *
 * 그래서 눈금 상수(FILM_BURST_PUSH = sim 좌표/틱 × 100)를 **단일 나눗셈**으로 속도로 되돌린
 * 뒤(2.6 좌표/틱), 이 틱 수만큼 지속된 결과를 파열 그 자리에서 한 번에 적용한다. 값 100 은
 * 결과 변위가 FILM_BURST_RADIUS(220)보다 커지게 하는 최소 눈금이다 — "반경 안의 적을 반경
 * 밖으로 밀어낸다" 가 성립해야 파열이 체감된다. 기존 상수의 값·의미는 하나도 바꾸지 않는다.
 */
export const FILM_BURST_PUSH_TICKS = 100;
/**
 * `FILM_BURST_PUSH` 가 실린 눈금(속도 × 이 값이 상수에 저장돼 있다). 나눗셈 제수를 리터럴이
 * 아니라 이름 있는 정수 상수로 두는 것은 이 모듈의 규약이다(선례: HATCH_SCALE_KILLS).
 */
export const FILM_PUSH_SCALE = 100;

/**
 * 막 파열이 반경 안 적 하나를 밀어내는 **1회 변위**(sim 좌표). 나눗셈 1회.
 * = 260 좌표 > FILM_BURST_RADIUS(220).
 */
export function filmBurstPush(): number {
  return (FILM_BURST_PUSH * FILM_BURST_PUSH_TICKS) / FILM_PUSH_SCALE;
}

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

// --- ⑦ 스트라이커: 정조준 사이클 -----------------------------------------------
/** 사이클 주기(볼리 수). 12번째 볼리가 정조준이고, 그 발사 틱에 카운터가 0 으로 되돌아간다. */
export const MARKSMAN_CYCLE_SHOTS = 12;
/** 정조준 볼리의 피해 증폭(basis-point). 5000 = +50%. */
export const MARKSMAN_BONUS_BP = 5000;
/** 정조준 볼리가 추가로 얻는 관통. */
export const MARKSMAN_PIERCE = 1;
/**
 * 카운터가 이 값 **이상**이면 다음 발사가 정조준 볼리다(`marksmanTriggered` 의 임계).
 * `MARKSMAN_CYCLE_SHOTS - 1` — 카운터는 0 에서 시작해 볼리마다 +1 되므로, 11번째 증가분을
 * 만드는 발사(= 12번째 발사)가 정조준이다.
 */
export const MARKSMAN_TRIGGER_AUX0 = MARKSMAN_CYCLE_SHOTS - 1;

/**
 * 이번 발사가 정조준 볼리인가 — **통과 판정(`>=`)이지 `=== MARKSMAN_TRIGGER_AUX0` 가 아니다.**
 *
 * ## 왜 `===` 가 아닌가 (이 파일의 다른 임계 판정과 다른 이유)
 * 위 팬텀 은신 진입(`aux0 === CLOAK_UNHIT_TICKS`, world.ts stepShipSignature)이나 아크캐스터의
 * 진행은 `===`/`>=` 어느 쪽이든 안전하다 — 그 카운터들은 **항상 1씩만** 오르므로 정확히 그
 * 값을 밟고 지나간다. 이 카운터(`aux0`)는 다르다: 설계서(§2 F1·S1)가 예고한 후속 스킬이
 * **카운터를 점프시킨다** — F1(전과 확장)은 처치당 `1 + ceil(Lv/4)` 를 한 번에 더하고,
 * S1(응전 조준)은 피격 시 카운터를 곧장 만충으로 못박는다. 두 스킬은 이 커밋의 담당 파일
 * 밖(스킬 30종은 별도 레인)이라 아직 그 가산 코드는 없지만, **트리거 판정을 미리 `>=` 로
 * 짜 둬야** 그 스킬들이 배선되는 순간 이 판정이 조용히 깨지지 않는다. `===` 로 짰다면
 * 카운터가 11 을 건너뛰어 12·13…으로 점프한 틱에 트리거가 **영영 서지 않고**, 그 미발동은
 * 화면에도 테스트에도 흔적을 남기지 않는다(이 저장소가 반복 겪은 "조용한 미발현" 패턴 —
 * 해츨링 BROOD_MARK 주석의 드론 베이 상한 공유 사례와 같은 형태). `>=` 는 몇 배로 점프해도
 * 다음 발사에서 반드시 잡고, 정상 경로(1씩 증가)에서는 `===` 와 완전히 같은 틱에 발동하므로
 * 지금 당장의 대가는 없다.
 */
export function marksmanTriggered(aux0: number): boolean {
  return Math.trunc(aux0) >= MARKSMAN_TRIGGER_AUX0;
}

/** 정조준 볼리의 피해(정수). 나눗셈 1회. */
export function marksmanDamage(damage: number): number {
  const d = Math.trunc(damage);
  if (d <= 0) return 0;
  return d + Math.round((d * MARKSMAN_BONUS_BP) / 10000);
}

/** 정조준 볼리의 관통(정수). 나눗셈 없음 — 정수 가산뿐이다. */
export function marksmanPierce(pierce: number): number {
  return Math.trunc(pierce) + MARKSMAN_PIERCE;
}
