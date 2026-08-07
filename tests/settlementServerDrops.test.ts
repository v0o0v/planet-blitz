/**
 * `settleRun({ serverDrops })` — 「개수만 계약」의 클라측 절반 (ADR-0050 §3 단계 1).
 *
 * ## 이 스위치가 지키는 것
 * 서버 권위 모드에서 클라가 전리품을 **여기서 굴리면** 원장과 별개로 아이템이 생긴다. 그러면
 * 뒤따르는 `save` 증가분 봉인이 그것을 위조로 보고 되돌리고, 증상은 "가끔 아이템이 사라진다"
 * 하나뿐이다. 반대로 스위치가 **너무 넓게** 걸려 로컬 모드까지 막으면 오프라인 단일플레이가
 * 전리품을 통째로 잃는다 — 이 저장소가 반복해 겪은 "게이트를 넓게 걸어 정상 경로를 죽이는" 형태다.
 *
 * 그래서 **양성·음성 두 방향**을 모두 단언한다.
 */

import { describe, it, expect } from 'vitest';
import { settleRun } from '../src/save/settlement.js';
import { defaultProfile } from '../src/save/profile.js';
import { RARITY_CODE } from '../src/items/types.js';

/** 엘리트 드랍 2건 — 로컬 모드면 이 둘이 아이템이 되고, 서버 모드면 개수만 남는다. */
const LOOT = [
  { seed: 0x1234, rarity: RARITY_CODE.rare, planet: 1, stage: 3, elite: 1 },
  { seed: 0x5678, rarity: RARITY_CODE.magic, planet: 1, stage: 3, elite: 1 },
] as const;

const base = { victory: true, xpTotal: 500, resources: 120, planet: 1, stage: 3 } as const;

describe('serverDrops=false (기본·오프라인) — 종전대로 여기서 굴린다', () => {
  it('전리품이 아이템이 되어 인벤에 들어간다', () => {
    const p = defaultProfile();
    const before = p.inventory.length;
    const out = settleRun(p, { ...base, loot: [...LOOT] });

    // 나쁜 상태: 스위치를 넓게 걸면 여기가 0 이 되고 **오프라인 플레이가 전리품을 잃는다.**
    expect(out.itemsGained.length).toBe(2);
    expect(p.inventory.length).toBe(before + 2);
  });

  it('옵션을 아예 안 넘겨도 같다 (기본값 회귀 방어)', () => {
    const p = defaultProfile();
    const out = settleRun(p, { ...base, loot: [...LOOT] });
    expect(out.itemsGained.length).toBe(2);
  });
});

describe('serverDrops=true — 굴리지 않는다', () => {
  it('아이템을 만들지 않고 인벤도 안 건드린다', () => {
    const p = defaultProfile();
    const before = p.inventory.length;
    const out = settleRun(p, { ...base, loot: [...LOOT] }, { serverDrops: true });

    // 나쁜 상태: 여기서 굴리면 원장 밖 아이템이 생겨 봉인이 그것을 되돌린다.
    expect(out.itemsGained).toEqual([]);
    expect(p.inventory.length).toBe(before);
    expect(out.overflow).toBe(0);
  });

  it('⭐ 아이템 축만 끈다 — XP·재화·진행도는 그대로 정산된다', () => {
    const local = defaultProfile();
    const server = defaultProfile();
    const localOut = settleRun(local, { ...base, loot: [...LOOT] });
    const serverOut = settleRun(server, { ...base, loot: [...LOOT] }, { serverDrops: true });

    // 나쁜 상태: 스위치가 정산 블록 전체를 건너뛰면 서버 모드에서 XP·재화·단계 개방이 전부
    // 죽는다 — 아이템만 안 오는 게 아니라 **런이 통째로 무의미해진다.**
    expect(serverOut.creditsGained).toBe(localOut.creditsGained);
    expect(serverOut.levelsGained).toBe(localOut.levelsGained);
    expect(serverOut.skillPointsGained).toBe(localOut.skillPointsGained);
    expect(server.planetProgress[1]?.bestStageCleared).toBe(3);
    expect(local.planetProgress[1]?.bestStageCleared).toBe(3);
  });

  it('전리품 개수는 RunResult 에 그대로 남는다 (화면이 "회수 N점"을 셀 축)', () => {
    // 클라가 서버에 주장하는 개수는 `settleRun` 산출이 아니라 `RunResult.loot` 의 길이다 —
    // 스위치가 그 배열을 비우면 주장할 개수가 0 이 되어 **전리품이 영영 안 나온다.**
    const result = { ...base, loot: [...LOOT] };
    const p = defaultProfile();
    settleRun(p, result, { serverDrops: true });
    expect(result.loot.length).toBe(2);
  });
});
