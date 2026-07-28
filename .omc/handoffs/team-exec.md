## Handoff: team-exec → team-verify

정련 공정(ADR-0040) 구현 레인 6개의 결과와, 검증 웨이브가 확인해야 할 것.
계약: `.omc/handoffs/refining-chain-contract.md` · 계획: `.omc/plans/refining-chain-2026-07-28.md`

- **Decided**: 파일 소유권을 배타적으로 갈라 단일 브랜치에서 6레인 병렬 실행. 계약 문서를
  선행 작성해 시그니처·i18n 키·상수를 고정(레인 간 표류 방지). 완주 후 굴림 거부를 UI 가
  아니라 **상태기계**에 배치(lead 지시). `rerollCost` 를 인자 축소가 아니라 **함수째 삭제**
  (레인 B 제안 승인 — `rerollBaseCost` 와 동일 껍데기가 되므로). deno-verify 는 새 시나리오
  추가 대신 **기존 시나리오에 프로브 축만 부착**(레인 A 판단 — `denoFixture.test.ts:72` 의
  `scenarios.length === 12` 하드코딩을 남의 레인 파일이라 건드리지 않기 위해).
- **Rejected**: 서버 세션 테이블(ADR §"왜 서버 세션 테이블이 아닌가") · 완주 보상(싱크 정체성) ·
  어픽스 칸 추가(요구 레벨 벽) · UI 전용 완주 가드(직접 호출 경로가 뚫는다) ·
  신규 아트 자산(기존 버튼 텍스처의 나무→노랑→빨강이 열 구배를 이룸).
- **Risks**: ① 레인 E 가 `select()`/`reroll()` 이름이나 `busy` 가드를 바꾸면 이중 차감 회귀
  테스트가 컴파일 단계에서 깨지고, 그때 가장 쉬운 "수정"이 단언 삭제다. ② 6어픽스 상세 패널이
  세로 40px 여백에 약 150px 를 넣어야 해 구조 재배치 없이는 넘친다. ③ 값 밴드로 최종 장비
  파워가 인플레된다(상한 `def.max` 는 불변이라 드랍 천장은 유지 — 밸런스 보류 항목).
- **Files**: `src/items/roll.ts` · `src/items/refiningChain.ts`(신규) · `data/economy.ts` ·
  `src/i18n/catalog.ts` · `src/ui/pixi/refinery.ts`(레인 E 작업 중) · `src/ui/refinery.ts`(삭제) ·
  `scripts/deno-verify/{scenarios,common}.ts` + `fixtures.json` ·
  테스트 `reforge`·`refiningChain`(신규) / `reroll`(무수정) / `economy`·`requiredLevel`·
  `saveProfileStoreGuard`·`pixiScreenPersistence`
- **Remaining**: 레인 E 완료 → 전량 그린 확인 → AC 전수 검증 → 커밋 → PR

## AC ↔ 근거 대응표 (검증 웨이브가 하나씩 확인할 것)

| AC | 기준 | 근거 위치 | 상태 |
|---|---|---|---|
| AC1 | `band=0`·단일 고착이 현행과 바이트 동일 | `tests/reroll.test.ts` **무수정** 8케이스 + `tests/reforge.test.ts` AC1 | 레인 A 보고 |
| AC2 | 밴드 상향 시 값 기댓값 단조 증가 | `reforge.test.ts` — 400표본, `low≤mid≤high` **및 `high>low`**(공회전 방지) | 레인 A |
| AC3 | 퇴화 3종은 밴드 무관 불변 | `reforge.test.ts` — 240표본, `seen>0` 로 실제 밟았음 확인 | 레인 A |
| AC4 | 다중 고착 값·순서 보존, 중복 없음 | `reforge.test.ts` AC4 | 레인 A |
| AC5 | `requiredLevel` 공정 전후 불변 | `requiredLevel.test.ts` 신규 describe 7케이스 — `band=1` 대조군 + 입력 보존 선단언 | 레인 F2 |
| AC6 | 고착 0개면 전 heat 에서 위험 정확히 0 | `economy.test.ts`(3 heat × n=0..8 `toBe(0)`) + `refiningChain.test.ts`(`riskRoll=0` 경계) | 레인 B·C |
| AC7 | 용해 시 `current===baseline`, 고착 전량 해제 | `refiningChain.test.ts` 용해 절 | 레인 C |
| AC8 | 굴림당 고착 1개, 해제 불가 | `refiningChain.test.ts` fasten 절 | 레인 C |
| AC9 | 전 고착 시 `complete`, 공정 자동 종료 | `refiningChain.test.ts` 완주 절 + **완주 후 굴림 거부 4케이스**(뮤테이션 검증됨) | 레인 C |
| AC10 | 이탈 후 재진입 시 마지막 굴림 결과 | `pixiScreenPersistence.test.ts` | **레인 E 미확인** |
| AC11 | 연출 시작 전에 판정·저장 완료 | `pixi/refinery.ts` `persist()` → `setInterval` 순서 | **레인 E 미확인** |
| AC12 | `spend` 거부 시 굴림·용해 없음 | `pixiScreenPersistence.test.ts` | **레인 E 미확인** |
| 추가 | 6어픽스에서 패널 미넘침 | 레이아웃 부등식 테스트(신설 요구) | **레인 E 미확인** |

## 검증 웨이브 유의사항

1. **리뷰어류는 plain Agent 로 띄워라.** team 컨텍스트로 spawn 하면 `SendMessage` 미호출로
   결과가 통째로 유실되는 전례가 이 프로젝트에 있다(리뷰는 완료됐는데 lead 가 무응답으로
   인지 → 실제 결함이 머지됨). final-text 로 회수해라.
2. **`corepack pnpm test` 와 `corepack pnpm build`(tsc)를 반드시 함께** 확인해라. `pnpm` 은
   PATH 에 없다. vitest 그린인데 tsc 가 깨져 있던 회귀 전례가 있다.
3. **`fixtures.json` 이 추가 전용인지 재확인**해라 — `git diff --numstat` 이
   `276 0` 이어야 한다(삭제 0). 기존 결정론 골든이 움직였다면 EF 재배포 판단이 필요해진다.
   단, 정련은 sim 밖이라 **정상 경로에서는 EF 재배포가 필요 없다**.
4. **테스트 추가로 tsc 가 깨지지 않았는지** 별도로 확인해라 — 이 리포에 node-shim 미선언으로
   vitest 는 그린인데 main 빌드가 깨져 있던 전례가 있다.
5. 워커 보고를 액면 그대로 믿지 말고 **표의 근거를 직접 실행해 확인**해라.
