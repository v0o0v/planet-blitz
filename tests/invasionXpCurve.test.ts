/**
 * 침공 런 풀 XP 곡선 — **레벨업 빈도 대역 가드** (2026-08-10 밀도 레인).
 *
 * ## 왜 이 파일이 필요한가
 * 사용자 제기 "레벨업 카드가 너무 자주 나와"의 원인은 XP 곡선이 아니라 **적 밀도**였다.
 * `xpToNextInvasion` 의 `10 + 6L` 은 "침공은 젬 획득량이 훨씬 적다"는 전제 위에 잡힌 값인데,
 * 밀도 축이 L1 총 스폰을 25 → 240 으로 올리면서 그 전제가 무너져 런당 레벨업이
 * **3.2 → 20.8** 로 폭주했다. 그동안 단위 테스트는 전부 초록이었다 — 두 축이 코드로 이어져
 * 있지 않아 **아무것도 그 연결을 지키지 않았다**.
 *
 * 같은 사고가 PvE 에서 이미 한 번 있었다(`xpToNext` 주석: `killGoal` 합계 80 → 240 에
 * `10 + 13L` 이 남아 레벨업 14~18회). 두 번 밟았으므로 가드를 둔다.
 *
 * ## 무엇을 지키는가 — 골든이 아니라 **대역**이다
 * "정확히 6.6회"를 박지 않는다. 밀도는 사용자가 하네스에서 계속 돌릴 축이라, 골든을 박으면
 * 슬라이더를 만질 때마다 이 파일이 깨져 튜닝 자체가 비싸진다. 대신 **사람이 판단한 대역**
 * (PvE 와 같은 5~8회)만 지킨다 — 이 대역을 벗어나면 그것은 "값이 달라졌다"가 아니라
 * "밀도를 바꿔 놓고 XP 계수를 안 쟀다"는 뜻이다.
 *
 * ⚠️ 여기 단언이 깨지면 `xpToNextInvasion` 을 고치기 전에 **밀도 기본값을 먼저 보라.**
 * 대개 원인은 이 파일이 아니라 `src/sim/invasion/density.ts` 쪽이다.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld,
  stepWorld,
  packPowerupPick,
  xpToNext,
  xpToNextInvasion,
  xpToNextForRun,
  DEFAULT_CONFIG,
  type InputFrame,
  type WorldConfig,
  type WorldState,
} from '../src/sim/world.js';
import { autopilotInput } from '../src/sim/autopilot.js';
import {
  INVASION_DENSITY_DEFAULT,
  INVASION_TOTAL_TICKS,
  emptyInvasionLayers,
  type InvasionDensity,
} from '../src/sim/invasion/index.js';

/** 레벨업 빈도 목표 대역(런당 종료 레벨). PvE 와 같은 5~8 회. */
const LEVELUP_MIN = 5;
const LEVELUP_MAX = 8;

/** 대역을 재는 시드. 늘리면 해상도가 오르지만 이 파일이 느려진다. */
const SEEDS = [4242, 48879, 4951, 7, 12345] as const;

function invasionConfig(density: InvasionDensity): WorldConfig {
  return {
    ...DEFAULT_CONFIG,
    // 관측 대상은 **XP 유입**이지 생존이 아니다. 중간에 죽으면 남은 구간의 XP 가 통째로
    // 빠져 레벨업 횟수를 과소평가한다.
    playerHp: 100_000_000,
    invasion3: {
      layers: emptyInvasionLayers(),
      timeLimitTicks: INVASION_TOTAL_TICKS,
      maintenance: 10000,
      density,
    },
  } as WorldConfig;
}

/**
 * 침공 런 하나를 끝까지 돌리고 종료 레벨을 돌려준다.
 *
 * **오토파일럿으로 돌린다.** 무입력은 적을 거의 못 잡아 XP 유입을 통째로 과소평가한다 —
 * 실제로 무입력으로 재면 구·신 밀도가 각각 1.0 / 3.0 으로 눌려 6.5배 차이가 안 보였다.
 * 레벨업이 뜨면 그 프레임에 0번을 소비한다(안 하면 월드가 정지한 채 예산만 흐른다).
 */
function endLevel(density: InvasionDensity, seed: number): number {
  const s: WorldState = createWorld(seed, invasionConfig(density));
  for (let i = 0; i < INVASION_TOTAL_TICKS; i++) {
    const pending = s.pendingLevelUp !== undefined && s.pendingLevelUp !== null;
    const base: InputFrame = autopilotInput(s);
    stepWorld(s, pending ? { ...base, special: packPowerupPick(0) } : base);
    if (s.gameOver || s.victory) break;
  }
  return s.level;
}

describe('침공 XP 곡선 — 커브 분기', () => {
  it('침공 런은 침공 커브를, PvE 런은 PvE 커브를 쓴다', () => {
    const inv = createWorld(1, invasionConfig(INVASION_DENSITY_DEFAULT));
    expect(xpToNextForRun(inv)).toBe(xpToNextInvasion(inv.level));

    const pve = createWorld(1, { ...DEFAULT_CONFIG } as WorldConfig);
    expect(xpToNextForRun(pve)).toBe(xpToNext(pve.level));
  });

  it('레벨 0 에서 두 커브가 같다(구간 겹침 — 분모 표시 결함이 여기서 숨었었다)', () => {
    // 2026-07-27 에 HUD 분모만 PvE 커브로 남아 침공에서 11배 부풀어 표시된 적이 있는데,
    // 레벨 0 에서 두 커브가 우연히 같아 발견이 늦었다. 그 겹침을 사실로 기록해 둔다.
    expect(xpToNextInvasion(0)).toBe(xpToNext(0));
  });
});

describe('침공 XP 곡선 — 레벨업 빈도 대역', () => {
  it(`현행 밀도에서 런당 종료 레벨이 ${LEVELUP_MIN}~${LEVELUP_MAX} 대역이다`, () => {
    const levels = SEEDS.map((s) => endLevel(INVASION_DENSITY_DEFAULT, s));
    const avg = levels.reduce((a, b) => a + b, 0) / levels.length;
    // 평균이 대역 안에 있고, 개별 시드도 대역에서 크게 벗어나지 않아야 한다.
    expect(avg, `종료 레벨 ${levels.join(',')} (평균 ${avg})`).toBeGreaterThanOrEqual(LEVELUP_MIN);
    expect(avg, `종료 레벨 ${levels.join(',')} (평균 ${avg})`).toBeLessThanOrEqual(LEVELUP_MAX);
    for (const lv of levels) {
      expect(lv, `개별 시드 이탈: ${levels.join(',')}`).toBeGreaterThanOrEqual(LEVELUP_MIN - 2);
      expect(lv, `개별 시드 이탈: ${levels.join(',')}`).toBeLessThanOrEqual(LEVELUP_MAX + 2);
    }
  });

  it('밀도가 XP 유입을 실제로 움직인다(두 축이 이어져 있다는 공허 방어)', () => {
    // 위 대역 단언이 "밀도와 무관하게 우연히 맞은 것"이 아님을 보인다.
    //
    // ⚠️ 대조군은 **구 밀도**여야 한다. 처음에는 "더 빽빽하게 하면 레벨이 더 오른다"로 썼다가
    // 틀렸다 — 45틱×16바퀴로 올렸더니 오히려 7 → 5 로 **내려갔다**. 참조봇의 DPS 가 이미
    // 포화라, 그보다 빨리 나오는 적은 처치되지 않고 화면을 지나쳐 정리된다(= XP 0).
    // 밀도는 XP 를 단조 증가시키지 않는다. 이 사실 자체가 밀도 튜닝에서 기억할 값이다.
    const legacy = endLevel(
      { ...INVASION_DENSITY_DEFAULT, l1IntervalTicks: 720, l1Repeats: 1 },
      4242,
    );
    const current = endLevel(INVASION_DENSITY_DEFAULT, 4242);
    expect(current, `구밀도 ${legacy} vs 현행 ${current}`).toBeGreaterThan(legacy);
  });
});
