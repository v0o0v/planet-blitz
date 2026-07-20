/**
 * 침공 런 시뮬 테스트 — M4 plan Phase C1/C2 · AC13 → **M7a 3레이어 이식(L11-legacy-purge)**.
 *
 * ## 이 파일의 내력
 * 원본은 구 단일 아레나 침공(`src/sim/defense.ts` — 포탑 6종·15×9 격자·배치 포인트 예산제)을
 * 검증했다. L11 에서 그 경로를 삭제하면서, **의미가 살아 있는 케이스만 3레이어 스키마로
 * 이식**했다:
 *   - 결정론(AC13) → 3레이어 배치 리플레이 2회 실행 해시 스트림 일치.
 *   - 승패 판정 → 코어 파괴 = victory(단 L3 코어방에서만).
 *   - 정비도(풍화, ADR-0006) → 순수 산술 + 해시 하위호환 + 성능 저하 실증(L2 설비 발사량).
 *   - PvE 해시 불변 회귀 가드 → `config.invasion3` 부재 경로.
 *
 * ## 삭제한 케이스와 그 이유
 *   - "createWorld 가 코어·포탑·장애물을 배치대로 정적 스폰" — `DefenseLayout`(core/turrets/
 *     obstacles) 자체가 사라졌다. 3레이어의 정적 스폰(회랑 벽·소켓 설비·코어방)은
 *     `tests/invasionIntegration.test.ts` 가 정규 경로(createWorld→stepWorld)로 커버한다.
 *   - "포탑 6종 발사 스모크" — TURRET_VULCAN..TURRET_TESLA 유형 자체가 폐기됐다. 후신인 설비
 *     카탈로그의 거동은 `tests/invasionFacility.test.ts` 가 사계·예고선까지 포함해 검증한다.
 *   - "제한 시간 초과 = 패배" — 3레이어는 hard 상한이 INVASION_TOTAL_TICKS 하나로 바뀌었고
 *     `tests/invasionIntegration.test.ts` 가 정확히 18000틱 경계로 검증한다(중복 제거).
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, packPowerupPick, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { InputFrame, WorldState, WorldConfig } from '../src/sim/world.js';
import { runReplay, hashWorld } from '../src/sim/replay.js';
import type { Replay } from '../src/sim/replay.js';
import {
  INVASION_TOTAL_TICKS,
  PHASE_L2,
  PHASE_L3,
  normalizeInvasionLayers,
} from '../src/sim/invasion/index.js';
import type { InvasionLayers } from '../src/sim/invasion/types.js';
import { enterFacilityLayer } from '../src/sim/invasion/facility.js';
import { enterCoreRoom } from '../src/sim/invasion/coreRoom.js';
import { makeInvasionContext } from '../src/sim/invasion/step.js';
import {
  MAINTENANCE_FULL,
  normalizeMaintenance,
  scaleFireCooldown,
} from '../src/sim/invasion/guardian.js';

const idle: InputFrame = emptyInput();

/** 카탈로그 n번 lv1 노말 참조(정규화를 통과하는 최소 Ref). */
function ref(catalogId: number) {
  return { catalogId, level: 1, ascension: 0, affixSeed: 1, rarity: 0 };
}

/** 전 레이어에 콘텐츠가 실린 배치(빈 슬롯은 기본 수비대가 스폰 단계에서 충원한다). */
function filledLayers(): InvasionLayers {
  return normalizeInvasionLayers({
    l1: { waveSlots: [ref(0), ref(1), ref(2), null, null, null] },
    l2: { templateId: 0, sockets: [ref(0), ref(1), ref(2), ref(3), null, null] },
    l3: { boss: ref(0), guardians: [null, null], props: [ref(0), ref(1), null, null, null, null] },
  });
}

function invasionConfig(
  layers: InvasionLayers,
  timeLimitTicks = INVASION_TOTAL_TICKS,
  maintenance?: number,
): WorldConfig {
  const config = { ...DEFAULT_CONFIG } as WorldConfig;
  config.invasion3 =
    maintenance === undefined ? { layers, timeLimitTicks } : { layers, timeLimitTicks, maintenance };
  return config;
}

function countKind(state: WorldState, kind: string): number {
  let n = 0;
  for (const e of state.entities) if (e.kind === kind && !e.dead) n++;
  return n;
}

/**
 * 특정 페이즈에서 시작하는 침공 월드. 3레이어 런은 L1→L2→L3 순차 진행이라, 한 레이어의 거동만
 * 격리해 관찰하려면 페이즈를 직접 세우고 그 레이어의 진입 훅을 한 번 호출해야 한다
 * (`tests/lineageMilestones.test.ts` 의 coreRoomWorld 와 같은 규약).
 */
function layerWorld(seed: number, phase: number, config: WorldConfig): WorldState {
  const w = createWorld(seed, config);
  w.entities.length = 1; // index 0 = player (hashWorld 불변식)
  w.invasion3!.phase = phase === PHASE_L2 ? PHASE_L2 : PHASE_L3;
  w.invasion3!.phaseEnterTick = 0;
  const ctx = makeInvasionContext(w.config.invasion3!, w.invasion3!);
  if (phase === PHASE_L2) enterFacilityLayer(w, ctx);
  else enterCoreRoom(w, ctx);
  return w;
}

/** 레벨업 프리즈를 풀며 1틱 진행한다(선택을 소비하지 않으면 런이 그 자리에 얼어붙는다). */
function step(state: WorldState, input: InputFrame = idle): void {
  stepWorld(state, state.pendingLevelUp ? { ...input, special: packPowerupPick(0) } : input);
}

// ---------------------------------------------------------------------------
// 결정론 (AC13)
// ---------------------------------------------------------------------------

describe('침공 런 — 결정론 (AC13)', () => {
  it('동일 3레이어 리플레이 2회 실행이 틱별 해시 스트림 100% 일치', () => {
    // 움직임·조준을 섞은 입력 로그(정적/idle 이 아닌 실제 런 근사).
    const inputs: InputFrame[] = [];
    for (let i = 0; i < 600; i++) {
      inputs.push({
        moveX: Math.sin(i / 40),
        moveY: Math.cos(i / 55),
        aim: (i / 30) % 6.28,
        dash: i % 90 === 0,
        special: 0,
      });
    }
    const replay: Replay = { seed: 7, config: invasionConfig(filledLayers()), inputs };
    const a = runReplay(replay);
    const b = runReplay(replay);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.finalHash).toBe(b.finalHash);
    expect(a.hashes.length).toBe(600);
  });
});

// ---------------------------------------------------------------------------
// 승패 판정
// ---------------------------------------------------------------------------

describe('침공 런 — 승패 판정 (plan C2)', () => {
  it('L3 코어방에서 코어를 부수면 승리(victory) 확정', () => {
    // 보스·기물 없이 저내구 코어만 플레이어 사거리 안에 둔다 — 플레이어 자동 조준이 코어를
    // 격파하는 경로만 남겨 승리 판정을 격리한다.
    //
    // `boss: null` 은 '보스 없음'이 아니라 **기본 수비대 충원 대상**이라 코어방 진입 시
    // 방어 보스가 1기 선다(coreRoom 폴백). 그래서 격리를 실제로 성립시키려면 진입 후 그
    // 보스를 치워야 한다. 예전에는 방어 보스가 `isPlayerTargetable` 에서 빠져 있어 자동
    // 조준이 무시했기 때문에 치우지 않아도 우연히 격리가 성립했다 — 조준 3목록을 맞추면서
    // 그 우연이 사라졌다(보스가 정상적으로 표적 경쟁을 한다). 여기서 지우는 것은 이 테스트가
    // 재려는 대상(승리 판정)이 아니라 교란 요인이다.
    const layers = normalizeInvasionLayers({
      l3: { boss: null, guardians: [], props: [], core: { hp: 400, x: 400, y: 0 }, modules: [] },
    });
    const state = layerWorld(3, PHASE_L3, invasionConfig(layers));
    for (const e of state.entities) if (e.kind === 'defenseBoss') e.dead = true;
    let victoryTick = -1;
    for (let i = 0; i < 6000; i++) {
      step(state);
      if (state.victory) {
        victoryTick = i;
        break;
      }
    }
    expect(state.victory).toBe(true);
    expect(state.gameOver).toBe(false);
    expect(victoryTick).toBeGreaterThan(0);
    expect(countKind(state, 'core')).toBe(0); // 코어 소멸
  });
});

// ---------------------------------------------------------------------------
// 정비도(풍화, ADR-0006)
// ---------------------------------------------------------------------------

describe('침공 정비도(풍화, ADR-0006) — 성능 스케일 + 결정론', () => {
  /** 전 슬롯 빈 정규형 — 기본 수비대 충원분만으로 L2 설비 발사를 관찰한다. */
  const emptyLayers = normalizeInvasionLayers(undefined);

  /**
   * L2 회랑에서 `ticks` 동안 설비가 만든 적탄의 **누적 개수**. 적탄은 수명으로 소멸하므로
   * 순간 개수로는 발사량을 못 잰다 — id 는 단조 증가라 집합 크기가 총 발사 수와 같다.
   */
  function shotsOverRun(maintenance: number | undefined, ticks: number): number {
    const state = layerWorld(9, PHASE_L2, invasionConfig(emptyLayers, INVASION_TOTAL_TICKS, maintenance));
    const ids = new Set<number>();
    for (let i = 0; i < ticks; i++) {
      step(state);
      for (const e of state.entities) if (e.kind === 'enemyBullet') ids.add(e.id);
    }
    return ids.size;
  }

  it('scaleFireCooldown: 100%→base, 0%→2×base, 중간값 선형(정수·결정론)', () => {
    expect(scaleFireCooldown(12, MAINTENANCE_FULL)).toBe(12); // 완전 정비 = 무변화
    expect(scaleFireCooldown(12, 0)).toBe(24); // 성능 50% → 간격 2배
    expect(scaleFireCooldown(100, 0)).toBe(200);
    expect(scaleFireCooldown(100, 5000)).toBe(133); // round(100*20000/15000)=133.33→133
    // 순수 함수: 같은 입력 2회 동일(정수 연산이라 자명하지만 회귀 가드).
    expect(scaleFireCooldown(90, 2500)).toBe(scaleFireCooldown(90, 2500));
  });

  it('normalizeMaintenance: 미지정·비유한·범위 밖을 정수 도메인으로 클램프', () => {
    expect(normalizeMaintenance(undefined)).toBe(MAINTENANCE_FULL);
    expect(normalizeMaintenance(Number.NaN)).toBe(MAINTENANCE_FULL);
    expect(normalizeMaintenance(Number.POSITIVE_INFINITY)).toBe(MAINTENANCE_FULL);
    expect(normalizeMaintenance(-5)).toBe(0);
    expect(normalizeMaintenance(999999)).toBe(MAINTENANCE_FULL);
    expect(normalizeMaintenance(5000.9)).toBe(5000); // 정수화(trunc)
  });

  it('미지정 정비도 == 명시 100%(MAINTENANCE_FULL): 해시 스트림 완전 일치', () => {
    // append-only 안전성: 정비도 필드가 없는 침공 config 와, 명시적으로 완전 정비를 준 config
    // 가 거동·해시 모두 비트 동일이어야 한다(기존 침공 런 회귀 0).
    const inputs: InputFrame[] = [];
    for (let i = 0; i < 250; i++) {
      inputs.push({ moveX: Math.sin(i / 20), moveY: 0, aim: (i / 25) % 6.28, dash: false, special: 0 });
    }
    const layers = filledLayers();
    const omitted = runReplay({ seed: 7, config: invasionConfig(layers), inputs });
    const full = runReplay({
      seed: 7,
      config: invasionConfig(layers, INVASION_TOTAL_TICKS, MAINTENANCE_FULL),
      inputs,
    });
    expect(omitted.hashes).toEqual(full.hashes);
  });

  it('정비도가 다르면 해시가 발산(위조 방어: 방치 기지를 100% 주장 불가)', () => {
    const inputs: InputFrame[] = [];
    for (let i = 0; i < 250; i++) {
      inputs.push({ moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 });
    }
    const layers = filledLayers();
    const full = runReplay({
      seed: 7,
      config: invasionConfig(layers, INVASION_TOTAL_TICKS, MAINTENANCE_FULL),
      inputs,
    });
    const decayed = runReplay({
      seed: 7,
      config: invasionConfig(layers, INVASION_TOTAL_TICKS, 0),
      inputs,
    });
    // 최종 해시가 반드시 달라야 한다(정비도가 발사 간격 → 엔티티 상태에 반영).
    expect(decayed.finalHash).not.toBe(full.finalHash);
  });

  it('같은 정비도(중간값)면 2회 실행이 틱별 해시 100% 일치(결정론)', () => {
    const inputs: InputFrame[] = [];
    for (let i = 0; i < 300; i++) {
      inputs.push({ moveX: Math.cos(i / 33), moveY: Math.sin(i / 44), aim: (i / 20) % 6.28, dash: i % 70 === 0, special: 0 });
    }
    const cfg = invasionConfig(filledLayers(), INVASION_TOTAL_TICKS, 3750);
    const a = runReplay({ seed: 7, config: cfg, inputs });
    const b = runReplay({ seed: 7, config: cfg, inputs });
    expect(a.hashes).toEqual(b.hashes);
  });

  it('정비도 0%(성능 50%)는 100%보다 적게 발사한다(성능 저하 실증)', () => {
    const ticks = 600;
    const shotsFull = shotsOverRun(MAINTENANCE_FULL, ticks);
    const shotsDecayed = shotsOverRun(0, ticks);
    expect(shotsFull).toBeGreaterThan(0);
    // 발사 간격이 2배가 되므로 발사량이 뚜렷이 줄어야 한다(대략 절반 수준).
    expect(shotsDecayed).toBeLessThan(shotsFull);
  });
});

// ---------------------------------------------------------------------------
// PvE 회귀 가드
// ---------------------------------------------------------------------------

describe('침공 config 부재 시 PvE 해시 불변 (회귀 가드)', () => {
  it('invasion3 없는 config 는 hashWorld 가 침공 블록을 접지 않는다(조건부 접기)', () => {
    // 같은 시드·같은 절차의 PvE 런은 침공 대개편과 무관하게 결정론적이어야 한다. 침공 조건부
    // 접기가 PvE 경로를 건드리지 않음을 두 독립 런의 해시 스트림 일치로 확인한다.
    const a = createWorld(42);
    const b = createWorld(42);
    for (let i = 0; i < 300; i++) {
      stepWorld(a, idle);
      stepWorld(b, idle);
      expect(hashWorld(a)).toBe(hashWorld(b));
    }
    expect(a.config.invasion3).toBeUndefined();
    expect(a.invasion3).toBeUndefined();
  });
});
