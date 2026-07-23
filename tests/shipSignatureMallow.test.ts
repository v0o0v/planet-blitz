/**
 * M8 시그니처 배선 — 말로우(typeId 5 / 비트 22) 완충.
 *
 * ## 무엇을 막는가
 * 1. **소진 규칙 부재** — 순수 함수 층은 적립·회복만 정의한다. world.ts 배선이 정한 소진 규칙
 *    ("무피격 임계를 채운 틱에 풀을 통째로 정산, 회복분은 소멸·나머지는 선체로")을 `cushionSettled`
 *    골든으로 못 박는다. 합 보존(회복분 + 정산분 = 적립분)이 깨지면 여기서 터진다.
 * 2. **배선 부재(이 저장소 8회 재발형)** — "단위 테스트는 전부 그린인데 world.ts 분기가 통째로
 *    없다". 그래서 아래 통합 케이스는 `Profile{typeId:5}` → `buildRunConfig` → `createWorld` →
 *    `stepWorld` 정규 경로를 실제로 굴린다.
 * 3. **가짜 증거** — "typeId 0 런과 결과가 다르다" 는 **배선이 0줄이어도 이미 참**이다(baseBp 가
 *    damage/maxHp/moveSpeed 를 바꾸고 shipType 이 해시 꼬리에 접힌다). 그래서 정본 대조군은
 *    **시그니처 억제 동형 대조군**이다 — 같은 config 에서 `signatureOn` 의 2축(마스크·shipType)만
 *    눌러 시그니처 하나만 제거한 런. 이 대조군과 갈리는 것이 곧 "배선이 있다" 의 직접 측정이다.
 * 4. **aux 오염** — 시그니처 없는 런에서 aux 가 0 이 아니게 되면 조건부 폴드 규약이 깨진다.
 */

import { describe, it, expect } from 'vitest';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import type { Profile } from '../src/save/profile.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import type { InputFrame, WorldConfig } from '../src/sim/world.js';
import { PLANET_MODE } from '../src/sim/planetMode.js';
import { hashWorld } from '../src/sim/replay.js';
import { hasCapstone } from '../src/sim/capstones.js';
import {
  SIG_MALLOW_CUSHION,
  CUSHION_DEFER_BP,
  CUSHION_RECOVER_TICKS,
  CUSHION_RECOVER_BP,
  cushionDeferredDamage,
  cushionRecovered,
  cushionSettled,
} from '../src/sim/shipSignature.js';
import { zeroSkillInvest } from '../data/ships/index.js';

// ---------------------------------------------------------------------------
// ① 순수 함수 골든 — 소진 규칙(cushionSettled)
// ---------------------------------------------------------------------------

describe('말로우 완충 — 정산 몫(cushionSettled) 경계 골든', () => {
  it('임계 179 / 180 / 181 에서 갈린다 (정산 자체가 임계 게이트)', () => {
    expect(cushionSettled(1000, CUSHION_RECOVER_TICKS - 1)).toBe(0);
    expect(cushionSettled(1000, CUSHION_RECOVER_TICKS)).toBe(400);
    expect(cushionSettled(1000, CUSHION_RECOVER_TICKS + 1)).toBe(400);
  });

  it('회복분 + 정산분 = 적립분 (미룬 피해는 회복된 만큼만 사라진다)', () => {
    for (let v = 0; v <= 400; v++) {
      const rec = cushionRecovered(v, CUSHION_RECOVER_TICKS);
      const due = cushionSettled(v, CUSHION_RECOVER_TICKS);
      expect(rec + due, `deferred=${v}`).toBe(v);
      expect(Number.isInteger(due), `deferred=${v}`).toBe(true);
      expect(due).toBeGreaterThanOrEqual(0);
    }
  });

  it('비정상 입력에서 0 이고 소수 입력도 정수로 나온다', () => {
    expect(cushionSettled(0, 999)).toBe(0);
    expect(cushionSettled(-40, 999)).toBe(0);
    expect(Number.isInteger(cushionSettled(77.4, 180.9))).toBe(true);
  });

  it('한 피격의 순 경감이 설계 수치(35% × 60%)와 맞는다', () => {
    expect(CUSHION_DEFER_BP).toBe(3500);
    expect(CUSHION_RECOVER_BP).toBe(6000);
    const damage = 1000;
    const deferred = cushionDeferredDamage(damage); // 350
    const immediate = damage - deferred; // 650
    const due = cushionSettled(deferred, CUSHION_RECOVER_TICKS); // 140
    expect(immediate + due).toBe(790); // 21% 경감
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
  /** 지연 풀이 통째로 정산된 횟수(aux0 이 양수 → 0 으로 떨어진 전이 수). */
  settlements: number;
  maxAux0: number;
  maxAux1: number;
  hashes: number[];
}

function runObserved(seed: number, cfg: WorldConfig, ticks: number): Observed {
  // 함선 시그니처 관측은 **중립 서바이벌 아레나**(vampire)에서 돈다. planet 2(니플헤임)는 Lane6 에서
  // chase 로 배정돼 무적 포식자가 정지·저속 플레이어를 접촉 즉사시키므로(MED-1 수정 후 치명적),
  // planetMode 를 vampire 로 덮어 장시간 관측 런이 조기 종료되지 않게 한다(로스터는 유지, chase 만 끔).
  const state = createWorld(seed, { ...cfg, planetMode: PLANET_MODE.vampire, playerHp: DURABLE_HP });
  let maxAux0 = 0;
  let maxAux1 = 0;
  let settlements = 0;
  let prevAux0 = 0;
  const hashes: number[] = [];
  for (let i = 0; i < ticks; i++) {
    stepWorld(state, NEUTRAL);
    const p = state.entities[0]!;
    // aux0 이 줄어드는 유일한 경로가 정산이므로(적립은 증가만 한다) 이 전이가 곧 정산이다.
    if (prevAux0 > 0 && p.aux0 === 0) settlements++;
    prevAux0 = p.aux0;
    if (p.aux0 > maxAux0) maxAux0 = p.aux0;
    if (p.aux1 > maxAux1) maxAux1 = p.aux1;
    hashes.push(hashWorld(state));
  }
  return {
    hpLost: DURABLE_HP - state.entities[0]!.hp,
    settlements,
    maxAux0,
    maxAux1,
    hashes,
  };
}

describe('말로우(typeId 5) 정규 경로 배선 — Profile → buildRunConfig → createWorld → stepWorld', () => {
  // 무대 선정도 계약의 일부다: p0/t0 는 3600틱 누적 피해가 수십뿐이라 21% 경감이 정수
  // 반올림에 먹힌다. p2/t2 는 신호가 크다(정찰 실측 기준).
  const STAGE = { planet: 2, stage: 21 } as const;
  const SEED = 3311;
  // 첫 피격 + CUSHION_RECOVER_TICKS(180) 이후 첫 정산 → 반복 발현까지 보려면 넉넉히.
  const TICKS = 1800;

  it('완충이 실제로 발현한다 — 억제 대조군보다 피해가 작고 지연 풀이 적립된다', () => {
    const cfg = buildRunConfig(profileWithType(5), STAGE);
    expect(cfg.shipType).toBe(5);
    expect(hasCapstone(cfg.loadout?.uniqueMask ?? 0, SIG_MALLOW_CUSHION)).toBe(true);

    const live = runObserved(SEED, cfg, TICKS);
    const ctrl = runObserved(SEED, suppressSignature(cfg, SIG_MALLOW_CUSHION), TICKS);

    // 공허 런 가드 — 월드가 멈춰 있거나 아무도 안 때리면 이 케이스는 아무것도 증명 못 한다.
    expect(new Set(live.hashes).size).toBeGreaterThan(900);
    expect(ctrl.hpLost).toBeGreaterThan(50);

    // 핵심 단언: 시그니처 하나만 제거하면 피해가 늘어난다(= 배선이 실제로 산 상태다).
    // 실측 기준선(seed 3311 / p2t2 / 1800틱): live 346 vs ctrl 532.
    expect(live.hpLost).toBeLessThan(ctrl.hpLost);

    // 런타임 상태가 실제로 굴러간다: 지연 풀이 적립된다.
    expect(live.maxAux0).toBeGreaterThan(0);
    // 억제 대조군은 aux 를 한 번도 건드리지 않는다(조건부 폴드 규약).
    expect(ctrl.maxAux0).toBe(0);
    expect(ctrl.maxAux1).toBe(0);
  });

  it('교전이 끊기면 지연 풀이 정산된다 — 무피격 임계 통과 + 풀 소진 관측', () => {
    // 무대가 계약의 일부인 두 번째 사례: p2/t2 는 압박이 끊기지 않아 **정산이 한 번도
    // 일어나지 않는다**(실측 무피격 최대 146틱 < 180). 소진 규칙 자체를 관측하려면 교전
    // 밀도가 낮은 p0/t0 무대가 필요하다 — 이 케이스가 없으면 "적립만 하고 영원히 안
    // 들어오는" 배선(= 순수 감쇄)도 위 케이스를 통과해 버린다.
    const cfg = buildRunConfig(profileWithType(5), { planet: 0, stage: 1 });
    const live = runObserved(555, cfg, 1800);
    const ctrl = runObserved(555, suppressSignature(cfg, SIG_MALLOW_CUSHION), 1800);

    expect(new Set(live.hashes).size).toBeGreaterThan(900);
    expect(ctrl.hpLost).toBeGreaterThan(0);
    // 무피격 카운터가 임계를 넘고, 그 시점에 풀이 통째로 정산된다(실측 2회).
    expect(live.maxAux1).toBeGreaterThanOrEqual(CUSHION_RECOVER_TICKS);
    expect(live.settlements).toBeGreaterThan(0);
    expect(ctrl.settlements).toBe(0);
    // 정산으로 일부가 되돌아와도 순 경감은 유지된다(실측 live 6 vs ctrl 14).
    expect(live.hpLost).toBeLessThan(ctrl.hpLost);
  });

  it('스트라이커(typeId 0) 런은 aux 를 끝까지 0 으로 둔다 (해시 폴드 불변)', () => {
    const striker = buildRunConfig(defaultProfile(), STAGE);
    const obs = runObserved(SEED, striker, 600);
    expect(obs.maxAux0).toBe(0);
    expect(obs.maxAux1).toBe(0);
    expect(new Set(obs.hashes).size).toBeGreaterThan(300);
  });

  it('같은 Profile 은 같은 해시 스트림을 낸다 (결정론 — ADR-0005)', () => {
    const cfg = (): WorldConfig => buildRunConfig(profileWithType(5), STAGE);
    expect(runObserved(SEED, cfg(), 400).hashes).toEqual(runObserved(SEED, cfg(), 400).hashes);
  });
});
