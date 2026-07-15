# Phase C+D 핸드오프 (스폰 상대화 + 개체 2배 스케일 + 밸런스 1차)

- 브랜치: `feat/scroll-map-gimmicks` / 구현: Phase C(C1~C5), Phase D(D1~D2). D3(에셋 재생성)은 스킵 — 도형 폴백 유지.
- 검증: `npx tsc --noEmit` 통과, `npx vitest run` 59개 전부 통과, `npx eslint src data tests` 0건, `npx vite build` 성공.

## Decided (확정 — 후속 E/F가 의존)
- **스폰 상수(공유, `src/sim/constants.ts`에 신설·export)**: `OFFSCREEN_X`(=VIEW_W/2+140=1100), `OFFSCREEN_Y`(=680), `SPAWN_RING_RADIUS`(=뷰포트 대각선/2+220≈1322), `HAZARD_LINE_SPAN`(=VIEW_W=1920), `SPAWN_MARGIN`(140). 전부 `Math.sqrt`로 로드시 1회 계산(bit-identical). **모두 PROJECTILE_CULL_RADIUS(3304) 미만** — 탄 조기 소멸 없음.
- **C1 포메이션**: `formationPositions`가 전부 플레이어 상대. ring=플레이어중심 SPAWN_RING_RADIUS 링, line=화면밖 좌우 진입, edges=4개 화면밖 가장자리, cluster=플레이어 상대 blob. `clampIn` 제거(무한). 간격 2배(line 92, cluster ±180).
- **C2 보스**: 스폰 `player.x, player.y - VIEW_HEIGHT*0.55`(화면밖 위). `moveBoss(boss, player)`로 시그니처 변경(state 제거) — 타깃 hover `player.y - VIEW_HEIGHT*0.28`, x는 플레이어 추적, 아레나 클램프 제거.
- **C3 보급선**: `maybeSpawnSupply(state, player)`·`stepSupply(state, player)` 플레이어 상대. 진입 x=`player.x ± OFFSCREEN_X`, y=플레이어 상대. despawn=`|e.x-player.x| > OFFSCREEN_X+120` 또는 life 만료.
- **C4 라인 하자드**: 용암 라인 스팬을 `HAZARD_LINE_SPAN` 고정폭·플레이어 중심(`startX = player.x - SPAN/2`)으로. patterns/index.ts `lava` + boss.ts `lavaLine` 둘 다.
- **C5 적 이동 아레나 경계 제거**: (a) `integrate()` 원점 박스 클램프 4줄 제거(무한 직진), (b) `moveCharge()` 아레나 바운스 제거.
- **C5c fragments 재훅**:
  - **보조 트리거(지금 구현)**: `moveCharge()` 내부 — `fireCooldown` 만료 시 주기 발사 + 재조준, 미발사 구간엔 플레이어 지나침(heading·(player−e)<0) 시 재조준. 결정론(위치·타이머만).
  - **주 트리거 훅 포인트(F1a 워커용)**: `export function chargerHitWall(state, e, def, player)` 를 `src/sim/patterns/index.ts`에 신설·**export**. 후속 F1a 벽 슬라이드 resolver가 돌격병이 기믹 벽 AABB에 슬라이드하는 순간 호출할 것(spray + 재조준, cooldown 게이트). 아직 호출처 없음.
- **D1 sim radius 2배**: player 32(`world.ts`), charger36·gunner32·lava-spring44·support30(`data/enemies.ts`), boss128(`data/boss.ts`), gem20·supply92(`entities.ts`). 렌더 placeholder(`textures.ts`) 도형 반경도 2배(bullet/explosion은 유지 — 가독성/juice).
- **D2 밸런스 1차**: 이동/탄 속도 2배 — playerSpeed720·dashSpeed2800·bulletSpeed1800(`world.ts`), 적 speed·fragments speed·supply speed 2배, boss 전탄 speed·moveSpeed 2배. 젬 자석 BASE_MAGNET_RADIUS 420·MAGNET_SPEED 1520. 하자드 반경 2배(mortar140·lava92·boss lavaLine104). 포메이션 간격 2배.

## Rejected / 미변경 (의도적)
- **웨이브 예산·보스 HP(3600)·모든 damage·bulletLife·windup·counts 유지** (D2 범위 밖 — 후속 튜닝 대상).
- **탄(bullet/enemyBullet) radius 유지**(OQ3 기본 (a) — 가독성 규칙).
- `WorldConfig.arenaWidth/Height` 필드·`hashWorld` 레이아웃 불변. KIND_CODE 미변경.

## Risks / 후속 주의
- **dashSpeed 2800 → 임펄스 ≈47u/tick**(2배 상향분). 핸드오프 phase-ab의 "대시 ~23u/tick < 벽 두께" 전제가 깨짐 — **F1a 벽 두께 상수를 ≥ ~50u로 잡아 대시 터널링 방지** 필요(플랜 §5 벽 상수 확정 시 반영).
- **미튜닝 잔여(후속 밸런스 루프)**: 웨이브 예산(적/탄 밀도), 보스 HP, 접촉/탄 피해량, cellSize(128 vs 256). 2배 스케일로 히트박스 면적 4배 → 피탄율 상승분 미보정. 재미 게이트에서 재평가.
- fullRun 파일럿(무한맵)은 그대로 통과. 스폰이 플레이어 상대라 idle 파일럿도 교전 유지.

## Files (변경)
- `src/sim/constants.ts`(스폰 상수 신설), `src/sim/world.ts`(C2/C3/D1/D2), `src/sim/boss.ts`(C2/C4), `src/sim/patterns/index.ts`(C4/C5+chargerHitWall export), `src/sim/waves.ts`(C1/D2), `src/sim/entities.ts`(D1 gem/supply)
- `data/enemies.ts`(D1/D2), `data/boss.ts`(D1/D2)
- `src/render/textures.ts`(D1 placeholder 반경)
- `tests/combat.test.ts`(charger fragments 테스트를 오픈 구간 주기 발사로 의미 보존 갱신 — C5 검증)
