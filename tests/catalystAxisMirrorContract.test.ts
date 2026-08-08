/**
 * 촉매 축별 미러 · 공명 표 · consume_catalysts 게이트 계약 대조
 * (ADR-0052 §귀결 — `supabase/migrations/20260808060000_catalyst_axis_mirror_resonance.sql`).
 *
 * 이 레인의 계약도 TS 와 SQL 두 곳에 나뉘어 적혀 있고, 갈리면 **조용히** 갈린다. 갈렸을 때
 * 드러나는 시점이 전부 늦다 — 축 미러가 갈리면 정산 배율만 틀리고 화면은 정상이며, 공명 표가
 * 갈리면 클라가 표시한 공명과 서버가 적용한 공명이 달라 재실행 검증이 통과하지 못한다.
 *
 *   ① `catalyst_defs.cap_axis`/`cap_mult`/`tags` 시드 ↔ TS `CATALYST_CAP_MIRROR` + `tags`
 *   ② `catalyst_defs.resource_mult` 시드 ↔ TS `CATALYST_RESOURCE_MIRROR` (**의미가 바뀐 칸**)
 *   ③ `catalyst_resonances` 12행 ↔ TS `RESONANCES`
 *   ④ `consume_catalysts` 의 캡 상수 4종 ↔ TS `SLOT_CAP`·`SIGNATURE_CAP`·`CAP_COMPOSE_FACTOR`·
 *      `RESONANCE_*_COUNT`
 *   ⑤ 태그 우선순위 배열 ↔ TS `CATALYST_TAG_PRIORITY` (**순서가 계약이다** — 동급 공명의 승자가
 *      이 순서로만 정해진다)
 *   ⑥ 신설 게이트 (e)중복거부·(f)특산상한이 실제로 본문에 있고, 구 스택 모델 잔재가 없다
 *
 * ⚠️ 파싱 행 수 선행 단언을 반드시 먼저 둔다 — 0행 파싱 시 `toEqual([])` 이 공허하게 통과한다.
 * 이 리포가 반복해 밟은 검증 항진의 형태다(tests/catalystShopContract.test.ts:14 와 같은 규율).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CATALYSTS,
  CATALYST_CAP_MIRROR,
  CATALYST_RESOURCE_MIRROR,
  CATALYST_TAG_PRIORITY,
  CAP_COMPOSE_FACTOR,
  SIGNATURE_CAP,
  SLOT_CAP,
} from '../src/data/catalysts.js';
import {
  RESONANCES,
  RESONANCE_STRONG_COUNT,
  RESONANCE_WEAK_COUNT,
} from '../src/data/catalystResonance.js';
import { EN, KO, type MessageKey } from '../src/i18n/catalog.js';
import { FOUNDRY_LOOT_MULT } from '../src/sim/catalyst/resource.js';
import { JELLY_LOOT_MULT } from '../src/sim/catalyst/berdan.js';

// ---------------------------------------------------------------------------
// 마이그레이션 유효 정의 추출 (출처: tests/catalystShopContract.test.ts:34-82 — 같은 관용구)
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));

/** 이 레인이 신설한 파일. 유효 정의가 여기에 있어야 한다(드리프트 감지). */
const AXIS_MIRROR_FILE = '20260808060000_catalyst_axis_mirror_resonance.sql';

function migrationsInOrder(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, sql: new TextDecoder().decode(readFileSync(MIGRATIONS_DIR + f)) }));
}

function rawMigrationText(): string {
  return migrationsInOrder()
    .map((m) => m.sql)
    .join('\n');
}

/** `--` 줄 주석 제거. 본문 주석에 계약 문자열·튜플 형상이 그대로 들어 있어 파서를 오염시킨다. */
function stripLineComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

/**
 * `create or replace function public.<name>(` 의 **마지막** 정의(적용 순 기준).
 * ⚠️ 단언은 `body` 가 아니라 `code`(줄 주석 제거본)로 한다 — 주석만 보고 통과하면 구현이
 * 사라져도 초록이다.
 */
function effectiveFunctionBody(name: string): { file: string; code: string } {
  let found: { file: string; code: string } | null = null;
  for (const { file, sql } of migrationsInOrder()) {
    const marker = `create or replace function public.${name}(`;
    const at = sql.lastIndexOf(marker);
    if (at < 0) continue;
    const end = sql.indexOf('\n$$;', at);
    expect(end, `${file}: ${name} 본문 종결자를 찾지 못함`).toBeGreaterThan(at);
    found = { file, code: stripLineComments(sql.slice(at, end + 4)) };
  }
  if (found === null) throw new Error(`마이그레이션에서 ${name} 정의를 찾지 못했습니다`);
  return found;
}

/** 센티넬 주석 쌍 사이만 잘라 준다(느슨한 정규식이 엉뚱한 블록을 읽는 것을 막는다). */
function sentinelBlock(begin: string, end: string): string {
  const raw = rawMigrationText();
  const b = raw.indexOf(`-- ${begin}`);
  const e = raw.indexOf(`-- ${end}`);
  expect(b, `센티넬 ${begin} 이 없다`).toBeGreaterThan(-1);
  expect(e, `센티넬 ${end} 이 없다`).toBeGreaterThan(b);
  return stripLineComments(raw.slice(b, e));
}

/** plpgsql DECLARE 의 `NAME constant <type> := <리터럴>;` 값. */
function sqlConstant(code: string, name: string): number {
  const m = new RegExp(`${name}\\s+constant\\s+\\w+\\s*:=\\s*([\\d.]+)\\s*;`).exec(code);
  expect(m, `${name} 상수 선언을 찾지 못했다`).not.toBeNull();
  return Number(m![1]);
}

// ---------------------------------------------------------------------------
// 시드 파싱
// ---------------------------------------------------------------------------

interface CapSeedRow {
  id: number;
  capAxis: string;
  capMult: number;
  resourceCap: number;
  tags: string[];
}

function capSeedRows(): CapSeedRow[] {
  const block = sentinelBlock('CATALYST_CAP_SEED_BEGIN', 'CATALYST_CAP_SEED_END');
  expect(block, '축 미러 시드의 insert 헤더 형상이 바뀌었다').toContain(
    'insert into public.catalyst_defs (catalyst_id, cap_axis, cap_mult, resource_mult, tags) values',
  );
  const rows: CapSeedRow[] = [];
  const re = /\(\s*(\d+)\s*,\s*'(\w+)'\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*array\[([^\]]*)\]::text\[\]\s*\)/g;
  for (const m of block.matchAll(re)) {
    rows.push({
      id: Number(m[1]),
      capAxis: m[2]!,
      capMult: Number(m[3]),
      resourceCap: Number(m[4]),
      tags: m[5]!.split(',').map((t) => t.trim().replace(/^'|'$/g, '')),
    });
  }
  return rows;
}

interface ResoSeedRow {
  tag: string;
  tier: string;
  slug: string;
  capAxis: string;
  capMult: number;
  hook: string;
}

function resonanceSeedRows(): ResoSeedRow[] {
  const block = sentinelBlock('CATALYST_RESONANCE_SEED_BEGIN', 'CATALYST_RESONANCE_SEED_END');
  expect(block, '공명 시드의 insert 헤더 형상이 바뀌었다').toContain(
    'insert into public.catalyst_resonances (tag, tier, slug, cap_axis, cap_mult, hook) values',
  );
  const rows: ResoSeedRow[] = [];
  const re =
    /\(\s*'(\w+)'\s*,\s*'(\w+)'\s*,\s*'(\w+)'\s*,\s*'(\w+)'\s*,\s*([\d.]+)\s*,\s*'(\w+)'\s*\)/g;
  for (const m of block.matchAll(re)) {
    rows.push({
      tag: m[1]!,
      tier: m[2]!,
      slug: m[3]!,
      capAxis: m[4]!,
      capMult: Number(m[5]),
      hook: m[6]!,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// ①② catalyst_defs 축별 미러 전수 대조
// ---------------------------------------------------------------------------

describe('catalyst_defs 축 미러 시드 ↔ TS CATALYST_CAP_MIRROR / CATALYST_RESOURCE_MIRROR', () => {
  const rows = capSeedRows();

  // ⚠️ 행 수 선행 단언 — 0행이면 아래 값 대조가 공허하게 통과한다.
  it('파싱된 시드 행 수가 48(CATALYSTS.length)이다', () => {
    expect(rows.length).toBe(CATALYSTS.length);
    expect(rows.length).toBe(CATALYST_CAP_MIRROR.length);
    expect(rows.length).toBe(CATALYST_RESOURCE_MIRROR.length);
  });

  it('id·cap_axis·cap_mult·resource_mult·tags 가 TS 정본과 전수 일치한다', () => {
    expect(rows).toEqual(
      CATALYSTS.map((c, i) => ({
        id: c.id,
        capAxis: CATALYST_CAP_MIRROR[i]!.capAxis,
        capMult: CATALYST_CAP_MIRROR[i]!.capMult,
        resourceCap: CATALYST_RESOURCE_MIRROR[i]!.resourceCap,
        tags: [...c.tags],
      })),
    );
  });

  // 구 의미(장당 가산분 0.15 · 비자원축 0)가 남아 있으면 합성식이 통째로 무너진다.
  // `Σ(cap − 1)` 의 중립원은 1 이므로 비자원축이 0 이면 축마다 −1 이 더해진다.
  it('비자원축의 resource_mult 가 0 이 아니라 1 이다(합성식 중립원)', () => {
    const nonResource = rows.filter((r) => r.capAxis !== 'resource');
    expect(nonResource.length).toBeGreaterThan(0);
    for (const r of nonResource) {
      expect(r.resourceCap, `id ${r.id}: 비자원축인데 resource_mult 가 1 이 아니다`).toBe(1);
    }
  });

  it('자원축의 resource_mult 는 그 촉매의 개별 상한과 같다', () => {
    const resource = rows.filter((r) => r.capAxis === 'resource');
    expect(resource.length).toBeGreaterThan(0);
    for (const r of resource) expect(r.resourceCap).toBe(r.capMult);
  });

  it('cap_axis 체크 제약이 TS CatalystCapAxis 5종을 열거한다', () => {
    const raw = rawMigrationText();
    const m = /constraint catalyst_defs_cap_axis_check\s*\n?\s*check \(([^;]*?)\);/.exec(raw);
    expect(m, 'catalyst_defs_cap_axis_check 제약 선언이 없다').not.toBeNull();
    const listed = [...m![1]!.matchAll(/'(\w+)'/g)].map((x) => x[1]!);
    expect(new Set(listed)).toEqual(new Set(['drop', 'resource', 'rarity', 'xp', 'catalystDrop']));
  });
});

// ---------------------------------------------------------------------------
// ③ catalyst_resonances 12행 전수 대조
// ---------------------------------------------------------------------------

describe('catalyst_resonances 시드 ↔ TS RESONANCES', () => {
  const rows = resonanceSeedRows();

  it('파싱된 공명 행 수가 12(RESONANCES.length)다', () => {
    expect(rows.length).toBe(RESONANCES.length);
    expect(rows.length).toBe(12);
  });

  it('태그·단·slug·상한축·상한배율·훅이 TS 정본과 전수 일치한다', () => {
    expect(rows).toEqual(
      RESONANCES.map((r) => ({
        tag: r.tag as string,
        tier: r.tier as string,
        slug: r.slug,
        capAxis: r.cap.axis as string,
        capMult: r.cap.mult,
        hook: r.hook as string,
      })),
    );
  });
});

// ---------------------------------------------------------------------------
// ④⑤⑥ consume_catalysts — 상수·우선순위·게이트
// ---------------------------------------------------------------------------

describe('consume_catalysts — 유효 정의와 캡 상수', () => {
  const fn = effectiveFunctionBody('consume_catalysts');

  it('유효 정의가 이 레인의 파일에 있다(드리프트 감지)', () => {
    expect(fn.file).toBe(AXIS_MIRROR_FILE);
  });

  it('SLOT_CAP 이 TS 정본(3)과 같다 — 8 로 되돌아가면 슬롯 상한이 무효가 된다', () => {
    expect(sqlConstant(fn.code, 'SLOT_CAP')).toBe(SLOT_CAP);
    expect(SLOT_CAP).toBe(3);
  });

  it('SIGNATURE_CAP 이 TS 정본과 같다', () => {
    expect(sqlConstant(fn.code, 'SIGNATURE_CAP')).toBe(SIGNATURE_CAP);
  });

  it('CAP_COMPOSE_FACTOR 가 TS 정본과 같다', () => {
    expect(sqlConstant(fn.code, 'CAP_COMPOSE_FACTOR')).toBe(CAP_COMPOSE_FACTOR);
  });

  it('공명 발동 장수 둘이 TS 정본과 같다', () => {
    expect(sqlConstant(fn.code, 'RESONANCE_WEAK_COUNT')).toBe(RESONANCE_WEAK_COUNT);
    expect(sqlConstant(fn.code, 'RESONANCE_STRONG_COUNT')).toBe(RESONANCE_STRONG_COUNT);
  });

  it('CAP_RESOURCE_MULT_MAX 를 리터럴로 다시 적지 않고 단일 선언 함수를 호출한다', () => {
    // 두 곳에 리터럴로 적으면 상향할 때 한 곳이 남아 실지급이 조용히 잘린다.
    expect(fn.code).toMatch(
      /CAP_RESOURCE_MULT_MAX\s+constant\s+numeric\s*:=\s*public\.catalyst_cap_resource_mult_max\(\)/,
    );
    expect(fn.code, 'CAP_RESOURCE_MULT_MAX 가 리터럴로 되돌아갔다').not.toMatch(
      /CAP_RESOURCE_MULT_MAX\s+constant\s+numeric\s*:=\s*[\d.]+\s*;/,
    );
  });

  it('구 스택 모델 상수 MAX_RESOURCE_PER_STACK 이 사라졌다', () => {
    // 구 산식 `1 + Σ(resource_mult × 스택수)` 의 잔재. 남아 있으면 두 산식이 공존한다.
    expect(fn.code).not.toContain('MAX_RESOURCE_PER_STACK');
  });
});

describe('consume_catalysts — 태그 우선순위 배열', () => {
  const block = sentinelBlock('CATALYST_TAG_PRIORITY_BEGIN', 'CATALYST_TAG_PRIORITY_END');

  it('순서까지 TS CATALYST_TAG_PRIORITY 와 같다 — 동급 공명의 승자가 이 순서로 정해진다', () => {
    const listed = [...block.matchAll(/'(\w+)'/g)].map((m) => m[1]!);
    expect(listed.length, '태그 우선순위 배열을 읽지 못했다').toBe(CATALYST_TAG_PRIORITY.length);
    expect(listed).toEqual([...CATALYST_TAG_PRIORITY]);
  });
});

describe('consume_catalysts — 게이트 6종', () => {
  const code = effectiveFunctionBody('consume_catalysts').code;

  it('(a) 슬롯 상한 게이트가 있다', () => {
    expect(code).toMatch(/if v_len > SLOT_CAP then/);
  });

  it('(b) 미지 id 게이트가 있다', () => {
    expect(code).toContain('미지 촉매 id 포함');
  });

  it('(c) 특산-행성 정합 게이트가 있다', () => {
    expect(code).toMatch(/d\.planet is distinct from p_planet/);
  });

  it('(d) 보유 부족 게이트 + inventory 잠금이 있다', () => {
    expect(code).toContain('촉매 보유 부족');
    expect(code).toMatch(/public\.catalyst_inventory[\s\S]*?for update/);
  });

  it('(e) 중복 거부 게이트가 있다 — 유니크 주입의 유일한 서버측 방어다', () => {
    expect(code).toMatch(/count\(distinct cid\)/);
    expect(code).toMatch(/if v_distinct <> v_len then/);
  });

  it('(f) 특산 최대 SIGNATURE_CAP 장 게이트가 있다', () => {
    expect(code).toMatch(/if v_sig > SIGNATURE_CAP then/);
  });
});

describe('consume_catalysts — 합성식 영수증 + 공명 반영', () => {
  const code = effectiveFunctionBody('consume_catalysts').code;

  it('자원축 합을 Σ(cap_mult − 1) 로 낸다', () => {
    expect(code).toMatch(/sum\(d\.cap_mult - 1\)/);
    expect(code).toMatch(/where d\.cap_axis = 'resource'/);
  });

  it('배율을 1 + 합 × CAP_COMPOSE_FACTOR 로 낸다(곱 합성이 아니다)', () => {
    expect(code).toMatch(/v_receipt_mult\s*:=\s*1 \+ v_res_sum \* CAP_COMPOSE_FACTOR\s*;/);
  });

  it('[1, CAP_RESOURCE_MULT_MAX] 로 클램프한다', () => {
    expect(code).toMatch(/least\(greatest\(1, v_receipt_mult\), CAP_RESOURCE_MULT_MAX\)/);
  });

  it('공명이 자원축이면 같은 합에 든다', () => {
    expect(code).toMatch(/if v_reso_axis = 'resource' then/);
    expect(code).toMatch(/v_res_sum\s*:=\s*v_res_sum \+ \(v_reso_mult - 1\)/);
  });

  it('공명 판정이 catalyst_resonances 표를 읽고 한 런에 하나만 고른다', () => {
    expect(code).toContain('public.catalyst_resonances');
    expect(code).toMatch(/limit 1/);
  });

  it('강 우선 → 동급이면 TAG_PRIORITY 순으로 정렬한다', () => {
    expect(code).toMatch(/order by case r\.tier when 'strong' then 0 else 1 end/);
    expect(code).toMatch(/array_position\(TAG_PRIORITY, r\.tag\)/);
  });

  it('영수증에 resonance 앵커를 심는다 — EF 가 판정을 다시 하지 않게 한다', () => {
    expect(code).toMatch(/'resonance'\s*,\s*to_jsonb\(v_reso_slug\)/);
  });
});

// ---------------------------------------------------------------------------
// CAP_RESOURCE_MULT_MAX 단일 선언 지점
// ---------------------------------------------------------------------------

describe('catalyst_cap_resource_mult_max — 단일 선언 지점', () => {
  it('immutable sql 함수로 선언되고 숫자 리터럴 하나를 돌려준다', () => {
    const raw = stripLineComments(rawMigrationText());
    const m =
      /create or replace function public\.catalyst_cap_resource_mult_max\(\)[\s\S]*?as \$\$ select ([\d.]+)::numeric \$\$;/.exec(
        raw,
      );
    expect(m, '단일 선언 함수를 찾지 못했다').not.toBeNull();
    // ⚠️ 값 자체는 lane-f1 전수 결과로 확정된다(TODO). 여기서는 **선언이 하나뿐**임과
    //    1 이상임만 잠근다 — 값을 여기 박으면 상향 때 고칠 자리가 두 곳으로 늘어난다.
    expect(Number(m![1])).toBeGreaterThanOrEqual(1);
    expect(raw.match(/create or replace function public\.catalyst_cap_resource_mult_max\(\)/g))
      .toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ⑦ 축 이전 4자리 대조 — `id 16 foundry` · `id 34 berdan-royal-jelly`
// ---------------------------------------------------------------------------
//
// ## 왜 이 절이 따로 필요한가
// 위 ①②는 **TS ↔ SQL 두 자리**만 대조한다. 그런데 축은 네 자리에 적혀 있다 —
// 데이터(`cap.axis`) · i18n 규칙문(화면에 보이는 문장) · sim 배율 상수(실제로 도달하는 값) ·
// 서버 시드. 2026-08-08 사용자 판정으로 두 카드가 **자원 → 드랍**으로 옮겨갔는데, 그중 한
// 자리만 남으면 *"화면과 규칙이 갈린다"* 는 이 리포가 반복해 밟은 형태 그대로다.
//
// ⚠️ 이 절은 **두 카드만** 잰다. 전 카드에 "규칙문이 자기 축의 낱말을 담는가"를 걸면 축이
// 연출로만 드러나는 카드들(등급 승격·촉매 드랍)에서 거짓 빨강이 난다.

describe('축 이전 4자리 대조 (2026-08-08 사용자 판정 — 자원 → 드랍)', () => {
  const MOVED: readonly { id: number; mult: number; simMult: number }[] = [
    { id: 16, mult: 1.8, simMult: FOUNDRY_LOOT_MULT },
    { id: 34, mult: 2.4, simMult: JELLY_LOOT_MULT },
  ];

  it('① 데이터 — 두 카드의 `cap.axis` 가 drop 이다', () => {
    for (const m of MOVED) {
      const def = CATALYSTS.find((c) => c.id === m.id);
      expect(def, `id ${m.id} 가 카탈로그에 없다`).toBeDefined();
      expect(def!.cap.axis, `id ${m.id}`).toBe('drop');
      expect(def!.cap.mult, `id ${m.id}`).toBe(m.mult);
    }
  });

  it('② sim — 전리품 배율 상수가 선언 상한과 **같은 값**이다(배율이 상한을 못 넘는다)', () => {
    for (const m of MOVED) {
      const def = CATALYSTS.find((c) => c.id === m.id)!;
      expect(m.simMult, `id ${m.id}`).toBe(def.cap.mult);
    }
  });

  it('③ 서버 시드 — cap_axis 가 drop 이고 resource_mult 는 중립원 1 이다', () => {
    const rows = capSeedRows();
    for (const m of MOVED) {
      const row = rows.find((r) => r.id === m.id);
      expect(row, `id ${m.id} 시드 행이 없다`).toBeDefined();
      expect(row!.capAxis, `id ${m.id}`).toBe('drop');
      expect(row!.capMult, `id ${m.id}`).toBe(m.mult);
      expect(row!.resourceCap, `id ${m.id}`).toBe(1);
    }
  });

  it('④ i18n — KO/EN 규칙문이 전리품을 말하고 **자원을 더는 말하지 않는다**', () => {
    const slugOf = (id: number) => CATALYSTS.find((c) => c.id === id)!.slug;
    for (const m of MOVED) {
      const ko = KO[`catalyst.${slugOf(m.id)}.rule` as MessageKey];
      const en = EN[`catalyst.${slugOf(m.id)}.rule` as MessageKey];
      expect(ko, `id ${m.id} ko`).toContain('전리품');
      expect(ko, `id ${m.id} ko 에 자원 조항이 남아 있다`).not.toContain('자원');
      expect(en.toLowerCase(), `id ${m.id} en`).toContain('loot');
      expect(en.toLowerCase(), `id ${m.id} en 에 자원 조항이 남아 있다`).not.toContain('resource');
    }
  });
});
