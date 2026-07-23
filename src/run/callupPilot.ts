/**
 * 예비역 소집(ADR-0024) pilot 조립 — 순수 함수(렌더/DOM 무의존).
 *
 * `src/main.ts` 의 소집 런치와 통합 테스트가 **동일한 이 함수**를 import 한다 — 예전엔 main.ts
 * 안에 있어 테스트가 로직을 복제할 수밖에 없었고(main.ts 는 pixi/DOM 의존이라 import 불가),
 * 그 복제본이 조용히 어긋날 위험이 있었다(코드리뷰 LOW-1). 여기로 뽑아 드리프트 면을 없애고
 * `retired` 가드(리뷰 MED-1)를 단위 테스트 가능하게 한다.
 *
 * `pilotGuardianId` 가 **유효한 소집 대상**(존재 + 미소멸 + build 有)을 가리키면 그 잠긴 실물
 * 빌드를 `buildRunConfig` pilot 스냅샷으로 변환하고, 아니면 null(활성 기체 출격 — 기존 거동 불변).
 * `equipped` 는 `EQUIP_SLOTS` 순서로 모은다(runConfig 의 `equippedItems` 와 동일한 순서 계약).
 *
 * ⚠️ 소멸(retired)한 수호기는 **거부한다** — 소멸 시 잠긴 장비가 이미 stash 로 반환됐으므로,
 * 소멸 수호기로 출격하면 같은 장비가 stash(재장착 가능)와 소집 빌드에 **동시 존재**해 ADR 이
 * 기각한 "장비 효과 복사" 가 된다. 현재 호출부(런치 피커)는 `activeGuardians` 로 이미 소멸분을
 * 거르지만, 이 함수 자체가 불변식을 지켜 이중 방어한다.
 *
 * ⚠️ `profile.activeShipIndex` 를 **건드리지 않는다** — 소집은 데이터 주입만 한다(활성 인덱스를
 * 바꾸면 정산 XP 가 엉뚱한 기체로 귀속된다).
 */

import type { Profile } from '../save/profile.js';
import type { RunConfigOpts } from './runConfig.js';
import { EQUIP_SLOTS } from '../items/types.js';
import type { Item } from '../items/types.js';

export function buildCallupPilot(
  profile: Profile,
  pilotGuardianId: string | null | undefined,
): NonNullable<RunConfigOpts['pilot']> | null {
  if (typeof pilotGuardianId !== 'string' || pilotGuardianId.length === 0) return null;
  const guardian = profile.guardians.find((g) => g.id === pilotGuardianId);
  const build = guardian?.build;
  if (guardian === undefined || guardian.retired || build === undefined) return null;
  const equipped: Item[] = [];
  for (const slot of EQUIP_SLOTS) {
    const it = build.equipped[slot];
    if (it !== undefined) equipped.push(it);
  }
  return {
    equipped,
    skillInvest: build.skillInvest,
    typeId: build.typeId,
    performanceCP: guardian.performanceCP,
  };
}
