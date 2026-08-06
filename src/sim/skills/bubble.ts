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
 * ## ⚠️ 배선된 것은 30종 중 **13종**이다 (배치 4 의 9종 + S2 앵커로 연 4종)
 * S2 가 앵커 ⑯(`onVolleyParams`)·⑰(`onFilmShield`)·⑱(`onFilmAbsorbed`)을 열어
 * **PO2·PO5(⑯) · FI3·FI4(⑱)** 넷이 추가됐다. 사유별 묶음은 `skillHooks.ts` 의 각 `case`/
 * 미배선 주석에 있고, 남은 17종의 큰 줄기는 넷이다:
 *  1. **흡수 「효율」 축은 앵커 ⑰ 으로도 표현이 안 된다** — `filmAbsorbed = min(dmg, shield)`
 *     이고 world 가 `aux0 -= absorbed` 를 하므로 **흡수량과 내구 소모량이 같은 값**이다.
 *     "내구 1당 막는 피해가 1+α" 는 그 둘을 분리해야 성립하는데, 분리는 순수 함수 시그니처
 *     변경(= 골든)이라 배선 레인 밖이다. DR2·FI8 이 여기 걸린다(FI8 은 피해원 복원 불가라는
 *     별도 사유도 함께 — ⑰ 주석이 정본). FI9 는 호출부 게이트(`aux0 > 0`)가 *막 없음*을
 *     배제해 애초에 이 앵커에 도달하지 않는다.
 *  2. **자석·이동·젬 이동 축에 앵커가 없다** — DR3·DR4·DR5·DR8·DR10 은 `stepGems` 흡인 배율,
 *     이동 감속 적용부, 기믹 접촉 판정처럼 전부 `world.ts` 의 비-앵커 지점을 요구한다.
 *  3. **파열의 종류를 구분할 신호가 없다** — FI6 은 *액티브 만료* 파열에만 얹혀야 하는데
 *     앵커 ⑮ 는 시그니처 소진 파열과 만료 파열을 구분하지 못한다(요청 슬롯의 종류 코드는
 *     소비 시점에 이미 비워진다).
 *  4. **후처리 본문의 반경·변위·생성물** — FI7 은 밀어내기 산술 자체를 배율해야 하고(훅이
 *     아니라 함수 파라미터), PO4 는 슬라이드 전후 좌표 차이를, PO8 은 기뢰 엔티티 생성 규약을
 *     요구한다.
 *
 * 여기 없는 스킬은 "구현했는데 안 불린다"가 아니라 **아직 코드가 없다**.
 *
 * ## ⚠️ 슬롯을 **한 칸도 잡지 않았다**
 * 배선한 13종이 전부 기존 필드(`aux0`·`aux1`·`iframes`·`dashCooldown`·`playerSlowTicks`)와
 * `state.tick`·볼리 파라미터 파생만 쓴다. 설계서가 `구현: B` 로 표시한 버블 5종(PO10·DR2·
 * DR3·FI6·FI7)은 전부 위 사유 중 하나에 걸려 아직 밖이다 — 그래서 `BubbleCarry`/`BubbleStage` 는
 * 자리표시자뿐이고, `hashWorld` 의 스킬 슬롯 폴드는 버블 런에서도 한 번도 돌지 않는다.
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
import type { VolleyParams } from '../skillHooks.js';
import { clearEnemyBullets, fanStrike } from '../activeTypes.js';
import { applyChain } from '../status.js';
import { slideCircleWalls } from '../los.js';
import { length } from '../math.js';
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
  /** PO2 압력 전환 사출 */ pressureTransfer = 1,
  /** PO3 거품 산탄 파열 */ burstScatter = 2,
  /** PO5 만재 투과 */ fullFilmPierce = 4,
  /** PO6 격발 재응결 */ fireRecondense = 5,
  /** PO7 정전 파열 */ staticBurst = 6,
  /** DR6 파열 추진 */ burstPropulsion = 15,
  /** FI1 조기 응결 */ earlyCondense = 20,
  /** FI2 내구 재응결 */ durabilityRecondense = 21,
  /** FI3 반사 응막 */ reflectiveFilm = 22,
  /** FI4 압력 배출 */ pressureVent = 23,
  /** FI5 파열 위상 */ burstPhase = 24,
  /** FI10 정화 파열 */ purgeBurst = 29,
}

/**
 * PO2 가 "초과분" 을 재는 **기준 탄속**. 설계서 PO2 문면이 못 박은 상수(1800)다.
 *
 * ## 왜 `world.ts` 의 기본 무기 `bulletSpeed` 를 읽지 않는가
 * 값이 우연히 같지만 **의미가 다르다**. 저쪽은 "기본 발칸이 이 속도로 쏜다" 는 무기 스탯이고,
 * 이쪽은 "여기를 넘은 만큼만 화력으로 바꾼다" 는 **스킬의 문턱**이다. 무기 기본값을 밸런스
 * 패스가 1600 으로 내리면 이 스킬은 *투자 없이도* 전환이 켜지는 쪽으로 조용히 강해진다 —
 * 문턱은 그 패스와 독립이어야 한다. (그리고 그 값은 `world.ts` 가 export 하지 않는다 —
 * leaf 규율상 런타임 import 도 불가능하다.)
 */
const PO2_SPEED_BASE = 1800;

/**
 * FI4 배출 밀어내기의 **반경**(sim 좌표). 설계서 FI4 가 "반경 120 고정" 으로 못 박았다.
 *
 * ⚠️ `FILM_BURST_RADIUS`(220)를 재사용하지 **않는다** — 파열 반경과 같은 값이 되면 "파열 전에도
 * 민다" 가 아니라 "매 피격이 작은 파열" 이 되어 축이 무너진다. 두 값이 다르다는 것이 설계다.
 */
const FI4_VENT_RADIUS = 120;

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

// ---------------------------------------------------------------------------
// 앵커 ⑯ — 볼리 파라미터 확정 직후 · 탄이 태어나기 직전
// ---------------------------------------------------------------------------

/**
 * **PO2 압력 전환 사출 · PO5 만재 투과** — 버블의 "막이 서 있는 동안" 이중 모드 화력 둘.
 *
 * 두 스킬 다 앵커 ① 에서는 배선할 수 없었다(그 지점은 아키타입 분기보다 앞이라 `speed`·
 * `pierce` 가 아직 안 읽혔다). S2.1 의 ⑯ 이 그 자리를 열었다.
 *
 * ## ⚠️ 술어의 기준점이 다르다 — 둘을 한 게이트로 묶지 마라
 * PO2 는 **막이 서 있기만** 하면 되고(`aux0 > 0`), PO5 는 **만재**를 요구한다
 * (`aux0 >= FILM_ABSORB_FLAT`). 설계서가 PO5 에 "첫 피격이 만재를 깨는 내장 억제" 를 명시했고,
 * PO2 에는 그 억제가 없다(막이 한 점이라도 남으면 켜진다). 합치면 PO2 가 조용히 PO5 의
 * 억제를 물려받는다.
 *
 * ## ⚠️ `ballisticsUsed` 게이트가 **PO2 에서는 필수**다
 * 빔은 `speed` 를 한 칸도 안 읽는다(정지 세그먼트). PO2 는 그 안 읽히는 `speed` 를 **피해로
 * 바꾸는** 스킬이라, 게이트 없이 태우면 빔에서 *대가 없이 피해만* 오른다 — 앵커 ⑯ 의
 * `ballisticsUsed` 주석이 브루저 BL6 을 두고 경고한 「무연산이 아니라 일방적 이득」과 정확히
 * 같은 형태다. 빔에서 PO2 는 통째로 꺼진다.
 *
 * PO5 의 관통 +1 도 같은 사유로 `ballisticsUsed` 안이지만, **피해 보정은 밖**이다 — 그쪽은
 * 대가가 아니라 이득이라, 빔에서 빠져도 *이득이 줄 뿐* 부호가 뒤집히지 않는다. 빔이 관통을
 * 리터럴 9999 로 쓰는 이상 `pierce += 1` 은 어차피 무연산이다.
 */
export function bubbleVolleyParams(
  state: WorldState,
  player: Entity,
  params: VolleyParams,
): void {
  // ── PO2 압력 전환 사출 — 막이 서 있는 동안, 기준 탄속 초과분 bp 의 20% + 2%p/Lv 가 피해 bp 로.
  const po2 = lv(state, Sk.pressureTransfer);
  if (po2 >= 1 && player.aux0 > 0 && params.ballisticsUsed) {
    // 초과분을 **비율(bp)** 로 잰다 — 절대 속도 차를 그대로 피해에 더하면 단위가 다른 두 축이
    // 섞인다(속도 1 = 피해 1 이 될 이유가 없다).
    const excessBp = Math.round(((params.speed - PO2_SPEED_BASE) * 10000) / PO2_SPEED_BASE);
    if (excessBp > 0) {
      // 반올림은 **게이트 안에서만**(공통 규율). 미투자 런은 이 줄에 도달하지 않는다.
      const gainBp = Math.round((excessBp * (2000 + 200 * po2)) / 10000);
      params.damage = (params.damage * (10000 + gainBp)) / 10000;
    }
  }

  // ── PO5 만재 투과 — 막이 **만재**인 동안 관통 +1 · 피해 +6% + 1.5%p/Lv.
  const po5 = lv(state, Sk.fullFilmPierce);
  if (po5 >= 1 && player.aux0 >= FILM_ABSORB_FLAT) {
    if (params.ballisticsUsed) params.pierce += 1;
    params.damage = (params.damage * (10600 + 150 * po5)) / 10000;
  }
}

// ---------------------------------------------------------------------------
// 앵커 ⑱ — 막이 실제로 흡수하고 `aux0` 이 닳은 직후(파열 판정보다 앞)
// ---------------------------------------------------------------------------

/**
 * **FI3 반사 응막 · FI4 압력 배출** — 막이 *막아 낸* 피격에 반응하는 둘.
 *
 * 앵커 ⑧(`onDamageChain`)으로는 못 했다: 그 지점은 브루저 장갑보다도 앞이라 막이 아직 한 점도
 * 안 닳았고, "막이 얼마나 흡수했는가" 라는 트리거 자체가 존재하지 않았다.
 *
 * ## ⚠️ `rest === 0` 이어도 이 함수는 정상 동작한다 — 다만 뒤가 없다
 * 막이 전량 흡수하면 호출부는 무적 창만 세우고 반환한다(앵커 ⑱ 주석). 여기 둘은 **그 자리에서
 * 끝나는 즉시 효과**라 소비처를 뒤에 두지 않는다 — 값을 세워 두고 나중에 쓰는 형태였다면
 * 전량 흡수 틱마다 조용히 유실됐을 것이다.
 *
 * ## ⚠️ 파열 틱에 FI4 를 **일부러 끈다** — 설계 문면과 어긋나 보이는 지점이라 근거를 남긴다
 * 설계서 FI4 는 "막이 흡수할 때마다" 이되 본체 문면이 **"파열 전에도 막이 민다"** 다. 그리고
 * 이 앵커는 파열 판정보다 **앞**이라, 여기서 밀면 곧 이어질 `resolveFilmBurst` 의 파열 훅
 * (PO1 폭발 · PO7 연쇄)이 **반경 안에서 적을 한 기도 못 찾는다** — Lv20 에서 FI4 변위는
 * 흡수 60 × 4.2 = 252 로 파열 반경 220 을 이미 넘는다. 이것은 앵커 ⑮ 가 밀어내기 뒤에 놓였다가
 * PO1·PO7 을 조용히 0건으로 만든 그 사건과 **같은 형태**이고, 화면에도 테스트에도 "안 터진다"
 * 는 흔적만 남는다. 그래서 파열하는 틱(`aux0 === 0`)에는 배출을 건너뛴다 — 그 틱의 밀어내기는
 * 파열이 이미 (더 크게) 수행한다.
 */
export function bubbleFilmAbsorbed(
  state: WorldState,
  player: Entity,
  absorbed: number,
  rest: number,
): void {
  void rest;
  // 막이 실제로 태운 내구가 0 이면 "막아 냈다" 가 성립하지 않는다(피해 0 인 접촉 등).
  if (absorbed <= 0) return;

  // ── FI3 반사 응막 — 흡수한 틱에 주변 적탄 소거. 반경 80 + 8×Lv.
  //    소거 수에 대한 보상은 없다(FI10 과 같은 규약 — 부수효과만).
  const fi3 = lv(state, Sk.reflectiveFilm);
  if (fi3 >= 1) {
    clearEnemyBullets(state, player, 80 + 8 * fi3);
  }

  // ── FI4 압력 배출 — 흡수량 비례 소형 밀어내기. 변위 = 흡수량 × (1.2 + 0.15×Lv) · 반경 120.
  const fi4 = lv(state, Sk.pressureVent);
  if (fi4 >= 1 && player.aux0 > 0) {
    // 배율은 정수 bp · 나눗셈 1회(ADR-0005). 변위 자체는 좌표라 f64 로 해시된다.
    const push = (absorbed * (12000 + 1500 * fi4)) / 10000;
    const r2 = FI4_VENT_RADIUS * FI4_VENT_RADIUS;
    for (const e of state.entities) {
      // 대상 `enemy` 한정 — 침공 방어체(prop·facility*)는 배치 좌표가 소켓 계약이고 벽은
      // `activeWalls` 재빌드와 얽힌다(`filmBurst.ts` 의 같은 판단).
      if (e.dead || e.kind !== 'enemy') continue;
      const dx = e.x - player.x;
      const dy = e.y - player.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const d = length(dx, dy);
      // 정확히 겹친 적은 밀 방향이 정의되지 않는다 — 임의 방향을 만들지 않고 둔다.
      if (d <= 1) continue;
      e.x += (dx / d) * push;
      e.y += (dy / d) * push;
      // ⚠️ 벽 충돌 **즉시** 재해결. 변위가 벽 두께를 넘으면 다음 틱 `slideCircleWalls` 가
      // 최근접 면으로 밀어 반대편으로 튀어나온다(터널링) — 결정론은 유지되므로 해시 검증으로는
      // 절대 안 잡히는 조용한 배치 계약 위반이다(`resolveFilmBurst` 의 같은 경고).
      if (state.activeWalls.length > 0) {
        const slid = slideCircleWalls(e.x, e.y, e.radius, state.activeWalls);
        e.x = slid.x;
        e.y = slid.y;
      }
    }
  }
}
