/**
 * **접촉 조향 파일럿** — `id 1 plunder`(약탈)를 벤치로 잴 수 있게 만드는 계측기 수리.
 *
 * ## 왜 필요한가
 * `id 1 plunder` 의 규칙은 *"엘리트와 보스는 처치해도 전리품을 뱉지 않는다 — **몸으로 부딪혀야**
 * 한 번에 전부 강탈한다"* 다. 그런데 `measurePilotInput` 의 조향 정본은 `pilotSteer` 의
 * **카이팅**(최근접 적과 `KITE_DISTANCE` 를 유지)이라 근접 접촉을 **원리적으로 만들지 않는다**.
 * 그래서 이 카드의 `파워:` 칸(= "무촉매 대비 배수", `bench/runCurve.ts` 의 짝지은 스윕)이
 * 영원히 1.00 으로 나온다 — 카드가 죽어 있어도 계측이 그것을 못 본다.
 *
 * 이것은 밸런스 문제가 아니라 **계측기 결함**이다(`runCurve.ts` 헤더 「조용한 성공」과 같은 부류).
 * 사용자 판정(2026-08-08): 접촉 조향 모드를 파일럿에 신설한다.
 *
 * ## 왜 `src/sim/measurePilot.ts` 가 아니라 여기인가
 * 접촉 조향은 **계측 목적의 조향 정책**이지 sim 규칙이 아니다. `measurePilot.ts` 는 이미
 * "조향은 복제하지 않는다 · 프로파일은 sim 에 심지 않는다"를 계약으로 못 박았고, 이 파일은 그
 * 계약을 지킨 채 **바깥에서 한 겹 덧씌우는** 방식이다 — `measurePilotInput` 의 출력을 받아
 * 게이트가 켜졌을 때만 이동 성분을 교체한다. sim 파일은 한 줄도 바뀌지 않으므로 기존 골든·
 * 회귀·리플레이 계약이 전부 그대로다.
 *
 * ## 계약 넷
 * 1. **게이트가 가장 바깥이다.** `config.catalysts` 에 `id 1` 이 없으면 `measurePilotInput` 의
 *    반환값을 **그대로** 돌려준다 — 그 경로에서는 이 파일이 프레임을 만들지도, 읽지도 않는다.
 *    무촉매 `bench:curve` 출력이 비트 단위로 종전과 같다는 근거가 이것이다.
 * 2. **RNG 를 소비하지 않는다.** 표적 선택은 좌표·id 만 보는 순수 함수이고 동률은 id 오름차순으로
 *    깬다(`autopilot.ts` 의 `nearestTarget` 과 같은 규약).
 * 3. **표식은 접근자로만 읽는다.** `readMark(e, 'plunder')` 뿐이고 비트를 직접 만지지 않는다.
 *    그리고 **`kind === 'enemy'` 에만 묻는다** — `aux0` 는 kind 마다 뜻이 달라서, 보스의 `aux0`
 *    비트 0 은 **추격 모드 취약화 플래그**다(`catalystMarks.ts` 헤더 §대상). 보스는 표식이 아니라
 *    **kind 로** 잡는다.
 * 4. **정교한 AI 가 아니다.** 목적은 "접촉이 원리적으로 0회가 아니게" 만드는 것뿐이다.
 */

import type { InputFrame, WorldState } from '../src/sim/world.js';
import type { Entity } from '../src/sim/entities.js';
import { length } from '../src/sim/math.js';
import { pilotSteer } from '../src/sim/autopilot.js';
import { measurePilotInput } from '../src/sim/measurePilot.js';
import { readMark } from '../src/sim/catalystMarks.js';

/** `id 1 plunder` — 접촉 조향을 켜는 **유일한** 카드. */
export const PLUNDER_CATALYST_ID = 1;

/**
 * 이탈 규율 — 남은 HP 비율이 이 값 **이하**면 접촉 조향을 끄고 카이팅 정본으로 돌아간다.
 *
 * ## 왜 0.5 인가
 * 접촉은 곧 접촉 피해다. 그리고 이 저장소의 피격 피해에는 `PLAYER_DAMAGE_TAKEN_MULT` 2배가
 * 걸려 있어(ADR-0051 이 봇 완주 e2e 12건을 게이트에서 내린 직접 원인), 접촉을 무한히 반복하면
 * 파일럿이 **런 초반에 죽는다**. 죽은 런은 강탈을 한 번 재고 끝나므로 계측이 무의미해진다.
 *
 * 값의 근거는 정밀한 최적화가 아니라 **여유의 방향**이다: 절반을 남기면 남은 절반으로 카이팅
 * 복귀·회복 픽업·레벨업을 거칠 여지가 있고, 반대로 절반까지는 접촉을 반복할 여지가 있다.
 * 여기를 더 정교하게(위협 예측·이탈 경로 계산) 만들면 "봇이 이기는가"를 재는 물건이 되어
 * ADR-0051 이 내린 축을 되살린다 — 이 파일이 재는 것은 **메커닉이 열리는가**다.
 *
 * ⚠️ 이 하한은 **접촉을 막는 값이 아니라 자살을 막는 값**이다. 0 으로 두면 파일럿이 접촉
 * 상태로 갈려 죽고, 1 로 두면 접촉이 한 번도 안 일어난다.
 */
export const CONTACT_HP_FLOOR = 0.5;

/**
 * 이번 틱의 **접촉 조향 입력 프레임**. `world` 상태만의 순수 함수 — 부작용 없음.
 *
 * `id 1` 이 실리지 않은 런에서는 {@link measurePilotInput} 의 반환값을 **그대로** 돌려준다
 * (계약 1). 실린 런에서는 강탈 대상이 있을 때만 이동 성분을 그쪽 직진으로 교체하고, 조준·대시·
 * 액티브 비트는 측정 파일럿 정본을 그대로 쓴다 — 무엇을 쏘는가와 어디로 가는가는 별개 축이다.
 */
export function contactPilotInput(world: WorldState): InputFrame {
  const base = measurePilotInput(world);

  // ── 게이트(가장 바깥) ─────────────────────────────────────────────────────
  // 여기서 빠지는 경로는 아래 코드를 한 줄도 실행하지 않는다. 무촉매·타촉매 런의 프레임이
  // 종전과 비트 동일하다는 것의 전부가 이 return 이다.
  if (!carriesPlunder(world)) return base;

  // 프리즈 틱에는 이동 성분이 의미가 없고, 발동 비트를 실어서도 안 된다(측정 파일럿의 프리즈
  // 규율). `pilotSteer` 는 순수 함수라 다시 물어도 RNG 를 소비하지 않는다.
  if (pilotSteer(world).freeze) return base;

  const player = world.entities[0];
  if (player === undefined) return base;

  // 이탈 규율 — 근거는 CONTACT_HP_FLOOR 주석.
  if (player.maxHp > 0 && player.hp <= player.maxHp * CONTACT_HP_FLOOR) return base;

  const target = nearestPlunderTarget(world, player);
  if (target === undefined) return base;

  const dx = target.x - player.x;
  const dy = target.y - player.y;
  const d = length(dx, dy);
  // 이미 겹쳐 있다 = 접촉 중이다. 방향이 없으므로 정본에 맡긴다(밀어붙일 곳이 없다).
  if (d <= 0.0001) return base;

  return { moveX: dx / d, moveY: dy / d, aim: base.aim, dash: base.dash, special: base.special };
}

/** 이 런이 `id 1` 을 싣고 있는가. `config.catalysts` 가 유일 정본이다(`catalystOn` 은 파생값). */
function carriesPlunder(world: WorldState): boolean {
  const ids = world.config.catalysts;
  if (ids === undefined) return false;
  for (const id of ids) if (id === PLUNDER_CATALYST_ID) return true;
  return false;
}

/**
 * 가장 가까운 **강탈 대상**. 없으면 undefined.
 *
 * 대상은 둘이다:
 *   - `kind === 'enemy'` 이고 `plunder` 표식이 선 것(= 배선 레인이 엘리트에 찍는다).
 *   - **보스**(`boss` · `defenseBoss`) — 표식이 아니라 **kind 로** 잡는다. 보스의 `aux0` 비트 0 은
 *     추격 모드 취약화 플래그라 `readMark` 로 읽으면 오독이다(`catalystMarks.ts` §대상).
 *
 * 동률은 id 오름차순으로 깬다 — 플랫폼 순회 순서에 의존하지 않는다.
 */
function nearestPlunderTarget(world: WorldState, player: Entity): Entity | undefined {
  let best: Entity | undefined;
  let bestD = Infinity;
  for (const e of world.entities) {
    if (e.dead) continue;
    if (!isPlunderTarget(e)) continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    const d = dx * dx + dy * dy;
    if (d < bestD || (d === bestD && best !== undefined && e.id < best.id)) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** 강탈 대상 판정. 보스는 kind 로, 잡몹은 표식으로 — 두 축을 섞지 않는다. */
function isPlunderTarget(e: Entity): boolean {
  if (e.kind === 'boss' || e.kind === 'defenseBoss') return true;
  if (e.kind !== 'enemy') return false;
  return readMark(e, 'plunder') !== 0;
}
