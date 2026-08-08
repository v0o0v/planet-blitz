/**
 * 의뢰서 발령 **자격 술어** — 클라와 서버가 같은 술어를 갖는지 (2026-08-08 실측 결함 복구).
 *
 * ## 이 파일이 지키는 것
 * 서버 `issue_commission_for_run` 2단계는 `victory and bossKilled` 로 자격을 판정한다.
 * **클라가 `bossKilled` 를 한 번도 보내지 않아** 그 술어가 승리 런에서 NULL 이 됐고,
 * `claimed_victory boolean not null` 위반 → 서브트랜잭션 롤백 → **자기 앵커까지 소멸** →
 * `raise warning` 하나. 화면에는 아무 증상이 없었고 **발령률이 0%** 였다.
 *
 * 원격 실측(2026-08-08): verified 48 = 패배 33(앵커 전부 있음) + 승리 15(앵커 **전부 없음**),
 * `granted` 0건, `summary ? 'bossKilled'` 0건.
 *
 * ## ⚠️ 값 대조로는 이 결함이 안 잡힌다 — **키의 존재**와 **NULL 가능성**을 잰다
 * 상수는 전부 옳았다. 틀린 것은 "읽는 쪽이 기대하는 키를 쓰는 쪽이 안 보낸다" 하나였고,
 * 그것은 두 파일을 **동시에** 봐야만 보인다. 아래 단언들이 그 짝을 못 박는다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createWorld, DEFAULT_CONFIG, bossKilledOf } from '../src/sim/world.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));

function stripLineComments(s: string): string {
  return s.replace(/--[^\n]*/g, '');
}

/**
 * `issue_commission_for_run` 의 **적용 순 마지막 정의 본문**(주석 제거).
 * ⚠️ 파일명을 상수로 박지 않는다 — 재정의가 도는 순간 옛 본문을 보고 초록이 된다
 * (`.omc/skills/sql-redefinition-observability-expertise.md` §2).
 */
function issueBody(): string {
  let found: string | null = null;
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    const text = new TextDecoder().decode(readFileSync(MIGRATIONS_DIR + f));
    const at = text.lastIndexOf('create or replace function public.issue_commission_for_run(');
    if (at < 0) continue;
    const end = text.indexOf('\n$$;', at);
    expect(end, `${f}: 본문 종결자를 찾지 못함`).toBeGreaterThan(at);
    found = stripLineComments(text.slice(at, end));
  }
  if (found === null) throw new Error('issue_commission_for_run 정의를 찾지 못했습니다');
  return found;
}

function readSrc(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

// ---------------------------------------------------------------------------
// ① sim 리더 — 술어의 정본
// ---------------------------------------------------------------------------

describe('bossKilledOf — 술어 정본', () => {
  function world(bossSpawned: boolean, victory: boolean) {
    const w = createWorld(0x51ee, { ...DEFAULT_CONFIG });
    w.bossSpawned = bossSpawned;
    w.victory = victory;
    return w;
  }

  it('보스가 스폰됐고 승리했을 때만 참이다 (진리표 4조합)', () => {
    expect(bossKilledOf(world(true, true))).toBe(true);
    expect(bossKilledOf(world(true, false))).toBe(false);
    expect(bossKilledOf(world(false, true))).toBe(false);
    expect(bossKilledOf(world(false, false))).toBe(false);
  });

  it('⭐ `victory` 의 재진술이 아니다 — 코어 파괴 승리를 배제한다', () => {
    // PvE 승리는 두 경로로 선다: 보스 사망과 `compact()` 의 `e.kind==='core'` 분기.
    // 후자에서 참을 돌려주면 서버가 요구하는 "주장 둘"이 하나로 접혀 게이트가 무의미해진다.
    const coreWin = world(false, true);
    expect(coreWin.victory).toBe(true);
    expect(bossKilledOf(coreWin)).toBe(false);
  });

  it('갓 만든 월드는 거짓이다 (기본값이 자격을 주지 않는다)', () => {
    const w = createWorld(1, { ...DEFAULT_CONFIG });
    expect(bossKilledOf(w)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ② 클라가 실제로 그 키를 싣는다 — 이 짝이 없어서 0% 였다
// ---------------------------------------------------------------------------

describe('클라 payload 가 서버가 읽는 키를 싣는다', () => {
  it('PveSettleSummary 에 bossKilled 가 **필수**로 선언돼 있다', () => {
    // optional(`bossKilled?`) 로 두면 "안 실어도 타입이 통과"라 같은 결함이 그대로 재발한다.
    const src = readSrc('../src/net/gateway.ts');
    const at = src.indexOf('export interface PveSettleSummary {');
    expect(at, 'PveSettleSummary 선언을 찾지 못했다').toBeGreaterThan(0);
    const decl = src.slice(at, src.indexOf('\n}', at));
    expect(decl).toMatch(/^\s*bossKilled:\s*boolean;/m);
    expect(decl, 'optional 로 두면 결함이 재발한다').not.toMatch(/bossKilled\?/);
  });

  it('정산 호출부가 sim 리더로 채운다 (술어를 그 자리에서 다시 조립하지 않는다)', () => {
    // 재조립하면 정본이 둘이 되고, 한쪽만 고치는 순간 클라와 서버가 조용히 갈린다.
    const src = readSrc('../src/main.ts');
    const at = src.indexOf('void settlePveRunCurrency(');
    expect(at, '정산 호출부를 찾지 못했다').toBeGreaterThan(0);
    const call = src.slice(at, src.indexOf('storyRewardCredits', at));
    expect(call).toContain('bossKilled: bossKilledOf(w)');
  });
});

// ---------------------------------------------------------------------------
// ③ 서버 술어가 **NULL 을 낼 수 없다** — 결함의 실제 형태
// ---------------------------------------------------------------------------

describe('서버 자격 술어 — 3값 논리가 끝나 있다', () => {
  it('⭐ NULL 을 만드는 옛 형태가 남아 있지 않다 (음성 대조)', () => {
    // 이 한 줄이 2026-08-03~08 내내 발령률을 0% 로 만든 원문이다.
    const body = issueBody();
    expect(body).not.toMatch(/v_victory\s*:=\s*\(p_summary->>'victory'\s*=\s*'true'\s*and/);
  });

  it('victory 도 bossKilled 도 coalesce 로 감싸여 있다', () => {
    const body = issueBody();
    expect(body).toContain("coalesce(p_summary->>'victory' = 'true', false)");
    expect(body).toContain("coalesce(p_summary->>'bossKilled' = 'true', false)");
  });

  it('키 부재를 **명시적으로** 분기한다 — 거부가 아니라 폴백이다', () => {
    // 부재를 거부로 다루면 캐시된 구 클라의 발령이 계속 0% 다 — 지금 고치려는 것이 그 0% 다.
    const body = issueBody();
    expect(body).toContain("jsonb_exists(p_summary, 'bossKilled')");
    expect(body).toMatch(/else\s+v_claimed_victory/);
  });

  it('⭐ 삽입에 최후 방어가 남아 있다 — 앵커가 사라지는 형태를 구조적으로 막는다', () => {
    // 이 결함의 치명성은 술어가 틀린 것이 아니라 **틀렸을 때 앵커까지 지워져 무증상이 된 것**
    // 이었다. 술어를 다시 만지는 사람이 NULL 가능 식을 들여도 이 줄이 남아야 한다.
    const body = issueBody();
    expect(body).toContain('coalesce(v_victory, false)');
  });

  it('자격 판정이 앵커 삽입 **뒤**다 (빈도 상한이 시도를 셀 수 있어야 한다)', () => {
    // 순서가 방어 계약이다. 앞으로 옮기면 자격 미달 런이 카운트에 안 남아 위조 천장이 오른다.
    const body = issueBody();
    const insert = body.indexOf('insert into public.commission_issues');
    const gate = body.indexOf("skip_reason = 'not-victory'");
    expect(insert).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(insert);
  });

  it('claimed_victory 를 세는 빈도 상한이 그대로 있다', () => {
    // 이 결함이 "분자가 빈다"로 오독됐던 축. 실제로는 행 자체가 없었지만, 복구 후에는
    // 승리 런이 앵커를 남기므로 이 상한이 비로소 실제로 작동하기 시작한다.
    const body = issueBody();
    expect(body).toContain('and claimed_victory');
    expect(body).toContain('CAP_ISSUE_ATTEMPTS_PER_HOUR');
  });
});
