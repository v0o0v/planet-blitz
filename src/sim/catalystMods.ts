/**
 * 촉매 배율 번들 — 런 1회 소모 촉매(ADR-0029)가 sim 노브에 미치는 배율을 **한 번** 해석해
 * 담는다. `createWorld` 가 `config.catalysts` 로부터 이걸 만들어 `state.catalystMods` 에 싣고,
 * 적 스폰·드랍·자원·경험치 등 각 적용점이 여기서 곱할 배율을 읽는다.
 *
 * ## 왜 번들인가
 * 배율 함수(`catalystPenaltyMult`·`catalystRewardMult`)는 순수하지만 촉매 배열(최대 SLOT_CAP)을
 * 매 호출 순회한다. 적 스폰·드랍 같은 hot path 에서 매번 재계산하는 대신 런 시작에 한 번 접어
 * 둔다. 그리고 적용점이 여러 곳으로 흩어져도 **여기 필드 하나가 그 축의 단일 정본**이라, 이
 * 저장소가 8번 겪은 "배선 누락"(어떤 적용점만 촉매를 곱하고 나머지는 잊는) 결함을 구조적으로
 * 줄인다.
 *
 * ## 결정론 & 해시
 * 이 번들은 `config.catalysts`(정규화 전 배열)의 **순수 파생값**이다. `config.catalysts` 자체는
 * `hashWorld` 꼬리에서 정규화 후 접히므로(replay.ts), 이 파생 배율은 해시에 **따로 접지 않는다**
 * (`sigBit`·`grid` 와 같은 파생/스크래치 규율). 두 런의 per-tick 해시가 매 틱 같으면 촉매 배열도
 * 같으므로(접힘) 배율 번들도 동일하다 — 숨은 발산 없음.
 *
 * ## 방향(부호) 규약 — Lane 0 계약과 정합
 *  - 페널티 6축: 배율 ≥ 1, **클수록 난이도 상승**. `enemyHp`·`enemySpeed`·`enemyDamage`·
 *    `enemyCount`·`enemyBulletSpeed` 는 대응 노브에 **곱**한다. `playerHpDown` 은 최대 HP 를
 *    **나누는**(하향) 방향으로 소비한다(createWorld 에서 부호 처리).
 *  - 보상 4축(sim 내부): 배율 ≥ 1, 클수록 더 많이/좋게. `drop`·`rarity`·`xp`·`resource`.
 *    (`catalystDrop` 은 sim 드랍 경로가 아직 없어 여기 없다 — 서버 원장/드랍 지급은 Lane 3.
 *     `power` 5스탯은 createWorld 에서 직접 `catalystPowerMult` 로 스탯에 곱한다 — 여기 아님.)
 */

import { catalystPenaltyMult, catalystRewardMult } from '../data/catalysts.js';

/** 촉매가 sim 노브에 미치는 배율 번들(런 시작에 1회 해석). */
export interface CatalystMods {
  // --- 페널티 6축(≥1, 클수록 난이도↑) ---
  /** 적 HP 배율(스폰 HP 에 곱). */
  readonly enemyHp: number;
  /** 적 이동 속도 배율(속도에 곱). */
  readonly enemySpeed: number;
  /** 적 접촉 피해 배율(스폰 `e.damage` 에 곱). */
  readonly enemyDamage: number;
  /** 동시 등장 적 상한 배율(maxEnemies 에 곱). */
  readonly enemyCount: number;
  /** 적탄 이동 속도 배율(적탄 배속에 곱). */
  readonly enemyBulletSpeed: number;
  /** 플레이어 최대 HP **하향** 강도(≥1). createWorld 가 최대 HP 를 이 값으로 나눈다. */
  readonly playerHpDown: number;
  // --- 보상 4축(≥1, 클수록 많이/좋게) ---
  /** 드랍량 배율(엘리트·보스 추가 루팅 파생). */
  readonly drop: number;
  /** 희귀도 배율(드랍 롤 rare/unique 확률에 곱). */
  readonly rarity: number;
  /** 경험치 배율(젬 획득 XP 에 곱). */
  readonly xp: number;
  /** 자원 배율(보급 습격 크레딧 적립에 소수 누적으로 반영). */
  readonly resource: number;
}

/** 촉매 무주입(빈 배열/미지정) 런의 중립 번들 — 전 축 1(무연산). */
export const NEUTRAL_CATALYST_MODS: CatalystMods = {
  enemyHp: 1,
  enemySpeed: 1,
  enemyDamage: 1,
  enemyCount: 1,
  enemyBulletSpeed: 1,
  playerHpDown: 1,
  drop: 1,
  rarity: 1,
  xp: 1,
  resource: 1,
};

/**
 * `config.catalysts` 로부터 배율 번들을 해석한다. 미지정/빈 배열이면 중립 번들을 그대로
 * 돌려준다(새 객체를 만들지 않아, 무촉매 런이 기존 경로와 산술적으로 바이트 동일하다).
 */
export function resolveCatalystMods(catalysts: readonly number[] | undefined): CatalystMods {
  if (catalysts === undefined || catalysts.length === 0) return NEUTRAL_CATALYST_MODS;
  return {
    enemyHp: catalystPenaltyMult(catalysts, 'enemyHp'),
    enemySpeed: catalystPenaltyMult(catalysts, 'enemySpeed'),
    enemyDamage: catalystPenaltyMult(catalysts, 'enemyDamage'),
    enemyCount: catalystPenaltyMult(catalysts, 'enemyCount'),
    enemyBulletSpeed: catalystPenaltyMult(catalysts, 'enemyBulletSpeed'),
    playerHpDown: catalystPenaltyMult(catalysts, 'playerHpDown'),
    drop: catalystRewardMult(catalysts, 'drop'),
    rarity: catalystRewardMult(catalysts, 'rarity'),
    xp: catalystRewardMult(catalysts, 'xp'),
    resource: catalystRewardMult(catalysts, 'resource'),
  };
}
