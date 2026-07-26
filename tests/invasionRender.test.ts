/**
 * 침공 3레이어 렌더 계약 테스트 (M7a · L10-render).
 *
 * 렌더는 sim 과 달리 "틀려도 조용한" 층이다 — 미등록 kind 는 폴백 텍스처로 그려지고, 배경
 * 전환을 잊어도 화면이 그냥 안 바뀔 뿐 예외가 나지 않는다. 그래서 여기서는 그리기 자체가
 * 아니라 **매핑·기하·알파의 순수 함수**를 검증하고, kind 목록은 `KIND_CODE` 에서 파생해
 * 신규 kind 가 추가되면 자동으로 실패하게 한다(하드코딩 목록 금지).
 *
 * PixiJS 는 렌더러 없이 import 만 하므로 node 환경에서 그대로 돈다(tests/radar.test.ts 선례).
 */

import { describe, it, expect } from 'vitest';
import type { Texture } from 'pixi.js';
import { SHIP_TYPES } from '../data/ships/index.js';
import {
  spriteSlotFor,
  resolveSpriteSlot,
  railTelegraph,
  TELEGRAPH_COLOR,
  type SpriteSlot,
} from '../src/render/entityRenderer.js';
// 해저드 표시 규칙은 `hazardVisual.ts` 로 옮겼다(색=성질·형태=상태, 2026-07-26).
import { hazardVisual } from '../src/render/hazardVisual.js';
import {
  backdropCrossfadeAlpha,
  invasionBackdropTexture,
  INVASION_BACKDROP_INDEX,
  INVASION_CROSSFADE_TICKS,
} from '../src/render/invasionBackdrop.js';
import {
  FACILITY_ASSET_FILES,
  PROP_ASSET_FILES,
  DEFENSE_BOSS_ASSET_FILES,
  INVASION_BACKDROP_ASSET_FILES,
  type PlaceholderTextures,
} from '../src/render/textures.js';
import { KIND_CODE, type EntityKind } from '../src/sim/entities.js';
import type { EntitySnapshot } from '../src/sim/snapshot.js';
import { PHASE_L1, PHASE_L2, PHASE_L3 } from '../src/sim/invasion/constants.js';
import {
  FACILITY_CATALOG_COUNT,
  INVASION_FACILITIES,
  facilitySpecFor,
} from '../data/invasion/facilities.js';
import { PROP_ROLE_COUNT } from '../data/invasion/props.js';
import { DEFENSE_BOSS_COUNT } from '../data/invasion/defenseBosses.js';
import { HAZARD_LAVA, HAZARD_SLOW } from '../src/sim/patterns/types.js';
import { ENCOUNTER_TYPE } from '../data/encounters.js';

// ---------------------------------------------------------------------------
// 스텁 — 실제 Renderer 없이 슬롯 해석만 검증하기 위한 표식 텍스처
// ---------------------------------------------------------------------------

/** 이름표를 단 가짜 텍스처(해석 결과가 "어느 슬롯의 몇 번" 인지 되읽기 위함). */
function tex(label: string): Texture {
  return { label } as unknown as Texture;
}

function labelOf(t: Texture): string {
  return (t as unknown as { label: string }).label;
}

function stubTextures(): PlaceholderTextures {
  const arr = (name: string, n: number): Texture[] =>
    Array.from({ length: n }, (_, i) => tex(`${name}[${i}]`));
  return {
    player: tex('player'),
    // 기체 타입별 인게임 스프라이트 슬롯(M8). 개수는 레지스트리 파생이라 타입이 늘어도
    // 스텁이 조용히 짧아지지 않는다.
    shipByType: SHIP_TYPES.map((d) => tex(`ship[${d.id}]`)),
    bullet: tex('bullet'),
    enemyBullet: tex('enemyBullet'),
    enemyBulletBehaviors: arr('enemyBulletBehaviors', 4),
    gem: tex('gem'),
    enemy: arr('enemy', 22),
    boss: arr('boss', 4),
    supply: tex('supply'),
    parachute: null,
    loot: tex('loot'),
    explosion: tex('explosion'),
    background: arr('background', 4),
    wall: tex('wall'),
    destructible: tex('destructible'),
    magnetEmitter: tex('magnetEmitter'),
    bombDevice: tex('bombDevice'),
    turretPickup: tex('turretPickup'),
    shelter: tex('shelter'),
    encounterPortal: tex('encounterPortal'),
    encounterSeal: tex('encounterSeal'),
    encounterAltar: tex('encounterAltar'),
    core: tex('core'),
    guardian: arr('guardian', 2),
    invasionBackdrop: arr('invasionBackdrop', 3),
    facility: arr('facility', FACILITY_CATALOG_COUNT),
    prop: arr('prop', PROP_ROLE_COUNT),
    defenseBoss: arr('defenseBoss', DEFENSE_BOSS_COUNT),
    formation: tex('formation'),
    formationDrone: tex('formationDrone'),
    spawnedDrone: tex('spawnedDrone'),
  };
}

function snap(kind: EntityKind, over: Partial<EntitySnapshot> = {}): EntitySnapshot {
  return {
    id: 1,
    kind,
    x: 0,
    y: 0,
    angle: 0,
    radius: 20,
    aabbH: 0,
    enemyType: 0,
    hp: 10,
    maxHp: 10,
    active: false,
    flash: false,
    elite: -1,
    ...over,
  };
}

/** 슬롯 서술을 문자열로(비교·오류 메시지 가독). */
function slotName(s: SpriteSlot): string {
  return s.kind === 'overlay' ? 'overlay' : s.kind === 'single' ? s.slot : `${s.slot}[]`;
}

const ALL_KINDS = Object.keys(KIND_CODE) as EntityKind[];

/** M7a 가 예약한 3레이어 신규 kind(코드 19..26). */
const INVASION_KINDS: readonly EntityKind[] = [
  'formation',
  'formationDrone',
  'facilityGun',
  'facilityHazard',
  'facilitySpawner',
  'spawnedDrone',
  'prop',
  'defenseBoss',
];

describe('신규 kind 스프라이트 매핑 (전수)', () => {
  it('KIND_CODE 의 모든 kind 가 슬롯을 갖는다 — 미등록 폴백이 없다', () => {
    // 신규 kind 를 entities.ts 에 추가하고 렌더 매핑을 잊으면 여기서 즉시 실패한다.
    for (const kind of ALL_KINDS) {
      const slot = spriteSlotFor(kind, 0);
      expect(slot, `${kind} 매핑 누락`).toBeDefined();
      if (kind === 'hazard') {
        expect(slot.kind).toBe('overlay'); // 유일하게 스프라이트가 없는 kind
      } else if (kind !== 'player') {
        // player 외 어떤 kind 도 player 텍스처로 새 나가면 안 된다(조용한 폴백 방지).
        expect(slotName(slot), `${kind} 가 player 로 폴백`).not.toBe('player');
      }
    }
  });

  it('침공 3레이어 신규 kind 8종이 전용 슬롯으로 간다', () => {
    const expected: Record<string, string> = {
      formation: 'formation',
      formationDrone: 'formationDrone',
      spawnedDrone: 'spawnedDrone',
      facilityGun: 'facility[]',
      facilityHazard: 'facility[]',
      facilitySpawner: 'facility[]',
      prop: 'prop[]',
      defenseBoss: 'defenseBoss[]',
    };
    for (const kind of INVASION_KINDS) {
      expect(slotName(spriteSlotFor(kind, 0))).toBe(expected[kind]);
    }
  });

  it('KIND_CODE 에 3레이어 8종이 모두 살아 있다(계약 코드 19..26)', () => {
    for (const kind of INVASION_KINDS) expect(KIND_CODE[kind]).toBeGreaterThanOrEqual(19);
    expect(new Set(INVASION_KINDS.map((k) => KIND_CODE[k])).size).toBe(8);
  });

  it('설비 3종은 catalogId 로, 기물은 역할 코드로 인덱싱한다', () => {
    // 설비: enemyType = 설비 catalogId (facility.ts 필드 매핑표).
    const gun = spriteSlotFor('facilityGun', 4);
    expect(gun).toEqual({ kind: 'array', slot: 'facility', index: 4 });
    // 기물: enemyType = 역할 코드 PROP_* (coreRoom.ts 필드 매핑표) — catalogId 가 아니다.
    const prop = spriteSlotFor('prop', 2);
    expect(prop).toEqual({ kind: 'array', slot: 'prop', index: 2 });
  });

  it('텍스처 배열 길이가 카탈로그 크기와 일치한다(조용한 인덱스 폴백 방지)', () => {
    expect(FACILITY_ASSET_FILES).toHaveLength(FACILITY_CATALOG_COUNT);
    expect(PROP_ASSET_FILES).toHaveLength(PROP_ROLE_COUNT);
    expect(DEFENSE_BOSS_ASSET_FILES).toHaveLength(DEFENSE_BOSS_COUNT);
    expect(INVASION_BACKDROP_ASSET_FILES).toHaveLength(3);
    // 자산 파일명이 카탈로그에서 파생되므로 서로 겹치지 않는다(덮어쓰기 사고 방지).
    expect(new Set(FACILITY_ASSET_FILES).size).toBe(FACILITY_CATALOG_COUNT);
  });

  it('스텁 텍스처로 해석하면 지정한 슬롯·인덱스의 텍스처가 나온다', () => {
    const t = stubTextures();
    expect(labelOf(resolveSpriteSlot(t, spriteSlotFor('facilityHazard', 3)))).toBe('facility[3]');
    expect(labelOf(resolveSpriteSlot(t, spriteSlotFor('prop', 1)))).toBe('prop[1]');
    expect(labelOf(resolveSpriteSlot(t, spriteSlotFor('defenseBoss', 0)))).toBe('defenseBoss[0]');
    expect(labelOf(resolveSpriteSlot(t, spriteSlotFor('formationDrone', 0)))).toBe('formationDrone');
    // 범위 밖 인덱스는 0 번으로 폴백한다(화면이 비지 않는다).
    expect(labelOf(resolveSpriteSlot(t, spriteSlotFor('facilityGun', 999)))).toBe('facility[0]');
    expect(labelOf(resolveSpriteSlot(t, spriteSlotFor('prop', -1)))).toBe('prop[0]');
    // 보스는 enemyType 이 아니라 planet 인덱스로 고른다(기존 계약 회귀 가드).
    expect(labelOf(resolveSpriteSlot(t, spriteSlotFor('boss', 0, 2)))).toBe('boss[2]');
  });
});

describe('조우 오브젝트 아트 매핑 (ADR-0033)', () => {
  // 이 describe 가 지키는 계약 하나: **포탈 kind 하나가 두 조우를 실어 나른다.** 봉인 수호자는
  // 신규 EntityKind 를 만들지 않고 encounterPortal 을 재사용하므로(KIND_CODE 는 append-only 해시
  // 계약), 렌더가 둘을 가르는 유일한 근거가 조우 유형이다. kind 로 가르도록 되돌아가면 화면에서
  // 포탈과 봉인석이 같아지는데, 그건 예외를 내지 않아 조용히 넘어간다 — 그래서 테스트로 못 박는다.
  it('조우 유형이 같은 kind 를 포탈/봉인 아트로 가른다', () => {
    const t = stubTextures();
    const at = (encounterType: number): string =>
      labelOf(resolveSpriteSlot(t, spriteSlotFor('encounterPortal', 0, 0, encounterType)));
    expect(at(ENCOUNTER_TYPE.treasureVault)).toBe('encounterPortal');
    expect(at(ENCOUNTER_TYPE.sealedGuardian)).toBe('encounterSeal');
    // 유형 미상(0)·무관 유형은 포탈로 폴백한다 — 화면이 비지 않는다.
    expect(at(0)).toBe('encounterPortal');
    expect(at(ENCOUNTER_TYPE.ghostConvoy)).toBe('encounterPortal');
  });

  it('제단은 kind 로 갈리고 포탈·봉인과 다른 텍스처를 쓴다', () => {
    const t = stubTextures();
    expect(labelOf(resolveSpriteSlot(t, spriteSlotFor('encounterAltar', 0)))).toBe('encounterAltar');
    // 3종이 서로 다른 슬롯이라는 것이 이 레인의 요구다(placeholder 시절엔 셋이 전부 magnetEmitter 였다).
    const slots = new Set([
      slotName(spriteSlotFor('encounterPortal', 0, 0, ENCOUNTER_TYPE.treasureVault)),
      slotName(spriteSlotFor('encounterPortal', 0, 0, ENCOUNTER_TYPE.sealedGuardian)),
      slotName(spriteSlotFor('encounterAltar', 0)),
    ]);
    expect(slots.size).toBe(3);
    expect(slots.has('magnetEmitter')).toBe(false);
  });

  it('조우 아트는 조우 kind 밖으로 새지 않는다(자석 이미터 회귀 가드)', () => {
    // 자석 이미터는 자기 전용 텍스처를 그대로 쓴다 — 조우 유형이 켜져 있어도 무영향.
    const t = stubTextures();
    expect(
      labelOf(resolveSpriteSlot(t, spriteSlotFor('magnetEmitter', 0, 0, ENCOUNTER_TYPE.sealedGuardian))),
    ).toBe('magnetEmitter');
  });
});

describe('레이어별 배경 · 크로스페이드', () => {
  it('배경 텍스처 3종이 페이즈 코드로 인덱싱된다', () => {
    const t = stubTextures();
    expect(INVASION_BACKDROP_INDEX).toEqual([PHASE_L1, PHASE_L2, PHASE_L3]);
    expect(labelOf(invasionBackdropTexture(t, PHASE_L1))).toBe('invasionBackdrop[0]');
    expect(labelOf(invasionBackdropTexture(t, PHASE_L2))).toBe('invasionBackdrop[1]');
    expect(labelOf(invasionBackdropTexture(t, PHASE_L3))).toBe('invasionBackdrop[2]');
  });

  it('범위 밖 페이즈는 L1 배경으로 폴백한다', () => {
    const t = stubTextures();
    expect(labelOf(invasionBackdropTexture(t, 7))).toBe('invasionBackdrop[0]');
    expect(labelOf(invasionBackdropTexture(t, -1))).toBe('invasionBackdrop[0]');
  });

  it('침공 배경 슬롯이 비어 있으면 행성 배경으로 폴백한다(자산 누락 내성)', () => {
    const t = stubTextures();
    t.invasionBackdrop = [];
    expect(labelOf(invasionBackdropTexture(t, PHASE_L2))).toBe('background[0]');
  });

  it('크로스페이드 알파는 전이 경과 틱의 순수 함수다', () => {
    expect(backdropCrossfadeAlpha(0)).toBe(0);
    expect(backdropCrossfadeAlpha(-5)).toBe(0);
    expect(backdropCrossfadeAlpha(INVASION_CROSSFADE_TICKS)).toBe(1);
    expect(backdropCrossfadeAlpha(INVASION_CROSSFADE_TICKS * 3)).toBe(1);
    const mid = backdropCrossfadeAlpha(INVASION_CROSSFADE_TICKS / 2);
    expect(mid).toBeCloseTo(0.5, 10);
    // 같은 입력 → 같은 출력(호출 순서·횟수 무관). 렌더 상태에 의존하지 않는다.
    expect(backdropCrossfadeAlpha(11)).toBe(backdropCrossfadeAlpha(11));
    // 단조 증가.
    let prev = -1;
    for (let e = 0; e <= INVASION_CROSSFADE_TICKS; e += 3) {
      const a = backdropCrossfadeAlpha(e);
      expect(a).toBeGreaterThanOrEqual(prev);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
      prev = a;
    }
    // NaN 도 0 으로 접힌다(보간 틱이 오염돼도 배경이 사라지지 않는다).
    expect(backdropCrossfadeAlpha(Number.NaN)).toBe(0);
  });
});

describe('예고선(관통 레일포 텔레그래프)', () => {
  /** 예고선 스펙이 있는 설비 catalogId(카탈로그에서 파생 — 하드코딩 금지). */
  const telegraphId = INVASION_FACILITIES.findIndex((s) => s.telegraphTicks > 0);

  it('카탈로그에 예고선 설비가 최소 1종 있다', () => {
    expect(telegraphId).toBeGreaterThanOrEqual(0);
  });

  it('예고 구간(active)에만 그려진다', () => {
    const e = snap('facilityGun', { enemyType: telegraphId, active: true });
    expect(railTelegraph(e, 0)).not.toBeNull();
    // 대기 상태(예고 아님)에서는 선이 없다 — 항상 보이면 예고의 의미가 사라진다.
    expect(railTelegraph(snap('facilityGun', { enemyType: telegraphId, active: false }), 0)).toBeNull();
  });

  it('설비가 아닌 kind 는 절대 예고선을 만들지 않는다', () => {
    for (const kind of ALL_KINDS) {
      if (kind === 'facilityGun') continue;
      expect(railTelegraph(snap(kind, { active: true }), 0), `${kind}`).toBeNull();
    }
  });

  it('길이는 카탈로그 사거리에서 파생되고 방향은 잠긴 조준각을 따른다', () => {
    const spec = facilitySpecFor(telegraphId);
    expect(spec).toBeDefined();
    const e = snap('facilityGun', { enemyType: telegraphId, active: true, x: 100, y: 50, angle: 0 });
    const rail = railTelegraph(e, 0);
    expect(rail).not.toBeNull();
    expect(rail!.x1).toBe(100);
    expect(rail!.y1).toBe(50);
    expect(rail!.x2 - rail!.x1).toBeCloseTo(spec!.range, 6);
    expect(rail!.y2 - rail!.y1).toBeCloseTo(0, 6);
    // 각도를 90° 로 잠그면 선도 함께 돈다.
    const turned = railTelegraph(
      snap('facilityGun', { enemyType: telegraphId, active: true, x: 0, y: 0, angle: Math.PI / 2 }),
      0,
    );
    expect(turned!.x2).toBeCloseTo(0, 6);
    expect(turned!.y2).toBeCloseTo(spec!.range, 6);
  });

  it('사거리 0(또는 미지 catalogId) 설비는 선을 그리지 않는다', () => {
    expect(railTelegraph(snap('facilityGun', { enemyType: 9999, active: true }), 0)).toBeNull();
  });

  it('알파는 맥동하되 항상 보이는 범위(0.45~0.9)에 머문다', () => {
    for (let t = 0; t < 60; t++) {
      const rail = railTelegraph(snap('facilityGun', { enemyType: telegraphId, active: true }), t);
      expect(rail!.alpha).toBeGreaterThanOrEqual(0.44);
      expect(rail!.alpha).toBeLessThanOrEqual(0.91);
    }
    expect(TELEGRAPH_COLOR).toBe(0xffb020);
  });
});

describe('주기 해저드 온오프 표현', () => {
  it('예열은 테두리만, 활성은 채움 — 리듬이 눈에 읽힌다', () => {
    const warm = hazardVisual(HAZARD_LAVA, false);
    const hot = hazardVisual(HAZARD_LAVA, true);
    expect(warm.fillAlpha).toBe(0);
    expect(hot.fillAlpha).toBeGreaterThan(0);
    expect(hot.color).toBe(warm.color); // 색 = 종류(상태로 색이 바뀌면 종류를 잃는다)
    expect(warm.dashed).toBe(true); // 상태는 형태로 — 예열은 점선
    expect(hot.dashed).toBe(false);
  });

  it('색이 subtype 별로 갈린다(용암/감속/박격)', () => {
    const lava = hazardVisual(HAZARD_LAVA, true).color;
    const slow = hazardVisual(HAZARD_SLOW, true).color;
    const mortar = hazardVisual(0, true).color;
    expect(new Set([lava, slow, mortar]).size).toBe(3);
  });

  it('미지의 subtype 도 보이는 색으로 폴백한다', () => {
    const st = hazardVisual(9999, true);
    expect(st.strokeAlpha).toBeGreaterThan(0);
    expect(st.color).toBeGreaterThan(0);
  });
});
