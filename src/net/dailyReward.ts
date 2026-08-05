/**
 * 일일 보상 게이트웨이 + 배송함 반영 오케스트레이션 (ADR-0048 · 계획 §C5).
 *
 * `commissionGateway.ts` 의 문법을 그대로 따른다 — SDK 는 `supabaseClient.ts` 가 유일하게 정적
 * import 하고 이 파일은 그것을 경유한다. 공개 진입점(`src/net/index.ts` 의 얇은 래퍼)은
 * **미설정·오프라인·오류 → `null` 또는 `unconfigured`, 절대 throw 안 함** 규약을 지킨다.
 *
 * ## 이 파일에서 가장 위험한 것은 배송 순서다
 *
 * 장비 축(슬라이스 2)의 지급물은 서버 원장(`daily_reward_claims.item_payload`)에 적혀 있고
 * **세이브에 심는 것은 클라**다. 그래서 "심었다"와 "심었다고 서버에 알렸다" 사이의 모든 창이
 * 결함 자리다. 지켜야 하는 순서는 하나뿐이다:
 *
 *   세이브 반영 → **서버 push 성공 확인** → **재-pull 로 아이템 존재 확인** → `mark_daily_reward_applied`
 *
 * push 전에 mark 하면 `chooseProfile` 의 통짜 선택이 그 아이템을 버릴 수 있는데
 * (`progressScore` 는 기체 레벨 1 = 1000점이라 **아이템 48개 차이도 진다**) 행은 이미 mark 돼
 * 재시도되지 않는다 — **영구 유실**이다. 재-pull 을 생략해도 같은 결말이다(push 는 성공했지만
 * 그 사이 다른 기기의 상태가 이겼을 수 있다).
 *
 * ## 멱등은 순수 함수가 단독으로 보장한다
 *
 * ⚠️ `items` 테이블의 `unique (profile_id, item_id)` 를 안전망으로 **계상하지 마라** — 클라가
 * 그 테이블에 한 줄도 쓰지 않으므로(`src/**` 에 `.from('items')` 0건) 그 제약은 이 경로에
 * 걸리지 않는다. 안전망은 {@link hasItemId} 하나뿐이고, 그것이 `inventory` 만 보면
 * **플레이어가 장착하거나 창고로 옮긴 순간 다음 부팅이 같은 아이템을 또 심는다.**
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, requireUserId } from './supabaseClient.js';
import type { SupabaseConfig } from './config.js';
import type { Profile } from '../save/profile.js';
import { INVENTORY_CAP, stashCapacity, isValidItem } from '../save/profile.js';
import type { Item } from '../items/types.js';
import { hasItemId } from '../save/itemPresence.js';
import { serializeProfile, deserializeProfile } from './profileSync.js';

/** raw jsonb/행에서 안전하게 값을 뽑는 헬퍼(다른 게이트웨이 파일들과 동일 패턴). */
function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

// ---------------------------------------------------------------------------
// 배송함 아이템 id — 결정론 파생
// ---------------------------------------------------------------------------

/**
 * 배송함 아이템의 인스턴스 id. **`date_seed` 하나에서 결정론적으로 파생**한다 — 같은 날의 재시도가
 * 몇 번이든 같은 id 를 만들어야 {@link hasItemId} 가 "이미 있다"고 답할 수 있다.
 *
 * 접두 `daily:` 는 기존 id 공간과 겹치지 않는다: 드랍 아이템은 `it-{seed}`(`src/items/roll.ts:109`),
 * 의뢰 확정 지급물은 `commission:{grant_id}`, 약탈품은 `-loot-` 를 낀다. 콜론을 쓰는 접두는
 * 이쪽과 의뢰 둘뿐이고 접두 문자열 자체가 다르다.
 */
export function dailyRewardItemId(dateSeed: number): string {
  return `daily:${Math.trunc(dateSeed)}`;
}

// ---------------------------------------------------------------------------
// 서버 응답 형
// ---------------------------------------------------------------------------

/** 반복 걸음 순번 — *"3장 중 2장째"*(AC-14). 화면이 반복을 카운트다운으로 바꾸는 데 쓴다. */
export interface DailyRewardStepInfo {
  readonly index: number;
  readonly total: number;
}

/** 오늘 실제 지급된 것(원장 `result_payload` 정규화본). */
export interface DailyRewardResult {
  /** 지급 축. 6축 전부가 올 수 있다(슬라이스 2). */
  readonly axis: string;
  /**
   * 주 보상의 등급(장비·코어 모듈) — 없으면 `null`.
   *
   * ⚠️ **이 셋(`rarity`·`grade`·`count`)이 없으면 모달이 모든 축을 "재화 · 크레딧 N" 으로
   * 표시한다.** 곁들이 크레딧과 예산 보정분이 `credits` 로 실려 오기 때문에, 축만 바뀌고
   * 내용이 안 바뀐 화면이 되어 *"오늘 촉매를 받았다"* 가 플레이어에게 전달되지 않는다.
   */
  readonly rarity: string | null;
  /** 주 보상의 지시 계급(의뢰서 1..4) — 없으면 `null`. */
  readonly grade: number | null;
  /** 주 보상의 개수·장수(촉매·설계도) — 없으면 `null`. */
  readonly count: number | null;
  /**
   * 축별 지급 결과(`{granted, reason?, ...}`). **낙찰은 됐는데 지급이 없던 날**을 읽는 자리다 —
   * 지시 수신소 만석·상한 절삭·모듈 페이로드 부재가 전부 여기로 모인다. 서버가 안 실어 주면 `null`.
   */
  readonly axisGrant: { readonly granted: boolean; readonly reason: string | null } | null;
  /** 크레딧 환산 가치(서버가 예산으로 절삭한 뒤의 값). */
  readonly value: number;
  readonly credits: number;
  readonly minerals: number;
  /** 겨눈 목표. 화면이 "같은 목표가 이어지는가"를 **이 키로만** 판정한다(AC-14). */
  readonly goalId: string;
  /** 후보가 하나도 없어 재화 폴백으로 낙찰됐는가(AC-12 관측 지표). */
  readonly fallback: boolean;
  /** 어제 예고를 지키지 못하고 후보 집합을 되돌렸는가(EF 가 기록하는 관측 지표). */
  readonly announcementMissed: boolean;
  readonly step: DailyRewardStepInfo | null;
}

/**
 * 다음날 예고 — **종류·등급·계급까지만.** 값은 담기지 않는다(AC-21).
 * 값이 실려 오면 그것은 서버 결함이다(내일 굴림이 오늘 새어 나온 것).
 */
export interface DailyRewardAnnouncement {
  readonly axis: string;
  readonly rarity?: string;
  readonly grade?: number;
}

/** `daily-reward` EF 응답(정규화본). */
export interface DailyRewardClaim {
  /** 오늘 이미 받았던 것을 그대로 돌려받았는가(멱등 재시도 — AC-5). */
  readonly already: boolean;
  readonly dateSeed: number;
  readonly streak: number;
  readonly budget: number;
  /** 상한이 실제로 물었는가(관측 지표 ③). */
  readonly clamped: boolean;
  readonly result: DailyRewardResult | null;
  readonly next: DailyRewardAnnouncement | null;
  /** 장비 배송함 페이로드. 슬라이스 1 은 항상 `null`. */
  readonly item: unknown;
  readonly creditsLeft: number | null;
  readonly mineralsLeft: number | null;
}

/** 아직 세이브에 반영되지 않은 배송함 행(`applied_at is null`). */
export interface DailyRewardPendingRow {
  readonly dateSeed: number;
  readonly item: unknown;
  /** 이전 시도가 남긴 보류 사유('capacity_full' 등). 없으면 `null`. */
  readonly holdReason: string | null;
}

function normalizeStep(raw: unknown): DailyRewardStepInfo | null {
  const r = asRecord(raw);
  if (r.index === undefined && r.total === undefined) return null;
  const total = Math.max(1, Math.trunc(asNumber(r.total, 1)));
  const index = Math.min(total, Math.max(1, Math.trunc(asNumber(r.index, 1))));
  return { index, total };
}

function normalizeResult(raw: unknown): DailyRewardResult | null {
  if (raw === null || raw === undefined) return null;
  const r = asRecord(raw);
  if (typeof r.axis !== 'string') return null;
  const ag = r.axis_grant;
  return {
    axis: r.axis,
    value: asNumber(r.value),
    credits: asNumber(r.credits),
    minerals: asNumber(r.minerals),
    rarity: typeof r.rarity === 'string' ? r.rarity : null,
    grade: typeof r.grade === 'number' && Number.isFinite(r.grade) ? Math.trunc(r.grade) : null,
    count: typeof r.count === 'number' && Number.isFinite(r.count) ? Math.trunc(r.count) : null,
    axisGrant:
      ag === null || ag === undefined
        ? null
        : {
            granted: asRecord(ag).granted === true,
            reason: typeof asRecord(ag).reason === 'string' ? (asRecord(ag).reason as string) : null,
          },
    goalId: asString(r.goal_id),
    fallback: r.fallback === true,
    announcementMissed: r.announcement_missed === true,
    step: normalizeStep(r.step),
  };
}

function normalizeAnnouncement(raw: unknown): DailyRewardAnnouncement | null {
  if (raw === null || raw === undefined) return null;
  const r = asRecord(raw);
  if (typeof r.axis !== 'string') return null;
  // `exactOptionalPropertyTypes` — `undefined` 대입이 아니라 스프레드 조건부로 붙인다.
  return {
    axis: r.axis,
    ...(typeof r.rarity === 'string' ? { rarity: r.rarity } : {}),
    ...(typeof r.grade === 'number' && Number.isFinite(r.grade) ? { grade: Math.trunc(r.grade) } : {}),
  };
}

/** EF 응답 jsonb → {@link DailyRewardClaim}(신뢰하되 방어적으로 정규화). */
export function normalizeDailyRewardClaim(raw: unknown): DailyRewardClaim {
  const r = asRecord(raw);
  const grant = asRecord(r.grant);
  return {
    already: r.already === true,
    dateSeed: Math.trunc(asNumber(r.date_seed)),
    streak: Math.trunc(asNumber(r.streak, 1)),
    budget: asNumber(r.budget),
    clamped: r.clamped === true,
    result: normalizeResult(r.result),
    next: normalizeAnnouncement(r.next),
    item: r.item ?? null,
    creditsLeft: grant.credits_left !== undefined ? asNumber(grant.credits_left) : null,
    mineralsLeft: grant.minerals_left !== undefined ? asNumber(grant.minerals_left) : null,
  };
}

// ---------------------------------------------------------------------------
// 게이트웨이
// ---------------------------------------------------------------------------

/**
 * 일일 보상 서버 IO(테스트에서 fake 로 주입).
 *
 * ⚠️ {@link pushProfile} 은 **실패 시 반드시 throw** 해야 한다. `src/net/index.ts` 의
 * `pushProfileToServer` 는 오류를 삼키고 `void` 를 돌려주는데(best-effort 치트 경로), 그것을
 * 여기서 쓰면 *"push 성공 확인"* 단계가 **아무것도 확인하지 않는 단계**가 된다.
 */
export interface DailyRewardGateway {
  /** 로그인 uid. 실패 시 throw. */
  getUserId(): Promise<string>;
  /** `daily-reward` EF 호출. 전송 실패·EF 오류면 throw. */
  claimDailyReward(): Promise<DailyRewardClaim>;
  /** 미반영 배송함 행 목록(`applied_at is null`, select-own). 실패 시 throw. */
  fetchPendingClaims(): Promise<DailyRewardPendingRow[]>;
  /** 반영 완료 통지. 실패 시 throw. */
  markApplied(dateSeed: number): Promise<number>;
  /** 반영 보류 사유 기록(만석). 실패 시 throw. */
  markHold(dateSeed: number, reason: 'capacity_full'): Promise<number>;
  /** 세이브 전체 업서트. **실패 시 throw**(위 경고). */
  pushProfile(profile: Profile): Promise<void>;
  /** 서버 프로필 재조회. 행이 없으면 `null`. 실패 시 throw. */
  pullProfile(): Promise<Profile | null>;
}

function rowToPending(raw: unknown): DailyRewardPendingRow {
  const r = asRecord(raw);
  return {
    dateSeed: Math.trunc(asNumber(r.date_seed)),
    item: r.item_payload ?? null,
    holdReason: typeof r.hold_reason === 'string' ? r.hold_reason : null,
  };
}

export class SupabaseDailyRewardGateway implements DailyRewardGateway {
  private readonly client: SupabaseClient;

  constructor(config: SupabaseConfig) {
    this.client = getSupabaseClient(config);
  }

  async getUserId(): Promise<string> {
    return requireUserId(this.client);
  }

  async claimDailyReward(): Promise<DailyRewardClaim> {
    // 본문을 비워 보낸다 — 수령 대상은 JWT 의 uid 로만 정해지고 `date_seed` 는 서버가 계산한다.
    // 클라가 무엇을 실어도 EF 가 읽지 않는다는 사실을 호출 형태로 못박아 둔다.
    const { data, error } = await this.client.functions.invoke('daily-reward', { body: {} });
    if (error !== null) throw error;
    const r = asRecord(data);
    if (r.ok !== true) {
      throw new Error(`daily-reward: ${asString(r.code, 'rejected')}`);
    }
    return normalizeDailyRewardClaim(data);
  }

  async fetchPendingClaims(): Promise<DailyRewardPendingRow[]> {
    const { data, error } = await this.client
      .from('daily_reward_claims')
      .select('date_seed, item_payload, hold_reason')
      .is('applied_at', null)
      .order('date_seed', { ascending: true });
    if (error !== null) throw error;
    return (Array.isArray(data) ? data : []).map(rowToPending);
  }

  async markApplied(dateSeed: number): Promise<number> {
    const { data, error } = await this.client.rpc('mark_daily_reward_applied', {
      p_date_seed: dateSeed,
    });
    if (error !== null) throw error;
    return asNumber(asRecord(data).updated);
  }

  async markHold(dateSeed: number, reason: 'capacity_full'): Promise<number> {
    const { data, error } = await this.client.rpc('mark_daily_reward_hold', {
      p_date_seed: dateSeed,
      p_reason: reason,
    });
    if (error !== null) throw error;
    return asNumber(asRecord(data).updated);
  }

  async pushProfile(profile: Profile): Promise<void> {
    const uid = await requireUserId(this.client);
    // `SupabaseGateway.upsertProfile` 과 **같은 형태**여야 한다(gateway.ts:306) — 옵션이 달라지면
    // 같은 테이블에 두 가지 업서트 규약이 생긴다. 재화 컬럼은 guard 트리거가 봉인하므로 save
    // jsonb 안의 미러가 그대로 실려도 무해하다(ADR-0027).
    const { error } = await this.client.from('profiles').upsert({ id: uid, ...serializeProfile(profile) });
    if (error !== null) throw error;
  }

  async pullProfile(): Promise<Profile | null> {
    const uid = await requireUserId(this.client);
    const { data, error } = await this.client
      .from('profiles')
      .select('save, save_version, credits, minerals')
      .eq('id', uid)
      .maybeSingle();
    if (error !== null) throw error;
    if (data === null) return null;
    const row = asRecord(data);
    return deserializeProfile({
      save: row.save,
      saveVersion: asNumber(row.save_version),
      ...(typeof row.credits === 'number' ? { credits: row.credits } : {}),
      ...(typeof row.minerals === 'number' ? { minerals: row.minerals } : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// 배송함 반영 — 순수 배치 판정 + 순서 있는 오케스트레이션
// ---------------------------------------------------------------------------

/**
 * 배송함 페이로드 → 심을 아이템. `id` 는 **서버 페이로드의 값을 쓰지 않고** 항상
 * {@link dailyRewardItemId} 로 덮어쓴다 — 멱등의 축이 그 id 이므로 서버가 매번 다른 id 를
 * 실어 보내면(또는 아예 안 실으면) 안전망이 통째로 무력해진다.
 *
 * 형태가 아이템이 아니면 `null`. 그 경우 배송할 것이 없다고 보고 행을 반영 완료로 넘긴다 —
 * 붙잡아 두면 관측 지표 ②(미반영 잔존 행)가 영영 켜진 채로 남는다.
 */
export function materializeDailyRewardItem(payload: unknown, dateSeed: number): Item | null {
  if (payload === null || payload === undefined) return null;
  const candidate = { ...asRecord(payload), id: dailyRewardItemId(dateSeed) };
  return isValidItem(candidate) ? candidate : null;
}

/** 아이템을 넣을 자리. 가방 우선(플레이어가 바로 보는 곳), 없으면 창고. */
export type DailyRewardSlot = 'inventory' | 'stash' | 'full';

/**
 * 어디에 넣을 수 있는가 — **순수 판정**. 만석 분기를 여기 가둬 테스트가 서버 없이 잠근다.
 *
 * `INVENTORY_CAP`(48) 과 `stashCapacity(expansions)` 를 **둘 다** 본다. 가방만 보고 만석이라
 * 판단하면 창고가 비어 있는 유저의 보상이 매일 보류되고, 창고 상한을 상수로 베끼면 확장을
 * 산 유저의 자리를 못 본다.
 */
export function planDailyRewardSlot(profile: Profile): DailyRewardSlot {
  if (profile.inventory.length < INVENTORY_CAP) return 'inventory';
  if (profile.stash.length < stashCapacity(profile.stashExpansions)) return 'stash';
  return 'full';
}

/**
 * 한 배송함 행의 반영 결과.
 *  - `applied`  — 심고 push·재확인·mark 까지 끝났다. 행이 닫혔다.
 *  - `held`     — 가방·창고가 모두 만석이라 보류했다. `mark_daily_reward_hold` 를 호출했고
 *                 `applied_at` 은 **찍지 않았다** — 자리가 나면 다음 부팅이 다시 시도한다.
 *  - `deferred` — push·재-pull·mark 중 하나가 실패했다. 행이 남아 다음 부팅에 재시도된다.
 *  - `noop`     — 반영할 것이 없다(미설정·행 없음).
 */
export type DailyRewardDeliveryStatus = 'applied' | 'held' | 'deferred' | 'noop';

/**
 * 배송함 행 하나를 세이브에 반영한다. **절대 throw 하지 않는다.**
 *
 * 순서(이 함수의 존재 이유):
 *   ① 이미 들고 있으면 심지 않는다({@link hasItemId} — 4곳 전수).
 *   ② 자리가 없으면 보류하고 **mark 하지 않는다**(사유는 서버 컬럼에 남긴다 — 그래야 관측
 *      지표 ②가 만석 유저 때문에 상시 경보가 되지 않는다. 클라 로컬 상태로 두면 그 함정에
 *      그대로 빠진다).
 *   ③ push 성공 확인 → ④ 재-pull 로 아이템 존재 확인 → ⑤ mark.
 *      ④ 에서 아이템이 사라졌으면(서버에 진행도가 더 높은 프로필이 있어 우리 push 가 밀렸다)
 *      **mark 하지 않는다** — 여기서 mark 하면 행이 닫혀 재시도가 없고 물건은 영구 유실이다.
 */
export async function deliverDailyRewardRow(
  profile: Profile,
  row: DailyRewardPendingRow,
  gateway: DailyRewardGateway,
): Promise<DailyRewardDeliveryStatus> {
  const itemId = dailyRewardItemId(row.dateSeed);
  const item = materializeDailyRewardItem(row.item, row.dateSeed);

  if (item === null) {
    // 재화 축(슬라이스 1)은 배송할 물건이 없다 — 지급은 SQL 이 이미 끝냈다. 행만 닫는다.
    try {
      await gateway.markApplied(row.dateSeed);
      return 'applied';
    } catch {
      return 'deferred';
    }
  }

  if (!hasItemId(profile, itemId)) {
    const slot = planDailyRewardSlot(profile);
    if (slot === 'full') {
      try {
        await gateway.markHold(row.dateSeed, 'capacity_full');
      } catch {
        // 보류 사유 기록 실패는 삼킨다 — 반영은 어차피 안 했고 행도 열려 있어 다음 부팅에
        // 같은 판정이 다시 난다. 여기서 deferred 로 낮추면 만석과 전송 실패가 뭉개진다.
      }
      return 'held';
    }
    if (slot === 'inventory') profile.inventory.push(item);
    else profile.stash.push(item);
  }

  try {
    await gateway.pushProfile(profile);
  } catch {
    return 'deferred'; // 세이브에는 남아 있다. 다음 부팅이 같은 id 로 재시도한다(중복 안 심는다).
  }

  let server: Profile | null;
  try {
    server = await gateway.pullProfile();
  } catch {
    return 'deferred';
  }
  // ⚠️ 여기가 영구 유실을 막는 마지막 관문이다. `progressScore` 는 기체 레벨 1 = 1000점이라
  //    아이템 48개 차이도 진다 — 우리 push 가 통짜 선택에서 밀렸을 수 있다.
  if (server === null || !hasItemId(server, itemId)) return 'deferred';

  try {
    await gateway.markApplied(row.dateSeed);
  } catch {
    return 'deferred';
  }
  return 'applied';
}

/** 배송함 행 하나의 반영 결과(어느 날짜의 행이었는지 포함). */
export interface DailyRewardDeliveryReport {
  readonly dateSeed: number;
  readonly status: DailyRewardDeliveryStatus;
}

/**
 * 미반영 배송함 행 전부를 반영한다(부팅 경로 · 수령 직후 경로 공용). 한 행의 실패가 다음 행을
 * 막지 않는다 — 만석으로 보류된 행 뒤에 반영 가능한 행이 있을 수 있다.
 *
 * ⚠️ **반영의 입력은 언제나 이 목록(`applied_at is null`)이지 수령 응답이 아니다.** 수령 응답을
 * 믿으면 멱등 재응답(`already`)이 배송물을 못 실어 왔을 때 클라가 "배송할 것 없음"으로 읽고
 * 행을 닫는다 — 물건이 영구 유실된다. 서버가 아직 열려 있다고 말하는 행만 만진다.
 *
 * 절대 throw 하지 않는다.
 */
export async function deliverPendingDailyRewards(
  profile: Profile,
  gateway: DailyRewardGateway,
): Promise<DailyRewardDeliveryReport[]> {
  let rows: DailyRewardPendingRow[];
  try {
    rows = await gateway.fetchPendingClaims();
  } catch {
    return [];
  }
  const out: DailyRewardDeliveryReport[] = [];
  for (const row of rows) {
    out.push({ dateSeed: row.dateSeed, status: await deliverDailyRewardRow(profile, row, gateway) });
  }
  return out;
}
