/**
 * 촉매 재구축 **공유 기반**의 계약 (ADR-0052) — 슬롯 접근자 · `catalystOn` 게이트 ·
 * `hashWorld` 조건부 꼬리 폴드 · 스킬 폴드와의 **비충돌**.
 *
 * ## 합격 조건이 `skillFoundation.test.ts` 와 같은 종류다
 * 이 커밋도 **소비자가 0인 배선**을 만든다. 그래서 "효과가 있다"를 잴 것이 없고,
 * **거동·해시 불변**과 **규약이 실제로 강제되는가**를 잰다.
 *
 * ## ⚠️ 이 파일은 골든 재생성 **전에** 통과해야 한다
 * 재생성된 골든으로 그 골든을 검사하면 항진이다. 스킬 배선과 촉매가 같은 재생성 창에
 * 착지하므로, "촉매 기반이 무촉매 런을 바꾸지 않았다"의 근거는 **재생성 전에 통과시킨**
 * 이 불변식이어야 한다.
 *
 * ⚠️ "6칸 전부 0이면 무폴드"의 절대적 증명은 여기가 아니라 골든 픽스처(`pnpm test:sim` 의
 * `denoFixture`·`shipHashBaseline`)다 — 이 파일이 쓸 수 있는 것은 상대 비교뿐이라, 폴드를
 * 무조건 실행하는 구현도 아래 단언을 전부 통과한다. 마지막 절이 그 사각지대를 명시한다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createWorld,
  DEFAULT_CONFIG,
  stepWorld,
  catalystSettlementOf,
} from '../src/sim/world.js';
import type { WorldState, InputFrame } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import {
  CATALYST_SLOT_COUNT,
  createCatalystSlots,
  readCatalystSlot,
  writeCatalystSlot,
} from '../src/sim/catalystSlots.js';
import { writeSlot } from '../src/sim/skillSlots.js';

const IDLE: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };

function w(): WorldState {
  return createWorld(0xca7a, { ...DEFAULT_CONFIG });
}

// ---------------------------------------------------------------------------
// ① 슬롯 접근자 — 정수·비음 강제와 범위 방어
// ---------------------------------------------------------------------------

describe('촉매 슬롯 접근자', () => {
  it('새 배열은 고정폭 24 이고 전 슬롯 0 이다 (무폴드의 전제)', () => {
    const s = createCatalystSlots();
    expect(s.length).toBe(CATALYST_SLOT_COUNT);
    // 24 = 공용 15(전역 유일) + 특산 5(행성 간 재사용, 최대 수요 아르케) + 공명 2 + 예비 2.
    // 도출 근거는 `catalystSlots.ts` 의 배정표가 정본이다.
    expect(CATALYST_SLOT_COUNT).toBe(24);
    expect(s.every((v) => v === 0)).toBe(true);
  });

  it('writeCatalystSlot 은 `Math.trunc` + `max(0, ·)` 를 강제한다', () => {
    const s = createCatalystSlots();
    writeCatalystSlot(s, 0, 3.9);
    expect(readCatalystSlot(s, 0)).toBe(3);
    writeCatalystSlot(s, 1, -5);
    expect(readCatalystSlot(s, 1)).toBe(0);
    writeCatalystSlot(s, 2, Number.NaN);
    expect(readCatalystSlot(s, 2)).toBe(0);
  });

  it('⚠️ 범위 밖 인덱스는 **던진다** — 조용한 무연산을 만들지 않는다', () => {
    const s = createCatalystSlots();
    expect(() => readCatalystSlot(s, CATALYST_SLOT_COUNT)).toThrow();
    expect(() => writeCatalystSlot(s, CATALYST_SLOT_COUNT, 1)).toThrow();
    expect(() => writeCatalystSlot(s, -1, 1)).toThrow();
    expect(() => writeCatalystSlot(s, 1.5, 1)).toThrow();
  });

  it('⚠️ 스킬 접근자를 빌려 쓰면 폭 검사가 어긋나는 것을 보여 준다 (별도 접근자의 존재 이유)', () => {
    // 폭이 갈렸으므로 어긋남이 **양방향**이다. 그래서 접근자를 공유하면 안 된다.
    //
    // ① 촉매 폭(24) > 스킬 폭(8) — 스킬 접근자는 배정표가 실제로 쓰는 칸(예: 슬롯 13
    //    `BulwarkSlot.Ticks`)을 **범위 밖이라며 거부한다**. 빌려 쓰면 정당한 쓰기가 죽는다.
    expect(() => writeSlot(createCatalystSlots(), 13, 1)).toThrow();
    expect(() => writeCatalystSlot(createCatalystSlots(), 13, 1)).not.toThrow();
    // ② 반대 방향 — 촉매 접근자는 폭 24 를 검사하므로 8칸 스킬 배열의 슬롯 8..23 을
    //    **통과시킨다**. 그 순간 배열이 조용히 늘어나 스킬 쪽 고정폭 폴드가 깨진다.
    const skillLike = new Array<number>(8).fill(0);
    writeCatalystSlot(skillLike, 12, 1);
    expect(skillLike.length).toBeGreaterThan(8);
  });
});

// ---------------------------------------------------------------------------
// ② catalystOn — config 파생, 런 중 불변
// ---------------------------------------------------------------------------

describe('catalystOn 게이트', () => {
  it('무촉매 런은 거짓이다 (촉매 디스패치 9개가 첫 줄에서 반환한다)', () => {
    expect(w().catalystOn).toBe(false);
  });

  it('촉매가 하나라도 실리면 참이다', () => {
    const s = createWorld(0xca7a, { ...DEFAULT_CONFIG, catalysts: [1] });
    expect(s.catalystOn).toBe(true);
  });

  it('빈 배열은 거짓이다 — `undefined` 와 같게 다룬다', () => {
    expect(createWorld(0xca7a, { ...DEFAULT_CONFIG, catalysts: [] }).catalystOn).toBe(false);
  });

  it('슬롯 배열은 스킬 배열들과 서로 다른 객체다 (한 배열을 두 번 싣는 오타를 잡는다)', () => {
    const s = w();
    expect(s.catalystSlots).not.toBe(s.skillCarry);
    expect(s.catalystSlots).not.toBe(s.skillStage);
    expect(s.catalystSlots.length).toBe(CATALYST_SLOT_COUNT);
  });
});

// ---------------------------------------------------------------------------
// ③ hashWorld 촉매 폴드 — 조건부성과 **충돌 부재**
// ---------------------------------------------------------------------------

describe('hashWorld 촉매 슬롯 폴드', () => {
  it('전 슬롯 0 인 두 월드의 해시는 같다', () => {
    expect(hashWorld(w())).toBe(hashWorld(w()));
  });

  it('슬롯이 서면 해시가 갈리고, 0 으로 되돌리면 정확히 복원된다 (조건부 · 값 의존)', () => {
    const a = w();
    const base = hashWorld(a);
    for (let i = 0; i < CATALYST_SLOT_COUNT; i++) {
      writeCatalystSlot(a.catalystSlots, i, 7);
      expect(hashWorld(a), `슬롯 ${i} 이 해시에 안 닿는다`).not.toBe(base);
      writeCatalystSlot(a.catalystSlots, i, 0);
      expect(hashWorld(a), `슬롯 ${i} 복원 실패`).toBe(base);
    }
  });

  it('⚠️ **부분 폴드였다면 충돌한다** — 같은 값이 다른 슬롯에 있으면 다른 해시다', () => {
    const at0 = w();
    writeCatalystSlot(at0.catalystSlots, 0, 3);
    const at1 = w();
    writeCatalystSlot(at1.catalystSlots, 1, 3);
    expect(hashWorld(at0)).not.toBe(hashWorld(at1));
  });

  it('⚠️ **스킬 폴드와 충돌하지 않는다** — 스킬만 선 런과 촉매만 선 런이 다른 해시다', () => {
    // 두 폴드가 같은 창에 착지하므로 이 단언이 핵심이다. 촉매 폴드를 스킬 폴드 **앞**에
    // 끼워 넣거나 두 폴드의 조건을 하나로 묶으면 여기가 빨개진다.
    const skillOnly = w();
    writeSlot(skillOnly.skillCarry, 0, 1);
    const catalystOnly = w();
    writeCatalystSlot(catalystOnly.catalystSlots, 0, 1);
    expect(hashWorld(skillOnly)).not.toBe(hashWorld(catalystOnly));

    // 그리고 둘 다 선 런은 어느 쪽과도 다르다(폴드가 서로를 먹지 않는다).
    const both = w();
    writeSlot(both.skillCarry, 0, 1);
    writeCatalystSlot(both.catalystSlots, 0, 1);
    expect(hashWorld(both)).not.toBe(hashWorld(skillOnly));
    expect(hashWorld(both)).not.toBe(hashWorld(catalystOnly));
  });

  it('길이 프리픽스를 접지 않는다 — 배열 길이는 상수라 정보량 0 이다', () => {
    expect(CATALYST_SLOT_COUNT).toBe(24);
    expect(w().catalystSlots.length).toBe(CATALYST_SLOT_COUNT);
  });

  it('`catalystOn` 자체는 접지 않는다 — `config.catalysts` 의 순수 파생이다', () => {
    // 게이트만 다르고 슬롯이 전부 0 인 두 월드는 **다른 config** 라 해시가 이미 갈린다.
    // 여기서 재는 것은 "게이트를 따로 접었는가" 가 아니라, 게이트를 세워도 슬롯이 0 이면
    // 촉매 폴드가 실행되지 않는다는 것이다 — 아래 거동 불변 절이 그 관측면이다.
    const off = w();
    expect(off.catalystOn).toBe(false);
    expect(off.catalystSlots.every((v) => v === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ④ 거동 불변 — S0 배선이 무촉매 런을 한 비트도 바꾸지 않는다
// ---------------------------------------------------------------------------

describe('무촉매 런 거동 불변 (골든 재생성 전에 통과해야 하는 근거)', () => {
  it('같은 시드·같은 입력의 두 런이 240틱 뒤 같은 해시다', () => {
    const a = w();
    const b = w();
    for (let t = 0; t < 240; t++) {
      stepWorld(a, IDLE);
      stepWorld(b, IDLE);
    }
    expect(hashWorld(a)).toBe(hashWorld(b));
  });

  it('⚠️ 촉매 슬롯은 런 내내 0 으로 남는다 — S0 는 아무도 쓰지 않는다', () => {
    // 이것이 "무촉매 골든 바이트 불변"의 직접 관측면이다. 배선 레인이 게이트 밖에서 슬롯을
    // 쓰기 시작하면 여기가 먼저 빨개진다.
    const s = w();
    for (let t = 0; t < 240; t++) stepWorld(s, IDLE);
    expect(s.catalystSlots.every((v) => v === 0)).toBe(true);
  });

  it('⚠️ 이 절이 못 잡는 것: "전부 0이면 **한 폴드도 실행하지 않는다**"', () => {
    // 위 단언들은 전부 상대 비교라, 6칸을 **무조건** 접는 구현도 통과한다. 그 구현은 기존
    // 골든을 전량 갈아엎는데 기본 스위트는 초록이다. 실제 판정은 `pnpm test:sim` 의 골든
    // 픽스처가 진다 — 이 커밋을 올리기 전에 반드시 돌려라.
    expect(createCatalystSlots().every((v) => v === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 정산 채널 — S0 증명을 **대체하는** 새 불변식 (선결 앵커 레인)
// ---------------------------------------------------------------------------
//
// 낡은 증명: *"`RunResult` 는 `WorldState` 를 import 조차 안 하는 닫힌 인터페이스"*.
// id 5·18·21 이 정산 채널을 요구해 그것이 뚫렸으므로, 같은 것을 지키는 셋을 여기서 기계로
// 검사한다(셋의 서술 정본은 `catalystHooks.ts` 의 `catalystSettlementOf` 주석).

describe('정산 채널 — 원시값만 · 복사본 · 무촉매는 채널 부재', () => {
  it('① 원시값만: `src/save/settlement.ts` 에 식별자 `WorldState` 가 한 번도 없다', () => {
    // 이것이 낡은 증명의 **대체물**이다. 정산이 sim 타입을 알게 되는 순간 두 층의 경계가
    // 사라지고, 그 경계가 촉매 48종이 정산을 임의로 오염시키지 못하게 막는 유일한 벽이다.
    const src = readFileSync(
      fileURLToPath(new URL('../src/save/settlement.ts', import.meta.url)),
      'utf8',
    );
    expect(/\bWorldState\b/.test(src), '정산이 sim 타입을 들였다').toBe(false);
    // 채널 필드 자체는 있어야 한다 — 없으면 위 단언이 "채널이 없어서 통과"하는 항진이 된다.
    expect(src.includes('catalystSettlement?: readonly number[]')).toBe(true);
  });

  it('② 촉매 런: 고정폭 6 · 전부 비음 정수 (원시값 계약)', () => {
    const s = createWorld(0xca7b, { ...DEFAULT_CONFIG, catalysts: [1] });
    const out = catalystSettlementOf(s);
    expect(out).toBeDefined();
    expect(out).toHaveLength(CATALYST_SLOT_COUNT);
    for (const v of out ?? []) {
      expect(typeof v).toBe('number');
      expect(Number.isInteger(v) && v >= 0).toBe(true);
    }
  });

  it('② 복사본이다 — 정산이 변형해도 sim 슬롯이 안 움직인다', () => {
    const s = createWorld(0xca7c, { ...DEFAULT_CONFIG, catalysts: [1] });
    writeCatalystSlot(s.catalystSlots, 0, 7);
    const out = catalystSettlementOf(s) as number[];
    expect(out[0]).toBe(7);
    out[0] = 999; // 정산 쪽 변형을 흉내 낸다
    expect(s.catalystSlots[0], '참조를 내줬다 — 정산이 sim 상태의 두 번째 작성자가 된다').toBe(7);
  });

  it('③ 무촉매 런은 채널 자체가 없다 (`undefined` → RunResult 에 필드 미탑재)', () => {
    const s = w();
    expect(s.catalystOn).toBe(false);
    expect(catalystSettlementOf(s)).toBeUndefined();
  });
});
