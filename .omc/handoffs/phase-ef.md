# Phase E+F 핸드오프 (청크 절차 배치 엔진 + 기믹 4종)

- 브랜치: `feat/scroll-map-gimmicks` / 구현: Phase E(E1~E4), Phase F(F1~F4)
- 검증: `npx tsc --noEmit` 통과, `npx eslint src data tests` 0건, `npx vitest run` 75개 전부 통과(신규 16개), `npx vite build` 성공, 브라우저 스모크(플레이어 x≈3000까지 로밍 시 wall/destructible/bombDevice/hazard 생성·렌더, 콘솔 에러 0, 벽 비정방 sprite 176×282 확인).

## Decided (확정 — 후속 G 워커가 의존)
- **신규 kind + KIND_CODE(append)**: `wall`=9, `destructible`=10, `magnetEmitter`=11, `bombDevice`=12, `turretPickup`=13 (`entities.ts`, 1~8 불변). 해시 레이아웃 불변(제네릭 필드 재사용).
- **벽 AABB 단일 소스**: `radius`=반너비, `targetX`=반높이 (`entities.spawnWall` + `los.ts` 주석에 못박음). 슬라이드·LOS·탄 차단 모두 이 두 필드만 읽음.
- **신규 파일**:
  - `src/sim/chunks.ts` — 순수 배치. `CHUNK_SIZE=1024`, `SAFE_CHUNK_RADIUS=1`, `CHUNK_GEN_RADIUS=2200`, `CHUNK_CULL_RADIUS=3000`(히스테리시스: **컬>생성**으로 경계 진동 방지), `MAX_ACTIVE_GIMMICKS=48`(활성 기믹 상한). `chunkRngFor=worldRng.fork('chunk:cx:cy')`(fork는 worldRng advance 안 함 → 좌표 순수 함수). `chunkPlacements(worldRng,cx,cy)`가 0~3개 descriptor 반환(원점 안전지대는 빈 배열).
  - `src/sim/los.ts` — 벽 기하 primitive: `wallHalfW/H`, `circleOverlapsWall`(정확 nearest-point), `slideCircleWalls`(축별 최소침투 슬라이드, 배열 순서 결정론), `segmentIntersectsWall`(Liang-Barsky), `segmentBlocked`.
  - `src/sim/events.ts` — 이벤트 3종: `triggerMagnetEmitter`(버프 타이머), `triggerBombDevice`(반경 내 적 피해+적탄 소거), `activateTurret`/`isActiveTurret`. 상수: `MAGNET_BUFF_TICKS=600`,`MAGNET_BUFF_MULT=3`,`BOMB_RADIUS=520`,`BOMB_DAMAGE=60`,`TURRET_LIFE_TICKS=600` 등.
- **신규 WorldState 필드**: `worldRng`(=rng.fork('world'), advance 안 함), `magnetBuffTicks`(number), `generatedChunks: Map<number,true>`(스크래치, 해시 제외), `activeWalls: Entity[]`(스크래치, 해시 제외, 매 틱 entity-array 순서 재구축).
- **해시 append 지점(`replay.ts`)**: `supplyRng` 다음에 `worldRng.getState()`, `magnetRadius` 다음에 `magnetBuffTicks`. (append이므로 M1 리플레이와는 분기 — 의도된 포맷 범프. 2회 재현 일치는 유지.)
- **stepWorld 신규 순서**: `activateChunks` → `rebuildActiveWalls` → (기존) stepPlayer … autoAttack → **stepTurrets** → stepProjectiles …. 벽이 이동 이전에 존재하도록 청크 활성화를 최상단 배치.
- **컬링 규약(E4/OQ1 (a))**: 기믹은 **청크 중심 거리** 기준 컬(한 청크 기믹은 동시 컬 → 부분 재생성 없음). 컬 시 chunk marker 삭제 → 재진입 시 순수 재생성. 파괴/소비 상태는 소실 허용(문서화됨).
- **LOS(F1c)**: `activeWalls` 없으면 기존 최근접(무할당 fast-path 그대로 — 기존 테스트 의미 보존). 있으면 후보 거리순 정렬(동거리 tie-break `id` 오름차순) 상위 `LOS_MAX_CANDIDATES=6`만 벽 교차 검사, 첫 비가림 반환("가려진 후보 제외 후 최근접"). 전부 가림이면 미발사.
- **F1a 벽 슬라이드**: 플레이어(stepPlayer)·적(`patterns/index.ts` moveCharge/integrate) 모두 슬라이드. **돌격병이 벽 슬라이드 hit 시 `chargerHitWall` 주 트리거 발동**(호출처 신설 — phase-cd에서 export만 돼 있던 것 연결). 대시 최대 ~59u/tick < 벽 최소 전폭 120u → 터널링 없음(테스트로 검증).
- **F1b 탄 차단**: `stepProjectiles`에서 `activeWalls` 직접 순회(SpatialHash 미사용) 양측 탄 소거.
- **F2 지형 해저드**: 기존 hazard kind 재사용. 영구형은 `life=-1`(telegraph 없음). `stepHazards`에 `life<0` 영구 분기 추가, `hazardActive`=`timer<=0 && life!==0`. 청크 컬 대상은 hazard 중 `life<0`만(적 mortar/lava는 제외).
- **F3 파괴물**: `grid.insert` 목록 + friendly bullet 타깃에 `destructible` 추가. hp 소진→compact에서 `spawnGem`(hp>0 컬은 드랍 없음). 이동 통과(OQ2 (b) — activeWalls 미포함).
- **렌더**: `snapshot.ts`에 `aabbH`(벽 반높이) 필드 추가 + 영구 hazard active 반영. `textures.ts` placeholder 5종(벽=단위 사각 stretch, 나머지 도형). `entityRenderer.ts` textureFor 5케이스 + **벽은 exact AABB(ART_SCALE 미적용, radius×2, aabbH×2)**, 나머지는 radius×2×ART_SCALE, 신규 kind 전부 fixedFacing.

## Rejected / 미변경 (의도적)
- SpatialHash에 벽 삽입 안 함(대형 벽 broad-phase 누락 방지 — activeWalls 직접 순회).
- 파괴물/이벤트 소비 상태 영속화 안 함(OQ1 (a) 순수 재생성). 정수-오프셋 리베이스 미구현.
- 밸런스 수치(웨이브 예산·보스 HP·기믹 밀도/피해)는 1차값 — 재미 게이트 후속 튜닝 대상.

## Risks / G 워커 검증 항목
- **활성 영역 기믹 상한(MAX_ACTIVE_GIMMICKS=48)** 도달 시 먼 청크 생성 보류(스캔 순서 고정 (cy 외곽, cx 내곽)) — 결정론이나 근접 우선순위는 아님. 벤치(G3)로 프레임 예산 확인.
- **원점 인근 ambient 기믹**: 안전지대는 Chebyshev 1(청크 -1..1)뿐이라 GEN_RADIUS 내 청크(-2,0)/(0,±2) 등은 원점 ~1500u 밖에서 기믹 생성. 화면 밖이라 즉사 위험 없음이나, 테스트는 `countKind` 대신 개별 엔티티 참조로 격리해야 함(신규 테스트가 그리 작성됨).
- **결정론**: `determinism.test`(idle 600틱)는 원점=기믹 없음 구간이라 로밍 결정론을 직접 커버 못함 → `chunkDeterminism.test`에 로밍 12초 2회 해시 일치 스모크 추가. G2는 기믹·LOS·컬링·재생성 포함 장시간 로그로 확장 권장.
- **경로 독립(AC3)**: `chunkPlacements` 순수성(좌표별·호출순서 무관) 스모크만 추가. 정렬된 `(kind,x,y)` placement digest 동등 비교(서로 다른 경로 도달)는 G1/`chunkDeterminism.test` 확장으로 정식화 필요.
- **벤치(G3)**: 무한 그리드+벽 LOS/슬라이드+컬링 부하 미측정. cellSize 128 vs 256 A/B, 2000탄 60fps 확인 남음.
- 컬 반경 밖 재진입 시 파괴물/포탑이 온전 부활(OQ1 (a)) — 의도. e2e 육안 시 인지.

## Files (변경)
- 신규: `src/sim/chunks.ts`, `src/sim/los.ts`, `src/sim/events.ts`, `tests/walls.test.ts`, `tests/gimmicks.test.ts`, `tests/chunkDeterminism.test.ts`
- 수정: `src/sim/entities.ts`(E1+factory), `src/sim/world.ts`(E3/E4/F1~F4 통합), `src/sim/patterns/index.ts`(F1a 슬라이드+charger 트리거), `src/sim/replay.ts`(해시 append), `src/sim/snapshot.ts`(aabbH+영구 hazard), `src/render/textures.ts`(5종 placeholder), `src/render/entityRenderer.ts`(5케이스+벽 AABB 렌더)
