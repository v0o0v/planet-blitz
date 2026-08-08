/**
 * **레벨별 실효 화력 계측기** — 표준 빌드가 초당 몇 피해를 넣는가.
 *
 * ## 왜 `bench/bossTtk.ts` 만으로는 부족한가
 * TTK 는 **봇의 사격 가동률**이 섞인다(카이팅하느라 사거리를 벗어나면 그 시간이 통째로 TTK 에
 * 들어간다). 실측에서 같은 단계의 시드별 TTK 가 2.1 ~ 61.1 초로 흩어진 것이 그 잡음이다.
 * 보스 HP 곡선의 **모양**을 정하려면 잡음 없는 화력 곡선이 필요하다.
 *
 * ## 무엇을 재는가
 * 플레이어 바로 옆에 **불사 더미**(hp 10억)를 세워 자동 조준이 항상 그것을 물게 하고, 정지
 * 입력으로 N 틱을 굴려 더미가 받은 총 피해를 초로 나눈다. 이동·회피·표적 재선택이 개입하지
 * 않으므로 남는 것은 **조립된 빌드의 화력 그 자체**다.
 *
 * ⚠️ 이것은 «상한»이다(가동률 100%). 실제 TTK 는 이보다 길다. 두 계측기는 서로를 대신하지
 * 못하고 **함께** 읽어야 한다 — 곡선의 모양은 여기서, 절대 눈금은 `bossTtk` 에서 온다.
 *
 * ```
 * node node_modules/.pnpm/vite-node@2.1.9_supports-color@7.2.0/node_modules/vite-node/vite-node.mjs bench/gearDps.ts
 * ```
 */

import { createWorld, stepWorld, emptyInput } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import { blankEntity, addEntity } from '../src/sim/entities.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import { standardEquipped, standardPerTree, investVector } from '../src/bench/standardBuild.js';
import { TICK_RATE } from '../src/sim/constants.js';

/** `bench/runCurve.ts`·`bench/incomingDps.ts` 와 같은 관용구 — DOM lib 아래에서 node 의 `process` 를 좁게 본다. */
interface NodeProcess {
  readonly argv?: readonly string[];
}
const ARGV: readonly string[] = (globalThis as { process?: NodeProcess }).process?.argv ?? [];

function argOf(name: string): string | undefined {
  const pre = `--${name}=`;
  for (const a of ARGV) if (a.startsWith(pre)) return a.slice(pre.length);
  return undefined;
}

/** 사용자가 테스트한 좌표(치트 패널 표준 빌드 점프 규약: 단계 = level/5). */
const LEVELS = (argOf('levels') ?? '1,25,50,75,100').split(',').map((s) => Number(s.trim()));
const SEEDS = Number(argOf('seeds') ?? '6');
const TICKS = Number(argOf('ticks') ?? '900'); // 15초 — 재장전·사이클이 여러 바퀴 돈다.
const DUMMY_HP = 1_000_000_000;
/**
 * 더미 반경. **기본값 128 = 행성 보스의 반경**이다(`data/bosses/*.ts` 는 112~132).
 *
 * ⚠️ **이 값이 계측의 성패를 갈랐다.** 초판은 40(잡몹 크기)이었고 그 눈금은 실제 보스전 화력을
 * **4배 과소평가**했다 — 무기가 `spread` 로 흩뿌리는 탄이 작은 표적에서는 대부분 빗나가는데
 * 보스는 커서 거의 다 맞는다. 즉 «표적 크기»는 화력 계측의 부수 조건이 아니라 **주 변수**다.
 * 보스 HP 를 정하려면 **보스 크기 표적**에 대고 재야 한다.
 */
const DUMMY_RADIUS = Number(argOf('radius') ?? '128');
const SHIP = 0;
const PLANET = 0;

/** 더미를 플레이어 코앞에 둔다 — 자동 조준(최근접)이 항상 이것을 문다. */
const DUMMY_OFFSET_X = 150;

function dpsOf(level: number, seed: number): number {
  const stage = Math.max(1, Math.round(level / 5));
  const profile = defaultProfile();
  const ship = activeShip(profile);
  ship.typeId = SHIP;
  ship.level = level;
  ship.skillInvest = investVector(SHIP, standardPerTree(level));
  ship.equipped = standardEquipped(level, seed, PLANET);
  const config = buildRunConfig(profile, { planet: PLANET, stage });
  const state: WorldState = createWorld(seed, { ...config, playerHp: 1_000_000_000 });

  const p = state.entities[0];
  if (p === undefined) throw new Error('player missing');
  const dummy = blankEntity('enemy');
  dummy.x = p.x + DUMMY_OFFSET_X;
  dummy.y = p.y;
  dummy.radius = DUMMY_RADIUS;
  dummy.hp = DUMMY_HP;
  dummy.maxHp = DUMMY_HP;
  dummy.enemyType = 0;
  dummy.cooldown = Number.MAX_SAFE_INTEGER; // 반격 금지 — 재는 것은 플레이어 화력뿐이다.
  addEntity(state, dummy);

  let dealt = 0;
  for (let t = 0; t < TICKS; t++) {
    // 더미를 매 틱 제자리·만피로 되돌린다(밀려나거나 죽어서 계측이 끊기지 않게).
    dummy.x = p.x + DUMMY_OFFSET_X;
    dummy.y = p.y;
    dummy.dead = false;
    dummy.cooldown = Number.MAX_SAFE_INTEGER;
    const before = dummy.hp;
    stepWorld(state, emptyInput());
    dealt += before - dummy.hp;
    dummy.hp = DUMMY_HP;
  }
  return (dealt / TICKS) * TICK_RATE;
}

console.log(`레벨별 실효 화력 — 스트라이커 · 표준 빌드 · 불사 더미(반경 ${DUMMY_RADIUS}) · ${TICKS}틱 · 시드 ${SEEDS}개`);
console.log('  Lv   DPS중앙    Lv1 대비  [시드별 오름차순]');
const meds: Array<{ level: number; med: number }> = [];
for (const level of LEVELS) {
  const xs: number[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) xs.push(dpsOf(level, seed));
  xs.sort((a, b) => a - b);
  const med = xs[(xs.length - 1) >> 1] ?? 0;
  meds.push({ level, med });
  const base = meds[0]?.med ?? med;
  console.log(
    `${String(level).padStart(4)}  ${med.toFixed(0).padStart(8)}  ${(med / base).toFixed(2).padStart(9)}×  ` +
      `[${xs.map((x) => x.toFixed(0)).join(' ')}]`,
  );
}
