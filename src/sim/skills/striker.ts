/**
 * **스트라이커 30스킬의 효과 본체**(ADR-0049 배치 1 · 설계 정본
 * `.omc/plans/skill-rebuild-2026-08-05/striker.md` 승인본 4판).
 *
 * 이 파일은 **7기체 배선의 첫 레인**이라 뒤따르는 6기체가 베낄 형태를 겸한다. 아래 다섯 규율이
 * 그 패턴이다 — 형태를 바꾸려면 여기부터 고치고 6기체를 함께 옮겨라.
 *
 * ## ① 계층 — `world.ts` 를 런타임 import 하지 않는다
 * `WorldState`/`Entity` 는 **type-only** 다(런타임에 지워진다). 효과 헬퍼가 필요하면 leaf 에서
 * 가져온다(`activeTypes.ts` 의 `blastDamage`·`clearEnemyBullets` — 그 파일도 `world.ts` 를
 * type-only 로만 본다). 근거는 `skillHooks.ts` 헤더 ①: 순환이 생기면 클라에서는 재현되지 않고
 * 검증 EF 에서만 TDZ 로 터진다.
 *
 * ## ② 모든 쓰기는 **투자 게이트 안쪽**이다
 * 각 함수의 첫 줄은 `const lv = skillLv(...)` 이고 `lv < 1` 이면 즉시 빠져나간다. `skillsOn`
 * 이 이미 앵커에서 걸러 주지만, **한 스킬만 찍은 런**은 `skillsOn` 이 참인 채로 나머지 29개
 * 경로를 지나므로 이 게이트가 없으면 미투자 스킬이 작동한다.
 *
 * ## ③ 반올림·정수화는 **게이트 안**에서만 한다
 * 접촉 피해에는 엘리트 배율이 섞여 소수가 될 수 있다. 반올림이 게이트 밖으로 나가면 스킬 없는
 * 런의 소수 피해까지 바뀐다(`skillHooks.ts` {@link onDamageChain} 주석의 경고와 같은 사유).
 *
 * ## ④ RNG 를 한 칸도 소비하지 않는다
 * 이 파일에는 난수 호출이 **한 건도 없다**. 스트라이커 30종 중 확률에 기대는 스킬이 없는 것은
 * 설계(§1 "확률 0")이고, 뒤 기체가 확률을 쓴다면 스트림 분기 규약을 먼저 세워야 한다.
 *
 * ## ⑤ 슬롯 접근은 `readSlot`/`writeSlot` 만
 * 배열 직접 대입 금지 — 정수·비음 강제가 그 두 함수에 있다(`skillSlots.ts` 값 규약 2).
 *
 * ---
 *
 * ## ⚠️ 이 배치가 배선한 것은 30종 중 9종이다
 * 나머지 21종은 **앵커 9개만으로는 닿지 않는 지점**(볼리 생성 파라미터·액티브 핸들러·명중
 * 처리·해저드 적용부 등 `world.ts` 내부)을 요구한다. 자세한 목록과 사유는 레인 보고서에 있다.
 * 여기 없는 스킬은 "구현했는데 안 불린다"가 아니라 **아직 코드가 없다** — 반쪽 배선과 구분하라.
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
import { blastDamage, clearEnemyBullets } from '../activeTypes.js';
import { readSlot, writeSlot, StrikerCarry } from '../skillSlots.js';
import { MARKSMAN_TRIGGER_AUX0 } from '../shipSignature.js';
import { skillLv } from '../../items/skills.js';

// ---------------------------------------------------------------------------
// flat 인덱스 — `data/ships/striker.ts` 의 축 순서가 정본
// ---------------------------------------------------------------------------
//
// `trees: [firepower(offense), survival(defense), mobility(utility)]` 이므로
// F1..F10 = 0..9 · S1..S10 = 10..19 · M1..M10 = 20..29 다.
// `tests/skillIcons.test.ts` 가 `nodes[0]=offense · nodes[10]=defense · nodes[20]=utility` 로
// 이 배치를 이미 잠그고 있다 — **설계서가 F→M→S 순으로 서술하는 것은 편집 순서일 뿐이다.**

const enum Sk {
  /** F1 전과 확장 */ killMomentum = 0,
  /** F4 파편 격발 */ shatterRound = 3,
  /** S1 응전 조준 */ retaliationSight = 10,
  /** S2 반사 도금 */ reactivePlating = 11,
  /** S4 엄폐 교리 */ coverDoctrine = 13,
  /** S8 콤보 차폐 */ comboShield = 17,
  /** S10 선체 증축 */ hullAccretion = 19,
  /** M3 수집 항로 */ gemRoute = 22,
  /** M5 벽차기 */ wallKick = 24,
}

/**
 * 이 런에서 그 스킬의 **실효 레벨**(투자 + 축 어픽스). 미투자면 0 이고, 그때 어픽스는 더해지지
 * 않는다(`skillLv` 정본 1). 기체 게이트는 호출부(`skillHooks.ts` 의 `case`)가 이미 걸었으므로
 * 여기서 `sigBit` 을 다시 보지 않는다.
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
 * ⚠️ **나눗셈이 낀 두 공식(S8·S10)은 `createWorld` 가 아니라 여기서 계산한다.**
 *
 * 설계서 공통 고지 ③ 은 "체감 곡선의 나눗셈은 `createWorld` 가 투자 레벨당 1회 정수 확정해
 * `skillDerived` 로 싣는다"고 적었다. 이 레인은 그 자리를 **비워 뒀다** — 채우려면 둘 중
 * 하나여야 하는데 둘 다 지금 더 나쁘다:
 *  ① `world.ts` 가 이 모듈을 런타임 import → `skillHooks.ts` 헤더 ① 이 금지한 순환의 씨앗
 *  ② 공식을 `world.ts` 에 다시 적음 → 소비처(여기)와 산출처가 갈리는 이중 정본
 * 대신 **호출 빈도가 낮은 이벤트 경로에서만** 계산한다: S8 은 선체 hp 가 깎인 피격 틱,
 * S10 은 400XP 임계를 실제로 넘긴 틱뿐이다(매 틱 나눗셈이 아니다 — 고지 ③ 이 막으려던 것은
 * sim 루프의 상시 나눗셈이다). **리드 판단으로 `skillDerived` 에 옮기기로 하면 이 주석과
 * 아래 두 함수를 통째로 그리로 옮겨라 — 호출부는 상수 읽기로 바뀌기만 하면 된다.**
 */
function comboAbsorbPerStack(level: number): number {
  // S8: round(3 + 40×Lv/(Lv+20)) — Lv20 = 23, 점근 43.
  return Math.round(3 + (40 * level) / (level + 20));
}

/** S10: round(2 + 24×Lv/(Lv+28)) HP — Lv20 = 12, 점근 26. */
function hullGrantHp(level: number): number {
  return Math.round(2 + (24 * level) / (level + 28));
}

/** S10 지급 임계(런 누적 획득 XP). 설계서 고정값. */
const HULL_XP_THRESHOLD = 400;

// ---------------------------------------------------------------------------
// 앵커별 진입점 — `skillHooks.ts` 의 `case SIG_STRIKER_MARKSMAN:` 이 부른다
// ---------------------------------------------------------------------------

/**
 * 앵커 ② **대시 발동** — M5 벽차기(무적프레임 부분).
 *
 * 술어 "직전 틱 벽 접촉"은 {@link WorldState.wallContactTicks} 를 그대로 읽는다. 대시 분기는
 * 벽 슬라이드보다 **앞**(world.ts 2185 < 2297)이라 이 지점의 값은 아직 **이전 틱의 갱신분**이고,
 * 그것이 정확히 설계서가 요구한 "직전 틱" 이다. 설계서는 이 목적으로 신규 플래그 1칸(구현 태그 B)을
 * 세우라고 적었지만, S0 의 E5 가 같은 술어를 이미 엔진 상태로 세워 뒀으므로 **슬롯을 잡지
 * 않는다** — 두 곳에 같은 술어를 적으면 조용히 갈린다.
 *
 * ⚠️ **거리 강화(+15% + 1.5%p/Lv)는 여기서 못 한다.** 대시 임펄스는 `player.vx/vy` 에 이미
 * 합산돼 들어와 이 지점에서 대시 성분만 분리할 수 없다 — 그 절반은 `world.ts` 의 대시 분기가
 * 소유해야 한다(미배선).
 */
export function strikerDashFired(state: WorldState, player: Entity): void {
  const m5 = lv(state, Sk.wallKick);
  if (m5 >= 1 && state.wallContactTicks > 0) {
    player.iframes += 2 + Math.floor(m5 / 4);
  }
}

/**
 * 앵커 ③ **젬 수거** — M3 수집 항로.
 *
 * ⚠️ `Math.max(0, ·)` 클램프가 **필수**다. 음수로 내려가면 대시 발동 게이트가 `dashCooldown === 0`
 * 동등 비교라 영영 걸리지 않는다(설계서 구현 고지 ③ 과 같은 경고).
 */
export function strikerGemCollected(state: WorldState, player: Entity): void {
  const m3 = lv(state, Sk.gemRoute);
  if (m3 < 1) return;
  const cut = 2 + Math.floor(m3 / 2);
  player.dashCooldown = Math.max(0, player.dashCooldown - cut);
}

/**
 * 앵커 ④ **선체 hp 가 깎인 피격의 후속** — S1 응전 조준 · S2 반사 도금.
 *
 * 두 스킬 모두 설계서의 "실제로 HP 가 깎인 피격 틱" 을 트리거로 삼는데, 그것이 이 앵커의 정의
 * 자체다(막이 전량 흡수한 피격은 사슬 중간에서 반환해 여기 도달하지 않는다).
 */
export function strikerPlayerDamaged(state: WorldState, player: Entity): void {
  // S1 — 사이클 만충. `MARKSMAN_TRIGGER_AUX0` 는 "다음 볼리가 정조준" 을 뜻하는 카운터 값이다.
  // ⚠️ 무조건 대입하면 안 된다 — F1 이 이미 임계를 넘겨 놓은 카운터를 **되돌려** 정조준을
  // 늦추는 부호 반전이 된다(`marksmanTriggered` 가 `>=` 판정이라 초과분은 유효하다).
  const s1 = lv(state, Sk.retaliationSight);
  if (s1 >= 1 && player.aux0 < MARKSMAN_TRIGGER_AUX0) {
    player.aux0 = MARKSMAN_TRIGGER_AUX0;
  }
  // S2 — 주변 적탄 소거. 반경 90 + 8×Lv.
  const s2 = lv(state, Sk.reactivePlating);
  if (s2 >= 1) {
    clearEnemyBullets(state, player, 90 + 8 * s2);
  }
}

/**
 * 앵커 ⑤ **이번 틱의 처치 증분** — F1 전과 확장.
 *
 * `compact` 이 킬 집계의 단일 수렴점이라 이 하나로 전 사망 경로를 덮는다(탄 명중·화염 DoT·전격·
 * 폭탄 기물). 정조준탄 귀속 판정이 없는 것은 설계 그대로다 — 모든 처치가 대상이라 탄 소멸 후
 * 귀속 문제가 없다.
 */
export function strikerKillsDelta(state: WorldState, player: Entity, delta: number): void {
  const f1 = lv(state, Sk.killMomentum);
  if (f1 < 1) return;
  // 처치당 충전 = 1 + ceil(Lv/4) (Lv20 = 6). 정수 계단이고 양적 반올림이다.
  player.aux0 += delta * (1 + Math.ceil(f1 / 4));
}

/**
 * 앵커 ⑥ **아군탄이 관통 예산을 다 써 소멸** — F4 파편 격발.
 *
 * 폭발 중심은 **플레이어가 아니라 탄** 이다. {@link blastDamage} 의 두 번째 인자는 이름이
 * `player` 지만 본문이 `x`/`y` 만 읽으므로 탄 엔티티를 그대로 넘긴다 — 좌표 소유자를 바꾸려고
 * 기하를 여기서 다시 적으면 두 판정이 갈린다.
 */
export function strikerBulletExpired(state: WorldState, bullet: Entity): void {
  const f4 = lv(state, Sk.shatterRound);
  if (f4 < 1) return;
  const radius = 60 + 6 * f4;
  // 폭발 피해 = 탄 피해의 30% + 2%p/Lv. 반올림은 이 게이트 **안**이다(규율 ③).
  const dmg = Math.round((bullet.damage * (3000 + 200 * f4)) / 10000);
  if (dmg <= 0) return;
  blastDamage(state, bullet, radius, dmg);
}

/**
 * 앵커 ⑧ **감쇠 사슬의 스킬 슬롯 2칸** — S4 엄폐 교리(감소) → S8 콤보 차폐(흡수).
 *
 * 순서는 **감소 먼저, 흡수 나중** 고정이다(앵커 주석의 근거: 흡수가 먼저면 감소가 이미 깎아 낼
 * 피해까지 흡수 자원이 태워진다).
 *
 * ## S4 의 술어도 `wallContactTicks` 다
 * 설계서는 "M5 가 신설하는 직전 틱 벽 접촉 플래그를 읽기만 한다" 고 적었으나, 그 플래그는 S0
 * 의 E5 가 이미 엔진 상태로 세웠다. 이 사슬은 `stepPlayer` **뒤**(충돌 해소)라 여기서 읽는
 * 값은 **이번 틱** 갱신분이고, 그것이 설계서의 "벽에 접촉 중일 때 피격되면" 그대로다.
 */
export function strikerDamageChain(state: WorldState, player: Entity, dmg: number): number {
  void player;
  let out = dmg;
  // ① 감소 — S4. 산술 형태는 브루저 장갑과 동형(정수 bp · 단일 나눗셈 · 반올림 1회)이라
  //    소수 피해가 들어와도 같은 방식으로 접힌다.
  const s4 = lv(state, Sk.coverDoctrine);
  if (s4 >= 1 && state.wallContactTicks > 0) {
    out -= Math.round((out * (1000 + 100 * s4)) / 10000);
  }
  // ② 흡수 — S8. **콤보 스택을 실제로 소모한다**(XP 배율과의 트레이드가 이 스킬의 본체다).
  const s8 = lv(state, Sk.comboShield);
  if (s8 >= 1 && out > 0 && state.combo > 0) {
    const per = comboAbsorbPerStack(s8);
    if (per > 0) {
      const need = Math.ceil(out / per);
      const used = need < state.combo ? need : state.combo;
      state.combo -= used;
      out -= used * per;
      if (out < 0) out = 0;
    }
  }
  return out;
}

/**
 * 앵커 ⑨ **시그니처 틱 진행**(매 틱 정확히 한 번) — S10 선체 증축.
 *
 * ## 왜 `state.xp` 를 폴링하는가
 * 설계서는 "런 누적 획득 XP" 를 요구하는데 `state.xp` 는 레벨업마다 `-= need` 되는 **잔여 풀**
 * 이라 그대로 못 쓴다. 그래서 **직전에 본 값보다 늘어난 만큼만** 적립한다 — xp 는 획득으로만
 * 늘고 레벨업으로만 줄므로 이 델타의 양수부 합이 정확히 "누적 획득" 이다. 젬 앵커(③)에서
 * `gained` 를 다시 계산하는 대안은 기각했다: `comboMultiplier × xpMult × catalystMods.xp ×
 * 유물 증폭기` 공식을 두 곳에 적는 순간 조용히 갈린다.
 *
 * 슬롯 2칸은 **Carry** 다 — 의뢰 다구간 런에서 구간이 바뀌어도 저금이 살아야 한다.
 */
export function strikerSignatureStep(state: WorldState, player: Entity): void {
  const s10 = lv(state, Sk.hullAccretion);
  if (s10 < 1) return;
  const cur = Math.trunc(state.xp);
  const seen = readSlot(state.skillCarry, StrikerCarry.hullXpSeen);
  let pool = readSlot(state.skillCarry, StrikerCarry.hullXpPool);
  if (cur > seen) pool += cur - seen;
  writeSlot(state.skillCarry, StrikerCarry.hullXpSeen, cur);
  if (pool >= HULL_XP_THRESHOLD) {
    const grant = hullGrantHp(s10);
    while (pool >= HULL_XP_THRESHOLD) {
      pool -= HULL_XP_THRESHOLD;
      player.maxHp += grant;
    }
  }
  writeSlot(state.skillCarry, StrikerCarry.hullXpPool, pool);
}
