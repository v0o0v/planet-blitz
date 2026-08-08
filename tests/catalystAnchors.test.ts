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
  /**
   * `onBulletExpiredCatalyst` 가 받은 소멸 사유 기록. 사유가 촉매 짝까지 **같은 자리로**
   * 오는지를 재려면 인자를 봐야 한다 — 호출 횟수만으로는 `'pierce'`/`'life'` 가 뒤바뀐
   * 배선이 통과한다.
   */
  catalystExpiries: [] as string[],
  /**
   * 보스 사망 앵커의 **승리 억제** 판별용. 세우면 `onBossDeathCatalyst` 가 원본 대신 `true` 를
   * 돌려준다 — 억제가 실제로 승리·보스 드랍을 막는지는 이 조작 없이는 관측할 수 없다
   * (S0 본체가 전부 비어 있어 `false` 만 나오기 때문).
   */
  forceBossSuppress: false,
  /** `onDashPierceCatalyst` 가 받은 표적 좌표 기록. 통과 판정이 무엇을 집었는지 본다. */
  dashPierced: [] as { x: number; y: number }[],
  /** `onResourceGrantedCatalyst` 가 받은 인자 기록. */
  resourceGrants: [] as { amount: number; x: number; y: number }[],
  /**
   * 신규 앵커 일곱(배선 기반 레인)의 계측.
   *
   * ⚠️ 전부 **`world.ts` 호출부**에서 관측된다. 이 저장소의 규율이 그것이다 — 앵커 A 안에서
   * 앵커 B 를 부르면 지역 바인딩을 타 `vi.mock` 이 그 호출을 **영영 못 본다**(`onDashSwept`
   * 가 실제로 0 을 냈다). 그래서 일곱 모두 호출을 호출부로 올려 두었다.
   */
  lootRolls: [] as { rarity: number; count: number; elite: boolean }[],
  waveAdvances: [] as { prev: number; next: number }[],
  /** 세우면 `onLootCollectedCatalyst` 가 `true` 를 돌려준다(= `state.loot` push 억제). */
  forceLootSuppress: false,
  /** 세우면 `onDestructibleDestroyedCatalyst` 가 `true` 를 돌려준다(= 기본 젬 억제). */
  forceDestructibleSuppress: false,
  /** 세우면 `onEnemyStepCatalyst` 가 원본 대신 이 배율을 돌려준다. */
  forceEnemyStepMult: null as number | null,
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
      if (name === 'onBulletExpiredCatalyst') {
        hoisted.catalystExpiries.push(args[2] as string);
      }
      if (name === 'onDamageChainCatalyst' && hoisted.forceCatalystDamage !== null) {
        return hoisted.forceCatalystDamage;
      }
      if (name === 'onDashPierceCatalyst') {
        const t = args[2] as { x: number; y: number };
        hoisted.dashPierced.push({ x: t.x, y: t.y });
      }
      if (name === 'onResourceGrantedCatalyst') {
        hoisted.resourceGrants.push({
          amount: args[1] as number,
          x: args[2] as number,
          y: args[3] as number,
        });
      }
      if (name === 'onBossDeathCatalyst' && hoisted.forceBossSuppress) return true;
      if (name === 'onLootRollCatalyst') {
        hoisted.lootRolls.push({
          rarity: args[1] as number,
          count: args[2] as number,
          elite: args[5] as boolean,
        });
      }
      if (name === 'onWaveAdvancedCatalyst') {
        hoisted.waveAdvances.push({ prev: args[1] as number, next: args[2] as number });
      }
      if (name === 'onLootCollectedCatalyst' && hoisted.forceLootSuppress) return true;
      if (name === 'onDestructibleDestroyedCatalyst' && hoisted.forceDestructibleSuppress) {
        return true;
      }
      if (name === 'onEnemyStepCatalyst' && hoisted.forceEnemyStepMult !== null) {
        return hoisted.forceEnemyStepMult;
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
const { blankEntity, addEntity, spawnGem, spawnBullet, spawnWall } = await import(
  '../src/sim/entities.js'
);
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
  hoisted.catalystExpiries = [];
  hoisted.forceBossSuppress = false;
  hoisted.dashPierced = [];
  hoisted.resourceGrants = [];
  hoisted.lootRolls = [];
  hoisted.waveAdvances = [];
  hoisted.forceLootSuppress = false;
  hoisted.forceDestructibleSuppress = false;
  hoisted.forceEnemyStepMult = null;
});

// ---------------------------------------------------------------------------
// ① 계측 이음매 — 계측기 자체가 살아 있는가
// ---------------------------------------------------------------------------

describe('계측 이음매', () => {
  it('촉매 디스패치가 전부 export 돼 있다 (이름이 바뀌면 계측이 조용히 0 이 된다)', async () => {
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
      // 선결 앵커 레인 — 대시 통과 · 보급 적립 · 보스 사망 · 정산 채널.
      'onDashSweptCatalyst',
      'onDashPierceCatalyst',
      'onResourceGrantedCatalyst',
      'onBossDeathCatalyst',
      'catalystSettlementOf',
      // 배선 기반 레인 — 신규 앵커 일곱.
      'onLootRollCatalyst',
      'onLootCollectedCatalyst',
      'onWaveAdvancedCatalyst',
      'onEnemyContactCatalyst',
      'onEnemyStepCatalyst',
      'onDestructibleDestroyedCatalyst',
      'stepCatalystHazards',
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

  // -------------------------------------------------------------------------
  // 앵커 ①②⑥⑦ — 「발사·대시·벽·탄소멸」 그룹. **카드가 아직 한 장도 안 얹혔다**
  // (근거는 `catalystHooks.ts` 의 각 함수 주석). 그래서 이 넷은 효과로는 못 재고,
  // **호출 자체가 사라지는 것**이 유일하게 관측 가능한 회귀다. 여기서 잠근다.
  // -------------------------------------------------------------------------

  it('앵커 ①: 사거리 안 표적이 있는 틱에 `onVolleyFiredCatalyst` 가 불린다', () => {
    const s = withCatalyst(0xca20);
    plantEnemy(s, 400, 0);
    stepWorld(s, idle);
    expect(count('onVolleyFiredCatalyst')).toBe(1);
  });

  it('음성 대조: 쿨다운이 안 찼으면 표적이 있어도 0 이다', () => {
    // 술어는 "표적이 있다" 가 아니라 **"이번 틱에 반드시 발사한다"** 다. "표적이 없는 틱"으로
    // 대조를 잡으면 웨이브 디렉터가 사거리 안에 적을 낳는 시드에서 조용히 뒤집힌다
    // (`skillAnchors.test.ts` 의 같은 절이 실측으로 겪은 함정).
    const s = withCatalyst(0xca20);
    plantEnemy(s, 400, 0);
    player(s).cooldown = 999;
    stepWorld(s, idle);
    expect(count('onVolleyFiredCatalyst')).toBe(0);
  });

  it('앵커 ②: 대시 입력이 있고 쿨다운이 0 인 틱에 `onDashFiredCatalyst` 가 불린다', () => {
    const s = withCatalyst(0xca21);
    stepWorld(s, { ...idle, dash: true });
    expect(count('onDashFiredCatalyst')).toBe(1);
  });

  it('음성 대조: 대시 입력이 없으면 0, 쿨다운 중에도 0 이다', () => {
    const s = withCatalyst(0xca21);
    stepWorld(s, idle);
    expect(count('onDashFiredCatalyst')).toBe(0);
    stepWorld(s, { ...idle, dash: true }); // 여기서 쿨다운이 선다
    hoisted.calls['onDashFiredCatalyst'] = 0;
    stepWorld(s, { ...idle, dash: true });
    expect(count('onDashFiredCatalyst')).toBe(0);
  });

  it('앵커 ⑦: 벽에 겹친 틱에 `onWallContactCatalyst` 가 불린다', () => {
    const s = withCatalyst(0xca22);
    spawnWall(s, 0, 0, 200, 200); // 플레이어(원점)를 통째로 덮는 벽
    stepWorld(s, idle);
    expect(s.wallContactTicks, '전제: 접촉 술어가 참이다').toBeGreaterThan(0);
    expect(count('onWallContactCatalyst')).toBe(1);
  });

  it('음성 대조: 벽이 없는 무대에서는 0 이다', () => {
    const s = withCatalyst(0xca22);
    stepWorld(s, idle);
    // 절차 지형이 원점 근처에 벽을 놓는 시드를 배제하기 위해 접촉 플래그로 전제를 확인한다.
    if (s.wallContactTicks === 0) expect(count('onWallContactCatalyst')).toBe(0);
  });

  it('앵커 ⑥: 아군탄 소멸에서 불리고 **사유가 촉매 짝까지 그대로 온다**', () => {
    // 무대 좌표 근거는 `skillAnchors.test.ts` 앵커 ⑥ 절과 같다 — 오토어택 사거리(1650) 밖,
    // 탄 컬링 반경(≈2200) 안이라 플레이어 자기 볼리가 계측을 오염시키지 않는다.
    const STAGE_X = 1980;
    const pierced = withCatalyst(0xca23);
    plantEnemy(pierced, STAGE_X - 60, 0);
    spawnBullet(pierced, STAGE_X, 0, Math.PI, 250 / DT, 100, 0, 5, 120, -1, 0);
    stepWorld(pierced, idle);
    // ⚠️ **하한 먼저.** 배선이 끊기면 기록 배열이 비고, 그러면 아래 사유 단언이 "없는 원소를
    // 안 본다"로 조용히 성립한다(이 리포에서 실제로 난 항진).
    expect(count('onBulletExpiredCatalyst')).toBe(1);
    expect(hoisted.catalystExpiries).toEqual(['pierce']);

    hoisted.catalystExpiries = [];
    hoisted.calls['onBulletExpiredCatalyst'] = 0;
    const expired = withCatalyst(0xca24);
    // 수명 2틱 · 적 없음 → **오직 수명으로만** 죽는다.
    spawnBullet(expired, STAGE_X, 0, Math.PI, 250 / DT, 100, 0, 5, 2, -1, 0);
    stepWorld(expired, idle);
    expect(count('onBulletExpiredCatalyst'), '아직 안 죽었다').toBe(0);
    stepWorld(expired, idle);
    expect(count('onBulletExpiredCatalyst')).toBe(1);
    expect(hoisted.catalystExpiries).toEqual(['life']);
  });

  it('음성 대조: 관통 예산이 남은 명중과 적탄 소멸에서는 0 이다', () => {
    const STAGE_X = 1980;
    const s = withCatalyst(0xca25);
    plantEnemy(s, STAGE_X - 60, 0);
    spawnBullet(s, STAGE_X, 0, Math.PI, 250 / DT, 100, 1, 5, 120, -1, 0); // pierce 1 — 안 죽는다
    const eb = blankEntity('enemyBullet');
    eb.x = STAGE_X + 200;
    eb.y = 0;
    eb.vx = -250 / DT;
    eb.radius = 5;
    eb.life = 1; // 이번 틱에 수명 만료 — 앵커 ⑥ 의 계약은 **아군탄**이라 세면 안 된다
    eb.enemyType = -1;
    addEntity(s, eb);
    stepWorld(s, idle);
    expect(count('onBulletExpiredCatalyst')).toBe(0);
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
// ②-b 선결 앵커 넷 — 대시 통과 · 보급 적립 · 보스 사망
// ---------------------------------------------------------------------------
//
// 넷 다 본체가 비어 있어 **효과로는 못 잰다.** 유일하게 관측 가능한 회귀는 「호출이 사라지는 것」
// 이고(보스 앵커만 반환값 조작으로 억제까지 잴 수 있다), 여기서 그것을 잠근다.

describe('선결 앵커 — 대시 통과 판정', () => {
  it('대시 틱에 `onDashSweptCatalyst` 가 한 번, 경로 위 적마다 `onDashPierceCatalyst` 가 불린다', () => {
    const s = withCatalyst(0xca30);
    const p = player(s);
    // ⭐ **선분 판정의 판별식**이다. 적을 대시 **출발점**(플레이어 자리)에 두면, 이동 후 좌표
    //    한 점에서만 재는 구현은 이 적을 놓친다 — 대시 스텝 2800/60 ≈ 46.7 > 32(플레이어) + 1
    //    이라 도착점에서는 반경 합 밖이기 때문이다. 선분 판정만 t=0 에서 잡는다.
    const e = plantEnemy(s, p.x, p.y);
    e.radius = 1;
    stepWorld(s, { ...idle, dash: true });
    expect(count('onDashSweptCatalyst')).toBe(1);
    expect(count('onDashPierceCatalyst'), '점 판정으로 퇴화했다 — 출발점의 적을 놓쳤다').toBe(1);
    expect(hoisted.dashPierced).toEqual([{ x: e.x, y: e.y }]);
    // ⚠️ 이 틱은 대시 무적 창이 서 있는 틱이다. 통과 판정이 `iframes` 게이트와 **독립**이라는
    //    것이 여기서 실증된다 — 엮으면 id 29(「대시 무적 중 통과한 적」)가 구조적으로 0 이 된다.
    expect(p.iframes, '전제: 대시 무적이 서 있다').toBeGreaterThan(0);
  });

  it('음성 대조: 대시가 없으면 스윕 자체가 0, 경로 밖 적은 통과로 안 센다', () => {
    const s = withCatalyst(0xca31);
    plantEnemy(s, 800, 0); // 대시 스텝(≈47)보다 훨씬 멀다
    stepWorld(s, idle);
    expect(count('onDashSweptCatalyst')).toBe(0);
    expect(count('onDashPierceCatalyst')).toBe(0);
    stepWorld(s, { ...idle, dash: true });
    expect(count('onDashSweptCatalyst')).toBe(1);
    expect(count('onDashPierceCatalyst'), '경로 밖 적을 통과로 셌다').toBe(0);
  });
});

describe('선결 앵커 — 보급 습격 격추 자원 적립', () => {
  it('보급 습격이 격추된 틱에 `onResourceGrantedCatalyst` 가 적립액과 좌표를 싣고 불린다', () => {
    const s = withCatalyst(0xca32);
    const sup = blankEntity('supply');
    sup.x = 700;
    sup.y = 700;
    sup.radius = 92;
    sup.hp = 0; // 격추(도망 = hp > 0 과 구분되는 술어)
    sup.dead = true;
    addEntity(s, sup);
    const before = s.resources;
    stepWorld(s, idle);
    expect(count('onResourceGrantedCatalyst')).toBe(1);
    expect(hoisted.resourceGrants).toEqual([{ amount: s.resources - before, x: 700, y: 700 }]);
    expect(hoisted.resourceGrants[0]!.amount, '적립 0 인 호출은 원리적으로 없다').toBeGreaterThan(
      0,
    );
  });

  it('음성 대조: 도망친 보급(hp > 0)에서는 0 이다', () => {
    const s = withCatalyst(0xca33);
    const sup = blankEntity('supply');
    sup.x = 700;
    sup.y = 700;
    sup.radius = 92;
    sup.hp = 10; // 창이 끝나 despawn — 보상 없음
    sup.dead = true;
    addEntity(s, sup);
    stepWorld(s, idle);
    expect(count('onResourceGrantedCatalyst')).toBe(0);
  });
});

describe('선결 앵커 — 보스 사망(승리 억제 채널)', () => {
  function killBoss(seed: number): WorldState {
    const s = withCatalyst(seed);
    const b = blankEntity('boss');
    b.x = 900;
    b.y = 900;
    b.radius = 90;
    b.hp = 0;
    b.dead = true;
    addEntity(s, b);
    stepWorld(s, idle);
    return s;
  }

  it('보스가 죽으면 `onBossDeathCatalyst` 가 불리고, 억제하지 않으면 종전대로 승리가 선다', () => {
    const s = killBoss(0xca34);
    expect(count('onBossDeathCatalyst')).toBe(1);
    // 앵커 ⑪ 은 `kind === 'enemy'` 게이트라 보스를 안 덮는다 — 이 앵커가 필요했던 이유다.
    expect(count('onEnemyDeathCatalyst')).toBe(0);
    expect(s.victory).toBe(true);
    expect(s.loot.length, '보스 확정 드랍이 종전대로 실렸다').toBeGreaterThan(0);
  });

  it('⭐ `true` 를 돌려주면 승리와 보스 드랍이 **둘 다** 억제된다 (id 44 가 승리를 가로챈다)', () => {
    hoisted.forceBossSuppress = true;
    const s = killBoss(0xca35);
    expect(count('onBossDeathCatalyst')).toBe(1);
    expect(s.victory, '억제가 승리 판정을 못 가로챘다 — 앵커가 판정 뒤에 서 있다').toBe(false);
    expect(s.loot).toHaveLength(0);
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
   * ⭐ 앵커 ⑰ 이 `min(d, s)` 때문에 **원리적으로 무효**였던 전례가 있어, 값을 돌려주는 이 칸도
   * 반환이 뒤에서 삼켜지지 않는지를 뮤테이션으로 실증해 둔다. 위 두 절은 `survivedLethalBlow`
   * 의 **의미**를 재지 hp 차감량을 재지 않는다.
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
// ⑦ `id 24 chainreaction` — 피해 전이 · 최대 HP 상한 하락 · 세그먼트 전환 복구
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

  it('배정표 규약: `id 24` 는 슬롯 7·8 만 쓴다(0·1 선점은 전역 배정표로 해소됐다)', () => {
    const s = withCards(0xc246, [24]);
    contactSetup(s, 1_000_000);
    stepWorld(s, idle);
    const used = s.catalystSlots.flatMap((v, i) => (v !== 0 ? [i] : []));
    expect(used, '배정표(catalystSlots.ts)와 어긋난 칸을 썼다').toEqual([7, 8]);
  });
});

// ---------------------------------------------------------------------------
// ④ 신규 앵커 일곱 (배선 기반 레인) — **호출부 계측**
// ---------------------------------------------------------------------------
//
// ⚠️ 계측은 전부 `world.ts` **호출부**에서 일어난다. 앵커 안에서 다른 앵커를 부르면 지역
// 바인딩을 타 `vi.mock` 이 그 호출을 못 본다(`onDashSweptCatalyst` 주석의 실측).
//
// ⚠️ **무촉매 런에서도 호출 자체는 일어난다** — 이 저장소의 계약은 "게이트는 함수 안에 있다"
// 이고(위 절 「무촉매 런에서도 호출은 일어난다」), 그래야 계측이 배선 유실을 잡는다. 무촉매
// 런에서 0 이어야 하는 것은 **효과**다: 반환형 앵커는 인자를 그대로 돌려주고, 해저드 단계는
// 루프가 0회다. 그 물증의 정본은 `scripts/catalystByteInvariance.ts` 의 sha256 이다.

const { spawnLoot, spawnDestructible, spawnHazard } = await import('../src/sim/entities.js');
const { HAZARD_CATALYST, CATALYST_HAZARD_LIVE_CAP, spawnCatalystHazard } = await import(
  '../src/sim/catalyst/shared.js'
);

/** 무촉매 런(대조군). 촉매 배열 자체가 없다. */
function noCatalyst(seed: number): WorldState {
  return createWorld(seed, { ...DEFAULT_CONFIG });
}

describe('신규 앵커 — 전리품 등급·개수 롤', () => {
  function killBoss(state: WorldState): void {
    const b = blankEntity('boss');
    b.x = 900;
    b.y = 900;
    b.radius = 90;
    b.hp = 0;
    b.dead = true;
    addEntity(state, b);
    stepWorld(state, idle);
  }

  it('보스 확정 드랍 지점에서 `onLootRollCatalyst` 가 한 번 불린다 (elite=false)', () => {
    const s = withCatalyst(0xcb01);
    killBoss(s);
    expect(count('onLootRollCatalyst')).toBe(1);
    expect(hoisted.lootRolls[0]?.elite).toBe(false);
  });

  it('음성 대조: 드랍이 없는 틱에는 0 이다', () => {
    const s = withCatalyst(0xcb02);
    stepWorld(s, idle);
    expect(count('onLootRollCatalyst')).toBe(0);
  });

  it('무촉매 런도 같은 지점에서 불리고, **배율이 인자 그대로**라 드랍이 종전과 같다', () => {
    const s = noCatalyst(0xcb03);
    killBoss(s);
    expect(count('onLootRollCatalyst')).toBe(1);
    // 무촉매 기본값 — `catalystMods` 가 중립(1)이라 인자가 그대로 왔다.
    expect(hoisted.lootRolls[0]?.rarity).toBe(1);
    expect(hoisted.lootRolls[0]?.count).toBe(1);
    expect(s.loot.length).toBe(1);
  });
});

describe('신규 앵커 — 전리품 수거(=`state.loot` push 억제 채널)', () => {
  function pickUpLoot(state: WorldState): void {
    const p = player(state);
    addEntity(state, spawnLoot(state, p.x, p.y, 0x1234, 2));
    stepWorld(state, idle);
  }

  it('전리품을 주운 틱에 `onLootCollectedCatalyst` 가 불리고, 억제 안 하면 종전대로 실린다', () => {
    const s = withCatalyst(0xcb10);
    pickUpLoot(s);
    expect(count('onLootCollectedCatalyst')).toBe(1);
    expect(s.loot).toHaveLength(1);
  });

  it('⭐ `true` 를 돌려주면 `state.loot` 에 **안 실린다** (id 3·id 15 의 필수 분기)', () => {
    hoisted.forceLootSuppress = true;
    const s = withCatalyst(0xcb11);
    pickUpLoot(s);
    expect(count('onLootCollectedCatalyst')).toBe(1);
    expect(s.loot, '억제가 push 를 못 막았다 — 앵커가 push 뒤에 서 있다').toHaveLength(0);
  });

  it('음성 대조: 전리품이 없으면 0 이다', () => {
    const s = withCatalyst(0xcb12);
    stepWorld(s, idle);
    expect(count('onLootCollectedCatalyst')).toBe(0);
  });
});

describe('신규 앵커 — 세그먼트 전진', () => {
  it('`state.wave.segmentIndex` 가 **변한 틱에만** 불리고, 인자가 전후 값과 일치한다', () => {
    const s = withCatalyst(0xcb20);
    const transitions: { prev: number; next: number }[] = [];
    for (let t = 0; t < 2400; t++) {
      const prev = s.wave.segmentIndex;
      stepWorld(s, idle);
      const next = s.wave.segmentIndex;
      if (next !== prev) transitions.push({ prev, next });
    }
    expect(count('onWaveAdvancedCatalyst')).toBe(transitions.length);
    expect(hoisted.waveAdvances).toEqual(transitions);
  });

  it('음성 대조: 세그먼트가 안 변한 첫 틱에는 0 이다', () => {
    const s = withCatalyst(0xcb21);
    stepWorld(s, idle);
    expect(s.wave.segmentIndex).toBe(0);
    expect(count('onWaveAdvancedCatalyst')).toBe(0);
  });
});

describe('신규 앵커 — 접촉 판정', () => {
  it('접촉한 틱에 `onEnemyContactCatalyst` 가 불린다', () => {
    const s = withCatalyst(0xcb30);
    const p = player(s);
    plantEnemy(s, p.x, p.y, 5);
    stepWorld(s, idle);
    expect(count('onEnemyContactCatalyst')).toBeGreaterThan(0);
  });

  it('⭐ **무적 중에도 불린다** (id 1 강탈이 대시 무적 파고들기로 성립해야 한다)', () => {
    const s = withCatalyst(0xcb31);
    const p = player(s);
    p.iframes = 60;
    plantEnemy(s, p.x, p.y, 5);
    stepWorld(s, idle);
    expect(
      count('onEnemyContactCatalyst'),
      '앵커가 무적 조기 반환 **뒤**에 서 있다 — id 1 이 구조적으로 0회가 된다',
    ).toBeGreaterThan(0);
    // 무적 짝(`onContactInvuln`)도 같은 틱에 불렸다 = 순서가 뒤집히지 않았다.
    expect(count('onContactInvuln')).toBeGreaterThan(0);
  });

  it('음성 대조: 떨어져 있으면 0 이다', () => {
    const s = withCatalyst(0xcb32);
    const p = player(s);
    plantEnemy(s, p.x + 4000, p.y + 4000, 5);
    stepWorld(s, idle);
    expect(count('onEnemyContactCatalyst')).toBe(0);
  });
});

describe('신규 앵커 — 적 이동 배율', () => {
  it('살아 있는 적마다 매 틱 한 번 불린다', () => {
    const s = withCatalyst(0xcb40);
    const p = player(s);
    plantEnemy(s, p.x + 600, p.y);
    plantEnemy(s, p.x + 800, p.y);
    const before = count('onEnemyStepCatalyst');
    stepWorld(s, idle);
    expect(count('onEnemyStepCatalyst') - before).toBeGreaterThanOrEqual(2);
  });

  it('⭐ 반환 배율이 실제 이동에 도달한다 (0 을 돌려주면 적이 멈춘다)', () => {
    const s = withCatalyst(0xcb41);
    const p = player(s);
    const e = plantEnemy(s, p.x + 600, p.y);
    hoisted.forceEnemyStepMult = 0;
    const x0 = e.x;
    const y0 = e.y;
    for (let t = 0; t < 10; t++) stepWorld(s, idle);
    expect(e.x, '반환값이 뒤에서 삼켜졌다').toBe(x0);
    expect(e.y).toBe(y0);
  });

  // ⚠️ "적이 없으면 0" 은 쓸 수 없다 — 첫 틱에 `updateWaves` 가 이미 적을 낳는다. 대신 **같은
  // 시드 두 런의 차분**으로 잰다(웨이브 스폰이 동일하므로 차이는 심은 적 수뿐이다).
  it('음성 대조(차분): 심은 적 수만큼만 호출이 는다', () => {
    const base = withCatalyst(0xcb42);
    stepWorld(base, idle);
    const baseline = count('onEnemyStepCatalyst');

    for (const k of Object.keys(hoisted.calls)) delete hoisted.calls[k];
    const s = withCatalyst(0xcb42);
    const p = player(s);
    // ⚠️ `enemyType` 을 유효한 값으로 세워야 한다 — `blankEntity` 기본값은 정의표에 없어
    // `enemyDefFor` 가 `undefined` 를 돌려주고, 그 적은 이동 단계에서 통째로 건너뛰어진다
    // (앵커도 안 불린다). 이 자리를 빼먹으면 계측이 조용히 0 을 낸다.
    plantEnemy(s, p.x + 600, p.y).enemyType = 0;
    plantEnemy(s, p.x + 800, p.y).enemyType = 0;
    stepWorld(s, idle);
    expect(count('onEnemyStepCatalyst') - baseline).toBe(2);
  });
});

describe('신규 앵커 — 파괴물 파괴', () => {
  function breakOne(state: WorldState): void {
    const d = spawnDestructible(state, 900, 900, 48, 30, 5);
    // `compact` 의 첫 줄이 `if (!e.dead) { survivors.push; continue; }` 라 **둘 다** 필요하다 —
    // 실제 파괴 경로(아군탄 명중)도 hp 를 0 으로 만들면서 `dead` 를 같이 세운다.
    d.hp = 0;
    d.dead = true;
    stepWorld(state, idle);
  }

  it('파괴된 틱에 불리고, 억제 안 하면 기본 젬이 종전대로 나온다', () => {
    const s = withCatalyst(0xcb50);
    breakOne(s);
    expect(count('onDestructibleDestroyedCatalyst')).toBe(1);
    expect(s.entities.some((e) => e.kind === 'gem')).toBe(true);
  });

  it('⭐ `true` 를 돌려주면 기본 젬이 **안 나온다**', () => {
    hoisted.forceDestructibleSuppress = true;
    const s = withCatalyst(0xcb51);
    breakOne(s);
    expect(count('onDestructibleDestroyedCatalyst')).toBe(1);
    expect(s.entities.some((e) => e.kind === 'gem')).toBe(false);
  });

  it('음성 대조: 파괴가 없는 틱에는 0 이다', () => {
    const s = withCatalyst(0xcb52);
    stepWorld(s, idle);
    expect(count('onDestructibleDestroyedCatalyst')).toBe(0);
  });
});

describe('신규 앵커 — 촉매 해저드 per-tick 피해', () => {
  /** 촉매 해저드 하나(즉시 활성 · 지속형). */
  function plantCatalystHazard(state: WorldState, x: number, y: number, dmg: number): Entity {
    const h = spawnCatalystHazard(state, x, y, 200, 0, 600, dmg, true);
    if (h === undefined) throw new Error('상한에 걸렸다');
    return h;
  }

  it('매 틱 한 번 불린다 (`resolveCollisions` 의 새 단계)', () => {
    const s = withCatalyst(0xcb60);
    stepWorld(s, idle);
    expect(count('stepCatalystHazards')).toBe(1);
    stepWorld(s, idle);
    expect(count('stepCatalystHazards')).toBe(2);
  });

  it('⭐ 반경 안 적의 hp 를 깎고, 죽으면 **`dead` 를 세운다**(좀비 회귀 차단)', () => {
    const s = withCatalyst(0xcb61);
    const p = player(s);
    const e = plantEnemy(s, p.x + 300, p.y);
    e.hp = 5;
    e.maxHp = 5;
    plantCatalystHazard(s, p.x + 300, p.y, 100);
    stepWorld(s, idle);
    expect(e.hp).toBeLessThanOrEqual(0);
    expect(e.dead, 'hp 만 0 이고 dead 가 안 섰다 = compact 가 못 걷어가는 좀비').toBe(true);
  });

  it('음성 대조: 반경 밖 적은 안 깎인다', () => {
    const s = withCatalyst(0xcb62);
    const p = player(s);
    const e = plantEnemy(s, p.x + 2000, p.y);
    const hp0 = e.hp;
    plantCatalystHazard(s, p.x + 300, p.y, 100);
    stepWorld(s, idle);
    expect(e.hp).toBe(hp0);
  });

  it('⚠️ 무촉매 런은 **루프가 0회**다 (촉매 해저드를 심어도 아무 것도 안 깎인다)', () => {
    const s = noCatalyst(0xcb63);
    const p = player(s);
    const e = plantEnemy(s, p.x + 300, p.y);
    const hp0 = e.hp;
    // 게이트 밖에서 심는다 — 무촉매 런에서 이 단계가 정말 안 도는지 재는 것이 요점이다.
    spawnHazard(s, HAZARD_CATALYST, p.x + 300, p.y, 200, 0, 600, 100, true, 0);
    stepWorld(s, idle);
    expect(count('stepCatalystHazards'), '호출 자체는 일어난다(게이트는 함수 안)').toBe(1);
    expect(e.hp, '무촉매 런에서 촉매 해저드가 적을 때렸다 = 게이트가 없다').toBe(hp0);
  });
});

describe('촉매 해저드 — 동시 상한과 영구 금지', () => {
  it('상한을 넘으면 스폰만 생략한다 (RNG 미소비)', () => {
    const s = withCatalyst(0xcb70);
    const rngBefore = JSON.stringify(s.dropRng);
    for (let i = 0; i < CATALYST_HAZARD_LIVE_CAP; i++) {
      expect(spawnCatalystHazard(s, 100 * i, 100, 50, 0, 600, 1, true)).toBeDefined();
    }
    expect(spawnCatalystHazard(s, 9999, 100, 50, 0, 600, 1, true)).toBeUndefined();
    expect(JSON.stringify(s.dropRng), '상한 판정이 RNG 를 소비했다').toBe(rngBefore);
  });

  it('⚠️ 영구(`life < 0`) 촉매 해저드는 **던진다** (청크 예산 잠식·경로 독립성 파손)', () => {
    const s = withCatalyst(0xcb71);
    expect(() => spawnCatalystHazard(s, 100, 100, 50, 0, -1, 1, true)).toThrow();
  });
});
