# Planet Blitz

CrazyGames 출시용 탑다운 탄막 슈팅 × 디아블로2 파밍 × 비동기 PvP 웹게임. 기획은 [docs/GDD.md](docs/GDD.md), 용어는 [CONTEXT.md](CONTEXT.md), 되돌리기 어려운 결정은 [docs/adr/](docs/adr/)를 따른다.

현재 상태: **M1 전투 프로토타입 — Phase 4(에셋·벤치) 완료** (재미 게이트 5인 테스트 제외). Phase 3까지 런 루프(젬 콤보·3택 파워업·보급선·보스·정산 HUD), Phase 4에서 PixelLab 픽셀아트 에셋 교체 + 성능 벤치 실측. Phase 0~2는 결정론 시뮬 코어·렌더 어댑터·코어 게임플레이. 진행 계획은 [.omc/plans/planet-blitz-m1-plan.md](.omc/plans/planet-blitz-m1-plan.md).

## 실행

이 저장소는 **pnpm** 을 쓴다. pnpm 은 전역 content-addressable 스토어에서 하드링크로 의존성을 깔기 때문에, **git worktree 를 새로 만들어도 `pnpm install` 이 스토어에서 재사용해 빠르고 디스크를 아낀다**(worktree 마다 node_modules 를 통째로 다시 받지 않는다). 버전은 `package.json` 의 `packageManager` 필드에 고정돼 있고, Node 번들 corepack 으로 활성화한다:

```
corepack enable pnpm
```

> corepack enable 이 권한 문제로 막히면(Windows Program Files 쓰기) 활성화 없이 `corepack pnpm <명령>` 으로 바로 실행해도 된다.

의존성 설치:

```
pnpm install
```

새 워크트리에서 자동 설치를 켜려면 추적되는 `post-checkout` 훅을 연결한다(클론/머신당 최초 1회 — 공용 git 설정이라 모든 worktree 에 적용된다). 이후 `git worktree add` 로 만든 워크트리는 node_modules 가 비어 있으면 자동으로 `pnpm install` 이 돈다:

```
git config core.hooksPath .githooks
```

개발 서버 (포트 5180):

```
pnpm run dev
```

- 게임: `http://localhost:5180`
  - **이동** WASD/방향키 · **조준** 마우스 · **대시** Space(쿨다운 + 무적프레임)
  - 주무기(발칸)는 **최근접 적 자동 조준·연사**. 적 웨이브 격파 시 경험치 젬 드랍(자석 수거·콤보 배율).
  - **레벨업** 시 3택 파워업 오버레이가 뜨고 마우스 클릭으로 선택(선택도 입력로그에 기록 — 결정론 유지).
  - 6구간 웨이브 → 보스(용암 요새 전차) → 정산 화면. 정산의 **다시 출격** 버튼으로 재시작.
- 성능 벤치: `http://localhost:5180/?bench=1` — 탄 2,000발(ParticleContainer) + 더미 적 200, 화면에 FPS 표시
- 시드 지정: `http://localhost:5180/?seed=1234` (같은 시드 = 같은 웨이브·리플레이)

### 성능 벤치 측정 방법

`?bench=1` 씬은 초당 `[bench] fps=...`를 콘솔에 로그한다. 다만 브라우저 탭이 백그라운드로 가려지면 `requestAnimationFrame`이 스로틀되어 온스크린 FPS가 왜곡될 수 있다. 이 경우 **프레임당 update+render 소요 ms를 16.6ms 예산과 비교**해 판정한다. DEV 빌드는 이를 위해 `window.__bench.step()`(벤치)·`window.__pb`(게임)를 노출한다:

```
// ?bench=1 탭 콘솔: 워밍업 후 200프레임의 step() 소요 ms 측정
const b = window.__bench; for (let i=0;i<30;i++) b.step();
const t=[]; for (let i=0;i<200;i++){const s=performance.now(); b.step(); t.push(performance.now()-s);}
t.sort((a,z)=>a-z); console.log('avg', t.reduce((a,z)=>a+z)/t.length, 'p95', t[190]);
```

M1 실측(2026-07-15): 2,000탄+200적에서 프레임당 avg **0.49ms** / p95 0.5ms(예산 16.6ms의 ~3%). 게임플레이 개별 Sprite 경로도 avg 1.07ms / p95 1.7ms로 60fps 목표를 큰 여유로 통과 → ParticleContainer 이관 불필요.

## 검증

```
pnpm test
```

```
pnpm run lint
```

```
pnpm run build
```

- `test`: vitest — 결정론 해시 테스트(동일 시드+입력로그 2회 실행 시 틱별 상태 해시 100% 일치) 등
- `lint`: ESLint — `src/sim/**`에서 `pixi.js` import·`Math.random`·`Date.now`·`performance.now` 사용을 에러로 차단 (ADR-0005)
- `build`: `tsc --noEmit`(strict) + `vite build`

### 밸런스 체크

```
pnpm balance
```

**10분 예산**으로 난이도 곡선·로스터 편차·행성 편차·경제 지표를 한 번에 재고 게이트로 판정한다.
`(행성 × 기체 × 표준 레벨)` 격자를 코어 수만큼 병렬로 돌리며, 축은 카탈로그(`PLANETS`·`SHIP_TYPES`·
`BAND_LEVELS`)에서 파생되므로 **새 행성·기체·장비가 들어와도 하네스를 고칠 필요가 없다** —
격자가 커지면 셀당 시드 수가 줄어 소요 시간은 유지된다.

산출물은 `.balance/report.md`(사람용) · `summary.json` · `runs.json`(재집계용)이다.
절차·인자·게이트 근거·측정 사각지대는 **[docs/balance-check.md](docs/balance-check.md)** 가 정본이다.

## 서버 배포

원격 Supabase(프로젝트 ref `qxgbxwyccbxokdgwxcuw`)에 마이그레이션·Edge Function 을 올리는 절차다.
**전체 절차·함정은 `.omc/skills/planet-blitz-supabase-deploy-workflow.md` 가 정본이다** — 아래는
"언제 필요한지"와 "무엇을 놓치면 안 되는지"만 짚는다. 백엔드 설계·테이블·마이그레이션 목록은
`supabase/README.md` 가 담당한다.

**`src/sim/**` 을 건드렸으면 `verify-invasion` 재배포가 필수다.** 그 Edge Function 이 `src/sim` 을
직접 import 해 번들에 시뮬 코어가 통째로 들어가고, 서버는 침공 리플레이를 그 번들로 재계산한다.
방치하면 서버가 옛 시뮬로 계산해 **모든 침공이 해시 불일치로 거부**된다.

배포 대상은 `verify-invasion` 하나뿐이다 — `verify-run` 은 로컬 전용(`bundle` 태스크 없음),
`modules` 는 type-only import 라 시뮬을 번들하지 않는다.

놓치기 쉬운 것 셋:

- **`pnpm test` 와 `scripts/deno-verify/fixtures.json` 이 전부 그린이어도 재배포는 필요하다.**
  그 12 시나리오는 침공 경로를 태우지 않아 침공 시뮬이 바뀌어도 통과한다.
- **번들은 폐기용 detached 워크트리에서 만들고, 번들 소스 커밋이 `origin/main` 과 같은지 대조한다.**
  배포 절차가 `index.ts` 를 자립 번들로 덮어쓰기 때문에 본 부준치에서 하면 오염이 남고, 커밋 대조를
  빼먹으면 스테일 번들이 올라가 "배포했는데 안 고쳐진" 상태가 된다(실제 발생 이력 있음).
- **인증 없이 엔드포인트를 때려 본 것은 부팅 검증이 아니다.** Authorization 헤더가 없으면 Supabase
  게이트웨이가 `401 UNAUTHORIZED_NO_AUTH_HEADER` 를 돌려주는데 함수는 부팅조차 하지 않은 상태다.
  anon 키로 게이트를 통과시켜 함수 본체의 응답을 받아야 검증이 성립한다(스킬 문서의 부팅 스모크 절).

## 프로젝트 구조

```
src/
├── sim/            # 결정론 시뮬 코어 (플랫폼 독립, PixiJS/DOM import 금지 — lint 강제)
│   ├── constants.ts# 타임스텝·아레나 상수 (leaf — 순환 import 방지)
│   ├── math.ts     # 초월함수 격리 — sin/cos/atan2 기본연산 근사(IEEE-754 결정론)
│   ├── rng.ts      # 시드 RNG(mulberry32) + 스트림 분리(fork)
│   ├── entities.ts # 엔티티 모델(단일 struct) + 팩토리 (leaf)
│   ├── collision.ts# 공간 해시 그리드 (탄×적 브로드페이즈, 결정론 순회)
│   ├── patterns/   # 적 패턴 컴포넌트 엔진 (이동×공격 조합, 데이터 주도)
│   ├── waves.ts    # 웨이브 디렉터 — 6구간 예산표 + 시드 카드 추첨(rng.fork('waves'))
│   ├── world.ts    # 60Hz 고정 타임스텝 상태 머신, InputFrame·WeaponStats, stepWorld
│   ├── replay.ts   # 입력로그 기록·재생 + FNV-1a 상태 해시(float64 비트 단위)
│   └── snapshot.ts # 렌더용 불변 스냅샷
├── render/         # PixiJS 계층 (시뮬 스냅샷 → 화면, 보간, 레터박스, 해저드/빔 오버레이)
├── input/          # 키보드·마우스 → InputFrame
├── ui/             # DOM HUD 오버레이
├── bench/          # ?bench=1 성능 씬
└── main.ts         # 고정 타임스텝 게임 루프
tests/              # vitest — 결정론·RNG·math·충돌·전투 테스트
data/               # 적·웨이브 데이터 정의 (enemies.ts, waves.ts)
assets/             # PixelLab 픽셀아트 스프라이트(기체·적4·보스·젬·이펙트) — Phase 4
supabase/
├── migrations/     # 원격 DB 스키마 (적용법은 위 "서버 배포")
└── functions/      # Edge Function — verify-invasion(배포 대상·src/sim 번들), verify-run(로컬 전용), modules(type-only)
```

## 코어 게임플레이 (Phase 2)

- **기체**: WASD 이동 + 마우스 조준, Space 대시(쿨다운 + 무적프레임), HP + 피격 무적프레임.
- **자동 공격**: 주무기 발칸이 최근접 적을 자동 조준·연사. 발사속도·탄속·데미지·탄수·관통·사거리는 `WorldState.weapon`(WeaponStats) — Phase 3 파워업이 이 객체를 증폭.
- **적 4종**(카르곤 역할 4슬롯, `data/enemies.ts`): 파쇄차(돌격·벽 충돌 시 파편탄) / 박격포(사수·착탄 예고 장판) / 용암샘(특수·용암 기둥 라인) / 수리드론(지원·아군 회복 빔).
- **웨이브**(`data/waves.ts`): 6구간 × 8카드 시드 추첨. 구간별 동시 적/탄 상한(적 12→44, 탄 300→2,000). 6구간은 보스 슬롯(보스 전투는 Phase 3).
- **탄막 가독성**: 적탄 = 화이트 코어 + 핫레드 아웃라인, 아군탄 = 화이트 코어 + 시안 아웃라인.

## 에셋 (Phase 4)

`assets/`의 스프라이트는 **PixelLab**(pixellab-forge)으로 생성한 탑다운 픽셀아트다. `src/render/textures.ts`의 `loadGameTextures`가 먼저 절차적 플레이스홀더 도형을 만든 뒤 실 PNG가 로드되면 해당 슬롯만 교체한다 — **로딩 실패 시 플레이스홀더로 우아하게 폴백**해 게임이 죽지 않는다. `import.meta.glob`로 `assets/*.png`를 정적 수집하므로, 존재하지 않는 PNG 슬롯은 자동으로 플레이스홀더를 유지한다.

- 실 스프라이트: `player`·`enemy_charger`·`enemy_mortar`·`enemy_lavaspring`·`enemy_support`·`boss`·`gem`·`fx_explosion`(64/128px)
- 절차적 유지: **탄막**(화이트 코어 + 아웃라인 가독성 규칙 — 텍스처화하면 규칙이 무너져 의도적으로 도형 유지), 보급선, 화산 배경 타일
- 픽셀아트는 `scaleMode:'nearest'` + 스테이지 정수 배율(안티앨리어싱 off). 스프라이트는 시뮬 히트박스 반경에 맞춰 스케일(`ART_SCALE=1.5`, 기체 48px).
- 에셋 교체는 **렌더 계층 한정** — 시뮬 해시에 영향 0(결정론 테스트 통과로 확인).

## 결정론 규율 (ADR-0005)

전투 로직은 클라이언트와 서버(Edge Function)에서 **비트 단위로 동일한 결과**를 내야 리플레이 검증이 성립한다. 따라서 시뮬 코어는:

- 시드 RNG만 사용 (`src/sim/rng.ts`). `Math.random` 금지.
- 시간은 틱 카운트뿐. `Date.now`·`performance.now` 금지.
- 초월함수(`Math.sin/cos/atan2`)는 엔진별 차이 위험 → `src/sim/math.ts`의 기본연산 근사만 사용.
- 렌더/입력/UI 계층에 의존 금지.

위 규율은 ESLint로 강제되며(`eslint.config.js`), 새 시뮬 코드는 결정론 해시 테스트를 통과해야 한다.
