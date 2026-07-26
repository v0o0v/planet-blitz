/**
 * 아군·이익 오브젝트의 표시 규약 — 크기 상한 · 이름표 · 포탑 조준 (사용자 피드백 2026-07-26).
 *
 * ## 왜 필요한가
 * 이 오브젝트들의 sim `radius` 는 **충돌 크기가 아니라 트리거 반경**이다(포탑 픽업·자석·폭탄
 * 장치는 `EVENT_TRIGGER_RADIUS = 70`). 렌더는 그 값을 그대로 `radius * 2 * ART_SCALE` 로
 * 환산해 왔기 때문에 210px 짜리 거대한 스프라이트가 화면을 덮었다 — 플레이어 기체(48px)의
 * 4배가 넘는다. `loot` 만 예외적으로 고정 크기를 쓰고 있었고(같은 근본 원인의 국소 처방),
 * 나머지는 방치돼 있었다. 여기서 **아군·이익 오브젝트 전체**를 기체 크기 이하로 묶는다.
 *
 * 크기를 줄이면 트리거 반경 정보가 화면에서 사라지므로, 휴면 상태의 접촉 기믹은 얇은 링으로
 * 반경을 따로 그린다(아래 {@link showsTriggerRing}). 정체를 모르겠다는 지적에 대해서는 이름표
 * ({@link friendlyLabel})를 스프라이트 아래에 붙인다.
 *
 * ── 결정론(ADR-0005) ── 전부 render-only 순수 함수다. 스냅샷만 읽고 sim·hashWorld 에 닿지
 * 않는다(스냅샷 자체가 해시 대상이 아니다).
 */

import { atan2 } from '../sim/math.js';
import type { EntityKind } from '../sim/entities.js';
import type { EntitySnapshot } from '../sim/snapshot.js';
import { t, type MessageKey } from '../i18n/index.js';

/**
 * 아군·이익 오브젝트의 표시 지름 상한(px).
 *
 * 사용자 요구는 "원래 기체 사이즈보다는 크지 않게" 였다. 기체는 sim radius 32 → 표시 96px
 * 이므로(`world.ts` 의 `player.radius = 32`; entityRenderer 주석의 "player r16 → 48px" 는 낡았다)
 * 96 이 상한의 상한이지만, 그 크기의 픽업은 여전히 화면을 지배한다. 그래서 **이미 게임에서
 * 검증된 픽업 글리프 크기**인 `LOOT_SIZE`(48px — 전리품이 오래 이 크기로 읽혀 왔다)를 상한으로
 * 쓴다: 기체보다 확실히 작고, 실측으로 가독이 확인된 유일한 수다.
 */
export const PICKUP_DISPLAY_SIZE = 48;

/**
 * 표시 크기를 기체 이하로 묶는 kind. 전부 **플레이어에게 이롭거나 아군인** 실체다.
 * `shelter`(대피소)·`encounter*`(조우 실체)는 넓이 자체가 게임플레이 정보라 제외한다 —
 * 줄이면 "어디까지 안전한가"가 화면에서 사라진다.
 */
const SIZE_CAPPED_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  'turretPickup',
  'magnetEmitter',
  'bombDevice',
  'boostPad',
  'supply',
  'loot',
  'echo',
  // 젬도 상한 대상이다 — sim radius 20 → 60px 라 기체보다 컸다(하네스 실측으로 확인). 화면에
  // 수십 개가 동시에 깔리는 실체라 과대 표시가 곧 화면 오염이었다.
  'gem',
]);

/**
 * 이름표를 붙이는 kind. **크기 상한 목록과 일부러 다르다**: 젬은 상한 대상이지만 라벨은 안 붙인다
 * (한 화면에 수십 개라 이름표가 곧 글자 폭탄이다). 대피소는 반대로 넓이는 그대로 두고 이름만 붙인다.
 */
const LABELED_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  'turretPickup',
  'magnetEmitter',
  'bombDevice',
  'boostPad',
  'supply',
  'loot',
  'echo',
  'shelter',
]);

/**
 * 휴면 접촉 기믹(트리거 링을 그리는 kind). 스프라이트를 줄인 대가로 반경을 링으로 남긴다.
 * 활성 포탑은 이미 픽업이 끝난 실체라 링을 그리지 않는다(호출측이 `active` 로 가른다).
 */
const TRIGGER_RING_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  'turretPickup',
  'magnetEmitter',
  'bombDevice',
]);

/** 트리거 링 색(아군/안전 톤 시안 — 적 계열 색과 충돌하지 않는다). */
export const TRIGGER_RING_COLOR = 0x66ffcc;

/** 이 kind 가 표시 크기 상한 대상인가. */
export function isSizeCapped(kind: EntityKind): boolean {
  return SIZE_CAPPED_KINDS.has(kind);
}

/**
 * 표시 지름(px). 상한 대상이면 `min(기본 환산, 기체 크기)`, 아니면 기본 환산 그대로.
 * `artScale` 는 호출측(entityRenderer)의 ART_SCALE 을 받아 두 곳의 상수가 갈라지지 않게 한다.
 */
export function displaySize(kind: EntityKind, radius: number, artScale: number): number {
  const base = radius * 2 * artScale;
  return isSizeCapped(kind) ? Math.min(base, PICKUP_DISPLAY_SIZE) : base;
}

/** 휴면 접촉 기믹이라 트리거 링을 그려야 하는가(`active` = 활성 포탑이면 false). */
export function showsTriggerRing(kind: EntityKind, active: boolean): boolean {
  return !active && TRIGGER_RING_KINDS.has(kind);
}

/**
 * 스프라이트 아래에 띄울 이름. 라벨 대상이 아니면 null.
 *
 * 포탑 픽업 하나가 두 상태를 산다: 휴면(밟으면 켜지는 배치물)과 활성(자동 사격 중인 아군
 * 포탑). 사용자에게는 완전히 다른 물건이라 이름을 가른다 — `active` 는 스냅샷이 실어 오는
 * `phase === 1` 이다.
 */
export function friendlyLabel(kind: EntityKind, active: boolean): string | null {
  if (!LABELED_KINDS.has(kind)) return null;
  if (kind === 'turretPickup') return t(active ? 'ent.turret.active' : 'ent.turret.pickup');
  return t(`ent.${kind}` as MessageKey);
}

/**
 * 활성 포탑이 조준하는 대상군. sim `isPlayerTargetable`(world.ts)의 kind 목록과 같은 뜻이다 —
 * 다만 `core` 의 보호막 국면 예외는 스냅샷에 없으므로 복제하지 않는다(시각 근사).
 */
const TURRET_TARGET_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  'enemy',
  'boss',
  'supply',
  'core',
  'decoyCore',
  'guardian',
  'facilityGun',
  'facilityHazard',
  'facilitySpawner',
  'defenseBoss',
  'prop',
]);

/**
 * 포탑이 향할 각도 — 사거리 안 최근접 표적 방향. 표적이 없으면 null(호출측이 직전 각도를
 * 유지한다).
 *
 * ## 왜 sim 값을 안 쓰는가
 * `stepTurrets`(world.ts)는 조준각을 지역 변수로만 쓰고 엔티티에 저장하지 않는다. 저장하려면
 * `entity.angle` 을 건드려야 하는데 그 필드는 `hashEntity` 에 접히므로 기존 리플레이·골든이
 * 통째로 갈린다. 그래서 sim 은 그대로 두고, 렌더가 같은 규칙(최근접·유클리드 거리)으로
 * 조준 방향을 다시 구한다 — 표적 선택이 한 프레임 어긋나도 시각 결과만 달라진다.
 */
export function turretAimAngle(
  x: number,
  y: number,
  entities: readonly EntitySnapshot[],
  range: number,
): number | null {
  let best: number | null = null;
  let bestD2 = range * range;
  for (const e of entities) {
    if (!TURRET_TARGET_KINDS.has(e.kind)) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = atan2(dy, dx);
    }
  }
  return best;
}
