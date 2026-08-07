/**
 * 촉매 **팬아웃 · 연출/귀속 채널 · 사운드**의 계약 (ADR-0052).
 *
 * ## 이 파일이 재는 것 넷
 *  1. **팬아웃** — 앵커 하나가 13개 그룹 모듈을 **전부** 부른다. 억제형은 **단락 없이** 전부
 *     부른다(`a() || b()` 로 쓰면 뒤 그룹의 부수효과가 사라진다).
 *  2. **합성 규칙** — 배율형은 그룹 순서대로 **곱**해서 접힌다.
 *  3. **fx 채널** — 무촉매 런은 채널 자체가 없다 · 매 틱 비워진다 · **`hashWorld` 에 안 접힌다**.
 *  4. **사운드** — 촉매 키가 실재 샘플에 매핑돼 절차 합성 폴백이 안 걸린다.
 *
 * ## ⚠️ 왜 13개 모듈을 전부 `vi.mock` 하는가
 * "전부 불린다"는 **세어야만** 증명된다. 디스패처 소스를 정규식으로 훑는 방식은 호출을 지운
 * 리팩터에는 걸리지만 **인자를 잘못 넘긴 배선**에는 안 걸리고, 무엇보다 주석에 적힌 호출을
 * 코드로 오독한다. `skillAnchors.test.ts`·`catalystAnchors.test.ts` 의 규율을 그대로 따라
 * **원본을 그대로 태워** 감싸기가 거동을 바꾸지 않게 한다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/** 그룹 모듈 함수의 호출 계측 + 반환값 강제. `vi.mock` 팩토리보다 먼저 도록 hoist 한다. */
const hoisted = vi.hoisted(() => ({
  calls: {} as Record<string, number>,
  /** 세우면 억제형 세 앵커가 전 그룹에서 `true` 를 돌려준다(단락 판별용). */
  forceSuppress: false,
  /** `그룹명 → 배율`. 배율형 앵커에서 그 그룹만 이 값을 돌려준다(곱 합성 판별용). */
  multBy: {} as Record<string, number>,
}));

const SUPPRESS_ANCHORS = ['OnBossDeath', 'OnLootCollected', 'OnDestructibleDestroyed'];
const MULT_ANCHORS = ['OnDamageChain', 'OnEnemyStep'];

/**
 * 그룹 모듈 하나를 감싼다. **원본을 그대로 태우고** 호출만 센다 — 다만 억제/배율 판별에
 * 필요한 두 축은 반환값을 갈아 끼운다(그 조작 없이는 단락도 곱 합성도 관측 불가다).
 */
function wrap(group: string, actual: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(actual)) {
    if (typeof value !== 'function') {
      out[name] = value;
      continue;
    }
    const fn = value as (...args: unknown[]) => unknown;
    out[name] = (...args: unknown[]): unknown => {
      hoisted.calls[name] = (hoisted.calls[name] ?? 0) + 1;
      if (hoisted.forceSuppress && SUPPRESS_ANCHORS.some((a) => name.endsWith(a))) return true;
      const m = hoisted.multBy[group];
      if (m !== undefined && MULT_ANCHORS.some((a) => name.endsWith(a))) return m;
      if (m !== undefined && name.endsWith('OnLootRoll')) return { rarity: m, count: m };
      return fn(...args);
    };
  }
  return out;
}

// ⚠️ 경로를 **리터럴**로 적는다 — vite 는 변수 동적 import 를 못 해석한다
//    (`catalystFoundation.test.ts` 의 그룹 목록이 같은 함정을 이미 실측했다).
vi.mock('../src/sim/catalyst/drops.js', async (o) => wrap('drops', await o()));
vi.mock('../src/sim/catalyst/refine.js', async (o) => wrap('refine', await o()));
vi.mock('../src/sim/catalyst/growth.js', async (o) => wrap('growth', await o()));
vi.mock('../src/sim/catalyst/resource.js', async (o) => wrap('resource', await o()));
vi.mock('../src/sim/catalyst/chain.js', async (o) => wrap('chain', await o()));
vi.mock('../src/sim/catalyst/power.js', async (o) => wrap('power', await o()));
vi.mock('../src/sim/catalyst/kargon.js', async (o) => wrap('kargon', await o()));
vi.mock('../src/sim/catalyst/berdan.js', async (o) => wrap('berdan', await o()));
vi.mock('../src/sim/catalyst/niflheim.js', async (o) => wrap('niflheim', await o()));
vi.mock('../src/sim/catalyst/arke.js', async (o) => wrap('arke', await o()));
vi.mock('../src/sim/catalyst/toxar.js', async (o) => wrap('toxar', await o()));
vi.mock('../src/sim/catalyst/kras.js', async (o) => wrap('kras', await o()));
vi.mock('../src/sim/catalyst/resonance.js', async (o) => wrap('resonance', await o()));

import { createWorld, DEFAULT_CONFIG, stepWorld } from '../src/sim/world.js';
import type { WorldState, InputFrame } from '../src/sim/world.js';
import type { Entity } from '../src/sim/entities.js';
import { hashWorld } from '../src/sim/replay.js';
import * as hooks from '../src/sim/catalystHooks.js';
import {
  CATALYST_FX,
  CATALYST_FX_MAX,
  notifyCatalystFx,
  catalystFxOf,
  creditCatalyst,
  missCatalyst,
  catalystContributionsOf,
} from '../src/sim/catalyst/fx.js';
import { snapshotWorld } from '../src/sim/snapshot.js';
import { sampleKeyFor } from '../src/render/audio.js';
import {
  catalystFxSound,
  catalystFxFlashesSlot,
  FX_TRIGGER,
  FX_SELF_HARM,
  FX_CREDIT,
  FX_MISS,
} from '../src/render/catalystFx.js';

/** 팬아웃 대상 그룹 — **순서가 계약**이다(`onTickCatalyst` 와 같은 순서). */
const GROUPS = [
  'drops', 'refine', 'growth', 'resource', 'chain', 'power',
  'kargon', 'berdan', 'niflheim', 'arke', 'toxar', 'kras', 'resonance',
] as const;

const IDLE: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };

function catWorld(seed = 0xca7f): WorldState {
  return createWorld(seed, { ...DEFAULT_CONFIG, catalysts: [1] });
}
function plainWorld(seed = 0xca7f): WorldState {
  return createWorld(seed, { ...DEFAULT_CONFIG });
}
function player(w: WorldState): Entity {
  const p = w.entities[0];
  if (p === undefined) throw new Error('플레이어 엔티티가 0번에 없다');
  return p;
}

beforeEach(() => {
  hoisted.calls = {};
  hoisted.forceSuppress = false;
  hoisted.multBy = {};
});

// ---------------------------------------------------------------------------
// ① 팬아웃 — 앵커마다 13그룹이 **전부** 불린다
// ---------------------------------------------------------------------------

describe('앵커 팬아웃 — 카드 레인이 `catalystHooks.ts` 를 안 고쳐도 되는 근거', () => {
  /** `[앵커 접미사, 디스패처를 한 번 부르는 함수]`. 24개 전부다. */
  const DRIVE: readonly [string, (w: WorldState) => void][] = [
    ['OnVolleyFired', (w) => hooks.onVolleyFiredCatalyst(w, player(w))],
    ['OnDashFired', (w) => hooks.onDashFiredCatalyst(w, player(w))],
    ['OnGemCollected', (w) => hooks.onGemCollectedCatalyst(w, player(w))],
    ['OnPlayerDamaged', (w) => hooks.onPlayerDamagedCatalyst(w, player(w), 5, false, 0)],
    ['OnKillsDelta', (w) => hooks.onKillsDeltaCatalyst(w, 1)],
    ['OnBulletExpired', (w) => hooks.onBulletExpiredCatalyst(w, player(w), 'life')],
    ['OnWallContact', (w) => hooks.onWallContactCatalyst(w, player(w))],
    ['OnDamageChain', (w) => void hooks.onDamageChainCatalyst(w, player(w), 5)],
    ['OnTick', (w) => hooks.onTickCatalyst(w, player(w))],
    ['OnEnemyDamaged', (w) => hooks.onEnemyDamagedCatalyst(w, player(w), 3, undefined)],
    ['OnEnemyDeath', (w) => hooks.onEnemyDeathCatalyst(w, 1, 2, false)],
    ['OnLevelUp', (w) => hooks.onLevelUpCatalyst(w, 2)],
    ['OnPowerupOffer', (w) => {
      w.powerupChoices = [0, 1, 2];
      hooks.onPowerupOfferCatalyst(w, w.powerupChoices);
    }],
    ['OnPowerupPicked', (w) => hooks.onPowerupPickedCatalyst(w, 0, 0)],
    ['OnDashPierce', (w) => hooks.onDashPierceCatalyst(w, player(w), player(w))],
    ['OnResourceGranted', (w) => hooks.onResourceGrantedCatalyst(w, 4, 1, 2)],
    ['OnBossDeath', (w) => void hooks.onBossDeathCatalyst(w, 1, 2)],
    ['OnLootRoll', (w) => void hooks.onLootRollCatalyst(w, 1, 1, 0, 0, true)],
    ['OnLootCollected', (w) => void hooks.onLootCollectedCatalyst(w, player(w))],
    ['OnWaveAdvanced', (w) => hooks.onWaveAdvancedCatalyst(w, 0, 1)],
    ['OnEnemyContact', (w) => hooks.onEnemyContactCatalyst(w, player(w), player(w))],
    ['OnEnemyStep', (w) => void hooks.onEnemyStepCatalyst(w, player(w), 1)],
    ['OnDestructibleDestroyed', (w) => void hooks.onDestructibleDestroyedCatalyst(w, player(w))],
    ['OnCatalystHazards', (w) => hooks.stepCatalystHazards(w)],
  ];

  it('앵커 24개 × 그룹 13개가 **빠짐없이** 불린다', () => {
    for (const [anchor, drive] of DRIVE) {
      hoisted.calls = {};
      drive(catWorld());
      const missing = GROUPS.filter((g) => (hoisted.calls[`${g}${anchor}`] ?? 0) === 0);
      expect(missing, `${anchor}: 안 불린 그룹`).toEqual([]);
    }
  });

  it('무촉매 런은 팬아웃이 **0회**다 (게이트가 첫 줄이라 바이트 불변)', () => {
    for (const [anchor, drive] of DRIVE) {
      hoisted.calls = {};
      drive(plainWorld());
      const fired = GROUPS.filter((g) => (hoisted.calls[`${g}${anchor}`] ?? 0) > 0);
      expect(fired, `${anchor}: 무촉매인데 불린 그룹`).toEqual([]);
    }
  });

  it('⭐ 억제형은 **단락 없이** 13개를 전부 부른다 (`||` 로 쓰면 부수효과가 사라진다)', () => {
    hoisted.forceSuppress = true;
    for (const [anchor, call] of [
      ['OnBossDeath', (w: WorldState) => hooks.onBossDeathCatalyst(w, 0, 0)],
      ['OnLootCollected', (w: WorldState) => hooks.onLootCollectedCatalyst(w, player(w))],
      ['OnDestructibleDestroyed', (w: WorldState) => hooks.onDestructibleDestroyedCatalyst(w, player(w))],
    ] as const) {
      hoisted.calls = {};
      const w = catWorld();
      // **첫 그룹이 이미 `true`** 인 상황이다. 단락 구현이면 뒤 12개가 안 불린다.
      expect(call(w), `${anchor}: 억제가 전파되지 않았다`).toBe(true);
      const missing = GROUPS.filter((g) => (hoisted.calls[`${g}${anchor}`] ?? 0) === 0);
      expect(missing, `${anchor}: 단락돼 안 불린 그룹`).toEqual([]);
    }
  });

  it('억제형은 아무도 참이 아니면 `false` 다 (무촉매 런도 동일)', () => {
    const w = catWorld();
    expect(hooks.onBossDeathCatalyst(w, 0, 0)).toBe(false);
    expect(hooks.onLootCollectedCatalyst(w, player(w))).toBe(false);
    expect(hooks.onDestructibleDestroyedCatalyst(w, player(w))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ② 배율형 합성 — 두 그룹이 동시에 배율을 내면 **곱**이다
// ---------------------------------------------------------------------------

describe('배율형 앵커의 합성 — 곱 누적', () => {
  it('`onDamageChain`: 두 그룹이 ×2·×3 이면 결과는 ×6 이다', () => {
    hoisted.multBy = { drops: 2, kras: 3 };
    const w = catWorld();
    expect(hooks.onDamageChainCatalyst(w, player(w), 10)).toBeCloseTo(60, 10);
  });

  it('`onEnemyStep`: 두 그룹이 ×0.5·×4 이면 결과는 ×2 다', () => {
    hoisted.multBy = { refine: 0.5, resonance: 4 };
    const w = catWorld();
    expect(hooks.onEnemyStepCatalyst(w, player(w), 3)).toBeCloseTo(6, 10);
  });

  it('`onLootRoll`: 등급·개수 **두 축이 각각** 곱해진다', () => {
    hoisted.multBy = { drops: 2, toxar: 3 };
    const w = catWorld();
    const r = hooks.onLootRollCatalyst(w, 1, 5, 0, 0, true);
    expect(r.rarity).toBeCloseTo(6, 10);
    expect(r.count).toBeCloseTo(30, 10);
  });

  it('아무도 배율을 안 내면 **인자 그대로**다 (중립 1 의 곱은 비트 동일)', () => {
    const w = catWorld();
    expect(hooks.onDamageChainCatalyst(w, player(w), 7.25)).toBe(7.25);
    expect(hooks.onEnemyStepCatalyst(w, player(w), 0.375)).toBe(0.375);
    const r = hooks.onLootRollCatalyst(w, 1.5, 2.5, 0, 0, false);
    expect(r.rarity).toBe(1.5);
    expect(r.count).toBe(2.5);
  });
});

// ---------------------------------------------------------------------------
// ③ fx 채널 — 무촉매는 부재 · 매 틱 비움 · **해시에 안 접힌다**
// ---------------------------------------------------------------------------

describe('촉매 연출 통지 채널', () => {
  it('무촉매 런은 채널 **자체가 없다** (필드 undefined · 통지도 무시된다)', () => {
    const w = plainWorld();
    expect(w.catalystFx).toBeUndefined();
    notifyCatalystFx(w, 1, CATALYST_FX.trigger, 0, 0);
    expect(w.catalystFx, '무촉매 런에 채널이 생겼다').toBeUndefined();
    expect(catalystFxOf(w)).toBeUndefined();
    expect(snapshotWorld(w).catalystFx).toBeUndefined();
  });

  it('촉매 런: 통지가 쌓이고 **매 틱 비워진다**', () => {
    const w = catWorld();
    notifyCatalystFx(w, 1, CATALYST_FX.trigger, 3, 4);
    notifyCatalystFx(w, 1, CATALYST_FX.selfHarm, 5, 6);
    expect(catalystFxOf(w)).toHaveLength(2);
    stepWorld(w, IDLE);
    expect(catalystFxOf(w), '틱이 지났는데 안 비워졌다 — 누적하면 스냅샷이 폭주한다').toBeUndefined();
  });

  it('한 틱 상한을 넘으면 조용히 버린다 (스냅샷 폭주 방어)', () => {
    const w = catWorld();
    for (let i = 0; i < CATALYST_FX_MAX + 30; i++) notifyCatalystFx(w, 1, CATALYST_FX.credit, 0, 0);
    expect(catalystFxOf(w)).toHaveLength(CATALYST_FX_MAX);
  });

  it('스냅샷은 **복사본**이다 — 다음 틱의 비움이 이전 스냅샷을 안 지운다', () => {
    const w = catWorld();
    notifyCatalystFx(w, 7, CATALYST_FX.trigger, 1, 2);
    const snap = snapshotWorld(w);
    expect(snap.catalystFx).toEqual([{ id: 7, kind: CATALYST_FX.trigger, x: 1, y: 2 }]);
    stepWorld(w, IDLE);
    expect(snap.catalystFx, '참조를 흘렸다 — 보간 중인 스냅샷이 조용히 비워진다').toHaveLength(1);
  });

  it('⭐ `hashWorld` 에 **안 접힌다** — 같은 시드에서 통지 유무가 해시를 안 바꾼다', () => {
    const a = catWorld(0xbeef);
    const b = catWorld(0xbeef);
    for (let t = 0; t < 90; t++) {
      // a 에만 매 틱 통지를 쏟아붓는다(자리·종류·id 전부 다르게).
      notifyCatalystFx(a, t % 48, (t % 4) as 0 | 1 | 2 | 3, t, t * 2);
      creditCatalyst(a, t % 48, t + 1);
      missCatalyst(a, t % 48, t + 2);
      stepWorld(a, IDLE);
      stepWorld(b, IDLE);
      expect(hashWorld(a), `틱 ${t}: 연출 통지가 해시에 접혔다`).toBe(hashWorld(b));
    }
  });
});

// ---------------------------------------------------------------------------
// ④ 귀속 원장 — 정산 채널의 S0 증명 세 줄이 **여전히 참**이다
// ---------------------------------------------------------------------------

describe('촉매별 기여 명세 — 정산 채널 확장', () => {
  it('① 원시값만: 명세 행이 수 넷뿐이다', () => {
    const w = catWorld();
    notifyCatalystFx(w, 3, CATALYST_FX.trigger, 0, 0);
    creditCatalyst(w, 3, 120);
    missCatalyst(w, 3, 45);
    const out = catalystContributionsOf(w);
    expect(out).toEqual([{ id: 3, fired: 1, earned: 120, missed: 45 }]);
    for (const row of out ?? []) {
      for (const v of Object.values(row)) expect(typeof v).toBe('number');
    }
  });

  it('② 복사본이다 — 정산이 변형해도 sim 장부가 안 움직인다', () => {
    const w = catWorld();
    creditCatalyst(w, 5, 10);
    const out = catalystContributionsOf(w) as unknown as { id: number; earned: number }[];
    out[0]!.earned = 999;
    expect(catalystContributionsOf(w)?.[0]?.earned, '참조를 내줬다').toBe(10);
  });

  it('③ 무촉매는 채널 자체가 없다 (`undefined` → RunResult 에 필드 미탑재)', () => {
    const w = plainWorld();
    creditCatalyst(w, 5, 10);
    missCatalyst(w, 5, 10);
    expect(catalystContributionsOf(w)).toBeUndefined();
  });

  it('적립이 한 번도 없던 촉매 런도 `undefined` 다 (빈 배열을 안 싣는다)', () => {
    expect(catalystContributionsOf(catWorld())).toBeUndefined();
  });

  it('`trigger` 통지만 발동 횟수를 올린다 (credit/miss 가 이중 계수되지 않는다)', () => {
    const w = catWorld();
    notifyCatalystFx(w, 9, CATALYST_FX.trigger, 0, 0);
    notifyCatalystFx(w, 9, CATALYST_FX.credit, 0, 0);
    notifyCatalystFx(w, 9, CATALYST_FX.selfHarm, 0, 0);
    expect(catalystContributionsOf(w)?.[0]?.fired).toBe(1);
  });

  it('정산이 sim 타입을 안 들인다 — `src/save/settlement.ts` 에 식별자 `WorldState` 가 없다', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(
      fileURLToPath(new URL('../src/save/settlement.ts', import.meta.url)),
      'utf8',
    );
    expect(/\bWorldState\b/.test(src), '정산이 sim 타입을 들였다').toBe(false);
    // 항진 방지 — 확장한 채널 필드가 실제로 거기 있어야 위 단언이 의미를 갖는다.
    expect(src.includes('catalystContributions?: readonly')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ⑤ HUD 귀속 — `flashCatalystSlot` 의 **프로덕션 호출부가 실제로 있다**
// ---------------------------------------------------------------------------
//
// 이 절이 필요한 이유는 실측이다: `hud.flashCatalystSlot` 은 자리만 있고 **프로덕션 호출이
// 0건**이었다(HUD 쪽 주석이 *"호출부는 아직 없다"* 라고 스스로 적어 뒀다). 이 저장소의 지배적
// 실패 모드가 "배선이 통째로 없다"이고, 함수가 존재한다는 사실은 그것을 한 톨도 안 막는다.

describe('HUD 슬롯 번쩍임의 배선 (헌장 §귀속 규율 1)', () => {
  it('`src/main.ts` 가 통지를 관측해 `flashCatalystSlot` 을 부른다', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
    expect(src.includes('hud.flashCatalystSlot('), '귀속 규율 1 이 다시 미배선이 됐다').toBe(true);
    // 통지를 실제로 흘리는 경로까지 함께 잡는다 — 호출문만 있고 입력이 안 오면 무연산이다.
    expect(src.includes('drainCatalystFx(currSnap.catalystFx)')).toBe(true);
    // 자기 피해 전용 색(귀속 규율 3)과 전용 사운드도 같은 경로에 걸려 있다.
    expect(src.includes('entityRenderer.markCatalystSelfHarm()')).toBe(true);
    expect(src.includes('audio.play(sound)')).toBe(true);
  });

  it('렌더러가 자해 색을 **적 피해와 다른 색**으로 가른다', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(
      fileURLToPath(new URL('../src/render/entityRenderer.ts', import.meta.url)),
      'utf8',
    );
    const harm = /const CATALYST_SELF_HARM_TINT = (0x[0-9a-f]+);/.exec(src);
    const hit = /const HIT_FLASH_TINT = (0x[0-9a-f]+);/.exec(src);
    expect(harm, '자해 색 상수가 없다').not.toBeNull();
    expect(hit).not.toBeNull();
    expect(harm?.[1], '자해가 적 피해와 같은 색이면 귀속 규율 3 이 무효다').not.toBe(hit?.[1]);
    expect(src.includes('this.ensureFlashOverlay(tracked, CATALYST_SELF_HARM_TINT)')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ⑥ 사운드 — 촉매 키가 **실재 샘플**에 매핑돼 절차 폴백이 안 걸린다
// ---------------------------------------------------------------------------

describe('촉매 사운드 매핑', () => {
  it('발동·자해가 **서로 다른** 샘플 키로 갈린다', () => {
    const fire = sampleKeyFor('catalystFire');
    const harm = sampleKeyFor('catalystSelfHarm');
    expect(fire).not.toBeNull();
    expect(harm).not.toBeNull();
    expect(fire, '자해가 발동과 같은 소리면 원인 불명의 피해가 된다').not.toBe(harm);
    // 피격(`hit`)과도 갈려야 한다 — 헌장 §귀속 규율 3 의 요점이 그것이다.
    expect(harm).not.toBe(sampleKeyFor('hit'));
  });

  it('⭐ 두 키가 **실재하는 CC0 파일**을 가리킨다 (매핑이 끊기면 무음이 된다)', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(
      fileURLToPath(new URL('../src/render/audio.ts', import.meta.url)),
      'utf8',
    );
    // ⚠️ 파일시스템을 **직접** 훑는다. `import.meta.glob` 은 빌드 시 해석이라 "실재하는 것만
    //    잡힌다" — 즉 파일이 없어도 조용히 빈 집합이 되고 런타임에 무음이 된다. 그 침묵을
    //    잡으려면 여기가 디렉터리를 봐야 한다(`*AssetPresence.test.ts` 와 같은 규율).
    const present = new Set(
      readdirSync(fileURLToPath(new URL('../assets/audio/sfx', import.meta.url))),
    );
    for (const key of ['catalystFire', 'catalystSelfHarm']) {
      const m = new RegExp(`${key}: \\{ file: '([^']+)'`).exec(src);
      expect(m, `${key} 가 SFX_MANIFEST 에 없다`).not.toBeNull();
      const file = m?.[1] ?? '';
      expect(present.has(file), `${key} → ${file} 파일이 없다 — 소리가 조용히 사라진다`).toBe(true);
    }
  });

  it('렌더 해석: 종류 코드가 sim 정본과 같고 발동/자해만 소리를 낸다', () => {
    expect(FX_TRIGGER).toBe(CATALYST_FX.trigger);
    expect(FX_SELF_HARM).toBe(CATALYST_FX.selfHarm);
    expect(FX_CREDIT).toBe(CATALYST_FX.credit);
    expect(FX_MISS).toBe(CATALYST_FX.miss);
    expect(catalystFxSound(FX_TRIGGER)).toBe('catalystFire');
    expect(catalystFxSound(FX_SELF_HARM)).toBe('catalystSelfHarm');
    expect(catalystFxSound(FX_CREDIT)).toBeNull();
    expect(catalystFxSound(FX_MISS)).toBeNull();
    // 귀속 규율 1 — 어느 종류든 HUD 슬롯은 번쩍인다.
    for (const k of [FX_TRIGGER, FX_SELF_HARM, FX_CREDIT, FX_MISS]) {
      expect(catalystFxFlashesSlot(k)).toBe(true);
    }
  });
});
