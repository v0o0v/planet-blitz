# 스파이크: 단일 맵 이미지 배경 (PixelLab) — 아트 판단용

## 목적

현재 아레나 배경은 PixelLab로 만든 16타일 Wang 오토타일셋(`assets/tilesets/<planet>.*`)을 무한 스크롤로 반복 렌더한다. 이 결과가 "의미 없는 무늬(벽지처럼 균일)"로 느껴진다는 피드백에 따라, **PixelLab 단일 맵 이미지 1장**을 대안으로 만들어 현재 배경과 나란히 놓고 어느 쪽이 더 나은지 **눈으로만 판단**한다.

## 범위 (throwaway)

- **행성**: 카르곤(첫 행성 — 첫인상 개선 효과 최대).
- **산출**: PixelLab 단일 맵 이미지 1장.
- **비교 방식**: 현재 Wang 타일 배경 vs 단일 맵 이미지를 나란히 표시(하네스/로컬 웹서버 브라우저 탭). 아트만 판단.
- **명시적 비범위**: 무한 스크롤 렌더러 통합, wrap·이음매 처리는 하지 않는다 — 채택되면 별도 작업으로 다룬다.

## 핵심 긴장 (판단 시 유념)

- 월드가 청크 기반 **무한 스크롤**이라 단일 유한 이미지는 결국 반복·이음매가 필요하다. 이 스파이크는 그 문제를 **의도적으로 미룬다** — "그림 자체가 더 나은가"만 본다.
- 채택 판단 후보 결과: ①단일 이미지가 확연히 낫다 → 무한 스크롤 통합 방법(대형 타일 wrap 등) 별도 설계 / ②차이 미미 → 현재 타일셋을 더 나은 프롬프트로 재생성 / ③맵 오브젝트(분화구·잔해)를 얹어 '의미'를 주는 3안으로 선회.

## 실행 메모

- PixelLab 생성분은 전역 규칙대로 캐시 add 후 `D:\ClaudeCowork\pixellab-forge` 리포 동기화.
- 결과 이미지는 로컬 웹서버 → 사용자 기본 브라우저 탭으로 보여준다(전역 규칙).

## 실행 결과 (Lane 4, 2026-07-17)

### 생성
- **도구**: `create_map_object` (basic 모드, 400×400 — 기본 모드 상한. inpainting 모드는 192px 상한이라 미채택).
- **object_id**: `aa6fddbb-c8b7-4063-a4d1-419921ac7af9` (PixelLab 측 8시간 후 자동 삭제 — 로컬 PNG로 이미 확보).
- **프롬프트**: `top-down volcanic planet terrain map of Kargon: dark desaturated basalt and cooled black lava rock field with glowing orange-red molten lava cracks and fissures, scattered craters, jagged rocky outcrops, ash patches, cohesive game arena battlefield ground`
- **스타일 옵션**: view=high top-down, detail=high, shading=detailed, outline=selective. (kargon 타일셋 팔레트 — 어두운 basalt + 둔한 오렌지 균열 — 참조.)
- **캐시 재사용 여부**: 재사용 불가 → 신규 생성. 캐시 조회 최고 score 0.33(`pb_enemy_charger_ram` 등) < 재사용 임계 0.6. 기존 `pb_tileset_kargon`(0.28)은 타일셋이라 단일 맵 용도로 부적합.

### 비용
- 잔액 전: credits **$8.56** / 구독 생성분 0 remaining (45/40 소진 — trial).
- 잔액 후: credits **$8.55**. → 맵 1장 생성에 **약 $0.01 크레딧** 차감(구독 생성분 소진 상태라 크레딧으로).

### 산출 파일
- 단일 맵 이미지: `C:\Users\v0o0v\AppData\Local\Temp\haru-shots\bg-compare\kargon-single-map.png` (400×400, 116,974 bytes).
- 비교 페이지: `C:\Users\v0o0v\AppData\Local\Temp\haru-shots\bg-compare\index.html`
  - 좌: 현재 게임의 실제 Wang 오토타일 렌더를 `src/render/autotile.ts`의 `upperAt`/`cornerKey` 알고리즘 그대로 JS 포팅해 캔버스에 재현(32px→64px nearest, seed 재배치 버튼 포함).
  - 우: 생성된 단일 맵 이미지.
  - 동봉: `kargon-tileset.png`, `kargon-tileset.json`(좌측 렌더 소스). http 서버로 서빙해야 `fetch` 동작(리드가 서빙).
- 캐시 등록: `pb_map_kargon_arena` (scope global, 라이브러리 총 409개). 리포 동기화는 리드가 처리.

### 관찰 (아트 판단 참고, 결정 아님)
- 생성물은 "구성된 아레나" 형태 — 중앙 용암 노드에서 방사되는 균열, 암석 경계 프레임, 코너 용암 분출구. 현재 Wang 타일의 균일 반복("벽지") 대비 시선 중심·의미가 뚜렷.
- 단, 유한 1장이라 **무한 스크롤 통합 시 wrap/이음매/경계 프레임 반복 문제**가 남음(스파이크 비범위). 채택 시 별도 설계 필요.
