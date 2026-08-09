# Planet Blitz

탑다운 탄막 슈팅 × 핵앤슬래시 장비 파밍 × 비동기 PvP 웹게임.

TypeScript(strict) · PixiJS v8 · Vite · Vitest · Supabase(Postgres + Edge Functions) · pnpm.

- 기획: [docs/GDD.md](docs/GDD.md) · 용어: [CONTEXT.md](CONTEXT.md)
- **되돌리기 어려운 결정은 [docs/adr/](docs/adr/) 가 정본이다**(55건). 문서와 코드가 어긋나면 코드가 맞다.

## 아키텍처

```
src/sim  ──스냅샷──▶  src/render  ──▶  화면
 (결정론)   (단방향)      (PixiJS)
    │
    └─ 서버는 같은 sim 을 쓰지 않는다 (ADR-0050) — 자기 시드를 굴리고 원장·상한으로 위조를 묶는다
```

**세 계층의 경계가 이 리포의 규율 전부다.**

1. **`src/sim` — 결정론 코어.** 플랫폼 독립. 시드 RNG(`rng.ts` mulberry32 + 스트림 fork)만
   쓰고, 시간은 틱 카운트뿐이며, 초월함수는 엔진별 차이를 피해 `math.ts` 의 기본연산 근사로
   대체한다. 60Hz 고정 타임스텝(`world.ts`).
2. **`src/render` — PixiJS 어댑터.** 시뮬이 만든 불변 스냅샷만 읽는다. **역류 없음** — 렌더가
   시뮬 상태를 쓰지 않는다.
3. **서버 — Supabase.** 재화·촉매·설계도·의뢰서·래더는 전부 서버 원장이 정본이고, 클라이언트가
   쓰는 경로는 RLS 로 막혀 있다(쓰기는 security definer RPC 전용).

### 결정론 규율 (ADR-0005)

`src/sim/**` 에서 아래를 **ESLint 가 에러로 차단**한다(`eslint.config.js`).

| 금지 | 이유 |
|---|---|
| `pixi.js` import | 렌더 의존은 곧 플랫폼 의존 |
| `Math.random` | 시드 RNG 만 사용 |
| `Date.now` · `performance.now` | 시간은 틱뿐 |

같은 시드 + 같은 입력로그를 두 번 돌리면 틱별 상태 해시(FNV-1a, float64 비트 단위)가 100%
일치해야 한다. `tests/determinismGate.test.ts` 가 기본 스위트 안에서 상시로 지킨다 —
**골든 상수 대조가 아니라 자기 재현성**이다(동결값을 비교하면 값이 바뀔 때마다 재생성해야
하는데, 정작 지키려던 불변식은 "두 번 돌리면 같은가"였다).

## 실행

pnpm 을 쓴다. 버전은 `package.json` 의 `packageManager` 에 고정돼 있다.

```bash
corepack enable pnpm
```

```bash
pnpm install
```

```bash
pnpm dev
```

`http://localhost:5180` — 이동 `WASD` · 대시 `Space` · 액티브 `Z`/`X`. 주무기는 최근접 적
자동 조준이라 조작은 회피와 자리잡기에 집중된다.

쿼리 플래그:

| 플래그 | 용도 |
|---|---|
| `?seed=1234` | 시드 고정(같은 시드 = 같은 웨이브·리플레이) |
| `?bench=1` | 성능 씬 — 탄 2,000 + 적 200, `window.__bench.step()` 노출 |
| `?harness=1` | **DEV 전용** 하네스 — 치트 패널 + 프로필 I/O 를 격리 슬롯으로 |

`?harness=1` 은 프로덕션 빌드에서 상수로 접혀 사라진다(`isHarnessSession()` 이 `env.DEV` 를
먼저 본다). 하네스 코드가 배포본에 없다는 뜻이다.

새 워크트리에서 `pnpm install` 을 자동으로 돌리려면 추적되는 훅을 연결한다(머신당 1회):

```bash
git config core.hooksPath .githooks
```

## 검증

```bash
pnpm verify
```

`vitest run && tsc --noEmit && eslint . --max-warnings 0` — **검증은 이 한 층뿐이다.**
개별로는 `pnpm test` · `pnpm typecheck` · `pnpm lint`.

현재 **379파일 8,690건**, 약 90초. 스위트가 빨간 채로 방치되는 상태를 만들지 않는 것이
규율이라, 통계 계측처럼 "봇이 이길 수 있는가"에 의존하는 단언은 게이트에서 내리고
`bench/` CLI 로 옮겼다(ADR-0051 — 241초 → 55초로 줄인 조치다. 자세한 근거는
[vite.config.ts](vite.config.ts) 상단 주석).

### 밸런스 하네스

```bash
pnpm balance
```

**10분 예산**으로 난이도 곡선·로스터 편차·행성 편차·경제 지표를 재고 게이트로 판정한다.
`(행성 6 × 기체 7 × 표준 레벨)` 격자를 코어 수만큼 병렬로 돌리고, 축은 카탈로그에서
파생되므로 **행성·기체가 늘어도 하네스를 고칠 필요가 없다**(격자가 커지면 셀당 시드 수가
줄어 소요 시간이 유지된다).

산출물은 `.balance/report.md` · `summary.json` · `runs.json`.
절차·게이트 근거·측정 사각지대는 [docs/balance-check.md](docs/balance-check.md) 가 정본이다.

개별 측정은 `pnpm bench:curve` · `bench:invasion` · `bench:commission` · `bench:nominal` ·
`bench:gearlevel`.

## 프로젝트 구조

```
src/
├── sim/          # 결정론 코어 — PixiJS·Math.random·시계 import 금지(lint 강제)
│   ├── rng.ts        시드 RNG(mulberry32) + 스트림 분리
│   ├── math.ts       초월함수 격리(IEEE-754 결정론)
│   ├── world.ts      60Hz 고정 타임스텝 상태 머신
│   ├── replay.ts     입력로그 기록·재생 + FNV-1a 상태 해시
│   ├── collision.ts  공간 해시 브로드페이즈
│   ├── skills/       스킬 210종 효과
│   ├── catalyst/     촉매 48종 + 공명
│   ├── invasion/     침공 3레이어(대기권·회랑·코어방)
│   ├── modes/        행성별 게임플레이 모드 6종
│   └── encounters/   조우 프레임워크
├── render/       # PixiJS v8 — 스냅샷 → 화면, 보간, 레터박스, 셰이더
├── ui/pixi/      # 캔버스 UI(기지·격납고·연구소·관제탑·정제소 …)
├── save/         # 프로필 스키마·정산·수호기 생애주기
├── items/        # 장비 롤·어픽스·정련·액티브 스킬
├── net/          # Supabase 게이트웨이 — 공개 함수는 throw 하지 않는다
├── run/          # 런 수명주기·의뢰 배송
├── harness/      # DEV 전용 치트 패널·목업
└── i18n/         # KO/EN 카탈로그(용어 정본은 catalog.ts 의 KO 선언부)
data/             # 카탈로그 — 기체 7·행성 6·적·웨이브·어픽스·촉매·계보·유니크
tests/            # vitest
bench/            # 통계 계측 CLI(게이트 밖 — ADR-0051)
supabase/
├── migrations/   # 64건
└── functions/    # Edge Function 4종
```

## 서버 (Supabase)

설계·테이블 목록은 [`supabase/README.md`](supabase/README.md), 배포 현황은
[`supabase/DEPLOYMENTS.md`](supabase/DEPLOYMENTS.md) 가 정본이다.

**Edge Function 은 4종**이다.

| 함수 | 역할 |
|---|---|
| `verify-invasion` | 래더 스왑 · 복제 약탈 |
| `verify-commission` | `commission_grants` 발급 |
| `daily-reward` | 일일 보상 수령 |
| `modules` | 코어 모듈(type-only import — 시뮬 미번들) |

앞의 셋이 남은 이유는 검증이 아니라 **service_role 만 할 수 있는 쓰기** 때문이다.

**`src/sim/**` 을 고쳐도 재배포가 필요 없다 (ADR-0050).** 어떤 EF 도 `src/sim` 을 번들하지
않는다 — 서버 재실행 검증을 걷어내고, 대신 서버가 자기 시드를 굴리고 획득 원장과 개연성
상한으로 위조 이득을 묶는 모델로 바꿨다. 재배포가 필요한 때는 **그 EF 자체의 코드를 고쳤을
때뿐**이다.

배포에서 반복해서 밟은 것 셋:

- **"소스를 건드렸나"로 재배포 여부를 판단하지 마라.** 공유 모듈 때문에 안 건드린 함수의
  번들이 바뀌기도 하고, 반대로 건드렸는데 트리셰이킹이 걷어내 **바이트 동일**이기도 하다.
  배포본을 받아 로컬 번들과 해시를 비교하는 것만이 확실하다.
- **번들은 폐기용 detached 워크트리에서 만들고, 번들 소스 커밋이 `origin/main` 과 같은지
  대조한다.** 배포 절차가 `index.ts` 를 자립 번들로 덮어쓰기 때문에 본 워크트리에서 하면
  오염이 남는다.
- **인증 없이 엔드포인트를 때린 것은 부팅 검증이 아니다.** Authorization 헤더가 없으면
  게이트웨이가 `401` 을 돌려주는데 함수는 부팅조차 하지 않은 상태다.

마이그레이션 적용은 `scripts/apply-*.ps1` 이 정본이다. 각 스크립트가 사전조건 → 적용 →
**구조 검증 + 실거동 증명(임시 데이터로 실제 호출 후 롤백)** 까지 한 번에 돈다.

## 웹 배포 (GitHub Pages)

`main` 에 push 하면 [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)
이 정적 번들을 빌드해 `https://v0o0v.github.io/planet-blitz/` 에 올린다. Actions 아티팩트
방식이라 산출물이 히스토리에 쌓이지 않는다. `pnpm build` 가 `tsc --noEmit` 을 먼저 돌리므로
**타입 오류가 있으면 배포가 막힌다.**

사전 설정(각 1회):

1. 리포 public (무료 요금제의 private 리포는 Pages 를 못 쓴다)
2. Settings → Pages → Source = "GitHub Actions"
3. Actions 시크릿 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
4. Supabase Dashboard → Authentication → URL Configuration 에 `https://v0o0v.github.io` 추가

시크릿 둘 중 하나라도 없으면 [`readSupabaseConfig()`](src/net/config.ts) 가 null 을 돌려
**네트워크 계층이 통째로 no-op** 이 된다 — 배포는 성공하되 오프라인 데모로 뜬다. 이 성질은
사고가 아니라 설계다: vitest·밸런스 러너·오프라인 플레이가 전부 이 경로를 탄다.

주의 둘:

- **`base` 가 리포 이름에 묶여 있다.** 프로젝트 페이지는 `/planet-blitz/` 가 경로 접두사라
  [`vite.config.ts`](vite.config.ts) 가 build 일 때만 그 값을 쓴다. 리포 이름을 바꾸거나
  커스텀 도메인으로 옮기면 여기를 같이 고쳐야 한다 — 안 고치면 자산이 전부 404 다.
- **Pages 사이트는 리포가 private 이어도 공개다.** 그래서 CI 빌드는 소스맵을 끈다(켜면 `.ts`
  원본이 통째로 복원된다). 로컬 `pnpm build` 는 그대로 낸다.

## 인증

구글 OAuth(리다이렉트 방식)와 **게스트(Supabase 익명 계정)** 둘. 게스트도 정식 서버 계정이라
기능 제한이 없고, 다른 점은 진행이 브라우저에 묶인다는 것뿐이다.

`signInAnonymously` 호출은 [`src/net/auth.ts`](src/net/auth.ts) **한 곳으로 가둬** 두고
테스트가 그 목록을 잠근다. 게이트웨이가 "세션 없으면 만들어 준다"를 복제하면 사용자가
아무것도 고르지 않았는데 계정이 생기기 때문이다 — 위험한 것은 익명 로그인 자체가 아니라
그 자동 폴백이다.

## 라이선스

**독점 저작물이다 — 소스 공개는 열람 허용이지 이용 허락이 아니다.** 복제·수정·배포·상업적
이용은 사전 서면 허가가 필요하다. 전문은 [`LICENSE`](LICENSE).

예외로 `assets/audio/**` 의 BGM 6트랙은 CC0 1.0 이다(출처는
[`assets/audio/CREDITS.md`](assets/audio/CREDITS.md)). 라이선스가 다른 자산을 추가하면
`LICENSE` 의 제3자 자산 절에 같이 적을 것 — 안 적으면 독점 고지가 남의 자산까지 덮는 것처럼
읽힌다.
