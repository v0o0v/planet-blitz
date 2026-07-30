/**
 * verify-invasion 검증 코어 — Deno 검증 + 위조/조작 거부 러너 (M7a 침공 3레이어 · ADR-0017).
 *
 * verify-run 러너(verifyRun.ts)의 침공판. `tests/verifyInvasion.test.ts` 와 **같은 계약을
 * 다른 런타임(Deno/V8)** 에서 굴려 EF 코어가 Node 와 비트 동일하게 판정하는지를 증거화한다.
 * 두 파일은 원래 동형이며, 여기서는 교차 런타임 증거로서 의미 있는 최소 집합만 유지한다:
 *   (정상)   서버 권위 3레이어 배치로 정직하게 제출하면 accept.
 *   (게이트) hashStream 필수 · `config.invasion3` 필수 · 배치가 서버 값과 정확히 일치 ·
 *            입력 길이가 18000틱 이내.
 *   (위조)   스키마에서 파생한 변조 지점 전수 거부(양방향) · 조작 해시 · 변조 입력 ·
 *            트림 로그 · 승패 뒤집기.
 *   (권위)   수호 권위 주입(고정 길이 2 · 위치 매핑 · 마일스톤) · 스냅샷 해석 5분기.
 *
 * 실행: `deno task verify-invasion` (scripts/deno-verify 에서). sloppy-imports 로
 * `.js → .ts` resolve. 불일치 시 종료 코드 1.
 */

import {
  verifyInvasion,
  injectGuardianAuthority,
  performanceToCenti,
  resolveSnapshotAuthority,
  SNAPSHOT_FRESHNESS_MS,
} from '../../supabase/functions/verify-invasion/verifyInvasionCore.ts';
import type {
  InvasionServerContext,
  AuthoritativeGuardianRow,
  InvasionSnapshotRow,
} from '../../supabase/functions/verify-invasion/verifyInvasionCore.ts';
import { branchBonusBp, guardianMilestones, normalizeMilestones } from '../../data/lineage.ts';
import { runReplay } from '../../src/sim/replay.ts';
import {
  createWorld,
  stepWorld,
  SPECIAL_POWERUP_PICK,
  SPECIAL_ACTIVE_SLOT1,
  SPECIAL_ACTIVE_SLOT2,
} from '../../src/sim/world.ts';
import { wireIdOf } from '../../data/ships/actives/index.ts';
import type { InputFrame, WorldConfig } from '../../src/sim/world.ts';
import {
  enumerateLayerFields,
  mutateLayerField,
  normalizeInvasionLayers,
} from '../../src/sim/invasion/normalize.ts';
import type { InvasionLayers, InvasionRef } from '../../src/sim/invasion/types.ts';
import {
  INVASION_CORE_HP,
  INVASION_CORE_MODULE_SLOTS,
  INVASION_GUARDIAN_SLOTS,
  INVASION_PROP_SLOTS,
  INVASION_SOCKET_COUNTS,
  INVASION_TOTAL_TICKS,
  INVASION_WAVE_SLOTS,
  MAP_TEMPLATE_STRAIGHT,
} from '../../src/sim/invasion/constants.ts';
import { FORMATION_COUNT } from '../../data/invasion/formations.ts';
import { FACILITY_CATALOG_COUNT } from '../../data/invasion/facilities.ts';
import { L3_PROP_COUNT } from '../../data/invasion/props.ts';
import { DEFAULT_DEFENSE_BOSS_ID } from '../../data/invasion/defenseBosses.ts';
import {
  GUARDIAN_TITAN,
  GUARDIAN_INTERCEPTOR,
  makeGuardianSnapshot,
} from '../../data/guardian.ts';

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

// ---------------------------------------------------------------------------
// 표본 배치 — 전 슬롯을 채운다(위조 파생 커버리지를 위해 null 슬롯을 남기지 않는다)
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
 * stepWorld 가 월드를 정지시킨 채 tick 만 올려 런이 레이어 하나에서 얼어붙는다(측정 무의미).
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
  claim: {
    finalHash: number;
    hashStream?: number[];
    outcome: { victory: boolean; gameOver: boolean };
  };
}

/** 정직한 침공 제출(서버 재실행 결과를 그대로 주장 — hashStream 포함, accept 되어야 정상). */
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

/** 재실행이 실제로 갈렸을 때 나올 수 있는 사유들(어느 지점에서 먼저 잡히든 거부면 통과). */
const DIVERGE = ['hash-stream-divergence', 'final-hash-mismatch', 'outcome-mismatch'];

function main(): number {
  console.log(`${CYAN}=== verify-invasion 검증 코어 — 3레이어 Deno 검증 + 위조 거부 ===${RESET}`);
  console.log(`${DIM}Deno ${Deno.version.deno} / V8 ${Deno.version.v8}${RESET}\n`);

  let failures = 0;
  const seed = 7;
  const layers = fullLayers();
  const cfg = invasion3Config(layers);
  const inputs = recordInputs(seed, cfg, 400);
  const ctx: InvasionServerContext = { layers, timeLimitTicks: INVASION_TOTAL_TICKS };
  const base = honest(seed, cfg, inputs);

  function expectAccept(label: string, sub: unknown, c: InvasionServerContext = ctx): void {
    const res = verifyInvasion(sub, c);
    if (res.verdict === 'accept') {
      console.log(`${GREEN}PASS${RESET} ${label}  ${DIM}accept ticks=${res.computed?.ticks}${RESET}`);
    } else {
      failures++;
      console.log(`${RED}FAIL${RESET} ${label}: 정직한 제출이 reject(${res.reason})`);
    }
  }
  function expectReject(
    label: string,
    sub: unknown,
    expected: readonly string[],
    c: InvasionServerContext = ctx,
  ): void {
    const res = verifyInvasion(sub, c);
    if (res.verdict === 'reject' && expected.includes(res.reason ?? '')) {
      console.log(`${GREEN}PASS${RESET} ${label}  ${DIM}reason=${res.reason}${RESET}`);
    } else {
      failures++;
      console.log(
        `${RED}FAIL${RESET} ${label}: verdict=${res.verdict} reason=${res.reason} (기대 ${expected.join('|')})`,
      );
    }
  }
  function check(label: string, ok: boolean, detail = ''): void {
    if (ok) {
      console.log(`${GREEN}PASS${RESET} ${label}`);
    } else {
      failures++;
      console.log(`${RED}FAIL${RESET} ${label}${detail === '' ? '' : `: ${detail}`}`);
    }
  }

  // --- 정상: 서버 권위 배치로 정직하게 제출 → accept ---
  expectAccept('정직한 3레이어 침공 제출', base);

  // --- 게이트 1: hashStream 필수화 ---
  expectReject(
    'hashStream 부재',
    { ...base, claim: { finalHash: base.claim.finalHash, outcome: base.claim.outcome } },
    ['hash-stream-required'],
  );

  // --- 게이트 2: config.invasion3 필수 ---
  expectReject('config 부재', { seed: base.seed, inputs: base.inputs, claim: base.claim }, [
    'config-required',
  ]);
  expectReject(
    'invasion3 블록 부재',
    { ...base, config: { ...cfg, invasion3: undefined } as WorldConfig },
    ['invasion-config-required'],
  );

  // --- 게이트 3: 정규화 대칭(DB 에 쓰레기가 섞여도 정직 런은 accept) ---
  // 클라·서버가 같은 normalizeInvasionLayers 를 쓰므로, 서버 raw 에 범위 밖 값이 있어도 정규형이
  // 같으면 accept 되어야 한다(정규화 갈림으로 인한 오거부 0).
  const dirty = {
    ...(layers as unknown as Record<string, unknown>),
    l2: {
      templateId: MAP_TEMPLATE_STRAIGHT,
      // 소켓 배열 뒤에 초과분을 붙인다 → 정규화가 잘라 내 원본과 같은 정규형이 된다.
      sockets: [...layers.l2.sockets, ref(0, 1, 0, 0), ref(1, 1, 0, 0)],
    },
  };
  expectAccept('서버 배치 정규화 대칭(초과 슬롯 절단)', base, {
    layers: dirty,
    timeLimitTicks: INVASION_TOTAL_TICKS,
  });

  // --- 게이트 4: 시간 예산 3중 일치 ---
  expectReject(
    '제한 시간 조작(18000 아님)',
    {
      ...base,
      config: { ...cfg, invasion3: { layers, timeLimitTicks: INVASION_TOTAL_TICKS + 1 } },
    },
    ['defense-mismatch'],
  );
  {
    const tooLong = new Array<InputFrame>(INVASION_TOTAL_TICKS + 1).fill(inputs[0]!);
    expectReject(
      `입력 ${INVASION_TOTAL_TICKS + 1}틱(상한 초과)`,
      { ...base, inputs: tooLong },
      ['invasion-inputs-too-long'],
    );
  }

  // --- 게이트 5: 위조 전수 거부(스키마 파생 — 하드코딩 목록 없음) ---
  // 필드가 늘면 케이스가 자동으로 늘고, 열거가 조용히 비면 하한 가드가 잡는다.
  {
    const fields = enumerateLayerFields(layers);
    check(
      `위조 변조 지점 열거(${fields.length}개)`,
      fields.length > 100,
      `열거가 ${fields.length}개뿐 — 파생이 끊겼다`,
    );
    let bad = 0;
    for (const f of fields) {
      const mutated = mutateLayerField(layers, f);
      // ① 서버 권위만 변조 — 정직 제출이 서버 값과 어긋난다.
      const a = verifyInvasion(base, { layers: mutated, timeLimitTicks: INVASION_TOTAL_TICKS });
      // ② 제출만 변조 — 약화된 가짜 방어를 얹은 제출.
      const b = verifyInvasion(
        { ...base, config: { ...cfg, invasion3: { layers: mutated, timeLimitTicks: INVASION_TOTAL_TICKS } } },
        ctx,
      );
      if (a.verdict !== 'reject' || a.reason !== 'defense-mismatch') bad++;
      else if (b.verdict !== 'reject' || b.reason !== 'defense-mismatch') bad++;
    }
    check(`위조 ${fields.length}지점 × 양방향 전수 거부`, bad === 0, `${bad}건이 통과했다`);
  }

  // --- 게이트 6: 구 invasion 블록 부착이 재실행 월드를 오염시키지 않는다 ---
  // L11 에서 구 단일 아레나 침공(`config.invasion` 소비 경로)이 sim 에서 통째로 삭제됐다 —
  // 이제 그 키는 어떤 엔티티도 만들지 못하므로 EF 가 따로 떼어낼 필요가 없다. 여기서 재는 것은
  // "구 키를 실어 보내도 정직한 3레이어 런이 오거부되지 않는가"다.
  {
    const withLegacy = {
      ...base,
      config: {
        ...cfg,
        invasion: { layout: { core: { x: 0, y: 0 }, turrets: [], obstacles: [] }, timeLimitTicks: 10800 },
      } as WorldConfig,
    };
    const res = verifyInvasion(withLegacy, ctx);
    check(
      '구 invasion 블록을 얹어도 재실행이 오염되지 않는다(accept)',
      res.verdict === 'accept',
      `verdict=${res.verdict} reason=${res.reason}`,
    );
  }

  // --- 게이트 7: 정비도(풍화) 반영·발산(ADR-0006) ---
  {
    const weathered: InvasionServerContext = {
      layers,
      timeLimitTicks: INVASION_TOTAL_TICKS,
      maintenance: 0,
    };
    const wCfg: WorldConfig = {
      ...cfg,
      invasion3: { layers, timeLimitTicks: INVASION_TOTAL_TICKS, maintenance: 0 },
    };
    const wInputs = recordInputs(seed, wCfg, 300);
    expectAccept('정비도 반영 정직 침공(풍화 0%)', honest(seed, wCfg, wInputs), weathered);
    // 완전 정비로 계산한 base 를 풍화 0% 서버로 검증 → 재실행 거동 상이 → 발산.
    expectReject('정비도 불일치(완전정비 런 vs 풍화 서버)', base, DIVERGE, weathered);
  }

  // --- 게이트 8: 수호 권위 주입(SQL·EF·클라 3자 계약) ---
  {
    const dbRows: AuthoritativeGuardianRow[] = [
      { data: makeGuardianSnapshot(GUARDIAN_TITAN, 140), performance: 60 },
      { data: makeGuardianSnapshot(GUARDIAN_INTERCEPTOR, 90), performance: 75 },
    ];
    const guardianLevel = 10;
    const authLayers = injectGuardianAuthority(layers, dbRows, guardianLevel) as InvasionLayers;
    const g = authLayers.l3.guardians;
    check(
      '수호 주입 배열은 고정 길이 2(밀집화 금지)',
      g.length === INVASION_GUARDIAN_SLOTS,
      `length=${g.length}`,
    );
    const expectBonus = branchBonusBp(guardianLevel);
    const expectMs = normalizeMilestones(guardianMilestones(guardianLevel));
    check(
      '성능·계보 보너스·마일스톤이 DB 권위로 덮이고 슬롯 좌표는 보존된다',
      g[0]?.performanceCP === performanceToCenti(60) &&
        g[1]?.performanceCP === performanceToCenti(75) &&
        g[0]?.lineageBonusBp === expectBonus &&
        g[1]?.lineageBonusBp === expectBonus &&
        g[0]?.milestones === expectMs &&
        g[1]?.milestones === expectMs &&
        g[0]?.x === -240 &&
        g[1]?.x === 240,
      JSON.stringify(g.map((p) => (p === null ? null : { x: p.x, cp: p.performanceCP, ms: p.milestones }))),
    );
    // 활성 수호가 1기면 슬롯 0 만 채우고 슬롯 1 은 null 로 남는다(위치 매핑 — 밀집화하면
    // 2기 중 1기만 있는 중간 상태에서 SQL·EF·클라가 갈린다).
    const oneRow = injectGuardianAuthority(layers, [dbRows[0]!], guardianLevel) as InvasionLayers;
    check(
      '활성 수호 1기 → [placement, null] (위치 매핑)',
      oneRow.l3.guardians.length === INVASION_GUARDIAN_SLOTS &&
        oneRow.l3.guardians[0] !== null &&
        oneRow.l3.guardians[1] === null,
      JSON.stringify(oneRow.l3.guardians),
    );
    // 정직: 공격자가 서버 권위 주입 배치로 런·제출 → accept.
    const authCfg = invasion3Config(normalizeInvasionLayers(authLayers));
    const authCtx: InvasionServerContext = { layers: authLayers, timeLimitTicks: INVASION_TOTAL_TICKS };
    const authInputs = recordInputs(seed, authCfg, 300);
    expectAccept('수호 권위 주입 후 정직 침공(Node↔Deno)', honest(seed, authCfg, authInputs), authCtx);
    // --- 액티브 스킬을 쓴 침공(ADR-0041 · 완료 게이트 ③) ---
    // 위 케이스들은 전부 `activeSlots` 미탑재라 **신규 꼬리 폴드가 한 번도 실행되지 않는다** —
    // 그게 구 EF 하위 호환의 근거인 동시에 신규 경로의 커버리지가 0 이라는 뜻이다.
    // 서버가 액티브를 모르면 재실행 해시가 갈려 `final-hash-mismatch` 로 **거부**되므로,
    // 여기서 accept 가 나오는 것 자체가 "재배포된 검증 코어가 액티브 발동을 재현한다"의 증명이다.
    const activeCfg: WorldConfig = {
      ...authCfg,
      shipType: 1, // 브루저 — aux0(장갑 스택) 쓰기까지 같은 런에서 밟힌다
      activeSlots: [wireIdOf('as_bruiser_blade_lo'), wireIdOf('as_bruiser_fortify_lo')],
    };
    const activeInputs = recordInputs(seed, activeCfg, 300).map((f, i) => {
      // 프리즈 프레임에는 액티브 비트를 싣지 않는다(컨트롤러 규율과 동일).
      if ((f.special & SPECIAL_POWERUP_PICK) !== 0) return f;
      let special = f.special;
      if (i > 0 && i % 60 === 0) special |= SPECIAL_ACTIVE_SLOT1;
      if (i > 0 && i % 90 === 0) special |= SPECIAL_ACTIVE_SLOT2;
      return special === f.special ? f : { ...f, special };
    });
    expectAccept(
      '액티브 스킬 발동 침공 — 검증 코어가 꼬리 폴드 2건을 재현한다 (완료 게이트 ③)',
      honest(seed, activeCfg, activeInputs),
      authCtx,
    );
    // 위조: 공격자가 저장 위조 배치(풀성능·풀보너스)로 런·제출 → 권위 주입본과 대조 → 거부.
    expectReject('수호 성능·보너스 위조 제출', base, ['defense-mismatch'], authCtx);
  }

  // --- 게이트 9: 침공 권위 스냅샷 해석(소유권·신선도·재사용 5분기) ---
  {
    const nowMs = 1_000_000_000_000;
    const snapLayers = layers as unknown;
    const goodSnap: InvasionSnapshotRow = {
      attackerId: 'atk-1',
      defenseId: 'def-1',
      authorityLayers: snapLayers,
      authorityMaintenanceDb: 80,
      card: undefined,
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
    const ok = resolveSnapshotAuthority(baseParams);
    check(
      '스냅샷 정상 경로(소유권·신선·미재사용)',
      ok.source === 'snapshot' && ok.layers === snapLayers && ok.maintenanceDb === 80,
      JSON.stringify(ok),
    );
    const liveCases: readonly [string, Parameters<typeof resolveSnapshotAuthority>[0], string][] = [
      ['snapshot_id 없음', { ...baseParams, invasionSnapshotId: null }, 'no-snapshot-id'],
      ['스냅샷 행 부재', { ...baseParams, snapshot: null }, 'snapshot-missing'],
      ['소유권 불일치(attacker)', { ...baseParams, invasionAttackerId: 'atk-9' }, 'ownership-mismatch'],
      ['소유권 불일치(defense)', { ...baseParams, invasionDefenseId: 'def-9' }, 'ownership-mismatch'],
      [
        '신선도 초과(스테일)',
        { ...baseParams, snapshot: { ...goodSnap, createdAtMs: nowMs - SNAPSHOT_FRESHNESS_MS - 1 } },
        'stale',
      ],
      [
        'created_at 손상',
        { ...baseParams, snapshot: { ...goodSnap, createdAtMs: Number.NaN } },
        'stale',
      ],
      ['스냅샷 재사용', { ...baseParams, reused: true }, 'reused'],
    ];
    for (const [label, params, reason] of liveCases) {
      const res = resolveSnapshotAuthority(params);
      check(
        `스냅샷 폴백 — ${label}`,
        res.source === 'live' && res.reason === reason,
        JSON.stringify(res),
      );
    }
  }

  // --- 위조 4대 시나리오(AC2) ---
  expectReject(
    '① 조작된 최종 해시',
    { ...base, claim: { ...base.claim, finalHash: (base.claim.finalHash ^ 0x1) >>> 0 } },
    ['final-hash-mismatch', 'hash-stream-divergence'],
  );
  {
    const tampered = inputs.map((f) => ({ ...f }));
    const mid = Math.floor(tampered.length / 2);
    tampered[mid] = { ...tampered[mid]!, moveX: -tampered[mid]!.moveX, dash: true };
    expectReject('② 변조된 입력 로그', { ...base, inputs: tampered }, [
      'final-hash-mismatch',
      'hash-stream-divergence',
    ]);
  }
  expectReject('③ 트림된(짧은) 로그', { ...base, inputs: inputs.slice(0, inputs.length - 50) }, [
    'hash-stream-length-mismatch',
    'final-hash-mismatch',
  ]);
  expectReject(
    '④ 조작된 결과(승패 뒤집기)',
    {
      ...base,
      claim: {
        ...base.claim,
        outcome: { victory: !base.claim.outcome.victory, gameOver: base.claim.outcome.gameOver },
      },
    },
    ['outcome-mismatch'],
  );

  console.log('');
  if (failures === 0) {
    console.log(`${GREEN}=== 전체 통과: 3레이어 침공 정상 accept + 게이트/위조 100% 거부 ===${RESET}`);
    return 0;
  }
  console.log(`${RED}=== ${failures}건 실패 ===${RESET}`);
  return 1;
}

Deno.exit(main());
