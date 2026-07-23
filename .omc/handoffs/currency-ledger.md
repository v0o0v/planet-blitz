# 재화 서버 권위 이관 — 클라 워커 인계 (ADR-0027)

서버측(SQL 마이그레이션 `supabase/migrations/20260726000000_currency_server_authority.sql`) 완료.
후속 클라 워커(src/)는 아래 계약대로 미러를 동기화한다.

## (a) 정본
- `public.profiles.credits` / `public.profiles.minerals` (numeric, not null default 0, check ≥ 0) = **재화 정본**.
- `profiles.save` 안의 `credits`/`minerals` 는 이관 후 **표시 미러**로 강등. 서버는 컬럼만 읽고 쓴다.
- 봉인: `guard_profiles_client_write`(BEFORE UPDATE)가 클라 UPDATE 에서 credits/minerals 를 이전 값으로 고정.
  신규 `guard_profiles_client_insert`(BEFORE INSERT)가 클라 INSERT 재화를 0 으로 강제.
  → 클라가 save 를 통짜로 덮어써도(upsertProfile) 컬럼은 불변. 재화 위조 경로 차단.

## (b) 각 RPC 반환 잔액 필드 (클라 미러 동기화 소스)
| RPC | 잔액 필드 | 비고 |
|---|---|---|
| `repair_defense(uuid)` | `credits_left` | 기존 `credits` 도 병기 |
| `spend_profile_currency(...)` | `credits_left`, `minerals_left` | OUT 파라미터(차감 후 잔액) |
| `apply_invasion_result(...)` | `attacker_minerals_left`, `defender_credits_left` | 해당 경로 미발동 시 null. `bonus_minerals`/`defense_credits` 델타 병기 |
| `apply_module_purchase(...)` | `credits_left` | 기존 `credits` 도 병기 |
| `salvage_core_module(uuid)` | `credits_left` | 기존 `credits` 도 병기 |
| `flag_pve_anomalies(...)` | (없음) | 읽기 전용, integer(플래그 계정 수) 반환 |

`spend_profile_currency` 를 호출하는 5 RPC 는 그 값을 각자 `credits`/`minerals` 키로 반환(기존 계약 불변):
`level_up_defense_unit`, `ascend_defense_unit`, `reroll_defense_unit_affixes`,
`promote_defense_unit_rarity`, `craft_defense_unit`.

## (c) 클라가 할 일
1. `save.credits`/`save.minerals` 를 **표시 미러로 강등** — 게임플레이/경제 판정은 서버 잔액만 신뢰.
2. `upsertProfile`(profileSync)의 save 페이로드에서 재화를 **제외**하거나, 보내더라도 서버가 무시함을
   전제로 로컬 미러를 서버 응답으로 덮어쓴다(컬럼은 클라 write 봉인됨).
3. 각 재화 RPC 응답의 위 잔액 필드로 로컬 미러(`profile.credits`/`profile.minerals`)를 갱신.
   `apply_invasion_result` 는 공격자 클라면 `attacker_minerals_left`(null 아닐 때), 방어자 표시엔
   `defender_credits_left` 를 사용.
4. 최초 로그인/동기화 시 서버 프로필의 credits/minerals **컬럼**을 로컬 미러 초기값으로 읽어온다
   (save 안의 값이 아니라 컬럼 — select 시 컬럼을 포함해야 함).

## 검증
- 서버 SQL 은 로컬 실행 불가 → 구문·로직 자체 검토 완료(재화 라인만 치환, 나머지 본문 전수 보존).
- `corepack pnpm typecheck` / `corepack pnpm test` 그린(SQL 만 변경, src 무수정).
- 서버 스모크(`supabase/tests/phase_e_verification.sql` T-E6, `phase_f_verification.sql` T-F2/T-F6)를
  컬럼 기준으로 갱신(수동 실행 스크립트).
