/**
 * 강제 스크롤 컬링 ↔ "마커 소멸 = 성공" 파생의 충돌 회귀 가드 (리뷰 HIGH-1 / HIGH-2).
 *
 * ## 결함의 형태
 * `cullScrollEnemies`(modes/blockBreak.ts)는 창 뒤로 흘러간 적을 **`hp > 0` 인 채로
 * `dead = true`** 로 만든다. `compact`(world.ts)는 이 경우를 알고 `hp <= 0` 게이트로 공짜
 * kills·젬·엘리트 루팅을 배제하지만, "마커 엔티티가 사라졌다"를 성공으로 읽는 상위 게이트
 * 두 곳은 그 게이트를 우회했다:
 *   - 봉인 수호자(`SEALED_GUARDIAN_MARK`) → 한 발도 안 맞히고 확정 rarity 3 전리품 + 크레딧.
 *   - 중반 격전 리더(`MID_CLASH_LEADER_MARK`) → 격전 세그먼트 공짜 통과(killGoal=0 이라
 *     처치 게이트도 없다) = "매 런 확정 par 연장 비트"(ADR-0032)가 racing/blockBreak 에서만
 *     조용히 무효화.
 *
 * ## 이 파일이 못 박는 것
 *  (A) **실측** — 실제 blockBreak 런에서 마커 엔티티가 컬 반경 밖으로 밀리는 상황이 발생하는가.
 *      수정 전 컬링 규칙(예외 없는 원본 루프)을 순수 판정으로 재현해 `dead=true & hp>0` 이
 *      떴을 상황을 센다. 결과는 파라미터 의존이라 **단언하지 않고 관측만** 한다 — 파라미터에
 *      기대는 안전은 안전이 아니므로 수정과 회귀 가드는 관측 결과와 무관하게 존재한다.
 *  (B) **컬링 예외** — 마커를 단 적은 컬 반경 밖에 있어도 살아남고, 마커 없는 대조군은 죽는다.
 *  (C) **처치 영수증** — 수호자가 처치 없이 사라지면 보상이 0 이고 완료(3)로 서지 않는다.
 *  (D) **격전 게이트** — 세그먼트 처치가 0 인 채로 리더만 사라지면 전진하지 않는다.
 */
import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput } from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import type { Entity } from '../src/sim/entities.js';
import { spawnEncounterPortal } from '../src/sim/entities.js';
import type { EncounterRuntime } from '../src/sim/encounter.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile } from '../src/save/profile.js';
import { summonEnemy } from '../src/sim/waves.js';
import { ENEMY_BY_TYPE } from '../data/enemies.js';
import { SEGMENTS } from '../data/waves.js';
import {
  cullScrollEnemies,
  BLOCKBREAK_ENEMY_CULL_RADIUS,
} from '../src/sim/modes/blockBreak.js';
import {
  MID_CLASH_LEADER_MARK,
  midClashCleared,
  midClashLeaderAlive,
} from '../src/sim/modes/midClash.js';
import {
  stepLightEncounter,
  SEALED_GUARDIAN_MARK,
  GUARDIAN_CREDITS,
} from '../src/sim/encounters/light.js';
import { ENCOUNTER_TYPE, SPECIAL_ENCOUNTER_ENTER } from '../data/encounters.js';

/** 런이 접촉·피격으로 조기 종료되지 않게 버티는 무대 HP. */
const DURABLE_HP = 100_000_000;
/** 크라스(planet 5) = blockBreak 모드(데이터 주도, PLANETS 레지스트리). */
const BLOCKBREAK_PLANET = 5;
/** 격전 세그먼트 인덱스(데이터 파생 — 하드코딩 금지). */
const CLASH_INDEX = SEGMENTS.findIndex((s) => s.clash === true);

function blockBreakConfig(): WorldConfig {
  return {
    ...buildRunConfig(defaultProfile(), { planet: BLOCKBREAK_PLANET, stage: 1 }),
    playerHp: DURABLE_HP,
  };
}

function playerOf(w: WorldState): Entity {
  const p = w.entities[0];
  if (p === undefined) throw new Error('player missing');
  return p;
}

function markedEnemy(w: WorldState, mark: number): Entity | undefined {
  return w.entities.find((e) => e.kind === 'enemy' && !e.dead && e.aux1 === mark);
}

/** 격전 세그먼트 진입 상태로 점프(midClash.test.ts 의 동형 헬퍼). */
function enterClash(w: WorldState): void {
  w.wave.segmentIndex = CLASH_INDEX;
  w.wave.segmentElapsed = 0;
  w.wave.cardTimer = 0;
  w.wave.segmentBaseKills = w.kills;
  w.wave.segmentKillGoal = SEGMENTS[CLASH_INDEX]?.killGoal ?? 0;
}

/**
 * **수정 전** 컬링 규칙의 순수 재현(상태를 바꾸지 않는다) — 이 적이 옛 `cullScrollEnemies`
 * 에서 `dead = true` 로 찍혔겠는가. 예외 목록만 빠진 같은 판정이다.
 */
function wouldHaveBeenCulled(w: WorldState, e: Entity): boolean {
  const rt = w.scrollRuntime;
  if (rt === undefined) return false;
  const dx = e.x - rt.scrollX;
  const dy = e.y - rt.scrollY;
  return dx * dx + dy * dy > BLOCKBREAK_ENEMY_CULL_RADIUS * BLOCKBREAK_ENEMY_CULL_RADIUS;
}

// ---------------------------------------------------------------------------
// (A) 실측 — 실제 blockBreak 런에서 마커가 컬 반경 밖으로 밀리는가
// ---------------------------------------------------------------------------

describe('실측: blockBreak 런에서 마커 엔티티가 컬링 경로에 실제로 노출되는가', () => {
  it('대조군은 처치 없이 소멸하고(=결함 재현), 마커 2종은 끝까지 살아남는다', () => {
    const w = createWorld(0xc0117, blockBreakConfig());
    expect(w.scrollRuntime).toBeDefined(); // 강제 스크롤 창이 있는 모드인지 먼저 확인
    enterClash(w);
    stepWorld(w, emptyInput()); // 진입 틱 — 리더 + 정예 서지 소환
    const leader = markedEnemy(w, MID_CLASH_LEADER_MARK);
    if (leader === undefined) throw new Error('leader missing');
    w.weapon.damage = 0; // 아무도 죽지 않는다 — 소멸 원인을 "컬링"으로 고정한다

    // 수호자도 같은 런에 얹어 함께 관측한다(둘 다 같은 컬링 경로에 노출된다).
    const { rt: encRt } = openGuardian(w);

    /**
     * **대조군** — 리더와 같은 자리·같은 시점에 세운 **마커 없는** 사본. 유일한 차이가
     * 마커이므로, 이 사본이 겪는 일이 곧 "수정 전 리더가 겪던 일"이다. 수정 후에도 이 경로가
     * 살아 있다는 것(= 결함이 가설이 아니라 실재였다는 것)을 런 단위로 재현한다.
     */
    const def = ENEMY_BY_TYPE[0];
    if (def === undefined) throw new Error('enemy catalog empty');
    const control = summonEnemy(w, def, leader.x, leader.y);
    const controlId = control.id;

    let controlVanishTick = -1;
    let controlLastSeenHp = control.hp;
    let controlFirstOutsideTick = -1;
    const killsAtStart = w.kills;

    for (let t = 0; t < 60 * 90; t++) {
      stepWorld(w, emptyInput());
      const c = w.entities.find((e) => e.id === controlId && !e.dead);
      if (c === undefined) {
        if (controlVanishTick < 0) controlVanishTick = t;
      } else {
        controlLastSeenHp = c.hp;
        if (controlFirstOutsideTick < 0 && wouldHaveBeenCulled(w, c)) controlFirstOutsideTick = t;
      }
    }

    console.log(
      `[실측] 대조군(마커 없음): 컬 반경 이탈 첫 틱 = ${controlFirstOutsideTick}, ` +
        `소멸 틱 = ${controlVanishTick}, 소멸 직전 hp = ${controlLastSeenHp} / ` +
        `런 전체 kills 증가 = ${w.kills - killsAtStart}`,
    );

    // ── 결함 재현: 대조군은 **hp 를 남긴 채**(처치가 아닌 채) 사라졌다.
    //
    // ⚠️ `controlFirstOutsideTick` 은 보통 −1 이다. 컬 반경을 넘는 틱에 `cullScrollEnemies` 가
    // 곧바로 `dead` 로 찍고 **같은 틱 끝의 `compact` 가 수거**해 버려, 틱 경계에서 보는 이
    // 루프에는 "반경 밖에 살아 있는 프레임"이 잡히지 않기 때문이다. 그래서 `dead && hp>0` 의
    // 직접 관측은 아래 (B) 블록이 `cullScrollEnemies` 를 직접 호출해 담당하고, 여기서는
    // **런 단위 증거**(처치 집계 0인데 사라졌다)로 같은 사실을 확증한다.
    expect(controlVanishTick).toBeGreaterThanOrEqual(0);
    expect(controlLastSeenHp).toBeGreaterThan(0); // 소멸 직전까지 멀쩡했다
    expect(w.kills).toBe(killsAtStart); // 그런데 처치는 단 한 건도 집계되지 않았다

    // ── 수정 후 규율: 같은 런에서 마커 2종은 소멸하지 않는다(공짜 통과·공짜 보상 없음).
    expect(midClashLeaderAlive(w)).toBe(true);
    expect(markedEnemy(w, SEALED_GUARDIAN_MARK)).toBeDefined();
    expect(encRt.state).toBe(2); // 수호자 조우는 보상 없이 열린 채로 남는다
    expect(w.loot).toHaveLength(0); // 확정 rarity 3 이 공짜로 나가지 않았다
  });
});

// ---------------------------------------------------------------------------
// (B) 컬링 예외 — 결정론적 확증(파라미터 비의존)
// ---------------------------------------------------------------------------

describe('컬링 예외: 연출 실체는 hp>0 인 채로 dead 가 되지 않는다', () => {
  it('컬 반경 밖의 수호자·격전 리더는 살아남고, 마커 없는 대조군만 컬링된다', () => {
    const w = createWorld(0xc0118, blockBreakConfig());
    const rt = w.scrollRuntime;
    if (rt === undefined) throw new Error('scrollRuntime missing');
    const def = ENEMY_BY_TYPE[0];
    if (def === undefined) throw new Error('enemy catalog empty');

    // 셋 다 컬 반경 밖 같은 자리에 세운다 — 유일한 차이가 마커임을 못 박는다.
    const far = BLOCKBREAK_ENEMY_CULL_RADIUS * 2;
    const guardian = summonEnemy(w, def, rt.scrollX + far, rt.scrollY);
    guardian.aux1 = SEALED_GUARDIAN_MARK;
    const leader = summonEnemy(w, def, rt.scrollX + far, rt.scrollY);
    leader.aux1 = MID_CLASH_LEADER_MARK;
    const control = summonEnemy(w, def, rt.scrollX + far, rt.scrollY);
    expect(control.aux1).toBe(0);
    // 셋 다 멀쩡히 살아 있다(= hp>0). 컬링이 hp 를 건드리지 않는다는 것이 결함의 핵심이다.
    for (const e of [guardian, leader, control]) expect(e.hp).toBeGreaterThan(0);

    cullScrollEnemies(w, BLOCKBREAK_ENEMY_CULL_RADIUS);

    expect(control.dead).toBe(true); // 대조군은 규칙대로 컬링된다(예외가 과잉이 아님)
    expect(control.hp).toBeGreaterThan(0); // ← 이것이 `dead=true && hp>0` 의 직접 관측이다
    expect(guardian.dead).toBe(false);
    expect(leader.dead).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (C) 처치 영수증 — 수호자가 처치 없이 사라지면 보상 0
// ---------------------------------------------------------------------------

/** 출현(state=1) 런타임(오브젝트 id 는 호출부가 물린다). */
function guardianRuntime(entityId: number, spawnTick: number): EncounterRuntime {
  return {
    state: 1,
    type: ENCOUNTER_TYPE.sealedGuardian,
    spawnTick,
    entityId,
    inDetour: 0,
    savedX: 0,
    savedY: 0,
    detourTimer: 0,
    aux: 0,
  };
}

function inputWith(special: number): InputFrame {
  return { ...emptyInput(), special };
}

/** 봉인을 플레이어 발밑에 세우고 개방까지 마친 뒤 소환된 수호자를 돌려준다. */
function openGuardian(w: WorldState): { rt: EncounterRuntime; guardian: Entity } {
  const p = playerOf(w);
  const seal = spawnEncounterPortal(w, p.x, p.y, 120);
  const rt = guardianRuntime(seal.id, w.tick);
  stepLightEncounter(w, p, rt, inputWith(SPECIAL_ENCOUNTER_ENTER));
  expect(rt.state).toBe(2);
  const guardian = markedEnemy(w, SEALED_GUARDIAN_MARK);
  if (guardian === undefined) throw new Error('guardian missing');
  return { rt, guardian };
}

describe('봉인 수호자 보상은 처치로 사라진 경우에만 나간다', () => {
  it('컬링 소멸(hp>0, kills 불변)은 보상 0 + 미완(state=4)', () => {
    const w = createWorld(0xc0119, blockBreakConfig());
    const p = playerOf(w);
    const { rt, guardian } = openGuardian(w);
    const credits0 = w.resources;

    // 컬링과 동형: hp 를 남긴 채 dead 로 표시하고 compact 가 수거한다(kills 는 오르지 않는다).
    guardian.dead = true;
    expect(guardian.hp).toBeGreaterThan(0);
    stepLightEncounter(w, p, rt, emptyInput());

    expect(rt.state).toBe(4); // 완료(3)가 아니다 — 정산 개연성 캡이 완수로 읽으면 안 된다
    expect(w.loot).toHaveLength(0);
    expect(w.resources).toBe(credits0);

    // 이후 몇 번을 더 돌려도 보상이 새지 않는다.
    for (let i = 0; i < 5; i++) stepLightEncounter(w, p, rt, emptyInput());
    expect(w.loot).toHaveLength(0);
    expect(w.resources).toBe(credits0);
  });

  it('처치 소멸(hp<=0, compact 의 kills++ 동반)은 정상 보상 + 완료(state=3)', () => {
    const w = createWorld(0xc011a, blockBreakConfig());
    const p = playerOf(w);
    const { rt, guardian } = openGuardian(w);
    const credits0 = w.resources;

    // compact 의 처치 경로를 그대로 흉내 낸다: hp<=0 → dead → state.kills++.
    guardian.hp = 0;
    guardian.dead = true;
    w.kills++;
    stepLightEncounter(w, p, rt, emptyInput());

    expect(rt.state).toBe(3);
    expect(w.loot.length).toBeGreaterThan(0);
    expect(w.resources - credits0).toBe(GUARDIAN_CREDITS);
  });
});

// ---------------------------------------------------------------------------
// (D) 격전 전진 게이트 — 세그먼트 처치 0 이면 열리지 않는다
// ---------------------------------------------------------------------------

describe('격전 전진 게이트는 처치 진행을 함께 요구한다', () => {
  it('리더만 사라지고 세그먼트 처치가 0 이면 cleared 가 아니다', () => {
    const w = createWorld(0xc011b, blockBreakConfig());
    enterClash(w);
    stepWorld(w, emptyInput());
    const leader = markedEnemy(w, MID_CLASH_LEADER_MARK);
    if (leader === undefined) throw new Error('leader missing');

    // 세그먼트 진입 이후 아무도 죽지 않은 상태를 고정한다.
    w.kills = w.wave.segmentBaseKills;
    // 컬링과 동형의 소멸(hp 를 남긴 채 제거).
    w.entities = w.entities.filter((e) => e !== leader);
    expect(midClashLeaderAlive(w)).toBe(false);

    expect(midClashCleared(w, w.wave)).toBe(false);

    // 처치가 한 건이라도 잡히면(정상 처치 경로 = compact 의 kills++) 게이트가 열린다 —
    // 리더를 실제로 잡은 런은 kills 가 반드시 올라가므로 데드락이 없다는 증거다.
    w.kills = w.wave.segmentBaseKills + 1;
    expect(midClashCleared(w, w.wave)).toBe(true);
  });
});
