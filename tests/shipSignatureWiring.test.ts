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
import type { InputFrame, WorldConfig } from '../src/sim/world.js';
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
 * 시그니처 억제 동형 대조군 — `signatureOn` 의 2축을 **둘 다** 눌러 끈다. 프로덕션 코드를 한
 * 줄도 건드리지 않고 config 만으로 만든다(테스트가 sim 을 조립하는 것이 아니라, 정규 경로가
 * 만들어 준 config 에서 시그니처 축만 뺀다).
 */
function suppressSignature(cfg: WorldConfig, typeId: number): WorldConfig {
  const bit = shipTypeDef(typeId).signatureBit;
  const loadout = cfg.loadout;
  if (loadout === undefined) throw new Error('정규 경로 config 에 loadout 이 없다');
  return {
    ...cfg,
    shipType: 0, // 축 2: shipTypeDef(0).signatureBit === -1
    loadout: { ...loadout, uniqueMask: (loadout.uniqueMask & ~(1 << bit)) >>> 0 }, // 축 1
  };
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

function observe(seed: number, cfg: WorldConfig, ticks: number): Observed {
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

const CASES: Case[] = [
  {
    typeId: 1,
    slug: 'bruiser',
    bit: SIG_BRUISER_ARMOR,
    planet: 2,
    stage: 21,
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
    stage: 21,
    // ⚠️ SEED 재측정(2026-07-26, PvE 밀도 상향 + 선분 판정 도입): 이전 증인 seed 3311 은
    // live.hpLost 와 ctrl.hpLost 가 **정확히 615 로 동타**가 됐다(둘 다 정지 파일럿이 동일한
    // 벽에 갇혀 같은 피해 궤적을 밟은 우연 — 증폭 자체는 살아 있다·enemyHpSum 은 갈린다). 부등호
    // 단언에는 동타가 치명적이라 여유 있게 갈리는 seed 42 로 바꿨다(실측: live 141 vs ctrl 346).
    seed: 42,
    ticks: 1800,
    signatureEffect: (live, ctrl) => {
      // 과충전 = 정지 지속 시 피해 증폭. 정지 입력이므로 임계(90틱)를 한참 넘긴다.
      expect(live.maxAux0, '아크캐스터: 정지 카운터가 임계에 못 닿았다').toBeGreaterThan(
        OVERCHARGE_STILL_TICKS,
      );
      // 증폭된 피해가 실제로 적을 더 빨리 지운다.
      expect(live.enemyHpSum, '아크캐스터: 증폭이 적 체력에 반영되지 않았다').not.toBe(
        ctrl.enemyHpSum,
      );
      expect(live.hpLost, '아크캐스터: 적을 더 빨리 지우지 못했다').toBeLessThan(ctrl.hpLost);
    },
  },
  {
    typeId: 3,
    slug: 'phantom',
    bit: SIG_PHANTOM_CLOAK,
    planet: 0,
    stage: 1,
    seed: 42,
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
    seed: 48,
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
    seed: 3311,
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
    planet: 2,
    stage: 21,
    seed: 3311,
    ticks: 1800,
    signatureEffect: (live, ctrl) => {
      // 완충 = 피해의 35% 를 지연시키고 무피격 180틱을 채우면 60% 를 지운다 → 순 경감.
      expect(live.hpLost, '말로우: 완충이 피해를 줄이지 못했다').toBeLessThan(ctrl.hpLost);
      // aux0 = 적립된 지연 피해 풀(비음 정수). 압박이 끊기지 않는 무대라 풀이 남는다.
      expect(live.maxAux0, '말로우: 지연 피해가 적립되지 않았다').toBeGreaterThan(0);
      expect(Number.isInteger(live.maxAux0), '말로우: 지연 풀이 정수가 아니다(u32 해시 오염)').toBe(
        true,
      );
    },
  },
  {
    typeId: 6,
    slug: 'bubble',
    bit: SIG_BUBBLE_FILM,
    planet: 2,
    stage: 21,
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
// ② 억제 동형 대조군 — 배선 유무의 **직접** 측정 (이 파일의 핵심)
// ---------------------------------------------------------------------------

describe('② 시그니처를 끄면 관측이 달라진다 (= world.ts 배선이 실재한다)', () => {
  it.each(CASES)(
    'typeId $typeId ($slug): live 와 시그니처 억제 대조군의 관측이 갈린다',
    (c) => {
      const live = buildRunConfig(profileWithType(c.typeId), { planet: c.planet, stage: c.stage });
      const ctrl = suppressSignature(live, c.typeId);

      // 대조군은 시그니처 축만 다르다 — 나머지 파생 스탯(baseBp·트리)은 그대로다.
      expect(ctrl.loadout?.damageMult).toBe(live.loadout?.damageMult);
      expect(ctrl.loadout?.maxHpAdd).toBe(live.loadout?.maxHpAdd);
      expect(hasSignature(ctrl.loadout?.uniqueMask ?? 0, c.bit)).toBe(false);
      expect(shipTypeDef(ctrl.shipType ?? 0).signatureBit).not.toBe(c.bit);

      const liveObs = observe(c.seed, live, c.ticks);
      const ctrlObs = observe(c.seed, ctrl, c.ticks);

      // 공허 런 가드 — 아무 일도 안 일어난 런은 아무것도 증명하지 않는다.
      expect(liveObs.kills, `${c.slug}: 공허 런(처치 0)`).toBeGreaterThan(0);
      expect(ctrlObs.kills, `${c.slug}: 대조군 공허 런`).toBeGreaterThan(0);

      expect(
        coreObservablesEqual(liveObs, ctrlObs),
        `${c.slug}: 시그니처를 꺼도 관측이 완전히 같다 = world.ts 배선 없음`,
      ).toBe(false);

      // 타입 고유 효과.
      c.signatureEffect(liveObs, ctrlObs);
    },
  );
});

// ---------------------------------------------------------------------------
// ③ aux 슬롯 규약 — 시그니처 비활성 런에서 aux 는 끝까지 0
// ---------------------------------------------------------------------------

describe('③ aux0/aux1 조건부 폴드 규약', () => {
  it.each(CASES)('typeId $typeId ($slug): live 는 aux 를 쓰고 억제 대조군은 끝까지 0', (c) => {
    const live = buildRunConfig(profileWithType(c.typeId), { planet: c.planet, stage: c.stage });
    const liveObs = observe(c.seed, live, c.ticks);
    const ctrlObs = observe(c.seed, suppressSignature(live, c.typeId), c.ticks);

    expect(liveObs.maxAux0 + liveObs.maxAux1, `${c.slug}: 시그니처가 aux 를 전혀 쓰지 않는다`)
      .toBeGreaterThan(0);
    expect(ctrlObs.maxAux0, `${c.slug}: 억제 런에서 aux0 오염`).toBe(0);
    expect(ctrlObs.maxAux1, `${c.slug}: 억제 런에서 aux1 오염`).toBe(0);
    // 비음 정수라야 u32 폴드(replay.ts hashEntity 의 `>>> 0`)가 안전하다.
    for (const v of [liveObs.maxAux0, liveObs.maxAux1]) {
      expect(Number.isInteger(v) && v >= 0, `${c.slug}: aux 가 비음 정수가 아니다`).toBe(true);
    }
  });

  it('스트라이커(typeId 0) 런은 어떤 무대에서도 aux 를 건드리지 않는다', () => {
    for (const { planet, stage, seed } of [
      { planet: 0, stage: 1, seed: 3311 },
      { planet: 2, stage: 21, seed: 3311 },
      { planet: 0, stage: 1, seed: 42 },
    ]) {
      const cfg = buildRunConfig(defaultProfile(), { planet, stage });
      expect(cfg.loadout?.uniqueMask).toBe(0);
      const o = observe(seed, cfg, 1200);
      expect(o.maxAux0, `p${planet}s${stage} sd${seed}`).toBe(0);
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
  const GATE_SEED = 42;
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
