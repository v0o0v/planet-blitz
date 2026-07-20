/**
 * 방어 배치 서버 업로드 계층 테스트 (src/net/defenseSync.ts — M7a L7-db-net 로 3레이어 전환).
 *
 * 커버리지:
 *   1. no-op 모드(config=null): uploadDefenseLayout 이 null 을 돌려주고 SDK/네트워크를
 *      만지지 않음(게이트웨이 미주입).
 *   2. fake 게이트웨이: 활성 방어 없음 → INSERT, 있음 → UPDATE(정비도 리셋 회피), 오류 → null.
 *   3. **슬롯 초과 업로드 차단**: 업로드 직전 공유 정규화가 슬롯 상한을 강제하고(6/템플릿별/6/2),
 *      빈 슬롯 자리를 보존한다(밀집화 금지 — 슬롯 인덱스가 계약).
 *   4. **예산제 폐지 회귀 가드**: defenseLayoutCost 미러가 소스에서 완전히 사라졌는지
 *      (서버 defense_layout_cost 폐기 20260721000000 와 짝 — 미러가 남으면 폐지된 규칙을
 *      클라가 계속 강제한다), 그리고 budget_spent 신고가 항상 0 인지.
 *   5. planDefenseUpsert: 활성 id 유무에 따른 insert/update 분기.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  uploadDefenseLayout,
  planDefenseUpsert,
  DEFENSE_BUDGET_UNUSED,
  type DefenseGateway,
  type DefenseInsertPayload,
} from '../src/net/defenseSync.js';
import {
  emptyInvasionLayers,
  normalizeInvasionLayers,
  SAMPLE_GUARDIAN,
  SAMPLE_REF,
} from '../src/sim/invasion/normalize.js';
import {
  INVASION_CORE_MODULE_SLOTS,
  INVASION_PROP_SLOTS,
  INVASION_SOCKET_COUNTS,
  INVASION_WAVE_SLOTS,
  MAP_TEMPLATE_CHOKE,
} from '../src/sim/invasion/constants.js';
import type { InvasionLayers } from '../src/sim/invasion/types.js';

/** 업로드 플로우 검증용 fake 게이트웨이 — 호출을 기록하고 분기/실패를 시뮬레이션. */
class FakeDefenseGateway implements DefenseGateway {
  uid = 'me-1';
  activeId: string | null = null;
  fail = false;
  insertCalls: { uid: string; payload: DefenseInsertPayload }[] = [];
  updateCalls: { defenseId: string; layout: unknown }[] = [];

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
  async updateDefense(defenseId: string, layout: unknown): Promise<void> {
    if (this.fail) throw new Error('offline');
    this.updateCalls.push({ defenseId, layout });
  }
}

/** 슬롯 하나가 채워진 최소 배치(정규형). */
function layersWithOneFormation(): InvasionLayers {
  const l = emptyInvasionLayers();
  l.l1.waveSlots[0] = { ...SAMPLE_REF };
  return l;
}

// ---------------------------------------------------------------------------
// no-op 모드
// ---------------------------------------------------------------------------

describe('net/defenseSync — no-op 모드(미설정)', () => {
  it('config=null 이면 uploadDefenseLayout 은 null(업로드 안 함)', async () => {
    expect(await uploadDefenseLayout(emptyInvasionLayers(), { config: null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 업로드 플로우(fake 게이트웨이)
// ---------------------------------------------------------------------------

describe('net/defenseSync — 업로드 플로우(fake 게이트웨이)', () => {
  it('활성 방어 없음 → INSERT(정규형 layers·예산 0), UPDATE 미호출', async () => {
    const gw = new FakeDefenseGateway();
    gw.activeId = null;
    const res = await uploadDefenseLayout(layersWithOneFormation(), { gateway: gw });
    expect(res).toBe('inserted');
    expect(gw.insertCalls).toHaveLength(1);
    expect(gw.updateCalls).toHaveLength(0);
    expect(gw.insertCalls[0]!.uid).toBe('me-1');
    expect(gw.insertCalls[0]!.payload.layout).toEqual(layersWithOneFormation());
    // 예산제 폐지: 항상 0 을 신고한다(서버도 0 으로 덮어쓴다).
    expect(gw.insertCalls[0]!.payload.budgetSpent).toBe(DEFENSE_BUDGET_UNUSED);
    expect(DEFENSE_BUDGET_UNUSED).toBe(0);
  });

  it('활성 방어 있음 → UPDATE(layout 만, 정비도 리셋 회피), INSERT 미호출', async () => {
    const gw = new FakeDefenseGateway();
    gw.activeId = 'def-existing';
    const res = await uploadDefenseLayout(layersWithOneFormation(), { gateway: gw });
    expect(res).toBe('updated');
    expect(gw.updateCalls).toHaveLength(1);
    expect(gw.insertCalls).toHaveLength(0);
    expect(gw.updateCalls[0]!.defenseId).toBe('def-existing');
    expect(gw.updateCalls[0]!.layout).toEqual(layersWithOneFormation());
  });

  it('오류면 null(throw 안 함)', async () => {
    const gw = new FakeDefenseGateway();
    gw.fail = true;
    expect(await uploadDefenseLayout(emptyInvasionLayers(), { gateway: gw })).toBeNull();
  });

  it('동시 업로드 레이스: INSERT 유니크 위반 → 활성 행 재조회 → UPDATE 1회 재시도(업로드 유실 방지)', async () => {
    // 두 세션이 모두 활성 행 부재로 INSERT 를 시도, 늦은 쪽이 defenses_one_active_idx
    // 위반으로 실패하는 시나리오. 재조회 시엔 상대 세션이 만든 활성 행이 보인다.
    const gw = new FakeDefenseGateway();
    gw.activeId = null; // 1차 조회: 활성 행 없음 → insert 분기
    gw.insertDefense = async () => {
      gw.activeId = 'def-raced';
      throw new Error('duplicate key value violates unique constraint "defenses_one_active_idx"');
    };
    const res = await uploadDefenseLayout(layersWithOneFormation(), { gateway: gw });
    expect(res).toBe('updated'); // 유실 없이 상대 행에 반영
    expect(gw.updateCalls).toHaveLength(1);
    expect(gw.updateCalls[0]!.defenseId).toBe('def-raced');
  });

  it('INSERT 실패 + 재조회에도 활성 행 없음(레이스 아님) → null(원래 실패로 수렴)', async () => {
    const gw = new FakeDefenseGateway();
    gw.activeId = null;
    gw.insertDefense = async () => {
      throw new Error('network error');
    };
    expect(await uploadDefenseLayout(emptyInvasionLayers(), { gateway: gw })).toBeNull();
    expect(gw.updateCalls).toHaveLength(0); // 엉뚱한 UPDATE 재시도 없음
  });
});

// ---------------------------------------------------------------------------
// 슬롯 상한(서버 invasion_layers_valid 와 짝)
// ---------------------------------------------------------------------------

describe('net/defenseSync — 슬롯 초과 배치는 업로드 전에 잘린다', () => {
  async function uploadedLayers(raw: unknown): Promise<InvasionLayers> {
    const gw = new FakeDefenseGateway();
    gw.activeId = null;
    await uploadDefenseLayout(raw, { gateway: gw });
    return gw.insertCalls[0]!.payload.layout;
  }

  it('웨이브 슬롯 8개를 보내도 6개로 잘려 올라간다', async () => {
    const raw = {
      l1: { waveSlots: new Array(8).fill(SAMPLE_REF) },
      l2: { templateId: 0, sockets: [] },
      l3: {},
    };
    const sent = await uploadedLayers(raw);
    expect(sent.l1.waveSlots).toHaveLength(INVASION_WAVE_SLOTS);
    expect(sent.l1.waveSlots.every((s) => s !== null)).toBe(true);
  });

  it('소켓은 템플릿이 정한 길이로 맞춰진다(병목형 8)', async () => {
    const raw = {
      l1: {},
      l2: { templateId: MAP_TEMPLATE_CHOKE, sockets: new Array(20).fill(SAMPLE_REF) },
      l3: {},
    };
    const sent = await uploadedLayers(raw);
    expect(sent.l2.templateId).toBe(MAP_TEMPLATE_CHOKE);
    expect(sent.l2.sockets).toHaveLength(INVASION_SOCKET_COUNTS[MAP_TEMPLATE_CHOKE]!);
  });

  it('기물·모듈·수호 슬롯도 상한을 넘지 못한다', async () => {
    const raw = {
      l3: {
        props: new Array(9).fill(SAMPLE_REF),
        modules: new Array(5).fill(SAMPLE_REF),
        guardians: new Array(4).fill(SAMPLE_GUARDIAN),
      },
    };
    const sent = await uploadedLayers(raw);
    expect(sent.l3.props).toHaveLength(INVASION_PROP_SLOTS);
    expect(sent.l3.modules).toHaveLength(INVASION_CORE_MODULE_SLOTS);
    expect(sent.l3.guardians).toHaveLength(2);
  });

  it('빈 슬롯은 자리를 지킨다(밀집화 금지 — 슬롯 i ↔ 수호 i 매핑 보호)', async () => {
    const raw = {
      l1: { waveSlots: [null, SAMPLE_REF, null] },
      l3: { guardians: [null, SAMPLE_GUARDIAN] },
    };
    const sent = await uploadedLayers(raw);
    expect(sent.l1.waveSlots[0]).toBeNull();
    expect(sent.l1.waveSlots[1]).not.toBeNull();
    expect(sent.l3.guardians[0]).toBeNull();
    expect(sent.l3.guardians[1]).not.toBeNull();
  });

  it('손상 raw(문자열·null)도 total function 이라 빈 정규형으로 올라간다(throw 없음)', async () => {
    expect(await uploadedLayers('부서진 값')).toEqual(emptyInvasionLayers());
    expect(await uploadedLayers(null)).toEqual(emptyInvasionLayers());
  });

  it('정규형을 다시 올려도 같은 값(멱등) — 업로드 왕복이 배치를 흔들지 않는다', async () => {
    const once = await uploadedLayers(layersWithOneFormation());
    const twice = await uploadedLayers(once);
    expect(twice).toEqual(once);
    expect(twice).toEqual(normalizeInvasionLayers(once));
  });
});

// ---------------------------------------------------------------------------
// 예산제 폐지 회귀 가드
// ---------------------------------------------------------------------------

describe('net/defenseSync — 배치 포인트 예산제 폐지(결정 #14)', () => {
  it('defenseLayoutCost 미러가 소스에서 완전히 사라졌다', () => {
    // node:path 타입 셰이딩(tests/node-shims.d.ts)에 의존하지 않도록 URL 로 경로를 만든다.
    const srcUrl = new URL('../src/net/defenseSync.ts', import.meta.url);
    const src = new TextDecoder().decode(readFileSync(srcUrl.pathname.replace(/^\/([A-Za-z]:)/, '$1')));
    // 폐지된 서버 함수(defense_layout_cost)의 클라 미러가 남아 있으면, 이미 사라진 규칙을
    // UI 가 계속 강제해 정상 배치가 막힌다. 이름 자체를 금지어로 둔다.
    expect(src).not.toMatch(/defenseLayoutCost/);
    expect(src).not.toMatch(/TURRET_SPECS/);
    expect(src).not.toMatch(/OBSTACLE_COST/);
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
