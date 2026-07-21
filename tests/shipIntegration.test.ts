/**
 * M8-L7 정규 경로 통합 — **저장된 기체 타입이 실제 런에 도달하는가** (설계서 §10).
 *
 * 이 저장소에서 8번 재발한 결함은 "단위 테스트는 전부 그린인데 배선이 통째로 없다" 이다.
 * 그 유형을 잡는 유일한 방법은 **실제 앱이 부르는 함수**를 타는 것이다 — 그래서 이 파일의
 * 모든 케이스가 `buildRunConfig`(= `src/main.ts` 의 세 호출부가 쓰는 바로 그 함수)를
 * 호출하고, 거기서 나온 config 로 `createWorld` → `stepWorld` 를 진짜로 굴린다.
 *
 * 덮는 항목(설계서 §10 표):
 *  ① §10-1 시그니처 OR-in — Profile{typeId:1} 런의 마스크에 SIG_BRUISER_ARMOR 가 켜지고,
 *     동일 seed·입력의 typeId=0 런과 **관측 결과가 실제로 다르다**
 *  ② §10-2 3중복 조립 — `main.ts` 가 config 를 다시 조립하지 않는다는 grep 게이트
 *  ③ §10-3 연구소 투자 → persist → reload → `buildRunConfig` 반영 왕복
 *  ④ 하네스 기체 타입 치트가 실제로 그 타입 런을 만든다
 *  ⑤ 하네스 런의 오염 격리 — 정산·래더 제출 경로를 태울 수단 자체가 없다(ADR-0008)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildRunConfig } from '../src/run/runConfig.js';
import {
  defaultProfile,
  activeShip,
  investSkill,
  saveProfile,
  loadProfile,
} from '../src/save/profile.js';
import type { KeyValueStore, Profile } from '../src/save/profile.js';
import { createWorld, stepWorld, emptyInput } from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import { hasCapstone } from '../src/sim/capstones.js';
import { SIG_BRUISER_ARMOR, SIG_ARC_OVERCHARGE } from '../src/sim/shipSignature.js';
import { SHIP_TYPES, shipSkillNodeCount, zeroSkillInvest } from '../data/ships/index.js';
import { createHarness } from '../src/harness/core.js';
import type { HarnessHost, HarnessInvasionResolved } from '../src/harness/core.js';
import { normalizeInvasionLayers } from '../src/sim/invasion/index.js';

// ---------------------------------------------------------------------------
// 공통 — 실제 sim 을 굴려 관측값을 모은다.
// ---------------------------------------------------------------------------

const NEUTRAL: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };
/** 런이 조기 종료되지 않게 버티는 무대 상수(프로필 파생값이 아니다). */
const DURABLE_HP = 100_000_000;

function runHashes(seed: number, cfg: WorldConfig, ticks: number): number[] {
  const state = createWorld(seed, { ...cfg, playerHp: DURABLE_HP });
  const out: number[] = [];
  for (let i = 0; i < ticks; i++) {
    stepWorld(state, NEUTRAL);
    out.push(hashWorld(state));
  }
  return out;
}

/** `typeId` 기체 하나를 가진 프로필(무투자). 앱의 기체 교체 결과와 같은 모양. */
function profileWithType(typeId: number): Profile {
  const p = defaultProfile();
  const ship = activeShip(p);
  ship.typeId = typeId;
  ship.skillInvest = zeroSkillInvest(typeId);
  return p;
}

function memStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

// ---------------------------------------------------------------------------
// ① 시그니처 OR-in + 관측 발산 (설계서 §10-1)
// ---------------------------------------------------------------------------

describe('① Profile{typeId} → buildRunConfig → createWorld → stepWorld', () => {
  it('브루저(typeId 1) 런의 uniqueMask 에 SIG_BRUISER_ARMOR 가 켜진다', () => {
    const cfg = buildRunConfig(profileWithType(1), { planet: 0, tier: 0 });
    // ⚠️ 정의만 되고 OR 이 안 되는 결함(§10-1)은 여기서만 잡힌다 — L1·L2·L4 단위 테스트는
    //    전부 통과하면서 패시브만 영구 미발동이 된다.
    expect(hasCapstone(cfg.loadout?.uniqueMask ?? 0, SIG_BRUISER_ARMOR)).toBe(true);
    expect(cfg.shipType).toBe(1);
  });

  it('스트라이커(typeId 0) 런은 시그니처 비트를 하나도 켜지 않는다 (회귀 탐지기 보존)', () => {
    const cfg = buildRunConfig(defaultProfile(), { planet: 0, tier: 0 });
    expect(cfg.loadout?.uniqueMask).toBe(0);
    expect(cfg.shipType).toBe(0);
  });

  it('타입별로 서로 다른 시그니처 비트가 켜진다(한 비트가 전 타입에 새지 않는다)', () => {
    const bruiser = buildRunConfig(profileWithType(1), { planet: 0, tier: 0 });
    const arc = buildRunConfig(profileWithType(2), { planet: 0, tier: 0 });
    expect(hasCapstone(bruiser.loadout?.uniqueMask ?? 0, SIG_ARC_OVERCHARGE)).toBe(false);
    expect(hasCapstone(arc.loadout?.uniqueMask ?? 0, SIG_ARC_OVERCHARGE)).toBe(true);
    expect(hasCapstone(arc.loadout?.uniqueMask ?? 0, SIG_BRUISER_ARMOR)).toBe(false);
  });

  it('동일 seed·입력에서 typeId=1 런과 typeId=0 런의 관측 결과가 실제로 다르다', () => {
    // 마스크 비트만 비교하면 "비트는 켰는데 sim 이 안 읽는" 경우를 놓친다. 여기까지 와야
    // "배선이 있다"고 말할 수 있다(설계서 §10 공통 원칙).
    const striker = runHashes(9182, buildRunConfig(defaultProfile(), { planet: 0, tier: 0 }), 180);
    const bruiser = runHashes(
      9182,
      buildRunConfig(profileWithType(1), { planet: 0, tier: 0 }),
      180,
    );
    expect(bruiser).not.toEqual(striker);
    // 월드가 멈춰 있으면(전부 같은 해시) 이 케이스는 아무것도 증명하지 못한다.
    expect(new Set(striker).size).toBeGreaterThan(90);
    expect(new Set(bruiser).size).toBeGreaterThan(90);
  });

  it('같은 Profile 은 같은 해시 스트림을 낸다 (결정론 — ADR-0005)', () => {
    for (const def of SHIP_TYPES) {
      const cfg = (): WorldConfig => buildRunConfig(profileWithType(def.id), { planet: 0, tier: 0 });
      expect(runHashes(555, cfg(), 90), def.slug).toEqual(runHashes(555, cfg(), 90));
    }
  });

  it('전 타입의 skillInvest 길이가 레지스트리 노드 수와 같다 (해시 폴드 레이아웃)', () => {
    for (const def of SHIP_TYPES) {
      const cfg = buildRunConfig(profileWithType(def.id), { planet: 0, tier: 0 });
      expect(cfg.skillInvest?.length, def.slug).toBe(shipSkillNodeCount(def.id));
    }
  });

  it('손상 세이브의 범위 밖 typeId 는 스트라이커로 되돌아간다(다른 기체를 주지 않는다)', () => {
    for (const bad of [SHIP_TYPES.length, 999, -1, NaN]) {
      const p = defaultProfile();
      activeShip(p).typeId = bad;
      const cfg = buildRunConfig(p, { planet: 0, tier: 0 });
      expect(cfg.shipType, String(bad)).toBe(0);
      expect(cfg.loadout?.uniqueMask, String(bad)).toBe(0);
    }
  });

  it('침공 설정을 넘겨도 같은 조립을 탄다 (PvE·침공이 갈리지 않는다)', () => {
    const invasion3 = {
      layers: normalizeInvasionLayers(undefined),
      timeLimitTicks: 600,
      maintenance: 10_000,
    };
    const pve = buildRunConfig(profileWithType(1), { planet: 0, tier: 0 });
    const inv = buildRunConfig(profileWithType(1), { planet: 0, tier: 0, invasion3 });
    expect(inv.invasion3).toBe(invasion3);
    // invasion3 를 뺀 나머지는 PvE 와 완전히 동일해야 한다 — 침공 경로만 타입을 잃는
    // 결함(main.ts 3중복 시절의 전형)이 여기서 잡힌다.
    const { invasion3: _dropped, ...rest } = inv;
    expect(rest).toEqual(pve);
  });
});

// ---------------------------------------------------------------------------
// ② §10-2 grep 게이트 — main.ts 가 조립을 되살리지 못하게 못박는다.
// ---------------------------------------------------------------------------

/** 저장소 상대 경로의 소스를 읽는다(`tests/node-shims.d.ts` 의 readFileSync 는 인코딩 인자 없음). */
function readSrc(rel: string): string {
  const url = new URL(`../${rel}`, import.meta.url);
  return new TextDecoder().decode(readFileSync(url.pathname.replace(/^\/([A-Za-z]:)/, '$1')));
}

describe('② 런 조립 단일 정본 grep 게이트 (설계서 §10-2)', () => {
  const MAIN = readSrc('src/main.ts');

  it('main.ts 의 런 시작 3경로가 전부 buildRunConfig 를 부른다', () => {
    // 정식 침공(startInvasionRun) · 하네스 침공(startHarnessInvasionRun) · PvE(startRun).
    const calls = MAIN.match(/buildRunConfig\(/g) ?? [];
    expect(calls.length).toBe(3);
  });

  it('main.ts 에 computeLoadoutStats 직접 호출이 남아 있지 않다', () => {
    // 남아 있으면 그 자리가 곧 4번째 조립 사이트다 — 다음 레인이 typeId·신규 필드를
    // 여기에만 안 넣어 "저장은 되는데 런에 안 닿는" 결함이 재발한다.
    expect(MAIN.includes('computeLoadoutStats(')).toBe(false);
  });

  it('main.ts 가 WorldConfig 리터럴을 직접 조립하지 않는다', () => {
    expect(MAIN.includes('...DEFAULT_CONFIG')).toBe(false);
  });

  it('main.ts 의 런 시작 3경로가 전부 기체 스프라이트를 교체한다 (W4 게이트 신규)', () => {
    // ⚠️ 이것이 "정의만 되고 배선이 없다"의 M8 실사례다. `loadGameTextures(renderer, shipType)`
    // 의 `shipType` 인자는 W4 게이트 시점까지 **호출부가 0건**이었다 — 전 타입이 인게임에서
    // player.png 로 떴는데 단위 테스트는 basename 유도만 보므로 전부 그린이었다.
    //
    // 부팅 1회 로드로는 부족하다: 기체는 챔피언 선택으로 런 **사이**에 바뀌고, 텍스처는
    // 부팅 때 한 번만 로드된다. 그래서 교체는 런 시작마다 동기로 일어나야 하고, 그 지점은
    // `buildRunConfig` 호출부와 정확히 같은 3곳이다.
    const applies = MAIN.match(/applyShipSprite\(/g) ?? [];
    const builds = MAIN.match(/buildRunConfig\(/g) ?? [];
    expect(applies.length).toBe(builds.length);

    // 순서 계약: 각 교체는 그 경로의 `createWorld` **앞**이어야 한다. EntityRenderer 가
    // 스프라이트 생성 시점에 `textures.player` 를 읽으므로, 뒤에 있으면 그 런 내내 옛 기체다.
    const applyIdx = [...MAIN.matchAll(/applyShipSprite\(/g)].map((m) => m.index ?? -1);
    const worldIdx = [...MAIN.matchAll(/createWorld\(/g)].map((m) => m.index ?? -1);
    for (const a of applyIdx) {
      const next = worldIdx.find((w) => w > a);
      expect(next, 'applyShipSprite 뒤에 createWorld 가 와야 한다').toBeGreaterThan(a);
    }
  });

  it('앱 전체에 profile.skillInvest 참조가 0건이다 (계정 단위 벡터 삭제 — 설계서 §6)', () => {
    // `Profile.skillInvest` 는 M8-L7 이 삭제했다. 남아 있으면 "연구소는 미러에 쓰는데 런은
    // 기체 벡터를 읽는" 무배선 결함(§10-3)이 되살아난다. tsc 가 1차 방어선이고 이것이 2차다.
    const files = [
      'src/main.ts',
      'src/run/runConfig.ts',
      'src/save/profile.ts',
      'src/save/guardianLifecycle.ts',
      'src/ui/researchLab.ts',
      'src/ui/pixi/researchLab.ts',
    ];
    for (const f of files) {
      const src = readSrc(f);
      // 주석 안의 서술(`Profile.skillInvest` 는 삭제됐다 등)은 코드가 아니므로 제외한다.
      const code = src
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
      expect(/\bprofile\.skillInvest\b/.test(code), f).toBe(false);
      expect(/\bthis\.profile\.skillInvest\b/.test(code), f).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// ③ §10-3 연구소 투자 → persist → reload → 런 반영 왕복
// ---------------------------------------------------------------------------

describe('③ 투자 → 저장 → 재로드 → buildRunConfig 왕복', () => {
  it('연구소가 부르는 investSkill 결과가 재로드 후 런 설정까지 흘러간다', () => {
    const store = memStore();
    const p = defaultProfile();
    p.skillPoints = 3;
    expect(investSkill(p, 0)).toBe(true); // 연구소가 부르는 바로 그 함수
    saveProfile(p, store);

    const reloaded = loadProfile(store);
    const cfg = buildRunConfig(reloaded, { planet: 0, tier: 0 });
    expect(cfg.skillInvest?.[0]).toBe(1);
    // 저장 직전 프로필과 재로드 프로필이 같은 런을 만든다(직렬화 왕복 무손실).
    expect(cfg).toEqual(buildRunConfig(p, { planet: 0, tier: 0 }));
    // 투자가 파생 스탯으로 실제로 접혔는가(중립 loadout 이 아님).
    expect(cfg.loadout).not.toEqual(
      buildRunConfig(defaultProfile(), { planet: 0, tier: 0 }).loadout,
    );
    // sim 이 실제로 다르게 굴러가는가.
    expect(runHashes(31337, cfg, 120)).not.toEqual(
      runHashes(31337, buildRunConfig(defaultProfile(), { planet: 0, tier: 0 }), 120),
    );
  });

  it('런 config 의 벡터는 복사본이라 런 도중 투자가 라이브 월드로 새지 않는다', () => {
    const p = defaultProfile();
    p.skillPoints = 3;
    const cfg = buildRunConfig(p, { planet: 0, tier: 0 });
    investSkill(p, 0);
    expect(activeShip(p).skillInvest[0]).toBe(1);
    expect(cfg.skillInvest?.[0]).toBe(0); // 이미 시작한 런은 영향받지 않는다
  });

  it('기체를 바꾸면 그 기체의 벡터가 런에 실린다(옛 기체 투자가 따라오지 않는다)', () => {
    const p = defaultProfile();
    p.skillPoints = 3;
    investSkill(p, 0);
    p.ships.push({
      id: 'ship-1',
      name: '2번기',
      typeId: 1,
      level: 1,
      xp: 0,
      equipped: {},
      skillInvest: zeroSkillInvest(1),
    });
    p.activeShipIndex = 1;
    const cfg = buildRunConfig(p, { planet: 0, tier: 0 });
    expect(cfg.shipType).toBe(1);
    expect(cfg.skillInvest?.every((v) => v === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ④·⑤ 하네스 — 기체 타입 치트 + 오염 격리
// ---------------------------------------------------------------------------

/**
 * 하네스 호스트 테스트 더블. **`startRun` 이 `buildRunConfig` 를 탄다** — main.ts 의
 * 호스트 구현(`startRun` → 게임 내부 `startRun` → `buildRunConfig`)과 같은 seam 이므로,
 * "치트로 바꾼 타입이 실제 런 config 에 도달하는가"를 이 더블로 관측할 수 있다.
 */
function fakeHost(): HarnessHost & {
  profile: Profile;
  world: WorldState | null;
  lastConfig: WorldConfig | null;
  calls: string[];
} {
  const h = {
    profile: defaultProfile(),
    world: null as WorldState | null,
    lastConfig: null as WorldConfig | null,
    calls: [] as string[],
    getWorld: () => h.world,
    getCurrentSeed: () => 7,
    stepOnce: () => undefined,
    sampleInput: () => emptyInput(),
    renderOnce: () => undefined,
    setSpeedFactor: () => undefined,
    setPaused: () => undefined,
    isPaused: () => false,
    goto: () => undefined,
    startRun: (opts: { seed: number; planet: number; tier: number; anomaly: boolean }) => {
      h.calls.push('startRun');
      const config = buildRunConfig(h.profile, {
        planet: opts.planet,
        tier: opts.tier,
        anomalyAccepted: opts.anomaly,
      });
      h.lastConfig = config;
      h.world = createWorld(opts.seed, { ...config, playerHp: DURABLE_HP });
    },
    startInvasion: (opts: HarnessInvasionResolved) => {
      h.calls.push('startInvasion');
      const config = buildRunConfig(h.profile, {
        planet: 0,
        tier: 0,
        invasion3: {
          layers: normalizeInvasionLayers(opts.layers),
          timeLimitTicks: opts.timeLimitTicks,
          maintenance: opts.maintenance,
        },
      });
      h.lastConfig = config;
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

describe('④ 하네스 기체 타입 치트', () => {
  it('치트로 바꾼 타입이 실제 런 config 의 shipType·시그니처까지 도달한다', () => {
    const host = fakeHost();
    const harness = createHarness(host);
    expect(harness.setShipType(1)).toBe(1);
    harness.startRun({ seed: 123 });
    expect(host.lastConfig?.shipType).toBe(1);
    expect(hasCapstone(host.lastConfig?.loadout?.uniqueMask ?? 0, SIG_BRUISER_ARMOR)).toBe(true);
  });

  it('투자 벡터를 그 타입의 무투자 벡터로 초기화한다(옛 타입 벡터를 오독하지 않는다)', () => {
    const host = fakeHost();
    const harness = createHarness(host);
    host.profile.skillPoints = 3;
    investSkill(host.profile, 0);
    harness.setShipType(4);
    const ship = activeShip(host.profile);
    expect(ship.typeId).toBe(4);
    expect(ship.skillInvest).toHaveLength(shipSkillNodeCount(4));
    expect(ship.skillInvest.every((v) => v === 0)).toBe(true);
  });

  it('본 세이브를 건드리지 않는다(하네스 프로필 슬롯을 먼저 활성화)', () => {
    const host = fakeHost();
    createHarness(host).setShipType(2);
    expect(host.calls).toContain('activateHarnessProfile');
    expect(host.calls).toContain('applyProfile');
  });

  it('범위 밖 값은 0(스트라이커)으로 되돌린다', () => {
    const host = fakeHost();
    const harness = createHarness(host);
    for (const bad of [SHIP_TYPES.length, 999, -1, NaN]) {
      expect(harness.setShipType(bad), String(bad)).toBe(0);
      expect(activeShip(host.profile).typeId, String(bad)).toBe(0);
    }
  });

  it('런 시작 **전에** 걸면 비오염, 런 중에 걸면 오염(ADR-0008)', () => {
    const before = fakeHost();
    const h1 = createHarness(before);
    h1.setShipType(1);
    h1.startRun({ seed: 1 });
    expect(before.world?.tainted ?? false).toBe(false);

    const during = fakeHost();
    const h2 = createHarness(during);
    h2.startRun({ seed: 1 });
    h2.setShipType(1);
    expect(during.world?.tainted).toBe(true);
    // 도는 런의 shipType 은 createWorld 시점에 봉인돼 바뀌지 않는다.
    expect(during.world?.config.shipType).toBe(0);
  });

  it('shipTypeSlugs · snapshot().shipTypeId 가 레지스트리와 정합한다', () => {
    const host = fakeHost();
    const harness = createHarness(host);
    expect(harness.shipTypeSlugs()).toEqual(SHIP_TYPES.map((d): string => d.slug));
    harness.setShipType(3);
    expect(harness.snapshot().shipTypeId).toBe(3);
  });
});

describe('⑤ 하네스 런 오염 격리 (ADR-0008)', () => {
  it('HarnessHost 에 정산·래더 제출 수단이 아예 없다', () => {
    // 구조적 보장: 호스트 seam 에 그 문이 없으면 하네스는 어떤 경로로도 제출할 수 없다.
    const host = fakeHost();
    const keys = Object.keys(host);
    for (const forbidden of ['settle', 'settleRun', 'submitInvasion', 'submit', 'recordPveRun']) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
  });

  it('하네스 침공은 시작 훅 외에 어떤 호스트 경로도 부르지 않는다', () => {
    const host = fakeHost();
    createHarness(host).startInvasion({ preset: 'def3-mid', seed: 99 });
    expect(host.calls).toEqual(['startInvasion']);
  });

  it('하네스 기체 타입 치트도 프로필 경로만 건드린다(런 제출 경로 무관)', () => {
    const host = fakeHost();
    createHarness(host).setShipType(1);
    expect(host.calls).toEqual(['activateHarnessProfile', 'markTaintedIfLive', 'applyProfile', 'refreshScreen']);
  });
});
