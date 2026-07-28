/**
 * 방어체 게이트웨이 **전역 대체**(`setDefenseUnitsGatewayOverride`) 테스트.
 *
 * 왜 이 seam 이 필요한가: 기존 주입점 `setDefenseUnitsGatewayFactory` 는 `readSupabaseConfig()`
 * 가 설정을 돌려줄 때만 팩토리를 부른다. 즉 **로그인·설정이 없는 개발 환경에서는 모의
 * 게이트웨이를 끼울 방법이 아예 없어서**, 방어 사령부의 강화 흐름을 하네스로 한 번도 밟아볼
 * 수 없었다. 이 파일은 대체가 ① 설정 유무보다 먼저 이기고 ② null 로 즉시 원복되며
 * ③ 명시 `deps.gateway` 는 여전히 최우선인지를 못박는다(우선순위가 뒤집히면 테스트가 서로의
 * 게이트웨이를 훔쳐 쓴다).
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  listDefenseUnits,
  resetDefenseUnitsGateway,
  setDefenseUnitsGatewayFactory,
  setDefenseUnitsGatewayOverride,
} from '../src/net/defenseUnits.js';
import type { DefenseUnitsGateway, DefenseUnitOwned } from '../src/net/defenseUnits.js';

/** 자기 이름표를 단 유닛 1건만 돌려주는 최소 게이트웨이. */
function labelledGateway(label: string): DefenseUnitsGateway {
  const row = { id: label, kind: 0, catalogId: 0, unit: { id: label } } as unknown as DefenseUnitOwned;
  const notUsed = (): never => {
    throw new Error('이 테스트가 부르지 않는 경로');
  };
  return {
    getUserId: async () => label,
    listUnits: async () => [row],
    listBlueprints: async () => [],
    levelUp: notUsed,
    ascend: notUsed,
    rerollAffixes: notUsed,
    promoteRarity: notUsed,
    craftFromBlueprint: notUsed,
  };
}

afterEach(() => {
  // 대체·팩토리·캐시를 모두 초기화한다(모듈 전역 상태라 파일 간 누수가 생긴다).
  resetDefenseUnitsGateway();
});

describe('setDefenseUnitsGatewayOverride', () => {
  it('설정이 없어도(오프라인) 대체 게이트웨이가 쓰인다 — 이 seam 의 존재 이유', async () => {
    // 팩토리는 등록하지 않는다. 종전 경로라면 config 부재로 null 이 나온다.
    expect(await listDefenseUnits()).toBeNull();

    setDefenseUnitsGatewayOverride(labelledGateway('mock'));

    const units = await listDefenseUnits();
    expect(units?.length).toBe(1);
    expect(units?.[0]?.id).toBe('mock');
  });

  it('null 을 넣으면 즉시 원래 경로(오프라인 = null)로 돌아온다', async () => {
    setDefenseUnitsGatewayOverride(labelledGateway('mock'));
    expect((await listDefenseUnits())?.length).toBe(1);

    setDefenseUnitsGatewayOverride(null);

    expect(await listDefenseUnits()).toBeNull();
  });

  it('명시 deps.gateway 가 대체보다 우선이다(테스트 격리 보존)', async () => {
    setDefenseUnitsGatewayOverride(labelledGateway('mock'));

    const units = await listDefenseUnits({ gateway: labelledGateway('explicit') });

    expect(units?.[0]?.id).toBe('explicit');
  });

  it('대체는 설정+팩토리 경로보다 우선이다', async () => {
    setDefenseUnitsGatewayFactory(() => labelledGateway('factory'));
    setDefenseUnitsGatewayOverride(labelledGateway('mock'));

    const units = await listDefenseUnits({ config: { url: 'https://x.example', anonKey: 'k' } });

    expect(units?.[0]?.id).toBe('mock');
  });

  it('resetDefenseUnitsGateway 는 대체까지 지운다(테스트 간 누수 차단)', async () => {
    setDefenseUnitsGatewayOverride(labelledGateway('mock'));
    resetDefenseUnitsGateway();
    expect(await listDefenseUnits()).toBeNull();
  });
});
