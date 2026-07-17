import { describe, it, expect } from 'vitest';
import { buildPveRunResult, type PveRunResult } from '../src/net/pveRun.js';
import { recordPveRun } from '../src/net/index.js';
import type { ServerGateway } from '../src/net/gateway.js';
import type { ServerProfile } from '../src/net/profileSync.js';
import { runReplay, type Replay } from '../src/sim/replay.js';
import { emptyInput, type InputFrame } from '../src/sim/world.js';

/** 결정론 입력 로그(시드 무관하게 재현 가능한 스티어링). */
function buildInputs(n: number): InputFrame[] {
  const out: InputFrame[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ ...emptyInput(), moveX: Math.sin(i / 30), moveY: Math.cos(i / 40), aim: (i / 20) % 6.28 });
  }
  return out;
}

function sampleReplay(): Replay {
  return { seed: 12345, inputs: buildInputs(180) };
}

/** insertPveRun 을 기록하는 fake 게이트웨이(네트워크 없이). */
class FakePveGateway implements ServerGateway {
  uid = 'uid-pve';
  inserts: { replay: Replay; clientResult: PveRunResult }[] = [];
  failAll = false;
  hasInsert: boolean;
  constructor(hasInsert = true) {
    this.hasInsert = hasInsert;
    if (!hasInsert) {
      // 구버전 게이트웨이 시뮬레이션: insertPveRun 미구현.
      (this as { insertPveRun?: unknown }).insertPveRun = undefined;
    }
  }
  async getUserId(): Promise<string> {
    if (this.failAll) throw new Error('offline');
    return this.uid;
  }
  async fetchProfile(): Promise<ServerProfile | null> {
    return null;
  }
  async upsertProfile(): Promise<void> {}
  async insertPveRun(
    _uid: string,
    payload: { replay: Replay; clientResult: PveRunResult },
  ): Promise<void> {
    if (this.failAll) throw new Error('offline');
    this.inserts.push(payload);
  }
}

describe('pveRun — buildPveRunResult(순수·결정론)', () => {
  it('리플레이 재실행 결과(승패·해시 스트림)를 담고, hashStream 길이 === finalTick', () => {
    const replay = sampleReplay();
    const result = buildPveRunResult(replay);
    const direct = runReplay(replay);
    expect(result.finalHash).toBe(direct.finalHash);
    expect(result.finalTick).toBe(replay.inputs.length);
    expect(result.hashStream.length).toBe(replay.inputs.length);
    expect(result.hashStream).toEqual(direct.hashes);
    expect(result.victory).toBe(direct.finalState.victory);
    expect(result.gameOver).toBe(direct.finalState.gameOver);
  });

  it('동일 리플레이면 항상 동일 결과(결정론 — 서버 재실행 대조 정합)', () => {
    const a = buildPveRunResult(sampleReplay());
    const b = buildPveRunResult(sampleReplay());
    expect(a).toEqual(b);
  });
});

describe('net/index — recordPveRun 배선', () => {
  it('설정 게이트웨이가 있으면 pending 증거를 insert 한다(해시 스트림 계약 유지)', async () => {
    const gw = new FakePveGateway();
    const replay = sampleReplay();
    await recordPveRun(replay, { gateway: gw });
    expect(gw.inserts.length).toBe(1);
    expect(gw.inserts[0]!.replay).toEqual(replay);
    expect(gw.inserts[0]!.clientResult.hashStream.length).toBe(replay.inputs.length);
  });

  it('미설정(config=null)이면 완전 no-op(SDK 미로드)', async () => {
    // gateway 주입 없이 config=null → resolveGateway 가 null → insert 안 함(throw 도 안 함).
    await expect(recordPveRun(sampleReplay(), { config: null })).resolves.toBeUndefined();
  });

  it('게이트웨이가 insertPveRun 미구현(구버전)이면 no-op', async () => {
    const gw = new FakePveGateway(false);
    await expect(recordPveRun(sampleReplay(), { gateway: gw })).resolves.toBeUndefined();
    expect(gw.inserts.length).toBe(0);
  });

  it('오프라인/오류는 삼키고 throw 하지 않는다', async () => {
    const gw = new FakePveGateway();
    gw.failAll = true;
    await expect(recordPveRun(sampleReplay(), { gateway: gw })).resolves.toBeUndefined();
    expect(gw.inserts.length).toBe(0);
  });
});
