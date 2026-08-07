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
import { cos, sin } from './math.js';
import {
  WEAPON_TYPE_SPREAD,
  WEAPON_TYPE_RAILGUN,
  WEAPON_TYPE_MISSILE,
  WEAPON_TYPE_BEAM,
  MISSILE_MARK,
  BEAM_SEGMENT_SPACING,
  BEAM_SEGMENT_RADIUS,
  BEAM_SEGMENT_LIFE,
} from './constants.js';
import { hasUnique, UQ_TWIN_STAR, TWIN_STAR_DAMAGE_MULT } from './uniques.js';
// `VolleyParams` 는 타입으로만 당긴다 — `skillHooks.ts` 는 이 파일을 모르므로 순환이 아니고,
// 값으로 당기면 그 파일의 `onVolleyFiredCatalyst` 등 런타임 초기화를 불필요하게 끌고 온다.
import type { VolleyParams } from './skillHooks.js';

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

/**
 * **임의 좌표 중심** 반경 안의 적·보스에게 즉시 피해. 폭발형 효과의 공용 형태.
 *
 * ⚠️ **엔티티를 낳지 않는다** — `hp` 를 깎고 `dead` 플래그만 세운다. 그래서
 * `for (const e of state.entities)` 순회 **안**에서 불러도 배열이 변형되지 않는다(아크캐스터
 * CH3 이 앵커 ⑥ 에서 그렇게 쓴다). 이 성질을 깨는 개조(파편·이펙트 스폰)를 여기 넣지 마라 —
 * 넣으려면 호출부가 `splitSpawns` 처럼 목록을 모아 루프 뒤에 비워야 한다.
 *
 * ## `hp <= 0` 이면 그 자리에서 `dead` 를 세운다 (선결 과제 ⑨)
 * `compact()`(`world.ts`)는 **`dead === true` 만 수거**한다 — `hp <= 0` 단독으로는 안 걷는다.
 * 마킹을 빼면 폭발로 hp≤0 이 된 적이 **좀비**로 남아 계속 움직이고 공격하며, 처치·젬·전리품이
 * 전부 유실된다. 형태는 `status.ts` 의 `applyChain`·`tickEnemyStatus` 와 같다 — 플래그만 세우고
 * 집계는 `compact()` 단일 수렴점에 맡긴다(그래서 킬이 두 벌이 되지 않는다).
 *
 * 보스도 같이 마킹한다: `world.ts` 의 탄 명중 경로가 `hp <= 0` 에서 boss 를 예외 없이 `dead` 로
 * 세우기 때문이다(예외는 guardian 재기동·core 부활뿐인데, 둘 다 여기서 훑는 kind 가 아니다).
 * 폭발만 다르게 두면 같은 사실에 대한 진실이 두 벌이 된다.
 */
export function blastDamageAt(
  state: WorldState,
  x: number,
  y: number,
  radius: number,
  damage: number,
): void {
  const r2 = radius * radius;
  for (const e of state.entities) {
    if (e.dead) continue;
    if (e.kind !== 'enemy' && e.kind !== 'boss') continue;
    const dx = e.x - x;
    const dy = e.y - y;
    if (dx * dx + dy * dy <= r2) {
      e.hp -= damage;
      if (e.hp <= 0) e.dead = true;
    }
  }
}

/**
 * 반경 안의 적·보스에게 즉시 피해 — **플레이어 중심 고정**.
 * 동결 5종이 쓰는 시그니처라 인자를 바꾸지 않고 {@link blastDamageAt} 에 위임한다
 * (위임이라 반복 순서·부동소수 연산이 종전과 비트 동일).
 */
export function blastDamage(
  state: WorldState,
  player: Entity,
  radius: number,
  damage: number,
): void {
  blastDamageAt(state, player.x, player.y, radius, damage);
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

// ---------------------------------------------------------------------------
// emitVolley — 주무기 볼리 1벌의 **발사 자체** (배치7 F2b, W2b 「발사부 leaf 화」 선결)
// ---------------------------------------------------------------------------
//
// `world.ts` 의 `autoAttack` 이 사설(비-export)이고 표적을 자기 안에서 골라(`nearestTarget`)
// leaf 가 재사용할 수 없었다 — `activeHandlers/striker.ts:92-95` 의 주석이 그 사실을 이미 적어
// 뒀다("M8 은 여기 없다, autoAttack 이 world 비공개라 leaf 가 못 부른다"). `nearestTarget` 자체는
// 여전히 `world.ts` 소유(leaf 런타임 import 금지 계약)이므로, 이 함수는 **표적 선택을 통째로
// 인자(`angle`)로 받아** 그 문제를 비켜간다 — 아키타입별 탄 스폰(레일건·미사일·빔·발칸/스프레드
// + 쌍둥이 항성 유니크 배율)만 한다.

/**
 * 주무기 볼리 1벌을 **실제로 쏜다**. `world.ts` 의 `autoAttack` 아키타입 분기를 그대로 뽑았다 —
 * 거동은 추출 전후 비트 동일(`tests/volleyExtraction.test.ts` 가 해시로 잠근다).
 *
 * ## 계약 — 위반하면 F10「연장 탄창」·M8「도약 사격」이 원리적으로 성립하지 않는다
 *  · **`player.cooldown` 을 한 비트도 안 만진다.** 소비(감산)도 적립(`+=`)도 호출부 책임이다.
 *    두 스킬은 "쿨다운을 소비하지 않는 추가 볼리" 이므로, 이 함수가 쿨다운을 스스로 적립하면
 *    추가 호출마다 정상 발사 리듬이 흔들린다.
 *  · **표적을 스스로 고르지 않는다.** `angle` 은 호출부가 이미 확정한 발사 방위다(자동조준이든
 *    액티브가 정한 고정 방향이든). `nearestTarget` 은 `world.ts` 소유라 이 leaf 는 부를 수 없다
 *    (계층 규율 — 이 파일 헤더).
 *  · **`state.weapon` 의 아키타입(`weaponType`)으로 스스로 분기한다.** 별도 아키타입 인자를 받지
 *    않는 이유는 이 함수가 대표하는 발사가 전부 "지금 장착한 무기로 한 벌 더 쏜다" 이기
 *    때문이다 — F10·M8 둘 다 주무기 스탯을 그대로 쓴다(새 무기를 만들지 않는다).
 *  · **RNG 를 소비하지 않는다**(`spawnBullet`·삼각함수 전부 결정론 — 원본 `autoAttack` 과 동일).
 *
 * @param angle 이 볼리의 발사 방위(rad). `volley.aimAngle` 을 그대로 넘겨라(원본은 `onVolleyParams`
 *   실행 **뒤**의 값을 썼다 — 훅이 고칠 수 있는 값이므로 미리 캡처해 두지 마라).
 * @param volley 발사 파라미터. **원본 레코드를 그대로** 넘겨야 한다 — 복사본을 만들면 `mark`·
 *   `recordSpawnDamage`·`recordSpawnOrigin` 등 앵커 ⑯ 이 이미 채운 값이 갈릴 수 있다.
 * @param reach 이 볼리의 사거리. **빔 분기만** 세그먼트 커버리지 산정에 쓴다(`weaponReach` 가
 *   이미 상한을 잘라 준 값). `VolleyParams` 에 넣지 않은 이유는 그 인터페이스가 6개 기체
 *   테스트 픽스처에 값을 채워야 하는 필수 필드로 걸리기 때문이다(그 파일의 "선택 필드다"
 *   규율과 같은 사유 — 별도 인자로 받는 편이 기존 픽스처를 하나도 안 건드린다).
 */
export function emitVolley(
  state: WorldState,
  player: Entity,
  angle: number,
  volley: VolleyParams,
  reach: number,
): void {
  if (state.weapon.weaponType === WEAPON_TYPE_RAILGUN) {
    const b = spawnBullet(
      state,
      player.x,
      player.y,
      angle,
      volley.speed,
      // 레일건의 유일한 한 발이 곧 **선두탄**이다(증분 0 이면 종전 값 그대로).
      volley.damage + volley.leadDamageBonus,
      volley.pierce + volley.leadPierceBonus,
      volley.radius,
      volley.life,
      cos(angle),
      sin(angle),
    );
    if (volley.mark !== 0) b.aux0 = volley.mark;
    if (volley.recordSpawnDamage) b.aux1 = Math.round(b.damage);
    if (volley.recordSpawnOrigin === true) b.targetX = b.life;
    return;
  }

  if (state.weapon.weaponType === WEAPON_TYPE_MISSILE) {
    const n = volley.count < 1 ? 1 : volley.count;
    const start = n > 1 ? angle - volley.spread / 2 : angle;
    const stepA = n > 1 ? volley.spread / (n - 1) : 0;
    for (let i = 0; i < n; i++) {
      const ang = start + stepA * i;
      const m = spawnBullet(
        state,
        player.x,
        player.y,
        ang,
        volley.speed,
        // 선두 = 부채 시작단(`i === 0`). 증분 0 이면 종전 값 그대로다.
        i === 0 ? volley.damage + volley.leadDamageBonus : volley.damage,
        i === 0 ? volley.pierce + volley.leadPierceBonus : volley.pierce,
        volley.radius,
        volley.life,
        cos(ang),
        sin(ang),
      );
      m.ownerId = MISSILE_MARK; // 유도 마커: stepProjectiles가 매 틱 제한 선회.
      if (volley.mark !== 0) m.aux0 = volley.mark;
      if (volley.recordSpawnDamage) m.aux1 = Math.round(m.damage);
      if (volley.recordSpawnOrigin === true) m.targetX = m.life;
    }
    return;
  }

  if (state.weapon.weaponType === WEAPON_TYPE_BEAM) {
    // 타격선은 `reach` 만큼 깐다 — 상한 클램프가 따로 없는 이유는 호출부(`weaponReach`)가
    // 이미 BEAM_MAX_REACH 로 잘라 주기 때문이다(원본 주석 그대로, `world.ts` `weaponReach`).
    let segs = Math.floor(reach / BEAM_SEGMENT_SPACING);
    if (segs < 1) segs = 1;
    const ca = cos(angle);
    const sa = sin(angle);
    for (let i = 1; i <= segs; i++) {
      const dist = i * BEAM_SEGMENT_SPACING;
      const seg = spawnBullet(
        state,
        player.x + ca * dist,
        player.y + sa * dist,
        angle,
        0,
        // 빔의 선두 = 플레이어에 **가장 가까운** 세그먼트(`i === 1`).
        i === 1 ? volley.damage + volley.leadDamageBonus : volley.damage,
        9999,
        BEAM_SEGMENT_RADIUS,
        BEAM_SEGMENT_LIFE,
        ca,
        sa,
      );
      if (volley.mark !== 0) seg.aux0 = volley.mark;
      if (volley.recordSpawnDamage) seg.aux1 = Math.round(seg.damage);
    }
    return;
  }

  // 발칸 / 스프레드 — 쌍둥이 항성(유니크): 부채꼴 발사체 2배 + 발당 피해 ×TWIN_STAR_DAMAGE_MULT.
  // 미장착 시 n·dmg 그대로(거동 불변). 스프레드 파생 유니크이므로 스프레드 무기에서만 발화
  // (roll.ts 페어링과 정합). 발칸 등 타 무기에 롤될 수 없고, 설령 실려도 no-op.
  const mask = state.config.loadout?.uniqueMask ?? 0;
  const twinOn = hasUnique(mask, UQ_TWIN_STAR) && state.weapon.weaponType === WEAPON_TYPE_SPREAD;
  const n = twinOn ? volley.count * 2 : volley.count;
  const dmg = twinOn ? volley.damage * TWIN_STAR_DAMAGE_MULT : volley.damage;
  const start = n > 1 ? angle - volley.spread / 2 : angle;
  const stepA = n > 1 ? volley.spread / (n - 1) : 0;
  for (let i = 0; i < n; i++) {
    const ang = start + stepA * i;
    const b = spawnBullet(
      state,
      player.x,
      player.y,
      ang,
      volley.speed,
      i === 0 ? dmg + volley.leadDamageBonus : dmg,
      i === 0 ? volley.pierce + volley.leadPierceBonus : volley.pierce,
      volley.radius,
      volley.life,
      cos(ang),
      sin(ang),
    );
    if (volley.mark !== 0) b.aux0 = volley.mark;
    if (volley.recordSpawnDamage) b.aux1 = Math.round(b.damage);
    if (volley.recordSpawnOrigin === true) b.targetX = b.life;
  }
}
