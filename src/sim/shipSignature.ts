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

/**
 * 병아리 1발의 피해 = **플레이어 주무기 발당 피해의 이 비율**(basis-point). 20% .
 *
 * ## ⚠️ 예전에는 `events.ts` 의 `TURRET_BULLET_DAMAGE = 10` 고정이었다 (2026-08-08 개정)
 *
 * 고정 화력은 **플레이어의 성장과 무관한 절대량**이라, 저레벨에서는 압도하고 만렙에서는
 * 희석된다. 무장비 명목표에서 해츨링이 +56 DPS(기준 DPS 79.8 의 70%)로 나머지를 1.80배
 * 압도하고 표준장비에서는 1.04배로 사라지던 것이 그 증상이다 — **기준이 바뀔 때마다 이
 * 기체의 값이 통째로 달라졌다.**
 *
 * ## 그리고 그 상수는 **공유물이었다**
 * `TURRET_BULLET_DAMAGE` 는 유니크 ④ 자율 드론 베이·보조무기 ③ 센트리도 쓴다. 병아리만
 * 비례시키려면 출처를 갈라야 하고, 그 분리의 선례가 `BROOD_MARK`(↔ `DRONE_MARK`)다. 여기서도
 * 같은 방식으로 **`ownerId === BROOD_MARK` 인 포탑에만** 이 비율을 건다(`world.ts`
 * `fireTurretShot`).
 *
 * ## 크기의 근거
 * 병아리는 `TURRET_FIRE_COOLDOWN`(10틱) 주기라 초당 6발이고, 동시 생존 기대치는 명목 가정치
 * (초당 처치 3.0 · 누적 300)에서 0.94기다. 20% 면 무장비 기준 `0.94 × 7.6 × 0.2 × 6 ≈ 8.6`
 * DPS 가산 = 실효 공격 배율 약 **1.11** 로 나머지 시그니처(정조준 1.042 · 과충전 1.056 ·
 * 은신 1.009)와 같은 자릿수다. 그리고 가산분이 플레이어 피해에 비례하므로 **장비를 입혀도
 * 배율이 거의 그대로다** — 그것이 이 개정의 목적이다.
 */
export const BROOD_DAMAGE_BP = 2000;

/**
 * 피해의 **소수 2자리 눈금**. `world.ts` 가 `weapon.damage` 에 쓰는 `Math.round(x * 100) / 100`
 * 관용구의 그 100 이다. 제수를 리터럴이 아니라 이름 있는 정수 상수로 두는 것은 이 모듈의
 * 규약이고(선례: `HATCH_SCALE_KILLS`·`FILM_PUSH_SCALE`), `tests/shipSignature.test.ts` 의
 * 결정론 산술 게이트가 그것을 강제한다.
 */
export const DAMAGE_CENTI_SCALE = 100;

/**
 * 플레이어 주무기 발당 피해 → 병아리 1발의 피해. 눈금은 `world.ts` 의 `weapon.damage` 와 같은
 * **소수 2자리**다 — 두 축의 눈금이 갈리면 같은 값을 두 곳에서 다르게 자르게 된다.
 *
 * 0 이하 입력은 0 을 낸다(피해가 없으면 병아리도 피해가 없다 — 하한 1 을 억지로 주지 않는다).
 */
export function broodBulletDamage(playerDamage: number): number {
  if (!(playerDamage > 0)) return 0;
  // 반올림 1회. 두 나눗셈의 제수는 각각 10000(bp)과 이름 있는 정수 눈금이다.
  const centi = Math.round((playerDamage * DAMAGE_CENTI_SCALE * BROOD_DAMAGE_BP) / 10000);
  return centi / DAMAGE_CENTI_SCALE;
}

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
 * 완충 무피격 카운터(`aux1`)의 **상한**. 정산은 임계({@link CUSHION_RECOVER_TICKS})에서
 * 일어나므로 정상 경로에서는 도달하지 않지만, **적립분이 0 인 구간**(정산할 것이 없어 카운터가
 * 리셋되지 않는 구간)에서 aux1 이 무한히 커지는 것을 막는다 — aux 는 u32 로 해시된다
 * (`replay.ts` `hashEntity`). 상한에 걸려도 임계는 이미 넘긴 뒤라 거동에는 영향이 없다.
 *
 * ⚠️ **이 값은 세 곳이 공유한다** — `world.ts` 의 시그니처 틱 진행 · `activeHandlers/mallow.ts`
 * 의 `addUnhitTicks` · `skills/mallow.ts` 의 ME1「조기 상환」. 배선 레인 이전에는 앞의 두 곳이
 * 각자 지역 상수로 **같은 값을 두 벌** 갖고 있었고, 세 번째 소비처가 생기는 시점에 여기로
 * 합쳤다(상수를 복제하면 한쪽만 고쳐질 때 조용히 갈린다).
 */
export const CUSHION_TICK_CAP = 600;

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
 * 이번 정산에 쓸 임계를 **정수로 정규화**한다. 0 이하는 1 로 올린다 — 0 이면 `unhitTicks >= 0`
 * 이 항상 참이라 **매 틱 정산**이 되어 완충이라는 축 자체가 사라진다. 앵커 ⑲ 의 계약이
 * "양의 정수" 인 것과 같은 규율이고, 여기서 한 번 더 막는 것은 순수 함수가 호출부의 실수에
 * 조용히 끌려가지 않게 하기 위함이다.
 */
function cushionThresholdOf(settleAt: number): number {
  const t = Math.trunc(settleAt);
  return t > 0 ? t : 1;
}

/**
 * 연속 무피격 `unhitTicks` 시점에 적립된 지연분 `deferred` 중 회복되는 양(정수).
 * 임계 미만이면 0 — 계속 맞는 런은 이 경로에서 아무 연산도 하지 않는다.
 *
 * ## ⚠️ 임계는 **인자**다 — 상수를 자기 안에서 다시 읽지 않는다(기본값도 두지 않는다)
 * 종전에는 이 함수가 `CUSHION_RECOVER_TICKS` 를 **자기 안에서** 다시 검사했다. 그래서 앵커
 * ⑲(`onCushionThreshold`)가 임계를 낮춰 `world.ts` 의 정산 분기에 진입시켜도 이 함수가 자기
 * 상수로 다시 걸러 **정산액이 0** 이 되었고, 말로우 ME9「솜틀 요양」은 "분기에는 들어갔는데
 * 아무 일도 안 일어나는" 반쪽 배선이라 통째로 미배선으로 남아 있었다. 임계를 인자로 받으면서
 * 그 경로가 열렸다.
 *
 * 인자에 **기본값을 두지 않는** 것이 규율이다 — 기본값을 두면 옛 호출부가 조용히 옛 거동으로
 * 흘러 개정이 무연산이 된다(`BulletExpiryReason` 선례). `tsc` 가 누락을 잡게 둔다.
 *
 * ## ⚠️ **탕감률도 인자다** — 같은 사유의 두 번째 개정(말로우 ME8「리듬 탕감」)
 * 종전에는 `CUSHION_RECOVER_BP` 를 이 함수가 자기 안에서 읽었다. ME8 은 *정산의 탕감 비율을
 * 콤보 스택으로 올리는* 스킬인데, 그 상수가 여기 갇혀 있는 한 **어떤 앵커에서도 손댈 수
 * 없었다** — 앵커 ⑳ 은 hp 차감이 끝난 뒤라 사후 환급으로 흉내 내면 hp−1 클램프가 소멸시킨
 * 초과분이 복원되지 않아 값이 갈리고, 앵커 ㉕ 에 닿은 시점엔 이미 이 상수로 계산이 끝나
 * 있다. 임계(`settleAt`)와 **정확히 같은 형태의 선결**이었고 같은 방식으로 푼다.
 * 기본값을 두지 않는 것도 같은 규율이다.
 *
 * @param settleAt 이번 틱의 **실효** 정산 임계. 기본값은 {@link CUSHION_RECOVER_TICKS} 이고,
 *   그 값을 넘기면 종전과 **비트 동일**이다.
 * @param recoverBp 이번 정산의 **실효** 탕감률(bp). {@link CUSHION_RECOVER_BP} 를 넘기면
 *   종전과 **비트 동일**이다. 10000 이상을 넘기면 정산분이 음수가 되므로 호출부(앵커 ㉘)가
 *   상한을 진다 — 설계 정본의 ME8 점근이 9500 이라 구조적으로 닿지 않는다.
 */
export function cushionRecovered(
  deferred: number,
  unhitTicks: number,
  settleAt: number,
  recoverBp: number,
): number {
  const v = Math.trunc(deferred);
  if (v <= 0) return 0;
  if (Math.trunc(unhitTicks) < cushionThresholdOf(settleAt)) return 0;
  return Math.round((v * recoverBp) / 10000);
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
 *
 * ## ⚠️ 임계는 **인자**다 — 사유는 {@link cushionRecovered} doc 이 정본이다
 * 요지: 이 함수가 자기 안에서 `CUSHION_RECOVER_TICKS` 를 다시 검사하던 것이 ME9 를 반쪽
 * 배선으로 만든 원인이었다. `settleAt` 을 `cushionRecovered` 와 **같은 값**으로 넘겨야
 * "회복분 + 정산분 = 적립분" 합 보존이 성립한다.
 *
 * @param settleAt 이번 틱의 **실효** 정산 임계. {@link CUSHION_RECOVER_TICKS} 를 넘기면 종전과
 *   **비트 동일**이다.
 * @param recoverBp 이번 정산의 **실효** 탕감률(bp). {@link cushionRecovered} 와 **같은 값**을
 *   넘겨야 "회복분 + 정산분 = 적립분" 합 보존이 성립한다(임계와 같은 규율)
 */
export function cushionSettled(
  deferred: number,
  unhitTicks: number,
  settleAt: number,
  recoverBp: number,
): number {
  const v = Math.trunc(deferred);
  if (v <= 0) return 0;
  if (Math.trunc(unhitTicks) < cushionThresholdOf(settleAt)) return 0;
  return v - cushionRecovered(v, unhitTicks, settleAt, recoverBp);
}

// --- ⑥ 버블: 방막(주기적 흡수 + 파열 밀어내기) --------------------------------
/** 막이 다시 생기기까지의 틱(60fps 기준 7초). */
export const FILM_PERIOD_TICKS = 420;
/**
 * 막 1장의 내구 = **최대 HP 의 이 비율**(basis-point). 25% .
 *
 * ## ⚠️ 이 값은 예전에 고정 상수 `FILM_ABSORB_FLAT = 60` 이었다 (2026-08-08 개정)
 *
 * 고정 흡수량은 **런과 무관한 절대 임계**를 만든다. 막은 {@link FILM_PERIOD_TICKS}(7초)마다
 * 다시 서므로 흡수량 60 은 *"초당 8.57 피해를 무조건 상쇄한다"* 와 같고, 실효체력을
 * `EHP = hp / (1 − 상쇄DPS / 받는DPS)` 로 풀면 **받는 피해가 8.57 미만인 순간 분모가 0 이하가
 * 되어 버블이 문자 그대로 죽지 않는다.** 그리고 그 임계는 성장과 무관하게 고정이라, 기체
 * 균형 판정이 "지금 적이 얼마나 세게 때리는가" 에 통째로 매달렸다 — 무장비 명목표에서 버블이
 * 나머지를 **9.52배**로 압도하고 표준장비에서는 4.17배로 반토막 나던 것이 그 증상이다.
 *
 * ## 실측이 정한 크기 (`bench/incomingDps.ts`, 2026-08-08)
 * 스트라이커·행성 0·무장비·시드 6개·5400틱(90초) 창에서 **선체가 잃는 초당 HP**:
 *
 *     Lv5(단계1)  중앙값 39.80  (35.56 ~ 52.09)
 *     Lv50(단계10) 중앙값 40.53  (37.47 ~ 46.81)
 *     Lv100(단계20) 중앙값 39.24  (32.98 ~ 49.07)
 *
 * 즉 판정 기준 모드(무장비)에서 받는 피해는 **레벨과 무관하게 약 40 DPS** 로 평평하다.
 * 이 비율(25%)이면 기본 HP 100 기준 내구 25 · 상쇄 3.57 DPS = 받는 피해의 **약 9%** 이고,
 * 실효 방어 배율이 `1/(1−0.09) ≈ 1.10` 으로 나머지 시그니처(장갑 1.111 · 은신 1.132 ·
 * 완충 1.092)와 같은 자릿수에 들어온다. 임계까지의 여유는 11배다.
 *
 * ## ⚠️ 이것은 상수가 아니라 **런 단위 파생값의 계수**다
 * 실제 상한의 정본은 `WorldState.filmCapacity`(`createWorld` 가 `config.playerHp` 에서 1회
 * 확정)다. `ARMOR_MAX_STACKS` → `WorldState.armorMaxStacks` 와 **정확히 같은 패턴**이고 같은
 * 규율이 걸린다: 상한을 그 자리에서 따로 해석하는 코드를 만들지 마라.
 */
export const FILM_ABSORB_HP_BP = 2500;

/**
 * 최대 HP → 막 1장의 내구(정수). 나눗셈 1회. 0 이하 HP 는 0 을 낸다.
 *
 * 하한 1 을 두지 **않는다** — HP 가 0 이하인 런은 막이 설 자리 자체가 없고, 억지로 1 을 주면
 * `aux0 === 0` 파열 판정이 영영 성립하지 않는 유령 막이 된다({@link filmAbsorbed} §유령 막).
 */
export function filmCapacityFor(maxHp: number): number {
  const hp = Math.trunc(maxHp);
  if (hp <= 0) return 0;
  return Math.round((hp * FILM_ABSORB_HP_BP) / 10000);
}
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

/**
 * 막 흡수 **효율**의 항등값(basis-point). 10000 = "내구 1 이 피해 1 을 막는다" = 종전 거동.
 * 앵커 ⑰(`onFilmEfficiency`)이 이 값에서 올리거나 내린다.
 */
export const FILM_EFFICIENCY_BASE_BP = 10000;

/**
 * 이 막이 이번 피격에서 막아낼 수 있는 **피해 총량**(정수) = 내구 × 효율.
 * 항등 효율(10000)에서는 내구 그대로라 종전과 비트 동일이다.
 */
function filmCapacity(shield: number, effBp: number): number {
  const s = Math.trunc(shield);
  const e = Math.trunc(effBp);
  if (s <= 0 || e <= 0) return 0;
  return Math.round((s * e) / 10000);
}

/**
 * 이 피격에서 실제로 **태우는 막 내구**(정수). `world.ts` 가 `player.aux0` 에서 빼는 값이다.
 *
 * ## ⚠️ 이 함수는 "막은 피해" 가 아니라 "태운 내구" 를 돌려준다 — 둘은 이제 다른 값이다
 * 종전 정의는 `min(damage, shield)` 여서 **태운 내구 ≡ 막은 피해**였고, 그 항등이 앵커 ⑰ 을
 * 원리적으로 무효로 만들었다. 사유를 지우지 않고 그대로 적어 둔다(다음 세션이 같은 형태를 또
 * 만들지 않도록):
 *  · `absorbed ≤ player.aux0` 을 지키려면 훅이 돌려주는 `shield ≤ player.aux0` 여야 했는데,
 *    `shield` 의 기본값이 이미 `player.aux0` 이라 훅은 **내구를 낮추는 방향으로만** 유효했다.
 *  · `dmg ≤ aux0` 이면 부풀리든 말든 `absorbed = dmg` 라 아무것도 안 바뀌고,
 *    `dmg > aux0` 이면 부풀리는 순간 `aux0` 이 음수가 되어 u32 폴드가 40억대로 접었다.
 * → 즉 "내구 1당 막는 피해가 1+α" 는 **흡수량 = 내구 소모량**이라는 구조에서 성립할 수 없었다.
 *
 * 효율 인자가 그 항등을 끊는다. 이제 막을 수 있는 피해 총량은 `내구 × 효율`(={@link filmCapacity})
 * 이고, 태우는 내구는 **막은 피해를 효율로 되돌린 값**이다. 두 값이 독립적으로 움직인다.
 *
 * ## ⚠️ `aux0` 이 음수가 되는 경로는 새로 생기지 않는다
 * 반환값은 어떤 효율에서도 `Math.trunc(shield)` 를 넘지 않는다 — 막이 다 닳는 경우
 * (`d >= cap`)를 **내구 전량으로 못 박아** 나눗셈 반올림이 상한을 넘길 여지를 없앴다.
 * 그 자리는 동시에 파열 판정(`aux0 === 0`)이 정확히 성립해야 하는 자리이기도 하다 —
 * 반올림으로 내구 1 이 남으면 "막을 힘은 없는데 파열도 안 하는" 유령 막이 된다.
 *
 * @param effBp 흡수 효율(bp). {@link FILM_EFFICIENCY_BASE_BP} 를 넘기면 종전과 **비트 동일**이다.
 *   기본값을 두지 않는 것이 규율이다 — 두면 옛 호출부가 조용히 옛 거동으로 흐른다.
 */
export function filmAbsorbed(damage: number, shield: number, effBp: number): number {
  const d = Math.trunc(damage);
  const s = Math.trunc(shield);
  if (d <= 0 || s <= 0) return 0;
  const cap = filmCapacity(s, effBp);
  if (cap <= 0) return 0;
  // 막이 이번 피격으로 소진되는 경우 — 태우는 내구는 **정확히 전량**이다(위 ⚠️).
  if (d >= cap) return s;
  // 아직 남는 경우 — 막은 피해(= d 전량)를 효율로 되돌려 태운 내구를 낸다. 나눗셈 1회.
  // ⚠️ 이 파일에서 **처음으로 제수가 런타임 값**이다(`eff`). 결정론 규율(ADR-0005)이 지금까지
  // "제수는 이름 있는 정수 상수" 였던 이유는 f64 누적을 막기 위함인데, `eff` 는 위에서
  // `Math.trunc` 로 정수화됐고 `filmCapacity` 가 `e <= 0` 을 이미 걸러 **양의 정수**임이
  // 보장된다(피제수도 정수). 따라서 단일 나눗셈 + 반올림 1회라는 형태는 그대로다.
  const eff = Math.trunc(effBp);
  const burned = Math.round((d * FILM_EFFICIENCY_BASE_BP) / eff);
  if (burned <= 0) return 0;
  return burned < s ? burned : s;
}

/**
 * 막을 통과해 실제로 선체에 들어가는 피해(정수).
 *
 * ## ⚠️ 합 보존 계약이 바뀌었다 — `absorbed + rest === damage` 는 더 이상 성립하지 않는다
 * 효율이 항등(10000)일 때만 성립한다. 일반형은 **`막은 피해 + rest === damage`** 이고,
 * 막은 피해 = `min(damage, 내구 × 효율)` 이다. `filmAbsorbed` 가 돌려주는 것은 막은 피해가
 * 아니라 *태운 내구*이므로 두 반환값을 그냥 더하면 안 된다 — 그 분리가 이 개정의 목적이다.
 *
 * @param effBp {@link filmAbsorbed} 와 **같은 값**을 넘겨야 한다. 다르면 두 값이 서로 다른
 *   막을 가리킨다.
 */
export function filmRemainingDamage(damage: number, shield: number, effBp: number): number {
  const d = Math.trunc(damage);
  if (d <= 0) return 0;
  const cap = filmCapacity(shield, effBp);
  return d > cap ? d - cap : 0;
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
