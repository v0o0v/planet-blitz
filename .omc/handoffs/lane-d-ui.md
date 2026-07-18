# Lane D 핸드오프 — 클라 UI · net 배선 · i18n (방어 카드 시스템 M6)

- **브랜치**: `feat/defense-card-system` (Lane C2 커밋 `7e6a5d8` 위, push 안 함 — 리드가)
- **검증**: `npm test` **750 passed**(65 files, Lane C2 730 + 신규 20 = cardsView 14 · netCards 6) · `npm run lint` green · `npx tsc --noEmit` green · `npm run build` green · i18n 키 전수 일치 테스트 green(card.* 신규 키 EN·KO 동수) · 하네스 브라우저 스모크(`?harness=1&screen=defense`) — 카드 탭 렌더·오프라인 안내·탭 왕복 무크래시(console error 0).
- **원격 미적용**: Supabase MCP 호출 안 함. 리포 파일만. 카드 탭 실데이터는 Supabase 설정 세션에서만 표시(오프라인은 안전 안내).

## Files
- `src/net/cards.ts` (수정, Lane C2 파일 확장) — 신규 타입 `CardOwned`·`CardEquipState` + 게이트웨이 메서드 4종(`listInventory`·`fetchEquip`·`setEquippedCard`·`listShopPurchases`) + 공개 no-op 래퍼(`listCardInventory`·`fetchCardEquip`·`equipCard`·`listCardShopPurchases`). 기존 buy/fuse/salvage·상점 표시 헬퍼 무변경.
- `src/net/cardsGateway.ts` (수정) — 위 4종 SDK 구현(defense_cards select / defenses active row select / defenses.equipped_card_id update / card_shop_purchases select). 타입 전용 CardInstance import(런타임 SDK 추가 0).
- `src/ui/cardsView.ts` (신규) — 순수 표시 헬퍼(등급 색·라벨·어픽스 요약·잔여경고·보관 게이지·합성 사전검증·구매 오류 문구·상점 가격). DOM 무관, vitest 대상.
- `src/ui/defenseCommand.ts` (수정) — 탭 바(배치/카드) + 카드 탭 DOM(슬롯·보관함·상점·합성 선택·분해) + 네트워크 액션(장착/해제·구매·분해·합성) + 서버 크레딧 pull(정비 패턴 재사용). 기존 배치 에디터·순수 로직 무변경(탭==='layout' 경로 완전 동일).
- `src/ui/controlTower.ts` (수정) — `ControlTowerShowOpts.revealCard` + 정찰 공개 패널(`revealPanel`, 등급·잔여·어픽스 옵션). 기존 순수 표시 로직·타겟 목록 무변경.
- `src/main.ts` (수정) — begin_invasion 스냅샷 card 를 `invasion.card` 로 실음(미장착=키 생략, 해시 바이트 불변) · `lastInvasionCard` 보관 · 관제탑 결과에 `revealCard` 주입 · `renderRadarGated()`(블랙아웃 레이더 게이트 + 상단 배너) 3개 render 사이트 대체.
- `tests/cardsView.test.ts` (신규 14) · `tests/netCards.test.ts` (신규 6).

## Decided
- **카드 탭 = DefenseCommand 내부 탭**(신규 화면·건물 없음, 스펙 R6 "방어 사령부 탭 통합"). 배치 탭은 기존 렌더 완전 유지, 카드 탭만 분기. `?screen=defense` 딥링크로 즉시 접근(카드 탭은 클릭 1회).
- **net 배선 = cards.ts/cardsGateway.ts 확장**(Lane C2 계약 정본 입력에 read/equip 4종 추가). 보관함·장착 상태·상점 이력은 직접 테이블 조회(RLS 본인), 장착은 defenses.equipped_card_id 직접 update(guard_defenses_equipped_card 트리거가 소유권 검증). 구매·합성·분해는 Lane C2 EF/RPC 그대로. no-op 규율(미설정→null/false) 준수 — SDK 는 설정 시에만 동적 import(빌드 확인).
- **상점 표시 = 클라 순수 재현**(`rollCurrentShop(uid)`, 서버 호출 0). slotIndex=재고 배열 인덱스. 이미 산 슬롯은 `listCardShopPurchases(dateSeed)` 로 비활성. **옵션 미리 공개**(스펙 R6 — 카드 어픽스·등급·가격 노출).
- **만석 시 버튼 비활성**(OQ#1·스펙): 보관 게이지 만석이면 상점 구매 버튼 disabled + 보관함 만석 경고 문구. 합성 결과도 서버가 차단하나 UI 는 만석 안내.
- **잔여 1회 경고**(AC): 슬롯·보관함 행에서 `chargesLeft===1` 이면 경고색+문구(`card.slot.lastCharge`).
- **서버 크레딧 pull = 정비 패턴 재사용**: 구매·분해 결과의 `credits` 로 `profile.credits` 갱신 + persist + `refreshPendingProfile`(repair_defense 와 동일 — 서버가 진실, 대기 슬롯 stale-high 되밀림 방지). 합성은 크레딧 무변경이라 pull 없음(보관함 재조회만).
- **정보 공개(스펙 R9)**: 타겟 목록은 **배지 생략**(아래 Remaining — get_invasion_targets 가 카드 등급 미노출). 침공 후에만 관제탑 결과 배너 아래 정찰 공개 패널로 상대 카드 등급·잔여·어픽스 옵션 노출(복수전·재침공 역퍼즐). 스냅샷 card(클라 보유분)로 표시 — 서버 추가 조회 없음.
- **블랙아웃 = 렌더 게이트**: `world.cardRuntime.blackoutTicksLeft>0` 동안 공격자(=플레이어) 레이더 숨김 + 상단 배너(잔여 초). sim 무수정(cardRuntime 관찰만). 카드 미장착/PvE 는 cardRuntime 부재라 항상 정상.
- **decoyCore 렌더 = 자동 파리티**: entityRenderer `textureFor` 에 'core' 케이스가 없어 core→default(player 텍스처), decoyCore(신규 KIND)도 default 로 동일 텍스처. CORE_RADIUS=CARD_DECOY_RADIUS=90 이라 크기도 동일. fixedFacing 목록에 둘 다 없어 회전 동일. **render 코드 변경 0** — 실코어와 완전 동일 스프라이트(오인 유도 성립).
- **합성 사전 검증 = UX 보조**(EF 코드 정합 need-three/dup-ids/rarity-mismatch). 서버가 최종 강제(TOCTOU 재검증). 선택 모드 3장 상한.

## Rejected
- **타겟 목록 카드 등급 배지**: get_invasion_targets RPC 반환에 방어자 장착 카드 등급 컬럼이 없고, defenses/defense_cards 는 RLS 로 타인 조회 불가 → 서버 확장 없이 불가. 임의 스키마 수정 금지 원칙에 따라 **배지 생략**, 아래 Remaining 에 서버 확장 필요로 기록. (침공 후 정찰 공개는 스냅샷 card 로 구현됨.)
- **하네스 오프라인 카드 지급 치트**: 카드는 전면 서버 권위(defense_cards·RLS·EF)라 로컬 카드 저장소가 없다. 오프라인 합성 카드를 심으면 서버 거동을 오표현하고 오염 런 규칙과 상충 → 미추가. 대신 `?screen=defense` 딥링크로 카드 탭 접근·오프라인 안내 렌더는 스모크로 확인(실데이터는 Supabase 세션 필요).
- **snapshot.ts 에 blackout 필드 노출**: src/sim/** 수정 금지. main.ts 가 `world.cardRuntime` 직접 관찰(렌더 게이트)로 해결.
- **별도 CardPanel 클래스**: root 공유 복잡도 회피 — DefenseCommand 가 탭 상태·카드 DOM 을 직접 소유(cardsView 순수 헬퍼만 분리).

## Risks
- **원격 미검증**: 카드 탭 실데이터(보관함/상점 구매/합성/장착)는 Lane C2 마이그레이션·EF 배포 후에만 e2e 검증 가능(리포 파일만). 배포 후 실세션 스모크 필요: 상점 구매→보관함 반영→장착→침공 스냅샷 card→정찰 공개→분해 크레딧 pull.
- **card_shop_purchases 쓰기 정책 부재**: 구매 이력 insert 는 EF service_role 몫(클라 select-own 만). 배포 후 RLS 확인(Lane C2 목록).
- **UTC 자정 경계**(Lane C2 Risk 상속): 클라 표시 dateSeed(N)와 서버 처리(N+1) 갈리면 표시=구매 슬롯 매핑이 어긋날 수 있음(드문 경계, 서버 권위라 안전).
- **밸런스 미조정**(📝 상속): 가격·상점 재고·드랍 확률 전부 시작값.

## Remaining (서버 확장 필요 — 리드/후속 lane)
1. **타겟 목록 카드 등급 배지**(스펙 R9 "등급만 공개"): `get_invasion_targets()` RPC(또는 뷰) 반환에 방어자 장착 카드 **등급만** 노출 컬럼 추가 필요(예: `equipped_card_rarity text`). 옵션·어픽스는 절대 비노출(정찰 가치 보존). 추가되면 controlTower 타겟 행에 배지 렌더는 사소(cardRarityColor/Label 재사용). **현재는 배지 없이 등급 비공개** 상태로, 정보 공개는 침공 후 정찰(revealPanel)만 동작.
2. **원격 적용**(Lane C/C2 목록): 마이그레이션 2건 + cards EF + verify-invasion 재배포 후 카드 탭 실동작.
3. 📝 밸런스 튜닝(가격·재고·드랍·계수).

## 하네스 검증 방법
- **딥링크**: `http://localhost:5180/?harness=1&screen=defense` → 방어 사령부 진입 → 상단 탭 바 "🃏 카드" 클릭. Supabase 미설정이면 "카드는 서버 연결이 필요합니다" 안내(정상). 설정 세션이면 슬롯/보관함/상점 실데이터.
- **카드 효과 검증(배포 후)**: 카드 장착 → 관제탑에서 대상 침공 → begin_invasion 스냅샷 card 가 런 config 로 실림 → 유니크 블랙아웃이면 공격자 레이더 숨김+상단 배너, 신기루면 실코어 곁 동일 스프라이트 가짜 코어. 침공 후 관제탑 결과 배너 아래 상대 카드 정찰 공개.
- **블랙아웃 렌더 게이트**: main.ts `renderRadarGated()` — cardRuntime.blackoutTicksLeft>0 동안 `radar.layer.visible=false` + `#pb-blackout` 배너. PvE/미장착은 cardRuntime 부재라 항상 정상(무회귀).
- **탭 무회귀**: 배치 탭은 기존 렌더 완전 동일(팔레트·격자·정비·저장 버튼). 스모크로 탭 왕복 확인 완료.
