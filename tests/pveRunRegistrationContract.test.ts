/**
 * PvE 런 시작 등록 + 축 D 캡 계약 대조 (ADR-0050 §3 단계 1·2 ·
 * `supabase/migrations/20260808000000_pve_run_registration.sql`).
 *
 * 이 계약이 지키는 것은 다섯이고, **다섯 다 깨져도 런타임에는 조용하다**:
 *   ① 캡의 존재 — 없어도 게임은 정상 동작한다(무제한 런이 "잘 되는" 것으로 보인다)
 *   ② ⭐ **캡의 분모가 서버 것** — `started_at`(서버가 찍음) + `now()`(벽시계).
 *      분모가 클라 주장으로 바뀌면 캡은 **장식**이 된다. ADR-0050 §3 단계 2 의 유일한 원리다.
 *      실제로 `settle_pve_run` 의 개연성 캡 ①항이 정확히 이 방식으로 장식이 되어 있다
 *      (분모 `finalTick` 이 `p_summary` 에서 온다 — 20260802000000:88-90).
 *   ③ `started_at` 봉인 — 클라가 심을 수 있으면 과거 시각으로 1시간 창을 빠져나가 캡이 스스로 열린다
 *   ④ 분모가 **정산 요약 행을 배제** — `settle_pve_run` 도 pve_runs 에 insert 하므로
 *      (20260726000200:297) `started_at is not null` 이 빠지면 런 1회가 2로 세어져 캡이 실질 반토막
 *   ⑤ `settle_pve_run` **불가침** — 이 리포는 그 계열 재정의 복제로 PvE 정산을 100% 깨뜨린
 *      전례가 있다(20260802000000:4-15). 이 레인이 그것을 건드리지 않았음을 기계로 고정한다.
 *
 * ⚠️ 단언은 `body` 가 아니라 **`code`(줄 주석 제거본)** 로 한다 — 이 리포의 SQL 은 규약을 길게
 * 주석으로 적어 두고 그 주석에 계약 문자열이 그대로 들어 있다(catalystGrantCapContract 와 같은 함정).
 *
 * ⚠️ 부재 단언(`not.toContain`)만으로는 빈 구현을 못 막는다 — 양성 단언을 항상 함께 둔다.
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

/** `--` 줄 주석 제거. 규약을 적어 둔 주석이 계약 문자열을 그대로 담아 파서를 오염시킨다. */
function stripLineComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

/** 적용 순(파일명 오름차순) 기준 **마지막** 정의 본문 = 실제로 사는 정의. */
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

/** DECLARE 의 `NAME constant <타입> := <식>;` 우변. */
function constantOf(code: string, name: string): string {
  const m = code.match(new RegExp(`${name}\\s+constant\\s+\\w+\\s*:=\\s*([^;]+);`));
  if (m === null || m[1] === undefined) throw new Error(`${name} 상수를 찾지 못했습니다`);
  return m[1].trim();
}

describe('begin_pve_run — 런 시작 등록', () => {
  it('① 축 D 캡이 존재하고, 20260801000000 이 가정하던 60 과 같다', () => {
    const { code } = effectiveFunctionBody('begin_pve_run');
    // 촉매 시간당 상한 360 이 `PLAUSIBLE_RUNS_PER_HOUR := 60` 위에 서 있는데 그동안 강제가
    // 없었다. 두 값이 갈리면 촉매 캡의 근거가 조용히 무너지므로 여기서 함께 고정한다.
    expect(constantOf(code, 'CAP_RUNS_PER_HOUR')).toBe('60');
    expect(code).toContain('v_count >= CAP_RUNS_PER_HOUR');
    expect(code).toContain("'throttled', true");
  });

  it('② ⭐ 캡의 분모가 서버 것이다 — started_at + now(), 클라 입력이 안 들어간다', () => {
    const { code } = effectiveFunctionBody('begin_pve_run');
    const counted = code.slice(code.indexOf('select count(*)'), code.indexOf('if v_count >='));
    expect(counted).toContain('public.pve_runs');
    expect(counted).toContain('profile_id = v_me');
    expect(counted).toContain("started_at > now() - interval '1 hour'");
    // 분모에 함수 인자(= 클라가 주는 값)가 한 조각도 섞이면 안 된다. 섞이는 순간 캡은 장식이다.
    expect(counted).not.toContain('p_planet');
    expect(counted).not.toContain('p_summary');
    // 수령자는 auth.uid() 로 고정 — 파라미터로 받으면 남의 창을 소진시킬 수 있다.
    expect(code).toContain('auth.uid()');
    expect(code).toContain('security definer');
  });

  it('④ 분모가 정산 요약 행을 배제한다 (settle 도 pve_runs 에 insert 하므로)', () => {
    const { code } = effectiveFunctionBody('begin_pve_run');
    const counted = code.slice(code.indexOf('select count(*)'), code.indexOf('if v_count >='));
    // 이 한 줄이 빠지면 런 1회가 2행으로 세어져 60 캡이 실질 30 이 된다.
    expect(counted).toContain('started_at is not null');
  });

  it('시작 등록 행에 서버가 started_at 을 찍는다 (분모의 원천)', () => {
    const { code } = effectiveFunctionBody('begin_pve_run');
    const ins = code.slice(code.indexOf('insert into public.pve_runs'));
    expect(ins).toContain('started_at');
    expect(ins).toContain('now()');
  });
});

describe('started_at 봉인 — 클라가 캡의 분모를 만지지 못한다', () => {
  it('③ guard_pve_runs_client_insert 가 클라 컨텍스트에서 started_at 을 null 강제한다', () => {
    const { code } = effectiveFunctionBody('guard_pve_runs_client_insert');
    expect(code).toContain('is_service_role()');
    expect(code).toMatch(/new\.started_at\s*:=\s*null/);
    // 종전 봉인이 함께 살아 있어야 한다 — 재정의가 이전 축을 떨어뜨리는 것이 이 리포의 상습 결함이다.
    expect(code).toMatch(/new\.verified_status\s*:=\s*'pending'/);
    expect(code).toMatch(/new\.catalyst_receipt\s*:=\s*null/);
    expect(code).toMatch(/new\.verified_result\s*:=\s*null/);
    expect(code).toMatch(/new\.verified_at\s*:=\s*null/);
  });

  it('부분 인덱스가 캡 조회 축을 덮는다', () => {
    const sql = migrationsInOrder()
      .map((m) => m.sql)
      .join('\n');
    expect(sql).toContain('pve_runs_started_idx');
    expect(stripLineComments(sql)).toContain('where started_at is not null');
  });
});

describe('⑤ settle_pve_run 불가침', () => {
  it('이 레인이 settle_pve_run 을 재정의하지 않았다', () => {
    // 마지막 정의가 이 레인의 파일이면 안 된다. 5회 재정의된 함수이고 그 복제가 이미 PvE
    // 정산을 100% 깨뜨렸다(20260802000000:4-15).
    const { file } = effectiveFunctionBody('settle_pve_run');
    expect(file).toBe('20260802000000_settle_pve_run_column_restore.sql');
  });

  it('이 레인의 마이그레이션은 settle_pve_run 을 정의하지 않는다', () => {
    const mine = migrationsInOrder().find(
      (m) => m.file === '20260808000000_pve_run_registration.sql',
    );
    expect(mine, '이 레인의 마이그레이션을 찾지 못함').toBeDefined();
    expect(stripLineComments(mine!.sql)).not.toContain(
      'create or replace function public.settle_pve_run',
    );
  });
});
