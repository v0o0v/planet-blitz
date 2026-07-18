/**
 * verify-invasion 검증 코어 (M4 Phase D · D1 · ADR-0005).
 *
 * verify-run(Phase A)의 순수 재실행 검증을 침공(PvP)용으로 좁힌 게이트다. Phase A의
 * `verifyRun`은 "제출된 [seed+config+inputs]가 주장 결과를 내적으로 재현하는가"만
 * 증명했다(verifyCore.ts 상단 carry-forward 경고). 침공은 결과가 영구 래더(ADR-0004)에
 * 직결되므로, verify-run README "Phase D 착수 조건" 3건을 이 코어에서 강제한다:
 *
 *   1. **config 정당성 대조** — 클라이언트가 보낸 방어 배치(config.invasion.layout·
 *      timeLimitTicks)를 서버가 DB(defenses)에서 로드한 **권위 배치**와 정확히 대조한다.
 *      불일치(약화된 가짜 방어로 쉽게 이긴 척)는 `defense-mismatch`로 거부한다. 재실행은
 *      제출 config가 아니라 **서버 권위 config**로 돌려, config를 조작해도 재현이 갈리게 한다.
 *   2. **hashStream 필수화** — verify-run에서 선택이던 틱별 해시 스트림을 침공에서는
 *      필수로 강제한다(`hash-stream-required`). 중간 발산 지점(위조 추적 근거)을 항상 확보.
 *   3. **재실행 시간예산 가드** — 입력 길이를 침공 제한 시간(timeLimitTicks) 이내로
 *      제한(`invasion-inputs-too-long`)해 재실행 CPU를 상한한다. wall-clock 가드는 배선
 *      계층(index.ts)이 담당한다.
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
import { TURRET_TYPE_COUNT } from '../../../src/sim/defense.js';
import type {
  DefenseLayout,
  InvasionConfig,
  TurretPlacement,
  ObstaclePlacement,
  GuardianPlacement,
} from '../../../src/sim/defense.js';
import { MAX_GUARDIAN_SLOTS, GUARDIAN_PRESET_COUNT, PERFORMANCE_FULL } from '../../../data/guardian.js';
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
   * defenses 테이블에서 로드한 방어자 배치(raw jsonb — 신뢰하되 정규화 필요).
   * verifyInvasion 이 {@link normalizeServerLayout}(클라이언트 normalizeLayout 동일
   * 규칙)로 정규화한 본을 대조·재실행의 진실값으로 쓴다(리뷰 MED-3 대칭화). 정규화
   * 불능이면 `server-layout-invalid` 로 거부한다.
   */
  layout: unknown;
  /** 서버가 인정하는 제한 시간(틱). 기본 3분(DEFAULT_TIME_LIMIT_TICKS). */
  timeLimitTicks: number;
  /**
   * 방어 정비도(풍화, ADR-0006) — **정수 centi-percent**(0..MAINTENANCE_FULL=10000).
   * DB `defenses.maintenance`(numeric(5,2), 0~100)를 배선 계층(index.ts)이 `Math.round(db*100)`
   * 로 변환해 싣는다(클라이언트 변환 공식과 반드시 동일 — 어긋나면 정직한 런이 오거부된다).
   * 서버 재실행은 이 값으로 포탑 발사 간격을 스케일(0%→2배 느림, ADR-0006 "0%→성능 50%")한다.
   * **미지정(undefined)이면 완전 정비**로 취급(sim `normalizeMaintenance` 가 MAINTENANCE_FULL
   * 로 정규화) → 이 필드가 없던 기존 침공 검증과 거동·해시 100% 불변(하위호환).
   */
  maintenance?: number;
}

function reject(reason: InvasionRejectReason, computed?: ComputedFacts): InvasionVerifyResult {
  return computed === undefined
    ? { verdict: 'reject', reason }
    : { verdict: 'reject', reason, computed };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 코어/포탑/장애물 좌표를 raw IEEE-754 비트로 정확히 대조한다(해시 대조와 같은 엄밀도). */
function numEq(a: number, b: number): boolean {
  // Object.is로 -0/NaN까지 엄격 대조(재실행 해시가 raw 비트를 접으므로 동일 규율).
  return Object.is(a, b);
}

/** 수호 스냅샷의 결정론 정수 필드 이름(대조·정규화 공통 순회). */
const GUARDIAN_SNAPSHOT_KEYS: readonly (keyof GuardianSnapshot)[] = [
  'preset',
  'radius',
  'hp',
  'contactDamage',
  'fireCooldown',
  'bulletDamage',
  'bulletSpeed',
  'bulletRadius',
  'bulletLife',
  'range',
  'moveSpeed',
  'standoff',
];

/**
 * DB layout 의 수호 배열을 검증·정규화한다(M5). 각 항목은 좌표(x/y)·성능%·계보 보너스·스냅샷
 * (12개 정수 필드)이 모두 유한해야 한다. 하나라도 손상이면 전체 무효(null)로 본다 — 수호는
 * 방어전 결과를 바꾸는 결정론 입력이라, 손상 데이터로 조용히 스킵하면 재현이 갈린다. 상한
 * (MAX_GUARDIAN_SLOTS) 초과분은 sim spawn 이 자르므로 서버 정규화도 동일하게 자른다.
 * guardians 자체가 없으면(구 배치·수호 미보유) undefined 반환 → layout 에 필드 미포함.
 */
function normalizeGuardians(raw: unknown): GuardianPlacement[] | undefined | null {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return null;
  const out: GuardianPlacement[] = [];
  const n = raw.length < MAX_GUARDIAN_SLOTS ? raw.length : MAX_GUARDIAN_SLOTS;
  for (let i = 0; i < n; i++) {
    const g = raw[i];
    if (typeof g !== 'object' || g === null) return null;
    const gg = g as Record<string, unknown>;
    if (!isFiniteNumber(gg.x) || !isFiniteNumber(gg.y)) return null;
    if (!isFiniteNumber(gg.performanceCP) || !isFiniteNumber(gg.lineageBonusBp)) return null;
    const snapRaw = gg.snapshot;
    if (typeof snapRaw !== 'object' || snapRaw === null) return null;
    const sr = snapRaw as Record<string, unknown>;
    const snap: Record<string, number> = {};
    for (const k of GUARDIAN_SNAPSHOT_KEYS) {
      const v = sr[k];
      if (!isFiniteNumber(v)) return null;
      snap[k] = v;
    }
    const preset = snap.preset ?? -1;
    if (preset < 0 || preset >= GUARDIAN_PRESET_COUNT) return null;
    // 마일스톤 마스크(M5): 있으면 정규화(0..7)해 보존, 0/미지정이면 키 생략(해시 조건부 접기와
    // 정합 — 마스크 0 은 replay.ts 가 접지 않아 바이트 불변). 비유한은 손상으로 보지 않고 0 처리.
    const ms = normalizeMilestones(isFiniteNumber(gg.milestones) ? gg.milestones : 0);
    const placement: GuardianPlacement = {
      x: gg.x,
      y: gg.y,
      performanceCP: gg.performanceCP,
      lineageBonusBp: gg.lineageBonusBp,
      snapshot: snap as unknown as GuardianSnapshot,
    };
    if (ms !== 0) placement.milestones = ms;
    out.push(placement);
  }
  return out;
}

/** 제출 수호 배열이 서버 권위 배열과 완전히 동일한지 대조(순서·전 필드 raw 비트). */
function guardiansEqual(
  sub: GuardianPlacement[] | undefined,
  srv: GuardianPlacement[] | undefined,
): boolean {
  const a = sub ?? [];
  const b = srv ?? [];
  if (a.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (!numEq(x.x, y.x) || !numEq(x.y, y.y)) return false;
    if (x.performanceCP !== y.performanceCP || x.lineageBonusBp !== y.lineageBonusBp) return false;
    // 마일스톤 마스크 대조(M5): 서버 권위 마스크(계보 레벨 재도출)와 제출이 어긋나면 거부한다
    // (부풀린 마일스톤 위조 차단). 정규화 후 비교(미지정=0).
    if (normalizeMilestones(x.milestones) !== normalizeMilestones(y.milestones)) return false;
    for (const k of GUARDIAN_SNAPSHOT_KEYS) {
      if (!numEq(x.snapshot[k], y.snapshot[k])) return false;
    }
  }
  return true;
}

/**
 * 제출된 방어 배치가 서버 권위 배치와 완전히 동일한지 대조한다. 순서까지 동일해야
 * 한다(hashWorld가 turrets/obstacles를 배열 순서대로 접으므로 순서가 결정론 입력이다).
 * 하나라도 어긋나면 false → `defense-mismatch`.
 */
function layoutEquals(sub: DefenseLayout, srv: DefenseLayout): boolean {
  if (!numEq(sub.core.x, srv.core.x) || !numEq(sub.core.y, srv.core.y)) return false;
  if (sub.turrets.length !== srv.turrets.length) return false;
  for (let i = 0; i < srv.turrets.length; i++) {
    const a = sub.turrets[i]!;
    const b = srv.turrets[i]!;
    if (a.type !== b.type || !numEq(a.x, b.x) || !numEq(a.y, b.y)) return false;
  }
  if (sub.obstacles.length !== srv.obstacles.length) return false;
  for (let i = 0; i < srv.obstacles.length; i++) {
    const a = sub.obstacles[i]!;
    const b = srv.obstacles[i]!;
    if (
      !numEq(a.x, b.x) ||
      !numEq(a.y, b.y) ||
      !numEq(a.halfW, b.halfW) ||
      !numEq(a.halfH, b.halfH)
    ) {
      return false;
    }
  }
  // M5 수호 기체 대조(순서·전 스냅샷 필드). 서버 권위 배열이 진실 — 제출이 다르면 거부.
  if (!guardiansEqual(sub.guardians, srv.guardians)) return false;
  return true;
}

/**
 * DB 에서 로드한 방어 배치를 클라이언트 `normalizeLayout`(src/ui/defenseCommand.ts:293)과
 * **완전히 동일한 규칙**으로 정규화한다(리뷰 MED-3 대칭화). 클라이언트는 stored layout 을
 * 이 정규화 본으로 런·제출하므로, 서버도 같은 본으로 대조·재실행해야 정상 침공이
 * defense-mismatch 로 오거부되지 않는다. 규칙(클라와 자구 일치):
 *   - core.x/y 유한 숫자 아님 → 전체 무효(null).
 *   - 포탑: 비객체/비유한 필드 스킵, type 은 trunc 후 0..TURRET_TYPE_COUNT-1 범위 밖 스킵.
 *   - 장애물: 비객체/비유한 필드 스킵, halfW/halfH <= 0 스킵.
 *   - guardianSlots 드롭(대조·해시 대상 아님, M5 자리).
 * 좌표 값 자체는 변형하지 않으므로(필터만) 정규형 layout 에 적용하면 항등이다.
 */
export function normalizeServerLayout(raw: unknown): DefenseLayout | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const d = raw as Record<string, unknown>;
  const core = d.core;
  if (typeof core !== 'object' || core === null) return null;
  const cx = (core as Record<string, unknown>).x;
  const cy = (core as Record<string, unknown>).y;
  if (!isFiniteNumber(cx) || !isFiniteNumber(cy)) return null;

  const turrets: TurretPlacement[] = [];
  if (Array.isArray(d.turrets)) {
    for (const t of d.turrets) {
      if (typeof t !== 'object' || t === null) continue;
      const tt = t as Record<string, unknown>;
      if (!isFiniteNumber(tt.type) || !isFiniteNumber(tt.x) || !isFiniteNumber(tt.y)) continue;
      const type = Math.trunc(tt.type);
      if (type < 0 || type >= TURRET_TYPE_COUNT) continue;
      turrets.push({ type, x: tt.x, y: tt.y });
    }
  }

  const obstacles: ObstaclePlacement[] = [];
  if (Array.isArray(d.obstacles)) {
    for (const o of d.obstacles) {
      if (typeof o !== 'object' || o === null) continue;
      const oo = o as Record<string, unknown>;
      if (!isFiniteNumber(oo.x) || !isFiniteNumber(oo.y) || !isFiniteNumber(oo.halfW) || !isFiniteNumber(oo.halfH)) {
        continue;
      }
      if (oo.halfW <= 0 || oo.halfH <= 0) continue;
      obstacles.push({ x: oo.x, y: oo.y, halfW: oo.halfW, halfH: oo.halfH });
    }
  }

  // M5 수호 기체 정규화(손상 데이터는 전체 무효 → server-layout-invalid). 없으면 필드 미포함.
  const guardians = normalizeGuardians(d.guardians);
  if (guardians === null) return null;

  const layout: DefenseLayout = { core: { x: cx, y: cy }, turrets, obstacles };
  if (guardians !== undefined) layout.guardians = guardians;
  return layout;
}

/** 신뢰 불가 값이 DefenseLayout 구조를 만족하는지(대조 전에 형태 검증). */
function isValidLayout(v: unknown): v is DefenseLayout {
  if (typeof v !== 'object' || v === null) return false;
  const l = v as Record<string, unknown>;
  const core = l.core as Record<string, unknown> | undefined;
  if (typeof core !== 'object' || core === null) return false;
  if (!isFiniteNumber(core.x) || !isFiniteNumber(core.y)) return false;
  if (!Array.isArray(l.turrets) || !Array.isArray(l.obstacles)) return false;
  for (const t of l.turrets as unknown[]) {
    if (typeof t !== 'object' || t === null) return false;
    const r = t as Record<string, unknown>;
    if (!isFiniteNumber(r.type) || !isFiniteNumber(r.x) || !isFiniteNumber(r.y)) return false;
  }
  for (const o of l.obstacles as unknown[]) {
    if (typeof o !== 'object' || o === null) return false;
    const r = o as Record<string, unknown>;
    if (
      !isFiniteNumber(r.x) ||
      !isFiniteNumber(r.y) ||
      !isFiniteNumber(r.halfW) ||
      !isFiniteNumber(r.halfH)
    ) {
      return false;
    }
  }
  // M5 수호 기체(있으면) 구조 검증: 배열이며 각 항목이 좌표·성능·보너스·스냅샷 정수를 갖춰야
  // 한다. normalizeGuardians 와 동일 규칙을 형태 검증으로만 재사용(값 대조는 layoutEquals).
  if (l.guardians !== undefined && normalizeGuardians(l.guardians) === null) return false;
  return true;
}

// ---------------------------------------------------------------------------
// 수호 권위 주입 (M5 — 정비도 주입과 대칭. index.ts 배선이 소비, deno 테스트가 검증)
// ---------------------------------------------------------------------------

/**
 * 서버가 DB `guardians` 에서 로드한 방어자 활성 수호 1기(권위 주입 입력). 신뢰 경계:
 * `data`(복사 스냅샷)·`combatScore` 는 클라 빌드 파생이라 클라 정본 미러지만(migration
 * 20260718100000 헤더 신뢰 경계 참조), **`performance`(풍화 축)는 서버 권위**다 —
 * 정비도와 동일하게 PvP 결정에 직결되는 축만 서버가 봉인한다.
 */
export interface AuthoritativeGuardianRow {
  /** guardians.data — 퇴역 복사 스냅샷 jsonb(신뢰 불가 → normalizeGuardians 가 검증). */
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
 * 방어 배치 layout 의 수호 슬롯을 **DB 권위 값으로 재구성**한다(M5 서버 권위 주입 — 정비도
 * 주입과 대칭). 공격자 제출 config 의 수호 성능%·계보 보너스·스냅샷을 신뢰하지 않고, 방어자의
 * 라이브 `guardians`(풍화된 performance)·`profiles.lineage_guardian_level` 로 덮어쓴다.
 *
 * 매핑(클라 `buildGuardianPlacements`(src/save/guardianLifecycle.ts) 와 동일 규칙):
 *   - **슬롯 위치(x/y)**: 저장된 방어 배치(`defenses.layout.guardians[i]`)에서 온다 — 방어자
 *     배치 결정이라 풍화 대상이 아니고 서버가 그대로 존중한다.
 *   - **스냅샷/성능%/보너스**: 활성 수호를 결정론 순서(created_at, id — index.ts 조회 + 클라
 *     fetchGuardians 조회 순서 일치)로 슬롯 i ↔ 활성 수호 i 매핑해 주입한다.
 *   - **계보 보너스**: `branchBonusBp(lineageGuardianLevel)` — 클라 `guardianBonusBp` 와 동일 곡선.
 *   - 슬롯 수·활성 수호 수·MAX_GUARDIAN_SLOTS 중 최솟값까지만 채운다(초과 슬롯 드롭 — 클라와 동일).
 *
 * 입력 layout 은 불변(얕은 복제로 guardians 만 교체). 수호 슬롯이 없거나 활성 수호가 없으면
 * guardians 필드를 제거해 반환한다 → 수호 미포함 침공은 거동·해시가 완전 불변(하위호환).
 * 주입된 스냅샷의 정합성은 이후 normalizeServerLayout/normalizeGuardians 가 검증한다(손상 →
 * server-layout-invalid).
 */
export function injectGuardianAuthority(
  rawLayout: unknown,
  guardians: readonly AuthoritativeGuardianRow[],
  lineageGuardianLevel: number,
): unknown {
  if (typeof rawLayout !== 'object' || rawLayout === null) return rawLayout;
  const layout = rawLayout as Record<string, unknown>;
  const slots = Array.isArray(layout.guardians) ? (layout.guardians as unknown[]) : [];
  const bonusBp = branchBonusBp(
    typeof lineageGuardianLevel === 'number' && Number.isFinite(lineageGuardianLevel)
      ? lineageGuardianLevel
      : 0,
  );
  // 마일스톤 마스크도 계보 레벨에서 권위 재도출한다(보너스 곡선과 동일 — 계정 단위). 공격자 제출
  // 마스크를 신뢰하지 않고 방어자 라이브 레벨로 덮는다(위조 시 defense-mismatch). 0 이면 키 생략.
  const milestones = normalizeMilestones(
    guardianMilestones(
      typeof lineageGuardianLevel === 'number' && Number.isFinite(lineageGuardianLevel)
        ? lineageGuardianLevel
        : 0,
    ),
  );
  const n = Math.min(slots.length, guardians.length, MAX_GUARDIAN_SLOTS);
  const authoritative: GuardianPlacement[] = [];
  for (let i = 0; i < n; i++) {
    const slot = slots[i];
    const sr = typeof slot === 'object' && slot !== null ? (slot as Record<string, unknown>) : {};
    const row = guardians[i]!;
    const placement: GuardianPlacement = {
      x: isFiniteNumber(sr.x) ? sr.x : 0,
      y: isFiniteNumber(sr.y) ? sr.y : 0,
      snapshot: row.data as GuardianSnapshot,
      performanceCP: performanceToCenti(row.performance),
      lineageBonusBp: bonusBp,
    };
    if (milestones !== 0) placement.milestones = milestones;
    authoritative.push(placement);
  }
  const out: Record<string, unknown> = { ...layout };
  if (authoritative.length > 0) out.guardians = authoritative;
  else delete out.guardians;
  return out;
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
  /** authority->'layout' — T0 고정 수호 권위 주입 완료 layout(raw jsonb). */
  readonly authorityLayout: unknown;
  /** authority->>'maintenance' — DB 정비도(numeric 0..100) 또는 미지정. index.ts 가 centi 변환. */
  readonly authorityMaintenanceDb: number | undefined;
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
  | { readonly source: 'snapshot'; readonly layout: unknown; readonly maintenanceDb: number | undefined }
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
 *   6. 전부 통과 → 스냅샷 권위(layout·maintenance) 사용. 이후 라이브 수호 재주입을 생략하고
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
  return { source: 'snapshot', layout: snap.authorityLayout, maintenanceDb: snap.authorityMaintenanceDb };
}

/**
 * 침공 리플레이 제출을 서버 권위로 전수 재실행해 무결성을 판정한다.
 *
 * @param raw    신뢰 불가 제출(RunSubmission 형태 — seed·config·inputs·claim).
 * @param server DB에서 로드한 권위 침공 컨텍스트(방어 배치·제한 시간).
 *
 * 절차:
 *   1) 구조 최소 검증(재실행 이전) + hashStream 필수 + invasion config 존재 강제.
 *   2) 제출 방어 배치를 서버 권위 배치와 대조(defense-mismatch 거부).
 *   3) 서버 권위 config로 오버라이드해 verifyRun에 위임(재실행·해시/결과 대조).
 *      → config를 조작해도 재실행이 서버 배치로 돌아가므로 hashStream이 갈려 거부된다.
 */
export function verifyInvasion(raw: unknown, server: InvasionServerContext): InvasionVerifyResult {
  // (서버 데이터 게이트, 리뷰 MED-3) DB layout 을 클라이언트와 동일 규칙으로 정규화.
  // 정규화 불능(코어 좌표 손상 등)은 제출 측 위조가 아니라 서버 데이터 문제이므로
  // 별도 사유로 거부한다 — 이후 모든 대조·재실행은 이 정규화 본을 진실값으로 쓴다.
  const serverLayout = normalizeServerLayout(server.layout);
  if (serverLayout === null) return reject('server-layout-invalid');

  if (typeof raw !== 'object' || raw === null) return reject('malformed-submission');
  const sub = raw as Record<string, unknown>;

  // (필수화 게이트) hashStream 없으면 즉시 거부 — 침공은 중간 발산 추적을 항상 확보.
  const claim = sub.claim as Record<string, unknown> | undefined;
  if (typeof claim !== 'object' || claim === null) return reject('malformed-submission');
  if (claim.hashStream === undefined) return reject('hash-stream-required');

  // (config 정당성 게이트) 침공은 config.invasion.layout이 반드시 있어야 한다.
  if (sub.config === undefined) return reject('config-required');
  if (typeof sub.config !== 'object' || sub.config === null) return reject('config-required');
  const cfg = sub.config as Record<string, unknown>;
  const inv = cfg.invasion as Record<string, unknown> | undefined;
  if (typeof inv !== 'object' || inv === null) return reject('invasion-config-required');
  if (!isValidLayout(inv.layout)) return reject('malformed-layout');
  const submittedLayout = inv.layout as DefenseLayout;

  // 제출 배치 ↔ 서버 권위 배치 대조(약화된 가짜 방어 차단). 제한 시간도 대조.
  if (!isFiniteNumber(inv.timeLimitTicks) || (inv.timeLimitTicks as number) !== server.timeLimitTicks) {
    return reject('defense-mismatch');
  }
  if (!layoutEquals(submittedLayout, serverLayout)) {
    return reject('defense-mismatch');
  }

  // (시간예산 게이트) 침공 입력은 제한 시간(틱) 이내여야 한다 — 재실행 CPU 상한.
  if (Array.isArray(sub.inputs) && (sub.inputs as unknown[]).length > server.timeLimitTicks) {
    return reject('invasion-inputs-too-long');
  }

  // 서버 권위 config로 재실행하도록 오버라이드(제출 config의 다른 필드—공격자 로드아웃—는
  // 보존하되 invasion 블록만 서버 값으로 교체). verifyRun이 구조 재검증·재실행·해시/결과
  // 대조를 수행한다. hashStream이 이미 존재하므로 verifyRun이 매 틱 대조를 강제한다.
  // 서버 권위 정비도로 재실행(풍화 반영). undefined 면 sim 이 완전 정비로 정규화(하위호환) →
  // maintenance 대조는 layoutEquals 에 불필요(서버 override + hashStream 재실행이 정비도
  // 불일치 위조를 hash-stream-divergence 로 잡는다). exactOptionalPropertyTypes 하에서
  // optional 필드에 undefined 명시 대입이 금지되므로, 정의된 경우에만 필드를 포함한다.
  const authoritativeInvasion: InvasionConfig =
    server.maintenance === undefined
      ? { layout: serverLayout, timeLimitTicks: server.timeLimitTicks }
      : { layout: serverLayout, timeLimitTicks: server.timeLimitTicks, maintenance: server.maintenance };
  const authoritativeConfig: WorldConfig = {
    ...(sub.config as WorldConfig),
    invasion: authoritativeInvasion,
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
