/**
 * 하네스 침공 배치 편집 모듈 테스트 (`src/harness/invasionEdit.ts`).
 *
 * 검증 축은 넷이다:
 *   ① 슬롯 목록이 **코드 파생**인가(템플릿을 바꾸면 소켓 수가 함께 바뀐다 — 하드코딩 금지 확인)
 *   ② 입력 무변형 + 반환이 항상 정규형인가
 *   ③ 각 필드가 도메인 범위로 클램프되는가(과대·음수·비정수 입력)
 *   ④ 빈 슬롯 채우기·비우기·전체 채움의 의미가 성립하는가
 */

import { describe, it, expect } from 'vitest';
import {
  catalogKindFor,
  catalogSizeFor,
  clearSlot,
  fillAll,
  listSlots,
  setSlot,
  type SlotGroup,
} from '../src/harness/invasionEdit.js';
import {
  emptyInvasionLayers,
  normalizeInvasionLayers,
  layersEqual,
} from '../src/sim/invasion/normalize.js';
import {
  INVASION_ASCENSION_MAX,
  INVASION_LEVEL_MAX,
  INVASION_LEVEL_MIN,
  INVASION_PROP_SLOTS,
  INVASION_RARITY_COUNT,
  INVASION_SOCKET_COUNTS,
  INVASION_WAVE_SLOTS,
  MAP_TEMPLATE_CHOKE,
  MAP_TEMPLATE_STRAIGHT,
} from '../src/sim/invasion/constants.js';
import { CATALOG_KIND_COUNTS } from '../data/invasion/catalog.js';

const GROUPS: readonly SlotGroup[] = ['wave', 'socket', 'boss', 'prop'];

function withTemplate(templateId: number) {
  const base = emptyInvasionLayers();
  return normalizeInvasionLayers({ ...base, l2: { ...base.l2, templateId } });
}

describe('listSlots — 슬롯 목록은 코드 파생', () => {
  it('직선 템플릿에서 그룹별 개수가 상수와 일치한다', () => {
    const slots = listSlots(withTemplate(MAP_TEMPLATE_STRAIGHT));
    const count = (g: SlotGroup): number => slots.filter((s) => s.path.group === g).length;
    expect(count('wave')).toBe(INVASION_WAVE_SLOTS);
    expect(count('socket')).toBe(INVASION_SOCKET_COUNTS[MAP_TEMPLATE_STRAIGHT]);
    expect(count('boss')).toBe(1);
    expect(count('prop')).toBe(INVASION_PROP_SLOTS);
  });

  it('templateId 를 병목형으로 바꾸면 L2 소켓 수가 함께 줄어든다', () => {
    const straight = listSlots(withTemplate(MAP_TEMPLATE_STRAIGHT)).filter(
      (s) => s.path.group === 'socket',
    );
    const choke = listSlots(withTemplate(MAP_TEMPLATE_CHOKE)).filter(
      (s) => s.path.group === 'socket',
    );
    expect(straight.length).toBe(INVASION_SOCKET_COUNTS[MAP_TEMPLATE_STRAIGHT]);
    expect(choke.length).toBe(INVASION_SOCKET_COUNTS[MAP_TEMPLATE_CHOKE]);
    expect(choke.length).toBeLessThan(straight.length);
  });

  it('빈 배치는 ref=null · catalogName 이 빈 문자열이다', () => {
    for (const s of listSlots(emptyInvasionLayers())) {
      expect(s.ref).toBeNull();
      expect(s.catalogName).toBe('');
      expect(s.label.length).toBeGreaterThan(0);
    }
  });

  it('채워진 슬롯은 카탈로그 표시명을 낸다(조용한 공백 금지)', () => {
    const filled = setSlot(emptyInvasionLayers(), { group: 'wave', index: 0 }, { catalogId: 0 });
    const view = listSlots(filled).find((s) => s.path.group === 'wave' && s.path.index === 0);
    expect(view?.ref?.catalogId).toBe(0);
    expect(view?.catalogName.length).toBeGreaterThan(0);
  });

  it('라벨은 1 기반 번호이고 보스는 번호가 없다', () => {
    const slots = listSlots(emptyInvasionLayers());
    expect(slots.find((s) => s.path.group === 'wave' && s.path.index === 2)?.label).toBe(
      'L1 편대 #3',
    );
    expect(slots.find((s) => s.path.group === 'boss')?.label).toBe('L3 보스');
  });
});

describe('catalogSizeFor — 카탈로그 크기는 레지스트리 파생', () => {
  it('그룹별 크기가 CATALOG_KIND_COUNTS 와 같다', () => {
    for (const g of GROUPS) {
      expect(catalogSizeFor(g)).toBe(CATALOG_KIND_COUNTS[catalogKindFor(g)]);
      expect(catalogSizeFor(g)).toBeGreaterThan(0);
    }
  });
});

describe('setSlot — 순수성 · 클램프 · 기본값', () => {
  it('입력을 변형하지 않고 새 객체를 낸다', () => {
    const base = emptyInvasionLayers();
    const before = JSON.stringify(base);
    const next = setSlot(base, { group: 'wave', index: 0 }, { level: 40 });
    expect(JSON.stringify(base)).toBe(before);
    expect(next).not.toBe(base);
    expect(layersEqual(next, base)).toBe(false);
  });

  it('빈 슬롯은 기본값(레벨 최소·등급 0·승급 0·시드 0) 위에 patch 를 얹어 채운다', () => {
    const next = setSlot(emptyInvasionLayers(), { group: 'prop', index: 1 }, { rarity: 2 });
    const ref = next.l3.props[1];
    expect(ref).not.toBeNull();
    expect(ref?.level).toBe(INVASION_LEVEL_MIN);
    expect(ref?.ascension).toBe(0);
    expect(ref?.affixSeed).toBe(0);
    expect(ref?.catalogId).toBe(0);
    expect(ref?.rarity).toBe(2);
  });

  it('과대 입력은 각 상수 상한으로 클램프된다', () => {
    const next = setSlot(
      emptyInvasionLayers(),
      { group: 'socket', index: 0 },
      { level: 9999, ascension: 99, rarity: 99, catalogId: 9999 },
    );
    const ref = next.l2.sockets[0];
    expect(ref?.level).toBe(INVASION_LEVEL_MAX);
    expect(ref?.ascension).toBe(INVASION_ASCENSION_MAX);
    expect(ref?.rarity).toBe(INVASION_RARITY_COUNT - 1);
    expect(ref?.catalogId).toBe(catalogSizeFor('socket') - 1);
  });

  it('음수·비정수 입력도 도메인 안으로 접힌다', () => {
    const next = setSlot(
      emptyInvasionLayers(),
      { group: 'boss', index: 0 },
      { level: -5, ascension: -3, rarity: -1, catalogId: -2, affixSeed: -1 },
    );
    const ref = next.l3.boss;
    expect(ref?.level).toBe(INVASION_LEVEL_MIN);
    expect(ref?.ascension).toBe(0);
    expect(ref?.rarity).toBe(0);
    expect(ref?.catalogId).toBe(0);
    // uint32 접기 — 음수는 2^32 보수로 접힌다(normalize.ts 와 동일 규율).
    expect(ref?.affixSeed).toBe(0xffffffff);
  });

  it('소수 레벨은 정수로 잘린다(정규형 불변식)', () => {
    const next = setSlot(emptyInvasionLayers(), { group: 'wave', index: 0 }, { level: 12.9 });
    expect(next.l1.waveSlots[0]?.level).toBe(12);
    expect(layersEqual(next, normalizeInvasionLayers(next))).toBe(true);
  });

  it('범위 밖 인덱스는 무시하고 정규형 사본만 낸다', () => {
    const base = emptyInvasionLayers();
    const next = setSlot(base, { group: 'wave', index: 99 }, { level: 50 });
    expect(layersEqual(next, base)).toBe(true);
  });

  it('기존 값에 patch 를 얹으면 나머지 필드는 보존된다', () => {
    const first = setSlot(
      emptyInvasionLayers(),
      { group: 'wave', index: 3 },
      { level: 20, rarity: 2, affixSeed: 777 },
    );
    const second = setSlot(first, { group: 'wave', index: 3 }, { level: 21 });
    const ref = second.l1.waveSlots[3];
    expect(ref?.level).toBe(21);
    expect(ref?.rarity).toBe(2);
    expect(ref?.affixSeed).toBe(777);
  });
});

describe('clearSlot / fillAll', () => {
  it('clearSlot 은 해당 슬롯만 비운다', () => {
    const filled = fillAll(emptyInvasionLayers(), { level: 10 });
    const cleared = clearSlot(filled, { group: 'prop', index: 2 });
    expect(cleared.l3.props[2]).toBeNull();
    expect(cleared.l3.props[1]).not.toBeNull();
    expect(cleared.l1.waveSlots[0]).not.toBeNull();
  });

  it('fillAll 은 편집 가능한 전 슬롯을 같은 스펙으로 채운다', () => {
    const filled = fillAll(emptyInvasionLayers(), { level: 33, rarity: 3, ascension: 4 });
    const views = listSlots(filled);
    expect(views.length).toBeGreaterThan(0);
    for (const v of views) {
      expect(v.ref).not.toBeNull();
      expect(v.ref?.level).toBe(33);
      expect(v.ref?.rarity).toBe(3);
      expect(v.ref?.ascension).toBe(4);
      expect(v.catalogName.length).toBeGreaterThan(0);
    }
  });

  it('fillAll 은 수호·코어 모듈 슬롯을 건드리지 않는다(편집 대상 밖)', () => {
    const filled = fillAll(emptyInvasionLayers(), { level: 33 });
    expect(filled.l3.guardians.every((g) => g === null)).toBe(true);
    expect(filled.l3.modules.every((m) => m === null)).toBe(true);
  });

  it('fillAll 결과는 정규형이며 멱등하다', () => {
    const filled = fillAll(emptyInvasionLayers(), { level: 33, catalogId: 1 });
    expect(layersEqual(filled, normalizeInvasionLayers(filled))).toBe(true);
    expect(layersEqual(fillAll(filled, { level: 33, catalogId: 1 }), filled)).toBe(true);
  });
});
