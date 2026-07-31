/**
 * 의뢰 **주문 4종의 sim 판정** — 순수 함수 모음 (계획 §Phase D · 계약 §5).
 *
 * 주문(order)은 "무엇을 하는 런인가"를 바꾸는 축이다(CONTEXT `주문`). 이 모듈은 그 판정을
 * **한 곳에 모아 순수 함수로** 두고, 부수효과(스폰·엔티티 변형·구간 종료 호출)는 소비처
 * (`waves.ts` 스포너 · `world.ts` 보스층)에 남긴다.
 *
 * ## 왜 술어를 여기 모으는가
 * 이 저장소가 8번 겪은 실패 모드는 "같은 조건을 두 곳에 적었더니 한쪽만 고쳐져 조용히
 * 갈라진 것"이다. 정예 소집령의 **잡몹 0 · 젬 0 · 겹침 소환**은 서로 다른 세 파일에서
 * 평가되는데, 셋이 같은 술어를 봐야 "잡몹은 사라졌는데 젬은 나온다" 같은 반쪽 상태가
 * 구조적으로 불가능해진다.
 *
 * ## ⚠️ 신규 거동은 전부 `config.commission !== undefined` 뒤에 있다
 * 무의뢰 PvE 런의 per-tick 해시 스트림이 **바이트 동일**해야 한다(최상위 하드 게이트).
 * 그래서 이 모듈의 모든 술어는 의뢰가 아니면 즉시 거짓/무연산으로 떨어진다.
 *
 * ## ⚠️ 환경 분기 금지
 * `src/sim/**` 는 Deno 검증 경로가 **소스 그대로** import 한다. `import.meta.env` ·
 * `process.env` · `__DEV__` 를 여기 두면 서버에서 터진다.
 */

import type { WorldState } from './world.js';
import type { Entity } from './entities.js';
import type { CommissionOrder } from '../run/commission.js';
import {
  COMMISSION_BOUNTY_ESCAPE_HP_CENTI,
  COMMISSION_BOUNTY_ESCAPE_SURVIVE_TICKS,
  COMMISSION_ELITE_OVERLAP_DELAY_TICKS,
  COMMISSION_ELITE_OVERLAP_MIN,
  COMMISSION_ELITE_REGROUP_TICKS,
} from '../run/commissionConstants.js';

// ---------------------------------------------------------------------------
// 공통 술어 — 의뢰 여부와 주문 종류
// ---------------------------------------------------------------------------

/**
 * 이 런의 주문. 무의뢰 런은 `undefined`.
 *
 * ⚠️ 정본은 **`config.commission`** 이다(`commissionRuntime` 유무로 판정하지 마라 —
 * 파생 정본 금지, `sigBit` 과 같은 규율).
 */
export function commissionOrderOf(state: WorldState): CommissionOrder | undefined {
  return state.config.commission?.order;
}

/**
 * **정예 소집령**(`order: 'elite'`) 런인가 — ADR-0043.
 *
 * 이 한 술어가 세 거동을 동시에 켠다: 잡몹 카드 스폰 0(`waves.ts`) · 젬 드랍 0(`world.ts`
 * `compact()`) · 정예 겹침 소환(`waves.ts`). 셋이 같은 함수를 보는 것이 계약이다.
 */
export function isEliteSummons(state: WorldState): boolean {
  return commissionOrderOf(state) === 'elite';
}

/**
 * 이 런에서 **경험치 젬을 바닥에 남기는가**.
 *
 * ⚠️ **파워업 3택 차단을 따로 만들지 마라.** ADR-0043 의 인과는 한 방향이다 —
 * 잡몹 0 → 젬 0 → 레벨업 0 → 3택 0. 중간을 건너뛰고 3택을 직접 막으면 "젬은 도는데
 * 3택만 안 열리는" 두 번째 진실이 생기고, 그 둘이 갈리는 날 어느 쪽이 정본인지 아무도
 * 모른다. 여기서 젬만 막는다.
 *
 * ⚠️ **드랍 롤 RNG(`dropRng`)는 계속 소비돼야 한다.** 이 술어는 `spawnGem` 호출만
 * 게이트하고 드랍 판정 자체는 건드리지 않는다 — 판정을 건너뛰면 엘리트 전리품 스트림이
 * 통째로 밀린다.
 */
export function commissionSuppressesGems(state: WorldState): boolean {
  return isEliteSummons(state);
}

/** 이 런에서 **웨이브 카드 잡몹**이 유입되는가(정예 소집령만 0). */
export function commissionSuppressesCardSpawns(state: WorldState): boolean {
  return isEliteSummons(state);
}

// ---------------------------------------------------------------------------
// 제약 계약 — 성장축
// ---------------------------------------------------------------------------

/**
 * 그 파워업 인덱스가 **의뢰 제약으로 봉인**됐는가(`constraints.bannedPowerupLines`).
 *
 * ⚠️ 소비처(`drawPowerupChoices`)는 이것을 **`pool` 진입 자체를 막는 `continue` 필터**로
 * 써야 한다. pool 에 넣고 뒤에서 거르면 `weights` 총합이 바뀌어 **같은 시드에서 뽑히는
 * 파워업이 통째로 달라진다**(그 파일 44~50행 계약 · 계획 PM-2).
 *
 * 무의뢰 런·제약 미지정 런은 항상 거짓이라 pool 구성이 바이트 동일하다.
 */
export function commissionBansPowerupLine(state: WorldState, index: number): boolean {
  const banned = state.config.commission?.constraints?.bannedPowerupLines;
  if (banned === undefined) return false;
  return banned.includes(index);
}

/**
 * ⚠️ **장비축 제약은 여기에 없다 — 일부러 그렇다.** 그 판정(`equipBanned`)은
 * `src/run/runConfig.ts` 의 출격 조립에 산다. sim 은 장비 제약을 **감시하지 않기** 때문이다:
 * 위반이 원천 불가능하도록 조립에서 빼는 것이 유일한 강제 수단이고, sim 이 그 규칙을 아는
 * 순간 "감시할 수도 있다"는 문이 열린다(CONTEXT `제약 계약`).
 */

// ---------------------------------------------------------------------------
// 정예 소집령 — 겹침 소환 시계
// ---------------------------------------------------------------------------

/**
 * 겹침 소환 시계의 상태. **월드에 사는 두 정수**(`WaveRuntime.eliteAlivePrev` ·
 * `eliteNextTick`)와 같은 모양이고, 이 함수가 그 둘의 다음 값을 계산한다.
 */
export interface EliteDeployState {
  /** 직전 틱의 살아 있는 정예 수. */
  readonly alivePrev: number;
  /** 다음 투입이 가능해지는 틱(이 틱 미만이면 투입 없음). */
  readonly nextTick: number;
}

/** {@link decideEliteDeploy} 의 결과 — 다음 시계 상태 + 이번 틱 투입 여부. */
export interface EliteDeployDecision extends EliteDeployState {
  /** 이번 틱에 정예 1기를 투입하는가. */
  readonly deploy: boolean;
}

/**
 * 정예 겹침 소환 판정 — **ADR-0043 의 핵심이 이 함수 안에 있다.**
 *
 * ## 이것은 고정 주기 타이머가 **아니다**
 * ADR-0011 이 폐지한 것은 *생존 여부와 무관하게* 주기적으로 적을 뱉는 타이머이고,
 * ADR-0043 은 그 규칙을 정예에 직역했다. 그래서 시계가 도는 조건이 둘로 갈린다:
 *
 *  - **직전 정예가 살아 있는 동안**(`alive >= 1`)에만 겹침이 추가된다. 못 잡고 있으면
 *    화면이 보스급으로 빽빽해져 자연히 죽는다 — 그것이 잡몹이 사라지며 없어진 런 길이
 *    캡을 대신한다.
 *  - **정예가 전멸하면** 시계를 "처치 이후 경과 틱"(`REGROUP`)으로 다시 잡는다. 빠르게
 *    치우는 플레이어는 겹침을 한 번도 안 보고 다음 정예를 기다린다 = 강하면 빨리 통과한다.
 *
 * `OVERLAP_MIN` 은 **목표 겹침**이라 도달하면 투입이 멈춘다. `OVERLAP_DELAY` 는 투입을
 * 구동하지 않고 간격만 벌린다 — 게이트(직전 정예 생존)가 닫혀 있으면 이 값이 아무리
 * 흘러도 아무것도 나오지 않는다.
 *
 * 순수 함수다(RNG·시각 미소비). `alive` 는 호출부가 센 실측값이다.
 */
export function decideEliteDeploy(
  tick: number,
  alive: number,
  prev: EliteDeployState,
): EliteDeployDecision {
  // 전멸 **직후 그 틱**에만 시계를 다시 잡는다(`alivePrev > 0` 이 에지 판정). 전멸 상태가
  // 계속되는 동안 매 틱 다시 잡으면 시계가 영원히 도망가 정예가 다시는 안 나온다.
  let nextTick = prev.nextTick;
  if (alive === 0 && prev.alivePrev > 0) nextTick = tick + COMMISSION_ELITE_REGROUP_TICKS;
  if (tick < nextTick) return { deploy: false, nextTick, alivePrev: alive };
  // 목표 겹침 도달 — 투입 없음. `nextTick` 은 그대로 둔다(과거 값이라 다음 틱에도 즉시
  // 이 분기를 재평가한다 = 한 기가 죽는 순간 곧바로 보충이 가능하다).
  if (alive >= COMMISSION_ELITE_OVERLAP_MIN) return { deploy: false, nextTick, alivePrev: alive };
  return { deploy: true, nextTick: tick + COMMISSION_ELITE_OVERLAP_DELAY_TICKS, alivePrev: alive };
}

// ---------------------------------------------------------------------------
// 현상금 표적 — 도주 시계
// ---------------------------------------------------------------------------

/**
 * 도주 카운트다운 **점화 시각**을 보스 엔티티의 `aux1` 에 싣는 인코딩.
 *
 * `aux1 === 0` 이 "미점화" 센티넬이므로 **`tick + 1`** 을 저장한다 — 0틱 점화와 미점화를
 * 구분하기 위함이고, midClash 의 `aux1` 센티넬이 같은 형태의 선례다.
 *
 * ⚠️ **`aux0` 을 쓰지 마라** — 추격 모드가 보스 `aux0` 을 취약화 플래그로 이미 쓴다.
 */
export function encodeBountyIgnition(tick: number): number {
  return tick + 1;
}

/** {@link encodeBountyIgnition} 의 역 — 미점화면 `-1`. */
export function decodeBountyIgnition(aux1: number): number {
  return aux1 === 0 ? -1 : aux1 - 1;
}

/**
 * 이번 틱에 도주 카운트다운이 **점화**되는가.
 *
 * ⚠️ **화면 이탈 기반 조건을 절대 쓰지 마라.** 강제 스크롤 모드에서는 창이 계속 전진하므로
 * "화면 밖으로 나갔다"가 플레이어의 실패와 무관하게 참이 된다.
 *
 *  - `'hpThreshold'` — HP 가 임계 아래로 **처음** 떨어진 틱. 정수 비교로 두는 이유는
 *    센티-퍼센트 상수를 float 비율로 환산하면 플랫폼 간 미세 오차가 판정 틱을 하루 옮길 수
 *    있기 때문이다(`hp * 10000 <= maxHp * CENTI`).
 *  - `'surviveTicks'` — 표적이 등장한 틱. 즉 스폰 즉시 시계가 돈다.
 */
export function bountyIgnites(boss: Entity, escapeRule: 'hpThreshold' | 'surviveTicks'): boolean {
  if (escapeRule === 'surviveTicks') return true;
  return boss.hp * 10000 <= boss.maxHp * COMMISSION_BOUNTY_ESCAPE_HP_CENTI;
}

/**
 * 점화 뒤 도주가 **성립**했는가. 길이는 규칙과 무관하게 항상
 * {@link COMMISSION_BOUNTY_ESCAPE_SURVIVE_TICKS} 다 — 규칙은 점화 조건만 고른다.
 */
export function bountyEscaped(ignitionTick: number, tick: number): boolean {
  if (ignitionTick < 0) return false;
  return tick - ignitionTick >= COMMISSION_BOUNTY_ESCAPE_SURVIVE_TICKS;
}
