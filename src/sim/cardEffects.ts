/**
 * 방어 카드 효력의 sim 통합 (Lane B — grill-defense-card 스펙 §효과 3범주, lane-a-cards-data 계약).
 *
 * 이 모듈은 방어 카드(정적 카운터=접두·동적 트리거=접미·유니크 룰 변경형)를 **결정론 시뮬**에
 * 접합한다. 설계 원칙(팀 불변 제약):
 *   - **조건부 접기(하위 호환)**: `InvasionConfig.card` 가 없으면(=카드 미장착) 이 모듈의 코드는
 *     한 줄도 실행되지 않는다. world.ts 의 모든 접점은 `state.cardRuntime !== undefined` /
 *     `invasion.card !== undefined` 로 게이트되어, 카드 미장착 침공·PvE 리플레이는 거동·해시가
 *     바이트 단위로 완전 불변이다(계보 마일스톤 PR#51·수호 실드 공유 PR#35 와 동일 철학).
 *   - **서버 권위·스냅샷 소비**: sim 은 카탈로그/프로필을 읽지 않고, 스냅샷에서 온 CardInstance 롤
 *     (id·stat·value)과 공격자 매치업 데이터(AttackerMatchup)만 소비한다. 정적 카운터 조건 판정은
 *     스폰 시점 1회(결정론 고정), 동적 트리거는 런 중 틱 상태로 판정한다.
 *   - **결정론(ADR-0005)**: Math.random·Date.now·pixi 미참조. 모든 수치는 정수 롤/정수 임계이며
 *     보정은 배율(f64) 단일 연산이라 Node(클라)·Deno(서버) 비트 동일. 신규 Entity 필드 없음
 *     (hashEntity 레이아웃 불변) — 유니크 신기루 코어만 신규 KIND(decoyCore, append-only)를 쓴다.
 *
 * stat → sim 보정 매핑(lane-a-cards-data.md 계약 표):
 *   정적(접두, 조건 일치 시): incomingDmgReductionPct=코어·포탑 피격 감소, turretDamagePct=포탑
 *   화력↑, attackerSubCdPct=공격자 보조무기 쿨↑. 동적(접미, 트리거 발동 시): coreShieldFlat=코어
 *   실드(코어 근접), turretFireRatePct=포탑 연사↑(포탑 3기 파괴·초반), attackerSlowPct=공격자 감속
 *   (90초), volleyDamage=일제사격(수호 격추), turretDamagePct=포탑 화력↑(코어 저HP),
 *   reflectDamagePct=반사(코어 피격), incomingDmgReductionPct=피해 감소(120초). 유니크: 신기루
 *   코어(가짜 코어)·블랙아웃(레이더 무력화 플래그)·최후의 재기동(코어 1회 부활)·거울 관문(반사).
 */

import type { Entity, EntitySink } from './entities.js';
import { blankEntity, addEntity } from './entities.js';
import { TICK_RATE } from './constants.js';
import {
  CARD_AFFIX_BY_ID,
  CARD_BASE_EFFECT,
  DEFENSE_CARD_UNIQUE_BY_ID,
} from '../../data/defenseCards.js';
import type { CardInstance, CounterCondition } from '../../data/defenseCards.js';

// ---------------------------------------------------------------------------
// 튜닝 상수 (📝 밸런스 조정 대상, 스펙 §Constraints)
// ---------------------------------------------------------------------------

/**
 * `powerSuperiority` 정적 카운터 발동 임계(전투력 점수 차). 공격자CP − 방어자CP 가 이 값 이상일 때만
 * cc-armorbreak 가 발동한다(스펙 R3 "전투력 우위 임계 초과"). 📝 시작값.
 */
export const CARD_POWER_SUPERIORITY_MARGIN = 500;

/**
 * 코어 근접 트리거(ct-forcefield) 판정 반경 여유. 공격자(플레이어)가 코어 중심에서
 * `core.radius + 이 값` 이내로 진입하면 발동한다. 📝 시작값.
 */
export const CARD_CORE_PROXIMITY_MARGIN = 260;

/** 방어 시설 피해 감소 상한(%). 정적+동적 감소 합산이 이 값을 넘지 않게 클램프(무적 방어 방지). */
export const CARD_MAX_DMG_REDUCTION_PCT = 90;

/** 신기루 코어(가짜 코어) 스폰 위치 오프셋(실제 코어로부터 +x). 결정론 고정 좌표. 📝 시작값. */
export const CARD_DECOY_OFFSET_X = 240;

/** 가짜 코어 반지름(실제 코어와 동일 히트박스 — 렌더/조준 상 실제와 구분 불가하게). */
export const CARD_DECOY_RADIUS = 90;

// ---------------------------------------------------------------------------
// 설정 계약 (Lane C 가 begin_invasion 스냅샷에 채워 넣는다 — 서버 권위)
// ---------------------------------------------------------------------------

/**
 * 정적 카운터(접두) 조건 판정 입력 — 공격자 스냅샷 매치업 데이터. Lane C(서버)가 begin_invasion
 * 스냅샷에 방어자 카드와 함께 실어, sim 이 스폰 시점 1회 조건 일치를 판정한다(결정론 고정).
 * 서버 재실행은 권위 매치업으로 재판정하므로, 공격자가 이 값을 위조해 정적 카운터를 끄려 하면
 * hashStream 이 갈려 거부된다(원칙2 서버 권위).
 */
export interface AttackerMatchup {
  /** 공격자 로드아웃에 화염 어픽스(loadout.fireDmg>0) 존재 → fireAttacker. */
  readonly fire: boolean;
  /** 냉기(loadout.coldSlow>0) → coldAttacker. */
  readonly cold: boolean;
  /** 전격(loadout.lightning>0) → lightningAttacker. */
  readonly lightning: boolean;
  /** 주무기가 빔/레일건 계열(weaponType 4 빔 · 2 레일건) → beamAttacker. */
  readonly beam: boolean;
  /** 공격자 전투력 점수(combatPower). powerSuperiority 판정 입력. */
  readonly attackerCp: number;
  /** 방어자 전투력 점수. powerSuperiority 판정 입력. */
  readonly defenderCp: number;
  /** 복수전 대상 공격자 → revenge. */
  readonly revenge: boolean;
  /** 동일 공격자의 재침공 → reinvasion. */
  readonly reinvasion: boolean;
  /** 공격자가 강한 보조무기를 장착 → subweaponHeavy(서버가 보조무기 강도 임계로 판정해 부여). */
  readonly subweaponHeavy: boolean;
}

/**
 * 방어전 카드 효력 설정(InvasionConfig.card). 방어자 장착 카드(서버 권위 CardInstance)와 공격자
 * 매치업 데이터를 함께 싣는다. 이 필드가 없으면 카드 미장착 = 기존 침공/PvE 경로와 완전 동일.
 */
export interface DefenseCardConfig {
  /** 방어자 장착 카드(스냅샷 고정, ADR-0012). 서버가 apply_invasion_result 확정 시 chargesLeft 차감. */
  readonly card: CardInstance;
  /** 공격자 매치업 데이터(정적 카운터 조건 판정 입력). */
  readonly matchup: AttackerMatchup;
}

// ---------------------------------------------------------------------------
// 런타임 상태 (WorldState.cardRuntime — 카드 장착 침공에만 존재)
// ---------------------------------------------------------------------------

/**
 * 방어 카드 효력의 결정론 런타임. `initCardRuntime` 가 스냅샷 카드+매치업에서 정적으로 해석한
 * 상수 필드와, 런 중 갱신되는 상태(부활 횟수·블랙아웃 잔여·근접 실드 래치)를 담는다. 마지막
 * 4개 배율(`*Mult`)은 매 틱 `stepCardRuntime` 이 재계산하는 **스크래치**(해시 비접힘 — 순수하게
 * 접힌 상수·틱·엔티티 상태의 파생이므로).
 */
export interface CardRuntime {
  // --- 정적 해석 상수(런 내 불변) ---
  /** 기저 + 조건 일치 접두(cc-armorbreak/cc-avenger)의 포탑 화력 +%. */
  readonly staticTurretDamagePct: number;
  /** 조건 일치 접두(소화/방한/분광/연전차단)의 방어 시설 피해 감소 합 %. */
  readonly staticIncomingReductionPct: number;
  /** 조건 일치 접두(절연/교란)의 공격자 보조무기 쿨다운 증가 합 %. */
  readonly attackerSubCdPct: number;
  /** 코어 피격 반사 % (ct-reflection + 유니크 거울 관문 합). */
  readonly reflectPct: number;
  /** 기저 코어 HP +%(스폰 시 1회 적용, 재현·감사용 보존). */
  readonly coreHpPct: number;
  // 동적 트리거 파라미터(미보유 = 0)
  readonly furyFireRatePct: number;
  readonly furyThreshold: number; // 포탑 파괴 수 임계
  readonly vanguardFireRatePct: number;
  readonly vanguardTicks: number; // 초반 구간 틱(초×TICK_RATE)
  readonly laststandTurretDamagePct: number;
  readonly laststandPct: number; // 코어 HP % 임계
  readonly attritionSlowPct: number;
  readonly attritionTicks: number; // 경과 틱 임계
  readonly entrenchReductionPct: number;
  readonly entrenchTicks: number; // 경과 틱 임계
  readonly forcefieldShield: number; // 코어 근접 시 부여 실드(절대)
  readonly volleyDamage: number; // 수호 격추 시 공격자 피해
  // 유니크 파라미터
  reviveCount: number; // 최후의 재기동 잔여 부활 횟수(런 중 소진)
  readonly reviveHpPct: number;
  readonly decoyHpPct: number;
  readonly decoyCount: number;
  blackoutTicksLeft: number; // 블랙아웃 잔여 틱(런 중 감소; 렌더가 읽음)
  // --- 런 중 래치 상태 ---
  coreProximityFired: boolean; // 코어 근접 실드 1회 부여 완료
  readonly initialTurretCount: number; // 스폰 시 포탑 수(파괴 수 계산 기준)
  // --- 매 틱 재계산 스크래치(해시 비접힘) ---
  turretDamageMult: number;
  turretFireRateMult: number;
  defenseDmgMult: number;
  attackerSlowMult: number;
}

// ---------------------------------------------------------------------------
// 정적 카운터 조건 판정
// ---------------------------------------------------------------------------

/** 정적 카운터 조건이 공격자 매치업과 일치하는가(스폰 시점 1회 판정, 결정론 고정). */
function matchCondition(cond: CounterCondition, m: AttackerMatchup): boolean {
  switch (cond) {
    case 'fireAttacker':
      return m.fire;
    case 'coldAttacker':
      return m.cold;
    case 'lightningAttacker':
      return m.lightning;
    case 'beamAttacker':
      return m.beam;
    case 'powerSuperiority':
      return m.attackerCp - m.defenderCp >= CARD_POWER_SUPERIORITY_MARGIN;
    case 'revenge':
      return m.revenge;
    case 'reinvasion':
      return m.reinvasion;
    case 'subweaponHeavy':
      return m.subweaponHeavy;
  }
}

// ---------------------------------------------------------------------------
// 런타임 해석 + 스폰 효과 (createWorld 가 호출)
// ---------------------------------------------------------------------------

/**
 * 스냅샷 카드+매치업을 결정론 런타임으로 해석한다. 정적 카운터(접두)는 조건 일치 시에만 수치를
 * 누적하고, 동적 트리거(접미)·유니크 파라미터는 발동 조건과 함께 저장한다. 부수효과로 스폰
 * 시점 효과를 적용한다: ① 기저 코어 HP +%, ② 유니크 신기루 코어(가짜 코어) 스폰. sink 로 코어·
 * 포탑을 조회하고 가짜 코어에 id 를 할당한다(createWorld 가 nextEntityId 를 회수).
 */
export function initCardRuntime(cfg: DefenseCardConfig, sink: EntitySink): CardRuntime {
  const { card, matchup } = cfg;
  const base = CARD_BASE_EFFECT[card.rarity];

  let staticTurretDamagePct = base.turretDamagePct;
  let staticIncomingReductionPct = 0;
  let attackerSubCdPct = 0;

  // 정적 카운터(접두): 조건 일치 롤만 stat 별 누적.
  for (const roll of card.prefixes) {
    const def = CARD_AFFIX_BY_ID.get(roll.id);
    if (def === undefined || def.condition === undefined) continue;
    if (!matchCondition(def.condition, matchup)) continue;
    switch (roll.stat) {
      case 'turretDamagePct':
        staticTurretDamagePct += roll.value;
        break;
      case 'incomingDmgReductionPct':
        staticIncomingReductionPct += roll.value;
        break;
      case 'attackerSubCdPct':
        attackerSubCdPct += roll.value;
        break;
      default:
        break;
    }
  }

  // 동적 트리거(접미): 발동 파라미터를 트리거별로 저장(미보유 = 0).
  let reflectPct = 0;
  let furyFireRatePct = 0;
  let furyThreshold = 0;
  let vanguardFireRatePct = 0;
  let vanguardTicks = 0;
  let laststandTurretDamagePct = 0;
  let laststandPct = 0;
  let attritionSlowPct = 0;
  let attritionTicks = 0;
  let entrenchReductionPct = 0;
  let entrenchTicks = 0;
  let forcefieldShield = 0;
  let volleyDamage = 0;
  for (const roll of card.suffixes) {
    const def = CARD_AFFIX_BY_ID.get(roll.id);
    if (def === undefined || def.trigger === undefined) continue;
    const thr = def.threshold ?? 0;
    switch (def.trigger) {
      case 'coreProximity':
        forcefieldShield += roll.value;
        break;
      case 'turretsDestroyed':
        furyFireRatePct += roll.value;
        furyThreshold = thr;
        break;
      case 'earlyPhase':
        vanguardFireRatePct += roll.value;
        vanguardTicks = thr * TICK_RATE;
        break;
      case 'coreHpLow':
        laststandTurretDamagePct += roll.value;
        laststandPct = thr;
        break;
      case 'guardianDowned':
        volleyDamage += roll.value;
        break;
      case 'coreHit':
        reflectPct += roll.value;
        break;
      case 'timeElapsed':
        // 90초=지연전(감속), 120초=지구전(피해 감소) — stat 으로 구분(threshold 는 초).
        if (roll.stat === 'attackerSlowPct') {
          attritionSlowPct += roll.value;
          attritionTicks = thr * TICK_RATE;
        } else if (roll.stat === 'incomingDmgReductionPct') {
          entrenchReductionPct += roll.value;
          entrenchTicks = thr * TICK_RATE;
        }
        break;
    }
  }

  // 유니크 룰 변경형 파라미터.
  let reviveCount = 0;
  let reviveHpPct = 0;
  let decoyHpPct = 0;
  let decoyCount = 0;
  let blackoutTicksLeft = 0;
  if (card.uniqueId !== undefined) {
    const uq = DEFENSE_CARD_UNIQUE_BY_ID.get(card.uniqueId);
    if (uq !== undefined) {
      const p = uq.params;
      switch (card.uniqueId) {
        case 'uq-mirage-core':
          decoyCount = p.decoyCount ?? 0;
          decoyHpPct = p.decoyHpPct ?? 0;
          break;
        case 'uq-blackout':
          blackoutTicksLeft = p.radarDisableTicks ?? 0;
          break;
        case 'uq-last-reboot':
          reviveCount = p.reviveCount ?? 0;
          reviveHpPct = p.reviveHpPct ?? 0;
          break;
        case 'uq-mirror-gate':
          reflectPct += p.reflectPct ?? 0;
          break;
      }
    }
  }

  // 스폰 시점 효과 ①: 기저 코어 HP +%(실제 코어에만; 가짜 코어는 아래에서 별도 HP).
  const coreHpPct = base.coreHpPct;
  let core: Entity | undefined;
  let initialTurretCount = 0;
  for (const e of sink.entities) {
    if (e.kind === 'core') core = e;
    // 구 포탑(defenseTurret)은 M7a L11 에서 삭제됐다 — L2 회랑의 벽부착 방어포가 계승자다.
    // (M7b 코어 모듈 재설계 전까지 이 런타임을 만드는 경로 자체가 없어 실행되지 않는다.)
    else if (e.kind === 'facilityGun') initialTurretCount++;
  }
  if (core !== undefined && coreHpPct !== 0) {
    const scaled = Math.round(core.maxHp * (1 + coreHpPct / 100));
    core.hp = scaled;
    core.maxHp = scaled;
  }

  // 스폰 시점 효과 ②: 유니크 신기루 코어(가짜 코어) 스폰. 실제 코어 HP(기저 버프 반영)의 일부만
  // 갖는 decoyCore 를 실제 코어 곁에 배치한다. 파괴돼도 침공 승리로 이어지지 않는다(compact 무시).
  if (core !== undefined && decoyCount > 0 && decoyHpPct > 0) {
    const decoyHp = Math.max(1, Math.round(core.maxHp * (decoyHpPct / 100)));
    for (let i = 0; i < decoyCount; i++) {
      const d = blankEntity('decoyCore');
      d.x = core.x + CARD_DECOY_OFFSET_X * (i + 1);
      d.y = core.y;
      d.radius = CARD_DECOY_RADIUS;
      d.hp = decoyHp;
      d.maxHp = decoyHp;
      addEntity(sink, d);
    }
  }

  return {
    staticTurretDamagePct,
    staticIncomingReductionPct,
    attackerSubCdPct,
    reflectPct,
    coreHpPct,
    furyFireRatePct,
    furyThreshold,
    vanguardFireRatePct,
    vanguardTicks,
    laststandTurretDamagePct,
    laststandPct,
    attritionSlowPct,
    attritionTicks,
    entrenchReductionPct,
    entrenchTicks,
    forcefieldShield,
    volleyDamage,
    reviveCount,
    reviveHpPct,
    decoyHpPct,
    decoyCount,
    blackoutTicksLeft,
    coreProximityFired: false,
    initialTurretCount,
    turretDamageMult: 1,
    turretFireRateMult: 1,
    defenseDmgMult: 1,
    attackerSlowMult: 1,
  };
}

// ---------------------------------------------------------------------------
// 매 틱 런타임 갱신 (stepWorld 가 침공+카드 장착 시 stepPlayer 이전에 호출)
// ---------------------------------------------------------------------------

/**
 * 방어 카드 런타임을 1틱 갱신한다: ① 블랙아웃 잔여 감소, ② 코어 근접 실드 1회 부여(래치),
 * ③ 동적 트리거 상태로 이번 틱 유효 배율(포탑 화력·연사, 방어 피해 감소, 공격자 감속) 재계산.
 * 배율은 스크래치라 해시에 직접 접히지 않고, world.ts 접점(stepDefenseTurrets·resolveCollisions·
 * stepPlayer)이 읽어 거동에 반영한다(그 결과는 엔티티 상태로 해시에 반영). 결정론: 틱·시작 시점
 * 코어 HP·현재 포탑 수의 순수 함수.
 */
export function stepCardRuntime(state: {
  tick: number;
  entities: Entity[];
  cardRuntime?: CardRuntime;
}, player: Entity): void {
  const cr = state.cardRuntime;
  if (cr === undefined) return;

  if (cr.blackoutTicksLeft > 0) cr.blackoutTicksLeft--;

  // 시작 시점 코어(있으면) 조회 + 현재 포탑 수 집계(파괴 수 = 초기 − 현재).
  let core: Entity | undefined;
  let liveTurrets = 0;
  for (const e of state.entities) {
    if (e.dead) continue;
    if (e.kind === 'core') core = e;
    else if (e.kind === 'facilityGun') liveTurrets++;
  }
  const turretsDestroyed = cr.initialTurretCount - liveTurrets;
  const coreHpFrac = core !== undefined && core.maxHp > 0 ? core.hp / core.maxHp : 1;

  // 코어 근접 실드(ct-forcefield): 미발동 + 코어 존재 + 공격자가 근접 반경 진입 시 1회 부여.
  if (!cr.coreProximityFired && cr.forcefieldShield > 0 && core !== undefined) {
    const dx = player.x - core.x;
    const dy = player.y - core.y;
    const reach = core.radius + CARD_CORE_PROXIMITY_MARGIN;
    if (dx * dx + dy * dy <= reach * reach) {
      core.targetY += cr.forcefieldShield; // 실드는 targetY(피해 선흡수, 실드공유와 동일 필드)
      cr.coreProximityFired = true;
    }
  }

  // 이번 틱 유효 배율 재계산(트리거 상태 반영).
  const coreLow = cr.laststandPct > 0 && coreHpFrac * 100 <= cr.laststandPct;
  const turretDmgPct = cr.staticTurretDamagePct + (coreLow ? cr.laststandTurretDamagePct : 0);
  cr.turretDamageMult = 1 + turretDmgPct / 100;

  const furyOn = cr.furyThreshold > 0 && turretsDestroyed >= cr.furyThreshold;
  const vanguardOn = cr.vanguardTicks > 0 && state.tick < cr.vanguardTicks;
  const fireRatePct = (furyOn ? cr.furyFireRatePct : 0) + (vanguardOn ? cr.vanguardFireRatePct : 0);
  cr.turretFireRateMult = 1 + fireRatePct / 100;

  const entrenchOn = cr.entrenchTicks > 0 && state.tick >= cr.entrenchTicks;
  let reductionPct = cr.staticIncomingReductionPct + (entrenchOn ? cr.entrenchReductionPct : 0);
  if (reductionPct > CARD_MAX_DMG_REDUCTION_PCT) reductionPct = CARD_MAX_DMG_REDUCTION_PCT;
  cr.defenseDmgMult = 1 - reductionPct / 100;

  const attritionOn = cr.attritionTicks > 0 && state.tick >= cr.attritionTicks;
  cr.attackerSlowMult = 1 - (attritionOn ? cr.attritionSlowPct : 0) / 100;
}
