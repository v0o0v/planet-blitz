/**
 * 일일 보상 모달을 **마지막으로 띄운 날**의 로컬 기록 (ADR-0048 · AC-18).
 *
 * ## 왜 `Profile` 안이 아니라 별도 키인가
 *
 * 이것은 진행도가 아니라 **이 기기가 오늘 모달을 보여 줬는가**라는 표시 상태다. `Profile`
 * 에 넣으면 세 가지가 따라온다: ① `SAVE_VERSION` 범프와 마이그레이션 ② 다기기 동기화
 * 대상이 되어 **다른 기기에서 봤다는 이유로 이 기기에서 안 뜨는** 형태가 되고 ③
 * `progressScore` 기반 통짜 선택(`src/net/profileSync.ts`)의 표면이 넓어진다.
 * 셋 다 이 값에는 원하지 않는 성질이다 — 표시 상태는 기기 로컬이 맞다.
 *
 * ## 왜 세션 메모리가 아닌가
 *
 * 세션 변수로 두면 같은 날 앱을 다시 켤 때마다 모달이 다시 뜬다. 하루 여러 번 켜는
 * 플레이어에게 그것은 **통지가 아니라 방해**다. 수령은 이미 서버에서 멱등하므로 반복
 * 표시가 지급을 바꾸지는 않지만, 화면은 하루 한 번이어야 한다.
 *
 * ## 스토어를 직접 잡지 않는 이유
 *
 * `defaultProfileStore()` 를 쓴다. 자기 `localStorage` 를 잡으면 하네스 프로필 슬롯이
 * 격리될 때(`setProfileStoreOverride`) 이 값만 실계정 것을 계속 읽어, **치트로 하루를
 * 넘겨도 모달이 안 뜨는** 형태의 결함이 된다 — 하네스로 30일차까지 미는 검증(AC-26)이
 * 정확히 그 자리에서 죽는다.
 */

import { DAILY_SEED_NEVER } from '../../data/dailyReward.js';
import { defaultProfileStore, type KeyValueStore } from './profile.js';

/** 저장 키. `planet-blitz:profile` 과 같은 이름공간을 쓴다. */
const DAILY_SEEN_KEY = 'planet-blitz:daily-seen';

/**
 * 마지막으로 모달을 띄운 `date_seed`. 기록이 없거나 손상됐으면 {@link DAILY_SEED_NEVER}.
 *
 * 손상을 예외로 던지지 않고 "미표시"로 접는 이유: 이 값이 틀렸을 때의 두 결과가
 * 대칭이 아니다 — 모달을 한 번 더 띄우는 것은 사소하지만, 예외를 던지면 그것이
 * `openBaseMap()` 안에서 터져 **기지 화면 자체가 안 그려진다.**
 */
export function loadDailySeenSeed(store: KeyValueStore | null = defaultProfileStore()): number {
  if (store === null) return DAILY_SEED_NEVER;
  try {
    const raw = store.getItem(DAILY_SEEN_KEY);
    if (raw === null) return DAILY_SEED_NEVER;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : DAILY_SEED_NEVER;
  } catch {
    return DAILY_SEED_NEVER;
  }
}

/** 오늘 모달을 띄웠음을 기록한다. 실패는 조용히 삼킨다(위 손상 처리와 같은 근거). */
export function saveDailySeenSeed(
  dateSeed: number,
  store: KeyValueStore | null = defaultProfileStore(),
): void {
  if (store === null) return;
  try {
    store.setItem(DAILY_SEEN_KEY, String(Math.max(0, Math.floor(dateSeed))));
  } catch {
    // 사생활 보호 모드·용량 초과 등. 다음 진입에 모달이 한 번 더 뜨는 것이 전부다.
  }
}

/** 하네스·테스트용 초기화. */
export function clearDailySeenSeed(store: KeyValueStore | null = defaultProfileStore()): void {
  if (store === null) return;
  try {
    store.removeItem(DAILY_SEEN_KEY);
  } catch {
    // 위와 같다.
  }
}
