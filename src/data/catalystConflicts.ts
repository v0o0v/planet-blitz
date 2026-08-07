/**
 * 촉매 간 **축소 충돌** 판정표 — 픽커 **노랑 경고**의 유일 정본(ADR-0052 §축소 작동 규율).
 *
 * ## 회색과 노랑은 다른 것이다
 * 헌장 §축소 작동 규율이 경고를 둘로 갈랐다:
 *  - **회색 = 이 행성에서 무효**(구조적). 소유자는 `catalysts.ts` 의 `voidOnModes` 다.
 *    이 파일은 **거기에 손대지 않는다** — 행성 무효는 카드↔행성 관계이고, 여기는 카드↔카드다.
 *  - **노랑 = 촉매 간 충돌**(축소 작동). 이 파일이 소유한다.
 *
 * ## 무엇이 노랑인가 (판정 기준 — 항목을 늘리기 전에 이것부터 통과시켜라)
 * > **두 장(또는 카드×공명)이 같은 축을 반대 방향으로 써서 한쪽이 다른 쪽의 이득이나 대가를
 * > 실제로 깎을 때만** 노랑이다.
 *
 * "둘 다 좋다/나쁘다"는 노랑이 아니다. **증폭**(한쪽이 다른 쪽을 더 아프게 만든다)도 노랑이
 * 아니다 — 그것은 선택의 무게이지 축소가 아니다. 채택 기준을 두 갈래로 못 박았고, 둘 중
 * 하나도 못 대면 넣지 않았다:
 *  - **(a) 설계 정본이 그 쌍을 이름으로 지목한다** — 카드의 `창발 메모`·공명 전수 대조표.
 *  - **(b) 두 카드의 규칙문이 같은 구체적 양을 반대로 쓰거나, 한쪽의 규칙문이 다른 쪽 규칙문의
 *    발동 조건을 지운다.** 감시 대상 필드(헌장 §공유 필드 시험: `iframes` · `maxHp` ·
 *    `bullet.pierce` · `playerSpeed` · `bullet.radius` · 적 `aux0`)가 1차 스캐너다.
 *    ⚠️ **sim 내부 구현을 추측해서 만든 관계는 넣지 않았다** — 근거는 항상 규칙문이다.
 *
 * ## ⚠️ 이것은 경고일 뿐이다
 * 헌장: *"무효화는 픽커에서 사전 경고로만 존재하고, 런 안에서는 반드시 축소된 형태로라도
 * 작동해야 한다."* sim 은 이 표를 근거로 카드를 **끄지 않는다**. 문구도 "무효"가 아니라
 * **축소**로 쓴다(i18n `catalyst.warn.reason.*`).
 *
 * ## 왜 별도 리프인가
 * sim·UI·테스트가 **같은 표**를 읽어야 화면과 규칙이 갈리지 않는다(이 저장소는 같은 술어를
 * 세 곳에 적어 갈린 사고를 이미 겪었다). 순수 leaf 로 두고 sim 을 import 하지 않는다.
 * `catalystResonance.ts` 에서 가져오는 것은 **타입 하나뿐**이라 런타임 의존이 없다 — 발동한
 * 공명은 호출자가 `resolveResonance()` 로 구해서 넘긴다(판정 정본이 둘로 갈리지 않게).
 *
 * 근거 문서: `.omc/plans/catalyst-rebuild-2026-08-06/{charter,catalog-common,catalog-signature}.md`.
 * 항목마다 **왜 축소되는가 한 줄 + 근거 위치**를 달았다. 사유 없는 항목은 넣지 않는다.
 */

import { catalystById, type CatalystTag } from './catalysts.js';
import type { ResonanceTier } from './catalystResonance.js';

/**
 * 축소의 **결** — 표시 문구(i18n `catalyst.warn.reason.<이 값>`)와 1:1 이다.
 * 새 결을 늘리면 i18n 두 카탈로그를 같이 늘려야 한다(`tests/catalystConflicts.test.ts` 가 강제).
 */
export type CatalystConflictReason =
  /** 같은 축(감시 대상 필드)을 반대 방향으로 쓴다. */
  | 'sharedField'
  /** 선택하는 행위 자체가 사라져 상대의 이득이 줄어든다. */
  | 'choice'
  /** 같은 재료(바닥 전리품 등)를 다툰다. */
  | 'material'
  /** 머무를 자리를 잃어 한자리 유지형이 성립하지 않는다. */
  | 'ground'
  /** 자동 조준이 나뉘어 둘 다 늦어진다. */
  | 'aim'
  /** 한쪽의 효과가 다른 쪽의 발동 조건을 지운다. */
  | 'precondition'
  /** 처리 순서가 정해져 있어 한쪽이 먼저 먹는다. */
  | 'priority'
  /** 이득이 겹쳐 한쪽이 묻힌다. */
  | 'overlap';

/** 카드 ↔ 카드. `a < b` 로 정규화해 둔다(순서 무관 중복을 테스트가 잡는다). */
export interface CatalystCardConflict {
  readonly a: number;
  readonly b: number;
  readonly reason: CatalystConflictReason;
}

/** 카드 ↔ 공명. 공명은 **태그 + 단**으로 식별한다(`RESONANCES` 의 키와 같은 축). */
export interface CatalystResonanceConflict {
  readonly id: number;
  readonly tag: CatalystTag;
  readonly tier: ResonanceTier;
  readonly reason: CatalystConflictReason;
}

// ---------------------------------------------------------------------------
// 카드 ↔ 카드
// ---------------------------------------------------------------------------

/**
 * 근거 표기: `[common:NNN]` = `catalog-common.md` 줄, `[sig:NNN]` = `catalog-signature.md` 줄,
 * `[charter:NNN]` = `charter.md` 줄.
 */
export const CATALYST_CARD_CONFLICTS: readonly CatalystCardConflict[] = [
  // ── 11 tutelage(3택 자동 확정) ↔ 3택을 쓰는 카드 넷 ──────────────────────
  // 헌장이 초판 `ascendant` 를 *"한 장이 다른 여러 장을 무효화한다"* 로 기각했고[charter:215],
  // 현행 `id 11` 은 레벨업 자체를 남겨 넷이 **축소되되 살아 있다**[common:200-202] — 정확히
  // 노랑의 정의다. 넷은 정본이 이름으로 지목한 목록 그대로다.
  //
  // 정련 선택지가 3택 자리에 뜨는데 고를 수가 없다 — 정련로에 넣는 결정이 사라진다.
  // [common:99-112, 191-202]
  { a: 5, b: 11, reason: 'choice' },
  // "3택이 1택이 되고 거부할 수 없다"가 규칙의 본체인데, 3택 자체가 이미 사라져 있다.
  // [common:160-171, 200]
  { a: 9, b: 11, reason: 'choice' },
  // 같은 파워업 셋 중 하나를 **고르면** 3중첩인데, 고르는 행위가 없어진다. [common:236-247, 200]
  { a: 11, b: 14, reason: 'choice' },
  // 빚 카드를 "지금 받을지"가 이 카드의 선택 구조다 — 자동 확정이 그 판단을 삼킨다.
  // [common:303-321, 200]
  { a: 11, b: 18, reason: 'choice' },

  // ── 바닥 전리품을 재료로 쓰는 카드끼리 ───────────────────────────────────
  // 정본이 이름으로 지목: *"`refinement` 와 재료를 다툰다. 우선순위를 구현 레인에서 명시해야
  // 한다."* — 같은 전리품을 한쪽은 융합(매직 하나)으로, 한쪽은 정련로로 가져간다. [common:158]
  { a: 5, b: 8, reason: 'material' },
  // 레벨업마다 바닥 전리품이 **전부 폭발해 등급이 한 단계 내려간 채 회수**되므로[common:81-88],
  // "노말 셋이 바닥에서 가까이 있으면 융합"의 재료가 바닥에서 사라진다[common:146-152].
  // (b) 기준 — 한쪽 규칙문이 다른 쪽 규칙문의 발동 조건을 지운다.
  { a: 4, b: 8, reason: 'material' },

  // ── 한자리 유지형 ↔ 자리를 오염·압박하는 카드 ────────────────────────────
  // 정본이 이름으로 지목: *"`harvest`(멈춰서 캐기)처럼 한자리에 머무는 카드와는 머무를 자리가
  // 오염되어 서로를 갉는다."* 수확 지대 위에 서 있어야 관통 이득이 나오는데 그 자리가
  // 정화되지 않는 오염이 된다. [sig:280-281, common:46-59]
  { a: 2, b: 42, reason: 'ground' },

  // ── 감시 대상 필드: maxHp / iframes / playerSpeed ────────────────────────
  // `maxHp` 는 헌장이 명시한 감시 필드다[charter:196-199]. `id 12` 의 대가는 "웨이브마다
  // 최대 HP −10%" 이고 되돌릴 수단이 **대시 관통**뿐인데[common:204-206], `id 27` 이 대시
  // 쿨다운을 통째로 없애[common:452] 그 되돌림을 무제한으로 만든다 → **12 의 대가가 깎인다**.
  // 헌장 §되먹임 시험(*"페널티가 같은 슬롯의 다른 카드의 발동 조건을 충족시키면 그것은 대가가
  // 아니다"*)이 정확히 이 형태다[charter:187-189].
  { a: 12, b: 27, reason: 'sharedField' },
  // `iframes` 도 감시 필드이고, 헌장이 2판 4중 충돌을 세면서 **`id 1`(접촉 피해 무효화)** 과
  // **`id 29`(무적)** 를 같은 목록에 올렸다[charter:194]. `id 1` 은 *"부딪히는 것은 곧 접촉
  // 피해를 받는 것"* 이 유일한 대가인데[common:30-33], `id 29` 의 **대시 무적 두 배**[common:485]
  // 안에서 강탈하면 그 대가가 지워진다. 2판에서 방벽 무적이 같은 방식으로 대가를 소거한 전례를
  // `id 1` 창발 메모가 직접 기록한다[common:43-44].
  { a: 1, b: 29, reason: 'sharedField' },
  // 정본이 이름으로 지목: *"`rapidcore`(방향 유지 시 강화)와는 속도 저하가 배속을 갉는다."*
  // `playerSpeed` 도 감시 필드다[charter:198]. [sig:346, common:434-449]
  { a: 26, b: 46, reason: 'sharedField' },

  // ── 발동 조건 파괴 ───────────────────────────────────────────────────────
  // 정본이 이름으로 지목: *"`enlightenment`(적이 적을수록 탄이 커짐)와 카르곤에서 팽팽하게
  // 맞선다."* `id 30` 은 세그먼트 적 상한을 누진으로 올려[sig:42-44] `id 13` 의 이득 조건
  // ("화면의 적이 적을수록")을 정면으로 지운다[common:223-224]. [sig:58]
  { a: 13, b: 30, reason: 'precondition' },

  // ── 자동 조준 분할 ───────────────────────────────────────────────────────
  // 정본이 이름으로 지목: *"`motherlode`(적이 광석이 됨)와 겹치면 부술 것이 두 종류로 늘어
  // 조준이 계속 묶인다."* `id 19` 의 규칙문 자체가 *"부수는 동안 자동 조준이 그쪽으로 묶인다"*
  // 이고[common:324-325], `id 45` 는 블록을 세 배 단단하게 만들어 묶이는 시간을 늘린다.
  // 이 게임은 전 자동 조준이라 조준은 플레이어의 손잡이가 아니다[charter:156-160]. [sig:329-330]
  { a: 19, b: 45, reason: 'aim' },
] as const;

// ---------------------------------------------------------------------------
// 카드 ↔ 공명
// ---------------------------------------------------------------------------

/**
 * ⚠️ **공명 전수 대조표가 이미 처리한 것은 여기 없다.** `catalog-common.md` §공명 × 구성원
 * 전수 대조가 충돌 후보를 재저작으로 해소했고(점화 약↔`id 7` 밀어내기 · 밀도 약↔`id 20` 인력 ·
 * 정밀 약↔피격 축 이탈 · 수확 약↔덫 · 침식 약↔`maxHp` 이탈 · 침식 강↔`id 23` 열매 선낙하),
 * 그 행들을 다시 노랑으로 띄우면 **이미 고친 것을 경고하는** 거짓 양성이 된다[common:530-541].
 * 여기 남은 것은 ①대조표가 **해소 대신 우선순위 선언으로 끝낸 것** ②대조표가 **보지 않은
 * 비-구성원 쌍** ③5판 재태깅 이후에 생긴 쌍 셋뿐이다.
 */
export const CATALYST_RESONANCE_CONFLICTS: readonly CatalystResonanceConflict[] = [
  // ── bullet.pierce (감시 필드[charter:198]) ───────────────────────────────
  // ⚠️ **`id 2` × 밀도 강 '오폭' 은 넣지 않았다.** 관계 자체는 실재한다 — '오폭'의 대가가
  // *"네 탄은 첫 적에서 멎는다(관통 소실)"* 라[common:524] `id 2` 의 이득 본체(수확 지대 위
  // 관통[common:46-48])를 통째로 지운다. 그런데 **`SLOT_CAP = 3` 에서 구조적으로 도달
  // 불가**다: 강공명은 세 칸이 전부 그 태그여야 뜨는데 `id 2` 는 `수확·정밀` 이라 `밀도` 3장에
  // 낄 수 없다. 못 뜨는 경고를 표에 넣으면 그것이 곧 거짓 양성이다
  // (`tests/catalystConflicts.test.ts` 가 모든 항목의 도달 가능성을 강제한다).
  // 정밀 약 '벼름' 은 *"무피격 10초마다 다음 한 발이 관통한다"*[common:525]. `id 2` 의 지대
  // 위에서는 이미 전탄이 관통이므로 그 한 발이 묻히고, 대가(직후 3초 발사 저하)만 남는다.
  // ⚠️ 5판 재태깅이 `id 2` 를 `정밀` 로 옮기면서[common:51-53] 생긴 쌍이라 4판 대조표에 없다.
  { id: 2, tag: 'precision', tier: 'weak', reason: 'overlap' },

  // ── 대조표가 우선순위 선언으로 끝낸 것 ───────────────────────────────────
  // *"`id 28` 방벽이 소멸시킨 탄은 반사되지 않는다(**방벽 우선**)"*[common:525, 539].
  // 해소가 아니라 순서 선언이라 **반사의 이득은 방벽이 선 방향만큼 실제로 준다**.
  { id: 28, tag: 'precision', tier: 'strong', reason: 'priority' },

  // ── playerSpeed (감시 필드[charter:198]) ─────────────────────────────────
  // 정본이 명시: `id 39` 의 대가가 *"최대 속도가 한 단계 내려간다"* 인데 침식 약 '마모'가
  // **이동 속도를 올려** 둘이 같은 필드를 반대로 쓴다 — 그래서 `id 39` 는 `침식` 태그를 아예
  // 달지 못했다[sig:215-219]. 태그를 뺐다고 **한 런에 같이 들어오는 것까지 막히지는 않으므로**
  // (다른 두 장이 `침식` 이면 마모는 뜬다) 픽커가 경고해야 한다.
  { id: 39, tag: 'erosion', tier: 'weak', reason: 'sharedField' },
  // 같은 사유가 `id 46` 에 더 세게 걸린다 — 대가가 *"조각을 달고 있으면 그만큼 느려진다"*
  // 인데[sig:333-335] 이쪽은 **`침식` 태그를 실제로 달고 있어** 마모의 구성원이다. 즉 공명이
  // 자기 구성원의 대가를 지운다[charter:149-150]. `id 39` 검사를 받을 때 같이 걸러졌어야 했다.
  { id: 46, tag: 'erosion', tier: 'weak', reason: 'sharedField' },

  // ── 대조표가 보지 않은 비-구성원 쌍 ──────────────────────────────────────
  // 밀도 약 '인력' 은 *"같은 종류끼리 서로 끌린다"*[common:524]. `id 7` 은 광맥 보유자가
  // *"다른 적에게 둘러싸여 있는 동안 무적"* 이고 **호위가 흩어지는 순간에만** 뚫리며[common:130-131],
  // 스스로 *"적이 계속 몰려 붙는 포화 구간에서는 창이 거의 안 열린다"* 고 적는다[common:141].
  // `id 7` 은 `정밀·점화` 라 밀도 구성원이 아니어서 대조표의 심사 대상이 아니었다.
  { id: 7, tag: 'density', tier: 'weak', reason: 'precondition' },
  // 점화 약 '불씨' 는 *"처치 시 파열이 주변 적을 밀어낸다"*[common:523]. `id 20` 은
  // *"같은 종류의 적 셋이 가까이 모이면 동조"* 가 발동 조건이라[common:342] 밀어내기가 그
  // 조건을 지운다. ⚠️ `id 20` 은 `점화` 구성원인데 대조표 점화 약 행은 `id 7` 만 봤다
  // [common:534] — 밀도 약 행이 바로 그 `id 20` 의 군집 조건을 문제 삼았던 것을 보면
  // [common:535] 같은 검사를 받았어야 한다. **설계 정본이 다시 볼 자리**로 남긴다.
  { id: 20, tag: 'ignite', tier: 'weak', reason: 'precondition' },
] as const;

// ---------------------------------------------------------------------------
// 판정
// ---------------------------------------------------------------------------

/** 이 조합에서 실제로 발동한 충돌 하나. `ids` 는 관련된 카드(카드↔공명이면 한 장). */
export interface CatalystConflictHit {
  readonly kind: 'card' | 'resonance';
  /** 오름차순 정규화된 카드 id. `kind: 'card'` 면 두 장, `'resonance'` 면 한 장. */
  readonly ids: readonly number[];
  /** `kind: 'resonance'` 일 때만. 발동한 공명의 태그·단. */
  readonly resonance?: { readonly tag: CatalystTag; readonly tier: ResonanceTier };
  readonly reason: CatalystConflictReason;
}

/**
 * 지금 고른 조합에서 **실제로 발동하는** 충돌만 돌려준다(부분 선택 포함 — 1~3장 어디서나 판정).
 *
 * @param ids 고른 촉매 id. 순서·중복 무관(들어 있는지만 본다).
 * @param resonance 이 조합에서 **실제로 발동한** 공명(없으면 null). 호출자가
 *   `resolveResonance(ids)` 로 구해 넘긴다 — 한 런에 공명은 최대 하나라, 여기서 따로 세면
 *   "조건은 맞지만 우선순위에 밀려 안 뜬 공명"까지 경고하는 거짓 양성이 된다.
 *
 * 순서는 선언 순서 그대로다(카드↔카드 → 카드↔공명). 조합을 한 장 넣고 뺄 때마다 읽는 자리가
 * 바뀌면 안 되므로 정렬로 뒤섞지 않는다.
 */
export function catalystConflicts(
  ids: readonly number[],
  resonance: { readonly tag: CatalystTag; readonly tier: ResonanceTier } | null,
): readonly CatalystConflictHit[] {
  const present = new Set<number>();
  for (const id of ids) {
    if (catalystById(id) !== undefined) present.add(id);
  }

  const hits: CatalystConflictHit[] = [];
  for (const c of CATALYST_CARD_CONFLICTS) {
    if (present.has(c.a) && present.has(c.b)) {
      hits.push({ kind: 'card', ids: [c.a, c.b], reason: c.reason });
    }
  }
  if (resonance !== null) {
    for (const c of CATALYST_RESONANCE_CONFLICTS) {
      if (c.tag !== resonance.tag || c.tier !== resonance.tier) continue;
      if (!present.has(c.id)) continue;
      hits.push({
        kind: 'resonance',
        ids: [c.id],
        resonance: { tag: c.tag, tier: c.tier },
        reason: c.reason,
      });
    }
  }
  return hits;
}
