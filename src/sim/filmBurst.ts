/**
 * 버블 방막 **파열 후처리의 단일 정본** (E3 · ADR-0049 선결, `bubble.md` ①-3).
 *
 * ## 왜 이 leaf 모듈인가 — 산술이 두 벌이었다
 * 파열 밀어내기는 지금까지 **두 곳에 복제**돼 있었다: `world.ts` 의 `burstFilm`(시그니처 소진
 * 파열)과 `activeHandlers/bubble.ts` 의 `pushBurst`(액티브 강제 파열·불멸막 만료). 핸들러가
 * world 를 런타임 import 하면 순환이라 같은 산술을 손으로 베낀 것이다. 복제는 조용히 갈린다 —
 * 실제로 한쪽은 `length(dx,dy)`, 다른 쪽은 `Math.sqrt(dx*dx+dy*dy)` 로 이미 표기가 갈라져
 * 있었다(값은 같지만, 한쪽만 고치면 값도 갈린다).
 *
 * 그래서 `cloak.ts` 와 같은 처방을 쓴다: **`WorldState`·`Entity` 를 type-only 로만 참조하는
 * leaf 모듈**. 런타임 import 는 전부 leaf(`shipSignature`·`los`·`math`)라 순환이 구조적으로
 * 존재하지 않고, world 와 핸들러가 **같은 함수**를 부른다.
 *
 * ## 요청 슬롯 — 왜 핸들러가 직접 터뜨리지 않는가
 * 파열 훅 스킬 9종(PO1·PO3·PO7·PO8·DR1·DR6·FI5·FI7·FI10)이 전부 이 후처리 위에 얹힌다.
 * 핸들러가 각자 터뜨리면 그 9종을 두 벌(액티브 경로·시그니처 경로) 배선해야 한다. 그래서
 * 핸들러는 **요청만 세우고** world 가 `stepActives` 직후 한 지점에서 소비한다.
 *
 * 슬롯이 **2칸인 이유**: `stepActives` 는 만료 훅 루프와 발동 루프가 **별개**라 한 틱에 두
 * 요청이 설 수 있다(예: slot1 `pop_lo` 발동 + slot2 `film_hi` 만료). 정수 1칸이면 하나가
 * 조용히 유실된다.
 *
 * ## 이 커밋에서 **일부러 넣지 않은 것** (거동 불변 계약)
 *  · `aux1 = 0` 강제(`bubble.md` ①-2 계약 1) — 현행 시그니처 소진 파열은 `aux0` 만 만지고
 *    `aux1` 은 건드리지 않는다. 여기에 강제를 넣으면 **재생 타이머 거동이 바뀐다.**
 *    `pop_lo`·`film_hi` 만료는 지금도 핸들러가 각자 `aux1 = 0` 을 하므로 그대로 뒀다.
 *  · `pop_hi` 의 `aux1 = 0` 추가(①-2 계약 1 의 네 번째 경로) — 순수 신규 거동이다.
 *  · FI1 선급 · 파열 훅 9종 · DR9 잔파동(종류 코드 2) — 소비자가 아직 없다.
 * 넷 다 **스킬 배선 커밋**에서 골든 재생성·EF 재배포와 한 원자로 넣어라.
 */

import type { WorldState } from './world.js';
import { FILM_BURST_RADIUS, filmBurstPush } from './shipSignature.js';
import { slideCircleWalls } from './los.js';
import { length } from './math.js';
import { onFilmBurst } from './skillHooks.js';

/** 요청 없음. 슬롯의 정상 상태이며, 소비 직후 항상 이 값으로 되돌아간다. */
export const FILM_BURST_REQ_NONE = 0;
/**
 * 막 파열 요청(밀어내기 + 훗날의 파열 훅).
 *
 * 종류 코드 **2 는 DR9 「잔파동」 예약**이다 — 파열이 아니라 밀어내기·소거만 하는 별개 경로라
 * `aux1` 도 안 건드리고 파열 훅도 안 태운다. 지금은 그 스킬이 없어 값을 선언하지 않는다
 * (소비자 없는 상수를 미리 두면 "배선이 있다" 는 착각을 만든다 — 이 저장소의 재발 패턴).
 */
export const FILM_BURST_REQ_BURST = 1;

/**
 * 이번 틱의 파열 요청을 세운다(액티브 핸들러 전용).
 *
 * 좌표를 **요청 시점에 박아 둔다** — 소비 시점에 `player.x/y` 를 다시 읽으면, 같은 틱의 다른
 * 슬롯이 `blink`(`drift_lo`·`drift_hi`)로 플레이어를 옮겼을 때 파열 중심이 함께 끌려간다.
 * 그건 현행 거동(핸들러가 그 자리에서 즉시 터뜨림)과 다르다.
 *
 * 두 칸이 모두 차면 **버린다**. 한 틱에 세 번째 파열이 설 경로가 현재 없고(발동 2 + 만료 2 중
 * 같은 슬롯은 배타), 조용히 덮어쓰는 것보다 버리는 편이 낫다 — 덮어쓰면 어느 요청이 사라졌는지
 * 알 수 없다.
 */
export function requestFilmBurst(state: WorldState, x: number, y: number): void {
  if (state.filmBurstReq0 === FILM_BURST_REQ_NONE) {
    state.filmBurstReq0 = FILM_BURST_REQ_BURST;
    state.filmBurstReqX0 = x;
    state.filmBurstReqY0 = y;
    return;
  }
  if (state.filmBurstReq1 === FILM_BURST_REQ_NONE) {
    state.filmBurstReq1 = FILM_BURST_REQ_BURST;
    state.filmBurstReqX1 = x;
    state.filmBurstReqY1 = y;
  }
}

/**
 * 세워진 요청을 **슬롯 순서대로** 소비하고 비운다. 호출 지점은 `stepWorld` 의 `stepActives`
 * 직후 한 곳뿐이다(공통-A 틱 순서표).
 *
 * ⚠️ 소비 후 반드시 0 으로 되돌린다 — 이 여섯 정수가 `hashWorld` 시점에 항상 0 이라는 것이
 * **폴드를 안 하는 근거**다(`WorldState` 필드 주석 참조).
 */
export function consumeFilmBurstRequests(state: WorldState): void {
  if (state.filmBurstReq0 === FILM_BURST_REQ_NONE && state.filmBurstReq1 === FILM_BURST_REQ_NONE) {
    return;
  }
  if (state.filmBurstReq0 !== FILM_BURST_REQ_NONE) {
    resolveFilmBurst(state, state.filmBurstReqX0, state.filmBurstReqY0);
    state.filmBurstReq0 = FILM_BURST_REQ_NONE;
    state.filmBurstReqX0 = 0;
    state.filmBurstReqY0 = 0;
  }
  if (state.filmBurstReq1 !== FILM_BURST_REQ_NONE) {
    resolveFilmBurst(state, state.filmBurstReqX1, state.filmBurstReqY1);
    state.filmBurstReq1 = FILM_BURST_REQ_NONE;
    state.filmBurstReqX1 = 0;
    state.filmBurstReqY1 = 0;
  }
}

/**
 * 막 파열 후처리 — `(x, y)` 반경 안의 적을 **좌표 변위**로 밖으로 민다.
 *
 * ⚠️ `e.vx`/`e.vy` 에 실으면 안 된다. 적 속도는 이동 컴포넌트가 매 틱 대입으로 덮어쓰므로
 * (`patterns/index.ts` 의 moveStandoff·moveSeekWounded·stationary) 밀어내기가 다음 틱에 흔적
 * 없이 사라지고 **화면상 아무 일도 안 일어나는데 그 1틱의 해시만 갈린다.** 좌표를 직접 옮기는
 * 선례가 `applySingularityPull`(world.ts)이며 산술 형태를 그대로 복제했다 — `length` 1회 ·
 * 나눗셈 1회 · 곱셈 1회, `Math.pow`/`Math.hypot`/각도 경유 없음. (ADR-0005 의 정수 bp 규율은
 * 배율·피해 산술에 대한 것이고 위치는 f64 로 해시된다.)
 *
 * 대상은 `enemy` 로만 좁힌다 — 침공 방어체(prop·facility*)는 배치 좌표가 소켓 계약이라 밀면
 * 안 되고, 벽은 `activeWalls`·`wallIndex` 재빌드와 얽힌다.
 *
 * ## 침공에서도 그대로 작동한다 — 팬텀과 달리 게이트하지 않는 근거 (적대적 리뷰 wiring MED-2)
 * 침공 L1 편대원은 `kind === 'enemy'` 라 이 밀어내기의 대상이고, `refreshFormationAffixes`
 * (invasion/formation.ts)가 **매 틱** `resolveDefenseMods(set, trigger, e.x, e.y)` 로 좌표 기반
 * 어픽스를 다시 접는다. 그럼에도 게이트하지 않는 이유: 그 재계산은 원래 **매 틱 살아 있는 좌표**
 * 에서 이뤄지고 적은 어차피 매 틱 이동한다 — 파열은 "한 틱에 크게 움직인 이동" 일 뿐 계약을
 * 깨지 않는다. 팬텀을 침공에서 뺀 사유는 좌표가 아니라 **방어체가 공격할 수 있는지 여부**를
 * 바꾸는 것이었다(DefenseTriggerState 의 입력 자체가 사라진다). 둘은 같은 문제가 아니다.
 * (이 판단을 문서에 남기지 않으면 다음 세션이 "왜 하나만 게이트돼 있나" 를 다시 묻게 된다.)
 *
 * ⚠️ 밀어낸 직후 벽 충돌을 **즉시** 재해결한다(적대적 리뷰 MED-4). 260 유닛은 벽 두께보다
 * 크므로, 그냥 두면 침공 회랑처럼 벽이 촘촘한 무대에서 적이 벽 안쪽 깊숙이 박힌다. 다음 틱
 * 이동 단계의 `slideCircleWalls` 는 **최근접 면**으로 밀어내므로 침투 깊이가 두께의 절반을
 * 넘으면 반대편으로 튀어나온다(터널링) — 결정론은 유지되므로 서버 재실행도 같은 결과를 내고,
 * 그래서 해시 검증으로는 절대 잡히지 않는 조용한 배치 계약 위반이 된다.
 */
export function resolveFilmBurst(state: WorldState, x: number, y: number): void {
  // 파열 훅(앵커 ⑮) — **밀어내기보다 앞**이다. 순서가 계약인 이유:
  // 밀어내기 변위는 260 이고 파열 반경은 220 이다(그 부등식이 `FILM_BURST_PUSH_TICKS` 를
  // 100 으로 고른 이유 자체다 — "반경 안의 적을 반경 밖으로"). 그래서 밀어낸 **뒤**에 훅을
  // 태우면 반경 안 적이 **한 기도 남지 않고**, 반경 술어로 대상을 고르는 스킬(PO1 폭발 ·
  // PO7 연쇄 · 훗날의 PO8 기뢰 · DR1 수거)이 전부 **조용히 0건**이 된다. 화면에도 테스트에도
  // "안 터진다" 는 흔적만 남고 원인이 안 보이는, 이 저장소의 지배적 실패 모드다.
  // (실측: 배선 레인이 훅을 뒤에 뒀다가 PO1 이 아무 피해도 안 주는 것을 테스트가 잡았다.)
  //
  // ⚠️ 이 순서는 **밀어낸 결과를 봐야 하는 스킬을 배제한다** — PO4「압착 충돌」은 슬라이드
  // 전후 좌표 차이가 판정이라 이 훅으로는 못 한다(미배선 사유 중 하나). 그 스킬이 오면
  // 훅을 둘로 쪼개라(pre/post). 하나로 합치려 하면 둘 중 하나가 반드시 틀린다.
  //
  // ⚠️ 순환 없음: `skillHooks.ts` 는 `WorldState`/`Entity` 를 type-only 로만 보는 leaf 이고,
  // 그 하위(`catalystHooks`·`skills/*`·`activeTypes`·`status`)에서 이 모듈을 되당기는 경로가
  // 없다(실측: `filmBurst.js` 를 import 하는 곳은 `world.ts` 와 `activeHandlers/bubble.ts`
  // 둘뿐). **`skills/bubble.ts` 가 이 모듈을 import 하는 순간 순환이 된다 — 하지 마라.**
  //
  // 미투자 런은 훅 첫 줄(`skillsOn`)에서 즉시 반환하므로 바이트 단위로 종전과 같다.
  onFilmBurst(state, x, y);
  const push = filmBurstPush();
  const r2 = FILM_BURST_RADIUS * FILM_BURST_RADIUS;
  for (const e of state.entities) {
    if (e.dead || e.kind !== 'enemy') continue;
    const dx = e.x - x;
    const dy = e.y - y;
    const d2 = dx * dx + dy * dy;
    // 반경 판정은 제곱 비교로(선례: nearestTarget·applySingularityPull) — sqrt 를 아끼는 것이
    // 아니라 반경 밖 적에 대해 산술 자체를 실행하지 않기 위해서다.
    if (d2 > r2) continue;
    const d = length(dx, dy);
    // 중심과 정확히 겹친 적은 밀 방향이 정의되지 않는다 — 임의 방향을 만들지 않고 둔다.
    if (d <= 1) continue;
    e.x += (dx / d) * push;
    e.y += (dy / d) * push;
    if (state.activeWalls.length > 0) {
      const slid = slideCircleWalls(e.x, e.y, e.radius, state.activeWalls);
      e.x = slid.x;
      e.y = slid.y;
    }
  }
}
