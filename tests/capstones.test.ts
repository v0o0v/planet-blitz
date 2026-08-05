/**
 * 스킬트리 최상위 질적 캡스톤 3종 검증 (GDD §4).
 *
 * ① 화력 — 탄막 상쇄 레이저: 주기적 전방 레이저로 적탄 소거.
 * ② 생존 — 치명타 1회 무효: 런당 1회 치명 피격 무효 + 짧은 무적.
 * ③ 기동 — 대시 잔상 소거: 대시 시 반경 내 적탄 소거(잔상 추진기 유니크와 중첩 규칙).
 *
 * 게이트(계열 base 40pt), 하위 호환(미투자 시 거동·해시 불변), 리플레이 결정론을 함께 본다.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld,
  stepWorld,
  emptyInput,
  DEFAULT_CONFIG,
  PLAYER_DAMAGE_TAKEN_MULT,
} from '../src/sim/world.js';
import type { WorldConfig, WorldState } from '../src/sim/world.js';
import { spawnEnemyBullet } from '../src/sim/entities.js';
import { neutralLoadout, computeLoadoutStats } from '../src/items/loadout.js';
import { runReplay } from '../src/sim/replay.js';
import { hashWorld } from '../src/sim/replay.js';
import {
  CAP_FIREPOWER_LASER,
  CAP_SURVIVAL_CRIT,
  CAP_MOBILITY_DASH,
  LASER_PERIOD,
  LASER_RANGE,
  LASER_HALF_WIDTH,
  CRIT_NEGATE_IFRAMES,
  DASH_CLEAR_RADIUS,
  laserHits,
  hasCapstone,
} from '../src/sim/capstones.js';
import { UQ_AFTERIMAGE, AFTERIMAGE_RADIUS } from '../src/sim/uniques.js';
import {
  SKILLS,
  SKILL_NODE_COUNT,
  SKILL_TREES,
  CAPSTONE_GATE,
  capstoneIndex,
  capstoneUnlocked,
  capstoneActive,
  treeBaseInvested,
  treeRange,
  type SkillTree,
} from '../data/skills.js';
import { activeShip, defaultProfile, investSkill, zeroSkillInvest } from '../src/save/profile.js';
import {
  shipTreeBaseInvested,
  shipCapstoneUnlocked,
  shipCapstoneActive,
} from '../src/items/skills.js';
import {
  SHIP_TYPES,
  shipTypeDef,
  shipCapstoneIndex,
  shipTreeRange,
  zeroSkillInvest as registryZeroInvest,
} from '../data/ships/index.js';

/** uniqueMask 비트만 세운 로드아웃 config(캡스톤도 유니크와 같은 mask 비트를 씀). */
function capstoneCfg(bit: number): WorldConfig {
  return { ...DEFAULT_CONFIG, loadout: { ...neutralLoadout(), uniqueMask: 1 << bit } };
}

/** 계열 base 노드에 게이트만큼 투자 + 캡스톤 1pt 를 찍은 스킬 벡터. */
function investedVector(tree: SkillTree, basePts = CAPSTONE_GATE, capPts = 1): number[] {
  const v = zeroSkillInvest();
  const { start } = treeRange(tree);
  let remaining = basePts;
  for (let i = start; remaining > 0 && i < start + 20; i++) {
    const node = SKILLS[i]!;
    const put = Math.min(node.maxPoints, remaining);
    v[i] = put;
    remaining -= put;
  }
  v[capstoneIndex(tree)] = capPts;
  return v;
}

// ---------------------------------------------------------------------------
// 데이터 + 게이트 + 로드아웃 배선
// ---------------------------------------------------------------------------

describe('캡스톤 데이터 + 게이트 (GDD §4)', () => {
  it('인덱스 60·61·62 가 계열별 캡스톤이며 재번호되지 않았다', () => {
    expect(SKILL_NODE_COUNT).toBe(63);
    expect(capstoneIndex('firepower')).toBe(60);
    expect(capstoneIndex('survival')).toBe(61);
    expect(capstoneIndex('mobility')).toBe(62);
    expect(SKILLS[60]?.capstone).toBe(true);
    expect(SKILLS[61]?.capstone).toBe(true);
    expect(SKILLS[62]?.capstone).toBe(true);
  });

  it('게이트: base 투자 40 미만이면 잠김, 40 이상이면 해금', () => {
    const under = investedVector('firepower', CAPSTONE_GATE - 1, 0);
    expect(treeBaseInvested(under, 'firepower')).toBe(CAPSTONE_GATE - 1);
    expect(capstoneUnlocked(under, 'firepower')).toBe(false);
    const at = investedVector('firepower', CAPSTONE_GATE, 1);
    expect(capstoneUnlocked(at, 'firepower')).toBe(true);
    expect(capstoneActive(at, 'firepower')).toBe(true);
  });

  it('게이트 미달인데 캡스톤만 찍힌 손상 벡터는 비활성(robust)', () => {
    const v = zeroSkillInvest();
    v[capstoneIndex('survival')] = 1; // base 0 투자
    expect(capstoneActive(v, 'survival')).toBe(false);
  });

  it('loadout: 활성 계열만 uniqueMask 캡스톤 비트를 켠다', () => {
    const none = computeLoadoutStats([], zeroSkillInvest());
    expect(hasCapstone(none.loadout.uniqueMask, CAP_FIREPOWER_LASER)).toBe(false);

    const fp = computeLoadoutStats([], investedVector('firepower'));
    expect(hasCapstone(fp.loadout.uniqueMask, CAP_FIREPOWER_LASER)).toBe(true);
    expect(hasCapstone(fp.loadout.uniqueMask, CAP_SURVIVAL_CRIT)).toBe(false);

    const sv = computeLoadoutStats([], investedVector('survival'));
    expect(hasCapstone(sv.loadout.uniqueMask, CAP_SURVIVAL_CRIT)).toBe(true);
    const mb = computeLoadoutStats([], investedVector('mobility'));
    expect(hasCapstone(mb.loadout.uniqueMask, CAP_MOBILITY_DASH)).toBe(true);
  });

  it('게이트 미달 투자는 캡스톤 비트를 켜지 않는다(하위 호환)', () => {
    const under = investedVector('firepower', CAPSTONE_GATE - 4, 1); // 캡스톤 찍혀도 게이트 미달
    const lo = computeLoadoutStats([], under);
    expect(hasCapstone(lo.loadout.uniqueMask, CAP_FIREPOWER_LASER)).toBe(false);
  });

  it('investSkill: 게이트 전에는 캡스톤 투자 거부, 후에는 허용', () => {
    const p = defaultProfile();
    p.skillPoints = 100;
    // base 게이트 미달 상태에서 캡스톤 투자 시도 → 거부.
    expect(investSkill(p, capstoneIndex('firepower'))).toBe(false);
    // base 40 투자 후 → 허용.
    const { start } = treeRange('firepower');
    let need = CAPSTONE_GATE;
    for (let i = start; need > 0 && i < start + 20; i++) {
      const put = Math.min(SKILLS[i]!.maxPoints, need);
      for (let k = 0; k < put; k++) investSkill(p, i);
      need -= put;
    }
    expect(capstoneUnlocked(activeShip(p).skillInvest, 'firepower')).toBe(true);
    expect(investSkill(p, capstoneIndex('firepower'))).toBe(true);
    expect(activeShip(p).skillInvest[capstoneIndex('firepower')]).toBe(1);
    // maxPoints 1 이라 두 번째 투자는 거부.
    expect(investSkill(p, capstoneIndex('firepower'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ① 화력 — 탄막 상쇄 레이저
// ---------------------------------------------------------------------------

describe('① 화력 캡스톤 — 탄막 상쇄 레이저', () => {
  it('laserHits: 전방 사거리·반폭 안만 참', () => {
    // 조준 +x 방향. 전방 500·중심 → 참.
    expect(laserHits(0, 0, 1, 0, 500, 0)).toBe(true);
    // 사거리 밖 → 거짓.
    expect(laserHits(0, 0, 1, 0, LASER_RANGE + 10, 0)).toBe(false);
    // 뒤쪽 → 거짓.
    expect(laserHits(0, 0, 1, 0, -50, 0)).toBe(false);
    // 반폭 밖 → 거짓.
    expect(laserHits(0, 0, 1, 0, 500, LASER_HALF_WIDTH + 5)).toBe(false);
    // 반폭 경계 안 → 참.
    expect(laserHits(0, 0, 1, 0, 500, LASER_HALF_WIDTH)).toBe(true);
  });

  it('발동 틱에 전방 적탄만 소거하고 후방은 남긴다', () => {
    const state = createWorld(1, capstoneCfg(CAP_FIREPOWER_LASER));
    const player = state.entities[0]!;
    // 조준 +x. 전방·후방·측면(반폭 밖)에 적탄을 둔다.
    const front = spawnEnemyBullet(state, player.x + 400, player.y, 0, 0, 0, 5, 6, 999);
    const back = spawnEnemyBullet(state, player.x - 400, player.y, 0, 0, 0, 5, 6, 999);
    const side = spawnEnemyBullet(state, player.x + 400, player.y + LASER_HALF_WIDTH + 50, 0, 0, 0, 5, 6, 999);
    // tick 은 증가 전에 읽히므로 첫 스텝(tick 0)이 곧 발동 틱(0 % LASER_PERIOD === 0).
    stepWorld(state, { ...emptyInput(), aim: 0 });
    expect(state.tick).toBe(1); // 한 틱 진행됨
    expect(front.dead).toBe(true); // 전방 소거
    expect(back.dead).toBe(false); // 후방 생존
    expect(side.dead).toBe(false); // 반폭 밖 생존
  });

  it('비발동 틱에는 소거하지 않는다', () => {
    const state = createWorld(1, capstoneCfg(CAP_FIREPOWER_LASER));
    const player = state.entities[0]!;
    stepWorld(state, { ...emptyInput(), aim: 0 }); // tick 0 발동 소거
    // 이제 tick=1. 새 전방 적탄을 두고 한 틱(tick 1, 비발동) → 생존.
    const b = spawnEnemyBullet(state, player.x + 400, player.y, 0, 0, 0, 5, 6, 999);
    stepWorld(state, { ...emptyInput(), aim: 0 });
    expect(b.dead).toBe(false);
  });

  it('미투자(캡스톤 없음)면 적탄이 소거되지 않는다(하위 호환)', () => {
    const state = createWorld(1, { ...DEFAULT_CONFIG, loadout: neutralLoadout() });
    const player = state.entities[0]!;
    const b = spawnEnemyBullet(state, player.x + 400, player.y, 0, 0, 0, 5, 6, 999);
    for (let t = 0; t < LASER_PERIOD + 2; t++) stepWorld(state, { ...emptyInput(), aim: 0 });
    expect(b.dead).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ② 생존 — 치명타 1회 무효
// ---------------------------------------------------------------------------

/** 플레이어를 치명 피해로 때린다(무적 해제 후 겹치는 적탄). */
function lethalHit(state: WorldState, dmg: number): void {
  const player = state.entities[0]!;
  player.iframes = 0;
  spawnEnemyBullet(state, player.x, player.y, 0, 0, 0, dmg, 6, 30);
  stepWorld(state, emptyInput());
}

describe('② 생존 캡스톤 — 치명타 1회 무효', () => {
  it('첫 치명 피격을 무효화하고 짧은 무적을 준다', () => {
    const state = createWorld(1, capstoneCfg(CAP_SURVIVAL_CRIT));
    const player = state.entities[0]!;
    const hp0 = player.hp;
    lethalHit(state, hp0 + 50); // 즉사급 피해
    expect(player.hp).toBe(hp0); // 피해 무효(체력 불변)
    expect(player.iframes).toBeGreaterThanOrEqual(CRIT_NEGATE_IFRAMES - 1);
    expect(state.gameOver).toBe(false);
  });

  it('런당 1회만 발동 — 두 번째 치명 피격은 그대로 죽는다', () => {
    const state = createWorld(1, capstoneCfg(CAP_SURVIVAL_CRIT));
    const player = state.entities[0]!;
    lethalHit(state, player.hp + 50); // 1회 무효 소진
    expect(player.hp).toBeGreaterThan(0);
    // 무적 프레임을 비우고 두 번째 치명타.
    lethalHit(state, player.maxHp + 50);
    expect(player.hp).toBe(0);
  });

  it('치명적이지 않은 피격은 무효화하지 않는다(정상 피해)', () => {
    const state = createWorld(1, capstoneCfg(CAP_SURVIVAL_CRIT));
    const player = state.entities[0]!;
    const hp0 = player.hp;
    lethalHit(state, 10); // 비치명
    // 선체에 들어오는 양은 피격 피해 배수를 탄다 — 리터럴로 적으면 배수를 바꿀 때마다 썩는다.
    expect(player.hp).toBe(hp0 - 10 * PLAYER_DAMAGE_TAKEN_MULT);
  });

  it('미투자면 치명 피격에 그대로 죽는다(하위 호환)', () => {
    const state = createWorld(1, { ...DEFAULT_CONFIG, loadout: neutralLoadout() });
    const player = state.entities[0]!;
    lethalHit(state, player.hp + 50);
    expect(player.hp).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ③ 기동 — 대시 잔상 소거
// ---------------------------------------------------------------------------

describe('③ 기동 캡스톤 — 대시 잔상 소거', () => {
  it('대시 시 반경 내 적탄을 소거한다', () => {
    const state = createWorld(1, capstoneCfg(CAP_MOBILITY_DASH));
    const player = state.entities[0]!;
    const near = spawnEnemyBullet(state, player.x + 100, player.y, 0, 0, 0, 5, 6, 999);
    const far = spawnEnemyBullet(state, player.x + DASH_CLEAR_RADIUS + 80, player.y, 0, 0, 0, 5, 6, 999);
    stepWorld(state, { ...emptyInput(), moveX: 1, dash: true });
    expect(near.dead).toBe(true);
    expect(far.dead).toBe(false);
  });

  it('잔상 추진기 유니크보다 넓은 반경으로 소거한다', () => {
    // 잔상 반경(220)과 캡스톤 반경(320) 사이에 적탄을 둔다.
    const mid = (AFTERIMAGE_RADIUS + DASH_CLEAR_RADIUS) / 2;
    const state = createWorld(1, capstoneCfg(CAP_MOBILITY_DASH));
    const player = state.entities[0]!;
    const b = spawnEnemyBullet(state, player.x + mid, player.y, 0, 0, 0, 5, 6, 999);
    stepWorld(state, { ...emptyInput(), moveX: 1, dash: true });
    expect(b.dead).toBe(true);
    expect(DASH_CLEAR_RADIUS).toBeGreaterThan(AFTERIMAGE_RADIUS);
  });

  it('중첩(잔상+캡스톤): 큰 반경으로 한 번만 소거', () => {
    const mid = (AFTERIMAGE_RADIUS + DASH_CLEAR_RADIUS) / 2;
    const state = createWorld(1, {
      ...DEFAULT_CONFIG,
      loadout: { ...neutralLoadout(), uniqueMask: (1 << UQ_AFTERIMAGE) | (1 << CAP_MOBILITY_DASH) },
    });
    const player = state.entities[0]!;
    const b = spawnEnemyBullet(state, player.x + mid, player.y, 0, 0, 0, 5, 6, 999);
    stepWorld(state, { ...emptyInput(), moveX: 1, dash: true });
    expect(b.dead).toBe(true); // 캡스톤 반경(더 큼)으로 소거됨
  });

  it('미투자면 대시가 적탄을 소거하지 않는다(하위 호환)', () => {
    const state = createWorld(1, { ...DEFAULT_CONFIG, loadout: neutralLoadout() });
    const player = state.entities[0]!;
    const b = spawnEnemyBullet(state, player.x + 100, player.y, 0, 0, 0, 5, 6, 999);
    stepWorld(state, { ...emptyInput(), moveX: 1, dash: true });
    expect(b.dead).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 결정론 + 하위 호환 해시
// ---------------------------------------------------------------------------

describe('캡스톤 결정론 + 해시 불변', () => {
  it('캡스톤 런은 리플레이가 bit-identical', () => {
    const cfg = capstoneCfg(CAP_FIREPOWER_LASER);
    const inputs = [];
    for (let i = 0; i < 300; i++) {
      inputs.push({ ...emptyInput(), moveX: i % 3 === 0 ? 1 : 0, aim: (i % 8) * 0.3, dash: i % 50 === 0 });
    }
    const a = runReplay({ seed: 7, config: cfg, inputs });
    const b = runReplay({ seed: 7, config: cfg, inputs });
    expect(a.finalHash).toBe(b.finalHash);
    expect(a.hashes).toEqual(b.hashes);
  });

  it('게이트 미달 캡스톤 투자는 로드아웃을 바꾸지 않는다(mask 0 + 스탯 동일 → 해시 불변)', () => {
    // 같은 base 투자(36pt, 게이트 40 미달) — 한쪽은 캡스톤에 1pt 추가로 찍는다.
    const base = investedVector('firepower', CAPSTONE_GATE - 4, 0);
    const withCapPt = base.slice();
    withCapPt[capstoneIndex('firepower')] = 1;
    const loA = computeLoadoutStats([], base).loadout;
    const loB = computeLoadoutStats([], withCapPt).loadout;
    // 게이트 미달이라 캡스톤 비트가 켜지지 않고, 캡스톤은 수치도 기여하지 않으므로 완전 동일.
    expect(loB.uniqueMask).toBe(0);
    expect(loB).toEqual(loA);
    // 실제 런 상태 해시도 동일.
    const wa = createWorld(3, { ...DEFAULT_CONFIG, loadout: loA });
    const wb = createWorld(3, { ...DEFAULT_CONFIG, loadout: loB });
    for (let t = 0; t < 120; t++) {
      stepWorld(wa, emptyInput());
      stepWorld(wb, emptyInput());
    }
    expect(hashWorld(wb)).toBe(hashWorld(wa));
  });
});

// ===========================================================================
// M8-L4 — 캡스톤 게이트의 타입별 일반화 (설계서 §4)
//
// `data/skills.ts` 의 capstoneActive 계열은 스트라이커 전용(트리를 문자열로 받는다).
// src/items/skills.ts 가 같은 규칙을 ShipTypeDef + 트리 인덱스로 일반화했고, 아래 케이스가
// ① 스트라이커에서 두 경로가 **완전 동치**임을 전 계열·전 경계에서 못 박고
// ② 신규 타입의 캡스톤 비트가 **affinity 로** 골라짐을 증명한다(트리 인덱스로 고르면 오답).
// ===========================================================================

/** 임의 타입의 `treeIndex` 계열에 base `basePts` + 캡스톤 `capPts` 를 찍은 벡터. */
function shipInvestedVector(typeId: number, treeIndex: number, basePts: number, capPts: number): number[] {
  const def = shipTypeDef(typeId);
  const v = registryZeroInvest(typeId);
  const { start, end } = shipTreeRange(def, treeIndex);
  let remaining = basePts;
  const nodes = def.trees[treeIndex]?.nodes ?? [];
  for (let i = start; remaining > 0 && i < end; i++) {
    const max = nodes[i - start]?.maxPoints ?? 0;
    const put = Math.min(max, remaining);
    v[i] = put;
    remaining -= put;
  }
  v[shipCapstoneIndex(def, treeIndex)] = capPts;
  return v;
}

describe('타입별 캡스톤 게이트 — 스트라이커 동치 + affinity 매핑', () => {
  it('스트라이커: 신규 3함수가 레거시 3함수와 전 경계에서 동치', () => {
    const striker = shipTypeDef(0);
    for (let ti = 0; ti < SKILL_TREES.length; ti++) {
      const tree = SKILL_TREES[ti]!;
      expect(shipCapstoneIndex(striker, ti)).toBe(capstoneIndex(tree));
      expect(shipTreeRange(striker, ti)).toEqual(treeRange(tree));
      for (const basePts of [0, 1, CAPSTONE_GATE - 1, CAPSTONE_GATE, CAPSTONE_GATE + 12]) {
        for (const capPts of [0, 1]) {
          const v = investedVector(tree, basePts, capPts);
          expect(shipTreeBaseInvested(v, striker, ti)).toBe(treeBaseInvested(v, tree));
          expect(shipCapstoneUnlocked(v, striker, ti)).toBe(capstoneUnlocked(v, tree));
          expect(shipCapstoneActive(v, striker, ti)).toBe(capstoneActive(v, tree));
        }
      }
    }
  });

  it('스트라이커: 세 계열 전부 투자한 벡터의 uniqueMask 가 레거시 3비트와 정확히 일치', () => {
    const v = zeroSkillInvest();
    for (const tree of SKILL_TREES) {
      const { start } = treeRange(tree);
      let need = CAPSTONE_GATE;
      for (let i = start; need > 0 && i < start + 20; i++) {
        const put = Math.min(SKILLS[i]!.maxPoints, need);
        v[i] = put;
        need -= put;
      }
      v[capstoneIndex(tree)] = 1;
    }
    const mask = computeLoadoutStats([], v).loadout.uniqueMask;
    expect(mask).toBe((1 << CAP_FIREPOWER_LASER) | (1 << CAP_SURVIVAL_CRIT) | (1 << CAP_MOBILITY_DASH));
    // typeId 를 명시해도 동일해야 한다(스트라이커 불변 관문).
    expect(computeLoadoutStats([], v, undefined, 0).loadout.uniqueMask).toBe(mask);
  });

  it('신규 타입: 캡스톤 비트를 트리 인덱스가 아니라 affinity 로 고른다', () => {
    for (const def of SHIP_TYPES) {
      if (def.id === 0) continue;
      for (let ti = 0; ti < def.trees.length; ti++) {
        const tree = def.trees[ti]!;
        const v = shipInvestedVector(def.id, ti, def.capstoneGate, 1);
        expect(shipCapstoneActive(v, def, ti)).toBe(true);
        const mask = computeLoadoutStats([], v, undefined, def.id).loadout.uniqueMask;
        const expected =
          tree.affinity === 'offense'
            ? CAP_FIREPOWER_LASER
            : tree.affinity === 'defense'
              ? CAP_SURVIVAL_CRIT
              : CAP_MOBILITY_DASH;
        expect(hasCapstone(mask, expected)).toBe(true);
        for (const other of [CAP_FIREPOWER_LASER, CAP_SURVIVAL_CRIT, CAP_MOBILITY_DASH]) {
          if (other === expected) continue;
          expect(hasCapstone(mask, other)).toBe(false);
        }
      }
    }
  });

  it('신규 타입: 게이트 미달 캡스톤 투자는 비트를 켜지 않는다(손상 벡터 robust)', () => {
    const def = shipTypeDef(1);
    const v = shipInvestedVector(1, 0, def.capstoneGate - 1, 1);
    expect(shipCapstoneUnlocked(v, def, 0)).toBe(false);
    expect(shipCapstoneActive(v, def, 0)).toBe(false);
    const mask = computeLoadoutStats([], v, undefined, 1).loadout.uniqueMask;
    // 시그니처 비트만 켜져 있고 캡스톤 비트는 꺼져 있어야 한다.
    expect(hasCapstone(mask, CAP_FIREPOWER_LASER)).toBe(false);
    expect(hasCapstone(mask, def.signatureBit)).toBe(true);
  });
});
