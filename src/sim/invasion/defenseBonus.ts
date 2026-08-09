/**
 * 방어측 계보 보너스를 **기지 전체**에 거는 공용 산식 (2026-08-10 밀도·난이도 레인).
 *
 * ## 왜 생겼나 — 비대칭 하나를 닫는 장치다
 * 침공은 공격측 조종사 레벨 성장(최대 ×4.69)을 **강제로 1로 눌러** 왔다
 * (`src/run/runConfig.ts`). 그 주석이 이유와 해제 조건을 같이 적어 뒀다:
 *
 * > 방어측 수호는 레벨을 안 넘기고 넘길 수도 없다 → 공격측만 ×4.69 를 받는 비대칭 주입이 된다.
 * > ⭐ 여는 조건은 「침공에도 레벨을 넘기는 것」이 아니라 **방어측에 대응 축이 생기는 것**이다.
 *
 * 이 파일이 그 대응 축이다. 축 자체는 새로 만들지 않았다 — **이미 있는 계보 수호 가지**
 * (`data/lineage.ts` `guardianBonusBp`)를 쓴다. 구 구현의 문제는 곱선이 아니라 **적용 범위**
 * 였다: 수호 슬롯 2칸에만 걸려서, 수호기를 안 놓은 기지(= 기본 수비대만 있는 상태)에서는
 * 계보 레벨이 아무리 높아도 효과가 **정확히 0** 이었다. 기준선이 바로 그 상태라 축이 죽어 있던
 * 셈이다. 그래서 편대·설비·보스·기물까지 범위를 넓힌다.
 *
 * ## 무엇에 거는가
 * **내구도와 피해 두 축**이다 — 공격측 `applyPilotLevelScaling` 이 damage·maxHp 두 축에
 * 거는 것과 대칭을 맞췄다. 발사 간격·이동 속도·사거리 같은 기하/시간 축에는 걸지 않는다
 * (그쪽은 정비도와 어픽스의 담당이고, 겹치면 두 축이 서로를 가린다).
 *
 * ## 결정론
 * basis-point 정수 in / 정수 out 이고 반올림은 **한 번**이다(`Math.round(v * (10000+bp) / 10000)`).
 * bp 가 0 이면 **무연산으로 즉시 반환**한다 — 곱을 한 번도 안 돌아야 계보 0 인 기존 런이
 * 바이트 동일하다. `pilotLevelMult` 의 `level <= 1 → return 1` 과 같은 규율이다.
 */

/**
 * 방어측 강화 배율 — **내구도와 피해를 따로 잡는다**(2026-08-10, 사용자 제기
 * "계보bp를 100000 으로 했더니 적의 hp가 적당한데 대신 공격력이 너무 쎄다").
 *
 * ## 왜 갈랐나
 * 처음에는 축이 하나(`defenseBonusBp`)라 내구도와 피해가 **한 덩어리**로 움직였다. 그런데
 * 침공에서 필요한 배수가 두 축에서 전혀 다르다: 만렙 기체(피해 ×4.69) 앞에서 적이 버티려면
 * 내구도는 ×10 대역이 필요한데, 같은 배수를 피해에 걸면 한 대에 죽는다.
 *
 * 이 분리는 **행성런이 이미 하고 있는 것**이기도 하다 — `data/waves.ts` 의 `stageHpMult`
 * (앵커 1/16/88)는 HP 만 올리고, 적 피해는 `ENEMY_DAMAGE_STAGE_*` 라는 **별개 곡선**이다
 * (얕은 단계에 peak, 깊어지면 1 로 물러난다). 침공만 두 축을 묶고 있던 것이 예외였다.
 *
 * ⚠️ 침공이 `stageHpMult` 를 못 쓰는 이유는 **단계가 1 고정**이라서다(`config.stage` 는 메타
 * XP 배율·저단계 감쇠에도 쓰여서 침공에서 올릴 수 없다). 그래서 같은 모양의 축을 여기 둔다.
 */
export interface DefensePower {
  /** 내구도 배율(basis-point). 0 = 무연산. */
  readonly hpBp: number;
  /** 피해 배율(basis-point). 0 = 무연산. */
  readonly damageBp: number;
  /**
   * **코어 전용 추가 내구도 배율**(basis-point). `hpBp` 위에 한 번 더 곱한다. 0 = 무연산.
   *
   * ## 왜 코어만 따로인가 (2026-08-10 실측)
   * 코어는 5분 원정의 마지막 관문인데, 만렙 장비 기준 실측 **DPS 약 19,000** 에 코어 실효
   * 내구도가 64,000 이라 **3초 만에 부서졌다**(사용자 제기 "코어의 hp도 너무 낮다").
   * 잡몹과 같은 배수로는 못 맞춘다 — 잡몹은 그 배수에서 이미 적당했다.
   *
   * ⚠️ 기지 데이터의 `l3.core.hp` 를 올리는 방법도 있었지만 **시드 기지가 8000 을 하드코딩**한다
   * (`src/bench/invasionBands.ts` `seedBaseLayers` + 램프 SQL). 기본 상수만 올리면 NPC 기지만
   * 옛 값에 남아 갈린다. 배율은 스폰 시점에 걸리므로 모든 기지에 균일하다.
   */
  readonly coreHpBp: number;
}

/** 두 축 모두 무연산. 미지정 침공 config 와 구 거동이 여기로 떨어진다. */
export const NEUTRAL_DEFENSE_POWER: DefensePower = { hpBp: 0, damageBp: 0, coreHpBp: 0 };

/** 손상 입력 방어 — 비유한·음수는 0 으로 접는다. */
export function normalizeDefensePower(
  hpBp?: number,
  damageBp?: number,
  coreHpBp?: number,
): DefensePower {
  const fold = (v: number | undefined): number =>
    v === undefined || !Number.isFinite(v) || v <= 0 ? 0 : Math.trunc(v);
  return { hpBp: fold(hpBp), damageBp: fold(damageBp), coreHpBp: fold(coreHpBp) };
}

/** 계보 보너스 basis-point 상한. 곱선 자체의 점근값은 `data/lineage.ts` 가 정한다. */
export const DEFENSE_BONUS_BP_MAX = 1000000;

/**
 * basis-point 보너스를 정수 스탯에 건다. `bp = 0` → 입력 그대로(무연산).
 *
 * 반올림이 한 번뿐이라 호출 순서가 값을 바꾸지 않는다 — 강화 3축·어픽스와 어느 순서로 접든
 * 같은 결과가 나오도록 **곱셈 축**으로만 설계했다(가산 축이면 순서가 값을 바꾼다).
 */
export function applyDefenseBonus(value: number, bp: number): number {
  if (bp <= 0 || !Number.isFinite(bp)) return value;
  const b = bp > DEFENSE_BONUS_BP_MAX ? DEFENSE_BONUS_BP_MAX : Math.trunc(bp);
  return Math.round((value * (10000 + b)) / 10000);
}
