/**
 * **해츨링 30스킬의 효과 본체**(ADR-0049 배치 5 · 설계 정본
 * `.omc/plans/skill-rebuild-2026-08-05/hatchling.md` 확정 3판).
 *
 * 형태는 **스트라이커 레인이 확립한 다섯 규율을 그대로 따른다**(`skills/striker.ts` 헤더가 정본):
 * ①`world.ts` 런타임 import 0건(타입은 type-only) ②모든 쓰기는 투자 게이트 안쪽 ③반올림은
 * 게이트 안 ④RNG 소비 0 ⑤슬롯 접근은 `readSlot`/`writeSlot` 만.
 *
 * ---
 *
 * ## ⚠️ 배선 현황 — **30종 중 17종**(배치 5 의 9종 + W레인 7종 + W2 레인의 BD10)
 * W레인이 앵커 ㉓·㉔ 로 **BD1·BD2·SH10·NU10·BD6·NU2·NU7** 7종을 얹었고, **W2 레인이 앵커 ㉖
 * (`onTurretShotParams`, 포탑 사격 지점)을 새로 세워 BD10 을 3축 전부 배선했다** — 상한 −1(㉓의
 * {@link broodMaxDrones}) · 수명 가산(㉔) · 탄 피해 배율(㉖). 아래 4묶음은 **배치 5 시점의
 * 기록**이고 그 사유 문장은 지금도 참이므로 지우지 않는다 — 다만 1묶음(출격 지점 8종)은
 * **8종 전부 배선됐고**, 2묶음(포탑 루프 6종)은 앵커 ㉖ 이 서면서 **탄 파라미터 축이 열렸다**
 * (BD7 은 그 레코드에 자기 칸을 더하면 된다 — `TurretShotParams` doc 참조).
 *
 * ## ⚠️ (배치 5 시점 기록) 이 배치가 배선한 것은 30종 중 **9종**이다 — 해츨링이 7기체 중 가장 적다
 * 사유는 기체 고유다. **해츨링 스킬 30종 중 21종의 효과 지점이 `world.ts` 의 두 비공개 함수
 * (`stepHatchBrood` · `stepTurrets`)와 액티브 핸들러 안**이고, 앵커 14개는 그중 어느 것에도
 * 닿지 않는다. 이건 "구현했는데 안 불린다"가 아니라 **아직 코드가 없다** — 미배선 21종의
 * 사유는 아래 4묶음이고, 각 앵커 함수의 주석이 개별로 다시 적는다:
 *
 *  1. **출격 지점(`stepHatchBrood`) 소관 — 8종**: BD1(임계 감산) · BD2(쌍둥이) · BD6(출격
 *     충격파) · BD10(상한 −1) · NU2(알껍질 젬) · NU7(원정 부화 좌표) · NU10(저금 선납) ·
 *     SH10(상한 +1). 전부 "출격이 성사되는 그 한 지점"에서 임계·상한·좌표·부수효과를
 *     바꾼다. 앵커 ⑨(`onSignatureStep`)는 `stepShipSignature` **진입점**이라 `stepHatchBrood`
 *     보다 앞이고, 출격 여부·좌표를 그 시점에 알 수 없다.
 *     ✅ **2026-08-07(S3-4) 이 이 지점을 뚫었다 — 이제 자리가 있다.** 앵커 ㉓
 *     (`onBroodLaunchParams`, 임계 조기 반환보다 **앞** · `threshold`/`maxDrones`/`launchCount`)
 *     와 앵커 ㉔(`onBroodLaunched`, 병아리 1기가 태어난 **직후** · 개체를 넘긴다)이 그것이다.
 *     위 사유는 **왜 ⑨ 로는 안 되는가**의 기록으로 남긴다(그 문장은 지금도 참이다). 다만
 *     BD10 의 **탄 피해 배율**만은 ㉔ 로도 안 닿는다 — 사유는 그 앵커 doc 말미에 있다(수명
 *     가산은 닿는다).
 *     ✅ **2026-08-07(W레인)이 이 묶음의 8종 중 7종을 배선했다** — BD1·BD2·SH10·NU10 은
 *     앵커 ㉓ 에, BD6·NU2·NU7 은 앵커 ㉔ 에 있다. 남은 BD10 을 넣지 않은 이유는 반쪽 배선
 *     금지였다: 상한 −1 과 수명 가산은 ㉓·㉔ 로 닿지만 **탄 피해 배율**이 `stepTurrets`/
 *     `fireTurretShot` 소관이라 안 닿아, 상한만 깎으면 순손해 스킬이 된다.
 *     ✅ **2026-08-07(W2 레인)이 앵커 ㉖ 으로 그 셋째 축을 열고 BD10 을 배선했다** — 이 묶음은
 *     **8종 전부 배선**이다.
 *  2. **포탑 루프(`stepTurrets`/`fireTurretShot`) 소관 — 6종**: BD7(발사 횟수 누적 강화) ·
 *     BD9(보류 중 발사 간격) · NU1(병아리 자석장) · SH8(적탄 소거·수명 소모) ·
 *     SH9(자연 만료 시 둥지벽) · BD3/NU9 의 자연 만료 경로. 쿨다운 리셋·수명 만료·표적 조회가
 *     전부 그 루프 안이다.
 *  3. **소멸 단일 지점이 없어서 — 2종**: BD3(작별 격발) · NU9(둥지 표식). 설계 ②말미
 *     「소멸 경로 전수 표」가 요구하는 **모든** 소멸 경로 중 자연 만료가 `stepTurrets` 안이라,
 *     여기서 SH1·SH7 소멸분만 배선하면 세 경로 중 둘만 도는 반쪽이 된다 — 그 반쪽이 곧
 *     "화면과 규칙이 갈린다"라 넣지 않았다. (그래서 SH1·SH7 이 기록하는 `aux1` 사유 코드는
 *     **아직 읽는 쪽이 없다** — 미리 쓰는 이유는 그 함수 주석에 있다.)
 *  4. **액티브 핸들러·앵커 밖 트리거 — 5종**: BD4(표적 공유 증폭) · BD8(brood 강습) ·
 *     NU3(업어 나르기) · NU4(둥지 소집) · SH2(위기 산개) · SH4(품기 진형).
 *     BD4 는 앵커 ⑩ 이 **hp 차감·격추 판정이 끝난 뒤**라 증폭분이 격추로 이어지지 못한다
 *     (앵커 주석의 "hp/dead 를 되돌리지 마라"). NU3 는 대시 **도착 좌표**가 발동 틱에 아직
 *     없다(속도만 실린다). SH2 는 앵커 ④ 가 피격원 엔티티·접근 벡터를 넘기지 않는다.
 *     BD8·NU4·SH4 는 액티브 핸들러/SUSTAIN 훅 소관이라 앵커 14개 밖이다.
 *
 * ## ⚠️ 아군 소환은 이 파일이 하지 않는다
 * 병아리 출격은 시그니처(`stepHatchBrood`)의 일이고 30스킬은 **직접 소환하지 않는다**
 * (설계 ①절 · ADR-0041 Non-Goal ①). `spawnEnemy` 는 `waveRng` 를 소비해 결정론을 깨므로
 * 아군 소환에 절대 쓰지 않는다 — 이 파일은 엔티티를 하나도 만들지 않는다.
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
// ⚠️ **타입 전용 import 다**(erasable) — `skillHooks.ts` 가 이 파일을 런타임 import 하므로
// 값으로 끌어오면 순환이 된다. `BroodParams` 는 앵커 ㉓ 의 계약 그 자체라 사본을 만들지 않는다.
import type { BroodParams, TurretShotParams } from '../skillHooks.js';
import { isActiveTurret, TURRET_LIFE_TICKS } from '../events.js';
import { blastDamage, clearEnemyBullets } from '../activeTypes.js';
import { spawnGem } from '../entities.js';
import { slideCircleWalls } from '../los.js';
import { applySlow, COLD_DURATION } from '../status.js';
import { readSlot, writeSlot, HatchlingStage } from '../skillSlots.js';
import { BROOD_MARK } from '../shipSignature.js';
import { DT } from '../constants.js';
import { skillLv } from '../../items/skills.js';

// ---------------------------------------------------------------------------
// flat 인덱스 — `data/ships/hatchling.ts` 의 축 순서가 정본
// ---------------------------------------------------------------------------
//
// `trees: [brood(offense), nurture(utility), shelter(defense)]` 이므로
// BD1..BD10 = 0..9 · NU1..NU10 = 10..19 · SH1..SH10 = 20..29 다.
//
// ⚠️ **기체마다 축 순서가 다르다.** 스트라이커는 [offense, defense, utility], 아크캐스터는
// [chain, barrage, barrier] 다 — 설계서의 서술 순서를 믿지 말고 언제나 `data/ships/{ship}.ts`
// 의 `trees` 배열을 보라. 해츨링은 서술 순서(부화→양육→둥지)와 데이터가 일치한다.

const enum Sk {
  /** BD1 조기 부화 */ earlyHatch = 0,
  /** BD2 쌍둥이 부화 */ twinHatch = 1,
  /** BD5 격발 공명 */ volleyResonance = 4,
  /** BD6 부화 충격파 */ hatchShockwave = 5,
  /** BD10 여왕 사출 */ matriarchLaunch = 9,
  /** NU2 알껍질 영양 */ eggshellNutrients = 11,
  /** NU5 알 굴리기 */ eggRoll = 14,
  /** NU6 온기 나눔 */ sharedWarmth = 15,
  /** NU7 원정 부화 */ expeditionHatch = 16,
  /** NU8 이주 본능 */ migrationInstinct = 17,
  /** NU10 알 저금 */ eggBank = 19,
  /** SH1 호위 희생 */ escortSacrifice = 20,
  /** SH3 만석 둥지 온기 */ fullNestWarmth = 22,
  /** SH5 경계 지저귐 */ alarmChirp = 24,
  /** SH6 알막 */ eggMembrane = 25,
  /** SH7 회생 부화 */ rebirthHatch = 26,
  /** SH10 확장 둥지 */ expandedNest = 29,
}

/**
 * 이 런에서 그 스킬의 **실효 레벨**(투자 + 축 어픽스). 미투자면 0 이다(`skillLv` 정본 1).
 * 기체 게이트는 호출부(`skillHooks.ts` 의 `case SIG_HATCHLING_BROOD`)가 이미 걸었다.
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
// 시그니처 유도 상수·술어
// ---------------------------------------------------------------------------

/**
 * 병아리 동시 생존 상한. `world.ts` 의 `BROOD_MAX_DRONES`(=4)가 **파일 지역 상수**라 import 할
 * 수 없다 — `skills/arccaster.ts` 가 `OVERCHARGE_TICK_CAP` 에서 이미 같은 사유로 같은 값을
 * 지역 선언했고 이 파일은 그 선례를 따른다(값이 바뀌면 두 곳을 함께 고쳐야 한다).
 *
 * ⚠️ (배치 5 시점 기록) **BD10(−1)·SH10(+1)이 미배선이라 그 배치에서 실효 상한은 항상 4 였다.**
 * 지금은 둘 다 {@link broodMaxDrones} 에 있다. 설계 BD10 의
 * 정본 합산식(`4 − BD10투자 + SH10투자`, 하한 1)은 두 스킬이 `stepHatchBrood` 에 배선되는
 * 레인이 여기 대신 세운다 — 지금 여기에 합산식만 미리 적으면 SH3 의 만석 술어와 실제 출격
 * 상한이 조용히 갈린다(만석이 아닌데 만석이라고 읽는다).
 *
 * ✅ **그 자리는 이제 있다(S3-4)** — 앵커 ㉓ 의 `params.maxDrones` 다. 다만 **배선 자체는 아직
 * 안 됐으므로 위 경고는 그대로 유효하다**: 두 스킬을 ㉓ 에 얹는 레인은 합산식을 **한 곳에만**
 * 두고(예: 이 파일의 공용 헬퍼) ㉓ 와 SH3 의 만석 술어가 **같은 함수를 읽게** 해라. 두 곳에
 * 따로 적는 순간 위 문단이 경고한 그 갈림이 그대로 재현된다.
 *
 * ✅ **2026-08-07(W-해츨링)이 그 헬퍼를 세웠다** — {@link broodMaxDrones} 다. 이 리터럴은
 * 이제 **기본항 4** 이고, 실효 상한을 읽는 쪽은 앵커 ㉓ 도 SH3 도 전부 그 함수를 통한다.
 */
const BROOD_MAX_DRONES = 4;

/**
 * **실효 병아리 상한** — 위 상수의 유일한 소비 지점이다. 앵커 ㉓ 의 `params.maxDrones` 와
 * SH3 의 만석 술어가 **둘 다 이 함수를 읽는다**(위 경고가 요구한 "한 곳").
 *
 * 정본 합산식(설계 BD10)은 `4 − BD10투자유무 + SH10투자유무 (하한 1)` 이고, **이제 두 항이
 * 다 있다**(2026-08-07 W2 레인). 앞 레인이 BD10 항을 비워 둔 사유는 반쪽 배선 금지였다 —
 * 상한 −1·수명 가산은 앵커 ㉓·㉔ 로 닿지만 **탄 피해 배율**이 `stepTurrets`/`fireTurretShot`
 * 소관이라 안 닿아, 상한만 깎으면 *"−1기를 내주고 정예화는 안 받는"* 순손해가 됐다. W2 가
 * **앵커 ㉖(`onTurretShotParams`)** 를 그 루프에 세워 세 번째 축을 열었고, 그래서 여기 −1 이
 * 들어왔다. 세 축이 한 커밋에 다 있다 — 하나라도 떼면 다시 순손해다.
 *
 * ⚠️ **투자 "유무"이지 레벨 비례가 아니다**(설계 문구 그대로). 레벨은 강화 배율에만 실린다.
 */
function broodMaxDrones(state: WorldState): number {
  const n =
    BROOD_MAX_DRONES -
    (lv(state, Sk.matriarchLaunch) >= 1 ? 1 : 0) +
    (lv(state, Sk.expandedNest) >= 1 ? 1 : 0);
  return n > 1 ? n : 1;
}

/**
 * **BD10 결손** = `max(0, 4 − 실효상한)`. 강화 배율의 유일한 계수다(설계 BD10).
 *
 * ⚠️ **SH10 동시 투자면 결손이 0 이라 강화도 0 이다** — 설계가 명시한 구조적 배타(1R
 * CRITICAL-2)를 산술이 그대로 만든다. 그러라고 여기서 `broodMaxDrones` 를 읽는다: 실효
 * 상한을 두 곳에 따로 적으면 배타가 조용히 풀린다.
 *
 * ⚠️ **미투자면 0 을 돌려준다** — 호출부는 이 값이 0 인지로 조기 반환하지 말고 BD10 투자
 * 여부를 따로 봐라. 상한을 SH10 이 5 로 올린 런은 미투자와 같은 0 이지만, 그건 "BD10 이
 * 꺼졌다"가 아니라 "결손을 되샀다"다(같은 결과, 다른 사유).
 */
function broodDeficit(state: WorldState): number {
  const d = BROOD_MAX_DRONES - broodMaxDrones(state);
  return d > 0 ? d : 0;
}

/**
 * 살아 있는 병아리 수. 술어는 `world.ts:2627` 의 3중 술어와 **글자 그대로 같다** —
 * `!dead && ownerId === BROOD_MARK && isActiveTurret` (설계 ⑤ 공통 고지 ④).
 * 여기서 한 칸이라도 다르게 적으면 시그니처의 상한 계수와 스킬의 만석 판정이 갈린다.
 */
function isChick(e: Entity): boolean {
  return !e.dead && e.ownerId === BROOD_MARK && isActiveTurret(e);
}

function countChicks(state: WorldState): number {
  let n = 0;
  for (const e of state.entities) {
    if (isChick(e)) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// 레벨 스케일 — 설계서 ② 의 공식 그대로
// ---------------------------------------------------------------------------
//
// ⚠️ 나눗셈이 낀 셋(SH1 흡수 · SH3 주기 · SH7 기당 잔존)은 `skillDerived` 가 아니라 여기서
// 계산한다 — 사유는 `skills/striker.ts` 의 같은 주석이 정본이다. 셋 다 발화 빈도가 낮다
// (SH1·SH7 은 피격 틱, SH3 은 `tick % 주기 === 0` 인 틱뿐)이라 sim 루프의 상시 나눗셈이 아니다.

/** SH1 흡수량 = round(8 + 60×Lv/(Lv+18)) (Lv1 ≈ 11, Lv20 ≈ 40, 점근 68). */
function sacrificeAbsorb(level: number): number {
  return Math.round(8 + (60 * level) / (level + 18));
}

/** SH3 회복 주기 = 60 + 4800/(Lv+20) 틱 (Lv1 ≈ 288, Lv20 = 180, 점근 60 — 0 교차 없음). */
function warmthPeriodTicks(level: number): number {
  return 60 + Math.floor(4800 / (level + 20));
}

/** SH7 소멸 1기당 잔존 HP = 4 + round(16×Lv/(Lv+12)) (Lv1 ≈ 5, Lv20 = 14, 점근 20). */
function rebirthHpPerChick(level: number): number {
  return 4 + Math.round((16 * level) / (level + 12));
}

// ---------------------------------------------------------------------------
// 앵커 ① — 주무기 볼리 발사가 확정된 지점
// ---------------------------------------------------------------------------

/**
 * **BD5 격발 공명** — 모선이 볼리를 쏘는 틱에 살아 있는 병아리 전원의 발사 쿨다운이 깎인다.
 *
 * 감산량 = 1 + floor(Lv/5) 틱 (5레벨 폭 정수 계단). **0 클램프가 계약이다**(설계 ⑤ 공통 고지 ②) —
 * 포탑 쿨다운은 `stepTurrets` 가 `> 0` 일 때만 감소시키고 `0` 이면 발사하므로, 음수로 내려가면
 * 그 틱의 발사 판정이 통째로 건너뛰어져 **연사가 빨라지는 게 아니라 멈춘다.**
 *
 * ⚠️ 이 앵커는 **무기 아키타입 분기보다 앞**이라 탄이 아직 없다(앵커 ① 주석). BD5 는 탄을
 * 보지 않고 "볼리가 나갔다"만 보므로 여기서 성립한다.
 */
export function hatchlingVolleyFired(state: WorldState, player: Entity): void {
  void player;
  const bd5 = lv(state, Sk.volleyResonance);
  if (bd5 < 1) return;
  const cut = 1 + Math.floor(bd5 / 5);
  for (const e of state.entities) {
    if (!isChick(e)) continue;
    if (e.cooldown <= 0) continue;
    const next = e.cooldown - cut;
    e.cooldown = next > 0 ? next : 0;
  }
}

// ---------------------------------------------------------------------------
// 앵커 ② — 대시가 실제로 발동한 지점
// ---------------------------------------------------------------------------

/**
 * **NU5 알 굴리기(전진 절반만)** — 대시 발동 틱에 부화 스냅샷이 1 전진한다.
 *
 * 액티브 6종의 `advanceHatch`(`activeHandlers/hatchling.ts`)와 **같은 문법·같은 0 클램프**다.
 * 설계가 못 박은 대로 전진량은 **1 고정**(레벨 불변) — 레벨로 키우면 액티브 `brood_hi` 의
 * 소각 트레이드가 무의미해진다. 0 클램프의 소각분은 전진 1 이라 최대 1 처치분이다(정직 표기).
 *
 * ## ⚠️ 이 스킬은 **반쪽만 배선됐다**
 * 설계 NU5 의 나머지 절반인 **대시 경로 위 젬 즉시 수거**(폭 80 + 6×Lv)는 `collectGem` 이
 * `world.ts` 비공개라 leaf 에서 닿지 않는다. 그래서 **레벨 스케일이 통째로 미배선**이다 —
 * 지금 NU5 는 1레벨이든 20레벨이든 효과가 같다. 이건 결함이 아니라 이 배치의 한계이고,
 * 젬 축을 배선하는 레인이 폭 공식을 여기 대신 그 지점에 세운다.
 */
export function hatchlingDashFired(state: WorldState, player: Entity): void {
  const nu5 = lv(state, Sk.eggRoll);
  if (nu5 < 1) return;
  const next = Math.trunc(player.aux0) - 1;
  player.aux0 = next > 0 ? next : 0;
}

// ---------------------------------------------------------------------------
// 앵커 ⑧ — 감쇠 사슬의 스킬 슬롯 2칸
// ---------------------------------------------------------------------------

/**
 * **① 감소 없음 → ② 흡수(SH1 호위 희생 → SH7 회생 부화).**
 *
 * 해츨링에는 감소류 스킬이 없다 — 둘 다 흡수 칸이다. 그 **둘 사이의 순서는 설계 SH1 의
 * 1R 확정 그대로 「SH1 먼저 → 그래도 치사면 SH7」** 이다. 역순이면 전액 청산(SH7)이 매번 먼저
 * 성립해 건별 잔돈(SH1)이 치사 상황에서 영영 안 돈다.
 *
 * ⚠️ **정수화는 전부 이 게이트 안**이다(앵커 ⑧ 주석). 접촉 피해에는 엘리트 배율이 섞여
 * 소수가 될 수 있고, 반올림이 게이트 밖으로 나가면 스킬 없는 런의 소수 피해까지 바뀐다.
 */
export function hatchlingDamageChain(state: WorldState, player: Entity, dmg: number): number {
  let out = dmg;

  // ── SH1 호위 희생 — 병아리 1기가 대신 소멸하며 피해 일부를 흡수. 0기면 미발동(대가 내장).
  const sh1 = lv(state, Sk.escortSacrifice);
  if (sh1 >= 1 && out > 0) {
    const victim = firstChick(state);
    if (victim !== undefined) {
      killChick(victim);
      out -= sacrificeAbsorb(sh1);
      if (out < 0) out = 0;
    }
  }

  // ── SH7 회생 부화 — SH1 흡수 뒤에도 치사면 전원 소멸시키고 그 수에 비례한 HP 를 남긴다.
  //    술어는 "이 피해가 hp 를 0 이하로 만드는가" = `out >= player.hp` 다.
  const sh7 = lv(state, Sk.rebirthHatch);
  if (sh7 >= 1 && out > 0 && player.hp > 0 && out >= player.hp) {
    let n = 0;
    for (const e of state.entities) {
      if (!isChick(e)) continue;
      killChick(e);
      n++;
    }
    if (n > 0) {
      // 기당 잔존 합과 **총량 상한(maxHp 의 30% + 1%p/Lv)** 의 min — 대형 피해 평준화 방지.
      const perChick = rebirthHpPerChick(sh7) * n;
      const cap = Math.round((player.maxHp * (3000 + 100 * sh7)) / 10000);
      const remain = perChick < cap ? perChick : cap;
      // hp − out = remain 이 되도록 피해를 깎는다. remain 은 1 이상이라 반드시 생존한다.
      const left = remain > 0 ? remain : 1;
      out = player.hp - left;
      if (out < 0) out = 0;
    }
  }

  return out;
}

/** 배열 순서 tie-break 로 고른 첫 병아리(설계 SH1 구현란). 없으면 `undefined`. */
function firstChick(state: WorldState): Entity | undefined {
  for (const e of state.entities) {
    if (isChick(e)) return e;
  }
  return undefined;
}

/**
 * 병아리 **강제 소멸** — SH1·SH7 공용.
 *
 * `aux1 = 1`(사유 = 희생)은 설계 ②말미 「소멸 경로 전수 표」의 계약이다. **지금 이 값을 읽는
 * 쪽은 없다**(SH9 이소 둥지가 유일한 독자이고 그건 `stepTurrets` 의 자연 만료 분기 소관이라
 * 이 배치에서 미배선 — 헤더 사유 3묶음). 그럼에도 지금 쓰는 이유는, 독자가 붙는 레인이
 * **자연 만료(0)와 희생(1)을 사후에 구분할 방법이 없기 때문**이다 — 소멸 시점에 안 남기면
 * 그 정보는 영영 복원되지 않는다. `turretPickup` 의 `aux1` 점유는 grep 0건이고(편대 인코딩은
 * `kind === 'enemy'` 한정) 이미 해시되는 필드라 레이아웃은 불변이다.
 *
 * ⚠️ **`phase` 를 건드리지 마라** — 병아리의 `phase` 는 미사용 필드가 아니라 **생사 스위치**다
 * (`isActiveTurret` · 스크롤 앵커 판정 · 렌더가 전부 `phase === 1` 을 읽는다).
 */
function killChick(e: Entity): void {
  e.dead = true;
  e.aux1 = 1;
}

// ---------------------------------------------------------------------------
// 앵커 ⑨ — 시그니처 틱 진행(매 틱 정확히 한 번)
// ---------------------------------------------------------------------------

/**
 * **SH6 알막 · SH3 만석 둥지 온기 · NU6 온기 나눔 · NU8 이주 본능.**
 *
 * ## ⚠️ 이 앵커는 `stepHatchBrood` 보다 **앞**이고 `stepTurrets` 보다 **앞**이다
 * `stepShipSignature` 진입점이라(앵커 ⑨ 주석) 이번 틱의 출격은 아직 없었고, 포탑 루프의
 * 수명 감소·발사도 아직이다. 그래서:
 *  - **SH6 은 한 틱 늦게 잡힌다**(아래 술어 참조) — 유실은 없고 발화만 1틱 늦다.
 *  - **NU6 은 같은 틱의 `life--` 를 정확히 상쇄한다** — 여기서 +1 하고 곧이어 `stepTurrets` 가
 *    −1 하므로 순감소가 0 이다. 순서가 반대면 `life === 0` 만료 판정을 이미 지난 뒤라 상쇄가
 *    한 틱 헛돈다.
 *  - **NU8 이 옮긴 좌표에서 그 틱의 사격이 나간다** — 걷고 나서 쏜다.
 *
 * ## ⚠️ S3-4 가 출격 지점에 앵커 ㉓·㉔ 을 뚫었지만 **SH6 은 여기 그대로 둔다**
 * SH6 은 **모선**에 무적을 거는 좌표 무관 효과이고(설계 NU7 의 출격 좌표 상호작용 절이
 * "SH6 만은 이전되지 않는다"고 명시), 지금 술어가 이미 유실 없이 작동한다. ㉔ 으로 옮기면
 * 1틱 앞당겨지는 대신 **거동이 바뀐다**(해시가 갈린다) — 그 이득이 없다. 아래 "출격 지점에
 * 닿을 수 없으므로" 는 이 앵커(⑨)에 한한 사실로 계속 참이다.
 */
export function hatchlingSignatureStep(state: WorldState, player: Entity): void {
  // ── SH6 알막 — **출격 틱에 모선이 짧은 무적**. 출격 지점에 닿을 수 없으므로 술어를
  //    `player.aux0` 의 **증가**로 유도한다: 출격 성공은 `aux0 = state.kills` 로 스냅샷을
  //    끌어올리는 유일한 경로이고(`world.ts:2650`), 반대 방향(감소)은 액티브 6종의
  //    `advanceHatch` 와 NU5 뿐이다. 그래서 "증가했다 ⇒ 직전 틱에 출격했다" 가 성립한다.
  //    ⚠️ 좌표 무관 효과라 NU7(원정 부화)로 발생지가 옮겨져도 이전되지 않는다(설계 NU7 명시).
  const sh6 = lv(state, Sk.eggMembrane);
  if (sh6 >= 1) {
    const seen = readSlot(state.skillStage, HatchlingStage.launchAux0Seen);
    const cur = Math.trunc(player.aux0);
    if (cur > seen) {
      const iframes = 20 + 3 * sh6;
      if (player.iframes < iframes) player.iframes = iframes;
    }
    writeSlot(state.skillStage, HatchlingStage.launchAux0Seen, cur);
  }

  // 아래 셋은 전부 병아리 순회가 필요하다 — 투자한 것이 하나도 없으면 순회 자체를 건너뛴다.
  const sh3 = lv(state, Sk.fullNestWarmth);
  const nu6 = lv(state, Sk.sharedWarmth);
  const nu8 = lv(state, Sk.migrationInstinct);
  if (sh3 < 1 && nu6 < 1 && nu8 < 1) return;

  // ── SH3 만석 둥지 온기 — 실효 상한 만석인 동안 주기마다 +2(maxHp 클램프).
  //    주기는 config 확정 정수라 `% 0` 이 불가능하다(하한 60).
  if (sh3 >= 1 && player.hp > 0 && player.hp < player.maxHp) {
    // ⚠️ 만석 술어는 **실효 상한**을 읽는다({@link broodMaxDrones}) — SH10 을 함께 찍으면
    //    상한이 5 이므로 4기로는 만석이 아니다. 여기서 리터럴을 읽으면 출격 상한과 갈린다.
    if (state.tick % warmthPeriodTicks(sh3) === 0 && countChicks(state) >= broodMaxDrones(state)) {
      const t = player.hp + 2;
      player.hp = t > player.maxHp ? player.maxHp : t;
    }
  }

  // ── NU6 온기 나눔 — 콤보 창 유지 중 병아리 수명 감소 절반, 임계 스택 이상이면 정지.
  //    `stepTurrets` 의 `life--` 를 직접 게이트할 수 없으므로 **여기서 +1 로 상쇄**한다.
  //    홀짝은 `state.tick` 의 우함수라 결정론이 자명하다(설계 NU6 구현란).
  //    임계 스택 = max(1, 12 − floor(Lv/4)) — 하한 1 은 콤보 스택 하한이 만드는 자연 바닥이다.
  let warmthOffset = false;
  if (nu6 >= 1 && state.comboTimer > 0) {
    const stopStacks = Math.max(1, 12 - Math.floor(nu6 / 4));
    warmthOffset = state.combo >= stopStacks || state.tick % 2 === 0;
  }

  // ── NU8 이주 본능 — 이탈 임계 480 을 넘은 병아리가 플레이어 쪽으로 걷는다.
  //    걸음 속도는 **`playerSpeed` 파생**(60 + 1×Lv)% 다 — 절대치로 적으면 이속 파워업·감속과
  //    괴리된다. 상시 추월 불가(100% 미만)가 공식에 내장돼 있다. 틱당 변위로 1회 정수 확정.
  const walkStep =
    nu8 >= 1
      ? Math.round((state.config.playerSpeed * DT * (6000 + 100 * nu8)) / 10000)
      : 0;
  const LEAVE_DIST = 480;
  const leave2 = LEAVE_DIST * LEAVE_DIST;

  if (!warmthOffset && walkStep <= 0) return;

  for (const e of state.entities) {
    if (!isChick(e)) continue;

    // NU6 상쇄 — 만료 직전(life === 0)은 건드리지 않는다(부활 금지). 초기 수명도 넘지 않는다.
    if (warmthOffset && e.life > 0 && e.life < TURRET_LIFE_TICKS) e.life++;

    // NU8 추종 — 벽 슬라이드는 하지 않는다(아래 경고). 좌표 직접 변위(넉백 규율 7.1과 동형).
    if (walkStep > 0) {
      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= leave2 || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const step = walkStep < d ? walkStep : d;
      e.x += (dx / d) * step;
      e.y += (dy / d) * step;
    }
  }
}

// ---------------------------------------------------------------------------
// 앵커 ⑩ — 적성 표적이 아군탄에 맞아 피해가 확정된 직후
// ---------------------------------------------------------------------------

/**
 * **SH5 경계 지저귐** — 병아리의 탄이 명중한 적에게 냉기 감속을 건다.
 *
 * 탄 출처 식별은 `source.ownerId === BROOD_MARK` 다 — 스탬프 지점은 `fireTurretShot` **한
 * 곳뿐**이고 이미 배선돼 있다(`world.ts:3563`). 여기서 다시 찍지 않는다.
 *
 * ## 앵커 ⑩ 이 병아리 탄을 실제로 데려오는가 — **온다**
 * 이 앵커는 `resolveCollisions` 의 **아군탄 명중 해소 루프**에 있고, 병아리 탄은
 * `spawnBullet` 이 만든 평범한 아군탄이다(`fireTurretShot`). 별도 경로가 없으므로 병아리
 * 명중은 전부 여기로 온다. (반대로 DoT·전격·액티브 폭발·폭탄 기물은 leaf 라 안 온다 —
 * SH5 는 탄 명중만 보는 스킬이라 그 한계에 걸리지 않는다.)
 *
 * ⚠️ **강도는 고정, 지속만 늘린다**(`status.ts` 계약 — `COLD_SLOW_MULT` 는 상수 하나).
 * `applySlow` 는 `max` 갱신이라 고연사 병아리가 매 명중마다 창을 촘촘히 되감는다.
 *
 * 게이트가 `kind === 'enemy'` 인 것은 냉기의 기존 적용 범위 그대로다 — 설계 ④ 표의
 * "guardian·defenseBoss 는 기존 냉기 적용 규칙 그대로(신규 우회 없음)" 를 좁은 쪽으로
 * 해석했다. 넓히려면 냉기 자체의 적용 범위를 먼저 확정해야 하고 그건 이 레인 밖이다.
 */
export function hatchlingEnemyDamaged(
  state: WorldState,
  target: Entity,
  source: Entity | undefined,
): void {
  const sh5 = lv(state, Sk.alarmChirp);
  if (sh5 < 1) return;
  if (source === undefined || source.ownerId !== BROOD_MARK) return;
  if (target.kind !== 'enemy' || target.dead) return;
  applySlow(target, COLD_DURATION + 6 * sh5);
}

// ---------------------------------------------------------------------------
// 앵커 ㉓ — `stepHatchBrood` 최상단(두 조기 반환보다 앞)
// ---------------------------------------------------------------------------

/**
 * **BD1 조기 부화 · SH10 확장 둥지 · NU10 알 저금 · BD2 쌍둥이 부화.**
 *
 * ## 적용 순서가 곧 계약이다
 * `SH10 페널티(+) → BD1 감산(하한 6) → NU10 선납(−)` 이다. BD1 의 `max(6, …)` 바닥은
 * **BD1 자신의 것**이라(설계 BD1 이 `max(6, hatchThreshold(k) − …)` 로 명시) SH10 페널티를
 * 먼저 얹고 그 위에서 깎는다 — 순서를 뒤집으면 SH10 페널티가 바닥을 뚫고 들어와 "큰 둥지가
 * 더 싸진다"는 반대 거동이 된다. NU10 선납은 바닥 밖이다(설계가 `min(저금, 임계−1)` 로
 * 자체 하한 1 을 갖는다 — 전액 선납 = 즉시 재출격 루프 차단).
 *
 * ⚠️ 앵커 doc 의 경고대로 **`threshold` 에는 엔진 쪽 클램프가 없다** — 하한 6 은 이 훅이
 * 스스로 건다.
 *
 * ## `willLaunch` 는 world 의 두 조기 반환을 **글자 그대로 미러**한 것이다
 * BD2 의 사건 카운터와 NU10 의 선납 차감은 *"이번 틱에 실제로 출격이 나는가"* 를 알아야
 * 하는데, 앵커 ㉓ 은 그 판정보다 앞이다. 그래서 같은 두 술어를 여기서 다시 세운다:
 * `pending >= threshold`(`world.ts` 의 임계 반환) · `live < maxDrones`(상한 반환). 그 둘이
 * 이 훅이 방금 확정한 값과 **같은 값**을 보므로 판정이 일치한다.
 * ⚠️ **world 의 두 반환문을 고치면 이 미러도 같이 고쳐야 한다.** 앵커 ㉔ 에서 사후 처리하는
 * 대안은 안 된다 — ㉔ 은 **기당** 1회라 쌍둥이 틱에 두 번 불리고, 사건 카운터·선납 차감은
 * 사건당 1회여야 한다(㉔ doc 의 「호출 횟수」).
 *
 * `live` 스캔은 BD2·NU10 중 하나라도 투자했을 때만 돈다 — 앵커 doc 이 경고한 "상시 비용"을
 * 미투자 런에 지우지 않기 위해서다.
 */
export function hatchlingBroodLaunchParams(
  state: WorldState,
  player: Entity,
  params: BroodParams,
): void {
  // ── SH10 확장 둥지 — 상한 +1 / 요구치 페널티 max(0, 6 − floor(Lv/4)).
  //    상한은 반드시 공용 헬퍼를 통한다(SH3 만석 술어와 한 몸 — 그 함수 주석이 근거).
  params.maxDrones = broodMaxDrones(state);
  const sh10 = lv(state, Sk.expandedNest);
  if (sh10 >= 1) {
    const penalty = 6 - Math.floor(sh10 / 4);
    if (penalty > 0) params.threshold += penalty;
  }

  // ── BD1 조기 부화 — 요구치 −(1 + floor(Lv/5)), **하한 6**(기본항 12 의 절반).
  const bd1 = lv(state, Sk.earlyHatch);
  if (bd1 >= 1) {
    const t = params.threshold - (1 + Math.floor(bd1 / 5));
    params.threshold = t > 6 ? t : 6;
  }

  const bd2 = lv(state, Sk.twinHatch);
  const nu10 = lv(state, Sk.eggBank);
  if (bd2 < 1 && nu10 < 1) return;

  // ── NU10 알 저금 — 선납은 **임계를 낮추는 형태**다(앵커 doc: `aux0` 을 만지지 마라).
  let bank = readSlot(state.skillStage, HatchlingStage.eggBank);
  let prepay = 0;
  if (nu10 >= 1 && bank > 0) {
    const room = params.threshold - 1;
    prepay = bank < room ? bank : room;
    if (prepay < 0) prepay = 0;
    params.threshold -= prepay;
  }

  const live = countChicks(state);
  const pending = state.kills - player.aux0;
  const willLaunch = pending >= params.threshold && live < params.maxDrones;

  if (nu10 >= 1) {
    const kills = Math.trunc(state.kills);
    const seen = readSlot(state.skillStage, HatchlingStage.eggBankKillsSeen);
    if (willLaunch) {
      bank -= prepay; // 선납분만 차감 — 잔액은 다음 출격으로 이어진다(2R R5 택일).
    } else if (live >= params.maxDrones && pending >= params.threshold) {
      // 만석 보류 중 — 이 틱에 늘어난 처치를 적립한다. 상한 = round(8 + 40×Lv/(Lv+16)).
      const gained = kills - seen;
      if (gained > 0) {
        const cap = Math.round(8 + (40 * nu10) / (nu10 + 16));
        bank += gained;
        if (bank > cap) bank = cap;
      }
    }
    writeSlot(state.skillStage, HatchlingStage.eggBank, bank);
    writeSlot(state.skillStage, HatchlingStage.eggBankKillsSeen, kills);
  }

  // ── BD2 쌍둥이 부화 — N번째 **사건**마다 2기. N = 2 + round(18/(Lv+2)) (Lv1 = 8, Lv20 = 3).
  //    상한·보류 규율은 world 루프가 이미 지킨다(자리가 1칸이면 1기만 나가고 보류 유지).
  if (bd2 >= 1 && willLaunch) {
    const n = 2 + Math.round(18 / (bd2 + 2));
    const count = readSlot(state.skillStage, HatchlingStage.twinLaunchCount) + 1;
    writeSlot(state.skillStage, HatchlingStage.twinLaunchCount, count);
    if (count % n === 0) params.launchCount = 2;
  }
}

// ---------------------------------------------------------------------------
// 앵커 ㉔ — 병아리 1기가 태어난 직후(기당 1회)
// ---------------------------------------------------------------------------

/**
 * 고정 오프셋 8방향(반지름 30 의 정팔각 근사 — 정수 리터럴이라 삼각함수·난수 0).
 * NU2 의 젬 수는 최대 `2 + floor(Lv/5)` 인데 어픽스가 레벨을 더 올릴 수 있어 `% 8` 로 감는다.
 */
const NU2_GEM_OX = [30, -30, 0, 0, 21, -21, 21, -21] as const;
const NU2_GEM_OY = [0, 0, 30, -30, 21, 21, -21, -21] as const;

/**
 * NU2 알껍질 젬 1개당 XP.
 *
 * ⚠️ **설계와 코드가 갈리는 지점이다 — 문서를 고치지 않고 여기 적는다.** 설계 NU2 는
 * "개당 XP = 젬 기본값의 50% 고정" 이라 하지만 이 리포에 *"젬 기본값"* 이라는 단일 정본이
 * **없다**: 젬 XP 는 적별 `xpValue` 다(`data/enemies.ts` 잡몹 3~5, 정예 24~28,
 * `world.ts` 의 폴백 1, `SUPPLY_GEM_XP` 6, `DESTRUCTIBLE_GEM_XP` 5). 여기서는 가장 흔한
 * 기준인 **기본 잡몹 젬(3~4)의 50%** 를 정수로 확정해 2 로 둔다. 이 확정은 레인 보고서에
 * 올렸다 — 설계가 다른 기준을 뜻했다면 이 상수 하나만 고치면 된다.
 */
const NU2_SHELL_GEM_XP = 2;

/**
 * **NU7 원정 부화 · BD6 부화 충격파 · NU2 알껍질 영양 · BD10 여왕 사출(수명 축).**
 *
 * ## BD10 수명 가산이 왜 여기인가
 * `chick.life` 는 `activateTurret` 이 방금 `TURRET_LIFE_TICKS` 로 세운 값이고, 이 앵커가
 * 그것을 고칠 수 있는 **유일한 지점**이다(앵커 ㉓ 시점엔 개체가 없고, 다음 틱부터는
 * `stepTurrets` 가 이미 깎기 시작한다). 좌표와 무관하므로 NU7 보다 앞에 둔다.
 *
 * ## 순서가 곧 설계다 — NU7 이 **먼저**다
 * 설계 NU7 의 「출격 좌표 상호작용 절」이 *"NU7 투자 시 BD6·NU2 의 발생지가 전부 원격 젬
 * 좌표로 이전된다"* 고 확정했다. 그래서 좌표를 먼저 옮기고, 그 뒤 둘이 `chick.x`/`chick.y`
 * 를 읽는다. 순서를 뒤집으면 폭발·젬만 플레이어 곁에 남아 설계와 갈린다.
 * (SH6 모선 무적만은 좌표 무관이라 이전되지 않는다 — 그쪽은 앵커 ⑨ 에 그대로 있다.)
 *
 * ## RNG 미소비
 * `blastDamage`·`clearEnemyBullets`·`spawnGem`·`slideCircleWalls` 는 어느 것도 난수를
 * 뽑지 않는다(각 함수 본문 확인). 최근접 젬 탐색도 거리 제곱 비교 + 엔티티 배열 순서
 * tie-break 이고 젬 오프셋은 고정 표라, 이 훅 전체가 RNG 0 이다 — 앵커 doc 의 계약 준수.
 */
export function hatchlingBroodLaunched(state: WorldState, player: Entity, chick: Entity): void {
  // ── BD10 여왕 사출(수명 축) — 결손 1기당 수명 +(60 + 10×Lv) 틱.
  //    ⚠️ `chick.life` 를 `stepTurrets` 가 삼키지 않는다: 그 루프는 `if (life > 0) life--`
  //    뒤 `life === 0` 이면 죽이는 **순수 감산**이라 상한·클램프가 없다(그 함수 본문 확인).
  //    이 항을 지우면 수명 단언이 실제로 빨개진다(뮤테이션 확인 — W2 레인 보고서).
  const bd10 = lv(state, Sk.matriarchLaunch);
  if (bd10 >= 1) {
    const deficit = broodDeficit(state);
    if (deficit > 0) chick.life += deficit * (60 + 10 * bd10);
  }

  // ── NU7 원정 부화 — 허용 거리(400 + 40×Lv) 안의 **최근접 젬** 좌표에서 부화한다.
  //    젬이 없거나 전부 거리 밖이면 아무것도 하지 않는다 = world 의 기본 4방향 폴백.
  const nu7 = lv(state, Sk.expeditionHatch);
  if (nu7 >= 1) {
    const maxDist = 400 + 40 * nu7;
    const max2 = maxDist * maxDist;
    let bestX = 0;
    let bestY = 0;
    let best2 = 0;
    let found = false;
    for (const e of state.entities) {
      if (e.dead || e.kind !== 'gem') continue;
      const dx = e.x - player.x;
      const dy = e.y - player.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > max2) continue;
      // 동률은 **엔티티 배열 순서**로 앞선 것이 이긴다(`homeMissile` 선례와 같은 tie-break).
      if (!found || d2 < best2) {
        found = true;
        best2 = d2;
        bestX = e.x;
        bestY = e.y;
      }
    }
    if (found) {
      // 젬 좌표가 벽 내부·경계일 수 있으므로 1회 밀어낸다(설계 구현란 명시).
      const slid = slideCircleWalls(bestX, bestY, chick.radius, state.activeWalls);
      chick.x = slid.x;
      chick.y = slid.y;
    }
  }

  // ── BD6 부화 충격파 — 출격 좌표 기준 반경 폭발 + 적탄 소거.
  //    두 헬퍼의 두 번째 인자는 **좌표 출처**일 뿐이다(본문이 `.x`/`.y` 만 읽는다) — 병아리를
  //    넘겨 발생지를 출격 좌표로 만든다. 병아리는 `enemy`/`boss` 가 아니라 자해가 없다.
  const bd6 = lv(state, Sk.hatchShockwave);
  if (bd6 >= 1) {
    const radius = 110 + 9 * bd6;
    blastDamage(state, chick, radius, 12 + 3 * bd6);
    clearEnemyBullets(state, chick, radius);
  }

  // ── NU2 알껍질 영양 — 출격 좌표에 소형 XP 젬 `2 + floor(Lv/5)` 개(고정 오프셋).
  const nu2 = lv(state, Sk.eggshellNutrients);
  if (nu2 >= 1) {
    const count = 2 + Math.floor(nu2 / 5);
    for (let i = 0; i < count; i++) {
      const k = i % 8;
      spawnGem(
        state,
        chick.x + (NU2_GEM_OX[k] ?? 0),
        chick.y + (NU2_GEM_OY[k] ?? 0),
        NU2_SHELL_GEM_XP,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 앵커 ㉖ — 포탑탄 1발의 파라미터가 정해지는 지점(`fireTurretShot`)
// ---------------------------------------------------------------------------

/**
 * **BD10 여왕 사출(탄 피해 축)** — 결손 1기당 피해 `+30% + 3%p/Lv`.
 *
 * ## ⚠️ 포탑은 해츨링 전용이 아니다 — 게이트가 **두 겹**이다
 * `stepTurrets` 는 병아리(`BROOD_MARK`)뿐 아니라 **액티브 센트리·자율 드론 베이
 * (`DRONE_MARK`)** 도 태운다(`world.ts` 의 `SUB_TYPE_SENTRY` 분기 · `droneBay`). 앵커는
 * 셋 모두에서 불리므로 여기서 **`turret.ownerId === BROOD_MARK` 를 반드시 본다** — 이
 * 한 줄을 지우면 해츨링 런의 센트리·드론 탄까지 정예화돼 다른 소환물의 거동이 갈린다.
 * 바깥 게이트(기체 = 해츨링)는 `skillHooks.ts` 의 `case SIG_HATCHLING_BROOD:` 가 이미 걸었다.
 *
 * ## ⚠️ 이 개입은 삼켜지지 않는다 — 소비 지점을 짚어 확인했다
 * `params.damage` 는 `spawnBullet` 이 `b.damage` 에 **그대로** 싣고(산술 0), 명중 지점
 * (`resolveCollisions`)은 `dealt = b.damage * mult * gyroAmp * prismAmp * …` 뒤
 * `t.hp -= dealt` 다. **`min`·`clamp`·`max` 가 경로에 하나도 없다.** 앵커 ⑰ 이 `min(d,s)`
 * 때문에 원리적으로 무효였던 전례가 있어 칸을 열기 전에 이 경로를 따라갔다.
 * (실드 흡수 분기는 `kind === 'core'` 전용이라 PvE 적에는 안 닿는다.)
 *
 * ## RNG 미소비
 * 곱셈 하나뿐이다 — `fireTurretShot` 의 RNG 미소비 계약(그 함수 doc)을 지킨다.
 */
export function hatchlingTurretShotParams(
  state: WorldState,
  turret: Entity,
  params: TurretShotParams,
): void {
  // 병아리 탄만 정예화한다(센트리·드론 베이 회귀 방지 — 위 doc).
  if (turret.ownerId !== BROOD_MARK) return;
  const bd10 = lv(state, Sk.matriarchLaunch);
  if (bd10 < 1) return;
  const deficit = broodDeficit(state);
  if (deficit <= 0) return; // SH10 동시 투자로 결손을 되산 런 — 설계상 강화 0.
  params.damage *= 1 + deficit * (0.3 + 0.03 * bd10);
}
