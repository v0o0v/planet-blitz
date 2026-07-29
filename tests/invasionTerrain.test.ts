/**
 * 침공 지형·환경 배선 가드 (Phase 2 · 침공 레인).
 *
 * ## 이 파일이 막는 세 가지
 *
 * 1. **침공에서 Wang 지형이 꺼진다.** 예전 배선은 `autotile.configure(null, seed)` 로 침공에서
 *    지형을 통째로 껐다. 되돌아가도 예외가 나지 않고 화면이 그냥 밋밋해질 뿐이라 조용하다.
 * 2. **stage 깊이 회귀.** 침공 배경(`invasionBackdrop.view`)이 `autotile.layer` 아래로 내려가면
 *    알파 255 불투명 Wang 타일이 그것을 통째로 덮는다 — 배경 3종과 전환 연출이 화면에서
 *    사라지지만 테스트도 예외도 아무 말을 하지 않는다.
 * 3. **침공인데 카르곤 화면.** 침공 런의 `config.planet` 은 항상 0(카르곤)이라, 그 값을 그대로
 *    `env.configure` 에 넘기면 화산 테마가 뜬다. 자산도 배선도 멀쩡한데 화면만 틀린 상태다.
 *
 * ## 왜 main.ts 를 **소스 텍스트로** 검사하는가
 * `src/main.ts` 는 부팅 전체를 세우는 모듈이라 테스트에서 import 할 수 없다(캔버스·오디오·
 * 네트워크가 전부 필요하다). `tests/renderWiring.test.ts`·`tests/envWiring.test.ts` 가 같은
 * 이유로 같은 방식을 쓴다. 깊이는 stage 에 붙이는 **호출의 소스 등장 순서**로 재는데, 그 순서가
 * 곧 `addChild` 의 깊이 순서라 지표와 대상이 일치한다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { PHASE_L1, PHASE_L2, PHASE_L3 } from '../src/sim/invasion/constants.js';
import { INVASION_TILESET } from '../src/render/autotile.js';
import {
  backdropCrossfadeAlpha,
  backdropVeilAlpha,
  INVASION_CROSSFADE_TICKS,
} from '../src/render/invasionBackdrop.js';
import { themeFor } from '../src/render/env/themes/index.js';
import {
  INVASION_ENV_PLANET_BASE,
  INVASION_THEMES,
  invasionEnvPlanet,
} from '../src/render/env/themes/invasion/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = readFileSync(join(ROOT, 'src', 'main.ts'), 'utf8');

/** 소스에서 조각이 처음 나오는 위치(없으면 -1). 깊이 비교의 근거다. */
function at(needle: string): number {
  return MAIN.indexOf(needle);
}

describe('① 침공에서 Wang 지형이 켜진다', () => {
  it('침공 런이 페이즈 지형을 건다(예전의 `configure(null, …)` 로 되돌아가지 않았다)', () => {
    // 정식 침공·하네스 침공 **양쪽**이 같은 함수를 타야 한다.
    const calls = MAIN.match(/applyInvasionPhaseScenery\(PHASE_L1, /g) ?? [];
    expect(calls.length).toBe(2);
    // 그 함수가 침공 타일셋 배열을 실제로 autotile 에 넘긴다.
    expect(MAIN).toContain('autotile.configure(invasionWangTiles[phase] ?? null, seed)');
  });

  it('침공 타일셋 3종을 부팅에서 미리 로드한다', () => {
    for (const phase of ['PHASE_L1', 'PHASE_L2', 'PHASE_L3']) {
      expect(MAIN).toContain(`loadInvasionWangTiles(${phase})`);
    }
  });

  it('타일셋 이름이 페이즈 코드로 인덱싱된다(배경 인덱스와 같은 계약)', () => {
    expect(INVASION_TILESET).toHaveLength(3);
    expect(INVASION_TILESET[PHASE_L1]).toBe('invasion_l1');
    expect(INVASION_TILESET[PHASE_L2]).toBe('invasion_l2');
    expect(INVASION_TILESET[PHASE_L3]).toBe('invasion_l3');
    // 세 이름이 서로 달라야 세 레이어가 실제로 다른 지형을 쓴다.
    expect(new Set(INVASION_TILESET).size).toBe(3);
  });

  it('페이즈 전환은 베일 절정 통지로만 지형을 간다(매 프레임 재타일 금지)', () => {
    expect(MAIN).toContain('invasionBackdrop.takeTerrainSwap()');
    expect(MAIN).toContain('if (swapPhase >= 0) applyInvasionPhaseScenery(swapPhase, currentSeed)');
  });
});

describe('② stage 깊이 — 침공 배경은 지형·환경 **위**다', () => {
  const backdrop = at('gameApp.stage.addChild(invasionBackdrop.view)');
  const autotile = at('gameApp.stage.addChild(autotile.layer)');
  const far = at("gameApp.stage.addChildAt(env.slot('far')");
  const floor = at("gameApp.stage.addChild(env.slot('floor'))");
  const entities = at('gameApp.stage.addChild(entityRenderer.layer)');

  it('네 배선이 전부 main.ts 에 있다(지표가 조용히 비지 않는다)', () => {
    for (const [name, idx] of [
      ['invasionBackdrop.view', backdrop],
      ['autotile.layer', autotile],
      ["env.slot('far')", far],
      ["env.slot('floor')", floor],
      ['entityRenderer.layer', entities],
    ] as const) {
      expect(idx, `${name} 배선이 없다`).toBeGreaterThan(0);
    }
  });

  it('침공 배경이 Wang 지형보다 뒤에 붙는다(= 위에 그려진다)', () => {
    // 뒤집히면 알파 255 지형이 배경 3종과 전환 연출을 통째로 덮는다.
    expect(backdrop).toBeGreaterThan(autotile);
  });

  it('침공 배경이 환경 슬롯 far·floor 보다도 위다', () => {
    expect(backdrop).toBeGreaterThan(far);
    expect(backdrop).toBeGreaterThan(floor);
  });

  it('침공 배경은 엔티티 **아래**다(베일 절정에도 함선·탄이 가려지면 안 된다)', () => {
    expect(backdrop).toBeLessThan(entities);
  });

  it('예전 깊이의 근거 주석이 남아 있지 않다', () => {
    // "침공은 autotile 을 끄니까 순서 다툼이 없다"는 전제가 깨졌다. 주석이 남아 있으면
    // 다음 사람이 그 근거를 믿고 깊이를 되돌린다.
    expect(MAIN).not.toContain('침공은 `autotile.configure(null, …)` 로 Wang 바닥을 끄므로');
  });
});

describe('③ 침공 환경 테마는 카르곤이 아니다', () => {
  it('세 페이즈가 각자 다른 침공 테마를 받는다', () => {
    const ids = [PHASE_L1, PHASE_L2, PHASE_L3].map((p) => themeFor(invasionEnvPlanet(p))?.id);
    expect(ids).toEqual(['invasion_l1', 'invasion_l2', 'invasion_l3']);
  });

  it('어느 페이즈도 카르곤 테마로 떨어지지 않는다', () => {
    for (const phase of [PHASE_L1, PHASE_L2, PHASE_L3]) {
      const t = themeFor(invasionEnvPlanet(phase));
      expect(t).toBeDefined();
      expect(t?.id).not.toBe('kargon');
      // 행성 테마 어느 것도 아니다 — 합성 인덱스 영역(6 이상)만 쓴다.
      expect(invasionEnvPlanet(phase)).toBeGreaterThanOrEqual(INVASION_ENV_PLANET_BASE);
    }
  });

  it('합성 인덱스가 행성 6종(0~5)과 겹치지 않는다', () => {
    const invasionPlanets = new Set(INVASION_THEMES.flatMap((t) => t.planets));
    for (let planet = 0; planet <= 5; planet++) {
      expect(invasionPlanets.has(planet), `행성 ${planet} 를 침공 테마가 가로챈다`).toBe(false);
      // 반대로 행성 인덱스는 여전히 자기 테마를 받는다(위 단언이 항진이 아니다).
      expect(themeFor(planet)).toBeDefined();
    }
    expect(themeFor(0)?.id).toBe('kargon');
  });

  it('main.ts 가 행성 인덱스가 아니라 합성 인덱스를 넘긴다', () => {
    expect(MAIN).toContain('env.configure({ planet: invasionEnvPlanet(phase)');
    // 침공 경로에서 env 를 통째로 끄던 예전 배선이 남아 있으면 환경 레이어가 안 나온다.
    expect(MAIN).not.toContain('autotile.configure(null, opts.seed)');
  });

  it('범위 밖 페이즈는 L1 로 접힌다(화면이 비지 않는다)', () => {
    expect(invasionEnvPlanet(-1)).toBe(invasionEnvPlanet(PHASE_L1));
    expect(invasionEnvPlanet(7)).toBe(invasionEnvPlanet(PHASE_L1));
    expect(invasionEnvPlanet(Number.NaN)).toBe(invasionEnvPlanet(PHASE_L1));
  });
});

describe('④ 베일 알파 — 평상시 0, 전환에서만 떠오른다', () => {
  it('전이 밖에서는 정확히 0 이다(그래야 아래 지형이 보인다)', () => {
    expect(backdropVeilAlpha(0)).toBe(0);
    expect(backdropVeilAlpha(-5)).toBe(0);
    expect(backdropVeilAlpha(INVASION_CROSSFADE_TICKS)).toBe(0);
    expect(backdropVeilAlpha(INVASION_CROSSFADE_TICKS * 3)).toBe(0);
    expect(backdropVeilAlpha(Number.NaN)).toBe(0);
  });

  it('절정에서 1 이고, 그 자리가 지형을 갈아 끼우는 순간이다', () => {
    expect(backdropVeilAlpha(INVASION_CROSSFADE_TICKS / 2)).toBe(1);
  });

  it('앞 절반은 단조 증가, 뒤 절반은 단조 감소', () => {
    const half = INVASION_CROSSFADE_TICKS / 2;
    let prev = -1;
    for (let e = 0; e <= half; e += 1.5) {
      const a = backdropVeilAlpha(e);
      expect(a).toBeGreaterThanOrEqual(prev);
      expect(a).toBeLessThanOrEqual(1);
      prev = a;
    }
    prev = 2;
    for (let e = half; e < INVASION_CROSSFADE_TICKS; e += 1.5) {
      const a = backdropVeilAlpha(e);
      expect(a).toBeLessThanOrEqual(prev);
      expect(a).toBeGreaterThanOrEqual(0);
      prev = a;
    }
  });

  it('크로스페이드 함수에서 파생된다(감쇠 곡선이 두 벌로 갈라지지 않는다)', () => {
    for (const e of [3, 9, 16, 22]) {
      expect(backdropVeilAlpha(e)).toBe(backdropCrossfadeAlpha(e * 2));
    }
  });
});
