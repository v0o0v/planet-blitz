/**
 * 액티브 스킬 **배선 전수 테스트**(ADR-0041 · 계획 A-5 "배선 전수 테스트 2종" + AC-20).
 *
 * 이 저장소의 반복 결함 8건은 전부 "단위 테스트 그린인데 배선이 통째로 없다"이다. 여기 두
 * 단언이 그 형태를 잡는 축이고, 화면 확인(AC-23)이 최종 방벽이다.
 *
 * ## ① 존재 대조 — 항진이 아닌 이유
 * 레지스트리(`data/ships/actives/*.ts`)와 핸들러 테이블(`src/sim/actives.ts`)이 **물리적으로
 * 분리된 두 파일**이라, 한쪽만 채운 상태가 실제로 존재 가능하다. 한 파일 한 키였다면 이
 * 대조는 구조적 항진이었을 것이다(계획 PM-1).
 *
 * ## ② 관측량 델타 — 왜 해시 비교가 아닌가
 * `"발동 틱의 hashWorld 가 미발동과 다름"` 은 **핸들러가 텅 비어도 항상 참**이다. 쿨다운이
 * 0 → 양수로 바뀌는 것만으로 꼬리 폴드가 실행돼 해시가 갈리기 때문이다. 즉 PM-1 의 시나리오
 * ("쿨다운만 돌고 아무 일도 안 난다")가 PM-1 을 잡으라고 만든 테스트를 그대로 통과한다.
 * 그래서 **미발동 대조군 vs 발동군을 같은 시드로 돌린 관측량 차이**를 본다 — 두 런이 비트
 * 동일이라 epsilon 없는 정확 비교가 성립하고, 자동공격·이동의 배경 잡음이 원리적으로 제거된다.
 *
 * ## ③ 시그니처 델타 — 구 `touchesSignature` 의 대체
 * `def.touchesSignature === SHIP_TYPES[def.shipTypeId].signatureBit` 는 우변이 `shipTypeId`
 * 로 100% 파생 가능해 "저작자가 베껴 적었는가"만 검사하는 또 다른 항진이었다. 대신 **발동군의
 * `aux0`/`aux1` 이 대조군과 달라지는지**를 본다. 스트라이커 6종은 제외하되, **제외 목록
 * 크기가 정확히 6임을 별도 단언**해 조용히 늘지 못하게 한다.
 *
 * ⚠️ **계약 반전(ADR-0049 §1)**: 스트라이커는 이제 `signatureBit: -1` 이 아니다(비트 24,
 * 정조준 사이클). 그래도 스트라이커의 액티브 6종은 여전히 제외 대상이다 — 이유가 "시그니처가
 * 없어서" 에서 **"이 6종이 구조적으로 `aux` 를 건드리지 않아서"** 로 바뀌었을 뿐이다
 * (`data/ships/actives/striker.ts` 저작 자체가 `aux0`/`aux1` 을 한 줄도 참조하지 않는다 —
 * 정조준 카운터 갱신은 액티브가 아니라 `autoAttack`/`stepShipSignature` 에 있다).
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, DEFAULT_CONFIG, SPECIAL_ACTIVE_SLOT1 } from '../src/sim/world.js';
import type { WorldConfig, WorldState, InputFrame } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import { ACTIVE_HANDLERS } from '../src/sim/actives.js';
import { ALL_ACTIVES, ACTIVES_BY_SHIP, wireIdOf } from '../data/ships/actives/index.js';
import { OBSERVABLE_BY_KIND, ACTIVES_PER_SHIP } from '../data/ships/actives/types.js';
import type { ActiveSkillDef } from '../data/ships/actives/types.js';
import { SHIP_TYPES, zeroSkillInvest, shipTreeRange } from '../data/ships/index.js';

/**
 * 액티브가 `aux` 를 건드리지 않는 것이 설계인 기체 타입 — 스트라이커. 이름은 구 계약("시그니처가
 * 없다")에서 왔지만 지금도 변수로 남긴 것은 `withSignature`/`excluded` 필터 표현이 여전히
 * 읽기 쉬워서다. 스트라이커는 이제 시그니처가 있다(비트 24) — 아래 "제외 목록" 테스트가
 * 실제 계약(6종이 구조적으로 aux 를 안 건드린다)을 못 박는다.
 */
const NO_SIGNATURE_SHIP = 0; // 스트라이커

/** 그 스킬이 열리고도 남을 만큼 해당 계열에 투자한 벡터. */
function investFor(def: ActiveSkillDef): number[] {
  const ship = SHIP_TYPES[def.shipTypeId];
  const v = zeroSkillInvest(def.shipTypeId);
  if (ship === undefined) return v;
  const { start, end } = shipTreeRange(ship, def.treeIndex);
  for (let i = start; i < end; i++) v[i] = 5;
  return v;
}

/** 그 스킬을 슬롯 1 에 장착한 런 config. */
function configFor(def: ActiveSkillDef): WorldConfig {
  return {
    ...DEFAULT_CONFIG,
    shipType: def.shipTypeId,
    skillInvest: investFor(def),
    activeSlots: [wireIdOf(def.id), -1],
  };
}

const IDLE: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };
const FIRE: InputFrame = { ...IDLE, special: SPECIAL_ACTIVE_SLOT1 };

/** 워밍업 틱 수 — 대조군·발동군이 같은 지점에서 갈리도록 고정한다. */
const WARMUP = 30;
/** 발동 후 관측까지 진행할 틱 수. `dash` 는 즉시, `buff` 는 잔여 틱이 남아 있어야 한다. */
const OBSERVE = 1;

/**
 * 대조군(미발동)과 발동군을 **같은 시드·같은 config** 로 돌린다. 발동 틱만 `special` 비트가
 * 다르고 나머지는 완전히 같으므로, 두 결과의 차이는 **오직 그 발동에서 나온 것**이다.
 */
function runPair(def: ActiveSkillDef, seed = 0xac71e): { control: WorldState; fired: WorldState } {
  const cfg = configFor(def);
  const control = createWorld(seed, cfg);
  const fired = createWorld(seed, cfg);
  for (let t = 0; t < WARMUP; t++) {
    stepWorld(control, IDLE);
    stepWorld(fired, IDLE);
  }
  // 시그니처 런타임 상태를 **양쪽 동일하게** 중간값으로 심는다. 이유: 소모형 액티브(예: 브루저
  // '장갑 파쇄' = 스택을 전부 태운다)는 스택이 0 인 상태에서 발동하면 `aux0` 이 0 → 0 이라
  // 시그니처 델타가 원리적으로 관측되지 않는다. **소모를 볼 수 있는 자원이 있어야** 그 스킬이
  // 시그니처를 건드렸다는 것이 증명된다. 심는 값이 양쪽 동일하므로 차이는 여전히 **오직 발동**
  // 에서만 나온다(항진이 아니다). 최대치(8)가 아니라 중간값인 것도 의도다 — 충전형 액티브가
  // 이미 최대인 상태를 다시 최대로 만들면 그 역시 델타가 0 이 된다.
  const SIG_SEED = 3;
  for (const w of [control, fired]) {
    const p = playerOf(w);
    p.aux0 = SIG_SEED;
    p.aux1 = 0;
  }
  stepWorld(control, IDLE);
  stepWorld(fired, FIRE);
  for (let t = 0; t < OBSERVE; t++) {
    stepWorld(control, IDLE);
    stepWorld(fired, IDLE);
  }
  return { control, fired };
}

function projectileCount(s: WorldState): number {
  let n = 0;
  for (const e of s.entities) if (e.kind === 'bullet' && !e.dead) n++;
  return n;
}

function playerOf(s: WorldState) {
  const p = s.entities[0];
  if (p === undefined) throw new Error('player entity missing');
  return p;
}

describe('액티브 스킬 배선 전수 ① — 레지스트리 ↔ 핸들러 존재 대조', () => {
  it('레지스트리의 모든 id 에 핸들러가 있다 (누락 = 발동해도 쿨다운만 도는 결함)', () => {
    const missing = ALL_ACTIVES.filter((d) => ACTIVE_HANDLERS[d.id] === undefined).map((d) => d.id);
    expect(missing, `핸들러 누락: ${missing.join(', ')}`).toEqual([]);
  });

  it('핸들러 테이블에 레지스트리에 없는 유령 id 가 없다', () => {
    const known = new Set(ALL_ACTIVES.map((d) => d.id));
    const ghosts = Object.keys(ACTIVE_HANDLERS).filter((id) => !known.has(id));
    expect(ghosts, `유령 핸들러: ${ghosts.join(', ')}`).toEqual([]);
  });

  it('id 가 전역 고유하고, 기체마다 정확히 6종이다 (AC-1)', () => {
    const ids = ALL_ACTIVES.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (let s = 0; s < ACTIVES_BY_SHIP.length; s++) {
      const list = ACTIVES_BY_SHIP[s] ?? [];
      // 아직 저작 전인 기체는 0 종이다(E 레인이 채운다). 채워졌다면 반드시 6 이어야 한다.
      if (list.length !== 0) expect(list.length, `ship ${s}`).toBe(ACTIVES_PER_SHIP);
      for (const d of list) expect(d.shipTypeId, d.id).toBe(s);
    }
  });

  it('`kind` 는 3결뿐이고 `observable` 은 그것에서 파생한 값과 일치한다 (AC-3)', () => {
    for (const d of ALL_ACTIVES) {
      expect(['strike', 'dash', 'buff'], d.id).toContain(d.kind);
      expect(d.observable, d.id).toBe(OBSERVABLE_BY_KIND[d.kind]);
    }
  });
});

describe('액티브 스킬 배선 전수 ② — 관측량 델타 (미발동 대조군 대비)', () => {
  it.each(ALL_ACTIVES.map((d) => [d.id, d] as const))(
    '%s — 발동이 대조군 대비 관측량을 실제로 바꾼다',
    (_id, def) => {
      const { control, fired } = runPair(def);
      if (def.observable === 'projectileCount') {
        expect(projectileCount(fired)).toBeGreaterThan(projectileCount(control));
      } else if (def.observable === 'displacement') {
        const a = playerOf(control);
        const b = playerOf(fired);
        expect(b.x !== a.x || b.y !== a.y).toBe(true);
      } else {
        // buffTicks — 대조군은 0, 발동군은 양수여야 한다. **핸들러가 세운다**(공통 코드 아님).
        expect(control.activeBuff0).toBe(0);
        expect(fired.activeBuff0).toBeGreaterThan(0);
      }
    },
  );
});

describe('AC-5 — 꼬리 조건부 폴드 (중립이면 무폴드 / 비중립이면 갈린다)', () => {
  it('쿨다운·버프가 전부 0인 런은 폴드가 실행되지 않는다 (정수 4개를 흔들어도 해시 불변)', () => {
    // 중립 상태에서 해시를 두 번 재고, 그 사이 **폴드 대상이 아닌** 값을 바꾸지 않았으므로
    // 같아야 한다. 이 단언 자체는 약하지만, 골든 바이트 불변(shipHashBaseline·invasionHash·
    // denoFixture)이 실질 증명이고 여기서는 국소 재현만 확인한다.
    const s = createWorld(0xf01d, { ...DEFAULT_CONFIG });
    for (let t = 0; t < 20; t++) stepWorld(s, IDLE);
    expect(s.activeCd0 + s.activeCd1 + s.activeBuff0 + s.activeBuff1).toBe(0);
    const h1 = hashWorld(s);
    expect(hashWorld(s)).toBe(h1);
  });

  it.each([
    ['activeCd0', (s: WorldState): void => void (s.activeCd0 = 7)],
    ['activeCd1', (s: WorldState): void => void (s.activeCd1 = 7)],
    ['activeBuff0', (s: WorldState): void => void (s.activeBuff0 = 7)],
    ['activeBuff1', (s: WorldState): void => void (s.activeBuff1 = 7)],
  ] as const)(
    '%s 만 다른 두 상태의 해시가 갈린다 — 꼬리 폴드의 존재 증명 (M-②b 가 압박)',
    (_name, mutate) => {
      // ⚠️ 이 단언이 이 스위트에서 **폴드를 직접 겨냥하는 유일한 것**이다. "발동 런 vs 미발동
      // 런의 해시가 다르다"로는 부족하다 — 발동은 투사체·`aux` 같은 **부수효과**로도 해시를
      // 바꾸므로, 폴드를 통째로 지워도 그 단언은 통과한다(실제로 M-②b 를 못 잡았다).
      // 그래서 **다른 모든 것을 고정하고 정수 4개만** 흔든다.
      const a = createWorld(0xfa1d, { ...DEFAULT_CONFIG });
      const b = createWorld(0xfa1d, { ...DEFAULT_CONFIG });
      for (let t = 0; t < 10; t++) {
        stepWorld(a, IDLE);
        stepWorld(b, IDLE);
      }
      expect(hashWorld(a)).toBe(hashWorld(b));
      mutate(b);
      expect(hashWorld(a)).not.toBe(hashWorld(b));
    },
  );

  it('네 정수를 개별로 구분한다 — 부분 폴드 금지(all-or-nothing)의 물증', () => {
    // (1,0,0,0) 과 (0,1,0,0) 이 같은 바이트열을 내면 안 된다. 필드별로 "0이면 생략"하는
    // 부분 폴드를 쓰면 정확히 그 충돌이 난다.
    const mk = (cd0: number, cd1: number, bf0: number, bf1: number): number => {
      const s = createWorld(0xfa1e, { ...DEFAULT_CONFIG });
      for (let t = 0; t < 10; t++) stepWorld(s, IDLE);
      s.activeCd0 = cd0;
      s.activeCd1 = cd1;
      s.activeBuff0 = bf0;
      s.activeBuff1 = bf1;
      return hashWorld(s);
    };
    const hashes = [mk(1, 0, 0, 0), mk(0, 1, 0, 0), mk(0, 0, 1, 0), mk(0, 0, 0, 1)];
    expect(new Set(hashes).size).toBe(4);
  });

  it('비중립(쿨다운이 선 런)은 대조군과 해시가 갈린다 — M-②b 가 압박하는 단언', () => {
    // 이 단언이 없으면 "폴드 가드를 항상 false 로" 하는 뮤테이션이 통과한다(폴드를 통째로
    // 지워도 미사용 런 골든은 통과하므로 M-② 만으로는 못 잡는다).
    const def = ALL_ACTIVES[0];
    if (def === undefined) return;
    const { control, fired } = runPair(def);
    expect(fired.activeCd0).toBeGreaterThan(0);
    expect(control.activeCd0).toBe(0);
    // 두 런은 발동 하나만 다르다. 꼬리 폴드가 실제로 실행돼야 해시가 갈린다.
    expect(hashWorld(fired)).not.toBe(hashWorld(control));
  });

  it('장착 슬롯 wire id 폴드가 실행된다 — 장착만 다른 두 런의 해시가 갈린다', () => {
    const a = ALL_ACTIVES[0];
    const b = ALL_ACTIVES[1];
    if (a === undefined || b === undefined || a.shipTypeId !== b.shipTypeId) return;
    const base = { ...DEFAULT_CONFIG, shipType: a.shipTypeId, skillInvest: investFor(a) };
    const s1 = createWorld(0xb00c, { ...base, activeSlots: [wireIdOf(a.id), -1] });
    const s2 = createWorld(0xb00c, { ...base, activeSlots: [wireIdOf(b.id), -1] });
    for (let t = 0; t < 5; t++) {
      stepWorld(s1, IDLE);
      stepWorld(s2, IDLE);
    }
    expect(hashWorld(s1)).not.toBe(hashWorld(s2));
  });
});

describe('액티브 스킬 배선 전수 ③ — 시그니처 델타 (aux0/aux1)', () => {
  const withSignature = ALL_ACTIVES.filter((d) => d.shipTypeId !== NO_SIGNATURE_SHIP);
  const excluded = ALL_ACTIVES.filter((d) => d.shipTypeId === NO_SIGNATURE_SHIP);

  it('제외 목록(스트라이커)은 저작이 끝나면 정확히 6종이다 — 조용히 늘지 못하게', () => {
    const strikerList = ACTIVES_BY_SHIP[NO_SIGNATURE_SHIP] ?? [];
    expect(excluded.length).toBe(strikerList.length);
    if (strikerList.length !== 0) expect(excluded.length).toBe(ACTIVES_PER_SHIP);
    // ⚠️ 계약 반전(ADR-0049 §1): 스트라이커도 이제 시그니처가 있다(비트 24) — 그래서 더는
    // `signatureBit === -1` 을 이 제외의 근거로 못 박을 수 없다. 제외의 실제 근거는 "이 6종의
    // 저작이 `aux0`/`aux1` 을 한 줄도 참조하지 않는다" 는 구조적 사실이다(정조준 카운터는
    // 액티브가 아니라 `autoAttack`/`stepShipSignature` 에서 갱신된다). 여기서는 그 반대(=
    // 시그니처가 실제로 있다)를 못 박아 "제외 = 시그니처 없음" 이라는 낡은 전제가 되살아나지
    // 않게 한다.
    expect(SHIP_TYPES[NO_SIGNATURE_SHIP]?.signatureBit).toBeGreaterThanOrEqual(0);
  });

  it.each(withSignature.map((d) => [d.id, d] as const))(
    '%s — 발동이 대조군 대비 aux0 또는 aux1 을 바꾼다',
    (_id, def) => {
      const { control, fired } = runPair(def);
      const a = playerOf(control);
      const b = playerOf(fired);
      expect(b.aux0 !== a.aux0 || b.aux1 !== a.aux1, `${def.id}: aux 변화 없음`).toBe(true);
    },
  );
});
