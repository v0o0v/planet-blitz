/**
 * M3 Lane 2 콘텐츠 검증 (plan B1~B4 — AC4·AC5·AC6·AC2).
 *
 * 니플헤임·아르케 로스터/보스, 섬멸 티어(파라미터·엘리트 8종·레벨 게이트), 어픽스 24종
 * +원소 상태이상, 유니크 15점을 데이터·시뮬 양면에서 확인한다. 시뮬 훅은 결정론
 * (고정 입력/산술)만 사용한다.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld,
  stepWorld,
  emptyInput,
  DEFAULT_CONFIG,
} from '../src/sim/world.js';
import type { WorldConfig, WorldState } from '../src/sim/world.js';
import { blankEntity, addEntity, spawnEnemyBullet, spawnHazard, spawnGem } from '../src/sim/entities.js';
import { neutralLoadout } from '../src/items/loadout.js';
import { runReplay } from '../src/sim/replay.js';
import { ENEMY_BY_TYPE } from '../data/enemies.js';
import { PLANETS, NIFLHEIM, ARKE, planetContent } from '../data/planets/index.js';
import { AFFIXES, PREFIXES } from '../data/affixes.js';
import { M2_UNIQUES, M3_UNIQUES } from '../data/uniques.js';
import {
  STAGE_MILESTONES,
  LEVEL_CAP,
  stageParams,
  stageHpMult,
  stageOpenCap,
  isStageOpen,
} from '../data/waves.js';
import { HAZARD_SLOW } from '../src/sim/patterns/types.js';
import {
  makeElite,
  isElite,
  eliteDamageTakenMult,
  applyEliteRegen,
  spawnEliteDeathFx,
  ELITE_AFFIX_COUNT,
  ELITE_REGEN,
  ELITE_SHIELDED,
  ELITE_VOLATILE,
} from '../src/sim/elite.js';
import {
  applyBurn,
  applySlow,
  tickEnemyStatus,
  applyChain,
  enemyStatusSlowMult,
  COLD_SLOW_MULT,
} from '../src/sim/status.js';
import {
  UQ_SINGULARITY,
  UQ_REACTIVE_ARMOR,
  UQ_AFTERIMAGE,
  UQ_GREED_HEART,
  UQ_HIVE_SWARM,
  UQ_CONVERGE_PRISM,
  UQ_TWIN_STAR,
  UQ_GAMBLER_CHIP,
  HIVE_MICRO_MARK,
} from '../src/sim/uniques.js';
import {
  WEAPON_SPREAD,
  WEAPON_MISSILE,
  WEAPON_BEAM,
} from '../src/items/loadout.js';
import { SKILL_NODE_COUNT } from '../data/skills.js';

/** uniqueMask 비트만 세운 로드아웃 config. */
function uniqueCfg(bit: number): WorldConfig {
  return { ...DEFAULT_CONFIG, loadout: { ...neutralLoadout(), uniqueMask: 1 << bit } };
}

/** 무기타입 + uniqueMask를 함께 세운 로드아웃 config(무기타입 의존 유니크용). */
function weaponUniqueCfg(weaponType: number, mask: number, extra: Partial<WorldConfig> = {}): WorldConfig {
  return {
    ...DEFAULT_CONFIG,
    ...extra,
    loadout: { ...neutralLoadout(), weaponType, uniqueMask: mask },
  };
}

/** 몇 개 노드에만 투자한 길이 60 스킬 벡터(Lane1 결정론 필드 자극용). */
function sampleSkillInvest(): number[] {
  const v = Array<number>(SKILL_NODE_COUNT).fill(0);
  v[0] = 3; // firepower tier0
  v[20] = 2; // survival tier0
  v[40] = 4; // mobility tier0
  return v;
}

/** 플레이어 근처에 정지 표적 적을 둔다. */
function addEnemy(state: WorldState, dx: number, dy = 0, hp = 1_000_000) {
  const player = state.entities[0]!;
  const e = blankEntity('enemy');
  e.x = player.x + dx;
  e.y = player.y + dy;
  e.radius = 30;
  e.hp = hp;
  e.maxHp = hp;
  e.enemyType = 0;
  return addEntity(state, e);
}

// ---------------------------------------------------------------------------
// B1/B2 — 니플헤임·아르케 로스터 + 보스 (AC4)
// ---------------------------------------------------------------------------

describe('행성 레지스트리 확장 (B1/B2, AC4)', () => {
  it('니플헤임(2)·아르케(3)가 성계 지도에 등록된다', () => {
    expect(PLANETS.length).toBe(4);
    expect(PLANETS[2]).toBe(NIFLHEIM);
    expect(PLANETS[3]).toBe(ARKE);
    expect(planetContent(2).id).toBe('niflheim');
    expect(planetContent(3).id).toBe('arke');
  });

  it('두 행성 모두 잡몹 4역할·엘리트 2종·특산 광물 2종을 갖춘다', () => {
    for (const p of [NIFLHEIM, ARKE]) {
      expect(Object.keys(p.roster).sort()).toEqual(['charger', 'gunner', 'special', 'support']);
      expect(p.elites.length).toBe(2);
      expect(p.minerals.length).toBe(2);
      expect(p.cardPool.length).toBeGreaterThanOrEqual(6);
    }
  });

  it('유령 기함·수호자 오벨리스크는 3페이즈이고 신규 공격 컴포넌트를 쓴다', () => {
    expect(NIFLHEIM.boss.phases.length).toBe(3);
    expect(ARKE.boss.phases.length).toBe(3);
    const nflKinds = NIFLHEIM.boss.phases.flatMap((ph) => ph.attacks.map((a) => a.kind));
    expect(nflKinds).toContain('laserNet');
    expect(nflKinds).toContain('slowField');
    const arkKinds = ARKE.boss.phases.flatMap((ph) => ph.attacks.map((a) => a.kind));
    expect(arkKinds).toContain('polygonSpin');
  });

  it('ENEMY_BY_TYPE가 22종(카르곤~아르케)으로 연속 typeIndex를 유지한다', () => {
    expect(ENEMY_BY_TYPE.length).toBe(22);
    ENEMY_BY_TYPE.forEach((def, i) => expect(def.typeIndex).toBe(i));
  });
});

describe('감속 지대 (B1 유령 기함, AC4)', () => {
  it('활성 HAZARD_SLOW 장판에 닿으면 플레이어가 감속되고 이동이 느려진다', () => {
    // 감속은 접촉(resolveCollisions)한 tick의 다음 tick부터 stepPlayer에 반영된다.
    const slowed = createWorld(2);
    const sp = slowed.entities[0]!;
    spawnHazard(slowed, HAZARD_SLOW, sp.x, sp.y, 120, 0, 300, 6, true, 0);
    expect(slowed.playerSlowTicks).toBe(0);
    stepWorld(slowed, { ...emptyInput(), moveX: 1 }); // tick1: 접촉→감속 부여
    expect(slowed.playerSlowTicks).toBeGreaterThan(0);
    const sx1 = slowed.entities[0]!.x;
    stepWorld(slowed, { ...emptyInput(), moveX: 1 }); // tick2: 감속 적용
    const slowedDelta = slowed.entities[0]!.x - sx1;

    // 장판 없는 정상 런의 2틱째 이동 델타.
    const normal = createWorld(2);
    stepWorld(normal, { ...emptyInput(), moveX: 1 });
    const nx1 = normal.entities[0]!.x;
    stepWorld(normal, { ...emptyInput(), moveX: 1 });
    const normalDelta = normal.entities[0]!.x - nx1;

    expect(slowedDelta).toBeLessThan(normalDelta);
  });
});

// ---------------------------------------------------------------------------
// 침략 단계 파라미터 + 구간 마일스톤 + 개방 규칙 (ADR-0022, Lane1 게이트 1)
// ---------------------------------------------------------------------------

describe('침략 단계 파라미터 (ADR-0022)', () => {
  it('단계 1 은 구 정찰(tier0) 파라미터를 정확히 보존한다(결정론 규율 1)', () => {
    // 부동소수 오차 금지 — hpMult 는 정확히 1.
    expect(stageHpMult(1)).toBe(1);
    expect(stageParams(1)).toEqual({ hpMult: 1, densityMult: 1, eliteCount: 0, subBullets: 0 });
  });

  it('밴드 대표 단계(1/11/21)가 구 3티어(정찰/교전/섬멸) 값을 재배치한다', () => {
    expect(STAGE_MILESTONES.length).toBe(3);
    // 밴드1(단계11) = 구 교전: HP ×2.2·정예 1·서브탄 0·밀도 1.
    expect(stageParams(11)).toEqual({ hpMult: 2.2, densityMult: 1, eliteCount: 1, subBullets: 0 });
    // 밴드2(단계21) = 구 섬멸: HP ×4.5·정예 2·서브탄 3·밀도 1.5.
    expect(stageParams(21)).toEqual({ hpMult: 4.5, densityMult: 1.5, eliteCount: 2, subBullets: 3 });
  });

  it('hpMult 가 단계마다 연속 상향한다(단계1 < 단계11 < 단계21 < 단계31)', () => {
    expect(stageHpMult(1)).toBeLessThan(stageHpMult(11));
    expect(stageHpMult(11)).toBeLessThan(stageHpMult(21));
    expect(stageHpMult(21)).toBeLessThan(stageHpMult(31));
    // 범위 밖(<1)은 단계 1로 클램프.
    expect(stageParams(0)).toEqual(stageParams(1));
  });

  it('레벨 캡 100 이 데이터로 존재한다(기체 레벨은 단계를 잠그지 않는 순수 앵커)', () => {
    expect(LEVEL_CAP).toBe(100);
  });

  it('개방 규칙: max(10, 최고클리어+5)·1..상한만 개방(Lane1 게이트 1)', () => {
    expect(stageOpenCap(0)).toBe(10);
    expect(stageOpenCap(20)).toBe(25);
    expect(isStageOpen(10, 0)).toBe(true);
    expect(isStageOpen(11, 0)).toBe(false);
    expect(isStageOpen(26, 20)).toBe(false);
    expect(isStageOpen(0, 0)).toBe(false); // 단계는 1 이상
  });

  it('높은 단계가 잡몹 스폰 HP를 연속 상향한다(단계1 < 단계21)', () => {
    const recon = createWorld(0x9001, { ...DEFAULT_CONFIG, stage: 1 });
    const annih = createWorld(0x9001, { ...DEFAULT_CONFIG, stage: 21 });
    for (let t = 0; t < 60; t++) {
      stepWorld(recon, emptyInput());
      stepWorld(annih, emptyInput());
    }
    const maxHp = (s: WorldState) =>
      Math.max(0, ...s.entities.filter((e) => e.kind === 'enemy' && !isElite(e)).map((e) => e.maxHp));
    // 같은 시드라 동일 def가 스폰되므로 높은 단계의 최대 HP가 단계1보다 높다.
    expect(maxHp(annih)).toBeGreaterThan(maxHp(recon));
  });
});

describe('엘리트 어픽스 8종 완성 (B3, AC5)', () => {
  it('어픽스 풀이 8종이다', () => {
    expect(ELITE_AFFIX_COUNT).toBe(8);
  });

  it('재생하는 엘리트는 손상 시 매 틱 회복한다', () => {
    const e = blankEntity('enemy');
    e.hp = 100;
    e.maxHp = 100;
    e.radius = 20;
    makeElite(e, ELITE_REGEN); // hp=maxHp로 버프됨
    e.hp = e.maxHp - 50; // 손상 시뮬
    const before = e.hp;
    applyEliteRegen(e);
    expect(e.hp).toBeGreaterThan(before);
    expect(e.hp).toBeLessThanOrEqual(e.maxHp);
  });

  it('보호막의 엘리트는 받는 피해가 절반이다', () => {
    const shielded = blankEntity('enemy');
    shielded.radius = 20;
    shielded.hp = 100;
    makeElite(shielded, ELITE_SHIELDED);
    expect(eliteDamageTakenMult(shielded)).toBe(0.5);
    const normal = blankEntity('enemy');
    expect(eliteDamageTakenMult(normal)).toBe(1);
  });

  it('폭발성의 엘리트는 사망 시 방사 폭발(적탄)을 남긴다', () => {
    const state = createWorld(1);
    const e = blankEntity('enemy');
    e.x = 0;
    e.y = 0;
    e.radius = 20;
    e.hp = 1;
    makeElite(e, ELITE_VOLATILE);
    state.bulletCap = 2000;
    const before = state.entities.filter((b) => b.kind === 'enemyBullet').length;
    spawnEliteDeathFx(state, e);
    const after = state.entities.filter((b) => b.kind === 'enemyBullet').length;
    expect(after - before).toBeGreaterThan(8); // 분열하는(8)보다 큰 폭발
  });
});

// ---------------------------------------------------------------------------
// B4 — 어픽스 24종 + 상태이상 + 유니크 15점 (AC6)
// ---------------------------------------------------------------------------

describe('어픽스 24종 완성 (B4, AC6)', () => {
  it('풀이 24종이고 원소 프리픽스 3종(화염·냉기·전격)을 포함한다', () => {
    expect(AFFIXES.length).toBe(24);
    expect(PREFIXES.length).toBe(12);
    const stats = new Set(PREFIXES.map((p) => p.stat));
    expect(stats.has('fireDmg')).toBe(true);
    expect(stats.has('coldSlow')).toBe(true);
    expect(stats.has('lightning')).toBe(true);
  });
});

describe('원소 상태이상 시스템 (B4, AC6)', () => {
  it('화염: 지속피해가 매 틱 HP를 깎고 타이머가 끝나면 멈춘다', () => {
    const e = blankEntity('enemy');
    e.hp = 100;
    e.maxHp = 100;
    applyBurn(e, 5, 3);
    expect(e.iframes).toBe(3);
    expect(e.dashCooldown).toBe(5);
    tickEnemyStatus(e); // 95
    tickEnemyStatus(e); // 90
    tickEnemyStatus(e); // 85, 타이머 0 → dashCooldown 리셋
    expect(e.hp).toBe(85);
    expect(e.iframes).toBe(0);
    expect(e.dashCooldown).toBe(0);
    tickEnemyStatus(e); // no-op
    expect(e.hp).toBe(85);
  });

  it('냉기: 감속 타이머 동안 이동 속도 배율이 줄고 매 틱 감소한다', () => {
    const e = blankEntity('enemy');
    applySlow(e, 2);
    expect(enemyStatusSlowMult(e)).toBe(COLD_SLOW_MULT);
    tickEnemyStatus(e);
    expect(e.ownerId).toBe(1);
    tickEnemyStatus(e);
    expect(e.ownerId).toBe(0);
    expect(enemyStatusSlowMult(e)).toBe(1);
  });

  it('전격: 명중 지점 인접 적에게 즉시 연쇄 피해가 퍼진다', () => {
    const state = createWorld(1);
    const origin = addEnemy(state, 0, 0);
    const near = addEnemy(state, 60, 0);
    const far = addEnemy(state, 5000, 0);
    const nearHp0 = near.hp;
    const farHp0 = far.hp;
    applyChain(state, origin, 30);
    expect(near.hp).toBeLessThan(nearHp0); // 인접 적 피해
    expect(far.hp).toBe(farHp0); // 반경 밖은 무피해
  });

  it('화염 로드아웃 런이 적에게 화염 상태를 실제로 건다', () => {
    const cfg: WorldConfig = { ...DEFAULT_CONFIG, loadout: { ...neutralLoadout(), fireDmg: 4 } };
    const state = createWorld(1, cfg);
    addEnemy(state, 180);
    for (let t = 0; t < 30; t++) stepWorld(state, emptyInput());
    const enemy = state.entities.find((e) => e.kind === 'enemy');
    expect(enemy).toBeDefined();
    expect(enemy!.iframes).toBeGreaterThan(0); // 화염 잔여 틱
  });
});

describe('유니크 15점 완성 (B4, AC6)', () => {
  it('레지스트리가 M2 5 + M3 10 = 15점이고 비트가 유일하다', () => {
    const all = [...M2_UNIQUES, ...M3_UNIQUES];
    expect(all.length).toBe(15);
    expect(new Set(all.map((u) => u.bit)).size).toBe(15);
    expect(new Set(all.map((u) => u.id)).size).toBe(15);
  });

  it('특이점 발생기: 반경 안 적을 플레이어 쪽으로 흡인한다', () => {
    const state = createWorld(1, uniqueCfg(UQ_SINGULARITY));
    const enemy = addEnemy(state, 400, 0); // 반경(460) 안, 정지형
    enemy.enemyType = 2; // stationary(lava spring) → 자체 이동 없음
    const d0 = Math.abs(enemy.x - state.entities[0]!.x);
    stepWorld(state, emptyInput());
    const d1 = Math.abs(enemy.x - state.entities[0]!.x);
    expect(d1).toBeLessThan(d0);
  });

  it('반응 장갑: 피격 시 방사형 반격 펄스(아군탄)를 방출한다', () => {
    const state = createWorld(1, uniqueCfg(UQ_REACTIVE_ARMOR));
    const player = state.entities[0]!;
    player.iframes = 0;
    spawnEnemyBullet(state, player.x, player.y, 0, 0, 0, 5, 6, 30);
    const before = state.entities.filter((e) => e.kind === 'bullet').length;
    stepWorld(state, emptyInput());
    const after = state.entities.filter((e) => e.kind === 'bullet').length;
    expect(after).toBeGreaterThan(before);
  });

  it('잔상 추진기: 대시 시 주변 적탄을 소거한다', () => {
    const state = createWorld(1, uniqueCfg(UQ_AFTERIMAGE));
    const player = state.entities[0]!;
    const bullet = spawnEnemyBullet(state, player.x + 100, player.y, 0, 0, 0, 5, 6, 300);
    stepWorld(state, { ...emptyInput(), moveX: 1, dash: true });
    expect(bullet.dead || !state.entities.includes(bullet)).toBe(true);
  });

  it('탐욕의 심장: 젬 획득 시 콤보 지속 연장 + 자석 반경 스택', () => {
    const state = createWorld(1, uniqueCfg(UQ_GREED_HEART));
    const player = state.entities[0]!;
    const magnet0 = state.magnetRadius;
    spawnGem(state, player.x, player.y, 5); // 플레이어 위 → 즉시 수거
    stepWorld(state, emptyInput());
    expect(state.combo).toBeGreaterThan(0);
    expect(state.magnetRadius).toBeGreaterThan(magnet0);
  });

  it('쌍둥이 항성(스프레드): 부채꼴 발사체를 2배로 늘린다', () => {
    // 동일 스프레드 무기에서 유니크 유/무만 다르게 두고 한 tick 발사체 수를 비교.
    const plain = createWorld(1, weaponUniqueCfg(WEAPON_SPREAD, 0));
    const twin = createWorld(1, weaponUniqueCfg(WEAPON_SPREAD, 1 << UQ_TWIN_STAR));
    for (const s of [plain, twin]) addEnemy(s, 200, 0);
    stepWorld(plain, emptyInput());
    stepWorld(twin, emptyInput());
    const nPlain = plain.entities.filter((e) => e.kind === 'bullet').length;
    const nTwin = twin.entities.filter((e) => e.kind === 'bullet').length;
    expect(nPlain).toBeGreaterThan(0);
    expect(nTwin).toBe(nPlain * 2);
  });

  it('군집 벌통(미사일): 미사일이 적을 격추하면 마이크로 미사일을 방사한다', () => {
    const state = createWorld(1, weaponUniqueCfg(WEAPON_MISSILE, 1 << UQ_HIVE_SWARM));
    addEnemy(state, 70, 0, 1); // 근접·저체력 → 첫 미사일이 격추
    let micros = 0;
    for (let t = 0; t < 20 && micros === 0; t++) {
      stepWorld(state, emptyInput());
      micros = state.entities.filter((e) => e.kind === 'bullet' && e.ownerId === HIVE_MICRO_MARK).length;
    }
    expect(micros).toBeGreaterThan(0);
  });

  it('수렴 프리즘(빔): 관통한 적 수만큼 피해가 증폭된다', () => {
    // 첫 빔 세그먼트(dist 90) 위에 적 2기를 겹쳐 두면, 프리즘 런은 2번째 명중분이
    // 증폭돼 총 피해가 무-프리즘 런보다 크다(관통 순서 무관하게 총합은 결정론).
    const HP = 1_000_000;
    const plain = createWorld(1, weaponUniqueCfg(WEAPON_BEAM, 0));
    const prism = createWorld(1, weaponUniqueCfg(WEAPON_BEAM, 1 << UQ_CONVERGE_PRISM));
    const removed = (s: WorldState) => {
      const a = addEnemy(s, 90, 0, HP);
      const b = addEnemy(s, 90, 20, HP);
      stepWorld(s, emptyInput());
      return HP - a.hp + (HP - b.hp);
    };
    const dPlain = removed(plain);
    const dPrism = removed(prism);
    expect(dPlain).toBeGreaterThan(0);
    expect(dPrism).toBeGreaterThan(dPlain);
  });

  it('도박사의 칩(모듈): 레벨업 파워업 선택지를 1개 더 제시한다', () => {
    const withChip = createWorld(1, uniqueCfg(UQ_GAMBLER_CHIP));
    const plain = createWorld(1);
    for (const s of [withChip, plain]) s.xp = 1_000_000; // 즉시 레벨업 유도
    stepWorld(withChip, emptyInput());
    stepWorld(plain, emptyInput());
    expect(plain.powerupChoices.length).toBe(3);
    expect(withChip.powerupChoices.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// AC2 — 신규 콘텐츠 결정론
// ---------------------------------------------------------------------------

describe('M3 콘텐츠 결정론 (AC2)', () => {
  it('니플헤임 섬멸 런이 동일 해시로 재현된다', () => {
    const cfg: WorldConfig = { ...DEFAULT_CONFIG, planet: 2, stage: 21 };
    const inputs = Array.from({ length: 400 }, () => emptyInput());
    const a = runReplay({ seed: 0x2c2c, config: cfg, inputs });
    const b = runReplay({ seed: 0x2c2c, config: cfg, inputs });
    expect(a.hashes).toEqual(b.hashes);
  });

  it('원소 어픽스 런이 동일 해시로 재현된다', () => {
    const cfg: WorldConfig = {
      ...DEFAULT_CONFIG,
      loadout: { ...neutralLoadout(), fireDmg: 4, coldSlow: 1, lightning: 8 },
    };
    const inputs = Array.from({ length: 300 }, () => emptyInput());
    const a = runReplay({ seed: 0x3131, config: cfg, inputs });
    const b = runReplay({ seed: 0x3131, config: cfg, inputs });
    expect(a.hashes).toEqual(b.hashes);
  });
});

// ---------------------------------------------------------------------------
// AC2 — Lane1+Lane2 통합 결정론
//   [시드+입력+로드아웃+스킬투자+변칙]에 신규 행성·섬멸 티어·원소 상태이상·5무기
//   (미사일/빔)·무기타입 의존 유니크를 함께 실어 2회 실행 해시 일치를 확인한다.
// ---------------------------------------------------------------------------

describe('M3 Lane1+Lane2 통합 결정론 (AC2)', () => {
  it('니플헤임 섬멸 + 빔 + 수렴 프리즘 + 원소 + 스킬투자 런이 동일 해시로 재현된다', () => {
    const cfg: WorldConfig = {
      ...DEFAULT_CONFIG,
      planet: 2, // 니플헤임(신규 행성)
      stage: 21, // 섬멸(파워업 가중·엘리트 2개)
      anomalyAccepted: true, // 변칙 수락
      loadout: {
        ...neutralLoadout(),
        weaponType: WEAPON_BEAM,
        uniqueMask: 1 << UQ_CONVERGE_PRISM,
        fireDmg: 5,
        coldSlow: 2,
        lightning: 6,
      },
      skillInvest: sampleSkillInvest(),
    };
    const inputs = Array.from({ length: 420 }, (_, i) => ({ ...emptyInput(), moveX: i % 3 === 0 ? 1 : 0 }));
    const a = runReplay({ seed: 0x51a1, config: cfg, inputs });
    const b = runReplay({ seed: 0x51a1, config: cfg, inputs });
    expect(a.hashes).toEqual(b.hashes);
  });

  it('아르케 섬멸 + 미사일 + 군집 벌통 + 도박사의 칩 + 스킬투자 런이 동일 해시로 재현된다', () => {
    const cfg: WorldConfig = {
      ...DEFAULT_CONFIG,
      planet: 3, // 아르케(신규 행성)
      stage: 21, // 섬멸
      loadout: {
        ...neutralLoadout(),
        weaponType: WEAPON_MISSILE,
        uniqueMask: (1 << UQ_HIVE_SWARM) | (1 << UQ_GAMBLER_CHIP),
        fireDmg: 3,
      },
      skillInvest: sampleSkillInvest(),
    };
    const inputs = Array.from({ length: 420 }, (_, i) => ({ ...emptyInput(), moveY: i % 4 === 0 ? 1 : 0 }));
    const a = runReplay({ seed: 0x7e2e, config: cfg, inputs });
    const b = runReplay({ seed: 0x7e2e, config: cfg, inputs });
    expect(a.hashes).toEqual(b.hashes);
  });

  it('무기타입 의존 유니크가 실제로 거동을 바꾼다(해시가 무-유니크 런과 갈린다)', () => {
    const base: WorldConfig = {
      ...DEFAULT_CONFIG,
      planet: 2,
      stage: 11,
      loadout: { ...neutralLoadout(), weaponType: WEAPON_BEAM },
    };
    const withPrism: WorldConfig = {
      ...base,
      loadout: { ...neutralLoadout(), weaponType: WEAPON_BEAM, uniqueMask: 1 << UQ_CONVERGE_PRISM },
    };
    const inputs = Array.from({ length: 360 }, () => emptyInput());
    const plain = runReplay({ seed: 0x9c9c, config: base, inputs });
    const prism = runReplay({ seed: 0x9c9c, config: withPrism, inputs });
    expect(prism.hashes).not.toEqual(plain.hashes);
  });
});
