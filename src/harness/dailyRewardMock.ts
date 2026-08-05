/**
 * 하네스 일일 보상 모의 게이트웨이 (개발 도구, DEV 전용 — ADR-0008 · ADR-0048).
 *
 * ## 왜 필요한가 — 30일을 기다릴 수 없다
 *
 * 일일 보상은 **서버 원장이 정본**이다. 연속일(`daily_streak`)·직전 수령일
 * (`daily_last_claim_seed`)·생애 누적(`lifetime_granted`)은 전부 봉인 컬럼이라 클라가 한 칸도
 * 못 민다. 그래서 실서버만 보고서는 *"30일차 화면이 어떻게 보이는가"*(AC-26)를 **30일 뒤에나**
 * 확인할 수 있고, 하루를 놓친 계정의 리셋(AC-8)이나 만석 보류(`hold_reason='capacity_full'`)는
 * 사실상 영영 못 밟는다. 이 파일이 그 30일을 손잡이 한 번으로 접는다.
 *
 * ## 우선순위 — 모의는 config 를 앞지르지 않는다
 *
 * 이 리포에는 *"모의 override 가 config 보다 먼저라 실서버를 조용히 가린다"* 는 전례가 있다
 * (harness-online 레인). 그래서 여기서는 **`resolveDailyRewardGateway` 를 건드리지 않는다.**
 * 대신 이미 있는 주입점 `DailyRewardNetDeps.gateway` 만 쓴다:
 *
 *   - 꺼져 있으면 {@link harnessDailyRewardDeps} 가 `{}` 를 낸다 → `deps.gateway === undefined`
 *     → `resolveDailyRewardGateway` 가 **실경로(config)를 그대로** 탄다. 모의 코드가 해석
 *     경로에 한 줄도 끼지 않는다.
 *   - 켜야만 `{ gateway }` 가 실려 그때 config 를 이긴다. 이기는 것이 목적이다 — 연속일은
 *     서버 봉인 컬럼이라 실서버를 붙인 채로는 30일차를 만들 수 없다.
 *
 * 전역 override 를 net 계층에 새로 다는 안(계보의 `setLineageGatewayOverride` 문법)은 기각했다.
 * 그쪽은 **설정보다 먼저** 검사되므로 켜 둔 것을 잊으면 실서버가 조용히 가려진다. 여기 방식은
 * 호출부가 명시적으로 실어 넘기지 않으면 물리적으로 적용될 수 없다.
 *
 * ⚠️ 그래도 **켜졌다는 사실은 화면에 보여야 한다** — 안 보이면 켜 둔 채로 "실서버에서 됐다"고
 * 오판한다. 치트 패널이 {@link HarnessDailyRewardGateway.status} 를 매 렌더 읽어 배지로 찍는다.
 *
 * ## 순수 산식을 재구현하지 않는다
 *
 * 연속일 전이·예산 램프·상한·후보 생산·낙찰은 전부 `data/dailyReward.ts` ·
 * `data/dailyRewardSelection.ts` 를 **import 해서 쓴다**. 베끼면 모의와 서버가 갈려 하네스가
 * *없는 결함을 만들거나 있는 결함을 숨긴다* — 하네스가 거짓말을 하면 그 자체가 최악의 결함이다.
 * 이 파일이 직접 들고 있는 것은 EF 의 **글루**(예고 파싱/매칭·진행 입력 조립)뿐이며, 그 셋은
 * 순수 데이터 모듈이 아니라 `supabase/functions/daily-reward/index.ts` 안에만 있는 것들이다.
 *
 * ## 시각은 손잡이가 공급한다
 *
 * `Date.now()`·`Math.random()` 을 **쓰지 않는다.** 오늘의 `date_seed` 는 생성자 인자로 받고
 * {@link HarnessDailyRewardGateway.advanceDays} 로만 움직인다 — 그래야 "하루 넘기기"가
 * 결정론이고 테스트가 벽시계 없이 30일을 민다.
 *
 * 프로덕션 미포함: 하네스 배선(DEV 전용 동적 import)에서만 닿으므로 트리셰이킹으로 프로덕션
 * 번들에서 완전히 제거된다.
 */

import {
  nextStreak,
  resolveDailyBudget,
  valueBudgetForStreak,
  DAILY_SEED_NEVER,
  DAILY_SIDE_CREDITS,
  DAILY_STREAK_CYCLE,
} from '../../data/dailyReward.js';
import {
  produceDailyRewardCandidates,
  pickDailyReward,
  DAILY_REWARD_AXES,
  type DailyRewardAxis,
  type DailyRewardCandidate,
  type DailyRewardProgressInput,
} from '../../data/dailyRewardSelection.js';
import { shopUserSeed, rollModuleShopRotation } from '../../data/coreModules.js';
import { activeShip, MAX_STASH_EXPANSIONS, type Profile } from '../save/profile.js';
import type {
  DailyRewardAnnouncement,
  DailyRewardClaim,
  DailyRewardGateway,
  DailyRewardPendingRow,
  DailyRewardResult,
} from '../net/dailyReward.js';
import type { DailyRewardNetDeps } from '../net/index.js';

/** 모의 서버가 쓰는 uid. 실 서버의 JWT sub 자리 — 유저 시드가 여기서 파생된다. */
export const HARNESS_DAILY_UID = 'harness-daily-uid';

/**
 * 생애 누적 지급액 기본값. **1,000,000 이상이어야 램프가 보인다** —
 * `budgetCeilingFromLifetime` 이 `lifetime × 0.02` 이고 30일차 램프가 20,000 이므로, 누적이
 * 그 밑이면 예산이 천장에 눌려 **30일을 밀어도 30일차 물건이 안 나온다.** 하네스의 1차 용도가
 * AC-26(30일차 화면 육안 확인)이라 기본값을 "천장이 안 무는 계정"으로 둔다.
 *
 * 상한 절삭(관측 지표 ③)을 보고 싶으면 {@link HarnessDailyRewardGateway.setLifetimeGranted}
 * 로 낮춘다 — 0 으로 두면 신규 계정과 같은 상태(예산이 1일차에 고정)가 재현된다.
 */
export const HARNESS_DEFAULT_LIFETIME = 1_000_000;

/** 모의 원장 1행 = `daily_reward_claims` 한 줄. */
interface MockClaimRow {
  readonly dateSeed: number;
  readonly streak: number;
  readonly budget: number;
  readonly clamped: boolean;
  readonly result: DailyRewardResult;
  readonly next: DailyRewardAnnouncement;
  /** 배송함 페이로드(`item_payload`). 재화 축은 `null` — 배송할 물건이 없다. */
  readonly itemPayload: unknown;
  /** `applied_at`. `null` 이면 **미반영**(관측 지표 ②가 세는 대상). */
  appliedAt: number | null;
  /** `hold_reason`. 만석 보류가 남기는 사유. */
  holdReason: string | null;
}

/** 치트 패널이 매 렌더 읽는 현재 상태(한 줄 배지로 찍는다). */
export interface HarnessDailyRewardStatus {
  /** 이 게이트웨이가 실제로 net 경로에 실리고 있는가(= {@link harnessDailyRewardDeps} 가 넘긴다). */
  readonly enabled: boolean;
  readonly dateSeed: number;
  /** 오늘 수령하면 나올 연속일(이미 받았으면 받은 값). */
  readonly streak: number;
  readonly budget: number;
  readonly ramp: number;
  readonly ceiling: number;
  /** 상한이 램프를 잘랐는가(관측 지표 ③). */
  readonly clamped: boolean;
  /** `applied_at IS NULL` 잔존 행 수(관측 지표 ②). */
  readonly pending: number;
  readonly claimedToday: boolean;
  readonly lifetimeGranted: number;
  /** 내일 예고 축(오늘 수령이 확정한 것). 없으면 `-`. */
  readonly announcement: string;
}

// ---------------------------------------------------------------------------
// EF 글루 미러 — 예고 파싱/매칭
// ---------------------------------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * 어제 행의 예고 → 파싱본. 모양이 아니면 `null`(약속된 것이 없다).
 * `supabase/functions/daily-reward/index.ts` 의 `parseAnnouncement` 미러다.
 */
function parseAnnouncement(raw: unknown): DailyRewardAnnouncement | null {
  const r = asRecord(raw);
  if (typeof r.axis !== 'string') return null;
  if (!(DAILY_REWARD_AXES as readonly string[]).includes(r.axis)) return null;
  return {
    axis: r.axis,
    ...(typeof r.rarity === 'string' ? { rarity: r.rarity } : {}),
    ...(typeof r.grade === 'number' && Number.isFinite(r.grade) ? { grade: Math.trunc(r.grade) } : {}),
  };
}

/** 후보 → 예고. **값 필드를 절대 담지 않는다**(AC-21). EF `announcementOf` 미러. */
function announcementOf(c: DailyRewardCandidate): DailyRewardAnnouncement {
  const s = c.detail.subject;
  const rarity = s.axis === 'coreModule' || s.axis === 'gear' ? s.rarity : undefined;
  const grade = s.axis === 'commission' ? s.grade : undefined;
  return {
    axis: c.axis,
    ...(rarity !== undefined ? { rarity } : {}),
    ...(grade !== undefined ? { grade } : {}),
  };
}

/** 후보가 예고를 지키는가 — **종류·등급·계급만** 본다. EF `matchesAnnouncement` 미러. */
function matchesAnnouncement(c: DailyRewardCandidate, ann: DailyRewardAnnouncement): boolean {
  if (c.axis !== (ann.axis as DailyRewardAxis)) return false;
  const s = c.detail.subject;
  if (ann.rarity !== undefined) {
    if (s.axis !== 'coreModule' && s.axis !== 'gear') return false;
    if (s.rarity !== ann.rarity) return false;
  }
  if (ann.grade !== undefined) {
    if (s.axis !== 'commission') return false;
    if (s.grade !== ann.grade) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 게이트웨이
// ---------------------------------------------------------------------------

/** 생성자 의존성. 프로필은 **참조가 아니라 공급자**다 — 하네스 프로필 슬롯 전환에 따라간다. */
export interface HarnessDailyRewardDeps {
  /** 진행 견인 입력을 조립할 라이브 프로필. */
  profile(): Profile;
  /** 오늘의 `date_seed`. 벽시계는 **호출 측이** 읽는다(이 파일은 `Date.now` 를 안 쓴다). */
  dateSeed: number;
}

/**
 * 인메모리 일일 보상 원장 모의. `DailyRewardGateway` 8메서드를 전부 실제 상태로 구현한다.
 *
 * 서버와 갈리면 안 되는 것(연속일·예산·낙찰)은 순수 모듈에 위임하고, 여기서 직접 들고 있는
 * 것은 **원장의 모양과 순서**뿐이다 — 그것이 하네스가 실제로 재현해야 하는 것이다.
 */
export class HarnessDailyRewardGateway implements DailyRewardGateway {
  /** date_seed → 원장 행. `daily_reward_claims` 의 복합 PK(profile_id, date_seed) 미러. */
  private readonly rows = new Map<number, MockClaimRow>();
  /** 오늘의 date_seed. 손잡이로만 움직인다. */
  private seed: number;
  /** `profiles.daily_last_claim_seed`. */
  private lastSeed = DAILY_SEED_NEVER;
  /** `profiles.daily_streak`. */
  private lastStreak = 0;
  /** `profiles.lifetime_granted` — 예산 천장의 앵커. */
  private lifetimeGranted = HARNESS_DEFAULT_LIFETIME;
  /** 서버 권위 재화(ADR-0027). 후보 거리 계산의 입력이자 `credits_left` 의 출처. */
  private credits = 0;
  private minerals = 0;
  /** `pushProfile` 이 올린 서버 사본. `pullProfile` 이 이것을 낸다. */
  private serverProfile: Profile | null = null;
  /** 다음 수령이 배송함에 실을 페이로드(장비 축 예행). `null` 이면 재화 축처럼 배송물 없음. */
  private nextItemPayload: unknown = null;

  private readonly deps: HarnessDailyRewardDeps;

  constructor(deps: HarnessDailyRewardDeps) {
    this.deps = deps;
    this.seed = Math.trunc(deps.dateSeed);
  }

  // --- 하네스 제어 표면(치트 패널이 호출) -----------------------------------

  /**
   * 연속일을 임의로 만든다(1..{@link DAILY_STREAK_CYCLE}). **다음 수령이 정확히 `n` 을 낸다.**
   *
   * 방법은 원장에 30줄을 심는 것이 아니라 **직전 상태 두 칸을 조작**하는 것이다 — 연속일 판정이
   * 원장 스캔이 아니라 `(직전 수령일, 직전 연속일)` 두 값만 보기 때문이다(`nextStreak` 주석).
   * 30줄을 심으면 실제 판정 경로가 아닌 것을 검증하게 된다.
   *
   * 오늘 행이 이미 있으면 지운다 — 안 지우면 멱등 분기가 옛 결과를 그대로 돌려줘 손잡이가
   * 아무 일도 안 한 것처럼 보인다.
   */
  setStreak(n: number): void {
    const target = Math.min(DAILY_STREAK_CYCLE, Math.max(1, Math.trunc(n)));
    this.rows.delete(this.seed);
    if (target <= 1) {
      // 미수령 상태 — `prevSeed !== nowSeed - 1` 이라 `nextStreak` 이 1 을 낸다.
      this.lastSeed = DAILY_SEED_NEVER;
      this.lastStreak = 0;
      return;
    }
    this.lastSeed = this.seed - 1;
    this.lastStreak = target - 1;
  }

  /**
   * 하루(또는 n일) 넘긴다. `date_seed` 만 민다 — 연속일은 **다음 수령이 판정**한다.
   *
   * ⚠️ 호출부는 `clearDailySeenSeed()` 를 **함께** 불러야 한다. 모달 표시 상태는 기기 로컬
   * 별도 키라(`src/save/dailySeen.ts`) 여기서 못 만지고, 안 지우면 하루를 넘겨도 모달이 안 떠
   * 30일차 육안 확인이 통째로 죽는다.
   */
  advanceDays(n = 1): number {
    this.seed += Math.max(1, Math.trunc(n));
    return this.seed;
  }

  /** 현재 `date_seed`. */
  dateSeed(): number {
    return this.seed;
  }

  /** 생애 누적을 세팅한다(상한 절삭 관측용 — 0 이면 신규 계정과 같은 상태). */
  setLifetimeGranted(v: number): void {
    this.lifetimeGranted = Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  }

  /** 서버 권위 재화를 라이브 프로필 값으로 맞춘다(모의를 켤 때 1회). */
  syncCurrencyFromProfile(): void {
    const p = this.deps.profile();
    this.credits = p.credits;
    this.minerals = p.minerals;
  }

  /**
   * **미반영 배송함 행 1건**을 만든다(`applied_at IS NULL`).
   *
   * 관측 지표 ②가 *"항상 0 을 읽는 죽은 계측기"* 가 아님을 실증하는 장치다 — 이 리포는 그런
   * 계측기를 방치한 전례가 있다. 만들고 나서 패널의 `미반영` 칸이 1 로 오르는 것이 곧 그 증명이다.
   *
   * 오늘 행이 이미 있으면 **비어 있는 과거 날짜**로 내려간다(복합 PK 를 덮어쓰지 않는다).
   * @returns 만든 행의 `date_seed`.
   */
  seedPendingItemRow(): number {
    let seed = this.seed;
    while (this.rows.has(seed)) seed -= 1;
    const budget = resolveDailyBudget(1, this.lifetimeGranted);
    this.rows.set(seed, {
      dateSeed: seed,
      streak: 1,
      budget: budget.budget,
      clamped: budget.clamped,
      result: {
        axis: 'gear',
        value: 0,
        credits: 0,
        minerals: 0,
        goalId: 'harness:pending',
        fallback: false,
        announcementMissed: false,
        step: null,
      },
      next: { axis: 'currency' },
      // `materializeDailyRewardItem` 이 `id` 를 `daily:{seed}` 로 덮어쓴다 — 여기 id 는 그
      // 덮어쓰기가 실제로 일어나는지 보이게 하려고 일부러 엉뚱한 값으로 둔다.
      itemPayload: {
        id: 'harness-server-said-something-else',
        slot: 'main',
        rarity: 'rare',
        affixes: [],
        source: { kind: 'daily', dateSeed: seed },
      },
      appliedAt: null,
      holdReason: null,
    });
    return seed;
  }

  /** 다음 수령이 배송함에 실을 페이로드를 정한다(장비 축 예행). `null` = 배송물 없음. */
  setNextItemPayload(payload: unknown): void {
    this.nextItemPayload = payload;
  }

  /** 미반영(`applied_at IS NULL`) 행 수 — 관측 지표 ②. */
  pendingCount(): number {
    let n = 0;
    for (const row of this.rows.values()) if (row.appliedAt === null) n++;
    return n;
  }

  /** 원장·직전 상태를 통째로 비운다(날짜는 유지). */
  reset(): void {
    this.rows.clear();
    this.lastSeed = DAILY_SEED_NEVER;
    this.lastStreak = 0;
    this.serverProfile = null;
    this.nextItemPayload = null;
  }

  /** 치트 패널 배지용 스냅샷. */
  status(): HarnessDailyRewardStatus {
    const today = this.rows.get(this.seed);
    const streak = today?.streak ?? nextStreak(this.lastSeed, this.seed, this.lastStreak);
    const budget = resolveDailyBudget(streak, this.lifetimeGranted);
    return {
      enabled: harnessDailyRewardGateway() === this,
      dateSeed: this.seed,
      streak,
      budget: today?.budget ?? budget.budget,
      ramp: budget.ramp,
      ceiling: budget.ceiling,
      clamped: today?.clamped ?? budget.clamped,
      pending: this.pendingCount(),
      claimedToday: today !== undefined,
      lifetimeGranted: this.lifetimeGranted,
      announcement: today?.next.axis ?? '-',
    };
  }

  // --- DailyRewardGateway ---------------------------------------------------

  async getUserId(): Promise<string> {
    return HARNESS_DAILY_UID;
  }

  /**
   * 오늘의 수령. EF `daily-reward` 의 순서를 그대로 밟는다:
   * 멱등 확인 → 연속일 → 예산 → 후보 → 예고 소비 → 낙찰 → 지급 → 내일 예고 확정.
   */
  async claimDailyReward(): Promise<DailyRewardClaim> {
    const existing = this.rows.get(this.seed);
    if (existing !== undefined) {
      // 멱등 — **아무것도 굴리지 않고** 저장된 것을 그대로 낸다(AC-5). 여기서 다시 굴리면
      // 네트워크 재시도가 매번 다른 물건을 만든다.
      return this.toClaim(existing, true);
    }

    const streak = nextStreak(this.lastSeed, this.seed, this.lastStreak);
    const budget = resolveDailyBudget(streak, this.lifetimeGranted);
    const userSeed = shopUserSeed(HARNESS_DAILY_UID);
    const candidates = produceDailyRewardCandidates(this.progressInput());

    // 예고 소비 — 어제 행이 있으면 그 종류로 좁힌다. 좁힌 결과가 비면 **되돌린다**(못 받는 것이
    // 예고를 어기는 것보다 나쁘다). 되돌린 사실은 `announcementMissed` 로 남는다.
    const announced = parseAnnouncement(this.rows.get(this.seed - 1)?.next ?? null);
    const honored =
      announced === null ? candidates : candidates.filter((c) => matchesAnnouncement(c, announced));
    const announcementMissed = announced !== null && honored.length === 0 && candidates.length > 0;
    const pool = announcementMissed ? candidates : honored;

    const pick = pickDailyReward(pool, budget.budget, this.seed, userSeed);
    const subject = pick.candidate.detail.subject;
    // 슬라이스 1 은 재화 축만 낙찰된다(레지스트리에 그것뿐이고 폴백도 재화다). 다른 축이 나오면
    // EF 는 501 로 막는다 — 모의도 조용히 크레딧으로 바꾸지 않고 같은 자리에서 던진다.
    if (subject.axis !== 'currency') {
      throw new Error(`daily-reward: axis-not-implemented (${subject.axis})`);
    }
    // 절삭은 **서버(SQL)가 한다** — EF 는 원값을 넘기고 `claim_daily_reward_for` 가 `v_scale`
    // 로 축 성분까지 깎는다. 모의도 같은 자리에서 같은 식으로 깎아야 하네스가 서버와 갈리지
    // 않는다. ⚠️ EF 쪽에서 미리 깎으면 `clamped` 플래그가 false 로 기록돼 절삭 지표가
    // 죽는데, 모의는 지표를 직접 세우므로 여기서 깎고 플래그도 함께 세운다.
    const scale =
      pick.candidate.value > budget.budget && pick.candidate.value > 0
        ? budget.budget / pick.candidate.value
        : 1;
    const grantCredits = Math.max(0, Math.floor(subject.credits * scale));
    const grantMinerals = Math.max(0, Math.floor(subject.minerals * scale));

    // 내일 예고 확정. 시드가 `seed + 1` 인 것이 계약이다 — 같은 시드면 tie-break 가 오늘과
    // 같아져 예고가 오늘 낙찰을 그대로 복사한다.
    const nextStreakValue = streak >= DAILY_STREAK_CYCLE ? 1 : streak + 1;
    const nextBudget = Math.min(valueBudgetForStreak(nextStreakValue), budget.ceiling);
    const nextPick = pickDailyReward(candidates, nextBudget, this.seed + 1, userSeed);

    const row: MockClaimRow = {
      dateSeed: this.seed,
      streak,
      budget: budget.budget,
      clamped: budget.clamped,
      result: {
        axis: 'currency',
        value: pick.candidate.value,
        credits: grantCredits,
        minerals: grantMinerals,
        goalId: pick.candidate.detail.goalId,
        fallback: pick.fallback,
        announcementMissed,
        step:
          pick.candidate.step !== undefined
            ? { index: pick.candidate.step.index, total: pick.candidate.step.total }
            : null,
      },
      next: announcementOf(nextPick.candidate),
      itemPayload: this.nextItemPayload,
      appliedAt: null,
      holdReason: null,
    };
    this.rows.set(this.seed, row);

    // 지급 확정 — 서버 원장(재화 컬럼)을 민다.
    //
    // ⚠️ **곁들이 크레딧을 함께 넣는다.** SQL 은 `grant_currency_for` 에
    // `DAILY_SIDE_CREDITS + 주 보상 크레딧` 을 한 번에 넘긴다(마이그레이션 7절). 모의가 주
    // 보상만 넣으면 모달은 *"곁들여 크레딧 500 이 함께 들어왔습니다"* 라고 말하는데 잔액은
    // 안 오르는 상태가 된다 — 실화면 검증에서 실제로 그렇게 보였다.
    //
    // ⚠️ **생애 누적(앵커)은 밀지 않는다.** 서버는 `currency_grants` AFTER 트리거의
    // `when (new.source <> 'daily_reward')` 로 자기 지급을 앵커에서 제외한다. 모의가 밀면
    // 하네스에서만 천장이 접속으로 자라, ADR-0048 의 **유일한 정당화**(*"위조해도 정직한
    // 플레이로 이미 닿는 범위 안"*)가 성립하는지를 하네스로는 영영 못 본다. 초판이 정확히
    // 그렇게 돼 있었고 실화면 검증이 잡았다(누적이 1,000,000 → 1,000,040 으로 움직였다).
    // 앵커를 움직여 보려면 치트 패널의 `생애 누적 세팅`(= 다른 경로의 지급을 흉내)을 쓴다.
    this.credits += grantCredits + DAILY_SIDE_CREDITS;
    this.minerals += grantMinerals;
    this.lastSeed = this.seed;
    this.lastStreak = streak;

    return this.toClaim(row, false);
  }

  async fetchPendingClaims(): Promise<DailyRewardPendingRow[]> {
    const out: DailyRewardPendingRow[] = [];
    for (const row of this.rows.values()) {
      if (row.appliedAt !== null) continue;
      out.push({ dateSeed: row.dateSeed, item: row.itemPayload ?? null, holdReason: row.holdReason });
    }
    // 실 게이트웨이가 `order('date_seed', ascending)` 로 읽으므로 같은 순서를 낸다.
    out.sort((a, b) => a.dateSeed - b.dateSeed);
    return out;
  }

  async markApplied(dateSeed: number): Promise<number> {
    const row = this.rows.get(dateSeed);
    if (row === undefined || row.appliedAt !== null) return 0;
    row.appliedAt = dateSeed;
    row.holdReason = null;
    return 1;
  }

  async markHold(dateSeed: number, reason: 'capacity_full'): Promise<number> {
    const row = this.rows.get(dateSeed);
    // 보류는 `applied_at` 을 **찍지 않는다** — 자리가 나면 다음 부팅이 다시 시도해야 한다.
    if (row === undefined || row.appliedAt !== null) return 0;
    row.holdReason = reason;
    return 1;
  }

  async pushProfile(profile: Profile): Promise<void> {
    this.serverProfile = structuredClone(profile);
  }

  async pullProfile(): Promise<Profile | null> {
    return this.serverProfile === null ? null : structuredClone(this.serverProfile);
  }

  // --- 내부 -----------------------------------------------------------------

  private toClaim(row: MockClaimRow, already: boolean): DailyRewardClaim {
    return {
      already,
      dateSeed: row.dateSeed,
      streak: row.streak,
      budget: row.budget,
      clamped: row.clamped,
      result: row.result,
      next: row.next,
      // 이미 반영된 행은 배송할 것이 없다(EF 의 멱등 재응답과 같은 규칙). 아직 열려 있으면
      // 페이로드를 그대로 싣는다 — 뭉개면 클라가 "배송할 것 없음"으로 읽고 행을 닫는다.
      item: row.appliedAt === null ? (row.itemPayload ?? null) : null,
      creditsLeft: this.credits,
      mineralsLeft: this.minerals,
    };
  }

  /**
   * 진행 견인 입력 조립 — EF `buildProgressInput` 의 하네스판.
   *
   * 차이는 둘뿐이고 둘 다 의도다:
   *  - **`defenseUnits` 는 비운다.** 방어체 원장은 별도 서버 테이블이고 하네스에는 그 모의가
   *    따로 있다(`defenseMock.ts`). 추측으로 채우면 존재하지 않는 목표가 매일 낙찰된다.
   *  - **`refining` 은 넣지 않는다.** 정제소에 올린 장비는 세이브가 아니라 화면 세션 상태다
   *    (EF 주석과 같은 이유).
   */
  private progressInput(): DailyRewardProgressInput {
    const p = this.deps.profile();
    const ship = activeShip(p);
    let invested = 0;
    for (const v of ship.skillInvest) invested += v;
    return {
      currency: {
        credits: this.credits,
        minerals: this.minerals,
        stashExpansions: p.stashExpansions,
        stashMaxExpansions: MAX_STASH_EXPANSIONS,
        shipLevel: ship.level,
        // 아무것도 안 찍은 조종사에게 리스펙 목표를 들이미는 것은 견인이 아니라 소음이다.
        wantsRespec: invested > 0,
        defenseUnits: [],
        moduleOffers: rollModuleShopRotation(this.seed, shopUserSeed(HARNESS_DAILY_UID)).map(
          (m) => m.rarity,
        ),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// 설치 — 기본은 꺼짐
// ---------------------------------------------------------------------------

/**
 * 설치된 모의. **기본 `null`(꺼짐)** 이며, 이 값이 `null` 인 동안
 * {@link harnessDailyRewardDeps} 는 빈 객체를 내므로 net 계층은 모의의 존재조차 모른다.
 */
let installed: HarnessDailyRewardGateway | null = null;

/** 모의를 설치/해제한다(DEV). `null` 이면 즉시 실경로로 돌아온다. */
export function setHarnessDailyRewardGateway(gateway: HarnessDailyRewardGateway | null): void {
  installed = gateway;
}

/** 지금 설치된 모의(없으면 `null`). 치트 패널이 상태 배지를 그릴 때 읽는다. */
export function harnessDailyRewardGateway(): HarnessDailyRewardGateway | null {
  return installed;
}

/**
 * 일일 보상 net 함수에 넘길 의존성.
 *
 * ⚠️ **이 함수가 우선순위 계약의 전부다.** 꺼져 있으면 `{}` — `deps.gateway` 가 `undefined` 라
 * `resolveDailyRewardGateway` 가 `readSupabaseConfig()` 로 그대로 내려간다. 켜져 있을 때만
 * `gateway` 가 실려 config 를 이긴다(연속일이 서버 봉인 컬럼이라 이겨야만 30일차를 만든다).
 *
 * `exactOptionalPropertyTypes` 때문에 `{ gateway: undefined }` 를 낼 수 없다 — 그 형태는
 * 타입 오류이기도 하지만, 무엇보다 `!== undefined` 검사를 통과해 **꺼진 모의가 실경로를
 * 가리는** 바로 그 결함이 된다.
 */
export function harnessDailyRewardDeps(): DailyRewardNetDeps {
  return installed === null ? {} : { gateway: installed };
}
