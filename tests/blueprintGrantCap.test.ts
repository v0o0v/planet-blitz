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
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CAP_BLUEPRINTS_PER_HOUR,
  CAP_BLUEPRINTS_PER_DAY,
} from '../src/net/blueprintServerConstants.js';
import { BLUEPRINT_RUN_CHANCE_CP } from '../src/sim/drops.js';
import { COMMISSION_MAX_LOOT_MULT_CENTI } from '../src/run/commissionServerConstants.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));

function stripLineComments(s: string): string {
  return s.replace(/--[^\n]*/g, '');
}

/**
 * ⚠️ **파일명을 상수로 고정해 읽지 않는다**(2026-08-08 2차).
 *
 * 이 파일은 원래 `20260808080000_blueprint_grant_cap.sql` 을 이름으로 박아 읽었다. 그런데
 * `grant_blueprints` 는 `create or replace` 로 재정의될 수 있고, 재정의되는 순간 **실제로 도는
 * 정의는 최신 파일**인데 이 관측면은 옛 파일을 계속 본다 — 값이 갈려도 초록이다.
 * 실제로 촉매 드랍 축 레인이 캡을 20/140 으로 재유도하자 이 형태가 곧바로 드러났다.
 *
 * 처방은 `commissionLedgerContract.test.ts` 와 같다: **적용 순 마지막 정의**를 찾아 그 파일을
 * 읽는다(학습 스킬 `sql-redefinition-observability-expertise` §2).
 */
function migrationsInOrder(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, sql: new TextDecoder().decode(readFileSync(MIGRATIONS_DIR + f)) }));
}

/** `grant_blueprints` 의 **최신** 정의 본문(주석 제거). 다른 정의 문장이 섞이지 않는다. */
function grantBody(): string {
  let found: string | null = null;
  for (const { file, sql } of migrationsInOrder()) {
    const at = sql.lastIndexOf('create or replace function public.grant_blueprints(');
    if (at < 0) continue;
    const end = sql.indexOf('\n$$;', at);
    expect(end, `${file}: 본문 종결자를 찾지 못함`).toBeGreaterThan(at);
    found = stripLineComments(sql.slice(at, end));
  }
  if (found === null) throw new Error('마이그레이션에서 grant_blueprints 정의를 찾지 못했습니다');
  return found;
}

/** `grant_blueprints` 의 최신 정의를 **담은 파일 전문**(본문 뒤 revoke/grant 까지 포함). */
function effectiveDefinitionFile(): string {
  let found: string | null = null;
  for (const { sql } of migrationsInOrder()) {
    if (sql.includes('create or replace function public.grant_blueprints(')) {
      found = stripLineComments(sql);
    }
  }
  if (found === null) throw new Error('grant_blueprints 정의를 담은 파일을 찾지 못했습니다');
  return found;
}

/** `NAME constant <type> := <값>;` 의 우변 숫자를 **최신 정의 본문에서** 읽는다. */
function sqlConstant(name: string): number {
  const m = new RegExp(`${name}\\s+constant\\s+[\\w ]+:=\\s*([0-9.]+)`).exec(grantBody());
  expect(m, `SQL 상수 ${name} 을 찾지 못함`).not.toBeNull();
  return Number(m![1]);
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

  /**
   * 정직한 **상한** 확률 = base × 드랍 축 최대 배율.
   *
   * ⚠️ 2026-08-08(2차)부터 `BLUEPRINT_RUN_CHANCE_CP` 만으로는 부족하다 — 촉매 드랍 축이 그 값을
   * 스케일한다. 최대 배율을 안 곱하면 "정직한 기대치"를 **3배 과소평가**하고, 그 상태로 캡을
   * 유도하면 최대 배율로 도는 플레이어가 조용히 거부된다.
   */
  function honestClearChance(): number {
    return (BLUEPRINT_RUN_CHANCE_CP / 10000) * (COMMISSION_MAX_LOOT_MULT_CENTI / 100);
  }

  /** Poisson(λ) 의 P(X ≥ k). 캡 유도가 실제로 쓰는 판정식이라 그대로 잰다. */
  function poissonTail(lambda: number, k: number): number {
    // p(0) 부터 누적해 1 에서 뺀다. λ·k 가 작아(≤ 수십) 언더플로 걱정이 없다.
    let term = Math.exp(-lambda);
    let cdf = term;
    for (let i = 1; i < k; i++) {
      term *= lambda / i;
      cdf += term;
    }
    return Math.max(0, 1 - cdf);
  }

  /**
   * ⚠️ **"캡이 기대치의 N배" 로 재지 않는다.** 그 규칙은 λ 에 의존해서 틀린다 — 같은 안전도를
   * 주는 배수가 λ=1.8 에서는 6.7배, λ=5.4 에서는 3.7배다(꼬리가 λ 와 함께 얇아진다). 옛 단언이
   * 고정 5배였고, 드랍 축이 λ 를 3배로 올리자 **캡이 충분히 안전한데도 빨개졌다.**
   * 판정 근거인 꼬리 확률을 직접 잰다.
   */
  it('시간 캡에 정직한 플레이어가 닿을 확률이 1e-5 이하다', () => {
    const lambda = capRunsPerHour() * honestClearChance();
    expect(lambda).toBeGreaterThan(0);
    expect(
      poissonTail(lambda, CAP_BLUEPRINTS_PER_HOUR),
      `정직 기대 ${lambda.toFixed(2)}/h 에서 캡 ${CAP_BLUEPRINTS_PER_HOUR} 는 너무 낮다 — 캡을 올려라`,
    ).toBeLessThan(1e-5);
  });

  it('확률을 더 올리면 이 유도가 깨지는 것을 자각한다', () => {
    // 뮤테이션 감지용: 확률 축(base 또는 드랍 축 상한)을 또 올리면 꼬리가 두꺼워진다.
    // 그 레인은 이 캡도 함께 올려야 한다 — 그 사실을 여기 못 박는다.
    const doubled = capRunsPerHour() * honestClearChance() * 2;
    expect(
      poissonTail(doubled, CAP_BLUEPRINTS_PER_HOUR),
      '정직 기대가 두 배가 되면 시간 캡이 정직한 플레이어를 물기 시작한다 — 캡을 함께 올려라',
    ).toBeGreaterThan(1e-5);
  });

  it('하루 캡도 같은 기준을 통과한다 (헤비 16시간 가정)', () => {
    // 하루 축이 실질 구속이므로 시간 축과 같은 엄격도로 잰다.
    const lambda = 16 * capRunsPerHour() * honestClearChance();
    expect(
      poissonTail(lambda, CAP_BLUEPRINTS_PER_DAY),
      `헤비 유저 기대 ${lambda.toFixed(1)}/day 에서 캡 ${CAP_BLUEPRINTS_PER_DAY} 는 너무 낮다`,
    ).toBeLessThan(1e-5);
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
    // ⚠️ **전 마이그레이션을 훑는다.** 테이블은 한 파일에서 만들어지지만 정책은 **아무 파일에서나**
    //    나중에 붙을 수 있다 — 생성 파일만 보면 뒤에 붙은 `create policy` 를 영영 못 본다.
    const all = migrationsInOrder().map((m) => stripLineComments(m.sql)).join('\n');
    expect(all).toContain('alter table public.blueprint_grant_log enable row level security');
    expect(all).not.toMatch(/create policy[^;]*blueprint_grant_log/);
  });

  it('형식 상한(행 8 · 장수 4)을 조이지 않았다', () => {
    // 캐시된 구 클라(PR#391 이전 형상)는 여러 행·장수 2 이상을 보낸다. 조이면 그들이 조용히
    // 거부된다 — 총량은 캡이 묶으므로 조일 이유가 없다.
    const body = grantBody();
    expect(body).toContain('jsonb_array_length(p_grants) > 8');
    expect(body).toContain('v_count < 1 or v_count > 4');
  });

  it('anon 은 실행할 수 없다', () => {
    // ⚠️ **최신 정의 파일**을 읽는다. `create or replace` 는 ACL 을 보존하므로 재정의가 회수를
    //    빠뜨려도 순서대로 적용된 DB 에서는 증상이 0 이다 — 위험은 함수가 선재하지 않는 경로
    //    (baseline 스쿼시 · drop 후 부분 재적용)이고, 그때 definer 함수가 EXECUTE to PUBLIC 으로
    //    새로 생긴다. 옛 파일을 읽으면 그 누락이 영영 안 보인다(학습 스킬 §2).
    const code = effectiveDefinitionFile();
    expect(code).toContain('revoke all on function public.grant_blueprints(jsonb) from anon');
    expect(code).toContain('revoke all on function public.grant_blueprints(jsonb) from public');
    expect(code).toContain('to authenticated, service_role');
  });

  it('설계도 캡 마이그레이션들이 다른 유입 경로를 건드리지 않았다', () => {
    // 침공 약탈 · 의뢰 배송 · 일일 보상은 defense_blueprints 에 직접 쓴다(서버 판정이라
    // 캡 대상이 아니다). **캡을 담은** `grant_blueprints` 재정의 파일은 그 함수들을 함께
    // 재정의하면 안 된다 — 곁다리 재정의가 낡은 본문을 복제하는 것이 이 리포의 전례다.
    //
    // ⚠️ 판별을 `CAP_BLUEPRINTS_PER_HOUR` 로 한다. "grant_blueprints 를 정의하는 파일" 로
    //    잡으면 **원래 셋을 함께 만든 생성 파일**(20260722020000)까지 걸려 거짓 실패한다.
    let seen = 0;
    for (const { file, sql } of migrationsInOrder()) {
      if (!sql.includes('CAP_BLUEPRINTS_PER_HOUR')) continue;
      seen++;
      const code = stripLineComments(sql);
      expect(code, file).not.toContain('create or replace function public.loot_defense_blueprint');
      expect(code, file).not.toContain('create or replace function public.claim_commission_grant');
      expect(code, file).not.toContain('create or replace function public.claim_daily_reward');
    }
    // 순회가 공허하면 위 단언은 아무것도 보장하지 않는다(확률 축 레인이 밟은 함정과 같은 형태).
    expect(seen, '캡을 담은 마이그레이션을 하나도 못 찾았다 — 판별식이 낡았다').toBeGreaterThan(0);
  });
});
