/**
 * 챔피언(기체) 선택 화면의 UI-독립 계약 검증 (M8-L8).
 *
 * ## 이 파일이 막는 것 — 설계서 §10-5 / §10-6 / §10-7
 * 이 프로젝트에서 여덟 번 재발한 결함 유형은 **"단위 테스트는 전부 그린인데 배선이 통째로
 * 없다"** 이다. 챔피언 선택에서 그 유형이 나타날 자리는 정확히 세 곳이다:
 *
 * | # | 결함 | 왜 렌더 테스트로 안 잡히나 | 여기서의 방어 |
 * |---|---|---|---|
 * | §10-5 | 화면은 그려지는데 **선택이 저장 안 됨** | 노드 존재만 확인하면 통과. 다음 실행에서만 드러난다 | 화면이 실제로 부르는 `applyChampionChoice` 를 직접 돌려 `ships` 증가 · `activeShipIndex` 이동 · **store 에 실제 write** 를 본다 |
 * | §10-2 | 저장된 `typeId` 가 `WorldConfig` 에 도달 못 함 | 저장층 단위 테스트는 저장만 본다 | **정규 경로 통합**: 선택 → `buildRunConfig` → `createWorld` → `stepWorld` |
 * | §10-7 | 쇼케이스 아트 이름이 로더 목록에 없음 → 조용한 null | 렌더가 null 을 예외 없이 삼킨다 | 전 SHIP_TYPES 의 쇼케이스 basename 이 `UI_ASSET_NAMES` 에 실재하는지 대조 |
 *
 * 실제 그리기(여백·프레임 침범·스크롤 감)는 브라우저 확인 몫이다 — 여기서는 **캔버스 없이도
 * 틀렸다고 말할 수 있는 것**만 고정한다.
 */

import { describe, it, expect } from 'vitest';
import {
  applyChampionChoice,
  formatBp,
  rosterSize,
  rosterStackHeight,
  ROSTER_ROW_H,
  ROSTER_ROW_GAP,
  ROSTER_LIST_AVAIL,
} from '../src/ui/pixi/championSelect.js';
import {
  shipTypeName,
  shipTypeRole,
  shipSignatureDesc,
  shipTreeName,
  humanizeSlug,
  hasMessageKey,
  tShipKey,
} from '../src/ui/pixi/shipLabels.js';
import { shipShowcaseName, LEGACY_SHOWCASE, UI_ASSET_NAMES, SHIP_SHOWCASE_NAMES } from '../src/ui/pixi/uiTextures.js';
import { SHIP_TYPES, selectableShipTypes, shipSkillNodeCount } from '../data/ships/index.js';
import { defaultProfile, activeShip, type KeyValueStore, type Profile } from '../src/save/profile.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { createWorld, stepWorld, emptyInput } from '../src/sim/world.js';
import { hasSignature } from '../src/sim/shipSignature.js';

/** 인메모리 스토어(vitest 는 node 환경이라 localStorage 가 없다). */
function memStore(): KeyValueStore & { data: Map<string, string>; writes: number } {
  const data = new Map<string, string>();
  const store = {
    data,
    writes: 0,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.writes++;
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
  return store;
}

describe('로스터는 전체 개방이다 (ADR-0019 — 해금 게이트 없음)', () => {
  it('선택 가능한 타입 = 레지스트리 전량', () => {
    expect(selectableShipTypes()).toHaveLength(SHIP_TYPES.length);
    expect(rosterSize()).toBe(SHIP_TYPES.length);
  });

  it('레벨·진행도 조건이 붙지 않았다(선의로 게이트를 다는 것을 막는 유일한 수단)', () => {
    // 전체 개방은 취향이 아니라 **명시적으로 기록된 결정**이다. 목록이 프로필과 무관해야 한다.
    const fresh = defaultProfile();
    const veteran = defaultProfile();
    activeShip(veteran).level = 99;
    expect(selectableShipTypes().map((d) => d.id)).toEqual(SHIP_TYPES.map((d) => d.id));
    expect(fresh.ships).toHaveLength(1);
    expect(veteran.ships).toHaveLength(1);
  });
});

describe('로스터 목록 기하', () => {
  it('행 스택 높이는 마지막 행 뒤 간격을 빼고 센다', () => {
    expect(rosterStackHeight(0)).toBe(0);
    expect(rosterStackHeight(1)).toBe(ROSTER_ROW_H);
    expect(rosterStackHeight(2)).toBe(ROSTER_ROW_H * 2 + ROSTER_ROW_GAP);
  });

  it('현재 로스터가 스크롤 창 안에 들어간다(들어가지 않아도 스크롤 영역이 받는다)', () => {
    expect(ROSTER_LIST_AVAIL).toBeGreaterThan(ROSTER_ROW_H);
    // 지금은 5종이라 한 화면에 들어간다. 7종으로 늘면 이 기대가 깨지는데, 그때 필요한 조치는
    // "테스트 완화" 가 아니라 스크롤이 실제로 도는지 확인이다(makeScrollArea 가 이미 붙어 있다).
    expect(rosterStackHeight(rosterSize())).toBeLessThanOrEqual(ROSTER_LIST_AVAIL);
  });
});

describe('formatBp — 섀시 보정 표시', () => {
  it('0 은 대시, 양수는 +, 음수는 그대로', () => {
    expect(formatBp(0)).toBe('—');
    expect(formatBp(800)).toBe('+8%');
    expect(formatBp(-1200)).toBe('-12%');
    expect(formatBp(2500)).toBe('+25%');
  });

  it('정수로 안 떨어지는 bp 는 소수 1자리', () => {
    expect(formatBp(150)).toBe('+1.5%');
    expect(formatBp(-50)).toBe('-0.5%');
  });
});

describe('표시명은 SHIP_TYPES 파생이고, 키를 화면에 노출하지 않는다', () => {
  it('humanizeSlug 가 자리표시자를 만든다', () => {
    expect(humanizeSlug('arccaster')).toBe('Arccaster');
    expect(humanizeSlug('max_hp_flat')).toBe('Max Hp Flat');
    expect(humanizeSlug('')).toBe('');
  });

  it('tShipKey 는 등재된 키만 카탈로그에서 읽고, 없으면 폴백을 준다', () => {
    expect(hasMessageKey('lab.tree.firepower')).toBe(true);
    expect(hasMessageKey('ship.__does_not_exist__.name')).toBe(false);
    expect(tShipKey('ship.__does_not_exist__.name', 'FALLBACK')).toBe('FALLBACK');
  });

  it('전 타입·전 계열의 표시명이 절대 원본 키로 새지 않는다', () => {
    // 폴백이 없으면 `t()` 가 'ship.bruiser.name' 같은 키를 그대로 화면에 뱉는다(§10-6).
    for (const def of SHIP_TYPES) {
      const name = shipTypeName(def);
      expect(name.length, def.slug).toBeGreaterThan(0);
      expect(name.startsWith('ship.'), def.slug).toBe(false);
      // 역할·시그니처는 비어 있을 수 있지만(아직 L9 미착수), 키가 새어서는 안 된다.
      expect(shipTypeRole(def).startsWith('ship.'), def.slug).toBe(false);
      expect(shipSignatureDesc(def).startsWith('ship.'), def.slug).toBe(false);
      for (const tree of def.trees) {
        const label = shipTreeName(tree);
        expect(label.length, `${def.slug}/${tree.slug}`).toBeGreaterThan(0);
        expect(label.startsWith('lab.tree.'), `${def.slug}/${tree.slug}`).toBe(false);
      }
    }
  });

  it('스트라이커는 시그니처가 없다 — 설명도 빈 문자열(설계서 §11 채택안 A)', () => {
    expect(SHIP_TYPES[0]!.signatureBit).toBeLessThan(0);
    expect(shipSignatureDesc(SHIP_TYPES[0]!)).toBe('');
  });
});

describe('쇼케이스 아트 이름 (§10-7 의 쇼케이스 판)', () => {
  it('타입 0 은 레거시 파일명을 그대로 쓴다(파일을 옮기지 않는다)', () => {
    expect(shipShowcaseName(0)).toBe(LEGACY_SHOWCASE);
  });

  it('타입 1~ 은 slug 파생', () => {
    for (const def of SHIP_TYPES) {
      if (def.id === 0) continue;
      expect(shipShowcaseName(def.id)).toBe(`ship_showcase_${def.slug}.png`);
    }
  });

  it('손상 typeId 는 레거시로 되돌아온다(존재하지 않는 파일명을 만들지 않는다)', () => {
    expect(shipShowcaseName(999)).toBe(LEGACY_SHOWCASE);
    expect(shipShowcaseName(-3)).toBe(LEGACY_SHOWCASE);
  });

  it('전 타입의 쇼케이스 basename 이 로더 목록에 실재한다', () => {
    const registered = new Set<string>(UI_ASSET_NAMES);
    expect(SHIP_SHOWCASE_NAMES).toHaveLength(SHIP_TYPES.length);
    for (const def of SHIP_TYPES) {
      const name = shipShowcaseName(def.id);
      expect(registered.has(name), `${def.slug} → ${name}`).toBe(true);
    }
  });
});

describe('확정은 실제로 저장된다 (§10-5)', () => {
  it('ships 증가 · activeShipIndex 이동 · 새 기체가 선택 타입 · store 에 write', () => {
    const store = memStore();
    const profile = defaultProfile();
    activeShip(profile).level = 7;
    const before = profile.ships.length;
    const writesBefore = store.writes;

    const applied = applyChampionChoice(profile, 2, store);

    expect(applied).toBe(2);
    expect(profile.ships).toHaveLength(before + 1);
    expect(profile.activeShipIndex).toBe(profile.ships.length - 1);
    const ship = activeShip(profile);
    expect(ship.typeId).toBe(2);
    expect(ship.level).toBe(1);
    expect(ship.xp).toBe(0);
    expect(ship.equipped).toEqual({});
    expect(ship.skillInvest).toHaveLength(shipSkillNodeCount(2));
    expect(ship.skillInvest.every((v) => v === 0)).toBe(true);
    // 퇴역한 세대는 수호로 남는다.
    expect(profile.guardians.length).toBeGreaterThan(0);
    // ⚠️ 저장이 실제로 일어나야 한다. 이게 빠지면 화면은 정상이고 다음 실행에서만 드러난다.
    expect(store.writes).toBeGreaterThan(writesBefore);
    expect(store.data.size).toBeGreaterThan(0);
  });

  it('선택 직후 다시 로드해도 그 타입이 살아 있다(왕복 무손실)', () => {
    const store = memStore();
    const profile = defaultProfile();
    applyChampionChoice(profile, 1, store);
    // loadProfile 은 기본 스토어를 쓰므로 migrate 를 직접 태워 왕복을 본다.
    const raw = store.getItem('planet-blitz:profile');
    expect(raw).not.toBeNull();
    const reloaded = JSON.parse(raw!) as Profile;
    const idx = reloaded.activeShipIndex;
    expect(reloaded.ships[idx]!.typeId).toBe(1);
  });

  it('손상 typeId 는 스트라이커로 되돌린다(clamp 가 아니라 0)', () => {
    const store = memStore();
    const profile = defaultProfile();
    expect(applyChampionChoice(profile, 999, store)).toBe(0);
    expect(activeShip(profile).typeId).toBe(0);
  });

  it('교체 후 투자 벡터의 정본이 새 기체 것이다(연구소가 옛 기체를 편집하지 않는다)', () => {
    // W1 의 임시 장치였던 `Profile.skillInvest` 별칭은 M8-L7 이 삭제했다. 정본은 기체 벡터
    // 하나뿐이므로, 화면(연구소)이 `activeShip(profile).skillInvest` 를 읽는 한 갈릴 수 없다.
    const store = memStore();
    const profile = defaultProfile();
    const old = activeShip(profile).skillInvest;
    applyChampionChoice(profile, 4, store);
    const next = activeShip(profile).skillInvest;
    expect(next).not.toBe(old);
    expect(next).toHaveLength(shipSkillNodeCount(4));
    expect(next.every((v) => v === 0)).toBe(true);
  });
});

describe('정규 경로 통합 — 선택 → buildRunConfig → createWorld → stepWorld (§10-2)', () => {
  it('선택한 타입이 WorldConfig.shipType 과 시그니처 비트까지 실제로 도달한다', () => {
    const store = memStore();
    const profile = defaultProfile();
    applyChampionChoice(profile, 1, store); // 브루저

    const cfg = buildRunConfig(profile, { planet: 0, tier: 0 });
    expect(cfg.shipType).toBe(1);
    expect(cfg.skillInvest).toHaveLength(shipSkillNodeCount(1));
    // 시그니처 비트가 loadout.uniqueMask 에 실제로 OR 돼 있어야 한다(§10-1).
    const bit = SHIP_TYPES[1]!.signatureBit;
    expect(bit).toBeGreaterThanOrEqual(0);
    expect(hasSignature(cfg.loadout?.uniqueMask ?? 0, bit)).toBe(true);

    // 그리고 그 config 로 월드가 실제로 돈다(조립만 되고 sim 이 거부하는 상태가 아니다).
    const world = createWorld(12345, cfg);
    for (let i = 0; i < 60; i++) stepWorld(world, emptyInput());
    expect(world.tick).toBe(60);
  });

  it('스트라이커는 시그니처 비트를 하나도 세우지 않는다(회귀 탐지기 보존)', () => {
    const store = memStore();
    const profile = defaultProfile();
    applyChampionChoice(profile, 0, store);
    const cfg = buildRunConfig(profile, { planet: 0, tier: 0 });
    expect(cfg.shipType).toBe(0);
    for (const def of SHIP_TYPES) {
      if (def.signatureBit < 0) continue;
      expect(hasSignature(cfg.loadout?.uniqueMask ?? 0, def.signatureBit), def.slug).toBe(false);
    }
  });

  it('타입이 다르면 같은 seed·입력에서도 관측 결과가 갈린다(파생이 죽어 있지 않다)', () => {
    const a = defaultProfile();
    applyChampionChoice(a, 0, memStore());
    const b = defaultProfile();
    applyChampionChoice(b, 1, memStore());

    const wa = createWorld(999, buildRunConfig(a, { planet: 0, tier: 0 }));
    const wb = createWorld(999, buildRunConfig(b, { planet: 0, tier: 0 }));
    for (let i = 0; i < 30; i++) {
      stepWorld(wa, emptyInput());
      stepWorld(wb, emptyInput());
    }
    // 브루저는 maxHp +25% — 파생이 실제로 걸렸다면 플레이어 최대 체력이 다르다.
    expect(wb.entities[0]!.maxHp).not.toBe(wa.entities[0]!.maxHp);
  });
});
