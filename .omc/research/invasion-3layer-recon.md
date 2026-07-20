# 침공 3레이어 — 코드베이스 정찰 보고 (4축)

- 생성: 2026-07-20 정찰 워크플로(opus/high)

## 축: 서버/네트워크/DB

> READ-ONLY 정찰. 파일 수정 없음. 모든 근거는 `파일:줄`.

## 1. 침공 플로우 전체 (현행)

| 단계 | 클라 진입점 | 서버 함수/EF | 테이블 |
|---|---|---|---|
| ① 대상 선택 | `fetchInvasionTargets()` (src/net/invasion.ts:369) → `SupabaseInvasionGateway.getInvasionTargets` (src/net/invasionGateway.ts:153) | RPC `get_invasion_targets()` (supabase/migrations/20260718110000_m5_guardian_live_targets.sql:118) — 내 위 랭커 3 + 30위 이내 랜덤 1, 1시간 내 재도전 대상 제외, `inject_guardian_authority(d.layout, pid)` 로 수호 라이브 주입 | `ladder`, `profiles`, `ships`, `defenses` |
| ①' 배치전/복수 | `fetchPlacementTargets` / `fetchRevengeTargets` (src/net/invasion.ts:383, 426) | `get_placement_targets()`(20260718110000:185), `get_revenge_targets()`(:214), `revenge_targets_for()`(20260717140000:235), `get_placement_status()`(20260717090000:87) | `ladder`, `invasions` |
| ② T0 스냅샷 | `beginInvasion(defenseId)` (src/net/invasion.ts:502) → 게이트웨이 :306. 호출 지점은 `startInvasionRun` (src/main.ts:624) | RPC `begin_invasion(p_defense_id)` — **최신본은 20260718160000_m6_defense_cards.sql:185** (20260718130000:112 → 20260718140000:35 → m6 로 3번 교체됨) | `defenses`, `guardians`, `profiles`, `defense_cards`, `invasion_snapshots` INSERT |
| ③ 런 | `startInvasionRun` (src/main.ts:600~680) — 스냅샷 layout 을 `normalizeLayout`(src/ui/defenseCommand.ts:387) 후 `InvasionConfig{layout, timeLimitTicks, maintenance?, card?}` 구성(src/main.ts:653) → `createWorld` | — | — |
| ④ 제출 | `finishInvasionRun` (src/main.ts:688) → `buildClientResult(replay)`(src/net/invasion.ts:618) → `submitInvasion`(:585) → 게이트웨이 :326 | `invasions` insert(pending, RLS `invasions_insert_attacker` + 트리거 `guard_invasions_client_insert`) → `functions.invoke('verify-invasion', {invasion_id})` | `invasions` |
| ⑤ 검증 | — | EF `verify-invasion` (supabase/functions/verify-invasion/index.ts:61~) — 호출자=공격자 확인, self-invasion 2차 차단, `resolveSnapshotAuthority`(verifyInvasionCore.ts:488)로 스냅샷/라이브 결정, 라이브면 `injectGuardianAuthority`(:364) 재주입, `verifyInvasion(submission, serverCtx)`(:522) 전수 재실행 | `invasions`, `invasion_snapshots`, `defenses`, `guardians`, `profiles` |
| ⑥ 정산/래더 | 응답 `normalizeVerdict`(src/net/invasionGateway.ts:112) → 결과 배너 | RPC `apply_invasion_result(3)` — **최신본 20260718160000:305** (초기 20260717010000:166 → 030000:49 → 090000:218 → 140000:338 → m6) : 멱등·자기침공 3차 가드·profile_id 오름차순 락·복수 판정·1h 쿨다운 거부(note='cooldown-violation')·verified 확정·**카드 charges 차감**·승패 카운터·순위 스왑(격차 ≤30, 복수만 예외)·복수 보너스 광물 50·복제 약탈(상대 items 3건, 인벤 상한 200) | `invasions`, `ladder`, `profiles`, `items`, `defense_cards`, `defenses` |
| ⑦ 방어 성공 드랍 | — | EF index.ts:409~428 — `attackerWon===false` 면 `rollCard` 후 RPC `apply_card_drop` (best-effort) | `defense_cards` |

부가 경로: `set_invasion_sticker`(20260717160000:65), `get_incoming_invasions`(20260717140000:175), 관전 리플레이 select(src/net/invasionGateway.ts:252), 스냅샷 GC cron 1시간(20260718150000:24).

## 2. 시간/틱 예산 하드코딩 위치 — 300초×60틱 확장 영향 범위

| 값 | 위치 | 비고 |
|---|---|---|
| `DEFAULT_TIME_LIMIT_TICKS = 180*60` = **10800** | **src/sim/defense.ts:254** (단일 정의) | 진짜 정본. 여기만 바꾸면 아래 소비처가 따라간다 |
| 소비 (클라) | src/main.ts:654, src/ui/defenseCommand.ts:517, src/render/defensePreview.ts:213, src/bench/simBench.ts:150 | 전부 상수 참조 — 수정 불요 |
| 소비 (EF) | supabase/functions/verify-invasion/index.ts:333, :336 — `timeLimitTicks: DEFAULT_TIME_LIMIT_TICKS` 를 `InvasionServerContext` 에 실음 | 서버 권위값. 상수 변경만으로 따라감 |
| 대조 게이트 | verifyInvasionCore.ts:547 (`inv.timeLimitTicks !== server.timeLimitTicks` → `defense-mismatch`), :555 (`inputs.length > server.timeLimitTicks` → `invasion-inputs-too-long`) | 자동 확장 |
| sim 종료 판정 | src/sim/world.ts:737 `if (state.tick + 1 >= invasion.timeLimitTicks) gameOver = true` | 자동 |
| 해시 봉인 | src/sim/replay.ts:231 `hashU32(h, inv.timeLimitTicks >>> 0)` | **값이 바뀌면 기존 침공 리플레이 해시 전부 변함** — 미출시라 무해하나 fixtures 재생성 필요 |
| verify-run 상한 | supabase/functions/verify-run/verifyCore.ts:103 `MAX_INPUT_TICKS = 108_000`, :154 | 18000 < 108000 → **여유 있음, 수정 불요** |
| 벽시계 소프트 예산 | supabase/functions/verify-invasion/index.ts:39 `SOFT_RERUN_BUDGET_MS = 8_000` (초과 시 `console.warn` 만, 중단 불가 — 동기 루프) | **여기가 진짜 리스크**. 틱 1.67배 + 3레이어로 틱당 엔티티 수 증가 → 재실행 CPU가 배 이상. Edge Runtime CPU/wall 한도 초과 가능성 → 값 상향 + 실측 벤치 필요 (`src/bench/simBench.ts` 재활용 가능) |

DB 쪽에는 시간 예산 하드코딩 없음(`begin_invasion`·`apply_invasion_result` 전부 layout/시간 무관). 즉 **300초 확장 = `src/sim/defense.ts:254` 1줄 + EF 재번들·재배포 + fixtures 재생성 + 재실행 CPU 실측**.

## 3. defenses 및 관련 스키마 현행 전문

### `public.defenses` (20260717000000_m4_initial_schema.sql:240~)
```
id            uuid pk default gen_random_uuid()
profile_id    uuid not null → profiles(id) on delete cascade
layout        jsonb not null                     -- DefenseLayout 계약
budget_spent  integer not null default 0 check >= 0
maintenance   numeric(5,2) not null default 100.00 check 0..100
active        boolean not null default true
created_at / updated_at timestamptz
equipped_card_id uuid → defense_cards(id) on delete set null   -- 20260718160000:94 추가
```
- 인덱스: `defenses_profile_idx`, 부분 유니크 `defenses_one_active_idx (profile_id) where active` (프로필당 활성 1개).
- RLS: `defenses_rw_own`(본인 all). 타인 select 정책 `defenses_select_others` 는 **20260717010000:139 에서 폐기** — 정찰은 RPC 전용.
- 트리거: `trg_defenses_guard` (INSERT/UPDATE, `guard_defenses_client_write` 20260717010000:92) — 클라 경로에서 `budget_spent := defense_layout_cost(layout)` 재산출, **cost > 20 이면 `check_violation` raise**, maintenance 를 INSERT=100 / UPDATE=old 로 고정. `trg_defenses_equipped_card`(20260718160000:101) 소유권 검증. `trg_defenses_updated_at`.

### `layout` jsonb 구조 = `DefenseLayout` (src/sim/defense.ts:300~316)
```ts
{ core: {x,y},
  turrets: [{type:0..5, x, y}],
  obstacles: [{x, y, halfW, halfH}],
  guardians?: [{x,y,snapshot:GuardianSnapshot(12정수),performanceCP,lineageBonusBp,milestones?}],
  guardianSlots?: unknown[]   // 구 예약 — 정규화가 드롭
}
```

### `public.defense_layout_cost(jsonb)` (20260717010000:54)
포탑 type→비용 **SQL 안에 하드코딩** (0=1,1=3,2=2,3=2,4=3,5=2, 범위밖→1) + 장애물 개당 1. 클라 미러는 `defenseLayoutCost`(src/net/defenseSync.ts:47).

### `public.defense_cards` (20260718160000:59)
```
id uuid pk / profile_id uuid → profiles / card jsonb (CardInstance)
rarity text check in ('normal','magic','rare','unique') / charges_left int check >=0
created_at / updated_at
```
RLS: 본인 select 만, **쓰기 정책 없음**(전부 service_role RPC/EF). 관련 RPC: `salvage_card`(20260718160000:525), `apply_card_purchase`(20260718170000:55), `apply_card_drop`, `build_attacker_matchup`(20260718160000:139), 테이블 `card_shop_purchases`(20260718170000).

### `public.ladder` (20260717000000:208)
`profile_id pk / rank int unique(DEFERRABLE — 20260717010000:148) / defense_id uuid FK / wins / losses / last_active / placed / updated_at`. select 만 공개, 쓰기 정책 없음.

### `public.invasions` (20260717000000:325 + 20260717140000:32~43 추가)
`id / attacker_id / defender_id / defense_id / replay jsonb / client_result jsonb / verified_status('pending'|'verified'|'rejected') / verified_result jsonb / attacker_won bool / created_at / verified_at` + `caused_swap`, `is_revenge`, `attacker_sticker`, `defender_sticker` + `snapshot_id`(20260718130000:93).

## 4. T0 스냅샷 스키마 + 서버 권위 config 형태

### 테이블 `public.invasion_snapshots` (20260718130000:60)
```
id uuid pk / attacker_id / defender_id / defense_id(FK on delete set null)
authority jsonb not null        -- ★ 권위 config 본체
maintenance numeric(5,2)        -- 미러(편의)
created_at timestamptz
card_id uuid → defense_cards(id) on delete set null   -- 20260718160000:130
```
RLS: 본인(attacker) select 만, 쓰기 정책 없음 → `begin_invasion`(security definer) 만 기록.

### `authority` jsonb 형태 (begin_invasion 20260718160000:270~276)
```json
{ "layout": <수호 권위 주입 완료 DefenseLayout>,
  "maintenance": <numeric 0~100>,
  "card": { "card": <CardInstance>, "matchup": <AttackerMatchup> }   // 미장착이면 키 없음
}
```

### 타입 정의 위치
- 클라 수신 타입 `InvasionSnapshot` — **src/net/invasion.ts:225~241** (`snapshotId`/`layout: unknown`/`maintenance`/`card?: DefenseCardConfig|null`).
- EF 소비 타입 `InvasionSnapshotRow` — **supabase/functions/verify-invasion/verifyInvasionCore.ts:420~438**, 해석 결과 `SnapshotResolution` :460~471, 판정 `resolveSnapshotAuthority` :488.
- 서버 권위 재실행 컨텍스트 `InvasionServerContext` — **verifyInvasionCore.ts:69~99** (`layout: unknown` / `timeLimitTicks` / `maintenance?` centi / `card?`).
- sim 소비 계약 `InvasionConfig` — **src/sim/defense.ts:317~340**.
- 신선도 상수 `SNAPSHOT_FRESHNESS_MS = 60*60*1000` — verifyInvasionCore.ts:417 (GC cron과 동일 1시간, 20260718150000:27).

권위 판정 규칙(verifyInvasionCore.ts:488~508): snapshot_id 없음/행 부재/소유권 불일치(attacker_id·defense_id)/1시간 초과/재사용 → **라이브 폴백**. 재사용 1차 방어는 DB 부분 유니크 `invasions_snapshot_unique`, 2차는 EF index.ts:177~184.

## 5. 3레이어 배치 전환 시 필요한 마이그레이션 + 하위호환 파괴 지점

### 파괴 지점(전부 "미출시라 데이터 보존 불요"로 처리 가능하지만 **코드는 반드시 함께 바꿔야** 하는 결속)
1. **`defense_layout_cost` SQL 이 포탑 type 0..5 를 하드코딩** (20260717010000:54~85). 3레이어는 편대/설비/기물/보스로 카테고리가 다르므로 이 함수 전면 교체 필요. 미교체 시 신규 layout 은 비용 0 으로 계산되어 예산 게이트 무의미.
2. **예산 상한 20 하드코딩** (같은 함수 :113 `if v_cost > 20 then raise`). 기획 결정 #14 "슬롯이 곧 예산, 코스트 포인트 없음" → 이 게이트 자체를 **제거하거나 슬롯 수/유효성 검증으로 대체**해야 한다. 안 하면 신규 배치 저장이 `check_violation` 으로 거부되거나(비용 계산이 살아있으면) 무의미해진다.
3. **`inject_guardian_authority(jsonb, uuid)`** (20260718110000:46) 이 `layout->'guardians'` 배열 경로를 직접 조작하고 `limit least(v_slot_count, 2)` 로 **MAX_GUARDIAN_SLOTS=2 를 SQL 에 하드코딩**. L3 수호 슬롯 2개 유지면 경로만 `layout->'l3'->'guardians'` 로 바꾸면 되지만, **경로 변경 시 이 함수 + EF `injectGuardianAuthority`(verifyInvasionCore.ts:364) + 클라 `buildGuardianPlacements`(src/save/guardianLifecycle.ts) 3곳을 동시 수정**해야 정합이 깨지지 않는다(슬롯 i ↔ 활성수호 i 매핑이 3자 비트 동일해야 함).
4. **`layoutEquals` / `normalizeServerLayout`** (verifyInvasionCore.ts:206, :243) 이 `core/turrets/obstacles/guardians` 4필드만 대조·정규화. 신규 필드(웨이브 슬롯·소켓·기물·코어 모듈)를 추가해도 **대조에 안 들어가면 위조 프리패스**가 된다 — 확장이 곧 보안 요구.
5. **클라 `normalizeLayout`** (src/ui/defenseCommand.ts:387) 과 서버 `normalizeServerLayout` 은 **자구 일치 계약**(verifyInvasionCore.ts:232~241 명시). 한쪽만 고치면 정직한 런이 `defense-mismatch` 로 오거부.
6. **`hashWorld` 침공 블록** (src/sim/replay.ts:224~250) — APPEND-ONLY 규약. 3레이어 필드는 블록 최후미 append + 조건부 접기로만 추가해야 하며, `timeLimitTicks` 값 자체가 바뀌면(§2) 기존 픽스처 해시 전부 변함.
7. **`TURRET_TYPE_COUNT` 범위 필터** (verifyInvasionCore.ts:259) — 신규 설비 타입 코드 체계로 갈면 함께 교체.
8. **NPC 시드 20기지**(20260717080000:85~, `data/seedBases.ts`) 의 layout 이 전부 구 포맷 → 3레이어로 재시드 필요(기획 §8-5).

### 필요한 마이그레이션 목록(추정)
| # | 내용 |
|---|---|
| M-1 | `defenses` 3레이어 컬럼 전환 — `layout` 을 신규 스키마로 재정의(컬럼 유지·내용 교체) 또는 `layout_l1/l2/l3` 분리. 기존 행은 미출시라 `truncate`/재시드 가능 |
| M-2 | `defense_layout_cost` 재작성 or drop + 예산 게이트(`guard_defenses_client_write` 20260717010000:92) 재작성(슬롯 수 검증으로 전환) |
| M-3 | 방어체 인벤토리 테이블 신설 — `defense_units`(설계도·종류·등급·레벨·승급·어픽스 jsonb·정비도), `defense_blueprints`. RLS = 본인 select, 쓰기 service_role(`defense_cards` 패턴 그대로 재활용) |
| M-4 | `defenses` ↔ 방어체 참조 무결성 트리거(장착 카드 소유권 트리거 `guard_defenses_equipped_card` 20260718160000:101 패턴 복제) |
| M-5 | 카드→코어 모듈 개명·재배선: `defense_cards`/`defenses.equipped_card_id`/`invasion_snapshots.card_id`/`apply_invasion_result` 차감 블록(20260718160000:410~425)/`apply_card_purchase`/`salvage_card`/`apply_card_drop` — **테이블 rename 대신 새 테이블 + 구 경로 폐기가 안전**(EF 3개가 이름에 결속) |
| M-6 | `begin_invasion` 재작성 — authority jsonb 에 3레이어 전체(웨이브 슬롯·소켓 배치·보스/수호/기물·코어 모듈) 접기. 현행 v3 는 layout+maintenance+card 3키 |
| M-7 | `inject_guardian_authority` 경로/상한 갱신 |
| M-8 | `get_invasion_targets`/`get_placement_targets`/`get_revenge_targets` 3개 모두 반환 layout 컬럼을 신규 구조로(3곳 동시, 20260718110000:118/185/214) + 정찰 부분 공개(실루엣·등급·승급만) 대응으로 **반환 컬럼 축소** 검토 |
| M-9 | NPC 시드 20기지 3레이어 재시드 |
| M-10 | 드랍 테이블 확장(설계도 드랍) — `pve_runs`/`apply_pve_verification`(20260718000000:124) 경로 |

## 6. Edge Function 의 sim 코드 공유 방식 · 신규 sim 모듈 추가 절차

- EF 소스는 상대경로로 리포 본체를 직접 import 한다: `supabase/functions/verify-invasion/index.ts:33` → `'../../../src/sim/defense.ts'`, verifyInvasionCore.ts:31~45 → `'../verify-run/verifyCore.js'`, `'../../../src/sim/world.js'`, `'../../../data/guardian.js'`, `'../../../data/lineage.js'`.
- `.js` specifier 가 `.ts` 로 풀리는 것은 **`deno.json` 의 `"unstable": ["sloppy-imports"]`** 덕분(supabase/functions/verify-invasion/deno.json).
- 배포 경로는 sloppy-imports 를 못 쓰므로 **자립 번들**로 배포한다: `deno task bundle` → `dist.index.js`(36모듈·약 70KB, jsr supabase 는 `--external`, `/* eslint-disable */` + `@generated` 헤더 자동 부착). deno.json `tasks.bundle` 참조.
- **`dist.index.js` 는 gitignore 됨** (`.gitignore:53` `supabase/functions/**/dist.index.js`) — README 156~168 의 "워킹트리 유지" 서술과 어긋나며, 현재 워킹트리에 파일이 **없다**(`ls supabase/functions/verify-invasion/` = deno.json, index.ts, verifyInvasionCore.ts). 즉 배포 전 반드시 재번들 필요.
- 배포는 리드/사용자 몫(supabase/README.md:344~356): MCP `deploy_edge_function(name='verify-invasion', entrypoint_path='index.ts', verify_jwt=true, files=[{name:'index.ts', content:<dist.index.js>}])` 또는 CLI `supabase functions deploy --project-ref qxgbxwyccbxokdgwxcuw`.
- 동일 패턴 EF 3종: `verify-run`(bundle 태스크 없음, check/serve만), `verify-invasion`, `cards`, `verify-pve-sample`.

### 신규 sim 모듈 추가 절차 (3레이어 sim 도입 시)
1. `src/sim/**` 에 모듈 추가(플랫폼 전역 `Deno`/`window`/Node 참조 금지 — verifyInvasionCore.ts:20 규율).
2. EF 코어에서 상대경로 `.js` specifier 로 import(sloppy-imports 가 해결).
3. `cd supabase/functions/verify-invasion && deno task check` → `deno task bundle` (모듈 수 증가 확인).
4. vitest(`tests/verifyInvasion.test.ts`, `tests/netInvasion.test.ts`) + Deno 교차검증(`tests/denoFixture.test.ts` → `scripts/deno-verify/fixtures.json` 재생성, `deno task verify`).
5. 마이그레이션 적용 → EF 재배포 → 스모크(정직 accept / 위조 reject / 래더 스왑 e2e).

## 재활용 가능(그대로 유지) 판정
- 스냅샷 권위 3중 게이트(`resolveSnapshotAuthority`) — 구조는 3레이어에서도 무손실 유지, `authority` jsonb 키만 확장.
- `apply_invasion_result` 의 락 순서·멱등·쿨다운·복수·스왑·약탈 골격 — 침공 1건 = 리플레이 1개 계약(기획 §3)이 그대로라 **본문 대부분 무수정**.
- `verifyRun` 재실행·해시스트림 대조 골격 — 무수정.
- net 계층 no-op 가드 규율(미설정 시 null, 절대 throw 안 함) — 무수정.

### 재활용

- supabase/functions/verify-invasion/verifyInvasionCore.ts — resolveSnapshotAuthority(:488)·SNAPSHOT_FRESHNESS_MS(:417)·verifyInvasion 골격(:522) 무수정 재활용
- supabase/functions/verify-run/verifyCore.ts — verifyRun 재실행/해시 대조 코어, MAX_INPUT_TICKS=108000(:103)이 18000틱을 이미 수용
- supabase/migrations/20260718160000_m6_defense_cards.sql:305 apply_invasion_result — 락 순서·멱등·쿨다운·복수·스왑·약탈 골격 재활용(차감 블록만 코어 모듈로 교체)
- supabase/migrations/20260718130000_m5_invasion_authority_snapshot.sql — invasion_snapshots 테이블/RLS/GC 구조 그대로, authority jsonb 키만 확장
- src/net/invasion.ts — no-op 가드·InvasionSnapshot/InvasionVerdict/ClientResult 계약·쿨다운 미러·배치전 파생 전부 재활용
- src/net/invasionGateway.ts — Supabase 구현 골격(rowToTarget/normalizeVerdict/submitInvasion 2단계)
- src/net/defenseSync.ts — 업서트 전략(delete→insert 금지, 정비도 보존) 규율
- supabase/functions/verify-invasion/deno.json — sloppy-imports + bundle 태스크(신규 sim 모듈 추가 시 그대로)
- supabase/migrations/20260718160000_m6_defense_cards.sql:101 guard_defenses_equipped_card — 방어체 소유권 검증 트리거 패턴 복제 대상
- supabase/tests/phase_e_verification.sql / phase_f_verification.sql — 원격 DB 통합 검증 스크립트 패턴

### 삭제/대체 대상

- supabase/migrations/20260717010000_m4_phase_d.sql:54 defense_layout_cost — 포탑 type 0..5 비용표 SQL 하드코딩, 3레이어에선 전면 교체 또는 폐기
- supabase/migrations/20260717010000_m4_phase_d.sql:92 guard_defenses_client_write 의 예산 상한 20 게이트(:113 raise) — 기획 결정 #14(슬롯=예산)에 따라 제거/슬롯 검증으로 대체
- src/net/defenseSync.ts:47 defenseLayoutCost — 위 SQL 의 클라 미러, 동반 폐기
- src/sim/defense.ts:300~316 DefenseLayout(core/turrets/obstacles) — 3레이어 구조로 대체 (guardians 는 L3 로 이관)
- supabase/functions/verify-invasion/verifyInvasionCore.ts:206 layoutEquals · :243 normalizeServerLayout · :287 isValidLayout — 3레이어 필드 대조로 전면 재작성 필요(미확장 시 위조 프리패스)
- src/ui/defenseCommand.ts:387 normalizeLayout — 위와 자구 일치 계약이라 동시 재작성
- supabase/migrations/20260717080000_m4_phase_e_npc_seed.sql:85~ NPC 시드 20기지 layout + data/seedBases.ts — 3레이어로 재시드
- supabase/migrations/20260718160000_m6_defense_cards.sql defense_cards 계열(카드 시스템) — 기획 결정 #16 카드 폐지 → 코어 모듈로 개명·재배선(rename 대신 신규 테이블 + 구 경로 폐기 권장)
- supabase/functions/cards/ (index.ts·cardsCore.ts) — 코어 모듈 경제로 재배선 대상
- src/net/cards.ts · src/net/cardsGateway.ts — 동상

### 위험

- EF 재실행 CPU 예산: verify-invasion/index.ts:39 SOFT_RERUN_BUDGET_MS=8000 은 경고만 남기고 중단 불가(동기 루프). 틱 10800→18000(1.67배) + 3레이어로 틱당 엔티티 증가 → Supabase Edge Runtime CPU/wall 한도 초과로 검증 자체가 실패할 수 있다. 착수 전 src/bench/simBench.ts 로 18000틱 3레이어 재실행 실측 필수.
- dist.index.js 가 .gitignore:53 로 무시되고 현재 워킹트리에 없음 — supabase/README.md:164 의 '워킹트리 유지' 서술과 불일치. 배포 전 반드시 `deno task bundle` 재실행해야 하며, 이 사실이 인수인계 문서에 반영돼 있지 않다.
- 수호 슬롯 매핑 3자 정합: inject_guardian_authority(SQL, 20260718110000:46, limit 2 하드코딩) / EF injectGuardianAuthority(verifyInvasionCore.ts:364, MAX_GUARDIAN_SLOTS) / 클라 buildGuardianPlacements 가 created_at→id 정렬로 슬롯 i↔수호 i 를 비트 동일하게 맞춰야 한다. L3 로 경로를 옮길 때 하나만 놓치면 정직한 런이 defense-mismatch 로 전량 오거부된다.
- normalizeLayout(클라) ↔ normalizeServerLayout(서버)은 '자구 일치' 계약(verifyInvasionCore.ts:232~241). 3레이어 확장 시 한쪽만 갱신하면 전 침공 오거부. 두 함수를 공유 모듈로 승격하는 것이 근본 해법.
- layoutEquals 확장 누락 = 보안 구멍: 신규 3레이어 필드를 대조에 넣지 않으면 공격자가 약화된 가짜 방어체 구성을 제출해도 accept 될 수 있다(hashStream 은 hashWorld 가 접는 필드만 봉인 — replay.ts:224~250 도 동시 확장 필요).
- hashWorld 침공 블록은 APPEND-ONLY 규약(replay.ts:201·224). timeLimitTicks 값 변경만으로도 기존 fixtures 해시가 전부 변하므로 tests/denoFixture.test.ts 로 scripts/deno-verify/fixtures.json 재생성 + Deno 교차검증 재수행 필요.
- begin_invasion 은 마이그레이션 3개(20260718130000:112 → 20260718140000:35 → 20260718160000:185)에 걸쳐 replace 돼 왔다. apply_invasion_result 는 5개(20260717010000 → 030000 → 090000 → 140000 → 160000). 최신본 전문을 베이스로 재작성하지 않으면 이전 리뷰 픽스(자기침공 3차 가드·쿨다운·격차 30·락 순서)가 조용히 소실된다.
- begin_invasion 은 대상 자격을 '내 rank 보다 상위(rank 작음)·placed·active' 로만 발급한다(20260718160000:225~245). 배치전/복수전은 스냅샷 없이 라이브 폴백으로 침공한다 — 3레이어에서 라이브 폴백 경로가 코어 모듈/방어체 권위를 못 실으면 두 경로의 재현이 갈린다(현행 카드도 동일 한계: 라이브 폴백은 카드 미주입, index.ts:164~166).
- supabase/config.toml 이 없고 로컬 Supabase 스택도 없다(supabase/tests/*.sql 헤더). 마이그레이션 검증은 원격(qxgbxwyccbxokdgwxcuw) MCP execute_sql 실측에 의존 — 3레이어 대개편처럼 큰 스키마 변경에서는 위험. 브랜치 DB(create_branch) 사용 검토 권장.
- defenses 의 부분 유니크 defenses_one_active_idx(프로필당 활성 1개)가 3레이어 편집(레이어별 탭 3개)에서도 단일 행 전제를 강제한다. layout 을 3키로 확장하면 유지 가능하나, 레이어별 행 분리로 가면 이 인덱스와 ladder.defense_id FK·begin_invasion·EF 로드 경로 전부 재설계 대상.

---

## 축: sim 코어

## 1. 현재 침공 런이 sim 상에서 도는 방식

**진입점은 별도 함수가 아니라 config 분기다.** PvE와 침공은 같은 `createWorld`/`stepWorld`를 쓰고, `WorldConfig.invasion`(`src/sim/world.ts:383`) 존재 여부로만 갈린다.

- `createWorld(seed: number, config: WorldConfig = DEFAULT_CONFIG): WorldState` — `src/sim/world.ts:545`
  - 플레이어를 index 0에 먼저 넣고(`world.ts:572-582`, hashWorld 불변식), `cfg.invasion !== undefined`이면 `spawnInvasionLayout(sink, cfg.invasion.layout, cfg.invasion.maintenance)` 호출(`world.ts:588-597`).
  - 카드 장착 시 `initCardRuntime`으로 `state.cardRuntime` 생성(`world.ts:593-595`).
- `spawnInvasionLayout(sink, layout, maintenance)` — `src/sim/defense.ts:436`
  - 스폰 순서 고정: 코어 → 포탑(배열 순서) → 장애물(`spawnWall`) → 수호 기체(최대 `MAX_GUARDIAN_SLOTS`) → 실드 공유 1회(`defense.ts:441-454`).
- `stepWorld(state, input)` — `src/sim/world.ts:662`

**방어 배치 타입** (`src/sim/defense.ts:260-343`)
- `TurretPlacement { type, x, y }`(:260), `ObstaclePlacement { x, y, halfW, halfH }`(:266), `CorePlacement { x, y }`(:272), `GuardianPlacement { x, y, snapshot, performanceCP, lineageBonusBp, milestones? }`(:288), `DefenseLayout { core, turrets, obstacles, guardians?, guardianSlots? }`(:305), `InvasionConfig { layout, timeLimitTicks, maintenance?, card? }`(:322).
- **sim에는 격자 개념이 없다.** 좌표는 자유 float이고, 15×9 격자·배치 포인트 예산은 UI 계층 전용이다 — `src/ui/defenseCommand.ts:78`(`GRID_COLS=15`), `:80`(`GRID_ROWS=9`), `:101`(`DEFENSE_BUDGET_BASE=20`), `:106-115`(cell↔world 좌표 변환). 즉 **격자·예산 폐지는 sim 변경 없이 UI/데이터 계약 교체만으로 가능**하다.
- 포탑은 `defenseTurret` 엔티티 하나에 `enemyType`=유형코드(0..5), `cooldown`=발사 쿨다운, `hp/maxHp`, `radius`로 표현(`defense.ts:395-418`). 스펙 테이블 `TURRET_SPECS`(:118, 6종 고정).

**승패 판정 위치**
- 승리: `compact()` 안 — `e.kind === 'core'`인 엔티티가 dead면 `state.victory = true`(`world.ts:2156-2159`). 보스도 같은 함수에서 victory(`:2160`).
- 패배(격추): `checkGameOver(state, player)` — `player.hp <= 0`(`world.ts:2215-2217`).
- 패배(시간초과): `checkInvasionTimeout(state, invasion)` — `state.tick + 1 >= invasion.timeLimitTicks`면 gameOver(`world.ts:734-738`). 기본 상한 `DEFAULT_TIME_LIMIT_TICKS = 180*60`(`defense.ts:254`).
- 종료 후 월드는 무기력: `stepWorld` 첫 줄이 `if (state.gameOver || state.victory) return;`(`world.ts:664`).

## 2. stepWorld 구조 — 페이즈/카메라 개념 유무

`stepWorld`(`world.ts:662-727`)의 실제 순서:

```
gameOver/victory 가드 → pendingLevelUp 프리즈 → getPlayer
invasion === undefined ? activateChunks : (skip)   // world.ts:695
rebuildActiveWalls
cardRuntime 스텝 → stepPlayer
invasion === undefined ? updateWaves : (skip)      // :703
stepEnemies → stepBoss → autoAttack → capstoneLaser → subWeapon → droneBay → stepTurrets
invasion !== undefined ? stepDefenseTurrets, stepGuardians : (skip)  // :711-713
stepProjectiles → stepGems → (PvE만 stepSupply) → stepHazards
resolveCollisions → compact → updateCombo → checkLevelUp → checkGameOver
invasion !== undefined ? checkInvasionTimeout      // :724
state.tick++
```

- **페이즈 개념: 런 레벨에는 없다.** 존재하는 "페이즈"는 두 종류뿐이고 모두 다른 층위다. ① PvE 웨이브 세그먼트(`WaveRuntime.segmentIndex/segmentElapsed/boss/done`, `src/sim/waves.ts:33-52`, `updateWaves` :75) — **침공에서는 아예 호출되지 않는다**(`world.ts:703`). ② 보스 개체 내부 페이즈(`Entity.phase` 0/1/2, `src/sim/boss.ts:24-49`). 즉 침공은 지금 "정적 배치 + 무한 단일 국면"이다.
- **카메라/스크롤 개념: sim에 없다.** 카메라는 스냅샷에서 플레이어 좌표로 **파생**된다 — `snapshotWorld`의 `cameraX = player?.x ?? 0`(`src/sim/snapshot.ts:74-80`, 주석 "The sim holds no camera state (sim/render separation, ADR-0005)"). 무한 스크롤 배경은 렌더 전용(`src/render/autotile.ts:18,247,275`, `src/render/entityRenderer.ts:133` — 레이어 translate).
- **월드는 무한 맵이고 플레이어 좌표 클램프가 전혀 없다** — `stepPlayer`의 `world.ts:960-969`: "Infinite map: no arena clamp." 이동 제약은 `activeWalls` 슬라이드뿐. `config.arenaWidth/Height`는 해시 레이아웃 보존용 잔재(`src/sim/constants.ts:12-21`).
- 컬링은 전부 **플레이어 상대**다: `PROJECTILE_CULL_RADIUS`(`world.ts:172`, 사용 `:1603`), 청크 `CHUNK_GEN_RADIUS/CHUNK_CULL_RADIUS`(`src/sim/chunks.ts:38-39`), 보급 despawn(`world.ts:1701`), 스폰 링(`constants.ts:37-41`).

**강제 스크롤을 넣으려면 건드릴 지점**
1. `WorldState`에 스크롤/페이즈 상태 필드 추가(`world.ts:411-530`) + `createWorld` 초기화(:603-648) + `hashWorld` 침공 블록 최후미 append(`src/sim/replay.ts:223-326`).
2. `stepWorld`에 스크롤 진행 함수 + 페이즈 전이 훅 삽입(`world.ts:695~724` 사이, 침공 게이트 안).
3. 플레이어 이동 경계: `stepPlayer`(`world.ts:960`)에 스크롤 창 클램프 신설.
4. 스폰: 스크롤 오프셋 기준 활성화 로직 신설(현행 `activateChunks` `world.ts:777`는 플레이어 기준, 침공에선 꺼져 있음).
5. 컬링: `stepProjectiles`(`world.ts:1603`)의 플레이어 기준 반경을 침공에서 스크롤 창 기준으로 분기.
6. 종료 판정: `checkInvasionTimeout`(`world.ts:734`) 레이어별/총 상한 이중화, `compact`의 core→victory(`world.ts:2156`)를 L3 한정으로.

## 3. 결정론 규율

- **ADR-0005 강제 3중**:
  - lint: `eslint.config.js:19-94` — `src/sim/**/*.ts`에만 `simCoreRestrictions` 적용. `no-restricted-properties`로 `Math.random`(:47-50)·`Date.now`(:51-55)·`performance.now`(:56-60) 금지, `no-restricted-globals`로 `performance`(:62-68) 금지, `no-restricted-imports`로 `pixi.js`·render/ui/input 계층 import 금지(:20-43).
  - 실측: `src/sim/**` 전체에서 `Math.random`/`Date.now` **실제 호출 0건** — 매치는 전부 주석(`anomaly.ts:16`, `world.ts:7`, `rng.ts:4`, `bullets.ts:4`, `cardEffects.ts:13`, `autopilot.ts:5`).
  - 테스트: `tests/determinism.test.ts:29,38,73,83`(동일 해시 스트림/발산), `tests/invasion.test.ts:79`(침공 리플레이 2회 해시 100% 일치), `:238,254,273`(정비도 동일/발산), `:295`(PvE 해시 불변 회귀 가드), `tests/guardian.test.ts:104,134,150`, `tests/defenseCardSim.test.ts:135,366,392`.
- **RNG 규약**: `SeededRng`(mulberry32, 정수 연산만 — `src/sim/rng.ts:38-103`). 스트림은 생성 시 fork로 분리: `waves/powerups/supply/world/drops/elite/anomaly`(`world.ts:607-613`). `fork`는 부모를 전진시키지 않아 좌표 기반 순수 파생이 가능(`rng.ts:98-102`, `chunks.ts:89-91`).
  - **침공 sim은 RNG를 아예 소비하지 않는 것이 현행 규율**이다: 포탑·수호 거동은 "위치·타이머·배열 순서·벽 LOS의 순수 함수, RNG 미소비"(`defense.ts:8-11`, `:519-523`, `:602-606`). 이 규율 덕에 편대·스포너를 넣을 때 `spawnEnemy`(`waves.ts:232`, `waveRng.int` 소비)가 아니라 **`summonEnemy`(`waves.ts:246`, RNG 미소비 결정론)** 계열을 써야 한다.
- **해시 스트림**: `hashWorld(state): number` FNV-1a 32비트, float은 IEEE-754 8바이트 원문(`replay.ts:46-53,97`). 엔티티는 `hashEntity`가 전 필드 고정 순서로(`:65-91`, `dead` 제외). **append-only + 조건부 접기** 규율이 문서·코드로 강하게 못박혀 있다: M2 블록(:156), M3(:201-222), M4 침공(:223-252, `config.invasion` 없으면 통째 skip), M5 수호(:253-288, `guardians` 비면 skip), 마일스톤(:280-286, 마스크 0이면 무접기), 카드(:289-325). 엔티티 kind 코드도 append-only(`src/sim/entities.ts:39-71`).
- **리플레이 포맷**: `Replay { seed, config?, inputs: InputFrame[] }`(`replay.ts:22-28`), `runReplay`(:375) / `stepThrough`(:390) / `ReplayRecorder`(:338).
- **서버 검증**: `verifyInvasion(raw, server)`(`supabase/functions/verify-invasion/verifyInvasionCore.ts:522`) — 서버 layout 정규화(`normalizeServerLayout` :243) → `layoutEquals` 대조(:203-218) → `timeLimitTicks` 일치 강제(:547) → **입력 길이 상한 `inputs.length > server.timeLimitTicks` → `invasion-inputs-too-long`**(:554-556, DoS 1차 방어선) → 서버 권위 config로 오버라이드 재실행. EF 배선은 `index.ts:33`이 `DEFAULT_TIME_LIMIT_TICKS`를 그대로 시간예산으로 쓰고 있어(3분 고정) **5분 확장 시 여기와 `defense.ts:254`가 동시에 바뀌어야 한다**. 소프트 벽시계 예산 8초(`index.ts:39`).

## 4. 엔티티/충돌 시스템의 신규 콘텐츠 수용성

**이미 되는 것**
- 임의 좌표 정적 스폰: 포탑/코어/벽 모두 좌표 자유(`defense.ts:436`). "벽부착 방어포"는 좌표 배치 문제일 뿐 sim 신규 개념이 아니다.
- **파괴불가 영구 해저드: 이미 있다.** `life < 0` = 영구 지형 해저드(`stepHazards` `world.ts:1731-1733`, `hazardActive` :1740-1744, 생성 선례 `chunks.ts:123-128` HAZARD_TERRAIN). 해저드는 이동을 막지 않고 접촉 피해/감속만 준다.
- **스포너: 선례 있다.** 보스가 `summonEnemy`(`waves.ts:246`)로 RNG 미소비 소환. 설비 스포너도 동일 패턴으로 구현 가능.
- 텔레그래프(예고): `spawnHazard(subtype, x, y, radius, windup, activeTicks, damage, continuous, ownerId)`(`entities.ts:206-229`)의 windup이 곧 예고 창. 냉기장 포탑이 이미 이 방식(`defense.ts:661-676`).
- 신규 kind 추가 안전: `EntityKind` + `KIND_CODE` append(`entities.ts:14-71`), 신규 kind는 PvE에 등장하지 않으므로 기존 fixture 해시 불변.
- 사거리·LOS 게이트 재사용: `segmentBlocked`(`src/sim/los.ts`), `activeWalls` 스윕(`world.ts:1635-1640` 탄 차단, `:965-969` 이동 슬라이드).

**빈틈(신규 코드 필요)**
1. **포탑 조준 방향 제한이 없다.** `fireTurret`은 항상 `atan2(player.y - t.y, player.x - t.x)`로 전방위 조준(`defense.ts:658`), `TurretSpec`(:77-112)에 facing/arc/시야각 필드 자체가 없다. "벽부착 = 벽 반대편으로만 사격"을 하려면 스펙+스텝 양쪽에 필드 추가.
2. **주기 온오프 해저드가 없다.** 현행 해저드는 windup 1회 → active 1회 → 소멸(또는 영구 상시). 레이저 격자의 "주기 토글"은 `timer/life`로 표현 불가 → 반복 상태머신 신설 필요(`world.ts:1723-1738` 개조).
3. **이동하는 벽이 없다.** `wall`은 완전 정적이고, 슬라이드 해결(`slideCircleWalls`)은 벽이 움직여 플레이어를 밀어내는 케이스를 다루지 않는다. 압축 프레스는 끼임/터널링 처리 신설이 필요하다(터널링 방지 전제 "벽 최소 폭 120u > 최대 대시 스텝 59u"는 `world.ts:962-964`, `chunks.ts:52-55`에 명시 — 움직이는 벽은 이 전제를 깬다).
4. **벽 broad-phase가 없다.** 탄-벽 판정은 O(투사체 × 활성 벽) 직접 스윕이고, 활성 벽 수가 `MAX_ACTIVE_GIMMICKS=48`(`chunks.ts:47`, 실측 ≤~19) 전제에 기대고 있다는 경고가 코드에 있다(`world.ts:1631-1634`). L2 회랑이 상·하 벽을 길게 깔면 **이 전제가 바로 깨진다** → 벽에도 공간 격자 필요.
5. **Entity 플랫 필드가 거의 포화**다. `Entity`(`entities.ts:73-110`)는 22필드 고정이고 각 kind가 필드를 재활용 중이다(포탑 `enemyType/cooldown`, 수호 `pierce`=슬롯 인덱스·`phase`=부활 충전·`iframes`=재기동 카운트 `defense.ts:492-513`, 코어/포탑 `targetY`=실드 `defense.ts:479-481`, 벽 `radius/targetX`=half extents `entities.ts:281-294`, loot `damage`=드랍시드). 설비 3갈래에 새 상태(스포너 카운터, 해저드 주기, 소켓 id)를 얹으면 **재활용 슬롯이 곧 고갈**되어 `Entity` 필드 추가 → `hashEntity` 레이아웃 변경(`replay.ts:65-91`)이라는 큰 결정이 필요해진다.
6. **적 스폰이 플레이어 상대 진형에 묶여 있다.** `formationPositions`(`waves.ts:264-336`)는 전부 `player.x/y` 기준 오프스크린 배치 + waveRng 소비. L1 편대는 "스크롤 오프셋 기준·RNG 미소비"여야 하므로 재사용이 아니라 **새 배치 함수**가 맞다(진형 상수·`avoidWalls` `waves.ts:189`는 재사용 가능).

## 5. 재활용 vs 삭제

(상세 목록은 reusable/toDelete 필드 참조. 요지: RNG·해시·리플레이·엔티티/충돌·수호·정비도는 100% 유지, 포탑 6종 스펙·단일 DefenseLayout 스키마·격자/예산 UI 계약·3분 상한은 3레이어 스키마로 교체.)

## 6. 3레이어 페이즈 머신의 가장 위험한 지점 3가지

**① 승리/종료 판정의 조기 확정 (가장 위험)**
`compact()`는 kind가 `core`이기만 하면 무조건 `state.victory = true`(`world.ts:2156-2159`)이고, `stepWorld`는 victory/gameOver면 즉시 return(`world.ts:664`)이라 **그 틱 이후 월드가 완전히 죽는다**(신기루 코어 카드가 이 문제를 별도 kind `decoyCore`로 우회한 전례가 있다 — `entities.ts:37`, `tests/defenseCardSim.test.ts:270`). 3레이어에서 L1/L2 클리어는 "victory가 아닌 페이즈 전이"여야 하고, 전이 틱에 `compact`가 잔여 엔티티를 어떻게 처리할지(적 정리 vs 승계)를 명시하지 않으면 자원 승계·해시 재현이 흔들린다. 시간 상한도 현재 단일(`checkInvasionTimeout` `world.ts:734`) — 레이어별 예산 + 총 5분 상한 이중 구조로 바꾸면서 **EF의 입력 길이 게이트(`verifyInvasionCore.ts:554-556`)와 `DEFAULT_TIME_LIMIT_TICKS`(`defense.ts:254`)를 동시에 올리지 않으면 정직한 5분 런이 `invasion-inputs-too-long`으로 오거부**된다.

**② "무한 맵·플레이어 기준 컬링" 전제와 강제 스크롤의 정면 충돌**
플레이어 좌표 클램프가 없고(`world.ts:960-969`), 카메라는 sim 상태가 아니라 스냅샷 파생이며(`snapshot.ts:74-80`), 탄 컬링(`world.ts:1603`)·보급 despawn(`:1701`)·스폰 링(`constants.ts:37-41`)이 전부 플레이어 상대다. 강제 스크롤은 "화면 창"이라는 **sim 권위 좌표계를 새로 도입**하는 일이라, 카메라를 sim 상태로 승격하고(→ `hashWorld` append) 컬링 기준을 침공에서 분기해야 한다. 여기서 PvE 경로와 함수를 공유하는 `stepProjectiles`/`stepPlayer`를 잘못 건드리면 **`tests/determinism.test.ts`·`tests/invasion.test.ts:295`가 지키는 "PvE 해시 바이트 불변" 회귀 가드가 깨진다.**

**③ 결정론 append-only 규율의 누적 부채**
`hashWorld`의 침공 블록은 4단 조건부 중첩(침공 → 수호 → 마일스톤 → 카드, `replay.ts:223-326`)이고 각 층에 "이 아래에만 append" 주석이 붙어 있다. 3레이어 config(웨이브 슬롯·소켓·기물·코어 모듈)와 런타임 페이즈 상태를 넣으면 이 블록이 한 번 더 깊어지고, **순서를 한 곳만 틀려도 클라(Node)와 서버(Deno) 재실행이 갈려 전 침공이 오거부**된다. 여기에 4-⑤(Entity 필드 포화)가 겹쳐 `hashEntity` 레이아웃(`replay.ts:65-91`)을 건드리는 순간 기존 fixture(`tests/denoFixture.test.ts` 등)가 전부 재생성 대상이 된다. **미출시 = 하위호환 불요라는 전제를 살려, 3레이어 전환 시점에 해시 포맷을 한 번에 정리(버전 bump)하고 fixture를 재생성하는 편이, 조건부 접기를 5단으로 늘리는 것보다 안전하다** — 이 판단을 M7a 착수 전에 확정해야 한다.

### 참고: 전멸 가속 구현 시
"구간 전멸" 판정은 `countKind(state, kind)`(`world.ts:2219-2223`) 같은 라이브 O(n) 스캔 + 정수 상태로 가능하며 RNG·wall-clock이 필요 없다. 가속 배율은 **정수 연산으로 제한**하는 것이 기존 규율과 맞다(f64 누적을 피한 선례: `scaleFireCooldown` 정수 centi-percent, `defense.ts:369-386`).

### 재활용

- src/sim/rng.ts — SeededRng 전체(mulberry32 정수 연산, fork 스트림 분리). 무수정 재활용.
- src/sim/replay.ts — hashWorld/hashEntity/runReplay/stepThrough/ReplayRecorder. 침공 블록(:223-326)만 3레이어 스키마로 재작성, 프레임워크는 유지.
- src/sim/collision.ts — SpatialHash(결정론 (cy,cx) 순회)·circlesOverlap. 무수정.
- src/sim/entities.ts — 플랫 Entity 구조·KIND_CODE append-only·spawnBullet/spawnEnemyBullet/spawnHazard/spawnWall/spawnDestructible/spawnEventObject. 신규 kind는 append로 추가.
- src/sim/math.ts / src/sim/los.ts(segmentBlocked·slideCircleWalls) — 결정론 삼각함수·LOS·벽 슬라이드. 무수정.
- src/sim/bullets.ts — applyBehavior/homingBehavior/accelBehavior/splitBehavior. 설비 탄 거동(유도 미사일 포드·레일포)에 그대로 재사용.
- src/sim/status.ts + patterns/types.ts HAZARD_SLOW — 감속 지대. 중력 앵커·화염 장판에 재사용.
- src/sim/boss.ts — updateBoss 골격(페이즈 0/1/2·과열 창·전환 시 탄 소거, RNG 미소비). L3 방어 보스 3종의 뼈대.
- src/sim/waves.ts::summonEnemy(:246) — RNG 미소비 결정론 적 스폰. L1 편대·L2 드론 스포너의 정본 스폰 경로.
- src/sim/waves.ts::avoidWalls(:189) — 벽 겹침 결정론 밀어내기. L2 회랑 스폰에 필요.
- src/sim/defense.ts::spawnGuardian(:497)/stepGuardians(:525) + data/guardian.ts(resolveGuardianStats·마일스톤) — L3 수호 기체 슬롯 2 그대로 사용.
- src/sim/defense.ts::normalizeMaintenance(:361)/scaleFireCooldown(:382)/MAINTENANCE_FULL — 정비도 풍화. 결정 #18(배치분만 풍화)에 그대로 대응.
- src/sim/cardEffects.ts + data/defenseCards.ts — 폐지가 아니라 '코어 모듈'로 개명·재배선(결정 #16/#17: 소모성·스냅샷 고정 문법 계승).
- src/sim/snapshot.ts — snapshotWorld. 카메라 파생 부분만 스크롤 창 기준으로 교체.
- supabase/functions/verify-invasion/verifyInvasionCore.ts — verifyInvasion 골격(정규화→대조→길이 게이트→권위 오버라이드 재실행)·resolveSnapshotAuthority·injectGuardianAuthority. 스키마만 교체.
- src/sim/chunks.ts::chunkRngFor/chunkPlacements 패턴 — 좌표 순수 파생 설계. L2 맵 템플릿 절차 배치가 필요해지면 참고(현행 침공은 청크 비활성).

### 삭제/대체 대상

- src/sim/defense.ts:58-239 — TURRET_VULCAN..TURRET_TESLA 코드 6종 + TURRET_SPECS 테이블. 설비 카탈로그(방어포 4·해저드 3·스포너 2)로 전면 대체.
- src/sim/defense.ts:77-112 — TurretSpec 인터페이스(cost=배치 포인트 필드 포함). 슬롯제(결정 #14)로 cost 개념 소멸, facing/arc 필드 필요 → 재설계.
- src/sim/defense.ts:260-317 — TurretPlacement/ObstaclePlacement/CorePlacement/DefenseLayout. 3레이어 스키마(L1 웨이브 슬롯 / L2 템플릿+소켓 / L3 보스·수호·기물·코어)로 교체. guardianSlots(:315) 레거시 필드는 이번에 제거.
- src/sim/defense.ts:245-251 — CORE_HP/CORE_RADIUS/CORE_COST/OBSTACLE_COST. 강화 가능한 코어(결정 #8)로 대체, 배치 비용 상수는 폐기.
- src/sim/defense.ts:254 — DEFAULT_TIME_LIMIT_TICKS(3분). 레이어별 예산 + 총 5분 상한으로 교체(EF 배선 index.ts:33 동시 수정 필수).
- src/sim/defense.ts:651-733 — fireTurret 전방위 조준 디스패치. 방향 제한·예고선·주기 해저드를 못 담아 재작성 대상.
- src/ui/defenseCommand.ts:78-121,182-190 — GRID_COLS/GRID_ROWS/CELL 좌표 변환/SPAWN_COL/ROW/DEFENSE_BUDGET_BASE 및 배치 포인트 계산. 격자·예산 폐지(결정 #14) → 레이어별 슬롯·소켓 편집기로 교체.
- supabase/functions/verify-invasion/verifyInvasionCore.ts:203-218(layoutEquals) / :243-281(normalizeServerLayout) / :289-300(isValidLayout) — 단일 아레나 스키마 전제. 3레이어 스키마로 재작성.
- tests/invasion.test.ts:60-77(배치 스폰) / :157-194(포탑 6종 발사 스모크) — 대상 소멸. :78-114(결정론)·:195-293(정비도)·:294-300(PvE 불변)은 신규 스키마로 이식.
- world.ts:2156-2159 — compact()의 무조건 core→victory. L3 한정 + 페이즈 전이와 분리하도록 개조(삭제라기보다 조건화).
- world.ts:734-738 — checkInvasionTimeout 단일 상한. 레이어별/총 상한 이중 구조로 교체.

### 위험

- 승리 조기 확정: compact()가 core kind만 보면 victory(world.ts:2156)이고 stepWorld는 victory/gameOver 시 즉시 return(:664) — L1/L2 클리어를 '전이'로 만들지 않으면 런이 그 자리에서 끝난다. decoyCore(entities.ts:37)가 같은 함정을 별도 kind로 피해간 전례.
- 시간 예산 3중 불일치: DEFAULT_TIME_LIMIT_TICKS(defense.ts:254) · EF 배선(verify-invasion/index.ts:33) · 입력 길이 게이트(verifyInvasionCore.ts:554-556)가 모두 3분 전제. 하나만 올리면 정직한 5분 런이 invasion-inputs-too-long으로 오거부된다.
- 무한 맵 전제 충돌: 플레이어 좌표 클램프 부재(world.ts:962 'no arena clamp')·카메라 미보유(snapshot.ts:74-80)·플레이어 상대 컬링(world.ts:1603, 1701, constants.ts:37-41). 강제 스크롤은 sim 권위 좌표계 신설이며, 공유 함수(stepPlayer/stepProjectiles) 개조 시 PvE 해시 불변 회귀 가드(tests/determinism.test.ts, tests/invasion.test.ts:295)가 깨질 수 있다.
- 해시 append-only 부채: hashWorld 침공 블록이 이미 4단 조건부 중첩(replay.ts:223-326). 3레이어 config+페이즈 상태를 얹으면 5단이 되고, 순서 한 곳만 틀려도 Node(클라)↔Deno(서버) 재실행이 갈려 전 침공 오거부. 미출시 전제를 살려 포맷 bump + fixture 재생성을 M7a 착수 전에 결정해야 한다.
- Entity 플랫 필드 포화: 22필드 고정(entities.ts:73-110)에 kind별 재활용이 이미 빽빽(수호 pierce/phase/iframes, 코어·포탑 targetY=실드, 벽 radius/targetX). 설비 3갈래 상태를 얹으면 필드 추가 → hashEntity 레이아웃(replay.ts:65-91) 변경이라는 큰 결정으로 번진다.
- 벽 broad-phase 부재: 탄-벽 판정이 O(투사체 × 활성 벽) 직접 스윕이고 활성 벽 ≤~19 전제에 기대는 경고가 코드에 명시(world.ts:1631-1634). L2 회랑의 상·하 긴 벽이 이 전제를 즉시 깬다.
- 움직이는 벽(압축 프레스) 미지원: wall은 정적이고 터널링 방지가 '벽 최소 폭 120u > 최대 대시 스텝 59u'라는 정적 전제(world.ts:962-964, chunks.ts:52-55)에 의존. 이동 벽은 끼임/터널링 처리 신설 필요.
- 주기 온오프 해저드 미지원: 현행 해저드는 windup 1회→active 1회→소멸 또는 영구 상시(world.ts:1723-1744). 레이저 격자의 반복 토글은 신규 상태머신.
- 포탑 방향 제한 부재: fireTurret이 항상 플레이어를 향해 조준(defense.ts:658)하고 TurretSpec에 facing/arc 필드 없음 — '벽부착 설비'의 사격 각 제한이 sim 신규 기능.
- RNG 스트림 오염 위험: 침공 sim은 현재 RNG 미소비가 규율(defense.ts:8-11, 519-523). L1 편대 스폰에 waveRng를 쓰는 spawnEnemy(waves.ts:232)를 무심코 재사용하면 스트림 소비가 생겨 결정론 계약이 흔들린다 — summonEnemy(:246) 계열만 써야 한다.

---

## 축: UI/렌더

## 0. 요약

침공 3레이어 재설계에서 **UI/렌더 축의 재활용 가치가 가장 높은 것은 `src/ui/pixi/**` 카툰나무풍 빌딩블록 9종**이고, **가장 크게 버려야 할 것은 `src/ui/defenseCommand.ts`(1580줄, 유일하게 남은 DOM 메타 화면)와 그것에 강결합된 `src/render/defensePreviewOverlay.ts`**다. 배경 스크롤은 이미 카메라(camX/camY) 구동이라 방향 파라미터화가 사실상 불필요하다(sim 카메라만 바뀌면 됨). 침공 프리뷰는 목업이 아니라 **실제 sim(`createWorld` 침공 config) 1프레임 정지 렌더**다.

---

## 1. 방어 사령부 현재 구조 (`src/ui/defenseCommand.ts`)

**전부 DOM 오버레이다.** main.ts:38~48 을 보면 격납고·기지맵·연구소·정제소·행성선택·정산·관제탑·카드·타이틀·설정이 전부 `./ui/pixi/*` 인데, `DefenseCommand` 만 `./ui/defenseCommand.js`(DOM) 이다 — ADR-0014 이관 보류분(메모리 기록과 일치).

- **탭 없음.** CSS 에 `.pb-tabs` / `button.pb-tab` 규칙이 남아 있으나(defenseCommand.ts:706-708) **어디서도 쓰이지 않는 죽은 스타일**이다(grep 결과 STYLE 문자열 안에만 존재). 카드 탭이 카드 화면으로 빠지면서 남은 잔재.
- **레이아웃 3분할** (defenseCommand.ts:1103-1160): 중앙 투명 `.pb-stage`(프리뷰 위 클릭/호버 수집) + 좌측 `.pb-side.left`(제목·예산바·팔레트·선택·힌트·액션) + 우측 `.pb-side.right`(정비바·카드 슬롯 요약·카드 화면 진입 버튼).
- **배치 편집 상호작용**: `onStageClick`(:974) — `preview.clientToCell(clientX,clientY)` 로 격자 칸 환산 → 점유 칸이면 "선택"(사거리 원+제거 버튼), 아니면 `tryPlace`. `onStageHover`(:1013) 는 호버 셀만 오버레이에 밀어넣는다. 편집이 실제로 바뀐 경우에만 `preview.setLayout()` 으로 정지 월드 재생성(:1004-1007).
- **순수 로직(테스트 대상, 재활용 여지 있음)**: `cellToWorld`/`worldToCell`(:104,:112), `tryPlace`(:244), `validateEditor`(:321), `editorStateToLayout`/`FromLayout`(:353,:367), `normalizeLayout`(:387, 깊은 검증 — 서버 주입본·저장 왕복 공용), `normalizeGuardian`(:458). 전부 **15×9 격자 + 배치 포인트 예산제** 전제라 3레이어에서는 좌표 규약이 통째로 바뀐다.
- **저장 경로**(`save()` :1050): `validateEditor` → `editorStateToLayout` → `profile.defenseLayout = layout` → `persist()`(saveProfile, store 미주입 시 `undefined` 로 넘겨 하네스 프로필 오버라이드 존중 :953) → `uploadToServer()`(fire-and-forget `uploadDefenseLayout`, 미설정 시 no-op).
- **정비(E3)**: `loadStatus`/`repair`(:891,:902) — `fetchDefenseStatus`/`repairDefense` RPC, 성공 시 로컬 크레딧 동기화 + `refreshPendingProfile` 로 대기 슬롯 교체.
- **suspend/resume 규약 확인됨**(:842, :851 + main.ts:246-249). `openCards()` 가 `defenseCommand.suspend()`(display:none 만) → `cardsScreen.show(profile, () => defenseCommand.resume())`. `resume()` 은 `onClose === null` 이면 되살리지 않고(그 사이 화면 전환), 살아나면 `scheduleViewport()` + `loadStatus()` + `loadCards()` 를 **둘 다** 다시 건다(감춘 동안 `visible===false` 라 진행 중 로드가 조용히 버려져 로딩 고착되는 것 방지). 주석에 명시: `show()` 는 저장된 배치로 되감으므로 hide→show 로 돌아오면 미저장 편집이 날아간다.
- **카드 장착 UI**: 우측 패널에 `cardSlotPanel()`(:1487) 슬롯 요약 1칸 + `doEquip`(:1561) 해제만. 보관함·상점·합성은 전부 `src/ui/pixi/cardsView.ts` 로 이관됨(롤아웃 #7).
- **뷰포트 배선**: `scheduleViewport`/`updateViewport`(:864,:871) 가 좌/우 패널 실측 rect 를 `preview.setViewport({left,top,right,bottom})` 로 넘겨 캔버스 격자를 패널 사이로 축소·중앙정렬. `window.resize` 리스너는 show 에서 부착·hide 에서 제거(:817-820, :832-835).

---

## 2. Pixi 카툰나무풍 빌딩블록 (새 탭 L1/L2/L3 재사용 대상)

| 부품 | 파일:심볼 | 용도/주의 |
|---|---|---|
| 나무 패널 | `src/ui/pixi/nineSlicePanel.ts:100 nineSlicePanel(w,h,{texture,border,fillColor,fillAlpha,fillInset})` | 밝은 화면 위 팝업은 `fillAlpha:1` |
| **콘텐츠 상자 강제** | `nineSlicePanel.ts:76 panelContent(w,h)` → `{x,y,w,h,right,bottom}` | 제목·본문·마스크 하한을 전부 이 상자 기준으로. 제목이 나무 테두리에 붙는 결함 2회 재발분 |
| 패널 상수 | `PANEL_BORDER=46`(:17), `PANEL_FRAME_SOLID=37`(:28), `PANEL_FILL_INSET=30`(:45), `PANEL_INNER_PAD=14`(:58) | `tests/panelFrameGeometry.test.ts` 가 실제 PNG 알파로 검증 |
| 카드 타일 | `src/ui/pixi/card.ts:34 makePanelCard({width,height,texture,selected,onClick,lift})` | 선택 금색 링 + hover 리프트. 콘텐츠는 호출자가 얹는다(z 제어) |
| 잠금 딤 | `card.ts:90 panelDim(w,h,alpha)` | inset 기준이 37(살 끝) — 46 이면 밝은 띠 남음 |
| 버튼 | `src/ui/pixi/button.ts:30 PixiButton({texture,width,height,label,onClick,labelColor,fontSize,cap})` | 밝은 버튼은 `labelColor` 필수(흰 글씨 묻힘 + 섀도 자동 off) |
| 슬롯 셀 | `src/ui/pixi/slotGrid.ts:158 makeSlotCell({size,item,slotTex,highlight,highlightTex,iconTex,onClick,onHover,onMove,onOut})` | 등급 테두리+글로우 2겹. `SlotCellItem`(:26)은 rarity/slot/weaponType/uniqueId 만 요구 — **방어체 슬롯에 그대로 재사용 가능한 최소 인터페이스** |
| 그리드 좌표 | `slotGrid.ts:110 rectGridPositions(n,cols,cellW,cellH,gapX,gapY)` / `:131 gridPositions` | 순수 함수, 테스트 대상. L2 소켓/L3 기물 소켓 배치에 바로 쓸 수 있음 |
| 배너/칩/아이콘버튼 | `src/ui/pixi/titleBar.ts:20 makeBanner` / `:64 makeCurrencyChip` / `:119 makeIconButton` | |
| 툴팁 | `src/ui/pixi/tooltip.ts:25 PixiTooltip.show(content, designX, designY, frameColor)` | 화면 경계 클램프 포함 |
| 테마 | `src/ui/pixi/theme.ts` — `COLOR`(:44), `RARITY_COLOR_NUM`(:12), `SLOT_RARITY_COLOR_NUM`(:32), `UI_FONT`(:41), `TEXT_SHADOW`(:104), `hexColor(css)`(:61), `iconContrastRingBands`(:97) | 방어체 4등급 색을 장비 등급색과 공유하려면 여기 그대로 |
| 이모지 제거 | `src/ui/pixi/text.ts:20 stripEmoji` | ▶◀▲▼ 등은 KEEP(:14) |
| 텍스처 로더 | `src/ui/pixi/uiTextures.ts:228 loadUiTextures()`, `UI_ASSET_NAMES`(:67) | **새 방어체 아이콘은 여기 목록에 추가해야 로드됨.** 미존재/실패는 null → 폴백 |

**공용으로 승격돼 있지 않아 새로 만들어야 하는 것 (탭 3개에 필요):**
- **탭 바 없음.** 현재 어느 Pixi 화면도 탭을 갖고 있지 않다(grep `tab` — controlTower 는 `tableHeader` 만, researchLab 은 0건). L1/L2/L3 탭은 신규 부품.
- **스크롤 영역**: `src/ui/pixi/cardsView.ts:460 scrollArea(panel,x,y,w,h,totalH,get,set)` 가 **private 메서드**다. 마스크 Graphics 는 히트 테스트 제외(`isMask`)라 휠은 클립 Container 에 `hitArea` 로 걸어야 한다는 실측 지식이 여기 담겨 있다(:485-494). `clampToRows`(:500)도 같이 private. → 방어체 보관함 목록에 쓰려면 `src/ui/pixi/` 공용 모듈로 승격 필요.
- **팝업 껍데기**: `src/ui/pixi/controlTower.ts:1404 renderModal()`(암막+패널+제목+닫기, 암막 클릭 닫기, 패널 내부 `stopPropagation`) 과 `:1437 tableHeader`, `:1455 pager` 도 전부 private. 표가 셋 이상이면 팝업으로 분리하라는 롤아웃 교훈의 구현체.
- **목록 행**: `cardsView.ts:108 listRowBg(w,h,{selected,accent})` 는 모듈 로컬 함수(export 아님). 주석에 "카드 화면 전용 조립이라 공용으로 올리지 않는다(ADR-0014)" 라고 명시 — 방어체 목록에서 재사용하려면 승격 판단 필요.
- **행 클릭은 행 Container 에** 걸어야 한다(바탕 Graphics 에만 걸면 위 텍스트가 삼킨다 — 메모리 기록).

---

## 3. 배경 무한 스크롤 파이프라인

**위치**: `src/main.ts:148-153` (`TilingSprite` 생성) + `src/main.ts:1010-1028` (렌더 루프의 스크롤 갱신) + `src/render/autotile.ts:166 AutotileBackground`(Wang 타일 지형, 행성별).

```
const camX = prevSnap.cameraX + (currSnap.cameraX - prevSnap.cameraX) * alpha;   // main.ts:1014
background.tilePosition.set(-camX % tileW, -camY % tileH);                        // main.ts:1027
```

**방향 파라미터화 가능성 — 사실상 이미 되어 있다.** 배경은 방향 개념을 갖고 있지 않고 **스냅샷의 `cameraX/cameraY` 를 그대로 따라간다**. 즉 L1(아래→위 종스크롤)·L2(좌→우 횡스크롤)·L3(고정)의 차이는 **sim 이 카메라를 어느 축으로 미느냐**로 전부 표현되고, 렌더 쪽은 무변경으로 성립한다. 렌더에서 실제로 필요한 것은 **레이어별 배경 텍스처 교체**뿐:
- 텍스처 슬롯은 `src/render/textures.ts:434 background: BACKDROP_PALETTES.map(backgroundTexture)` (행성 4종). 침공은 현재 `planetBackground(0)`(카르곤) 고정(main.ts:669).
- 교체 지점 3곳이 이미 존재: 런 시작(main.ts:565), 침공 시작(main.ts:669-671), 프리뷰 backdrop 훅(main.ts:265-271 `setBackdrop`). 레이어 전환 시 같은 패턴으로 `background.texture` 를 바꾸면 된다.
- f32 UV precision "swim" 방지를 위해 **f64 modulo 를 렌더러에 넘기기 전에 취한다**는 규약(main.ts:1011-1013)은 유지해야 한다.
- `autotile.active` 이면 TilingSprite 대신 Wang 층이 그려지고(main.ts:1016-1023) 뷰포트 사각형을 stage 역변환으로 구해 재타일한다. 침공은 `autotile.configure(null, seed)` 로 꺼둔다(main.ts:670) — L2 회랑처럼 구조적 지형이 필요하면 이 층이 재활용 후보다.

---

## 4. 침공 런 화면 ↔ 방어 프리뷰의 연결 — **목업이 아니라 실제 sim**

`src/render/defensePreview.ts:203 rebuild()`:
```
const invasion: InvasionConfig = { layout, timeLimitTicks: DEFAULT_TIME_LIMIT_TICKS };
const config: WorldConfig = { ...DEFAULT_CONFIG, planet: 0, tier: 0, invasion };
this.world = createWorld(PREVIEW_SEED, config);            // 침공과 동일한 월드 생성
const snap = snapshotWorld(this.world);
this.renderer.render(previewSnap, previewSnap, 1);          // prev=curr, alpha=1 → 정지 프레임
```
- **한 틱도 `stepWorld` 하지 않고 recorder 도 붙이지 않는다** → 정산·리플레이·오염 런(ADR-0008) 규칙과 무관(defensePreview.ts:5-8 주석).
- 라이브 `world` 변수와 **완전히 분리된 별도 참조**이며, 렌더러도 프리뷰 전용 `EntityRenderer` 인스턴스를 따로 둔다(:104).
- 공격자 기체(entities[0])는 스프라이트에서 제외하고 진입 지점 마커로 대신 표현(:218-222).
- 기획 §7 의 "시험 침공"(자기 기지 침공 시뮬레이션)은 **여기서 `stepWorld` 를 돌리기만 하면 되는 구조**다 — 다만 오염 런 규칙 준수를 위해 recorder/정산 경로와의 격리를 명시적으로 유지해야 한다. `defenseCommand.ts:516 tryTestLayout(layout, ticks=60)` 이 이미 60틱 스텝 스모크를 돌리고 있다(단 렌더 없이 엔티티 수만 검증).
- 침공 실런 경로는 `src/main.ts:601 startInvasionRun(target, layout)`: `beginInvasion(defenseId)` 로 T0 권위 스냅샷 확보 → `normalizeLayout` → `InvasionConfig{layout, timeLimitTicks, maintenance?, card?}` → `createWorld` + `ReplayRecorder`. **프리뷰와 실런이 같은 `InvasionConfig` 타입을 공유**하므로 3레이어 config 확장은 두 경로에 동시에 반영된다.

---

## 5. 하네스에서 침공을 띄우는 경로

- **스크린 점프**: `src/harness/core.ts:38 HarnessScreen = 'title'|'base'|'starMap'|'inventory'|'research'|'refinery'|'defense'|'controlTower'`. 구현은 `src/main.ts:1138 harnessGoto()` — `case 'defense'`(:1167) 가 `clearToMenu(); setScreen('defense'); openDefenseCommand();`.
- **치트 패널 버튼**: `src/harness/cheatPanel.ts:760-777` 의 `screens` 배열(`['defense','방어사령부'], ['controlTower','관제탑']`).
- **URL 파라미터**: `src/main.ts:1361-1372` 가 `?screen=` 을 검증 후 `harnessGoto` 로 넘긴다.
- **침공 런은 하네스로 직접 시작할 수 없다.** `Harness.startRun(opts)`(core.ts:137) 는 `{seed, planet, tier, anomaly, maxSegments}` 만 받는 **PvE 전용**이고, `HarnessHost.startRun`(core.ts:111) 시그니처에도 invasion 이 없다. grep 결과 `src/harness/**` 에 `invasion` 문자열이 **0건**. 침공을 띄우려면 관제탑(`goto('controlTower')`)에서 대상을 골라 `onInvade` 콜백을 태우는 수동 경로뿐이다.
  → **3레이어 검증에는 이게 병목**이다. `harness.startInvasion({layout, seed})` 류의 호스트 훅 추가가 사실상 필수.
- **프리셋**: `src/harness/presets.ts:22 PresetKind = 'fresh'|'maxed'` 뿐 — 방어 배치(`profile.defenseLayout`)를 채우는 프리셋이 없다. 3레이어 배치 프리셋 신설 필요. 메모리 기록대로 **`preset` 은 런 시작 전에 걸어야 비오염**이다(core.ts:289-297 이 `markTaintedIfLive()` 를 부른다).
- 정산 검증 시 DEV `#hud` 줄까지 숨겨야 한다 — Pixi 메타 화면들이 `document.getElementById('pb-hud').style.visibility='hidden'` 로 처리(cardsView.ts:190, baseMap.ts:107).

---

## 6. 카드 UI → 코어 모듈 개명·재배선 시 파일 목록

grep(`defenseCards|cardsView|net/cards|cardRuntime|DefenseCardConfig|CardInstance`) 기준 **27개 파일**:

**데이터/sim (개명 파급 최상류)**
- `data/defenseCards.ts` (`FUSION_INPUT_COUNT`, `CardInstance`)
- `src/items/rollCard.ts`
- `src/sim/cardEffects.ts`, `src/sim/defense.ts`, `src/sim/world.ts`(`cardRuntime`), `src/sim/replay.ts`
  ⚠️ `replay.ts`·`defense.ts` 는 **해시 바이트에 걸린다** — 필드명 변경이 직렬화 키에 닿으면 결정론 재현이 깨진다. 표시 문자열만 바꾸고 wire 필드는 유지하는 분리가 필요.

**네트워크**
- `src/net/cards.ts`, `src/net/cardsGateway.ts`, `src/net/invasion.ts`, `src/net/invasionGateway.ts`

**UI**
- `src/ui/cardsView.ts`(순수 표시 로직 — `cardRarityColor`/`cardRarityLabel`/`cardAffixSummary`/`cardAffixOneLine`/`isLowCharge`/`storageGauge`/`checkFusionSelection`/`fusionCheckText`/`buyErrorText`/`shopSlotPrice`. **Pixi 판이 그대로 import 해 값 갈림을 막고 있다**)
- `src/ui/pixi/cardsView.ts`(973줄, 화면 본체 — 코어 모듈 화면의 골격 그대로 재활용)
- `src/ui/defenseCommand.ts`(슬롯 요약 + `doEquip`)
- `src/ui/controlTower.ts` / `src/ui/pixi/controlTower.ts`(카드 정찰 공개 3줄, controlTower.ts:870 부근)
- `src/main.ts`(:45 import, :242 `cardsScreen`, :246 `openCards`, :332 `lastInvasionCard`, :497 `revealCard`, :621-636 `runCard`)

**i18n**: `src/i18n/catalog.ts` — `card.*` 키 약 40개(:509~), `def.cards.*`(:509-513)

**서버**
- `supabase/functions/cards/cardsCore.ts`, `supabase/functions/cards/index.ts`
- `supabase/functions/verify-invasion/index.ts`, `verifyInvasionCore.ts`
- `supabase/migrations/20260718160000_m6_defense_cards.sql`, `20260718170000_m6_card_economy_rpc.sql` (테이블 `defense_cards`, RPC `salvage_card` 등 — **마이그레이션은 되돌리지 말고 새 마이그레이션으로 개명**)

**테스트**: `tests/cardsCore.test.ts`, `cardsView.test.ts`, `defenseCardSim.test.ts`, `defenseCards.test.ts`, `netCards.test.ts`, `netInvasion.test.ts`, `verifyInvasion.test.ts`

---

## 7. 신규 구현 시 지켜야 할 함정 (실측 기록)

1. **캔버스 UI 는 남은 DOM 오버레이 아래로 내려가고 z-index 로 못 뒤집는다.** `DefenseCommand` 가 DOM 인 한 새 Pixi 탭은 그 아래에 깔린다 — 3레이어 편집 화면은 **처음부터 Pixi 로** 만들어야 한다(DOM/Pixi 혼용 금지).
2. Pixi 화면은 `show()` 에서 `stage.setChildIndex(root, children.length-1)` 로 맨 앞 승격(cardsView.ts:188). 항상 떠야 하는 크롬(설정 톱니)은 렌더 루프 `raise()` 로 매 프레임 승격(main.ts:291-294).
3. **텍스처 로드 후 다시 부르는 build 함수 안에 리스너를 두면 재등록돼 클릭이 두 번 돈다** (`loadUiTextures().then(() => this.render())` 패턴, cardsView.ts:158-161).
4. `render()` 는 `removeChild` + `destroy({children:true})` 로 완전 재구성(cardsView.ts:511-514) — 스크롤 위치 같은 상태는 인스턴스 필드로 보존(`invScrollY`).
5. Pixi 검색 입력은 캔버스 위 DOM `<input>`(controlTower.ts:244-274) — 재생성하면 한글 IME 끊김.
6. 프리뷰가 켜져 있는 채로 카드 화면을 열면 정지 월드가 패널을 뚫고 보인다 → 화면 root 를 맨 앞으로 올리는 것으로 처리(cardsView.ts:186-188).

### 재활용

- src/ui/pixi/nineSlicePanel.ts — nineSlicePanel(), panelContent(), PANEL_BORDER/FRAME_SOLID/FILL_INSET/INNER_PAD (패널 여백 강제 상자)
- src/ui/pixi/card.ts — makePanelCard(), panelDim() (선택 링·hover 리프트·잠금 딤)
- src/ui/pixi/button.ts — PixiButton (9-slice hstretch 버튼, labelColor 규약)
- src/ui/pixi/slotGrid.ts — makeSlotCell(), SlotCellItem, rectGridPositions(), gridPositions() (방어체 슬롯/소켓 그리드에 그대로 사용 가능)
- src/ui/pixi/titleBar.ts — makeBanner(), makeCurrencyChip(), makeIconButton()
- src/ui/pixi/tooltip.ts — PixiTooltip (화면 경계 클램프 포함)
- src/ui/pixi/theme.ts — COLOR, RARITY_COLOR_NUM, SLOT_RARITY_COLOR_NUM, UI_FONT, TEXT_SHADOW, hexColor(), iconContrastRingBands()
- src/ui/pixi/text.ts — stripEmoji() (Pixi 라벨 두부 방지)
- src/ui/pixi/uiTextures.ts — loadUiTextures(), UI_ASSET_NAMES (새 방어체 아이콘은 이 목록에 추가)
- src/ui/pixi/cardsView.ts:460 scrollArea() + :500 clampToRows() — private, 공용 승격 필요(마스크 휠 히트테스트 실측 지식 포함)
- src/ui/pixi/cardsView.ts:108 listRowBg() — 목록 행 바탕, 승격 판단 필요
- src/ui/pixi/controlTower.ts:1404 renderModal() / :1437 tableHeader() / :1455 pager() — private, 팝업 골격 공용 승격 후보
- src/ui/pixi/cardsView.ts 전체 — 코어 모듈 화면의 골격(슬롯·보관함·상점·합성 3열 보드) 그대로 재활용
- src/ui/cardsView.ts — 순수 표시 로직(등급색/라벨/어픽스 요약/합성 사전검증/구매 오류 문구), Pixi 판이 import 해 값 갈림 방지
- src/render/defensePreview.ts — DefensePreviewController (실 sim 정지 월드 1프레임 렌더, 뷰포트 fit/clientToCell). 3레이어용 좌표계 교체 후 재사용
- src/render/entityRenderer.ts — 침공·프리뷰 공용 스프라이트 렌더러
- src/render/autotile.ts — AutotileBackground (L2 회랑 구조 지형 후보)
- src/main.ts:1010-1028 배경 스크롤 갱신 — 카메라 구동이라 방향 파라미터화 불필요, 텍스처 교체만
- src/main.ts:601 startInvasionRun() — beginInvasion T0 스냅샷 → InvasionConfig → createWorld + ReplayRecorder 배선
- src/harness/core.ts — HarnessHost/Harness 인터페이스(스크린 점프·ff·step·preset)
- src/ui/defenseCommand.ts:387 normalizeLayout() — 깊은 검증 패턴(저장 왕복 + 서버 주입 공용). 3레이어 스키마용으로 구조 계승

### 삭제/대체 대상

- src/ui/defenseCommand.ts (1580줄 전체) — 15×9 격자 + 포탑 6종 + 배치 포인트 예산제 + DOM 오버레이. 3레이어 Pixi 화면으로 전면 대체. 단 normalizeLayout/persist/uploadToServer/정비 로드 패턴은 구조만 계승
- src/ui/defenseCommand.ts:78-121 GRID_COLS=15 / GRID_ROWS=9 / CELL_W=128 / CELL_H=120 / SPAWN_COL / SPAWN_ROW — 단일 아레나 격자 상수. 이 상수를 defensePreviewOverlay.ts·controlTower(양판)가 import 하고 있어 삭제 시 3곳 동시 수정
- src/ui/defenseCommand.ts:101 DEFENSE_BUDGET_BASE / :165 placementCost / :183 editorCost / :191 remainingBudget / :196 canAfford — 배치 포인트 예산제 폐지(결정 14: 슬롯이 곧 예산)
- src/ui/defenseCommand.ts:562 TURRET_DISPLAY (포탑 6종 글리프·색) / :572 buildPalette() — 편대·설비·기물 카탈로그로 대체
- src/ui/defenseCommand.ts:706-708 .pb-tabs / button.pb-tab CSS — 이미 어디서도 쓰이지 않는 죽은 스타일
- src/render/defensePreviewOverlay.ts (203줄 전체) — 15×9 격자선·정중앙 진입 지점 마커·포탑 사거리 원 전용. 3레이어(종스크롤 웨이브 타임라인 / 횡스크롤 소켓 / 고정 코어방)에서 성립하지 않음
- src/ui/controlTower.ts:279 previewCells() + src/ui/pixi/controlTower.ts:1142 renderReconPanel() — 15×9 미니 격자 정찰 표시. 기획 §15(레이어별 실루엣·등급·승급 별)로 전면 재설계
- src/ui/defenseCommand.ts:632 defaultGuardianPositions() — 코어 양옆 하단 격자 배치. L3 수호 슬롯 2칸 고정으로 대체
- src/ui/defenseCommand.ts:516 tryTestLayout() — 단일 아레나 60틱 스모크. 3레이어 페이즈 머신 기준으로 재작성(기획 §7 시험 침공)
- 카드 명칭 전반(27개 파일, 보고서 §6) — '방어 카드' → '코어 모듈' 개명. i18n card.* 키 약 40개 + def.cards.* 4개 포함

### 위험

- 결정론 해시 위험: src/sim/replay.ts·src/sim/defense.ts 의 직렬화 키가 카드 개명에 닿으면 리플레이 재현이 깨진다(ADR-0005). 표시 문자열 개명과 wire 필드명은 반드시 분리할 것 — 서버 verify-invasion 재실행과 바이트 일치가 전제다.
- DOM/Pixi 혼용 z-order 함정: DefenseCommand 가 DOM 인 한 새 Pixi 탭은 그 아래로 깔리고 z-index 로 못 뒤집는다(설정 톱니가 타이틀에 가려진 실측 사례). 3레이어 편집 화면은 처음부터 Pixi 로 만들어야 한다.
- suspend/resume 규약 파손 위험: 카드(→코어 모듈) 화면 진입은 반드시 suspend/resume 이어야 한다. hide→show 로 되돌리면 show() 가 저장 배치로 상태를 되감아 미저장 편집이 전량 소실된다(defenseCommand.ts:838-857 주석).
- 격자 상수 3중 의존: GRID_COLS/GRID_ROWS/CELL_W/CELL_H/SPAWN_* 를 defensePreviewOverlay.ts:17-26, src/ui/controlTower.ts:279, src/ui/pixi/controlTower.ts:1164 이 동시에 import 한다. 좌표계 교체 시 한 곳만 고치면 조용히 어긋난다.
- 하네스 침공 진입 경로 부재: src/harness/** 에 invasion 문자열 0건. Harness.startRun 은 PvE 전용(seed/planet/tier/anomaly/maxSegments)이라 3레이어 침공을 자동 검증할 수단이 없다. HarnessHost 에 startInvasion 훅 + 3레이어 배치 프리셋 신설이 사실상 필수이며, preset 은 런 시작 전에 걸어야 비오염이다.
- 시험 침공(기획 §7)의 오염 런 경계: defensePreview 는 현재 stepWorld 를 한 번도 부르지 않아 정산·리플레이 규칙 밖에 있다. 스텝을 켜는 순간 recorder/정산 경로와의 격리를 명시적으로 유지하지 않으면 ADR-0008 오염 런 규칙이 무너진다.
- private 부품 승격 필요: 스크롤 영역(cardsView.ts:460)·팝업 껍데기(controlTower.ts:1404)·목록 행(cardsView.ts:108)이 전부 화면 private 이다. 탭 3개에서 재유도하면 휠 히트테스트(마스크 Graphics 제외)·반토막 행 클램프 같은 실측 지식이 유실되고 값이 조용히 갈린다.
- 탭 바 부품 전무: Pixi 화면 어디에도 탭 구현이 없다(grep 0건). L1/L2/L3 탭은 완전 신규 — 나무 패널 위 탭의 시각 규격(선택 상태·프레임 연결)이 카툰나무풍 세트에 정의돼 있지 않아 디자인 결정이 선행돼야 한다.
- 자산 파이프라인: 새 방어체 아이콘은 uiTextures.ts:67 UI_ASSET_NAMES 목록에 등재해야 로드된다. 미등재는 조용히 null → 글리프 폴백으로 떨어져 결함이 눈에 안 띈다. 또한 pixellab 생성분은 pixellab-forge 리포 동기화 규칙 대상.
- Pixi 라벨 이모지 두부: 기획 §5 카탈로그 이름에 이모지를 쓰면 캔버스에서 두부가 된다. stripEmoji(text.ts:20) 를 모든 라벨 생성 지점에 통과시켜야 하며, KEEP 목록(▶◀▲▼■□●○) 밖 기호는 전부 사라진다.
- i18n 미이관 잔재: defenseCommand 는 현재 i18n 카탈로그의 def.* 키를 대량 사용한다(def.turret.name.*, def.pal.*, def.budget.*, def.guardian.* 등). 3레이어 전환 시 고아 키가 대량 발생하며 tests/i18n.test.ts 가 키 정합을 검증하므로 정리 누락이 곧 테스트 실패다.

---

## 축: 데이터/콘텐츠

## 0. 데이터 레이어 전경 (전수 목록)

리포 루트 `data/**` (src 밖, 총 2,995줄):

| 파일 | 줄 | 내용 |
|---|---|---|
| `data/enemies.ts` | 105 | 카르곤 잡몹 4종 + **`ENEMY_BY_TYPE` 전역 레지스트리**(:97) |
| `data/planets/index.ts` | 135 | `PlanetContent` 타입 + 행성 4종 + `PLANETS`(:130) + `planetContent()`(:133) |
| `data/planets/{berdan,niflheim,arke}.ts` | 180/177/185 | 행성별 로스터·엘리트·웨이브 카드 풀 |
| `data/boss.ts` | 191 | `BossAttack`/`BossPhaseDef`/`BossDef` 타입 + 카르곤 보스 |
| `data/bosses/*.ts` | 57~60 | 행성 보스 3종 데이터 |
| `data/waves.ts` | 178 | `Formation`/`WaveCard`/`WaveSegment`/`TierParams` + 세그먼트 6 + 카드 풀 8 |
| `data/affixes.ts` | 61 | 장비 어픽스 24종 + `AFFIX_BY_ID` |
| `data/uniques.ts` | 73 | 유니크 15점, **import 시 side-effect 등록**(:73) |
| `data/defenseCards.ts` | 426 | 방어 카드(=코어 모듈) 전체 — 어픽스 16·유니크 4·롤 범위·합성·상점·분해 |
| `data/guardian.ts` | 294 | 수호 기체 프리셋·스냅샷·결정론 스탯 해석 |
| `data/lineage.ts` | 166 | 계보 비용·마일스톤 |
| `data/skills.ts` | 265 | 3계열×20노드 + 캡스톤 |
| `data/economy.ts` | 109 | 리롤·리스펙·창고 비용 순수 함수 |
| `data/seedBases.ts` | 146 | NPC 시드 기지 **표시 메타만**(layout 없음) |
| `data/stickers.ts` | 73 | 도발 스티커 12종 |

주의: **포탑 6종 스펙은 `data/`가 아니라 `src/sim/defense.ts:110~` `TURRET_SPECS`에 있다.** 방어 콘텐츠만 유일하게 sim 안에 데이터가 박혀 있고, 배치 격자(15×9)·예산은 `src/ui/defenseCommand.ts:78-101`(`GRID_COLS/ROWS`, `DEFENSE_BUDGET_BASE=20`)에 있다.

---

## 1. 콘텐츠 데이터가 정의되는 관례

**타입은 소비 레이어, 리터럴은 data/.** `EnemyDef`는 `src/sim/patterns/types.ts:46`, `AffixDef`/`Rarity`/`StatKey`는 `src/items/types.ts:24,90,115`에 있고 `data/*.ts`는 그 타입의 행만 채운다. 예외적으로 `WaveCard`(`data/waves.ts:86`)·`BossDef`(`data/boss.ts:129`)·`PlanetContent`(`data/planets/index.ts:45`)·`CardAffixDef`(`data/defenseCards.ts:87`)는 타입까지 data/ 안에 산다 — **"콘텐츠 문법 자체가 데이터 소유"인 것들은 data/에 타입을 둬도 되는 선례**가 이미 있다. 3레이어 방어체 카탈로그는 이쪽이다.

**레지스트리는 세 가지 패턴이 공존:**
1. **배열 append + 인덱스가 계약** — `ENEMY_BY_TYPE`(`data/enemies.ts:97`, 주석 :91-95 "절대 재정렬/재번호 금지 — 해시 불변"), `PLANETS`(:130), `TIER_PARAMS`(`data/waves.ts:59`), `STICKERS`(`data/stickers.ts:32`, 배열 위치 = 서버 smallint), `TURRET_SPECS`(`src/sim/defense.ts:113`, 인덱스 = 배치 JSON 계약).
2. **id → Map** — `AFFIX_BY_ID`(`data/affixes.ts:61`), `CARD_AFFIX_BY_ID`(`data/defenseCards.ts:135`), `DEFENSE_CARD_UNIQUE_BY_ID`(:189).
3. **side-effect 등록** — `data/uniques.ts:73`이 import 즉시 `registerUnique`.

**조회는 항상 안전 폴백 헬퍼를 낀다:** `planetContent()`(범위 밖 → 카르곤), `tierParams()`(→ 정찰), `normalizeGuardianPreset()`(→ 타이탄). 신규 카탈로그도 이 규율을 따라야 한다.

**결정론 규율:** data/ 모듈 중 sim이 import하는 것(`guardian.ts`·`lineage.ts`·`defenseCards.ts`)은 순수 정수 연산 + `SeededRng`만 쓴다고 헤더에 명시(`data/guardian.ts:5`, `data/defenseCards.ts:5-8`). 스케일은 `Math.round(a*b/c)` 단일 나눗셈 관용구로 통일(`guardian.ts:157,166`) — Node/Deno 비트 동일 보장.

**검증이 강제하는 것 (전부 vitest, 데이터 전용 생성/검증 스크립트는 없음):**
- `tests/m3Content.test.ts:138` — `ENEMY_BY_TYPE` 22종 & typeIndex **연속성**.
- `:119` — 모든 행성이 잡몹 4역할·엘리트 2종·특산 광물 2종을 갖출 것.
- `:128` — 보스는 정확히 3페이즈.
- `:322` — 유니크 15점, 비트 유일.
- `:425~494` — 콘텐츠 조합 런의 **해시 재현**(리플레이 결정론).
- `tests/defenseCards.test.ts:141` — 어픽스 id 전역 유일(재번호 금지 계약), `:50` 등급별 어픽스 수, `:193` 합성 확률 통계.
- `tests/seedBases.test.ts` — 개수 20·UUID 스킴·밴드 분포 7/7/6.
- `tests/i18n.test.ts:17` — EN/KO 키 동수.

`scripts/`에는 데이터 생성·검증기가 **없다**: `asset-prep.mjs`(이미지 슬라이싱), `deno-verify/*`(리플레이 재실행 검증), `e2e/*`뿐이다.

---

## 2. 적·편대·패턴의 데이터 표현 — 진형은 데이터가 아니다

**적 1종 = 이동 컴포넌트 + 공격 컴포넌트** (`src/sim/patterns/types.ts:21-45`): `MovementKind` 4종(`chargeStraight`/`stationary`/`standoff`/`seekWounded`), `AttackDef` 판별 유니온 4종(`fragments`/`mortar`/`lava`/`heal`). 신규 적은 데이터 행 추가만으로 끝난다 — 이건 편대 구성원(요격기·저격기 등)에 그대로 재사용 가능.

**보스는 패턴이 완전히 데이터**다 (`data/boss.ts:18-112`): `BossAttack` 유니온 8종(`ring`/`spiral`/`lavaLine`/`summon`/`aimedBurst`/`laserNet`/`slowField`/`polygonSpin`) × 3페이즈 × 라운드로빈. **방어 보스 3종의 데이터 형식은 이걸 그대로 복제하면 된다** — 기획 §5의 "강철 골리앗/포자 여왕/위상 감시자"는 `BossDef` + 유니크 효과 파라미터만 얹으면 표현된다.

**진형(formation)은 데이터가 아니라 sim 코드의 스위치다.** `data/waves.ts:21`은 `'ring'|'line'|'edges'|'cluster'` 문자열 4개일 뿐이고, 실제 좌표 산출은 `src/sim/waves.ts:264-335` 하드코딩 switch다. 더 나쁜 건 그 구현이:
- **플레이어 상대 좌표**로 오프스크린 링/변에 배치하고(`:270-276` 주석 "every formation is placed RELATIVE to the player"),
- **`state.waveRng`를 소비**한다(`:279 rng.range`, `:292 rng.chance`, `:302 rng.int`).

→ 기획서 §3 L1(강제 종스크롤, 스폰은 스크롤 오프셋 기준, 편대 진형은 편대에 내장·방어자는 순서만 결정)과 **정면으로 어긋난다.** V자·횡대·포위를 표현하려면 `readonly offsets: {dx,dy}[]` 같은 **RNG 없는 상대 오프셋 목록을 편대 데이터에 내장**하는 신규 타입이 필요하다. 기존 `Formation`은 PvE 전용으로 남기고 침공은 별도 어휘를 쓰는 게 맞다(혼용하면 PvE 해시가 흔들릴 위험).

**공격 패턴을 "편대"로 묶는 단위는 현재 없다.** `WaveCard`(`data/waves.ts:86`)가 가장 가깝지만 `{id, formation, spawns[]}`뿐이고 등장 타이밍은 `WaveSegment.cardInterval`(:107)로 세그먼트가 쥐고 있으며, 방어자가 순서를 정하는 개념이 없다. 웨이브 슬롯 = "편대 6개를 순서대로 꽂는 배열"은 `WaveCard`의 상위 개념으로 신설해야 한다.

---

## 3. 드랍 테이블 구조 — 설계도 편입 지점

현행은 **극도로 얇다.** `PlanetDropTable`(`data/planets/index.ts:28-35`)은 스칼라 3개뿐: `eliteRareBase`/`eliteUniqueBase`/`bossUniqueBase`. **"무엇이 떨어지는가"의 테이블이 아니라 "어느 등급이 뜨는가"의 확률표**다.

파이프라인(ADR-0005 규율, `src/sim/drops.ts:5-13`):
1. sim이 `rollEliteDrop`/`rollBossDrop`(`src/sim/drops.ts:55,78`)으로 `{seed, rarityCode}`만 방출 — **sim은 item 레이어에 런타임 의존 금지**(:10-13 명시).
2. 소비는 `src/sim/world.ts:2130` `planetContent(state.config.planet).dropTable`.
3. loot 엔티티는 `enemyType` 필드에 rarityCode를 재활용해 저장(`src/items/types.ts:27` "NEVER renumber").
4. 수거 결과는 `state.loot[] = {seed, rarity, planet, tier}`(`tests/drops.test.ts:47`).
5. 실제 아이템 확정은 나중에 `rollItem(seed, rarity)`.

**설계도(방어체) 편입 시 확장 지점 3곳:**
- **① `PlanetDropTable`에 필드 append** — 행성별 특산 방어체 목록 + 드랍 확률. append-only라 기존 4행은 안전.
- **② `src/sim/drops.ts`에 `rollBlueprintDrop` 추가** — 단 sim은 방어체 카탈로그를 알면 안 되므로 `{seed, blueprintTableIndex}` 수준의 **불투명 코드만** 방출하고 확정은 메타 레이어에서(현행 rarityCode와 동일 철학).
- **③ loot 엔티티 표현** — 현행은 `kind:'loot'` 하나에 `enemyType=rarityCode`. 설계도를 별도 픽업으로 만들면 새 kind 또는 필드가 필요하고, 이는 `hashEntity` 레이아웃·리플레이 해시 계약을 건드린다(`src/sim/defense.ts:14-21`이 "신규 Entity 필드 없음, hashEntity 레이아웃 불변"을 규율로 명시). **가장 싼 길은 기존 loot 엔티티에 rarityCode 도메인을 확장하지 말고, `state.loot` 항목에 append-only 필드를 하나 더 얹는 것**이다.

참고: `설계도`/`blueprint`는 코드베이스 전체 grep **0건** — 완전 신규 개념이다.

---

## 4. 등급/어픽스 엔진 재사용성 — 장비 엔진은 못 쓰고, 카드 엔진은 그대로 쓴다

**병렬 엔진이 이미 둘 있다:**

| | 장비 어픽스 | 카드 어픽스 |
|---|---|---|
| 정의 | `AffixDef`(`src/items/types.ts:115`) | `CardAffixDef`(`data/defenseCards.ts:87`) |
| 풀 | `data/affixes.ts` 24종 | `data/defenseCards.ts:106,120` 16종 |
| 스탯 어휘 | `StatKey`(`src/items/types.ts:90`) — 플레이어 로드아웃 전용 | `CardStatKey`(`data/defenseCards.ts:37-47`) — 방어전 전용 |
| 롤러 | `src/items/roll.ts` | `src/items/rollCard.ts` |
| 인스턴스 | `ItemInstance` | `CardInstance`(:244) |

**결론: 장비 어픽스 엔진은 방어체에 재사용 불가에 가깝다.** `StatKey`가 `damagePct`/`moveSpeedPct`/`magnetPct`처럼 플레이어 파생 스탯 파이프라인 어휘라, 방어체(편대 HP·설비 연사·해저드 주기)에 의미가 없다. **카드 시스템이 정확히 같은 이유로 `CardStatKey`를 따로 만든 전례**가 있다(`data/defenseCards.ts:32-36` 주석).

**재사용되는 것은 "어픽스 풀"이 아니라 "롤 구조"다:**
- `Rarity` / `RARITY_CODE` / `RARITY_BY_CODE`(`src/items/types.ts:24-39`) — 4등급 사다리, 그대로 사용.
- `nextRarityUp`(`data/defenseCards.ts:320`) — 승급 사다리.
- `{id, name, kind:'prefix'|'suffix', stat, min, max}` → `{id, stat, value}` 롤 → 인스턴스(`prefixes[]`/`suffixes[]`/`uniqueId?`/`seed`) 구조 — **`CardInstance`(:244) 형태를 그대로 복제**하면 "노말→유니크 4등급 + 방어체 어픽스 + 유니크 고유 효과"가 즉시 성립.
- `SeededRng` 기반 순수 롤 + "같은 시드 → 바이트 동일" 계약(`tests/defenseCards.test.ts:42`).
- 유니크 파라미터 표현: `DefenseCardUniqueDef{id,name,params:Record<string,number>}`(`data/defenseCards.ts:167`) — 룰 변경형 고유 효과를 데이터로 담는 가장 좋은 선례. 방어 보스 유니크("파괴 시 코어 실드 재생")에 그대로 적용 가능.

**코어 모듈은 "신규 개발"이 아니라 "개명 + 재배선"이다.** `data/defenseCards.ts` 426줄 전부(어픽스 16·유니크 4·`CARD_CHARGE_RANGE`·`FUSION_CHANCE`·`dailyShopRotation`·`cardSalvageValue`·`cardBuyPrice`)가 이미 CONTEXT.md의 "코어 모듈/사용 횟수/모듈 어픽스/모듈 경제" 정의와 1:1이다. DB(`supabase/migrations/20260718160000_m6_defense_cards.sql:61` `defense_cards` 테이블 + `:185 begin_invasion`, `:305 apply_invasion_result`, `:525 salvage_card`)까지 존재한다. **단 `CardStatKey` 8종이 구 아레나 전제**(`turretDamagePct`·`coreShieldFlat`·`incomingDmgReductionPct`…)라 3레이어 어휘로 재정의가 필요하고, 이건 `defense_cards.card` jsonb 계약과 RPC를 함께 건드린다.

---

## 5. seedBases 현행 형식과 3레이어 재구성 작업량

**현행 = 표시 메타 전용, layout 없음.** `data/seedBases.ts:5-8` 헤더가 명시: "**정본(layout)은 서버 마이그레이션 SQL 단독**(리드 판정 2026-07-17). 이 파일은 layout을 이중 정의하지 않는다." 클라이언트가 갖는 건 `SeedBaseMeta{id, profileId, order, initialRank, name, difficultyBand, description, shipSummary}` 20행(`:91-115`)뿐이고, 조인 키는 UUID 스킴 `000000e5-ed00-4000-8000-` + 12자리(`:64,67`).

**정본 layout은 `supabase/migrations/20260717080000_m4_phase_e_npc_seed.sql:134-150`** — 20행의 `{"core":{...},"turrets":[{type,x,y}…],"obstacles":[…]}` jsonb 인라인.

**작업량 평가 (예상보다 훨씬 작다):**
- **클라 데이터 변경: 거의 0.** `SEED_BASES` 20행의 구조(이름·밴드·순번·rank·shipSummary)는 3레이어와 무관하게 그대로 산다. `tests/seedBases.test.ts`는 layout을 **일절 검사하지 않는다**(개수·UUID·밴드 분포·헬퍼만) → **회귀 0**.
- **텍스트 재작성: 20행 description + 일부 name.** 현행 문구가 구 아레나 전제다 — "저격 회랑"(:109), "이중 포좌"(:97), "장애물을 촘촘히 세워 진입로를 좁힌"(:99). 3레이어(편대/설비/기물/보스) 어휘로 다시 써야 정찰 화면이 말이 된다. 순수 카피 작업.
- **서버 SQL: 20개 layout JSON 전면 재작성** — 웨이브 슬롯 6 + 소켓 10 + 보스/수호/기물 구조로. 난이도 밴드(하위 7/중하 7/중위 6)와 정합하도록 기본 수비대 비율을 조절. 미출시라 기존 마이그레이션 수정이 아니라 **신규 마이그레이션으로 갈아끼우기**가 안전.
- **`defense_layout_cost` / `budget_spent` 서버 가드**(`src/net/defenseSync.ts:23,46`)는 기획 결정 14("슬롯이 곧 예산, 코스트 포인트 없음")로 **폐지 대상** — SQL 함수·컬럼·클라 `defenseLayoutCost`가 함께 사라진다.

---

## 6. i18n 키 관리 규약과 신규 문자열 절차

**구조:** `src/i18n/catalog.ts`의 `EN`이 정본이고 `MessageKey`가 거기서 파생, `KO`는 `Record<MessageKey,string>`로 타입 강제 → **KO 누락 시 tsc 실패**. 조회는 `t(key, params)`(`src/i18n/index.ts:109`), `{name}` 치환(:97), 폴백은 현재로케일 → EN → 키 자체(:112).

**신규 문자열 추가 절차:**
1. `catalog.ts`의 `EN`에 `'namespace.key': 'English'` 추가(주제별 섹션 주석 유지).
2. `KO`의 대응 위치에 한글 추가(안 하면 컴파일 오류).
3. 소비처에서 `t('namespace.key')`.
4. `tests/i18n.test.ts:17`(키 동수)·`:23`(빈 문자열 금지)이 자동 검증.

**중요한 함정 — 콘텐츠명은 현재 i18n 밖이다.** `catalog.ts` 헤더 주석: "sim/data 소유의 콘텐츠명(행성명·파워업명·적명 등)은 데이터 레이어라 **별도 확장으로 남긴다**(carry-forward)". 실제로 행성명은 `data/planets/index.ts:65 name:'카르곤'`, 적 이름은 코드 주석/`id` 문자열에만 있다. **방어체 카탈로그 26종+(편대 8·설비 9·기물 6·보스 3) 이름·설명은 이 미결 문제를 정면으로 마주친다** — 지금 확장을 안 하면 한글 하드코딩이 26종 더 쌓인다.

**최적 선례는 스티커다:** `data/stickers.ts:33`이 한글 텍스트를 데이터에 갖되, i18n에도 `sticker.<id>` 키가 있고 `tests/i18n.test.ts:28-36`이 **`STICKERS` 정본에서 키를 파생 검사**한다(하드코딩 목록이 아니라). 방어체도 `defense.<id>.name` / `defense.<id>.desc` 규칙 + 카탈로그 배열에서 파생하는 테스트를 두면 신규 방어체 추가 시 i18n 누락이 자동으로 잡힌다.

**렌더 주의:** Pixi 텍스트는 컬러 이모지가 두부로 나와 `src/ui/pixi/text.ts` `stripEmoji`를 거친다(▶◀만 보존). 방어체 이름에 이모지를 넣지 말 것.


### 재활용

- D:/ClaudeCowork/worktrees/shooting/invasion-3layer-redesign-390d74/data/boss.ts — BossAttack 판별 유니온 8종 + BossPhaseDef/BossDef(3페이즈 라운드로빈). 방어 보스 3종 데이터 형식으로 거의 그대로 복제 가능(:18-137)
- D:/ClaudeCowork/worktrees/shooting/invasion-3layer-redesign-390d74/src/sim/patterns/types.ts — EnemyDef(movement 컴포넌트 + attack 컴포넌트 유니온). 편대 구성원 정의에 그대로 재사용(:21-91)
- D:/ClaudeCowork/worktrees/shooting/invasion-3layer-redesign-390d74/data/defenseCards.ts — 어픽스 정의→시드 롤→인스턴스 구조(CardAffixDef:87 / CardAffixRoll:232 / CardInstance:244), 유니크 파라미터 표현(DefenseCardUniqueDef:167), 합성·상점·분해 순수 함수. 방어체 어픽스 엔진의 복제 원본이자 코어 모듈 본체
- D:/ClaudeCowork/worktrees/shooting/invasion-3layer-redesign-390d74/src/items/types.ts — Rarity / RARITY_CODE / RARITY_BY_CODE(:24-39). 방어체 4등급에 그대로 사용
- D:/ClaudeCowork/worktrees/shooting/invasion-3layer-redesign-390d74/data/guardian.ts — 수호 기체 스냅샷·resolveGuardianStats·scaleStat/scaleCooldown 결정론 정수 관용구. L3 수호 기체 슬롯에 무변경 재사용, 방어체 레벨·승급 스케일 함수의 산술 규율 원본
- D:/ClaudeCowork/worktrees/shooting/invasion-3layer-redesign-390d74/data/planets/index.ts — PlanetContent 레지스트리 + planetContent() 폴백 헬퍼(:44-135). 행성별 방어체 설계도 드랍 테이블의 확장 지점
- D:/ClaudeCowork/worktrees/shooting/invasion-3layer-redesign-390d74/src/sim/drops.ts — DropOdds/rollEliteDrop/rollBossDrop(sim은 seed+code만 방출하고 확정은 메타 레이어). 설계도 드랍이 따라야 할 계약
- D:/ClaudeCowork/worktrees/shooting/invasion-3layer-redesign-390d74/data/economy.ts — 순수 결정론 비용 곡선 패턴(리롤/리스펙/창고). 방어체 레벨·승급·어픽스 리롤 비용 함수의 형식 선례
- D:/ClaudeCowork/worktrees/shooting/invasion-3layer-redesign-390d74/data/seedBases.ts — 표시 메타 20행(layout 없음). 구조 유지, description 텍스트만 재작성
- D:/ClaudeCowork/worktrees/shooting/invasion-3layer-redesign-390d74/src/i18n/catalog.ts + tests/i18n.test.ts:28-36 — EN 정본 + KO 타입 강제, STICKERS 파생 키 검증 패턴. 방어체 카탈로그 이름/설명 i18n의 모델
- D:/ClaudeCowork/worktrees/shooting/invasion-3layer-redesign-390d74/data/skills.ts — 트리 데이터 구조(SKILL_TREES 3계열×NODES_PER_TREE 20 + 인덱스 슬라이스 규약). M8 기체 타입별 고유 트리 일반화의 출발점
- D:/ClaudeCowork/worktrees/shooting/invasion-3layer-redesign-390d74/data/stickers.ts — 배열 인덱스=서버 계약 + 재배치 금지 규율의 모범 주석

### 삭제/대체 대상

- src/sim/defense.ts:57-260 — TURRET_SPECS 포탑 6종 + TURRET_* 코드. 3레이어에서는 L2 설비 9종·L3 기물 6종으로 대체되며, 데이터가 sim 안에 박혀 있던 것을 data/ 로 옮기는 기회
- src/ui/defenseCommand.ts:78-121 — GRID_COLS=15 / GRID_ROWS=9 / CELL_W/H / SPAWN_COL/ROW. 15x9 격자 배치 전제 폐기(웨이브 슬롯·설치 소켓으로 대체)
- src/ui/defenseCommand.ts:101 DEFENSE_BUDGET_BASE=20 + src/net/defenseSync.ts:46 defenseLayoutCost + 서버 defense_layout_cost/budget_spent — 기획 결정 14(슬롯이 곧 예산, 코스트 포인트 없음)로 전면 폐지
- src/sim/defense.ts:305-317 DefenseLayout{core,turrets,obstacles,guardians} — 3레이어 배치 스키마로 전면 교체(DB defenses.layout jsonb 계약 동반 변경)
- supabase/migrations/20260717080000_m4_phase_e_npc_seed.sql:134-150 — NPC 시드 기지 20개 layout JSON. 3레이어 세팅으로 신규 마이그레이션 재작성
- data/defenseCards.ts:37-47 CardStatKey 8종(turretDamagePct·coreShieldFlat·incomingDmgReductionPct 등) — 구 단일 아레나 포탑/코어 전제. 코어 모듈 어휘로 재정의 필요(defense_cards.card jsonb 계약 동반)
- data/seedBases.ts:93-115 RAW_SEEDS 20행의 name/description 문구 — '저격 회랑'·'이중 포좌'·'장애물로 진입로를 좁힌' 등 구 아레나 어휘, 3레이어 어휘로 재작성
- CONTEXT.md 용어집의 '방어 배치'(15x9 격자)·'진입 지점'(정중앙 스폰)·'포탑'(6종) 항목 — Flagged ambiguities(:424)에 이미 갱신 예정으로 표시됨

### 위험

- 진형(formation)이 데이터가 아니다 — data/waves.ts:21은 문자열 4개뿐이고 실제 좌표는 src/sim/waves.ts:264-335 하드코딩 switch다. 게다가 (a) 플레이어 상대 오프스크린 배치, (b) state.waveRng 소비(:279,292,302) 라서 강제 스크롤(스크롤 오프셋 기준 절대 스폰)·전멸 가속(RNG 없는 결정적 편대)과 정면 충돌. 편대는 offsets[] 를 내장한 신규 타입이 필요하며, 기존 Formation 을 재사용/개조하면 PvE 리플레이 해시가 흔들린다
- ENEMY_BY_TYPE(data/enemies.ts:97) 인덱스는 리플레이 해시 계약 — 편대 구성원을 여기에 넣으려면 append 만 가능(현재 22종, 다음은 22부터). tests/m3Content.test.ts:138 이 연속성을 강제하므로 중간 삽입은 즉시 실패
- data/** 가 eslint sim 규율(simCoreRestrictions) 밖에 있다 — eslint.config.js:90-94 는 files:['src/sim/**'] 로만 적용되는데, sim 이 data/guardian.ts·data/lineage.ts·data/defenseCards.ts 를 런타임 import 한다. 신규 방어체 데이터 모듈에 Math.random/Date.now 가 들어가도 lint 가 안 잡는다. 3레이어 데이터가 sim 에 대량 유입되기 전에 data/** 를 규율 대상에 추가할 것
- 엔티티 필드 재활용 관례가 확장 여지를 막는다 — src/sim/defense.ts:14-21 이 '신규 Entity 필드 없음, hashEntity 레이아웃 불변'을 규율로 삼아 enemyType/cooldown 을 포탑 유형·쿨다운으로 전용(轉用)했다. 설비·기물·편대·해저드가 동시에 들어오면 재활용 가능한 플랫 필드가 고갈된다. Entity 스키마 확장 = 해시 계약 변경이므로 M7a 착수 전에 필드 예산을 먼저 설계해야 한다
- 코어 모듈 재배선은 DB·RPC 동반 변경 — defense_cards 테이블(20260718160000:61) + begin_invasion(:185)/apply_invasion_result(:305)/salvage_card(:525) + defenses.equipped_card_id 가 이미 배포되어 있다. CardStatKey 어휘를 3레이어로 바꾸면 jsonb 계약이 깨지므로 신규 마이그레이션으로 스키마·RPC 를 함께 갈아야 한다
- 콘텐츠명 i18n 전략이 미결인 채 26종+ 이 들어온다 — src/i18n/catalog.ts 헤더가 '데이터 소유 콘텐츠명은 별도 확장으로 carry-forward' 라고 유예해 둔 상태다. 지금 규약을 정하지 않으면 편대 8·설비 9·기물 6·보스 3 의 한글 이름·설명이 data/ 에 하드코딩되고, 나중 CrazyGames 글로벌 배포 시 일괄 마이그레이션 부담이 된다
- 데이터 물량이 현행 data/ 전체와 맞먹는다 — 기획 §5 카탈로그 26종 + 방어체 어픽스 풀 + 유니크 + 맵 템플릿 3종의 소켓 좌표까지 합치면 data/ 현재 총량(2,995줄)에 필적한다. M7a 임시 카탈로그(편대3·설비4·기물3·보스1)와 M7c 풀 카탈로그의 경계를 데이터 파일 단위로 미리 갈라두지 않으면 중간 상태에서 검증 테스트가 계속 깨진다
- 방어 성공 보상 경로가 기획과 코드에서 어긋난다 — data/defenseCards.ts:282 defenseSuccessDropChance/:299 DEFENSE_DROP_BASE_CHANCE 는 '방어 성공 시 카드 드랍' 을 구현하는데, 기획 §4 는 '방어 성공 보상은 방어체 획득 경로에서 제외(부익부 방지)' 이고 미결 #5 로 남아 있다. 코어 모듈 드랍은 유지인지 폐지인지 확정 전에는 이 함수군을 건드리지 말 것

---

