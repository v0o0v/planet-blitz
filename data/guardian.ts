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
  // 발사 서술자(ADR-0025 — 장착 메인 무기 타입이 방어 발사체를 결정). 전부 정수(정규화 계약).
  /** 메인 무기 타입 코드(0=벌컨/1=산탄/2=레일건/3=미사일/4=빔 — src/items/loadout.ts WEAPON_*). */
  readonly weaponType: number;
  /** 산탄/미사일 팬 발수(≥1, 벌컨·레일건·빔은 1). */
  readonly bulletCount: number;
  /** 팬 각(정수 밀리라디안 — sim 발사 시 /1000; 정수 도메인 유지). 0=단발. */
  readonly spread: number;
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
  // 발사 서술자(스냅샷에서 그대로 통과 — 성능·보너스로 스케일하지 않는다, ADR-0025 §3).
  readonly weaponType: number;
  readonly bulletCount: number;
  readonly spread: number;
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
    weaponType: 0, // WEAPON_VULCAN
    bulletCount: 1,
    spread: 0,
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
    weaponType: 0, // WEAPON_VULCAN
    bulletCount: 1,
    spread: 0,
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

/** 유효 메인 무기 타입 수(src/items/loadout.ts WEAPON_VULCAN=0 .. WEAPON_BEAM=4). */
export const GUARDIAN_WEAPON_TYPE_COUNT = 5;

/**
 * 메인 무기 타입 코드를 [0, {@link GUARDIAN_WEAPON_TYPE_COUNT})로 정규화한다(범위 밖·비유한은
 * 벌컨=0 폴백 — 손상 스냅샷이 sim 발사 분기에서 undefined 스펙을 타는 것을 막는다).
 */
export function normalizeGuardianWeaponType(weaponType: number): number {
  if (!Number.isFinite(weaponType)) return 0;
  const w = Math.trunc(weaponType);
  return w >= 0 && w < GUARDIAN_WEAPON_TYPE_COUNT ? w : 0;
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
    // 발사 서술자는 발사체 정체성이라 성능·보너스로 스케일하지 않고 그대로 통과(ADR-0025 §3).
    weaponType: snapshot.weaponType,
    bulletCount: snapshot.bulletCount,
    spread: snapshot.spread,
  };
}

// ---------------------------------------------------------------------------
// 마일스톤 질적 노드 효과 수치(GDD §4 · ADR-0007) — 순수 결정론 정수 함수.
// 해금 여부는 data/lineage.ts guardianMilestones(레벨)이 판정하고 방어전 config 로 실린다.
// 여기(data/ 층)는 "해금됐을 때 얼마나 강해지는가"의 순수 수치 해석만 담아 클라·서버가 공유한다.
// ---------------------------------------------------------------------------

/** 격추 재기동: 부활 HP 비율(basis-point, 5000=50%). 부활 직후 실효 최대 HP 대비. 튜닝 대상(§5). */
export const REBOOT_HP_BP = 5000;
/** 격추 재기동: 부활 후 재기동 딜레이(틱, 90=1.5초). 이 동안 무적·정지(이동·사격 안 함). */
export const REBOOT_DELAY_TICKS = 90;

/** 코어 근접 수비: 이 반경(월드 유닛) 내에서 강화. 튜닝 대상(§5). */
export const CORE_GUARD_RADIUS = 420;
/** 코어 근접 수비: 피해 강화(basis-point, 3000=+30%). 탄피해·접촉피해에 적용. */
export const CORE_GUARD_DAMAGE_BP = 3000;

/** 실드 공유: 코어 실드 = 수호 전투력 풀 × 이 비율(basis-point, 5000=50%). */
export const SHIELD_SHARE_CORE_BP = 5000;
/** 실드 공유: 포탑 1기 실드 = 수호 전투력 풀 × 이 비율(basis-point, 1000=10%). */
export const SHIELD_SHARE_TURRET_BP = 1000;

/**
 * 부활 HP(결정론 정수) = 실효 최대 HP × {@link REBOOT_HP_BP}. 최소 1(0 부활 금지). 단일 나눗셈
 * + Math.round 라 플랫폼 무관. maxHp 는 resolveGuardianStats 가 낸 정수 실효값이다.
 */
export function rebootHp(maxHp: number): number {
  const v = Math.round((maxHp * REBOOT_HP_BP) / 10000);
  return v < 1 ? 1 : v;
}

/**
 * 코어 근접 강화 피해(결정론 정수) = base × (1 + {@link CORE_GUARD_DAMAGE_BP}). scaleStat 과 동일
 * 산술 규율(단일 나눗셈 + Math.round). base 는 이미 성능·보너스가 적용된 정수 실효 피해다.
 */
export function coreGuardDamage(base: number): number {
  return Math.round((base * (10000 + CORE_GUARD_DAMAGE_BP)) / 10000);
}

/**
 * 코어 근접 강화 발사 간격(결정론 정수) = round(base × 10000 / (10000+bp)) — 연사↑. scaleCooldown
 * 과 동일 규율(최소 2틱 보장 — 0 나눗셈·즉발 폭주 방지).
 */
export function coreGuardCooldown(base: number): number {
  const v = Math.round((base * 10000) / (10000 + CORE_GUARD_DAMAGE_BP));
  return v < 2 ? 2 : v;
}

/**
 * 실드 공유 풀 → 코어·포탑 1기당 실드 HP(결정론 정수 내림). pool 은 참전 수호들의 실효 HP 합
 * (전투력 비례). bp 로 코어/포탑 몫을 나눈다. 음수 풀은 0.
 */
export function shieldShareHp(pool: number, bp: number): number {
  const p = pool < 0 ? 0 : pool;
  return Math.floor((p * bp) / 10000);
}

// ---------------------------------------------------------------------------
// 실물 빌드 loadout → 방어 스냅샷 파생 (ADR-0025) — 순수 결정론 정수 매핑.
//
// 프리셋은 이동 AI(radius/moveSpeed/standoff)만, 파워·발사 기하는 아래 universal base × loadout
// 배율, 발사체 정체성은 weaponType/bulletCount/spread 로 실린다. 아래 base 계수는 전부 **밸런스
// placeholder**(출시 전 일괄 튜닝 이월 — defer-balance-tuning)이며, ADR-0025 는 어느 축이
// preset/loadout/universal 에서 오는지의 **구조**만 확정한다.
// ---------------------------------------------------------------------------

/** 플레이어 기준 HP(loadout.maxHpAdd 가 가산되는 기준 — src/items/loadout.ts BASE_HP_REF 와 동일). */
const PLAYER_BASE_HP = 100;
/** 수호 HP = 플레이어 실효 HP × 이 계수(수호는 정지 방어체라 플레이어보다 튼튼). placeholder. */
const GUARDIAN_HP_PER_PLAYER_HP = 3;
/** 접촉(램) 피해 universal base(× damageMult). placeholder. */
const GUARDIAN_BASE_CONTACT_DAMAGE = 20;
/** 발당 탄피해 universal base(× damageMult). placeholder. */
const GUARDIAN_BASE_BULLET_DAMAGE = 16;
/** 발사 간격(틱) universal base(× fireRateMult — >1=느림, <1=빠름). placeholder. */
const GUARDIAN_BASE_FIRE_COOLDOWN = 36;
/** 탄속(유닛/초) universal base(× bulletSpeedMult). placeholder. */
const GUARDIAN_BASE_BULLET_SPEED = 1200;
/** 탄 반지름 universal base. placeholder. */
const GUARDIAN_BASE_BULLET_RADIUS = 10;
/** 탄 수명(틱) universal base. placeholder. */
const GUARDIAN_BASE_BULLET_LIFE = 100;
/** 조준·발사 사거리 universal base(+ rangeAdd). placeholder. */
const GUARDIAN_BASE_RANGE = 1000;
/** 산탄 팬 펠릿 수 상한(병리적 빌드의 탄 폭주로 성능·bulletCap 파괴 방어). */
const MAX_GUARDIAN_BULLET_COUNT = 12;
/** 팬 각 상한(밀리라디안, π ≈ 3142 — 전방위 초과 방지). */
const MAX_GUARDIAN_SPREAD_MRAD = 3142;

/**
 * {@link mapLoadoutToGuardianSnapshot}가 읽는 loadout 부분집합. `LoadoutConfig`(src/sim/world.ts)가
 * 이 필드들을 전부 가지므로 **구조적으로 만족**한다 — data/ 층이 sim 을 import 하지 않게 하려는
 * 의도적 최소 계약(파일 머리말의 순수성 규율). 상위(save 층)가 computeLoadoutStats 결과를 넘긴다.
 */
export interface GuardianLoadoutInput {
  readonly weaponType: number;
  readonly damageMult: number;
  readonly fireRateMult: number;
  readonly bulletCountAdd: number;
  readonly bulletSpeedMult: number;
  readonly spreadAdd: number;
  readonly rangeAdd: number;
  readonly maxHpAdd: number;
}

/** 안전 유한화(비유한 → 폴백). */
function finiteOr(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

/** 산탄 팬 발수 = 1 + bulletCountAdd, [1, {@link MAX_GUARDIAN_BULLET_COUNT}] 클램프(정수). */
function clampGuardianBulletCount(bulletCountAdd: number): number {
  const add = Number.isFinite(bulletCountAdd) ? Math.trunc(bulletCountAdd) : 0;
  const n = 1 + (add > 0 ? add : 0);
  return n > MAX_GUARDIAN_BULLET_COUNT ? MAX_GUARDIAN_BULLET_COUNT : n;
}

/** 팬 각 → 정수 밀리라디안 [0, {@link MAX_GUARDIAN_SPREAD_MRAD}](스냅샷 정수 도메인 유지). */
function clampGuardianSpreadMrad(spreadAdd: number): number {
  if (!Number.isFinite(spreadAdd) || spreadAdd <= 0) return 0;
  const mr = Math.round(spreadAdd * 1000);
  return mr > MAX_GUARDIAN_SPREAD_MRAD ? MAX_GUARDIAN_SPREAD_MRAD : mr;
}

/**
 * 실물 빌드 loadout → 방어 스냅샷(ADR-0025 — "한 기체 = 한 스펙"의 방어측 파생). 순수 결정론
 * 정수 매핑이라 클라(Node)·서버(Deno) 재실행이 비트 동일하다(단일 나눗셈 + Math.round).
 *
 * - **프리셋(이동 AI):** radius·moveSpeed·standoff 는 {@link PRESET_BASE}[preset] 에서.
 * - **파워:** hp(maxHpAdd)·접촉/탄피해(damageMult)·발사간격(fireRateMult)·탄속(bulletSpeedMult)·
 *   사거리(rangeAdd)는 universal base × loadout 배율.
 * - **발사체:** weaponType·bulletCount·spread 는 loadout 에서(무기 아키타입 복제 서술자).
 *
 * ⚠️ 모든 반환 필드는 유한 정수여야 한다 — normalize.ts `normalizeGuardianPlacement` 가 non-finite
 * 필드를 만나면 슬롯을 통째로 null 로 버려 방어 수호가 소실된다. standoff 는 range 이내로 클램프해
 * "사거리 밖에서 멈춰 영영 무발사" 를 막는다.
 */
export function mapLoadoutToGuardianSnapshot(
  preset: number,
  loadout: GuardianLoadoutInput,
): GuardianSnapshot {
  const p = normalizeGuardianPreset(preset);
  const beh = PRESET_BASE[p]!;
  const dmg = finiteOr(loadout.damageMult, 1);
  const fr = finiteOr(loadout.fireRateMult, 1);
  const bs = finiteOr(loadout.bulletSpeedMult, 1);
  const playerHp = PLAYER_BASE_HP + finiteOr(loadout.maxHpAdd, 0);
  const range = Math.max(1, Math.round(GUARDIAN_BASE_RANGE + finiteOr(loadout.rangeAdd, 0)));
  return {
    preset: p,
    radius: beh.radius,
    hp: Math.max(1, Math.round(playerHp * GUARDIAN_HP_PER_PLAYER_HP)),
    contactDamage: Math.max(0, Math.round(GUARDIAN_BASE_CONTACT_DAMAGE * dmg)),
    fireCooldown: Math.max(2, Math.round(GUARDIAN_BASE_FIRE_COOLDOWN * fr)),
    bulletDamage: Math.max(0, Math.round(GUARDIAN_BASE_BULLET_DAMAGE * dmg)),
    bulletSpeed: Math.max(1, Math.round(GUARDIAN_BASE_BULLET_SPEED * bs)),
    bulletRadius: GUARDIAN_BASE_BULLET_RADIUS,
    bulletLife: GUARDIAN_BASE_BULLET_LIFE,
    range,
    moveSpeed: beh.moveSpeed,
    standoff: Math.min(beh.standoff, range),
    weaponType: normalizeGuardianWeaponType(loadout.weaponType),
    bulletCount: clampGuardianBulletCount(loadout.bulletCountAdd),
    spread: clampGuardianSpreadMrad(loadout.spreadAdd),
  };
}

/**
 * 프리셋 + 전투력 점수로 **합성 스냅샷**을 만든다(단발 벌컨 발사체). hp·접촉·탄피해를 전투력
 * 점수 비율로 스케일(100=기본), 나머지 기하·발사서술자는 프리셋 그대로. 결정론 정수.
 *
 * ⚠️ ADR-0025 이후 **프로덕션 퇴역 경로는 {@link mapLoadoutToGuardianSnapshot}(실물 빌드 파생)** 를
 * 쓴다. 이 함수는 실물 빌드가 없는 **하네스·벤치·검증 fixture 의 합성 수호** 생성 전용으로 남는다
 * (전투력 점수만으로 임의 강도의 수호가 필요한 dev/test 경로).
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
    weaponType: base.weaponType,
    bulletCount: base.bulletCount,
    spread: base.spread,
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

// 전투력 점수 산식은 src/save/combatPower.ts(totalCombatPower — 장비 등급·어픽스 가치)를
// 단일 정본으로 재사용한다. 퇴역 전투력은 그 값 + 스킬 빌드 깊이를 src/save/guardianLifecycle.ts
// 가 합산한다(빌드 종합, OQ-M5-2). 여기 data/ 층은 순수 스탯 해석만 담아 중복을 피한다.
