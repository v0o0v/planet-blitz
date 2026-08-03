/**
 * 의뢰 **확정 경험치**(`commissionXpReward`) — 2026-08-03 신설.
 *
 * ## 왜 payload 에 필드를 두지 않고 파생으로 두는가
 * 확정 보상의 계약은 "발령 시점에 굳는다"이지 "jsonb 에 적혀 있다"가 아니다. 이 값은 이미
 * 굳어 있는 `segments`(행성·단계)와 `grade` **만의 순수 함수**라 발령 시점에 함께 굳고,
 * 클라·서버가 같은 소스를 읽으므로 갈릴 수 없다. 그래서 여기서 잠그는 것은 "필드가 있는가"가
 * 아니라 **"봉인된 입력 말고는 아무것도 안 본다"** 와 **"축이 뒤집히지 않는다"** 둘이다.
 *
 * ## 이 기능이 닫는 구멍
 * 의뢰 런도 `settleRun` 을 타므로 런 안에서 번 XP 는 이미 들어온다. 그런데 **정예 소집령**은
 * ADR-0043 으로 젬 드랍이 0 이고(`commissionSuppressesGems`), 메타 XP 는 젬 획득에서만 누적된다
 * (`src/sim/world.ts` — `state.xpTotal += …` 는 젬 수집 경로 안에 있다). 즉 **계급이 가장 높은
 * 주문이 진행에 기여를 하나도 못 하는 역전**이 있었다. 확정 경험치는 종이에 적힌 값이라 런
 * 안에서 무엇이 꺼져 있든 지급된다 — 그 역전을 닫는 것이 이 축의 존재 이유다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  commissionXpReward,
  COMMISSION_XP_GRADE_PERMILLE,
} from '../src/run/commissionConstants.js';
import { metaXpPerRun } from '../src/save/progressionPath.js';
import { COMMISSION_ORDERS, type CommissionGrade } from '../src/run/commission.js';

const GRADES: readonly CommissionGrade[] = [1, 2, 3, 4];

function paper(grade: CommissionGrade, stages: readonly number[]) {
  return { grade, segments: stages.map((stage) => ({ planet: 0, stage })) };
}

describe('commissionXpReward — 봉인된 payload 만의 순수 파생', () => {
  it('계급 1·1구간은 그 단계를 한 번 정직하게 돈 값이다', () => {
    // 기준선을 `metaXpPerRun` 에 묶는 것이 이 축의 설계다 — 별도 표를 두면 진행 곡선(ADR-0035)을
    // 손볼 때 의뢰 보상만 조용히 뒤처진다(이 저장소의 지배적 실패 모드).
    expect(COMMISSION_XP_GRADE_PERMILLE[1]).toBe(1000);
    for (const stage of [1, 3, 7, 12, 20]) {
      expect(commissionXpReward(paper(1, [stage]))).toBe(metaXpPerRun(stage));
    }
  });

  it('구간이 늘면 그만큼 늘어난다(합산 — 별도 표가 아니다)', () => {
    const one = commissionXpReward(paper(1, [5]));
    const three = commissionXpReward(paper(1, [5, 5, 5]));
    expect(three).toBe(one * 3);
    // 서로 다른 단계가 섞이면 각자의 기준선을 더한다.
    expect(commissionXpReward(paper(1, [2, 9]))).toBe(metaXpPerRun(2) + metaXpPerRun(9));
  });

  it('계급이 오르면 **엄격히** 커진다(표가 뒤집히거나 평평해지면 깨진다)', () => {
    const stages = [4, 4, 4];
    let prev = 0;
    for (const g of GRADES) {
      const v = commissionXpReward(paper(g, stages));
      expect(v, `계급 ${g} 가 ${g - 1} 이하다`).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('단계가 오르면 **엄격히** 커진다', () => {
    let prev = 0;
    for (const stage of [1, 2, 5, 10, 20]) {
      const v = commissionXpReward(paper(3, [stage]));
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('계급 배율표가 4계급을 빠짐없이 덮고 1.0 아래로 내려가지 않는다', () => {
    for (const g of GRADES) {
      const p = COMMISSION_XP_GRADE_PERMILLE[g];
      expect(p, `계급 ${g} 배율 누락`).toBeTypeOf('number');
      expect(p).toBeGreaterThanOrEqual(1000);
    }
    expect(Object.keys(COMMISSION_XP_GRADE_PERMILLE)).toHaveLength(GRADES.length);
  });

  it('주문 종류를 보지 않는다 — **정예 소집령도 반드시 0 보다 크다**', () => {
    // 이 축이 존재하는 이유 자체다. 젬이 0 인 주문에서 확정 경험치까지 0 이면 최고 계급 의뢰가
    // 진행에 기여를 하나도 못 한다. 함수가 `order` 를 아예 안 받는 것이 그 보장이다.
    expect(commissionXpReward).toHaveLength(1);
    expect(COMMISSION_ORDERS).toContain('elite');
    for (const g of GRADES) {
      expect(commissionXpReward(paper(g, [1]))).toBeGreaterThan(0);
    }
  });

  it('정수를 낸다(레벨 곡선이 정수 XP 를 전제한다)', () => {
    for (const g of GRADES) {
      for (const stages of [[1], [3, 3], [7, 11, 2, 19]]) {
        const v = commissionXpReward(paper(g, stages));
        expect(Number.isInteger(v), `계급 ${g} / ${stages.join(',')} 가 정수가 아니다`).toBe(true);
      }
    }
  });

  it('같은 입력에 항상 같은 값(발령 시점에 굳는다는 계약)', () => {
    const p = paper(4, [3, 6, 9, 12, 15]);
    const first = commissionXpReward(p);
    for (let i = 0; i < 5; i++) expect(commissionXpReward(p)).toBe(first);
  });
});

describe('배선 — 확정 경험치가 실제로 지급되는 자리', () => {
  const main = new TextDecoder().decode(
    readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url))),
  );

  it('종이를 runId 와 **같은 자리에서** 세우고 같은 자리에서 지운다', () => {
    // 둘이 갈리면 "런 id 는 있는데 종이가 없다"가 되어 경험치만 조용히 증발한다 — 재화는
    // 서버가 잔액을 돌려주므로 증상이 XP 하나뿐이라 눈에 안 띈다.
    expect(main).toMatch(/commissionRunId = runId;[\s\S]{0,400}?commissionPayload = payload;/);
    expect(main).toMatch(/commissionRunId = null;\s*\r?\n\s*commissionPayload = null;/);
  });

  it('서버가 **승인한 뒤에만** 적립한다', () => {
    const fn = main.slice(
      main.indexOf('async function submitCommissionReplay('),
      main.indexOf('/** Settle a finished run into the profile once'),
    );
    expect(fn.length).toBeGreaterThan(0);
    const verified = fn.indexOf("res.status === 'verified'");
    const grant = fn.indexOf('grantXp(activeShip(profile)');
    expect(verified, "verified 분기를 못 찾았다").toBeGreaterThan(-1);
    expect(grant, 'grantXp 호출이 없다').toBeGreaterThan(-1);
    expect(grant, '승인 분기 밖에서 적립한다').toBeGreaterThan(verified);
    // 거부/큐 분기보다 앞이어야 한다(= verified 블록 안이다).
    expect(grant).toBeLessThan(fn.indexOf("res.status === 'rejected'"));
    // 레벨업분은 스킬포인트로 이어진다(일반 정산과 같은 계약).
    expect(fn).toContain('profile.skillPoints += xpLevels');
    // 적립 뒤에 저장한다 — 순서가 뒤집히면 XP 가 다음 부팅에서 사라진다.
    expect(fn.indexOf('saveProfile(profile)')).toBeGreaterThan(grant);
  });
});
