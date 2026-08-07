/**
 * 정련 서버 굴림 계약 (ADR-0050 §3 단계 1 둘째 축 ·
 * `supabase/migrations/20260808030000_refine_server_roll.sql`).
 *
 * ## 닫는 구멍 하나
 * 정련은 광물 차감만 서버를 탔고 **시드는 클라가 만들었다**(`refinery.ts` 의 `Math.random()`).
 * `rollChain` 은 난수를 전부 주입받는 **순수 함수**라 시드를 고르는 쪽이 결과를 고르는 쪽이다.
 * 그래서 정확한 공격은 *"광물을 한 번만 내고 원하는 어픽스가 나올 때까지 로컬에서 굴린다"* 였다.
 *
 * ## ⛔ 닫지 **않는** 것 — 이 테스트가 그것까지 지킨다고 오해하지 마라
 * 어픽스 위조 자체는 그대로 열려 있다. 정련은 기존 아이템의 어픽스를 바꾸는 것이라 id 가
 * 그대로이고, `save` **증가분** 봉인은 "원장에 없는 id 의 신규 등장"만 되돌린다. 손으로
 * 세이브의 어픽스를 고치는 경로를 닫으려면 **어픽스 단위 봉인**이라는 다른 축이 필요하다.
 *
 * 여기서 지키는 것은 **"대가를 치른 횟수만큼만 굴린다"** 하나다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const MINE = '20260808030000_refine_server_roll.sql';

function migrationsInOrder(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    // 이 저장소 tsconfig 의 fs 타입은 readFileSync 가 1인자·바이트 반환이다.
    .map((f) => ({ file: f, sql: new TextDecoder().decode(readFileSync(MIGRATIONS_DIR + f)) }));
}

function stripLineComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

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

function readSrc(rel: string): string {
  return new TextDecoder().decode(readFileSync(SRC + rel));
}

const roll = () => effectiveFunctionBody('roll_refine').code;

describe('roll_refine — 차감과 굴림이 한 트랜잭션이다', () => {
  it('차감을 먼저 하고, 실패하면 굴림 값을 주지 않는다', () => {
    const c = roll();
    const spendAt = c.indexOf('public.spend_currency');
    const seedAt = c.indexOf('v_seed :=');
    expect(spendAt, 'spend_currency 호출이 없다 — 무료 정련이 된다').toBeGreaterThan(-1);
    // 나쁜 상태: 시드를 먼저 만들고 차감을 나중에 하면, 차감 실패 응답에도 시드가 실려
    // 그것만 뽑아 쓰는 공짜 굴림이 된다.
    expect(seedAt).toBeGreaterThan(spendAt);
    // 차감 실패 분기가 seed=null 로 반환해야 한다.
    // ⚠️ 분기 **전체**에서 `'ok', false … 'seed', null` 를 찾으면 안 된다 — 무인증 분기가 먼저
    //    걸려 통과해 버린다(뮤테이션으로 실증했다: insufficient 분기에 시드를 실어도 초록이었다).
    //    그래서 차감 판정 직후 ~ 'insufficient' 사이만 잘라 본다.
    const insufficientBranch = c.slice(c.indexOf('is not true then'), c.indexOf("'insufficient'"));
    expect(insufficientBranch.length).toBeGreaterThan(0);
    expect(insufficientBranch, '차감 실패인데 시드를 실어 준다 — 그것만 뽑아 쓰면 공짜 굴림이다')
      .toContain("'seed', null");
    expect(insufficientBranch).toContain("'risk_roll', null");
    expect(c).toContain("'insufficient'");
  });

  it('⭐ spend_currency 본문을 복제하지 않고 중첩 호출한다', () => {
    const c = roll();
    // 이 저장소는 재화 함수 본문 복제로 프로덕션을 100% 깨뜨린 전례가 있다(20260802000000:4-15).
    expect(c).toContain('public.spend_currency(0, p_cost');
    const mine = stripLineComments(migrationsInOrder().find((m) => m.file === MINE)!.sql);
    expect(mine).not.toContain('create or replace function public.spend_currency');
    expect(mine).not.toContain('create or replace function public.settle_pve_run');
  });

  it('시드와 용해 주사위를 다른 바이트에서 뽑는다', () => {
    const c = roll();
    // 나쁜 상태: 같은 바이트를 접어 쓰면 시드만 보고 용해 여부를 알 수 있어, 클라가 손해 보는
    // 굴림을 골라 버릴 수 있다(= 다시 확률이 클라 손에 간다).
    // ⚠️ `lastIndexOf` 다 — `indexOf` 는 차감 실패 분기의 이른 `return` 을 집어 구간이
    //    뒤집히고, 그러면 슬라이스가 비어 **단언이 공허해진다**(실제로 밟았다).
    const seedLine = c.slice(c.indexOf('v_seed :='), c.lastIndexOf('return jsonb_build_object'));
    expect((seedLine.match(/gen_random_bytes/g) ?? []).length).toBe(2);
    expect(seedLine).toContain('4294967296.0'); // [0,1) 정규화
  });

  it('definer 로 돌고 수령자를 auth.uid() 로 고정한다', () => {
    const c = roll();
    expect(c).toContain('security definer');
    expect(c).toContain('auth.uid()');
    expect(c).not.toMatch(/p_profile_id/);
  });
});

describe('클라가 더 이상 굴림 값을 고르지 않는다', () => {
  const refinery = () => readSrc('ui/pixi/refinery.ts');

  it('서버 값을 우선 쓴다 (Math.random 은 폴백으로만 남는다)', () => {
    const src = refinery();
    expect(src).toContain('rollRefineOnServer');
    // 나쁜 상태: 서버 호출을 넣고도 굴림에 안 쓰면 아무것도 안 바뀐다 — 실제 사용을 단언한다.
    expect(src).toMatch(/const seed = serverSeed \?\? /);
    expect(src).toMatch(/const riskRoll = serverRisk \?\? /);
  });

  it('⛔ 온라인 실패에서 로컬 굴림으로 강등하지 않는다', () => {
    const src = refinery();
    // `failed` 분기는 반드시 return 해야 한다. 강등하면 "차감됐는지 모르는 채 굴리는" 경로가
    // 생겨 공짜 굴림의 문이 그대로 다시 열린다.
    const at = src.indexOf('spend.err.unavailable');
    expect(at).toBeGreaterThan(-1);
    const after = src.slice(at, at + 220);
    expect(after).toContain('return;');
  });

  it('미설정(오프라인)에서는 여전히 정련이 된다', () => {
    // 나쁜 상태: 폴백을 지우면 오프라인 단일플레이에서 정련이 통째로 막힌다.
    const src = refinery();
    expect(src).toMatch(/status === 'unconfigured'/);
    expect(src).toContain('Math.random');
  });
});
