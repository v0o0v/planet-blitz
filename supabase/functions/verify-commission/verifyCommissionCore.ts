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

  // 게이트 6: 서버 payload 로 `commission` 블록을 덮어쓴다(거부 없음 — 강제는 재실행이 진다).
  const authoritativeConfig: WorldConfig = {
    ...(cfg as unknown as WorldConfig),
    commission: expected,
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
