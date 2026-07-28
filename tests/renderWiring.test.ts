/**
 * 렌더 모듈 배선 가드 — `src/render/` 의 모든 모듈은 프로덕션 코드가 실제로 import 하는가.
 *
 * ## 이 테스트가 막는 결함 — 실제로 밟았다(2026-07-28)
 *
 * `src/render/invasionBackdrop.ts` 는 M7a L10 에서 **완성된 채로 만들어졌는데 main.ts 에
 * 붙은 적이 없었다.** 그 모듈을 import 하는 곳은 자기 테스트 하나뿐이었고, 침공은 계속
 * "행성 배경을 레이어마다 갈라 쓰는" 임시 폴백을 돌고 있었다. 그래서:
 *
 *   - 전용 배경 3종과 레이어 전환 크로스페이드가 통째로 죽어 있었다.
 *   - `assets/bg_invasion_l*.png` 를 만들어 넣어도 **화면에 나오지 않았다** — 자산이
 *     번들에 들어가는 것과 화면에 그려지는 것은 다른 문제다.
 *   - 그 모듈의 단위 테스트(`invasionRender.test.ts`)는 **전부 그린이었다**. 모듈 자체는
 *     멀쩡했기 때문이다. 단위 테스트는 "이 코드가 호출되긴 하는가"를 묻지 않는다.
 *
 * 이 프로젝트가 반복적으로 밟는 결함이라(`.omc` 인계 문서의 "단위 테스트 그린인데 배선이
 * 통째로 없다" 항목) 여기서 구조적으로 막는다.
 *
 * ## 무엇을 검사하고 무엇을 검사하지 않는가
 *
 * 검사하는 것: 모듈이 프로덕션 그래프에 **연결되어 있는가**(테스트만 import 하면 실패).
 * 검사하지 않는 것: 호출이 올바른 시점·인자로 일어나는가. 그건 통합 테스트의 몫이다.
 * 즉 이 테스트는 하한선이다 — 통과했다고 배선이 옳다는 뜻은 아니고, 실패하면 확실히 틀렸다.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const RENDER = join(SRC, 'render');

/** `src/` 아래 모든 .ts 파일 경로(재귀). */
function collectSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collectSources(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * `import ... from '<...>/<base>.js'` 를 찾는다. 형제 import(`./foo.js`)와 외부
 * import(`../render/foo.js`) 를 모두 잡되, 이름이 겹치는 다른 디렉터리의 동명 모듈까지
 * 세지 않도록 경로 끝만 본다.
 */
function importsModule(source: string, base: string): boolean {
  const re = new RegExp(`from\\s+'(?:\\.\\.?/)+(?:render/)?${base}\\.js'`);
  return re.test(source);
}

describe('렌더 모듈 배선', () => {
  const renderModules = readdirSync(RENDER)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map((f) => f.replace(/\.ts$/, ''));

  const sources = collectSources(SRC).map((p) => ({ path: p, text: readFileSync(p, 'utf8') }));

  it('src/render/ 에 검사 대상 모듈이 실제로 있다(스캔이 조용히 비지 않는다)', () => {
    expect(renderModules.length).toBeGreaterThan(5);
  });

  it('모든 렌더 모듈을 프로덕션 코드가 import 한다(테스트만 쓰는 모듈은 실패)', () => {
    const orphans = renderModules.filter((base) => {
      const self = join(RENDER, `${base}.ts`);
      return !sources.some((s) => s.path !== self && importsModule(s.text, base));
    });
    expect(orphans).toEqual([]);
  });

  it('침공 배경은 main.ts 가 직접 붙인다(이 결함의 원점)', () => {
    const main = sources.find((s) => s.path === join(SRC, 'main.ts'));
    expect(main).toBeDefined();
    expect(importsModule(main!.text, 'invasionBackdrop')).toBe(true);
  });
});
