/**
 * 저장 관용구 가드 — `saveProfile(profile, store)` 의 2번째 인자에 **null 이 샐 수 있는 값**을
 * 그대로 넘기는 호출을 금지한다.
 *
 * 왜 필요한가(HIGH 재발 결함):
 *   `saveProfile(profile, store = defaultStore())` 는 `store === null` 이면 **즉시 return** 한다
 *   (`src/save/profile.ts`). TypeScript 의 기본 인자는 `undefined` 에만 적용되고 **명시적 null
 *   에는 적용되지 않으므로**, 화면이 `private store: KeyValueStore | null` 을 그대로 넘기면
 *   저장이 조용히 사라진다. 실제로 Pixi 화면 4종(hangar·championSelect·researchLab·refinery)이
 *   이 함정에 빠져 장비 장착·스킬 투자·챔피언 확정·정제 결과가 저장되지 않았다. 단위 테스트는
 *   전부 그린이었다 — 각자 스토어를 직접 넘겨 검사했기 때문이다.
 *
 * 규칙: **명시적으로 store 를 넘길 때는 `?? undefined` 로 null 을 걸러라**(또는 인자를 생략).
 *
 * 파생형(하드코딩 금지):
 *   검사 대상 목록을 손으로 적지 않는다. `src/main.ts` 에서 상대 import 를 따라가 **실제 앱에
 *   도달하는 모듈 집합**을 구한 뒤, 그 안의 모든 `saveProfile(` 호출을 검사한다. 새 화면
 *   파일이 추가돼 main 에 배선되는 순간 자동으로 검사 대상이 된다. 반대로 아무 데서도 import
 *   되지 않는 죽은 모듈(레거시 DOM 화면 2종)은 대상이 아니다 — 배선되는 순간 걸린다.
 *
 * 경로 처리는 `node:path`/`existsSync` 대신 URL 로만 한다 — 이 저장소는 `@types/node` 를 두지
 * 않고 `tests/node-shims.d.ts` 의 최소 표면만 선언하기 때문이다(readFileSync + fileURLToPath).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT_URL = new URL('../', import.meta.url);
const ENTRY_URL = new URL('src/main.ts', ROOT_URL);

/** 파일을 문자열로 읽는다. 없으면 null(`existsSync` 가 선언돼 있지 않아 try/catch 로 대신). */
function readOrNull(url: URL): string | null {
  try {
    return new TextDecoder().decode(readFileSync(fileURLToPath(url)));
  } catch {
    return null;
  }
}

/** 저장소 루트 기준 상대 경로(표시·비교용, 항상 `/` 구분자). */
function relFromRoot(url: URL): string {
  return url.href.startsWith(ROOT_URL.href) ? url.href.slice(ROOT_URL.href.length) : url.href;
}

// ---------------------------------------------------------------------------
// 소스 스캐너 (텍스트 기반 — 주석은 먼저 걷어낸다)
// ---------------------------------------------------------------------------

/** 줄/블록 주석 제거. 문서 주석 안의 `saveProfile(...)` 예시가 오탐이 되지 않도록. */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * `open` 이 가리키는 `(` 부터 짝이 맞는 `)` 까지를 읽어 최상위 콤마로 인자를 나눈다.
 * 괄호·중괄호·대괄호 깊이만 따지므로 `saveProfile(p, store ?? undefined)` /
 * `saveProfile(p, opts.get(k))` 모두 올바르게 쪼개진다. 닫는 괄호를 못 찾으면 null.
 */
export function splitCallArgs(src: string, open: number): string[] | null {
  let depth = 0;
  let start = open + 1;
  const args: string[] = [];
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) {
        const tail = src.slice(start, i).trim();
        if (tail !== '' || args.length > 0) args.push(tail);
        return args;
      }
    } else if (c === ',' && depth === 1) {
      args.push(src.slice(start, i).trim());
      start = i + 1;
    }
  }
  return null;
}

/** null 이 절대 새지 않는다고 인정하는 2번째 인자 형태. */
function storeArgIsSafe(arg: string): boolean {
  const a = arg.trim();
  if (a === 'undefined') return true;
  if (a === 'defaultStore()') return true;
  // `x ?? undefined` — null/undefined 를 모두 undefined 로 접어 기본 인자를 살린다.
  return /\?\?\s*undefined$/.test(a);
}

export interface StoreViolation {
  line: number;
  arg: string;
}

/** `saveProfile(` 호출 위치(정의부·메서드 호출 제외)의 인자 목록. */
function saveProfileCalls(strippedSrc: string): { index: number; args: string[] }[] {
  const out: { index: number; args: string[] }[] = [];
  const re = /(?<![\w.$])saveProfile\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(strippedSrc)) !== null) {
    const before = strippedSrc.slice(Math.max(0, m.index - 40), m.index);
    if (/\bfunction\s+$/.test(before)) continue; // 정의부
    const args = splitCallArgs(strippedSrc, m.index + m[0].length - 1);
    if (args === null) continue;
    out.push({ index: m.index, args });
  }
  return out;
}

/** 한 파일의 소스에서 위반 호출을 찾는다. */
export function findSaveProfileStoreViolations(rawSrc: string): StoreViolation[] {
  const src = stripComments(rawSrc);
  const out: StoreViolation[] = [];
  for (const call of saveProfileCalls(src)) {
    if (call.args.length < 2) continue; // 인자 생략 = 기본값 경로(안전)
    const storeArg = call.args[1] ?? '';
    if (storeArgIsSafe(storeArg)) continue;
    out.push({ line: src.slice(0, call.index).split('\n').length, arg: storeArg });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 도달 가능 모듈 집합 (src/main.ts 에서 상대 import 를 따라간다)
// ---------------------------------------------------------------------------

/** 상대 지정자를 실제 `.ts` 파일 URL 로 푼다(`./x.js` → `x.ts`, 디렉터리 → `index.ts`). */
function resolveSpec(fromUrl: URL, spec: string): URL | null {
  if (!spec.startsWith('.')) return null;
  const base = new URL(spec, fromUrl);
  const cands: URL[] = [];
  if (base.href.endsWith('.js')) cands.push(new URL(`${base.href.slice(0, -3)}.ts`));
  else if (base.href.endsWith('.ts')) cands.push(base);
  else cands.push(new URL(`${base.href}.ts`), new URL(`${base.href}/index.ts`));
  for (const c of cands) if (readOrNull(c) !== null) return c;
  return null;
}

/** static import / re-export / dynamic import 의 모듈 지정자를 모두 뽑는다. */
function importSpecs(src: string): string[] {
  const specs: string[] = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const s = m[1];
    if (s !== undefined) specs.push(s);
  }
  return specs;
}

/** `src/main.ts` 에서 도달 가능한 모든 `.ts` 모듈(루트 기준 상대 경로). */
export function reachableModules(): string[] {
  const seen = new Map<string, URL>();
  const stack = [ENTRY_URL];
  while (stack.length > 0) {
    const url = stack.pop();
    if (url === undefined || seen.has(url.href)) continue;
    const raw = readOrNull(url);
    if (raw === null) continue;
    seen.set(url.href, url);
    const src = stripComments(raw);
    for (const spec of importSpecs(src)) {
      const next = resolveSpec(url, spec);
      if (next !== null && !seen.has(next.href)) stack.push(next);
    }
  }
  return [...seen.values()].map(relFromRoot).sort();
}

const REACHABLE = reachableModules().filter((f) => f.startsWith('src/'));

function readReachable(rel: string): string {
  const src = readOrNull(new URL(rel, ROOT_URL));
  if (src === null) throw new Error(`읽을 수 없는 모듈: ${rel}`);
  return src;
}

// ---------------------------------------------------------------------------

describe('saveProfile 저장 관용구 가드', () => {
  it('스캐너가 도달 가능 집합을 실제로 구성한다 (게이트가 빈 채로 초록이 되는 것 방지)', () => {
    expect(REACHABLE).toContain('src/main.ts');
    expect(REACHABLE).toContain('src/save/profile.ts');
    expect(REACHABLE).toContain('src/ui/pixi/hangar.ts');
    expect(REACHABLE.length).toBeGreaterThan(30);
  });

  it('도달 가능 모듈의 saveProfile 호출을 충분히 많이 검사한다 (정규식이 헛도는 것 방지)', () => {
    let calls = 0;
    for (const rel of REACHABLE) {
      for (const call of saveProfileCalls(stripComments(readReachable(rel)))) {
        if (call.args.length >= 2) calls++;
      }
    }
    // store 를 명시적으로 넘기는 Pixi 저장 화면들(hangar·championSelect·researchLab·
    // refinery·defenseCommand×2·modulesView).
    expect(calls).toBeGreaterThanOrEqual(6);
  });

  it('store 를 넘기는 모든 호출이 `?? undefined` 로 null 을 거른다', () => {
    const bad: string[] = [];
    for (const rel of REACHABLE) {
      for (const v of findSaveProfileStoreViolations(readReachable(rel))) {
        bad.push(`${rel}:${v.line} — saveProfile(..., ${v.arg})`);
      }
    }
    expect(
      bad,
      'saveProfile 의 store 인자는 null 이면 저장이 통째로 사라진다. `?? undefined` 를 붙여라',
    ).toEqual([]);
  });

  it('현행 수정(`?? undefined`)을 되돌리면 가드가 빨간불이 된다 (뮤테이션 대조)', () => {
    // 파일 목록을 적지 않는다 — 실제로 `?? undefined` 로 고쳐진 도달 가능 파일을 찾아
    // 그 수정만 텍스트로 되돌린 뒤(디스크는 건드리지 않는다) 가드가 잡는지 확인한다.
    const patched = REACHABLE.filter((rel) =>
      /saveProfile\([^;]*\?\?\s*undefined\s*\)/.test(stripComments(readReachable(rel))),
    );
    expect(
      patched.length,
      '수정된 저장 화면이 하나도 안 잡히면 스캐너가 헛돈 것이다',
    ).toBeGreaterThanOrEqual(5);
    for (const rel of patched) {
      const src = readReachable(rel);
      expect(findSaveProfileStoreViolations(src), rel).toEqual([]);
      const reverted = src.replace(/(saveProfile\([^;]*?)\s*\?\?\s*undefined(\s*\))/g, '$1$2');
      expect(reverted, rel).not.toBe(src);
      expect(findSaveProfileStoreViolations(reverted).length, rel).toBeGreaterThan(0);
    }
  });

  it('레거시 DOM 화면 2종은 도달 불가라 검사 대상이 아니다 (배선하면 먼저 고쳐야 한다)', () => {
    // 이 둘은 ADR-0014 로 Pixi 에 자리를 내준 뒤 아무 데서도 import 되지 않는다. 같은
    // `saveProfile(this.profile, this.store)` 함정을 그대로 갖고 있으므로, 다시 배선하려면
    // `?? undefined` 를 붙인 뒤에 해야 한다(그때 위 가드가 빨간불로 알려 준다).
    // (DOM 정제소 `src/ui/refinery.ts` 는 ADR-0040 에서 아예 삭제됐다 — 목록에서 뺀다.)
    for (const rel of ['src/ui/inventory.ts', 'src/ui/researchLab.ts']) {
      expect(REACHABLE, `${rel} 가 배선됐다면 store 인자를 먼저 고쳐라`).not.toContain(rel);
    }
  });

  it('탐지기 자체가 위반/안전 형태를 갈라낸다', () => {
    expect(findSaveProfileStoreViolations('saveProfile(this.profile, this.store);')).toHaveLength(1);
    expect(findSaveProfileStoreViolations('saveProfile(profile, store);')).toHaveLength(1);
    expect(findSaveProfileStoreViolations('saveProfile(p, this.store ?? undefined);')).toEqual([]);
    expect(findSaveProfileStoreViolations('saveProfile(profile, store ?? undefined);')).toEqual([]);
    expect(findSaveProfileStoreViolations('saveProfile(profile);')).toEqual([]);
    expect(findSaveProfileStoreViolations('// saveProfile(profile, store);\n')).toEqual([]);
    // 정의부·메서드 호출은 대상이 아니다.
    expect(
      findSaveProfileStoreViolations(
        'export function saveProfile(profile: Profile, store: KeyValueStore | null = defaultStore()): void {}',
      ),
    ).toEqual([]);
    expect(findSaveProfileStoreViolations('host.saveProfile();')).toEqual([]);
  });
});
