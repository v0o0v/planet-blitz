/**
 * M8 시그니처 배선 — 버블(typeId 6 / 비트 23) 방막.
 *
 * ## 무엇을 막는가
 * 1. **파열 규칙 부재** — 순수 함수 층은 흡수·재생 판정만 정의하고 "언제 터지는가 / 얼마나
 *    밀어내는가" 를 비워 두었다. world.ts 배선이 정한 규칙(막 내구가 **소진되는 순간** 파열,
 *    밀어내기는 좌표 1회 변위 `filmBurstPush()`)을 골든으로 못 박는다.
 * 2. **배선 부재(이 저장소 8회 재발형)** — "단위 테스트는 전부 그린인데 world.ts 분기가 통째로
 *    없다". 그래서 아래 통합 케이스는 `Profile{typeId:6}` → `buildRunConfig` → `createWorld` →
 *    `stepWorld` 정규 경로를 실제로 굴린다.
 * 3. **가짜 증거** — "typeId 0 런과 결과가 다르다" 는 **배선이 0줄이어도 이미 참**이다(baseBp 가
 *    damage/maxHp/moveSpeed 를 바꾸고 shipType 이 해시 꼬리에 접힌다). 그래서 정본 대조군은
 *    **시그니처 억제 동형 대조군**이다 — 같은 config 에서 `signatureOn` 의 2축(마스크·shipType)만
 *    눌러 시그니처 하나만 제거한 런.
 * 4. **조용한 무해 파열** — 밀어내기를 `e.vx`/`e.vy` 로 구현하면 다음 틱 이동 컴포넌트가 덮어써
 *    화면상 아무 일도 안 일어난다. 그래서 파열 틱에 **적이 실제로 크게 이동했는지**를 잰다.
 * 5. **aux 오염** — 시그니처 없는 런에서 aux 가 0 이 아니게 되면 조건부 폴드 규약이 깨진다.
 */

import { describe, it, expect } from 'vitest';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import type { Profile } from '../src/save/profile.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import type { InputFrame, WorldConfig } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import { hasCapstone } from '../src/sim/capstones.js';
import {
  SIG_BUBBLE_FILM,
  FILM_PERIOD_TICKS,
  FILM_ABSORB_FLAT,
  FILM_BURST_RADIUS,
  FILM_BURST_PUSH,
  FILM_BURST_PUSH_TICKS,
  filmReady,
  filmAbsorbed,
  filmRemainingDamage,
  filmBurstPush,
} from '../src/sim/shipSignature.js';
import { zeroSkillInvest } from '../data/ships/index.js';

// ---------------------------------------------------------------------------
// ① 순수 함수 골든 — 흡수 합 보존 + 파열 변위
// ---------------------------------------------------------------------------

describe('버블 방막 — 순수 산술 골든', () => {
  it('흡수분 + 잔여분 = 원래 피해 (막은 총량 흡수지 배율이 아니다)', () => {
    for (let d = 0; d <= 200; d++) {
      for (const s of [0, 1, 17, FILM_ABSORB_FLAT]) {
        const a = filmAbsorbed(d, s);
        const r = filmRemainingDamage(d, s);
        expect(a + r, `d=${d} s=${s}`).toBe(d);
        expect(Number.isInteger(a) && Number.isInteger(r)).toBe(true);
        expect(a).toBeLessThanOrEqual(s);
      }
    }
  });

  it('재생 임계 419 / 420 에서 갈린다', () => {
    expect(filmReady(FILM_PERIOD_TICKS - 1)).toBe(false);
    expect(filmReady(FILM_PERIOD_TICKS)).toBe(true);
  });

  it('파열 1회 변위가 반경보다 크다 (반경 안 적이 반경 밖으로 나간다)', () => {
    expect(filmBurstPush()).toBe((FILM_BURST_PUSH * FILM_BURST_PUSH_TICKS) / 100);
    expect(filmBurstPush()).toBe(260);
    expect(filmBurstPush()).toBeGreaterThan(FILM_BURST_RADIUS);
  });
});

// ---------------------------------------------------------------------------
// ② 정규 경로 통합 — 실제로 배선이 살아 있는가
// ---------------------------------------------------------------------------

const NEUTRAL: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };
/** 런이 조기 종료되지 않게 버티는 무대 상수(프로필 파생값이 아니다). */
const DURABLE_HP = 100_000_000;

/** `typeId` 기체 하나를 가진 프로필(무투자). 앱의 기체 교체 결과와 같은 모양. */
function profileWithType(typeId: number): Profile {
  const p = defaultProfile();
  const ship = activeShip(p);
  ship.typeId = typeId;
  ship.skillInvest = zeroSkillInvest(typeId);
  return p;
}

/**
 * 시그니처만 끈 동형 대조군. `signatureOn`(world.ts)은 **마스크 축 OR shipType 축**이므로
 * 둘 다 눌러야 한다. 프로덕션 코드는 한 줄도 건드리지 않는다.
 */
function suppressSignature(cfg: WorldConfig, bit: number): WorldConfig {
  const loadout = cfg.loadout!;
  return {
    ...cfg,
    shipType: 0,
    loadout: { ...loadout, uniqueMask: loadout.uniqueMask & ~(1 << bit) },
  };
}

interface Observed {
  hpLost: number;
  /** 막이 소진된(= 파열한) 횟수. aux0 이 양수 → 0 으로 떨어진 전이 수. */
  bursts: number;
  /** 파열 틱에 적 하나가 이동한 최대 거리(밀어내기가 좌표에 실렸는지의 직접 측정). */
  maxBurstJump: number;
  maxAux0: number;
  maxAux1: number;
  hashes: number[];
}

function runObserved(seed: number, cfg: WorldConfig, ticks: number): Observed {
  const state = createWorld(seed, { ...cfg, playerHp: DURABLE_HP });
  let maxAux0 = 0;
  let maxAux1 = 0;
  let bursts = 0;
  let maxBurstJump = 0;
  let prevAux0 = 0;
  const hashes: number[] = [];
  for (let i = 0; i < ticks; i++) {
    // 파열 틱의 적 이동량을 재기 위해 스텝 직전 좌표를 떠 둔다.
    const before = new Map<number, { x: number; y: number }>();
    for (const e of state.entities) {
      if (e.kind === 'enemy' && !e.dead) before.set(e.id, { x: e.x, y: e.y });
    }
    stepWorld(state, NEUTRAL);
    const p = state.entities[0]!;
    if (prevAux0 > 0 && p.aux0 === 0) {
      bursts++;
      for (const e of state.entities) {
        if (e.kind !== 'enemy' || e.dead) continue;
        const b = before.get(e.id);
        if (b === undefined) continue;
        const jump = Math.hypot(e.x - b.x, e.y - b.y);
        if (jump > maxBurstJump) maxBurstJump = jump;
      }
    }
    prevAux0 = p.aux0;
    if (p.aux0 > maxAux0) maxAux0 = p.aux0;
    if (p.aux1 > maxAux1) maxAux1 = p.aux1;
    hashes.push(hashWorld(state));
  }
  return {
    hpLost: DURABLE_HP - state.entities[0]!.hp,
    bursts,
    maxBurstJump,
    maxAux0,
    maxAux1,
    hashes,
  };
}

describe('버블(typeId 6) 정규 경로 배선 — Profile → buildRunConfig → createWorld → stepWorld', () => {
  // 무대 선정도 계약의 일부다: 막 1장의 흡수량이 FILM_ABSORB_FLAT(60) 고정이라 교전 밀도가
  // 낮은 무대에서는 누적 피해 자체가 그보다 작아 신호가 묻힌다. p2/t2 는 신호가 크다.
  const STAGE = { planet: 2, stage: 21 } as const;
  const SEED = 3311;
  // 첫 막(420틱) → 소진 → 재생(420틱)까지 최소 두 사이클을 보려면 넉넉히.
  const TICKS = 1800;

  it('방막이 실제로 발현한다 — 억제 대조군보다 피해가 작고 막 내구가 소모된다', () => {
    const cfg = buildRunConfig(profileWithType(6), STAGE);
    expect(cfg.shipType).toBe(6);
    expect(hasCapstone(cfg.loadout?.uniqueMask ?? 0, SIG_BUBBLE_FILM)).toBe(true);

    const live = runObserved(SEED, cfg, TICKS);
    const ctrl = runObserved(SEED, suppressSignature(cfg, SIG_BUBBLE_FILM), TICKS);

    // 공허 런 가드 — 월드가 멈춰 있거나 아무도 안 때리면 이 케이스는 아무것도 증명 못 한다.
    expect(new Set(live.hashes).size).toBeGreaterThan(900);
    expect(ctrl.hpLost).toBeGreaterThan(FILM_ABSORB_FLAT);

    // 핵심 단언: 시그니처 하나만 제거하면 피해가 늘어난다(= 배선이 실제로 산 상태다).
    // 실측 기준선(seed 3311 / p2t2 / 1800틱): live 285 vs ctrl 564, 파열 2회.
    expect(live.hpLost).toBeLessThan(ctrl.hpLost);

    // 런타임 상태가 실제로 굴러간다: 막이 서고(aux0 = FILM_ABSORB_FLAT) 재생 타이머가 돈다.
    expect(live.maxAux0).toBe(FILM_ABSORB_FLAT);
    expect(live.maxAux1).toBeGreaterThanOrEqual(FILM_PERIOD_TICKS - 1);
    // 억제 대조군은 aux 를 한 번도 건드리지 않는다(조건부 폴드 규약).
    expect(ctrl.maxAux0).toBe(0);
    expect(ctrl.maxAux1).toBe(0);
    expect(ctrl.bursts).toBe(0);
  });

  it('막이 소진되면 파열해 주변 적을 좌표로 밀어낸다 (속도 배선이면 잡히는 케이스)', () => {
    const cfg = buildRunConfig(profileWithType(6), STAGE);
    const live = runObserved(SEED, cfg, TICKS);

    expect(live.bursts).toBeGreaterThan(0);
    // 적 한 틱 이동량은 수 유닛 수준이다. 파열 틱에 수백 유닛을 뛰었다면 그 원인은
    // burstFilm 의 좌표 변위뿐이다(속도 필드에 실었다면 다음 틱에 덮어써져 여기서 안 잡힌다).
    // 실측: 파열 2회, 최대 이동 267 유닛(= 변위 260 + 그 틱의 자체 이동).
    expect(live.maxBurstJump).toBeGreaterThan(FILM_BURST_RADIUS);
  });

  it('스트라이커(typeId 0) 런은 aux 를 끝까지 0 으로 둔다 (해시 폴드 불변)', () => {
    const striker = buildRunConfig(defaultProfile(), STAGE);
    const obs = runObserved(SEED, striker, 600);
    expect(obs.maxAux0).toBe(0);
    expect(obs.maxAux1).toBe(0);
    expect(obs.bursts).toBe(0);
    expect(new Set(obs.hashes).size).toBeGreaterThan(300);
  });

  it('같은 Profile 은 같은 해시 스트림을 낸다 (결정론 — ADR-0005)', () => {
    const cfg = (): WorldConfig => buildRunConfig(profileWithType(6), STAGE);
    expect(runObserved(SEED, cfg(), 400).hashes).toEqual(runObserved(SEED, cfg(), 400).hashes);
  });
});
