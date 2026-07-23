---
name: planet-blitz-supabase-deploy-workflow
description: Planet Blitz 원격 배포 — MCP 없이 PAT 만으로 마이그레이션·Edge Function 을 올리는 절차와 함정(UTF-8·분류기·sloppy-import 번들)
triggers:
  - supabase 배포
  - supabase db push
  - 마이그레이션 원격 적용
  - Cannot find project ref
  - Management API database/query
  - spb functions deploy
  - verify-invasion 재배포
  - "Expected ',' or '}' after property value"
  - JSON 400 position
  - sloppy-imports deploy
  - deno task bundle
---

# Planet Blitz Supabase 원격 배포 (PAT 전용)

## The Insight

이 프로젝트의 원격 배포는 **DB 비밀번호도 supabase MCP 도 없이 PAT 하나로** 끝낼 수 있는데,
마이그레이션 경로와 EF 경로가 각각 비직관적 벽을 하나씩 갖는다:

1. **마이그레이션 = Supabase Management API 의 `database/query` 엔드포인트로 SQL 직접 실행.**
   `supabase db push` 는 `--project-ref` 를 **안 받고**(`Cannot find project ref`) `supabase link`
   (DB 비밀번호) 또는 `--db-url`(비밀번호 내장)을 요구한다. supabase MCP(`apply_migration`)는
   OAuth 인증이 필요해 비대화형 세션에서 못 쓴다. 남는 길은 PAT 로 Management API 를 직접
   때리는 것이다 — 이게 MCP `apply_migration` 이 내부적으로 쓰는 바로 그 경로다.

2. **EF = sloppy-imports 때문에 원본 index.ts 로는 CLI 배포 불가 → 자립 번들을 올려야 한다.**
   `verify-invasion` 은 `src/sim` 전체를 sloppy-imports(확장자 없는/`.js`→`.ts`)로 당겨오는데
   CLI 배포 번들러는 이를 못 따라간다. `deno task bundle` 이 만든 `dist.index.js`(외부 jsr 만
   external, 나머지 인라인)를 entrypoint 로 올려야 한다.

## Why This Matters

- 이걸 모르면 `supabase db push` 로 삽질하다 `Cannot find project ref` 에 막히고, MCP 인증을
  기다리게 된다. 실제로는 PAT 로 5분이면 끝난다.
- **UTF-8 함정(가장 시간 잡아먹음)**: 마이그레이션 SQL 을 `Get-Content -Raw` 로 읽고 문자열로
  전송하면, 한글 주석이 깨져(`濡???뼱` 류 mojibake) 서버 JSON 파서가
  `Expected ',' or '}' after property value in JSON at position <N>` **400** 을 뱉는다. 원인이
  SQL 이 아니라 **요청 본문 전송 인코딩**이라 오진하기 쉽다.
- EF 를 원본 index.ts 로 배포하면 sloppy-import 해석 실패로 깨진 함수가 올라가거나 배포가
  실패한다(라이브 래더 검증이 망가질 수 있어 위험).

## Recognition Pattern

- Planet Blitz(`qxgbxwyccbxokdgwxcuw`) 서버측을 배포해야 함.
- `spb`(PAT 래퍼, `$PROFILE` 정의, `~/.supabase-pb.token` DPAPI)는 있는데 DB 비밀번호는 없음.
- Management API 400 이 **특정 byte position** 에서 나고 메시지가 JSON 파싱 오류.
- `spb functions deploy` 대상이 `src/sim` 을 import 하는 EF.

## The Approach

### 안전 분류기 경계 (핵심)
- **`spb <subcommand>`(깨끗한 CLI 호출, 토큰은 함수 내부에서 처리)는 분류기 통과** — EF
  배포·삭제·목록은 Claude 가 직접 실행 가능.
- **토큰을 인라인 복호화해서 외부로 POST 하는 명령은 분류기가 차단**(exfiltration 패턴). 즉
  Management API 마이그레이션은 Claude 가 직접 못 돌린다 → **스크립트 파일로 만들어 사용자가
  자기 터미널에서 실행**하게 한다. 파일로 숨겨 우회하지 말 것(차단 의도 존중).

### 마이그레이션 (사용자 실행 스크립트)
각 마이그레이션마다:
1. SQL 을 **반드시 UTF-8 로 읽기**: `[IO.File]::ReadAllText($f,[Text.Encoding]::UTF8)`
   (`Get-Content -Raw` 금지 — 한글 깨짐).
2. 본문: `@{query=$sql} | ConvertTo-Json -Depth 5 -Compress`.
3. **UTF-8 바이트로 전송**: `Invoke-RestMethod -Body ([Text.Encoding]::UTF8.GetBytes($body))
   -ContentType 'application/json; charset=utf-8'` (문자열 그대로 전송 금지).
4. 엔드포인트: `POST https://api.supabase.com/v1/projects/<ref>/database/query`,
   헤더 `Authorization: Bearer <PAT>`.
5. 적용 후 `insert into supabase_migrations.schema_migrations(version,name) values(...)
   on conflict(version) do nothing;` 로 기록(향후 db push 재적용 방지).
6. **오배포 방지**: 먼저 `GET /v1/projects/<ref>` 로 name 에 `planet` 포함 확인.
7. 순서 지키기(타임스탬프 오름차순). 400 파싱오류면 SQL 은 실행 안 된 것(재실행 안전).
8. 콘솔 깨짐 방지: `[Console]::OutputEncoding = [Text.Encoding]::UTF8`(표시용, 전송과 별개).

### Edge Function (Claude 직접, spb)
1. `cd supabase/functions/verify-invasion && deno task bundle` → `dist.index.js` 생성
   (머지된 최신 소스에서 — 스테일 번들 주의).
2. `index.ts` 원본 **바이트**를 백업(`ReadAllBytes`), `dist.index.js` 를 `index.ts` 로 복사.
3. `spb functions deploy verify-invasion --project-ref <ref> --use-api`
   (`--use-api` = Docker 불필요; `--no-verify-jwt` 는 **주지 말 것** → JWT 검증 유지).
4. `finally` 로 `index.ts` 원본 바이트 복원 → `git status` 로 원복 확인(변경 0).
5. 폐기된 EF 는 `spb functions delete <name> --project-ref <ref>`.
6. 확인: `spb functions list --project-ref <ref>` 로 VERSION 증가 확인.

### 배포 후 남는 것
서버 권위는 즉시 라이브지만, 재화 earn/spend RPC 호출은 **머지된 새 클라에만** 있다 —
구 클라 배포본은 재화를 못 벌게 된다(guard 가 save 무시). 미출시면 무해하나 출시 전 클라
웹 빌드가 main 을 포함해야 정합.

## Example

```powershell
# 마이그레이션 본문 전송(사용자 스크립트 안) — UTF-8 바이트가 핵심
$utf8 = [System.Text.Encoding]::UTF8
$sql  = [System.IO.File]::ReadAllText($file, $utf8)          # NOT Get-Content -Raw
$body = @{ query = $sql } | ConvertTo-Json -Depth 5 -Compress
$bytes = $utf8.GetBytes($body)
Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/database/query" `
  -Headers @{ Authorization = "Bearer $pat" } -Method Post `
  -Body $bytes -ContentType 'application/json; charset=utf-8'
```
