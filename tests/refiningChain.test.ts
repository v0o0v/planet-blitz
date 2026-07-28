import { describe, it, expect } from 'vitest';
import { rollItem, reforgeAffixes } from '../src/items/roll.js';
import type { Item, ItemSource } from '../src/items/types.js';
import { openChain, fasten, rollChain, isComplete } from '../src/items/refiningChain.js';
import { HEAT, HEATS, meltRisk, type Heat } from '../data/economy.js';

const SRC: ItemSource = { planet: 0, stage: 1 };

/** 어픽스가 넉넉한 레어 하나(공정 커버리지용). */
function rareWithAffixes(seed: number, min = 3): Item {
  for (let s = seed; s < seed + 500; s++) {
    const it = rollItem(s, 'rare', SRC);
    if (it.affixes.length >= min) return it;
  }
  throw new Error(`어픽스 ${min}개 이상인 레어를 찾지 못했다`);
}

/** 어픽스 개수가 정확히 n 인 레어(완주 테스트용 — 적을수록 고착 단계가 짧다). */
function rareWithExactly(seed: number, n: number): Item {
  for (let s = seed; s < seed + 5000; s++) {
    const it = rollItem(s, 'rare', SRC);
    if (it.affixes.length === n) return it;
  }
  throw new Error(`어픽스 정확히 ${n}개인 레어를 찾지 못했다`);
}

/** 굴림 1회(용해 없음) — riskRoll = 1 은 어떤 위험보다도 크다(위험 상한 0.95). */
function rollSafe(s: ReturnType<typeof openChain>, heat: Heat, seed: number) {
  return rollChain(s, heat, seed, 1);
}

describe('정련 공정 상태기계(ADR-0040)', () => {
  describe('openChain', () => {
    it('굴리기 전에는 고착할 수 없다', () => {
      const item = rareWithAffixes(1000);
      const s = openChain(item);
      expect(s.canFasten).toBe(false);
      expect(s.fastened).toEqual([]);
      expect(s.baseline).toBe(item);
      expect(s.current).toBe(item);
    });

    it('굴리기 전 fasten 은 무시된다(예외 아님)', () => {
      const s = openChain(rareWithAffixes(1001));
      expect(fasten(s, 0)).toBe(s);
    });
  });

  describe('fasten — 굴림당 1개, 해제 불가', () => {
    it('연속 fasten 두 번 → 두 번째는 무시된다', () => {
      const item = rareWithAffixes(2000);
      const after = rollSafe(openChain(item), 'mid', 11).next;
      const one = fasten(after, 0);
      expect(one.fastened).toEqual([0]);
      expect(one.canFasten).toBe(false);
      const two = fasten(one, 1);
      expect(two).toBe(one);
      expect(two.fastened).toEqual([0]);
    });

    it('이미 고착된 인덱스에 다시 fasten → 무시(해제되지 않는다)', () => {
      const item = rareWithAffixes(2001);
      let s = rollSafe(openChain(item), 'mid', 12).next;
      s = fasten(s, 1);
      s = rollSafe(s, 'mid', 13).next;
      const again = fasten(s, 1);
      expect(again).toBe(s);
      expect(again.fastened).toEqual([1]);
    });

    it('범위 밖·비정수 인덱스 → 무시(예외 아님)', () => {
      const item = rareWithAffixes(2002);
      const s = rollSafe(openChain(item), 'mid', 14).next;
      const n = item.affixes.length;
      for (const bad of [-1, n, n + 10, 0.5, NaN, Infinity]) {
        expect(fasten(s, bad)).toBe(s);
      }
      expect(s.fastened).toEqual([]);
    });

    it('고착 인덱스는 오름차순으로 유지된다', () => {
      const item = rareWithAffixes(2003, 4);
      let s = rollSafe(openChain(item), 'mid', 21).next;
      s = fasten(s, 2);
      s = rollSafe(s, 'mid', 22).next;
      s = fasten(s, 0);
      expect(s.fastened).toEqual([0, 2]);
    });
  });

  describe('rollChain — 용해', () => {
    it('riskRoll 이 위험보다 작으면 용해: baseline 복귀 · 고착 전량 소실 · 고착 불가', () => {
      const item = rareWithAffixes(3000);
      let s = rollSafe(openChain(item), 'mid', 31).next;
      s = fasten(s, 0);
      const risk = meltRisk(s.fastened.length, item.affixes.length, 'mid');
      expect(risk).toBeGreaterThan(0);

      const out = rollChain(s, 'mid', 32, 0);
      expect(out.melted).toBe(true);
      expect(out.complete).toBe(false);
      expect(out.next.current).toEqual(item);
      expect(out.next.current.affixes).toEqual(item.affixes);
      expect(out.next.fastened).toEqual([]);
      expect(out.next.canFasten).toBe(false);
      expect(out.next.baseline).toBe(item);
    });

    it('용해는 재단조를 아예 하지 않는다 — 같은 시드의 성공 굴림과 결과가 다르다', () => {
      const item = rareWithAffixes(3001);
      let s = rollSafe(openChain(item), 'mid', 41).next;
      s = fasten(s, 0);
      const melted = rollChain(s, 'mid', 42, 0);
      const survived = rollChain(s, 'mid', 42, 1);
      expect(melted.next.current.affixes).toEqual(item.affixes);
      expect(survived.next.current.affixes).not.toEqual(melted.next.current.affixes);
    });

    it('고착 0개면 어떤 heat·riskRoll 로도 절대 용해하지 않는다(riskRoll = 0 경계 포함)', () => {
      const item = rareWithAffixes(3002);
      const s = openChain(item);
      for (const heat of HEATS) {
        expect(meltRisk(0, item.affixes.length, heat)).toBe(0);
        for (const riskRoll of [0, 1e-12, 0.5, 0.999999]) {
          const out = rollChain(s, heat, 55, riskRoll);
          expect(out.melted, `heat=${heat} riskRoll=${riskRoll} 에서 용해했다`).toBe(false);
        }
      }
    });

    it('고착 0개 굴림을 반복해도 용해가 없다(구 단발 리롤과 동일한 하위 호환 경로)', () => {
      const item = rareWithAffixes(3003);
      let s = openChain(item);
      for (let i = 0; i < 20; i++) {
        const out = rollChain(s, 'high', 100 + i, 0);
        expect(out.melted).toBe(false);
        s = out.next;
        expect(s.fastened).toEqual([]);
      }
    });
  });

  describe('rollChain — 성공', () => {
    it('굴린 뒤 고착이 열린다', () => {
      const item = rareWithAffixes(4000);
      const out = rollSafe(openChain(item), 'mid', 61);
      expect(out.melted).toBe(false);
      expect(out.next.canFasten).toBe(true);
    });

    it('고착한 어픽스는 이후 굴림에서 값·인덱스가 불변이다', () => {
      const item = rareWithAffixes(4001, 4);
      let s = rollSafe(openChain(item), 'mid', 71).next;
      s = fasten(s, 1);
      const kept = s.current.affixes[1]!;
      for (let i = 0; i < 6; i++) {
        s = rollChain(s, 'high', 200 + i, 1).next;
        expect(s.current.affixes[1]).toEqual(kept);
        expect(s.current.affixes).toHaveLength(item.affixes.length);
      }
    });

    it('재추첨 대상은 baseline 이 아니라 current 다(고착 값이 current 에 산다)', () => {
      const item = rareWithAffixes(4002, 4);
      let s = rollSafe(openChain(item), 'mid', 81).next;
      s = fasten(s, 0);
      const kept = s.current.affixes[0]!;
      // baseline 의 0번과 다른 값을 고착했다면, 이후 굴림에도 baseline 값이 아니라 고착값이 남는다.
      s = rollChain(s, 'mid', 82, 1).next;
      expect(s.current.affixes[0]).toEqual(kept);
      expect(s.baseline.affixes).toEqual(item.affixes);
    });

    it('어픽스 개수와 비-어픽스 필드는 전 굴림에서 보존된다', () => {
      const item = rareWithAffixes(4003);
      let s = openChain(item);
      for (const heat of HEATS) {
        s = rollChain(s, heat, 300, 1).next;
        expect(s.current.affixes).toHaveLength(item.affixes.length);
        expect(s.current.id).toBe(item.id);
        expect(s.current.slot).toBe(item.slot);
        expect(s.current.rarity).toBe(item.rarity);
        expect(s.current.source).toEqual(item.source);
      }
    });
  });

  describe('완주', () => {
    it('전 어픽스 고착 → isComplete === true, rollChain 결과의 complete === true', () => {
      const item = rareWithExactly(5000, 3);
      let s = openChain(item);
      for (let i = 0; i < 3; i++) {
        s = rollChain(s, 'mid', 400 + i, 1).next;
        s = fasten(s, i);
      }
      expect(s.fastened).toEqual([0, 1, 2]);
      expect(isComplete(s)).toBe(true);

      const out = rollChain(s, 'mid', 500, 1);
      expect(out.complete).toBe(true);
      expect(out.melted).toBe(false);
      expect(out.next.current.affixes).toEqual(s.current.affixes);
    });

    it('고착이 남아 있으면 완주가 아니다', () => {
      const item = rareWithExactly(5001, 3);
      let s = rollSafe(openChain(item), 'mid', 600).next;
      s = fasten(s, 0);
      expect(isComplete(s)).toBe(false);
      expect(rollChain(s, 'mid', 601, 1).complete).toBe(false);
    });

    it('완주 직전(마지막 1칸 남음)에 용해하면 고착이 전부 풀린다', () => {
      const item = rareWithExactly(5002, 3);
      let s = openChain(item);
      for (let i = 0; i < 2; i++) {
        s = rollChain(s, 'mid', 700 + i, 1).next;
        s = fasten(s, i);
      }
      expect(isComplete(s)).toBe(false);
      const out = rollChain(s, 'mid', 800, 0);
      expect(out.melted).toBe(true);
      expect(out.next.fastened).toEqual([]);
      expect(isComplete(out.next)).toBe(false);
    });
  });

  describe('완주 후 굴림 거부 — 얻을 것이 0인데 위험은 최고점이라 상태기계가 막는다', () => {
    /** 어픽스 3개를 전부 고착한 완주 상태. */
    function completed(seed: number) {
      const item = rareWithExactly(seed, 3);
      let s = openChain(item);
      for (let i = 0; i < 3; i++) {
        s = rollChain(s, 'mid', seed + i, 1).next;
        s = fasten(s, i);
      }
      expect(isComplete(s)).toBe(true);
      return s;
    }

    it('riskRoll = 0(무조건 용해가 나야 하는 값)이어도 용해하지 않는다', () => {
      const s = completed(5100);
      // 가드가 없었다면 이 구간의 위험은 최고점이라 확실히 용해했을 값이다.
      expect(meltRisk(s.fastened.length, s.baseline.affixes.length, 'high')).toBeGreaterThan(0.5);
      const out = rollChain(s, 'high', 999, 0);
      expect(out.melted).toBe(false);
      expect(out.complete).toBe(true);
    });

    it('반환된 next 가 입력 상태와 참조 동일하다(아무 일도 일어나지 않았다)', () => {
      const s = completed(5101);
      const out = rollChain(s, 'mid', 999, 0);
      expect(out.next).toBe(s);
    });

    it('3개 노 출력 전부에서 성립한다', () => {
      const s = completed(5102);
      for (const heat of HEATS) {
        for (const riskRoll of [0, 0.5, 1]) {
          const out = rollChain(s, heat, 1234, riskRoll);
          expect(out.next, `heat=${heat} riskRoll=${riskRoll}`).toBe(s);
          expect(out.melted).toBe(false);
          expect(out.complete).toBe(true);
        }
      }
    });

    it('반복 호출해도 상태가 변하지 않는다', () => {
      const s = completed(5103);
      const snap = JSON.stringify(s);
      let cur = s;
      for (let i = 0; i < 10; i++) {
        cur = rollChain(cur, 'high', 2000 + i, 0).next;
      }
      expect(cur).toBe(s);
      expect(JSON.stringify(cur)).toBe(snap);
      expect(cur.current.affixes).toEqual(s.current.affixes);
    });
  });

  // ---------------------------------------------------------------------------
  // 노 출력 → 값 밴드 전달. 이 파일은 `heat` 를 넘기되 **값을 비교하지 않았고**(개수·id·불변성만),
  // `reforge.test.ts` 는 `band` 를 직접 넘겨 검증했다 — 즉 두 모듈의 **경계**를 아무도 안 봤다.
  // `band: 0` 하드코딩이거나 `riskMult` 를 `band` 자리에 넣었어도 24케이스가 전부 그린이었다.
  // ---------------------------------------------------------------------------
  describe('노 출력이 값 밴드로 전달된다', () => {
    it('같은 시드에서 high 가 low 보다 어픽스 값 총합이 크다', () => {
      // RNG 스트림 형태가 밴드와 무관하게 같으므로 같은 시드면 같은 어픽스가 같은 순서로 뽑힌다
      // — 값만 달라진다. 따라서 합의 비교가 공정하다(reforge.test.ts 가 이미 쓰는 논거).
      const item = rareWithAffixes(9000, 5);
      const s = openChain(item);
      const sum = (heat: Heat): number => {
        let total = 0;
        for (let seed = 0; seed < 200; seed++) {
          for (const a of rollChain(s, heat, 0x51ee_0000 + seed, 1).next.current.affixes) total += a.value;
        }
        return total;
      };
      const low = sum('low');
      const high = sum('high');
      expect(high, '노 출력이 값 밴드에 전혀 반영되지 않았다(band 하드코딩 의심)').toBeGreaterThan(low);
    });

    it('굴림 결과가 HEAT[heat].band 로 재단조한 것과 정확히 같다', () => {
      // 합 비교만으로는 `riskMult`(0.6/1/1.8)를 `band` 자리에 넣은 실수도 통과한다(둘 다 단조 증가).
      // 어느 상수가 전달됐는지까지 못 박는다.
      const item = rareWithAffixes(9001, 4);
      const s = openChain(item);
      for (const heat of HEATS) {
        const out = rollChain(s, heat, 0x0c0f_fee1, 1);
        expect(out.next.current.affixes, `heat=${heat} 에서 다른 밴드로 재단조됐다`).toEqual(
          reforgeAffixes(item, 0x0c0f_fee1, { fastened: [], band: HEAT[heat].band }).affixes,
        );
      }
    });
  });

  describe('결정론 · 순수성', () => {
    it('같은 입력 → 같은 출력', () => {
      const item = rareWithAffixes(6000);
      let a = rollSafe(openChain(item), 'high', 900).next;
      let b = rollSafe(openChain(item), 'high', 900).next;
      a = fasten(a, 2);
      b = fasten(b, 2);
      const ra = rollChain(a, 'high', 901, 0.9);
      const rb = rollChain(b, 'high', 901, 0.9);
      expect(ra).toEqual(rb);
    });

    it('입력 ChainState 와 Item 을 변형하지 않는다', () => {
      const item = rareWithAffixes(6001, 4);
      const itemSnap = JSON.stringify(item);
      const s0 = rollSafe(openChain(item), 'mid', 1000).next;
      const s1 = fasten(s0, 1);
      const s0Snap = JSON.stringify(s0);
      const s1Snap = JSON.stringify(s1);

      rollChain(s1, 'high', 1001, 1);
      rollChain(s1, 'high', 1002, 0);
      fasten(s1, 2);
      fasten(s0, 3);

      expect(JSON.stringify(item)).toBe(itemSnap);
      expect(JSON.stringify(s0)).toBe(s0Snap);
      expect(JSON.stringify(s1)).toBe(s1Snap);
      // fasten 은 원본 배열을 공유하지 않는다.
      expect(s1.fastened).not.toBe(s0.fastened);
    });

    it('반환 상태는 항상 새 객체다(성공 굴림이 입력 상태를 되돌려주지 않는다)', () => {
      const item = rareWithAffixes(6002);
      const s = openChain(item);
      const out = rollChain(s, 'mid', 1100, 1);
      expect(out.next).not.toBe(s);
      expect(out.next.fastened).not.toBe(s.fastened);
    });
  });
});
