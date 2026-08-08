/**
 * 설계도 지급 빈도 캡 — SQL ↔ TS 미러 대조 + 캡 구조 계약
 * (`20260808080000_blueprint_grant_cap.sql`).
 *
 * ## 이 파일의 존재 이유
 * 같은 수치가 두 곳(SQL 본문 · `src/net/blueprintServerConstants.ts`)에 산다. 이 리포의
 * 지배적 실패 모드가 "한쪽만 고쳐서 조용히 어긋나는" 것이고, 어긋나도 런타임에는 아무 신호가
 * 없다 — 서버는 자기 값으로 거절하고 클라는 캡을 아예 예측하지 않는다.
 *
 * ## ⚠️ 값 대조만으로는 부족하다 — **구조**를 잰다
 * 이 캡은 값이 맞아도 다음 넷 중 하나가 어긋나면 무력화된다. 값 대조로는 전부 안 잡힌다:
 *   ① 분자가 **총 장수**가 아니라 호출 수 → 호출 1회에 32장을 실어 32배로 뚫린다
 *   ② 프로필 행 **잠금 부재** → 병렬 호출 N개가 각자 "여유 있음"을 읽어 N배로 뚫린다
 *   ③ 캡 판정이 **지급 뒤** → 부분 지급이 생기고 캡이 사후 통보가 된다
 *   ④ 원장 기록이 **다른 트랜잭션** → 앱이 그 사이 죽으면 지급은 남고 분모가 비어 캡이 열린다
 *
 * ## ⚠️ 영단어로 grep 하지 마라
 * 이 리포는 전면 한글 주석이다. 촉매 스크립트가 `'%duplicate%'` 로 게이트를 찾다가 멀쩡한
 * 게이트에 매번 `[FAIL]` 을 냈다(주석이 "중복 거부"라 영단어가 등장할 수 없었다).
 * 아래 단언은 전부 **SQL 식별자·리터럴**만 본다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CAP_BLUEPRINTS_PER_HOUR,
  CAP_BLUEPRINTS_PER_DAY,
} from '../src/net/blueprintServerConstants.js';
import { BLUEPRINT_RUN_CHANCE_CP } from '../src/sim/drops.js';

const MIGRATION = fileURLToPath(
  new URL('../supabase/migrations/20260808080000_blueprint_grant_cap.sql', import.meta.url),
);

function sql(): string {
  return new TextDecoder().decode(readFileSync(MIGRATION));
}

function stripLineComments(s: string): string {
  return s.replace(/--[^\n]*/g, '');
}

/** `NAME constant <type> := <값>;` 의 우변 숫자를 읽는다(주석 제거본 기준). */
function sqlConstant(name: string): number {
  const code = stripLineComments(sql());
  const m = new RegExp(`${name}\\s+constant\\s+[\\w ]+:=\\s*([0-9.]+)`).exec(code);
  expect(m, `SQL 상수 ${name} 을 찾지 못함`).not.toBeNull();
  return Number(m![1]);
}

/** `grant_blueprints` 본문만 잘라 준다(다른 정의의 문장이 섞이면 순서 단언이 무의미해진다). */
function grantBody(): string {
  const code = stripLineComments(sql());
  const at = code.indexOf('create or replace function public.grant_blueprints(');
  expect(at, 'grant_blueprints 정의를 찾지 못함').toBeGreaterThan(0);
  const end = code.indexOf('\n$$;', at);
  expect(end, '본문 종결자를 찾지 못함').toBeGreaterThan(at);
  return code.slice(at, end);
}

describe('설계도 캡 — SQL ↔ TS 미러', () => {
  it('CAP_BLUEPRINTS_PER_HOUR 가 일치한다', () => {
    expect(sqlConstant('CAP_BLUEPRINTS_PER_HOUR')).toBe(CAP_BLUEPRINTS_PER_HOUR);
  });

  it('CAP_BLUEPRINTS_PER_DAY 가 일치한다', () => {
    expect(sqlConstant('CAP_BLUEPRINTS_PER_DAY')).toBe(CAP_BLUEPRINTS_PER_DAY);
  });

  it('하루 캡이 시간 캡보다 크고, 24배보다는 작다', () => {
    // 크지 않으면 하루 축이 무의미하고, 24배 이상이면 하루 축이 구속하지 못한다
    // (= 시간 캡만 두었을 때와 같아진다 — 이 캡이 생긴 이유가 사라진다).
    expect(CAP_BLUEPRINTS_PER_DAY).toBeGreaterThan(CAP_BLUEPRINTS_PER_HOUR);
    expect(CAP_BLUEPRINTS_PER_DAY).toBeLessThan(CAP_BLUEPRINTS_PER_HOUR * 24);
  });
});

describe('설계도 캡 — 정직한 플레이를 벌하지 않는다', () => {
  /**
   * 축 D 의 시간당 런 상한. `20260808000000_pve_run_registration.sql` 의 `CAP_RUNS_PER_HOUR`
   * 를 **파일에서 읽는다** — 여기 60 을 하드코딩하면 그 축이 바뀔 때 이 유도가 조용히 낡는다.
   */
  function capRunsPerHour(): number {
    const file = fileURLToPath(
      new URL('../supabase/migrations/20260808000000_pve_run_registration.sql', import.meta.url),
    );
    const code = stripLineComments(new TextDecoder().decode(readFileSync(file)));
    const m = /CAP_RUNS_PER_HOUR\s+constant\s+[\w ]+:=\s*([0-9]+)/.exec(code);
    expect(m, 'CAP_RUNS_PER_HOUR 를 찾지 못함').not.toBeNull();
    return Number(m![1]);
  }

  it('시간 캡이 정직한 기대치의 5배 이상이다', () => {
    // 기대 = 축 D 런 상한 x 클리어당 설계도 확률. 캡이 이 기대치에 가까우면 운 좋은
    // 정직한 플레이어가 캡에 닿아 조용히 설계도를 잃는다(RPC 가 fire-and-forget 이라 무증상).
    const expected = capRunsPerHour() * (BLUEPRINT_RUN_CHANCE_CP / 10000);
    expect(expected).toBeGreaterThan(0);
    expect(CAP_BLUEPRINTS_PER_HOUR / expected).toBeGreaterThan(5);
  });

  it('확률을 크게 올리면 이 유도가 깨지는 것을 자각한다', () => {
    // 뮤테이션 감지용: BLUEPRINT_RUN_CHANCE_CP 를 올리면 기대치가 캡에 접근한다.
    // 확률 축을 다시 만지는 레인은 이 캡도 함께 올려야 한다 — 그 사실을 여기 못 박는다.
    const atTenPercent = capRunsPerHour() * 0.1;
    expect(
      CAP_BLUEPRINTS_PER_HOUR / atTenPercent,
      '확률이 10% 가 되면 시간 캡 여유가 5배 아래로 떨어진다 — 캡을 함께 올려라',
    ).toBeLessThan(5);
  });
});

describe('설계도 캡 — 구조 계약 (값이 맞아도 이게 어긋나면 무력하다)', () => {
  it('분자가 총 장수다 — sum(granted), count(*) 아님', () => {
    // ①: 호출 수를 세면 호출 1회에 32장(행 8 x 장수 4)을 실어 32배로 뚫린다.
    const body = grantBody();
    expect(body).toContain('coalesce(sum(granted), 0)');
    expect(body).not.toMatch(/count\(\*\)[\s\S]*blueprint_grant_log/);
    // 그리고 요청 합계(v_total)를 캡 비교에 실제로 더한다 — 안 더하면 캡 경계에서 1회 초과한다.
    expect(body).toContain('v_hour + v_total > CAP_BLUEPRINTS_PER_HOUR');
    expect(body).toContain('v_day + v_total > CAP_BLUEPRINTS_PER_DAY');
  });

  it('프로필 행을 잠근다 — 병렬 호출이 캡을 함께 통과하지 못한다', () => {
    // ②: 잠금이 없으면 동시 호출 N개가 각자 "여유 있음"을 읽어 캡이 N배가 된다.
    //    이 축은 fire-and-forget 이라 클라가 의도 없이도 동시 호출을 만든다.
    expect(grantBody()).toContain('from public.profiles where id = v_me for update');
  });

  it('캡 판정이 지급보다 앞이다 — 부분 지급이 없다', () => {
    // ③: 뒤에 있으면 캡이 사후 통보가 되고 일부만 적립된 상태가 남는다.
    const body = grantBody();
    const atHourCap = body.indexOf('CAP_BLUEPRINTS_PER_HOUR then');
    const atDayCap = body.indexOf('CAP_BLUEPRINTS_PER_DAY then');
    const atInsert = body.indexOf('insert into public.defense_blueprints');
    expect(atHourCap).toBeGreaterThan(0);
    expect(atDayCap).toBeGreaterThan(0);
    expect(atInsert).toBeGreaterThan(atHourCap);
    expect(atInsert).toBeGreaterThan(atDayCap);
  });

  it('원장 기록이 지급과 같은 트랜잭션이다', () => {
    // ④: 분리하면 앱이 사이에 죽었을 때 지급은 남고 분모가 비어 캡이 조용히 열린다.
    //    같은 함수 본문 안에 있으면 plpgsql 이 한 트랜잭션을 보장한다.
    const body = grantBody();
    const atInsert = body.indexOf('insert into public.defense_blueprints');
    const atLog = body.indexOf('insert into public.blueprint_grant_log');
    expect(atLog).toBeGreaterThan(atInsert);
    // 사이에 commit 이 없어야 한다(plpgsql 은 commit 을 쓸 수 있다).
    expect(body.slice(atInsert, atLog)).not.toMatch(/\bcommit\b/);
  });

  it('분모 테이블이 클라에게 안 보인다 — RLS 켜고 정책 0개', () => {
    // 분모를 읽으면 "언제 캡이 풀리는가"를 알아내 회피 타이밍을 맞출 수 있다.
    const code = sql();
    expect(code).toContain('alter table public.blueprint_grant_log enable row level security');
    expect(code).not.toMatch(/create policy[^;]*blueprint_grant_log/);
  });

  it('형식 상한(행 8 · 장수 4)을 조이지 않았다', () => {
    // 캐시된 구 클라(PR#391 이전 형상)는 여러 행·장수 2 이상을 보낸다. 조이면 그들이 조용히
    // 거부된다 — 총량은 캡이 묶으므로 조일 이유가 없다.
    const body = grantBody();
    expect(body).toContain('jsonb_array_length(p_grants) > 8');
    expect(body).toContain('v_count < 1 or v_count > 4');
  });

  it('anon 은 실행할 수 없다', () => {
    const code = sql();
    expect(code).toContain('revoke all on function public.grant_blueprints(jsonb) from anon');
    expect(code).toContain('revoke all on function public.grant_blueprints(jsonb) from public');
    expect(code).toContain('to authenticated, service_role');
  });

  it('다른 설계도 유입 경로를 건드리지 않았다', () => {
    // 침공 약탈 · 의뢰 배송 · 일일 보상은 defense_blueprints 에 직접 쓴다(서버 판정이라
    // 캡 대상이 아니다). 이 마이그레이션이 그 함수들을 재정의하면 안 된다.
    const code = sql();
    expect(code).not.toContain('create or replace function public.loot_defense_blueprint');
    expect(code).not.toContain('create or replace function public.claim_commission_grant');
    expect(code).not.toContain('create or replace function public.claim_daily_reward');
  });
});
