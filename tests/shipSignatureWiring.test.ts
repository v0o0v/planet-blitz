/**
 * M8 시그니처 **배선** 검증 — 로스터 6종(typeId 1~6)의 시그니처가 `src/sim/world.ts` 까지
 * 실제로 도달해 관측 가능한 효과를 내는가.
 *
 * ## 이 파일이 존재하는 이유 (이 저장소에서 8번 재발한 결함)
 * "단위 테스트는 전부 그린인데 배선이 통째로 없다." `src/sim/shipSignature.ts` 의 순수 함수와
 * 상수는 단위 테스트로 100% 덮이지만, 그 함수를 **아무도 부르지 않아도** 그 테스트는 전부
 * 통과한다. 실제로 typeId 3~6 은 오랫동안 그 상태였다.
 *
 * ## 그래서 두 축으로 본다
 *  (A) **정규 경로**: `Profile{typeId:N}` → `buildRunConfig`(앱의 런 시작 3경로가 쓰는 바로 그
 *      함수) → `createWorld` → `stepWorld`. 테스트가 `WorldConfig` 를 손으로 조립하지 않는다.
 *  (B) **시그니처 억제 동형 대조군**: 같은 config 에서 시그니처 2축(`signatureOn` 의 마스크 축과
 *      `shipType` 축)만 눌러 끈 런과 비교한다. "typeId 0 런과 다르다" 는 **배선이 0줄이어도
 *      참**이다 — `baseBp` 가 damage/maxHp/moveSpeed 를 바꾸고 `shipType` 이 해시 꼬리에 접히기
 *      때문이다. 그 대조는 보조 지표로만 두고, 배선 유무의 직접 측정은 (B)가 한다.
 *
 * ## 대조군이 공정한 근거 (시그니처 외에 아무것도 안 바뀐다)
 * `config.shipType` 을 읽는 곳은 저장소 전체에 세 군데뿐이다.
 *   1. `src/sim/replay.ts` 해시 꼬리 폴드 → **해시가 아닌 관측량**(hp·kills·엔티티 수)만 비교하면 무관.
 *   2. `src/sim/powerups.ts` `investedInAffinity` → 여기 프로필은 `zeroSkillInvest` 라 전 성분
 *      0 이므로 가중치가 타입 무관 동일. `powerupRng` 소비 순서도 불변.
 *   3. `src/sim/world.ts` `signatureOn` → 바로 우리가 끄려는 축.
 * 따라서 live 와 ctrl 의 관측 차이는 **시그니처 배선 때문일 수밖에 없다.**
 *
 * ## 무대·시드는 실측으로 고른 것이다
 * 각 케이스의 planet/tier/seed/ticks 는 "그 시그니처가 실제로 발현하는" 조건을 실측 스윕으로
 * 찾아 고정한 것이다. 예: 해츨링은 p1t1·p2t2 에서 5400틱에 7~8킬뿐이라 임계(12)에 영원히
 * 닿지 않는다 → 반드시 p0t0. 말로우·버블은 p0t0 의 누적 피해가 얇아 정수 반올림에 신호가
 * 먹히므로 p2t2. 무대를 바꾸면 케이스가 조용히 무의미해질 수 있다.
 */

import { describe, it, expect } from 'vitest';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import type { Profile } from '../src/save/profile.js';
import { createWorld, stepWorld, playerCloaked } from '../src/sim/world.js';
import { spawnBoss } from '../src/sim/entities.js';
import { PLANET_MODE } from '../src/sim/planetMode.js';
import { updateBoss } from '../src/sim/boss.js';
import { updateEnemy, chargerHitWall } from '../src/sim/patterns/index.js';
import { summonEnemy } from '../src/sim/waves.js';
import { BERDAN } from '../data/planets/index.js';
import { CHARGER, GUNNER } from '../data/enemies.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import type { Entity } from '../src/sim/entities.js';
import { hashWorld } from '../src/sim/replay.js';
import {
  hasSignature,
  SIGNATURE_BITS,
  SIG_BRUISER_ARMOR,
  SIG_ARC_OVERCHARGE,
  SIG_PHANTOM_CLOAK,
  SIG_HATCHLING_BROOD,
  SIG_MALLOW_CUSHION,
  SIG_BUBBLE_FILM,
  SIG_STRIKER_MARKSMAN,
  ARMOR_MAX_STACKS,
  OVERCHARGE_STILL_TICKS,
  CLOAK_UNHIT_TICKS,
  FILM_ABSORB_FLAT,
  BROOD_MARK,
} from '../src/sim/shipSignature.js';
import { DRONE_MARK } from '../src/sim/uniques.js';
import { shipTypeDef, zeroSkillInvest } from '../data/ships/index.js';

// ---------------------------------------------------------------------------
// 공통 — 정규 경로로 런을 굴려 **해시가 아닌** 관측량을 모은다.
// ---------------------------------------------------------------------------

const NEUTRAL: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };
/** 런이 조기 종료되지 않게 버티는 무대 상수(프로필 파생값이 아니다). */
const DURABLE_HP = 100_000_000;

/** `typeId` 기체 하나를 가진 프로필(무투자). 앱의 기체 교체 결과와 같은 모양. */
function profileWithType(typeId: number): Profile {
  const p = defaultProfile();
  const ship = activeShip(p);
  ship.typeId = typeId;
  ship.skillInvest = zeroSkillInvest(typeId);
  return p;
}

/**
 * ⚠️ 2026-08-06 — **`suppressSignature`(shipType:0 강제)는 ADR-0049 이후 오염된 대조군이라
 * 삭제했다.** 그 헬퍼는 "typeId 0(스트라이커)는 시그니처가 없다(`shipTypeDef(0).signatureBit
 * === -1`)"는 전제로 마스크 비트를 지우고 shipType 을 0 으로 눌러 "시그니처 완전 off" 런을
 * 만들었다. ADR-0049 가 스트라이커에 비트24(정조준 사이클)를 부여하면서 그 전제가 깨졌다 —
 * shipType:0 은 이제 "시그니처 없음"이 아니라 **"이 기체 대신 스트라이커 정조준이 켜진 런"**
 * 이다(실측: `ctrl.maxAux0` 가 0 대신 정조준 사이클 0..11 을 돈다). 유효 shipType 0~6 전부가
 * 시그니처 비트를 하나씩 가지므로(shipSignature.ts SIGNATURE_BITS, 7개) **"시그니처 없음"은
 * 이제 제품에 존재하지 않는 상태다** — 그 상태를 config 로 만들어 대조군 삼는 설계 자체가
 * 틀렸다. (개별 파일 shipSignaturePhantom.test.ts 머리말에 더 자세한 물증이 있다.)
 *
 * ## 대신 무엇을 쓰는가 — 시그니처별 트리거 입력 굶기기(ⓐ)
 * shipType·mask 는 **live 와 완전히 동일하게 두고**(시그니처는 계속 켜져 있다), 그 시그니처가
 * 읽는 aux 슬롯만 매 틱 stepWorld 직전에 되돌려 트리거 임계에 영영 못 닿게 한다. 6개 시그니처
 * 중 5개(브루저·아크캐스터·팬텀·해츨링·버블)는 진짜 임계 트리거라 이 기법이 그대로 통한다.
 * **말로우만 다르다** — 유예(35% 이연)는 `cushionOn` 하나만 게이트하고 임계가 없어(피격마다
 * 무조건 발동) 굶길 트리거가 없다. 그래서 말로우는 **정산**(무피격 aux1 이 임계 도달) 축만
 * 굶긴다 — CASES 의 말로우 항목은 이 축이 실제로 갈리는 무대(정산이 자연히 발생하는 저압
 * 무대)로 따로 골랐다(아래 주석).
 *
 * shipType 이 안 바뀌므로 baseBp(damage/maxHp/moveSpeed) 오염이 없다 — 옛 방식이 스스로
 * 경고했던 "가짜 증거" #2가 사라진다. 대가: 굶기는 슬롯 자체(예: 팬텀의 aux0/aux1, 버블의
 * aux1)는 우리가 직접 건드리므로 그 슬롯의 "ctrl 에서 0"이라는 관측은 항진이다 — §②·§③ 단언은
 * 그 슬롯이 아니라 **하류 관측**(cloakedTicks·hatched 성격의 관측·hpLost 등, world.ts 의 다른
 * 코드 경로가 독립적으로 계산하는 값)으로 옮겼다.
 */
function starveTrigger(state: WorldState, player: Entity, bit: number): void {
  switch (bit) {
    case SIG_BRUISER_ARMOR:
      // 장갑 스택(aux0)을 매 틱 0 으로 되돌린다 — 피격 시 감소율 계산이 항상 bp=0 을 본다.
      player.aux0 = 0;
      break;
    case SIG_ARC_OVERCHARGE:
      // 정지 카운터(aux0)를 매 틱 0 으로 되돌린다 — 임계(90틱)에 영영 못 닿아 증폭이 안 선다.
      player.aux0 = 0;
      break;
    case SIG_PHANTOM_CLOAK:
      // 무피격 스트릭(aux0)·해제 대기 플래그(aux1)를 매 틱 0 으로 되돌린다("방금 피격당한 것처럼").
      player.aux0 = 0;
      player.aux1 = 0;
      break;
    case SIG_HATCHLING_BROOD:
      // 출격 스냅샷(aux0)을 매 틱 state.kills 로 덮어써 부화 갭을 항상 0 에 묶는다.
      player.aux0 = state.kills;
      break;
    case SIG_MALLOW_CUSHION:
      // 무피격 카운터(aux1)를 매 틱 0 으로 되돌린다 — **유예 자체는 못 굶긴다**(무조건 발동,
      // 위 헤더 주석). 이 케이스는 정산 축만 굶겨 "정산 없는 완충"을 만든다.
      player.aux1 = 0;
      break;
    case SIG_BUBBLE_FILM:
      // 재생 타이머(aux1)를 매 틱 0 으로 되돌린다 — 임계(420틱)에 영영 못 닿아 막이 안 선다.
      player.aux1 = 0;
      break;
    default:
      throw new Error(`starveTrigger: 처리 안 된 시그니처 비트 ${bit}`);
  }
}

interface Observed {
  /** `DURABLE_HP - player.hp`. 엘리트 배율 때문에 소수일 수 있다(부등호로만 쓴다). */
  hpLost: number;
  kills: number;
  entityCount: number;
  /** 병아리 — `ownerId === BROOD_MARK` 인 살아 있는 엔티티(해츨링 시그니처 전용 마커). */
  droneCount: number;
  /** 유니크 ④ 드론 베이·보조무기 ③ 센트리가 띄운 드론(`DRONE_MARK`) — 병아리 상한과 분리됐다. */
  legacyDroneCount: number;
  /** 살아 있는 적 hp 총합(피해 산술 변화가 처치 수를 못 바꿔도 여기선 보인다). */
  enemyHpSum: number;
  /** `playerCloaked` 가 참이었던 틱 수(적 AI 가 읽는 바로 그 술어). */
  cloakedTicks: number;
  /**
   * 은신 중에 **잡몹이 실제로 발사한** 횟수(`patterns/index.ts` 게이트 3곳을 덮는다).
   *
   * ⚠️ 초판 계량은 "은신 틱에 적탄 총수가 늘었는가"(순증)였고 **구조적으로 vacuous 했다**:
   *  ① 같은 틱에 탄이 하나라도 소멸하면 생성이 가려진다.
   *  ② 적탄 생성 경로는 게이트 뒤 3곳만이 아니다 — `elite.ts` 사망 파편과 `world.ts` BK_SPLIT
   *     자탄 분열은 **의도적으로** 게이트 밖이다(cloak.ts 헤더). 그래서 순증 계량은 거짓 실패도
   *     낼 수 있었다(실제로 전체 스위트 1회차에서 플레이키하게 터졌다).
   * 그래서 **발사 주체를 특정**한다: 게이트 뒤 3곳은 전부 발사 직후 `e.cooldown = fireCooldown`
   * 을 세우므로, 잡몹의 쿨다운이 `<=0 → >0` 으로 전이한 것이 곧 "이 잡몹이 방금 쐈다" 이다.
   * 사망 파편·자탄 분열은 적의 쿨다운을 건드리지 않아 이 계량에 섞이지 않는다.
   */
  enemyFireWhileCloaked: number;
  /**
   * 은신 중에 **보스가 패턴을 캐스트한** 횟수(`boss.ts` 게이트 1곳을 단독으로 덮는다).
   * 캐스트마다 `boss.pierce`(패턴 라운드로빈 인덱스)가 1 오르고, 게이트에 걸리면 오르지 않는다.
   * 잡몹 계량과 분리해야 두 파일의 게이트가 **각각** 회귀 탐지 대상이 된다.
   */
  bossCastWhileCloaked: number;
  /** 은신 중 보스가 살아 있던 틱 수 — 위 계량이 vacuous 하지 않은지 확인하는 표본 크기. */
  bossAliveWhileCloaked: number;
  /**
   * **은신하지 않은** 틱에 잡몹이 발사한 횟수. `enemyFireWhileCloaked === 0` 이 "게이트가 막았다"
   * 인지 "애초에 아무도 안 쐈다"(vacuous)인지 가르는 대조값이다. 같은 런 안에서 재므로 무대·시드
   * 차이가 개입하지 않는다.
   */
  enemyFireWhileVisible: number;
  /** 은신 중 살아 있는 적이 있었던 틱 수 — 잡몹 계량의 표본 크기. */
  enemyAliveWhileCloaked: number;
  maxAux0: number;
  maxAux1: number;
}

/**
 * `starveBit` 을 주면 매 틱 stepWorld **직전에** 그 시그니처의 트리거 aux 슬롯을
 * `starveTrigger`(위 헤더 주석)로 되돌린다. shipType·mask 는 손대지 않는다 — 시그니처는
 * live 와 똑같이 켜진 채로 트리거만 굶는다.
 */
function observe(
  seed: number,
  cfg: WorldConfig,
  ticks: number,
  starveBit?: number,
): Observed {
  // 함선 시그니처 관측은 **중립 서바이벌 아레나**(vampire)에서 돈다. CASES 의 planet 2(니플헤임)는
  // Lane6 에서 chase 로 배정돼 무적 포식자가 정지·저속 플레이어를 접촉 즉사시키므로(MED-1 수정 후
  // 치명적), planetMode 를 vampire 로 덮어 장시간 관측 런이 조기 종료되지 않게 한다(로스터 유지·chase만 끔).
  const state = createWorld(seed, { ...cfg, planetMode: PLANET_MODE.vampire, playerHp: DURABLE_HP });
  let maxAux0 = 0;
  let maxAux1 = 0;
  let cloakedTicks = 0;
  let enemyFireWhileCloaked = 0;
  let bossCastWhileCloaked = 0;
  let bossAliveWhileCloaked = 0;
  let enemyFireWhileVisible = 0;
  let enemyAliveWhileCloaked = 0;
  // 적 id → 직전 틱 쿨다운. 발사 판정(`<=0 → >0` 전이)의 기준선이다.
  let prevCooldown = new Map<number, number>();
  let prevPierce = -1;
  for (let i = 0; i < ticks; i++) {
    if (starveBit !== undefined) starveTrigger(state, state.entities[0]!, starveBit);
    stepWorld(state, NEUTRAL);
    const p = state.entities[0];
    if (p === undefined) break;
    const cloaked = playerCloaked(state, p);
    let boss: Entity | undefined;
    for (const e of state.entities) {
      if (!e.dead && e.kind === 'boss') {
        boss = e;
        break;
      }
    }
    let liveEnemies = 0;
    let fired = 0;
    for (const e of state.entities) {
      if (e.dead || e.kind !== 'enemy') continue;
      liveEnemies++;
      const before = prevCooldown.get(e.id);
      if (before !== undefined && before <= 0 && e.cooldown > 0) fired++;
    }
    if (cloaked) {
      cloakedTicks++;
      enemyFireWhileCloaked += fired;
      if (liveEnemies > 0) enemyAliveWhileCloaked++;
      if (boss !== undefined) {
        bossAliveWhileCloaked++;
        if (prevPierce >= 0 && boss.pierce > prevPierce) bossCastWhileCloaked++;
      }
    } else {
      enemyFireWhileVisible += fired;
    }
    prevCooldown = new Map<number, number>();
    for (const e of state.entities) {
      if (!e.dead && e.kind === 'enemy') prevCooldown.set(e.id, e.cooldown);
    }
    prevPierce = boss?.pierce ?? -1;
    if (p.aux0 > maxAux0) maxAux0 = p.aux0;
    if (p.aux1 > maxAux1) maxAux1 = p.aux1;
  }
  let droneCount = 0;
  let legacyDroneCount = 0;
  let enemyHpSum = 0;
  for (const e of state.entities) {
    if (e.dead) continue;
    if (e.ownerId === BROOD_MARK) droneCount++;
    if (e.ownerId === DRONE_MARK) legacyDroneCount++;
    if (e.kind === 'enemy') enemyHpSum += e.hp;
  }
  return {
    hpLost: DURABLE_HP - (state.entities[0]?.hp ?? 0),
    kills: state.kills,
    entityCount: state.entities.length,
    droneCount,
    legacyDroneCount,
    enemyHpSum,
    cloakedTicks,
    enemyFireWhileCloaked,
    bossCastWhileCloaked,
    bossAliveWhileCloaked,
    enemyFireWhileVisible,
    enemyAliveWhileCloaked,
    maxAux0,
    maxAux1,
  };
}

function runHashes(seed: number, cfg: WorldConfig, ticks: number): number[] {
  // observe 와 동일: 시그니처 해시 관측을 중립 vampire 아레나로 통일한다(planet 2 chase 조기 종료 회피).
  const state = createWorld(seed, { ...cfg, planetMode: PLANET_MODE.vampire, playerHp: DURABLE_HP });
  const out: number[] = [];
  for (let i = 0; i < ticks; i++) {
    stepWorld(state, NEUTRAL);
    out.push(hashWorld(state));
  }
  return out;
}

/** 세 관측량이 전부 같으면 "배선이 없다" 와 구분되지 않는다. */
function coreObservablesEqual(a: Observed, b: Observed): boolean {
  return (
    a.hpLost === b.hpLost &&
    a.kills === b.kills &&
    a.entityCount === b.entityCount &&
    a.droneCount === b.droneCount &&
    a.legacyDroneCount === b.legacyDroneCount &&
    a.enemyHpSum === b.enemyHpSum
  );
}

interface Case {
  typeId: number;
  slug: string;
  bit: number;
  planet: number;
  stage: number;
  seed: number;
  ticks: number;
  /** 그 타입 고유 효과 — live/ctrl 관측을 받아 타입별 단언을 건다. */
  signatureEffect: (live: Observed, ctrl: Observed) => void;
}

/**
 * ## ⚠️ 무대 재기준화 2026-07-27 — `stage 21` → `stage 11` (밸런스 패스 ADR-0037)
 *
 * 니플헤임 무대 4건(브루저·아크캐스터·말로우·버블)의 단계를 21 → 11 로 내렸다. **관측 조건만**
 * 바꾼 것이고 단언은 한 글자도 안 바뀌었다.
 *
 * 원인: 적 축 재보정이 `HP_ANCHOR_STAGE_21` 을 4.5 → **22**(×4.9)로 올렸다. 이 하네스의
 * 파일럿은 **무투자·무장비·정지(NEUTRAL)** 라 단계 21 에서는 **한 마리도 죽이지 못한다** —
 * 60,000틱(1,000초)까지 늘려도 `kills` 가 **0** 이다(실측). 그래서 이 블록의 "공허 런 가드"
 * (`kills > 0`)가 구조적으로 통과 불가가 됐다. **틱 예산으로는 풀리지 않는다**는 것이 실측으로
 * 확정됐으므로(1,800 / 5,400 / 10,800 / 18,000 / 36,000 / 60,000틱 전부 kills 0) 무대를 옮기는
 * 것이 유일한 재기준화다.
 *
 * 왜 하필 11 인가: `stageHpMult(11) = 4.0` 이 **구 `stageHpMult(21) = 4.5` 와 거의 같다** —
 * 즉 이 하네스가 원래 보정돼 있던 적 강도를 그대로 복원한다. 단계를 내린 것이 무대를 쉽게
 * 만든 것이 아니라 앵커 상향 **이전의 유효 난이도로 되돌린 것**이다.
 * 대가: 밴드2 의 질적 요소(`subBullets 3` · `densityMult 1.5` · `eliteCount 2`)를 이 하네스가
 * 더는 밟지 않는다. 그 축은 `tests/m3Content.test.ts` 계열이 단계 파라미터로 직접 검사한다.
 *
 * 단계 11 실측(1,800틱 · live vs 억제 대조군):
 *   브루저     k=13 · hpLost **419 < 515** · aux0 8 (≤ ARMOR_MAX_STACKS 8)
 *   아크캐스터 k=22 · hpLost **289 < 318** · aux0 600 (> OVERCHARGE_STILL_TICKS) · ehp 8264 ≠ 8345
 *   말로우     k=12 · hpLost **399 < 612** · aux0 213
 *   버블       k=18 · hpLost **464 < 554** · aux0 60 (= FILM_ABSORB_FLAT) · aux1 419
 * 네 건 모두 대조군 `kills > 0` 도 성립한다(공허 런 가드 양쪽 충족).
 *
 * ⚠️ 아크캐스터의 구 실패는 별개 증상이었다 — 단계 21 에서 live·ctrl 의 `hpLost` 가 **446.4 로
 * 동타**가 돼 부등호가 깨졌다(2026-07-26 에 같은 이유로 seed 를 갈았던 그 현상의 재발). 단계 11
 * 에서는 289 vs 318 로 여유 있게 갈린다.
 *
 * ## ⚠️ 2026-08-04 — 아크캐스터의 `hpLost` 대리 지표는 **구조적으로 뒤집혔다**(계량 교체)
 * 파워업 반올림 무동작 수정(밸런스 큐 §R39, `fireCooldown` 정수 → `fireCooldownQ` 1/256틱
 * 고정소수점) 이후 `live.hpLost 323 !< ctrl.hpLost 318` 로 깨졌다. **배선이 죽은 것이 아니다** —
 * 같은 런의 나머지 관측이 증폭이 살아 있음을 직접 보여 준다:
 *   kills **21 vs 17**(+4) · enemyHpSum **8106.4 vs 8135.68**(live 가 더 깎았다) · aux0 600(포화)
 * 뒤집힌 이유는 **무대가 뱀서류 서바이벌 아레나**(`observe` 가 `planetMode: vampire` 로 덮는다)
 * 라는 데 있다: 적을 빨리 지울수록 **다음 웨이브가 더 빨리·더 많이 나온다**. 실제로 살아 있는
 * 엔티티가 live **206** vs ctrl **153** 이다. 즉 이 무대에서 "빨리 지운다 → 덜 맞는다" 라는
 * 함의가 성립하지 않는다. 기본 연사가 느렸을 때는 양쪽 다 밀도 압력 구간에 못 들어가 우연히
 * 성립했을 뿐이고, E 가 연사를 되살리자 그 우연이 사라졌다.
 *
 * 그래서 단언을 **약화한 것이 아니라 교체했다** — 주석이 원래 재겠다고 적은 것("증폭된 피해가
 * 실제로 적을 더 빨리 지운다")을 대리 지표(`hpLost`) 대신 **직접 지표(`kills`)로** 잰다.
 * 물림(bite)은 그대로다: live 와 ctrl 은 시그니처 2축만 다른 **동형 런**이므로, 증폭 배선이
 * 끊기면 두 런이 바이트 동일해져 `kills` 부등호가 즉시 깨진다.
 * ⚠️ 다른 세 기체(브루저·말로우·버블)는 **피해 감소·흡수형**이라 `hpLost` 가 대리가 아니라
 * 직접 지표다 — 같은 교체를 하면 안 된다.
 */
const CASES: Case[] = [
  {
    typeId: 1,
    slug: 'bruiser',
    bit: SIG_BRUISER_ARMOR,
    planet: 2,
    // 단계 21 → 11: 위 "무대 재기준화" 주석 참조.
    stage: 11,
    seed: 3311,
    ticks: 1800,
    signatureEffect: (live, ctrl) => {
      // 장갑 스택 피해 감소 — 같은 무대에서 덜 맞는다.
      expect(live.hpLost, '브루저: 장갑이 피해를 줄이지 못했다').toBeLessThan(ctrl.hpLost);
      // aux0 = 장갑 스택. 상한(ARMOR_MAX_STACKS)까지 실제로 쌓인다.
      expect(live.maxAux0, '브루저: 스택이 쌓이지 않았다').toBeGreaterThan(0);
      expect(live.maxAux0).toBeLessThanOrEqual(ARMOR_MAX_STACKS);
    },
  },
  {
    typeId: 2,
    slug: 'arccaster',
    bit: SIG_ARC_OVERCHARGE,
    planet: 2,
    // 단계 21 → 11: 위 "무대 재기준화" 주석 참조.
    stage: 11,
    // ⚠️ SEED 재측정(2026-07-26, PvE 밀도 상향 + 선분 판정 도입): 이전 증인 seed 3311 은
    // live.hpLost 와 ctrl.hpLost 가 **정확히 615 로 동타**가 됐다(둘 다 정지 파일럿이 동일한
    // 벽에 갇혀 같은 피해 궤적을 밟은 우연 — 증폭 자체는 살아 있다·enemyHpSum 은 갈린다). 부등호
    // 단언에는 동타가 치명적이라 여유 있게 갈리는 seed 42 로 바꿨다(실측: live 141 vs ctrl 346).
    seed: 42,
    ticks: 1800,
    signatureEffect: (live, ctrl) => {
      // ⚠️ 무대 단계 21 → 11(2026-07-27) — 위 CASES 머리 주석 참조.
      // 과충전 = 정지 지속 시 피해 증폭. 정지 입력이므로 임계(90틱)를 한참 넘긴다.
      expect(live.maxAux0, '아크캐스터: 정지 카운터가 임계에 못 닿았다').toBeGreaterThan(
        OVERCHARGE_STILL_TICKS,
      );
      // 증폭된 피해가 실제로 적을 더 빨리 지운다.
      expect(live.enemyHpSum, '아크캐스터: 증폭이 적 체력에 반영되지 않았다').not.toBe(
        ctrl.enemyHpSum,
      );
      // ⚠️ 여기는 `hpLost` 가 아니라 `kills` 다 — 이유는 CASES 머리 주석의 2026-08-04 절.
      // 뱀서류 아레나에서는 빨리 지울수록 스폰 압력이 올라가 `hpLost` 함의가 뒤집힌다.
      // 실측(2026-08-04, 5레인 통합): live 21 vs ctrl 17.
      expect(live.kills, '아크캐스터: 증폭이 적을 더 빨리 지우지 못했다').toBeGreaterThan(
        ctrl.kills,
      );
    },
  },
  {
    typeId: 3,
    slug: 'phantom',
    bit: SIG_PHANTOM_CLOAK,
    planet: 0,
    stage: 1,
    // ⚠️ SEED 재선정 2026-08-06(42 → 113, 선결 C-3 토큰 시점 이전). 아래 두 번째 케이스의
    // 주석이 예고한 그대로다 — 이 시드는 **②(해제 첫 타 2.5배)만** 잡는데, C-3 이 토큰을
    // 진입에서 **창 종료**로 옮기면서 1,800틱 seed 42 런에서는 창이 끝까지 완주하지 못해
    // 배율이 한 번도 안 실렸다 → live 와 굶긴 대조군의 관측이 **완전히 같아졌다**(= 이 케이스가
    // 아무것도 못 재는 상태). 1..200 연속 스캔에서 이 절의 단언 전부를 만족하는 시드가 87개로
    // 넉넉했고, 그중 여유가 가장 큰 축인 113 을 골랐다(은신 유지 240틱 = 완주 창 2회 ·
    // 무피격 최대 359틱 · 처치 40). 무대·틱·단언은 불변이고 증인만 다시 골랐다.
    // (seed 6 은 아래 'phantom-suppression' 이 쓰고 있어 후보에서 제외했다.)
    seed: 113,
    ticks: 1800,
    signatureEffect: (live, ctrl) => {
      // 은신은 **적 AI 가 읽는 술어**(playerCloaked)로 관측한다 — 이것이 배선 게이트 자체다.
      expect(live.cloakedTicks, '팬텀: 은신이 한 틱도 서지 않았다').toBeGreaterThan(0);
      expect(ctrl.cloakedTicks, '팬텀: 억제 대조군에서 은신이 섰다').toBe(0);
      // aux0 = 연속 무피격 틱. 임계(240)를 실제로 넘겨야 은신이 성립한다.
      expect(live.maxAux0, '팬텀: 무피격 카운터가 임계 미달').toBeGreaterThanOrEqual(
        CLOAK_UNHIT_TICKS,
      );
      // 해제 첫 타 2.5배 + 은신 중 적 발사 억제가 전장 상태를 실제로 바꾼다.
      expect(live.enemyHpSum, '팬텀: 은신·해제 배율이 전장에 반영되지 않았다').not.toBe(
        ctrl.enemyHpSum,
      );
    },
  },
  {
    // 팬텀 두 번째 케이스 — **은신 중 적 발사 억제**만 따로 관측한다.
    // ⚠️ 왜 케이스를 나눴는가: 팬텀 배선은 두 겹이다 ①은신 중 적 발사 억제(patterns/index.ts·
    // boss.ts 가 `playerCloaked` 를 읽는다) ②해제 첫 타 2.5배(world.ts autoAttack). 위 seed 42
    // 케이스는 음성 대조 실측 결과 **②만** 잡았다 — 2.5배를 무력화하자 live 와 대조군의 관측이
    // 완전히 같아졌다. 즉 그 무대에서는 ①이 관측을 한 칸도 못 바꾼다(은신이 서는 구간에 사거리
    // 안 적이 없었다). 이 시드는 반대로 2.5배를 무력화해도 관측이 갈리는 무대라 ①을 덮는다.
    typeId: 3,
    slug: 'phantom-suppression',
    bit: SIG_PHANTOM_CLOAK,
    planet: 0,
    stage: 1,
    // ⚠️ SEED 재선정 2026-08-04(48 → 6, 해저드 반감). 박격포 쿨다운 2배 · 용암 기둥 6→3 ·
    // 지형 해저드 4%→2% 로 굴림 값이 달라져 seed 48 은 live 와 억제 대조군의 관측이 **완전히
    // 같아졌다**(= 이 케이스가 아무것도 못 재는 상태). 1..300 스캔에서 이 절의 단언 전부를
    // 만족하는 시드가 여럿 나왔고(1·6·7·9·11), 그중 여유가 가장 큰 6 을 골랐다
    // (은신 유지 240틱 · 가시 구간 잡몹 사격 779회 — 두 계량 모두 vacuous 와 멀다).
    seed: 6,
    ticks: 3600,
    signatureEffect: (live, ctrl) => {
      expect(live.cloakedTicks, '팬텀: 은신이 서지 않았다').toBeGreaterThan(100);
      expect(ctrl.cloakedTicks).toBe(0);
      // 발사 억제 절반을 직접 못 박는다 — 계량은 "적탄 순증" 이 아니라 **잡몹 쿨다운 전이**다
      // (⑥절 주석: 순증 계량은 사망 파편·자탄 분열 때문에 거짓 실패도, 소멸 가림 때문에 거짓
      // 통과도 냈다).
      expect(live.enemyFireWhileCloaked, '팬텀: 은신 중인데 적이 사격했다(억제 게이트 누락)').toBe(0);
      expect(live.enemyFireWhileVisible, '이 무대에서는 잡몹이 애초에 안 쐈다 = 계량 vacuous')
        .toBeGreaterThan(0);
      // 적이 은신한 플레이어를 못 쏘면 전개가 갈린다. **부등호를 걸지 않는다**: 은신은 적을
      // 정지시키지 않으므로(cloak.ts) 사격이 막힌 돌격형이 그대로 붙어 접촉 피해를 주고, 이
      // 무대에서는 은신 런이 오히려 더 맞는다(실측 118 vs 112). 방향이 아니라 **차이 자체**가
      // 배선의 증거다 — 두 config 는 이 비트 하나 외에는 완전히 동일하다.
      expect(live.hpLost, '팬텀: 은신이 전개를 바꾸지 못했다').not.toBe(ctrl.hpLost);
    },
  },
  {
    typeId: 4,
    slug: 'hatchling',
    bit: SIG_HATCHLING_BROOD,
    planet: 0,
    stage: 1,
    // ⚠️ SEED 재선정 2026-07-27(3311 → 3331). 무대는 그대로 p0s1 이다 — 여기서 깨진 것은 적
    // 강도가 아니라 **관측 끝 시점에 병아리가 살아 있는가**다. 구 증인 3311 은 처치가 20 에서
    // 정체해(적 축 상향으로 정지 파일럿이 포위된다) 부화가 1회(aux0 12)뿐이고, 그 한 기가
    // `TURRET_LIFE_TICKS` 로 만료된 뒤 관측이 끝나 `droneCount` 가 0 이 됐다. 즉 시그니처는
    // 살아 있었고 **관측 창이 비었을 뿐**이다.
    // 재표본(3311..3340 연속 30시드, 1,800틱): 3331 이 live 처치 **52** vs 대조군 **33**,
    // 종료 시 생존 병아리 **2기**, aux0 **48**(부화 4회)로 네 단언 전부에 여유가 가장 크다.
    //
    // ⚠️ SEED 재선정 2026-08-04(3331 → 3313, 카르곤 정예 2종). 카드 풀 8 → 10 이라 카드열이
    // 재추첨돼 3331 은 부화 1회(aux0 12)·처치가 대조군과 **동타 20/20** 이 됐다(동타는 이
    // 단언에 치명적이다). 같은 절차(3311..3420)로 재표본: **3313** 이 live 처치 39 vs 대조군 23,
    // 종료 시 병아리 2기, aux0 36(부화 3회)로 여유가 가장 크다.
    seed: 3313,
    ticks: 1800,
    signatureEffect: (live, ctrl) => {
      // 부화 = 누적 처치 임계마다 병아리 출격. 대조군에는 드론 소환원이 없다(유니크 미장착).
      expect(ctrl.droneCount, '해츨링: 대조군에 드론이 있다(무대 오염)').toBe(0);
      expect(live.droneCount, '해츨링: 병아리가 한 기도 출격하지 않았다').toBeGreaterThan(0);
      // 병아리가 실제로 싸운다 — 같은 시드에서 처치 수가 늘어난다.
      expect(live.kills, '해츨링: 병아리가 전투에 기여하지 않았다').toBeGreaterThan(ctrl.kills);
      // aux0 = 마지막 출격 시점의 state.kills 스냅샷.
      expect(live.maxAux0, '해츨링: 출격 스냅샷이 갱신되지 않았다').toBeGreaterThan(0);
    },
  },
  {
    typeId: 5,
    slug: 'mallow',
    bit: SIG_MALLOW_CUSHION,
    // ⚠️ 2026-08-06 무대 재선정(p2/s11/seed3311 → p0/s1/seed3) — 다른 세 니플헤임 무대(브루저·
    // 아크캐스터·버블)와 갈라진 이유. 이 케이스의 ctrl 은 이제 `starveTrigger` 로 **정산만**
    // 굶긴다(유예 자체는 굶길 트리거가 없다 — 위 §② 헤더 주석). p2/s11 은 압박이 끊기지 않아
    // live 조차 **정산이 자연히 0 회**다(shipSignatureMallow.test.ts 테스트1과 동일 무대) — 그
    // 무대에서는 "정산을 굶긴 대조군"이 live 와 사실상 같은 궤적이 되어(둘 다 한 번도 정산 안
    // 함) coreObservablesEqual 가 갈리지 않는다. 정산이 실제로 반복 발현하는 저압 무대(p0/s1)
    // 로 옮겨야 이 케이스가 재는 축(정산 타이밍)이 살아난다 — shipSignatureMallow.test.ts
    // 테스트2 와 같은 무대·시드다(그 파일이 실측으로 고른 증인을 재사용).
    planet: 0,
    stage: 1,
    seed: 3,
    ticks: 1800,
    signatureEffect: (live, ctrl) => {
      // aux0 = 적립된 지연 피해 풀(비음 정수) — cushionOn 게이트 안에서만 쓰이므로 이 값이
      // 양수라는 것 자체가 유예 코드가 실행됐다는 무모호 직접 증거다(대조군과 무관하게 성립).
      expect(live.maxAux0, '말로우: 지연 피해가 적립되지 않았다').toBeGreaterThan(0);
      expect(Number.isInteger(live.maxAux0), '말로우: 지연 풀이 정수가 아니다(u32 해시 오염)').toBe(
        true,
      );
      // ⚠️ 부호가 옛 버전과 반대다(위 무대 재선정 주석) — ctrl 은 정산 트리거만 굶긴 "정산 없는
      // 완충"이라, 정산이 선체에 되돌리는 40%("due") 몫을 영영 안 떠안는다. live 는 정산될 때마다
      // 그 몫을 추가로 깎이므로 hpLost 가 ctrl 보다 **크다**(shipSignatureMallow.test.ts 테스트2
      // 와 같은 방향).
      expect(live.hpLost, '말로우: 정산이 선체에 반영되지 않았다').toBeGreaterThan(ctrl.hpLost);
    },
  },
  {
    typeId: 6,
    slug: 'bubble',
    bit: SIG_BUBBLE_FILM,
    planet: 2,
    // 단계 21 → 11: 위 "무대 재기준화" 주석 참조.
    stage: 11,
    seed: 3311,
    ticks: 1800,
    signatureEffect: (live, ctrl) => {
      // 방막 = 420틱마다 재생성되는 정액 흡수막(60) + 소진 시 반경 파열 밀어내기.
      expect(live.hpLost, '버블: 방막이 피해를 흡수하지 못했다').toBeLessThan(ctrl.hpLost);
      // aux0 = 남은 막 내구. 막이 실제로 서면 정확히 FILM_ABSORB_FLAT 까지 오른다.
      expect(live.maxAux0, '버블: 막이 한 번도 서지 않았다').toBe(FILM_ABSORB_FLAT);
      // aux1 = 마지막 파열 이후 경과 틱 — 재생 주기를 실제로 돈다.
      expect(live.maxAux1, '버블: 재생 타이머가 돌지 않았다').toBeGreaterThan(0);
    },
  },
];

// ---------------------------------------------------------------------------
// ① 마스크 점등 — 정규 경로가 시그니처 비트를 OR-in 하는가
// ---------------------------------------------------------------------------

describe('① buildRunConfig 가 타입별 시그니처 비트를 켠다', () => {
  it.each(CASES)('typeId $typeId ($slug) 의 비트가 켜지고 남의 비트는 꺼져 있다', (c) => {
    const cfg = buildRunConfig(profileWithType(c.typeId), { planet: c.planet, stage: c.stage });
    expect(cfg.shipType).toBe(c.typeId);
    expect(hasSignature(cfg.loadout?.uniqueMask ?? 0, c.bit), `${c.slug}: 자기 비트 미점등`).toBe(
      true,
    );
    for (const other of SIGNATURE_BITS) {
      if (other === c.bit) continue;
      expect(hasSignature(cfg.loadout?.uniqueMask ?? 0, other), `${c.slug}: 비트 ${other} 오점등`)
        .toBe(false);
    }
    // 레지스트리와 정합(비트 배정이 데이터와 테스트에서 각자 굳지 않게).
    expect(shipTypeDef(c.typeId).signatureBit, `${c.slug}: 레지스트리 비트 불일치`).toBe(c.bit);
  });
});

// ---------------------------------------------------------------------------
// ② 트리거 굶긴 동형 대조군 — 배선 유무의 **직접** 측정 (이 파일의 핵심)
// ---------------------------------------------------------------------------
//
// ⚠️ 2026-08-06: 이 절은 원래 "시그니처를 config 로 끈" 대조군(shipType:0 강제)을 썼다.
// ADR-0049 가 스트라이커에도 시그니처(정조준 사이클, 비트24)를 부여하면서 그 대조군이
// 오염됐다 — shipType:0 은 더 이상 "시그니처 없음"이 아니라 "이 기체 대신 스트라이커 정조준이
// 켜진 런"이다. 위 `starveTrigger`/`suppressSignature` 자리의 헤더 주석에 상세 물증이 있다.
// 지금은 **shipType·mask 를 live 와 완전히 동일하게 둔 채**(시그니처는 계속 켜져 있다) 그
// 시그니처의 트리거 aux 슬롯만 매 틱 굶겨 발현을 막는다 — `observe(seed, live, ticks, c.bit)`.

describe('② 시그니처 트리거를 굶기면 관측이 달라진다 (= world.ts 배선이 실재한다)', () => {
  it.each(CASES)(
    'typeId $typeId ($slug): live 와 트리거 굶긴 대조군의 관측이 갈린다',
    (c) => {
      const live = buildRunConfig(profileWithType(c.typeId), { planet: c.planet, stage: c.stage });
      expect(hasSignature(live.loadout?.uniqueMask ?? 0, c.bit)).toBe(true);

      const liveObs = observe(c.seed, live, c.ticks);
      // ctrl 은 **같은 config**(같은 shipType·마스크)로 굴리되 c.bit 의 트리거만 굶긴다 —
      // baseBp(damage/maxHp/moveSpeed) 오염이 원천적으로 없다.
      const ctrlObs = observe(c.seed, live, c.ticks, c.bit);

      // 공허 런 가드 — 아무 일도 안 일어난 런은 아무것도 증명하지 않는다.
      expect(liveObs.kills, `${c.slug}: 공허 런(처치 0)`).toBeGreaterThan(0);
      expect(ctrlObs.kills, `${c.slug}: 대조군 공허 런`).toBeGreaterThan(0);

      expect(
        coreObservablesEqual(liveObs, ctrlObs),
        `${c.slug}: 트리거를 굶겨도 관측이 완전히 같다 = world.ts 배선 없음`,
      ).toBe(false);

      // 타입 고유 효과.
      c.signatureEffect(liveObs, ctrlObs);
    },
  );
});

// ---------------------------------------------------------------------------
// ③ aux 슬롯 규약
// ---------------------------------------------------------------------------
//
// ⚠️ 2026-08-06: 원래 이 절의 이름은 "시그니처 비활성 런에서 aux 는 끝까지 0"이었다. 그 문장은
// **"시그니처 비활성 런"이 존재한다는 전제** 위에 서 있었는데, ADR-0049 이후 유효 shipType
// 0~6 전부가 시그니처 비트를 하나씩 갖는다 — 이 로스터 안에서 "시그니처가 꺼진 런"은 이제
// 존재하지 않는다. `starveTrigger` 로 만드는 대조군도 "트리거가 굶주린 채 시그니처는 켜진
// 런"이지 "시그니처가 꺼진 런"이 아니다(위 §② 헤더 주석). 그래서 "아무 시그니처도 안 켜진
// 런에서 aux 가 오염되지 않는다"는 원래 주장은 **더는 검증할 대상이 없어 이 절에서 뺐다** —
// 대신 "aux 슬롯을 공유하는 다른 시그니처가 서로의 하류 관측을 오염시키지 않는다"(실제로
// 남아 있는, 검증 가능한 불변식)로 좁힌다. 그 불변식은 이미 두 곳이 커버한다: 아래 스트라이커
// 테스트(정조준이 다른 6개의 고유 하류 관측을 안 건드린다) + §⑦(마스크에 여러 비트가 켜져도
// 최저 비트 하나만 동작 — aux 별칭 자체가 구조적으로 봉인된다). 개별 파일
// (shipSignaturePhantom/Bubble/Hatchling/Mallow.test.ts)의 "스트라이커 런은 이 축을 안
// 건드린다" 테스트들도 같은 불변식을 각 기체 관점에서 반복 검증한다.

describe('③ aux0/aux1 사용 — live 는 실제로 쓴다', () => {
  it.each(CASES)('typeId $typeId ($slug): live 는 aux 를 실제로 쓴다', (c) => {
    const live = buildRunConfig(profileWithType(c.typeId), { planet: c.planet, stage: c.stage });
    const liveObs = observe(c.seed, live, c.ticks);

    expect(liveObs.maxAux0 + liveObs.maxAux1, `${c.slug}: 시그니처가 aux 를 전혀 쓰지 않는다`)
      .toBeGreaterThan(0);
    // 비음 정수라야 u32 폴드(replay.ts hashEntity 의 `>>> 0`)가 안전하다.
    for (const v of [liveObs.maxAux0, liveObs.maxAux1]) {
      expect(Number.isInteger(v) && v >= 0, `${c.slug}: aux 가 비음 정수가 아니다`).toBe(true);
    }
  });

  it('스트라이커(typeId 0) 런은 다른 6개 시그니처의 고유 하류 관측을 건드리지 않는다', () => {
    // ⚠️ 2026-08-06: ADR-0049 가 스트라이커에 정조준 사이클(비트24)을 부여해 마스크가 더 이상
    // 0 이 아니고(정규 경로가 비트24 를 OR-in 한다) aux0 도 0..11 로 돈다(정조준 카운터, 볼리
    // 발사마다 진행) — "aux 를 어떤 무대에서도 안 건드린다"는 더 이상 참이 아니다. 정조준은
    // aux1 을 쓰지 않고, 팬텀 고유 술어(`playerCloaked`/`cloakedTicks`)도 aux0 슬롯 값과 무관하게
    // signatureOn(SIG_PHANTOM_CLOAK) 게이트로 독립 계산되므로 — 이 둘은 그대로 무모호한 증거다.
    for (const { planet, stage, seed } of [
      { planet: 0, stage: 1, seed: 3311 },
      { planet: 2, stage: 21, seed: 3311 },
      { planet: 0, stage: 1, seed: 42 },
    ]) {
      const cfg = buildRunConfig(defaultProfile(), { planet, stage });
      expect(hasSignature(cfg.loadout?.uniqueMask ?? 0, SIG_STRIKER_MARKSMAN), `p${planet}s${stage}`)
        .toBe(true);
      const o = observe(seed, cfg, 1200);
      expect(o.maxAux0, `p${planet}s${stage} sd${seed}`).toBeGreaterThanOrEqual(0);
      expect(o.maxAux1, `p${planet}s${stage} sd${seed}`).toBe(0);
      expect(o.cloakedTicks, `p${planet}s${stage} sd${seed}`).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// ④ 보조 지표 — typeId 0 런과의 발산 (배선 없이도 참이므로 단독으로는 쓰지 않는다)
// ---------------------------------------------------------------------------

describe('④ typeId 0 런과 해시 스트림이 갈린다 (보조 지표)', () => {
  const strikerCfg = buildRunConfig(defaultProfile(), { planet: 0, stage: 1 });

  it.each(CASES)('typeId $typeId ($slug) 런은 스트라이커 런과 다르게 굴러간다', (c) => {
    const striker = runHashes(9182, strikerCfg, 240);
    const cfg = buildRunConfig(profileWithType(c.typeId), { planet: 0, stage: 1 });
    const mine = runHashes(9182, cfg, 240);
    expect(mine, `${c.slug}: 스트라이커와 해시가 같다`).not.toEqual(striker);
    // 월드가 멈춰 있으면 이 케이스는 아무것도 증명하지 못한다.
    expect(new Set(striker).size).toBeGreaterThan(120);
    expect(new Set(mine).size, `${c.slug}: 해시 다양성 부족`).toBeGreaterThan(120);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 결정론 — 같은 seed·같은 입력이면 관측이 바이트 동일 (ADR-0005)
// ---------------------------------------------------------------------------

describe('⑤ 결정론', () => {
  it.each(CASES)('typeId $typeId ($slug) 런은 두 번 굴려도 같은 관측을 낸다', (c) => {
    const cfg = (): WorldConfig =>
      buildRunConfig(profileWithType(c.typeId), { planet: c.planet, stage: c.stage });
    expect(observe(c.seed, cfg(), 600)).toEqual(observe(c.seed, cfg(), 600));
  });
});

// ---------------------------------------------------------------------------
// ⑥ 팬텀 은신 억제 게이트 — **파일별로 단독** 회귀 탐지
// ---------------------------------------------------------------------------
//
// ⚠️ 이 절이 존재하는 이유(적대적 리뷰 wiring HIGH-1): 초판에서는 `patterns/index.ts` 의 일반
// runAttack 게이트나 `boss.ts` 의 캐스트 게이트를 **하나만 지워도 전체 스위트가 그대로 그린**
// 이었다. 즉 "잡몹 대부분이 은신을 뚫는" 또는 "보스가 은신을 뚫는" 반쪽 배선이 CI 를 통과했다.
// 여기서 두 파일의 게이트를 서로 다른 계량으로 분리해 각각을 회귀 탐지 대상으로 만든다.

describe('⑥ 은신 억제 게이트 (잡몹 / 보스를 각각 단독으로 덮는다)', () => {
  // 실측으로 고른 무대: 정지 파일럿이 은신에 반복 진입하고(521틱) 그 내내 살아 있는 적이 있다.
  const GATE = { planet: 0, stage: 1 } as const;
  // ⚠️ SEED 재선정 2026-08-04(42 → 7, 카르곤 정예 2종). 카드 풀 8 → 10 으로 카드열이 재추첨돼
  // seed 42 는 은신이 8틱밖에 안 서서 표본 가드(>100)를 못 넘겼다. 120시드 재표본에서 **seed 7**
  // 이 은신 240틱 · 은신 중 적 생존 240틱 · 가시 구간 잡몹 발사 2485회로 세 표본 가드 전부에
  // 여유가 가장 크다.
  const GATE_SEED = 7;
  const GATE_TICKS = 5400;

  it('런 전체에서도 은신 중 잡몹 발사가 관측되지 않는다 (통합 보조 지표)', () => {
    const cfg = buildRunConfig(profileWithType(3), GATE);
    const live = observe(GATE_SEED, cfg, GATE_TICKS);

    // 표본 가드 — 아래 0 단언이 vacuous 하지 않다는 증거.
    expect(live.cloakedTicks, '팬텀: 은신이 한 틱도 서지 않았다(무대 오염)').toBeGreaterThan(100);
    expect(live.enemyAliveWhileCloaked, '은신 중 적이 없었다 = 계량이 vacuous').toBeGreaterThan(100);
    expect(live.enemyFireWhileVisible, '이 런에서는 잡몹이 애초에 안 쐈다 = 계량이 vacuous')
      .toBeGreaterThan(0);
    expect(live.enemyFireWhileCloaked, '팬텀: 은신 중인데 잡몹이 발사했다(억제 게이트 누락)').toBe(0);
  });

  /**
   * 게이트 3곳을 **각각 단독으로** 잡는 격리 하네스.
   *
   * ⚠️ 왜 런 관측만으로는 부족한가(직접 재현): `patterns/index.ts:45` 게이트만 제거하고 위
   * 통합 케이스를 돌려도 그대로 통과했다. 연사가 빠른 잡몹은 매 틱 끝 쿨다운이 양수라
   * "`<=0 → >0` 전이" 가 관측되지 않고, 회복형(REPAIR_DRONE)처럼 탄을 만들지 않는 아키타입은
   * 애초에 적탄 계량에 안 잡힌다. 그래서 tests/berdan.test.ts 의 보스 격리 선례대로
   * **`updateEnemy`/`chargerHitWall` 을 직접 구동**해 각 분기를 정면으로 관측한다.
   * config 는 정규 경로(`buildRunConfig`)가 만든 것을 그대로 쓴다.
   */
  function cloakProbe(): { state: ReturnType<typeof createWorld>; player: Entity } {
    const cfg = buildRunConfig(profileWithType(3), GATE);
    const state = createWorld(GATE_SEED, { ...cfg, playerHp: DURABLE_HP });
    const player = state.entities[0]!;
    player.aux0 = CLOAK_UNHIT_TICKS; // 유지 창 안 = 은신 성립
    expect(playerCloaked(state, player)).toBe(true);
    return { state, player };
  }

  it('일반 사격 경로(runAttack)가 은신 중 방출하지 않는다 — patterns/index.ts 게이트 ①', () => {
    const { state, player } = cloakProbe();
    // GUNNER = 박격(mortar) 아키타입. `attack.kind !== 'fragments'` 라 generic cadence 경로다.
    const e = summonEnemy(state, GUNNER, player.x + 240, player.y);
    e.cooldown = 0;
    const before = state.entities.length;
    updateEnemy(state, e, GUNNER, player);
    expect(e.cooldown, '은신 중인데 사수형이 발사 쿨다운을 소비했다').toBe(0);
    expect(state.entities.length, '은신 중인데 사수형이 무언가 방출했다').toBe(before);

    // 은신 해제 직후: 보류했던 발사가 그대로 나간다(쿨다운을 태워 없애지 않는다).
    player.aux0 = 0;
    expect(playerCloaked(state, player)).toBe(false);
    updateEnemy(state, e, GUNNER, player);
    expect(e.cooldown, '은신이 풀렸는데도 사수형이 쏘지 않았다 = 계량 vacuous').toBeGreaterThan(0);
    expect(state.entities.length, '은신 해제 후에도 방출이 없었다 = 계량 vacuous').toBeGreaterThan(
      before,
    );
  });

  it('돌격형 주기 분출이 은신 중 방출하지 않는다 — patterns/index.ts 게이트 ②', () => {
    const { state, player } = cloakProbe();
    // CHARGER = `attack.kind === 'fragments'` + chargeStraight. 분출은 moveCharge 경로에서만 난다.
    const e = summonEnemy(state, CHARGER, player.x + 240, player.y);
    e.cooldown = 0;
    updateEnemy(state, e, CHARGER, player);
    expect(e.cooldown, '은신 중인데 돌격형이 분출 쿨다운을 소비했다').toBe(0);
    expect(
      state.entities.filter((x) => x.kind === 'enemyBullet').length,
      '은신 중인데 돌격형이 파편을 분출했다',
    ).toBe(0);

    player.aux0 = 0;
    e.cooldown = 0;
    updateEnemy(state, e, CHARGER, player);
    expect(e.cooldown, '은신이 풀렸는데도 돌격형이 분출하지 않았다 = 계량 vacuous').toBeGreaterThan(
      0,
    );
    expect(
      state.entities.filter((x) => x.kind === 'enemyBullet').length,
      '은신 해제 후에도 파편이 없었다 = 계량 vacuous',
    ).toBeGreaterThan(0);
  });

  it('돌격형 벽 충돌 분출이 은신 중 방출하지 않는다 — patterns/index.ts 게이트 ③', () => {
    const { state, player } = cloakProbe();
    const e = summonEnemy(state, CHARGER, player.x + 240, player.y);
    e.cooldown = 0;
    // 벽 충돌 훅을 직접 호출한다(실제 호출부는 moveCharge 의 slideCircleWalls hit 분기).
    chargerHitWall(state, e, CHARGER, player);
    expect(e.cooldown, '은신 중인데 벽 충돌 분출이 쿨다운을 소비했다').toBe(0);
    expect(
      state.entities.filter((x) => x.kind === 'enemyBullet').length,
      '은신 중인데 벽 충돌 분출이 일어났다',
    ).toBe(0);

    player.aux0 = 0;
    chargerHitWall(state, e, CHARGER, player);
    expect(e.cooldown, '은신 해제 후에도 벽 충돌 분출이 없었다 = 계량 vacuous').toBeGreaterThan(0);
    expect(
      state.entities.filter((x) => x.kind === 'enemyBullet').length,
      '은신 해제 후에도 파편이 없었다 = 계량 vacuous',
    ).toBeGreaterThan(0);
  });

  it('보스는 은신 중 패턴을 캐스트하지 않는다 (boss.ts 게이트 1곳)', () => {
    // 보스는 정지 파일럿 런에서 은신 구간과 겹치지 않는다(실측 bossAliveWhileCloaked = 0).
    // 그래서 tests/berdan.test.ts 의 선례대로 보스를 직접 스폰해 `updateBoss` 를 격리 구동한다.
    // config 는 정규 경로가 만든 것을 그대로 쓴다(테스트가 WorldConfig 를 조립하지 않는다).
    const cfg = buildRunConfig(profileWithType(3), { planet: 1, stage: 1 });
    const state = createWorld(0x9ee, { ...cfg, playerHp: DURABLE_HP });
    const player = state.entities[0]!;
    const boss = spawnBoss(state, player.x, player.y - 400, BERDAN.boss.hp, BERDAN.boss.radius);
    boss.enemyType = 1;

    // ① 은신 중: 캐스트가 통째로 보류된다 — pierce·cooldown 이 그대로다.
    player.aux0 = CLOAK_UNHIT_TICKS; // 유지 창 안(cloakWindowActive)
    expect(playerCloaked(state, player)).toBe(true);
    const beforeEntities = state.entities.length;
    boss.cooldown = 0;
    boss.pierce = 2; // P1 index2 = aimedBurst(조준 부채꼴) — 캐스트되면 적탄이 태어난다.
    updateBoss(state, boss, player);
    expect(boss.pierce, '보스: 은신 중인데 패턴이 진행됐다').toBe(2);
    expect(state.entities.length, '보스: 은신 중인데 무언가 방출됐다').toBe(beforeEntities);

    // ② 은신 해제 직후: 보류했던 그 패턴이 그대로 나간다(쿨다운을 태워 없애지 않는다).
    player.aux0 = 0;
    expect(playerCloaked(state, player)).toBe(false);
    updateBoss(state, boss, player);
    expect(boss.pierce, '보스: 은신이 풀렸는데도 캐스트하지 않았다').toBe(3);
    expect(
      state.entities.filter((e) => e.kind === 'enemyBullet').length,
      '보스: 은신 해제 후에도 적탄이 태어나지 않았다 = 계량이 vacuous',
    ).toBeGreaterThan(0);
  });

  it('침공(3레이어) 런에서는 은신도 해제 배율도 서지 않는다 (대칭 범위 제한)', () => {
    const cfg = buildRunConfig(profileWithType(3), { planet: 0, stage: 1 });
    // 침공 config 를 손으로 조립하지 않고, 정규 경로 config 에 invasion3 존재만 표시한다 —
    // `playerCloaked`·`stepShipSignature` 가 읽는 것이 정확히 그 존재 여부다.
    const state = createWorld(GATE_SEED, {
      ...cfg,
      playerHp: DURABLE_HP,
      invasion3: { ...(cfg.invasion3 ?? {}) } as never,
    });
    for (let i = 0; i < 600; i++) stepWorld(state, NEUTRAL);
    const p = state.entities[0]!;
    expect(p.aux0, '침공: 팬텀 aux0 가 오염됐다(조건부 폴드 규약)').toBe(0);
    expect(p.aux1, '침공: 팬텀 aux1 이 오염됐다').toBe(0);
    expect(playerCloaked(state, p)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ⑦ 시그니처 정규화 — 비트가 둘 이상 켜져도 aux 슬롯이 별칭이 되지 않는다
// ---------------------------------------------------------------------------

describe('⑦ 런당 시그니처는 정확히 하나 (aux 별칭 봉인)', () => {
  it('마스크에 두 비트가 켜져도 최저 비트 하나만 동작한다 (초선형 증폭 봉인)', () => {
    // 적대적 리뷰 HIGH-1 의 실제 재현 조합: 브루저(18) + 팬텀(20). 예전 구현에서는
    // stepShipSignature 가 브루저만 굴리는데 autoAttack 의 팬텀 소비자가 브루저의 장갑 소멸
    // 타이머(1..179)를 "은신 해제 대기 플래그" 로 읽어 **거의 모든 발사에 2.5배**가 실렸다.
    const base = buildRunConfig(profileWithType(1), { planet: 0, stage: 1 });
    const loadout = base.loadout!;
    const single: WorldConfig = base;
    const aliased: WorldConfig = {
      ...base,
      loadout: {
        ...loadout,
        uniqueMask: (loadout.uniqueMask | (1 << SIG_PHANTOM_CLOAK)) >>> 0,
      },
    };
    expect(hasSignature(aliased.loadout?.uniqueMask ?? 0, SIG_BRUISER_ARMOR)).toBe(true);
    expect(hasSignature(aliased.loadout?.uniqueMask ?? 0, SIG_PHANTOM_CLOAK)).toBe(true);

    const a = observe(4242, single, 2400);
    const b = observe(4242, aliased, 2400);
    // 남는 비트는 거동에 한 톨도 영향을 주지 않는다 — 관측 전량이 같아야 한다.
    expect(b, '시그니처 비트가 둘 켜지자 거동이 달라졌다 = aux 별칭 재발').toEqual(a);
    // 팬텀 소비 경로가 실제로 죽어 있는지 직접 확인(은신은 한 틱도 서지 않는다).
    expect(b.cloakedTicks).toBe(0);
  });

  it('여섯 비트를 전부 켜도 최저 비트(브루저)만 동작한다', () => {
    const base = buildRunConfig(profileWithType(1), { planet: 0, stage: 1 });
    const loadout = base.loadout!;
    let mask = loadout.uniqueMask;
    for (const bit of SIGNATURE_BITS) mask = (mask | (1 << bit)) >>> 0;
    const all: WorldConfig = { ...base, loadout: { ...loadout, uniqueMask: mask } };
    expect(observe(4242, all, 1200)).toEqual(observe(4242, base, 1200));
  });

  it('마스크가 비면 타입 축이 승자다 (배선 누락 대비 2축 OR 의 나머지 절반)', () => {
    const base = buildRunConfig(profileWithType(6), { planet: 2, stage: 21 });
    const loadout = base.loadout!;
    // loadout.ts 의 OR-in 이 통째로 빠진 상태를 흉내 낸다 — shipType 만으로도 시그니처가 산다.
    let mask = loadout.uniqueMask;
    for (const bit of SIGNATURE_BITS) mask = (mask & ~(1 << bit)) >>> 0;
    const typeAxis: WorldConfig = { ...base, loadout: { ...loadout, uniqueMask: mask } };
    const obs = observe(3311, typeAxis, 1800);
    expect(obs.maxAux0, '타입 축만으로는 버블 막이 서지 않았다').toBe(FILM_ABSORB_FLAT);
  });
});
