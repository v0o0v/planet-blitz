/**
 * 의뢰서 원장 계약 대조 (`.omc/plans/commission-server-contract.md` rev3 ·
 * `supabase/migrations/20260803000000_commission_ledger.sql`).
 *
 * 이 계약이 지키는 것들은 **전부 런타임에 조용하다** — 깨져도 게임은 정상으로 보인다:
 *   ① 트리거 서브트랜잭션 — 없으면 발령 예외가 PvE 정산 전체를 롤백해 전 플레이어가 자원을
 *      못 받는데 **화면은 조용하다**(PR#222 형상).
 *   ② 컬럼 GRANT — 없으면 loadout_sealed·replay_gz 가 기저 직접 조회로 샌다. 뷰는 멀쩡하다.
 *   ③ cron ① 단일 CTE — insert→update 순서면 의뢰서가 1장에서 2장이 된다.
 *   ④ allowlist — 없으면 인증 사용자가 임의 source 로 시간당 50,000 을 런 없이 받는다.
 *   ⑤ 쿨다운 누적기 — `now() + …` 로 되돌리면 긴/짧은 주장을 번갈아 파이프라이닝할 수 있다.
 *
 * ⚠️ **단언은 `code`(줄 주석 제거본)로 한다.** 이 리포의 SQL 은 본문 안에 규약을 길게 주석으로
 *    적어 두고, 그 주석에 계약 문자열이 그대로 들어 있다(catalystShopContract 가 밟은 함정).
 *
 * ⚠️ **부재 단언(`not.toContain`)만으로는 빈 구현을 못 막는다** — 양성 단언을 항상 함께 둔다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const COMMISSION_FILE = '20260803000000_commission_ledger.sql';

function migrationsInOrder(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, sql: new TextDecoder().decode(readFileSync(MIGRATIONS_DIR + f)) }));
}

/** `--` 줄 주석 제거. 규약을 적어 둔 주석이 계약 문자열을 그대로 담고 있어 파서를 오염시킨다. */
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

function commissionSql(): string {
  const hit = migrationsInOrder().find((m) => m.file === COMMISSION_FILE);
  if (hit === undefined) throw new Error(`${COMMISSION_FILE} 가 없습니다`);
  return hit.sql;
}

function commissionCode(): string {
  return stripLineComments(commissionSql());
}

/**
 * 정규식 캡처 그룹을 **문자열로 확정해서** 돌려준다.
 *
 * `noUncheckedIndexedAccess` 아래에서 `m[1]` 은 `string | undefined` 다. `!` 로 눌러 두면 타입만
 * 조용해지고 그룹이 안 잡힌 경우 `undefined` 가 흘러 **컬럼 목록 비교가 빈 값끼리 같다고 말하며
 * 통과**한다 — 이 파일이 지키려는 바로 그 유출을 못 보게 되는 형태다. 여기서 던진다.
 */
function cap(m: RegExpMatchArray | RegExpExecArray | null, i: number, what: string): string {
  const v = m?.[i];
  if (typeof v !== 'string') throw new Error(`${what}: 캡처 그룹 ${i} 를 읽지 못했다`);
  return v;
}

/** cron.schedule('<name>', '<sched>', $$ <body> $$) 를 뽑는다. */
function cronJob(name: string): { schedule: string; body: string } {
  const code = commissionCode();
  const at = code.indexOf(`'${name}'`);
  expect(at, `cron 잡 ${name} 을 찾지 못함`).toBeGreaterThan(0);
  const tail = code.slice(at);
  const sched = /'(\S+ \S+ \S+ \S+ \S+)'/.exec(tail);
  const body = /\$\$([\s\S]*?)\$\$/.exec(tail);
  expect(sched, `${name}: 스케줄을 못 읽음`).not.toBeNull();
  expect(body, `${name}: 본문을 못 읽음`).not.toBeNull();
  return { schedule: cap(sched, 1, `cron ${name} 스케줄`), body: cap(body, 1, `cron ${name} 본문`) };
}

describe('의뢰서 원장 — 마이그레이션 정렬 계약 (AC-G3)', () => {
  /**
   * ⚠️ **2026-08-03 정정**: 이 단언은 원래 "원장이 정렬 후 **마지막**"이었다. 그 형태는 원장이
   * 최신인 동안만 참이고, 원장 **뒤에** 의뢰 축을 잇는 마이그레이션이 붙는 순간(폐기 RPC)
   * 정상 변경에 빨간불을 낸다 — 실제로 그랬다.
   *
   * 이 계약이 지키려던 것은 "마지막"이 아니라 **의존 순서**다: 원장은 자기가 고쳐 쓰는
   * `grant_currency`(20260727000000)와 `settle_pve_run`(20260802000000) **뒤에** 와야 하고,
   * 원장이 만드는 테이블을 쓰는 마이그레이션은 원장 **뒤에** 와야 한다. 위치가 아니라 그
   * 순서를 잰다.
   */
  it('원장이 자기가 의존하는 마이그레이션들보다 뒤에 온다', () => {
    const files = migrationsInOrder().map((m) => m.file);
    const idx = files.indexOf(COMMISSION_FILE);
    expect(idx, `${COMMISSION_FILE} 가 목록에 없다`).toBeGreaterThanOrEqual(0);
    for (const dep of [
      '20260726000000_currency_server_authority.sql',
      '20260802000000_settle_pve_run_column_restore.sql',
    ]) {
      const at = files.indexOf(dep);
      expect(at, `의존 마이그레이션 ${dep} 이 없다`).toBeGreaterThanOrEqual(0);
      expect(idx, `원장이 ${dep} 보다 먼저 적용된다`).toBeGreaterThan(at);
    }
  });

  it('원장 테이블을 쓰는 후속 마이그레이션은 원장 뒤에 온다', () => {
    // 파일명 오름차순 = 적용 순이므로, 원장 앞에서 `commission_*` 를 건드리면 없는 테이블을
    // 참조한다(적용이 그 자리에서 실패한다 — 조용하지 않지만 원격에서만 터진다).
    const all = migrationsInOrder();
    const idx = all.findIndex((m) => m.file === COMMISSION_FILE);
    for (let i = 0; i < idx; i++) {
      const m = all[i];
      if (m === undefined) continue;
      expect(
        /public\.commission_(inventory|runs|issues|grants|discards)/.test(stripLineComments(m.sql)),
        `${m.file} 이 원장 테이블을 원장보다 먼저 참조한다`,
      ).toBe(false);
    }
  });
});

describe('의뢰서 원장 — 발령 경로 (AC-I3 · AC-I5 · AC-I6 · AC-I9)', () => {
  it('settle_pve_run 을 재정의하지 않는다', () => {
    // 이 리포에서 가장 위험한 편집. 5회 재정의됐고 그 복제가 PvE 정산을 100% 깨뜨렸다.
    expect(commissionCode()).not.toContain('create or replace function public.settle_pve_run');
    // 양성 단언: 대신 트리거로 붙였는가.
    expect(commissionCode()).toContain('create trigger pve_runs_issue_commission');
  });

  it('발령 함수 본문이 서브트랜잭션으로 감싸여 있다 (AC-I5)', () => {
    const { code } = effectiveFunctionBody('issue_commission_for_run');
    expect(code).toContain('exception when others then');
    expect(code).toContain('raise warning');
    // ⚠️ 이 단언이 통과하면서도 참일 수 있는 나쁜 상태: `exception` 블록이 **본문 일부만** 감싸
    // 앵커 INSERT 가 밖에 있는 경우. 그래서 `begin` 이 선언부 직후 첫 문장보다 앞인지도 본다.
    const beginAt = code.indexOf('begin');
    const insertAt = code.indexOf('insert into public.commission_issues');
    const excAt = code.indexOf('exception when others');
    expect(beginAt).toBeLessThan(insertAt);
    expect(insertAt).toBeLessThan(excAt);
  });

  it('1회성 앵커가 on conflict do nothing 으로 구조 보장된다 (AC-I3)', () => {
    const { code } = effectiveFunctionBody('issue_commission_for_run');
    expect(code).toContain('on conflict (pve_run_id) do nothing');
    expect(code).toContain('get diagnostics');
    // 뮤테이션: 이 줄을 지우면 같은 pve_runs.id 로 두 번 발령된다.
  });

  it('빈도 상한이 claimed_victory 인 행만 센다 (AC-I8)', () => {
    const { code } = effectiveFunctionBody('issue_commission_for_run');
    const at = code.indexOf('count(*) into v_cnt');
    expect(at).toBeGreaterThan(0);
    const window = code.slice(at, at + 400);
    expect(window).toContain('claimed_victory');
    // 뮤테이션: `and claimed_victory` 를 지우면 패배 정산이 슬롯을 먹어 **정직한 빠른 재시작
    // 플레이어의 의뢰서가 끊기고** 위조 victory:true 는 상한을 그대로 받는다.
  });

  it('자격에 틱 하한이 있고 쿨다운이 누적기다 (AC-I9 · AC-I10)', () => {
    const { code } = effectiveFunctionBody('issue_commission_for_run');
    expect(code).toContain('MIN_BOSS_KILL_TICKS');
    expect(code).toMatch(/v_ft\s*<\s*MIN_BOSS_KILL_TICKS/);
    // 누적기: greatest(now(), 지평) 이어야 한다. `now() + …` 이면 직전 행 기준과 동치가 되어
    // 긴 주장과 짧은 주장을 번갈아 파이프라이닝할 수 있다.
    expect(code).toContain('greatest(now(), v_horizon)');
    expect(code).toContain('max(next_eligible_at)');
    // ⚠️ 통과하면서도 참일 수 있는 나쁜 상태: 지평 전진이 **미발령 경로에서도** 일어나는 것.
    // 전진 update 가 granted = true 와 같은 문장에 있는지로 잰다.
    const bump = code.indexOf('next_eligible_at = greatest');
    const granted = code.indexOf('granted = true');
    expect(granted).toBeGreaterThan(0);
    expect(Math.abs(bump - granted)).toBeLessThan(300);
  });

  it('issue_commission_for_run 이 어떤 role 에도 EXECUTE 가 없다 (AC-I6)', () => {
    const code = commissionCode();
    for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
      expect(code).toContain(
        `revoke all on function public.issue_commission_for_run(uuid, uuid, jsonb) from ${role}`,
      );
    }
    // 양성 단언과 짝: grant 가 **하나도** 없어야 한다.
    expect(code).not.toMatch(/grant execute on function public\.issue_commission_for_run/);
  });
});

describe('의뢰서 원장 — 재화 관문 (AC-C1 · AC-C2 · AC-C3 · AC-C7 · AC-C8)', () => {
  it('grant_currency 가 allowlist(default-deny) 다 (AC-C2)', () => {
    const { code } = effectiveFunctionBody('grant_currency');
    expect(code).toContain("not in ('pve_run', 'salvage', 'story')");
    // 뮤테이션: `= 'commission'`(blocklist)으로 되돌리면 임의 문자열이 통과해
    // CAP_DEFAULT_*(1,000) 창구가 다시 열린다.
    expect(code).not.toMatch(/p_source\s*=\s*'commission'/);
    // 양성: 위임이 실제로 일어나는가(빈 구현 방지).
    expect(code).toContain('public.grant_currency_for(');
  });

  it('grant_currency_for 가 authenticated 에서 revoke 돼 있다 (AC-C3)', () => {
    const code = commissionCode();
    const sig = 'public.grant_currency_for(uuid, numeric, numeric, text, jsonb)';
    // ⚠️ Postgres 는 함수 생성 시 PUBLIC 에 EXECUTE 를 **자동 부여**한다. public 회수가 빠지면
    // authenticated 가 PUBLIC 을 통해 도달해 위임 구조 전체가 무효다.
    expect(code).toContain(`revoke all on function ${sig} from public`);
    expect(code).toContain(`revoke all on function ${sig} from authenticated`);
    expect(code).toContain(`grant execute on function ${sig} to service_role`);
  });

  it('commission 캡 분기가 존재한다 (AC-C1)', () => {
    const { code } = effectiveFunctionBody('grant_currency_for');
    expect(code).toContain("when 'commission' then");
    expect(code).toContain('CAP_COMMISSION_CREDITS');
    // 분기가 없으면 최종 지시의 확정 보상이 else 로 떨어져 조용히 1,000 으로 클램프된다.
  });

  it('grant_currency_for 가 원장을 우회하지 않는다 (AC-C4)', () => {
    const { code } = effectiveFunctionBody('grant_currency_for');
    expect(code).toContain('insert into public.currency_grants');
    // apply_invasion_result 선례를 복제했다면 이 단언이 실패한다 — 그것은 원장을 우회한다.
  });

  it('settle_commission 이 app.in_settle 도 planet_popularity 도 건드리지 않는다 (AC-C7·C8)', () => {
    const { code } = effectiveFunctionBody('settle_commission');
    expect(code).not.toContain('app.in_settle');
    expect(code).not.toContain('planet_popularity');
    // 부재 단언 짝: 지급이 실제로 일어나는가.
    expect(code).toContain('public.grant_currency_for(');
  });

  it('settle_commission 의 잠금 순서가 commission_runs → profiles 다', () => {
    const { code } = effectiveFunctionBody('settle_commission');
    const runs = code.indexOf('from public.commission_runs where run_id = p_run_id for update');
    const grant = code.indexOf('public.grant_currency_for(');
    expect(runs).toBeGreaterThan(0);
    expect(runs).toBeLessThan(grant); // profiles 잠금은 grant_currency_for 안에서 일어난다.
  });
});

describe('의뢰서 원장 — RLS·권한 (AC-R2 · AC-R8)', () => {
  it('commission_runs 의 컬럼 GRANT 목록이 뷰 select 목록과 정확히 같다 (AC-R8)', () => {
    const code = commissionCode();
    const grantM = /grant\s+select\s*\(([\s\S]*?)\)\s*\n?\s*on public\.commission_runs/.exec(code);
    expect(grantM, 'commission_runs 컬럼 GRANT 를 못 찾음').not.toBeNull();
    const viewM = /create or replace view public\.commission_runs_public[\s\S]*?as\s*\n\s*select([\s\S]*?)from public\.commission_runs/.exec(
      code,
    );
    expect(viewM, '뷰 정의를 못 찾음').not.toBeNull();

    const norm = (s: string) =>
      s
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .sort();

    const granted = norm(cap(grantM, 1, 'commission_runs 컬럼 GRANT 목록'));
    const viewed = norm(cap(viewM, 1, 'commission_runs_public 뷰 select 목록'));

    // **열거가 아니라 집합 일치로 잰다** — 컬럼이 새로 생겨도 걸린다.
    expect(granted).toEqual(viewed);
    // 빈 목록끼리도 "같다"가 되므로 비어 있지 않음을 함께 못 박는다 — 정규식이 헛돌면
    // 위 등식만으로는 유출 상태에서 통과한다.
    expect(granted.length).toBeGreaterThan(0);
    // 그리고 두 목록 어디에도 이 둘이 없어야 한다.
    expect(granted).not.toContain('loadout_sealed');
    expect(granted).not.toContain('replay_gz');
  });

  it('기저 테이블의 기본 컬럼 부여를 회수한다 (AC-R8 뮤테이션 대상)', () => {
    // 이 한 줄이 없으면 정책만으로는 컬럼이 전부 열린다(Supabase 기본 부여). 원격에서 그 기본
    // 부여가 실재함을 확인했다.
    expect(commissionCode()).toContain('revoke select on public.commission_runs from authenticated');
  });

  it('뷰가 security_invoker 다 (AC-R7)', () => {
    // 빼면 정의자 권한 뷰가 기저 RLS 를 우회해 fail-open 으로 되돌아간다.
    expect(commissionCode()).toContain('security_invoker = true');
    expect(commissionCode()).toContain('security_barrier = true');
  });

  it('commission_issues 는 RLS enable + 정책 0개다 (AC-R5)', () => {
    const code = commissionCode();
    expect(code).toContain('alter table public.commission_issues enable row level security');
    expect(code).not.toMatch(/create policy \w+\s+on public\.commission_issues/);
  });

  it('쓰기 정책이 어느 신규 테이블에도 없다 (AC-R4)', () => {
    const code = commissionCode();
    // ⚠️ 파일 전체에서 'for update' 를 찾으면 **행 잠금**(`select … for update`)이 걸린다.
    //    정책 선언 블록으로 범위를 좁혀야 정책 축만 잰다.
    const policies = [...code.matchAll(/create policy[\s\S]*?;/g)].map((m) => m[0]);
    expect(policies.length, '정책이 하나도 없다 — 빈 구현 방지').toBeGreaterThan(0);
    for (const p of policies) {
      for (const verb of ['for insert', 'for update', 'for delete', 'for all']) {
        expect(p, `쓰기 정책 발견: ${p.slice(0, 80)}`).not.toContain(verb);
      }
      expect(p).toContain('for select');
    }
  });
});

describe('의뢰서 원장 — 상태 기계·cron (AC-S4b · AC-S5 · AC-S9)', () => {
  it('cron ① 이 update…returning 을 구동자로 삼는 단일 CTE 다 (AC-S4b)', () => {
    const { body } = cronJob('planet-blitz-recover-commission-issued');
    // 구동자가 update 여야 한다. insert 가 먼저 오면 "1장이 2장" 창이 열린다.
    expect(body.indexOf('with moved as')).toBeGreaterThanOrEqual(0);
    expect(body.indexOf('update public.commission_runs')).toBeLessThan(
      body.indexOf('insert into public.commission_inventory'),
    );
    expect(body).toContain('returning');
    expect(body).toContain('on conflict (commission_id) do nothing');
  });

  it('cron ③ 이 verified_at 을 세운다 — ②로 넘기는 배턴 (AC-S5)', () => {
    const { body } = cronJob('planet-blitz-abandon-commission-active');
    expect(body).toContain("status = 'abandoned'");
    expect(body).toContain('verified_at = now()');
    // 안 세우면 abandoned 행의 blob 을 cron ②가 영영 못 치운다.
    // 그리고 **의뢰서를 돌려주지 않는다** — active 는 런이 시작됐다는 뜻이다.
    expect(body).not.toContain('commission_inventory');
  });

  it('cron ② 술어가 replay_gz 기준이다', () => {
    const { body } = cronJob('planet-blitz-gc-commission-replays');
    expect(body).toContain('replay_gz is not null');
    // 침공판을 복제해 존재하지 않는 replay·client_result 컬럼을 대상으로 삼으면
    // 술어가 영원히 거짓이 되어 아무 일도 하지 않는다.
    expect(body).not.toContain('client_result');
  });

  it('cron 본문이 전부 public. 으로 수식돼 있다', () => {
    // pg_cron 은 스케줄 롤의 search_path 로 돌아 `set search_path=''` 규율 밖이다.
    for (const job of [
      'planet-blitz-recover-commission-issued',
      'planet-blitz-gc-commission-replays',
      'planet-blitz-abandon-commission-active',
      'planet-blitz-gc-commission-issues',
    ]) {
      const { body } = cronJob(job);
      // CTE 이름은 스키마 수식 대상이 아니다. **선언된 것만** 면제한다 — 문자열을 화이트리스트로
      // 박으면 오타난 진짜 비수식 테이블까지 함께 통과한다.
      const ctes = new Set([...body.matchAll(/(?:with|,)\s+(\w+)\s+as\s*\(/g)].map((m) => m[1]));
      for (const m of body.matchAll(/(?:from|into|update|join)\s+(\w+)/g)) {
        if (ctes.has(m[1])) continue;
        expect(m[1], `${job}: 비수식 테이블 ${m[1]}`).toBe('public');
      }
    }
  });

  it('commission_grants 가 어떤 cron 술어에도 등장하지 않는다 (AC-R6)', () => {
    // 지우면 발급 사실이 사라져 EF 게이트 4 가 정직한 플레이어를 거부한다.
    for (const { sql } of migrationsInOrder()) {
      for (const m of sql.matchAll(/cron\.schedule\([\s\S]*?\$\$([\s\S]*?)\$\$/g)) {
        expect(m[1]).not.toContain('commission_grants');
      }
    }
  });

  it('나이 검사가 판정 지점(RPC)에 직접 박혀 있다 (AC-S9)', () => {
    const { code } = effectiveFunctionBody('settle_commission');
    expect(code).toContain('ACTIVE_TTL');
    expect(code).toMatch(/started_at\s+is\s+null\s+or\s+v_run\.started_at\s*<=\s*now\(\)\s*-\s*ACTIVE_TTL/);
    // cron 에만 두면 매시 정각 사이에 최대 1시간의 제출 창이 샌다.
  });

  it('mark_commission_active 가 no-op 이 아니라 명시 거부한다 (AC-S1)', () => {
    const { code } = effectiveFunctionBody('mark_commission_active');
    expect(code).toContain('전이 불가 상태');
    expect(code).toContain('전이 시한 초과');
    expect(code).toMatch(/raise exception/);
  });
});

describe('의뢰서 원장 — 만들지 않은 것 (AC-S7 · AC-S8)', () => {
  it('restore_commission 과 grant_commission 이 존재하지 않는다', () => {
    const all = migrationsInOrder()
      .map((m) => m.sql)
      .join('\n');
    expect(all).not.toContain('function public.restore_commission');
    expect(all).not.toContain('function public.grant_commission');
    // 존재하지 않는 함수는 권한 실수로 노출될 수 없다.
  });
});
