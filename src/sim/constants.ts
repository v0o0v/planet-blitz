/**
 * Core simulation constants (leaf module — no sim dependencies).
 *
 * Kept separate from world.ts so the pattern engine can read the timestep
 * without creating a world ↔ patterns import cycle.
 */

/** Fixed simulation timestep: 60 ticks per second. */
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/**
 * Viewport reference dimensions (world units, matches the 1920x1080 design
 * space). The world itself is now unbounded (infinite scroll map) — these no
 * longer fence the player. They define the on-screen viewport used for spawn
 * rings, projectile culling and camera framing. The `WorldConfig.arenaWidth/
 * Height` fields still carry these values so the replay hash layout is
 * unchanged (replay.ts:104-107).
 */
export const VIEW_WIDTH = 1920;
export const VIEW_HEIGHT = 1080;

/**
 * Player-relative spawn geometry for the infinite map (world units).
 *
 * Enemies, the boss, and supply raiders no longer spawn at absolute arena edges;
 * they materialise just outside the player's on-screen viewport. These offsets
 * are half the viewport plus a margin, so anything placed at them is off-screen
 * regardless of where the player currently is. `SPAWN_RING_RADIUS` is half the
 * viewport diagonal plus a margin (a full off-screen ring in every direction).
 *
 * All are evaluated once at load with only correctly-rounded ops (`Math.sqrt`),
 * so they are bit-identical on every platform and safe for the deterministic sim.
 * Each stays well below `PROJECTILE_CULL_RADIUS` (~3304, world.ts) so a bullet
 * fired by a freshly spawned entity is never culled before it can enter view.
 */
export const SPAWN_MARGIN = 140;
export const OFFSCREEN_X = VIEW_WIDTH / 2 + SPAWN_MARGIN; // 1100
export const OFFSCREEN_Y = VIEW_HEIGHT / 2 + SPAWN_MARGIN; // 680
export const SPAWN_RING_RADIUS =
  Math.sqrt(VIEW_WIDTH * VIEW_WIDTH + VIEW_HEIGHT * VIEW_HEIGHT) / 2 + 220; // ~1322

/**
 * Fixed horizontal span (world units) of a lava-pillar line, centred on the
 * player. Absolute arena spans no longer make sense on the infinite map, so a
 * pillar line covers one viewport width around the player.
 */
export const HAZARD_LINE_SPAN = VIEW_WIDTH;

/**
 * 발사 간격 고정소수점 스케일 — 1틱 = {@link FIRE_CD_Q} 단위.
 *
 * **256 인 이유**: ① 2의 거듭제곱이라 `틱 × 256` 이 배정밀도에서 **정확**하고 나눗셈도 무손실
 * ② 최소 유의 배율이 `1/256 ≈ 0.39%` 라 이 리포의 최소 파워업 폭(−8%)을 **가장 짧은 간격
 * (하한 2틱 = 512)에서도** 삼키지 않는다(`512 × 0.08 = 41 ≫ 0.5`) ③ 가장 긴 간격(미사일 16틱
 * = 4096)에 60틱 런 6분(21,600틱)을 곱해도 2^31 을 한참 밑돌아 `>>> 0` 해시 폴드가 안전하다.
 *
 * ⚠️ 값을 바꾸면 **모든 골든 해시가 갈린다**(리플레이 해시가 이 필드를 접는다).
 */
export const FIRE_CD_Q = 256;
/** 발사 간격 하한(2틱). 프레임당 발사 폭주 방지 가드 — **없애지 마라**. */
export const FIRE_CD_MIN_Q = 2 * FIRE_CD_Q;

/**
 * 콤보가 픽업 없이 버티는 틱 수(= 콤보 창). `world.ts` 의 `updateCombo`·`bumpCombo` 가 유일한
 * 소유자였다.
 *
 * ## 왜 leaf 로 옮겼는가 (S1)
 * `world.ts` 의 **비공개 상수**였던 탓에 `src/sim/skills/*` 가 이 값을 읽을 수 없었고, 그래서
 * 스트라이커 S8「콤보 차폐」의 *콤보 창 부분 회복*(`comboTimer = min(comboTimer + 창/2, 창)`)이
 * 미배선으로 남아 있었다(`skillHooks.ts` 앵커 ① 주석). 값을 기체 모듈에 다시 적는 대안은
 * **두 정본이 조용히 갈리므로** 기각했다 — 이동이 유일하게 옳은 해법이다.
 *
 * ⚠️ **값 복제 금지.** 콤보 창이 필요하면 여기서 import 해라. `world.ts` 도 그렇게 한다.
 * ⚠️ 값을 바꾸면 콤보 유지 시간이 바뀌어 **골든 해시가 전량 갈린다**(XP 배율이 콤보에 걸린다).
 */
export const COMBO_WINDOW_TICKS = 120;

/**
 * 아크캐스터 과충전 **정지 카운터 상한**(`Entity.aux0`). 증폭 bp 는 190틱에서 이미 상한이라
 * 거동에는 영향이 없고, `aux0` 을 정수 유계로 묶어 두는 것이 이 상수의 일이다
 * (`aux` 는 u32 로 해시된다 — `replay.ts` `hashEntity`).
 *
 * ## 왜 leaf 로 옮겼는가 (S2)
 * `world.ts` 의 **비공개 상수**였던 탓에 소비처 셋(`world.ts` 의 적립 · `activeHandlers/
 * arccaster.ts` 의 액티브 6종 · `skills/arccaster.ts` 의 BR7·BR10)이 **같은 600 을 각자 선언**
 * 하고 있었다. 셋 중 하나만 고치면 시그니처 카운터가 상한 밖으로 새거나 주입이 조용히 잘린다.
 * `COMBO_WINDOW_TICKS` 가 S1 에서 같은 사유로 여기 온 선례를 따른다.
 *
 * ⚠️ **값 복제 금지.** 필요하면 여기서 import 해라.
 */
export const OVERCHARGE_TICK_CAP = 600;
