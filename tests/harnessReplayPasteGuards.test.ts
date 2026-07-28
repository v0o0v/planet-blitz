/**
 * 붙여넣기 리플레이 방어 테스트 (`parseReplay` — 보안 리뷰 MEDIUM-1).
 *
 * 치트 패널의 [붙여넣기 재생]은 **밖에서 온 JSON** 을 sim 에 넣는 유일한 경로다. 정본 술어
 * `isPlayableReplay`(관전 경로와 공유)는 "seed 유한수 + inputs 비어있지 않은 배열"만 보므로
 * 다음 세 가지가 그대로 통과한다:
 *   ① 수천만 프레임 — `verifyReplay` 가 `runReplay` 를 **동기 루프**로 돌려 탭이 멈춘다
 *   ② `[null, null, …]` — 재생 루프(try/catch 없음)에서 매 프레임 throw
 *   ③ `config: 42` — 그대로 `createWorld` 로 들어간다
 * 이 파일은 셋을 하네스 쪽에서 막는다는 것과, **정본 술어는 그대로**라는 것(자기 런 리플레이가
 * 새 검사에 걸리지 않는다)을 동시에 못박는다.
 */

import { describe, it, expect } from 'vitest';
import { MAX_PASTED_REPLAY_TICKS, parseReplay, serializeReplay } from '../src/harness/replayStore.js';
import { isPlayableReplay } from '../src/ui/replaySpectate.js';
import { emptyInput } from '../src/sim/world.js';
import type { Replay } from '../src/sim/replay.js';

/** 정상 리플레이 1건(짧은 런). */
function sane(ticks: number): Replay {
  return { seed: 7, inputs: new Array(ticks).fill(emptyInput()) };
}

describe('parseReplay — 붙여넣기 입력 방어', () => {
  it('정상 리플레이는 그대로 통과한다(과잉 차단 아님)', () => {
    const parsed = parseReplay(serializeReplay(sane(600)));
    expect(parsed?.inputs.length).toBe(600);
  });

  it('상한 **정확히** 까지는 통과하고 한 틱 넘으면 거부한다', () => {
    // 배열을 실제로 만들지 않고 JSON 을 직접 조립한다(수십만 프레임 객체 생성 회피).
    const frame = JSON.stringify(emptyInput());
    const body = (n: number): string => `{"seed":7,"inputs":[${new Array(n).fill(frame).join(',')}]}`;
    expect(parseReplay(body(MAX_PASTED_REPLAY_TICKS))?.inputs.length).toBe(MAX_PASTED_REPLAY_TICKS);
    expect(parseReplay(body(MAX_PASTED_REPLAY_TICKS + 1))).toBeNull();
  });

  it('원소가 객체가 아니면 거부한다 — 정본 술어는 이걸 통과시킨다', () => {
    const junk = { seed: 7, inputs: [null, null, null] };
    // 결함의 실체: 정본 술어만으로는 막히지 않는다.
    expect(isPlayableReplay(junk)).toBe(true);
    expect(parseReplay(JSON.stringify(junk))).toBeNull();

    expect(parseReplay('{"seed":7,"inputs":[1,2,3]}')).toBeNull();
    expect(parseReplay('{"seed":7,"inputs":["a"]}')).toBeNull();
  });

  it('config 가 객체가 아니면 거부한다(createWorld 로 그대로 들어가는 값)', () => {
    const frame = JSON.stringify(emptyInput());
    expect(parseReplay(`{"seed":7,"inputs":[${frame}],"config":42}`)).toBeNull();
    expect(parseReplay(`{"seed":7,"inputs":[${frame}],"config":null}`)).toBeNull();
    // config 생략은 정상(관전이 DEFAULT_CONFIG 로 채운다).
    expect(parseReplay(`{"seed":7,"inputs":[${frame}]}`)).not.toBeNull();
  });

  it('어떤 입력에도 throw 하지 않는다', () => {
    for (const s of ['', 'null', '[]', '{}', 'not json', '{"seed":"x","inputs":[]}', '{"inputs":[]}']) {
      expect(() => parseReplay(s)).not.toThrow();
      expect(parseReplay(s)).toBeNull();
    }
  });
});
