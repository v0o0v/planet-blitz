/**
 * M8-L1 — 기체 타입 레지스트리 스키마 게이트.
 *
 * ## 무엇을 막는가
 * 1. **`SHIP_TYPES` 인덱스 ≠ `id`** — 배열에 타입을 끼워 넣거나 재정렬하면 세이브의 `Ship.typeId`
 *    가 다른 기체를 가리키고 리플레이가 다른 트리로 재실행된다. wire 계약이다.
 * 2. **시그니처 비트 충돌·범위 이탈** — 0~17 은 유니크/캡스톤이 점유, 31 은 `1<<31` 이 음수.
 *    두 타입이 같은 비트를 쓰면 한쪽 패시브가 다른 쪽 런에서 켜진다(테스트 없이는 안 보인다).
 * 3. **스트라이커 오염** — 노드 63개·baseBp 전 축 0·시그니처 없음이 무너지면 설계서 §11 의
 *    "리팩터 기간 중 회귀 탐지기" 가 사라진다.
 * 4. **`data/skills.ts` 의 어떤 편집이든** — 63노드 전 필드 골든 문자열이 즉시 적발한다.
 *    (인덱스 이동/스탯 변경/perPoint 변경/티어 변경/문구 변경 전부. 이 파일이 깨지면
 *    `data/skills.ts` 를 되돌려라 — 고쳐야 할 것은 골든이 아니다.)
 * 5. **flat 벡터 레이아웃 오조립** — `trees.flatMap(t => t.nodes)` 는 base 와 캡스톤을
 *    번갈아 섞어 인덱스를 밀어 버린다. `flattenShipNodes` 만이 `SKILLS` 와 동일한 순서를 낸다.
 * 6. **affinity 매핑 뒤틀림** — 파워업 가중의 축이므로 순서가 어긋나면 sim RNG 스트림이 갈린다.
 *
 * 마지막 describe 는 **정규 경로 통합**이다(설계서 §10 "단위 테스트는 그린인데 배선이 없다").
 */

import { describe, it, expect } from 'vitest';
import { buildRunConfig } from '../src/run/runConfig.js';
import {
  SHIP_TYPES,
  STRIKER,
  DEFAULT_SHIP_TYPE,
  NO_SIGNATURE_BIT,
  SIGNATURE_BIT_MIN,
  SIGNATURE_BIT_MAX,
  TREES_PER_SHIP,
  TREE_AFFINITIES,
  LEGACY_TREE_AFFINITY,
  AFFINITY_LEGACY_TREE,
  flattenShipNodes,
  shipNodeCount,
  shipTreeRange,
  shipCapstoneIndex,
  shipTypeDef,
  shipSkillNodeCount,
  zeroSkillInvest,
  normalizeShipTypeId,
  selectableShipTypes,
} from '../data/ships/index.js';
import {
  SKILLS,
  SKILL_TREES,
  SKILL_NODE_COUNT,
  NODES_PER_TREE,
  CAPSTONE_GATE,
  capstoneIndex,
  treeRange,
} from '../data/skills.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import type { WorldConfig, InputFrame } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import type { Profile } from '../src/save/profile.js';

/**
 * 스트라이커 63노드 전 필드 직렬화 골든.
 * 형식: `인덱스|id|tree|stat|perPoint|maxPoints|tier|capstone(0/1)|name|desc`, 한 줄에 한 노드.
 * **이 문자열은 손으로 고치지 않는다.** 깨졌다면 `data/skills.ts` 나 조립 순서가 바뀐 것이다.
 */
const STRIKER_NODES_GOLDEN =`0|firepower-0-0|firepower|damagePct|3|4|0|0|집중 사격|탄환 데미지 +3%/pt
1|firepower-0-1|firepower|damagePct|3|4|0|0|정밀 조준|탄환 데미지 +3%/pt
2|firepower-0-2|firepower|fireRatePct|2|4|0|0|속사 훈련|연사 속도 +2%/pt
3|firepower-0-3|firepower|bulletSpeedPct|3|4|0|0|탄속 개량|탄속 +3%/pt
4|firepower-1-0|firepower|damagePct|4|4|1|0|강화 탄두|탄환 데미지 +4%/pt
5|firepower-1-1|firepower|fireRatePct|2|4|1|0|총열 냉각|연사 속도 +2%/pt
6|firepower-1-2|firepower|rangeFlat|40|4|1|0|사거리 연장|사거리 +40/pt
7|firepower-1-3|firepower|pierce|0.5|4|1|0|관통 코어|관통 +1/2pt(내림)
8|firepower-2-0|firepower|damagePct|4|4|2|0|파열탄|탄환 데미지 +4%/pt
9|firepower-2-1|firepower|bulletCount|0.25|4|2|0|연장 포신|탄환 +1/4pt(내림)
10|firepower-2-2|firepower|bulletSpeedPct|4|4|2|0|고압 사출|탄속 +4%/pt
11|firepower-2-3|firepower|fireRatePct|3|4|2|0|속결 격발|연사 속도 +3%/pt
12|firepower-3-0|firepower|damagePct|5|4|3|0|철갑탄|탄환 데미지 +5%/pt
13|firepower-3-1|firepower|pierce|0.5|4|3|0|관통 강화|관통 +1/2pt(내림)
14|firepower-3-2|firepower|bulletCount|0.25|4|3|0|광역 산포|탄환 +1/4pt(내림)
15|firepower-3-3|firepower|fireRatePct|3|4|3|0|가속 격발|연사 속도 +3%/pt
16|firepower-4-0|firepower|damagePct|6|5|4|0|초토화 프로토콜|탄환 데미지 +6%/pt
17|firepower-4-1|firepower|bulletCount|0.25|5|4|0|일제 사격 교리|탄환 +1/4pt(내림)
18|firepower-4-2|firepower|pierce|0.5|5|4|0|궤멸 관통|관통 +1/2pt(내림)
19|firepower-4-3|firepower|fireRatePct|4|4|4|0|과열 격발 교리|연사 속도 +4%/pt
20|survival-0-0|survival|maxHpFlat|6|4|0|0|보강 장갑|최대 HP +6/pt
21|survival-0-1|survival|maxHpFlat|6|4|0|0|내구 격벽|최대 HP +6/pt
22|survival-0-2|survival|dashCdPct|2|4|0|0|긴급 회피|대시 재충전 -2%/pt
23|survival-0-3|survival|moveSpeedPct|2|4|0|0|기민한 조종|이동 속도 +2%/pt
24|survival-1-0|survival|maxHpFlat|8|4|1|0|복합 장갑|최대 HP +8/pt
25|survival-1-1|survival|maxHpPct|2|4|1|0|생체 강화|최대 HP +2%/pt
26|survival-1-2|survival|dashCdPct|3|4|1|0|회피 기동|대시 재충전 -3%/pt
27|survival-1-3|survival|maxHpFlat|8|4|1|0|충격 완화|최대 HP +8/pt
28|survival-2-0|survival|maxHpPct|2|4|2|0|나노 재생|최대 HP +2%/pt
29|survival-2-1|survival|maxHpFlat|10|4|2|0|중장갑 도금|최대 HP +10/pt
30|survival-2-2|survival|dashCdPct|3|4|2|0|위상 회피|대시 재충전 -3%/pt
31|survival-2-3|survival|moveSpeedPct|2|4|2|0|안정 추진|이동 속도 +2%/pt
32|survival-3-0|survival|maxHpPct|3|4|3|0|적응 장갑|최대 HP +3%/pt
33|survival-3-1|survival|dashCdPct|4|4|3|0|생존 본능|대시 재충전 -4%/pt
34|survival-3-2|survival|maxHpFlat|12|4|3|0|강화 프레임|최대 HP +12/pt
35|survival-3-3|survival|moveSpeedPct|3|4|3|0|회피 숙련|이동 속도 +3%/pt
36|survival-4-0|survival|maxHpPct|4|5|4|0|불멸 교리|최대 HP +4%/pt
37|survival-4-1|survival|maxHpFlat|14|5|4|0|타이탄 도금|최대 HP +14/pt
38|survival-4-2|survival|dashCdPct|5|5|4|0|찰나 회피 교리|대시 재충전 -5%/pt
39|survival-4-3|survival|moveSpeedPct|3|4|4|0|생존 전술|이동 속도 +3%/pt
40|mobility-0-0|mobility|moveSpeedPct|3|4|0|0|추진기 조율|이동 속도 +3%/pt
41|mobility-0-1|mobility|moveSpeedPct|3|4|0|0|경량 프레임|이동 속도 +3%/pt
42|mobility-0-2|mobility|magnetPct|4|4|0|0|자력 코일|젬 자석 반경 +4%/pt
43|mobility-0-3|mobility|xpPct|2|4|0|0|학습 회로|경험치 +2%/pt
44|mobility-1-0|mobility|moveSpeedPct|3|4|1|0|가속 추진|이동 속도 +3%/pt
45|mobility-1-1|mobility|dashCdPct|3|4|1|0|대시 증폭|대시 재충전 -3%/pt
46|mobility-1-2|mobility|magnetPct|5|4|1|0|확장 자기장|젬 자석 반경 +5%/pt
47|mobility-1-3|mobility|xpPct|2|4|1|0|전술 분석|경험치 +2%/pt
48|mobility-2-0|mobility|moveSpeedPct|4|4|2|0|고기동 스러스터|이동 속도 +4%/pt
49|mobility-2-1|mobility|dashCdPct|3|4|2|0|연쇄 대시|대시 재충전 -3%/pt
50|mobility-2-2|mobility|bulletSpeedPct|3|4|2|0|탄속 동조|탄속 +3%/pt
51|mobility-2-3|mobility|magnetPct|5|4|2|0|수집 효율|젬 자석 반경 +5%/pt
52|mobility-3-0|mobility|moveSpeedPct|4|4|3|0|초음속 항법|이동 속도 +4%/pt
53|mobility-3-1|mobility|dashCdPct|4|4|3|0|순간 재충전|대시 재충전 -4%/pt
54|mobility-3-2|mobility|xpPct|3|4|3|0|숙련 파일럿|경험치 +3%/pt
55|mobility-3-3|mobility|magnetPct|6|4|3|0|광역 자석|젬 자석 반경 +6%/pt
56|mobility-4-0|mobility|moveSpeedPct|5|5|4|0|광속 기동 교리|이동 속도 +5%/pt
57|mobility-4-1|mobility|dashCdPct|5|5|4|0|무한 대시 교리|대시 재충전 -5%/pt
58|mobility-4-2|mobility|xpPct|4|5|4|0|전장 지배|경험치 +4%/pt
59|mobility-4-3|mobility|magnetPct|7|5|4|0|특이점 자석|젬 자석 반경 +7%/pt
60|firepower-capstone|firepower|damagePct|0|1|5|1|탄막 상쇄 레이저|1.5초마다 전방 레이저가 적탄을 소거
61|survival-capstone|survival|damagePct|0|1|5|1|치명타 1회 무효|런당 1회 치명 피격을 무효화 + 짧은 무적
62|mobility-capstone|mobility|damagePct|0|1|5|1|대시 잔상 소거|대시 시 반경 320 내 적탄을 소거`;

function serializeNodes(typeId: number): string {
  return flattenShipNodes(shipTypeDef(typeId))
    .map((n, i) =>
      [
        i,
        n.id,
        n.tree,
        n.stat,
        n.perPoint,
        n.maxPoints,
        n.tier,
        n.capstone === true ? 1 : 0,
        n.name,
        n.desc,
      ].join('|'),
    )
    .join('\n');
}

describe('① SHIP_TYPES 인덱스 계약 (wire)', () => {
  it('배열 인덱스 === def.id', () => {
    SHIP_TYPES.forEach((def, i) => {
      expect(def.id, `SHIP_TYPES[${i}].id`).toBe(i);
    });
  });

  it('slug 가 전부 유일하고 소문자 kebab 이다 (아트·i18n 키의 축)', () => {
    const slugs = SHIP_TYPES.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('타입 0 은 스트라이커이며 DEFAULT_SHIP_TYPE 과 같다', () => {
    expect(DEFAULT_SHIP_TYPE).toBe(0);
    expect(SHIP_TYPES[0]).toBe(STRIKER);
    expect(STRIKER.slug).toBe('striker');
  });

  it('모든 타입이 3계열이고 트리 slug 가 타입 안에서 유일하다', () => {
    for (const def of SHIP_TYPES) {
      expect(def.trees.length, def.slug).toBe(TREES_PER_SHIP);
      const slugs = def.trees.map((t) => t.slug);
      expect(new Set(slugs).size, def.slug).toBe(slugs.length);
    }
  });

  it('normalizeShipTypeId 가 손상 값을 기본 타입으로 되돌린다 (조용한 중립 loadout 방지)', () => {
    for (const bad of [-1, SHIP_TYPES.length, 999, NaN, Infinity, 'x', null, undefined, {}]) {
      expect(normalizeShipTypeId(bad)).toBe(DEFAULT_SHIP_TYPE);
    }
    expect(normalizeShipTypeId(2)).toBe(2);
    expect(normalizeShipTypeId(2.7)).toBe(2);
    expect(shipTypeDef(999)).toBe(STRIKER);
  });

  it('selectableShipTypes 가 전량을 반환한다 — 해금 게이트 없음 (ADR-0019 명시 선택)', () => {
    // 선의로 레벨/진행도 조건을 붙이는 것을 막는 유일한 수단이다.
    expect(selectableShipTypes()).toEqual(SHIP_TYPES);
    expect(selectableShipTypes().length).toBe(SHIP_TYPES.length);
  });
});

describe('② 시그니처 비트', () => {
  it('타입 0(스트라이커)은 시그니처가 없다 (-1)', () => {
    expect(STRIKER.signatureBit).toBe(NO_SIGNATURE_BIT);
    expect(NO_SIGNATURE_BIT).toBeLessThan(0);
  });

  it('타입 1..N 은 [18,30] 범위의 정수 비트를 갖는다', () => {
    for (const def of SHIP_TYPES.slice(1)) {
      expect(Number.isInteger(def.signatureBit), def.slug).toBe(true);
      expect(def.signatureBit, def.slug).toBeGreaterThanOrEqual(SIGNATURE_BIT_MIN);
      expect(def.signatureBit, def.slug).toBeLessThanOrEqual(SIGNATURE_BIT_MAX);
    }
  });

  it('비트가 타입 간 유일하다 (겹치면 남의 패시브가 켜진다)', () => {
    const bits = SHIP_TYPES.filter((d) => d.signatureBit >= 0).map((d) => d.signatureBit);
    expect(new Set(bits).size).toBe(bits.length);
  });

  it('설계서 §4 배정 + 7종 확장과 일치한다 (18·19·20·21·22·23)', () => {
    // L2 의 src/sim/shipSignature.ts SIG_* 상수가 이 값과 같아야 한다(정본은 그쪽, 여기는 데이터).
    // bruiser 18 · arccaster 19 · phantom 20 · hatchling 21 · mallow 22 · bubble 23.
    expect(SHIP_TYPES.map((d) => d.signatureBit)).toEqual([-1, 18, 19, 20, 21, 22, 23]);
  });

  it('1 << bit 이 양수다 (마스크 연산 안전 — 31 비트 금지의 이유)', () => {
    for (const def of SHIP_TYPES) {
      if (def.signatureBit < 0) continue;
      expect(1 << def.signatureBit).toBeGreaterThan(0);
    }
  });
});

describe('③④ 스트라이커 동결 (회귀 탐지기 보존)', () => {
  it('baseBp 전 축이 0 이다 (적용부가 조기 반환 → 스탯 바이트 불변)', () => {
    expect(STRIKER.baseBp).toEqual({ damageBp: 0, fireRateBp: 0, maxHpBp: 0, moveSpeedBp: 0 });
    for (const v of Object.values(STRIKER.baseBp)) expect(v).toBe(0);
  });

  it('노드 수가 정확히 63 이며 SKILL_NODE_COUNT 와 같다', () => {
    expect(shipNodeCount(STRIKER)).toBe(63);
    expect(shipNodeCount(STRIKER)).toBe(SKILL_NODE_COUNT);
    expect(shipSkillNodeCount(0)).toBe(63);
    expect(flattenShipNodes(STRIKER).length).toBe(63);
    expect(zeroSkillInvest(0).length).toBe(63);
  });

  it('nodesPerTree·capstoneGate 가 data/skills.ts 값을 그대로 쓴다 (리터럴 복사 아님)', () => {
    expect(STRIKER.nodesPerTree).toBe(NODES_PER_TREE);
    expect(STRIKER.capstoneGate).toBe(CAPSTONE_GATE);
  });

  it('트리별 노드가 base 20 + 캡스톤 1 = 21 개다', () => {
    for (const t of STRIKER.trees) {
      expect(t.nodes.length, t.slug).toBe(NODES_PER_TREE + 1);
      const cap = t.nodes[NODES_PER_TREE];
      expect(cap?.capstone, t.slug).toBe(true);
      for (let i = 0; i < NODES_PER_TREE; i++) {
        expect(t.nodes[i]?.capstone, `${t.slug}[${i}]`).toBeUndefined();
      }
    }
  });

  it('flat 순서가 SKILLS 와 원소 동일 (참조까지) — 리터럴 복사 0 의 증명', () => {
    const flat = flattenShipNodes(STRIKER);
    expect(flat.length).toBe(SKILLS.length);
    for (let i = 0; i < flat.length; i++) {
      // toBe = 참조 동일. 복사본이었다면 toEqual 은 통과해도 여기서 터진다.
      expect(flat[i], `노드 ${i}`).toBe(SKILLS[i]);
    }
  });

  it('trees.flatMap 은 flat 계약이 아니다 (오조립 함정을 명시적으로 못 박는다)', () => {
    const wrong = STRIKER.trees.flatMap((t) => t.nodes);
    expect(wrong.length).toBe(63); // 길이는 같아서 조용히 통과한다 — 그래서 위험하다
    expect(wrong).not.toEqual(SKILLS); // 순서가 다르다
    expect(wrong[20]?.id).toBe('firepower-capstone'); // SKILLS[20] 은 survival-0-0
  });

  it('트리 인덱스 구간·캡스톤 인덱스가 data/skills.ts 헬퍼와 일치', () => {
    SKILL_TREES.forEach((tree, i) => {
      expect(shipTreeRange(STRIKER, i)).toEqual(treeRange(tree));
      expect(shipCapstoneIndex(STRIKER, i)).toBe(capstoneIndex(tree));
    });
  });
});

describe('⑤ 스트라이커 63노드 골든 (data/skills.ts 무수정 게이트)', () => {
  it('전 필드 직렬화가 골든 문자열과 바이트 동일하다', () => {
    expect(serializeNodes(0)).toBe(STRIKER_NODES_GOLDEN);
  });

  it('골든이 63줄이고 인덱스가 0..62 연속이다 (골든 자체의 건전성)', () => {
    const lines = STRIKER_NODES_GOLDEN.split('\n');
    expect(lines.length).toBe(63);
    lines.forEach((ln, i) => expect(ln.split('|')[0]).toBe(String(i)));
  });
});

describe('⑥ affinity 매핑', () => {
  it('TREE_AFFINITIES 3종이 유일하다', () => {
    expect(TREE_AFFINITIES.length).toBe(3);
    expect(new Set(TREE_AFFINITIES).size).toBe(3);
  });

  it('스트라이커 트리 affinity 가 SKILL_TREES.indexOf 순서와 1:1 이다', () => {
    // 파워업 가중의 축. 이 1:1 이 깨지면 가중값이 달라져 powerupRng 소비 순서가 갈린다.
    expect(STRIKER.trees.map((t) => t.slug)).toEqual([...SKILL_TREES]);
    expect(STRIKER.trees.map((t) => t.affinity)).toEqual(['offense', 'defense', 'utility']);
    SKILL_TREES.forEach((tree, i) => {
      expect(STRIKER.trees[i]?.slug, `슬롯 ${i}`).toBe(tree);
      expect(STRIKER.trees[i]?.affinity, tree).toBe(LEGACY_TREE_AFFINITY[tree]);
      expect(TREE_AFFINITIES[i], `affinity 슬롯 ${i}`).toBe(LEGACY_TREE_AFFINITY[tree]);
    });
  });

  it('LEGACY_TREE_AFFINITY 와 AFFINITY_LEGACY_TREE 가 서로 역함수다', () => {
    for (const tree of SKILL_TREES) {
      expect(AFFINITY_LEGACY_TREE[LEGACY_TREE_AFFINITY[tree]]).toBe(tree);
    }
    for (const aff of TREE_AFFINITIES) {
      expect(LEGACY_TREE_AFFINITY[AFFINITY_LEGACY_TREE[aff]]).toBe(aff);
    }
  });

  it('모든 타입이 3 affinity 를 정확히 하나씩 갖는다 (한 축이 비면 그 축 파워업 가중이 죽는다)', () => {
    for (const def of SHIP_TYPES) {
      const affs = def.trees.map((t) => t.affinity).sort();
      expect(affs, def.slug).toEqual([...TREE_AFFINITIES].sort());
    }
  });

  it('노드의 레거시 tree 필드가 그 트리 affinity 와 정합한다', () => {
    for (const def of SHIP_TYPES) {
      for (const t of def.trees) {
        const legacy = AFFINITY_LEGACY_TREE[t.affinity];
        for (const n of t.nodes) expect(n.tree, `${def.slug}/${t.slug}/${n.id}`).toBe(legacy);
      }
    }
  });
});

describe('신규 6종의 최소 유효성 (구조 계약)', () => {
  it('전 타입의 flat 벡터 길이가 trees×(nodesPerTree+1) 이고 zeroSkillInvest 와 맞는다', () => {
    for (const def of SHIP_TYPES) {
      const n = def.trees.length * (def.nodesPerTree + 1);
      expect(shipNodeCount(def), def.slug).toBe(n);
      expect(flattenShipNodes(def).length, def.slug).toBe(n);
      expect(zeroSkillInvest(def.id).length, def.slug).toBe(n);
      expect(zeroSkillInvest(def.id).every((v) => v === 0), def.slug).toBe(true);
    }
  });

  it('노드 id 가 타입 안에서 유일하다', () => {
    for (const def of SHIP_TYPES) {
      const ids = flattenShipNodes(def).map((n) => n.id);
      expect(new Set(ids).size, def.slug).toBe(ids.length);
    }
  });

  it('모든 노드가 maxPoints ≥ 1, tier ≥ 0, 유한 perPoint 를 갖는다', () => {
    for (const def of SHIP_TYPES) {
      for (const n of flattenShipNodes(def)) {
        expect(n.maxPoints, n.id).toBeGreaterThanOrEqual(1);
        expect(n.tier, n.id).toBeGreaterThanOrEqual(0);
        // 정수만은 요구하지 않는다 — 기존 스트라이커 노드에 소수 perPoint 가 실재한다.
        expect(Number.isFinite(n.perPoint), n.id).toBe(true);
      }
    }
  });

  // (삭제됨) '스텁 노드는 perPoint 0' — M8-L6 이 타입 1~4 에 실데이터를 채워 전제가 소멸했다.
  // 대체 커버리지는 tests/shipContent.test.ts ③ 'base 노드는 유한 양수, 캡스톤은 정확히 0'
  // 이 담당하며, 범위가 더 넓다(구 케이스는 전부 0 만 봤고 신규는 base/캡스톤을 구분해 단언한다).

  it('각 트리 마지막 노드만 캡스톤이다', () => {
    for (const def of SHIP_TYPES) {
      for (const t of def.trees) {
        t.nodes.forEach((n, i) => {
          expect(n.capstone === true, `${def.slug}/${t.slug}[${i}]`).toBe(i === def.nodesPerTree);
        });
      }
    }
  });

  it('zeroSkillInvest 가 매번 새 배열을 준다 (한 기체 투자가 다른 기체로 새지 않음)', () => {
    const a = zeroSkillInvest(1);
    const b = zeroSkillInvest(1);
    expect(a).not.toBe(b);
    a[0] = 5;
    expect(b[0]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 정규 경로 통합 — 설계서 §10.
//
// 위 케이스는 전부 레지스트리를 직접 호출한다. 그것만으로는 **앱이 이 레지스트리를 실제로
// 타는지** 알 수 없다("단위 테스트 그린인데 배선이 통째로 없다" 8회 재발 유형). 아래는
// Profile 에서 출발해 src/main.ts 의 PvE 런 시작과 같은 함수·같은 순서로 config 를 조립하고
// createWorld/stepWorld 를 실제로 굴린다.
//
// ⚠️ M8-L7 이 `buildRunConfig(profile)` 를 추출하면 `assembleRunConfigLikeMain` 을 지우고 그
// 함수를 직접 호출할 것. 그 순간 이 테스트가 "앱 경로 == 레지스트리" 를 문자 그대로 증명한다.
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

describe('정규 경로 통합 — Profile → 런 설정 → createWorld/stepWorld', () => {
  it('기본 Profile 의 활성 기체가 타입 0 이고 벡터 길이가 레지스트리와 일치한다', () => {
    const ship = activeShip(defaultProfile());
    expect(ship.typeId).toBe(DEFAULT_SHIP_TYPE);
    expect(ship.skillInvest.length).toBe(shipSkillNodeCount(ship.typeId));
    expect(ship.skillInvest).toEqual(zeroSkillInvest(ship.typeId));
  });

  it('앱 경로가 만든 WorldConfig.skillInvest 가 레지스트리 벡터와 같고 sim 이 실제로 돈다', () => {
    const config = assembleRunConfigLikeMain(defaultProfile(), 0, 0);
    expect(config.skillInvest).toEqual(zeroSkillInvest(0));
    expect(config.skillInvest?.length).toBe(63);
    // 스트라이커는 시그니처가 없으므로 무투자 런의 uniqueMask 는 0 이어야 한다.
    expect(config.loadout?.uniqueMask).toBe(0);

    const hashes = runTicks(12345, config, 120);
    expect(hashes.length).toBe(120);
    // 월드가 정지해 있으면(전부 같은 해시) 이 테스트는 아무것도 증명하지 못한다.
    expect(new Set(hashes).size).toBeGreaterThan(60);
  });

  it('같은 Profile 은 같은 해시 스트림을 낸다 (결정론 — ADR-0005)', () => {
    const a = runTicks(777, assembleRunConfigLikeMain(defaultProfile(), 1, 0), 60);
    const b = runTicks(777, assembleRunConfigLikeMain(defaultProfile(), 1, 0), 60);
    expect(a).toEqual(b);
  });

  it('shipType 미지정 config 가 shipType:0 과 완전히 같다 (optional 계약)', () => {
    // ⚠️ M8-L7 확정: 앱 경로(`buildRunConfig`)는 스트라이커도 `shipType: 0` 을 **명시**한다
    // (EF 가 추론이 아니라 명시로 읽게 하려고 — 설계서 §4). 따라서 여기서 검증할 계약은
    // "앱이 필드를 비운다" 가 아니라 **"미지정과 0 이 관측상 완전히 동일하다"** 이다.
    // 이것이 곧 M8 이전 config(필드 자체가 없던 시절)의 해시 동결 근거다.
    const config = assembleRunConfigLikeMain(defaultProfile(), 0, 0);
    expect(config.shipType).toBe(0);
    const { shipType: _omitted, ...withoutField } = config;
    expect('shipType' in withoutField).toBe(false);
    expect(() => createWorld(1, withoutField)).not.toThrow();
    expect(runTicks(1, withoutField, 120)).toEqual(runTicks(1, config, 120));
  });
});
