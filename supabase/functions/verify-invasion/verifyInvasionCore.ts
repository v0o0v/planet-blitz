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
} from '../../../src/sim/defense.js';

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

  return { core: { x: cx, y: cy }, turrets, obstacles };
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
  return true;
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
