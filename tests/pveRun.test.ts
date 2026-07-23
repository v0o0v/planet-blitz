import { describe, it, expect } from 'vitest';
import { buildPveRunResult } from '../src/net/pveRun.js';
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

// ADR-0026: PvE 리플레이 업로드(pve_runs)·샘플링 재검증은 폐기됐다(재화 서버 권위로 이관). 따라서
// `recordPveRun`/`insertPveRun` 배선 테스트는 제거했다. `buildPveRunResult` 는 리플레이 재실행의
// 결정론 계약(hashStream)을 문서화하는 순수 함수로 남겨 두고 여기서 계속 못박는다.
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
