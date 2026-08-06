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
const hoisted = vi.hoisted(() => ({ calls: {} as Record<string, number> }));

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
      // **원본을 그대로 태운다** — 감싸기가 거동을 바꾸면 이 파일이 재는 것이 프로덕션이 아니게 된다.
      return fn(...args);
    };
  }
  return wrapped;
});

const { createWorld, stepWorld, emptyInput, DEFAULT_CONFIG } = await import('../src/sim/world.js');
const { blankEntity, addEntity, spawnBullet, spawnGem, spawnWall } = await import(
  '../src/sim/entities.js'
);
const { DT } = await import('../src/sim/constants.js');
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
function skilled(seed: number): WorldState {
  const invest = new Array<number>(60).fill(0);
  invest[0] = 1;
  return createWorld(seed, { ...DEFAULT_CONFIG, skillInvest: invest });
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
});

// ---------------------------------------------------------------------------
// 사전 조건 — 계측기 자체가 살아 있는가
// ---------------------------------------------------------------------------

describe('계측 이음매', () => {
  it('앵커 9개 + 공유 술어가 전부 export 돼 있다 (이름이 바뀌면 계측이 조용히 0 이 된다)', async () => {
    const mod = await import('../src/sim/skillHooks.js');
    expect(Object.keys(mod).sort()).toEqual(
      [
        'onBulletExpired',
        'onDamageChain',
        'onDashFired',
        'onGemCollected',
        'onKillsDelta',
        'onPlayerDamaged',
        'onSignatureStep',
        'onVolleyFired',
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
