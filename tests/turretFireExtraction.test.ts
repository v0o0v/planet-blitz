/**
 * E6 — `stepTurrets` 발사 로직 추출의 **거동 불변 계약** (ADR-0049 선결, `prerequisites.md` §2).
 *
 * 해츨링 BD8(브루드 강습)이 "액티브 발동 틱에 병아리 전원이 쿨다운을 무시하고 즉시 1발" 을
 * 하려면 **발사와 쿨다운 관리가 분리**돼 있어야 한다. 그래서 `fireTurretShot`(표적 조회 →
 * 아군탄 생성, 쿨다운 미접촉)을 뽑았고, `stepTurrets` 는 그 반환값을 보고 자기가 리셋한다.
 *
 * 이 파일이 지키는 것은 **추출이 바꾸지 말았어야 하는 두 가지**다:
 *
 *  1. **무발사 틱에는 쿨다운을 리셋하지 않는다.** 추출 전 코드는 `if (target === undefined)
 *     continue;` 로 이 성질을 갖고 있었다. 추출하면서 `t.cooldown = TURRET_FIRE_COOLDOWN` 을
 *     **무조건** 실행하도록 옮기면, 사거리 밖에서 대기하는 동안 쿨다운이 매 틱 되감겨
 *     **표적이 들어온 순간의 첫 발이 최대 10틱 늦어진다.** 화면상 "가끔 반응이 굼뜨다" 로만
 *     보이고 어떤 골든도 이걸 이름으로 잡아 주지 않는다.
 *  2. **표적이 생기면 정확히 1발**을 쏘고 쿨다운이 선다.
 *
 * 그리고 **비-공허 증거** 하나: 병아리 드론이 실제로 이 경로로 탄을 쏜다. 이 사실이
 * `fireTurretShot` 안의 `ownerId = BROOD_MARK` 스탬프가 왜 이 커밋에서 보류됐는지의 근거다 —
 * `ownerId` 는 해시 폴드 대상이므로 스탬프는 곧 해시 변경이다(`fireTurretShot` 주석 참조).
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld,
  stepWorld,
  emptyInput,
  DEFAULT_CONFIG,
  type WorldConfig,
  type WorldState,
} from '../src/sim/world.js';
import { neutralLoadout } from '../src/items/loadout.js';
import { blankEntity, spawnEventObject, type Entity } from '../src/sim/entities.js';
import {
  activateTurret,
  TURRET_BULLET_DAMAGE,
  TURRET_BULLET_RADIUS,
  TURRET_FIRE_COOLDOWN,
  TURRET_RANGE,
} from '../src/sim/events.js';
import { DRONE_MARK } from '../src/sim/uniques.js';
import { BROOD_MARK } from '../src/sim/shipSignature.js';

const SHIP_HATCHLING = 4;

function baseConfig(shipType?: number): WorldConfig {
  const cfg: WorldConfig = {
    ...DEFAULT_CONFIG,
    planet: 0,
    stage: 1,
    loadout: { ...neutralLoadout(), weaponType: 0 },
  };
  if (shipType !== undefined) cfg.shipType = shipType;
  return cfg;
}

/**
 * 플레이어 + `keep` + 살아 있는 탄만 남기고 무대를 비운다.
 *
 * ⚠️ **매 틱 불러야 한다.** 웨이브 디렉터가 틱마다 적을 다시 채우므로 한 번만 비우면
 * 다음 틱에 무대가 되돌아오고, 그러면 플레이어 주무기까지 발사돼 탄 수 계량이 오염된다
 * (초판이 정확히 이 이유로 "0발" 자리에서 7발을 셌다).
 */
function isolate(state: WorldState, keep: readonly Entity[]): void {
  const keepIds = new Set(keep.map((e) => e.id));
  const player = state.entities[0] as Entity;
  state.entities = state.entities.filter(
    (e) => e === player || keepIds.has(e.id) || (e.kind === 'bullet' && !e.dead),
  );
}

/**
 * 즉시 활성인 포탑 1기를 놓는다(드론 베이·센트리·병아리가 공유하는 그 경로).
 *
 * ⚠️ `ownerId = DRONE_MARK` 가 **필수**다. `isGimmick`(world.ts)이 이 마커(와 `BROOD_MARK`)만
 * 기믹 분류에서 제외하므로, 마커 없는 `turretPickup` 은 플레이어에게서 멀어지는 순간 청크
 * 컬링에 조용히 잘린다 — 초판이 그래서 "포탑이 한 발도 안 쐈다" 를 봤다(그 미발현이 화면에도
 * 테스트에도 흔적을 안 남긴다는 `stepHatchBrood` 주석의 경고가 여기서 그대로 재현됐다).
 */
function placeTurret(state: WorldState, x: number, y: number): Entity {
  const t = spawnEventObject(state, 'turretPickup', x, y, 44);
  t.ownerId = DRONE_MARK;
  activateTurret(t);
  return t;
}

/** 움직이지도 반격하지도 않는 표적(weapons.test.ts 의 `addEnemy` 와 같은 레시피). */
function addDummyEnemy(state: WorldState, x: number, y: number): Entity {
  const e = blankEntity('enemy');
  e.id = state.nextEntityId++;
  e.x = x;
  e.y = y;
  e.radius = 40;
  e.hp = 1_000_000;
  e.maxHp = 1_000_000;
  e.enemyType = -1; // enemyDefFor → undefined → 제자리에 선다
  state.entities.push(e);
  return e;
}

/**
 * **포탑탄만** 센다. 플레이어 주무기 탄과 섞이면 계량이 오염되는데(웨이브가 매 틱 적을 다시
 * 채우므로 플레이어도 쏜다), 포탑탄은 피해·반경이 전용 상수라 그것으로 가른다.
 */
const isTurretBullet = (e: Entity): boolean =>
  e.kind === 'bullet' &&
  !e.dead &&
  e.damage === TURRET_BULLET_DAMAGE &&
  e.radius === TURRET_BULLET_RADIUS;

const countBullets = (state: WorldState): number => state.entities.filter(isTurretBullet).length;

/**
 * 포탑을 플레이어 옆에 둔다. 플레이어 주무기도 같은 표적을 쏘지만 {@link isTurretBullet} 이
 * 피해·반경으로 갈라 내므로 계량에는 안 섞인다. 무대 밖으로 멀리 빼는 방법도 써 봤으나
 * 무대 경계 밖에서는 표적 조회가 서지 않아(초판 실패) 가까이 두는 쪽으로 되돌렸다.
 */
const TURRET_OFFSET = 60;

describe('E6 — 포탑 발사 추출: 쿨다운 리듬이 바뀌지 않았다', () => {
  it('사거리 안에 표적이 없으면 한 발도 안 쏘고 **쿨다운도 서지 않는다**', () => {
    const state = createWorld(11, baseConfig());
    const player = state.entities[0] as Entity;
    const t = placeTurret(state, player.x + TURRET_OFFSET, player.y);
    for (let i = 0; i < 40; i++) {
      isolate(state, [t]);
      stepWorld(state, emptyInput());
    }
    expect(countBullets(state)).toBe(0);
    // 여기서 0 이 아니면 "무발사 틱에도 쿨다운을 세운다" 는 뜻이고, 그것이 추출이 낼 수 있는
    // 가장 조용한 회귀다(표적 진입 순간의 첫 발이 늦어진다).
    expect(t.cooldown).toBe(0);
  });

  it('표적이 들어오면 그 틱에 1발을 쏘고 쿨다운이 정확히 선다', () => {
    const state = createWorld(11, baseConfig());
    const player = state.entities[0] as Entity;
    const t = placeTurret(state, player.x + TURRET_OFFSET, player.y);
    const dummy = addDummyEnemy(state, t.x + TURRET_RANGE / 2, t.y);
    isolate(state, [t, dummy]);
    stepWorld(state, emptyInput());
    expect(countBullets(state)).toBe(1);
    // 발사 틱에 리셋된 뒤 같은 틱에 감산이 없으므로 값 그대로다.
    expect(t.cooldown).toBe(TURRET_FIRE_COOLDOWN);
  });

  it('쿨다운이 도는 동안에는 추가 발사가 없다(리듬 유지)', () => {
    const state = createWorld(11, baseConfig());
    const player = state.entities[0] as Entity;
    const t = placeTurret(state, player.x + TURRET_OFFSET, player.y);
    const dummy = addDummyEnemy(state, t.x + TURRET_RANGE / 2, t.y);
    isolate(state, [t, dummy]);
    stepWorld(state, emptyInput()); // 1발째
    const seen = new Set(state.entities.filter(isTurretBullet).map((e) => e.id));
    let fired = 0;
    const stepAndCount = (): void => {
      isolate(state, [t, dummy]);
      stepWorld(state, emptyInput());
      for (const e of state.entities) {
        if (isTurretBullet(e) && !seen.has(e.id)) {
          seen.add(e.id);
          fired++;
        }
      }
    };
    // 발사 틱에 쿨다운이 TURRET_FIRE_COOLDOWN 으로 서고, 이후 틱마다 1씩 깎이며 그 틱은
    // `continue` 다. 그래서 **딱 그 수만큼은 무발사**이고 그 다음 틱에 다시 쏜다.
    for (let i = 0; i < TURRET_FIRE_COOLDOWN; i++) stepAndCount();
    expect(fired, `쿨다운 ${TURRET_FIRE_COOLDOWN}틱 안에 추가 발사가 있었다`).toBe(0);
    stepAndCount();
    expect(fired, '쿨다운이 풀린 틱에 다시 쏘지 않았다').toBe(1);
  });
});

describe('E6 — 비-공허 증거: 병아리 드론이 이 경로로 쏜다', () => {
  it('해츨링 런에서 병아리가 출격하고, 그 병아리가 실제로 아군탄을 쏜다', () => {
    // ⚠️ 이 사실이 `fireTurretShot` 의 `ownerId = BROOD_MARK` 스탬프를 이 커밋에서 보류한
    //    근거다 — 병아리 탄이 실제로 생기므로, 스탬프는 해시가 갈리는 거동 변경이다.
    const state = createWorld(7, { ...baseConfig(SHIP_HATCHLING), playerHp: 100_000_000 });
    let sawChick = false;
    let sawChickShot = false;
    for (let i = 0; i < 6000 && !sawChickShot; i++) {
      const chicksBefore = state.entities.filter(
        (e) => !e.dead && e.ownerId === BROOD_MARK && e.cooldown === 0,
      );
      stepWorld(state, emptyInput());
      if (state.entities.some((e) => !e.dead && e.ownerId === BROOD_MARK)) sawChick = true;
      // 쿨다운 0 이던 병아리가 이 틱에 쿨다운을 세웠다 = 이 틱에 격발했다.
      if (chicksBefore.some((c) => !c.dead && c.cooldown === TURRET_FIRE_COOLDOWN)) {
        sawChickShot = true;
      }
    }
    expect(sawChick, '병아리가 한 기도 출격하지 않았다 — 계량이 공허하다').toBe(true);
    expect(sawChickShot, '병아리가 한 발도 쏘지 않았다 — 계량이 공허하다').toBe(true);
  });
});
