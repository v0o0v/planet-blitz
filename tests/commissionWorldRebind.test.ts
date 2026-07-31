/**
 * A-4b — **월드 참조를 스텝 루프 밖에 캐시하지 않는다** (PA 레인 계약 §6-2).
 *
 * ## 왜 소스 grep 인가 — 자인한다
 * `stepRun` 이 새 월드를 반환하므로, 루프 앞에서 잡아 둔 참조는 구간 전환 직후 **죽은 월드**를
 * 가리킨다. 그런데 그 상태는 **타입으로 표현할 방법이 없다** — 죽은 월드도 완벽하게 유효한
 * `WorldState` 이고, 읽어도 예외가 안 난다. 증상은 오직 행동으로만 나타난다:
 *  - `main.ts` 티커: 정산이 마지막 구간이 아니라 **1구간 월드**로 돌아 전리품·XP 가 사라진다.
 *  - 하네스 `ff`: 종료 판정이 영영 false 라 지정한 틱을 다 헛돈다.
 * 둘 다 조용하다. 그래서 계약 §6-2 가 지정한 대로 **grep 게이트**로 간다.
 *
 * ## 이 테스트의 진단력
 * 각 호출부의 재조회를 되돌리면(=루프 밖 바인딩으로 회귀) 해당 단언이 실패한다. 주석이 아니라
 * **코드**를 본다 — 주석만 남기고 코드를 지우는 것으로는 통과할 수 없다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function src(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
}

/** `from` 다음부터 `to` 직전까지의 구간. 앵커가 없으면 던진다(앵커 드리프트를 실패로 만든다). */
function between(text: string, from: string, to: string): string {
  const a = text.indexOf(from);
  if (a < 0) throw new Error(`앵커를 찾지 못했다: ${from}`);
  const b = text.indexOf(to, a + from.length);
  if (b < 0) throw new Error(`앵커를 찾지 못했다: ${to}`);
  return text.slice(a + from.length, b);
}

/** 줄 단위로 주석(`//`)을 제거한다 — 주석 속 문구가 게이트를 통과시키면 그건 게이트가 아니다. */
function stripComments(text: string): string {
  return text
    .split('\n')
    .map((l) => {
      const i = l.indexOf('//');
      return i < 0 ? l : l.slice(0, i);
    })
    .join('\n');
}

describe('main.ts 티커 — 캐치업 루프 안·뒤에서 월드를 재조회한다', () => {
  const main = stripComments(src('src/main.ts'));

  it('캐치업 루프 **안**에서 world 를 다시 읽는다 (조준 샘플이 죽은 월드를 보면 안 된다)', () => {
    const body = between(main, 'while (accumulator >= DT) {', 'ceremony.notice(currSnap);');
    expect(body, '캐치업 루프 안에 world 재조회가 없다').toMatch(/=\s*world;/);
  });

  it('캐치업 루프 **뒤**에서 world 를 재조회한다 (정산이 죽은 월드로 돌면 전리품이 사라진다)', () => {
    const after = between(main, '} else if (w === null || runOver) {', 'tutorialOverlay.update(');
    expect(after, '스텝 블록 이후 월드 재조회가 없다').toMatch(/\bw\s*=\s*world;/);
  });

  it('`stepWorld` 를 직접 부르지 않는다 (전진 경로는 `stepRun` 하나다)', () => {
    expect(main).not.toMatch(/\bstepWorld\s*\(/);
  });

  it('`stepOnce` 가 `stepRun` 의 반환값을 `world` 에 다시 대입한다', () => {
    const body = between(main, 'function stepOnce(input: InputFrame): void {', 'function endRun');
    expect(body).toMatch(/world\s*=\s*/);
    expect(body).toMatch(/stepRun\(/);
  });
});

describe('harness/core.ts — ff/step 은 루프 **안**에서 host.getWorld() 를 재조회한다', () => {
  const core = stripComments(src('src/harness/core.ts'));

  it('ff', () => {
    const body = between(core, 'for (let i = 0; i < ticks; i++) {', 'host.stepOnce(input)');
    expect(body, 'ff 루프 안에 host.getWorld() 재조회가 없다').toMatch(/host\.getWorld\(\)/);
  });

  it('step', () => {
    const body = between(core, 'for (let i = 0; i < n; i++) {', 'host.stepOnce(host.sampleInput())');
    expect(body, 'step 루프 안에 host.getWorld() 재조회가 없다').toMatch(/host\.getWorld\(\)/);
  });
});

describe('replay.ts — runReplay 는 루프 변수를 갱신한다', () => {
  const replay = stripComments(src('src/sim/replay.ts'));

  it('월드 바인딩이 `let` 이고 루프 안에서 재대입된다', () => {
    const body = between(replay, 'export function runReplay(replay: Replay)', 'return { finalState');
    expect(body).toMatch(/let\s+state\s*=/);
    expect(body).toMatch(/state\s*=\s*stepRun\(/);
  });
});
