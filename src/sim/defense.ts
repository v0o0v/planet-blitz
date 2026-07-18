/**
 * 침공 방어 배치 — 방어 엔티티(포탑 6종·코어)와 결정론 거동 (M4 plan Phase C1/C2).
 *
 * 갈림길③A(계획 §2): 방어 배치(포탑·장애물·코어)는 침공 런 config의 **정적 스폰 데이터**다.
 * createWorld가 이 데이터로 방어 엔티티를 스폰하면, 침공은 PvE와 동일한 결정론 시뮬 코어에
 * 방어 엔티티를 더한 런이 되어 서버가 [시드+입력+config]로 전수 재실행할 수 있다(ADR-0005).
 *
 * 결정론(ADR-0005): 포탑 거동은 위치·타이머의 순수 함수다. RNG를 뽑지 않으며 wall-clock을
 * 읽지 않는다. 조준각은 결정론 math(atan2/cos/sin), 발사 판정은 사거리·엔티티 배열 순서·벽
 * LOS(segmentBlocked)로만 결정한다. 상태이상(냉기)·미사일(제한 선회 유도)은 M3 산출물을
 * 그대로 재사용한다(status.ts의 HAZARD_SLOW 감속 지대, bullets.ts의 BK_HOMING).
 *
 * 필드 재활용(entities.ts Entity 플랫 구조 — 신규 Entity 필드 없음, hashEntity 레이아웃 불변):
 *   - defenseTurret: `enemyType` = 포탑 유형(0..5), `cooldown` = 발사 쿨다운 카운트다운,
 *     `hp/maxHp` = 내구도, `radius` = 히트박스. 조준은 매 틱 플레이어 위치로 재계산(무상태).
 *   - core: `hp/maxHp` = 코어 내구도, `radius` = 히트박스. 파괴(hp<=0) 시 compact가 victory.
 *   - 장애물: 기존 `wall` kind 재사용(계획 §C1 "기존 벽 메커닉 재사용"). spawnWall이 이동·탄·
 *     LOS 차단을 모두 제공하므로 신규 차단 코드가 없다.
 *
 * 이 모듈은 sim 리프에 가깝다: 런타임 의존은 entities/bullets/math/patterns(HAZARD_SLOW 상수)/
 * los 뿐이고, WorldState는 **type-only** import(status.ts와 동일 규율)라 world ↔ defense 런타임
 * 사이클이 없다.
 */

import type { WorldState } from './world.js';
import type { Entity, EntitySink } from './entities.js';
import { blankEntity, addEntity, spawnEnemyBullet, spawnHazard, spawnWall } from './entities.js';
import { applyBehavior, homingBehavior } from './bullets.js';
import { HAZARD_SLOW } from './patterns/types.js';
import { atan2, cos, sin, length } from './math.js';
import { segmentBlocked } from './los.js';
import { DT } from './constants.js';
import {
  resolveGuardianStats,
  normalizeGuardianPreset,
  MAX_GUARDIAN_SLOTS,
  coreGuardDamage,
  coreGuardCooldown,
  shieldShareHp,
  CORE_GUARD_RADIUS,
  SHIELD_SHARE_CORE_BP,
  SHIELD_SHARE_TURRET_BP,
} from '../../data/guardian.js';
import type { GuardianSnapshot, GuardianStats } from '../../data/guardian.js';
import {
  normalizeMilestones,
  hasMilestone,
  MILESTONE_REBOOT,
  MILESTONE_CORE_GUARD,
  MILESTONE_SHIELD_SHARE,
} from '../../data/lineage.js';

// ---------------------------------------------------------------------------
// 포탑 유형 코드 (defenseTurret.enemyType 에 저장; 절대 재번호 금지 — 배치 JSON 계약)
// ---------------------------------------------------------------------------
/** ① 발칸: 단일 연사 기본. */
export const TURRET_VULCAN = 0;
/** ② 저격: 장거리 고피해 저속(연사 느림·탄속 빠름·고피해). */
export const TURRET_SNIPER = 1;
/** ③ 산탄: 근거리 부채꼴 다발. */
export const TURRET_SHOTGUN = 2;
/** ④ 감속: 냉기장 — 플레이어 위치에 감속 장판(HAZARD_SLOW) 융기(M3 감속 재사용). */
export const TURRET_FROST = 3;
/** ⑤ 미사일: 제한 선회 유도(M3 BK_HOMING 재사용). */
export const TURRET_MISSILE = 4;
/** ⑥ 전격: 연쇄 다수 약공(부채꼴 고속 약탄 다발). */
export const TURRET_TESLA = 5;
/** 확정된 포탑 유형 수(§8 OQ-M4-1 확정). */
export const TURRET_TYPE_COUNT = 6;

/**
 * 포탑 1종의 스펙. 밸런스 표(계획 §5) 기준 **초기 추정값** — 코어 방어 vs 침공 3분 제한의
 * 균형은 M5 밸런싱 패스에서 확정한다(주석의 값은 튜닝 대상). 필드가 모든 유형에 다 쓰이지는
 * 않는다(미사용은 0). `cost`는 방어 배치 에디터(C3)의 배치 포인트 예산제가 읽는다.
 */
export interface TurretSpec {
  /** 유형 이름(디버그·에디터 라벨). */
  readonly name: string;
  /** 배치 포인트 비용(에디터 예산제, 계획 §5 — 전원 동일 예산에서 차감). */
  readonly cost: number;
  /** 내구도(플레이어 탄에 파괴됨). */
  readonly hp: number;
  /** 히트박스 반지름(월드 유닛). */
  readonly radius: number;
  /** 조준 사거리(유닛). 이 밖의 플레이어는 무시(발사 보류). */
  readonly range: number;
  /** 발사 간격(틱). 클수록 저속 연사. */
  readonly fireCooldown: number;
  /** 발당 피해(감속 포탑은 장판 피해). */
  readonly damage: number;
  /** 탄속(유닛/초). 감속 포탑은 미사용(0). */
  readonly bulletSpeed: number;
  /** 탄 반지름. */
  readonly bulletRadius: number;
  /** 탄 수명(틱). */
  readonly bulletLife: number;
  /** 부채꼴 발수(산탄·전격; 그 외 1). */
  readonly pellets: number;
  /** 부채꼴 총 벌어짐(라디안; 산탄·전격). */
  readonly spread: number;
  /** 감속 장판 반지름(감속 포탑 전용; 그 외 0). */
  readonly hazardRadius: number;
  /** 감속 장판 예열 틱(감속 포탑 전용). */
  readonly hazardWindup: number;
  /** 감속 장판 활성 틱(감속 포탑 전용). */
  readonly hazardActive: number;
  /** 유도 락 지속 틱(미사일 포탑 전용; 그 외 0). */
  readonly lockTicks: number;
  /** 유도 최대 선회율(라디안/틱; 미사일 포탑 전용). */
  readonly turnRate: number;
}

/**
 * 포탑 6종 스펙 테이블. 인덱스 = 유형 코드(TURRET_*). **초기 밸런스 추정값**(계획 §5,
 * 튜닝 대상). 모두 결정론 정수/고정 실수라 플랫폼 무관.
 */
export const TURRET_SPECS: readonly TurretSpec[] = [
  // ① 발칸: 기본 연사. 중피해·중사거리·빠른 연사.
  {
    name: 'vulcan',
    cost: 1,
    hp: 240,
    radius: 34,
    range: 820,
    fireCooldown: 12,
    damage: 6,
    bulletSpeed: 1200,
    bulletRadius: 8,
    bulletLife: 70,
    pellets: 1,
    spread: 0,
    hazardRadius: 0,
    hazardWindup: 0,
    hazardActive: 0,
    lockTicks: 0,
    turnRate: 0,
  },
  // ② 저격: 장거리·고피해·저속 연사·빠른 탄속·얇은 탄.
  {
    name: 'sniper',
    cost: 3,
    hp: 200,
    radius: 32,
    range: 1500,
    fireCooldown: 90,
    damage: 30,
    bulletSpeed: 2400,
    bulletRadius: 6,
    bulletLife: 90,
    pellets: 1,
    spread: 0,
    hazardRadius: 0,
    hazardWindup: 0,
    hazardActive: 0,
    lockTicks: 0,
    turnRate: 0,
  },
  // ③ 산탄: 근거리 부채꼴 다발. 짧은 사거리·중간 연사.
  {
    name: 'shotgun',
    cost: 2,
    hp: 300,
    radius: 36,
    range: 560,
    fireCooldown: 40,
    damage: 5,
    bulletSpeed: 1000,
    bulletRadius: 7,
    bulletLife: 42,
    pellets: 6,
    spread: 0.9,
    hazardRadius: 0,
    hazardWindup: 0,
    hazardActive: 0,
    lockTicks: 0,
    turnRate: 0,
  },
  // ④ 감속: 냉기장. 플레이어 위치에 HAZARD_SLOW 장판(M3 감속 재사용). 소량 피해.
  {
    name: 'frost',
    cost: 2,
    hp: 220,
    radius: 34,
    range: 900,
    fireCooldown: 100,
    damage: 2,
    bulletSpeed: 0,
    bulletRadius: 0,
    bulletLife: 0,
    pellets: 0,
    spread: 0,
    hazardRadius: 240,
    hazardWindup: 30,
    hazardActive: 150,
    lockTicks: 0,
    turnRate: 0,
  },
  // ⑤ 미사일: 제한 선회 유도(M3 BK_HOMING). 중피해·저속 연사.
  {
    name: 'missile',
    cost: 3,
    hp: 220,
    radius: 34,
    range: 1200,
    fireCooldown: 75,
    damage: 18,
    bulletSpeed: 720,
    bulletRadius: 12,
    bulletLife: 180,
    pellets: 1,
    spread: 0,
    hazardRadius: 0,
    hazardWindup: 0,
    hazardActive: 0,
    lockTicks: 150,
    turnRate: 0.05,
  },
  // ⑥ 전격: 연쇄 다수 약공. 부채꼴 고속 약탄 다발·빠른 연사.
  {
    name: 'tesla',
    cost: 2,
    hp: 200,
    radius: 32,
    range: 700,
    fireCooldown: 30,
    damage: 3,
    bulletSpeed: 1900,
    bulletRadius: 5,
    bulletLife: 40,
    pellets: 4,
    spread: 0.5,
    hazardRadius: 0,
    hazardWindup: 0,
    hazardActive: 0,
    lockTicks: 0,
    turnRate: 0,
  },
];

// ---------------------------------------------------------------------------
// 코어 + 제한 시간
// ---------------------------------------------------------------------------
/** 코어 내구도(침공 목표). 초기 추정값(계획 §5, 튜닝 대상). */
export const CORE_HP = 3000;
/** 코어 히트박스 반지름. */
export const CORE_RADIUS = 90;
/** 코어 배치 비용(에디터 예산제 — 코어는 필수 1개, 참고용). */
export const CORE_COST = 0;
/** 장애물(벽) 1개 배치 비용(에디터 예산제). */
export const OBSTACLE_COST = 1;

/** 침공 제한 시간: 3분(GDD §8) = 180초 × 60틱. */
export const DEFAULT_TIME_LIMIT_TICKS = 180 * 60;

// ---------------------------------------------------------------------------
// 방어 배치 직렬화 계약 (defenses 테이블 layout 컬럼 · C3 에디터 입출력)
// ---------------------------------------------------------------------------
/** 포탑 1기의 배치 데이터. `type`은 TURRET_* 코드. */
export interface TurretPlacement {
  type: number;
  x: number;
  y: number;
}
/** 장애물(벽) 1개의 배치 데이터. AABB 반폭/반높이(spawnWall 규약과 동일). */
export interface ObstaclePlacement {
  x: number;
  y: number;
  halfW: number;
  halfH: number;
}
/** 코어 1개의 배치 데이터(침공 목표, 배치당 1개). */
export interface CorePlacement {
  x: number;
  y: number;
}
/**
 * 방어 배치 전체(직렬화 JSON). `defenses.layout` 컬럼과 C3 에디터가 주고받는 계약이다.
 * `guardianSlots`는 M5 수호 기체 슬롯 자리(OQ-M4-4 — 이번 마일스톤 비활성, 계약 안정용 예약).
 */
/**
 * 방어 배치 수호 기체 1기(M5 plan A1, ADR-0007). 방어전 config 에 **스냅샷 + 남은 성능% +
 * 계보 보너스**를 실어(갈림길①A), 클라이언트와 서버가 동일 결정론 함수(resolveGuardianStats)로
 * 비트 동일한 실효 스탯을 재현한다. 좌표(x/y)는 배치 위치(포탑처럼 방어자가 정한다). 위조 방어는
 * 서버가 권위 스냅샷·성능·보너스로 재해석해 hashStream 이 갈려 거부한다(EF 배선 계층 책임).
 */
export interface GuardianPlacement {
  x: number;
  y: number;
  /** 퇴역 복사 스냅샷(기본 전투 스탯). */
  snapshot: GuardianSnapshot;
  /** 남은 성능%(centi-percent, 풍화 반영). 미지정 = 완전 성능. */
  performanceCP: number;
  /** 계보 수호 가지 보너스(basis-point, 0..5000). 미지정 = 0. */
  lineageBonusBp: number;
  /**
   * 계보 수호 가지 마일스톤 비트마스크(data/lineage.ts MILESTONE_*). 레벨 도달로 자동 해금된
   * 질적 노드(격추 재기동·코어 근접 수비·실드 공유)를 **명시 config 필드**로 실어 sim 이 profile
   * 을 읽지 않고 재현하게 한다(lineageBonusBp 와 동일 철학 — 서버 리플레이 검증 가능). 미지정 =
   * 0(마일스톤 없음 = 기존 거동·해시 완전 불변, append-only 하위 호환).
   */
  milestones?: number;
}

export interface DefenseLayout {
  core: CorePlacement;
  turrets: TurretPlacement[];
  obstacles: ObstaclePlacement[];
  /**
   * M5 수호 기체(동시 최대 {@link MAX_GUARDIAN_SLOTS}기, ADR-0007). 존재하고 비어있지 않을 때만
   * 방어전에 참전한다 → 이 필드가 없거나 빈 배열인 기존 침공/PvE 런은 거동·해시가 완전히 불변
   * (append-only 안전, hashWorld 조건부 접기). 상한 초과분은 스폰에서 잘린다.
   */
  guardians?: GuardianPlacement[];
  /** (구) M5 수호 기체 슬롯 예약 자리 — guardians 로 대체됨. 서버 정규화가 드롭한다. */
  guardianSlots?: unknown[];
}
/**
 * 침공 런 설정(WorldConfig.invasion). 방어 배치 + 제한 시간. 존재하면 침공 런, 없으면 기존
 * PvE 런(거동·해시 100% 불변).
 */
export interface InvasionConfig {
  layout: DefenseLayout;
  /** 제한 시간(틱). 기본 {@link DEFAULT_TIME_LIMIT_TICKS}(3분). */
  timeLimitTicks: number;
  /**
   * 방어 정비도(풍화, ADR-0006) — **정수 centi-percent**(0..{@link MAINTENANCE_FULL}=10000).
   * 10000 = 100.00%(완전 정비), 0 = 0.00%(완전 방치). DB `defenses.maintenance`(numeric(5,2),
   * 0~100)를 ×100 정수로 실어 f64 오차 원천을 차단한다(정수 basis-point 표현). 미지정 시
   * {@link MAINTENANCE_FULL}(완전 정비)로 정규화 → 이 필드가 없던 기존 침공 런과 거동·해시가
   * 완전히 동일하다(append-only 안전). 정비도가 낮을수록 포탑 성능(발사 빈도)이 떨어진다:
   * 100%→성능 100%, 0%→성능 50%(선형). {@link scaleFireCooldown} 참조.
   */
  maintenance?: number;
}

// ---------------------------------------------------------------------------
// 정비도(풍화, ADR-0006) — 결정론 정수 표현 + 포탑 성능 스케일
// ---------------------------------------------------------------------------
/**
 * 완전 정비 = 100.00% 를 나타내는 정수 centi-percent 상한. DB numeric(5,2) 를 ×100 한
 * 정수 도메인이라 f64 누적 오차가 없다(플랫폼 무관 결정론).
 */
export const MAINTENANCE_FULL = 10000;

/**
 * 정비도 값을 결정론 정수 도메인[0, {@link MAINTENANCE_FULL}]으로 정규화한다. 미지정·비유한
 * (undefined/NaN/Infinity)은 완전 정비로 본다. EF 가 DB numeric×100 정수를 주입하는 것이
 * 정상 경로지만, 소수·범위 밖 값이 흘러들어도 여기서 정수화·클램프해 sim 과 hashWorld 가
 * **동일한** 정규값을 쓰도록 강제한다(거동 ↔ 해시 정합). 정수화는 Math.trunc(내림이 아니라
 * 0 방향 절삭 — 음수는 어차피 0으로 클램프되므로 결과 동일).
 */
export function normalizeMaintenance(maintenance: number | undefined): number {
  if (maintenance === undefined || !Number.isFinite(maintenance)) return MAINTENANCE_FULL;
  const i = Math.trunc(maintenance);
  if (i <= 0) return 0;
  if (i >= MAINTENANCE_FULL) return MAINTENANCE_FULL;
  return i;
}

/**
 * 정비도 → 포탑 실효 발사 간격(틱). ADR-0006: 정비 100%→성능 100%, 0%→성능 50%(선형).
 * "성능"은 발사 빈도로 구현한다 — 성능 50%면 발사 간격이 2배(연사 절반)라 DPS 가 절반이 된다.
 * 다른 스칼라(피해)는 충돌 판정 f64 산술에 섞여 오차 위험이 있어 건드리지 않고, **정수 연산만**
 * 쓰는 발사 간격 하나로 성능을 균일하게 스케일한다(모든 포탑 유형에 일괄 적용, 감속 장판 포탑의
 * 재융기 주기까지 포함).
 *
 * 결정론: 성능 분수 = (10000 + m) / 20000 (m=10000→1.0, m=0→0.5). 실효 간격 = round(base / perf)
 * = round(base × 20000 / (10000 + m)). 분자·분모 모두 정확한 정수(2^53 미만: base≤수백,
 * base×20000≤수백만)이고, 나눗셈은 IEEE-754 correctly-rounded 단일 연산 + Math.round 뿐이라
 * Node(클라)·Deno(서버) V8 에서 비트 동일하다. 완전 정비(m=10000)는 base 를 그대로 반환해
 * 정비도 필드가 없던 기존 침공 런과 완전히 동일한 간격을 낸다(회귀 0).
 */
export function scaleFireCooldown(baseCooldown: number, maintenance: number): number {
  const m = normalizeMaintenance(maintenance);
  if (m === MAINTENANCE_FULL) return baseCooldown;
  return Math.round((baseCooldown * 20000) / (10000 + m));
}

// ---------------------------------------------------------------------------
// 스폰
// ---------------------------------------------------------------------------
/**
 * 방어 포탑 1기를 스폰(유형별 스펙으로 내구도·반지름·초기 발사 지연 세팅). 초기 발사 지연
 * (스폰 즉발 방지)도 정비도로 스케일해, 방치된 기지는 첫 발사부터 느려진다(성능 저하 일관).
 */
export function spawnDefenseTurret(
  sink: EntitySink,
  type: number,
  x: number,
  y: number,
  maintenance: number = MAINTENANCE_FULL,
): Entity {
  // 범위 밖 type(정상 경로에서는 도달 불가 — 배치 데이터는 항상 검증된 유형만 담는다)은
  // 발칸으로 폴백한다. spec뿐 아니라 저장하는 유형 코드도 함께 폴백해야 한다 — 그러지
  // 않으면 spec은 발칸인데 enemyType은 원래의 잘못된 값으로 남아, stepDefenseTurrets가
  // `TURRET_SPECS[t.enemyType]`을 다시 조회할 때 undefined를 만나 영구 무발사 엔티티가 된다.
  const validType = TURRET_SPECS[type] !== undefined ? type : TURRET_VULCAN;
  const spec = TURRET_SPECS[validType]!;
  const t = blankEntity('defenseTurret');
  t.x = x;
  t.y = y;
  t.enemyType = validType; // 유형 코드(렌더 분화 + 스텝 디스패치) — spec과 항상 일치
  t.radius = spec.radius;
  t.hp = spec.hp;
  t.maxHp = spec.hp;
  // 초기 발사 지연(스폰 즉발 방지)을 정비도로 스케일. 완전 정비면 spec 그대로(회귀 0).
  t.cooldown = scaleFireCooldown(spec.fireCooldown, maintenance);
  return addEntity(sink, t);
}

/** 방어 코어를 스폰(침공 목표). */
export function spawnCore(sink: EntitySink, x: number, y: number): Entity {
  const c = blankEntity('core');
  c.x = x;
  c.y = y;
  c.radius = CORE_RADIUS;
  c.hp = CORE_HP;
  c.maxHp = CORE_HP;
  return addEntity(sink, c);
}

/**
 * 방어 배치 전체를 스폰: 코어 → 포탑(배열 순서) → 장애물(wall). 순서는 배치 데이터로 완전
 * 결정되므로 재현이 자명하다. 플레이어는 호출 전에 이미 index 0에 있어야 한다(hashWorld는
 * index 0에 player가 있음을 불변식으로 가정).
 */
export function spawnInvasionLayout(
  sink: EntitySink,
  layout: DefenseLayout,
  maintenance: number = MAINTENANCE_FULL,
): void {
  const core = spawnCore(sink, layout.core.x, layout.core.y);
  const turrets: Entity[] = [];
  for (const t of layout.turrets) turrets.push(spawnDefenseTurret(sink, t.type, t.x, t.y, maintenance));
  for (const o of layout.obstacles) spawnWall(sink, o.x, o.y, o.halfW, o.halfH);
  // M5 수호 기체(동시 최대 MAX_GUARDIAN_SLOTS): 코어·포탑·장애물 뒤에 스폰(배열 순서 = 결정론
  // 입력). 없거나 빈 배열이면 아무것도 안 함 → 기존 런 거동·해시 불변. 상한 초과분은 자른다.
  const guardians = layout.guardians;
  if (guardians !== undefined) {
    const n = guardians.length < MAX_GUARDIAN_SLOTS ? guardians.length : MAX_GUARDIAN_SLOTS;
    for (let i = 0; i < n; i++) spawnGuardian(sink, guardians[i]!, i);
    // 마일스톤 ③ 실드 공유: 참전 수호가 이 마일스톤을 갖고 있으면 방어전 시작 시 코어·포탑에
    // 전투력 비례 실드를 부여한다(스폰 직후 1회, 결정론 정수). 풀 = 참전 수호들의 실효 HP 합.
    applyShieldShare(core, turrets, guardians, n);
  }
}

/**
 * 마일스톤 ③ 실드 공유(방어전 시작 1회): 참전 수호 중 하나라도 {@link MILESTONE_SHIELD_SHARE}
 * 를 갖고 있으면, 참전 수호들의 실효 HP 합(전투력 풀)에 비례한 실드 HP 를 코어·각 포탑에
 * 부여한다. 실드는 엔티티 `targetY`(float 해시 필드 — 코어·포탑 미사용)에 실려, 아군탄 피해를
 * HP 보다 먼저 흡수한다(world.ts resolveCollisions). 마일스톤 미보유·수호 미참전이면 아무것도
 * 하지 않아 `targetY`=0 이 유지되어 기존 해시가 완전 불변이다(하위 호환).
 */
function applyShieldShare(
  core: Entity,
  turrets: readonly Entity[],
  placements: readonly GuardianPlacement[],
  n: number,
): void {
  let anyShield = false;
  let pool = 0;
  for (let i = 0; i < n; i++) {
    const p = placements[i]!;
    if (hasMilestone(normalizeMilestones(p.milestones), MILESTONE_SHIELD_SHARE)) anyShield = true;
    const stats = resolveGuardianStats(p.snapshot, p.performanceCP, p.lineageBonusBp);
    pool += stats.hp;
  }
  if (!anyShield) return;
  core.targetY = shieldShareHp(pool, SHIELD_SHARE_CORE_BP);
  const turretShield = shieldShareHp(pool, SHIELD_SHARE_TURRET_BP);
  for (const t of turrets) t.targetY = turretShield;
}

// ---------------------------------------------------------------------------
// 수호 기체(M5 plan A1, ADR-0007) — 추적형 요격 유닛(결정론)
// ---------------------------------------------------------------------------
/**
 * 수호 기체 1기 스폰. 실효 스탯을 스냅샷 × 성능 × 계보 보너스로 해석(resolveGuardianStats)해
 * 내구도·반지름·접촉피해를 세팅한다. 발사 스탯(탄피해·간격 등)은 스텝에서 매 틱 동일 함수로
 * 재해석하므로 여기선 초기 발사 지연만 실효 간격으로 준다(스폰 즉발 방지·성능 저하 일관).
 *
 * 필드 재활용(플랫 Entity 구조 — 신규 hash 필드 없음):
 *   - enemyType = 프리셋(0 타이탄/1 인터셉터, 렌더 분화)
 *   - pierce    = 슬롯 인덱스(layout.guardians 조회 키; 스텝이 성능·보너스 재해석에 사용)
 *   - hp/maxHp/radius/damage(접촉) = 스폰 시 해석값, angle = 조준각(스텝에서 갱신)
 */
export function spawnGuardian(sink: EntitySink, p: GuardianPlacement, slotIndex: number): Entity {
  const stats = resolveGuardianStats(p.snapshot, p.performanceCP, p.lineageBonusBp);
  const g = blankEntity('guardian');
  g.x = p.x;
  g.y = p.y;
  g.enemyType = normalizeGuardianPreset(p.snapshot.preset);
  g.pierce = slotIndex; // layout.guardians 조회 키(스텝에서 동일 스탯 재해석)
  g.radius = stats.radius;
  g.hp = stats.hp;
  g.maxHp = stats.hp;
  g.damage = stats.contactDamage;
  g.cooldown = stats.fireCooldown; // 초기 발사 지연(즉발 방지)
  // 마일스톤 ① 격추 재기동: 해금 시 부활 충전 1회를 phase 에 싣는다(0=미해금/소진). 부활 딜레이
  // 카운트다운은 iframes 를 재활용한다(수호는 평소 iframes 미사용). 두 필드 모두 hashEntity 가
  // 접으므로 마일스톤 미해금이면 0 이 유지되어 기존 해시가 완전 불변이다(하위 호환).
  g.phase = hasMilestone(normalizeMilestones(p.milestones), MILESTONE_REBOOT) ? 1 : 0;
  return addEntity(sink, g);
}

/**
 * 수호 기체를 1틱 진행: 유지 거리 밖이면 플레이어를 향해 결정론적으로 추적 이동하고, 사거리·LOS
 * 를 확인해 플레이어를 향해 적탄(플레이어에 유해)을 발사한다. 순수·결정론(위치·타이머·배열 순서·
 * 벽 LOS·정수 스탯 함수만, RNG 미소비). 침공 방어전에서만 호출된다(수호 없으면 조기 반환).
 *
 * 추적: 유지 거리(standoff)보다 멀면 정규 벡터 × 이동속도 × DT 로 접근(gems/특이점 흡인과 동일
 * f64 규율), 이내면 정지 사격(요격 유닛 거동). 벽은 이동에서 통과(비행 요격기)하되 사격 LOS 는
 * 존중한다(segmentBlocked) — 단순·결정론 유지.
 */
export function stepGuardians(state: WorldState, player: Entity): void {
  const guardians = state.config.invasion?.layout.guardians;
  if (guardians === undefined || guardians.length === 0) return;
  // 마일스톤 ② 코어 근접 수비용 코어 좌표(있으면). 코어는 배치당 1개이며 좌표는 config 정본이다.
  const core = state.config.invasion?.layout.core;
  for (const g of state.entities) {
    if (g.kind !== 'guardian' || g.dead) continue;
    const p = guardians[g.pierce];
    if (p === undefined) continue;
    // 마일스톤 ① 격추 재기동 딜레이: 부활 직후 재기동 중(iframes>0)이면 무적·정지 상태로 카운트
    // 다운만 한다(이동·조준·사격 없음). 아군탄 피해도 world.ts 가 iframes>0 수호를 건너뛴다.
    if (g.iframes > 0) {
      g.iframes--;
      continue;
    }
    let stats: GuardianStats = resolveGuardianStats(p.snapshot, p.performanceCP, p.lineageBonusBp);
    // 마일스톤 ② 코어 근접 수비: 코어 반경 내면 탄피해·발사 간격을 결정론 정수로 강화한다(연사↑).
    // 기하(사거리·탄속 등)는 건드리지 않아 판정 f64 산술 결정론 위험을 늘리지 않는다.
    if (
      core !== undefined &&
      hasMilestone(normalizeMilestones(p.milestones), MILESTONE_CORE_GUARD)
    ) {
      const cdx = g.x - core.x;
      const cdy = g.y - core.y;
      if (cdx * cdx + cdy * cdy <= CORE_GUARD_RADIUS * CORE_GUARD_RADIUS) {
        stats = {
          ...stats,
          bulletDamage: coreGuardDamage(stats.bulletDamage),
          contactDamage: coreGuardDamage(stats.contactDamage),
          fireCooldown: coreGuardCooldown(stats.fireCooldown),
        };
      }
    }
    // 접촉(램) 피해를 매 틱 실효값으로 동기화한다(코어 반경 진입/이탈에 따라 승격·복귀). stats 는
    // 강화 구간에서만 승격된 값이라 반경 밖으로 나가면 base contactDamage 로 자동 복귀한다.
    g.damage = stats.contactDamage;
    const dx = player.x - g.x;
    const dy = player.y - g.y;
    const dist = length(dx, dy);
    // 추적: 유지 거리보다 멀면 접근(정규 벡터 × 속도 × DT). 이동 거리는 남은 간격으로 클램프.
    if (dist > stats.standoff && dist > 1) {
      const stepDist = Math.min(stats.moveSpeed * DT, dist - stats.standoff);
      g.x += (dx / dist) * stepDist;
      g.y += (dy / dist) * stepDist;
    }
    g.angle = atan2(dy, dx);
    // 발사: 쿨다운·사거리·LOS 게이트(포탑과 동일 규율). 사거리 밖이면 쿨다운 유지(진입 시 즉발).
    if (g.cooldown > 0) {
      g.cooldown--;
      continue;
    }
    if (dx * dx + dy * dy > stats.range * stats.range) continue;
    if (
      state.activeWalls.length > 0 &&
      segmentBlocked(g.x, g.y, player.x, player.y, state.activeWalls)
    ) {
      continue;
    }
    const ang = atan2(dy, dx);
    spawnEnemyBullet(
      state,
      g.x,
      g.y,
      cos(ang) * stats.bulletSpeed,
      sin(ang) * stats.bulletSpeed,
      ang,
      stats.bulletDamage,
      stats.bulletRadius,
      stats.bulletLife,
    );
    g.cooldown = stats.fireCooldown;
  }
}

// ---------------------------------------------------------------------------
// 스텝(결정론 거동) — WorldState는 type-only, 실제 스폰·수학은 리프 모듈만 사용
// ---------------------------------------------------------------------------
/**
 * 방어 포탑을 1틱 진행: 쿨다운이 오면 사거리·LOS를 확인하고 플레이어를 향해 발사한다.
 * 순수·결정론(위치·타이머·엔티티 배열 순서·벽 LOS로만 판정, RNG 미소비). 유형별 발사는
 * {@link fireTurret}가 디스패치한다.
 */
export function stepDefenseTurrets(state: WorldState, player: Entity): void {
  // 정비도(풍화, ADR-0006): 매 발사 후 쿨다운을 정비도로 스케일해 성능(발사 빈도)을 낮춘다.
  // 침공 경로에서만 호출되므로 config.invasion 은 항상 존재하지만, 방어적으로 옵셔널 체인 +
  // 정규화한다(미지정=완전 정비=무변화). 루프 밖에서 1회 계산(정비도는 런 내 상수).
  const maintenance = normalizeMaintenance(state.config.invasion?.maintenance);
  for (const t of state.entities) {
    if (t.kind !== 'defenseTurret' || t.dead) continue;
    if (t.cooldown > 0) {
      t.cooldown--;
      continue;
    }
    const spec = TURRET_SPECS[t.enemyType];
    if (spec === undefined) continue;
    // 사거리 밖이면 발사 보류(쿨다운 0 유지 → 사정권 진입 시 즉시 발사).
    const dx = player.x - t.x;
    const dy = player.y - t.y;
    if (dx * dx + dy * dy > spec.range * spec.range) continue;
    // 장애물에 시야가 가리면 보류(감속 장판은 위치 지정이라 LOS 무관하게 발사).
    if (
      spec.hazardRadius === 0 &&
      state.activeWalls.length > 0 &&
      segmentBlocked(t.x, t.y, player.x, player.y, state.activeWalls)
    ) {
      continue;
    }
    fireTurret(state, t, spec, player);
    t.cooldown = scaleFireCooldown(spec.fireCooldown, maintenance);
  }
}

/** 포탑 1기의 발사를 유형별로 디스패치(결정론). */
function fireTurret(state: WorldState, t: Entity, spec: TurretSpec, player: Entity): void {
  const ang = atan2(player.y - t.y, player.x - t.x);
  switch (t.enemyType) {
    case TURRET_FROST: {
      // ④ 감속: 플레이어 현재 위치에 냉기 장판(HAZARD_SLOW)을 융기(M3 감속 지대 재사용).
      // 예열 뒤 활성 구간 동안 접촉하면 playerSlowTicks 부여 + 소량 피해(world.ts 판정 재사용).
      spawnHazard(
        state,
        HAZARD_SLOW,
        player.x,
        player.y,
        spec.hazardRadius,
        spec.hazardWindup,
        spec.hazardActive,
        spec.damage,
        true, // 지속 피해 장판
        t.id,
      );
      return;
    }
    case TURRET_MISSILE: {
      // ⑤ 미사일: 제한 선회 유도탄(M3 BK_HOMING). 락 지속 동안 매 틱 turnRate까지 플레이어로
      // 선회, 이후 직진(회피 여지 — GDD §10 정신).
      const b = spawnEnemyBullet(
        state,
        t.x,
        t.y,
        cos(ang) * spec.bulletSpeed,
        sin(ang) * spec.bulletSpeed,
        ang,
        spec.damage,
        spec.bulletRadius,
        spec.bulletLife,
      );
      applyBehavior(b, homingBehavior(spec.bulletSpeed, spec.lockTicks, spec.turnRate));
      return;
    }
    case TURRET_SHOTGUN:
    case TURRET_TESLA: {
      // ③ 산탄 / ⑥ 전격: 부채꼴로 pellets발 균등 발사(전격은 약탄 고속 다발 = "연쇄 다수 약공").
      const n = spec.pellets < 1 ? 1 : spec.pellets;
      const start = n > 1 ? ang - spec.spread / 2 : ang;
      const step = n > 1 ? spec.spread / (n - 1) : 0;
      for (let i = 0; i < n; i++) {
        const a = start + step * i;
        spawnEnemyBullet(
          state,
          t.x,
          t.y,
          cos(a) * spec.bulletSpeed,
          sin(a) * spec.bulletSpeed,
          a,
          spec.damage,
          spec.bulletRadius,
          spec.bulletLife,
        );
      }
      return;
    }
    default: {
      // ① 발칸 / ② 저격: 플레이어를 향해 단발 직사(스펙 차이 = 사거리·피해·탄속·연사).
      spawnEnemyBullet(
        state,
        t.x,
        t.y,
        cos(ang) * spec.bulletSpeed,
        sin(ang) * spec.bulletSpeed,
        ang,
        spec.damage,
        spec.bulletRadius,
        spec.bulletLife,
      );
      return;
    }
  }
}
