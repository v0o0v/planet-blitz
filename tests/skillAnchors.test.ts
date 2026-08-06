/**
 * 210스킬 **앵커 9개가 그 사건에서 실제로 불리는가** (S0 · ADR-0049).
 *
 * ## 이 파일이 단언하는 것과 **일부러 단언하지 않는 것**
 * 세는 것은 **호출 횟수**뿐이다. "효과가 있다"는 한 줄도 단언하지 않는다 — S0 의 디스패처는
 * 전 분기가 비어 있고, 효과 단언은 배선 레인의 몫이다. 여기서 효과를 잠그면 그 레인의 검증이
 * **항진**이 된다(자기가 넣은 효과를 자기가 확인하는 꼴).
 *
 * ## 왜 이 계측이 필요한가
 * 이 저장소의 지배적 실패 모드는 "배선이 통째로 없다"이고, 그 미발동은 화면에도 테스트에도
 * 흔적을 남기지 않는다. 배선 레인은 앵커가 **불린다는 전제** 위에 스킬을 얹으므로, 그 전제를
 * 여기서 한 번 실증해 두지 않으면 일곱 레인이 전부 같은 거짓 위에 선다.
 *
 * ## 계측 방식 — `vi.mock` 으로 모듈 경계를 감싼다
 * 앵커를 `world.ts` 안 private 함수로 두었다면 이 파일은 원리적으로 쓸 수 없다. 그래서 앵커가
 * `src/sim/skillHooks.ts` 라는 별도 leaf 모듈에 있다(그 파일 헤더의 근거 ②).
 *
 * ## ⚠️ 음성 대조를 반드시 함께 둔다
 * "불렸다"만 세면 **매 틱 무조건 불리는 훅**도 통과한다. 앞 레인에서 벽 게이트 단언이 실은
 * "대시가 벽에 부딪힌다"를 재고 있었고 뮤턴트에서 살아남았다. 그래서 각 사건마다 **그 사건이
 * 없는 런에서는 0 이다**를 같이 잠근다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/** 앵커별 호출 횟수. `vi.mock` 팩토리가 모듈 평가보다 먼저 도므로 `vi.hoisted` 로 올린다. */
const hoisted = vi.hoisted(() => ({
  calls: {} as Record<string, number>,
  /** 앵커 ⑪ 이 받은 인자 기록 — **좌표가 실제로 실려 오는가**를 재려면 횟수만으로는 부족하다. */
  deaths: [] as { x: number; y: number; elite: boolean }[],
}));

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
      if (name === 'onEnemyDeath') {
        hoisted.deaths.push({
          x: args[1] as number,
          y: args[2] as number,
          elite: args[3] as boolean,
        });
      }
      // **원본을 그대로 태운다** — 감싸기가 거동을 바꾸면 이 파일이 재는 것이 프로덕션이 아니게 된다.
      return fn(...args);
    };
  }
  return wrapped;
});

const { createWorld, stepWorld, emptyInput, DEFAULT_CONFIG, SPECIAL_POWERUP_PICK } = await import(
  '../src/sim/world.js'
);
const { blankEntity, addEntity, spawnBullet, spawnGem, spawnWall } = await import(
  '../src/sim/entities.js'
);
const { DT } = await import('../src/sim/constants.js');
const { hashWorld } = await import('../src/sim/replay.js');
const { FILM_ABSORB_FLAT, CUSHION_RECOVER_TICKS } = await import(
  '../src/sim/shipSignature.js'
);
type WorldState = import('../src/sim/world.js').WorldState;
type InputFrame = import('../src/sim/world.js').InputFrame;
type Entity = import('../src/sim/entities.js').Entity;

const idle: InputFrame = emptyInput();

function count(name: string): number {
  return hoisted.calls[name] ?? 0;
}

/**
 * 스킬이 **투자된** 런. 앵커의 첫 줄이 `if (!state.skillsOn) return;` 이라, 투자가 없으면
 * 훅이 즉시 반환한다 — 그래도 **호출 자체는 일어나므로** 이 계측은 게이트와 무관하게 성립한다.
 * 그래도 투자를 넣는 이유는 배선 레인이 실제로 밟을 경로와 같은 상태에서 재기 위함이다.
 */
function skilled(seed: number, shipType?: number): WorldState {
  const invest = new Array<number>(60).fill(0);
  invest[0] = 1;
  return createWorld(seed, {
    ...DEFAULT_CONFIG,
    skillInvest: invest,
    ...(shipType !== undefined ? { shipType } : {}),
  });
}

/** 잡몹 하나를 세운다. hp 를 크게 잡아 한 방에 죽지 않게 한다(킬 사건과 분리). */
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

beforeEach(() => {
  for (const k of Object.keys(hoisted.calls)) delete hoisted.calls[k];
  hoisted.deaths = [];
});

// ---------------------------------------------------------------------------
// 사전 조건 — 계측기 자체가 살아 있는가
// ---------------------------------------------------------------------------

describe('계측 이음매', () => {
  it('앵커 21개 + 공유 술어가 전부 export 돼 있다 (이름이 바뀌면 계측이 조용히 0 이 된다)', async () => {
    const mod = await import('../src/sim/skillHooks.js');
    expect(Object.keys(mod).sort()).toEqual(
      [
        'onBulletExpired',
        // ⚠️ S2 여섯은 **미배선 141종이 몰려 있던 지점 넷**을 연다. 넷인데 여섯인 것은 막 흡수와
        // 정산이 각각 "산술에 개입" 과 "사건을 관측" 으로 갈리기 때문이다 — 한 지점에 하나만
        // 두면 앵커 ⑮ 가 실제로 밟은 함정(관측 대상이 그 지점에 이미 없다)을 되풀이한다.
        'onCloakBreakReset', // S2 ㉑ — 팬텀 리셋 직전([치명] 이었던 지점)
        'onCushionSettled', // S2 ⑳ — 정산 직후
        'onCushionThreshold', // S2 ⑲ — 정산 임계
        'onDamageChain',
        'onDashFired',
        'onEnemyDamaged', // S1
        'onEnemyDeath', // S1
        // ⚠️ 앵커 ⑮ 는 앞의 14개와 성질이 다르다 — **한 기체의 시그니처 사건**(버블 방막
        // 파열)이라 `stepWorld` 가 아니라 `filmBurst.ts` 가 부르고, 촉매 짝도 없다. 배치 4가
        // 뚫었다(`skillHooks.ts` 의 그 함수 주석이 사유의 정본).
        'onFilmBurst',
        'onFilmAbsorbed', // S2 ⑱ — 막이 닳은 직후(파열 판정보다 앞)
        'onFilmShield', // S2 ⑰ — 막 흡수 산술 직전(유효 내구)
        'onGemCollected',
        'onKillsDelta',
        'onLevelUp', // S1
        'onPlayerDamaged',
        'onPowerupOffer', // S1
        'onPowerupPicked', // S1
        'onSignatureStep',
        'onVolleyFired',
        'onVolleyParams', // S2 ⑯ — 발사부(전 기체 최다 미배선 사유)
        'onWallContact',
        'survivedLethalBlow',
      ].sort(),
    );
  });

  it('`skillsOn` 은 투자 유무에서 파생된다 (앵커 게이트의 근거)', () => {
    expect(skilled(1).skillsOn).toBe(true);
    expect(createWorld(1, { ...DEFAULT_CONFIG }).skillsOn).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 앵커 9개
// ---------------------------------------------------------------------------

describe('앵커 ⑨ onSignatureStep — 매 틱', () => {
  it('한 틱에 정확히 한 번 불린다', () => {
    const s = skilled(0x9001);
    stepWorld(s, idle);
    expect(count('onSignatureStep')).toBe(1);
    stepWorld(s, idle);
    expect(count('onSignatureStep')).toBe(2);
  });
});

describe('앵커 ② onDashFired — 대시 발동', () => {
  it('대시 입력이 있고 쿨다운이 0 이면 불린다', () => {
    const s = skilled(0x9002);
    stepWorld(s, { ...idle, dash: true });
    expect(count('onDashFired')).toBe(1);
  });

  it('음성 대조 ①: 대시 입력이 없는 틱에는 0 이다', () => {
    const s = skilled(0x9002);
    stepWorld(s, idle);
    expect(count('onDashFired')).toBe(0);
  });

  it('음성 대조 ②: 쿨다운 중에는 대시 입력이 있어도 0 이다', () => {
    const s = skilled(0x9002);
    stepWorld(s, { ...idle, dash: true });
    hoisted.calls['onDashFired'] = 0;
    stepWorld(s, { ...idle, dash: true }); // 직전 틱이 쿨다운을 세웠다
    expect(count('onDashFired')).toBe(0);
  });
});

describe('앵커 ⑦ onWallContact — 벽 접촉 틱', () => {
  it('벽에 겹친 틱에 불린다', () => {
    const s = skilled(0x9003);
    spawnWall(s, 0, 0, 200, 200); // 플레이어(원점)를 통째로 덮는 벽
    stepWorld(s, idle);
    expect(s.wallContactTicks).toBeGreaterThan(0);
    expect(count('onWallContact')).toBe(1);
  });

  it('음성 대조: 벽이 없는 무대에서는 0 이다', () => {
    const s = skilled(0x9003);
    // 절차 지형이 원점 근처에 벽을 놓는 시드를 배제하기 위해 접촉 플래그로 전제를 확인한다.
    stepWorld(s, idle);
    if (s.wallContactTicks === 0) expect(count('onWallContact')).toBe(0);
  });
});

describe('앵커 ③ onGemCollected — 젬 수거', () => {
  it('플레이어에 겹친 젬 하나당 한 번 불린다', () => {
    const s = skilled(0x9004);
    const gemsBefore = s.gems;
    spawnGem(s, 0, 0, 5);
    stepWorld(s, idle);
    expect(s.gems).toBe(gemsBefore + 1);
    expect(count('onGemCollected')).toBe(1);
  });

  it('음성 대조: 젬이 없는 틱에는 0 이다', () => {
    const s = skilled(0x9004);
    stepWorld(s, idle);
    expect(count('onGemCollected')).toBe(0);
  });
});

describe('앵커 ① onVolleyFired — 볼리 발사 확정', () => {
  it('사거리 안 표적이 있으면 불린다', () => {
    const s = skilled(0x9005);
    plantEnemy(s, 400, 0);
    stepWorld(s, idle);
    expect(count('onVolleyFired')).toBe(1);
  });

  it('음성 대조: 쿨다운이 안 찼으면 표적이 있어도 0 이다', () => {
    // "표적이 없는 틱"으로 음성 대조를 잡으면 **웨이브 디렉터가 사거리 안에 적을 낳는 시드에서
    // 조용히 뒤집힌다**(실측으로 0x9005 가 그랬다). 앵커의 술어는 "표적이 있다"가 아니라
    // **"이번 틱에 반드시 발사한다"** 이므로, 쿨다운 게이트로 재는 것이 그 술어에 정확히 맞다.
    const s = skilled(0x9005);
    plantEnemy(s, 400, 0);
    const p = s.entities[0];
    if (p === undefined) throw new Error('플레이어가 0번에 없다');
    p.cooldown = 999;
    stepWorld(s, idle);
    expect(count('onVolleyFired')).toBe(0);
  });
});

describe('앵커 ④⑧ onPlayerDamaged · onDamageChain — 피격', () => {
  it('접촉 피해를 입은 틱에 둘 다 불린다', () => {
    const s = skilled(0x9006);
    plantEnemy(s, 0, 0, 7); // 플레이어에 겹친 적 — 접촉 피해
    const hpBefore = s.entities[0]?.hp ?? 0;
    stepWorld(s, idle);
    expect(s.entities[0]?.hp).toBeLessThan(hpBefore);
    expect(count('onDamageChain')).toBe(1);
    expect(count('onPlayerDamaged')).toBe(1);
  });

  it('음성 대조: 맞지 않은 틱에는 둘 다 0 이다', () => {
    const s = skilled(0x9006);
    stepWorld(s, idle);
    expect(count('onDamageChain')).toBe(0);
    expect(count('onPlayerDamaged')).toBe(0);
  });

  it('onDamageChain 은 S0 에서 **항등**이다 (사슬에 계수가 안 실린다)', () => {
    // 효과 단언이 아니라 **비-효과** 단언이다 — S0 의 합격 조건이 거동 불변이므로,
    // 훅이 인자를 그대로 돌려주는 것 자체가 이 커밋의 계약이다.
    const s = skilled(0x9006);
    const before = s.entities[0]?.hp ?? 0;
    plantEnemy(s, 0, 0, 9);
    stepWorld(s, idle);
    const dealt = before - (s.entities[0]?.hp ?? 0);
    // 접촉 피해 9 에 피격 배수만 걸린 값 — 스킬 감소·흡수가 한 칸도 안 깎았다.
    expect(dealt).toBe(9 * 2);
  });
});

describe('앵커 ⑤ onKillsDelta — 처치 증분', () => {
  it('이번 틱에 처치가 생기면 한 번 불린다', () => {
    const s = skilled(0x9007);
    const e = plantEnemy(s, 600, 600);
    e.hp = 0;
    e.dead = true;
    const killsBefore = s.kills;
    stepWorld(s, idle);
    expect(s.kills).toBeGreaterThan(killsBefore);
    expect(count('onKillsDelta')).toBe(1);
  });

  it('음성 대조: 처치가 없는 틱에는 0 이다 (`compact` 은 매 틱 도는데도)', () => {
    const s = skilled(0x9007);
    stepWorld(s, idle);
    expect(count('onKillsDelta')).toBe(0);
  });
});

describe('앵커 ⑥ onBulletExpired — 관통 예산 소진', () => {
  /**
   * 무대 좌표는 `bulletHitOrder.test.ts` 의 근거를 그대로 쓴다: 오토어택 사거리(1650) **밖**,
   * 탄 컬링 반경(≈2200) **안**. 그래야 플레이어 자기 볼리가 계측을 오염시키지 않는다.
   */
  const STAGE_X = 1980;

  it('관통 0 인 탄이 명중해 소멸하면 불린다', () => {
    const s = skilled(0x9008);
    plantEnemy(s, STAGE_X - 60, 0);
    spawnBullet(s, STAGE_X, 0, Math.PI, 250 / DT, 100, 0, 5, 120, -1, 0);
    stepWorld(s, idle);
    expect(count('onBulletExpired')).toBe(1);
  });

  it('음성 대조: 관통 예산이 남으면 0 이다 (같은 명중인데도)', () => {
    const s = skilled(0x9008);
    plantEnemy(s, STAGE_X - 60, 0);
    spawnBullet(s, STAGE_X, 0, Math.PI, 250 / DT, 100, 1, 5, 120, -1, 0);
    stepWorld(s, idle);
    expect(count('onBulletExpired')).toBe(0);
  });

  it('음성 대조: 명중 없이 날아가는 탄은 0 이다 (수명 만료는 이 앵커가 아니다)', () => {
    const s = skilled(0x9008);
    spawnBullet(s, STAGE_X, 0, Math.PI, 250 / DT, 100, 0, 5, 120, -1, 0);
    stepWorld(s, idle);
    expect(count('onBulletExpired')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 앵커 ⑩⑪ (S1) — 적 단위 축
// ---------------------------------------------------------------------------

describe('앵커 ⑩ onEnemyDamaged — 아군탄 명중으로 피해가 확정된 지점', () => {
  /** 앵커 ⑥ 절과 같은 근거의 무대 좌표 — 오토어택 사거리 밖, 탄 컬링 반경 안. */
  const STAGE_X = 1980;

  it('아군탄이 적에 명중하면 불린다', () => {
    const s = skilled(0xa001);
    plantEnemy(s, STAGE_X - 60, 0);
    spawnBullet(s, STAGE_X, 0, Math.PI, 250 / DT, 100, 0, 5, 120, -1, 0);
    stepWorld(s, idle);
    expect(count('onEnemyDamaged')).toBe(1);
  });

  it('음성 대조 ①: 명중하지 않고 날아가는 탄은 0 이다', () => {
    const s = skilled(0xa001);
    spawnBullet(s, STAGE_X, 0, Math.PI, 250 / DT, 100, 0, 5, 120, -1, 0);
    stepWorld(s, idle);
    expect(count('onEnemyDamaged')).toBe(0);
  });

  it('음성 대조 ②: 아군탄이 없는 첫 틱에는 0 이다 (적이 서 있어도)', () => {
    // 적은 사거리(1650) 밖에 세운다 — 그러지 않으면 플레이어 자기 볼리가 계측을 오염시킨다.
    const s = skilled(0xa002);
    plantEnemy(s, STAGE_X, 0);
    stepWorld(s, idle);
    expect(count('onEnemyDamaged')).toBe(0);
  });

  it('관통탄은 한 틱에 맞춘 표적 수만큼 불린다 (명중 단위이지 탄 단위가 아니다)', () => {
    const s = skilled(0xa003);
    plantEnemy(s, STAGE_X - 40, 0);
    plantEnemy(s, STAGE_X - 90, 0);
    // pierce 를 넉넉히 줘 앞 표적에서 소멸하지 않게 한다.
    spawnBullet(s, STAGE_X, 0, Math.PI, 250 / DT, 100, 5, 5, 120, -1, 0);
    stepWorld(s, idle);
    expect(count('onEnemyDamaged')).toBe(2);
  });
});

describe('앵커 ⑪ onEnemyDeath — 격추 하나당 한 번 · 좌표 포함', () => {
  it('처치가 생기면 격추당 한 번 불리고 좌표가 실려 온다', () => {
    const s = skilled(0xa004);
    const e = plantEnemy(s, 600, 600);
    e.hp = 0;
    e.dead = true;
    stepWorld(s, idle);
    expect(count('onEnemyDeath')).toBe(1);
    const d = hoisted.deaths[0];
    if (d === undefined) throw new Error('격추 인자 기록 없음');
    // 좌표가 **실제 격추 지점**에서 왔다는 것을 잰다(0 이나 undefined 가 아니다). `compact` 이
    // 생존자 배열을 갈아 끼운 뒤에 통지하므로, 캡처를 루프 밖으로 옮기면 여기가 먼저 빨개진다.
    expect(Math.abs(d.x - 600)).toBeLessThan(400);
    expect(Math.abs(d.y - 600)).toBeLessThan(400);
    expect(d.elite).toBe(false);
  });

  it('엘리트 격추는 `elite` 가 참으로 온다', () => {
    const s = skilled(0xa005);
    const e = plantEnemy(s, 600, 600);
    e.pierce = 1; // `isElite` 의 정의(kind==='enemy' && pierce>0)
    e.hp = 0;
    e.dead = true;
    stepWorld(s, idle);
    expect(hoisted.deaths.some((d) => d.elite)).toBe(true);
  });

  it('⚠️ 호출 수 = 처치 델타 (앵커 ⑤ 와 같은 술어라는 항등)', () => {
    const s = skilled(0xa006);
    for (const [x, y] of [
      [600, 600],
      [700, 600],
      [800, 600],
    ]) {
      const e = plantEnemy(s, x as number, y as number);
      e.hp = 0;
      e.dead = true;
    }
    const killsBefore = s.kills;
    stepWorld(s, idle);
    expect(count('onEnemyDeath')).toBe(s.kills - killsBefore);
    expect(count('onEnemyDeath')).toBe(3);
    expect(count('onKillsDelta')).toBe(1); // 집계는 여전히 틱당 한 번이다
  });

  it('음성 대조 ①: 처치가 없는 틱에는 0 이다 (`compact` 은 매 틱 도는데도)', () => {
    const s = skilled(0xa007);
    stepWorld(s, idle);
    expect(count('onEnemyDeath')).toBe(0);
  });

  it('음성 대조 ②: hp 가 남은 채 컬링된 적(도망)은 격추가 아니다', () => {
    // `state.kills++` 와 같은 술어(`hp <= 0`)를 쓰는지 재는 판별식이다. `dead` 만 보고 통지하는
    // 구현이면 여기가 빨개진다 — 강제 스크롤에 밀려 사라진 적이 공짜 처치가 된다.
    const s = skilled(0xa008);
    const e = plantEnemy(s, 600, 600);
    e.dead = true; // hp 는 1_000_000 그대로
    const killsBefore = s.kills;
    stepWorld(s, idle);
    expect(s.kills).toBe(killsBefore);
    expect(count('onEnemyDeath')).toBe(0);
  });
});

describe('앵커 ⑫⑬⑭ onLevelUp · onPowerupOffer · onPowerupPicked — 성장 축', () => {
  it('XP 가 임계를 넘은 틱에 ⑫⑬ 이 각각 한 번 불린다', () => {
    const s = skilled(0xa00a);
    s.xp = 1_000_000; // 임계를 확실히 넘긴다
    const levelBefore = s.level;
    stepWorld(s, idle);
    expect(s.level).toBe(levelBefore + 1);
    expect(s.pendingLevelUp).toBe(true);
    expect(count('onLevelUp')).toBe(1);
    expect(count('onPowerupOffer')).toBe(1);
  });

  it('음성 대조: XP 가 모자란 틱에는 ⑫⑬ 이 0 이다', () => {
    const s = skilled(0xa00b);
    stepWorld(s, idle);
    expect(count('onLevelUp')).toBe(0);
    expect(count('onPowerupOffer')).toBe(0);
  });

  it('⚠️ XP 가 아무리 많아도 한 틱에 한 번뿐이다 (프리즈가 다단 레벨업을 막는다)', () => {
    const s = skilled(0xa00c);
    s.xp = 1_000_000;
    stepWorld(s, idle);
    stepWorld(s, idle); // 프리즈 틱 — `checkLevelUp` 은 도달조차 하지 않는다
    expect(count('onLevelUp')).toBe(1);
  });

  it('픽 프레임이 오면 ⑭ 가 불린다', () => {
    const s = skilled(0xa00d);
    s.xp = 1_000_000;
    stepWorld(s, idle);
    expect(s.powerupChoices.length).toBeGreaterThan(0);
    stepWorld(s, { ...idle, special: SPECIAL_POWERUP_PICK });
    expect(s.pendingLevelUp).toBe(false);
    expect(count('onPowerupPicked')).toBe(1);
  });

  it('음성 대조 ①: 프리즈 중 픽 프레임이 없으면 ⑭ 가 0 이다', () => {
    const s = skilled(0xa00e);
    s.xp = 1_000_000;
    stepWorld(s, idle);
    stepWorld(s, idle);
    expect(s.pendingLevelUp).toBe(true);
    expect(count('onPowerupPicked')).toBe(0);
  });

  it('⚠️ 음성 대조 ②: 범위 밖 선택 인덱스는 ⑭ 를 부르지 않는다 (가드 안쪽에 있다)', () => {
    // 3택(도박사의 칩 없음)에 4번째(index 3)를 고르는 악성 프레임. sim 은 픽을 소비하지 않고
    // 프리즈를 유지한다 — 앵커가 가드 **밖**에 있으면 여기가 빨개진다.
    const s = skilled(0xa00f);
    s.xp = 1_000_000;
    stepWorld(s, idle);
    expect(s.powerupChoices.length).toBe(3);
    stepWorld(s, { ...idle, special: SPECIAL_POWERUP_PICK | (3 << 1) });
    expect(s.pendingLevelUp).toBe(true);
    expect(count('onPowerupPicked')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 앵커 ⑯~㉑ (S2) — 7기체 배선이 뚫은 지점 넷
// ---------------------------------------------------------------------------

describe('앵커 ⑯ onVolleyParams — 발사부(전 기체 최다 미배선 사유)', () => {
  it('앵커 ①과 같은 틱에 정확히 같은 횟수로 불린다 (① → ⑯ 순으로 연달아)', () => {
    const s = skilled(0xb001);
    plantEnemy(s, 400, 0);
    stepWorld(s, idle);
    expect(count('onVolleyFired')).toBe(1);
    expect(count('onVolleyParams')).toBe(count('onVolleyFired'));
  });

  it('음성 대조: 쿨다운이 안 찼으면 발사가 없어 ①⑯ 둘 다 0이다', () => {
    // "표적이 없는 틱"으로 잡으면 웨이브 디렉터가 사거리 안에 적을 낳는 시드에서 조용히
    // 뒤집힌다(앵커 ① 절의 실측 근거 0x9005). 같은 이유로 쿨다운 게이트를 쓴다.
    const s = skilled(0xb002);
    plantEnemy(s, 400, 0);
    const p = s.entities[0];
    if (p === undefined) throw new Error('플레이어가 0번에 없다');
    p.cooldown = 999;
    stepWorld(s, idle);
    expect(count('onVolleyFired')).toBe(0);
    expect(count('onVolleyParams')).toBe(0);
  });
});

describe('앵커 ⑰⑱ onFilmShield · onFilmAbsorbed — 버블 막 흡수(산술 직전 · 직후)', () => {
  it('버블 + 막이 선 상태(aux0>0)에서 피격하면 ⑰⑱ 이 각각 한 번씩 불린다', () => {
    const s = skilled(0xc001, 6); // 버블(id=6, SIG_BUBBLE_FILM)
    const p = s.entities[0];
    if (p === undefined) throw new Error('플레이어가 0번에 없다');
    p.aux0 = FILM_ABSORB_FLAT;
    plantEnemy(s, 0, 0, 10); // 플레이어에 겹친 적 — 접촉 피해
    stepWorld(s, idle);
    expect(count('onFilmShield')).toBe(1);
    expect(count('onFilmAbsorbed')).toBe(1);
  });

  it('음성 대조 ①: 막이 없으면(aux0=0) 피격해도 0이다', () => {
    const s = skilled(0xc002, 6);
    const hpBefore = s.entities[0]?.hp ?? 0;
    plantEnemy(s, 0, 0, 10);
    stepWorld(s, idle);
    // 막 없이도 피격 자체는 일어났다는 것을 확인해 "애초에 안 맞았다" 는 거짓 음성을 배제한다.
    expect(s.entities[0]?.hp).toBeLessThan(hpBefore);
    expect(count('onFilmShield')).toBe(0);
    expect(count('onFilmAbsorbed')).toBe(0);
  });

  it('음성 대조 ②: 다른 기체(막 없는 시그니처)에서는 0이다', () => {
    const s = skilled(0xc003); // 기본 기체(스트라이커, SIG_STRIKER_MARKSMAN)
    const hpBefore = s.entities[0]?.hp ?? 0;
    plantEnemy(s, 0, 0, 10);
    stepWorld(s, idle);
    expect(s.entities[0]?.hp).toBeLessThan(hpBefore);
    expect(count('onFilmShield')).toBe(0);
    expect(count('onFilmAbsorbed')).toBe(0);
  });
});

describe('앵커 ⑲ onCushionThreshold — 말로우 완충 정산 임계(매 틱)', () => {
  it('말로우 런에서 정산 여부와 무관하게 매 틱 불린다', () => {
    const s = skilled(0xd001, 5); // 말로우(id=5, SIG_MALLOW_CUSHION)
    stepWorld(s, idle);
    expect(count('onCushionThreshold')).toBe(1);
    stepWorld(s, idle);
    expect(count('onCushionThreshold')).toBe(2);
  });

  it('음성 대조: 다른 기체에서는 0이다', () => {
    const s = skilled(0xd002); // 기본 기체
    stepWorld(s, idle);
    stepWorld(s, idle);
    expect(count('onCushionThreshold')).toBe(0);
  });
});

describe('앵커 ⑳ onCushionSettled — 말로우 완충 정산 직후', () => {
  it('부채(aux0>0) + 무피격 임계 도달에서만 불린다', () => {
    const s = skilled(0xe001, 5);
    const p = s.entities[0];
    if (p === undefined) throw new Error('플레이어가 0번에 없다');
    p.aux0 = 100; // 적립된 지연 피해
    p.aux1 = CUSHION_RECOVER_TICKS - 1; // 이번 틱에 임계를 채운다
    stepWorld(s, idle);
    expect(count('onCushionThreshold')).toBe(1);
    expect(count('onCushionSettled')).toBe(1);
    expect(p.aux0).toBe(0); // 정산 후 리셋됐다는 전제 확인
  });

  it('⚠️ ⑲ 이 불려도 ⑳ 은 안 불리는 틱이 존재한다 (임계 미도달)', () => {
    const s = skilled(0xe002, 5);
    const p = s.entities[0];
    if (p === undefined) throw new Error('플레이어가 0번에 없다');
    p.aux0 = 100;
    p.aux1 = 0; // 이번 틱엔 1이 될 뿐, 임계(180)에 한참 못 미친다
    stepWorld(s, idle);
    expect(count('onCushionThreshold')).toBe(1);
    expect(count('onCushionSettled')).toBe(0);
  });

  it('음성 대조: 부채가 없으면(aux0=0) 임계에 도달해도 0이다', () => {
    const s = skilled(0xe003, 5);
    const p = s.entities[0];
    if (p === undefined) throw new Error('플레이어가 0번에 없다');
    p.aux0 = 0;
    p.aux1 = CUSHION_RECOVER_TICKS - 1;
    stepWorld(s, idle);
    expect(count('onCushionThreshold')).toBe(1);
    expect(count('onCushionSettled')).toBe(0);
  });
});

describe('앵커 ㉑ onCloakBreakReset — 팬텀 무피격 스트릭 리셋 직전', () => {
  it('실제로 hp가 깎인 피격을 받아야 불린다', () => {
    const s = skilled(0xf001, 3); // 팬텀(id=3, SIG_PHANTOM_CLOAK)
    const hpBefore = s.entities[0]?.hp ?? 0;
    plantEnemy(s, 0, 0, 10); // 플레이어에 겹친 적 — 접촉 피해
    stepWorld(s, idle);
    expect(s.entities[0]?.hp).toBeLessThan(hpBefore);
    expect(count('onCloakBreakReset')).toBe(1);
  });

  it('음성 대조 ①: 무적(iframes) 중에는 접촉해도 hp가 안 깎여 0이다', () => {
    // 버블의 막 전량 흡수와 같은 형태(hp 가 안 깎이는 경로)를 팬텀에서 재현한 것 —
    // `invulnerable` 게이트가 접촉 피해 수집을 아예 막아 dmg 가 0인 채로 남는다.
    const s = skilled(0xf002, 3);
    const p = s.entities[0];
    if (p === undefined) throw new Error('플레이어가 0번에 없다');
    p.iframes = 40;
    const hpBefore = p.hp;
    plantEnemy(s, 0, 0, 10);
    stepWorld(s, idle);
    expect(s.entities[0]?.hp).toBe(hpBefore);
    expect(count('onCloakBreakReset')).toBe(0);
  });

  it('음성 대조 ②: 다른 기체에서는 0이다', () => {
    const s = skilled(0xf003); // 기본 기체
    const hpBefore = s.entities[0]?.hp ?? 0;
    plantEnemy(s, 0, 0, 10);
    stepWorld(s, idle);
    expect(s.entities[0]?.hp).toBeLessThan(hpBefore);
    expect(count('onCloakBreakReset')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// S1 거동 불변 — **신규 앵커가 실제로 불린 런**에서 재는 것이 핵심이다
// ---------------------------------------------------------------------------

describe('S1 앵커는 거동을 바꾸지 않는다', () => {
  it('앵커가 도는 240틱 런 두 개가 같은 해시다', () => {
    // 240틱을 돌려 오토어택이 웨이브 적을 실제로 때리고 죽이게 한다 — "앵커가 한 번도 안 불린
    // 런에서 해시가 같다"는 아무것도 증명하지 못하므로, 아래 두 단언이 **전제 확인**이다.
    const a = skilled(0xa009);
    const b = skilled(0xa009);
    for (let t = 0; t < 240; t++) {
      stepWorld(a, idle);
      stepWorld(b, idle);
    }
    expect(count('onEnemyDamaged'), '이 런은 명중이 없어 앵커 ⑩ 을 못 쟀다').toBeGreaterThan(0);
    expect(count('onEnemyDeath'), '이 런은 처치가 없어 앵커 ⑪ 을 못 쟀다').toBeGreaterThan(0);
    expect(hashWorld(a)).toBe(hashWorld(b));
  });

  it('⚠️ 이 절이 못 잡는 것: "예전 코드와 같은 해시인가"', () => {
    // 위는 **상대 비교**라, 앵커가 거동을 바꾸는 구현도 두 런이 똑같이 바뀌면 통과한다.
    // 절대 판정은 골든 픽스처(`pnpm test:sim`)가 진다 — 리드가 돌린다.
    // 이 커밋이 낼 수 있는 나머지 근거는 **전 분기가 비어 있다**는 구조적 사실이다.
    expect(true).toBe(true);
  });
});
