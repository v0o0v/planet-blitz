/**
 * 시그니처 비트 **교차 계약** — `src/sim/shipSignature.ts`(sim 정본 상수) ↔
 * `data/ships/*.ts`(레지스트리 `signatureBit` 필드) (M8 통합 게이트, 설계서 §4·§10-1).
 *
 * ## 왜 별도 파일인가
 * 같은 wire 값이 **두 곳에 리터럴로** 적혀 있다. L2 는 `SIG_* = 18..23` 을, L1 은
 * `SHIP_TYPES[i].signatureBit = 18..23` 을 각자 선언했고, 두 레인의 테스트는 각자
 * 자기 쪽 숫자만 고정한다 — **양쪽이 갈려도 둘 다 그린이다.**
 *
 * 갈렸을 때의 증상이 이 프로젝트의 반복 결함 그 자체다: W2-L4 의 OR-in 은 `SIG_*` 를 읽고
 * (설계서 §4), 화면·콘텐츠는 레지스트리를 읽는다. 두 값이 어긋나면 패시브가 **영구 미발동**
 * 하거나 **다른 기체의 패시브가 켜지는데**, 예외도 타입 오류도 나지 않는다. 단위 테스트로는
 * 원리적으로 잡히지 않으므로 두 정본을 마주 세우는 테스트가 반드시 하나 있어야 한다.
 *
 * L1·L2 가 각각 "통합 게이트로 넘김" 항목으로 명시적으로 넘긴 건이다.
 */

import { describe, it, expect } from 'vitest';
import {
  SIG_BRUISER_ARMOR,
  SIG_ARC_OVERCHARGE,
  SIG_PHANTOM_CLOAK,
  SIG_HATCHLING_BROOD,
  SIG_MALLOW_CUSHION,
  SIG_BUBBLE_FILM,
  SIG_STRIKER_MARKSMAN,
  SIGNATURE_BITS,
  SIGNATURE_BIT_MAX as SIM_SIGNATURE_BIT_MAX,
  hasSignature,
} from '../src/sim/shipSignature.js';
import { SHIP_TYPES, SIGNATURE_BIT_MIN, SIGNATURE_BIT_MAX } from '../data/ships/index.js';

/**
 * sim 상수 배열의 순서 계약: 인덱스 i ↔ typeId i(ADR-0049 §1 — 스트라이커도 이제 시그니처를
 * 갖는다. 구 계약은 "스트라이커는 시그니처 없음" 이라 typeId 1~6 만 적었다).
 */
const EXPECTED_BY_TYPE_ID: readonly (readonly [number, number])[] = [
  [0, SIG_STRIKER_MARKSMAN],
  [1, SIG_BRUISER_ARMOR],
  [2, SIG_ARC_OVERCHARGE],
  [3, SIG_PHANTOM_CLOAK],
  [4, SIG_HATCHLING_BROOD],
  [5, SIG_MALLOW_CUSHION],
  [6, SIG_BUBBLE_FILM],
];

describe('시그니처 비트 교차 계약 (sim 상수 ↔ 기체 레지스트리)', () => {
  it('레지스트리의 signatureBit 이 sim 정본 상수와 타입별로 정확히 일치한다', () => {
    for (const [typeId, bit] of EXPECTED_BY_TYPE_ID) {
      const def = SHIP_TYPES[typeId];
      expect(def, `SHIP_TYPES[${typeId}] 가 없다`).toBeDefined();
      expect(
        def?.signatureBit,
        `${def?.slug ?? typeId}: 레지스트리 ${String(def?.signatureBit)} ≠ sim 정본 ${bit}. ` +
          '두 값이 갈리면 패시브가 조용히 미발동하거나 엉뚱한 타입에 붙는다.',
      ).toBe(bit);
    }
  });

  it('전 타입(0~6)이 시그니처를 갖는다 — 계약 반전(ADR-0049 §1, 구 §11 채택안 A 폐기)', () => {
    // 스트라이커도 이제 자기 시그니처(비트 24, 정조준 사이클)를 갖는다 — "시그니처 없는
    // 기체" 라는 개념 자체가 사라졌다. NO_SIGNATURE_BIT(-1) 은 방어적 폴백값으로만 남는다.
    expect(SHIP_TYPES[0]?.signatureBit).toBe(SIG_STRIKER_MARKSMAN);
    for (const def of SHIP_TYPES) {
      expect(def.signatureBit, `${def.slug}: 전 타입이 시그니처를 가져야 한다`).toBeGreaterThanOrEqual(
        SIGNATURE_BIT_MIN,
      );
    }
  });

  it('sim 의 SIGNATURE_BITS 가 레지스트리의 비트 전량과 같은 집합이다(순서는 오름차순이 정본)', () => {
    // ⚠️ 순서 계약 반전: 스트라이커(타입 id 0)가 최상위 비트 24 를 받으면서, 레지스트리
    // 순서(타입 id 0→6 = [24,18,19,20,21,22,23])와 SIGNATURE_BITS 선언 순서(오름차순
    // [18,19,20,21,22,23,24])가 더는 같지 않다 — "최저 비트 승자" 계약(shipSignature.ts
    // SIGNATURE_BITS 주석, computeActiveSignature)이 성립하려면 후자가 항상 오름차순이어야
    // 하므로, 여기서는 **집합만** 대조하고 오름차순 여부는 별도로 못 박는다.
    const fromRegistry = SHIP_TYPES.filter((d) => d.signatureBit >= 0).map((d) => d.signatureBit);
    expect([...fromRegistry].sort((a, b) => a - b)).toEqual([...SIGNATURE_BITS].sort((a, b) => a - b));
    for (let i = 1; i < SIGNATURE_BITS.length; i++) {
      expect(
        SIGNATURE_BITS[i],
        'SIGNATURE_BITS 는 오름차순이어야 한다 — computeActiveSignature 의 "최저 비트 승자" 계약',
      ).toBeGreaterThan(SIGNATURE_BITS[i - 1]!);
    }
  });

  it('비트가 타입 간 유일하다 — 두 기체가 같은 비트를 쓰면 서로의 패시브가 켜진다', () => {
    const bits = SHIP_TYPES.map((d) => d.signatureBit).filter((b) => b >= 0);
    expect(new Set(bits).size).toBe(bits.length);
  });

  it('두 모듈의 상한 상수가 같고, 전 비트가 [MIN, MAX] 안이며 1<<bit 이 양수다', () => {
    // 31 은 `1 << 31` 이 음수라 마스크 연산이 취약해진다 — 양쪽 모듈이 같은 상한을 알아야 한다.
    expect(SIM_SIGNATURE_BIT_MAX).toBe(SIGNATURE_BIT_MAX);
    for (const def of SHIP_TYPES) {
      if (def.signatureBit < 0) continue;
      expect(def.signatureBit).toBeGreaterThanOrEqual(SIGNATURE_BIT_MIN);
      expect(def.signatureBit).toBeLessThanOrEqual(SIGNATURE_BIT_MAX);
      expect(1 << def.signatureBit).toBeGreaterThan(0);
    }
  });

  it('레지스트리 비트로 만든 마스크를 sim 의 hasSignature 가 그대로 읽는다(양방향 왕복)', () => {
    for (const def of SHIP_TYPES) {
      if (def.signatureBit < 0) {
        // 스트라이커: 어떤 시그니처도 켜지지 않는다.
        for (const bit of SIGNATURE_BITS) expect(hasSignature(0, bit)).toBe(false);
        continue;
      }
      const mask = 1 << def.signatureBit;
      expect(hasSignature(mask, def.signatureBit)).toBe(true);
      // 다른 타입의 비트는 켜지지 않아야 한다(비트 겹침 시 여기서 터진다).
      for (const other of SHIP_TYPES) {
        if (other.signatureBit < 0 || other.signatureBit === def.signatureBit) continue;
        expect(
          hasSignature(mask, other.signatureBit),
          `${def.slug} 의 마스크가 ${other.slug} 의 시그니처까지 켠다`,
        ).toBe(false);
      }
    }
  });
});
