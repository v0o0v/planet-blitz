/**
 * 의뢰 구간 전환 **승계 계약** 테스트 (계획 §A-5 · PA 레인 계약 §7-1).
 *
 * 두 축을 **병용**한다. 어느 하나로는 못 잡는다:
 *  ① **전수 대조** — 세 배열의 합집합이 실제 필드 전부를 덮는가. 컴파일 타임 단언은
 *    `src/sim/commissionCarry.ts` 의 `_WorldExhaustive`/`_EntityExhaustive` 가 지고,
 *    여기서는 **런타임 키**로 한 겹 더 받는다(`keyof` 가 못 보는 미선언 런타임 키를 잡는다).
 *  ② **뮤테이션 진단력** — `carryAcrossSegment` 가 CARRY 각 필드를 실제로 옮기고
 *    RESET_ZERO 를 0 으로 만드는가. 배열에서 한 항목을 빼면 해당 단언이 **실패해야 한다.**
 *
 * ②만 있으면 목록에 **없는** 필드는 제거할 것이 없어 원리적으로 못 잡고, ①만 있으면 분류만
 * 해 두고 전환 함수가 실제로 아무것도 안 옮겨도 통과한다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import type { Entity } from '../src/sim/entities.js';
import {
  WORLD_CARRY,
  WORLD_RESET_ZERO,
  WORLD_FRESH,
  ENTITY_CARRY,
  ENTITY_RESET_ZERO,
  ENTITY_FRESH,
  carryAcrossSegment,
} from '../src/sim/commissionCarry.js';

/**
 * `WorldState` 의 optional 키 — 런에 따라 런타임에 **존재하지 않을 수 있는** 것들.
 * 이 목록 자체가 작은 게이트다: optional 키가 늘면 여기도 늘려야 아래 대조가 통과한다.
 */
const WORLD_OPTIONAL_KEYS: readonly (keyof WorldState)[] = [
  'moduleRuntime',
  'invasion3',
  'scrollRuntime',
  'shrinkRuntime',
  'echoRuntime',
  'encounterRuntime',
  // 의뢰 런에만 존재한다(`config.commission` 이 있을 때만 `createWorld` 가 싣는다).
  'commissionRuntime',
];

function player(w: WorldState): Entity {
  const p = w.entities[0];
  if (p === undefined) throw new Error('플레이어 엔티티가 0번에 없다 — WorldState 계약 위반');
  return p;
}

/**
 * 승계 목록의 **독립 전사본**.
 *
 * ⚠️ 이것이 없으면 아래 "CARRY 각 필드가 이월된다" 테스트가 **항진**이다 — 그 테스트는
 * `WORLD_CARRY` 를 순회하므로, 목록에서 한 항목을 빼면 **복사와 단언이 함께 사라져** 통과한다.
 * 뮤테이션 진단력은 목록과 무관한 제2의 기록이 있어야만 성립한다. 승계 분류를 바꾸려면
 * 여기도 함께 고쳐야 하고, 그 강제가 곧 "분류를 실제로 판단했는가"의 물증이다.
 */
const EXPECTED_WORLD_CARRY: readonly string[] = [
  'xp',
  'xpTotal',
  'level',
  'weapon',
  'magnetRadius',
  'magnetBuffTicks',
  'loot',
  'resources',
  'catalystResourceMilli',
  'kills',
  'gems',
  'maxCombo',
  'tainted',
  'activeCd0',
  'activeCd1',
  'activeBuff0',
  'activeBuff1',
  'hitsTaken',
  'overchargeKills',
  'cloakBreaks',
  'broodLaunches',
  'cushionHealed',
  'filmPops',
  // 의뢰 런타임: `totalTicks` 가 런 단위 누적이라 승계한다(`segmentDone` 은 승계 후 0 으로 내린다).
  'commissionRuntime',
];

/** 플레이어 승계·0리셋 목록의 독립 전사본. 근거는 위와 동일. */
const EXPECTED_ENTITY_CARRY: readonly string[] = [
  'hp',
  'maxHp',
  'targetX',
  'targetY',
  'ownerId',
  'cooldown',
  'dashCooldown',
  // ⚠️ `timer` 는 보조무기 발사 쿨다운이다(`world.ts:2611-2725`). 처음엔 RESET_ZERO 에 있었고
  // 그것이 오분류였다 — SENTRY 300틱을 구간마다 건너뛰어 **구간당 무료 1발**이 나갔다.
  // 결정론적이라 해시가 안 갈리고 밸런스 이상으로만 보이는 종류다.
  'timer',
  'aux0',
  'aux1',
];
const EXPECTED_ENTITY_RESET_ZERO: readonly string[] = ['iframes', 'phase'];

describe('① 전수 대조 — 분류 배열이 필드 전부를 덮는다', () => {
  it('승계 목록이 독립 전사본과 정확히 일치한다 (항진 방지 — 목록 변경은 반드시 눈에 띈다)', () => {
    expect([...WORLD_CARRY]).toEqual(EXPECTED_WORLD_CARRY);
    expect([...ENTITY_CARRY]).toEqual(EXPECTED_ENTITY_CARRY);
    expect([...ENTITY_RESET_ZERO]).toEqual(EXPECTED_ENTITY_RESET_ZERO);
  });

  it('WorldState 세 배열은 서로 겹치지 않는다 (한 필드가 두 분류에 있으면 전환 의미가 모순)', () => {
    const all = [...WORLD_CARRY, ...WORLD_RESET_ZERO, ...WORLD_FRESH];
    expect(new Set(all).size).toBe(all.length);
  });

  it('Entity 세 배열도 서로 겹치지 않는다', () => {
    const all = [...ENTITY_CARRY, ...ENTITY_RESET_ZERO, ...ENTITY_FRESH];
    expect(new Set(all).size).toBe(all.length);
  });

  it('월드의 **런타임 키**가 전부 분류돼 있다 (`keyof` 가 못 보는 미선언 키를 잡는다)', () => {
    const w = createWorld(0x1234, { ...DEFAULT_CONFIG });
    const declared = new Set<string>([...WORLD_CARRY, ...WORLD_RESET_ZERO, ...WORLD_FRESH]);
    const runtime = Object.keys(w);
    const unclassified = runtime.filter((k) => !declared.has(k));
    expect(unclassified, `미분류 런타임 키: ${unclassified.join(', ')}`).toEqual([]);
  });

  it('분류에만 있고 런타임에 없는 키는 optional 뿐이다 (오탈자로 유령 키가 들어가는 것을 막는다)', () => {
    const w = createWorld(0x1234, { ...DEFAULT_CONFIG });
    const runtime = new Set(Object.keys(w));
    const optional = new Set<string>(WORLD_OPTIONAL_KEYS);
    const declared = [...WORLD_CARRY, ...WORLD_RESET_ZERO, ...WORLD_FRESH];
    const ghosts = declared.filter((k) => !runtime.has(k) && !optional.has(k));
    expect(ghosts, `런타임에 없는 비-optional 키: ${ghosts.join(', ')}`).toEqual([]);
  });

  it('플레이어 엔티티의 런타임 키가 전부 분류돼 있다', () => {
    const w = createWorld(0x1234, { ...DEFAULT_CONFIG });
    const declared = new Set<string>([...ENTITY_CARRY, ...ENTITY_RESET_ZERO, ...ENTITY_FRESH]);
    const unclassified = Object.keys(player(w)).filter((k) => !declared.has(k));
    expect(unclassified, `미분류 엔티티 키: ${unclassified.join(', ')}`).toEqual([]);
  });

  it('배열 길이 합이 실제 필드 수와 같다 (WorldState 62 · Entity 25)', () => {
    // 숫자를 박아 두는 이유: 필드가 늘었는데 분류도 같이 늘면 위 대조는 통과하지만, 그때
    // **분류 판단이 실제로 있었는지**는 이 숫자가 바뀌는 것으로만 드러난다.
    // 61 → 62: `commissionRuntime` 신설(의뢰 구간 전환 코어 2단계). 이 숫자가 실제로 이 레인에서
    // 컴파일과 테스트를 동시에 깨뜨렸고, 그 강제가 곧 분류가 판단됐다는 물증이다.
    expect(WORLD_CARRY.length + WORLD_RESET_ZERO.length + WORLD_FRESH.length).toBe(62);
    expect(ENTITY_CARRY.length + ENTITY_RESET_ZERO.length + ENTITY_FRESH.length).toBe(25);
  });
});

describe('② 뮤테이션 진단력 — carryAcrossSegment 가 필드별로 실제로 옮긴다', () => {
  /** 승계원 월드에 필드마다 **구별 가능한** 값을 심는다. 심지 않으면 "안 옮겨도 통과"가 된다. */
  function seedPrev(): WorldState {
    const w = createWorld(0x1111, { ...DEFAULT_CONFIG });
    const rec = w as unknown as Record<string, unknown>;
    let n = 1000;
    // 목록이 아니라 **독립 전사본**을 순회한다 — 그래야 목록에서 항목을 빼도 단언이 남는다.
    for (const k of EXPECTED_WORLD_CARRY) {
      const cur = rec[k];
      if (typeof cur === 'number') rec[k] = ++n;
      else if (typeof cur === 'boolean') rec[k] = true;
    }
    // 참조형 두 개는 "이 객체 그대로 넘어왔는가"로 관측한다.
    w.loot = [{ seed: 7, rarity: 3, planet: 1, stage: 2 }];
    return w;
  }

  it('CARRY 각 필드가 값·참조까지 그대로 이월된다', () => {
    const prev = seedPrev();
    const next = createWorld(0x2222, { ...DEFAULT_CONFIG });
    const expected = new Map<string, unknown>();
    for (const k of EXPECTED_WORLD_CARRY) expected.set(k, (prev as unknown as Record<string, unknown>)[k]);

    carryAcrossSegment(prev, next);

    const got = next as unknown as Record<string, unknown>;
    for (const k of EXPECTED_WORLD_CARRY) {
      expect(got[k], `WORLD_CARRY['${k}'] 가 이월되지 않았다`).toBe(expected.get(k));
    }
    // 참조 동일성 — 얕은 복사로 바꿔치기하면 여기서 걸린다.
    expect(next.weapon).toBe(prev.weapon);
    expect(next.loot).toBe(prev.loot);
  });

  it('FRESH 필드는 새 월드 값을 유지한다 (승계가 새는지 반대 방향으로 본다)', () => {
    const prev = seedPrev();
    prev.tick = 9000;
    prev.supplyNextIndex = 2;
    prev.combo = 40;
    prev.bossSpawned = true;
    prev.victory = true;
    const next = createWorld(0x2222, { ...DEFAULT_CONFIG });

    carryAcrossSegment(prev, next);

    // `tick` 승계는 보급선 몰림 결함의 근원이다(모듈 머리말 참조) — 반드시 0 이어야 한다.
    expect(next.tick).toBe(0);
    expect(next.supplyNextIndex).toBe(0);
    expect(next.combo).toBe(0);
    expect(next.bossSpawned).toBe(false);
    expect(next.victory).toBe(false);
    expect(next.entities).not.toBe(prev.entities);
  });

  it('tainted 는 OR 누적이다 — 어느 쪽이 오염이어도 전환 후 오염이다 (ADR-0008 세탁 방지)', () => {
    const a = createWorld(1, { ...DEFAULT_CONFIG });
    const b = createWorld(2, { ...DEFAULT_CONFIG });
    a.tainted = true;
    carryAcrossSegment(a, b);
    expect(b.tainted).toBe(true);

    const c = createWorld(3, { ...DEFAULT_CONFIG });
    const d = createWorld(4, { ...DEFAULT_CONFIG });
    d.tainted = true; // 새 월드 쪽이 이미 오염 표시된 경우
    carryAcrossSegment(c, d);
    expect(d.tainted).toBe(true);
  });

  it('플레이어 ENTITY_CARRY 각 필드가 이월된다 (targetX = 런당 1회 부활 소진 표식 포함)', () => {
    const prev = createWorld(0x3333, { ...DEFAULT_CONFIG });
    const next = createWorld(0x4444, { ...DEFAULT_CONFIG });
    const pp = player(prev) as unknown as Record<string, number>;
    let n = 500;
    for (const k of EXPECTED_ENTITY_CARRY) pp[k] = ++n;

    carryAcrossSegment(prev, next);

    const np = player(next) as unknown as Record<string, number>;
    for (const k of EXPECTED_ENTITY_CARRY) {
      expect(np[k], `ENTITY_CARRY['${k}'] 가 이월되지 않았다`).toBe(pp[k]);
    }
  });

  it('플레이어 ENTITY_RESET_ZERO 는 양쪽 값과 무관하게 0 이 된다', () => {
    const prev = createWorld(0x3333, { ...DEFAULT_CONFIG });
    const next = createWorld(0x4444, { ...DEFAULT_CONFIG });
    const pp = player(prev) as unknown as Record<string, number>;
    const np = player(next) as unknown as Record<string, number>;
    for (const k of EXPECTED_ENTITY_RESET_ZERO) {
      pp[k] = 33;
      np[k] = 77;
    }

    carryAcrossSegment(prev, next);

    for (const k of EXPECTED_ENTITY_RESET_ZERO) {
      expect(np[k], `ENTITY_RESET_ZERO['${k}'] 가 0 이 아니다`).toBe(0);
    }
  });

  it('commissionRuntime: totalTicks 는 이어지고 segmentDone 은 0 으로 내려간다', () => {
    // ⚠️ 이 둘이 한 객체 안에 있어서 규칙이 갈린다. `segmentDone` 을 안 내리면 `stepRun` 이
    // 다음 틱에 또 전환해 **구간이 한 틱에 하나씩 소진되고 의뢰가 즉시 끝난다** — 해시는
    // 클라·서버가 똑같이 틀리므로 어떤 게이트도 안 울린다.
    const prev = createWorld(0x5555, { ...DEFAULT_CONFIG });
    const next = createWorld(0x6666, { ...DEFAULT_CONFIG });
    prev.commissionRuntime = { segmentDone: 1, totalTicks: 4242 };
    next.commissionRuntime = { segmentDone: 0, totalTicks: 0 };

    carryAcrossSegment(prev, next);

    expect(next.commissionRuntime?.totalTicks).toBe(4242);
    expect(next.commissionRuntime?.segmentDone).toBe(0);
  });

  it('플레이어 ENTITY_FRESH 는 새 월드 값을 유지한다 (좌표가 딸려오면 무대 진입 위치가 깨진다)', () => {
    const prev = createWorld(0x3333, { ...DEFAULT_CONFIG });
    const next = createWorld(0x4444, { ...DEFAULT_CONFIG });
    const pp = player(prev);
    pp.x = -9999;
    pp.y = -9999;
    pp.dead = true;
    const before = { x: player(next).x, y: player(next).y };

    carryAcrossSegment(prev, next);

    expect(player(next).x).toBe(before.x);
    expect(player(next).y).toBe(before.y);
    expect(player(next).dead).toBe(false);
  });
});
