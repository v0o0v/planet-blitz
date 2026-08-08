/**
 * **보스 HP 단계 곡선**의 계약 (`src/sim/enemyScale.ts` `bossStageHpMult`).
 *
 * 사용자 신고(2026-08-08): *"보스의 HP가 낮아서 10단계와 20단계에서 테스트 했을 때 너무 빨리
 * 죽었어. 거의 3초안에 죽은거 같아. 30초 정도는 버틸 수 있게 수정해줘."*
 *
 * ## 이 파일이 재는 것 — 셋
 *  1. **단계 1 은 정확히 ×1**(사용자 판정 지점 + 골든 기준 무대). 이 하나가 깨지면 기존 골든이
 *     전부 갈리므로 절대값으로 못 박는다.
 *  2. **곡선의 모양** — 단조 비감소이고, 잡몹 곡선(`stageHpMult`)보다 **훨씬 완만**하다.
 *     모양을 지키는 것이 이 곡선의 존재 이유다(그쪽을 그대로 쓰면 단계 20 TTK 가 약 267초다).
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

  it('사용자가 지목한 두 단계에서 목표 배수에 닿는다', () => {
    // 사용자 실측 눈금: HP 7,200 에서 «거의 3초» → 실효 DPS ≈ 2,400 → 30초에 필요한 HP ≈ 72,000
    // = 지금의 약 ×10. 앵커 주석이 정본이고 여기서는 그 역산 결과를 못 박는다.
    expect(bossStageHpMult(10)).toBeCloseTo(9.1, 6);
    expect(bossStageHpMult(20)).toBeCloseTo(10.9, 6);
    // 실제 보스 HP(카르곤 3,600 기준)로 환산해 «수만 단위» 임을 함께 잠근다 — 배수만 보면
    // 다음 사람이 `BOSS_HP_MULT` 를 같이 만졌을 때 총량이 갈린 것을 놓친다.
    const kargonBossHp = 3600;
    expect(Math.round(kargonBossHp * BOSS_HP_MULT * bossStageHpMult(10))).toBe(65520);
    expect(Math.round(kargonBossHp * BOSS_HP_MULT * bossStageHpMult(20))).toBe(78480);
  });

  it('잡몹 곡선보다 훨씬 완만하다 — 그것이 이 곡선이 따로 있는 이유다', () => {
    // 잡몹은 «여러 마리가 동시에 만드는 압박» 축이라 가파르고(단계 20 에서 ×80.8), 보스는
    // «한 기와 얼마나 오래 싸우는가» 라 눈금이 다르다. 잡몹 곡선을 보스에 그대로 걸면 단계 20
    // TTK 가 약 267초가 된다 — 이 단언이 그 되돌림을 막는다.
    for (const s of [10, 15, 20, 30]) {
      expect(bossStageHpMult(s), `단계 ${s}`).toBeLessThan(stageHpMult(s));
    }
    // 단계 20 기준으로 잡몹 곡선의 **1/5 미만**이어야 한다(실측 10.9 vs 80.8 = 약 1/7.4).
    expect(bossStageHpMult(20) * 5).toBeLessThan(stageHpMult(20));
  });

  it('21 단계 위는 완만한 기울기를 연장한다 (화력이 거기서 평평하다)', () => {
    // 단계당 0.1 — 21 → 31 이 정확히 +1 이다. 잡몹 곡선처럼 가파르게 이으면 여기가 빨개진다.
    expect(bossStageHpMult(31) - bossStageHpMult(21)).toBeCloseTo(1, 6);
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
