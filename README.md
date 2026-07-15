# Planet Blitz

CrazyGames 출시용 탑다운 탄막 슈팅 × 디아블로2 파밍 × 비동기 PvP 웹게임. 기획은 [docs/GDD.md](docs/GDD.md), 용어는 [CONTEXT.md](CONTEXT.md), 되돌리기 어려운 결정은 [docs/adr/](docs/adr/)를 따른다.

현재 상태: **M1 전투 프로토타입 — Phase 0·1 완료** (결정론 시뮬 코어 + 렌더 어댑터 + 벤치 씬). 진행 계획은 [.omc/plans/planet-blitz-m1-plan.md](.omc/plans/planet-blitz-m1-plan.md).

## 실행

의존성 설치:

```
npm install
```

개발 서버 (포트 5180):

```
npm run dev
```

- 게임: `http://localhost:5180` — WASD/방향키 이동, 마우스 조준, Space 대시
- 성능 벤치: `http://localhost:5180/?bench=1` — 탄 2,000발 + 더미 적 200, FPS 표시
- 시드 지정: `http://localhost:5180/?seed=1234`

## 검증

```
npm run test
```

```
npm run lint
```

```
npm run build
```

- `test`: vitest — 결정론 해시 테스트(동일 시드+입력로그 2회 실행 시 틱별 상태 해시 100% 일치) 등
- `lint`: ESLint — `src/sim/**`에서 `pixi.js` import·`Math.random`·`Date.now`·`performance.now` 사용을 에러로 차단 (ADR-0005)
- `build`: `tsc --noEmit`(strict) + `vite build`

## 프로젝트 구조

```
src/
├── sim/            # 결정론 시뮬 코어 (플랫폼 독립, PixiJS/DOM import 금지 — lint 강제)
│   ├── math.ts     # 초월함수 격리 — sin/cos/atan2 기본연산 근사(IEEE-754 결정론)
│   ├── rng.ts      # 시드 RNG(mulberry32) + 스트림 분리(fork)
│   ├── world.ts    # 60Hz 고정 타임스텝 상태 머신, InputFrame 포맷, stepWorld
│   ├── replay.ts   # 입력로그 기록·재생 + FNV-1a 상태 해시(float64 비트 단위)
│   └── snapshot.ts # 렌더용 불변 스냅샷
├── render/         # PixiJS 계층 (시뮬 스냅샷 → 화면, 보간, 레터박스)
├── input/          # 키보드·마우스 → InputFrame
├── ui/             # DOM HUD 오버레이
├── bench/          # ?bench=1 성능 씬
└── main.ts         # 고정 타임스텝 게임 루프
tests/              # vitest — 결정론·RNG·math 테스트
assets/  data/      # 에셋·데이터 정의 (Phase 2+)
```

## 결정론 규율 (ADR-0005)

전투 로직은 클라이언트와 서버(Edge Function)에서 **비트 단위로 동일한 결과**를 내야 리플레이 검증이 성립한다. 따라서 시뮬 코어는:

- 시드 RNG만 사용 (`src/sim/rng.ts`). `Math.random` 금지.
- 시간은 틱 카운트뿐. `Date.now`·`performance.now` 금지.
- 초월함수(`Math.sin/cos/atan2`)는 엔진별 차이 위험 → `src/sim/math.ts`의 기본연산 근사만 사용.
- 렌더/입력/UI 계층에 의존 금지.

위 규율은 ESLint로 강제되며(`eslint.config.js`), 새 시뮬 코드는 결정론 해시 테스트를 통과해야 한다.
