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
import { dirname, relative, resolve, join } from 'node:path';

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
 * 한 소스가 `import ... from '<상대경로>.js'` 로 부르는 **파일들의 절대 경로**(.ts 로 되돌린 것).
 *
 * 이름 매칭(정규식 접미사 비교)이 아니라 **경로 해석**이다 — 하위 디렉터리가 생기면 같은 모듈을
 * `./entity/adorner.js` · `../entity/adorner.js` · `../../render/entity/adorner.js` 처럼 서로 다른
 * 형태로 부르게 되고, 접미사 비교로는 그 변형을 다 못 잡거나 동명 모듈을 잘못 잡는다.
 * 해석해서 파일 경로로 비교하면 두 문제가 동시에 사라진다.
 */
function importedFiles(source: string, dir: string): Set<string> {
  const out = new Set<string>();
  const re = /from\s+'(\.[^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const spec = m[1];
    if (spec === undefined || !spec.endsWith('.js')) continue;
    out.add(resolve(dir, spec.replace(/\.js$/, '.ts')));
  }
  return out;
}

/**
 * 배선 면제 목록(`src/render/` 기준 상대 경로). **여기 넣는 것은 예외를 만드는 일이므로 사유를
 * 반드시 적는다.**
 *
 * - `shaders/progress` — AC-3.5 순수함수 **참조 구현**이다. 배선된 `effects/shaderEffects.ts` 는
 *   레인 병렬 레이스 회피로 자체 진행 로직을 인라인하고 있고, 특히 디졸브는 HOLD 구간 유무로
 *   **의미가 다르다**(그 파일 헤더가 정본). 즉 "붙이면 되는 고아"가 아니라 붙이면 거동 회귀가
 *   드는 모듈이라, 통합 전까지 의도적으로 비배선 상태다.
 *
 * 이 목록은 하위 디렉터리 재귀 스캔을 켜면서 드러났다 — 최상위만 훑던 시절엔 보이지 않았다.
 */
const WIRING_EXEMPT: ReadonlySet<string> = new Set(['shaders/progress']);

describe('렌더 모듈 배선', () => {
  // ⚠️ **재귀**다. 최상위 .ts 만 훑으면 `src/render/entity/` · `src/render/env/` 처럼 하위
  // 디렉터리에 사는 모듈이 통째로 가드 밖에 남아, 이 테스트가 막으려던 결함("만들었는데
  // 아무도 호출 안 함")이 새 디렉터리에서 그대로 재발한다.
  const renderModules = collectSources(RENDER)
    .filter((p) => !p.endsWith('.d.ts'))
    .map((p) => ({ file: p, base: relative(RENDER, p).replace(/\\/g, '/').replace(/\.ts$/, '') }));

  const sources = collectSources(SRC).map((p) => ({ path: p, text: readFileSync(p, 'utf8') }));
  /** 프로덕션 그래프가 실제로 부르는 파일 전체(자기 자신 제외는 아래에서 판정). */
  const importsBy = new Map(sources.map((s) => [s.path, importedFiles(s.text, dirname(s.path))]));

  it('src/render/ 에 검사 대상 모듈이 실제로 있다(스캔이 조용히 비지 않는다)', () => {
    expect(renderModules.length).toBeGreaterThan(5);
  });

  it('하위 디렉터리 모듈도 스캔한다(가드가 최상위에서 멈추지 않는다)', () => {
    expect(renderModules.some((m) => m.base.includes('/'))).toBe(true);
  });

  it('모든 렌더 모듈을 프로덕션 코드가 import 한다(테스트만 쓰는 모듈은 실패)', () => {
    const orphans = renderModules
      .filter((m) => !WIRING_EXEMPT.has(m.base))
      .filter(
        (m) => !sources.some((s) => s.path !== m.file && importsBy.get(s.path)?.has(m.file)),
      )
      .map((m) => m.base);
    expect(orphans).toEqual([]);
  });

  it('면제 목록이 썩지 않는다(존재하지 않는 모듈을 면제하고 있으면 실패)', () => {
    const known = new Set(renderModules.map((m) => m.base));
    expect([...WIRING_EXEMPT].filter((b) => !known.has(b))).toEqual([]);
  });

  it('침공 배경은 main.ts 가 직접 붙인다(이 결함의 원점)', () => {
    const main = sources.find((s) => s.path === join(SRC, 'main.ts'));
    expect(main).toBeDefined();
    expect(importsBy.get(main!.path)?.has(join(RENDER, 'invasionBackdrop.ts'))).toBe(true);
  });
});
