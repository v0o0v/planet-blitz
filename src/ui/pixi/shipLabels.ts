/**
 * 기체·계열 표시명 (M8-L8).
 *
 * ## 왜 별도 모듈인가
 * 격납고·챔피언 선택·연구소가 **같은 규칙**으로 기체 이름과 계열 이름을 만들어야 한다. 세
 * 화면이 각자 문자열을 조립하면 로케일 하나가 빠졌을 때 화면마다 다른 것이 보이고, 어디가
 * 정본인지도 사라진다. 키 유도 규칙을 여기 하나에 둔다.
 *
 * ## i18n 키는 **`SHIP_TYPES` 파생**이다 (설계서 §10-6)
 * 하드코딩 목록을 만들면 레지스트리에 타입이 추가돼도 목록이 모르고, 이름이 조용히 빈칸이
 * 된다. 키는 전부 slug 에서 유도한다:
 *
 * | 대상 | 키 |
 * |---|---|
 * | 기체 이름 | `ship.<slug>.name` |
 * | 기체 한 줄 소개 | `ship.<slug>.role` |
 * | 시그니처 패시브 설명 | `ship.<slug>.signature` |
 * | 계열 이름 | `lab.tree.<treeSlug>` |
 *
 * 스트라이커의 계열 slug 는 `firepower`/`survival`/`mobility` 라 **기존 카탈로그 키가 그대로
 * 맞는다** — 개명 없이 신규 타입만 키가 는다.
 *
 * ## 카탈로그에 아직 없는 키의 처리
 * `MessageKey` 는 영어 카탈로그의 키 집합에서 파생되므로, 아직 등재되지 않은 키는 **컴파일이
 * 막는다**. 그래서 {@link tShipKey} 가 카탈로그 실재 여부를 먼저 보고 없으면 slug 를 사람이
 * 읽을 수 있게 다듬어 돌려준다. 이것은 번역이 아니라 **자리표시자**다 — 진짜 문자열은
 * M8-L9(i18n) 가 채우고, 그 레인의 `SHIP_TYPES` 파생 테스트가 누락을 잡는다. 폴백이 없으면
 * `t()` 가 `'ship.bruiser.name'` 같은 키를 화면에 그대로 노출한다.
 *
 * 순수 문자열 유도 — Pixi 미의존이라 캔버스 없이 테스트한다. 컬러 이모지는 쓰지 않는다
 * (`src/ui/pixi/text.ts` stripEmoji 가 두부로 떨군다).
 */

import { CATALOG, type MessageKey } from '../../i18n/catalog.js';
import { t, type TParams } from '../../i18n/index.js';
import type { ShipTypeDef, ShipTreeDef, TreeAffinity } from '../../../data/ships/index.js';

/**
 * 계열 강조색의 축은 **affinity(역할)** 다 — 트리 이름도 인덱스도 아니다(M8 설계서 §2).
 *
 * 이름을 축으로 삼으면 신규 기체의 계열(blade·morph·fortify …)이 전부 색을 잃고, 인덱스를
 * 축으로 삼으면 타입마다 트리 순서가 달라서(브루저는 offense/utility/defense) 같은 역할이
 * 화면마다 다른 색이 된다. affinity 를 축으로 두면 스트라이커 3색이 그대로 보존되고
 * (firepower→offense 주황 · survival→defense 청록 · mobility→utility 연두) 신규 타입도
 * 자동으로 같은 규칙을 따른다.
 *
 * DOM 판 연구소(`src/ui/researchLab.ts`)는 같은 색의 문자열 표기를 따로 갖는다(CSS 라 형식이
 * 다르다) — 값이 갈리면 같은 계열이 두 화면에서 다른 색이 되므로 함께 고칠 것.
 */
export const AFFINITY_ACCENT: Readonly<Record<TreeAffinity, number>> = {
  offense: 0xff7a4c,
  defense: 0x4cd7ff,
  utility: 0x8fd94c,
};

/** 카탈로그(영어 정본)에 이 키가 실재하는가. 순수. */
export function hasMessageKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(CATALOG.en, key);
}

/**
 * slug → 사람이 읽을 수 있는 자리표시자(`arccaster` → `Arccaster`, `max_hp` → `Max Hp`).
 * 번역이 아니라 **키 누락을 덜 흉하게 만드는 임시값**이다. 순수.
 */
export function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * 등재됐으면 카탈로그 문자열, 아니면 자리표시자. **키를 화면에 노출하지 않는 유일한 자리.**
 */
export function tShipKey(key: string, fallback: string, params?: TParams): string {
  return hasMessageKey(key) ? t(key as MessageKey, params) : fallback;
}

/** 기체 표시명. 키 = `ship.<slug>.name`. */
export function shipTypeName(def: ShipTypeDef): string {
  return tShipKey(`ship.${def.slug}.name`, humanizeSlug(def.slug));
}

/** 기체 한 줄 소개(로스터 행 부제). 키 = `ship.<slug>.role`. 없으면 빈 문자열. */
export function shipTypeRole(def: ShipTypeDef): string {
  return tShipKey(`ship.${def.slug}.role`, '');
}

/** 시그니처 패시브 설명. 키 = `ship.<slug>.signature`. 시그니처 없는 타입(스트라이커)은 빈 문자열. */
export function shipSignatureDesc(def: ShipTypeDef): string {
  if (def.signatureBit < 0) return '';
  return tShipKey(`ship.${def.slug}.signature`, '');
}

/** 계열 표시명. 키 = `lab.tree.<slug>` — 스트라이커 3계열은 기존 키가 그대로 맞는다. */
export function shipTreeName(tree: ShipTreeDef): string {
  return tShipKey(`lab.tree.${tree.slug}`, humanizeSlug(tree.slug));
}
