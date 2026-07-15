# M3 Lane 3 핸드오프 — 기지 맵·연구소·정제소·FTUE (Phase D + E)

- 작성: 2026-07-16 (Executor, M3 Lane 3)
- 브랜치: `feat/m3-progression-complete` (Lane 1+2 통합 218/218 위에 적층)
- 커밋:
  - `6814569` feat(m3): 기지 단계 해금 + 섬멸 티어 게이트 (Phase E2)
  - `df99d5b` feat(m3): 기지 맵·연구소·정제소 UI (Phase D1~D3)
  - `dadb620` feat(m3): FTUE 튜토리얼 + 타이틀·기지 메타 루프 통합 (Phase E1)
- 검증: `npm test` 225/225 녹색(218 baseline + 7 신규), `npx tsc --noEmit` 클린,
  `npm run lint` 0 경고. push/PR 없음(커밋만). 서브에이전트 없음.
- 규율: UI는 DOM 오버레이(src/ui/), 시뮬 무영향. **sim 읽기 전용 — 수정 0**.
  튜토리얼도 기존 config 조합(planet 0·tier 0·고정 시드)만 사용, 신규 sim 필드 0.

## 구현 요약

### D1 기지 맵 허브 (`src/ui/baseMap.ts`)
- 1화면 고정 뷰(OQ-M3-6). 건물 5종 타일 클릭 진입: 격납고(기존 인벤 재사용)·
  연구소·정제소 / 방어 사령부·관제탑은 "준비 중 (M4)" 잠금 연출(M4 자리만).
- 미해금 건물은 잠금 오버레이 + 사유 표기(해금 순서 자연 노출).
- `성계 지도 (출격)` 버튼으로 star map 진입. 메타 라인(크레딧/광물/Lv/스킬).

### D2 연구소 (`src/ui/researchLab.ts`)
- 스킬트리 3계열(화력·생존·기동) × 20노드, tier 5행 × 4열 배치.
- 노드 클릭 = `investSkill`(뱅크 1점 소비). 리스펙 버튼 = `respecSkills` +
  `respecCost` 크레딧 표시. `computeSkillStats(profile.skillInvest)` 파생 스탯
  프리뷰(시너지 반영, 0값은 숨김). 시너지 설명 문구.

### D3 정제소 (`src/ui/refinery.ts`)
- 인벤토리 중 어픽스 보유 장비 목록 → 선택 → 어픽스 목록(잠금 토글 1칸).
- 리롤 = `rerollAffixes(item, uiSeed, lockedIndex?)`. 잠금 시 광물 3배
  (`REFINERY_REROLL_COST=12`, 잠금 36). 리롤 시드는 UI 계층 `Math.random`(sim 밖).
- 슬롯머신 롤링 연출(setInterval 12프레임, 렌더 전용). 광물 차감·결과는
  즉시 순수 계산 후 애니메이션은 표시만. 결과 Item을 id로 인벤토리에 교체.

### E1 FTUE 튜토리얼 (`src/ui/tutorial.ts` + `src/main.ts`)
- `TitleScreen`: 최초 1회 튜토리얼 강제(`▶ 튜토리얼 시작`), 이후 스킵
  (`▶ 기지로 진입`, OQ-M3-7). 시작 클릭 = FTUE 입력 시점.
- 튜토리얼 런: `TUTORIAL_SEED`(고정)·planet 0·tier 0 결정론 런. 카르곤 몹 재사용.
- `TutorialOverlay`: 경과 초 기반 스크립트 힌트 렌더 오버레이(첫 드랍 시 래치).
- `FtueTracker`: 입력→전투 진입(<60s), 입력→첫 드랍(<240s) `console.info` 계측
  (`[FTUE]` 프리픽스, AC8·게이트①). 브라우저 확인: 입력→전투 0.00s ✅.

### E2 단계 해금 (`src/save/profile.ts`, `src/save/settlement.ts`, `data/planets.ts`)
- `Profile.tutorialDone` + `SAVE_VERSION 3` + `migrateV2toV3`(기존 세이브는
  `tutorialDone=true`로 스탬프 — 튜토리얼 재강제 방지). normalize에 필드 추가.
- `computeUnlocks(profile)`: 격납고(항상)·연구소(Lv≥`RESEARCH_UNLOCK_LEVEL=3`)·
  정제소(행성 1회 이상 클리어)·방어/관제(M4 false).
- `recordPlanetClear(profile, planet, tier)`: 최고 티어 유지. `settleRun`이
  승리 시 호출(`RunResult`에 `planet?/tier?` 추가, main.ts가 `w.config`에서 전달).
- 레벨 캡/섬멸 게이트 노출: `data/planets.ts TIERS`에 섬멸(2) 추가,
  `planetSelect`가 Lane2 `canEnterTier`로 Lv60 미만 잠금 + 사유 표기
  (`🔒 섬멸: 기체 Lv 60 필요 (현재 Lv N)`). 기지 왕복 `onBack`.

## 소비 API (Lane 1/2에서 소비한 것)
- Lane1: `investSkill/respecSkills/respecCost/totalInvested`, `computeSkillStats`,
  `rerollAffixes`, `SKILLS/SKILL_TREES/treeRange/NODES_PER_TREE/TREE_DEPTH`.
- Lane2: `canEnterTier/ANNIHILATION_UNLOCK_LEVEL`(`data/waves.ts`).
- M2: `computeLoadoutStats`, `AFFIX_BY_ID/AFFIXES`, `settleRun`, 인벤/결과 오버레이.

## 메타 루프 변경(main.ts) — 다른 진입점 주의
- 흐름: **타이틀 → (최초)튜토리얼 런 / (이후)기지 맵**. 기지 맵이 허브.
  기지 → [격납고/연구소/정제소] 또는 → 성계 지도 → 런 → 결과 → **기지로 복귀**.
- `startRun`은 매 호출 `tutorialActive=false`로 초기화. `startTutorial`이 이후 true 재설정.
- 결과·정비 복귀 콜백이 전부 `openBaseMap`으로 바뀜(기존 `openStarMap` 아님).

## 검증 근거
- 브라우저 프리뷰(5180) 육안: 타이틀(신규/기존 라벨 분기)·튜토리얼 런+FTUE 로그·
  기지 맵 해금 게이트(Lv5+클리어 → 연구소/정제소 해금, M4 준비 중)·연구소
  60노드 투자(20→19)·정제소 리롤(광물 100→88, 잠금 36, 어픽스 개수 보존 재롤)·
  섬멸 티어 잠금(Lv5<60). **콘솔 에러 0**.

## 리스크 / 후속(범위 밖)
- **튜토리얼 "3~4분 단축판" 미완**: 기존 sim에 웨이브/세그먼트 수 제한 config가
  없어(WorldConfig에 해당 필드 없음, sim 수정 금지 규율) 튜토리얼 런은 풀 6세그먼트
  런이다. AC8 하드 기준(입력 후 60초 내 전투·4분 내 첫 드랍)은 충족(전투 즉시
  진입). 단축판이 필수면 sim에 `maxSegments` 류 append-only 필드 1개 필요 — 별도
  태스크로 보고. 현재는 홈월드 궤도 정찰 런으로 대체(첫인상 정합).
- 정제소 리롤/스킬 밸런스 수치(비용·시너지율)는 §5 튜닝 루프 대상.
- 기지 픽셀아트는 도형/이모지 폴백(Phase F 아트 통일에서 스프라이트 교체 예정).
- `recordPlanetClear`의 "행성 1클리어" = 임의 행성 1회 이상 클리어로 해석
  (GDD §7 문맥). 특정 행성 지정이 필요하면 규칙만 조정.
