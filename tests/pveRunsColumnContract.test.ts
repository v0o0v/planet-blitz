/**
 * pve_runs 컬럼 계약 — 드롭된 컬럼을 다시 참조하는 회귀를 막는다
 * (`supabase/migrations/20260802000000_settle_pve_run_column_restore.sql`).
 *
 * ▮ 잡으려는 결함 (2026-07-31 원격 실측으로 확인된 실제 사고)
 *   20260726000300 이 pve_runs.replay·client_result 를 드롭했는데, 그 뒤 20260727010000 이
 *   **드롭 이전 본문을 복제해** settle_pve_run 을 재정의하면서 두 컬럼을 다시 INSERT 했다.
 *   그 결과 온라인 PvE 정산이 `42703 column "replay" ... does not exist` 로 **100% 실패**했고,
 *   클라는 오류를 조용한 거부로 처리하므로 화면·테스트 어디에도 흔적이 없었다.
 *
 *   이 계약은 "함수 본문이 참조하는 pve_runs 컬럼 ⊆ 마이그레이션을 순서대로 재생한 실제 컬럼"을
 *   단언한다. 컬럼을 드롭하는 마이그레이션과 그 컬럼을 쓰는 함수가 **다른 파일**에 있어도 잡힌다.
 *
 * ⚠️ 단언은 줄 주석 제거본으로 한다 — 이 리포의 SQL 은 계약 문자열을 주석에 그대로 적어 둔다
 *   (catalystGrantCapContract.test.ts 와 같은 함정).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));

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

/**
 * 마이그레이션을 적용 순으로 재생해 pve_runs 의 **실제 컬럼 집합**을 구한다.
 * create table / add column / drop column 셋만 본다(이 테이블이 겪은 변경의 전부).
 */
function livePveRunsColumns(): Set<string> {
  const cols = new Set<string>();
  for (const { sql } of migrationsInOrder()) {
    const code = stripLineComments(sql);

    const create = /create table if not exists public\.pve_runs \(([\s\S]*?)\n\);/.exec(code);
    if (create) {
      for (const line of (create[1] ?? '').split('\n')) {
        const m = /^\s{2}(\w+)\s+\w/.exec(line); // 2칸 들여쓴 컬럼 선언만(제약 줄 제외)
        if (m?.[1]) cols.add(m[1]);
      }
    }
    for (const m of code.matchAll(
      /alter table public\.pve_runs add column (?:if not exists )?(\w+)/g,
    )) {
      if (m[1]) cols.add(m[1]);
    }
    for (const m of code.matchAll(
      /alter table public\.pve_runs drop column (?:if exists )?(\w+)/g,
    )) {
      if (m[1]) cols.delete(m[1]);
    }
  }
  return cols;
}

/** 적용 순 기준 **마지막** 정의 = 실제로 사는 정의. 이름별로 모은다. */
function effectiveFunctionBodies(): Map<string, { file: string; code: string }> {
  const out = new Map<string, { file: string; code: string }>();
  for (const { file, sql } of migrationsInOrder()) {
    for (const m of sql.matchAll(/create or replace function public\.(\w+)\(/g)) {
      const name = m[1];
      if (name === undefined || m.index === undefined) continue;
      const end = sql.indexOf('\n$$;', m.index);
      if (end < 0) continue;
      out.set(name, { file, code: stripLineComments(sql.slice(m.index, end + 4)) });
    }
  }
  return out;
}

/** 본문이 pve_runs 에 대해 쓰기(insert 컬럼 목록 · update set 대상)로 지목한 컬럼들. */
function pveRunsWriteTargets(code: string): string[] {
  const cols: string[] = [];

  for (const m of code.matchAll(/insert into public\.pve_runs\s*\(([\s\S]*?)\)/g)) {
    for (const c of (m[1] ?? '').split(',')) {
      const name = c.trim();
      if (name) cols.push(name);
    }
  }
  for (const m of code.matchAll(/update public\.pve_runs\s*\n?\s*set ([\s\S]*?)\n\s*where /g)) {
    for (const assign of (m[1] ?? '').split(',')) {
      const name = /^\s*(\w+)\s*=/.exec(assign)?.[1];
      if (name) cols.push(name);
    }
  }
  return cols;
}

const LIVE_COLS = livePveRunsColumns();
const FNS = effectiveFunctionBodies();

// ---------------------------------------------------------------------------
// 0. 재생기 자체의 건전성 — 이게 틀리면 아래 단언 전부가 무의미하다
// ---------------------------------------------------------------------------

describe('pve_runs 컬럼 재생', () => {
  it('드롭된 두 컬럼이 없고, 살아 있는 컬럼은 있다', () => {
    expect(LIVE_COLS.has('replay'), 'replay 는 20260726000300 이 드롭했다').toBe(false);
    expect(LIVE_COLS.has('client_result'), 'client_result 는 20260726000300 이 드롭했다').toBe(false);
    for (const c of ['id', 'profile_id', 'verified_status', 'summary', 'catalyst_receipt']) {
      expect(LIVE_COLS.has(c), `${c} 컬럼을 재생기가 놓쳤다`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 1. 본체 — 어떤 함수도 없는 컬럼에 쓰지 않는다
// ---------------------------------------------------------------------------

describe('pve_runs 쓰기 대상 컬럼', () => {
  it('유효 정의가 참조하는 컬럼이 전부 실존한다', () => {
    const violations: string[] = [];
    for (const [name, { file, code }] of FNS) {
      for (const col of pveRunsWriteTargets(code)) {
        if (!LIVE_COLS.has(col)) violations.push(`${file}: ${name}() → pve_runs.${col}`);
      }
    }
    expect(
      violations,
      '드롭된 pve_runs 컬럼에 쓰는 함수가 있다 — 런타임 42703 으로 그 RPC 가 통째로 실패한다',
    ).toEqual([]);
  });

  it('settle_pve_run 이 실제로 pve_runs 에 쓴다(빈 구현 방어)', () => {
    // 부재 단언만 두면 INSERT 를 통째로 지운 본문도 통과한다.
    const settle = FNS.get('settle_pve_run');
    expect(settle, 'settle_pve_run 정의를 찾지 못했다').toBeDefined();
    expect(pveRunsWriteTargets(settle!.code).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. 유효 정의 = 복구본이고, 복구본이 두 배율 축을 **둘 다** 갖는다
// ---------------------------------------------------------------------------

describe('settle_pve_run 유효 정의', () => {
  const settle = () => {
    const s = FNS.get('settle_pve_run');
    expect(s).toBeDefined();
    return s!;
  };

  it('마지막 정의는 복구본(20260802000000)이다', () => {
    expect(settle().file).toBe('20260802000000_settle_pve_run_column_restore.sql');
  });

  it('행성 인기 배율 축(ADR-0038)이 살아 있다', () => {
    const code = settle().code;
    expect(code).toContain('public.planet_popularity');
    expect(code).toContain("'planetMultCenti'");
    // 현재/직전 epoch 만 인정 — 오래된 고배율 스냅샷 재사용 차단.
    expect(code).toMatch(/v_epoch\s*>=\s*v_cur_epoch\s*-\s*1/);
  });

  it('촉매 영수증 축(runId → catalyst_receipt)이 살아 있다', () => {
    const code = settle().code;
    // 20260727010000 이 이 축을 통째로 잃은 것이 이번 사고의 조용한 절반이다.
    expect(code, 'runId 영수증 조회가 없다 — 촉매를 소모하고도 배율을 못 받는다').toContain(
      "catalyst_receipt->>'resourceMult'",
    );
    expect(code, 'pending 조회 잠금이 없다').toMatch(/verified_status = 'pending'[\s\S]*?for update/);
    // pending 을 verified 로 봉인하지 않으면 그 행이 영원히 pending 으로 남는다.
    expect(code).toMatch(/update public\.pve_runs[\s\S]*?verified_status\s*=\s*'verified'/);
  });

  it('클라 제출 resourceMult 를 제거하고 app.in_settle 로만 배율을 연다', () => {
    const code = settle().code;
    expect(code, '클라 위조 배율 제거가 없다').toContain("p_summary - 'resourceMult'");
    // grant_currency 는 이 플래그가 있을 때만 resourceMult 를 읽는다. 빠지면 배율이 조용히 죽는다.
    expect(code).toContain("set_config('app.in_settle', '1', true)");
    expect(code).toContain("set_config('app.in_settle', '', true)");
  });

  it('summary 에는 캡 산정용 파생(v_metrics)이 아니라 원본 p_summary 를 저장한다', () => {
    // 파생을 저장하면 refresh_planet_popularity 집계 입력이 오염된다.
    const code = settle().code;
    expect(code).not.toMatch(/summary\s*=\s*v_metrics/);
    expect(code).not.toMatch(/summary[\s\S]{0,40}values[\s\S]{0,80}v_metrics/);
    expect(code).toMatch(/summary\s*=\s*p_summary/);
  });
});
