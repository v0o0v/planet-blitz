/**
 * 조우 프레임워크 + 중반 격전 — **해시 불변식 게이트** (AC1 · AC2).
 *
 * `tests/fixtures/encounter-baseline.json` 은 변경 **전** 커밋(origin/main `9301f10`)을 체크아웃한
 * detached 워크트리에서 `scripts/recordEncounterBaseline.ts` 로 굳힌 per-tick 해시 기준선이다.
 * 이 테스트는 그 기준선을 **읽어서 대조만** 한다 — 절대 다시 쓰지 않는다
 * (`tests/shipHashBaseline.test.ts` 와 같은 성격. 재생성형 픽스처인
 *  `scripts/deno-verify/fixtures.json` 과는 정반대다).
 *
 * ## 무엇을 증명하는가
 *  - **AC1 (조우-absent 불변)**: `worldRng.fork('encounter')` 도입이 기존 RNG 스트림을 한 칸도
 *    밀지 않고, `hashWorld` 의 조우 폴드가 **조건부 꼬리**라서 조우 미발생 런에서는 한 바이트도
 *    추가되지 않는다.
 *  - **AC2 (invasion 회귀 가드)**: 침공 per-tick 해시가 조용히 갈리지 않는다.
 *
 * ## ⚠️ invasion 항목은 2026-07-26 에 재녹화됐다 (ADR-0034)
 * 원래 AC2 는 "중반 격전 세그먼트 삽입이 침공 해시를 한 바이트도 바꾸지 않는다"는 **불변**
 * 주장이었다(침공은 `updateWaves` 를 실행하지 않으므로 — `world.ts` 의 `if (!designedRun)`).
 * `feat/scroll-anchor-policy`(ADR-0034 강제 스크롤 정책 축 ANCHOR/WORLD)가 그 전제를 정당하게
 * 깼다: 침공 3레이어는 강제 스크롤 창을 쓰는 모드이고 ANCHOR 정책이 창 이동량의 일부를
 * 엔티티 좌표에 가산하므로 **틱 0 부터** 해시가 달라진다(창이 틱 0 에 이미 전진하고 앵커가
 * 돈다). 그래서 invasion 항목만 현 코드로 재녹화했고, 이 블록의 성격은 "삽입 전과의 불변
 * 증명"에서 **"이후의 조용한 발산을 잡는 회귀 가드"** 로 바뀌었다.
 *
 * **PvE 항목은 손대지 않았다 — 재녹화 전후 직렬화 바이트가 완전히 동일하다**(235078 bytes).
 * 창이 없는 모드(뱀서류·수축)는 ANCHOR 코드 경로 자체를 타지 않아 해시가 바이트 불변이며,
 * 아래 AC1 블록이 그 불변식을 계속 대조한다. 다음에 invasion 을 재녹화할 때도 같은 방식으로
 * (invasion 배열만 교체) 해야 하고, PvE 값이 함께 움직이면 그건 게이트가 새고 있다는 뜻이다.
 *
 * ## ⚠️ 2026-07-26 (2차) — PvE·invasion 을 **둘 다** 재녹화했다
 * `fix/ui-density-pass-2026-07-26` 이 sim 을 두 축에서 정당하게 바꿨다.
 *
 *  1. **PvE 밀도 배율 1.5**(`src/sim/waves.ts` 의 `PVE_DENSITY_MULT`) — `updateWaves` 안에서만
 *     걸리므로 침공에는 **한 바이트도 닿지 않는다**(침공은 `!designedRun` 게이트 때문에
 *     `updateWaves` 를 아예 실행하지 않는다). PvE 해시만 바뀐다.
 *  2. **플레이어탄 선분(swept) 판정**(`sweptCircleOverlap`) — 이쪽이 invasion 을 움직인 범인이다.
 *     `resolveCollisions` 는 PvE·침공이 **공유**하는 경로이고, 탄 판정을 이동 후 한 점에서
 *     경로 선분으로 바꾸면 명중 틱·명중 여부가 달라져 양쪽 해시가 함께 갈린다.
 *     근거(실측): 탄속이 틱당 62유닛인데 히트 창은 37유닛이라, 플레이어에 붙은 적이 자기 탄에
 *     구조적으로 맞지 않았다(300틱 동안 플레이어 40유닛 안에 존재한 탄 0발). 밀도를 올리자
 *     무리가 플레이어를 포위해 132마리가 불사로 쌓인 채 런이 교착됐고, 그래서 근본 해소했다.
 *
 * ## ⚠️ 2026-07-26 (3차) — **PvE 만** 재녹화했다 (탄 대 벽 선분 판정)
 * 탄 **대 벽** 판정을 지점 → 선분(`los.sweptCircleOverlapsWall`)으로 올렸다. 근거: 탄 대 적은
 * 2차에서 이미 선분이 됐는데 벽만 지점이라, 빠른 탄이 한 틱에 벽을 통째로 건너뛰면 **벽 뒤 적에게
 * 피해가 들어갔다**(선분 판정에 가림 개념이 없다). 도달 가능성은 실측이다 — 만점 빌드 탄 스텝이
 * 132~262 유닛/틱이라 청크 벽 전폭 120·침공 회랑 240 을 모두 넘는다
 * (`tests/bulletTunnelInvariant.test.ts` 가 그 계산을 카탈로그에서 파생한다).
 *
 * **invasion 배열은 손대지 않았다 — 재녹화 전후 바이트 완전 동일**(29211 bytes). PvE 는 12런 중
 * **7런**이 갈렸다(탄이 이제 벽에 막힌다). 즉 이번에는 아래 ADR-0034 규율이 **거울상으로**
 * 지켜졌다 — PvE 만 교체했고, invasion 이 함께 움직였다면 그건 게이트가 새고 있다는 뜻이었을 것이다.
 *
 * 그런데 **EF 재배포는 이번에도 필요하다.** invasion 골든은 무입력 런이라 그 900틱 동안 활성 벽이
 * 0개이고(실측), 실제 침공은 L2 회랑에서 `invasion/facility.ts` 가 템플릿 벽을 스폰한다. 벽이
 * 있는 곳에서만 갈리는 변경이므로 "골든 불변 ≠ 침공 sim 불변" 이 그대로 성립한다.
 *
 * 그래서 2차에는 위 ADR-0034 절의 "invasion 배열만 교체" 규칙을 **따를 수 없었다** — 두 배열이
 * 모두 정당하게 움직였다. AC1·AC2 는 이제 둘 다 "이 시점 이후의 조용한 발산을 잡는 회귀 가드"
 * 이고, 그것이 이 파일이 계속 지키는 값이다. **이 재녹화는 서버 검증(`verify-invasion` EF)
 * 재배포를 동반해야 한다** — 클라와 서버의 sim 이 갈리면 정상 침공 리플레이가 거부된다.
 *
 * ## ⚠️ 2026-07-26 (4차) — PvE 만 재녹화했다 (다중 명중 해소 순서)
 * `fix/bullet-hit-order-2026-07-26` 이 한 틱 다중 명중을 격자 순서가 아니라 **경로 순서**(진입
 * 매개변수 t 오름차순)로 해소하도록 바꿨다. 명중 **여부** 술어는 한 글자도 안 바뀌었고 순서만
 * 바뀌므로, 탄 하나가 한 틱에 표적을 둘 이상 후보로 갖는 상황에서만 해시가 움직인다.
 *
 * 3차와 같은 결과다 — **invasion 배열은 재녹화 전후 바이트 완전 동일**(29211 bytes)이고 PvE 만
 * 갈렸다. 이 세 시드 ×900틱 침공 런에는 다중 명중이 없었다는 뜻이고, AC2 블록이 그 사실을 계속
 * 대조한다.
 *
 * **그래도 `verify-invasion` EF 재배포는 필요하다** — 3차와 정확히 같은 이유다. 위 바이트 동일은
 * "이 세 런에서 안 갈렸다" 는 관측이지 "침공에서 구조적으로 못 갈린다" 는 증명이 아니다.
 * `resolveCollisions` 는 PvE 와 침공이 **공유**하는 경로이고, 실제 침공 플레이에서는 다중 명중이
 * 얼마든지 난다. 서버가 옛 sim 을 들고 있으면 정상 리플레이가 거부된다.
 *
 * ## ⚠️ 2026-07-27 (5차) — PvE·invasion 을 **둘 다** 재녹화했다 (앵커 정책 개정 + 청크 겹침)
 * 한 브랜치가 sim 을 두 축에서 정당하게 바꿨다.
 *
 *  1. **강제 스크롤 앵커 정책 개정**(`src/sim/scrollMode.ts` `scrollAnchored`) — WORLD 축을
 *     "월드에 깔린 지형·구조물"로 좁히고 적·보스·탄·편대·드론을 ANCHOR 로 옮겼다(사용자 지시
 *     2026-07-27 "벽 빼고는 다 강제 스크롤 안되게"). 침공 3레이어는 창을 쓰는 모드라 **틱 0 부터**
 *     갈린다. PvE 는 창이 있는 모드(블록격파·레이싱)에서만 갈리는데, 골든 12런은 창이 없는
 *     뱀서류 행성이라 이 축만으로는 PvE 가 움직이지 않는다.
 *  2. **청크 기믹 겹침 제거**(`src/sim/chunks.ts`) — 한 청크 안 배치가 서로 겹치지 않도록 거절
 *     표집을 넣었다(사용자 신고 "벽이 겹쳐서 나올 때가 있음"). 종류·크기를 먼저 굴리고 위치를
 *     나중에 굴리므로 **청크 RNG 스트림이 재배열**된다 → PvE 절차 지형이 통째로 바뀌어 12런 전부
 *     갈린다. 청크 생성은 침공에서 아예 돌지 않으므로 이 축은 invasion 을 건드리지 않는다.
 *
 * 즉 이번에는 두 배열이 **서로 다른 이유로** 갈렸다(1 → invasion, 2 → PvE). 2차 때처럼 "invasion
 * 배열만 교체" 규칙을 따를 수 없었고, 두 배열 모두 현 코드로 재녹화했다. AC1·AC2 는 이 시점
 * 이후의 조용한 발산을 잡는 회귀 가드로 계속 산다.
 *
 * **`verify-invasion` EF 재배포를 동반한다** — 앵커 정책은 침공 sim 을 틱 0 부터 바꾸므로,
 * 서버가 옛 sim 을 들고 있으면 정상 침공 리플레이가 전부 거부된다(선택이 아니라 필수).
 *
 * ## ⚠️ 2026-07-27 (6차) — **PvE 만** 재녹화했다 (밸런스 패스 ADR-0035·0036·0037)
 * 이번 패스는 sim 을 PvE 축에서만 정당하게 바꿨다:
 *  1. **경험치 이원화 재보정**(`src/sim/world.ts` `xpToNext` `10+6L` → **`10+66L`**) — 런당
 *     레벨업을 5\~8회로 맞춘 값(ADR-0036 · 경제 재보정 5회차 수렴). 파워업 픽 횟수가 바뀌므로
 *     `powerupRng` 소비와 그 뒤 전개가 통째로 갈린다.
 *  2. **적 축**(`data/waves.ts`) — `SEGMENTS.killGoal` 합계 80 → **240**, `HP_ANCHOR_STAGE_11`
 *     2.2 → **4**, `HP_ANCHOR_STAGE_21` 4.5 → **22**, `eliteCount` 밴드0 0 → **1**.
 *  3. **전리품 축**(`src/sim/drops.ts` · `data/planets/index.ts`) — 유니크 base 확률 재조정.
 *
 * **invasion 배열은 손대지 않았다 — 재녹화 전후 바이트 완전 동일**(29,222 bytes). 이번에는
 * 그것이 관측이 아니라 **설계**다: `xpToNext` 를 침공에서 갈라 레인 이전 값(`10+6L`)으로
 * 되돌렸고(`src/sim/world.ts` 의 `xpToNextInvasion`), 나머지 축은 전부 침공에 닿지 않는다 —
 * 드랍·`eliteCount`·품질 곡선은 `!designedRun` 이라 `updateWaves` 가 안 돌고, `HP_ANCHOR_*` 는
 * `stageHpMult` 미사용, `stageMetaXpMult` 는 침공 stage 1 이라 ×1 이다.
 *
 * 물증 셋:
 *  · **AC1(PvE) 12건 전부 실패 · AC2(invasion) 6건 전부 통과** — 재녹화 **직전** 이 파일의
 *    실측이다. 갈린 배열이 PvE 뿐임을 이 게이트 자신이 먼저 보고했다.
 *  · 재녹화본을 스크래치에 먼저 뽑아 커밋본과 대조: **invasion 29,222 bytes 바이트 동일 ·
 *    PvE 12/12 런 전부 갈림**.
 *  · `bc73201`(레인 이전) detached 워크트리와 침공 per-tick 해시 대조: 시드 기지
 *    #1·#8·#12·#16·#20 × 승패가 갈리는 시드, 합계 **48,477틱 · 520,844 bytes 완전 일치**.
 *
 * **그래도 `verify-invasion` EF 재배포는 필요하다** — 3·4차와 같은 이유이고, 루트 `README.md`
 * `## 서버 배포` 가 명시한 규율이다: **골든 바이트 불변은 EF 재배포 불필요의 근거가 못 된다.**
 * 번들 소스가 바뀌었으면 번들도 바꾼다.
 *
 * ## ⚠️ 2026-07-27 (7차) — **재녹화하지 않았다** (실드 국면 코어 관통 수정)
 * `fix/invasion-shielded-core-blocks-bullets` 가 아군탄 명중 루프에 한 줄을 넣었다: 실드 발생기
 * 국면의 코어(`timer === 1`)는 아군탄을 **통과시킨다**(피해 0 · 관통 미소비). AC1·AC2 **18건
 * 전부 통과** — 두 골든 배열 모두 손대지 않았고 재녹화도 하지 않았다.
 *
 * 이번에는 그 불변이 **구조적으로 보장된다**(관측이 아니다). 새 분기는 `core` kind + `timer === 1`
 * 이라는 두 조건에 동시에 걸리는데,
 *  · `core` kind 는 `invasion/coreRoom.ts` 의 `spawnInvasionCore` 한 곳에서만 생기고 그 호출자는
 *    `enterCoreRoom`(L3 진입 틱) 하나뿐이다 → **PvE 에는 코어 엔티티 자체가 없다.**
 *  · `timer === 1` 은 살아 있는 실드 발생기가 있을 때만 `updateCoreShield` 가 세운다.
 *  · AC2 invasion 골든 3런은 **무입력 900틱**이라 L3 에 도달하지 못한다 → 코어가 스폰조차 안 된다.
 * 즉 두 골든이 이 변경을 못 보는 것이 정상이고, 그래서 **골든 불변이 여기서 특히 무력하다.**
 *
 * **`verify-invasion` EF 재배포는 필수다** — 3·4·6차와 같은 이유이고 이번이 가장 명백하다.
 * 이 변경은 **실제 침공에서 L3 실드 발생기 국면에 들어간 모든 런의 sim 을 바꾼다**(수정 전
 * 96시드 실측으로 기지 #12 의 61.5%가 100%로 갈렸다). 서버가 옛 sim 을 들고 있으면 정상
 * 리플레이가 전부 거부된다. 골든이 조용한 것은 골든이 그 구간을 안 밟기 때문이지 sim 이
 * 안 바뀌어서가 아니다.
 *
 * ## ⚠️ 2026-07-28 (8차) — PvE·invasion 을 **둘 다** 재녹화했다 (공간 해시 broad-phase 수정)
 * `fix/spatial-hash-large-radius-broadphase` 가 `src/sim/collision.ts` 의 broad-phase 결함을
 * 고쳤다. `SpatialHash.insert` 는 엔티티를 **중심 셀 한 칸**에만 넣는데 `query` 는 **탐침
 * 반경**으로만 셀을 훑어서, 접촉 조건(`중심거리 <= 탐침반경 + 엔티티반경`) 중 **엔티티 반경
 * 만큼의 띠가 broad-phase 에서 통째로 빠져 있었다.** 즉 적·탄·해저드가 셀 경계 너머에서
 * 판정을 흘리고 있었고, 이제 흘리지 않는다.
 *
 * `resolveCollisions` 는 PvE 와 침공이 **공유**하는 경로라 두 배열이 함께 움직였다.
 * 재녹화 **직전** 실측(현 코드 vs 커밋된 기준선): **AC2(invasion) 3/3 전부 갈림 ·
 * AC1(PvE) 12건 중 11건 갈림**(`berdan-engage/mixed-three` 만 우연히 일치).
 *
 * **3·4·6차와 갈리는 지점이 여기다.** 그 세 세대에서는 invasion 배열이 바이트 동일이라
 * "골든이 그 구간을 안 밟는다" 는 단서를 따로 붙여야 했다. 이번에는 **무입력 900틱 침공 런
 * 3개가 전부 갈렸다** — 셀 경계 누락은 특정 국면(벽·다중 명중·L3 실드)에서만 나는 것이 아니라
 * **모든 틱의 모든 접촉 판정**에 걸려 있었다는 직접 증거다. 결함의 파급이 그만큼 넓었다.
 *
 * **`verify-invasion` EF 재배포는 필수다** — 이번엔 골든 자신이 그렇게 보고한다(위 3/3).
 * 상세·분리 실측은 `.omc/research/spatial-hash-large-radius-broadphase-2026-07-28.md`.
 *
 * ## ⚠️ 2026-08-04 (9차) — PvE·invasion 을 **둘 다** 재녹화했다 (5레인 통합)
 * 갈린 원인은 **하나**다: 발사 간격이 정수 틱(`fireCooldown`)에서 **1/256틱 고정소수점**
 * (`fireCooldownQ`)으로 바뀌었다(밸런스 큐 §R39). `autoAttack` 이 `player.cooldown` 을 매 틱
 * `FIRE_CD_Q` 씩 깎고 발사 시 잔여분을 보존한 채(`+=`) 간격을 더하므로, 간격이 `FIRE_CD_Q` 의
 * 배수가 아닌 순간부터 **발사 틱이 재배치된다** → 명중 틱이 갈리고 그 뒤 전개가 통째로 갈린다.
 * `resolveCollisions` 는 PvE·침공 **공유** 경로이므로 두 배열이 같은 이유로 함께 움직였다
 * (5차·8차와 같은 부류이고, "서로 다른 이유로 갈린" 5차와는 다르다).
 *
 * ⚠️ **여기에는 부채가 섞여 있다.** 재녹화 직전 이 파일은 15건이 깨져 있었는데 그중 **10건은
 * `074ec88`(main)에서 이미 깨져 있던 것**이다 — main 이 그 뒤로 sim 판정·페이싱·조준을 여러
 * 차례 정당하게 바꾸면서(밸런스 큐 §R11~§R17) 골든을 그때마다 재생성하지 않아 쌓인 빚이다.
 * 이번 재녹화가 그 빚까지 함께 갚는다. **다음 sim 변경 때는 같은 회차에 재생성해라** — 골든이
 * 오래 깨져 있으면 "무엇이 언제 갈렸는가"를 잃고, 그러면 진짜 회귀와 구분할 수 없다.
 *
 * **`verify-invasion` EF 재배포는 필수다** — invasion 배열이 실제로 갈렸다(3/3). 서버가 옛
 * sim 을 들고 있으면 정상 침공 리플레이가 전부 거부된다.
 *
 * ## 왜 PvE 는 `seg3Tick` 앞까지만 대조하나
 * 중반 격전은 **매 런 등장**이라 PvE 비-invasion baseline 해시를 의도적으로 바꾼다(AC3 —
 * `tests/fixtures/striker-prem8.json` 골든 재생성으로 흡수). 다만 격전 세그먼트는 **중반
 * (index ≥ 1)** 에만 삽입되므로 세그먼트 0~2 구간의 sim 은 삽입 전과 완전히 동일하다. 그 구간의
 * 바이트 일치가 곧 "조우 도입이 한 바이트도 새지 않았다" 는 증명이다.
 *
 * ## 왜 조우가 실제로 발생한 런은 제외하나
 * 조우가 발생하면 `encounterRuntime` 이 서고 조건부 꼬리 폴드가 **켜지는 것이 정상**이다
 * (그게 설계다). 그런 런까지 기준선과 같기를 요구하면 폴드가 아예 없어야 한다는 뜻이 되어
 * 계약과 모순된다. 그래서 대조 대상은 `encounterRuntime === undefined` 인 런으로 한정하고,
 * "그런 런이 최소 1개는 있어야 한다"(=대조가 공회전이 아니다)를 별도로 단언한다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createWorld, stepWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { InputFrame } from '../src/sim/world.js';
import { hashWorld, idleInputs } from '../src/sim/replay.js';
import {
  ENCOUNTER_BASELINE_FORMAT,
  ENCOUNTER_BASELINE_PATH,
  PVE_BASELINE_TICKS,
  INVASION_BASELINE_TICKS,
  makeInvasionState,
} from '../scripts/recordEncounterBaseline.js';
import type { EncounterBaseline } from '../scripts/recordEncounterBaseline.js';
import {
  BASELINE_PLANETS,
  BASELINE_BUILDS,
  baselineConfig,
  driveBaseline,
} from '../scripts/recordStrikerBaseline.js';
import type { BuildSpec } from '../scripts/recordStrikerBaseline.js';

// tests/node-shims.d.ts 의 readFileSync 는 encoding 오버로드가 있지만, 다른 골든 테스트와
// 같은 방식으로 디코드해 일관성을 유지한다.
const BASELINE: EncounterBaseline = JSON.parse(
  new TextDecoder().decode(readFileSync(ENCOUNTER_BASELINE_PATH)),
) as EncounterBaseline;

describe('조우 기준선 픽스처', () => {
  it('포맷·규모가 녹화기 계약과 일치한다', () => {
    expect(BASELINE.meta.format).toBe(ENCOUNTER_BASELINE_FORMAT);
    expect(BASELINE.meta.pveTicks).toBe(PVE_BASELINE_TICKS);
    expect(BASELINE.meta.invasionTicks).toBe(INVASION_BASELINE_TICKS);
    expect(BASELINE.pve.length).toBe(BASELINE_PLANETS.length * BASELINE_BUILDS.length);
    expect(BASELINE.invasion.length).toBeGreaterThan(0);
  });
});

describe('AC2 — invasion per-tick 해시 회귀 가드 (기준선: ADR-0034 이후)', () => {
  for (const run of BASELINE.invasion) {
    it(`${run.key} 가 기준선과 바이트 동일하다`, () => {
      const state = makeInvasionState(run.seed);
      const inputs = idleInputs(run.ticks);
      const hashes: number[] = [];
      for (let t = 0; t < inputs.length; t++) {
        stepWorld(state, inputs[t] as InputFrame);
        hashes.push(hashWorld(state));
      }
      expect(hashes.length).toBe(run.hashes.length);
      // 첫 발산 지점을 정확히 보고한다(전체 배열 diff 는 900칸이라 읽을 수 없다).
      const firstDiff = hashes.findIndex((h, i) => h !== run.hashes[i]);
      expect(firstDiff, `첫 발산 틱 (기대: 발산 없음)`).toBe(-1);
    });
  }

  it('침공 config 로 만든 월드에는 조우가 서지 않는다(PvE 전용 게이트)', () => {
    // 위 대조 하네스는 `createWorld` **뒤에** invasion3 를 싣는다(해시 폴드만 보려는 관측용).
    // 실제 침공 경로는 config 에 invasion3 를 **미리** 실은 채 createWorld 를 부르므로,
    // `cfg.invasion3 === undefined` 게이트가 조우 롤을 막는지는 그 형태로 확인해야 한다.
    const seed = BASELINE.invasion[0]!.seed;
    const inv3 = makeInvasionState(seed).config.invasion3;
    expect(inv3).toBeDefined();
    const invasionWorld = createWorld(seed, {
      ...DEFAULT_CONFIG,
      invasion3: inv3 as NonNullable<typeof inv3>,
    });
    expect((invasionWorld as { encounterRuntime?: unknown }).encounterRuntime).toBeUndefined();
  });
});

describe('AC1 — 조우 미발생 PvE 런의 per-tick 해시 바이트 불변 (중반 격전 이전 구간)', () => {
  for (const [planetIndex, planet] of BASELINE_PLANETS.entries()) {
    for (let b = 0; b < BASELINE_BUILDS.length; b++) {
      const build = BASELINE_BUILDS[b] as BuildSpec;
      const key = `${planet.id}/${build.id}`;
      const run = BASELINE.pve.find((r) => r.key === key);
      it(`${key} — 세그먼트 0~2 구간이 조우 도입 전과 바이트 동일하다`, () => {
        expect(run, `기준선에 ${key} 런이 없다`).toBeDefined();
        const baseRun = run as NonNullable<typeof run>;
        void planetIndex;
        const config = baselineConfig(planet, build.invest);
        const inputs = driveBaseline(baseRun.seed, config, baseRun.ticks);
        const state = createWorld(baseRun.seed, config);
        const encounterPresent =
          (state as { encounterRuntime?: unknown }).encounterRuntime !== undefined;
        const hashes: number[] = [];
        for (let t = 0; t < inputs.length; t++) {
          stepWorld(state, inputs[t] as InputFrame);
          hashes.push(hashWorld(state));
        }
        if (encounterPresent) {
          // 조우가 실제로 발생한 런: 조건부 꼬리 폴드가 켜지는 것이 설계다. 대조 대상이 아니다.
          // 대신 "폴드가 정말 켜졌다"(=기준선과 첫 틱부터 갈린다)를 확인해 조용한 무폴드 회귀를 잡는다.
          expect(hashes[0]).not.toBe(baseRun.hashes[0]);
          return;
        }
        // 중반 격전이 개입하기 전까지만 대조한다(seg3Tick < 0 이면 런 전체).
        const limit = baseRun.seg3Tick < 0 ? baseRun.hashes.length : baseRun.seg3Tick;
        expect(limit).toBeGreaterThan(0);
        const firstDiff = hashes
          .slice(0, limit)
          .findIndex((h, i) => h !== baseRun.hashes[i]);
        expect(firstDiff, `첫 발산 틱 (기대: 발산 없음, 대조 구간 0..${limit})`).toBe(-1);
      });
    }
  }

  it('조우 미발생 런이 최소 1개 대조된다(공회전 방지)', () => {
    // ⚠️ 위 `it` 들이 세는 카운터에 의존하지 않는다 — 그러면 선언 순서(순차 실행)에 묶여
    // `--sequence.concurrent` 로 돌릴 때 잘못 통과/실패한다. 대신 여기서 독립적으로 다시
    // 판정한다. `createWorld` 만 하면 되므로(스텝 불필요) 비용이 거의 없다.
    const absent = BASELINE.pve.filter((run) => {
      const planet = BASELINE_PLANETS.find((p) => run.key.startsWith(p.id + '/'));
      const build = BASELINE_BUILDS.find((b) => run.key.endsWith('/' + b.id));
      if (planet === undefined || build === undefined) return false;
      const world = createWorld(run.seed, baselineConfig(planet, build.invest));
      return (world as { encounterRuntime?: unknown }).encounterRuntime === undefined;
    });
    expect(absent.length).toBeGreaterThan(0);
  });
});
