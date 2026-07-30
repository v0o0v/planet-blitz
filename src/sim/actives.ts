/**
 * 액티브 스킬 발동 엔진 — **핸들러 테이블의 단일 정본**(ADR-0041 · 계획 0a-10/0b-2).
 *
 * ## 왜 레지스트리(`data/ships/actives/`)와 물리적으로 분리돼 있는가
 * 한 파일 한 키로 합치면 두 테이블이 하나가 되어 **배선 전수 테스트가 구조적 항진**이 된다
 * (계획 PM-1). 분리돼 있어야 "레지스트리에는 있는데 핸들러가 없다"는 상태가 실제로 존재
 * 가능하고, `tests/activeSkillWiring.test.ts` 의 존재 대조가 의미를 갖는다.
 *
 * ## 계층 규율
 * 이 모듈은 `world.ts` 를 **타입으로만** import 한다(런타임 import 금지 — world.ts 가 이
 * 모듈을 런타임 import 하므로 순환이 된다). 엔티티 생성은 leaf 인 `entities.ts`, 벽 슬라이드는
 * leaf 인 `los.ts`, 시그니처 산술은 leaf 인 `shipSignature.ts` 를 직접 부른다.
 *
 * ## 작성자 분리 (0c 계약 — 어기면 검증이 항진이 된다)
 * **공통 발동 코드(`stepActives`)는 쿨다운 2개만 세운다. 버프 잔여 틱 2개는 핸들러가 세운다.**
 * 공통 코드가 버프 틱까지 세우면 `buffTicks` 관측량 단언이 핸들러 본문과 무관하게 참이 되어
 * 배선 전수 테스트 ②가 항진이 된다(계획 개정 3 CR-1 과 같은 기제).
 * 매 틱 **감소**는 공통 코드가 한다 — 감소는 0 에서 양수로 올리지 못하므로 항진이 아니다.
 *
 * ## `aux0/aux1` 은 인코딩 표를 지켜야 한다
 * 정본은 `src/sim/world.ts:1721-1731`. 브루저 `aux0` = 장갑 스택(0..8) · `aux1` = 마지막 피격
 * 이후 경과 틱. 표를 어기면 시그니처 상태가 **조용히** 손상된다.
 */

import type { WorldState, InputFrame } from './world.js';
import type { Entity } from './entities.js';
import { spawnBullet } from './entities.js';
import { slideCircleWalls } from './los.js';
import { ARMOR_MAX_STACKS, clampArmorStacks } from './shipSignature.js';
import { SPECIAL_ACTIVE_SLOT1, SPECIAL_ACTIVE_SLOT2 } from '../../data/inputBits.js';
import {
  activeByWireId,
  activeCooldownTicks,
  activePowerCenti,
  investedInTree,
} from '../../data/ships/actives/index.js';
import type { ActiveSkillId } from '../../data/ships/actives/index.js';
import type { ActiveSkillDef } from '../../data/ships/actives/types.js';
import { ACTIVE_SLOT_COUNT } from '../../data/ships/actives/types.js';

/**
 * 액티브 1종의 발동 효과. **부수효과만**(반환값 없음).
 *
 * @param state  라이브 월드.
 * @param player 플레이어 엔티티. `world.ts:1721-1731` 인코딩 표를 지켜 `aux0/aux1` 을 쓴다.
 * @param def    자기 정의(계수·티어).
 * @param dir    발동 방향(정규화 벡터). 이동 입력 방향, 정지 중이면 조준각 — 대시와 동일
 *               규칙이며 해소는 `world.ts` 의 `resolveDirFallback` 이 한다(재사용, 복제 아님).
 * @param slot   슬롯 인덱스(0/1). `kind='buff'` 핸들러가 자기 잔여 틱 필드를 쓰는 축.
 */
export type ActiveHandler = (
  state: WorldState,
  player: Entity,
  def: ActiveSkillDef,
  dir: { x: number; y: number },
  slot: number,
) => void;

/**
 * `kind='buff'` 의 **지속 중 매 틱** 훅(선택). 잔여 틱이 아직 양수인 틱마다 호출된다.
 * 없으면 지속 동안 아무 유지 동작이 없다는 뜻이다(순수 타이머형 버프).
 */
export type ActiveSustain = (state: WorldState, player: Entity, def: ActiveSkillDef) => void;

/** `kind='buff'` 의 **만료 틱** 훅(선택). 잔여 틱이 양수 → 0 이 된 그 틱에 한 번 호출된다. */
export type ActiveExpire = (state: WorldState, player: Entity, def: ActiveSkillDef) => void;

// ---------------------------------------------------------------------------
// 공통 헬퍼 — 3결의 관측량을 실제로 만드는 곳
// ---------------------------------------------------------------------------

/** centi 정수 배율 적용(정수 유지). */
function scaleCenti(v: number, centi: number): number {
  return Math.round((v * centi) / 100);
}

/**
 * `kind='strike'` 공통 — 발동 방향을 중심으로 부채꼴 탄막을 낸다.
 * **관측량은 투사체 개수**다(배선 전수 테스트 ②가 대조군 대비 증가를 단언한다).
 */
function fanStrike(
  state: WorldState,
  player: Entity,
  count: number,
  damage: number,
  spreadDeg: number,
  dir: { x: number; y: number },
): void {
  if (count <= 0) return;
  const base = Math.atan2(dir.y, dir.x);
  const spread = (spreadDeg * Math.PI) / 180;
  const step = count > 1 ? spread / (count - 1) : 0;
  const start = base - spread / 2;
  const speed = state.weapon.bulletSpeed;
  for (let i = 0; i < count; i++) {
    const a = start + step * i;
    spawnBullet(
      state,
      player.x,
      player.y,
      a,
      speed,
      damage,
      0,
      state.weapon.bulletRadius,
      state.weapon.bulletLife,
      Math.cos(a),
      Math.sin(a),
    );
  }
}

/**
 * `kind='dash'` 공통 — 발동 방향으로 즉시 변위한다.
 * **관측량은 변위**다. 벽 슬라이드를 태워 관통을 막는다(`stepPlayer` 와 같은 규율).
 */
function blink(state: WorldState, player: Entity, distance: number, dir: { x: number; y: number }): void {
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

/** 슬롯의 버프 잔여 틱 쓰기 — **핸들러 전용**(공통 발동 코드는 이 함수를 부르지 않는다). */
function setBuffTicks(state: WorldState, slot: number, ticks: number): void {
  if (slot === 0) state.activeBuff0 = ticks;
  else state.activeBuff1 = ticks;
}

/** 브루저 장갑 스택 = `aux0`. 인코딩 표(`world.ts:1721-1731`)를 지켜 clamp 후 쓴다. */
function setArmorStacks(player: Entity, stacks: number): void {
  player.aux0 = clampArmorStacks(stacks);
}

// ---------------------------------------------------------------------------
// 핸들러 테이블 (42종 전수 — 지금은 브루저 6종 = 0b 파일럿)
// ---------------------------------------------------------------------------

/**
 * id → 발동 효과. **레지스트리 42종 전수**여야 한다.
 *
 * ⚠️ 여기 없는 id 는 레지스트리에 있어도 발동 시 **쿨다운만 돌고 아무 일도 안 난다** —
 * 이 저장소가 8번 겪은 "조용한 배선 누락"의 정확한 형태다. 그래서 존재 대조 테스트(①)와
 * 관측량 델타 테스트(②)가 둘 다 걸려 있고, 뮤테이션 M-①·M-①b 가 그 둘을 압박한다.
 */
const HANDLERS = {
  // --- 브루저 (aux0 = 장갑 스택 0..8 · aux1 = 마지막 피격 이후 경과 틱) --------------------
  as_bruiser_blade_lo: (state, player, def, dir) => {
    // 쌓인 스택을 **전부 태워** 파편으로 환산한다(방어 자원 → 화력).
    const stacks = clampArmorStacks(player.aux0);
    const centi = activePowerCenti(def, investedInTree(state.config.skillInvest ?? [], def));
    const count = (def.coeff.base ?? 0) + (def.coeff.perStack ?? 0) * stacks;
    fanStrike(state, player, count, scaleCenti(def.coeff.damage ?? 0, centi), def.coeff.spreadDeg ?? 0, dir);
    setArmorStacks(player, 0);
  },
  as_bruiser_blade_hi: (state, player, def, dir) => {
    // 먼저 만재로 충전하고 같은 틱에 전량 소모한다 — "충전 → 전환"이 고티어의 정체성이다.
    setArmorStacks(player, ARMOR_MAX_STACKS);
    const centi = activePowerCenti(def, investedInTree(state.config.skillInvest ?? [], def));
    fanStrike(
      state,
      player,
      def.coeff.base ?? 0,
      scaleCenti(def.coeff.damage ?? 0, centi),
      def.coeff.spreadDeg ?? 0,
      dir,
    );
    setArmorStacks(player, 0);
  },
  as_bruiser_morph_lo: (state, player, def, dir) => {
    blink(state, player, def.coeff.distance ?? 0, dir);
    setArmorStacks(player, player.aux0 + (def.coeff.stacks ?? 0));
    player.aux1 = 0; // 감쇠 타이머 리셋(부딪히며 장갑이 붙는다).
  },
  as_bruiser_morph_hi: (state, player, def, dir) => {
    blink(state, player, def.coeff.distance ?? 0, dir);
    setArmorStacks(player, def.coeff.stacks ?? 0);
    player.aux1 = 0;
  },
  as_bruiser_fortify_lo: (state, player, def, _dir, slot) => {
    setBuffTicks(state, slot, def.coeff.ticks ?? 0);
    setArmorStacks(player, ARMOR_MAX_STACKS);
    player.aux1 = 0;
  },
  as_bruiser_fortify_hi: (state, player, def, _dir, slot) => {
    setBuffTicks(state, slot, def.coeff.ticks ?? 0);
    setArmorStacks(player, ARMOR_MAX_STACKS);
    player.aux1 = 0;
  },
} satisfies Record<ActiveSkillId, ActiveHandler>;

/**
 * 런타임 조회용 뷰. `satisfies` 는 **컴파일 타임 전수**를 보증하고(누락 = 타입 에러), 이
 * 넓힌 타입은 런타임 존재 대조 테스트가 문자열 키로 조회할 수 있게 한다. 둘 다 필요하다 —
 * vitest 는 esbuild transpile-only 라 타입 검사를 하지 않으므로, `satisfies` 만 믿으면
 * "런타임 대조가 실제로 도는지"가 증명되지 않는다(뮤테이션 M-① 기록 형식).
 */
export const ACTIVE_HANDLERS: Readonly<Record<string, ActiveHandler>> = HANDLERS;

/** 지속 중 매 틱 유지 훅. */
export const ACTIVE_SUSTAIN: Readonly<Record<string, ActiveSustain>> = {
  // 지속 동안 스택을 만재로 고정하고 감쇠 타이머를 눌러 둔다(ARMOR_DECAY_TICKS 차단).
  as_bruiser_fortify_lo: (_state, player) => {
    setArmorStacks(player, ARMOR_MAX_STACKS);
    player.aux1 = 0;
  },
  as_bruiser_fortify_hi: (_state, player) => {
    setArmorStacks(player, ARMOR_MAX_STACKS);
    player.aux1 = 0;
  },
};

/** 만료 틱 훅. */
export const ACTIVE_EXPIRE: Readonly<Record<string, ActiveExpire>> = {
  // 고정이 끝나는 순간 장갑 전량을 폭발로 전환한다 — 반경 안의 적에게 즉시 피해.
  as_bruiser_fortify_hi: (state, player, def) => {
    const centi = activePowerCenti(def, investedInTree(state.config.skillInvest ?? [], def));
    const r = def.coeff.blastRadius ?? 0;
    const r2 = r * r;
    const dmg = scaleCenti(def.coeff.blastDamage ?? 0, centi);
    for (const e of state.entities) {
      if (e.dead) continue;
      if (e.kind !== 'enemy' && e.kind !== 'boss') continue;
      const dx = e.x - player.x;
      const dy = e.y - player.y;
      if (dx * dx + dy * dy <= r2) e.hp -= dmg;
    }
    setArmorStacks(player, 0);
  },
};

// ---------------------------------------------------------------------------
// 틱 진행
// ---------------------------------------------------------------------------

/** 슬롯 인덱스 → 쿨다운 필드 읽기. */
function cooldownOf(state: WorldState, slot: number): number {
  return slot === 0 ? state.activeCd0 : state.activeCd1;
}

/** 슬롯 인덱스 → 쿨다운 필드 쓰기(공통 발동 코드 전용). */
function setCooldown(state: WorldState, slot: number, ticks: number): void {
  if (slot === 0) state.activeCd0 = ticks;
  else state.activeCd1 = ticks;
}

/** 슬롯 인덱스 → 버프 잔여 틱 읽기. */
function buffTicksOf(state: WorldState, slot: number): number {
  return slot === 0 ? state.activeBuff0 : state.activeBuff1;
}

/** 슬롯에 장착된 정의(미장착·미지 wire·타입 불일치면 undefined). */
function defForSlot(state: WorldState, slot: number): ActiveSkillDef | undefined {
  const wire = state.config.activeSlots?.[slot] ?? -1;
  const def = activeByWireId(wire);
  if (def === undefined) return undefined;
  // 기체 타입 고유(ADR-0041) — 손상 세이브가 다른 기체의 스킬을 실어도 발동하지 않는다.
  return def.shipTypeId === (state.config.shipType ?? 0) ? def : undefined;
}

/**
 * 한 틱의 액티브 처리 — **쿨다운·버프 감소 → 지속/만료 훅 → 발동 판정 → 핸들러 호출**.
 *
 * 호출 지점은 `stepWorld` 의 `stepPlayer(...)` **직후**다. `pendingLevelUp` 프리즈와 detour
 * 분기가 그보다 **위에서 조기 return** 하므로, 프리즈 중 z/x 는 큐잉되지 않고 **구조적으로
 * 버려진다**(AC-8·AC-9). 발동 호출을 그 위로 옮기지 마라.
 *
 * 미장착 런(`config.activeSlots` 부재)에서는 쿨다운·버프 정수가 끝까지 0 이라 `hashWorld`
 * 꼬리 폴드가 한 번도 실행되지 않는다 → 골든 바이트 불변.
 */
export function stepActives(
  state: WorldState,
  player: Entity,
  input: InputFrame,
  dir: { x: number; y: number },
): void {
  // 쿨다운 감소(공통 코드 소유).
  if (state.activeCd0 > 0) state.activeCd0--;
  if (state.activeCd1 > 0) state.activeCd1--;

  for (let slot = 0; slot < ACTIVE_SLOT_COUNT; slot++) {
    // 버프 잔여 틱 **감소**만 공통 코드가 한다(세우는 것은 핸들러 몫 — 위 작성자 분리 참조).
    const before = buffTicksOf(state, slot);
    if (before > 0) setBuffTicks(state, slot, before - 1);
    const after = buffTicksOf(state, slot);
    const def = defForSlot(state, slot);
    if (def !== undefined) {
      if (after > 0) ACTIVE_SUSTAIN[def.id]?.(state, player, def);
      else if (before > 0) ACTIVE_EXPIRE[def.id]?.(state, player, def);
    }
  }

  if (state.config.activeSlots === undefined) return;

  const invest = state.config.skillInvest ?? [];
  for (let slot = 0; slot < ACTIVE_SLOT_COUNT; slot++) {
    const bit = slot === 0 ? SPECIAL_ACTIVE_SLOT1 : SPECIAL_ACTIVE_SLOT2;
    if ((input.special & bit) === 0) continue;
    // 쿨다운 중 재입력은 **무시**한다(큐잉 금지 — AC-2).
    if (cooldownOf(state, slot) > 0) continue;
    const def = defForSlot(state, slot);
    if (def === undefined) continue;
    ACTIVE_HANDLERS[def.id]?.(state, player, def, dir, slot);
    setCooldown(state, slot, activeCooldownTicks(def, investedInTree(invest, def)));
  }
}
