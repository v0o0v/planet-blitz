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
