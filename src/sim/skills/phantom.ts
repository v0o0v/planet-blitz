/**
 * **팬텀 30스킬의 효과 본체**(ADR-0049 배치 4 · 설계 정본
 * `.omc/plans/skill-rebuild-2026-08-05/phantom.md` 4판).
 *
 * 형태는 **스트라이커 레인이 확립한 다섯 규율을 그대로 따른다**(`skills/striker.ts` 헤더가 정본):
 * ①`world.ts` 런타임 import 0건(타입은 type-only) ②모든 쓰기는 투자 게이트 안쪽 ③반올림은
 * 게이트 안 ④RNG 소비 0 ⑤슬롯 접근은 `readSlot`/`writeSlot` 만.
 *
 * ---
 *
 * ## ⚠️ 은신 사이클 조작은 **`cloak.ts` 헬퍼 3종만** 쓴다
 * `advanceCloak`·`fireCloakEntry`·`setBreakToken`(+ 통과 판정 `crossed` 계열)이 이미 정본으로
 * 서 있다. `player.aux0` 을 직접 밀거나 `=== 임계` 로 에지를 다시 판정하지 마라 — 그 형태는
 * 임계를 건너뛰어 진입 훅과 배율 토큰을 **조용히** 죽인다(`cloak.ts` 의 각 함수 주석이 근거).
 *
 * ## ⚠️ 진입 에지 훅(PH7·DI7·DI8)은 이 파일이 아니라 `skills/phantomEntry.ts` 에 있다
 * 이 파일이 `cloak.ts` 를 런타임 import 하므로, `cloak.ts` 의 `fireCloakEntry` 가 이 파일을
 * 부르면 곧바로 순환이다. 사유와 그래프는 그 파일 헤더에 있다.
 *
 * ## ⚠️ `player.aux0`/`aux1` 은 시그니처가 점유한다
 * `aux0` = 연속 무피격 틱(0..359) · `aux1` = 해제 첫 타 배율 토큰(0/1). 스킬이 쓸 칸이 아니다 —
 * 상태가 필요하면 `PhantomCarry`/`PhantomStage` 슬롯을 잡는다.
 *
 * ---
 *
 * ## ⚠️ 지금 배선된 것은 30종 중 **20종**이다 (S3 이 16 → 19, 공유 앵커 레인이 +1 = 20)
 *
 * 공유 앵커 레인이 더한 하나는 **PH2「위상 착지」**({@link phantomActiveFired}) — 앵커 ㉗
 * (`onActiveFired`, 액티브 핸들러 **직후**)이 열었다. 막고 있던 것은 "착지 지점을 아는 자리가
 * 없다" 였는데, 앵커가 호출 뒤라 `player.x/y` 가 이미 착지점이라는 사실 하나로 풀렸다.
 * S3 이 더한 셋은 전부 **기존 앵커만으로** 섰다:
 *  - **AS9「절멸 선고」**(앵커 ⑩) — AS3 이 이미 나르던 강화탄 표식({@link MARK_CLOAK_BREAK})을
 *    같은 자리에서 읽어 명중 지점 폭발을 낸다. 막고 있던 것은 "소진 지점이 앵커가 아니다" 였는데,
 *    표식이 그 판정을 탄에 실어 나르므로 소진 지점이 필요 없었다.
 *  - **PH3「그림자 장부」**(앵커 ⑨ 본체 + 앵커 ③ 스케일) — 콤보 시계 감소부(`world.ts`)가
 *    앵커가 아니라는 벽은 그대로지만, **감소가 정확히 `-1` 한 곳뿐**이고 앵커 ⑨ 가 그보다
 *    앞이라 같은 틱에 `+1` 하면 값이 비트 단위로 같다. 그래서 앵커 ③ 의 스케일이 더 이상
 *    "본체 없는 곁가지"가 아니다.
 *  - **PH6「정지된 시계」**(앵커 ② 예약 + 앵커 ⑨ 집행 + 진입 에지 리셋) — 앵커 ② 가 적립보다
 *    뒤라는 벽을 **예약/집행 분리**로 넘었다. 창당 총량은 예산과 같다.
 *
 * ## (앞 단계) S2 앵커로 12 → 15, S2.1 로 15 → 16
 * S2 가 앵커 ㉑(`onCloakBreakReset`, 팬텀 리셋 **직전**)과 ⑯(`onVolleyParams`, 탄 생성 직전)을
 * 열면서 셋이 살아났다 — **DI1「위상 정산」·PH10「발각 즉응」**(둘 다 리셋 전 스트릭을 요구해
 * 앵커 ④ 에서는 상시 0·상시 거짓이었다)과 **AS2「은막 침투」**(볼리 파라미터가 필요했다).
 * S2.1 의 `VolleyParams.cloakBreak` 이 **AS3「처형 재장전」**을 더 열었다.
 *
 * 나머지 11종은 아직 앵커가 닿지 않는 지점을 요구한다 — 사유는 각 앵커의 `case` 주석과 레인
 * 보고서에 있다. 여기 없는 스킬은 "구현했는데 안 불린다"가 아니라 **아직 코드가 없다.**
 * 가장 큰 덩어리는 여전히 **해제 첫 타 배율의 소진 지점**(`world.ts` autoAttack 의 `aux1`
 * 소진 분기)이다 — AS1·AS8·DI10 셋이 아직 거기에 달려 있다.
 * ⚠️ **AS1 을 `setBreakToken` 재장전으로 대체하지 마라.** 토큰은 0/1 이진이라 다시 세우면
 * 후속 타가 **원배율(2.5배)** 을 받는데, 설계서 AS1 의 후속 배율은
 * `25000 × (0.3 + 0.6×Lv/(Lv+15))` bp(Lv1 ≈ 0.85배 · Lv20 ≈ 1.6배)로 **원배율보다 작다.**
 * 그 대체는 AS3(재장전 = 원배율)과 값이 같아져 두 스킬이 하나가 된다.
 * 앵커 ⑯ 은 그 소진 **뒤**라
 * "이번 볼리가 그 강화탄이었나" 를 그 자리에서는 알 수 없었고(`params.mark === 1` 은 스트라이커
 * 정조준 전용이고, 팬텀 소진 분기는 표식을 남기지 않는다), S2.1 이 **판정 결과만** 레코드에
 * 실어 AS3 하나를 뽑아냈다. 남은 넷은 배율 **값**이나 소진 **직전** 상태를 요구해 그 칸으로는
 * 닿지 않는다.
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
// ⚠️ **타입 전용이다.** `skillHooks.ts` 는 이 파일을 런타임 import 하므로 값으로 당기면 곧바로
// 순환이다 — `import type` 은 컴파일에서 지워져 그래프에 간선을 만들지 않는다.
import type { PlayerMoveParams, VolleyParams } from '../skillHooks.js';
// PH2 의 계열 게이트가 읽는 액티브 정의. 타입 전용(위 사유와 같다).
import type { ActiveSkillDef } from '../../../data/ships/actives/types.js';
import { advanceCloak, playerCloaked, setBreakToken } from '../cloak.js';
import { clearEnemyBullets } from '../activeTypes.js';
import { COLD_DURATION, applySlow } from '../status.js';
import { slideCircleWalls } from '../los.js';
import { length } from '../math.js';
import { readSlot, writeSlot, PhantomCarry, PhantomStage } from '../skillSlots.js';
import { CLOAK_HOLD_TICKS, CLOAK_UNHIT_TICKS, cloakWindowActive } from '../shipSignature.js';
import { skillLv } from '../../items/skills.js';

// ---------------------------------------------------------------------------
// flat 인덱스 — `data/ships/phantom.ts` 의 축 순서가 정본
// ---------------------------------------------------------------------------
//
// `trees: [assassin(offense), phase(utility), disrupt(defense)]` 이므로
// AS1..AS10 = 0..9 · PH1..PH10 = 10..19 · DI1..DI10 = 20..29 다.
//
// ⚠️ **세 기체가 전부 다른 축 순서를 쓴다** — 스트라이커 [offense, defense, utility] ·
// 아크캐스터 [offense, utility, defense] · 팬텀 [offense, utility, defense]. 설계서의 서술
// 순서와 우연히 맞아도 정본은 언제나 `trees` 배열이다.

const enum Sk {
  /** AS2 은막 침투 */ cloakPierce = 1,
  /** AS3 처형 재장전 */ executionReload = 2,
  /** AS4 급소 해부 */ vitalDissection = 3,
  /** AS5 배후 격살 */ backstab = 4,
  /** AS9 절멸 선고 */ annihilationVerdict = 8,
  /** PH1 잔상 이탈 */ afterimageExit = 10,
  /** PH2 위상 착지 */ phaseLanding = 11,
  /** PH3 그림자 장부 */ shadowLedger = 12,
  /** PH4 무흔 보행 */ tracelessStride = 13,
  /** PH6 정지된 시계 */ frozenClock = 15,
  /** PH8 흔적 흡수 */ traceSiphon = 17,
  /** PH10 발각 즉응 */ blownCoverReflex = 19,
  /** DI1 위상 정산 */ phaseLiquidation = 20,
  /** DI2 은둔 재생 */ cloakedMending = 21,
  /** DI3 초탄 감쇄 */ firstHitAttenuation = 22,
  /** DI4 반발 위상 */ repulsePhase = 23,
  /** DI5 최후 위상 */ lastPhase = 24,
  /** DI6 차폐 잠행 */ coverStalk = 25,
}

/**
 * 이 런에서 그 스킬의 **실효 레벨**(투자 + 축 어픽스). 미투자면 0 이다(`skillLv` 정본 1).
 * 기체 게이트는 호출부(`skillHooks.ts` 의 `case SIG_PHANTOM_CLOAK`)가 이미 걸었다.
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
// 상수 · 레벨 스케일
// ---------------------------------------------------------------------------

/**
 * AS3 강화탄 표식 — 앵커 ⑯ 이 `VolleyParams.mark` 로 찍고 앵커 ⑩ 이 탄 `aux0` 에서 읽는다.
 *
 * ⚠️ **값 `1` 은 정조준탄(스트라이커)이 점유했다.** 기체는 한 런에 하나뿐이라 물리적으로
 * 겹치지 않지만 값이 겹치면 렌더·후속 판정이 두 표식을 구분하지 못한다(앵커 ⑯ 주석).
 * 브루저와 같은 **비트 플래그** 형태로 둔다 — AS10(유령 탄도)이 훗날 배선되면 탄 `aux1` 을
 * 쓰므로(설계서 AS10 "AS3 의 `aux0` 마커와 칸 분리") 이 비트와 다투지 않는다.
 */
const MARK_CLOAK_BREAK = 2;

/**
 * PH2 의 계열 게이트 — 「위상(phase)」축의 인덱스. 정본은 `data/ships/phantom.ts` 의
 * `trees: [assassin(offense), phase(utility), disrupt(defense)]` 배열이다.
 * ⚠️ 축 순서를 바꾸면 여기도 함께 밀린다(그 파일이 "재배치 금지"를 명시한 이유 중 하나).
 */
const PHASE_TREE_INDEX = 1;

/**
 * DI2 회복 주기. 설계서 고정값(창 안 60틱마다) — 진입 틱 공짜 회복을 없애려고 `aux0 > 240` 을
 * 함께 본다(설계서 DI2 의 MINOR 정정).
 */
const MENDING_PERIOD = 60;

/**
 * DI4 밀어내기 반경. **밸런스 각주**다 — 설계서 DI4 는 변위량(60 + 8×Lv)만 정하고 반경을
 * 비워 뒀다(헌장 두 게이트 기준 어느 쪽도 아님 → 출시 전 일괄 패스 대상). 여기 상수 하나로
 * 모아 둔 것은 그때 고칠 자리를 하나로 만들기 위해서다.
 */
const REPULSE_RADIUS = 220;

/**
 * PH6 창당 정지 예산 = `min(12 + floor(2.4×Lv), CLOAK_HOLD_TICKS/2)` 틱 (설계서 PH6, 2판 유계화).
 *
 * `2.4 × Lv` 를 f64 로 곱하지 않고 `floor(24×Lv/10)` 으로 적는 것은 규율 ③ 이 아니라 **결정론**
 * 때문이다 — `2.4` 는 이진 부동소수로 정확히 표현되지 않아 Lv 에 따라 `floor` 가 갈릴 수 있다.
 *
 * 상한이 `HOLD/2` 인 것이 유계의 전부다: 창 하나가 스스로를 1.5배 이상 늘릴 수 없고,
 * PH5 가 HOLD 를 늘리면 상한도 절반씩 따라 늘어 비율이 보존된다(`shipSignature.ts` 가 폐기한
 * 영구 은신이 재현되지 않는 근거).
 */
function frozenClockBudget(level: number): number {
  const raw = 12 + Math.floor((24 * level) / 10);
  const cap = Math.floor(CLOAK_HOLD_TICKS / 2);
  return raw < cap ? raw : cap;
}

/** DI5 내부 쿨다운 = 3600 − 3600×Lv/(Lv+30) 틱 (Lv1 ≈ 3484, Lv20 = 2160, 점근 0·도달 없음). */
function lastPhaseCooldownTicks(level: number): number {
  return 3600 - Math.floor((3600 * level) / (level + 30));
}

/**
 * DI3 감소 bp = 6000×s/(s+2000), s = aux0×(4+Lv).
 *
 * ⚠️ 나눗셈이 `skillDerived` 가 아니라 여기 있는 사유는 `skills/striker.ts` 의 같은 주석이
 * 정본이다(`world.ts` 런타임 import 또는 이중 정본 둘 중 하나가 되기 때문). 이 함수는 **선체
 * hp 가 실제로 깎이는 피격 틱**에만 불린다 — sim 루프의 상시 나눗셈이 아니다.
 */
function attenuationBp(streak: number, level: number): number {
  const s = streak * (4 + level);
  if (s <= 0) return 0;
  return Math.floor((6000 * s) / (s + 2000));
}

// ---------------------------------------------------------------------------
// 앵커별 진입점 — `skillHooks.ts` 의 `case SIG_PHANTOM_CLOAK:` 이 부른다
// ---------------------------------------------------------------------------

/**
 * 앵커 ② **대시 발동** — PH1 잔상 이탈 · PH6 정지된 시계(예약 절반).
 *
 * 전진은 반드시 {@link advanceCloak} 경유다: 240 에서 멈추고 진입 에지를 정상 발화하며,
 * **창 안 대시는 무효**(창 조작은 PH6 의 전유 축 — 설계서 ①-3 의 택일 확정). 침공 no-op 도
 * 헬퍼에 내장돼 있어 여기서 다시 보지 않는다.
 *
 * ## ⚠️ PH6 은 여기서 **집행하지 않고 예약만** 한다 — 앵커 순서가 그렇게 강제한다
 * 이 앵커는 `stepShipSignature` 의 팬텀 적립(`aux0++`)보다 **뒤**다(world.ts 2250 vs 1874).
 * 즉 대시 틱에는 그 틱의 증가가 이미 끝나 있어 막을 수 없다. 그래서 여기서는 플래그
 * ({@link PhantomStage.frozenClockPending})만 세우고, **다음 틱의 앵커 ⑨** 가 적립 직전에
 * 1틱을 되돌려 집행한다({@link phantomSignatureStep}).
 *
 * 한 틱이 밀리지만 **창당 정지 총량은 예산과 정확히 같다** — DI6 이 "직전 틱 vs 이번 틱" 을
 * 같은 근거로 처리한 것과 같은 등가 교환이고, 이쪽도 새 술어를 발명하지 않는다.
 * `skillHooks.ts` 앵커 ② 의 옛 주석이 *"사후에 1 을 빼는 흉내는 예산·되감기 경계와 갈린다"* 고
 * 경고했는데, 갈리는 것은 **예산 없이 사후 보정할 때**다: 예산 소비를 집행 지점에서 세고
 * 되감기(진입 에지) 때 0 으로 되돌리면 두 경계가 모두 코드에 남는다.
 *
 * PH1 과의 상호 배타도 여기서 자연히 선다 — 창 밖 대시는 `playerCloaked` 가 거짓이라 PH6 이
 * 안 걸리고, 창 안 대시는 `advanceCloak` 이 규칙 2 로 no-op 이라 PH1 이 안 걸린다(설계서 PH6).
 */
export function phantomDashFired(state: WorldState, player: Entity): void {
  // ① PH1 잔상 이탈
  const ph1 = lv(state, Sk.afterimageExit);
  if (ph1 >= 1) advanceCloak(state, player, 20 + 4 * ph1);

  // ② PH6 정지된 시계 — 예약. 예산이 남아 있고 **지금 창 안일 때만** 산다.
  const ph6 = lv(state, Sk.frozenClock);
  if (ph6 < 1) return;
  // `playerCloaked` 하나로 침공 차단·기체 게이트·창 술어가 전부 닫힌다(정본 하나).
  if (!playerCloaked(state, player)) return;
  if (readSlot(state.skillStage, PhantomStage.frozenClockUsed) >= frozenClockBudget(ph6)) return;
  writeSlot(state.skillStage, PhantomStage.frozenClockPending, 1);
}

/**
 * 앵커 ㉗ **액티브 발동 직후** — PH2 위상 착지.
 *
 * 설계서: *"위상 액티브(blink) **착지 지점** 주변 적탄을 소거하고 냉기를 건다"* ·
 * 소거 반경 = 140 + 10×Lv.
 *
 * ## 왜 좌표 인자가 없는가
 * 앵커 ㉗ 은 핸들러 호출 **뒤**라 `player.x`/`player.y` 가 **이미 착지점**이다(벽 슬라이드
 * 보정까지 반영된 최종 좌표 — `activeTypes.blink` 가 `slideCircleWalls` 로 끝난다). 그래서
 * `clearEnemyBullets(state, player, r)` 의 기존 시그니처(플레이어 중심)를 그대로 쓴다.
 * ⚠️ 출발 지점이 필요한 스킬은 반대로 `ActiveFiredOrigin.preX/preY` 를 써야 한다.
 *
 * ## 계열 게이트 — `treeIndex === 1`
 * 「위상 액티브」는 phase 축(`data/ships/phantom.ts` 의 `trees[1]`)의 두 종
 * (`as_phantom_phase_lo`/`_hi`)이다. 둘 다 `kind: 'dash'` = blink 라 착지가 존재한다.
 * ⚠️ **id 문자열로 판정하지 마라** — 축 인덱스가 정본이고, id 는 레지스트리 파일의 표기다.
 * ⚠️ **`kind === 'dash'` 로도 판정하지 마라** — 다른 축이 훗날 dash 계열을 얻으면 조용히 샌다.
 *
 * ## 냉기는 잡몹 한정이다
 * 스트라이커 M6(활공 정화)이 확립한 형태 그대로다 — `kind === 'enemy'` 만 건다. 보스·가디언에
 * 거는 것은 냉기 자체의 적용 범위를 바꾸는 일이라 이 레인 밖이다.
 * 적 `hp` 를 깎지 않으므로 좀비 결함(`dead` 미마킹)이 원리적으로 없다.
 */
export function phantomActiveFired(state: WorldState, player: Entity, def: ActiveSkillDef): void {
  if (def.treeIndex !== PHASE_TREE_INDEX) return;
  const ph2 = lv(state, Sk.phaseLanding);
  if (ph2 < 1) return;
  const radius = 140 + 10 * ph2;
  clearEnemyBullets(state, player, radius);
  const r2 = radius * radius;
  for (const e of state.entities) {
    if (e.kind !== 'enemy' || e.dead) continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    if (dx * dx + dy * dy > r2) continue;
    applySlow(e, COLD_DURATION);
  }
}

/**
 * 앵커 ③ **젬 수거** — PH8 흔적 흡수 · PH3 그림자 장부(레벨 스케일).
 *
 * PH8 은 젬 1개당 +1 + ceil(Lv/5) 틱 (Lv20 = +5, 5레벨 폭 계단).
 *
 * ⚠️ 이 앵커는 침공에서도 불린다(침공 편대원·스포너 드론이 젬을 뿌린다 — 앵커 ③ 주석).
 * 그래도 안전한 것은 `advanceCloak` 이 침공에서 no-op 이고 `playerCloaked` 가 침공에서 거짓이기
 * 때문이다 — "침공엔 젬이 없다"에 기대지 않는다.
 *
 * ## PH3 의 레벨 스케일이 여기 오는 것은 이제 **곁가지가 아니다**
 * 앵커 ③ 의 옛 주석은 "본체(창 중 콤보 시계 정지)가 `world.ts` 라 여기 레벨 스케일만 얹으면
 * 반쪽 배선" 이라고 적었다. 그 본체가 앵커 ⑨ 에 섰으므로({@link phantomSignatureStep} 의 PH3
 * 문단) 전제가 사라졌다 — 본체와 스케일이 같은 런에서 함께 돈다.
 *
 * `state.comboTimer` 는 이 앵커 **직전에** `collectGem` 이 `COMBO_WINDOW_TICKS` 로 **대입**하고
 * 탐욕 보너스를 더한 뒤다(world.ts 4632·4637). 그래서 여기 가산은 설계서의 "기본 회복에 가산"
 * 그대로이고, 대입이 앞에 있으므로 젬을 아무리 주워도 상한이 `창 + 탐욕 + (2+Lv)` 로 유계다.
 */
export function phantomGemCollected(state: WorldState, player: Entity): void {
  // ① PH8 흔적 흡수
  const ph8 = lv(state, Sk.traceSiphon);
  if (ph8 >= 1) advanceCloak(state, player, 1 + Math.ceil(ph8 / 5));

  // ② PH3 그림자 장부 — 창 중 수거의 콤보 창 회복량 가산(+2 + 1×Lv 틱).
  const ph3 = lv(state, Sk.shadowLedger);
  if (ph3 < 1) return;
  if (!playerCloaked(state, player)) return;
  state.comboTimer += 2 + ph3;
}

/**
 * 앵커 ⑦ **벽 접촉 틱** — DI6 차폐 잠행. 접촉 틱당 +1 + floor(Lv/10) 틱 (Lv20 = +3).
 *
 * ## 설계서의 "직전 틱"과 이 앵커의 "이번 틱"
 * 설계서는 "직전 틱에 벽 슬라이드가 일어났으면 **그 틱의** 적립이 가속" 이라고 적었다. 이
 * 앵커는 `wallContactTicks` 갱신 **직후**·접촉이 참인 틱에만 불리므로 여기서 가속하면 대상이
 * "이번 틱"이 된다 — 한 틱 차이이고, 연속 접촉 구간에서는 총 적립량이 같다(첫 틱이 앞당겨지고
 * 마지막 틱이 빠질 뿐). 설계서가 요구한 신규 플래그(구현 태그 B)를 세우지 않은 것도 같은
 * 이유다: S0 의 E5 가 `state.wallContactTicks` 로 같은 술어를 이미 엔진 상태로 세웠고,
 * 같은 술어를 슬롯에 복제하면 갱신 시점이 갈려 조용히 어긋난다(스트라이커 M5·S4 선례).
 */
export function phantomWallContact(state: WorldState, player: Entity): void {
  const di6 = lv(state, Sk.coverStalk);
  if (di6 < 1) return;
  advanceCloak(state, player, 1 + Math.floor(di6 / 10));
}

/**
 * 앵커 ⑧ **감쇠 사슬의 스킬 슬롯** — DI3 초탄 감쇄(**감소** 칸). 흡수 칸을 쓰는 팬텀 스킬은 없다.
 *
 * ## 이 지점의 `aux0` 은 아직 **피격 리셋 전**이다
 * 팬텀 피격 리셋(`world.ts` 의 `player.aux0 = 0`)은 사슬 **뒤**, hp 차감 뒤에 온다. 그래서
 * 여기서 읽는 스트릭이 정확히 설계서가 요구한 "이 피격 직전까지 쌓인 무피격 틱" 이다 —
 * 이 순서가 뒤집히면 이 스킬은 상시 0 감소가 되어 조용히 죽는다.
 *
 * 침공에서는 `aux0` 이 끝까지 0 이라 `s = 0` → 감소 0 으로 자연 no-op 이다(상수항 없음).
 */
export function phantomDamageChain(state: WorldState, player: Entity, dmg: number): number {
  const di3 = lv(state, Sk.firstHitAttenuation);
  if (di3 < 1) return dmg;
  const bp = attenuationBp(Math.trunc(player.aux0), di3);
  if (bp <= 0) return dmg;
  // 반올림은 이 게이트 **안**이다(규율 ③) — 접촉 피해에 엘리트 배율이 섞여 소수로 들어올 수
  // 있고, 반올림이 게이트 밖으로 나가면 스킬 없는 런의 소수 피해까지 바뀐다.
  const out = dmg - Math.round((dmg * bp) / 10000);
  return out > 0 ? out : 0;
}

/**
 * 앵커 ④ **선체 hp 가 깎인 피격의 후속** — DI4 반발 위상 · DI5 최후 위상.
 *
 * ## ⚠️ DI1·PH10 은 여기 없다 — **앵커 ㉑ 으로 옮겨 갔다**(S2)
 * 설계서 공통 구현 고지 ④ 는 순서를 **DI1(리셋 전 aux0 읽기) → PH10(창 술어) → 리셋 →
 * DI5(진입)** 로 못 박았는데, 이 앵커는 팬텀 피격 리셋(`world.ts` 의 `aux0 = 0` +
 * `setBreakToken(…, 0)`) **뒤**에 있다. 즉 여기 도달한 시점의 `aux0` 은 **항상 0** 이라
 * DI1 의 반경 보정(aux0/2)은 영영 0 이 되고 PH10 의 "창 중 피격" 술어는 영영 거짓이다.
 * S2 가 리셋 **직전**에 앵커 ㉑ 을 뚫었고, 그 둘은 {@link phantomCloakBreakReset} 에 산다.
 * (DI5 만 "리셋 **이후**"가 설계 순서라 여기서 정확히 성립한다 — 그래서 여기 남는다.)
 *
 * @param dmg 실제로 hp 에서 차감된 피해 — DI5 의 임계 통과 판정이 피격 **전** hp 를 복원하는 데 쓴다
 */
export function phantomPlayerDamaged(state: WorldState, player: Entity, dmg: number): void {
  // ① DI4 반발 위상 — 주변 적을 좌표 직접 변위로 밀어낸다(`resolveFilmBurst` 동형).
  const di4 = lv(state, Sk.repulsePhase);
  if (di4 >= 1) {
    const push = 60 + 8 * di4;
    const r2 = REPULSE_RADIUS * REPULSE_RADIUS;
    for (const e of state.entities) {
      if (e.dead) continue;
      // 잡몹·보스만 민다. 구조물·기물·탄은 좌표가 배치 계약이라 밀면 무대가 무너진다.
      const isBoss = e.kind === 'boss';
      if (e.kind !== 'enemy' && !isBoss) continue;
      const dx = e.x - player.x;
      const dy = e.y - player.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const d = length(dx, dy);
      // 중심과 정확히 겹친 적은 밀 방향이 정의되지 않는다 — 임의 방향을 만들지 않고 둔다
      // (`resolveFilmBurst` 와 같은 판단).
      if (d <= 1) continue;
      // 보스·엘리트는 반감. 엘리트 술어는 `isElite` 의 정의(`kind === 'enemy' && pierce > 0`)를
      // 그대로 적는다 — `elite.ts` 를 import 하면 그쪽이 `world.ts` 를 런타임으로 당긴다.
      const heavy = isBoss || e.pierce > 0;
      const amount = heavy ? Math.round(push / 2) : push;
      if (amount <= 0) continue;
      e.x += (dx / d) * amount;
      e.y += (dy / d) * amount;
      // ⚠️ 밀어낸 직후 벽 충돌을 **즉시** 재해결한다(`resolveFilmBurst` 의 MED-4 와 같은 사유):
      // 변위가 벽 두께보다 크면 적이 벽 안쪽에 박히고, 다음 틱 `slideCircleWalls` 가 최근접
      // 면으로 밀어내며 반대편으로 튀어나온다(터널링). 결정론은 유지되므로 해시 검증으로는
      // 절대 안 잡히는 조용한 배치 계약 위반이다.
      if (state.activeWalls.length > 0) {
        const slid = slideCircleWalls(e.x, e.y, e.radius, state.activeWalls);
        e.x = slid.x;
        e.y = slid.y;
      }
    }
  }

  // ② DI5 최후 위상 — HP 가 30% 아래로 **떨어지는 그 틱**에 즉시 은신 진입(내부 쿨다운 있음).
  //
  // ⚠️ 침공 게이트를 **트리거 자체에** 병기한다(설계서 ④ 표 DI5). `advanceCloak` 이 침공에서
  //    no-op 이라 이득은 이미 막혀 있지만, 게이트가 없으면 쿨다운 카운터만 런 내내 돌며
  //    `skillCarry` 폴드에 실려 침공 해시를 바꾼다 — 아무것도 안 하는 상태가 해시에 접히는
  //    것이 "구현했는데 안 불린다"의 해시판이다.
  if (state.config.invasion3 !== undefined) return;
  const di5 = lv(state, Sk.lastPhase);
  if (di5 < 1) return;
  if (readSlot(state.skillCarry, PhantomCarry.lastPhaseCooldown) > 0) return;
  // 임계 통과 판정 — 정수 비교로 한다(`hp × 10000` vs `maxHp × 3000`). 부동소수 임계값을
  // 만들면 hp 가 정수인데 판정만 소수가 되어 경계 틱이 기체마다 갈린다.
  const thr = player.maxHp * 3000;
  const before = player.hp + dmg;
  if (!(player.hp * 10000 < thr && before * 10000 >= thr)) return;
  if (player.hp <= 0) return;
  advanceCloak(state, player, CLOAK_UNHIT_TICKS);
  writeSlot(state.skillCarry, PhantomCarry.lastPhaseCooldown, lastPhaseCooldownTicks(di5));
}

/**
 * 앵커 ⑨ **시그니처 틱 진행**(매 틱 정확히 한 번) — DI2 은둔 재생 · DI5 쿨다운 진행.
 *
 * ## 이 앵커는 팬텀 `aux0++` **보다 앞**이다
 * `stepShipSignature` 진입점이라, 여기서 읽는 `aux0` 은 **직전 틱 말의 값**이다. DI2 의
 * 주기 판정이 그 전제 위에 선다: 진입 틱(aux0 = 240)에는 `> 240` 이 거짓이라 공짜 회복이
 * 없고, 60틱 뒤 `aux0 = 300` 인 틱에 첫 회복이 온다 — 설계서 DI2 의 "첫 회복은 진입 60틱 후"
 * 그대로다. 기본 창(HOLD 120)에서는 창당 정확히 1회다.
 *
 * 침공에서는 `aux0` 이 끝까지 0 이라 DI2 가 자연 no-op 이다.
 */
export function phantomSignatureStep(state: WorldState, player: Entity): void {
  // ① DI2 은둔 재생 — 창 안 60틱마다 2 + 1×Lv HP.
  const di2 = lv(state, Sk.cloakedMending);
  if (di2 >= 1) {
    const a = Math.trunc(player.aux0);
    if (a > CLOAK_UNHIT_TICKS && (a - CLOAK_UNHIT_TICKS) % MENDING_PERIOD === 0) {
      const heal = 2 + di2;
      const next = player.hp + heal;
      player.hp = next > player.maxHp ? player.maxHp : next;
    }
  }

  // ② DI5 내부 쿨다운 진행. 게이트 안에서만 만진다 — 미투자 런은 슬롯이 0 인 채로 남아야
  //    "전 슬롯 0 이면 무폴드" 가 성립한다(`skillSlots.ts` 값 규약 3).
  const di5 = lv(state, Sk.lastPhase);
  if (di5 >= 1) {
    const cd = readSlot(state.skillCarry, PhantomCarry.lastPhaseCooldown);
    if (cd > 0) writeSlot(state.skillCarry, PhantomCarry.lastPhaseCooldown, cd - 1);
  }

  // ③ PH3 그림자 장부(본체) — 은신 창 동안 콤보 시계가 멈춘다.
  //
  // ## 왜 "감소부에서 스킵" 이 아니라 "여기서 +1" 인가
  // 설계서의 `구현: A` 는 `updateCombo` 의 감소부에 `playerCloaked` 술어를 넣는 것이고 그 자리는
  // `world.ts` 라 앵커가 아니다. 이 앵커는 그 감소부보다 **앞**이다(world.ts 1874 vs 1936, 같은
  // 틱). 감소가 항상 정확히 `-1` 한 곳뿐이므로(world.ts 4886-4888) 여기서 `+1` 하면 그 틱의
  // 순변화가 0 이 되어 **감소부에서 스킵한 것과 값이 비트 단위로 같다.**
  //  - `comboTimer > 0` 게이트가 필수다. 0 일 때 올리면 콤보가 0 인데 시계만 도는 유령 상태가
  //    생기고, 감소부의 `=== 0 → combo = 0` 이 영영 안 돌아 콤보 만료가 사라진다.
  //  - 창은 유한(HOLD)이라 영구화가 없다. 적립 240틱 > 콤보 창 120틱이므로 사격·은신만으로는
  //    콤보가 반드시 만료된다(설계서 PH3 의 콤보 수지 판정).
  //
  // ⚠️ 이 앵커의 `aux0` 은 **직전 틱 말**의 값이라, 창 경계에서 정지가 한 틱 어긋난다. DI2 가
  //    같은 전제 위에 서 있고(위 ① 문단), 총 정지 틱 수는 창 길이와 같다.
  const ph3 = lv(state, Sk.shadowLedger);
  if (ph3 >= 1 && state.comboTimer > 0 && playerCloaked(state, player)) {
    state.comboTimer++;
  }

  // ④ PH6 정지된 시계(집행) — 대시가 예약한 1틱을 적립 **직전**에 되돌린다.
  //
  // 예약이 왜 필요한지는 {@link phantomDashFired} 의 doc 가 정본이다. 여기서 `aux0` 을 1 내리면
  // 곧바로 뒤따르는 world 의 `aux0++` 가 그것을 되돌려 **순변화 0** — 이것이 "시계가 멈춘다" 다.
  //
  // ## ⚠️ 세 가드가 전부 필요하다
  //  ⓐ `a > CLOAK_UNHIT_TICKS`(**강부등호**) — `a === 240` 에서 239 로 내리면 world 의 `++` 가
  //    `cloakEntryCrossed(239, 240)` 을 참으로 만들어 **진입 훅(PH7·DI7·DI8)이 재발화**한다.
  //    DI8 은 최대 HP 영구 증가라 그 재발화는 창 하나당 무한 성장이 된다.
  //  ⓑ `cloakWindowActive(a)` — 창 밖(되감기 직후)에서 예약이 남아 있어도 집행하지 않는다.
  //  ⓒ 예산 재확인 — 예약 시점과 집행 시점 사이에 다른 대시가 끼어 예산을 다 쓸 수 있다.
  // 예약은 조건 성립 여부와 무관하게 **소비한다**(대시 1회 = 예약 1회이지 "언젠가 반드시 정지"가
  // 아니다). 안 지우면 창 밖에서 걸린 예약이 다음 창의 첫 틱을 공짜로 얼린다.
  const ph6 = lv(state, Sk.frozenClock);
  if (ph6 >= 1 && readSlot(state.skillStage, PhantomStage.frozenClockPending) !== 0) {
    writeSlot(state.skillStage, PhantomStage.frozenClockPending, 0);
    const used = readSlot(state.skillStage, PhantomStage.frozenClockUsed);
    const a = Math.trunc(player.aux0);
    if (used < frozenClockBudget(ph6) && a > CLOAK_UNHIT_TICKS && cloakWindowActive(a)) {
      player.aux0 = a - 1;
      writeSlot(state.skillStage, PhantomStage.frozenClockUsed, used + 1);
    }
  }
}

/**
 * 앵커 ⑩ **적성 표적이 아군탄에 맞아 피해가 확정된 직후** — AS3 처형 재장전(회수 절반) ·
 * AS4 급소 해부 · AS5 배후 격살.
 *
 * ## 두 스킬 다 "증폭"이 아니라 **추가 피해**로 구현된다
 * 설계서는 둘을 "명중 피해 증폭"으로 적었지만 이 앵커는 차감·격추 판정이 **이미 끝난** 자리다.
 * 그래서 증폭분을 추가 피해로 얹는다 — 총 피해량은 같고, 다른 것은 **격추 시점**뿐이다.
 * 브루저 BL9(중압 리듬)의 강타가 같은 자리에서 같은 형태(`target.hp -= bonus`)를 이미 쓰고 있어
 * 선례를 따랐다.
 *
 * ⚠️ **정정(2026-08-07)**: 이 문단에 원래 *"추가분이 마지막 일격이면 그 적은 이번 틱이 아니라
 * **다음 틱에 죽는다**"* 고 적혀 있었는데 **사실이 아니다**. `hp<=0 → dead` 를 훑는 일반 스윕이
 * sim 에 **없다**(`world.ts`·`status.ts` 전수 확인) — 다음 틱에도, 그 뒤로도 저절로 죽지 않는다.
 * 표적이 탄을 **견디고**(hp > 0) 추가분에 hp≤0 이 되면 격추 판정(`world.ts:4171`)은 이미 지나간
 * 뒤라 아무도 `dead` 를 안 세우고, `compact` 의 1차 게이트가 `dead` 이므로(`world.ts:4753`) 그
 * 표적은 **좀비**로 남는다 — 계속 움직이고 공격하며 처치·젬·전리품이 전부 유실된다.
 * 그래서 아래 두 자리에서 `hp<=0 → dead` 를 **함께** 세운다(`status.ts:111-112` 와 같은 형태).
 * ⚠️ 여전히 `target.hp`/`target.dead` 를 **되돌리지는 않는다**(앵커 ⑩ 의 금지 사항). 표적이 이미
 * 죽었으면 `dead` 는 참이라 그 마킹이 **무연산**이고, 살아남았으면 격추 판정을 탄 적이 없어
 * 뒤집을 판정 자체가 없다. 앵커 ⑩ 의 금지 문장(`skillHooks.ts:828-830`)은 오히려
 * *"hp 를 0 으로 만들어도 `dead` 가 거짓이면 죽지 않는다"* 며 이 결함을 직접 경고한다.
 *
 * ## 덮는 범위는 아군탄 명중 하나뿐이다
 * 화염 DoT·전격 연쇄·폭탄 기물·액티브 폭발·격실 탄은 leaf 라 이 앵커에 오지 않는다(앵커 주석).
 * 두 스킬 다 설계상 "명중"이 트리거라 그 한계와 정확히 겹친다 — 넓혀 약속하지 않았다.
 * AS3 도 같은 한계 안이고, 설계서가 **"명중 틱 즉시 처치만 인정"** 으로 범위를 스스로 좁혀
 * 뒀다(지연 처치 포섭은 적 필드 신규 상태를 요구하는데 그 필드가 포화라 4판이 배제했다).
 *
 * @param source 가해 아군탄. AS3 이 `aux0` 의 강화탄 표식을 여기서 읽는다.
 */
export function phantomEnemyDamaged(
  state: WorldState,
  player: Entity,
  target: Entity,
  dmg: number,
  source: Entity | undefined,
): void {
  // 코어 실드가 전량 흡수한 명중은 `dmg === 0` 으로도 온다 — "맞았다"가 아니라 "깎였다"를 센다.
  if (dmg <= 0) return;

  // ⓪ AS3 처형 재장전(회수 절반) — 해제 첫 타(강화탄)로 **그 명중 틱에** 죽였으면 배율 토큰을
  //    그 자리에서 다시 세운다.
  //
  // `target.dead` 는 이 앵커에서 **이미 확정**이다(부활·코어 실드가 전부 앞에서 해소됐다).
  // 아래 AS4·AS5 가 얹는 추가 피해는 `dead` 를 바꾸지 않으므로(앵커 ⑩ 의 금지 사항) 순서와
  // 무관하지만, "이 명중이 죽였는가" 를 재는 자리라 셋 중 **맨 앞**에 둔다.
  // ⚠️ 토큰 쓰기는 `setBreakToken` 단일 경로를 거친다(E1) — 침공 차단이 그 헬퍼 안에 있다.
  const as3 = lv(state, Sk.executionReload);
  if (
    as3 >= 1 &&
    target.dead &&
    source !== undefined &&
    (source.aux0 & MARK_CLOAK_BREAK) !== 0
  ) {
    setBreakToken(state, player, 1);
  }

  // ① AS4 급소 해부 — 만피 적에게 명중하는 첫 타에 +12% + 1.8%p/Lv.
  //
  // ## 침공 실드 경로의 상시 참 위험(설계서 AS4 의 MINOR 검증 항목)
  // 실드가 피해를 대신 받으면 `hp === maxHp` 가 매 타 참이 되어 선타 보너스가 상시화된다.
  // **위의 `dmg > 0` 게이트가 그것을 닫는다**: 실드가 전량 흡수하면 `dmg === 0` 으로 와서
  // 제외되고, 실드를 뚫고 hp 가 깎였다면 그 다음 타의 `hpBefore` 는 더 이상 만피가 아니다.
  // 그래서 판정을 `hp + 실드` 로 확장하거나 대상을 제외할 필요가 없다.
  const as4 = lv(state, Sk.vitalDissection);
  if (as4 >= 1 && target.hp + dmg === target.maxHp) {
    const extra = Math.round((dmg * (1200 + 180 * as4)) / 10000);
    if (extra > 0) {
      target.hp -= extra;
      // 좀비 방지 — 대상 범위(enemy+boss)는 `blastDamageAt`·BL3 과 같게 맞춘다. guardian·core 는
      // 일부러 뺐다(그 둘만 `world.ts:4175-4183` 에 부활 분기가 있어 마킹하면 충전을 건너뛴다).
      if (target.hp <= 0 && (target.kind === 'enemy' || target.kind === 'boss')) {
        target.dead = true;
      }
    }
  }

  // ② AS5 배후 격살 — 적의 후방 반구(적→플레이어 벡터와 적 이동 방향의 내적 음수)에서 +10% + 1.5%p/Lv.
  //    정지 적(vx = vy = 0)은 내적이 0 이라 구조적으로 증폭 없음 — 침공 구조물 무영향이
  //    공식에 내장돼 있다(설계서 ④ 표 AS5).
  const as5 = lv(state, Sk.backstab);
  if (as5 >= 1) {
    const dot = (player.x - target.x) * target.vx + (player.y - target.y) * target.vy;
    if (dot < 0) {
      const extra = Math.round((dmg * (1000 + 150 * as5)) / 10000);
      if (extra > 0) {
        target.hp -= extra;
        // 좀비 방지 — 위 AS4 와 같은 두 줄·같은 대상 범위다(사실이 두 벌이 되지 않게).
        if (target.hp <= 0 && (target.kind === 'enemy' || target.kind === 'boss')) {
          target.dead = true;
        }
      }
    }
  }

  // ③ AS9 절멸 선고 — **해제 첫 타(강화탄)가 명중한 지점**에서 폭발.
  //    반경 100 + 10×Lv · 폭발 피해 = 그 첫 타 실피해의 25% + 1.5%p/Lv.
  //
  // ## 트리거는 AS3 과 같은 표식이고 그것이 의도다
  // 설계서 AS9 의 `구현: A` 는 "소진 지점 명중 처리에서 `blastDamage` 1회" 인데, 소진 지점은
  // 앵커가 아니다. 대신 앵커 ⑯ 이 `params.cloakBreak` 로 찍은 {@link MARK_CLOAK_BREAK} 가 그
  // 판정을 탄에 실어 여기까지 나른다 — AS3 이 이미 같은 표식으로 서 있고, 설계서도 둘을
  // "같은 사건의 다른 축"(탄 강화 vs 오브젝트 생성)으로 적었다. 표식이 하나라 두 스킬이
  // 조용히 갈릴 여지가 없다.
  //
  // ## 형태는 브루저 BL3(만재 중탄)의 명중 지점 폭발을 그대로 따른다
  //  - `blastDamage` 를 못 쓴다 — 그 헬퍼는 **플레이어** 중심이고 설계서는 "명중한 지점" 이다.
  //  - **맞은 표적 자신은 제외한다.** 넣으면 AS9 가 "해제 첫 타 피해 +25%" 로 퇴화해 광역이라는
  //    본체가 사라지고, AS1(탄 강화 축)과 구분이 없어진다.
  //  - 대상 범위(enemy+boss)는 `blastDamageAt` 과 같게 맞춘다 — 같은 사실이 두 벌이 되지 않게.
  //  - 순회 중 변형 금지: 플래그만 세우고 엔티티를 낳거나 지우지 않는다(앵커 ⑩ 의 금지 사항).
  //  - 좀비 방지 두 줄이 필수다 — 여기의 `e` 는 격추 판정(`world.ts` 의 `t` 하나)을 **한 번도
  //    안 거친** 주변 적이라, `dead` 를 안 세우면 `compact` 이 못 걷어 처치·젬·전리품이 유실된다.
  const as9 = lv(state, Sk.annihilationVerdict);
  if (as9 >= 1 && source !== undefined && (source.aux0 & MARK_CLOAK_BREAK) !== 0) {
    // 반올림은 게이트 **안**이다(규율 ③). 기준은 `source.damage` 가 아니라 **실피해** `dmg` 다 —
    // 설계서가 "첫 타 실피해의 25%" 로 적었고, 그래야 방어 배율·엘리트 감소를 통과한 뒤의 값이
    // 기준이 된다(BL3 은 설계서가 "탄 피해" 라 `source.damage` 를 쓴다 — 문면이 다르다).
    const blast = Math.round((dmg * (2500 + 150 * as9)) / 10000);
    if (blast > 0) {
      const radius = 100 + 10 * as9;
      const r2 = radius * radius;
      for (const e of state.entities) {
        if (e.dead || e === target) continue;
        if (e.kind !== 'enemy' && e.kind !== 'boss') continue;
        const dx = e.x - target.x;
        const dy = e.y - target.y;
        if (dx * dx + dy * dy > r2) continue;
        e.hp -= blast;
        if (e.hp <= 0) e.dead = true;
      }
    }
  }
}

/**
 * 앵커 ㉑ **팬텀 무피격 스트릭 리셋 직전** — DI1 위상 정산 · PH10 발각 즉응.
 *
 * ## 이 자리가 [치명] 이던 것을 S2 가 풀었다
 * 두 스킬 다 **리셋 전**의 스트릭을 요구하는데 앵커 ④ 는 리셋 뒤였다 — DI1 은 상시 최소 반경,
 * PH10 은 상시 미발동이었다. 여기서는 `streak` 이 인자로 온다: `player.aux0` 을 직접 읽어도
 * 같은 값이지만 인자를 쓰는 것이 **읽는 시점이 리셋 앞이라는 사실**을 코드로 못 박는다(앵커
 * 주석의 계약). 설계서 공통 구현 고지 ④ 의 순서 **DI1 → PH10** 을 이 함수 안에서 지킨다.
 *
 * ## ⚠️ 여기서 `aux0`/`aux1` 을 세우지 않는다
 * 이 훅 **직후**에 world 가 `aux0 = 0` 과 `setBreakToken(…, 0)` 을 실행한다. 스트릭을 보존하는
 * 계열(PH5 연장 위상)은 이 자리가 아니라 리셋 분기 자체를 조건부로 만들어야 한다 — 이 레인 밖.
 *
 * @param streak 리셋 **직전**의 무피격 스트릭
 * @param broken 리셋 직전에 해제 표식(`aux1`)이 서 있었는가.
 *   ⚠️ **두 스킬 다 이 값을 보지 않는다** — DI1 은 "잃는 스트릭에 비례" 이고 PH10 은 "창 중
 *   피격" 이라, 둘 다 *이미 해제 첫 타를 쏜 뒤였는가* 와 무관하다. 그 구분을 쓰는 카드가
 *   생기면 그때 읽는다(지금 억지로 엮으면 설계에 없는 조건이 하나 는다).
 */
export function phantomCloakBreakReset(
  state: WorldState,
  player: Entity,
  streak: number,
  broken: boolean,
): void {
  void broken;
  const s = Math.trunc(streak);

  // ① DI1 위상 정산 — 반경 = (40 + 4×Lv) + streak/2. 쌓아둔 은신이 방벽으로 정산된다.
  //
  // 침공에서도 이 앵커는 돈다(리셋 분기의 게이트는 `signatureOn` 뿐이다). 설계서 ④ 표가 DI1 을
  // **허용**으로 판정한 근거가 그것이다: 스트릭 보정항은 침공에서 aux0 이 상시 0 이라 자연히
  // 죽고, 남는 기본항은 대가(실피격)가 PvE 와 똑같이 걸리는 무대가 스킬이다. 그래서 여기에
  // `invasion3` 게이트를 걸지 않는다 — 걸면 설계 판정과 코드가 갈린다.
  const di1 = lv(state, Sk.phaseLiquidation);
  if (di1 >= 1) {
    // 반올림은 게이트 **안**이다(규율 ③). `streak / 2` 의 홀수 나머지를 버리는 것은 반경이
    // 정수여야 해서다 — 소거 판정은 `r * r` 이라 소수가 끼면 경계 탄이 틱마다 갈린다.
    clearEnemyBullets(state, player, 40 + 4 * di1 + Math.floor(s / 2));
  }

  // ② PH10 발각 즉응 — **은신 창 중에** 깨졌을 때만 대시 쿨다운 전액 환급 + 무적 가산.
  //
  // 창 술어는 `playerCloaked` 가 아니라 `cloakWindowActive(streak)` 다: 전자는 `player.aux0` 을
  // 읽는데 이 지점의 aux0 은 아직 리셋 전이라 값은 같지만, **인자를 쓰는 쪽만이** 훅이 리셋
  // 뒤로 밀렸을 때 조용히 거짓이 되지 않는다(위 계약). 침공은 스트릭이 끝까지 0 이라 창이 안
  // 열려 자연 no-op 이고, 상수항이 없다(설계서 ④ 표 PH10).
  const ph10 = lv(state, Sk.blownCoverReflex);
  if (ph10 >= 1 && cloakWindowActive(s)) {
    player.dashCooldown = 0;
    // `player.iframes` 는 이 시점에 이미 `config.hitIframes` 로 세워져 있다(world 의 피격
    // 블록이 앞에 있다) — 그래서 대입이 아니라 **가산**이다. DI9(유령 선체)가 배선되면 같은
    // 필드를 만지므로 순서 고정(DI9 → PH10)이 설계서 구현 고지 ④ 의 요구다.
    //
    // ⚠️ **DI9 는 벽 파괴 축(탄↔벽)이 아니다 — 배치 5 가 grep 으로 확정했다.** 문면은
    // *"피격 무적 동안 **선체**가 벽을 통과한다"* 이고, 선체↔벽 판정의 정본은 `stepPlayer`
    // 안의 `slideCircleWalls`(`world.ts:2306`·`2351` — 이동 후 겹침 해소)와
    // `modes/blockBreak.ts:195` 의 `isPinnedByWall` 이다. 탄↔벽 경로(`w.hp -= e.damage`,
    // `world.ts:3931`)와는 **함수도 술어도 겹치지 않는다** — 전자는 `player.radius` 로 원을
    // 밀어내고 후자는 `sweptCircleOverlapsWall` 로 탄을 죽인다. 따라서 AS10 이 기다리는
    // 탄↔벽 앵커가 서더라도 DI9 는 거기서 돌지 않는다. DI9 의 자리는 `slideCircleWalls`
    // 호출을 **건너뛰는** 분기이고 그건 이 레인의 편집 범위 밖(`world.ts`)이다.
    player.iframes += 1 + Math.floor(ph10 / 4);
  }
}

/**
 * 앵커 ⑯ **볼리 파라미터 확정 직후 · 탄 생성 직전** — AS2 은막 침투 · AS3 처형 재장전(발사 절반).
 *
 * ## AS10 만 여기 없다 (AS3 은 배선됐다)
 *  - **AS10 유령 탄도**: 창 중 발사탄에 `mark` 를 찍는 것 자체는 여기서 된다. 그런데 그 표식을
 *    **읽는 자리가 없다** — 설계서가 지정한 소비처 셋(`world.ts` 의 차단 판정 · 파괴가능 벽
 *    피해 · 표적 선택의 `segmentBlocked`)이 전부 앵커가 아니다. 표식만 찍으면 해시에 실리는
 *    무연산이 되므로 넣지 않는다(반쪽 배선 금지 — AS8 이 빠진 사유와 같다).
 *    ⚠️ **배치 5 재확인(2026-08-07)**: 이 레인은 AS10 을 「탄↔벽 앵커(`onWallHit`)의
 *    `params.passThrough`」로 배선하라는 지시를 받았으나, **그 앵커가 이 베이스에 없다** —
 *    `grep -rn "onWallHit\|passThrough" src/ tests/` 가 **0건**이다. 소비처는 지금도
 *    `world.ts` 의 탄 소멸 스윕(`sweptCircleOverlapsWall` → `w.hp -= e.damage` → `e.dead = true`)
 *    한 곳이고 그 줄들 앞뒤에 훅 호출이 없다. 이 레인은 `world.ts` 편집 금지라 앵커를 세울 수
 *    없어 **미배선을 유지한다**. 앵커가 서면 이 문단만 지우면 된다 — 효과 본체는
 *    `params.passThrough = true` 한 줄이고 피해 산술은 건드릴 것이 없다(문면 "파괴가능 벽은
 *    피해를 주고 통과한다" = 소멸만 막는다).
 *  - **AS3 처형 재장전**: ✅ **배선됐다**(S2.1 이 연 `VolleyParams.cloakBreak` 를 쓴다).
 *    막고 있던 사유는 근거로 남긴다 — 트리거가 "해제 첫 타(**강화탄**)로 처치" 인데, 이 앵커는
 *    `aux1` 소진 **뒤**라 이번 볼리가 그 강화탄인지 알 신호가 없었다(소진 분기는 표식을 남기지
 *    않는다). `source` 만 보고 "지금 은신 창인가"로 대체하면 창 안 전 발사가 2.5배가 된다 —
 *    설계와 정반대다. 그 신호를 `cloakBreak` 가 세웠고, 표식(`MARK_CLOAK_BREAK`)의 회수는
 *    앵커 ⑩ 에서 한다.
 *    ⚠️ 같은 문장에 붙어 있던 *"처치를 보는 앵커 ⑩ 은 **탄을 넘기지 않아** 어느 탄이 죽였는지
 *    모른다"* 는 **사실이 아니었다** — 지우지 않고 정정만 적어 둔다: 앵커 ⑩ 은 `source`
 *    (가해 아군탄)를 넘기고 `target.dead` 가 **이미 확정**이다(그 앵커 doc 의 계약). AS3 을
 *    막던 것은 처음부터 소진 신호 부재 **하나뿐**이었다.
 *
 * ## ⚠️ 빔은 `pierce`·`speed` 를 안 읽는다 — 아키타입 한계를 넓혀 약속하지 않는다
 * 앵커 주석의 표가 정본이다(빔은 `damage`·`mark`·`cooldownQ` 뿐). 레일건·미사일·발칸/스프레드
 * 에서는 두 필드가 그대로 반영된다. 빔 런에서 AS2 가 무연산인 것은 배선 누락이 아니라
 * 아키타입 정의이고, 여기서 `damage` 로 대체 보상을 얹으면 설계에 없는 축이 하나 는다.
 */
export function phantomVolleyParams(
  state: WorldState,
  player: Entity,
  params: VolleyParams,
): void {
  // --- AS3 처형 재장전(발사 절반) ------------------------------------------
  // 이번 볼리가 **해제 첫 타(강화탄)** 인지는 `params.cloakBreak` 하나로만 안다 — 소진은 이
  // 앵커보다 앞이고 표식을 남기지 않는다(그 필드 doc 가 정본).
  // ⚠️ `params.mark === 1` 은 **스트라이커 정조준 전용**이라 대용하지 마라.
  // ⚠️ 침공에서는 `cloakBreak` 이 항상 `false` 다(소진 분기 자체가 게이트된다) — 여기에
  //    `invasion3` 게이트를 겹쳐 걸지 않는 이유가 그것이고, 겹쳐 걸면 술어가 둘이 된다.
  const as3 = lv(state, Sk.executionReload);
  if (as3 >= 1 && params.cloakBreak) {
    // 표식을 찍어야 앵커 ⑩ 이 "**그 탄으로** 죽였다" 를 잴 수 있다. `|=` 로 얹는다 —
    // 배타 대입이면 다른 팬텀 표식이 생기는 날 한쪽이 다른 쪽을 조용히 지운다.
    params.mark |= MARK_CLOAK_BREAK;
    // 관통 +floor(Lv/5) (Lv20 = +4 — 5레벨 폭 정수 계단, 20 초과 자연 연장).
    // ⚠️ 설계 3판이 **첫 타와 재장전 타를 구분하지 않는 것을 확정**했다(`aux1` 은 0/1 이진이라
    //    구분할 상태가 없고, 레벨 스케일 항이 "신규 상태 0" 으로 못 박혀 있다). 그래서 이
    //    보너스는 강화탄 **전부**에 실린다 — 구분하려고 새 슬롯을 잡으면 설계와 갈린다.
    params.pierce += Math.floor(as3 / 5);
  }

  // --- AS2 은막 침투 --------------------------------------------------------
  // 은신 창 동안 발사한 탄에 관통 +1 · 탄속 +6% + 1.5%p/Lv.
  const as2 = lv(state, Sk.cloakPierce);
  if (as2 < 1) return;
  // 창 술어는 정본 하나(`playerCloaked`)를 쓴다 — 침공 차단과 기체 게이트가 그 안에 있다.
  if (!playerCloaked(state, player)) return;
  params.pierce += 1;
  // 탄속은 정수 bp · 나눗셈 1회. `speed` 는 소수일 수 있어 `Math.round` 를 걸지 않는다 —
  // 반올림하면 스킬 없는 런과 같은 값이어야 할 이유가 없는 자리에서 정수화가 새로 생긴다.
  params.speed = (params.speed * (10600 + 150 * as2)) / 10000;
}

/**
 * 앵커 ㉙ **이동 배율 산출 직전 · 감속 배율이 정해지기 전** — PH4 무흔 보행 **1종**.
 *
 * 설계서: *"은신 창 동안 이동 속도 상승 + 이동 감속(플레이어 슬로우·감속 장판) 면역"* ·
 * 이속 +8% + 1%p/Lv · 구현란 *"속도 곱셈 자리에서 `playerCloaked` 시 slowMult 강제 1 + 배율
 * 1곱"* 그대로다. 팬텀 30종 중 **이속 계열은 이 하나뿐**이다(설계서 M-1 정리).
 *
 * ## ⚠️ 창 술어는 `playerCloaked` 다 — 여기서는 그것이 옳다
 * PH10 이 `cloakWindowActive(streak)` 를 쓴 것은 그 앵커가 **리셋 분기 안**이라 `player.aux0`
 * 이 곧 지워질 값이어서였다(그 함수 주석이 근거). 이 앵커는 `stepPlayer` 안이고 aux0 이 이번
 * 틱의 정상값이라 정본 술어를 쓴다 — 침공 차단(`invasion3`)과 기체 게이트가 그 함수 안에
 * 있어서 여기에 겹쳐 걸 필요도 없다(설계서 침공 판정표 "PH4 = 자동 no-op").
 *
 * ## ⚠️ 대시에는 안 걸린다
 * 호출부가 `speedMult` 를 `mx * playerSpeed` 쪽에만 곱한다(`PlayerMoveParams.speedMult` doc).
 * 설계서 3.3 「대시 임펄스 미적용」 규율 그대로이고, 말로우 CU8 과 같은 자리다.
 *
 * ## ⚠️ 미투자·비은신 런은 `params` 를 **한 바이트도** 안 건드린다 → 골든 해시 불변.
 */
export function phantomPlayerMoveParams(
  state: WorldState,
  player: Entity,
  params: PlayerMoveParams,
): void {
  const ph4 = lv(state, Sk.tracelessStride);
  if (ph4 < 1) return;
  if (!playerCloaked(state, player)) return;
  // 면역이 먼저다 — 호출부는 되쓴 값으로 `PLAYER_SLOW_MULT` 적용 여부를 정한다.
  params.slowTicks = 0;
  // 이속 bp = 800 + 100×Lv (Lv1 = +9% · Lv20 = +28%). 정수 bp 라 나눗셈 1회다.
  params.speedMult *= (10800 + 100 * ph4) / 10000;
}
