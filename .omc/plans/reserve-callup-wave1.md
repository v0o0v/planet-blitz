# 예비역 소집 + 장비 잠김 — Wave 1 구현 스펙 (ADR-0024)

모든 executor 에이전트는 이 스펙의 **필드명·jsonb 셰이프·결정론 규칙**을 정확히 따른다. 드리프트 금지.

## 범위 결정 (중요)

- **Wave 1 (이번 세션)**: 예비역 소집(공격측) + 장비 잠김 + 소멸 반환. **거의 순수 클라이언트**.
- **Wave 2 (이월)**: 방어 스펙 실물빌드 통일(프리셋→AI 성향) + 공격측 서버권위 loadout 재파생 + EF verify-invasion 변경 + 신규 해시 베이스라인 + **EF 재배포**. 결정론 3자 계약(SQL/EF/클라) 재작성 필요 → 별도 PR. balance/server-authority 이월 방침과 정합.
- **수호 게이트웨이(retireShip/fetchGuardians)는 현재 앱에서 미배선**(소비처 0). 따라서 Wave 1 빌드 영속은 **로컬 세이브(normalizeGuardianRecords)** 가 라이브 경로. 서버 마이그레이션 파일은 작성하되 **원격 적용은 Wave 2 로 이월**(게이트웨이 배선과 함께).

## 결정론 불변식 (절대 깨지 않음 — 테스트가 못박음)

- `tests/shipHashBaseline.test.ts` (striker-prem8.json): 활성 기체 경로 per-tick 해시 바이트 동일 유지.
- `tests/invasionHash.test.ts`: `l3.guardians[].snapshot.*` 필드 열거("17" count), PvE 불변, `KIND_CODE.guardian:17` append-only 유지.
- **방어 배치(snapshot) 경로를 절대 건드리지 않는다** — build 는 snapshot 의 **형제 필드**로만 추가. snapshot 안에 넣지 말 것.
- 소집은 **opt-in 신규 입력**. buildRunConfig 활성 기체 기본 조립은 불변. `main.ts` 의 `buildRunConfig` 호출 **3개 유지**(4번째 추가 금지 — shipIntegration grep 게이트). `applyShipSprite` 호출도 **추가 금지**(기존 startInvasionRun 호출을 pilot typeId 로 수정만).

## 공유 계약 (Foundation, Task #2)

### GuardianBuild 타입 (src/save/profile.ts, GuardianSnapshot 근처)
```ts
/** 예비역 소집·장비 잠김용 실물 빌드(ADR-0024). 퇴역 순간 고정, GuardianRecord.snapshot 의 형제. */
export interface GuardianBuild {
  readonly typeId: number;                              // 런 loadout 파생용 기체 타입
  readonly equipped: Partial<Record<EquipSlotId, Item>>;// 잠긴 장비(퇴역 순간 복사) — 소멸 시 stash 반환
  readonly skillInvest: number[];                       // 스킬 투자 벡터 복사(길이=shipTypeNodes(typeId).length)
}
```
### GuardianRecord 확장
`build?: GuardianBuild` 추가(optional). 구 수호기(build 부재) = 소집 비활성. snapshot/combatScore/preset/performanceCP/retired 전부 유지.

### normalizeGuardianRecords (profile.ts:708)
`d.build` 있으면 파싱: typeId=normalizeShipTypeId(build.typeId); equipped=슬롯별 isValidItem 필터; skillInvest=normalizeSkillInvest(build.skillInvest, typeId). 하나라도 부적합/부재 → build undefined(레코드 자체는 유지).

### 세이브 버전
`SAVE_VERSION` 6→7 범프(src/items/types.ts). `migrateV6toV7` 추가 = 버전 범프 + 통과(build 는 additive optional, 구 수호기는 build 없이 정규화됨). `tests/save.test.ts` 의 `SAVE_VERSION===6`(:301,492) → 7 로 갱신 + normalizeGuardianRecords build 케이스 추가.

### 게이트웨이 (src/net/guardianGateway.ts) — 미배선이지만 계약 정합 위해 갱신
`ServerGuardian.build?: GuardianBuild`. fetchGuardians select 에 `build` 추가·매핑(r.build). retireShip 시그니처에 build 추가·p_build post.

### 마이그레이션 파일 (작성만, 원격 적용은 Wave 2)
`supabase/migrations/<신규ts>_guardian_build.sql`: `ALTER TABLE guardians ADD COLUMN build jsonb;`(nullable) + `retire_ship` 를 `CREATE OR REPLACE` 로 `p_build jsonb DEFAULT NULL` 파라미터 추가·`build` 컬럼 저장. **방어 data/snapshot 경로·inject_guardian_authority 절대 미변경.** EF 재배포 불필요.

## 라이프사이클 (Task #3, guardianLifecycle.ts)

- `retireActiveShip`: 현재 장비를 stash 로 반환하는 :104-109 루프를 **제거**하고, 대신 `guardian.build = { typeId, equipped: {…활성기체 장착 복사}, skillInvest: activeShip.skillInvest.slice() }` 로 **잠근다**. snapshot/combatScore 산출은 그대로(장비 벗기기 전 계산 유지). 신규 후속 기체는 여전히 빈 장비로 시작(장비는 stash 가 아니라 수호기에 감). RETIRE_LINEAGE_GRANT·세대교체 로직 불변.
- `dismissGuardianRecord`·`bulkDismissGuardians`: 소멸 성공 시 `guardian.build?.equipped` 의 아이템들을 `profile.stash` 로 push(반환). build 없는 구 수호기는 반환 없음.
- `tests/guardianLifecycle.test.ts` 갱신: 퇴역이 stash+2 하던 :56-66 을 "stash 불변 + guardian.build.equipped 2개 잠김" 으로, 소멸이 stash 로 반환하는 케이스 추가.

## runConfig 소집 (Task #4, runConfig.ts)

- `RunConfigOpts` 에 `pilot?: { equipped: Item[]; skillInvest: number[]; typeId: number; performanceCP: number }` 추가(스냅샷 — 복사본).
- buildRunConfig: `opts.pilot` 있으면(**침공 경로에서만** 전달됨) activeShip 대신 pilot 사용. loadout=computeLoadoutStats(pilot.equipped, pilot.skillInvest.slice(), shipBonusBp(profile.lineage), normalizeShipTypeId(pilot.typeId)). 그 후 **성능% 감쇠**: normalizePerformance(pilot.performanceCP) 로 loadout.damageMult 와 loadout.maxHpAdd 를 ×(perfCP/10000) 스케일(resolveGuardianStats 철학 — hp·피해만, 기하 불변). shipType/skillInvest 도 pilot 값으로 스탬프. **loadout 은 config 에 스냅샷** → EF 재파생 안 함 → 결정론 위험 낮음(Node 내부 결정론만; Math.random/Date.now 금지).
- pilot 없으면 기존 활성 기체 경로 **바이트 불변**. PvE(:971)·harness(:829) 는 pilot 미전달.
- 신규 유닛테스트: pilot loadout 이 활성기체와 동일 빌드일 때 perfCP=10000 이면 동일, perfCP=5000 이면 damage/hp 절반 근사.

## 정산 가드레일 (Task #5)

정식 침공은 현재 XP 미지급(finishInvasionRun). 소집을 **activeShipIndex 뮤테이션 없이** pilot 데이터 주입으로만 구현하면 activeShip 이 유일 크레딧 대상이라 자동 정합. 신규 XP 경로 미추가. 테스트로 "소집이 activeShipIndex 를 안 바꾼다" 못박기.

## UI (Task #6 소집 런치, Task #9 퇴역카피+소멸+미리보기)

- **소집 런치(#6)**: controlTower.invade()(:562) 또는 startInvasionRun(main.ts:716) 앞에 출격 기체 선택(활성 기체 vs 미소멸 수호 기체). 선택된 수호기의 build+performanceCP 를 startInvasionRun→buildRunConfig `pilot` 으로 전달. onInvade 시그니처 확장 또는 main.ts 런치 앞 모달. 기존 startInvasionRun 의 applyShipSprite 를 pilot.typeId 로(신규 호출 추가 금지). buildRunConfig 호출 4번째 추가 금지.
- **퇴역 카피(#9)**: championSelect.ts:756-760 `champion.retire.body` 를 "장비가 수호 기체에 잠긴다" 로 리워드(현 "returns to the stash" 문구). i18n catalog.ts.
- **소멸 UI(#9, 신규)**: 현재 dismiss UI 전무. 최소 수호 로스터+소멸 버튼 표면(hangar 또는 defenseCommand 진입). 소멸 시 dismissGuardianRecord 호출→장비 stash 반환 확인.
- **빌드 미리보기(#9)**: 선택적. hangar renderShipPanel/researchLab 를 활성기체 대신 전달 build 로 파라미터화하거나 자족 카드. 과하면 후순위.

## 테스트 총괄 (Task #7)

정규경로 통합("단위 그린인데 배선 없음" 반복결함 차단): 소집이 startInvasionRun 정규 경로로 실제 런 loadout 에 도달함을 통합 테스트로 증명. + 바이트 불변 증명(striker-prem8·invasionHash PvE·KIND_CODE:17). + 변경 테스트 갱신(save 버전, net 샘플). typecheck + 전체 vitest 그린 게이트.
