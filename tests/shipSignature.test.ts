/**
 * M8-L2 — 기체 시그니처 패시브: 비트 상수 + 순수 정수 함수 게이트.
 *
 * ## 무엇을 막는가
 * 1. **비트 충돌** — 시그니처 비트가 유니크(0~14)·캡스톤(15~17)과 겹치면 장착 유니크가
 *    시그니처를 켜거나 그 반대가 된다. 마스크 연산이라 예외가 없고 조용히 오작동한다.
 *    그래서 하드코딩 목록이 아니라 `src/sim/uniques.ts`·`capstones.ts` **원문을 파싱해**
 *    대조한다 — 나중에 그쪽이 비트를 늘려도 이 테스트가 먼저 터진다.
 * 2. **f64 누적** — `damage *= 0.975` 반복·`Math.pow`·중간 f64 보관은 클라이언트와 Edge
 *    Function 재검증의 반올림 경로를 가를 수 있다(ADR-0005). 소스 grep 게이트로 부재를 강제.
 * 3. **비정수 유출** — 전 함수 파라미터 스윕으로 `Number.isInteger` 전수 검사.
 * 4. **경계 오프바이원** — 스택 0/1/상한/상한+1, 정지 89/90/91틱 등 골든.
 * 5. **배선 결함(이 프로젝트 8회 재발형)** — 정규 경로(Profile → 런 설정 → createWorld →
 *    stepWorld)를 실제로 굴려 시그니처 비트가 **현행 파생 경로에서 아직 켜지지 않는지**와
 *    스트라이커 런이 이 비트대를 전혀 쓰지 않는지를 확인한다. (OR-in 배선 자체는 L4,
 *    world.ts 배선은 L5 소유 — 이 레인은 순수 함수만 소유한다.)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SIG_BRUISER_ARMOR,
  SIG_ARC_OVERCHARGE,
  SIG_PHANTOM_CLOAK,
  SIG_HATCHLING_BROOD,
  SIG_MALLOW_CUSHION,
  SIG_BUBBLE_FILM,
  SIGNATURE_BITS,
  SIGNATURE_BIT_MAX,
  hasSignature,
  ARMOR_MAX_STACKS,
  ARMOR_PER_STACK_BP,
  ARMOR_DECAY_TICKS,
  clampArmorStacks,
  armorReducedDamage,
  OVERCHARGE_STILL_TICKS,
  OVERCHARGE_BASE_BP,
  OVERCHARGE_RAMP_BP,
  OVERCHARGE_MAX_BP,
  overchargeBp,
  overchargedDamage,
  CLOAK_UNHIT_TICKS,
  CLOAK_BREAK_BP,
  cloakActive,
  cloakBreakDamage,
  HATCH_BASE_KILLS,
  HATCH_STEP_KILLS,
  HATCH_SCALE_KILLS,
  HATCH_MAX_KILLS,
  hatchThreshold,
  CUSHION_DEFER_BP,
  CUSHION_RECOVER_TICKS,
  CUSHION_RECOVER_BP,
  cushionDeferredDamage,
  cushionImmediateDamage,
  cushionRecovered,
  FILM_PERIOD_TICKS,
  FILM_ABSORB_FLAT,
  filmReady,
  filmAbsorbed,
  filmRemainingDamage,
} from '../src/sim/shipSignature.js';
import { hasUnique } from '../src/sim/uniques.js';
import { hasCapstone } from '../src/sim/capstones.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import type { InputFrame } from '../src/sim/world.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import {
  BASELINE_BUILDS,
  BASELINE_PLANETS,
  baselineConfig,
  driveBaseline,
} from '../scripts/recordStrikerBaseline.js';

// ---------------------------------------------------------------------------
// 소스 원문 로더 (grep 게이트·비트 대조용)
// ---------------------------------------------------------------------------

function readSource(relative: string): string {
  return new TextDecoder().decode(
    readFileSync(fileURLToPath(new URL(relative, import.meta.url))),
  );
}

const SIG_SRC = readSource('../src/sim/shipSignature.ts');
const UNIQ_SRC = readSource('../src/sim/uniques.ts');
const CAP_SRC = readSource('../src/sim/capstones.ts');

/** 주석을 제거한 소스(주석 안의 `/`·금지 문구가 grep 게이트를 오염시키지 않게). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * `export const NAME = <정수>;` 형태의 선언을 전부 수집한다. 상수 목록을 이 테스트에
 * 다시 적으면 원본이 늘어날 때 대조가 조용히 낡는다 — 그래서 원문을 파싱한다.
 */
function declaredIntConsts(src: string): Map<string, number> {
  const out = new Map<string, number>();
  const re = /export const ([A-Z0-9_]+)\s*=\s*(-?\d+)\s*;/g;
  let m: RegExpExecArray | null = re.exec(src);
  while (m !== null) {
    out.set(m[1] as string, Number(m[2]));
    m = re.exec(src);
  }
  return out;
}

/** 유니크 비트(UQ_*)·캡스톤 비트(CAP_*) 실측 집합. */
const UNIQUE_BITS = [...declaredIntConsts(UNIQ_SRC)]
  .filter(([name]) => name.startsWith('UQ_'))
  .map(([, v]) => v);
const CAPSTONE_BITS = [...declaredIntConsts(CAP_SRC)]
  .filter(([name]) => name.startsWith('CAP_'))
  .map(([, v]) => v);

// ---------------------------------------------------------------------------
// ④ 비트 대조
// ---------------------------------------------------------------------------

describe('시그니처 비트 배정', () => {
  it('설계 §4 배정값 그대로다 (재번호 금지 — uniqueMask 는 해시에 접힌다)', () => {
    expect(SIG_BRUISER_ARMOR).toBe(18);
    expect(SIG_ARC_OVERCHARGE).toBe(19);
    expect(SIG_PHANTOM_CLOAK).toBe(20);
    expect(SIG_HATCHLING_BROOD).toBe(21);
    expect(SIG_MALLOW_CUSHION).toBe(22);
    expect(SIG_BUBBLE_FILM).toBe(23);
    expect(SIGNATURE_BITS).toEqual([18, 19, 20, 21, 22, 23]);
  });

  it('원문 실측: 유니크 15종(0~14) · 캡스톤 3종(15~17) 이 실제로 그 범위다', () => {
    expect(UNIQUE_BITS.length).toBe(15);
    expect([...UNIQUE_BITS].sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ]);
    expect(CAPSTONE_BITS.length).toBe(3);
    expect([...CAPSTONE_BITS].sort((a, b) => a - b)).toEqual([15, 16, 17]);
  });

  it('시그니처 비트가 서로 유일하고 유니크·캡스톤과 하나도 겹치지 않는다', () => {
    expect(new Set(SIGNATURE_BITS).size).toBe(SIGNATURE_BITS.length);
    const taken = new Set([...UNIQUE_BITS, ...CAPSTONE_BITS]);
    for (const bit of SIGNATURE_BITS) expect(taken.has(bit), `비트 ${bit} 충돌`).toBe(false);
  });

  it('비트 31 을 쓰지 않는다 (1<<31 이 음수 — 마스크 연산 취약)', () => {
    expect(SIGNATURE_BIT_MAX).toBe(30);
    for (const bit of SIGNATURE_BITS) {
      expect(bit).toBeLessThanOrEqual(SIGNATURE_BIT_MAX);
      expect(1 << bit).toBeGreaterThan(0);
    }
  });

  it('hasSignature 가 hasUnique·hasCapstone 과 같은 연산이고 비트별로 독립이다', () => {
    for (const bit of SIGNATURE_BITS) {
      const mask = 1 << bit;
      expect(hasSignature(mask, bit)).toBe(true);
      expect(hasUnique(mask, bit)).toBe(true);
      expect(hasCapstone(mask, bit)).toBe(true);
      for (const other of SIGNATURE_BITS) {
        if (other !== bit) expect(hasSignature(mask, other)).toBe(false);
      }
      for (const other of [...UNIQUE_BITS, ...CAPSTONE_BITS]) {
        expect(hasSignature(mask, other)).toBe(false);
      }
    }
    // 전 비트를 켠 마스크에서도 음수로 뒤집히지 않는다.
    let all = 0;
    for (const bit of [...UNIQUE_BITS, ...CAPSTONE_BITS, ...SIGNATURE_BITS]) all |= 1 << bit;
    expect(all).toBeGreaterThan(0);
    for (const bit of SIGNATURE_BITS) expect(hasSignature(all, bit)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ② 소스 grep 게이트 — f64 누적 부재
// ---------------------------------------------------------------------------

describe('결정론 산술 게이트 (소스 grep)', () => {
  const CODE = stripComments(SIG_SRC);

  it('Math.pow · ** · Math.random · Date.now · performance.now 가 없다', () => {
    expect(CODE).not.toMatch(/Math\s*\.\s*pow/);
    expect(CODE).not.toMatch(/\*\*/);
    expect(CODE).not.toMatch(/Math\s*\.\s*random/);
    expect(CODE).not.toMatch(/Date\s*\.\s*now/);
    expect(CODE).not.toMatch(/performance\s*\.\s*now/);
  });

  it('부동소수 리터럴이 하나도 없다 (전 상수가 정수 basis-point)', () => {
    const floats = CODE.match(/\b\d+\.\d+\b/g);
    expect(floats, `부동소수 리터럴: ${JSON.stringify(floats)}`).toBeNull();
  });

  it('누적 곱셈 대입(`*=`)이 없다 — 스택 배율 반복의 전형적 형태', () => {
    expect(CODE).not.toMatch(/\*=/);
  });

  it('나눗셈이 오직 10000(bp) 또는 명시 정수 상수로만 이뤄진다', () => {
    const divisors = [...CODE.matchAll(/\/\s*([A-Za-z0-9_]+)/g)].map((m) => m[1] as string);
    expect(divisors.length).toBeGreaterThan(0);
    // 허용은 bp 제수(10000)와 **이름 있는 정수 상수**뿐이다 — 리터럴 제수는 계속 금지다.
    // FILM_PUSH_SCALE 은 버블 파열 눈금(FILM_BURST_PUSH 가 "속도 × 100" 으로 저장됨)의 제수.
    const allowed = new Set(['10000', 'HATCH_SCALE_KILLS', 'FILM_PUSH_SCALE']);
    for (const d of divisors) expect(allowed.has(d), `허용되지 않은 제수: ${d}`).toBe(true);
  });

  it('bp 적용은 항상 `Math.round((x * bp) / 10000)` 단일 나눗셈 형태다', () => {
    const rounds = [...CODE.matchAll(/Math\.round\(([^;]*?)\)\s*;/g)].map((m) => m[1] as string);
    expect(rounds.length).toBeGreaterThan(0);
    for (const body of rounds) {
      expect(body, `Math.round 본문: ${body}`).toMatch(/\*[^/]*\)\s*\/\s*10000/);
      // 본문 안에 나눗셈이 정확히 1회.
      expect((body.match(/\//g) ?? []).length, `나눗셈 횟수: ${body}`).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// ① 정수 in / 정수 out 전수 스윕
// ---------------------------------------------------------------------------

const DAMAGE_SWEEP: number[] = [];
for (let d = 0; d <= 400; d++) DAMAGE_SWEEP.push(d);
for (const d of [999, 1000, 1234, 9999, 100_000, 1_000_003]) DAMAGE_SWEEP.push(d);

describe('정수 in / 정수 out (파라미터 스윕)', () => {
  it('armorReducedDamage — 전 (피해 × 스택) 조합이 정수', () => {
    for (const d of DAMAGE_SWEEP) {
      for (let s = -2; s <= ARMOR_MAX_STACKS + 3; s++) {
        const out = armorReducedDamage(d, s);
        expect(Number.isInteger(out), `damage=${d} stacks=${s} → ${out}`).toBe(true);
        expect(out).toBeGreaterThanOrEqual(0);
        expect(out).toBeLessThanOrEqual(Math.max(0, d));
      }
    }
  });

  it('clampArmorStacks — 항상 [0, 상한] 정수', () => {
    for (let s = -5; s <= ARMOR_MAX_STACKS + 5; s++) {
      const out = clampArmorStacks(s);
      expect(Number.isInteger(out)).toBe(true);
      expect(out).toBeGreaterThanOrEqual(0);
      expect(out).toBeLessThanOrEqual(ARMOR_MAX_STACKS);
    }
  });

  it('overchargeBp · overchargedDamage — 전 틱 구간이 정수', () => {
    for (let t = -5; t <= 400; t++) {
      const bp = overchargeBp(t);
      expect(Number.isInteger(bp), `stillTicks=${t} → ${bp}`).toBe(true);
      expect(bp).toBeGreaterThanOrEqual(0);
      expect(bp).toBeLessThanOrEqual(OVERCHARGE_MAX_BP);
    }
    for (const d of DAMAGE_SWEEP) {
      for (const t of [0, 89, 90, 91, 150, 190, 191, 5000]) {
        const out = overchargedDamage(d, t);
        expect(Number.isInteger(out), `damage=${d} still=${t} → ${out}`).toBe(true);
        expect(out).toBeGreaterThanOrEqual(Math.max(0, d));
      }
    }
  });

  it('cloakActive 는 boolean · cloakBreakDamage 는 정수', () => {
    for (let t = -5; t <= 500; t++) expect(typeof cloakActive(t)).toBe('boolean');
    for (const d of DAMAGE_SWEEP) {
      const out = cloakBreakDamage(d);
      expect(Number.isInteger(out), `damage=${d} → ${out}`).toBe(true);
      expect(out).toBeGreaterThanOrEqual(Math.max(0, d));
    }
  });

  it('hatchThreshold — 전 처치 구간이 정수·단조 비감소·상한 준수', () => {
    let prev = 0;
    for (let k = -5; k <= 4000; k++) {
      const out = hatchThreshold(k);
      expect(Number.isInteger(out), `kills=${k} → ${out}`).toBe(true);
      expect(out).toBeGreaterThanOrEqual(HATCH_BASE_KILLS);
      expect(out).toBeLessThanOrEqual(HATCH_MAX_KILLS);
      if (k > 0) expect(out, `kills=${k} 에서 감소`).toBeGreaterThanOrEqual(prev);
      prev = out;
    }
  });

  it('비정수 입력이 들어와도 정수만 나온다 (외부 오염 방어)', () => {
    expect(Number.isInteger(armorReducedDamage(10.7, 3.9))).toBe(true);
    expect(Number.isInteger(overchargeBp(90.9))).toBe(true);
    expect(Number.isInteger(overchargedDamage(33.3, 120.6))).toBe(true);
    expect(Number.isInteger(cloakBreakDamage(41.2))).toBe(true);
    expect(Number.isInteger(hatchThreshold(61.8))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ③ 경계 골든
// ---------------------------------------------------------------------------

describe('경계 골든 — 브루저 장갑', () => {
  it('스택 0 은 무연산(원본 그대로), 음수도 동일', () => {
    expect(armorReducedDamage(100, 0)).toBe(100);
    expect(armorReducedDamage(100, -3)).toBe(100);
  });

  it('스택 1 = 250bp = 2.5% 감소', () => {
    expect(armorReducedDamage(1000, 1)).toBe(975);
    expect(armorReducedDamage(100, 1)).toBe(97); // round(2.5)=3 (JS 반올림 규약 고정)
  });

  it('스택 상한과 상한+1 이 같다 (클램프)', () => {
    const cap = armorReducedDamage(1000, ARMOR_MAX_STACKS);
    expect(cap).toBe(800); // 8 × 250bp = 2000bp = 20% 감소
    expect(armorReducedDamage(1000, ARMOR_MAX_STACKS + 1)).toBe(cap);
    expect(armorReducedDamage(1000, 99)).toBe(cap);
  });

  it('반복 곱이 아니라 합산 bp — 8스택이 정확히 20% 감소다', () => {
    // 반복 곱(0.975^8 ≈ 0.8167)이면 817 이 나온다. 그 값이 나오면 f64 누적 구현이다.
    expect(armorReducedDamage(1000, 8)).not.toBe(817);
    expect(armorReducedDamage(1000, 8)).toBe(1000 - Math.round((1000 * 8 * ARMOR_PER_STACK_BP) / 10000));
  });

  it('피해 0·음수는 0', () => {
    expect(armorReducedDamage(0, 8)).toBe(0);
    expect(armorReducedDamage(-50, 8)).toBe(0);
  });

  it('감쇠 틱 상수가 설계값이다', () => {
    expect(ARMOR_DECAY_TICKS).toBe(180);
    expect(ARMOR_PER_STACK_BP).toBe(250);
    expect(ARMOR_MAX_STACKS).toBe(8);
  });
});

describe('경계 골든 — 아크 캐스터 과충전', () => {
  it('89 / 90 / 91 틱', () => {
    expect(overchargeBp(89)).toBe(0);
    expect(overchargeBp(OVERCHARGE_STILL_TICKS)).toBe(OVERCHARGE_BASE_BP);
    expect(overchargeBp(91)).toBe(OVERCHARGE_BASE_BP + OVERCHARGE_RAMP_BP);
  });

  it('상한 도달 틱과 그 이후가 같다', () => {
    const capTick = OVERCHARGE_STILL_TICKS + (OVERCHARGE_MAX_BP - OVERCHARGE_BASE_BP) / OVERCHARGE_RAMP_BP;
    expect(capTick).toBe(190);
    expect(overchargeBp(189)).toBe(OVERCHARGE_MAX_BP - OVERCHARGE_RAMP_BP);
    expect(overchargeBp(190)).toBe(OVERCHARGE_MAX_BP);
    expect(overchargeBp(191)).toBe(OVERCHARGE_MAX_BP);
    expect(overchargeBp(100_000)).toBe(OVERCHARGE_MAX_BP);
  });

  it('이동 중(0틱)은 피해가 원본 그대로 — 조기 탈출', () => {
    expect(overchargedDamage(137, 0)).toBe(137);
    expect(overchargedDamage(137, 89)).toBe(137);
  });

  it('진입 즉시 +15%, 상한에서 +40%', () => {
    expect(overchargedDamage(1000, 90)).toBe(1150);
    expect(overchargedDamage(1000, 190)).toBe(1400);
  });
});

describe('경계 골든 — 팬텀 은신', () => {
  it('239 / 240 / 241 틱', () => {
    expect(cloakActive(239)).toBe(false);
    expect(cloakActive(CLOAK_UNHIT_TICKS)).toBe(true);
    expect(cloakActive(241)).toBe(true);
  });

  it('0·음수 틱은 비활성', () => {
    expect(cloakActive(0)).toBe(false);
    expect(cloakActive(-10)).toBe(false);
  });

  it('해제 첫 타 = 2.5배', () => {
    expect(CLOAK_BREAK_BP).toBe(25000);
    expect(cloakBreakDamage(100)).toBe(250);
    expect(cloakBreakDamage(1)).toBe(3); // round(2.5)=3 (JS 반올림 규약 고정)
    expect(cloakBreakDamage(0)).toBe(0);
  });
});

describe('경계 골든 — 말로우 완충 (지연 피해 + 무피격 회복)', () => {
  it('즉시분 + 지연분 = 원래 피해다 (양쪽을 따로 반올림하면 1이 새거나 는다)', () => {
    for (const d of DAMAGE_SWEEP) {
      expect(cushionImmediateDamage(d) + cushionDeferredDamage(d), `damage=${d}`).toBe(
        Math.max(0, Math.trunc(d)),
      );
    }
  });

  it('지연 전환 비율이 설계값(35%)이고 전 구간 정수다', () => {
    expect(CUSHION_DEFER_BP).toBe(3500);
    expect(cushionDeferredDamage(1000)).toBe(350);
    expect(cushionImmediateDamage(1000)).toBe(650);
    for (const d of DAMAGE_SWEEP) {
      expect(Number.isInteger(cushionDeferredDamage(d)), `damage=${d}`).toBe(true);
      expect(Number.isInteger(cushionImmediateDamage(d)), `damage=${d}`).toBe(true);
    }
  });

  it('피해 0·음수는 양쪽 모두 0', () => {
    expect(cushionDeferredDamage(0)).toBe(0);
    expect(cushionDeferredDamage(-40)).toBe(0);
    expect(cushionImmediateDamage(0)).toBe(0);
    expect(cushionImmediateDamage(-40)).toBe(0);
  });

  it('회복은 무피격 임계 179 / 180 / 181 에서 갈리고 상한을 넘지 않는다', () => {
    expect(CUSHION_RECOVER_TICKS).toBe(180);
    expect(CUSHION_RECOVER_BP).toBe(6000);
    expect(cushionRecovered(1000, CUSHION_RECOVER_TICKS - 1)).toBe(0);
    expect(cushionRecovered(1000, CUSHION_RECOVER_TICKS)).toBe(600);
    expect(cushionRecovered(1000, CUSHION_RECOVER_TICKS + 1)).toBe(600);
    for (const v of DAMAGE_SWEEP) {
      for (const t of [-3, 0, 179, 180, 5000]) {
        const out = cushionRecovered(v, t);
        expect(Number.isInteger(out), `deferred=${v} ticks=${t}`).toBe(true);
        expect(out).toBeGreaterThanOrEqual(0);
        expect(out).toBeLessThanOrEqual(Math.max(0, v));
      }
    }
  });

  it('비정수 입력이 들어와도 정수만 나온다', () => {
    expect(Number.isInteger(cushionDeferredDamage(77.4))).toBe(true);
    expect(Number.isInteger(cushionImmediateDamage(77.4))).toBe(true);
    expect(Number.isInteger(cushionRecovered(77.4, 180.9))).toBe(true);
  });
});

describe('경계 골든 — 버블 방막 (주기 흡수 + 파열)', () => {
  it('막 재생 주기 419 / 420 / 421 에서 갈린다', () => {
    expect(FILM_PERIOD_TICKS).toBe(420);
    expect(filmReady(FILM_PERIOD_TICKS - 1)).toBe(false);
    expect(filmReady(FILM_PERIOD_TICKS)).toBe(true);
    expect(filmReady(FILM_PERIOD_TICKS + 1)).toBe(true);
    expect(filmReady(0)).toBe(false);
    expect(filmReady(-10)).toBe(false);
  });

  it('흡수량 + 통과 피해 = 원래 피해이고 둘 다 정수·비음수다', () => {
    for (const d of DAMAGE_SWEEP) {
      for (const shield of [-5, 0, 1, FILM_ABSORB_FLAT, FILM_ABSORB_FLAT + 1, 100_000]) {
        const a = filmAbsorbed(d, shield);
        const r = filmRemainingDamage(d, shield);
        expect(Number.isInteger(a), `d=${d} s=${shield}`).toBe(true);
        expect(Number.isInteger(r), `d=${d} s=${shield}`).toBe(true);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(Math.max(0, shield));
        expect(a + r, `d=${d} s=${shield}`).toBe(Math.max(0, d));
      }
    }
  });

  it('막 내구가 남아 있는 만큼만 먹고 나머지는 선체로 간다', () => {
    expect(FILM_ABSORB_FLAT).toBe(60);
    expect(filmAbsorbed(100, FILM_ABSORB_FLAT)).toBe(60);
    expect(filmRemainingDamage(100, FILM_ABSORB_FLAT)).toBe(40);
    expect(filmAbsorbed(30, FILM_ABSORB_FLAT)).toBe(30);
    expect(filmRemainingDamage(30, FILM_ABSORB_FLAT)).toBe(0);
    // 막이 없으면 무연산 — 피해가 그대로 들어간다.
    expect(filmAbsorbed(100, 0)).toBe(0);
    expect(filmRemainingDamage(100, 0)).toBe(100);
  });
});

describe('경계 골든 — 해츨링 부화', () => {
  it('0 처치 시 기본 임계', () => {
    expect(hatchThreshold(0)).toBe(HATCH_BASE_KILLS);
    expect(hatchThreshold(-7)).toBe(HATCH_BASE_KILLS);
  });

  it('스케일 경계 59 / 60 / 61 에서 한 단계 오른다', () => {
    expect(hatchThreshold(HATCH_SCALE_KILLS - 1)).toBe(HATCH_BASE_KILLS);
    expect(hatchThreshold(HATCH_SCALE_KILLS)).toBe(HATCH_BASE_KILLS + HATCH_STEP_KILLS);
    expect(hatchThreshold(HATCH_SCALE_KILLS + 1)).toBe(HATCH_BASE_KILLS + HATCH_STEP_KILLS);
  });

  it('상한에서 평평해진다', () => {
    const capKills = HATCH_SCALE_KILLS * ((HATCH_MAX_KILLS - HATCH_BASE_KILLS) / HATCH_STEP_KILLS);
    expect(capKills).toBe(420);
    expect(hatchThreshold(capKills)).toBe(HATCH_MAX_KILLS);
    expect(hatchThreshold(capKills - HATCH_SCALE_KILLS)).toBe(HATCH_MAX_KILLS - HATCH_STEP_KILLS);
    expect(hatchThreshold(100_000)).toBe(HATCH_MAX_KILLS);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 같은 입력 2회 → 바이트 동일
// ---------------------------------------------------------------------------

describe('재현성 — 같은 입력 2회', () => {
  it('전 함수가 두 번째 호출에서 동일 값을 낸다', () => {
    const first: number[] = [];
    const second: number[] = [];
    for (const sink of [first, second]) {
      for (let d = 0; d <= 300; d += 7) {
        for (let s = 0; s <= ARMOR_MAX_STACKS; s++) sink.push(armorReducedDamage(d, s));
        for (let t = 80; t <= 200; t += 11) {
          sink.push(overchargeBp(t));
          sink.push(overchargedDamage(d, t));
        }
        sink.push(cloakBreakDamage(d));
        sink.push(cloakActive(d) ? 1 : 0);
        sink.push(hatchThreshold(d));
        sink.push(cushionDeferredDamage(d));
        sink.push(cushionImmediateDamage(d));
        sink.push(cushionRecovered(d, CUSHION_RECOVER_TICKS));
        sink.push(filmAbsorbed(d, FILM_ABSORB_FLAT));
        sink.push(filmRemainingDamage(d, FILM_ABSORB_FLAT));
        sink.push(filmReady(d) ? 1 : 0);
      }
    }
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

// ---------------------------------------------------------------------------
// 정규 경로 통합 — "단위 테스트는 그린인데 배선이 통째로 없다" 방지
//
// 이 레인은 world.ts·loadout.ts 를 소유하지 않으므로 "시그니처가 켜진다" 를 아직 증명할 수
// 없다. 대신 **지금 증명 가능한 계약**을 못 박는다: 실제 앱 경로(Profile → 런 설정 →
// createWorld → stepWorld)가 만드는 uniqueMask 가 18~21 비트대를 전혀 쓰지 않는다는 것.
// 이것이 깨지면 L4 의 OR-in 이 기존 유니크/캡스톤과 충돌하게 된다.
//
// ✅ M8-L7 완료: 조립을 재현하지 않고 실제 앱이 쓰는 `buildRunConfig` 를 그대로 부른다.
// ---------------------------------------------------------------------------

function assembleRunConfigLikeMain(invest: readonly number[]) {
  const profile = defaultProfile();
  activeShip(profile).skillInvest = invest.slice();
  const cfg = buildRunConfig(profile, { planet: 0, stage: 1 });
  return { loadout: cfg.loadout!, skillInvest: cfg.skillInvest! };
}

describe('정규 경로 통합 — Profile → 런 설정 → createWorld/stepWorld', () => {
  const planet = BASELINE_PLANETS[0]!;

  it('현행 파생 경로의 uniqueMask 가 시그니처 비트대를 전혀 쓰지 않는다 (전 빌드)', () => {
    for (const build of BASELINE_BUILDS) {
      const { loadout } = assembleRunConfigLikeMain(build.invest);
      const mask = loadout.uniqueMask;
      for (const bit of SIGNATURE_BITS) {
        expect(hasSignature(mask, bit), `${build.id}: 비트 ${bit} 가 이미 점유됨`).toBe(false);
      }
      // 캡스톤 빌드는 실제로 15~17 대역을 켠다(경로가 살아 있다는 증거).
      if (build.id.startsWith('capstone') || build.id === 'near-max') {
        expect(mask, `${build.id}: 캡스톤 비트 미점등`).toBeGreaterThan(0);
      }
    }
  });

  it('스트라이커 런을 실제로 굴려도 시그니처 대역이 켜지지 않고, 실 피해값이 정수로 남는다', () => {
    const build = BASELINE_BUILDS[5]!; // 만렙 근접 — 파생이 가장 많이 붙는 빌드
    const { loadout, skillInvest } = assembleRunConfigLikeMain(build.invest);
    const config = baselineConfig(planet, build.invest);
    // 앱 경로 파생이 골든 시나리오 config 와 실제로 같은가(배선 증명).
    expect(config.loadout).toEqual(loadout);
    expect(config.skillInvest).toEqual(skillInvest);

    const seed = 12345;
    const inputs = driveBaseline(seed, config, 600);
    const state = createWorld(seed, config);
    for (const f of inputs) stepWorld(state, f as InputFrame);
    expect(state.tick).toBe(600);

    const mask = config.loadout?.uniqueMask ?? 0;
    for (const bit of SIGNATURE_BITS) expect(hasSignature(mask, bit)).toBe(false);

    // 실제 sim 이 만든 피해 크기를 시그니처 함수에 통과시켜 정수 계약을 확인한다
    // (합성 스윕만으로는 실 게임 값 대역을 안 탄다).
    const damages = state.entities
      .filter((e) => !e.dead && e.damage > 0)
      .map((e) => Math.trunc(e.damage));
    expect(damages.length, '런에서 피해를 가진 엔티티가 없다 — 공허 런').toBeGreaterThan(0);
    for (const d of damages) {
      expect(Number.isInteger(armorReducedDamage(d, ARMOR_MAX_STACKS))).toBe(true);
      expect(Number.isInteger(overchargedDamage(d, OVERCHARGE_STILL_TICKS))).toBe(true);
      expect(Number.isInteger(cloakBreakDamage(d))).toBe(true);
    }
  });
});
