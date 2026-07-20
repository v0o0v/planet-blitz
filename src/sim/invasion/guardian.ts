/**
 * 침공 — 정비도(풍화) 산술 + 수호 기체 스폰 (M7a · L11-legacy-purge 이관분).
 *
 * ## 이 파일의 내력
 * 여기 있는 네 함수(정비도 정규화·발사 간격 스케일·수호 스폰과 그 상수)는 원래
 * `src/sim/defense.ts`(구 단일 아레나 침공 — 포탑 6종·15×9 격자·배치 포인트 예산제)에
 * 살았다. L11 에서 그 파일을 통째로 지우면서, **3레이어 침공이 계속 쓰는 부분만** 이리로
 * 옮겼다. 산술은 한 글자도 바꾸지 않았다 — 정비도 폴드는 hashWorld 침공 블록 v2 에 접히므로
 * 값이 1 이라도 달라지면 클라(Node)·서버(Deno) 재실행이 갈려 정직한 런이 오거부된다.
 *
 * ## 결정론(ADR-0005)
 * RNG·wall-clock 미사용. 정비도는 **정수 centi-percent** 도메인이라 f64 누적 오차가 없고,
 * 나눗셈은 IEEE-754 correctly-rounded 단일 연산 + Math.round 뿐이라 플랫폼 무관이다.
 *
 * ## 여기 없는 것
 * 구 `stepGuardians` 는 배치를 `state.config.invasion?.layout.guardians`(삭제된 구 config
 * 경로)에서 읽었다. 3레이어판은 슬롯 인덱스 매핑까지 포함해
 * {@link file://./guardianBridge.ts stepInvasionGuardians} 가 대체하므로 이관하지 않았다.
 */

import type { Entity, EntitySink } from '../entities.js';
import { blankEntity, addEntity } from '../entities.js';
import {
  resolveGuardianStats,
  normalizeGuardianPreset,
  type GuardianSnapshot,
} from '../../../data/guardian.js';
import { normalizeMilestones, hasMilestone, MILESTONE_REBOOT } from '../../../data/lineage.js';

// ---------------------------------------------------------------------------
// 정비도(풍화, ADR-0006) — 결정론 정수 표현 + 발사 성능 스케일
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
 * **동일한** 정규값을 쓰도록 강제한다(거동 ↔ 해시 정합). 정수화는 Math.trunc(0 방향 절삭 —
 * 음수는 어차피 0 으로 클램프되므로 결과는 내림과 동일).
 */
export function normalizeMaintenance(maintenance: number | undefined): number {
  if (maintenance === undefined || !Number.isFinite(maintenance)) return MAINTENANCE_FULL;
  const i = Math.trunc(maintenance);
  if (i <= 0) return 0;
  if (i >= MAINTENANCE_FULL) return MAINTENANCE_FULL;
  return i;
}

/**
 * 정비도 → 실효 발사 간격(틱). ADR-0006: 정비 100%→성능 100%, 0%→성능 50%(선형).
 * "성능"은 발사 빈도로 구현한다 — 성능 50%면 간격이 2배(연사 절반)라 DPS 가 절반이 된다.
 * 다른 스칼라(피해)는 충돌 판정 f64 산술에 섞여 오차 위험이 있어 건드리지 않고, **정수 연산만**
 * 쓰는 발사 간격 하나로 성능을 균일하게 스케일한다.
 *
 * 결정론: 성능 분수 = (10000 + m) / 20000 (m=10000→1.0, m=0→0.5). 실효 간격 =
 * round(base × 20000 / (10000 + m)). 분자·분모 모두 정확한 정수(2^53 미만)이고 나눗셈은
 * correctly-rounded 단일 연산이라 Node·Deno V8 에서 비트 동일하다. 완전 정비(m=10000)는
 * base 를 그대로 반환한다.
 */
export function scaleFireCooldown(baseCooldown: number, maintenance: number): number {
  const m = normalizeMaintenance(maintenance);
  if (m === MAINTENANCE_FULL) return baseCooldown;
  return Math.round((baseCooldown * 20000) / (10000 + m));
}

// ---------------------------------------------------------------------------
// 수호 기체 스폰 (M5 plan A1, ADR-0007)
// ---------------------------------------------------------------------------

/**
 * 수호 기체 1기의 배치 데이터(구 `DefenseLayout.guardians[]` 계승). 3레이어 정본은
 * `InvasionLayers.l3.guardians[]`({@link file://./types.ts InvasionGuardianPlacement})이며
 * 그쪽은 `milestones` 가 필수다 — 이 구조는 그것을 그대로 받는 **상위 호환 입력 타입**이다.
 */
export interface GuardianPlacement {
  /** 배치 x(월드 유닛). */
  x: number;
  /** 배치 y(월드 유닛). */
  y: number;
  /** 퇴역 복사 스냅샷(기본 전투 스탯). */
  snapshot: GuardianSnapshot;
  /** 남은 성능%(centi-percent, 풍화 반영). */
  performanceCP: number;
  /** 계보 수호 가지 보너스(basis-point, 0..5000). */
  lineageBonusBp: number;
  /** 계보 마일스톤 비트마스크(data/lineage.ts MILESTONE_*). 미지정 = 0(마일스톤 없음). */
  milestones?: number;
}

/**
 * 수호 기체 1기 스폰. 실효 스탯을 스냅샷 × 성능 × 계보 보너스로 해석(resolveGuardianStats)해
 * 내구도·반지름·접촉피해를 세팅한다. 발사 스탯은 스텝에서 매 틱 동일 함수로 재해석하므로
 * 여기선 초기 발사 지연만 준다(스폰 즉발 방지).
 *
 * 필드 재활용(플랫 Entity 구조 — 신규 hash 필드 없음):
 *   - enemyType = 프리셋(0 타이탄/1 인터셉터, 렌더 분화)
 *   - pierce    = **슬롯 인덱스**(`layers.l3.guardians[i]` 조회 키). 스텝이 이 값으로 배치를
 *     되찾으므로 슬롯 배열을 밀집화하면 매핑이 통째로 어긋난다(guardianBridge 매핑 계약).
 *   - phase     = 마일스톤 ① 격추 재기동 잔여 충전(0=미해금/소진)
 */
export function spawnGuardian(sink: EntitySink, p: GuardianPlacement, slotIndex: number): Entity {
  const stats = resolveGuardianStats(p.snapshot, p.performanceCP, p.lineageBonusBp);
  const g = blankEntity('guardian');
  g.x = p.x;
  g.y = p.y;
  g.enemyType = normalizeGuardianPreset(p.snapshot.preset);
  g.pierce = slotIndex;
  g.radius = stats.radius;
  g.hp = stats.hp;
  g.maxHp = stats.hp;
  g.damage = stats.contactDamage;
  g.cooldown = stats.fireCooldown;
  g.phase = hasMilestone(normalizeMilestones(p.milestones), MILESTONE_REBOOT) ? 1 : 0;
  return addEntity(sink, g);
}
