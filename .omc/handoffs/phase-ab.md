# Phase A+B 핸드오프 (무한 좌표 기반화 + SpatialHash 무한화 + 카메라 렌더)

- 브랜치: `feat/scroll-map-gimmicks` / 구현: Phase A(A1~A4), Phase B(B1~B5)
- 검증: `npx tsc --noEmit` 통과, `npm test` 59개 전부 통과, `npx eslint` 0건, `vite build` 성공, 브라우저 스모크(카메라 추적·음수 좌표 이동·콘솔 에러 0) 확인.

## Decided (확정 사항 — 후속 Phase가 의존)
- **상수명**: `ARENA_WIDTH/HEIGHT` → `VIEW_WIDTH/VIEW_HEIGHT` (값 1920/1080 유지). `src/sim/constants.ts`.
  `WorldConfig.arenaWidth/arenaHeight` 필드명은 **불변**(replay 해시 레이아웃 안정). DEFAULT_CONFIG가 VIEW_* 를 담음.
- **플레이어 시작 좌표 = (0,0)** (`world.ts` createWorld). 무한 맵 자연 원점.
- **투사체 컬 반경 상수**: `PROJECTILE_CULL_RADIUS`(`src/sim/world.ts`, export 아님, 모듈 상수).
  = `Math.sqrt(VIEW_W² + VIEW_H²) * 1.5` ≈ **3304u**. `stepProjectiles(state, player)` 가 수명 or 플레이어 상대 거리>컬반경이면 despawn. 컬 반경 > 향후 스폰 링 반경이어야 화면 진입 전 조기 소멸 없음 — **Phase C 스폰 링 반경 상수화 시 이 3304 미만으로 잡을 것**.
- **SpatialHash 시그니처 변경**: `new SpatialHash<T>(cellSize)` (width/height 인자 제거). `Map<number,T[]>` 버킷.
  cellKey = 각 축 Szudzik 폴드(`z>=0?2z:-2z-1`) 후 `((a*73856093)^(b*19349663))>>>0`. query의 (cy,cx) 순회·삽입순서 결정론 유지. `world.ts`의 grid 생성 반영 완료.
- **스냅샷 카메라**: `WorldSnapshot`에 `cameraX/cameraY` append(= 플레이어 좌표, sim은 카메라 상태 없음). replay 해시엔 영향 없음(WorldState 아님).
- **렌더 카메라**: `entityRenderer.render`가 보간 카메라로 `layer.position = (960-camX, 540-camY)` 설정(`DESIGN_WIDTH/HEIGHT` from `render/app.js`). 스프라이트는 절대 좌표 유지, 레이어만 평행이동.
- **배경**: `main.ts`에서 `background.tilePosition.set((-camX)%tileW, (-camY)%tileH)` — f64 모듈로 후 대입(f32 UV swim 방지). tileW/H = `background.texture.width/height`(256).
- **조준 좌표**: `controller.sample`가 마우스 design 좌표 → 월드 좌표(`design - 뷰포트중심 + player`)로 변환 후 aim 계산. `clientToDesign`(app.ts)은 카메라 무지라 미수정 — 카메라 역오프셋은 controller에서 처리(playerX/Y가 곧 카메라).

## Rejected (의도적으로 안 한 것)
- `app.ts clientToDesign` 자체엔 카메라 오프셋 미주입(렌더 계층이 sim/카메라를 모름 → controller에서 처리가 정합).
- 원점 리베이스(옵션B) 미구현 — M1 도달 범위(<5×10⁵u)에서 f64 정밀도 무해. 초장기 대비 안전판으로만 문서화.

## Risks / 주의
- **전환기 기하 불일치**: 플레이어는 (0,0), 스폰은 아직 **아레나 절대 좌표(≈960,540)** — Phase C 미완이라 그대로. 그 여파로 `tests/progression.test.ts`의 원점-랜덤워크 파일럿이 젬을 못 주워 레벨업 실패 → 파일럿을 "최근접 적 추격"으로 수정(기하 비의존, 결정론 유지). **Phase C 스폰 상대화 완료 후에도 이 파일럿은 그대로 유효**.
- cellKey 해시 충돌 시 서로 다른 셀이 한 버킷 → 오검출은 없음(정확 거리 재검사 존재), 성능만 저하. 벤치(G3)로 확인 권장.
- 카메라==플레이어라 aim이 뷰포트중심 기준과 수학적으로 동일. 카메라를 플레이어와 분리(리드/데드존)하면 controller의 world 변환은 유지되나 재검토 필요.

## Files (변경)
- `src/sim/constants.ts`, `src/sim/world.ts`, `src/sim/collision.ts`, `src/sim/snapshot.ts`
- `src/render/entityRenderer.ts`, `src/render/app.ts`(무변경, import원), `src/main.ts`, `src/input/controller.ts`
- `tests/collision.test.ts`(생성자 시그니처 + 음수/원거리 셀 테스트 추가), `tests/progression.test.ts`(파일럿 추격 수정), `tests/projectiles.test.ts`(신규, A3 컬링 검증)

## Remaining (후속 Phase C~F 워커가 알아야 할 것)
- Phase C: 웨이브/보스/보급선/해저드 라인 스폰을 플레이어 상대 화면밖 링으로. 스폰 링 반경 상수화(< PROJECTILE_CULL_RADIUS 3304). C5(돌격병 fragments 재훅)은 `patterns/index.ts` — **Phase A/B는 patterns/index.ts·boss.ts·waves.ts 미개조**(charger 아레나 바운스 fragments 여전히 유효, combat.test.ts:105 통과 유지).
- Phase E/F: 신규 kind는 `KIND_CODE` 9+ append. 벽 AABB 필드 = 반너비 `radius`, 반높이 `targetX`(E1 단일 소스). SpatialHash는 점 엔티티 전용 — 대형 벽은 활성 벽 배열 직접 순회(F1).
- 신규 WorldState 필드는 `hashWorld`에 append-only(`replay.ts`).
