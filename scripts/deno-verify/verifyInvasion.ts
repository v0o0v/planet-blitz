/**
 * verify-invasion 검증 코어 — Deno 검증 + 위조/조작 거부 러너 (M4 Phase D · D1 · AC2).
 *
 * verify-run 러너(verifyRun.ts)의 침공판. 다음을 Deno 에서 증거화한다:
 *   (정상)   서버 권위 방어 배치로 정직하게 제출하면 accept.
 *   (게이트) 침공은 hashStream 필수 · config.invasion 필수 · 방어 배치가 서버 값과
 *            정확히 일치해야 함(약화된 가짜 방어 거부) · 입력이 제한 시간 이내여야 함.
 *   (위조)   조작 해시 · 변조 입력 · 트림 로그 · 승패 뒤집기 100% 거부.
 *
 * 실행: `deno task verify-invasion` (scripts/deno-verify 에서). sloppy-imports 로
 * `.js → .ts` resolve. 불일치 시 종료 코드 1.
 */

import {
  verifyInvasion,
  injectGuardianAuthority,
  performanceToCenti,
} from '../../supabase/functions/verify-invasion/verifyInvasionCore.ts';
import type {
  InvasionServerContext,
  AuthoritativeGuardianRow,
} from '../../supabase/functions/verify-invasion/verifyInvasionCore.ts';
import { branchBonusBp } from '../../data/lineage.ts';
import { runReplay } from '../../src/sim/replay.ts';
import type { InputFrame, WorldConfig } from '../../src/sim/world.ts';
import {
  DEFAULT_TIME_LIMIT_TICKS,
  MAINTENANCE_FULL,
  TURRET_VULCAN,
  TURRET_SNIPER,
  TURRET_SHOTGUN,
} from '../../src/sim/defense.ts';
import type { DefenseLayout } from '../../src/sim/defense.ts';
import {
  GUARDIAN_TITAN,
  GUARDIAN_INTERCEPTOR,
  PERFORMANCE_FULL,
  makeGuardianSnapshot,
} from '../../data/guardian.ts';

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

const SERVER_LAYOUT: DefenseLayout = {
  core: { x: 900, y: 0 },
  turrets: [
    { type: TURRET_VULCAN, x: 400, y: -150 },
    { type: TURRET_SNIPER, x: 500, y: 200 },
    { type: TURRET_SHOTGUN, x: 250, y: 0 },
  ],
  obstacles: [{ x: 450, y: 0, halfW: 50, halfH: 120 }],
};

function invasionConfig(
  layout: DefenseLayout,
  timeLimitTicks = DEFAULT_TIME_LIMIT_TICKS,
  maintenance?: number,
): WorldConfig {
  return {
    arenaWidth: 1920,
    arenaHeight: 1080,
    playerSpeed: 720,
    dashSpeed: 2800,
    dashCooldownTicks: 42,
    dashIframes: 10,
    hitIframes: 40,
    playerHp: 100,
    invasion: { layout, timeLimitTicks, maintenance },
  };
}

function buildInputs(n: number): InputFrame[] {
  const out: InputFrame[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      moveX: Math.sin(i / 40),
      moveY: Math.cos(i / 55),
      aim: (i / 30) % 6.28,
      dash: i % 90 === 0,
      special: 0,
    });
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

function main(): number {
  console.log(`${CYAN}=== verify-invasion 검증 코어 — Deno 검증 + 위조/조작 거부 ===${RESET}`);
  console.log(`${DIM}Deno ${Deno.version.deno} / V8 ${Deno.version.v8}${RESET}\n`);

  let failures = 0;
  const seed = 7;
  const inputs = buildInputs(400);
  const cfg = invasionConfig(SERVER_LAYOUT);
  const ctx: InvasionServerContext = { layout: SERVER_LAYOUT, timeLimitTicks: DEFAULT_TIME_LIMIT_TICKS };
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
  function expectReject(label: string, sub: unknown, expected: readonly string[], c: InvasionServerContext = ctx): void {
    const res = verifyInvasion(sub, c);
    if (res.verdict === 'reject' && expected.includes(res.reason)) {
      console.log(`${GREEN}PASS${RESET} ${label}  ${DIM}reason=${res.reason}${RESET}`);
    } else {
      failures++;
      console.log(
        `${RED}FAIL${RESET} ${label}: verdict=${res.verdict} reason=${res.reason} (기대 ${expected.join('|')})`,
      );
    }
  }

  // --- 정상: 서버 권위 배치로 정직하게 제출 → accept ---
  expectAccept('정직한 침공 제출', base);

  // --- 게이트 1: hashStream 필수화 ---
  const noStream: Submission = { ...base, claim: { finalHash: base.claim.finalHash, outcome: base.claim.outcome } };
  expectReject('hashStream 부재', noStream, ['hash-stream-required']);

  // --- 게이트 2: config.invasion 필수 ---
  const noConfig: Submission = { seed: base.seed, inputs: base.inputs, claim: base.claim };
  expectReject('config 부재', noConfig, ['config-required']);
  const noInvasion: Submission = { ...base, config: { ...cfg, invasion: undefined } as WorldConfig };
  expectReject('invasion 블록 부재', noInvasion, ['invasion-config-required']);

  // --- 게이트 3: 방어 배치 정당성(약화된 가짜 방어 거부) ---
  const weakerLayout: DefenseLayout = {
    ...SERVER_LAYOUT,
    turrets: [{ type: TURRET_VULCAN, x: 400, y: -150 }], // 포탑 3→1로 약화
  };
  const weakerSub = honest(seed, invasionConfig(weakerLayout), inputs); // 약화 배치로 정직 재현
  expectReject('약화된 가짜 방어(포탑 축소)', weakerSub, ['defense-mismatch']);
  // 제한 시간 조작도 defense-mismatch.
  const timeSub = honest(seed, invasionConfig(SERVER_LAYOUT, DEFAULT_TIME_LIMIT_TICKS + 100), inputs);
  expectReject('제한 시간 조작', timeSub, ['defense-mismatch']);

  // --- 게이트 3.5: 서버 layout 정규화 대칭(리뷰 MED-3) ---
  // DB layout 에 정규화 대상 쓰레기(범위 밖 유형·비유한 좌표·halfW<=0)가 섞여 있어도,
  // 클라이언트가 normalizeLayout 본으로 런·제출한 정직 침공은 accept 되어야 한다.
  const dirtyServerLayout = {
    core: { x: 900, y: 0 },
    turrets: [
      { type: TURRET_VULCAN, x: 400, y: -150 },
      { type: 99, x: 1, y: 1 }, // 범위 밖 유형 → 클라·서버 모두 드롭
      { type: TURRET_SNIPER, x: 500, y: 200 },
      { type: TURRET_SHOTGUN, x: 250, y: 0 },
      { type: TURRET_VULCAN, x: Number.NaN, y: 3 }, // 비유한 좌표 → 드롭
    ],
    obstacles: [
      { x: 450, y: 0, halfW: 50, halfH: 120 },
      { x: 1, y: 1, halfW: 0, halfH: 10 }, // halfW<=0 → 드롭
    ],
    guardianSlots: [{ id: 'm5' }], // 대조·해시 대상 아님
  };
  // 정규화 결과 = SERVER_LAYOUT 과 동일 → 기존 정직 제출(base)이 dirty 컨텍스트에서도 accept.
  expectAccept('서버 layout 정규화 대칭(쓰레기 항목 필터)', base, {
    layout: dirtyServerLayout,
    timeLimitTicks: DEFAULT_TIME_LIMIT_TICKS,
  });
  // 정규화 불능(코어 좌표 손상) → server-layout-invalid.
  expectReject('손상된 서버 layout', base, ['server-layout-invalid'], {
    layout: { core: { x: 'broken', y: 0 }, turrets: [], obstacles: [] },
    timeLimitTicks: DEFAULT_TIME_LIMIT_TICKS,
  });

  // --- 게이트 3.7: 정비도(풍화) 반영·발산(ADR-0006, Phase E EF 배선) ---
  // 서버 재실행은 server.maintenance 로 포탑 발사 간격을 스케일한다(0%→2배 느림). 따라서:
  //  (정상) 클라가 서버 정비도(0%)와 동일 정비도로 런·제출 → 재실행 해시 일치 → accept.
  //  (발산) 클라가 완전 정비(base=풍화 미반영)로 런했는데 서버는 0% → 재실행 거동 상이 →
  //         hashStream 발산으로 거부. 이 배선이 없으면 서버가 항상 완전 정비로 돌아
  //         풍화가 검증에 반영되지 않는다(Phase E 완결 조건).
  const ctxWeathered: InvasionServerContext = {
    layout: SERVER_LAYOUT,
    timeLimitTicks: DEFAULT_TIME_LIMIT_TICKS,
    maintenance: 0, // 완전 방치(0%) → 포탑 발사 간격 2배
  };
  const honestWeathered = honest(seed, invasionConfig(SERVER_LAYOUT, DEFAULT_TIME_LIMIT_TICKS, 0), inputs);
  expectAccept('정비도 반영 정직 침공(풍화 0%)', honestWeathered, ctxWeathered);
  // 완전 정비로 계산한 base(maintenance 미지정=MAINTENANCE_FULL)를 풍화 0% 서버로 검증 → 발산.
  expectReject('정비도 불일치(완전정비 런 vs 풍화 서버)', base, [
    'hash-stream-divergence',
    'final-hash-mismatch',
    'outcome-mismatch',
  ], ctxWeathered);
  // 역방향 대칭 확인: 완전 정비 서버에는 base(완전 정비 런)가 정상 accept(하위호환 — maintenance
  // 미지정 컨텍스트는 MAINTENANCE_FULL 로 정규화되어 기존 거동 불변).
  expectAccept('완전 정비 서버(하위호환)', base, {
    layout: SERVER_LAYOUT,
    timeLimitTicks: DEFAULT_TIME_LIMIT_TICKS,
    maintenance: MAINTENANCE_FULL,
  });

  // --- 게이트 3.8: M5 수호 기체(AC2 서버 재현·Node↔Deno 결정론) ---
  // 수호 2기 포함 방어전을 서버 권위 배치로 정직 제출 → accept(수호 AI 추적·사격이 Deno
  // 에서도 Node 와 bit-identical 재현). 위조(성능·스냅샷)는 defense-mismatch.
  const guardianLayout: DefenseLayout = {
    ...SERVER_LAYOUT,
    guardians: [
      { x: 350, y: -100, snapshot: makeGuardianSnapshot(GUARDIAN_TITAN, 140), performanceCP: PERFORMANCE_FULL, lineageBonusBp: 1200 },
      { x: 400, y: 150, snapshot: makeGuardianSnapshot(GUARDIAN_INTERCEPTOR, 90), performanceCP: 7500, lineageBonusBp: 800 },
    ],
  };
  const gCtx: InvasionServerContext = { layout: guardianLayout, timeLimitTicks: DEFAULT_TIME_LIMIT_TICKS };
  const gSub = honest(seed, invasionConfig(guardianLayout), inputs);
  expectAccept('수호 기체 포함 정직 침공(Node↔Deno)', gSub, gCtx);
  // 성능 위조(방치 수호를 신선하다 주장).
  const forgedPerf: DefenseLayout = {
    ...guardianLayout,
    guardians: [guardianLayout.guardians![0]!, { ...guardianLayout.guardians![1]!, performanceCP: PERFORMANCE_FULL }],
  };
  expectReject('수호 성능 위조', honest(seed, invasionConfig(forgedPerf), inputs), ['defense-mismatch'], gCtx);

  // --- 게이트 3.9: M5 수호 권위 주입(DB → 서버 layout, 정비도 주입과 대칭) ---
  // index.ts 배선이 저장 layout 의 수호 슬롯을 라이브 DB(guardians.performance·profiles.
  // lineage_guardian_level)로 덮어쓴다. 여기서는 그 순수 주입 함수와 대조 계약을 증거화한다.
  const dbRows: AuthoritativeGuardianRow[] = [
    { data: makeGuardianSnapshot(GUARDIAN_TITAN, 140), performance: 60 }, // 서버 풍화 60%
    { data: makeGuardianSnapshot(GUARDIAN_INTERCEPTOR, 90), performance: 75 }, // 서버 풍화 75%
  ];
  const guardianLevel = 10; // branchBonusBp(10)=floor(5000*10/30)=1666
  // 저장 layout(defenses.layout): 슬롯 위치 + 공격자가 주장하는 위조 성능/보너스(풀성능·풀보너스).
  const storedForgedLayout: DefenseLayout = {
    ...SERVER_LAYOUT,
    guardians: [
      { x: 350, y: -100, snapshot: makeGuardianSnapshot(GUARDIAN_TITAN, 140), performanceCP: PERFORMANCE_FULL, lineageBonusBp: 5000 },
      { x: 400, y: 150, snapshot: makeGuardianSnapshot(GUARDIAN_INTERCEPTOR, 90), performanceCP: PERFORMANCE_FULL, lineageBonusBp: 5000 },
    ],
  };
  const authoritativeLayout = injectGuardianAuthority(storedForgedLayout, dbRows, guardianLevel) as DefenseLayout;
  // 단위 검증: 성능·보너스가 DB 권위로 덮이고 슬롯 위치는 보존되는가.
  const expectBonus = branchBonusBp(guardianLevel);
  {
    const g0 = authoritativeLayout.guardians?.[0];
    const g1 = authoritativeLayout.guardians?.[1];
    const ok =
      g0 !== undefined && g1 !== undefined &&
      g0.performanceCP === performanceToCenti(60) && g1.performanceCP === performanceToCenti(75) &&
      g0.lineageBonusBp === expectBonus && g1.lineageBonusBp === expectBonus &&
      g0.x === 350 && g0.y === -100 && g1.x === 400 && g1.y === 150;
    if (ok) {
      console.log(`${GREEN}PASS${RESET} 수호 권위 주입 단위(성능·보너스 덮어쓰기·위치 보존)`);
    } else {
      failures++;
      console.log(`${RED}FAIL${RESET} 수호 권위 주입 단위: ${JSON.stringify(authoritativeLayout.guardians)}`);
    }
  }
  const authCtx: InvasionServerContext = { layout: authoritativeLayout, timeLimitTicks: DEFAULT_TIME_LIMIT_TICKS };
  // 정직: 공격자가 서버 권위 주입 layout 으로 런·제출 → accept.
  expectAccept('수호 권위 주입 후 정직 침공', honest(seed, invasionConfig(authoritativeLayout), inputs), authCtx);
  // 위조: 공격자가 저장 위조 layout(풀성능·풀보너스)으로 런·제출 → 서버는 권위 주입 layout(풍화
  // 60/75%·계보 1666bp)으로 대조 → defense-mismatch(방치 수호를 신선·풀보너스라 주장한 위조 거부).
  expectReject('수호 권위 주입 vs 위조 제출', honest(seed, invasionConfig(storedForgedLayout), inputs), ['defense-mismatch'], authCtx);
  // 하위호환: 수호 슬롯 없는 방어(SERVER_LAYOUT)는 활성 수호 DB 가 있어도 주입 생략 → guardians 미포함.
  const noSlotInject = injectGuardianAuthority(SERVER_LAYOUT, dbRows, guardianLevel) as DefenseLayout;
  if (noSlotInject.guardians === undefined) {
    console.log(`${GREEN}PASS${RESET} 수호 슬롯 없으면 주입 생략(하위호환)`);
  } else {
    failures++;
    console.log(`${RED}FAIL${RESET} 수호 슬롯 없음인데 guardians 주입됨`);
  }

  // --- 게이트 4: 입력 길이 상한(제한 시간 초과) ---
  const shortCtx: InvasionServerContext = { layout: SERVER_LAYOUT, timeLimitTicks: 200 };
  const longInputs = buildInputs(300);
  const longSub = honest(seed, invasionConfig(SERVER_LAYOUT, 200), longInputs);
  expectReject('입력이 제한 시간 초과', longSub, ['invasion-inputs-too-long'], shortCtx);

  // --- 위조 4대 시나리오(AC2) ---
  expectReject(
    '① 조작된 최종 해시',
    { ...base, claim: { ...base.claim, finalHash: (base.claim.finalHash ^ 0x1) >>> 0 } },
    ['final-hash-mismatch', 'hash-stream-divergence'],
  );
  const tampered = inputs.map((f) => ({ ...f }));
  const mid = Math.floor(tampered.length / 2);
  tampered[mid] = { ...tampered[mid]!, moveX: -tampered[mid]!.moveX, dash: true };
  expectReject('② 변조된 입력 로그', { ...base, inputs: tampered }, [
    'final-hash-mismatch',
    'hash-stream-divergence',
  ]);
  expectReject('③ 트림된(짧은) 로그', { ...base, inputs: inputs.slice(0, inputs.length - 50) }, [
    'hash-stream-length-mismatch',
    'final-hash-mismatch',
  ]);
  expectReject(
    '④ 조작된 결과(승패 뒤집기)',
    { ...base, claim: { ...base.claim, outcome: { victory: !base.claim.outcome.victory, gameOver: base.claim.outcome.gameOver } } },
    ['outcome-mismatch'],
  );

  console.log('');
  if (failures === 0) {
    console.log(`${GREEN}=== 전체 통과: 침공 검증 정상 accept + 게이트/위조 100% 거부 ===${RESET}`);
    return 0;
  }
  console.log(`${RED}=== ${failures}건 실패 ===${RESET}`);
  return 1;
}

Deno.exit(main());
