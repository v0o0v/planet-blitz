/**
 * verify-commission 검증 코어 (의뢰서 서버 축 · **ADR-0050 재실행 삭제 · 레인 B**).
 *
 * ⚠️ **재실행 검증은 삭제됐다.** 이 파일은 더 이상 `src/sim`(`runReplay`)을 import 하지 않고,
 * `verify-run/verifyCore.ts` 도 참조하지 않는다 — sloppy-imports 로 EF 에 sim 이 실리는 경로
 * 자체가 사라졌다(ADR-0050 §1 "EF 의 `src/sim` import 와 재실행 코어" 삭제 대상).
 *
 * 남는 것은 **재실행과 무관하게 서던 게이트 1~5**뿐이다(제출 config 를 서버 원장 payload·
 * `loadout_sealed`·발급 기록과 순수 비교하는 구조 검사). 게이트 6(서버 payload 로 `WorldConfig`
 * 전체를 재조립해 재실행 입력을 만드는 단계)과 그 소비처(재실행)는 함께 사라졌다 — 남길 이유가
 * 없다(재조립의 유일한 목적이 재실행 강제였다, 구 파일 게이트6 주석 참조).
 *
 * 게이트 0a~0d/6b(1회 재정의였던 시도 카운터)/7~9(DB·RPC)는 여전히 `index.ts`(Deno 전용) 몫이다.
 */

import type { CommissionPayload, CommissionRunConfig } from '../../../src/run/commission.js';

/**
 * 의뢰 전용 거부 사유(기계 판독용, 한글 번역 금지 — 로그·클라이언트 분기 키). 재실행 결과에만
 * 의존하던 사유(`commission-payload-mismatch` 뒤에 이어지던 hash-stream 계열)는 재실행과 함께
 * 사라졌다 — 남는 다섯은 전부 재실행 없이도 서는 순수 대조다.
 */
export type CommissionRejectReason =
  | 'malformed-submission'
  | 'commission-inputs-too-long'
  | 'commission-catalyst-present'
  | 'commission-loadout-mismatch'
  | 'commission-unauthorized-unique'
  | 'commission-payload-mismatch';

/** 게이트 1~5 평가에 필요한 서버 권위 컨텍스트(DB 에서 index.ts 가 로드해 넘긴다). */
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

/** 게이트 1~5 평가 결과. `ok:false` 는 즉시 거부, `ok:true` 는 확정(accept) 처리로 넘어간다. */
export type CommissionGateResult = { ok: false; reason: CommissionRejectReason } | { ok: true };

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
 * 서버 payload 에서 파생한 **권위 `CommissionRunConfig`**(게이트 5 의 기대값). `segmentIndex` 는
 * 항상 0 이다 — ⚠️ **가정(§13-③ 과 같은 성격의 미확인)**: 다구간 진행은 재실행 내부에서 구간을
 * 전환하는 모델을 전제로 했었다(구 게이트 6 주석). 재실행이 사라진 지금도 제출 시점 config 는
 * "런 시작 시점"의 구간 0 을 가리켜야 한다는 계약 자체는 바뀌지 않는다.
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
 * 게이트 1~5 를 순서대로 평가한다. 신뢰 불가 입력(`raw` — seed·config·inputs·claim 형태)과
 * 서버 권위 컨텍스트를 받아, 거부 또는 통과(`ok:true`)를 낸다. **게이트 0/0b~0d/6b/7~9 는 이
 * 함수 밖(index.ts)에서 처리된다.**
 */
export function evaluateCommissionGates(
  raw: unknown,
  server: CommissionServerContext,
): CommissionGateResult {
  if (typeof raw !== 'object' || raw === null) return reject('malformed-submission');
  const sub = raw as Record<string, unknown>;

  // 게이트 1: 입력 길이 상한(계약 §7-1 — 재실행 CPU 예산 게이트였던 축을 페이로드 크기 상한
  // 겸 sanity 체크로 남긴다. 재실행이 사라져 CPU 비용은 없지만 payload 크기는 여전히 유계할 값이다).
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

  // 게이트 5: 제출 config.commission 이 서버 payload 파생 기대값과 다르면 거부한다. 재실행이
  // 있던 시절엔 "진단"(강제는 게이트 6 의 덮어쓰기가 졌다)이었으나, 게이트 6·재실행이 함께
  // 사라진 지금은 **이 대조가 유일한 강제선**이다 — 그대로 reject 사유로 남긴다.
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

  return { ok: true };
}
