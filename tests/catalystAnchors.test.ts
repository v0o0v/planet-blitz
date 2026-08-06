/**
 * 촉매 디스패치가 **실제로 불리는가** — 2단 디스패치 배선의 계측 (ADR-0052).
 *
 * ## 왜 이 파일이 따로 있는가
 * `catalystFoundation.test.ts` 는 슬롯·폴드의 계약을 재지만, **호출 자체를 통째로 지워도**
 * 한 줄도 빨개지지 않는다 — S0 의 촉매 디스패치는 전부 항등이라 관측량에 흔적이 없다.
 * 그 사각지대를 메우는 것이 이 파일이다. 모듈 경계(`catalystHooks.ts`)가 있어야 이 계측이
 * 가능하고, 그것이 파일을 가른 이유 중 하나다.
 *
 * ## 계측 방식 — `vi.mock` 으로 모듈 경계를 감싼다
 * `skillAnchors.test.ts` 와 같은 형태다. **원본을 그대로 태워** 감싸기가 거동을 바꾸지 않게 한다.
 *
 * ## ⚠️ 이 파일의 핵심은 마지막 절이다 — 감쇠 사슬의 **순서**를 잰다
 * 촉매 배율이 `preMitigationDmg` 캡처의 앞이냐 뒤냐로 `survivedLethalBlow` 의 의미가 갈리는데,
 * 그 차이는 **두 훅의 반환값을 서로 반대로 조작해야만** 관측된다. 아래 절이 그 판별식이다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/** 디스패치별 호출 횟수. `vi.mock` 팩토리가 모듈 평가보다 먼저 도므로 `vi.hoisted` 로 올린다. */
const hoisted = vi.hoisted(() => ({
  calls: {} as Record<string, number>,
  /** 감쇠 사슬 순서 판별용 — 세우면 해당 훅이 원본 대신 이 값을 돌려준다. */
  forceCatalystDamage: null as number | null,
  forceSkillDamage: null as number | null,
  /** `onPlayerDamaged` 가 받은 `lethalSurvived` 인자의 기록. */
  lethalSeen: [] as boolean[],
}));

vi.mock('../src/sim/catalystHooks.js', async (orig) => {
  const actual = await orig<typeof import('../src/sim/catalystHooks.js')>();
  const wrapped: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(actual)) {
    if (typeof value !== 'function') {
      wrapped[name] = value;
      continue;
    }
    const fn = value as (...args: unknown[]) => unknown;
    wrapped[name] = (...args: unknown[]): unknown => {
      hoisted.calls[name] = (hoisted.calls[name] ?? 0) + 1;
      if (name === 'onDamageChainCatalyst' && hoisted.forceCatalystDamage !== null) {
        return hoisted.forceCatalystDamage;
      }
      return fn(...args);
    };
  }
  return wrapped;
});

vi.mock('../src/sim/skillHooks.js', async (orig) => {
  const actual = await orig<typeof import('../src/sim/skillHooks.js')>();
  const wrapped: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(actual)) {
    if (typeof value !== 'function') {
      wrapped[name] = value;
      continue;
    }
    const fn = value as (...args: unknown[]) => unknown;
    wrapped[name] = (...args: unknown[]): unknown => {
      hoisted.calls[name] = (hoisted.calls[name] ?? 0) + 1;
      if (name === 'onPlayerDamaged') hoisted.lethalSeen.push(args[3] as boolean);
      if (name === 'onDamageChain' && hoisted.forceSkillDamage !== null) {
        return hoisted.forceSkillDamage;
      }
      return fn(...args);
    };
  }
  return wrapped;
});

const { createWorld, stepWorld, emptyInput, DEFAULT_CONFIG, SPECIAL_POWERUP_PICK } = await import(
  '../src/sim/world.js'
);
const { blankEntity, addEntity, spawnGem, spawnBullet } = await import('../src/sim/entities.js');
const { DT } = await import('../src/sim/constants.js');
type WorldState = import('../src/sim/world.js').WorldState;
type InputFrame = import('../src/sim/world.js').InputFrame;
type Entity = import('../src/sim/entities.js').Entity;

const idle: InputFrame = emptyInput();

function count(name: string): number {
  return hoisted.calls[name] ?? 0;
}

/** 촉매가 실린 런. 디스패치의 첫 줄이 `if (!state.catalystOn) return;` 이다. */
function withCatalyst(seed: number): WorldState {
  return createWorld(seed, { ...DEFAULT_CONFIG, catalysts: [1] });
}

/** 잡몹 하나. hp 를 크게 잡아 한 방에 죽지 않게 한다(킬 사건과 분리). */
function plantEnemy(state: WorldState, x: number, y: number, damage = 0): Entity {
  const e = blankEntity('enemy');
  e.x = x;
  e.y = y;
  e.radius = 32;
  e.hp = 1_000_000;
  e.maxHp = 1_000_000;
  e.damage = damage;
  return addEntity(state, e);
}

function player(state: WorldState): Entity {
  const p = state.entities.find((e) => e.kind === 'player');
  if (p === undefined) throw new Error('플레이어 부재');
  return p;
}

beforeEach(() => {
  for (const k of Object.keys(hoisted.calls)) delete hoisted.calls[k];
  hoisted.forceCatalystDamage = null;
  hoisted.forceSkillDamage = null;
  hoisted.lethalSeen = [];
});

// ---------------------------------------------------------------------------
// ① 계측 이음매 — 계측기 자체가 살아 있는가
// ---------------------------------------------------------------------------

describe('계측 이음매', () => {
  it('촉매 디스패치 11개가 전부 export 돼 있다 (이름이 바뀌면 계측이 조용히 0 이 된다)', async () => {
    const mod = await import('../src/sim/catalystHooks.js');
    for (const name of [
      'onVolleyFiredCatalyst',
      'onDashFiredCatalyst',
      'onGemCollectedCatalyst',
      'onPlayerDamagedCatalyst',
      'onKillsDeltaCatalyst',
      'onBulletExpiredCatalyst',
      'onWallContactCatalyst',
      'onDamageChainCatalyst',
      'onTickCatalyst',
      'onEnemyDamagedCatalyst', // S1
      'onEnemyDeathCatalyst', // S1
      'onLevelUpCatalyst', // S1
      'onPowerupOfferCatalyst', // S1
      'onPowerupPickedCatalyst', // S1
    ]) {
      expect(typeof (mod as Record<string, unknown>)[name], name).toBe('function');
    }
  });
});

// ---------------------------------------------------------------------------
// ② 배선 증명 — 각 지점에서 실제로 불린다
// ---------------------------------------------------------------------------

describe('촉매 디스패치가 스킬 앵커와 같은 지점에서 불린다', () => {
  it('매 틱 `onTickCatalyst` 가 정확히 한 번 불린다', () => {
    const s = withCatalyst(0xca01);
    stepWorld(s, idle);
    expect(count('onTickCatalyst')).toBe(1);
    stepWorld(s, idle);
    expect(count('onTickCatalyst')).toBe(2);
  });

  it('젬 수거 틱에 `onGemCollectedCatalyst` 가 불린다', () => {
    const s = withCatalyst(0xca02);
    const p = player(s);
    addEntity(s, spawnGem(s, p.x, p.y, 1));
    stepWorld(s, idle);
    expect(count('onGemCollectedCatalyst')).toBeGreaterThan(0);
  });

  it('음성 대조: 젬이 없는 틱에는 0 이다 (계측기가 아무 때나 켜지지 않는다)', () => {
    const s = withCatalyst(0xca03);
    stepWorld(s, idle);
    expect(count('onGemCollectedCatalyst')).toBe(0);
  });

  it('피격 틱에 `onDamageChainCatalyst` 와 `onPlayerDamagedCatalyst` 가 둘 다 불린다', () => {
    const s = withCatalyst(0xca04);
    const p = player(s);
    plantEnemy(s, p.x, p.y, 5);
    stepWorld(s, idle);
    expect(count('onDamageChainCatalyst'), '촉매 배율이 사슬에 안 들어가 있다').toBeGreaterThan(0);
    expect(count('onPlayerDamagedCatalyst')).toBeGreaterThan(0);
  });

  it('음성 대조: 맞지 않은 틱에는 둘 다 0 이다', () => {
    const s = withCatalyst(0xca05);
    stepWorld(s, idle);
    expect(count('onDamageChainCatalyst')).toBe(0);
    expect(count('onPlayerDamagedCatalyst')).toBe(0);
  });

  it('S1 앵커 ⑩: 아군탄이 적에 명중하면 `onEnemyDamagedCatalyst` 가 불린다', () => {
    const s = withCatalyst(0xca09);
    // 오토어택 사거리(1650) 밖 · 탄 컬링 반경 안 — 플레이어 자기 볼리가 계측을 오염시키지 않게.
    plantEnemy(s, 1920, 0);
    spawnBullet(s, 1980, 0, Math.PI, 250 / DT, 100, 0, 5, 120, -1, 0);
    stepWorld(s, idle);
    expect(count('onEnemyDamagedCatalyst')).toBe(1);
  });

  it('음성 대조: 명중이 없는 틱에는 `onEnemyDamagedCatalyst` 가 0 이다', () => {
    const s = withCatalyst(0xca0a);
    plantEnemy(s, 1920, 0);
    stepWorld(s, idle);
    expect(count('onEnemyDamagedCatalyst')).toBe(0);
  });

  it('S1 앵커 ⑪: 격추가 생기면 `onEnemyDeathCatalyst` 가 격추당 한 번 불린다', () => {
    const s = withCatalyst(0xca0b);
    const e = plantEnemy(s, 600, 600);
    e.hp = 0;
    e.dead = true;
    stepWorld(s, idle);
    expect(count('onEnemyDeathCatalyst')).toBe(1);
    expect(count('onKillsDeltaCatalyst')).toBe(1);
  });

  it('음성 대조: 격추가 없는 틱에는 `onEnemyDeathCatalyst` 가 0 이다', () => {
    const s = withCatalyst(0xca0c);
    stepWorld(s, idle);
    expect(count('onEnemyDeathCatalyst')).toBe(0);
  });

  it('S1 앵커 ⑫⑬⑭: 레벨업 → 3택 제시 → 픽 소비가 각각 한 번씩 불린다', () => {
    const s = withCatalyst(0xca0d);
    s.xp = 1_000_000;
    stepWorld(s, idle);
    expect(count('onLevelUpCatalyst')).toBe(1);
    expect(count('onPowerupOfferCatalyst')).toBe(1);
    expect(count('onPowerupPickedCatalyst')).toBe(0); // 아직 픽 전
    stepWorld(s, { ...idle, special: SPECIAL_POWERUP_PICK });
    expect(count('onPowerupPickedCatalyst')).toBe(1);
  });

  it('음성 대조: 레벨업이 없는 틱에는 ⑫⑬⑭ 이 전부 0 이다', () => {
    const s = withCatalyst(0xca0e);
    stepWorld(s, idle);
    expect(count('onLevelUpCatalyst')).toBe(0);
    expect(count('onPowerupOfferCatalyst')).toBe(0);
    expect(count('onPowerupPickedCatalyst')).toBe(0);
  });

  it('⚠️ 무촉매 런에서도 **호출은 일어난다** — 게이트는 함수 안에 있다', () => {
    // 스킬 앵커와 같은 구조다. 게이트를 호출부로 올리면 이 단언이 빨개지는데, 그 형태는
    // 게이트 조건이 늘어날 때마다 호출부 9곳을 함께 고쳐야 해서 배선 누락을 부른다.
    const s = createWorld(0xca06, { ...DEFAULT_CONFIG });
    expect(s.catalystOn).toBe(false);
    stepWorld(s, idle);
    expect(count('onTickCatalyst')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ③ ⭐ 감쇠 사슬의 **순서** — `preMitigationDmg` 가 촉매를 포함하는가
// ---------------------------------------------------------------------------

describe('감쇠 사슬 순서 — 촉매 배율은 preMitigationDmg 캡처보다 앞이다', () => {
  /**
   * 판별식.
   *
   * 촉매 훅이 피해를 **치명 이상으로 키우고**, 스킬 훅이 그것을 **1 로 되돌린다**. 그러면
   * 플레이어는 살아남는다(hpAfter > 0). 이때 `survivedLethalBlow(pre, hpBefore, hpAfter)` 는
   * `pre >= hpBefore` 를 보는데:
   *
   *  - 촉매가 캡처 **앞**(현행 계약)이면 `pre` = 키운 값 → **참**.
   *  - 촉매가 캡처 **뒤**(= `onDamageChain` 안)였다면 `pre` = 원래 작은 값 → **거짓**.
   *
   * 두 훅의 반환값을 서로 반대로 조작해야만 이 차이가 드러난다 — 한쪽만 건드리면 관측되지 않는다.
   */
  it('촉매가 키운 피해를 스킬이 되돌리면 `lethalSurvived` 가 참이다', () => {
    const s = withCatalyst(0xca07);
    const p = player(s);
    const hp = p.hp;
    expect(hp).toBeGreaterThan(1);
    plantEnemy(s, p.x, p.y, 5);
    hoisted.forceCatalystDamage = hp * 10; // 촉매가 치명으로 키운다.
    hoisted.forceSkillDamage = 1; // 스킬이 1 로 되돌린다(살아남되 hp 는 깎인다).
    stepWorld(s, idle);

    expect(hoisted.lethalSeen.length, 'onPlayerDamaged 가 안 불렸다 — 판별 불가').toBeGreaterThan(
      0,
    );
    expect(p.hp).toBeGreaterThan(0);
    expect(
      hoisted.lethalSeen.some((v) => v === true),
      '촉매 배율이 preMitigationDmg 캡처 뒤로 밀렸다 — survivedLethalBlow 의 의미가 뒤집혔다',
    ).toBe(true);
  });

  it('대조: 촉매가 키우지 않으면 같은 조건에서 `lethalSurvived` 가 거짓이다', () => {
    // 위 단언이 "항상 참"이 아님을 보인다 — 이것이 없으면 판별식이 항진일 수 있다.
    const s = withCatalyst(0xca08);
    const p = player(s);
    plantEnemy(s, p.x, p.y, 5);
    hoisted.forceSkillDamage = 1;
    stepWorld(s, idle);
    expect(hoisted.lethalSeen.length).toBeGreaterThan(0);
    expect(hoisted.lethalSeen.every((v) => v === false)).toBe(true);
  });
});
