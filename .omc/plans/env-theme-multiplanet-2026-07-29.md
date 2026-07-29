# 행성 환경 테마 확산 레인 (2026-07-29)

카르곤 AAA 배경(PR#192, main `bea9f32`)을 **나머지 5행성 + 침공 3레이어**로 확산한다.
정본 회고는 `.omc/research/kargon-aaa-backdrop-2026-07-29.md` — 이 문서는 그 위에 올린 실행 계획이다.

## 왜 확산이 성립하는가 (인벤토리 실측)

레이어 5장의 `KARGON` 판정은 **각 파일 `configure()` 단 1곳씩**이다(총 5곳, 전부 순환 import
회피용 지역 복제). 메커니즘은 이미 행성 무관이다:

| 레이어 | KARGON 판정 | 테마 데이터 비율 | 비고 |
|---|---|---|---|
| `kargonParallax` | 721줄 1곳 | 순수함수 14개가 이미 `bands`/`base` 를 인자로 받는다 | 기본 인자만 떼면 됨 |
| `kargonDecals` | 1893줄 1곳 | **카르곤 전용 기하 0종** — 12 kind 전부 순수 기하 프리미티브 | 결합점은 `drawDecalInto` 안의 `FILL.*` 직접 참조 |
| `kargonLavaLight` | 1107줄 1곳 | 용암 전제가 박힌 곳은 3군데뿐(열기 기둥 상승 기하·광원 방향·폭↔세기 서사) | 마칭 스퀘어즈는 완전 무관 |
| `kargonAtmosphere` | 759줄 1곳 | `FieldSpec` 19필드 중 17개가 테마 데이터 | 링 알파 역산은 **이미 프로파일 주도** |
| `kargonGrade` | 439줄 1곳 | 아핀 M/A 가 `toneMap` 에 순수 모델로 존재 | `bakeGradient` 는 이미 프로파일 인자를 받는다 |

**실제 비용은 화면 배선이 아니라 테스트 재작성이다.** 프로덕션 소비자는 레지스트리 1곳
(클래스 5개)뿐이고, export 표면 130여 개는 전부 테스트 계약이다.

## 이 레인의 단일 최대 위험: 관계 불변식

인벤토리가 찾아낸 것 중 **값이 아니라 값 사이의 관계**로만 존재하는 불변식들이다. 6개 레인이
각자 재발견하게 두면 카르곤이 4라운드에 걸쳐 밟은 함정을 6번 반복한다. 그래서 테마 계약은
`validateTheme(theme): Violation[]` 를 **함께** 제공하고, 전 테마에 대해 도는 테스트와 DEV
`configure()` 가 그것을 강제한다.

| 불변식 | 근거 | 깨지면 |
|---|---|---|
| `aoOffset > coreWidth/2` | AO 띠가 코어를 먹으면 안 됨 | 코어 소실 |
| `rimOffset < -coreWidth/2` | 림이 코어 밖으로 | 림이 안 보임 |
| `shadowOffset ≫ aoOffset` | 층 분리 | AO·섀도 뭉침 |
| `aoWidth ≪ glowWidth` | 진부분집합 금지 | **3차 실패 재현** |
| 데칼 셀 크기가 `DISPLAY_TILE` 및 서로끼리 서로소 | 공명 금지 | 격자 재발 |
| `relief r × elong ≈ span 대역에서 파생` | `RELIEF_MIN/MAX_SPAN` ÷ `RELIEF_WOBBLE` 산술 | 부조 크기 붕괴 |
| 그레이딩 알파 6개가 `edgeMaxDarkening`·`centerMinRetention` 공동 예산 배분 | `darkeningBound` | 가독성 캡 위반 |
| 대기 필드 `key` 유일 | 해시 도메인 분리 | 두 필드가 **정확히 겹쳐** 그려짐 |
| `emberMin` 의 하한 | "완전히 꺼진 경계 없음" | **3차 실패 재현**(경계 6할이 검음) |
| 팔레트 색상각 ∈ 안전창 | 적탄과 혼동 금지 | 위장 |

### 안전 색상 골짜기 지도 (계산 결과, `computeSafeHueWindows(FOREGROUND_SIGNAL_COLORS, 10)`)

위험색 6종: hot-red 355.4° · 앰버 28.5° · 옐로 50.9° · 아군 시안 194.2° · 퍼플 270.2° · 마젠타 315.0°

| 골짜기 | 폭 | 배정 |
|---|---|---|
| 5.4° → 18.5° | 13.1° | **카르곤**(사용 중, 손으로 얻은 `[10, 18.4]` 가 여기 들어간다) |
| 38.5° → 40.9° | 2.4° | (사실상 사용 불가) |
| 60.9° → 184.2° | 123.4° | **베르단** 산성 황록 — 여유 큼 |
| 204.2° → 260.2° | 55.9° | **니플헤임** |
| 280.2° → 305.0° | 24.8° | **톡사르** |
| 325.0° → 345.4° | 20.4° | **크라스** |

⚠️ **레인 시작 전에 알아야 할 충돌 2건** — 모르고 시작하면 각 레인이 3라운드 뒤에 발견한다:
- **니플헤임의 자연스러운 얼음 시안(≈195°)은 아군 신호색(194.2°)과 사실상 같은 각도다.**
  쓰면 배경이 아군 표식으로 읽힌다. 깊은 청보라(210~260°)로 이동해야 하며, 이건 튜닝이 아니라
  팔레트 설계 결정이다.
- **아르케의 금갈색은 앰버 적탄과 옐로 적탄 사이 2.4° 슬롯에 끼인다.** 색상각으로 분리할 수
  없으므로 아르케의 정체성은 **색상이 아니라 명도·질감·기하**(유적의 직선·석재 결)로 세워야 한다.

### 파생값을 테마 필드로 만들지 마라
- **색상 안전창은 `FOREGROUND_SIGNAL_COLORS` 의 함수다.** 카르곤의 `[10°, 18.4°]` 는 두 적탄
  색에서 역산된 값이지 입력이 아니다. `computeSafeHueWindows(hostileColors, gap)` 로 **계산**하고
  테마 팔레트를 그 창에 대해 **검증**한다. 행성마다 적탄 색이 다르므로 손으로 다시 적는 순간
  다시 갈라진다. 톡사르(자홍 적탄)는 안전 골짜기가 여러 개라 **구간 리스트**를 반환해야 한다.
- `LAVA_PALETTE`(= GLOW+CORE+HEAT+RIM), `TERRAIN_PIXEL`, `ALL_KINDS`, 그레이딩 휘도 손실 3종,
  `EMBER_*` 별칭 — 전부 계산 결과다.

### 알파는 곱하지 말고 치환해라
현재 사슬이 `cap × strength × pulse × tierScale × gateScale` 다. 이 레이어의 존재 이유가
"보수적 상한을 곱해 실효 0.05 가 됐다"(1차 실패)이므로, 흔한 설계인 `themeIntensity` 전역
배율을 여기 곱하면 **1차 실패가 그대로 재현된다.** 테마는 `cap` 자체를 치환한다.

### 배경 기준색을 테마와 함께 옮겨라
`REFERENCE_BACKDROP`(대기 625줄, 카르곤 암반 `0x2a2422`)은 기여도 모델의 기준이다. 눈 행성에서
이걸 안 옮기면 흰 눈의 `fieldDeltaRgbSum` 이 0 이 되어 **1차 화산재 결함이 색만 뒤집혀 재현된다.**

## 리팩터가 반드시 함께 고쳐야 하는 캐시·수명 결함

| 위치 | 현재 | 문제 | 처방 |
|---|---|---|---|
| 시차 `TEXTURE_CACHE` | 키가 `spec.key` 뿐 | 두 테마가 같은 key 를 다른 색으로 쓰면 **먼저 구운 텍스처가 조용히 재사용**된다 | 키에 테마 id 포함 |
| 시차 `built` 플래그 | 영구 boolean | 행성 전환 시 두 번째 `build()` 가 즉시 return → **첫 테마 스프라이트가 그대로 남는다**. `bands` 는 push-only 라 누적도 된다 | `builtThemeId` + teardown |
| 대기 `TextureKind` | `'dot'\|'puff'` 닫힌 열거형 3곳 동시 수정 필요 | 눈송이·포자 프로파일 추가 불가 | 테마가 `profile: (t)=>number` 를 직접 들고 오고 캐시는 `Map<string, Texture>` |
| 그레이딩 프로파일 3종 | 모듈 상수를 클로저로 직접 읽음 | 테마 형상 주입 불가 | `makeVignetteProfile(shape)` 팩토리 (`bakeGradient` 는 이미 인자를 받는다) |

## 광원은 두 레이어가 같은 소스를 읽어야 한다
`kargonDecals.LIGHT_ANGLE` 과 `kargonLavaLight.TO_LIGHT_Y` 가 같은 물리("광원이 지형 저지에
있다")를 각각 구현하고 있고 `tests/kargonLightAgreement.test.ts` 가 코사인 유사도로 합의를
잠근다. **한쪽만 테마로 옮기면 화면에 태양이 둘이 된다.** 두 레이어가 같은 테마 필드를 읽게 한다.

## 문서 부패 3건 (리팩터 중 함께 정정)
- `kargonLavaLight` 헤더 15·648·1417줄이 "0.5 등고선"이라 적었으나 실제 임계는 **0.57**.
- 같은 파일 37~40줄이 "autotile 이 아직 export 하지 않아 값을 복제했다"는 **이미 해소된 상태**를 서술.
- `autotile.ts:154` 가 `CRACK_BAND` 를 `kargonLavaLight` 것으로 오기(실제로는 `kargonDecals`).

1657줄 중 절대다수가 "왜 이렇게 됐는가" 회고 주석이다. **그대로 옮기면 카르곤 4차 회고가
니플헤임 파일에 붙는다** — 메커니즘 파일에는 메커니즘 근거만, 테마 파일에는 그 행성 실측만 남긴다.

---

# 침공 지형 도입 — 구조적 장애물과 설계

사용자 결정: L1/L2/L3 각각에 전용 타일셋을 만들고 autotile 을 켠다.

## sim 리스크는 0 이다 (확인 완료)
`upperAt`/`terrainFieldAt` 소비자는 `src/render/` 와 테스트뿐이고 `src/sim/` 참조가 0건이다.
침공 벽·충돌은 `src/sim/invasion/movingWall.ts`·`wallIndex.ts` 로 완전히 별개다.
**침공 해시·리플레이·EF·골든은 바이트 불변이다.**

## 진짜 장애물은 stage 깊이다
현재 순서(main.ts 209~219):
```
background(flat) → invasionBackdrop.view → env.slot('far') → autotile.layer → env.slot('floor') → 엔티티 → over → post
```
`autotile.layer` 가 `invasionBackdrop.view` **위**에 있고 Wang 타일은 알파 255 불투명이다.
그대로 켜면 "지형 추가"가 아니라 **"침공 배경 3종 + 45틱 크로스페이드 삭제"** 가 된다.
main.ts 206~208 주석이 "침공은 autotile 을 끄니까 순서 다툼이 없다"를 전제로 이 깊이를 잡았다.

### 처방: `invasionBackdrop` 을 배경에서 **페이즈 전환 베일**로 재정의
- 페이즈별 Wang 타일셋을 autotile 에 `configure` 한다(L1/L2/L3).
- `invasionBackdrop.view` 를 autotile **위**로 올리고, 평상시 알파 0, 페이즈 전환 45틱 동안만
  띄워 타일셋 스왑의 하드 컷을 가린다.
- `backdropCrossfadeAlpha`·`invasionBackdropTexture`·`INVASION_BACKDROP_INDEX` 를 **그대로 재사용**
  하므로 `tests/invasionRender.test.ts` 계약이 살아남고, `tests/renderWiring.test.ts:77` 의
  "main.ts 가 invasionBackdrop 을 import 한다" 검사도 통과한다.

### 변경 지점 (실측 확인 완료)
`startInvasionRun`(정식) 과 `startHarnessInvasionRun`(하네스) 두 곳에서 **연속한 3줄**이 전부다:

```ts
beginInvasionBackdrop(PHASE_L1, 0);
autotile.configure(null, seed);   // → 페이즈별 침공 타일셋
env.disable();                    // → env.configure({ planet: <침공 테마>, seed, renderer })
```

여기에 stage 깊이 재배치 1건(`invasionBackdrop.view` 를 `autotile.layer` **위**로)이 더해진다.
main.ts 205~208 주석이 현재 깊이의 근거를 명시적으로 적어 두었다 — *"침공은 `autotile.configure(null, …)`
로 Wang 바닥을 끄므로 순서 다툼이 없고"*. **그 전제를 깨는 변경이므로 주석도 함께 고쳐야 한다.**

부수로 `background.visible` 규칙이 PvE(`!autotile.active`, 1235줄)와 침공(`false` 고정, 863줄)에서
갈려 있다 — 통일한다.

## 성능은 실측 대상이다 (메모리 누수는 없음)
- `ensureCoverage` 는 뷰포트 크기에만 반응하고 카메라 위치와 무관하다. 스프라이트 풀 상한이
  있고 텍스처는 미리 로드된 서브텍스처 재사용 → 전진해도 신규 할당 0. **누수 없음.**
- 비용은 재타일 빈도다. 강제 스크롤 12~24 u/tick(720~1440 u/s) → 카메라 64유닛마다 풀 재타일
  = **초당 11~23회 × 714셀**. 여기에 마칭 스퀘어즈·데칼 풀이 얹힌다.
- **FPS 가 아니라 `sim 틱 / 벽시계 초` 로 잰다.**

## 타일셋 현황
6행성 전부 `.png`+`.json` 이 이미 있다. 단 **카르곤만 2026-07-29 갱신본**(57KB, 4×8 시트,
`fill_variants` 14장 + `base_band`)이고 나머지 5종은 07-28 자 10~24KB **구형**(밴드·변형 미선언 →
3밴드에 같은 풀을 복제하는 하위호환 경로). 즉 5행성은 타일셋 재생성이 실질 작업이다.

### 생성기 파라미터화 (`kargon-tileset-gen.mjs`)
뽑아야 할 것: ①출력 경로/행성명(현재 `D:/ClaudeCowork/shooting` 절대경로 하드코딩 — **다른
워크트리를 가리킨다**) ②`lowerColour`/`upperColour` 의 인라인 수치를 팔레트 객체로 ③`STYLES` 8종과
밴드 배분.

**절대 파라미터화하면 안 되는 불변식 4개**(하나만 깨도 64px 격자·누비이불 즉시 재발):
`SIL_AMP < 1` · 실루엣 노이즈 공유와 180° 대칭 · 밴드별 **곱연산** 정규화(가산 아님) ·
타일보다 큰 저주파 휘도 금지.

⚠️ 생성기의 마스크 임계 `0.5` 는 `autotile.UPPER_THRESHOLD = 0.57` 과 **다른 층**이다
(전자는 타일 내부 실루엣, 후자는 월드 코너 분류). 혼동하면 커버리지가 어긋난다.

---

# 실행 단계

## Phase 0 — 회귀 방어선 (선행 필수) ✅ 도구 완성
- `scripts/env-verify/shot-server.mjs` — 페이지가 캡처한 PNG 를 받아 디스크에 쓴다(data URL 을
  반환값으로 실어 나르면 컨텍스트가 터진다). PNG 매직 검사로 빈 캡처의 조용한 통과를 막는다.
- `scripts/env-verify/page-capture.js` — 캡처 규율(품질 티어 고정 → 포그라운드 확인 →
  캔버스 합성 결과 → POST)을 코드로 강제.
- `scripts/env-verify/analyze.mjs` — `tone`/`grid`/`camo`/`delta`/`regress`/`report`.
  지표 함정(정규화·위상 표본 불균등·외곽선 대표색·평균이 못 재는 랜드마크)을 구현으로 봉인.
- `__pb.graphicsSettings` 노출(DEV) — 티어 고정 수단이 페이지에 없었다.
- **게이트: 카르곤 다시드 기준선 촬영 → Phase 1 후 재촬영 → `regress` 통과.**

## Phase 1 — 테마 추출 리팩터 (직렬 1레인)
`theme.ts`(계약 + `validateTheme` + `computeSafeHueWindows`) · `themes/kargon.ts` · 레이어 5장
주입식 전환 · 클래스/레이어명에서 `kargon` 제거 · 생성기 파라미터화 · `envWiring.test.ts` 갱신
(현재 "레지스트리 레이어 수 = `src/render/env/` 모듈 수"를 잠그므로 `themes/` 하위 디렉터리
추가 시 단언 조정 필요).
**게이트: 카르곤 픽셀 회귀 0 + 뮤테이션 검증**(레이어를 레지스트리에서 지웠을 때 테스트가 실제로 빨개지는가).

## Phase 2 — 병렬 6레인 ✅ **완료** (main `f5cd43e`)

> 결과와 회고는 `.omc/research/env-theme-phase2-2026-07-29.md`. 아래는 착수 시점의 계획이다.
> 실제 진행에서 바뀐 것: ①`ENV_THEMES` 등록을 **선행 스캐폴딩 커밋**(PR#194)으로 빼 6레인
> 충돌을 구조적으로 0 으로 만들었다 ②각 레인에 요구한 **뮤테이션 검증이 계약의 구멍 3개를
> 찾아냈고** 별도 봉인 PR(#202)로 잠갔다 ③엔티티 접지 그림자도 같은 사이클에서 마쳤다(PR#201).

각 에이전트가 **파일 2개만** 소유: `themes/<planet>.ts` + `assets/tilesets/<planet>.*`.
충돌이 구조적으로 불가능하다. 침공 레인만 배선(stage 깊이)을 건드리므로 **직렬로 분리**한다.
각 레인에 "테마 뼈대 + 스크린샷 1장" 조기 체크포인트.

행성 정체성: 베르단=산성 습지 · 니플헤임=빙원 · 아르케=유적 · 톡사르=오염 늪 · 크라스=파괴 폐허.
침공: L1 대기권 → L2 회랑 → L3 코어방.

## Phase 3 — 측정 + 비평 (직렬 브라우저)
브라우저 인스턴스가 하나라 **병렬 에이전트에게 브라우저 도구를 주지 않는다.**
구현은 병렬, 시각 검증은 직렬.

## 함께 판단한 잔여
- **엔티티 접지 그림자 — 포함한다.** 카르곤 비평가 지적 6번. 탑다운에서 공간감을 만드는 유일한
  수단이라 효율이 좋고, 전 행성을 건드리는 이번 작업과 범위가 정확히 겹친다. 단 `entityRenderer`
  는 공유 파일이라 **병렬 레인이 아니라 별도 직렬 단계**로 둔다.
- 카르곤 지각 균열망 반복 · 타일 원본 32px 상한 — 이번 범위 밖(카르곤 4차에서 크게 줄었고,
  후자는 PixelLab `pro` 64px 실패가 원인이라 별도 조사가 필요하다).
