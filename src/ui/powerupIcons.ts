/**
 * 파워업 → 아이콘 키 매핑 (ADR-0015 · 아이콘 생성 0장 전략).
 *
 * 파워업 24종은 전용 아이콘을 만들지 않는다. 이미 만드는 두 세트를 합성해 표현한다:
 *  - 바탕 = 파워업이 올려주는 스탯의 스킬 아이콘(`skill_<stat>_<band>`)
 *  - `PowerupDef.weaponType` 이 있는 것만 그 위에 장비 무기 아이콘(`equip_main_<weapon>`)을
 *    작은 배지로 겹친다 — "초크 개조 = 스프레드 데미지 / 과충전 코일 = 레일건 데미지"처럼
 *    같은 스탯을 다른 무기가 올리는 경우를 구별하기 위함.
 *
 * 표는 `.omc/plans/icon-manifest.json` 의 `_meta.powerupStatMapping` 을 그대로 옮긴 것이다
 * (플랜 파일은 런타임 자산이 아니라 빌드에 포함하지 않는다). 파워업 id 기준이라
 * 풀 인덱스(리플레이 wire 값)와 독립적이다.
 *
 * 순수 데이터/함수다 — DOM·Pixi 를 참조하지 않는다. sim 도 이 파일을 참조하지 않는다(ADR-0005).
 */

import { POWERUPS } from '../sim/powerups.js';

/** 한 파워업이 쓰는 아이콘 키 조합. */
export interface PowerupIconKeys {
  /** 바탕 스킬 스탯 아이콘 키(assets/<key>.png). */
  readonly statKey: string;
  /** 무기 배지 키(주무기 파생 파워업만). 없으면 undefined. */
  readonly badgeKey?: string;
}

/**
 * 파워업 id → 아이콘 키. band(low/mid/high)는 매핑이 정한 값을 그대로 쓴다:
 * 무기 파생(8..15)은 mid, 그 외는 해당 스탯 세트에 존재하는 최저 band.
 */
const POWERUP_ICONS: Readonly<Record<string, PowerupIconKeys>> = {
  'rapid-fire': { statKey: 'skill_fire_rate_pct_low' },
  'twin-shot': { statKey: 'skill_bullet_count_mid' },
  'heavy-rounds': { statKey: 'skill_damage_pct_low' },
  'piercing-rounds': { statKey: 'skill_pierce_low' },
  thrusters: { statKey: 'skill_move_speed_pct_low' },
  'dash-coils': { statKey: 'skill_dash_cd_pct_low' },
  'reinforced-hull': { statKey: 'skill_max_hp_flat_low' },
  'gem-magnet': { statKey: 'skill_magnet_pct_low' },
  'spread-pellets': { statKey: 'skill_bullet_count_mid', badgeKey: 'equip_main_spread' },
  'spread-choke': { statKey: 'skill_damage_pct_mid', badgeKey: 'equip_main_spread' },
  'rail-penetrator': { statKey: 'skill_pierce_mid', badgeKey: 'equip_main_railgun' },
  'rail-overcharge': { statKey: 'skill_damage_pct_mid', badgeKey: 'equip_main_railgun' },
  'missile-salvo': { statKey: 'skill_bullet_count_mid', badgeKey: 'equip_main_missile' },
  'missile-warhead': { statKey: 'skill_damage_pct_mid', badgeKey: 'equip_main_missile' },
  'beam-intensifier': { statKey: 'skill_damage_pct_mid', badgeKey: 'equip_main_beam' },
  'beam-focuser': { statKey: 'skill_range_flat_low', badgeKey: 'equip_main_beam' },
  'fp-focus': { statKey: 'skill_damage_pct_low' },
  'fp-cadence': { statKey: 'skill_fire_rate_pct_low' },
  'sv-plating': { statKey: 'skill_max_hp_flat_low' },
  'sv-evasion': { statKey: 'skill_dash_cd_pct_low' },
  'mb-overdrive': { statKey: 'skill_move_speed_pct_low' },
  'mb-collector': { statKey: 'skill_magnet_pct_low' },
  'muzzle-velocity': { statKey: 'skill_bullet_speed_pct_low' },
  'field-medkit': { statKey: 'skill_max_hp_flat_low' },
};

/** 파워업 id 로 아이콘 키를 얻는다(미등록이면 undefined → 텍스트 폴백). */
export function powerupIconKeysById(id: string): PowerupIconKeys | undefined {
  return POWERUP_ICONS[id];
}

/** 파워업 풀 인덱스로 아이콘 키를 얻는다(범위 밖/미등록이면 undefined). */
export function powerupIconKeys(poolIndex: number): PowerupIconKeys | undefined {
  const def = POWERUPS[poolIndex];
  if (def === undefined) return undefined;
  return POWERUP_ICONS[def.id];
}

/** 테스트/검증용 — 등록된 전체 매핑(읽기 전용). */
export function allPowerupIconKeys(): Readonly<Record<string, PowerupIconKeys>> {
  return POWERUP_ICONS;
}
