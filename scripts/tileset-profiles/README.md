# 행성 타일셋 프로파일

`scripts/tileset-gen.mjs` 가 읽는 행성별 테마 데이터다. 파일 하나 = 행성 하나이고,
`--planet <name>` 은 `scripts/tileset-profiles/<name>.mjs` 를 그대로 찾는다.

```
node scripts/tileset-gen.mjs --planet kargon --dry-run          # 검사만(쓰기 없음)
node scripts/tileset-gen.mjs --planet kargon --out /tmp/x       # 자산을 덮지 않고 대조
node scripts/tileset-gen.mjs --planet niflheim                  # assets/tilesets/ 에 쓴다
```

**병렬 레인 규약**: 한 레인은 자기 행성 프로파일 1개 + `assets/tilesets/<planet>.*` 만 소유한다.
`tileset-gen.mjs`(메커니즘)는 공유 파일이므로 손대지 마라 — 색으로 못 푸는 문제를 만나면
메커니즘을 고치기 전에 그게 정말 메커니즘 문제인지부터 확인해라.

## 회귀 게이트

`kargon.mjs` 는 카르곤 4차(PR#192) 산출물을 **바이트 단위로** 재현한다. 메커니즘을 건드렸으면
반드시 이걸 먼저 통과시켜라:

```
node scripts/tileset-gen.mjs --planet kargon --out .tmp-gate
cmp .tmp-gate/kargon.png  assets/tilesets/kargon.png
cmp .tmp-gate/kargon.json assets/tilesets/kargon.json
```

## 새 행성 프로파일 쓰는 법

`kargon.mjs` 를 복사해 **수치만** 바꾼다. 단 카르곤 주석은 그 행성의 실측 회고이므로 같이
복사하지 마라 — 지우고 자기 행성 근거로 다시 쓴다.

프로파일이 불변식 I1~I4(정의는 `tileset-gen.mjs` 헤더)를 위반하면 생성기가 **에러로 막는다**.
막히면 문턱을 올리기 전에 아래 함정부터 보라.

### 함정 (전부 카르곤에서 실제로 밟았다)

1. **큰 스케일은 덩어리가 아니라 선으로 실어라.** 타일 절반 크기의 명암 얼룩을 넣으면
   변형·회전 교체가 그것을 타일 경계에서 잘라 64px 누비이불이 즉시 나온다(I4 가 잡는다).
   같은 크기라도 **얇고 대비 높은 선**은 반복이 안 보인다.
2. **밝기는 선 위에만.** 껍질 기준 명도(`upper.crustL`)를 올리는 것은 거의 항상 잘못된 처방이다.
   카르곤 3차는 "밝은 픽셀 L>150 이 2.1%" 로 스스로를 통과시켰지만 화면에서 지각 **전체**가
   중간 밝기로 읽혀 같은 색 계열 적이 위장됐다. **판정은 밝은 픽셀 수가 아니라 영역 평균이다.**
3. **정적 밴드(band 0)에는 스타일이 3종 이상 필요하다.** 둘이면 조용한 구역에서 64px 반복이
   눈에 잡힌다(생성기가 강제한다).
4. **흐름 방향(cellsX ≠ cellsY)은 밴드 단위로 통일해라.** 변형마다 방향이 다르면 어지럽다.
5. **밴드 간 대비는 휘도가 아니라 밀도로.** 껍질 평균 밝기는 밴드 정규화가 밴드 안에서
   고정하므로, 변형끼리 벌릴 수 있는 것은 균열·판 **밀도**뿐이다.
6. **팔레트 색상각은 그 행성의 적탄 색에서 역산한 안전 골짜기 안에 있어야 한다.**
   손으로 적은 각도는 적탄 색이 바뀌는 순간 갈라진다. 계획 문서
   (`.omc/plans/env-theme-multiplanet-2026-07-29.md`)의 골짜기 지도를 보라. 특히
   **니플헤임의 자연스러운 얼음 시안(≈195°)은 아군 신호색(194.2°)과 사실상 같은 각도**라
   그대로 쓰면 배경이 아군 표식으로 읽힌다 — 깊은 청보라(210~260°)로 밀어야 한다.
7. **`seedOffset` 은 그림을 통째로 바꾼다.** 행성끼리 구조까지 다르게 하고 싶을 때만 건드리고,
   한 번 정하면 고정해라(바꾸면 그 행성 자산이 전부 달라진다).
8. **`palette.lower.densCells` 는 진폭 변조 전용이다.** zero-mean 항에만 곱하므로 국소 평균을
   안 움직여서 다른 옥타브보다 성겨도 된다. 여기에 휘도를 **더하면** I4 위반이다.

### 사용 예시 — 니플헤임 (아직 만들지 마라, Phase 2 결정)

색은 Phase 2 에서 정한다. 골격만 보이자면:

```js
// scripts/tileset-profiles/niflheim.mjs  ← 예시, 실행하지 않았다
export default {
  planet: 'niflheim',
  name: 'niflheim — 오프라인 합성 Wang 타일셋',
  tile: 32, cols: 4, fillVariants: 7, seedOffset: 0x3100,
  normalise: 'multiplicative',
  silhouette: { amp: 0.84, octaves: [ /* 카르곤과 같은 3단 — 메커니즘이지 테마가 아니다 */ ] },
  palette: {
    // 하부 = 푸른 그림자 속 노출 암반. 상부 = 빙원.
    // ⚠️ 카르곤의 upper 는 "어두운 껍질 + 밝은 균열선" 이지만 눈은 **반대**다(밝은 면 +
    //    어두운 크레바스). 그래도 규율은 같다: 큰 스케일은 선(크레바스)이 지고, 면은
    //    평균으로만 밝다. `veinTarget` 을 밝은 색이 아니라 **어두운 청색**으로 두고
    //    `crustL` 을 올리는 방향이 그 뒤집기다 — 밝은 면은 I4 지표를 안 올린다.
    lower: { /* … */ },
    upper: { /* … */ },
    edge:  [ /* 경계 감쇠. 눈은 경계에서 어두워지는 게 아니라 그림자가 지므로 청색 쪽으로 */ ],
  },
  styles: [ /* band 0 ≥3종 / band 1 / band 2 — 배분 규칙은 카르곤과 동일 */ ],
};
```
