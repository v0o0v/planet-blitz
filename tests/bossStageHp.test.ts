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
 *     골랐다) · 단계 20 이 목표 TTK 에 닿는다 · 결정론을 위해 `Math.pow` 가 아니라 반복 곱.
 *  3. **두 스폰 지점이 같은 배수를 쓴다** — `world.ts` 의 보스와 `modes/chase.ts` 의 포식자는
 *     같은 무대의 같은 개체라 한쪽만 걸면 무대에 따라 HP 가 달라진다(그 상수 주석의 경고).
 *
 * ⚠️ **실측 TTK(초)는 여기서 못 잰다.** 그 축은 사람이 판정한다 — 리포 안 계측기 둘
 * (`bench/gearDps.ts` · `bench/bossTtk.ts`)이 모두 사람 눈금과 갈렸고, 그 표가
 * `bossStageHpMult` 주석에 있다. 아래 `ttkAt()` 은 sim 을 한 틱도 안 돌리는 **닫힌 모델**이고,
 * 그 상수를 고를 때 쓴 눈금 그대로다(`bench/gearLevelCurve.ts` 와 같은 식). 여기서 잠그는 것은
 * «그 모델에서 곡선이 서 있는가» 이지 «사람이 실제로 몇 초 걸리는가» 가 아니다.
 *
 * ## ⚠️ 2026-08-08 3차 — «잡몹 곡선보다 완만하다» 단언을 **뜯어냈다**
 * 그 단언의 전제(플레이어 화력이 레벨과 무관)를 PR#399 가 깼다. 잡몹 곡선은 구간선형이고
 * 플레이어 화력은 이제 지수라, 잡몹 곡선을 보스에 걸면 깊은 단계에서 보스전이 **되레 짧아진다**
 * — 즉 그 곡선은 더 이상 상한이 아니다. 같은 것을 지키되 눈금을 바꿔 다시 썼다: **보스 TTK 가
 * 단계를 따라 단조 증가한다**(⇔ 공비 > 레벨 성장의 단계당 공비). 잡몹 곡선으로 되돌리면 그
 * 단언이 먼저 빨개진다 — 아래 반증 단언이 그 사실 자체를 값으로 못 박는다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bossStageHpMult, BOSS_HP_MULT } from '../src/sim/enemyScale.js';
import { stageHpMult } from '../data/waves.js';
import { pilotLevelMult } from '../src/items/loadout.js';
import { LEVEL_PER_STAGE } from '../src/save/progressionPath.js';

/** 카르곤 보스의 `data/bosses` 저작값. 실효 HP 는 여기에 `BOSS_HP_MULT` 와 단계 곡선이 곱해진다. */
const KARGON_BOSS_HP = 3600;
/**
 * 보스전 실효 DPS 의 **사용자 실측 눈금 — Lv1 기준**(`enemyScale.ts` 가 정본: HP 7,200 을
 * «거의 3초»). ⚠️ 2026-08-08 3차부터 이 값은 «레벨 무관 상수» 가 아니라 «Lv1 절편» 이다 —
 * 레벨 성장(`pilotLevelMult`)이 위에 곱해진다.
 */
const USER_MEASURED_BOSS_DPS_LV1 = 2400;

/**
 * 단계 s 의 보스 TTK(초) — **정본 파생**이다(리터럴 HP 를 박지 않는다).
 * 단계 s 의 표준 조종사 레벨은 `s × LEVEL_PER_STAGE` 다.
 */
function ttkAt(stage: number): number {
  const hp = KARGON_BOSS_HP * BOSS_HP_MULT * bossStageHpMult(stage);
  const dps = USER_MEASURED_BOSS_DPS_LV1 * pilotLevelMult(stage * LEVEL_PER_STAGE);
  return hp / dps;
}

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

  it('단계 20 의 보스 TTK 가 사용자 목표 65초다 (레벨-연동 DPS 눈금)', () => {
    // 사용자 결정(2026-08-08 3차): *"단계 20 보스 TTK 를 65초로 복구한다."* PR#399 의 조종사
    // 레벨 성장이 2차 판 공비를 먹어 13.1초까지 떨어져 있었다.
    expect(ttkAt(20)).toBeCloseTo(65, 0);
    // ⭐ 한 점이 아니라 곡선 전체가 PR#399 **이전** 모양으로 돌아온다는 것이 이 공비의 근거다
    //   (`1.2797 ≈ 1.1761 × 1.0847` = 옛 공비 × 레벨 성장의 단계당 공비). 중간 단계도 잠근다 —
    //   한 점만 맞추고 사이가 휜 곡선을 이 단언이 막는다. PR#399 이전 실측: 단계10 12.9초.
    expect(ttkAt(10)).toBeGreaterThan(12);
    expect(ttkAt(10)).toBeLessThan(14);
    // 단계 1 은 곡선이 ×1 이라 «Lv5 화력으로 7,200» 그대로다(앵커 불변의 다른 얼굴).
    expect(ttkAt(1)).toBeCloseTo(2.8, 1);
  });

  it('보스 TTK 가 단계를 따라 단조 증가한다 — 공비 > 레벨 성장의 단계당 공비', () => {
    // 이것이 «잡몹 곡선보다 완만하다» 를 대체한 계약이다(파일 헤더 §3차). 플레이어 화력이
    // 단계당 ×1.0847 로 자라므로, 공비가 그보다 작으면 깊은 단계에서 보스전이 **짧아진다**.
    for (let s = 1; s <= 30; s++) {
      expect(ttkAt(s + 1), `단계 ${s} → ${s + 1} 에서 보스전이 짧아졌다`).toBeGreaterThan(ttkAt(s));
    }
    // 부등식 자체를 값으로도 못 박는다(단계당 레벨 배수 = `pilotLevelMult` 의 5레벨분).
    const perStageLevelGrowth = pilotLevelMult(1 + LEVEL_PER_STAGE) / pilotLevelMult(1);
    expect(bossStageHpMult(3) / bossStageHpMult(2)).toBeGreaterThan(perStageLevelGrowth);
  });

  it('⚠️ 반증 — 잡몹 곡선으로 되돌리면 깊은 단계에서 보스전이 되레 짧아진다', () => {
    // 옛 단언(«보스는 잡몹 곡선보다 완만해야 한다»)이 왜 죽었는지를 값으로 남긴다. 잡몹은
    // 구간선형이고 플레이어 화력은 지수라, 그 곡선을 보스에 걸면 단계 20 이 정점이고 그 뒤로
    // 내려간다(48.4초 → 25단계 46.6초 → 30단계 40.6초). ⇒ 상한으로도 못 쓴다.
    const mobTtk = (s: number) =>
      (KARGON_BOSS_HP * BOSS_HP_MULT * stageHpMult(s)) /
      (USER_MEASURED_BOSS_DPS_LV1 * pilotLevelMult(s * LEVEL_PER_STAGE));
    expect(mobTtk(30)).toBeLessThan(mobTtk(20));
    expect(mobTtk(20)).toBeLessThan(65); // 목표에도 못 미친다
  });

  it('잡몹 곡선과의 교차 단계를 기록한다 — 3차 공비에서 단계 19 로 당겨졌다', () => {
    // 놀라지 않도록 사실 자체를 못 박는다(2차 판은 단계 33 이었다). 이것은 결함이 아니다 —
    // 보스 배수가 잡몹 배수보다 크다는 것은 «한 기와 오래 싸운다» 축이 «여러 마리가 압박한다»
    // 축과 다른 눈금이라는 뜻일 뿐이고, 실제 계약은 위 TTK 단조성이다.
    expect(bossStageHpMult(18)).toBeLessThan(stageHpMult(18));
    expect(bossStageHpMult(19)).toBeGreaterThan(stageHpMult(19));
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
