/**
 * 서버 게이트웨이(M4 Phase B3) — 프로필 이관에 필요한 서버 IO 를 추상화.
 *
 * `ServerGateway` 인터페이스로 오케스트레이션(`index.ts`)과 실제 Supabase 호출을
 * 분리한다. 덕분에 이관 로직은 fake gateway 로 네트워크·`@supabase/supabase-js`
 * 없이 vitest 검증된다(계획 §3). 실 SDK 는 `supabaseClient.ts` 가 유일하게 정적 import 하고
 * 이 파일은 그것을 경유한다 — 이 파일 자체가 `index.ts` 에서 지연 로딩되므로 미설정 번들에
 * SDK 가 실리지 않는 성질은 그대로다.
 *
 * Auth: 세션이 **이미 있어야** 한다(`requireUserId`). 구글 로그인 필수 정책으로 바뀌면서
 * 익명 폴백(`signInAnonymously`)을 걷어냈다 — 그 폴백은 로그인 게이트를 우회시킨다.
 * 세션이 없으면 throw 하고 호출부가 오프라인과 동일하게 강등한다(`net/auth.ts` 참고).
 *
 * 재화 서버 권위(ADR-0027/0026): `profiles.credits`/`minerals`(numeric 컬럼)가 재화 정본이고
 * `save` jsonb 의 재화는 표시 미러다. `fetchProfile` 이 컬럼을 함께 읽어 미러 초기값으로 쓰고,
 * 재화 변동은 아래 RPC 3종(`settle_pve_run`·`grant_currency`·`spend_currency`)으로만 서버에
 * 반영한다(guard 트리거가 클라 컬럼 write 를 봉인 — 위조 불가).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, requireUserId } from './supabaseClient.js';
import type { Profile } from '../save/profile.js';
import type { ServerProfile } from './profileSync.js';
import type { SupabaseConfig } from './config.js';

/** PvE 정산 요약(settle_pve_run 인자 p_summary). resources→credits, minerals→minerals 로 지급. */
export interface PveSettleSummary {
  victory: boolean;
  planet: number;
  stage: number;
  /** 생존 틱(개연성 캡 산정에 쓰이니 실측값). */
  finalTick: number;
  /** 런 자원(→credits 지급 주장액; 서버 3중 캡이 클램프). */
  resources: number;
  /** 런 광물(→minerals 지급 주장액). */
  minerals: number;
  kills: number;
  /**
   * 촉매 소모 영수증 런 id(ADR-0029, Lane 3). `consume_catalysts` 성공 시 발급된 uuid 를
   * 실으면 서버 `settle_pve_run` 이 이 id 로 pending 영수증(자원 배율)을 조회해 캡을 상향한다.
   * **무촉매/오프라인 런은 미지정** — 그러면 서버가 기존 무배율 base 경로로 정산한다(위조 방지:
   * 클라가 실은 resourceMult 는 서버가 무시하고 자기 영수증만 신뢰). exactOptionalPropertyTypes
   * 규율상 값이 있을 때만 스탬프한다(undefined 대입 금지).
   */
  runId?: string;
  /**
   * 이 런이 스탬프한 행성 인기 배율 **epoch**(30분 단위 정수, ADR-0038). 서버 `settle_pve_run`
   * 이 이 epoch 의 **자기 스냅샷**에서 해당 행성 배율을 읽어 자원 지급 상한을 재산정한다.
   * **클라가 배율값 자체를 보내지 않는 것이 계약이다** — 보내면 위조 표면이 되고, 서버는 어차피
   * 자기 표만 신뢰한다(촉매 `resource_mult` 영수증과 같은 규율). epoch 이 현재/직전이 아니면
   * 서버가 배율 1.0 으로 취급한다. 미지정 = 오프라인/구 클라 → 서버 기본(1.0) 경로.
   */
  epoch?: number;
}

/** `planet_popularity_current` 한 행 — 행성별 확정 배율(centi)과 그 스냅샷의 epoch. */
export interface PlanetMultiplierRow {
  planet: number;
  mult_centi: number;
  epoch: number;
}

/** `consume_catalysts` 반환 — 발급된 런 id 와 서버 확정 자원 배율. */
export interface CatalystConsumeResult {
  /** pending pve_runs 행 id(uuid). settle 이 이 값으로 영수증을 관통 조회한다. */
  run_id: string;
  /** 서버 영수증 자원 배율([1, CAP_RESOURCE_MULT_MAX] 클램프). 표시용(정본은 서버 pending 행). */
  resource_mult: number;
}

/** `grant_catalyst` / 드랍 적립 반환 — 적립 후 그 촉매의 보유 수량. */
export interface CatalystGrantResult {
  catalyst_id: number;
  qty_after: number;
  /**
   * 실제로 적립된 수량(ADR-0042 Follow-up ⓐ). 서버 `grant_catalyst` 가 per-call·누적 캡으로
   * **절삭**할 수 있으므로 요청 수량과 다를 수 있다. 캡 개정 이전 서버는 이 필드를 안 주므로
   * 호출부는 요청 수량으로 폴백한다.
   */
  granted?: number;
}

/**
 * `salvage_catalyst` 반환 — 분해 성공 여부 + 갱신 **촉매 잔재** 잔액(ok=false 면 미차감).
 *
 * ⚠️ ADR-0042(촉매 상점·잔재 경제)로 분해 보상이 크레딧/광물 → 촉매 잔재로 바뀌었다. 서버가
 * `grant_currency` 를 더 이상 타지 않으므로 옛 `credits_left`·`minerals_left` 는 **반환에서
 * 사라졌다** — 타입에서도 지운다(남겨 두면 `undefined` 가 조용히 재화 미러에 저장된다).
 */
export interface CatalystSalvageResult {
  ok: boolean;
  /** 실제 분해된 수량(ok=false 면 0). */
  salvaged: number;
  /** 분해 후 촉매 잔재 잔액(profiles.catalyst_residue). */
  residue: number;
  /** 이번 분해로 얻은 촉매 잔재(ok=false 면 0). */
  gained: number;
  /** 거부 사유(ok=false 일 때만). `no-profile`·`not-owned` 등 서버 note 원문. */
  note?: string;
}

/**
 * `buy_catalyst` 반환 — 구매 성공 여부 + 갱신 촉매 잔재 잔액(ok=false 면 미차감).
 * 거부 사유는 `note`(`no-profile`·`signature-not-sold`·`price-unset`·`insufficient-residue`·
 * `unknown-catalyst`·`nothing-to-buy`).
 */
export interface CatalystBuyResult {
  ok: boolean;
  catalyst_id: number;
  /** 실제 구매된 수량(ok=false 면 0). */
  bought: number;
  /** 지불한 촉매 잔재(ok=false 면 0). */
  spent: number;
  /** 구매 후 촉매 잔재 잔액. */
  residue: number;
  note?: string;
}

/** `catalyst_inventory` 한 행(본인 보유 원장). */
export interface CatalystInventoryRow {
  catalyst_id: number;
  qty: number;
}

/** `grant_currency` / `settle_pve_run` 이 반환하는 갱신 잔액 계약(jsonb). */
export interface CurrencyGrantResult {
  granted_credits: number;
  granted_minerals: number;
  credits_left: number;
  minerals_left: number;
  clamped: boolean;
}

/** `settle_pve_run` 반환 = grant 결과 + settled 플래그. */
export interface SettlePveResult extends CurrencyGrantResult {
  settled: boolean;
}

/** `spend_currency` 반환. ok=false 면 잔액 부족(미차감). */
export interface SpendCurrencyResult {
  ok: boolean;
  credits_left: number;
  minerals_left: number;
}

/**
 * `begin_pve_run` 반환(ADR-0050 §3 단계 1). 런 시작을 서버에 등록해 **서버가 `started_at` 을
 * 찍게** 한다 — 그 시각이 드랍 개수 캡·축 D 캡의 분모다(클라가 못 만지는 유일한 시계).
 *
 * `throttled=true` 면 `run_id` 가 null 이다(시간당 런 상한 초과). 그때도 런은 정상 진행하되
 * **서버 드랍을 못 받는다** — 예외가 아니라 값으로 표현하는 이유는, 던지면 오프라인·네트워크
 * 실패와 구분이 안 되는 실패 경로가 하나 더 생기기 때문이다.
 */
export interface BeginPveRunResult {
  run_id: string | null;
  throttled: boolean;
  runs_last_hour: number;
}

/**
 * 아이템 원장 1행(`item_grants`). **서버가 굴린 결과**이고 클라는 이것을 받아 `rollItem` 으로
 * 아이템을 재확정할 뿐이다 — 무엇이 나올지 미리 알 수 없다(ADR-0050 §3 단계 1).
 *
 * payload 가 아니라 3필드인 이유는 저장 예산이다(payload 통째면 무료 티어 500MB 초과).
 * `rollItem` 이 순수하므로 이 셋이면 바이트 동일하게 재확정된다.
 */
export interface ItemGrantRow {
  grantId: string;
  dropIndex: number;
  dropSeed: number;
  rarity: string;
  source: { planet?: number; stage?: number; levelCap?: number };
  /** 배송 완료 시각. null 이면 아직 세이브에 안 심었다(다음 부팅이 재시도한다). */
  appliedAtMs: number | null;
}

/** `grant_run_drops` 반환. `clamped=true` 면 개연성 캡이 주장 개수를 깎았다. */
export interface GrantRunDropsResult {
  granted: number;
  claimed: number;
  clamped: boolean;
  throttled: boolean;
  grants: ItemGrantRow[];
}

/** 프로필 이관 오케스트레이션이 의존하는 서버 IO(테스트에서 fake 로 주입). */
export interface ServerGateway {
  /** 익명 세션을 보장하고 로그인 uid 를 반환한다. 실패 시 throw. */
  getUserId(): Promise<string>;
  /** uid 의 profiles 행을 읽는다. 없으면 null. 실패 시 throw. */
  fetchProfile(uid: string): Promise<ServerProfile | null>;
  /** uid 의 profiles 행을 업서트한다. 실패 시 throw. */
  upsertProfile(uid: string, payload: { save: Profile; save_version: number }): Promise<void>;
  /**
   * PvE 런 정산(자원→credits, 광물→minerals)을 서버 `settle_pve_run` RPC 로 지급하고
   * 갱신 잔액을 반환한다(ADR-0026/0027). 3중 캡이 주장액을 클램프한다. 구버전 게이트웨이면
   * `undefined` — 호출부가 no-op 처리.
   */
  settlePveRun?(summary: PveSettleSummary): Promise<SettlePveResult>;
  /**
   * 서버 `grant_currency` RPC — source 별 캡으로 재화를 가산하고 갱신 잔액을 반환한다.
   * source: 'pve_run'|'salvage'|'story'|기타. 구버전 게이트웨이면 `undefined`.
   */
  grantCurrency?(
    credits: number,
    minerals: number,
    source: string,
    metrics?: Record<string, unknown>,
  ): Promise<CurrencyGrantResult>;
  /**
   * 서버 `spend_currency` RPC — 잔액 확인 후 차감(부족 시 ok=false·미차감). 갱신 잔액 반환.
   * 사용처: 리스펙·스태시 확장·어픽스 리롤. 구버전 게이트웨이면 `undefined`.
   */
  spendCurrency?(
    credits: number,
    minerals: number,
    reason: string,
  ): Promise<SpendCurrencyResult>;
  /**
   * 촉매 소모(ADR-0029) — 서버 `consume_catalysts` RPC. 슬롯 상한·미지 id·특산-행성 정합·보유량을
   * 서버가 2차 검증하고, 통과 시 보유 원장을 차감한 뒤 pending 런 + 영수증을 심어 `{ run_id,
   * resource_mult }` 를 낸다. **실패 시 예외**(서버 트랜잭션 롤백 = 아이템 미차감). 구버전 게이트웨이면
   * `undefined` — 호출부가 no-op 처리(오프라인 폴백). 침공 런은 이 경로를 타지 않는다(촉매 PvE 전용).
   */
  consumeCatalysts?(catalystIds: number[], planet: number): Promise<CatalystConsumeResult>;
  /**
   * 런 시작 등록(ADR-0050 §3 단계 1) — 서버 `begin_pve_run` RPC. 서버가 `started_at` 을 찍어
   * 드랍 개수 캡의 분모를 만든다. 구버전 게이트웨이면 `undefined` — 호출부가 로컬 롤로 강등한다.
   */
  beginPveRun?(planet: number): Promise<BeginPveRunResult>;
  /**
   * 런 드랍 발급(ADR-0050 §3 단계 1) — 서버 `grant_run_drops` RPC. 클라는 **주운 개수만**
   * 주장하고 서버가 개연성 캡으로 깎은 뒤 자기 시드로 그 수만큼 굴려 원장에 적는다.
   * 같은 런에 두 번 부르면 두 번째는 `already-granted` 로 0건이다(멱등). 구버전이면 undefined.
   */
  grantRunDrops?(
    runId: string,
    claimed: number,
    planet: number,
    stage: number,
    levelCap: number,
  ): Promise<GrantRunDropsResult>;
  /**
   * 미배송 아이템 원장 조회(`applied_at is null`). 배송이 중간에 끊겨도 다음 부팅이 이걸로
   * 재개한다 — `commission_grants`·`daily_reward_claims` 와 같은 배송함 규율. 구버전이면 undefined.
   */
  fetchPendingItemGrants?(): Promise<ItemGrantRow[]>;
  /**
   * 배송 확인 — 서버 `mark_item_grant_applied` RPC. 수령자는 서버가 `auth.uid()` 로 고정하므로
   * 인자로 받지 않는다. 0행 갱신도 오류가 아니라 멱등 성공이다. 구버전이면 undefined.
   */
  markItemGrantApplied?(grantId: string): Promise<void>;
  /**
   * 촉매 드랍 적립(ADR-0029) — 서버 `grant_catalyst` RPC. 엘리트·보스 런 드랍으로 얻은 촉매를
   * 본인 보유 원장에 upsert 적립하고 갱신 수량을 낸다. 미지 id 는 서버가 거부(예외). 구버전이면 undefined.
   */
  grantCatalyst?(catalystId: number, qty: number): Promise<CatalystGrantResult>;
  /**
   * 촉매 분해(ADR-0029 · ADR-0042) — 서버 `salvage_catalyst` RPC. 보유를 차감하고 **촉매 잔재**를
   * 가산해 갱신 잔액을 낸다(`grant_currency` 를 타지 않는다 — 잔재는 촉매 경제 안에 닫혀 있다).
   * 보유 부족·프로필 부재면 `ok=false`(미차감). 구버전이면 undefined.
   */
  salvageCatalyst?(catalystId: number, qty: number): Promise<CatalystSalvageResult>;
  /**
   * 촉매 구매(ADR-0042) — 서버 `buy_catalyst` RPC. 촉매 잔재를 차감하고 보유 원장에 가산한다.
   * 공용 촉매만 판매되며(특산은 `signature-not-sold`), 잔재 부족·미설정가는 `ok=false`(미차감).
   * 구버전 게이트웨이면 undefined — 호출부가 no-op(`unconfigured`) 처리.
   */
  buyCatalyst?(catalystId: number, qty: number): Promise<CatalystBuyResult>;
  /**
   * 촉매 보유 원장 조회 — `catalyst_inventory` select(RLS 로 본인 행만). 픽커·관리 UI 표시용.
   * 구버전 게이트웨이면 undefined(→ 빈 보유로 취급).
   */
  fetchCatalystInventory?(): Promise<CatalystInventoryRow[]>;
  /**
   * 행성 인기 배율표 조회(ADR-0038) — `planet_popularity_current` 뷰 select. **로그인 없이도
   * 읽힌다**(anon/authenticated select). 30분 주기 폴링의 유일한 서버 접점이며, 실패·구버전
   * (undefined)이면 호출부가 전 행성 1.0 폴백으로 떨어진다(무촉매 오프라인 런 보존).
   */
  fetchPlanetMultipliers?(): Promise<PlanetMultiplierRow[]>;
}

/** raw jsonb 에서 안전하게 값 추출(RPC 응답 방어적 파싱). */
function asRec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}
function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/**
 * `source` jsonb → 좁은 레코드. 서버는 `jsonb_strip_nulls` 로 비운 키를 아예 안 싣기 때문에
 * 세 필드가 전부 optional 이다(exactOptionalPropertyTypes 규율상 있을 때만 싣는다).
 */
function grantSource(v: unknown): ItemGrantRow['source'] {
  const r = asRec(v);
  return {
    ...(r.planet !== undefined ? { planet: num(r.planet) } : {}),
    ...(r.stage !== undefined ? { stage: num(r.stage) } : {}),
    ...(r.levelCap !== undefined ? { levelCap: num(r.levelCap) } : {}),
  };
}

/**
 * `grant_run_drops` 가 방금 낸 행. 이 경로에는 `source` 가 안 실린다 — 호출부가 그 값을 인자로
 * 넘겼으므로 되돌려 받을 이유가 없다(응답 크기 절약). 그래서 넘긴 값을 그대로 되쓴다.
 */
function grantRowFromRpc(
  r: Record<string, unknown>,
  src: { planet: number; stage: number; levelCap: number },
): ItemGrantRow {
  return {
    grantId: typeof r.grantId === 'string' ? r.grantId : '',
    dropIndex: num(r.dropIndex),
    dropSeed: num(r.dropSeed),
    rarity: typeof r.rarity === 'string' ? r.rarity : 'normal',
    source: src,
    // 방금 발급된 행은 정의상 미배송이다.
    appliedAtMs: null,
  };
}

/** `item_grants` 테이블 직조회 행(재개 경로). 이쪽은 `source` 가 원장에 적혀 있다. */
function grantRowFromTable(r: Record<string, unknown>): ItemGrantRow {
  const applied = r.applied_at;
  return {
    grantId: typeof r.grant_id === 'string' ? r.grant_id : '',
    dropIndex: num(r.drop_index),
    dropSeed: num(r.drop_seed),
    rarity: typeof r.rarity === 'string' ? r.rarity : 'normal',
    source: grantSource(r.source),
    appliedAtMs: typeof applied === 'string' ? Date.parse(applied) : null,
  };
}

/** Supabase 로 구현한 실 게이트웨이. */
export class SupabaseGateway implements ServerGateway {
  private readonly client: SupabaseClient;

  constructor(config: SupabaseConfig) {
    this.client = getSupabaseClient(config);
  }

  async getUserId(): Promise<string> {
    return requireUserId(this.client);
  }

  async fetchProfile(uid: string): Promise<ServerProfile | null> {
    // 재화 서버 권위(ADR-0027): credits/minerals **컬럼**을 함께 읽는다 — save jsonb 의
    // 낡은 재화가 아니라 서버 정본 컬럼을 미러 초기값으로 쓰기 위함. 구 서버(컬럼 null/부재)면
    // deserializeProfile 이 save 값을 유지한다(하위호환).
    // 촉매 잔재(ADR-0042)도 **이 pull 경로에 얹는다** — 잔재 전용 RPC 를 새로 만들지 않는다
    // (`profiles_select_own` 정책이 이미 본인 행 읽기를 허용한다).
    const { data, error } = await this.client
      .from('profiles')
      // 계보도 컬럼 정본이다(ADR-0007) — 재화와 같은 규율로 이 pull 에 얹는다. 화면 진입 시의
      // `pullLineageState()` 와 **중복이 아니다**: 그쪽은 수호 목록까지 맞추는 화면 전용이고,
      // 여기는 앱 시작·기기 이관 때 save jsonb 의 낡은 계보를 서버 값으로 덮는 자리다.
      .select(
        'save, save_version, credits, minerals, catalyst_residue, lineage_points, lineage_ship_level, lineage_guardian_level',
      )
      .eq('id', uid)
      .maybeSingle();
    if (error !== null) throw error;
    if (data === null) return null;
    const row = data as {
      save: unknown;
      save_version: number;
      credits?: unknown;
      minerals?: unknown;
      catalyst_residue?: unknown;
      lineage_points?: unknown;
      lineage_ship_level?: unknown;
      lineage_guardian_level?: unknown;
    };
    // 계보 세 컬럼은 **함께 있을 때만** 싣는다. 하나라도 빠진 채 부분 반영하면 레벨은 서버,
    // 잔고는 로컬인 뒤섞인 상태가 되고 그 조합은 어느 쪽에서도 정본이 아니다(구 서버 = 셋 다 부재).
    const hasLineage =
      row.lineage_points !== null &&
      row.lineage_points !== undefined &&
      row.lineage_ship_level !== null &&
      row.lineage_ship_level !== undefined &&
      row.lineage_guardian_level !== null &&
      row.lineage_guardian_level !== undefined;
    return {
      save: row.save,
      saveVersion: row.save_version,
      ...(hasLineage
        ? {
            lineage: {
              available: num(row.lineage_points),
              shipLevel: num(row.lineage_ship_level),
              guardianLevel: num(row.lineage_guardian_level),
            },
          }
        : {}),
      ...(row.credits !== null && row.credits !== undefined ? { credits: num(row.credits) } : {}),
      ...(row.minerals !== null && row.minerals !== undefined
        ? { minerals: num(row.minerals) }
        : {}),
      ...(row.catalyst_residue !== null && row.catalyst_residue !== undefined
        ? { catalystResidue: num(row.catalyst_residue) }
        : {}),
    };
  }

  async upsertProfile(
    uid: string,
    payload: { save: Profile; save_version: number },
  ): Promise<void> {
    // save jsonb 안의 credits/minerals 는 표시 미러라 그대로 담아도 무해하다 — 서버 guard
    // 트리거가 재화 컬럼 write 를 이전 값으로 봉인한다(클라 위조 차단, ADR-0027).
    const { error } = await this.client
      .from('profiles')
      .upsert({ id: uid, save: payload.save, save_version: payload.save_version });
    if (error !== null) throw error;
  }

  async settlePveRun(summary: PveSettleSummary): Promise<SettlePveResult> {
    const { data, error } = await this.client.rpc('settle_pve_run', { p_summary: summary });
    if (error !== null) throw error;
    const r = asRec(data);
    return {
      granted_credits: num(r.granted_credits),
      granted_minerals: num(r.granted_minerals),
      credits_left: num(r.credits_left),
      minerals_left: num(r.minerals_left),
      clamped: r.clamped === true,
      settled: r.settled === true,
    };
  }

  async grantCurrency(
    credits: number,
    minerals: number,
    source: string,
    metrics?: Record<string, unknown>,
  ): Promise<CurrencyGrantResult> {
    const { data, error } = await this.client.rpc('grant_currency', {
      p_credits: credits,
      p_minerals: minerals,
      p_source: source,
      p_metrics: metrics ?? null,
    });
    if (error !== null) throw error;
    const r = asRec(data);
    return {
      granted_credits: num(r.granted_credits),
      granted_minerals: num(r.granted_minerals),
      credits_left: num(r.credits_left),
      minerals_left: num(r.minerals_left),
      clamped: r.clamped === true,
    };
  }

  async spendCurrency(
    credits: number,
    minerals: number,
    reason: string,
  ): Promise<SpendCurrencyResult> {
    const { data, error } = await this.client.rpc('spend_currency', {
      p_credits: credits,
      p_minerals: minerals,
      p_reason: reason,
    });
    if (error !== null) throw error;
    const r = asRec(data);
    return {
      ok: r.ok === true,
      credits_left: num(r.credits_left),
      minerals_left: num(r.minerals_left),
    };
  }

  async consumeCatalysts(catalystIds: number[], planet: number): Promise<CatalystConsumeResult> {
    const { data, error } = await this.client.rpc('consume_catalysts', {
      p_catalyst_ids: catalystIds,
      p_planet: planet,
    });
    if (error !== null) throw error;
    const r = asRec(data);
    const runId = typeof r.run_id === 'string' ? r.run_id : '';
    if (runId === '') throw new Error('consume_catalysts: run_id 미발급');
    return { run_id: runId, resource_mult: num(r.resource_mult, 1) };
  }

  async beginPveRun(planet: number): Promise<BeginPveRunResult> {
    const { data, error } = await this.client.rpc('begin_pve_run', { p_planet: planet });
    if (error !== null) throw error;
    const r = asRec(data);
    // run_id 부재는 예외가 아니다 — 캡(throttled)·무인증·프로필 부재를 서버가 값으로 낸다.
    return {
      run_id: typeof r.run_id === 'string' && r.run_id !== '' ? r.run_id : null,
      throttled: r.throttled === true,
      runs_last_hour: num(r.runs_last_hour),
    };
  }

  async grantRunDrops(
    runId: string,
    claimed: number,
    planet: number,
    stage: number,
    levelCap: number,
  ): Promise<GrantRunDropsResult> {
    const { data, error } = await this.client.rpc('grant_run_drops', {
      p_run_id: runId,
      p_claimed: claimed,
      p_planet: planet,
      p_stage: stage,
      p_level_cap: levelCap,
    });
    if (error !== null) throw error;
    const r = asRec(data);
    const rows = Array.isArray(r.grants) ? r.grants : [];
    return {
      granted: num(r.granted),
      claimed: num(r.claimed, claimed),
      clamped: r.clamped === true,
      throttled: r.throttled === true,
      grants: rows.map((row) => grantRowFromRpc(asRec(row), { planet, stage, levelCap })),
    };
  }

  async fetchPendingItemGrants(): Promise<ItemGrantRow[]> {
    const uid = await requireUserId(this.client);
    const { data, error } = await this.client
      .from('item_grants')
      .select('grant_id, drop_index, drop_seed, rarity, source, applied_at')
      .eq('profile_id', uid)
      .is('applied_at', null)
      .order('drop_index', { ascending: true });
    if (error !== null) throw error;
    return (data ?? []).map((row) => grantRowFromTable(asRec(row)));
  }

  async markItemGrantApplied(grantId: string): Promise<void> {
    const { error } = await this.client.rpc('mark_item_grant_applied', { p_grant_id: grantId });
    if (error !== null) throw error;
  }

  async grantCatalyst(catalystId: number, qty: number): Promise<CatalystGrantResult> {
    const { data, error } = await this.client.rpc('grant_catalyst', {
      p_catalyst_id: catalystId,
      p_qty: qty,
    });
    if (error !== null) throw error;
    const r = asRec(data);
    return {
      catalyst_id: num(r.catalyst_id, catalystId),
      qty_after: num(r.qty_after),
      // 구버전 서버(캡 개정 이전)는 granted 를 안 준다 — 그때만 요청 수량으로 폴백한다.
      granted: typeof r.granted === 'number' ? r.granted : qty,
    };
  }

  async salvageCatalyst(catalystId: number, qty: number): Promise<CatalystSalvageResult> {
    const { data, error } = await this.client.rpc('salvage_catalyst', {
      p_catalyst_id: catalystId,
      p_qty: qty,
    });
    if (error !== null) throw error;
    const r = asRec(data);
    return {
      ok: r.ok === true,
      salvaged: num(r.salvaged),
      residue: num(r.residue),
      gained: num(r.gained),
      ...(typeof r.note === 'string' ? { note: r.note } : {}),
    };
  }

  async buyCatalyst(catalystId: number, qty: number): Promise<CatalystBuyResult> {
    const { data, error } = await this.client.rpc('buy_catalyst', {
      p_catalyst_id: catalystId,
      p_qty: qty,
    });
    if (error !== null) throw error;
    const r = asRec(data);
    return {
      ok: r.ok === true,
      catalyst_id: num(r.catalyst_id, catalystId),
      bought: num(r.bought),
      spent: num(r.spent),
      residue: num(r.residue),
      ...(typeof r.note === 'string' ? { note: r.note } : {}),
    };
  }

  async fetchCatalystInventory(): Promise<CatalystInventoryRow[]> {
    const { data, error } = await this.client
      .from('catalyst_inventory')
      .select('catalyst_id, qty');
    if (error !== null) throw error;
    if (!Array.isArray(data)) return [];
    return data.map((row) => {
      const r = asRec(row);
      return { catalyst_id: num(r.catalyst_id), qty: num(r.qty) };
    });
  }

  async fetchPlanetMultipliers(): Promise<PlanetMultiplierRow[]> {
    const { data, error } = await this.client
      .from('planet_popularity_current')
      .select('planet, mult_centi, epoch');
    if (error !== null) throw error;
    if (!Array.isArray(data)) return [];
    return data.map((row) => {
      const r = asRec(row);
      return {
        planet: num(r.planet),
        mult_centi: num(r.mult_centi, 100),
        epoch: num(r.epoch),
      };
    });
  }
}
