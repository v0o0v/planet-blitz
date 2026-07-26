/**
 * 장비 표시 이름 단일 정본 (사용자 요청 2026-07-27 — "무기일 경우 유도탄/빔 등 장비 이름").
 *
 * ## 왜 모아야 했는가
 * 같은 규칙("주무기는 무기 종류로, 나머지는 슬롯명으로 부른다")이 **네 곳에 복제**돼 있었다
 * (격납고 Pixi/DOM · 정제소 Pixi/DOM). 그리고 그 사본들이 **서로 다르게 낡았다**:
 * 무기는 M3 에서 5종(발칸·스프레드·레일건·미사일·빔)이 됐는데 격납고 두 사본의 키 표는 3종에서
 * 멈춰 있었다 — 미사일·빔 주무기를 주우면 툴팁 이름이 `주무기 · ?` 로 뜨고, 격납고 능력치 줄의
 * '무기' 항목은 `?? 'item.weapon.0'` 폴백에 걸려 **빔을 장착하고도 "발칸"이라고 적혀 있었다**.
 *
 * 그래서 규칙을 여기 하나로 모은다. 무기 종류가 늘면 이 파일의 표 하나만 늘리면 되고, 아래
 * 테스트가 "표 길이 == 실제 롤 범위"를 못박아 다시 낡지 않게 한다.
 *
 * ## 보조무기도 이름을 갖는다
 * 보조무기는 `weaponType` 0..4 가 **완전히 다른 무기**(사이드킥 단발 · 산탄 · 기뢰 · 센트리 드론
 * · 유도 플레어, `world.ts` subWeapon 분기)인데 표시 이름이 슬롯명 "보조무기" 하나뿐이라
 * 인벤토리에서 구별이 불가능했다. 주무기와 같은 규칙으로 종류명을 붙인다.
 *
 * 순수 UI 레이어 — sim·세이브를 쓰지 않는다(ADR-0005).
 */

import { t, type MessageKey } from '../i18n/index.js';
import type { Item, SlotKind } from '../items/types.js';

/** 주무기 종류 i18n 키(0 발칸 · 1 스프레드 · 2 레일건 · 3 미사일 · 4 빔 — `roll.ts` 0..4 와 동수). */
export const WEAPON_KEYS: readonly MessageKey[] = [
  'item.weapon.0',
  'item.weapon.1',
  'item.weapon.2',
  'item.weapon.3',
  'item.weapon.4',
];

/** 보조무기 종류 i18n 키(0 사이드킥 · 1 산탄 · 2 기뢰 · 3 센트리 · 4 플레어 — `world.ts` SUB_TYPE_*). */
export const SUB_WEAPON_KEYS: readonly MessageKey[] = [
  'item.subWeapon.0',
  'item.subWeapon.1',
  'item.subWeapon.2',
  'item.subWeapon.3',
  'item.subWeapon.4',
];

const SLOT_LABEL_KEY: Record<SlotKind, MessageKey> = {
  main: 'item.slot.main',
  sub: 'item.slot.sub',
  armor: 'item.slot.armor',
  shield: 'item.slot.shield',
  engine: 'item.slot.engine',
  core: 'item.slot.core',
  module: 'item.slot.module',
};

/** 슬롯 표시명. */
export function slotLabel(kind: SlotKind): string {
  return t(SLOT_LABEL_KEY[kind]);
}

/** 주무기 종류명. 범위 밖(손상 세이브)이면 `?` — 조용한 오표기(발칸 폴백)보다 낫다. */
export function weaponLabel(type: number): string {
  const key = WEAPON_KEYS[type];
  return key !== undefined ? t(key) : '?';
}

/** 보조무기 종류명. 범위 밖이면 `?`. */
export function subWeaponLabel(type: number): string {
  const key = SUB_WEAPON_KEYS[type];
  return key !== undefined ? t(key) : '?';
}

/**
 * 무기 슬롯의 종류명(주무기/보조무기 공통). 무기 슬롯이 아니거나 종류가 없으면 undefined.
 * 툴팁 제목·부제가 "무엇인지"를 한 줄로 말하게 하는 조각이다.
 */
export function weaponKindLabel(item: {
  slot: SlotKind;
  weaponType?: number | undefined;
}): string | undefined {
  if (item.weaponType === undefined) return undefined;
  if (item.slot === 'main') return weaponLabel(item.weaponType);
  if (item.slot === 'sub') return subWeaponLabel(item.weaponType);
  return undefined;
}

/**
 * 장비 표시 이름. 무기는 `슬롯 · 종류`(예: `주무기 · 빔`, `보조무기 · 기뢰 살포기`), 그 외는
 * 슬롯명 그대로. 모든 화면이 이 한 함수를 쓴다 — 화면마다 다른 이름이 뜨지 않게 하기 위함이다.
 */
export function itemDisplayName(item: Pick<Item, 'slot' | 'weaponType'>): string {
  const kind = weaponKindLabel(item);
  return kind !== undefined ? `${slotLabel(item.slot)} · ${kind}` : slotLabel(item.slot);
}
