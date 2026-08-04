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
import { isObjectiveDestructible } from './modes/objective.js';
import { isShelter, isShelterSecured } from './modes/chase.js';
import { INVASION_WINDOW_HALF_W } from './invasion/scroll.js';
import { PLANET_MODE } from './planetMode.js';

/** 적탄이 '위협'으로 간주되는 최대 거리(월드 단위). 이 안에서 접근 중인 탄만 회피한다. */
const THREAT_RADIUS = 340;
/**
 * 카이팅 목표 거리: 최근접 적과 이 거리를 유지하려 한다(2x 스케일 기준).
 *
 * 무기 사거리와 **묵시적으로 짝을 이루는 값**이라 export 한다. 봇은 이 거리에 붙박여
 * 사격은 sim 자동 조준에 맡기므로, 무기 사거리가 이 값보다 짧아지는 순간 `autoAttack` 이
 * 매 틱 표적 없음으로 조기 반환해 **한 발도 쏘지 않는다**. 실제로 그 상태가 있었다
 * (`weapon.range` 의 옛 `0 = 무제한` 센티널). `tests/weaponRange.test.ts` 가 기준 사거리와
 * 이 값의 관계를 못 박는다.
 */
export const KITE_DISTANCE = 460;
/** 목표 거리 대비 이 비율보다 가까워지면 물러난다(히스테리시스로 떨림 방지). */
const KITE_BACKOFF = 0.75;

/**
 * 강제 스크롤 창의 뒤 경계까지 이 거리 안쪽이면 **다른 모든 휴리스틱을 제치고 전진**한다.
 *
 * ## 왜 필요한가 — 카이팅은 강제 스크롤 무대에서 자살이다 (2026-08-02 실측)
 * 봇은 창을 **전혀 모른 채** 최근접 적에서 물러난다(③ 카이팅). 그런데 레이싱·블록격파는
 * 적을 창 **전방**에 스폰하므로(`RACING_SPAWN_AHEAD`) 후퇴 방향이 곧 뒤 경계 방향이다.
 * 게다가 창 기준 속도(`INVASION_SCROLL_SPEED` 12 u/tick)가 플레이어 기본 이동 속도와 **같은
 * 값**이라 뒤로 밀린 거리는 사실상 만회되지 않는다(가속은 100→200cp 로 오르기만 한다).
 *
 * 코스가 짧던 동안에는 이것이 보이지 않았다. 2026-08-01 페이싱 조정이 레이싱 코스를 14초
 * → 90초로 늘리자 즉시 드러났다 — 아르케 클리어율 **1.7%**, 그리고 신설 진단 지표
 * `후방압박`이 **런 시간의 42.8%** 를 뒤 경계 압박 구역에서 보냈다고 보고했다. 레벨을
 * 5 → 100 으로 올려도 처치/초가 2.04 → 1.80 으로 **떨어지고** 로스터 편차가 2.9pp 였다 —
 * 적을 못 죽여서 지는 것이 아니라 창을 못 따라가서 지는 것이라는 signature 다.
 *
 * **그래서 이것은 밸런스 조정이 아니라 계측기 수리다.** 여기를 고치지 않고 적 곡선을 낮추면
 * 존재하지 않는 문제를 튜닝하게 된다(이 저장소가 조준 목록에서 4번 겪은 부류).
 */
const STATION_CRITICAL_SLACK = 320;
/**
 * 뒤 경계까지 이 거리 안쪽이면 **뒤로 가는 성분만 잘라낸다**(옆으로 피하는 것은 그대로 허용).
 * 임계 구간 바깥에서는 회피·카이팅이 한 글자도 바뀌지 않는다.
 */
const STATION_COMFORT_SLACK = 880;

/**
 * 봇이 바닥 전리품을 주우러 갈 최대 거리(월드 유닛). 카이팅 목표 거리(`KITE_DISTANCE`)의
 * 몇 배 안쪽으로 두어, 봇이 전투를 버리고 무대를 가로지르지 않게 가둔다. TODO(밸런스).
 */
const LOOT_SEEK_RADIUS = 900;

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

  // ⓪ 창 유지(강제 스크롤 무대 전용): 뒤 경계에 붙으면 회피·카이팅보다 먼저 전진한다.
  //    그 외 무대는 `forward` 가 undefined 라 아래 경로가 한 줄도 실행되지 않는다(거동·해시 불변).
  const forward = scrollForward(world);
  const slack = forward !== undefined ? rearSlack(world, player) : Infinity;
  if (forward !== undefined && slack <= STATION_CRITICAL_SLACK) {
    return { moveX: forward.x, moveY: forward.y, aim, dash: false, special: SPECIAL_NONE };
  }

  // ① 위협 회피 우선: 접근 중인 최근접 적탄의 탄선에서 수직으로 비킨다.
  const dodge = dodgeVector(world, player);
  if (dodge !== undefined) {
    const v = clampBackward(dodge, forward, slack);
    return { moveX: v.x, moveY: v.y, aim, dash: false, special: SPECIAL_NONE };
  }

  // ② 목표물 우선: 무대 진행이 걸린 파괴 대상이 남아 있으면 **가장 가까운 것으로 곧장 붙는다**
  //    (추격 반격 장치 · 오염 노드 — 정본은 `modes/objective.ts`).
  //
  // 카이팅(③)으로는 이 목표를 영영 달성하지 못한다. 장치는 정지 표적이고 적은 플레이어에게
  // 몰려오므로, 자동 조준의 "사거리 안 최근접"은 거의 언제나 적이 이긴다 — 즉 장치 옆에 서
  // 있는 것만으로는 한 발도 장치에 가지 않는다. 그래서 목표 거리를 두지 않고 장치에 겹칠
  // 때까지 접근한다(장치 반경 70 이면 접촉한 적이 아닌 한 장치가 최근접이 된다).
  //
  // ⚠️ 이 분기는 **목표 오브젝트가 있는 무대에만** 존재한다. 그 오브젝트를 만들지 않는 무대
  // (뱀서류·수축·레이싱·블록격파·침공)의 봇 거동·해시는 바이트 불변이다.
  const device = nearestObjective(world, player);
  if (device !== undefined) {
    const dx = device.x - player.x;
    const dy = device.y - player.y;
    const d = length(dx, dy);
    const devAim = atan2(dy, dx);
    if (d > 0.0001) {
      return { moveX: dx / d, moveY: dy / d, aim: devAim, dash: false, special: SPECIAL_NONE };
    }
    return { moveX: 0, moveY: 0, aim: devAim, dash: false, special: SPECIAL_NONE };
  }

  // ③ 전리품 수거: 위협이 없고(①을 지났다) 무대 목표도 없을 때(②), 가까운 바닥 전리품을
  //    주우러 간다. 사람이 하는 "탄이 안 날아오면 아이템부터 줍는다"에 해당하는 단계다.
  //
  // ⚠️ **이것은 밸런스 조정이 아니라 계측기 수리다.** 봇에는 전리품·젬을 향한 이동이 아예
  // 없었다(이 파일에 `loot` 라는 단어가 없었다). 그래서 `lootPerRun` 게이트는 드랍 설계가
  // 아니라 **봇의 무관심**을 재고 있었다: 전체 런에서 수거 1.21 + 바닥 잔존 0.99 = 2.2 는
  // 설계 기대값(엘리트 1.5 + 보스 확정 × 승률 0.7 = 2.2)과 정확히 일치했다. 드랍은 정상이고
  // 절반을 흘리고 있었을 뿐이다. 여기를 고치지 않고 드랍률을 올리면 존재하지 않는 문제를
  // 튜닝하게 된다(§R1 아르케 · §R8 장비 표본에 이은 세 번째 계측기 고장).
  const loot = nearestPickup(world, player);
  if (loot !== undefined) {
    const dx = loot.x - player.x;
    const dy = loot.y - player.y;
    const d = length(dx, dy);
    if (d > 0.0001) {
      const v = clampBackward({ x: dx / d, y: dy / d }, forward, slack);
      return { moveX: v.x, moveY: v.y, aim, dash: false, special: SPECIAL_NONE };
    }
  }

  // ④ 카이팅: 최근접 적/보스와 목표 거리를 유지한다.
  if (target !== undefined) {
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const d = length(dx, dy);
    if (d > 0.0001) {
      const nx = dx / d;
      const ny = dy / d;
      if (d < KITE_DISTANCE * KITE_BACKOFF) {
        // 너무 가까움 → 물러난다. 강제 스크롤 무대에서는 뒤 경계 쪽 성분만 잘라낸다.
        const v = clampBackward({ x: -nx, y: -ny }, forward, slack);
        return { moveX: v.x, moveY: v.y, aim, dash: false, special: SPECIAL_NONE };
      }
      if (d > KITE_DISTANCE) {
        // 멀다 → 접근한다(젬 수거 + 사격 사거리 확보).
        return { moveX: nx, moveY: ny, aim, dash: false, special: SPECIAL_NONE };
      }
    }
  }

  // 적정 거리대 또는 표적 없음: 정지(오토어택이 최근접 표적을 알아서 조준·사격).
  //
  // ⚠️ 강제 스크롤 무대에서는 **정지가 곧 후퇴다** — 창이 매 틱 전진하므로 가만히 서 있으면
  // 창 기준 속도만큼 뒤로 밀린다. 그래서 그 무대에서만 기본 행동을 전진으로 바꾼다.
  if (forward !== undefined) {
    return { moveX: forward.x, moveY: forward.y, aim, dash: false, special: SPECIAL_NONE };
  }
  return { moveX: 0, moveY: 0, aim, dash: false, special: SPECIAL_NONE };
}

/**
 * 이 무대의 **창 전진 방향**(단위 벡터). 강제 스크롤 무대가 아니면 undefined —
 * 그 경우 창 유지 경로 전체가 무연산이라 기존 봇 거동이 바이트 불변이다.
 *
 * 레이싱은 +X 로 창이 나아간다(`racingProgress` = `scrollX`). 침공(`invasion3`)은
 * `scrollRuntime` 이 없어 대상이 아니다.
 *
 * ## ⚠️ 블록격파(−Y)는 **일부러 제외한다** — 실측으로 해롭다
 * 창 수학은 같지만 실패 양식이 정반대다. 레이싱의 뒤 경계는 **빈 공간**이라 전진이 곧 회피이지만,
 * 블록격파의 전방은 **파괴 가능한 벽 행**이라 전진 편향이 봇을 벽에 밀어붙여 `crushBlockBreak`
 * (경계·벽 사이 끼임 누적 피해)을 자초한다. 같은 축(크라스 단독 · Lv5/25/60/80/100)으로 교환
 * 대조한 결과 **49.0% → 16.7%**. 그래서 "강제 스크롤이면 전진"이라는 일반화를 쓰지 않고
 * 모드를 명시한다 — 이 두 무대는 창만 같고 지형이 다르다.
 */
function scrollForward(world: WorldState): { x: number; y: number } | undefined {
  if (world.scrollRuntime === undefined) return undefined;
  if (world.config.planetMode === PLANET_MODE.racing) return { x: 1, y: 0 };
  return undefined;
}

/**
 * 창 뒤 경계까지 남은 여유(월드 유닛). 전진 방향축으로만 잰다 — 압박 판정
 * (`racingRearPressure`)과 같은 축이다. 값이 작을수록 경계에 가깝다.
 */
function rearSlack(world: WorldState, player: Entity): number {
  const rt = world.scrollRuntime;
  if (rt === undefined) return Infinity;
  return player.x - (rt.scrollX - INVASION_WINDOW_HALF_W);
}

/**
 * 뒤 경계가 가까울 때 이동 벡터에서 **뒤로 가는 성분만** 잘라낸다(옆 회피는 그대로 남긴다).
 * 잘라낸 뒤 길이가 0 이면 전진 벡터로 대체한다 — 방향이 사라진 채 정지하면 그것도 후퇴다.
 *
 * 여유가 충분하거나 강제 스크롤 무대가 아니면 입력을 **그대로** 돌려준다.
 */
function clampBackward(
  v: { x: number; y: number },
  forward: { x: number; y: number } | undefined,
  slack: number,
): { x: number; y: number } {
  if (forward === undefined || slack > STATION_COMFORT_SLACK) return v;
  const along = v.x * forward.x + v.y * forward.y;
  if (along >= 0) return v;
  const x = v.x - along * forward.x;
  const y = v.y - along * forward.y;
  const d = length(x, y);
  if (d < 0.0001) return forward;
  return { x: x / d, y: y / d };
}

/**
 * 조준·카이팅 대상이 되는 최근접 적대 엔티티. PvE 적성(적·보스)에 침공 3레이어 방어체를
 * 더한다 — PvE 런에는 이 kind 들이 존재하지 않으므로 기존 PvE 거동·해시는 불변이다.
 *
 * 코어를 일부러 넣지 않는다: 코어는 정지 표적이라 카이팅 기준으로 삼으면 봇이 코어 주위
 * 고정 거리에 붙박여 실드 발생기 쪽으로 이동하지 않는다. 사격 조준은 sim 자동 조준
 * (`isPlayerTargetable`)이 따로 잡으므로, 여기서는 **이동을 만들어 내는** 표적만 고른다.
 */
function nearestTarget(world: WorldState, player: Entity): Entity | undefined {
  let best: Entity | undefined;
  let bestD = Infinity;
  for (const e of world.entities) {
    if (e.dead) continue;
    if (
      e.kind !== 'enemy' &&
      e.kind !== 'boss' &&
      e.kind !== 'defenseBoss' &&
      e.kind !== 'guardian' &&
      e.kind !== 'prop' &&
      e.kind !== 'facilityGun' &&
      e.kind !== 'facilityHazard' &&
      e.kind !== 'facilitySpawner'
    )
      continue;
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
 * 살아 있는 최근접 **무대 목표**(추격 = 미확보 대피소 · 오염 = 오염 노드). 그 목표를 쓰는 모드가
 * 아니면 엔티티를 훑지도 않는다 — 다른 무대에서 이 함수는 항상 `undefined` 라 거동·비용이
 * 모두 불변이다.
 *
 * 동률은 id 오름차순으로 깨 플랫폼 순회 순서에 의존하지 않는다(`nearestTarget` 과 동일 규약).
 */
function nearestObjective(world: WorldState, player: Entity): Entity | undefined {
  const mode = world.config.planetMode;
  if (mode !== PLANET_MODE.chase && mode !== PLANET_MODE.contamination) return undefined;
  // 추격의 목표는 **파괴물이 아니라 미확보 대피소**다(2026-08-05 재설계). 봇이 이것을 쫓지
  // 않으면 니플헤임 런이 영영 진행되지 않아 밸런스 하네스 전체가 타임아웃으로 채워진다 —
  // 조준 목록(`isObjectiveDestructible`)과 달리 이쪽은 **이동 표적**이라 별도 분기가 맞다.
  const chase = mode === PLANET_MODE.chase;
  let best: Entity | undefined;
  let bestD = Infinity;
  for (const e of world.entities) {
    if (e.dead) continue;
    if (chase ? !(isShelter(e) && !isShelterSecured(e)) : !isObjectiveDestructible(e)) continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    const d = dx * dx + dy * dy;
    if (d < bestD || (d === bestD && best !== undefined && e.id < best.id)) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/**
 * 수거 반경 안의 최근접 바닥 전리품. 반경 밖이면 undefined —
 * 봇이 무대를 가로질러 전리품만 쫓아다니지 않도록 가둔다.
 *
 * ## 왜 젬이 아니라 전리품인가
 * 젬은 이미 카이팅 이동(④)이 지나가며 쓸어담는다(적이 죽은 자리 = 카이팅 중심). 바닥에
 * 남는 것은 **엘리트 전리품**이고, 그것은 적 무리에서 떨어진 자리에 떨어져 우연히 지나갈
 * 확률이 낮다. 실측 미수거 0.99/런이 그 값이다.
 */
function nearestPickup(world: WorldState, player: Entity): Entity | undefined {
  let best: Entity | undefined;
  let bestD = LOOT_SEEK_RADIUS * LOOT_SEEK_RADIUS;
  for (const e of world.entities) {
    if (e.dead || e.kind !== 'loot') continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    const d = dx * dx + dy * dy;
    // 동률은 id 오름차순으로 깨 플랫폼 순회 순서에 의존하지 않는다(`nearestTarget` 과 동일 규약).
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
