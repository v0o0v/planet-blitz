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
 * ## ✅ 배선된 것은 30종 중 **30종 전부**다 (배치7 이 PO10·FI6·PO8 을 추가 — 배선 완료)
 * 배치6 이 연 앵커 셋(`onFilmBurstPost` · `onPickupRadius` · 앵커 ⑮ 의 `FilmBurstParams`)과
 * 신설 leaf `objectiveState.ts`, 그리고 **`BubbleStage` 첫 실배정 1칸**이 그 다섯(PO4·DR3·DR7·
 * DR8·FI7 + 통합에서 DR2)을 열었다. 배치7 은 그 위에 「배치7 예약 슬롯」(`skillSlots.ts` S0
 * 배정표의 `offeringPool`·`chainWindow`·`chainKillsSnap`)을 얹어 PO10·FI6 을 배선했고, 마지막
 * 으로 PO8「잔거품 기뢰」가 붙어 30종이 채워졌다:
 *  · **PO10** 은 예약된 두 칸(`chainWindow`·`chainKillsSnap` — `state.kills` 차분 방식)
 *    위에, 재생 완료와 보강 적용 사이의 한 틱 시차를 메우는 `chainPendingBoost`(예약표 밖 —
 *    이 레인이 실측으로 추가) 1칸을 더했다. 상한을 넘는 것도 안전하다 — 「`aux0 ≤ FLAT`
 *    불변식」은 코드가 아니라 산문 주석이었다(`chainBoostPulse` doc 이 실측 정본).
 *  · **FI6** 은 예약된 `offeringPool` 1칸만으로 끝났다 — "불멸 막 판별"에 표식 슬롯이 아예
 *    필요 없었다(`bubbleFilmOfferingActive` doc 이 정본: 로드아웃 + 기존 버프 틱 필드
 *    조합만으로 판별된다). 인계 체크리스트가 이 표식을 별도 슬롯으로 예약해 뒀던 것은
 *    **불필요한 예약**이었던 셈이다.
 *  · **PO8** 은 슬롯이 **아예 필요 없었다** — `WorldState`/`BubbleStage` 변경 0건. 인계
 *    문서가 세운 "선결 셋(전용 마커·컬링 제외·접촉 피해, `world.ts` 편집 필요)" 중 마커
 *    하나만 실제로 필요했고, 그 마커도 `ownerId` 위에 이 파일 전용 상수 하나로 끝났다 —
 *    사유 전문은 이 파일 말미의 (구)미배선 주석과 {@link bubbleResidueMines} 가 정본이다.
 *
 * ⚠️ 배치5 가 DR3 을 *"신규 `WorldState` 정수가 선결"* 로 닫은 판정은 **틀렸다** — 슬롯 배열은
 * 전부 0 이면 폴드가 통째로 안 돈다. 근거는 `bubbleActiveFired` 의 DR3 블록 주석이 정본이다.
 * (아래 3묶음 서술은 배치4 시점의 기록이라 그 시점 문면 그대로 둔다 — 위가 현행이다.)
 *
 * ## (배치4 시점 기록) 배선된 것은 30종 중 **16종**이었다
 * S2 가 앵커 ⑯(`onVolleyParams`)·⑰·⑱(`onFilmAbsorbed`)을 열어 **PO2·PO5(⑯) · FI3·FI4(⑱)**
 * 넷이 추가됐고, S3 이 앵커 ㉒(`onFilmEntry`)를 열어 **FI9** 가 붙었으며, 순수 함수 개정 레인이
 * 앵커 ⑰(`onFilmEfficiency`)을 되살려 **FI8** 이 붙었다. 사유별 묶음은 `skillHooks.ts` 의 각
 * `case`/미배선 주석에 있고, 남은 14종의 큰 줄기는 넷이다:
 *
 * ✅ **DR1「역류 수거」는 이 레인(버블 배선 2차)에서 붙었다.** 종전 사유는 *"`collectGem` 이
 * `world.ts` 소유라 leaf 에서 부를 수 없다"* 였고 그것은 지금도 참이다 — 해소한 것은 **호출이
 * 아니라 수단**이다: 젬을 지우는 대신 **좌표를 플레이어 위로 옮겨** 정본 픽업 판정이 걷게 했다
 * (콤보·XP·촉매 경로 복제 0). 산술과 대가는 {@link bubbleFilmBurst} 의 DR1 블록 주석이 정본이다.
 *  1. **흡수 「효율」 축** — ⚠️ 종전 사유는 *"앵커 ⑰ 으로도 표현이 안 된다"* 였다:
 *     `filmAbsorbed = min(dmg, shield)` 이고 world 가 `aux0 -= absorbed` 를 하므로 **흡수량과
 *     내구 소모량이 같은 값**이었고, "내구 1당 막는 피해가 1+α" 는 그 둘을 분리해야 성립하는데
 *     분리가 순수 함수 시그니처 변경(= 골든)이라 배선 레인 밖이었다. **그 사유는 해소됐다** —
 *     순수 함수 개정 레인이 두 함수에 효율 인자를 넣었고 ⑰ 이 효율(bp)을 돌려주게 바뀌었다.
 *     ✅ **FI8 은 배선됐다**(`bubbleFilmEfficiency` — 피해원 복원 불가라는 별도 사유는 수집
 *     루프가 출처를 함께 실어 보내면서 해소됐다). ~~DR2 는 아직 밖이다~~ → **DR2 도 배선됐다**(배치6 통합 — 슬롯이 「신규 상태」의 정본 자리다). 종전 사유는 효율이
 *     아니라 **술어**다(막 있음 + 젬 수거로 열리는 60틱 창 = 신규 WorldState 정수 1개).
 *     FI9 는 호출부 게이트(`aux0 > 0`)가 *막 없음*을 배제해 애초에 이 앵커에 도달하지 않는다 —
 *     **그 사유는 그대로이고**, S3-5 가 게이트 앞에 앵커 ㉒ 를 열어 자리를 따로 만들었다.
 *     ✅ **FI9 는 그 자리에 배선됐다**(`bubbleFilmEntry`).
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
 * ## ⚠️ 슬롯은 **DR3 의 1칸뿐**이다 (배치6 · `BubbleStage.blinkMagnet`)
 * 나머지 25종은 전부 기존 필드(`aux0`·`aux1`·`iframes`·`dashCooldown`·`playerSlowTicks`·
 * 엔티티 좌표)와 `state.tick`·`state.wallContactTicks`·파라미터 레코드 파생만 쓴다.
 * `BubbleCarry` 는 여전히 실배정 0칸이다. ⇒ **DR3 을 안 찍은 런은 16칸이 끝까지 0** 이라
 * `hashWorld` 의 스킬 슬롯 폴드가 한 번도 안 돈다(골든 픽스처 바이트 불변의 근거).
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
// PO8「잔거품 기뢰」 전용 — `entities.ts` 는 world/patterns/waves 를 import 하지 않는 leaf 라
// (그 파일 헤더가 근거) 런타임 import 해도 순환이 되지 않는다. 스트라이커·브루저 레인의
// 같은 패턴을 그대로 따른다(`skills/striker.ts`·`skills/bruiser.ts` 의 `spawnBullet` import).
import { spawnBullet } from '../entities.js';
import type {
  ActiveFiredOrigin,
  FilmBurstParams,
  FilmBurstPushed,
  GemMagnetParams,
  ObjectiveKind,
  PickupRadiusParams,
  PlayerMoveParams,
  VolleyParams,
} from '../skillHooks.js';
import type { ActiveSkillDef } from '../../../data/ships/actives/types.js';
import { clearEnemyBullets, fanStrike, powerCentiOf, scaleCenti } from '../activeTypes.js';
import { applyChain } from '../status.js';
import { slideCircleWalls } from '../los.js';
import { length, cos, sin, TWO_PI } from '../math.js';
import { DT } from '../constants.js';
import {
  FILM_BURST_RADIUS,
  FILM_PERIOD_TICKS,
  FILM_EFFICIENCY_BASE_BP,
  filmBurstPush,
  filmReady,
} from '../shipSignature.js';
// ⚠️ 에코·조우는 **반드시 이 leaf 를 거친다.** `echo.ts`/`encounter.ts` 는 앵커 때문에
// `skillHooks.ts` 를 값으로 당기므로 여기서 그것들을 import 하면 런타임 순환이고, 그 순환은
// 클라에서 재현이 안 되고 검증 EF 에서만 TDZ 로 터진다(`objectiveState.ts` 헤더가 정본).
import { objectiveActiveOf } from '../objectiveState.js';
import { BubbleStage, readSlot, writeSlot } from '../skillSlots.js';
import { skillLv } from '../../items/skills.js';
// FI6「헌막 의식」의 "지금 선 막이 불멸 막인가" 판별용 — 순수 데이터 레지스트리 조회라
// leaf 규율을 깨지 않는다(`actives.ts` 가 이미 같은 함수를 같은 목적으로 쓴다).
import { activeByWireId } from '../../../data/ships/actives/index.js';

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
  /** PO4 압착 충돌 */ crushImpact = 3,
  /** PO5 만재 투과 */ fullFilmPierce = 4,
  /** PO6 격발 재응결 */ fireRecondense = 5,
  /** PO7 정전 파열 */ staticBurst = 6,
  /** PO8 잔거품 기뢰 */ residueMines = 7,
  /** PO9 고압 격발 조율 */ popTuning = 8,
  /** PO10 연쇄 압력 */ chainPressure = 9,
  /** DR1 역류 수거 */ reverseCurrent = 10,
  /** DR2 표면장력 세례 */ surfaceTensionBath = 11,
  /** DR3 도약 자기장 */ blinkMagnetize = 12,
  /** DR4 공막 경량화 */ bareHullTrim = 13,
  /** DR5 무지개 공명 */ prismResonance = 14,
  /** DR6 파열 추진 */ burstPropulsion = 15,
  /** DR7 신호 표류 */ signalDrift = 16,
  /** DR8 원격 채집기 */ remoteForager = 17,
  /** DR9 이탈 잔파동 */ departureRipple = 18,
  /** DR10 공막 유속 */ bareHullCurrent = 19,
  /** FI1 조기 응결 */ earlyCondense = 20,
  /** FI2 내구 재응결 */ durabilityRecondense = 21,
  /** FI3 반사 응막 */ reflectiveFilm = 22,
  /** FI4 압력 배출 */ pressureVent = 23,
  /** FI5 파열 위상 */ burstPhase = 24,
  /** FI6 헌막 의식 */ filmOffering = 25,
  /** FI7 벽면 반향 */ wallEcho = 26,
  /** FI8 발수 코팅 */ hydrophobicCoat = 27,
  /** FI9 최후의 거품 */ lastBubble = 28,
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
 * DR5 가 읽는 **콤보 스택 상한**. 설계서 DR5 가 *"10스택 상한은 기존 콤보 규칙 그대로"* 라고
 * 적었고, 엔진의 그 상수는 `world.ts` 의 `COMBO_MAX_STACK`(=10)이다.
 *
 * ## ⚠️ 왜 베껴 적는가 — 그 상수는 **export 되지 않는다**
 * `state.combo` 자체는 상한이 없다(수거마다 무한 증가하고, 상한은 `comboMultiplier` 가 XP
 * 산술 안에서만 건다). 그래서 이 스킬이 상한을 스스로 걸지 않으면 콤보 50 인 구간에서 Lv20
 * 자석이 +225% 가 되어 설계서의 *"풀콤보 자석 +30%"* 와 한 자릿수가 어긋난다 — 상한은 **선택이
 * 아니라 필수**다. `world.ts` 런타임 import 는 이 파일의 규율 ① 이 금지하므로 값을 여기 둔다.
 * ⚠️ 엔진 쪽 상한을 바꾸는 밸런스 패스는 **이 값도 같이** 고쳐라(둘은 같은 규칙이다 —
 * 문턱을 일부러 독립시킨 {@link PO2_SPEED_BASE} 와는 정반대 성격이다).
 */
const DR5_COMBO_CAP = 10;

/**
 * DR9 잔파동의 **밀어내기 변위**(sim 좌표). 설계서 DR9 는 반경만 규정하고 변위는 *"소형"*
 * 이라고만 적었다 — 그 문면을 수치로 옮긴 값이다.
 *
 * ## 왜 파열 밀어내기(`FILM_BURST_PUSH` = 260)를 재사용하지 않는가
 * 설계서 DR9 본문이 **"잔파동은 파열이 아니다"** 를 못 박았다. 변위까지 같으면 이 스킬은
 * *"쿨다운마다 임의 위치에서 파열을 한 번 더 쓴다"* 가 되어 시그니처 주기(420틱)를 우회한다.
 * 260 의 3분의 1 근처인 90 이라 밀린 적이 반경(Lv1 = 108) 밖으로 나가지 않는다 — 잔파동은
 * 자리를 비우는 것이지 적을 치우는 것이 아니다. 두 값은 **독립**이다(파열 변위를 올리는
 * 밸런스 패스가 이 값을 끌고 가면 안 된다).
 */
const DR9_RIPPLE_PUSH = 90;

/**
 * PO4 가 "벽이 먹었다" 로 인정하는 **최소 변위 부족분**(sim 좌표).
 *
 * ⚠️ 0 으로 두면 안 된다 — 밀어내기와 `slideCircleWalls` 둘 다 f64 나눗셈을 거치므로 벽이
 * 전혀 없는 무대에서도 실제 변위가 목표와 마지막 자리에서 갈릴 수 있고, 그러면 **벽 없는
 * 파열이 전부 충돌 피해를 낸다.** 반대로 크게 잡으면 얕은 접촉이 통째로 빠진다. 1 유닛은
 * 적 반경(20)의 5%라 "스쳤다" 와 "막혔다" 사이에 여유가 있다.
 */
const PO4_BLOCKED_EPS = 1;

/**
 * DR8 이 픽업 접촉 반경을 부풀릴 수 있는 **상한 배율**.
 *
 * 앵커 `onPickupRadius` doc 이 *"격자 질의 반경이므로 크게 키우면 질의 비용이 는다 — 배율에
 * 상한을 훅이 스스로 걸어라"* 라고 명시했다. 자석 반경은 픽업 버프·DR5 콤보 배율로 후반에
 * 크게 벌어지므로, 비례식만 두면 상한이 사실상 없다.
 */
const DR8_RADIUS_CAP_MULT = 4;

/**
 * PO10「연쇄 압력」의 처치 집계 창(sim 틱). 설계서가 **"90틱 고정"** 으로 못 박았다(레벨 무관).
 */
const CHAIN_WINDOW_TICKS = 90;

/**
 * PO8「잔거품 기뢰」— 기뢰장 동형(`world.ts` 보조무기 `SUB_TYPE_MINE` 과 같은 스폰 형태:
 * `kind='bullet'`·속도 0·유한 수명·관통예산 = 총피해 상한) 상수.
 *
 * 설계서(`bubble.md` [PO8])가 수치로 못 박은 것은 기뢰 **수 공식**(4 + ⌊Lv/4⌋)·**피해**
 * (10 + 2×Lv)·**수명**(120틱)·**관통예산**(3) 넷뿐이다. 링 배치 반경과 개별 기뢰의 접촉
 * 반경은 설계 문서에 수치가 없어 이 레인이 정했다(⚠️ 가정치 — 보고 대상):
 *  · 링 반경은 `FILM_BURST_RADIUS`(파열 반경)와 같게 잡았다 — "파열 지점 둘레"라는 문면이
 *    파열이 실제로 적을 밀어내는 경계와 같은 원주를 가리킨다고 읽었다.
 *  · 접촉 반경은 `world.ts` `SUB_MINE_RADIUS`(64)와 같은 자릿수를 쓰되, 한 파열에 최대
 *    9기(Lv20)가 동시에 서는 것을 감안해 56 으로 살짝 줄였다(과도한 겹침 방지).
 */
const PO8_RING_RADIUS = FILM_BURST_RADIUS;
const PO8_MINE_RADIUS = 56;
const PO8_MINE_LIFE = 120;
const PO8_MINE_PIERCE = 3;

/**
 * PO8 기뢰 전용 `ownerId` 마커 — 동시 생존 상한을 세는 유일한 수단(해츨링 `BROOD_MARK`
 * 선례와 같은 형태, `world.ts`/`shipSignature.ts` 는 건드리지 않고 이 파일 안에서만 쓴다 —
 * 마커 소비처가 전부 `kind==='bullet'` 판정이라 `isGimmick`(world.ts) 등록이 필요 없다).
 * `MISSILE_MARK`(0x3155110)·`SPLIT_FRAGMENT_MARK`(0xf12a6)·`HIVE_MICRO_MARK`(0x81ce77) —
 * 'bullet' kind 에 이미 쓰이는 세 센티널과 값이 겹치지 않는다.
 */
const PO8_MINE_MARK = 0xb0f0a3;

/**
 * 동시 생존 상한(설계서 R2-8 실측). 파열 소스 둘(피격 파열·강제 파열)이 어긋나게 맞물리면
 * 기뢰 수명(120틱) 창 안에 이론 최대 4파열 × Lv20 9기 = 36개가 설 수 있다 — 상한 없이 넣으면
 * 청크 활성 예산(`MAX_ACTIVE_GIMMICKS`, world.ts)과 무관하게(기뢰는 `isGimmick` 대상이 아니다)
 * `state.bulletCap` 을 조용히 먹는다. 초과분은 스폰을 생략할 뿐 RNG 는 소비하지 않는다.
 */
const PO8_LIVE_CAP = 12;

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
 * ## 왜 상한이 `state.filmCapacity` 이 아니라 `< state.filmCapacity` 술어인가
 * `aux0 ≤ state.filmCapacity` 은 `world.ts:2559-2561` 이 못 박은 **엔진 불변식**이다(u32 폴드
 * 안전성의 근거이기도 하다). 설계서 ⑥절 3 은 PO10 만을 그 불변식의 유일한 예외로 지정했고,
 * FI2 는 "상한 FLAT 안" 이라고 명시했다 — 그래서 술어로 상한을 지킨다. `Math.min` 으로 나중에
 * 접는 형태를 쓰면 "상한을 넘겼다가 되돌리는" 한 틱이 생겨 불변식 주석과 코드가 갈린다.
 *
 * ## 소진 = 파열 규칙은 건드리지 않는다
 * 회복은 `aux0 > 0` 일 때만 돈다. 0 인 막(= 이미 터진 뒤)을 되살리지 않으므로 "한 피격으로
 * 0 이 되는 순간만 터진다"는 시그니처 계약이 그대로다.
 */
export function bubbleSignatureStep(state: WorldState, player: Entity): void {
  // ── DR3 도약 자기장 — 버프 잔여 틱을 **매 틱 정확히 한 번** 깎는다. 앵커 ⑨ 는 그 보장을
  //    주는 유일한 지점이다(자석 앵커 ㉘ 에서 깎으면 젬이 0개인 틱에도 도는지 여부가
  //    `stepGems` 내부 사정에 묶인다).
  blinkMagnetTick(state);

  // ── DR2 표면장력 세례 — 효율 창 잔여 틱을 **매 틱 정확히 한 번** 깎는다. DR3 과 같은
  //    사유로 앵커 ⑨ 다(효율 앵커 ⑰ 는 *피격이 있는 틱에만* 불려 창이 안 줄어든다).
  tensionBathTick(state);

  // ── DR7 신호 표류(전반부) — 에코·조우가 활성인 동안 재생 타이머가 **2배**로 돈다.
  //    ⚠️ 아래 DR10 펄스보다 **앞**이어야 한다: 그 펄스는 엔진이 곧 할 일을
  //    `filmReady(aux1 + 1)` 로 한 틱 앞서 예측하는데, 여기서 aux1 을 올린 **뒤**의 값이
  //    엔진이 실제로 볼 값이다. 순서를 뒤집으면 DR7 이 붙은 런에서 펄스가 한 틱 어긋난다.
  signalDriftTick(state, player);

  // ── DR10 견인 펄스 — **막이 서는 그 틱 한 번**. FI2 와 술어가 정반대(막 없음)라 아래
  //    조기 반환보다 **앞**에 둔다. 둘을 한 게이트로 묶으면 어느 한쪽이 반드시 안 돈다.
  bareHullCurrentPulse(state, player);

  // ── PO10 연쇄 압력 — 처치 집계 창의 잔여 틱을 **매 틱 정확히 한 번** 깎는다. DR3·DR2 와
  //    같은 사유로 앵커 ⑨ 다(창을 여는 앵커 `onFilmBurstPost` 는 파열이 있는 틱에만 불려
  //    창이 안 줄어든다).
  chainWindowTick(state);

  // ── PO10 연쇄 압력(소비 절반) — 보류된 보강분을 **재생 완료 다음 틱**에 aux0 에 얹는다.
  //    자리는 `chainBoostPulse` doc 이 정본이다.
  chainBoostPulse(state, player);

  const fi2 = lv(state, Sk.durabilityRecondense);
  if (fi2 < 1) return;
  if (player.aux0 <= 0 || player.aux0 >= state.filmCapacity) return;
  if (state.tick % recondensePeriodTicks(fi2) === 0) player.aux0 += 1;
}

/**
 * **DR3 도약 자기장(감소 절반)** — 버프 잔여 틱을 1 깎는다.
 *
 * ⚠️ 미투자 런은 슬롯이 0 이라 `readSlot` 한 번으로 끝난다 — `writeSlot` 을 호출하지 않으므로
 * 배열이 끝까지 손대지지 않고, 그래서 `hashWorld` 의 스킬 슬롯 폴드가 한 번도 안 돈다
 * (`BubbleStage.blinkMagnet` doc 이 정본). 조건 없이 `writeSlot(…, 0)` 을 하는 형태로 바꾸면
 * 값은 같지만 **의도가 흐려진다** — 0 을 쓰는 경로가 생기면 "안 건드린다" 를 grep 으로 못 센다.
 */
function blinkMagnetTick(state: WorldState): void {
  const left = readSlot(state.skillStage, BubbleStage.blinkMagnet);
  if (left <= 0) return;
  writeSlot(state.skillStage, BubbleStage.blinkMagnet, left - 1);
}

/**
 * **DR2 표면장력 세례 — 창 지속 틱.** ⚠️ 밸런스 각주(설계에 수치가 없다): 기본 60틱 + 3틱/Lv.
 * 문면의 *"짧은 창"* 만 있고 계단이 없어 이 배치가 정했다 — 출시 전 일괄 패스 대상이다.
 */
function tensionWindowTicks(lvl: number): number {
  return 60 + 3 * lvl;
}

/**
 * **DR2 표면장력 세례 — 창 효율 가산(bp).** ⚠️ 밸런스 각주: +20% + 2%p/Lv.
 *
 * ⚠️ **FI8 과 곱으로 겹친다** — 설계서 R3-2 가 *"DR2 는 전 출처·유한 창, FI8 은 단일
 * 출처·상시"* 라 곱 중첩을 의도했다(앵커 ⑰ 의 case 주석이 그 인용의 정본).
 */
function tensionBonusBp(lvl: number): number {
  return 10000 + 2000 + 200 * lvl;
}

/**
 * **DR2 표면장력 세례(감소 절반)** — 창 잔여 틱을 1 깎는다.
 *
 * ⚠️ 미투자 런은 슬롯이 0 이라 `readSlot` 한 번으로 끝나고 `writeSlot` 을 호출하지 않는다 —
 * 배열이 끝까지 안 건드려져 `hashWorld` 의 슬롯 폴드가 한 번도 안 돈다(DR3 과 같은 규율).
 */
function tensionBathTick(state: WorldState): void {
  const left = readSlot(state.skillStage, BubbleStage.tensionWindow);
  if (left <= 0) return;
  writeSlot(state.skillStage, BubbleStage.tensionWindow, left - 1);
}

/**
 * 앵커 ③ **젬 수거 직후** — DR2 표면장력 세례(적립 절반) **1종**.
 *
 * 설계서: *"막이 서 있는 동안 젬을 수거하면 짧은 창 동안 막의 흡수 효율이 오른다"*.
 *
 * ## ⚠️ 술어는 **수거 시점에 막이 서 있었는가**다
 * `player.aux0 > 0` 이 그 정본이다(막 내구). 막이 없는 동안의 수거는 창을 열지 않는다 —
 * 문면이 *"막이 서 있는 동안"* 이고, 그 게이트를 빼면 무막 런이 파열 직후 첫 피격마다
 * 효율을 공짜로 얻는다.
 *
 * ## ⚠️ 창은 **갱신(대입)이지 누적(가산)이 아니다**
 * 젬이 초당 수십 개 들어오는 후반 런에서 가산이면 창이 사실상 영구가 된다 — *"짧은 창"* 이라는
 * 문면이 곧 상한이라, 매 수거가 잔여를 최대치로 **되돌린다**.
 */
export function bubbleGemCollected(state: WorldState, player: Entity): void {
  const dr2 = lv(state, Sk.surfaceTensionBath);
  if (dr2 < 1) return;
  if (player.aux0 <= 0) return;
  writeSlot(state.skillStage, BubbleStage.tensionWindow, tensionWindowTicks(dr2));
}

/**
 * **DR7 신호 표류(전반부)** — 에코·조우가 **활성인 동안** 재생 타이머가 2배로 돈다.
 *
 * 엔진은 이 앵커 **뒤**에 `if (aux0 === 0) aux1++` 를 한 번 돌린다(`world.ts` 의 버블
 * 시그니처 블록). 여기서 같은 게이트로 1 을 더 얹으면 그 틱의 총 전진이 2 가 된다 — 배율을
 * 엔진 쪽에 넣으려면 시그니처 함수를 고쳐야 하고 그건 골든이다.
 *
 * ## ⚠️ 술어는 `objectiveState.ts` 의 합류 술어 하나뿐이다
 * "에코 또는 조우" 를 여기서 다시 OR 하면 같은 술어의 두 번째 사본이 된다(그 파일 헤더가
 * 반복 지적한 재발 패턴). **완료(에코 2 · 조우 3)는 활성이 아니다** — 후반부(즉시 만재)가
 * 완수 앵커 ㉙ 에 따로 있어, 겹치면 완수 보상이 두 번 나간다.
 *
 * ## ⚠️ 레벨은 지속·배율이 아니라 **문턱**을 움직이지 않는다 — 2배는 고정이다
 * 설계 문면(`data/ships/bubble.ts`)이 *"재생 타이머가 2배로 돈다"* 로 못 박았고 레벨 스케일을
 * 적지 않았다. 레벨은 후반부(즉시 만재)의 조건에도 안 붙는다 — 그래서 이 스킬은 **Lv1 에서
 * 전량 켜진다**. 임의로 레벨 계단을 만들지 않았다(설계와 코드가 갈릴 자리다).
 */
function signalDriftTick(state: WorldState, player: Entity): void {
  const dr7 = lv(state, Sk.signalDrift);
  if (dr7 < 1) return;
  // 재생 타이머는 **막이 없을 때만** 돈다(엔진 게이트와 같은 술어). 막이 서 있는 동안
  // 얹으면 `aux1` 이 0 이어야 한다는 계약이 깨진다.
  if (player.aux0 !== 0) return;
  if (!objectiveActiveOf(state)) return;
  player.aux1 += 1;
}

/**
 * 젬 하나를 플레이어 쪽으로 **최대 `step` 만큼** 당긴다(공용 — DR1 이 세운 「좌표 직접 변위」
 * 규율의 재사용).
 *
 * ## ⚠️ 남은 거리를 넘겨 밀지 않는다 — 넘기면 젬이 플레이어를 **지나친다**
 * `stepGems` 는 이 함수 뒤에 자기 흡인을 한 번 더 얹으므로, 여기서 지나쳐 버리면 다음 틱에
 * 반대 방향으로 끌려와 진동한다. 남은 거리 이하로 자르고, 정확히 닿으면 플레이어 좌표에
 * 스냅한다 — 그 자리는 `stepGems` 의 `d2 > 0.0001` 술어가 속도를 0 으로 두고 픽업 반경
 * (`player.radius`)이 훨씬 크므로 유실 경로가 없다(DR1 블록 주석이 정본).
 */
function pullGemToward(player: Entity, gem: Entity, step: number): void {
  if (step <= 0) return;
  const dx = player.x - gem.x;
  const dy = player.y - gem.y;
  const d = length(dx, dy);
  if (d <= step) {
    gem.x = player.x;
    gem.y = player.y;
    gem.vx = 0;
    gem.vy = 0;
    return;
  }
  gem.x += (dx / d) * step;
  gem.y += (dy / d) * step;
}

/**
 * **DR10 공막 유속(견인 펄스 절반)** — *재생이 완료돼 막이 서는 그 틱*에, 자석 반경 2배 범위의
 * 젬 전체를 한 번 끌어당긴다. 변위 = 60 + 6×Lv (설계서 DR10).
 *
 * ## ⚠️ 술어가 "막이 섰다" 가 아니라 "이 틱에 선다" 인 이유
 * 앵커 ⑨ 는 `stepShipSignature` 의 **기체 분기보다 앞**이라, 이 함수가 도는 시점에는 아직
 * `aux1++` 도 `aux0 = state.filmCapacity` 도 일어나지 않았다. 그래서 엔진이 곧 할 일을 **한 틱
 * 앞서 예측**한다(`aux0 === 0 && filmReady(aux1 + 1)`) — 엔진의 재생 판정과 같은 순수 함수를
 * 같은 인자로 부르므로 두 판정이 갈릴 수 없다. 사후에 재려면 "막이 섰다"를 기억할 상태가
 * 필요한데, 그것이 곧 신규 `WorldState` 필드(= 해시 꼬리 폴드)다.
 *
 * ## ⚠️ 재생 완료 **만**이다 — 액티브가 세우는 막에는 안 걸린다
 * `as_bubble_film_lo/hi` 는 `aux0` 을 직접 만재로 대입하고 이 술어를 지나지 않는다. 설계서
 * 문면이 *"재생이 완료돼"* 라 그 범위가 정확히 일치한다(액티브 결속은 DR3·DR9 의 몫이다).
 */
function bareHullCurrentPulse(state: WorldState, player: Entity): void {
  const dr10 = lv(state, Sk.bareHullCurrent);
  if (dr10 < 1) return;
  if (player.aux0 !== 0 || !filmReady(player.aux1 + 1)) return;
  // 반올림은 게이트 안(공통 규율). 반경·변위 둘 다 좌표축이라 f64 로 남긴다.
  const step = 60 + 6 * dr10;
  const radius = state.magnetRadius * 2;
  const r2 = radius * radius;
  for (const e of state.entities) {
    if (e.dead || e.kind !== 'gem') continue;
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    if (dx * dx + dy * dy > r2) continue;
    pullGemToward(player, e, step);
  }
}

/**
 * **PO10 연쇄 압력(감소 절반)** — 처치 집계 창의 잔여 틱을 1 깎는다.
 *
 * ⚠️ 미투자 런은 슬롯이 0 이라 `readSlot` 한 번으로 끝난다 — `writeSlot` 을 호출하지 않으므로
 * 배열이 끝까지 손대지지 않는다(DR3·DR2 와 같은 규율).
 *
 * 창이 이번 틱에 **0 으로 떨어지면** 그 순간이 "창 닫힘" 이다 — 창이 열린 시점의
 * {@link BubbleStage.chainKillsSnap}(`state.kills` 스냅샷)과 지금의 `state.kills` 차이가
 * 창 안에서 실제로 늘어난 처치 수다. 그 값을 보강분으로 환산해
 * {@link BubbleStage.chainPendingBoost} 에 더하고, 스냅샷은 0 으로 되돌린다. 레벨은 열려
 * 있던 순간의 투자만 본다(창 진행 중 레벨이 바뀌는 경로는 이 게임에 없다).
 *
 * ## 왜 처치를 앵커 `onKillsDelta` 로 따로 집계하지 않는가 — `state.kills` 가 이미 그 값이다
 * `state.kills` 는 `kind === 'enemy' && hp <= 0` 게이트로만 오르는 단조 누적값이다
 * (`skillHooks.ts` 의 `onKillsDelta` doc — "state.kills++ 와 완전히 같은 술어"). 창이 여는
 * 시점과 닫는 시점의 두 값을 빼는 것만으로 그 구간의 처치 수가 나오므로, 처치 사건마다
 * 별도 누적 훅을 새로 여는 것은 같은 값을 두 번째 경로로 재는 것이다 — 침공 구조물이
 * `enemy` kind 밖이라 이 값에 안 잡히는 것도 그 게이트 덕분에 자동으로 정합하다(설계서
 * ④ 표가 요구한 "구현 레인 확인": kind 술어를 추가할 필요가 없다).
 */
function chainWindowTick(state: WorldState): void {
  const left = readSlot(state.skillStage, BubbleStage.chainWindow);
  if (left <= 0) return;
  const next = left - 1;
  writeSlot(state.skillStage, BubbleStage.chainWindow, next);
  if (next > 0) return;
  const po10 = lv(state, Sk.chainPressure);
  const snap = readSlot(state.skillStage, BubbleStage.chainKillsSnap);
  writeSlot(state.skillStage, BubbleStage.chainKillsSnap, 0);
  if (po10 < 1) return;
  const kills = state.kills - snap;
  if (kills <= 0) return;
  // 처치당 2 + floor(Lv/2), 회당 상한 20 + 3×Lv(설계서 ② 표). 반올림은 게이트 안 — 여기 값은
  // 이미 정수 곱셈뿐이라 반올림이 필요 없다.
  const perKill = 2 + Math.floor(po10 / 2);
  const cap = 20 + 3 * po10;
  const gain = Math.min(cap, kills * perKill);
  if (gain <= 0) return;
  // ⚠️ **가산**이다 — 다음 재생 전에 파열이 두 번(예: 강제 파열 후 대기 중 또 강제 파열) 일면
  // 두 창의 보강분이 같은 다음 막을 향해 함께 쌓인다. 설계서는 이 중복 파열 경로를 명시하지
  // 않았지만, "다음 막" 이 단수라고 해서 그 사이 창이 두 번 열릴 수 없다는 뜻은 아니다 —
  // 회당 상한은 지키면서 누적은 허용하는 쪽이 "파열-청소 습관에 보상" 이라는 설계 의도에
  // 더 가깝다(가정 — 밸런스 패스 대상, defer-balance-tuning).
  const prevPending = readSlot(state.skillStage, BubbleStage.chainPendingBoost);
  writeSlot(state.skillStage, BubbleStage.chainPendingBoost, prevPending + gain);
}

/**
 * **PO10 연쇄 압력(적용 절반)** — 보류된 보강분을 다음 막에 얹는다.
 *
 * ## ⚠️ 왜 "재생 다음 틱" 인가 — `chainPendingBoost` doc 의 실측을 그대로 코드로 옮긴다
 * `world.ts` 의 `SIG_BUBBLE_FILM` 분기는 앵커 ⑨(이 함수가 불리는 자리) **뒤**에 돌고,
 * `player.aux0 === 0` 일 때 `player.aux0 = state.filmCapacity` 을 **대입**(가산이 아니다)한다.
 * 그래서 재생이 실제로 일어나는 틱에 여기서 aux0 을 올려도 소용없다 — 뒤이어 곧바로 지워진다.
 * 재생이 일어난 **다음 틱**은 `aux0 === state.filmCapacity` 이 되어 그 대입 분기 자체가 안 돌고
 * (`if (player.aux0 === 0)` 가 거짓), 그래서 이 틱에 더한 값이 지워지지 않는다.
 *
 * ## 술어가 왜 `aux0 === FLAT && aux1 === 0` 인가 — "막 방금 재생됨" 의 유일한 관측 가능 신호
 * 자연 재생은 `aux0 = FLAT` 과 `aux1 = 0` 을 **같은 틱에 함께** 대입한다(`world.ts` 그 분기).
 * 액티브(`film_lo`/`film_hi`)도 `aux0` 을 만재로 대입하지만 `aux1` 은 건드리지 않으므로, 그
 * 순간 `aux1` 이 우연히 0 이 아닌 한(예: 막 없이 오래 버틴 뒤 액티브를 쓴 경우는 `aux1` 이
 * 이미 커져 있다) 이 술어에 걸리지 않는다. `aux1` 이 우연히 0 인 채 액티브를 쓰는 좁은 경로
 * (예: 강제 파열 직후 0 틱 안에 다른 막 액티브를 즉시 씀)에서는 보강분이 "다음 막" 을 향해
 * 그 막에 얹히는데, 그것도 설계 문면의 "다음 막" 범위 안이다 — 자연 재생만으로 한정하지
 * 않았다(가정 — 이 좁은 경로는 실전에서 사실상 발생하지 않는다).
 *
 * ## 상한은 `state.filmCapacity × 2` — PO10 이 그 불변식의 유일한 예외(설계서 ⑥절 3)
 * `aux0 ≤ state.filmCapacity` 은 강제하는 코드가 없는 **산문 주석**이다(`world.ts` 그 분기
 * 주석 실측) — 그래서 이 스킬만 그 범위를 넘겨도 골든 재동결이 선결이 아니다. 다만 무한정
 * 넘기면 u32 폴드 안전성 논거가 흔들리므로, 설계서가 못 박은 상한을 여기서 직접 건다.
 */
function chainBoostPulse(state: WorldState, player: Entity): void {
  const pending = readSlot(state.skillStage, BubbleStage.chainPendingBoost);
  if (pending <= 0) return;
  if (player.aux0 !== state.filmCapacity || player.aux1 !== 0) return;
  writeSlot(state.skillStage, BubbleStage.chainPendingBoost, 0);
  const boosted = player.aux0 + pending;
  const cap2 = state.filmCapacity * 2;
  player.aux0 = boosted > cap2 ? cap2 : boosted;
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
 * **PO1 파열 탄두 · PO3 거품 산탄 파열 · PO7 정전 파열 · DR1 역류 수거 · DR6 파열 추진 ·
 * FI1 조기 응결 · FI5 파열 위상 · FI10 정화 파열.**
 *
 * 설계서 ①-3 이 요구한 "파열 훅 전부가 단일 함수 안에만 산다"를 이 한 진입점이 만족한다 —
 * 시그니처 소진 파열(`world.ts:4268`)과 액티브 요청 소비(`world.ts:1823`) 둘 다 같은
 * `resolveFilmBurst` 를 지나므로, 파열 종류가 늘어도 여기 한 곳만 본다.
 *
 * ## ⚠️ 파열 중심 `(x, y)` 와 플레이어 좌표는 **같지 않을 수 있다**
 * 액티브 요청은 요청 시점 좌표를 박아 두므로(`requestFilmBurst` 주석), 같은 틱에 blink 가
 * 플레이어를 옮겼으면 둘이 갈린다. 그래서 **효과별로 기준점을 나눈다**:
 *  · **파열 중심** — PO1(폭발) · DR1(수거 **술어**. 목적지는 플레이어다 — 젬이 어디로 가는가와
 *    어디까지 걷는가는 다른 축이고, 설계서 문면은 "반경 안 젬" 쪽만 반경으로 규정했다).
 *    설계서가 "파열 지점" 이라고 적은 것들.
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
export function bubbleFilmBurst(
  state: WorldState,
  player: Entity,
  x: number,
  y: number,
  params: FilmBurstParams,
): void {
  // ── FI7 벽면 반향 — **가장 먼저**다. 아래 PO1·DR1 이 `FILM_BURST_RADIUS` 상수를 그대로
  //    쓰는 것과 달리 이 배율은 **밀어내기 반경·변위**에만 걸린다(설계 문면이 "밀어내기
  //    반경과 변위" 로 두 칸만 지목한다). 앞에 두는 것은 순서 의존 때문이 아니라, 이 함수에서
  //    유일하게 `params` 를 만지는 블록임을 읽는 사람이 바로 보게 하려는 것이다.
  const echoBp = wallEchoBp(state);
  if (echoBp !== 10000) {
    // ⚠️ **둘 다** 곱한다. 반경만 키우면 "반경 안의 적을 반경 밖으로" 라는 밀어내기 계약이
    //    조용히 깨진다(기본값 변위 260 > 반경 220 이 그 계약이다 — `FilmBurstParams.push` doc).
    //    같은 배율을 쓰므로 부등식이 배율과 무관하게 보존된다.
    // ⚠️ `params.radius` 는 **제곱 전**이다. "×1.5" 를 `×2.25` 로 번역하지 마라.
    params.radius = (params.radius * echoBp) / 10000;
    params.push = (params.push * echoBp) / 10000;
  }

  // ── PO1 파열 탄두 — 파열 중심 반경 안 `enemy` 에게 즉발 18 + 4×Lv.
  const po1 = lv(state, Sk.burstWarhead);
  if (po1 >= 1) {
    const dmg = 18 + 4 * po1;
    const r2 = FILM_BURST_RADIUS * FILM_BURST_RADIUS;
    for (const e of state.entities) {
      if (e.dead || e.kind !== 'enemy') continue;
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy > r2) continue;
      e.hp -= dmg;
      // ⚠️ `compact` 는 **`dead === true` 만 수거**한다 — `hp <= 0` 단독으로는 안 걷는다.
      //    여기서 안 세우면 파열 폭발로만 죽은 적이 좀비로 남아 처치·젬·전리품이 전부 사라진다.
      //    `status.ts` 의 `applyChain`·`tickEnemyStatus` 와 같은 형태다(집계는 `compact` 몫).
      //    보스는 위 게이트가 이미 걸러내므로(설계서 enemy 한정) 마킹 질문 자체가 없다.
      if (e.hp <= 0) e.dead = true;
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

  // ── DR1 역류 수거 — 파열 중심 반경 안 젬을 **플레이어 위로 끌어온다**.
  //    수거 반경 = `FILM_BURST_RADIUS` × (100% + 8%p/Lv) (bp — 설계서 DR1 문면 그대로).
  //
  //    ## ⚠️ 설계서의 `collectGem` 직접 호출은 구조적으로 불가능하다 — 대체 수단을 쓴다
  //    설계서 DR1 「구현: A」는 *"파열 훅에서 반경 내 `collectGem`"* 이지만, 그 함수는
  //    `world.ts` 의 모듈-로컬이고 export 도 안 된다. export 시켜도 이 파일은 규율 ①
  //    (`world.ts` 런타임 import 0건)에 걸리고, 한 단계 위인 `skillHooks.ts` 로 올려도
  //    `world.ts → skillHooks.ts` 방향이 이미 있어 **순환**이다. 그래서 젬을 여기서 직접
  //    지우는 대안(콤보·XP·촉매 경로가 통째로 빠진다)이 아니라, **젬 좌표를 플레이어 위로
  //    옮긴다** — 수거 자체는 `resolveCollisions` 의 정본 픽업 판정이 하고, 그래서 콤보·XP·
  //    `onGemCollected` 촉매 경로가 한 줄도 복제되지 않는다.
  //
  //    ⚠️ 이 형태의 대가는 **"즉시"가 최대 1틱 늦다**는 것뿐이다. 액티브 요청 파열
  //    (`consumeFilmBurstRequests`)은 `stepGems`·`resolveCollisions` 보다 앞이라 **같은 틱**에
  //    걷히고, 시그니처 소진 파열은 `resolveCollisions` 한복판이라 그 틱의 격자 질의
  //    (옛 좌표로 빌드된 공간 해시)에 안 잡혀 **다음 틱**에 걷힌다. 옮긴 젬은 플레이어와
  //    거리 0 이라 `stepGems` 가 속도를 0 으로 두고(그 함수의 `d2 > 0.0001` 술어) 픽업 반경
  //    (`player.radius`)이 한 틱치 이동보다 훨씬 크므로 유실 경로가 없다.
  //    (설계 문서는 고치지 않았다 — 규약: 어긋남은 보고한다.)
  const dr1 = lv(state, Sk.reverseCurrent);
  if (dr1 >= 1) {
    // 반올림은 게이트 안(공통 규율). 반경은 좌표축이라 f64 로 남긴다.
    const radius = (FILM_BURST_RADIUS * (10000 + 800 * dr1)) / 10000;
    const r2 = radius * radius;
    for (const e of state.entities) {
      if (e.dead || e.kind !== 'gem') continue;
      // 술어의 기준점은 **파열 중심**이다(설계서 "반경 안 젬"). 목적지만 플레이어다 —
      // 액티브 요청 파열이 옛 좌표를 박아 두므로 둘이 갈릴 수 있다(이 함수 헤더의 표).
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy > r2) continue;
      e.x = player.x;
      e.y = player.y;
      // 잔여 자석 속도를 지운다 — `stepGems` 가 매 틱 덮어쓰지만, 파열이 그 함수 **뒤**
      // (`resolveCollisions`)에서 도는 틱에는 이 값이 그대로 해시된다.
      e.vx = 0;
      e.vy = 0;
    }
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

/**
 * **FI7 벽면 반향**의 배율(bp). 미투자·벽 비접촉이면 **정확히 10000** 을 돌려준다 —
 * 호출부가 그 값을 보고 곱셈 자체를 건너뛰므로 종전 거동과 비트 동일하다.
 *
 * ## ⚠️ 이 함수가 FI7 의 **단일 정본**이다 — 산술을 베끼지 마라
 * 배율이 필요한 자리가 둘이다: 파열 훅(앵커 ⑮ · 값을 실제로 고치는 쪽)과 PO4 의 사후 판정
 * (앵커 `onFilmBurstPost` · *목표 변위가 얼마였는지* 되짚는 쪽). 두 앵커는 `resolveFilmBurst`
 * 안에서 **같은 틱·같은 `state`** 로 연이어 불리고 그 사이에 `wallContactTicks` 가 갱신되는
 * 경로가 없다(그 갱신은 `stepPlayer` 다) — 그래서 이 함수는 두 번 불려도 같은 값을 준다.
 * 배율을 한쪽에 인라인으로 적으면 밸런스 패스가 한쪽만 고쳐 **PO4 가 벽 없는 파열에도 피해를
 * 내기 시작한다**(목표 변위를 낮게 잡으면 부족분이 항상 양수가 된다).
 *
 * 술어는 `state.wallContactTicks` 다 — 같은 술어를 쓰는 다섯 스킬(M5·S4·MO8·FI7·ME9)이
 * 전부 이 필드를 읽는다. 슬롯에 사본을 만들지 않는다.
 */
function wallEchoBp(state: WorldState): number {
  const fi7 = lv(state, Sk.wallEcho);
  if (fi7 < 1) return 10000;
  if (state.wallContactTicks <= 0) return 10000;
  // +15% + 1.5%p/Lv (Lv1 = 1.165배 · Lv20 = 1.45배). 반경·변위에 **같은 배율**을 건다.
  return 11500 + 150 * fi7;
}

/** 이번 파열의 **실효 목표 변위**. FI7 배율까지 {@link wallEchoBp} 를 거쳐 되짚는다. */
function filmBurstPushOf(state: WorldState): number {
  const base = filmBurstPush();
  const bp = wallEchoBp(state);
  // ⚠️ 호출부(`resolveFilmBurst`)가 `params.push` 를 `filmBurstPush()` 로 초기화한 뒤
  //    {@link bubbleFilmBurst} 가 **이것과 글자 그대로 같은 식**으로 곱한다. 식이 같아야
  //    f64 결과가 비트 동일하고, 그래야 아래 부족분이 벽 없는 파열에서 정확히 0 이 된다.
  return bp === 10000 ? base : (base * bp) / 10000;
}

// ---------------------------------------------------------------------------
// 앵커 `onFilmBurstPost` — 밀어내기 루프가 **끝난 뒤**(배치6 신설)
// ---------------------------------------------------------------------------

/**
 * **PO4 압착 충돌** — 파열에 밀린 적이 **벽에 막힌 만큼** 충돌 피해를 받는다.
 *
 * ## 왜 앵커 ⑮ 로는 원리적으로 못 했는가
 * ⑮ 는 밀어내기 **앞**이라 "벽이 얼마나 먹었는가" 가 아직 존재하지 않는다. 그렇다고 ⑮ 를
 * 뒤로 옮기면 반경 술어로 대상을 고르는 PO1·PO7·DR1 이 전부 조용히 0건이 된다(변위 260 >
 * 반경 220). 배치6 이 훅을 pre/post 로 쪼갠 것이 그 해소이고, `resolveFilmBurst` 주석이
 * *"하나로 합치려 하면 둘 중 하나가 반드시 틀린다"* 고 예고한 자리다.
 *
 * ## 「막혔다」를 어떻게 재는가 — **반경 방향 전진량**이다
 * 방해가 없으면 적은 파열 중심에서 바깥으로 정확히 `push` 만큼 간다. `slideCircleWalls` 가
 * 되밀면 그 전진량이 줄고, **줄어든 몫이 곧 벽이 먹은 몫**이다. 그래서 밀기 전 좌표에서 잰
 * 반경 방향 단위벡터에 실제 변위를 투영해 목표와 뺀다 — 변위의 *크기*만 비교하면 벽이
 * 옆으로 미끄러뜨린 경우(크기는 비슷한데 방향이 꺾인 경우)를 놓친다.
 *
 * ## ⚠️ 좀비 방지 · 마킹 금지 대상
 * `hp` 를 깎으면 `dead` 를 같이 세운다(정본 `status.ts`). `pushed` 는 호출부가 `kind ===
 * 'enemy'` 로만 모으므로 `guardian`·`core`(부활 분기가 있어 마킹 금지)는 **원리적으로 이
 * 배열에 없다** — 여기서 다시 거를 필요가 없고, 거른다고 적으면 없는 경로를 방어하는 죽은
 * 코드가 된다. 다만 **같은 틱의 다른 축이 먼저 죽였을 수 있어** `dead` 는 확인한다.
 *
 * ## ✅ PO8「잔거품 기뢰」는 배치7 에서 이 훅 안에 배선됐다
 * 종전 차단 사유(*"동시 생존 상한 규약이 없다"*)는 실측으로 틀렸음이 드러났다 — 해츨링
 * `BROOD_MARK` 가 이미 「전용 마커 + 동시 생존 상한 카운트 + `isGimmick` 컬링 제외」 3단
 * 규약의 선례였고, PO8 은 그중 컬링 제외조차 필요 없다(기뢰가 `kind==='bullet'` 이라
 * `isGimmick` 판정 대상 자체가 아니다 — world.ts 미편집). 접촉 피해도 신설이 아니라
 * `resolveCollisions` 의 범용 아군탄↔적 경로 재사용이다(정본은 {@link bubbleResidueMines}).
 */
export function bubbleFilmBurstPost(
  state: WorldState,
  x: number,
  y: number,
  pushed: readonly FilmBurstPushed[],
): void {
  // ── PO10 연쇄 압력(개창 절반) — 파열마다 90틱 처치 집계 창을 **연다**(대입 — 가산 아님).
  //    PO4 와 달리 `pushed` 가 비어 있어도(반경 안에 밀 적이 없어도) 창은 연다 — 설계서 문면이
  //    "파열 후" 이지 "밀어낸 적이 있으면" 이 아니다. 강제 파열(pop_lo)·만료 파열(film_hi)도
  //    같은 `resolveFilmBurst` 를 지나 이 훅에 닿으므로 세 파열 경로 전부가 창을 연다.
  const po10 = lv(state, Sk.chainPressure);
  if (po10 >= 1) {
    writeSlot(state.skillStage, BubbleStage.chainWindow, CHAIN_WINDOW_TICKS);
    writeSlot(state.skillStage, BubbleStage.chainKillsSnap, state.kills);
  }

  // ── PO8 잔거품 기뢰 — 파열마다 기뢰 링을 남긴다. PO10 과 같은 술어(`pushed` 무관 — 설계서
  //    문면이 "파열 틱에" 이지 "밀 적이 있으면" 이 아니다)라 PO4 의 이른 반환보다 앞에 둔다.
  const po8 = lv(state, Sk.residueMines);
  if (po8 >= 1) {
    bubbleResidueMines(state, x, y, po8);
  }

  const po4 = lv(state, Sk.crushImpact);
  if (po4 < 1) return;
  if (pushed.length === 0) return;
  // 이번 파열이 실제로 쓴 목표 변위(FI7 포함). 반올림·나눗셈은 전부 게이트 안이다.
  const target = filmBurstPushOf(state);
  for (const p of pushed) {
    const e = p.enemy;
    if (e.dead) continue;
    const rx = p.preX - x;
    const ry = p.preY - y;
    const d0 = length(rx, ry);
    // 호출부가 `d <= 1` 인 적을 애초에 밀지 않으므로 정상 경로에서는 도달하지 않는다.
    // 방향이 정의되지 않는 입력에 임의 값을 만들지 않기 위해 같은 술어를 그대로 둔다.
    if (d0 <= 1) continue;
    // 반경 방향 전진량 = 실제 변위를 바깥 방향 단위벡터에 투영한 값.
    const advance = ((e.x - p.preX) * rx + (e.y - p.preY) * ry) / d0;
    const blocked = target - advance;
    if (blocked <= PO4_BLOCKED_EPS) continue;
    // 벽이 먹은 몫의 15% + 2%p/Lv 가 피해. 부족분은 좌표축(f64)이고 피해는 정수로 자른다.
    const dmg = Math.round((blocked * (1500 + 200 * po4)) / 10000);
    if (dmg <= 0) continue;
    e.hp -= dmg;
    // ⚠️ `compact` 의 1차 게이트는 `e.dead` 다 — 여기서 안 세우면 압착으로만 죽은 적이
    //    좀비로 남아 처치·젬·전리품이 통째로 사라진다(PO1 블록과 같은 형태).
    if (e.hp <= 0) e.dead = true;
  }
}

/**
 * **PO8 잔거품 기뢰** — 파열 지점 둘레에 정지 거품 기뢰 링을 남긴다(`bubbleFilmBurstPost`
 * 전용 헬퍼 · 앵커 `onFilmBurstPost` 는 밀어내기 루프 **밖**이라 스폰이 안전하다).
 *
 * ## ⚠️ 「`bullet` kind 재사용은 접촉 판정이 자동으로 안 붙는다」는 추정은 틀렸다 — 실측 정정
 * 인계 문서가 이 스킬을 미배선으로 닫으며 남긴 추정 사유였다. 실측(`tests/subWeapon.test.ts`
 * `'2 기뢰장 — 위에 있는 적에게 피해를 준다'`)이 정확히 이 형태(`kind='bullet'`·속도 0)가
 * `resolveCollisions` 의 아군탄↔적 스윕 판정(world.ts)을 그대로 통과해 접촉마다 피해를 주는
 * 것을 이미 증명하고 있었다 — 그 판정은 탄의 **자기 이동 경로**(`bPrevX = b.x - b.vx*DT`)로
 * 선분을 만드는데, 속도 0 이면 그 선분이 점으로 퇴화해 **그 틱의 정적 원-원 겹침 판정**과
 * 같아진다. 그래서 접촉 피해·좀비 방지(`t.hp -= dealt; if (t.hp<=0) t.dead=true;`,
 * world.ts 4270-4271 부근)는 **신설이 아니라 재사용**이다 — 이 함수는 스폰만 하고 적 `hp` 를
 * 전혀 만지지 않는다(좀비 방지 규율이 이 함수에는 적용될 자리 자체가 없다).
 *
 * ## 배치 — RNG 0 · 결정론
 * 파열 중심 둘레에 `mineCount`개를 오름차순 등각(`i · 2π / mineCount`, i = 0..)으로 놓는다.
 * 난수를 쓰지 않으므로 같은 시드·같은 파열 횟수는 항상 같은 배치가 된다(웨이브 구성·드랍
 * 시퀀스 불변).
 *
 * ## 동시 생존 상한 — {@link PO8_LIVE_CAP}
 * `PO8_MINE_MARK` 로 표식한 살아있는 기뢰 수를 세어 상한을 넘기지 않는다. 이미 상한이면
 * **스폰을 통째로 생략**한다(부분 배치 없음 — 링이 이지러지지 않는다). 상한 도달 여부와
 * 무관하게 RNG 를 쓰지 않으므로 생략해도 이후 시드 소비에 영향이 없다.
 */
function bubbleResidueMines(state: WorldState, x: number, y: number, po8: number): void {
  let live = 0;
  for (const e of state.entities) {
    if (!e.dead && e.kind === 'bullet' && e.ownerId === PO8_MINE_MARK) live++;
  }
  if (live >= PO8_LIVE_CAP) return;
  // 기뢰 수 = 4 + ⌊Lv/4⌋(설계서 ② 레벨 스케일). 피해 = 10 + 2×Lv.
  const mineCount = 4 + Math.floor(po8 / 4);
  const dmg = 10 + 2 * po8;
  for (let i = 0; i < mineCount && live < PO8_LIVE_CAP; i++) {
    const ang = (TWO_PI * i) / mineCount;
    const mine = spawnBullet(
      state,
      x + cos(ang) * PO8_RING_RADIUS,
      y + sin(ang) * PO8_RING_RADIUS,
      ang,
      0, // 속도 0 — 기뢰장 동형(정지 발사체).
      dmg,
      PO8_MINE_PIERCE,
      PO8_MINE_RADIUS,
      PO8_MINE_LIFE,
      0,
      0,
    );
    mine.ownerId = PO8_MINE_MARK; // 동시 생존 상한 카운트 전용 마커.
    live++;
  }
}

// ---------------------------------------------------------------------------
// 앵커 `onPickupRadius` — 픽업 접촉 반경 확정 직후(배치6 신설)
// ---------------------------------------------------------------------------

/**
 * **DR8 원격 채집기** — 픽업 **접촉** 반경이 자석 반경에 비례해 늘어난다.
 *
 * ## 왜 앵커 ㉘ 으로는 못 했는가
 * 자석(`stepGems`)은 젬을 *끌어오고*, 이 반경은 *닿았는가*를 판정한다. 기믹 픽업의 접촉
 * 판정은 `resolveCollisions` 의 지역 변수(`pickR`)라 ㉘ 에서 `params.radius` 를 아무리 키워도
 * 한 픽셀도 안 움직였다(배치5 버블 레인이 실측으로 확정한 차단 사유). 배치6 이 그 지역 변수
 * 자리에 앵커를 열었다.
 *
 * ## ⚠️ 설계 문면과 **범위가 다르다** — 고치지 않고 적어 둔다
 * 설계 문면은 *"**기믹 픽업 3종**의 접촉 반경"* 인데, 호출부는 이 한 반경으로 젬 수거·전리품
 * 수거·기믹 픽업·포탑 활성화를 **전부** 판정한다(앵커 doc 이 명시). 종류별로 나누려면 호출부가
 * 종류를 넘겨야 하고, 앵커 doc 이 *"소비처가 생길 때 쪼개라 · 칸을 미리 열지 마라"* 로 그 확장을
 * 뒤로 미뤘다. 그래서 지금 DR8 은 **기믹 3종을 포함해 픽업 전반**을 넓힌다 — 설계보다 넓다.
 * (설계 문서는 고치지 않았다 — 규약: 어긋남은 보고한다.)
 *
 * ## ⚠️ 상한이 필수다
 * 반경을 키우면 격자 질의 비용이 함께 는다(앵커 doc). 자석 반경은 픽업 버프·DR5 콤보 배율로
 * 후반에 크게 벌어지므로 비례식만 두면 상한이 사실상 없다 —
 * {@link DR8_RADIUS_CAP_MULT} 로 기본 접촉 반경의 4배에서 자른다.
 * 반경은 **음수가 될 수 없다**(가산만 하고 감산이 없다) — 앵커 doc 의 진행 불가 경로 없음.
 */
export function bubblePickupRadius(
  state: WorldState,
  player: Entity,
  params: PickupRadiusParams,
): void {
  void player;
  const dr8 = lv(state, Sk.remoteForager);
  if (dr8 < 1) return;
  // 자석 반경의 10% + 1%p/Lv 를 더한다. 배율은 정수 bp · 나눗셈 1회(ADR-0005) ·
  // 반올림 없이 f64 로 남긴다(반경은 좌표축이다).
  const bonus = (state.magnetRadius * (1000 + 100 * dr8)) / 10000;
  const cap = params.radius * DR8_RADIUS_CAP_MULT;
  const want = params.radius + bonus;
  params.radius = want < cap ? want : cap;
}

// ---------------------------------------------------------------------------
// 앵커 ㉙ — 런 목표(에코 안정화 · 조우 완수)가 완수된 틱
// ---------------------------------------------------------------------------

/**
 * **DR7 신호 표류(후반부)** — 완수 시 막이 **즉시 만재**된다.
 *
 * ## ⚠️ 두 지점 다 건다 — 한쪽만 걸면 반쪽이다
 * 설계 문면은 *"안정화 완수 시"* 라 에코 어휘로 적혀 있지만, 전반부의 술어가 *"에코·조우가
 * 활성인 동안"* 으로 **한 벌**이다. 완수만 에코로 좁히면 조우로 활성 창을 얻은 런은 전반부만
 * 받고 후반부를 영영 못 받는다 — 앵커 ㉙ doc 이 말로우 ME7 을 두고 경고한 그 형태다.
 * 그래서 `kind` 로 가르지 않는다. (설계 문서는 고치지 않았다 — 규약: 어긋남은 보고한다.)
 *
 * ## ⚠️ `aux1 = 0` 을 함께 한다 — 엔진의 재생 완료와 같은 형태다
 * 엔진은 막이 설 때 `aux0 = state.filmCapacity; aux1 = 0` 을 한 쌍으로 한다(`world.ts` 버블
 * 블록). 여기서 `aux0` 만 세우면 재생 타이머가 막이 서 있는 동안에도 값을 들고 있게 되어,
 * *"막이 서 있는 동안 aux1 은 항상 0"* 이라는 계약(PO6·FI9 가 그 위에 서 있다)이 깨진다.
 * 이미 만재인 막에도 대입은 무해하다(같은 값) — 별도 술어를 두지 않는다.
 */
export function bubbleObjectiveResolved(
  state: WorldState,
  player: Entity,
  kind: ObjectiveKind,
): void {
  void kind;
  const dr7 = lv(state, Sk.signalDrift);
  if (dr7 < 1) return;
  player.aux0 = state.filmCapacity;
  player.aux1 = 0;
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
 * (`aux0 >= state.filmCapacity`). 설계서가 PO5 에 "첫 피격이 만재를 깨는 내장 억제" 를 명시했고,
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
  if (po5 >= 1 && player.aux0 >= state.filmCapacity) {
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

  // ── FI6 헌막 의식(누적 절반) — 지금 선 막이 불멸 막(`as_bubble_film_hi`)일 때만 흡수량을
  //    쌓는다. 판별은 표식 슬롯이 아니라 {@link bubbleFilmOfferingActive} 다(그 함수 doc 이
  //    "왜 표식이 필요 없는가"의 정본) — `film_lo`·재생 막은 그 판별에 자연히 걸리지 않는다.
  const fi6 = lv(state, Sk.filmOffering);
  if (fi6 >= 1 && bubbleFilmOfferingActive(state)) {
    const pool = readSlot(state.skillStage, BubbleStage.offeringPool);
    writeSlot(state.skillStage, BubbleStage.offeringPool, pool + absorbed);
  }
}

/**
 * **FI6 헌막 의식 — "지금 선 막이 불멸 막(`as_bubble_film_hi`)인가"의 판별.**
 *
 * ## 왜 표식 슬롯이 필요 없는가 — 로드아웃이 이미 정적으로 안다
 * 어느 액티브 슬롯(0/1)에 `as_bubble_film_hi` 가 장착됐는지는 `state.config.activeSlots` 로
 * 런 시작부터 고정이다(`actives.ts` 의 `defForSlot` 과 같은 조회 — 그 함수를 그대로 베끼지
 * 않고 같은 산술을 여기 leaf 안에 둔 이유는 `actives.ts` 가 이 파일을 런타임 import 하므로
 * 반대 방향은 순환이기 때문이다). 그 슬롯의 버프 잔여 틱(`state.activeBuff0`/`activeBuff1` —
 * 둘 다 액티브 엔진이 이미 갖고 있는 기존 필드, `activeTypes.ts` `setBuffTicks` 가 세운다)이
 * 양수인 동안만 "불멸 막이 지금 서 있다"가 참이다.
 *
 * `film_lo`는 `def.id` 자체가 다르므로 이 판별에 걸리지 않고, 재생 막(엔진 자동 복원,
 * `world.ts` 의 `SIG_BUBBLE_FILM` 분기)은 애초에 `activeBuff0/1` 을 건드리지 않으므로(그
 * 분기가 만지는 것은 `aux0`/`aux1` 뿐이다) 마찬가지로 걸리지 않는다 — 세 경로가 같은 `aux0`
 * 대입을 쓰는데도 상태 슬롯 신설 없이 구분되는 이유가 이것이다.
 */
function bubbleFilmOfferingActive(state: WorldState): boolean {
  const slots = state.config.activeSlots;
  if (slots === undefined) return false;
  for (let slot = 0; slot < slots.length; slot++) {
    const def = activeByWireId(slots[slot] ?? -1);
    if (def === undefined || def.id !== 'as_bubble_film_hi') continue;
    if (def.shipTypeId !== (state.config.shipType ?? 0)) continue;
    const buffTicks = slot === 0 ? state.activeBuff0 : state.activeBuff1;
    if (buffTicks > 0) return true;
  }
  return false;
}

/**
 * **FI6 헌막 의식(소비 절반)** — 불멸 막 만료 파열이 이 함수를 불러 누적을 가산 피해로
 * 바꾸고 풀을 **0 으로 소비**한다(설계서: "만료 소비 후 0").
 *
 * ## 왜 `activeHandlers/bubble.ts` 가 이 값을 부르는가 — 소비처가 그 파일에 있다
 * 만료 파열의 폭발 피해(`blastDamage`)는 `BUBBLE_EXPIRE.as_bubble_film_hi`(액티브 만료 훅
 * 자체, `filmBurst.ts` 의 파열 훅 `onFilmBurst` 가 아니다)가 부른다 — 그 자리는 leaf 규율상
 * `skills/*.ts` 를 값으로 당길 수 없는 `world.ts`/`filmBurst.ts` 가 아니라 **활성 스킬
 * 핸들러 파일**이라, 스트라이커·말로우·해츨링 액티브 핸들러가 이미 하는 대로
 * (`activeHandlers/*.ts` 가 `skills/*.ts` 를 값으로 import 하는 기존 선례) 이 함수를 노출해
 * 부르게 한다. `skills/bubble.ts` → `activeHandlers/bubble.ts` 역방향 import 가 없으므로
 * 순환이 아니다.
 *
 * ⚠️ 미투자 런은 pool 을 세운 적이 없으므로(누적 절반이 투자 게이트 안에서만 쓴다) 여기서도
 * **먼저 반환**해 슬롯을 건드리지 않는다.
 */
export function bubbleFilmOfferingConsume(state: WorldState): number {
  const fi6 = lv(state, Sk.filmOffering);
  if (fi6 < 1) return 0;
  const pool = readSlot(state.skillStage, BubbleStage.offeringPool);
  writeSlot(state.skillStage, BubbleStage.offeringPool, 0);
  if (pool <= 0) return 0;
  // 40% + 4%p/Lv(설계서 ②). 반올림은 게이트 안.
  return Math.round((pool * (4000 + 400 * fi6)) / 10000);
}

// ---------------------------------------------------------------------------
// 앵커 ㉒ — 막 흡수 분기의 **진입 술어 직전**(막이 없는 피격까지 관측)
// ---------------------------------------------------------------------------

/**
 * **FI9 최후의 거품** — *막이 없는데* 이 피격으로 죽는다면, 재생 진행분을 전액 태워 **즉석
 * 비상막**을 세운다. 막이 서면 바로 다음 줄의 게이트(`aux0 > 0`)가 열려 기존 흡수·파열 코드가
 * 그대로 돌고, 그 피격부터 흡수가 일어난다(설계서 FI9 「구현: A」).
 *
 * ## 왜 앵커 ⑰⑱ 이 아닌가
 * 저 둘은 호출부 게이트 **안**이라 *막 없음*을 원리적으로 못 본다 — 이 스킬이 배선되지 못하고
 * 있던 사유가 그것이고, S3-5 가 게이트 **앞**에 이 지점을 열어 해소했다(`onFilmEntry` doc 정본).
 *
 * ## ⚠️ `player.aux0` 에 넣는 값은 **양의 정수뿐**이다
 * `aux0` 은 u32 로 해시되므로(`replay.ts` `hashEntity`) 음수는 40억대 값으로 접혀 클라와 서버
 * 재실행이 갈리고 소수는 조용히 잘린다. 두 단계 모두 `Math.floor` 로 자르고, 그 결과가 **0 이하면
 * 아무것도 쓰지 않고 반환**한다 — 이 두 줄이 비음 정수 보장의 전부다(음수 대입 경로가 없다).
 * 0 일 때 `aux1` 만 태우지 않는 것도 같은 반환이 처리한다(대가만 치르는 조용한 손해 방지).
 *
 * ## ⚠️ 만재 상한을 건다 — 설계 문면과 어긋나 보이는 지점이라 근거를 남긴다
 * 설계서 산식은 `floor(aux1 × state.filmCapacity / FILM_PERIOD_TICKS) × (60% + 3%p/Lv)` 인데,
 * 재생 직전(`aux1` = 419)에 Lv20(×1.2)이면 상한을 넘는다(기본 HP 기준 내구 25 에서 28) —
 * 즉 **`aux0 ≤ state.filmCapacity` 엔진
 * 불변식**(FI2 「내구 재응결」이 지키는 그 불변식)을 넘는다. 불변식이 이긴다 — 넘으면 만재로
 * 자른다. 설계 문서는 고치지 않았다(규약: 어긋남은 보고한다).
 *
 * ## ⚠️ 런당 1회 제한은 두지 않았다 — 설계에 없고, 대가가 이미 제한이다
 * `aux1 = 0` 이 곧 재생 리셋이라 다음 치명 피격에서는 진행분이 0 → 내구 0 → 위 반환에 걸린다.
 * 별도 카운터를 두면 슬롯 1칸을 해시에 접어야 하는데 설계가 요구하지 않는 상태다.
 */
export function bubbleFilmEntry(state: WorldState, player: Entity, dmg: number): void {
  const fi9 = lv(state, Sk.lastBubble);
  if (fi9 < 1) return;
  // 술어 — ㉒ 는 **막이 서 있는 피격에도 불린다.** 막 없음은 여기서 직접 확인해야 한다.
  if (player.aux0 !== 0) return;
  // 치명 판정. 이 지점의 `hp` 는 아직 한 점도 안 깎였고 `dmg` 는 호출부가 정수화해 넘긴다.
  if (player.hp - dmg > 0) return;
  // 재생 진행분(aux1 = 마지막 파열 이후 경과 틱)을 만재 내구로 환산 → 레벨 배율(정수 bp).
  // 각 단계 나눗셈 1회 · 피제수 정수(ADR-0005).
  const progress = Math.floor((player.aux1 * state.filmCapacity) / FILM_PERIOD_TICKS);
  const shield = Math.min(
    state.filmCapacity,
    Math.floor((progress * (6000 + 300 * fi9)) / 10000),
  );
  if (shield <= 0) return;
  player.aux0 = shield;
  // 대가 — 재생 진행분 전액 소모.
  player.aux1 = 0;
}

/**
 * 앵커 ⑰ **막 흡수 효율**(bp) — FI8 발수 코팅.
 *
 * 설계서 FI8: *"해저드 피해(용암·박격)는 막이 2배 효율로 흡수한다 — 내구 1당 해저드 피해 2."*
 * 레벨 스케일 = **200% + 10%p/Lv** (bp). Lv1 = 21000 · Lv20 = 40000.
 *
 * ## ⚠️ `fromHazard` 없이는 이 스킬이 설계와 **정반대**가 된다
 * 이 지점의 `dmg` 는 이미 여러 접촉원을 `max` 로 합류시킨 값이라 종류가 남아 있지 않다.
 * 그래서 호출부(`world.ts` 수집 루프)가 **max 를 갱신한 그 항목의 출처**를 지역 변수로 함께
 * 실어 보낸다(설계서 「구현: A」 문면 그대로). 이 인자를 무시하고 상시 배율을 걸면
 * "해저드에서만" 이 "언제나" 가 된다 — 종전 앵커 주석이 경고하던 바로 그 형태다.
 *
 * ## ⚠️ 효율은 **막은 피해**를 늘린다 — 내구를 늘리지 않는다
 * `aux0` 은 한 점도 안 건드린다. 태우는 내구는 `filmAbsorbed` 가 효율로 되돌려 내고, 그 값은
 * 어떤 효율에서도 `aux0` 을 넘지 않는다(그 doc 이 정본) — u32 폴드 발산 경로가 없다.
 *
 * ## ⚠️ DR2「표면장력 세례」는 여기 없다 — 신규 WorldState 정수(효율 창 잔여 틱)가 선결이다
 * 사유 전문은 앵커 ⑰(`onFilmEfficiency`)의 case 주석이 정본이다. 그 필드가 서면 이 함수의
 * 반환값에 **곱연산**으로 얹는다(설계서 R3-2: 두 축은 직교하고 곱 중첩이 의도된 설계다).
 *
 * @returns 흡수 효율(bp). 미투자·비해저드 피격은 {@link FILM_EFFICIENCY_BASE_BP} 그대로다(비트 동일).
 */
export function bubbleFilmEfficiency(
  state: WorldState,
  player: Entity,
  dmg: number,
  fromHazard: boolean,
): number {
  void player;
  void dmg;
  // ── FI8 발수 코팅 — **해저드 피해 한정** 상시 효율.
  let eff = FILM_EFFICIENCY_BASE_BP;
  if (fromHazard) {
    const fi8 = lv(state, Sk.hydrophobicCoat);
    // 200% + 10%p/Lv — 정수 산술만(나눗셈 0회). 레벨은 `skillLv` 가 정수로 준다.
    if (fi8 >= 1) eff = 20000 + 1000 * fi8;
  }
  // ── DR2 표면장력 세례 — **전 출처** · 유한 창. FI8 과 **곱**으로 겹친다(설계서 R3-2).
  //    ⚠️ 창 잔여 틱을 여기서 깎지 마라 — 이 앵커는 *피격이 있는 틱에만* 불려 창이 사실상
  //    "피격 N회" 가 된다. 감소는 앵커 ⑨ 의 `tensionBathTick` 이 유일한 자리다.
  const dr2 = lv(state, Sk.surfaceTensionBath);
  if (dr2 >= 1 && readSlot(state.skillStage, BubbleStage.tensionWindow) > 0) {
    eff = Math.round((eff * tensionBonusBp(dr2)) / 10000);
  }
  return eff;
}

// ---------------------------------------------------------------------------
// 앵커 ㉗ — 액티브 핸들러가 자기 일을 끝낸 직후(쿨다운 대입 앞)
// ---------------------------------------------------------------------------

/**
 * **PO9 고압 격발 조율 · DR9 이탈 잔파동** — 액티브 결속 둘.
 *
 * 계열 판별은 훅 책임이다(앵커 ㉗ doc): `def.treeIndex` 0 = pop · 1 = drift, `def.tier` 가
 * 'lo'/'hi'. `def.shipTypeId` 는 보지 않는다 — 호출부의 `case SIG_BUBBLE_FILM` 이 이미 버블
 * 런임을 보장하고, 액티브 슬롯에는 그 기체 것만 들어간다.
 *
 * ## ⚠️ PO9 의 **절반은 이 앵커로 못 한다** — 반쪽인 채로 두는 것이 아니라, 못 하는 쪽을 적는다
 * 설계서 PO9 는 축이 둘이다: ①`as_bubble_pop_lo` 의 **파열 반경 확대** ②`as_bubble_pop_hi` 의
 * **내구→탄약 환산 효율**. ② 는 아래에서 배선했고, ① 은 **구조적으로 닿지 않는다**:
 * `pop_lo` 핸들러는 `requestFilmBurst(state, x, y)` 로 **좌표만** 요청에 싣고, 실제 반경은
 * 소비 시점에 `resolveFilmBurst` 가 `FILM_BURST_RADIUS` 상수로 정한다 — 요청에 반경 칸이 없다.
 * 칸을 열려면 `filmBurst.ts` 를 고쳐야 하는데 ⓐ그 산술은 이 배치의 수정 금지 대상이고
 * ⓑ `skills/bubble.ts` 가 그 모듈을 import 하는 순간 **순환**이다(그 파일 헤더가 명시적으로
 * 금지한다). 반경만 여기서 흉내 내는 대안(파열 반경 밖 고리를 따로 미는 것)은 **밀어내기 산술의
 * 두 번째 사본**이라 기각했다 — E3 이 지운 `pushBurst` 가 정확히 그 형태였다.
 * ⇒ **요청 슬롯에 반경(또는 배율) 칸을 여는 레인이 ① 을 얹어라.**
 *
 * ## ⚠️ PO9 ② 를 *추가 부채꼴*로 낸 이유 — 앵커가 핸들러 **뒤**다
 * 설계서의 형태는 "환산 분모(`perFilm`)를 줄인다" 이지만, 이 앵커에 도달한 시점에는 핸들러가
 * 이미 `floor(film / per)` 발을 쐈고 `player.aux0` 도 0 으로 비워졌다. 그래서 **늘어나는 몫만
 * 따로 쏜다** — 총 탄수·탄당 피해는 설계와 같고(레지스트리의 `observable: 'projectileCount'` 가
 * 재는 값이 그것이다), 다른 것은 각도 분포뿐이다(한 부채꼴이 아니라 겹친 두 부채꼴).
 * 소모한 내구는 `origin.preAux0` 이 보존하고 있다 — 이 앵커가 그 값을 싣는 이유다.
 */
export function bubbleActiveFired(
  state: WorldState,
  player: Entity,
  def: ActiveSkillDef,
  dir: { x: number; y: number },
  origin: ActiveFiredOrigin,
): void {
  // ── PO9 고압 격발 조율(환산 효율 절반) — `as_bubble_pop_hi` 가 환산한 탄수에 +4% + 1%p/Lv.
  if (def.treeIndex === 0 && def.tier === 'hi') {
    const po9 = lv(state, Sk.popTuning);
    if (po9 >= 1) {
      // 핸들러와 **같은 식**으로 기준 탄수를 되짚는다(핸들러: `floor(film / per)`).
      // `preAux0` 은 핸들러가 비우기 전의 내구다.
      const film = Math.max(0, Math.trunc(origin.preAux0));
      const per = def.coeff.perFilm ?? 1;
      const baseCount = per > 0 ? Math.floor(film / per) : 0;
      // 반올림은 게이트 안(공통 규율). **`round` 이지 `floor` 가 아니다** — Lv1 의 +5% 는
      // 만재(내구 60 · 분모 4 = 15발)에서도 0.75발이라, `floor` 면 설계서가 약속한
      // *"1레벨: 액티브 2종 즉시 강화"* 가 저레벨 구간에서 통째로 무연산이 된다.
      const extra = Math.round((baseCount * (400 + 100 * po9)) / 10000);
      if (extra > 0) {
        // 피해·확산·관통은 핸들러와 동일하게 def 에서 되읽는다 — 여기 숫자를 적으면
        // 레지스트리와 두 벌이 된다.
        const centi = powerCentiOf(state, def);
        fanStrike(
          state,
          player,
          extra,
          scaleCenti(def.coeff.damage ?? 0, centi),
          def.coeff.spreadDeg ?? 0,
          dir,
          { pierce: 1 },
        );
      }
    }
  }

  // ── FI6 헌막 의식(재장전 절반) — `as_bubble_film_hi`(불멸 막) 새 캐스트가 이전 누적을
  //    **지운다**. film 축(2번 트리) `hi` 티어라 이 결이다.
  //
  //    ## 표식이 없다 — 판별은 {@link bubbleFilmOfferingActive} 가 로드아웃 + 버프 틱으로 한다
  //    이전 배치가 여기 표식 슬롯을 세우는 형태로 갔었으나, `state.config.activeSlots` +
  //    `state.activeBuff0/1`(둘 다 액티브 엔진의 기존 필드)만으로 "지금 선 막이 불멸 막인가"
  //    가 이미 판별 가능해 표식이 불필요했다(그 함수 doc 이 정본) — 그래서 이 자리에 남은
  //    일은 **재장전**뿐이다: 설계서 "지속 중 흡수한 총량" 은 이번 캐스트의 지속 구간을
  //    뜻하므로, 만료로 이미 소비된 뒤라 정상 경로에서는 pool 이 0 이지만 방어적으로 새
  //    캐스트 시점에 다시 0 을 대입한다(호출 순서가 바뀌어도 누적이 이월되지 않게).
  if (def.treeIndex === 2 && def.tier === 'hi') {
    const fi6 = lv(state, Sk.filmOffering);
    if (fi6 >= 1) {
      writeSlot(state.skillStage, BubbleStage.offeringPool, 0);
    }
  }

  // ── DR9 이탈 잔파동 — drift 액티브(blink) **출발 지점**에 소형 밀어내기 + 적탄 소거.
  //    반경 = 100 + 8×Lv, 막이 서 있으면 ×1.5.
  //
  //    ## ⚠️ 이것은 파열이 **아니다**(설계서 DR9 본문)
  //    `requestFilmBurst` 를 부르지 않고 `aux0`·`aux1` 을 한 점도 건드리지 않는다 — 파열 훅
  //    (PO1·PO3·PO7·DR1·DR6·FI1·FI5·FI10)이 도약마다 덤으로 도는 일이 없다.
  //
  //    ## ⚠️ 기준점이 `player` 가 아니라 `origin.preX/preY` 다
  //    앵커가 핸들러 **뒤**라 `player.x/y` 는 이미 *착지점*이다. 그래서 `clearEnemyBullets` 를
  //    재사용할 수 없다 — 그 헬퍼는 중심을 `Entity` 로만 받는다(좌표 인자가 없다). 아래 두
  //    루프는 그 좌표 차이 때문에 있는 것이지 산술을 달리 하려는 것이 아니다.
  if (def.treeIndex === 1) {
    const dr9 = lv(state, Sk.departureRipple);
    if (dr9 >= 1) {
      // 반올림은 게이트 안. 반경은 좌표축이라 f64 로 남긴다(막 보정은 정확히 3/2 배).
      const base = 100 + 8 * dr9;
      const radius = player.aux0 > 0 ? (base * 3) / 2 : base;
      const r2 = radius * radius;
      for (const e of state.entities) {
        if (e.dead) continue;
        const dx = e.x - origin.preX;
        const dy = e.y - origin.preY;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        if (e.kind === 'enemyBullet') {
          e.dead = true;
          continue;
        }
        // 대상 `enemy` 한정 — 침공 방어체·벽은 배치 좌표가 계약이다(FI4 와 같은 판단).
        if (e.kind !== 'enemy') continue;
        const d = length(dx, dy);
        // 중심과 정확히 겹친 적은 밀 방향이 정의되지 않는다 — 임의 방향을 만들지 않고 둔다.
        if (d <= 1) continue;
        e.x += (dx / d) * DR9_RIPPLE_PUSH;
        e.y += (dy / d) * DR9_RIPPLE_PUSH;
        // 벽 충돌 즉시 재해결 — 터널링은 결정론이 유지되므로 해시로는 절대 안 잡힌다(FI4 주석).
        if (state.activeWalls.length > 0) {
          const slid = slideCircleWalls(e.x, e.y, e.radius, state.activeWalls);
          e.x = slid.x;
          e.y = slid.y;
        }
      }
    }
  }

  // ── DR3 도약 자기장 — drift 액티브(blink) **착지 틱**에 전용 자석 확장 버프를 세운다.
  //    지속 = 90 + 6×Lv 틱(Lv1 = 96 · Lv20 = 210). 소비는 앵커 ㉘ 의
  //    {@link bubbleGemMagnetParams}, 감소는 앵커 ⑨ 의 `blinkMagnetTick` 이다.
  //
  //    ## ⚠️ 배치5 의 "막혔다" 판정을 뒤집은 근거 — **슬롯 배열은 해시 꼬리가 아니다**
  //    종전 사유는 *"전용 자석 버프 잔여 틱 = 신규 `WorldState` 정수 = 해시 꼬리 폴드"* 였고,
  //    그래서 "항상 0 인 필드라도 지금 초록인 골든이 전부 갈린다" 로 닫혔다. 그 판정이 놓친
  //    것이 `state.skillStage` 다 — `hashWorld` 는 16칸이 **전부 0 이면 폴드를 통째로
  //    건너뛴다**(`replay.ts` 의 `skillSlotAny`). 즉 이 칸을 쓰면 **DR3 을 찍은 버블 런의
  //    해시만** 갈리고 골든 픽스처를 포함한 그 밖의 모든 런은 바이트가 그대로다.
  //    (배치5 가 기각한 세 대안 — `magnetBuffTicks` 재사용 · `activeBuff0/1` 재사용 ·
  //    쿨다운 역산 — 은 지금도 기각이다. 사유 전문은 {@link BubbleStage.blinkMagnet} doc.)
  //
  //    ## ⚠️ 착지 **틱**이다 — 앵커 ㉗ 이 핸들러 뒤라 그 자리가 정확히 착지다
  //    `player.x/y` 는 이미 착지점이고(DR9 가 `origin.preX/preY` 를 쓰는 것과 같은 사실),
  //    이 스킬은 좌표를 안 보므로 그 차이에 걸리지 않는다.
  if (def.treeIndex === 1) {
    const dr3 = lv(state, Sk.blinkMagnetize);
    if (dr3 >= 1) {
      // 갱신은 **대입**이다(가산 아님). 가산이면 쿨다운이 짧은 무대에서 도약을 연달아 써
      // 창이 무한히 길어진다 — 설계의 억제(액티브 쿨다운)를 우회한다.
      writeSlot(state.skillStage, BubbleStage.blinkMagnet, 90 + 6 * dr3);
    }
  }
}

// ---------------------------------------------------------------------------
// 앵커 ㉘ — 젬 자석 반경 확정 직후 · 흡인 루프 직전
// ---------------------------------------------------------------------------

/**
 * **DR5 무지개 공명 · DR10 공막 유속(흡인 절반)** — 자석 축 둘.
 *
 * ## ⚠️ 순서가 계약이다 — DR5(반경) 먼저, DR10(이동) 나중
 * 설계서 ⑥절이 *"반경 = DR5·DR3·DR8 / 이동 = DR10"* 으로 두 축을 갈라 두었고, DR10 은
 * "반경 안의 젬" 을 대상으로 한다. DR5 를 먼저 얹어야 그 대상 집합이 **이 틱의 최종 반경**과
 * 같아진다 — 순서를 뒤집으면 DR5 로 새로 들어온 젬이 그 틱만 가속에서 빠진다.
 *
 * ## ⚠️ `broodRadius` 는 건드리지 않는다
 * 해츨링 NU1 의 자리다(그 필드 doc 이 정본). 버블에는 병아리가 없다.
 *
 * ## ⚠️ DR8「원격 채집기」는 여기 없다 — **이 앵커가 그 반경을 안 쥐고 있다**
 * 설계서 DR8 은 *기믹 픽업 3종(`magnetEmitter`·`bombDevice`·`turretPickup`)의 **접촉** 반경*을
 * 자석 반경에 비례해 늘린다. 그 판정은 `resolveCollisions` 안의
 * `circlesOverlap(px, py, pickR, t.x, t.y, t.radius)` 이고 — `pickR` 은 그 함수의 지역
 * 변수다 — 이 앵커(`stepGems`)와는 **다른 함수·다른 값**이다. 여기서 `params.radius` 를
 * 아무리 키워도 기믹 접촉은 한 픽셀도 안 움직인다(젬 흡인 반경만 커진다). 접촉 판정 쪽에
 * 앵커를 여는 레인이 얹어라. `t.radius` 를 직접 부풀리는 우회는 기각했다 — 그 값은 렌더·
 * 충돌 격자가 함께 읽는 개체 치수다.
 */
export function bubbleGemMagnetParams(
  state: WorldState,
  player: Entity,
  params: GemMagnetParams,
): void {
  // ── DR5 무지개 공명 — 콤보 스택당 자석 +1.5% + 0.15%p/Lv. 콤보는 **읽기만** 한다
  //    (만료·상한 규칙을 이 스킬이 건드리면 XP 경제가 함께 밀린다 — 설계서 재발 패턴 판정).
  const dr5 = lv(state, Sk.prismResonance);
  if (dr5 >= 1) {
    const stacks = state.combo < DR5_COMBO_CAP ? state.combo : DR5_COMBO_CAP;
    if (stacks > 0) {
      // 배율은 정수 bp · 나눗셈 1회(ADR-0005). 반경은 좌표축이라 f64 로 남긴다.
      params.radius = (params.radius * (10000 + stacks * (150 + 15 * dr5))) / 10000;
    }
  }

  // ── DR3 도약 자기장(소비 절반) — 버프 창 동안 자석 반경 +30% + 3%p/Lv.
  //    ⚠️ 반경 축이므로 **DR5 다음 · DR10 앞**이다(이 함수 헤더의 순서 계약: 반경 = DR5·DR3,
  //    이동 = DR10). DR10 은 "반경 안의 젬" 을 대상으로 하므로 반경 축이 전부 끝난 뒤여야
  //    그 대상 집합이 이 틱의 최종 반경과 같아진다.
  //    ⚠️ 잔여 틱을 여기서 **깎지 않는다** — 감소의 단일 수렴점은 앵커 ⑨(`blinkMagnetTick`)다.
  //    여기서 깎으면 젬이 0개인 틱에 이 훅이 도는지 여부가 `stepGems` 내부 사정에 묶인다.
  const dr3 = lv(state, Sk.blinkMagnetize);
  if (dr3 >= 1 && readSlot(state.skillStage, BubbleStage.blinkMagnet) > 0) {
    // 배율은 정수 bp · 나눗셈 1회(ADR-0005). 반경은 좌표축이라 f64 로 남긴다.
    params.radius = (params.radius * (13000 + 300 * dr3)) / 10000;
  }

  // ── DR10 공막 유속(흡인 절반) — 막이 없는 동안 젬이 **한 틱에 더 멀리** 끌려온다.
  //    +20% + 3%p/Lv.
  //
  //    ## ⚠️ 왜 "속도 배율" 이 아니라 좌표 변위인가 — 이 앵커에 속도 칸이 없다
  //    흡인 속도는 `stepGems` 안의 모듈-로컬 상수(`MAGNET_SPEED`)이고 `GemMagnetParams` 에
  //    칸이 없다(그 doc 이 *"흡인 속도는 상수라 반경과 무관"* 이라고 못 박는다). 그래서
  //    **엔진이 지난 틱에 이 젬에 실어 둔 속도**(`e.vx/e.vy` — `stepGems` 가 매 틱 덮어쓴다)의
  //    α 배만큼 여기서 미리 옮기고, 곧 이어질 흡인 루프가 자기 몫을 그 위에 얹는다.
  //    ⇒ 그 틱의 총 이동 = 기본 + α · 기본. 설계서의 배율과 같은 값이고, **상수 1520 을 이
  //    파일에 베끼지 않는다**(베끼면 밸런스 패스가 한쪽만 고쳐 조용히 갈리는 이중 정본이 된다).
  //    대가: 젬이 반경에 **들어온 첫 틱**은 `e.vx` 가 0 이라 가속이 없다(다음 틱부터 걸린다).
  const dr10 = lv(state, Sk.bareHullCurrent);
  if (dr10 >= 1 && player.aux0 === 0) {
    const r2 = params.radius * params.radius;
    // 반올림은 게이트 안. bp 는 정수, 변위는 좌표축이라 f64 다.
    const bonusBp = 2000 + 300 * dr10;
    for (const e of state.entities) {
      if (e.dead || e.kind !== 'gem') continue;
      const dx = player.x - e.x;
      const dy = player.y - e.y;
      if (dx * dx + dy * dy > r2) continue;
      pullGemToward(player, e, (length(e.vx, e.vy) * DT * bonusBp) / 10000);
    }
  }

  // ## ⚠️ DR2「표면장력 세례」도 여기 없다 — 사유는 앵커 ⑰(`bubbleFilmEfficiency`) doc 이 정본.
  //    술어(막 있음 + 젬 수거로 열리는 60틱 창)에 신규 `WorldState` 정수 1칸이 필요하고,
  //    그 칸은 해시 꼬리 폴드를 건드린다 — DR3 과 같은 벽이다.
}

// ---------------------------------------------------------------------------
// 앵커 ㉙ — 플레이어 이동 배율 확정 직전(감속 배율 산출 앞)
// ---------------------------------------------------------------------------

/**
 * **DR4 공막 경량화** — *막이 없는 동안* 이동 감속에 면역이고 이동이 빨라진다.
 *
 * ## ⚠️ 이 앵커가 아니면 감속 면역이 **한 틱 늦는다**
 * 감속을 부여하는 지점은 여럿이고(해저드 접촉 · 침공 견인 자기장 `HAZARD_SLOW` · 냉기) 그
 * 어디에도 앵커가 없다. 이 지점은 감속이 **소비되기 직전**이라 부여 지점이 몇 개든 그 틱 안에서
 * 0 으로 되돌릴 수 있다 — 브루저 MO4 가 "한 틱 늦다" 로 남았던 그 자리다(앵커 ㉙ doc).
 *
 * ## ⚠️ `slowTicks = 0` 은 감산까지 함께 건너뛴다 — 그것이 옳다
 * 호출부는 되쓴 값이 0 이면 배율을 1 로 두고 `if (> 0) --` 도 건너뛴다. 즉 **면역인 동안 잔여
 * 틱이 줄지 않는다.** 막이 다시 서면 남아 있던 감속이 그대로 이어진다 — 설계서의 "면역" 은
 * 무효화가 아니라 그 시간 동안 안 걸리는 것이고, 무막이 끝나는 순간 대가가 돌아오는 편이
 * "무막으로 감속을 태워 없앤다" 보다 축(취약한 시간을 발로 갚는다)에 맞다.
 *
 * ## ⚠️ 대시 임펄스는 안 빨라진다
 * `speedMult` 는 `mx * playerSpeed` 쪽에만 곱해진다(앵커 ㉙ doc). 설계서 DR4 문면도 "이동이
 * 빨라진다" 라 범위가 일치한다 — 한계에 부딪히지 않았다.
 */
export function bubblePlayerMoveParams(
  state: WorldState,
  player: Entity,
  params: PlayerMoveParams,
): void {
  const dr4 = lv(state, Sk.bareHullTrim);
  if (dr4 < 1) return;
  if (player.aux0 !== 0) return;
  params.slowTicks = 0;
  // 이속 +4% + 0.8%p/Lv. 배율은 정수 bp · 나눗셈 1회(ADR-0005) · 반올림은 게이트 안.
  params.speedMult = (params.speedMult * (10400 + 80 * dr4)) / 10000;
}

// ---------------------------------------------------------------------------
// 미배선 1종 — **왜 못 넣었는지**가 여기 있다 (배치7 갱신 — PO10·FI6·PO8 은 배선 완료로 이관)
// ---------------------------------------------------------------------------
//
// ⚠️ 이 하나는 `Sk` enum 에 멤버를 **아예 만들지 않았다.** 「유령 선언」(선언만 있고 아무도 안
// 읽는 상수)을 남기면 계측이 배선으로 오인한다 — 「없다」의 근거는 `src/sim/**` 전체 grep 이다.
//
// ✅ **PO10「연쇄 압력」은 배치7 에서 배선됐다** — 인계 문서가 "골든 재동결과 같은 커밋이어야
// 한다"고 닫았던 「엔진 불변식」은 리드 실측으로 **산문 주석일 뿐 강제 코드가 없다**는 것이
// 드러났다(`world.ts` 그 분기 주석). 배치7 예약 슬롯 `BubbleStage.chainWindow`·
// `chainKillsSnap`(`state.kills` 스냅샷 차분) 위에, "재생 다음 틱까지 보강분을 들고 있어야
// 한다"는 실측 결과 예약표 밖의 `chainPendingBoost` 1칸을 더 얹었다(그 필요성은
// `skillSlots.ts` 의 그 칸 doc 이 정본). 사유 전문은 `chainWindowTick`·`chainBoostPulse`
// 블록 주석이 정본이다.
//
// ✅ **FI6「헌막 의식」도 배치7 에서 배선됐다** — 막는 것은 앵커가 아니라 "불멸 막 지속 중"
// 판별이었고, `BubbleStage.offeringActive`(신설 표식 1칸)로 풀었다. `as_bubble_film_hi` 발동
// (`bubbleActiveFired`)이 세우고 만료(`bubbleFilmOfferingConsume`)가 지운다. 사유 전문은 그
// 두 함수와 `bubbleFilmAbsorbed` FI6 블록 주석이 정본이다.
//
// ✅ **PO8「잔거품 기뢰」도 배치7 에서 배선됐다** — 인계 문서가 세운 「선결 셋」(전용 마커·
// `isGimmick` 컬링 제외·접촉 피해 경로 신설, 전부 `world.ts` 편집 필요로 닫혀 있었다) 중
// **둘은 애초에 필요가 없었다**는 것이 실측으로 드러났다. 기뢰를 `world.ts` 의 보조무기
// `SUB_TYPE_MINE` 과 같은 형태(`kind='bullet'`·속도 0)로 스폰하면:
//  · **컬링 제외 불필요** — `isGimmick`(world.ts)이 훑는 kind 목록에 `'bullet'` 은 아예 없다.
//    기뢰가 그 판정 대상 자체가 아니라 "제외"할 것이 없다.
//  · **접촉 피해 신설 불필요** — `resolveCollisions` 의 아군탄↔적 스윕 판정이 이미 속도 0
//    탄을 지원한다. `tests/subWeapon.test.ts` 의 `'2 기뢰장 — 위에 있는 적에게 피해를
//    준다'`가 그 실측 증거다 — SUB_TYPE_MINE 이 지금도 이 경로로 피해를 준다.
//  · **전용 마커만 실제로 필요했다** — 동시 생존 상한(12, 설계서 R2-8)을 세는 유일한 수단
//    이라 `PO8_MINE_MARK`(이 파일 전용, `world.ts`/`shipSignature.ts` 미편집)를 신설했다.
// 종전에 기각됐던 *"`fanStrike` 로 속도 0 탄을 뿌리면 탄의 수명·관통·컬링 규칙이 기뢰와
// 달라 위 셋을 다시 만들어야 한다"* 는 판단도 다시 보면 **다르지 않다** — SUB_TYPE_MINE 이
// 이미 `spawnBullet` 그 자체이므로 "기뢰 규칙"과 "탄 규칙"이 애초에 같은 규칙이었다.
// 정본은 {@link bubbleResidueMines} 주석.
//
// ## DR2「표면장력 세례」 — 이 배치가 **명시적으로 금지**한 축이다
// 신규 `WorldState` 정수 + 해시 꼬리 폴드가 필요하고, 그것은 D 단계 골든 재동결과 같은 커밋에
// 묶기로 확정됐다. (⚠️ DR3 과 달리 `BubbleStage` 로 대신할 수 없다고 단정하지 마라 — 술어가
// "막 있음 + 젬 수거로 열리는 창" 이라 구조는 DR3 과 같다. 손대지 않은 것은 **지시**이지
// 불가능 판정이 아니다.)
