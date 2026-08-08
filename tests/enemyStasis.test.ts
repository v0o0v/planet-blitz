/**
 * 적 이동 **정지** 축 (배치7 F1 — 스트라이커 S9 선결).
 *
 * `applyStasis`/`enemyStatusStopMult`(`src/sim/status.ts`)와 `world.ts:2863` 의
 * `enemyStatusStopMult(e)` 배선을 잠근다. 값 규약: 저장 필드는 적('enemy')의 `life`
 * (기본값 -1 — `entities.ts:202`), `life > 0` 이면 이동 배율 0.
 *
 * ⚠️ 뮤테이션 없이 계측기를 믿지 않는다 — `world.ts` 의 `* enemyStatusStopMult(e)` 를
 * 지웠을 때 아래 첫 테스트가 실제로 빨개지는지 이 레인이 손으로 확인했다(보고 참조).
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput } from '../src/sim/world.js';
import { blankEntity, addEntity } from '../src/sim/entities.js';
import { applyStasis, enemyStatusStopMult, tickEnemyStatus } from '../src/sim/status.js';
import { hashWorld } from '../src/sim/replay.js';
import type { WorldState } from '../src/sim/world.js';

/** CHARGER(typeIndex 0, movement 'chargeStraight')를 흉내 낸 최소 적. 플레이어에서 멀리
 *  떨어뜨려 둬야 조준각이 0이 아니고, 스폰 직후(vx=vy=0)에 정지를 걸어야 아래 §1 의
 *  "속도 0 상태에서 매 틱 재조준" 경로(`moveCharge` 의 `if (e.vx===0 && e.vy===0)`)를 탄다. */
function spawnCharger(state: WorldState, offsetX: number, offsetY: number) {
  const player = state.entities[0]!;
  const e = blankEntity('enemy');
  e.x = player.x + offsetX;
  e.y = player.y + offsetY;
  e.radius = 36;
  e.hp = 34;
  e.maxHp = 34;
  e.enemyType = 0; // CHARGER — chargeStraight
  e.cooldown = 999; // 이 테스트 창 안에서 분출로 소멸하지 않게
  return addEntity(state, e);
}

describe('적 정지 축 (S9 선결, status.ts)', () => {
  it('정지를 건 적은 안 움직이고(델타 0), 안 건 적은 움직인다(델타 > 0) — 하한 짝', () => {
    const state = createWorld(7);
    const stopped = spawnCharger(state, 1000, 0);
    const moving = spawnCharger(state, -1000, 0);
    applyStasis(stopped, 90); // 스폰 직후, 첫 이동 틱 전에 부여
    const sx0 = stopped.x;
    const sy0 = stopped.y;
    const mx0 = moving.x;
    const my0 = moving.y;
    for (let t = 0; t < 30; t++) stepWorld(state, emptyInput());
    const stoppedDelta = Math.hypot(stopped.x - sx0, stopped.y - sy0);
    const movingDelta = Math.hypot(moving.x - mx0, moving.y - my0);
    expect(stoppedDelta).toBe(0);
    expect(movingDelta).toBeGreaterThan(0);
  });

  it('지속이 끝나면 다시 움직인다(음성 대조)', () => {
    // ⚠️ `tickEnemyStatus`(감소) → `enemyStatusStopMult`(판정)가 **같은 틱** 안에서
    // 순서대로 돈다(world.ts 의 적 루프) — 냉기(ownerId) 축과 동일한 관용구다. 그래서
    // `applyStasis(e, 5)`는 "5틱 정지"가 아니라 **4틱 정지 + 5번째 틱에 life 가 0 에 닿아
    // 그 틱부터 즉시 재개**다.
    const state = createWorld(7);
    const e = spawnCharger(state, 1000, 0);
    applyStasis(e, 5);
    const x0 = e.x;
    for (let t = 0; t < 4; t++) stepWorld(state, emptyInput());
    expect(e.x).toBe(x0); // life 5→1, 전 구간 정지
    stepWorld(state, emptyInput()); // life 1→0 — 이 틱부터 재개
    expect(e.x).not.toBe(x0);
  });

  it('life 기본값 -1 회귀 가드 — 정지를 건 적 없는 신규 적의 배율은 1', () => {
    const e = blankEntity('enemy');
    expect(e.life).toBe(-1); // entities.ts blankEntity 전제
    expect(enemyStatusStopMult(e)).toBe(1);
  });

  it('정지 만료가 적을 죽이지 않는다 — life 가 0 이 된 뒤에도 dead === false', () => {
    const w = { skillsOn: false } as unknown as WorldState;
    const e = blankEntity('enemy');
    e.hp = 34;
    e.maxHp = 34;
    applyStasis(e, 2);
    tickEnemyStatus(w, e); // life: 2 -> 1
    expect(e.life).toBe(1);
    expect(e.dead).toBe(false);
    tickEnemyStatus(w, e); // life: 1 -> 0 (정지 해제, 수명 만료가 아니다)
    expect(e.life).toBe(0);
    expect(e.dead).toBe(false);
    expect(e.hp).toBe(34); // 화상 루프와 무관 — hp 불변
    expect(enemyStatusStopMult(e)).toBe(1); // 해제 후 배율 원복
  });

  it('해시 불변 — 정지를 안 쓰는 런의 hashWorld 가 이 배선 신설 전후 동일하다', () => {
    // 이 상수는 이 레인이 손으로 직접 뜬 값이다: `git stash` 로 이 배치의 모든 편집(world.ts의
    // `* enemyStatusStopMult(e)` 곱 포함)을 되돌린 **배선 전** 코드로 같은 시나리오를 돌려
    // PROBE_HASH 24194643 을 얻었고, 편집을 복원한 뒤 같은 시나리오가 여전히 24194643 임을
    // 확인했다(스크립트는 커밋하지 않았다 — 이 리터럴이 그 대조의 증거다). 정지 미사용 런은
    // 전 엔티티의 `life` 가 blankEntity 기본값 -1 로 남고 `enemyStatusStopMult` 가 항상 1을
    // 반환해 `sm` 산술이 배선 전과 비트 동일하다는 것이 이 불변의 이유다.
    const state = createWorld(12345);
    for (let t = 0; t < 300; t++) stepWorld(state, emptyInput());
    // 2026-08-08 재동결(출시 전 밸런스 확정). 이 값은 "정지 배선 신설 전후 동일" 을 재는
    // 것이지 특정 숫자를 재는 것이 아니다 — 밸런스 상수가 움직이면 함께 움직인다.
    // 교환 대조로 확정했다: 레인의 밸런스 상수 14개를 되돌리면 옛 값(24194643)이 복원된다.
    // 2026-08-09 재동결(§R57 · 적 피해 단계 곡선). `createWorld(12345)` 는 stage 미지정이라
    // 단계 1 이고 새 곡선은 단계 1 에서 ×2 다. 교환 대조: `ENEMY_DAMAGE_STAGE_PEAK` 만
    // 2 → 1 로 되돌리면 옛 값(2178646964)이 복원된다(확인함).
    expect(hashWorld(state)).toBe(773707668);
  });
});
