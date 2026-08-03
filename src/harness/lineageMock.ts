/**
 * 계보·수호 서버 **모의 게이트웨이**(DEV 하네스 전용 — `defenseMock.ts` 와 같은 규율).
 *
 * ## 왜 필요한가 — 오프라인 잠금이 하네스도 막는다
 * 계보 조작은 서버가 확정한다(ADR-0007 배선, 2026-08-03). 되돌릴 수 없는 지출이라 오프라인
 * 폴백이 없고, 그래서 **Supabase 설정이 없는 개발 환경에서는 퇴역·소멸·투자를 한 번도 밟아볼 수
 * 없다.** 방어 사령부가 정확히 같은 이유로 모의 게이트웨이를 만들었다.
 *
 * ## 무엇을 흉내내는가
 * 서버 RPC 의 **계약**만 흉내낸다(비용 차감·포인트 회수·행 생성/삭제). 인증·RLS·쿨다운은 없다.
 * 상태는 이 객체 안 메모리에 산다 — 로컬 Profile 을 읽지 않는다. 서버가 정본인 세계를
 * 재현해야 "로컬이 서버를 앞질러 갔을 때 무슨 일이 나는가"를 하네스에서 볼 수 있기 때문이다.
 *
 * 프로덕션 번들에는 하네스 코드가 없다(DEV 전용 — ADR-0008).
 */

import {
  branchBonusBp,
  nextLevelCost,
  RETIRE_LINEAGE_GRANT,
  type LineageBranch,
} from '../../data/lineage.js';
import { dismissPoints } from '../../data/guardian.js';
import type { GuardianSnapshot } from '../../data/guardian.js';
import type { GuardianBuild } from '../save/profile.js';
import type { LineageGateway, ServerGuardian, ServerLineage } from '../net/lineage.js';

/** 모의 서버 상태. 실 서버의 `profiles.lineage_*` + `guardians` 두 곳에 대응한다. */
interface MockState {
  available: number;
  shipLevel: number;
  guardianLevel: number;
  guardians: ServerGuardian[];
  nextId: number;
}

export class HarnessLineageGateway implements LineageGateway {
  private readonly state: MockState = {
    available: 0,
    shipLevel: 0,
    guardianLevel: 0,
    guardians: [],
    nextId: 1,
  };

  /** 치트 패널이 잔고를 밀어 넣는 자리(서버가 지급한 것처럼). 음수는 무시. */
  grantPoints(amount: number): number {
    if (Number.isFinite(amount) && amount > 0) this.state.available += Math.trunc(amount);
    return this.state.available;
  }

  /** 하네스 표시용 스냅샷(치트 패널이 현재 모의 서버 상태를 찍는다). */
  peek(): { available: number; shipLevel: number; guardianLevel: number; guardians: number } {
    return {
      available: this.state.available,
      shipLevel: this.state.shipLevel,
      guardianLevel: this.state.guardianLevel,
      guardians: this.state.guardians.filter((g) => !g.retired).length,
    };
  }

  /**
   * 로컬 Profile 의 수호기를 모의 서버로 **1회 이관**한다(하네스 편의). 실 서버에는 이런 경로가
   * 없다 — 프로덕션에서 로컬 수호기는 서버 정본 pull 에 의해 대체된다(사용자 결정 2026-08-03).
   * 하네스에서까지 그 규칙을 강제하면 기존 세이브로는 소멸 화면을 못 밟는다.
   */
  seedGuardians(rows: readonly { snapshot: GuardianSnapshot; performanceCP: number; combatScore: number; preset: number; build?: GuardianBuild }[]): void {
    for (const r of rows) {
      this.state.guardians.push({
        id: `mock-${this.state.nextId++}`,
        snapshot: r.snapshot,
        performanceCP: r.performanceCP,
        combatScore: r.combatScore,
        preset: r.preset,
        retired: false,
        ...(r.build !== undefined ? { build: r.build } : {}),
      });
    }
  }

  async getUserId(): Promise<string> {
    return 'harness-user';
  }

  async fetchGuardians(): Promise<ServerGuardian[]> {
    // 소멸된 행은 내려보내지 않는다(실 서버의 `retired=false` 필터와 같은 결과).
    return this.state.guardians.filter((g) => !g.retired).map((g) => ({ ...g }));
  }

  async fetchLineage(): Promise<ServerLineage> {
    return {
      available: this.state.available,
      shipLevel: this.state.shipLevel,
      guardianLevel: this.state.guardianLevel,
    };
  }

  async retireShip(
    preset: number,
    combatScore: number,
    snapshot: GuardianSnapshot,
    build?: GuardianBuild,
  ): Promise<{ guardianId: string; granted: number }> {
    const guardianId = `mock-${this.state.nextId++}`;
    this.state.guardians.push({
      id: guardianId,
      snapshot,
      performanceCP: 10000,
      combatScore,
      preset,
      retired: false,
      ...(build !== undefined ? { build } : {}),
    });
    this.state.available += RETIRE_LINEAGE_GRANT;
    return { guardianId, granted: RETIRE_LINEAGE_GRANT };
  }

  async dismissGuardian(guardianId: string): Promise<number> {
    const g = this.state.guardians.find((x) => x.id === guardianId);
    // 실 서버는 없는 id·이미 소멸을 거부한다(RPC 가 dismissed=false → 게이트웨이가 throw).
    if (g === undefined || g.retired) throw new Error('dismiss_guardian 거부: not-found');
    g.retired = true;
    const points = dismissPoints(g.combatScore, g.performanceCP);
    this.state.available += points;
    return points;
  }

  async investLineage(branch: LineageBranch): Promise<{ level: number; points: number }> {
    const level = branch === 'ship' ? this.state.shipLevel : this.state.guardianLevel;
    const cost = nextLevelCost(level);
    // 실 서버와 같은 거부 조건 — 잔고가 모자라면 아무것도 바뀌지 않는다.
    if (this.state.available < cost) throw new Error('invest_lineage 거부: insufficient-points');
    this.state.available -= cost;
    const next = level + 1;
    if (branch === 'ship') this.state.shipLevel = next;
    else this.state.guardianLevel = next;
    return { level: next, points: this.state.available };
  }

  /** 하네스 표시용 — 현재 모의 서버 기준 가지 보너스(bp). */
  bonusBp(branch: LineageBranch): number {
    return branchBonusBp(branch === 'ship' ? this.state.shipLevel : this.state.guardianLevel);
  }
}
