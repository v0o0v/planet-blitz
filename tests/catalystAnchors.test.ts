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
  /**
   * `onPlayerDamagedCatalyst` 가 받은 인자 기록(W2). 스킬 짝이 인자를 하나 늘렸으므로 **촉매
   * 짝에도 같은 값이 같은 자리로** 오는지를 잰다 — 둘이 갈리면 촉매 레인이 스킬과 다른 사유를
   * 보고도 흔적이 안 남는다.
   */
  catalystDamaged: [] as { dmg: number; lethal: boolean; sources: number }[],
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
      if (name === 'onPlayerDamagedCatalyst') {
        hoisted.catalystDamaged.push({
          dmg: args[2] as number,
          lethal: args[3] as boolean,
          sources: args[4] as number,
        });
      }
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
const { DamageSource } = await import('../src/sim/skillSlots.js');
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
  hoisted.catalystDamaged = [];
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

  it('회귀(W2): 촉매 짝도 스킬 짝과 **같은 인자**를 받는다 — 피해원 포함', () => {
    const s = withCatalyst(0xca04);
    const p = player(s);
    plantEnemy(s, p.x, p.y, 5);
    stepWorld(s, idle);
    // 하한을 먼저 — 피격이 없으면 아래 인자 단언은 빈 배열에 대한 항진이다.
    expect(hoisted.catalystDamaged).toHaveLength(1);
    const seen = hoisted.catalystDamaged[0]!;
    expect(seen.dmg).toBe(5 * 2); // 종전과 같은 실피해(피격 배수만)
    expect(seen.lethal).toBe(false);
    expect(seen.sources).toBe(DamageSource.contact);
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

  /**
   * ⭐ 질문 ③ — 앵커 ⑰ 이 `min(d, s)` 때문에 **원리적으로 무효**였던 전례가 있어, 값을 돌려주는
   * 이 칸도 반환이 뒤에서 삼켜지지 않는지를 뮤테이션으로 실증해 둔다. 위 두 절은
   * `survivedLethalBlow` 의 **의미**를 재지 hp 차감량을 재지 않는다.
   */
  it('⭐ 반환 배율이 hp 차감에 그대로 도달한다 (뒤에 min·clamp 가 없다)', () => {
    const base = withCatalyst(0xca10);
    const bp = player(base);
    const hp0 = bp.hp;
    plantEnemy(base, bp.x, bp.y, 5);
    stepWorld(base, idle);
    const plain = hp0 - bp.hp;
    expect(plain, '피격이 일어나지 않았다 — 아래 비교는 항진이다').toBeGreaterThan(0);

    const s = withCatalyst(0xca10);
    const p = player(s);
    plantEnemy(s, p.x, p.y, 5);
    hoisted.forceCatalystDamage = plain * 3;
    stepWorld(s, idle);
    expect(hp0 - p.hp).toBe(plain * 3);
  });
});

// ---------------------------------------------------------------------------
// ④ `id 24 chainreaction` — 피해 전이 · 최대 HP 상한 하락 · 세그먼트 전환 복구
// ---------------------------------------------------------------------------

/** 지정한 카드만 실린 런. `id 24` 절은 소지 게이트가 카드 단위인지까지 잰다. */
function withCards(seed: number, cards: number[]): WorldState {
  return createWorld(seed, { ...DEFAULT_CONFIG, catalysts: cards });
}

/**
 * 접촉 피해원 하나를 플레이어 위에 세우고 **오토어택 피해를 0 으로 잠근다.**
 * 안 잠그면 자기 볼리가 표적 hp 를 같이 깎아 "전이가 깎은 양"을 분리할 수 없다.
 */
function contactSetup(s: WorldState, enemyHp: number): { p: Entity; e: Entity } {
  s.weapon.damage = 0;
  const p = player(s);
  const e = plantEnemy(s, p.x, p.y, 5);
  e.hp = enemyHp;
  e.maxHp = enemyHp;
  return { p, e };
}

describe('id 24 chainreaction — 받은 피해가 가장 가까운 적에게 전이된다', () => {
  it('전이: 표적 hp 가 **실피해량만큼** 깎인다', () => {
    const s = withCards(0xc240, [24]);
    const { e } = contactSetup(s, 1_000_000);
    stepWorld(s, idle);
    // 하한 먼저 — 피격이 없으면 아래 비교가 0 == 0 항진이 된다.
    expect(hoisted.catalystDamaged.length, '피격이 일어나지 않았다').toBeGreaterThan(0);
    const dealt = hoisted.catalystDamaged[0]!.dmg;
    expect(dealt).toBeGreaterThan(0);
    expect(1_000_000 - e.hp).toBe(Math.round(dealt));
  });

  it('음성 대조: `id 24` 가 없는 촉매 런에서는 표적 hp 가 그대로다', () => {
    const s = withCards(0xc240, [1]);
    const { e } = contactSetup(s, 1_000_000);
    stepWorld(s, idle);
    expect(hoisted.catalystDamaged.length, '피격이 일어나지 않았다').toBeGreaterThan(0);
    expect(e.hp).toBe(1_000_000);
  });

  it('전이로 hp 가 바닥나면 **격추로 집계된다** (`dead` 마킹 누락 = 좀비 회귀)', () => {
    const s = withCards(0xc241, [24]);
    contactSetup(s, 1); // 전이 한 방에 죽는 표적.
    expect(s.kills).toBe(0);
    stepWorld(s, idle);
    expect(hoisted.catalystDamaged.length, '피격이 일어나지 않았다').toBeGreaterThan(0);
    expect(s.kills, 'hp 만 0 이고 dead 가 안 서면 compact 가 그냥 통과시킨다').toBe(1);
  });

  it('대가: 전이한 만큼 최대 HP 상한이 내려가고 현재 hp 가 따라 내려온다', () => {
    const s = withCards(0xc242, [24]);
    const { p } = contactSetup(s, 1_000_000);
    const maxHp0 = p.maxHp;
    p.hp = maxHp0; // 상한에 붙여 두면 클램프가 관측된다.
    stepWorld(s, idle);
    const dealt = Math.round(hoisted.catalystDamaged[0]!.dmg);
    expect(dealt).toBeGreaterThan(0);
    expect(maxHp0 - p.maxHp).toBe(dealt);
    expect(p.hp).toBeLessThanOrEqual(p.maxHp);
  });

  it('음성 대조: `id 24` 가 없으면 최대 HP 상한이 안 움직인다', () => {
    const s = withCards(0xc242, [1]);
    const { p } = contactSetup(s, 1_000_000);
    const maxHp0 = p.maxHp;
    stepWorld(s, idle);
    expect(hoisted.catalystDamaged.length, '피격이 일어나지 않았다').toBeGreaterThan(0);
    expect(p.maxHp).toBe(maxHp0);
  });

  it('되돌릴 수단: 세그먼트가 넘어가면 깎인 상한이 통째로 복구된다', () => {
    const s = withCards(0xc243, [24]);
    const { p } = contactSetup(s, 1_000_000);
    const maxHp0 = p.maxHp;
    stepWorld(s, idle);
    const cut = maxHp0 - p.maxHp;
    expect(cut, '상한이 안 깎였다 — 복구 단언이 항진이 된다').toBeGreaterThan(0);

    s.wave.segmentIndex++;
    stepWorld(s, idle);
    expect(p.maxHp).toBe(maxHp0);
  });

  it('복구는 세그먼트당 한 번이다 (같은 세그먼트에서 상한이 계속 불어나지 않는다)', () => {
    const s = withCards(0xc244, [24]);
    const { p } = contactSetup(s, 1_000_000);
    const maxHp0 = p.maxHp;
    stepWorld(s, idle);
    expect(maxHp0 - p.maxHp).toBeGreaterThan(0);
    s.wave.segmentIndex++;
    stepWorld(s, idle);
    expect(p.maxHp).toBe(maxHp0);
    for (let i = 0; i < 5; i++) stepWorld(s, idle);
    expect(p.maxHp, '매 틱 복구가 돌아 상한이 폭주했다').toBe(maxHp0);
  });

  it('슬롯 규약: `id 24` 가 없는 런은 촉매 슬롯이 전 칸 0 으로 남는다', () => {
    const s = withCards(0xc245, [1]);
    contactSetup(s, 1_000_000);
    stepWorld(s, idle);
    expect(hoisted.catalystDamaged.length, '피격이 일어나지 않았다').toBeGreaterThan(0);
    expect(s.catalystSlots.every((v) => v === 0)).toBe(true);
  });
});
