/**
 * 행성 환경 레이어 배선 가드.
 *
 * 이 리포가 반복해서 밟은 결함은 "모듈은 완성됐는데 아무도 안 부른다"였다
 * (`invasionBackdrop` 이 배경 3장을 만들어 두고도 화면에 안 나온 건이 대표). 환경 레이어는
 * 장수가 늘어날수록 같은 결함이 더 쉽게 숨는다 — 한 장이 조용히 빠져도 나머지가 그려지니
 * 화면이 그럴싸하게 나오기 때문이다. 그래서 세 가지를 구조로 잠근다:
 *
 *  1. `src/render/env/` 의 모든 레이어 모듈은 레지스트리(`createEnvLayers`)에 등록돼 있다.
 *  2. main.ts 가 슬롯 컨테이너 **4개 전부**를 stage 에 붙인다(한 슬롯만 빠져도 그 슬롯
 *     레이어들이 통째로 안 보인다).
 *  3. main.ts 가 런 시작에서 `env.configure` 를, 렌더 루프에서 `env.update` 를 부른다.
 *
 * 검사하지 않는 것: 호출 시점·인자의 정확성, 그리고 레이어가 실제로 무엇을 그리는지.
 * 그건 눈으로 보는 검증의 몫이다 — 이 테스트는 하한선이다.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { ENV_SLOTS, PlanetEnvironment } from '../src/render/env/planetEnvironment.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_DIR = join(ROOT, 'src', 'render', 'env');

/**
 * 레이어 모듈만 추린다(계약·유틸 모듈은 레지스트리 등록 대상이 아니다).
 *
 * `contracts/`·`themes/` 는 디렉터리라 아래 `.endsWith('.ts')` 필터에서 자동으로 빠진다 —
 * 여기 나열할 필요가 없다. 이 집합에는 **`src/render/env/` 최상위의 비-레이어 `.ts` 파일**만 넣는다.
 */
const NON_LAYER = new Set(['types', 'planetEnvironment', 'noise', 'color', 'theme']);

describe('행성 환경 레이어 배선', () => {
  const registry = readFileSync(join(ENV_DIR, 'planetEnvironment.ts'), 'utf8');
  const main = readFileSync(join(ROOT, 'src', 'main.ts'), 'utf8');
  const layerModules = readdirSync(ENV_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map((f) => f.replace(/\.ts$/, ''))
    .filter((b) => !NON_LAYER.has(b));

  it('레이어 모듈이 하나 이상 있다(디렉터리 오탐 방지)', () => {
    expect(layerModules.length).toBeGreaterThan(0);
  });

  it.each(layerModules)('%s 가 레지스트리에 등록돼 있다', (base) => {
    expect(registry).toContain(`./${base}.js`);
  });

  it('레지스트리가 만든 레이어 수 = 모듈 수', () => {
    const env = new PlanetEnvironment();
    expect(env.allNames.length).toBe(layerModules.length);
  });

  it('레이어 이름이 서로 겹치지 않는다(solo 토글이 모호해진다)', () => {
    const env = new PlanetEnvironment();
    expect(new Set(env.allNames).size).toBe(env.allNames.length);
  });

  it.each(ENV_SLOTS)('main.ts 가 슬롯 %s 를 stage 에 붙인다', (slot) => {
    expect(main).toContain(`env.slot('${slot}')`);
  });

  it('main.ts 가 런 시작에서 configure, 매 프레임 update 를 부른다', () => {
    expect(main).toContain('env.configure(');
    expect(main).toContain('env.update(');
    expect(main).toContain('env.disable()');
  });

  /**
   * 런의 **월드 표현**이 화면 전환에서 걷히는가.
   *
   * `clearToMenu()` 는 `world = null` 로 sim 을 버리지만 지형·환경·접지 그림자는 world 가
   * 아니라 각자의 배선이 수명을 쥔다. 그 배선을 푸는 곳이 런 시작과 관전 진입뿐이었던 탓에,
   * 런을 마치고 메뉴로 나가면 **Wang 타일 714장과 환경 레이어 5장이 불투명 메뉴 뒤에서 매
   * 프레임 계속 갱신·렌더되고** 사라진 엔티티의 접지 그림자가 바닥에 남았다(하네스 실측).
   *
   * `world = null` 만 검사하면 이 결함이 안 잡힌다 — 그 줄은 처음부터 있었다. 그래서
   * **`clearToMenu` 함수 본문 안에서** 네 배선이 전부 풀리는지를 본다. 함수 경계를 안 잡고
   * 파일 전체에서 문자열을 찾으면 런 시작 쪽 호출이 대신 걸려 항진이 된다.
   */
  it('clearToMenu() 가 지형·환경·접지 그림자를 함께 내린다', () => {
    const start = main.indexOf('function clearToMenu()');
    expect(start).toBeGreaterThan(0);
    // 다음 함수 선언 전까지를 본문으로 본다.
    const rest = main.slice(start + 'function clearToMenu()'.length);
    const end = rest.indexOf('\n  function ');
    const body = end > 0 ? rest.slice(0, end) : rest;

    expect(body).toContain('autotile.configure(null,');
    expect(body).toContain('env.disable()');
    expect(body).toContain('entityRenderer.setEnvPlanet(null)');
    expect(body).toContain('entityRenderer.reset()');
    // 지형을 끈 뒤 평면 배경이 다시 켜져야 한다. 리터럴 `true` 가 아니라 파생식이어야
    // PvE 런 시작 쪽 규칙과 갈라지지 않는다.
    expect(body).toContain('background.visible = !autotile.active');
  });
});
