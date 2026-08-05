/**
 * 액티브 스킬 핸들러 **계약 + 공용 효과 헬퍼**(ADR-0041 · 0c 동결 대상).
 *
 * `src/sim/actives.ts`(엔진)와 `src/sim/activeHandlers/<ship>.ts`(효과 함수) 양쪽이 이 모듈만
 * 본다. 기체별 핸들러 파일이 서로를 import 하지 않으므로 **레인이 파일 단위로 배타**가 된다.
 *
 * ## 계층 규율
 * `world.ts` 는 **타입으로만** import 한다(런타임 import 금지 — world.ts 가 엔진을 런타임
 * import 하므로 순환이 된다). 엔티티 생성은 leaf 인 `entities.ts`, 벽 판정은 leaf 인 `los.ts`.
 *
 * ## 0c 계약 (레인은 이 타입을 변경하지 않는다)
 * 1. 핸들러 시그니처 `(state, player, def, dir, slot) => void`
 *    - `player` 를 인자로 받아야 핸들러가 `getPlayer(state)` 때문에 `world.ts` 를 import 하지
 *      않는다(계층 붕괴 방지).
 *    - `dir` 이 필요한 이유: `mx`/`my` 는 `stepPlayer` 의 **지역 변수**이고 `WorldState` 는
 *      입력을 보관하지 않는다. 방향 해소는 `world.ts` 의 `resolveDirFallback`(대시와 **같은
 *      규칙 재사용**)이 하고 결과만 여기로 넘어온다.
 *    - `slot` 이 필요한 이유: `kind='buff'` 가 자기 잔여 틱 필드를 **직접** 세워야 한다.
 * 2. **작성자 분리** — 공통 발동 코드는 쿨다운 2개만 세운다. 버프 잔여 틱 2개는 핸들러가
 *    세운다(공통 코드는 감소만). 이걸 어기면 `buffTicks` 관측량 단언이 핸들러 본문과 무관하게
 *    참이 되어 배선 전수 테스트 ②가 항진이 된다(계획 개정 3 CR-1 과 같은 기제의 재발).
 * 3. `aux0/aux1` 인코딩 표(`src/sim/world.ts:1721-1731`)를 지킨다.
 */

import type { WorldState } from './world.js';
import type { Entity } from './entities.js';
import { spawnBullet } from './entities.js';
import { slideCircleWalls } from './los.js';
import { activePowerCenti, investedInTree, wireIdOf } from '../../data/ships/actives/index.js';
import type { ActiveSkillDef } from '../../data/ships/actives/types.js';

/** 발동 효과. **부수효과만**(반환값 없음). */
export type ActiveHandler = (
  state: WorldState,
  player: Entity,
  def: ActiveSkillDef,
  dir: { x: number; y: number },
  slot: number,
) => void;

/** `kind='buff'` 지속 중 매 틱 훅(선택). 잔여 틱이 아직 양수인 틱마다 호출된다. */
export type ActiveSustain = (state: WorldState, player: Entity, def: ActiveSkillDef) => void;

/** `kind='buff'` 만료 틱 훅(선택). 잔여 틱이 양수 → 0 이 된 그 틱에 한 번 호출된다. */
export type ActiveExpire = (state: WorldState, player: Entity, def: ActiveSkillDef) => void;

export type ActiveHandlerTable = Readonly<Record<string, ActiveHandler>>;
export type ActiveSustainTable = Readonly<Record<string, ActiveSustain>>;
export type ActiveExpireTable = Readonly<Record<string, ActiveExpire>>;

// ---------------------------------------------------------------------------
// 공용 효과 헬퍼 — 3결의 **관측량**을 실제로 만드는 곳
//
// 핸들러가 관측량을 만들지 않으면 배선 전수 테스트 ②가 실패한다:
//   strike → 투사체 개수 증가 · dash → 좌표 변화 · buff → 잔여 틱 양수
// ---------------------------------------------------------------------------

/**
 * `def` 가 장착된 슬롯(0/1)의 조율 누적(`WorldState.activeTune0/1`, E7). 미장착이면 0.
 *
 * ⚠️ **왜 슬롯을 인자로 안 받는가.** 이 파일 헤더의 0c 계약 1번이 핸들러/엔진이 공유하는
 * `powerCentiOf(state, def)` 시그니처를 동결한다 — 바꾸면 `src/sim/activeHandlers/*.ts` 7개
 * 전 호출부가 갈린다. 그래서 `slot` 을 직접 받는 대신 `config.activeSlots` 에서 `def` 의
 * wire id 를 역탐색한다. 같은 스킬이 두 슬롯에 동시에 있을 수는 없지만(장착 규칙), 있어도
 * **첫 번째(슬롯 0)** 를 쓰기로 고정해 결정론을 지킨다.
 */
function tuneSlotOf(state: WorldState, def: ActiveSkillDef): number {
  const slots = state.config.activeSlots;
  if (slots === undefined) return 0;
  const wire = wireIdOf(def.id);
  const idx = slots.indexOf(wire);
  if (idx === 0) return state.activeTune0;
  if (idx === 1) return state.activeTune1;
  return 0;
}

/** 그 스킬의 실효 위력 배율(centi 정수). `skillInvest` + 조율(E7) 파생이라 별도 저장이 없다. */
export function powerCentiOf(state: WorldState, def: ActiveSkillDef): number {
  const invested = investedInTree(state.config.skillInvest ?? [], def) + tuneSlotOf(state, def);
  return activePowerCenti(def, invested);
}

/** centi 정수 배율 적용(정수 유지 — 부동소수는 결정론 위험). */
export function scaleCenti(v: number, centi: number): number {
  return Math.round((v * centi) / 100);
}

/**
 * `kind='strike'` 공용 — 발동 방향을 중심으로 부채꼴 탄막을 낸다.
 * 관측량 = **투사체 개수**.
 */
export function fanStrike(
  state: WorldState,
  player: Entity,
  count: number,
  damage: number,
  spreadDeg: number,
  dir: { x: number; y: number },
  opts: { pierce?: number; speedCenti?: number; radiusCenti?: number } = {},
): void {
  if (count <= 0) return;
  const base = Math.atan2(dir.y, dir.x);
  const spread = (spreadDeg * Math.PI) / 180;
  const step = count > 1 ? spread / (count - 1) : 0;
  const start = base - spread / 2;
  const speed = scaleCenti(state.weapon.bulletSpeed, opts.speedCenti ?? 100);
  const radius = scaleCenti(state.weapon.bulletRadius, opts.radiusCenti ?? 100);
  for (let i = 0; i < count; i++) {
    const a = start + step * i;
    spawnBullet(
      state,
      player.x,
      player.y,
      a,
      speed,
      damage,
      opts.pierce ?? 0,
      radius,
      state.weapon.bulletLife,
      Math.cos(a),
      Math.sin(a),
    );
  }
}

/**
 * `kind='dash'` 공용 — 발동 방향으로 즉시 변위한다. 관측량 = **좌표 변화**.
 * 벽 슬라이드를 태워 관통을 막는다(`stepPlayer` 와 같은 규율).
 */
export function blink(
  state: WorldState,
  player: Entity,
  distance: number,
  dir: { x: number; y: number },
): void {
  const preX = player.x;
  const preY = player.y;
  player.x += dir.x * distance;
  player.y += dir.y * distance;
  if (state.activeWalls.length > 0) {
    const slid = slideCircleWalls(player.x, player.y, player.radius, state.activeWalls, preX, preY);
    player.x = slid.x;
    player.y = slid.y;
  }
}

/**
 * 슬롯의 버프 잔여 틱을 **세운다** — `kind='buff'` 핸들러 전용.
 * ⚠️ 공통 발동 코드(`stepActives`)는 이 함수를 부르지 않는다(0c 계약 2번).
 */
export function setBuffTicks(state: WorldState, slot: number, ticks: number): void {
  if (slot === 0) state.activeBuff0 = ticks;
  else state.activeBuff1 = ticks;
}

/** 반경 안의 적·보스에게 즉시 피해. 폭발형 효과의 공용 형태. */
export function blastDamage(
  state: WorldState,
  player: Entity,
  radius: number,
  damage: number,
): void {
  const r2 = radius * radius;
  for (const e of state.entities) {
    if (e.dead) continue;
    if (e.kind !== 'enemy' && e.kind !== 'boss') continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    if (dx * dx + dy * dy <= r2) e.hp -= damage;
  }
}

/** 반경 안의 적탄을 소거한다(회피형 효과의 공용 형태). */
export function clearEnemyBullets(state: WorldState, player: Entity, radius: number): void {
  const r2 = radius * radius;
  for (const e of state.entities) {
    if (e.kind !== 'enemyBullet' || e.dead) continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    if (dx * dx + dy * dy <= r2) e.dead = true;
  }
}
