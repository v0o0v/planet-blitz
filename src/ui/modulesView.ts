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
  MODULE_AFFIX_BY_ID,
  MODULE_BASE_EFFECT,
  CORE_MODULE_UNIQUE_BY_ID,
  moduleBuyPrice,
  moduleAffixNameKey,
  moduleUniqueNameKey,
  type ModuleAffixDef,
  type ModuleInstance,
  type ModuleStatKey,
} from '../../data/coreModules.js';
import type { Rarity } from '../items/types.js';
import type { ModuleOwned } from '../net/modules.js';
import { t, type MessageKey } from '../i18n/index.js';
import { TICK_RATE } from '../sim/constants.js';

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

// ---------------------------------------------------------------------------
// 효과를 **수치로** 말한다 (사용자 지시 2026-08-03)
// ---------------------------------------------------------------------------
//
// 그때까지 화면은 모듈의 특성을 `소화의 +12` 처럼 **표기명 + 롤 값**으로만 보여 줬다. 값은
// 있는데 그 값이 **무엇을 얼마나** 바꾸는지가 없어서, 플레이어는 12 가 큰지 작은지도, 어느
// 축을 건드리는지도 알 수 없었다. 게다가 normal 모듈은 어픽스가 없어 `기저 효과만` 한 마디로
// 끝났는데 실제로는 화력 +3% · 코어 HP +3% 가 무조건 걸린다 — **있는 효과를 없다고 말하고
// 있었다**.
//
// 그래서 세 조각을 데이터에서 조립한다:
//   ① **얼마나** — 롤 `value` 를 그 `stat` 의 단위·부호와 함께({@link moduleStatText}).
//   ② **언제** — 접두는 정적 카운터 조건, 접미는 트리거 이벤트(+ threshold)
//      ({@link moduleAffixWhen}). 조건부 18% 와 무조건 18% 는 완전히 다른 값이라, 조건을
//      빼면 수치를 보여 줘도 여전히 거짓말이 된다.
//   ③ **기저·유니크** — 등급별 기저 효과와 유니크 파라미터도 수치로.
//
// ⚠️ 부호는 **문구가 들고 있다**(`받는 피해 −{n}%` / `공격자 이동속도 −{n}%`). 값에 부호를
// 넣으면 `incomingDmgReductionPct` 처럼 "감소량이 클수록 좋은" 축에서 −가 나쁜 것처럼 읽힌다.
// 산식 자체는 sim(`src/sim/moduleEffects.ts`)이 정본이고 여기는 그 축을 말로 옮기기만 한다.
//
// 기존 {@link moduleAffixOneLine} 은 **그대로 둔다** — 관제탑 정찰 공개(`controlTower.ts`)가
// 좁은 한 줄로 쓰고 있고, 그 화면은 이 레인의 범위가 아니다.

/** 스탯 → i18n 라벨 키(`{n}` 자리에 값이 들어간다). */
function statKey(stat: ModuleStatKey): MessageKey {
  return `mod.stat.${stat}` as MessageKey;
}

/**
 * 스탯 한 축의 효과 문구. `value` 는 롤 원값(양수)이고 **부호와 단위는 문구가 갖는다**.
 */
export function moduleStatText(stat: ModuleStatKey, value: number): string {
  return t(statKey(stat), { n: value });
}

/**
 * 이 모듈 어픽스가 **언제** 실리는가. 접두는 T0 매치업 조건, 접미는 런 중 트리거다.
 * 임계가 있는 트리거는 그 수치까지 문구에 싣는다(`설비 3기 파괴 시` · `코어 HP 30% 이하`).
 * 정의를 못 찾으면 null — 호출부가 "언제" 없이 효과만 보여 준다(조용한 공백보다 낫다).
 */
export function moduleAffixWhen(def: ModuleAffixDef | undefined): string | null {
  if (def === undefined) return null;
  if (def.condition !== undefined) return t(`mod.when.${def.condition}` as MessageKey);
  if (def.trigger !== undefined) {
    return t(`mod.when.${def.trigger}` as MessageKey, { n: def.threshold ?? 0 });
  }
  return null;
}

/**
 * 유니크 고유 효과의 **수치** 한 줄(파라미터에서 조립). 유니크가 아니면 null.
 *
 * ⚠️ 문구에 수치를 **손으로 적지 마라.** 파라미터는 데이터가 정본이고 튜닝으로 움직인다 —
 * 손으로 적으면 그 순간부터 화면이 조용히 거짓말한다(`uq-blackout` 을 "첫 30초"로 적었다가
 * 단위 테스트가 잡았다: 정본은 `radarDisableTicks: 1800` 이다).
 * 틱처럼 플레이어가 모르는 단위는 **여기서 초로 파생**해 함께 넘긴다.
 */
export function moduleUniqueStatText(uniqueId: string | undefined): string | null {
  if (uniqueId === undefined) return null;
  const def = CORE_MODULE_UNIQUE_BY_ID.get(uniqueId);
  if (def === undefined) return null;
  const params: Record<string, number> = { ...def.params };
  for (const [k, v] of Object.entries(def.params)) {
    if (k.endsWith('Ticks')) params[`${k.slice(0, -5)}Sec`] = Math.round(v / TICK_RATE);
  }
  return t(`mod.uq.${uniqueId}` as MessageKey, params);
}

/**
 * 모듈 하나가 실제로 하는 일 전량 — **한 줄에 하나씩, 전부 수치를 담아서**.
 *
 * 순서: 기저(무조건) → 유니크(룰 변경) → 접두(조건부) → 접미(트리거). 무조건 걸리는 것부터
 * 놓아야 "이 모듈이 최소한 무엇을 주는가"가 첫 줄에서 끝난다.
 */
export function moduleEffectLines(mod: ModuleInstance): string[] {
  const out: string[] = [];
  const base = MODULE_BASE_EFFECT[mod.rarity];
  if (base !== undefined) {
    out.push(t('mod.effect.base', { d: base.allDamagePct, h: base.coreHpPct }));
  }
  const unique = moduleUniqueStatText(mod.uniqueId);
  if (unique !== null) out.push(unique);
  for (const roll of [...mod.prefixes, ...mod.suffixes]) {
    const when = moduleAffixWhen(MODULE_AFFIX_BY_ID.get(roll.id));
    const effect = moduleStatText(roll.stat, roll.value);
    out.push(when === null ? effect : t('mod.effect.when', { when, effect }));
  }
  return out;
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
