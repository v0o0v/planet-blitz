/**
 * M8 시그니처 배선 — 해츨링(typeId 4 / 비트 21) 부화.
 *
 * ## 무엇을 막는가
 * 1. **배선 부재(이 저장소 8회 재발형)** — "단위 테스트는 전부 그린인데 world.ts 분기가 통째로
 *    없다". 그래서 아래 통합 케이스는 `Profile{typeId:4}` → `buildRunConfig` → `createWorld` →
 *    `stepWorld` 정규 경로를 실제로 굴려 **병아리 드론이 실제로 태어나는지**를 엔티티로 센다.
 * 2. **가짜 증거** — "typeId 0 런과 결과가 다르다" 는 **배선이 0줄이어도 이미 참**이다(baseBp 가
 *    damage/maxHp/moveSpeed 를 바꾸고 shipType 이 해시 꼬리에 접힌다). 그래서 정본 대조군은
 *    **시그니처 억제 동형 대조군**이다 — 같은 config 에서 `signatureOn` 의 2축(마스크·shipType)만
 *    눌러 시그니처 하나만 제거한 런.
 * 3. **반쪽 집계** — 처치 판정 경로는 총알·화염 지속피해·전격 연쇄·폭탄으로 갈리지만 집계는
 *    `compact()` 의 `state.kills++` 한 곳으로만 수렴한다. 배선이 그 정본 하나만 읽는다는 사실을
 *    "출격 스냅샷(aux0)이 항상 과거의 state.kills 값" 이라는 형태로 못 박는다.
 * 4. **되먹임 폭주** — 병아리가 잡은 적도 `state.kills` 에 들어간다. 동시 생존 상한이 없으면
 *    후반 프레임이 조용히 무너지므로 상한이 실제로 지켜지는지 잰다.
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
  SIG_HATCHLING_BROOD,
  HATCH_BASE_KILLS,
  HATCH_STEP_KILLS,
  HATCH_SCALE_KILLS,
  HATCH_MAX_KILLS,
  hatchThreshold,
} from '../src/sim/shipSignature.js';
import { zeroSkillInvest } from '../data/ships/index.js';

/**
 * world.ts 의 모듈 private 상한(`BROOD_MAX_DRONES`)과 같은 값. sim 내부 상수를 export 로
 * 끌어내지 않고 계약값만 여기 복제한다 — 배선이 상한을 올리면 이 케이스가 먼저 빨개진다.
 */
const BROOD_MAX_DRONES = 4;

// ---------------------------------------------------------------------------
// ① 순수 함수 골든 — 요구 처치 수 곡선
// ---------------------------------------------------------------------------

describe('해츨링 부화 — 순수 산술 골든', () => {
  it('누적 처치가 늘수록 요구치가 계단식으로 오르고 상한에서 평평해진다', () => {
    expect(hatchThreshold(0)).toBe(HATCH_BASE_KILLS);
    expect(hatchThreshold(HATCH_SCALE_KILLS - 1)).toBe(HATCH_BASE_KILLS);
    expect(hatchThreshold(HATCH_SCALE_KILLS)).toBe(HATCH_BASE_KILLS + HATCH_STEP_KILLS);
    expect(hatchThreshold(10_000)).toBe(HATCH_MAX_KILLS);
  });

  it('단조 비감소이며 항상 [BASE, MAX] 범위의 정수다', () => {
    let prev = 0;
    for (let k = 0; k <= 1200; k++) {
      const v = hatchThreshold(k);
      expect(Number.isInteger(v), `k=${k}`).toBe(true);
      expect(v).toBeGreaterThanOrEqual(HATCH_BASE_KILLS);
      expect(v).toBeLessThanOrEqual(HATCH_MAX_KILLS);
      expect(v, `k=${k}`).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
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
  kills: number;
  /** 이 런에서 새로 태어난 활성 아군 포탑(= 병아리) 수. */
  hatched: number;
  /** 동시 생존 활성 아군 포탑의 최대치(되먹임 상한 검증). */
  maxLiveDrones: number;
  /** 첫 출격이 일어난 틱(없으면 -1). */
  firstHatchTick: number;
  /** 출격 시점의 aux0 스냅샷 궤적. 항상 "그때의 state.kills" 여야 한다. */
  snapshots: number[];
  maxAux0: number;
  maxAux1: number;
  hashes: number[];
}

function runObserved(seed: number, cfg: WorldConfig, ticks: number): Observed {
  const state = createWorld(seed, { ...cfg, playerHp: DURABLE_HP });
  let maxAux0 = 0;
  let maxAux1 = 0;
  let hatched = 0;
  let maxLiveDrones = 0;
  let firstHatchTick = -1;
  let prevAux0 = 0;
  let prevIds = new Set<number>();
  const snapshots: number[] = [];
  const hashes: number[] = [];
  for (let i = 0; i < ticks; i++) {
    stepWorld(state, NEUTRAL);
    const p = state.entities[0]!;
    // 활성 아군 포탑 집계 — 신규 id 가 곧 이번 틱의 출격이다.
    const ids = new Set<number>();
    for (const e of state.entities) {
      if (e.kind !== 'turretPickup' || e.dead || e.phase !== 1) continue;
      ids.add(e.id);
      if (!prevIds.has(e.id)) hatched++;
    }
    if (ids.size > maxLiveDrones) maxLiveDrones = ids.size;
    prevIds = ids;
    if (p.aux0 !== prevAux0) {
      if (firstHatchTick < 0) firstHatchTick = i;
      snapshots.push(p.aux0);
      prevAux0 = p.aux0;
    }
    if (p.aux0 > maxAux0) maxAux0 = p.aux0;
    if (p.aux1 > maxAux1) maxAux1 = p.aux1;
    hashes.push(hashWorld(state));
  }
  return {
    kills: state.kills,
    hatched,
    maxLiveDrones,
    firstHatchTick,
    snapshots,
    maxAux0,
    maxAux1,
    hashes,
  };
}

describe('해츨링(typeId 4) 정규 경로 배선 — Profile → buildRunConfig → createWorld → stepWorld', () => {
  // 무대 선정도 계약의 일부다: 임계가 처치 수라 교전 밀도가 낮은 무대(행성1/티어1)는 5400틱을
  // 돌려도 12킬에 못 닿는다. 행성0/티어0 은 정지 파일럿으로도 500틱 안에 첫 임계를 넘긴다.
  //
  // ⚠️ SEED·TICKS 재측정(2026-07-26, PvE 밀도 2배 + 선분 판정 도입): 이전 증인 seed 555 는
  // 1800틱에 ctrl.kills 가 10 으로 떨어져 "공허 런 가드"(`ctrl.kills > HATCH_BASE_KILLS`=12)를
  // 못 넘겼다 — 밀도가 오르면 잡몹이 무리를 지어 서로 사거리를 가리므로(포위·차폐) 정지
  // 파일럿의 처치 속도가 **밀도와 반비례**할 수 있다(개체 수는 늘어도 명중 기회는 안 는다).
  // seed 9 는 3600틱에서 hatched=4·snapshots=[12,24,36,48]·ctrl.kills=24 로 여유 있게 통과한다
  // (이 값은 PVE_DENSITY_MULT 가 2 → 1.5 로 재조정된 뒤에도 동일하게 재확인했다 — 이 특정
  // 시드/무대는 이 스폰 카드 구성에서 두 배율 모두 같은 상한에 걸려 우연히 불변이었다).
  const STAGE = { planet: 0, stage: 1 } as const;
  const SEED = 9;
  // 임계 4회(12·24·36·48)까지 "반복 발현" 을 보려면 3600틱이 필요하다(1800틱으로는 부족).
  const TICKS = 3600;

  it('병아리가 실제로 출격한다 — 억제 대조군에는 아군 포탑이 하나도 없다', () => {
    const cfg = buildRunConfig(profileWithType(4), STAGE);
    expect(cfg.shipType).toBe(4);
    expect(hasCapstone(cfg.loadout?.uniqueMask ?? 0, SIG_HATCHLING_BROOD)).toBe(true);

    const live = runObserved(SEED, cfg, TICKS);
    const ctrl = runObserved(SEED, suppressSignature(cfg, SIG_HATCHLING_BROOD), TICKS);

    // 공허 런 가드 — 월드가 멈춰 있으면 이 케이스는 아무것도 증명하지 못한다.
    expect(new Set(live.hashes).size).toBeGreaterThan(900);
    expect(ctrl.kills).toBeGreaterThan(HATCH_BASE_KILLS);

    // 핵심 단언: 시그니처 하나만 제거하면 병아리가 사라진다(= 배선이 실제로 산 상태다).
    // 실측 기준선(seed 9 / p0t0 / 3600틱): 출격 4기 · 최종 aux0 48 · kills 49 vs 24.
    expect(live.hatched).toBeGreaterThanOrEqual(3);
    expect(ctrl.hatched).toBe(0);
    expect(live.firstHatchTick).toBeGreaterThan(0);

    // 병아리가 실제로 싸운다 — 같은 seed·무대에서 처치가 대조군보다 많다.
    expect(live.kills).toBeGreaterThan(ctrl.kills);

    // 억제 대조군은 aux 를 한 번도 건드리지 않는다(조건부 폴드 규약).
    expect(ctrl.maxAux0).toBe(0);
    expect(ctrl.maxAux1).toBe(0);
  });

  it('aux0 은 "마지막 출격 시점의 state.kills 스냅샷" 이다 — 사본이 아니라 정본을 읽는다', () => {
    const cfg = buildRunConfig(profileWithType(4), STAGE);
    const live = runObserved(SEED, cfg, TICKS);

    // 스냅샷은 단조 증가하고, 인접 스냅샷 간격이 그 시점의 요구치 이상이어야 한다.
    expect(live.snapshots.length).toBeGreaterThanOrEqual(3);
    let prev = 0;
    for (const s of live.snapshots) {
      expect(Number.isInteger(s)).toBe(true);
      expect(s - prev).toBeGreaterThanOrEqual(hatchThreshold(s));
      prev = s;
    }
    // 마지막 스냅샷은 런 누적 처치를 넘지 않는다(과거 값의 스냅샷이므로).
    expect(live.maxAux0).toBeLessThanOrEqual(live.kills);
    // aux1 은 해츨링이 쓰지 않는다 — 끝까지 0(슬롯 배정 계약).
    expect(live.maxAux1).toBe(0);
  });

  it('동시 생존 병아리가 상한을 넘지 않는다 (드론이 드론을 부르는 되먹임 방어)', () => {
    const cfg = buildRunConfig(profileWithType(4), STAGE);
    const live = runObserved(SEED, cfg, TICKS);
    expect(live.maxLiveDrones).toBeGreaterThan(0);
    expect(live.maxLiveDrones).toBeLessThanOrEqual(BROOD_MAX_DRONES);
  });

  it('스트라이커(typeId 0) 런은 aux 를 끝까지 0 으로 두고 병아리도 없다 (해시 폴드 불변)', () => {
    const striker = buildRunConfig(defaultProfile(), STAGE);
    const obs = runObserved(SEED, striker, 900);
    expect(obs.maxAux0).toBe(0);
    expect(obs.maxAux1).toBe(0);
    expect(obs.hatched).toBe(0);
    expect(new Set(obs.hashes).size).toBeGreaterThan(450);
  });

  it('같은 Profile 은 같은 해시 스트림을 낸다 (결정론 — ADR-0005, 소환은 RNG 미소비)', () => {
    const cfg = (): WorldConfig => buildRunConfig(profileWithType(4), STAGE);
    expect(runObserved(SEED, cfg(), 700).hashes).toEqual(runObserved(SEED, cfg(), 700).hashes);
  });
});
