/**
 * 타이틀 3D 저사양 폴백 게이트 — 명시적 품질 오버라이드가 **부팅 시점에** 존중되는가.
 *
 * ## 이 테스트가 막는 결함 — 실제로 밟았다 (2026-08-02)
 *
 * 타이틀은 3D 함선을 띄울지 `effectGates(...).model3d` 로 정하는데, 처음 구현은 티어를
 * `graphicsTierController.getActiveTier()` 하나로만 읽었다. 그 컨트롤러는
 * `INITIAL_TIER = 'high'` 로 시작해 **렌더 루프가 `tick()` 을 돌려야** 갱신된다.
 *
 * 그런데 타이틀은 **부팅 화면**이다 — `show()` 가 루프보다 먼저 실행된다. 그래서 설정에
 * `quality: 'low'` 가 못 박혀 있어도 타이틀은 그 순간 'high' 를 읽고 WebGL 컨텍스트를 열어
 * 3D 를 올렸다. 저사양 폴백이 **가장 필요한 화면에서 통째로 무력화**돼 있었던 것이다.
 *
 * 화면 스크린샷으로 잡았다 — `quality: 'low'` 로 재부팅했는데 함선이 그대로 있었다. 단위
 * 테스트는 이 결함을 물을 수 없었다: 게이트 함수 자체는 멀쩡했고, 틀린 것은 **어떤 값을
 * 먹이느냐**였기 때문이다. 그래서 그 '먹이는 규칙'을 순수 함수로 떼어 여기서 잠근다.
 *
 * `selectTier` 도 오버라이드를 잠그므로 의미는 같다 — 다만 컨트롤러가 그 사실을 아는 시점보다
 * 타이틀이 먼저 알아야 한다는 것이 이 규칙의 전부다.
 */

import { describe, it, expect } from 'vitest';
import { resolveTitleTier } from '../src/ui/pixi/titleScreen.js';
import { effectGates } from '../src/render/qualityTier.js';
import { DEFAULT_GRAPHICS_SETTINGS } from '../src/render/graphicsSettings.js';

describe('타이틀 품질 티어 해석', () => {
  it("'auto' 면 자동 판정 티어를 그대로 쓴다", () => {
    expect(resolveTitleTier('auto', 'high')).toBe('high');
    expect(resolveTitleTier('auto', 'med')).toBe('med');
    expect(resolveTitleTier('auto', 'low')).toBe('low');
  });

  it('명시적 오버라이드는 자동 판정을 이긴다 — 컨트롤러가 아직 워밍업 중이어도', () => {
    // 부팅 직후의 실제 상황: 컨트롤러는 INITIAL_TIER='high', 사용자는 'low' 를 골라 두었다.
    expect(resolveTitleTier('low', 'high')).toBe('low');
    expect(resolveTitleTier('med', 'high')).toBe('med');
    // 반대 방향도 마찬가지 — 자동이 강등해 있어도 사용자가 high 를 못 박았으면 high 다.
    expect(resolveTitleTier('high', 'low')).toBe('high');
  });

  it("부팅 시점 'low' 오버라이드에서 3D 게이트가 실제로 닫힌다", () => {
    const settings = { ...DEFAULT_GRAPHICS_SETTINGS, quality: 'low' as const };
    const tier = resolveTitleTier(settings.quality, 'high'); // 'high' = 워밍업 중인 컨트롤러 값
    expect(effectGates(tier, settings).model3d).toBe(false);
  });

  it("'high' 오버라이드에서는 3D 게이트가 열린다 — 폴백이 과잉 차단하지 않는다", () => {
    const settings = { ...DEFAULT_GRAPHICS_SETTINGS, quality: 'high' as const };
    const tier = resolveTitleTier(settings.quality, 'low');
    expect(effectGates(tier, settings).model3d).toBe(true);
  });
});
