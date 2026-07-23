/**
 * 예비역 소집 + 장비 잠김 — 정규경로 통합 테스트(ADR-0024, Task #7 core + Task #5 가드레일).
 *
 * 이 저장소의 시그니처 결함("단위 테스트는 그린인데 배선이 통째로 없다")을 정면으로 겨냥한다.
 * 목킹 없이 **실제 export 함수만** 엮어 퇴역→소집 왕복을 end-to-end 로 증명한다:
 *
 *   retireActiveShip(profile) → guardian.build 캡처 → buildCallupPilot(guardian) → buildRunConfig(pilot)
 *
 * pilot 조립은 `src/main.ts` 의 `buildCallupPilot`(:724-742)을 그대로 미러링한다(그 파일을
 * import 하면 main.ts 의 렌더/DOM 의존이 딸려오므로 순수 로직만 복제 — 계약이 어긋나면 이
 * 미러가 아니라 실제 loadout 비교가 먼저 깨지도록 배치했다).
 *
 * 개별 단위(퇴역 잠김·pilot 감쇠)는 guardianLifecycle.test.ts / runConfigCallup.test.ts 가 이미
 * 못박는다. 여기서는 그 조각들이 **실제 정규 경로로 서로 이어지는지** 만 검증한다.
 */

import { describe, it, expect } from 'vitest';
import { buildRunConfig } from '../src/run/runConfig.js';
import type { RunConfigOpts } from '../src/run/runConfig.js';
import { defaultProfile, activeShip, investSkill, migrate } from '../src/save/profile.js';
import type { Profile } from '../src/save/profile.js';
import { EQUIP_SLOTS } from '../src/items/types.js';
import type { Item, SlotKind, StatKey } from '../src/items/types.js';
import {
  retireActiveShip,
  dismissGuardianRecord,
  activeGuardians,
} from '../src/save/guardianLifecycle.js';
import { GUARDIAN_TITAN, PERFORMANCE_FULL, PERFORMANCE_FLOOR } from '../data/guardian.js';
import { SHIP_TYPES } from '../data/ships/index.js';

/** 로드아웃 어픽스가 실제로 어딘가 붙도록 만든 최소 아이템(runConfigCallup.test.ts 픽스처 스타일). */
function item(
  id: string,
  slot: SlotKind,
  affixes: { stat: StatKey; value: number }[],
  weaponType?: number,
): Item {
  return {
    id,
    slot,
    rarity: 'rare',
    affixes: affixes.map((a, i) => ({ id: `${id}-a${i}`, stat: a.stat, value: a.value })),
    ...(weaponType !== undefined ? { weaponType } : {}),
    source: { planet: 0, stage: 1 },
  };
}

/**
 * 크기 축(피해·HP)과 기하 축(탄속·사거리·발사 간격·이동속도)을 **모두** 채운 비-중립 활성 기체
 * 프로필 + 스킬 투자. 소집이 파일럿 감쇠를 어느 축에만 거는지 관측 가능하게 하고, 여러 슬롯에
 * 걸쳐 EQUIP_SLOTS 순서 계약을 exercise 한다.
 */
function profileWithLoadedActiveShip(): Profile {
  const profile = defaultProfile();
  const ship = activeShip(profile);
  ship.equipped = {
    main: item('it-main', 'main', [{ stat: 'damagePct', value: 20 }], 2),
    armor: item('it-armor', 'armor', [
      { stat: 'damagePct', value: 40 },
      { stat: 'maxHpFlat', value: 60 },
    ]),
    engine: item('it-engine', 'engine', [
      { stat: 'bulletSpeedPct', value: 25 },
      { stat: 'rangeFlat', value: 120 },
    ]),
    core: item('it-core', 'core', [{ stat: 'fireRatePct', value: 15 }]),
    module0: item('it-mod0', 'module', [{ stat: 'moveSpeedPct', value: 10 }]),
  };
  // 스킬 투자를 남겨 build.skillInvest 캡처와 config.skillInvest 스탬프를 함께 검증.
  profile.skillPoints = 3;
  investSkill(profile, 0);
  return profile;
}

/**
 * `src/main.ts` buildCallupPilot(:724-742) 미러. pilotGuardianId 가 유효한 소집 대상(존재 +
 * build 有)이면 잠긴 실물 빌드를 buildRunConfig pilot 스냅샷으로 변환, 아니면 null(활성 기체 출격).
 * equipped 는 EQUIP_SLOTS 순서로 모은다(runConfig 의 equippedItems 와 동일한 순서 계약).
 */
function buildCallupPilot(
  profile: Profile,
  pilotGuardianId: string | null | undefined,
): NonNullable<RunConfigOpts['pilot']> | null {
  if (typeof pilotGuardianId !== 'string' || pilotGuardianId.length === 0) return null;
  const guardian = profile.guardians.find((g) => g.id === pilotGuardianId);
  const build = guardian?.build;
  if (guardian === undefined || build === undefined) return null;
  const equipped: Item[] = [];
  for (const slot of EQUIP_SLOTS) {
    const it = build.equipped[slot];
    if (it !== undefined) equipped.push(it);
  }
  return {
    equipped,
    skillInvest: build.skillInvest,
    typeId: build.typeId,
    performanceCP: guardian.performanceCP,
  };
}

describe('예비역 소집 정규경로 통합 — 퇴역→build 캡처→소집 왕복 (ADR-0024, Task #7)', () => {
  it('완전 성능 소집 loadout 이 퇴역 전 활성 기체 loadout 과 정확히 재구성된다(핵심 배선 증명)', () => {
    const profile = profileWithLoadedActiveShip();
    const ship = activeShip(profile);

    // 퇴역 전 활성 기체의 실제 런 loadout 을 정규 경로(buildRunConfig)로 캡처한다.
    // pilot loadout 파생은 invasion3 유무와 무관하므로 PvE 경로(invasion3 미지정)로 잰다.
    const preRetire = buildRunConfig(profile, { planet: 0, stage: 1 });

    // 퇴역 순간 실물 빌드의 원본 참조·벡터를 잡아 둔다(퇴역이 활성 장착을 비우므로 그 전에).
    const capturedTypeId = ship.typeId;
    const capturedItems: Partial<Record<string, Item>> = {};
    for (const slot of EQUIP_SLOTS) {
      const it = ship.equipped[slot];
      if (it !== undefined) capturedItems[slot] = it;
    }
    const capturedInvest = ship.skillInvest.slice();
    const stashBefore = profile.stash.length;

    // ⚠️ 활성 기체와 **다른 타입**(브루저 1)의 후속 기체로 세대 교체한다 — buildRunConfig 가
    // pilot.typeId 를 읽는지(활성 기체 typeId 를 잘못 읽지 않는지) 를 shipType 으로 판별하기 위함.
    const nextTypeId = SHIP_TYPES.length > 1 ? 1 : 0;
    const { guardian } = retireActiveShip(profile, GUARDIAN_TITAN, nextTypeId);

    // 1) 수호기 build 가 퇴역 순간 빌드를 그대로 잠갔다: typeId · 장착(참조 동일) · 스킬 벡터.
    expect(guardian.build).toBeDefined();
    const build = guardian.build!;
    expect(build.typeId).toBe(capturedTypeId);
    for (const slot of EQUIP_SLOTS) {
      // 잠긴 장비는 stash 사본이 아니라 원본 Item **참조**여야 한다(얕은 복사 계약).
      expect(build.equipped[slot as keyof typeof build.equipped]).toBe(capturedItems[slot]);
    }
    expect(build.skillInvest).toEqual(capturedInvest);
    expect(build.skillInvest[0]).toBe(1); // 투자가 실제로 캡처됐다

    // 2) 장비 잠김 경제: 퇴역한 기체의 장비는 stash 로 새지 않는다.
    expect(profile.stash.length).toBe(stashBefore);

    // 3) guardian.build 로 pilot 을 조립(main.ts buildCallupPilot 과 동일 계약) → 소집 출격.
    const pilot = buildCallupPilot(profile, guardian.id);
    expect(pilot).not.toBeNull();
    expect(pilot!.performanceCP).toBe(PERFORMANCE_FULL); // 퇴역 직후 = 완전 성능

    const callup = buildRunConfig(profile, { planet: 0, stage: 1, pilot: pilot! });

    // 4) 완전 성능 소집은 퇴역 전 활성 loadout 을 **바이트 동일**하게 재구성한다.
    expect(callup.loadout).toEqual(preRetire.loadout);
    // shipType 은 활성 기체(브루저 1)가 아니라 파일럿 build.typeId(스트라이커 0)를 스탬프한다.
    expect(callup.shipType).toBe(build.typeId);
    expect(callup.shipType).not.toBe(activeShip(profile).typeId); // 활성 기체 typeId 오독 방지
    expect(callup.skillInvest).toEqual(preRetire.skillInvest);
  });

  it('풍화(성능 바닥 5000) 소집은 피해·HP 만 절반이고 기하는 불변이다', () => {
    const profile = profileWithLoadedActiveShip();
    const { guardian } = retireActiveShip(profile, GUARDIAN_TITAN, 0);

    // 완전 성능 소집(퇴역 직후 performanceCP = 10000)을 기준선으로 잡는다.
    const fullPilot = buildCallupPilot(profile, guardian.id)!;
    const full = buildRunConfig(profile, { planet: 0, stage: 1, pilot: fullPilot });

    // 수호기를 풍화 바닥까지 감쇠시킨 뒤 다시 소집한다(서버 권위 performanceCP 를 미러).
    guardian.performanceCP = PERFORMANCE_FLOOR;
    const floorPilot = buildCallupPilot(profile, guardian.id)!;
    expect(floorPilot.performanceCP).toBe(PERFORMANCE_FLOOR);
    const floor = buildRunConfig(profile, { planet: 0, stage: 1, pilot: floorPilot });

    // 감쇠가 관측 가능하려면 기준값이 유의미해야 한다(무결성 가드).
    expect(full.loadout?.damageMult).toBeGreaterThan(1);
    expect(full.loadout?.maxHpAdd).toBeGreaterThan(0);

    // 크기 축: perf/10000 = 0.5 로 절반.
    expect(floor.loadout?.damageMult).toBeCloseTo((full.loadout?.damageMult ?? 0) / 2, 10);
    expect(floor.loadout?.maxHpAdd).toBe(Math.round((full.loadout?.maxHpAdd ?? 0) / 2));

    // 기하 축: 불변(탄속·사거리·발사 간격·이동속도).
    expect(floor.loadout?.bulletSpeedMult).toBe(full.loadout?.bulletSpeedMult);
    expect(floor.loadout?.rangeAdd).toBe(full.loadout?.rangeAdd);
    expect(floor.loadout?.fireRateMult).toBe(full.loadout?.fireRateMult);
    expect(floor.loadout?.moveSpeedMult).toBe(full.loadout?.moveSpeedMult);
  });
});

describe('소집 가드레일 — 활성 기체 정체성/XP 귀속 불변 (Task #5)', () => {
  it('pilot 조립 + buildRunConfig(pilot) 는 activeShipIndex 와 활성 기체를 전혀 건드리지 않는다', () => {
    const profile = profileWithLoadedActiveShip();
    const { guardian } = retireActiveShip(profile, GUARDIAN_TITAN, 0);

    // 퇴역 후 활성 기체(신규 세대)에 성장 상태를 실어 뮤테이션 탐지 감도를 높인다.
    const liveShip = activeShip(profile);
    liveShip.level = 7;
    liveShip.xp = 250;
    liveShip.equipped = { shield: item('it-shield', 'shield', [{ stat: 'maxHpPct', value: 20 }]) };
    profile.skillPoints = 2;
    investSkill(profile, 0);

    // 소집이 XP 크레딧 대상(활성 기체)으로 삼는 축들을 통째로 스냅샷.
    const idxBefore = profile.activeShipIndex;
    const levelBefore = liveShip.level;
    const xpBefore = liveShip.xp;
    const investBefore = liveShip.skillInvest.slice();
    const equippedKeysBefore = Object.keys(liveShip.equipped).sort();
    const shieldRef = liveShip.equipped.shield;

    // 소집 실행: pilot 데이터 주입만으로 런을 조립한다(활성 인덱스 뮤테이션 없음).
    const pilot = buildCallupPilot(profile, guardian.id)!;
    buildRunConfig(profile, { planet: 0, stage: 1, pilot });

    // 활성 기체는 여전히 같은 인덱스·같은 기체·같은 성장 상태다 → XP 는 활성 기체에 귀속되고
    // 수호기는 순수 데이터 소스로만 쓰인다는 계약을 못박는다.
    expect(profile.activeShipIndex).toBe(idxBefore);
    expect(activeShip(profile)).toBe(liveShip);
    expect(liveShip.level).toBe(levelBefore);
    expect(liveShip.xp).toBe(xpBefore);
    expect(liveShip.skillInvest).toEqual(investBefore);
    expect(Object.keys(liveShip.equipped).sort()).toEqual(equippedKeysBefore);
    expect(liveShip.equipped.shield).toBe(shieldRef);
  });
});

describe('장비 잠김 경제 — 소멸이 잠긴 장비를 stash 로 반환 (ADR-0024)', () => {
  it('N개 장착 기체를 퇴역→소멸하면 그 N개가 stash 로 돌아온다', () => {
    const profile = profileWithLoadedActiveShip();
    const ship = activeShip(profile);
    const lockedItems: Item[] = [];
    for (const slot of EQUIP_SLOTS) {
      const it = ship.equipped[slot];
      if (it !== undefined) lockedItems.push(it);
    }
    const n = lockedItems.length;
    expect(n).toBeGreaterThan(0);
    const stashBefore = profile.stash.length;

    const { guardian } = retireActiveShip(profile, GUARDIAN_TITAN, 0);
    // 퇴역 직후: 장비는 수호기에 잠기고 stash 는 불변.
    expect(profile.stash.length).toBe(stashBefore);
    expect(Object.keys(guardian.build!.equipped).length).toBe(n);

    // 소멸: 잠긴 장비가 전부 stash 로 반환된다.
    const r = dismissGuardianRecord(profile, guardian.id);
    expect(r.dismissed).toBe(true);
    expect(profile.stash.length).toBe(stashBefore + n);
    for (const it of lockedItems) {
      expect(profile.stash).toContain(it);
    }
  });
});

describe('하위 호환 — 구 수호기(build 부재)는 소집 비대상 (ADR-0024)', () => {
  it('normalize 로 build 가 사라진 pre-ADR-0024 수호기는 소집 필터에서 제외되고 pilot 조립도 null', () => {
    // 실제 정규화 경로로 "구 수호기"를 만든다: 정상 퇴역 → 직렬화 시 build 필드를 지움 →
    // migrate(normalizeGuardianRecords)가 build 없이 로드(=소집 비활성). 손으로 snapshot 을
    // 조작하지 않고 실 함수만 사용해 하위 호환 경로 자체를 exercise 한다.
    const seed = profileWithLoadedActiveShip();
    retireActiveShip(seed, GUARDIAN_TITAN, 0);
    const raw = JSON.parse(JSON.stringify(seed)) as { guardians: Record<string, unknown>[] };
    delete raw.guardians[0]!.build; // 디스크상 pre-ADR-0024 레코드 재현
    const profile = migrate(raw);

    // 레코드 자체는 유지되지만(활성 수호로 남음) build 는 undefined 다.
    expect(profile.guardians.length).toBe(1);
    const legacy = profile.guardians[0]!;
    expect(legacy.build).toBeUndefined();
    expect(legacy.retired).toBe(false);

    // 런치 피커의 적격 필터(build !== undefined)는 구 수호기를 배제한다.
    const active = activeGuardians(profile);
    expect(active.length).toBe(1); // 미소멸이라 activeGuardians 에는 든다
    const eligible = active.filter((g) => g.build !== undefined);
    expect(eligible).toEqual([]); // 그러나 소집 적격은 아니다

    // pilot 조립도 시도되지 않는다(build 부재 → null).
    expect(buildCallupPilot(profile, legacy.id)).toBeNull();
  });
});
