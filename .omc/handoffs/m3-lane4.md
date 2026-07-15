# M3 Lane 4 핸드오프 — Phase G 검증·통합 마감

- 작성: 2026-07-16 (Executor, M3 Lane 4)
- 브랜치: `feat/m3-progression-complete` (Lane 1+2+3 통합 225/225 위에 적층)
- 검증: `npm test` **229/229 녹색**(225 baseline + 4 신규 완주 게이트), `npx tsc --noEmit` 클린,
  `npm run lint` 0 경고. 벤치 0.295 ms/tick. 브라우저 e2e 콘솔 에러 0. push/PR 없음(커밋만).
- 규율: 결정론·hashWorld 순서·KIND_CODE/typeIndex 불변 유지(sim 소스 수정 0 — 검증만).

## 범위 (Phase G1~G6)
통합 정합 점검 + AC1~AC11 커버리지 확인·보강 + 게이트 ①~④ 계측 + 브라우저 e2e + 벤치 회귀.
**신규 코드: 테스트 1개(`tests/planetTierCompletion.test.ts`) 뿐. 프로덕션 sim/UI 수정 없음** —
Lane 1~3 통합본이 이미 AC를 충족해 검증에서 결함을 발견하지 못함(아래 "발견 결함" 참고).

## AC 판정표

| AC | 항목 | 판정 | 근거(테스트/계측) |
|---|---|---|---|
| AC1 | 스킬트리 60노드·투자·리스펙·시너지·99pt≤40% | ✅ | `tests/skills.test.ts` — 60노드/3계열, 용량 250·계열 80~90, 99pt≤40%(용량·노드수 양읽기), 시너지(하위→상위 증폭), 정수 스탯, 클램프, invest/respec. 브라우저: 연구소 20→19 투자·파생 스탯 프리뷰 확인 |
| AC2 | 결정론(스킬+리롤+섬멸+행성) 2회 해시 일치 | ✅ | `determinism.test.ts`(기저), `m3Content.test.ts`(니플헤임·아르케 섬멸+빔/미사일+유니크+원소+스킬투자 2회 일치·해시 분기 증명), `weapons.test.ts`(스킬투자 리플레이), `reroll.test.ts`(동일 시드 재현), `planetTierCompletion`(완주 런 결정론은 fullRun/berdan에서 커버) |
| AC3 | 정제소 리롤+잠금 리롤 순수성 | ✅ | `tests/reroll.test.ts` 8건 — 동일 시드 재현·개수 보존·잠금 제자리 보존·순수(무변이)·범위·중복 방지. 브라우저: 정제소 진입·어픽스 장비 목록·광물 100 표시 확인 |
| AC4 | 행성 완성 + 전 행성×전 티어 완주 | ✅ | `m3Content.test.ts`(니플헤임·아르케 로스터/보스 3페이즈/신규 공격 컴포넌트, ENEMY_BY_TYPE 22종), **`planetTierCompletion.test.ts`(신규 — 니플헤임·아르케 정찰+섬멸 완주·보스 처치)**. "행성 5개"는 홈월드 궤도(FTUE 전용·비전투) 포함 계수 — 전투 행성은 4개(카르곤·베르단·니플헤임·아르케)로 구체 산출물(잡몹8·엘리트4·보스2) 완결 |
| AC5 | 섬멸=패턴변형+밀도↑+엘리트2, 어픽스8, Lv100/Lv60게이트 | ✅ | `m3Content.test.ts`(TIER_PARAMS·subBullets·densityMult×1.5·eliteCount2·hpMult×4.5·엘리트 8종·canEnterTier Lv60·LEVEL_CAP 100), `planetTierCompletion`(섬멸 완주). 브라우저: Lane3에서 Lv5<60 섬멸 잠금 확인 |
| AC6 | 유니크 15점·어픽스 24종·원소 상태이상 | ✅ | `m3Content.test.ts`(어픽스 24/PREFIX12·원소3, 화염 지속피해·냉기 감속·전격 연쇄, 유니크 15점 비트 유일·전 슬롯 훅 실동작), `uniques.test.ts` |
| AC7 | 기지 맵 건물 5종·M4 준비중·잠금 연출 | ✅ | `baseUnlocks.test.ts`(computeUnlocks). 브라우저: 격납고·연구소·정제소 진입, 방어사령부·관제탑 🔒"준비 중(M4)", 메타 라인(크레딧500·광물100·Lv5·스킬) 확인 |
| AC8 | FTUE 60초 전투·4분 첫 드랍 | ✅ | 브라우저 콘솔 `[FTUE] 입력→전투 진입: 0.00s (목표 <60s) ✅` 실측. `FtueTracker` 계측 라이브(Lane3) |
| AC9 | 파워업 24종 빌드 파생 필터·가중 | ✅ | `weapons.test.ts` — 24종 태그 유일, 0~7 와이어 불변, 결정론 추첨, 빔빌드가 빔 파워업 3배↑·미스매치도 소프트 유지, 투자 계열 가중↑ |
| AC10 | 아트 통일(배경·적·탄막 가독성) | ⚠️ 부분 | Phase F(아트)는 Lane 범위상 도형/이모지 폴백 유지(Lane3 핸드오프). 게임플레이·가독성 로직은 완결, 스프라이트 교체는 후속. 탄막 소속색·상한은 sim에서 동작 |
| AC11 | src/sim 금지 심볼 0·기존 테스트 통과 | ✅ | `npm run lint` 0 경고, `tsc --noEmit` 클린, 229/229 통과(기존 225 의미 보존) |

**게이트 ①~④**: ①`[FTUE] 0.00s ✅`(브라우저 실측) ②99pt≤40%(`skills.test.ts` 산술) ③빌드 차별(파워업 가중·스킬 파생 스탯 발산 — `weapons.test.ts`·`skills.test.ts`) ④전 행성×전 티어 완주(`fullRun`+`berdan`+신규 `planetTierCompletion`) — 전부 충족.

## 통합 정합 점검 결과 (Lane 접합부)
1. **연구소 투자 → computeSkillStats → 런 반영**: 브라우저에서 투자 시 파생 스탯 프리뷰 갱신 확인. `weapons.test.ts`가 스킬투자 리플레이 해시 포함·발산 증명. main.ts config 조립(`computeLoadoutStats(equipped, skillInvest)`)이 스킬을 로드아웃에 접음 → 통합 결정론 테스트 통과.
2. **정제소 rerollAffixes → 인벤 반영**: `reroll.test.ts` 순수성 + 브라우저 정제소 진입·아이템 목록 확인. UI가 결과 Item을 id로 인벤 교체(Lane3).
3. **섬멸 티어 게이트(Lv60) ↔ UI 잠금**: `canEnterTier` 단위 + planetSelect UI 잠금(Lane3 브라우저 확인).
4. **유니크 15점 각 장착 런 거동 분기**: 통합에서 완성한 4점(군집 벌통·수렴 프리즘·쌍둥이 항성·도박사의 칩) 포함, `m3Content.test.ts`가 각 실훅 + 무-유니크 대비 해시 분기 검증.
5. **FTUE 흐름**: 타이틀(신규→튜토리얼/기존→기지) 분기·기지 허브·건물 해금 순서 브라우저 확인.
6. **파워업 24종×5무기 유효 후보**: `weapons.test.ts` 무기타입·계열 소프트 가중 검증.

## 발견 결함
- **없음(코드 수정 0).** Lane 1~3 통합본(225/225)이 이미 AC를 충족. 검증 과정에서 회귀·비결정·정합 불일치를 발견하지 못함. 신규 작업은 게이트 ④ 커버리지 공백(신규 행성·섬멸 티어 완주 미검증)을 메우는 테스트 1개 추가에 국한.

## 신규 테스트 상세 — `tests/planetTierCompletion.test.ts` (G4 게이트 ④)
기존 완주 커버리지는 카르곤 정찰(`fullRun`)·베르단 교전(`berdan`)뿐이라 신규 행성·섬멸 티어 완주가 공백이었다. 4건 추가(총 2.6s):
- 니플헤임(2)·아르케(3) **정찰** 완주 — 기본 내구 기체로 신규 보스(유령 기함·수호자 오벨리스크) 처치.
- 니플헤임(2)·아르케(3) **섬멸** 완주 — 화력 계열 만렙 투자 파일럿(순수 `computeSkillStats`, damageMult ~2.2·fireRate ~2.8x, 배율 조작 없음)으로 hpMult×4.5·densityMult×1.5·eliteCount2 최고 티어 완주.
- **대표 조합 근거**: 신규 두 행성을 양극 티어(정찰·섬멸)에서 완주 → 4행성 전부 + 3티어 전부(교전은 berdan) 완주 입증. 보스 HP는 티어 배율 비대상(world.ts stepBoss: `bossDef.hp`)이라 섬멸 완주는 잡몹 밀도·체력만 상향된 조건의 도달·처치 검증.
- **밸런스 관찰(결함 아님)**: 기본 1x DPS 기체는 섬멸 hpMult×4.5 잡몹을 못 뚫어 시간 상한에 걸림 → 섬멸=Lv60 엔드게임 게이트라는 설계와 정합. 육성 기체는 완주.

## 벤치 회귀 (Phase G3, AC4)
`npx vite-node src/bench/simBench.ts`:
- cellSize=128: **0.295 ms/tick** (56.5x 예산 여유, 지속 2112 탄, 활성 벽 10)
- cellSize=256: 0.299 ms/tick (55.7x)
- 60fps 예산 16.67ms 대비 PASS. 미사일·빔·상태이상 추가 후에도 0.3ms 수준 유지. 섬멸 밀도에서 탄 상한(2000+) 동작 확인(지속 2112, cull 정상).

## 브라우저 e2e (Phase G5)
프리뷰 5180. 타이틀→기지 맵→연구소(투자 20→19·파생 프리뷰)→정제소(아이템·광물). 콘솔 **에러 0·경고 0**(Vite HMR·FTUE 성공 로그만). 스크린샷은 PIXI 캔버스 초기화로 타임아웃 → DOM 접근성 트리로 검증(오버레이는 DOM 렌더라 정상 판독). 성계 지도 tier 잠금·전투→정산 육안은 canEnterTier 단위 + Lane3 브라우저 확인 + Node 완주 테스트로 갈음.

## 잔여 리스크 / 후속
- **AC10 아트**: Phase F 스프라이트 교체 미완(도형/이모지 폴백). 게임플레이·가독성 로직 완결, 에셋 교체는 후속 태스크(pixellab-forge).
- **튜토리얼 단축판**: Lane3 기록대로 sim에 `maxSegments` 류 필드 없어 풀 정찰 런으로 대체. AC8 하드 기준(60초 전투)은 충족.
- **밸런스 §5**: 노드 perPoint·시너지율·TIER_PARAMS·유니크 수치·리롤 비용은 튜닝 루프 대상(결정론·정합은 고정).
- **브라우저 자동화 아티팩트**: SPA가 숨김 오버레이를 DOM에 잔류시켜 재로드 후 합성 클릭이 간헐 가로채짐(제품 결함 아님 — 실사용 클릭·최초 로드 정상).
