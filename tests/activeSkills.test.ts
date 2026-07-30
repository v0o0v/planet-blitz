/**
 * 액티브 스킬 순수 규칙 단위 테스트(ADR-0041 · AC-2·4·12·13·14·15).
 *
 * 배선 전수(①②③)는 `tests/activeSkillWiring.test.ts`, 관통 배선은
 * `tests/activeSkillRunConfig.test.ts` · `tests/activeSkillGuardian.test.ts` 가 맡는다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, DEFAULT_CONFIG, SPECIAL_ACTIVE_SLOT1 } from '../src/sim/world.js';
import type { InputFrame, WorldConfig } from '../src/sim/world.js';
import {
  ALL_ACTIVES,
  ACTIVES_BY_SHIP,
  activeCooldownTicks,
  activeGateThreshold,
  activePowerCenti,
  isActiveUnlocked,
  wireIdOf,
  ACTIVE_CD_FLOOR,
} from '../data/ships/actives/index.js';
import { ACTIVE_LO_GATE } from '../data/ships/actives/types.js';
import { equipActive, unequipActive, activeSlotViews } from '../src/items/activeSkills.js';
import { SHIP_TYPES, zeroSkillInvest, shipTreeRange } from '../data/ships/index.js';
import { migrate, defaultProfile } from '../src/save/profile.js';
import { SAVE_VERSION } from '../src/items/types.js';

/** 그 계열 base 노드에 `per` 포인트씩 부은 벡터. */
function investTree(shipTypeId: number, treeIndex: number, per: number): number[] {
  const ship = SHIP_TYPES[shipTypeId];
  const v = zeroSkillInvest(shipTypeId);
  if (ship === undefined) return v;
  const { start, end } = shipTreeRange(ship, treeIndex);
  for (let i = start; i < end; i++) v[i] = per;
  return v;
}

/** 그 계열 누적이 정확히 `total` 이 되도록 첫 칸에만 붓는다(경계값 시험용). */
function investExactly(shipTypeId: number, treeIndex: number, total: number): number[] {
  const ship = SHIP_TYPES[shipTypeId];
  const v = zeroSkillInvest(shipTypeId);
  if (ship === undefined) return v;
  const { start } = shipTreeRange(ship, treeIndex);
  v[start] = total;
  return v;
}

const IDLE: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };
const FIRE: InputFrame = { ...IDLE, special: SPECIAL_ACTIVE_SLOT1 };

describe('AC-12 — 해금 게이트 (저티어 8 · 고티어 capstoneGate 추종)', () => {
  it('저티어는 계열 base 누적 8 이 경계다 (7 잠김 / 8 열림)', () => {
    for (const def of ALL_ACTIVES.filter((d) => d.tier === 'lo')) {
      expect(activeGateThreshold(def), def.id).toBe(ACTIVE_LO_GATE);
      expect(isActiveUnlocked(investExactly(def.shipTypeId, def.treeIndex, 7), def), def.id).toBe(
        false,
      );
      expect(isActiveUnlocked(investExactly(def.shipTypeId, def.treeIndex, 8), def), def.id).toBe(
        true,
      );
    }
  });

  it('고티어는 그 기체의 `capstoneGate` 를 추종한다 (해츨링만 44, 나머지 40)', () => {
    for (const def of ALL_ACTIVES.filter((d) => d.tier === 'hi')) {
      const gate = SHIP_TYPES[def.shipTypeId]?.capstoneGate ?? 40;
      expect(activeGateThreshold(def), def.id).toBe(gate);
      expect(
        isActiveUnlocked(investExactly(def.shipTypeId, def.treeIndex, gate - 1), def),
        def.id,
      ).toBe(false);
      expect(isActiveUnlocked(investExactly(def.shipTypeId, def.treeIndex, gate), def), def.id).toBe(
        true,
      );
    }
  });

  it('해츨링의 고티어 문턱은 실제로 40 이 아니라 44 다 (추종의 물증)', () => {
    const hatchling = SHIP_TYPES.findIndex((s) => s.slug === 'hatchling');
    expect(hatchling).toBeGreaterThanOrEqual(0);
    expect(SHIP_TYPES[hatchling]?.capstoneGate).toBe(44);
  });
});

describe('AC-13 — 투자량 파생 (위력 단조↑ · 쿨다운 단조↓, 별도 저장 없음)', () => {
  it.each(ALL_ACTIVES.map((d) => [d.id, d] as const))('%s — 단조성', (_id, def) => {
    let prevCd = Number.POSITIVE_INFINITY;
    let prevPower = -1;
    for (const invested of [0, 4, 8, 20, 40, 80, 200]) {
      const cd = activeCooldownTicks(def, invested);
      const power = activePowerCenti(def, invested);
      expect(Number.isInteger(cd), `${def.id} cd 정수`).toBe(true);
      expect(Number.isInteger(power), `${def.id} power 정수`).toBe(true);
      expect(cd, `${def.id} cd@${invested}`).toBeLessThanOrEqual(prevCd);
      expect(power, `${def.id} power@${invested}`).toBeGreaterThan(prevPower);
      prevCd = cd;
      prevPower = power;
    }
    // 하한이 있어 아무리 부어도 0 이나 음수가 되지 않는다(쿨다운 소멸 = 무한 발동).
    expect(activeCooldownTicks(def, 100_000)).toBe(ACTIVE_CD_FLOOR);
  });
});

describe('AC-14 — 장착은 최대 2개, 3개째는 거부', () => {
  const ship = ACTIVES_BY_SHIP.findIndex((l) => l.length >= 3);

  it('열린 것 2개까지 끼우고 3개째는 `slots-full` 로 거부된다', () => {
    if (ship < 0) return; // 아직 3종 이상 저작된 기체가 없다(0a 단계).
    const list = ACTIVES_BY_SHIP[ship] ?? [];
    const invest = zeroSkillInvest(ship);
    // 전 계열을 넉넉히 채워 6종 전부 열어 둔다.
    for (let i = 0; i < invest.length; i++) invest[i] = 50;
    let slots: (string | null)[] = [null, null];
    const opened = list.filter((d) => isActiveUnlocked(invest, d));
    expect(opened.length).toBeGreaterThanOrEqual(3);
    for (let k = 0; k < 2; k++) {
      const r = equipActive(ship, invest, slots, opened[k]!.id);
      expect(r.ok, `${k}번째 장착`).toBe(true);
      if (r.ok) slots = r.slots;
    }
    const third = equipActive(ship, invest, slots, opened[2]!.id);
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.reason).toBe('slots-full');
    // 한 칸 비우면 다시 들어간다.
    slots = unequipActive(slots, 0);
    expect(equipActive(ship, invest, slots, opened[2]!.id).ok).toBe(true);
  });

  it('잠긴 것 · 다른 기체 것 · 중복은 각각의 사유로 거부된다', () => {
    const def = ALL_ACTIVES[0];
    if (def === undefined) return;
    const zero = zeroSkillInvest(def.shipTypeId);
    const locked = equipActive(def.shipTypeId, zero, [null, null], def.id);
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.reason).toBe('locked');

    const invest = investTree(def.shipTypeId, def.treeIndex, 50);
    const wrongShip = equipActive((def.shipTypeId + 1) % SHIP_TYPES.length, invest, [null, null], def.id);
    expect(wrongShip.ok).toBe(false);
    if (!wrongShip.ok) expect(wrongShip.reason).toBe('wrong-ship');

    const dup = equipActive(def.shipTypeId, invest, [def.id, null], def.id);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.reason).toBe('already-equipped');

    expect(equipActive(def.shipTypeId, invest, [null, null], 'as_nonexistent').ok).toBe(false);
  });

  it('연구소 표시용 뷰가 잠금·필요 투자량·파생값을 함께 낸다 (AC-16 의 데이터 축)', () => {
    const def = ALL_ACTIVES[0];
    if (def === undefined) return;
    const views = activeSlotViews(def.shipTypeId, zeroSkillInvest(def.shipTypeId), [null, null]);
    expect(views.length).toBe((ACTIVES_BY_SHIP[def.shipTypeId] ?? []).length);
    for (const v of views) {
      expect(v.unlocked).toBe(false);
      expect(v.threshold).toBe(activeGateThreshold(v.def));
      expect(v.invested).toBe(0);
      expect(v.equippedSlot).toBe(-1);
    }
  });
});

describe('AC-2 — 쿨다운 설정 · 매 틱 감소 · 중 재입력 무시', () => {
  const def = ALL_ACTIVES[0];

  it('발동하면 쿨다운이 서고, 매 틱 줄고, 그 사이 재입력은 무시된다', () => {
    if (def === undefined) return;
    const invest = investTree(def.shipTypeId, def.treeIndex, 5);
    const cfg: WorldConfig = {
      ...DEFAULT_CONFIG,
      shipType: def.shipTypeId,
      skillInvest: invest,
      activeSlots: [wireIdOf(def.id), -1],
    };
    const s = createWorld(0xc001d, cfg);
    for (let t = 0; t < 10; t++) stepWorld(s, IDLE);
    expect(s.activeCd0).toBe(0);

    stepWorld(s, FIRE);
    const expected = activeCooldownTicks(def, investedTotal(def, invest));
    expect(s.activeCd0).toBe(expected);

    // 다음 틱: 감소 + 재입력 무시(쿨다운이 다시 최대로 서지 않는다).
    stepWorld(s, FIRE);
    expect(s.activeCd0).toBe(expected - 1);
    expect(s.activeCd0).toBeLessThan(expected);

    // 끝까지 돌리면 0 으로 떨어지고 다시 발동 가능해진다.
    for (let t = 0; t < expected; t++) stepWorld(s, IDLE);
    expect(s.activeCd0).toBe(0);
    stepWorld(s, FIRE);
    expect(s.activeCd0).toBe(expected);
  });

  function investedTotal(d: typeof def, invest: number[]): number {
    if (d === undefined) return 0;
    const ship = SHIP_TYPES[d.shipTypeId];
    if (ship === undefined) return 0;
    const { start, end } = shipTreeRange(ship, d.treeIndex);
    let sum = 0;
    for (let i = start; i < end; i++) sum += invest[i] ?? 0;
    return sum;
  }
});

describe('AC-15 — SAVE_VERSION 8 마이그레이션 (손실 0 · 빈 슬롯 2칸)', () => {
  it('SAVE_VERSION 이 8 이다', () => {
    expect(SAVE_VERSION).toBe(8);
  });

  it('V7 프로필을 올리면 슬롯 2칸이 생기고 기존 진행은 그대로다', () => {
    const v7 = JSON.parse(JSON.stringify(defaultProfile())) as Record<string, unknown>;
    v7.saveVersion = 7;
    const ships = v7.ships as Record<string, unknown>[];
    // V7 에는 이 필드가 없었다.
    for (const s of ships) delete s.activeSlots;
    ships[0]!.level = 42;
    ships[0]!.xp = 123;
    v7.credits = 4567;

    const p = migrate(v7);
    expect(p.saveVersion).toBe(8);
    expect(p.credits).toBe(4567);
    expect(p.ships[0]?.level).toBe(42);
    expect(p.ships[0]?.xp).toBe(123);
    expect(p.ships[0]?.activeSlots).toEqual([null, null]);
  });

  it('손상된 슬롯 값(미지 id · 다른 기체 스킬 · 중복 · 길이 초과)은 조용히 떨어진다', () => {
    const raw = JSON.parse(JSON.stringify(defaultProfile())) as Record<string, unknown>;
    raw.saveVersion = 7;
    const ships = raw.ships as Record<string, unknown>[];
    ships[0]!.activeSlots = ['as_nonexistent', 42, 'as_bruiser_blade_lo', 'as_extra'];
    const p = migrate(raw);
    // 기본 기체는 스트라이커(typeId 0)라 브루저 스킬은 타입 불일치로 떨어진다.
    expect(p.ships[0]?.activeSlots).toEqual([null, null]);
    expect(p.ships[0]?.activeSlots.length).toBe(2);
  });
});
