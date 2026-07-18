# Lane C 핸드오프 — 스키마 + EF 카드 권위 주입 + 확정 시 차감

- **브랜치**: `feat/defense-card-system` (Lane B 커밋 `3480ee5` 위, push 안 함 — 리드가)
- **검증**: `npm test` **715 passed**(62 files, Lane B 708 + 신규 7=verifyInvasion 5·netInvasion 2) · `npm run lint` green · `npx tsc --noEmit` green · `deno task check`(verify-invasion EF) green · `deno task verify`/`verify-run`/`verify-invasion`/`verify-pve` 전부 green(Node↔Deno bit-identical, 카드 미장착 경로 무회귀).
- **원격 미적용**: Supabase MCP(apply_migration·deploy_edge_function) 호출 안 함. 리포 파일만.

## Files
- `supabase/migrations/20260718160000_m6_defense_cards.sql` (신규) — 아래 6블록.
- `supabase/functions/verify-invasion/verifyInvasionCore.ts` (수정) — `InvasionServerContext.card?`·`InvasionSnapshotRow.authorityCard`·`SnapshotResolution.snapshot.card` 추가, `resolveSnapshotAuthority` 카드 통과, `verifyInvasion` authoritativeInvasion 에 `card` 서버 권위 오버라이드.
- `supabase/functions/verify-invasion/index.ts` (수정) — 스냅샷 authority.card 로드·주입 배선(라이브 폴백은 카드 미주입).
- `src/net/invasion.ts` (수정) — `InvasionSnapshot.card?` 필드(begin_invasion 응답 카드 전달 경로).
- `src/net/invasionGateway.ts` (수정) — begin_invasion 응답의 `card` 파싱.
- `scripts/deno-verify/verifyInvasion.ts` (수정) — 카드 accept/위조3종/하위호환 게이트(게이트 3.11).
- `tests/verifyInvasion.test.ts`·`tests/netInvasion.test.ts` (수정) — vitest 카드 커버리지.

## Decided
- **카드 권위 = 스냅샷 단일 경로**(정비도·수호와 동형이되 카드는 스냅샷 전용). `begin_invasion` 이 T0 에 방어자 장착 카드+공격자 매치업을 `authority.card = {card, matchup}` 로 접어 고정하고, EF 는 제출 `config.invasion.card` 를 신뢰하지 않고 **스냅샷 card 로 오버라이드**해 재실행. 위조(카드 제거·chargesLeft·매치업 조작)는 재실행 발산으로 거부(deno·vitest 실증).
- **라이브 폴백은 카드 미주입**(ADR-0012 "효력은 스냅샷 고정"). 스냅샷 미배선/스테일/재사용 → resolveSnapshotAuthority 가 live 반환 → EF 는 카드 없이 재실행(=카드 미장착 취급, 하위호환·무회귀). 이때 차감도 없음(스냅샷 없음). **보안 무영향**(항상 accept-축소 방향, 위조 accept 불가). 결과: 스테일(>1h) 스냅샷은 방어자가 카드 보호를 잃되 정직 침공은 그대로 accept.
- **차감 = 확정 시, 스냅샷 card_id 기준**(ADR-0012 "확정된 침공 1건 = 차감 1", 승패 무관). `apply_invasion_result` 가 verified 확정 직후 `invasion_snapshots.card_id` 의 `charges_left` 를 1 감소(바닥 0, `greatest(0,·)`), 0 도달 시 카드 삭제+장착 해제. 쿨다운-거부 경로는 차감 없음(그 전에 return). 동시 침공 다건은 각자 스냅샷 효력 유지, 차감만 바닥 0 정지.
- **장착 = 클라 직접 컬럼 업데이트**(`defenses.equipped_card_id`). `guard_defenses_client_write`(maintenance/budget_spent 봉인)는 **무수정**(별도 트리거 `guard_defenses_equipped_card` 로 소유권만 검증 — 봉인 회귀 위험 0). 카드 내용·횟수는 `defense_cards` RLS(select-only)로 클라 불가.
- **매치업 보수 재구성**(`build_attacker_matchup`): 서버 신뢰 축(`revenge`=revenge_targets_for, `reinvasion`=기존 확정 침공)만 재구성, 원소/무기/CP(fire/cold/lightning/beam/attackerCp/defenderCp/subweaponHeavy)는 보수 기본값(false/0). begin_invasion 이 스냅샷 고정본과 **동일 값을 클라에 반환**하므로 공/수 재현 일관 → 무결성 성립(정직 accept, 위조 거부). 밸런스만 보수적(정적 카운터 6종 중 revenge/reinvasion 만 발동).
- **봉인 전수 보존**(PR#29/#35 교훈): `begin_invasion`(자격 검증·self-invasion raise·수호 주입·유니크 인덱스·grant)·`apply_invasion_result`(caller_is_service_role·락 순서·복수·쿨다운·스왑·복제 약탈·보너스 광물)를 원본 그대로 복사 후 신규 블록만 삽입. 원본 대비 diff 는 신규 declare 변수·카드 블록·카드 조립뿐.

## Rejected
- **카드 economy RPC(buy_shop_card·fuse_cards·drops) SQL 구현**: 카드 생성은 결정론 롤러(`src/items/rollCard.ts`: rollCard·attemptFusion·rollShopRotation, SeededRng)를 써야 하고, 이를 plpgsql 로 bit-identical 재구현하면 상점 로테이션 결정론이 클라와 어긋날 위험이 큼(surface 과대·고위험). → **전용 Edge Function(cards)** 이 정본 설계(공유 TS 롤러 그대로 실행). 아래 §Remaining 훅 지점 참조. `salvage_card` 만 롤러 무관이라 SQL RPC 로 구현.
- **EF 라이브 경로 매치업 TS 재구성**: begin_invasion SQL 매치업 로직을 TS 로 중복 → 발산 위험. 카드는 스냅샷 전용으로 두어 단일 소스(SQL) 유지.
- **guard_defenses_client_write 확장으로 장착 검증**: 봉인 함수 재정의는 회귀 위험(PR#29/#35). 별도 트리거로 분리.

## Risks
- **매치업 원소/무기/CP 축 미발동**: cc-quench/frostward/insulate/refract/armorbreak/disruptor(정적 카운터 6종)는 완전 재구성 전까지 미발동(무결성 무영향, 밸런스만 보수). 완전 재구성(공격자 서버 미러 `ships.equipped`·CP 파싱)은 후속.
- **economy 생성 경로 미구현**: 카드 획득/합성 RPC 부재 → Lane D 는 salvage/장착/차감만 실동작. 생성은 cards EF 배선 후.
- **원격 미검증**: 마이그레이션·EF 는 리포만. 원격 적용 시 `get_advisors(security)` WARN 점검·begin_invasion/apply_invasion_result 봉인 회귀 수동 대조 필요(리드).

## Lane D 계약 (클라가 호출할 RPC/경로)
- **begin_invasion(p_defense_id uuid) → jsonb**: `{ snapshot_id, defender_id, defense_id, layout, maintenance, card }`. `card`(있으면 `{card: CardInstance, matchup: AttackerMatchup}`, 미장착이면 null). 클라: `card` 를 침공 런 `config.invasion.card` 로 실어 runReplay → 제출 시 snapshotId 동봉. `src/net/invasion.ts` `beginInvasion()`·`InvasionSnapshot.card` 로 이미 노출. 자격 미달(비활성·미배치·상위랭크·자기침공) 시 raise → 게이트웨이가 흡수·라이브 폴백(카드 없음).
- **장착 변경(클라 직접)**: `update public.defenses set equipped_card_id = <card_id | null> where id = <own defense>`. RLS `defenses_rw_own` 이 본인 행 허용, `guard_defenses_equipped_card` 트리거가 **자기 소유 카드**만 통과(아니면 `check_violation` raise). 카드 내용·횟수는 불변(defense_cards RLS select-only). 해제는 `equipped_card_id = null`.
- **salvage_card(p_card_id uuid) → jsonb**: `{ ok, salvaged, credits, rarity }` 또는 `{ ok:false, note:'not-owned' }`. 본인 카드 삭제+장착 해제+`save.credits` 환급(SALVAGE_BASE[rarity]+affix×4, data/defenseCards.ts cardSalvageValue 미러). 환급 후 profileSync 로 서버 save.credits pull 필요(repair_defense 와 동일 — 서버가 진실).
- **보관함 조회**: `select * from public.defense_cards where profile_id = auth.uid()`(RLS 본인만). rarity·charges_left 정규 컬럼 + card jsonb.
- **에러 코드**: begin_invasion 자격 미달 = `check_violation`(errcode) 라vise·게이트웨이가 null 폴백. salvage not-owned = `{ok:false}`(raise 아님).
- **보관함 상한(CARD_STORAGE_CAP=20) 동작**: 상한 강제는 **생성 경로(cards EF)** 몫(20장 만석 → 획득 차단). 이 마이그레이션은 상한 컬럼/체크를 두지 않음(생성 RPC 부재라 강제 지점 없음) — cards EF 가 insert 전 `count(*) < 20` 검사.

## Remaining (이 lane 범위 밖 — 훅 지점)
- **cards Edge Function**(신규, 정본 설계): 공유 TS 롤러를 그대로 실행하는 EF. 훅 지점·계약:
  - `buy_shop_card`: 입력 `{ dateSeed(UTC 날짜), userSeed, slotIndex }`. `rollShopRotation(dateSeed,userSeed)`(src/items/rollCard.ts)로 로테이션 재현 → slotIndex 카드 확정 → 서버 credits 차감(profiles.save.credits) + 보관함 20장 상한 검사 + `insert into defense_cards(profile_id, card, rarity, charges_left)`(service_role). dateSeed 는 클라·서버 UTC 날짜 기반 동일(결정론 로테이션).
  - `fuse_cards`: 입력 `{ card_ids: uuid[3] }`. 동급 3장 소유·잔존 검증 → `attemptFusion(seed, rarity)`(서버가 seed 발급) → 3장 삭제 + 결과 1장 insert. 시드 규약은 attemptFusion 계약(nextFloat 승급 판정 → nextU32 결과 시드) 그대로.
  - **방어 성공 보상·보스 드랍**: 훅 지점 = `apply_invasion_result` 의 **방어 실패(else) 분기**(방어자 승 = 방어 성공)에 카드 드랍 롤을 추가. `defenseSuccessDropChance(base, attackerCp, defenderCp)`(data/defenseCards.ts, OQ#2)로 확률 → 서버 시드 롤 → 방어자 defense_cards insert(20장 상한). 보스 드랍은 PvE 보상 경로(별도). **이 마이그레이션은 접점을 열지 않음**(생성 롤러 EF 미배선 상태에서 SQL 단독 드랍은 롤러 부재로 불가) — cards EF 배선 시 함께.
  - 상한 검사·credits 차감·소유 검증은 전부 EF service_role 트랜잭션.

## 원격 적용 필요 목록 (리드/사용자 승인 항목)
1. **마이그레이션 적용**: `supabase/migrations/20260718160000_m6_defense_cards.sql`
   - 신규 테이블 `defense_cards`(RLS select-own, 쓰기 정책 부재)·`defenses.equipped_card_id`·`invasion_snapshots.card_id` 컬럼·트리거 `guard_defenses_equipped_card`·함수 `build_attacker_matchup`·`salvage_card`.
   - **create or replace**: `begin_invasion`·`apply_invasion_result`(봉인 전수 보존 — 적용 후 `pg_get_functiondef` 로 자격 검증·복수·스왑·복제 약탈·유니크 인덱스 잔존 수동 대조).
   - 적용 후 `get_advisors(security)` 신규 WARN 점검(RLS·search_path).
2. **EF 재배포**: `verify-invasion`(verifyInvasionCore.ts·index.ts 변경 — 스냅샷 card 오버라이드). `deno task bundle` 후 deploy. 카드 미장착 침공은 무회귀(스냅샷 card 없음 → 기존 경로).
3. **후속**(별도): cards Edge Function(buy/fuse/drop)·매치업 완전 재구성.
