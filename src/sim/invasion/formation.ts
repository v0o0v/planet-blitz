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
} from '../../../data/invasion/formations.js';
import type { FormationDef } from '../../../data/invasion/formations.js';
import { INVASION_WAVE_SLOTS, PHASE_L1 } from './constants.js';
import type { InvasionStepContext } from './types.js';

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

// ---------------------------------------------------------------------------
// 트리거·좌표 — 순수 함수(테스트가 직접 검증한다)
// ---------------------------------------------------------------------------

/** 슬롯 i 의 편대 트리거 틱(페이즈 진입 기준 상대). */
export function formationSlotTriggerTick(slotIndex: number): number {
  return slotIndex * FORMATION_SLOT_INTERVAL_TICKS;
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
  for (let i = 0; i < n; i++) {
    const ref = slots[i];
    // 빈 슬롯의 기본 수비대 충원은 L9-garrison-catalog 레인이 스폰 단계에서 주입한다.
    // 이 모듈은 명시 배치만 다루므로 null 은 조용히 건너뛴다(스폰 0).
    if (ref === null || ref === undefined) continue;
    const local = elapsed - formationSlotTriggerTick(i);
    if (local < 0) continue;
    const def = formationById(ref.catalogId);
    if (def === undefined) continue;
    for (let j = 0; j < def.members.length; j++) {
      const m = def.members[j];
      if (m === undefined) continue;
      // 등식이라 매 구성원이 정확히 한 번만 스폰된다(상태 불요).
      if (local !== m.delayTicks) continue;
      spawnFormationMember(state, ctx, def, j, ref.level, ref.ascension, ref.rarity);
    }
  }
}

/** 편대 구성원 1기를 실제로 전장에 올린다. RNG 미소비. */
function spawnFormationMember(
  state: WorldState,
  ctx: InvasionStepContext,
  def: FormationDef,
  memberIndex: number,
  level: number,
  ascension: number,
  rarity: number,
): Entity | undefined {
  const m = def.members[memberIndex];
  if (m === undefined) return undefined;
  const enemyDef = ENEMY_BY_TYPE[m.enemyTypeIndex];
  if (enemyDef === undefined) return undefined;

  const pos = formationMemberSpawnPos(def, memberIndex, ctx.runtime.scrollX, ctx.runtime.scrollY);
  // 활성 벽에 끼인 채 등장하지 않도록 결정론적으로 밀어낸다(waves.ts:189, RNG 미소비).
  const adj = avoidWalls(state.activeWalls, pos.x, pos.y, enemyDef.radius);
  const e = summonEnemy(state, enemyDef, adj.x, adj.y);

  // 강화 3축 → 내구도·접촉 피해 정수 스케일. Math.round(a*cp/100) 관용구로 f64 누적을 피한다.
  const cp = formationPowerCp(level, ascension, rarity);
  if (cp !== 100) {
    const hp = Math.round((e.maxHp * cp) / 100);
    e.hp = hp;
    e.maxHp = hp;
    e.damage = Math.round((e.damage * cp) / 100);
  }
  // 정비도 풍화(결정 #18): 배치된 방어체는 방치될수록 연사가 느려진다. 정수 연산 전용
  // invasionFireCooldown(편대·설비·기물·보스 공용 산식)을 쓴다.
  e.cooldown = invasionFireCooldown(e.cooldown, ctx.maintenance);

  const vel = formationMemberEntryVelocity(def, memberIndex);
  e.vx = vel.vx;
  e.vy = vel.vy;
  return e;
}
