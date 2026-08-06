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
  /**
   * 앵커 ㉒ 가 받은 인자 + **그 시점의** 플레이어 상태. FI9 의 술어가 `hp - dmg <= 0` 이라
   * "그 지점에서 관측 대상이 아직 살아 있는가"(hp 가 아직 안 깎였는가)를 재야 한다 —
   * 횟수만으로는 앵커 ⑮ 가 밟은 함정(대상이 그 지점에 이미 없다)을 다시 놓친다.
   * `player` 는 이후 틱에서 계속 변하므로 **호출 순간에 스칼라로 떠 둔다.**
   */
  filmEntries: [] as { hp: number; aux0: number; dmg: number }[],
  /**
   * 앵커 ㉓ 의 레코드를 **실제로 고치는 가짜 훅**. 호출 횟수만 세면 "불렸다" 밖에 못 재고,
   * 앵커 ⑰ 이 `min` 에 삼켜져 무효였던 전례가 정확히 그 사각지대에서 났다. 여기서 값을
   * 고쳐 보고 **결과가 실제로 달라지는지**를 잰다.
   */
  broodPatch: null as null | ((p: Record<string, number>) => void),
  /** 앵커 ㉔ 가 받은 개체 기록 — 좌표·활성 여부가 실려 오는가. */
  launched: [] as { x: number; y: number; active: boolean }[],
  /** 호출 **순서**. "㉕ 가 ⑳ 보다 앞" 같은 순서 계약은 횟수로는 못 잰다. */
  order: [] as string[],
  /**
   * 앵커 반환값 **뮤테이션**. 값을 돌려주는 앵커는 "불렸다" 만으로는 부족하다 — 뒤 산술의
   * `min`/`clamp` 가 개입을 통째로 삼켜 **원리적으로 무효인 앵커**가 될 수 있고, 이 저장소에
   * 실제로 그런 전례가 있다(앵커 ⑰). 훅의 반환을 실제로 바꿔 **최종 상태가 달라지는지**를
   * 재는 것이 그 유일한 물증이다. 기본은 비어 있고 `beforeEach` 가 비운다.
   */
  mutate: {} as Record<string, (ret: unknown, args: unknown[]) => unknown>,
  /**
   * 앵커 ⑯ 이 받은 `VolleyParams` 의 **훅 실행 전 스냅숏**. 참조를 그대로 담으면 훅이 고친
   * 뒤의 값을 보게 되어 "읽기 전용인가" 를 못 잰다 — 그래서 값으로 떠 둔다.
   */
  volleys: [] as { aimAngle: number; targetDist: number; inputX: number; inputY: number }[],
  /**
   * 앵커 ⑥ 이 받은 인자 기록. 횟수만으로는 **사유가 갈렸는가**를 못 재고, 사유를 못 재면
   * "수명 만료에서도 불린다" 와 "기존 스킬이 두 배로 터진다" 가 같은 관측이 된다.
   * 좌표는 **호출 시점 값을 복사**한다 — 엔티티 참조를 담으면 압축 뒤 값으로 바뀐다.
   */
  expiries: [] as { x: number; y: number; reason: string }[],
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
      hoisted.order.push(name);
      if (name === 'onEnemyDeath') {
        hoisted.deaths.push({
          x: args[1] as number,
          y: args[2] as number,
          elite: args[3] as boolean,
        });
      }
      if (name === 'onFilmEntry') {
        const p = args[1] as { hp: number; aux0: number };
        hoisted.filmEntries.push({ hp: p.hp, aux0: p.aux0, dmg: args[2] as number });
      }
      if (name === 'onBroodLaunched') {
        const c = args[2] as { x: number; y: number; phase: number };
        hoisted.launched.push({ x: c.x, y: c.y, active: c.phase === 1 });
      }
      if (name === 'onVolleyParams') {
        const v = args[2] as { aimAngle: number; targetDist: number; inputX: number; inputY: number };
        hoisted.volleys.push({
          aimAngle: v.aimAngle,
          targetDist: v.targetDist,
          inputX: v.inputX,
          inputY: v.inputY,
        });
      }
      if (name === 'onBulletExpired') {
        const b = args[1] as { x: number; y: number };
        hoisted.expiries.push({ x: b.x, y: b.y, reason: args[2] as string });
      }
      // **원본을 그대로 태운다** — 감싸기가 거동을 바꾸면 이 파일이 재는 것이 프로덕션이 아니게 된다.
      const out = fn(...args);
      // 진짜 훅이 돈 **뒤**에 레코드를 고친다 — 배선 레인의 효과 함수와 같은 자리다.
      if (name === 'onBroodLaunchParams' && hoisted.broodPatch !== null) {
        hoisted.broodPatch(args[2] as Record<string, number>);
      }
      const m = hoisted.mutate[name];
      return m === undefined ? out : m(out, args);
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
const { FILM_ABSORB_FLAT, CUSHION_RECOVER_TICKS, BROOD_MARK, cushionSettled } = await import(
  '../src/sim/shipSignature.js'
);
const { isActiveTurret, TURRET_LIFE_TICKS } = await import('../src/sim/events.js');
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
  for (const k of Object.keys(hoisted.mutate)) delete hoisted.mutate[k];
  hoisted.deaths = [];
  hoisted.filmEntries = [];
  hoisted.broodPatch = null;
  hoisted.launched = [];
  hoisted.order = [];
  hoisted.volleys = [];
  hoisted.expiries = [];
});

// ---------------------------------------------------------------------------
// 사전 조건 — 계측기 자체가 살아 있는가
// ---------------------------------------------------------------------------

describe('계측 이음매', () => {
  it('앵커 25개 + 공유 술어가 전부 export 돼 있다 (이름이 바뀌면 계측이 조용히 0 이 된다)', async () => {
    const mod = await import('../src/sim/skillHooks.js');
    expect(Object.keys(mod).sort()).toEqual(
      [
        'onBroodLaunchParams', // S3-4 ㉓ — 해츨링 출격 판정 파라미터(임계 조기 반환보다 앞)
        'onBroodLaunched', // S3-4 ㉔ — 병아리 1기가 태어난 직후(기당 1회)
        'onBulletExpired',
        // ⚠️ S2 여섯은 **미배선 141종이 몰려 있던 지점 넷**을 연다. 넷인데 여섯인 것은 막 흡수와
        // 정산이 각각 "산술에 개입" 과 "사건을 관측" 으로 갈리기 때문이다 — 한 지점에 하나만
        // 두면 앵커 ⑮ 가 실제로 밟은 함정(관측 대상이 그 지점에 이미 없다)을 되풀이한다.
        'onCloakBreakReset', // S2 ㉑ — 팬텀 리셋 직전([치명] 이었던 지점)
        'onCushionSettleDue', // S3 ㉕ — 정산액 확정 **직전**(ME5 분할). ⑳ 은 클램프 뒤라 못 온다
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
        // ⚠️ ㉒ 는 ⑰⑱ 과 **게이트가 다르다** — 저 둘은 `aux0 > 0` 안이라 *막이 없는* 피격을
        // 원리적으로 못 본다. FI9「최후의 거품」의 술어가 정확히 그 바깥이라 지점을 따로 열었다.
        'onFilmEntry', // S3 ㉒ — 막 진입 술어 **직전**(막 없음까지 관측)
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

describe('앵커 ⑥ onBulletExpired — 관통 예산 소진 · 수명 만료', () => {
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

  it('음성 대조: 수명이 남은 채 명중 없이 날아가는 탄은 0 이다', () => {
    const s = skilled(0x9008);
    spawnBullet(s, STAGE_X, 0, Math.PI, 250 / DT, 100, 0, 5, 120, -1, 0);
    stepWorld(s, idle);
    expect(count('onBulletExpired')).toBe(0);
  });

  // -------------------------------------------------------------------------
  // S3-2 — 수명 만료 소멸에도 앵커가 선다 (CH3「종말점 방전」이 요구한 자리)
  // -------------------------------------------------------------------------

  it('수명이 다해 소멸하는 탄에서 불리고, 사유가 `life` 이며, 좌표가 마지막 위치다', () => {
    const s = skilled(0x9008);
    // 수명 2틱. 적을 세우지 않으므로 이 탄은 **오직 수명으로만** 죽는다.
    spawnBullet(s, STAGE_X, 0, Math.PI, 250 / DT, 100, 0, 5, 2, -1, 0);
    stepWorld(s, idle); // life 2 → 1 (아직 살아 있다)
    expect(count('onBulletExpired')).toBe(0); // 하한: 아직 안 죽었다
    stepWorld(s, idle); // life 1 → 0 → 소멸
    // ⚠️ **하한 먼저**. 배선이 끊기면 `expiries` 가 빈 배열이 되고, 그러면 아래 좌표 단언이
    // "없는 원소를 안 본다"로 조용히 성립한다(이 리포에서 실제로 난 항진).
    expect(count('onBulletExpired')).toBe(1);
    expect(hoisted.expiries).toHaveLength(1);
    const hit = hoisted.expiries[0]!;
    expect(hit.reason).toBe('life');
    // 좌표는 **소멸 틱까지 적분이 끝난 마지막 위치**여야 한다(스폰 지점이 아니다).
    // 틱당 250유닛 × 2틱 = 1480. 스폰 지점(1980)과 다르다는 것이 "종말점" 의 물증이다.
    expect(hit.x).toBeCloseTo(STAGE_X - 500, 6);
    expect(hit.y).toBeCloseTo(0, 6);
  });

  it('회귀: 관통 소진 소멸의 사유는 종전 그대로 `pierce` 다', () => {
    const s = skilled(0x9008);
    plantEnemy(s, STAGE_X - 60, 0);
    spawnBullet(s, STAGE_X, 0, Math.PI, 250 / DT, 100, 0, 5, 120, -1, 0);
    stepWorld(s, idle);
    expect(hoisted.expiries).toHaveLength(1); // 하한 — 실제로 소멸했다
    expect(hoisted.expiries[0]!.reason).toBe('pierce');
  });

  it('적탄이 수명으로 소멸해도 0 이다 (앵커 ⑥ 의 계약은 아군탄이다)', () => {
    const s = skilled(0x9008);
    const eb = blankEntity('enemyBullet');
    eb.x = STAGE_X;
    eb.y = 0;
    eb.vx = -250 / DT;
    eb.radius = 5;
    eb.life = 1;
    eb.enemyType = -1; // BK_NONE — 거동 없는 순수 직진탄
    addEntity(s, eb);
    stepWorld(s, idle);
    expect(count('onBulletExpired')).toBe(0);
  });
});

/**
 * **거동 불변의 물증** — 앵커 ⑥ 에 사유가 생기면서 기존에 붙어 있던 스킬(스트라이커 F4)이
 * **수명 만료에서도 터지면 두 배 발동**이 된다. 그것이 안 일어남을 스킬 쪽 효과로 잰다.
 *
 * 여기만 효과를 단언하는 이유: 이 파일의 헤더가 "효과는 배선 레인의 몫" 이라고 못 박았지만,
 * 이 단언은 **효과를 잠그는 것이 아니라 효과가 늘지 않았음**을 잠근다 — 성질이 반대다.
 */
describe('앵커 ⑥ 사유 게이트 — 기존 스킬이 두 배로 터지지 않는다', () => {
  const STAGE_X = 1980;

  /**
   * F4(flat 인덱스 3) 만 투자한 런. `DEFAULT_CONFIG` 런이 스트라이커 시그니처라는 것은
   * `tests/skillStriker.test.ts` 의 ⓪ 전제가 잠근다 — 여기서 다시 적지 않는다.
   */
  function striker(): WorldState {
    const v = new Array<number>(30).fill(0);
    v[3] = 5; // F4 파편 격발 (폭발 반경 60 + 6×5 = 90)
    return createWorld(0x9008, { ...DEFAULT_CONFIG, skillInvest: v });
  }

  /**
   * 탄이 죽는 자리는 **1틱 뒤 1730** 이다(1980 − 250). 오토어택 사거리(1650) 밖이라
   * 플레이어 자기 볼리가 끼어들지 않는다 — 2틱을 돌리면 1480 이 되어 사거리 안이고,
   * 그러면 방관자가 자기 볼리에 맞아 계측이 오염된다.
   */
  const DEATH_X = STAGE_X - 250;

  it('수명 만료로 죽는 탄은 F4 폭발을 일으키지 않는다 (관통 소진에서만 터진다)', () => {
    const s = striker();
    // 폭발 반경 90 **안**이면서 탄 경로(y=0)의 명중 반경(32+5=37) **밖**인 자리 — y 로 뗀다.
    // 경로 위에 두면 탄이 맞아 죽어(`'pierce'`) 재려던 사유가 바뀐다.
    const bystander = plantEnemy(s, DEATH_X, 60);
    const before = bystander.hp;
    spawnBullet(s, STAGE_X, 0, Math.PI, 250 / DT, 100, 0, 5, 1, -1, 0);
    stepWorld(s, idle);
    // 하한 — 탄이 **실제로 수명으로 소멸했다**. 이게 없으면 아래 `toBe(before)` 는
    // "탄이 아예 안 죽어서 아무 일도 없었다" 로도 성립한다(항진).
    expect(hoisted.expiries.filter((e) => e.reason === 'life').length).toBe(1);
    expect(bystander.hp).toBe(before);
  });

  it('대조: 같은 방관자가 관통 소진 소멸에서는 F4 폭발에 맞는다 (계측기가 살아 있다)', () => {
    const s = striker();
    const bystander = plantEnemy(s, DEATH_X, 60);
    const before = bystander.hp;
    // 표적을 경로 위에 세워 **관통 예산을 소진시켜** 같은 자리에서 죽게 한다.
    plantEnemy(s, DEATH_X, 0);
    spawnBullet(s, STAGE_X, 0, Math.PI, 250 / DT, 100, 0, 5, 120, -1, 0);
    stepWorld(s, idle);
    expect(hoisted.expiries.filter((e) => e.reason === 'pierce').length).toBe(1);
    expect(bystander.hp).toBeLessThan(before);
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
// 앵커 ⑯~㉑ (S2) — 7기체 배선이 뚫은 지점 넷 · ㉒ (S3) — 진입 술어가 막고 있던 축
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

// ---------------------------------------------------------------------------
// 앵커 ⑯ `aimAngle` (S3-1) — **자리만 만든 필드가 실제로 그 값인가**
// ---------------------------------------------------------------------------
//
// ⚠️ 이 절이 잡으려는 실패는 "필드가 있는데 값이 엉뚱하다" 와 "레코드 값과 실제 발사각이
// 갈린다" 둘이다. 앞의 것은 **여러 방위**로만 갈린다 — 한 방위만 재면 0 과의 우연 일치를
// 못 가른다. 뒤의 것은 **스폰된 탄의 속도 벡터**로만 갈린다.

/** 이번 런에서 살아 있는 아군 탄의 진행 방위(rad) 목록. */
function bulletHeadings(s: WorldState): number[] {
  const out: number[] = [];
  for (const e of s.entities) {
    if (e.kind !== 'bullet' || e.dead) continue;
    out.push(Math.atan2(e.vy, e.vx));
  }
  return out;
}

describe('앵커 ⑯ `VolleyParams.aimAngle` — 자동 조준이 고른 발사 방위', () => {
  // 표적을 **가까이**(150) 두는 이유: 웨이브 디렉터가 사거리 안에 적을 낳는 시드가 있어
  // (앵커 ⑯ 음성 대조 절의 근거) 멀리 두면 심어 둔 적이 최근접이 아닐 수 있다.
  const D = 150;
  const cases: { name: string; dx: number; dy: number; want: number }[] = [
    { name: '순수 +x', dx: D, dy: 0, want: 0 },
    { name: '순수 +y', dx: 0, dy: D, want: Math.PI / 2 },
    { name: '순수 -y', dx: 0, dy: -D, want: -Math.PI / 2 },
    { name: '대각 +x+y', dx: D, dy: D, want: Math.PI / 4 },
    { name: '대각 +x-y', dx: D, dy: -D, want: -Math.PI / 4 },
  ];

  for (const [i, c] of cases.entries()) {
    it(`양성: 표적이 ${c.name} 방향이면 aimAngle 이 그 방위다`, () => {
      const s = skilled(0xd100 + i);
      const p = s.entities[0];
      if (p === undefined) throw new Error('플레이어가 0번에 없다');
      plantEnemy(s, p.x + c.dx, p.y + c.dy);
      stepWorld(s, idle);
      // 하한 먼저 — 발사가 아예 없으면 아래 단언이 빈 배열 위에서 항진이 된다.
      expect(hoisted.volleys.length).toBeGreaterThan(0);
      const v = hoisted.volleys[0];
      if (v === undefined) throw new Error('볼리 기록이 없다');
      // 틱 안에서 플레이어가 조금 움직이므로 정확 일치가 아니라 방위 구분 수준으로 잰다.
      // 다섯 방위는 최소 π/4 만큼 떨어져 있어 0.2rad 여유로도 서로 섞이지 않는다.
      expect(Math.abs(v.aimAngle - c.want)).toBeLessThan(0.2);
    });
  }

  it('음성 대조: 방위가 다르면 aimAngle 도 다르다 (상수 0 을 배제한다)', () => {
    const seen: number[] = [];
    for (const [i, c] of cases.entries()) {
      hoisted.volleys = [];
      const s = skilled(0xd200 + i);
      const p = s.entities[0];
      if (p === undefined) throw new Error('플레이어가 0번에 없다');
      plantEnemy(s, p.x + c.dx, p.y + c.dy);
      stepWorld(s, idle);
      expect(hoisted.volleys.length).toBeGreaterThan(0);
      seen.push(hoisted.volleys[0]?.aimAngle ?? NaN);
    }
    // 다섯 값이 전부 서로 다르다 — 하나라도 상수로 굳어 있으면 여기서 깨진다.
    expect(new Set(seen).size).toBe(cases.length);
  });

  it('짝 증명: aimAngle 이 **실제로 발사된 탄의 진행 방위**와 같다', () => {
    // 이것이 "레코드 값과 실제 발사각이 갈리지 않는다" 는 유일한 물증이다. 기본 무기는
    // 부채꼴 1발(`bulletCount` 기본값 1)이라 부채꼴 중심 = 그 한 발의 방위다.
    for (const [i, c] of cases.entries()) {
      hoisted.volleys = [];
      const s = skilled(0xd300 + i);
      const p = s.entities[0];
      if (p === undefined) throw new Error('플레이어가 0번에 없다');
      plantEnemy(s, p.x + c.dx, p.y + c.dy);
      stepWorld(s, idle);
      expect(hoisted.volleys.length).toBeGreaterThan(0);
      const v = hoisted.volleys[0];
      if (v === undefined) throw new Error('볼리 기록이 없다');
      const headings = bulletHeadings(s);
      // 하한 — 탄이 안 났으면 아래 비교가 통째로 항진이다.
      expect(headings.length).toBeGreaterThan(0);
      // 부채꼴은 `aimAngle` 을 중심으로 대칭이라 (min+max)/2 가 중심축이다. 1발이면 그 값
      // 자체다. ⚠️ ±π 를 넘는 방위는 넣지 않았으므로 감싸기(wrap) 걱정이 없다.
      const mid = (Math.min(...headings) + Math.max(...headings)) / 2;
      // ⚠️ 정밀도 9 는 여유가 아니라 **탄이 방위를 `cos`/`sin` 으로 풀었다가 `atan2` 로 되
      // 감는 왕복 오차** 때문이다(같은 값이어도 마지막 몇 비트가 흔들린다). 배선이 갈리는
      // 실패는 rad 단위 차이라 9 자리로도 남김없이 잡힌다.
      expect(mid).toBeCloseTo(v.aimAngle, 9);
    }
  });

  it('읽기 전용: 훅이 지나간 뒤에도 aimAngle 이 그대로다(스냅숏 == 발사 방위)', () => {
    // 앞 케이스가 이미 이것을 함의한다 — 기록은 **훅 실행 전** 스냅숏이고 탄은 **훅 실행
    // 후** 값으로 난다. 그래도 의도를 이름으로 못 박아 둔다: 이 필드가 쓰기 가능해지면
    // 여기가 먼저 빨개진다.
    const s = skilled(0xd400);
    const p = s.entities[0];
    if (p === undefined) throw new Error('플레이어가 0번에 없다');
    plantEnemy(s, p.x + D, p.y + D);
    stepWorld(s, idle);
    expect(hoisted.volleys.length).toBeGreaterThan(0);
    const before = hoisted.volleys[0]?.aimAngle ?? NaN;
    const headings = bulletHeadings(s);
    expect(headings.length).toBeGreaterThan(0);
    const mid = (Math.min(...headings) + Math.max(...headings)) / 2;
    expect(mid).toBeCloseTo(before, 9);
  });
});

// ---------------------------------------------------------------------------
// 앵커 ⑯ `inputX`/`inputY` (W2) — **입력 배관이 발사부까지 닿았는가**
// ---------------------------------------------------------------------------
//
// `autoAttack(state, player)` 은 `InputFrame` 을 인자로 받지 않았고 `WorldState` 에 그 틱
// 입력을 보관하는 칸도 없었다. 그래서 *"그 틱 입력 벡터"* 를 술어로 쓰는 스킬(말로우 SQ7)이
// `aimAngle` 이 선 뒤에도 열리지 않았다 — 내적의 한 항이 통째로 부재했다.
//
// ⚠️ 이 절이 잡으려는 실패는 "칸은 있는데 항상 0" 과 "이동에 소비된 뒤 초기화된 값이 온다"
// 둘이다. 앞의 것은 **여러 입력**으로만, 뒤의 것은 **이동이 실제로 일어난 틱**으로만 갈린다.
describe('앵커 ⑯ `VolleyParams.inputX/inputY` — 그 틱 이동 입력', () => {
  const MOVES: { name: string; mx: number; my: number }[] = [
    { name: '정지', mx: 0, my: 0 },
    { name: '+x', mx: 1, my: 0 },
    { name: '-y', mx: 0, my: -1 },
    { name: '대각', mx: 0.6, my: 0.8 },
  ];

  for (const [i, m] of MOVES.entries()) {
    it(`양성: 입력 ${m.name} 이 레코드에 그대로 온다`, () => {
      const s = skilled(0xe100 + i);
      const p = s.entities[0];
      if (p === undefined) throw new Error('플레이어가 0번에 없다');
      plantEnemy(s, p.x + 150, p.y);
      stepWorld(s, { ...emptyInput(), moveX: m.mx, moveY: m.my });
      // 하한 먼저 — 발사가 아예 없으면 아래 단언이 빈 기록 위에서 항진이 된다.
      expect(hoisted.volleys.length).toBeGreaterThan(0);
      const v = hoisted.volleys[0];
      if (v === undefined) throw new Error('볼리 기록이 없다');
      // ⚠️ 정확 일치다 — 정규화·클램프 없이 원본을 싣는 것이 이 칸의 계약이다.
      expect(v.inputX).toBe(m.mx);
      expect(v.inputY).toBe(m.my);
    });
  }

  it('음성 대조: 입력이 다르면 레코드도 다르다 (상수 0 을 배제한다)', () => {
    const seen: string[] = [];
    for (const [i, m] of MOVES.entries()) {
      hoisted.volleys = [];
      const s = skilled(0xe200 + i);
      const p = s.entities[0];
      if (p === undefined) throw new Error('플레이어가 0번에 없다');
      plantEnemy(s, p.x + 150, p.y);
      stepWorld(s, { ...emptyInput(), moveX: m.mx, moveY: m.my });
      expect(hoisted.volleys.length).toBeGreaterThan(0);
      seen.push(`${hoisted.volleys[0]?.inputX},${hoisted.volleys[0]?.inputY}`);
    }
    expect(new Set(seen).size).toBe(MOVES.length);
  });

  it('⚠️ 관측 대상이 살아 있다: 이동이 실제로 일어난 틱에도 값이 초기화되지 않는다', () => {
    // `stepPlayer` 는 입력을 **지역 복사본**으로만 쓴다(`src/sim/**` 전수: `input.<필드> =`
    // 대입 0건). 그래도 "이동에 소비된 뒤 0 이 온다" 는 이 배관의 대표 실패라 물증을 남긴다:
    // 같은 틱에 플레이어가 정말 움직였는데 레코드는 원래 입력 그대로여야 한다.
    const s = skilled(0xe300);
    const p = s.entities[0];
    if (p === undefined) throw new Error('플레이어가 0번에 없다');
    plantEnemy(s, p.x + 150, p.y);
    const x0 = p.x;
    stepWorld(s, { ...emptyInput(), moveX: 1, moveY: 0 });
    expect(p.x).toBeGreaterThan(x0); // 이동이 실제로 일어났다(하한)
    expect(hoisted.volleys.length).toBeGreaterThan(0);
    expect(hoisted.volleys[0]?.inputX).toBe(1);
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

describe('앵커 ㉒ onFilmEntry — 막 진입 술어 직전(막이 **없는** 피격까지 관측)', () => {
  it('양성: 막이 없는(aux0=0) 치명 피격에서 불린다 — 같은 순간 ⑰⑱ 은 0 이다', () => {
    const s = skilled(0xc101, 6); // 버블(id=6, SIG_BUBBLE_FILM)
    const p = s.entities[0];
    if (p === undefined) throw new Error('플레이어가 0번에 없다');
    p.aux0 = 0; // 막 없음
    p.hp = 1; // 어떤 피격도 치명이 되는 상태
    plantEnemy(s, 0, 0, 10); // 플레이어에 겹친 적 — 접촉 피해
    stepWorld(s, idle);

    expect(count('onFilmEntry')).toBe(1);
    // ⚠️ 이 두 줄이 이 절의 존재 이유다 — **종전에는 이 순간을 볼 수 있는 앵커가 0 개**였고,
    // 그것이 FI9「최후의 거품」이 배선되지 못한 사유였다(⑰ 주석).
    expect(count('onFilmShield')).toBe(0);
    expect(count('onFilmAbsorbed')).toBe(0);

    const e = hoisted.filmEntries[0];
    if (e === undefined) throw new Error('㉒ 인자 기록이 비어 있다');
    expect(e.aux0).toBe(0); // 막이 정말 없는 상태에서 도달했다
    // ⚠️ **하한 짝** — 배선이 끊기면 `dmg` 가 0 이 되어 아래 치명 술어가 "0 - 0 <= 0" 으로
    //    항진한다(버블 FI4 가 실제로 그렇게 통과했다). 피해가 실려 왔음을 먼저 잠근다.
    expect(e.dmg).toBeGreaterThan(0);
    // ⚠️ **질문 ①** — 이 지점의 hp 는 아직 한 점도 안 깎였다. 깎인 뒤였다면 FI9 는 잴 것을
    //    못 잰다(앵커 ⑮ 가 밀어내기 뒤에 놓여 대상을 못 찾은 것과 같은 형태).
    expect(e.hp).toBe(1);
    expect(e.hp - e.dmg).toBeLessThanOrEqual(0); // FI9 의 술어가 여기서 참이 된다
  });

  it('음성 대조: 막 시그니처가 없는 기체에서는 0 이다', () => {
    const s = skilled(0xc102); // 기본 기체(스트라이커)
    const hpBefore = s.entities[0]?.hp ?? 0;
    plantEnemy(s, 0, 0, 10);
    stepWorld(s, idle);
    // "애초에 안 맞았다" 는 거짓 음성을 배제한다.
    expect(s.entities[0]?.hp).toBeLessThan(hpBefore);
    expect(count('onFilmEntry')).toBe(0);
  });

  it('회귀: 막이 선 피격의 ⑰⑱ 호출·인자·결과가 종전 그대로다 (㉒ 가 앞에 한 번 더 불릴 뿐)', () => {
    // ⚠️ 위 ⑰⑱ 절과 **같은 시드·같은 배치**(0xc001)다 — 게이트를 넓히지 않았으므로 그 절의
    //    단언이 한 줄도 안 바뀌었다는 것과 짝을 이룬다.
    const s = skilled(0xc001, 6);
    const p = s.entities[0];
    if (p === undefined) throw new Error('플레이어가 0번에 없다');
    p.aux0 = FILM_ABSORB_FLAT;
    const hpBefore = p.hp;
    plantEnemy(s, 0, 0, 10);
    stepWorld(s, idle);

    expect(count('onFilmEntry')).toBe(1);
    expect(count('onFilmShield')).toBe(1);
    expect(count('onFilmAbsorbed')).toBe(1);

    const e = hoisted.filmEntries[0];
    if (e === undefined) throw new Error('㉒ 인자 기록이 비어 있다');
    expect(e.aux0).toBe(FILM_ABSORB_FLAT); // 막이 서 있는 채로 진입했다
    // **하한 짝** — 아래 두 단언은 `dmg = 0` 이면 항진이다.
    expect(e.dmg).toBeGreaterThan(0);
    expect(e.dmg).toBeLessThan(FILM_ABSORB_FLAT); // 소진 전이라 파열이 없다

    // 결과가 비트 동일하다: 막이 전량 흡수해 선체는 한 점도 안 깎이고 `aux0` 만 그만큼 닳는다.
    // ㉒ 가 본 `dmg` 와 실제 차감량이 같다는 것이 "훅이 아무것도 안 바꿨다" 의 물증이다.
    expect(p.hp).toBe(hpBefore);
    expect(p.aux0).toBe(FILM_ABSORB_FLAT - e.dmg);
    expect(s.filmPops).toBe(0); // 파열 오발동 없음 — 게이트를 넓혔다면 여기가 갈렸다
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

// ---------------------------------------------------------------------------
// 앵커 ㉕ (S3) — 값을 **돌려주는** 앵커라 계측 방식이 다르다
// ---------------------------------------------------------------------------
//
// ⚠️ 이 절만 "효과가 있다" 에 해당하는 단언을 한다. 파일 헤더의 금지("효과는 배선 레인의 몫")
// 와 어긋나 보이지만 재는 것이 다르다 — **스킬 효과**가 아니라 **앵커가 원리적으로 유효한가**,
// 즉 훅의 반환이 뒤 산술의 `min`/클램프에 삼켜지지 않고 최종 상태에 도달하는가다. 이 물증이
// 없으면 "자리는 열었는데 넣어도 아무 일도 안 일어나는" 앵커가 된다(앵커 ⑰ 의 전례).

/** 말로우 완충 정산이 **이번 틱에** 일어나도록 세운다. 반환은 정산 예정액(`due`). */
function armSettlement(state: WorldState, debt = 100): { p: Entity; due: number } {
  const p = state.entities[0];
  if (p === undefined) throw new Error('플레이어가 0번에 없다');
  p.aux0 = debt;
  p.aux1 = CUSHION_RECOVER_TICKS - 1; // 이번 틱에 임계를 채운다
  return { p, due: cushionSettled(debt, CUSHION_RECOVER_TICKS) };
}

describe('앵커 ㉕ onCushionSettleDue — 정산액 확정 직전(hp 차감 전)', () => {
  it('정산 틱에 불리고, ⑳ 보다 **앞**이다 (정본 순서: 분할 → CU3 상한 → applied → 파생)', () => {
    const s = skilled(0xe101, 5);
    armSettlement(s);
    stepWorld(s, idle);
    // 전제 — 정산이 실제로 일어난 틱이다(이게 없으면 아래 순서 단언이 항진이 된다).
    expect(count('onCushionSettleDue')).toBe(1);
    expect(count('onCushionSettled')).toBe(1);
    // CU3 회당 상한은 ⑳ 안(`mallowCushionSettled`)에 있으므로 "㉕ < ⑳" 이 곧 "㉕ < CU3" 이다.
    expect(hoisted.order.indexOf('onCushionSettleDue')).toBeLessThan(
      hoisted.order.indexOf('onCushionSettled'),
    );
  });

  it('회귀: 훅이 아무것도 안 하면 정산 결과가 종전과 비트 동일이다', () => {
    const s = skilled(0xe102, 5);
    const { p, due } = armSettlement(s);
    const hpBefore = p.hp;
    stepWorld(s, idle);
    expect(due, '정산액이 0 이면 아래 단언이 전부 항진이다').toBeGreaterThan(0);
    expect(hpBefore - p.hp).toBe(due); // 앵커 삽입 전 산술 = `min(due, floor(hp)-1)`
    expect(p.aux0).toBe(0); // 완충 잔량도 종전 그대로
  });

  it('⭐ 뮤테이션 ①: 반환을 **키우면** 최종 hp 가 실제로 더 깎인다 (뒤 클램프가 안 삼킨다)', () => {
    const s = skilled(0xe103, 5);
    const { p, due } = armSettlement(s);
    const hpBefore = p.hp;
    // 전제 — hp 여유(room)가 충분해야 `min` 이 개입을 삼키지 않는다. 여유가 없는 치사급
    // 정산에서는 삼켜지는 것이 **의도**다(완충은 절대 치명적이지 않다).
    expect(Math.floor(hpBefore) - 1).toBeGreaterThan(due + 20);
    hoisted.mutate['onCushionSettleDue'] = (ret) => (ret as number) + 20;
    stepWorld(s, idle);
    expect(count('onCushionSettleDue')).toBe(1);
    expect(hpBefore - p.hp).toBe(due + 20);
  });

  it('⭐ 뮤테이션 ②: 절반만 선체로 보내고 나머지를 다시 미루면 hp 와 **완충 잔량**이 함께 달라진다', () => {
    // ME5「분할 상환」이 실제로 취할 형태다 — 반환을 줄이고 남은 몫을 `aux0` 에 **대입**한다
    // (앵커가 `aux0` 리셋 **뒤**에 있어야 이 쓰기가 살아남는다. 그 자리 선택의 물증이 이 절이다).
    const s = skilled(0xe104, 5);
    const { p, due } = armSettlement(s);
    const hpBefore = p.hp;
    const half = Math.floor(due / 2);
    expect(half, '분할 몫이 0 이면 아래가 회귀 절과 구분되지 않는다').toBeGreaterThan(0);
    hoisted.mutate['onCushionSettleDue'] = (ret, args) => {
      const player = args[1] as Entity;
      player.aux0 = (ret as number) - half; // 안 보낸 나머지를 다시 미룬다
      return half;
    };
    stepWorld(s, idle);
    expect(count('onCushionSettleDue')).toBe(1);
    expect(hpBefore - p.hp).toBe(half); // 선체행이 실제로 줄었다
    expect(p.aux0).toBe(due - half); // 완충 잔량이 실제로 남았다
    expect(p.aux0).toBeGreaterThan(0);
  });

  it('음성 대조: 정산이 없는 틱(임계 미도달)에는 0 이다', () => {
    const s = skilled(0xe105, 5);
    const p = s.entities[0];
    if (p === undefined) throw new Error('플레이어가 0번에 없다');
    p.aux0 = 100;
    p.aux1 = 0;
    stepWorld(s, idle);
    expect(count('onCushionThreshold')).toBe(1); // 매 틱 훅은 돈다
    expect(count('onCushionSettleDue')).toBe(0);
  });

  it('음성 대조: 다른 기체에서는 0 이다', () => {
    const s = skilled(0xe106);
    stepWorld(s, idle);
    expect(count('onCushionSettleDue')).toBe(0);
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

// ---------------------------------------------------------------------------
// 앵커 ㉓·㉔ — 해츨링 출격 지점(S3-4)
// ---------------------------------------------------------------------------
//
// ## 이 절이 세는 것 — **호출 횟수만으로는 모자란다**
// 이 지점의 스킬 여덟은 전부 *"임계·상한·기수를 고친다"* 라서, 앵커가 불리기만 하고 world 가
// 그 값을 안 읽으면 전부 조용히 0 건이 된다. 앵커 ⑰ 이 `min(d, s)` 때문에 원리적으로 무효가
// 되어 살린 스킬이 0종이었던 전례가 정확히 그 사각지대다. 그래서 여기서는 `hoisted.broodPatch`
// 로 **레코드를 실제로 고쳐 보고 결과가 달라지는지**를 잰다(뮤테이션 없이 계측기를 믿지 않는다).
//
// ## ⚠️ 비례·단조 단언에 하한을 짝으로 붙인다
// "패치하면 더 많이 뜬다" 만 재면 배선이 끊겨 **양변이 모두 0** 인 항진이 통과한다(이 저장소에
// 실제로 있었다). 그래서 모든 증가 단언 앞에 **"최소 1기는 떴다"** 를 먼저 잠근다.

/** 해츨링(shipType 4) 스킬 런. */
function hatchRun(seed: number): WorldState {
  return skilled(seed, 4);
}

/**
 * 살아 있는 병아리 수. 술어는 `stepHatchBrood` 의 3중 술어와 **글자 그대로 같다** —
 * 한 칸이라도 다르게 적으면 이 계측이 프로덕션과 다른 것을 센다.
 */
function chickCount(state: WorldState): number {
  let n = 0;
  for (const e of state.entities) {
    if (!e.dead && e.ownerId === BROOD_MARK && isActiveTurret(e)) n++;
  }
  return n;
}

/** 병아리 1기를 손으로 세운다(kind·ownerId·phase 셋이 정체의 계약이다). */
function plantChick(state: WorldState, dx: number): Entity {
  const p = state.entities[0]!;
  const c = blankEntity('turretPickup');
  c.x = p.x + dx;
  c.y = p.y;
  c.radius = 44;
  c.ownerId = BROOD_MARK;
  c.phase = 1;
  c.life = TURRET_LIFE_TICKS;
  return addEntity(state, c);
}

describe('앵커 ㉓ onBroodLaunchParams — 해츨링 출격 판정(매 틱 · 조기 반환보다 앞)', () => {
  it('임계 미달 틱에도 불린다 — 조기 반환 뒤에 있으면 BD1(임계 감산)이 영영 0 건이다', () => {
    const s = hatchRun(0xb001);
    expect(s.kills).toBe(0); // 임계(최소 12)에 한참 못 미친다
    stepWorld(s, idle);
    expect(count('onBroodLaunchParams')).toBe(1);
    stepWorld(s, idle);
    expect(count('onBroodLaunchParams')).toBe(2);
    // 음성 대조 — 출격 자체는 없었다(㉔ 은 0). "매 틱 불린다" 가 "매 틱 출격한다" 가 아니다.
    expect(count('onBroodLaunched')).toBe(0);
    expect(chickCount(s)).toBe(0);
  });

  it('상한 포화(만석 보류) 틱에도 불린다 — BD10·SH10·NU10 이 사는 자리다', () => {
    const s = hatchRun(0xb002);
    for (let i = 0; i < 4; i++) plantChick(s, 60 + 20 * i);
    expect(chickCount(s)).toBe(4);
    s.kills = 1000; // 임계는 통과 · 상한에서 막힌다
    s.entities[0]!.aux0 = 0;
    stepWorld(s, idle);
    expect(count('onBroodLaunchParams')).toBe(1);
    expect(count('onBroodLaunched')).toBe(0); // 보류 — 태어난 기체가 없다
    expect(s.entities[0]!.aux0).toBe(0); // 보류는 스냅샷을 갱신하지 않는다(적립 유지)
  });

  it('해츨링이 아닌 런에서는 0 이다 (매 틱 무조건 불리는 훅이 아니다)', () => {
    const s = skilled(0xb003);
    for (let i = 0; i < 5; i++) stepWorld(s, idle);
    expect(count('onBroodLaunchParams')).toBe(0);
    expect(count('onBroodLaunched')).toBe(0);
  });

  it('`threshold` 를 낮추면 실제로 더 일찍 출격한다 (world 가 그 칸을 읽는다)', () => {
    // 대조군 — 패치 없이는 임계에 못 미쳐 한 기도 안 뜬다.
    const base = hatchRun(0xb004);
    stepWorld(base, idle);
    expect(chickCount(base)).toBe(0);
    expect(count('onBroodLaunched')).toBe(0);
    // 긍정 짝 — 임계만 낮추면 같은 상태에서 뜬다.
    const s = hatchRun(0xb004);
    hoisted.broodPatch = (p): void => {
      p.threshold = 0;
    };
    stepWorld(s, idle);
    expect(chickCount(s)).toBeGreaterThanOrEqual(1); // ⚠️ 하한 먼저(양변 0 항진 차단)
    expect(count('onBroodLaunched')).toBe(chickCount(s));
  });

  it('`maxDrones` 를 올리면 실제로 더 많이 뜬다 — `min`/`clamp` 에 삼켜지지 않는다', () => {
    const base = hatchRun(0xb005);
    hoisted.broodPatch = (p): void => {
      p.threshold = 0;
    };
    for (let i = 0; i < 8; i++) stepWorld(base, idle);
    expect(chickCount(base)).toBeGreaterThanOrEqual(1); // 하한
    expect(chickCount(base)).toBe(4); // 기본 상한에서 멈춘다

    const s = hatchRun(0xb005);
    hoisted.broodPatch = (p): void => {
      p.threshold = 0;
      p.maxDrones = 6;
    };
    for (let i = 0; i < 8; i++) stepWorld(s, idle);
    expect(chickCount(s)).toBeGreaterThanOrEqual(1); // 하한
    expect(chickCount(s)).toBeGreaterThan(chickCount(base));
    expect(chickCount(s)).toBe(6);
  });

  it('`launchCount` 를 올리면 같은 틱에 여러 기가 뜬다 (BD2 쌍둥이의 자리)', () => {
    const s = hatchRun(0xb006);
    hoisted.broodPatch = (p): void => {
      p.threshold = 0;
      p.launchCount = 3;
    };
    stepWorld(s, idle);
    expect(chickCount(s)).toBeGreaterThanOrEqual(1); // 하한
    expect(chickCount(s)).toBe(3);
    expect(count('onBroodLaunched')).toBe(3); // ㉔ 은 **기당** 1회다
  });

  it('빈 자리가 모자라면 `maxDrones` 가 이긴다 — 설계 BD2 의 "상한·보류 규율 유지"', () => {
    const s = hatchRun(0xb007);
    for (let i = 0; i < 3; i++) plantChick(s, 60 + 20 * i);
    hoisted.broodPatch = (p): void => {
      p.threshold = 0;
      p.launchCount = 3; // 3기 요청 · 자리는 1칸
    };
    stepWorld(s, idle);
    expect(count('onBroodLaunched')).toBe(1);
    expect(chickCount(s)).toBe(4);
  });
});

describe('앵커 ㉔ onBroodLaunched — 병아리가 태어난 직후', () => {
  it('활성 상태의 개체와 출격 좌표를 넘긴다 (BD6·NU2·NU7 이 읽을 것)', () => {
    const s = hatchRun(0xb008);
    const p = s.entities[0]!;
    const px = p.x;
    const py = p.y;
    hoisted.broodPatch = (q): void => {
      q.threshold = 0;
    };
    stepWorld(s, idle);
    expect(hoisted.launched.length).toBeGreaterThanOrEqual(1); // 하한
    const first = hoisted.launched[0]!;
    // `phase === 1` — `activateTurret` **뒤**에 불린다. 여기가 앞이면 NU7 이 옮길 개체가
    // 아직 포탑이 아니고, BD6 이 재는 좌표도 확정 전이다.
    expect(first.active).toBe(true);
    // 좌표는 모선 곁 고정 4방향(변위 크기는 world 소유 상수)이라 근방이어야 한다.
    expect(Math.abs(first.x - px) + Math.abs(first.y - py)).toBeGreaterThan(0);
    expect(Math.abs(first.x - px)).toBeLessThan(400);
    expect(Math.abs(first.y - py)).toBeLessThan(400);
  });
});

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
