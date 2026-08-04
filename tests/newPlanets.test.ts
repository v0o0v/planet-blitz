/**
 * Lane9 신규 2행성(톡사르·크라스) — 레지스트리 + typeIndex append-only + 정규경로 통합.
 *
 * 이 저장소의 반복 결함은 "단위 테스트는 그린인데 배선이 통째로 없다"(8+회)다. 그래서
 * 상수 계약(§1·§2)만 못박지 않고, **실제 앱이 부르는 함수**(`buildRunConfig`)로 config 를
 * 만들고 `createWorld`/`stepWorld` 를 진짜로 굴려(§3):
 *   ① buildRunConfig(planet:4) 가 contamination 을, (planet:5) 가 blockBreak 을 스탬프하고,
 *   ② 그 config 로 만든 월드가 톡사르(22~27)·크라스(28~33) 로스터를 실제로 전장에 올린다.
 * 문구만 있고 스폰이 없으면(또는 그 반대면) 여기서 빨간불이다(chaseMode.test.ts (g) 선례).
 */

import { describe, it, expect } from 'vitest';
import {
  PLANETS,
  TOXAR,
  KRAS,
  planetContent,
} from '../data/planets/index.js';
import { ENEMY_BY_TYPE } from '../data/enemies.js';
import { PLANET_MODE } from '../src/sim/planetMode.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile } from '../src/save/profile.js';
import {
  createWorld,
  stepWorld,
  emptyInput,
  packPowerupPick,
} from '../src/sim/world.js';
import type { WorldConfig, WorldState } from '../src/sim/world.js';

/** 런이 접촉·지형 피해로 조기 종료되지 않게 버티는 무대 HP(프로필 파생값이 아니다). */
const DURABLE_HP = 100_000_000;

/** 레벨업 프리즈를 자동 해소하며 한 틱 진행한다(정산 젬으로 레벨업하면 월드가 얼어붙는다). */
function step(state: WorldState): void {
  const frame = state.pendingLevelUp ? { ...emptyInput(), special: packPowerupPick(0) } : emptyInput();
  stepWorld(state, frame);
}

/** 정규경로 config: 프로필 → buildRunConfig(planet) → 무대 HP(치환 브릿지 없음, 실제 planet index). */
function planetConfig(planet: number): WorldConfig {
  return { ...buildRunConfig(defaultProfile(), { planet, stage: 1 }), playerHp: DURABLE_HP };
}

// ---------------------------------------------------------------------------
// §1 — 레지스트리 확장
// ---------------------------------------------------------------------------

describe('§1 신규 2행성 레지스트리', () => {
  it('PLANETS 가 6행성으로 append 되고 4·5 가 톡사르·크라스다', () => {
    expect(PLANETS.length).toBe(6);
    expect(PLANETS[4]).toBe(TOXAR);
    expect(PLANETS[5]).toBe(KRAS);
    expect(planetContent(4).id).toBe('toxar');
    expect(planetContent(5).id).toBe('kras');
    expect(planetContent(4).name).toBe('톡사르');
    expect(planetContent(5).name).toBe('크라스');
    // 범위 밖은 여전히 카르곤 폴백(회귀 가드).
    expect(planetContent(99).id).toBe('kargon');
  });

  it('두 행성 모두 잡몹 4역할·엘리트 2종·특산 광물 2종·3페이즈 보스를 갖춘다', () => {
    for (const p of [TOXAR, KRAS]) {
      expect(Object.keys(p.roster).sort()).toEqual(['charger', 'gunner', 'special', 'support']);
      expect(p.elites.length).toBe(2);
      expect(p.minerals.length).toBe(2);
      expect(p.cardPool.length).toBeGreaterThanOrEqual(6);
      expect(p.boss.phases.length).toBe(3);
    }
  });

  it('레지스트리 모드 배정이 ADR-0021(Lane9)과 일치한다', () => {
    expect(planetContent(4).mode).toBe(PLANET_MODE.contamination); // 톡사르 = 오염
    expect(planetContent(5).mode).toBe(PLANET_MODE.blockBreak); // 크라스 = 블록격파
  });
});

// ---------------------------------------------------------------------------
// §2 — typeIndex / ENEMY_BY_TYPE append-only (결정론 생명선)
// ---------------------------------------------------------------------------

describe('§2 typeIndex append-only(planet0~3 골든 불변)', () => {
  it('ENEMY_BY_TYPE 가 36종·연속 typeIndex 이고 22~35 가 append 분이다', () => {
    expect(ENEMY_BY_TYPE.length).toBe(36);
    ENEMY_BY_TYPE.forEach((def, i) => expect(def.typeIndex).toBe(i));
    // 기존 0~21 은 손대지 않았다(append-only 근거 — 대표 앵커).
    expect(ENEMY_BY_TYPE[0]!.id).toBe('kargon-charger');
    expect(ENEMY_BY_TYPE[21]!.id).toBe('arke-ancient-breaker');
    // 톡사르 22~27 · 크라스 28~33 이 끝에만 붙었다.
    expect(ENEMY_BY_TYPE[22]!.id).toBe('toxar-corroder');
    expect(ENEMY_BY_TYPE[27]!.id).toBe('toxar-rot-behemoth');
    expect(ENEMY_BY_TYPE[28]!.id).toBe('kras-breaker');
    expect(ENEMY_BY_TYPE[33]!.id).toBe('kras-devastator');
    // 2026-08-04 카르곤 엘리트 2종. ⚠️ **카르곤 소속인데 34~35 다** — 0~3 옆에 끼워 넣으면
    // 그 뒤 30종의 번호가 밀려 리플레이·골든이 전부 무효가 되므로 맨 뒤가 유일한 자리다.
    expect(ENEMY_BY_TYPE[34]!.id).toBe('kargon-lava-battery');
    expect(ENEMY_BY_TYPE[35]!.id).toBe('kargon-magma-colossus');
  });

  it('행성 로스터가 그 행성 typeIndex 대역에 배선돼 있다', () => {
    // 톡사르 = 22~27, 크라스 = 28~33. 로스터 4역할이 전부 그 대역 안이다.
    for (const def of Object.values(TOXAR.roster)) {
      expect(def.typeIndex).toBeGreaterThanOrEqual(22);
      expect(def.typeIndex).toBeLessThanOrEqual(27);
      expect(ENEMY_BY_TYPE[def.typeIndex]).toBe(def);
    }
    for (const def of Object.values(KRAS.roster)) {
      expect(def.typeIndex).toBeGreaterThanOrEqual(28);
      expect(def.typeIndex).toBeLessThanOrEqual(33);
      expect(ENEMY_BY_TYPE[def.typeIndex]).toBe(def);
    }
  });
});

// ---------------------------------------------------------------------------
// §3 — 정규경로 통합(buildRunConfig → createWorld → stepWorld)
// ---------------------------------------------------------------------------

/** 실런을 돌리며 등장한 적 enemyType 집합을 모은다(로스터 도달 관측). */
function observedEnemyTypes(planet: number, ticks: number): Set<number> {
  const state = createWorld(0x9a9e + planet, planetConfig(planet));
  const seen = new Set<number>();
  for (let t = 0; t < ticks; t++) {
    step(state);
    for (const e of state.entities) if (e.kind === 'enemy') seen.add(e.enemyType);
    if (state.gameOver || state.victory) break;
  }
  return seen;
}

describe('§3 정규경로 통합 — full-path 로 모드 스탬프 + 로스터 도달', () => {
  it('(a) buildRunConfig(planet:4) 가 contamination 을 스탬프한다(브릿지 없음)', () => {
    const cfg = buildRunConfig(defaultProfile(), { planet: 4, stage: 1 });
    expect(cfg.planetMode).toBe(PLANET_MODE.contamination);
    expect(cfg.planet).toBe(4);
  });

  it('(b) buildRunConfig(planet:5) 가 blockBreak 을 스탬프한다(브릿지 없음)', () => {
    const cfg = buildRunConfig(defaultProfile(), { planet: 5, stage: 1 });
    expect(cfg.planetMode).toBe(PLANET_MODE.blockBreak);
    expect(cfg.planet).toBe(5);
  });

  it('(c) 톡사르 실런이 contamination 을 세우고 톡사르 로스터(22~27)를 전장에 올린다', () => {
    // 실런의 live world 도 contamination 이다(모드 배선 실도달).
    const live = createWorld(0xc04, planetConfig(4));
    expect(live.config.planetMode).toBe(PLANET_MODE.contamination);
    for (let t = 0; t < 20; t++) step(live);
    expect(live.config.planetMode).toBe(PLANET_MODE.contamination);
    // 로스터 도달: 톡사르 대역(22~27)에서 최소 1종이 실제로 스폰됐다.
    const seen = observedEnemyTypes(4, 6000);
    expect([...seen].some((ty) => ty >= 22 && ty <= 27), `톡사르 로스터 미도달: ${[...seen]}`).toBe(true);
  });

  it('(d) 크라스 실런이 blockBreak 을 세우고 크라스 로스터(28~33)를 전장에 올린다', () => {
    const live = createWorld(0xc05, planetConfig(5));
    expect(live.config.planetMode).toBe(PLANET_MODE.blockBreak);
    for (let t = 0; t < 20; t++) step(live);
    expect(live.config.planetMode).toBe(PLANET_MODE.blockBreak);
    const seen = observedEnemyTypes(5, 6000);
    expect([...seen].some((ty) => ty >= 28 && ty <= 33), `크라스 로스터 미도달: ${[...seen]}`).toBe(true);
  });

  /**
   * 카르곤 정예 2종(34~35)이 **실제 웨이브에 올라오는가** (2026-08-04).
   *
   * ⚠️ 이 저장소의 반복 결함은 "데이터는 추가됐는데 배선이 없다"다 — 정예를 레지스트리에만
   * 넣고 카드 풀에 안 넣으면 성계 지도 정찰 창에는 6마리가 뜨는데 **런에서는 영영 안 나온다**
   * (그리고 그 거짓말은 어떤 단위 테스트도 안 잡는다). 그래서 실런으로 도달을 관측한다.
   * 카드 2/10 이라 시드에 따라 늦게 뽑힐 수 있어 시드 셋을 훑고 **합집합**으로 판정한다.
   */
  it('(f) 카르곤 실런이 정예 2종(34~35)을 전장에 올린다', () => {
    const seen = new Set<number>();
    for (const s of [1, 2, 3]) {
      const state = createWorld(0x5a17 + s, planetConfig(0));
      for (let t = 0; t < 9000; t++) {
        step(state);
        for (const e of state.entities) if (e.kind === 'enemy') seen.add(e.enemyType);
        if (state.gameOver || state.victory) break;
      }
      if (seen.has(34) && seen.has(35)) break;
    }
    expect([...seen].filter((ty) => ty >= 34), `정예 미도달: ${[...seen].sort((a, b) => a - b)}`).toEqual(
      expect.arrayContaining([34, 35]),
    );
  });

  it('(e) 같은 시드의 두 실런이 바이트 동일하다(런 단위 결정론)', () => {
    const run = (planet: number): number[] => {
      const state = createWorld(0xd00d, planetConfig(planet));
      const xs: number[] = [];
      for (let t = 0; t < 300; t++) {
        step(state);
        xs.push(state.entities.length);
      }
      return xs;
    };
    expect(JSON.stringify(run(4))).toBe(JSON.stringify(run(4)));
    expect(JSON.stringify(run(5))).toBe(JSON.stringify(run(5)));
  });
});
