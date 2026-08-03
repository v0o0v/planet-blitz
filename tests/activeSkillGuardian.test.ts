/**
 * **예비역 소집 박제 관통** 테스트 — 계획 PM-3.
 *
 * "예비역이 맨손으로 나간다": 액티브가 전부 동작하고 42종 화면 확인도 끝났는데, 퇴역 후
 * 소집으로 그 기체를 조종하면 z/x 가 죽어 있다. `GuardianBuild` 가 `typeId`·`equipped`·
 * `skillInvest` 만 복사하고 **장착 슬롯 2칸을 빠뜨렸기** 때문이다.
 *
 * `skillInvest` 는 박제되므로 **해금 조건은 만족하는데 장착 상태만 없는** — "열려 있는데
 * 안 끼워져 있는" 가장 헷갈리는 형태다. 그래서 세 지점(`GuardianBuild` 박제 · V8 정규화 ·
 * `callupPilot` 전달)이 **셋 다** 있어야 성립하고, 이 테스트는 그 셋을 **끝에서 한 번에** 잰다.
 */

import { describe, it, expect } from 'vitest';
import { defaultProfile, activeShip, migrate } from '../src/save/profile.js';
import { retireActiveShip } from '../src/save/guardianLifecycle.js';
import { buildCallupPilot } from '../src/run/callupPilot.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { ALL_ACTIVES, wireIdOf } from '../data/ships/actives/index.js';
import { ACTIVE_WIRE_EMPTY } from '../data/ships/actives/types.js';
import { zeroSkillInvest } from '../data/ships/index.js';
import { SAVE_VERSION } from '../src/items/types.js';

describe('PM-3 — 퇴역 → 소집에서 액티브 장착이 박제된다', () => {
  it('퇴역 시점 장착 2개가 `GuardianBuild` 에 실리고 소집 런의 `WorldConfig` 까지 닿는다', () => {
    const a = ALL_ACTIVES[0];
    const b = ALL_ACTIVES[1];
    if (a === undefined || b === undefined) return;
    // 같은 기체의 두 스킬이어야 한다(타입 고유).
    if (a.shipTypeId !== b.shipTypeId) return;

    const p = defaultProfile();
    const ship = activeShip(p);
    ship.typeId = a.shipTypeId;
    const invest = zeroSkillInvest(a.shipTypeId);
    for (let i = 0; i < invest.length; i++) invest[i] = 50;
    ship.skillInvest = invest;
    ship.activeSlots = [a.id, b.id];
    ship.level = 100; // 퇴역 게이트(RETIRE_REQUIRED_LEVEL)

    const res = retireActiveShip(p);
    expect(res).not.toBeNull();
    if (res === null) return;

    // ① 박제 — GuardianBuild 에 슬롯 2칸이 실렸다.
    expect(res.guardian.build?.activeSlots).toEqual([a.id, b.id]);
    // 새 세대 기체는 빈 슬롯이어야 한다(투자 0이라 아무것도 안 열려 있다).
    expect(res.ship.activeSlots).toEqual([null, null]);

    // ② 전달 — callupPilot 이 그 슬롯을 pilot 스냅샷에 싣는다.
    const pilot = buildCallupPilot(p, res.guardian.id);
    expect(pilot).not.toBeNull();
    expect(pilot?.activeSlots).toEqual([a.id, b.id]);

    // ③ 관통 — 소집 런의 WorldConfig 에 wire 정수 2칸이 도달한다. 여기서 끊기면 소집 런에서
    //    z/x 가 죽고, 그런데도 프로필 계층 단위 테스트는 전부 그린이다(PM-3 의 형태).
    if (pilot === null) return;
    const cfg = buildRunConfig(p, { planet: 0, stage: 1, pilot });
    expect(cfg.activeSlots).toEqual([wireIdOf(a.id), wireIdOf(b.id)]);
  });

  it('구 guardian 레코드(V7, 슬롯 필드 부재)도 빈 슬롯 2칸으로 정규화된다 (AC-15)', () => {
    const p = defaultProfile();
    const ship = activeShip(p);
    ship.level = 100; // 퇴역 게이트
    const res = retireActiveShip(p);
    expect(res).not.toBeNull();
    void ship;

    // V7 세이브를 흉내 낸다 — build 에서 슬롯 필드를 지우고 버전을 되돌린다.
    const raw = JSON.parse(JSON.stringify(p)) as Record<string, unknown>;
    raw.saveVersion = 7;
    const guardians = raw.guardians as Record<string, unknown>[];
    for (const g of guardians) {
      const build = g.build as Record<string, unknown> | undefined;
      if (build !== undefined) delete build.activeSlots;
    }

    const migrated = migrate(raw);
    expect(migrated.saveVersion).toBe(SAVE_VERSION);
    for (const g of migrated.guardians) {
      expect(g.build?.activeSlots).toEqual([null, null]);
    }
  });

  it('박제 슬롯이 비어 있으면 소집 런도 `activeSlots` 를 싣지 않는다 (바이트 불변)', () => {
    const p = defaultProfile();
    activeShip(p).level = 100; // 퇴역 게이트
    const res = retireActiveShip(p);
    if (res === null) return;
    const pilot = buildCallupPilot(p, res.guardian.id);
    if (pilot === null) return;
    expect(pilot.activeSlots).toEqual([null, null]);
    const cfg = buildRunConfig(p, { planet: 0, stage: 1, pilot });
    expect('activeSlots' in cfg).toBe(false);
    expect(ACTIVE_WIRE_EMPTY).toBe(-1);
  });
});
