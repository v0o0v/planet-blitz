/**
 * 의뢰서 서버 축 상수 — SQL ↔ TS 미러 대조 (서버 계약 rev3 §10 AC-G1 · AC-G2).
 *
 * 이 테스트의 존재 이유: **같은 수치가 두 곳(SQL 본문과 TS 상수 모듈)에 산다.** 이 리포의
 * 지배적 실패 모드가 "한쪽만 고쳐서 조용히 어긋나는" 것이고, 어긋나도 런타임에는 아무 신호가
 * 없다 — 서버는 자기 값으로 판정하고 클라는 자기 값으로 화면을 그린다.
 *
 * ⚠️ **AC-G2 는 값 일치가 아니라 집합 일치도 함께 잰다.** "case 에 분기만 추가하고 allowlist 를
 *    빠뜨림"은 값 대조로는 안 잡힌다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CAP_ISSUE_ATTEMPTS_PER_HOUR,
  CAP_CONSUME_PER_HOUR,
  CAP_VERIFY_ATTEMPTS,
  CAP_COMMISSION_CREDITS,
  CAP_COMMISSION_MINERALS,
  COMMISSION_STOCK_CAP,
  GRANT_CURRENCY_CLIENT_SOURCES,
  GRANT_CURRENCY_ALL_SOURCES,
  isGrantCurrencyClientSource,
  commissionTtlOrderingHolds,
  GRACE_ISSUED_TO_ACTIVE_MS,
  COMMISSION_ACTIVE_TTL_MS,
  COMMISSION_BLOB_TTL_MS,
  COMMISSION_ISSUES_RETENTION_MS,
} from '../src/run/commissionServerConstants.js';
import { MIN_BOSS_KILL_TICKS } from '../src/run/commissionConstants.js';

const MIGRATION = fileURLToPath(
  new URL('../supabase/migrations/20260803000000_commission_ledger.sql', import.meta.url),
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

/** `NAME constant interval := interval '<n> <unit>';` 을 ms 로 읽는다. */
function sqlIntervalMs(name: string): number {
  const code = stripLineComments(sql());
  const m = new RegExp(`${name}\\s+constant\\s+interval\\s*:=\\s*interval\\s*'(\\d+)\\s+(\\w+)'`).exec(
    code,
  );
  expect(m, `SQL interval 상수 ${name} 을 찾지 못함`).not.toBeNull();
  const n = Number(m![1]);
  const unit = m![2];
  const per: Record<string, number> = {
    minute: 60_000,
    minutes: 60_000,
    hour: 3_600_000,
    hours: 3_600_000,
    day: 86_400_000,
    days: 86_400_000,
  };
  expect(per[unit], `알 수 없는 단위 ${unit}`).toBeGreaterThan(0);
  return n * per[unit];
}

describe('AC-G1 — 시간 상수 정렬 불변식', () => {
  it('GRACE < ACTIVE_TTL < BLOB_TTL < ISSUES_RETENTION', () => {
    expect(commissionTtlOrderingHolds()).toBe(true);
    // 왜 중요한가: ACTIVE_TTL >= BLOB_TTL 이면 **재시도 창 안에 리플레이가 사라진다**.
    expect(GRACE_ISSUED_TO_ACTIVE_MS).toBeLessThan(COMMISSION_ACTIVE_TTL_MS);
    expect(COMMISSION_ACTIVE_TTL_MS).toBeLessThan(COMMISSION_BLOB_TTL_MS);
    expect(COMMISSION_BLOB_TTL_MS).toBeLessThan(COMMISSION_ISSUES_RETENTION_MS);
  });
});

describe('AC-G2 — SQL ↔ TS 수치 미러', () => {
  it('빈도·시도 상한이 일치한다', () => {
    expect(sqlConstant('CAP_ISSUE_ATTEMPTS_PER_HOUR')).toBe(CAP_ISSUE_ATTEMPTS_PER_HOUR);
    expect(sqlConstant('CAP_CONSUME_PER_HOUR')).toBe(CAP_CONSUME_PER_HOUR);
    expect(sqlConstant('COMMISSION_STOCK_CAP')).toBe(COMMISSION_STOCK_CAP);
  });

  it('의뢰 지급 캡이 일치한다', () => {
    expect(sqlConstant('CAP_COMMISSION_CREDITS')).toBe(CAP_COMMISSION_CREDITS);
    expect(sqlConstant('CAP_COMMISSION_MINERALS')).toBe(CAP_COMMISSION_MINERALS);
  });

  it('MIN_BOSS_KILL_TICKS 가 일치한다', () => {
    // ⚠️ 이 축에서 유일하게 **정직한 사용자를 벌할 수 있는** 상수다. SQL 쪽만 올리면
    // 정직한 속공 런이 조용히 발령을 못 받게 된다.
    expect(sqlConstant('MIN_BOSS_KILL_TICKS')).toBe(MIN_BOSS_KILL_TICKS);
  });

  it('시간 상수가 일치한다', () => {
    expect(sqlIntervalMs('GRACE_ISSUED_TO_ACTIVE')).toBe(GRACE_ISSUED_TO_ACTIVE_MS);
    expect(sqlIntervalMs('ACTIVE_TTL')).toBe(COMMISSION_ACTIVE_TTL_MS);
  });

  it('CAP_VERIFY_ATTEMPTS 는 EF 가 읽는다(SQL 에 값이 없다)', () => {
    // bump RPC 는 카운터를 올리기만 하고 상한 판정은 EF 가 한다 — 그래서 SQL 미러가 없다.
    // 이 사실을 테스트로 못 박아, 나중에 SQL 에 상한을 심으면 정본이 둘이 됨을 드러낸다.
    expect(stripLineComments(sql())).not.toContain('CAP_VERIFY_ATTEMPTS');
    expect(CAP_VERIFY_ATTEMPTS).toBeGreaterThan(0);
  });
});

describe('AC-G2 확장 — source 집합 일치 (값이 아니라 집합)', () => {
  /** grant_currency 본문의 allowlist 리터럴 집합. */
  function allowlistFromSql(): string[] {
    const code = stripLineComments(sql());
    const m = /p_source not in \(([^)]*)\)/.exec(code);
    expect(m, 'allowlist 를 찾지 못함').not.toBeNull();
    return [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  }

  /** grant_currency_for 의 `case p_source` 분기 라벨 집합. */
  function caseLabelsFromSql(): string[] {
    const code = stripLineComments(sql());
    const at = code.indexOf('case p_source');
    expect(at).toBeGreaterThan(0);
    const end = code.indexOf('end case;', at);
    expect(end).toBeGreaterThan(at);
    // ⚠️ `\s+` 여야 한다. `' then`(공백 1칸)으로 쓰면 정렬용 여백을 넣은 분기를 놓쳐
    //    **집합이 조용히 작아진다** — 이 테스트가 지키려는 바로 그 드리프트를 못 보게 된다.
    return [...code.slice(at, end).matchAll(/when '([^']+)'\s+then/g)].map((x) => x[1]).sort();
  }

  it('allowlist == TS 클라 source 집합', () => {
    expect(allowlistFromSql()).toEqual([...GRANT_CURRENCY_CLIENT_SOURCES].sort());
  });

  it('case 분기 라벨 == TS 전체 source 집합', () => {
    expect(caseLabelsFromSql()).toEqual([...GRANT_CURRENCY_ALL_SOURCES].sort());
  });

  it('case 라벨 − {commission} == allowlist', () => {
    // 뮤테이션: case 에 분기만 추가하고 allowlist 를 빠뜨리면 이 단언이 실패한다.
    // ⚠️ 앞의 두 단언만으로는 이 관계가 안 잡힌다 — 각각 TS 와만 비교하므로 TS 를 둘 다
    //    틀리게 고치면 통과한다. 이 세 번째가 SQL 내부의 정합을 직접 잰다.
    const minusCommission = caseLabelsFromSql().filter((s) => s !== 'commission');
    expect(minusCommission).toEqual(allowlistFromSql());
  });

  it('commission 은 클라 source 가 아니다', () => {
    expect(isGrantCurrencyClientSource('commission')).toBe(false);
    expect(isGrantCurrencyClientSource('x')).toBe(false);
    expect(isGrantCurrencyClientSource('PVE_RUN')).toBe(false); // 대문자 정규화 없음(의도).
    expect(isGrantCurrencyClientSource(' salvage')).toBe(false); // 선행 공백.
    for (const s of GRANT_CURRENCY_CLIENT_SOURCES) {
      expect(isGrantCurrencyClientSource(s)).toBe(true);
    }
  });
});
