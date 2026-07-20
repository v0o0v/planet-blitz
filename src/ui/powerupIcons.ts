/**
 * 파워업 → 아이콘 키 매핑 (ADR-0015 · 아이콘 생성 0장 전략).
 *
 * 파워업 24종은 전용 아이콘을 만들지 않는다. 이미 만드는 두 세트를 합성해 표현한다:
 *  - 바탕 = 파워업이 올려주는 스탯의 스킬 아이콘(`skill_<stat>_<band>`)
 *  - `PowerupDef.weaponType` 이 있는 것만 그 위에 장비 무기 아이콘(`equip_main_<weapon>`)을
 *    작은 배지로 겹친다 — "초크 개조 = 스프레드 데미지 / 과충전 코일 = 레일건 데미지"처럼
 *    같은 스탯을 다른 무기가 올리는 경우를 구별하기 위함.
 *
 * **티어대(low/mid/high)가 세 번째 축이다.** 스탯 + 무기 배지 둘만으로는 24종이 17종으로
 * 접혔다 — 배지를 붙일 무기 축이 없는 파워업끼리 겹쳐 충돌 7건(최대 HP 3종, 데미지·연사·
 * 이속·대시·자석 각 2종)이 남았고, 3택 오버레이는 즉시 판단해야 하는 모달이라 같은 그림
 * 두 장이 나란히 뜨면 읽기가 느려진다. 스킬 세트는 어차피 스탯마다 티어대별 아트를 만들고
 * 있으므로, **같은 스탯의 파워업을 수치 크기 순으로 그 티어대에 나눠 배정**하면 추가 생성
 * 0장을 유지한 채 충돌이 사라진다.
 *
 * 배정 규칙(아래 표는 이 규칙을 손으로 푼 결과다):
 *  1. 같은 스탯을 올리는 파워업을 `PowerupDef.apply` 의 실제 수치로 오름차순 정렬한다.
 *  2. 그 스탯에 **존재하는** 밴드에만 `floor(rank * bandCount / n)` 으로 나눠 담는다.
 *     밴드가 다 있는 것은 아니다 — `bullet_count` 는 저 밴드가 없고(mid/high),
 *     `bullet_speed_pct` 는 고가 없으며, `range_flat` 은 저 하나뿐이다. 없는 밴드를
 *     가리키면 텍스처가 없어 아이콘이 조용히 사라진다.
 *  3. 수치가 같으면(탄환 +1 셋) 같은 밴드에 둔다 — 이들은 배지로 갈린다.
 *
 * 결과는 24종 전부가 서로 다른 조합이다(충돌 0). 매핑의 진실의 원천은 이 파일이다 —
 * `.omc/plans/icon-manifest.json` 의 `_meta.powerupStatMapping` 은 초안이고,
 * 런타임이 읽는 표는 여기뿐이다.
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
 * 파워업 id → 아이콘 키. 주석의 수치가 밴드 배정 근거다(같은 스탯 안에서의 크기 순).
 */
const POWERUP_ICONS: Readonly<Record<string, PowerupIconKeys>> = {
  // 데미지 6종: fp-focus 20% < spread-choke 22% < beam 28% < missile 30% < heavy 35% < rail 45%.
  'fp-focus': { statKey: 'skill_damage_pct_low' },
  'spread-choke': { statKey: 'skill_damage_pct_low', badgeKey: 'equip_main_spread' },
  'beam-intensifier': { statKey: 'skill_damage_pct_mid', badgeKey: 'equip_main_beam' },
  'missile-warhead': { statKey: 'skill_damage_pct_mid', badgeKey: 'equip_main_missile' },
  'heavy-rounds': { statKey: 'skill_damage_pct_high' },
  'rail-overcharge': { statKey: 'skill_damage_pct_high', badgeKey: 'equip_main_railgun' },

  // 연사 2종: fp-cadence -15% < rapid-fire -18%.
  'fp-cadence': { statKey: 'skill_fire_rate_pct_low' },
  'rapid-fire': { statKey: 'skill_fire_rate_pct_mid' },

  // 탄환 수 3종: 전부 +1 로 수치가 같아 같은 밴드(저 밴드 자체가 없다). 배지로 갈린다.
  'twin-shot': { statKey: 'skill_bullet_count_mid' },
  'spread-pellets': { statKey: 'skill_bullet_count_mid', badgeKey: 'equip_main_spread' },
  'missile-salvo': { statKey: 'skill_bullet_count_mid', badgeKey: 'equip_main_missile' },

  // 관통 2종: piercing-rounds +1 < rail-penetrator +2.
  'piercing-rounds': { statKey: 'skill_pierce_low' },
  'rail-penetrator': { statKey: 'skill_pierce_mid', badgeKey: 'equip_main_railgun' },

  // 최대 HP 3종: field-medkit +15 < reinforced-hull +25 < sv-plating +30.
  'field-medkit': { statKey: 'skill_max_hp_flat_low' },
  'reinforced-hull': { statKey: 'skill_max_hp_flat_mid' },
  'sv-plating': { statKey: 'skill_max_hp_flat_high' },

  // 이동 속도 2종: mb-overdrive +10% < thrusters +12%.
  'mb-overdrive': { statKey: 'skill_move_speed_pct_low' },
  thrusters: { statKey: 'skill_move_speed_pct_mid' },

  // 대시 재충전 2종: sv-evasion -15% < dash-coils -20%.
  'sv-evasion': { statKey: 'skill_dash_cd_pct_low' },
  'dash-coils': { statKey: 'skill_dash_cd_pct_mid' },

  // 자석 2종: mb-collector +30% < gem-magnet +40%.
  'mb-collector': { statKey: 'skill_magnet_pct_low' },
  'gem-magnet': { statKey: 'skill_magnet_pct_mid' },

  // 단독 스탯 2종 — 비교 대상이 없어 최저 밴드.
  'muzzle-velocity': { statKey: 'skill_bullet_speed_pct_low' },
  'beam-focuser': { statKey: 'skill_range_flat_low', badgeKey: 'equip_main_beam' },
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
