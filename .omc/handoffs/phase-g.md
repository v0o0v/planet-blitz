# Phase G 핸드오프 (검증 완성 — 테스트 보강 · 결정론 게이트 · 벤치 · 브라우저 e2e)

- 브랜치: `feat/scroll-map-gimmicks` / 구현: Phase G(G1~G4)
- 최종 게이트: `npx tsc --noEmit` 통과, `npx eslint src data tests` 0건, `npx vitest run` **80개 전부 통과**(신규 +5), `npx vite build` 성공, 헤드리스 sim 벤치 통과, 브라우저 e2e 콘솔 에러 0.

## AC 충족 근거 표

| AC | 내용 | 충족 근거 |
|---|---|---|
| AC1 | 무경계 이동·카메라 추적·심리스 배경 | 브라우저 e2e: 플레이어 (0,0)→(3704,-2223)→원거리 이동, 카메라=플레이어(화면 중앙 고정), 배경 타일 스크롤. 스크린샷 `scroll-map-01/02/03`. 카메라 오프셋 단위검증은 기존 스위트(snapshot cameraX/Y). |
| AC2 | 결정론(기믹·LOS·청크 포함 2회 해시 일치) | `determinism.test.ts` 신규 "long roaming run"(40초, 원점 밖 대각 드리프트+대시, 기믹/벽/LOS/청크 컬·재생성 발동) 2회 틱별 해시 100% 일치. 기존 idle/active + `chunkDeterminism` 로밍 12초도 유지. |
| AC3 | 경로 독립 배치(정렬 `(kind,x,y)` digest) | `chunkDeterminism.test.ts` 신규 "different paths → identical digest": 동일 시드, 경로 A(우→상)·B(상→우)로 실제 월드 구동 후 청크별 `(kind,x,y,radius,targetX)` 정렬 digest를 교집합 청크에서 비교, 전부 동일(entityId·삽입순서 무관). 공유 청크 >3 검증으로 vacuous 방지. 기존 순수성/순서독립 스모크도 유지. |
| AC4 | 2배 스케일 + 60fps | 브라우저: player radius 32(표시 32×2×ART_SCALE1.5=96px), enemy 36, destructible 48, gem 20, wall halfW 124. 헤드리스 벤치: 2,112탄 지속 부하에서 stepWorld **0.24 ms/tick**(예산 16.67ms의 ~70배 여유). |
| AC5 | 벽(이동 슬라이드·대시·양측 탄·LOS 다음최근접) | `walls.test.ts`: 플레이어 슬라이드/대시 무터널링/양측 탄 소거/LOS 은폐 미발사/미은폐 발사 + **신규 "가려진 최근접 제외 후 다음 최근접 발사"**(near 은폐+far 개활 → far 조준, vy>0 검증). 브라우저: 벽 AABB 안에 친탄·적탄 배치→둘 다 소거 확인. |
| AC6 | 지형 해저드 피해 | `gimmicks.test.ts` **신규 "terrain hazard"**: 영구 해저드(life<0) 위 플레이어 → hp −TERRAIN_HAZARD_DAMAGE, 해저드 잔존(life<0). 밖에 있으면 무피해. 브라우저: 갈색 원형 해저드 렌더(`scroll-map-03`). |
| AC7 | 파괴물 드랍 | `gimmicks.test.ts`(기존): 친탄으로 파괴 → gem 드랍 + 이동 통과. 브라우저: 노란 상자 렌더(`scroll-map-02`). |
| AC8 | 이벤트 3종 발동 | `gimmicks.test.ts`(기존): magnet 버프·bomb 피해+적탄소거·turret 접촉활성+자동사격+수명. 브라우저 라이브 실증: turret(phase0→1), magnet(buff 0→600, 소비), bomb(적 hp10→-50 사망+적탄 소거+소비). |
| AC9 | 런 완주(무한 맵 6구간→보스→승리) | `fullRun.test.ts`(기존 2개) 유지: segment 5 도달, boss 처치, victory=true, 승리 로그 결정론 재현 일치. |
| AC10 | 기존 스위트 의미 보존 전부 통과 | 12파일 80테스트 전부 녹색. 기존 테스트 의미 변경 없음(모두 append). |
| AC11 | src/sim 금지 심볼 0 | `grep`으로 pixi.js/Math.random/Date.now/플랫폼 trig 실사용 0건(주석의 "금지 명시"만 매치). eslint `src data tests` 0건. |

## 벤치 수치 (G3 — 헤드리스 sim, `src/bench/simBench.ts`)
- 부하: 2,300 enemyBullet 주입(warmup 후 **지속 2,112탄**) + 200 enemy + 스크롤 맵 활성(청크·활성 벽 10·LOS·벽 탄 sweep). 웨이브는 침묵(승리 조기종료 방지), 측정 3,000틱 best-of-3.
- **cellSize 128 → 0.24~0.25 ms/tick / cellSize 256 → 0.22~0.24 ms/tick** → **256 근소 우세**(약 4~5% 빠름). 둘 다 60fps 예산(16.67ms)의 ~70배 여유.
- **채택: `GRID_CELL_SIZE = 256`**(`src/sim/world.ts`, 신설 export 상수). 기존 하드코딩 `new SpatialHash(128)` → `new SpatialHash(GRID_CELL_SIZE)`. grid는 broad-phase 전용·매틱 재구축이라 **해시 무관**(결정론 불변). 2배 스케일 개체(반경 ~20~128)에 셀 128은 과세분화였음.
- 실행: `npx vite-node src/bench/simBench.ts` (PIXI 렌더 벤치 `src/bench/bench.ts`와 별개 — 이쪽은 순수 sim throughput).

## 브라우저 e2e (G4) — `.claude/launch.json` planet-blitz-dev(5180), `__pb` DEV 훅으로 구동
- 스크린샷(`C:\Users\v0o0v\AppData\Local\Temp\haru-shots\`): `scroll-map-01-origin.png`(원점 안전지대·96px 함선·심리스 배경), `scroll-map-02-gimmicks.png`(벽·자기장 발생기·파괴상자·적·양측 탄·발사·폭발), `scroll-map-03-camera-far.png`(원거리 카메라 추적·지형 해저드 2개·이벤트 장치·스크롤 배경).
- 라이브 검증: 기믹 4종 전부 생성·렌더, 이벤트 3종 발동, 벽 양측 탄 차단, 개체 2배 스케일, 콘솔 에러 0.
- **주의(도구)**: 프리뷰 탭이 백그라운드라 rAF 스로틀 → `computer{screenshot}` MCP 타임아웃. `__pb.injectInput`(1틱 스텝+렌더 DEV 훅)으로 결정론 구동 후 `canvas.toDataURL`로 캡처하는 우회가 유효.

## 수정 사항 (production 코드 변경)
- `src/sim/world.ts`: `GRID_CELL_SIZE=256` 상수 신설 + grid 생성에 적용(128→256, 벤치 우세값 채택). **로직 결함은 발견되지 않음** — sim은 정상. 이 변경은 성능 튜닝(플랜 G3 지시)이며 결정론/해시 불변.

## 발견했으나 결함 아님 (진단 기록)
- 브라우저에서 이벤트 오브젝트에 텔레포트해도 발동 안 되는 현상 → **원인은 `pendingLevelUp` 레벨업 프리즈**(stepWorld 조기 return). 로밍 중 레벨업 → 프리즈 상태에선 이동·충돌·발동 전부 정지(의도된 설계). `injectInput({special:1})`로 파워업 픽 주입해 해제 후 정상 발동 확인. **버그 아님** — 실플레이는 powerupOverlay로 처리.

## 남은 리스크 / 후속 권장
- **밸런스 미튜닝(후속 재미 게이트)**: 웨이브 예산·보스 HP·접촉/탄 피해량·기믹 밀도(`MAX_ACTIVE_GIMMICKS=48`)는 1차값. 2배 스케일 피탄율 상승분 미보정.
- **벤치 환경 편차**: 헤드리스 sim 0.24ms는 개발기 수치. 실 브라우저 렌더(PIXI ParticleContainer)까지 포함한 프레임 예산은 `src/bench/bench.ts`(?bench=1)로 별도 확인 권장(렌더 병목은 sim과 별개).
- **컬 재진입 상태 소실(OQ1 (a))**: 파괴물/이벤트 소비 상태는 컬 후 재진입 시 순수 재생성(온전 부활) — 의도. 상태 영속화는 후속.
- **에셋(D3)**: 128px 스프라이트 미교체, 도형/64px 폴백 유지. PixelLab 재생성은 후속.

## Files (본인 변경 — 이것만 커밋)
- 신규: `src/bench/simBench.ts`, `.omc/handoffs/phase-g.md`
- 수정: `src/sim/world.ts`(GRID_CELL_SIZE), `tests/walls.test.ts`(LOS 다음최근접), `tests/gimmicks.test.ts`(지형 해저드 AC6), `tests/chunkDeterminism.test.ts`(경로독립 digest AC3), `tests/determinism.test.ts`(장시간 로밍 결정론 G2)
- **미변경/미커밋(타 에이전트 소유)**: `.omc/project-memory.json`, `.omc/plans/*` (읽기 전용)
