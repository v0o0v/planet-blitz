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
import { DT, VIEW_HEIGHT, HAZARD_LINE_SPAN, SPAWN_RING_RADIUS } from '../constants.js';
import { summonEnemy } from '../waves.js';
import { GUNNER } from '../../../data/enemies.js';
import { applyDefenseBonus } from './defenseBonus.js';
import { invasionCoreAddInterval } from './density.js';
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
  PROP_DECOY_HOLOGRAM,
  PROP_FIXED_CANNON,
  PROP_GRAVITY_ANCHOR,
  PROP_MINE_SUBTYPE,
  PROP_MINE_SWARM,
  PROP_REPAIR_PYLON,
  PROP_SHIELD_GENERATOR,
  PROP_SLOW_SUBTYPE,
  PROP_SOCKET_OFFSETS,
  mineRingOffset,
  propHealAmount,
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

/**
 * 기만 홀로그램(기물 역할 4)만 쓰는 kind. **`'core'` 를 쓰면 안 된다** — `compact()` 는
 * kind 로만 승리를 판정하므로(world.ts) 가짜 코어를 부순 순간 침공이 끝난다. 유니크
 * '신기루 코어'가 같은 이유로 이 kind 를 먼저 만들어 뒀고, 조준·피격 화이트리스트에도 이미
 * 등록돼 있어 world.ts 를 한 줄도 열지 않고 재사용할 수 있다.
 */
const KIND_DECOY_CORE: EntityKind = 'decoyCore';

/** 방어 보스 엔티티 kind(다른 레인·렌더가 조회할 수 있게 공개). */
export const DEFENSE_BOSS_KIND = KIND_DEFENSE_BOSS;
/** 기물 엔티티 kind. */
export const L3_PROP_KIND = KIND_L3_PROP;
/** 기만 홀로그램 엔티티 kind(가짜 코어 — 파괴해도 승리가 서지 않는다). */
export const DECOY_HOLOGRAM_KIND = KIND_DECOY_CORE;

/**
 * 이 엔티티가 **배치된 L3 기물**인가. 기만 홀로그램만 kind 가 `decoyCore` 라 kind 비교
 * 하나로는 셀 수 없다. 코어 모듈 유니크가 스폰하는 신기루 코어(`enemyType === -1`)와는
 * 역할 코드 유무로 갈린다 — 모듈 신기루를 기물로 세면 어픽스 계기(`alliesDestroyed`)가
 * 조용히 어긋난다.
 */
export function isPlacedProp(e: Entity): boolean {
  if (e.kind === KIND_L3_PROP) return true;
  return e.kind === KIND_DECOY_CORE && e.enemyType >= 0;
}

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
  // 코어 HP 도 방어측 계보 보너스를 받는다(방어측 성장 축 — bp=0 이면 무연산이라 바이트 동일).
  const core = spawnInvasionCore(
    state,
    l3.core.x,
    l3.core.y,
    applyDefenseBonus(l3.core.hp, ctx.defenseBonusBp),
  );

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
    ctx.defenseBonusBp,
  );

  // 기물: 빈 소켓은 **비운다**(결정 #22 — 과충전 방지). 소켓 인덱스가 곧 좌표다.
  let generatorShield = 0;
  for (let i = 0; i < l3.props.length; i++) {
    const ref = l3.props[i];
    if (ref === null || ref === undefined) continue;
    const off = PROP_SOCKET_OFFSETS[i];
    if (off === undefined) continue;
    const p = spawnL3Prop(
      state,
      ref,
      i,
      l3.core.x + off.x,
      l3.core.y + off.y,
      ctx.maintenance,
      ctx.defenseBonusBp,
    );
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
  defenseBonusBp = 0,
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
  // 계보 보너스(내구도·피해 두 축, bp=0 이면 무연산)를 강화 3축·어픽스 위에 곱한다.
  b.hp = applyDefenseBonus(affixHp(scaleByBp(def.hp, bp), mods), defenseBonusBp);
  b.maxHp = b.hp;
  b.damage = applyDefenseBonus(affixDamage(scaleByBp(def.contactDamage, bp), mods), defenseBonusBp);
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
  defenseBonusBp = 0,
): Entity | null {
  const spec = propSpec(ref.catalogId);
  if (spec === null) return null;
  const bp = propPowerBp(ref.level, ref.ascension, ref.rarity);
  const mods = defenseAffixSet(CATALOG_PROP, ref).always;
  // 기만 홀로그램만 kind 가 다르다(가짜 코어). 그 외 필드 매핑은 전부 동일하다.
  const p = blankEntity(spec.role === PROP_DECOY_HOLOGRAM ? KIND_DECOY_CORE : KIND_L3_PROP);
  p.x = x;
  p.y = y;
  p.enemyType = spec.role;
  p.pierce = socketIndex;
  p.radius = spec.radius;
  // 보호막(defShieldFlat)은 코어 공급량이 아니라 **자기 내구도 위**에 얹힌다
  // (data/defenseUnits.ts 의 stat 정의 그대로 — "파괴 전까지 내구도 위에 얹힌다").
  // 계보 보너스(내구도 축, bp=0 이면 무연산)를 강화 3축·어픽스 위에 곱한다.
  p.hp = applyDefenseBonus(affixHp(scaleByBp(spec.hp, bp), mods), defenseBonusBp);
  p.maxHp = p.hp;
  switch (spec.role) {
    case PROP_SHIELD_GENERATOR:
      // 실드 공급량(코어 보호막)은 "내구도·피해" 축이 아니라 별도 자원이라 계보 보너스 범위
      // 밖에 둔다(레인 지시 §②가 명시한 축은 방어체 자신의 내구도·피해뿐이다).
      p.targetX = scaleByBp(spec.shieldHp, bp);
      break;
    case PROP_GRAVITY_ANCHOR:
      p.damage = applyDefenseBonus(affixDamage(scaleByBp(spec.hazardDamage, bp), mods), defenseBonusBp);
      p.cooldown = affixCooldown(
        invasionFireCooldown(spec.periodTicks, affixMaintenance(maintenance, mods)),
        mods,
      );
      break;
    case PROP_FIXED_CANNON:
      p.damage = applyDefenseBonus(affixDamage(scaleByBp(spec.damage, bp), mods), defenseBonusBp);
      p.cooldown = affixCooldown(
        invasionFireCooldown(spec.fireCooldown, affixMaintenance(maintenance, mods)),
        mods,
      );
      break;
    case PROP_REPAIR_PYLON:
      // `damage` 슬롯을 **펄스당 회복량**으로 재활용한다(플랫 Entity 규율 — 신규 필드 없음).
      // 회복량은 "피해" 축이 아니므로 계보 보너스를 걸지 않는다(범위 §②와 동일 판단).
      p.damage = propHealAmount(spec, bp);
      p.cooldown = affixCooldown(
        invasionFireCooldown(spec.periodTicks, affixMaintenance(maintenance, mods)),
        mods,
      );
      break;
    case PROP_MINE_SWARM:
      p.damage = applyDefenseBonus(affixDamage(scaleByBp(spec.hazardDamage, bp), mods), defenseBonusBp);
      p.cooldown = affixCooldown(
        invasionFireCooldown(spec.periodTicks, affixMaintenance(maintenance, mods)),
        mods,
      );
      // `phase` = 다음에 지뢰를 깔 링 슬롯(정수 커서). aux0 은 entities.ts 가 '기물 카탈로그
      // id' 로 예약해 둔 자리라 쓰지 않는다.
      p.phase = 0;
      break;
    default:
      // 실드 발생기·기만 홀로그램: 능동 거동 없음.
      break;
  }
  return addEntity(sink, p);
}

// ---------------------------------------------------------------------------
// 스텝
// ---------------------------------------------------------------------------

/**
 * 코어방을 1틱 진행한다: 보스 → 기물 → 수호 → 코어 보호막 갱신 → 코어 증원.
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
  stepCoreReinforcements(state, ctx);
}

/**
 * L3 코어 증원 — 진입 시 1회 배치가 끝이던 코어방에 지속 압박을 더한다. 행성런 보스 세그먼트가
 * `cardInterval: 200` 으로 보스전 중에도 잡몹을 계속 흘리는 것과 같은 의도다
 * (`data/waves.ts` SEGMENTS index 6 주석 — "화력이 부족하면 몹이 쌓여 자연 사망으로 긴 꼬리가
 * 캡된다"). 코어가 깎일수록 소환 간격이 짧아진다({@link invasionCoreAddInterval} — 막판 압박).
 *
 * 규율:
 *   - RNG 미소비: `summonEnemy`(`../waves.js`)만 쓴다.
 *   - 플레이어 좌표 비의존: 소환 위치는 **코어 위치 + 8방위 순회**(경과 틱 ÷ 간격의 정수 함수)로만
 *     정한다.
 *   - 상태 없는 정수 등식 트리거: 별도 카운터를 두지 않고 `elapsed % interval === 0` 으로 판정한다
 *     (density.ts 규율 ③과 동일).
 *   - `l3AddIntervalTicks`/`l3AddMaxAlive` 가 0 이면 정확히 끔 — 첫 줄에서 즉시 반환해
 *     기존 런과 바이트 동일을 지킨다.
 */
function stepCoreReinforcements(state: WorldState, ctx: InvasionStepContext): void {
  const density = ctx.density;
  if (density.l3AddIntervalTicks <= 0 || density.l3AddMaxAlive <= 0) return;
  const core = findCore(state);
  if (core === null) return;
  const interval = invasionCoreAddInterval(
    density.l3AddIntervalTicks,
    coreHpPctOf(core.hp, core.maxHp),
  );
  if (interval <= 0) return;
  const elapsed = state.tick - ctx.runtime.phaseEnterTick;
  if (elapsed <= 0 || elapsed % interval !== 0) return;

  // 코어방은 전이 정리(`phase.ts` clearLayerEntities)가 페이즈 진입 시 'enemy' kind 를 전부
  // 걷어내므로, L3 안에서 살아 있는 'enemy' 는 전부 이 증원 경로가 낸 것이다 — 별도 표식(aux0
  // 등) 없이 kind 로만 세도 동시 생존 상한을 정확히 지킬 수 있다.
  let alive = 0;
  for (const e of state.entities) {
    if (e.kind === 'enemy' && !e.dead) alive++;
  }
  if (alive >= density.l3AddMaxAlive) return;

  // 소환 위치: 코어 중심에서 화면 밖 반지름(SPAWN_RING_RADIUS)만큼 떨어진 8방위를 경과 틱 ÷
  // 간격의 정수 몫으로 순회한다 — 플레이어 좌표를 참조하지 않는다.
  const dirIndex = Math.trunc(elapsed / interval) % L3_ADD_DIRECTION_COUNT;
  const ang = (dirIndex * TWO_PI) / L3_ADD_DIRECTION_COUNT;
  const x = core.x + Math.round(cos(ang) * SPAWN_RING_RADIUS);
  const y = core.y + Math.round(sin(ang) * SPAWN_RING_RADIUS);

  // ## 왜 GUNNER 인가 — REPAIR_DRONE 을 쓰면 **교착이 난다**(2026-08-10 실측)
  //
  // 처음에는 L1 기본 수비대와 같은 결로 맞추려고 `REPAIR_DRONE`(정찰 드론편대 구성원)을 썼다.
  // 그런데 그 정의는 `movement: 'seekWounded'` / `attack: { kind: 'heal' }` 로, **플레이어를
  // 아예 공격하지 않는 힐러**다. L1 종스크롤에서는 스쳐 지나가며 접촉 피해라도 냈지만, L3 는
  // 고정 카메라라 위협이 0 인 채 화면에 남는다.
  //
  // 결과는 예외가 아니라 무내용이었다: 자동 조준이 코어 대신 드론을 계속 물어 코어가 영영 안
  // 깎이고, 드론은 플레이어를 안 때려 HP 도 안 준다 → **L3 가 133,200틱 동안 끝나지 않고
  // 피해 총합이 6 이었다**(정상 경로는 3,588틱 만에 승리, 피해 122).
  //
  // 그래서 「가장 약한 잡몹」이 아니라 **「실제로 플레이어를 때리는 가장 가벼운 적」**을 고른다.
  // GUNNER 는 `movement: 'standoff'` 로 거리를 잡고 박격포를 쏘므로 고정 아레나에서도 압박이
  // 성립한다. 소환 위치·시점은 여전히 플레이어 좌표와 무관하다(이동 AI 가 플레이어를 보는 것은
  // 규율 위반이 아니다 — 규율은 스폰의 결정론이다).
  const e = summonEnemy(state, GUNNER, x, y);
  e.hp = applyDefenseBonus(e.hp, ctx.defenseBonusBp);
  e.maxHp = e.hp;
  e.damage = applyDefenseBonus(e.damage, ctx.defenseBonusBp);
}

/** 코어 증원 소환 방위 수(8방위 순회). */
const L3_ADD_DIRECTION_COUNT = 8;

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
    if (isPlacedProp(e) || e.kind === KIND_DEFENSE_BOSS || e.kind === 'guardian') alive++;
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
    // 기만 홀로그램은 kind 가 `decoyCore` 라 kind 비교로는 걸리지 않는다 — 어픽스 내구 상향이
    // 홀로그램만 조용히 빠지지 않도록 배치 기물 술어로 판정한다.
    if (!isPlacedProp(p) || p.dead) continue;
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
      // 계보 보너스(bp=0 이면 무연산)를 스폰 경로와 같은 순서로 접는다.
      raiseMaxHp(p, applyDefenseBonus(affixHp(scaleByBp(spec.hp, bp), mods), ctx.defenseBonusBp));
      if (p.enemyType === PROP_GRAVITY_ANCHOR || p.enemyType === PROP_MINE_SWARM) {
        p.damage = applyDefenseBonus(
          affixDamage(scaleByBp(spec.hazardDamage, bp), mods),
          ctx.defenseBonusBp,
        );
      } else if (p.enemyType === PROP_FIXED_CANNON) {
        p.damage = applyDefenseBonus(
          affixDamage(scaleByBp(spec.damage, bp), mods),
          ctx.defenseBonusBp,
        );
      } else if (p.enemyType === PROP_REPAIR_PYLON) {
        // 회복량은 어픽스 피해 보정을 타지 않는다(피해 어픽스가 회복을 밀어 올리면 "공격
        // 어픽스인데 왜 회복이 늘지" 라는 규칙 붕괴가 생긴다). 강화 3축만 반영한다.
        p.damage = propHealAmount(spec, bp);
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
      case PROP_REPAIR_PYLON: {
        if (p.cooldown > 0) {
          p.cooldown--;
          break;
        }
        healNearbyDefenders(state, p, spec.range, p.damage);
        p.cooldown = affixCooldown(
          invasionFireCooldown(spec.periodTicks, affixMaintenance(ctx.maintenance, mods)),
          mods,
        );
        break;
      }
      case PROP_MINE_SWARM: {
        if (p.cooldown > 0) {
          p.cooldown--;
          break;
        }
        // 부설 좌표는 링 슬롯 인덱스의 순수 함수다(RNG 미소비). 커서는 정수라 해시 안전.
        const off = mineRingOffset(spec, p.phase);
        spawnHazard(
          state,
          PROP_MINE_SUBTYPE,
          p.x + off.x,
          p.y + off.y,
          spec.hazardRadius,
          spec.hazardWindup,
          spec.hazardActive,
          p.damage,
          false, // 단발 폭발(감속 장판의 지속 피해와 갈린다)
          p.id,
        );
        p.phase++;
        p.cooldown = affixCooldown(
          invasionFireCooldown(spec.periodTicks, affixMaintenance(ctx.maintenance, mods)),
          mods,
        );
        break;
      }
      default:
        // 실드 발생기(공급량은 updateCoreShield 가 읽는다) · 기만 홀로그램(순수 미끼):
        // 능동 거동 없음.
        break;
    }
  }
}

/**
 * 회복 파일런 펄스: 반경 안의 **살아 있는 아군 방어체**를 정수 회복한다(최대 내구도 상한).
 * 자기 자신은 제외한다 — 포함하면 파일런 한 기가 사실상 불사가 되어 "먼저 지울까"라는 선택
 * 자체가 사라진다(파일런 둘을 나란히 두면 서로 살리는 시너지는 그대로 성립한다).
 *
 * 대상은 보스·수호·다른 기물(기만 홀로그램 포함)이다. 코어는 제외한다 — 코어 내구도는
 * 실드 발생기·수호 실드 공유가 담당하는 별도 축이고, 여기에 회복까지 얹으면 코어를 깎는
 * 국면이 통째로 사라진다.
 */
function healNearbyDefenders(
  state: WorldState,
  pylon: Entity,
  range: number,
  amount: number,
): void {
  if (amount <= 0 || range <= 0) return;
  const r2 = range * range;
  for (const t of state.entities) {
    if (t.dead || t.id === pylon.id) continue;
    if (t.kind !== KIND_DEFENSE_BOSS && t.kind !== 'guardian' && !isPlacedProp(t)) continue;
    if (t.hp >= t.maxHp) continue;
    const dx = t.x - pylon.x;
    const dy = t.y - pylon.y;
    if (dx * dx + dy * dy > r2) continue;
    const healed = t.hp + amount;
    t.hp = healed > t.maxHp ? t.maxHp : healed;
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
      // 계보 보너스(bp=0 이면 무연산)를 스폰 경로와 같은 순서로 접는다.
      raiseMaxHp(b, applyDefenseBonus(affixHp(scaleByBp(def.hp, bp), mods), ctx.defenseBonusBp));
      b.damage = applyDefenseBonus(
        affixDamage(scaleByBp(def.contactDamage, bp), mods),
        ctx.defenseBonusBp,
      );
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
