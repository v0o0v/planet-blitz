# M2 Lane 3 핸드오프 — 베르단 콘텐츠·여왕 보스·유니크 5점·세리머니 (Phase E+F)

- 브랜치: `worktree-agent-ac1a58280044521ba` (격리 워크트리)
- 워크트리 경로: `D:\ClaudeCowork\shooting\.claude\worktrees\agent-ac1a58280044521ba`
- 베이스: `feat/m2-farming-loop` @ `55e0299`(Lane 1 Phase A+B) 위에 rebase
- 커밋(3개, 논리 단위):
  - `48954dc` feat(sim): 베르단 행성 콘텐츠 — 로스터·여왕 보스·행성 드랍 테이블 (E1~E3)
  - `a6a2fb9` feat(sim): 유니크 5점 시뮬 훅 (F1)
  - `7a46c84` feat(render): 유니크 드랍 세리머니 (F2)
- 상태: **126/126 테스트 녹색**(기존 106 + 신규 20), `tsc --noEmit`·`eslint --max-warnings 0`·`vite build` 통과. push/PR 안 함.

## Decided (채택)
- **행성 콘텐츠 레지스트리(E3)**: `data/planets/index.ts`의 `PlanetContent`(로스터·엘리트·카드풀·보스·드랍테이블·특산광물 2종)를 `planetContent(index)`로 노출. 웨이브 디렉터·`stepBoss`·`compact`가 `state.config.planet`으로 콘텐츠 선택. 새 행성 = 행 추가.
- **베르단 로스터(E1)**: 잡몹 4종(돌격 일벌레돌격체·사수 침뱉기병정·특수 산성분비샘·지원 여왕유모) + 엘리트 2종(파수병정·분열유충모체). `ENEMY_BY_TYPE` typeIndex **4~9 append**(카르곤 0~3 불변). 기존 컴포넌트 엔진(movement/attack) 재사용, 곤충 테마 튜닝.
- **WaveCard.spawns 판별 유니온**: `{role}` 또는 `{elite: number}`(정예 인덱스). additive라 카르곤 카드 불변. 베르단 후반 카드가 엘리트 스폰에 사용.
- **여왕 보스(E2)**: `data/bosses/berdan-queen.ts`(3페이즈). `boss.ts`를 행성별 `BossDef`로 일반화(카르곤 승계). `BossAttack`에 **summon**(무리개체 소환)·**aimedBurst**(과열 창/포위) 2종 append. 페이즈 전환 탄 소거는 기존 임계 로직이 자동 처리. 보스 `enemyType`에 행성 인덱스 태깅(카르곤=0 유지 → 해시 불변, 렌더 분화용).
- **행성 드랍 테이블(E3)**: `drops.ts`의 `rollEliteDrop`/`rollBossDrop`에 optional `odds: DropOdds` 4번째 인자 추가(기본=`DEFAULT_DROP_ODDS`=카르곤). `world.ts`가 `planetContent(planet).dropTable` 전달. Lane 1 테스트(3-인자 호출) 하위 호환.
- **유니크 5점(F1)**: `src/sim/uniques.ts`에 비트 인덱스(`UQ_*` 0~4)·튜닝 상수·순수 헬퍼(leaf). `data/uniques.ts`가 5 `UniqueDef` 등록(side-effect import). `loadout.ts`·`roll.ts`가 `import '../../data/uniques.js'`로 레지스트리 채움. 시뮬은 **precomputed `config.loadout.uniqueMask`만** 읽음(item 레이어 미의존).
  - ① 과열 드럼(발칸, bit0): 연속 명중 스택↑(`player.phase`), 피격 시 리셋. autoAttack 쿨다운 단축.
  - ② 분열 코어(스프레드, bit1): 아군탄 명중 시 파편 2발(마커 `ownerId=SPLIT_FRAGMENT_MARK`로 무한 연쇄 차단), 그리드 순회 뒤 스폰.
  - ③ 관통 자이로(레일건, bit2): 무한 관통(피격사 안 함) + 관통당 피해 증폭(`bullet.phase`=관통수).
  - ④ 자율 드론 베이(보조, bit3): 주기(480틱)마다 임시 포탑 소환(`spawnEventObject`+`activateTurret` 재사용). 쿨다운을 `player.ownerId`에 실음.
  - ⑤ 위상 장갑(장갑, bit4): 대시 시 무적 프레임 +16, 대시 쿨다운 ×0.7.
  - **hashWorld 레이아웃 불변**: 신규 WorldState 필드 0개. 이미 해시되는 미사용 엔티티 필드(`player.phase`/`player.ownerId`/`bullet.phase`/`bullet.ownerId`)만 재활용. 미장착 시 전부 no-op(값 불변).
- **유니크 세리머니(F2, 렌더 전용)**: `src/render/ceremony.ts` — loot rarity=unique 최초 등장 시 0.5s 슬로모+금빛 DOM 플래시. 슬로모=게임 루프 dt 배율(hit-stop). 입력 로그는 매 틱 기록 → 리플레이/해시 bit-identical.

## Rejected
- **무기 전략객체 다형성/새 패턴 컴포넌트**: 베르단 잡몹은 기존 4 attack kind 재사용(과설계 회피). 특수형 산성 장판은 `HAZARD_LAVA` 기계 재사용.
- **유니크용 신규 WorldState 필드 + hashWorld append**: 미사용 엔티티 필드 재활용으로 대체(해시 레이아웃 완전 불변이 더 안전).
- **드랍 테이블을 rollItem 출력에 반영**: 티어/변칙처럼 rarity odds에만 반영(rollItem은 source 스탬프만). 아이템 실체는 Lane 2 정산 소관.

## Risks / 주의
- **특수형 해저드 렌더**: 베르단 산성 분비샘이 `HAZARD_LAVA` 서브타입 재사용 → 렌더가 용암으로 그린다. 곤충 산성 비주얼 분화는 렌더 레인에서 해저드 서브타입 태그 추가로(엔진 변경 불필요).
- **엘리트-타입 + 어픽스 중첩**: 교전 티어에서 베르단 엘리트-타입(typeIndex 8/9)이 카드 첫 스폰이면 `makeElite` 어픽스까지 붙어 미니보스화 가능(의도적 허용, 튜닝 대상).
- **유니크 필드 재활용 가정**: `player.phase`(과열)·`player.ownerId`(드론)·`bullet.phase`(자이로)·`bullet.ownerId`(분열마커)가 다른 시뮬 로직에서 미사용임을 전제. 이 필드에 새 용도를 얹을 땐 유니크 훅과 충돌 여부 확인 필수.
- **F2 헤드리스 미검증**: 세리머니는 DOM/PIXI라 vitest 단위 테스트 없음(tsc·build로만 검증). 브라우저 육안 확인은 유니크 드랍이 필요해 미실시.
- **동시 세션 주의**: 브라우저 스모크 중 port 5180이 Lane 2 dev 서버와 충돌(내 워크트리 아님). 내 검증은 tests/build가 authoritative.

## Files
- 신규: `data/planets/berdan.ts`, `data/planets/index.ts`, `data/bosses/berdan-queen.ts`, `data/uniques.ts`, `src/sim/uniques.ts`, `src/render/ceremony.ts`, `tests/berdan.test.ts`, `tests/uniques.test.ts`
- 수정: `data/enemies.ts`(ENEMY_BY_TYPE append), `data/waves.ts`(WaveSpawn 유니온), `data/boss.ts`(BossAttack 2종·EnemyRole import), `src/sim/waves.ts`(행성 로스터/카드/summonEnemy), `src/sim/boss.ts`(행성 보스·summon/aimedBurst), `src/sim/drops.ts`(DropOdds), `src/sim/world.ts`(보스/드랍 선택·유니크 훅 5종·droneBay), `src/items/loadout.ts`·`src/items/roll.ts`(uniques side-effect import), `src/main.ts`(세리머니 배선)

## 소비 API / 좌표 (다른 레인)
- **성계 지도(Lane 2, planetSelect)**: `import { PLANETS, planetContent, BERDAN } from 'data/planets/index.js'` — `PlanetContent.{index,id,name,minerals}` 노출. 특산 광물: 카르곤=흑요석파편·용암정, 베르단=경화키틴·여왕젤리(`Mineral.{id,name}`).
- **정산(Lane 2)**: 드랍 rarity odds는 이미 `world.ts`가 행성 테이블로 판정해 `state.loot`에 반영. Lane 2는 기존대로 `rollItem(seed, RARITY_BY_CODE[rarity], {planet,tier})` 소비. 유니크 loot면 `item.uniqueId`가 5점 중 하나로 채워짐(레지스트리 자동 등록).
- **렌더 레인**: 보스 `enemyType`=행성 인덱스(0 카르곤/1 베르단)로 스프라이트 분화 가능. 베르단 잡몹 typeIndex 4~9. loot rarity 코드는 `enemyType`(3=unique → 세리머니 트리거는 이미 main.ts에 배선됨).

## Remaining (Lane 3 범위 밖)
- 세이브/정산 연결(C1·C2, Lane 2), 인벤·성계지도 UI 실물(D, Lane 2), 밸런스 튜닝(§5 — 베르단 로스터·여왕·유니크 수치는 전부 1차값), 나머지 유니크 10점(M3), 원소 어픽스 3종·상태이상(M3), 산성 해저드/보스 렌더 분화(렌더 레인).
