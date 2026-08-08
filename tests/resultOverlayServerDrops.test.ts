/**
 * 정산 화면 '획득 장비' — **서버 권위 드랍 모드의 끊긴 절반** (사용자 신고 2026-08-09).
 *
 * ## 증상과 뿌리
 * 온라인 계정으로 런을 돌아 장비를 주웠는데 정산이 *"이번 런에는 새 장비가 없습니다"* 를
 * 띄우고 회수 0점·전투력 +0 이었다. 뿌리는 한 줄이다: 서버 권위 모드(ADR-0050 §3 단계 1)의
 * `settleRun` 은 전리품을 **굴리지 않아** `itemsGained` 가 항상 빈 배열인데, 화면이 그
 * 배열만 읽고 있었다. 서버가 무엇을 굴렸는지 아는 자리는 **배송**(`itemGrantDelivery`)뿐이다.
 *
 * ## 이 파일이 기계로 잠그는 넷
 *  ① 배송 리포트가 **심은 실물**을 들고 나온다(보류·해석 실패·이미 보유 행은 안 담긴다).
 *  ② 배송 전 화면은 "없음"이 아니라 **"수령 중…"** 이라고 말한다 — 거짓말과 침묵을 가른다.
 *  ③ `updateDrops()` 가 실물 목록·전투력으로 갈아끼우고 그 문구를 지운다.
 *  ④ **오프라인(로컬 롤) 회귀 방어** — `dropsPending` 없는 빈 목록은 여전히 진짜 "없음"이다.
 *     이 절이 없으면 ②를 넓게 걸어 "전리품이 실제로 없는 런"까지 영영 "수령 중…"이 된다.
 *
 * 단언마다 **"이게 통과하면서도 참일 수 있는 나쁜 상태"** 를 적는다(itemGrantDelivery 규율).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Container } from 'pixi.js';

import { deliverItemGrants } from '../src/run/itemGrantDelivery.js';
import type { ItemGrantDeliveryDeps } from '../src/run/itemGrantDelivery.js';
import { dropGrantItemId, itemFromDropGrant } from '../src/items/dropGrant.js';
import { defaultProfile, INVENTORY_CAP, stashCapacity } from '../src/save/profile.js';
import type { ItemGrantRow } from '../src/net/gateway.js';
import { ResultOverlayScreen } from '../src/ui/pixi/resultOverlay.js';
import type { ResultDrop, ResultState } from '../src/ui/resultOverlay.js';

/** `show/hide` 의 `setDomHidden` 한 줄만 여는 최소 스텁(catalystSettleWire 선례). */
const g = globalThis as unknown as { document?: { getElementById(id: string): null } };
if (typeof g.document === 'undefined') {
  g.document = { getElementById: () => null };
}

const GRANT_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const GRANT_B = 'bbbbbbbb-1111-2222-3333-444444444444';

function grantRow(over: Partial<ItemGrantRow> = {}): ItemGrantRow {
  return {
    grantId: GRANT_A,
    dropIndex: 0,
    dropSeed: 0x1234abcd,
    rarity: 'rare',
    source: { planet: 1, stage: 3, levelCap: 10 },
    appliedAtMs: null,
    ...over,
  };
}

/** 순서 계약이 전부 성공하는 배송 의존성(이 파일의 관심사는 순서가 아니라 산출물이다). */
function okDeps(rows: readonly ItemGrantRow[]): ItemGrantDeliveryDeps {
  return {
    fetchGrants: async () => rows,
    saveProfile: () => {},
    pushProfile: async () => true,
    repullProfile: async (p) => p,
    markApplied: async () => true,
  };
}

// ===========================================================================
// ① 배송 리포트가 실물을 들고 나온다
// ===========================================================================

describe('① `deliveredItems` — 화면이 읽을 실물 목록', () => {
  it('심은 아이템이 발급 id 를 달고 나온다', async () => {
    const p = defaultProfile();
    const report = await deliverItemGrants(
      p,
      okDeps([grantRow(), grantRow({ grantId: GRANT_B, dropIndex: 1, dropSeed: 0x5678 })]),
    );

    // 나쁜 상태: 개수(`delivered`)만 맞고 목록이 비면 화면은 여전히 "새 장비 없음"이다 —
    // 그것이 정확히 이 신고의 증상이었다.
    expect(report.deliveredItems.map((d) => d.grantId)).toEqual([GRANT_A, GRANT_B]);
    expect(report.deliveredItems.length).toBe(report.delivered);
    // 실물이어야 한다(id 가 발급 id 에서 결정론 파생 — 멱등의 근거).
    expect(report.deliveredItems[0]?.item.id).toBe(dropGrantItemId(GRANT_A));
    // 세이브에 실제로 들어간 그 객체다(화면과 인벤이 다른 물건을 말하면 안 된다).
    expect(p.inventory.map((i) => i.id)).toContain(dropGrantItemId(GRANT_B));
  });

  it('만석 보류분은 목록에 안 들어간다', async () => {
    const p = defaultProfile();
    const filler = itemFromDropGrant('x'.repeat(8), 1, 'normal', { planet: 0, stage: 0 })!;
    while (p.inventory.length < INVENTORY_CAP)
      p.inventory.push({ ...filler, id: `f${p.inventory.length}` });
    while (p.stash.length < stashCapacity(p.stashExpansions))
      p.stash.push({ ...filler, id: `s${p.stash.length}` });

    const report = await deliverItemGrants(p, okDeps([grantRow()]));

    expect(report.held).toBe(1);
    // 나쁜 상태: 보류분을 실으면 화면은 "받았다"고 말하는데 인벤에는 없다 — 이 리포가 반복해
    // 대가를 치른 「화면과 실제가 조용히 갈리는 자리」가 하나 더 생긴다.
    expect(report.deliveredItems).toEqual([]);
  });

  it('해석 실패 행도 목록에 안 들어간다', async () => {
    const p = defaultProfile();
    const report = await deliverItemGrants(p, okDeps([grantRow({ rarity: 'legendary' })]));
    expect(report.unresolved).toBe(1);
    expect(report.deliveredItems).toEqual([]);
  });

  it('이미 들고 있던 행(표시만 재시도)은 목록에 안 들어간다', async () => {
    const p = defaultProfile();
    const already = itemFromDropGrant(GRANT_A, 0x1234abcd, 'rare', { planet: 1, stage: 3 })!;
    p.inventory.push(already);

    const report = await deliverItemGrants(p, okDeps([grantRow()]));

    expect(report.marked).toBe(1);
    // 나쁜 상태: 지난 부팅에서 이미 받은 물건을 이번 런 전리품으로 적으면 화면이 또 거짓이다.
    expect(report.deliveredItems).toEqual([]);
  });
});

// ===========================================================================
// ②③④ 정산 화면 — 대기 문구 · 갱신 · 오프라인 회귀
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

function state(over: Partial<ResultState['settlement'] & object> = {}): ResultState {
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

const DROP: ResultDrop = { rarity: 'rare', slot: 'core' };

describe('② 배송 전 — "없음"이 아니라 "수령 중…"', () => {
  it('`dropsPending` 이 서 있으면 대기 문구가 뜨고 "없습니다"는 안 뜬다', () => {
    const overlay = new ResultOverlayScreen(new Container());
    overlay.show(state({ itemsGained: 3, dropsPending: true }), () => {});
    const all = screenText(overlay);

    // 나쁜 상태: 여기서 "없습니다"가 뜨면 장비를 3점 주운 런에서 화면이 정면으로 거짓을 말한다.
    expect(all).toContain('전리품 수령 중');
    expect(all).not.toContain('새 장비가 없습니다');
    // 회수 점수는 배송을 기다리지 않는다 — 주운 개수는 런이 끝난 순간 이미 안다.
    expect(all).toContain('3');
    overlay.hide();
  });
});

describe('③ `updateDrops()` — 배송 결과로 갈아끼운다', () => {
  it('실물 목록·전투력이 들어오고 대기 문구가 사라진다', () => {
    const overlay = new ResultOverlayScreen(new Container());
    overlay.show(state({ itemsGained: 1, dropsPending: true }), () => {});
    overlay.updateDrops([DROP], 777);
    const all = screenText(overlay);

    // 나쁜 상태: 갱신 경로가 없으면(이 신고 이전 상태) 배송이 끝나도 화면은 영영 대기 문구다.
    expect(all).not.toContain('전리품 수령 중');
    expect(all).not.toContain('새 장비가 없습니다');
    expect(all).toContain('+777');
    // 회수 점수는 **건드리지 않는다** — 주장 개수와 실배송 수가 다를 수 있고(만석 보류·캡),
    // 그 차이 자체가 정보다.
    expect(all).toContain('1');
    overlay.hide();
  });

  it('화면이 닫혀 있으면 조용히 무시한다(늦게 도착한 배송이 죽은 화면을 되살리지 않는다)', () => {
    const overlay = new ResultOverlayScreen(new Container());
    overlay.show(state({ dropsPending: true }), () => {});
    overlay.hide();
    // 나쁜 상태: 여기서 throw 하면 배송 경로 전체가 끊겨 다음 로직이 통째로 안 돈다.
    expect(() => overlay.updateDrops([DROP], 10)).not.toThrow();
    // `hide()` 는 트리를 지우지 않고 숨기기만 한다 — 그래서 "안 그렸다"는 **갱신이 반영되지
    // 않았다**로 재야 한다. 나쁜 상태: 여기서 갱신이 먹으면 다음 런으로 넘어간 뒤 도착한
    // 배송이 이미 닫힌 화면을 다시 그려, 다음에 열릴 정산에 지난 런 전리품이 실린다.
    expect(screenText(overlay)).not.toContain('+10');
    expect(screenText(overlay)).toContain('전리품 수령 중');
  });
});

describe('④ 오프라인(로컬 롤) 회귀 — 진짜 "없음"은 그대로 "없음"이다', () => {
  it('`dropsPending` 없는 빈 목록은 종전 문구를 유지한다', () => {
    const overlay = new ResultOverlayScreen(new Container());
    overlay.show(state(), () => {});
    const all = screenText(overlay);

    // 나쁜 상태: 대기 문구를 넓게 걸면 전리품이 **실제로 없는** 런까지 영영 "수령 중…"이 되어,
    // 플레이어는 오지 않을 물건을 기다린다(게이트를 넓게 걸어 정상 경로를 죽이는 형태).
    expect(all).toContain('새 장비가 없습니다');
    expect(all).not.toContain('전리품 수령 중');
    overlay.hide();
  });

  it('실물을 들고 연 런은 그대로 그린다', () => {
    const overlay = new ResultOverlayScreen(new Container());
    overlay.show(state({ itemsGained: 1, combatPower: 42, drops: [DROP] }), () => {});
    const all = screenText(overlay);
    expect(all).not.toContain('새 장비가 없습니다');
    expect(all).toContain('+42');
    overlay.hide();
  });
});

// ===========================================================================
// ⑤ 배선 앵커 — main.ts 가 두 축을 실제로 잇고 있는가
// ===========================================================================
//
// `main()` 은 통짜 클로저라 단위 테스트가 진입할 수 없다. 그런데 이 신고의 뿌리는 **배선 한
// 줄의 부재**였으므로(화면이 `itemsGained` 만 읽었다) 그 줄을 지우면 위 ①~④가 전부 초록인
// 채로 증상이 되돌아온다. 그래서 선언 문법에 앵커를 건다(`catalystSettleWire` 선례).

describe('⑤ main.ts 배선 앵커', () => {
  const src = new TextDecoder().decode(
    readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url))),
  );

  it('배송이 끝나면 정산 화면을 갱신한다', () => {
    // 나쁜 상태: 이 호출이 없으면 서버 권위 런의 '획득 장비'는 영영 비어 있다.
    expect(src).toContain('resultOverlay.updateDrops(');
  });

  it('회수 점수가 서버 모드에서 주장 개수로 선다', () => {
    // 나쁜 상태: `o.itemsGained.length` 만 남으면 서버 모드의 회수 점수가 항상 0 이다.
    expect(src).toMatch(/itemsGained:\s*claimedServerDrops\s*>\s*0\s*\?\s*claimedServerDrops/);
  });

  it('발급에 넘긴 개수와 화면에 적는 개수가 **같은 변수**다', () => {
    // 나쁜 상태: 두 자리에서 따로 계산하면 압류·소멸이 한쪽에만 반영돼 다시 갈린다.
    expect(src).toMatch(/claimedServerDrops\s*=\s*Math\.max\(0,\s*w\.loot\.length\s*-\s*seized\s*-\s*voided\)/);
    expect(src).toContain('deliverRunDrops(dropRunId, claimedServerDrops,');
  });
});
