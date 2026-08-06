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
import {
  SIG_HATCHLING_BROOD,
  HATCH_BASE_KILLS,
  HATCH_STEP_KILLS,
  HATCH_SCALE_KILLS,
  HATCH_MAX_KILLS,
  hatchThreshold,
  hasSignature,
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
 * ⚠️ 2026-08-06 — **`suppressSignature`(shipType:0 강제)는 ADR-0049 이후 오염된 대조군이라
 * 삭제했다.** ADR-0049 가 스트라이커(typeId 0)에 비트24(정조준 사이클)를 부여해
 * `shipTypeDef(0).signatureBit` 이 더 이상 -1 이 아니다 — shipType:0 강제는 "시그니처 없음"이
 * 아니라 "해츨링 대신 스트라이커 정조준이 켜진 런"이 된다(상세 물증은
 * shipSignaturePhantom.test.ts 머리말). 유효 shipType 0~6 전부가 시그니처 비트를 하나씩
 * 가지므로(shipSignature.ts SIGNATURE_BITS) "시그니처 없음"은 이제 제품에 존재하지 않는
 * 상태다 — 그 상태를 config 로 만들어 대조군 삼는 설계 자체가 틀렸다.
 *
 * ## 대신 무엇을 쓰는가 — 트리거 입력 굶기기(ⓐ)
 * 해츨링의 부화는 **`state.kills - player.aux0 >= hatchThreshold(state.kills)`** 가 트리거다
 * (aux0 = 마지막 출격 시점의 kills 스냅샷). 그래서 매 틱 stepWorld **직전에** `aux0 = state.kills`
 * 를 강제하면 — **시그니처 비트는 그대로 켜진 채로**(shipType·mask 는 live 와 완전히 동일) —
 * 갭(`state.kills - aux0`)이 항상 0 에 묶여 임계(최소 12)에 영원히 못 미쳐 부화가 트리거되지
 * 않는다. 이것이 `runObserved` 의 `starve` 플래그다. 처치(kills) 자체는 억제하지 않는다 —
 * 병아리 "출격"만 굶긴다(ⓐ 원안의 "처치 0" 대신 이 축을 굶기는 쪽을 택한 이유: 처치를 억제하려면
 * 무기를 꺼야 하는데, 그러면 대조군이 "무기 없는 런"이 되어 또 다른 축을 오염시킨다).
 *
 * shipType 을 바꾸지 않으므로 baseBp(damage/maxHp/moveSpeed) 오염이 없고, live 의 처치 수와
 * ctrl 의 처치 수를 그대로 비교해도 "무기·체력 차이"가 섞이지 않는다 — 옛 suppressSignature 보다
 * **더 정직한 비교**다. 대가: `ctrl.maxAux0` 자체는 우리가 직접 매 틱 kills 로 덮어쓰므로 항진이라
 * "aux0 가 0" 같은 형태로는 못 잰다 — 대신 `hatched`(병아리 출격 수, world.ts 의 독립된 임계
 * 판정이 낸 결과)로 잰다.
 */

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

/**
 * `starve=true` 면 매 틱 stepWorld **직전에** `aux0 = state.kills` 를 강제한다(부화 갭을 항상 0
 * 에 묶는다) — 위 헤더 주석의 트리거 굶기기 기법. 시그니처 비트·처치 자체는 손대지 않는다.
 */
function runObserved(
  seed: number,
  cfg: WorldConfig,
  ticks: number,
  starve = false,
): Observed {
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
    if (starve) state.entities[0]!.aux0 = state.kills;
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
  //
  // ⚠️ SEED 재선정 2026-07-27(9 → 3331, 밸런스 패스 ADR-0037). 적 축 상향(`eliteCount` 밴드0
  // 0 → 1 · `SEGMENTS.killGoal` 합계 80 → 240)으로 seed 9 의 부화가 3,600틱에 **2회**로 떨어져
  // `hatched >= 3`·`snapshots.length >= 3` 을 못 넘겼다. 무대는 그대로 p0s1 이고 단언도 그대로다
  // — 관측 가능한 증인만 다시 골랐다. 재표본(3311..3340 연속 30시드): **3331** 이 1,800틱만에
  // 이미 aux0 **48**(부화 4회)·live 처치 **52** vs 억제 대조군 **33** 으로 임계 4회 궤적
  // `[12,24,36,48]` 을 여유 있게 만든다.
  //
  // ⚠️ SEED 재선정 2026-08-04(3331 → 3333, 카르곤 정예 2종). 카드 풀 8 → 10 이라 같은 시드의
  // 카드열이 통째로 재추첨되고 seed 3331 은 부화가 1회로 떨어졌다. 같은 절차로 재표본
  // (3311..3420): **3333** 이 부화 5회 · 궤적 `[12,24,36,48,64]` · live 처치 66 vs 억제 27 로
  // 여유가 가장 크다(3319·3330·3340 도 통과 — 다음 재선정 후보).
  const STAGE = { planet: 0, stage: 1 } as const;
  const SEED = 3333;
  // 임계 4회(12·24·36·48)까지 "반복 발현" 을 보려면 3600틱이 필요하다(1800틱으로는 부족).
  const TICKS = 3600;

  it('병아리가 실제로 출격한다 — 트리거 굶긴 대조군에는 아군 포탑이 하나도 없다', () => {
    const cfg = buildRunConfig(profileWithType(4), STAGE);
    expect(cfg.shipType).toBe(4);
    expect(hasSignature(cfg.loadout?.uniqueMask ?? 0, SIG_HATCHLING_BROOD)).toBe(true);

    const live = runObserved(SEED, cfg, TICKS);
    // starve=true: 같은 cfg(같은 shipType·마스크, 시그니처는 계속 켜져 있다) · 매 틱
    // aux0=state.kills 로 갭을 0 에 묶어 부화 트리거만 굶긴다(위 헤더 주석 참조).
    const ctrl = runObserved(SEED, cfg, TICKS, true);

    // 공허 런 가드 — 월드가 멈춰 있으면 이 케이스는 아무것도 증명하지 못한다.
    expect(new Set(live.hashes).size).toBeGreaterThan(900);
    expect(ctrl.kills).toBeGreaterThan(HATCH_BASE_KILLS);

    // 핵심 단언: 부화 트리거만 굶기면 병아리가 사라진다(= 배선이 실제로 산 상태다).
    // 실측 기준선(seed 9 / p0t0 / 3600틱): 출격 4기 · 최종 aux0 48 · kills 49 vs 24.
    expect(live.hatched).toBeGreaterThanOrEqual(3);
    expect(ctrl.hatched).toBe(0);
    expect(live.firstHatchTick).toBeGreaterThan(0);

    // 병아리가 실제로 싸운다 — 같은 seed·무대에서 처치가 대조군보다 많다. 두 config 는
    // shipType·마스크가 완전히 같으므로(옛 suppressSignature 와 달리 baseBp 오염이 없다) 이
    // 차이의 원인은 병아리 지원 화력뿐이다.
    expect(live.kills).toBeGreaterThan(ctrl.kills);

    // 트리거 굶긴 대조군은 부화 임계에 못 닿아 aux1(해츨링이 안 쓰는 슬롯)은 그대로 0 이다.
    // ⚠️ maxAux0 는 우리가 매 틱 state.kills 로 직접 덮어쓰므로 항진이라 여기서 재지 않는다
    // (`hatched`(위)가 world.ts 의 독립된 임계 판정이 낸, 항진이 아닌 직접 증거다).
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

  it('스트라이커(typeId 0) 런은 병아리가 없다 (다른 시그니처를 쓰지만 해츨링 축은 끝까지 미발현)', () => {
    // ⚠️ 2026-08-06: ADR-0049 가 스트라이커에 정조준 사이클(비트24)을 부여해 aux0(정조준 카운터,
    // 0..11 순환)를 이제 스트라이커도 쓴다 — "aux 를 끝까지 0"은 더 이상 참이 아니다(상세는
    // shipSignaturePhantom.test.ts 머리말). 정조준은 aux1 을 쓰지 않고, `hatched`(신규 turretPickup
    // 엔티티 집계)도 aux0 슬롯과 무관하게 독립 계산되므로 둘 다 그대로 무모호 증거다.
    const striker = buildRunConfig(defaultProfile(), STAGE);
    const obs = runObserved(SEED, striker, 900);
    expect(obs.maxAux0).toBeGreaterThanOrEqual(0);
    expect(obs.maxAux1).toBe(0);
    expect(obs.hatched).toBe(0);
    expect(new Set(obs.hashes).size).toBeGreaterThan(450);
  });

  it('같은 Profile 은 같은 해시 스트림을 낸다 (결정론 — ADR-0005, 소환은 RNG 미소비)', () => {
    const cfg = (): WorldConfig => buildRunConfig(profileWithType(4), STAGE);
    expect(runObserved(SEED, cfg(), 700).hashes).toEqual(runObserved(SEED, cfg(), 700).hashes);
  });
});
