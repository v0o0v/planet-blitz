# Planet Blitz — 무한 스크롤 맵 + 개체 2배 스케일 + 맵 기믹 구현 계획

- 상태: **pending approval (consensus approved)** (실행 승인 대기 — Critic APPROVE, 비차단 개선 5건 병합 완료)
- 생성: 2026-07-15 (`/plan` consensus/RALPLAN-DR 모드, direct)
- 근거 문서: [`.omc/specs/deep-interview-scroll-map-gimmicks.md`](../specs/deep-interview-scroll-map-gimmicks.md) (딥 인터뷰 8라운드, Ambiguity 17%), [ADR-0005](../../docs/adr/0005-deterministic-replay-verification.md), [M1 계획](./planet-blitz-m1-plan.md)
- 대상 브랜치(제안): `feat/scroll-map-gimmicks`

---

## 1. 요구사항 요약 (Requirements Summary)

M1의 고정 `1920×1080` 아레나(`src/sim/constants.ts:13-14`)를 **무한 스크롤 월드**로 전환한다. 세부:

1. **무한 맵 + 카메라 추적**: 플레이어가 경계 없이 이동, 카메라가 뱀서(뱀파이어 서바이벌)식으로 추적, 배경은 청크 타일링으로 심리스 스크롤. **런 구조(6구간 웨이브→보스→정산)는 불변** — 뱀서화(시간 생존 재설계) 명시적 거부.
2. **개체 2배 스케일**: 기체·몹·보스의 sim `radius`(히트박스)를 약 2배(기체 `16→~32`, 표시 `~96px`). 렌더 `ART_SCALE`은 자동 반영(`entityRenderer.ts:33`, 사용처 `:93`).
3. **맵 기믹 4종 전부 첫 버전 필수**:
   - 벽/엄폐물: 이동 차단 + **양측 탄 모두 차단** + 플레이어 자동 조준 **LOS(시야) 판정**(벽 뒤 적 제외) + 적 이동 벽 충돌 슬라이드.
   - 지형 해저드: 밟으면 피해(기존 `hazard` kind 재사용·통합).
   - 파괴 가능 오브젝트: 부수면 젬/자원 드랍.
   - 이벤트 오브젝트 3종: 자기장 발생기(젬 자석 반경 대폭 증가 버프), 광역 폭발 장치(주변 적 피해+적탄 소거), 임시 포탑(일정 시간 자동 사격).
4. **결정론 유지(ADR-0005, 절대 조건)**: 청크/기믹 배치는 시드 RNG(`rng.fork`)로 순수 좌표 함수화, 무한 좌표의 f64 정밀도·해시 안정성 검토 포함. 결정론 테스트(동일 시드+입력 2회 해시 100% 일치)가 CI 게이트로 유지.
5. **성능**: 탄 2,000발 60fps 벤치 기준 유지. 배경 청크 타일링, 기믹은 활성 반경 밖 컬링.

**비범위**: 뱀서화 재설계 / 적 경로탐색(A*) 고도화 / 미니맵·월드맵 UI / M2 드랍 테이블 통합.

---

## 2. RALPLAN-DR 요약 (합의 구조)

### Principles (설계 원칙)
1. **결정론은 타협 불가**: 모든 신규 좌표·기믹 배치·LOS 판정은 시드 함수 + `src/sim/math.ts` 결정론 연산만 사용. `Math.random`/`Date.now`/플랫폼 trig 금지 규율(`src/sim/` lint)을 신규 코드에 그대로 적용.
2. **최소 침습 (런 구조 불변)**: 기존 웨이브/보스/젬/파워업/보급선 로직의 *골격*은 유지하고, "절대 아레나 좌표 가정"만 플레이어 상대/무한 좌표로 치환한다. 신규 엔티티는 기존 flat `Entity` 구조(`entities.ts:39-76`)와 `KIND_CODE` 확장으로 흡수(해시 레이아웃 불변).
3. **순수 좌표 함수 배치**: 청크 내용은 (시드, 청크 좌표)의 순수 함수 — 방문 순서 독립. 이래야 어느 경로로 도달해도 동일 배치·동일 해시.
4. **관심사 분리 유지(ADR-0005)**: sim은 카메라를 모른다. 카메라·컬링·타일링은 렌더/스냅샷 계층에만. sim은 무한 좌표만 다룬다.
5. **가독성/공정성 규칙 승계**: 적탄 화이트 코어+아웃라인, 세그먼트 탄 상한(`bulletCap`) 유지.

### Decision Drivers (핵심 결정 동인, 톱3)
1. **결정론 재현성** — 무한 좌표에서도 bit-identical 해시가 CI를 통과해야 한다(최우선).
2. **구현 리스크/범위 통제** — M1 완성 코드 기반 brownfield. 재작성 대신 치환으로 회귀 표면 최소화.
3. **성능(60fps @ 2,000 탄)** — 무한 그리드·기믹·LOS가 프레임 예산을 깨지 않아야.

### Viable Options (아키텍처 갈림길)

#### ① 무한 좌표의 결정론 처리
| 옵션 | Pros | Cons |
|---|---|---|
| **A. f64 그대로 (좌표 무한 증가) ★채택** | 코드 변경 최소, 결정론 자명(bit-identical), 리베이스 이벤트 불필요 | 좌표가 아주 커지면 f64 ulp 증가 |
| B. 원점 리베이스(주기적 정수 오프셋 감산) | 좌표 영구히 작게 유지 | 리베이스 트리거·정수 오프셋 규율이 결정론 이벤트 → 복잡도↑, 청크/엔티티 좌표계 분리 필요 |
| C. 유한 큰 맵(예 100k²) | 기존 클램프/그리드 재사용 | 경계 존재 → "무한" 스펙 위배 |

**채택 A 근거 + B/C 기각 근거**: 실제 도달 범위가 유한하다. `playerSpeed=360u/s`(`world.ts:154`) + 대시(`dashSpeed=1400`)로 5~8분(≤600s) 런의 최대 이동 거리 ≈ 수십만 u(< ~5×10⁵). f64는 2⁵³까지 정수 정밀, 5×10⁵(~2¹⁹)에서 ulp ≈ 6×10⁻¹¹ u — 픽셀 이하 무의미. bit 재현은 `hashFloat`가 raw IEEE-754 비트를 비교하므로 두 실행이 같은 연산을 하면 자명히 일치. 따라서 **리베이스는 M1 런 길이에서 불필요**(B 기각), 경계 있는 유한 맵은 스펙 위배(C 기각). B(정수-오프셋 리베이스)는 향후 초장기 런 대비 *안전판*으로만 §6 리스크에 문서화하고 이번엔 미구현.

#### ② SpatialHash 무한 대응
| 옵션 | Pros | Cons |
|---|---|---|
| **A. Map 버킷 해시(`Map<정수 cellKey, T[]>`) ★채택** | 진짜 무한, 활성 반경만 점유, 현재 broad-phase·결정론 순회 규율(`collision.ts:9-14`) 그대로 재사용 | Map 할당/GC — 셀 풀링으로 완화 |
| B. 플레이어 중심 롤링 고정 그리드 | 배열 캐시 친화·무할당 | 원점 이동 인덱싱 복잡, 활성 반경 밖 엔티티 누락 |
| C. 현재 클램프 유지(`collision.ts:40-44`) | 무변경 | 무한에서 먼 엔티티가 edge 셀 1곳에 뭉쳐 O(n²) 퇴화 + 오충돌 → **정확성 결함** |

**채택 A 근거 + 기각**: 현 `SpatialHash`는 이미 "backing Map을 순회하지 않고 산술 셀키로만 접근"하는 결정론 규율을 명문화(`collision.ts:9-14`). 고정 배열을 `Map<number, T[]>`로 바꾸고 `cellIndex` 클램프를 제거하면 진짜 무한이 되며 `query`의 결정론(고정 (cy,cx) 순회, 셀 내 삽입 순서)은 보존된다. C는 무한에서 치명적 정확성 결함(기각). B는 컬링과 중복되는 이득뿐인데 인덱싱 복잡도가 커서 기각. cellSize는 128 유지하되 2배 스케일 반영해 256 후보(§5 벤치로 결정).

#### ③ LOS(시야) 조준 판정
| 옵션 | Pros | Cons |
|---|---|---|
| **A. 세그먼트–벽(AABB) 교차 레이캐스트 ★채택** | 정확, 기본 산술만(결정론), 벽=직사각 엄폐물과 자연 정합 | 후보 적×근처 벽 교차검사 |
| B. 그리드 가시성(브레젠험 라인 워크) | 넓은 맵 O(거리) | 셀 해상도 오차, 벽 형상 혼합 시 부정확 |
| C. LOS 생략 | 간단 | 스펙(벽 뒤 적 제외) 위배 |

**채택 A 근거 + 기각**: 후보 적은 무한 맵에서 "활성 상태로 존재하는 수십 마리"뿐이고(웨이브 상한), 벽도 활성 반경 내만 존재하므로 O(적×벽)이 작다. `nearestTarget`(`world.ts:440-456`)에 "후보→플레이어 직선이 임의 벽 AABB와 교차하면 스킵" 필터만 추가. B는 오차·형상 문제로, C는 스펙 위배로 기각.

> **≥2 viable option 확보**: 세 갈림길 모두 실현 가능한 대안이 2개 이상 유지됨(단일 생존 아님). 각 채택안의 대안 기각 근거를 위에 명시.

---

## 3. 수용 기준 (Acceptance Criteria)

스펙 AC를 승계·구체화(90%+ 테스트 가능):

- [ ] **AC1 (무한 이동/카메라)**: 플레이어가 어느 방향으로든 경계 없이 이동(좌표 클램프 제거, `world.ts:363-364`). 카메라가 플레이어 추적, 배경 청크가 심리스 스크롤. — 브라우저 e2e + 카메라 오프셋 단위 테스트.
- [ ] **AC2 (결정론)**: 동일 [시드+입력로그] 2회 실행 시 틱별 해시 100% 일치 — 기믹 배치·LOS·청크 생성 포함. `tests/determinism.test.ts` 확장 스위트 통과, CI 게이트 유지.
- [ ] **AC3 (경로 독립 배치)**: 서로 다른 이동 경로로 같은 청크 좌표에 도달해도 그 청크의 기믹 배치가 동일. **비교 기준 명문화**: 컬링/재생성 시 `nextEntityId` 재발급으로 entityId가 달라져 `hashWorld`(id 포함)가 분기하므로, 경로 독립 검증은 **정렬된 `(kind, x, y)` placement digest 동등성**으로 정의한다(entityId·삽입 순서 무관, 좌표·종류만 비교). 청크 내 기믹 리스트를 `(kind, x, y)`로 정렬 후 해시/문자열화해 두 경로 결과가 bit-identical. — 신규 `tests/chunkDeterminism.test.ts`(placement digest 비교 명시).
- [ ] **AC4 (2배 스케일)**: 기체 히트박스 `radius≈32`(표시 ~96px), 적·보스 동일 배율. 벤치 60fps 유지. — 상수 단위 테스트 + 벤치.
- [ ] **AC5 (벽)**: 플레이어·적 이동 벽에 차단(슬라이드, **대시 포함 — 터널링 없음**), 양측 탄 벽에서 소멸, 벽 뒤 적이 자동 조준에서 제외됨(가림 후보 필터 후 최근접)을 테스트/로그로 확인. 벽 검사는 활성 벽 배열 직접 순회(SpatialHash 우회). — 신규 `tests/walls.test.ts` (이동 차단·대시 슬라이드·탄 차단·LOS 각각).
- [ ] **AC6 (지형 해저드)**: 청크에 해저드 1종+ 결정론 배치, 밟으면 피해. — `tests` + e2e.
- [ ] **AC7 (파괴물)**: 파괴 가능 오브젝트를 부수면 젬/자원 드랍. — 단위 테스트(HP 소진→드랍).
- [ ] **AC8 (이벤트 3종)**: 자기장 발생기(magnetRadius 배율 버프·지속), 광역 폭발(반경 내 적 피해+적탄 소거), 임시 포탑(지속시간 자동 사격) 각각 가동. — 이벤트별 단위 테스트.
- [ ] **AC9 (런 완주)**: 6구간 웨이브→보스→정산 런이 무한 맵에서 크래시 없이 완주(승리 도달). — `tests/fullRun.test.ts` 무한 맵으로 갱신.
- [ ] **AC10 (기존 스위트)**: 기존 테스트 8파일(현행 통과분) 의미 보존 갱신 후 전부 통과. 아레나 좌표 하드코딩에 의존하던 테스트만 최소 수정.
- [ ] **AC11 (lint 규율)**: `src/sim/`에 `pixi.js`·`Math.random`·`Date.now`·플랫폼 trig 참조 0건 유지.

---

## 4. 구현 단계 (Implementation Steps)

> 팀 워커가 그대로 실행 가능하도록 Phase/태스크로 분해. 순서·의존 명시. Phase A→B→C→D→(E,F 병행 가능)→G. **각 태스크 후 `npm test` + `tsc --noEmit` 통과 확인**.

### Phase A — 무한 좌표 기반화 (아레나 클램프 제거) · 의존: 없음
모든 후속의 토대. 여기서 "아레나 경계" 가정을 제거하되 해시 안정 필드는 보존.

- **A1. 월드 파라미터 재해석** — `src/sim/constants.ts:13-14`, `src/sim/world.ts:137-158,224-271`
  - `ARENA_WIDTH/HEIGHT`는 삭제하지 않고 **`VIEW_WIDTH/VIEW_HEIGHT`(스폰 링·뷰포트 기준 치수)로 의미 재정의**(값 1920/1080 유지 → `hashWorld`의 `cfg.arenaWidth/Height` 해시 필드 안정). `WorldConfig`에 필드명 유지(혹은 별칭)해 `replay.ts:104-107` 해시 레이아웃 불변.
  - 플레이어 시작 좌표는 원점(0,0)으로 통일(`world.ts:233-234`의 `arenaWidth/2,height/2` 대체) — 무한 맵의 자연 원점.
- **A2. 플레이어 이동 클램프 제거** — `world.ts:363-364`
  - `clamp(...)` 두 줄 삭제 → 무한 이동. `stepPlayer`의 나머지는 유지.
- **A3. 투사체 컬링을 거리 기반으로** — `world.ts:462-475` (`stepProjectiles`)
  - 아레나 경계 despawn 검사 제거. 대신 **수명(`e.life`) + 플레이어 기준 컬 반경**(예 뷰포트 대각선×1.5, 상수화)으로 despawn. 플레이어 좌표 필요 → 시그니처에 player 전달.
  - ⚠️ **검증 항목화**: 아레나 경계 despawn을 제거하면 화면 밖으로 나간 탄이 영원히 살 수 있으므로, **플레이어 상대 컬 반경이 모든 탄(bullet/enemyBullet)을 빠짐없이 제거함**을 단위 테스트로 확인(컬 반경 밖 탄 0 유지, 무한 누적 없음). 컬 반경은 스폰 링 반경보다 커야 화면 진입 전 탄이 조기 소멸하지 않음 — §5 상수 정합 확인.
- **A4. 해시 영향 점검** — `src/sim/replay.ts:96-154`
  - 신규 state 필드 추가 전까지 해시 레이아웃 변화 0 확인(A 단계는 값 재해석뿐). `tests/determinism.test.ts` 그대로 녹색인지 확인(값이 달라도 2회 일치는 유지되어야 함).

### Phase B — SpatialHash 무한화 + 카메라 렌더 · 의존: A
- **B1. SpatialHash Map 버킷 전환 (점 엔티티 전용)** — `src/sim/collision.ts:23-80`
  - 고정 `cells: (T[]|undefined)[]` → `Map<number, T[]>`. `cellIndex` 클램프(40-44) 제거하고 `cellKey(cx,cy)`를 **음수 좌표 폴딩 강제 후 오버플로 안전 정수 조합**으로:
    - **Szudzik 비음수 폴드**를 각 축에 먼저 적용 — `fold(z) = z >= 0 ? 2*z : -2*z - 1`(음수를 홀수, 비음수를 짝수 자연수로 단사 매핑). 폴드 없이 음수 셀을 곱셈/XOR에 넣으면 `cx`/`-cx`가 충돌하거나 부호 비트가 `>>>0`에서 뒤섞여 결정론 리스크.
    - 폴드된 `(a, b)`를 큰 소수 곱 XOR(`(a * 73856093) ^ (b * 19349663)`) 후 `>>>0`, 또는 Szudzik 페어링 `a >= b ? a*a + a + b : a + b*b`로 최종 키.
  - `query`의 (cy,cx) 이중 루프·셀 내 삽입 순서 보존(결정론 규율 `collision.ts:9-14` 유지). `clear()`는 `Map.clear()`.
  - ⚠️ **해시 충돌 주의**: cellKey 충돌 시 서로 다른 셀 엔티티가 한 버킷에 → 오검출은 없으나(정확 거리 재검사 존재) 성능 저하. 충돌 낮은 페어링 함수 채택 + §5 벤치 검증.
  - ⚠️ **SpatialHash는 점(원) 엔티티 전용으로 유지** — 대형 벽(AABB)은 넣지 않는다. `insert()`는 엔티티 중심을 **단일 셀에만** 넣으므로(`collision.ts:47-57`), 셀보다 큰 벽은 인접 셀 broad-phase에서 누락되어 탄·이동·LOS 검사가 벽을 놓친다(정확성 결함). 대형 벽은 F1b의 **활성 벽 배열 직접 순회**로 처리(B1 범위 밖).
  - `world.ts:269`의 `new SpatialHash(cfg.arenaWidth, cfg.arenaHeight, 128)` 생성자 시그니처 변경(무한이므로 width/height 인자 제거, cellSize만) 반영.
- **B2. 스냅샷에 카메라 오프셋 추가** — `src/sim/snapshot.ts:41-85`
  - `WorldSnapshot`에 `cameraX, cameraY`(= 플레이어 좌표) 추가. sim은 카메라를 상태로 갖지 않음 — 스냅샷 생성 시 플레이어 위치에서 파생(관심사 분리). 절대 좌표는 그대로 담고 렌더가 오프셋.
- **B3. 렌더 카메라 추적** — `src/render/entityRenderer.ts:77-133`, `src/render/app.ts`
  - `render(prev,curr,alpha)`에서 보간된 카메라를 계산, `this.layer.position = (뷰포트중심 − 카메라)`로 전체 레이어 이동. 스프라이트는 절대 좌표 그대로 두고 레이어만 평행이동.
- **B4. 배경 청크 타일링 스크롤** — `src/main.ts:42-48`
  - `TilingSprite`를 뷰포트 전체 크기로 두고 매 프레임 심리스 스크롤(패럴랙스 계수 옵션). 고정 `DESIGN_WIDTH/HEIGHT` 크기 제거.
  - ⚠️ **f64 모듈로 후 대입 (렌더 f32 UV swim 방지)**: `tilePosition.set(-cameraX, -cameraY)` 대신 **f64 좌표를 타일 크기로 모듈로한 뒤 대입** — `tilePosition.set(-camX % tileW, -camY % tileH)`. camX가 커지면 f32 UV로 넘어갈 때 정밀도가 떨어져 배경이 미세하게 떨리는(swim) 렌더 아티팩트가 생긴다. 모듈로는 JS f64에서 수행하고 작은 값만 렌더로 넘겨 f32 손실을 회피. **이는 렌더 전용 이슈로 sim 결정론과 무관**(sim은 절대 f64 좌표 유지).
- **B5. 조준 좌표 변환 보정** — `src/input/controller.ts:61-62`, `src/render/app.ts:62-69`
  - `clientToDesign`이 카메라 오프셋을 반영하도록(마우스 클라이언트 → 월드 좌표). 현재 design-space 변환에 카메라 역오프셋 추가. aim 각도가 월드 기준이어야 자동 조준·대시와 정합.

### Phase C — 스폰 상대화 (웨이브·보스·보급선) · 의존: A
아레나 절대 좌표 스폰을 플레이어 상대/화면 밖 링으로.

- **C1. 웨이브 포메이션 플레이어 상대화** — `src/sim/waves.ts:123-190` (`formationPositions`)
  - `ring`(현 `w/2,h/2` 중심 → **플레이어 중심 + 화면 밖 링 반경**), `line`/`edges`(현 아레나 가장자리 → **플레이어 기준 화면 밖 가장자리**), `cluster`(이미 player 상대, 상수만 스케일). 스폰 링 반경 상수화(뷰포트 대각선/2 + 여유).
  - `clampIn`(`waves.ts:151-153,181-182,192-194`) 아레나 클램프 제거(무한).
  - ⚠️ **스폰 벽 겹침 방지**: 스폰 링/포메이션 위치가 활성 벽 AABB와 겹치면 적이 벽에 끼여 슬라이드로 밀려나거나 즉시 갇힌다. 스폰 좌표 산출 시 활성 벽과의 겹침을 검사해 겹치면 결정론적으로 오프셋(예 링 각도 다음 슬롯) 하거나 해당 슬롯 스킵. 검사는 활성 벽 배열(F1) 재사용. — **결정론적 오프셋 구현됨(후속 PR, fix/scroll-map-review-lows)**: `avoidWalls`(waves.ts)가 최소 관통 축으로 벽 밖(+마진)으로 최대 4회 밀고 잔여는 슬라이드에 위임(RNG 미사용).
- **C2. 보스 스폰 플레이어 근처로** — `src/sim/world.ts:387-402` (`stepBoss`)
  - `arenaWidth/2, arenaHeight*0.18` 절대 스폰 → **플레이어 기준 상대 오프셋**(예 위쪽 화면 밖). `moveBoss`(`boss.ts:92-103`)의 `arenaHeight*0.24` targetY, `clamp(...arenaWidth...)` → 플레이어 상대 hover로 치환.
- **C3. 보급선 상대 경로 횡단** — `src/sim/world.ts:499-525` (`stepSupply`,`maybeSpawnSupply`)
  - `arenaWidth/height` 기준 좌우 진입·y 범위 → **플레이어 기준 화면 밖 좌우 진입 + 상대 y**. despawn도 플레이어 상대 거리 기반.
- **C4. 해저드/보스 라인 스팬 상대화** — `src/sim/patterns/index.ts:144-163`, `src/sim/boss.ts:148-166`
  - `state.config.arenaWidth/(pillars+1)` 절대 스팬 → **플레이어 중심 고정 폭 스팬**(예 뷰포트 폭 기준 상수). 용암 라인이 무한 맵에서 화면을 덮도록.

- **C5. 적 이동 아레나 벽 제거 + 돌격병 fragments 재훅 (치명 — 무한 맵에서 공격 소멸 방지)** — `src/sim/patterns/index.ts:63-83,232-240` · 의존: A, E1(벽 kind), F1a
  - **(a) `integrate()` 원점 박스 클램프 제거/상대화** — `patterns/index.ts:236-239`의 4줄 `arenaWidth/Height` 클램프는 무한 맵에서 적을 원점 박스에 가두므로 **제거**. 적 이동 경계는 기믹 벽(F1a)만.
  - **(b) `moveCharge()` 아레나 벽 바운스 제거/상대화** — `patterns/index.ts:63-76`의 `arenaWidth/Height` 반사(bounce) 로직 제거. 돌진 방향은 스폰 시 플레이어 조준(`aimAt`, 55-57)으로 결정, 무한 직진.
  - **(c) fragments 트리거 재설계 (치명 누락 해소)** — 현재 돌격병 `fragments` 발사는 **아레나 벽 바운스에서만** 트리거됨(`patterns/index.ts:77-83`). (b)로 아레나 벽을 없애면 **fragments 공격이 영영 발사되지 않아 돌격병 위협이 소멸**한다. 해법:
    - **주 트리거 (Architect 권장)**: fragments를 **F1a 기믹-벽 슬라이드 이벤트에 훅** — 돌격병이 기믹 벽 AABB에 충돌해 슬라이드(축별 침투 해소)하는 순간 `sprayFragments` 발사(+ `aimAt` 재조준). 벽 시스템(F1a)과 통합해 "벽에 부딪히면 파편"이라는 기존 게임 감각을 무한 맵에서 재현.
    - **보조 트리거 (설계 판단 — 벽 없는 구간 대비)**: 기믹 벽이 드문 구간에서는 돌격병이 벽을 만나지 못해 여전히 fragments를 못 쏠 수 있다. 이를 대비해 **돌진 종료 조건 기반 보조 트리거**(예: 플레이어를 지나쳐 일정 거리 이탈 시, 또는 `fireCooldown` 만료 시 주기 발사)를 추가할지 **실행 시 설계 판단**한다. 기본 권장: **보조 트리거 포함**(무한 맵에서 벽 밀도에 공격성이 종속되지 않도록) — 구체 조건은 F1a 벽 배치 밀도 확정 후 튜닝. 미결은 OQ6로 기록.
  - **검증**: 벽 없는 오픈 구간에서도 돌격병이 fragments를 발사함을 단위 테스트로 확인(`walls.test.ts` 또는 `gimmicks.test.ts`). 결정론 유지(트리거 조건은 위치·타이머 함수, 입력 프레임 불요).

### Phase D — 개체 2배 스케일 + 밸런스 재튜닝 · 의존: A~C
- **D1. sim radius 2배** — `data/enemies.ts:22,38,53,68`, `data/boss.ts:80`, `src/sim/world.ts:234`, `src/sim/entities.ts:206,230`
  - 플레이어 `radius 16→32`(`world.ts:234`), charger `18→36`·gunner `16→32`·lava-spring `22→44`·support `15→30`(`enemies.ts`), boss `radius 64→128`(`boss.ts:80`), gem `10→20`(`entities.ts:206`), supply `46→92`(`entities.ts:230`). **표시는 `ART_SCALE=1.5` 자동 반영**(정의 `entityRenderer.ts:33`, 사용처 `:93`) → 기체 표시 `32×2×1.5=96px` 스펙 충족.
  - 렌더 placeholder 도형 반경(`textures.ts:41-46,148,166-167,171-175`)도 2배로(에셋 미교체 시 시각 정합).
- **D2. 밸런스 재튜닝** — §5 표의 수치 일괄 조정(별도 태스크로 상세). 충돌 면적 4배화 보정.
- **D3. (에셋, 선택/후속)** — 기체·적 128px PixelLab 재생성(`pixellab-forge` 스킬 캐시 워크플로), `assets/*.png` 교체. 미교체 시 64px 업스케일/placeholder 폴백 허용(`textures.ts:214-258`). **게임플레이 검증을 막지 않음** — 도형 폴백으로 먼저 검증.

### Phase E — 청크 절차 배치 엔진 (결정론) · 의존: A,B
- **E1. 신규 엔티티 kind + KIND_CODE 확장** — `src/sim/entities.ts:14-37`
  - `EntityKind`에 `'wall' | 'destructible' | 'magnetEmitter' | 'bombDevice' | 'turretPickup'` 추가. `KIND_CODE`에 **9,10,11,12,13 신규 코드 append**(기존 1~8 절대 renumber 금지 — `entities.ts:27` 주석). flat `Entity` 구조 재사용(신규 필드 불요 — 기존 `timer/phase/life/damage/radius/hp/targetX/Y/ownerId`로 흡수). 해시 레이아웃 불변(`replay.ts:64-90`은 kind 무관 제네릭 필드 해시).
  - 벽은 **AABB**가 필요 → **필드 재해석 확정(못박음)**: `radius` = 반너비(halfWidth), `targetX` = 반높이(halfHeight). 정사각 벽은 `targetX == radius`로 표현(별도 코드 경로 불필요). 이 매핑은 F1c LOS 세그먼트-AABB 판정이 그대로 읽는 **단일 소스**이며, 이후 어떤 태스크도 이 두 필드 의미를 재정의하지 않는다(주석으로 `entities.ts` 벽 kind 정의부에 명문화).
- **E2. 청크 좌표계 + 순수 함수 배치** — 신규 `src/sim/chunks.ts`
  - 청크 크기 상수(예 1024u). `chunkRngFor(seed, cx, cy)` = 방문 순서 **무관** 순수 파생: `worldRng.fork('chunk:'+cx+':'+cy)`(fork는 상태를 advance하지 않음 — `rng.ts:98-102`, 좌표만의 함수). 각 청크 rng로 기믹 종류·개수·상대 위치 추첨.
  - **원점 청크(플레이어 시작 주변)는 빈 안전지대**(스폰 즉사 방지).
- **E3. 청크 활성화/생성 (결정론 스캔)** — `src/sim/world.ts:284-326` (`stepWorld`에 단계 추가)
  - 매 틱, 플레이어 주변 활성 반경 내 청크 좌표를 **고정 (cy 외곽, cx 내곽) 순서**로 스캔. 미생성 청크는 `generatedChunks: Map<number,true>`(스크래치 메타, 해시 제외 — grid와 동종)로 판별 후 그 순서대로 기믹 엔티티 spawn(=`entities`에 append, `nextEntityId` 순차 → 결정론).
  - **해시 규약**: `generatedChunks`는 해시에 넣지 않되(순회 순서 리스크), 생성된 **기믹 엔티티 자체가 해시에 포함**되므로 결정론 보장. 필요 시 "생성 청크 수"만 u32로 해시.
  - ⚠️ **활성 영역 기믹 엔티티 상한 (성능 긴장 완화)**: 활성 반경 내 동시 존재 기믹 엔티티(벽·해저드·파괴물·이벤트) 총량에 **상한**을 둔다(§5 상수). 청크 배치 밀도 × 활성 반경이 커지면 벽 LOS·슬라이드·컬링 순회 비용이 프레임 예산을 잠식(성능 긴장). 상한 도달 시 결정론적 규칙(예 청크 스캔 순서상 먼 청크 기믹 생성 보류)으로 캡. E4 컬 반경 타이트화와 함께 활성 개체 수를 바운드.
  - `WorldState`에 `worldRng`(= `rng.fork('world')`, `world.ts:239-246`에 추가) + `generatedChunks` 추가. `worldRng` 상태는 **fork만 하고 advance 안 하므로** 해시에 넣어도 불변이지만, 일관성 위해 `hashWorld`에 `worldRng.getState()` 한 줄 추가(다른 rng와 대칭, `replay.ts:99-102`).
  - **activeWalls 순서 결정론**: E3가 생성하는 벽 엔티티는 `entities` 배열에 `nextEntityId` 순으로 append되며, F1의 활성 벽 배열(`activeWalls`)은 이 `entities` 순서를 그대로 재구축한다(grid와 동종 규율 — 별도 정렬 없음). 청크 스캔 순서(고정 (cy 외곽, cx 내곽))는 "어떤 벽이 생성되는지"만 결정하고, "생성된 벽을 어떤 순서로 순회하는지"는 항상 entity-array 순서로 일원화한다.
- **E4. 활성 반경 밖 기믹 컬링** — `world.ts` compaction 인접(`world.ts:629-658`)
  - 플레이어에서 충분히 먼 청크의 기믹 엔티티는 dead 처리 + 해당 청크를 `generatedChunks`에서 제거해 **재진입 시 동일 재생성**(순수 함수라 동일). ⚠️ 파괴물 파괴 상태 등 "플레이어가 바꾼 상태"는 컬링 시 소실 → **원점 근처/이미 상호작용한 청크는 컬링 보류**하거나 M1 범위상 "재생성 허용"으로 명문화(오픈 퀘스천 OQ1).
  - ⚠️ **컬링 반경 타이트화 (성능 긴장 완화)**: 생성 활성 반경보다 컬 반경을 **타이트하게**(생성 반경 ≥ 컬 반경, 단 히스테리시스로 경계 진동 방지) 잡아 활성 기믹·벽·해저드 수를 최소로 유지. 벽 LOS·이동 슬라이드 비용이 활성 기믹 수에 비례하므로(F1), 컬 반경을 크게 잡으면 프레임 예산을 잠식. 트레이드오프: 반경↑ = 팝인 감소·재생성 부하↓ vs 활성 개체↑·프레임 비용↑ → §"트레이드오프"에 기록, 벤치(G3)로 확정.

### Phase F — 기믹 4종 로직 · 의존: E (E1 완료 후 F1~F4 병행 가능)
- **F1. 벽/엄폐물** — `src/sim/world.ts:549-610` (`resolveCollisions`), `src/sim/patterns/index.ts` (적 이동), 신규 `src/sim/los.ts`
  - **공통: 활성 벽 별도 배열 (SpatialHash 우회)**. 대형 벽(AABB)은 SpatialHash에 넣지 않고 `WorldState`에 **활성 벽 배열**(예 `activeWalls: Entity[]`, 청크 스캔 E3에서 활성 반경 벽만 채움)을 두고 **직접 순회**한다. 근거: `SpatialHash.insert`는 벽 중심을 단일 셀에만 넣어(`collision.ts:47-57`), 셀보다 큰 벽이 인접 셀 broad-phase에서 누락된다. 활성 벽 배열은 이동·탄·LOS 세 검사가 **공유**(중복 순회 방지). **활성 영역 벽 수 상한**을 두어(§5 상수) 비용 바운드.
    - **순회 순서 결정론**: 활성 벽 배열은 **매 틱 entity-array 순서로 재구축**한다(SpatialHash `query`의 고정 (cy,cx)·삽입순서 규율과 동종의 결정론 규율). E3 청크 스캔이 생성한 벽 엔티티는 이미 `entities` 배열 순서(= `nextEntityId` 발급 순)를 가지므로, `activeWalls`는 매 틱 `entities`를 그 순서 그대로 필터링해 재구축한다(별도 정렬·해시 기반 순서 금지) — 이동 차단·탄 차단·LOS 세 소비처가 동일 순서를 봄.
  - (a) **이동 차단 (슬라이드)** — `stepPlayer` 후 + 적(`applyMovement`/`integrate`, `patterns/index.ts:32-50,232-240`): 엔티티(원)가 활성 벽 배열의 벽 AABB와 겹치면 **슬라이드**(축별 침투 해소, 최소 이동). 경로탐색 없음(스펙 최소). **F1a: 돌격병(charge)이 벽에 슬라이드하는 순간이 C5(c)의 fragments 주 트리거** — F1a와 C5를 함께 구현.
    - ⚠️ **대시 터널링 없음**: 대시 임펄스는 1틱 약 `dashSpeed 1400 * DT(1/60) ≈ 23u/tick`로 벽 두께(§5 벽 상수, ≥ 수십 u)보다 작아 **한 틱에 벽을 관통(터널)하지 않는다**. 대시도 일반 이동과 동일하게 슬라이드로 차단됨을 명시·테스트(`walls.test.ts`에 대시 벽 슬라이드 케이스).
  - (b) **양측 탄 차단** — `bullet`·`enemyBullet`가 **활성 벽 배열**을 직접 순회해 벽 AABB와 겹치면 탄 `dead`(SpatialHash 대신). `resolveCollisions`(`world.ts:549-610`)에 벽-탄 분기 추가. F1b 태스크는 "grid에 wall insert"가 아니라 **활성 벽 배열 직접 순회**로 정의(재정의).
  - (c) **LOS 조준** — `nearestTarget`(`world.ts:440-456`)에 벽 가림 필터 추가. `los.ts`에 `segmentIntersectsAABB`(기본 산술, 결정론).
    - **의미 명문화**: LOS 조준 결과 = "**모든 후보를 벽 가림으로 필터한 뒤 남은 것 중 최근접**"(단순히 "최근접이 가려지면 조준 없음"이 아니라, 가려진 후보를 제외하고 그 다음 후보로 넘어감).
    - **비용 완화**: 순진하게 (후보 적 × 활성 벽) 전수 LOS는 비쌀 수 있으므로, **후보를 플레이어 거리순 정렬 후 상위 k만 LOS 검사**(가장 가까운 몇만 벽 교차 판정, 첫 비가림 후보 확정 시 조기 종료). **활성 벽 수 상한**(공통 항목)과 결합해 프레임 비용 바운드. k·상한은 §5 상수·벤치(G3)로 확정.
    - **정렬 tie-break**: 상위 k 정렬은 1차 키 "플레이어까지 거리"이며, **동거리(부동소수 완전 동일) 시 2차 키 `entityId` 오름차순**으로 확정한다(정렬 안정성이 플랫폼/엔진의 sort 안정 정렬 여부에 좌우되지 않도록 명시적 tie-break — 결정론 재현 시 동일 입력에서 항상 동일 순서).
    - **AABB 필드 소스**: 세그먼트-AABB 교차 판정(`segmentIntersectsAABB`)이 읽는 벽의 반너비/반높이는 **E1에서 확정한 필드 매핑과 동일**해야 한다 — 반너비 = `radius`, 반높이 = `targetX`. 별도 필드를 새로 만들지 않고 E1 정의를 그대로 재사용(단일 소스, 불일치 금지).
- **F2. 지형 해저드** — `data/` 신규 gimmick 해저드 정의 + `world.ts:527-543` (`stepHazards`)
  - 기존 `hazard` kind + `stepHazards`/`hazardActive`(`world.ts:527-543`) 재사용. 청크 배치 해저드는 **영구/장주기**(`life=-1` 또는 큰 값, telegraph 없음) 서브타입 추가. 밟으면 피해는 기존 `resolveCollisions`의 hazard 분기(`world.ts:600-601`)가 처리.
- **F3. 파괴 가능 오브젝트** — `entities.ts` 신규 kind + `world.ts` 충돌/compaction
  - `destructible` kind: `hp`>0, 플레이어 탄에 피격(`resolveCollisions`의 friendly bullet 분기 `world.ts:569-582`에 `destructible` 타깃 추가). `grid.insert` 목록(`world.ts:555-566`)에도 **`destructible` 추가**(broad-phase 대상에 포함돼야 friendly bullet 분기가 애초에 후보로 만난다 — 삽입 누락 시 피격 판정 자체가 발생하지 않음). HP 소진 시 `dead` → `compact`(`world.ts:629-658`)에서 젬/자원 드랍(기존 `spawnGem` 재사용). 이동 차단 여부는 선택(기본: 탄만 막지 않고 파괴 대상, 이동은 통과 or 차단 — OQ2).
- **F4. 이벤트 오브젝트 3종** — 신규 `src/sim/events.ts` + `world.ts` 상호작용
  - 공통: 플레이어가 접촉/근접 시 발동(`resolveCollisions` player 분기 확장). 발동은 결정론(입력 불요, 접촉 = 위치 함수).
  - (a) **자기장 발생기(`magnetEmitter`)**: 발동 시 `state.magnetRadius`에 배율 버프 + 지속 타이머(신규 state 필드 `magnetBuffTicks` 또는 엔티티 timer 기반). 기존 magnet 로직(`world.ts:478-497`, `magnetRadius`) 재사용. 파워업 `gem-magnet`(`powerups.ts:100-107`)와 합성 규약 명시.
  - (b) **광역 폭발 장치(`bombDevice`)**: 발동 시 반경 내 적 피해 + 적탄 소거. 보스 `clearEnemyBullets`(`boss.ts:170-174`) 패턴 재사용 + 반경 내 enemy `hp` 차감.
  - (c) **임시 포탑(`turretPickup`)**: 발동 시 일정 시간 자동 사격하는 아군 개체 생성 or 플레이어 버프. 기존 `autoAttack`(`world.ts:408-437`)/`nearestTarget` 로직 재사용해 포탑 엔티티가 자체 조준·발사. 지속시간 `life`.
  - **모든 신규 state 필드는 `hashWorld`에 append**(`replay.ts:133-148` 인접) — 결정론 검증 대상.

### Phase G — 검증 · 의존: 전부
- **G1. 테스트 갱신/신설** — `tests/*.ts`
  - 기존 8파일 중 아레나 좌표 의존분 의미 보존 수정(AC10). `tests/fullRun.test.ts`(무한 맵 완주), 신규 `tests/chunkDeterminism.test.ts`(AC3), `tests/walls.test.ts`(AC5: 이동·탄·LOS), `tests/gimmicks.test.ts`(AC6/7/8).
- **G2. 결정론 CI 게이트 재확인** — `tests/determinism.test.ts` 확장(기믹·LOS·청크 포함 입력로그로 2회 해시 일치, AC2).
- **G3. 벤치** — `src/bench/bench.ts` 시나리오에 무한 그리드/카메라/벽 LOS 부하 반영, 2,000탄 60fps 확인(AC4). cellSize 128 vs 256 A/B.
- **G4. e2e 브라우저 검증** — `.claude/launch.json` Vite 프리뷰로 무한 스크롤·카메라·기믹 4종·완주 육안 확인.
- **G5. PR** — `feat/scroll-map-gimmicks` → PR → 머지(전역 git 규칙).

---

## 5. 밸런스 재튜닝 항목 (2배 스케일·무한 맵 영향)

| 항목 | 현재값·위치 | 재튜닝 방향 |
|---|---|---|
| 플레이어 radius | 16 (`world.ts:234`) | 32 (히트박스 4배 면적 → 피탄↑ 보정 필요) |
| 적 radius | 15~22 (`enemies.ts`) | 30~44 |
| 보스 radius | 64 (`boss.ts:80`) | 128 |
| 젬/보급선 radius | 10 / 46 (`entities.ts:206,230`) | 20 / 92 |
| 이동/탄 속도 | `playerSpeed 360`, 적 `speed 90~150`, 탄 `speed 260~420`, boss 탄 `300~420` | 2배 스케일 세계에 맞춰 상향(속도가 반경 대비 느려 보이는 것 보정) |
| 스폰 링 반경 | 아레나 절대(`waves.ts`) | 뷰포트 대각선 기준 상수화(화면 밖 링) |
| 포메이션 간격 | line `46`, cluster `±90` (`waves.ts:153,184`) | 2배(개체 커져 겹침 방지) |
| 젬 자석 반경 | `BASE_MAGNET_RADIUS 210`, `MAGNET_SPEED 760` (`world.ts:54-56`) | 상향(개체·맵 확대 대비 수거 편의) |
| 웨이브 예산 | 적 12→44, 탄 300→2000 (`waves.ts:37-44`) | 개체 커진 만큼 밀도 재조정(60fps·가독성 유지) |
| 하자드/용암 반경·스팬 | mortar `70`, lava `46`, pillars 스팬(`enemies.ts:42,57`, `patterns:147`) | 반경 2배 + 스팬 플레이어 상대 고정폭 |
| 보스 HP/탄 수 | HP 3600, ring/spiral count (`boss.ts`) | 히트박스 2배로 피격↑ → HP 재평가 |
| 접촉/탄 피해 | 각 def `contactDamage`/`damage` | 피탄율 변화에 맞춰 재평가 |
| SpatialHash cellSize | 128 (`world.ts:269`) | 개체 2배 → 256 후보(벤치 결정) |
| 투사체 컬 반경 | 신규(Phase A3) | 뷰포트 대각선×1.5 등 |

> 재튜닝 수치는 **밸런스 밸런스이지 스펙 고정값이 아님** — M1 재미 게이트 튜닝 루프처럼 반복 대상. 1차 값은 "×2 스케일 + 속도 상향"으로 시작.

### 트레이드오프 (성능 ↔ 체감)
- **컬링/생성 반경 vs 프레임 비용**: 반경↑ = 배경/기믹 팝인 감소·재생성 부하↓ 이지만 활성 기믹·벽 수↑ → 벽 LOS·슬라이드·순회 비용↑(프레임 예산 잠식). E4에서 컬 반경을 생성 반경보다 **타이트**하게(히스테리시스 포함) 잡아 균형. 벤치(G3)로 확정.
- **활성 기믹 밀도 상한 vs 맵 풍부함**: 활성 영역 기믹 총량 상한(E3)이 낮으면 프레임 안전하나 맵이 빈약, 높으면 풍부하나 LOS/슬라이드 비용↑. §5 상수로 상한·밀도 튜닝.
- **LOS 상위 k 후보만 검사 vs 정확도**: k↓ = 저비용이나 드물게 "먼 비가림 적" 조준 누락 가능. 활성 벽 수 상한과 결합해 정확도 손실을 실질적으로 무시 가능한 수준으로.

---

## 6. 리스크와 완화 (Risks and Mitigations)

| 리스크 | 심각도 | 완화 |
|---|---|---|
| ~~무한 좌표 f64 정밀도 저하로 sim 해시 분기~~ → **렌더 f32 정밀도로 배경 UV swim** (재분류) | 중 | **sim 결정론 근거는 유효 확인**: 도달 범위 유한(§2①A, <5×10⁵u ≈ 2¹⁹ ≪ 2⁵³), 두 실행이 같은 f64 연산 → bit-identical 해시. sim 해시 분기 리스크는 실질적으로 없음. **실 리스크는 렌더 계층 f32**: camX가 커지면 PIXI가 f32 UV로 넘길 때 정밀도 손실로 `TilingSprite` 배경이 미세하게 떨림(swim). 완화: B4의 **f64 모듈로 후 대입**(`tilePosition.set(-camX % tileW, ...)`)으로 렌더에 작은 값만 전달. 초장기 대비 sim 정수-오프셋 리베이스(옵션B)는 후속 안전판으로 문서화(미구현). 결정론 테스트는 **장시간(600s) 완주 로그**로 확장. |
| cellKey 정수 조합 오버플로/충돌 → 오충돌·성능 | 중 | `>>>0` 안전 페어링(Szudzik/큰 소수 곱 XOR), 정확 거리 재검사 유지(오검출 0). 벤치로 충돌률 확인. |
| 청크 컬링 후 재진입 시 파괴물 상태 소실(다시 온전) | 중 | M1 범위: 순수 재생성 허용을 명문화하거나 상호작용 청크 컬링 보류(OQ1). 결정론은 유지(순수 함수). |
| 신규 state/entity 필드 추가로 리플레이 포맷 파손 | 중 | 의도된 **포맷 버전 범프**(M1 기록은 재검증 불필요). `hashWorld` 필드 추가는 append-only, `KIND_CODE`는 9+ append(1~8 불변). |
| 카메라·좌표 변환 회귀(조준·대시 어긋남) | 중 | aim 월드 좌표 변환 단위 테스트(B5). sim은 카메라 무지 — 회귀 표면을 렌더/입력에 국한. |
| LOS·벽 충돌·기믹으로 프레임 예산 초과 | 중 | 활성 반경 컬링, 벽/적 수 상한, LOS는 활성 벽만. 벤치 게이트(G3). |
| 스폰 상대화로 화면 안/즉사 스폰 | 중 | 스폰 링을 뷰포트 밖으로 강제(상수), 원점 안전지대(E2). |
| 런 구조 불변 위반(뱀서화로 흘러감) | 하 | 웨이브/보스/정산 골격 파일 미개조 — 좌표만 치환. `fullRun.test.ts`가 6구간→보스→승리 완주로 가드. |

---

## 7. 검증 단계 (Verification Steps)

1. **단위/결정론**: `npm test` — 확장 `determinism.test.ts`(기믹·LOS·청크 포함 2회 해시 일치, AC2), `chunkDeterminism.test.ts`(경로 독립, AC3), `walls.test.ts`(이동·탄·LOS, AC5), `gimmicks.test.ts`(AC6/7/8). 각 Phase 종료 시 전체 녹색 유지.
2. **타입/린트**: `tsc --noEmit` + ESLint — `src/sim/` 금지 심볼 0건(AC11).
3. **e2e 완주**: `fullRun.test.ts` 무한 맵 6구간→보스→승리 무크래시(AC9) + 승리 로그 결정론 재현.
4. **벤치**: `?bench=1` 및 헤드리스 계측으로 2,000탄 60fps(AC4), cellSize 128/256 비교(G3).
5. **브라우저 e2e(육안)**: Vite 프리뷰(`.claude/launch.json`)에서 (a) 무경계 이동·카메라 추적·심리스 배경, (b) 벽 엄폐(뒤 적 미조준)·양측 탄 차단, (c) 해저드 피해·파괴물 드랍·이벤트 3종 발동, (d) 개체 ~96px 육안 확인.
6. **회귀**: 기존 8 테스트 파일 의미 보존 통과(AC10).

---

## 8. 오픈 퀘스천 (실행 중/전 결정 필요 → `.omc/plans/open-questions.md` 기록)

> **착수 전 확정 불필요 — 전부 기본안으로 시작 가능.** 실사 결과 OQ1~6 전부 M1 기본(제안)안이 이미 마련돼 있어, 실행 착수를 막지 않는다. 각 항목에 `[실행중-기본안有]`(구현하며 기본안대로 진행, 필요 시 실행 중 조정) / `[실행전-필수]`(착수 전 확정 필요) 태그를 부여한다.

- **OQ1** `[실행중-기본안有]`: 청크 컬링 후 재진입 시 파괴물/이벤트 소비 상태를 (a) 순수 재생성(온전 부활, 단순·결정론 유지) vs (b) 상호작용 청크는 컬링 보류(상태 보존, 메모리↑). — M1 기본 (a) 제안.
- **OQ2** `[실행중-기본안有]`: 파괴 가능 오브젝트가 이동을 (a) 차단(벽 겸용) vs (b) 통과(순수 타깃). — (b) 제안(벽과 역할 분리).
- **OQ3** `[실행중-기본안有]`: 탄(bullet/enemyBullet) radius도 2배로 키울지 — 가독성 규칙상 (a) 유지 vs (b) ×1.5. — 기체 스케일과 별개, (a) 유지 or (b) ×1.5 제안.
- **OQ4** `[실행중-기본안有]`: 이벤트 오브젝트 접촉 발동 vs 근접 자동 발동 vs 상호작용 키. — 스펙상 상호작용 오브젝트 = 접촉/근접 발동 제안(입력 프레임 불요, 결정론 단순).
- **OQ5** `[실행전-필수/스코프 확정]`: 이벤트 3종 외 추가 종류(스펙 R8 "추가는 설계 위임") 이번 범위 포함 여부. — **스코프 확정: 이번 스코프에는 없음(3종만), 추가는 후속.**
- **OQ6** `[실행중-기본안有]`: 돌격병 fragments 보조 트리거(벽 없는 구간 대비) — (a) 벽 슬라이드 주 트리거만 vs (b) 돌진 종료/`fireCooldown` 주기 보조 트리거 추가(C5c). — 무한 맵 벽 밀도 종속 회피 위해 (b) 보조 트리거 포함 권장, 구체 조건은 F1a 벽 밀도 확정 후 튜닝.

---

## ADR — 무한 스크롤 월드 + 개체 2배 스케일 + 맵 기믹

- **Decision**: M1 고정 아레나를 (1) f64 좌표 무한 월드(리베이스 없음)로, (2) SpatialHash를 Map 버킷 무한 그리드로, (3) LOS를 세그먼트-AABB 교차로 구현한다. 청크 기믹은 (시드, 청크 좌표)의 순수 함수로 배치하고, 신규 엔티티는 기존 flat `Entity`+`KIND_CODE(9+)` 확장으로 흡수한다. 카메라/컬링/타일링은 렌더 계층에만 둔다.
- **Drivers**: ① 결정론 재현성(bit-identical 해시, CI 게이트), ② brownfield 범위/회귀 통제, ③ 60fps @ 2,000탄.
- **Alternatives considered**: 좌표=원점 리베이스 / 유한 큰 맵; SpatialHash=롤링 고정 그리드 / 현행 클램프 유지; LOS=그리드 브레젠험 / 생략. (각 기각 근거 §2)
- **Why chosen**: 실제 도달 범위 유한 → f64 그대로가 최소 변경·자명 결정론. Map 버킷은 현 broad-phase 결정론 규율 재사용하며 무한 정확성 확보. 세그먼트-AABB는 벽=엄폐물 형상과 정합하고 활성 개체 수가 작아 저비용. 순수 함수 배치가 경로 독립 재현을 보장.
- **Consequences**: 리플레이 포맷 버전 범프(M1 기록 재검증 불요). 렌더가 카메라·컬링을 전담(sim 무지 유지). 청크 컬링 상태 소실은 순수 재생성으로 수용(OQ1). 초장기 런 f64 정밀도는 sim에서 무해(재분류: 실 리스크는 렌더 f32 UV swim → B4 모듈로로 완화). **대형 벽(AABB)은 SpatialHash(점 전용)를 우회해 활성 벽 배열로 직접 순회**(이동·탄·LOS 공유). **적 이동 아레나 경계 제거로 돌격병 fragments 트리거를 벽 슬라이드 이벤트(+보조 트리거)로 재훅**(C5) — 무한 맵 공격 소멸 방지.
- **Follow-ups**: 정수-오프셋 리베이스(초장기), 파괴물 상태 영속화, 미니맵 UI, M2 드랍 테이블 통합, 128px 에셋 재생성.

---

## 변경 이력
- 2026-07-15 최초 작성 (딥 인터뷰 스펙 + M1 완성 코드 기반, RALPLAN-DR consensus)
- 2026-07-15 Architect 검토(SOUND_WITH_CHANGES) 반영 개정:
  1. **[치명] C5 신설** — `integrate()` 원점 박스 클램프(patterns/index.ts:236-239) + `moveCharge()` 아레나 벽 바운스(63-76) 제거/상대화, 돌격병 fragments를 벽 바운스 전용 트리거(77-83)에서 **F1a 기믹-벽 슬라이드 이벤트 + 보조 트리거(OQ6)**로 재훅해 무한 맵 공격 소멸 방지.
  2. **대형 벽 SpatialHash 우회** — B1을 점 엔티티 전용으로 명문화(단일 셀 삽입 broad-phase 누락 근거, collision.ts:47-57), F1b를 "활성 벽 배열 직접 순회"로 재정의(탄/이동/LOS 공유).
  3. **AC3 비교 기준** — entityId 재발급으로 hashWorld 분기 → 정렬된 `(kind,x,y)` placement digest 동등성으로 경로독립 검증 정의.
  4. **cellKey 음수 폴딩** — Szudzik 비음수 폴드(`z≥0→2z, z<0→−2z−1`) 후 페어링(B1).
  5. **F1c LOS 의미/비용** — "모든 후보 가림 필터 후 최근접" 명시 + 거리순 상위 k만 LOS·활성 벽 수 상한.
  6. **B4 TilingSprite f64 모듈로** — `tilePosition.set(-camX % tileW, ...)`로 렌더 f32 UV swim 방지. §6 리스크 "f64→sim 해시 분기"를 "렌더 f32 정밀도"로 재분류(sim 결정론 근거 유효 확인).
  7. **A3 despawn 검증 항목화** + 스폰 벽 겹침 방지(C1) + 대시 벽 슬라이드 터널링 없음(임펄스 ~23u/tick < 벽 두께) 명시(F1a/AC5).
  8. **성능 긴장** — 활성 영역 기믹 상한(E3) + E4 컬 반경 타이트화, §5 트레이드오프 섹션 신설.
  9. **ART_SCALE 인용 정정** — `entityRenderer.ts:34`→`:33`(정의) / `:93`(사용처), §1·D1.
  - 총 태스크: C5 신설(+1). F1b·AC3·B1·B4·A3·E3·E4 재정의/보강. OQ6 신설. ADR Consequences 갱신.
- 2026-07-15 Critic 개선 5건 병합 (APPROVE, 비차단):
  1. **OQ 전/중 분류** — §8·`open-questions.md`의 OQ1~6에 `[실행중-기본안有]`/`[실행전-필수]` 태그 부여, "착수 전 확정 불필요 — 전부 기본안으로 시작 가능" 명문화. OQ5는 스코프 확정("이번 스코프에는 없음")으로 표기·체크.
  2. **F3 보강** — friendly bullet 분기(`world.ts:569-582`) destructible 타깃 추가에 더해 `grid.insert` 목록(`world.ts:555-566`)에도 destructible 추가 명시(누락 시 애초에 피격 후보에 안 들어감).
  3. **F1/E3 activeWalls 순회 순서 결정론** — 활성 벽 배열은 매 틱 entity-array 순서로 재구축(grid와 동종 규율)임을 F1 공통 항목·E3에 명시.
  4. **F1c LOS 상위 k 정렬 tie-break** — 동거리 시 `entityId` 오름차순 2차 키 명시.
  5. **F1c 벽 AABB 필드 해석 확정** — E1을 "반너비=`radius`, 반높이=`targetX`" 단일 소스로 못박고, F1c LOS 세그먼트-AABB 판정이 동일 필드를 재사용함을 명시(E1 재해석 정의와 일치).
  - 상태: `pending approval` → `pending approval (consensus approved)`.
- 2026-07-15 PR#2 리뷰 LOW 5건 반영 (fix/scroll-map-review-lows): C1 스폰-벽 결정론 오프셋(`avoidWalls`) 구현, `slideCircleWalls` 2패스 코너 보강, `nearestTarget` slow-path 스크래치 재사용, 탄-벽 스윕·chunk marker prune 가드 주석(+prune 여유 1청크). 단위 테스트 2건 추가.
