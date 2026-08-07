/**
 * 카툰 UI 킷 텍스처 로더 (격납고 파일럿, plan §3).
 *
 * `src/render/textures.ts` 의 glob + Assets.load + nearest scaleMode 패턴을 그대로
 * 따른다. 존재하는 `assets/ui_*.png`(+ ship_showcase)만 URL 로 잡히고, 없거나 로드
 * 실패한 슬롯은 `null` 이라 소비 측(nineSlicePanel/PixiButton/SlotGrid)이 Graphics
 * 폴백으로 우아하게 대체한다 — 자산 하나가 빠져도 화면은 죽지 않는다.
 *
 * 순수 render/UI 레이어다. sim 은 이 파일을 절대 참조하지 않는다(ADR-0005).
 */

import { Assets, type Texture } from 'pixi.js';
import { stickerByIndex } from '../../../data/stickers.js';
import { PLANETS as PLANET_CONTENT } from '../../../data/planets/index.js';
import { ENEMY_ASSET_FILES, BOSS_ASSET_FILES } from '../../render/textures.js';
import { CATALYST_ICON_NAMES } from '../../data/catalysts.js';
import { SHIP_TYPES, DEFAULT_SHIP_TYPE, shipTypeDef } from '../../../data/ships/index.js';
import { ACTIVES_BY_SHIP } from '../../../data/ships/actives/index.js';
import { activeSkillIconName } from '../../../data/ships/actives/types.js';

/**
 * 연구소 스킬 노드 아이콘 62종 = 스탯 × 티어대 59 + 계열 캡스톤 3
 * (`.omc/plans/icon-manifest.json` 의 skill-stat · skill-capstone 축).
 *
 * **Lane 10 — 티어대 3구간 → 5구간.** `skillIconBand` 이 스킬 tier 0~4 를 저·중·상·최상·초월
 * 5밴드로 1:1 접는다(ADR-0022 §7-R #6 단계 앵커). 12스탯 × 5밴드지만 전 SHIP_TYPES 를 통틀어
 * `rangeFlat` 만 tier 0(low) 수요가 없어 4밴드라 59다(= 5×11 + 4).
 *
 * ✅ **아트 부채 28장 해소(2026-07-28).** Lane 10 이 티어대를 3구간 → 5구간으로 넓히면서 새로
 * 갈라진 `lowmid`(tier 1)·`midhigh`(tier 3) 24장과, 그 전부터 비어 있던 4장
 * (`bullet_count_low`·`bullet_speed_pct_high`·`range_flat_mid`·`range_flat_high`, M8-L9 부채)이
 * 오랫동안 **등재만 되고 PNG 가 없는** 상태였다. 로더는 이름으로만 찾고 없으면 조용히 null 을
 * 돌려주며 렌더가 그 null 을 예외 없이 삼키므로, 결함은 연구소 화면의 **빈 셀**로만 드러났다
 * (사용자 신고로 발견 — 테스트도 타입체커도 못 잡았다). 28장을 PixelLab 로 생성해 채웠고,
 * 재발은 `tests/uiAssetPresence.test.ts` 가 **등재 = 실물 존재**를 강제해 막는다.
 *
 * 5밴드 확장은 **기존 아트를 tier 0/2/4(=low/mid/high 슬러그)에 그대로 보존**했다 — tier 0/2/4
 * 노드의 그림은 바뀌지 않았다. `tests/skillIcons.test.ts` 가 목록 ↔ 노드 수요를 전 SHIP_TYPES 에
 * 대해 대조하므로, 신규 기체가 새 (스탯, 티어대) 조합을 만들면 즉시 깨진다.
 *
 * `assets/skill_range_flat_low.png` 는 디스크에 남아 있으나 tier 1 이 `lowmid` 로 이동하며
 * 어느 노드도 이 슬러그를 부르지 않는 **사문서 아트**가 됐다(무해 — 로더가 이름으로만 찾는다).
 *
 * 축이 (스탯, 티어대)라 **같은 스탯·같은 밴드의 노드는 같은 그림을 공유한다** — "예리한"과
 * "잔혹한"이 한 장을 쓰는 것은 결함이 아니라 결정의 내용이고, 구별은 노드 이름과 포인트 수치가
 * 한다. 63노드에 63장을 만들지 않기 위한 선택이다(ADR-0015 아이콘 축).
 *
 * 목록을 리터럴로 두는 이유: {@link skillIconName} 이 노드에서 유도한 이름이 이 목록에
 * 실재하는지를 테스트가 대조해, 티어대 경계나 스탯 구성이 바뀌면 즉시 깨지게 하기 위함이다.
 */
export const SKILL_ICON_NAMES = [
  // 각 스탯 5구간(저·중·상·최상·초월 = low·lowmid·mid·midhigh·high). low/mid/high 는
  // 기존 아트 보존(tier 0/2/4), lowmid/midhigh 는 2026-07-28 에 채운 신규 밴드 아트.
  'skill_damage_pct_low.png',
  'skill_damage_pct_lowmid.png',
  'skill_damage_pct_mid.png',
  'skill_damage_pct_midhigh.png',
  'skill_damage_pct_high.png',
  'skill_fire_rate_pct_low.png',
  'skill_fire_rate_pct_lowmid.png',
  'skill_fire_rate_pct_mid.png',
  'skill_fire_rate_pct_midhigh.png',
  'skill_fire_rate_pct_high.png',
  'skill_bullet_count_low.png',
  'skill_bullet_count_lowmid.png',
  'skill_bullet_count_mid.png',
  'skill_bullet_count_midhigh.png',
  'skill_bullet_count_high.png',
  'skill_bullet_speed_pct_low.png',
  'skill_bullet_speed_pct_lowmid.png',
  'skill_bullet_speed_pct_mid.png',
  'skill_bullet_speed_pct_midhigh.png',
  'skill_bullet_speed_pct_high.png',
  'skill_pierce_low.png',
  'skill_pierce_lowmid.png',
  'skill_pierce_mid.png',
  'skill_pierce_midhigh.png',
  'skill_pierce_high.png',
  // 사거리는 저 밴드 없음 — rangeFlat 노드가 어느 기체에서도 tier 0 에 없다(4구간).
  'skill_range_flat_lowmid.png',
  'skill_range_flat_mid.png',
  'skill_range_flat_midhigh.png',
  'skill_range_flat_high.png',
  'skill_max_hp_flat_low.png',
  'skill_max_hp_flat_lowmid.png',
  'skill_max_hp_flat_mid.png',
  'skill_max_hp_flat_midhigh.png',
  'skill_max_hp_flat_high.png',
  'skill_max_hp_pct_low.png',
  'skill_max_hp_pct_lowmid.png',
  'skill_max_hp_pct_mid.png',
  'skill_max_hp_pct_midhigh.png',
  'skill_max_hp_pct_high.png',
  'skill_dash_cd_pct_low.png',
  'skill_dash_cd_pct_lowmid.png',
  'skill_dash_cd_pct_mid.png',
  'skill_dash_cd_pct_midhigh.png',
  'skill_dash_cd_pct_high.png',
  'skill_move_speed_pct_low.png',
  'skill_move_speed_pct_lowmid.png',
  'skill_move_speed_pct_mid.png',
  'skill_move_speed_pct_midhigh.png',
  'skill_move_speed_pct_high.png',
  'skill_magnet_pct_low.png',
  'skill_magnet_pct_lowmid.png',
  'skill_magnet_pct_mid.png',
  'skill_magnet_pct_midhigh.png',
  'skill_magnet_pct_high.png',
  'skill_xp_pct_low.png',
  'skill_xp_pct_lowmid.png',
  'skill_xp_pct_mid.png',
  'skill_xp_pct_midhigh.png',
  'skill_xp_pct_high.png',
  // 캡스톤 3종은 `perPoint: 0` 인 질적 노드라 스탯 아이콘을 붙이면 거짓말이 된다 — 개별 아트.
  'skill_capstone_firepower.png',
  'skill_capstone_survival.png',
  'skill_capstone_mobility.png',
  // ADR-0049 스킬 어픽스의 **축 아이콘 3종**(affixes.md ①-11). 위 스탯 아이콘과 달리
  // **affinity 속성 자체**를 그린다 — ADR-0015 의 "인스턴스가 아니라 속성이 축". 기체별 트리
  // 아이콘을 재사용하면 안 된다(7기체의 축 표기 이름이 전부 달라 어픽스가 기체에 묶여 보인다).
  // ⚠️ 나머지 스킬 아이콘은 64×64 인데 이 셋만 **170×170** 이다(사용자 지시 2026-08-07 —
  // 고해상도). 스프라이트 배율을 손으로 맞춘 자리가 있으면 이 셋에서 어긋난다.
  'skill_axis_offense.png',
  'skill_axis_defense.png',
  'skill_axis_utility.png',
] as const;

/**
 * 스트라이커(타입 0)의 격납고 쇼케이스 파일명. **개명하지 않는다** — M8 이전부터 있던 자산이고,
 * 파일을 옮기면 아트가 도착하지 않은 신규 타입까지 한꺼번에 빈 화면이 된다(설계서 §9).
 */
export const LEGACY_SHOWCASE = 'ship_showcase_fighter.png';

/**
 * 기체 타입 → 격납고 쇼케이스 basename(128×128). 타입 0 만 레거시 이름을 쓰고 1~ 은
 * `ship_showcase_<slug>.png` 다. **범위 밖 typeId 는 `shipTypeDef` 가 0 으로 되돌린다** —
 * 손상 세이브가 존재하지 않는 파일명을 만들어 조용히 빈 화면이 되는 것을 막는다.
 *
 * 순수 문자열 유도라 Pixi 없이 테스트한다. 실제 PNG 가 없으면 로더가 null 을 주고 소비 측
 * (`hangar.ts`)이 **레거시 텍스처 → Graphics** 순으로 폴백한다(아트가 코드보다 늦게 온다).
 */
export function shipShowcaseName(typeId: number): string {
  const def = shipTypeDef(typeId);
  return def.id === DEFAULT_SHIP_TYPE ? LEGACY_SHOWCASE : `ship_showcase_${def.slug}.png`;
}

/**
 * 전 기체 타입의 쇼케이스 basename(중복 없음). 리터럴 목록이 아니라 **레지스트리 파생**이다 —
 * 하드코딩하면 `SHIP_TYPES` 에 타입이 추가될 때 로더가 조용히 그 한 장을 안 잡는다
 * (설계서 §10-7 이 예측한 "조용한 null 폴백" 의 쇼케이스 판).
 */
export const SHIP_SHOWCASE_NAMES: readonly string[] = SHIP_TYPES.map((d) => shipShowcaseName(d.id));

/**
 * 기체 타입 → 초상 basename(128×128, 카툰 픽셀 흉상). 쇼케이스(기체 외형)와 달리 **레거시
 * 예외가 없다** — 초상은 스토리 시스템 신규 자산이라 스트라이커도 `ship_portrait_striker.png`
 * 를 쓴다(`data/lore` 의 `ShipStory.portrait` 와 동일 규칙, `tests/lore.test.ts`·아래 테스트가
 * 두 소스를 대조). 범위 밖 typeId 는 `shipTypeDef` 가 0 으로 되돌린다(손상 세이브 방어).
 *
 * 실제 PNG 가 없으면 로더가 null 을 주고 소비 측(챔피언 사연 팝업·기록 보관소)이 초상 자리에
 * 절차적 폴백을 그린다 — 아트가 코드보다 늦게 와도 화면이 죽지 않는다(쇼케이스 선례).
 */
export function shipPortraitName(typeId: number): string {
  return `ship_portrait_${shipTypeDef(typeId).slug}.png`;
}

/** 전 기체 타입의 초상 basename(중복 없음). 레지스트리 파생 — 하드코딩하면 타입 추가 시 조용히 빠진다. */
export const SHIP_PORTRAIT_NAMES: readonly string[] = SHIP_TYPES.map((d) => shipPortraitName(d.id));

/**
 * 액티브 스킬 아이콘 42장의 basename — **레지스트리 파생**(`ACTIVES_BY_SHIP`).
 * 파일명 규약의 정본은 `activeSkillIconName(shipSlug, indexInShip)` 하나뿐이다.
 */
export const ACTIVE_ICON_NAMES: readonly string[] = ACTIVES_BY_SHIP.flatMap((list, shipTypeId) =>
  list.map((_, i) => activeSkillIconName(SHIP_TYPES[shipTypeId]?.slug ?? '', i)),
);

/**
 * 성계 지도 **전장 정찰 로스터**가 쓰는 적·보스 스프라이트(2026-08-04).
 *
 * 파일명 정본은 `src/render/textures.ts`(런이 쓰는 그 목록) 하나다 — 여기서 다시 적으면
 * 두 번째 전사본이 생기고, 어긋남은 "런에는 맞게 뜨는데 정찰창만 틀리다"로만 드러난다.
 * 보스는 **행성 보스만** 담는다(의뢰 보스 3칸은 행성 보스 파일을 잠정 재사용해 중복이라
 * `UI_ASSET_NAMES` 의 중복 금지 계약을 깬다). 방어적으로 Set 으로 한 번 더 접는다.
 *
 * 비용: `Assets.load` 는 URL 단위 캐시라 런 로더(`loadGameTextures`)와 **같은 텍스처를 공유**한다 —
 * 부팅에 새로 받는 것이 아니라 같은 항목을 한 번 더 참조할 뿐이다.
 */
export const RECON_ASSET_NAMES: readonly string[] = [
  ...new Set([
    ...ENEMY_ASSET_FILES,
    ...PLANET_CONTENT.map((c) => BOSS_ASSET_FILES[c.index]).filter(
      (n): n is string => n !== undefined,
    ),
  ]),
];

/** 로드 대상 UI 자산 basename (assets/ 아래, 확장자 포함). */
export const UI_ASSET_NAMES: readonly string[] = [
  'ui_panel.png',
  'ui_banner.png',
  'ui_btn_red.png',
  'ui_btn_blue.png',
  'ui_btn_yellow.png',
  'ui_btn_wood.png',
  'ui_chip.png',
  'ui_slot.png',
  'ui_slot_hl.png',
  'ui_icon_close.png',
  'ui_icon_coin.png',
  'ui_icon_crystal.png',
  'ui_icon_star.png',
  'ui_icon_lock.png',
  'ui_icon_salvage.png',
  'ui_icon_expand.png',
  'ui_icon_arrow_left.png',
  'ui_icon_arrow_right.png',
  'ui_icon_gear.png',
  'ui_icon_upgrade.png',
  'ui_icon_shield.png',
  'ui_icon_rocket.png',
  'ui_icon_check.png',
  'ui_icon_search.png',
  'ui_icon_trash.png',
  // 격납고·챔피언 선택 쇼케이스 — 타입 수만큼(레지스트리 파생, 타입 0 은 레거시 이름).
  ...SHIP_SHOWCASE_NAMES,
  // 기체 초상 — 사연 팝업·기록 보관소용 카툰 픽셀 흉상(레지스트리 파생, 레거시 예외 없음).
  ...SHIP_PORTRAIT_NAMES,
  // 예비역 수호기 프리셋 아트 2종(ADR-0024). **레지스트리 파생이 아니다** — 이 둘은 기체 타입이
  // 아니라 ADR-0024 **이전에 퇴역해 `build` 가 없는** 구 수호기의 프리셋(타이탄/인터셉터)이라
  // `SHIP_TYPES` 축에 낄 자리가 없다. 로스터 목록이 행 아이콘 폴백으로 읽는다(빌드가 있으면
  // 기체 초상을 쓴다) — 등재하지 않으면 구 수호기 행만 조용히 아이콘이 빈다.
  'guardian_titan.png',
  'guardian_interceptor.png',
  // 기지 맵 건물 아이콘(카툰나무풍 롤아웃 #1).
  'ui_bld_hangar.png',
  'ui_bld_research.png',
  'ui_bld_refinery.png',
  'ui_bld_defense.png',
  'ui_bld_control.png',
  'ui_bld_archive.png',
  // 지시 수신소(의뢰서 시스템 Phase E). 아이콘 미도착 — `tests/uiAssetPresence.test.ts` 의
  // KNOWN_MISSING 에 등재(accent 색 사각 폴백, `commissionDesk.ts`/`baseMap.ts` 는 없어도 죽지 않는다).
  'ui_bld_commission.png',
  // 정제소 어픽스 잠금 토글(카툰나무풍 롤아웃 #3) — DOM 판이 쓰던 32px 자물쇠 아이콘 재사용.
  'ui_lock.png',
  'ui_unlock.png',
  // 성계 지도 행성 오브(카툰나무풍 롤아웃 #4). 인덱스는 data/planets 레지스트리 순서
  // (0 카르곤 · 1 베르단 · 2 니플헤임 · 3 아르케). 없으면 코드 그라데이션 오브로 폴백한다.
  'ui_planet_0.png',
  'ui_planet_1.png',
  'ui_planet_2.png',
  'ui_planet_3.png',
  // 도발 스티커 12종 아이콘(`.omc/plans/icon-manifest.json` sticker 축). 순서 = data/stickers.ts
  // 인덱스 계약(0..11)이고 파일명은 id 의 `-`→`_` — {@link stickerIconName} 이 그 규칙을 소유한다.
  // 캔버스는 컬러 이모지를 두부로 떨구므로(text.ts stripEmoji) 이모지 자리를 이 아이콘이 대신한다.
  'sticker_good_game.png',
  'sticker_nice_try.png',
  'sticker_galaxy_small.png',
  'sticker_lock_door.png',
  'sticker_five_stars.png',
  'sticker_maintenance.png',
  'sticker_sightseeing.png',
  'sticker_turret_regards.png',
  'sticker_take_a_seat.png',
  'sticker_rematch_anytime.png',
  'sticker_core_walk.png',
  'sticker_safe_travels.png',
  // 장비 슬롯 아이콘(`.omc/plans/icon-manifest.json` equip-slot 축, 15종). 축은 슬롯 + 무기타입
  // 이고 매핑은 src/ui/equipIcons.ts 가 소유한다. 없으면 셀이 텍스트 글리프로 폴백한다.
  'equip_main_vulcan.png',
  'equip_main_spread.png',
  'equip_main_railgun.png',
  'equip_main_missile.png',
  'equip_main_beam.png',
  'equip_sub_sidekick.png',
  'equip_sub_scatter.png',
  'equip_sub_mine.png',
  'equip_sub_sentry.png',
  'equip_sub_flare.png',
  'equip_slot_armor.png',
  'equip_slot_shield.png',
  'equip_slot_engine.png',
  'equip_slot_core.png',
  'equip_slot_module.png',
  // 유니크 개별 아트 15종(equip-unique 축) — 파일명은 data/uniques.ts 의 id 에서 `-`→`_`.
  'equip_unique_overheat_drum.png',
  'equip_unique_split_core.png',
  'equip_unique_pierce_gyro.png',
  'equip_unique_drone_bay.png',
  'equip_unique_phase_armor.png',
  'equip_unique_hive_swarm.png',
  'equip_unique_converge_prism.png',
  'equip_unique_twin_star.png',
  'equip_unique_singularity.png',
  'equip_unique_reactive_armor.png',
  'equip_unique_phase_membrane.png',
  'equip_unique_afterimage_thruster.png',
  'equip_unique_greed_heart.png',
  'equip_unique_gambler_chip.png',
  'equip_unique_relic_amplifier.png',
  // 연구소 스킬 노드 아이콘 62종 — 규칙은 {@link skillIconName}, 목록은 {@link SKILL_ICON_NAMES}.
  ...SKILL_ICON_NAMES,
  // 촉매 아이콘(개별 48 + 보상축 폴백 10) — 목록은 `data/catalysts.ts` 레지스트리 파생.
  // 픽커·재고 보관소·정산 획득 목록이 같은 키로 읽는다.
  ...CATALYST_ICON_NAMES,
  // 촉매 잔재 아이콘(ADR-0042 촉매 상점 재화). 48종 레지스트리 파생이 **아니라** 재화 아이콘이라
  // 손으로 등재한다 — 촉매 한 장이 아니라 "분해하고 남은 것"이라 `CATALYST_ICON_NAMES` 의
  // slug 축에 낄 자리가 없다. 상점·분해·재화 표시가 같은 키로 읽는다.
  'catalyst_residue.png',
  // 파워업 전용 재사용 아트(스킬 노드는 부르지 않는다 — 그래서 SKILL_ICON_NAMES 에 넣으면
  // "죽은 아트 금지" 계약(tests/skillIcons)이 깨진다). `skill_range_flat_low.png` 는 tier 1 이
  // lowmid 로 옮겨가며 사문서가 된 실물 아트인데, 파워업 '집속 렌즈'(beam-focuser)가 이걸 되쓴다 —
  // 유니온에 있던 `skill_range_flat_lowmid` 는 PNG 가 없어 카드에 그림이 안 떴다(2026-07-27).
  'skill_range_flat_low.png',
  // 성계 지도 전장 정찰 로스터의 적·보스 스프라이트 — 목록 정본은 {@link RECON_ASSET_NAMES}.
  ...RECON_ASSET_NAMES,
  // 액티브 스킬 아이콘 42장(ADR-0041 — ADR-0015 의 "인스턴스 단위 아이콘 예외"에 편입).
  // **레지스트리 파생**이라 42종 저작이 바뀌면 목록이 자동으로 따라온다 — 손으로 나열하면
  // 조용히 어긋나고, 그 어긋남은 "번들에는 있는데 화면에 안 뜬다"로만 드러난다.
  ...ACTIVE_ICON_NAMES,
];

/** StatKey(camelCase) → 파일명 조각(snake_case). `maxHpFlat` → `max_hp_flat`. */
/**
 * ⚠️ **(ADR-0049) 구 스킬 노드 아이콘 규칙은 여기서 삭제됐다.**
 * `statSlug`/`skillIconBand`/`SkillIconBand`/`skillIconName` 은 `SkillNode.stat`+`tier` 에서
 * 아이콘 이름을 유도했는데, flat 재편으로 그 두 필드가 사라져 **호출부가 0** 이 됐다.
 * 신규 규칙은 축(affinity)만 읽는 `skillNodeIconName`(`src/ui/pixi/researchLab.ts`)이다.
 *
 * ⚠️ **{@link SKILL_ICON_NAMES} 의 62종은 이제 아무도 부르지 않는다.** 상수와 PNG 를 함께
 * 걷어내는 것은 아트 결정이라 이 레인에서 하지 않았다 — 지금은 프리로드 목록에만 남아 있다.
 * 신규 축 아이콘 3종(`skill_axis_{offense,defense,utility}.png`)이 생길 때 같이 정리하라.
 */

/**
 * 스티커 인덱스(서버 smallint 0..11) → 아이콘 basename. 범위 밖/손상 값이면 null.
 * 순수 함수(Pixi 미의존)라 단위 테스트로 {@link UI_ASSET_NAMES} 와의 정합을 고정한다.
 */
export function stickerIconName(index: unknown): string | null {
  const sticker = stickerByIndex(index);
  return sticker === null ? null : `sticker_${sticker.id.replace(/-/g, '_')}.png`;
}

/** basename → Texture(로드 성공) | null(미존재/실패). */
export type UiTextures = Record<string, Texture | null>;

// assets/*.png URL 을 빌드타임에 잡는다(textures.ts 와 동일 방식). 이 파일은
// src/ui/pixi/ 라 assets 까지 3단계 상위다.
const UI_ASSET_URLS = import.meta.glob('../../../assets/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/**
 * basename → 번들 URL. **DOM 오버레이(HUD)가 같은 아트를 `<img>` 로 쓰려면 이것이 필요하다** —
 * Pixi 텍스처 캐시는 캔버스 전용이라 DOM 이 재사용할 수 없다(ADR-0041 · HUD 액티브 2칸).
 * 미등재 basename 은 `undefined` 를 돌려주므로 호출부가 폴백을 그려야 한다.
 */
export function uiAssetUrl(basename: string): string | undefined {
  for (const key in UI_ASSET_URLS) {
    if (key.endsWith(`/${basename}`)) return UI_ASSET_URLS[key];
  }
  return undefined;
}

/** 단일 PNG 를 nearest 텍스처로 로드(실패/미존재 시 null — 폴백 유도). */
async function tryLoad(basename: string): Promise<Texture | null> {
  const url = uiAssetUrl(basename);
  if (url === undefined) return null;
  try {
    const tex = await Assets.load<Texture>(url);
    tex.source.scaleMode = 'nearest';
    return tex;
  } catch {
    return null;
  }
}

/** 모든 UI 자산을 병렬 로드해 basename→Texture|null 맵을 만든다(누락은 null). */
export async function loadUiTextures(): Promise<UiTextures> {
  const out: UiTextures = {};
  await Promise.all(
    UI_ASSET_NAMES.map(async (name) => {
      out[name] = await tryLoad(name);
    }),
  );
  return out;
}
