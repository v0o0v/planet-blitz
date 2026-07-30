# 3D 모델 자산 (`assets/models/`)

런타임 3D 액터(`src/render/three3d/`)가 쓰는 glTF 바이너리(GLB). 게임 본체는 Pixi v8 2D
렌더러이고, 이 모델들은 **오프스크린 three.js 로 아틀라스에 그려져 Pixi 텍스처로 합성**된다
— 배선과 그 선택 근거는 `src/render/three3d/stage3d.ts` 헤더 주석이 정본이다.

## 목록

| 파일 | 용도 | 삼각형 | 크기 |
|---|---|---|---|
| `boss_kargon.glb` | 카르곤 보스(행성 0) | 8,288 | 582 KB |

## 생성 파이프라인 (Meshy → 인게임)

카르곤 보스 실제 이력. 총 35 크레딧.

1. **프리뷰 메시** — `meshy_text_to_3d`, `ai_model: meshy-6`, `target_formats: ["glb"]` (20 크레딧)
2. **텍스처** — `meshy_text_to_3d_refine`, `remove_lighting: true` (10 크레딧)
3. **감폴리** — `meshy_remesh`, `target_polycount: 8000`, `origin_at: center` (5 크레딧)
4. **텍스처 축소(로컬)** — `node scripts/glb-prep.mjs <raw>.glb --out assets/models/boss_kargon.glb --color 256 --normal 128`

### ⚠️ 함정 — 이 순서를 지키지 않으면 웹에 못 싣는다

- **`meshy_text_to_3d` 의 `target_polycount` 는 meshy-6 에서 무시된다.** 그 모델은
  `should_remesh` 기본값이 false 라서다. 지정해도 조용히 무시되고 실측 **1,016,472 삼각형 /
  32.7 MB** 가 나왔다. 폴리곤 감축은 **`meshy_remesh` 를 따로 태워야** 한다.
- **텍스처 해상도는 API 옵션이 아예 없다.** 리메시 후에도 2K PNG 두 장(베이스컬러 6.0 MB +
  노멀맵 7.1 MB)이 남아 13.5 MB 였다. `scripts/glb-prep.mjs` 가 이걸 로컬에서 줄인다
  (**12.91 MB → 0.55 MB, 95.7% 감소**).
- 축소 목표가 다른 이유: 모델은 **160×160 아틀라스 슬롯**(`SLOT_SIZE`)에 렌더된다. 베이스컬러
  256² 면 표시 해상도의 1.6배라 충분하고, 노멀맵은 그 크기에서 기여가 사실상 0 이라 128² 로
  더 줄인다.

### 리깅을 쓰지 않는 이유

`meshy_rig` 는 휴머노이드 전제(t-pose, `height_meters` 기본 1.7)이고 커스텀 동작은 정수
`action_id` 로 고르는 **사전 정의 카탈로그**(dancing/jumping/fighting…)다. 보스는 용암 요새
메카라 스켈레톤이 의미가 없고, 필요한 연출(페이즈 전환·과열)은 애초에 그 카탈로그에 없다.
**Meshy 는 메시만 주고, 연출은 `bossActor.ts` 에서 트랜스폼 + 발광으로 저작한다.**

## 눈으로 확인하기

dev 서버에서 `/boss3d.html` — 페이즈 5종 연출을 나란히 실시간 재생하는 뷰어.
인게임 확인은 하네스(`?harness=1`) → 보스전 탭.
