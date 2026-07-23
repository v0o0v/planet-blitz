/**
 * 침공 리플레이 gzip 압축 왕복 검증 (ADR-0026 — 리플레이 압축 보존 + 48h TTL).
 *
 * EF(verify-invasion)가 검증 확정 후 replay jsonb 를 gzip → base64 로 접어 replay_gz(bytea)에
 * 저장하고, 관전 클라(invasionGateway.getInvasionReplay → decompressReplayGz)가 그 base64 를
 * 풀어 재생한다. 이 테스트는 압축(EF 대역, CompressionStream)→해제(클라 대역, decompressReplayGz)
 * 가 원본 Replay 와 JSON 동치인지를 왕복으로 강제한다 — 둘이 어긋나면 관전이 통째로 깨진다.
 *
 * EF 의 압축 헬퍼(supabase/functions/verify-invasion/index.ts gzipToBase64)는 Deno I/O 계층이라
 * vitest 에서 직접 import 하지 않고(파일이 jsr: 를 top-level import 한다), EF 와 **동일한 표준
 * API**(CompressionStream('gzip') + btoa)로 여기서 재현한다 — 압축 자체는 웹 표준이라 신뢰하고,
 * 왕복 계약(같은 gzip 을 클라가 풀 수 있는가)을 검증하는 것이 목적이다. 실제 로드 계약도 서버가
 * JSON.stringify(replay) 한 문자열을 클라가 JSON.parse 하므로, 비교 기준은 JSON 왕복 후 동치다.
 */

import { describe, it, expect } from 'vitest';
import { decompressReplayGz } from '../src/net/invasionGateway.js';
import type { Replay } from '../src/sim/replay.js';
import { DEFAULT_CONFIG, emptyInput } from '../src/sim/world.js';
import type { InputFrame } from '../src/sim/world.js';

/** EF(index.ts gzipToBase64)와 **동일 로직**: 문자열 → gzip → base64. */
async function gzipToBase64(text: string): Promise<string> {
  const input = new TextEncoder().encode(text);
  const compressed = new Response(input).body!.pipeThrough(new CompressionStream('gzip'));
  const buf = new Uint8Array(await new Response(compressed).arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function sampleReplay(seed: number, ticks: number): Replay {
  const inputs: InputFrame[] = [];
  for (let i = 0; i < ticks; i++) inputs.push(emptyInput());
  return { seed, inputs };
}

/** 실제 배선(서버 stringify → 클라 parse) 후 동치 비교의 기준값. */
function jsonRoundtrip<T>(v: T): unknown {
  return JSON.parse(JSON.stringify(v));
}

describe('decompressReplayGz — gzip base64 왕복(EF 압축 ↔ 클라 해제)', () => {
  it('작은 리플레이가 왕복 후 원본과 동일', async () => {
    const original = sampleReplay(7, 3);
    const b64 = await gzipToBase64(JSON.stringify(original));
    const restored = await decompressReplayGz(b64);
    expect(restored).toEqual(jsonRoundtrip(original));
  });

  it('config(로드아웃·행성 등) 포함 리플레이도 손실 없이 왕복', async () => {
    const original: Replay = {
      seed: 42,
      config: DEFAULT_CONFIG,
      inputs: [emptyInput(), { moveX: 1, moveY: -1, aim: 0.5, dash: true, special: 0 } as InputFrame],
    };
    const b64 = await gzipToBase64(JSON.stringify(original));
    const restored = await decompressReplayGz(b64);
    expect(restored).toEqual(jsonRoundtrip(original));
  });

  it('긴 입력 로그(수천 틱)도 손실 없이 왕복 — 압축이 실효(원본 JSON 보다 작음)', async () => {
    const original = sampleReplay(123, 5000);
    const json = JSON.stringify(original);
    const b64 = await gzipToBase64(json);
    const restored = await decompressReplayGz(b64);
    expect(restored).toEqual(jsonRoundtrip(original));
    // 반복 idle 입력이라 압축률이 높다 — base64 압축본이 원본 JSON 보다 확실히 작아야 한다.
    expect(b64.length).toBeLessThan(json.length);
  });

  it('base64 gzip 이 손상되면 해제 실패(호출부가 관전 불가로 안내)', async () => {
    await expect(decompressReplayGz('!!!not-valid-gzip!!!')).rejects.toBeDefined();
  });
});
