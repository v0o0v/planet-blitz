/**
 * **버블 30스킬의 효과 본체**(ADR-0049 배치 4 · 설계 정본
 * `.omc/plans/skill-rebuild-2026-08-05/bubble.md` 승인본 4판).
 *
 * 형태는 **스트라이커 레인이 확립한 다섯 규율을 그대로 따른다**(`skills/striker.ts` 헤더가 정본):
 * ①`world.ts` 런타임 import 0건(타입은 type-only) ②모든 쓰기는 투자 게이트 안쪽 ③반올림은
 * 게이트 안 ④RNG 소비 0 ⑤슬롯 접근은 `readSlot`/`writeSlot` 만.
 *
 * ---
 *
 * ## ⚠️ 이 배치가 배선한 것은 30종 중 **9종**이다
 * 사유별 묶음은 `skillHooks.ts` 의 각 `case`/미배선 주석과 레인 보고서에 있다. 큰 줄기는 셋:
 *  1. **막 흡수 지점에 앵커가 없다** — 감쇠 사슬의 스킬 슬롯(앵커 ⑧)은 `world.ts:4224` 이고
 *     막 흡수는 `world.ts:4249` 다. 그 사이에 브루저 장갑(4234)이 있어 앵커 ⑧ 에서는 막이
 *     아직 한 점도 닳지 않았다. 흡수량·흡수 효율·비상막을 요구하는 6종(DR2·FI3·FI4·FI6·
 *     FI8·FI9)이 전부 여기 걸린다.
 *  2. **볼리 파라미터에 닿지 않는다** — 앵커 ① 은 무기 아키타입 분기보다 앞이라 탄이 없다
 *     (PO2·PO5).
 *  3. **후처리 본문의 반경·변위·생성물** — FI7 은 밀어내기 산술 자체를 배율해야 하고(훅이
 *     아니라 함수 파라미터), PO4 는 슬라이드 전후 좌표 차이를, PO8 은 기뢰 엔티티 생성 규약을
 *     요구한다.
 *
 * 여기 없는 스킬은 "구현했는데 안 불린다"가 아니라 **아직 코드가 없다**.
 *
 * ## ⚠️ 슬롯을 **한 칸도 잡지 않았다**
 * 배선한 9종이 전부 기존 필드(`aux0`·`aux1`·`iframes`·`dashCooldown`·`playerSlowTicks`)와
 * `state.tick` 파생만 쓴다. 설계서가 `구현: B` 로 표시한 버블 5종(PO10·DR2·DR3·FI6·FI7)은
 * 전부 위 세 사유 중 하나에 걸려 이 배치 밖이다 — 그래서 `BubbleCarry`/`BubbleStage` 는
 * 자리표시자뿐이고, `hashWorld` 의 스킬 슬롯 폴드는 버블 런에서도 한 번도 돌지 않는다.
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
import { clearEnemyBullets, fanStrike } from '../activeTypes.js';
import { applyChain } from '../status.js';
import { FILM_ABSORB_FLAT, FILM_BURST_RADIUS } from '../shipSignature.js';
import { skillLv } from '../../items/skills.js';

// ---------------------------------------------------------------------------
// flat 인덱스 — `data/ships/bubble.ts` 의 축 순서가 정본
// ---------------------------------------------------------------------------
//
// `trees: [pop(offense), drift(utility), film(defense)]` 이므로
// PO1..PO10 = 0..9 · DR1..DR10 = 10..19 · FI1..FI10 = 20..29 다.
//
// ⚠️ **기체마다 축 순서가 다르다.** 스트라이커는 [offense, defense, utility] 라 두 번째
// 블록이 방어축이지만, 버블은 아크캐스터와 같이 두 번째가 **utility(표류)** 다. 설계서의
// 서술 순서(파열→표류→피막)와 데이터가 우연히 일치하지만, 정본은 언제나 `trees` 배열이다.

const enum Sk {
  /** PO1 파열 탄두 */ burstWarhead = 0,
  /** PO3 거품 산탄 파열 */ burstScatter = 2,
  /** PO6 격발 재응결 */ fireRecondense = 5,
  /** PO7 정전 파열 */ staticBurst = 6,
  /** DR6 파열 추진 */ burstPropulsion = 15,
  /** FI1 조기 응결 */ earlyCondense = 20,
  /** FI2 내구 재응결 */ durabilityRecondense = 21,
  /** FI5 파열 위상 */ burstPhase = 24,
  /** FI10 정화 파열 */ purgeBurst = 29,
}

/**
 * 이 런에서 그 스킬의 **실효 레벨**(투자 + 축 어픽스). 미투자면 0 이다(`skillLv` 정본 1).
 * 기체 게이트는 호출부(`skillHooks.ts` 의 `case SIG_BUBBLE_FILM`)가 이미 걸었다.
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
//
// ⚠️ 나눗셈이 낀 두 공식(FI1 선급·FI2 주기)은 `skillDerived` 가 아니라 여기서 계산한다 —
// 사유는 `skills/striker.ts` 의 같은 주석이 정본이다(`world.ts` 런타임 import 또는 이중 정본
// 둘 중 하나가 되기 때문). FI1 은 파열 틱, FI2 는 막이 서 있고 만재가 아닌 틱뿐이다.

/**
 * FI1 선급 = round(300×Lv/(Lv+18)) 틱 (Lv1 = 16, Lv20 = 158).
 *
 * **점근 300 < `FILM_PERIOD_TICKS`(420)** 이라 어떤 레벨·어픽스에서도 즉시 재생이 불가능하다 —
 * clamp 가 아니라 **공식 형태**가 그것을 보장한다(설계서 R2-4). clamp 를 덧붙이지 마라: 상한이
 * 두 곳(공식·clamp)에 생기면 밸런스 패스가 한쪽만 고쳐 조용히 갈린다.
 */
function earlyCondenseTicks(level: number): number {
  return Math.round((300 * level) / (level + 18));
}

/** FI2 회복 주기 = 6 + floor(72/(Lv+2)) 틱 (Lv1 = 30, Lv20 = 9, 점근 6). */
function recondensePeriodTicks(level: number): number {
  return 6 + Math.floor(72 / (level + 2));
}

// ---------------------------------------------------------------------------
// 앵커 ⑨ — 시그니처 틱 진행(매 틱 정확히 한 번)
// ---------------------------------------------------------------------------

/**
 * **FI2 내구 재응결** — 막이 서 있고 만재가 아닌 동안 주기마다 내구 +1.
 *
 * ## 왜 상한이 `FILM_ABSORB_FLAT` 이 아니라 `< FILM_ABSORB_FLAT` 술어인가
 * `aux0 ≤ FILM_ABSORB_FLAT` 은 `world.ts:2559-2561` 이 못 박은 **엔진 불변식**이다(u32 폴드
 * 안전성의 근거이기도 하다). 설계서 ⑥절 3 은 PO10 만을 그 불변식의 유일한 예외로 지정했고,
 * FI2 는 "상한 FLAT 안" 이라고 명시했다 — 그래서 술어로 상한을 지킨다. `Math.min` 으로 나중에
 * 접는 형태를 쓰면 "상한을 넘겼다가 되돌리는" 한 틱이 생겨 불변식 주석과 코드가 갈린다.
 *
 * ## 소진 = 파열 규칙은 건드리지 않는다
 * 회복은 `aux0 > 0` 일 때만 돈다. 0 인 막(= 이미 터진 뒤)을 되살리지 않으므로 "한 피격으로
 * 0 이 되는 순간만 터진다"는 시그니처 계약이 그대로다.
 */
export function bubbleSignatureStep(state: WorldState, player: Entity): void {
  const fi2 = lv(state, Sk.durabilityRecondense);
  if (fi2 < 1) return;
  if (player.aux0 <= 0 || player.aux0 >= FILM_ABSORB_FLAT) return;
  if (state.tick % recondensePeriodTicks(fi2) === 0) player.aux0 += 1;
}

// ---------------------------------------------------------------------------
// 앵커 ⑩ — 적성 표적이 아군탄에 맞아 피해가 확정된 직후
// ---------------------------------------------------------------------------

/**
 * **PO6 격발 재응결** — 막이 없는 동안 주무기 명중마다 재생 타이머(`aux1`)가 전진한다.
 *
 * ## 무막 게이트가 이 함수 안에 있는 이유 (①-2 계약 2)
 * 설계서는 "스킬 가산 훅은 엔진 단일 게이트를 지나 `aux0 === 0` 일 때만 유효" 라고 적었고,
 * 스킬 가산 훅은 **PO6 이 유일**하다(DR7 은 배율 · FI1 은 선급). 게이트 하나에 소비자가
 * 하나뿐이라 별도 엔진 헬퍼를 세우지 않고 여기서 직접 판정한다 — 헬퍼를 만들면 "게이트가
 * 어디 있는지" 가 두 곳(엔진·호출부)으로 갈리고, 소비자가 늘 때 그 헬퍼를 거치지 않는 경로가
 * 조용히 생긴다. **두 번째 가산 훅이 생기면 그때 엔진으로 올려라.**
 *
 * ## 파열 직전 선지불은 구조적으로 불가능하다
 * `aux1` 은 막이 서 있는 동안 항상 0 이다(`world.ts:2562-2568` — `aux0 === 0` 일 때만 돌고,
 * 막이 서는 틱에 0 으로 리셋된다). 이 게이트가 `aux0 === 0` 이므로 막이 서 있는 동안은 한
 * 칸도 못 넣는다 — 설계서 계약 1 이 막으려던 "파열 직전에 채워 둔 aux1 이 파열 즉시 재생을
 * 만든다"가 원리적으로 성립하지 않는다.
 *
 * ## ⚠️ 덮는 범위는 **아군탄 명중 하나뿐**이다
 * 앵커 ⑩ 은 화염 DoT·전격 연쇄·폭탄 기물·액티브 폭발을 덮지 않는다(앵커 주석). 설계서 PO6 의
 * 문면이 "**주무기** 탄이 명중할 때마다" 라 이 범위와 정확히 일치한다 — 한계에 부딪히지 않았다.
 *
 * @param target 맞은 적성 표적. 잡몹 한정으로 좁힌다 — 설계서 ④ 표의 `enemy` 한정 계약이다.
 */
export function bubbleEnemyDamaged(state: WorldState, player: Entity, target: Entity): void {
  const po6 = lv(state, Sk.fireRecondense);
  if (po6 < 1) return;
  if (player.aux0 !== 0) return;
  if (target.kind !== 'enemy') return;
  player.aux1 += 1 + Math.floor(po6 / 5);
}

// ---------------------------------------------------------------------------
// 앵커 ⑮ — 막 파열(`resolveFilmBurst` 의 밀어내기 **직전**)
// ---------------------------------------------------------------------------

/**
 * **PO1 파열 탄두 · PO3 거품 산탄 파열 · PO7 정전 파열 · DR6 파열 추진 · FI1 조기 응결 ·
 * FI5 파열 위상 · FI10 정화 파열.**
 *
 * 설계서 ①-3 이 요구한 "파열 훅 전부가 단일 함수 안에만 산다"를 이 한 진입점이 만족한다 —
 * 시그니처 소진 파열(`world.ts:4268`)과 액티브 요청 소비(`world.ts:1823`) 둘 다 같은
 * `resolveFilmBurst` 를 지나므로, 파열 종류가 늘어도 여기 한 곳만 본다.
 *
 * ## ⚠️ 파열 중심 `(x, y)` 와 플레이어 좌표는 **같지 않을 수 있다**
 * 액티브 요청은 요청 시점 좌표를 박아 두므로(`requestFilmBurst` 주석), 같은 틱에 blink 가
 * 플레이어를 옮겼으면 둘이 갈린다. 그래서 **효과별로 기준점을 나눈다**:
 *  · **파열 중심** — PO1(폭발). 설계서가 "파열 지점" 이라고 적은 것들.
 *  · **플레이어 중심** — PO3(사출 출발점) · PO7(연쇄 원점) · FI10(소거). 셋 다 설계서 문면이
 *    "플레이어 중심"(PO3) 이거나, 재사용 헬퍼가 `Entity` 를 기준점으로 받아 좌표만 넘길 수
 *    없다(PO7·FI10). 산술을 여기 복제해 기준점을 바꾸는 대안은 기각했다 — 두 판정이 갈린다.
 *  · **좌표 무관** — DR6·FI1·FI5.
 *
 * ## ⚠️ PO1 은 `blastDamage` 를 재사용하지 **않는다**
 * 그 헬퍼는 `kind === 'enemy' || kind === 'boss'` 를 친다. 설계서 PO1 본체와 ④ 침공 판정표가
 * **`enemy` 한정(구조물·보스 제외)** 을 명시했으므로 대상 집합이 다르다. 재사용하면 침공
 * 판정표의 근거("대상 전부 `enemy` 한정")가 코드와 갈린다.
 */
export function bubbleFilmBurst(state: WorldState, player: Entity, x: number, y: number): void {
  // ── PO1 파열 탄두 — 파열 중심 반경 안 `enemy` 에게 즉발 18 + 4×Lv.
  const po1 = lv(state, Sk.burstWarhead);
  if (po1 >= 1) {
    const dmg = 18 + 4 * po1;
    const r2 = FILM_BURST_RADIUS * FILM_BURST_RADIUS;
    for (const e of state.entities) {
      if (e.dead || e.kind !== 'enemy') continue;
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy <= r2) e.hp -= dmg;
    }
  }

  // ── PO3 거품 산탄 파열 — 플레이어 중심 전방위 사출. 탄수 6 + floor(Lv/3) · 탄당 8 + 2×Lv.
  const po3 = lv(state, Sk.burstScatter);
  if (po3 >= 1) {
    fanStrike(state, player, 6 + Math.floor(po3 / 3), 8 + 2 * po3, 360, {
      x: Math.cos(player.angle),
      y: Math.sin(player.angle),
    });
  }

  // ── PO7 정전 파열 — 전격 연쇄 12 + 3×Lv. 대상 수·반경은 `applyChain` 의 계약
  //    (`CHAIN_MAX_TARGETS` = 설계서의 "최대 3기")을 그대로 상속한다 — 설계서 구현란이
  //    "파열 훅에서 `applyChain`" 이라 재사용이 정본이고, 여기서 반경을 다시 적으면 원소
  //    전격과 두 벌이 된다.
  const po7 = lv(state, Sk.staticBurst);
  if (po7 >= 1) {
    applyChain(state, player, 12 + 3 * po7);
  }

  // ── DR6 파열 추진 — 대시 쿨다운 환급 30 + 5×Lv.
  //    ⚠️ `Math.max(0, ·)` 클램프가 **필수**다. 음수로 내려가면 대시 발동 게이트가
  //    `dashCooldown === 0` 동등 비교라 영영 걸리지 않는다(스트라이커 M3 와 같은 함정).
  const dr6 = lv(state, Sk.burstPropulsion);
  if (dr6 >= 1) {
    const refund = 30 + 5 * dr6;
    player.dashCooldown = Math.max(0, player.dashCooldown - refund);
  }

  // ── FI1 조기 응결 — 재생 타이머를 선급값에서 시작한다. **대입이지 가산이 아니다.**
  //    설계서 계약 3 이 "파열 후처리가 세우는 초기값 권한은 FI1 단독" 이라고 못 박았고,
  //    가산으로 두면 `film_lo` SUSTAIN 이 막이 서 있는 동안 선지불한 `aux1` 위에 얹혀
  //    계약 1(막 소멸 시 선지불 소거)이 무력해진다. 대입은 그 선지불을 지우고 선급만 남긴다.
  const fi1 = lv(state, Sk.earlyCondense);
  if (fi1 >= 1) {
    player.aux1 = earlyCondenseTicks(fi1);
  }

  // ── FI5 파열 위상 — 파열 틱 무적 창 연장. `hitIframes` + 6 + 2×Lv.
  //    ⚠️ **max 갱신**이지 가산이 아니다(설계서: `iframes = max(iframes, k)`). 가산이면
  //    막 전량 흡수 경로가 바로 뒤에서 `iframes = hitIframes` 로 **덮어써** 연장이 사라지는
  //    틱과, 덮어쓰지 않아 누적되는 틱이 갈린다.
  const fi5 = lv(state, Sk.burstPhase);
  if (fi5 >= 1) {
    const want = state.config.hitIframes + 6 + 2 * fi5;
    if (player.iframes < want) player.iframes = want;
  }

  // ── FI10 정화 파열 — 반경 안 적탄 소거 + 감속 디버프 해제. 반경 = 파열 반경 + 15×Lv.
  //    소거 수에 대한 보상은 없다(설계서: 부수효과만·반환 없음).
  const fi10 = lv(state, Sk.purgeBurst);
  if (fi10 >= 1) {
    clearEnemyBullets(state, player, FILM_BURST_RADIUS + 15 * fi10);
    state.playerSlowTicks = 0;
  }
}
