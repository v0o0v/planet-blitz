/**
 * 원한 표적 게이트(`src/sim/grudgeGate.ts`) — **무투자 해시 불변 증명**(배치7 F2a, 팬텀
 * AS7「원한 청산」선결).
 *
 * ## 왜 이 파일이 따로 있는가
 * `hashEntity`(replay.ts)가 적탄의 `ownerId` 를 **무조건** 접는다 — `aux0`/`aux1` 처럼
 * "둘 다 0 이면 스킵"하는 조건부 폴드가 아니다. 그래서 발사자 id 스탬프는 이 배치가 만든
 * 축 중 해시 회귀 위험이 가장 크다: 게이트가 조금이라도 새면 무투자 런은 물론 **다른
 * 기체가 자기 트리의 같은 flat 인덱스(6)에 투자한 런**까지 조용히 갈린다.
 *
 * 시뮬레이션 전체를 돌려 골든을 비교하는 대신, 게이트 술어와 `spawnEnemyBullet` 을
 * **단위로** 검증한다 — 이 값이 실제로 해시에 접히는 유일한 필드(`ownerId`)이므로, 이
 * 필드가 게이트-닫힘 상태에서 항상 `blankEntity` 의 기존 기본값(0) 그대로임을 직접 재는
 * 것이 "해시가 한 비트도 안 바뀐다"의 가장 직접적인 증거다.
 */
import { describe, it, expect } from 'vitest';
import { spawnEnemyBullet, type Entity } from '../src/sim/entities.js';
import { grudgeTargetActive, type GrudgeGateState } from '../src/sim/grudgeGate.js';
import { SIG_PHANTOM_CLOAK, SIG_STRIKER_MARKSMAN } from '../src/sim/shipSignature.js';

type Sink = { entities: Entity[]; nextEntityId: number } & GrudgeGateState;

function sink(overrides: Partial<GrudgeGateState> = {}): Sink {
  return {
    entities: [] as Entity[],
    nextEntityId: 1,
    skillsOn: false,
    sigBit: 0,
    config: {},
    skillDerived: { shipType: 0 },
    ...overrides,
  };
}

describe('grudgeTargetActive — 게이트 안전성(단위)', () => {
  it('skillsOn=false 면 항상 false — 같은 투자·기체 조합이라도', () => {
    const open = { sigBit: SIG_PHANTOM_CLOAK, config: { skillInvest: [0, 0, 0, 0, 0, 0, 3] }, skillDerived: { shipType: 3 } };
    expect(grudgeTargetActive(sink({ skillsOn: true, ...open }))).toBe(true); // 대조: 켜지는 조합이 실제로 있다는 것부터 확인
    expect(grudgeTargetActive(sink({ skillsOn: false, ...open }))).toBe(false);
  });

  it('⭐ 비-팬텀 기체가 자기 트리의 flat 6번에 투자해도 false다 — 이 레인의 핵심 안전 요구', () => {
    // 스트라이커 자신의 트리에서 flat index 6 이 무엇이든, AS7 과 무관해야 한다.
    const s = sink({
      skillsOn: true,
      sigBit: SIG_STRIKER_MARKSMAN,
      config: { skillInvest: [0, 0, 0, 0, 0, 0, 5] },
      skillDerived: { shipType: 1 }, // 스트라이커(팬텀=3 이 아닌 임의 값)
    });
    expect(grudgeTargetActive(s)).toBe(false);
  });

  it('팬텀이어도 AS7(flat 6) 미투자면 false', () => {
    const s = sink({
      skillsOn: true,
      sigBit: SIG_PHANTOM_CLOAK,
      config: { skillInvest: [1, 0, 0, 0, 0, 0, 0] }, // index 0 만 투자
      skillDerived: { shipType: 3 },
    });
    expect(grudgeTargetActive(s)).toBe(false);
  });

  it('팬텀 + AS7(flat 6) ≥1 이면 true', () => {
    const s = sink({
      skillsOn: true,
      sigBit: SIG_PHANTOM_CLOAK,
      config: { skillInvest: [0, 0, 0, 0, 0, 0, 3] },
      skillDerived: { shipType: 3 },
    });
    expect(grudgeTargetActive(s)).toBe(true);
  });
});

describe('spawnEnemyBullet — 게이트-닫힘 런의 ownerId 는 종전 기본값(0) 그대로다', () => {
  it('ownerId 인자를 넘겨도 게이트가 닫혀 있으면 0 이다(해시가 접는 유일한 필드가 불변)', () => {
    const s = sink({ skillsOn: false });
    const b = spawnEnemyBullet(s, 10, 20, 1, 1, 0, 5, 8, 60, 999);
    expect(b.ownerId).toBe(0);
  });

  it('비-팬텀 기체가 flat 6 에 투자한 런도 ownerId 는 0 이다(위 단위 테스트의 통합판)', () => {
    const s = sink({
      skillsOn: true,
      sigBit: SIG_STRIKER_MARKSMAN,
      config: { skillInvest: [0, 0, 0, 0, 0, 0, 5] },
      skillDerived: { shipType: 1 },
    });
    const b = spawnEnemyBullet(s, 10, 20, 1, 1, 0, 5, 8, 60, 999);
    expect(b.ownerId).toBe(0);
  });

  it('ownerId 인자를 아예 생략한 기존 호출부(침공 3파일 등)와 동일한 경로 — 게이트 평가 자체가 단락된다', () => {
    const s = sink({
      skillsOn: true,
      sigBit: SIG_PHANTOM_CLOAK,
      config: { skillInvest: [0, 0, 0, 0, 0, 0, 5] },
      skillDerived: { shipType: 3 },
    });
    const b = spawnEnemyBullet(s, 10, 20, 1, 1, 0, 5, 8, 60);
    expect(b.ownerId).toBe(0);
  });

  it('대조군 — 게이트가 실제로 열리면(팬텀+AS7 투자) 스탬프된다', () => {
    const s = sink({
      skillsOn: true,
      sigBit: SIG_PHANTOM_CLOAK,
      config: { skillInvest: [0, 0, 0, 0, 0, 0, 5] },
      skillDerived: { shipType: 3 },
    });
    const b = spawnEnemyBullet(s, 10, 20, 1, 1, 0, 5, 8, 60, 777);
    expect(b.ownerId).toBe(777);
  });

  it('스탬프 외 다른 모든 필드는 ownerId 인자 유무와 무관하게 항상 같다(부작용 0)', () => {
    const off = sink({ skillsOn: false });
    const a = spawnEnemyBullet(off, 10, 20, 3, 4, 1.2, 5, 8, 60);
    const b = spawnEnemyBullet(off, 10, 20, 3, 4, 1.2, 5, 8, 60, 42);
    expect({ ...a, id: 0, ownerId: 0 }).toEqual({ ...b, id: 0, ownerId: 0 });
  });
});
