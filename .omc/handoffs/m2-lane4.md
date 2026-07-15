# M2 Lane 4 핸드오프 — 통합 정합·검증 마감 (Phase G)

- 브랜치: `feat/m2-farming-loop` (worktree `team-ulw-m5-7872ed`)
- 베이스: Lane 1(A+B)·Lane 2(C+D)·Lane 3(E+F) 전부 머지 완료 상태(`1bb223f`) 위
- 상태: **146/146 테스트 녹색**(기존 142 + 신규 통합 4), `tsc --noEmit`·`eslint --max-warnings 0`·`vite build` 통과. 벤치 회귀 없음. 브라우저 스모크 콘솔 에러 0. push/PR 안 함.

## 발견·수정한 통합 결함

### INT-1 (수정 완료) — 행성 이중 정의 + 성계 지도 거짓 배지
- **증상**: 성계 지도(`src/ui/planetSelect.ts`)는 `data/planets.ts`(Lane 2, `PlanetMeta.contentReady`)를 읽어 베르단 카드에 "콘텐츠 준비 중 (카르곤 로스터로 진행)" 배지를 띄웠다. 그러나 Lane 3가 `data/planets/index.ts`(`PlanetContent`)에 베르단 로스터·여왕·드랍테이블을 실제로 배선했고, 시뮬(`world.ts`·`waves.ts`·`boss.ts`)은 `planetContent(planet)`로 그 콘텐츠를 실제 소비한다. → **UI가 "카르곤 폴백"이라 거짓 안내하는데 실제로는 베르단 콘텐츠가 뜬다**(두 `PLANETS` 배열이 id·이름을 중복 정의, drift 위험).
- **수정**: `data/planets.ts`를 **콘텐츠 레지스트리(`data/planets/index.ts`) 파생**으로 재작성. 행성 정체성(존재·index·한글 이름)의 단일 소스는 레지스트리, `data/planets.ts`는 UI 표현(subtitle/accent)만 id로 얹는다. 손유지 `contentReady` bool 제거(레지스트리에 있는 행성=콘텐츠 완비). `planetSelect.ts`의 WIP 배지 분기·`.pb-wip` 죽은 CSS 제거.
- **검증**: 브라우저 스모크 — 성계 지도에서 베르단 카드에 배지 없음, "▶ 베르단 출격"으로 갱신, 교전 티어 선택 → 출격 시 런 시작(콘솔 에러 0). 새 행성 추가 = 레지스트리 1행 → 성계 지도 자동 노출(단일 소스).

### 통합 정합 점검 결과 (결함 없음 — 정상 연결 확인)
- **settleRun ↔ 행성 드랍**: `world.ts`가 loot에 `planet`/`tier` 스탬프(`collectLoot` 1321-1328), 드랍 rarity는 `planetContent(planet).dropTable`로 판정(1345). `settleRun`이 `rollItem(seed, RARITY_BY_CODE[rarity], {planet,tier})`로 소비 → 베르단 소스 보존. 통합 테스트로 end-to-end 확인.
- **유니크 5점 end-to-end**: 인벤 장착 → `computeLoadoutStats` → `config.loadout.uniqueMask` → 시뮬 거동 변화. `uniques.test.ts`(개별 5종) + 통합 테스트(장착→재런 스탯 반영)로 확인.
- **보스 확정 드랍 타이밍(주의, 결함 아님)**: 보스 사망과 `state.victory=true`가 같은 compact 패스에서 발생하고 보스 드랍은 바닥 loot 엔티티라 접촉 수거가 필요. 승리 즉시 런을 끊으면 `state.loot`에 보스 드랍이 안 들어온다. 실게임은 접촉 자동 수거로 정상(런 종료 UI 전 수거), 통합 테스트는 승리 후 바닥 loot까지 수거 조종해 검증.

## 보강한 검증 (Phase G)
- **신규 `tests/integration.test.ts`(4건)**:
  - **G1 파밍 루프**: 베르단 교전 런 완주 → 드랍 수거(planet=1·tier=1 스탬프, rare+ 보스 드랍 포함) → `settleRun`으로 아이템 확정·인벤 적재(베르단 소스 보존).
  - **G1 장착→재런 스탯 반영**: `ship.equipped`(main.ts startRun과 동일 경로) → `computeLoadoutStats` → 스프레드 주무기 장착 시 재런 발사가 3발(중립 발칸 1발) — 장착이 시뮬 거동을 실제로 바꿈.
  - **G2 드랍 시드 시퀀스 결정론**: 동일 [시드+입력+로드아웃+베르단+유니크] 2회 실행 → 틱별 해시 100% 일치 **+ `finalState.loot`(드랍 시드 시퀀스) bit-identical** + 라이브 시뮬 경로 == 리플레이 경로. (변칙 결정론은 `anomaly.test.ts:67`, 유니크 결정론은 `uniques.test.ts:182`에 기존 커버 — 본 테스트는 결합 드랍 시퀀스 게이트를 추가.)

## AC1~AC12 판정표

| AC | 판정 | 근거 |
|---|---|---|
| AC1 아이템 모델 | ✅ | `items.test.ts`(rollItem 순수성·매직1~2/레어3~6 개수) |
| AC2 결정론·검증 | ✅ | `determinism.test.ts` + anomaly/uniques/berdan 리플레이 + **신규 통합 드랍 시퀀스 게이트**(로드아웃·베르단·유니크·드랍시드 결합 2회 일치) |
| AC3 드랍 | ✅ | `drops.test.ts`(rollElite/Boss·접촉수거) + `save.test.ts`(settleRun) + 통합(보스 rare+ 확정 드랍→정산) |
| AC4 장비→스탯 | ✅ | `drops.test.ts`(무기 3타입 발사) + `loadout.test.ts` + 통합(장착→재런 3발 vs 1발) |
| AC5 세이브 | ✅ | `save.test.ts`(왕복 무손실·마이그레이션 v0→v1·손상 복구) |
| AC6 인벤/분해 | ✅ | `save.test.ts`(salvage 환산·stashCapacity 32→64→96·mineralFindMult) |
| AC7 유니크 | ✅ | `uniques.test.ts`(5종 시뮬 훅·미장착 no-op·레지스트리 배선) |
| AC8 행성 2개 | ✅ | `berdan.test.ts`(로스터 4~7·엘리트 8·9·여왕 3페이즈·완주) + 통합 + 브라우저(성계 지도 베르단 선택·출격) |
| AC9 티어 | ✅ | `drops.test.ts`(교전=엘리트 스폰, 정찰=0) + 통합(교전 티어 런) |
| AC10 변칙 경보 | ✅ | `anomaly.test.ts`(3종 효과·수락/거부 정산 차이·결정론) |
| AC11 레벨 | ✅ | `save.test.ts`(XP 누적·레벨업·레벨당 스킬포인트+1) |
| AC12 lint·회귀 | ✅ | `tsc --noEmit`·`eslint --max-warnings 0` 통과, 기존 142건 전부 유지(의미 보존) |

## 검증 수치
- 테스트: **146 passed / 146**(20 파일). 신규 `integration.test.ts` 4건.
- `tsc --noEmit`: 통과. `eslint --max-warnings 0 .`: 통과. `vite build`: 통과(3.4s).
- 벤치(`npx vite-node src/bench/simBench.ts`): **0.265 ms/tick @ 2,112 sustained projectiles**(63x budget headroom). M1 기준 0.24ms 대비 회귀 없음(노이즈 범위, 60fps 여유 63배).
- 브라우저 스모크(port 5180): 성계 지도 렌더·베르단 카드 배지 없음·베르단 교전 출격 → 런 시작. 콘솔 에러 0.

## 잔여 리스크 / 노트
- **특산 광물 집계 단순화(Lane 2 의도)**: `settlement.ts`는 광물을 단일 `minerals: number`로 집계, 행성별 2종(경화키틴/흑요석 등) 구분 안 함. 레지스트리에 id·이름은 정의됨. M2 범위 내 의도적 단순화(Lane 2 핸드오프 §Risks). 상점/제작 도입 시 종류별 집계 필요.
- **`data/planets.ts` PlanetMeta에서 `contentReady` 제거**: 이 필드를 참조하던 코드는 `planetSelect.ts`뿐이었고 함께 정리. 외부(핸드오프 문서)의 언급은 히스토리.
- **보스 드랍 수거 타이밍**(위 INT 노트) — 실게임 정상, 자동화 테스트는 수거까지 조종. 향후 "즉시 정산(바닥 loot 강제 수거)" 최적화 시 이 가정 재확인.
- 밸런스 수치(드랍률·어픽스·유니크·베르단 로스터)는 전부 1차값(plan §5 튜닝 루프 대상).

## Files
- 수정: `data/planets.ts`(레지스트리 파생·단일 소스), `src/ui/planetSelect.ts`(WIP 배지·죽은 CSS 제거)
- 신규: `tests/integration.test.ts`(G1·G2 통합 검증 4건)
