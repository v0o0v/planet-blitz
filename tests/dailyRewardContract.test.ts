/**
 * 일일 보상 계약 대조 (ADR-0048 · `supabase/migrations/20260805000000_daily_reward.sql`).
 *
 * 이 계약이 지키는 것들은 **전부 런타임에 조용하다** — 깨져도 게임은 정상으로 보인다:
 *   ① 앵커 트리거의 `when (new.source <> 'daily_reward')` — 빠지면 일일 보상이 자기 상한을
 *      밀어 올려 플레이 0 계정의 천장이 접속만으로 단조 상승한다. ADR-0048 의 **유일한
 *      정당화**가 그 자리에서 무너지는데 화면에는 아무 표시도 없다.
 *   ② 봉인 열거식 — 컬럼을 늘리면서 가드를 안 고치면 클라가 PostgREST 직타로
 *      `daily_streak: 30` · `lifetime_granted: 10^9` 을 쓴다.
 *   ③ 트리거 서브트랜잭션 — 없으면 이 경로의 예외가 정산 트랜잭션 전체를 롤백해
 *      **전 플레이어가 자원을 못 받고 화면은 조용하다**(PR#222 형상).
 *   ④ `p_date_seed` 부재 — 받는 순간 복합 PK 가 서로 다른 seed 를 안 막아 하루 여러 번 수령.
 *   ⑤ `grant_currency_for` 재정의의 캡 상수 전집합 — 하나라도 흘리면 그 축이 조용히 절삭된다.
 *
 * ⚠️ **단언은 `body` 가 아니라 `code`(줄 주석 제거본)로 한다.** 이 리포의 SQL 은 본문 안에
 *    규약을 길게 주석으로 적어 두고 그 주석에 계약 문자열이 그대로 들어 있다 — `body` 로
 *    단언하면 구현이 사라져도 초록이다(catalystShopContract 가 실제로 밟은 함정).
 *
 * ⚠️ **부재 단언만으로는 빈 구현을 못 막는다** — 양성 단언을 항상 함께 둔다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DAILY_STREAK_CYCLE,
  DAILY_BUDGET_DAY_1,
  DAILY_BUDGET_DAY_30,
  DAILY_CEILING_RATE,
  DAILY_BUDGET_FLOOR,
} from '../data/dailyReward.js';
import { MINERAL_TO_CREDIT } from '../data/dailyRewardSelection.js';
import { GRANT_CURRENCY_CLIENT_SOURCES } from '../src/run/commissionServerConstants.js';

// ---------------------------------------------------------------------------
// 마이그레이션 유효 정의 추출
// (출처: tests/catalystShopContract.test.ts:54 — 같은 관용구를 복사해 온 것이다.
//  파일명 순 = 적용 순이므로 같은 함수가 여러 마이그레이션에 있으면 마지막 정의가 실제로 산다.)
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const DAILY_FILE = '20260805000000_daily_reward.sql';
const COMMISSION_FILE = '20260803000000_commission_ledger.sql';

function migrationsInOrder(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    // 이 저장소 tsconfig 의 fs 타입은 readFileSync 가 1인자·바이트 반환이다.
    .map((f) => ({ file: f, sql: new TextDecoder().decode(readFileSync(MIGRATIONS_DIR + f)) }));
}

/** `--` 줄 주석 제거. 규약 주석이 계약 문자열을 그대로 담고 있어 파서를 오염시킨다. */
function stripLineComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

function sqlOf(file: string): string {
  const hit = migrationsInOrder().find((m) => m.file === file);
  if (hit === undefined) throw new Error(`${file} 가 없습니다`);
  return hit.sql;
}

const dailySql = (): string => sqlOf(DAILY_FILE);
const dailyCode = (): string => stripLineComments(dailySql());

/** 한 파일 안의 `create or replace function public.<name>(` 블록 원문(마지막 정의). */
function rawFunctionBlock(sql: string, name: string): string {
  const marker = `create or replace function public.${name}(`;
  const at = sql.lastIndexOf(marker);
  expect(at, `${name} 정의를 찾지 못함`).toBeGreaterThan(-1);
  const end = sql.indexOf('\n$$;', at);
  expect(end, `${name} 본문 종결자를 찾지 못함`).toBeGreaterThan(at);
  return sql.slice(at, end + 4);
}

/** 적용 순 기준 **마지막** 정의 = 실제로 사는 정의. */
function effectiveFunctionBody(name: string): { file: string; body: string; code: string } {
  let found: { file: string; body: string; code: string } | null = null;
  for (const { file, sql } of migrationsInOrder()) {
    const marker = `create or replace function public.${name}(`;
    if (sql.lastIndexOf(marker) < 0) continue;
    const body = rawFunctionBlock(sql, name);
    found = { file, body, code: stripLineComments(body) };
  }
  if (found === null) throw new Error(`마이그레이션에서 ${name} 정의를 찾지 못했습니다`);
  return found;
}

/** 특정 파일 안의 정의(개정 전 원본과 대조할 때 쓴다). */
function functionCodeInFile(file: string, name: string): string {
  return stripLineComments(rawFunctionBlock(sqlOf(file), name));
}

/**
 * 정규식 캡처 그룹을 **문자열로 확정해서** 돌려준다.
 *
 * `noUncheckedIndexedAccess` 아래에서 `m[1]` 은 `string | undefined` 다. `!` 로 눌러 두면 타입만
 * 조용해지고 그룹이 안 잡힌 경우 `undefined` 가 흘러 **비교가 빈 값끼리 같다고 말하며 통과**한다.
 */
function grp(m: RegExpMatchArray | RegExpExecArray | null, i: number, what: string): string {
  const v = m?.[i];
  if (typeof v !== 'string') throw new Error(`${what}: 캡처 그룹 ${i} 를 읽지 못했다`);
  return v;
}

/** DECLARE 의 `<NAME> constant <type> := <리터럴>` 을 등장 순서대로 전부 뽑는다. */
function sqlConstants(code: string, name: string): number[] {
  const re = new RegExp(`${name}\\s+constant\\s+\\w+\\s*:=\\s*([0-9.]+)`, 'g');
  return [...code.matchAll(re)].map((m) => Number(grp(m, 1, `${name} 리터럴`)));
}

/** `... ;` 로 끝나는 단일 문을 앵커 문자열부터 잘라 온다. */
function statementFrom(code: string, anchor: string): string {
  const at = code.indexOf(anchor);
  expect(at, `앵커를 찾지 못함: ${anchor}`).toBeGreaterThan(-1);
  const end = code.indexOf(';', at);
  expect(end, `${anchor}: 문 종결자를 찾지 못함`).toBeGreaterThan(at);
  return code.slice(at, end + 1);
}

/**
 * 본문에서 `for update` 가 걸린 테이블을 등장 순서대로 나열한다.
 * (catalystShopContract 의 `forUpdateLockOrder` 와 같은 관용구.)
 */
function forUpdateLockOrder(code: string): string[] {
  const order: string[] = [];
  let lastTable: string | null = null;
  for (const m of code.matchAll(/public\.(\w+)|for update/g)) {
    if (m[0] === 'for update') order.push(lastTable ?? '<unknown>');
    else lastTable = m[1] ?? null;
  }
  return order;
}

/** ABBA 데드락의 대상이 되는 인벤토리 계열 테이블. */
const INVENTORY_TABLES = [
  'catalyst_inventory',
  'core_modules',
  'defense_blueprints',
  'commission_inventory',
];

const CLAIM_SIG = 'public.claim_daily_reward_for(uuid, text, numeric, jsonb, jsonb, jsonb)';
const PREVIEW_SIG = 'public.daily_reward_preview_for(uuid)';

// ---------------------------------------------------------------------------
// 1. 봉인 — 컬럼 열거식이라 컬럼을 늘리면 여기를 반드시 함께 고쳐야 한다
// ---------------------------------------------------------------------------

describe('봉인 개정 — 클라 쓰기 차단 (신규 3컬럼)', () => {
  it('guard_profiles_client_write 의 대입이 정확히 12개이고 집합이 계약과 같다', () => {
    const guard = effectiveFunctionBody('guard_profiles_client_write');
    const cols = [...guard.code.matchAll(/new\.(\w+)\s*:=\s*old\.(\w+)\s*;/g)].map((m) => {
      expect(m[2], `${m[1]} 을 다른 컬럼(${m[2]})의 old 값으로 되돌리고 있다`).toBe(m[1]);
      return m[1];
    });
    expect(cols.length, '봉인 대입 총수가 12가 아니다 — 컬럼을 지웠거나 늘렸다').toBe(12);
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
        'daily_last_claim_seed',
        'daily_streak',
        'lifetime_granted',
      ]),
    );
  });

  it('guard_profiles_client_insert 의 0 강제가 정확히 6개이고 집합이 계약과 같다', () => {
    const guard = effectiveFunctionBody('guard_profiles_client_insert');
    const cols = [...guard.code.matchAll(/new\.(\w+)\s*:=\s*0\s*;/g)].map((m) => m[1]);
    // 신규 3컬럼을 전부 `:= 0` 으로 정한 이유가 **정확히 이 정규식이 그대로 통하게** 하기
    // 위함이다. 하나만 `:= -1` 로 두면 그 컬럼이 계약의 시야 밖으로 빠져 "봉인이 있다고
    // 세면서 실제로는 세지 않는" 상태가 된다.
    expect(cols.length, '0 강제 대입 총수가 6이 아니다').toBe(6);
    expect(new Set(cols)).toEqual(
      new Set([
        'credits',
        'minerals',
        'catalyst_residue',
        'daily_last_claim_seed',
        'daily_streak',
        'lifetime_granted',
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// 2. daily_reward_claims — 복합 PK · 쓰기 정책 부재 · 부분 인덱스
// ---------------------------------------------------------------------------

describe('daily_reward_claims — 원장 DDL', () => {
  it('복합 PK (profile_id, date_seed) 가 중복 수령을 구조적으로 막는다', () => {
    const at = dailyCode().indexOf('create table if not exists public.daily_reward_claims');
    expect(at, '원장 테이블 DDL 이 없다').toBeGreaterThan(-1);
    const end = dailyCode().indexOf('\n);', at);
    expect(end, '원장 DDL 의 종결을 찾지 못했다').toBeGreaterThan(at);
    const ddl = dailyCode().slice(at, end);
    expect(ddl, '복합 PK 가 없다 — 하루 여러 번 수령이 열린다').toContain(
      'primary key (profile_id, date_seed)',
    );
    // 양성 짝: 재굴림 금지의 근거 컬럼이 실제로 있는가(AC-5).
    expect(ddl).toContain('result_payload');
  });

  it('RLS 가 켜져 있고 정책이 select 전용이다 — 쓰기 정책이 하나도 없다', () => {
    const code = dailyCode();
    expect(code).toContain('alter table public.daily_reward_claims enable row level security');
    const policies = [...code.matchAll(/create policy[\s\S]*?;/g)]
      .map((m) => m[0])
      .filter((p) => p.includes('public.daily_reward_claims'));
    // 정책이 0개면 아래 for 루프가 공허하게 통과한다 — 선행 단언으로 막는다.
    expect(policies.length, 'daily_reward_claims 정책이 하나도 없다').toBeGreaterThan(0);
    for (const p of policies) {
      expect(p).toContain('for select');
      for (const verb of ['for insert', 'for update', 'for delete', 'for all']) {
        expect(p, `쓰기 정책 발견: ${p.slice(0, 80)}`).not.toContain(verb);
      }
    }
  });

  it('미반영 조회용 부분 인덱스가 where applied_at is null 로 걸려 있다', () => {
    const idx = statementFrom(dailyCode(), 'create index if not exists daily_reward_claims_pending_idx');
    expect(idx).toContain('on public.daily_reward_claims');
    expect(idx, '부분 인덱스가 아니다 — 영구 보존 원장에서 풀스캔이 된다').toMatch(
      /where\s+applied_at\s+is\s+null/,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. claim_daily_reward_for — 서버 시각 · 원장 미스캔 · 연속일 리셋값
// ---------------------------------------------------------------------------

describe('claim_daily_reward_for — 수령 경로의 하중 부재', () => {
  const claim = effectiveFunctionBody('claim_daily_reward_for');
  const preview = effectiveFunctionBody('daily_reward_preview_for');

  it('시그니처에 p_date_seed 가 없고, 본문이 서버 시각으로 계산한다', () => {
    const sigEnd = claim.code.indexOf('returns jsonb');
    expect(sigEnd).toBeGreaterThan(0);
    const sig = claim.code.slice(0, sigEnd);
    // 받는 순간 복합 PK 가 서로 다른 seed 를 안 막아 하루에 여러 번 수령이 열린다.
    expect(sig, 'p_date_seed 를 파라미터로 받고 있다').not.toContain('p_date_seed');
    // 부재 단언 짝 — 빈 구현(계산 자체가 없음)을 막는 양성 단언.
    expect(claim.code, '서버 시각으로 seed 를 계산하지 않는다').toContain(
      'extract(epoch from now())',
    );
    expect(preview.code).toContain('extract(epoch from now())');
  });

  it('연속 판정이 원장을 스캔하지 않는다 (AC-7)', () => {
    for (const fn of [claim, preview]) {
      expect(fn.code, '원장 집계가 연속일 읽기의 핫 경로가 됐다').not.toMatch(/count\s*\(/);
      expect(fn.code).not.toContain('group by');
    }
    // 양성 짝: 직전 seed 하나만 읽는가.
    expect(preview.code).toContain('daily_last_claim_seed');
    expect(preview.code).toMatch(/from public\.profiles where id = p_recipient/);
  });

  it('끊김의 값이 1 이다 — 어디에서도 daily_streak 를 0 으로 리셋하지 않는다 (AC-8)', () => {
    // ⚠️ guard_profiles_client_insert 는 예외다(신규 프로필은 0 이 맞다) — 대상에서 뺀다.
    const withoutInsertGuard = stripLineComments(
      dailySql().replace(rawFunctionBlock(dailySql(), 'guard_profiles_client_insert'), ''),
    );
    expect(withoutInsertGuard, '가드 블록 제거가 헛돌았다').not.toContain(
      'ADR-0048: 앵커를 심고 시작하는 경로 차단',
    );
    expect(withoutInsertGuard, '0 리셋이 있다 — 오늘 수령분이 이미 1일차라 0 이 될 수 없다').not.toMatch(
      /daily_streak\s*:?=\s*0\b/,
    );
    // 양성 짝: 하한이 1 로 접혀 있는가.
    expect(claim.code).toMatch(/daily_streak\s*=\s*least\(DAILY_STREAK_CYCLE,\s*greatest\(1,/);
  });

  it('멱등 경로가 기존 행을 그대로 돌려준다 — 재굴림하지 않는다 (AC-5)', () => {
    expect(claim.code).toContain('on conflict (profile_id, date_seed) do nothing');
    expect(claim.code).toContain("'already', true");
  });
});

// ---------------------------------------------------------------------------
// 3-b. 절삭이 표시가 아니라 **실지급**까지 내려간다
// ---------------------------------------------------------------------------

describe('상한 절삭이 실지급에 적용된다 — 표시만 깎으면 유계가 새는 자리다', () => {
  /**
   * 실제로 밟은 결함이다. 초안은 예산으로 깎은 값을 `v_result.value` 에만 넣고, 아래
   * `grant_currency_for` 에는 EF 가 실어 온 `p_result.credits` **원값**을 그대로 넘겼다.
   * 그러면 *"preview 반환값은 힌트이지 권위가 아니다"* 라는 TOCTOU 방어가 재화 축에서
   * **표시상으로만** 성립하고, 실지급의 상한은 `CAP_DAILY_REWARD_CREDITS`(25,000) 하나가
   * 된다 — 상한 유계가 이 설계의 유일한 안전장치인데 바로 그 자리에서 샌다.
   *
   * ⚠️ 이 결함은 **초록으로 지나간다.** 반환 jsonb 의 `clamped` 도 `value` 도 맞게 나오고,
   * 원장 행의 `clamped` 컬럼도 true 다. 오직 지급액만 안 깎인다. 그래서 정적 단언이 필요하다.
   */
  const claim = effectiveFunctionBody('claim_daily_reward_for');

  it('축 성분을 비율로 깎는 스케일이 존재한다', () => {
    expect(claim.code).toMatch(/v_scale\s*:=/);
    // 0 나눗셈 가드 — v_claim 이 0 이면 비율이 1 이어야 한다(0/0 은 예외다).
    expect(claim.code).toMatch(/v_claim\s*>\s*0/);
  });

  it('원장에 적는 result_payload 의 credits·minerals 가 스케일을 통과한다', () => {
    // `'credits', floor(coalesce((p_result->>'credits')::numeric, 0) * v_scale)` 형태.
    // ⚠️ `[^)]*` 로는 못 잡는다 — 값 표현식 자체가 괄호를 품는다. 비탐욕 + 길이 상한으로
    //    "그 키 바로 뒤 표현식 안에" 있음을 재되, 다음 키까지 넘어가지 않게 120자로 끊는다.
    expect(claim.code).toMatch(/'credits'\s*,[\s\S]{0,120}?v_scale/);
    expect(claim.code).toMatch(/'minerals'\s*,[\s\S]{0,120}?v_scale/);
  });

  it('grant_currency_for 에 넘기는 값이 p_result 가 아니라 v_result 에서 나온다', () => {
    const grantAt = claim.code.indexOf('public.grant_currency_for(');
    expect(grantAt, 'grant_currency_for 호출이 없다').toBeGreaterThan(0);
    const call = claim.code.slice(grantAt, grantAt + 600);
    // 깎인 사본(v_result)을 읽어야 한다.
    expect(call).toContain("v_result->>'credits'");
    expect(call).toContain("v_result->>'minerals'");
    // ⚠️ 원값(p_result)을 직접 읽으면 절삭이 무의미해진다 — 그것이 이 결함의 형상이었다.
    expect(call).not.toContain("p_result->>'credits'");
    expect(call).not.toContain("p_result->>'minerals'");
  });
});

// ---------------------------------------------------------------------------
// 4. 권한 — 수령은 EF 전용이다 (재정의된 AC-25)
// ---------------------------------------------------------------------------

describe('service_role 전용 — authenticated 진입점이 없다', () => {
  const code = dailyCode();

  for (const sig of [CLAIM_SIG, PREVIEW_SIG]) {
    it(`${sig} 가 public/anon/authenticated 에서 회수되고 service_role 에만 부여된다`, () => {
      // ⚠️ Postgres 는 함수 생성 시 PUBLIC 에 EXECUTE 를 **자동 부여**한다. public 회수가 빠지면
      //    authenticated 가 PUBLIC 을 통해 도달해 "수령은 EF 전용" 구조 전체가 무효가 된다.
      for (const role of ['public', 'anon', 'authenticated']) {
        expect(code).toContain(`revoke all on function ${sig} from ${role}`);
      }
      expect(code).toContain(`grant execute on function ${sig} to service_role`);
      // 부여 줄 어디에도 authenticated 가 끼어 있으면 안 된다(mark_* 와 달리 이쪽은 EF 전용).
      const escaped = sig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(
        code,
        'authenticated 에 grant 하는 줄이 있다 — 쓰지도 않는 순공격면이 열린다',
      ).not.toMatch(new RegExp(`grant execute on function ${escaped} to [^;]*authenticated`));
    });
  }

  it('authenticated 래퍼(claim_daily_reward)를 만들지 않았다', () => {
    // grant_currency 2단 구조를 베끼지 않는 이유는 그쪽엔 클라가 직접 부르는 경로가 실재해서다.
    const all = migrationsInOrder().map((m) => m.sql).join('\n');
    expect(all, '_for 없는 래퍼가 존재한다').not.toMatch(/public\.claim_daily_reward(?!_for)/);
  });
});

// ---------------------------------------------------------------------------
// 5. 상한 앵커 트리거 — 이 파일에서 가장 중요한 단언
// ---------------------------------------------------------------------------

describe('상한 앵커 트리거 — 자기참조 되먹임 차단', () => {
  it('trg_currency_grants_anchor 에 source 필터가 있다', () => {
    const trg = statementFrom(dailyCode(), 'create trigger trg_currency_grants_anchor');
    expect(trg).toContain('after insert on public.currency_grants');
    // ⚠️ **이 단언이 이 파일에서 가장 중요하다.** 필터가 조용히 빠지면 일일 보상이 지급한
    //    크레딧이 자기 상한을 밀어 올려 플레이 0 계정의 천장이 접속만으로 단조 상승하고,
    //    ADR-0048 의 유일한 정당화("정직한 플레이로 이미 닿는 범위 안")가 무너진다.
    expect(trg, 'source 필터가 없다 — 30일 봇 접속이 상한 자체를 키운다').toContain(
      "when (new.source <> 'daily_reward')",
    );
  });

  it('트리거 본문이 서브트랜잭션으로 감싸여 있다', () => {
    const { code } = effectiveFunctionBody('trg_daily_reward_anchor_bump');
    // 이 트리거는 currency_grants 의 **모든** insert 에서 발동한다(PvE 정산·의뢰·분해·스토리).
    // 감싸지 않으면 여기의 예외 하나가 정산 트랜잭션 전체를 롤백해 전 플레이어가 자원을
    // 못 받고 화면은 조용하다.
    expect(code).toContain('exception when others');
    expect(code).toContain('raise warning');
    // ⚠️ 통과하면서도 참일 수 있는 나쁜 상태: exception 블록이 **본문 일부만** 감싸 가산
    //    UPDATE 가 밖에 있는 경우. 순서로 잰다.
    const beginAt = code.indexOf('begin');
    const updateAt = code.indexOf('update public.profiles');
    const excAt = code.indexOf('exception when others');
    expect(beginAt).toBeLessThan(updateAt);
    expect(updateAt).toBeLessThan(excAt);
  });

  it('트리거 함수가 definer + search_path 고정이다', () => {
    const { code } = effectiveFunctionBody('trg_daily_reward_anchor_bump');
    expect(code).toContain('security definer');
    expect(code).toContain("set search_path = ''");
  });
});

// ---------------------------------------------------------------------------
// 6. 고치지 않은 것 · 잠그지 않은 것
// ---------------------------------------------------------------------------

describe('settle_pve_run 을 재정의하지 않는다', () => {
  it('이 마이그레이션에 settle_pve_run 정의가 없다', () => {
    // 이 리포에서 가장 위험한 편집. 5회 재정의됐고 그 복제가 PvE 정산을 100% 깨뜨렸다
    // (20260802000000:4-15). 상한 앵커는 AFTER 트리거로 **붙인다**.
    expect(dailyCode()).not.toContain('create or replace function public.settle_pve_run');
    // 양성 짝: 대신 트리거로 붙였는가.
    expect(dailyCode()).toContain('create trigger trg_currency_grants_anchor');
  });
});

describe('ABBA 데드락 — 한 호출에 등장하는 인벤토리는 최대 1개다', () => {
  it('claim_daily_reward_for 본문이 인벤토리를 잠그지 않는다', () => {
    const order = forUpdateLockOrder(effectiveFunctionBody('claim_daily_reward_for').code);
    expect(order.filter((t) => INVENTORY_TABLES.includes(t))).toEqual([]);
  });

  it('호출되는 함수(grant_currency_for)까지 훑어도 인벤토리 잠금이 2개 미만이다', () => {
    // ⚠️ 계약 단언은 `for update` 문자열만 본다 — **다른 함수 본문의** 잠금은 시야 밖이라
    //    호출되는 함수까지 훑는다. `grant_currency_for` 의 `for update` 가 정확히 그 사각지대다.
    const claim = forUpdateLockOrder(effectiveFunctionBody('claim_daily_reward_for').code);
    const grant = forUpdateLockOrder(effectiveFunctionBody('grant_currency_for').code);
    // 선행 단언 — 파서가 헛돌면 아래 집합이 공집합이라 공허하게 통과한다.
    expect(grant, 'grant_currency_for 에서 profiles 잠금을 찾지 못했다').toContain('profiles');
    // 계약은 "0개"가 아니라 **최대 1개**다(슬라이스 2 가 촉매 축을 붙이면 1개가 정상이 된다).
    // 둘이 되는 순간 잠금 순서가 함수마다 갈려 진짜 ABBA 가 열리고, 그것은 단위 테스트·
    // 1바퀴 플레이·육안 중 무엇으로도 안 잡힌다.
    const locked = [...new Set([...claim, ...grant].filter((t) => INVENTORY_TABLES.includes(t)))];
    expect(locked.length, `한 호출에 인벤토리가 둘 이상 잠긴다: ${locked.join(', ')}`)
      .toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 7. 상수 미러 — SQL ↔ TS
// ---------------------------------------------------------------------------

describe('상수 미러 — SQL 리터럴 ↔ TS 정본', () => {
  const code = dailyCode();

  const CASES: { name: string; ts: number; count: number }[] = [
    { name: 'DAILY_STREAK_CYCLE', ts: DAILY_STREAK_CYCLE, count: 2 },
    { name: 'DAILY_BUDGET_DAY_1', ts: DAILY_BUDGET_DAY_1, count: 1 },
    { name: 'DAILY_BUDGET_DAY_30', ts: DAILY_BUDGET_DAY_30, count: 1 },
    { name: 'DAILY_CEILING_RATE', ts: DAILY_CEILING_RATE, count: 1 },
    // ⚠️ 백필 do-block(1절)과 앵커 트리거(5절) **두 곳**에 있다. 갈리면 앵커가 세는 단위와
    //    보상 가치를 재는 단위가 달라져 "지금까지 받은 만큼에서 파생된 천장"이 두 개의 서로
    //    다른 '만큼'을 뜻하게 된다.
    { name: 'MINERAL_TO_CREDIT', ts: MINERAL_TO_CREDIT, count: 2 },
  ];

  for (const c of CASES) {
    it(`${c.name} 리터럴 ${c.count}곳이 전부 TS 값(${c.ts})과 같다`, () => {
      const found = sqlConstants(code, c.name);
      expect(found.length, `${c.name} 선언 수가 ${c.count} 이 아니다`).toBe(c.count);
      expect(new Set(found), `${c.name} 이 SQL 안에서 서로 갈렸다`).toEqual(new Set([c.ts]));
    });
  }

  it('천장의 하한이 DAILY_BUDGET_DAY_1 파생이다 — 별도 FLOOR 리터럴이 아니다', () => {
    const { code: preview } = effectiveFunctionBody('daily_reward_preview_for');
    // FLOOR 를 DAILY_BUDGET_DAY_1 위로 올리는 순간 유계가 깨진다 — 플레이 0 계정이 램프
    // 중간 이상을 무료로 받고 30일 봇 접속이 다시 이득이 된다.
    expect(preview).toMatch(/v_ceiling\s*:=\s*greatest\(\s*DAILY_BUDGET_DAY_1\s*,/);
    expect(preview, 'FLOOR 가 독립 리터럴로 떨어져 나갔다').not.toContain('DAILY_BUDGET_FLOOR');
    // TS 쪽도 파생으로 묶여 있어야 같은 계약이 된다.
    expect(DAILY_BUDGET_FLOOR).toBe(DAILY_BUDGET_DAY_1);
  });

  it('백필 UPDATE 에 재적용 가드(lifetime_granted = 0)가 있다', () => {
    // 재실행이 이미 자란 값을 낮추면 앵커의 단조성이 깨진다.
    const at = code.indexOf('update public.profiles p');
    expect(at, '백필 UPDATE 를 찾지 못했다').toBeGreaterThan(-1);
    const end = code.indexOf(';', at);
    const stmt = code.slice(at, end);
    expect(stmt).toMatch(/where\s+p\.lifetime_granted\s*=\s*0/);
    // 양성 짝: 잔액 하한을 실제로 계산하는가.
    expect(stmt).toContain('MINERAL_TO_CREDIT');
  });
});

// ---------------------------------------------------------------------------
// 8. grant_currency_for 개정 무결성 — 낡은 본문 복제가 프로덕션을 깨뜨린 전례
// ---------------------------------------------------------------------------

describe('grant_currency_for 개정 — 캡 상수 전집합이 값까지 보존됐다', () => {
  const revised = effectiveFunctionBody('grant_currency_for');
  const original = functionCodeInFile(COMMISSION_FILE, 'grant_currency_for');

  const CARRIED = [
    'CAP_PVE_RUN_CREDITS',
    'CAP_PVE_RUN_MINERALS',
    'CAP_SALVAGE_CREDITS',
    'CAP_SALVAGE_MINERALS',
    'CAP_STORY_CREDITS',
    'CAP_COMMISSION_CREDITS',
    'CAP_COMMISSION_MINERALS',
    'CAP_DEFAULT_CREDITS',
    'CAP_DEFAULT_MINERALS',
    'CAP_HOURLY_CREDITS',
    'CAP_HOURLY_MINERALS',
    'CAP_DAILY_CREDITS',
    'CAP_DAILY_MINERALS',
    'PLAUSIBILITY_CREDITS_PER_TICK',
    'PLAUSIBILITY_MINERALS_PER_TICK',
    'FLAG_MULTIPLE',
  ];

  it('개정본이 일일 보상 마이그레이션에 있다(= 실제로 재정의했다)', () => {
    expect(revised.file).toBe(DAILY_FILE);
  });

  for (const name of CARRIED) {
    it(`${name} 이 원본(${COMMISSION_FILE})과 같은 값으로 살아 있다`, () => {
      const before = sqlConstants(original, name);
      const after = sqlConstants(revised.code, name);
      // 원본에서 못 읽으면 대조가 공허해진다 — 선행 단언.
      expect(before.length, `원본에서 ${name} 을 읽지 못했다`).toBe(1);
      expect(after.length, `${name} 이 개정본에서 사라졌다 — 그 축이 조용히 절삭된다`).toBe(1);
      expect(after).toEqual(before);
    });
  }

  it('일일 보상 per-call 캡이 신설됐다', () => {
    for (const name of ['CAP_DAILY_REWARD_CREDITS', 'CAP_DAILY_REWARD_MINERALS']) {
      const v = sqlConstants(revised.code, name);
      expect(v.length, `${name} 선언이 없다`).toBe(1);
      // 30일차 공통 가치 예산(DAILY_BUDGET_DAY_30)을 담아야 한다 — 못 담으면 램프가 죽는다.
      expect(v[0]).toBeGreaterThanOrEqual(DAILY_BUDGET_DAY_30);
    }
  });

  it("case p_source 에 'daily_reward' 갈래가 있다", () => {
    // 미등록 source 로 두면 else 로 떨어져 CAP_DEFAULT(1000)에 **조용히 절삭**된다.
    expect(revised.code).toContain("when 'daily_reward' then");
    expect(revised.code).toContain('CAP_DAILY_REWARD_CREDITS');
    // 기존 갈래도 전수 보존됐는가(양성 짝).
    for (const label of ['pve_run', 'salvage', 'story', 'commission']) {
      expect(revised.code).toContain(`when '${label}'`);
    }
  });

  it('원장 우회가 없다', () => {
    expect(revised.code).toContain('insert into public.currency_grants');
  });
});

describe('클라 allowlist 불변 — daily_reward 는 클라 진입점이 아니다', () => {
  it('grant_currency 래퍼가 재정의되지 않았고 allowlist 가 TS 정본과 같다', () => {
    const wrapper = effectiveFunctionBody('grant_currency');
    // 일일 보상 마이그레이션이 이 함수를 건드렸다면 유효 정의 파일이 바뀐다.
    expect(wrapper.file, '일일 보상이 클라 진입점을 재정의했다').not.toBe(DAILY_FILE);
    const m = /p_source\s+not in\s*\(([^)]*)\)/.exec(wrapper.code);
    expect(m, 'allowlist(default-deny) 를 찾지 못했다').not.toBeNull();
    const sources = [...grp(m, 1, 'allowlist 목록').matchAll(/'([^']+)'/g)].map((x) =>
      grp(x, 1, 'allowlist 항목'),
    );
    expect(sources).toEqual([...GRANT_CURRENCY_CLIENT_SOURCES]);
    expect(sources, '클라가 daily_reward 로 들어올 수 있다').not.toContain('daily_reward');
  });
});
