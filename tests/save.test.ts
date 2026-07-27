import { describe, it, expect } from 'vitest';
import { buildRunConfig } from '../src/run/runConfig.js';
import {
  loadProfile,
  saveProfile,
  migrate,
  defaultProfile,
  stashCapacity,
  activeShip,
  INVENTORY_CAP,
  MAX_STASH_EXPANSIONS,
  type KeyValueStore,
  type Profile,
} from '../src/save/profile.js';
import {
  settleRun,
  grantXp,
  salvageValue,
  salvageItems,
} from '../src/save/settlement.js';
import { rollItem } from '../src/items/roll.js';
import { xpToNextMeta } from '../src/save/progressionPath.js';
import type { LootRecord } from '../src/sim/world.js';
import {
  investSkill,
  respecSkills,
  totalInvested,
  zeroSkillInvest,
  normalizeSkillInvest,
} from '../src/save/profile.js';
import { retireAtCap } from './support/retireAtCap.js';
import { makeGuardianSnapshot } from '../data/guardian.js';
import { SAVE_VERSION } from '../src/items/types.js';
import { SKILL_NODE_COUNT, SKILLS } from '../data/skills.js';
import {
  SHIP_TYPES,
  selectableShipTypes,
  shipSkillNodeCount,
  shipTypeDef,
  flattenShipNodes,
  shipCapstoneIndex,
} from '../data/ships/index.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import type { WorldConfig, InputFrame } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';

/** In-memory KeyValueStore so tests run under the `node` vitest environment. */
function memStore(seed?: Record<string, string>): KeyValueStore {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const KEY = 'planet-blitz:profile';

function loot(seed: number, rarity: number, planet = 0, stage = 1): LootRecord {
  return { seed, rarity, planet, stage };
}

describe('profile — save/load round-trip (AC5)', () => {
  it('a fresh default profile survives save→load losslessly', () => {
    const store = memStore();
    const p = defaultProfile();
    saveProfile(p, store);
    expect(loadProfile(store)).toEqual(p);
  });

  it('a populated profile survives save→load losslessly', () => {
    const store = memStore();
    const p = defaultProfile();
    p.inventory.push(rollItem(111, 'rare', { planet: 0, stage: 11 }));
    p.stash.push(rollItem(222, 'magic', { planet: 1, stage: 1 }));
    const ship = activeShip(p);
    ship.equipped.main = rollItem(333, 'unique', { planet: 0, stage: 1 });
    ship.level = 7;
    ship.xp = 12;
    p.credits = 340;
    p.minerals = 15;
    p.skillPoints = 6;
    p.stashExpansions = 2;
    p.planetProgress[1] = { bestStageCleared: 11 };
    saveProfile(p, store);
    expect(loadProfile(store)).toEqual(p);
  });

  it('missing storage falls back to a default profile', () => {
    expect(loadProfile(null)).toEqual(defaultProfile());
  });
});

describe('profile — corruption recovery (AC5)', () => {
  it('invalid JSON recovers to default', () => {
    expect(loadProfile(memStore({ [KEY]: '{not json' }))).toEqual(defaultProfile());
  });

  it('a non-object blob recovers to default', () => {
    expect(loadProfile(memStore({ [KEY]: '42' }))).toEqual(defaultProfile());
  });

  it('drops malformed items but keeps valid ones', () => {
    const good = rollItem(9, 'rare', { planet: 0, stage: 1 });
    const blob = JSON.stringify({
      saveVersion: 1,
      ships: [{ id: 'ship-0', name: 'x', level: 3, xp: 1, equipped: {} }],
      activeShipIndex: 0,
      inventory: [good, { junk: true }, null, 5],
      stash: [],
      stashExpansions: 9, // out of range → clamped
      planetProgress: {},
      credits: 10,
      minerals: 0,
      skillPoints: 0,
    });
    const p = loadProfile(memStore({ [KEY]: blob }));
    expect(p.inventory).toEqual([good]);
    expect(p.stashExpansions).toBe(MAX_STASH_EXPANSIONS);
  });
});

describe('profile — migration v0 → v1 (AC5)', () => {
  it('renames legacy `ship`/`gold` into `ships`/`credits`', () => {
    const v0 = {
      // no saveVersion → treated as v0
      ship: { id: 'ship-0', name: '초기 전투기', level: 5, xp: 3, equipped: {} },
      inventory: [],
      gold: 250,
    };
    const p = migrate(v0);
    // The migration chain (v0→v1→v2) normalizes to the current schema version.
    expect(p.saveVersion).toBe(SAVE_VERSION);
    expect(p.ships).toHaveLength(1);
    expect(p.ships[0]?.level).toBe(5);
    expect(p.credits).toBe(250);
    expect(activeShip(p).name).toBe('초기 전투기');
    // v2 fills a zeroed skill vector for a pre-M3 blob (v4 부터 정본은 기체 벡터다).
    expect(activeShip(p).skillInvest).toHaveLength(SKILL_NODE_COUNT);
    expect(activeShip(p).skillInvest.every((v: number) => v === 0)).toBe(true);
  });
});

describe('stashCapacity (AC6)', () => {
  it('grows 32 slots per expansion up to the cap and clamps beyond it', () => {
    expect(stashCapacity(0)).toBe(32);
    expect(stashCapacity(1)).toBe(64);
    expect(stashCapacity(2)).toBe(96);
    expect(stashCapacity(3)).toBe(128);
    expect(stashCapacity(4)).toBe(160);
    // 상한(MAX_STASH_EXPANSIONS=4) 초과 입력은 정규화가 잘라낸다 — 비용 함수·UI 와 같은 상한.
    expect(stashCapacity(MAX_STASH_EXPANSIONS)).toBe(160);
    expect(stashCapacity(9)).toBe(160);
    expect(stashCapacity(-1)).toBe(32);
  });
});

describe('settleRun — loot → items + leveling (AC3/AC11)', () => {
  it('confirms each loot record deterministically via rollItem', () => {
    const p = defaultProfile();
    const records: LootRecord[] = [loot(101, 2, 0, 11), loot(202, 3, 1, 1)];
    const out = settleRun(p, { victory: true, loot: records, xpTotal: 0, resources: 0 });
    expect(out.itemsGained).toHaveLength(2);
    expect(p.inventory).toHaveLength(2);
    // Same seeds re-roll to byte-identical items.
    expect(out.itemsGained[0]).toEqual(rollItem(101, 'rare', { planet: 0, stage: 11 }));
    expect(out.itemsGained[1]).toEqual(rollItem(202, 'unique', { planet: 1, stage: 1 }));
  });

  it('banks XP onto the active ship and grants one skill point per level', () => {
    const p = defaultProfile();
    // Enough XP for exactly two levels from level 1. 기체 레벨은 **메타 풀** 커브를 탄다
    // (ADR-0036) — 런 내 성장 커브(`xpToNext`)와 별개 축이라 여기서 섞으면 안 된다.
    const need = xpToNextMeta(1) + xpToNextMeta(2);
    const out = settleRun(p, { victory: false, loot: [], xpTotal: need, resources: 0 });
    expect(activeShip(p).level).toBe(3);
    expect(out.levelsGained).toBe(2);
    expect(p.skillPoints).toBe(2);
  });

  it('overflows into stash then reports leftovers when both are full', () => {
    const p = defaultProfile();
    p.stashExpansions = 0; // stash cap 32
    // Fill inventory (48) and stash (32) so the next drop overflows.
    for (let i = 0; i < INVENTORY_CAP; i++) p.inventory.push(rollItem(i + 1, 'normal', { planet: 0, stage: 1 }));
    for (let i = 0; i < 32; i++) p.stash.push(rollItem(1000 + i, 'normal', { planet: 0, stage: 1 }));
    const out = settleRun(p, { victory: true, loot: [loot(5000, 2)], xpTotal: 0, resources: 0 });
    expect(out.overflow).toBe(1);
    expect(p.inventory).toHaveLength(INVENTORY_CAP);
  });

  it('converts raid resources to a credit delta without touching the mirror (ADR-0027)', () => {
    // 재화 서버 권위: 순수 정산은 creditsGained 델타를 계산·반환만 하고 프로필 미러(credits)에
    // 가산하지 않는다 — 지급은 호출부가 온라인=서버 RPC / 미설정=로컬 미러로 가른다.
    const p = defaultProfile();
    const out = settleRun(p, { victory: true, loot: [], xpTotal: 0, resources: 4 });
    expect(out.creditsGained).toBe(4);
    expect(p.credits).toBe(0); // 순수 정산은 재화를 창조하지 않는다(위조 불가 계약)
  });
});

describe('grantXp — level curve', () => {
  it('does not level when XP is insufficient', () => {
    const ship = activeShip(defaultProfile());
    expect(grantXp(ship, xpToNextMeta(1) - 1)).toBe(0);
    expect(ship.level).toBe(1);
  });
});

describe('salvage — bulk disenchant (AC6)', () => {
  it('normal/magic yield credits, rare+ yield minerals', () => {
    expect(salvageValue(rollItem(1, 'normal', { planet: 0, stage: 1 }))).toEqual({ credits: 2, minerals: 0 });
    expect(salvageValue(rollItem(1, 'magic', { planet: 0, stage: 1 }))).toEqual({ credits: 5, minerals: 0 });
    expect(salvageValue(rollItem(1, 'rare', { planet: 0, stage: 1 })).minerals).toBe(3);
    expect(salvageValue(rollItem(1, 'unique', { planet: 0, stage: 1 })).minerals).toBe(8);
  });

  it('scales mineral yield by the loadout mineral-find mult', () => {
    const rare = rollItem(1, 'rare', { planet: 0, stage: 1 });
    expect(salvageValue(rare, 2).minerals).toBe(6);
  });

  it('removes salvaged items and returns the yield without touching the mirror (ADR-0027)', () => {
    // 재화 서버 권위: salvageItems 는 아이템만 제거하고 획득 재화를 반환한다 — 미러 가산은
    // 호출부(온라인=grant_currency / 미설정=로컬)가 맡는다.
    const p: Profile = defaultProfile();
    const normal = rollItem(1, 'normal', { planet: 0, stage: 1 });
    const rare = rollItem(2, 'rare', { planet: 0, stage: 1 });
    p.inventory.push(normal, rare);
    const y = salvageItems(p, [normal, rare]);
    expect(y.credits).toBe(2);
    expect(y.minerals).toBe(3);
    expect(p.inventory).toHaveLength(0);
    expect(p.credits).toBe(0); // 순수 살베지는 미러를 만지지 않는다
    expect(p.minerals).toBe(0);
  });

  it('matches salvage targets by item.id, not reference identity (리뷰 LOW-3)', () => {
    // 인벤토리에 보관된 인스턴스와, 정산에서 다시 롤한(직렬화·복원 등) 동일 아이템이
    // 서로 다른 객체여도 같은 id면 제거돼야 한다.
    const p: Profile = defaultProfile();
    const stored = rollItem(2, 'rare', { planet: 0, stage: 1 });
    p.inventory.push(stored);
    // 동일 seed/rarity/source로 다시 롤 → 값은 같지만 참조는 다른 새 인스턴스.
    const reRolled = rollItem(2, 'rare', { planet: 0, stage: 1 });
    expect(reRolled).not.toBe(stored);
    expect(reRolled.id).toBe(stored.id);
    const y = salvageItems(p, [reRolled]);
    expect(y.minerals).toBe(3);
    expect(p.inventory).toHaveLength(0); // 참조가 달라도 id로 매칭돼 제거됨
  });
});

// ===========================================================================
// M8 v4 — skillInvest 를 기체 단위로 내린다 (설계서 §6, ADR-0019)
// ===========================================================================

/** v3(계정 단위) 세이브 blob. `skillInvest` 가 Profile 최상위에 있던 시절의 형태. */
function v3Blob(invest: unknown, ships = 1): Record<string, unknown> {
  return {
    saveVersion: 3,
    ships: Array.from({ length: ships }, (_, i) => ({
      id: `ship-${i}`, name: '초기 전투기', level: 5, xp: 0, equipped: {},
    })),
    activeShipIndex: 0,
    inventory: [], stash: [], stashExpansions: 0, planetProgress: {},
    credits: 10, minerals: 0, skillPoints: 0, tutorialDone: true,
    skillInvest: invest,
  };
}

describe('introSeen — 세계관 인트로 1회 노출 플래그 (스토리 시스템)', () => {
  it('신규 프로필은 introSeen=false 로 시작한다(첫 실행 시 인트로 노출)', () => {
    expect(defaultProfile().introSeen).toBe(false);
  });

  it('기존 세이브(필드 부재)는 introSeen=false 로 정규화된다 — 스토리 리빌을 1회 본다', () => {
    // 마이그레이션은 끝에서 normalizeProfile 을 거친다. tutorialDone 과 달리 강제 스탬프하지
    // 않으므로 기존 유저도 다음 부팅에 인트로를 1회 본다(언제든 스킵·기록 보관소 재생 가능).
    const p = migrate(v3Blob(zeroSkillInvest(0)));
    expect(p.introSeen).toBe(false);
  });

  it('introSeen:true 세이브는 유지된다(재노출 안 함)', () => {
    const blob = { ...v3Blob(zeroSkillInvest(0)), introSeen: true };
    expect(migrate(blob).introSeen).toBe(true);
  });

  it('save→load 왕복이 introSeen 을 보존한다', () => {
    const store = new Map<string, string>();
    const kv: KeyValueStore = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    };
    const p = defaultProfile();
    p.introSeen = true;
    saveProfile(p, kv);
    expect(loadProfile(kv).introSeen).toBe(true);
  });
});

describe('마이그레이션 v3 → v4 — 계정 투자가 기체로 승계된다 (검증①)', () => {
  it('기존 유저의 투자가 활성 기체 벡터로 그대로 옮겨진다', () => {
    const invest = zeroSkillInvest(0);
    invest[0] = 3;   // 화력 트리
    invest[25] = 2;  // 생존 트리
    invest[45] = 1;  // 기동 트리
    const p = migrate(v3Blob(invest));

    expect(p.saveVersion).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBe(7);
    const ship = activeShip(p);
    expect(ship.typeId).toBe(0); // 기존 유저는 전원 스트라이커
    expect(ship.skillInvest).toHaveLength(shipSkillNodeCount(0));
    expect(ship.skillInvest[0]).toBe(3);
    expect(ship.skillInvest[25]).toBe(2);
    expect(ship.skillInvest[45]).toBe(1);
    // 총량 보존 — 마이그레이션이 조용히 포인트를 흘리지 않았는지 합으로 재확인.
    expect(ship.skillInvest.reduce((a, b) => a + b, 0)).toBe(6);
    // 다른 진행 상태도 함께 보존된다(기체를 통째로 갈아치우지 않았는가).
    expect(ship.level).toBe(5);
  });

  it('마이그레이션 후 계정 단위 키가 Profile 에 남지 않는다(정본 유일성)', () => {
    // 설계서 §10-3: "연구소는 미러에 쓰는데 런은 기체 벡터를 읽는" 결함을 구조적으로
    // 불가능하게 만드는 근거. M8-L7 이 `Profile.skillInvest` 를 삭제했으므로 투자 벡터를
    // 읽는 자리는 `activeShip(profile).skillInvest` 하나뿐이다 — 갈라질 두 번째 자리가 없다.
    const invest = zeroSkillInvest(0);
    invest[0] = 4;
    const p = migrate(v3Blob(invest));
    expect('skillInvest' in p).toBe(false);
    expect(activeShip(p).skillInvest[0]).toBe(4);
  });

  it('세이브→로드 왕복이 기체 벡터를 무손실로 복원한다', () => {
    const store = memStore();
    const p = defaultProfile();
    p.skillPoints = 5;
    investSkill(p, 0);
    saveProfile(p, store);
    const restored = loadProfile(store);
    expect('skillInvest' in restored).toBe(false);
    expect(activeShip(restored).skillInvest[0]).toBe(1);
    expect(restored).toEqual(p); // 왕복 무손실
  });

  it('이미 기체 벡터를 가진 blob 은 그것을 우선한다(계정 벡터가 덮어쓰지 않는다)', () => {
    const account = zeroSkillInvest(0);
    account[0] = 5;
    const blob = v3Blob(account);
    const own = zeroSkillInvest(0);
    own[0] = 2;
    (blob.ships as Record<string, unknown>[])[0]!.skillInvest = own;
    expect(activeShip(migrate(blob)).skillInvest[0]).toBe(2);
  });

  it('기체마다 독립된 벡터 인스턴스를 갖는다(한 기체 투자가 다른 기체로 새지 않음)', () => {
    const p = migrate(v3Blob(zeroSkillInvest(0), 2));
    expect(p.ships).toHaveLength(2);
    expect(p.ships[0]!.skillInvest).not.toBe(p.ships[1]!.skillInvest);
    p.ships[0]!.skillInvest[0] = 5;
    expect(p.ships[1]!.skillInvest[0]).toBe(0);
  });
});

describe('손상 세이브 복구 — 투자 벡터·타입 (검증②③)', () => {
  it('손상 원소는 0 으로, 상한 초과는 maxPoints 로 복구된다', () => {
    const out = normalizeSkillInvest(['x', -5, 9999, NaN, null], 0);
    expect(out).toHaveLength(shipSkillNodeCount(0));
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(SKILLS[2]!.maxPoints); // 과투자 금지
    expect(out[3]).toBe(0);
    expect(out[4]).toBe(0);
  });

  it('배열이 아니면 전부 0 으로 복구된다', () => {
    expect(migrate(v3Blob('nope')).ships[0]!.skillInvest.every((v) => v === 0)).toBe(true);
    expect(normalizeSkillInvest(undefined, 0).every((v) => v === 0)).toBe(true);
  });

  it('길이가 짧거나 긴 벡터도 타입 노드 수로 정규화된다', () => {
    expect(normalizeSkillInvest([1, 1, 1], 0)).toHaveLength(SKILL_NODE_COUNT);
    expect(normalizeSkillInvest(new Array<number>(200).fill(1), 0)).toHaveLength(SKILL_NODE_COUNT);
  });

  it('typeId 가 범위 밖이면 clamp 된다 — undefined 타입이 런타임에 흐르지 않는다', () => {
    // 범위 밖 typeId 가 통과하면 SHIP_TYPES[typeId] 가 undefined 가 되어 트리·시그니처·
    // baseBp 가 전부 빠진 채 **예외 없이 조용히** 중립 loadout 이 된다(설계서 §6).
    const mk = (typeId: unknown): number => {
      const blob = v3Blob(zeroSkillInvest(0));
      (blob.ships as Record<string, unknown>[])[0]!.typeId = typeId;
      return activeShip(migrate(blob)).typeId;
    };
    // 규칙: 범위 밖·손상은 전부 0(스트라이커). 상한 clamp(999 → 4)로 하지 않는 이유는
    // 손상 세이브가 유저에게 **조용히 다른 기체**(다른 트리·다른 시그니처)를 쥐여 주기
    // 때문이다. 0 복귀는 "기본 기체로 돌아갔다"는 설명 가능한 상태이고, 조회층
    // `shipTypeDef`/`normalizeShipTypeId` 와 규칙이 같아 저장·조회가 어긋나지 않는다.
    expect(mk(999)).toBe(0);
    expect(mk(-5)).toBe(0);
    expect(mk('striker')).toBe(0);
    expect(mk(undefined)).toBe(0);
    expect(mk(1.9)).toBe(1); // 정수화
    // 어떤 입력이든 조회가 성립해야 한다(undefined 금지).
    for (const bad of [999, -5, 'x', undefined, 1.9, NaN]) {
      expect(SHIP_TYPES[mk(bad)]).toBeDefined();
    }
  });

  it('clamp 된 타입의 노드 수로 벡터 길이도 함께 맞춰진다', () => {
    for (let t = 0; t < SHIP_TYPES.length; t++) {
      const blob = v3Blob(zeroSkillInvest(0));
      (blob.ships as Record<string, unknown>[])[0]!.typeId = t;
      const ship = activeShip(migrate(blob));
      expect(ship.typeId).toBe(t);
      expect(ship.skillInvest).toHaveLength(shipSkillNodeCount(t));
    }
  });

  /**
   * 마이그레이션이 **그 기체의 타입**으로 벡터를 정규화하는지. `migrateV3toV4` 안에서
   * 타입을 0 으로 하드코딩하면, 노드 수가 63 이 아닌 타입이 생기는 순간(M8-L6 콘텐츠 레인)
   * 부분 v4 blob 의 벡터가 63 으로 잘리고 `normalizeShip` 이 실제 길이로 0 패딩해
   * **꼬리 투자가 예외 없이 조용히 사라진다**. 지금은 전 타입이 63 이라 통과하지만,
   * 노드 수가 갈라지는 즉시 자동으로 판별력을 얻는 전방 가드다.
   */
  it('부분 v4 blob 의 기체 벡터를 그 기체 타입 길이로 정규화한다(꼬리 투자 무손실)', () => {
    for (let t = 0; t < SHIP_TYPES.length; t++) {
      const count = shipSkillNodeCount(t);
      const own = zeroSkillInvest(t);
      own[count - 1] = 1; // 꼬리 노드(그 타입의 마지막 캡스톤)에 1점
      const blob = v3Blob(zeroSkillInvest(0));
      const s0 = (blob.ships as Record<string, unknown>[])[0]!;
      s0.typeId = t;
      s0.skillInvest = own;
      const ship = activeShip(migrate(blob));
      expect(ship.skillInvest).toHaveLength(count);
      expect(ship.skillInvest[count - 1], `타입 ${t}: 꼬리 투자가 소실됐다`).toBe(1);
    }
  });
});

describe('마이그레이션 v4 → v5 — 티어→침략 단계 (ADR-0022, Lane1 게이트 5)', () => {
  /** v4 세이브 blob(계정 벡터는 이미 기체로 내려간 형태) + planetProgress.bestTierCleared. */
  function v4Blob(progress: Record<number, { bestTierCleared: number }>): Record<string, unknown> {
    return {
      saveVersion: 4,
      ships: [{ id: 'ship-0', name: '초기 전투기', typeId: 0, level: 5, xp: 0, equipped: {}, skillInvest: zeroSkillInvest(0) }],
      activeShipIndex: 0,
      inventory: [], stash: [], stashExpansions: 0,
      planetProgress: progress,
      credits: 10, minerals: 0, skillPoints: 0, tutorialDone: true,
    };
  }

  it('구 티어(t) → 단계(t+1)로 옮기고 최신 saveVersion 으로 정규화한다(왕복 무손실)', () => {
    const p = migrate(v4Blob({ 0: { bestTierCleared: 2 }, 1: { bestTierCleared: 0 } }));
    // 마이그레이션 체인은 v4→v5(티어→단계) 후에도 계속 진행돼 최종적으로 SAVE_VERSION 으로 스탬프된다.
    expect(p.saveVersion).toBe(SAVE_VERSION);
    // 티어 2(섬멸 클리어) → 단계 3, 티어 0(정찰 클리어) → 단계 1.
    expect(p.planetProgress[0]?.bestStageCleared).toBe(3);
    expect(p.planetProgress[1]?.bestStageCleared).toBe(1);
    // 재저장·재로드해도 값이 그대로다(정규화가 옮겨진 키를 읽는다).
    const store = memStore();
    saveProfile(p, store);
    expect(loadProfile(store).planetProgress[0]?.bestStageCleared).toBe(3);
  });

  it('미클리어(-1) 티어는 단계 0(미클리어)으로 보존된다', () => {
    const p = migrate(v4Blob({ 3: { bestTierCleared: -1 } }));
    expect(p.planetProgress[3]?.bestStageCleared).toBe(0);
  });
});

// ===========================================================================
// 스토리 시스템 Phase E — collectedShards + storyMetrics (V5→V6, ADR-0023)
// ===========================================================================

describe('마이그레이션 v5 → v6 — 기록 파편·마일스톤 카운터 신설', () => {
  /** v5 세이브 blob(collectedShards/storyMetrics 필드가 아직 없던 형태). */
  function v5Blob(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      saveVersion: 5,
      ships: [{ id: 'ship-0', name: '초기 전투기', typeId: 0, level: 5, xp: 0, equipped: {}, skillInvest: zeroSkillInvest(0) }],
      activeShipIndex: 0,
      inventory: [], stash: [], stashExpansions: 0,
      planetProgress: {},
      credits: 10, minerals: 0, skillPoints: 0, tutorialDone: true, introSeen: true,
      ...extra,
    };
  }

  it('신규 프로필은 collectedShards=[]·storyMetrics={} 로 시작한다', () => {
    const d = defaultProfile();
    expect(d.collectedShards).toEqual([]);
    expect(d.storyMetrics).toEqual({});
  });

  it('필드 부재 v5 세이브를 v6 로 올리고 두 필드를 기본값으로 채운다', () => {
    const p = migrate(v5Blob());
    expect(p.saveVersion).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBe(7);
    expect(p.collectedShards).toEqual([]);
    expect(p.storyMetrics).toEqual({});
    // 기존 진행 상태는 함께 보존된다(필드 신설이 다른 축을 건드리지 않는다).
    expect(activeShip(p).level).toBe(5);
    expect(p.introSeen).toBe(true);
  });

  it('이미 채워진 collectedShards·storyMetrics 는 왕복 무손실로 보존된다', () => {
    const blob = v5Blob({
      collectedShards: ['first-archive', 'echoes'],
      storyMetrics: { runsWon: 12, hitsTaken: 340 },
    });
    const p = migrate(blob);
    expect(p.collectedShards).toEqual(['first-archive', 'echoes']);
    expect(p.storyMetrics).toEqual({ runsWon: 12, hitsTaken: 340 });
    const store = memStore();
    saveProfile(p, store);
    const restored = loadProfile(store);
    expect(restored.collectedShards).toEqual(['first-archive', 'echoes']);
    expect(restored.storyMetrics).toEqual({ runsWon: 12, hitsTaken: 340 });
    expect(restored).toEqual(p);
  });
});

describe('정규화 — GuardianRecord.build 실물 빌드 (예비역 소집·장비 잠김, ADR-0024 v7)', () => {
  /** 유효 스냅샷 1개(모든 전투 스탯 숫자 필수 — normalizeGuardianSnapshot 통과용). */
  const snap = makeGuardianSnapshot(0, 100);

  /** guardians 배열만 담은 v7 프로필 blob(나머지 필드는 normalizeProfile 이 기본값으로 채운다). */
  function guardianBlob(guardians: unknown[]): Record<string, unknown> {
    return {
      saveVersion: 7,
      ships: [{ id: 'ship-0', name: '초기 전투기', typeId: 0, level: 1, xp: 0, equipped: {}, skillInvest: zeroSkillInvest(0) }],
      activeShipIndex: 0,
      inventory: [], stash: [], stashExpansions: 0, planetProgress: {},
      credits: 0, minerals: 0, skillPoints: 0, tutorialDone: true, introSeen: true,
      guardians,
    };
  }

  it('유효 build 는 typeId·equipped·skillInvest 를 무손실로 왕복한다', () => {
    const gear = rollItem(333, 'unique', { planet: 0, stage: 1 });
    const skillInvest = zeroSkillInvest(0);
    skillInvest[0] = 2;
    const p = migrate(guardianBlob([
      {
        id: 'g-live', snapshot: snap, performanceCP: 10000, combatScore: 120, preset: 0, retired: false,
        build: { typeId: 0, equipped: { main: gear }, skillInvest },
      },
    ]));
    expect(p.guardians).toHaveLength(1);
    const g = p.guardians[0]!;
    expect(g.build).toBeDefined();
    expect(g.build!.typeId).toBe(0);
    expect(g.build!.equipped.main).toEqual(gear);
    expect(g.build!.skillInvest[0]).toBe(2);
    expect(g.build!.skillInvest).toHaveLength(shipSkillNodeCount(0));
    // 세이브→로드(JSON 직렬화)까지 build 가 살아남는다.
    const store = memStore();
    saveProfile(p, store);
    const restored = loadProfile(store);
    expect(restored.guardians[0]!.build).toEqual(g.build);
    // 기존 수호 필드는 그대로(build 는 형제 additive — 다른 축 불변).
    expect(restored.guardians[0]!.combatScore).toBe(120);
    expect(restored.guardians[0]!.snapshot).toEqual(g.snapshot);
  });

  it('손상 build(객체 아님)는 undefined 로 정규화되지만 레코드는 유지된다', () => {
    const p = migrate(guardianBlob([
      { id: 'g-bad', snapshot: snap, performanceCP: 10000, combatScore: 80, preset: 0, retired: false, build: 'garbage' },
    ]));
    expect(p.guardians).toHaveLength(1);
    expect(p.guardians[0]!.build).toBeUndefined();
    expect(p.guardians[0]!.combatScore).toBe(80); // 손상 build 가 레코드를 버리지 않는다
  });

  it('build 부재(구 수호기 = 소집 비활성)는 build 없이 정규화되고 레코드는 유지된다', () => {
    const p = migrate(guardianBlob([
      { id: 'g-legacy', snapshot: snap, performanceCP: 10000, combatScore: 60, preset: 0, retired: false },
    ]));
    expect(p.guardians).toHaveLength(1);
    expect(p.guardians[0]!.build).toBeUndefined();
    expect('build' in p.guardians[0]!).toBe(false); // 부재 시 키 자체가 없다(optional 정합)
  });
});

describe('정규화 — collectedShards(문자열 집합)·storyMetrics(유한 정수)', () => {
  function v6Blob(collectedShards: unknown, storyMetrics: unknown): Record<string, unknown> {
    return {
      saveVersion: 6,
      ships: [{ id: 'ship-0', name: '초기 전투기', typeId: 0, level: 1, xp: 0, equipped: {}, skillInvest: zeroSkillInvest(0) }],
      activeShipIndex: 0,
      inventory: [], stash: [], stashExpansions: 0, planetProgress: {},
      credits: 0, minerals: 0, skillPoints: 0, tutorialDone: true,
      collectedShards, storyMetrics,
    };
  }

  it('collectedShards 는 문자열만 남기고 빈 문자열·중복을 제거한다(순서 보존)', () => {
    const p = migrate(v6Blob(['a', 5, 'a', '', null, 'b', { x: 1 }, 'b'], {}));
    expect(p.collectedShards).toEqual(['a', 'b']);
  });

  it('collectedShards 가 배열이 아니면 빈 배열로 복구된다', () => {
    expect(migrate(v6Blob('nope', {})).collectedShards).toEqual([]);
    expect(migrate(v6Blob(null, {})).collectedShards).toEqual([]);
    expect(migrate(v6Blob({ 0: 'a' }, {})).collectedShards).toEqual([]);
  });

  it('storyMetrics 는 유한 정수만 남기고 손상 항목을 버린다(음수는 0, 실수는 절삭)', () => {
    const p = migrate(
      v6Blob([], {
        runsWon: 3,
        hitsTaken: -5, // 음수 → 0 하한
        overchargeKills: 2.9, // 실수 → 절삭
        cloakBreaks: NaN, // 비유한 → 키째 제거
        broodLaunches: Infinity, // 비유한 → 키째 제거
        filmPops: '10', // 비-숫자 → 키째 제거
      }),
    );
    expect(p.storyMetrics).toEqual({ runsWon: 3, hitsTaken: 0, overchargeKills: 2 });
  });

  it('storyMetrics 가 객체가 아니면 빈 객체로 복구된다', () => {
    expect(migrate(v6Blob([], 'nope')).storyMetrics).toEqual({});
    expect(migrate(v6Blob([], null)).storyMetrics).toEqual({});
    expect(migrate(v6Blob([], [1, 2, 3])).storyMetrics).toEqual({});
  });

  it('손상 세이브도 유효 프로필이 된다(두 필드가 안전 기본값)', () => {
    const p = migrate(v6Blob(42, 42));
    expect(p.collectedShards).toEqual([]);
    expect(p.storyMetrics).toEqual({});
  });
});

describe('정본은 기체 벡터 — 연구소 투자·리스펙', () => {
  it('investSkill 이 활성 기체 벡터에 쌓인다', () => {
    const p = defaultProfile();
    p.skillPoints = 3;
    expect(investSkill(p, 0)).toBe(true);
    expect(activeShip(p).skillInvest[0]).toBe(1);
    expect(totalInvested(p)).toBe(1);
  });

  it('리스펙은 활성 기체 벡터를 0 으로 되돌린다', () => {
    const p = defaultProfile();
    p.skillPoints = 3;
    p.credits = 100_000;
    investSkill(p, 0);
    expect(respecSkills(p)).toBe(true);
    expect(activeShip(p).skillInvest.every((v: number) => v === 0)).toBe(true);
  });

  it('활성 기체를 옮기면 투자·조회가 그 기체 벡터를 따라간다', () => {
    // M8-L7 이 계정 단위 별칭을 삭제한 뒤의 계약: `activeShipIndex` 만 움직이면 되고,
    // 별도의 재바인딩 호출이 필요 없다(빠뜨릴 자리 자체가 사라졌다).
    const p = defaultProfile();
    p.ships.push({
      id: 'ship-1', name: '2번기', typeId: 0, level: 1, xp: 0, equipped: {},
      skillInvest: zeroSkillInvest(0),
    });
    p.activeShipIndex = 1;
    p.skillPoints = 1;
    expect(investSkill(p, 0)).toBe(true);
    expect(p.ships[1]!.skillInvest[0]).toBe(1);
    expect(p.ships[0]!.skillInvest[0]).toBe(0); // 0번기로 새지 않았다
  });
});

// ---------------------------------------------------------------------------
// 정규 경로 통합 — Profile → 런 설정 → createWorld/stepWorld (검증⑥)
//
// ⚠️ 모듈 직접 호출만으로는 "배선이 통째로 없다" 를 못 잡는다(이 저장소 8회 재발 결함).
// 아래는 `src/main.ts` 런 시작 조립(:700-728)과 **같은 함수·같은 순서**를 탄다.
// M8-L7 이 `buildRunConfig(profile)` 를 추출하면 이 헬퍼를 지우고 그것을 직접 부를 것.
// ---------------------------------------------------------------------------

// ✅ M8-L7 완료: 실제 앱이 부르는 `buildRunConfig` 를 그대로 호출한다.
function assembleRunConfigLikeMain(profile: Profile): WorldConfig {
  return buildRunConfig(profile, { planet: 0, stage: 1 });
}

const NEUTRAL: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };

function runHashes(seed: number, cfg: WorldConfig, ticks: number): number[] {
  const state = createWorld(seed, cfg);
  const out: number[] = [];
  for (let i = 0; i < ticks; i++) {
    stepWorld(state, NEUTRAL);
    out.push(hashWorld(state));
  }
  return out;
}

describe('정규 경로 통합 — 기체 벡터가 실제 런에 도달한다 (검증⑥)', () => {
  it('v3 유저가 승계한 투자가 런 설정과 sim 해시 스트림까지 흘러간다', () => {
    const invest = zeroSkillInvest(0);
    invest[0] = SKILLS[0]!.maxPoints;
    const migrated = migrate(v3Blob(invest));

    const cfg = assembleRunConfigLikeMain(migrated);
    // ① 런 설정이 기체 벡터를 그대로 실었는가(마이그레이션 → 런 배선).
    expect(cfg.skillInvest).toEqual(activeShip(migrated).skillInvest);
    // ② 투자가 파생 스탯으로 실제로 접혔는가(중립 loadout 이 아님).
    const none = assembleRunConfigLikeMain(migrate(v3Blob(zeroSkillInvest(0))));
    expect(cfg.loadout).not.toEqual(none.loadout);
    // ③ sim 이 실제로 다르게 굴러가는가 — 파생 스탯만 비교하면 "접히긴 했는데 sim 이
    //    안 읽는" 경우를 놓친다. 여기까지 와야 "배선이 있다"고 말할 수 있다.
    expect(runHashes(1234, cfg, 120)).not.toEqual(runHashes(1234, none, 120));
    // ④ 재실행 결정론(ADR-0005): 같은 설정은 같은 스트림.
    expect(runHashes(1234, cfg, 120)).toEqual(runHashes(1234, cfg, 120));
  });

  it('연구소 투자 → 저장 → 재로드 → 런 설정 왕복이 반영된다', () => {
    const store = memStore();
    const p = defaultProfile();
    p.skillPoints = 3;
    expect(investSkill(p, 0)).toBe(true); // 연구소가 부르는 바로 그 함수
    saveProfile(p, store);

    const reloaded = loadProfile(store);
    expect(activeShip(reloaded).skillInvest[0]).toBe(1);
    expect(assembleRunConfigLikeMain(reloaded)).toEqual(assembleRunConfigLikeMain(p));
  });

  it('무투자 기본 프로필은 v3 시절과 같은 길이 63 벡터를 싣는다(스트라이커 동결)', () => {
    const cfg = assembleRunConfigLikeMain(defaultProfile());
    expect(cfg.skillInvest).toHaveLength(SKILL_NODE_COUNT);
    expect(cfg.skillInvest?.every((v) => v === 0)).toBe(true);
  });
});

describe('기체 타입 선택 — 해금 게이트 부재 (검증⑤)', () => {
  // ⚠️ 이 테스트의 목적은 기능 검증이 아니라 **결정 보호**다. ADR-0019 는 "전체 개방"을
  // 명시적 사용자 결정으로 기록했다. 후속 레인이 선의로 "레벨 10 부터 해금" 같은 조건을
  // 붙이는 것을 막는 유일한 수단이 이 못이다. 실패하면 그것은 개선이 아니라 결정 위반이다.
  it('선택 가능 타입은 레지스트리 전량이다', () => {
    expect(selectableShipTypes()).toEqual(SHIP_TYPES);
    expect(selectableShipTypes()).toHaveLength(SHIP_TYPES.length);
  });

  it('선택 목록은 프로필 상태(레벨·진행도·계보)와 무관하다', () => {
    // 인자를 받지 않는 시그니처가 1차 방어선이다 — 프로필을 볼 수 없으면 게이트를 걸 수 없다.
    const before = selectableShipTypes();
    const veteran = defaultProfile();
    activeShip(veteran).level = 99;
    veteran.credits = 1_000_000;
    veteran.lineage.shipLevel = 50;
    veteran.planetProgress[0] = { bestStageCleared: 9 };
    expect(selectableShipTypes()).toEqual(before);
  });

  it('갓 시작한 프로필도 모든 타입으로 퇴역·전환할 수 있다', () => {
    for (let t = 0; t < SHIP_TYPES.length; t++) {
      const p = defaultProfile(); // level 1 · 진행도 0 · 계보 0 — 가장 약한 상태
      const r = retireAtCap(p, 0, t);
      expect(r.ship.typeId).toBe(t);
      expect(activeShip(p).typeId).toBe(t);
    }
  });
});

// ---------------------------------------------------------------------------
// M8 통합 게이트 — investSkill 이 **활성 기체 타입**의 노드·게이트를 쓴다
// ---------------------------------------------------------------------------

/**
 * 통합 게이트(W2)에서 실측으로 잡은 배선 결함의 회귀 가드.
 *
 * 결함: `investSkill` 이 스트라이커 정본(`SKILLS` 길이 63 / `capstoneUnlocked` 게이트 폭 20·40)
 * 으로 노드를 찾았다. 레지스트리·파생·sim 은 전부 타입별로 일반화됐는데 **투자 경로만**
 * 스트라이커에 묶여 있었고, 예외도 타입 오류도 나지 않아 전 레인 테스트가 그린이었다.
 *
 * 관측된 증상(수정 전 실측):
 *   - 비온(78노드): 인덱스 63~77 이 `SKILLS[i] === undefined` 로 **영구 투자 불가**
 *     (= 3계열 마지막 행 전부 + 진짜 캡스톤 3개)
 *   - 비온: base 인덱스 60·61·62 가 스트라이커 캡스톤으로 **오인**돼 게이트에 막힘
 *   - 전 타입: `maxPoints` 가 스트라이커와 다른 인덱스에서 상한 오판정
 */
describe('M8 — investSkill 은 활성 기체 타입의 노드·캡스톤 게이트를 쓴다', () => {
  /** 모든 노드를 최대치까지 밀어 넣는다(캡스톤 게이트를 위해 두 바퀴). */
  function maxOut(p: Profile, typeId: number): number[] {
    const nodes = flattenShipNodes(shipTypeDef(typeId));
    p.skillPoints = 100_000;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < nodes.length; i++) {
        for (let k = 0; k < nodes[i]!.maxPoints; k++) investSkill(p, i);
      }
    }
    return activeShip(p).skillInvest;
  }

  it('모든 타입의 모든 노드가 투자 가능하다 (노드 수 63 하드코딩이면 비온이 실패)', () => {
    for (const def of SHIP_TYPES) {
      const p = defaultProfile();
      retireAtCap(p, 0, def.id);
      const nodes = flattenShipNodes(def);
      const inv = maxOut(p, def.id);
      expect(inv.length, `${def.slug} 벡터 길이`).toBe(nodes.length);
      for (let i = 0; i < nodes.length; i++) {
        expect(inv[i], `${def.slug} 인덱스 ${i} (${nodes[i]!.id}) 미투자`).toBeGreaterThan(0);
      }
    }
  });

  it('노드별 상한은 그 타입의 maxPoints 다 (스트라이커 상한을 빌려 쓰면 과투자/조기차단)', () => {
    for (const def of SHIP_TYPES) {
      const p = defaultProfile();
      retireAtCap(p, 0, def.id);
      const nodes = flattenShipNodes(def);
      const inv = maxOut(p, def.id);
      for (let i = 0; i < nodes.length; i++) {
        expect(inv[i], `${def.slug} 인덱스 ${i} 상한`).toBe(nodes[i]!.maxPoints);
      }
    }
  });

  it('캡스톤은 그 타입의 계열 게이트를 통과해야만 찍힌다 (레이아웃·게이트 폭이 타입별)', () => {
    for (const def of SHIP_TYPES) {
      const p = defaultProfile();
      retireAtCap(p, 0, def.id);
      p.skillPoints = 100_000;
      for (let ti = 0; ti < def.trees.length; ti++) {
        const ci = shipCapstoneIndex(def, ti);
        // 게이트 미달 상태에서는 거부된다.
        expect(investSkill(p, ci), `${def.slug} 트리${ti} 게이트 미달인데 통과`).toBe(false);
      }
      // 게이트를 채우면 3계열 캡스톤이 전부 열린다.
      const nodes = flattenShipNodes(def);
      for (let i = 0; i < def.nodesPerTree * def.trees.length; i++) {
        for (let k = 0; k < nodes[i]!.maxPoints; k++) investSkill(p, i);
      }
      for (let ti = 0; ti < def.trees.length; ti++) {
        expect(investSkill(p, shipCapstoneIndex(def, ti)), `${def.slug} 트리${ti} 캡스톤`).toBe(true);
      }
    }
  });

  it('스트라이커 거동은 불변이다 (63노드 전량 투자 · 총 253pt)', () => {
    const p = defaultProfile();
    const inv = maxOut(p, 0);
    expect(inv.length).toBe(SKILL_NODE_COUNT);
    expect(inv.reduce((a, b) => a + b, 0)).toBe(
      SKILLS.reduce((a, n) => a + n.maxPoints, 0),
    );
  });

  it('범위 밖 인덱스는 거부된다 (음수·초과·비온 길이를 스트라이커에 적용)', () => {
    const p = defaultProfile();
    p.skillPoints = 10;
    expect(investSkill(p, -1)).toBe(false);
    expect(investSkill(p, SKILL_NODE_COUNT)).toBe(false);
    expect(investSkill(p, 77)).toBe(false); // 비온에만 있는 인덱스
    expect(p.skillPoints).toBe(10); // 포인트가 새지 않는다
  });
});
