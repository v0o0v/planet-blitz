# 3D 모델 자산 (`assets/models/`)

런타임 3D 액터(`src/render/three3d/`)가 쓰는 glTF 바이너리(GLB). 게임 본체는 Pixi v8 2D
렌더러이고, 이 모델들은 **오프스크린 three.js 로 아틀라스에 그려져 Pixi 텍스처로 합성**된다
— 배선과 그 선택 근거는 `src/render/three3d/stage3d.ts` 헤더 주석이 정본이다.

## 목록

| 파일 | 용도 | 삼각형 | 크기 |
|---|---|---|---|
| `boss_kargon.glb` | 카르곤 보스(행성 0) | 8,288 | 582 KB |

## 보관 — 원장(`manifest.json`)이 자산보다 중요하다

Meshy 의 변형 도구는 전부 **로컬 파일이 아니라 서버의 task id** 를 입력으로 받는다. 그래서
"3D 모델을 보관한다"의 실체는 GLB 파일이 아니라 **`manifest.json` 에 적힌 task id** 다.
그것만 있으면 색 교체·애니메이션·폴리곤 재조정을 언제든 다시 할 수 있고, 잃으면 20 크레딧짜리
생성부터 다시 해야 한다. `tests/modelManifest.test.ts` 가 원장↔실물을 양방향으로 잠근다.

리포에는 **인게임용 경량본만** 커밋한다. 원본(수십 MB)은 Meshy 에 남아 있고
`meshy_download_model` 로 다시 받는다(`assets/models/_source/` 는 gitignore).

### 재사용 레시피

| 하고 싶은 것 | 호출 | 비용 |
|---|---|---|
| **색·재질만 변경** (행성별 보스 변형 등) | `meshy_retexture(input_task_id: <remesh>, ...)` | 10 |
| 폴리곤 재조정 | `meshy_remesh(input_task_id: <refine>, target_polycount: N)` | 5 |
| 포맷 변환 | `meshy_convert` | 1 |
| 원본 재다운로드 | `meshy_download_model(task_id: <refine\|remesh>)` | 0 |
| 스켈레톤 애니메이션 | `meshy_rig` → `meshy_animate` | 5 + 3/개 |

⚠️ 마지막 항목은 **요새형 보스에 부적합**하다 — 아래 "리깅을 쓰지 않는 이유" 참조.

## 생성 파이프라인 (Meshy → 인게임)

카르곤 보스 실제 이력. 총 35 크레딧 — 단, **다음부터는 30 크레딧이면 된다**(③이 불필요).

1. **프리뷰 메시** — `meshy_text_to_3d`, `ai_model: meshy-6`, `target_formats: ["glb"]` (20)
2. **텍스처** — `meshy_text_to_3d_refine`, `remove_lighting: true` (10)
3. ~~**감폴리** — `meshy_remesh`, `target_polycount: 8000`~~ (5) — ①에서 처리 가능, 아래 참조
4. **텍스처 축소(로컬)** — `node scripts/glb-prep.mjs <raw>.glb --out assets/models/boss_kargon.glb --color 256 --normal 128`

### ⚠️ 함정 2건 (실측)

**① 폴리곤 수는 생성 시 지정할 수 있다 — `should_remesh: true` 를 같이 넘겨야 한다.**
`target_polycount`(기본 30,000, 범위 100~300,000)는 **remesh 가 켜졌을 때만 적용**되는데
**meshy-6 는 `should_remesh` 기본값이 false** 다. 그것만 빠지면 지정값이 조용히 무시되고
실측 **1,016,472 삼각형 / 32.7 MB** 가 나온다 — 카르곤 보스가 실제로 그랬고, 그래서 `meshy_remesh`
5 크레딧을 따로 썼다. `model_type: 'lowpoly'` 는 이 인자들을 전부 무시하고, `decimation_mode`(1~4)
를 주면 `target_polycount` 가 무시된다.

**② 텍스처 해상도는 `2k` 가 하한이라 로컬 축소가 필수다.**
refine 의 `texture_resolution` 은 `2k`(기본)/`4k`/`8k` 뿐이고 그 아래가 없다. 게다가 **MCP 툴
스키마에는 `texture_resolution` 이 아예 없고** deprecated `hd_texture`(=4k)만 있어, MCP 경유로는
2k 가 최선이다. 리메시 후에도 2K PNG 두 장(베이스컬러 6.0 MB + 노멀맵 7.1 MB)이 남아 13.5 MB 였고,
`scripts/glb-prep.mjs` 가 이걸 줄인다(**12.91 MB → 0.55 MB, 95.7% 감소**).

축소 목표가 자산마다 다른 이유: 모델은 **160×160 아틀라스 슬롯**(`SLOT_SIZE`)에 렌더된다.
베이스컬러 256² 면 표시 해상도의 1.6배라 충분하고, 노멀맵은 그 크기에서 기여가 사실상 0 이라
128² 로 더 줄인다.

### 리깅을 쓰지 않는 이유

`meshy_rig` 는 휴머노이드 전제(t-pose, `height_meters` 기본 1.7)이고 커스텀 동작은 정수
`action_id` 로 고르는 **사전 정의 카탈로그**(dancing/jumping/fighting…)다. 보스는 용암 요새
메카라 스켈레톤이 의미가 없고, 필요한 연출(페이즈 전환·과열)은 애초에 그 카탈로그에 없다.
**Meshy 는 메시만 주고, 연출은 `bossActor.ts` 에서 트랜스폼 + 발광으로 저작한다.**

## 눈으로 확인하기

dev 서버에서 `/boss3d.html` — 페이즈 5종 연출을 나란히 실시간 재생하는 뷰어.
인게임 확인은 하네스(`?harness=1`) → 보스전 탭.
