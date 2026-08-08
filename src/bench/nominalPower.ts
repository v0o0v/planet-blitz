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
  FILM_ABSORB_HP_BP,
  filmCapacityFor,
  BROOD_DAMAGE_BP,
  broodBulletDamage,
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
export const BASE_DAMAGE = 18.24;
/** 무기 기준 발사 간격(틱). `world.ts` `DEFAULT_WEAPON.fireCooldownQ = 6 * FIRE_CD_Q`. */
export const BASE_FIRE_CD_TICKS = 6;
/** 발사 간격 하한(틱). `constants.ts` `FIRE_CD_MIN_Q = 2 * FIRE_CD_Q`. */
export const MIN_FIRE_CD_TICKS = 2;
/** 플레이어 기준 HP. `world.ts` `DEFAULT_CONFIG.playerHp`(= `guardian.ts` `PLAYER_BASE_HP`). */
export const BASE_PLAYER_HP = 151;

/** 병아리 드론 1기의 초당 발사 수 — `events.ts` `TURRET_FIRE_COOLDOWN 10` 기준(60틱 ÷ 10). */
export const BROOD_DRONE_SHOTS_PER_SEC = TICK_RATE / 10;

/**
 * 병아리 드론 1기의 DPS. **플레이어 발당 피해에 비례한다**(2026-08-08 개정 —
 * `shipSignature.ts` 의 `BROOD_DAMAGE_BP` 주석이 사유의 정본). 구값은 `TURRET_BULLET_DAMAGE`
 * 10 고정이라 레벨·장비와 무관한 절대량이었고, 그래서 이 시그니처의 실효 배율이 기준이 바뀔
 * 때마다 통째로 달라졌다.
 */
export function broodDroneDps(playerDamage: number): number {
  return broodBulletDamage(playerDamage) * BROOD_DRONE_SHOTS_PER_SEC;
}
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
   * **선체가 초당 잃는 HP** — 버블 막의 실효 방어 배율을 정하는 유일한 분모다.
   *
   * ## ⚠️ 이 모델에서 유일하게 **실측이 필요한** 가정치다
   * 나머지 가정치는 sim 규칙에서 상한·주기로 유도되지만, 이것은 무대(적 밀도·화력·파일럿
   * 회피)의 산물이라 sim 을 돌려야 나온다. `bench/incomingDps.ts` 가 재고, 기본값
   * {@link MEASURED_INCOMING_DPS} 가 그 실측치다.
   *
   * ## 왜 초판에는 없었는가 — 그리고 왜 돌아왔는가
   * 초판은 이 값을 **가정**으로 두고 플랫 효과를 비율로 환산했고, 그 형식이 발산해 버블이
   * 파워 10배로 튀었다(모듈 헤더 §초판이 여기서 틀렸다). 그래서 플랫을 가산으로 바꾸며 이
   * 가정치를 통째로 지웠다.
   *
   * 지금은 상황이 다르다. 막 내구가 **최대 HP 비율**이 되면서(`FILM_ABSORB_HP_BP`) 상쇄
   * DPS 도 비율이 됐고, 그래서 이 분모는 *"플랫을 비율로 억지로 바꾸는 환산기"* 가 아니라
   * **장갑·완충·은신이 이미 쓰고 있는 것과 같은 형식**(`1/(1−감소율)`)의 정직한 입력이다.
   * 그리고 발산은 클램프로 가리지 않고 **큰 소리로 실패**시킨다({@link sigEffect} 버블 절).
   */
  incomingDps: number;
}

/**
 * 표준 런 par(초). `src/save/progressionPath.ts` 의 `RUN_SECONDS_PAR` 와 같은 눈금이다.
 *
 * ⚠️ 측정 계층이 튜닝 대상에 런타임 의존하지 않도록 재선언한다(`standardBuild.ts` 가
 * `STANDARD_PROGRESSION_PATH` 를 import 하지 않는 것과 같은 사유). 드리프트는
 * `tests/nominalPower.test.ts` 가 대조한다.
 */
export const RUN_SECONDS_PAR = 95;

/**
 * **실측 초당 피격량**(`bench/incomingDps.ts`, 2026-08-08). 스트라이커·행성 0·무장비·시드
 * 6개·5400틱(90초) 창의 시드 중앙값을 세 레벨에서 반올림한 값이다:
 *
 *     Lv5(단계1)   39.80   (35.56 ~ 52.09)
 *     Lv50(단계10)  40.53   (37.47 ~ 46.81)
 *     Lv100(단계20) 39.24   (32.98 ~ 49.07)
 *
 * **판정 기준 모드(무장비)에서 레벨과 무관하게 평평하다** — 그래서 단일 상수로 둘 수 있다.
 * (표준 장비를 입히면 Lv100 에서 봇이 사실상 안 맞아 0 으로 내려간다. 그것은 봇 회피의
 * 산물이지 무대의 성질이 아니므로 이 상수의 근거로 쓰지 않는다 — 무장비 값이 정본이다.)
 *
 * ⚠️ 적 축을 만지면 이 값이 움직인다. 그때는 `bench/incomingDps.ts` 를 다시 돌리고 여기와
 * 위 표를 함께 고쳐라 — 값만 고치고 근거표를 남겨 두면 다음 사람이 재현할 수 없다.
 */
export const MEASURED_INCOMING_DPS = 40;

/** 중립 기본 가정치. 어느 기체에도 유리하게 기울이지 않도록 잡았다. */
export const DEFAULT_ASSUMPTIONS: NominalAssumptions = {
  armorAvgStacks: 4,
  overchargeUptime: 0.25,
  overchargeAvgStillTicks: 120,
  cloakCycleRate: 0.35,
  killsPerSec: 3.0,
  cumulativeKills: 300,
  cushionRecoverRate: 0.4,
  incomingDps: MEASURED_INCOMING_DPS,
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
 *  · **플랫** → 노출 시간만큼 쌓아 **가산**한다. 발산하지 않는다.
 *  · **비율**(장갑 감소·과충전·완충) → **곱셈**한다.
 *
 * ## 그 뒤 — 플랫 두 개를 **sim 쪽에서** 없앴다 (2026-08-08)
 * 위 형식은 계산의 발산을 막았을 뿐, *"이 두 시그니처만 기준이 바뀔 때마다 값이 통째로
 * 달라진다"* 는 성질 자체는 그대로였다(무장비 버블 9.52배 ↔ 표준장비 4.17배). 그래서
 * 2026-08-08 밸런스 패스가 **sim 상수 두 개를 비율로 재설계**했다:
 *  · 버블 막 내구 → 최대 HP 의 25%(`FILM_ABSORB_HP_BP`)
 *  · 부화체 탄 피해 → 플레이어 발당 피해의 20%(`BROOD_DAMAGE_BP`)
 * 그래서 지금 이 레코드의 `atkFlat`·`defFlat` 칸은 **아무도 쓰지 않는다.** 칸을 지우지 않는
 * 것은 형식 계약(플랫은 가산 · 비율은 곱셈)이 앞으로 생길 플랫 효과에도 걸리기 때문이다.
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

/** 막 재생 주기(초). `FILM_PERIOD_TICKS` 를 초로 환산한 값. */
export const FILM_PERIOD_SEC = FILM_PERIOD_TICKS / TICK_RATE;

/**
 * 버블 막이 **무조건 상쇄하는 초당 피해**(= 막 1장의 내구 ÷ 재생 주기).
 *
 * 받는 피해가 이 값 미만이면 막이 소모보다 빨리 재생돼 버블은 **문자 그대로 죽지 않는다**.
 * 구값(내구 60 고정)에서는 이것이 8.57 **절대 상수**였고, 그래서 임계가 성장과 무관하게
 * 고정이었다. 이제 내구가 최대 HP 비율이라 상쇄도 HP 에 비례한다 — 임계가 절대량이 아니라
 * 플레이어 규모에 붙는다.
 *
 * @param maxHp 이 런의 최대 HP. `WorldState.filmCapacity` 와 **같은 함수**로 내구를 낸다.
 */
export function filmDenyDps(maxHp: number): number {
  return filmCapacityFor(maxHp) / FILM_PERIOD_SEC;
}

/**
 * 시그니처 비트 하나를 기대값 효과로 환산한다.
 *
 * `shotsPerSec` 를 받는 이유: 은신 해제 첫 타(2.5배 **1발**)는 주기당 1회라 초당 발사 수로
 * 나눠야 배율이 된다. 이것은 플랫→비율 환산이 아니라 **주기 정규화**이므로 발산하지 않는다.
 *
 * `raw` 를 받는 이유: 비율화된 두 시그니처(버블 막 = 최대 HP 비율 · 부화체 탄 = 발당 피해
 * 비율)는 **자기 배율을 내려면 그 기준값이 필요하다.** sim 이 실제로 그 두 값에서 파생하므로
 * (`WorldState.filmCapacity` ← `config.playerHp`, `broodBulletDamage` ← `state.weapon.damage`)
 * 모델도 같은 입력을 받아야 두 축이 갈리지 않는다.
 */
export function sigEffect(
  bit: number,
  a: NominalAssumptions,
  shotsPerSec: number,
  raw: { damage: number; hp: number },
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
      // 부화체 화력은 이제 **플레이어 발당 피해의 20%**(`BROOD_DAMAGE_BP`)라 장비·레벨과 함께
      // 자란다 → 순수 비율. 구값(60 DPS 고정)이 저레벨에 크고 만렙에 희석되던 축이 사라졌다.
      const threshold = hatchThreshold(a.cumulativeKills);
      const avgAlive = Math.min(
        BROOD_MAX_DRONES,
        (a.killsPerSec / threshold) * BROOD_DRONE_LIFE_SEC,
      );
      const droneDps = broodDroneDps(raw.damage);
      const addDps = avgAlive * droneDps;
      // 플레이어 초당공격력 대비 비로 환산한다 — `baseDps` 를 여기서 다시 계산하지 않고
      // 호출부가 넘긴 원시 스탯으로 낸다(볼리당 탄 수는 호출부만 안다 → 아래 주의).
      const playerDps = raw.damage * shotsPerSec;
      const atkMult = playerDps > 0 ? 1 + addDps / playerDps : 1;
      return {
        ...NEUTRAL,
        atkMult,
        note:
          `부화 ${avgAlive.toFixed(2)}기 x ${droneDps.toFixed(1)}DPS(발당 ${BROOD_DAMAGE_BP / 100}%) ` +
          `= +${addDps.toFixed(1)} DPS (비율)`,
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
      // 막 내구가 **최대 HP 의 25%**(`FILM_ABSORB_HP_BP`)가 되면서, 상쇄 DPS 도 HP 에 비례하는
      // 값이 됐다. 그래서 EHP 를 "죽기까지 넣어야 하는 피해" 로 정직하게 풀 수 있다:
      //
      //     EHP = hp + (EHP / 받는DPS / 주기초) x 내구  =>  EHP = hp / (1 - 상쇄DPS/받는DPS)
      //
      // 이것은 장갑·완충·은신이 이미 쓰는 것과 **같은 형식**이라, 노출 창(구 `runSeconds`)이라는
      // 임의의 눈금이 필요 없다. 구 가산 형식은 발산은 막았지만 *"버블만 런 길이에 비례해
      // 커진다"* 는 다른 왜곡을 남기고 있었다(나머지 여섯은 전부 한 목숨분 비율이었다).
      //
      // ## ⚠️ 발산은 클램프하지 않고 **큰 소리로 실패**시킨다
      // 상쇄 DPS 가 받는 피해 이상이면 버블은 문자 그대로 죽지 않는다. 그 상태는 밸런스가
      // 아니라 **설계 결함**이므로 표에 1.00 이나 클램프된 수를 찍어 가리면 안 된다 —
      // 초판이 정확히 그렇게 해서 10배 발산을 0.9 클램프가 삼켰다.
      const deny = filmDenyDps(raw.hp);
      if (!(a.incomingDps > deny)) {
        throw new Error(
          `nominalPower: 버블 막 상쇄 ${deny.toFixed(2)} DPS 가 받는 피해 ` +
            `${a.incomingDps.toFixed(2)} DPS 이상이다 — 이 조건에서 버블은 불사이고 명목 파워가 ` +
            '정의되지 않는다. FILM_ABSORB_HP_BP 를 낮추거나 incomingDps 실측을 갱신하라 ' +
            '(bench/incomingDps.ts).',
        );
      }
      const frac = deny / a.incomingDps;
      return {
        ...NEUTRAL,
        defMult: 1 / (1 - frac),
        note:
          `막 내구 ${filmCapacityFor(raw.hp)}(HP의 ${FILM_ABSORB_HP_BP / 100}%) / ${FILM_PERIOD_SEC.toFixed(0)}초 ` +
          `= ${deny.toFixed(2)} DPS 상쇄 ÷ 피격 ${a.incomingDps.toFixed(1)} DPS -> -${(frac * 100).toFixed(1)}% (비율)`,
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
  const sig = sigEffect(def.signatureBit, a, shotsPerSec, { damage: raw.damage, hp: raw.hp });
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
