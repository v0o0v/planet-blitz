/**
 * **에코·조우 「활성」 술어**(`src/sim/objectiveState.ts`)의 계약 — 배치6.
 *
 * ## 왜 이 파일이 있는가
 * 이 술어 하나에 세 기체의 스킬이 걸린다(스트라이커 M7 · 팬텀 PH9 · 버블 DR7). 셋 다
 * 문면이 *"에코·조우가 활성인 동안"* 인데, 기존 리더(`echoStabilizedOf`·`encounterCompletedOf`)는
 * **완료** 판정이라 그것으로 대신하면 **효과가 끝난 뒤에야 켜진다.** 그 구분이 이 파일의 전부다.
 *
 * ## ⚠️ 상태 코드는 두 모듈의 선언 주석이 정본이다 — 여기서 다시 적지 마라
 *  - `EchoRuntime.state`: `0 대기 · 1 출현(안정화 진행) · 2 안정화 완료` (`echo.ts`)
 *  - `EncounterRuntime.state`: `0 대기 · 1 출현 · 2 진행중 · 3 완료 · 4 거부` (`encounter.ts`)
 * 전이 지점: 에코 `echo.ts:91`(→1) · `126`(→2) / 조우 `encounter.ts:337`(→1) · `365`(→4) ·
 * `encounterDetour.ts:138`(→2) · `220`(→3).
 *
 * ## ⚠️ 런타임을 **직접 조립**한다 — 롤을 기다리지 않는다
 * 에코·조우는 시드 롤로만 서고(`rollEcho`/`rollEncounter`), 특정 상태를 재현하려면 롤이 그
 * 값을 뽑을 때까지 시드를 찾아야 한다. 그건 이 술어가 아니라 롤을 재는 것이다. 여기서는
 * 상태 코드 전수(에코 0~2 · 조우 0~4)를 직접 세워 **술어 자체**만 잰다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import { echoActiveOf, encounterActiveOf, objectiveActiveOf } from '../src/sim/objectiveState.js';
import { echoStabilizedOf } from '../src/sim/echo.js';
import { encounterCompletedOf } from '../src/sim/encounter.js';

function world(): WorldState {
  return createWorld(0x0b1e, { ...DEFAULT_CONFIG });
}

/** 에코 런타임을 그 상태 코드로 세운다(나머지 칸은 술어가 안 본다). */
function withEcho(s: WorldState, state: number): WorldState {
  s.echoRuntime = { state, spawnTick: 0, dwell: 0, entityId: 0 };
  return s;
}

/** 조우 런타임을 그 상태 코드로 세운다. */
function withEncounter(s: WorldState, state: number): WorldState {
  s.encounterRuntime = {
    state,
    type: 1,
    spawnTick: 0,
    entityId: 0,
    inDetour: 0,
    savedX: 0,
    savedY: 0,
    detourTimer: 0,
    aux: 0,
  };
  return s;
}

describe('echoActiveOf — 출현(1)만 활성이다', () => {
  it('상태 코드 전수: 1 만 참이다', () => {
    for (const [code, want] of [
      [0, false], // 대기 — 아직 안 떴다
      [1, true], // 출현 · 안정화 진행 중
      [2, false], // 안정화 완료 — 활성이 아니다
    ] as const) {
      expect(echoActiveOf(withEcho(world(), code)), `state=${code}`).toBe(want);
    }
  });

  it('에코가 안 뜬 런은 항상 거짓이다 (`echoRuntime` 자체가 undefined)', () => {
    const s = world();
    s.echoRuntime = undefined;
    expect(echoActiveOf(s)).toBe(false);
  });

  it('⭐ 완료 리더와 **겹치지 않는다** — 이 분리가 세 스킬의 술어 전부다', () => {
    // 활성(1)일 때 완료는 거짓, 완료(2)일 때 활성은 거짓. 겹치면 "활성인 동안" 과
    // "완수 시" 가 같은 틱에 참이 되어 완수 보상이 두 번 나간다.
    const running = withEcho(world(), 1);
    expect(echoActiveOf(running)).toBe(true);
    expect(echoStabilizedOf(running)).toBe(false);

    const done = withEcho(world(), 2);
    expect(echoActiveOf(done)).toBe(false);
    expect(echoStabilizedOf(done)).toBe(true);
  });
});

describe('encounterActiveOf — 출현(1)과 진행중(2) 둘 다 활성이다', () => {
  it('상태 코드 전수: 1·2 만 참이다', () => {
    for (const [code, want] of [
      [0, false], // 대기
      [1, true], // 출현 — 필드에 서 있다
      [2, true], // 진행중(detour 안)
      [3, false], // 완료
      [4, false], // 거부 — 플레이어가 물러났다
    ] as const) {
      expect(encounterActiveOf(withEncounter(world(), code)), `state=${code}`).toBe(want);
    }
  });

  it('조우가 안 뜬 런은 항상 거짓이다', () => {
    const s = world();
    s.encounterRuntime = undefined;
    expect(encounterActiveOf(s)).toBe(false);
  });

  it('⭐ 완료 리더와 겹치지 않는다', () => {
    const running = withEncounter(world(), 2);
    expect(encounterActiveOf(running)).toBe(true);
    expect(encounterCompletedOf(running)).toBe(false);

    const done = withEncounter(world(), 3);
    expect(encounterActiveOf(done)).toBe(false);
    expect(encounterCompletedOf(done)).toBe(true);
  });
});

describe('objectiveActiveOf — 두 축의 OR 합류가 정본이다', () => {
  it('에코만 활성이어도 참이다', () => {
    const s = withEcho(world(), 1);
    s.encounterRuntime = undefined;
    expect(objectiveActiveOf(s)).toBe(true);
  });

  it('조우만 활성이어도 참이다', () => {
    const s = withEncounter(world(), 2);
    s.echoRuntime = undefined;
    expect(objectiveActiveOf(s)).toBe(true);
  });

  it('둘 다 활성이어도 참이다 (합류가 배타가 아니다)', () => {
    const s = withEncounter(withEcho(world(), 1), 1);
    expect(objectiveActiveOf(s)).toBe(true);
  });

  it('음성 대조: 둘 다 비활성이면 거짓이다 — 위 세 긍정이 항진이 아니다', () => {
    const s = withEncounter(withEcho(world(), 2), 3); // 둘 다 **완료**
    expect(echoActiveOf(s)).toBe(false);
    expect(encounterActiveOf(s)).toBe(false);
    expect(objectiveActiveOf(s)).toBe(false);
  });

  it('음성 대조: 아무것도 안 뜬 런은 거짓이다', () => {
    const s = world();
    s.echoRuntime = undefined;
    s.encounterRuntime = undefined;
    expect(objectiveActiveOf(s)).toBe(false);
  });
});

describe('leaf 계약 — 값 import 가 0건이다 (순환 금지)', () => {
  it('`objectiveState.ts` 는 `WorldState` 를 type-only 로만 본다', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const src = readFileSync(resolve(repo, 'src/sim/objectiveState.ts'), 'utf8');
    const imports = [...src.matchAll(/^import\s+(type\s+)?.*$/gm)].map((m) => m[0]);
    // ⚠️ 값 import 가 하나라도 생기면 `skills/<기체>.ts → objectiveState → …` 경로로
    //    런타임 순환이 열릴 수 있다. 그 결함은 **클라에서 재현 안 되고 검증 EF 에서만 터진다**
    //    (배치4 실측). `build` 통과·테스트 무경고는 그 부재를 증명하지 않으므로 여기서 잠근다.
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) {
      expect(line, `값 import 가 생겼다: ${line}`).toMatch(/^import\s+type\s/);
    }
  });
});
