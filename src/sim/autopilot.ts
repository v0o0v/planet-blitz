/**
 * 오토파일럿: 런을 자동 진행시키는 순수 결정론적 입력 봇(ADR-0008, CONTEXT '오토파일럿').
 *
 * `autopilotInput`은 오직 `WorldState`만 읽어 한 틱의 {@link InputFrame}을 만든다 —
 * `Math.random`도, `Date`도, 플랫폼 삼각함수도 쓰지 않는다(각도 계산은 결정론 math 모듈
 * 사용). 따라서 같은 시드+같은 config로 오토파일럿을 돌리면 항상 tick 단위로 동일한 런이
 * 재현되며(hashWorld로 검증), 시드+입력로그만으로 리플레이가 성립한다(오토파일럿은 개입이
 * 아니라 정상 입력 생성이라 런을 오염시키지 않는다 — ADR-0008).
 *
 * 목표는 최적 플레이가 아니라 콘텐츠 검증을 위해 런 깊숙이 생존하는 것이다. 휴리스틱은
 * 단순·견고하게 유지한다:
 *   1. 레벨업 대기 중이면 파워업 선택(오퍼 0번)을 낸다.
 *   2. 위협적인 최근접 적탄이 있으면 그 탄선에서 수직으로 회피한다.
 *   3. 그 외에는 최근접 적/보스 주위를 카이팅한다(너무 가까우면 물러나고 멀면 접근).
 * 조준은 항상 최근접 적/보스를 향한다.
 */

import type { InputFrame, WorldState } from './world.js';
import { SPECIAL_NONE, packPowerupPick } from './world.js';
import type { Entity } from './entities.js';
import { atan2, length } from './math.js';

/** 적탄이 '위협'으로 간주되는 최대 거리(월드 단위). 이 안에서 접근 중인 탄만 회피한다. */
const THREAT_RADIUS = 340;
/** 카이팅 목표 거리: 최근접 적과 이 거리를 유지하려 한다(2x 스케일 기준). */
const KITE_DISTANCE = 460;
/** 목표 거리 대비 이 비율보다 가까워지면 물러난다(히스테리시스로 떨림 방지). */
const KITE_BACKOFF = 0.75;

/**
 * 이번 틱의 입력 프레임을 생성한다. `world` 상태만의 순수 함수 — 부작용 없음.
 */
export function autopilotInput(world: WorldState): InputFrame {
  // 레벨업 프리즈: 오퍼 0번을 선택해 런을 진행시킨다(선택하지 않으면 영원히 멈춘다).
  if (world.pendingLevelUp) {
    return { moveX: 0, moveY: 0, aim: 0, dash: false, special: packPowerupPick(0) };
  }

  const player = world.entities[0];
  if (player === undefined) {
    return { moveX: 0, moveY: 0, aim: 0, dash: false, special: SPECIAL_NONE };
  }

  const target = nearestTarget(world, player);
  const aim = target !== undefined ? atan2(target.y - player.y, target.x - player.x) : 0;

  // ① 위협 회피 우선: 접근 중인 최근접 적탄의 탄선에서 수직으로 비킨다.
  const dodge = dodgeVector(world, player);
  if (dodge !== undefined) {
    return { moveX: dodge.x, moveY: dodge.y, aim, dash: false, special: SPECIAL_NONE };
  }

  // ② 카이팅: 최근접 적/보스와 목표 거리를 유지한다.
  if (target !== undefined) {
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const d = length(dx, dy);
    if (d > 0.0001) {
      const nx = dx / d;
      const ny = dy / d;
      if (d < KITE_DISTANCE * KITE_BACKOFF) {
        // 너무 가까움 → 물러난다.
        return { moveX: -nx, moveY: -ny, aim, dash: false, special: SPECIAL_NONE };
      }
      if (d > KITE_DISTANCE) {
        // 멀다 → 접근한다(젬 수거 + 사격 사거리 확보).
        return { moveX: nx, moveY: ny, aim, dash: false, special: SPECIAL_NONE };
      }
    }
  }

  // 적정 거리대 또는 표적 없음: 정지(오토어택이 최근접 표적을 알아서 조준·사격).
  return { moveX: 0, moveY: 0, aim, dash: false, special: SPECIAL_NONE };
}

/** 조준·카이팅 대상이 되는 최근접 적대 엔티티(적/보스). 없으면 undefined. */
function nearestTarget(world: WorldState, player: Entity): Entity | undefined {
  let best: Entity | undefined;
  let bestD = Infinity;
  for (const e of world.entities) {
    if (e.dead) continue;
    if (e.kind !== 'enemy' && e.kind !== 'boss') continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    const d = dx * dx + dy * dy;
    // 동률은 id 오름차순으로 깨 플랫폼 순회 순서에 의존하지 않는다.
    if (d < bestD || (d === bestD && best !== undefined && e.id < best.id)) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/**
 * 위협적인 최근접 적탄의 탄선에서 벗어나는 단위 회피 벡터. 위협이 없으면 undefined.
 *
 * '위협'은 THREAT_RADIUS 안에 있으면서 플레이어 쪽으로 접근 중인(속도·상대위치 내적 > 0)
 * 적탄이다. 회피 방향은 탄 속도에 수직이면서 탄선에서 플레이어 쪽으로 멀어지는 성분 —
 * 플레이어가 정확히 탄선 위에 있으면 임의의 수직 방향을 택한다.
 */
function dodgeVector(world: WorldState, player: Entity): { x: number; y: number } | undefined {
  let best: Entity | undefined;
  let bestD = THREAT_RADIUS * THREAT_RADIUS;
  for (const e of world.entities) {
    if (e.dead || e.kind !== 'enemyBullet') continue;
    const px = player.x - e.x;
    const py = player.y - e.y;
    const d = px * px + py * py;
    if (d >= bestD) continue;
    // 접근 중(탄 속도가 플레이어를 향함)만 위협으로 본다.
    if (e.vx * px + e.vy * py <= 0) continue;
    bestD = d;
    best = e;
  }
  if (best === undefined) return undefined;

  const vlen = length(best.vx, best.vy);
  const px = player.x - best.x;
  const py = player.y - best.y;
  if (vlen < 0.0001) {
    // 정지한 탄: 그냥 탄에서 멀어진다.
    const d = length(px, py);
    if (d < 0.0001) return { x: 1, y: 0 };
    return { x: px / d, y: py / d };
  }
  const vnx = best.vx / vlen;
  const vny = best.vy / vlen;
  // 상대위치에서 탄 속도 성분을 제거한 수직 성분(탄선 → 플레이어 방향).
  const projScalar = px * vnx + py * vny;
  let perpX = px - projScalar * vnx;
  let perpY = py - projScalar * vny;
  const perpLen = length(perpX, perpY);
  if (perpLen < 0.0001) {
    // 플레이어가 탄선 정중앙: 임의의 수직 방향(속도 왼쪽)으로 비킨다.
    perpX = -vny;
    perpY = vnx;
    return { x: perpX, y: perpY };
  }
  return { x: perpX / perpLen, y: perpY / perpLen };
}
