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

/** 서버 `profiles` 행에서 이관에 필요한 최소 형태. */
export interface ServerProfile {
  /** DB 의 profiles.save(jsonb) — 로컬 Profile 전체. */
  save: unknown;
  /** DB 의 profiles.save_version. */
  saveVersion: number;
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
 */
export function deserializeProfile(row: ServerProfile): Profile {
  return migrate(row.save);
}

// ---------------------------------------------------------------------------
// 진행도 비교 · 통짜 선택
// ---------------------------------------------------------------------------

/**
 * 프로필 진행도 점수(단조 성격의 대략 지표). 기체 레벨을 가장 크게 가중해, 재설치
 * 등으로 두 프로필이 충돌할 때 더 많이 진행된 쪽을 고르는 데 쓴다. 정확한 경제
 * 총량이 아니라 "누가 더 진행했나" 판정용이다.
 */
export function progressScore(p: Profile): number {
  let shipLevels = 0;
  for (const s of p.ships) shipLevels += s.level;
  return (
    shipLevels * 1000 +
    p.credits +
    p.minerals +
    p.skillPoints +
    p.inventory.length +
    p.stash.length
  );
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
