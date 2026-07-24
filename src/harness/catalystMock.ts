/**
 * 하네스 촉매 모의 게이트웨이 (개발 도구, DEV 전용 — ADR-0008·ADR-0029).
 *
 * 실 Supabase 없이 도는 하네스에서 촉매 정규경로("보유 시드→픽커 주입→출격→정산")를 끝까지
 * 관측하기 위한 **인메모리 원장 모의**다. `net/index.ts` 의 촉매 4함수(consume/salvage/grant/
 * fetch)는 실 서버가 없으면 이 게이트웨이로 폴백한다(`setHarnessCatalystGateway`). 그러면:
 *  - `fetchCatalystInventory` — 시드된 원장을 성계 지도 픽커·촉매 보관함이 그대로 읽고,
 *  - `consumeCatalysts` — 슬롯 상한·특산 정합·보유량을 서버와 **같은 계약**으로 2차 검증한 뒤
 *    실제로 원장을 차감하고 가짜 runId 를 발급한다(무촉매 폴백이 아니라 실제 주입 출격),
 *  - `grantCatalyst` — 정산이 파생한 드랍을 원장에 적립하고(드랍→다음 주입 루프 실증),
 *  - `salvageCatalyst` — 원장을 차감하고 재화를 지급한다(관리 화면 분해 실증).
 *
 * `consumeFail` 토글로 소모 거부를 강제해 출격 폴백 모달([재시도]/[촉매 빼고 출격])도 재현한다.
 *
 * ## 무엇을 모의하지 않는가
 * 재화·프로필 경로(`settlePveRun`·`grantCurrency`·`spendCurrency`·`upsertProfile`)는 **일부러
 * 비워** 둔다 — 이 게이트웨이는 촉매 4함수 전용 폴백이고, 재화/프로필은 하네스가 기존대로
 * 로컬(프로필 직접 편집 + 미설정 폴백)로 처리해야 하기 때문이다. 필수 3메서드는 스텁이다.
 *
 * 프로덕션 미포함: 하네스 배선(main.ts DEV 블록)에서만 동적 import 되므로 트리셰이킹으로
 * 프로덕션 번들에서 완전히 제거된다.
 */

import type { ServerProfile } from '../net/profileSync.js';
import type {
  ServerGateway,
  CatalystConsumeResult,
  CatalystSalvageResult,
  CatalystGrantResult,
  CatalystInventoryRow,
} from '../net/gateway.js';
import {
  CATALYSTS,
  catalystById,
  normalizeCatalystArray,
  isWithinSlotCap,
  resourceMultOf,
} from '../data/catalysts.js';

/**
 * 분해 1개당 지급 크레딧(하네스 모의 placeholder — 실 밸런스 아님). salvage 응답 잔액을
 * "현재 크레딧 + 이 값"으로 되돌려 관리 화면에서 크레딧이 실제로 오르는 것을 관측한다.
 */
const MOCK_SALVAGE_CREDIT = 50;

/** 하네스 모의가 참조하는 재화 리더(하네스 프로필의 현재 재화 — 분해 잔액 산정용). */
export interface MockCurrencyReader {
  credits(): number;
  minerals(): number;
}

/**
 * 인메모리 촉매 원장 모의. `ServerGateway` 의 촉매 4메서드를 실제 원장 상태로 구현하고,
 * 나머지 필수/재화 메서드는 스텁으로 둔다.
 */
export class HarnessCatalystGateway implements ServerGateway {
  /** catalyst_id → 보유 수량(>0 만 유지). */
  private readonly ledger = new Map<number, number>();
  /** consume 강제 실패 토글(출격 폴백 모달 실증용). */
  private consumeFail = false;
  /** 발급 runId 카운터(가짜 uuid 대용). */
  private runCounter = 0;
  private readonly currency: MockCurrencyReader;

  constructor(currency: MockCurrencyReader) {
    this.currency = currency;
  }

  // --- 하네스 제어 표면(치트 패널이 호출) -----------------------------------

  /** 원장에 촉매를 더한다(id → +qty 합산). qty<=0 은 무시. */
  seed(entries: readonly { id: number; qty: number }[]): void {
    for (const { id, qty } of entries) {
      if (catalystById(id) === undefined || qty <= 0) continue;
      this.ledger.set(id, (this.ledger.get(id) ?? 0) + Math.floor(qty));
    }
  }

  /** 48종 전부를 각 qty 개씩 시드한다(각 id → +qty). */
  seedAll(qty: number): void {
    if (qty <= 0) return;
    for (const def of CATALYSTS) this.ledger.set(def.id, (this.ledger.get(def.id) ?? 0) + Math.floor(qty));
  }

  /** 원장을 통째로 비운다. */
  clear(): void {
    this.ledger.clear();
  }

  /** consume 강제 실패 토글 설정. */
  setConsumeFail(fail: boolean): void {
    this.consumeFail = fail;
  }

  /** 현재 consume 강제 실패 여부. */
  isConsumeFail(): boolean {
    return this.consumeFail;
  }

  /** 현재 원장 스냅샷(id→qty, 복사본). 픽커 즉시 표시용으로 성계 지도에 넘긴다. */
  snapshot(): Map<number, number> {
    return new Map(this.ledger);
  }

  // --- ServerGateway: 필수 스텁 ---------------------------------------------

  async getUserId(): Promise<string> {
    return 'harness-uid';
  }
  async fetchProfile(): Promise<ServerProfile | null> {
    return null;
  }
  async upsertProfile(): Promise<void> {
    /* 재화/프로필은 하네스가 로컬로 처리 — 모의 안 함(no-op). */
  }

  // --- ServerGateway: 촉매 4메서드(실제 원장 상태) --------------------------

  /**
   * 출격 직전 소모. 서버 `consume_catalysts` 와 **같은 계약**으로 검증한다: 슬롯 상한 초과·미지
   * id·특산-행성 불일치·보유량 부족이면 **throw**(서버 트랜잭션 롤백 = 아이템 미차감). 통과하면
   * 원장을 차감하고 가짜 runId + 자원 배율을 낸다. `consumeFail` 이 켜져 있으면 무조건 throw.
   */
  async consumeCatalysts(catalystIds: number[], planet: number): Promise<CatalystConsumeResult> {
    if (this.consumeFail) throw new Error('harness: consume 강제 실패');
    const ids = normalizeCatalystArray(catalystIds);
    if (ids.length === 0) throw new Error('harness: 유효 촉매 없음');
    if (!isWithinSlotCap(ids)) throw new Error('harness: 슬롯 상한 초과');
    // 필요 수량 집계 + 특산-행성 정합 검증(서버 2차 검증 미러).
    const need = new Map<number, number>();
    for (const id of ids) {
      const def = catalystById(id);
      if (def === undefined) throw new Error(`harness: 미지 촉매 ${id}`);
      if (def.kind === 'signature' && def.planet !== planet) {
        throw new Error(`harness: 특산 촉매 ${id} 는 행성 ${def.planet} 전용`);
      }
      need.set(id, (need.get(id) ?? 0) + 1);
    }
    for (const [id, n] of need) {
      if ((this.ledger.get(id) ?? 0) < n) throw new Error(`harness: 촉매 ${id} 보유 부족`);
    }
    // 통과 — 원장 차감(서버 성공 트랜잭션 미러).
    for (const [id, n] of need) this.decrement(id, n);
    this.runCounter += 1;
    return { run_id: `harness-run-${this.runCounter}`, resource_mult: resourceMultOf(ids) };
  }

  /** 드랍 적립 — 원장에 upsert 가산하고 갱신 수량을 낸다. */
  async grantCatalyst(catalystId: number, qty: number): Promise<CatalystGrantResult> {
    if (catalystById(catalystId) === undefined) throw new Error(`harness: 미지 촉매 ${catalystId}`);
    const after = (this.ledger.get(catalystId) ?? 0) + Math.max(0, Math.floor(qty));
    this.ledger.set(catalystId, after);
    return { catalyst_id: catalystId, qty_after: after };
  }

  /**
   * 분해 — 보유가 충분하면 차감하고 재화를 지급한다(재화는 하네스 프로필 현재값 + placeholder).
   * 보유 부족이면 `ok=false`(미차감). 서버 `salvage_catalyst` 와 같은 반환 계약.
   */
  async salvageCatalyst(catalystId: number, qty: number): Promise<CatalystSalvageResult> {
    const owned = this.ledger.get(catalystId) ?? 0;
    const want = Math.max(0, Math.floor(qty));
    if (want <= 0 || owned < want) {
      return { ok: false, salvaged: 0, credits_left: this.currency.credits(), minerals_left: this.currency.minerals() };
    }
    this.decrement(catalystId, want);
    return {
      ok: true,
      salvaged: want,
      credits_left: this.currency.credits() + MOCK_SALVAGE_CREDIT * want,
      minerals_left: this.currency.minerals(),
    };
  }

  /** 보유 원장 조회 — >0 인 행만 낸다. */
  async fetchCatalystInventory(): Promise<CatalystInventoryRow[]> {
    const rows: CatalystInventoryRow[] = [];
    for (const [catalyst_id, qty] of this.ledger) {
      if (qty > 0) rows.push({ catalyst_id, qty });
    }
    return rows;
  }

  // --- 내부 -----------------------------------------------------------------

  private decrement(id: number, n: number): void {
    const left = (this.ledger.get(id) ?? 0) - n;
    if (left > 0) this.ledger.set(id, left);
    else this.ledger.delete(id);
  }
}
