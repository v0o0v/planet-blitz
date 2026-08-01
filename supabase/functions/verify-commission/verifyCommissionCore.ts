/**
 * verify-commission 검증 코어 (의뢰서 서버 축, 서버 계약 rev3 §7).
 *
 * `verify-run`(Phase A)의 순수 재실행 검증을 의뢰 런용으로 좁히는 게이트다. `verify-invasion`
 * 과 같은 결로, 실제 게이트 판정은 이 파일(플랫폼 전역 무참조 — Deno·window·Node 어디도
 * 참조하지 않는다)에 두고, HTTP·Auth·DB I/O 는 `index.ts` 가 맡는다. 덕분에 vitest 로 이
 * 파일만 단위 테스트할 수 있다(Deno 없이).
 *
 * ## 이 파일이 지지 않는 것 — 의도적 분리
 * 계약 §7-1 게이트 표의 0a~0d(런 조회·상태·소유자 대조)와 6b(`bump_commission_verify_attempts`
 * RPC)는 **DB 조회/RPC 가 필요**해 이 파일에 둘 수 없다(플랫폼 전역 무참조 규율). 그래서 이
 * 파일은 **게이트 1~6**(제출 config 를 서버 원장 payload 와 순수 비교하는 부분)만 진다:
 *
 *   {@link evaluateCommissionGates} 가 1~6 을 평가해 거부 사유 또는 "서버 권위로 덮어쓴
 *   authoritative submission"(게이트 6 산출물)을 반환한다. index.ts 는 그 결과가 `ok:true`
 *   일 때만 게이트 6b(DB RPC)를 거쳐 게이트 7(`verifyRun`, `verify-run/verifyCore.ts` — **무수정
 *   임포트만**)을 부른다. 6b 가 6과 7 사이에 있어야 하는 이유는 계약 §7-1 의 각주를 보라
 *   (값싼 거부에 재시도권을 태우지 않기 위해 CPU 게이트 직전에 둔다).
 *
 * ## 게이트 5 vs 게이트 6 — 역할 분리(계약 §7-2)
 * 게이트 5(대조)는 **진단**이다 — 위조 유형을 `commission-payload-mismatch` 로 갈라 관측하는
 * 것이 전부이고, 없어도 방어는 유지된다. **강제는 게이트 6(덮어쓰기)이 진다**: 제출 config 의
 * `commission` 블록을 서버 payload 파생값으로 갈아끼운 뒤 재실행하므로, 다른 무대·다른 파워업
 * 풀을 전제한 제출은 해시 스트림이 갈려 `hash-stream-divergence`(게이트 7)로 거부된다. 순서를
 * 5→6 으로 둔 것(계획 원안 2→5 의 역전) 자체가 계약의 핵심 수정이다 — 덮어쓴 뒤의 대조는
 * 항진이므로 대조가 반드시 덮어쓰기보다 앞서야 한다.
 */

import type { WorldConfig } from '../../../src/sim/world.js';
import { DEFAULT_CONFIG } from '../../../src/sim/world.js';
import { planetContent } from '../../../data/planets/index.js';
import {
  COMMISSION_ELITE_WAVE_SEGMENTS,
  COMMISSION_WAVE_SEGMENTS_PER_SEGMENT,
} from '../../../src/run/commissionConstants.js';
import { runReplay } from '../../../src/sim/replay.js';
import type { Replay } from '../../../src/sim/replay.js';
import type {
  CommissionPayload,
  CommissionRunConfig,
} from '../../../src/run/commission.js';

/**
 * 의뢰 전용 거부 사유(verify-run 의 `ReasonCode` 유니온에 더해지는 코드). 기계 판독용이라
 * 한글 번역 금지 — 로그·클라이언트 분기 키. 계약 §7-1 게이트 표와 1:1 대응.
 */
export type CommissionRejectReason =
  | 'malformed-submission'
  | 'commission-inputs-too-long'
  | 'commission-catalyst-present'
  | 'commission-loadout-mismatch'
  | 'commission-unauthorized-unique'
  | 'commission-payload-mismatch';

/** 게이트 1~6 평가에 필요한 서버 권위 컨텍스트(DB 에서 index.ts 가 로드해 넘긴다). */
export interface CommissionServerContext {
  /** `commission_runs.payload` — 소비 시점에 굳은 종이. EF 권위 원본(계약 §3-3). */
  payload: CommissionPayload;
  /** `commission_runs.loadout_sealed` — 출격 시점 로드아웃 봉인(대조 기준값). */
  loadoutSealed: unknown;
  /**
   * 이 profile 에게 **이미 발급된** 의뢰 전용 유니크의 `LoadoutConfig.uniqueMask` bit 집합
   * (`commission_grants` 에서 index.ts 가 조회). 게이트 4 가 이 집합과
   * `COMMISSION_EXCLUSIVE_UNIQUE_BITS`(commissionServerConstants.ts)를 대조한다.
   */
  grantedUniqueBits: readonly number[];
  /**
   * 의뢰 전용 유니크 bit 목록(`COMMISSION_EXCLUSIVE_UNIQUE_BITS`). ⚠️ **현재 빈 배열이면
   * 게이트 4 는 순회할 항목이 없어 구조적으로 항상 통과한다**(Phase D 카탈로그 부재,
   * commissionServerConstants.ts 주석 참조) — 자리이지 방어가 아니다.
   */
  exclusiveUniqueBits: readonly number[];
}

/** 게이트 1~6 평가 결과. `ok:false` 는 즉시 거부, `ok:true` 는 게이트 7 에 넘길 재실행 입력. */
export type CommissionGateResult =
  | { ok: false; reason: CommissionRejectReason }
  | {
      ok: true;
      /** 서버 payload 로 `commission` 블록을 덮어쓴 재실행용 제출(verify-run RunSubmission 형). */
      submission: { seed: unknown; config: WorldConfig; inputs: unknown; claim: unknown };
    };

function reject(reason: CommissionRejectReason): CommissionGateResult {
  return { ok: false, reason };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * 구조적 깊은 동치 비교(키 순서 무관). jsonb 왕복(DB 저장 ↔ 클라 제출)에서 키 순서가
 * 달라져도 오거부하지 않기 위해 `JSON.stringify` 단순 비교 대신 이 함수를 쓴다.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== 'object') return false;
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (aArr && bArr) {
    const ax = a as unknown[];
    const bx = b as unknown[];
    if (ax.length !== bx.length) return false;
    for (let i = 0; i < ax.length; i++) {
      if (!deepEqual(ax[i], bx[i])) return false;
    }
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao).sort();
  const bk = Object.keys(bo).sort();
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return false;
    if (!deepEqual(ao[ak[i] as string], bo[bk[i] as string])) return false;
  }
  return true;
}

/**
 * 서버 payload 에서 파생한 **권위 `CommissionRunConfig`**(게이트 5 의 기대값이자 게이트 6 이
 * 덮어쓰는 값). `segmentIndex` 는 항상 0 이다 — ⚠️ **가정(§13-③ 과 같은 성격의 미확인)**:
 * 다구간 진행은 `stepRun`/`runReplay` 가 재실행 **내부에서** 구간을 전환하므로(구간 전환
 * 코어 2단계, PR#226), 재실행 입력 config 는 항상 "런 시작 시점"의 구간 0 을 가리켜야
 * 한다 — 진행 중 구간 인덱스를 config 에 실어 매 구간 새로 제출하는 모델이 아니다. 이
 * 가정이 틀리면(=구간별로 EF 를 여러 번 부르는 모델이면) 이 함수가 아니라 `segmentIndex`
 * 산정 지점을 index.ts 가 넘기는 값으로 바꿔야 한다.
 */
function authoritativeCommissionConfig(payload: CommissionPayload): CommissionRunConfig {
  const base: CommissionRunConfig = {
    commissionId: payload.commissionId,
    order: payload.order,
    grade: payload.grade,
    segments: payload.segments,
    replayBudgetTicks: payload.replayBudgetTicks,
    segmentIndex: 0,
  };
  return payload.constraints !== undefined ? { ...base, constraints: payload.constraints } : base;
}

/**
 * 게이트 1~6 을 순서대로 평가한다(계약 §7-1). 신뢰 불가 입력(`raw` — RunSubmission 형태:
 * seed·config·inputs·claim)과 서버 권위 컨텍스트를 받아, 거부 또는 재실행용 authoritative
 * submission 을 낸다. **게이트 0/0b~0d/6b/7/8/9 는 이 함수 밖(index.ts)에서 처리된다.**
 */
export function evaluateCommissionGates(
  raw: unknown,
  server: CommissionServerContext,
): CommissionGateResult {
  if (typeof raw !== 'object' || raw === null) return reject('malformed-submission');
  const sub = raw as Record<string, unknown>;

  // 게이트 1: 입력 길이 상한(CPU 예산 게이트 — 판정 게이트 중 가장 앞에 둔다, 계약 §7-1).
  if (Array.isArray(sub.inputs) && (sub.inputs as unknown[]).length > server.payload.replayBudgetTicks) {
    return reject('commission-inputs-too-long');
  }

  const cfg = asRecord(sub.config);

  // 게이트 2: 촉매 주입 금지 — 의뢰 런은 "종이에 적힌 것만 나오는 순결한 런"이다(CONTEXT.md:235).
  const catalysts = cfg !== null ? cfg.catalysts : undefined;
  if (Array.isArray(catalysts) && catalysts.length > 0) {
    return reject('commission-catalyst-present');
  }

  // 게이트 3: 로드아웃 위조 — 출격 시점 봉인(loadout_sealed)과 제출 config.loadout 이 달라지면
  // 거부한다. 대조가 닫는 것은 "출격 후 편집"뿐이고 출격 전 위조는 열려 있다(ADR-0044, ADR-0028).
  //
  // ⚠️ **자인 — 로드아웃 축에는 현재 서버 판정이 0겹이다.** 이 게이트의 기준값(`loadout_sealed`)은
  //    `consume_commission(p_loadout)` 으로 클라가 넣은 값이고, 그 구멍의 대체 방어로 지목된
  //    게이트 4 는 `COMMISSION_EXCLUSIVE_UNIQUE_BITS` 가 비어 있어 구조적으로 아무것도 안 본다.
  //    자인 둘이 겹쳐 상쇄된 상태다.
  //
  //    **배정된 대체 방어**(미조달로 남기지 않는다): ① 게이트 6 의 allowlist 재조립이 코어 스탯·
  //    무대·배율 축을 닫아 로드아웃 위조의 상한을 "장비로 낼 수 있는 화력"으로 묶는다. ② 런 파생
  //    자원분에 틱 비례 개연성 캡(`settle_commission` §7)을 걸어 화력 인플레가 재화로 환전되는
  //    폭을 묶는다. ③ 확정 지급물은 소비된 의뢰서 1장당 1회이고 발령이 빈도 상한 20/h 에 묶인다.
  //    남는 잔여 위험은 "정상 범위를 벗어난 장비로 어려운 의뢰를 깬다"이며, 이는 서버가 장비
  //    원장을 갖기 전까지(ADR-0028 연기) 구조로 못 막는 축이다 — 밸런스 큐에 등재한다.
  const submittedLoadout = cfg !== null ? cfg.loadout : undefined;
  if (!deepEqual(submittedLoadout, server.loadoutSealed)) {
    return reject('commission-loadout-mismatch');
  }

  // 게이트 4: 미인가 의뢰 전용 유니크 — 대조는 "받은 적이 있는가"이지 "지금 갖고 있는가"가
  // 아니다(ADR-0045 §2b). `exclusiveUniqueBits` 가 비어 있으면(Phase D 카탈로그 미도입) 이
  // 루프는 구조적으로 아무 것도 안 본다 — 자리이지 방어가 아니다(commissionServerConstants.ts 주석).
  const loadoutRec = asRecord(submittedLoadout);
  const uniqueMask = loadoutRec !== null && isFiniteNumber(loadoutRec.uniqueMask) ? loadoutRec.uniqueMask : 0;
  const granted = new Set(server.grantedUniqueBits);
  for (const bit of server.exclusiveUniqueBits) {
    const bitSet = (uniqueMask & (1 << bit)) !== 0;
    if (bitSet && !granted.has(bit)) {
      return reject('commission-unauthorized-unique');
    }
  }

  // 게이트 5(진단) — 제출 config.commission 이 서버 payload 파생 기대값과 다르면 진단용 사유로
  // 갈라 거부한다. **강제는 게이트 6 이 진다** — 이 게이트가 없어도(또는 통과해도) 게이트 6 의
  // 덮어쓰기 + 게이트 7 의 해시 재대조가 위조를 잡는다(계약 §7-2).
  const expected = authoritativeCommissionConfig(server.payload);
  const submittedCommission = cfg !== null ? asRecord(cfg.commission) : null;
  const commissionMatches =
    submittedCommission !== null &&
    submittedCommission.commissionId === expected.commissionId &&
    submittedCommission.order === expected.order &&
    submittedCommission.grade === expected.grade &&
    deepEqual(submittedCommission.segments, expected.segments) &&
    submittedCommission.replayBudgetTicks === expected.replayBudgetTicks &&
    deepEqual(submittedCommission.constraints, expected.constraints);
  if (!commissionMatches) {
    return reject('commission-payload-mismatch');
  }

  // 게이트 6: **allowlist 재조립**. 거부는 없고, 서버가 아는 축을 서버 값으로 다시 세운다.
  //
  // ⚠️ **`{...cfg, commission: expected}` 로 쓰면 안 된다.** 그러면 서버 권위가 `commission`
  //    블록 하나뿐이고 나머지 `WorldConfig` 전체가 제출자 것으로 남는다. 재실행이 제출자 config
  //    로 돌고 해시는 제출자가 **같은 config 로 계산한** claim 과 일치하므로, 게이트 7 은
  //    원리적으로 발산하지 않는다 — 즉 "재실행이 강제한다"가 거짓이 된다. 실제로 열리는 벡터:
  //      ⓐ `playerHp: 1e9` → 무손실 완주 → 확정 지급물(ADR-0045) 취득
  //      ⓑ `planetMultCenti: 1e6` → `finalState.resources` 무제한(그 산술에 상한 캡이 없다)
  //      ⓒ `planet`/`stage` 임의 → **1구간 무대는 서버 권위가 아니다**(`stageOverride` 는
  //         `nextIndex >= 1` 전환에만 적용되고 `createWorld` 는 `segments[0]` 을 읽지 않는다)
  //      ⓓ `maxSegments: 0` → 일반 세그먼트를 건너뛰고 즉시 보스
  //
  // 규율: **서버가 아는 것은 서버 값, 모르는 것만 제출값.** 새 필드가 `WorldConfig` 에 생기면
  // 여기서 명시적으로 분류하라 — spread 로 흘려보내면 그 순간 다시 열린다.
  const seg0 = server.payload.segments[0];
  if (seg0 === undefined) return reject('commission-payload-mismatch');
  const authoritativeConfig: WorldConfig = {
    // ① 코어 sim 상수 — 제출자가 정할 여지가 없다. `buildRunConfig` 도 이 아홉을 손대지 않고
    //    `DEFAULT_CONFIG` 그대로 쓰므로(`src/run/runConfig.ts:183`), 고정해도 정직한 런은
    //    한 비트도 안 바뀐다.
    ...DEFAULT_CONFIG,
    // ② 무대 — **payload 의 1구간**이 정본. 2구간부터는 `stageOverride` 가 전환 때 세운다.
    planet: seg0.planet,
    stage: seg0.stage,
    planetMode: planetContent(seg0.planet).mode,
    // ③ 제출자가 정하는 축(서버가 독립적으로 알 수 없다). 로드아웃은 게이트 3 이 `loadout_sealed`
    //    와 대조하지만 그 기준값 자체가 출격 전 클라 입력이다 — §자인 참조.
    //    `exactOptionalPropertyTypes` 아래에서는 `undefined` 를 **넣는 것**과 **키가 없는 것**이
    //    다르다. 조건부 스프레드로 키 자체를 빼야 `WorldConfig` 와 정합하고, sim 도 기본값으로 간다.
    ...(cfg?.loadout !== undefined ? { loadout: cfg.loadout as NonNullable<WorldConfig["loadout"]> } : {}),
    ...(cfg?.skillInvest !== undefined
      ? { skillInvest: cfg.skillInvest as NonNullable<WorldConfig["skillInvest"]> }
      : {}),
    ...(cfg?.activeSlots !== undefined
      ? { activeSlots: cfg.activeSlots as NonNullable<WorldConfig["activeSlots"]> }
      : {}),
    ...(cfg?.shipType !== undefined ? { shipType: cfg.shipType as NonNullable<WorldConfig["shipType"]> } : {}),
    ...(cfg?.runId !== undefined ? { runId: cfg.runId as NonNullable<WorldConfig["runId"]> } : {}),
    // ④ 서버 권위 블록.
    commission: expected,
    // ⚠️ **정예 소집령만 낮은 상한을 쓴다**(`buildRunConfig` 와 대칭 — `COMMISSION_ELITE_WAVE_SEGMENTS`
    // 주석 참조). 여기서 갈리면 클라·서버가 다른 `maxSegments` 로 재실행해 정직한 정예 소집령
    // 런까지 `outcome-mismatch` 로 거부된다 — 배선은 반드시 한 쌍으로 움직인다.
    maxSegments:
      expected.order === 'elite' ? COMMISSION_ELITE_WAVE_SEGMENTS : COMMISSION_WAVE_SEGMENTS_PER_SEGMENT,
    // ⑤ **의도적 누락** — `catalysts`(게이트 2 가 이미 거부) · `planetMultCenti`/`planetMultEpoch`
    //    (의뢰 런은 행성 인기 배율을 받지 않는다) · `invasion3`(침공과 상호 배타) · `pilot`
    //    (예비역 소집은 장비축 제약을 우회한다). 여기 없으면 sim 이 기본값으로 간다.
  };
  return {
    ok: true,
    submission: {
      seed: sub.seed,
      config: authoritativeConfig,
      inputs: sub.inputs,
      claim: sub.claim,
    },
  };
}

/** `verifyRun` 이 반환하지 않는 값(계약 §8 — 재실행 finalState 자원 축)을 별도로 추출한다. */
export interface RunResourceFacts {
  /** 재실행 최종 상태의 `resources`(검증된 값 — 클라 주장이 아니다). */
  resources: number;
}

/**
 * 재실행해 `finalState.resources` 를 뽑는다(계약 §8 "재실행 `finalState` 자원 축"). `verifyRun`
 * (verify-run/verifyCore.ts, 무수정 임포트 하드 게이트)은 `ComputedFacts`(finalHash·ticks·
 * outcome)만 반환하고 `resources`/`minerals` 를 노출하지 않으므로, **같은 결정론적 replay 를
 * 한 번 더 돌려** 그 값을 얻는다(같은 입력이므로 결과가 갈릴 위험이 없다 — 게이트 7 이 이미
 * 해시 일치를 확인한 뒤에만 이 함수를 부른다).
 *
 * ## CPU 예산 — 이 중복이 왜 계정당 상한을 2배로 만들지 않는가
 * 이 함수는 **accept 경로에서만** 불린다. 그리고 accept 는 `settle_commission` 이 상태를
 * `verified` 로 확정하므로 같은 `run_id` 에 대해 **최대 1회**다(재호출은 게이트 0b 가 CPU 없이
 * 저장된 판정을 돌려준다). 즉 증폭은 "시도당 2배"가 아니라 **런당 +1회**다.
 *
 * ⚠️ 남는 창 하나: `settle_commission` 이 500 을 내면 상태가 확정되지 않아 클라 재호출이 이
 * 경로를 다시 밟는다. 그 반복은 `commission_runs.verify_attempts`(상한 5, `bump_...` RPC 가
 * 게이트 7 직전에 증가)가 묶는다 — 무한이 아니다.
 *
 * ⚠️ **가정(미확인)**: `minerals` 는 WorldState 에 결정론적 필드로 없다(일반 PvE 정산도
 * 살베지 파생 클라 주장이다 — `src/save/settlement.ts` 참조). 이 함수는 `resources` 만 낸다.
 * `p_run_minerals` 는 index.ts 에서 0 으로 고정한다(§8 표의 "재실행 자원 축"을 credits 에만
 * 적용 — minerals 과대 지급 위험을 피하는 보수적 선택. 실제 의뢰 런에 광물 축이 필요하면
 * 이 가정을 재검토해야 한다).
 */
export function extractRunResources(submission: {
  seed: unknown;
  config: WorldConfig;
  inputs: unknown;
}): RunResourceFacts {
  const replay: Replay = { seed: submission.seed as number, config: submission.config, inputs: submission.inputs as Replay['inputs'] };
  const result = runReplay(replay);
  return { resources: result.finalState.resources };
}
