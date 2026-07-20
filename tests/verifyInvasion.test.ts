/**
 * verify-invasion 검증 코어 테스트 (M4 Phase D · D1 → **M7a 3레이어 · L6-verify-ef**).
 *
 * 침공 전수 재실행 검증 코어(`supabase/functions/verify-invasion/verifyInvasionCore.ts`)를
 * Node(vitest)에서 직접 구동한다 — 코어는 플랫폼 전역 무참조라 CI에서 그대로 돈다.
 * 정직한 제출은 accept, 침공 게이트(hashStream 필수·config.invasion3 필수·3레이어 배치
 * 정당성·입력 길이 상한)와 위조는 100% reject 됨을 게이트한다.
 *
 * ## 위조 reject 테스트를 하드코딩하지 않는 이유
 * 구 테스트는 "포탑 축소" "수호 성능" 처럼 **손으로 고른 케이스 목록**이었다. 그러면
 * 스키마에 필드가 추가될 때 목록 갱신을 잊는 순간 조용히 위조 프리패스가 생긴다(정찰이
 * `layoutEquals 확장 누락 = 보안 구멍`으로 지목한 위험). 그래서 여기서는
 * {@link enumerateLayerFields} / {@link mutateLayerField} 로 **스키마에서 케이스를 파생**한다 —
 * 필드가 늘면 테스트가 자동으로 커지고, 대조에 안 들어간 필드는 즉시 실패로 드러난다.
 */

import { describe, it, expect } from 'vitest';
import type { InputFrame, WorldConfig } from '../src/sim/world.js';
import { createWorld, stepWorld, SPECIAL_POWERUP_PICK } from '../src/sim/world.js';
import { runReplay } from '../src/sim/replay.js';
import {
  verifyInvasion,
  injectGuardianAuthority,
  performanceToCenti,
  resolveSnapshotAuthority,
  SNAPSHOT_FRESHNESS_MS,
} from '../supabase/functions/verify-invasion/verifyInvasionCore.js';
import type {
  InvasionServerContext,
  InvasionSnapshotRow,
  AuthoritativeGuardianRow,
} from '../supabase/functions/verify-invasion/verifyInvasionCore.js';
import {
  enumerateLayerFields,
  mutateLayerField,
  normalizeInvasionLayers,
  layersEqual,
} from '../src/sim/invasion/normalize.js';
import type { InvasionLayers, InvasionRef } from '../src/sim/invasion/types.js';
import {
  INVASION_CORE_HP,
  INVASION_CORE_MODULE_SLOTS,
  INVASION_GUARDIAN_SLOTS,
  INVASION_PROP_SLOTS,
  INVASION_SOCKET_COUNTS,
  INVASION_TOTAL_TICKS,
  INVASION_WAVE_SLOTS,
  MAP_TEMPLATE_STRAIGHT,
} from '../src/sim/invasion/constants.js';
import { FORMATION_COUNT } from '../data/invasion/formations.js';
import { FACILITY_CATALOG_COUNT } from '../data/invasion/facilities.js';
import { L3_PROP_COUNT } from '../data/invasion/props.js';
import { DEFAULT_DEFENSE_BOSS_ID } from '../data/invasion/defenseBosses.js';
import { GUARDIAN_TITAN, GUARDIAN_INTERCEPTOR, makeGuardianSnapshot } from '../data/guardian.js';
import { branchBonusBp, guardianMilestones, normalizeMilestones } from '../data/lineage.js';

/**
 * 구 단일 아레나 침공의 3분 예산(구 `DEFAULT_TIME_LIMIT_TICKS`). 상수를 담고 있던
 * `src/sim/defense.ts` 는 L11 에서 삭제됐지만, **구 클라이언트가 이 값을 그대로 보내면
 * 거부돼야 한다**는 계약은 살아 있어야 하므로 값만 여기에 박아 둔다(재도입 아님 — 거부 대상).
 */
const LEGACY_TIME_LIMIT_TICKS = 10800;

// ---------------------------------------------------------------------------
// 표본 배치 — 전 슬롯을 채운다(필드 전수 파생 커버리지를 위해 null 슬롯을 남기지 않는다)
// ---------------------------------------------------------------------------

function ref(catalogId: number, level: number, ascension: number, rarity: number): InvasionRef {
  return { catalogId, level, ascension, affixSeed: (catalogId * 2654435761) >>> 0, rarity };
}

/**
 * 전 슬롯이 채워진 3레이어 배치. **중간값**(레벨 40·승급 2·등급 2)을 쓴다 — 클램프 경계에
 * 붙여 두면 `mutateLayerField` 가 ±1 양방향 모두에서 정규화 후 같은 값이 되어 변조 케이스를
 * 만들지 못하는 필드가 생긴다.
 */
function fullLayers(): InvasionLayers {
  const waveSlots: InvasionRef[] = [];
  for (let i = 0; i < INVASION_WAVE_SLOTS; i++) waveSlots.push(ref(i % FORMATION_COUNT, 40, 2, 2));
  const socketCount = INVASION_SOCKET_COUNTS[MAP_TEMPLATE_STRAIGHT] ?? 0;
  const sockets: InvasionRef[] = [];
  for (let i = 0; i < socketCount; i++) sockets.push(ref(i % FACILITY_CATALOG_COUNT, 30, 1, 1));
  const props: InvasionRef[] = [];
  for (let i = 0; i < INVASION_PROP_SLOTS; i++) props.push(ref(i % L3_PROP_COUNT, 20, 1, 1));
  const guardians: unknown[] = [];
  for (let i = 0; i < INVASION_GUARDIAN_SLOTS; i++) {
    guardians.push({
      x: i === 0 ? -240 : 240,
      y: -160,
      snapshot: makeGuardianSnapshot(i === 0 ? GUARDIAN_TITAN : GUARDIAN_INTERCEPTOR, 140),
      performanceCP: 7500,
      lineageBonusBp: 1200,
      milestones: 3,
    });
  }
  const modules: InvasionRef[] = [];
  for (let i = 0; i < INVASION_CORE_MODULE_SLOTS; i++) modules.push(ref(i, 10, 1, 1));
  return normalizeInvasionLayers({
    l1: { waveSlots },
    l2: { templateId: MAP_TEMPLATE_STRAIGHT, sockets },
    l3: {
      boss: ref(DEFAULT_DEFENSE_BOSS_ID, 25, 1, 2),
      guardians,
      props,
      core: { hp: INVASION_CORE_HP, x: 0, y: 0 },
      modules,
    },
  });
}

function invasion3Config(layers: InvasionLayers, timeLimitTicks = INVASION_TOTAL_TICKS): WorldConfig {
  return {
    arenaWidth: 1920,
    arenaHeight: 1080,
    playerSpeed: 720,
    dashSpeed: 2800,
    dashCooldownTicks: 42,
    dashIframes: 10,
    hitIframes: 40,
    playerHp: 100,
    invasion3: { layers, timeLimitTicks },
  };
}

/**
 * 조종 입력 1프레임. `pendingLevelUp` 이면 레벨업 선택을 실어 프리즈를 푼다 — 안 그러면
 * stepWorld 가 월드를 정지시킨 채 tick 만 올려(world.ts) 런이 L2 에서 얼어붙는다.
 */
function pilotFrame(pendingLevelUp: boolean, i: number): InputFrame {
  return {
    moveX: Math.sin(i / 37),
    moveY: Math.cos(i / 53),
    aim: (i / 29) % 6.28,
    dash: i % 90 === 0,
    special: pendingLevelUp ? SPECIAL_POWERUP_PICK : 0,
  };
}

/** 라이브 런을 굴려 실제 클라이언트가 남길 법한 입력 로그를 기록한다(최대 n틱). */
function recordInputs(seed: number, config: WorldConfig, n: number): InputFrame[] {
  const state = createWorld(seed, config);
  const out: InputFrame[] = [];
  for (let i = 0; i < n; i++) {
    const frame = pilotFrame(state.pendingLevelUp, i);
    out.push(frame);
    stepWorld(state, frame);
    if (state.gameOver || state.victory) break;
  }
  return out;
}

interface Submission {
  seed: number;
  config?: WorldConfig;
  inputs: InputFrame[];
  claim: { finalHash: number; hashStream?: number[]; outcome: { victory: boolean; gameOver: boolean } };
}

function honest(seed: number, config: WorldConfig, inputs: InputFrame[]): Submission {
  const r = runReplay({ seed, config, inputs });
  return {
    seed,
    config,
    inputs,
    claim: {
      finalHash: r.finalHash >>> 0,
      hashStream: r.hashes.map((h) => h >>> 0),
      outcome: { victory: r.finalState.victory, gameOver: r.finalState.gameOver },
    },
  };
}

const SEED = 7;
const LAYERS = fullLayers();
const CFG = invasion3Config(LAYERS);
const INPUTS = recordInputs(SEED, CFG, 400);
const BASE = honest(SEED, CFG, INPUTS);
const CTX: InvasionServerContext = { layers: LAYERS, timeLimitTicks: INVASION_TOTAL_TICKS };

/** 재실행이 실제로 갈렸을 때 나올 수 있는 사유들(어느 지점에서 먼저 잡히든 거부면 통과). */
const DIVERGE = ['hash-stream-divergence', 'final-hash-mismatch', 'outcome-mismatch'];

describe('verify-invasion — 3레이어 정상 수락', () => {
  it('서버 권위 배치로 정직하게 제출하면 accept', () => {
    const res = verifyInvasion(BASE, CTX);
    expect(res.verdict).toBe('accept');
    expect(res.reason).toBe('verified');
  });

  it('DB 에 쓰레기가 섞여도(정규화 대상) 정직 침공은 accept — 클라·서버 단일 정규화', () => {
    // 클라이언트도 같은 normalizeInvasionLayers 를 쓰므로 정규형이 같으면 대조가 성립한다.
    const dirty = {
      l1: { waveSlots: [...LAYERS.l1.waveSlots, ref(0, 1, 0, 0), ref(1, 1, 0, 0)] }, // 슬롯 초과분
      l2: { templateId: MAP_TEMPLATE_STRAIGHT, sockets: LAYERS.l2.sockets },
      l3: { ...LAYERS.l3, junkField: 'ignored' },
      junkTop: 42,
    };
    const res = verifyInvasion(BASE, { layers: dirty, timeLimitTicks: INVASION_TOTAL_TICKS });
    expect(res.verdict).toBe('accept');
  });

  it('정비도 미지정 서버 컨텍스트는 완전 정비로 취급(하위호환)', () => {
    const res = verifyInvasion(BASE, { layers: LAYERS, timeLimitTicks: INVASION_TOTAL_TICKS });
    expect(res.verdict).toBe('accept');
  });
});

describe('verify-invasion — 침공 게이트', () => {
  it('hashStream 부재는 hash-stream-required', () => {
    const res = verifyInvasion({ ...BASE, claim: { finalHash: BASE.claim.finalHash, outcome: BASE.claim.outcome } }, CTX);
    expect(res).toMatchObject({ verdict: 'reject', reason: 'hash-stream-required' });
  });

  it('config 부재는 config-required', () => {
    const res = verifyInvasion({ seed: BASE.seed, inputs: BASE.inputs, claim: BASE.claim }, CTX);
    expect(res).toMatchObject({ verdict: 'reject', reason: 'config-required' });
  });

  it('invasion3 블록 부재는 invasion-config-required', () => {
    const { invasion3: _omit, ...noInv } = CFG;
    const res = verifyInvasion({ ...BASE, config: noInv as WorldConfig }, CTX);
    expect(res).toMatchObject({ verdict: 'reject', reason: 'invasion-config-required' });
  });

  it('layers 가 객체가 아니면 malformed-layout', () => {
    for (const bad of [null, 'x', 3, [] as unknown]) {
      const res = verifyInvasion(
        { ...BASE, config: { ...CFG, invasion3: { layers: bad, timeLimitTicks: INVASION_TOTAL_TICKS } } },
        CTX,
      );
      expect(res).toMatchObject({ verdict: 'reject', reason: 'malformed-layout' });
    }
  });

  it('제한 시간 조작은 defense-mismatch (시간 예산 3중 정합)', () => {
    const sub = {
      ...BASE,
      config: { ...CFG, invasion3: { layers: LAYERS, timeLimitTicks: INVASION_TOTAL_TICKS + 1 } },
    };
    expect(verifyInvasion(sub, CTX)).toMatchObject({ verdict: 'reject', reason: 'defense-mismatch' });
    // 구 3분 예산(10800)을 그대로 보낸 클라이언트도 거부된다.
    const stale = {
      ...BASE,
      config: { ...CFG, invasion3: { layers: LAYERS, timeLimitTicks: LEGACY_TIME_LIMIT_TICKS } },
    };
    expect(verifyInvasion(stale, CTX)).toMatchObject({ verdict: 'reject', reason: 'defense-mismatch' });
  });

  it('입력이 제한 시간 초과면 invasion-inputs-too-long', () => {
    // 게이트는 layersEqual 통과 후·재실행 전이라 입력 내용의 정직성과 무관하게 걸린다.
    const tooLong = new Array<InputFrame>(INVASION_TOTAL_TICKS + 1).fill(INPUTS[0]!);
    const res = verifyInvasion({ ...BASE, inputs: tooLong }, CTX);
    expect(res).toMatchObject({ verdict: 'reject', reason: 'invasion-inputs-too-long' });
    // 정확히 18000 은 통과(경계 off-by-one 가드) — 여기서는 길이 게이트만 보고 재실행 결과는
    // 발산이어도 무방하다(사유가 too-long 이 아니면 게이트가 안 걸린 것).
    const exact = new Array<InputFrame>(INVASION_TOTAL_TICKS).fill(INPUTS[0]!);
    expect(verifyInvasion({ ...BASE, inputs: exact }, CTX).reason).not.toBe('invasion-inputs-too-long');
  });

  it('구 침공 블록(config.invasion)을 얹어도 재실행 월드가 오염되지 않는다', () => {
    // 구 판은 "레거시 배치를 얹으면 재실행이 갈려 거부된다"를 봤다. L11 에서 구 경로(sim 의
    // `config.invasion` 소비)가 통째로 사라졌으므로 이제 그 키는 **아무 엔티티도 만들지
    // 못한다** — 공격 표면 자체가 없어진 것이다. 그래서 검증 방향을 뒤집는다: 구 키를 실어
    // 보내도 정직한 3레이어 런은 그대로 accept 되고(오거부 없음), 재실행 틱 수도 동일하다.
    // 이 등식이 깨지면 어딘가가 다시 구 키를 읽기 시작했다는 뜻이다.
    const cfgWithLegacy = {
      ...CFG,
      invasion: { layout: { core: { x: 5000, y: 5000 }, turrets: [{ type: 0, x: 4800, y: 5000 }] } },
    } as unknown as WorldConfig;
    const sub = honest(SEED, cfgWithLegacy, INPUTS);
    const res = verifyInvasion(sub, CTX);
    expect(res.verdict).toBe('accept');
    expect(res.computed?.ticks).toBe(BASE.claim.hashStream!.length);
  });
});

describe('verify-invasion — 위조 필드 전수 reject (스키마 파생)', () => {
  const fields = enumerateLayerFields(LAYERS);

  it('열거된 변조 지점이 스키마 규모에 걸맞게 충분하다', () => {
    // 회귀 가드: 열거가 조용히 빈 목록이 되면(경로 파싱 붕괴 등) 아래 전수 테스트가
    // 0건을 돌면서 통과해 버린다. 하한을 박아 그 상태를 실패로 만든다.
    expect(fields.length).toBeGreaterThan(100);
  });

  for (const field of fields) {
    it(`서버 권위가 다르면 defense-mismatch — ${field.kind}:${field.path}`, () => {
      const mutated = mutateLayerField(LAYERS, field);
      // null = 변조해도 정규형이 안 바뀌는 필드 = 위조 대조에서 의미가 없는 필드.
      // 그런 필드가 생기면 스키마·정규화 설계를 재검토해야 하므로 명시적으로 실패시킨다.
      expect(mutated, `변조 불가 필드: ${field.path}`).not.toBeNull();
      expect(layersEqual(mutated, LAYERS)).toBe(false);
      const res = verifyInvasion(BASE, { layers: mutated, timeLimitTicks: INVASION_TOTAL_TICKS });
      expect(res).toMatchObject({ verdict: 'reject', reason: 'defense-mismatch' });
    });
  }

  it('제출 배치를 변조해도(반대 방향) 전부 defense-mismatch', () => {
    for (const field of fields) {
      const mutated = mutateLayerField(LAYERS, field);
      expect(mutated).not.toBeNull();
      const sub = {
        ...BASE,
        config: { ...CFG, invasion3: { layers: mutated, timeLimitTicks: INVASION_TOTAL_TICKS } },
      };
      const res = verifyInvasion(sub, CTX);
      expect(res, `제출 변조 미검출: ${field.path}`).toMatchObject({
        verdict: 'reject',
        reason: 'defense-mismatch',
      });
    }
  });
});

describe('verify-invasion — 위조 4대 시나리오 거부 (AC2)', () => {
  it('① 조작된 최종 해시', () => {
    const res = verifyInvasion({ ...BASE, claim: { ...BASE.claim, finalHash: (BASE.claim.finalHash ^ 0x1) >>> 0 } }, CTX);
    expect(res.verdict).toBe('reject');
    expect(['final-hash-mismatch', 'hash-stream-divergence']).toContain(res.reason);
  });

  it('② 변조된 입력 로그', () => {
    const tampered = INPUTS.map((f) => ({ ...f }));
    const mid = Math.floor(tampered.length / 2);
    tampered[mid] = { ...tampered[mid]!, moveX: -tampered[mid]!.moveX, dash: true };
    const res = verifyInvasion({ ...BASE, inputs: tampered }, CTX);
    expect(res.verdict).toBe('reject');
    expect(['final-hash-mismatch', 'hash-stream-divergence']).toContain(res.reason);
  });

  it('③ 트림된(짧은) 로그', () => {
    const res = verifyInvasion({ ...BASE, inputs: INPUTS.slice(0, INPUTS.length - 50) }, CTX);
    expect(res.verdict).toBe('reject');
    expect(['hash-stream-length-mismatch', 'final-hash-mismatch']).toContain(res.reason);
  });

  it('④ 조작된 결과(승패 뒤집기)', () => {
    const res = verifyInvasion(
      { ...BASE, claim: { ...BASE.claim, outcome: { victory: !BASE.claim.outcome.victory, gameOver: BASE.claim.outcome.gameOver } } },
      CTX,
    );
    expect(res).toMatchObject({ verdict: 'reject', reason: 'outcome-mismatch' });
  });

  it('정비도 위조(방치 기지를 완전 정비라 주장)는 재실행 발산으로 거부', () => {
    const weathered: InvasionServerContext = { layers: LAYERS, timeLimitTicks: INVASION_TOTAL_TICKS, maintenance: 0 };
    const res = verifyInvasion(BASE, weathered);
    expect(res.verdict).toBe('reject');
    expect(DIVERGE).toContain(res.reason);
  });
});

describe('verify-invasion — 수호 권위 주입 (경로 l3.guardians)', () => {
  const rows: AuthoritativeGuardianRow[] = [
    { data: makeGuardianSnapshot(GUARDIAN_TITAN, 140), performance: 60 },
    { data: makeGuardianSnapshot(GUARDIAN_INTERCEPTOR, 90), performance: 75 },
  ];
  const LEVEL = 10;

  it('슬롯 위치는 보존하고 성능·계보 보너스·마일스톤은 DB 권위로 덮는다', () => {
    const injected = injectGuardianAuthority(LAYERS, rows, LEVEL) as { l3: { guardians: unknown[] } };
    const g = injected.l3.guardians as ({ x: number; y: number; performanceCP: number; lineageBonusBp: number; milestones: number } | null)[];
    expect(g).toHaveLength(INVASION_GUARDIAN_SLOTS);
    expect(g[0]!.x).toBe(-240);
    expect(g[1]!.x).toBe(240);
    expect(g[0]!.performanceCP).toBe(performanceToCenti(60));
    expect(g[1]!.performanceCP).toBe(performanceToCenti(75));
    expect(g[0]!.lineageBonusBp).toBe(branchBonusBp(LEVEL));
    expect(g[0]!.milestones).toBe(normalizeMilestones(guardianMilestones(LEVEL)));
  });

  it('활성 수호가 없으면 전 슬롯이 비고, 슬롯 i ↔ 수호 i 매핑이 유지된다', () => {
    const none = injectGuardianAuthority(LAYERS, [], LEVEL) as { l3: { guardians: unknown[] } };
    expect(none.l3.guardians).toEqual([null, null]);
    const one = injectGuardianAuthority(LAYERS, [rows[0]!], LEVEL) as { l3: { guardians: unknown[] } };
    expect(one.l3.guardians[0]).not.toBeNull();
    expect(one.l3.guardians[1]).toBeNull();
  });

  it('권위 주입 배치로 정직 제출하면 accept, 저장된 위조 주장으로 제출하면 defense-mismatch', () => {
    const authoritative = injectGuardianAuthority(LAYERS, rows, LEVEL);
    const authLayers = normalizeInvasionLayers(authoritative);
    const ctx: InvasionServerContext = { layers: authLayers, timeLimitTicks: INVASION_TOTAL_TICKS };
    const authCfg = invasion3Config(authLayers);
    const authInputs = recordInputs(SEED, authCfg, 300);
    expect(verifyInvasion(honest(SEED, authCfg, authInputs), ctx).verdict).toBe('accept');
    // 공격자가 저장 layers(성능 7500·보너스 1200 주장)를 그대로 제출 → 서버 권위와 갈린다.
    expect(verifyInvasion(BASE, ctx)).toMatchObject({ verdict: 'reject', reason: 'defense-mismatch' });
  });

  it('배치가 객체가 아니면 원본을 그대로 돌려준다(방어적)', () => {
    expect(injectGuardianAuthority(null, rows, LEVEL)).toBeNull();
    expect(injectGuardianAuthority(7, rows, LEVEL)).toBe(7);
  });
});

describe('verify-invasion — 권위 스냅샷 해석 (레이스 B)', () => {
  const nowMs = 1_000_000_000_000;
  const snapLayers = LAYERS;
  const goodSnap: InvasionSnapshotRow = {
    attackerId: 'atk-1',
    defenseId: 'def-1',
    authorityLayers: snapLayers,
    authorityMaintenanceDb: 80,
    authorityCard: null,
    createdAtMs: nowMs - 60_000,
  };
  const baseParams = {
    invasionSnapshotId: 'snap-1',
    invasionAttackerId: 'atk-1',
    invasionDefenseId: 'def-1',
    snapshot: goodSnap,
    nowMs,
    reused: false,
  };

  it('유효 스냅샷은 스냅샷 권위(layers·maintenance)를 돌려준다', () => {
    const res = resolveSnapshotAuthority(baseParams);
    expect(res).toMatchObject({ source: 'snapshot', layers: snapLayers, maintenanceDb: 80 });
  });

  it.each([
    ['snapshot_id 없음', { invasionSnapshotId: null }, 'no-snapshot-id'],
    ['행 부재', { snapshot: null }, 'snapshot-missing'],
    ['소유권 불일치(attacker)', { invasionAttackerId: 'atk-9' }, 'ownership-mismatch'],
    ['소유권 불일치(defense)', { invasionDefenseId: 'def-9' }, 'ownership-mismatch'],
    ['재사용', { reused: true }, 'reused'],
  ])('%s → 라이브 폴백(%#)', (_label, patch, reason) => {
    const res = resolveSnapshotAuthority({ ...baseParams, ...(patch as object) });
    expect(res).toMatchObject({ source: 'live', reason });
  });

  it('신선도 1시간 경계: +0ms 는 스냅샷, +1ms 는 라이브 폴백', () => {
    const edge = { ...baseParams, snapshot: { ...goodSnap, createdAtMs: nowMs - SNAPSHOT_FRESHNESS_MS } };
    expect(resolveSnapshotAuthority(edge).source).toBe('snapshot');
    const stale = { ...baseParams, snapshot: { ...goodSnap, createdAtMs: nowMs - SNAPSHOT_FRESHNESS_MS - 1 } };
    expect(resolveSnapshotAuthority(stale)).toMatchObject({ source: 'live', reason: 'stale' });
  });
});

describe('verify-invasion — 재실행 CPU 예산 (인프라 리스크 게이트)', () => {
  /**
   * EF `SOFT_RERUN_BUDGET_MS`(verify-invasion/index.ts) 와 같은 값. 이 게이트가 깨지면
   * Supabase Edge Runtime 이 재실행 도중 끊겨 **정직한 침공이 검증 불능**이 된다(재실행은
   * 동기 루프라 중단·재개가 없다). 3레이어 콘텐츠가 늘어날 때 가장 먼저 울려야 하는 알람이다.
   */
  const RERUN_BUDGET_MS = 20_000;

  it(
    '전 슬롯 채운 배치로 18000틱 정직 런을 서버가 재실행해도 예산 안이고 accept',
    () => {
      // 플레이어 HP 를 크게 잡아 **18000틱 전부**를 실제로 돌게 한다. 기본 HP 로는 1.2만 틱쯤에
      // 격추돼 런이 짧아지고, 그러면 "예산 안"이 최악 케이스를 증명하지 못한다.
      const fullCfg: WorldConfig = { ...invasion3Config(LAYERS, INVASION_TOTAL_TICKS), playerHp: 1e9 };
      const inputs = recordInputs(SEED, fullCfg, INVASION_TOTAL_TICKS);
      expect(inputs.length).toBe(INVASION_TOTAL_TICKS);
      const sub = honest(SEED, fullCfg, inputs);
      const started = Date.now();
      const res = verifyInvasion(sub, CTX);
      const elapsed = Date.now() - started;
      expect(res.verdict).toBe('accept');
      expect(res.computed?.ticks).toBe(INVASION_TOTAL_TICKS);
      // 실측치는 개발기 기준 1초 미만(리포트: npx vite-node src/bench/simBench.ts --invasion3).
      // 20초는 Edge Runtime 이 개발기보다 수 배 느릴 여지를 포함한 상한이다.
      expect(elapsed, `18000틱 재실행 ${elapsed}ms`).toBeLessThan(RERUN_BUDGET_MS);
    },
    120_000,
  );
});
