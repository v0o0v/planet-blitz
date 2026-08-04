/**
 * 메타 UI 연출 **배선** 통합 테스트 (Phase 5 — plan §AC-5.1 · AC-6.3; ADR-0031).
 *
 * ## 왜 이 형태인가
 * 이 프로젝트의 #1 반복 결함은 "순수함수 유닛은 그린인데 정규 경로에 배선이 통째로 없다"이다.
 * 모듈 유닛이 통과해도 main.ts 가 그것을 **실제로 호출하지 않으면** 게임엔 아무것도 안 뜬다.
 * 그래서 ①실제 `ResultOverlayScreen` 을 세워 정산이 show 즉시 온전히 서는지 관측하고, ②main.ts 의
 * 배선 계약을 소스 그렙으로 못박는다(entityRendererShipSwap 의 main.ts 계약 테스트 선례). main.ts 는
 * 앱 부트스트랩이라 인스턴스화가 안 되므로 소스 그렙이 정본 방어다.
 *
 * ⚠️ **보상 세리머니(AC-5.2)는 삭제됐다**(사용자 요청 2026-07-27). ⚠️ **화면 전환 커튼(AC-5.1)도
 * 삭제됐다**(사용자 지시 2026-08-04). 그 둘의 자리에는 "부활 방지" 회귀 가드가 들어간다 — 모듈
 * 부재 · 내부 필드 부재 · 렌더 루프 구동 호출 부재.
 *
 * 대신 여기가 지키는 **새 계약**이 하나 생겼다: 아레나 바닥(평면 배경 + Wang 지형)의 표시 여부는
 * 진입 경로마다 대입하는 것이 아니라 **렌더 루프에서 화면 이름으로 도출**한다. 경로 대입은 하나만
 * 빠뜨려도 메뉴에 아레나가 비치고, 실제로 그 신고가 두 번 나왔다(2026-08-04).
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

  // ⚠️ 여기 있던 **전환 커튼(AC-5.1) 배선 3건은 삭제 회귀 가드로 뒤집었다.** 커튼 자체를
  // 제거했기 때문이다(사용자 지시 2026-08-04: "화면 전환 효과 없애줘"). "배선이 있어야 한다"를
  // 그대로 두면 제거가 실패로 잡히고, 그냥 지우면 **누가 되살려도 아무도 모른다** — 이 파일의
  // 존재 이유가 "모듈 유닛은 통과해도 main.ts 배선이 죽는" 경우를 잡는 것이라, 방향만 뒤집는다.
  it('전환 커튼 배선이 main.ts 에서 사라졌다(재유입 가드)', () => {
    expect(src).not.toMatch(/screenTransition/);
  });

  // 아레나 바닥의 표시 여부는 진입 경로마다 흩어져 있던 것을 **렌더 루프 단일 권위**로 옮겼다.
  // 경로 대입이 되살아나면 "경로 하나를 빠뜨려 메뉴에 아레나가 비치는" 결함이 그대로 재발한다
  // (2026-08-04 두 번 신고). 그래서 ①단일 권위가 있고 ②경로 대입이 없다를 둘 다 잠근다.
  it('아레나 바닥 표시가 화면 이름 단일 권위로 도출된다', () => {
    expect(src).toMatch(/background\.visible = arenaScreen && !autotile\.active/);
    expect(src).toMatch(/autotile\.layer\.visible = arenaScreen && autotile\.active/);
  });

  it('진입 경로별 background.visible 대입이 없다(단일 권위 우회 가드)', () => {
    const assigns = src.match(/background\.visible\s*=/g) ?? [];
    expect(assigns).toHaveLength(1);
  });

  it('정산 세리머니 구동 호출이 렌더 루프에서 사라졌다(삭제 회귀 가드)', () => {
    expect(src).not.toMatch(/resultOverlay\.update\(/);
  });
});
