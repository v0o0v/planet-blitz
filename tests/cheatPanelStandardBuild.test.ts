/**
 * 치트 패널 「표준 빌드 점프」의 **Lv1~4 폴백** 계약.
 *
 * ## 무엇을 막는가
 * `applyStandardBuild` 는 `standardEquipped(lv, …)` 를 쓰는데 그 함수는 `Lv < 5` 에서 **0칸**을
 * 돌려준다(요구 레벨 게이트 — ADR-0030). 그런데 실제 신규 플레이어는 `newPlayerProfile()` 이
 * `starterEquipped()` 로 8칸을 채워 준다. 폴백이 없으면 사람이 **게임에 존재하지 않는 상태**로
 * 앉아 초반 이탈을 판정하게 된다.
 *
 * ## 왜 소스 텍스트 단언인가
 * 이 스위트는 `environment: 'node'`(`vite.config.ts`)라 DOM 이 없어 `createCheatPanel` 을
 * 실제로 마운트할 수 없다. 같은 파일에 대한 기존 계약도 전부 소스 텍스트로 못 박혀 있다
 * (`tests/harnessReplayApi.test.ts`). 그래서 **폴백의 근거가 되는 사실 두 개는 실제 함수를
 * 호출해 재고**, 패널이 그 폴백을 배선했는지만 소스로 확인한다.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { standardEquipped, STANDARD_BUILD_SEED } from '../src/bench/standardBuild.js';
import { starterEquipped } from '../src/items/starterKit.js';

const PANEL = readFileSync(
  fileURLToPath(new URL('../src/harness/cheatPanel.ts', import.meta.url)),
  'utf8',
);

describe('치트 패널 표준 빌드 — Lv1~4 폴백', () => {
  it('폴백의 전제: 표준 세트는 Lv1~4 에서 0칸이다', () => {
    for (const lv of [1, 2, 3, 4]) {
      expect(Object.keys(standardEquipped(lv, STANDARD_BUILD_SEED, 0)), `Lv${lv}`).toHaveLength(0);
    }
    // Lv5(밴드 1 대표 레벨)부터는 실제로 찬다 — 폴백이 걸리는 구간이 Lv1~4 뿐임을 못 박는다.
    expect(Object.keys(standardEquipped(5, STANDARD_BUILD_SEED, 0)).length).toBeGreaterThan(0);
  });

  it('폴백 대상: 스타터 킷은 8칸을 준다(신규 플레이어의 실제 상태)', () => {
    expect(Object.keys(starterEquipped())).toHaveLength(8);
  });

  it('패널이 빈 표준 세트에서 스타터 킷으로 폴백한다', () => {
    expect(PANEL, 'cheatPanel 이 starterEquipped 를 import 해야 한다').toContain(
      "from '../items/starterKit.js'",
    );
    expect(PANEL, '빈 세트 판정 없이 폴백은 성립하지 않는다').toContain(
      'Object.keys(std).length === 0',
    );
    expect(PANEL, '폴백 시 스타터 킷을 실제로 장착해야 한다').toContain(
      'useStarter ? starterEquipped() : std',
    );
  });

  it('힌트가 어느 킷이 적용됐는지 밝힌다', () => {
    // 사람이 무엇을 입고 앉았는지 모르는 것 자체가 이 레인이 막는 오판원이다.
    expect(PANEL).toContain("useStarter ? '스타터 킷' : '표준 장비'");
    expect(PANEL).toContain('${kit} ${filled}칸');
  });
});
