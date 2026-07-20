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
import type { SkillNode } from '../../../data/skills.js';

/**
 * 연구소 스킬 노드 아이콘 35종 = 스탯 × 티어대 32 + 계열 캡스톤 3
 * (`.omc/plans/icon-manifest.json` 의 skill-stat · skill-capstone 축).
 *
 * 축이 (스탯, 티어대)라 **같은 스탯의 노드는 같은 그림을 공유한다** — "예리한"과 "잔혹한"이
 * 한 장을 쓰는 것은 결함이 아니라 결정의 내용이고, 구별은 노드 이름과 포인트 수치가 한다.
 * 63노드에 63장을 만들지 않기 위한 선택이다(ADR-0015 아이콘 축).
 *
 * 목록을 리터럴로 두는 이유: {@link skillIconName} 이 노드에서 유도한 이름이 이 목록에
 * 실재하는지를 테스트가 대조해, 티어대 경계나 스탯 구성이 바뀌면 즉시 깨지게 하기 위함이다.
 */
export const SKILL_ICON_NAMES = [
  'skill_damage_pct_low.png',
  'skill_damage_pct_mid.png',
  'skill_damage_pct_high.png',
  'skill_fire_rate_pct_low.png',
  'skill_fire_rate_pct_mid.png',
  'skill_fire_rate_pct_high.png',
  'skill_bullet_count_mid.png',
  'skill_bullet_count_high.png',
  'skill_bullet_speed_pct_low.png',
  'skill_bullet_speed_pct_mid.png',
  'skill_pierce_low.png',
  'skill_pierce_mid.png',
  'skill_pierce_high.png',
  'skill_range_flat_low.png',
  'skill_max_hp_flat_low.png',
  'skill_max_hp_flat_mid.png',
  'skill_max_hp_flat_high.png',
  'skill_max_hp_pct_low.png',
  'skill_max_hp_pct_mid.png',
  'skill_max_hp_pct_high.png',
  'skill_dash_cd_pct_low.png',
  'skill_dash_cd_pct_mid.png',
  'skill_dash_cd_pct_high.png',
  'skill_move_speed_pct_low.png',
  'skill_move_speed_pct_mid.png',
  'skill_move_speed_pct_high.png',
  'skill_magnet_pct_low.png',
  'skill_magnet_pct_mid.png',
  'skill_magnet_pct_high.png',
  'skill_xp_pct_low.png',
  'skill_xp_pct_mid.png',
  'skill_xp_pct_high.png',
  // 캡스톤 3종은 `perPoint: 0` 인 질적 노드라 스탯 아이콘을 붙이면 거짓말이 된다 — 개별 아트.
  'skill_capstone_firepower.png',
  'skill_capstone_survival.png',
  'skill_capstone_mobility.png',
] as const;

/** 로드 대상 UI 자산 basename (assets/ 아래, 확장자 포함). */
export const UI_ASSET_NAMES = [
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
  'ship_showcase_fighter.png',
  // 기지 맵 건물 아이콘(카툰나무풍 롤아웃 #1).
  'ui_bld_hangar.png',
  'ui_bld_research.png',
  'ui_bld_refinery.png',
  'ui_bld_defense.png',
  'ui_bld_control.png',
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
  // 연구소 스킬 노드 아이콘 35종 — 규칙은 {@link skillIconName}, 목록은 {@link SKILL_ICON_NAMES}.
  ...SKILL_ICON_NAMES,
] as const;

/** StatKey(camelCase) → 파일명 조각(snake_case). `maxHpFlat` → `max_hp_flat`. */
function statSlug(stat: string): string {
  return stat.replace(/([A-Z])/g, '_$1').toLowerCase();
}

/**
 * 노드 티어 → 아이콘 티어대. 저(0~1) · 중(2~3) · 고(4).
 *
 * 티어대는 **아이콘을 묶기 위한 구분일 뿐 게임 데이터가 아니다** — `data/skills.ts` 의 `tier`
 * 는 이 함수가 읽기만 하고 절대 바꾸지 않는다. 캡스톤(tier 5)은 여기까지 오지 않는다.
 */
export function skillIconBand(tier: number): 'low' | 'mid' | 'high' {
  if (tier <= 1) return 'low';
  if (tier <= 3) return 'mid';
  return 'high';
}

/**
 * 스킬 노드 → 아이콘 basename. 캡스톤은 계열별 개별 아트, 그 외는 (스탯 × 티어대) 공유 아트.
 * 순수 함수(Pixi 미의존)라 단위 테스트로 {@link SKILL_ICON_NAMES} 와의 정합을 고정한다.
 */
export function skillIconName(node: SkillNode): string {
  if (node.capstone === true) return `skill_capstone_${node.tree}.png`;
  return `skill_${statSlug(node.stat)}_${skillIconBand(node.tier)}.png`;
}

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

function uiAssetUrl(basename: string): string | undefined {
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
