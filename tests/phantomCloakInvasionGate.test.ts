/**
 * 팬텀 은신 해제 배율의 **침공 게이트** 회귀 가드 (ADR-0049 구현 레인 선결 E2).
 *
 * ## 왜 이 파일이 따로 필요한가 — 골든 커버리지가 0 이었다
 * 이 결함은 골든 어디에도 안 걸린다. 저장 골든 셋(`tests/fixtures/striker-prem8.json` ·
 * `tests/fixtures/encounter-baseline.json` · `scripts/deno-verify/fixtures.json`)의 침공
 * 시나리오는 **스트라이커 · 액티브 미장착 · 무입력 900틱**이고, deno 시나리오 중
 * `activeSlots` 를 실은 것은 브루저 한 건뿐이다. 즉 "팬텀 기체 + 액티브 발동 + 침공" 조합을
 * 태우는 픽스처가 리포에 **하나도 없다** — 게이트를 통째로 지워도 전 골든이 그린으로 남는다.
 * 그래서 실제 결함이 배포까지 살아 있었고, 여기서 그 조합을 직접 태운다.
 *
 * ## 무엇이 결함이었나
 * `stepShipSignature` 의 팬텀 분기는 침공에서 통째로 반환해 `aux0`/`aux1` 을 0 으로 묶는다 —
 * 억제(대가)를 걸 수 없는데 배율(이득)만 남으면 침공에서 공짜로 강해지기 때문이다
 * (`world.ts` 팬텀 분기). 그런데 **액티브는 침공에서도 발동한다**(`buildRunConfig` 가
 * `activeSlots` 를 무조건 스탬프한다). `as_phantom_disrupt_hi` 의 SUSTAIN 이 매 틱
 * `aux1 = 1` 을 세우므로, `autoAttack` 의 소진 지점에 같은 게이트가 없으면 버프 지속
 * 300틱 내내 전 발사가 `CLOAK_BREAK_BP`(2.5배)를 받았다.
 *
 * ## 항진 방지 — "침공에서 0 이다" 만으로는 부족하다
 * 게이트가 아니라 **액티브 자체가 침공에서 안 도는 것**이어도 관측은 똑같이 0 이다. 그래서
 * 세 단언을 짝으로 둔다:
 *   ① PvE 대조군에서 소진이 실제로 일어난다 (관측기가 살아 있다)
 *   ② 침공에서 `aux1` 이 실제로 서 있다 (SUSTAIN 이 돌고 있다 = 무연산이 아니다)
 *   ③ 그런데 침공에서 소진은 0 이다 (막은 것은 게이트다)
 * ②가 없으면 이 파일은 액티브 배선이 끊겨도 통과하는 항진 테스트가 된다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, DEFAULT_CONFIG, SPECIAL_ACTIVE_SLOT1 } from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import { INVASION_TOTAL_TICKS, normalizeInvasionLayers } from '../src/sim/invasion/index.js';
import type { InvasionLayers } from '../src/sim/invasion/types.js';
import { SHIP_TYPES, shipTreeRange, zeroSkillInvest } from '../data/ships/index.js';
import { activeById, wireIdOf } from '../data/ships/actives/index.js';

/** 팬텀 = 타입 3. `data/ships/index.ts` 의 `SHIP_TYPES` 인덱스(wire 값이라 불변). */
const PHANTOM_TYPE = 3;
const DISRUPT_HI = 'as_phantom_disrupt_hi';

const IDLE: InputFrame = emptyInput();
const FIRE: InputFrame = { ...IDLE, special: SPECIAL_ACTIVE_SLOT1 };

/** 워밍업 — 양쪽 런이 같은 지점에서 발동하도록 고정한다. */
const WARMUP = 30;
/**
 * 발동 후 관측 구간. `disrupt_hi` 의 `coeff.ticks` 는 300 이므로 그 안에 들어가야 SUSTAIN 이
 * 매 틱 `aux1` 을 다시 세운다. 자동 조준이 표적을 잡고 쿨다운이 도는 데 넉넉한 폭으로 잡는다.
 */
const OBSERVE = 240;

/** `disrupt_hi` 가 열리고도 남을 만큼 그 계열(defense = treeIndex 2)에 투자한 벡터. */
function phantomInvest(): number[] {
  const ship = SHIP_TYPES[PHANTOM_TYPE];
  const v = zeroSkillInvest(PHANTOM_TYPE);
  if (ship === undefined) return v;
  const { start, end } = shipTreeRange(ship, 2);
  for (let i = start; i < end; i++) v[i] = 5;
  return v;
}

/** 전 레이어에 콘텐츠가 실린 배치(빈 슬롯은 기본 수비대가 스폰 단계에서 충원한다). */
function filledLayers(): InvasionLayers {
  const ref = (catalogId: number) => ({ catalogId, level: 1, ascension: 0, affixSeed: 1, rarity: 0 });
  return normalizeInvasionLayers({
    l1: { waveSlots: [ref(0), ref(1), ref(2), null, null, null] },
    l2: { templateId: 0, sockets: [ref(0), ref(1), null, null, null, null] },
    l3: { boss: ref(0), guardians: [null, null], props: [null, null, null, null, null, null] },
  });
}

/** 팬텀 + `disrupt_hi` 슬롯1 런 config. `invasion` 이면 3레이어 배치를 함께 싣는다. */
function phantomConfig(invasion: boolean): WorldConfig {
  const config = {
    ...DEFAULT_CONFIG,
    shipType: PHANTOM_TYPE,
    skillInvest: phantomInvest(),
    activeSlots: [wireIdOf(DISRUPT_HI), -1],
  } as WorldConfig;
  if (invasion) {
    config.invasion3 = { layers: filledLayers(), timeLimitTicks: INVASION_TOTAL_TICKS };
  }
  return config;
}

function playerOf(s: WorldState) {
  const p = s.entities[0];
  if (p === undefined) throw new Error('player entity missing');
  return p;
}

/** 발동 후 `OBSERVE` 틱을 돌리며 `aux1` 이 한 번이라도 섰는지 함께 관측한다. */
function runFired(invasion: boolean): { state: WorldState; aux1Seen: boolean } {
  const state = createWorld(0xc10a4, phantomConfig(invasion));
  for (let t = 0; t < WARMUP; t++) stepWorld(state, IDLE);
  stepWorld(state, FIRE);
  let aux1Seen = playerOf(state).aux1 !== 0;
  for (let t = 0; t < OBSERVE; t++) {
    stepWorld(state, IDLE);
    if (playerOf(state).aux1 !== 0) aux1Seen = true;
  }
  return { state, aux1Seen };
}

describe('팬텀 은신 해제 배율 — 침공 게이트 (선결 E2)', () => {
  it('레지스트리 전제: disrupt_hi 는 팬텀의 buff 액티브이고 지속이 관측 구간보다 길다', () => {
    const def = activeById(DISRUPT_HI);
    expect(def, `${DISRUPT_HI} 가 레지스트리에 없다`).toBeDefined();
    expect(def?.shipTypeId).toBe(PHANTOM_TYPE);
    expect(def?.kind).toBe('buff');
    // 지속이 관측 구간보다 짧으면 SUSTAIN 이 도중에 끊겨 ②가 우연히 거짓이 될 수 있다.
    expect(def?.coeff.ticks ?? 0).toBeGreaterThan(OBSERVE);
  });

  it('① PvE 에서는 은신 해제 배율이 실제로 소진된다 (관측기가 살아 있다)', () => {
    const { state, aux1Seen } = runFired(false);
    expect(aux1Seen, 'PvE 에서 aux1 이 한 번도 서지 않았다 — 액티브 배선이 끊겼다').toBe(true);
    expect(
      state.cloakBreaks,
      'PvE 에서 소진이 0 이면 이 파일의 대조 자체가 성립하지 않는다',
    ).toBeGreaterThan(0);
  });

  it('② 침공에서도 SUSTAIN 이 돌아 aux1 이 선다 (게이트가 막는 것이 무연산이 아니다)', () => {
    const { aux1Seen } = runFired(true);
    expect(
      aux1Seen,
      '침공에서 aux1 이 한 번도 서지 않았다 — 그렇다면 ③은 게이트가 아니라 미배선 때문에 참이 된다',
    ).toBe(true);
  });

  it('③ 그럼에도 침공에서는 배율이 한 번도 실리지 않는다', () => {
    const { state } = runFired(true);
    expect(
      state.cloakBreaks,
      '침공에서 은신 해제 배율이 실렸다 — autoAttack 소진 지점의 invasion3 게이트가 사라졌다',
    ).toBe(0);
  });
});
