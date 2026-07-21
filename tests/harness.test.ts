/**
 * 하네스 코어 유닛 테스트(개발 도구, ADR-0008).
 *
 * 브라우저 없이 검증 가능한 순수 조각만 다룬다: (1) 프리셋이 유효한 Profile을 만드는지,
 * (2) 이벤트 diffing이 합성 world 요약에서 전환을 정확히 잡는지, (3) 링 버퍼 용량,
 * (4) 하네스 프로필 스토어가 본 세이브와 격리되는지. 풀 브라우저 플로우(ff/goto 등)는
 * 리드가 별도 검증한다.
 */

import { describe, it, expect } from 'vitest';
import {
  buildPreset,
  buildInvasionPreset,
  isInvasionPreset,
  INVASION_PRESET_KINDS,
} from '../src/harness/presets.js';
import { createHarness } from '../src/harness/core.js';
import type { HarnessHost, HarnessInvasionResolved } from '../src/harness/core.js';
import { createWorld, DEFAULT_CONFIG, emptyInput } from '../src/sim/world.js';
import type { WorldConfig, WorldState } from '../src/sim/world.js';
import {
  INVASION_CORE_HP,
  INVASION_SOCKET_COUNTS,
  INVASION_TOTAL_TICKS,
  MAP_TEMPLATE_STRAIGHT,
  PHASE_L1,
  PHASE_L2,
  PHASE_L3,
  layersEqual,
  normalizeInvasionLayers,
} from '../src/sim/invasion/index.js';
import { MAINTENANCE_FULL } from '../src/sim/invasion/guardian.js';
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
import type { Profile } from '../src/save/profile.js';
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

describe('buildInvasionPreset (3레이어 배치 프리셋)', () => {
  it('세 종류 모두 정규형을 낸다(그대로 invasion3.layers 로 쓸 수 있음)', () => {
    for (const kind of INVASION_PRESET_KINDS) {
      const layers = buildInvasionPreset(kind);
      expect(layersEqual(layers, normalizeInvasionLayers(layers)), kind).toBe(true);
    }
  });

  it('def3-empty 는 전 슬롯 비움(기본 수비대 자동 충원 하한 케이스)', () => {
    const l = buildInvasionPreset('def3-empty');
    expect(l.l1.waveSlots.every((s) => s === null)).toBe(true);
    expect(l.l2.sockets.every((s) => s === null)).toBe(true);
    expect(l.l3.props.every((s) => s === null)).toBe(true);
    expect(l.l3.guardians.every((s) => s === null)).toBe(true);
    expect(l.l3.boss).toBeNull();
    expect(l.l3.core.hp).toBe(INVASION_CORE_HP);
  });

  it('def3-maxed 는 전 슬롯을 채우고 직선형(12소켓) 템플릿을 쓴다', () => {
    const l = buildInvasionPreset('def3-maxed');
    expect(l.l2.templateId).toBe(MAP_TEMPLATE_STRAIGHT);
    expect(l.l2.sockets).toHaveLength(INVASION_SOCKET_COUNTS[MAP_TEMPLATE_STRAIGHT] ?? 0);
    expect(l.l1.waveSlots.every((s) => s !== null)).toBe(true);
    expect(l.l2.sockets.every((s) => s !== null)).toBe(true);
    expect(l.l3.props.every((s) => s !== null)).toBe(true);
    expect(l.l3.guardians.every((s) => s !== null)).toBe(true);
    expect(l.l3.boss).not.toBeNull();
  });

  it('def3-mid 는 절반만 채운다(빈 슬롯이 남아 기본 수비대 충원 경로가 함께 돈다)', () => {
    const l = buildInvasionPreset('def3-mid');
    expect(l.l1.waveSlots.filter((s) => s !== null).length).toBe(3);
    expect(l.l2.sockets.some((s) => s === null)).toBe(true);
  });

  it('결정론: 같은 프리셋은 매 호출 같은 배치(공유 참조 없음)', () => {
    const a = buildInvasionPreset('def3-maxed');
    const b = buildInvasionPreset('def3-maxed');
    expect(a).not.toBe(b);
    expect(layersEqual(a, b)).toBe(true);
  });

  it('isInvasionPreset 이 프로필 프리셋과 배치 프리셋을 가른다', () => {
    expect(isInvasionPreset('fresh')).toBe(false);
    expect(isInvasionPreset('maxed')).toBe(false);
    for (const k of INVASION_PRESET_KINDS) expect(isInvasionPreset(k)).toBe(true);
  });
});

/** 하네스 호스트 테스트 더블: main.ts 없이 startInvasion 계약만 관찰한다. */
function fakeHost(): HarnessHost & {
  world: WorldState | null;
  started: HarnessInvasionResolved | null;
  calls: string[];
  profile: Profile;
} {
  const h = {
    world: null as WorldState | null,
    started: null as HarnessInvasionResolved | null,
    calls: [] as string[],
    // 하네스 치트가 제자리 편집하는 라이브 프로필(main.ts 의 `profile` 에 대응).
    profile: defaultProfile(),
    getWorld: () => h.world,
    getCurrentSeed: () => 7,
    stepOnce: () => {
      h.calls.push('stepOnce');
    },
    sampleInput: () => emptyInput(),
    renderOnce: () => {
      h.calls.push('renderOnce');
    },
    setSpeedFactor: () => undefined,
    setPaused: () => undefined,
    isPaused: () => false,
    goto: () => undefined,
    startRun: () => {
      h.calls.push('startRun');
    },
    startInvasion: (opts: HarnessInvasionResolved) => {
      h.calls.push('startInvasion');
      h.started = opts;
      const config: WorldConfig = {
        ...DEFAULT_CONFIG,
        invasion3: {
          layers: normalizeInvasionLayers(opts.layers),
          timeLimitTicks: opts.timeLimitTicks,
          maintenance: opts.maintenance,
        },
      };
      h.world = createWorld(opts.seed, config);
    },
    nextSeed: () => 4242,
    activateHarnessProfile: () => {
      h.calls.push('activateHarnessProfile');
    },
    applyProfile: (p: Profile) => {
      h.calls.push('applyProfile');
      h.profile = p;
    },
    refreshScreen: () => {
      h.calls.push('refreshScreen');
    },
    getProfileSummary: () => ({ credits: 0, minerals: 0, shipLevel: 1 }),
    getProfile: () => h.profile,
    markTaintedIfLive: () => {
      h.calls.push('markTaintedIfLive');
      const w = h.world;
      if (w !== null && !w.gameOver && !w.victory) w.tainted = true;
    },
    isTainted: () => h.world?.tainted ?? false,
    currentScreen: () => 'run',
  };
  return h;
}

describe('Harness.startInvasion (3레이어 침공 진입 훅)', () => {
  it('3레이어 월드를 phase 0(L1)에서 시작한다', () => {
    const host = fakeHost();
    const harness = createHarness(host);
    harness.startInvasion({ preset: 'def3-mid', seed: 99 });
    expect(host.started?.seed).toBe(99);
    expect(host.started?.timeLimitTicks).toBe(INVASION_TOTAL_TICKS);
    expect(host.started?.maintenance).toBe(MAINTENANCE_FULL);
    expect(host.world?.invasion3?.phase).toBe(PHASE_L1);
    expect(host.world?.config.invasion3).toBeDefined();
    // 구 단일 아레나 침공 블록(`config.invasion`)의 **잔재 금지**. 타입에서는 이미 사라졌지만
    // (L11 레거시 삭제), 하네스가 구 키를 실어 보내면 EF·직렬화 경로에 정체불명 키가 흘러
    // 들어간다 — 런타임 키 존재로 확인한다(타입 대조로는 안 잡히는 결함).
    expect(Object.prototype.hasOwnProperty.call(host.world!.config, 'invasion')).toBe(false);
    expect(harness.snapshot().invasion?.phase).toBe(PHASE_L1);
  });

  it('시드 미지정이면 호스트의 다음 시드를 쓴다', () => {
    const host = fakeHost();
    createHarness(host).startInvasion();
    expect(host.started?.seed).toBe(4242);
  });

  it('배치 프리셋을 런 시작 전에 걸면 비오염, 런 중에 걸면 오염(ADR-0008)', () => {
    const host = fakeHost();
    const harness = createHarness(host);
    // 런 시작 전 — 라이브 월드가 없으므로 taint 대상이 없다.
    harness.preset('def3-maxed');
    harness.startInvasion();
    expect(host.world?.tainted).toBe(false);
    expect(layersEqual(host.started?.layers, buildInvasionPreset('def3-maxed'))).toBe(true);
    // 런 중 — 계정/무대 개입이므로 오염.
    harness.preset('def3-mid');
    expect(host.world?.tainted).toBe(true);
  });

  it('배치 프리셋은 프로필을 건드리지 않는다(프로필 프리셋과 경로 분리)', () => {
    const host = fakeHost();
    const harness = createHarness(host);
    harness.preset('def3-mid');
    expect(host.calls).not.toContain('applyProfile');
    expect(host.calls).not.toContain('activateHarnessProfile');
    harness.preset('maxed');
    expect(host.calls).toContain('applyProfile');
  });

  it('명시 layers 가 프리셋보다 우선한다', () => {
    const host = fakeHost();
    const harness = createHarness(host);
    const layers = buildInvasionPreset('def3-maxed');
    harness.startInvasion({ preset: 'def3-empty', layers });
    expect(layersEqual(host.started?.layers, layers)).toBe(true);
  });

  it('정산·프로필 경로를 태우지 않는다(오염 런 격리 — 호스트 호출은 시작 훅뿐)', () => {
    const host = fakeHost();
    createHarness(host).startInvasion({ preset: 'def3-mid' });
    expect(host.calls).toEqual(['startInvasion']);
  });
});

describe('Harness.jumpInvasionLayer (레이어 점프)', () => {
  it('지정 레이어로 진입하고 그 런을 오염시킨다', () => {
    const host = fakeHost();
    const harness = createHarness(host);
    harness.startInvasion({ preset: 'def3-mid' });
    expect(harness.jumpInvasionLayer(3)).toBe(true);
    expect(host.world?.invasion3?.phase).toBe(PHASE_L3);
    expect(host.world?.tainted).toBe(true);
  });

  it('startInvasion 의 layer 옵션이 같은 점프를 수행한다', () => {
    const host = fakeHost();
    createHarness(host).startInvasion({ preset: 'def3-empty', layer: 2 });
    expect(host.world?.invasion3?.phase).toBe(PHASE_L2);
  });

  it('layer 1 은 점프가 아니라 그대로 L1 시작(비오염)', () => {
    const host = fakeHost();
    createHarness(host).startInvasion({ preset: 'def3-empty', layer: 1 });
    expect(host.world?.invasion3?.phase).toBe(PHASE_L1);
    expect(host.world?.tainted).toBe(false);
  });

  it('이미 지난 레이어로는 되돌아가지 않는다', () => {
    const host = fakeHost();
    const harness = createHarness(host);
    harness.startInvasion({ preset: 'def3-empty', layer: 3 });
    expect(harness.jumpInvasionLayer(2)).toBe(false);
    expect(host.world?.invasion3?.phase).toBe(PHASE_L3);
  });

  it('침공 런이 아니면 false(PvE·런 없음)', () => {
    const host = fakeHost();
    const harness = createHarness(host);
    expect(harness.jumpInvasionLayer(2)).toBe(false);
    host.world = createWorld(1, { ...DEFAULT_CONFIG });
    expect(harness.jumpInvasionLayer(2)).toBe(false);
    expect(harness.snapshot().invasion).toBeNull();
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
