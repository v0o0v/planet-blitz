/**
 * verify-invasion 검증 코어 (M4 Phase D · D1 → **M7a 3레이어 확장 · L6-verify-ef**).
 *
 * verify-run(Phase A)의 순수 재실행 검증을 침공(PvP)용으로 좁힌 게이트다. Phase A의
 * `verifyRun`은 "제출된 [seed+config+inputs]가 주장 결과를 내적으로 재현하는가"만
 * 증명했다(verifyCore.ts 상단 carry-forward 경고). 침공은 결과가 영구 래더(ADR-0004)에
 * 직결되므로, verify-run README "Phase D 착수 조건" 3건을 이 코어에서 강제한다:
 *
 *   1. **config 정당성 대조** — 클라이언트가 보낸 3레이어 배치(config.invasion3.layers·
 *      timeLimitTicks)를 서버가 DB(defenses/스냅샷)에서 로드한 **권위 배치**와 정확히
 *      대조한다. 불일치(약화된 가짜 방어로 쉽게 이긴 척)는 `defense-mismatch`로 거부한다.
 *      재실행은 제출 config가 아니라 **서버 권위 config**로 돌려, config를 조작해도 재현이
 *      갈리게 한다.
 *   2. **hashStream 필수화** — verify-run에서 선택이던 틱별 해시 스트림을 침공에서는
 *      필수로 강제한다(`hash-stream-required`). 중간 발산 지점(위조 추적 근거)을 항상 확보.
 *   3. **재실행 시간예산 가드** — 입력 길이를 침공 제한 시간(timeLimitTicks = 18000틱,
 *      INVASION_TOTAL_TICKS) 이내로 제한(`invasion-inputs-too-long`)해 재실행 CPU를
 *      상한한다. wall-clock 가드는 배선 계층(index.ts)이 담당한다.
 *
 * ## M7a 에서 바뀐 것 — 정규화·대조의 구조적 단일화
 * 구 구조는 클라 `normalizeLayout`(src/ui/defenseCommand.ts) ↔ 서버 `normalizeServerLayout`
 * (이 파일)이 **"자구 일치"라는 구두 계약**으로 묶여 있었다. 한쪽만 고치면 정직한 런이 전량
 * `defense-mismatch` 로 오거부되고, 신규 필드를 대조(`layoutEquals`)에 넣는 걸 잊으면 반대로
 * **위조 프리패스**가 된다 — 즉 사람이 두 곳을 손으로 맞춰야 안전한 구조였다.
 *
 * 그래서 세 함수(`layoutEquals`/`normalizeServerLayout`/`isValidLayout`)를 **폐기**하고,
 * 클라·sim·서버가 전부 `src/sim/invasion/normalize.ts` 하나를 쓴다:
 *   - {@link normalizeInvasionLayers} 는 total function(널 반환 없음·멱등)이라 "정규화 실패"
 *     라는 갈림 상태 자체가 없다.
 *   - {@link layersEqual} 은 정규형 **전체를 구조적으로 깊이 비교**한다(필드 화이트리스트가
 *     아니다). 스키마에 필드를 추가해도 대조 코드를 갱신할 필요가 없고, 누락이 구조적으로
 *     불가능하다.
 * EF 는 sloppy-imports 로 이미 `src/sim/**` 를 직접 읽으므로 추가 인프라가 필요 없다.
 *
 * 신뢰 경계: 입력(`raw`)·클라이언트 주장은 전부 신뢰 불가. 서버가 재실행으로 도출한
 * 값만 진실이다(원칙2 서버 권위). 이 파일은 플랫폼 전역(`Deno`·`window`·Node)을 일절
 * 참조하지 않아 vitest·Deno 어디서나 동일하게 돈다(갈림길①A, 단일 소스).
 *
 * ⚠️ 잔여 신뢰 범위(문서화된 한계): 이 코어는 **방어 배치**의 정당성만 서버 DB와
 * 대조한다. 공격자 자신의 로드아웃(config.loadout·skillInvest)이 실제 보유 장비와
 * 일치하는지는 대조하지 않는다 — 재실행은 제출된 공격자 로드아웃을 그대로 쓰므로,
 * 자기 로드아웃을 부풀린 위조는 내적으로 일관돼 accept될 수 있다. 이는 "방어를 약화해
 * 승률을 조작"하는 래더 오염(중대)과 달리 공격자 자신을 강화하는 축이라 D1 범위 밖으로
 * 두고, 로드아웃 legitimacy 대조는 후속(공격자 ships/items 서버 대조) 게이트로 남긴다.
 */

import { verifyRun } from '../verify-run/verifyCore.js';
import type { VerifyResult, ComputedFacts } from '../verify-run/verifyCore.js';
import type { WorldConfig } from '../../../src/sim/world.js';
import {
  layersEqual,
  normalizeInvasionLayers,
} from '../../../src/sim/invasion/normalize.js';
import { INVASION_GUARDIAN_SLOTS } from '../../../src/sim/invasion/constants.js';
import type {
  Invasion3Config,
  InvasionGuardianPlacement,
  InvasionLayers,
} from '../../../src/sim/invasion/types.js';
import { parseModulesAuthority } from '../../../src/sim/moduleEffects.js';
import { PERFORMANCE_FULL } from '../../../data/guardian.js';
import type { GuardianSnapshot } from '../../../data/guardian.js';
import { branchBonusBp, guardianMilestones, normalizeMilestones } from '../../../data/lineage.js';

/**
 * 침공 전용 거부 사유(verify-run의 RejectReason에 더해지는 코드). 기계 판독용이라
 * 한글 번역 금지 — 로그·클라이언트 분기 키.
 */
export type InvasionRejectReason =
  | 'malformed-submission'
  | 'config-required'
  | 'invasion-config-required'
  | 'malformed-layout'
  | 'defense-mismatch'
  | 'invasion-inputs-too-long'
  | 'hash-stream-required'
  | 'server-layout-invalid';

/** 침공 검증 결과(verify-run VerifyResult를 그대로 재사용하되 reason이 넓어진다). */
export interface InvasionVerifyResult {
  verdict: 'accept' | 'reject';
  reason: string;
  computed?: ComputedFacts;
}

/** 서버가 DB에서 로드한 권위 침공 컨텍스트(재실행·대조의 진실값). */
export interface InvasionServerContext {
  /**
   * `defenses.layout` jsonb 또는 T0 스냅샷 `authority.layers` 에서 로드한 방어자 3레이어
   * 배치(raw — 신뢰하되 정규화 필요). verifyInvasion 이
   * {@link normalizeInvasionLayers}(클라이언트·sim 과 **같은 함수**)로 정규화한 본을
   * 대조·재실행의 진실값으로 쓴다. 정규화는 total 이라 "서버 데이터 손상으로 정규화 불능"
   * 이라는 분기가 없다 — 손상 슬롯은 비고, 결과는 언제나 유효한 정규형이다.
   */
  layers: unknown;
  /**
   * 서버가 인정하는 제한 시간(틱). M7a 기준 `INVASION_TOTAL_TICKS`(18000 = 300초).
   * 배선 계층(index.ts)이 이 상수를 싣는다 — 클라 sim 의 총 예산과 반드시 같은 값이어야
   * 정직한 5분 런이 `invasion-inputs-too-long`/`defense-mismatch` 로 오거부되지 않는다.
   */
  timeLimitTicks: number;
  /**
   * 방어 정비도(풍화, ADR-0006) — **정수 centi-percent**(0..MAINTENANCE_FULL=10000).
   * DB `defenses.maintenance`(numeric(5,2), 0~100)를 배선 계층(index.ts)이 `Math.round(db*100)`
   * 로 변환해 싣는다(클라이언트 변환 공식과 반드시 동일 — 어긋나면 정직한 런이 오거부된다).
   * 서버 재실행은 이 값으로 설비·편대·기물의 발사 간격을 스케일(0%→2배 느림, ADR-0006
   * "0%→성능 50%")한다. **미지정(undefined)이면 완전 정비**로 취급한다.
   */
  maintenance?: number;
  /**
   * T0 스냅샷 `authority.modules` raw jsonb(M7b · ADR-0018). 방어자가 장착한 코어 모듈
   * 인스턴스 + 공격자 매치업이며, verifyInvasion 이 클라이언트와 **같은 파서**
   * ({@link parseModulesAuthority})로 접어 재실행 config 에 싣는다.
   *
   * **이 배선이 빠지면 모듈 장착 방어의 정직한 침공이 전량 hash-stream-divergence 로 오거부된다**
   * — 클라는 모듈 효력을 반영해 달렸는데 서버는 안 반영하고 재실행하기 때문이다. 모듈은
   * `layers` 직렬화에 들어 있지 않으므로(소모성 인스턴스) 반드시 별도 키로 와야 한다.
   * 미장착·구버전 스냅샷이면 미지정 → 모듈 없는 재실행(거동·해시 불변).
   */
  modules?: unknown;
}

function reject(reason: InvasionRejectReason, computed?: ComputedFacts): InvasionVerifyResult {
  return computed === undefined
    ? { verdict: 'reject', reason }
    : { verdict: 'reject', reason, computed };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 수호 권위 주입 (M5 → M7a 경로 이전. index.ts 배선이 소비, deno 테스트가 검증)
// ---------------------------------------------------------------------------

/**
 * 서버가 DB `guardians` 에서 로드한 방어자 활성 수호 1기(권위 주입 입력). 신뢰 경계:
 * `data`(복사 스냅샷)·`combatScore` 는 클라 빌드 파생이라 클라 정본 미러지만(migration
 * 20260718100000 헤더 신뢰 경계 참조), **`performance`(풍화 축)는 서버 권위**다 —
 * 정비도와 동일하게 PvP 결정에 직결되는 축만 서버가 봉인한다.
 */
export interface AuthoritativeGuardianRow {
  /** guardians.data — 퇴역 복사 스냅샷 jsonb(신뢰 불가 → 정규화가 검증). */
  readonly data: unknown;
  /** guardians.performance — numeric(5,2) 0..100. 서버 풍화 권위값(cron weather_guardians). */
  readonly performance: number;
}

/**
 * DB `guardians.performance`(numeric(5,2), 0..100) → 정수 centi-percent(0..10000).
 * **공식 고정 `Math.round(db*100)`** — 클라 `guardianGateway.fetchGuardians`(동일 `Math.round(
 * performance*100)`)·정비도 변환(`Math.round(db*100)`)과 단일 공식이라, 클라가 제출한
 * performanceCP 와 서버 주입값이 비트 동일해야 정직 런이 defense-mismatch 로 오거부되지 않는다.
 * 비유한(NaN/Infinity/null)은 완전 성능(PERFORMANCE_FULL)로 폴백(클라 fetchGuardians 폴백 100 과 동일).
 */
export function performanceToCenti(dbPerformance: unknown): number {
  const n = typeof dbPerformance === 'number' ? dbPerformance : Number(dbPerformance);
  return Number.isFinite(n) ? Math.round(n * 100) : PERFORMANCE_FULL;
}

/**
 * 3레이어 배치 `layers.l3.guardians` 슬롯을 **DB 권위 값으로 재구성**한다(M5 서버 권위 주입의
 * M7a 경로 이전 — 정비도 주입과 대칭). 공격자 제출 config 의 수호 성능%·계보 보너스·스냅샷을
 * 신뢰하지 않고, 방어자의 라이브 `guardians`(풍화된 performance)·`profiles.
 * lineage_guardian_level` 로 덮어쓴다.
 *
 * ⚠️ **슬롯 매핑 3자 정합**(SQL `inject_guardian_authority` / 이 함수 / 클라
 * `buildGuardianPlacements`)이 비트 동일해야 한다. 셋 중 하나만 어긋나면 **정직한 런이 전량
 * defense-mismatch 로 오거부**된다. M7a 에서 경로가 `layout->'guardians'` 에서
 * `layers->'l3'->'guardians'` 로 바뀌었으므로 SQL(L7 레인)도 반드시 함께 옮겨야 한다.
 *
 * 매핑 규칙(구 규칙 그대로 — 배열 인덱스 i ↔ 활성 수호 i):
 *   - **슬롯 위치(x/y)**: 저장된 배치(`layers.l3.guardians[i]`)에서 온다 — 방어자 배치 결정이라
 *     풍화 대상이 아니고 서버가 그대로 존중한다. 해당 슬롯이 비어 있으면 (0,0).
 *   - **스냅샷/성능%/보너스/마일스톤**: 활성 수호를 결정론 순서(created_at, id — index.ts 조회 +
 *     클라 fetchGuardians 조회 순서 일치)로 슬롯 i ↔ 활성 수호 i 매핑해 주입한다.
 *   - 활성 수호 수·{@link INVASION_GUARDIAN_SLOTS} 중 최솟값까지만 채우고 나머지 슬롯은 null.
 *
 * 입력은 불변(얕은 복제로 l3.guardians 만 교체). 반환은 raw 형태 그대로다 — 정규화는
 * verifyInvasion 이 한 번에 한다(중복 정규화는 멱등이라 무해하지만 경로를 하나로 유지한다).
 */
export function injectGuardianAuthority(
  rawLayers: unknown,
  guardians: readonly AuthoritativeGuardianRow[],
  lineageGuardianLevel: number,
): unknown {
  const root = asRecord(rawLayers);
  if (root === null) return rawLayers;
  const l3 = asRecord(root.l3) ?? {};
  const slots = Array.isArray(l3.guardians) ? (l3.guardians as unknown[]) : [];

  const level =
    typeof lineageGuardianLevel === 'number' && Number.isFinite(lineageGuardianLevel)
      ? lineageGuardianLevel
      : 0;
  const bonusBp = branchBonusBp(level);
  // 마일스톤 마스크도 계보 레벨에서 권위 재도출한다(보너스 곡선과 동일 — 계정 단위). 공격자 제출
  // 마스크를 신뢰하지 않고 방어자 라이브 레벨로 덮는다(위조 시 defense-mismatch).
  const milestones = normalizeMilestones(guardianMilestones(level));

  const n = Math.min(guardians.length, INVASION_GUARDIAN_SLOTS);
  const authoritative: (InvasionGuardianPlacement | null)[] = new Array(INVASION_GUARDIAN_SLOTS).fill(
    null,
  );
  for (let i = 0; i < n; i++) {
    const sr = asRecord(slots[i]) ?? {};
    const row = guardians[i]!;
    authoritative[i] = {
      x: isFiniteNumber(sr.x) ? Math.trunc(sr.x) : 0,
      y: isFiniteNumber(sr.y) ? Math.trunc(sr.y) : 0,
      snapshot: row.data as GuardianSnapshot,
      performanceCP: performanceToCenti(row.performance),
      lineageBonusBp: bonusBp,
      milestones,
    };
  }
  return { ...root, l3: { ...l3, guardians: authoritative } };
}

// ---------------------------------------------------------------------------
// 침공 권위 스냅샷 해석 (M5 — 레이스 B 완전 폐쇄. index.ts 배선이 소비, deno 테스트가 검증)
// ---------------------------------------------------------------------------

/**
 * 스냅샷 신선도 창(ms). get_invasion_targets 프레시 창(1시간)과 동일 — begin_invasion 이
 * T0 에 고정한 권위는 1시간 이내에만 유효하다. 초과 스냅샷은 라이브 경로로 폴백(마이그레이션
 * 20260718130000 EF 계약 ③).
 */
export const SNAPSHOT_FRESHNESS_MS = 60 * 60 * 1000;

/** invasion_snapshots 행에서 EF 가 소비하는 필드(신뢰 경계: begin_invasion definer 만 기록). */
export interface InvasionSnapshotRow {
  /** invasion_snapshots.attacker_id — 소유권 대조 기준. */
  readonly attackerId: string;
  /** invasion_snapshots.defense_id — 소유권 대조 기준(null 가능). */
  readonly defenseId: string | null;
  /** authority->'layers' — T0 고정 수호 권위 주입 완료 3레이어 배치(raw jsonb). */
  readonly authorityLayers: unknown;
  /** authority->>'maintenance' — DB 정비도(numeric 0..100) 또는 미지정. index.ts 가 centi 변환. */
  readonly authorityMaintenanceDb: number | undefined;
  /**
   * authority->'modules' — T0 고정 코어 모듈 권위(M7b, `{instances,matchup}` raw jsonb).
   * **재실행 입력이다** — 모듈은 layers 직렬화에 없으므로 이 키가 빠지면 모듈 장착 방어의
   * 정직한 침공이 전량 오거부된다. 미장착·구버전 스냅샷이면 null.
   */
  readonly authorityModules: unknown;
  /** invasion_snapshots.created_at → epoch ms. 신선도 판정 기준. */
  readonly createdAtMs: number;
}

/** 스냅샷 해석 입력(index.ts 가 invasion 행·로드한 스냅샷·시각으로 구성). */
export interface SnapshotResolutionParams {
  /** invasions.snapshot_id (null = 현행 라이브 경로 — 스냅샷 미배선/구버전 제출). */
  readonly invasionSnapshotId: string | null;
  /** invasions.attacker_id — 스냅샷 소유권 대조 기준(OQ#1 CRITICAL). */
  readonly invasionAttackerId: string;
  /** invasions.defense_id — 스냅샷 소유권 대조 기준(OQ#1 CRITICAL, null 가능). */
  readonly invasionDefenseId: string | null;
  /** service_role 로 로드한 invasion_snapshots 행(부재 = null → 라이브 폴백). */
  readonly snapshot: InvasionSnapshotRow | null;
  /** 검증 시각(ms) — 신선도 판정 기준. */
  readonly nowMs: number;
  /**
   * 이 snapshot_id 를 이미 다른 확정 invasion 이 사용했는가(재사용 방어적 2차선). DB 부분
   * 유니크 인덱스(invasions_snapshot_unique)가 1차로 원자 강제하므로 여기는 belt-and-suspenders.
   */
  readonly reused: boolean;
}

/** 스냅샷 해석 결과: 유효 스냅샷이면 그 권위를, 아니면 라이브 폴백(사유 포함). */
export type SnapshotResolution =
  | {
      readonly source: 'snapshot';
      readonly layers: unknown;
      readonly maintenanceDb: number | undefined;
      /** authority->'modules' — 코어 모듈 재실행 권위(raw jsonb, 미장착이면 null). */
      readonly modules: unknown;
    }
  | {
      readonly source: 'live';
      readonly reason: 'no-snapshot-id' | 'snapshot-missing' | 'ownership-mismatch' | 'stale' | 'reused';
    };

/**
 * 침공 행의 snapshot_id 를 해석해 검증 권위를 결정한다(순수 — DB I/O 없음, index.ts 가 조회
 * 결과를 넣는다). 레이스 B(스냅샷 대 검증 over-rejection) 완전 폐쇄의 판정 코어.
 *
 * 판정 순서(하나라도 어긋나면 라이브 경로 폴백 — 회귀 0·보안 무영향, 폴백은 항상 현행 라이브
 * 재대조라 위조 accept 불가):
 *   1. snapshot_id 없음 → 'no-snapshot-id' (현행 라이브 경로, 하위호환).
 *   2. 스냅샷 행 부재(GC·삭제) → 'snapshot-missing'.
 *   3. 소유권 불일치(attacker_id 또는 defense_id) → 'ownership-mismatch' (OQ#1 CRITICAL —
 *      공격자가 남의/약한 스냅샷을 가리키는 위조를 무효화).
 *   4. 신선도 초과(created_at 1시간 초과) → 'stale'.
 *   5. 재사용(이미 다른 확정 침공이 사용) → 'reused'.
 *   6. 전부 통과 → 스냅샷 권위(layers·maintenance) 사용. 이후 라이브 수호 재주입을 생략하고
 *      이 고정본으로 대조·재실행한다 → T0↔T1 사이 dismiss/retire/정비/풍화 무영향.
 */
export function resolveSnapshotAuthority(params: SnapshotResolutionParams): SnapshotResolution {
  if (params.invasionSnapshotId === null) return { source: 'live', reason: 'no-snapshot-id' };
  const snap = params.snapshot;
  if (snap === null) return { source: 'live', reason: 'snapshot-missing' };
  if (
    snap.attackerId !== params.invasionAttackerId ||
    snap.defenseId !== params.invasionDefenseId
  ) {
    return { source: 'live', reason: 'ownership-mismatch' };
  }
  if (!Number.isFinite(snap.createdAtMs) || params.nowMs - snap.createdAtMs > SNAPSHOT_FRESHNESS_MS) {
    return { source: 'live', reason: 'stale' };
  }
  if (params.reused) return { source: 'live', reason: 'reused' };
  return {
    source: 'snapshot',
    layers: snap.authorityLayers,
    maintenanceDb: snap.authorityMaintenanceDb,
    modules: snap.authorityModules,
  };
}

// ---------------------------------------------------------------------------
// 검증 본체
// ---------------------------------------------------------------------------

/**
 * 침공 리플레이 제출을 서버 권위로 전수 재실행해 무결성을 판정한다.
 *
 * @param raw    신뢰 불가 제출(RunSubmission 형태 — seed·config·inputs·claim).
 * @param server DB에서 로드한 권위 침공 컨텍스트(3레이어 배치·제한 시간·정비도).
 *
 * 절차:
 *   1) 구조 최소 검증(재실행 이전) + hashStream 필수 + invasion3 config 존재 강제.
 *   2) 제출 배치를 서버 권위 배치와 **정규형 전체 대조**(defense-mismatch 거부).
 *   3) 서버 권위 config로 오버라이드해 verifyRun에 위임(재실행·해시/결과 대조).
 *      → config를 조작해도 재실행이 서버 배치로 돌아가므로 hashStream이 갈려 거부된다.
 */
export function verifyInvasion(raw: unknown, server: InvasionServerContext): InvasionVerifyResult {
  // 서버 권위 배치 정규화. total function 이라 실패 분기가 없다 — 손상 슬롯은 비고, 결과는
  // 언제나 유효한 정규형이다. 클라도 **같은 함수**로 정규화한 본을 런·제출하므로, DB 에
  // 쓰레기가 섞여 있어도 정직 침공이 오거부되지 않는다(구 normalizeServerLayout 의 null
  // 반환 → server-layout-invalid 분기가 사라진 이유).
  const serverLayers: InvasionLayers = normalizeInvasionLayers(server.layers);

  if (typeof raw !== 'object' || raw === null) return reject('malformed-submission');
  const sub = raw as Record<string, unknown>;

  // (필수화 게이트) hashStream 없으면 즉시 거부 — 침공은 중간 발산 추적을 항상 확보.
  const claim = sub.claim as Record<string, unknown> | undefined;
  if (typeof claim !== 'object' || claim === null) return reject('malformed-submission');
  if (claim.hashStream === undefined) return reject('hash-stream-required');

  // (config 정당성 게이트) 침공은 config.invasion3 가 반드시 있어야 한다.
  if (sub.config === undefined) return reject('config-required');
  const cfg = asRecord(sub.config);
  if (cfg === null) return reject('config-required');
  const inv = asRecord(cfg.invasion3);
  if (inv === null) return reject('invasion-config-required');
  // layers 는 객체여야 한다. 배열·원시값은 "정규화하면 빈 배치"라 조용히 defense-mismatch 가
  // 되겠지만, 구조 결함과 위조를 진단상 구분하기 위해 별도 사유로 끊는다.
  if (asRecord(inv.layers) === null) return reject('malformed-layout');

  // 제한 시간 대조(시간 예산 3중 정합의 한 축 — 서버 상수 INVASION_TOTAL_TICKS 와 어긋나면 거부).
  if (!isFiniteNumber(inv.timeLimitTicks) || inv.timeLimitTicks !== server.timeLimitTicks) {
    return reject('defense-mismatch');
  }

  // 제출 배치 ↔ 서버 권위 배치 대조(약화된 가짜 방어 차단). layersEqual 은 정규형 **전체**를
  // 깊이 비교하므로 신규 필드가 대조에서 누락되는 보안 구멍이 구조적으로 생기지 않는다.
  if (!layersEqual(inv.layers, serverLayers)) {
    return reject('defense-mismatch');
  }

  // (시간예산 게이트) 침공 입력은 제한 시간(틱) 이내여야 한다 — 재실행 CPU 상한.
  if (Array.isArray(sub.inputs) && (sub.inputs as unknown[]).length > server.timeLimitTicks) {
    return reject('invasion-inputs-too-long');
  }

  // 서버 권위 config로 재실행하도록 오버라이드(제출 config의 다른 필드—공격자 로드아웃—는
  // 보존하되 invasion3 블록만 서버 값으로 교체). verifyRun이 구조 재검증·재실행·해시/결과
  // 대조를 수행한다. hashStream이 이미 존재하므로 verifyRun이 매 틱 대조를 강제한다.
  // 서버 권위 정비도로 재실행(풍화 반영). undefined 면 sim 이 완전 정비로 정규화 →
  // maintenance 대조는 layersEqual 에 불필요(서버 override + hashStream 재실행이 정비도
  // 불일치 위조를 hash-stream-divergence 로 잡는다). exactOptionalPropertyTypes 하에서
  // optional 필드에 undefined 명시 대입이 금지되므로, 정의된 경우에만 필드를 포함한다.
  const authoritativeInvasion: Invasion3Config = {
    layers: serverLayers,
    timeLimitTicks: server.timeLimitTicks,
  };
  if (server.maintenance !== undefined) authoritativeInvasion.maintenance = server.maintenance;
  // 코어 모듈 권위(M7b): 제출 config 의 modules 는 **읽지 않는다** — 공격자가 방어자 모듈을
  // 지워 보내는 위조를 원천 차단하기 위해 서버 스냅샷 authority 만 신뢰한다. 클라이언트도
  // 같은 스냅샷을 받아 같은 파서로 접었으므로 hashStream 이 일치한다.
  const serverModules = parseModulesAuthority(server.modules);
  if (serverModules !== null) authoritativeInvasion.modules = serverModules;
  // 구 침공 블록(`config.invasion`)을 떼어내던 방어선은 L11 에서 **필요가 없어졌다** — sim 이
  // 그 키를 읽는 경로 자체가 삭제돼(구 단일 아레나 침공 폐기) 공격자가 실어 보내도 엔티티가
  // 생기지 않는다. 정체불명 키는 재실행이 무시하므로 그대로 흘려보낸다. 침공 거동을 정하는
  // 유일한 필드인 `invasion3` 만 서버 권위로 덮는다.
  const authoritativeConfig: WorldConfig = {
    ...(cfg as unknown as WorldConfig),
    invasion3: authoritativeInvasion,
  };
  const authoritativeSubmission = {
    seed: sub.seed,
    config: authoritativeConfig,
    inputs: sub.inputs,
    claim: sub.claim,
  };

  const result: VerifyResult = verifyRun(authoritativeSubmission);
  return result.computed === undefined
    ? { verdict: result.verdict, reason: result.reason }
    : { verdict: result.verdict, reason: result.reason, computed: result.computed };
}
