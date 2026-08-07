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
 * ## ⚠️ 배선 현황 — **30종 중 29종**
 * (배치 5 의 9종 + W레인 7종 + W2 레인의 BD10 + S3-해츨링 레인의 8종 +
 * **배치7(2026-08-07) 의 BD4·NU3·SH4·SH8 4종**)
 *
 * ## ✅ 배치7 이 얹은 4종과 그 자리 — 아래 「아직 미배선인 4종」이 이 넷이었다
 * 배치7 F1/F2a/F2b 가 새 앵커 다섯(`onAutoAimTarget`·`onTurretTargetPick`·
 * `onEnemyBulletMoved` 셋과 `TurretCadenceParams.suppressed` 필드 · 그 외 F1 정지 축)을 세워
 * 아래 4묶음이 "모델 부재"라 적은 선결을 전부 깔았다. 이 레인은 그 위에 leaf 만 얹었다.
 *  - **BD4 표적 공유** — {@link hatchlingAutoAimTarget}(기록) · {@link hatchlingTurretTargetPick}
 *    (우선순위) · {@link hatchlingTurretShotParams} 의 증폭 블록(명중 30틱 창). 셋 다
 *    {@link sharedTargetFor} 술어를 공유한다 — 자세한 근사·한계는 그 함수 doc.
 *  - **SH8 탄받이 깃털** — {@link hatchlingEnemyBulletMoved}(앵커 `onEnemyBulletMoved`). life
 *    는 반드시 1 에서 클램프한다(그 함수 doc — 0 을 건너뛰면 자연 만료 판정을 영영 못 만난다).
 *  - **SH4 품기 진형** — 사격 정지는 {@link hatchlingTurretCadence} 의 `suppressed` 블록
 *    (`state.activeBuff0/1` 직접 읽기, 아크캐스터 BR3 선례), 밀착은
 *    {@link hatchlingShelterSustain}(두 shelter 액티브의 SUSTAIN 훅에서 호출). ⚠️ 설계의
 *    "소거 반경" 수치를 **밀착 반경**으로 재해석했다(탄 소거는 이 배치에서 SH8 전용으로
 *    못 박혔다) — 설계-코드 괴리, {@link hatchlingShelterSustain} doc 에 정직 표기.
 *  - **NU3 업어 나르기** — {@link hatchlingPiggyback}(앵커 `onDashFired`, `dirX`/`dirY` 소비).
 *    도착 좌표는 "방향 × 이번 틱 대시 임펄스의 1차 변위"로 추정한다(물리량 기반 근사 —
 *    임의 상수가 아니다). 자세한 사유는 그 함수 doc.
 *
 * ## ✅ S3-해츨링(2026-08-07)이 얹은 8종과 그 자리
 * 앵커 **㉗ `onTurretCadence`**(포탑 리듬) · **㉘ `onTurretExpired`**(자연 만료) 둘을 새로
 * 세우고, 앵커 **④ `onPlayerDamaged`** 에 선택 인자 `srcX`/`srcY` 를 더했다.
 *  - **BD3 · NU9** — 앵커 ㉘ + {@link killChick}. 소멸 경로 **셋 전부**에서 돈다(아래 3묶음
 *    이 "반쪽이라 안 넣는다" 고 적은 조건이 여기서 해소됐다).
 *  - **SH9** — 앵커 ㉘, 자연 만료 전용(`aux1 === 0` 이 그 사유 코드의 **첫 독자**다).
 *  - **BD9 · NU4(연사 창)** — 앵커 ㉗.
 *  - **BD7** — 앵커 ㉖ 에 개체 누적(`t.aux0`)으로 얹었다.
 *  - **BD8 · NU4(재배치)** — 액티브 핸들러. `stepActives` 가 `stepTurrets` 보다 앞이라
 *    `cooldown = 0` 만으로 같은 틱 격발이 된다(`fireTurretShot` export 불필요 — 모듈 순환 회피).
 *  - **SH2** — 앵커 ④ 의 새 좌표 두 칸.
 *
 * ## 배치5 가 **NU1** 을 더했다 — 앵커 ㉘ `onGemMagnetParams` 의 `broodRadius` **첫 소비처**다
 * 그 필드는 배치4 가 칸만 열어 두고 `stepGems` 가 읽지도 않던 자리였다. 이 레인이 `stepGems`
 * 에 병아리 중심 추가 흡인 경로를 세워 소비처를 만들었다({@link hatchlingGemMagnetParams}).
 *
 * ## ⚠️ (배치6 시점 기록 — 배치7 이 넷 전부를 해소했다) 당시 미배선 4종과 사유
 * ✅ **배치7(2026-08-07)이 새 앵커 셋 + `suppressed` 필드로 아래 넷을 전부 열었다** — 위
 * 「배치7 이 얹은 4종」절이 실제 배선 지점이다. 아래 문단은 *왜 그때는 앵커가 아니라 모델
 * 부재였는가*의 기록으로 남긴다(그 판단은 배치7 이전 시점 기준으로 지금도 참이다).
 * **배치6(2026-08-07)이 넷 전부를 grep 으로 재확인했고 판정은 그대로다.** 배치6 이 연 앵커
 * 다섯(`onActiveExpired`·`onFilmBurstPost`·`onGemPull`·`onPickupRadius`·`onPlayerWallSlide`)과
 * 앵커 ②·④ 의 새 인자는 아래 넷 중 **어느 것도 건드리지 않는다** — 사유가 앵커 부재가 아니라
 * *모델 부재*이기 때문이다.
 *  - **NU3** — 대시 **도착 좌표가 존재하지 않는다**(`world.ts` 의 대시는 속도 임펄스만 싣는다).
 *    앵커로 안 풀리고 대시 모델이 경로 종점을 산출해야 한다.
 *    ⚠️ **배치6 이 앵커 ②(`onDashFired`)에 대시 방향 `dirX`/`dirY` 를 더했지만 이 스킬은 여전히
 *    안 열린다.** 재확인(world.ts 2270-2302): 발동 블록은 `player.vx += dx * config.dashSpeed`
 *    **하나**이고, 좌표 적분(`player.x += player.vx * DT`)과 벽 되밀기(`slideCircleWalls`)는
 *    **이 앵커보다 뒤**다. 방향은 종점이 아니다 — 종점을 여기서 추정하면 벽이 먹은 변위만큼
 *    조용히 틀린 자리에 병아리를 내려놓는다(앵커 `onFilmBurstPost` 가 "전 좌표를 따로 나른다"
 *    고 적은 그 함정과 같은 형태다). 도착 좌표를 넘기는 앵커는 **적분 뒤**에 서야 한다.
 *  - **SH8** — 적탄↔병아리 충돌 경로가 코드에 **0건**이다. 배치6 재확인: `collision.ts` ·
 *    `bullets.ts` 에 `enemyBullet` 대상 판정 **0건**(`bullets.ts` 의 3건은 전부 주석)이고,
 *    `kind === 'enemyBullet'` 의 실충돌 소비처는 `world.ts` 의 **플레이어 접촉 루프 한 곳**
 *    (4547)뿐이며 `isActiveTurret` 전수 grep(9건)에도 탄 충돌 경로가 없다. 앵커가 아니라 새
 *    충돌 루프 신설이고, **그 신설은 이 레인의 범위 밖이다.**
 *  - **SH4** — 위 SH8 과 같은 벽이 반대급부("적탄을 몸으로 막는다")를 막는다. 대가
 *    ("사격 정지")만 넣으면 **순손해 스킬**이라 넣지 않았다(BD10 이 탄 피해 축 없이 상한만
 *    깎였을 때와 같은 형태 — 그때도 통째로 미배선이 정답이었다).
 *  - **BD4** — 「플레이어의 자동 조준 표적」이 `world.ts` 의 볼리 경로 **지역 변수**이고
 *    어디에도 저장되지 않는다. leaf 훅이 그것을 주려면 ①`nearestTarget`(LOS 레이 + 목표
 *    가중치)을 통째로 옮겨 적거나 ②`WorldState` 에 표적 이월 칸을 신설해야 하는데, ①은 이
 *    저장소의 대표 결함(같은 술어 두 곳)이고 ②는 앵커가 아니라 **모델 변경**이다. 증폭 축이
 *    앵커 ⑩ 이 아니라 ㉖ 이어야 하는 것은 맞다(⑩ 은 `hp` 차감·격추 판정 **뒤**라 증폭분이
 *    격추로 이어지지 못한다) — 다만 그 ㉖ 에 `target` 을 실으려면 위 둘 중 하나가 먼저다.
 *    ⚠️ **배치6 이 ㉖ 을 다시 읽고 자리가 아님을 확인했다.** 두 가지가 각각 막는다:
 *    ①「우선 **공격**」(표적 결정)은 ㉖ 이 *표적 확정 **뒤*** 라 원리적으로 늦다 —
 *    `fireTurretShot` 이 `nearestTarget(state, t, TURRET_RANGE)` 로 이미 골랐다.
 *    ②「그 표적에 대한 증폭」은 `onTurretShotParams(state, turret, params)` 가 **표적을 아예
 *    안 넘긴다** — `params` 는 `damage` 한 칸뿐이다. 칸을 더해도 비교 대상인 *플레이어의*
 *    표적이 없어(`world.ts` 3038 의 지역 변수) 술어가 성립하지 않는다. 위 ②(모델 변경)가
 *    여전히 선결이다.
 *
 * ## ⚠️ (배치 5 시점 기록) 30종 중 17종
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
import type {
  BroodParams,
  TurretShotParams,
  TurretCadenceParams,
  GemMagnetParams,
  TurretTargetPick,
} from '../skillHooks.js';
import { isActiveTurret, TURRET_LIFE_TICKS, TURRET_RANGE } from '../events.js';
import { blastDamage, clearEnemyBullets, fanStrike } from '../activeTypes.js';
import { spawnBreakableWall, spawnEventObject, spawnGem } from '../entities.js';
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
  /** BD3 작별 격발 */ farewellVolley = 2,
  /** BD4 표적 공유 */ targetShare = 3,
  /** BD5 격발 공명 */ volleyResonance = 4,
  /** BD6 부화 충격파 */ hatchShockwave = 5,
  /** BD7 노병 병아리 */ veteranChick = 6,
  /** BD8 브루드 강습 */ broodAssault = 7,
  /** BD9 과밀 본능 */ overcrowdInstinct = 8,
  /** BD10 여왕 사출 */ matriarchLaunch = 9,
  /** NU1 모이 물어오기 */ gemFetch = 10,
  /** NU2 알껍질 영양 */ eggshellNutrients = 11,
  /** NU3 업어 나르기 */ piggyback = 12,
  /** NU4 둥지 소집 */ nestRecall = 13,
  /** NU5 알 굴리기 */ eggRoll = 14,
  /** NU6 온기 나눔 */ sharedWarmth = 15,
  /** NU7 원정 부화 */ expeditionHatch = 16,
  /** NU8 이주 본능 */ migrationInstinct = 17,
  /** NU9 둥지 표식 */ nestBeacon = 18,
  /** NU10 알 저금 */ eggBank = 19,
  /** SH1 호위 희생 */ escortSacrifice = 20,
  /** SH2 위기 산개 */ crisisScatter = 21,
  /** SH3 만석 둥지 온기 */ fullNestWarmth = 22,
  /** SH4 품기 진형 */ broodingFormation = 23,
  /** SH5 경계 지저귐 */ alarmChirp = 24,
  /** SH6 알막 */ eggMembrane = 25,
  /** SH7 회생 부화 */ rebirthHatch = 26,
  /** SH8 탄받이 깃털 */ featherBulwark = 27,
  /** SH9 이소 둥지 */ fledgeNest = 28,
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
// 앵커 `onAutoAimTarget` (배치7 F2b) — 자동조준이 이번 틱 표적을 확정한 직후
// ---------------------------------------------------------------------------

/**
 * **BD4 표적 공유(기록 절반)** — 플레이어 자동조준이 이번 틱 확정한 표적을
 * {@link HatchlingStage.shareTargetId} 에 적는다(+1 인코딩 — 그 슬롯 doc 이 정본).
 *
 * ## 세 조각이 한 벌이다
 * ①이 함수가 "누가 표적인가"를 적고, ②{@link hatchlingTurretTargetPick}(앵커
 * `onTurretTargetPick`)가 병아리를 그 표적에 우선 겨누고, ③{@link hatchlingTurretShotParams}
 * (앵커 ㉖)가 명중 증폭을 싣는다. 셋 다 같은 {@link sharedTargetFor} 술어를 공유한다.
 *
 * 매 틱 다시 적는다 — "지금 조준 중"이라는 뜻이라 표적이 바뀌면 그대로 따라간다. 이전 표적이
 * 아직 살아 있어도 새 표적으로 덮어쓴다(자동조준 자체가 "현재" 표적만 안다).
 */
export function hatchlingAutoAimTarget(state: WorldState, player: Entity, target: Entity): void {
  void player;
  const bd4 = lv(state, Sk.targetShare);
  if (bd4 < 1) return;
  writeSlot(state.skillStage, HatchlingStage.shareTargetId, target.id + 1);
}

/**
 * **BD4 공유 표적 조회** — {@link HatchlingStage.shareTargetId} 를 디코드해, 그 개체가 아직
 * 살아 있고 **이 포탑 기준** 사거리(`TURRET_RANGE`) 안이면 돌려준다. 그렇지 않으면
 * `undefined`(표적 없음과 같은 취급 — 호출부가 기존 경로로 폴백한다).
 *
 * ## 두 훅이 이 함수를 각자 부른다 — 값을 옮기는 채널이 없다
 * `onTurretTargetPick` 은 `(state, turret, pick)` 만 받고 `onTurretShotParams` 는
 * `(state, turret, params)` 만 받는다 — 어느 쪽도 상대가 방금 무엇을 판정했는지 모른다.
 * `world.ts` 를 건드려 값을 실어 나르는 칸을 새로 뚫을 수 없으므로(소유권 밖), 앵커 ㉓ 의
 * `willLaunch` 미러(그 함수 doc)와 같은 사유로 **같은 술어를 두 지점에서 각자 계산**한다 —
 * 둘 다 이 함수 하나만 부르므로 두 곳에 따로 적는 함정(이 파일이 반복 경계하는 그것)은 없다.
 *
 * ## ⚠️ 알려진 근사 — `isPlayerTargetable` 의 코어 실드 예외는 재현하지 않는다
 * `world.ts` 의 `fireTurretShot` 폴백은 `dead` 와 `isPlayerTargetable`(비공개 — 발생기 보호막
 * 국면의 코어를 조준에서 뺀다) 둘 다 본다. 이 함수는 `dead`·사거리만 본다 — `isPlayerTargetable`
 * 은 `world.ts` 비공개라 leaf 가 복제하면 "같은 술어 두 곳" 함정이 재현된다. 갭은 좁다:
 * 오직 *"공유 표적이 하필 그 순간 발생기 보호막 국면의 코어"* 일 때만 이 함수가 `true` 를
 * 돌려주고 `world.ts` 는 그 지정을 버린다 — 표적 픽(BD4 우선순위 절반)만 헛돌고, 증폭 여부는
 * 그 폴백을 다시 타지 않으므로(아래 참조) 실제 명중 없이 증폭이 계산되는 사고는 없다.
 */
function sharedTargetFor(state: WorldState, turret: Entity): Entity | undefined {
  const raw = readSlot(state.skillStage, HatchlingStage.shareTargetId);
  if (raw === 0) return undefined;
  const id = raw - 1;
  for (const e of state.entities) {
    if (e.id !== id) continue;
    if (e.dead) return undefined;
    const dx = e.x - turret.x;
    const dy = e.y - turret.y;
    if (dx * dx + dy * dy > TURRET_RANGE * TURRET_RANGE) return undefined;
    return e;
  }
  return undefined;
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
 *
 * ## NU3 업어 나르기 — **같은 앵커, `dirX`/`dirY` 가 선결이다**
 * 배치6 이 이 앵커에 대시 방향(단위 벡터)을 더했다. NU3 은 그 값을 받아 아래에서 처리한다
 * (자세한 설계-공학 노트는 {@link hatchlingPiggyback} doc).
 */
export function hatchlingDashFired(
  state: WorldState,
  player: Entity,
  dirX?: number,
  dirY?: number,
): void {
  const nu5 = lv(state, Sk.eggRoll);
  if (nu5 >= 1) {
    const next = Math.trunc(player.aux0) - 1;
    player.aux0 = next > 0 ? next : 0;
  }
  hatchlingPiggyback(state, player, dirX, dirY);
}

/**
 * **NU3 업어 나르기** — 대시 경로 위 병아리를 업어서 대시 도착 지점 주위로 함께 옮긴다.
 *
 * ## ⚠️ 「도착 지점」은 존재하지 않는다 — **방향 × 고정 거리**로 산출한다
 * 대시는 임펄스형이다(`world.ts` 의 `player.vx += dx * config.dashSpeed`) — 이 앵커가 도는
 * 시점(대시 발동 블록 안, 위치 적분 **전**)엔 `player.x`/`y` 가 아직 대시 이전 좌표다. 실제
 * 도착 좌표는 벽 슬라이드까지 섞인 미래값이라 leaf 가 정확히 재현할 수 없다(설계 NU3 구현란
 * 「도착 지점 고정」이 요구하는 바로 그 타협). 그래서 **이번 틱 대시 임펄스가 만드는 1차
 * 변위**(`config.dashSpeed * DT` — 벽이 없다면 실제로 이만큼 움직인다)를 고정 거리로 삼는다.
 * 이 값은 임의 상수가 아니라 **이 틱에 실제로 실리는 물리량**이라 "왜 이 숫자인가"에 근거가
 * 있다(이 파일 BD3 의 "임의 방향 금지" 규율과 같은 정신).
 *
 * ## 업기 판정 — 대시 시작→가상 도착점 **선분** 기준 반폭
 * 반폭 = 90 + 8×Lv. 실제 이동 경로(벽에 막히면 더 짧다)와 가상 선분의 차이는 반폭 안에
 * 흡수되는 수준이다(NU4 재배치 반경 90과 같은 자릿수).
 *
 * ## 옮기는 자리 — NU4 재배치 팔각(재사용)
 * 새 오프셋 표를 만들지 않는다. NU4 가 이미 "플레이어(또는 도착 지점) 주위 8자리"를
 * 검증된 형태로 갖고 있고, 여기 필요한 것도 정확히 같은 모양(중심 주위 산개 슬롯)이다.
 *
 * ## RNG 미소비 · 신규 상태 0
 * 선분-점 거리 판정은 순수 산술이고, 슬롯 배정은 배열 순회 순서(tie-break)로 결정된다.
 */
function hatchlingPiggyback(
  state: WorldState,
  player: Entity,
  dirX: number | undefined,
  dirY: number | undefined,
): void {
  const nu3 = lv(state, Sk.piggyback);
  if (nu3 < 1) return;
  if (dirX === undefined || dirY === undefined) return;

  const travel = state.config.dashSpeed * DT;
  const ax = player.x + dirX * travel;
  const ay = player.y + dirY * travel;
  const halfWidth = 90 + 8 * nu3;
  const half2 = halfWidth * halfWidth;

  const abx = ax - player.x;
  const aby = ay - player.y;
  const ab2 = abx * abx + aby * aby;

  let i = 0;
  for (const e of state.entities) {
    if (!isChick(e)) continue;
    // 선분-점 최근접 거리(제곱) — t 를 [0,1] 로 clamp.
    let t = ab2 > 0 ? ((e.x - player.x) * abx + (e.y - player.y) * aby) / ab2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const cx = player.x + abx * t;
    const cy = player.y + aby * t;
    const dx = e.x - cx;
    const dy = e.y - cy;
    if (dx * dx + dy * dy > half2) continue;
    const k = i % 8;
    const slid = slideCircleWalls(
      ax + (NU4_RECALL_OX[k] ?? 0),
      ay + (NU4_RECALL_OY[k] ?? 0),
      e.radius,
      state.activeWalls,
    );
    e.x = slid.x;
    e.y = slid.y;
    i++;
  }
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
      killChick(state, victim);
      out -= sacrificeAbsorb(sh1);
      if (out < 0) out = 0;
    }
  }

  // ── SH7 회생 부화 — SH1 흡수 뒤에도 치사면 전원 소멸시키고 그 수에 비례한 HP 를 남긴다.
  //    술어는 "이 피해가 hp 를 0 이하로 만드는가" = `out >= player.hp` 다.
  const sh7 = lv(state, Sk.rebirthHatch);
  if (sh7 >= 1 && out > 0 && player.hp > 0 && out >= player.hp) {
    let n = 0;
    // ⚠️ `state.entities` 순회 중 {@link killChick} 이 `chickDespawned` 로 탄·표식을 배열
    //    말미에 append 한다. `for…of` 가 그 새 원소까지 보지만 `isChick` 이 거짓이라
    //    무연산이고(탄·magnetEmitter 는 활성 포탑이 아니다), 삭제·정렬은 하지 않는다.
    for (const e of state.entities) {
      if (!isChick(e)) continue;
      killChick(state, e);
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
 * `aux1 = 1`(사유 = 희생)은 설계 ②말미 「소멸 경로 전수 표」의 계약이다.
 * ✅ **2026-08-07(S3-해츨링)이 그 독자를 세웠다** — 앵커 ㉘ 의 {@link hatchlingTurretExpired}
 * 안 SH9 게이트가 `aux1 === 0`(자연 만료)을 읽는다. 아래 종전 문단은 *왜 독자보다 먼저
 * 썼는가* 의 기록으로 남긴다(그 판단이 옳았음을 이 레인이 확인했다).
 *
 * (배치 5 시점 기록) 지금 이 값을 읽는 쪽은 없다. 그럼에도 쓰는 이유는, 독자가 붙는 레인이
 * **자연 만료(0)와 희생(1)을 사후에 구분할 방법이 없기 때문**이다 — 소멸 시점에 안 남기면
 * 그 정보는 영영 복원되지 않는다. `turretPickup` 의 `aux1` 점유는 grep 0건이고(편대 인코딩은
 * `kind === 'enemy'` 한정) 이미 해시되는 필드라 레이아웃은 불변이다.
 *
 * ## ⚠️ 소멸 부수효과는 {@link chickDespawned} 한 곳이다
 * BD3·NU9 는 설계 ②말미 「소멸 경로 전수 표」가 **모든** 소멸 경로에서 발화할 것을 요구한다.
 * 병아리 소멸 경로는 셋(SH1 희생 · SH7 회생 · 자연 만료)이고, 앞 둘이 이 함수, 셋째가 앵커
 * ㉘ 이다. 두 곳이 **같은 헬퍼**를 부르므로 한쪽만 고쳐 반쪽이 되는 형태가 구조적으로 없다.
 *
 * ⚠️ **`phase` 를 건드리지 마라** — 병아리의 `phase` 는 미사용 필드가 아니라 **생사 스위치**다
 * (`isActiveTurret` · 스크롤 앵커 판정 · 렌더가 전부 `phase === 1` 을 읽는다).
 */
function killChick(state: WorldState, e: Entity): void {
  e.dead = true;
  e.aux1 = 1;
  chickDespawned(state, e);
}

// ---------------------------------------------------------------------------
// 소멸 부수효과 — **세 경로 공통**(SH1·SH7 = `killChick` · 자연 만료 = 앵커 ㉘)
// ---------------------------------------------------------------------------

/** NU9 표식의 접촉 트리거 반경. `chunks.ts` 의 `EVENT_TRIGGER_RADIUS`(=70) 지역 사본이다 —
 *  그 파일을 런타임 import 하면 지형 생성기가 스킬 leaf 에 딸려 들어온다(`BROOD_MAX_DRONES`
 *  와 같은 선례·같은 대가: 값이 바뀌면 두 곳을 함께 고쳐야 한다). */
const NU9_BEACON_RADIUS = 70;

/** SH9 둥지벽 반폭·반높이. 병아리 반경(44)보다 **작게** 둔다 — 크게 잡으면 출격 자리
 *  (플레이어 ±60)에 벽이 서서 스크롤 모드에서 플레이어를 가둘 수 있다. */
const SH9_NEST_WALL_HALF = 26;

/**
 * **BD3 작별 격발 · NU9 둥지 표식** — 병아리가 **어떤 사유로든** 소멸한 그 자리의 부수효과.
 *
 * ## ⚠️ 「전수」가 조건이라 여기 있다
 * 설계 ②말미 「소멸 경로 전수 표」는 이 둘이 세 경로 **전부**에서 돌 것을 요구한다. 배치 5 가
 * 두 스킬을 통째로 미배선으로 남긴 사유가 정확히 그것이었다("세 경로 중 둘만 돌면 반쪽이고
 * 그 반쪽이 곧 화면과 규칙이 갈린다"). 앵커 ㉘ 이 셋째를 열었으므로 이제 성립한다.
 *
 * ## RNG 미소비
 * `fanStrike`(고정 각도 계단) · `spawnEventObject`(순수 생성) 어느 것도 난수를 뽑지 않는다.
 * 조준 방향도 거리 제곱 비교 + 엔티티 배열 순서 tie-break 다(NU7 최근접 젬과 같은 규율).
 */
function chickDespawned(state: WorldState, chick: Entity): void {
  // ── BD3 작별 격발 — 최근접 적대 표적 쪽으로 부채꼴 한 벌.
  //    ⚠️ **표적이 없으면 쏘지 않는다.** 고정 방향으로 대신 쏘는 안을 버린 이유는, 그 방향이
  //    설계 근거가 없는 임의값이라 훗날 "왜 오른쪽인가" 를 아무도 답할 수 없기 때문이다.
  //    빈 방에서는 맞을 대상 자체가 없으므로 관측 손실도 없다.
  const bd3 = lv(state, Sk.farewellVolley);
  if (bd3 >= 1) {
    const dir = nearestHostileDir(state, chick);
    if (dir !== undefined) {
      // 탄 수 = 3 + floor(Lv/4), 발당 피해 = 6 + 2×Lv, 폭 50°.
      fanStrike(state, chick, 3 + Math.floor(bd3 / 4), 6 + 2 * bd3, 50, dir);
    }
  }

  // ── NU9 둥지 표식 — 그 자리에 자석 표식(`magnetEmitter`)을 남긴다. 소비처는 신설이 아니라
  //    **이미 있는 접촉 처리**다(`world.ts` 의 픽업 루프가 `triggerMagnetEmitter` 를 부른다) —
  //    그래서 이 스킬은 앵커 하나로 끝난다.
  //    ⚠️ 레벨은 **개수가 아니라 반경**에 실린다: 표식을 여러 개 겹쳐 두면 접촉 1회에 한 개만
  //    소비되고 나머지가 자리에 남아 "쌓이는 표식" 이 된다.
  const nu9 = lv(state, Sk.nestBeacon);
  if (nu9 >= 1) {
    spawnEventObject(state, 'magnetEmitter', chick.x, chick.y, NU9_BEACON_RADIUS + 4 * nu9);
  }
}

/**
 * 최근접 **적대 표적** 방향(정규화하지 않은 델타 — `fanStrike` 가 `atan2` 로만 읽는다).
 * 없으면 `undefined`.
 *
 * ⚠️ `world.ts` 의 `nearestTarget` 을 옮겨 적은 것이 **아니다** — 그쪽은 LOS 레이·목표
 * 오브젝트 가중치까지 보는 조준 정본이고, 여기 필요한 것은 "작별탄을 어느 쪽으로 뿌리는가"
 * 하나다. 두 술어가 같아야 할 이유가 없고, 같게 적으면 조준 정본이 바뀔 때마다 이 파일이
 * 조용히 갈린다. 동률은 **엔티티 배열 순서**로 앞선 것이 이긴다(NU7 과 같은 tie-break).
 */
function nearestHostileDir(state: WorldState, from: Entity): { x: number; y: number } | undefined {
  let bestDx = 0;
  let bestDy = 0;
  let best2 = 0;
  let found = false;
  for (const e of state.entities) {
    if (e.dead) continue;
    if (e.kind !== 'enemy' && e.kind !== 'boss' && e.kind !== 'guardian' && e.kind !== 'defenseBoss')
      continue;
    const dx = e.x - from.x;
    const dy = e.y - from.y;
    const d2 = dx * dx + dy * dy;
    if (d2 === 0) continue; // 완전 겹침은 방향이 없다(atan2(0,0) 은 0 으로 흘러 임의값이 된다).
    if (!found || d2 < best2) {
      found = true;
      best2 = d2;
      bestDx = dx;
      bestDy = dy;
    }
  }
  return found ? { x: bestDx, y: bestDy } : undefined;
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

  // ── NU4 둥지 소집(연사 창 감산) — 창을 세우는 곳은 액티브 핸들러이고 여기는 **시계**다.
  //    ⚠️ 이 자리(앵커 ⑨)여야 하는 이유: 감산을 앵커 ㉗(포탑 루프) 안에 두면 병아리 **기당**
  //    한 번씩 깎여 창 길이가 살아 있는 대수에 반비례한다. ⑨ 는 틱당 정확히 1회다.
  //    ⚠️ 아래 세 스킬의 조기 반환보다 **앞**이어야 한다 — 뒤에 두면 SH3·NU6·NU8 을 하나도
  //    안 찍은 런에서 창이 영영 안 닫혀 연사가 상시가 된다.
  const nu4 = lv(state, Sk.nestRecall);
  if (nu4 >= 1) {
    const left = readSlot(state.skillStage, HatchlingStage.nestRecallTicks);
    if (left > 0) writeSlot(state.skillStage, HatchlingStage.nestRecallTicks, left - 1);
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
  if (sh5 >= 1 && source !== undefined && source.ownerId === BROOD_MARK) {
    if (target.kind === 'enemy' && !target.dead) {
      applySlow(target, COLD_DURATION + 6 * sh5);
    }
  }

  // ── BD4 표적 공유(기록 절반) — **플레이어 자신의 탄**이 공유 표적에 명중한 틱을 적는다.
  //    "플레이어 탄" = 병아리 탄이 아닌 모든 아군탄(`source.ownerId !== BROOD_MARK`)이다 —
  //    설계 BD4 본문의 이분법이 "병아리 vs 그 외 전부"이기 때문이다(SH5 와 정확히 반대 게이트).
  //    `target.kind` 를 좁히지 않는다 — 설계 연계가 "엘리트·보스" 도 명시한다.
  const bd4 = lv(state, Sk.targetShare);
  if (bd4 >= 1 && source !== undefined && source.ownerId !== BROOD_MARK) {
    const shareTargetId = readSlot(state.skillStage, HatchlingStage.shareTargetId);
    if (shareTargetId !== 0 && target.id === shareTargetId - 1) {
      writeSlot(state.skillStage, HatchlingStage.shareHitTick, state.tick);
    }
  }
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
 * BD7 누적 강화의 **상한 발사 횟수**. 병아리 수명 600틱 ÷ 기본 쿨다운 10틱 = 최대 60발이라
 * 상한 40 은 *"수명 후반부는 만렙"* 이라는 뜻이다(무한 성장이 아니다). 상한을 두는 이유는
 * NU6(수명 감소 절반)·BD10(수명 가산)이 붙은 런에서 한 개체의 발사 수가 두 배 이상으로
 * 늘어나 곱이 발산하기 때문이다.
 */
const BD7_SHOT_CAP = 40;

/**
 * **BD10 여왕 사출(탄 피해 축) · BD7 노병 병아리(누적 강화 축).**
 *
 * ## BD7 이 왜 `t.aux0` 인가
 * *"그 병아리 **개체**의 탄이 점점 강해진다"* 라 카운터가 **개체당**이어야 한다. 개체 필드
 * 중 `phase`(생사 스위치) · `life`(수명) · `cooldown`(리듬)은 이미 임자가 있고, `aux1` 은
 * {@link killChick} 의 소멸 사유 코드다. 남은 칸이 `aux0` 하나이고, `turretPickup` 의 `aux0`
 * 점유는 `src/sim/**` grep 0건이다(해저드의 `aux0` 감속 틱은 `kind === 'hazard'` 한정).
 * ⚠️ **비음 정수만 넣어라** — `aux0` 은 `hashEntity` 의 u32 폴드 대상이라 소수를 넣으면
 * 소수부가 조용히 잘려 클라와 서버 재실행이 갈린다. 여기 담는 값은 발사 횟수(정수)다.
 *
 * ## BD10 여왕 사출 — 결손 1기당 피해 `+30% + 3%p/Lv`.
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

  // ── BD7 노병 병아리 — 이 개체의 **직전까지 발사 횟수**에 비례해 강해지고, 그 뒤 1 적립한다.
  //    첫 발은 배율 1(횟수 0)이라 종전 값 그대로다 — 순서를 뒤집어 먼저 적립하면 첫 발부터
  //    강해져 "거듭할수록" 이라는 설계 문면과 갈린다.
  const bd7 = lv(state, Sk.veteranChick);
  if (bd7 >= 1) {
    const shots = Math.trunc(turret.aux0);
    const n = shots < BD7_SHOT_CAP ? shots : BD7_SHOT_CAP;
    params.damage *= 1 + n * (0.02 + 0.002 * bd7);
    turret.aux0 = shots + 1;
  }

  // ── BD4 표적 공유(증폭 절반) — 이 병아리가 **지금** 공유 표적을 쏘고 있고(같은 술어를
  //    {@link hatchlingTurretTargetPick} 이 독립적으로 다시 계산한다 — {@link sharedTargetFor}
  //    doc 참조), 플레이어 탄이 그 표적에 명중한 지 30틱 이내면 이번 발이 증폭된다.
  //    `shareHitTick > 0` 은 "아직 명중 없음"(0) 을 걸러낸다 — 안 걸면 런 시작 수십 틱
  //    동안 명중이 없어도 `tick − 0 <= 30` 이 거짓양성으로 성립한다(슬롯 doc 의 캐비앗).
  const bd4 = lv(state, Sk.targetShare);
  if (bd4 >= 1) {
    const hitTick = readSlot(state.skillStage, HatchlingStage.shareHitTick);
    if (hitTick > 0 && state.tick - hitTick <= 30) {
      if (sharedTargetFor(state, turret) !== undefined) {
        params.damage *= 1 + (0.15 + 0.02 * bd4);
      }
    }
  }

  // ── BD10 여왕 사출(탄 피해 축).
  const bd10 = lv(state, Sk.matriarchLaunch);
  if (bd10 < 1) return;
  const deficit = broodDeficit(state);
  if (deficit <= 0) return; // SH10 동시 투자로 결손을 되산 런 — 설계상 강화 0.
  params.damage *= 1 + deficit * (0.3 + 0.03 * bd10);
}

// ---------------------------------------------------------------------------
// 앵커 `onTurretTargetPick` (배치7 F2b) — `nearestTarget` 을 부르기 앞
// ---------------------------------------------------------------------------

/**
 * **BD4 표적 공유(우선순위 절반)** — 공유 표적이 있고 사거리 안이면 그 표적을 지정한다.
 * 무효(죽음·사거리 밖·미존재)면 `pick.targetId` 를 손대지 않아 `fireTurretShot` 이 종전
 * `nearestTarget` 경로로 폴백한다(앵커 doc 의 규약).
 */
export function hatchlingTurretTargetPick(
  state: WorldState,
  turret: Entity,
  pick: TurretTargetPick,
): void {
  if (turret.ownerId !== BROOD_MARK) return;
  const bd4 = lv(state, Sk.targetShare);
  if (bd4 < 1) return;
  const target = sharedTargetFor(state, turret);
  if (target !== undefined) pick.targetId = target.id;
}

// ---------------------------------------------------------------------------
// 앵커 ㉗ — 포탑 1기의 이번 틱 사격 리듬(`stepTurrets`, 쿨다운 감산보다 앞)
// ---------------------------------------------------------------------------

/**
 * **BD9 과밀 본능 · NU4 둥지 소집(연사 창 축).**
 *
 * ## ⚠️ 게이트가 두 겹이다(㉖ 과 같은 규율)
 * 첫 줄의 `ownerId === BROOD_MARK` 를 지우면 해츨링 런의 **센트리·드론 베이 연사까지** 빨라져
 * 다른 소환물의 거동이 갈린다. 바깥 게이트(기체 = 해츨링)는 `skillHooks.ts` 가 이미 걸었다.
 *
 * ## ⚠️ 하한 1 이 계약이다
 * `stepTurrets` 는 `if (cooldown > 0) cooldown--` 뒤 `0` 이면 발사한다. 0 을 대입하면
 * **매 틱 발사**가 되어 감산이 아니라 리듬 붕괴다(BD5 의 0 클램프와 같은 함정의 반대편).
 *
 * ## ⚠️ 설계-코드 노트 — BD9 의 술어를 「만석」으로 유도했다(문서를 고치지 않았다)
 * 설계 BD9 문면은 *"상한이 만석이라 출격이 **보류 중**인 동안"* 이다. 「보류 중」을 글자대로
 * 재려면 `state.kills − player.aux0 >= threshold` 가 필요한데, 그 `threshold` 는 앵커 ㉓ 이
 * BD1·SH10·NU10 을 얹어 확정하는 값이고 이 훅에는 `player` 조차 오지 않는다. 여기서 다시
 * 계산하면 **같은 술어를 두 곳에 적는** 이 저장소의 대표 결함이 그대로 재현된다(㉓ 의
 * `willLaunch` 미러 주석이 같은 위험을 이미 경고한다). 그래서 world 가 실제로 보류를 만드는
 * 조건 하나(`live >= maxDrones` — `world.ts` 의 상한 조기 반환)만 읽는다. 차이는 *"만석인데
 * 쌓인 처치가 없는 구간"* 에서도 BD9 가 걸린다는 것뿐이고, 만석 자체가 병아리를 못 내보내는
 * 상태라 설계 의도(과밀 스트레스)와 어긋나지 않는다. **레인 보고서에 올렸다.**
 *
 * `countChicks` 는 BD9 투자 런에서만 돈다(포탑 1기당 1회) — 미투자 런에 상시 비용이 없다.
 */
export function hatchlingTurretCadence(
  state: WorldState,
  turret: Entity,
  params: TurretCadenceParams,
): void {
  if (turret.ownerId !== BROOD_MARK) return;

  // ── SH4 품기 진형 — shelter 액티브(buff 2종) 지속 중 사격 정지. `params.suppressed` doc 의
  //    규약대로 참이면 감산·격발 둘 다 건너뛰어 쿨다운을 그 자리에 묶는다(해제 즉시 밀린
  //    일제사격 방지). 밀착(좌표 대입)은 SUSTAIN 훅({@link hatchlingShelterSustain})의 몫이라
  //    여기서는 좌표를 만지지 않는다 — SH8 과 달리 **탄 소거도 하지 않는다**(설계 SH4 doc:
  //    "SH8 과 같은 축처럼 보이지만 다른 스킬" — 섞으면 두 스킬의 관측량이 갈린다).
  //
  //    ## "shelter 지속 중"을 어떻게 아는가 — `activeBuff0/1` 직접 읽기(아크캐스터 BR3 선례)
  //    이 함수는 `player` 를 받지 않는다(앵커 시그니처). 해츨링의 `player.aux1` 은 "미사용"이
  //    전역 계약이라(`activeHandlers/hatchling.ts` 헤더) 여기 전달용으로 재활용할 수 없다.
  //    `state.activeBuff0`/`activeBuff1` 은 `kind='buff'` 핸들러만 채우는 공개 필드이고, 이
  //    기체에서 그 kind 는 shelter_lo/hi **둘뿐**이다(brood 는 직격, nurture 는 blink) — 그래서
  //    "둘 중 하나가 0 보다 크다" 가 "shelter 버프가 지금 지속 중이다"와 정확히 같다
  //    (`skills/arccaster.ts` BR3 · `skills/mallow.ts` CU5 가 이미 쓰는 그 패턴 그대로).
  const sh4 = lv(state, Sk.broodingFormation);
  if (sh4 >= 1 && (state.activeBuff0 > 0 || state.activeBuff1 > 0)) {
    params.suppressed = true;
    return;
  }

  let cut = 0;

  // ── BD9 과밀 본능 — 만석인 동안 간격 −(2 + floor(Lv/4)) 틱.
  const bd9 = lv(state, Sk.overcrowdInstinct);
  if (bd9 >= 1 && countChicks(state) >= broodMaxDrones(state)) {
    cut += 2 + Math.floor(bd9 / 4);
  }

  // ── NU4 둥지 소집(연사 창) — 창이 열려 있는 동안 간격 −(3 + floor(Lv/5)) 틱.
  //    창 잔여 틱을 세우는 곳은 액티브 핸들러({@link hatchlingNurtureActive}), 깎는 곳은
  //    앵커 ⑨ 다. 여기는 **읽기만** 한다 — 포탑 기당 깎으면 대수에 반비례해 짧아진다.
  const nu4 = lv(state, Sk.nestRecall);
  if (nu4 >= 1 && readSlot(state.skillStage, HatchlingStage.nestRecallTicks) > 0) {
    cut += 3 + Math.floor(nu4 / 5);
  }

  if (cut <= 0) return;
  const next = params.cooldownTicks - cut;
  params.cooldownTicks = next > 1 ? next : 1;
}

// ---------------------------------------------------------------------------
// 앵커 ㉘ — 포탑이 수명으로 소멸한 직후(`stepTurrets` 의 `life === 0` 분기)
// ---------------------------------------------------------------------------

/**
 * **BD3 작별 격발 · NU9 둥지 표식(전수 경로의 셋째) · SH9 이소 둥지(자연 만료 전용).**
 *
 * ## ⭐ 이 훅이 「소멸 경로 전수」를 닫는다
 * BD3·NU9 의 본체는 {@link chickDespawned} 이고, SH1·SH7 의 강제 소멸도 {@link killChick} 을
 * 통해 **같은 함수**를 부른다. 그래서 이 두 스킬은 세 경로 전부에서 정확히 한 번씩 돈다 —
 * 배치 5 헤더 사유 3묶음이 "반쪽이라 안 넣는다" 고 적은 그 조건이 여기서 해소된다.
 *
 * ## SH9 만 자연 만료 전용인 이유 — **설계 문면 그대로**
 * SH9 는 *"수명이 자연히 다한 병아리는"* 이라고 못 박았다. 앵커 ㉘ 자체가 이미 자연 만료
 * 전용이지만(강제 소멸은 `dead` 를 스스로 세워 이 분기에 오지 않는다), `aux1 === 0` 을 한 겹
 * 더 본다: **`aux1` 사유 코드의 첫 독자**가 이 줄이고, 훗날 다른 소멸 경로가 이 앵커로
 * 흘러들어도 SH9 이 조용히 오발동하지 않는다.
 *
 * ## SH9 가 남기는 것은 `destructible` 이 아니라 **파괴가능 벽**이다
 * `destructible` 은 *"이동은 통과"* 하는 보상 오브젝트라(entities.ts 의 kind 주석) 엄폐가
 * 되지 않는다 — 그것으로 배선하면 방어 축 스킬이 XP 상자가 된다. `spawnBreakableWall`
 * (hp > 0)은 **양 진영 탄을 멈추고**(stepProjectiles 의 벽 스윕) 아군탄으로 부술 수 있어
 * 설계 문면("파괴 가능한 낮은 HP 둥지벽")과 축(shelter = 엄폐)에 둘 다 맞는다.
 * ⚠️ **침공 3레이어에서는 부술 수 없다** — 그 모드만 `wallIndex` 빠른 경로가 벽 피해를
 *    적용하지 않기 때문이다(`world.ts` 의 그 분기 주석이 정본). 막는 기능은 그대로다.
 */
export function hatchlingTurretExpired(state: WorldState, turret: Entity): void {
  // 병아리만이다 — 센트리·드론 베이도 이 분기로 소멸한다(회귀 방지, ㉖·㉗ 과 같은 게이트).
  if (turret.ownerId !== BROOD_MARK) return;

  chickDespawned(state, turret);

  // ── SH9 이소 둥지 — 자연 만료(사유 코드 0)에만, 그 자리에 낮은 HP 둥지벽.
  const sh9 = lv(state, Sk.fledgeNest);
  if (sh9 >= 1 && turret.aux1 === 0) {
    spawnBreakableWall(
      state,
      turret.x,
      turret.y,
      SH9_NEST_WALL_HALF,
      SH9_NEST_WALL_HALF,
      8 + 2 * sh9,
    );
  }
}

// ---------------------------------------------------------------------------
// 앵커 `onEnemyBulletMoved` (배치7 F2b) — 적탄이 이번 틱 위치 적분을 끝낸 직후
// ---------------------------------------------------------------------------

/**
 * **SH8 탄받이 깃털** — 적탄이 병아리 판정 반경에 닿으면 소거하고, 그 병아리의 수명을 깎는다.
 * SH4「품기 진형」과 다른 축이다 — SH4 는 배치·사격 정지, SH8 은 상시 탄막 필터(수명 소모).
 *
 * ## life 클램프 — **반드시 1 에서 멈춘다**(0 을 건너뛰지 않는다)
 * `stepTurrets` 의 자연 만료는 `life === 0` 을 **정확히** 만나야 발동한다. 여기서 `life` 를
 * 그대로 감산해 음수로 넘기면 다음 틱 감산이 −1, −2… 로 계속 내려가며 `=== 0` 을 영영 못
 * 만나 **불사**가 된다(설계 SH8 1R MINOR 경고 그대로). `max(1, life − k)` 로 1 에 멈추면
 * 다음 틱의 자연 `life--` 가 그 자리에서 정확히 0 을 만나 정상 만료한다 — SH8 로 앞당겨진
 * 만료도 "자연 만료"(사유 코드 0)로 잡혀 BD3·NU9·SH9 가 그대로 돈다(설계 SH8 본문 명시).
 *
 * ## 근접 검사 — 원-원 겹침(반경 합)
 * 병아리 판정 반경(`e.radius`) + 적탄 반경(`bullet.radius`)의 합보다 가까우면 접촉이다.
 * 동시에 여러 병아리가 후보여도 **배열 순서로 첫 접촉 1기만** 삼킨다(이 파일의 tie-break
 * 관용구 — `firstChick`·NU7 최근접 젬과 같은 결정론 규율).
 *
 * ## RNG 미소비 · 엔티티 미생성 · 신규 상태 0
 * 거리 제곱 비교뿐이다. 이 앵커는 적탄 이동 루프의 순회 안이라 스폰이 금지돼 있고, 이
 * 스킬은 애초에 아무것도 낳지 않는다.
 */
export function hatchlingEnemyBulletMoved(state: WorldState, bullet: Entity): boolean {
  const sh8 = lv(state, Sk.featherBulwark);
  if (sh8 < 1) return false;
  const dec = Math.max(1, 12 - Math.floor(sh8 / 2));
  for (const e of state.entities) {
    if (!isChick(e)) continue;
    const dx = e.x - bullet.x;
    const dy = e.y - bullet.y;
    const rr = e.radius + bullet.radius;
    if (dx * dx + dy * dy > rr * rr) continue;
    const next = e.life - dec;
    e.life = next > 1 ? next : 1;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 앵커 ④ — 실제로 선체 hp 가 깎인 피격의 후속
// ---------------------------------------------------------------------------

/**
 * **SH2 위기 산개** — 병아리 전원이 피격원 쪽으로 산개 돌진하며 경로 위 적탄을 소거한다.
 *
 * ## 이 스킬이 배치 5 에서 미배선이던 사유와 그 해소
 * 헤더 사유 4묶음이 *"앵커 ④ 가 피격원 엔티티·접근 벡터를 넘기지 않는다"* 고 적었다. 이
 * 레인이 앵커 ④ 에 **선택 인자 `srcX`/`srcY`** 를 더해 그것을 열었다(필수로 더하면 7기체
 * 호출부와 타 레인 픽스처가 전부 깨진다 — 그 판단 근거는 앵커 doc).
 *
 * ## ⚠️ 좌표가 없으면 발동하지 않는다
 * `undefined` 는 *"모른다"* 다. 0,0 으로 대체하면 월드 원점 방향으로 전원이 돌진해 설계와
 * 무관한 거동이 된다 — 방향 없는 산개는 설계가 정의한 적이 없다.
 *
 * ## 「경로 위 적탄 소거」의 정직한 범위
 * 소거는 **도착 지점 반경**에서 한 번 돈다(경로 전체 스윕이 아니다). 스윕은 탄-벽
 * 처리에만 있는 `sweptCircle*` 계열이 필요하고 그것은 leaf 밖이다 — 돌진 거리가 반경의
 * 1.5배 안쪽이라 실제 경로와 도착 원의 차이는 병아리 1기 폭 수준이다.
 *
 * ## RNG 미소비
 * `slideCircleWalls`·`clearEnemyBullets` 둘 다 난수를 뽑지 않고, 산개 부호는 **엔티티 배열
 * 순서의 홀짝**이라 결정론이 자명하다.
 */
export function hatchlingPlayerDamaged(
  state: WorldState,
  player: Entity,
  srcX?: number,
  srcY?: number,
): void {
  const sh2 = lv(state, Sk.crisisScatter);
  if (sh2 < 1) return;
  if (srcX === undefined || srcY === undefined) return;

  const rx = srcX - player.x;
  const ry = srcY - player.y;
  const d = Math.sqrt(rx * rx + ry * ry);
  if (d === 0) return; // 정확히 겹친 피격원 — 접근 벡터가 없다.
  const ux = rx / d;
  const uy = ry / d;

  const dash = 90 + 6 * sh2;
  const clearR = 70 + 4 * sh2;
  const spread = dash / 2;

  let i = 0;
  for (const e of state.entities) {
    if (!isChick(e)) continue;
    // 접근 벡터 방향으로 돌진하되 수직으로 ± 벌린다 = 「산개」. 부호는 배열 순서 홀짝.
    const side = i % 2 === 0 ? 1 : -1;
    const tx = e.x + ux * dash - uy * side * spread;
    const ty = e.y + uy * dash + ux * side * spread;
    const slid = slideCircleWalls(tx, ty, e.radius, state.activeWalls);
    e.x = slid.x;
    e.y = slid.y;
    clearEnemyBullets(state, e, clearR);
    i++;
  }
}

// ---------------------------------------------------------------------------
// 액티브 핸들러 진입점 — 앵커 밖(`activeHandlers/hatchling.ts` 가 부른다)
// ---------------------------------------------------------------------------
//
// ⚠️ **leaf 규율은 깨지지 않는다.** 이 파일은 여전히 `world.ts` 를 런타임 import 하지 않고,
// 반대로 `activeHandlers/*.ts` 가 이 파일을 import 한다(선례: `activeHandlers/striker.ts`).
//
// ⚠️ **왜 `fireTurretShot` 을 export 하지 않았는가**(정찰 지시 ④ 에 대한 답)
// `world.ts` 가 그 함수를 내주면 핸들러 → `world.ts` 런타임 import 가 생기고, 이미 있는
// `world.ts` → `actives.ts` → `activeHandlers/*.ts` 와 합쳐져 **모듈 순환**이 된다(현재
// `src/sim/**` 에 world 를 런타임 import 하는 파일은 0 개다 — grep 확인). 그럴 필요도 없다:
// `stepActives`(world.ts:1833)가 `stepTurrets`(1917)보다 **앞**이라, 발동 틱에 `cooldown = 0`
// 만 써 두면 **같은 틱의** 포탑 루프가 그 병아리를 곧바로 쏘게 한다. 관측 결과가 동일하고
// 순환이 없다.

/**
 * **BD8 브루드 강습** — brood 액티브 발동 틱에 살아 있는 병아리 전원이 쿨다운을 무시하고
 * 즉시 일제 사격한다.
 *
 * 구현은 `cooldown = 0` 한 줄이다(위 「왜 export 하지 않았는가」). 소비처는 `stepTurrets` 의
 * `if (t.cooldown > 0) { t.cooldown--; continue; }` 이고 그 분기는 **이미 있다** — 새 코드가
 * 필요한 축이 아니라 순서가 이미 맞아 있던 축이다.
 */
export function hatchlingBroodActive(state: WorldState): void {
  const bd8 = lv(state, Sk.broodAssault);
  if (bd8 < 1) return;
  for (const e of state.entities) {
    if (!isChick(e)) continue;
    e.cooldown = 0;
  }
}

/** NU4 재배치 오프셋 — 반지름 90 의 정팔각 근사(정수 리터럴이라 삼각함수·난수 0). */
const NU4_RECALL_OX = [90, -90, 0, 0, 64, -64, 64, -64] as const;
const NU4_RECALL_OY = [0, 0, 90, -90, 64, 64, -64, -64] as const;

/**
 * **NU4 둥지 소집** — nurture 액티브 발동 시 병아리 전원이 **도착 지점** 주위로 재배치되고
 * 잠깐 연사 창을 얻는다.
 *
 * ## ⚠️ 반드시 `blink` **뒤**에 불러라
 * nurture 액티브 2종은 `blink(state, player, …)` 로 플레이어를 먼저 옮긴다. 그 **뒤**의
 * `player.x`/`player.y` 가 곧 설계가 말한 "도착 지점" 이다 — 앞에서 부르면 출발 지점에
 * 모이므로 스킬이 정반대로 작동한다.
 *
 * ## 연사 창은 세 지점이 한 벌이다
 * 여기서 세우고({@link HatchlingStage.nestRecallTicks}), 앵커 ⑨ 가 틱당 1 씩 깎고, 앵커 ㉗ 이
 * 0 보다 큰 동안 간격을 깎는다. 셋 다 같은 틱 안에서 발동 → 감산 → 소비 순서라(world.ts
 * 1833 → 1874 → 1917) 세운 그 틱부터 창이 열린다.
 *
 * 발동 틱의 즉시 1발은 BD8 과 같은 형태(`cooldown = 0`)다 — 창만 세우면 이미 쿨다운을 물고
 * 있던 병아리가 첫 발까지 최대 10틱을 기다려 "소집" 이라는 체감이 사라진다.
 */
export function hatchlingNurtureActive(state: WorldState, player: Entity): void {
  const nu4 = lv(state, Sk.nestRecall);
  if (nu4 < 1) return;
  let i = 0;
  for (const e of state.entities) {
    if (!isChick(e)) continue;
    const k = i % 8;
    const slid = slideCircleWalls(
      player.x + (NU4_RECALL_OX[k] ?? 0),
      player.y + (NU4_RECALL_OY[k] ?? 0),
      e.radius,
      state.activeWalls,
    );
    e.x = slid.x;
    e.y = slid.y;
    e.cooldown = 0;
    i++;
  }
  // 창 = 90 + 6×Lv 틱. 살아 있는 병아리가 0기여도 세운다 — 창 동안 새로 출격한 병아리도
  // 혜택을 받는 것이 "연사 창" 의 정의이고, 슬롯 쓰기는 투자 게이트 안이라 규약 3 을 지킨다.
  writeSlot(state.skillStage, HatchlingStage.nestRecallTicks, 90 + 6 * nu4);
}

/** SH4 밀착 슬롯 — NU4 재배치 팔각(반지름 90)을 그대로 재사용한다(같은 모양의 필요). */
const SH4_UNIT_OX = [1, -1, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071] as const;
const SH4_UNIT_OY = [0, 0, 1, -1, 0.7071, 0.7071, -0.7071, -0.7071] as const;

/**
 * **SH4 품기 진형(밀착 절반)** — shelter 액티브(buff 2종) 지속 중 병아리 전원을 플레이어
 * 주위 고정 슬롯에 **매 틱** 대입한다. 사격 정지 절반은 {@link hatchlingTurretCadence}
 * (앵커 ㉗)에 있다 — 이 함수는 좌표만 만진다.
 *
 * ## 호출 지점 — 두 shelter 액티브의 SUSTAIN 훅
 * `activeHandlers/hatchling.ts` 의 `HATCHLING_SUSTAIN.as_hatchling_shelter_lo`/`_hi` 가
 * 매 틱 이 함수를 부른다(설계 SH4 구현란: "SUSTAIN 훅에서 좌표 매 틱 대입"). `stepTurrets`
 * 에는 이동 코드가 한 줄도 없어 좌표를 직접 쓰는 것이 이 스킬의 유일하게 정합한 자리다.
 *
 * ## 반경 — 설계의 "소거 반경" 을 **밀착 반경**으로 재해석한다(설계-코드 괴리, 정직 표기)
 * 설계 SH4 는 "병아리 1기당 소거 반경 = 60 + 5×Lv"라고 적었지만, 이 배치의 앵커 배당은
 * **탄 소거를 SH8 전용으로 못 박았다**(배치7 F2b `onEnemyBulletMoved` doc — "SH4 는 배치·
 * 사격 정지, 탄 소거는 SH8"). 그래서 SH4 자신은 탄을 지우지 않고, 같은 숫자를 **밀착
 * 슬롯의 반경**(플레이어로부터 병아리까지 거리)에 대신 싣는다 — 레벨이 진형의 조밀도를
 * 결정한다는 점에서 "1기당 반경"이라는 설계 의도의 자연스러운 대응이다.
 *
 * ## RNG 미소비 · 신규 상태 0
 * 팔각 오프셋은 고정 표(단위 벡터 × 반경)이고 슬롯 배정은 배열 순회 순서다.
 */
export function hatchlingShelterSustain(state: WorldState, player: Entity): void {
  const sh4 = lv(state, Sk.broodingFormation);
  if (sh4 < 1) return;
  const radius = 60 + 5 * sh4;
  let i = 0;
  for (const e of state.entities) {
    if (!isChick(e)) continue;
    const k = i % 8;
    const tx = player.x + (SH4_UNIT_OX[k] ?? 0) * radius;
    const ty = player.y + (SH4_UNIT_OY[k] ?? 0) * radius;
    const slid = slideCircleWalls(tx, ty, e.radius, state.activeWalls);
    e.x = slid.x;
    e.y = slid.y;
    i++;
  }
}

// ---------------------------------------------------------------------------
// 앵커 ㉘ — 젬 자석 반경 확정 직후(제곱 **전** · `world.ts` 의 `stepGems`)
// ---------------------------------------------------------------------------

/**
 * **NU1 모이 물어오기** — 「병아리 주변에도 자석장이 서서 근처 젬을 **플레이어에게** 끌어온다」.
 *
 * 반경 = 100 + 10×Lv (Lv1 = 110, Lv20 = 300). 플레이어 자석(`params.radius`)과 **별개 칸**이라
 * 서로 곱해지지 않는다 — 설계 문면이 "병아리 주변에**도**"라고 더하기로 적었기 때문이다.
 *
 * ## ⚠️ 이 함수는 `broodRadius` 의 **첫 소비처**다
 * 배치4 는 필드만 열어 뒀고 `stepGems` 가 값을 읽지도 않았다. 실제 흡인 경로는 이 커밋이
 * `world.ts` 의 `stepGems` 에 세웠고, 그 분기는 통째로 `if (magnet.broodRadius > 0)` 안에
 * 있다 — **미투자 런(=0)은 종전과 비트 동일**이라 골든 해시가 안 흔들린다.
 *
 * ## ⚠️ 여기서 젬을 수거하지 않는다
 * 앵커 ㉘ doc 의 계약이다. 이 스킬이 하는 일은 **속도를 주는 것**뿐이고, 수거는 젬이
 * 플레이어에 닿았을 때 `collectGem`(앵커 ③)이 단독으로 한다.
 *
 * ## ⚠️ 살아 있는 병아리가 0기여도 값을 세운다
 * 대수 판정을 여기서 하지 않는 이유는 `stepGems` 가 어차피 자기 루프에서 병아리를 훑기
 * 때문이다. 여기서 미리 세면 같은 3중 술어가 두 곳에 생겨 갈린다(`isChick` 주석의 규율).
 * 0기면 `stepGems` 의 수집 결과가 비어 흡인이 안 걸린다 — 결과는 같고 정본은 하나다.
 */
export function hatchlingGemMagnetParams(state: WorldState, params: GemMagnetParams): void {
  const nu1 = lv(state, Sk.gemFetch);
  if (nu1 < 1) return;
  params.broodRadius = 100 + 10 * nu1;
}
