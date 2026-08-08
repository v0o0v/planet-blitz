/**
 * M8 시그니처 배선 — 스트라이커(typeId 0 / 비트 24) 정조준 사이클(ADR-0049 §1).
 *
 * ## 무엇을 막는가
 * 1. **배선 부재(이 저장소 8회 재발형)** — "단위 테스트는 전부 그린인데 world.ts 분기가 통째로
 *    없다". 그래서 아래 통합 케이스는 `createWorld` → `stepWorld` 정규 경로로 실제 볼리를
 *    쏘게 하고, **12볼리마다 정확히 1볼리**가 강화되는지를 관측량(탄 피해·관통·`aux0` 마커)
 *    으로 잰다.
 * 2. **다른 기체로의 누출** — 스트라이커가 아닌 런에서 이 강화가 새면 안 된다(다른 6기체는
 *    각자의 시그니처 축이 있다). shipType 축만 바꾼 대조군으로 관측량이 끝까지 기준선인지 본다.
 * 3. **침공 게이트 누락/과다** — 설계서 §4 판정 표는 정조준 사이클을 "허용"(게이트 없음)으로
 *    못 박는다. `invasion3` 존재만으로 억제되거나 강화되면 안 된다.
 * 4. **`===` 임계의 조용한 미발현** — 후속 스킬(F1·S1, 별도 레인)이 카운터를 점프시킬 예정이라
 *    트리거는 `>=` 통과 판정이어야 한다(shipSignature.ts `marksmanTriggered` 주석). 카운터를
 *    직접 점프시켜 다음 한 발이 여전히 강화되는지로 그 계약을 물증화한다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, DEFAULT_CONFIG, DEFAULT_WEAPON } from '../src/sim/world.js';
import type { WorldConfig, WorldState } from '../src/sim/world.js';
import { blankEntity, type Entity } from '../src/sim/entities.js';
import { neutralLoadout } from '../src/items/loadout.js';
import {
  MARKSMAN_BONUS_BP,
  MARKSMAN_CYCLE_SHOTS,
  MARKSMAN_TRIGGER_AUX0,
  marksmanDamage,
} from '../src/sim/shipSignature.js';

const WEAPON_RAILGUN = 2; // world.ts 의 WEAPON_TYPE_RAILGUN — 비export 라 리터럴로 고정한다(weapons.test.ts 선례).
// ⚠️ 리터럴이 아니라 **정본에서 파생**한다. 기본 무기 피해는 밸런스 튜닝 대상이고
// (2026-08-08 에 8 → 18.24) 리터럴로 두면 튜닝할 때마다 이 스위트가 빨개진다. 이 파일이
// 재는 것은 *정조준 사이클의 주기·배율·마커*이지 *기본 피해값*이 아니다.
const BASE_DAMAGE = DEFAULT_WEAPON.damage;
const BASE_PIERCE = 0; // DEFAULT_WEAPON.pierce
/**
 * 정조준 볼리의 **sim 실측 피해**.
 *
 * ⚠️ `marksmanDamage(BASE_DAMAGE)` 를 쓰면 안 된다 — 그 순수 함수는 입력을 `Math.trunc` 하는데
 * (모듈 규약: 정수 in/정수 out) `weapon.damage` 는 **소수 2자리 실수**다. 기본 피해가 정수
 * 8 이던 시절에는 두 경로가 우연히 같은 값(12)이었지만, 2026-08-08 밸런스 패스로 18.24 가
 * 되면서 갈라진다: 순수 함수는 `trunc(18.24)=18 → 27`, world.ts 인라인은 `18.24 → 27.24`.
 *
 * world.ts 가 순수 함수를 안 부르고 동형 산술을 인라인한 이유가 정확히 그것이고(그 자리
 * 주석이 정본), 이 스위트는 **sim 경로**를 재므로 인라인 형태를 그대로 미러한다.
 */
const MARKSMAN_DAMAGE = BASE_DAMAGE + Math.round((BASE_DAMAGE * MARKSMAN_BONUS_BP) / 10000);

/** 단발 레일건 + 무보정 로드아웃 config. `shipType` 을 넘기면 그 축의 typeBit 이 시그니처를 정한다. */
function railgunConfig(overrides?: Partial<WorldConfig>): WorldConfig {
  return {
    ...DEFAULT_CONFIG,
    planet: 0,
    stage: 1,
    loadout: { ...neutralLoadout(), weaponType: WEAPON_RAILGUN },
    ...overrides,
  };
}

/** 사거리 안에 고정된, 죽지 않는 표적을 하나 심는다(weapons.test.ts 의 `addEnemy` 와 동형). */
function addEnemy(state: WorldState, x: number, y: number): Entity {
  const e = blankEntity('enemy');
  e.id = state.nextEntityId++;
  e.x = x;
  e.y = y;
  e.radius = 40;
  e.hp = 1_000_000_000;
  e.maxHp = 1_000_000_000;
  e.enemyType = -1; // enemyDefFor → undefined → 제자리에서 움직이지도 쏘지도 않는다.
  state.entities.push(e);
  return e;
}

/** 플레이어 + 지정 엔티티만 남긴다 — 매 틱 새로 태어난 탄·잡음을 치워 관측을 고립시킨다. */
function isolate(state: WorldState, keep: readonly Entity[]): void {
  const keepIds = new Set(keep.map((e) => e.id));
  const player = state.entities[0]!;
  state.entities = state.entities.filter((e) => e === player || keepIds.has(e.id));
}

interface Shot {
  damage: number;
  pierce: number;
  aux0: number;
}

/** `ticks` 틱을 굴리며 새로 태어난 'bullet' 엔티티를 발사 순서대로 수집한다. */
function collectShots(state: WorldState, enemy: Entity, ticks: number): Shot[] {
  const seen = new Set<number>();
  const shots: Shot[] = [];
  for (let t = 0; t < ticks; t++) {
    stepWorld(state, emptyInput());
    for (const e of state.entities) {
      if (e.kind === 'bullet' && !seen.has(e.id)) {
        seen.add(e.id);
        shots.push({ damage: e.damage, pierce: e.pierce, aux0: e.aux0 });
      }
    }
    isolate(state, [enemy]);
  }
  return shots;
}

describe('스트라이커 정조준 사이클 — 순수 산술 골든', () => {
  it('world.ts 가 인라인한 배율 산술은 정수 피해에 대해 순수 함수와 값이 같다', () => {
    // world.ts 는 marksmanDamage 를 직접 부르지 않는다(주석: weapon.damage 가 소수 2자리
    // 실수라 트렁크가 평상시 피해까지 바꾼다) — 대신 동형 산술을 인라인한다. 이 골든이
    // 그 동형성을 못 박는다.
    for (const d of [0, 1, 2, 3, 7, 8, 13, 25, 99, 100, 12345]) {
      expect(Math.round((d * MARKSMAN_BONUS_BP) / 10000) + d).toBe(marksmanDamage(d));
    }
    // ⚠️ 동형성은 **정수 피해에서만** 성립한다(위 스윕이 그것을 잰다). 현행 기본 피해는
    // 소수라 두 경로가 갈리고, 그 갈림 자체를 여기서 못 박는다 — 다음 사람이 "순수 함수를
    // 쓰면 되지 않나" 로 되돌리지 않도록.
    expect(Number.isInteger(BASE_DAMAGE)).toBe(false);
    expect(marksmanDamage(BASE_DAMAGE)).not.toBe(MARKSMAN_DAMAGE);
    expect(marksmanDamage(BASE_DAMAGE)).toBe(
      Math.trunc(BASE_DAMAGE) + Math.round((Math.trunc(BASE_DAMAGE) * MARKSMAN_BONUS_BP) / 10000),
    );
    expect(MARKSMAN_DAMAGE).toBeGreaterThan(BASE_DAMAGE);
  });
});

describe('스트라이커(typeId 0) 정규 경로 배선 — createWorld/stepWorld', () => {
  it('12볼리마다 정확히 1볼리가 강화된다 — 피해·관통·aux0 마커 전부', () => {
    const state = createWorld(1, railgunConfig());
    const player = state.entities[0]!;
    const enemy = addEnemy(state, player.x + 300, player.y);

    // 발사 간격 = DEFAULT_WEAPON.fireCooldownQ / FIRE_CD_Q = 6틱. 200틱이면 최소 33발,
    // 즉 정조준 볼리를 2회 이상 관측한다(공허 런 방지 여유 포함).
    const shots = collectShots(state, enemy, 200);
    expect(shots.length, '공허 런 — 볼리가 하나도 안 나갔다').toBeGreaterThanOrEqual(24);

    let marksmanCount = 0;
    shots.forEach((s, i) => {
      const isMarksman = i % MARKSMAN_CYCLE_SHOTS === MARKSMAN_TRIGGER_AUX0;
      if (isMarksman) marksmanCount++;
      expect(s.damage, `shot#${i}`).toBe(isMarksman ? MARKSMAN_DAMAGE : BASE_DAMAGE);
      expect(s.pierce, `shot#${i}`).toBe(isMarksman ? BASE_PIERCE + 1 : BASE_PIERCE);
      expect(s.aux0, `shot#${i} (정조준 마커)`).toBe(isMarksman ? 1 : 0);
    });
    expect(marksmanCount, '정조준 볼리가 한 번도 안 걸렸다').toBeGreaterThanOrEqual(2);
    // 사이클 카운터 자체도 12를 절대 넘기지 않는다(정조준 발사 틱에 0으로 리셋).
    expect(player.aux0).toBeGreaterThanOrEqual(0);
    expect(player.aux0).toBeLessThan(MARKSMAN_CYCLE_SHOTS);
  });

  it('다른 기체(브루저, typeId 1) 런은 정조준 강화를 전혀 받지 않는다', () => {
    const state = createWorld(1, railgunConfig({ shipType: 1 }));
    const player = state.entities[0]!;
    const enemy = addEnemy(state, player.x + 300, player.y);
    const shots = collectShots(state, enemy, 200);
    expect(shots.length).toBeGreaterThanOrEqual(24);
    for (const [i, s] of shots.entries()) {
      expect(s.damage, `shot#${i}`).toBe(BASE_DAMAGE);
      expect(s.pierce, `shot#${i}`).toBe(BASE_PIERCE);
      expect(s.aux0, `shot#${i}: 정조준 마커가 다른 기체 탄에 샜다`).toBe(0);
    }
    // 이 런은 피격을 한 번도 받지 않으므로(표적이 반격하지 않는다) 브루저 자신의 장갑
    // 스택(aux0)도 끝까지 0이다 — 정조준 카운터가 그 자리를 오염시키지 않았다는 방증.
    expect(player.aux0).toBe(0);
  });

  it('침공(3레이어)에서도 정조준 사이클이 PvE 와 동일하게 작동한다 — 설계서 §4 "허용"', () => {
    // invasion3 를 손으로 조립하지 않고 존재만 표시한다(shipSignatureWiring.test.ts 선례) —
    // 정조준 사이클은 이 필드를 읽지 않으므로(§4 판정 표: 게이트 없음) 존재만으로 충분하다.
    const state = createWorld(1, railgunConfig({ invasion3: {} as never }));
    const player = state.entities[0]!;
    const enemy = addEnemy(state, player.x + 300, player.y);
    const shots = collectShots(state, enemy, 200);
    expect(shots.length).toBeGreaterThanOrEqual(24);

    let marksmanCount = 0;
    shots.forEach((s, i) => {
      const isMarksman = i % MARKSMAN_CYCLE_SHOTS === MARKSMAN_TRIGGER_AUX0;
      if (isMarksman) marksmanCount++;
      expect(s.damage, `invasion shot#${i}`).toBe(isMarksman ? MARKSMAN_DAMAGE : BASE_DAMAGE);
      expect(s.pierce, `invasion shot#${i}`).toBe(isMarksman ? BASE_PIERCE + 1 : BASE_PIERCE);
    });
    expect(marksmanCount).toBeGreaterThanOrEqual(2);
  });

  it('카운터가 점프해도(F1/S1 대비) 임계를 건너뛰지 않는다 — `>=` 통과 판정의 물증', () => {
    const state = createWorld(1, railgunConfig());
    const player = state.entities[0]!;
    addEnemy(state, player.x + 300, player.y);

    // F1(전과 확장)·S1(응전 조준, 둘 다 별도 레인 미구현)이 만들 법한 점프를 손으로 흉내낸다 —
    // 카운터가 임계(11)를 건너뛰어 15 로 널뛴 상태.
    player.aux0 = 15;
    stepWorld(state, emptyInput());

    const shot = state.entities.find((e) => e.kind === 'bullet');
    expect(shot, '점프 직후 첫 발사에서 탄이 안 나왔다').toBeDefined();
    // `=== 11` 이었다면 15 는 그 값을 이미 지나쳐 있어 이 발사가 강화되지 않았을 것이다.
    expect(shot!.damage, '`===` 판정이었다면 조용히 미발현했을 값').toBe(MARKSMAN_DAMAGE);
    expect(shot!.pierce).toBe(BASE_PIERCE + 1);
    expect(shot!.aux0).toBe(1);
    expect(player.aux0, '정조준 발사 후 사이클이 0 으로 리셋된다').toBe(0);
  });
});
