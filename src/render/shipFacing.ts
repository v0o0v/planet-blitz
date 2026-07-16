/**
 * 기체(플레이어) 스프라이트가 향할 각도 계산 (렌더 전용 — 순수 함수, sim 비의존).
 *
 * 기존엔 스프라이트 회전을 sim의 `player.angle`(= 마우스 조준각)로 돌려 기체가
 * 마우스를 따라다녔다. 그러나 실제 사격은 `autoAttack`이 가장 가까운 적대 대상을
 * 자동 조준(`nearestTarget`)해 발사하므로 기체 방향과 탄 방향이 어긋났다. 여기서는
 * 렌더 시점에 동일 대상군(적/보스/보급 — nearestTarget과 일치)의 최근접을 향하도록
 * 계산해, 기체가 "총을 쏘는 방향"을 향하게 한다. sim·결정론은 건드리지 않는다.
 */

import { atan2 } from '../sim/math.js';
import type { EntitySnapshot } from '../sim/snapshot.js';

/** 자동 조준 대상군(sim nearestTarget과 동일: 적·보스·보급 습격선). */
const HOSTILE_KINDS: ReadonlySet<string> = new Set(['enemy', 'boss', 'supply']);

/** 이동 방향으로 간주할 최소 프레임 이동량(px). 정지 미세 흔들림 무시. */
const MOVE_EPS = 0.5;

/**
 * 플레이어 기준 가장 가까운 적대 대상 방향(각도). 대상이 없으면 null.
 * sim nearestTarget의 fast-path(거리 최근접)와 같은 선택 규칙 — 벽 LOS 차폐는
 * 렌더에서 복제하지 않는다(시각적 근사, 결정론 무관).
 */
export function nearestHostileAngle(
  px: number,
  py: number,
  entities: readonly EntitySnapshot[],
): number | null {
  let best: number | null = null;
  let bestD2 = Infinity;
  for (const e of entities) {
    if (!HOSTILE_KINDS.has(e.kind)) continue;
    const dx = e.x - px;
    const dy = e.y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = atan2(dy, dx);
    }
  }
  return best;
}

/**
 * 기체가 향할 각도.
 *  1) 자동 조준 대상(최근접 적/보스/보급)이 있으면 그 방향(= 실제 사격 방향).
 *  2) 없으면 이동 방향(이번 스냅샷 간 이동 벡터).
 *  3) 정지 상태면 직전 각도를 유지(hold) — 마우스 조준각에는 의존하지 않는다.
 */
export function shipFacing(
  px: number,
  py: number,
  entities: readonly EntitySnapshot[],
  moveDx: number,
  moveDy: number,
  lastAngle: number,
): number {
  const target = nearestHostileAngle(px, py, entities);
  if (target !== null) return target;
  if (moveDx * moveDx + moveDy * moveDy > MOVE_EPS * MOVE_EPS) return atan2(moveDy, moveDx);
  return lastAngle;
}
