/**
 * M8-L6 → ADR-0049 — 신규 기체 6종 트리 **콘텐츠** 게이트 (로스터 7종).
 *
 * `tests/shipTypes.test.ts` 가 레지스트리의 *wire 계약*(인덱스·시그니처 비트)을, 그리고
 * `tests/shipSkillLayout.test.ts` 가 flat 레이아웃의 *구조 계약*(210종·id 유니크·축 정합·code
 * 번호)을 지킨다면, 이 파일은 그 위에 얹힌 두 축만 본다.
 *
 * ## ADR-0049 이후 사라진 축 — 되살리지 않는다
 * 구 버전은 여기서 **캡스톤 게이트 정합·perPoint 단위 규약·StatKey 파생 금지·만렙 투자
 * 프로파일의 스탯 분포 차별화**를 검사했다. `ShipSkillDef` 가 `stat`/`perPoint`/`tier`/
 * `capstone` 필드를 전부 잃으면서(스킬이 스탯에서 메커닉으로 옮겨갔다 — `src/items/skills.ts`
 * 헤더) 그 축들이 검사할 대상 자체가 사라졌다. 항상 통과하는 껍데기로 남기지 않고 지운다.
 *
 * ## 지금 남은 축
 * 1. **`ShipBaseBp` 차별화** — 스킬 트리가 스탯을 안 주는 지금, 기체별 수치 차이의 유일한
 *    출처는 `baseBp`(섀시 기본 보정)다. 신규 6종이 스트라이커(전 축 0) 대비 실제로 다른
 *    섀시를 갖는지, 서로 겹치지 않는지를 여기서 본다.
 * 2. **표시 문자열** — 컬러 이모지 금지(Pixi 두부 방지) · i18n 키 형태 유출 금지(연구소가
 *    `node.name` 을 `t()` 없이 그린다) · 기체 안 이름 유일성.
 *
 * 마지막 describe 는 **정규 경로 통합**이다(설계서 §10). 레지스트리를 직접 부르지 않고
 * `retireActiveShip`(앱이 기체를 바꾸는 유일한 경로) → `Profile` → 런 설정 조립 →
 * `createWorld`/`stepWorld` 를 실제로 굴린다.
 */

import { describe, it, expect } from 'vitest';
import { buildRunConfig } from '../src/run/runConfig.js';
import { SHIP_TYPES, STRIKER, shipTypeDef, flattenShipNodes } from '../data/ships/index.js';
import type { ShipTypeDef, ShipBaseBp } from '../data/ships/index.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import type { WorldConfig, InputFrame } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import type { Profile } from '../src/save/profile.js';
import { retireAtCap } from './support/retireAtCap.js';

/** 타입 1~6 (스트라이커는 §wire 계약을 shipTypes.test.ts 가 지킨다 — 여기서는 신규분만 본다). */
const NEW_TYPES: readonly ShipTypeDef[] = SHIP_TYPES.slice(1);

function bpKey(bp: ShipBaseBp): string {
  return `${bp.damageBp},${bp.fireRateBp},${bp.maxHpBp},${bp.moveSpeedBp}`;
}

describe('① ShipBaseBp 차별화 — 스킬 트리가 스탯을 안 주는 지금 유일한 수치 축', () => {
  it('신규 6종은 스트라이커(전 축 0)와 최소 한 축이 다르다', () => {
    const zero = bpKey(STRIKER.baseBp);
    for (const def of NEW_TYPES) {
      expect(bpKey(def.baseBp), def.slug).not.toBe(zero);
    }
  });

  it('7종의 baseBp 4-튜플이 서로 겹치지 않는다 (섀시가 실제로 갈린다)', () => {
    const keys = SHIP_TYPES.map((d) => bpKey(d.baseBp));
    expect(new Set(keys).size).toBe(SHIP_TYPES.length);
  });

  it('전 타입 baseBp 4축이 유한 정수다(손상 데이터 방어)', () => {
    for (const def of SHIP_TYPES) {
      for (const [k, v] of Object.entries(def.baseBp)) {
        expect(Number.isInteger(v), `${def.slug}.${k}`).toBe(true);
      }
    }
  });
});

describe('② 표시 문자열', () => {
  const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}]/u;

  it('이름·설명이 비어 있지 않고 컬러 이모지가 0 이다 (Pixi 두부 방지)', () => {
    for (const def of SHIP_TYPES) {
      for (const n of flattenShipNodes(def)) {
        expect(n.name.trim().length, n.id).toBeGreaterThan(0);
        expect(n.desc.trim().length, n.id).toBeGreaterThan(0);
        expect(EMOJI.test(n.name), `${n.id} 이름 이모지`).toBe(false);
        expect(EMOJI.test(n.desc), `${n.id} 설명 이모지`).toBe(false);
      }
    }
  });

  it('i18n 키 형태가 남아 있지 않다 (연구소는 node.name 을 t() 없이 그린다)', () => {
    for (const def of SHIP_TYPES) {
      for (const n of flattenShipNodes(def)) {
        expect(n.name, `${n.id} 이름`).not.toMatch(/^[a-z][a-z0-9_.-]*\.[a-z]/i);
        expect(n.desc, `${n.id} 설명`).not.toMatch(/^ship\./);
      }
    }
  });

  it('노드 이름이 타입 안에서 유일하다 (연구소 목록에서 같은 이름이 둘 보이지 않게)', () => {
    for (const def of SHIP_TYPES) {
      const names = flattenShipNodes(def).map((n) => n.name);
      const dup = names.filter((v, i) => names.indexOf(v) !== i);
      expect(dup, `${def.slug} 중복 이름`).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// 정규 경로 통합 — 설계서 §10.
//
// 위 케이스는 전부 데이터를 직접 읽는다. 그것만으로는 **앱이 이 데이터를 타는지** 알 수 없다.
// 아래는 앱이 기체를 바꾸는 실제 경로(retireActiveShip)로 타입을 옮기고, src/main.ts 의 PvE
// 런 시작과 같은 함수·순서로 config 를 조립해 createWorld/stepWorld 를 굴린다.
// ---------------------------------------------------------------------------

function assembleRunConfigLikeMain(profile: Profile, planet: number, stage: number): WorldConfig {
  return { ...buildRunConfig(profile, { planet, stage }), playerHp: 100_000_000 };
}

function runTicks(seed: number, config: WorldConfig, ticks: number): number[] {
  const state = createWorld(seed, config);
  const frame: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };
  const hashes: number[] = [];
  for (let t = 0; t < ticks; t++) {
    stepWorld(state, frame);
    hashes.push(hashWorld(state));
  }
  return hashes;
}

/** 앱 경로로 `typeId` 기체를 활성으로 만든 프로필(퇴역 = 세대 교체). */
function profileWithType(typeId: number): Profile {
  const p = defaultProfile();
  if (typeId === 0) return p;
  retireAtCap(p, undefined, typeId);
  return p;
}

describe('정규 경로 통합 — 퇴역으로 기체 전환 → 런 설정 → sim', () => {
  it('퇴역이 지급한 기체의 벡터 길이가 그 타입의 트리 데이터와 일치한다(전 타입 30)', () => {
    for (const def of SHIP_TYPES) {
      const ship = activeShip(profileWithType(def.id));
      expect(ship.typeId, def.slug).toBe(def.id);
      expect(ship.skillInvest.length, def.slug).toBe(flattenShipNodes(def).length);
      expect(ship.skillInvest.length, def.slug).toBe(30);
      expect(ship.skillInvest.every((v) => v === 0), def.slug).toBe(true);
    }
  });

  it('앱 경로가 만든 WorldConfig.skillInvest 가 타입별 길이를 그대로 나른다', () => {
    for (const def of SHIP_TYPES) {
      const config = assembleRunConfigLikeMain(profileWithType(def.id), 0, 1);
      expect(config.skillInvest?.length, def.slug).toBe(30);
    }
  });

  it('신규 타입 런이 실제로 돌고 결정론적이다 (같은 seed → 같은 해시 스트림)', () => {
    for (const def of NEW_TYPES) {
      const cfg = (): WorldConfig => assembleRunConfigLikeMain(profileWithType(def.id), 0, 1);
      const a = runTicks(4242, cfg(), 120);
      const b = runTicks(4242, cfg(), 120);
      expect(a, def.slug).toEqual(b);
      expect(a.length, def.slug).toBe(120);
      // 월드가 멈춰 있으면(전부 같은 해시) 이 케이스는 아무것도 증명하지 못한다.
      expect(new Set(a).size, `${def.slug} 해시 다양성`).toBeGreaterThan(60);
    }
  });

  it('타입 0 런은 신규 데이터에 영향받지 않는다 (회귀 탐지기 보존)', () => {
    // 신규 타입 데이터를 채운 뒤에도 스트라이커 config 는 30 길이·uniqueMask 0 이어야 한다.
    const config = assembleRunConfigLikeMain(defaultProfile(), 0, 1);
    expect(config.skillInvest?.length).toBe(30);
    expect(config.skillInvest?.every((v) => v === 0)).toBe(true);
    expect(config.loadout?.uniqueMask).toBe(0);
    expect(shipTypeDef(0)).toBe(STRIKER);
  });
});
