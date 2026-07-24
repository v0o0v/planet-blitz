/**
 * 중반 격전(mid-run clash) — ADR-0032. 런 중반에 **매 런 확정 등장**하는 구조 비트.
 *
 * 정예 서지가 몰려오고 그 정점에 **강화 정예 리더**(엘리트급, 보스급 아님)가 수렴한다.
 * 전용 세그먼트(`WaveSegment.clash === true`)로 데이터에 박혀 있고, 그 세그먼트의 전진
 * 게이트는 처치 할당·스크롤 거리·정화율이 아니라 **리더 처치**다. 런 길이는 여전히 창발이다
 * (ADR-0011) — 강한 빌드는 리더를 빨리 잡아 par 보다 짧게 넘긴다. 전 계수는 플레이스홀더 —
 * TODO(밸런스): 출시 전 일괄 튜닝.
 *
 * ## 신규 해시 필드 0 (조우 프레임워크 계획 AC9 / MAJ-3)
 * `WaveRuntime` 에 필드를 **하나도 늘리지 않는다**. `hashWorld` 는 wave 런타임 7필드
 * (segmentIndex/segmentElapsed/cardTimer/boss/done/segmentBaseKills/segmentKillGoal)를
 * **무조건** 접기 때문에, 필드를 하나라도 늘리면 전 PvE + 침공 해시가 통째로 갈린다.
 * 그래서 "리더가 아직 살아 있는가" 를 **마커 엔티티 생존 스캔으로 파생**한다
 * (`COUNTER_DEVICE_MARK`/`CONTAMINATION_NODE_MARK`/`RACING_WALL_MARK` 선례).
 *
 * ## ⚠️ 마커를 `ownerId` 가 아니라 `aux1` 에 싣는 이유 (선례와 다른 지점)
 * 다른 모드의 마커는 `destructible`·`wall` 의 `ownerId` 를 쓴다. 그러나 **적('enemy' kind)의
 * `ownerId` 는 이미 냉기 감속 잔여 틱**이다(`src/sim/status.ts` — `applySlow` 가 쓰고
 * `tickEnemyStatus` 가 **매 틱 1씩 감소**시킨다). 적 마커를 `ownerId` 에 실으면 스폰 다음 틱에
 * 값이 1 줄어 마커 판정이 즉시 깨지고(= 리더가 살아 있는데 게이트가 열림), 반대로 큰 상수가
 * 들어가 있으면 리더에게 냉기 감속이 안 걸린다. 그래서 적에게 남는 범용 정수 슬롯인
 * `aux1` 을 쓴다 — `enemy` kind 의 `aux1` 을 읽는 코드는 어디에도 없다(`aux0` 은 침공 편대
 * 슬롯 표식이 쓴다: `src/sim/invasion/formation.ts`). `aux0/aux1` 은 둘 다 0 이면 해시 꼬리
 * 폴드가 생략되는 조건부 필드라(replay.ts `ENTITY_HASH_OPTIONAL_TAIL`), 격전이 없는 런의
 * 엔티티 해시 레이아웃은 그대로다.
 *
 * ## 침공 불변
 * 중반 격전은 `updateWaves` 안에서만 발화하고, 침공(`config.invasion3`)은 `world.ts` 의
 * `if (!designedRun) updateWaves(...)` 로 웨이브 디렉터를 **아예 실행하지 않는다**. 따라서
 * 이 모듈은 침공 런에서 한 줄도 돌지 않는다 → 침공 per-tick 해시 바이트 불변(AC2).
 * PvE baseline 은 매 런 등장이라 바뀐다 → 골든 재생성으로 흡수(AC3).
 *
 * ## 결정론(ADR-0005)
 * RNG·Date.now·전역을 쓰지 않는다. 소환은 `summonEnemy`(**RNG 미소비** — 첫 발사 쿨다운을
 * 정의값으로 고정하는 보스 소환용 경로)로만 하고, 배치는 플레이어 기준 **고정 오프셋 표**다
 * (난수·삼각함수 없이 상수 덧셈뿐). 그래서 `waveRng`/`eliteRng`/`dropRng` 스트림이 한 칸도
 * 밀리지 않아 기존 카드 추첨 시퀀스가 갈리지 않는다.
 *
 * ## 순환 의존 주의
 * `waves.ts` 가 이 모듈을 런타임 import 하고 이 모듈은 `waves.ts` 의 `summonEnemy` 를 다시
 * 가져오므로 **모듈 순환이 하나 생긴다**. 안전한 형태다 — 양쪽 다 호이스팅되는 함수 선언이고,
 * 서로를 **모듈 평가 시점이 아니라 호출 시점에만** 참조한다(top-level 에서 상대 모듈 값을
 * 읽지 않는다). `world.ts` 는 다른 모드 모듈과 동일하게 **타입만** 가져온다.
 */
import type { Entity } from '../entities.js';
import type { WorldState } from '../world.js';
import type { WaveRuntime } from '../waves.js';
import { summonEnemy } from '../waves.js';
import { planetContent } from '../../../data/planets/index.js';

/**
 * 격전 리더 마커(`enemy.aux1` 센티넬). 기존 마커 8종(DRONE 0xd4090e·BROOD 0xb400d5·
 * MISSILE 0x3155110·HIVE 0x81ce77·SPLIT 0xf12a6·RACING_WALL 0x4ac1a6·CONTAMINATION_NODE
 * 0xc0f7a1·COUNTER_DEVICE 0xc07e5d)과 전부 다르다. 그 마커들은 전부 `ownerId` 를 쓰고 이
 * 값만 `aux1` 을 쓰므로 필드 자체가 겹치지 않지만, 값도 겹치지 않게 둔다(로그·디버깅 혼동 방지).
 */
export const MID_CLASH_LEADER_MARK = 0xc1a58e;

// --- 플레이스홀더 계수 (TODO(밸런스): 출시 전 일괄 튜닝, 구조만 고정) ---
/** 리더 HP 배율(기반 정의 HP 대비). 엘리트급이지 보스급이 아니다 — 보스 미리보기가 되면 안 된다. TODO(밸런스). */
export const MID_CLASH_LEADER_HP_MULT = 8;
/** 리더 접촉 피해 배율. TODO(밸런스). */
export const MID_CLASH_LEADER_DAMAGE_MULT = 2;
/** 리더 스폰 오프셋(플레이어 기준, 화면 밖 위쪽에서 내려온다). TODO(밸런스). */
export const MID_CLASH_LEADER_OFFSET_X = 0;
/** 리더 스폰 오프셋 Y(음수 = 위). TODO(밸런스). */
export const MID_CLASH_LEADER_OFFSET_Y = -1100;
/**
 * 정예 서지 배치(플레이어 기준 **고정 오프셋 표**). 링을 삼각함수로 깔지 않고 상수 표로 두어
 * 결정론이 자명하다(부동소수 재현 논쟁이 아예 없다). 리더가 위(−Y)에서 오므로 서지는 좌우·
 * 아래를 포함해 감싸 들어온다. 개수·거리 전부 TODO(밸런스).
 */
export const MID_CLASH_SURGE_OFFSETS: readonly { readonly x: number; readonly y: number }[] = [
  { x: -900, y: -700 },
  { x: 900, y: -700 },
  { x: -1200, y: 0 },
  { x: 1200, y: 0 },
  { x: -900, y: 700 },
  { x: 900, y: 700 },
  { x: -300, y: 1100 },
  { x: 300, y: 1100 },
];

/**
 * 격전 리더가 살아 있는가(마커 엔티티 생존 스캔 — 신규 해시 필드 0). 순수 판정.
 * 격전 세그먼트를 통과한 뒤에는 리더가 존재하지 않으므로 항상 false 다(그 세그먼트 밖에서
 * 이 함수를 부를 일은 없지만, 부르더라도 상태를 바꾸지 않는다).
 */
export function midClashLeaderAlive(state: WorldState): boolean {
  for (const e of state.entities) {
    if (e.kind === 'enemy' && !e.dead && e.aux1 === MID_CLASH_LEADER_MARK) return true;
  }
  return false;
}

/**
 * 격전 세그먼트 **진입 틱**(`segmentElapsed === 0`)에 리더 + 정예 서지를 소환한다.
 *
 * 세그먼트의 온스크린 적 상한(`maxEnemies`)을 의도적으로 무시한다 — 격전은 카드 추첨이 아니라
 * **연출된 비트**이고, 상한에 걸려 리더가 안 나오면 전진 게이트가 통째로 죽는다(정의상 데드락).
 * 상한은 이어지는 카드 추첨에 계속 적용되므로 밀도 폭주는 그쪽에서 잡힌다.
 *
 * 재진입 방어: 리더가 이미 살아 있으면(치트 패널 세그먼트 점프 등) 아무것도 하지 않는다.
 */
export function spawnMidClash(state: WorldState, player: Entity): void {
  if (midClashLeaderAlive(state)) return;
  const planet = planetContent(state.config.planet);
  // 리더 기반 정의: 그 행성의 정예 1종(있으면) → 없으면 특수 역할. 행성 정체성을 그대로 쓰되
  // 아래 배수로 "강화 정예" 로 만든다(전용 EnemyDef 를 새로 만들면 typeIndex 계약이 늘어난다).
  const leaderDef = planet.elites[0] ?? planet.roster.special;
  const leader = summonEnemy(
    state,
    leaderDef,
    player.x + MID_CLASH_LEADER_OFFSET_X,
    player.y + MID_CLASH_LEADER_OFFSET_Y,
  );
  leader.aux1 = MID_CLASH_LEADER_MARK; // 전진 게이트의 유일한 파생원(정수 — hashU32 로 접힘).
  // HP·피해는 스폰 후 필드 직접 배수(정수 반올림 — 소수부는 해시 f64 로 접히지만 정수로 두어
  // 단계 배율·촉매 배율과 곱해도 값이 튀지 않게 한다). summonEnemy 가 이미 단계 HP·촉매를 얹었다.
  leader.hp = Math.round(leader.hp * MID_CLASH_LEADER_HP_MULT);
  leader.maxHp = leader.hp;
  leader.damage = Math.round(leader.damage * MID_CLASH_LEADER_DAMAGE_MULT);
  // 정예 서지: 고정 오프셋 표대로 돌격형/사격형을 번갈아 깐다(인덱스만의 함수 = 결정론).
  for (let i = 0; i < MID_CLASH_SURGE_OFFSETS.length; i++) {
    const off = MID_CLASH_SURGE_OFFSETS[i];
    if (off === undefined) continue;
    const def = i % 2 === 0 ? planet.roster.charger : planet.roster.gunner;
    summonEnemy(state, def, player.x + off.x, player.y + off.y);
  }
}

/**
 * 격전 세그먼트 전진 게이트(리더 **처치** 파생).
 *
 * `segmentElapsed > 0` 조건이 "아직 소환 전인데 cleared" 오판을 **구조적으로** 막는다:
 * 리더는 세그먼트 진입 틱(`segmentElapsed === 0`)에 소환되고, `updateWaves` 는 그 소환을
 * 마친 뒤에야 `segmentElapsed++` 를 거쳐 이 게이트를 평가한다. 즉 이 함수가 호출되는 시점의
 * `segmentElapsed` 는 항상 1 이상이고 리더는 이미 존재한다. 조건 자체는 방어적 이중 안전장치다
 * (호출 순서가 바뀌더라도 게이트가 헛돌지 않는다).
 *
 * ## ⚠️ "리더가 사라졌다" ≠ "리더를 처치했다" (리뷰 HIGH-2 — 조우 봉인 수호자와 같은 결함축)
 * `cullScrollEnemies`(modes/blockBreak.ts)는 강제 스크롤 창 뒤로 밀린 적을 **`hp > 0` 인 채로
 * `dead = true`** 로 만든다. 리더가 그렇게 사라지면 마커 스캔이 0 이 되어 이 게이트가 즉시
 * 열리고, 격전 세그먼트는 `killGoal = 0` 이라 처치 게이트조차 없어서 **"매 런 확정 par 연장
 * 비트"(ADR-0032)가 racing/blockBreak 2 모드에서만 조용히 무효화**된다. `compact`(world.ts)가
 * `hp <= 0` 게이트로 공짜 처치·젬·루팅을 배제하는 것과 **같은 규율**로 정렬해야 한다.
 *
 * 방어는 두 겹이다.
 *  - **①(1차·구조적)** `cullScrollEnemies` 가 `MID_CLASH_LEADER_MARK` 를 컬링에서 제외한다
 *    (`isCullExemptEnemy`). 리더는 흘러간 잡몹이 아니라 전진 게이트 그 자체다.
 *  - **②(2차·여기)** 게이트가 **"이 세그먼트에서 처치가 최소 1건 있었다"** 를 함께 요구한다.
 *    `state.kills` 는 `compact` 의 `hp <= 0` 분기에서만 오르므로(컬링 소멸은 절대 올리지
 *    않는다), 리더를 실제로 잡았다면 이 조건은 **반드시** 참이다 → 데드락이 원리적으로 없다.
 *    반대로 아무도 죽지 않은 세그먼트에서 리더만 조용히 증발한 경우는 걷어낸다.
 *    `w.segmentBaseKills` 는 세그먼트 진입 시 찍힌 `state.kills` 스냅샷이라 **WaveRuntime
 *    신규 필드가 0** 이다(계획 AC9/MAJ-3 — 필드가 늘면 전 PvE + 침공 해시가 갈린다).
 *
 * ②의 한계도 적어 둔다: 서지 잡몹을 하나라도 잡은 뒤 리더만 비-처치 소멸하면 통과한다. 그
 * 사각은 ①이 덮는다. **두 방어는 짝이고 한쪽만 남기면 안 된다.**
 */
export function midClashCleared(state: WorldState, w: WaveRuntime): boolean {
  return (
    w.segmentElapsed > 0 && !midClashLeaderAlive(state) && state.kills > w.segmentBaseKills
  );
}
