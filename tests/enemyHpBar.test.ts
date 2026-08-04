/**
 * 적 머리 위 HP 바 — `src/render/entity/enemyHpBar.ts`.
 *
 * 테스트 환경은 `environment: 'node'`(GL 없음)라 실제 Pixi 렌더는 못 돌린다. 그래서 여기서
 * 잠그는 것은 **순수 함수 계약과 등록 배선** 둘이다:
 *  - 비율·구간·폭 산출이 경계에서 옳은가(0 HP 가 "가득 찬 바"로 보이면 거짓 정보다)
 *  - 세 kind 에 팩토리가 실제로 등록됐는가(등록 누락 = 완성된 모듈이 화면에 없음 — 이 리포가
 *    8번 밟은 결함이라 `entity/index.ts` import 와 함께 구조적으로 막는다)
 *  - **보스 계열은 등록되지 않는가**(HUD 전용 체력바와 이중 표시 방지)
 */

import { describe, it, expect } from 'vitest';

// 등록 부수효과를 일으키는 프로덕션 배선 지점을 그대로 통과시킨다.
import '../src/render/entity/index.js';
import { adornerFactoryCount } from '../src/render/entity/adorner.js';
import { HP_BAR_KINDS, hpBand, hpBandColor, hpBarWidth, hpRatio } from '../src/render/entity/enemyHpBar.js';

describe('hpRatio — 경계', () => {
  it('가득/절반/빈 값을 그대로 낸다', () => {
    expect(hpRatio(100, 100)).toBe(1);
    expect(hpRatio(50, 100)).toBe(0.5);
    expect(hpRatio(0, 100)).toBe(0);
  });

  it('과충전(hp > maxHp)은 1 로 잘린다 — 바가 테두리를 넘지 않는다', () => {
    expect(hpRatio(160, 100)).toBe(1);
  });

  it('maxHp 가 0·음수·비유한이면 0 이다 (1 을 주면 "가득 찬 바"라는 거짓 정보가 된다)', () => {
    expect(hpRatio(10, 0)).toBe(0);
    expect(hpRatio(10, -5)).toBe(0);
    expect(hpRatio(10, Number.NaN)).toBe(0);
  });

  it('음수 hp 도 0 이다', () => {
    expect(hpRatio(-3, 100)).toBe(0);
  });
});

describe('hpBand — 색 구간은 3단(연속 보간이면 매 프레임 다시 칠해야 한다)', () => {
  it('60% 초과 = 높음, 25~60% = 중간, 25% 이하 = 낮음', () => {
    expect(hpBand(1)).toBe(0);
    expect(hpBand(0.61)).toBe(0);
    expect(hpBand(0.6)).toBe(1); // 경계는 아래 구간에 속한다
    expect(hpBand(0.26)).toBe(1);
    expect(hpBand(0.25)).toBe(2);
    expect(hpBand(0.01)).toBe(2);
  });

  it('구간마다 색이 다르다', () => {
    const colors = new Set([hpBandColor(0), hpBandColor(1), hpBandColor(2)]);
    expect(colors.size).toBe(3);
  });
});

describe('hpBarWidth — 종에 상관없이 읽히는 폭', () => {
  it('작은 드론도 하한(26) 아래로 안 내려간다', () => {
    expect(hpBarWidth(8, 4)).toBe(26);
  });

  it('거대 실체도 상한(88) 위로 안 올라간다', () => {
    expect(hpBarWidth(400, 200)).toBe(88);
  });

  it('중간 크기는 스프라이트 폭을 그대로 쓴다', () => {
    expect(hpBarWidth(60, 30)).toBe(60);
  });

  it('텍스처 미로드(폭 0)면 반경으로 대체한다 — 0 폭 바는 없는 것과 같다', () => {
    expect(hpBarWidth(0, 20)).toBe(40);
    expect(hpBarWidth(0, 0)).toBe(26); // 반경도 0 이면 하한
  });
});

describe('등록 배선', () => {
  it('일반 적 계열 세 kind 에 팩토리가 붙어 있다', () => {
    expect(HP_BAR_KINDS).toEqual(['enemy', 'formationDrone', 'spawnedDrone']);
    for (const kind of HP_BAR_KINDS) {
      expect(adornerFactoryCount(kind), `${kind} 팩토리 수`).toBeGreaterThan(0);
    }
  });

  it('보스 계열에는 이 바가 붙지 않는다 — HUD 전용 체력바와 이중 표시가 된다', () => {
    expect(HP_BAR_KINDS).not.toContain('boss');
    expect(HP_BAR_KINDS).not.toContain('defenseBoss');
  });
});
