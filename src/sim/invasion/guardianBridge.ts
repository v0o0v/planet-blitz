/**
 * 침공 L3 — 수호 기체 브리지 (M7a · L5-core-room).
 *
 * ## 이 파일이 존재하는 이유
 * 3레이어 코어방은 수호 기체 스폰·거동을 그대로 써야 하는데, 배치를 읽는 **경로**가 달라졌다.
 * 스폰(`spawnGuardian` — config 를 읽지 않는 순수 함수)은 그대로 재사용하고, 신 스키마
 * (`InvasionLayers.l3.guardians`)와 잇는 얇은 층이 이 모듈이다.
 *
 * ## 왜 구 stepGuardians 를 그대로 쓰지 않는가
 * 구 `defense.stepGuardians` 는 배치를 `state.config.invasion?.layout.guardians`(단일 아레나
 * 시절 config 경로)에서 읽었다. 그 경로는 L11 에서 사라졌고, 3레이어는 슬롯 인덱스 매핑까지
 * 필요하다. 그래서 스텝 루프만 여기서 신 스키마 기준으로 다시 썼다 — 거동 규칙(추적·유지거리·
 * LOS·마일스톤 3종)은 구 구현과 **동일한 결정론 산술**이다.
 *
 * ## 슬롯 매핑 계약 (SQL·EF·클라 3자 정합의 핵심)
 *   `layers.l3.guardians[i]` ↔ 수호 엔티티 `entity.pierce === i`
 * `guardians` 는 **고정 길이 {@link INVASION_GUARDIAN_SLOTS} + null 허용** 배열이다. 빈 슬롯은
 * 밀집화(compaction)하지 않는다 — 슬롯 1만 채운 배치에서 그 수호는 반드시 `pierce === 1` 이다.
 * SQL `inject_guardian_authority` 가 `layout->'l3'->'guardians'` 의 **배열 위치를 보존한 채**
 * 라이브 권위를 주입해야 하고, EF `injectGuardianAuthority` · 클라 `buildGuardianPlacements` 도
 * 같은 규약을 따라야 한다. 한 곳만 밀집화하면 정직한 런이 전량 `defense-mismatch` 로 오거부된다.
 *
 * ## 풍화(정비도) 규율 — 결정 #18
 * 정비도는 **배치된 방어체**(편대·설비·기물·보스)의 발사 간격을 늘린다. **수호 기체만 예외**로
 * 정비도가 아니라 자기 수명형 성능(`performanceCP`, 바닥 50%)으로 감쇠한다(ADR-0007 — 수호는
 * 회복 불가). 두 감쇠를 겹치면 이중 페널티가 되므로 여기서는 정비도를 적용하지 않는다.
 */

import type { WorldState } from '../world.js';
import type { Entity, EntitySink } from '../entities.js';
import { spawnEnemyBullet } from '../entities.js';
import { applyBehavior, accelBehavior, homingBehavior, type BulletBehavior } from '../bullets.js';
import { atan2, cos, sin, length } from '../math.js';
import { segmentBlocked } from '../los.js';
import { DT } from '../constants.js';
// 정비도 산술·수호 스폰은 L11 에서 구 defense.ts → invasion/guardian.ts 로 이관됐다(산술 무변).
import {
  spawnGuardian,
  normalizeMaintenance,
  scaleFireCooldown,
  MAINTENANCE_FULL,
} from './guardian.js';
import {
  resolveGuardianStats,
  coreGuardDamage,
  coreGuardCooldown,
  shieldShareHp,
  CORE_GUARD_RADIUS,
  SHIELD_SHARE_CORE_BP,
} from '../../../data/guardian.js';
import type { GuardianStats } from '../../../data/guardian.js';
import {
  normalizeMilestones,
  hasMilestone,
  MILESTONE_CORE_GUARD,
  MILESTONE_SHIELD_SHARE,
} from '../../../data/lineage.js';
import { INVASION_GUARDIAN_SLOTS } from './constants.js';
import type { InvasionGuardianPlacement, InvasionLayers, InvasionStepContext } from './types.js';

export { MAINTENANCE_FULL, normalizeMaintenance };

/**
 * 침공 3레이어 공용 발사 간격 스케일. 정비도(centi-percent)를 받아 실효 간격(틱)을 낸다 —
 * `defense.scaleFireCooldown` 을 그대로 위임한다(정수 산술: `round(base × 20000 / (10000+m))`).
 *
 * **편대(L3 레인)·설비(L4 레인)·기물/보스(이 레인)가 전부 이 함수를 써야** 풍화가 배치 전반에
 * 균일하게 걸린다(결정 #18). 각 레인이 자기 산식을 따로 쓰면 정비도 0% 의 실효 페널티가
 * 카테고리마다 갈린다.
 */
export function invasionFireCooldown(baseCooldown: number, maintenance: number): number {
  return scaleFireCooldown(baseCooldown, maintenance);
}

/**
 * 배치의 수호 슬롯을 스폰한다. **null 슬롯은 건너뛰되 인덱스는 소비**하므로 슬롯 i 에 배치된
 * 수호는 언제나 `entity.pierce === i` 다(위 매핑 계약).
 *
 * 반환값은 실제로 스폰된 수호 수다(0 이면 실드 공유·수호 스텝이 전부 no-op).
 */
export function spawnInvasionGuardians(sink: EntitySink, layers: InvasionLayers): number {
  const slots = layers.l3.guardians;
  const n = slots.length < INVASION_GUARDIAN_SLOTS ? slots.length : INVASION_GUARDIAN_SLOTS;
  let spawned = 0;
  for (let i = 0; i < n; i++) {
    const p = slots[i];
    if (p === null || p === undefined) continue;
    // spawnGuardian 은 config 를 읽지 않는 순수 스폰 함수라 그대로 재사용한다.
    // InvasionGuardianPlacement 는 구 GuardianPlacement 의 상위 호환(milestones 가 필수)이다.
    spawnGuardian(sink, p, i);
    spawned++;
  }
  return spawned;
}

/**
 * 마일스톤 ③ 실드 공유 → 코어에 실을 보호막 HP(결정론 정수). 참전 수호 중 하나라도 해당
 * 마일스톤을 가지면, 참전 수호들의 실효 HP 합에 비례한 실드를 낸다. 없으면 0.
 *
 * 구 `applyShieldShare` 는 코어 + 포탑 전부에 실드를 뿌렸지만, 3레이어 코어방에는 포탑이 없다
 * (설비는 L2 회랑에 있다). 따라서 코어 몫({@link SHIELD_SHARE_CORE_BP})만 계산한다.
 */
export function guardianShieldShareHp(layers: InvasionLayers): number {
  let any = false;
  let pool = 0;
  for (const p of layers.l3.guardians) {
    if (p === null || p === undefined) continue;
    if (hasMilestone(normalizeMilestones(p.milestones), MILESTONE_SHIELD_SHARE)) any = true;
    pool += resolveGuardianStats(p.snapshot, p.performanceCP, p.lineageBonusBp).hp;
  }
  if (!any) return 0;
  return shieldShareHp(pool, SHIELD_SHARE_CORE_BP);
}

// ---------------------------------------------------------------------------
// 수호 무기 아키타입 발사 (ADR-0025 — 장착 메인 무기 타입이 방어 발사체를 결정)
// ---------------------------------------------------------------------------
// weaponType 코드는 src/items/loadout.ts WEAPON_*(= data/guardian.ts normalizeGuardianWeaponType
// 도메인)와 동일한 0..4 계약이다(world.ts 의 WEAPON_TYPE_* 는 비-export 라 여기서 재선언 —
// 값이 갈리면 tests/weaponArchetype 계열 커버리지가 잡는다). 아래 거동 계수는 밸런스
// placeholder(튜닝 이월 — defer-balance-tuning). 유도·가속은 결정론·해시 검증된 bullets.ts
// primitive(BK_HOMING·BK_ACCEL)를 재사용해 신규 Entity 필드 0(applyBehavior 가 free 필드에 각인).
const GW_RAILGUN = 2;
const GW_MISSILE = 3;
const GW_BEAM = 4;
/** 레일건 슬러그 가속(units/s²) — 고속·강타는 stats(loadout)가, 가속 정체성은 여기서. */
const GUARDIAN_RAILGUN_ACCEL = 1400;
/** 미사일 유도 락 지속(틱) — 보스 BOSS_HOMING_LOCK 참조. */
const GUARDIAN_MISSILE_LOCK_TICKS = 48;
/** 미사일 선회율(rad/tick) — 보스 BOSS_HOMING_TURN 참조. */
const GUARDIAN_MISSILE_TURN = 0.055;
/** 빔 세그먼트 간격(units) — player BEAM_SEGMENT_SPACING 참조. */
const GUARDIAN_BEAM_SEGMENT_SPACING = 90;
/** 빔 세그먼트 반지름 — player BEAM_SEGMENT_RADIUS 참조. */
const GUARDIAN_BEAM_SEGMENT_RADIUS = 52;
/** 빔 세그먼트 수명(틱) — player BEAM_SEGMENT_LIFE 참조. */
const GUARDIAN_BEAM_SEGMENT_LIFE = 2;
/** 빔 세그먼트 상한 — player BEAM_MAX_SEGMENTS 참조. */
const GUARDIAN_MAX_BEAM_SEGMENTS = 16;

/**
 * 팬 볼리 발사(벌컨=1발 직진 / 산탄=bulletCount발 부채꼴 / 미사일=부채꼴+유도). `spread` 는
 * 스냅샷 정수 밀리라디안이라 라디안으로 되돌린다(/1000). `behavior` 가 있으면 각 탄에 각인한다
 * (미사일 유도·레일건 가속) — 없으면 순수 직진. 결정론(단일 나눗셈 + 결정론 trig).
 */
function fireGuardianFan(
  state: WorldState,
  g: Entity,
  baseAng: number,
  stats: GuardianStats,
  behavior: BulletBehavior | null,
): void {
  const n = stats.bulletCount < 1 ? 1 : stats.bulletCount;
  const spreadRad = stats.spread / 1000;
  const start = n > 1 ? baseAng - spreadRad / 2 : baseAng;
  const stepA = n > 1 ? spreadRad / (n - 1) : 0;
  for (let i = 0; i < n; i++) {
    const a = start + stepA * i;
    const b = spawnEnemyBullet(
      state,
      g.x,
      g.y,
      cos(a) * stats.bulletSpeed,
      sin(a) * stats.bulletSpeed,
      a,
      stats.bulletDamage,
      stats.bulletRadius,
      stats.bulletLife,
    );
    if (behavior !== null) applyBehavior(b, behavior);
  }
}

/**
 * 빔 발사 — 조준선 위에 정적 세그먼트(speed 0, 짧은 수명)를 촘촘히 깐다(player 빔 미러). 빠른
 * 발사 간격으로 연속 타격선처럼 읽힌다. 세그먼트 수 = floor(range / 간격), [1, 상한] 클램프.
 */
function fireGuardianBeam(state: WorldState, g: Entity, ang: number, stats: GuardianStats): void {
  const ca = cos(ang);
  const sa = sin(ang);
  let segs = Math.floor(stats.range / GUARDIAN_BEAM_SEGMENT_SPACING);
  if (segs < 1) segs = 1;
  if (segs > GUARDIAN_MAX_BEAM_SEGMENTS) segs = GUARDIAN_MAX_BEAM_SEGMENTS;
  for (let i = 1; i <= segs; i++) {
    const dist = i * GUARDIAN_BEAM_SEGMENT_SPACING;
    spawnEnemyBullet(
      state,
      g.x + ca * dist,
      g.y + sa * dist,
      0,
      0,
      ang,
      stats.bulletDamage,
      GUARDIAN_BEAM_SEGMENT_RADIUS,
      GUARDIAN_BEAM_SEGMENT_LIFE,
    );
  }
}

/**
 * 수호 1발 발사를 장착 메인 무기 타입으로 분기한다(ADR-0025). 레일건=가속 단발, 미사일=유도 팬,
 * 빔=세그먼트 라인, 벌컨/산탄(및 그 외)=팬(벌컨은 bulletCount=1 이라 단발). 발사체 정체성만
 * 무기별로 다르고 크기값(피해·탄속·수명·발사간격)은 전부 stats(loadout 파생)에서 온다.
 */
function fireGuardianWeapon(state: WorldState, g: Entity, ang: number, stats: GuardianStats): void {
  if (stats.weaponType === GW_MISSILE) {
    fireGuardianFan(state, g, ang, stats, homingBehavior(stats.bulletSpeed, GUARDIAN_MISSILE_LOCK_TICKS, GUARDIAN_MISSILE_TURN));
    return;
  }
  if (stats.weaponType === GW_BEAM) {
    fireGuardianBeam(state, g, ang, stats);
    return;
  }
  if (stats.weaponType === GW_RAILGUN) {
    fireGuardianFan(state, g, ang, stats, accelBehavior(stats.bulletSpeed, GUARDIAN_RAILGUN_ACCEL));
    return;
  }
  // 벌컨(0)·산탄(1) 및 기타: 순수 팬(거동 없음). 벌컨은 bulletCount=1·spread=0 이라 단발 직진.
  fireGuardianFan(state, g, ang, stats, null);
}

/**
 * 수호 기체를 1틱 진행한다(신 스키마판). 구 `defense.stepGuardians` 와 **동일한 결정론 산술**을
 * 쓰되 배치를 `ctx.layers.l3.guardians` 에서 슬롯 인덱스(`entity.pierce`)로 조회한다.
 *
 * 거동: 유지 거리(standoff) 밖이면 추적, 이내면 정지 사격. 사격은 쿨다운·사거리·LOS 3중 게이트.
 * 마일스톤 ① 재기동 딜레이(iframes>0 = 무적·정지), ② 코어 근접 수비(코어 반경 내 화력 강화)를
 * 그대로 재현한다. RNG 미소비.
 *
 * `corePos` 는 마일스톤 ② 판정용 코어 좌표다(코어방에서는 `layers.l3.core`).
 */
export function stepInvasionGuardians(
  state: WorldState,
  player: Entity,
  ctx: InvasionStepContext,
): void {
  const slots = ctx.layers.l3.guardians;
  const core = ctx.layers.l3.core;
  for (const g of state.entities) {
    if (g.kind !== 'guardian' || g.dead) continue;
    const p: InvasionGuardianPlacement | null | undefined = slots[g.pierce];
    if (p === null || p === undefined) continue;
    // 마일스톤 ① 격추 재기동 딜레이: 재기동 중에는 무적·정지(이동·조준·사격 없음).
    if (g.iframes > 0) {
      g.iframes--;
      continue;
    }
    let stats: GuardianStats = resolveGuardianStats(p.snapshot, p.performanceCP, p.lineageBonusBp);
    // 마일스톤 ② 코어 근접 수비: 코어 반경 내면 탄피해·접촉피해·연사를 정수 산술로 강화.
    if (hasMilestone(normalizeMilestones(p.milestones), MILESTONE_CORE_GUARD)) {
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
    // 접촉 피해를 매 틱 실효값으로 동기화(코어 반경 진입/이탈에 따라 승격·복귀).
    g.damage = stats.contactDamage;
    const dx = player.x - g.x;
    const dy = player.y - g.y;
    const dist = length(dx, dy);
    if (dist > stats.standoff && dist > 1) {
      const stepDist = Math.min(stats.moveSpeed * DT, dist - stats.standoff);
      g.x += (dx / dist) * stepDist;
      g.y += (dy / dist) * stepDist;
    }
    g.angle = atan2(dy, dx);
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
    fireGuardianWeapon(state, g, ang, stats);
    g.cooldown = stats.fireCooldown;
  }
}
