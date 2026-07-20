/**
 * 침공 네트워크 계층 테스트 (src/net/invasion.ts — M4 Phase D3).
 *
 * 커버리지:
 *   1. no-op 모드(config=null): 공개 함수가 null 을 돌려주고 SDK/네트워크를 만지지 않음.
 *   2. fake 게이트웨이 주입: 타깃/순위표 조회, 침공 제출 플로우(uid→insert→invoke)와
 *      쿨다운 미러 기록.
 *   3. buildClientResult: 결정론 · 해시 스트림 길이 · 승패 파생.
 *   4. 재도전 쿨다운 순수 함수(읽기/기록/남은시간/가능여부).
 */

import { describe, it, expect } from 'vitest';
import {
  fetchInvasionTargets,
  fetchLadder,
  submitInvasion,
  buildClientResult,
  readInvasionCooldowns,
  recordInvasionAttempt,
  cooldownRemainingMs,
  canInvadeTarget,
  historyIWon,
  beginInvasion,
  INVASION_COOLDOWN_MS,
  type InvasionGateway,
  type InvasionSnapshot,
  type InvasionTarget,
  type LadderEntry,
  type InvasionVerdict,
  type InvasionSubmitInput,
} from '../src/net/invasion.js';
import { DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldConfig } from '../src/sim/world.js';
import type { Replay } from '../src/sim/replay.js';
import { emptyInput } from '../src/sim/world.js';
import type { InputFrame } from '../src/sim/world.js';
import type { KeyValueStore } from '../src/save/profile.js';
// EF 재실행 대조(verifyInvasion/InvasionServerContext)는 3레이어 전환으로 입력 계약이 바뀌어
// tests/verifyInvasion.test.ts 가 정본으로 커버한다 — 여기서는 더 이상 import 하지 않는다.
import {
  layersEqual,
  normalizeInvasionLayers,
  SAMPLE_GUARDIAN,
  SAMPLE_REF,
} from '../src/sim/invasion/normalize.js';
import type { InvasionLayers } from '../src/sim/invasion/types.js';
import { INVASION_CORE_MODULE_SLOTS, INVASION_TOTAL_TICKS } from '../src/sim/invasion/constants.js';
import { normalizeModulesAuthority } from '../src/net/invasionGateway.js';

/** In-memory KeyValueStore(net.test.ts 와 동일). */
function memStore(seed?: Record<string, string>): KeyValueStore {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** 침공 런에 실을 3레이어 표본 배치(빈 슬롯은 기본 수비대가 스폰 단계에서 충원한다). */
const SAMPLE_LAYERS: InvasionLayers = normalizeInvasionLayers({
  l1: { waveSlots: [SAMPLE_REF, null, null, null, null, null] },
  l2: { templateId: 0, sockets: [SAMPLE_REF, null, null, null, null, null] },
  l3: { boss: SAMPLE_REF, guardians: [null, null], props: [SAMPLE_REF] },
});

const SAMPLE_TARGET: InvasionTarget = {
  profileId: 'def-1',
  rank: 3,
  displayName: '적기지 알파',
  shipSummary: { name: '스팅어', level: 20 },
  defenseId: 'defense-1',
  layout: SAMPLE_LAYERS,
  maintenance: 88,
};

/** 조회/제출 검증용 fake 게이트웨이. 호출을 기록하고 실패를 시뮬레이션한다. */
class FakeInvasionGateway implements InvasionGateway {
  uid = 'attacker-1';
  targets: InvasionTarget[] = [SAMPLE_TARGET];
  ladderRows: LadderEntry[] = [{ profileId: 'p1', rank: 1, wins: 5, losses: 2 }];
  verdict: InvasionVerdict = {
    status: 'verified',
    attackerWon: true,
    ladder: { attackerRank: 3, defenderRank: 4 },
    loot: [{ itemId: 'x', rarity: 2 }],
  };
  lastSubmit: InvasionSubmitInput | null = null;
  fail = false;

  async getUserId(): Promise<string> {
    if (this.fail) throw new Error('offline');
    return this.uid;
  }
  async getInvasionTargets(): Promise<InvasionTarget[]> {
    if (this.fail) throw new Error('offline');
    return this.targets;
  }
  async fetchLadder(limit: number): Promise<LadderEntry[]> {
    if (this.fail) throw new Error('offline');
    return this.ladderRows.slice(0, limit);
  }
  async submitInvasion(input: InvasionSubmitInput): Promise<InvasionVerdict> {
    if (this.fail) throw new Error('offline');
    this.lastSubmit = input;
    return this.verdict;
  }
}

function invasionConfig(layers: InvasionLayers, timeLimitTicks = INVASION_TOTAL_TICKS): WorldConfig {
  return { ...DEFAULT_CONFIG, invasion3: { layers, timeLimitTicks } };
}

function idleReplay(ticks: number, layers: InvasionLayers, seed = 7): Replay {
  const inputs: InputFrame[] = [];
  for (let i = 0; i < ticks; i++) inputs.push(emptyInput());
  return { seed, config: invasionConfig(layers), inputs };
}

// ---------------------------------------------------------------------------
// no-op 모드
// ---------------------------------------------------------------------------

describe('net/invasion — no-op 모드(미설정)', () => {
  it('config=null 이면 fetchInvasionTargets 는 null', async () => {
    expect(await fetchInvasionTargets({ config: null })).toBeNull();
  });
  it('config=null 이면 fetchLadder 는 null', async () => {
    expect(await fetchLadder(10, { config: null })).toBeNull();
  });
  it('config=null 이면 submitInvasion 은 null(제출 안 함)', async () => {
    const store = memStore();
    const replay = idleReplay(3, SAMPLE_LAYERS);
    const clientResult = buildClientResult(replay);
    const res = await submitInvasion(
      { target: SAMPLE_TARGET, replay, clientResult },
      { config: null, store },
    );
    expect(res).toBeNull();
    // 쿨다운도 기록되지 않는다(제출 성립 안 함).
    expect(readInvasionCooldowns(store)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// fake 게이트웨이
// ---------------------------------------------------------------------------

describe('net/invasion — 조회(fake 게이트웨이)', () => {
  it('fetchInvasionTargets 는 게이트웨이 행을 그대로 반환', async () => {
    const gw = new FakeInvasionGateway();
    expect(await fetchInvasionTargets({ gateway: gw })).toEqual(gw.targets);
  });
  it('fetchLadder 는 limit 을 전달', async () => {
    const gw = new FakeInvasionGateway();
    gw.ladderRows = [
      { profileId: 'a', rank: 1, wins: 0, losses: 0 },
      { profileId: 'b', rank: 2, wins: 0, losses: 0 },
    ];
    expect(await fetchLadder(1, { gateway: gw })).toHaveLength(1);
  });
  it('오류면 null(throw 안 함)', async () => {
    const gw = new FakeInvasionGateway();
    gw.fail = true;
    expect(await fetchInvasionTargets({ gateway: gw })).toBeNull();
    expect(await fetchLadder(5, { gateway: gw })).toBeNull();
  });
});

describe('net/invasion — 제출 플로우(fake 게이트웨이)', () => {
  it('uid·defender·defense 를 넘겨 제출하고 판정을 반환 + 쿨다운 기록', async () => {
    const gw = new FakeInvasionGateway();
    const store = memStore();
    const replay = idleReplay(3, SAMPLE_LAYERS);
    const clientResult = buildClientResult(replay);
    const before = Date.now();
    const res = await submitInvasion({ target: SAMPLE_TARGET, replay, clientResult }, { gateway: gw, store });
    expect(res).toEqual(gw.verdict);
    expect(gw.lastSubmit).not.toBeNull();
    expect(gw.lastSubmit!.attackerId).toBe('attacker-1');
    expect(gw.lastSubmit!.defenderId).toBe(SAMPLE_TARGET.profileId);
    expect(gw.lastSubmit!.defenseId).toBe(SAMPLE_TARGET.defenseId);
    expect(gw.lastSubmit!.clientResult).toBe(clientResult);
    // 쿨다운 미러가 기록됐다(대상 profileId 기준, 방금 시각).
    const cd = readInvasionCooldowns(store);
    expect(cd[SAMPLE_TARGET.profileId]).toBeGreaterThanOrEqual(before);
  });

  it('제출 실패면 null(쿨다운 미기록)', async () => {
    const gw = new FakeInvasionGateway();
    gw.fail = true;
    const store = memStore();
    const replay = idleReplay(3, SAMPLE_LAYERS);
    const res = await submitInvasion(
      { target: SAMPLE_TARGET, replay, clientResult: buildClientResult(replay) },
      { gateway: gw, store },
    );
    expect(res).toBeNull();
    expect(readInvasionCooldowns(store)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// normalizeVerdict — EF 응답 정규화(attacker_won 실값/null 정합, 리드 지적)
// ---------------------------------------------------------------------------

describe('net/invasionGateway — normalizeVerdict(attackerWon null 보존)', () => {
  it('boolean 실값은 그대로(true/false)', async () => {
    const { normalizeVerdict } = await import('../src/net/invasionGateway.js');
    expect(normalizeVerdict({ status: 'verified', attackerWon: true, ladder: null, loot: [] }).attackerWon).toBe(true);
    expect(normalizeVerdict({ status: 'verified', attackerWon: false, ladder: null, loot: [] }).attackerWon).toBe(false);
  });

  it('null/부재는 false 로 강제하지 않고 null(판정 확정 중) 보존 — 확정 승리 오표시 방지', async () => {
    const { normalizeVerdict } = await import('../src/net/invasionGateway.js');
    // EF already-finalized 재조회 형태: status 는 확정값인데 attackerWon 이 null 일 수 있다.
    expect(normalizeVerdict({ status: 'verified', attackerWon: null, ladder: null, loot: [] }).attackerWon).toBeNull();
    expect(normalizeVerdict({ status: 'verified' }).attackerWon).toBeNull();
  });

  it('ladder·loot 방어적 파싱(형태 불량은 null/[])', async () => {
    const { normalizeVerdict } = await import('../src/net/invasionGateway.js');
    const v = normalizeVerdict({
      status: 'verified',
      attackerWon: true,
      ladder: { attackerRank: 3, defenderRank: 4 },
      loot: [{ itemId: 'x' }],
    });
    expect(v.ladder).toEqual({ attackerRank: 3, defenderRank: 4 });
    expect(v.loot).toHaveLength(1);
    const bad = normalizeVerdict({ status: 'weird', ladder: { attackerRank: 'x' }, loot: 'nope' });
    expect(bad.status).toBe('rejected');
    expect(bad.ladder).toBeNull();
    expect(bad.loot).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildClientResult
// ---------------------------------------------------------------------------

describe('net/invasion — buildClientResult(결정론·해시 스트림)', () => {
  it('해시 스트림 길이 === 틱 수, finalTick 일치, attackerWon===coreDestroyed', () => {
    const replay = idleReplay(120, SAMPLE_LAYERS);
    const cr = buildClientResult(replay);
    expect(cr.hashStream).toHaveLength(120);
    expect(cr.finalTick).toBe(120);
    expect(cr.finalHash).toBe(cr.hashStream[cr.hashStream.length - 1]);
    expect(cr.coreDestroyed).toBe(cr.attackerWon);
  });

  it('같은 리플레이는 결정론적으로 동일 결과', () => {
    const replay = idleReplay(80, SAMPLE_LAYERS);
    expect(buildClientResult(replay)).toEqual(buildClientResult(replay));
  });

  it('배치가 다르면 결과 해시가 갈린다(배치가 런에 실제로 실린다)', () => {
    // 구 판은 "코어 근접·무포탑 idle 런이 승리로 수렴"을 봤다. 3레이어에서는 코어가 **L3**에
    // 있어 idle 로 도달하려면 1만 틱을 넘겨야 하고(그마저 레벨업 프리즈로 멈춘다), 승리 경로는
    // tests/invasion.test.ts(L3 코어 파괴)·tests/invasionIntegration.test.ts 가 정본으로 본다.
    // 여기서 net 계층이 보장할 것은 "제출용 결과가 배치를 반영하는가" 하나다.
    const other = normalizeInvasionLayers({
      l1: { waveSlots: [SAMPLE_REF, SAMPLE_REF, null, null, null, null] },
      l2: { templateId: 2, sockets: [SAMPLE_REF] },
      l3: { boss: null, guardians: [SAMPLE_GUARDIAN, null], props: [] },
    });
    const a = buildClientResult(idleReplay(120, SAMPLE_LAYERS));
    const b = buildClientResult(idleReplay(120, other));
    expect(a.finalHash).not.toBe(b.finalHash);
  });
});

// ▮ 삭제한 describe: "net/invasion — 방어 카드 스냅샷 재현 (M6 · ADR-0012)"
//   구 `WorldConfig.invasion.card`(방어 카드) 입력 자체가 L11 에서 사라졌다. 카드는 M7b 에서
//   **코어 모듈**로 개명·재설계되며(`Invasion3Config` 에는 아직 모듈 필드가 없다), 그 스냅샷
//   재현 검증은 M7b-core-modules 레인이 새 어휘로 다시 세운다. 폐기된 입력 계약을 억지로
//   살려 두면 테스트가 죽은 스키마를 고착시킨다.

// ---------------------------------------------------------------------------
// 재도전 쿨다운(순수)
// ---------------------------------------------------------------------------

describe('net/invasion — 재도전 쿨다운 미러(순수)', () => {
  it('기록→읽기 라운드트립 + last-write-wins', () => {
    const store = memStore();
    expect(readInvasionCooldowns(store)).toEqual({});
    recordInvasionAttempt(store, 'def-1', 1000);
    recordInvasionAttempt(store, 'def-2', 2000);
    expect(readInvasionCooldowns(store)).toEqual({ 'def-1': 1000, 'def-2': 2000 });
    recordInvasionAttempt(store, 'def-1', 5000); // 덮어씀
    expect(readInvasionCooldowns(store)['def-1']).toBe(5000);
  });

  it('손상 blob 은 빈 맵으로 회복', () => {
    const store = memStore({ 'planet-blitz:net:invasionCooldowns': 'not-json' });
    expect(readInvasionCooldowns(store)).toEqual({});
  });

  it('cooldownRemainingMs: 경과분만큼 감소, 지나면 0', () => {
    const cd = { 'def-1': 1000 };
    expect(cooldownRemainingMs(cd, 'def-1', 1000)).toBe(INVASION_COOLDOWN_MS);
    expect(cooldownRemainingMs(cd, 'def-1', 1000 + INVASION_COOLDOWN_MS / 2)).toBe(INVASION_COOLDOWN_MS / 2);
    expect(cooldownRemainingMs(cd, 'def-1', 1000 + INVASION_COOLDOWN_MS)).toBe(0);
    expect(cooldownRemainingMs(cd, 'def-1', 1000 + INVASION_COOLDOWN_MS + 5)).toBe(0); // 음수 안 나옴
    expect(cooldownRemainingMs(cd, 'unknown', 999999)).toBe(0); // 기록 없음
  });

  it('canInvadeTarget: 쿨다운 중 false, 지나면 true', () => {
    const cd = { 'def-1': 1000 };
    expect(canInvadeTarget(cd, 'def-1', 1500)).toBe(false);
    expect(canInvadeTarget(cd, 'def-1', 1000 + INVASION_COOLDOWN_MS)).toBe(true);
    expect(canInvadeTarget(cd, 'never-attacked', 0)).toBe(true);
  });
});

describe('전투 기록 승패 해석(historyIWon)', () => {
  const base = {
    invasionId: 'inv-1',
    opponentId: 'other',
    status: 'verified' as const,
    atMs: 0,
  };

  it('공격 기록은 공격자 승이 곧 내 승', () => {
    expect(historyIWon({ ...base, attacking: true, attackerWon: true })).toBe(true);
    expect(historyIWon({ ...base, attacking: true, attackerWon: false })).toBe(false);
  });

  it('방어 기록은 뒤집힌다 — 공격자가 졌으면 내가 이긴 것', () => {
    expect(historyIWon({ ...base, attacking: false, attackerWon: false })).toBe(true);
    expect(historyIWon({ ...base, attacking: false, attackerWon: true })).toBe(false);
  });

  it('서버 미확정(null)은 패배로 강제하지 않고 null 을 유지한다', () => {
    expect(historyIWon({ ...base, attacking: true, attackerWon: null })).toBeNull();
    expect(historyIWon({ ...base, attacking: false, attackerWon: null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// M7a — 3레이어 스냅샷 계약 (L7-db-net)
// ---------------------------------------------------------------------------
// 게이트웨이가 서버 jsonb(begin_invasion 의 layers/modules)를 클라 정규형으로 되돌리는
// 경로를 고정한다. 여기가 어긋나면 정직한 런이 전량 defense-mismatch 로 오거부된다.

describe('net/invasion — 3레이어 스냅샷 계약(M7a)', () => {
  it('jsonb 왕복(JSON 직렬화) 후에도 layers 정규형이 바이트 동일', () => {
    const layers = normalizeInvasionLayers({
      l1: { waveSlots: [SAMPLE_REF, null, null, null, null, null] },
      l2: { templateId: 1, sockets: [SAMPLE_REF] },
      l3: { boss: SAMPLE_REF, guardians: [SAMPLE_GUARDIAN, null], props: [SAMPLE_REF] },
    });
    const roundTrip = normalizeInvasionLayers(JSON.parse(JSON.stringify(layers)) as unknown);
    expect(roundTrip).toEqual(layers);
    expect(layersEqual(roundTrip, layers)).toBe(true);
  });

  it('beginInvasion: 미설정이면 null(no-op — throw 금지 규율 유지)', async () => {
    expect(await beginInvasion('defense-1', { config: null })).toBeNull();
    expect(await beginInvasion('', { config: null })).toBeNull();
  });

  it('beginInvasion: 게이트웨이 스냅샷의 layers·modules 를 그대로 전달한다', async () => {
    const layers = normalizeInvasionLayers({ l1: { waveSlots: [SAMPLE_REF] } });
    const snap: InvasionSnapshot = {
      snapshotId: 'snap-1',
      layers,
      layout: layers,
      maintenance: 91,
      modules: { slots: [SAMPLE_REF, null], matchup: { revenge: true } },
    };
    const gateway = {
      getUserId: async () => 'me',
      getInvasionTargets: async () => [],
      fetchLadder: async () => [],
      submitInvasion: async () => {
        throw new Error('사용 안 함');
      },
      beginInvasion: async () => snap,
    } as unknown as InvasionGateway;
    const got = await beginInvasion('defense-1', { gateway });
    expect(got?.snapshotId).toBe('snap-1');
    expect(got?.layers).toEqual(layers);
    expect(got?.modules?.slots).toHaveLength(2);
  });

  it('beginInvasion: 게이트웨이가 throw 하면 null(라이브 경로 폴백)', async () => {
    const gateway = {
      beginInvasion: async () => {
        throw new Error('자격 미달');
      },
    } as unknown as InvasionGateway;
    expect(await beginInvasion('defense-1', { gateway })).toBeNull();
  });
});

describe('net/invasionGateway — 코어 모듈 권위 파싱(normalizeModulesAuthority)', () => {
  it('modules 키가 없거나 손상이면 null(모듈 없음)', () => {
    expect(normalizeModulesAuthority(null)).toBeNull();
    expect(normalizeModulesAuthority(undefined)).toBeNull();
    expect(normalizeModulesAuthority('부서진 값')).toBeNull();
  });

  it('슬롯은 고정 길이 2 로 복원되고 빈 슬롯이 자리를 지킨다(밀집화 금지)', () => {
    const got = normalizeModulesAuthority({ slots: [null, SAMPLE_REF], matchup: {} });
    expect(got?.slots).toHaveLength(INVASION_CORE_MODULE_SLOTS);
    expect(got?.slots[0]).toBeNull();
    expect(got?.slots[1]).toEqual(SAMPLE_REF);
  });

  it('슬롯 초과분은 잘리고 부족분은 null 로 채워진다', () => {
    const many = normalizeModulesAuthority({ slots: [SAMPLE_REF, SAMPLE_REF, SAMPLE_REF] });
    expect(many?.slots).toHaveLength(INVASION_CORE_MODULE_SLOTS);
    const few = normalizeModulesAuthority({ slots: [] });
    expect(few?.slots).toEqual([null, null]);
  });

  it('matchup 은 서버 권위 값을 그대로 보존한다(정적 카운터 판정 입력)', () => {
    const got = normalizeModulesAuthority({ slots: [], matchup: { revenge: true, attackerCp: 12 } });
    expect(got?.matchup).toEqual({ revenge: true, attackerCp: 12 });
  });
});
