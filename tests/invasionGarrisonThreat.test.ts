/**
 * 기본 수비대는 **실제로 플레이어를 공격해야 한다** (2026-08-10).
 *
 * ## 왜 이 파일이 필요한가 — 같은 결함을 두 번 밟았다
 * 사용자 제기: "기본 방어체가 총을 한발도 안 쏘는데 이게 원래 기획인건가?"
 *
 * 아니었다. 빈 웨이브 슬롯을 채우는 편대가 `정찰 드론편대`였는데 그 구성원 5기가 전부
 * **수리드론**이고, 그 정의가 `movement: 'seekWounded'` / `attack: { kind: 'heal' }` 라
 * **플레이어를 향한 공격이 아예 없다**. 실측으로 L1 에서 5,399틱(90초) 동안 **적탄 0발**이었다
 * (같은 런의 L2 는 873발). 위협은 접촉 피해 6 뿐이었고, 5기가 서로를 치유해 더 질기기까지 했다.
 *
 * 그 직전에는 **L3 코어 증원**이 같은 수리드론을 소환하고 있었다 — 코어방이 133,200틱 동안
 * 끝나지 않았다(정상 3,588틱). 둘 다 "가장 가벼운 잡몹"을 고르다 하필 지원형을 집은 것이다.
 *
 * ## 그래서 인스턴스가 아니라 **부류**를 막는다
 * "충원 편대가 정찰드론이 아닌가"를 박으면 다음에 다른 지원형을 고를 때 또 통과한다.
 * 이 파일이 지키는 것은 **「기본 수비대로 세워지는 모든 개체는 플레이어를 공격할 수단을
 * 가진다」** 는 계약이다. 새 편대를 충원 기본값으로 올리면 여기서 걸린다.
 *
 * `heal` 은 아군을 회복시킬 뿐 플레이어에게 아무 일도 하지 않는다. `fragments`·`mortar`·`lava`
 * 는 전부 플레이어를 향한다. 접촉 피해는 **위협으로 세지 않는다** — 플레이어가 피하면 0 이고,
 * 그것만 남았을 때가 정확히 이번 결함의 상태였다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldConfig, WorldState } from '../src/sim/world.js';
import { autopilotInput } from '../src/sim/autopilot.js';
import {
  INVASION_TOTAL_TICKS,
  INVASION_WAVE_SLOTS,
  PHASE_L1,
  emptyInvasionLayers,
} from '../src/sim/invasion/index.js';
import {
  GARRISON_FORMATION_CATALOG_IDS,
  INVASION_GARRISON_LEVEL_DEFAULT,
  garrisonFormationIdFor,
} from '../data/invasion/garrison.js';
import { FORMATIONS, formationById } from '../data/invasion/formations.js';
import { ENEMY_BY_TYPE } from '../data/enemies.js';

/** 플레이어에게 아무 일도 하지 않는 공격 종류(= 위협 0). */
const NON_THREAT_ATTACKS = new Set(['heal']);

describe('기본 수비대 — 위협 계약', () => {
  it('충원 편대의 모든 구성원이 플레이어를 공격할 수단을 가진다', () => {
    expect(GARRISON_FORMATION_CATALOG_IDS.length).toBeGreaterThan(0);
    for (const catalogId of GARRISON_FORMATION_CATALOG_IDS) {
      const def = formationById(catalogId);
      expect(def, `catalogId ${catalogId} 편대가 없다`).toBeDefined();
      expect(def!.members.length).toBeGreaterThan(0);
      for (const m of def!.members) {
        const enemy = ENEMY_BY_TYPE[m.enemyTypeIndex];
        expect(enemy, `enemyTypeIndex ${m.enemyTypeIndex}`).toBeDefined();
        expect(
          NON_THREAT_ATTACKS.has(enemy!.attack.kind),
          `${def!.id} 의 ${enemy!.id} 는 attack.kind='${enemy!.attack.kind}' — 플레이어를 공격하지 않는다`,
        ).toBe(false);
      }
    }
  });

  it('슬롯 순환은 인덱스의 순수 함수이고 음수·초과도 접힌다', () => {
    const n = GARRISON_FORMATION_CATALOG_IDS.length;
    for (let i = 0; i < INVASION_WAVE_SLOTS; i++) {
      expect(garrisonFormationIdFor(i)).toBe(GARRISON_FORMATION_CATALOG_IDS[i % n]);
      expect(garrisonFormationIdFor(i)).toBe(garrisonFormationIdFor(i)); // 결정론
    }
    expect(garrisonFormationIdFor(-1)).toBe(GARRISON_FORMATION_CATALOG_IDS[n - 1]);
  });

  it('6칸이 한 종류로만 채워지지 않는다(바닥의 단조로움 방지)', () => {
    const ids = new Set<number>();
    for (let i = 0; i < INVASION_WAVE_SLOTS; i++) ids.add(garrisonFormationIdFor(i));
    expect(ids.size).toBeGreaterThan(1);
  });

  /**
   * 위 셋은 데이터 계약이다. 이것은 **실제로 탄이 나오는가** — 데이터가 맞아도 배선이 끊기면
   * 화면은 여전히 조용하다(이 저장소의 반복 결함 "단위는 그린인데 배선이 없다").
   */
  it('빈 배치 침공 L1 에서 적탄이 실제로 나온다', () => {
    const config = {
      ...DEFAULT_CONFIG,
      // 관측 대상은 발사이지 생존이 아니다.
      playerHp: 100_000_000,
      invasion3: {
        layers: emptyInvasionLayers(),
        timeLimitTicks: INVASION_TOTAL_TICKS,
        maintenance: 10000,
        garrisonLevel: INVASION_GARRISON_LEVEL_DEFAULT,
      },
    } as WorldConfig;
    const s: WorldState = createWorld(9, config);
    let shots = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      stepWorld(s, autopilotInput(s));
      // L1 을 벗어나면 L2 설비(속사포)의 탄이 섞여 관측이 오염된다.
      if (s.invasion3?.phase !== PHASE_L1) break;
      for (const e of s.entities) {
        if (e.kind === 'enemyBullet' && !e.dead && !seen.has(e.id)) {
          seen.add(e.id);
          shots++;
        }
      }
      if (s.gameOver || s.victory) break;
    }
    expect(shots, 'L1 기본 수비대가 한 발도 안 쐈다 — 이번 결함의 정확한 재발 형태다').toBeGreaterThan(0);
  });

  it('카탈로그의 지원형 편대 자체는 남아 있다(방어자는 여전히 배치할 수 있다)', () => {
    // 정찰 드론편대를 **없애지 않았다** — 다른 편대와 함께 깔면 치유가 실제로 성립한다.
    // 바꾼 것은 "아무것도 배치 안 했을 때의 바닥"뿐이다.
    const healers = FORMATIONS.filter((f) =>
      f.members.some((m) => NON_THREAT_ATTACKS.has(ENEMY_BY_TYPE[m.enemyTypeIndex]!.attack.kind)),
    );
    expect(healers.length).toBeGreaterThan(0);
  });
});

describe('방어측 강화 — HP 축과 피해 축이 분리돼 있다', () => {
  /** 첫 편대의 (최대HP, 접촉피해) 를 본다. */
  function firstEnemy(hpBp: number, damageBp: number): { hp: number; dmg: number } {
    const config = {
      ...DEFAULT_CONFIG,
      playerHp: 100_000_000,
      invasion3: {
        layers: emptyInvasionLayers(),
        timeLimitTicks: INVASION_TOTAL_TICKS,
        maintenance: 10000,
        garrisonLevel: INVASION_GARRISON_LEVEL_DEFAULT,
        defenseHpBp: hpBp,
        defenseDamageBp: damageBp,
      },
    } as WorldConfig;
    const s: WorldState = createWorld(9, config);
    for (let i = 0; i < 1200; i++) {
      stepWorld(s, autopilotInput(s));
      for (const e of s.entities) {
        if (e.kind === 'enemy' && !e.dead) return { hp: e.maxHp, dmg: e.damage };
      }
    }
    return { hp: 0, dmg: 0 };
  }

  it('HP 축만 올리면 피해는 그대로다 (사용자 요구의 정확한 형태)', () => {
    // "계보bp를 100000 으로 했더니 적의 hp가 적당한데 대신 공격력이 너무 쎄다" —
    // 축이 하나였을 때의 증상이다. 갈라 놓았으니 HP 만 ×11 이 되어야 한다.
    const base = firstEnemy(0, 0);
    const tanky = firstEnemy(100000, 0);
    expect(base.hp, '적이 안 떴다면 공허하다').toBeGreaterThan(0);
    expect(tanky.hp).toBeGreaterThan(base.hp * 10);
    expect(tanky.dmg, 'HP 축이 피해로 샜다').toBe(base.dmg);
  });

  it('피해 축만 올리면 HP 는 그대로다', () => {
    const base = firstEnemy(0, 0);
    const hitty = firstEnemy(0, 100000);
    expect(hitty.dmg).toBeGreaterThan(base.dmg * 10);
    expect(hitty.hp, '피해 축이 HP 로 샜다').toBe(base.hp);
  });

  it('둘 다 0 이면 무연산이다(기존 런 바이트 불변)', () => {
    const a = firstEnemy(0, 0);
    const b = firstEnemy(0, 0);
    expect(a).toEqual(b);
  });
});

describe('코어 전용 내구도 축', () => {
  function coreMaxHp(hpBp: number, coreHpBp: number): number {
    const config = {
      ...DEFAULT_CONFIG,
      playerHp: 100_000_000,
      invasion3: {
        layers: emptyInvasionLayers(),
        timeLimitTicks: INVASION_TOTAL_TICKS * 4,
        maintenance: 10000,
        defenseHpBp: hpBp,
        defenseCoreHpBp: coreHpBp,
      },
    } as WorldConfig;
    const s: WorldState = createWorld(9, config);
    for (let i = 0; i < INVASION_TOTAL_TICKS * 3; i++) {
      stepWorld(s, autopilotInput(s));
      const core = s.entities.find((e) => e.kind === 'core' && !e.dead);
      if (core !== undefined) return core.maxHp;
      if (s.gameOver) break;
    }
    return 0;
  }

  it('코어 축은 HP 축 위에 한 번 더 곱한다', () => {
    const base = coreMaxHp(0, 0);
    expect(base, '코어가 안 떴다면 공허하다').toBeGreaterThan(0);
    // ×8 만 → 8배, ×8 위에 ×10 → 80배.
    expect(coreMaxHp(70000, 0)).toBe(base * 8);
    expect(coreMaxHp(70000, 90000)).toBe(base * 80);
  });

  it('코어 축은 잡몹에는 안 걸린다(코어 전용이라는 확인)', () => {
    const mobHp = (coreHpBp: number): number => {
      const config = {
        ...DEFAULT_CONFIG,
        playerHp: 100_000_000,
        invasion3: {
          layers: emptyInvasionLayers(),
          timeLimitTicks: INVASION_TOTAL_TICKS,
          maintenance: 10000,
          garrisonLevel: INVASION_GARRISON_LEVEL_DEFAULT,
          defenseCoreHpBp: coreHpBp,
        },
      } as WorldConfig;
      const s: WorldState = createWorld(9, config);
      for (let i = 0; i < 1200; i++) {
        stepWorld(s, autopilotInput(s));
        for (const e of s.entities) if (e.kind === 'enemy' && !e.dead) return e.maxHp;
      }
      return 0;
    };
    expect(mobHp(0)).toBeGreaterThan(0);
    expect(mobHp(900000), '코어 축이 잡몹으로 샜다').toBe(mobHp(0));
  });
});
