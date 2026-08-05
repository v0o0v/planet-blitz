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
import { ALL_ACTIVES, activeCooldownTicks, wireIdOf } from '../data/ships/actives/index.js';
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

  /**
   * ⚠️ **E7(ADR-0049) 로 계약이 바뀐 자리다.** 구 버전은 "파워업이 `skillInvest` 의 계열 합을
   * 올린다"를 관측량으로 삼았다 — 실제로 `bumpActiveTree` 가 투자 벡터를 직접 변형했기
   * 때문이다. flat 재편 후에는 칸마다 다른 메커닉이라 그 방식이 **포인트 0인 스킬을
   * 해금시키는 결함**이 됐고(계획 §2 E7), 강화분은 슬롯 전용 정수로 분리됐다.
   *
   * 그래서 관측량을 **바꾸되 의도는 유지**한다: "파워업이 실제로 그 액티브를 강화하는가"는
   * 여전히 이 층에서 지킬 값어치가 있다. 다만 이제 그 실물은 `skillInvest` 가 아니라
   * ①투자 벡터가 **불변**이고 ②슬롯 조율 정수가 오르고 ③그 결과 **실효 쿨다운이 실제로
   * 줄어드는** 것이다. ③이 없으면 "정수만 오르고 아무 데도 안 쓰이는" 상태를 통과시킨다.
   */
  it('강화 파워업이 그 액티브를 강화한다 — 투자 벡터는 불변, 조율 정수가 오르고 쿨다운이 준다', () => {
    const def = ALL_ACTIVES[0];
    if (def === undefined) return;
    const ship = SHIP_TYPES[def.shipTypeId];
    if (ship === undefined) return;
    const invest = zeroSkillInvest(def.shipTypeId);
    // 쿨다운 산식은 `floor(inv/4)*2` 라 **4의 배수 경계를 넘겨야** 값이 움직인다. 조율 +2 가
    // 경계를 넘도록 축 합을 4로 나눈 나머지 2 에 맞춘다(10칸 × 2 = 20 에서 한 칸만 +2 → 22).
    // 합이 20 이면 22 로 올라도 `floor` 값이 그대로라 ③이 거짓이 되고, 그건 산식 탓이지
    // 배선 탓이 아니다 — 표본을 경계에 세우는 것이 이 테스트의 전제다.
    const { start, end } = shipTreeRange(ship, def.treeIndex);
    for (let i = start; i < end; i++) invest[i] = 2;
    invest[start] = 4;
    const cfg: WorldConfig = {
      ...DEFAULT_CONFIG,
      shipType: def.shipTypeId,
      skillInvest: invest,
      activeSlots: [wireIdOf(def.id), ACTIVE_WIRE_EMPTY],
    };
    const s = createWorld(0x404, cfg);
    const investedInAxis = (v: readonly number[]): number => {
      let t = 0;
      for (let i = start; i < end; i++) t += v[i] ?? 0;
      return t;
    };
    const beforeInvest = investedInAxis(s.config.skillInvest ?? []);
    const beforeCd = activeCooldownTicks(def, beforeInvest + s.activeTune0);

    POWERUPS[24]?.apply(s);

    // ① 투자 벡터 불변 — E7 의 본체다(여기가 움직이면 포인트 0 스킬이 해금된다).
    expect(
      investedInAxis(s.config.skillInvest ?? []),
      'E7 위반 — 파워업이 skillInvest 를 다시 변형하고 있다',
    ).toBe(beforeInvest);
    // ② 슬롯 조율 정수가 올랐다(슬롯 1 = activeTune0).
    expect(s.activeTune0).toBeGreaterThan(0);
    expect(s.activeTune1, '반대 슬롯까지 오르면 안 된다').toBe(0);
    // ③ 그 결과 실효 쿨다운이 실제로 줄었다 — 정수만 오르고 안 쓰이는 상태를 배제한다.
    expect(activeCooldownTicks(def, investedInAxis(s.config.skillInvest ?? []) + s.activeTune0))
      .toBeLessThan(beforeCd);
  });
});
