/**
 * 장비 요구 레벨(reqLevel) 파생 — 순수·결정론·서버 재도출 가능 (ADR-0030).
 *
 * `requiredLevel(item)` 은 아이템에서만 요구 레벨을 도출한다. RNG·시간·sim 상태에
 * 의존하지 않으므로 같은 아이템은 언제·어디서(클라/EF) 계산해도 같은 값을 낸다. 노말·
 * 매직·레어는 `itemCombatPower`(수호 스냅샷·소멸에도 쓰이는 함수)와 **분리된 독립 상수
 * 테이블**(등급 바닥 + 어픽스 개수 × 가산)에서, 유니크는 `UniqueDef.reqLevel` 개별 저작값
 * 에서 파생한다. 그리고 **드랍처(`item.source` 의 침략 단계) 상한**으로 낮춘다 — 그 단계를
 * 도는 조종사가 영영 못 입는 전리품이 나오지 않게 한다({@link stageLevelCap} 주석 참조).
 * 게이트는 클라 착용 시점에서만 `canEquip` 로 강제하며 sim·상태 해시·세이브
 * 스키마는 불변이다(부적격 아이템은 sim 에 진입하지 않는다).
 *
 * ⚠️ 결정론 경계: 이 모듈은 `src/sim/*`(math.ts 포함)·`loadout.ts`·`combatPower.ts` 의
 * **값**을 import 하지 않는다(타입만 허용). `clampInt` 도 sim/math 에서 가져오지 않고 아래
 * 로컬 인라인으로 정의한다 — reqLevel 산식이 sim/loadout 튜닝과 커플링되지 않게 한다.
 *
 * ⚠️ 유니크의 reqLevel 은 `UNIQUE_REGISTRY` 가 채워져 있어야 조회된다. 클라에서는 아이템
 * 레이어(`loadout.ts`·`roll.ts`)가 `data/uniques.ts` 를 side-effect import 해 부팅 시 이미
 * 15종이 등록돼 있다. 향후 EF 서버 검증(ADR-0028)이 유니크 reqLevel 을 재도출하려면
 * `data/uniques.js` 를 import 해 레지스트리를 먼저 채워야 한다 — 그러지 않으면 미등록으로
 * `requiredLevel` 이 LOUD-FAIL(throw) 한다.
 */

import type { Item, ItemSource, Rarity } from './types.js';
import { UNIQUE_REGISTRY } from './uniques.js';
import { LEVEL_CAP } from '../../data/waves.js';

/**
 * 등급별 요구 레벨 상수 테이블(유니크 제외). `floor` = 등급 바닥, `per` = 어픽스 1개당 가산.
 * `itemCombatPower` 와 공유하지 않는 독립 상수 체계다.
 */
const REQ_TABLE: Record<Exclude<Rarity, 'unique'>, { floor: number; per: number }> = {
  normal: { floor: 1, per: 0 },
  magic: { floor: 10, per: 2 },
  rare: { floor: 32, per: 3 },
}; // TODO(밸런스): 출시 전 튜닝

/**
 * 침략 단계 1당 기대 기체 레벨(드랍처 상한 기울기). 단계 20 에서 만렙에 닿는다.
 * TODO(밸런스): 출시 전 튜닝 — 성장 곡선(xpToNext)과 함께 실측으로 맞춘다.
 */
const LEVEL_PER_STAGE = 5;

/** 정수 클램프(로컬 인라인 — sim/math 미의존). 반올림 후 [lo, hi] 로 제한. */
const clampInt = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, Math.round(v)));

/**
 * 드랍처(침략 단계)에서 기대되는 **기체 레벨 상한**. 아이템 요구 레벨의 천장이다.
 *
 * ⚠️ 행성 index 는 난이도 사다리가 아니다 — 6행성은 모드 성격(뱀서류·수축·추격·레이싱·오염·
 * 블록격파)이 다를 뿐이고 아르케(3)는 보스 설계도 고정 행성일 뿐 더 깊은 층이 아니다
 * (`data/planets/index.ts` BOSS_BLUEPRINT_PLANET 주석). 그래서 상한은 **단계 축에서만**
 * 파생한다. 행성을 난이도 축으로 쓰면 모드 취향이 곧 장비 제한이 되어 잘못된 압력이 걸린다.
 *
 * 단계가 유한수가 아니면(구 세이브·손으로 빚은 Item 등) 상한을 걸지 않는다(= LEVEL_CAP) —
 * 알 수 없는 출처를 과도하게 잠그느니 구 거동을 보존한다.
 */
export function stageLevelCap(source: ItemSource | undefined): number {
  const stage = source?.stage;
  if (typeof stage !== 'number' || !Number.isFinite(stage)) return LEVEL_CAP;
  return clampInt(LEVEL_PER_STAGE * stage, 1, LEVEL_CAP);
}

/**
 * 아이템의 요구 레벨(정수 [1,100]). 유니크는 `UniqueDef.reqLevel` 저작값, 그 외는 상수 테이블.
 * 두 경우 모두 **드랍처 상한**({@link stageLevelCap})으로 낮춘다.
 *
 * ── 왜 드랍처 상한인가 ── 등급·어픽스만으로 요구 레벨을 정하면 1단계 정예가 떨군 레어가
 * 요구 41 이 되어, 그 단계를 도는 Lv5 조종사에게는 **영영 못 입는 전리품**이 된다(사용자 신고
 * 2026-07-27). 상한을 걸면 "내가 딴 곳의 전리품은 그 단계를 도는 동안 입게 된다"가 성립하고,
 * 상한이 등급 산식을 넘어서는 후반 단계에서는 기존 등급 서열이 그대로 살아난다(예: 11단계
 * 상한 55 — rare 41~50·magic 10~14 는 손대지 않는다).
 *
 * 순수성은 유지된다: `item.source` 는 롤 시점에 아이템에 박히는 저장 필드라 같은 아이템은
 * 언제·어디서 계산해도 같은 값을 낸다(서버 재도출 가능).
 *
 * 유니크가 레지스트리에 없거나 reqLevel 이 유효 숫자가 아니면 **LOUD-FAIL**(throw) 한다 —
 * 미저작 유니크가 rare 산식으로 조용히 열리는 것을 막는다(AC7). rare 폴백은 절대 하지 않는다.
 */
export function requiredLevel(item: Item): number {
  const cap = stageLevelCap(item.source);
  if (item.rarity === 'unique') {
    const def = UNIQUE_REGISTRY.get(item.uniqueId ?? '');
    if (!def || !Number.isFinite(def.reqLevel)) {
      throw new Error(
        `requiredLevel: 유니크 reqLevel 미저작/미등록 (uniqueId=${JSON.stringify(item.uniqueId)}). ` +
          'data/uniques.ts 에 reqLevel 을 저작하고 레지스트리에 등록했는지 확인하라(rare 폴백 없음).',
      );
    }
    return Math.min(clampInt(def.reqLevel, 1, 100), cap);
  }
  const tbl = REQ_TABLE[item.rarity];
  return Math.min(clampInt(tbl.floor + item.affixes.length * tbl.per, 1, 100), cap);
}

/** 활성 기체 레벨이 아이템 요구 레벨 이상이면 착용 가능(순수 술어). */
export function canEquip(shipLevel: number, item: Item): boolean {
  return shipLevel >= requiredLevel(item);
}
