/**
 * 경험치 이원화 — 젬 1회가 두 풀에 서로 다른 값을 넣는다 (ADR-0036).
 *
 * 이 저장소의 반복 결함이 **"단위 테스트는 그린인데 배선이 통째로 없다"**(누적 8건)이므로,
 * 순수 함수 단언에 더해 **정규 경로**(`buildRunConfig` → `createWorld` → `stepWorld` →
 * `settleRun`)를 그대로 태워 값이 실제로 흐르는지까지 본다. 하네스 `injectInput` 은 플레이어
 * 경로가 아니라 검증에 쓰지 않는다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  createWorld,
  stepWorld,
  emptyInput,
  stageMetaXpMult,
  xpToNext,
  xpToNextInvasion,
  xpToNextForRun,
  DEFAULT_CONFIG,
} from '../src/sim/world.js';
import { emptyInvasionLayers } from '../src/sim/invasion/normalize.js';
import { INVASION_TOTAL_TICKS } from '../src/sim/invasion/constants.js';
import { spawnGem } from '../src/sim/entities.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import { settleRun, grantXp } from '../src/save/settlement.js';
import {
  xpToNextMeta,
  lowStageXpDecayPercent,
  standardStage,
  MAX_STANDARD_STAGE,
  RUN_META_XP_STAGE1,
} from '../src/save/progressionPath.js';
import { LEVEL_CAP } from '../data/waves.js';

/** 젬 하나를 플레이어 위에 놓고 한 틱 굴려 수집시킨다(정규 collectGem 경로). */
function collectOneGem(stage: number, xpValue: number) {
  const config = buildRunConfig(defaultProfile(), { planet: 0, stage });
  const state = createWorld(1, config);
  const player = state.entities[0]!;
  spawnGem(state, player.x, player.y, xpValue);
  stepWorld(state, emptyInput());
  return { xp: state.xp, xpTotal: state.xpTotal };
}

describe('stageMetaXpMult — 메타 풀 단계 배율', () => {
  it('단계 1 은 ×1 이라 단계1 메타 적립이 구 거동과 같다', () => {
    expect(stageMetaXpMult(1)).toBe(1);
    expect(stageMetaXpMult(undefined)).toBe(1);
    expect(stageMetaXpMult(0)).toBe(1);
    expect(stageMetaXpMult(-3)).toBe(1);
  });

  it('단계에 정수 비례한다(부동소수 오차 없음)', () => {
    for (const s of [2, 3, 7, 11, 21, 41]) expect(stageMetaXpMult(s)).toBe(s);
  });
});

describe('collectGem — 두 풀이 갈렸다 (정규 sim 경로)', () => {
  it('런 풀은 단계 무관 고정, 메타 풀만 단계 비례로 커진다', () => {
    const s1 = collectOneGem(1, 10);
    const s4 = collectOneGem(4, 10);
    // 런 풀: 단계가 4배여도 같은 값 → 런 내 리듬이 단계에 흔들리지 않는다.
    expect(s4.xp).toBe(s1.xp);
    expect(s1.xp).toBeGreaterThan(0);
    // 메타 풀: 정확히 단계 배수.
    expect(s1.xpTotal).toBe(s1.xp);
    expect(s4.xpTotal).toBe(s1.xp * 4);
  });

  it('DEFAULT_CONFIG(단계 미지정) 도 ×1 로 안전하게 떨어진다', () => {
    expect(DEFAULT_CONFIG.stage).toBeUndefined();
    const state = createWorld(1);
    const player = state.entities[0]!;
    spawnGem(state, player.x, player.y, 10);
    stepWorld(state, emptyInput());
    expect(state.xpTotal).toBe(state.xp);
  });
});

describe('런 풀 커브 — 런당 레벨업 리듬 (ADR-0036)', () => {
  it('1차식이며 구 커브(10+6L)보다 가파르다 — 런당 레벨업이 줄어든다', () => {
    // 계수를 하드코딩하지 않는다 — 런 리듬은 적 축(`SEGMENTS.killGoal`)과 함께 움직이는
    // 튜닝 대상이라, 상수를 박으면 재보정 때마다 이 테스트가 "고쳐야 할 대상"이 된다.
    // 불변식은 ①1차식(계차가 일정) ②절편 10 ③구 커브보다 가파름 세 가지다.
    const step = xpToNext(2) - xpToNext(1);
    for (const lv of [1, 3, 7, 12, 50, 99]) {
      expect(xpToNext(lv), `Lv${lv}`).toBe(xpToNext(0) + lv * step);
      expect(xpToNext(lv), `Lv${lv}`).toBeGreaterThan(10 + lv * 6);
    }
    expect(xpToNext(0)).toBe(10);
    expect(step).toBeGreaterThan(6);
  });

  it('단계1 실측 런 XP 가 5~8회 레벨업 대역에 떨어진다', () => {
    // ⚠️ 기대 XP 를 **설계 상수에서 파생**한다. 예전에는 `433`(구 실측)을 리터럴로 박아 뒀는데,
    // 적 곡선 레인이 `killGoal` 합계를 80 → 240 으로 올려 실제 런 XP 가 약 4배가 된 뒤에도
    // 이 테스트는 초록이었다 — 낡은 숫자를 스스로 검사하고 있었기 때문이다.
    // 단계1 은 `stageMetaXpMult(1) = 1` 이라 메타 풀 = 런 풀이므로 RUN_META_XP_STAGE1 이 곧
    // 단계1 런 풀 XP 다. 승리 런은 그보다 약 17% 높다(실측 1,961 / 1,676).
    const levelUpsFor = (runXp: number) => {
      let level = 1;
      let xp = runXp;
      while (xp >= xpToNext(level)) {
        xp -= xpToNext(level);
        level++;
      }
      return level - 1;
    };
    for (const runXp of [RUN_META_XP_STAGE1, Math.round(RUN_META_XP_STAGE1 * 1.17)]) {
      const n = levelUpsFor(runXp);
      expect(n, `runXp ${runXp} → ${n}회`).toBeGreaterThanOrEqual(5);
      expect(n, `runXp ${runXp} → ${n}회`).toBeLessThanOrEqual(8);
    }
  });
});

describe('settleRun — 메타 커브 + 저단계 감쇠 배선 (정규 정산 경로)', () => {
  it('기체 레벨은 xpToNextMeta 로 오른다(런 풀 커브가 아니다)', () => {
    const p = defaultProfile();
    const need = xpToNextMeta(1) + xpToNextMeta(2);
    // 표준 단계 이내(Lv1 → 표준 단계 1)라 무감쇠.
    const out = settleRun(p, { victory: false, loot: [], xpTotal: need, resources: 0, stage: 1 });
    expect(activeShip(p).level).toBe(3);
    expect(out.levelsGained).toBe(2);
    expect(activeShip(p).xp).toBe(0);
  });

  it('저단계 반복 파밍은 적립 전에 깎인다(하한 30%)', () => {
    // Lv99(표준 단계 20)가 단계 1 을 돌면 부족 19 → 하한 30%. 캡 강제와 섞이지 않도록
    // 레벨이 오르지 않는 XP 량을 써서 **적립된 잔여 XP** 로 감쇠를 직접 관측한다.
    const shipLevel = LEVEL_CAP - 1;
    const pct = lowStageXpDecayPercent(shipLevel, 1);
    expect(pct).toBe(30);
    const raw = 10_000;
    const decayed = Math.floor((raw * pct) / 100);
    expect(decayed).toBeLessThan(xpToNextMeta(shipLevel)); // 레벨업 없음

    const p = defaultProfile();
    const ship = activeShip(p);
    ship.level = shipLevel;
    expect(ship.xp).toBe(0);
    settleRun(p, { victory: false, loot: [], xpTotal: raw, resources: 0, stage: 1 });
    expect(ship.level).toBe(shipLevel);
    expect(ship.xp).toBe(decayed);
    expect(ship.xp).toBeLessThan(raw); // 감쇠가 실제로 걸렸다
  });

  it('표준 단계 근처(부족 ≤ 3)는 전액 적립된다', () => {
    const p = defaultProfile();
    const ship = activeShip(p);
    ship.level = 50; // 표준 단계 10
    expect(standardStage(50)).toBe(10);
    settleRun(p, { victory: false, loot: [], xpTotal: 1000, resources: 0, stage: 7 });
    expect(lowStageXpDecayPercent(50, 7)).toBe(100);
    expect(ship.xp).toBe(1000);
  });

  it('단계 미지정(침공·구 세이브)은 감쇠 없이 전액 적립된다', () => {
    const p = defaultProfile();
    const ship = activeShip(p);
    ship.level = LEVEL_CAP - 1;
    settleRun(p, { victory: false, loot: [], xpTotal: 500, resources: 0 });
    expect(ship.xp).toBe(500);
  });

  it('감쇠는 적립 전 레벨 기준으로 한 번만 곱한다(레벨업 도중 배율 불변)', () => {
    // Lv20(표준 4) 이 단계 1 을 돌면 부족 3 → 무감쇠. 여러 레벨이 올라도 도중에 표준 단계가
    // 5,6… 으로 올라 배율이 바뀌면 안 된다(결정론·설명가능성).
    const p = defaultProfile();
    const ship = activeShip(p);
    ship.level = 20;
    expect(lowStageXpDecayPercent(20, 1)).toBe(100);
    const raw = xpToNextMeta(20) + xpToNextMeta(21) + xpToNextMeta(22);
    const out = settleRun(p, { victory: false, loot: [], xpTotal: raw, resources: 0, stage: 1 });
    expect(out.levelsGained).toBe(3);
    expect(ship.level).toBe(23);
    expect(ship.xp).toBe(0); // 전액 적립되었으므로 잔여 0
  });
});

describe('LEVEL_CAP 하드 강제 (ADR-0036)', () => {
  it('grantXp 는 만렙에서 멈추고 초과 XP 를 버린다', () => {
    const ship = activeShip(defaultProfile());
    ship.level = LEVEL_CAP - 2;
    const levels = grantXp(ship, 99_999_999);
    expect(levels).toBe(2);
    expect(ship.level).toBe(LEVEL_CAP);
    expect(ship.xp).toBe(0);
  });

  it('만렙 기체는 정산을 몇 번 돌려도 레벨도 저금도 늘지 않는다', () => {
    const p = defaultProfile();
    const ship = activeShip(p);
    ship.level = LEVEL_CAP;
    for (let i = 0; i < 5; i++) {
      const out = settleRun(p, {
        victory: true,
        loot: [],
        xpTotal: 1_000_000,
        resources: 0,
        planet: 0,
        stage: MAX_STANDARD_STAGE,
      });
      expect(out.levelsGained).toBe(0);
    }
    expect(ship.level).toBe(LEVEL_CAP);
    expect(ship.xp).toBe(0);
    expect(p.skillPoints).toBe(0);
  });
});

describe('정규 경로 통합 — sim 이 낸 메타 XP 가 정산까지 흐른다', () => {
  it('단계 4 런의 xpTotal 이 단계 1 런의 4배이고 그대로 기체 레벨로 들어간다', () => {
    const gem = 40;
    const s1 = collectOneGem(1, gem);
    const s4 = collectOneGem(4, gem);
    expect(s4.xpTotal).toBe(s1.xpTotal * 4);

    // 같은 기체(Lv20 = 표준 단계 4)가 두 런을 정산하면 적립 XP 가 4배 차이로 남는다.
    const mk = () => {
      const p = defaultProfile();
      activeShip(p).level = 20;
      return p;
    };
    const a = mk();
    settleRun(a, { victory: false, loot: [], xpTotal: s1.xpTotal, resources: 0, stage: 1 });
    const b = mk();
    settleRun(b, { victory: false, loot: [], xpTotal: s4.xpTotal, resources: 0, stage: 4 });
    // 둘 다 부족 ≤ 3 이라 무감쇠 → 순수 단계 비례만 남는다.
    expect(activeShip(a).xp).toBe(s1.xpTotal);
    expect(activeShip(b).xp).toBe(s1.xpTotal * 4);
  });
});

/**
 * ## HUD XP 바 분모 == 실제 레벨업 임계 (침공 분모 불일치 회귀)
 *
 * 커브를 PvE/침공으로 가른 2026-07-27 레인이 **판정부만** 분기시키고 HUD 는 `xpToNext` 고정으로
 * 남겼다. 침공 런에서 분모가 11배 부풀어(레벨 1 에서 실제 16 인데 바에는 `/76`) "바가 20% 밖에
 * 안 찼는데 레벨업이 터진다"로 보였다. **레벨 0 은 두 커브가 우연히 둘 다 10** 이라 첫 레벨업만
 * 보고는 알 수 없었던 것이 발견을 늦춘 원인이다 — 그래서 아래 단언은 레벨 0 을 넘겨서 잰다.
 *
 * 술어를 두 곳에 적은 것이 원인이므로 불변식도 두 층이다: ①분기 함수가 sim 의 실제 임계와
 * 같은가(정규 경로) ②`main.ts` 가 그 함수를 쓰는가(배선 — 이 저장소 반복 결함 "단위는 그린인데
 * 배선이 없다").
 */
describe('xpToNextForRun — HUD 분모와 판정 임계가 한 함수다', () => {
  const invasionWorld = () =>
    createWorld(1, {
      ...DEFAULT_CONFIG,
      invasion3: { layers: emptyInvasionLayers(), timeLimitTicks: INVASION_TOTAL_TICKS },
    });

  it('런 종류별로 각 커브를 낸다(침공은 PvE 보다 완만)', () => {
    const pve = createWorld(1);
    const inv = invasionWorld();
    for (const level of [0, 1, 5, 12]) {
      pve.level = level;
      inv.level = level;
      expect(xpToNextForRun(pve), `PvE Lv${level}`).toBe(xpToNext(level));
      expect(xpToNextForRun(inv), `침공 Lv${level}`).toBe(xpToNextInvasion(level));
    }
    // 레벨 0 만 두 커브가 같다 — 이 우연이 결함을 가렸으므로 명시적으로 못 박는다.
    pve.level = 0;
    inv.level = 0;
    expect(xpToNextForRun(pve)).toBe(xpToNextForRun(inv));
  });

  it('정규 sim 경로에서 딱 이 값에 레벨이 오른다 — 침공 Lv1→2 (분모 불일치 지점)', () => {
    // 레벨 0 을 지나쳐 **두 커브가 갈리는 구간**에서 잰다. 여기서 `xpToNext`(76)를 분모로 쓰면
    // 바가 21% 인 채로 레벨업이 나는 것이 옛 거동이다.
    for (const level of [1, 4]) {
      const before = invasionWorld();
      before.level = level;
      const need = xpToNextForRun(before);
      expect(need).toBeLessThan(xpToNext(level)); // 갈리는 구간임을 확인

      // need - 1 로는 오르지 않는다.
      before.xp = need - 1;
      stepWorld(before, emptyInput());
      expect(before.level, `Lv${level} need-1`).toBe(level);
      expect(before.pendingLevelUp).toBe(false);

      // need 로는 오르고, 소비된 XP 가 정확히 need 다(바가 꽉 찬 순간 = 레벨업).
      const at = invasionWorld();
      at.level = level;
      at.xp = need;
      stepWorld(at, emptyInput());
      expect(at.level, `Lv${level} need`).toBe(level + 1);
      expect(at.pendingLevelUp).toBe(true);
      expect(at.xp).toBe(0);
    }
  });

  it('배선 — main.ts 의 xpNeed 가 xpToNextForRun 을 쓴다(xpToNext 직접 호출 없음)', () => {
    const main = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
    expect(main).toMatch(/xpNeed:\s*xpToNextForRun\(/);
    // 주석 안 언급(결함 경고문)은 남겨도 되므로 **코드 호출**만 본다.
    const code = main.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code).not.toMatch(/\bxpToNext\(/);
  });
});
