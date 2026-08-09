/**
 * 침공 런 풀 XP — **레벨업이 일어나지 않는다** (2026-08-10, 사용자 지시).
 *
 * ## 이 파일의 이력 (하루 만에 뒤집혔다 — 기록해 둔다)
 * 어제 이 파일은 "런당 종료 레벨이 5~8 대역인가"를 지켰다. 밀도 축이 L1 총 스폰을 25 → 240 으로
 * 올리면서 침공 XP 계수가 낡아 레벨업이 3.2 → 20.8 회로 폭주했고("레벨업 카드가 너무 자주
 * 나와"), 계수를 `10+6L` → `10+66L` 로 다시 재 6.6 회로 맞춘 직후였다.
 *
 * 그 다음 사용자 결정이 **"침공에서는 레벨업 카드 없앤다"** 였다. 침공은 엔드게임 PvP 라
 * 런 안에서 강해지는 무대가 아니라 이미 강해진 것을 시험하는 무대다. 그래서 대역 가드는
 * 지킬 대상을 잃었고, 이 파일은 **"0회인가"** 를 지키는 쪽으로 다시 쓰였다.
 *
 * ## 왜 계수 대신 이걸 지키는가
 * 「레벨업이 없다」는 값이 아니라 **계약**이다. 밀도·장비·시드를 아무리 돌려도 침공에서
 * 파워업 3택이 뜨면 그것은 회귀다. 반대로 PvE 쪽은 건드리지 않았음을 함께 못 박는다 —
 * 술어가 하나(`xpToNextForRun`)라 한쪽을 고치면 반대쪽이 조용히 딸려갈 수 있다.
 *
 * ⚠️ 여기 단언이 깨지면 **메타 풀(`state.xpTotal`)까지 같이 죽었는지** 먼저 보라. 없앤 것은
 * 런 풀 3택뿐이고 계정 성장은 그대로여야 한다(ADR-0036 이원화). 아래 마지막 블록이 그 축이다.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld,
  stepWorld,
  packPowerupPick,
  xpToNext,
  xpToNextInvasion,
  xpToNextForRun,
  NO_LEVELUP,
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

/** 대역을 재는 시드. */
const SEEDS = [4242, 48879, 4951, 7, 12345] as const;

function invasionConfig(density: InvasionDensity = INVASION_DENSITY_DEFAULT): WorldConfig {
  return {
    ...DEFAULT_CONFIG,
    // 관측 대상은 XP 유입이지 생존이 아니다 — 중간에 죽으면 남은 구간이 통째로 빠진다.
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
 * 침공 런 하나를 끝까지 돌린다. **오토파일럿으로 돌린다** — 무입력은 적을 거의 못 잡아
 * XP 유입을 통째로 과소평가한다(실측: 무입력이면 밀도 차이 6.5배가 1.0 vs 3.0 으로 눌린다).
 *
 * 레벨업이 떠 있으면 그 프레임에 0번을 소비한다. **없어야 정상이지만 소비 경로는 남긴다** —
 * 회귀로 3택이 떠 버렸을 때 월드가 정지한 채 예산만 흘러 "레벨 1 · 통과"라는 거짓 초록이
 * 되는 것을 막는다.
 */
function runInvasion(density?: InvasionDensity): { level: number; picks: number; xpTotal: number } {
  const s: WorldState = createWorld(SEEDS[0], invasionConfig(density));
  let picks = 0;
  for (let i = 0; i < INVASION_TOTAL_TICKS; i++) {
    const pending = s.pendingLevelUp === true;
    if (pending) picks++;
    const base: InputFrame = autopilotInput(s);
    stepWorld(s, pending ? { ...base, special: packPowerupPick(0) } : base);
    if (s.gameOver || s.victory) break;
  }
  return { level: s.level, picks, xpTotal: s.xpTotal };
}

describe('침공 — 레벨업 없음(계약)', () => {
  it('침공 커브는 NO_LEVELUP 을 돌려준다(레벨 무관)', () => {
    for (const lv of [0, 1, 5, 12, 99]) expect(xpToNextInvasion(lv)).toBe(NO_LEVELUP);
    expect(NO_LEVELUP).toBe(0);
  });

  it('침공 런은 그 커브를, PvE 런은 PvE 커브를 탄다', () => {
    const inv = createWorld(1, invasionConfig());
    expect(xpToNextForRun(inv)).toBe(NO_LEVELUP);

    const pve = createWorld(1, { ...DEFAULT_CONFIG } as WorldConfig);
    expect(xpToNextForRun(pve)).toBe(xpToNext(pve.level));
    // PvE 는 **여전히 레벨업이 있다** — 침공 쪽을 0 으로 만든 것이 반대쪽으로 새지 않았는가.
    expect(xpToNextForRun(pve)).toBeGreaterThan(0);
  });

  it('런 전체를 돌려도 3택이 한 번도 뜨지 않고 레벨이 1 그대로다', () => {
    for (const seed of SEEDS) {
      const s: WorldState = createWorld(seed, invasionConfig());
      let picks = 0;
      for (let i = 0; i < INVASION_TOTAL_TICKS; i++) {
        if (s.pendingLevelUp === true) picks++;
        stepWorld(s, autopilotInput(s));
        if (s.gameOver || s.victory) break;
      }
      expect(picks, `seed ${seed}: 3택이 ${picks}프레임 떴다`).toBe(0);
      expect(s.level, `seed ${seed}`).toBe(1);
    }
  });

  it('밀도를 크게 올려도 여전히 0회다(계수가 아니라 계약이라는 확인)', () => {
    // 어제 결함의 정확한 형태가 "밀도를 올렸더니 레벨업이 폭주"였다. 그 입력을 그대로 넣어
    // 이제는 아무 일도 안 일어나는지 본다 — 공허 검증이 아니도록 XP 는 실제로 쌓여야 한다.
    const r = runInvasion({ ...INVASION_DENSITY_DEFAULT, l1IntervalTicks: 45, l1Repeats: 16 });
    expect(r.picks).toBe(0);
    expect(r.level).toBe(1);
    expect(r.xpTotal, '젬을 하나도 안 먹었다면 이 테스트는 공허하다').toBeGreaterThan(0);
  });
});

describe('침공 — 메타 성장은 살아 있다', () => {
  it('런 풀 3택은 없어도 메타 풀(기체 영구 레벨)은 계속 쌓인다', () => {
    // 없앤 것은 '카드'뿐이다. 이것까지 죽으면 침공을 돌 이유가 사라진다(ADR-0036 이원화).
    const r = runInvasion();
    expect(r.picks).toBe(0);
    expect(r.xpTotal).toBeGreaterThan(0);
  });
});
