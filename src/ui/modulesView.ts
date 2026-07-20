/**
 * 코어 모듈 표시 헬퍼 (M7b) — 순수 함수 · DOM/Pixi 무관 · vitest 대상.
 *
 * 구 `src/ui/cardsView.ts`(M6 방어 카드 표시 헬퍼) 계승. 코어 모듈 화면(`src/ui/pixi/modulesView.ts`)
 * 과 관제탑 정찰 공개(스펙 R9)가 **같은 함수**를 쓰도록 화면 밖으로 뺐다 — 등급 색·잔여 경고·
 * 합성 사전 검증 같은 값이 화면마다 갈리면 사용자에게는 그냥 버그로 보인다.
 *
 * ── 콘텐츠명 정책 ── 모듈 어픽스명·유니크명은 **i18n 키**(`def3.affix.<id>.name` /
 * `def3.module.<id>.name`)로 조회한다. 구 카드가 데이터 카탈로그의 한글 `name` 필드를 그대로
 * 노출하던 것을 M7b 에서 끊었다(EN 로케일에 한글이 새고 i18n 검증 밖에 남았다).
 *
 * ── 서버 권위 ── 이 모듈은 표시만 한다. 구매·합성·분해·장착의 실제 검증·차감은 서버
 * (modules EF · salvage_core_module RPC · defenses 트리거)가 강제하고, 여기 합성 사전 검증은
 * UX 보조다(서버가 최종 판정 — 코드 문자열도 EF 계약과 정합).
 */

import {
  MODULE_STORAGE_CAP,
  MODULE_FUSION_INPUT_COUNT,
  moduleBuyPrice,
  moduleAffixNameKey,
  moduleUniqueNameKey,
  type ModuleInstance,
} from '../../data/coreModules.js';
import type { Rarity } from '../items/types.js';
import type { ModuleOwned } from '../net/modules.js';
import { t, type MessageKey } from '../i18n/index.js';

/** 등급 → 표시 색(resultOverlay/inventory 팔레트와 동일). 미지 등급은 normal 색. */
export const MODULE_RARITY_COLOR: Record<string, string> = {
  normal: '#b8c2d8',
  magic: '#6aa0ff',
  rare: '#ffd24c',
  unique: '#ff8a3c',
};

/** 등급 문자열 → 표시 색(미지 등급 방어). */
export function moduleRarityColor(rarity: string): string {
  return MODULE_RARITY_COLOR[rarity] ?? MODULE_RARITY_COLOR.normal!;
}

/** 등급 문자열 → i18n 라벨 키(item.rarity.* 재사용). 미지 등급은 normal. */
function rarityKey(rarity: string): MessageKey {
  switch (rarity) {
    case 'magic':
      return 'item.rarity.magic';
    case 'rare':
      return 'item.rarity.rare';
    case 'unique':
      return 'item.rarity.unique';
    default:
      return 'item.rarity.normal';
  }
}

/** 등급 라벨(현재 로케일). */
export function moduleRarityLabel(rarity: string): string {
  return t(rarityKey(rarity));
}

/**
 * 동적 i18n 키 조회. 키가 데이터 파생(`def3.affix.<id>.name`)이라 `MessageKey` 캐스팅이
 * 필요하다 — 스티커(`sticker.<id>`)·방어체 카탈로그와 같은 선례이며, 누락은 tests/i18n.test.ts
 * 가 배열 파생으로 잡는다. 조회 실패 시 `t` 는 키 자체를 돌려주므로 화면이 비지는 않는다.
 */
function tKey(key: string): string {
  return t(key as MessageKey);
}

/** 모듈 어픽스 1건 표시(i18n 표기명 + 롤 값). */
function affixLine(id: string, value: number): string {
  return t('mod.affixLine', { name: tKey(moduleAffixNameKey(id)), value });
}

/**
 * 모듈의 어픽스 요약(접두·접미 별도 목록 + 유니크명). 보관함·슬롯 표시에 쓴다. normal 모듈은
 * 어픽스가 없어 두 목록 모두 비고 unique 도 null 이다(기저 효과만).
 */
export function moduleAffixSummary(mod: ModuleInstance): {
  prefixes: string[];
  suffixes: string[];
  unique: string | null;
} {
  const prefixes = mod.prefixes.map((a) => affixLine(a.id, a.value));
  const suffixes = mod.suffixes.map((a) => affixLine(a.id, a.value));
  const unique = mod.uniqueId !== undefined ? tKey(moduleUniqueNameKey(mod.uniqueId)) : null;
  return { prefixes, suffixes, unique };
}

/** 어픽스 요약을 한 줄로(툴팁·좁은 표시). 유니크 먼저, 접두·접미 순. 비면 기저 안내. */
export function moduleAffixOneLine(mod: ModuleInstance): string {
  const s = moduleAffixSummary(mod);
  const parts: string[] = [];
  if (s.unique !== null) parts.push(s.unique);
  parts.push(...s.prefixes, ...s.suffixes);
  return parts.length > 0 ? parts.join(' · ') : t('mod.baseOnly');
}

/** 잔여 1회 경고 대상 여부(소모성 — 다음 확정 침공에서 사라진다). */
export function isLowCharge(chargesLeft: number): boolean {
  return chargesLeft === 1;
}

/** 사용 소진(0회) 여부 — 슬롯에서 빈 슬롯 안내 대상. */
export function isDepleted(chargesLeft: number): boolean {
  return chargesLeft <= 0;
}

/** 보관 게이지 상태(현재/상한/백분율/만석). count/cap 방어적 클램프. */
export interface StorageGauge {
  count: number;
  cap: number;
  /** 0~100 정수 백분율. */
  pct: number;
  /** 상한 도달(신규 획득·합성 결과 차단). */
  full: boolean;
}

/** 보관 게이지 계산(순수). cap 기본은 {@link MODULE_STORAGE_CAP}(20). */
export function storageGauge(count: number, cap: number = MODULE_STORAGE_CAP): StorageGauge {
  const c = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  const capN = Number.isFinite(cap) && cap > 0 ? Math.trunc(cap) : MODULE_STORAGE_CAP;
  const pct = Math.max(0, Math.min(100, Math.round((c / capN) * 100)));
  return { count: c, cap: capN, pct, full: c >= capN };
}

/** 합성 선택 사전 검증 코드(서버 modules EF 코드와 정합 — need-three/dup-ids/rarity-mismatch). */
export type FusionCheckCode = 'ok' | 'need-three' | 'dup-ids' | 'rarity-mismatch';

/** 합성 선택 상태(순수). 서버 fuseModules 호출 전 UX 사전 검증. */
export interface FusionCheck {
  ok: boolean;
  code: FusionCheckCode;
}

/**
 * 합성 선택을 사전 검증한다(순수). 서버가 최종 강제하지만, 버튼 활성/안내를 즉시 주기 위해
 * 클라가 미리 본다. 규칙(EF 계약 정합): 정확히 3개 · 중복 행 id 없음 · 전부 동급.
 */
export function checkFusionSelection(selected: readonly ModuleOwned[]): FusionCheck {
  if (selected.length !== MODULE_FUSION_INPUT_COUNT) return { ok: false, code: 'need-three' };
  const ids = new Set(selected.map((m) => m.id));
  if (ids.size !== selected.length) return { ok: false, code: 'dup-ids' };
  const first = selected[0]!.rarity;
  if (!selected.every((m) => m.rarity === first)) return { ok: false, code: 'rarity-mismatch' };
  return { ok: true, code: 'ok' };
}

/** 합성 검증 코드 → 안내 문구(현재 로케일). ok 는 빈 문자열. */
export function fusionCheckText(code: FusionCheckCode): string {
  switch (code) {
    case 'need-three':
      return t('mod.fuse.needThree');
    case 'dup-ids':
      return t('mod.fuse.dupIds');
    case 'rarity-mismatch':
      return t('mod.fuse.rarityMismatch');
    case 'ok':
      return '';
  }
}

/** 구매 실패 코드 → 안내 문구(현재 로케일). 미지 코드는 일반 오류. */
export function buyErrorText(code: string | undefined): string {
  switch (code) {
    case 'storage-full':
      return t('mod.buy.storageFull');
    case 'insufficient-credits':
      return t('mod.buy.insufficient');
    case 'already-bought':
      return t('mod.buy.alreadyBought');
    case 'bad-slot':
      return t('mod.buy.badSlot');
    case 'no-profile':
      return t('mod.buy.noProfile');
    default:
      return t('mod.buy.failed');
  }
}

/** 상점 슬롯 표시 가격(등급 기반, 서버 moduleBuyPrice 와 동일). */
export function shopSlotPrice(rarity: Rarity): number {
  return moduleBuyPrice(rarity);
}

/**
 * 장착 슬롯 배열에서 **다음에 꽂을 슬롯**을 고른다(순수). 사용자가 슬롯을 명시 선택했으면
 * 그 슬롯, 아니면 첫 빈 슬롯. 빈 슬롯이 없으면 null — 호출부가 `mod.equip.noSlot` 안내를
 * 띄운다(임의 슬롯을 덮어써서 장착분을 조용히 날리지 않는다).
 */
export function pickEquipSlot(
  equipped: readonly (string | null)[],
  selected: number | null,
): number | null {
  if (selected !== null && selected >= 0 && selected < equipped.length) return selected;
  const idx = equipped.findIndex((v) => v === null);
  return idx >= 0 ? idx : null;
}
