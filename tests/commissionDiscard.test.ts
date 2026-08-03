/**
 * 의뢰서 **폐기**(`discard_commission`) — 2026-08-03 신설.
 *
 * ## 이 기능이 닫는 구멍
 * 보관 상한(`COMMISSION_STOCK_CAP` = 12)이 차면 **새 의뢰서가 발령되지 않는다**
 * (`issue_commission_for_run` 4단계). 그런데 상한을 내리는 방법이 지금까지 **출격 하나뿐**이었다 —
 * 원치 않는 저계급 의뢰가 12칸을 물면 보스를 아무리 잡아도 아무것도 안 들어오고, 발령은 예외도
 * 알림도 없이 **조용히 스킵**되므로 화면 어디에도 이유가 안 적힌다.
 *
 * ## 여기서 잠그는 것
 * 폐기는 **되돌릴 수 없는 유일한 플레이어 조작**이라 단위 테스트가 볼 수 있는 축을 전부 본다:
 * ①SQL↔TS 상수 미러 ②마이그레이션이 실제로 세우는 것(감사 테이블·RLS·grant·잠금 순서)
 * ③클라 배선(확인 팝업을 통과해야만 부른다 · 성공해도 목록을 손으로 깎지 않는다).
 *
 * ⚠️ **원격 DB 를 부르지 않는다.** 이 스위트는 오프라인이고, 여기서 볼 수 있는 것은 "무엇을
 * 적었는가"뿐이다. 실제 거동은 적용 스크립트의 사후 조건(실호출 프로브)이 본다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CAP_DISCARD_PER_HOUR,
  COMMISSION_STOCK_CAP,
} from '../src/run/commissionServerConstants.js';

const read = (rel: string): string =>
  new TextDecoder().decode(readFileSync(fileURLToPath(new URL(rel, import.meta.url))));

const SQL = read('../supabase/migrations/20260803010000_commission_discard.sql');
const DESK = read('../src/ui/pixi/commissionDesk.ts');
const NET = read('../src/net/index.ts');
const GATEWAY = read('../src/net/commissionGateway.ts');

describe('SQL ↔ TS 상수 미러', () => {
  it('CAP_DISCARD_PER_HOUR 이 마이그레이션과 같은 값이다', () => {
    // 같은 수치의 정본이 둘이 되는 것이 이 저장소의 지배적 실패 모드다 — 미러가 갈리면
    // 클라는 "30번까지 된다"고 믿고 서버는 다른 수에서 거부한다.
    const m = /CAP_DISCARD_PER_HOUR constant int := (\d+);/.exec(SQL);
    expect(m, 'SQL 에서 CAP_DISCARD_PER_HOUR 선언을 못 찾았다').not.toBeNull();
    expect(Number(m?.[1])).toBe(CAP_DISCARD_PER_HOUR);
  });

  it('상한이 보관 상한을 여유 있게 넘는다(정직한 사용자가 닿지 않는다)', () => {
    // 재고를 통째로 비우는 것이 시간당 상한에 걸리면 기능이 그 자리에서 무의미해진다.
    expect(CAP_DISCARD_PER_HOUR).toBeGreaterThan(COMMISSION_STOCK_CAP * 2);
  });
});

describe('마이그레이션이 세우는 것', () => {
  it('감사 테이블을 만들고 payload 를 통째로 남긴다', () => {
    // 폐기는 되돌릴 수 없다 — "의뢰서가 사라졌다"는 문의에 답할 근거가 서버에 없으면 안 된다.
    expect(SQL).toMatch(/create table if not exists public\.commission_discards/);
    expect(SQL).toMatch(/payload\s+jsonb not null/);
  });

  it('감사 테이블에 RLS 를 켜고 **select-own 정책만** 둔다', () => {
    // 정책이 없는 동작은 RLS 아래에서 통째로 거부된다 — 쓰기를 정책 부재로 막는 것이 계약이다.
    expect(SQL).toMatch(/alter table public\.commission_discards enable row level security/);
    expect(SQL).toMatch(/create policy commission_discards_select_own[\s\S]*?for select to authenticated/);
    expect(SQL).not.toMatch(/create policy[^;]*commission_discards[^;]*for (insert|update|delete)/);
    // 클라에 테이블 쓰기 권한을 주지 않는다.
    expect(SQL).toMatch(/grant select on table public\.commission_discards to authenticated/);
    expect(SQL).not.toMatch(/grant (insert|update|delete)[^;]*commission_discards/);
  });

  it('RPC 가 SECURITY DEFINER + search_path 고정 + auth.uid() 스코프다', () => {
    const fn = SQL.slice(SQL.indexOf('create or replace function public.discard_commission'));
    expect(fn).toMatch(/security definer/);
    expect(fn).toMatch(/set search_path = ''/);
    expect(fn).toMatch(/v_me\s+uuid := auth\.uid\(\)/);
    // 남의 행을 지울 수 없다 — 조회 조건에 profile_id 가 반드시 있어야 한다.
    expect(fn).toMatch(/from public\.commission_inventory[\s\S]*?profile_id = v_me/);
  });

  it('출격과 **같은 잠금 순서**를 쓴다(한 장으로 둘 다는 성립하지 않는다)', () => {
    // `consume_commission` 도 commission_inventory 1행만 `for update` 한다. 순서가 같아야
    // 두 RPC 가 같은 행을 노렸을 때 한쪽이 먼저 지우고 다른 쪽이 not found 로 떨어진다.
    const fn = SQL.slice(SQL.indexOf('create or replace function public.discard_commission'));
    const lock = fn.indexOf('for update');
    const del = fn.indexOf('delete from public.commission_inventory');
    expect(lock, 'for update 가 없다').toBeGreaterThan(-1);
    expect(del).toBeGreaterThan(lock);
    // 없으면 **명시 거부**다 — 조용한 no-op 은 "이미 출격했다"와 "남의 것이다"를 뭉갠다.
    expect(fn).toMatch(/if not found then[\s\S]{0,300}?raise exception/);
  });

  it('anon 에게서 실행 권한을 회수하고 authenticated 에만 준다', () => {
    expect(SQL).toMatch(/revoke all on function public\.discard_commission\(uuid\) from anon/);
    expect(SQL).toMatch(
      /grant execute on function public\.discard_commission\(uuid\) to authenticated, service_role/,
    );
  });

  it('감사 로그가 무한히 쌓이지 않는다(보존 cron)', () => {
    expect(SQL).toMatch(/cron\.schedule\(\s*'planet-blitz-gc-commission-discards'/);
    // pg_cron 은 `set search_path=''` 규율 밖이라 테이블을 public. 으로 수식해야 한다.
    expect(SQL).toMatch(/delete from public\.commission_discards/);
  });
});

describe('클라 배선 — 되돌릴 수 없는 조작의 규율', () => {
  it('폐기 버튼은 바로 지우지 않고 **확인 팝업**을 연다', () => {
    // 버튼 onClick 에서 곧장 discard 를 부르면 오클릭 한 번으로 의뢰서가 사라진다.
    expect(DESK).toMatch(/label: t\('commission\.discard'\)[\s\S]{0,200}?openDiscardConfirm\(row\)/);
    const btn = DESK.slice(DESK.indexOf("label: t('commission.discard')"), DESK.indexOf('discard.container.position'));
    expect(btn, '폐기 버튼이 확인 없이 discard 를 부른다').not.toMatch(/this\.discard\(row\)/);
  });

  it('확정 버튼에서만 실제 폐기가 나간다', () => {
    const modal = DESK.slice(
      DESK.indexOf('private openDiscardConfirm('),
      DESK.indexOf('private closeDiscardConfirm('),
    );
    expect(modal).toMatch(/label: t\('commission\.discard\.confirm'\)[\s\S]{0,300}?void this\.discard\(row\)/);
    // 취소는 닫기만 한다.
    const cancel = modal.slice(
      modal.indexOf("label: t('commission.discard.cancel')"),
      modal.indexOf("label: t('commission.discard.confirm')"),
    );
    expect(cancel).toContain('closeDiscardConfirm()');
    expect(cancel).not.toContain('this.discard(');
  });

  it('팝업 암막이 불투명하고 이벤트를 먹으며 패널 탭은 전파를 끊는다', () => {
    // `modal.ts` 헤더가 실측으로 남긴 규칙 셋. 하나라도 빠지면 뒤 목록이 계속 눌리거나
    // 패널을 눌러도 팝업이 닫힌다.
    const modal = DESK.slice(
      DESK.indexOf('private openDiscardConfirm('),
      DESK.indexOf('private closeDiscardConfirm('),
    );
    expect(modal).toMatch(/alpha: 0\.99/);
    expect(modal).toMatch(/scrim\.eventMode = 'static'/);
    expect(modal).toMatch(/stopRowPropagation\(panel\.container\)/);
  });

  it('폐기 성공 뒤 목록을 손으로 깎지 않고 **원장을 다시 읽는다**', () => {
    const fn = DESK.slice(
      DESK.indexOf('private async discard('),
      DESK.indexOf('// --- 폐기 확인 팝업'),
    );
    expect(fn).toContain('void this.refreshInventory()');
    // 감산하면 서버와 갈리는 두 번째 진실이 생긴다.
    expect(fn).not.toMatch(/this\.inventory\s*=\s*this\.inventory\.filter/);
    expect(fn).not.toMatch(/this\.inventory\.splice/);
    // 출격과 같은 재진입 가드를 공유한다.
    expect(fn.indexOf('if (this.busy) return;')).toBeGreaterThan(-1);
    expect(fn.indexOf('if (this.busy) return;')).toBeLessThan(fn.indexOf('this.busy = true'));
  });

  it('거부돼도 원장을 다시 읽는다("의뢰서 없음"은 곧 유령 행이라는 뜻이다)', () => {
    const fn = DESK.slice(
      DESK.indexOf('private async discard('),
      DESK.indexOf('// --- 폐기 확인 팝업'),
    );
    // finally 안에 있어야 성공·실패 양쪽을 덮는다.
    const fin = fn.slice(fn.indexOf('} finally {'));
    expect(fin).toContain('refreshInventory()');
  });

  it('net 래퍼가 절대 throw 하지 않고 미설정을 따로 말한다', () => {
    const fn = NET.slice(
      NET.indexOf('export async function discardCommissionOnServer('),
      NET.indexOf("* `markCommissionActiveOnServer` 결과"),
    );
    expect(fn).toMatch(/return \{ status: 'unconfigured' \}/);
    expect(fn).toMatch(/catch \(err\)[\s\S]{0,120}?status: 'rejected'/);
  });

  it('게이트웨이가 RPC 이름·인자를 그대로 쓴다', () => {
    expect(GATEWAY).toMatch(/rpc\('discard_commission', \{\s*p_commission_id: commissionId,/);
  });
});
