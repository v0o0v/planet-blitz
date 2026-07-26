/**
 * 메타 UI 연출 **배선** 통합 테스트 (Phase 5 — plan §AC-5.1 · AC-6.3; ADR-0031).
 *
 * ## 왜 이 형태인가
 * 이 프로젝트의 #1 반복 결함은 "순수함수 유닛은 그린인데 정규 경로에 배선이 통째로 없다"이다.
 * `ScreenTransition` 유닛(tests/screenTransition)이 통과해도 main.ts clearToMenu/렌더 루프가
 * 그것을 **실제로 호출하지 않으면** 게임엔 아무 전환도 안 뜬다. 그래서 ①실제 `ResultOverlayScreen`
 * 을 세워 정산이 show 즉시 온전히 서는지 관측하고, ②main.ts 의 배선 계약(clearToMenu play·렌더 루프
 * update·stage mount)을 소스 그렙으로 못박는다(entityRendererShipSwap 의 main.ts 계약 테스트 선례 —
 * 배선이 리팩터로 사라지면 빨개진다). main.ts 는 앱 부트스트랩이라 인스턴스화가 안 되므로 소스 그렙이
 * 정본 방어다.
 *
 * ⚠️ **보상 세리머니(AC-5.2)는 삭제됐다**(사용자 요청 2026-07-27). 그 자리에는 "부활 방지" 회귀
 * 가드가 들어간다 — 모듈 부재 · 내부 필드 부재 · 렌더 루프 구동 호출 부재.
 *
 * render-only(ADR-0005) — sim·hashWorld/hashEntity 무접촉. 메타 UI라 결정론과 무관하다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Container } from 'pixi.js';

import { ResultOverlayScreen } from '../src/ui/pixi/resultOverlay.js';
import type { ResultState } from '../src/ui/resultOverlay.js';
import type { Rarity } from '../src/items/types.js';

// resultOverlay.show/hide 는 `setDomHidden`(document.getElementById 로 DOM 오버레이 숨김)을 부른다.
// node 테스트 env 엔 document 가 없어 그 한 줄만 막히므로(render() 자체는 node 안전), getElementById 가
// null 을 돌려주는 최소 스텁으로 그 no-op 경로만 열어 준다(DOM 라이브러리 불필요). 세리머니 배선 검증엔
// 충분하고, 파일 격리(vitest per-file)라 다른 테스트에 새지 않는다.
const g = globalThis as unknown as { document?: { getElementById(id: string): null } };
if (typeof g.document === 'undefined') {
  g.document = { getElementById: () => null };
}

// ---------------------------------------------------------------------------
// 정산 상태 픽스처 — 주어진 등급 목록으로 드랍을 만든다(세리머니 트리거 소스).
// ---------------------------------------------------------------------------
function stateWithDrops(rarities: Rarity[]): ResultState {
  return {
    victory: true,
    seed: 1,
    xpTotal: 100,
    kills: 10,
    maxCombo: 5,
    resources: 50,
    level: 3,
    timeSec: 90,
    settlement: {
      itemsGained: rarities.length,
      levelsGained: 1,
      skillPointsGained: 0,
      creditsGained: 200,
      overflow: 0,
      combatPower: 42,
      drops: rarities.map((rarity) => ({ rarity, slot: 'main' as const, weaponType: 0 })),
    },
  };
}

/** private 되읽기 — 배선/삭제 결함은 실제 내부 상태를 봐야 드러난다. */
interface OverlayInternals {
  root: { children: readonly unknown[] };
  lootCeremony?: unknown;
}
function priv(o: ResultOverlayScreen): OverlayInternals {
  return o as unknown as OverlayInternals;
}

// ===========================================================================

describe('보상 세리머니 삭제 회귀 가드 (사용자 요청 2026-07-27)', () => {
  // 세리머니는 정산 진입 시 화면 중앙을 덮어 결과 패널을 가리고 페이드를 기다리게 만들었다.
  // 삭제 후 "정산은 show 즉시 온전히 보인다"가 계약이다 — 프레임 구동 없이 패널이 서야 한다.
  it('show 즉시 결과 패널이 서고, 화면을 덮는 세리머니 카드가 없다', () => {
    const overlay = new ResultOverlayScreen(new Container());
    overlay.show(stateWithDrops(['rare', 'unique']), () => {});
    expect(overlay.visible).toBe(true);
    // 암막 + 배너 + 패널 + 버튼 + tooltip → 자식이 여럿 서 있다(프레임 진행 0회로).
    expect(priv(overlay).root.children.length).toBeGreaterThan(3);
    // 세리머니 컨테이너·페이드 상태가 남아 있지 않다(부활 방지).
    expect(priv(overlay).lootCeremony).toBeUndefined();
    expect((overlay as unknown as { update?: unknown }).update).toBeUndefined();
    overlay.hide();
  });

  it('세리머니 모듈 자체가 리포에서 사라졌다', () => {
    // `existsSync` 는 이 프로젝트의 node 타입에 없다 — 읽기 실패로 부재를 판정한다.
    const modUrl = new URL('../src/render/effects/lootCeremony.ts', import.meta.url);
    const path = modUrl.pathname.replace(/^\/([A-Za-z]:)/, '$1');
    let exists = true;
    try {
      readFileSync(path);
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });
});

describe('AC-5.1/5.2 · main.ts 배선 계약 (소스 그렙 — 앱 부트스트랩 정본 방어)', () => {
  // readFileSync 1인자·바이트 반환 관용구 + Windows 드라이브 문자 보정(entityRendererShipSwap 선례).
  const url = new URL('../src/main.ts', import.meta.url);
  const src = new TextDecoder().decode(readFileSync(url.pathname.replace(/^\/([A-Za-z]:)/, '$1')));

  it('screenTransition.container 가 stage 에 mount 된다', () => {
    expect(src).toMatch(/stage\.addChild\(screenTransition\.container\)/);
  });

  it('clearToMenu() 가 screenTransition.play() 를 호출한다(전 화면 swap 균일 전환)', () => {
    // clearToMenu 함수 본문 안에 play() 호출이 있어야 한다(전환 프리미티브 단일 초크포인트, AC-5.1).
    expect(src).toMatch(/function clearToMenu\(\)[\s\S]{0,600}?screenTransition\.play\(\)/);
  });

  it('렌더 루프가 screenTransition.update 를 매 프레임 구동한다', () => {
    expect(src).toMatch(/screenTransition\.update\(/);
  });

  it('정산 세리머니 구동 호출이 렌더 루프에서 사라졌다(삭제 회귀 가드)', () => {
    expect(src).not.toMatch(/resultOverlay\.update\(/);
  });
});
