/**
 * E4 — 브루저 장갑 스택 상한의 **config 파생화** 계약 (ADR-0049 선결, `prerequisites.md` §2).
 *
 * ## 이 파일이 지키는 것
 * 상한이 상수였을 때는 감소 경로(`armorReducedDamage`)와 스택 경로(`clampArmorStacks`)가 같은
 * 상수를 읽어 자동으로 일치했다. 상한이 런마다 달라지는 순간 **한쪽만 상한을 반영하면 감소
 * 상한과 스택 상한이 조용히 갈린다** — 그리고 그 어긋남은 화면에도 기존 테스트에도 흔적을
 * 남기지 않는다(`bruiser.md` ⑥-3 이 MAJOR 로 지목한 결함). 그래서 여기서 못 박는 것은 셋이다:
 *
 *  1. **bp 산출이 단일 정본**(`armorReductionBp`)이고 그것이 `cap` 을 실제로 존중한다.
 *  2. **기본 인자 중립성** — `cap` 을 생략한 호출이 종전과 완전히 같은 값이다(거동 불변 증명).
 *  3. **world 배선의 두 소비 지점이 같은 정본**(`state.armorMaxStacks`)을 읽는다 —
 *     피해 감소와 적립 clamp 둘 다. 상한을 바꾸면 **둘 다** 따라 움직여야 한다.
 *
 * ⚠️ 3번은 화이트박스다. 이 커밋 시점에는 상한을 넓히는 스킬(FO1)이 아직 없어 `createWorld` 가
 * 항상 기본값을 싣기 때문에, 상한이 배선에 실제로 도달하는지를 **필드를 직접 흔들어** 재는 것
 * 말고는 방법이 없다. FO1 이 붙으면 그때는 config 로 같은 것을 재는 테스트가 이 자리를 잇는다.
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
import { hashWorld } from '../src/sim/replay.js';
import { neutralLoadout } from '../src/items/loadout.js';
import type { Entity } from '../src/sim/entities.js';
import {
  ARMOR_MAX_STACKS,
  ARMOR_PER_STACK_BP,
  armorReductionBp,
  armorReducedDamage,
  clampArmorStacks,
} from '../src/sim/shipSignature.js';

const SHIP_BRUISER = 1;

/** 피격이 실제로 자주 나되 죽지 않는 브루저 런(weapons.test.ts 의 장갑 관측 레시피와 동형). */
function bruiserConfig(): WorldConfig {
  return {
    ...DEFAULT_CONFIG,
    planet: 0,
    stage: 1,
    shipType: SHIP_BRUISER,
    playerHp: 100_000_000,
    loadout: { ...neutralLoadout(), weaponType: 0 },
  };
}

/** 같은 시드·무입력으로 `ticks` 만큼 돌린 뒤 (최종 해시 · 관측된 최대 스택 · 최종 hp) 를 낸다. */
function runBruiser(ticks: number, cap?: number): { hash: number; maxAux0: number; hp: number } {
  const state: WorldState = createWorld(7, bruiserConfig());
  if (cap !== undefined) state.armorMaxStacks = cap;
  let maxAux0 = 0;
  for (let i = 0; i < ticks; i++) {
    stepWorld(state, emptyInput());
    const p = state.entities[0] as Entity;
    if (p.aux0 > maxAux0) maxAux0 = p.aux0;
  }
  return { hash: hashWorld(state), maxAux0, hp: (state.entities[0] as Entity).hp };
}

describe('E4 — 장갑 상한 파생화: 순수 함수 두 경로', () => {
  it('armorReductionBp 는 cap 을 존중하고 clampArmorStacks 와 정확히 같은 상한을 쓴다', () => {
    for (let cap = -2; cap <= 12; cap++) {
      for (let s = -3; s <= 15; s++) {
        expect(armorReductionBp(s, cap), `cap=${cap} s=${s}`).toBe(
          clampArmorStacks(s, cap) * ARMOR_PER_STACK_BP,
        );
        // 상한을 넘는 스택은 bp 를 더 올리지 못한다 — "그릇" 이 정말 상한인지.
        expect(armorReductionBp(s, cap)).toBeLessThanOrEqual(Math.max(0, cap) * ARMOR_PER_STACK_BP);
      }
    }
  });

  it('armorReducedDamage 와 world 배선 식이 같은 cap 에서 정확히 같은 값을 낸다', () => {
    // 아래 우변은 `world.ts` resolveCollisions 의 장갑 블록 그대로다(trunc 만 없다).
    // 두 경로가 cap 해석에서 갈리면 여기가 먼저 터진다.
    for (const cap of [0, 1, 2, 5, 8, 11]) {
      for (let s = 0; s <= 14; s++) {
        for (const d of [1, 3, 6, 8, 16, 25, 37, 100, 999]) {
          const bp = armorReductionBp(s, cap);
          const wired = bp > 0 ? d - Math.round((d * bp) / 10000) : d;
          expect(armorReducedDamage(d, s, cap), `cap=${cap} s=${s} d=${d}`).toBe(wired);
        }
      }
    }
  });

  it('cap 을 생략한 호출은 기본 상한과 완전히 같다(거동 불변)', () => {
    for (let s = -3; s <= 15; s++) {
      expect(clampArmorStacks(s)).toBe(clampArmorStacks(s, ARMOR_MAX_STACKS));
      expect(armorReductionBp(s)).toBe(armorReductionBp(s, ARMOR_MAX_STACKS));
      for (const d of [0, -5, 1, 7, 100, 999]) {
        expect(armorReducedDamage(d, s)).toBe(armorReducedDamage(d, s, ARMOR_MAX_STACKS));
      }
    }
  });

  it('cap 이 0 이하면 장갑이 통째로 꺼진다(감소 0 · 스택 0)', () => {
    expect(clampArmorStacks(99, 0)).toBe(0);
    expect(clampArmorStacks(99, -4)).toBe(0);
    expect(armorReducedDamage(1000, 99, 0)).toBe(1000);
  });
});

describe('E4 — world 배선이 state.armorMaxStacks 를 실제로 읽는가', () => {
  const TICKS = 3000;

  it('createWorld 는 상한을 기본값으로 확정하고, 그 값을 명시해도 해시가 바이트 동일이다', () => {
    const control = runBruiser(TICKS);
    const explicit = runBruiser(TICKS, ARMOR_MAX_STACKS);
    expect(explicit.hash).toBe(control.hash);
    // 계량이 vacuous 하지 않음을 증명한다 — 이 무대·시드에서 스택이 실제로 만재까지 찬다.
    expect(control.maxAux0).toBe(ARMOR_MAX_STACKS);
  });

  it('상한을 낮추면 적립 clamp 가 따라 내려간다', () => {
    const control = runBruiser(TICKS);
    const capped = runBruiser(TICKS, 2);
    // 적립 경로: 상한 위로 절대 안 쌓인다.
    expect(capped.maxAux0).toBe(2);
    // 감소가 얕아졌으므로 같은 시드에서 hp 가 더 많이 깎인다.
    expect(capped.hp).toBeLessThan(control.hp);
    expect(capped.hash).not.toBe(control.hash);
  });

  /**
   * ⚠️ **이 케이스가 E4 의 핵심이다 — 아래 방향이 위 케이스로는 원리적으로 안 잡힌다.**
   *
   * 뮤테이션 실측(이 파일을 쓰며 확인): `world.ts` 의 감소 블록에서 상한 인자를 지워
   * `armorReductionBp(player.aux0)`(기본 8)로 만들어도 **상한을 낮추는 케이스는 전부 통과한다.**
   * 적립 clamp 가 이미 스택을 상한 아래로 눌러 두면 감소 쪽 상한은 영영 안 물리기 때문이다.
   * 즉 위험한 방향은 **상한을 기본값보다 높였을 때**(= FO1 이 하려는 일)이고, 그때 감소 경로만
   * 옛 상한에 갇히면 "9스택째부터 감소가 안 늘어난다" 는 결함이 조용히 선다.
   *
   * 그래서 상한 12 vs 8 을 마주 세운다. 감소가 상한을 무시하면 두 런의 피해 감소가 스택
   * 전 구간에서 동일해져 **hp 가 정확히 같아진다**(aux0 은 갈리지만 아무도 안 읽는다).
   */
  it('상한을 기본값 위로 올리면 감소 경로도 따라 깊어진다(FO1 방향)', () => {
    const base = runBruiser(TICKS, ARMOR_MAX_STACKS);
    const wide = runBruiser(TICKS, 12);
    // 계량이 vacuous 하지 않음 — 넓힌 상한을 실제로 초과 사용한다.
    expect(wide.maxAux0).toBeGreaterThan(ARMOR_MAX_STACKS);
    // 상한이 넓으면 감소가 깊어져 hp 가 더 남아야 한다. 감소 경로가 옛 상한에 갇히면 같아진다.
    expect(wide.hp).toBeGreaterThan(base.hp);
  });
});
