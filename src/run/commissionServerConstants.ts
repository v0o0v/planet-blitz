/**
 * 의뢰서 **서버 축** 상수 — SQL 미러의 TS 정본 (서버 계약 rev3 §5·§6·§10).
 *
 * ## 이 모듈이 따로 있는 이유
 * `commissionConstants.ts` 는 sim·UI 가 읽는 런 형태의 상수를 진다. 여기 있는 값은 **서버
 * 마이그레이션 SQL 안에 같은 수치가 한 번 더 적히는** 것들이다 — 즉 이 파일의 존재 이유는
 * "값을 담는 것"이 아니라 **SQL 과의 불일치를 테스트가 잡을 수 있게 하는 것**이다
 * (`20260727000000_catalyst_ledger.sql:43-46` 선례). 값을 고칠 때는 **반드시 SQL 도 함께**
 * 고쳐라. 한쪽만 고치면 `tests/commissionServerConstants.test.ts` 가 실패한다.
 *
 * ## 하드코딩 금지
 * 소비처(EF `verify-commission` · 클라 게이트웨이 · 테스트)는 전부 이 모듈을 읽는다. 같은
 * 수치를 소비처에 다시 적으면 "여기만 고쳐서 안 먹는" 결함이 열린다 — 이 저장소가 반복해서
 * 겪은 실패 모드다.
 */

/**
 * 프로필당 **시간당 발령 시도 상한**(서버 계약 §2-4).
 *
 * ⚠️ **이것이 발령 빈도를 묶는 유일한 실질 방어다.** 발령 자격(`victory`·`bossKilled`)은
 * 클라 주장이고(ADR-0026 의 PvE 신뢰 모델), 재고 상한은 소비하면 다시 차므로 빈도를 묶지
 * 못한다. 밸런스 큐가 아니라 **서버 계약이 이 값을 진다**(미정으로 두면 방어 미조달).
 *
 * 세는 대상은 `commission_issues` 중 **`claimed_victory` 인 행**이다 — 패배 정산까지 세면
 * 정직한 빠른 재시작 플레이어의 의뢰서를 끊으면서 위조자에게는 아무 비용도 물리지 않는다.
 *
 * SQL 미러: `CAP_ISSUE_ATTEMPTS_PER_HOUR` (`issue_commission_for_run` 3단계).
 */
export const CAP_ISSUE_ATTEMPTS_PER_HOUR = 20;

/**
 * 프로필당 **시간당 출격 상한**(서버 계약 §5-2 ②).
 *
 * 상한을 **행 생성 지점**(`consume_commission`)에 둔다. `mark_commission_active` 는 상태
 * 전이라 행당 정확히 1회만 성공하므로 별도 카운터가 불필요하다 — 열거식 방어를 만들지 않는다.
 *
 * SQL 미러: `CAP_CONSUME_PER_HOUR` (`consume_commission` 2단계).
 */
export const CAP_CONSUME_PER_HOUR = 12;

/**
 * 한 `commission_runs` 행이 허용하는 **EF 재실행 시도 횟수**(서버 계약 §5-7).
 *
 * ⚠️ 카운터 증가는 **`settle_commission` 과 별개의 트랜잭션**이어야 한다. 같은 트랜잭션에
 * 넣으면 "응답 직전 연결을 끊는" 공격에서 롤백으로 카운터가 사라져 아무것도 막지 못한다.
 *
 * 계정당 CPU 상한이 여기서 닫힌다: `CAP_CONSUME_PER_HOUR × CAP_VERIFY_ATTEMPTS` =
 * 시간당 최대 60 회의 `verifyRun`.
 *
 * SQL 미러: `bump_commission_verify_attempts` 의 소비처(EF 게이트 6b).
 */
export const CAP_VERIFY_ATTEMPTS = 5;

/** `issued → active` 전이 유예(ms). 서버 계약 §5-3. **UX 요건이지 방어 요건이 아니다.** */
export const GRACE_ISSUED_TO_ACTIVE_MS = 10 * 60 * 1000;

/**
 * `active` 런의 제출 가능 창(ms). 서버 계약 §5-4 4b · EF 게이트 0c′.
 *
 * ⚠️ 나이 검사는 **판정 지점 둘에 직접** 박혀 있다(RPC·EF). cron ③ 은 청소 담당일 뿐
 * 판정 주체가 아니다 — cron 은 매시 정각이라 판정을 맡기면 최대 1시간의 제출 창이 샌다.
 */
export const COMMISSION_ACTIVE_TTL_MS = 24 * 60 * 60 * 1000;

/** `replay_gz` 보존 기간(ms). 침공과 동일. 서버 계약 §6 ②. */
export const COMMISSION_BLOB_TTL_MS = 48 * 60 * 60 * 1000;

/** `commission_issues` 보존 기간(ms). `currency_grants`·`pve_runs` 와 같은 결. 서버 계약 §6 ④. */
export const COMMISSION_ISSUES_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * `source='commission'` 의 per-call 지급 캡. 서버 계약 §5-1.
 *
 * ⚠️ `grant_currency_for` 의 `case p_source` 에 **분기를 반드시 신설**해야 한다. 분기가 없으면
 * 미등록 source 로 떨어져 `CAP_DEFAULT_*`(1,000)로 **조용히 클램프**된다.
 *
 * `CAP_HOURLY_*`(50,000) 아래로 두어 정직한 1회 지급이 누적 캡에 먼저 걸리지 않게 한다.
 */
export const CAP_COMMISSION_CREDITS = 30000;
/** @see CAP_COMMISSION_CREDITS */
export const CAP_COMMISSION_MINERALS = 30000;

/**
 * 지시 수신소 **보관 상한** — ⚠️ **플레이스홀더**(서버 계약 §13-① · 밸런스 큐 C4).
 *
 * `CONTEXT.md` 가 "보관 상한이 있어 꽉 차면 새 의뢰서가 들어오지 않는다"를 용어 정본으로
 * 못 박았으나 숫자가 없다. **수신소 UI 레인과 함께 확정한다.** 그 전까지 발령 4단계가 이 값을
 * 읽는다. 이 값은 방어가 아니라 **긴장 설계**의 축이다(빈도 상한이 방어를 진다).
 */
export const COMMISSION_STOCK_CAP = 12;

/**
 * `grant_currency`(클라 진입점)가 허용하는 **source allowlist**(default-deny). 서버 계약 §5-1 C1.
 *
 * ⚠️ **이 목록 밖은 전부 거부된다.** 이것은 이 레인이 만든 제약이 아니라 **이미 열려 있던
 * 구멍을 닫는 것**이다 — 미등록 source 는 `CAP_DEFAULT_*`(1,000/1,000)로 통과했고 개연성 캡은
 * `pve_run` 에만 걸리므로, 인증된 아무 사용자가 임의 문자열로 **시간당 50,000/50,000, 일
 * 300,000/300,000 을 런 없이** 얻을 수 있었다(ADR-0027 결과 절에 기록).
 *
 * 전수 근거(grep 확인): `pve_run` = `settle_pve_run` 내부 중첩 호출 · `story` = 사연 보상 ·
 * `salvage` = 격납고 살베지.
 */
export const GRANT_CURRENCY_CLIENT_SOURCES = ['pve_run', 'salvage', 'story'] as const;

/** @see GRANT_CURRENCY_CLIENT_SOURCES */
export type GrantCurrencyClientSource = (typeof GRANT_CURRENCY_CLIENT_SOURCES)[number];

/**
 * `grant_currency_for`(공유 본문)의 `case p_source` 분기가 가져야 하는 **전체 라벨 집합**.
 *
 * 클라 allowlist + `commission`(서버 전용 진입). **AC-G2 가 이 집합과 SQL 의 `case` 분기
 * 라벨 집합이 같은지 단언한다** — 값 일치가 아니라 **집합 일치**다. 그래야 "`case` 에 분기만
 * 추가하고 allowlist 를 빠뜨림"이 잡힌다.
 */
export const GRANT_CURRENCY_ALL_SOURCES = [
  ...GRANT_CURRENCY_CLIENT_SOURCES,
  'commission',
] as const;

/** @see GRANT_CURRENCY_ALL_SOURCES */
export type GrantCurrencySource = (typeof GRANT_CURRENCY_ALL_SOURCES)[number];

/** 클라가 직접 지정할 수 있는 source 인지. `flushPendingGrants` 가 큐 위생에 쓴다(AC-C10). */
export function isGrantCurrencyClientSource(source: string): source is GrantCurrencyClientSource {
  return (GRANT_CURRENCY_CLIENT_SOURCES as readonly string[]).includes(source);
}

/**
 * 의뢰 전용 유니크의 `LoadoutConfig.uniqueMask` 비트 집합(서버 계약 §7-3 게이트 4).
 *
 * ⚠️ **플레이스홀더 — 현재 비어 있다(미확인, Phase D 의존).** "의뢰 전용 유니크" 카탈로그
 * (개별 유니크가 어느 비트를 쓰는가)는 아직 PA 레인이 만들지 않았다 — `src/items/uniques.ts`
 * 의 `UNIQUE_REGISTRY` 는 계급·의뢰 여부와 무관한 공용 레지스트리다. **이 목록이 비어 있는
 * 한 게이트 4 는 구조적으로 아무것도 막지 못한다**(순회할 항목이 없어 항상 통과) — 이것은
 * 방어가 아니라 **방어를 걸 자리**다. Phase D 가 의뢰 전용 유니크를 등록하면 그 bit 번호를
 * 여기에 추가해야 게이트가 실제로 작동한다. `verify-commission` 의 게이트 4(`evaluateCommissionGates`)
 * 가 이 배열을 순회해, 켜진 비트가 있는데 그 profile 의 `commission_grants` 에 대응 발급
 * 기록이 없으면 `commission-unauthorized-unique` 로 거부한다.
 */
export const COMMISSION_EXCLUSIVE_UNIQUE_BITS: readonly number[] = [];

/**
 * 의뢰 전용 유니크의 **`uniqueId` → `bit`** 대응표(게이트 4의 발급 기록 조회용).
 *
 * ## 왜 이것이 필요한가 — 필드 이름이 어긋나 있었다
 * `settle_commission` 은 발급 행에 `item_payload = {"uniqueId": ...}` 를 쓰는데
 * (20260803000000:872), EF 게이트 4 는 `item_payload.bit` 를 읽었다. 즉 **쓰는 이름과 읽는
 * 이름이 다르다.** 오늘은 {@link COMMISSION_EXCLUSIVE_UNIQUE_BITS} 가 비어 게이트가 구조적으로
 * 아무것도 안 보므로 무해하지만, 카탈로그가 채워지는 날 조회가 항상 빈 집합을 돌려주어
 * **정직하게 발급받은 플레이어가 `commission-unauthorized-unique` 로 오거부된다.**
 *
 * 고치는 자리로 SQL 이 아니라 EF 를 고른 이유: `settle_commission` 재정의를 피하기 위해서다
 * (낡은 본문 복제가 이 리포의 프로덕션을 100% 깨뜨린 전례 — 20260802000000:4-15).
 * EF 는 이제 `bit`·`uniqueId` **둘 다** 읽고, 후자를 이 표로 비트로 접는다.
 *
 * ## 왜 `UNIQUE_REGISTRY` 를 직접 읽지 않는가
 * 그쪽이 정본이고 여기는 미러라 드리프트 위험이 있다 — 그럼에도 미러인 이유는 EF(Deno)가
 * `data/uniques.ts` 를 import 하면 그 파일의 `.js` 확장자 스펙파이어 체인(`src/sim/uniques.js`
 * 등)까지 끌려와 Deno 해석이 깨지기 때문이다. EF 가 이미 문제없이 import 하고 있는 모듈은
 * 이 상수 파일뿐이라 여기에 둔다.
 *
 * ⚠️ **플레이스홀더 — 현재 비어 있다.** Phase D 가 의뢰 전용 유니크를 등록할 때
 *    `COMMISSION_EXCLUSIVE_UNIQUE_BITS` 와 **함께** 채워야 한다. 한쪽만 채우면 게이트가
 *    켜지는데 발급 기록을 못 읽어 정직한 플레이어를 막는다.
 */
export const COMMISSION_EXCLUSIVE_UNIQUE_ID_BITS: Readonly<Record<string, number>> = {};

/**
 * 시간 상수 정렬 불변식 — `GRACE < ACTIVE_TTL < BLOB_TTL < ISSUES_RETENTION` (서버 계약 §10).
 *
 * 이 부등식이 깨지면 수명·GC 검증표의 "안전" 판정 중 하나가 무너진다. 대표적으로
 * `ACTIVE_TTL >= BLOB_TTL` 이면 **재시도 창 안에 리플레이가 사라진다**.
 * **AC-G1 이 이 함수를 단언한다.**
 */
export function commissionTtlOrderingHolds(): boolean {
  return (
    GRACE_ISSUED_TO_ACTIVE_MS < COMMISSION_ACTIVE_TTL_MS &&
    COMMISSION_ACTIVE_TTL_MS < COMMISSION_BLOB_TTL_MS &&
    COMMISSION_BLOB_TTL_MS < COMMISSION_ISSUES_RETENTION_MS
  );
}

/**
 * 의뢰서 **폐기** 시간당 상한 — SQL 미러: `CAP_DISCARD_PER_HOUR`
 * (`discard_commission`, 20260803010000_commission_discard.sql).
 *
 * ⚠️ **이 상한은 방어가 아니다.** "낮은 계급을 버리고 높은 계급을 노린다"는 경로는 막지 않는다 —
 * 그게 이 기능의 용도다. 처리량을 묶는 것은 폐기가 아니라 **발령**이고
 * (`MIN_BOSS_KILL_TICKS`(commissionConstants.ts) 누적 예약 지평 +
 * {@link CAP_ISSUE_ATTEMPTS_PER_HOUR}),
 * 폐기를 무한히 해도 새 의뢰서가 그보다 빨리 나오지 않는다. 상한을 두는 이유는 이득이 아니라
 * **폐기 감사 테이블의 쓰기 폭주**를 막기 위함이다.
 *
 * 보관 상한이 12 이므로 30 은 "재고를 두 번 반 비울 수 있다"에 해당한다 — 정직한 사용자가
 * 이 값에 닿는 시나리오가 없어야 한다는 것이 고른 기준이다.
 *
 * 읽는 곳: `src/ui/pixi/commissionDesk.ts`(안내 문구 아님 — 거부 사유는 서버 원문을 그대로
 * 보여준다) · 이 상수의 유일한 역할은 **SQL 과 값이 갈렸을 때 테스트가 잡는 것**이다.
 */
export const CAP_DISCARD_PER_HOUR = 30;
