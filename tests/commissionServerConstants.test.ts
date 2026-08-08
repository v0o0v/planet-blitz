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
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CAP_ISSUE_ATTEMPTS_PER_HOUR,
  COMMISSION_ISSUE_CHANCE_CP,
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
  COMMISSION_MAX_LOOT_MULT_CENTI,
  CAP_COMMISSIONS_PER_DAY,
} from '../src/run/commissionServerConstants.js';
import { MIN_BOSS_KILL_TICKS } from '../src/run/commissionConstants.js';
import { scaleGateChanceCp, GATE_CP_MAX } from '../src/data/catalystDrops.js';

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

/**
 * 정규식 캡처 그룹을 **문자열로 확정해서** 돌려준다.
 *
 * `noUncheckedIndexedAccess` 아래에서 `m[1]` 은 `string | undefined` 다. `!` 로 눌러 두면
 * 타입만 조용해지고 그룹이 실제로 안 잡힌 경우 `undefined` 가 그대로 흘러 **집합 비교가 빈 값끼리
 * 같다고 말하며 통과**한다 — 이 파일이 지키려는 드리프트를 못 보게 되는 형태다. 여기서 던진다.
 */
function cap(m: RegExpMatchArray | RegExpExecArray | null, i: number, what: string): string {
  const v = m?.[i];
  if (typeof v !== 'string') throw new Error(`${what}: 캡처 그룹 ${i} 를 읽지 못했다`);
  return v;
}

/** `NAME constant interval := interval '<n> <unit>';` 을 ms 로 읽는다. */
function sqlIntervalMs(name: string): number {
  const code = stripLineComments(sql());
  const m = new RegExp(`${name}\\s+constant\\s+interval\\s*:=\\s*interval\\s*'(\\d+)\\s+(\\w+)'`).exec(
    code,
  );
  expect(m, `SQL interval 상수 ${name} 을 찾지 못함`).not.toBeNull();
  const n = Number(cap(m, 1, `SQL interval ${name}`));
  const unit = cap(m, 2, `SQL interval ${name} 단위`);
  const per: Record<string, number> = {
    minute: 60_000,
    minutes: 60_000,
    hour: 3_600_000,
    hours: 3_600_000,
    day: 86_400_000,
    days: 86_400_000,
  };
  const ms = per[unit];
  expect(ms, `알 수 없는 단위 ${unit}`).toBeGreaterThan(0);
  return n * (ms ?? 0);
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
    return [...cap(m, 1, 'allowlist 본문').matchAll(/'([^']+)'/g)]
      .map((x) => cap(x, 1, 'allowlist 항목'))
      .sort();
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
    return [...code.slice(at, end).matchAll(/when '([^']+)'\s+then/g)]
      .map((x) => cap(x, 1, 'case 분기 라벨'))
      .sort();
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

// ---------------------------------------------------------------------------
// 발령 확률 게이트 (2026-08-08) — 재정의 마이그레이션이 정본이다
// ---------------------------------------------------------------------------

/**
 * ⚠️ 위 블록들은 **원본** 마이그레이션(20260803000000)을 읽는다. 발령 함수는 그 뒤로 여러 번
 * `create or replace` 됐고, 실제 데이터베이스가 도는 것은 **마지막 것**이다. 그래서 이 블록만
 * 최신 정의를 읽는다 — 원본을 읽으면 "고쳤는데 테스트가 옛 본문을 보고 통과"하는 형태가 된다.
 *
 * ⚠️⚠️ **파일명을 상수로 박지 않는다**(2026-08-08 2차에 고쳤다). 이 파일은 원래
 * `20260808070000` 을 이름으로 박아 읽었고, 촉매 드랍 축 레인이 그 함수를 또 재정의하자
 * **새 본문을 한 줄도 안 보면서 초록**이 됐다 — 이 주석이 경고한 바로 그 형태를 자기가 밟은
 * 것이다. 적용 순 마지막 정의를 찾아 읽는다(학습 스킬 `sql-redefinition-observability-expertise` §2).
 */
const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));

function issueRateSql(): string {
  let found: string | null = null;
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    const text = new TextDecoder().decode(readFileSync(MIGRATIONS_DIR + f));
    if (text.includes('create or replace function public.issue_commission_for_run(')) found = text;
  }
  if (found === null) throw new Error('issue_commission_for_run 정의를 찾지 못했습니다');
  return found;
}

describe('발령 확률 게이트 SQL ↔ TS 미러', () => {
  it('ISSUE_CHANCE_CP == COMMISSION_ISSUE_CHANCE_CP', () => {
    const code = stripLineComments(issueRateSql());
    const m = /ISSUE_CHANCE_CP\s+constant\s+[\w ]+:=\s*([0-9]+)/.exec(code);
    expect(m, 'SQL 상수 ISSUE_CHANCE_CP 를 찾지 못함').not.toBeNull();
    expect(Number(cap(m, 1, 'ISSUE_CHANCE_CP'))).toBe(COMMISSION_ISSUE_CHANCE_CP);
  });

  it("skip_reason check 에 'roll' 이 있다", () => {
    // 없으면 4b 의 update 가 check 위반 -> 서브트랜잭션 롤백 -> 앵커까지 소멸(fail-closed).
    // 증상은 warning 하나뿐이고 화면상으론 "발령률 0%" 라 조용하다. 여기서 못 박는다.
    const m = /check\s*\(skip_reason in \(([^)]*)\)\)/.exec(issueRateSql());
    expect(m, 'skip_reason check 제약을 찾지 못함').not.toBeNull();
    const labels = cap(m, 1, 'skip_reason 라벨')
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .sort();
    expect(labels).toEqual(['cooldown', 'not-victory', 'rate', 'rate-day', 'roll', 'stock']);
  });

  it('게이트가 재고 상한 뒤 · 계급 롤 앞에 있다', () => {
    // 순서가 계약이다: 앞으로 옮기면 빈도 상한이 세는 claimed_victory 행이 롤에 좌우돼
    // 위조 처리량 방어가 새고, 뒤로 옮기면 이미 굽힌 payload 를 버리게 된다.
    const code = stripLineComments(issueRateSql());
    const stock = code.indexOf("skip_reason = 'stock'");
    const roll = code.indexOf("skip_reason = 'roll'");
    const grade = code.indexOf('v_roll := random()');
    expect(stock).toBeGreaterThan(0);
    expect(roll).toBeGreaterThan(stock);
    expect(grade).toBeGreaterThan(roll);
  });

  it('게이트 롤과 계급 롤이 서로 다른 random() 호출이다', () => {
    // 하나를 재사용하면 계급 분포가 [0.3, 1) 로 잘려 1급(<0.55)이 사라진다.
    const code = stripLineComments(issueRateSql());
    expect(code).toContain('floor(random() * 10000)::int >= v_chance_cp');
    expect(code).toContain('v_roll := random()');
  });

  it('롤 실패 경로는 next_eligible_at 을 전진시키지 않는다', () => {
    // 쿨다운 누적기의 불변은 "**발령된** 런들의 주장 시간 합 ≤ 실제 경과"다. 미발령 런이
    // 지평을 밀면 그 불변이 깨지고 정직한 플레이어의 다음 발령이 부당하게 밀린다.
    const code = stripLineComments(issueRateSql());
    const roll = code.indexOf("skip_reason = 'roll'");
    const horizon = code.indexOf('next_eligible_at = greatest(now(), v_horizon)');
    expect(horizon).toBeGreaterThan(roll); // 전진은 게이트보다 뒤(= 6단계 발령)에서만.
    expect(code.slice(roll, horizon)).toContain('return;');
  });
});

// ---------------------------------------------------------------------------
// 촉매 드랍 축이 발령 확률에 닿는다 (2026-08-08 2차 지시)
// ---------------------------------------------------------------------------

describe('발령 확률 — 드랍 축 배율', () => {
  it('MAX_LOOT_MULT_CENTI == COMMISSION_MAX_LOOT_MULT_CENTI', () => {
    const code = stripLineComments(issueRateSql());
    const m = /MAX_LOOT_MULT_CENTI\s+constant\s+[\w ]+:=\s*([0-9]+)/.exec(code);
    expect(m, 'SQL 상수 MAX_LOOT_MULT_CENTI 를 찾지 못함').not.toBeNull();
    expect(Number(cap(m, 1, 'MAX_LOOT_MULT_CENTI'))).toBe(COMMISSION_MAX_LOOT_MULT_CENTI);
  });

  it('CAP_COMMISSIONS_PER_DAY 가 일치한다', () => {
    const code = stripLineComments(issueRateSql());
    const m = /CAP_COMMISSIONS_PER_DAY\s+constant\s+[\w ]+:=\s*([0-9]+)/.exec(code);
    expect(m, 'SQL 상수 CAP_COMMISSIONS_PER_DAY 를 찾지 못함').not.toBeNull();
    expect(Number(cap(m, 1, 'CAP_COMMISSIONS_PER_DAY'))).toBe(CAP_COMMISSIONS_PER_DAY);
  });

  it('형식 상한이 드랍 축 전수 스윕 최댓값과 같다', () => {
    // 손 계산하면 틀린다(catalysts.ts:453 — "손 계산이 2·3판 연속 틀렸다"). 공명을 포함한
    // 전수 최댓값이 x3.0 이고, 공명을 빠뜨린 axisCapMult 는 x2.9 다 — 후자를 쓰면 **정직한
    // 최대 조합이 잘린다**. 여기서 300(=x3.00)을 못 박아 그 하향을 뮤테이션으로 잡는다.
    expect(COMMISSION_MAX_LOOT_MULT_CENTI).toBe(300);
  });

  it('클램프이지 거부가 아니다 — 구 클라(키 부재)는 정확히 base 를 받는다', () => {
    // 거부하면 캐시된 구 클라가 조용히 막힌다(학습 스킬 §5). 그리고 키 부재 -> 100 이라
    // 하위 호환이 **산술로** 보장된다. 아래 셋이 다 있어야 그 성질이 선다.
    const code = stripLineComments(issueRateSql());
    expect(code).toContain("(p_summary->>'catalystLootMultCenti') ~ '^[0-9]+$'");
    expect(code).toContain('least(MAX_LOOT_MULT_CENTI, greatest(100,');
    expect(code).toMatch(/else\s+100\s+end;/);
    // TS 짝이 같은 하위 호환을 갖는다: mult 미지정이면 base 를 **정수 그대로** 돌려준다.
    expect(scaleGateChanceCp(COMMISSION_ISSUE_CHANCE_CP, undefined)).toBe(
      COMMISSION_ISSUE_CHANCE_CP,
    );
    expect(scaleGateChanceCp(COMMISSION_ISSUE_CHANCE_CP, 1)).toBe(COMMISSION_ISSUE_CHANCE_CP);
  });

  it('반올림이 TS 짝과 같다 — floor 로 바꾸면 발령률이 갈린다', () => {
    // SQL 이 round 이고 TS 가 round 여야 클라 계측과 서버 발령률이 안 갈린다.
    const code = stripLineComments(issueRateSql());
    expect(code).toContain('round(ISSUE_CHANCE_CP * v_mult_cp / 100.0)::int');
    // 반올림이 실제로 관측되는 배율을 하나 고른다: 3000 x 1.005 = 3015 (floor 도 3015 라
    // 구분이 안 되므로 소수 반올림이 갈리는 값을 쓴다). 3000 x 1.0005 = 3001.5 -> round 3002.
    expect(scaleGateChanceCp(3000, 1.0005)).toBe(3002);
  });

  it('최대 배율에서 90% 이고 100% 를 넘지 않는다', () => {
    const maxMult = COMMISSION_MAX_LOOT_MULT_CENTI / 100;
    expect(scaleGateChanceCp(COMMISSION_ISSUE_CHANCE_CP, maxMult)).toBe(9000);
    // 형식 상한이 훗날 커져도 산술이 100% 를 넘지 않는다(SQL 의 least(GATE_CP_MAX, …) 짝).
    expect(scaleGateChanceCp(COMMISSION_ISSUE_CHANCE_CP, 99)).toBe(GATE_CP_MAX);
    expect(code_gateCpMax()).toBe(GATE_CP_MAX);
  });

  function code_gateCpMax(): number {
    const code = stripLineComments(issueRateSql());
    const m = /GATE_CP_MAX\s+constant\s+[\w ]+:=\s*([0-9]+)/.exec(code);
    expect(m, 'SQL 상수 GATE_CP_MAX 를 찾지 못함').not.toBeNull();
    return Number(cap(m, 1, 'GATE_CP_MAX'));
  }

  it('하루 캡이 확률 게이트 뒤 · 발령 앞이다', () => {
    // 순서 이유가 4b 와 **반대**다: 이 캡의 분자는 발령 건수라 롤 실패를 세면 안 된다.
    // 앞에 두면 롤 실패가 하루 캡을 갉아먹어 정직한 플레이어가 발령 없이 캡에 닿는다.
    const code = stripLineComments(issueRateSql());
    const roll = code.indexOf("skip_reason = 'roll'");
    const day = code.indexOf("skip_reason = 'rate-day'");
    const insert = code.indexOf('insert into public.commission_inventory');
    expect(roll).toBeGreaterThan(0);
    expect(day).toBeGreaterThan(roll);
    expect(insert).toBeGreaterThan(day);
  });

  it('하루 캡이 프로필 행을 잠그고 발령 건수만 센다', () => {
    // 잠금 부재 -> 병렬 정산 N개가 각자 "여유 있음"을 읽어 N배. 분자가 발령이 아니라 시도면
    // 롤 실패가 캡을 먹는다(위 순서 단언의 짝 — 값 대조로는 둘 다 안 잡힌다).
    const code = stripLineComments(issueRateSql());
    const lock = code.indexOf('from public.profiles where id = p_profile_id for update');
    const day = code.indexOf("skip_reason = 'rate-day'");
    expect(lock).toBeGreaterThan(0);
    expect(day).toBeGreaterThan(lock);
    expect(code.slice(lock, day)).toContain('and granted');
    expect(code.slice(lock, day)).toContain("interval '1 day'");
  });

  it('하루 캡이 정직한 헤비 유저를 벌하지 않는다', () => {
    // 정직 천장 = 16시간 x 시도 상한 x min(1, base x 최대 배율).
    const perHour =
      CAP_ISSUE_ATTEMPTS_PER_HOUR *
      Math.min(1, scaleGateChanceCp(COMMISSION_ISSUE_CHANCE_CP, 3) / 10000);
    const honestDay = 16 * perHour;
    expect(honestDay).toBeGreaterThan(0);
    expect(
      CAP_COMMISSIONS_PER_DAY,
      `정직 천장 ${honestDay}/day 보다 캡이 낮으면 최대 배율 플레이어가 조용히 거부된다`,
    ).toBeGreaterThan(honestDay);
    // 그리고 24시간 위조 천장(24 x perHour)보다는 낮아야 하루 축이 실제로 구속한다.
    expect(CAP_COMMISSIONS_PER_DAY).toBeLessThan(24 * perHour);
  });
});
