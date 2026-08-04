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

## 현재 상태 (2026-08-03 실측)

| 함수 | 버전 | 배포 시각(UTC) | 번들 SHA-256 | 크기 | 비고 |
|---|---|---|---|---|---|
| `verify-invasion` | 44 | 2026-08-04 02:45:16 | `C58AF531…C9C283` | 246,981 B | `origin/main`(`fc4a659`) 번들과 **바이트 동일 확인**(download 재대조) · 밸런스 5레인 통합 |
| `verify-commission` | 9 | 2026-08-04 02:44:29 | `5320F168…995B78` | 242,309 B | `origin/main`(`fc4a659`) 번들과 **바이트 동일 확인**(download 재대조) · 밸런스 5레인 통합 |
| ~~`verify-invasion`~~ | ~~43~~ | ~~2026-08-01 22:13:59~~ | ~~`ED74C76C…F86B30`~~ | ~~245,959 B~~ | 이전 세대(`aeef4ba`) |
| ~~`verify-commission`~~ | ~~8~~ | ~~2026-08-03 07:34:05~~ | ~~`9A581EEF…C40485`~~ | ~~241,956 B~~ | 이전 세대(`7e53f6b`) |
| `modules` | 1 | 2026-07-20 19:24:39 | — | 8,021 B | type-only import — sim 을 번들하지 않아 재배포 대상이 아니다 |
| `verify-run` | — | 미배포 | — | — | 로컬 확인 전용(`deno.json` 에 `bundle` 태스크 자체가 없다) |

2026-07-31 이전 이력은 각 배포 PR 본문에 있다(#84 · #86 · #88 · #141 등).

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

## 배포 대상은 **둘**이다

`verify-invasion` 과 `verify-commission` 이 **각각** `src/sim` 을 sloppy-imports 로 당겨 번들에
시뮬 코어를 통째로 싣는다. 서버는 그 번들로 리플레이를 재계산하므로, 시뮬이 바뀐 채 EF 를
방치하면 **서버가 옛 시뮬로 계산해 제출이 전부 거부된다**.

- `verify-invasion` — `src/sim/**` 변경 시 필수.
- `verify-commission` — `src/sim/**` 또는 `src/run/commission*` 변경 시 필수.

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
