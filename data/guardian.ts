/**
 * 수호 기체(퇴역 기체의 방어 AI) — 프리셋·스냅샷·스탯 해석 (M5 plan Phase A1/A2, ADR-0007).
 *
 * 이 모듈은 **순수 결정론 정수 연산**만 담는다(Math.random/Date.now/pixi 없음 — sim 리프에서
 * import 가능). 수호 기체의 능력치는 세 결정론 입력의 함수다:
 *   1. **스냅샷(GuardianSnapshot)** — 퇴역 순간의 빌드 전투력을 복사한 기본 전투 스탯(ADR-0007
 *      R8 "복사 스냅샷"). 프리셋(타이탄형/인터셉터형, OQ-M5-3)과 전투력 점수로 산출된다.
 *   2. **남은 성능%(performanceCP)** — 풍화로 감쇠하는 수명형 성능(100%→50%, ADR-0006/0007).
 *      정수 centi-percent(10000=100.00%, 5000=50.00% 바닥).
 *   3. **계보 수호 가지 보너스(lineageBonusBp)** — 모든 수호 기체를 강화하는 계정 단위 보너스.
 *      정수 basis-point(0..5000 = +0%..+50%, 로그 점근 상한 — data/lineage.ts).
 *
 * {@link resolveGuardianStats}가 이 셋을 실효 전투 스탯으로 해석한다. 클라이언트(런 실행)와
 * 서버(전수 재실행 검증)가 **동일 함수**를 호출하므로, 방어 배치 config 에 [스냅샷+성능%+보너스]
 * 만 실으면 양쪽이 비트 동일한 실효 스탯을 재현한다(갈림길①A — 서버 재현 가능). 위조(약한
 * 수호기를 강하다 주장)는 서버가 권위 스냅샷·성능·보너스로 재해석해 hashStream 이 갈려 거부한다.
 */

/** 프리셋 코드: 타이탄형(고HP·고화력·저속). 절대 재번호 금지(배치 JSON 계약). */
export const GUARDIAN_TITAN = 0;
/** 프리셋 코드: 인터셉터형(고속·대시 특화·저내구). */
export const GUARDIAN_INTERCEPTOR = 1;
/** 확정 프리셋 수(OQ-M5-3). */
export const GUARDIAN_PRESET_COUNT = 2;

/** 완전 성능 = 100.00% centi-percent(정수 도메인 — f64 누적 오차 차단). */
export const PERFORMANCE_FULL = 10000;
/** 풍화 바닥 = 50.00%(ADR-0007 — 자동 소멸 없음, 여기서 멈춤). */
export const PERFORMANCE_FLOOR = 5000;

/** 동시 방어 배치 수호 슬롯 상한(GDD §4 · ADR-0007 — 질적 성장은 계보로). */
export const MAX_GUARDIAN_SLOTS = 2;

/**
 * 수호 기체의 **복사 스냅샷**(퇴역 순간 고정, 회복·변형 없음). 모든 필드는 결정론 정수다.
 * 스탯 = 이 스냅샷 × 남은 성능% × 계보 보너스(={@link resolveGuardianStats}).
 */
export interface GuardianSnapshot {
  /** 프리셋(렌더·기록용; 스탯은 아래 필드로 완결). */
  readonly preset: number;
  /** 히트박스 반지름(월드 유닛). */
  readonly radius: number;
  /** 최대 내구도(플레이어 탄에 파괴됨). 성능·보너스로 스케일. */
  readonly hp: number;
  /** 접촉(램) 피해. 성능·보너스로 스케일. */
  readonly contactDamage: number;
  /** 발사 간격(틱). 보너스로 단축(연사↑) — 성능은 미적용(간격은 정수 안정성 위해 보너스만). */
  readonly fireCooldown: number;
  /** 발당 피해. 성능·보너스로 스케일. */
  readonly bulletDamage: number;
  /** 탄속(유닛/초). */
  readonly bulletSpeed: number;
  /** 탄 반지름. */
  readonly bulletRadius: number;
  /** 탄 수명(틱). */
  readonly bulletLife: number;
  /** 조준·발사 사거리(유닛). */
  readonly range: number;
  /** 이동 속도(유닛/초) — 추적 거동. */
  readonly moveSpeed: number;
  /** 유지 거리(유닛): 이 거리보다 멀면 추적, 이내면 멈춰 사격(요격 유닛 거동). */
  readonly standoff: number;
}

/** {@link resolveGuardianStats}가 낸 실효 전투 스탯(성능·보너스 적용 후, 정수). */
export interface GuardianStats {
  readonly radius: number;
  readonly hp: number;
  readonly contactDamage: number;
  readonly fireCooldown: number;
  readonly bulletDamage: number;
  readonly bulletSpeed: number;
  readonly bulletRadius: number;
  readonly bulletLife: number;
  readonly range: number;
  readonly moveSpeed: number;
  readonly standoff: number;
}

/**
 * 프리셋 기본 스탯(전투력 점수 100 기준). {@link makeGuardianSnapshot}가 전투력 점수로
 * hp·피해를 스케일해 스냅샷을 만든다. **초기 추정값**(M5 밸런싱 패스 튜닝 대상, 계획 §5).
 *   - 타이탄형: 고HP·고화력·저속·긴 유지거리(포격형).
 *   - 인터셉터형: 저내구·고속·근접 추적(요격형).
 */
const PRESET_BASE: readonly GuardianSnapshot[] = [
  // GUARDIAN_TITAN
  {
    preset: GUARDIAN_TITAN,
    radius: 44,
    hp: 900,
    contactDamage: 24,
    fireCooldown: 48,
    bulletDamage: 22,
    bulletSpeed: 1100,
    bulletRadius: 12,
    bulletLife: 120,
    range: 1100,
    moveSpeed: 220,
    standoff: 640,
  },
  // GUARDIAN_INTERCEPTOR
  {
    preset: GUARDIAN_INTERCEPTOR,
    radius: 30,
    hp: 480,
    contactDamage: 16,
    fireCooldown: 26,
    bulletDamage: 9,
    bulletSpeed: 1500,
    bulletRadius: 7,
    bulletLife: 70,
    range: 760,
    moveSpeed: 460,
    standoff: 300,
  },
];

/**
 * 프리셋 코드를 검증·정규화한다(범위 밖은 타이탄으로 폴백 — 배치 데이터는 검증된 값만 담지만
 * 방어적으로 폴백해 undefined 스펙 조회로 인한 무발사/NaN 을 막는다).
 */
export function normalizeGuardianPreset(preset: number): number {
  const p = Math.trunc(preset);
  return p >= 0 && p < GUARDIAN_PRESET_COUNT ? p : GUARDIAN_TITAN;
}

/**
 * 남은 성능%를 결정론 정수 도메인[{@link PERFORMANCE_FLOOR}, {@link PERFORMANCE_FULL}]으로
 * 정규화한다. 미지정·비유한은 완전 성능으로 본다. 바닥 아래로는 클램프(ADR-0007 자동 소멸 없음).
 */
export function normalizePerformance(perfCP: number | undefined): number {
  if (perfCP === undefined || !Number.isFinite(perfCP)) return PERFORMANCE_FULL;
  const i = Math.trunc(perfCP);
  if (i <= PERFORMANCE_FLOOR) return PERFORMANCE_FLOOR;
  if (i >= PERFORMANCE_FULL) return PERFORMANCE_FULL;
  return i;
}

/**
 * 계보 수호 가지 보너스(basis-point)를 [0, 5000] 로 정규화한다(로그 점근 상한 +50%). 미지정·
 * 비유한·음수는 0(보너스 없음).
 */
export function normalizeLineageBonus(bonusBp: number | undefined): number {
  if (bonusBp === undefined || !Number.isFinite(bonusBp)) return 0;
  const i = Math.trunc(bonusBp);
  if (i <= 0) return 0;
  if (i >= 5000) return 5000;
  return i;
}

/**
 * 스칼라 1개를 [성능% × (1+보너스)] 로 스케일한다(결정론 정수 — 단일 나눗셈 + Math.round).
 * base ≤ 수천, perfCP ≤ 10000, (10000+bonusBp) ≤ 15000 → 곱 ≤ 7.5e11 < 2^53 이라 정확 정수,
 * 나눗셈은 IEEE-754 correctly-rounded 단일 연산이라 Node(클라)·Deno(서버)에서 비트 동일하다.
 */
function scaleStat(base: number, perfCP: number, bonusBp: number): number {
  return Math.round((base * perfCP * (10000 + bonusBp)) / 100000000);
}

/**
 * 발사 간격을 계보 보너스로 단축한다(보너스↑ → 간격↓ → 연사↑). 성능은 간격에 적용하지 않는다
 * (성능은 hp·피해로만 반영 — 간격까지 성능 스케일하면 두 축 중복 감쇠). 결정론 정수(단일 나눗셈).
 * 실효 = round(base × 10000 / (10000 + bonusBp)). 최소 2틱 보장(0 나눗셈·즉발 폭주 방지).
 */
function scaleCooldown(base: number, bonusBp: number): number {
  const v = Math.round((base * 10000) / (10000 + bonusBp));
  return v < 2 ? 2 : v;
}

/**
 * [스냅샷 × 남은 성능% × 계보 보너스] → 실효 전투 스탯(결정론 정수). 클라·서버 공통 진실 함수.
 * 성능·보너스는 hp·접촉피해·탄피해를 스케일하고, 보너스는 발사 간격을 추가 단축한다. 기하(반지름·
 * 사거리·탄속·이동속도·유지거리·탄수명)는 스냅샷 그대로 — f64 산술이 섞이는 판정 필드를 건드리지
 * 않아 결정론 위험을 줄인다(defense.ts scaleFireCooldown 규율과 동일 철학).
 */
export function resolveGuardianStats(
  snapshot: GuardianSnapshot,
  perfCP: number,
  bonusBp: number,
): GuardianStats {
  const p = normalizePerformance(perfCP);
  const b = normalizeLineageBonus(bonusBp);
  return {
    radius: snapshot.radius,
    hp: scaleStat(snapshot.hp, p, b),
    contactDamage: scaleStat(snapshot.contactDamage, p, b),
    fireCooldown: scaleCooldown(snapshot.fireCooldown, b),
    bulletDamage: scaleStat(snapshot.bulletDamage, p, b),
    bulletSpeed: snapshot.bulletSpeed,
    bulletRadius: snapshot.bulletRadius,
    bulletLife: snapshot.bulletLife,
    range: snapshot.range,
    moveSpeed: snapshot.moveSpeed,
    standoff: snapshot.standoff,
  };
}

/**
 * 퇴역 시 프리셋 + 전투력 점수로 **복사 스냅샷**을 만든다(ADR-0007 R8). 전투력 점수가 높을수록
 * (좋은 장비·깊은 빌드로 퇴역) 강한 수호기가 된다. hp·접촉·탄피해를 전투력 점수 비율로 스케일
 * (100=기본), 나머지 기하는 프리셋 그대로. 결정론 정수.
 */
export function makeGuardianSnapshot(preset: number, combatScore: number): GuardianSnapshot {
  const p = normalizeGuardianPreset(preset);
  const base = PRESET_BASE[p]!;
  const score = combatScore < 1 ? 1 : Math.trunc(combatScore);
  const scalePower = (v: number): number => Math.round((v * score) / 100);
  return {
    preset: p,
    radius: base.radius,
    hp: scalePower(base.hp),
    contactDamage: scalePower(base.contactDamage),
    fireCooldown: base.fireCooldown,
    bulletDamage: scalePower(base.bulletDamage),
    bulletSpeed: base.bulletSpeed,
    bulletRadius: base.bulletRadius,
    bulletLife: base.bulletLife,
    range: base.range,
    moveSpeed: base.moveSpeed,
    standoff: base.standoff,
  };
}

/**
 * 소멸(회수) 시 지급 계보 포인트 = 기본값 × 남은 성능 비율(ADR-0007 R3). 전투력 점수가 곧
 * 기본 회수가치다(좋은 빌드로 퇴역한 수호기일수록 회수 가치↑). 결정론 정수(내림 — 하향 안정).
 * 신선할 때(성능 100%) 전액, 말년(성능 50%) 절반 → "언제 회수할까" 상시 딜레마.
 */
export function dismissPoints(combatScore: number, perfCP: number): number {
  const score = combatScore < 0 ? 0 : Math.trunc(combatScore);
  const p = normalizePerformance(perfCP);
  return Math.floor((score * p) / PERFORMANCE_FULL);
}

/**
 * 전투력 점수 산식(OQ-M5-2 기본안): 장비 등급·어픽스 가치 + 스킬 빌드 깊이 종합. 순수 정수 —
 * 퇴역 시점 빌드 파생 스칼라(computeLoadoutStats 결과 등)에서 뽑은 요약값을 받아 합산한다.
 * 가중치는 밸런싱 패스에서 튜닝(계획 §5). 최소 1(공허 방지).
 *   - gearRating: 장비 등급·아이템 레벨 합(정수).
 *   - affixValue: 어픽스 가치 합(정수).
 *   - buildDepth: 스킬 투자 깊이(투자 노드 수 등, 정수).
 *   - uniqueCount: 장착 유니크 수(정수) — 질적 강도 가중.
 */
export function computeCombatScore(parts: {
  gearRating: number;
  affixValue: number;
  buildDepth: number;
  uniqueCount: number;
}): number {
  const g = Math.max(0, Math.trunc(parts.gearRating));
  const a = Math.max(0, Math.trunc(parts.affixValue));
  const d = Math.max(0, Math.trunc(parts.buildDepth));
  const u = Math.max(0, Math.trunc(parts.uniqueCount));
  const score = g + a * 2 + d * 3 + u * 25;
  return score < 1 ? 1 : score;
}
