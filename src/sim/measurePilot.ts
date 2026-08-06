/**
 * **측정 전용 파일럿 프로파일** (ADR-0049 §0-A 결정 B · 사용자 승인 2026-08-06).
 *
 * ## 왜 두 번째 파일럿인가
 * `autopilotInput` 은 전 분기가 `dash: false` · `special: SPECIAL_NONE` 이다. 즉 **오토파일럿은
 * 액티브도 대시도 누르지 않는다**(인벤토리 11.4). 그 결과 210스킬 중 대시·액티브·플레이어
 * 입력에 얽힌 것들은 벤치·밸런스 하네스·회귀 런에서 **한 번도 발동되지 않는다** — 자동으로
 * 잴 수단이 아예 없다.
 *
 * 오토파일럿에 발동 정책을 넣는 안(A)은 벤치·회귀 골든 전량 재생성을 부른다. 그래서 결정 B:
 * **기존 오토파일럿은 동결하고 측정용 프로파일을 따로 둔다.**
 *
 * ## 계약 넷 (어기면 이 파일의 존재 이유가 사라진다)
 *
 * 1. **조향은 복제하지 않는다.** 이동·조준은 `autopilot.ts` 의 {@link pilotSteer} 정본을
 *    그대로 쓰고, 이 파일이 더하는 것은 **발동 정책**과 **벽 접근 정책** 둘뿐이다. 복제하면
 *    두 규칙이 조용히 어긋난다(`resolveDirFallback` 단일 정본과 같은 규율).
 * 2. **프로파일은 `WorldConfig` 에 들어가지 않는다.** 파일럿은 호출부가 고르는 **순수 입력
 *    생성기**이고 오토파일럿과 같은 지위다. 그래서 같은 시드 + 같은 입력 로그면 두 프로파일이
 *    **같은 해시**를 낸다 = 검증 경로(리플레이·EF 재실행)가 불변이다. sim 코어에 프로파일
 *    플래그를 심지 마라.
 * 3. **결정론.** `Math.random` · `Date` 를 쓰지 않는다(`src/sim/**` 는 ESLint 가 error 로 막는다).
 *    발동은 "쿨다운이 0 이면 누른다"는 순수 규칙뿐이다.
 * 4. **측정 런은 오염 런과 같은 취급이다.** 호출부가 {@link beginMeasureRun} 으로 표시해
 *    정산·제출에서 제외한다 — 아래 「누가 표시하는가」 참조.
 *
 * ## 벽 접근 정책은 선택이 아니다
 * 벽 접촉 플래그(`WorldState.wallContactTicks`, 엔진 선결 E5)를 무는 스킬이 **다섯**이다 —
 * 스트라이커 M5·S4 · 브루저 MO8 · 버블 FI7 · 말로우 ME9. 오토파일럿은 교전 포지셔닝만 하므로
 * 벽에 거의 닿지 않는다: P3 재측정 실측 접촉률 **10.1%**, ME9 게이트(60틱 연속) 도달률
 * **37.8%** 이고 카르곤·니플헤임에서는 3~18% 다. 벽 접근을 빼면 그 다섯은 자동 측정 밖에 남는다.
 *
 * 여기 정책은 그 재측정이 쓴 `wallHugInput` 과 같다 — **벽이 있으면 가장 가까운 벽 표면으로
 * 매 틱 민다**. 실측 접촉률 **72.4%** · 게이트 도달률 **98.9%**
 * (`.omc/research/mallow-wall-streak-p3-rerun-2026-08-06.md` §②).
 *
 * ⚠️ **대가를 명시한다**: 벽에 붙으면 회피·카이팅을 포기하므로 생존이 짧아지는 무대가 있다
 * (같은 문서 §③: 카르곤 평균 1850틱 vs 오토파일럿 3639틱, 크라스 승률 33% vs 80% — 반대로
 * 니플헤임은 더 오래 산다). 이 프로파일은 **"평균 플레이"의 모형이 아니다.** 재는 대상은
 * "이 메커닉이 열리는가"이지 "봇이 이기는가"가 아니다(ADR-0051 의 판정 규칙과 같은 축).
 *
 * ## ⚠️ 접촉 판정을 여기서 다시 적지 않는다
 * 이 파일은 벽 **표면 최근접점** 방향만 계산한다. "접촉했는가"의 권위는 `stepPlayer` 의 갱신
 * 지점 하나뿐이고(E5), 그 판정을 밖에서 재구성하면 경계 스냅 함정을 그대로 밟는다 — P3
 * 재측정이 실제로 밟았고, `slideCircleWalls` 를 sim 밖에서 bare 재호출하면 **벽에 붙어 있는데
 * `hit=false`** 가 나온다(§①). 여기서는 아예 재지 않고 `state.wallContactTicks` 를 읽는다.
 */

import type { InputFrame, WorldState } from './world.js';
import { SPECIAL_NONE, markTainted } from './world.js';
import type { Entity } from './entities.js';
import { length } from './math.js';
import { wallHalfW, wallHalfH } from './los.js';
import { SPECIAL_ACTIVE_SLOT1, SPECIAL_ACTIVE_SLOT2 } from '../../data/inputBits.js';
import { pilotSteer, pilotFreezeFrame } from './autopilot.js';

/**
 * 이 런을 **측정 런으로 표시한다** — 정산·리플레이 제출에서 빠진다(ADR-0008 오염 런과 같은 취급).
 *
 * ## 누가 부르는가 — 호출부다
 * 측정 파일럿은 순수 입력 생성기라 월드를 건드리지 않는다(계약 2). 그래서 표시는 **런을 만드는
 * 쪽**의 책임이다: 밸런스 하네스(`src/bench/**`)·프로브 스크립트가 `createWorld` 직후,
 * 첫 `stepWorld` 전에 이 함수를 부른다.
 *
 * 왜 파일럿이 스스로 세우지 않는가: 세우면 "입력 생성기가 월드를 변형한다"가 되어 오토파일럿과
 * 지위가 갈리고, 리플레이 재생 중에 파일럿을 호출하는 경로가 생기면 재생만으로 런이 오염된다.
 *
 * ⚠️ **측정 프레임이 실제 플레이 경로로 새면 부정행위 검증이 무의미해진다.** 이 함수를 안 부른
 * 채 측정 파일럿으로 돌린 런은 서버에 제출 가능한 상태로 남는다 —
 * `tests/measurePilot.test.ts` 「측정 런은 오염 런이다」 절이 그 계약을 잠근다.
 */
export function beginMeasureRun(world: WorldState): void {
  markTainted(world);
}

/**
 * 이번 틱의 **측정용 입력 프레임**. `world` 상태만의 순수 함수 — 부작용 없음.
 *
 * 조향은 {@link pilotSteer} 정본(벽이 없을 때) 또는 벽 표면 추종(벽이 있을 때)이고,
 * 발동은 아래 두 규칙뿐이다:
 *   - **대시**: `player.dashCooldown === 0` 이면 누른다.
 *   - **액티브 슬롯 1·2**: `state.activeCd0`/`activeCd1` 이 0 이면 누른다.
 *
 * ## 왜 "0 이면"인가 (한 틱 늦어도 상관없다)
 * `stepPlayer`·`stepActives` 는 **감소를 먼저** 하고 발동을 판정한다. 즉 입력 생성 시점에
 * 1 이었던 쿨다운은 그 틱에 0 이 되어 발동 가능하다 — `=== 0` 규칙은 그 틱을 놓치고 다음 틱에
 * 누른다. 발동 간격이 최대 1틱 늘 뿐이고 규칙이 **읽는 값에서 자명**해진다. 반대로 매 틱
 * 무조건 누르면 프레임의 `special` 비트가 발동과 무관해져, 리플레이만 봐서는 언제 실제로
 * 터졌는지 알 수 없다(쿨다운 중 재입력은 무시된다 — AC-2).
 *
 * ## 프리즈 규율
 * 레벨업 프리즈 틱에는 {@link pilotFreezeFrame} 을 그대로 낸다 — **발동 비트를 싣지 않는다**.
 * sim 쪽에서도 프리즈 분기가 발동 호출보다 위에서 조기 return 하므로 실어 봐야 버려지지만
 * (AC-8·AC-9), 컨트롤러 규율(`data/inputBits.ts` 「프리즈 규율」)과 같은 모양을 유지한다.
 *
 * ## 비트 충돌 없음
 * 파워업 픽은 비트 0..2, 조우는 3..8, 액티브 슬롯은 **9·10** 이다(`data/inputBits.ts` 의
 * append-only 배치). 프리즈 프레임과 발동 프레임은 애초에 상호 배타이고, 비트도 겹치지 않는다
 * — `tests/measurePilot.test.ts` 가 그 둘을 별도로 단언한다.
 */
export function measurePilotInput(world: WorldState): InputFrame {
  const steer = pilotSteer(world);
  if (steer.freeze) return pilotFreezeFrame();

  const player = world.entities[0];
  if (player === undefined) {
    // 플레이어가 없으면 누를 대상도 없다. 조향은 정본이 이미 0 을 냈다.
    return { moveX: steer.moveX, moveY: steer.moveY, aim: steer.aim, dash: false, special: SPECIAL_NONE };
  }

  // 벽이 있으면 조향을 벽 표면 추종으로 **대체**한다(부분 혼합이 아니다 — 위 「벽 접근 정책」).
  const toWall = wallApproach(world, player);
  return {
    moveX: toWall !== undefined ? toWall.x : steer.moveX,
    moveY: toWall !== undefined ? toWall.y : steer.moveY,
    // 조준은 언제나 정본을 따른다 — 벽에 붙는 것과 무엇을 쏘는가는 별개 축이다.
    aim: steer.aim,
    dash: player.dashCooldown === 0,
    special: activationBits(world),
  };
}

/** 이번 틱에 누를 액티브 슬롯 비트. 쿨다운이 도는 슬롯은 누르지 않는다. */
function activationBits(world: WorldState): number {
  let bits = SPECIAL_NONE;
  if (world.activeCd0 === 0) bits |= SPECIAL_ACTIVE_SLOT1;
  if (world.activeCd1 === 0) bits |= SPECIAL_ACTIVE_SLOT2;
  return bits;
}

/**
 * 가장 가까운 벽의 **표면 최근접점** 방향(단위 벡터). 활성 벽이 없으면 undefined —
 * 그 무대에서는 조향 정본이 한 글자도 안 바뀐다.
 *
 * 최근접점은 `circleOverlapsWall`(`los.ts`)과 **같은 AABB 클램프**다. 벽 반폭·반높이는
 * `wallHalfW`/`wallHalfH` 단일 정본으로 읽는다(`radius`/`targetX` 를 여기서 다시 해석하지 않는다).
 *
 * 동률은 id 오름차순으로 깬다 — `autopilot.ts` 의 `nearestTarget` 과 같은 규약이라 플랫폼
 * 순회 순서에 의존하지 않는다.
 *
 * 벽에 붙어 정지한 상태에서도 방향이 죽지 않는다: 슬라이드가 좌표를 확장 경계값
 * (`w.x ± (hw + r)`)에 스냅하므로 표면 최근접점까지의 거리가 정확히 `r` 로 남아 매 틱 같은
 * 방향을 계속 누른다. 그것이 "붙어 서 있기"가 유지되는 이유다.
 */
function wallApproach(world: WorldState, player: Entity): { x: number; y: number } | undefined {
  const walls = world.activeWalls;
  if (walls.length === 0) return undefined;
  let best: Entity | undefined;
  let bestD = Infinity;
  let bestX = 0;
  let bestY = 0;
  for (const w of walls) {
    const hw = wallHalfW(w);
    const hh = wallHalfH(w);
    let nx = player.x;
    if (nx < w.x - hw) nx = w.x - hw;
    else if (nx > w.x + hw) nx = w.x + hw;
    let ny = player.y;
    if (ny < w.y - hh) ny = w.y - hh;
    else if (ny > w.y + hh) ny = w.y + hh;
    const dx = nx - player.x;
    const dy = ny - player.y;
    const d = dx * dx + dy * dy;
    if (d < bestD || (d === bestD && best !== undefined && w.id < best.id)) {
      bestD = d;
      best = w;
      bestX = dx;
      bestY = dy;
    }
  }
  if (best === undefined) return undefined;
  const d = length(bestX, bestY);
  if (d > 0.0001) return { x: bestX / d, y: bestY / d };
  // 플레이어 중심이 벽 AABB 안 = 최근접점이 자기 자신이라 방향이 없다(블링크·창 클램프가
  // 밀어 넣은 직후에만 생긴다). 벽 중심 쪽으로 밀어 겹침을 유지한다 — 방향이 사라진 채
  // 정지하면 다음 틱 슬라이드가 밖으로 뱉고 접촉이 끊긴다.
  const cx = best.x - player.x;
  const cy = best.y - player.y;
  const cd = length(cx, cy);
  if (cd > 0.0001) return { x: cx / cd, y: cy / cd };
  // 벽 중심과 정확히 겹침(퇴화). 임의의 고정 방향 — `dodgeVector` 와 같은 관용구다.
  return { x: 1, y: 0 };
}
