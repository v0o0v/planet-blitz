/**
 * 장비 아이템 → 아이콘 키 매핑 (ADR-0015 아이콘 축 · ADR-0016 `pb-equip-icon` 레지스터).
 *
 * 축은 **인스턴스가 아니라 속성**이다:
 *  - 주무기·보조무기는 `weaponType` 으로 갈라 각 5종 → `equip_main_*` / `equip_sub_*`
 *  - 장갑·실드·엔진·코어·모듈은 슬롯당 1종 → `equip_slot_*` (총 15종)
 *  - 유니크만 예외로 개별 아트 15종 → `equip_unique_<id 의 - 를 _ 로>`
 *
 * 표는 `.omc/plans/icon-manifest.json` 의 equip-slot / equip-unique 축을 그대로 옮긴 것이다
 * (플랜 파일은 런타임 자산이 아니라 빌드에 넣지 않는다). 유니크는 id 에서 파일명을 유도하므로
 * 표를 따로 두지 않는다 — 미등록 id 는 존재하지 않는 파일명이 되고, 로더가 null 을 돌려
 * 셀이 글리프로 폴백한다(자산이 하나 없다고 화면이 죽지 않는다).
 *
 * 순수 데이터/함수다 — DOM·Pixi 를 참조하지 않는다. sim 도 이 파일을 참조하지 않는다(ADR-0005).
 */

import type { SlotKind } from '../items/types.js';

/** 아이콘을 고를 때 셀이 실제로 읽는 아이템 속성(전부 표시용). */
export interface EquipIconTarget {
  readonly slot: SlotKind;
  /** 주/보조무기 종류 코드(0..4). 그 외 슬롯은 undefined. */
  readonly weaponType?: number | undefined;
  /** 유니크 아이템만 — 개별 아트 키가 된다. */
  readonly uniqueId?: string | undefined;
}

/** 주무기 코드(src/items/loadout.ts WEAPON_*) 순서. */
const MAIN_WEAPONS = ['vulcan', 'spread', 'railgun', 'missile', 'beam'] as const;
/** 보조무기 코드(src/items/loadout.ts SUB_*) 순서. */
const SUB_WEAPONS = ['sidekick', 'scatter', 'mine', 'sentry', 'flare'] as const;
/** 무기타입이 없는 슬롯 5종. */
const PLAIN_SLOTS = ['armor', 'shield', 'engine', 'core', 'module'] as const;

/** 유니크를 뺀 슬롯 축 15종의 아이콘 키(등록 검증·테스트용). */
export const EQUIP_SLOT_ICON_KEYS: readonly string[] = [
  ...MAIN_WEAPONS.map((w) => `equip_main_${w}`),
  ...SUB_WEAPONS.map((w) => `equip_sub_${w}`),
  ...PLAIN_SLOTS.map((s) => `equip_slot_${s}`),
];

/** 유니크 id → 아이콘 키(파일명 규약 `-` → `_`). */
export function uniqueIconKey(uniqueId: string): string {
  return `equip_unique_${uniqueId.replace(/-/g, '_')}`;
}

/**
 * 아이템 속성 → 아이콘 키. 해석 불가(무기 코드가 범위 밖)면 null 이고, 그때 셀은
 * 텍스트 글리프로 폴백한다. 유니크는 슬롯 아이콘보다 우선한다.
 */
export function equipIconKey(target: EquipIconTarget): string | null {
  const uid = target.uniqueId;
  if (uid !== undefined && uid !== '') return uniqueIconKey(uid);

  if (target.slot === 'main' || target.slot === 'sub') {
    const table = target.slot === 'main' ? MAIN_WEAPONS : SUB_WEAPONS;
    // 무기 슬롯인데 코드가 비었으면 loadout 과 같은 기본값(0)으로 읽는다.
    const code = target.weaponType ?? 0;
    const name = Number.isInteger(code) ? table[code] : undefined;
    return name === undefined ? null : `equip_${target.slot}_${name}`;
  }

  return `equip_slot_${target.slot}`;
}

/** {@link equipIconKey} 의 basename 형태(`assets/` 평면 구조 — 하위 폴더 금지). */
export function equipIconName(target: EquipIconTarget): string | null {
  const key = equipIconKey(target);
  return key === null ? null : `${key}.png`;
}
