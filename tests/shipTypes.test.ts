/**
 * M8-L1 — 기체 타입 레지스트리 스키마 게이트 (ADR-0049 flat 재편 반영).
 *
 * ## 무엇을 막는가
 * 1. **`SHIP_TYPES` 인덱스 ≠ `id`** — 배열에 타입을 끼워 넣거나 재정렬하면 세이브의 `Ship.typeId`
 *    가 다른 기체를 가리키고 리플레이가 다른 트리로 재실행된다. wire 계약이다.
 * 2. **시그니처 비트 충돌·범위 이탈** — [18,30] 밖은 유니크/캡스톤 잔여 비트 또는 부호 반전
 *    (`1<<31`)과 충돌한다. 두 타입이 같은 비트를 쓰면 한쪽 패시브가 다른 쪽 런에서 켜진다.
 * 3. **스트라이커 wire 계약 붕괴** — baseBp 전 축 0·시그니처 없음이 무너지면 "리팩터 기간 중
 *    회귀 탐지기"(설계서 §11)가 사라진다. ADR-0049 이후로는 **노드 개수 63 고정**이 아니라
 *    **flat 30칸(축당 10) 균일**이 그 계약이다 — 스트라이커도 신규 레이아웃을 탄다
 *    (`data/ships/striker.ts` 헤더: "구 버전은 `data/skills.ts` 63노드 리터럴을 조립만 했다 …
 *    ADR-0049 가 노드 자체를 통째로 교체하면서 그 규율이 폐기됐다").
 *
 * flat 레이아웃 구조 계약(210종·id 유니크·축 정합·code 번호·affinity 매핑)은
 * `tests/shipSkillLayout.test.ts` 가 지키므로 여기서 되풀이하지 않는다. 이 파일은 **레지스트리
 * 자체의 wire 계약**(인덱스·시그니처 비트·selectableShipTypes)과 **정규 경로 통합**만 본다.
 *
 * 마지막 describe 는 **정규 경로 통합**이다(설계서 §10 "단위 테스트는 그린인데 배선이 없다").
 */

import { describe, it, expect } from 'vitest';
import { buildRunConfig } from '../src/run/runConfig.js';
import {
  SHIP_TYPES,
  STRIKER,
  DEFAULT_SHIP_TYPE,
  NO_SIGNATURE_BIT,
  SIGNATURE_BIT_MIN,
  SIGNATURE_BIT_MAX,
  TREES_PER_SHIP,
  SKILLS_PER_AXIS,
  ACTIVE_HI_GATE_DEFAULT,
  flattenShipNodes,
  shipNodeCount,
  shipTypeDef,
  shipSkillNodeCount,
  zeroSkillInvest,
  normalizeShipTypeId,
  selectableShipTypes,
} from '../data/ships/index.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import type { WorldConfig, InputFrame } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import type { Profile } from '../src/save/profile.js';

describe('① SHIP_TYPES 인덱스 계약 (wire)', () => {
  it('배열 인덱스 === def.id', () => {
    SHIP_TYPES.forEach((def, i) => {
      expect(def.id, `SHIP_TYPES[${i}].id`).toBe(i);
    });
  });

  it('slug 가 전부 유일하고 소문자 kebab 이다 (아트·i18n 키의 축)', () => {
    const slugs = SHIP_TYPES.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('타입 0 은 스트라이커이며 DEFAULT_SHIP_TYPE 과 같다', () => {
    expect(DEFAULT_SHIP_TYPE).toBe(0);
    expect(SHIP_TYPES[0]).toBe(STRIKER);
    expect(STRIKER.slug).toBe('striker');
  });

  it('모든 타입이 3계열이고 트리 slug 가 타입 안에서 유일하다', () => {
    for (const def of SHIP_TYPES) {
      expect(def.trees.length, def.slug).toBe(TREES_PER_SHIP);
      const slugs = def.trees.map((t) => t.slug);
      expect(new Set(slugs).size, def.slug).toBe(slugs.length);
    }
  });

  it('normalizeShipTypeId 가 손상 값을 기본 타입으로 되돌린다 (조용한 중립 loadout 방지)', () => {
    for (const bad of [-1, SHIP_TYPES.length, 999, NaN, Infinity, 'x', null, undefined, {}]) {
      expect(normalizeShipTypeId(bad)).toBe(DEFAULT_SHIP_TYPE);
    }
    expect(normalizeShipTypeId(2)).toBe(2);
    expect(normalizeShipTypeId(2.7)).toBe(2);
    expect(shipTypeDef(999)).toBe(STRIKER);
  });

  it('selectableShipTypes 가 전량을 반환한다 — 해금 게이트 없음 (ADR-0019 명시 선택)', () => {
    // 선의로 레벨/진행도 조건을 붙이는 것을 막는 유일한 수단이다.
    expect(selectableShipTypes()).toEqual(SHIP_TYPES);
    expect(selectableShipTypes().length).toBe(SHIP_TYPES.length);
  });
});

describe('② 시그니처 비트', () => {
  it('타입 0(스트라이커)은 시그니처가 없다 (-1)', () => {
    expect(STRIKER.signatureBit).toBe(NO_SIGNATURE_BIT);
    expect(NO_SIGNATURE_BIT).toBeLessThan(0);
  });

  it('타입 1..N 은 [18,30] 범위의 정수 비트를 갖는다', () => {
    for (const def of SHIP_TYPES.slice(1)) {
      expect(Number.isInteger(def.signatureBit), def.slug).toBe(true);
      expect(def.signatureBit, def.slug).toBeGreaterThanOrEqual(SIGNATURE_BIT_MIN);
      expect(def.signatureBit, def.slug).toBeLessThanOrEqual(SIGNATURE_BIT_MAX);
    }
  });

  it('비트가 타입 간 유일하다 (겹치면 남의 패시브가 켜진다)', () => {
    const bits = SHIP_TYPES.filter((d) => d.signatureBit >= 0).map((d) => d.signatureBit);
    expect(new Set(bits).size).toBe(bits.length);
  });

  it('설계서 §4 배정 + 7종 확장과 일치한다 (18·19·20·21·22·23)', () => {
    // L2 의 src/sim/shipSignature.ts SIG_* 상수가 이 값과 같아야 한다(정본은 그쪽, 여기는 데이터).
    // bruiser 18 · arccaster 19 · phantom 20 · hatchling 21 · mallow 22 · bubble 23.
    expect(SHIP_TYPES.map((d) => d.signatureBit)).toEqual([-1, 18, 19, 20, 21, 22, 23]);
  });

  it('1 << bit 이 양수다 (마스크 연산 안전 — 31 비트 금지의 이유)', () => {
    for (const def of SHIP_TYPES) {
      if (def.signatureBit < 0) continue;
      expect(1 << def.signatureBit).toBeGreaterThan(0);
    }
  });
});

describe('③ 스트라이커 wire 계약 (ADR-0049 flat 재편 이후)', () => {
  it('baseBp 전 축이 0 이다 (적용부가 조기 반환 → 스탯 바이트 불변)', () => {
    expect(STRIKER.baseBp).toEqual({ damageBp: 0, fireRateBp: 0, maxHpBp: 0, moveSpeedBp: 0 });
    for (const v of Object.values(STRIKER.baseBp)) expect(v).toBe(0);
  });

  it('노드 수가 flat 30(축 3 × 축당 10)이다 — 기체 7종 전부 동일, 스트라이커도 예외 없음', () => {
    expect(shipNodeCount(STRIKER)).toBe(TREES_PER_SHIP * SKILLS_PER_AXIS);
    expect(shipNodeCount(STRIKER)).toBe(30);
    expect(shipSkillNodeCount(0)).toBe(30);
    expect(flattenShipNodes(STRIKER).length).toBe(30);
    expect(zeroSkillInvest(0).length).toBe(30);
  });

  it('activeHiGate 가 기본값(구 capstoneGate 승계)을 쓴다', () => {
    expect(STRIKER.activeHiGate).toBe(ACTIVE_HI_GATE_DEFAULT);
    expect(STRIKER.activeHiGate).toBe(40);
  });

  it('트리마다 정확히 축당 10개 노드다(캡스톤 칸 없음)', () => {
    for (const t of STRIKER.trees) {
      expect(t.nodes.length, t.slug).toBe(SKILLS_PER_AXIS);
    }
  });
});

describe('④ 전 타입(신규 6종 포함) 최소 유효성 — flat 계약 (구조는 shipSkillLayout.test.ts 담당)', () => {
  it('전 타입의 flat 벡터 길이가 30 이고 zeroSkillInvest 와 일치한다', () => {
    for (const def of SHIP_TYPES) {
      expect(shipNodeCount(def), def.slug).toBe(30);
      expect(flattenShipNodes(def).length, def.slug).toBe(30);
      expect(zeroSkillInvest(def.id).length, def.slug).toBe(30);
      expect(zeroSkillInvest(def.id).every((v) => v === 0), def.slug).toBe(true);
    }
  });

  it('zeroSkillInvest 가 매번 새 배열을 준다 (한 기체 투자가 다른 기체로 새지 않음)', () => {
    const a = zeroSkillInvest(1);
    const b = zeroSkillInvest(1);
    expect(a).not.toBe(b);
    a[0] = 5;
    expect(b[0]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 정규 경로 통합 — 설계서 §10.
//
// 위 케이스는 전부 레지스트리를 직접 호출한다. 그것만으로는 **앱이 이 레지스트리를 실제로
// 타는지** 알 수 없다("단위 테스트 그린인데 배선이 통째로 없다" 8회 재발 유형). 아래는
// Profile 에서 출발해 src/main.ts 의 PvE 런 시작과 같은 함수·같은 순서로 config 를 조립하고
// createWorld/stepWorld 를 실제로 굴린다.
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

describe('정규 경로 통합 — Profile → 런 설정 → createWorld/stepWorld', () => {
  it('기본 Profile 의 활성 기체가 타입 0 이고 벡터 길이가 레지스트리와 일치한다', () => {
    const ship = activeShip(defaultProfile());
    expect(ship.typeId).toBe(DEFAULT_SHIP_TYPE);
    expect(ship.skillInvest.length).toBe(shipSkillNodeCount(ship.typeId));
    expect(ship.skillInvest).toEqual(zeroSkillInvest(ship.typeId));
  });

  it('앱 경로가 만든 WorldConfig.skillInvest 가 레지스트리 벡터와 같고 sim 이 실제로 돈다', () => {
    const config = assembleRunConfigLikeMain(defaultProfile(), 0, 1);
    expect(config.skillInvest).toEqual(zeroSkillInvest(0));
    expect(config.skillInvest?.length).toBe(30);
    // 스트라이커는 시그니처가 없으므로 무투자 런의 uniqueMask 는 0 이어야 한다.
    expect(config.loadout?.uniqueMask).toBe(0);

    const hashes = runTicks(12345, config, 120);
    expect(hashes.length).toBe(120);
    // 월드가 정지해 있으면(전부 같은 해시) 이 테스트는 아무것도 증명하지 못한다.
    expect(new Set(hashes).size).toBeGreaterThan(60);
  });

  it('같은 Profile 은 같은 해시 스트림을 낸다 (결정론 — ADR-0005)', () => {
    const a = runTicks(777, assembleRunConfigLikeMain(defaultProfile(), 1, 1), 60);
    const b = runTicks(777, assembleRunConfigLikeMain(defaultProfile(), 1, 1), 60);
    expect(a).toEqual(b);
  });

  it('shipType 미지정 config 가 shipType:0 과 완전히 같다 (optional 계약)', () => {
    // ⚠️ 앱 경로(`buildRunConfig`)는 스트라이커도 `shipType: 0` 을 **명시**한다(EF 가 추론이
    // 아니라 명시로 읽게 하려고 — 설계서 §4). 따라서 여기서 검증할 계약은 "앱이 필드를 비운다"
    // 가 아니라 **"미지정과 0 이 관측상 완전히 동일하다"** 이다.
    const config = assembleRunConfigLikeMain(defaultProfile(), 0, 1);
    expect(config.shipType).toBe(0);
    const { shipType: _omitted, ...withoutField } = config;
    expect('shipType' in withoutField).toBe(false);
    expect(() => createWorld(1, withoutField)).not.toThrow();
    expect(runTicks(1, withoutField, 120)).toEqual(runTicks(1, config, 120));
  });
});
