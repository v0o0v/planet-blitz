/**
 * 촉매 ↔ sim 경계 계약 — ADR-0052 이후.
 *
 * ## 이 파일이 무엇을 재는가 (ADR-0029 판에서 뒤집힌 것)
 * 구판(ADR-0029)은 촉매가 **출격 시점에 축 테이블로 접혀** sim 노브에 곱해졌고, 이 파일은
 * 그 축들(페널티 6 · 보상 4 · 파워 5)의 부호를 런으로 관측했다. ADR-0052 가 축 모델을 통째로
 * 폐기하면서 그 관측 대상이 사라졌다 — `resolveCatalystMods` 는 **항상 중립**이고
 * `createWorld` 의 촉매 파워 굽기 블록도 없다. 축 부호를 재던 절은 잴 것이 없어져 삭제했다
 * (규칙별 거동 검증은 배선 레인의 `catalystHooks` 짝이 갖는다).
 *
 * 남은 sim 경계 계약은 셋이고 전부 지금도 유효하다:
 *  ① **해시 폴드** — 촉매 배열이 `hashWorld` 꼬리에 접힌다(서버 재실행 검증의 전제).
 *     ⚠️ 유니크 주입으로 **스택 분기는 사라졌다**: `[1]` 과 `[1,1]` 은 이제 동형이다.
 *  ② **중립 시작** — 런 시작 배율 번들이 전 축 1 이다(촉매가 축을 굽지 않는다).
 *  ③ **번들 생존** — 그럼에도 `state.catalystMods` 는 살아 있고 조우·스킬이 쓴다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldConfig } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import { NEUTRAL_CATALYST_MODS, resolveCatalystMods } from '../src/sim/catalystMods.js';
import { normalizeCatalystArray } from '../src/data/catalysts.js';

const SEED = 0x5417;
const DURABLE = 100_000_000;

/** 기본 무대: 카르곤 단계11, 사망 방지용 내구 HP. */
function base(extra: Partial<WorldConfig> = {}): WorldConfig {
  return { ...DEFAULT_CONFIG, planet: 0, stage: 11, playerHp: DURABLE, ...extra };
}

function hashStream(catalysts: number[] | undefined, ticks = 90): number[] {
  const cfg = base(catalysts !== undefined ? { catalysts } : {});
  const state = createWorld(SEED, cfg);
  const out: number[] = [];
  for (let i = 0; i < ticks; i++) {
    stepWorld(state, emptyInput());
    out.push(hashWorld(state));
  }
  return out;
}

// ---------------------------------------------------------------------------
// ① 해시 폴드 (조건부 꼬리)
// ---------------------------------------------------------------------------

describe('촉매 해시 폴드 — 조건부 꼬리', () => {
  it('미지정과 빈 배열은 per-tick 해시가 완전히 동형이다(촉매 무관 런 = 무폴드)', () => {
    expect(hashStream(undefined)).toEqual(hashStream([]));
  });

  it('다른 촉매 집합은 해시가 분기한다(폴드가 실제로 살아 있다)', () => {
    expect(hashStream([1]).at(-1)).not.toBe(hashStream([5]).at(-1));
    expect(hashStream([1]).at(-1)).not.toBe(hashStream([]).at(-1));
    expect(hashStream([1, 5]).at(-1)).not.toBe(hashStream([1, 6]).at(-1));
  });

  it('같은 집합은 입력 순서가 달라도 동형이다', () => {
    expect(hashStream([1, 5])).toEqual(hashStream([5, 1]));
    expect(hashStream([15, 2, 25])).toEqual(hashStream([2, 25, 15]));
  });

  it('중복 스택은 더 이상 분기하지 않는다 — [1] 과 [1,1] 이 동형이다(유니크 주입)', () => {
    // ⚠️ ADR-0029 판에서 뒤집힌 계약이다. 구판은 스택이 곧 배율이라 분기했다.
    expect(normalizeCatalystArray([1, 1])).toEqual([1]);
    expect(hashStream([1, 1])).toEqual(hashStream([1]));
    expect(hashStream([1, 1, 1])).toEqual(hashStream([1]));
  });

  it('미지 id 만 든 배열은 무촉매와 동형이다(정규화가 걸러 무폴드)', () => {
    expect(hashStream([9999, -1])).toEqual(hashStream([]));
  });

  it('유효 id 하나라도 섞이면 그 하나만 접힌다', () => {
    expect(hashStream([9999, 1, -1])).toEqual(hashStream([1]));
  });
});

// ---------------------------------------------------------------------------
// ②③ 배율 번들 — 중립 시작 + 번들 생존
// ---------------------------------------------------------------------------

describe('촉매 배율 번들 — ADR-0052 이후 항상 중립으로 시작한다', () => {
  it('resolveCatalystMods 는 어떤 주입에도 중립 번들을 준다', () => {
    for (const ids of [undefined, [], [1], [1, 5, 20], [17, 17, 17], [30, 31]]) {
      expect(resolveCatalystMods(ids), JSON.stringify(ids)).toEqual(NEUTRAL_CATALYST_MODS);
    }
  });

  it('중립 번들은 전 축이 정확히 1 이다(무연산 원소)', () => {
    const values = Object.values(NEUTRAL_CATALYST_MODS);
    expect(values).toHaveLength(10);
    for (const [k, v] of Object.entries(NEUTRAL_CATALYST_MODS)) expect(v, k).toBe(1);
  });

  it('번들은 여전히 월드에 실린다 — 조우·스킬이 런 중에 쓰는 자리다', () => {
    // "중립이다"만 단언하면 필드가 통째로 사라져도 통과한다. 실린다는 긍정 짝을 붙인다.
    const state = createWorld(SEED, base({ catalysts: [1, 5] }));
    expect(state.catalystMods).toEqual(NEUTRAL_CATALYST_MODS);
    expect(state.catalystResourceMilli).toBe(0);
  });

  it('촉매 주입 여부는 catalystOn 으로 sim 에 도달한다', () => {
    expect(createWorld(SEED, base()).catalystOn).toBe(false);
    expect(createWorld(SEED, base({ catalysts: [] })).catalystOn).toBe(false);
    expect(createWorld(SEED, base({ catalysts: [1] })).catalystOn).toBe(true);
  });

  it('축 굽기가 사라졌다 — 주입 유무가 플레이어 스탯을 바꾸지 않는다', () => {
    const none = createWorld(SEED, base());
    // 구판에서 파워축(25 overdrive · 28 bulwark)·HP 페널티(8 alchemy)를 굽던 조합.
    const injected = createWorld(SEED, base({ catalysts: [25, 28, 8] }));
    expect(injected.weapon.damage).toBe(none.weapon.damage);
    expect(injected.entities[0]!.maxHp).toBe(none.entities[0]!.maxHp);
    // 그럼에도 두 런은 서로 다른 런이다(해시는 갈린다) — 굽기 소멸이 폴드 소멸이 아니다.
    expect(hashWorld(injected)).not.toBe(hashWorld(none));
  });
});
