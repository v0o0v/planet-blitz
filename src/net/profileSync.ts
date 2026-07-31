/**
 * 세이브 이관·동기화의 순수 로직(M4 Phase B3 — 계획 §4, AC8).
 *
 * 이 모듈은 네트워크·`@supabase/supabase-js` 를 전혀 import 하지 않는다 — 전부
 * 결정적 순수 함수/스토어 조작이라 vitest 로 단독 검증된다. 실제 서버 IO 는
 * `gateway.ts`(SupabaseGateway)가 담당하고, 오케스트레이션은 `index.ts` 가 이
 * 순수 함수들을 엮는다.
 *
 * 설계 결정(무손실·멱등, 계획 AC8):
 *  - 이관은 로컬 → 서버 "1회 임포트"다. 성공하면 uid 별 마커를 남겨 재실행 시
 *    스킵(멱등)한다.
 *  - 서버에 이미 프로필이 있는데 로컬이 아직 미이관(예: 재설치)이면 두 프로필 중
 *    "진행도가 높은 쪽"을 통째로 고른다(`chooseProfile`). 필드 단위 병합 대신 통짜
 *    선택인 이유: Profile 불변식(용량·장착 정합)을 깨지 않고, 같은 프로필을 다시
 *    병합해도 자기 자신이 나와 멱등이 보장되기 때문. 래더/침공 결과의 서버 권위는
 *    별도 테이블(원칙2)이라 이 선택과 무관하다.
 */

import type { Profile } from '../save/profile.js';
import { migrate } from '../save/profile.js';
import type { PveSettleSummary } from './gateway.js';

/** 서버 `profiles` 행에서 이관에 필요한 최소 형태. */
export interface ServerProfile {
  /** DB 의 profiles.save(jsonb) — 로컬 Profile 전체. */
  save: unknown;
  /** DB 의 profiles.save_version. */
  saveVersion: number;
  /**
   * DB 의 profiles.credits **컬럼**(재화 정본, ADR-0027). 있으면 deserializeProfile 이
   * save 의 낡은 credits 를 이 값으로 덮어쓴다(서버 권위). 구 서버(컬럼 없음)면 undefined.
   */
  credits?: number;
  /** DB 의 profiles.minerals **컬럼**(재화 정본, ADR-0027). credits 와 동일 규율. */
  minerals?: number;
  /**
   * DB 의 profiles.catalyst_residue **컬럼**(촉매 잔재, ADR-0042). 촉매 상점 화면이 읽는
   * 유일한 잔재 소스다 — 전용 RPC 대신 이 pull 경로에 얹었다. **로컬 `Profile` 로는 흘리지
   * 않는다**(잔재는 서버 권위 잔액이고 save jsonb 미러를 만들면 위조 표면이 늘어난다).
   * 구 서버(컬럼 부재)면 undefined.
   */
  catalystResidue?: number;
}

/** 이관 계획: 업로드할지/스킵할지 + 업로드할 프로필. */
export interface MigrationPlan {
  action: 'skip' | 'upload';
  profile: Profile;
}

// ---------------------------------------------------------------------------
// 직렬화
// ---------------------------------------------------------------------------

/** Profile → 서버 업서트용 페이로드. save 에 전체 Profile, save_version 은 스탬프. */
export function serializeProfile(profile: Profile): { save: Profile; save_version: number } {
  return { save: profile, save_version: profile.saveVersion };
}

/**
 * 서버 행 → Profile. 손상/구버전 blob 도 `migrate` 를 거쳐 항상 유효한 현행
 * Profile 로 복원한다(로컬 로딩과 동일 규율).
 *
 * 재화 서버 권위(ADR-0027): `credits`/`minerals` **컬럼**이 내려오면 migrate 된 프로필의
 * 표시 미러를 컬럼값으로 덮어쓴다 — save jsonb 안의 낡은 재화가 아니라 서버 정본 잔액을
 * 미러 초기값으로 삼기 위함. 컬럼이 null/부재(구 서버)면 save 값을 유지한다(하위호환).
 */
export function deserializeProfile(row: ServerProfile): Profile {
  const profile = migrate(row.save);
  if (typeof row.credits === 'number' && Number.isFinite(row.credits)) {
    profile.credits = row.credits;
  }
  if (typeof row.minerals === 'number' && Number.isFinite(row.minerals)) {
    profile.minerals = row.minerals;
  }
  return profile;
}

// ---------------------------------------------------------------------------
// 진행도 비교 · 통짜 선택
// ---------------------------------------------------------------------------

/**
 * 프로필 진행도 점수(단조 성격의 대략 지표). 기체 레벨을 가장 크게 가중해, 재설치
 * 등으로 두 프로필이 충돌할 때 더 많이 진행된 쪽을 고르는 데 쓴다. 정확한 경제
 * 총량이 아니라 "누가 더 진행했나" 판정용이다.
 *
 * 재화 서버 권위 이관(ADR-0027): credits·minerals 는 점수에서 **제외**한다. 재화가 서버
 * 컬럼 정본이 된 뒤로는 save 미러의 재화가 잘못된 순위 신호이고(낡은 미러가 sync 방향을
 * 왜곡), 특히 소비 직전에 stash 된 stale-high 크레딧 스냅샷이 `shouldPushPending` 을 통과해
 * 서버 차감을 되돌리던 정비 이중 권위 결함의 뿌리였다. 순위는 순수 진행도(기체 레벨·스킬
 * 포인트·아이템)만으로 판정한다.
 */
export function progressScore(p: Profile): number {
  let shipLevels = 0;
  for (const s of p.ships) shipLevels += s.level;
  return shipLevels * 1000 + p.skillPoints + p.inventory.length + p.stash.length;
}

/**
 * 두 프로필 중 진행도가 높은 쪽을 통째로 반환한다. 동점이면 로컬 우선(오프라인
 * 우선 철학 — 방금 플레이한 로컬을 신뢰). 통짜 선택이라 Profile 불변식을 유지하고
 * 멱등하다(같은 값끼리 비교하면 그 값이 나옴).
 */
export function chooseProfile(local: Profile, server: Profile): Profile {
  return progressScore(server) > progressScore(local) ? server : local;
}

/**
 * 다기기 last-write-wins 보강(코드리뷰 MED-6): 대기 중인 스냅샷(`pending`)을
 * 서버로 밀어 넣기 전에, 서버가 그 사이 이미 더 진행된 상태로 갱신됐는지 판정한다.
 * `pending` 이 서버보다 뒤처지면(진행도가 낮으면) false — 이 경우 업로드는 서버의
 * 더 나은 상태를 낡은 스냅샷으로 덮어쓰는 회귀이므로 스킵해야 한다. 서버가 없거나
 * `pending` 이 동점 이상이면 true(무손실 철학 — 진행이 뒤처지지 않는 한 반영).
 */
export function shouldPushPending(pending: Profile, server: Profile | null): boolean {
  if (server === null) return true;
  return chooseProfile(pending, server) === pending;
}

/**
 * 이관 계획 수립(순수). 분기:
 *  1. 이미 이관 완료(마커 有) + 서버에 프로필 존재 → skip(멱등).
 *  2. 서버에 프로필 없음 → 로컬 업로드(최초 임포트, 또는 마커만 남고 서버가 비어
 *     복구 임포트).
 *  3. 서버에 프로필 있고 아직 미이관 → 진행도 높은 쪽 선택 후 업로드(병합).
 */
export function planServerMigration(
  local: Profile,
  server: Profile | null,
  alreadyMigrated: boolean,
): MigrationPlan {
  if (server === null) {
    return { action: 'upload', profile: local };
  }
  if (alreadyMigrated) {
    return { action: 'skip', profile: server };
  }
  return { action: 'upload', profile: chooseProfile(local, server) };
}

// ---------------------------------------------------------------------------
// 로컬 동기화 상태 스토어(오프라인 우선 재시도 큐)
// ---------------------------------------------------------------------------

import type { KeyValueStore } from '../save/profile.js';

/** 이관 완료 마커 키 — 값은 이관한 uid(다른 익명 uid 로 바뀌면 재이관 판정). */
const MIGRATED_KEY = 'planet-blitz:net:migrated';
/**
 * 전송 대기 프로필 슬롯. 프로필은 "최신 스냅샷 하나"면 충분하므로 큐가 아니라
 * last-write-wins 단일 슬롯이다(과거 스냅샷 축적 불필요). 오프라인/전송 실패 시
 * 여기 남았다가 다음 기회에 flush 된다.
 */
const PENDING_KEY = 'planet-blitz:net:pending';

/** 이 uid 로 이관이 끝났는지. */
export function isMigrated(store: KeyValueStore, uid: string): boolean {
  try {
    return store.getItem(MIGRATED_KEY) === uid;
  } catch {
    return false;
  }
}

/** 이관 완료 마커를 이 uid 로 남긴다. */
export function markMigrated(store: KeyValueStore, uid: string): void {
  try {
    store.setItem(MIGRATED_KEY, uid);
  } catch {
    // 스토리지 거부(사생활 모드 등) — 다음 세션에 다시 이관 시도될 뿐 무해.
  }
}

/** 전송 대기 프로필을 최신값으로 덮어쓴다(last-write-wins). */
export function stashPendingProfile(store: KeyValueStore, profile: Profile): void {
  try {
    store.setItem(PENDING_KEY, JSON.stringify(profile));
  } catch {
    // 저장 실패는 삼킨다 — 메타 동기화는 best-effort.
  }
}

/** 대기 중인 프로필을 읽어 유효 Profile 로 복원한다. 없으면 null. */
export function readPendingProfile(store: KeyValueStore): Profile | null {
  let raw: string | null;
  try {
    raw = store.getItem(PENDING_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    return migrate(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/** 전송 대기 슬롯 비우기(업로드 성공 후). */
export function clearPendingProfile(store: KeyValueStore): void {
  try {
    store.removeItem(PENDING_KEY);
  } catch {
    // 무해.
  }
}

/**
 * 대기 슬롯에 스냅샷이 **이미 남아 있을 때만** 최신 프로필로 교체한다(없으면 아무것도
 * 안 함 — 새 push 를 만들지 않는다). 반환: 교체했는지.
 *
 * 유래(정비 이중 권위 방어, Phase E 리뷰 MED): 서버가 크레딧을 차감하는 정비
 * (`repair_defense`) 직후, 정비 **전**에 stash 된 낡은 스냅샷이 대기 슬롯에 남아 있으면
 * 다음 {@link flushPendingSync} 재시도가 정비 전 크레딧을 서버로 되밀던 밴드에이드였다.
 *
 * ⚠️ ADR-0027 이후: 재화가 서버 컬럼 권위로 이관되고 {@link progressScore} 에서 credits 를
 * 제거해, 이 밴드에이드의 **원래 위험(stale-high 크레딧 재push)은 해소됐다** — stale-high
 * 미러는 더 이상 `shouldPushPending` 을 통과하지 못하고, 서버는 save 미러가 아니라 컬럼만
 * 읽는다. 호출부(modulesView 등)를 깨지 않기 위해 함수는 그대로 둔다(무해한 no-risk 갱신).
 */
export function refreshPendingProfile(store: KeyValueStore, profile: Profile): boolean {
  if (readPendingProfile(store) === null) return false;
  stashPendingProfile(store, profile);
  return true;
}

// ---------------------------------------------------------------------------
// 대기 정산 큐(온라인이지만 전송 실패한 재화 정산 재시도, ADR-0026 E)
// ---------------------------------------------------------------------------

/**
 * 전송 실패한 PvE 정산 요약 대기 큐. 프로필 스냅샷 슬롯과 달리 **누적 목록**이다 — 각
 * 정산은 독립 지급이라 last-write-wins 로 덮으면 지급이 유실되기 때문. flushPendingSync 가
 * 서버 회복 시 순서대로 재지급한다. 재화 컬럼 정본이라 미러는 다음 fetchProfile 이 맞춘다.
 */
const PENDING_SETTLEMENTS_KEY = 'planet-blitz:net:pending-settlements';

/**
 * 대기 정산 1건. `summary` 가 null 이면 story 보상만 남은 재시도(settle 은 이미 성공,
 * story grant 만 실패). storyRewardCredits>0 이면 story 보상 grant 를 재시도한다.
 */
export interface PendingSettlement {
  summary: PveSettleSummary | null;
  storyRewardCredits: number;
}

/** 대기 정산 목록을 읽는다(손상/부재 시 빈 배열). */
export function readPendingSettlements(store: KeyValueStore): PendingSettlement[] {
  let raw: string | null;
  try {
    raw = store.getItem(PENDING_SETTLEMENTS_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is PendingSettlement =>
        typeof e === 'object' && e !== null && typeof (e as PendingSettlement).storyRewardCredits === 'number',
    );
  } catch {
    return [];
  }
}

/** 대기 정산 목록을 통째로 저장한다(비었으면 슬롯 제거). */
export function writePendingSettlements(store: KeyValueStore, list: readonly PendingSettlement[]): void {
  try {
    if (list.length === 0) store.removeItem(PENDING_SETTLEMENTS_KEY);
    else store.setItem(PENDING_SETTLEMENTS_KEY, JSON.stringify(list));
  } catch {
    // best-effort — 저장 실패는 삼킨다.
  }
}

/** 대기 정산 1건을 큐 끝에 추가한다. */
export function stashPendingSettlement(store: KeyValueStore, entry: PendingSettlement): void {
  const list = readPendingSettlements(store);
  list.push(entry);
  writePendingSettlements(store, list);
}

// ---------------------------------------------------------------------------
// 대기 재화 가산 큐(온라인이지만 전송 실패한 grant 재시도, MED-1 수정)
// ---------------------------------------------------------------------------

/**
 * 전송 실패한 재화 가산(살베지 등) 대기 큐. 살베지는 아이템을 이미 로컬 제거한 뒤 재화를
 * 서버에 얹는데, 온라인 일시 오류로 grant 가 실패하면 서버 원장에 반영되지 않아 다음
 * fetchProfile 이 미러를 서버값으로 되돌려 재화가 소멸한다(아이템은 이미 사라진 채). 이 큐가
 * 실패한 grant 를 남겨 {@link flushPendingSync} 가 재지급한다 — 정산 큐(PendingSettlement)와
 * 같은 규율의 grant 판이다. 누적 목록이라 다건 살베지가 유실되지 않는다.
 */
const PENDING_GRANTS_KEY = 'planet-blitz:net:pending-grants';

/** 대기 재화 가산 1건(source 별 credits/minerals). */
export interface PendingGrant {
  credits: number;
  minerals: number;
  source: string;
}

/** 대기 가산 목록을 읽는다(손상/부재 시 빈 배열). */
export function readPendingGrants(store: KeyValueStore): PendingGrant[] {
  let raw: string | null;
  try {
    raw = store.getItem(PENDING_GRANTS_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is PendingGrant =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as PendingGrant).credits === 'number' &&
        typeof (e as PendingGrant).minerals === 'number' &&
        typeof (e as PendingGrant).source === 'string',
    );
  } catch {
    return [];
  }
}

/** 대기 가산 목록을 통째로 저장한다(비었으면 슬롯 제거). */
export function writePendingGrants(store: KeyValueStore, list: readonly PendingGrant[]): void {
  try {
    if (list.length === 0) store.removeItem(PENDING_GRANTS_KEY);
    else store.setItem(PENDING_GRANTS_KEY, JSON.stringify(list));
  } catch {
    // best-effort — 저장 실패는 삼킨다.
  }
}

/** 대기 가산 1건을 큐 끝에 추가한다. */
export function stashPendingGrant(store: KeyValueStore, entry: PendingGrant): void {
  const list = readPendingGrants(store);
  list.push(entry);
  writePendingGrants(store, list);
}
