/**
 * `scripts/catalystCapSweep.ts` 계약 테스트 — ADR-0052 §경제 결합 규율.
 *
 * ⚠️ 17,296 건 전수는 여기서 돌리지 않는다(`pnpm cap:sweep` 이 스크립트로 돈다). 이 파일은
 * ①필터 규칙 ②공명 반영 여부 ③산식 불변식 ④전수 스윕이 낸 최악 조합의 **재현**만 대표
 * 조합으로 잠근다. 리터럴 상한값은 **전수 스윕의 실제 출력**을 정본으로 삼는다(설계 문서의
 * 손 계산 ×3.25/×3.9 는 신뢰 근거가 아니라고 문서 스스로 적었다).
 *
 * 스윕 실행 결과(2026-08-08, 본 워크트리):
 *   drop x3.0000 · resource x3.2000 · rarity x3.4000 · xp x3.3500 · catalystDrop x1.5000
 *   전축 상한 x4.0800 (조합 #5 refinement + #6 gilding + #44 toxar-blight-mother, gamble:strong 공명)
 */

import { describe, expect, it } from 'vitest';
import {
  CAP_ALL_AXIS_FACTOR,
  CAP_COMPOSE_FACTOR,
  CATALYSTS,
  catalystById,
} from '../src/data/catalysts.js';
import { axisTotal, allAxisTotal, buildCombo, isValidCombo } from '../scripts/catalystCapSweep.js';

describe('catalystCapSweep — 유효 조합 필터', () => {
  it('특산 3장(같은 행성이라도)은 무효다 — SIGNATURE_CAP 초과', () => {
    // 카르곤 특산 3종(id 30~32) 전부 planet 0.
    const defs = [30, 31, 32].map((id) => catalystById(id)!) as [
      (typeof CATALYSTS)[number],
      (typeof CATALYSTS)[number],
      (typeof CATALYSTS)[number],
    ];
    expect(isValidCombo(defs)).toBe(false);
  });

  it('특산 2장 + 다른 행성이면 무효다 — 런은 한 행성에서 벌어진다', () => {
    // id 30 (카르곤, planet 0) + id 33 (베르단, planet 1) + 공용 하나.
    const defs = [30, 33, 0].map((id) => catalystById(id)!) as [
      (typeof CATALYSTS)[number],
      (typeof CATALYSTS)[number],
      (typeof CATALYSTS)[number],
    ];
    expect(isValidCombo(defs)).toBe(false);
  });

  it('특산 2장 + 같은 행성이면 유효하다', () => {
    // id 30, 31 모두 카르곤(planet 0) + 공용 하나.
    const defs = [30, 31, 0].map((id) => catalystById(id)!) as [
      (typeof CATALYSTS)[number],
      (typeof CATALYSTS)[number],
      (typeof CATALYSTS)[number],
    ];
    expect(isValidCombo(defs)).toBe(true);
  });

  it('공용 3장(특산 0장)은 항상 유효하다', () => {
    const defs = [0, 1, 2].map((id) => catalystById(id)!) as [
      (typeof CATALYSTS)[number],
      (typeof CATALYSTS)[number],
      (typeof CATALYSTS)[number],
    ];
    expect(isValidCombo(defs)).toBe(true);
  });
});

describe('catalystCapSweep — 산식 불변식', () => {
  it('축별 총상한 = 1 + Σ(개별상한 − 1) × CAP_COMPOSE_FACTOR (공명 미발동 조합)', () => {
    // id 11(gamble, xp 1.8), 13(precision, xp 2.6), 20(ignite+density, drop 2.0)
    // — 네 태그가 전부 1장씩이라 약공명 임계(2장)를 못 넘겨 공명이 안 뜬다.
    const combo = buildCombo([11, 13, 20]);
    expect(combo.resonance).toBeNull();
    const expectedXp = 1 + ((1.8 - 1) + (2.6 - 1)) * CAP_COMPOSE_FACTOR;
    expect(axisTotal(combo, 'xp')).toBeCloseTo(expectedXp, 10);
    expect(axisTotal(combo, 'drop')).toBeCloseTo(1 + (2.0 - 1) * CAP_COMPOSE_FACTOR, 10);
    // 무관 축은 중립원 1.
    expect(axisTotal(combo, 'resource')).toBe(1);
  });

  it('공명 상한은 자기 축의 합에 든다', () => {
    // id 5, 6, 44 — 전부 gamble 태그 3장이라 gamble:strong(settlement, rarity axis 2.0) 발동.
    const combo = buildCombo([5, 6, 44]);
    expect(combo.resonance?.slug).toBe('settlement');
    expect(combo.resonance?.cap.axis).toBe('rarity');
    const catalystSum = (2.0 - 1) + (2.2 - 1) + (2.6 - 1); // refinement, gilding, toxar-blight-mother
    const resonanceSum = combo.resonance!.cap.mult - 1;
    const expectedRarity = 1 + (catalystSum + resonanceSum) * CAP_COMPOSE_FACTOR;
    expect(axisTotal(combo, 'rarity')).toBeCloseTo(expectedRarity, 10);
  });

  it('전축 상한 = max(축별 총상한) × CAP_ALL_AXIS_FACTOR', () => {
    const combo = buildCombo([5, 6, 44]);
    const rarity = axisTotal(combo, 'rarity');
    expect(allAxisTotal(combo)).toBeCloseTo(rarity * CAP_ALL_AXIS_FACTOR, 10);
  });
});

describe('catalystCapSweep — 전수 스윕 최악 조합 재현 (리터럴 잠금)', () => {
  // 아래 리터럴은 `pnpm cap:sweep` 실행 결과를 그대로 옮긴 것이다 — 손 계산이 아니다.
  it('drop 축 최댓값 x3.0000 (id 15+20+42, harvest:weak 공명)', () => {
    const combo = buildCombo([15, 20, 42]);
    expect(isValidCombo(combo.defs)).toBe(true);
    expect(axisTotal(combo, 'drop')).toBeCloseTo(3.0, 10);
  });

  it('resource 축 최댓값 x3.2000 (id 17+19+34, harvest:weak 공명 — resource 축엔 기여 없음)', () => {
    const combo = buildCombo([17, 19, 34]);
    expect(isValidCombo(combo.defs)).toBe(true);
    expect(axisTotal(combo, 'resource')).toBeCloseTo(3.2, 10);
  });

  it('rarity 축 최댓값 x3.4000 (id 5+6+44, gamble:strong 공명)', () => {
    const combo = buildCombo([5, 6, 44]);
    expect(isValidCombo(combo.defs)).toBe(true);
    expect(axisTotal(combo, 'rarity')).toBeCloseTo(3.4, 10);
  });

  it('xp 축 최댓값 x3.3500 (id 10+13+24, precision:weak 공명)', () => {
    const combo = buildCombo([10, 13, 24]);
    expect(isValidCombo(combo.defs)).toBe(true);
    expect(axisTotal(combo, 'xp')).toBeCloseTo(3.35, 10);
  });

  it('catalystDrop 축 최댓값 x1.5000 (id 0+21+33, harvest:strong 공명)', () => {
    const combo = buildCombo([0, 21, 33]);
    expect(isValidCombo(combo.defs)).toBe(true);
    expect(axisTotal(combo, 'catalystDrop')).toBeCloseTo(1.5, 10);
  });

  it('전축 상한 최댓값 x4.0800 (id 5+6+44)', () => {
    const combo = buildCombo([5, 6, 44]);
    expect(allAxisTotal(combo)).toBeCloseTo(4.08, 10);
  });
});
