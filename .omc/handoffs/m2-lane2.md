# M2 Lane 2 핸드오프 — 세이브·정산·인벤/성계지도 UI (Phase C+D)

- 브랜치: `feat/m2-farming-loop` / 커밋: `d445a9e`(Phase C) · `1c46db2`(Phase D+통합)
- 상태: 122/122 테스트 녹색(신규 save 16건 포함), `tsc --noEmit`·`eslint --max-warnings 0` 통과. 브라우저 스모크로 성계지도→인벤→런→사망→정산→저장→결과 왕복 확인. push/PR 안 함.

## Decided (채택)
- **프로필 = sim 밖 메타**: `Profile{saveVersion·ships[]·activeShipIndex·inventory[]·stash[]·stashExpansions·planetProgress·credits·minerals·skillPoints}`. 장착은 `Ship.equipped: Partial<Record<EquipSlotId, Item>>`(아이템 인라인 저장 — id 인디렉션 없음).
- **스토리지 pluggable**: `loadProfile/saveProfile(store?)`. 기본 `localStorage`, 없으면/차단되면 조용히 no-op·기본 프로필. 테스트는 in-memory `KeyValueStore` 주입(node 환경 유지, jsdom 불필요).
- **마이그레이션**: `migrate(raw)` → 버전 감지(없으면 v0) → step 마이그레이션(v0 `ship`/`gold` → v1 `ships`/`credits`) → `normalizeProfile`로 필드별 검증·클램프. 부분 손상 아이템은 `isValidItem` 가드로 드랍, 유효분은 무손실 통과(왕복 lossless).
- **정산(settleRun)**: `finalState.loot`(LootRecord) → `rollItem`으로 확정 → 인벤→창고→overflow 순 적재. `xpTotal` → 활성 기체 `xpToNext` 곡선으로 레벨업(레벨당 스킬포인트 +1, AC11). `resources`→credits. 사망 시 수거분 보존(ADR-0003) — 보스 확정드랍은 sim이 보스 처치 시에만 방출하므로 사망 경로엔 애초에 없음(추가 stripping 불필요).
- **분해(salvageItems)**: 노말·매직→크레딧, 레어+→광물(`worldMods.mineralFindMult` 반영). 인벤 UI가 현재 장착 로드아웃의 mineralFindMult를 계산해 전달.
- **성계 지도(OQ-M2-3)**: 변칙 수락은 런 시작 전 화면 선택 → `WorldConfig.anomalyAccepted` 플래그. offer는 시드에서 사전 계산(`new SeededRng(seed).fork('anomaly')` + `rollAnomaly(rng,false)` — createWorld와 동일 fork). 미제안 시드면 수락 UI 숨김.
- **행성 메타 데이터 주도**: `data/planets.ts`(id·이름·`contentReady`). 베르단 `contentReady=false`라 "카르곤 로스터로 진행" 배지 표시하되 선택·출격 가능(sim이 planet=1 스탬프만, 스폰은 카르곤 fallback).

## Rejected
- jsdom 도입(save 테스트용) — pluggable store로 회피, devDeps 무증가.
- 아이템 id 재발급 — `rollItem` id(`it-{seed}`) 그대로 사용, 인벤 그리드는 배열 인덱스로 렌더(동일 시드 재드랍 시 DOM 키 충돌 회피).
- 매 틱 로드아웃 재계산 — 런 시작 1회 `computeLoadoutStats` → config 주입(Lane 1 B1 경로).

## Risks / 주의
- **동일 드랍 시드 재출현**: `Item.id`가 같아질 수 있음(게임상 무해, 별개 객체). 분해/장착은 객체 참조(`indexOf`/`Set`)로 처리 — id 아님.
- **rAF 스로틀 환경**: 프리뷰 탭에서 Pixi 티커가 멈춰 `endRun`이 자동 발화 안 함. 검증은 `__pb.gameApp.app.ticker.update()` 수동 펌프로 확인함(실사용 rAF에선 정상).
- **planetProgress 미기입**: 현재 정산이 `planetProgress`를 갱신하지 않음(성계지도 게이팅은 아직 미사용). 클리어 기록이 필요하면 settleRun에 추가 지점 있음.
- **밸런스 상수**: 분해 환산(노말2·매직5·레어3·유니크8 광물)·창고 확장 200크레딧은 1차값(spec §5 튜닝 대상).

## Files
- 신규: `src/save/{profile,settlement}.ts`, `src/ui/{inventory,planetSelect}.ts`, `data/planets.ts`, `tests/save.test.ts`
- 수정: `src/main.ts`(메타 루프 통합), `src/ui/resultOverlay.ts`(정산 요약+인벤 버튼)

## 통합 지점 (Lane 3·Lane 4용)
- **성계 지도 행성 참조**: 행성 추가는 `data/planets.ts`의 `PLANETS` 행 추가만으로 카드 자동 노출. 베르단 로스터/여왕 완성 시 `contentReady:true`로 전환(코드 수정 불필요). `TIERS`도 동일.
- **settlement 흐름**: 런 종료 → `settleRun(profile, {victory,loot,xpTotal,resources})` → `saveProfile` → `resultOverlay.show(state, onRestart, onInventory)`. 새 정산 산출물(예: 유니크 세리머니 트리거)이 필요하면 `SettlementOutcome`(itemsGained[]) 소비. 유니크 판정은 `outcome.itemsGained[i].uniqueId`로 접근 가능(Lane 3 F2 세리머니 훅 지점).
- **로드아웃 주입**: main.ts `startRun`이 `activeShip(profile).equipped` → `computeLoadoutStats` → `config.loadout`. Lane 3 유니크 bit는 `UNIQUE_REGISTRY` 등록만 하면 `uniqueMask`로 자동 전파(Lane 1 훅).
- **인벤 UI**: `InventoryOverlay`는 `Profile`을 in-place 변경 후 `saveProfile` 자동 호출. 등급색/슬롯 라벨/무기타입 라벨 상수는 `src/ui/inventory.ts` 상단.
