# 의뢰서 서버 축 — RPC·원장 표면 통독 결과 (§2-1 산출물)

- 작성: 2026-07-31, 의뢰서 구현 레인(서버 축)
- 근거: `supabase/migrations/` 전량(44개) · `supabase/functions/` · `src/net/` · `src/save/settlement.ts`
- 목적: `.omc/plans/commission-system-consensus.md` §Phase B·C 를 **이어받지 않고 다시 세우기** 위한
  사실 기반. 계획 rev7 의 §Phase B·C 는 4라운드 연속 CRITICAL 이 나왔고, 진단은 *"인용은 매번
  100% 맞고 결정이 매번 틀렸다 — 결정이 딛는 구조를 한 홉 더 안 밟았다"* 였다.

---

## 0. 규약

- 마이그레이션 파일명 = `YYYYMMDDHHMMSS_<snake_slug>.sql`. **적용 순서 = 파일명 사전순.**
  `tests/pveRunsColumnContract.test.ts:24-30` 이 이 규약을 `readdirSync().sort()` 로 코드에 고정한다.
- **가장 최근 파일 = `20260802000000_settle_pve_run_column_restore.sql`.** 신규 마이그레이션은
  그보다 큰 타임스탬프를 써야 한다.
- **어떤 함수의 "현재 정의"는 마지막 `create or replace` 다**(계획 Principle 9). 아래 §1 이 정본.

---

## 1. RPC 재정의 이력 — 현행 정의 좌표

| 함수 | 재정의 | **현행 정의(이것만 인용하라)** |
|---|---|---|
| `settle_pve_run(jsonb)` | **5회** | **`20260802000000_settle_pve_run_column_restore.sql:36`** |
| `grant_currency(numeric,numeric,text,jsonb)` | 2회 | **`20260727000000_catalyst_ledger.sql:339`** |
| `consume_catalysts(int[],int)` | 1회 | `20260727000000_catalyst_ledger.sql:211` |
| `apply_invasion_result(uuid,jsonb,boolean)` | **8회** | **`20260726000000_currency_server_authority.sql:255`** |
| `grant_blueprints(jsonb)` | 1회 | `20260722020000_m7b_blueprint_drops.sql:40` |
| `grant_catalyst(int,int)` | 2회 | `20260801000000_catalyst_grant_cap.sql:125` |
| `caller_is_service_role()` | 1회 | `20260717010000_m4_phase_d.sql:35` |
| `is_service_role()` | 1회 | `20260717000000_m4_initial_schema.sql:47` |
| `guard_pve_runs_client_insert()` | 2회 | `20260727000000_catalyst_ledger.sql:142` |
| `guard_profiles_client_write()` | 5회 | `20260731000000_catalyst_shop.sql:109` |

> ⚠️ 계획 rev7 은 `settle_pve_run` 을 "4회 재정의"라 적었다. **실제는 5회**이고, 5번째가
> `20260802000000`(PR#222 의 결함 수정)이다. 4회로 세면 사고를 일으킨 복제본
> (`20260727010000_planet_popularity.sql:263`)에서 세기를 멈추게 된다.

**드롭된 것**: `sample_pve_runs(int)` · `apply_pve_verification(...)` — `20260726000300:49-50`.

---

## 2. 수령자 도출 · 권한 게이트 · 캡 · GUC 대조표

| 함수 | 수령자 도출 | 권한 게이트 | `currency_grants` 기록 | GUC |
|---|---|---|---|---|
| `settle_pve_run` | `auth.uid()` | `authenticated` + `service_role` — **service_role 검사 없음(클라 직접 호출 가능)** | 간접(`grant_currency` 가) | `app.in_settle` 을 **세웠다 끈다**(`:116`, `:122`) |
| `grant_currency` | **`auth.uid()` 고정 — 파라미터 없음** | `authenticated` + `service_role` | **직접 기록(유일 관문)** | `app.in_settle='1'` 일 때만 `resourceMult` 를 읽는다 |
| `consume_catalysts` | `auth.uid()` | `authenticated` + `service_role` | 없음 | 없음 |
| `apply_invasion_result` | **행에서 도출**(`invasions.attacker_id`/`defender_id`) | **`caller_is_service_role()` 예외 + `service_role` 에만 grant(이중)** | **없음 — `profiles` 직접 가산** | 없음 |
| `grant_blueprints` | `auth.uid()` | `authenticated` + `service_role` | 없음(`defense_blueprints` upsert) | 없음 |

전부 `security definer` + `set search_path = ''`.

### 2-1. `grant_currency` 캡 상수 (현행)

| 상수 | 값 |
|---|---|
| `CAP_PVE_RUN_CREDITS` / `_MINERALS` | 5,000 / 5,000 |
| `CAP_SALVAGE_*` | 20,000 / 20,000 |
| `CAP_STORY_CREDITS` | 2,000 (minerals 0) |
| **`CAP_DEFAULT_CREDITS` / `_MINERALS`** | **1,000 / 1,000** ← 미등록 source 가 여기로 떨어진다 |
| `CAP_HOURLY_*` | 50,000 / 50,000 |
| `CAP_DAILY_*` | 300,000 / 300,000 |
| `PLAUSIBILITY_*_PER_TICK` | 2.0 / 2.0 |
| `CAP_RESOURCE_MULT_MAX` | 2.2 |

지급액 = `greatest(0, least(claim, 개연성캡, per-call캡, 누적잔여))`.
**개연성 캡은 `p_source='pve_run'` 일 때만 산정**되고 그 외에는 `null` → `least()` 에서 무시된다.

---

## 3. ⚠️ 새 CRITICAL — 발령 앵커의 수명이 7일이다 (계획·Critic 3라운드 모두 못 봄)

계획 §D9 는 발령 1회성 앵커를 **`settle_pve_run` 이 남기는 정산 이력 행의 `id`(= `pve_runs.id`)**
에 unique 제약으로 걸기로 했다. 그런데:

```
cron  planet-blitz-gc-pve-runs   '0 2 * * *'
      delete from pve_runs where created_at < now() - interval '7 days'
      (20260726000200_pve_settlement.sql:392)
```

**`pve_runs` 는 7일 TTL 로 통째로 삭제된다.** 반면 의뢰서는 스펙상 **실시간 만료가 없다**
(`.omc/specs/deep-interview-commission-system.md:49` — "보관 상한 있음, 실시간 만료 없음").

귀결 두 갈래 — **어느 쪽이든 결함이다**:

- `commission_inventory.pve_run_id` 를 `references pve_runs(id) on delete cascade` 로 걸면
  → **8일 전에 받은 의뢰서가 cron 에 조용히 삭제된다.**
- `on delete set null` / FK 없이 unique 만 걸면
  → 앵커 행이 사라진 뒤 **같은 uuid 가 재사용될 수 없다는 보장만 남고**(uuid 라 사실상 안전),
    1회성 자체는 유지된다. 다만 **의뢰서를 소비해 `commission_inventory` 에서 지운 뒤**에는
    unique 제약이 그 행과 함께 사라지므로 **1회성이 소비 시점에 소멸한다.**

→ **결정 필요**: 1회성을 **어디에 저장하는가**가 `commission_inventory` 와 분리돼야 한다.
소비되지도 GC 되지도 않는 **전용 발령 원장**(`commission_issues(pve_run_id uuid primary key, ...)`)
이 필요하다. 이것을 `commission_inventory` 의 컬럼으로 두면 소비와 함께 1회성이 사라진다.

---

## 4. ⚠️ CRIT-1 확정 — `grant_currency` 는 수령자를 못 받는다

- 현행 정의(`20260727000000:339`)는 수령자를 `auth.uid()` 로 **내부 고정**하고 파라미터로 받지 않는다.
- `settle_commission` 을 service_role 전용으로 두고 EF 가 부르면 **`auth.uid()` 가 null** →
  보상이 조용히 0.
- **EF 에서 `grant_currency` 를 부르는 코드는 리포 전체에 0건**이다(검색 확인).

### 선례 대조 — `apply_invasion_result` 는 어떻게 하는가

`20260726000000:255` 는 정확히 이 문제를 이미 풀었다:
1. `caller_is_service_role()` 예외 + `service_role` 에만 grant (이중 게이트)
2. 수령자를 **행에서 도출**(`invasions.attacker_id`)
3. **`profiles.credits/minerals` 를 직접 read-modify-write**

**그러나 그 선례는 `currency_grants` 원장을 우회한다** — 정액 50 광물 / 40 크레딧을 원장 기록
없이 가산한다. 즉 **침공 축은 1h/24h 누적 캡 밖에 있다.** 이것을 그대로 복제하면 의뢰 축도
누적 캡 밖으로 나가고, 그것은 폭주 방어의 상실이다.

→ **결정 필요**: 아래 셋 중 하나. 어느 쪽이든 **`currency_grants` 기록은 필수**다.
- **(가) `grant_currency` 에 수령자 파라미터 추가** — pve_run·salvage·story·catalyst 가 공유하는
  재화 관문의 시그니처 변경. 비용이 크고 회귀면이 넓다.
- **(나) `grant_currency_for(p_profile_id, ...)` 를 신설**하고 기존 `grant_currency` 를
  `grant_currency_for(auth.uid(), ...)` 로 위임하게 만든다 — 캡 산식·원장 기록이 **한 본문**에
  남고 기존 호출부 시그니처가 안 바뀐다.
- **(다) `settle_commission` 이 `apply_invasion_result` 처럼 직접 가산**하되
  `currency_grants` 에 `source='commission'` 으로 **함께 기록**한다 — 캡 산식이 두 곳으로 갈린다.

> **(나)가 유력하다** — 캡·원장·플래깅 로직의 단일 정본을 유지하면서 수령자만 매개변수화한다.
> 다만 `app.in_settle` GUC 규약이 그 함수 안에 있으므로, 신규 경로가 그것을 **세우지 않는다**는
> 것을 본문에서 확인해야 한다(계획 D10 ③).

---

## 5. ⚠️ CRIT-2 확정 — 현행 `settle_pve_run` 의 행 형태

**UPSERT-by-runId 가 아니라 if/else 로 갈라진 UPDATE 또는 INSERT** (`20260802000000:129-147`):

| 조건 | 동작 |
|---|---|
| `v_run_id is not null` (유효한 pending 촉매 런) | **UPDATE** `pve_runs set verified_status='verified', ... where id=v_run_id and profile_id=v_me and verified_status='pending'` |
| 그 외 (**무촉매 런 포함**) | **무조건 INSERT** — `id` 는 `default gen_random_uuid()` |

앵커 관점 사실 4가지:
1. **INSERT 경로는 `id` 를 반환하지 않는다** — 반환값은 `v_grant || {settled:true}`. 즉 무촉매
   런의 정산 이력 행 id 를 **클라가 알 수 없다.** 앵커로서는 **이것이 장점**이다(클라 통제 불가).
2. **INSERT 는 무조건이다** — `settle_pve_run` 호출 1회 = `pve_runs` 1행. **멱등이 아니다.**
   따라서 "정산 이력 행 1개 = 발령 기회 1회"는 성립하지만, **정산 자체를 반복 호출하면 행이
   계속 늘어난다** → 1회성이 발령 빈도를 묶지 못한다. §7 의 빈도 상한이 반드시 필요하다.
3. `pve_runs` 에는 `id` PK 외 유니크 제약이 없고 `on conflict` 절도 없다.
4. **`settle_pve_run` 은 `authenticated` 가 직접 호출 가능하다.** service_role 게이트가 없다.
   → 계획 §D3 방어 ①("발령은 `settle_pve_run` 안에서만")은 **"클라가 발령을 직접 못 부른다"를
   의미하지 않는다.** 클라는 `settle_pve_run` 을 임의 jsonb 로 몇 번이든 부를 수 있고, 그 안의
   발령이 매번 돈다. **경로 봉인은 "독립 RPC 미노출"일 뿐이고 실질 방어는 빈도 상한 하나다.**

---

## 6. RLS 정책 전수 (신규 테이블이 따라야 할 패턴)

| 테이블 | 정책 | 종류 | 비고 |
|---|---|---|---|
| `profiles` | select/insert/update own | 3종 | delete 없음 |
| **`items`** | `items_rw_own` | **for all** | 클라 rw 미러 — ADR-0045 의 근거 |
| **`ships`** | `ships_rw_own` | **for all** | + `ships_select_others` (using `true`, 전체 공개 읽기) |
| `pve_runs` | insert own / select own | 2종 | update·delete 정책 없음 |
| `invasions` | insert attacker / **select participant** | 2종 | **컬럼 제한 없는 행 select** — 참여자가 `replay`·`client_result` 직접 읽음 |
| `catalyst_inventory` | `select_own` | 1종 | **쓰기 정책 전무** ← 신규 테이블이 복제할 패턴 |
| `currency_grants` | `select_own` | 1종 | 쓰기 정책 전무 |

가드 트리거 `guard_pve_runs_client_insert()`(`20260727000000:142`): `not is_service_role()` 이면
`verified_status:='pending'`·`verified_result:=null`·`verified_at:=null`·`catalyst_receipt:=null` 강제.

---

## 7. cron 전수 (활성 11건)

| 잡 | 스케줄(UTC) | 대상 |
|---|---|---|
| `planet-blitz-weather-defenses` / `-guardians` | `0 0 * * 0` | 주간 |
| `planet-blitz-sink-inactive` | `30 0 * * 0` | 주간 |
| `planet-blitz-flag-pve-anomalies` | `0 1 * * *` | 일간 |
| `planet-blitz-gc-invasion-snapshots` | **`0 * * * *`** | 1h |
| `planet-blitz-gc-invasion-replays` | **`0 * * * *`** | 48h TTL |
| `planet-blitz-gc-currency-grants` | `0 2 * * *` | 7일 |
| **`planet-blitz-gc-pve-runs`** | **`0 2 * * *`** | **7일 — §3 의 원인** |
| `planet-blitz-refresh-planet-popularity` | `0,30 * * * *` | 30분 |
| `planet-blitz-gc-planet-popularity` | `15 2 * * *` | 30일 |
| `planet-blitz-gc-catalyst-grants` | `25 2 * * *` | 48h |

**시간 단위 cron 은 매시 정각**(계획 §D8 이 이미 반영). **일간 cron 은 02:00 UTC 대에 몰려 있다.**

---

## 8. Edge Function 구조

| 디렉터리 | 배포 대상 | 비고 |
|---|---|---|
| `verify-invasion` | **유일한 배포 대상** | `index.ts`(501) + `verifyInvasionCore.ts`(426). `src/sim` 을 sloppy-imports 로 번들 |
| `verify-run` | 로컬 전용 | `bundle` 태스크 없음 |
| `modules` | 배포됨(사실상 정지) | type-only import |

`import_map` 파일은 없다. `deno.json` 은 `{"unstable":["sloppy-imports"],"lock":false}` + `tasks.bundle`.

### `verify-invasion/index.ts` 응답 규약

항상 `{status, attackerWon, ladder, loot, reason?}` 고정 shape(`json()` 헬퍼 `:49`).
`already-finalized` 는 **HTTP 200 + 확정값 반환**(멱등). 거부는 대부분 200 + `reason`.
`SOFT_RERUN_BUDGET_MS = 20_000`(`:47`)은 **중단 장치가 아니라 관측 임계** — 초과 시 `console.warn` 만.

### `verifyInvasionCore.ts` 게이트 순서 (실제 좌표)

| 순서 | 게이트 | 좌표 |
|---|---|---|
| ① | `layersEqual` 실패 → `defense-mismatch` | `:380-382` |
| ② | `inputs.length > timeLimitTicks` → `invasion-inputs-too-long` | `:385-387` |
| ③ | 권위 덮어쓰기 `{...cfg, invasion3: authoritativeInvasion}` | **`:396-415`** (계획은 `:411-414` — 블록 후반) |
| ④ | `verifyRun(...)` ← 여기서부터 CPU | `:421-425` |

`:39-50` 상단 주석이 잔여 신뢰(공격자 `config.loadout`·`skillInvest` 미대조)를 명시.

---

## 9. 클라 접점

### `settlePveRunCurrency` (`src/net/index.ts:168-206`)

절대 throw 하지 않는다. 흐름:
1. 게이트웨이 미해석 → `stashPendingSettlement` 후 return
2. `gateway.settlePveRun(summary)` → 성공 시 `profile.credits/minerals` 를 **서버 반환값으로 덮음**
3. catch → 요약 전체를 큐에
4. **`:195-197`** — settle 성공 후에만 `storyRewardCredits > 0` 이면
   `gateway.grantCurrency(storyRewardCredits, 0, 'story')` **별도 호출**.
   실패 시 `stashPendingSettlement(store, {summary: null, storyRewardCredits})` —
   **`summary: null` 이 재settle 을 막아 자원 이중지급을 방지**한다(`:202`).

→ **한 정산이 서버 RPC 를 최대 2회 때리고, 두 호출은 서로 다른 트랜잭션이라 원자성이 없다.**
→ 계획 §D11 의 "의뢰 런도 story 만 별도 호출"은 이 형태를 그대로 쓰면 된다. **`summary: null`
  관용구가 이미 존재한다** — 새로 만들 필요 없다.

`PendingSettlement = { summary: PveSettleSummary | null; storyRewardCredits: number }`
(`profileSync.ts:243-247`). localStorage 키 `planet-blitz:net:pending-settlements`, **누적 배열**.
⚠️ **멱등 키·dedup 이 없다** — 같은 런이 두 번 stash 되면 두 번 재시도된다.

### `submitInvasion` (`invasionGateway.ts:395-423`)

`invasions` 에 pending 증거 insert → `.select('id').single()` 로 **id 획득** →
`functions.invoke('verify-invasion', {body:{invasion_id}})`.

→ **침공은 "행 먼저 insert → id 획득 → EF 호출" 이라 1회성 앵커가 자연스럽다.**
   `commission_runs` 도 같은 문법을 쓸 수 있다(`consume_commission` 이 `run_id` 를 반환).

### `settlement.ts` story 흐름

- `:190` `applyStoryProgress` · `:198-200` `storyRewardCredits` 조건부 스탬프
- `:255-265` claim 원장은 **로컬 `profile.storyRewardsClaimed` 에만** 기록하고 크레딧은 반환만
- `:257-259` 주석이 계약: "크레딧 **지급**은 호출부로 위임(ADR-0027)"

⚠️ **claim 원장이 서버에 없다** — `grant_currency('story')` 는 `CAP_STORY_CREDITS=2000` + 누적 캡
외에 "이 챕터를 이미 청구했는가"를 알 수 없다. 이 레인의 범위 밖이지만 기록한다.

---

## 10. 재설계가 반드시 답해야 할 것

1. **발령 1회성 앵커를 어디에 두는가** — `pve_runs` 는 7일 TTL, `commission_inventory` 는 소비 시
   삭제. **둘 다 앵커가 될 수 없다**(§3). 전용 발령 원장이 필요하다.
2. **`settle_commission` 이 재화를 어느 관문으로 지급하는가** — `grant_currency` 는 수령자를
   못 받고(§4), `apply_invasion_result` 선례는 원장을 우회한다. **(나) `grant_currency_for` 위임**이
   유력.
3. **`settle_pve_run` 이 클라 직접 호출 가능하다는 사실이 §D3 방어 ①을 약화시킨다**(§5-4).
   빈도 상한이 유일 방어임을 계약에 명시하고, 실값을 착수 조건으로 승격한다
   (`.omc/plans/balance-queue.md` §C 참조).
4. **`commission_grants` 유일성 키** — `unique (commission_run_id, kind)` + `on conflict do nothing`
   으로 멱등 재시도를 **강제**한다(계획 §2-3).
5. **버려진 `active` 행의 회수 주체** — 계획 cron ①은 `issued` 만, ②는 `verified|rejected` 만 본다.
   제출 후 EF 가 죽으면 `active` 행이 `replay` 를 붙인 채 영구 잔존한다. **cron ③이 필요**하거나
   ②의 대상을 넓혀야 한다.
6. **`settle_commission` 실패 시 재시도 주체** — 멱등만 정하고 누가 재시도하는지가 없으면 사문화된다.
