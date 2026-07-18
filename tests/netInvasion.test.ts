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
  INVASION_COOLDOWN_MS,
  type InvasionGateway,
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
import { DEFAULT_TIME_LIMIT_TICKS, type DefenseLayout } from '../src/sim/defense.js';
import type { KeyValueStore } from '../src/save/profile.js';
import { verifyInvasion } from '../supabase/functions/verify-invasion/verifyInvasionCore.js';
import type { InvasionServerContext } from '../supabase/functions/verify-invasion/verifyInvasionCore.js';
import type { CardInstance } from '../data/defenseCards.js';
import type { AttackerMatchup, DefenseCardConfig } from '../src/sim/cardEffects.js';

/** In-memory KeyValueStore(net.test.ts 와 동일). */
function memStore(seed?: Record<string, string>): KeyValueStore {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const SAMPLE_TARGET: InvasionTarget = {
  profileId: 'def-1',
  rank: 3,
  displayName: '적기지 알파',
  shipSummary: { name: '스팅어', level: 20 },
  defenseId: 'defense-1',
  layout: { core: { x: 400, y: 0 }, turrets: [], obstacles: [] },
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

function invasionConfig(layout: DefenseLayout, timeLimitTicks = DEFAULT_TIME_LIMIT_TICKS): WorldConfig {
  return { ...DEFAULT_CONFIG, invasion: { layout, timeLimitTicks } };
}

function idleReplay(ticks: number, layout: DefenseLayout, seed = 7): Replay {
  const inputs: InputFrame[] = [];
  for (let i = 0; i < ticks; i++) inputs.push(emptyInput());
  return { seed, config: invasionConfig(layout), inputs };
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
    const replay = idleReplay(3, SAMPLE_TARGET.layout as DefenseLayout);
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
    const replay = idleReplay(3, SAMPLE_TARGET.layout as DefenseLayout);
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
    const replay = idleReplay(3, SAMPLE_TARGET.layout as DefenseLayout);
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
  const layout: DefenseLayout = {
    core: { x: 900, y: 0 },
    turrets: [{ type: 0, x: 300, y: 0 }],
    obstacles: [{ x: 500, y: 0, halfW: 50, halfH: 50 }],
  };

  it('해시 스트림 길이 === 틱 수, finalTick 일치, attackerWon===coreDestroyed', () => {
    const replay = idleReplay(120, layout);
    const cr = buildClientResult(replay);
    expect(cr.hashStream).toHaveLength(120);
    expect(cr.finalTick).toBe(120);
    expect(cr.finalHash).toBe(cr.hashStream[cr.hashStream.length - 1]);
    expect(cr.coreDestroyed).toBe(cr.attackerWon);
  });

  it('같은 리플레이는 결정론적으로 동일 결과', () => {
    const replay = idleReplay(80, layout);
    expect(buildClientResult(replay)).toEqual(buildClientResult(replay));
  });

  it('코어 근접·무포탑이면 승리(coreDestroyed=true)로 수렴', () => {
    const winLayout: DefenseLayout = { core: { x: 380, y: 0 }, turrets: [], obstacles: [] };
    // 자동 조준으로 코어를 파괴할 만큼 충분히 긴 idle 런.
    const replay = idleReplay(6000, winLayout, 3);
    const cr = buildClientResult(replay);
    expect(cr.attackerWon).toBe(true);
    expect(cr.coreDestroyed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// M6 방어 카드: 클라 buildClientResult(스냅샷 card 재현) ↔ EF verifyInvasion 일치
// ---------------------------------------------------------------------------

describe('net/invasion — 방어 카드 스냅샷 재현 (M6 · ADR-0012)', () => {
  // begin_invasion 스냅샷 card 로 클라가 런한 결과(buildClientResult)를, EF 가 같은 서버 권위
  // card 로 재실행하면 hashStream 이 바이트 일치해 accept 된다(공/수 결정론 재현 고정). 이 테스트가
  // 클라 net 경로(runReplay 경유)와 EF 재실행이 카드 포함 침공에서 정합함을 함께 못박는다.
  // 승리(코어 파괴)로 종결되는 무포탑 배치 — 카드 기저 coreHpPct 가 코어 HP 를 키워 거동·해시를
  // 바꾸지만(카드 효력 실증), 종료 상태는 victory 로 수렴한다(outcome 매핑 victory XOR gameOver 성립).
  const layout: DefenseLayout = { core: { x: 380, y: 0 }, turrets: [], obstacles: [] };
  const matchup: AttackerMatchup = {
    fire: false, cold: false, lightning: false, beam: false,
    attackerCp: 0, defenderCp: 0, revenge: true, reinvasion: false, subweaponHeavy: false,
  };
  const card: CardInstance = {
    id: 'card-42', rarity: 'magic',
    prefixes: [{ id: 'cc-avenger', stat: 'turretDamagePct', value: 40 }],
    suffixes: [], chargesMax: 6, chargesLeft: 6, seed: 42,
  };
  const cardCfg: DefenseCardConfig = { card, matchup };

  function cardReplay(ticks: number): Replay {
    const inputs: InputFrame[] = [];
    for (let i = 0; i < ticks; i++) inputs.push(emptyInput());
    return {
      seed: 3,
      config: { ...invasionConfig(layout), invasion: { layout, timeLimitTicks: DEFAULT_TIME_LIMIT_TICKS, card: cardCfg } },
      inputs,
    };
  }

  it('buildClientResult 는 카드 포함 리플레이에서도 결정론적', () => {
    const replay = cardReplay(150);
    expect(buildClientResult(replay)).toEqual(buildClientResult(replay));
  });

  it('클라가 만든 결과를 EF 가 서버 권위 card 로 재실행하면 accept', () => {
    const replay = cardReplay(6000);
    const cr = buildClientResult(replay);
    expect(cr.attackerWon).toBe(true); // 종료 상태 victory(outcome 매핑 성립 전제)
    const submission = {
      seed: replay.seed,
      config: replay.config,
      inputs: replay.inputs,
      claim: {
        finalHash: cr.finalHash,
        hashStream: cr.hashStream,
        outcome: { victory: cr.attackerWon, gameOver: !cr.attackerWon },
      },
    };
    const ctx: InvasionServerContext = {
      layout,
      timeLimitTicks: DEFAULT_TIME_LIMIT_TICKS,
      card: cardCfg,
    };
    expect(verifyInvasion(submission, ctx).verdict).toBe('accept');
  });
});

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
