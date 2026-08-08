/**
 * 태그 공명 — **2단**(같은 태그 2장 = 약공명 / 3장 = 강공명), ADR-0052 §태그 & 공명.
 *
 * ## 왜 `data/` 리프인가
 * 공명은 **거동을 바꾼다** — 그래서 sim(`src/sim/catalystHooks.ts`)과 검증 EF
 * (`supabase/functions/verify-*`)가 **같은 테이블을 읽어야** 재실행이 갈리지 않는다
 * (설계 감사표 §미해결 5). 순수 리프라 런타임 import 가 `catalysts.ts` 하나뿐이고
 * `world.ts` 와 순환이 구조적으로 생기지 않는다.
 *
 * ## 규칙 (전부 ADR-0052 §공명이 확정한 것 — 여기서 바꾸지 않는다)
 *  1. **한 런에 발동하는 공명은 최대 하나다**(2026-08-06 사용자 결정). 3판은 이 규정이 없어
 *     3장으로 약공명 셋이 동시에 떴고, 대가 없는 보너스 셋이 서로의 대가를 지워 새 지배
 *     조합을 만들었다. 상한 검산·픽커 표시도 이 규정 위에서만 성립한다.
 *  2. **강공명 우선.** 약공명은 강공명의 하위 호환이라 3장이면 흡수된다.
 *  3. 동급이면 **태그 우선순위**(`점화 > 밀도 > 정밀 > 수확 > 도박 > 침식`,
 *     {@link CATALYST_TAG_PRIORITY}).
 *  4. **공명도 규칙이다** — 순수 배율 금지, `신호:`·`상한:` 필수. 약공명은 대가가 **없는 것이
 *     아니라 작다**(런의 승패를 가르지 않는 수준). 대가가 아예 없으면 "안 켜면 손해"인 세금이
 *     되고 그것은 ADR-0029 가 *"위험 없는 버프는 결정이 아니라 세금"* 으로 이미 기각한 형태다.
 *  5. **공명 상한도 자기 축의 합에 든다**({@link file://./catalysts.ts} 의 `axisCapMult`).
 *
 * ## 규칙문·신호는 여기 없다
 * 정본은 `.omc/plans/catalyst-rebuild-2026-08-06/catalog-common.md` §공명 표이고, 표시
 * 문자열은 i18n `catalyst.resonance.<slug>.*` 다. 이 파일은 **기계가 읽어야 하는 칸**만 미러한다.
 */

import {
  CAP_ALL_AXIS_FACTOR,
  CAP_COMPOSE_FACTOR,
  CATALYST_CAP_AXES,
  CATALYST_TAG_PRIORITY,
  axisCapMult,
  catalystById,
  normalizeCatalystArray,
  type CatalystCapAxis,
  type CatalystHookGrade,
  type CatalystTag,
} from './catalysts.js';

/** 약(2장) / 강(3장). */
export type ResonanceTier = 'weak' | 'strong';

/** 약공명 발동 장수. */
export const RESONANCE_WEAK_COUNT = 2;
/** 강공명 발동 장수. */
export const RESONANCE_STRONG_COUNT = 3;

/**
 * 약공명 상한의 하드 천장(§공명 — "약공명은 대가가 없는 대신 상한도 낮다").
 * `tests/catalystResonance.test.ts` 가 강제한다.
 */
export const MAX_WEAK_RESONANCE_CAP = 1.3;

export interface ResonanceDef {
  readonly tag: CatalystTag;
  readonly tier: ResonanceTier;
  /** 안정 문자열 키. i18n `catalyst.resonance.<slug>.*` 앵커. */
  readonly slug: string;
  readonly cap: { readonly axis: CatalystCapAxis; readonly mult: number };
  /** 훅 예산 등급 — **공명도 예산에 든다**(예산 밖에 두면 회계가 아니다). */
  readonly hook: CatalystHookGrade;
  /**
   * **이 행성에서 구조적으로 무효**인 경우의 행성 인덱스 목록 — `CatalystDef.voidOnPlanets` 의
   * 공명 짝이고 **완전히 같은 축**(`config.planet` = 0..5)이다.
   *
   * ## 왜 필요한가 (2026-08-08)
   * 헌장 §축소 작동 규율이 *"무효화는 픽커에서 사전 경고로만 존재한다(회색 = 이 행성에서
   * 무효)"* 를 의무로 세웠는데, 이 칸이 없던 동안 **공명은 그 고지를 낼 수단이 아예 없었다**.
   * 그 사이 사용자 판정(2026-08-08)이 «침식 강 '함몰' × 니플헤임 진행 교착 → 니플헤임
   * 미발동»을 확정했고, 고지가 없으면 플레이어가 침식 3장을 바치고 **아무 일도 안 일어나는
   * 것을 본다**.
   *
   * ## ⚠️ 이 칸이 sim 게이트의 **유일 정본**이다
   * `sim/catalyst/resonance.ts` 의 `subsidenceActive` 가 종전에는 자기 파일의 지역 상수로
   * 판정했다 — 픽커가 낼 답과 sim 이 낼 답이 **두 곳에 따로** 적혀 있었다는 뜻이고, 이 저장소가
   * 이미 겪은 *"같은 술어를 여러 곳에 적어 화면과 규칙이 갈린"* 형태다. 이제 그 함수가
   * {@link resonanceVoidOnPlanet} 을 부른다.
   *
   * ⚠️ 서버 미러(`catalyst_resonances`)에는 **없는 칸**이다 — 픽커 경고와 sim 게이트는 클라
   * 축이고 서버가 계산하는 것은 상한·영수증뿐이라 읽을 소비자가 없다. 미러 계약 테스트도 열
   * 단위 대조라 여기 칸을 늘려도 갈리지 않는다.
   */
  readonly voidOnPlanets?: readonly number[];
}

/** 베르단(1) — 안전 원과 **이중 수축**이라 함몰이 겹치면 진행이 막힌다. */
const PLANET_BERDAN = 1;
/**
 * 니플헤임(2) — 마지막 일반 세그먼트가 대피소 **전량 확보**를 요구하는데(`chase.ts`) 반경이
 * 줄면 바깥 대피소에 물리적으로 못 닿아 런이 승리도 패배도 아닌 상태로 멈춘다
 * (헌장 §페널티 4 진행 교착). 베르단 선례를 확장한 **사용자 판정(2026-08-08)** 이다.
 */
const PLANET_NIFLHEIM = 2;

/**
 * 공명 12종. 태그 6 × 2단.
 *
 * ⚠️ `hook` 칸은 설계 감사표 `audit.md` §**훅 예산 재집계**(5판)를 따른다 — 같은 문서의
 * 공명 표 훅 열은 4·5판 강등을 반영하지 않은 **갱신 누락**이다(`밀도 강`·`도박 강`·`침식 강`
 * 셋은 §강등 3종 실행 완료로 §A 가 됐고, `점화 약` 은 §4판에서 올라간 둘로 §B 가 됐다).
 * 재집계 기준 §B 는 `점화 약`·`정밀 강` **둘**이고, 그래야 전체 §B 가 14 로 예산과 맞는다.
 */
export const RESONANCES: readonly ResonanceDef[] = [
  // 점화 — 하나가 터지면 옆이 터진다
  // 약 · 불씨: 처치 시 파열이 주변 적을 밀어낸다. 밀려난 적은 1초간 받는 피해가 준다.
  { tag: 'ignite', tier: 'weak', slug: 'ember', cap: { axis: 'drop', mult: 1.2 }, hook: 'B' },
  // 강 · 되울림: 처치가 연쇄한다. 사슬의 마지막 하나는 너를 친다.
  { tag: 'ignite', tier: 'strong', slug: 'reverberation', cap: { axis: 'resource', mult: 2.0 }, hook: 'A' },

  // 밀도 — 많아질수록 벌이가 커진다
  // 약 · 인력: 적 15 이상이면 같은 종류끼리 끌린다. 뭉친 적은 방어력을 나눠 단단해진다.
  { tag: 'density', tier: 'weak', slug: 'attraction', cap: { axis: 'drop', mult: 1.2 }, hook: 'A' },
  // 강 · 오폭: 적의 탄이 적에게도 맞는다. 네 탄은 첫 적에서 멎는다.
  { tag: 'density', tier: 'strong', slug: 'crossfire', cap: { axis: 'drop', mult: 1.5 }, hook: 'A' },

  // 정밀 — 안 맞는 것이 곧 이득이다
  // 약 · 벼름: 무피격 10초마다 다음 한 발이 관통한다. 그 직후 3초간 발사가 느려진다.
  { tag: 'precision', tier: 'weak', slug: 'whetting', cap: { axis: 'drop', mult: 1.2 }, hook: 'A' },
  // 강 · 반사: 적탄 일부가 튕겨 다른 적을 맞힌다. 안 튕긴 탄은 피해가 두 배다.
  { tag: 'precision', tier: 'strong', slug: 'deflection', cap: { axis: 'drop', mult: 1.5 }, hook: 'B' },

  // 수확 — 줍는 방식 자체가 바뀐다
  // 약 · 덫: 바닥 전리품을 적이 밟으면 1초간 붙잡힌다. 그동안 회수할 수 없다.
  { tag: 'harvest', tier: 'weak', slug: 'snare', cap: { axis: 'drop', mult: 1.2 }, hook: 'A' },
  // 강 · 결실: 전리품 위에서 죽은 적은 그 등급을 올린다. 적이 밟으면 내려간다.
  { tag: 'harvest', tier: 'strong', slug: 'fruition', cap: { axis: 'rarity', mult: 1.8 }, hook: 'A' },

  // 도박 — 지금 이득을 미래에 건다
  // 약 · 선불: 런 시작 시 전리품 하나를 미리 받는다. 지면 그것도 잃는다.
  { tag: 'gamble', tier: 'weak', slug: 'advance', cap: { axis: 'drop', mult: 1.3 }, hook: 'A' },
  // 강 · 청산: 첫 전리품이 봉인된다. 보스를 잡으면 최고 등급, 지면 그것만 사라진다.
  { tag: 'gamble', tier: 'strong', slug: 'settlement', cap: { axis: 'rarity', mult: 2.0 }, hook: 'A' },

  // 침식 — 가만히 있으면 잃는다
  // 약 · 마모: 30초마다 이동 속도가 오르고 피격 반경이 커진다(웨이브 전환 시 복구).
  { tag: 'erosion', tier: 'weak', slug: 'abrasion', cap: { axis: 'drop', mult: 1.2 }, hook: 'A' },
  // 강 · 함몰: 30초마다 가장자리부터 무너져 반경이 줄고 드랍 밀도가 오른다. 격전 통과 시 절반 복구.
  { tag: 'erosion', tier: 'strong', slug: 'subsidence', cap: { axis: 'drop', mult: 2.0 }, hook: 'A', voidOnPlanets: [PLANET_BERDAN, PLANET_NIFLHEIM] },
] as const;

const BY_KEY: ReadonlyMap<string, ResonanceDef> = new Map(
  RESONANCES.map((r) => [`${r.tag}:${r.tier}`, r]),
);

/**
 * 이 **행성**에서 그 공명이 구조적으로 무효인가 — `catalystVoidOnPlanet` 의 공명 짝이고
 * **같은 인자·같은 축**(행성 인덱스 `config.planet`)을 받는다.
 *
 * 소비자는 둘뿐이고 **둘 다 이 함수를 통해야 한다**: 픽커의 회색 경고 줄과 sim 의
 * `subsidenceActive`. 어느 한쪽이 따로 판정하면 «픽커는 뜬다는데 sim 은 안 돌린다»(또는 반대)가
 * 조용히 생긴다.
 */
export function resonanceVoidOnPlanet(def: ResonanceDef, planet: number): boolean {
  return def.voidOnPlanets?.includes(planet) ?? false;
}

/** 태그·단으로 공명을 얻는다. 12종이 전부 있으므로 미지 조합은 undefined 가 아니라 버그다. */
export function resonanceOf(tag: CatalystTag, tier: ResonanceTier): ResonanceDef | undefined {
  return BY_KEY.get(`${tag}:${tier}`);
}

/**
 * 주입 조합의 **태그별 장수**. 한 촉매가 태그 2개를 달면 두 태그 모두에 1씩 센다.
 * 중복 id 는 {@link normalizeCatalystArray} 가 접으므로 같은 카드가 두 번 세어지지 않는다.
 */
export function tagCounts(ids: readonly number[]): ReadonlyMap<CatalystTag, number> {
  const counts = new Map<CatalystTag, number>();
  for (const id of normalizeCatalystArray(ids)) {
    const def = catalystById(id);
    if (def === undefined) continue;
    for (const tag of def.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
}

/**
 * 이 조합에서 **실제로 발동하는 공명 하나**를 정한다. 없으면 null.
 *
 * 강공명 우선 → 동급이면 {@link CATALYST_TAG_PRIORITY} 순. 이 함수가 **유일 정본**이다 —
 * sim·EF·픽커·상한 검산 스크립트가 전부 여기를 부른다. 네 곳이 각자 판정하면 갈린다.
 */
export function resolveResonance(ids: readonly number[]): ResonanceDef | null {
  const counts = tagCounts(ids);
  for (const tier of ['strong', 'weak'] as const) {
    const need = tier === 'strong' ? RESONANCE_STRONG_COUNT : RESONANCE_WEAK_COUNT;
    for (const tag of CATALYST_TAG_PRIORITY) {
      if ((counts.get(tag) ?? 0) >= need) return resonanceOf(tag, tier) ?? null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 상한 합성 — **공명을 포함한 유일 정본**
// ---------------------------------------------------------------------------

/**
 * 축별 총상한, **공명 발동분 포함**. 정산·서버 미러·상한 검산이 전부 이것을 써야 한다.
 *
 * ## ⚠️ 왜 `catalysts.ts` 의 {@link axisCapMult} 를 직접 쓰면 안 되는가
 * 그쪽은 **촉매 3장분만** 센다 — 헌장이 *"강공명·약공명도 자기 축의 합에 든다"* 고 못 박았으므로
 * 그것만 쓰면 **공명이 자원축인 조합에서 상한을 과소평가**하고, 서버 영수증(공명을 포함한다)과
 * 클라 표시가 갈린다. 실제로 이 저장소는 **같은 술어를 여러 곳에 적어 화면과 규칙이 갈린**
 * 사고를 이미 겪었다.
 *
 * `catalysts.ts` 가 공명을 못 세는 것은 게으름이 아니라 **모듈 방향** 때문이다 — 이 파일이
 * `catalysts.ts` 를 import 하므로 반대 방향은 순환이다. 그래서 **합성의 최종 정본은 여기**이고,
 * 저쪽 함수는 그 부분합이다.
 */
export function axisCapMultWithResonance(
  ids: readonly number[],
  axis: CatalystCapAxis,
): number {
  const base = axisCapMult(ids, axis);
  const r = resolveResonance(ids);
  if (r === null || r.cap.axis !== axis) return base;
  return base + (r.cap.mult - 1) * CAP_COMPOSE_FACTOR;
}

/**
 * 자원축 총상한(공명 포함). **서버 영수증(`consume_catalysts`)이 계산하는 값의 클라 짝**이다 —
 * `catalyst_defs`·`catalyst_resonances` 미러와 이 함수가 같은 답을 내야 한다.
 */
export function resourceCapMultWithResonance(ids: readonly number[]): number {
  return axisCapMultWithResonance(ids, 'resource');
}

/** 전축 상한(공명 포함) = `max(축별 총상한) × CAP_ALL_AXIS_FACTOR`. 정산 총액의 단일 유계. */
export function allAxisCapMultWithResonance(ids: readonly number[]): number {
  let max = 1;
  for (const axis of CATALYST_CAP_AXES) {
    const m = axisCapMultWithResonance(ids, axis);
    if (m > max) max = m;
  }
  return max * CAP_ALL_AXIS_FACTOR;
}
