/**
 * 스킬 사슬 선행 조건 (ADR-0047).
 *
 * 사슬 = **한 계열 안에서 `stat` 이 같은 base 노드들**, 티어 오름차순. `(계열, 스탯)` 파생이라
 * 노드 데이터는 한 줄도 안 바뀌었고, 규칙은 **투자 시점에만** 산다 — `computeSkillStats`·sim·
 * 서버 EF 는 이 규칙을 모른다. 이 파일이 지키는 축은 넷이다:
 *
 *   ① 사슬 파생이 계열을 넘지 않는다(같은 스탯이 두 계열에 있어도 서로 다른 사슬)
 *   ② 티어 구멍은 건너뛰고, 단독 노드는 조건 없이 열리고, 한 티어에 둘이면 둘 다 걸린다
 *   ③ `investSkill` 이 유일한 관문이다(캡스톤은 사슬 밖 — 기존 누적 게이트만 본다)
 *   ④ **파생은 불변** — 사슬을 위반한 벡터도 `computeSkillStats` 는 그대로 접는다
 */

import { describe, it, expect } from 'vitest';
import {
  SKILLS,
  NODES_PER_TREE,
  FIREPOWER_CAPSTONE,
  SURVIVAL_CAPSTONE,
  MOBILITY_CAPSTONE,
} from '../data/skills.js';
import {
  SHIP_TYPES,
  shipTypeDef,
  flattenShipNodes,
  zeroSkillInvest,
} from '../data/ships/index.js';
import {
  chainMissingPrereqs,
  chainPrereqMet,
  computeSkillStats,
} from '../src/items/skills.js';
import { standardSkillInvest } from '../src/bench/standardBuild.js';
import { defaultProfile, investSkill, activeShip } from '../src/save/profile.js';

const STRIKER = shipTypeDef(0);

/** 스트라이커 flat 인덱스를 이름으로 찾는다(테스트가 매직 넘버를 안 쓰게). */
function idx(name: string): number {
  const i = SKILLS.findIndex((n) => n.name === name);
  if (i < 0) throw new Error(`노드 없음: ${name}`);
  return i;
}

/** 그 노드를 max 까지 채운 벡터를 만든다(여러 개 지정 가능). */
function investedTo(...names: string[]): number[] {
  const v = zeroSkillInvest(0);
  for (const n of names) {
    const i = idx(n);
    v[i] = SKILLS[i]!.maxPoints;
  }
  return v;
}

describe('사슬 파생 — 계열 안, 같은 스탯, 티어 오름차순 (ADR-0047 ①)', () => {
  it('티어 0 노드는 선행 조건이 없다', () => {
    const v = zeroSkillInvest(0);
    for (const name of ['집중 사격', '정밀 조준', '속사 훈련', '탄속 개량']) {
      expect(chainMissingPrereqs(v, STRIKER, idx(name)), name).toEqual([]);
    }
  });

  it('한 티어에 같은 스탯 노드가 둘이면 둘 다 걸린다 (화력 damagePct t0)', () => {
    // 강화 탄두(damagePct t1)는 집중 사격 + 정밀 조준(둘 다 damagePct t0)을 요구한다.
    const empty = zeroSkillInvest(0);
    expect(chainMissingPrereqs(empty, STRIKER, idx('강화 탄두'))).toEqual([
      idx('집중 사격'),
      idx('정밀 조준'),
    ]);
    // 하나만 채우면 나머지 하나가 남는다 — "아무거나 하나"가 아니다.
    const half = investedTo('집중 사격');
    expect(chainMissingPrereqs(half, STRIKER, idx('강화 탄두'))).toEqual([idx('정밀 조준')]);
    // 둘 다 채우면 열린다.
    const full = investedTo('집중 사격', '정밀 조준');
    expect(chainPrereqMet(full, STRIKER, idx('강화 탄두'))).toBe(true);
  });

  it('max 미만은 통과시키지 않는다 — "1점이라도 찍었으면 OK"가 아니다', () => {
    // ⚠️ 이 테스트는 두 함수를 **둘 다** 겨냥해야 한다. 한쪽만 보면 `< maxPoints` 를
    // `< 1`(= 1점 이상이면 통과)로 바꾸는 뮤테이션이 다른 쪽에서 살아남는다 — 실제로
    // 뮤테이션 검증에서 그 틈이 드러나 이 단언 쌍을 추가했다.
    const v = investedTo('집중 사격', '정밀 조준');
    v[idx('정밀 조준')] = SKILLS[idx('정밀 조준')]!.maxPoints - 1;
    expect(chainPrereqMet(v, STRIKER, idx('강화 탄두'))).toBe(false);
    expect(chainMissingPrereqs(v, STRIKER, idx('강화 탄두'))).toEqual([idx('정밀 조준')]);

    // 1점만 찍은 상태도 똑같이 잠겨 있어야 한다(0 과 max 사이 전 구간).
    const one = zeroSkillInvest(0);
    one[idx('집중 사격')] = 1;
    one[idx('정밀 조준')] = 1;
    expect(chainPrereqMet(one, STRIKER, idx('강화 탄두'))).toBe(false);
    expect(chainMissingPrereqs(one, STRIKER, idx('강화 탄두'))).toEqual([
      idx('집중 사격'),
      idx('정밀 조준'),
    ]);
  });

  it('사슬은 계열을 넘지 않는다 — 이동 속도는 생존·기동에 따로 산다', () => {
    // 기동 t1 '가속 추진'(moveSpeedPct)의 선행은 **기동** t0 둘뿐이고,
    // 생존 t0 '기민한 조종'(같은 moveSpeedPct)은 조건이 아니다.
    const v = zeroSkillInvest(0);
    const missing = chainMissingPrereqs(v, STRIKER, idx('가속 추진'));
    expect(missing).toEqual([idx('추진기 조율'), idx('경량 프레임')]);
    expect(missing).not.toContain(idx('기민한 조종'));
    // 기동 t0 둘만 채우면 열린다 — 생존 쪽은 0 인 채로.
    const mob = investedTo('추진기 조율', '경량 프레임');
    expect(chainPrereqMet(mob, STRIKER, idx('가속 추진'))).toBe(true);
  });

  it('티어에 구멍이 있으면 건너뛴다 (화력 pierce: t1·t3·t4, t2 없음)', () => {
    // '관통 강화'(pierce t3)의 선행은 '관통 코어'(pierce t1) 하나뿐 — t2 에는 pierce 가 없다.
    expect(chainMissingPrereqs(zeroSkillInvest(0), STRIKER, idx('관통 강화'))).toEqual([
      idx('관통 코어'),
    ]);
    expect(chainPrereqMet(investedTo('관통 코어'), STRIKER, idx('관통 강화'))).toBe(true);
    // t4 '궤멸 관통'은 t1·t3 둘 다 요구한다(사슬 전체가 대상 — 바로 아랫 칸만이 아니다).
    expect(chainMissingPrereqs(investedTo('관통 코어'), STRIKER, idx('궤멸 관통'))).toEqual([
      idx('관통 강화'),
    ]);
  });

  it('노드가 하나뿐인 사슬은 조건 없이 열린다 (화력 rangeFlat)', () => {
    const range = SKILLS.filter((n) => n.tree === 'firepower' && n.stat === 'rangeFlat');
    expect(range).toHaveLength(1); // 전제가 깨지면 이 테스트의 의미가 사라지므로 못 박는다
    expect(chainMissingPrereqs(zeroSkillInvest(0), STRIKER, idx('사거리 연장'))).toEqual([]);
  });

  it('캡스톤은 사슬 밖이다 — stat 자리표시자에 끌려가지 않는다', () => {
    // 캡스톤 3종은 전부 stat 이 자리표시자 'damagePct' 다. 사슬에 편입되면 기동 캡스톤이
    // damagePct 노드가 하나도 없는 계열에서 엉뚱한 사슬에 붙는다.
    const empty = zeroSkillInvest(0);
    for (const c of [FIREPOWER_CAPSTONE, SURVIVAL_CAPSTONE, MOBILITY_CAPSTONE]) {
      expect(chainMissingPrereqs(empty, STRIKER, c)).toEqual([]);
      expect(chainPrereqMet(empty, STRIKER, c)).toBe(true);
    }
  });

  it('범위 밖 인덱스는 조건 없음으로 취급한다(손상 방어)', () => {
    const v = zeroSkillInvest(0);
    expect(chainMissingPrereqs(v, STRIKER, -1)).toEqual([]);
    expect(chainMissingPrereqs(v, STRIKER, 9999)).toEqual([]);
    expect(chainPrereqMet(v, STRIKER, 9999)).toBe(true);
  });

  it('두 함수는 항상 같은 답을 낸다 — 전 기체·전 노드 교차 검증', () => {
    for (let t = 0; t < SHIP_TYPES.length; t++) {
      const def = shipTypeDef(t);
      const v = standardSkillInvest(t, 100);
      const n = flattenShipNodes(def).length;
      for (let i = 0; i < n; i++) {
        expect(chainPrereqMet(v, def, i), `타입 ${t} 노드 ${i}`).toBe(
          chainMissingPrereqs(v, def, i).length === 0,
        );
      }
    }
  });
});

describe('투자 관문 — investSkill 이 유일한 자리 (ADR-0047 ③)', () => {
  it('포인트가 넉넉해도 사슬이 잠겨 있으면 거부한다', () => {
    const p = defaultProfile();
    p.skillPoints = 99;
    // 강화 탄두(damagePct t1) 는 t0 둘이 max 여야 한다.
    expect(investSkill(p, idx('강화 탄두'))).toBe(false);
    expect(p.skillPoints).toBe(99); // 거부는 포인트를 먹지 않는다
    expect(activeShip(p).skillInvest[idx('강화 탄두')]).toBe(0);
  });

  it('선행을 채우면 그 즉시 열린다', () => {
    const p = defaultProfile();
    p.skillPoints = 99;
    for (const name of ['집중 사격', '정밀 조준']) {
      for (let i = 0; i < SKILLS[idx(name)]!.maxPoints; i++) {
        expect(investSkill(p, idx(name)), name).toBe(true);
      }
    }
    expect(investSkill(p, idx('강화 탄두'))).toBe(true);
    expect(activeShip(p).skillInvest[idx('강화 탄두')]).toBe(1);
  });

  it('선행 하나가 1점 모자라면 여전히 거부한다', () => {
    const p = defaultForOneShyOfPrereq();
    expect(investSkill(p, idx('강화 탄두'))).toBe(false);
  });

  it('캡스톤은 사슬이 아니라 기존 누적 게이트로만 열린다', () => {
    const p = defaultProfile();
    p.skillPoints = 99;
    // 게이트 미달이면 거부(사슬과 무관하게 기존 규칙).
    expect(investSkill(p, FIREPOWER_CAPSTONE)).toBe(false);
    // 화력 base 를 게이트(40)까지 **사슬을 지키며** 채운다: 티어 오름차순 앞채우기.
    const invest = activeShip(p).skillInvest;
    let spent = 0;
    for (let i = 0; i < NODES_PER_TREE && spent < STRIKER.capstoneGate; i++) {
      const max = SKILLS[i]!.maxPoints;
      for (let k = 0; k < max && spent < STRIKER.capstoneGate; k++) {
        expect(investSkill(p, i), `노드 ${i}`).toBe(true);
        spent++;
      }
    }
    expect(invest.slice(0, NODES_PER_TREE).reduce((a, b) => a + b, 0)).toBe(
      STRIKER.capstoneGate,
    );
    expect(investSkill(p, FIREPOWER_CAPSTONE)).toBe(true);
  });
});

/** 선행 노드 하나가 정확히 1점 모자란 프로필. */
function defaultForOneShyOfPrereq() {
  const p = defaultProfile();
  p.skillPoints = 99;
  for (const name of ['집중 사격', '정밀 조준']) {
    for (let i = 0; i < SKILLS[idx(name)]!.maxPoints; i++) investSkill(p, idx(name));
  }
  // 규칙 밖에서 1점을 뺀다(연구소 경로로는 만들 수 없는 상태 — 게이트가 raw 값을 보는지 확인).
  activeShip(p).skillInvest[idx('정밀 조준')] = SKILLS[idx('정밀 조준')]!.maxPoints - 1;
  return p;
}

describe('벤치·파생 불변 (ADR-0047 ④)', () => {
  it('standardBuild 의 앞채우기 벡터는 전 기체·전 레벨에서 합법이다', () => {
    // flat 순서 = 티어 오름차순이라 앞채우기는 구조적으로 사슬을 어길 수 없다. 이게 깨지면
    // 밸런스 벤치의 골든이 "위반 벡터"로 만들어진 것이 되므로 즉시 알아야 한다.
    for (let t = 0; t < SHIP_TYPES.length; t++) {
      const def = shipTypeDef(t);
      const n = flattenShipNodes(def).length;
      for (const level of [1, 25, 50, 75, 100]) {
        const v = standardSkillInvest(t, level);
        for (let i = 0; i < n; i++) {
          if ((v[i] ?? 0) === 0) continue; // 안 찍은 칸은 규칙 대상이 아니다
          expect(chainPrereqMet(v, def, i), `타입 ${t} lv${level} 노드 ${i}`).toBe(true);
        }
      }
    }
  });

  it('사슬을 위반한 벡터도 파생 스탯은 그대로 접는다(규칙은 투자 시점 전용)', () => {
    // 서버 EF 가 공유하는 순수 함수에 규칙을 넣지 않았다는 물증. 넣었다면 아래 두 값이 갈린다.
    const illegal = zeroSkillInvest(0);
    illegal[idx('초토화 프로토콜')] = 5; // t0~t3 을 하나도 안 찍고 t4 만
    const stats = computeSkillStats(illegal, 0);
    expect(stats.damagePct).toBeGreaterThan(0);

    const legalSame = zeroSkillInvest(0);
    legalSame[idx('초토화 프로토콜')] = 5;
    expect(computeSkillStats(legalSame, 0)).toEqual(stats);
  });
});
