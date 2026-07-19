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
] as const;

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
