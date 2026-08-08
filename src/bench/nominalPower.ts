/**
 * 명목 파워 모델 — 출시 전 밸런스 1회 패스의 계산 축 (기준 2·3).
 *
 * ## 무엇을 재는가
 *
 * **표준 장비 + `baseBp` + 시그니처 기대값**으로 기체별 초당공격력(DPS)·실효체력(EHP)·
 * 그 곱(총 파워)을 낸다. **sim 을 한 틱도 돌리지 않는다** — 전부 닫힌 식이라 결정론이고
 * 즉시 재계산된다.
 *
 * ## 왜 클리어율이 아니라 이것인가
 *
 * 이 리포의 봇 계측은 "적절한 난이도"를 답할 수 없다. ADR-0051 이 봇 완주 e2e 를 게이트에서
 * 내린 사유가 그것이고(`피격 피해 2배 이후 무입력 파일럿이 런을 완주하지 못한다`),
 * `bench/runCurve.ts` 는 기본 HP 로 Lv10·Lv40 양쪽 다 클리어율 0% 를 실측했다.
 * `--durable` 로 우회하면 돌지만 그건 *생존을 관측에서 뺀* 값이다.
 *
 * 그래서 **절대 난이도는 사람이 앉아서 정하고**(기준점 기체 = 스트라이커, `baseBp` 전 축 0),
 * 나머지 6기체는 이 표의 곱 비율로 환산한다. 이 모듈은 그 환산표를 낸다.
 *
 * ## ⚠️ 이 모델이 구조적으로 못 보는 것 (읽는 사람이 반드시 알아야 한다)
 *
 * 시그니처는 전부 **sim 안의 상태 기계**다 — 장갑은 피격으로 쌓이고, 은신은 무피격 스트릭을
 * 요구하고, 과충전은 정지 시간을 요구한다. 이 모듈은 그것을 {@link NominalAssumptions} 의
 * **가정치**로 환산한다. 가정이 틀리면 표 전체가 같은 방향으로 틀린다.
 *
 * 방어책은 두 가지이고 **둘 다 해야 한다**:
 *  1. `--sens` 로 가정치를 흔들어 순위가 뒤집히는지 본다(감도 확인).
 *  2. 사람이 대조군 기체 1종을 실제로 플레이해 표의 **부호**가 맞는지 확인한다.
 *
 * 액티브 스킬 42종은 **의도적으로 제외**한다 — 발동 빈도가 플레이어 조작에 달려 있어
 * 기대값 자체가 허구가 된다. 촉매도 같은 이유로 제외(무촉매 기준선).
 *
 * ## 결정론 경계
 *
 * `src/bench/**` 는 측정 계층이다. `src/sim/**` 은 이 파일을 import 하지 않는다. 반대로 이
 * 파일은 sim 을 **상수로만** 읽는다(`shipSignature.ts` 의 시그니처 상수 · `constants.ts` 의
 * 틱 눈금) — sim 을 실행하지 않는다. `Math.random`·`Date.now` 를 쓰지 않는다.
 */

import { computeLoadoutStats } from '../items/loadout.js';
import type { Item } from '../items/types.js';
import { standardGearSet, STANDARD_BUILD_SEED } from './standardBuild.js';
import { starterEquipped } from '../items/starterKit.js';
import { SHIP_TYPES } from '../../data/ships/index.js';
import { TICK_RATE } from '../sim/constants.js';
import {
  SIG_BRUISER_ARMOR,
  SIG_ARC_OVERCHARGE,
  SIG_PHANTOM_CLOAK,
  SIG_HATCHLING_BROOD,
  SIG_MALLOW_CUSHION,
  SIG_BUBBLE_FILM,
  SIG_STRIKER_MARKSMAN,
  ARMOR_MAX_STACKS,
  armorReductionBp,
  overchargeBp,
  CLOAK_UNHIT_TICKS,
  CLOAK_HOLD_TICKS,
  CLOAK_BREAK_BP,
  hatchThreshold,
  CUSHION_DEFER_BP,
  CUSHION_RECOVER_BP,
  FILM_PERIOD_TICKS,
  FILM_ABSORB_FLAT,
  MARKSMAN_CYCLE_SHOTS,
  MARKSMAN_BONUS_BP,
} from '../sim/shipSignature.js';

// ---------------------------------------------------------------------------
// sim 기준값 — `world.ts` 의 DEFAULT_WEAPON · DEFAULT_CONFIG 와 정합해야 한다
// ---------------------------------------------------------------------------

/**
 * 무기 기준 피해. `world.ts` `DEFAULT_WEAPON.damage`.
 *
 * ⚠️ 이 셋(`BASE_DAMAGE`·`BASE_FIRE_CD_TICKS`·`BASE_PLAYER_HP`)은 sim 값의 **사본**이다.
 * sim 을 값으로 import 하지 않는 측정 계층 규율(`standardBuild.ts` 머리말과 같은 사유) 때문에
 * 재선언하되, `tests/nominalPower.test.ts` 의 드리프트 가드가 두 축이 갈라지면 잡는다.
 */
export const BASE_DAMAGE = 8;
/** 무기 기준 발사 간격(틱). `world.ts` `DEFAULT_WEAPON.fireCooldownQ = 6 * FIRE_CD_Q`. */
export const BASE_FIRE_CD_TICKS = 6;
/** 발사 간격 하한(틱). `constants.ts` `FIRE_CD_MIN_Q = 2 * FIRE_CD_Q`. */
export const MIN_FIRE_CD_TICKS = 2;
/** 플레이어 기준 HP. `world.ts` `DEFAULT_CONFIG.playerHp`(= `guardian.ts` `PLAYER_BASE_HP`). */
export const BASE_PLAYER_HP = 100;

/** 병아리 드론 1기의 DPS — `events.ts` `TURRET_BULLET_DAMAGE 10` × (60틱 ÷ `TURRET_FIRE_COOLDOWN 10`). */
export const BROOD_DRONE_DPS = 10 * (TICK_RATE / 10);
/** 병아리 드론 수명(초). `events.ts` `TURRET_LIFE_TICKS 600`. */
export const BROOD_DRONE_LIFE_SEC = 600 / TICK_RATE;
/** 병아리 동시 생존 상한. `world.ts` `BROOD_MAX_DRONES`. */
export const BROOD_MAX_DRONES = 4;

// ---------------------------------------------------------------------------
// 가정치
// ---------------------------------------------------------------------------

/**
 * 시그니처 기대값 환산에 쓰는 가정치. **이 값들이 이 모델의 신뢰도 전부다** — 표를 낼 때
 * 반드시 함께 출력하고, 판정 전에 `--sens` 로 흔들어 순위가 뒤집히는지 확인한다.
 */
export interface NominalAssumptions {
  /**
   * 브루저 장갑 평균 스택(0..{@link ARMOR_MAX_STACKS}). 스택은 피격으로 쌓이고
   * `ARMOR_DECAY_TICKS`(180) 만에 빠진다. 지속 교전이면 상한 근처, 회피 위주면 낮다.
   * 기본 4 = 상한의 절반(중립 가정 — 어느 쪽으로도 유리하게 잡지 않는다).
   */
  armorAvgStacks: number;
  /**
   * 아크캐스터 과충전 점유율 — `OVERCHARGE_STILL_TICKS`(90틱 = 1.5초) 이상 정지해 있는
   * 시간의 비율. 탄막 아레나에서 1.5초 정지는 흔하지 않으므로 기본 0.25.
   */
  overchargeUptime: number;
  /**
   * 과충전이 걸려 있는 동안의 평균 누적 정지 틱. 램프(`OVERCHARGE_RAMP_BP` 25bp/틱)가
   * 여기에 걸린다. 기본 120 = 임계 90 + 0.5초.
   */
  overchargeAvgStillTicks: number;
  /**
   * 팬텀 은신 사이클 완주 비율(0..1) — `CLOAK_UNHIT_TICKS`(240틱 = 4초) 무피격을 채워
   * 은신에 진입하는 사이클의 비율. 한 대라도 맞으면 카운터가 0 으로 돌아간다. 기본 0.35.
   */
  cloakCycleRate: number;
  /**
   * 초당 처치 수 — 해츨링 부화 빈도의 분자. 부화체는 누적 처치가 임계를 넘을 때 1기 나가고,
   * 임계는 `hatchThreshold` 로 12 → 40 까지 계단식으로 오른다. 기본 3.0.
   */
  killsPerSec: number;
  /** 해츨링 부화 임계 산정에 쓸 런 누적 처치(임계가 계단식이라 구간이 필요하다). 기본 300. */
  cumulativeKills: number;
  /**
   * 말로우 완충 회복 성공률(0..1) — 지연된 피해가 `CUSHION_RECOVER_TICKS`(180틱 = 3초)
   * 무피격을 채워 실제로 회복되는 비율. 기본 0.40.
   */
  cushionRecoverRate: number;
  /**
   * 노출 시간(초) — **플랫 효과를 누적하는 창**이다. 막 흡수(60/7초)와 부화체 DPS 는 시간에
   * 비례해 쌓이므로 창이 없으면 값이 정의되지 않는다. 기본 {@link RUN_SECONDS_PAR}.
   */
  runSeconds: number;
}

/**
 * 표준 런 par(초). `src/save/progressionPath.ts` 의 `RUN_SECONDS_PAR` 와 같은 눈금이다.
 *
 * ⚠️ 측정 계층이 튜닝 대상에 런타임 의존하지 않도록 재선언한다(`standardBuild.ts` 가
 * `STANDARD_PROGRESSION_PATH` 를 import 하지 않는 것과 같은 사유). 드리프트는
 * `tests/nominalPower.test.ts` 가 대조한다.
 */
export const RUN_SECONDS_PAR = 95;

/** 중립 기본 가정치. 어느 기체에도 유리하게 기울이지 않도록 잡았다. */
export const DEFAULT_ASSUMPTIONS: NominalAssumptions = {
  armorAvgStacks: 4,
  overchargeUptime: 0.25,
  overchargeAvgStillTicks: 120,
  cloakCycleRate: 0.35,
  killsPerSec: 3.0,
  cumulativeKills: 300,
  cushionRecoverRate: 0.4,
  runSeconds: RUN_SECONDS_PAR,
};

// ---------------------------------------------------------------------------
// 스탯 산출 (닫힌 식 — `world.ts` 1551-1568 의 적용 순서를 그대로 미러한다)
// ---------------------------------------------------------------------------

/** 한 기체·한 레벨의 명목 파워 분해. */
export interface NominalRow {
  typeId: number;
  slug: string;
  level: number;
  /** 장비·baseBp 만 반영한 발당 피해. */
  damage: number;
  /** 장비·baseBp 만 반영한 발사 간격(틱). */
  fireCdTicks: number;
  /** 볼리당 탄 수. */
  bulletCount: number;
  /** 시그니처 **제외** 초당공격력. */
  baseDps: number;
  /** 시그니처 **실효** 공격 배율 = `dps / baseDps`(가산분까지 반영한 뒤의 비). */
  sigAtk: number;
  /** 시그니처 반영 초당공격력. */
  dps: number;
  /** 시그니처 **제외** 체력. */
  hp: number;
  /** 시그니처 **실효** 방어 배율 = `ehp / hp`(가산분까지 반영한 뒤의 비). */
  sigDef: number;
  /** 시그니처 반영 실효체력. */
  ehp: number;
  /** 총 파워 = dps × ehp. */
  power: number;
}

/**
 * 장비 + `baseBp` 만으로 원시 스탯을 낸다(시그니처 제외).
 *
 * `world.ts` 의 적용 순서를 **그대로** 미러한다 — 반올림 위치까지 같아야 표가 sim 과 갈리지
 * 않는다(`damage` 는 소수 2자리 반올림, `fireCd` 는 정수 틱 반올림 후 하한 클램프).
 */
export function rawStats(
  equipped: readonly Item[],
  typeId: number,
): { damage: number; fireCdTicks: number; bulletCount: number; hp: number } {
  const { loadout } = computeLoadoutStats(equipped, undefined, typeId);
  const damage = Math.round(BASE_DAMAGE * loadout.damageMult * 100) / 100;
  // world.ts 는 고정소수점(1/256틱)으로 굴린다. 여기서는 같은 산술을 틱 단위로 환산해
  // 재현한다 — 반올림 눈금이 1/256 이라 정수 틱 반올림보다 훨씬 촘촘하다.
  const cdQ = Math.max(
    MIN_FIRE_CD_TICKS * 256,
    Math.round(BASE_FIRE_CD_TICKS * 256 * loadout.fireRateMult),
  );
  return {
    damage,
    fireCdTicks: cdQ / 256,
    bulletCount: 1 + loadout.bulletCountAdd,
    hp: BASE_PLAYER_HP + loadout.maxHpAdd,
  };
}

// ---------------------------------------------------------------------------
// 시그니처 기대값 환산
// ---------------------------------------------------------------------------

/**
 * 시그니처 하나가 내는 효과. **플랫과 비율을 분리해서 담는다.**
 *
 * ## 왜 분리하는가 (초판이 여기서 틀렸다)
 *
 * 초판은 플랫 효과(막 흡수 60/7초, 부화체 60DPS)를 가정된 분모로 나눠 비율로 바꾼 뒤
 * `1/(1-감소율)` 로 접었다. 그 형식은 감소율이 1 에 가까워지면 **발산**한다 — 실제로 버블이
 * 파워 10배로 튀었고, 0.9 클램프가 그 발산을 실패시키지 않고 **가렸다**. 나쁜 입력을 조용히
 * 삼키는 계산기는 계측기가 아니다.
 *
 * 올바른 형식은 성질을 보존하는 것이다:
 *  · **플랫**(흡수량·부화체 화력) → 노출 시간만큼 쌓아 **가산**한다. 발산하지 않는다.
 *  · **비율**(장갑 감소·과충전·완충) → **곱셈**한다.
 *
 * 부수 효과로 초판의 가장 취약한 가정치(`incomingDps` — 초당 받는 피해)가 모델에서 통째로
 * 사라졌다. 플랫을 비율로 바꿀 때만 필요했던 분모였다.
 */
export interface SigEffect {
  /** 공격 비율 배율(1 = 무영향). */
  atkMult: number;
  /** 공격 가산(초당공격력에 그대로 더한다). */
  atkFlat: number;
  /** 방어 비율 배율(1 = 무영향). */
  defMult: number;
  /** 방어 가산(실효체력에 그대로 더한다 — 노출 시간 동안 흡수하는 총량). */
  defFlat: number;
  /** 표에 함께 찍을 한 줄 설명(가정치가 어디에 걸렸는지 읽는 사람이 알아야 한다). */
  note: string;
}

const NEUTRAL: Omit<SigEffect, 'note'> = { atkMult: 1, atkFlat: 0, defMult: 1, defFlat: 0 };

/**
 * 버블 막이 **무조건 상쇄하는 초당 피해**(= 흡수량 ÷ 재생 주기). 받는 피해가 이 값 미만이면
 * 막이 소모보다 빨리 재생돼 버블은 죽지 않는다 — {@link sigEffect} 의 버블 절 참조.
 */
export function filmDenyDps(): number {
  return FILM_ABSORB_FLAT / (FILM_PERIOD_TICKS / TICK_RATE);
}

/**
 * 시그니처 비트 하나를 기대값 효과로 환산한다.
 *
 * `shotsPerSec` 를 받는 이유: 은신 해제 첫 타(2.5배 **1발**)는 주기당 1회라 초당 발사 수로
 * 나눠야 배율이 된다. 이것은 플랫→비율 환산이 아니라 **주기 정규화**이므로 발산하지 않는다.
 */
export function sigEffect(
  bit: number,
  a: NominalAssumptions,
  shotsPerSec: number,
): SigEffect {
  switch (bit) {
    case SIG_STRIKER_MARKSMAN: {
      // 12볼리마다 1볼리가 +50%. 가정치가 필요 없는 유일한 시그니처다(순수 주기).
      const atkMult = 1 + MARKSMAN_BONUS_BP / 10000 / MARKSMAN_CYCLE_SHOTS;
      return {
        ...NEUTRAL,
        atkMult,
        note: `정조준 +50%/${MARKSMAN_CYCLE_SHOTS}볼리 (가정치 없음)`,
      };
    }
    case SIG_BRUISER_ARMOR: {
      const stacks = Math.min(ARMOR_MAX_STACKS, Math.max(0, a.armorAvgStacks));
      const red = armorReductionBp(stacks) / 10000;
      return {
        ...NEUTRAL,
        defMult: 1 / (1 - red),
        note: `장갑 ${stacks.toFixed(1)}스택 -> 피해 -${(red * 100).toFixed(1)}% (비율)`,
      };
    }
    case SIG_ARC_OVERCHARGE: {
      const bp = overchargeBp(a.overchargeAvgStillTicks);
      return {
        ...NEUTRAL,
        atkMult: 1 + (bp / 10000) * a.overchargeUptime,
        note: `과충전 +${(bp / 100).toFixed(1)}% x 점유 ${(a.overchargeUptime * 100).toFixed(0)}% (비율)`,
      };
    }
    case SIG_PHANTOM_CLOAK: {
      const cycleSec = (CLOAK_UNHIT_TICKS + CLOAK_HOLD_TICKS) / TICK_RATE;
      const shotsPerCycle = Math.max(1e-9, shotsPerSec * cycleSec);
      // 공격: 사이클당 정확히 1발이 CLOAK_BREAK_BP(2.5배) 를 받는다. 주기 정규화(발산 없음).
      const atkMult = 1 + ((CLOAK_BREAK_BP / 10000 - 1) / shotsPerCycle) * a.cloakCycleRate;
      // 방어: 은신 중에는 적이 **발사 자체를 못 한다**(patterns/index.ts:45,109 · boss.ts:128).
      // ⚠️ 접촉 피해는 막히지 않으므로 이 배율은 **원거리분에만 유효한 상한**이다.
      const uptime = (CLOAK_HOLD_TICKS / (CLOAK_UNHIT_TICKS + CLOAK_HOLD_TICKS)) * a.cloakCycleRate;
      return {
        ...NEUTRAL,
        atkMult,
        defMult: 1 / (1 - uptime),
        note: `은신 점유 ${(uptime * 100).toFixed(1)}%(원거리만) + 해제타 2.5x (비율)`,
      };
    }
    case SIG_HATCHLING_BROOD: {
      // 부화체 DPS 는 **장비와 무관한 60 고정**이다 → 가산. 저레벨에 크고 만렙에 희석된다.
      const threshold = hatchThreshold(a.cumulativeKills);
      const avgAlive = Math.min(
        BROOD_MAX_DRONES,
        (a.killsPerSec / threshold) * BROOD_DRONE_LIFE_SEC,
      );
      const addDps = avgAlive * BROOD_DRONE_DPS;
      return {
        ...NEUTRAL,
        atkFlat: addDps,
        note: `부화 ${avgAlive.toFixed(2)}기 x ${BROOD_DRONE_DPS}DPS = +${addDps.toFixed(0)} DPS (가산)`,
      };
    }
    case SIG_MALLOW_CUSHION: {
      // 피해의 35% 를 지연하고, 그중 60% 를 무피격 3초로 회복한다 → 순수 비율.
      const red = (CUSHION_DEFER_BP / 10000) * (CUSHION_RECOVER_BP / 10000) * a.cushionRecoverRate;
      return {
        ...NEUTRAL,
        defMult: 1 / (1 - red),
        note: `완충 지연35% x 회복60% x 성공 ${(a.cushionRecoverRate * 100).toFixed(0)}% = -${(red * 100).toFixed(1)}% (비율)`,
      };
    }
    case SIG_BUBBLE_FILM: {
      // 막 흡수는 **플랫**이다(60 / 7초) → 노출 시간만큼 쌓아 실효체력에 가산한다.
      //
      // ⚠️ 이 시그니처에는 **불사 임계**가 있다. EHP 를 "죽기까지 넣어야 하는 피해" 로 풀면
      //     EHP = hp + (EHP / 받는DPS / 주기초) x 흡수량  =>  EHP = hp / (1 - 상쇄DPS/받는DPS)
      // 라 받는 피해가 {@link filmDenyDps}(= 60/7초 = 8.57) **미만이면 분모가 0 이하**가 되어
      // 버블은 문자 그대로 죽지 않는다. 초판이 이 자리에서 발산했고 클램프가 그것을 가렸다 —
      // 발산은 버그가 아니라 **관측**이었다.
      //
      // 여기서는 발산하지 않는 가산 형식(노출 시간 동안 흡수하는 총량)을 쓰되, 임계를 설명에
      // 남긴다. 임계 위/아래 어느 쪽인지는 사람 플레이가 「초당 피격량」을 재 오면 확정된다.
      const films = a.runSeconds / (FILM_PERIOD_TICKS / TICK_RATE);
      const absorbed = films * FILM_ABSORB_FLAT;
      return {
        ...NEUTRAL,
        defFlat: absorbed,
        note:
          `막 ${films.toFixed(1)}장 x ${FILM_ABSORB_FLAT} = +${absorbed.toFixed(0)} EHP (가산, ${a.runSeconds}초) ` +
          `** 피격 ${filmDenyDps().toFixed(2)} DPS 미만이면 불사 **`,
      };
    }
    default:
      return { ...NEUTRAL, note: '시그니처 없음' };
  }
}

// ---------------------------------------------------------------------------
// 표 생성
// ---------------------------------------------------------------------------

/**
 * 표준 장비 조립에 쓰는 고정 시드. **정본은 `standardBuild.ts` 의 {@link STANDARD_BUILD_SEED}**
 * 이고 여기서는 재수출만 한다 — 하네스 치트 패널이 같은 값을 써야 "사람이 앉은 빌드 = 표가
 * 잰 빌드" 가 성립한다(그 사유는 정본 선언의 주석에 있다).
 */
export const NOMINAL_GEAR_SEED = STANDARD_BUILD_SEED;

/** 한 기체·한 레벨의 명목 파워와 그 시그니처 설명. */
export interface NominalResult {
  row: NominalRow;
  sig: SigEffect;
}

/**
 * 명목표를 어느 장비 위에서 뽑을 것인가.
 *
 * ## ⚠️ 기체 균형 판정(기준 2)의 정본은 `none` 이다 — 사용자 결정(2026-08-08)
 *
 * 장비를 입히면 기체 간 차이가 **왜곡된다.** 장비의 피해는 배율(`damageMult`)이라 `baseBp` 의
 * 공격 차이를 **증폭**하고, 장비의 HP 는 `BASE_HP_REF` 기준 플랫이라 `baseBp` 의 HP 차이를
 * **희석**한다. 즉 같은 섀시라도 어느 장비를 입느냐로 판정이 갈린다.
 *
 * 게다가 이 게임은 신규 조종사에게 **스타터 킷 8칸**을 준다(`src/items/starterKit.ts`).
 * 그 킷은 "초반을 쉽게" 라는 별개 목적으로 조정될 값이므로, 기체 균형 판정이 그것에
 * 매달려 있으면 **스타터 킷을 만질 때마다 기체 밸런스 결론이 흔들린다.** 두 축을 분리한다.
 *
 * `none` 으로 재면 남는 것은 `baseBp` 4축 + 시그니처뿐이고, 그것이 정확히 "섀시가 서로
 * 얼마나 다른가"다. 부수 효과로 **레벨 의존이 사라진다**(ADR-0049 이후 스킬은 파생 스탯이
 * 아니라 sim 안의 규칙이라 `computeLoadoutStats` 에 안 들어간다).
 *
 * 나머지 둘은 참고용이다 — `starter` 는 실제 신규 플레이어 상태, `standard` 는 그 레벨의
 * 표준 진행 상태를 본다.
 */
export type GearMode = 'none' | 'starter' | 'standard';

/** 지정한 모드의 장착 목록을 낸다. */
export function gearFor(mode: GearMode, level: number, planet: number): readonly Item[] {
  switch (mode) {
    case 'none':
      return [];
    case 'starter':
      return Object.values(starterEquipped()).filter((it): it is Item => it !== undefined);
    case 'standard':
      return standardGearSet(level, NOMINAL_GEAR_SEED, planet);
  }
}

/** 한 기체·한 레벨을 계산한다. `mode` 기본값은 기체 균형 판정의 정본인 `none` 이다. */
export function nominalFor(
  typeId: number,
  level: number,
  a: NominalAssumptions = DEFAULT_ASSUMPTIONS,
  planet = 0,
  mode: GearMode = 'none',
): NominalResult {
  const def = SHIP_TYPES[typeId];
  if (def === undefined) throw new Error(`unknown typeId ${typeId}`);
  const equipped = gearFor(mode, level, planet);
  const raw = rawStats(equipped, typeId);
  const shotsPerSec = TICK_RATE / raw.fireCdTicks;
  const baseDps = raw.damage * raw.bulletCount * shotsPerSec;
  const sig = sigEffect(def.signatureBit, a, shotsPerSec);
  // 순서 계약: **가산 먼저, 곱셈 나중.** 한 기체가 둘 다 갖는 경우는 지금 없지만(시그니처마다
  // 한 성질만 쓴다), 순서를 못 박아 두지 않으면 나중에 겹칠 때 조용히 갈린다.
  const dps = (baseDps + sig.atkFlat) * sig.atkMult;
  const ehp = (raw.hp + sig.defFlat) * sig.defMult;
  return {
    row: {
      typeId,
      slug: def.slug,
      level,
      damage: raw.damage,
      fireCdTicks: raw.fireCdTicks,
      bulletCount: raw.bulletCount,
      baseDps,
      sigAtk: baseDps > 0 ? dps / baseDps : 1,
      dps,
      hp: raw.hp,
      sigDef: raw.hp > 0 ? ehp / raw.hp : 1,
      ehp,
      power: dps * ehp,
    },
    sig,
  };
}

/** 전 기체를 한 레벨에서 계산한다(타입 id 오름차순). */
export function nominalTable(
  level: number,
  a: NominalAssumptions = DEFAULT_ASSUMPTIONS,
  planet = 0,
  mode: GearMode = 'none',
): NominalResult[] {
  return SHIP_TYPES.map((_, typeId) => nominalFor(typeId, level, a, planet, mode));
}

/** 합격 규칙: 곱 최대/최소 비. 밴드 상한은 CLI 가 판정한다. */
export function powerSpread(rows: readonly NominalRow[]): number {
  const powers = rows.map((r) => r.power).filter((p) => p > 0);
  if (powers.length === 0) return Number.NaN;
  return Math.max(...powers) / Math.min(...powers);
}

/** 기준점(스트라이커, typeId 0) 대비 상대 파워. 사람 플레이가 찍은 절대 원점에 걸 값이다. */
export function relativeToStriker(rows: readonly NominalRow[]): Map<number, number> {
  const anchor = rows.find((r) => r.typeId === 0);
  const base = anchor === undefined || anchor.power === 0 ? Number.NaN : anchor.power;
  return new Map(rows.map((r) => [r.typeId, r.power / base]));
}
