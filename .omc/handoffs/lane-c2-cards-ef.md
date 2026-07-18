# Lane C2 핸드오프 — cards Edge Function (구매·합성·방어 성공 드랍)

- **브랜치**: `feat/defense-card-system` (Lane C 커밋 `aed581c` 위, push 안 함 — 리드가)
- **검증**: `npm test` **730 passed**(63 files, Lane C 715 + 신규 15=cardsCore) · `npm run lint` green · `npx tsc --noEmit` green · `deno task check`(cards EF·verify-invasion EF) green · `deno task verify`/`verify-invasion`/`verify-pve` 전부 green(카드 미장착 무회귀·방어 카드 정직 accept·위조 3종 거부 유지) · cards EF `deno task bundle` green(6 modules, 자립 번들).
- **원격 미적용**: Supabase MCP(apply_migration·deploy_edge_function) 호출 안 함. 리포 파일만.

## Files
- `supabase/functions/cards/cardsCore.ts` (신규) — 순수 계획 코어(플랫폼 전역 무참조, vitest·Deno 공용): `planShopPurchase`·`validateFusion`·`planFusion`·`planDefenseDrop`. 롤러(src/items/rollCard)·가격/드랍 순수함수(data/defenseCards)만 소비.
- `supabase/functions/cards/index.ts` (신규) — Deno.serve 배선. JWT 본인 인증 → action 라우팅(`buy`/`fuse`) → 롤 확정 → service_role 원자 RPC 호출.
- `supabase/functions/cards/deno.json` (신규) — check/bundle 태스크(verify-invasion 준용, sloppy-imports).
- `supabase/migrations/20260718170000_m6_card_economy_rpc.sql` (신규) — `card_shop_purchases` 테이블 + `apply_card_purchase`·`apply_card_fusion`·`apply_card_drop` 원자 RPC(전부 caller_is_service_role 게이트 + service_role grant).
- `supabase/functions/verify-invasion/index.ts` (수정) — 방어 성공(방어자 승) 확정 직후 드랍 롤 블록 추가(rollCard + defenseSuccessDropChance + crypto 랜덤 → apply_card_drop RPC). 카드 미장착 경로·기존 거동 불변(드랍은 verified 응답 후 best-effort).
- `data/defenseCards.ts` (수정, 순수 함수 추가만) — `shopDateSeedFromMs`·`shopUserSeed`(상점 시드), `cardBuyPrice`+`CARD_BUY_BASE/PER_RARITY`(구매 가격), `rollDropRarity`+`DEFENSE_DROP_BASE_CHANCE`/`DROP_RARITY_*`(드랍 등급). 기존 export·타입 무변경.
- `src/net/cards.ts` (신규) — 클라 공개 API(buy/fuse/salvage no-op 래퍼 + 상점 로테이션 표시 헬퍼).
- `src/net/cardsGateway.ts` (신규) — SDK 구현(cards EF invoke + salvage_card RPC).
- `tests/cardsCore.test.ts` (신규) — 15 케이스.

## Decided
- **롤러는 EF, 검증·차감·저장은 SQL 원자 RPC**(핸드오프 §Remaining 정본). cardsCore 가 rollShopRotation/attemptFusion/rollCard 로 카드를 **확정한 뒤**, EF 가 `apply_card_*` RPC(단일 plpgsql 트랜잭션)에 확정 jsonb 를 넘겨 크레딧·상한·소유·중복을 원자 강제. plpgsql 에 롤러를 넣지 않는다(상점 결정론 발산 방지 — Lane C Rejected 존중).
- **dateSeed = 서버 UTC 날짜**(클라 입력 신뢰 금지). `shopDateSeedFromMs(Date.now())` = epoch 이래 UTC 일 인덱스. **userSeed = uid FNV-1a → u32**(`shopUserSeed`, SeededRng.hashString 규약과 동일). 클라(`rollCurrentShop`)·서버가 동일 (dateSeed,userSeed)로 재고 재현 → 표시 슬롯 == 구매 슬롯.
- **중복 구매 차단 = `card_shop_purchases` 복합 PK**(profile_id, date_seed, slot_index). apply_card_purchase 가 유니크 insert 를 서브트랜잭션으로 감싸 unique_violation → `already-bought`. 순서: **프로필 락(동시 구매 직렬화) → 상한(20) → 크레딧 → 중복 insert → 차감+카드 insert**(실패 분기는 mutation 이전이거나 서브트랜잭션 롤백이라 phantom 없음).
- **20장 상한**(OQ#1) = purchase·drop RPC 가 insert 전 `count(*) >= 20` → `storage-full`(구매 409 거부, 드랍 미획득). data/defenseCards CARD_STORAGE_CAP=20 미러.
- **합성**: EF 가 3장 소유·등급을 select 로 읽어 롤러 입력 등급 확정 → `attemptFusion(crypto u32, rarity)` → `apply_card_fusion` 이 행 잠금으로 소유·동급·중복 id·잔존 **재검증**(TOCTOU 안전: 그 사이 salvage 되면 not-owned 로 무동작 거부) → 3장 삭제(장착 재료면 해제) + 결과 insert. EF 는 결정론 불요라 crypto 시드(결과 카드가 자기 시드로 재현되면 족함, 핸드오프 규약).
- **방어 성공 드랍 = verify-invasion index.ts 접점**(SQL apply_invasion_result 는 TS 롤러 호출 불가 → Lane C 권고안 A 채택: 이미 service_role·TS 컨텍스트에서 verdict 확정 후 방어자 승리면 드랍 롤). **apply_invasion_result SQL 무수정**(접점 최소·회귀 위험 0 — 봉인 블록 안 건드림). base 확률 `DEFENSE_DROP_BASE_CHANCE=0.15` × `defenseSuccessDropChance`(전투력 우위 배수). 등급 `rollDropRarity`(rare 0.65 중심 + unique 0.04 극저 + magic 0.31, normal 미드랍). 무작위 crypto(드랍은 리플레이 대상 아님). 드랍 실패/만석/오류는 침공 판정 무영향(best-effort try/catch).
- **가격 = `cardBuyPrice(rarity)`**(크레딧) = 40 + 60×등급랭크(normal40/magic100/rare160/unique220). data/economy.ts 곡선 결(BASE + PER_RARITY×RARITY_CODE)과 정합. 📝 튜닝.
- **분해(salvage)는 기존 salvage_card RPC 직접**(롤러 무관 — Lane C 마이그레이션에 이미 존재). cardsGateway 가 rpc 호출만.

## Rejected
- **verify-invasion 이 cards/cardsCore 를 import**: 두 EF 결합 회피. 드랍은 data 순수 primitive(defenseSuccessDropChance·rollDropRarity) + rollCard 를 index.ts 가 직접 조립(planDefenseDrop 은 cardsCore 에 테스트용으로만 두고 verify-invasion 은 미참조 — EF 독립 번들 유지).
- **apply_invasion_result 에 드랍 SQL 추가**: 롤러 부재로 SQL 단독 드랍 불가 + 봉인 함수 재정의 회귀 위험(PR#29/#35). verify-invasion TS 접점이 정본.
- **매 구매마다 서버 왕복으로 상점 조회**: 로테이션은 (dateSeed,userSeed) 순수 함수라 클라가 `rollCurrentShop(uid)` 로 재현(서버 호출 0). 구매만 EF 왕복.

## Risks
- **드랍 전투력 배수 미발동**: 매치업 CP(attackerCp/defenderCp)가 Lane C 보수 재구성으로 현재 0 → `defenseSuccessDropChance` 배수 1(사실상 base 0.15). CP 완전 재구성(공격자 서버 미러) 후 상승(📝, 무결성 무영향).
- **UTC 자정 경계**: 클라가 표시한 날(N)과 서버 처리 날(N+1)이 갈리면 slotIndex 가 다른 카드/가격에 매핑될 수 있음(구매 기록도 다른 date_seed). 서버 권위라 안전(서버 날 기준 정직 구매), 드문 경계 케이스(📝).
- **원격 미검증**: 마이그레이션·EF 리포만. 적용 시 `get_advisors(security)` 신규 WARN(RLS·search_path) 점검 필요.

## Lane D 계약 (클라가 호출할 API — src/net/cards.ts)
- **상점 표시**: `getCardsUserId()` → uid(미설정 null). `rollCurrentShop(uid, nowMs?)` → `CardInstance[]`(서버 호출 없이 오늘 재고 재현, 배열 인덱스 = slotIndex). `computeShopSeeds(uid)` → `{dateSeed,userSeed}`. 이미 산 슬롯 표시는 `select * from public.card_shop_purchases where profile_id = auth.uid() and date_seed = <오늘 shopDateSeedFromMs>`(RLS 본인만) 의 slot_index 로 버튼 비활성.
- **구매**: `buyShopCard(slotIndex)` → `CardBuyResult | null`(null=미설정/오프라인). `{ ok, cardId?, rarity?, credits?, price?, code? }`. ok=false 서버 거부 code: `bad-slot`·`storage-full`·`insufficient-credits`·`already-bought`·`no-profile`. 성공 후 **save.credits 는 서버가 진실 → profileSync pull 필요**(repair_defense 와 동일).
- **합성**: `fuseCards([id1,id2,id3])` → `CardFuseResult | null`. `{ ok, cardId?, rarity?, promoted?, code? }`. code: `need-three`·`dup-ids`·`rarity-mismatch`·`not-owned`. 성공 시 보관함 재조회(3장 소모·1장 생성 서버 반영). `promoted`=상위 등급 승급.
- **분해**: `salvageCard(cardId)` → `CardSalvageResult | null`. `{ ok, salvaged?, credits?, rarity?, note? }`. ok=false → note='not-owned'. 성공 후 profileSync pull(서버 환급).
- **보관함 조회**(Lane C 계약 재확인): `select * from public.defense_cards where profile_id = auth.uid()`(RLS 본인). rarity·charges_left 정규 컬럼 + card jsonb.
- **에러 코드 HTTP 매핑**(cards EF): 400=형식(bad-slot/need-three/unknown-action), 401=미인증, 409=비즈니스 거부(storage-full/insufficient-credits/already-bought/not-owned 등), 500=서버/apply 오류. 클라 래퍼는 전부 `{ok:false, code}` 또는 예외→null 로 흡수.

## 원격 적용 필요 목록 (리드/사용자 승인 항목 — Lane C 목록에 추가)
1. **신규 마이그레이션 적용**: `supabase/migrations/20260718170000_m6_card_economy_rpc.sql`
   - 신규 테이블 `card_shop_purchases`(RLS select-own, 쓰기 정책 부재) + 함수 `apply_card_purchase`·`apply_card_fusion`·`apply_card_drop`(service_role 전용).
   - **선행 필수**: Lane C 마이그레이션 `20260718160000_m6_defense_cards.sql`(defense_cards·caller_is_service_role 등)이 먼저 적용돼 있어야 함.
   - 적용 후 `get_advisors(security)` 신규 WARN 점검.
2. **신규 EF 배포**: `cards`(`deno task bundle` → deploy, verify_jwt=true 유저 인증). 
3. **EF 재배포**: `verify-invasion`(index.ts 방어 성공 드랍 블록 추가 — `deno task bundle` 후 deploy). 카드 미장착·공격자 승리 침공은 무회귀(드랍 블록은 방어자 승리 분기에서만).
