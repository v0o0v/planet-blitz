/**
 * **관통 배선** 테스트 — 계획 PM-4 · AC-24 · AC-25.
 *
 * PM-4("장착은 되는데 런에 안 닿는다")는 이 저장소의 **지배적 실패 모드**다. 연구소에서
 * 장착되고 프로필에 저장되고 HUD 에 뜨는데, `Ship`→`WorldConfig` 의 유일 경로인
 * `buildRunConfig` 에 스탬프가 없으면 sim 은 "무엇이 장착됐는지"를 알 방법이 없어 발동이
 * 전부 no-op 이 된다. 그리고 **프로필 계층 단위 테스트는 전부 그린이다.**
 *
 * AC-25(음성)와 AC-24(양성)를 **양방향으로** 건다. 음성만 걸면 필터 조건을 뒤집어 써도
 * (항상 제외) 전부 통과하고 결함이 통합까지 잠복한다(계획 MJ-2).
 */

import { describe, it, expect } from 'vitest';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import type { Profile } from '../src/save/profile.js';
import { createWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldConfig } from '../src/sim/world.js';
import { POWERUPS, drawPowerupChoices } from '../src/sim/powerups.js';
import { ALL_ACTIVES, wireIdOf } from '../data/ships/actives/index.js';
import { ACTIVE_WIRE_EMPTY } from '../data/ships/actives/types.js';
import { SHIP_TYPES, zeroSkillInvest, shipTreeRange } from '../data/ships/index.js';

/** 그 스킬이 열리도록 계열에 부은 프로필. */
function profileWith(defIds: (string | null)[]): Profile {
  const first = defIds.find((d): d is string => d !== null);
  const def = first !== undefined ? ALL_ACTIVES.find((d) => d.id === first) : undefined;
  const p = defaultProfile();
  const ship = activeShip(p);
  if (def !== undefined) {
    ship.typeId = def.shipTypeId;
    const invest = zeroSkillInvest(def.shipTypeId);
    for (let i = 0; i < invest.length; i++) invest[i] = 50;
    ship.skillInvest = invest;
  }
  ship.activeSlots = [defIds[0] ?? null, defIds[1] ?? null];
  return p;
}

describe('PM-4 — Ship → WorldConfig 관통 (buildRunConfig 스탬프)', () => {
  it('장착이 없으면 `activeSlots` 필드를 **아예 싣지 않는다** (골든 JSON 바이트 불변의 축)', () => {
    const cfg = buildRunConfig(defaultProfile(), { planet: 0, stage: 1 });
    expect('activeSlots' in cfg).toBe(false);
    // 직렬화에도 키가 없어야 한다 — 리플레이 스냅샷이 기존과 바이트 동일해야 하기 때문이다.
    expect(JSON.stringify(cfg).includes('activeSlots')).toBe(false);
  });

  it('장착이 있으면 wire 정수 2칸이 실리고 sim 이 그것을 읽는다', () => {
    const def = ALL_ACTIVES[0];
    if (def === undefined) return;
    const cfg = buildRunConfig(profileWith([def.id, null]), { planet: 0, stage: 1 });
    expect(cfg.activeSlots).toEqual([wireIdOf(def.id), ACTIVE_WIRE_EMPTY]);
    // sim 까지 실제로 도달하는지 — 여기서 끊기는 것이 PM-4 의 형태다.
    const state = createWorld(1, cfg);
    expect(state.config.activeSlots).toEqual([wireIdOf(def.id), ACTIVE_WIRE_EMPTY]);
  });

  it('다른 기체의 스킬이 슬롯에 남아 있으면 빈 슬롯으로 떨어진다 (타입 고유 — ADR-0041)', () => {
    const def = ALL_ACTIVES.find((d) => d.shipTypeId !== 0);
    if (def === undefined) return;
    const p = profileWith([def.id, null]);
    activeShip(p).typeId = 0; // 스트라이커로 바꿔치기(손상 세이브 · 치트 시나리오)
    const cfg = buildRunConfig(p, { planet: 0, stage: 1 });
    expect('activeSlots' in cfg).toBe(false);
  });
});

describe('AC-25 (음성) — 미장착 런은 파워업 풀이 바이트 동일', () => {
  it('인덱스 0~23 의 wire 값이 불변이고 24·25 만 append 됐다', () => {
    expect(POWERUPS.length).toBe(26);
    expect(POWERUPS[0]?.id).toBe('rapid-fire');
    expect(POWERUPS[7]?.id).toBe('gem-magnet');
    expect(POWERUPS[23]?.id).toBe('field-medkit');
    expect(POWERUPS[24]?.activeSlot).toBe(0);
    expect(POWERUPS[25]?.activeSlot).toBe(1);
    // 0~23 에는 액티브 태그가 하나도 없어야 한다(append-only 의 물증).
    for (let i = 0; i < 24; i++) expect(POWERUPS[i]?.activeSlot, `pool[${i}]`).toBeUndefined();
  });

  it('장착 0개면 pool 이 액티브 도입 이전과 같은 집합이다 (가중 총합 불변의 축)', () => {
    const cfg: WorldConfig = { ...DEFAULT_CONFIG };
    const s = createWorld(0x101, cfg);
    // 기대 pool 을 **독립적으로 계산**한다 — `drawPowerupChoices` 의 필터를 그대로 베끼지 않고
    // "액티브 태그가 없고 · 이 무기에 유효하고 · 이 모드에 유효한 것" 이라는 정의에서 다시 센다.
    // (무기 필터가 오프빌드를 걷어내므로 24 종 전부가 후보인 것은 아니다.)
    const expected = POWERUPS.filter(
      (d) =>
        d.activeSlot === undefined &&
        (d.weaponType === undefined || d.weaponType === s.weapon.weaponType) &&
        (d.mode === undefined || d.mode === ((s.config.planetMode ?? 0) >>> 0)),
    ).length;
    const drawn = drawPowerupChoices(s, POWERUPS.length);
    expect(drawn.length).toBe(expected);
    expect(drawn.includes(24)).toBe(false);
    expect(drawn.includes(25)).toBe(false);
  });

  it('같은 시드에서 미장착 런의 추첨 시퀀스가 액티브 도입과 무관하다 (연속 60회)', () => {
    // 미장착이면 24·25 가 pool 에 **진입 자체를 안 하므로** 가중 총합이 그대로다. 총합이
    // 바뀌면 같은 시드에서도 뽑히는 것이 통째로 달라진다(계획 PM-2). 여기서는 그 불변식을
    // "뽑힌 인덱스가 항상 0..23" 으로 관측한다.
    const s = createWorld(0x5eed, { ...DEFAULT_CONFIG });
    for (let i = 0; i < 60; i++) {
      for (const idx of drawPowerupChoices(s, 4)) {
        expect(idx).toBeLessThan(24);
      }
    }
  });
});

describe('AC-24 (양성) — 장착 슬롯에 대응하는 선택지가 실제로 등장', () => {
  it('슬롯 1 만 장착하면 24 는 후보이고 25 는 부재다', () => {
    const def = ALL_ACTIVES[0];
    if (def === undefined) return;
    const cfg: WorldConfig = { ...DEFAULT_CONFIG, activeSlots: [wireIdOf(def.id), ACTIVE_WIRE_EMPTY] };
    const s = createWorld(0x202, cfg);
    const drawn = drawPowerupChoices(s, 26);
    expect(drawn.includes(24)).toBe(true);
    expect(drawn.includes(25)).toBe(false);
  });

  it('둘 다 장착하면 24·25 가 전부 후보다', () => {
    const a = ALL_ACTIVES[0];
    const b = ALL_ACTIVES[1];
    if (a === undefined || b === undefined) return;
    const cfg: WorldConfig = { ...DEFAULT_CONFIG, activeSlots: [wireIdOf(a.id), wireIdOf(b.id)] };
    const s = createWorld(0x303, cfg);
    const drawn = drawPowerupChoices(s, 26);
    expect(drawn.includes(24)).toBe(true);
    expect(drawn.includes(25)).toBe(true);
  });

  it('강화 파워업이 그 액티브의 계열 투자를 올린다 (위력↑·쿨다운↓ 파생의 실물)', () => {
    const def = ALL_ACTIVES[0];
    if (def === undefined) return;
    const ship = SHIP_TYPES[def.shipTypeId];
    if (ship === undefined) return;
    const invest = zeroSkillInvest(def.shipTypeId);
    for (let i = 0; i < invest.length; i++) invest[i] = 50;
    const cfg: WorldConfig = {
      ...DEFAULT_CONFIG,
      shipType: def.shipTypeId,
      skillInvest: invest,
      activeSlots: [wireIdOf(def.id), ACTIVE_WIRE_EMPTY],
    };
    const s = createWorld(0x404, cfg);
    const { start, end } = shipTreeRange(ship, def.treeIndex);
    const sum = (v: readonly number[]): number => {
      let t = 0;
      for (let i = start; i < end; i++) t += v[i] ?? 0;
      return t;
    };
    const before = sum(s.config.skillInvest ?? []);
    POWERUPS[24]?.apply(s);
    const after = sum(s.config.skillInvest ?? []);
    expect(after).toBeGreaterThan(before);
  });
});
