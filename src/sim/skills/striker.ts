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
 * ## ⚠️ 이 파일이 배선한 것은 30종 중 19종이다
 * 1차 배선(S1 이전)이 9종, **S2 레인이 6종을 더했고**(F2·F3·F6·F9·M1·S3 + S8 의 콤보 창 절반),
 * **S3 레인이 F5 를 더했다**(S3-1 이 앵커 ⑯ 에 실은 `aimAngle` 을 술어로 읽는다).
 * **배선 레인이 3종을 더했다** — F8(앵커 ⑩ · 보스 `iframes` 가 과열 창이라는 인코딩을 읽는다) ·
 * S6(액티브 sustain 표 · 기존 자석 버프 게이트와 감속 게이트를 빌린다) · M6(앵커 ② · 소거와
 * 냉기를 반경 하나로 낸다).
 * 나머지 11종은 **현행 앵커가 닿지 않는 지점**(볼리 추가 생성·해저드 적용부·접촉 처리·자석장·
 * 대시 방향·정지장 등 `world.ts` 내부)을 요구한다. 사유는 아래 각 진입점 주석과 레인 보고서에
 * 있다. 여기 없는 스킬은 "구현했는데 안 불린다"가 아니라 **아직 코드가 없다** — 반쪽 배선과
 * 구분하라.
 *
 * ### 미배선 11종의 사유 — 한눈 표(전문은 각 진입점 주석)
 *  · **F7 표적 고정** · **S7 최후 처형**: 앵커 ⑩ 의 금지 사항(차감·격추 판정 **뒤**) —
 *    {@link strikerEnemyDamaged} doc.
 *  · **F10 연장 탄창** · **M8 도약 사격**: 볼리를 **더 낳아야** 한다. 앵커 ⑯ 은 이번 한 벌의
 *    파라미터만 주고, 발사 자체는 `autoAttack`(world.ts 비공개) 소유다.
 *  · **M2 추진 항적**: 술어가 **"대시 방향"** 인데 그 정본은 `resolveDirFallback(mx, my, angle)`
 *    이고(world.ts:2224), 인자인 정규화 이동 입력 `mx/my` 는 `stepPlayer` 의 지역 변수다.
 *    앵커 ②(`onDashFired(state, player)`)는 `input` 을 받지 않아 그 값이 없다. 도달 시점의
 *    `player.vx/vy` 는 **이동 성분이 이미 합산**된 뒤라(2226-2227) 정규화해도 대시 방향과
 *    다르고, 그걸 쓰면 방향 규칙의 두 번째 사본이 생긴다. **앵커 확장이 아니라 input 배관이
 *    선결**이다(말로우 SQ7 과 같은 벽).
 *  · **M9 충각 기동**: 술어가 **무적프레임 중**인데, 그때는 `resolveCollisions` 가
 *    `invulnerable`(`world.ts:4308`)로 접촉 피해를 통째로 건너뛰어 앵커 ④·⑧ 이 **아예 안 불린다**.
 *    설령 불려도 앵커 ⑧ 은 `(state, player, dmg)` 뿐이라 **누가 닿았는지**를 모른다 — 접촉
 *    해소 분기 자체가 그 스킬의 자리다.
 *  · **M4 슬립스트림** · **S5 극지 적응** · **S9 만료 정지장** · **M7 신호 추적** ·
 *    **M10 이중 추진**: 아래 「닿지 않는 다섯」 주석 참조.
 *
 * ### 닿지 않는 다섯 — grep 근거
 *  · **M4 슬립스트림**: 자석 흡인은 `world.ts:3895-3897` 의 원형 반경 한 줄이 전부다. "이동
 *    방향으로 길어진다" 는 그 기하 자체를 타원으로 바꿔야 하는데 앵커가 없다.
 *  · **S5 극지 적응**: 해저드 적용부(`world.ts:4361` 부근 · `HAZARD_SLOW`/`HAZARD_LAVA` 분기)가
 *    감속·용암 피해를 결정한다. "역전" 은 그 분기를 고쳐야 하고 훅이 없다.
 *  · **S9 만료 정지장**: **"이동 정지" 를 실을 필드가 없다.** `src/sim/status.ts` 의 적 상태이상은
 *    화염·냉기·전격 셋뿐이고 이동을 만지는 것은 `applySlow`(배율 `COLD_SLOW_MULT` 0.55) 하나다.
 *    `stun|freeze|frozen` 을 `src/sim/**` 전체로 grep 하면 25건이 나오지만 **적 이동 정지는
 *    한 건도 없다** — 전부 레벨업 월드 프리즈(`world.ts:995`·`autopilot.ts`)와 보스 페이즈 전이
 *    연출(`boss.ts:79`)이다. 적 속도를 0 으로 대입해도 다음 틱 행동 함수가 다시 계산해 덮으므로
 *    관측되지 않는다 — 새 상태이상 축의 신설이 선결이다.
 *  · **M7 신호 추적**: 술어 "에코·조우가 **활성**" 의 리더가 없다. `echo.ts`·`encounter.ts` 가
 *    export 하는 것은 `echoStabilizedOf`(`state === 2`) · `encounterCompletedOf`(`state === 3`)
 *    **종료 판정뿐**이라, 활성 판정을 기체 모듈에 적으면 상태기계 코드의 두 번째 사본이 된다.
 *    정본 파일에 활성 리더를 세우는 것이 선결이고 그건 이 레인 밖이다.
 *  · **M10 이중 추진**: 대시는 `dashCooldown === 0` **단일 게이트**다(`world.ts:2222`).
 *    "충전식 2회 + 별도 재충전" 은 그 게이트를 충전 카운터로 바꿔야 하는데, 앵커 ② 는 게이트가
 *    이미 통과된 **뒤**라 두 번째 충전을 만들 수 없다.
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
import type { VolleyParams } from '../skillHooks.js';
import { blastDamage, clearEnemyBullets } from '../activeTypes.js';
import { readSlot, writeSlot, StrikerCarry } from '../skillSlots.js';
import { MARKSMAN_TRIGGER_AUX0 } from '../shipSignature.js';
import { COMBO_WINDOW_TICKS } from '../constants.js';
import { applyBurn, applySlow, COLD_DURATION, FIRE_DURATION } from '../status.js';
import { sin, cos, wrapAngle, PI } from '../math.js';
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
  /** F2 반동 전달 */ recoilCarry = 1,
  /** F3 과열 배출 */ ventBurst = 2,
  /** F4 파편 격발 */ shatterRound = 3,
  /** F5 조준선 관통 */ sightlinePierce = 4,
  /** F6 소이 정조준 */ incendiaryMark = 5,
  /** F8 과열 파쇄 */ overheatShatter = 7,
  /** F9 제압 사격 */ suppressShot = 8,
  /** S1 응전 조준 */ retaliationSight = 10,
  /** S2 반사 도금 */ reactivePlating = 11,
  /** S3 전리 응급 */ fieldTriage = 12,
  /** S4 엄폐 교리 */ coverDoctrine = 13,
  /** S6 유지 보강 */ sustainField = 15,
  /** S8 콤보 차폐 */ comboShield = 17,
  /** S10 선체 증축 */ hullAccretion = 19,
  /** M1 관성 방출 */ inertiaBurst = 20,
  /** M3 수집 항로 */ gemRoute = 22,
  /** M5 벽차기 */ wallKick = 24,
  /** M6 활공 정화 */ dashPurge = 25,
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

/**
 * F5 조준선 콘의 **반각 20°**(설계서 고정값 — 레벨로 안 변한다).
 *
 * `PI / 9` 로 적는 것은 도수 리터럴을 라디안으로 바꾸는 사본을 만들지 않으려는 것이다.
 */
const SIGHTLINE_CONE_HALF = PI / 9;

// ---------------------------------------------------------------------------
// 앵커별 진입점 — `skillHooks.ts` 의 `case SIG_STRIKER_MARKSMAN:` 이 부른다
// ---------------------------------------------------------------------------

/**
 * 앵커 ② **대시 발동** — M5 벽차기(무적프레임 부분) · **M6 활공 정화**.
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
 *
 * ## M6 활공 정화 — 반경 하나로 두 효과를 낸다
 * 설계서 문면이 *"대시에 잔상 소거를 **자체 부여**하고 소거 반경 안 적에게 냉기를 건다"* 라,
 * 소거 반경과 냉기 반경이 **같은 한 값**이어야 한다(두 손잡이로 쪼개면 문면과 갈린다).
 *  · "잔상 소거" 는 유니크 `UQ_AFTERIMAGE`(`world.ts:2237-2247`)의 대시 적탄 소거를 가리키고,
 *    이 스킬은 그것을 **미보유 런에도** 준다. 유니크 보유 런에서는 같은 틱에 두 번 소거가
 *    도는데, 소거는 `dead = true` 멱등이라 이중 발화가 관측되지 않는다.
 *  · 냉기는 원소 어픽스 정본(`status.ts` 의 {@link applySlow} · {@link COLD_DURATION})을
 *    그대로 빌린다. 지속을 레벨로 늘리지 않는 것은 의도다 — 감속 강도가 `COLD_SLOW_MULT`
 *    상수 하나로 고정된 **불리언 게이트**라(그 함수 doc), 레벨 손잡이는 반경 하나로 둔다.
 *  · ⚠️ **`kind === 'enemy'` 한정이다.** `applySlow` 는 `ownerId` 를 냉기 잔여 틱으로 재활용
 *    하는데, 그 필드가 놀고 있는 것은 잡몹뿐이다(`status.ts` 헤더의 필드 재활용 규율).
 *    보스·수호 기체에 걸면 그 기체들이 실제로 쓰는 값을 덮어쓴다.
 */
export function strikerDashFired(state: WorldState, player: Entity): void {
  const m5 = lv(state, Sk.wallKick);
  if (m5 >= 1 && state.wallContactTicks > 0) {
    player.iframes += 2 + Math.floor(m5 / 4);
  }
  // ── M6 활공 정화 — 반경 150 + 10×Lv.
  const m6 = lv(state, Sk.dashPurge);
  if (m6 >= 1) {
    const radius = 150 + 10 * m6;
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

// ---------------------------------------------------------------------------
// S2 가 뚫은 앵커 ⑯ 과, 1차 배선이 지나친 앵커 ⑩·⑪ · 액티브 핸들러
// ---------------------------------------------------------------------------

/**
 * 앵커 ⑯ **볼리 파라미터 확정 직후·탄 생성 직전** — F2 반동 전달 · **F5 조준선 관통** · S8
 * 콤보 차폐(창 회복).
 *
 * ## F2 는 교환형이 아니다 — 읽기 전용 불린 게이트가 필요 없다
 * 설계서 F2 는 페널티가 한 칸도 없다(창 안 볼리가 **집속·가속·증폭**되기만 한다). 그래서
 * `countUsed`/`ballisticsUsed` 를 안 봐도 최악이 **조용한 무연산**이고, 브루저 BL6 형
 * "페널티만 증발하고 이득만 남는" 부호 반전이 원리적으로 생기지 않는다. 빔은 `spread`·`speed`
 * 를 안 읽으므로 피해 증폭만 받는다 — 그것이 설계서가 말한 「무보정일 뿐」의 반대편이다.
 *
 * ## ⚠️ F10 은 아직 여기 **없다** — F5 는 배선됐다(두 사유는 성질이 달랐다)
 * F5 는 레코드에 칸이 없어 막혀 있었고 **그 칸은 S3-1 이 열었다** — 이 레인이 그 칸을 술어로
 * 읽어 배선을 마쳤다. F10 은 칸의 문제가 아니라 이 앵커가 줄 수 있는 것의 밖이라 여전히 닿지
 * 않는다.
 *  · **F5 조준선 관통 — 배선 완료.** 막혀 있던 사유는 근거로 남긴다: 술어가 *"자동 조준 표적이
 *    `player.angle` 기준 반각 20° 콘 안인가"* 인데 이 레코드에는 오래도록 표적까지의
 *    **거리**(`targetDist`)만 있고 **방위**가 없었다. 훅이 최근접 적을 다시 고르면
 *    `nearestTarget` 선택 규칙의 두 번째 사본이 생기고(그 함수는 `world.ts` 소유라 leaf 가
 *    부를 수도 없다), 그것이 정확히 `targetDist` 를 레코드에 실은 이유다. **그 한 칸은 이제
 *    있다** — S3-1 이 `VolleyParams.aimAngle`(자동 조준이 고른 발사 방위)을 실었고, 아래
 *    본체가 그것을 **읽기만** 한다(쓰면 탄이 정말 돌아간다 — 그 필드 doc 의 ⚠️).
 *  · **F10 연장 탄창**: *"후속 볼리 1회를 즉시 추가 발사"* 라 **탄을 더 낳아야** 하는데 이
 *    앵커는 이번 볼리 한 벌의 파라미터만 준다. `count` 를 키우는 것은 같은 부채꼴을 넓히는
 *    다른 축이고(감쇠 피해를 후속분에만 실을 수 없다), 발사 자체는 `autoAttack` 의 아키타입
 *    분기가 소유한다.
 */
export function strikerVolleyParams(
  state: WorldState,
  player: Entity,
  params: VolleyParams,
): void {
  // ── F2 반동 전달 — 대시 직후 창 안에서 발사한 볼리.
  const f2 = lv(state, Sk.recoilCarry);
  if (f2 >= 1) {
    // 창 = round(대시 쿨다운 × (30 + 25×Lv/(Lv+10)) / 100) 틱. **쿨다운의 비율**이라 파워업으로
    // 쿨다운이 줄면 창도 함께 줄어, 초판의 `min(12+2×Lv, floor(쿨다운/2))` 가 갖고 있던
    // "대시를 강화할수록 F2 가 죽는" 역결합이 생기지 않는다(설계서 F2 의 ⚠️).
    const full = state.config.dashCooldownTicks;
    const window = Math.round((full * (3000 + (2500 * f2) / (f2 + 10))) / 10000);
    // 대시 직후 = 쿨다운이 아직 만충 근처. `>=` 인 것은 위상장갑 배율로 시작값이 만충보다
    // 작을 수 있어서다(그때도 "발동 직후" 는 참이어야 한다).
    if (player.dashCooldown > 0 && player.dashCooldown >= full - window) {
      // 집속 — 부채꼴이 한 줄기가 된다. 레일건·빔은 `spread` 를 안 읽어 무연산이다.
      params.spread = 0;
      // 피해 +10% + 1%p/Lv. 산술은 world 의 정조준 배율과 동형(정수 bp · 나눗셈 1회 · 반올림 1회).
      params.damage += Math.round((params.damage * (1000 + 100 * f2)) / 10000);
      // 탄속도 같은 bp 로 올린다(설계서는 "탄속·피해가 강화된다" 만 적고 탄속 수치를 주지
      // 않았다 — 손잡이를 둘로 늘리지 않으려고 피해와 같은 계수를 쓴다). 소수 탄속에
      // 반올림을 새로 만들지 않는 것은 팬텀 AS2 와 같은 규율이다.
      params.speed = (params.speed * (11000 + 100 * f2)) / 10000;
    }
  }

  // ── F5 조준선 관통 — 자동 조준 표적이 조준각 기준 반각 20° 콘 안일 때의 볼리.
  const f5 = lv(state, Sk.sightlinePierce);
  if (f5 >= 1) {
    // ⚠️ **각도 차는 반드시 래핑한다.** `params.aimAngle` 도 `player.angle` 도 각각 (-π, π] 라
    // 단순 뺄셈은 `±2π` 경계에서 `2π` 만큼 틀린다(예: 조준각 +179° · 발사 방위 −179° 는
    // 실제로 2° 차인데 뺄셈은 358° 를 준다 → 콘 안인데 밖으로 판정). `wrapAngle` 은
    // `math.ts` 의 결정론 leaf 이고 기본 산술뿐이라 sim 계약을 깨지 않는다.
    const d = wrapAngle(params.aimAngle - player.angle);
    // 경계는 **포함**(`<=`)이다 — 설계서가 "반각 20° 콘 안" 이라 적었고, 배타로 두면 정확히
    // 20° 인 볼리 하나가 부동소수 잡음에 따라 깜빡인다.
    if ((d < 0 ? -d : d) <= SIGHTLINE_CONE_HALF) {
      // 관통 +1 — **발사 시점 1회**다. 명중마다 더하면 소비 −1 과 상쇄돼 콘 안 무한 관통이
      // 되고 F4(관통 소멸 폭발)와도 충돌한다(설계서 F5 「구현」의 ⚠️).
      params.pierce += 1;
      // 피해 +6% + 1.5%p/Lv. 산술 형태는 F2 와 동형(정수 bp · 나눗셈 1회 · 반올림 1회).
      // F2 가 먼저 실린 볼리면 그 결과 위에 곱해진다 — 둘 다 볼리 단위 배율이라 곱연산이 맞고,
      // 순서를 바꿔도 상한이 생기지 않으므로 flat 인덱스 오름차순(F2 → F5)으로 둔다.
      params.damage += Math.round((params.damage * (600 + 150 * f5)) / 10000);
    }
    // ⚠️ **읽기 전용 사실(`countUsed`·`ballisticsUsed`)로 게이트하지 않는 것은 의도다.**
    // F5 는 설계서상 페널티가 한 칸도 없다(콘 밖 발사는 「무보정일 뿐」). 그래서 빔이
    // `pierce` 를 안 읽어도(`ballisticsUsed === false`) 최악이 **조용한 무연산**이고, 브루저
    // BL6 형 "페널티만 증발하고 이득만 남는" 부호 반전이 원리적으로 생기지 않는다. 빔은
    // 피해 증폭만 받는다 — F2 와 같은 사유다. `count`·`spread` 는 아예 안 건드린다.
  }

  // ── S8 콤보 차폐(뒤 절반) — **정조준 볼리를 발사한 틱**에 콤보 유지 창이 창 절반까지만 회복.
  // "이번 볼리가 정조준이었는가" 는 `params.mark === 1` 이다. `player.aux0` 은 이 지점에서 이미
  // *다음* 볼리를 가리킨다(앵커 ⑯ doc).
  //
  // ⚠️ 전액 리셋이 아니라 **`min(t + 창/2, 창)`** 이다. 설계서 §S8 의 XP 축 영향 판정이 그
  // 형태에 달려 있다 — 정조준 주기 ≈72틱당 최대 +60틱이라 틱 수지가 순감(−12/주기)이고,
  // 그래서 사격만으로 콤보가 영구화되지 않는다. 전액 리셋으로 바꾸면 XP ×1.5 가 상시화된다.
  //
  // 콤보가 0 이면 회복하지 않는다 — `stepWorld` 는 창이 0 이 되는 틱에 `combo = 0` 을 하므로
  // (world.ts:4727-4729) 스택 없는 창은 유지할 것이 없다.
  const s8 = lv(state, Sk.comboShield);
  if (s8 >= 1 && params.mark === 1 && state.combo > 0) {
    const half = COMBO_WINDOW_TICKS >> 1;
    const next = state.comboTimer + half;
    state.comboTimer = next > COMBO_WINDOW_TICKS ? COMBO_WINDOW_TICKS : next;
  }
}

/**
 * 앵커 ⑩ **아군탄이 적성 표적을 맞혀 피해가 확정된 직후** — **F8 과열 파쇄** · F6 소이 정조준 ·
 * F9 제압 사격.
 *
 * ⚠️ **F8 만 정조준 표식을 요구하지 않는다**(설계서 문면이 "명중할 때마다" 다) — 그래서 표식
 * 게이트 **앞**에 있다. 뒤 둘은 트리거가 **정조준탄 명중**이다. 표식은 앵커 ⑯ 이 `params.mark = 1` 로 찍어 탄의
 * `aux0` 에 실은 값이고(`world.ts` 의 아키타입 분기 네 곳에 흩어져 있던 대입을 S2 가 흡수했다),
 * 이 앵커가 넘기는 `source` 가 바로 그 탄이다.
 *
 * ## ⚠️ F7·S7 은 여기 **없다** — 이 앵커의 금지 사항에 정면으로 걸린다
 *  · **F7 표적 고정**: 같은 표적 연속 명중에 피해 스택을 얹는 스킬인데, 이 앵커는 `t.hp -= dealt`
 *    **뒤**라 여기서 더해 봐야 이번 일격에는 반영되지 않는다(앵커 doc 의 금지 ①과 같은 사유 —
 *    브루저 BL7·해츨링 BD4 가 같은 벽에 막혀 있다). 증폭은 차감 **전**의 자리라 `world.ts` 소유다.
 *  · **S7 최후 처형**: 잔여 HP 임계 이하를 즉사시키는 축인데 앵커 doc 가 *"처형·부활 축은 이
 *    앵커가 아니다"* 로 명시 배제했다. `dead` 판정이 이미 끝나 있어 여기서 세우면 격추 순서와
 *    부활·코어 실드 해소가 갈린다.
 *
 * ## F6 의 정산이 `hp`·`dead` 를 **함께** 움직이는 이유
 * 앵커 doc 의 금지는 *"되돌리지 마라"*(판정을 뒤집지 마라)이고, 그 경고문이 못 박은 실패는
 * **hp 와 dead 가 따로 노는 것**이다(`hp` 만 0 으로 만들면 `compact` 이 `!e.dead` 로 살려 보내
 * hp≤0 좀비가 된다 — `world.ts:4595`). 그래서 화상 정산은 원소 DoT 의 정본
 * (`status.ts:82-85` `e.hp -= …; if (e.hp <= 0) e.dead = true`)과 **완전히 같은 두 줄**로 쓴다.
 * `blastDamage` 를 빌리는 대안은 기각했다 — 그 함수는 `e.hp -=` 만 하고 `dead` 를 안 세운다.
 * ⚠️ **그때는 그랬고 지금은 세운다**(선결 과제 ⑨ 이후 `blastDamageAt` 이 `if (e.hp <= 0)
 * e.dead = true` 를 한다). 그럼에도 **기각은 유지된다** — 사유가 바뀌었을 뿐이다: 그 함수는
 * **좌표 반경 AoE** 라 반경 안의 적을 전부 때리는데, F6 정산은 화상을 **자기가 지고 있던 표적
 * 하나**에 대한 결산이다. 빌리면 무관한 이웃까지 잔여 화상 피해를 맞는다(반경 0 으로 불러도
 * 표적 좌표에 겹친 다른 적이 같이 맞는다).
 *
 * ⚠️ **정산을 "다음 status 틱으로 접는"(iframes=1 · dashCooldown=총피해) 대안도 기각했다.**
 * 이 앵커 **바로 뒤**에서 원소 어픽스가 `applyBurn(t, fireDmg, FIRE_DURATION)` 를 부르는데
 * (`world.ts:4100`), 그 함수는 지속을 **큰 쪽으로** 갱신하므로 1틱이 120틱으로 늘어나고
 * 총피해가 **틱당 피해로 승격**된다 — 화염 어픽스를 낀 런에서만 조용히 120배가 된다.
 */
export function strikerEnemyDamaged(
  state: WorldState,
  target: Entity,
  source: Entity | undefined,
): void {
  // ── F8 과열 파쇄 — **정조준 표식보다 앞이다.** 설계서 F8 은 *"보스 과열 창 동안 명중할
  // 때마다"* 이고 정조준을 요구하지 않는다. 아래 표식 게이트 뒤로 내리면 트리거가 조용히
  // 좁아진다(정조준 볼리에서만 발동 = 설계서와 다른 스킬이 된다).
  //
  // 과열 창의 인코딩은 `iframes` 다 — 보스는 그 필드를 무적이 아니라 **피해 2배 취약 창**으로
  // 쓰고(`boss.ts:10` · `entities.ts:425` · `coreRoom.ts:19`), 매 틱 1 씩 닳는다
  // (`boss.ts:116` · `coreRoom.ts:630`). 그래서 "잔여 틱 연장" 은 그 값을 더하는 것 그대로다.
  //  · **잡몹(`enemy`)은 제외**다. 그 kind 에서 `iframes` 는 F6 이 싣는 **화상 잔여 틱**이라
  //    (`status.ts` 필드 재활용 규율) 여기서 더하면 화상이 늘어난다 — F6 이 보스를 피하는 것과
  //    정확히 대칭인 회피다.
  //  · **`defenseBoss`(침공 코어룸 보스)도 대상이다.** 같은 필드에 같은 뜻으로 과열 창을
  //    싣고(`coreRoom.ts:19,658`) 앵커 ⑩ doc 가 그 kind 도 여기 온다고 못 박았다.
  //  · ⚠️ **창이 이미 열려 있을 때만** 연장한다(`iframes > 0`). 닫힌 창을 여는 것은 "연장" 이
  //    아니라 개창이고, 그러면 재장전 타이머(`dashCooldown`)가 지키는 주기가 통째로 무의미해진다.
  const f8 = lv(state, Sk.overheatShatter);
  if (
    f8 >= 1 &&
    target.iframes > 0 &&
    (target.kind === 'boss' || target.kind === 'defenseBoss')
  ) {
    // 명중당 1 + floor(Lv/8) 틱(Lv1 = 1 · Lv20 = 3). 정수 계단이라 F1·F6 과 같은 문법이다.
    target.iframes += 1 + Math.floor(f8 / 8);
  }

  // 정조준탄 표식(앵커 ⑯ 의 `mark: 1`). 표식 없는 평상시 볼리는 아래로 한 줄도 안 내려간다.
  if (source === undefined || source.aux0 !== 1) return;

  // ── F6 소이 정조준 — **`kind === 'enemy'` 한정.** 보스에 화상을 걸면 `applyBurn` 이 쓰는
  // `iframes` 가 보스에서는 **과열 취약 창**이라 그것을 덮어써 F8 과 충돌한다(설계서 F6 구현란).
  const f6 = lv(state, Sk.incendiaryMark);
  if (f6 >= 1 && target.kind === 'enemy' && !target.dead) {
    if (target.iframes > 0) {
      // 이미 화상 중 → **잔여를 즉시 일괄 정산하고 화상을 끝낸다**(스스로 장전하고 스스로 터뜨린다).
      // 잔여 = 남은 틱 × 틱당 피해(`status.ts` 의 인코딩: iframes=틱 · dashCooldown=틱당 피해).
      const burst = Math.round((target.iframes * target.dashCooldown * (10000 + 500 * f6)) / 10000);
      target.iframes = 0;
      target.dashCooldown = 0;
      if (burst > 0) {
        target.hp -= burst;
        if (target.hp <= 0) target.dead = true;
      }
    } else {
      // 화상 부여 — 기본 화염과 같은 지속(FIRE_DURATION).
      //
      // ⚠️ **설계서와 어긋나는 자리다(문서를 고치지 않고 여기 적어 둔다).** 설계서 F6 은 틱당
      // 피해를 「+5%p/Lv」로 적었는데 **무엇의 5%인지 기준량이 없다.** 탄 피해 대비로 읽으면
      // Lv1 에 탄 피해의 5% × 120틱 = **600%** 가 되어 F4 파편(30% + 2%p/Lv)과 자릿수가 두 개
      // 어긋난다. 그래서 이 레인은 F1·F8 과 같은 **정수 계단**으로 배선했다(Lv1 = 1 · Lv20 = 6).
      // 밸런스 확정 레인이 기준량을 정하면 이 한 줄만 갈아 끼우면 된다.
      applyBurn(target, 1 + Math.floor(f6 / 4), FIRE_DURATION);
    }
  }

  // ── F9 제압 사격 — 좌표 **직접 변위**(속도 대입이 아니다 · 넉백 규율 7.1, 버블 파열 선례).
  // 보스도 대상이고 보스·엘리트는 반감이다(설계서 F9). 구조물·설비는 밀지 않는다.
  const f9 = lv(state, Sk.suppressShot);
  if (f9 >= 1 && (target.kind === 'enemy' || target.kind === 'boss')) {
    // 엘리트 판정은 `compact` 의 전리품 게이트와 같은 술어(`kind === 'enemy' && pierce > 0`).
    const halved = target.kind === 'boss' || target.pierce > 0;
    const base = 24 + 4 * f9;
    const push = halved ? Math.round(base / 2) : base;
    // 방향은 **가해 탄의 진행 방향**이다. 플레이어→적 벡터를 다시 구하면 관통탄이 두 번째
    // 표적을 뒤로 미는 순간 부호가 갈린다.
    target.x += cos(source.angle) * push;
    target.y += sin(source.angle) * push;
  }
}

/**
 * 앵커 ⑪ **잡몹 하나가 실제로 격추된 사건** — S3 전리 응급.
 *
 * 엘리트 격파에만 반응한다. `elite` 는 `compact` 이 격추 시점에 평가한 값이라 전리품 게이트가
 * 굴린 그 판정과 **같은 값**이다 — 여기서 다시 세면 두 술어가 갈린다.
 *
 * ⚠️ **보스 격파는 이 앵커에 오지 않는다**(`compact` 의 보스 분기는 `state.kills` 를 올리지
 * 않는다). 설계서 S3 은 "엘리트를 처치하면" 이므로 **손실 없이 전량 배선**이다.
 */
export function strikerEnemyDeath(state: WorldState, player: Entity, elite: boolean): void {
  if (!elite) return;
  const s3 = lv(state, Sk.fieldTriage);
  if (s3 < 1) return;
  const healed = player.hp + 4 + s3;
  player.hp = healed > player.maxHp ? player.maxHp : healed;
}

/**
 * **액티브 핸들러 — 화력(strike)** 발동 틱. F3 과열 배출.
 *
 * 두 가지를 한다: ①주무기 쿨다운 잔여를 환급하고 ②fanStrike 탄에 실을 **추가 배율 bp** 를
 * 돌려준다(0 = 미투자). 반환으로 넘기는 것은 `fanStrike` 호출이 핸들러 소유라서다 — 여기서
 * 투사체를 다시 낳으면 액티브 관측량(투사체 개수)이 이중으로 센다.
 *
 * ⚠️ **`player.cooldown > 0` 가드가 필수**다. 무조건 0 을 대입하면 `fireCooldownQ` 의 **음수
 * carry**(소수 주기를 정수 산술로 재현하는 선지급분)를 버려, 액티브를 누를수록 장기 DPS 가
 * 미세하게 **깎이는** 부호 반전이 된다(설계서 공통 고지 ④).
 */
export function strikerFirepowerActive(state: WorldState, player: Entity): number {
  if (!state.skillsOn) return 0;
  const f3 = lv(state, Sk.ventBurst);
  if (f3 < 1) return 0;
  if (player.cooldown > 0) player.cooldown = 0;
  // fanStrike 탄 추가 배율 +10% + 2%p/Lv.
  return 1000 + 200 * f3;
}

/**
 * **액티브 핸들러 — 생존(buff) 지속 틱**(`STRIKER_SUSTAIN`, 매 틱). S6 유지 보강.
 *
 * 설계서 S6 은 *"생존 액티브 지속 중 자석 반경이 커지고 이동 감속에 면역이 된다"* 다. 발동
 * 틱이 아니라 **지속 틱**이 트리거라 `STRIKER_HANDLERS` 가 아니라 sustain 표에 건다 —
 * 발동 틱에 한 번 세우는 형태로 바꾸면 버프가 끝난 뒤에도 효과가 남는다(같은 파일의
 * `refreshIframes` 주석이 그 실패를 이미 적어 뒀다).
 *
 * ## ① 자석 반경 — `magnetBuffTicks` 를 매 틱 되세운다
 * 자석 실효 반경은 `state.magnetBuffTicks > 0 ? magnetRadius × MAGNET_BUFF_MULT : magnetRadius`
 * 한 줄이 정본이다(`world.ts:3897`). `magnetRadius` 를 직접 키우면 **되돌릴 자리가 없어**
 * (만료 훅이 있는 것은 `survival_hi` 뿐이고, 사망·구간 전환에서 원복이 유실된다) 영구 증가가
 * 되므로, 이미 있는 **일시 배율 게이트**를 빌린다.
 *  · ⚠️ **2 를 세운다(1 이 아니다).** 감소(`world.ts:3895`)가 이 훅(`stepActives`, 1833)보다
 *    **뒤**라, 1 을 세우면 같은 틱에 0 으로 내려가 바로 다음 줄의 반경 판정이 거짓이 된다.
 *    2 면 버프가 끝난 뒤 최대 2틱만 남고 스스로 사라진다 — 원복 코드가 필요 없다.
 *  · 자석 방사기 버프(`triggerMagnetEmitter`, 600틱)를 **줄이지 않는다**(`< 2` 일 때만 쓴다).
 *  · ⚠️ **레벨 손잡이가 없다.** 이 게이트가 불리언이고 배율은 `MAGNET_BUFF_MULT` 상수 하나라
 *    레벨로 벌릴 축이 원리적으로 없다. 반경을 레벨 비례로 키우려면 `world.ts:3897` 이 스킬
 *    파생 배율을 읽어야 하고, 그건 이 레인 밖이다(설계-코드 어긋남이 아니라 **미도달**이다).
 *
 * ## ② 이동 감속 면역 — 잔여 틱을 0 으로 민다
 * 플레이어 감속은 `state.playerSlowTicks > 0` 불리언 게이트 하나다(`world.ts:2207`). 이 훅은
 * `stepPlayer` 의 그 판정보다 **앞**이고 감속을 세우는 지점(해저드 접촉, `world.ts:4361`)보다는
 * **뒤**라, 직전 틱에 밟은 감속이 이번 틱 이동에 실리기 전에 지워진다 = 설계서의 "면역".
 * 접촉 그 틱은 애초에 감속이 안 실린다(세우는 지점이 `stepPlayer` 뒤다).
 */
export function strikerSurvivalSustain(state: WorldState, player: Entity): void {
  if (!state.skillsOn) return;
  void player;
  const s6 = lv(state, Sk.sustainField);
  if (s6 < 1) return;
  if (state.magnetBuffTicks < 2) state.magnetBuffTicks = 2;
  state.playerSlowTicks = 0;
}

/**
 * **액티브 핸들러 — 기동(blink)** 발동 틱, **도약보다 앞**. M1 관성 방출.
 *
 * 설계서가 요구한 것은 「**출발 지점**에 폭발 + 적탄 소거」다. 도약 뒤에 좌표를 되짚는 대신
 * **도약 전에** 부르면 `player.x/y` 가 곧 출발 지점이라 좌표 사본이 아예 생기지 않는다.
 * 2단 도약(`as_striker_mobility_hi`)에서도 출발 지점은 하나이므로 루프 **밖**에서 한 번만 부른다.
 */
export function strikerBlinkOrigin(state: WorldState, player: Entity): void {
  if (!state.skillsOn) return;
  const m1 = lv(state, Sk.inertiaBurst);
  if (m1 < 1) return;
  const radius = 120 + 10 * m1;
  blastDamage(state, player, radius, 20 + 4 * m1);
  clearEnemyBullets(state, player, radius);
}
