/**
 * 예비역 소집 런 조립(ADR-0024, Task #4) — `buildRunConfig` 의 `pilot` 분기.
 *
 * 소집은 활성 기체 대신 퇴역 수호기의 실물 빌드(build)로 출격한다. 이 테스트는 세 가지를
 * 못 박는다:
 *  1. 완전 성능(perfCP 10000)·동일 빌드 소집의 loadout 이 활성 기체 loadout 과 바이트 동일
 *     (소집 == 활성 빌드).
 *  2. 바닥 성능(perfCP 5000)이면 damageMult·maxHpAdd 만 절반 근사로 감쇠하고, 기하(탄속·사거리
 *     ·발사 간격)는 불변(resolveGuardianStats 철학 — 크기만 스케일, 기하 불변).
 *  3. `pilot` 미지정이면 활성 기체 config 그대로(회귀 가드 — 소집 분기가 순수 additive).
 *
 * 활성 기체 경로의 바이트 불변은 `tests/shipHashBaseline.test.ts` 골든이 전담하므로 여기서는
 * loadout 파생 대칭성만 좁게 검증한다.
 */

import { describe, it, expect } from 'vitest';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip, investSkill } from '../src/save/profile.js';
import type { Ship } from '../src/save/profile.js';
import { EQUIP_SLOTS } from '../src/items/types.js';
import type { Item, SlotKind, StatKey } from '../src/items/types.js';
import { zeroSkillInvest, shipSkillNodeCount } from '../data/ships/index.js';

/** 로드아웃 어픽스가 실제로 어딘가 붙도록 만든 최소 아이템(loadout.test.ts 픽스처 스타일). */
function item(id: string, slot: SlotKind, affixes: { stat: StatKey; value: number }[]): Item {
  return {
    id,
    slot,
    rarity: 'rare',
    affixes: affixes.map((a, i) => ({ id: `${id}-a${i}`, stat: a.stat, value: a.value })),
    source: { planet: 0, stage: 1 },
  };
}

/** `equippedItems(profile)` 와 같은 계약: EQUIP_SLOTS 순서로 장착 아이템을 모은다. */
function equippedInOrder(ship: Ship): Item[] {
  const out: Item[] = [];
  for (const id of EQUIP_SLOTS) {
    const it = ship.equipped[id];
    if (it !== undefined) out.push(it);
  }
  return out;
}

/**
 * 비-중립 loadout 을 만드는 활성 기체 프로필. 피해(+40%)·HP(+60 flat)로 크기 축을, 탄속(+25%)
 * ·사거리(+120)로 기하 축을 채워 감쇠가 어느 축에만 닿는지 관측 가능하게 한다.
 */
function pilotProfile(): { profile: ReturnType<typeof defaultProfile>; ship: Ship } {
  const profile = defaultProfile();
  const ship = activeShip(profile);
  ship.equipped = {
    armor: item('it-armor', 'armor', [
      { stat: 'damagePct', value: 40 },
      { stat: 'maxHpFlat', value: 60 },
    ]),
    engine: item('it-engine', 'engine', [
      { stat: 'bulletSpeedPct', value: 25 },
      { stat: 'rangeFlat', value: 120 },
    ]),
  };
  // 스킬 투자도 소집 스냅샷을 타는지 함께 증명(활성·소집 양쪽이 같은 벡터를 파생에 쓴다).
  profile.skillPoints = 3;
  investSkill(profile, 0);
  return { profile, ship };
}

describe('buildRunConfig — 예비역 소집(pilot) loadout 파생 (ADR-0024)', () => {
  it('완전 성능(perfCP 10000)·동일 빌드 소집의 loadout 이 활성 기체와 바이트 동일하다', () => {
    const { profile, ship } = pilotProfile();
    const active = buildRunConfig(profile, { planet: 0, stage: 1 });
    const full = buildRunConfig(profile, {
      planet: 0,
      stage: 1,
      pilot: {
        equipped: equippedInOrder(ship),
        skillInvest: ship.skillInvest.slice(),
        typeId: ship.typeId,
        performanceCP: 10000,
      },
    });
    expect(full.loadout).toEqual(active.loadout);
    // 소집이면 shipType·skillInvest 도 파일럿 값으로 스탬프된다.
    expect(full.shipType).toBe(active.shipType);
    expect(full.skillInvest).toEqual(active.skillInvest);
  });

  it('바닥 성능(perfCP 5000)이면 damage·HP 만 절반이고 기하는 불변이다', () => {
    const { profile, ship } = pilotProfile();
    const full = buildRunConfig(profile, {
      planet: 0,
      stage: 1,
      pilot: {
        equipped: equippedInOrder(ship),
        skillInvest: ship.skillInvest.slice(),
        typeId: ship.typeId,
        performanceCP: 10000,
      },
    });
    const floor = buildRunConfig(profile, {
      planet: 0,
      stage: 1,
      pilot: {
        equipped: equippedInOrder(ship),
        skillInvest: ship.skillInvest.slice(),
        typeId: ship.typeId,
        performanceCP: 5000,
      },
    });
    // 감쇠가 관측 가능하려면 기준 값이 유의미해야 한다(무결성 가드).
    expect(full.loadout?.maxHpAdd).toBeGreaterThan(0);
    expect(full.loadout?.damageMult).toBeGreaterThan(1);

    // 크기 축: 절반 근사(perf/10000 = 0.5).
    expect(floor.loadout?.damageMult).toBeCloseTo((full.loadout?.damageMult ?? 0) / 2, 10);
    expect(floor.loadout?.maxHpAdd).toBe(Math.round((full.loadout?.maxHpAdd ?? 0) / 2));

    // 기하 축: 불변(발사 간격·탄속·사거리·이동속도).
    expect(floor.loadout?.bulletSpeedMult).toBe(full.loadout?.bulletSpeedMult);
    expect(floor.loadout?.rangeAdd).toBe(full.loadout?.rangeAdd);
    expect(floor.loadout?.fireRateMult).toBe(full.loadout?.fireRateMult);
    expect(floor.loadout?.moveSpeedMult).toBe(full.loadout?.moveSpeedMult);
  });

  it('pilot 미지정이면 활성 기체 config 그대로다 (회귀 가드 — 소집 분기는 additive)', () => {
    const { profile, ship } = pilotProfile();
    const active = buildRunConfig(profile, { planet: 0, stage: 1 });
    const full = buildRunConfig(profile, {
      planet: 0,
      stage: 1,
      pilot: {
        equipped: equippedInOrder(ship),
        skillInvest: ship.skillInvest.slice(),
        typeId: ship.typeId,
        performanceCP: 10000,
      },
    });
    // 활성 경로는 활성 기체를 그대로 스탬프하고 감쇠를 적용하지 않는다.
    expect(active.shipType).toBe(ship.typeId);
    expect(active.skillInvest).toEqual(ship.skillInvest);
    // 완전 성능 소집과 loadout 이 동일 → 소집 분기가 무-pilot 산술을 건드리지 않음을 증명.
    expect(active.loadout).toEqual(full.loadout);
  });

  it('소집은 파일럿 typeId·skillInvest 를 config 에 스탬프한다(활성 기체가 아니라)', () => {
    // 활성 기체는 스트라이커(0)로 두고, 파일럿은 다른 타입(브루저 1)으로 출격.
    const profile = defaultProfile();
    expect(activeShip(profile).typeId).toBe(0);
    const cfg = buildRunConfig(profile, {
      planet: 0,
      stage: 1,
      pilot: {
        equipped: [],
        skillInvest: zeroSkillInvest(1),
        typeId: 1,
        performanceCP: 10000,
      },
    });
    expect(cfg.shipType).toBe(1);
    expect(cfg.skillInvest?.length).toBe(shipSkillNodeCount(1));
  });
});
