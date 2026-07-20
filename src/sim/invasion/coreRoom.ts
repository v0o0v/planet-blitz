/**
 * 침공 L3 — 코어방 (M7a · L5-core-room).
 *
 * 3레이어 원정의 마지막 관문. 고정 카메라 아래에서 **방어 보스 1 + 수호 2 + 기물 6 + 코어**가
 * 동시에 걸린다. 이 모듈은 L0 이 선언한 두 훅만 구현한다:
 *   - {@link enterCoreRoom} : {@link EnterLayerFn}  — 레이어 진입 틱에 정적 배치를 1회 스폰
 *   - {@link stepCoreRoom}  : {@link StepCoreRoomFn} — 매 틱 보스·기물·수호·코어 보호막 진행
 * `src/sim/world.ts` 는 열지 않는다(L2 단독 소유). 배선은 L2 가 시그니처만 보고 한다.
 *
 * ## 코어 보호막 = "먼저 파괴 강제" 장치
 * 실드 발생기(기물 ①)가 **살아 있는 동안 코어의 흡수 실드를 매 틱 가득 채운다** → 코어에 넣는
 * 피해가 전부 실드에 흡수되어 사실상 무적이다. 발생기를 전부 부수면 그 틱부터 실드 재생이
 * 멈추고 코어 HP 가 깎이기 시작한다. 이 구현은 `world.ts` 의 기존 실드 흡수 경로
 * (`core.targetY` 가 HP 보다 먼저 피해를 먹는다)를 그대로 쓰므로 **충돌 판정
 * 코드를 한 줄도 고치지 않는다** — 다른 레인의 파일을 건드리지 않고 규칙을 세우는 길이다.
 *
 * ## 필드 매핑(플랫 Entity 재활용 — 신규 해시 필드 없음)
 *   defenseBoss : `enemyType`=catalogId, `phase`=0/1/2, `timer`=전이 연출 카운트다운,
 *                 `cooldown`=다음 캐스트, `iframes`=과열 창(피해 2배), `pierce`=라운드로빈 인덱스,
 *                 `dashCooldown`=과열 재장전, `targetX`=나선/다각형 기준각 누산
 *   l3Prop      : `enemyType`=역할 코드(PROP_*), `pierce`=소켓 인덱스, `cooldown`=발사/융기 카운트다운,
 *                 `targetX`=공급 보호막 HP(실드 발생기), `damage`=발당·장판 피해
 *   core        : `hp/maxHp`=내구도, `targetY`=흡수 실드(world.ts 판정), `timer`=발생기 국면 플래그
 *                 (1=발생기 생존 국면, 0=소진 — 수호 실드 공유 1회 전달 여부를 겸한다)
 *
 * ## 결정론(ADR-0005)
 * RNG·wall-clock 미소비. 강화 3축·정비도 스케일은 전부 정수 basis-point 산술이다.
 */

import type { WorldState } from '../world.js';
import type { Entity, EntityKind, EntitySink } from '../entities.js';
import { blankEntity, addEntity, spawnEnemyBullet, spawnHazard } from '../entities.js';
import { atan2, cos, sin, clamp, TWO_PI } from '../math.js';
import { segmentBlocked } from '../los.js';
import { DT, VIEW_HEIGHT, HAZARD_LINE_SPAN } from '../constants.js';
import {
  DEFENSE_BOSS_OVERHEAT_TICKS,
  DEFENSE_BOSS_PHASE1_BP,
  DEFENSE_BOSS_PHASE2_BP,
  DEFENSE_BOSS_TRANSITION_TICKS,
  DEFAULT_DEFENSE_BOSS_ID,
  defenseBossDef,
  defenseBossPowerBp,
  scaleByBp,
} from '../../../data/invasion/defenseBosses.js';
import type { DefenseBossAttack, DefenseBossDef } from '../../../data/invasion/defenseBosses.js';
import {
  DEFENSE_BOSS_SPAWN_OFFSET,
  PROP_FIXED_CANNON,
  PROP_GRAVITY_ANCHOR,
  PROP_SHIELD_GENERATOR,
  PROP_SLOW_SUBTYPE,
  PROP_SOCKET_OFFSETS,
  propPowerBp,
  propSpec,
} from '../../../data/invasion/props.js';
import { CATALOG_BOSS, CATALOG_PROP } from '../../../data/invasion/catalog.js';
import { INVASION_CORE_RADIUS } from './constants.js';
import type { InvasionRef, InvasionStepContext } from './types.js';
import {
  NEUTRAL_AFFIX_MODS,
  affixCooldown,
  affixDamage,
  affixHp,
  affixMaintenance,
  affixOverheatTicks,
  affixPowerBp,
  coreHpPctOf,
  defenseAffixSet,
  raiseMaxHp,
  resolveDefenseMods,
} from './affix.js';
import type { DefenseAffixMods, DefenseTriggerState } from './affix.js';
import {
  guardianShieldShareHp,
  invasionFireCooldown,
  spawnInvasionGuardians,
  stepInvasionGuardians,
} from './guardianBridge.js';

// ---------------------------------------------------------------------------
// 신규 엔티티 kind
// ---------------------------------------------------------------------------

/**
 * `src/sim/entities.ts` 의 `EntityKind`·`KIND_CODE` 에 L1 레인이 예약해 둔 신규 kind 다.
 *
 * 통합 게이트 정정: 이 레인은 기물 kind 를 `'l3Prop'` 으로 가정했으나 정본은 `'prop'`(코드 25)
 * 이다. 캐스트가 두 이름의 불일치를 가려 KIND_CODE 조회가 `undefined` 로 새고 hashEntity 가
 * NaN 으로 오염될 뻔했다 — 이제 캐스트를 걷어내 타입 검사가 이름을 강제한다.
 */
const KIND_DEFENSE_BOSS: EntityKind = 'defenseBoss';
/** 위 참조. L3 기물 엔티티 kind(정본 이름 = 'prop'). */
const KIND_L3_PROP: EntityKind = 'prop';

/** 방어 보스 엔티티 kind(다른 레인·렌더가 조회할 수 있게 공개). */
export const DEFENSE_BOSS_KIND = KIND_DEFENSE_BOSS;
/** 기물 엔티티 kind. */
export const L3_PROP_KIND = KIND_L3_PROP;

// ---------------------------------------------------------------------------
// 조회 헬퍼
// ---------------------------------------------------------------------------

/** 플레이어(불변식: entities[0]). 없으면 null — 스텝은 조용히 no-op 한다. */
function findPlayer(state: WorldState): Entity | null {
  for (const e of state.entities) {
    if (e.kind === 'player' && !e.dead) return e;
  }
  return null;
}

/** 살아 있는 코어 1기(배치당 1개). */
function findCore(state: WorldState): Entity | null {
  for (const e of state.entities) {
    if (e.kind === 'core' && !e.dead) return e;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 진입 스폰
// ---------------------------------------------------------------------------

/**
 * 코어방 정적 배치를 1회 스폰한다(L2 페이즈 머신이 L3 진입 틱에 호출).
 * 순서 = **코어 → 보스 → 기물(소켓 순) → 수호(슬롯 순)**. 배치 데이터로 완전히 결정되므로
 * 엔티티 id 부여 순서가 재현된다.
 *
 * 멱등: 이미 코어가 있으면 아무것도 하지 않는다(중복 배선 방어).
 */
export function enterCoreRoom(state: WorldState, ctx: InvasionStepContext): void {
  if (findCore(state) !== null) return;
  const l3 = ctx.layers.l3;
  const core = spawnInvasionCore(state, l3.core.x, l3.core.y, l3.core.hp);

  // 보스: 빈 슬롯이면 기본 수비대(강철 골리앗 lv1 노말)가 충원한다(결정 #22 — 스폰 단계 주입).
  const bossRef: InvasionRef = l3.boss ?? {
    catalogId: DEFAULT_DEFENSE_BOSS_ID,
    level: 1,
    ascension: 0,
    affixSeed: 0,
    rarity: 0,
  };
  spawnDefenseBoss(
    state,
    bossRef,
    l3.core.x + DEFENSE_BOSS_SPAWN_OFFSET.x,
    l3.core.y + DEFENSE_BOSS_SPAWN_OFFSET.y,
    ctx.maintenance,
  );

  // 기물: 빈 소켓은 **비운다**(결정 #22 — 과충전 방지). 소켓 인덱스가 곧 좌표다.
  let generatorShield = 0;
  for (let i = 0; i < l3.props.length; i++) {
    const ref = l3.props[i];
    if (ref === null || ref === undefined) continue;
    const off = PROP_SOCKET_OFFSETS[i];
    if (off === undefined) continue;
    const p = spawnL3Prop(state, ref, i, l3.core.x + off.x, l3.core.y + off.y, ctx.maintenance);
    if (p !== null && p.enemyType === PROP_SHIELD_GENERATOR) generatorShield += p.targetX;
  }

  spawnInvasionGuardians(state, ctx.layers);

  // 코어 보호막 초기값. 발생기가 있으면 발생기 실드(매 틱 재생), 없으면 수호 실드 공유(소모성)를
  // 즉시 싣는다. `timer` 는 "발생기 국면" 플래그 — 발생기가 전멸하는 틱에 1회만 수호 실드로
  // 갈아끼우기 위한 결정론 상태다.
  if (generatorShield > 0) {
    core.targetY = generatorShield;
    core.timer = 1;
  } else {
    core.targetY = guardianShieldShareHp(ctx.layers);
    core.timer = 0;
  }
}

/** 코어 스폰(내구도는 배치 데이터가 정본 — 기본값은 정규화가 이미 넣었다). */
export function spawnInvasionCore(sink: EntitySink, x: number, y: number, hp: number): Entity {
  const c = blankEntity('core');
  c.x = x;
  c.y = y;
  c.radius = INVASION_CORE_RADIUS;
  c.hp = hp;
  c.maxHp = hp;
  return addEntity(sink, c);
}

/** 방어 보스 스폰. 강화 3축으로 HP·접촉피해를 정수 스케일하고 초기 캐스트 지연을 정비도로 준다. */
export function spawnDefenseBoss(
  sink: EntitySink,
  ref: InvasionRef,
  x: number,
  y: number,
  maintenance: number,
): Entity {
  const def = defenseBossDef(ref.catalogId);
  const bp = defenseBossPowerBp(ref.level, ref.ascension, ref.rarity);
  // 방어체 어픽스는 접두(상시)만 스폰에 싣는다. 접미는 스텝이 매 틱 얹는다(affix.ts 규율).
  const mods = defenseAffixSet(CATALOG_BOSS, ref).always;
  const b = blankEntity(KIND_DEFENSE_BOSS);
  b.x = x;
  b.y = y;
  b.enemyType = ref.catalogId;
  b.radius = def.radius;
  b.hp = affixHp(scaleByBp(def.hp, bp), mods);
  b.maxHp = b.hp;
  b.damage = affixDamage(scaleByBp(def.contactDamage, bp), mods);
  b.phase = 0;
  // 첫 캐스트까지의 지연도 정비도로 스케일 — 방치된 기지는 첫 공격부터 느리다(포탑 선례).
  b.cooldown = affixCooldown(
    invasionFireCooldown(def.phases[0].patternCooldown, affixMaintenance(maintenance, mods)),
    mods,
  );
  return addEntity(sink, b);
}

/**
 * 기물 1기 스폰. 미지의 catalogId 는 `null`(스폰 없음) — 방어자가 배치하지 않은 화력이
 * 생기지 않게 한다.
 */
export function spawnL3Prop(
  sink: EntitySink,
  ref: InvasionRef,
  socketIndex: number,
  x: number,
  y: number,
  maintenance: number,
): Entity | null {
  const spec = propSpec(ref.catalogId);
  if (spec === null) return null;
  const bp = propPowerBp(ref.level, ref.ascension, ref.rarity);
  const mods = defenseAffixSet(CATALOG_PROP, ref).always;
  const p = blankEntity(KIND_L3_PROP);
  p.x = x;
  p.y = y;
  p.enemyType = spec.role;
  p.pierce = socketIndex;
  p.radius = spec.radius;
  // 보호막(defShieldFlat)은 코어 공급량이 아니라 **자기 내구도 위**에 얹힌다
  // (data/defenseUnits.ts 의 stat 정의 그대로 — "파괴 전까지 내구도 위에 얹힌다").
  p.hp = affixHp(scaleByBp(spec.hp, bp), mods);
  p.maxHp = p.hp;
  switch (spec.role) {
    case PROP_SHIELD_GENERATOR:
      p.targetX = scaleByBp(spec.shieldHp, bp);
      break;
    case PROP_GRAVITY_ANCHOR:
      p.damage = affixDamage(scaleByBp(spec.hazardDamage, bp), mods);
      p.cooldown = affixCooldown(
        invasionFireCooldown(spec.periodTicks, affixMaintenance(maintenance, mods)),
        mods,
      );
      break;
    case PROP_FIXED_CANNON:
      p.damage = affixDamage(scaleByBp(spec.damage, bp), mods);
      p.cooldown = affixCooldown(
        invasionFireCooldown(spec.fireCooldown, affixMaintenance(maintenance, mods)),
        mods,
      );
      break;
    default:
      break;
  }
  return addEntity(sink, p);
}

// ---------------------------------------------------------------------------
// 스텝
// ---------------------------------------------------------------------------

/**
 * 코어방을 1틱 진행한다: 보스 → 기물 → 수호 → 코어 보호막 갱신.
 * 순서는 고정이며 각 단계가 순수·결정론이다(RNG 미소비).
 */
export function stepCoreRoom(state: WorldState, ctx: InvasionStepContext): void {
  const player = findPlayer(state);
  if (player === null) return;
  // 접미(조건부) 어픽스 판정 입력을 이 틱에 한 번 만들어 코어방 전체가 공유한다.
  const trigger = coreRoomTriggerState(state, ctx, player);
  stepDefenseBosses(state, player, ctx, trigger);
  stepL3Props(state, player, ctx, trigger);
  stepInvasionGuardians(state, player, ctx);
  updateCoreShield(state, ctx);
}

/**
 * L3 접미 계기 판정 입력. 코어가 실제로 존재하는 유일한 레이어라 `coreHpLow` 가 여기서만
 * 발동한다(`dt-lastwall`·`dt-bulwark` = "코어가 무너지기 시작하면 방어체가 재장갑한다").
 *
 * `alliesDestroyed` 는 상태 없이 순수 계산한다: 배치된 아군 방어체 수(기물 + 보스 + 수호)
 * − 현재 살아 있는 수. 배치 배열이 곧 초기 수라 별도 카운터를 sim 상태에 추가하지 않는다.
 */
function coreRoomTriggerState(
  state: WorldState,
  ctx: InvasionStepContext,
  player: Entity,
): DefenseTriggerState {
  const l3 = ctx.layers.l3;
  let placed = l3.boss === null || l3.boss === undefined ? 0 : 1;
  for (const ref of l3.props) {
    if (ref !== null && ref !== undefined) placed++;
  }
  for (const g of l3.guardians) {
    if (g !== null && g !== undefined) placed++;
  }
  let alive = 0;
  let corePct = 0;
  let coreSeen = false;
  for (const e of state.entities) {
    if (e.dead) continue;
    if (e.kind === KIND_L3_PROP || e.kind === KIND_DEFENSE_BOSS || e.kind === 'guardian') alive++;
    else if (e.kind === 'core' && !coreSeen) {
      coreSeen = true;
      corePct = coreHpPctOf(e.hp, e.maxHp);
    }
  }
  const destroyed = placed - alive;
  const elapsed = state.tick - ctx.runtime.phaseEnterTick;
  return {
    elapsedTicks: elapsed < 0 ? 0 : elapsed,
    coreHpPct: coreSeen ? corePct : coreHpPctOf(0, 0),
    alliesDestroyed: destroyed < 0 ? 0 : destroyed,
    playerX: player.x,
    playerY: player.y,
  };
}

/**
 * 코어 보호막 갱신. 살아 있는 실드 발생기의 공급량 합을 **매 틱 코어에 다시 채운다** →
 * 발생기가 하나라도 살아 있으면 코어 피해가 전부 흡수된다(먼저 파괴 강제). 전멸하는 틱에
 * 한 번만 수호 실드 공유(소모성 풀)로 갈아끼우고, 이후에는 손대지 않아 정상적으로 소진된다.
 */
function updateCoreShield(state: WorldState, ctx: InvasionStepContext): void {
  const core = findCore(state);
  if (core === null) return;
  let supply = 0;
  for (const e of state.entities) {
    if (e.kind !== KIND_L3_PROP || e.dead) continue;
    if (e.enemyType !== PROP_SHIELD_GENERATOR) continue;
    supply += e.targetX;
  }
  if (supply > 0) {
    core.targetY = supply;
    core.timer = 1;
    return;
  }
  if (core.timer === 1) {
    core.timer = 0;
    core.targetY = guardianShieldShareHp(ctx.layers);
  }
}

/** 기물 전체를 1틱 진행(역할별 디스패치). */
function stepL3Props(
  state: WorldState,
  player: Entity,
  ctx: InvasionStepContext,
  trigger: DefenseTriggerState,
): void {
  for (const p of state.entities) {
    if (p.kind !== KIND_L3_PROP || p.dead) continue;
    const ref = ctx.layers.l3.props[p.pierce];
    if (ref === null || ref === undefined) continue;
    const spec = propSpec(ref.catalogId);
    if (spec === null) continue;
    // 어픽스 미보유면 NEUTRAL 로 떨어져 아래 적용 함수가 전부 입력을 그대로 돌려준다(비트 동일).
    const set = defenseAffixSet(CATALOG_PROP, ref);
    const mods = set.neutral ? NEUTRAL_AFFIX_MODS : resolveDefenseMods(set, trigger, p.x, p.y);
    if (!set.neutral) {
      const bp = propPowerBp(ref.level, ref.ascension, ref.rarity);
      // 내구도는 **단조 상향**만(되돌리면 이미 입은 피해가 사라진다). 피해는 매 틱 덮어쓴다.
      raiseMaxHp(p, affixHp(scaleByBp(spec.hp, bp), mods));
      if (p.enemyType === PROP_GRAVITY_ANCHOR) {
        p.damage = affixDamage(scaleByBp(spec.hazardDamage, bp), mods);
      } else if (p.enemyType === PROP_FIXED_CANNON) {
        p.damage = affixDamage(scaleByBp(spec.damage, bp), mods);
      }
    }
    switch (p.enemyType) {
      case PROP_GRAVITY_ANCHOR: {
        // 주기 융기: 쿨다운이 끝나면 플레이어 위치에 감속 장판을 깔고 주기를 재장전한다.
        if (p.cooldown > 0) {
          p.cooldown--;
          break;
        }
        spawnHazard(
          state,
          PROP_SLOW_SUBTYPE,
          player.x,
          player.y,
          spec.hazardRadius,
          spec.hazardWindup,
          spec.hazardActive,
          p.damage,
          true,
          p.id,
        );
        p.cooldown = affixCooldown(
          invasionFireCooldown(spec.periodTicks, affixMaintenance(ctx.maintenance, mods)),
          mods,
        );
        break;
      }
      case PROP_FIXED_CANNON: {
        if (p.cooldown > 0) {
          p.cooldown--;
          break;
        }
        const dx = player.x - p.x;
        const dy = player.y - p.y;
        // 사거리 밖이면 발사 보류(쿨다운 0 유지 → 사정권 진입 시 즉발). 포탑과 동일 규율.
        if (dx * dx + dy * dy > spec.range * spec.range) break;
        if (
          state.activeWalls.length > 0 &&
          segmentBlocked(p.x, p.y, player.x, player.y, state.activeWalls)
        ) {
          break;
        }
        const ang = atan2(dy, dx);
        spawnEnemyBullet(
          state,
          p.x,
          p.y,
          cos(ang) * spec.bulletSpeed,
          sin(ang) * spec.bulletSpeed,
          ang,
          p.damage,
          spec.bulletRadius,
          spec.bulletLife,
        );
        p.angle = ang;
        p.cooldown = affixCooldown(
          invasionFireCooldown(spec.fireCooldown, affixMaintenance(ctx.maintenance, mods)),
          mods,
        );
        break;
      }
      default:
        // 실드 발생기: 능동 거동 없음(공급량은 updateCoreShield 가 읽는다).
        break;
    }
  }
}

/** 방어 보스 전체를 1틱 진행. */
function stepDefenseBosses(
  state: WorldState,
  player: Entity,
  ctx: InvasionStepContext,
  trigger: DefenseTriggerState,
): void {
  for (const b of state.entities) {
    if (b.kind !== KIND_DEFENSE_BOSS || b.dead) continue;
    const ref = ctx.layers.l3.boss;
    const def = defenseBossDef(b.enemyType);
    const bp =
      ref !== null && ref !== undefined
        ? defenseBossPowerBp(ref.level, ref.ascension, ref.rarity)
        : 10000;
    const set = defenseAffixSet(CATALOG_BOSS, ref);
    const mods = set.neutral ? NEUTRAL_AFFIX_MODS : resolveDefenseMods(set, trigger, b.x, b.y);
    if (!set.neutral) {
      // 내구도는 단조 상향(dt-lastwall = 코어 저HP 재장갑), 접촉 피해는 매 틱 재계산.
      raiseMaxHp(b, affixHp(scaleByBp(def.hp, bp), mods));
      b.damage = affixDamage(scaleByBp(def.contactDamage, bp), mods);
    }
    updateDefenseBoss(state, b, player, def, bp, ctx.maintenance, mods);
  }
}

/**
 * 방어 보스 1기를 1틱 진행한다(src/sim/boss.ts updateBoss 골격 복제).
 * 전이 연출 → HP 임계 전이 → 이동 → 과열/쿨다운 → 캐스트 순. 전부 정수·순수 산술이다.
 */
export function updateDefenseBoss(
  state: WorldState,
  boss: Entity,
  player: Entity,
  def: DefenseBossDef,
  powerBp: number,
  maintenance: number,
  mods: DefenseAffixMods = NEUTRAL_AFFIX_MODS,
): void {
  // 전이 연출 중: 정지·무발사·과열 감쇠 없음.
  if (boss.timer > 0) {
    boss.timer--;
    boss.vx = 0;
    boss.vy = 0;
    return;
  }

  // HP 임계 통과 → 페이즈 전진(한 틱에 두 임계를 넘으면 최종 페이즈로 직행, 연출은 1회).
  // 정수 basis-point 비교라 f64 분수 비교가 끼지 않는다.
  const frac = boss.maxHp > 0 ? Math.floor((boss.hp * 10000) / boss.maxHp) : 0;
  const targetPhase = frac > DEFENSE_BOSS_PHASE1_BP ? 0 : frac > DEFENSE_BOSS_PHASE2_BP ? 1 : 2;
  if (targetPhase > boss.phase) {
    boss.phase = targetPhase;
    boss.timer = DEFENSE_BOSS_TRANSITION_TICKS;
    boss.iframes = 0;
    boss.cooldown = 0;
    boss.dashCooldown = 0;
    clearEnemyBullets(state);
    return;
  }

  moveDefenseBoss(boss, player, def);

  if (boss.iframes > 0) boss.iframes--;
  if (boss.dashCooldown > 0) boss.dashCooldown--;

  if (boss.cooldown > 0) {
    boss.cooldown--;
    return;
  }
  const phase = def.phases[boss.phase];
  if (phase === undefined) return;
  const attackIndex = boss.pierce % phase.attacks.length;
  const attack = phase.attacks[attackIndex];
  // 코어 모듈 보스 화력 배율(M7b): 강화 3축 bp 에 곱해 **정수 bp 로 되돌린 뒤** 넘긴다 —
  // 피해 산식(scaleByBp)이 정수 basis-point 단일 나눗셈이라는 규율을 깨지 않기 위해서다.
  // 미장착이면 배율 1 → bp 그대로(비트 동일).
  const mr = state.moduleRuntime;
  const moduleBp =
    mr === undefined || mr.bossDamageMult === 1 ? powerBp : Math.round(powerBp * mr.bossDamageMult);
  // 방어체 어픽스 피해도 같은 규율로 **정수 bp 에 접는다**(scaleByBp 단일 나눗셈 유지).
  const bossBp = affixPowerBp(moduleBp, mods);
  if (attack !== undefined) executeDefenseAttack(state, boss, player, attack, bossBp);
  boss.pierce++;
  boss.cooldown = affixCooldown(
    invasionFireCooldown(phase.patternCooldown, affixMaintenance(maintenance, mods)),
    mods,
  );
  // 과열 창은 시그니처 캐스트(인덱스 0) 직후, 재장전이 끝났을 때만 열린다 → 열림/닫힘 리듬.
  // `defOverheatResistPct` 는 그 창을 줄인다(최소 1틱 — 약점이 통째로 사라지지는 않는다).
  if (attackIndex === 0 && boss.dashCooldown === 0) {
    boss.iframes = affixOverheatTicks(DEFENSE_BOSS_OVERHEAT_TICKS, mods);
    boss.dashCooldown = phase.overheatInterval;
  }
}

/**
 * 보스 이동: 플레이어 위쪽 일정 높이를 느리게 추종한다(무한 맵 — 아레나 클램프 없음).
 * 코어방은 고정 카메라라 보스가 화면 밖으로 새지 않도록 속도를 낮게 잡았다(정의 데이터).
 */
function moveDefenseBoss(boss: Entity, player: Entity, def: DefenseBossDef): void {
  const stepMax = def.moveSpeed * DT;
  const targetY = player.y - VIEW_HEIGHT * 0.28;
  boss.y += clamp(targetY - boss.y, -stepMax, stepMax);
  boss.x += clamp(player.x - boss.x, -stepMax, stepMax);
  boss.angle = atan2(player.y - boss.y, player.x - boss.x);
}

/** 캐스트 1회 실행(판별 유니온 디스패치). 탄 상한(state.bulletCap)을 존중한다. */
function executeDefenseAttack(
  state: WorldState,
  boss: Entity,
  player: Entity,
  atk: DefenseBossAttack,
  powerBp: number,
): void {
  switch (atk.kind) {
    case 'ring': {
      const dmg = scaleByBp(atk.damage, powerBp);
      for (let i = 0; i < atk.count; i++) {
        if (state.enemyBulletCount >= state.bulletCap) break;
        const ang = (i * TWO_PI) / atk.count;
        spawnEnemyBullet(
          state,
          boss.x,
          boss.y,
          cos(ang) * atk.speed,
          sin(ang) * atk.speed,
          ang,
          dmg,
          atk.bulletRadius,
          atk.bulletLife,
        );
        state.enemyBulletCount++;
      }
      return;
    }
    case 'spiral': {
      const dmg = scaleByBp(atk.damage, powerBp);
      const base = boss.targetX;
      for (let i = 0; i < atk.count; i++) {
        if (state.enemyBulletCount >= state.bulletCap) break;
        const ang = base + (i * TWO_PI) / atk.count;
        spawnEnemyBullet(
          state,
          boss.x,
          boss.y,
          cos(ang) * atk.speed,
          sin(ang) * atk.speed,
          ang,
          dmg,
          atk.bulletRadius,
          atk.bulletLife,
        );
        state.enemyBulletCount++;
      }
      boss.targetX = base + atk.turn;
      return;
    }
    case 'aimedBurst': {
      const dmg = scaleByBp(atk.damage, powerBp);
      const aim = atan2(player.y - boss.y, player.x - boss.x);
      const n = atk.count;
      const start = n > 1 ? aim - atk.arc / 2 : aim;
      const stepA = n > 1 ? atk.arc / (n - 1) : 0;
      for (let i = 0; i < n; i++) {
        if (state.enemyBulletCount >= state.bulletCap) break;
        const ang = start + stepA * i;
        spawnEnemyBullet(
          state,
          boss.x,
          boss.y,
          cos(ang) * atk.speed,
          sin(ang) * atk.speed,
          ang,
          dmg,
          atk.bulletRadius,
          atk.bulletLife,
        );
        state.enemyBulletCount++;
      }
      return;
    }
    case 'hazardLine': {
      const dmg = scaleByBp(atk.damage, powerBp);
      const step = HAZARD_LINE_SPAN / (atk.pillars + 1);
      const startX = player.x - HAZARD_LINE_SPAN / 2;
      for (let i = 1; i <= atk.pillars; i++) {
        spawnHazard(
          state,
          atk.subtype,
          startX + step * i,
          player.y,
          atk.radius,
          atk.windup,
          atk.activeTicks,
          dmg,
          true,
          boss.id,
        );
      }
      return;
    }
    case 'slowField': {
      const dmg = scaleByBp(atk.damage, powerBp);
      const step = HAZARD_LINE_SPAN / (atk.zones + 1);
      const startX = player.x - HAZARD_LINE_SPAN / 2;
      for (let i = 1; i <= atk.zones; i++) {
        spawnHazard(
          state,
          PROP_SLOW_SUBTYPE,
          startX + step * i,
          player.y,
          atk.radius,
          atk.windup,
          atk.activeTicks,
          dmg,
          true,
          boss.id,
        );
      }
      return;
    }
    case 'polygonSpin': {
      const dmg = scaleByBp(atk.damage, powerBp);
      const base = boss.targetX;
      for (let s = 0; s < atk.sides; s++) {
        const sideAngle = base + (s * TWO_PI) / atk.sides;
        const n = atk.perSide;
        const start = n > 1 ? sideAngle - atk.spread / 2 : sideAngle;
        const stepA = n > 1 ? atk.spread / (n - 1) : 0;
        for (let i = 0; i < n; i++) {
          if (state.enemyBulletCount >= state.bulletCap) break;
          const ang = start + stepA * i;
          spawnEnemyBullet(
            state,
            boss.x,
            boss.y,
            cos(ang) * atk.speed,
            sin(ang) * atk.speed,
            ang,
            dmg,
            atk.bulletRadius,
            atk.bulletLife,
          );
          state.enemyBulletCount++;
        }
      }
      boss.targetX = base + atk.turn;
      return;
    }
  }
}

/** 페이즈 전이 화면 소거(적탄 전멸) — boss.ts 규율 복제. */
function clearEnemyBullets(state: WorldState): void {
  for (const e of state.entities) {
    if (e.kind === 'enemyBullet') e.dead = true;
  }
}
