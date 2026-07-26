/**
 * 테스트 보조 — **만렙 강제 후 퇴역**.
 *
 * 퇴역(`retireActiveShip`)에는 만렙 게이트가 있다(활성 기체 `level >= LEVEL_CAP`). 퇴역 자체가
 * 관심사가 아닌 기존 테스트들은 이 헬퍼로 게이트를 통과시킨다 — 게이트 **판정** 을 검증하는
 * 테스트는 이걸 쓰지 말고 `retireActiveShip` 을 직접 불러야 한다(헬퍼가 조건을 만들어 주므로
 * 거부 경로가 가려진다).
 *
 * 레벨만 만렙으로 올린다: 퇴역 결과(전투력 점수·스냅샷·계보 지급)는 장비와 스킬 투자에서
 * 파생되고 레벨을 읽지 않으므로, 기존 기대값이 이 조작으로 흔들리지 않는다.
 */

import { activeShip, type Profile } from '../../src/save/profile.js';
import { retireActiveShip, type RetireResult } from '../../src/save/guardianLifecycle.js';
import { LEVEL_CAP } from '../../data/waves.js';

export function retireAtCap(profile: Profile, preset?: number, nextTypeId?: number): RetireResult {
  activeShip(profile).level = LEVEL_CAP;
  const r = retireActiveShip(profile, preset, nextTypeId);
  if (r === null) throw new Error('retireAtCap: 만렙인데도 퇴역이 거부됐다(게이트 계약 변경?)');
  return r;
}
