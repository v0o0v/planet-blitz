/**
 * 게스트 시작 프리셋 계약(2026-08-09).
 *
 * 프리셋의 위험은 "값이 작다/크다"가 아니라 **게임에서 도달할 수 없는 상태**가 나오는 것이다 —
 * 길이가 어긋난 투자 벡터, 해금 안 된 액티브가 끼워진 슬롯, 스냅샷 없는 수호기. 그런 프로필은
 * 화면 어딘가에서 조용히 터지거나, 서버에 올라간 뒤 검증에 걸린다.
 *
 * 그래서 여기서는 **결과 상태의 정합성**을 본다. 숫자 자체(크레딧 얼마)는 튜닝 대상이라
 * 잠그지 않는다 — 잠그면 값을 바꿀 때마다 빨개지기만 하고 아무것도 못 막는다.
 */

import { describe, it, expect } from 'vitest';
import { PLANETS } from '../data/planets/index.js';
import { LEVEL_CAP } from '../data/waves.js';
import { activeSlotViews } from '../src/items/activeSkills.js';
import { EQUIP_SLOTS } from '../src/items/types.js';
import { guestPresetProfile } from '../src/save/guestPreset.js';
import { activeShip } from '../src/save/profile.js';
import { flattenShipNodes, shipTypeDef } from '../data/ships/index.js';
import { activeGuardians, canRetireActiveShip } from '../src/save/guardianLifecycle.js';

describe('게스트 프리셋 — 도달 가능한 상태인가', () => {
  it('활성 기체가 만렙이고 8칸이 전부 채워져 있다', () => {
    const p = guestPresetProfile();
    const ship = activeShip(p);
    expect(ship.level).toBe(LEVEL_CAP);
    for (const slot of EQUIP_SLOTS) {
      expect(ship.equipped[slot], `${slot} 이 비어 있다`).toBeDefined();
    }
  });

  it('투자 벡터 길이가 기체 노드 수와 같고 노드별 최대치를 넘지 않는다', () => {
    const p = guestPresetProfile();
    const ship = activeShip(p);
    const nodes = flattenShipNodes(shipTypeDef(ship.typeId));
    expect(ship.skillInvest).toHaveLength(nodes.length);
    nodes.forEach((node, i) => {
      const v = ship.skillInvest[i] ?? 0;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v, `노드 ${i} 가 최대치를 넘었다`).toBeLessThanOrEqual(node.maxPoints);
    });
  });

  it('포인트를 절반쯤 남긴다 — 심사자가 직접 찍어 볼 여지', () => {
    const p = guestPresetProfile();
    const spent = activeShip(p).skillInvest.reduce((a, b) => a + b, 0);
    // 마지막 세대가 버는 99 중 절반을 남기는 설계. 경계를 넉넉히 잡아 곡선 튜닝에 안 걸리게 한다.
    expect(p.skillPoints).toBeGreaterThan(0);
    expect(p.skillPoints).toBeLessThan(spent + p.skillPoints);
  });

  it('장착된 액티브는 전부 실제로 해금돼 있다', () => {
    const p = guestPresetProfile();
    const ship = activeShip(p);
    const equipped = ship.activeSlots.filter((id): id is string => id !== null);
    expect(equipped.length).toBeGreaterThan(0);
    const views = activeSlotViews(ship.typeId, ship.skillInvest, ship.activeSlots);
    for (const id of equipped) {
      const view = views.find((v) => v.def.id === id);
      expect(view, `${id} 는 이 기체의 액티브가 아니다`).toBeDefined();
      expect(view?.unlocked, `${id} 가 잠긴 채 끼워져 있다`).toBe(true);
    }
  });

  it('수호기 2기가 있고 각자 빌드가 박제돼 있다', () => {
    const p = guestPresetProfile();
    const guardians = activeGuardians(p);
    expect(guardians).toHaveLength(2);
    for (const g of guardians) {
      expect(g.snapshot).toBeDefined();
      // 빌드가 비면 예비역 소집·방어 배치에서 "열려 있는데 안 끼워진" 상태가 된다(ADR-0041).
      expect(g.build?.equipped).toBeDefined();
      expect(Object.keys(g.build?.equipped ?? {}).length).toBeGreaterThan(0);
      expect(g.build?.skillInvest.some((v) => v > 0), '수호기가 스킬 없이 박제됐다').toBe(true);
    }
  });

  it('퇴역으로 받은 계보 포인트가 실제로 투자돼 있다', () => {
    const p = guestPresetProfile();
    expect(p.lineage.shipLevel + p.lineage.guardianLevel).toBeGreaterThan(0);
    expect(p.lineage.spent).toBeGreaterThan(0);
  });

  it('전 행성이 클리어돼 있고 강제 튜토리얼은 꺼져 있다', () => {
    const p = guestPresetProfile();
    expect(Object.keys(p.planetProgress)).toHaveLength(PLANETS.length);
    for (let i = 0; i < PLANETS.length; i++) {
      expect(p.planetProgress[i]?.bestStageCleared ?? 0).toBeGreaterThan(0);
    }
    expect(p.tutorialDone).toBe(true);
    // 인트로는 남긴다 — 게임 소개의 일부이고 언제든 스킵된다.
    expect(p.introSeen).toBe(false);
  });

  it('만렙이므로 퇴역 버튼이 열려 있다(세대 순환을 직접 볼 수 있다)', () => {
    expect(canRetireActiveShip(guestPresetProfile())).toBe(true);
  });

  /**
   * 고정 시드로 굴리므로 **내용**은 언제 눌러도 같다 — 스크린샷·재현·심사가 같은 것을 본다.
   *
   * 다만 기체·수호기의 로컬 id 는 시각 기반이라(`makeLocalShipId`/`makeLocalGuardianId`) 호출
   * 마다 다르다. 그건 결함이 아니라 의도다 — 계정 안에서 유일하기만 하면 되고, 오히려 고정
   * 하면 서로 다른 세이브의 id 가 충돌한다. 그래서 id 를 지우고 비교한다.
   */
  it('결정론 — 두 번 만들면 id 를 뺀 내용이 같다', () => {
    const withoutIds = (): string =>
      JSON.stringify(guestPresetProfile(), (key, value) =>
        key === 'id' && typeof value === 'string' && /^(ship|g)-/.test(value) ? undefined : value,
      );
    expect(withoutIds()).toBe(withoutIds());
  });

  it('호출마다 새 객체다 — 배열이 인스턴스 사이로 새지 않는다', () => {
    const a = guestPresetProfile();
    const b = guestPresetProfile();
    activeShip(a).skillInvest[0] = 999;
    expect(activeShip(b).skillInvest[0]).not.toBe(999);
  });
});
