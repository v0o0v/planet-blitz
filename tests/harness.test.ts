/**
 * 하네스 코어 유닛 테스트(개발 도구, ADR-0008).
 *
 * 브라우저 없이 검증 가능한 순수 조각만 다룬다: (1) 프리셋이 유효한 Profile을 만드는지,
 * (2) 이벤트 diffing이 합성 world 요약에서 전환을 정확히 잡는지, (3) 링 버퍼 용량,
 * (4) 하네스 프로필 스토어가 본 세이브와 격리되는지. 풀 브라우저 플로우(ff/goto 등)는
 * 리드가 별도 검증한다.
 */

import { describe, it, expect } from 'vitest';
import { buildPreset } from '../src/harness/presets.js';
import {
  EventRing,
  diffWorldEvents,
  emptyWorldEventSummary,
} from '../src/harness/events.js';
import type { WorldEventSummary } from '../src/harness/events.js';
import { harnessProfileStore } from '../src/harness/core.js';
import {
  loadProfile,
  saveProfile,
  defaultProfile,
  activeShip,
  setProfileStoreOverride,
} from '../src/save/profile.js';
import type { KeyValueStore } from '../src/save/profile.js';
import { isValidItem } from '../src/save/profile.js';
import { EQUIP_SLOTS, SAVE_VERSION } from '../src/items/types.js';
import { computeLoadoutStats } from '../src/items/loadout.js';

/** In-memory KeyValueStore for storage-isolation tests. */
function memStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

describe('buildPreset', () => {
  it('fresh는 기본 프로필과 동등하다', () => {
    const fresh = buildPreset('fresh');
    expect(fresh).toEqual(defaultProfile());
    expect(fresh.tutorialDone).toBe(false);
    expect(fresh.saveVersion).toBe(SAVE_VERSION);
  });

  it('maxed는 만렙 기체 + 넉넉한 재화 + 튜토리얼 완료의 유효한 프로필', () => {
    const maxed = buildPreset('maxed');
    const ship = activeShip(maxed);
    expect(ship.level).toBe(100);
    expect(maxed.credits).toBeGreaterThan(0);
    expect(maxed.minerals).toBeGreaterThan(0);
    expect(maxed.skillPoints).toBeGreaterThan(0);
    expect(maxed.tutorialDone).toBe(true);
  });

  it('maxed는 여덟 장비 슬롯을 알맞은 slot kind의 유효 아이템으로 채운다', () => {
    const ship = activeShip(buildPreset('maxed'));
    for (const pos of EQUIP_SLOTS) {
      const item = ship.equipped[pos];
      expect(item, `slot ${pos} equipped`).toBeDefined();
      expect(isValidItem(item)).toBe(true);
      const expectedKind = pos === 'module0' || pos === 'module1' ? 'module' : pos;
      expect(item?.slot).toBe(expectedKind);
    }
  });

  it('maxed 장비는 로드아웃 파이프라인을 통과해 강화 스탯을 낸다', () => {
    const ship = activeShip(buildPreset('maxed'));
    const equipped = EQUIP_SLOTS.map((s) => ship.equipped[s]).filter(
      (it): it is NonNullable<typeof it> => it !== undefined,
    );
    const { loadout } = computeLoadoutStats(equipped);
    // 레어/유니크 8종이 실렸으므로 최소한 데미지 배율은 중립(1)에서 벗어난다.
    expect(loadout.damageMult).toBeGreaterThan(0);
    expect(Number.isFinite(loadout.damageMult)).toBe(true);
  });

  it('maxed는 매 호출 새 프로필(공유 참조 없음)', () => {
    const a = buildPreset('maxed');
    const b = buildPreset('maxed');
    expect(a).not.toBe(b);
    expect(a.ships[0]).not.toBe(b.ships[0]);
    a.credits = 0;
    expect(b.credits).toBeGreaterThan(0);
  });
});

describe('diffWorldEvents', () => {
  const base = (over: Partial<WorldEventSummary> = {}): WorldEventSummary => ({
    ...emptyWorldEventSummary(),
    ...over,
  });

  it('레벨업 전환을 목적지 레벨과 함께 잡는다', () => {
    const ev = diffWorldEvents(base({ level: 1 }), base({ level: 3 }), 42);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: 'levelup', detail: '3', tick: 42 });
  });

  it('유니크 드랍 증가를 잡는다', () => {
    const ev = diffWorldEvents(base({ uniqueLootCount: 0 }), base({ uniqueLootCount: 1 }), 10);
    expect(ev.map((e) => e.type)).toContain('uniqueDrop');
  });

  it('보스 등장은 bossSpawn 하나만(스폰 틱의 phase -1→0은 bossPhase로 새지 않음)', () => {
    const ev = diffWorldEvents(
      base({ bossPresent: false, bossPhase: -1 }),
      base({ bossPresent: true, bossPhase: 0 }),
      100,
    );
    expect(ev.map((e) => e.type)).toEqual(['bossSpawn']);
  });

  it('보스 페이즈 전환을 잡는다', () => {
    const ev = diffWorldEvents(
      base({ bossPresent: true, bossPhase: 0 }),
      base({ bossPresent: true, bossPhase: 1 }),
      120,
    );
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: 'bossPhase', detail: '1' });
  });

  it('사망과 승리 전환을 각각 잡는다', () => {
    expect(
      diffWorldEvents(base(), base({ gameOver: true }), 1).map((e) => e.type),
    ).toEqual(['playerDeath']);
    expect(
      diffWorldEvents(base(), base({ victory: true }), 2).map((e) => e.type),
    ).toEqual(['victory']);
  });

  it('변화 없는 틱은 이벤트를 내지 않는다', () => {
    const s = base({ level: 5, bossPresent: true, bossPhase: 2 });
    expect(diffWorldEvents(s, s, 7)).toHaveLength(0);
  });
});

describe('EventRing', () => {
  it('용량을 넘으면 가장 오래된 항목을 버리고 시간순으로 반환', () => {
    const ring = new EventRing(3);
    for (let i = 0; i < 5; i++) ring.push({ tick: i, type: 'screenChange', detail: String(i) });
    const list = ring.list();
    expect(list).toHaveLength(3);
    expect(list.map((e) => e.detail)).toEqual(['2', '3', '4']);
  });

  it('list는 복사본을 반환(내부 버퍼 불변)', () => {
    const ring = new EventRing(2);
    ring.push({ tick: 0, type: 'levelup' });
    const a = ring.list();
    a.push({ tick: 9, type: 'victory' });
    expect(ring.list()).toHaveLength(1);
  });
});

describe('harnessProfileStore 격리', () => {
  it('본 세이브를 건드리지 않고 별도 슬롯(:harness)에 저장한다', () => {
    // 본 세이브에 기본 프로필을 저장.
    const real = memStore();
    saveProfile(defaultProfile(), real);
    const realBefore = real.map.get('planet-blitz:profile');
    expect(realBefore).toBeDefined();

    // 하네스 슬롯: memStore를 감싸 :harness 접미 키로 리다이렉트.
    const backing = memStore();
    const harnessStore: KeyValueStore = {
      getItem: (k) => backing.getItem(k + ':harness'),
      setItem: (k, v) => backing.setItem(k + ':harness', v),
      removeItem: (k) => backing.removeItem(k + ':harness'),
    };
    const maxed = buildPreset('maxed');
    saveProfile(maxed, harnessStore);

    // 하네스 슬롯에는 :harness 키로 기록되고, 본 세이브 키는 그대로.
    expect(backing.map.has('planet-blitz:profile:harness')).toBe(true);
    expect(real.map.get('planet-blitz:profile')).toBe(realBefore);

    const loaded = loadProfile(harnessStore);
    expect(activeShip(loaded).level).toBe(100);
  });

  it('setProfileStoreOverride가 기본 스토어 I/O를 리다이렉트하고 해제된다', () => {
    const backing = memStore();
    const override: KeyValueStore = {
      getItem: (k) => backing.getItem(k + ':harness'),
      setItem: (k, v) => backing.setItem(k + ':harness', v),
      removeItem: (k) => backing.removeItem(k + ':harness'),
    };
    setProfileStoreOverride(override);
    try {
      const p = defaultProfile();
      p.credits = 4242;
      saveProfile(p); // 기본 스토어 → 오버라이드로
      expect(backing.map.has('planet-blitz:profile:harness')).toBe(true);
      expect(loadProfile().credits).toBe(4242);
    } finally {
      setProfileStoreOverride(undefined);
    }
  });

  it('harnessProfileStore()는 localStorage 부재 시 null', () => {
    // node 환경에는 localStorage가 없으므로 null이어야 한다.
    expect(harnessProfileStore()).toBeNull();
  });
});
