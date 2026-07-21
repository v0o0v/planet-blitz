/**
 * M8-L6 — 신규 기체 6종 트리 **콘텐츠** 게이트 (로스터 7종).
 *
 * L1 의 `tests/shipTypes.test.ts` 가 레지스트리의 *구조*(인덱스 계약·flat 레이아웃·스트라이커
 * 동결)를 지킨다면, 이 파일은 그 위에 얹힌 *데이터*를 지킨다.
 *
 * ## 무엇을 막는가
 * 1. **신규 StatKey 유입** — 새 스탯 하나가 `zeroStatSums`·`zeroSums`·`LoadoutConfig`·
 *    `replay.ts` 폴드 레이아웃을 함께 움직여 **해시 레이아웃**을 바꾼다(설계서 §2). 데이터
 *    파일에서 문자열 하나만 바꿔도 되는 일이라 리뷰로는 놓치기 쉽다.
 * 2. **perPoint 단위 규약 이탈** — `data/skills.ts` 는 정수, 단 `pierce` 0.5 / `bulletCount`
 *    0.25 단위다. 임의의 소수가 들어오면 f64 누적 경로가 늘어 결정론이 취약해진다(ADR-0005).
 * 3. **캡스톤 구조 붕괴** — 캡스톤이 아닌 노드가 캡스톤 자리에 오거나 게이트가 계열 용량을
 *    넘으면 그 계열 캡스톤은 **영원히 못 찍는다**(예외도 타입 오류도 없다).
 * 4. **컬러 이모지** — Pixi 는 컬러 이모지를 두부로 그린다(`src/ui/pixi/text.ts` stripEmoji).
 * 5. **i18n 키가 화면에 그대로 뜨는 것** — 연구소는 `node.name` 을 `t()` 없이 그린다
 *    (`src/ui/pixi/researchLab.ts:636,861`). 스텁이 쓰던 `ship.<slug>...` 키 형태가 남으면
 *    유저에게 키가 보인다.
 * 6. **여러 종이 사실상 같은 기체인 것** — 트리를 채웠는데 스탯 분포가 비슷하면 "타입이 7종"은
 *    문구일 뿐이다. 만렙 투자 프로파일을 실제로 비교해 축이 갈리는지 본다.
 *
 * 마지막 describe 는 **정규 경로 통합**이다(설계서 §10). 레지스트리를 직접 부르지 않고
 * `retireActiveShip`(앱이 기체를 바꾸는 유일한 경로) → `Profile` → 런 설정 조립 →
 * `createWorld`/`stepWorld` 를 실제로 굴린다.
 */

import { describe, it, expect } from 'vitest';
import { buildRunConfig } from '../src/run/runConfig.js';
import {
  SHIP_TYPES,
  STRIKER,
  shipTypeDef,
  shipSkillNodeCount,
  zeroSkillInvest,
  flattenShipNodes,
  AFFINITY_LEGACY_TREE,
} from '../data/ships/index.js';
import type { ShipTypeDef } from '../data/ships/index.js';
import { SKILL_NODE_COUNT, CAPSTONE_GATE, NODES_PER_TREE } from '../data/skills.js';
import type { SkillNode } from '../data/skills.js';
import { zeroStatSums } from '../src/items/skills.js';
import type { StatKey } from '../src/items/types.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import type { WorldConfig, InputFrame } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import type { Profile } from '../src/save/profile.js';
import { retireActiveShip } from '../src/save/guardianLifecycle.js';

/** 타입 1~6 (스트라이커는 L1 이 동결을 지킨다 — 여기서는 신규분만 본다). */
const NEW_TYPES: readonly ShipTypeDef[] = SHIP_TYPES.slice(1);

/** 스킬 트리가 **절대 주지 않기로 한** 스탯: 메타 재화 1 + 장비 어픽스 전용 원소 3. */
const SKILL_FORBIDDEN_STATS: readonly StatKey[] = [
  'mineralFindPct',
  'fireDmg',
  'coldSlow',
  'lightning',
];

/** `perPoint` 가 이 단위의 배수여야 하는 스탯(나머지는 정수). `data/skills.ts` 의 실제 관용구. */
const FRACTIONAL_UNIT: Partial<Record<StatKey, number>> = { pierce: 0.5, bulletCount: 0.25 };

/** 한 트리의 base 노드(캡스톤 제외). */
function baseNodes(def: ShipTypeDef, treeIndex: number): readonly SkillNode[] {
  return def.trees[treeIndex]?.nodes.slice(0, def.nodesPerTree) ?? [];
}

/** 한 계열의 투자 용량(base 노드 maxPoints 합) — 캡스톤 게이트가 이 안에 있어야 한다. */
function treeCapacity(def: ShipTypeDef, treeIndex: number): number {
  let sum = 0;
  for (const n of baseNodes(def, treeIndex)) sum += n.maxPoints;
  return sum;
}

/**
 * "전 노드 만렙" 투자 시의 스탯 합. 티어 시너지(`computeSkillStats`)는 곱셈 증폭이라
 * 축의 비교에는 잡음만 더한다 — 여기서는 설계 의도인 **분포**만 본다.
 */
function fullInvestProfile(def: ShipTypeDef): Record<StatKey, number> {
  const sums = zeroStatSums();
  for (const n of flattenShipNodes(def)) {
    if (n.capstone === true) continue;
    sums[n.stat] += n.maxPoints * n.perPoint;
  }
  return sums;
}

/** 프로파일에서 그 스탯이 차지하는 비중(0~1). 총량 차이를 지우고 **축**만 비교하기 위함. */
function shareOf(profile: Record<StatKey, number>, stat: StatKey): number {
  let total = 0;
  for (const v of Object.values(profile)) total += v;
  return total === 0 ? 0 : profile[stat] / total;
}

/** 어떤 타입이 그 스탯에서 최대인지(동점이면 첫 번째). */
function argMaxBy(stat: StatKey): string {
  let best = SHIP_TYPES[0];
  let bestV = -Infinity;
  for (const def of SHIP_TYPES) {
    const v = fullInvestProfile(def)[stat];
    if (v > bestV) {
      bestV = v;
      best = def;
    }
  }
  return best?.slug ?? '';
}

describe('① 구조 — 티어 행·캡스톤 배치', () => {
  it('각 트리가 base nodesPerTree + 캡스톤 1개이고, 캡스톤은 맨 뒤 하나뿐이다', () => {
    for (const def of NEW_TYPES) {
      for (const t of def.trees) {
        expect(t.nodes.length, `${def.slug}/${t.slug}`).toBe(def.nodesPerTree + 1);
        t.nodes.forEach((n, i) => {
          expect(n.capstone === true, `${def.slug}/${t.slug}[${i}]`).toBe(i === def.nodesPerTree);
        });
      }
    }
  });

  it('티어가 0..depth-1 로 빈틈없이 이어지고 행 크기가 트리 안에서 균일하다', () => {
    // 행 크기가 들쭉날쭉하면 연구소 그리드(`NODES_PER_TREE / TREE_DEPTH` 열)가 무너진다.
    for (const def of NEW_TYPES) {
      for (let ti = 0; ti < def.trees.length; ti++) {
        const rows = new Map<number, number>();
        for (const n of baseNodes(def, ti)) rows.set(n.tier, (rows.get(n.tier) ?? 0) + 1);
        const tiers = [...rows.keys()].sort((a, b) => a - b);
        expect(tiers, `${def.slug}/${ti}`).toEqual(tiers.map((_, i) => i));
        expect(new Set(rows.values()).size, `${def.slug}/${ti} 행 크기`).toBe(1);
        const cap = def.trees[ti]?.nodes[def.nodesPerTree];
        expect(cap?.tier, `${def.slug}/${ti} 캡스톤 티어`).toBe(tiers.length);
      }
    }
  });

  it('노드의 레거시 tree 필드가 트리 affinity 의 역매핑과 일치한다', () => {
    // 이 필드가 캡스톤 비트(loadout.ts 의 capstoneActive)·파워업 가중의 축이다.
    for (const def of NEW_TYPES) {
      for (const t of def.trees) {
        for (const n of t.nodes) {
          expect(n.tree, `${def.slug}/${t.slug}/${n.id}`).toBe(AFFINITY_LEGACY_TREE[t.affinity]);
        }
      }
    }
  });
});

describe('② 캡스톤 게이트 정합', () => {
  it('게이트가 정수이며 0 < gate < 계열 base 용량이다 (넘으면 영원히 못 찍는다)', () => {
    for (const def of NEW_TYPES) {
      expect(Number.isInteger(def.capstoneGate), def.slug).toBe(true);
      expect(def.capstoneGate, def.slug).toBeGreaterThan(0);
      for (let ti = 0; ti < def.trees.length; ti++) {
        expect(def.capstoneGate, `${def.slug}/${ti}`).toBeLessThan(treeCapacity(def, ti));
      }
    }
  });

  it('게이트 비율이 스트라이커(40/83 ≈ 48%) 주변 대역 [35%, 60%] 안이다', () => {
    for (const def of SHIP_TYPES) {
      for (let ti = 0; ti < def.trees.length; ti++) {
        const ratio = def.capstoneGate / treeCapacity(def, ti);
        expect(ratio, `${def.slug}/${ti} 게이트 비율`).toBeGreaterThanOrEqual(0.35);
        expect(ratio, `${def.slug}/${ti} 게이트 비율`).toBeLessThanOrEqual(0.6);
      }
    }
  });

  it('계열 용량이 타입 안에서 균형이고 (최대/최소 ≤ 1.1) 합계가 합리적 대역이다', () => {
    for (const def of SHIP_TYPES) {
      const caps = def.trees.map((_, ti) => treeCapacity(def, ti));
      const min = Math.min(...caps);
      const max = Math.max(...caps);
      expect(max / min, `${def.slug} 계열 편차`).toBeLessThanOrEqual(1.1);
      const total = caps.reduce((a, b) => a + b, 0);
      // 스트라이커 250 기준. 해츨링은 노드가 얕고 많아 상단(309)이지만 포인트 예산은 공유다.
      expect(total, `${def.slug} 총 용량`).toBeGreaterThanOrEqual(240);
      expect(total, `${def.slug} 총 용량`).toBeLessThanOrEqual(320);
    }
  });
});

describe('③ perPoint 규약 (결정론 — ADR-0005)', () => {
  it('base 노드는 유한 양수, 캡스톤은 정확히 0 이다', () => {
    for (const def of NEW_TYPES) {
      for (const n of flattenShipNodes(def)) {
        expect(Number.isFinite(n.perPoint), n.id).toBe(true);
        if (n.capstone === true) expect(n.perPoint, n.id).toBe(0);
        else expect(n.perPoint, n.id).toBeGreaterThan(0);
      }
    }
  });

  it('정수 또는 스탯별 허용 분모(pierce 1/2 · bulletCount 1/4)의 배수다', () => {
    for (const def of NEW_TYPES) {
      for (const n of flattenShipNodes(def)) {
        if (n.capstone === true) continue;
        const unit = FRACTIONAL_UNIT[n.stat];
        if (unit === undefined) {
          expect(Number.isInteger(n.perPoint), `${n.id} (${n.stat})`).toBe(true);
        } else {
          // 부동소수 잔차 없이 딱 떨어지는지: 단위로 나눈 몫이 정수여야 한다.
          expect(Number.isInteger(Math.round(n.perPoint / unit)), `${n.id} (${n.stat})`).toBe(true);
          expect(Math.abs(Math.round(n.perPoint / unit) * unit - n.perPoint), n.id).toBeLessThan(
            1e-9,
          );
        }
      }
    }
  });

  it('maxPoints 가 4 또는 5 다 (기존 트리 관용구)', () => {
    for (const def of NEW_TYPES) {
      for (const n of flattenShipNodes(def)) {
        if (n.capstone === true) {
          expect(n.maxPoints, n.id).toBe(1);
          continue;
        }
        expect([4, 5], n.id).toContain(n.maxPoints);
      }
    }
  });
});

describe('④ 신규 StatKey 금지 (해시 레이아웃 불변)', () => {
  it('모든 노드 stat 이 기존 StatKey 어휘 안에 있다', () => {
    const known = new Set(Object.keys(zeroStatSums()));
    expect(known.size).toBe(16);
    for (const def of SHIP_TYPES) {
      for (const n of flattenShipNodes(def)) {
        expect(known.has(n.stat), `${def.slug}/${n.id} → ${n.stat}`).toBe(true);
      }
    }
  });

  it('스킬이 주지 않기로 한 4종(메타 재화·원소 어픽스)을 쓰지 않는다', () => {
    // computeSkillStats 가 이 4종을 항상 0 으로 두는 전제와 데이터가 어긋나면,
    // 파생값은 조용히 무시되고 UI 만 "오른다" 고 말하는 상태가 된다.
    for (const def of SHIP_TYPES) {
      for (const n of flattenShipNodes(def)) {
        if (n.capstone === true) continue;
        expect(SKILL_FORBIDDEN_STATS, `${def.slug}/${n.id}`).not.toContain(n.stat);
      }
    }
  });
});

describe('⑤ 표시 문자열', () => {
  const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}]/u;

  it('이름·설명이 비어 있지 않고 컬러 이모지가 0 이다 (Pixi 두부 방지)', () => {
    for (const def of SHIP_TYPES) {
      for (const n of flattenShipNodes(def)) {
        expect(n.name.trim().length, n.id).toBeGreaterThan(0);
        expect(n.desc.trim().length, n.id).toBeGreaterThan(0);
        expect(EMOJI.test(n.name), `${n.id} 이름 이모지`).toBe(false);
        expect(EMOJI.test(n.desc), `${n.id} 설명 이모지`).toBe(false);
      }
    }
  });

  it('i18n 키 형태가 남아 있지 않다 (연구소는 node.name 을 t() 없이 그린다)', () => {
    for (const def of SHIP_TYPES) {
      for (const n of flattenShipNodes(def)) {
        expect(n.name, `${n.id} 이름`).not.toMatch(/^[a-z][a-z0-9_.-]*\.[a-z]/i);
        expect(n.desc, `${n.id} 설명`).not.toMatch(/^ship\./);
      }
    }
  });

  it('노드 이름이 타입 안에서 유일하다 (연구소 목록에서 같은 이름이 둘 보이지 않게)', () => {
    for (const def of SHIP_TYPES) {
      const names = flattenShipNodes(def).map((n) => n.name);
      const dup = names.filter((v, i) => names.indexOf(v) !== i);
      expect(dup, `${def.slug} 중복 이름`).toEqual([]);
    }
  });
});

describe('⑥ 7종이 실제로 다른 빌드를 만든다', () => {
  it('축별 1위가 서로 다른 기체다', () => {
    expect(argMaxBy('damagePct')).toBe('phantom'); // 유리 대포
    expect(argMaxBy('maxHpFlat')).toBe('bruiser'); // 장갑
    expect(argMaxBy('fireRatePct')).toBe('hatchling'); // 무리 연사
    expect(argMaxBy('xpPct')).toBe('hatchling'); // 무리 성장
    expect(argMaxBy('rangeFlat')).toBe('arccaster'); // 포격
    expect(argMaxBy('bulletCount')).toBe('arccaster'); // 탄막
    expect(argMaxBy('moveSpeedPct')).toBe('phantom'); // 기동
    expect(argMaxBy('maxHpPct')).toBe('mallow'); // 완충 = 비율 체력
    expect(argMaxBy('bulletSpeedPct')).toBe('bubble'); // 파열 압력
    expect(argMaxBy('magnetPct')).toBe('bubble'); // 떠다니며 끌어온다
    expect(argMaxBy('pierce')).toBe('bubble'); // 막을 뚫는 탄
  });

  it('각 신규 타입이 스트라이커보다 자기 축에서 뚜렷하게 크다 (기준점 대비 차별화)', () => {
    const base = fullInvestProfile(STRIKER);
    const p = (slug: string): Record<StatKey, number> =>
      fullInvestProfile(SHIP_TYPES.find((d) => d.slug === slug) ?? STRIKER);
    expect(p('bruiser').maxHpFlat).toBeGreaterThan(base.maxHpFlat * 1.4);
    expect(p('bruiser').damagePct).toBeGreaterThan(base.damagePct * 1.4);
    expect(p('arccaster').rangeFlat).toBeGreaterThan(base.rangeFlat * 3);
    expect(p('arccaster').bulletCount).toBeGreaterThan(base.bulletCount * 1.5);
    expect(p('phantom').damagePct).toBeGreaterThan(base.damagePct * 2);
    expect(p('phantom').maxHpFlat).toBeLessThan(base.maxHpFlat * 0.6);
    expect(p('hatchling').fireRatePct).toBeGreaterThan(base.fireRatePct * 2);
    expect(p('hatchling').damagePct).toBeLessThan(base.damagePct * 0.7);
    expect(p('mallow').maxHpPct).toBeGreaterThan(base.maxHpPct * 3);
    expect(p('mallow').damagePct).toBeLessThan(base.damagePct * 1.5);
    expect(p('bubble').bulletSpeedPct).toBeGreaterThan(base.bulletSpeedPct * 2);
    expect(p('bubble').magnetPct).toBeGreaterThan(base.magnetPct * 1.1);
    expect(p('bubble').rangeFlat).toBe(0); // 사거리 노드가 하나도 없는 유일한 기체
  });

  it('브루저 장갑이 해츨링보다 총량·포인트당 **둘 다** 앞선다 (노드 수 차이가 축을 뒤집지 않는다)', () => {
    // 해츨링은 계열 용량이 103(브루저 83)이라 flat 값을 같은 눈금으로 주면 만렙 총량만으로
    // 해츨링이 더 단단해 보인다. 총량 비교만 걸어 두면 그 역전이 조용히 통과한다.
    const bruiser = shipTypeDef(1);
    const hatchling = shipTypeDef(4);
    const hpTotal = (d: ShipTypeDef): number => fullInvestProfile(d).maxHpFlat;
    const defCap = (d: ShipTypeDef): number => {
      const ti = d.trees.findIndex((t) => t.affinity === 'defense');
      return treeCapacity(d, ti);
    };
    expect(hpTotal(bruiser)).toBeGreaterThan(hpTotal(hatchling) * 1.15);
    expect(hpTotal(bruiser) / defCap(bruiser)).toBeGreaterThan(
      (hpTotal(hatchling) / defCap(hatchling)) * 1.3,
    );
  });

  it('정규화 분포가 쌍마다 충분히 다르다 (총량이 아니라 축의 차이)', () => {
    const stats = Object.keys(zeroStatSums()) as StatKey[];
    const profiles = SHIP_TYPES.map((d) => {
      const prof = fullInvestProfile(d);
      return { slug: d.slug, shares: stats.map((s) => shareOf(prof, s)) };
    });
    for (let i = 0; i < profiles.length; i++) {
      for (let j = i + 1; j < profiles.length; j++) {
        const a = profiles[i];
        const b = profiles[j];
        if (a === undefined || b === undefined) continue;
        let l1 = 0;
        for (let k = 0; k < stats.length; k++) l1 += Math.abs((a.shares[k] ?? 0) - (b.shares[k] ?? 0));
        // L1 거리 최대 2(완전 분리). 0.35 = 분포의 ~17% 가 다른 축으로 옮겨간 정도.
        expect(l1, `${a.slug} vs ${b.slug} 분포 거리`).toBeGreaterThan(0.35);
      }
    }
  });
});

describe('⑦ 벡터 길이 계약', () => {
  it('스트라이커만 63 에 묶여 있고 신규 타입은 자기 길이를 갖는다', () => {
    expect(shipSkillNodeCount(0)).toBe(SKILL_NODE_COUNT);
    expect(shipSkillNodeCount(1)).toBe(63); // bruiser  3×(20+1)
    expect(shipSkillNodeCount(2)).toBe(63); // arccaster
    expect(shipSkillNodeCount(3)).toBe(63); // phantom
    expect(shipSkillNodeCount(4)).toBe(78); // hatchling 3×(25+1)
    expect(shipSkillNodeCount(5)).toBe(63); // mallow
    expect(shipSkillNodeCount(6)).toBe(63); // bubble
    expect(SHIP_TYPES[4]?.nodesPerTree).toBe(25);
    expect(SHIP_TYPES[1]?.nodesPerTree).toBe(NODES_PER_TREE);
  });

  it('어떤 타입도 63 미만이 아니다 (investSkill 이 아직 스트라이커 인덱스로 판정한다)', () => {
    // ⚠️ 근거: `src/save/profile.ts` 의 investSkill 은 `SKILLS[index]`(길이 63)로 노드를 찾고
    // `invest[index] = cur + 1` 로 쓴다. 노드 수가 63 **미만**인 타입이 생기는 순간 그 기체의
    // 벡터가 범위 밖 인덱스로 늘어나 리플레이 폴드의 길이 계약이 깨진다(예외 없음).
    // M8-L4 가 타입별 노드로 일반화하면 이 하한은 불필요해진다 — 그때 이 케이스를 지워라.
    for (const def of SHIP_TYPES) {
      expect(shipSkillNodeCount(def.id), def.slug).toBeGreaterThanOrEqual(SKILL_NODE_COUNT);
    }
  });

  it('타입마다 flat 노드 정의가 벡터 전 인덱스를 덮는다 (빈 칸 0)', () => {
    for (const def of SHIP_TYPES) {
      const flat = flattenShipNodes(def);
      expect(flat.length, def.slug).toBe(zeroSkillInvest(def.id).length);
      for (let i = 0; i < flat.length; i++) {
        expect(flat[i], `${def.slug}[${i}]`).toBeDefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 정규 경로 통합 — 설계서 §10.
//
// 위 케이스는 전부 데이터를 직접 읽는다. 그것만으로는 **앱이 이 데이터를 타는지** 알 수 없다.
// 아래는 앱이 기체를 바꾸는 실제 경로(retireActiveShip)로 타입을 옮기고, src/main.ts 의 PvE
// 런 시작과 같은 함수·순서로 config 를 조립해 createWorld/stepWorld 를 굴린다.
//
// ⚠️ M8-L7 이 `buildRunConfig(profile)` 를 추출하면 `assembleRunConfigLikeMain` 을 지우고 그
// 함수를 직접 호출할 것(같은 지시가 tests/shipTypes.test.ts 에도 있다).
// ---------------------------------------------------------------------------

// ✅ M8-L7 완료: 조립을 재현하지 않고 실제 앱(`src/main.ts`)이 부르는 `buildRunConfig` 를
// 그대로 호출한다. `playerHp` 만 테스트가 덮는데, 그것은 프로필 파생값이 아니라 무대 상수다.
function assembleRunConfigLikeMain(profile: Profile, planet: number, tier: number): WorldConfig {
  return { ...buildRunConfig(profile, { planet, tier }), playerHp: 100_000_000 };
}

function runTicks(seed: number, config: WorldConfig, ticks: number): number[] {
  const state = createWorld(seed, config);
  const frame: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };
  const hashes: number[] = [];
  for (let t = 0; t < ticks; t++) {
    stepWorld(state, frame);
    hashes.push(hashWorld(state));
  }
  return hashes;
}

/** 앱 경로로 `typeId` 기체를 활성으로 만든 프로필(퇴역 = 세대 교체). */
function profileWithType(typeId: number): Profile {
  const p = defaultProfile();
  if (typeId === 0) return p;
  retireActiveShip(p, undefined, typeId);
  return p;
}

describe('정규 경로 통합 — 퇴역으로 기체 전환 → 런 설정 → sim', () => {
  it('퇴역이 지급한 기체의 벡터 길이가 그 타입의 트리 데이터와 일치한다', () => {
    for (const def of SHIP_TYPES) {
      const ship = activeShip(profileWithType(def.id));
      expect(ship.typeId, def.slug).toBe(def.id);
      expect(ship.skillInvest.length, def.slug).toBe(flattenShipNodes(def).length);
      expect(ship.skillInvest.every((v) => v === 0), def.slug).toBe(true);
    }
  });

  it('앱 경로가 만든 WorldConfig.skillInvest 가 타입별 길이를 그대로 나른다', () => {
    // 여기서 길이가 63 으로 고정돼 있으면 "레지스트리는 있는데 런이 안 탄다" 는 뜻이다.
    for (const def of SHIP_TYPES) {
      const config = assembleRunConfigLikeMain(profileWithType(def.id), 0, 0);
      expect(config.skillInvest?.length, def.slug).toBe(shipSkillNodeCount(def.id));
    }
    const hatchling = assembleRunConfigLikeMain(profileWithType(4), 0, 0);
    expect(hatchling.skillInvest?.length).toBe(78);
    expect(hatchling.skillInvest?.length).not.toBe(SKILL_NODE_COUNT);
  });

  it('신규 타입 런이 실제로 돌고 결정론적이다 (같은 seed → 같은 해시 스트림)', () => {
    for (const def of NEW_TYPES) {
      const cfg = (): WorldConfig => assembleRunConfigLikeMain(profileWithType(def.id), 0, 0);
      const a = runTicks(4242, cfg(), 120);
      const b = runTicks(4242, cfg(), 120);
      expect(a, def.slug).toEqual(b);
      expect(a.length, def.slug).toBe(120);
      // 월드가 멈춰 있으면(전부 같은 해시) 이 케이스는 아무것도 증명하지 못한다.
      expect(new Set(a).size, `${def.slug} 해시 다양성`).toBeGreaterThan(60);
    }
  });

  it('타입 0 런은 신규 데이터에 영향받지 않는다 (회귀 탐지기 보존)', () => {
    // 신규 타입 데이터를 채운 뒤에도 스트라이커 config 는 63 길이·uniqueMask 0 이어야 한다.
    const config = assembleRunConfigLikeMain(defaultProfile(), 0, 0);
    expect(config.skillInvest).toEqual(zeroSkillInvest(0));
    expect(config.loadout?.uniqueMask).toBe(0);
    expect(shipTypeDef(0)).toBe(STRIKER);
    expect(STRIKER.capstoneGate).toBe(CAPSTONE_GATE);
  });
});
