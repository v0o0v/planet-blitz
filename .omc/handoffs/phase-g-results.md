# Phase G — M4 게이트 5종 최종 검증 결과 (worker-g, 2026-07-17)

브랜치 `feat/m4-phase-g`. 원격 `qxgbxwyccbxokdgwxcuw`(verify-invasion **v4 ACTIVE**).
각 게이트는 "실행 증거"(실측)로 판정 — 주장 아님. **게이트 전 5종 + 회귀 PASS.**

실행 산출물(재실행 가능):
- `scripts/e2e/invasionE2E.ts` — 실 익명 계정 2개로 게이트①②⑤ 라이브 e2e(Deno + supabase-js + .env.local).
- `scripts/e2e/probe.ts` — 배치전/침공 결과 결정론 탐침(idle 승리 틱 실측).
- `supabase/tests/phase_e_verification.sql` T-E2·T-E3 — 게이트③④ 재실행(기존 파일).

라이브 e2e 실행:
```
cd scripts/e2e && deno run --allow-read --allow-env --allow-net --config ../deno-verify/deno.json invasionE2E.ts
```

---

## 게이트① 위조 100% 거부 (AC2) — PASS

**로컬 코어(deno task verify-run·verify-invasion):** 전 시나리오 실측 녹색.
- verify-run: 6런 accept(Node==Deno bit-identical) + 위조 4종 거부(final-hash-mismatch ×3·outcome-mismatch).
- verify-invasion: 16케이스 — 정직 accept + 게이트/위조 전부 거부(hash-stream-required·config-required·
  invasion-config-required·defense-mismatch·server-layout-invalid·invasion-inputs-too-long·
  final-hash-mismatch·outcome-mismatch).

**원격 EF 위조 스모크(실 JWT, 계정 B → NPC#01):**
| 위조 | 원격 EF 결과 |
|---|---|
| 조작된 최종 해시 | `status=rejected reason=final-hash-mismatch` |
| 트림된(짧은) 로그 | `status=rejected reason=final-hash-mismatch` |
| 승패 뒤집기(승리 런을 패배 주장) | `status=rejected reason=outcome-mismatch` |
| self-invasion insert(attacker=defender) | **insert 자체 거부** — 트리거 `self-invasion is not allowed (attacker = defender)` |

DB 확인: 위 3건 invasions `verified_status='rejected'`(`b_rejected=3`), self는 행 미생성.

## 게이트② 침공 e2e (AC3) — PASS

실 익명 계정 A(방어)·B(공격) 전 과정:
1. A 프로필·기체·방어(무포탑 코어 layout)·인벤 2개 업로드, B 동일.
2. A·B 각각 NPC#01 배치전 5승 → `apply_placement_result`: A=rank11, B=rank12(A 상위).
3. B `get_invasion_targets` → **A 제안됨**(`6a7bb22b#11`).
4. B 침공 리플레이(idle 승리) insert → verify-invasion invoke → **`status=verified attackerWon=true`**,
   EF 스왑 `{attackerRank:11, defenderRank:12}`, 복제 약탈 loot 2건.

**원격 DB 직접 실측(EF 응답과 독립):**
- 스왑: A rank11→12, B rank12→11 (침공 invasion `caused_swap=true`, `ba_swap=1`).
- 복제 약탈: B 인벤 2→4(A 아이템 2개 `-loot-` 접미사 복제), **A 원본 2개 무손실**(ADR-0003).

## 게이트③ 배치전 삽입 무변동 (AC4) — PASS

`supabase/tests/phase_e_verification.sql` **T-E3** 클린 베이스라인 재실행(DO 블록 RAISE 자동 롤백):
```
result={"note":"placed","rank":13,"placed":true,"matches_won":4}
existing_order_preserved=t  total_ladder=21  tester_rank=13
```
4승 유저가 rank13에 삽입돼도 기존 20명 상대 순서 문자열 완전 동일(삽입점 이하 일괄 +1 shift).
라이브 e2e에서도 A·B 삽입이 NPC 상대 순서를 보존함을 확인(정리 시 rank 1~20 무결 복원).

## 게이트④ 풍화 무결 (AC5) — PASS

**T-E2** 클린 베이스라인 재실행(DO 블록 RAISE 자동 롤백):
```
weathered=20  ladder_unchanged=t  profiles_unchanged=t  items_unchanged=t
def_layoutbudget_unchanged=t  maint_changed=t  mb=2000.00  ma=1900.00
```
`weather_defenses()`는 `defenses.maintenance`만 -5(20기 합 2000→1900), ladder/profiles/items/
defense layout·budget 전부 불변. 자원·장비·순위 무변동, 정비도만 하락.

## 게이트⑤ 상호 침공·복수전 (AC6) — PASS (스크립트 e2e)

게이트②에서 B가 A를 이겨 순위 강탈(caused_swap) 후, A의 복수전:
1. A `get_revenge_targets` → **B 제안**(revenge_invasion_id = B의 침공 id, 쿨다운 무시·24h 창).
2. A 역침공 insert → verify-invasion → **`status=verified attackerWon=true revenge=true bonusMinerals=50`**,
   탈환 스왑 `{attackerRank:11, defenderRank:12}`(A 재상승).

**원격 DB 실측:**
- 최종 A rank11 / B rank12(탈환 완료). 복수 invasion `is_revenge=true caused_swap=true`(`ab_revenge_swap=1`).
- 보너스 광물: A `save.minerals` 100→**150**(+50).
- 복제 약탈: A 인벤 2→5(B 아이템 3개 복제), B 원본 무손실.
- 상호성: B→A(게이트②) + A→B(복수) 양방향 침공 성립.

> ⚠️ **사람 실플레이 잔여**: 본 게이트⑤·②는 **스크립트 e2e(기술 검증)** — 헤드리스 idle 리플레이로
> 서버 판정·스왑·복수·약탈·보너스를 실측했다. 체크리스트의 "사람 실플레이 권장 구간"(하네스
> 딥링크 `/harness` + `__pb.harness.ff` 수동 플레이, 두 계정 상호 침공 UX)은 **사용자 몫으로 잔존**.

## 회귀·결정론 (AC13) — PASS

| 검증 | 결과 |
|---|---|
| `npm test`(vitest) | **512 tests / 50 files 전부 통과** |
| `npx tsc --noEmit` | exit 0 |
| `npx eslint . --max-warnings 0` | exit 0 (src/sim 금지 심볼 lint 포함 — `no-restricted-globals`/`-imports`/`-properties`) |
| `deno task verify`(parity) | Node↔Deno bit-identical(수학 프로브 + 6시나리오, 전 행성·기믹·보스) |
| `deno task verify-run` | 6 accept + 위조 4 거부 |
| `deno task verify-invasion` | 정직 accept + 게이트/위조 16케이스 거부(방어 엔티티·정비도 포함) |
| `get_advisors(security)` | **ERROR 0**. WARN 전부 문서화된 의도 — authenticated-scoped SECURITY DEFINER RPC 9종(placement·repair·get_*·set_invasion_sticker), 익명 Auth 베이스라인. `apply_invasion_result`·`weather_*`·`sink_inactive`·`flag_pve_anomalies`·`revenge_targets_for`는 목록 부재 = service 전용 EXECUTE 봉인 확인 |
| `get_advisors(performance)` | ERROR 0. INFO(비인덱스 FK·미사용 인덱스)·WARN(auth_rls_initplan) 뿐 — 전부 스키마 생성 이래 기존 항목, Phase G가 새로 유발한 것 없음(저우선 최적화) |

---

## 원격 데이터 정리 상태 — 완료

- 라이브 e2e 계정 A(`6a7bb22b…`)·B(`f410dbcb…`) `auth.users` 삭제 → cascade(profiles/ships/items/
  defenses/ladder/invasions). 배치전이 shift한 NPC 래더 rank·wins·losses·last_active를 **테스트 전
  스냅샷으로 정확 복원**.
- 사후 실측: `profiles=20, ladder_rows=20, rank 1~20 연속, wins/losses 전부 0, invasions=0,
  leaked_loot=0, anon_users=0, maint_sum=2000`(T-E2/T-E3 RAISE 자동 롤백 후에도 무결).
- **NPC·시드 데이터 무손상 확인.** 잔류 테스트 데이터 0.

## 남은 사람 실플레이 항목(사용자 몫)
- 하네스 딥링크 수동 실플레이로 침공 런 UX(3분 제한·부활 불가·코어 파괴 연출) 체감 확인.
- 두 실제 기기/브라우저로 상호 침공·복수전 UX(관제탑 제안·도발 스티커·알림 배너) 확인.
- (기술 경로는 본 e2e로 전수 검증됨 — 사람 플레이는 UX/감성 게이트.)
