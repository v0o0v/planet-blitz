/**
 * 촉매 상점 & 촉매 잔재 계약 대조 (ADR-0042 · `.omc/plans/catalyst-shop-residue-2026-07-31.md` §3단계).
 *
 * 이 레인의 계약은 TS 와 SQL 두 곳에 나뉘어 적혀 있고, 갈리면 **조용히** 갈린다.
 *   ① 가격 정본 — `src/data/catalysts.ts` `CATALYST_PRICE_MIRROR` ↔ 마이그레이션 `catalyst_defs.buy_price` 시드
 *   ② 환급 비율·결합 순서 — TS `SALVAGE_RATIO_PCT`/`catalystSalvageValue` ↔ `salvage_catalyst` 본문
 *   ③ 재화 봉인 — `guard_profiles_client_write`/`_insert` 의 컬럼 열거식 대입
 *   ④ 잠금 순서 — `salvage_catalyst`·`buy_catalyst` 양쪽의 `for update` 등장 순서
 *   ⑤ 구매 가능성 — SQL 시드 `planet is null` / TS `kind === 'common'` / 경계 `id < 30`
 *
 * ④ 의 ABBA 데드락은 **단위 테스트·실세션 1바퀴·육안 중 무엇으로도 안 잡힌다** — 이 계약 단언이
 * 유일한 방어다. ①③⑤ 도 런타임에 드러나는 시점이 "무료 구매"·"무한 구매"라 사후 관측이 늦다.
 *
 * ⚠️ 파싱 행 수 선행 단언을 반드시 먼저 둔다 — 0행 파싱 시 `toEqual([])` 이 공허하게 통과한다.
 * 이 리포가 반복해 밟은 검증 항진의 형태다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CATALYSTS,
  CATALYST_PRICE_MIRROR,
  SALVAGE_RATIO_PCT,
  catalystSalvageValue,
} from '../src/data/catalysts.js';

// ---------------------------------------------------------------------------
// 마이그레이션 유효 정의 추출
// (출처: tests/coreModuleSlotContract.test.ts:35-62 — 같은 관용구를 복사해 온 것이다.
//  파일명 순 = 적용 순이므로 같은 함수가 여러 마이그레이션에 있으면 마지막 정의가 실제로 산다.)
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));

/** 마이그레이션 파일을 적용 순(파일명 오름차순)으로 [이름, 본문] 나열. */
function migrationsInOrder(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    // 이 저장소 tsconfig 의 fs 타입은 readFileSync 가 1인자·바이트 반환이다.
    .map((f) => ({ file: f, sql: new TextDecoder().decode(readFileSync(MIGRATIONS_DIR + f)) }));
}

/**
 * `create or replace function public.<name>(` 의 **마지막** 정의 본문을 돌려준다(적용 순 기준).
 * 못 찾으면 throw(계약 대상이 사라진 것도 회귀다).
 *
 * ⚠️ `body` 가 아니라 **`code`(줄 주석 제거본)로 단언하라.** 이 리포의 SQL 은 본문 안에 규약을
 * 길게 주석으로 적어 두는데, 그 주석에 `for update`·`no-profile` 같은 계약 문자열이 그대로
 * 들어 있다. 주석만 보고 통과하면 구현이 사라져도 초록이다(실제로 이 파일을 쓰는 중에
 * `for update` 주석 1건이 잠금 순서 파서를 오염시켰다).
 */
function effectiveFunctionBody(name: string): { file: string; body: string; code: string } {
  let found: { file: string; body: string; code: string } | null = null;
  for (const { file, sql } of migrationsInOrder()) {
    const marker = `create or replace function public.${name}(`;
    const at = sql.lastIndexOf(marker);
    if (at < 0) continue;
    const end = sql.indexOf('\n$$;', at);
    expect(end, `${file}: ${name} 본문 종결자를 찾지 못함`).toBeGreaterThan(at);
    const body = sql.slice(at, end + 4);
    found = { file, body, code: stripLineComments(body) };
  }
  if (found === null) throw new Error(`마이그레이션에서 ${name} 정의를 찾지 못했습니다`);
  return found;
}

/**
 * 적용 순 전체 SQL 원문 연결. 함수 본문 헬퍼로는 닿지 않는 **DDL**(alter table / check 제약)을
 * 스캔하기 위한 것이다(단언 8).
 */
function rawMigrationText(): string {
  return migrationsInOrder()
    .map((m) => m.sql)
    .join('\n');
}

/** `--` 줄 주석 제거. 시드 블록의 주석에 `(0)` 같은 튜플 형상 문자열이 섞여 있어 파서를 오염시킨다. */
function stripLineComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

/**
 * `catalyst_defs.buy_price` 가격 시드 — **센티넬 주석 쌍 사이만** 잘라 `(id, price)` 로 파싱한다.
 * `catalyst_defs` 에는 이미 다른 컬럼 구성의 insert 가 존재하므로(20260727000000:105-122)
 * 느슨한 정규식은 엉뚱한 블록을 읽고도 통과한다.
 */
function catalystPriceSeedRows(): { id: number; price: number }[] {
  const raw = rawMigrationText();
  const begin = raw.indexOf('-- CATALYST_PRICE_SEED_BEGIN');
  const end = raw.indexOf('-- CATALYST_PRICE_SEED_END');
  expect(begin, '가격 시드 센티넬 CATALYST_PRICE_SEED_BEGIN 이 없다').toBeGreaterThan(-1);
  expect(end, '가격 시드 센티넬 CATALYST_PRICE_SEED_END 이 없다').toBeGreaterThan(begin);
  const block = stripLineComments(raw.slice(begin, end));
  expect(block, '가격 시드 블록의 insert 헤더 형상이 바뀌었다').toContain(
    'insert into public.catalyst_defs (catalyst_id, buy_price) values',
  );
  const rows: { id: number; price: number }[] = [];
  for (const m of block.matchAll(/\(\s*(\d+)\s*,\s*(\d+)\s*\)/g)) {
    rows.push({ id: Number(m[1]), price: Number(m[2]) });
  }
  return rows;
}

/**
 * 기존 3열 시드(`catalyst_id, resource_mult, planet`) — 단언 9가 필요로 하는 `planet` 값은
 * 이번 마이그레이션이 아니라 여기(20260727000000_catalyst_ledger.sql:105-122)에 있다.
 * 그 블록은 센티넬이 없고 이미 원격 적용돼 **소급 편집이 금기**이므로, 완전한 컬럼 리스트
 * 문자열을 앵커로 잡는다 — 새 2열 블록과 충돌하지 않고 유일하게 특정된다.
 */
function catalystDefsSeedRows(): { id: number; planet: number | null }[] {
  const ANCHOR = 'insert into public.catalyst_defs (catalyst_id, resource_mult, planet) values';
  const raw = rawMigrationText();
  const begin = raw.indexOf(ANCHOR);
  expect(begin, `3열 시드 앵커를 찾지 못했다: ${ANCHOR}`).toBeGreaterThan(-1);
  const end = raw.indexOf('on conflict', begin);
  expect(end, '3열 시드의 on conflict 종결을 찾지 못했다').toBeGreaterThan(begin);
  const block = stripLineComments(raw.slice(begin + ANCHOR.length, end));
  const rows: { id: number; planet: number | null }[] = [];
  for (const m of block.matchAll(/\(\s*(\d+)\s*,\s*[\d.]+\s*,\s*(null|\d+)\s*\)/g)) {
    rows.push({ id: Number(m[1]), planet: m[2] === 'null' ? null : Number(m[2]) });
  }
  return rows;
}

/**
 * 본문에서 `for update` 가 걸린 테이블을 등장 순서대로 나열한다.
 * 각 `for update` 직전에 마지막으로 나온 `public.<table>` 이 그 잠금의 대상이다.
 */
function forUpdateLockOrder(body: string): string[] {
  const order: string[] = [];
  let lastTable: string | null = null;
  for (const m of body.matchAll(/public\.(\w+)|for update/g)) {
    if (m[0] === 'for update') {
      order.push(lastTable ?? '<unknown>');
    } else {
      lastTable = m[1] ?? null;
    }
  }
  return order;
}

// ---------------------------------------------------------------------------
// 1. 가격 시드 ↔ TS 정본 전수 대조
// ---------------------------------------------------------------------------

describe('catalyst_defs.buy_price 시드 ↔ TS CATALYST_PRICE_MIRROR', () => {
  const rows = catalystPriceSeedRows();

  // ⚠️ 행 수 선행 단언 — 0행이면 아래 값 대조가 공허하게 통과한다.
  it('파싱된 시드 행 수가 CATALYST_PRICE_MIRROR 와 같다', () => {
    expect(rows.length).toBe(CATALYSTS.length);
    expect(rows.length).toBe(CATALYST_PRICE_MIRROR.length);
  });

  it('id 순서와 가격이 TS 정본과 전수 일치한다', () => {
    expect(rows).toEqual(
      CATALYST_PRICE_MIRROR.map((m) => ({ id: m.catalystId, price: m.buyPrice })),
    );
  });
});

// ---------------------------------------------------------------------------
// 2·3. 재화 봉인 가드 — 컬럼 열거식이라 컬럼을 늘리면 여기를 반드시 함께 고쳐야 한다
// ---------------------------------------------------------------------------

describe('guard_profiles_client_write — 클라 UPDATE 봉인 9종', () => {
  const guard = effectiveFunctionBody('guard_profiles_client_write');

  it('new.X := old.X 대입이 정확히 9개이고 집합이 계약과 같다', () => {
    const cols = [...guard.code.matchAll(/new\.(\w+)\s*:=\s*old\.(\w+)\s*;/g)].map((m) => {
      expect(m[2], `${m[1]} 을 다른 컬럼(${m[2]})의 old 값으로 되돌리고 있다`).toBe(m[1]);
      return m[1];
    });
    expect(cols.length, '봉인 대입 총수가 9가 아니다 — 컬럼을 지웠거나 늘렸다').toBe(9);
    expect(new Set(cols)).toEqual(
      new Set([
        'flagged',
        'is_npc',
        'lineage_points',
        'lineage_ship_level',
        'lineage_guardian_level',
        'lineage_last_retired_at',
        'credits',
        'minerals',
        'catalyst_residue',
      ]),
    );
  });
});

describe('guard_profiles_client_insert — 클라 INSERT 재화 0 강제 3종', () => {
  const guard = effectiveFunctionBody('guard_profiles_client_insert');

  it('new.X := 0 대입이 정확히 3개이고 집합이 계약과 같다', () => {
    const cols = [...guard.code.matchAll(/new\.(\w+)\s*:=\s*0\s*;/g)].map((m) => m[1]);
    expect(cols.length, '0 강제 대입 총수가 3이 아니다').toBe(3);
    expect(new Set(cols)).toEqual(new Set(['credits', 'minerals', 'catalyst_residue']));
  });
});

// ---------------------------------------------------------------------------
// 4·5. salvage_catalyst — 닫힌 경제 전환 + 환급 산식
// ---------------------------------------------------------------------------

describe('salvage_catalyst — grant_currency 미경유 + 잔재 환급', () => {
  const salvage = effectiveFunctionBody('salvage_catalyst');

  it('grant_currency 를 호출하지 않는다', () => {
    expect(salvage.code).not.toContain('grant_currency');
  });

  // 부재 단언만으로는 빈 구현을 못 막는다 — 양성 단언을 반드시 함께 둔다.
  it('catalyst_defs 를 조회해 가격을 읽는다(양성 단언)', () => {
    expect(salvage.code).toContain('public.catalyst_defs');
    expect(salvage.code).toMatch(/select\s+buy_price\s+into/);
  });

  it('no-profile 게이트가 남아 있다(grant_currency 에서 이식)', () => {
    expect(salvage.code).toContain('no-profile');
  });

  it('환급 비율 리터럴이 TS SALVAGE_RATIO_PCT 와 같다', () => {
    const m = /SALVAGE_RATIO_PCT\s+constant\s+numeric\s*:=\s*([\d.]+)\s*;/.exec(salvage.code);
    expect(m, 'DECLARE 에 SALVAGE_RATIO_PCT constant numeric 리터럴이 없다').not.toBeNull();
    expect(Number(m![1])).toBe(SALVAGE_RATIO_PCT);
  });

  it('floor 의 닫는 괄호가 * v_qty 앞에 온다 — 결합 순서가 계약이다', () => {
    // 실재하는 발산은 비율이 아니라 결합 순서다. floor(price*pct/100)*qty 와
    // floor(price*pct*qty/100) 은 buy_price=25·qty=3 에서 36 vs 37 로 갈리고 TS 는 36이다.
    const m = /floor\(([^()]*)\)\s*\*\s*v_qty/.exec(salvage.code);
    expect(m, 'floor(...) * v_qty 형상이 아니다 — 결합 순서가 뒤집혔을 수 있다').not.toBeNull();
    expect(m![1], 'v_qty 가 floor( 안에 들어가 있다 — 장당 절하 후 수량 곱이어야 한다').not.toContain(
      'v_qty',
    );
    // TS 쪽 정본이 실제로 36 임을 함께 못박는다(id 32 = 특산 보스, buy_price 25).
    expect(catalystSalvageValue(32) * 3).toBe(36);
  });
});

// ---------------------------------------------------------------------------
// 6. 잠금 순서 — 양쪽 함수 모두. 데드락은 이 단언으로만 잡힌다.
// ---------------------------------------------------------------------------

describe('ABBA 데드락 방지 — catalyst_inventory → profiles 순으로만 잠근다', () => {
  for (const name of ['salvage_catalyst', 'buy_catalyst'] as const) {
    it(`${name} 의 for update 등장 순서가 inventory → profiles 다`, () => {
      const order = forUpdateLockOrder(effectiveFunctionBody(name).code);
      expect(
        order,
        '잠금 순서가 뒤집히면 두 RPC 가 정면 교착한다 — 단위 테스트·1바퀴 플레이·육안 중 무엇으로도 안 잡힌다',
      ).toEqual(['catalyst_inventory', 'profiles']);
    });
  }
});

// ---------------------------------------------------------------------------
// 7. buy_catalyst 거부 사유 4종
// ---------------------------------------------------------------------------

describe('buy_catalyst — 거부 게이트', () => {
  const buy = effectiveFunctionBody('buy_catalyst');

  for (const note of ['price-unset', 'signature-not-sold', 'insufficient-residue', 'no-profile']) {
    it(`${note} 게이트가 있다`, () => {
      expect(buy.code).toContain(note);
    });
  }
});

// ---------------------------------------------------------------------------
// 8. profiles.catalyst_residue 컬럼 DDL (함수 본문 헬퍼로는 닿지 않는다)
// ---------------------------------------------------------------------------

describe('profiles.catalyst_residue 컬럼 선언', () => {
  it('public.profiles 에 컬럼을 추가하고 >= 0 체크를 건다', () => {
    const raw = rawMigrationText();
    const m = /alter table public\.profiles\s+add column if not exists catalyst_residue\b[^;]*/.exec(
      raw,
    );
    expect(m, 'profiles.catalyst_residue 컬럼 선언이 없다').not.toBeNull();
    expect(m![0]).toContain('numeric');
    expect(m![0], '음수 방어 체크가 없다').toMatch(/check\s*\(\s*catalyst_residue\s*>=\s*0\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// 9. 구매 가능성 세 술어 일치 — 독립 증인 3개
// ---------------------------------------------------------------------------

describe('구매 가능성 — SQL planet is null / TS kind === common / 경계 id < 30', () => {
  const defsRows = catalystDefsSeedRows();

  // ⚠️ 행 수 선행 단언 — 0행이면 아래 집합 비교가 전부 공집합끼리의 비교가 된다.
  it('3열 시드 파싱 행 수가 CATALYSTS.length 와 같다', () => {
    expect(defsRows.length).toBe(CATALYSTS.length);
  });

  it('세 술어의 id 집합이 일치한다', () => {
    const fromSql = defsRows.filter((r) => r.planet === null).map((r) => r.id).sort((a, b) => a - b);
    const fromTs = CATALYST_PRICE_MIRROR.filter((m) => m.purchasable)
      .map((m) => m.catalystId)
      .sort((a, b) => a - b);
    // `id < 30` 은 **하드코딩 경계로 유지한다**. `kind === 'signature'` 파생으로 바꾸면 세 번째
    // 술어가 두 번째와 같은 소스가 되어 독립 증인이 3 → 2 로 줄고 단언이 자기 자신과 대조하게 된다.
    const fromBoundary = CATALYSTS.map((c) => c.id)
      .filter((id) => id < 30)
      .sort((a, b) => a - b);

    const HINT =
      '촉매를 추가했다면 세 술어(planet is null / kind === common / id < 30) 중 무엇을 갱신할지 판단하라 — 자동 파생으로 바꾸면 독립 증인이 사라진다';
    expect(fromSql, HINT).toEqual(fromTs);
    expect(fromBoundary, HINT).toEqual(fromTs);
  });
});
