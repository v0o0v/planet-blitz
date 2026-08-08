/**
 * 정산 화면의 **설계도 · 의뢰서 획득 줄** (사용자 요청 2026-08-09).
 *
 * ## 왜 두 축이 화면에 없었나 — 뿌리가 서로 다르다
 *  - **설계도**: 정산이 이미 손에 쥐고 있었다(`SettlementOutcome.blueprintsGained`). 그런데
 *    호출부가 그것을 `grantBlueprintDrops` 로 **서버에만** 흘려보내고 화면에는 안 실었다.
 *    얻었는지 알려면 관제탑 → 방어 사령부까지 들어가 보유량을 세는 수밖에 없었다.
 *  - **의뢰서**: 발령이 서버 `pve_runs` AFTER 트리거라 **정산 응답에 안 실리고**, 발령 원장은
 *    RLS 정책이 0개라 못 읽는다. 읽을 수 있는 재고의 **전후 차집합**이 유일한 관측면이다.
 *
 * ## 이 파일이 기계로 잠그는 넷
 *  ① 차집합 판정 — **기준선이 없으면 빈 배열**이다(가장 비싼 실패 모드).
 *  ② 설계도 줄이 이름·수량으로 뜬다 · 없으면 줄 자체가 없다.
 *  ③ `updateCommissionGains()` 가 등급 줄을 채운다 · 0건과 닫힌 화면은 조용하다.
 *  ④ 두 줄이 다 서도 '획득 장비' 그리드가 살아 있다(세로를 다 먹지 않는다).
 *
 * 단언마다 **"이게 통과하면서도 참일 수 있는 나쁜 상태"** 를 적는다(이 리포 규율).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Container } from 'pixi.js';

import { newlyIssuedCommissions } from '../src/run/commissionIssueDiff.js';
import { ResultOverlayScreen } from '../src/ui/pixi/resultOverlay.js';
import type { ResultDrop, ResultState } from '../src/ui/resultOverlay.js';

/** `show/hide` 의 `setDomHidden` 한 줄만 여는 최소 스텁(catalystSettleWire 선례). */
const g = globalThis as unknown as { document?: { getElementById(id: string): null } };
if (typeof g.document === 'undefined') {
  g.document = { getElementById: () => null };
}

// ===========================================================================
// ① 차집합 판정 — 기준선 없이 빼지 않는다
// ===========================================================================

const ROWS = [{ commissionId: 'a' }, { commissionId: 'b' }, { commissionId: 'c' }];

describe('① newlyIssuedCommissions', () => {
  it('기준선에 없던 행만 낸다', () => {
    expect(newlyIssuedCommissions(new Set(['a', 'b']), ROWS)).toEqual([{ commissionId: 'c' }]);
  });

  it('⭐ 기준선이 `null` 이면 빈 배열이다 — 재고 전체를 새 것으로 적지 않는다', () => {
    // 나쁜 상태: 여기서 ROWS 를 그대로 내면 오프라인 플레이어의 정산이 매번 "의뢰서 3건
    // 발령!"이라고 말한다. 보유 재고가 클수록 거짓말이 커지는 형태다.
    expect(newlyIssuedCommissions(null, ROWS)).toEqual([]);
  });

  it('조회 실패(`rows === null`)도 빈 배열이다', () => {
    expect(newlyIssuedCommissions(new Set(['a']), null)).toEqual([]);
  });

  it('발령이 없던 런은 빈 배열이다 (정상 경로 — 대부분의 런)', () => {
    // 나쁜 상태: 여기가 비지 않으면 발령률 30% 인 축이 매 런 줄을 그려 잡음이 된다.
    expect(newlyIssuedCommissions(new Set(['a', 'b', 'c']), ROWS)).toEqual([]);
  });

  it('입력을 변형하지 않고 순서를 보존한다', () => {
    const before = new Set(['b']);
    const out = newlyIssuedCommissions(before, ROWS);
    expect(out).toEqual([{ commissionId: 'a' }, { commissionId: 'c' }]);
    expect(ROWS.map((r) => r.commissionId)).toEqual(['a', 'b', 'c']);
    expect([...before]).toEqual(['b']);
  });
});

// ===========================================================================
// ②③④ 화면
// ===========================================================================

function texts(node: unknown): string[] {
  const n = node as { text?: unknown; children?: readonly unknown[] };
  const out: string[] = [];
  if (typeof n.text === 'string') out.push(n.text);
  for (const c of n.children ?? []) out.push(...texts(c));
  return out;
}

function screenText(overlay: ResultOverlayScreen): string {
  return texts((overlay as unknown as { root: unknown }).root).join('\n');
}

function state(over: Partial<NonNullable<ResultState['settlement']>> = {}): ResultState {
  return {
    victory: true,
    seed: 1,
    xpTotal: 100,
    kills: 10,
    maxCombo: 3,
    resources: 50,
    level: 5,
    timeSec: 90,
    planet: 1,
    settlement: {
      itemsGained: 0,
      levelsGained: 0,
      skillPointsGained: 0,
      creditsGained: 0,
      overflow: 0,
      combatPower: 0,
      drops: [],
      ...over,
    },
  };
}

describe('② 설계도 줄', () => {
  it('이름과 장수가 뜬다', () => {
    const overlay = new ResultOverlayScreen(new Container());
    overlay.show(state({ blueprintGains: [{ name: '화염 분출구', count: 2 }] }), () => {});
    const all = screenText(overlay);

    // 나쁜 상태: 제목만 뜨고 내용이 없으면 "얻었다"는 사실만 알고 무엇인지는 여전히 모른다 —
    // 그게 바로 이 요청 이전의 상태(관제탑까지 들어가야 함)와 같다.
    expect(all).toContain('획득 설계도');
    expect(all).toContain('화염 분출구 ×2');
    overlay.hide();
  });

  it('1장이면 `×1` 을 붙이지 않는다', () => {
    const overlay = new ResultOverlayScreen(new Container());
    overlay.show(state({ blueprintGains: [{ name: '고정 주포', count: 1 }] }), () => {});
    expect(screenText(overlay)).toContain('고정 주포');
    expect(screenText(overlay)).not.toContain('×1');
    overlay.hide();
  });

  it('없으면 줄 자체가 없다 (조건부 스탬프)', () => {
    const overlay = new ResultOverlayScreen(new Container());
    overlay.show(state(), () => {});
    // 나쁜 상태: 빈 제목 줄이 서면 설계도가 안 나오는 대부분의 런에서 패널 세로만 먹는다.
    expect(screenText(overlay)).not.toContain('획득 설계도');
    overlay.hide();
  });
});

describe('③ 의뢰서 줄 — 사후 갱신', () => {
  it('`updateCommissionGains()` 가 등급 줄을 채운다', () => {
    const overlay = new ResultOverlayScreen(new Container());
    overlay.show(state(), () => {});
    // 나쁜 상태: 갱신 경로가 없으면 발령이 나도 화면은 영영 침묵이다(설계도와 달리 이 축은
    // 정산 시점에 값 자체가 존재하지 않는다).
    expect(screenText(overlay)).not.toContain('발령 의뢰서');
    overlay.updateCommissionGains(['특급 지시']);
    expect(screenText(overlay)).toContain('발령 의뢰서');
    expect(screenText(overlay)).toContain('특급 지시');
    overlay.hide();
  });

  it('0건이면 아무것도 안 그린다', () => {
    const overlay = new ResultOverlayScreen(new Container());
    overlay.show(state(), () => {});
    overlay.updateCommissionGains([]);
    expect(screenText(overlay)).not.toContain('발령 의뢰서');
    overlay.hide();
  });

  it('닫힌 화면은 조용히 무시한다', () => {
    const overlay = new ResultOverlayScreen(new Container());
    overlay.show(state(), () => {});
    overlay.hide();
    // 나쁜 상태: 여기서 throw 하면 정산 후속 경로가 끊긴다. 반영되면 다음 정산에 지난 런
    // 발령분이 실린다(`hide()` 는 트리를 지우지 않으므로 "반영 안 됨"으로 재야 한다).
    expect(() => overlay.updateCommissionGains(['특급 지시'])).not.toThrow();
    expect(screenText(overlay)).not.toContain('발령 의뢰서');
  });
});

describe('④ 두 줄이 다 서도 획득 장비 그리드가 산다', () => {
  const DROP: ResultDrop = { rarity: 'rare', slot: 'core' };

  it('설계도·의뢰서·촉매가 모두 있어도 장비가 여전히 그려진다', () => {
    const overlay = new ResultOverlayScreen(new Container());
    overlay.show(
      state({
        itemsGained: 1,
        combatPower: 42,
        drops: [DROP],
        catalystDrops: 2,
        catalystDropList: [{ id: 1, qty: 2 }],
        blueprintGains: [
          { name: '화염 분출구', count: 1 },
          { name: '강습 돌격편대', count: 1 },
        ],
        commissionGains: ['정기 의뢰'],
      }),
      () => {},
    );
    const all = screenText(overlay);

    // 나쁜 상태: 새 줄이 세로를 다 먹으면 '획득 장비'가 "없습니다"로 접혀, 이번 레인이
    // 직전 레인(장비 미표시)의 증상을 다른 경로로 되살린다.
    expect(all).toContain('획득 설계도');
    expect(all).toContain('발령 의뢰서');
    expect(all).toContain('새 장비');
    expect(all).not.toContain('새 장비가 없습니다');
    expect(all).toContain('+42');
    overlay.hide();
  });
});

// ===========================================================================
// ⑤ main.ts 배선 앵커 (통짜 클로저라 단위 테스트가 못 들어간다)
// ===========================================================================

describe('⑤ main.ts 배선 앵커', () => {
  const src = new TextDecoder().decode(
    readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url))),
  );

  it('설계도 이름을 `catalogName` 으로 해석해 화면에 싣는다', () => {
    // 나쁜 상태: 이 배선이 없으면 설계도는 서버로만 흘러가고 화면은 영영 침묵이다.
    expect(src).toMatch(/blueprintGains:\s*o\.blueprintsGained\.map/);
    expect(src).toContain('catalogName(b.kind, b.catalogId)');
  });

  it('런 시작에 재고 기준선을 찍는다', () => {
    // 나쁜 상태: 기준선을 정산 직전에 찍으면 결과 화면이 네트워크를 기다리고, 아예 안 찍으면
    // 차집합이 재고 전체가 된다.
    expect(src).toMatch(/commissionIdsAtRunStart\s*=\s*new Set\(rows\.map/);
  });

  it('정산 응답 뒤에 발령을 조회한다 (트리거가 그 안에서 돈다)', () => {
    // 나쁜 상태: 정산 **앞**에서 조회하면 아직 발령 전이라 항상 0건이다.
    expect(src).toContain('.then(() => reportCommissionIssue())');
  });

  it('판정은 순수 함수가 소유한다', () => {
    // 나쁜 상태: 클로저 안에서 직접 filter 하면 "기준선 null" 분기를 영영 못 잠근다.
    expect(src).toContain('newlyIssuedCommissions(before, rows)');
  });
});
