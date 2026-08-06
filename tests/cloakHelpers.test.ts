/**
 * E1 — 팬텀 은신 사이클 헬퍼의 **계약 테스트** (ADR-0049 선결, `phantom.md` ①).
 *
 * 이 커밋이 한 일은 둘이다: ①진입 판정을 `aux0 === 240` **정확 일치**에서 **통과 판정**으로
 * 승격 ②배율 토큰(`aux1`) 쓰기를 `setBreakToken` 한 경로로 모음. 둘 다 **값은 비트 동일**이라
 * 골든이 안 움직인다 — 그래서 골든은 이 변경을 증명하지 못하고, 여기서 직접 잠근다.
 *
 * ## 왜 통과 판정인가 (구현 고지 ④)
 * 자연 적립은 항상 `+1` 이라 두 판정이 같은 틱에 발화한다. 값이 갈리는 것은 **카운터를 여러
 * 칸 올리는 주입**이 생길 때이고, 그때 `===` 는 임계를 건너뛴 틱에 진입을 **영영 안 세운다** —
 * 토큰(2.5배)과 진입 훅이 통째로 죽는데 화면에도 테스트에도 흔적이 없다. 팬텀 설계가 실제로
 * 이 사유로 반려된 이력이 있어, 주입 스킬이 오기 **전에** 판정부터 승격해 둔다.
 *
 * ## 이 파일이 다루지 않는 것 (의도적)
 *  · `setBreakToken` 의 **침공 no-op** — 이 커밋에서 이월했다. 해시를 움직이는 변경이고,
 *    바깥 겹(소진 지점 게이트, E2)은 `tests/phantomCloakInvasionGate.test.ts` 가 이미 잠근다.
 *  · `advanceCloak` — 소비자(주입 스킬)가 없어 만들지 않았다. `activeHandlers/phantom.ts` 의
 *    `as_phantom_phase_lo` 주석에 이관 대상 표식을 남겼다.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld,
  stepWorld,
  emptyInput,
  DEFAULT_CONFIG,
  type WorldConfig,
  type WorldState,
} from '../src/sim/world.js';
import { cloakEntryCrossed, playerCloaked, setBreakToken } from '../src/sim/cloak.js';
import { CLOAK_HOLD_TICKS, CLOAK_UNHIT_TICKS } from '../src/sim/shipSignature.js';
import { neutralLoadout } from '../src/items/loadout.js';
import type { Entity } from '../src/sim/entities.js';

const SHIP_PHANTOM = 3;

function phantomConfig(): WorldConfig {
  return {
    ...DEFAULT_CONFIG,
    planet: 0,
    stage: 1,
    shipType: SHIP_PHANTOM,
    playerHp: 100_000_000,
    loadout: { ...neutralLoadout(), weaponType: 0 },
  };
}

describe('E1 — 진입 판정이 통과 판정이다', () => {
  it('한 칸씩 오를 때는 `=== 임계` 와 정확히 같은 틱에 발화한다(값 불변의 근거)', () => {
    for (let prev = 0; prev < CLOAK_UNHIT_TICKS + CLOAK_HOLD_TICKS; prev++) {
      const next = prev + 1;
      expect(cloakEntryCrossed(prev, next), `prev=${prev}`).toBe(next === CLOAK_UNHIT_TICKS);
    }
  });

  it('임계를 **건너뛰는** 점프도 잡는다 — `===` 였다면 조용히 죽었을 자리', () => {
    expect(cloakEntryCrossed(200, 260)).toBe(true);
    expect(cloakEntryCrossed(0, 999)).toBe(true);
    expect(cloakEntryCrossed(CLOAK_UNHIT_TICKS - 1, CLOAK_UNHIT_TICKS)).toBe(true);
  });

  it('이미 임계 위였다면 다시 발화하지 않는다(창 안 재발화 금지)', () => {
    expect(cloakEntryCrossed(CLOAK_UNHIT_TICKS, CLOAK_UNHIT_TICKS + 1)).toBe(false);
    expect(cloakEntryCrossed(CLOAK_UNHIT_TICKS, 999)).toBe(false);
    expect(cloakEntryCrossed(300, 350)).toBe(false);
  });

  it('되돌아가는 이동은 진입이 아니다', () => {
    expect(cloakEntryCrossed(300, 0)).toBe(false);
    expect(cloakEntryCrossed(CLOAK_UNHIT_TICKS, 0)).toBe(false);
  });
});

describe('E1 — 토큰은 0/1 이진이다', () => {
  it('setBreakToken 은 어떤 입력이든 0 또는 1 만 쓴다(aux 정수 계약)', () => {
    const state = createWorld(1, DEFAULT_CONFIG);
    const p = state.entities[0] as Entity;
    for (const [input, want] of [
      [0, 0],
      [1, 1],
      [7, 1],
      [-3, 1],
    ] as const) {
      setBreakToken(state, p, input);
      expect(p.aux1, `input=${input}`).toBe(want);
    }
  });
});

/**
 * 무입력·무피격 팬텀 런에서 **적을 매 틱 치워** 자동 발사(=토큰 소진)를 막고 사이클만 본다.
 * 치우지 않으면 진입 다음 틱에 토큰이 소진돼 "언제 섰는가" 를 관측할 수 없다.
 */
function runIsolatedPhantom(ticks: number): { aux0: number[]; aux1: number[]; cloaked: boolean[] } {
  const state: WorldState = createWorld(0x9a17, phantomConfig());
  const aux0: number[] = [];
  const aux1: number[] = [];
  const cloaked: boolean[] = [];
  for (let i = 0; i < ticks; i++) {
    const player = state.entities[0] as Entity;
    state.entities = state.entities.filter((e) => e === player);
    stepWorld(state, emptyInput());
    const p = state.entities[0] as Entity;
    aux0.push(p.aux0);
    aux1.push(p.aux1);
    cloaked.push(playerCloaked(state, p));
  }
  return { aux0, aux1, cloaked };
}

describe('E1 — 자연 적립 사이클이 그대로다', () => {
  const TOTAL = CLOAK_UNHIT_TICKS + CLOAK_HOLD_TICKS + 5;

  it('aux0 은 한 칸씩만 오르고 240 을 건너뛰지 않는다(P1 판정 기준 ④)', () => {
    const { aux0 } = runIsolatedPhantom(TOTAL);
    let prev = 0;
    for (const [i, v] of aux0.entries()) {
      const jumped = v > prev + 1;
      expect(jumped, `tick ${i}: ${prev} → ${v}`).toBe(false);
      prev = v === 0 ? 0 : v;
    }
    expect(aux0).toContain(CLOAK_UNHIT_TICKS);
  });

  // ⚠️ 아래 두 케이스의 전제가 **선결 C-3 으로 뒤집혔다**(사용자 승인 2026-08-06).
  //    종전: 토큰은 **진입** 틱에 서고 되감기 틱에 회수된다.
  //    현행: 토큰은 진입에 서지 않고 **창 종료(되감기) 에지**에 선다.
  //    근거는 P1 실측 — 소진의 99.81%가 창 *안*에서 진입 직후에 일어나 2.5배가 "은신을 풀며
  //    내리치는 한 방"이 아니라 "들어가자마자 나가는 첫 발"이었다(`prerequisites.md` C-3).
  //    단언을 약화시키지 않고 **시점만 반대로** 옮겨 다시 세운다 — 창 전 구간 0 · 종료 틱 1.

  it('토큰은 창 종료 틱에 서고, 진입~창 안 전 구간에서는 서지 않는다', () => {
    const { aux0, aux1 } = runIsolatedPhantom(TOTAL);
    const entryIdx = aux0.indexOf(CLOAK_UNHIT_TICKS);
    expect(entryIdx, '진입 임계에 도달하지 못했다 — 계량이 공허하다').toBeGreaterThanOrEqual(0);
    const exitIdx = entryIdx + CLOAK_HOLD_TICKS;
    // 적립 구간과 은신 창 전체 — 창 종료 직전까지 한 틱도 서면 안 된다(진입 장전 부활 방지).
    for (let i = 0; i < exitIdx; i++) expect(aux1[i], `tick ${i}`).toBe(0);
    expect(aux1[exitIdx], '창 종료 틱').toBe(1);
  });

  it('유지 창이 끝나면 사이클이 되감기고(aux0 = 0) 그 틱에 토큰이 장전된다', () => {
    const { aux0, aux1, cloaked } = runIsolatedPhantom(TOTAL);
    const entryIdx = aux0.indexOf(CLOAK_UNHIT_TICKS);
    const rewindIdx = entryIdx + CLOAK_HOLD_TICKS;
    expect(aux0[rewindIdx], '되감기 틱').toBe(0);
    expect(aux1[rewindIdx], '되감기 틱의 토큰').toBe(1);
    // 은신 점유는 진입부터 되감기 직전까지 — 창 길이와 정확히 같다.
    expect(cloaked.filter(Boolean).length).toBe(CLOAK_HOLD_TICKS);
  });
});
