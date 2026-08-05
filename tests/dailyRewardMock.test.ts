/**
 * 하네스 일일 보상 **모의 게이트웨이** 테스트 (ADR-0048 · 계획 §C11).
 *
 * ## 이 파일이 잠그는 것 두 가지
 *
 * ① **모의가 실서버를 조용히 가리지 않는다.** 이 리포에는 *"모의 override 가 config 보다 먼저라
 *    실서버를 조용히 가린다"* 는 전례가 있다. 그래서 첫 describe 가 **꺼진 상태에서 게이트웨이
 *    해석이 실경로를 그대로 타는지**부터 본다 — 이 단언이 깨지면 하네스로 확인한 모든 것이
 *    "실서버에서 됐다"는 오판이 된다.
 *
 * ② **모의가 서버와 같은 산식을 쓴다.** 연속일·예산·멱등을 모의가 따로 구현하면 하네스가
 *    *없는 결함을 만들거나 있는 결함을 숨긴다.* 그래서 단언의 기대값을 상수로 적지 않고
 *    `nextStreak`·`valueBudgetForStreak` **함수 자체**와 대조한다.
 *
 * 단언마다 "이게 통과하면서도 참일 수 있는 나쁜 상태"를 주석으로 적는다(`dailyRewardNet` 규율).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  HarnessDailyRewardGateway,
  harnessDailyRewardDeps,
  harnessDailyRewardGateway,
  setHarnessDailyRewardGateway,
  HARNESS_DEFAULT_LIFETIME,
} from '../src/harness/dailyRewardMock.js';
import { claimDailyRewardOnServer } from '../src/net/index.js';
import {
  nextStreak,
  valueBudgetForStreak,
  DAILY_CEILING_RATE,
  DAILY_SIDE_CREDITS,
  DAILY_STREAK_CYCLE,
} from '../data/dailyReward.js';
import { defaultProfile, type Profile } from '../src/save/profile.js';
import { deliverPendingDailyRewards } from '../src/net/dailyReward.js';

/** 하루 = 1 seed. 임의의 현실적 날짜(2025-08-05 근방)에서 시작한다. */
const START_SEED = 20_305;

let profile: Profile;

function makeGateway(): HarnessDailyRewardGateway {
  return new HarnessDailyRewardGateway({ profile: () => profile, dateSeed: START_SEED });
}

beforeEach(() => {
  profile = defaultProfile();
  setHarnessDailyRewardGateway(null);
});

afterEach(() => {
  // 설치를 남기면 다음 파일의 net 호출이 모의로 새어 나간다 — 정확히 이 파일이 막으려는 결함이다.
  setHarnessDailyRewardGateway(null);
});

// ---------------------------------------------------------------------------
// ① 우선순위 — 꺼진 모의는 실경로를 가리지 않는다
// ---------------------------------------------------------------------------

describe('일일 보상 모의 — 설치 우선순위', () => {
  it('기본은 꺼짐이고, 꺼져 있으면 deps 에 gateway 키 자체가 없다', () => {
    // 모의를 **만들기만** 한다(설치 안 함) — 존재가 곧 적용이 되면 안 된다.
    makeGateway();
    expect(harnessDailyRewardGateway()).toBeNull();
    // 나쁜 상태: `{ gateway: undefined }` 를 내면 타입은 통과해도 `!== undefined` 검사에
    // 걸려 꺼진 모의가 실경로를 가린다. 키 자체가 없어야 한다.
    expect('gateway' in harnessDailyRewardDeps()).toBe(false);
  });

  it('꺼져 있으면 게이트웨이 해석이 config 를 그대로 탄다(미설정 → unconfigured)', async () => {
    makeGateway();
    const res = await claimDailyRewardOnServer(profile, {
      ...harnessDailyRewardDeps(),
      config: null,
    });
    // 나쁜 상태: 여기서 `ok` 가 나오면 모의가 config 를 앞질렀다는 뜻이고, 그 순간 하네스에서
    // 본 모든 결과가 실서버 결과로 오독된다.
    expect(res).toEqual({ status: 'unconfigured' });
  });

  it('켜야만 실린다 — 설치 후에는 config:null 이어도 모의가 응답한다', async () => {
    const gw = makeGateway();
    setHarnessDailyRewardGateway(gw);
    expect('gateway' in harnessDailyRewardDeps()).toBe(true);

    const res = await claimDailyRewardOnServer(profile, {
      ...harnessDailyRewardDeps(),
      config: null,
    });
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.claim.dateSeed).toBe(START_SEED);
    // 나쁜 상태: 켰는데 상태 배지가 꺼짐으로 보이면 화면에서 켠 줄 모르고 오판한다.
    expect(gw.status().enabled).toBe(true);
  });

  it('해제하면 즉시 실경로로 돌아온다', async () => {
    setHarnessDailyRewardGateway(makeGateway());
    setHarnessDailyRewardGateway(null);
    const res = await claimDailyRewardOnServer(profile, {
      ...harnessDailyRewardDeps(),
      config: null,
    });
    expect(res).toEqual({ status: 'unconfigured' });
  });
});

// ---------------------------------------------------------------------------
// ② 연속일 — 손잡이와 전이
// ---------------------------------------------------------------------------

describe('일일 보상 모의 — 연속일', () => {
  it('연속일 세팅 → 수령이 정확히 그 값을 낸다(전 구간 1..30)', async () => {
    for (const target of [1, 2, 7, 29, 30]) {
      const gw = makeGateway();
      gw.setStreak(target);
      const claim = await gw.claimDailyReward();
      // 나쁜 상태: 원장에 30줄을 심어 놓고 판정 경로를 안 지나면 여기만 맞고 실제 전이는 틀린다.
      expect(claim.streak).toBe(target);
    }
  });

  it('하루 넘기기 2회 연속이면 연속일이 +2 된다', async () => {
    const gw = makeGateway();
    gw.setStreak(5);
    expect((await gw.claimDailyReward()).streak).toBe(5);
    gw.advanceDays(1);
    expect((await gw.claimDailyReward()).streak).toBe(6);
    gw.advanceDays(1);
    const third = await gw.claimDailyReward();
    // 나쁜 상태: 멱등 분기가 잘못 걸리면 날짜만 바뀌고 연속일이 그대로 5 에 머문다.
    expect(third.streak).toBe(7);
    expect(third.already).toBe(false);
  });

  it('하루 건너뛰면 1 로 리셋된다(0 도 절반도 유지도 아니다 — AC-8)', async () => {
    const gw = makeGateway();
    gw.setStreak(12);
    expect((await gw.claimDailyReward()).streak).toBe(12);
    gw.advanceDays(2); // 하루를 통째로 건너뛴다.
    expect((await gw.claimDailyReward()).streak).toBe(1);
  });

  it('전이가 `nextStreak` 산식과 같다(모의가 따로 구현하지 않았다)', async () => {
    const gw = makeGateway();
    gw.setStreak(3);
    const first = await gw.claimDailyReward();
    gw.advanceDays(1);
    const second = await gw.claimDailyReward();
    // 나쁜 상태: 모의가 `+1` 을 직접 짜면 30일차 되감기·미래 시드 방어가 서버와 갈린다.
    expect(second.streak).toBe(nextStreak(first.dateSeed, second.dateSeed, first.streak));
  });
});

// ---------------------------------------------------------------------------
// ③ 멱등 — 같은 날 두 번은 재굴림이 아니다
// ---------------------------------------------------------------------------

describe('일일 보상 모의 — 멱등(AC-5)', () => {
  it('같은 date_seed 로 두 번 받으면 already 이고 결과가 완전히 같다', async () => {
    const gw = makeGateway();
    const first = await gw.claimDailyReward();
    const second = await gw.claimDailyReward();

    expect(first.already).toBe(false);
    expect(second.already).toBe(true);
    // 나쁜 상태: 재굴림하면 네트워크 재시도가 매번 다른 물건을 만든다(그리고 지급도 두 번 난다).
    expect(second.result).toEqual(first.result);
    expect(second.streak).toBe(first.streak);
    expect(second.budget).toBe(first.budget);
    expect(second.creditsLeft).toBe(first.creditsLeft);
    expect(second.mineralsLeft).toBe(first.mineralsLeft);
    // 원장은 한 줄뿐이다 — 미반영 행 수로 센다(둘 다 아직 미반영).
    expect(gw.pendingCount()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ④ 예고 — 어제가 오늘을 고정하고, 오늘이 내일을 확정한다
// ---------------------------------------------------------------------------

describe('일일 보상 모의 — 예고 소비/확정', () => {
  it('오늘 수령이 내일 예고를 확정하고, 다음 날이 그 예고를 지킨다', async () => {
    const gw = makeGateway();
    const today = await gw.claimDailyReward();
    expect(today.next).not.toBeNull();

    gw.advanceDays(1);
    const tomorrow = await gw.claimDailyReward();
    // 나쁜 상태: 예고를 안 읽으면 "적힌 것은 바뀌지 않는다"가 깨지고, 되돌림 지표도 항상 false 라
    // 예고가 약속으로 기능하는지 영영 못 잰다.
    expect(tomorrow.result?.axis).toBe(today.next?.axis);
    expect(tomorrow.result?.announcementMissed).toBe(false);
    // 예고에는 **값이 실리지 않는다**(AC-21 — 실리면 내일 굴림이 오늘 새어 나온 것이다).
    expect(Object.keys(today.next ?? {}).sort()).toEqual(['axis']);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 미반영 배송함 행 — 관측 지표 ②가 죽은 계측기가 아님을 실증
// ---------------------------------------------------------------------------

describe('일일 보상 모의 — 미반영 배송함 행', () => {
  it('생성하면 조회에 1건, 반영하면 0건', async () => {
    const gw = makeGateway();
    expect(gw.pendingCount()).toBe(0);

    const seed = gw.seedPendingItemRow();
    const rows = await gw.fetchPendingClaims();
    // 나쁜 상태: 여기서 0 이면 지표 ②는 영원히 0 을 읽는 계측기가 된다 — 실제 잔존 행이 있어도
    // 경보가 안 울린다는 뜻이다.
    expect(rows.map((r) => r.dateSeed)).toEqual([seed]);
    expect(gw.pendingCount()).toBe(1);
    expect(rows[0]?.item).not.toBeNull();

    expect(await gw.markApplied(seed)).toBe(1);
    expect(await gw.fetchPendingClaims()).toEqual([]);
    expect(gw.pendingCount()).toBe(0);
    // 이미 닫힌 행을 또 닫아도 0 건이다(멱등).
    expect(await gw.markApplied(seed)).toBe(0);
  });

  it('배송 경로를 실제로 통과한다 — 아이템이 심기고 행이 닫힌다', async () => {
    const gw = makeGateway();
    const seed = gw.seedPendingItemRow();
    const reports = await deliverPendingDailyRewards(profile, gw);
    expect(reports).toEqual([{ dateSeed: seed, status: 'applied' }]);
    // 나쁜 상태: 서버가 실은 id 를 그대로 쓰면 멱등의 축이 사라진다 — 파생 id 여야 한다.
    expect(profile.inventory.map((it) => it.id)).toEqual([`daily:${seed}`]);
    expect(gw.pendingCount()).toBe(0);
  });

  it('만석이면 보류 사유가 서버 행에 남고 행은 열린 채다', async () => {
    const gw = makeGateway();
    const seed = gw.seedPendingItemRow();
    expect(await gw.markHold(seed, 'capacity_full')).toBe(1);
    const rows = await gw.fetchPendingClaims();
    // 나쁜 상태: 보류가 `applied_at` 을 찍으면 자리를 비운 뒤에도 물건이 영영 안 온다.
    expect(rows[0]?.holdReason).toBe('capacity_full');
    expect(gw.pendingCount()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ⑥ 예산 램프 — 30일차까지 밀기 (AC-26 의 전제)
// ---------------------------------------------------------------------------

describe('일일 보상 모의 — 30일차 램프', () => {
  it('30일 연속 수령이 valueBudgetForStreak(30) 에 도달하고, 그 다음 날은 1일차로 돌아간다', async () => {
    const gw = makeGateway();
    let last = await gw.claimDailyReward();
    expect(last.streak).toBe(1);
    // 나쁜 상태: 기본 생애 누적이 낮으면 예산이 천장에 눌려 30일을 밀어도 30일차 값이 안 나온다.
    expect(HARNESS_DEFAULT_LIFETIME * 0.02).toBeGreaterThanOrEqual(
      valueBudgetForStreak(DAILY_STREAK_CYCLE),
    );

    for (let day = 2; day <= DAILY_STREAK_CYCLE; day++) {
      gw.advanceDays(1);
      last = await gw.claimDailyReward();
      expect(last.streak).toBe(day);
    }
    expect(last.streak).toBe(DAILY_STREAK_CYCLE);
    expect(last.budget).toBe(valueBudgetForStreak(DAILY_STREAK_CYCLE));
    // 상한이 안 물었다 = 램프가 실제로 끝까지 보인 것이다(관측 지표 ③).
    expect(last.clamped).toBe(false);

    gw.advanceDays(1);
    const afterCycle = await gw.claimDailyReward();
    // 나쁜 상태: 31일차가 31 이나 30 으로 남으면 주기가 없는 무한 램프가 된다(AC-9).
    expect(afterCycle.streak).toBe(1);
    expect(afterCycle.budget).toBe(valueBudgetForStreak(1));
  });

  it('생애 누적을 낮추면 상한이 램프를 자른다(clamped 가 켜진다)', async () => {
    const gw = makeGateway();
    gw.setLifetimeGranted(0); // 플레이 0 인 신규 계정.
    gw.setStreak(DAILY_STREAK_CYCLE);
    const claim = await gw.claimDailyReward();
    // 나쁜 상태: 여기서 30일차 예산이 그대로 나오면 상한 유계가 무너져 봇 접속이 이득이 된다.
    expect(claim.budget).toBe(valueBudgetForStreak(1));
    expect(claim.clamped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 모의가 서버와 갈리지 않는가 — 실화면 검증이 잡은 두 건
// ---------------------------------------------------------------------------

describe('모의 충실도 — 서버 계약과 어긋나면 하네스가 없는 결함을 만들거나 있는 결함을 숨긴다', () => {
  /**
   * 둘 다 **테스트 전부 초록인 채로** 실화면에서 처음 드러났다. 모의는 검증 도구이므로
   * 서버와 갈리는 순간 그 자체가 결함이다 — 이 리포에 *"대조 없이 OK 를 내는 검증 도구가
   * 그 자체로 결함"* 이라는 교훈이 이미 있다.
   */

  it('앵커를 밀지 않는다 — 서버의 `when (new.source <> \'daily_reward\')` 필터와 같아야 한다', async () => {
    const gw = makeGateway();
    const before = gw.status().lifetimeGranted;
    await gw.claimDailyReward();
    const after = gw.status().lifetimeGranted;
    // 나쁜 상태: 여기가 오르면 하네스에서만 접속으로 천장이 자라, ADR-0048 의 유일한
    // 정당화가 성립하는지를 하네스로는 영영 확인할 수 없다.
    expect(after).toBe(before);
  });

  it('연속 수령이 천장을 한 뼘도 올리지 않는다(되먹임 누적 방지)', async () => {
    const gw = makeGateway();
    const before = gw.status().ceiling;
    for (let d = 0; d < 10; d++) {
      await gw.claimDailyReward();
      gw.advanceDays(1);
    }
    expect(gw.status().ceiling).toBe(before);
  });

  it('곁들이 크레딧이 실제로 잔액에 들어온다 — 모달이 말한 것과 잔액이 같아야 한다', async () => {
    const gw = makeGateway();
    const first = await gw.claimDailyReward();
    const mainCredits = first.result?.credits ?? 0;
    // 나쁜 상태: 주 보상만 들어오면 모달은 "곁들여 크레딧 500 이 함께 들어왔습니다" 라고
    // 말하는데 잔액은 그만큼 안 오른다 — 실화면에서 정확히 그렇게 보였다.
    expect(first.creditsLeft).toBe(mainCredits + DAILY_SIDE_CREDITS);

    // 이틀째도 같은 규율(누적)이어야 한다 — 첫날만 맞고 이후가 틀리면 더 못 잡는다.
    gw.advanceDays(1);
    const second = await gw.claimDailyReward();
    const secondMain = second.result?.credits ?? 0;
    expect(second.creditsLeft).toBe(
      mainCredits + DAILY_SIDE_CREDITS + secondMain + DAILY_SIDE_CREDITS,
    );
  });
});

describe('예산 보정이 모의에서도 램프를 보이게 한다 (2026-08-05 확정)', () => {
  it('하네스 기본 누적이 30일차 천장을 열어 둔다 — 계수를 바꾸면 이 부등식이 먼저 빨개진다', () => {
    expect(HARNESS_DEFAULT_LIFETIME * DAILY_CEILING_RATE).toBeGreaterThanOrEqual(
      valueBudgetForStreak(DAILY_STREAK_CYCLE),
    );
  });

  it('목표가 낙찰돼도 지급 총액이 예산과 같다 — 30일차에 40 크레딧이 나오던 자리다', async () => {
    const gw = makeGateway();
    gw.setStreak(DAILY_STREAK_CYCLE);
    const claim = await gw.claimDailyReward();
    const paid = (claim.result?.credits ?? 0) + (claim.result?.minerals ?? 0) * 8;
    // 보정이 없으면 목표 부족분만 나와 예산에 한참 못 미친다(실화면에서 본 그 화면).
    expect(paid).toBeGreaterThanOrEqual(Math.floor(claim.budget) - 1);
  });

  it('30일 내내 지급이 램프를 따라 오른다 — 1일차보다 30일차가 크다', async () => {
    const gw = makeGateway();
    const paidOf = (c: Awaited<ReturnType<typeof gw.claimDailyReward>>): number =>
      (c.result?.credits ?? 0) + (c.result?.minerals ?? 0) * 8;
    const first = paidOf(await gw.claimDailyReward());
    let last = first;
    for (let d = 2; d <= DAILY_STREAK_CYCLE; d++) {
      gw.advanceDays(1);
      last = paidOf(await gw.claimDailyReward());
    }
    // 나쁜 상태: 여기가 같거나 작으면 연속 접속이 화면에서 아무 의미가 없다.
    expect(last).toBeGreaterThan(first * 5);
  });
});
