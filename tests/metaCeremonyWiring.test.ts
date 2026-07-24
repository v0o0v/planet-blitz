/**
 * 메타 UI 연출 **배선** 통합 테스트 (Phase 5 — plan §AC-5.1/5.2 · AC-6.3; ADR-0031).
 *
 * ## 왜 이 형태인가
 * 이 프로젝트의 #1 반복 결함은 "순수함수 유닛은 그린인데 정규 경로에 배선이 통째로 없다"이다.
 * ScreenTransition·LootCeremony 각각의 유닛(tests/screenTransition·lootCeremony)이 다 통과해도,
 * main.ts clearToMenu/렌더 루프·resultOverlay 가 그것들을 **실제로 호출하지 않으면** 게임엔 아무
 * 전환·세리머니도 안 뜬다. 그래서 여기서는 ①실제 `ResultOverlayScreen` 을 세워 정산 show→세리머니
 * 공개→페이드 흐름을 관측하고, ②main.ts 의 배선 계약(clearToMenu play·렌더 루프 update·stage mount)을
 * 소스 그렙으로 못박는다(entityRendererShipSwap 의 main.ts 계약 테스트 선례 — 배선이 리팩터로 사라지면
 * 빨개진다). main.ts 는 앱 부트스트랩이라 인스턴스화가 안 되므로 소스 그렙이 정본 방어다.
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

/** 세리머니 비공개 상태 관측(private 되읽기 — 배선 결함은 실제 내부 상태를 봐야 드러난다). */
interface OverlayInternals {
  lootCeremony: { revealing: boolean; container: { alpha: number } };
}
function priv(o: ResultOverlayScreen): OverlayInternals {
  return o as unknown as OverlayInternals;
}

// ===========================================================================

describe('AC-5.2 · 보상 세리머니 배선 (resultOverlay 통합)', () => {
  it('드랍이 있으면 정산 show 가 세리머니를 공개한다', () => {
    const overlay = new ResultOverlayScreen(new Container());
    expect(priv(overlay).lootCeremony.revealing).toBe(false); // 초기: 미공개
    overlay.show(stateWithDrops(['rare', 'unique']), () => {});
    expect(priv(overlay).lootCeremony.revealing).toBe(true); // 배선 없으면 false
    overlay.hide();
  });

  it('공개 완료 후 유지+페이드로 세리머니가 사라진다(결과 화면 드러남)', () => {
    const overlay = new ResultOverlayScreen(new Container());
    overlay.show(stateWithDrops(['normal']), () => {});
    // 공개 + HOLD + FADE 를 넉넉히 넘기도록 진행(0.05s × 400 = 20s).
    for (let i = 0; i < 400; i++) overlay.update(0.05);
    expect(priv(overlay).lootCeremony.revealing).toBe(false);
    expect(priv(overlay).lootCeremony.container.alpha).toBeLessThanOrEqual(0.01); // 페이드아웃 완료
    overlay.hide();
  });

  it('드랍이 없으면 세리머니를 공개하지 않는다', () => {
    const overlay = new ResultOverlayScreen(new Container());
    overlay.show(stateWithDrops([]), () => {});
    expect(priv(overlay).lootCeremony.revealing).toBe(false);
    overlay.hide();
  });

  it('hide 는 세리머니를 리셋한다(다음 정산 재사용)', () => {
    const overlay = new ResultOverlayScreen(new Container());
    overlay.show(stateWithDrops(['unique']), () => {});
    overlay.hide();
    expect(priv(overlay).lootCeremony.revealing).toBe(false);
  });

  it('update 는 정산이 안 떠 있으면 no-op(비표시 세리머니 무진행)', () => {
    const overlay = new ResultOverlayScreen(new Container());
    for (let i = 0; i < 10; i++) overlay.update(0.05); // show 안 함 → 비표시
    expect(priv(overlay).lootCeremony.revealing).toBe(false);
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

  it('렌더 루프가 screenTransition.update 와 resultOverlay.update 를 매 프레임 구동한다', () => {
    expect(src).toMatch(/screenTransition\.update\(/);
    expect(src).toMatch(/resultOverlay\.update\(/);
  });
});
