/**
 * 210스킬 **배선 종수**의 코드 정본 (계측 · ADR-0049 레인).
 *
 * ## 왜 이 파일이 있는가
 * 배선 진척 숫자가 지금까지 **레인 보고의 델타를 합산한 추정치**였고 코드에 정본이 없었다.
 * 세션마다 다시 추정하다 인계에 틀린 수를 남긴다. 여기서 한 번 세고, **드리프트하면 빨개지게**
 * 잠근다.
 *
 * ## ⚠️ 이 계측이 **증명하지 않는 것** — 반드시 읽어라
 * 1. **"enum 을 읽는다" ≠ "효과가 실제로 발동한다".** 이 파일이 세는 것은 *"자리에 얹혀 있는가"*
 *    뿐이다. 배선의 진짜 물증은 **레인별 뮤테이션 단위 테스트**(`tests/skill{Ship}.test.ts`)다.
 *    이 수가 210 이 되어도 그것만으로 "210스킬 완성"이 아니다.
 * 2. **반쪽 배선도 1종으로 세어진다.** 적립처(`aux0` 를 올리는 쪽)만 있고 소비처가 없는 스킬,
 *    또는 레벨을 읽어놓고 그 값을 어디에도 안 쓰는 스킬도 여기서는 **배선 1종**이다.
 *    "세어졌다"를 "동작한다"로 읽지 마라.
 *
 * ## 세는 규칙 (재현 가능한 정의)
 * - 대상은 `src/sim/skills/*.ts` **뿐**이다. 이 리포의 패시브 배선은 전부 그 모듈들의
 *   파일-로컬 `const enum Sk` 를 경유한다. 다른 곳에 `Sk.` 가 생기면 아래 누출 가드가 빨개진다.
 * - **주석을 벗긴 뒤** `Sk.<멤버>` 를 센다. 블록(`/* *\/`·JSDoc)·줄(`//`) 둘 다 벗기고,
 *   문자열·템플릿 리터럴 안은 벗기지 않는다(리터럴 속 `//` 에 속지 않기 위해).
 * - **기체별 유일 집합**이다. 한 스킬이 여러 앵커·여러 파일에 걸쳐 배선돼도 1종이다
 *   (예: 팬텀 PH7 은 `phantom.ts` 와 `phantomEntry.ts` 양쪽에 있다).
 * - `void Sk.x` 형태의 무연산 참조는 제외한다(현재 0건이지만 미배선 표시 관용구라 막아둔다).
 *
 * ## 액티브 42종은 여기 안 들어온다 — 카테고리가 다르다
 * 기체당 트리 3 × 10 = **30 패시브**, × 7기체 = **210** 이 이 계측의 우주다
 * (`tests/shipSkillLayout.test.ts` 의 `zeroSkillInvest(...).length === 30` 가 그 정본).
 * 액티브(`as_*`)는 `data/ships/actives/` 의 **별도 레지스트리 6종/기체 = 42종**이고
 * `src/sim/activeHandlers/` 에는 `Sk.` 참조가 **0건**이다. 액티브 배선은
 * `tests/activeSkillWiring.test.ts` 가 따로 잰다. 두 수를 더하지 마라.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = join(REPO, 'src/sim/skills');

// ---------------------------------------------------------------------------
// 주석 제거 — 이 계측의 핵심 부품
// ---------------------------------------------------------------------------

/**
 * TS 소스에서 주석만 벗긴다. 문자열·템플릿 리터럴은 **보존**한다.
 *
 * 정규식 리터럴은 다루지 않는다 — 이 디렉터리에 정규식이 없고(`Sk.` 를 담을 이유도 없다),
 * 어설픈 정규식 판정이 오히려 나눗셈 `a / b` 를 깨먹는다. 새 정규식이 들어오면 그건
 * 아래 `누출 가드` 가 아니라 사람이 봐야 하는 변화다.
 */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      out += ' '; // 토큰 두 개가 붙어버리지 않게 공백 한 칸을 남긴다
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += src[i];
        const done = src[i] === quote;
        i++;
        if (done) break;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 파일 → 기체
// ---------------------------------------------------------------------------

/**
 * `src/sim/skills/` 의 파일이 어느 기체에 속하는가. **명시 표**다 —
 * 파일명에서 유추하면 새 분할 파일(`phantomEntry.ts` 같은 것)이 조용히 새 기체로 세어진다.
 */
const FILE_SHIP: Readonly<Record<string, string>> = {
  'arccaster.ts': 'arccaster',
  'bruiser.ts': 'bruiser',
  'bubble.ts': 'bubble',
  'hatchling.ts': 'hatchling',
  'mallow.ts': 'mallow',
  'phantom.ts': 'phantom',
  'phantomEntry.ts': 'phantom',
  'striker.ts': 'striker',
};

const SHIPS = ['arccaster', 'bruiser', 'bubble', 'hatchling', 'mallow', 'phantom', 'striker'];

/** 기체당 스킬 슬롯 수(트리 3 × 10). `tests/shipSkillLayout.test.ts` 가 정본. */
const SLOTS_PER_SHIP = 30;

// ---------------------------------------------------------------------------
// 추출
// ---------------------------------------------------------------------------

interface Wired {
  /** 설계 ID(`CH1`·`BR10`·`SQ3` …). enum 멤버의 JSDoc 첫 토큰에서 읽는다. */
  id: string;
  /** flat 인덱스 0..29. */
  flat: number;
  /** enum 멤버 이름. */
  name: string;
}

/** `"CH1@0"` — 골든 표에 적는 형태. ID 만 쓰면 오타가 조용히 통과한다. */
function key(w: Wired): string {
  return `${w.id}@${w.flat}`;
}

/** 한 소스에서 `const enum Sk { ... }` 블록의 `멤버 → {flat, id}` 를 읽는다(원문 기준). */
function parseEnum(raw: string): Map<string, { flat: number; id: string }> {
  const start = raw.indexOf('const enum Sk {');
  if (start < 0) return new Map();
  const end = raw.indexOf('\n}', start);
  const block = raw.slice(start, end < 0 ? raw.length : end);
  const out = new Map<string, { flat: number; id: string }>();
  for (const m of block.matchAll(/(?:\/\*\*\s*([A-Za-z]+\d+)[^*]*\*\/\s*)?(\w+)\s*=\s*(\d+)/g)) {
    const name = m[2];
    const flat = m[3];
    if (name === undefined || flat === undefined) continue;
    out.set(name, { flat: Number(flat), id: m[1] ?? '?' });
  }
  return out;
}

/**
 * **실행 코드가 읽는** enum 멤버를 뽑는다. 주석은 이미 벗겨진 소스를 받는다.
 * `void Sk.x` 는 무연산 참조이므로 뺀다.
 */
export function extractWired(
  strippedCode: string,
  members: Map<string, { flat: number; id: string }>,
): Wired[] {
  const seen = new Map<string, Wired>();
  for (const m of strippedCode.matchAll(/(\bvoid\s+)?\bSk\.(\w+)\b/g)) {
    if (m[1]) continue; // `void Sk.x` — 미배선 표시
    const name = m[2];
    if (name === undefined) continue;
    const info = members.get(name);
    if (!info) continue;
    seen.set(name, { name, flat: info.flat, id: info.id });
  }
  return [...seen.values()];
}

/** 기체별 배선 유일 집합. 값은 `key()` 문자열 정렬본. */
function census(): { perShip: Map<string, string[]>; unread: string[] } {
  const perShip = new Map<string, Map<number, Wired>>();
  for (const s of SHIPS) perShip.set(s, new Map());
  const unread: string[] = [];

  for (const file of readdirSync(SKILLS_DIR)) {
    if (!file.endsWith('.ts')) continue;
    const ship = FILE_SHIP[file];
    expect(
      ship,
      `src/sim/skills/${file} 이 FILE_SHIP 표에 없다 — 새 파일이면 표에 추가해라`,
    ).toBeTruthy();
    if (ship === undefined) continue;
    const raw = readFileSync(join(SKILLS_DIR, file), 'utf8');
    const members = parseEnum(raw);
    const code = stripComments(raw);
    const wired = extractWired(code, members);
    const bucket = perShip.get(ship) ?? new Map<number, Wired>();
    perShip.set(ship, bucket);
    for (const w of wired) bucket.set(w.flat, w);
    // 선언만 되고 실행 코드가 안 읽는 멤버 = 유령 선언
    for (const name of members.keys()) {
      if (!wired.some((w) => w.name === name)) unread.push(`${file}:${name}`);
    }
  }

  const out = new Map<string, string[]>();
  for (const s of SHIPS) {
    const arr = [...perShip.get(s)!.values()].sort((a, b) => a.flat - b.flat).map(key);
    out.set(s, arr);
  }
  return { perShip: out, unread };
}

// ---------------------------------------------------------------------------
// 골든 표 — **배선을 추가/삭제했으면 여기를 같이 고쳐라**
// ---------------------------------------------------------------------------

/**
 * 기준: base `27225ba` (2026-08-07) + 버블 배선 2차(`lane/wire-bubble`, DR1). 합계 **115 / 210**.
 *
 * 갱신 방법: 테스트가 빨개지면 실패 메시지가 **어떤 스킬이 늘고 줄었는지**를 찍는다.
 * 그 목록이 네 의도와 같은지 눈으로 확인한 뒤 여기에 반영해라. 통째로 복붙하지 마라 —
 * 이 표의 값어치는 "사람이 한 번 봤다"에 있다.
 */
const GOLDEN: Readonly<Record<string, readonly string[]>> = {
  arccaster: [
    'CH1@0', 'CH3@2', 'CH4@3', 'CH6@5', 'CH8@7',
    'BA3@12', 'BA7@16', 'BA10@19',
    'BR1@20', 'BR2@21', 'BR3@22', 'BR4@23', 'BR5@24', 'BR6@25', 'BR7@26', 'BR8@27', 'BR9@28', 'BR10@29',
  ],
  bruiser: [
    'BL2@1', 'BL3@2', 'BL4@3', 'BL6@5', 'BL8@7', 'BL9@8',
    'MO1@10', 'MO6@15', 'MO8@17', 'MO9@18',
    'FO1@20', 'FO2@21', 'FO5@24', 'FO6@25', 'FO7@26',
  ],
  bubble: [
    'PO1@0', 'PO2@1', 'PO3@2', 'PO5@4', 'PO6@5', 'PO7@6',
    'DR1@10', 'DR6@15',
    'FI1@20', 'FI2@21', 'FI3@22', 'FI4@23', 'FI5@24', 'FI8@27', 'FI9@28', 'FI10@29',
  ],
  hatchling: [
    'BD1@0', 'BD2@1', 'BD5@4', 'BD6@5', 'BD10@9',
    'NU2@11', 'NU5@14', 'NU6@15', 'NU7@16', 'NU8@17', 'NU10@19',
    'SH1@20', 'SH3@22', 'SH5@24', 'SH6@25', 'SH7@26', 'SH10@29',
  ],
  mallow: [
    'SQ1@0', 'SQ2@1', 'SQ3@2', 'SQ4@3', 'SQ5@4', 'SQ7@6', 'SQ8@7',
    'ME1@10', 'ME4@13', 'ME5@14', 'ME9@18', 'ME10@19',
    'CU3@22', 'CU4@23', 'CU7@26', 'CU9@28', 'CU10@29',
  ],
  phantom: [
    'AS2@1', 'AS3@2', 'AS4@3', 'AS5@4',
    'PH1@10', 'PH7@16', 'PH8@17', 'PH10@19',
    'DI1@20', 'DI2@21', 'DI3@22', 'DI4@23', 'DI5@24', 'DI6@25', 'DI7@26', 'DI8@27',
  ],
  striker: [
    'F1@0', 'F2@1', 'F3@2', 'F4@3', 'F5@4', 'F6@5', 'F9@8',
    'S1@10', 'S2@11', 'S3@12', 'S4@13', 'S8@17', 'S10@19',
    'M1@20', 'M3@22', 'M5@24',
  ],
};

/** 골든 합계. 기체별 표와 따로 적어, 한쪽만 고치면 아래 자기검증이 잡는다. */
const GOLDEN_TOTAL = 115;

/** 늘고 준 것을 사람이 읽을 수 있게 찍는다 — 숫자만 틀렸다고 하면 원인을 못 찾는다. */
function diffMsg(ship: string, actual: readonly string[], golden: readonly string[]): string {
  const added = actual.filter((a) => !golden.includes(a));
  const removed = golden.filter((g) => !actual.includes(g));
  return [
    `${ship}: 배선 ${golden.length} → ${actual.length}`,
    added.length ? `  + 늘어남: ${added.join(', ')}` : '',
    removed.length ? `  - 사라짐: ${removed.join(', ')}` : '',
    '  골든 표(GOLDEN)를 눈으로 확인한 뒤 갱신해라.',
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------------------

describe('210스킬 배선 종수 계측', () => {
  const { perShip, unread } = census();

  it('우주는 7기체 × 30슬롯 = 210 이다', () => {
    expect(SHIPS.length).toBe(7);
    expect(SHIPS.length * SLOTS_PER_SHIP).toBe(210);
  });

  for (const ship of SHIPS) {
    it(`${ship} 의 배선 집합이 골든과 같다`, () => {
      const actual = perShip.get(ship) ?? [];
      const golden = GOLDEN[ship] ?? [];
      expect(actual, diffMsg(ship, actual, golden)).toEqual([...golden]);
      expect(actual.length, `${ship}: 배선이 30슬롯을 넘었다`).toBeLessThanOrEqual(SLOTS_PER_SHIP);
    });
  }

  it('합계가 골든과 같다', () => {
    let total = 0;
    for (const ship of SHIPS) total += (perShip.get(ship) ?? []).length;
    const goldenSum = SHIPS.reduce((n, s) => n + (GOLDEN[s] ?? []).length, 0);
    expect(goldenSum, 'GOLDEN 기체별 표와 GOLDEN_TOTAL 이 어긋났다 — 한쪽만 고쳤다').toBe(
      GOLDEN_TOTAL,
    );
    expect(total, `배선 합계가 골든(${GOLDEN_TOTAL})과 다르다`).toBe(GOLDEN_TOTAL);
  });

  it('선언만 되고 실행 코드가 안 읽는 enum 멤버가 없다', () => {
    // 있으면 그 스킬은 "배선한 척"이다. 지우거나 실제로 읽어라.
    expect(unread, `유령 선언: ${unread.join(', ')}`).toEqual([]);
  });

  it('모든 배선이 설계 ID 를 달고 있다', () => {
    // `?@n` 이 보이면 그 enum 멤버에 `/** CH1 ... */` JSDoc 이 없다는 뜻이다.
    for (const ship of SHIPS) {
      expect(perShip.get(ship)!.filter((k) => k.startsWith('?@')), `${ship}: ID 없는 멤버`).toEqual(
        [],
      );
    }
  });

  it('`Sk.` 참조가 src/sim/skills 밖으로 새지 않았다', () => {
    // 새면 이 계측은 그만큼 **과소 계수**가 된다. 새 위치가 생겼으면 대상 목록을 넓혀라.
    const leaks: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!e.endsWith('.ts') && !e.endsWith('.tsx')) continue;
        if (p.startsWith(SKILLS_DIR)) continue;
        if (/\bSk\.\w/.test(stripComments(readFileSync(p, 'utf8')))) {
          leaks.push(p.slice(REPO.length + 1).replace(/\\/g, '/'));
        }
      }
    };
    walk(join(REPO, 'src'));
    expect(leaks, `Sk. 참조 누출: ${leaks.join(', ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 계측기 자기검증 — **이 파일이 재는 것을 이 파일이 재는지** 확인한다
// ---------------------------------------------------------------------------

describe('계측기 자체 검증', () => {
  const members = new Map([
    ['alpha', { flat: 0, id: 'CH1' }],
    ['beta', { flat: 1, id: 'CH2' }],
    ['gamma', { flat: 2, id: 'CH3' }],
  ]);

  it('⭐ 주석 안의 언급은 세지 않는다 (이 파일의 핵심 단언)', () => {
    const src = `
      // Sk.beta 는 아직 미배선이다 — 사유: 축이 안 정해졌다
      /** JSDoc 에서 Sk.gamma 를 언급한다. */
      /* 블록 주석의 Sk.gamma */
      const x = lv(state, Sk.alpha);
    `;
    const got = extractWired(stripComments(src), members).map((w) => w.name);
    expect(got, '주석 속 언급이 배선으로 세어졌다 — 대용 grep 지표와 똑같은 결함이다').toEqual([
      'alpha',
    ]);
  });

  it('문자열 리터럴 속 `//` 에 속아 뒤를 통째로 버리지 않는다', () => {
    const src = `const url = 'https://x/y'; const y = lv(state, Sk.beta);`;
    expect(extractWired(stripComments(src), members).map((w) => w.name)).toEqual(['beta']);
  });

  it('`void Sk.x` 무연산 참조는 빼고 센다', () => {
    const src = `void Sk.gamma; const z = lv(state, Sk.alpha);`;
    expect(extractWired(stripComments(src), members).map((w) => w.name)).toEqual(['alpha']);
  });

  it('같은 스킬을 여러 번 읽어도 1종이다', () => {
    const src = `lv(state, Sk.alpha); if (lv(state, Sk.alpha) > 0) { lv(state, Sk.alpha); }`;
    expect(extractWired(stripComments(src), members)).toHaveLength(1);
  });
});
