/**
 * **말로우 30스킬의 효과 본체**(ADR-0049 배치 4 · 설계 정본
 * `.omc/plans/skill-rebuild-2026-08-05/mallow.md` 확정 4판).
 *
 * 형태는 **스트라이커 레인이 확립한 다섯 규율을 그대로 따른다**(`skills/striker.ts` 헤더가 정본):
 * ①`world.ts` 런타임 import 0건(타입은 type-only) ②모든 쓰기는 투자 게이트 안쪽 ③반올림은
 * 게이트 안 ④RNG 소비 0 ⑤슬롯 접근은 `readSlot`/`writeSlot` 만.
 *
 * ---
 *
 * ## ⚠️ 이 배치가 배선한 것은 30종 중 **6종**이다 — 앞 세 기체(9·13·11)보다 적고, 그 이유가 구조적이다
 *
 * 말로우 30종의 설계는 시그니처 완충의 **두 분기**에 압도적으로 몰려 있는데, 그 둘 다 앵커가
 * 없다:
 *
 *  - **정산 분기**(`world.ts` 의 `stepShipSignature` 말로우 가지, `aux1 >= CUSHION_RECOVER_TICKS`
 *    안쪽) — 여기를 요구하는 스킬이 **10종**이다: 정산 틱을 트리거로 삼는 9종
 *    (SQ2·SQ5·SQ8·ME4·ME5·ME8·CU3·CU9·CU10) + 정산 **임계 자체**를 낮추는 ME9.
 *    앵커 ⑨({@link onSignatureStep})는 `stepShipSignature` **진입점**이라 이 분기보다 **앞**이다.
 *  - **지연 전환 분기**(`world.ts` 의 `cushionOn` 게이트, `cushionDeferredDamage` 분리부) —
 *    **5종**(CU1·CU2·CU5·CU6 + CU7 의 설계상 자리). 앵커 ⑧({@link onDamageChain})은 이 분기보다
 *    앞이라 "지연분을 얼마나 뗄지"에는 닿지 않는다.
 *
 * ### ⚠️ 정산 분기를 앵커 ⑨ 에서 **예측**하지 않았다 — 그것이 이 레인의 핵심 판단이다
 * 앵커 ⑨ 시점의 `aux0`·`aux1` 로 "이번 틱에 정산이 일어날 것"을 `aux0 > 0 && aux1 + 1 >= 임계`
 * 로 계산할 수는 있다. 하지만 그 순간 **정산 술어가 두 곳에 살게 된다** — 그리고 정산액
 * (`cushionSettled`)·탕감액(`cushionRecovered`)·hp−1 클램프 후 실제 적용액(`applied`)까지
 * 전부 다시 적어야 한다. 이 저장소가 반복해서 당한 결함이 정확히 그 형태다("같은 술어를 세 곳에
 * 적어 화면과 규칙이 갈렸다"). 정산 트리거 9종은 **`world.ts` 정산 분기에 앵커가 뚫릴 때까지
 * 코드가 없다** — 반쪽으로 흉내 내지 않았다.
 *
 * 여기 없는 스킬은 "구현했는데 안 불린다"가 아니라 **아직 코드가 없다.** 사유는 각 앵커의
 * `case` 주석과 레인 보고서에 있다.
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
import { clearEnemyBullets } from '../activeTypes.js';
import { CUSHION_RECOVER_TICKS, CUSHION_TICK_CAP } from '../shipSignature.js';
import { skillLv } from '../../items/skills.js';

// ---------------------------------------------------------------------------
// flat 인덱스 — `data/ships/mallow.ts` 의 축 순서가 정본
// ---------------------------------------------------------------------------
//
// `trees: [squish(offense), mend(utility), cushion(defense)]` 이므로
// SQ1..SQ10 = 0..9 · ME1..ME10 = 10..19 · CU1..CU10 = 20..29 다.
//
// ⚠️ **세 선행 기체가 전부 축 순서가 달랐다.** 스트라이커 [offense, defense, utility] ·
// 아크캐스터 [offense, utility, defense] · 브루저도 자기 순서가 있다. 말로우는 아크캐스터와
// 같은 [offense, utility, defense] 지만 **그것은 우연이고**, 정본은 언제나
// `data/ships/{ship}.ts` 의 `trees` 배열이다 — 설계서의 서술 순서(SQ→ME→CU)와 우연히 일치하는
// 것에 기대지 마라.

const enum Sk {
  /** SQ3 몸통 반발 */ bodyRecoil = 2,
  /** SQ4 압인 탄두 */ debtStamp = 3,
  /** ME1 조기 상환 */ earlyRepayment = 10,
  /** ME10 성장 환전 */ growthConversion = 19,
  /** CU4 반발 세척 */ recoilRinse = 23,
  /** CU7 아문 살갗 */ healedHide = 26,
}

/**
 * 이 런에서 그 스킬의 **실효 레벨**(투자 + 축 어픽스). 미투자면 0 이다(`skillLv` 정본 1).
 * 기체 게이트는 호출부(`skillHooks.ts` 의 `case SIG_MALLOW_CUSHION`)가 이미 걸었다.
 */
function lv(state: WorldState, flat: Sk): number {
  return skillLv(
    state.config.skillInvest,
    flat,
    state.config.skillAffixLv,
    state.skillDerived.shipType,
  );
}

// ---------------------------------------------------------------------------
// 레벨 스케일 — 설계서 ② 의 공식 그대로
// ---------------------------------------------------------------------------

/**
 * CU7 의 만충 감소량 K = 1500 + 3500×Lv/(Lv+12) bp.
 * Lv1 ≈ 1769 · Lv20 ≈ 3687 · **점근 5000**(= 최대 50%) — 어픽스로 레벨이 20 을 넘어도
 * 10000bp 에 닿지 못하므로 피해가 음수가 되는 특이점이 없다(설계서 수지 불변식 3).
 *
 * ⚠️ 나눗셈이 `createWorld` 가 아니라 여기 있는 이유는 스트라이커 헤더가 적은 그대로다 —
 * `world.ts` 가 이 모듈을 런타임 import 하면 순환의 씨앗이 되고, 공식을 `world.ts` 에 다시
 * 적으면 이중 정본이 된다. 이 함수는 **피격 틱에만** 불린다(매 틱 나눗셈이 아니다).
 */
function healedHideMaxBp(level: number): number {
  return 1500 + (3500 * level) / (level + 12);
}

/** ME10 의 부채→XP 전환율(%) = 20 + 50×Lv/(Lv+10). Lv20 ≈ 53 · 점근 70. */
function growthConversionPct(level: number): number {
  return 20 + (50 * level) / (level + 10);
}

// ---------------------------------------------------------------------------
// 앵커별 진입점 — `skillHooks.ts` 의 `case SIG_MALLOW_CUSHION:` 이 부른다
// ---------------------------------------------------------------------------

/**
 * 앵커 ③ **젬 수거** — ME1 조기 상환.
 *
 * 젬 1개당 무피격 카운터(`aux1`)가 `2 + floor(Lv/2)` 틱 추가로 흐른다 — "줍는 행위가 쉬는
 * 시간으로 인정된다".
 *
 * ⚠️ {@link CUSHION_TICK_CAP} 클램프가 **필수**다(설계서 공통 고지 ③). `aux1` 은 u32 로
 * 해시되므로(`replay.ts` `hashEntity`) 상한 없이 밀면 적립분이 0 인 긴 구간에서 값이 무한히
 * 커진다. 액티브 핸들러의 `addUnhitTicks` 가 같은 규율을 쓰고, 그 상한 상수는
 * `shipSignature.ts` 한 곳이 정본이다.
 */
export function mallowGemCollected(state: WorldState, player: Entity): void {
  const me1 = lv(state, Sk.earlyRepayment);
  if (me1 < 1) return;
  const add = 2 + Math.floor(me1 / 2);
  const next = Math.trunc(player.aux1) + add;
  player.aux1 = next > CUSHION_TICK_CAP ? CUSHION_TICK_CAP : next;
}

/**
 * 앵커 ④ **선체 hp 가 깎인 피격의 후속** — SQ3 몸통 반발 · CU4 반발 세척.
 *
 * ## 이 앵커는 완충 적립 **뒤**다 — 그것이 CU4 설계의 요구다
 * 설계서 CU4 는 *"첫 피격도 발동한다 — 적립이 같은 틱이므로 aux0 게이트는 적립 **후** 판정으로
 * 명시"* 라고 적었다. `world.ts` 의 호출 순서가 `aux0 += deferred` → `onPlayerDamaged` 이므로
 * 이 조건이 배선으로 이미 성립한다(여기서 적립을 흉내 내 보정하면 두 곳이 갈린다).
 *
 * @param dmg **즉시분**(지연분을 뗀 뒤 실제로 hp 에서 깎인 양). SQ3 의 반격 피해가 이것에
 *   비례한다 — 설계서의 "이번 피격의 즉시분" 그대로다.
 */
export function mallowPlayerDamaged(state: WorldState, player: Entity, dmg: number): void {
  // --- SQ3 몸통 반발 — 최근접 적 1기에게 즉시분 비례 반격 ---------------------
  const sq3 = lv(state, Sk.bodyRecoil);
  if (sq3 >= 1 && dmg > 0) {
    // 반환 배율 = 60 + 8×Lv %. 반올림은 이 게이트 **안**이다(규율 ③) — 접촉 피해는 엘리트
    // 배율이 섞여 소수일 수 있고, 밖으로 빼면 스킬 없는 런까지 바뀐다.
    const back = Math.round((dmg * (60 + 8 * sq3)) / 100);
    if (back > 0) {
      // 탐색 반경 260 고정 · 대상 `kind === 'enemy'` 한정(설계서: 보스·guardian·구조물 제외).
      // 제곱 비교라 `Math.sqrt` 가 낄 자리가 없다(`nearestTarget` 과 동형).
      const r2 = 260 * 260;
      let best: Entity | undefined;
      let bestD2 = r2;
      for (const e of state.entities) {
        if (e.dead || e.kind !== 'enemy') continue;
        const dx = e.x - player.x;
        const dy = e.y - player.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= bestD2) {
          bestD2 = d2;
          best = e;
        }
      }
      // `hp` 만 깎고 `dead` 는 건드리지 않는다 — 격추 판정은 `compact()` 가 단일 수렴점이다
      // (`blastDamage` 와 정확히 같은 형태. 여기서 `dead` 를 세우면 킬 집계가 두 벌이 된다).
      if (best !== undefined) best.hp -= back;
    }
  }
  // --- CU4 반발 세척 — 부채 보유 중에만 발동, 반경도 부채 파생 -----------------
  const cu4 = lv(state, Sk.recoilRinse);
  if (cu4 >= 1) {
    const debt = Math.trunc(player.aux0);
    if (debt > 0) {
      // 기본 반경 70 + 6×Lv, 부채 비례 확장 = aux0 × 2 (확장분 상한 = 기본 반경의 2배).
      const base = 70 + 6 * cu4;
      const grow = debt * 2;
      const cap = base * 2;
      clearEnemyBullets(state, player, base + (grow > cap ? cap : grow));
    }
  }
}

/**
 * 앵커 ⑧ **감쇠 사슬의 스킬 슬롯** — CU7 아문 살갗(감소 칸). 흡수 칸을 쓰는 말로우 스킬은 없다.
 *
 * 연속 무피격 틱(`aux1`)에 비례해 받는 피해가 줄어든다 — 브루저(맞아야 장갑)의 정확한 반대
 * 문법이고, 정산이 `aux1` 을 0 으로 되돌리므로 "탕감 직후가 가장 약하다"는 긴장이 내장된다.
 *
 * ## ⚠️ 분모 T 는 지금 **상수 180 이다** — 설계서의 "실효 임계" 가 아니다
 * 설계서(2R M2)는 T 를 *"그 틱의 실효 정산 임계(기본 180, ME9 벽 접촉 중엔 인하된 값)"* 로
 * 정의했다. **ME9(솜틀 요양)가 이 배치에서 미배선**이라 실효 임계가 언제나 기본값이고, 그래서
 * 지금은 두 정의가 같은 값이다. ME9 를 배선하는 레인은 **이 함수의 분모를 반드시 함께
 * 옮겨야 한다** — 안 옮기면 "임계에 가까울수록 단단하다"는 의미가 두 스킬 병존에서 깨진다
 * (설계서가 무상한 하드코딩 180 을 결함으로 지목한 자리가 정확히 여기다).
 *
 * ## ⚠️ 이 자리는 설계서가 지정한 자리보다 **앞**이다 — 말로우 런에서는 같은 값이다
 * 설계서 구현 항은 *"지연 전환 분기 직전"* 을 요구했는데, 사슬에 뚫린 스킬 자리는 앵커 ⑧
 * 하나뿐이고 그것은 브루저 장갑·버블 막보다 **앞**이다. 그 둘은 말로우 런에 존재하지 않으므로
 * (런당 기체 1대) 순서 차이가 관측 가능한 결과를 만들지 않는다.
 *
 * ## ⚠️ 이 감소는 **지연 정산분에 걸리지 않는다**
 * 정산이 hp 를 깎는 경로(`stepShipSignature` 의 말로우 가지)는 감쇠 사슬을 타지 않는다. 즉
 * CU7 은 "지금 들어오는 피격"만 깎고 "나중에 갚는 몫"은 못 깎는다. 설계서의 서술("받는 피해가
 * 감소")과 어긋나 보일 수 있으나, 설계서 자신이 CU7 의 자리를 **지연 전환 분기 직전**(= 피격
 * 경로)으로 못 박았으므로 의도된 범위다.
 */
export function mallowDamageChain(state: WorldState, player: Entity, dmg: number): number {
  const cu7 = lv(state, Sk.healedHide);
  if (cu7 < 1) return dmg;
  const unhit = Math.trunc(player.aux1);
  if (unhit <= 0) return dmg;
  const t = CUSHION_RECOVER_TICKS;
  const capped = unhit > t ? t : unhit;
  // 감소 bp = round(min(aux1, T) × K / T). 정수 bp 단일 나눗셈 + 반올림 1회로, 브루저 장갑·
  // 스트라이커 S4 와 동형이다(소수 피해가 들어와도 같은 방식으로 접힌다).
  const bp = Math.round((capped * healedHideMaxBp(cu7)) / t);
  if (bp <= 0) return dmg;
  return dmg - Math.round((dmg * bp) / 10000);
}

/**
 * 앵커 ⑩ **적이 아군탄에 맞아 피해가 확정된 직후** — SQ4 압인 탄두.
 *
 * 부채 보유 중(`aux0 > 0`) 발사한 탄이 명중한 적을 **좌표 직접 변위**로 밀어낸다. 속도 대입이
 * 아니다 — 넉백 규율(인벤토리 7.1 · `filmBurstPush` 선례)이 그것을 금지한다(속도에 실으면
 * 이동 적분과 겹쳐 밀린 거리가 무대·프레임에 따라 달라진다).
 *
 * ## 방향은 **탄의 진행 방향**이다
 * `source.vx/vy` 를 정규화해 쓴다. `angle` 을 쓰지 않는 것은 파생탄(미사일·분열 파편)이
 * `angle` 과 실제 진행 방향이 갈릴 수 있기 때문이고, `Math.sqrt` 는 IEEE754 정확 연산이라
 * 결정론에 안전하다.
 *
 * ## 대상 한정
 * `kind === 'enemy'` 만 민다. 이 앵커에는 `boss`·`core`·`guardian`·`destructible`·침공 설비까지
 * 전부 오는데, 부동 구조물을 좌표로 밀면 지형이 어긋난다. 설계서의 "보스·엘리트 반감" 중
 * **엘리트 반감**만 여기서 성립한다(보스는 애초에 대상 밖이라 반감이 아니라 전면 제외다).
 *
 * ⚠️ 이 지점은 `for (const b of state.entities)` 순회 안이다 — 스폰하지 않는다(앵커 주석).
 */
export function mallowEnemyDamaged(
  state: WorldState,
  player: Entity,
  target: Entity,
  source: Entity | undefined,
): void {
  const sq4 = lv(state, Sk.debtStamp);
  if (sq4 < 1) return;
  if (Math.trunc(player.aux0) <= 0) return;
  if (target.dead || target.kind !== 'enemy') return;
  if (source === undefined) return;
  const vx = source.vx;
  const vy = source.vy;
  const len = Math.sqrt(vx * vx + vy * vy);
  if (!(len > 0)) return;
  // 변위 = 12 + 3×Lv (sim 좌표). 엘리트(`pierce > 0` — `isElite` 와 같은 술어)는 반감.
  let push = 12 + 3 * sq4;
  if (target.pierce > 0) push = Math.round(push / 2);
  if (push <= 0) return;
  target.x += (vx / len) * push;
  target.y += (vy / len) * push;
}

/**
 * 앵커 ⑭ **파워업이 실제로 적용된 직후** — ME10 성장 환전.
 *
 * 부채의 절반이 소각되고 그 소각분이 **런 풀 XP**(`state.xp`)로 환전된다.
 *
 * ## ⚠️ 메타 풀(`state.xpTotal`)에는 한 톨도 넣지 않는다
 * 설계서가 ADR-0036 이원화를 근거로 못 박은 계약이다 — 메타에 넣으면 **피격이 계정 성장 재화가
 * 되는 경제 구멍**이 된다(`settlement.ts` 가 런 산출을 계정 재화로 옮기는 계층이다).
 *
 * ## 연쇄 레벨업은 기존 규칙 그대로다
 * 가산된 XP 로 다음 임계에 즉시 도달하면 `checkLevelUp` 의 기존 규칙(`xp -= need` 후
 * `pendingLevelUp` 재설정 · 다음 틱 최상단 프리즈)이 그대로 돈다. 이 훅은 XP 를 넣을 뿐
 * 프리즈·픽 루프를 변형하지 않는다 — 앵커 ⑫ 가 금지한 "`state.xp` 를 올려 다단 레벨업을
 * 유도"는 **한 틱 안에서 프리즈를 건너뛰는 것**을 말하고, 이 지점은 픽이 이미 소비돼 프리즈가
 * 풀린 뒤라 다음 레벨은 정상 경로로 열린다.
 *
 * ## floor 단일 나눗셈 — 캐리 상태 없음
 * 잔여는 버린다(설계서 2R S4: milli 캐리를 두면 `WorldState` 신규 정수가 되어 구현 태그가
 * B 로 올라가고 mend 축 B 예산을 넘긴다). 그래서 이 스킬은 슬롯을 한 칸도 잡지 않는다.
 */
export function mallowPowerupPicked(state: WorldState, player: Entity): void {
  const me10 = lv(state, Sk.growthConversion);
  if (me10 < 1) return;
  const debt = Math.trunc(player.aux0);
  if (debt <= 0) return;
  // 부채 절반으로 감산(`max(0, ·)` 은 위 `debt > 0` 게이트가 이미 보장 — 설계서 고지 ③).
  const left = Math.floor(debt / 2);
  const burned = debt - left;
  player.aux0 = left;
  const gain = Math.floor((burned * growthConversionPct(me10)) / 100);
  if (gain > 0) state.xp += gain;
}
