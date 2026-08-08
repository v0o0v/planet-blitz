/**
 * **보스 HP 단계 곡선**의 계약 (`src/sim/enemyScale.ts` `bossStageHpMult`).
 *
 * 사용자 신고(2026-08-08): *"보스의 HP가 낮아서 10단계와 20단계에서 테스트 했을 때 너무 빨리
 * 죽었어. 거의 3초안에 죽은거 같아. 30초 정도는 버틸 수 있게 수정해줘."*
 *
 * ## 이 파일이 재는 것 — 셋
 *  1. **단계 1 은 정확히 ×1**(사용자 판정 지점 + 골든 기준 무대). 이 하나가 깨지면 기존 골든이
 *     전부 갈리므로 절대값으로 못 박는다.
 *  2. **곡선의 형식과 눈금** — 단조 비감소 · **등비수열**(사용자가 지수 형식을 명시적으로
 *     골랐다) · 단계 20 이 목표 배수에 닿는다 · 결정론을 위해 `Math.pow` 가 아니라 반복 곱.
 *  3. **두 스폰 지점이 같은 배수를 쓴다** — `world.ts` 의 보스와 `modes/chase.ts` 의 포식자는
 *     같은 무대의 같은 개체라 한쪽만 걸면 무대에 따라 HP 가 달라진다(그 상수 주석의 경고).
 *
 * ⚠️ **절대 TTK(초)는 여기서 못 잰다.** 그 축은 사람이 판정한다 — 리포 안 계측기 둘
 * (`bench/gearDps.ts` · `bench/bossTtk.ts`)이 모두 사람 눈금과 갈렸고, 그 표가
 * `bossStageHpMult` 주석에 있다. 여기서는 **곡선의 형태 계약**만 잠근다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bossStageHpMult, BOSS_HP_MULT } from '../src/sim/enemyScale.js';
import { stageHpMult } from '../data/waves.js';

describe('보스 HP 단계 곡선 — 형태 계약', () => {
  it('단계 1 은 정확히 ×1 이다 (골든 기준 무대 · 사용자 판정 지점)', () => {
    // 부동소수 근사가 아니라 **정확히** 1 이어야 한다 — 구간선형 식으로 계산하면 오차가 새고
    // 그러면 단계1 골든 해시가 흔들린다(`stageHpMult` 와 같은 early-return 규율).
    expect(bossStageHpMult(1)).toBe(1);
    expect(bossStageHpMult(0)).toBe(1); // 하한 클램프
    expect(bossStageHpMult(-5)).toBe(1);
  });

  it('단조 비감소다 (깊은 단계가 얕은 단계보다 얇아지지 않는다)', () => {
    let prev = -Infinity;
    for (let s = 1; s <= 40; s++) {
      const v = bossStageHpMult(s);
      expect(v, `단계 ${s} 에서 곡선이 내려갔다`).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('등비수열이다 — 인접 단계의 비가 전 구간에서 같다', () => {
    // 곡선의 **형식**이 계약이다(사용자 지시: "단계1은 현재 값으로 고정하고 그 뒤로 어느정도
    // 지수적으로 올라가서 20단계가 두배가 되도록"). 구간선형으로 되돌리면 여기가 먼저 빨개진다.
    for (let s = 2; s <= 30; s++) {
      const ratio = bossStageHpMult(s + 1) / bossStageHpMult(s);
      expect(ratio, `단계 ${s} → ${s + 1} 의 비가 다르다`).toBeCloseTo(
        bossStageHpMult(3) / bossStageHpMult(2),
        10,
      );
    }
  });

  it('단계 20 이 목표 배수(구 구간선형 판의 정확히 두 배)에 닿는다', () => {
    // 1차 판(구간선형)의 단계 20 은 ×10.9 였고, 사용자가 그 두 배를 지시했다 → 21.8.
    expect(bossStageHpMult(20)).toBeCloseTo(21.8, 1);
    // 실제 보스 HP(카르곤 3,600 기준)로도 잠근다 — 배수만 보면 다음 사람이 `BOSS_HP_MULT` 를
    // 같이 만졌을 때 총량이 갈린 것을 놓친다. 1차 판 78,480 의 정확히 두 배다.
    const kargonBossHp = 3600;
    expect(Math.round(kargonBossHp * BOSS_HP_MULT * bossStageHpMult(20))).toBe(156954);
    expect(Math.round(kargonBossHp * BOSS_HP_MULT * bossStageHpMult(10))).toBe(30998);
  });

  it('실플레이 구간(≤ 단계 20)에서는 잡몹 곡선보다 완만하다 — 교차 지점도 못 박는다', () => {
    // 잡몹 곡선을 보스에 그대로 걸면 단계 20 TTK 가 약 267초가 된다(그 상수 주석) — 그
    // 되돌림을 막는 단언이다. **범위를 명시하는 것이 핵심이다**: 잡몹은 구간선형이고 보스는
    // 등비수열이라 언젠가 반드시 교차한다. 실측 교차점은 **단계 31~32 부근**이다.
    for (const s of [5, 10, 15, 20, 25, 30]) {
      expect(bossStageHpMult(s), `단계 ${s} 에서 보스가 잡몹 곡선보다 가파르다`).toBeLessThan(
        stageHpMult(s),
      );
    }
    // 교차가 실플레이 구간(사용자가 도는 ~20단계) 한참 밖에 있음을 값으로 잠근다.
    // ⚠️ 여기가 빨개지면 «지수가 너무 가파르다» 는 신호다 — 공비를 재검토하라(형식이 아니라 값).
    expect(bossStageHpMult(20) * 3).toBeLessThan(stageHpMult(20));
    // 그리고 깊은 단계에서는 실제로 뒤집힌다는 사실 자체도 기록한다(놀라지 않도록).
    expect(bossStageHpMult(35)).toBeGreaterThan(stageHpMult(35));
  });

  it('`Math.pow` 를 쓰지 않는다 — 반복 곱이어야 결정론이 선다', () => {
    // 소스 대조다. `Math.pow`/`**` 는 IEEE-754 가 정확 반올림을 요구하지 않아 엔진·플랫폼에
    // 따라 마지막 비트가 갈릴 수 있고, 이 값은 적 HP 로 `hashWorld` 에 접힌다 — 갈리면 곧
    // 리플레이·골든 불일치다. `src/sim/**` 전체가 같은 이유로 `Math.pow` 를 안 쓴다.
    const src = readFileSync(
      fileURLToPath(new URL('../src/sim/enemyScale.ts', import.meta.url)),
      'utf8',
    );
    expect(src.includes('Math.pow('), 'enemyScale.ts 가 Math.pow 를 쓴다').toBe(false);
    // 공비가 리터럴인지도 함께 본다(`21.8 ** (1/19)` 로 계산하면 같은 함정이다).
    expect(/const BOSS_HP_GROWTH_PER_STAGE = [0-9.]+;/.test(src), '공비가 리터럴이 아니다').toBe(
      true,
    );
  });

  it('깊은 단계에서도 유한하다 (반복 곱 루프 가드)', () => {
    // 지수 곡선 + 무한히 깊어지는 단계(`stageOpenCap`) 조합의 폭주를 막는 가드가 있는지.
    // 값 자체가 아니라 «유한하고 계산이 끝난다» 만 본다.
    const deep = bossStageHpMult(100000);
    expect(Number.isFinite(deep)).toBe(true);
    expect(deep).toBeGreaterThan(bossStageHpMult(20));
  });
});

describe('보스 HP 단계 곡선 — 두 스폰 지점이 같은 배수를 쓴다', () => {
  it('`world.ts` 와 `modes/chase.ts` 가 둘 다 `bossStageHpMult` 를 곱한다', () => {
    // 소스 대조다. 추격 모드의 포식자는 별도 개체가 아니라 **그 무대의 보스 그 자체**라
    // 한쪽만 걸면 같은 보스가 무대에 따라 HP 가 달라지고 **화면에 아무 흔적을 안 남긴다**
    // (`BOSS_HP_MULT` 주석의 «두 스폰 지점에 함께 걸어야 한다» 가 이 곡선에도 그대로 적용된다).
    // 런타임으로는 두 무대를 같은 조건에 세울 수 없어(추격은 취약화 국면이 앞에 있다) 정적으로 잰다.
    const files = ['src/sim/world.ts', 'src/sim/modes/chase.ts'] as const;
    for (const f of files) {
      const src = readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), 'utf8');
      expect(src.includes('bossStageHpMult('), `${f} 가 단계 곡선을 안 곱한다`).toBe(true);
      expect(src.includes('BOSS_HP_MULT'), `${f} 가 보스 배수를 안 곱한다`).toBe(true);
    }
  });
});
