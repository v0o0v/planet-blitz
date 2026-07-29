/**
 * 카르곤 조명 방향 일치 가드 — 레인 간 광원 합의가 조용히 갈라지는 것을 막는다.
 *
 * ## 왜 이 테스트가 있는가
 * 카르곤 배경의 방향성 라이팅은 **두 레인이 각각** 구현한다:
 *  - `kargonLavaLight` — 지형 경계의 AO 띠·림·드롭 섀도
 *  - `kargonDecals`    — 암부 부조(암괴·능선·재 무더기)의 하이라이트·그림자
 *
 * 둘은 서로를 import 하지 않는다(동급 레이어끼리 결합을 만들지 않기 위해서다). 대신 각자
 * "광원은 아래의 용암"이라는 **같은 물리 전제**에서 출발했다. 문제는 그 전제가 코드에서는
 * 서로 다른 상수로 표현돼 있다는 것이다 — 한쪽을 고치고 다른 쪽을 잊으면 화면에 **광원이 둘**이
 * 생긴다. 그리고 그건 각 레인의 단위 테스트를 전부 통과한다(각자 자기 상수와만 일관하므로).
 *
 * 이 레인에서 같은 함정을 이미 두 번 밟았다:
 *  - `UPPER_THRESHOLD` 복제본이 0.5 / 0.57 로 갈라져 발광이 **지형이 그리지 않는 등고선**에 붙었다.
 *  - 적탄 색 팔레트 복제본이 `textures.ts` 와 갈라질 뻔했다(통합 시 import 로 합쳤다).
 *
 * 셋째 사례를 만들지 않기 위해, 값을 강제로 통일하는 대신 **합의만 검사**한다. 두 레인이 기울기를
 * 다르게 가져갈 자유는 남기되(각자 이유가 있다 — 데칼은 축 정렬 하이라이트가 도장처럼 찍히는 것을
 * 피하려고 18° 기울였다), 방향이 근본적으로 갈라지면 실패한다.
 */

import { describe, it, expect } from 'vitest';
import { TO_LIGHT_Y } from '../src/render/env/kargonLavaLight.js';
import { LIGHT_X, LIGHT_Y } from '../src/render/env/kargonDecals.js';

/** 두 레인의 광원 벡터가 이 코사인 유사도 이상으로 같은 방향을 가리켜야 한다. */
const MIN_AGREEMENT = 0.9;

describe('카르곤 조명 방향 합의', () => {
  it('두 레인 모두 광원이 화면 아래(용암 쪽)에 있다고 본다', () => {
    // 화면 좌표는 y 가 아래로 자란다. 표면 → 광원 벡터의 y 가 양수 = 광원이 아래.
    expect(TO_LIGHT_Y).toBeGreaterThan(0);
    expect(LIGHT_Y).toBeGreaterThan(0);
  });

  it('두 레인의 광원 벡터가 같은 방향이다(코사인 유사도)', () => {
    // 용암 레인은 순수 수직(x 성분 없음), 데칼 레인은 약간 기울어 있다. 둘 다 단위 벡터로
    // 정규화한 뒤 내적을 본다 — 기울기 차이는 허용하고 방향 역전·직교화만 잡는다.
    const lavaX = 0;
    const lavaY = TO_LIGHT_Y;
    const lavaLen = Math.hypot(lavaX, lavaY);
    const decalLen = Math.hypot(LIGHT_X, LIGHT_Y);
    expect(lavaLen).toBeGreaterThan(0);
    expect(decalLen).toBeGreaterThan(0);
    const dot = (lavaX * LIGHT_X + lavaY * LIGHT_Y) / (lavaLen * decalLen);
    expect(dot).toBeGreaterThan(MIN_AGREEMENT);
  });

  it('합의 검사가 항진이 아니다 — 뒤집힌 벡터는 떨어뜨린다', () => {
    // 이 테스트가 실제로 무언가를 검사한다는 증명. 데칼 광원을 상하 반전시키면 유사도가
    // 임계 아래로 떨어져야 한다(그렇지 않다면 위 단언은 아무것도 막지 못한다).
    const flippedY = -LIGHT_Y;
    const dot =
      (0 * LIGHT_X + TO_LIGHT_Y * flippedY) / (Math.abs(TO_LIGHT_Y) * Math.hypot(LIGHT_X, flippedY));
    expect(dot).toBeLessThan(MIN_AGREEMENT);
  });
});
