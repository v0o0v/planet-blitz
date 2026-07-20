/**
 * 결정론 방어체 롤러 (M7b · M7b-inventory).
 *
 * `rollDefenseUnit(...)` 는 PURE 함수다: `affixSeed` 로 로컬 `SeededRng` 를 시딩하고 모든 선택
 * (어픽스 수 → 어느 어픽스 → 각 값)을 그 스트림에서 뽑는다. 같은 입력 → 바이트 동일 방어체이며,
 * 클라이언트와 검증 EF(Deno)에서 동일하다(ADR-0005). `src/items/rollCard.ts` 와 같은 규율:
 * `Math.random`·`Date.now`·벽시계 금지, 무작위는 전부 시드 RNG 를 통한다.
 *
 * ## 왜 시드만 저장하는가
 * 배치(`defenses.layout`)에 실리는 것은 어픽스 **값**이 아니라 `affixSeed` 정수 하나다
 * (`InvasionRef`). 그래서 방어자가 조작할 수 있는 스탯 필드가 애초에 존재하지 않고, EF 는
 * 같은 시드로 같은 어픽스를 재구성해 재실행한다. 리롤 = **시드 교체**일 뿐이다.
 *
 * ## 드로우 순서(정본 — 바꾸면 스트림이 밀린다)
 *   ① 어픽스 수 → ② 어픽스 선택(무교체 추첨) → ③ 각 어픽스 값
 * 카드 롤러가 어픽스 수를 rng 에서 뽑고 이어서 어픽스를 뽑는 순서와 동일하다.
 */

import { SeededRng } from '../sim/rng.js';
import type { Rarity } from './types.js';
import {
  DEFENSE_UNIT_AFFIX_RANGE,
  defenseUnitAffixPool,
  rarityFromCode,
} from '../../data/defenseUnits.js';
import type {
  DefenseUnitAffixDef,
  DefenseUnitAffixRoll,
  DefenseUnitInstance,
  DefenseUnitStatKey,
} from '../../data/defenseUnits.js';
import type { InvasionRef } from '../sim/invasion/types.js';
import {
  INVASION_LEVEL_MIN,
  INVASION_LEVEL_MAX,
  INVASION_ASCENSION_MIN,
  INVASION_ASCENSION_MAX,
  INVASION_RARITY_COUNT,
} from '../sim/invasion/constants.js';
import { RARITY_CODE } from './types.js';

/** 정수 clamp [lo,hi]. */
function clampInt(v: number, lo: number, hi: number): number {
  const i = Math.trunc(v);
  if (i < lo) return lo;
  if (i > hi) return hi;
  return i;
}

/**
 * 등급별 방어체 어픽스 수. normal 은 0(무추첨 — rng 를 소비하지 않는다), 그 외는 범위에서 뽑는다.
 * `min === max` 인 등급(unique)도 `rng.int` 를 **호출한다** — 무추첨으로 건너뛰면 등급마다
 * 스트림 위치가 달라져 재현 규칙이 복잡해진다. 범위가 1점이면 결과는 항상 같으므로 무해하다.
 */
function affixCountFor(rarity: Rarity, rng: SeededRng): number {
  const [lo, hi] = DEFENSE_UNIT_AFFIX_RANGE[rarity];
  if (lo === 0 && hi === 0) return 0;
  return rng.int(lo, hi);
}

/**
 * 종류별 풀에서 `count` 개를 중복 없이 뽑아 값을 롤하고 접두/접미로 분류한다.
 * 무교체 추첨(작업 복사본에서 splice)이라 같은 시드는 항상 같은 어픽스 집합·순서를 낸다.
 * 풀보다 많이 요구되면 풀 크기로 잘린다(정의가 줄어도 크래시 없음).
 */
function rollAffixes(
  rng: SeededRng,
  kind: number,
  count: number,
): { prefixes: DefenseUnitAffixRoll[]; suffixes: DefenseUnitAffixRoll[] } {
  const pool: DefenseUnitAffixDef[] = [...defenseUnitAffixPool(kind)];
  const prefixes: DefenseUnitAffixRoll[] = [];
  const suffixes: DefenseUnitAffixRoll[] = [];
  const n = count < pool.length ? count : pool.length;
  for (let k = 0; k < n; k++) {
    const j = rng.int(0, pool.length - 1);
    const def = pool[j];
    pool.splice(j, 1);
    if (def === undefined) continue;
    const value = rng.int(def.min, def.max);
    const roll: DefenseUnitAffixRoll = { id: def.id, stat: def.stat, value };
    if (def.kind === 'prefix') prefixes.push(roll);
    else suffixes.push(roll);
  }
  return { prefixes, suffixes };
}

/** {@link rollDefenseUnit} 입력. 전 필드 정수(rarity 만 문자열 등급). */
export interface DefenseUnitRollInput {
  /** 카탈로그 종류 코드(CATALOG_*). */
  readonly kind: number;
  /** 종류별 카탈로그 인덱스. */
  readonly catalogId: number;
  readonly rarity: Rarity;
  /** 어픽스 롤 시드(uint32). */
  readonly affixSeed: number;
  /** 레벨(미지정 = 1). */
  readonly level?: number;
  /** 승급(미지정 = 0). */
  readonly ascension?: number;
}

/**
 * 방어체 1기를 확정한다. (`kind`, `rarity`, `affixSeed`) 에 결정론적이며 레벨·승급은 롤에
 * 영향을 주지 않는다(강화는 배율일 뿐 어픽스를 흔들지 않는다 — 레벨업 때마다 옵션이 바뀌면
 * 플레이어가 성장을 못 읽는다).
 */
export function rollDefenseUnit(input: DefenseUnitRollInput): DefenseUnitInstance {
  const seed = input.affixSeed >>> 0;
  const kind = Math.trunc(input.kind);
  const catalogId = input.catalogId < 0 ? 0 : Math.trunc(input.catalogId);
  const level = clampInt(input.level ?? INVASION_LEVEL_MIN, INVASION_LEVEL_MIN, INVASION_LEVEL_MAX);
  const ascension = clampInt(
    input.ascension ?? INVASION_ASCENSION_MIN,
    INVASION_ASCENSION_MIN,
    INVASION_ASCENSION_MAX,
  );

  const rng = new SeededRng(seed);
  const { prefixes, suffixes } = rollAffixes(rng, kind, affixCountFor(input.rarity, rng));

  return {
    id: `du-${kind}-${catalogId}-${seed}`,
    kind,
    catalogId,
    rarity: input.rarity,
    level,
    ascension,
    affixSeed: seed,
    prefixes,
    suffixes,
  };
}

/**
 * 리롤용 다음 어픽스 시드(결정론). 서버가 이 함수로 시드를 굴리면 클라도 결과를 미리 재현할 수
 * 있고, 시드가 재사용되지 않는다(같은 시드로 리롤하면 같은 옵션이 나와 광물만 태운다).
 */
export function nextAffixSeed(prevSeed: number): number {
  return new SeededRng(prevSeed >>> 0).nextU32();
}

/**
 * 방어체 어픽스 리롤. **시드만 교체**하고 나머지(종류·카탈로그·등급·레벨·승급)는 보존한다.
 * 순수 — 입력 인스턴스를 변형하지 않는다(새 객체 반환).
 */
export function rerollDefenseUnitAffixes(
  unit: DefenseUnitInstance,
  newSeed: number,
): DefenseUnitInstance {
  return rollDefenseUnit({
    kind: unit.kind,
    catalogId: unit.catalogId,
    rarity: unit.rarity,
    affixSeed: newSeed,
    level: unit.level,
    ascension: unit.ascension,
  });
}

/**
 * 등급 승급된 방어체(설계도 경로). 등급이 오르면 어픽스 수 범위가 넓어지므로 **새 시드로 재롤**한다
 * (승급인데 옵션이 그대로면 승급의 의미가 없다). 순수 — 입력을 변형하지 않는다.
 */
export function promoteDefenseUnitRarity(
  unit: DefenseUnitInstance,
  nextRarity: Rarity,
  newSeed: number,
): DefenseUnitInstance {
  return rollDefenseUnit({
    kind: unit.kind,
    catalogId: unit.catalogId,
    rarity: nextRarity,
    affixSeed: newSeed,
    level: unit.level,
    ascension: unit.ascension,
  });
}

/**
 * 보유 방어체 → 배치 참조(`InvasionRef`). **메타와 sim 의 유일한 접점**이며, 여기서 나온 5필드가
 * 그대로 `defenses.layout` jsonb 에 실린다. 전 필드 정수·클램프 완료라 정규화가 다시 손댈 것이 없다.
 */
export function toInvasionRef(unit: DefenseUnitInstance): InvasionRef {
  return {
    catalogId: unit.catalogId < 0 ? 0 : Math.trunc(unit.catalogId),
    level: clampInt(unit.level, INVASION_LEVEL_MIN, INVASION_LEVEL_MAX),
    ascension: clampInt(unit.ascension, INVASION_ASCENSION_MIN, INVASION_ASCENSION_MAX),
    affixSeed: unit.affixSeed >>> 0,
    rarity: clampInt(RARITY_CODE[unit.rarity], 0, INVASION_RARITY_COUNT - 1),
  };
}

/**
 * 배치 참조 → 보유 방어체 재구성(EF·프리뷰용). `InvasionRef` 만으로 어픽스까지 완전히 복원된다 —
 * 이것이 "시드만 저장한다" 설계의 회수 지점이다.
 */
export function defenseUnitFromRef(kind: number, ref: InvasionRef): DefenseUnitInstance {
  return rollDefenseUnit({
    kind,
    catalogId: ref.catalogId,
    rarity: rarityFromCode(ref.rarity),
    affixSeed: ref.affixSeed,
    level: ref.level,
    ascension: ref.ascension,
  });
}

/**
 * 특정 stat 의 어픽스 합계(정수). 접두(상시)와 접미(조건부)를 **분리해서** 돌려준다 —
 * 조건부를 상시와 합쳐 표기하면 플레이어가 항상 그 수치가 실린다고 오독한다.
 */
export function affixTotals(
  unit: DefenseUnitInstance,
  stat: DefenseUnitStatKey,
): { always: number; conditional: number } {
  let always = 0;
  let conditional = 0;
  for (const r of unit.prefixes) if (r.stat === stat) always += r.value;
  for (const r of unit.suffixes) if (r.stat === stat) conditional += r.value;
  return { always, conditional };
}

/** 어픽스 총 개수(리롤 비용 계산 입력). */
export function affixCount(unit: DefenseUnitInstance): number {
  return unit.prefixes.length + unit.suffixes.length;
}
