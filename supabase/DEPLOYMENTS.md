# Edge Function 배포 이력

원격 Supabase 프로젝트 `qxgbxwyccbxokdgwxcuw` 에 무엇이 언제 올라갔는지 적는다.

**왜 이 파일이 생겼나(2026-08-03).** 이날 계보 레인 배포를 준비하며 배포본과 `origin/main` 번들을
해시로 대조했더니, `verify-commission` 이 **이틀간 스테일**이었다(배포본 241,045 B ↔ main 번들
241,287 B). 아무도 몰랐던 이유는 두 가지다:

1. **리포에 배포 이력을 적는 자리가 없었다.** "무엇이 올라가 있나"를 아는 유일한 길이 과거 PR
   본문을 뒤지는 것이었고, 그마저 버전 번호만 있어 **번들 소스 커밋을 알 수 없었다.**
2. **문서가 능동적으로 오도했다.** README §서버 배포와 배포 스킬이 "배포 대상은
   `verify-invasion` 하나뿐"이라고 단언하고 있었다 — `verify-commission` 이 추가된 뒤에도
   갱신되지 않아서, `src/sim`·`src/run` 을 건드린 레인들이 그 문장을 믿고 재배포하지 않았다.

이 저장소가 반복해 겪는 결함("배선이 통째로 없는데 그린")의 **배포 축 재현**이다. 같은 일이
2026-07-21 에도 있었다(M8 1회차 배포가 배선 이전 커밋을 올려 두고 문서만 "완료"였다).

## ✅ 해소됨 — ADR-0049 배포 의존 (2026-08-07)

**아래 지뢰는 ADR-0050 구현(PR #358)과 이날 재배포로 해소됐다.** 처방은 「EF 재배포」가 아니라
**재실행 자체의 삭제**였다 — `verify-*` 가 sim 을 안 싣게 되면서 *"신 sim 클라 ↔ 구 sim 서버"*
스큐가 **원리적으로 생길 수 없게** 됐다. `verify-invasion` 번들이 249,799 B → **3,399 B** 로
줄어든 것이 그 물증이다.

⛔ **아래는 이력이다.** "클라 배포 전에 EF 를 먼저"가 더 이상 **이 사유로는** 성립하지 않는다.
⚠️ 다만 **EF 자체의 계약이 바뀌면 순서는 여전히 있다** — 이번에도 `run_credits`(클라가 새로
보내는 필드)와 어픽스 stat 어휘 때문에 순서가 있었다. 사라진 것은 *"sim 을 만졌으니 배포"* 라는
**상시 의존**이지 순서 개념 자체가 아니다.

<details>
<summary>▼ 이력 — 2026-08-06 시점의 미결</summary>

### ⚠️ 미결 배포 의존 — ADR-0049 레인 (2026-08-06)

**ADR-0049(스킬 전면 재구축) 가 `src/sim/**` 를 바꿨는데 EF 를 재배포하지 않았다.** 배포된
`verify-invasion` v48 · `verify-commission` v14 는 **구 sim** 을 번들하고 있다.

의도적 결정이다 — ADR-0050 이 `verify-*` 재실행 검증 자체를 폐기하기로 했으므로(구현은 후속
레인) 곧 지워질 함수에 9단계 배포 절차를 쓰지 않는다.

### 그래서 남은 지뢰 하나 — 반드시 지켜라

> **클라이언트를 배포하기 전에, EF 재배포 또는 ADR-0050 구현 중 하나가 먼저 끝나 있어야 한다.**

`verify-*` 는 **재실행 대조**다. 신 sim 클라가 제출한 리플레이를 구 sim 서버가 다시 돌리면
해시가 갈려 **정직한 런이 전부 `final-hash-mismatch` 로 반려**된다. 순서를 어기면 침공·의뢰
제출이 통째로 막히고, 증상이 "가끔 실패"가 아니라 "전부 실패"라 배포 직후 바로 드러난다.

지금은 무해하다 — 신 sim 이 아직 클라로 나가지 않았다.

</details>

## ✅ 적용 완료 — 촉매 축 미러 + 공명 마이그레이션 (2026-08-08, ADR-0052 / PR#380)

`20260808060000_catalyst_axis_mirror_resonance.sql` 을 원격 적용했다
(`scripts/apply-catalyst-axis-mirror-migration.ps1`). 사후 검증 실측:

```
catalyst_defs        rows=48  null_axis=0  null_mult=0  empty_tags=0  tags>2=0  cap>2.6=0
cap_axis 분포        drop 17 · rarity 10 · resource 9 · xp 8 · catalystDrop 4
catalyst_resonances  rows=12  tags=6  bad_tier=0
catalyst_cap_resource_mult_max()  = 3.2      (구 2.2 — 48C3 전수 스윕 자원축 실측 3.2000)
consume 게이트       duplicate=True  signature=True  compose_0.5=True
실행 권한            consume_catalysts: authenticated=True  anon=False
```

`cap_axis` 의 `drop 17 / resource 9` 는 `id 16`·`id 34` 의 상한 축을 자원→드랍으로 옮긴
사용자 판정(2026-08-08)이 서버까지 반영됐다는 뜻이다.

### ⚠️ EF 재배포는 **불필요**했다 — 해시로 확정했다

`src/sim/**` 을 광범위하게 고친 레인인데도 두 함수 다 배포본과 **바이트 동일**이다.
ADR-0050 이후 두 EF 가 sim 을 안 싣기 때문이다(이 파일 위쪽 §해소됨 절이 그 사실의 정본이다).

```
verify-invasion    배포본 3,399 B  =  새 번들 3,399 B   sha 6267F36E02B5E9DE31C85B338C0E5A004199BB54F9050531CDFEA7806CD9439A
verify-commission  배포본 5,721 B  =  새 번들 5,721 B   sha D47C7749821845E15F0769C092000583D77D9743CFA6BB021A781566336A17BF
```

⛔ **이 레인이 처음에 「EF 재배포 필수」라고 잘못 보고했다.** 원인은 `supabase/functions/AGENTS.md`
와 배포 스킬 문서가 **재실행 삭제 이전 문장을 그대로 갖고 있었기 때문**이고, 정작 정본인 이 파일은
맞게 적혀 있었다. 두 문서를 이 커밋에서 고쳤다.
→ **재배포 판정은 문장이 아니라 아래 §해시 대조로만 하라.**

### ⚠️ 적용 스크립트의 검증기가 통과할 수 없는 검사를 갖고 있었다

`(e) 중복 거부` 게이트를 `pg_get_functiondef(...) ilike '%duplicate%'` 로 찾고 있었다. 이 리포는
전면 한글이라 그 게이트의 주석은 *"중복 거부"* 이고 코드는 `count(distinct cid) <> v_len` 이다 —
**영단어 `duplicate` 가 등장할 수 없어 게이트가 멀쩡한데도 매번 `[FAIL]` 을 냈다**(첫 원격 적용에서
실제로 그랬다). 실제 식별자(`v_distinct`)를 보도록 고쳤다.
**통과할 수 없는 검증기는 없는 것보다 나쁘다 — 다음 레인에게 빨간 줄을 무시하도록 가르친다.**
`%signature%` 가 살아남은 것은 `SIGNATURE_CAP` 이 영문 상수명이라서였을 뿐이다.

## ✅ 적용 완료 — 아이템 서버 원장 레인 마이그레이션 6건 (2026-08-08)

**ADR-0050 §3 단계 1·2 의 서버측이 전부 원격에 올라갔다.** 적용 스크립트는
`scripts/apply-item-ledger-migrations.ps1`(재실행 안전 — 전부 create-or-replace ·
`if not exists` · `on conflict do nothing`).

| 마이그레이션 | 내용 | PR |
|---|---|---|
| `20260808000000_pve_run_registration` | `pve_runs.started_at` · `begin_pve_run` · 축 D 캡(60/h) | #362 |
| `20260808010000_item_grants_ledger` | `server_secrets` · `item_grants` · `drop_odds_mirror` · `grant_run_drops` · `mark_item_grant_applied` | #363 |
| `20260808020000_invasion_rate_cap` | 축 A 침공 빈도 캡(20/h) | #364 |
| `20260808030000_refine_server_roll` | `roll_refine` — 정련 차감+굴림을 한 트랜잭션으로 | #367 |
| `20260808040000_save_item_seal` | `profiles.save` 아이템 **증가분 봉인** + `items`·`ships` RLS 축소 | #371 |
| `20260808050000_telemetry_rollup` | 일별 롤업 큐브 둘 + `rollup_telemetry_daily` + 400일 GC(ADR-0051) | #372 |

**적용 순서는 파일명 순서였고 그것이 계약이다** — `20260808010000` 이 `20260808000000` 의
`started_at` 에 의존한다(뒤집으면 `grant_run_drops` 가 없는 컬럼을 참조한다).

⭐ **EF 는 여섯 다 무관하다** — 순수 SQL 이라 `verify-*`·`daily-reward` 재배포가 필요 없었다.

### 사후 검증 (스크립트가 매 실행마다 다시 잰다)

`postgres` 롤로 도는 검증이라 **객체가 실재하고 ACL 이 맞다**까지만 증명한다 — *"가드가
무는가"* 는 증명하지 않는다(그건 authenticated 롤이 필요하다). 7절 전부 통과:

- 객체 14종 존재(`started_at`·`begin_pve_run`·`server_secrets`·`item_grants`·
  `drop_odds_mirror`·`grant_run_drops`·`mark_item_grant_applied`·`roll_refine`·
  `seal_save_items`·`save_item_ids`·`item_id_ledgered`·큐브 2·`rollup_telemetry_daily`)
- ⭐ **봉인이 두 가드 본문에 실제로 배선됨** — 함수가 존재하는 것만으로는 아무것도 아니다.
  가드가 안 부르면 봉인은 죽은 코드이고 세이브 위조 경로가 그대로 열려 있다.
  `guard_profiles_client_write` 가 `seal_save_items(old.id, old.save, new.save)` 를,
  `guard_profiles_client_insert` 가 `seal_save_items(new.id, …)` 를 부르는지 본다.
- ⭐ **그 가드를 실은 트리거 둘이 여전히 붙어 있음** — 아무것에도 안 붙은 완벽한 함수 본문은
  봉인이 없는 것과 같다.
- `items`·`ships` 에 `FOR ALL` 정책 0개 + `*_select_own` 1개씩(읽기까지 막히면 안 된다)
- `item_grants` 에 클라 쓰기 정책 0개 · `server_secrets` 에 정책 0개(완전 비공개)
- `server_secrets` 1행 · 32바이트 이상(값은 **출력하지 않는다**)
- 텔레메트리 cron 2건 등록

### ⚠️ 이 배포에서 밟은 함정 — pgcrypto 는 `extensions` 스키마다

첫 시도가 `ERROR: 42883: function public.gen_random_bytes(integer) does not exist` 로 터졌다.
`20260808010000`·`20260808030000` 이 pgcrypto 함수를 `public.` 으로 한정하고 있었다(PR #374 로
교정). Supabase 는 pgcrypto 를 **`extensions`** 에 심으므로 `create extension if not exists
pgcrypto;` 는 **조용한 no-op** 이고 `public.` 한정은 영영 안 맞는다. `gen_random_uuid` 만
반대로 `pg_catalog` 에도 있어 **한정 없이** 써야 `set search_path = ''` 아래서도 풀린다.

⭐⭐ **그 결함이 두 PR 을 통과해 머지된 이유가 이 리포의 구조적 사각이다** — SQL 계약 테스트는
전부 마이그레이션을 **텍스트로 읽어** 단언하고 **실행하지 않는다.** `pnpm verify` 가 전량
초록인 채로 **적용 불가능한 마이그레이션 둘**이 쌓여 있었다. 부류 자체는
`tests/migrationExtensionSchema.test.ts` 가 막지만, **진짜 안전망은 여전히 적용 스크립트의
사후 검증절**이다. 새 마이그레이션을 쓰면 그 절을 같이 늘려라.

(적용은 요청 단위 트랜잭션이라 실패분은 통째로 롤백된다 — 원격이 반쯤 적용된 상태로 남지 않는다.)

⛔ **`server_secrets` 시드 행을 절대 지우지 마라** — `on conflict do nothing` 이라 재적용은
안전하지만, 비밀이 바뀌면 이미 발급된 `item_grants` 행의 시드를 재확정할 수 없어
**아이템이 통째로 달라진다.**

### ✅ 봉인이 실제로 「문다」 — authenticated 롤 실증 (2026-08-08)

위 사후 검증은 `postgres` 롤이라 `is_service_role()` 을 만족해 **봉인 분기를 건너뛴다** — 객체
존재·배선·ACL 까지만 증명하고 *"위조 세이브가 정말 되돌려지는가"* 는 증명하지 못한다.
그 구멍을 `scripts/prove-save-item-seal.ps1` 이 닫는다. `authenticated` 롤을 임의로 써서
(`set local role` + `set local request.jwt.claims`) 실제 클라와 같은 권한으로 위조를 시도한다.

**11/11 통과**(2026-08-08 실측):

| 증명 | 무엇을 막나 |
|---|---|
| P0 정상 저장이 반영된다 | ⭐ **양성 대조.** 없으면 나머지가 전부 공허하다 — RLS 가 조용히 전부 막아도 "위조가 사라졌다"가 참이 된다 |
| P1 원장 없는 `it-{seed}` 제거 | 봉인 본체 |
| P2 grandfather | 기존 보유분이 안 지워진다(적용 순간 전 유저 재산 소실 방지) |
| P3 `it-starter-*` 통과 | 신규 계정이 첫 장비를 잃지 않는다 |
| P4 본인 원장 `drop:` 통과 | 정직한 배송이 막히지 않는다 |
| **P5 남의 원장 `drop:` 제거** | ⭐⭐ **`profile_id` 고정.** `$GB` 는 다른 프로필의 **진짜** 원장 행이다. 이 조건이 빠지면 한 명이 받은 유니크를 전원이 심는다 |
| P6 `ships[].equipped` 도 봉인 | 배열만 지키면 위조자는 장착 칸으로 간다 |
| P7 부수 피해 0 | 레벨·플래그 변경은 살고 위조 아이템만 빠진다(통짜 복원이 아니다) |
| P8 배열 순서 보존 | 위조 안 한 유저에게 "가방이 뒤집혔다"로 보이지 않는다 |
| P9 service_role 은 건너뛴다 | 배송 RPC 가 자기 지급을 되돌리지 않는다 |
| P10 INSERT 도 봉인 | "프로필 지우고 위조 save 로 다시 INSERT" 차단 |

⭐ **P1 과 P9 가 이 증명의 뮤테이션 역할을 한다** — **완전히 같은 SQL** 을 authenticated(제거)와
service_role(보존)로 각각 돌려 **정반대 결과**를 낸다. 프로덕션의 봉인을 일시적으로 망가뜨리지
않고도 *"결과를 만든 것이 봉인이다"* 가 가려진다.

픽스처는 `zz-seal-proof-*` 프로필 셋(+ 런·원장 각 1행)이고 `finally` 에서 `auth.users` 삭제로
연쇄 제거한다. 기존 행은 하나도 읽거나 쓰지 않는다.

### ⚠️ `schema_migrations` 는 원장이지 진실이 아니다 (2026-08-08 감사)

리포 마이그레이션 파일명과 원격 원장을 대조했더니 **둘이 빠져 있었는데 둘 다 실제로는 적용돼
있었다** — `20260805010000_commission_grant_delivery` · `20260727011000_invasion_boss_ramp_order`.

원인: **과거 레인은 supabase MCP `apply_migration` 으로 적용했고 그 도구는 파일명이 아니라
적용 시각으로 version 을 스탬프한다**(`20260727011000` 파일 머리가 그 사실을 적어 두었다).
⇒ **"파일명 version 이 원장에 없다"는 "미적용"이 아니다.** 반드시 **DB 실물**로 확인해라.

`scripts/repair-schema-migrations-ledger.ps1` 이 그 둘을 기록했다. ⭐ **순서가 전부다** — 효과가
이미 있음을 먼저 증명하고 그 뒤에만 원장을 쓴다. 부분 적용을 완료로 기록하면 빠진 절반이
영영 안 보이게 되어 구멍보다 나쁘다.

⭐ **데이터 전용 마이그레이션은 객체 존재로 판정할 수 없다.** `20260727011000` 은 NPC 방어 배치를
다시 시드하는 DO 블록이라 만드는 객체가 0개다. 증명은 **데이터 지문**이었다 — NPC nn 의
`l3.boss.affixSeed = nn*4000` · `level = 1+(3*(nn-1))/2` · `budget_spent = 0`. 실측 20행 중
16행이 공식과 정확히 일치하고 4행은 마이그레이션이 의도한 `boss: null`(하위 4기 미배치)이라
20행이 전부 설명된다.

⚠️ 이 기록이 없으면 누가 `supabase db push` 를 돌릴 때 **보스 램프 DO 블록이 재실행되어 살아
있는 NPC 방어 배치를 조용히 덮어쓴다.**

### 남은 미적용 1건

`20260807000000_catalyst_slot_cap`(`consume_catalyst_slot` 부재로 확인) — **촉매 전반은 사용자가
다른 세션에서 진행한다**(2026-08-08 지시). 이 레인은 손대지 않았다.

### 진단용 조회

`scripts/query-remote.ps1 -Sql "<한 문장>"` 이 같은 PAT·같은 UTF-8 바이트 경로로 읽기 질의를
돌린다. 원격 실태를 확인하려고 일회용 apply 스크립트를 새로 쓰지 마라.

## 현재 상태 (2026-08-07 실측)

| 함수 | 버전 | 배포 시각(UTC) | 번들 SHA-256 | 크기 | 비고 |
|---|---|---|---|---|---|
| `verify-invasion` | **49** | 2026-08-07 13:20:21 | `6267F36E…` | **3,399 B** | ADR-0050 재실행 삭제(PR #358) — **sim 이 번들에서 통째로 빠졌다**(249,799 → 3,399 B, **73배**) · 부팅 스모크 통과(`malformed-invasion-id`) |
| `verify-commission` | **15** | 2026-08-07 13:20:39 | `D47C7749…` | **5,721 B** | 같은 PR + `run_credits` 클라 주장 수용(캡은 `settle_commission` 이 쥔다) · 부팅 스모크 통과(`malformed-run-id`) |
| `daily-reward` | **4** | 2026-08-07 13:20:52 | `8C01F2D2…` | 52,936 B | **어픽스 재편(PR #356)** — `rollItem`·`data/affixes` 를 실어 슬롯별 풀이 서버 굴림에 반영된다 · 부팅 스모크 통과(함수 자체 `unauthenticated` JSON) |
| `verify-invasion` | 48 | 2026-08-06 (본 레인) | `AABF00BD…3966E66` | 249,799 B | `origin/main`(`496bd64`) 번들과 **바이트 동일 확인**(download 재대조) · 부팅 스모크 통과 · 팬텀 은신 해제 배율 침공 게이트 봉합(E2, PR#317) |
| `verify-commission` | 14 | 2026-08-06 (본 레인) | `5FAB275A…7286621` | 245,288 B | `origin/main`(`496bd64`) 번들과 **바이트 동일 확인**(download 재대조) · 부팅 스모크 통과 · 팬텀 은신 해제 배율 침공 게이트 봉합(E2, PR#317) — 직전 배포는 v13(daily-reward 레인, 이 표에 미기록) |
| ~~`verify-invasion`~~ | ~~47~~ | ~~2026-08-04 17:21:36~~ | ~~`A9C9BE69…71992F`~~ | ~~249,759 B~~ | 이전 세대(`22db489`) |
| ~~`verify-commission`~~ | ~~12~~ | ~~2026-08-04 17:21:50~~ | ~~`094107EA…E65E2B`~~ | ~~245,093 B~~ | 이전 세대(`22db489`) |
| `verify-invasion` | 46 | 2026-08-04 15:25:02 | `B245EFEA…FDCD16` | 249,666 B | `origin/main`(`9d03db2`) 번들과 바이트 동일 확인 · 행성 신고 5건(PR#294) |
| `verify-commission` | 11 | 2026-08-04 15:25:18 | `CA0E3BEA…2B134F` | 245,000 B | `origin/main`(`9d03db2`) 번들과 바이트 동일 확인 · 행성 신고 5건(PR#294) |
| ~~`verify-invasion`~~ | ~~45~~ | ~~2026-08-04 14:35:38~~ | ~~`F5E5985B…9BB1E1`~~ | ~~249,506 B~~ | 이전 세대(`33c1681`) |
| ~~`verify-commission`~~ | ~~10~~ | ~~2026-08-04 14:35:53~~ | ~~`097A962B…777781`~~ | ~~244,840 B~~ | 이전 세대(`33c1681`) |
| ~~`verify-invasion`~~ | ~~44~~ | ~~2026-08-04 02:45:16~~ | ~~`C58AF531…C9C283`~~ | ~~246,981 B~~ | 이전 세대(`fc4a659`) |
| ~~`verify-commission`~~ | ~~9~~ | ~~2026-08-04 02:44:29~~ | ~~`5320F168…995B78`~~ | ~~242,309 B~~ | 이전 세대(`fc4a659`) |
| ~~`verify-invasion`~~ | ~~43~~ | ~~2026-08-01 22:13:59~~ | ~~`ED74C76C…F86B30`~~ | ~~245,959 B~~ | 이전 세대(`aeef4ba`) |
| ~~`verify-commission`~~ | ~~8~~ | ~~2026-08-03 07:34:05~~ | ~~`9A581EEF…C40485`~~ | ~~241,956 B~~ | 이전 세대(`7e53f6b`) |
| `modules` | 1 | 2026-07-20 19:24:39 | — | 8,021 B | type-only import — sim 을 번들하지 않아 재배포 대상이 아니다 |
| ~~`verify-run`~~ | — | **삭제됨(2026-08-07)** | — | — | ADR-0050 §결정 1. **한 번도 배포된 적이 없다** — service_role 쓰기가 0건인 순수 재실행 검증기였다 |

2026-07-31 이전 이력은 각 배포 PR 본문에 있다(#84 · #86 · #88 · #141 등).

### v48 / v14 배포 기록 (2026-08-06) — 팬텀 은신 해제 배율 침공 게이트 봉합(PR#317)

`src/sim/world.ts`(`bbc1c79`) — `autoAttack` 의 `SIG_PHANTOM_CLOAK` 소진 지점에
`state.config.invasion3 === undefined` 게이트를 추가. `stepShipSignature` 의 팬텀 분기는
침공(3레이어)에서 aux0/aux1 을 0 으로 묶어 배율을 못 걸게 막아 두는데, 액티브
`as_phantom_disrupt_hi` 는 `buildRunConfig` 가 `activeSlots` 를 무조건 스탬프해 침공에서도
발동한다 — 그래서 이 소진 지점에 게이트가 없으면 침공에서 버프 지속 내내 전 발사가 2.5배가
됐다. 재배포 안 하면 서버가 옛 sim(게이트 없음)으로 침공 리플레이를 재계산해 정직한 제출까지
`final-hash-mismatch` 로 거부된다.

검증(§배포 절차 5.5~7 전부): 폐기용 detached 워크트리(`origin/main` = `496bd64`)에서
`deno task bundle` → `verify-invasion` 249,799 B / `verify-commission` 245,288 B ·
`spb functions download` 재대조 **바이트 완전 동일**(양쪽) · 번들 소스 커밋 `496bd64` ==
`origin/main` · anon 부팅 스모크 두 함수 모두 자기 구조화 거절(`malformed-invasion-id` /
`malformed-run-id`) · 그 `reason` 문자열 배포 번들에서 각각 1회, 대조군
`UNAUTHORIZED_NO_AUTH_HEADER` 는 0회 · 게이트 술어(`invasion3===void 0`, 축약형)가 배포된
`verify-invasion` 번들에 실제로 포함됨을 grep 으로 확인.

`verify-commission` 은 v12 → v14 로 2 증가했다 — 이 표에 미기록이던 v13(daily-reward 레인,
`22db489` 이후)이 그 사이에 있었다.

### v46 / v11 배포 기록 (2026-08-04) — 행성 신고 5건(PR#294)

`src/sim/**` 변경(수축 스폰 마진 · 블록 행 간격 · 레이싱 절차 지형 차단 · 격전 게이트 술어 통합)
→ 재배포 필수 구간이다. 침공 경로의 **의미**는 안 바뀌었지만(수축·블록격파·레이싱은 침공에서
안 돌고, 격전 술어 통합은 동치 리팩터다) 번들 바이트는 갈린다 — §"소스를 건드렸나로 판정하면
두 방향으로 틀린다"의 원칙대로 **배포본을 받아 대조하는 것**으로 판정했다.

검증(§배포 절차 5.5~7 전부): download 재대조 바이트 동일 · 번들 소스 커밋 `9d03db2` ==
`origin/main` · anon 부팅 스모크 두 함수 모두 자기 구조화 거절 + `reason` 문자열 번들 grep 1회.

### v45 / v10 배포 기록 (2026-08-04) — 해저드 반감(PR#292)

**"내 레인은 침공을 안 건드렸다"가 틀린 사례가 하나 더 늘었다.** PR#292 는 PvE 체감을 고치는
레인이었다 — 지형 해저드 추첨 4%→2%, 박격포 쿨다운 2배, 용암 기둥 6→3. 그런데
`GUNNER`(`typeIndex 1`)는 `data/invasion/formations.ts` 의 편대 구성원이라, 그 쿨다운 변경이
**침공 per-tick 해시를 그대로 갈랐다.** 재배포를 안 했으면 정직한 침공 제출이 전부
`final-hash-mismatch` 로 거부됐을 것이다.

판정 근거는 "소스를 건드렸나"가 아니라 **enemy 카탈로그가 침공 편대에 참조되는가**였다.
`data/enemies.ts` 를 만지는 레인은 앞으로도 이 경로를 확인해라 — 파일 이름만 보면 PvE 로 보인다.

검증(§배포 절차의 5.5~7 전부):
- `spb functions download` 재대조 → 배포본이 로컬 번들과 **바이트 동일**(위 표의 해시·크기).
- 번들 소스 커밋 `33c1681` == `origin/main` 확인.
- 부팅 스모크(anon 인증 POST `{}`): `verify-invasion` → `{"status":"rejected","reason":"malformed-invasion-id",…}`,
  `verify-commission` → `{"status":"rejected","accepted":false,"reason":"malformed-run-id"}`.
  두 `reason` 문자열 모두 배포한 번들에서 `grep` 1회 — 게이트웨이가 아니라 우리 코드가 실행됐다.

### v44 / v9 배포 기록 (2026-08-04) — 밸런스 5레인 통합, **둘 다 필수였다**

PR#280(침공·의뢰·행성 세 축 동시 복구)의 후속이다. 이번엔 스큐를 뒤늦게 발견한 것이 아니라
**머지 시점에 재배포가 필수임을 알고 있었다** — 두 함수가 각각 다른 이유로 걸렸다:

- `verify-commission` — `COMMISSION_WAVE_SEGMENTS_PER_SEGMENT`(3 → 2)가 번들 안에 있다.
  안 나가면 정직한 의뢰 런이 전부 `outcome-mismatch` 로 거부된다.
- `verify-invasion` — `src/sim` 의 발사 간격이 정수 틱 → 고정소수점(1/256틱)으로 바뀌어
  **침공 per-tick 해시가 실제로 갈렸다**(해시 골든 3/3 이 그 사실을 잡았다). 서버가 옛 sim 이면
  정상 침공 리플레이가 전부 거부된다.

마이그레이션 2건(`20260803020000` 침공 램프 · `20260803030000` 의뢰 구간)과 **쌍으로** 나갔다.
⚠️ 두 마이그레이션은 원래 **같은 타임스탬프**였다 — `schema_migrations.version` 이 PK 라 원격에서
한쪽이 조용히 거부됐을 것이고, 통합 레인이 리네임으로 잡았다.

검증 4종 전부 통과: 버전 증가(43→44 · 8→9) · **download 재대조 해시 완전 일치**(양쪽) ·
부팅 스모크가 함수 자신의 구조화된 거절 반환 · 그 `reason` 문자열이 배포 번들에 **각각 1회**.

### v8 배포 기록 (2026-08-03) — 스큐가 **또** 생겼다

PR#263(의뢰 확정 경험치)이 `src/run/commissionConstants.ts` 에 함수를 하나 더하면서 번들이
241,287 → 241,956 B 로 커졌다. 그 함수는 EF 가 **부르지 않는데도** 커진 것이라(트리셰이킹이
안 걷어냈다) "소스를 건드렸나"로는 판정이 안 되는 사례가 하나 더 쌓였다. PR#264 레인이
바이트 대조로 잡아 재배포했다.

⚠️ **이 파일이 이번에도 유일한 발견 경로였다.** 표에 적힌 v7 크기와 로컬 번들 크기를 눈으로
비교하지 않았으면 그대로 지나갔다. `src/run/commission*` 을 건드린 레인은 머지 **직후**
`deno task bundle` 로 바이트를 재고 이 표와 대조해라.

부팅 스모크(anon 인증 POST `{}`)는 `{"status":"rejected","reason":"malformed-run-id"}` —
게이트웨이 401 이 아니라 **함수 자신의 응답**이므로 부팅이 증명됐다.

## 배포 대상은 **셋**이다 (2026-08-07 전면 개정 — ADR-0050)

⛔ **`src/sim/**` 은 더 이상 배포 트리거가 아니다.** 이 절은 2026-08-07 이전까지
*"`verify-invasion`·`verify-commission` 이 각각 `src/sim` 을 번들에 통째로 싣고 서버가 그
번들로 리플레이를 재계산하므로, 시뮬이 바뀐 채 방치하면 제출이 전부 거부된다"* 였다.
**재실행이 삭제돼(ADR-0050 §결정 1) 그 의존이 통째로 사라졌다** — 번들에서 sim 이 빠졌다.

| 함수 | 재배포 트리거 |
|---|---|
| `verify-invasion` | **그 함수 자체의 코드**(`index.ts`)를 고쳤을 때. 리포 본체 import 가 **0건**이다 |
| `verify-commission` | 위 + `src/run/commission*`(타입·상수를 여전히 import 한다) |
| `daily-reward` | `data/dailyReward*`·`data/coreModules`·`data/economy`·**`data/affixes`**·`src/items/roll`·`src/items/requiredLevel`·`src/items/uniques`·`data/uniques`·`src/save/progressionPath` 등 **아이템 굴림 축**(`deno.json` 의 `//deploy` 가 전수 목록) |

⚠️ **`daily-reward` 가 이 표에 늘어난 것이 이번 개정의 핵심이다.** 그 함수는 서버가 **아이템을
굴리는** 유일한 자리라 어픽스·유니크·요구 레벨이 바뀌면 반드시 따라가야 하는데, 이 문서가
2026-08-07 까지 그 사실을 **한 줄도 적지 않았다**(같은 형태의 스테일이 재발할 자리였다).

⚠️ **재실행 의존이 사라졌다고 「순서」까지 사라진 것은 아니다.** EF 와 클라가 주고받는 **계약**이
바뀌면 여전히 순서가 있다 — 이번에도 `run_credits`(신 클라만 보낸다)와 어픽스 stat 어휘
(신 클라만 해석한다)가 그랬다. 방향은 반대다: **계약을 받는 쪽이 먼저** 나간다.

## 재배포가 필요한지 판정하는 법 — 추정하지 말고 바이트로 봐라

"소스를 건드렸나"로 판단하면 두 방향으로 틀린다. **안 건드린 것 같은데 바뀌어 있고**(공유
모듈을 통해), **건드렸는데 안 바뀌어 있다**(트리셰이킹이 미사용 export 를 걷어낸다 — 2026-08-03
계보 레인이 `data/lineage.ts` 에 함수를 둘 추가했는데 EF 번들은 바이트 동일이었다).

배포본을 **직접 받아 대조**하는 것이 유일하게 확실한 방법이다:

```powershell
# 1) origin/main 커밋에 폐기용 detached 워크트리를 만들고 번들을 굽는다
git worktree add --detach <path> $(git rev-parse origin/main)
cd <path>/supabase/functions/<slug>
deno task bundle                      # → dist.index.js

# 2) 지금 배포돼 있는 것을 받아온다 (index.ts 를 덮어쓰므로 번들을 먼저 복사해 둘 것)
cd <path>
. $PROFILE                            # spb 로드 (dot-source 없으면 안 잡힌다)
spb functions download <slug> --project-ref qxgbxwyccbxokdgwxcuw

# 3) 해시 비교 — 같으면 재배포 불필요
Get-FileHash supabase/functions/<slug>/index.ts     # 배포본
Get-FileHash <복사해 둔 dist.index.js>               # origin/main
```

**어느 커밋이 원인인지 가르는 법**: 의심 파일만 이전 커밋으로 되돌려 재번들하고 해시를 다시
본다(`git checkout <sha> -- <file>`). 2026-08-03 에 이 방법으로 "계보 레인은 무관하고 스큐는
그 이전부터 있었다"를 확정했다.

## 배포 절차

전체 절차·함정은 `.omc/skills/planet-blitz-supabase-deploy-workflow.md` 가 정본이다. 이 파일에는
**이력**과 **판정법**만 둔다. 아래는 그 절차에서 이번에 새로 밟은 함정 하나다.

⚠️ **스테이징 `config.toml` 은 BOM 없이 써라.** PowerShell 5.1 의 `Set-Content -Encoding utf8` 은
BOM 을 붙이고, Supabase CLI 의 TOML 파서가 이를 거부한다:

```
failed to merge file config: While parsing config: toml: invalid character at start of key: ï
```

내용이 ASCII 뿐이면 `-Encoding ascii` 가 가장 간단하다.

## 배포 후 반드시 할 것

1. **버전 증가 확인** — `spb functions list --project-ref qxgbxwyccbxokdgwxcuw`.
2. **올라간 바이트 확인** — 다시 `download` 해서 로컬 번들과 해시가 같은지 본다. 배포 명령이
   성공했다는 것과 의도한 번들이 올라갔다는 것은 다른 주장이다.
3. **부팅 스모크** — anon 키로 게이트를 통과시켜 **함수 본체**까지 닿게 한다. 인증 없이 때리면
   `401 UNAUTHORIZED_NO_AUTH_HEADER` 가 오는데 이건 게이트웨이가 낸 것이고 **함수는 부팅조차
   하지 않았다**.

```powershell
$anon = <spb projects api-keys 로 얻은 anon 키>
Invoke-WebRequest -Uri "https://qxgbxwyccbxokdgwxcuw.supabase.co/functions/v1/<slug>" `
  -Method Post -Headers @{ Authorization = "Bearer $anon"; apikey = $anon } `
  -ContentType 'application/json' -Body '{}'
```

기대 응답은 **함수 자신의 구조화된 거절**이다:

| 함수 | 기대 응답(HTTP 400) |
|---|---|
| `verify-invasion` | `{"status":"rejected","reason":"malformed-invasion-id",…}` |
| `verify-commission` | `{"status":"rejected","accepted":false,"reason":"malformed-run-id"}` |

4. **그 `reason` 문자열이 배포한 번들에 있는지 `grep` 으로 대조** — 정상이면 1회다. 대조군으로
   `UNAUTHORIZED_NO_AUTH_HEADER` 를 같이 세면 0회여야 한다(있다면 게이트웨이 응답을 함수 응답으로
   오독한 것이다). 이 대조까지 해야 "우리 코드가 실행됐다"가 성립한다.

## 이 파일을 갱신하는 시점

배포할 때마다 위 표를 갱신한다. **버전 번호만 적지 마라** — 번들 해시와 소스 커밋이 없으면
다음 사람이 "무엇이 올라가 있나"를 다시 알 수 없고, 그게 이 파일이 생긴 이유다.

## ✅ 적용 완료 — 의뢰서 발령 확률 30% (2026-08-08, PR#391 / #392 / #393)

`20260808070000_commission_issue_rate.sql` 을 원격 적용했다
(`scripts/apply-commission-issue-rate-migration.ps1` — 재실행 안전).

올라간 것 셋:
1. `commission_issues.skip_reason` 도메인에 **`'roll'`** 추가. **이름을 가정하지 않는 DO 루프**로
   `skip_reason` 을 참조하는 check 제약을 전부 걷어낸 뒤 정본 하나를 세운다(PR#393).
2. `issue_commission_for_run` 에 **게이트 4b**(`ISSUE_CHANCE_CP = 3000` = 30%). 위치가
   **세 상한 뒤 · 계급 롤 앞**이고 그것이 방어 계약이다(.sql 머리말 참조).
3. `revoke all on function … from public/anon/authenticated/service_role` 4줄.

사후 검증 실측(스크립트 7항목 전부 통과):

```
gate               const_3000=True  roll_branch=True
본문 오프셋        stock=4108 < roll=4556 < grade=5213 < horizon=6806   (순서 계약 성립)
skip_reason 제약   1개 (commission_issues_skip_reason_check) · 'roll' 허용=True
'roll' insert      통과(롤백) · 음성 대조군(미등록 라벨) 거부됨
실행 권한          anon=False  authenticated=False  service_role=False  public=False
트리거             pve_runs_issue_commission = 1
commission_issues  rls_on=True  policies=0        (skip_reason 클라 노출 경로 없음)
schema_migrations  20260808070000 = 1행
```

**본문 오프셋 4개를 순서로 재는 것이 이 배포의 핵심 검증이다.** 게이트가 상한보다 앞에 있으면
빈도 상한이 세는 `claimed_victory` 행이 롤에 좌우돼 위조 처리량 방어가 새고, `horizon` 이 롤보다
앞이면 미발령 런이 쿨다운 지평을 밀어 누적기 불변이 깨진다. 값 대조로는 둘 다 안 잡힌다.

`public=False` 는 **PR#391 이 떨어뜨렸던 revoke 4줄이 실제로 올라갔다는 물증**이다. 그 누락은
in-order 원격에서는 `create or replace` 가 ACL 을 보존해 **증상이 0** 이라 오직 이 관측으로만 확인된다.

### 재적용으로 첫 적용을 확증했다

1차 실행은 `'roll'` insert 프로브가 `profile_id` 에 null 을 넣어 **NOT NULL 위반**으로 죽었다 —
마이그레이션은 이미 적용된 뒤였고 실패한 것은 검증기다. 프로브를 고쳐 재실행했더니 전제 조건이
`already_gated=True` 로 나왔다(1차에서는 False). **그 전이가 첫 적용이 성립했다는 증거**다.
프로브에 **음성 대조군**(미등록 라벨은 거부되어야 한다)을 함께 넣었다 — 없으면 제약이 아예 없는
테이블에서도 통과한다.

⛔ 같은 함정을 촉매 스크립트가 먼저 밟았다(§위 "통과할 수 없는 검증기"). 이번은 프로세스가 아니라
**프로브 데이터**가 원인이라 형태가 달랐다. 교훈은 같다: **검증기 자신을 먼저 통과시켜라.**

### EF 재배포는 불필요하다 — 문장이 아니라 구조로 판정했다

어떤 EF 도 `src/sim` 을 import 하지 않는다(ADR-0050 §결정 1이 재실행 검증을 삭제했다).
`verify-commission` 은 `src/run/commission.ts` 의 **타입만** 가져온다(`import type`, 1줄).
이번 변경은 SQL 함수 본문과 제약뿐이라 번들에 닿는 축이 아예 없다.

### 클라 선행도 불필요하다

`COMMISSION_ISSUE_CHANCE_CP`(TS)는 **테스트 전용 미러**다 — 런타임 소비처가 0건이고 드리프트
테스트만 읽는다. 게이트는 전적으로 서버측이며 의뢰서를 **더 적게** 발령하는 방향이라 구 클라가
어긋날 표면이 없다. (촉매 `SLOT_CAP` 8→3 은 반대였다 — 서버가 클라가 아직 허용하는 편성을
거부하기 시작해서 클라 선행이 필수였다.)

### 관측할 것 — 실효 발령률

```sql
select coalesce(skip_reason, 'GRANTED') as outcome, count(*)
  from public.commission_issues
 where created_at > now() - interval '1 day'
 group by 1 order by 2 desc;
```

`'stock'` 을 통과한 행 중 **약 70% 가 `'roll'`** 이면 30% 게이트가 의도대로 도는 것이다.
⚠️ "상한보다 확률이 먼저 문다"고 읽지 마라 — 실측 p50 `finalTick` 이 782틱(≈13초)이라 반복
플레이어는 `'rate'`(시간당 20 주장)에 **상시 닿는다**. 실효 = min(20/h 주장) × 30% 다.

## ✅ 적용 완료 — 설계도 지급 빈도 캡 (2026-08-08, 확률 레인 후속)

`20260808080000_blueprint_grant_cap.sql` 을 원격 적용했다
(`scripts/apply-blueprint-grant-cap-migration.ps1` — 재실행 안전).

**왜:** `grant_blueprints` 에 **빈도 상한이 없었다.** 인증된 사용자가 호출 1회당 32장(행 8 ×
장수 4)을 **무제한** 적립할 수 있었다. ADR-0026/0027 의 의도된 트레이드오프였지만 그 수용
기준은 절대가 아니라 **상대** 기준이다 — *"치터의 이득이 최상위 정직 유저의 파밍 속도로
유계된다"*. PR#391 이 정직한 획득률을 런당 약 7~14% → **정확히 3%**(최대 1장)로 약 5배 낮추는
동안 위조 천장은 그대로였다. **비율 기준이 5배 벌어진 것**이고, 보안 리뷰가 이 레인이 새로
만든 위험으로 적발했다. 처방은 확률 되돌리기가 아니라(3% 는 지시받은 값) **다른 축 넷이 이미
가진 캡을 이 축에도 조달하는 것**이다.

올라간 것 셋:
1. `blueprint_grant_log` — 캡의 분모. **RLS 켜고 정책 0개**(분모를 읽으면 회피 타이밍이 노출된다).
2. `grant_blueprints` 재정의 — 시간당 12 · 하루 60, **총 장수** 기준. 프로필 행 잠금 + 전부/전무 거부.
3. pg_cron 30일 GC.

사후 검증 실측(8항목 전부 통과):

```
축 D 분모        CAP_RUNS_PER_HOUR = 60  (원격에서 실제로 강제됨을 확인)
캡               hour=12  day=60
구조             sum_numerator=True  row_lock=True
본문 오프셋      hour_cap=2302 < day_cap=2668 < grant=2954 < log=3476
log 테이블       rls_on=True  policies=0  cap_index=1
실행 권한        anon=False  authenticated=True  public=False
약탈 경로        loot_defense_blueprint 건재 · authenticated 실행 불가(유지)
캡 분모 프로브   통과(롤백) · 잔여 0
GC cron          1행 (pg_cron 켜져 있음)
```

### ⚠️ 값이 맞아도 구조가 어긋나면 캡은 무력하다 — 그래서 오프셋을 잰다

넷 중 하나만 틀어져도 캡이 뚫린다. **값 대조로는 전부 안 잡힌다:**

| 어긋남 | 결과 |
|---|---|
| 분자가 총 장수 아니라 **호출 수** | 호출 1회에 32장을 실어 **32배** |
| 프로필 행 **잠금 부재** | 병렬 호출 N개가 각자 "여유 있음"을 읽어 **N배** |
| 캡 판정이 **지급 뒤** | 부분 지급 발생, 캡이 사후 통보 |
| 원장 기록이 **다른 트랜잭션** | 앱이 사이에 죽으면 지급은 남고 분모가 비어 캡이 조용히 열림 |

`tests/blueprintGrantCap.test.ts` 가 넷 + 미러 값을 잠근다. **뮤테이션 5종으로 실증했다** —
각각을 일부러 어긋내면 해당 단언이 정확히 하나 빨개진다.

### 캡 값의 유도 — 임의값이 아니다

```
정직한 분모 = 축 D CAP_RUNS_PER_HOUR = 60/h   (20260808000000 이 강제)
설계도      = 클리어당 3%, 최대 1장            (BLUEPRINT_RUN_CHANCE_CP = 300)
시간당 기대 = 60 x 0.03 = 1.8장   -> Poisson(1.8) P(X>=12) ~ 1.5e-6 (약 5.5σ)
하루 기대   = 16h x 60런 x 0.03 = 28.8장 (sd 5.3) -> 60 은 약 5.9σ
```

실측 런 길이가 2~5분이라 시간당 12~30런이 전형이고 **60 은 캡이지 전형값이 아니다** — 위
계산은 가장 관대한 쪽이다. **하루 캡이 실질 구속**이다: 시간 캡만 두면 참을성 있는 공격자가
하루 288장(12×24)을 쓸 수 있어 방어가 반쪽이 된다.

### 클라 무수정 · 구 클라 호환

입력·반환 형상이 **동일**하고 거절 코드 둘(`'rate'` · `'rate-day'`)만 늘었다. 클라는 이 RPC 를
fire-and-forget 으로 부르며 이미 실패를 삼키므로(`src/net/blueprints.ts`) 캡 거부는 조용한
no-op 다 — 5σ 밖 사건이라 정직한 손실은 실질 0 이다(자인).

**형식 상한(행 8 · 장수 4)은 일부러 조이지 않았다.** 새 클라의 정직한 형상은 행 1 · 장수 1
이지만, 캐시된 구 클라(PR#391 이전)는 여러 행을 보낸다 — 조이면 그들이 조용히 거부된다.
총량은 캡이 묶으므로 조일 이유가 없다.

### 건드리지 않은 것

침공 약탈(`loot_defense_blueprint`, service_role 전용) · 의뢰 배송(20260805010000) · 일일
보상(20260805020000)은 **`defense_blueprints` 에 직접 쓴다**(grep 실측 — 이 RPC 를 경유하지
않는다). 셋 다 서버 판정이라 캡 대상이 아니다. 검증 5번이 약탈 경로 건재를 확인한다.

### 남은 것 — 어느 설계도인가는 여전히 클라 권위다

캡이 닫은 것은 **양**이다. 공격자는 여전히 *어느* 설계도인지 고를 수 있어 보스 설계도(가중치
w1, 아르케 전용)를 매번 지정할 수 있다 — **품질 선택** 이득이 남는다. 이것을 닫으려면 롤 자체를
서버로 올려야 하고(ADR-0050 §3 단계 1 의 `grant_run_drops` 형태), 행성별 특산 weight 표를
SQL 로 미러해야 한다. **별도 결정이다** — 이 캡은 ADR-0026 의 상대 기준(파밍 **속도**)을
복원하는 것까지가 범위다.

### 관측할 것

```sql
-- 정직한 플레이어가 캡에 닿으면 유도의 분모가 틀린 것이다(5σ+ 라 일어나선 안 된다).
select profile_id, sum(granted) as day_total
  from public.blueprint_grant_log
 where created_at > now() - interval '1 day'
 group by 1 having sum(granted) > 40 order by 2 desc;
```
