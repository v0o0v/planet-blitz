/**
 * 방어 배치 서버 업로드 계층 테스트 (src/net/defenseSync.ts — M4 Phase D).
 *
 * 커버리지:
 *   1. no-op 모드(config=null): uploadDefenseLayout 이 null 을 돌려주고 SDK/네트워크를
 *      만지지 않음(게이트웨이 미주입).
 *   2. fake 게이트웨이: 활성 방어 없음 → INSERT, 있음 → UPDATE(정비도 리셋 회피), 오류 → null.
 *   3. defenseLayoutCost: 서버 defense_layout_cost 와 일치(유형별 비용·범위 밖 발칸 폴백·장애물).
 *   4. planDefenseUpsert: 활성 id 유무에 따른 insert/update 분기.
 */

import { describe, it, expect } from 'vitest';
import {
  uploadDefenseLayout,
  defenseLayoutCost,
  planDefenseUpsert,
  type DefenseGateway,
  type DefenseInsertPayload,
} from '../src/net/defenseSync.js';
import type { DefenseLayout } from '../src/sim/defense.js';

const CORE = { x: 400, y: 0 };

function layout(partial: Partial<DefenseLayout> = {}): DefenseLayout {
  return { core: CORE, turrets: [], obstacles: [], ...partial };
}

/** 업로드 플로우 검증용 fake 게이트웨이 — 호출을 기록하고 분기/실패를 시뮬레이션. */
class FakeDefenseGateway implements DefenseGateway {
  uid = 'me-1';
  activeId: string | null = null;
  fail = false;
  insertCalls: { uid: string; payload: DefenseInsertPayload }[] = [];
  updateCalls: { defenseId: string; layout: DefenseLayout }[] = [];

  async getUserId(): Promise<string> {
    if (this.fail) throw new Error('offline');
    return this.uid;
  }
  async fetchActiveDefenseId(): Promise<string | null> {
    if (this.fail) throw new Error('offline');
    return this.activeId;
  }
  async insertDefense(uid: string, payload: DefenseInsertPayload): Promise<void> {
    if (this.fail) throw new Error('offline');
    this.insertCalls.push({ uid, payload });
  }
  async updateDefense(defenseId: string, l: DefenseLayout): Promise<void> {
    if (this.fail) throw new Error('offline');
    this.updateCalls.push({ defenseId, layout: l });
  }
}

// ---------------------------------------------------------------------------
// no-op 모드
// ---------------------------------------------------------------------------

describe('net/defenseSync — no-op 모드(미설정)', () => {
  it('config=null 이면 uploadDefenseLayout 은 null(업로드 안 함)', async () => {
    expect(await uploadDefenseLayout(layout(), { config: null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 업로드 플로우(fake 게이트웨이)
// ---------------------------------------------------------------------------

describe('net/defenseSync — 업로드 플로우(fake 게이트웨이)', () => {
  it('활성 방어 없음 → INSERT(active·비용 정직 신고), UPDATE 미호출', async () => {
    const gw = new FakeDefenseGateway();
    gw.activeId = null;
    const l = layout({
      turrets: [
        { type: 1, x: 100, y: 0 }, // 저격 3
        { type: 0, x: 200, y: 0 }, // 발칸 1
      ],
      obstacles: [{ x: 300, y: 0, halfW: 50, halfH: 50 }], // 1
    });
    const res = await uploadDefenseLayout(l, { gateway: gw });
    expect(res).toBe('inserted');
    expect(gw.insertCalls).toHaveLength(1);
    expect(gw.updateCalls).toHaveLength(0);
    expect(gw.insertCalls[0]!.uid).toBe('me-1');
    expect(gw.insertCalls[0]!.payload.layout).toBe(l);
    expect(gw.insertCalls[0]!.payload.budgetSpent).toBe(5); // 3+1+1
  });

  it('활성 방어 있음 → UPDATE(layout 만, 정비도 리셋 회피), INSERT 미호출', async () => {
    const gw = new FakeDefenseGateway();
    gw.activeId = 'def-existing';
    const l = layout({ turrets: [{ type: 4, x: 100, y: 0 }] });
    const res = await uploadDefenseLayout(l, { gateway: gw });
    expect(res).toBe('updated');
    expect(gw.updateCalls).toHaveLength(1);
    expect(gw.insertCalls).toHaveLength(0);
    expect(gw.updateCalls[0]!.defenseId).toBe('def-existing');
    expect(gw.updateCalls[0]!.layout).toBe(l);
  });

  it('오류면 null(throw 안 함)', async () => {
    const gw = new FakeDefenseGateway();
    gw.fail = true;
    expect(await uploadDefenseLayout(layout(), { gateway: gw })).toBeNull();
  });

  it('동시 업로드 레이스: INSERT 유니크 위반 → 활성 행 재조회 → UPDATE 1회 재시도(업로드 유실 방지)', async () => {
    // 두 세션이 모두 활성 행 부재로 INSERT 를 시도, 늦은 쪽이 defenses_one_active_idx
    // 위반으로 실패하는 시나리오. 재조회 시엔 상대 세션이 만든 활성 행이 보인다.
    const gw = new FakeDefenseGateway();
    gw.activeId = null; // 1차 조회: 활성 행 없음 → insert 분기
    gw.insertDefense = async () => {
      // 위반 시점에 상대 행이 이미 존재 → 재조회가 그 id 를 본다.
      gw.activeId = 'def-raced';
      throw new Error('duplicate key value violates unique constraint "defenses_one_active_idx"');
    };
    const l = layout({ turrets: [{ type: 0, x: 100, y: 0 }] });
    const res = await uploadDefenseLayout(l, { gateway: gw });
    expect(res).toBe('updated'); // 유실 없이 상대 행에 반영
    expect(gw.updateCalls).toHaveLength(1);
    expect(gw.updateCalls[0]!.defenseId).toBe('def-raced');
    expect(gw.updateCalls[0]!.layout).toBe(l);
  });

  it('INSERT 실패 + 재조회에도 활성 행 없음(레이스 아님) → null(원래 실패로 수렴)', async () => {
    const gw = new FakeDefenseGateway();
    gw.activeId = null; // 1차·재조회 모두 활성 행 없음
    gw.insertDefense = async () => {
      throw new Error('network error');
    };
    expect(await uploadDefenseLayout(layout(), { gateway: gw })).toBeNull();
    expect(gw.updateCalls).toHaveLength(0); // 엉뚱한 UPDATE 재시도 없음
  });
});

// ---------------------------------------------------------------------------
// defenseLayoutCost (서버 defense_layout_cost 와 일치)
// ---------------------------------------------------------------------------

describe('net/defenseSync — defenseLayoutCost(서버 산출 일치)', () => {
  it('빈 배치는 0(코어만)', () => {
    expect(defenseLayoutCost(layout())).toBe(0);
  });

  it('유형별 비용: 발칸1·저격3·산탄2·감속2·미사일3·전격2', () => {
    const l = layout({
      turrets: [
        { type: 0, x: 0, y: 0 },
        { type: 1, x: 0, y: 0 },
        { type: 2, x: 0, y: 0 },
        { type: 3, x: 0, y: 0 },
        { type: 4, x: 0, y: 0 },
        { type: 5, x: 0, y: 0 },
      ],
    });
    expect(defenseLayoutCost(l)).toBe(1 + 3 + 2 + 2 + 3 + 2);
  });

  it('범위 밖 유형은 발칸(1)으로 폴백(spawnDefenseTurret·서버 게이트 동일)', () => {
    const l = layout({ turrets: [{ type: 99, x: 0, y: 0 }, { type: -1, x: 0, y: 0 }] });
    expect(defenseLayoutCost(l)).toBe(2); // 1+1
  });

  it('장애물은 개당 1(OBSTACLE_COST)', () => {
    const l = layout({
      obstacles: [
        { x: 0, y: 0, halfW: 10, halfH: 10 },
        { x: 1, y: 1, halfW: 10, halfH: 10 },
        { x: 2, y: 2, halfW: 10, halfH: 10 },
      ],
    });
    expect(defenseLayoutCost(l)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// planDefenseUpsert (순수 분기)
// ---------------------------------------------------------------------------

describe('net/defenseSync — planDefenseUpsert(분기)', () => {
  it('활성 id 없으면 insert', () => {
    expect(planDefenseUpsert(null)).toEqual({ action: 'insert', defenseId: null });
  });
  it('활성 id 있으면 update(그 id 대상)', () => {
    expect(planDefenseUpsert('def-7')).toEqual({ action: 'update', defenseId: 'def-7' });
  });
});
