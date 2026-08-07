/**
 * 텔레메트리 일별 롤업 계약 대조 (ADR-0051 §결정 3 · §저장 예산 ·
 * `supabase/migrations/20260808050000_telemetry_rollup.sql`).
 *
 * 이 계약이 지키는 것은 넷이고, **넷 다 깨져도 런타임에는 조용하다** — 게임은 어차피 정상
 * 동작하고, 텔레메트리가 비거나 새는 것은 화면에 안 보인다:
 *
 *   (a) 롤업 테이블에 **클라 쓰기 정책이 0개** — 생기면 클라가 임의 셀을 조작해 밸런스
 *       판단을 오염시킬 수 있다(원장류와 같은 규율)
 *   (b) **full-cross 가 아니라 주변화 큐브 둘** — 5축을 한 표로 교차하면 셀/일이 런/일을
 *       넘어(압축비 <1) 롤업이 원본보다 커진다(ADR-0051 §저장 예산이 경고한 실패 모드)
 *   (c) **GC/보존 기간이 실제로 존재한다** — 없으면 무계로 자라 결국 §저장 예산이 무의미해진다
 *   (d) **shipType·playerLevel·xpTotal·dropCount 가 기록 경로에 실제로 배선됐다** —
 *       클라 요약 타입에 필드만 있고 값을 안 채우거나, 롤업이 그 키를 안 읽으면 컬럼은
 *       영원히 기본값(0)이다
 *
 * ⚠️ 단언은 `body`/원문이 아니라 **줄 주석 제거본(`code`)** 으로 한다 — 이 리포의 SQL 은 규약을
 * 길게 주석으로 적어 두고 그 주석에 계약 문자열이 그대로 들어 있어, 주석만 보고 초록이 될 수 있다.
 *
 * ⚠️ 부재 단언(`not.toContain`)만으로는 빈 구현을 못 막는다 — 양성 단언을 항상 함께 둔다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const MINE = '20260808050000_telemetry_rollup.sql';
const SRC_DIR = fileURLToPath(new URL('../src/', import.meta.url));

function migrationsInOrder(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    // 이 저장소 tsconfig 의 fs 타입은 readFileSync 가 1인자·바이트 반환이다.
    .map((f) => ({ file: f, sql: new TextDecoder().decode(readFileSync(MIGRATIONS_DIR + f)) }));
}

/** `--` 줄 주석 제거. */
function stripLineComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

function mineCode(): string {
  const m = migrationsInOrder().find((x) => x.file === MINE);
  if (m === undefined) throw new Error(`${MINE} 을 찾지 못했습니다`);
  return stripLineComments(m.sql);
}

function allMigrationsCode(): string {
  return migrationsInOrder()
    .map((m) => stripLineComments(m.sql))
    .join('\n');
}

/** 적용 순 기준 **마지막** 정의 본문 = 실제로 사는 정의. */
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

function readSrc(rel: string): string {
  return new TextDecoder().decode(readFileSync(SRC_DIR + rel));
}

describe('(a) 롤업 테이블 — 클라 쓰기 정책 0개', () => {
  it('두 큐브 테이블 모두 RLS 는 켜져 있다', () => {
    const code = mineCode();
    expect(code).toContain(
      'alter table public.telemetry_daily_planet_stage enable row level security',
    );
    expect(code).toContain(
      'alter table public.telemetry_daily_ship_level enable row level security',
    );
  });

  it('이 마이그레이션이 두 테이블에 대해 정책을 하나도 만들지 않는다', () => {
    const code = mineCode();
    // 부재 단언만으로는 "정책을 아예 안 건드림"과 "의도적으로 0개로 설계함"을 구분 못하므로,
    // 위 양성 단언(RLS enable 존재)과 짝지어서만 유효하다.
    expect(code).not.toContain('create policy');
    expect(code).not.toContain('for insert');
    expect(code).not.toContain('for select');
  });

  it('다른 마이그레이션도 이 두 테이블에 정책을 얹지 않았다(전 이력 스캔)', () => {
    const all = allMigrationsCode();
    expect(all).not.toMatch(/create policy[\s\S]{0,200}telemetry_daily_planet_stage/);
    expect(all).not.toMatch(/create policy[\s\S]{0,200}telemetry_daily_ship_level/);
  });
});

describe('(b) full-cross 금지 — 주변화 큐브 둘', () => {
  it('큐브1(행성×단계밴드)의 PK 는 3열이고 기체·레벨 축을 섞지 않는다', () => {
    const code = mineCode();
    expect(code).toContain('create table if not exists public.telemetry_daily_planet_stage');
    expect(code).toContain('primary key (day, planet, stage_band)');
    // full-cross 였다면 이 테이블 정의 블록에 ship_type/level_band 열이 함께 있어야 한다.
    const start = code.indexOf('create table if not exists public.telemetry_daily_planet_stage');
    const end = code.indexOf(');', start);
    const block = code.slice(start, end);
    expect(block).not.toContain('ship_type');
    expect(block).not.toContain('level_band');
  });

  it('큐브2(기체×레벨밴드)의 PK 는 3열이고 행성·단계 축을 섞지 않는다', () => {
    const code = mineCode();
    expect(code).toContain('create table if not exists public.telemetry_daily_ship_level');
    expect(code).toContain('primary key (day, ship_type, level_band)');
    const start = code.indexOf('create table if not exists public.telemetry_daily_ship_level');
    const end = code.indexOf(');', start);
    const block = code.slice(start, end);
    expect(block).not.toContain('planet');
    expect(block).not.toContain('stage_band');
  });

  it('집계 GROUP BY 가 각 큐브 축만 묶는다(교차 GROUP BY 없음)', () => {
    const { code } = effectiveFunctionBody('rollup_telemetry_daily');
    expect(code).toContain('group by planet, stage_band');
    expect(code).toContain('group by ship_type, level_band');
    // 5축을 한 번에 묶는 full-cross GROUP BY 가 없어야 한다.
    expect(code).not.toContain('group by planet, stage_band, ship_type, level_band');
    expect(code).not.toMatch(/group by[^;]*ship_type[^;]*stage_band/);
  });

  it('실측 축 크기로 계산한 셀/일 — 마이그레이션 주석의 산수가 실제 축 정의와 맞는다', async () => {
    const { PLANET_COUNT } = await import('../src/economy/planetPopularity.js');
    const { SHIP_TYPES } = await import('../data/ships/index.js');
    const { LEVEL_CAP } = await import('../data/waves.js');
    const { LEVEL_PER_STAGE } = await import('../src/save/progressionPath.js');
    const bandCount = Math.ceil(LEVEL_CAP / LEVEL_PER_STAGE);
    expect(bandCount).toBe(20);

    const cube1 = PLANET_COUNT * bandCount;
    const cube2 = SHIP_TYPES.length * bandCount;
    const fullCross = PLANET_COUNT * bandCount * SHIP_TYPES.length * bandCount;
    const runsPerDay = 12000;

    expect(cube1).toBe(120);
    expect(cube2).toBe(140);
    expect(cube1 + cube2).toBe(260);
    // full-cross 는 실제로 예산을 넘는다 — 주변화가 장식이 아니라 필수임을 수로 고정한다.
    expect(fullCross).toBeGreaterThan(runsPerDay);
    // 주변화 합은 여유 있게 예산 아래다.
    expect(cube1 + cube2).toBeLessThan(runsPerDay);
  });
});

describe('(c) 보존 정책 — GC 가 실제로 존재한다', () => {
  it('원시 pve_runs 7일 GC 는 기존 그대로다(이 레인이 건드리지 않았다)', () => {
    const all = allMigrationsCode();
    expect(all).toContain('planet-blitz-gc-pve-runs');
    expect(all).toContain("delete from public.pve_runs where created_at < now() - interval '7 days'");
  });

  it('롤업 두 테이블 모두 삭제 GC 잡이 있고 구체적인 보존 기간을 명시한다', () => {
    const code = mineCode();
    expect(code).toContain('planet-blitz-gc-telemetry-rollup');
    expect(code).toMatch(
      /delete from public\.telemetry_daily_planet_stage where day < current_date - \d+/,
    );
    expect(code).toMatch(
      /delete from public\.telemetry_daily_ship_level\s+where day < current_date - \d+/,
    );
  });

  it('일별 롤업 cron 이 등록돼 있다(수집 배선 자체의 존재 증명)', () => {
    const code = mineCode();
    expect(code).toContain('planet-blitz-rollup-telemetry-daily');
    expect(code).toContain('select public.rollup_telemetry_daily();');
  });
});

describe('(d) 요약 필드 확장 — shipType·playerLevel·xpTotal·dropCount 가 실제로 배선됐다', () => {
  it('PveSettleSummary 타입에 네 필드가 있다', () => {
    const gw = readSrc('net/gateway.ts');
    expect(gw).toMatch(/shipType:\s*number;/);
    expect(gw).toMatch(/playerLevel:\s*number;/);
    expect(gw).toMatch(/xpTotal:\s*number;/);
    expect(gw).toMatch(/dropCount:\s*number;/);
  });

  it('main.ts 의 정산 호출부가 월드 상태에서 실제 값을 채운다(타입에만 있고 값이 비는 배선 결함 방지)', () => {
    const mainTs = readSrc('main.ts');
    const at = mainTs.indexOf('void settlePveRunCurrency(profile, {');
    expect(at, 'settlePveRunCurrency 호출부를 찾지 못함').toBeGreaterThan(-1);
    const block = mainTs.slice(at, at + 1500);
    expect(block).toContain('shipType: w.config.shipType ?? 0');
    expect(block).toContain('playerLevel: w.level');
    expect(block).toContain('xpTotal: w.xpTotal');
    expect(block).toContain('dropCount: w.loot.length');
  });

  it('settle_pve_run 은 여전히 p_summary 를 그대로 적재한다(SQL 무수정 채널이 살아있다는 증거)', () => {
    const { file, code } = effectiveFunctionBody('settle_pve_run');
    // 이 레인이 settle_pve_run 을 재정의하지 않았다 — 5회 재정의 전례(20260802000000:4-15)를
    // 되풀이하지 않는다는 불가침 규율의 재확인.
    expect(file).toBe('20260802000000_settle_pve_run_column_restore.sql');
    expect(code).toContain('summary          = p_summary');
    expect(code).toContain('summary, credits_granted, minerals_granted');
  });

  it('이 레인의 마이그레이션은 settle_pve_run 을 정의하지 않는다', () => {
    expect(mineCode()).not.toContain('create or replace function public.settle_pve_run');
  });

  it('롤업 함수가 summary jsonb 에서 네 필드를 실제로 읽는다(선언만 있고 안 읽는 결함 방지)', () => {
    const { code } = effectiveFunctionBody('rollup_telemetry_daily');
    expect(code).toContain("summary->>'shipType'");
    expect(code).toContain("summary->>'playerLevel'");
    expect(code).toContain("summary->>'xpTotal'");
    expect(code).toContain("summary->>'dropCount'");
    // 읽은 값이 실제로 집계 INSERT 의 열로 흘러간다(파싱만 하고 안 쓰는 결함 방지).
    expect(code).toContain('sum(xp_total)');
    expect(code).toContain('sum(drop_count)');
  });

  it('단계·레벨 밴드 클램프가 표준 밴드 수(20)를 정확히 쓴다', () => {
    const { code } = effectiveFunctionBody('rollup_telemetry_daily');
    expect(code).toMatch(/least\(20, greatest\(1,/);
    // 클램프가 하나만 있고 다른 하나가 빠지는 형태(레벨만 접고 단계는 무계로 흘리는 등)를 잡는다.
    const matches = code.match(/least\(20, greatest\(1,/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
