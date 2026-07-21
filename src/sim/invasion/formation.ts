/**
 * 침공 L1 — 편대 스폰 (M7a · L3-formation 레인).
 *
 * L1(대기권 돌파, 종스크롤)에서 방어자가 웨이브 슬롯 6칸에 꽂은 편대를 **스크롤 진행에 맞춰
 * 순서대로** 전장에 올린다. 구 PvE 웨이브 디렉터(`updateWaves`)는 침공에서 아예 호출되지 않으며
 * (world.ts:703), 이 모듈이 침공 L1 의 유일한 적 공급원이다.
 *
 * ## 설계 규율 3가지
 * ① **RNG 미소비.** `spawnEnemy`(waves.ts:220)는 `waveRng.int` 로 첫 발사 쿨다운을 흩뿌려 RNG 를
 *    소비한다 → 금지. 반드시 `summonEnemy`(waves.ts:246, 고정 쿨다운·RNG 미소비)만 쓴다. 침공
 *    sim 이 RNG 를 한 번도 소비하지 않는 현행 규율(defense.ts:8-11)을 그대로 잇는다.
 * ② **플레이어 좌표 비의존.** 스폰 좌표는 `runtime.scrollX/scrollY`(sim 권위 스크롤 창)의 순수
 *    함수다. 플레이어가 어디 있든 편대는 같은 자리에 등장한다 — 강제 스크롤에서 "웨이브 슬롯 =
 *    진행 위치의 고정 등장 지점"이라는 기획 의미를 코드로 못박는다.
 * ③ **트리거는 상태 없는 정수 등식.** 슬롯 i 는 페이즈 진입 후 정확히
 *    `i * FORMATION_SLOT_INTERVAL_TICKS + member.delayTicks` 틱에 한 번 스폰한다. 등식(`===`)
 *    이라 "이미 스폰했는지" 를 기억할 필요가 없다 — sim 에 스폰 진행 상태를 추가하지 않아
 *    hashWorld 침공 블록도 넓힐 필요가 없고, 리플레이 재실행이 자동으로 재현된다.
 *
 * ## 좌표 규약 (L2-scroll-phase 와의 계약)
 * `runtime.scrollX/scrollY` 는 **스크롤 창의 중심** 월드 좌표(정수)다. L1 은 진행 방향이 -Y 이므로
 * 편대는 창 중심에서 {@link FORMATION_SPAWN_AHEAD} 만큼 **위쪽(-Y)** 에, 즉 화면 밖 전방에 나타난다.
 */

import type { Entity } from '../entities.js';
import type { WorldState } from '../world.js';
import { summonEnemy, avoidWalls } from '../waves.js';
import { invasionFireCooldown } from './guardianBridge.js';
import { ENEMY_BY_TYPE } from '../../../data/enemies.js';
import {
  FORMATIONS,
  formationById,
  formationPowerCp,
  ENTRY_STRAIGHT,
  ENTRY_FLANK,
  ENTRY_CHARGE,
  ENTRY_GLIDE,
  ENTRY_SNIPE,
  ENTRY_DRIFT,
} from '../../../data/invasion/formations.js';
import type { FormationDef } from '../../../data/invasion/formations.js';
import { CATALOG_FORMATION } from '../../../data/invasion/catalog.js';
import { INVASION_WAVE_SLOTS, PHASE_L1 } from './constants.js';
import type { InvasionRef, InvasionStepContext } from './types.js';
import {
  AFFIX_NO_CORE_HP_PCT,
  affixCooldown,
  affixDamage,
  affixEntryTick,
  affixHp,
  affixMaintenance,
  defenseAffixSet,
  resolveDefenseMods,
} from './affix.js';
import type { DefenseAffixMods, DefenseTriggerState } from './affix.js';

// ---------------------------------------------------------------------------
// 튜닝 상수 (전부 정수)
// ---------------------------------------------------------------------------

/**
 * 웨이브 슬롯 간 간격(틱). 6슬롯 × 720 = 4320틱(72초)로 L1 예산 5400틱(90초) 안에 마지막
 * 슬롯까지 전부 등장하고, 뒤에 18초의 정리 여유가 남는다.
 */
export const FORMATION_SLOT_INTERVAL_TICKS = 720;

/** 편대가 등장하는 지점의 창 중심 대비 전방 거리(월드 유닛). 화면 밖(OFFSCREEN_Y=680)보다 멀다. */
export const FORMATION_SPAWN_AHEAD = 1400;

/** {@link ENTRY_CHARGE} 편대가 추가로 물러나는 거리 — 가속 구간을 벌어준다. */
export const FORMATION_CHARGE_EXTRA_AHEAD = 600;

/** {@link ENTRY_FLANK} 편대가 좌우로 벌어지는 거리. 창 절반(960)보다 커서 화면 밖에서 진입한다. */
export const FORMATION_FLANK_OFFSET = 1180;

/** {@link ENTRY_FLANK} 편대는 정면 편대보다 가까이 붙어 들어온다(협공 타이밍). */
export const FORMATION_FLANK_AHEAD = 700;

/** 진입 속도(월드 유닛/초). 적 이동 컴포넌트가 곧 덮어쓰지만 첫 틱 거동·해시에 반영된다. */
export const FORMATION_ENTRY_SPEED = 240;

/** {@link ENTRY_GLIDE} 편대의 급강하 시작 고도 — 정면 편대보다 높은 곳에서 떨어진다. */
export const FORMATION_GLIDE_AHEAD = 1700;
/** {@link ENTRY_GLIDE} 편대의 하강 속도(정면 진입의 1.5배). 대각선 궤도를 만든다. */
export const FORMATION_GLIDE_SPEED_VY = 360;

/**
 * {@link ENTRY_SNIPE} 편대가 등장하는 얕은 거리. 화면 밖(OFFSCREEN_Y=680)보다는 멀어서
 * 팝인이 없지만 정면 편대(1400)보다 훨씬 가까워 곧바로 상단 저격선을 이룬다.
 */
export const FORMATION_SNIPE_AHEAD = 900;
/** {@link ENTRY_SNIPE} 편대의 하강 속도 — 거의 내려오지 않고 상단에 머무른다. */
export const FORMATION_SNIPE_SPEED_VY = 60;

/** {@link ENTRY_DRIFT} 편대가 추가로 물러나는 거리 — 봉쇄물을 미리 깔 여유를 준다. */
export const FORMATION_DRIFT_EXTRA_AHEAD = 200;
/** {@link ENTRY_DRIFT} 편대의 하강 속도 — 느리게 흘러내려 구간을 오래 점유한다. */
export const FORMATION_DRIFT_SPEED_VY = 80;

// ---------------------------------------------------------------------------
// 트리거·좌표 — 순수 함수(테스트가 직접 검증한다)
// ---------------------------------------------------------------------------

/** 슬롯 i 의 편대 트리거 틱(페이즈 진입 기준 상대). */
export function formationSlotTriggerTick(slotIndex: number): number {
  return slotIndex * FORMATION_SLOT_INTERVAL_TICKS;
}

/**
 * 구성원 1기의 실제 등장 틱(페이즈 진입 기준 상대). 슬롯 간격 + 구성원 지연에 **방어체 어픽스
 * 진입 가속**(`defEntryHastePct`)을 얹은 값이다 — 어픽스가 없으면 슬롯 트리거 + delayTicks
 * 그대로라 기존 스케줄과 비트 동일하다.
 *
 * 가속을 슬롯·지연 합계에 한 번만 걸어(각각 걸지 않고) 정수 반올림이 1회만 끼게 한다. 결과가
 * 여전히 (슬롯, 구성원, 어픽스)의 순수 정수 함수라 "상태 없는 등식 트리거" 규율(파일 머리말 ③)이
 * 유지된다.
 */
export function formationMemberSpawnTick(
  slotIndex: number,
  delayTicks: number,
  mods: DefenseAffixMods,
): number {
  return affixEntryTick(formationSlotTriggerTick(slotIndex) + delayTicks, mods);
}

/** 마지막 슬롯의 마지막 구성원까지 전부 등장하는 데 걸리는 틱(진단·테스트용). */
export function formationScheduleSpan(): number {
  let maxDelay = 0;
  for (const f of FORMATIONS) {
    for (const m of f.members) if (m.delayTicks > maxDelay) maxDelay = m.delayTicks;
  }
  return formationSlotTriggerTick(INVASION_WAVE_SLOTS - 1) + maxDelay;
}

/** 편대 1기의 스폰 좌표(정수). 스크롤 창 중심 + 진입 패턴 + 구성원 오프셋의 순수 함수. */
export function formationMemberSpawnPos(
  def: FormationDef,
  memberIndex: number,
  scrollX: number,
  scrollY: number,
): { x: number; y: number } {
  const m = def.members[memberIndex];
  if (m === undefined) return { x: scrollX, y: scrollY };
  switch (def.entryPattern) {
    case ENTRY_FLANK: {
      // 좌우 협공: dx 부호가 곧 진입 측면. 창 바깥으로 밀어낸 뒤 구성원 오프셋을 얹는다.
      const side = m.dx < 0 ? -1 : 1;
      return {
        x: scrollX + side * FORMATION_FLANK_OFFSET + m.dx,
        y: scrollY - FORMATION_FLANK_AHEAD + m.dy,
      };
    }
    case ENTRY_CHARGE:
      return {
        x: scrollX + m.dx,
        y: scrollY - FORMATION_SPAWN_AHEAD - FORMATION_CHARGE_EXTRA_AHEAD + m.dy,
      };
    case ENTRY_GLIDE:
      // 급강하: 정면보다 높은 곳에서 시작한다. 좌우 확산은 구성원 dx 가 그대로 만든다.
      return { x: scrollX + m.dx, y: scrollY - FORMATION_GLIDE_AHEAD + m.dy };
    case ENTRY_SNIPE:
      // 고정 저격선: 얕게 등장해 화면 상단을 점유한다.
      return { x: scrollX + m.dx, y: scrollY - FORMATION_SNIPE_AHEAD + m.dy };
    case ENTRY_DRIFT:
      return {
        x: scrollX + m.dx,
        y: scrollY - FORMATION_SPAWN_AHEAD - FORMATION_DRIFT_EXTRA_AHEAD + m.dy,
      };
    case ENTRY_STRAIGHT:
    default:
      return { x: scrollX + m.dx, y: scrollY - FORMATION_SPAWN_AHEAD + m.dy };
  }
}

/** 편대 1기의 진입 속도(월드 유닛/초, 정수). 적 이동 컴포넌트가 이후 덮어쓴다. */
export function formationMemberEntryVelocity(
  def: FormationDef,
  memberIndex: number,
): { vx: number; vy: number } {
  const m = def.members[memberIndex];
  if (m === undefined) return { vx: 0, vy: 0 };
  switch (def.entryPattern) {
    case ENTRY_FLANK: {
      // 바깥에서 안쪽으로 파고들며 아래로 내려온다.
      const side = m.dx < 0 ? 1 : -1;
      return { vx: side * FORMATION_ENTRY_SPEED, vy: FORMATION_ENTRY_SPEED / 2 };
    }
    case ENTRY_CHARGE:
      return { vx: 0, vy: FORMATION_ENTRY_SPEED * 2 };
    case ENTRY_GLIDE: {
      // 바깥에서 안쪽으로 파고들며 빠르게 떨어진다(대각선 급강하).
      const side = m.dx < 0 ? 1 : -1;
      return { vx: side * FORMATION_ENTRY_SPEED, vy: FORMATION_GLIDE_SPEED_VY };
    }
    case ENTRY_SNIPE:
      return { vx: 0, vy: FORMATION_SNIPE_SPEED_VY };
    case ENTRY_DRIFT:
      return { vx: 0, vy: FORMATION_DRIFT_SPEED_VY };
    case ENTRY_STRAIGHT:
    default:
      return { vx: 0, vy: FORMATION_ENTRY_SPEED };
  }
}

// ---------------------------------------------------------------------------
// 스텝 훅 (StepFormationFn)
// ---------------------------------------------------------------------------

/**
 * L1 편대 스텝. `world.ts` 소유 레인(L2)이 `stepInvasion` 에서 매 틱 호출한다.
 *
 * 페이즈가 L1 이 아니면 아무것도 하지 않는다(L2/L3 에서는 편대가 등장하지 않는다).
 * 반환값·부작용은 엔티티 추가뿐이며 `ctx` 는 절대 변형하지 않는다.
 */
export function stepInvasionFormation(state: WorldState, ctx: InvasionStepContext): void {
  if (ctx.runtime.phase !== PHASE_L1) return;
  const elapsed = state.tick - ctx.runtime.phaseEnterTick;
  if (elapsed < 0) return;

  const slots = ctx.layers.l1.waveSlots;
  const n = slots.length < INVASION_WAVE_SLOTS ? slots.length : INVASION_WAVE_SLOTS;
  // 접미(조건부) 어픽스 판정 입력을 이 틱에 한 번 만들어 슬롯 전체가 공유한다.
  const trigger = formationTriggerState(state, ctx, elapsed);
  for (let i = 0; i < n; i++) {
    const ref = slots[i];
    // 빈 슬롯의 기본 수비대 충원은 L9-garrison-catalog 레인이 스폰 단계에서 주입한다.
    // 이 모듈은 명시 배치만 다루므로 null 은 조용히 건너뛴다(스폰 0).
    if (ref === null || ref === undefined) continue;
    const def = formationById(ref.catalogId);
    if (def === undefined) continue;
    const set = defenseAffixSet(CATALOG_FORMATION, ref);
    for (let j = 0; j < def.members.length; j++) {
      const m = def.members[j];
      if (m === undefined) continue;
      // 등식이라 매 구성원이 정확히 한 번만 스폰된다(상태 불요).
      if (elapsed !== formationMemberSpawnTick(i, m.delayTicks, set.always)) continue;
      const mods = resolveDefenseMods(set, trigger, ctx.runtime.scrollX, ctx.runtime.scrollY);
      const e = spawnFormationMember(state, ctx, def, j, ref, mods);
      // 접미 **또는 유니크**를 가진 편대만 슬롯을 표식으로 남긴다 — 둘 다 미보유면 aux0 이 0
      // 그대로라 해시 폴드가 늘지 않고(replay.ts ENTITY_HASH_OPTIONAL_TAIL) 기존 런과 바이트
      // 동일하다. 유니크를 조건에 넣지 않으면 **접두만 붙은 유니크 편대**가 표식을 못 받아
      // `refreshFormationAffixes` 를 통째로 건너뛰고, `vengeanceEngine`·`proximityReactor`
      // 같은 매 틱 재계산이 필요한 동적 유니크가 조용히 죽는다(M7c 통합 게이트 수정분).
      if (e !== undefined && (set.conditional.length > 0 || (set.unique ?? null) !== null)) {
        e.aux0 = i + 1;
      }
    }
  }
  refreshFormationAffixes(state, ctx, trigger);
}

/**
 * L1 접미 계기 판정 입력. 코어는 L3 에서야 스폰되므로 L1 에서는 언제나 "코어 없음"이다
 * (`coreHpLow` 계기는 편대에 실려도 발동하지 않는다 — 계기의 정의가 그렇다).
 *
 * `alliesDestroyed` 는 상태를 두지 않고 **순수 계산**한다: 지금까지 등장했어야 할 구성원 수
 * (스케줄의 순수 함수) − 현재 살아 있는 적 수. L1 에서 `enemy` 를 만드는 경로는 편대 스폰뿐이라
 * (구 PvE 웨이브 디렉터는 침공에서 호출되지 않는다) 이 차가 곧 파괴된 아군 수다.
 */
function formationTriggerState(
  state: WorldState,
  ctx: InvasionStepContext,
  elapsed: number,
): DefenseTriggerState {
  let alive = 0;
  let player: Entity | undefined;
  for (const e of state.entities) {
    if (e.dead) continue;
    if (e.kind === 'enemy') alive++;
    else if (e.kind === 'player') player = e;
  }
  const spawned = formationSpawnedCount(ctx, elapsed);
  const destroyed = spawned - alive;
  return {
    elapsedTicks: elapsed,
    coreHpPct: AFFIX_NO_CORE_HP_PCT,
    alliesDestroyed: destroyed < 0 ? 0 : destroyed,
    playerX: player === undefined ? 0 : player.x,
    playerY: player === undefined ? 0 : player.y,
  };
}

/**
 * 지금까지(이번 틱 **이전**) 등장했어야 할 편대 구성원 수. 스케줄이 상태 없는 등식이라
 * 순수 함수로 되짚을 수 있다. 이번 틱에 스폰되는 구성원은 아직 살아 있는 것으로 세지 않으려고
 * 엄격 부등호(`<`)를 쓴다 — 그러지 않으면 스폰 틱마다 "방금 파괴됐다"로 오판한다.
 */
export function formationSpawnedCount(ctx: InvasionStepContext, elapsed: number): number {
  const slots = ctx.layers.l1.waveSlots;
  const n = slots.length < INVASION_WAVE_SLOTS ? slots.length : INVASION_WAVE_SLOTS;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const ref = slots[i];
    if (ref === null || ref === undefined) continue;
    const def = formationById(ref.catalogId);
    if (def === undefined) continue;
    const set = defenseAffixSet(CATALOG_FORMATION, ref);
    for (const m of def.members) {
      if (formationMemberSpawnTick(i, m.delayTicks, set.always) < elapsed) count++;
    }
  }
  return count;
}

/**
 * 접미를 가진 편대원의 **접촉 피해**를 매 틱 다시 접는다(`dt-ambush`·`dt-vengeance`·`dt-recoil`).
 * 표식(`aux0 = 슬롯+1`)이 없는 개체는 건너뛰므로 어픽스 미보유 런에서는 루프 본문이 한 번도
 * 돌지 않는다.
 *
 * 내구도·연사 계열을 여기서 다시 만지지 않는 이유:
 *   - 내구도 접미(`dt-lastwall`)의 계기는 `coreHpLow` 인데 L1 에는 코어가 없어 영구 미발동이다.
 *   - 연사는 카운트다운(`cooldown`)이라 매 틱 덮어쓰면 영원히 발사되지 않는다 — 스폰 시점
 *     판정으로 굳힌다(`dt-secondwind` 는 늦게 등장한 편대에만 실린다는 뜻이 된다).
 */
function refreshFormationAffixes(
  state: WorldState,
  ctx: InvasionStepContext,
  trigger: DefenseTriggerState,
): void {
  const slots = ctx.layers.l1.waveSlots;
  for (const e of state.entities) {
    if (e.kind !== 'enemy' || e.dead || e.aux0 <= 0) continue;
    const ref = slots[e.aux0 - 1];
    if (ref === null || ref === undefined) continue;
    const set = defenseAffixSet(CATALOG_FORMATION, ref);
    const mods = resolveDefenseMods(set, trigger, e.x, e.y);
    e.damage = affixDamage(formationBaseDamage(state, e, ref), mods);
  }
}

/**
 * 편대원의 **어픽스 이전** 접촉 피해(카탈로그 → 강화 3축 → 코어 모듈 배율). 스폰 경로와 같은
 * 순서로 접어야 매 틱 재계산이 스폰 시점 값과 이어진다 — 그래서 두 경로가 이 함수 하나를 쓴다.
 */
function formationBaseDamage(state: WorldState, e: Entity, ref: InvasionRef): number {
  const enemyDef = ENEMY_BY_TYPE[e.enemyType];
  let damage = enemyDef === undefined ? e.damage : enemyDef.contactDamage;
  const cp = formationPowerCp(ref.level, ref.ascension, ref.rarity);
  if (cp !== 100) damage = Math.round((damage * cp) / 100);
  const mr = state.moduleRuntime;
  if (mr !== undefined && mr.formationDamageMult !== 1) {
    damage = Math.round(damage * mr.formationDamageMult);
  }
  return damage;
}

/** 편대 구성원 1기를 실제로 전장에 올린다. RNG 미소비. */
function spawnFormationMember(
  state: WorldState,
  ctx: InvasionStepContext,
  def: FormationDef,
  memberIndex: number,
  ref: InvasionRef,
  mods: DefenseAffixMods,
): Entity | undefined {
  const m = def.members[memberIndex];
  if (m === undefined) return undefined;
  const enemyDef = ENEMY_BY_TYPE[m.enemyTypeIndex];
  if (enemyDef === undefined) return undefined;

  const pos = formationMemberSpawnPos(def, memberIndex, ctx.runtime.scrollX, ctx.runtime.scrollY);
  // 활성 벽에 끼인 채 등장하지 않도록 결정론적으로 밀어낸다(waves.ts:189, RNG 미소비).
  const adj = avoidWalls(state.activeWalls, pos.x, pos.y, enemyDef.radius);
  const e = summonEnemy(state, enemyDef, adj.x, adj.y);

  // 강화 3축 → 내구도 정수 스케일. Math.round(a*cp/100) 관용구로 f64 누적을 피한다.
  const cp = formationPowerCp(ref.level, ref.ascension, ref.rarity);
  if (cp !== 100) {
    const hp = Math.round((e.maxHp * cp) / 100);
    e.hp = hp;
    e.maxHp = hp;
  }
  // 방어체 어픽스 내구도(defHpPct). 미보유면 배율 1 → 입력 그대로라 비트 동일.
  const hp = affixHp(e.maxHp, mods);
  e.hp = hp;
  e.maxHp = hp;
  // 접촉 피해: 강화 3축 → 코어 모듈 배율 → 방어체 어픽스 순(재계산 경로와 동일한 접기 순서).
  e.damage = affixDamage(formationBaseDamage(state, e, ref), mods);
  // 정비도 풍화(결정 #18): 배치된 방어체는 방치될수록 연사가 느려진다. 정수 연산 전용
  // invasionFireCooldown(편대·설비·기물·보스 공용 산식)을 쓰고, 풍화 저항 어픽스는 실효
  // 정비도를 완전 정비 쪽으로 되돌린다. 연사 어픽스는 그 위에 간격 축소로 얹힌다.
  e.cooldown = affixCooldown(
    invasionFireCooldown(e.cooldown, affixMaintenance(ctx.maintenance, mods)),
    mods,
  );

  const vel = formationMemberEntryVelocity(def, memberIndex);
  e.vx = vel.vx;
  e.vy = vel.vy;
  return e;
}
