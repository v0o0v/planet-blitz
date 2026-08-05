/**
 * 계정 스코프 가드 — 로그인 uid 가 바뀌면 로컬 상태를 통째로 버린다.
 *
 * ## 왜 필요한가 — 이건 재화 이전 경로였다
 * 로컬 키 8개에 **uid 가 안 들어간다**(`planet-blitz:profile` 과 대기 큐 5종, 침공 로컬 상태 2종).
 * 익명 유저 하나뿐일 때는 드러나지 않았지만, 계정 전환이 가능해지는 순간 둘이 터진다:
 *
 *  - 계정 A 로 놀다 B 로 로그인하면 **로컬에 남은 A 의 프로필이 B 의 uid 로 upsert** 된다.
 *  - A 의 미전송 `pending-settlements` 가 **B 의 세션으로 flush** 되어 A 가 번 재화가 B 에게 간다.
 *
 * `chooseProfile` 의 진행도 비교가 "빈 로컬이 서버를 덮는" 파괴는 막아 주지만, 반대 방향
 * (진행도 높은 A 가 B 를 덮는 것)은 **막지 못한다** — 그쪽이 정확히 이 가드가 필요한 이유다.
 *
 * ## 왜 키에 uid 를 붙이지 않았나
 * `planet-blitz:profile:<uid>` 로 나누는 안도 있었지만 버렸다. ①키 8종 전부 마이그레이션이
 * 필요하고 ②공용 PC 에 계정별 데이터가 무한히 쌓이며 ③**서버가 정본이라 로컬을 보존할 이유가
 * 없다**. 버리고 다시 받는 편이 코드도 불변식도 단순하다.
 *
 * ## 왜 "다르면"이 아니라 "같지 않으면"인가
 * 마지막 uid 가 **없을 때도**(첫 로그인) 지운다. 그래야 "로컬에 있는 것은 지금 로그인한 계정의
 * 것뿐"이라는 불변식이 예외 없이 성립한다. 익명으로 놀던 브라우저에서 처음 로그인하는 경우
 * 남아 있던 익명 진행도가 구글 계정으로 딸려 올라가는 것도 이 규칙이 막는다. 정상 사용자는
 * 2회차부터 uid 가 같으므로 아무것도 지워지지 않는다.
 *
 * ## 기기 설정은 건드리지 않는다
 * 언어·그래픽·음량은 `pb.` 접두사(`pb.locale`·`pb.graphics`·`pb.audio`)를 쓰고 계정 데이터는
 * `planet-blitz:` 접두사를 쓴다. **이 분리가 규약이다** — 새 키를 만들 때 지켜야 하고,
 * `tests/accountScope.test.ts` 가 소스를 훑어 `planet-blitz:` 키가 아래 목록 밖으로 새지
 * 않았는지 잠근다(목록에 안 적힌 계정 키는 계정이 바뀌어도 안 지워지는 조용한 결함이 된다).
 */

import type { KeyValueStore } from '../save/profile.js';

/**
 * ambient localStorage 를 `KeyValueStore` 로. 없거나 접근이 throw 하면 null.
 *
 * `net/index.ts` 의 동명 헬퍼는 모듈 private 이라 재사용할 수 없어 여기 둔다 — 이 모듈은
 * 부팅 경로(`main.ts`)가 직접 쓰므로 스토어 해석까지 자기가 책임지는 편이 호출부가 얇다.
 */
export function accountStore(): KeyValueStore | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // 사생활 모드 등에서 접근 자체가 throw 할 수 있다.
  }
  return null;
}

/**
 * 계정이 바뀌면 버릴 로컬 키 전부.
 *
 * ⚠️ `planet-blitz:` 접두사로 새 키를 만들면 **여기에 반드시 추가**하라. 접두사로 일괄
 * 처리하지 않는 것은 `KeyValueStore` 에 키 열거 API 가 없기 때문이다(getItem/setItem/
 * removeItem 뿐). 누락은 위 테스트가 잡는다.
 */
export const ACCOUNT_SCOPED_KEYS = [
  // 진행도 본체.
  'planet-blitz:profile',
  // 서버 이관·전송 대기 상태(profileSync.ts).
  'planet-blitz:net:migrated',
  'planet-blitz:net:pending',
  'planet-blitz:net:pending-settlements',
  'planet-blitz:net:pending-grants',
  'planet-blitz:net:pending-commission-submissions',
  // 침공 로컬 상태(invasion.ts) — 상대별 쿨다운과 결과 확인 시각. 둘 다 "내" 상태다.
  'planet-blitz:net:invasionCooldowns',
  'planet-blitz:net:invasionsSeenAt',
  // 일일 보상 모달을 마지막으로 띄운 날(save/dailySeen.ts). 진행도가 아니라 표시 상태이지만
  // **계정 것**이다 — 남겨 두면 계정을 바꾼 직후 새 계정에서 그날 모달이 안 뜨고, 그러면
  // 그 계정의 첫날 보상 예고를 못 본 채로 지나간다(수령 자체는 서버가 하므로 지급은 된다).
  'planet-blitz:daily-seen',
] as const;

/**
 * 마지막으로 로컬을 채운 계정의 uid.
 *
 * {@link ACCOUNT_SCOPED_KEYS} 에 넣지 않는다 — 지우는 주체가 자기 자신을 지우면 다음 부팅에
 * 또 초기화가 돈다. 대신 초기화 직후 새 uid 로 덮어쓴다.
 */
const LAST_UID_KEY = 'planet-blitz:net:last-uid';

/**
 * 로그인한 uid 와 로컬 상태의 주인을 맞춘다. 주인이 다르면(또는 기록이 없으면) 계정 스코프
 * 키를 전부 지우고 uid 를 새로 기록한다.
 *
 * @returns 실제로 지웠으면 true. 호출부는 이 값으로 "서버에서 다시 받아야 한다"를 판단한다.
 *
 * 저장소 접근이 throw 하는 환경(사생활 모드 등)에서는 아무것도 하지 않고 false 를 돌린다 —
 * 그런 환경은 애초에 로컬에 남는 것이 없으므로 오염될 것도 없다.
 */
export function reconcileAccountScope(store: KeyValueStore | null, uid: string): boolean {
  if (store === null) return false;
  let last: string | null;
  try {
    last = store.getItem(LAST_UID_KEY);
  } catch {
    return false;
  }
  if (last === uid) return false;

  for (const key of ACCOUNT_SCOPED_KEYS) {
    try {
      store.removeItem(key);
    } catch {
      // 개별 삭제 실패는 삼킨다 — 나머지는 계속 지워야 한다.
    }
  }
  try {
    store.setItem(LAST_UID_KEY, uid);
  } catch {
    // 기록 실패 시 다음 부팅에 한 번 더 지운다(멱등이라 무해).
  }
  return true;
}

/**
 * 로그아웃 시 호출 — 계정 스코프 키와 주인 기록을 함께 지운다.
 *
 * 주인 기록까지 지우는 것이 {@link reconcileAccountScope} 와 다른 점이다. 로그아웃 후에는
 * "로컬에 아무 계정의 것도 없다"가 맞는 상태다.
 */
export function clearAccountScope(store: KeyValueStore | null): void {
  if (store === null) return;
  for (const key of [...ACCOUNT_SCOPED_KEYS, LAST_UID_KEY]) {
    try {
      store.removeItem(key);
    } catch {
      // 위와 같다.
    }
  }
}
