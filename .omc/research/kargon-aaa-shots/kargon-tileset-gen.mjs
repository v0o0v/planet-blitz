#!/usr/bin/env node
/**
 * 카르곤 Wang 타일시트 오프라인 합성 (4차).
 *
 * 3차까지: 실루엣·내부 전부 자체 합성. 마스크 = 코너 이중선형 + **타일 주기·180° 대칭** 노이즈
 * (공유+대칭이라 16장 변 정합이 정확하고 rot180 변형이 합법), 내부 = 래핑 Worley 판 구조.
 *
 * 4차는 비평 3건 + 가독성 1건을 겨눈다:
 *  ① **지각이 밝다** — 3차는 "밝은 픽셀 L>150 이 2.1%"로 스스로를 통과시켰지만 껍질 **평균**이
 *    L 70(현무암 21)이라 영역 전체가 중간 밝기 주황으로 읽혔고, 주황 계열인 카르곤 적이 그
 *    위에서 위장됐다. 껍질 기준 명도 60→36 으로 낮추고 주황은 균열선에만 남겼다(→ L 32).
 *    **판정은 밝은 픽셀 수가 아니라 영역 평균으로 해야 한다.**
 *  ② **균열망이 화면 전면·단일 스케일** — 셀 크기를 2~9셀(지름 9~32px, 3.7배)로 벌리고,
 *    균열을 거의 안 그리는 **슬래브** 변형을 넣어 정적(negative space)을 만들었다. 판은
 *    x·y 셀 수를 달리해 **흐른 방향으로** 늘어난다.
 *  ③ **암부가 균일 고주파 노이즈** — 부스러기 진폭을 자리마다 변조해 거칠기에 밀도 변화를 줬다
 *    (진폭만 건드리므로 평균 휘도는 안 움직인다 = 누비이불 하드 룰 유지).
 *
 * 4차에서 배운 두 함정:
 *  - 밀도를 벌리면 **평균 밝기도** 벌어진다(vein·fissure 가 zero-mean 이 아니라서). 그 평균차는
 *    타일마다 다른 변형이 깔리는 순간 64px 격자가 된다 → 굽는 타일마다 영역 평균을 밴드 기준에
 *    맞추는 곱연산 정규화가 필수.
 *  - 변형을 **셀 단위 독립 해시**로 고르면 슬래브 한 장이 정확한 64px 정사각형으로 읽힌다.
 *    그래서 `autotile.ts` 가 저주파 밴드 필드로 등급을 고르고 그 안에서만 변형을 뽑는다.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from 'file:///D:/ClaudeCowork/shooting/scripts/lib/png.mjs';

const T = 32; // 소스 타일 한 변(px)
const COLS = 4;
const FILL_VARIANTS = 7; // key 0 / key 15 각각의 추가 변형 수
const ROWS = 4 + Math.ceil((FILL_VARIANTS * 2) / COLS);
const W = COLS * T;
const H = ROWS * T;

/* ---------- 순수 해시·노이즈 ---------- */
function hash2(seed, x, y) {
  let h = (seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 0x100000000;
}
const fade = (t) => t * t * (3 - 2 * t);

/**
 * 타일 주기(u,v∈[0,1) 에서 wrap) 값 노이즈.
 * `sym` 이면 격자 노드 (i,j) 와 (C-i, C-j) 를 같은 값으로 접어 N(u,v)=N(1-u,1-v) 를 만든다.
 * → 타일을 180° 돌려 그려도 변 위 픽셀이 그대로라 Wang 인접이 깨지지 않는다.
 */
function pnoise(seed, cells, u, v, sym) {
  const fx = u * cells;
  const fy = v * cells;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tu = fade(fx - x0);
  const tv = fade(fy - y0);
  const g = (i, j) => {
    let a = ((i % cells) + cells) % cells;
    let b = ((j % cells) + cells) % cells;
    if (sym) {
      const a2 = (cells - a) % cells;
      const b2 = (cells - b) % cells;
      if (a2 < a || (a2 === a && b2 < b)) {
        a = a2;
        b = b2;
      }
    }
    return hash2(seed, a, b);
  };
  const a = g(x0, y0);
  const b = g(x0 + 1, y0);
  const c = g(x0, y0 + 1);
  const d = g(x0 + 1, y0 + 1);
  return (a * (1 - tu) + b * tu) * (1 - tv) + (c * (1 - tu) + d * tu) * tv;
}

/**
 * 래핑 Worley: 반환 = {edge: 두 번째-첫 번째 거리차, id: 소속 셀 해시, dyFromCentre}.
 *
 * x·y 셀 수를 따로 받는다(4차). 같게 두면 등방성 벌집이 나오는데, 비평이 지적한 "흐름 방향이
 * 없다"가 정확히 그것이다 — 실제 용암 지각의 판은 흐른 방향으로 늘어난다. `cellsY < cellsX`
 * 면 셀이 세로로 길어지고, 그 비를 **밴드 단위로** 고정하면 한 구역 전체가 같은 방향으로
 * 흐르는 것처럼 읽힌다(변형마다 방향이 다르면 그냥 어지럽다).
 */
function worley(seed, cellsX, cellsY, u, v) {
  const fx = u * cellsX;
  const fy = v * cellsY;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  let d1 = 1e9;
  let d2 = 1e9;
  let id = 0;
  let fpy = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const gx = ix + i;
      const gy = iy + j;
      const wx = ((gx % cellsX) + cellsX) % cellsX;
      const wy = ((gy % cellsY) + cellsY) % cellsY;
      const px = gx + hash2(seed, wx, wy);
      const py = gy + hash2(seed ^ 0x9e3779b9, wx, wy);
      const dx = px - fx;
      const dy = py - fy;
      const d = Math.hypot(dx, dy);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = hash2(seed ^ 0x85ebca6b, wx, wy);
        fpy = py;
      } else if (d < d2) d2 = d;
    }
  }
  return { edge: d2 - d1, id, dyFromCentre: fy - fpy };
}

/* ---------- 마스크(실루엣) ---------- */
/**
 * 실루엣 노이즈. **모든 타일이 공유**하고 **180° 대칭**이라야 한다:
 * 공유 → 이웃 타일의 맞닿는 변에서 같은 값 → 노치 없음.
 * 대칭 → rot180 변형이 여전히 합법.
 * 스케일 3단(4·8·16 셀). 4셀 성분이 큰 손가락(≈8px)을, 16셀이 픽셀 단위 톱니를 만든다.
 */
function silhouetteNoise(u, v) {
  return (
    0.46 * pnoise(0x51ed270b, 4, u, v, true) +
    0.32 * pnoise(0x1b873593, 8, u, v, true) +
    0.22 * pnoise(0x2545f491, 16, u, v, true)
  );
}
/** 진폭. 0.5 를 넘기면 균일 타일(코너 전부 같음) 안에 섬이 생겨 변 정합이 깨진다. */
const SIL_AMP = 0.84;

function fieldAt(corners, u, v) {
  const { nw, ne, se, sw } = corners;
  const b =
    nw * (1 - u) * (1 - v) + ne * u * (1 - v) + sw * (1 - u) * v + se * u * v;
  return b + SIL_AMP * (silhouetteNoise(u, v) - 0.5);
}

/* ---------- 색 ---------- */
const clamp255 = (n) => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n));

/**
 * 하부 = 현무암.
 *
 * 2차의 실패(평평함)와 그 반대 실패(균일한 자갈밭)를 동시에 피해야 한다.
 * 시도했다가 되돌린 것: 2셀(=타일 절반) 저주파 얼룩. 표면은 확실히 살아났지만 타일 경계에서
 * 잘려 **64px 누비이불**이 그대로 나왔다. 타일보다 큰 명암 덩어리는 여기 못 넣는다.
 * 대신 ①얇은 틈+위쪽 입술(선이라 커도 반복이 안 보임) ②8·16셀 얼룩 ③흑요석 반짝임
 * (작고 대비 높음)으로 국소 대비만 키운다. 평균 밝기는 낮게 유지 — 명도 구조는 상부가 진다.
 */
function lowerColour(u, v, s, st) {
  const w = worley(s ^ 0x27220a95, st.lowCells, st.lowCellsY ?? st.lowCells, u, v);
  // 판 사이 좁고 어두운 틈 + 그 위쪽 가장자리에만 얹는 얇은 밝은 립. **선**이라 크기가 커도
  // 반복이 안 보이고, 얇은 명암 짝이 표면을 평평하지 않게 만든다.
  const fissure = Math.max(0, 1 - w.edge / 0.13);
  // 틈의 **위쪽 입술만** 밝게. 얇은 명암 짝(위 밝고 아래 어두움)이 광원 방향을 알려 주고,
  // 이게 없으면 검은 바위는 어떤 노이즈를 얹어도 평평해 보인다.
  const lip = Math.max(0, fissure - 0.5) * (w.dyFromCentre > 0 ? 2.1 : 0.15);
  const midA = pnoise(s ^ 0x7feb352d, 4, u, v, false);
  const midB = pnoise(s ^ 0x3b9aca07, 8, u, v, false);
  const fine = pnoise(s ^ 0x2c1b3c6d, 16, u, v, false);
  const grit = pnoise(s ^ 0x165667b1, 32, u, v, false);
  /**
   * 4차 — **부스러기 밀도 변조**. 3차의 암부는 밀도 변화 없는 균일 고주파 crumb 였고
   * 비평은 "재질 없는 검정이 재질 없는 사포로 바뀌었을 뿐"이라 판정했다.
   *
   * 변조는 **평균이 아니라 진폭에만** 건다. `(fine-0.5)`·`(grit-0.5)` 는 zero-mean 이라
   * 진폭을 자리마다 바꿔도 국소 평균 휘도가 움직이지 않는다 → 타일보다 큰 명암 덩어리를
   * 만들지 않는다는 하드 룰(누비이불 방지)을 깨지 않으면서 "여긴 거칠고 저긴 매끈"이 생긴다.
   * 3셀(≈타일 1/3)이라 룰이 금지하는 저주파(>1/6 타일)에 해당하지만, **휘도가 아니라
   * 거칠기**를 실어 나르므로 타일 경계에서 잘려도 값 단차가 아니라 질감 단차만 남는다.
   */
  const dens = pnoise(s ^ 0x1a2b3c4d, 3, u, v, false);
  const rough = st.lowGrit * (0.18 + 1.75 * dens);
  // 흑요석 반짝임: 아주 작고 대비 높은 점. 밀도 변조를 같이 받아 반짝이는 구역이 뭉친다.
  const glint = Math.max(0, grit - 0.87) * 118 * Math.min(1.6, 0.3 + 1.5 * dens);
  // 평균은 낮게 두되(용암과의 명도비를 지켜야 한다) **국소 대비는 크게**. 어두운 영역은
  // 평균을 올려서가 아니라 국소 대비로 살린다 — 평균을 올리면 상부와의 값 구조가 무너진다.
  const l =
    31 +
    (w.id - 0.5) * 7 +
    (midA - 0.5) * 7 +
    (midB - 0.5) * 21 * st.lowPlate +
    (fine - 0.5) * 15 * rough +
    (grit - 0.5) * 8 * rough -
    fissure * 23 * st.lowPlate +
    lip * 27 * st.lowPlate;
  const ember = Math.max(0, fissure - 0.84) * 3.4 * st.lowPlate;
  return [
    clamp255(l * 1.05 + glint * 0.9 + ember * 30),
    clamp255(l * 0.92 + glint * 0.95 + ember * 10),
    clamp255(l * 1.02 + glint * 1.1 + ember * 2),
  ];
}

/**
 * 상부 = 용융 지대. **밝은 슬랩이 아니다.**
 * 지배색은 어두운 식은 껍질이고, 판 사이 좁은 균열에서만 밝은 용암이 비친다 — 작고 대비 높은
 * 요소라 반복이 잘 안 보이고, 동시에 표면이 평평해 보이지 않는다.
 *
 * 균열은 **두 스케일**이다: 큰 판을 가르는 굵은 줄기(`st.hotCells`)와 그 위에 얹힌 가는
 * 잔금(그 3배 조밀·훨씬 어둡게). 한 스케일만 쓰면 파충류 비늘처럼 균일해진다.
 */
function upperColour(u, v, s, st) {
  const wa = worley(s ^ 0x68bc21eb, st.hotCells, st.hotCellsY ?? st.hotCells, u, v);
  const wb = worley(s ^ 0x3b9aca07, st.crazeCells, st.crazeCellsY ?? st.crazeCells, u, v);
  const vein = Math.max(0, 1 - wa.edge / st.veinW);
  const core = Math.pow(vein, 3.0);
  const craze = Math.max(0, 1 - wb.edge / st.crazeW);
  const bevel = Math.max(-1, Math.min(1, -wa.dyFromCentre * 1.6));
  const mid = pnoise(s ^ 0x51ed270b, 6, u, v, false);
  const fine = pnoise(s ^ 0x85ebca6b, 16, u, v, false);
  const grit = pnoise(s ^ 0x9e3779b9, 32, u, v, false);
  /**
   * 4차 — 껍질을 **대폭 어둡게**.
   *
   * 3차는 "밝은 픽셀 L>150 이 2.1%" 라는 수치만 보고 통과시켰지만, 화면에서 지각 **전체**가
   * 중간 밝기 주황으로 읽혔다(밝은 픽셀 비율이 낮아도 평균이 높으면 영역 자체가 밝다).
   * 그 결과 주황/적 계열인 카르곤 적(탱크)이 지각 위에서 위장됐다 — 미학이 아니라 가독성 결함.
   *
   * 4차의 값 구조: 껍질 평균은 하부 현무암에 가깝게 끌어내리고, 주황은 **균열선 위에만** 둔다.
   * 껍질 기준 명도 60 → 36, 적색 계수 1.50 → 1.30.
   */
  const crustL =
    36 +
    (wa.id - 0.5) * 7 +
    (mid - 0.5) * 15 +
    (fine - 0.5) * 10 +
    (grit - 0.5) * 5 +
    bevel * 8;
  let r = crustL * 1.3;
  let g = crustL * 0.74;
  let b = crustL * 0.52;
  /**
   * 균열 바깥 **어두운 후광**. 밝은 선을 더 밝게 하는 대신 그 양옆을 눌러 대비를 만든다.
   * (평균 밝기를 올리지 않고 선을 읽히게 하는 유일한 방법 — 지각이 다시 밝아지면 안 된다.)
   */
  const halo = Math.max(0, 1 - wa.edge / (st.veinW * 3.0));
  const shade = Math.max(0, halo - vein) * 0.34;
  r *= 1 - shade;
  g *= 1 - shade;
  b *= 1 - shade;
  // 잔금: 굵은 줄기보다 훨씬 어두운 적황. 중간 스케일 디테일 담당. 3차는 대역 0.30 에
  // 목표 208 이라 화면 전면을 덮는 "주황 그물 벽지" 의 실체였다 → 대역·목표·강도 전부 축소.
  const tc = Math.pow(craze, 2.4) * st.crazeAmp * (0.35 + 0.45 * mid);
  r += tc * (150 - r) * 0.8;
  g += tc * (60 - g) * 0.5;
  b += tc * (24 - b) * 0.35;
  // 굵은 줄기: 진홍 → 호박 → 담황. 심지에서만 흰끼가 돈다. 대역이 좁아진 만큼 심지는 유지.
  const t = Math.min(1, (vein * 0.34 + core * 0.9) * st.veinAmp * (0.7 + 0.42 * mid));
  r += t * (255 - r) * 0.98;
  g += t * (208 - g) * (0.3 + 0.62 * core);
  b += t * (134 - b) * (0.12 + 0.55 * core);
  return [clamp255(r), clamp255(g), clamp255(b)];
}

/* ---------- 타일 굽기 ---------- */
/**
 * 변형마다 판 스케일 자체를 바꾼다. 타일 안에서 섞을 수 있는 주파수는 32px 의 약수뿐이라
 * 한 장 안에서는 스케일 다양성에 한계가 있다 — 그 한계를 **타일 사이**에서 푼다.
 * 채움 셀은 (기본+변형 4) × 회전 2 = 10 가지로 그려지므로, 판 크기가 구역마다 달라 보인다.
 */
/**
 * 4차 — **균열 스케일 3단 + 무늬 없는 슬래브**.
 *
 * 3차의 결함: 셀 크기가 전 화면에서 40~55px 로 균일한 Voronoi 그물이 주황 영역 전면을 덮었다.
 * 균일 그물은 절차적 필터의 서명이라 눈이 즉시 "생성물"로 분류한다.
 *
 * 타일 **안**에서 섞을 수 있는 주파수는 32px 의 약수뿐이라 한 장으로는 스케일 다양성에 한계가
 * 있다. 그 한계는 3차와 같이 **타일 사이**에서 푼다 — 다만 3차는 변형 간 차이가 hotCells 2~4
 * (실질 1.5배)뿐이라 눈에 안 잡혔다. 4차는 2~8 셀(**4배**)로 벌리고, 여기에 균열을 거의 그리지
 * 않는 **슬래브 변형**을 넣어 화면에 의도적 정적(negative space)을 만든다.
 *
 * 타일 사이 대비는 휘도가 아니라 **균열 밀도**로만 준다(껍질 평균 밝기는 전 변형 동일).
 * 그래서 슬래브와 세밀 구역이 붙어도 64px 명암 블록이 생기지 않고, 밀도 차만 리듬으로 읽힌다.
 * 인접 변형 간 균열선이 이어지지 않는 문제는 3차부터 이미 그랬고(변형마다 시드가 다름),
 * 화면에서는 "다른 각도로 만나는 균열망"으로 읽혀 오히려 유기적이다.
 *
 * ⚠️ **밀도 대역(band)은 셀 단위로 뽑으면 안 된다.** 처음엔 변형을 타일마다 독립 해시로 골랐는데,
 * 슬래브 한 장이 파쇄대 사이에 홀로 떨어지면 **정확한 64px 정사각형**으로 읽혔다(프리뷰에서
 * 즉시 보였다 — 휘도 누비이불보다 나쁘다. 도형이 사각형이라서). 그래서 `autotile.ts` 가 변형을
 * **저주파 밴드 필드**(≈5타일)로 고르게 바꿨다: 이웃 셀은 같은 밀도 등급을 공유하고 그 안에서만
 * 서로 다른 변형을 뽑는다 → 정적 구역이 여러 타일에 걸친 **유기적 덩어리**가 되고, 밀도 경계는
 * 사각형이 아니라 필드 등고선(+타일 지터)을 따른다.
 *
 * 필드:
 *  band       0=정적(슬래브) 1=중 2=세밀. `autotile.ts` 의 밴드 필드가 이 값으로 고른다.
 *  hotCells/hotCellsY  32px 타일당 굵은 판 개수(x/y). 화면 셀 지름 ≈ 64/개수 px.
 *             x·y 를 다르게 주면 판이 흐른 방향으로 늘어난다 — 비평 ②의 "흐름 방향" 항목.
 *             방향은 **밴드 단위로** 통일한다: 중(中) 밴드는 가로 흐름(셀이 납작),
 *             세밀 밴드는 세로 흐름(셀이 길쭉). 변형마다 방향이 다르면 구역이 어지러워진다.
 *  veinW      굵은 균열 대역폭(작을수록 가는 선). 0 에 가까우면 균열 소멸.
 *  veinAmp    굵은 균열 발광 강도
 *  crazeCells/crazeW/crazeAmp  잔금(가는 실금)
 *  lowGrit    암부 부스러기 진폭 배수, lowPlate 암부 판 구조 강도
 */
const STYLES = [
  // 0 — 기본(16장 Wang 전부 + 채움 슬롯 0). 중(中) 스케일.
  { band: 1, lowCells: 4, lowCellsY: 6, lowGrit: 1.0, lowPlate: 1.0, hotCells: 3, hotCellsY: 5, veinW: 0.15, veinAmp: 1.0, crazeCells: 9, crazeCellsY: 13, crazeW: 0.1, crazeAmp: 0.55 },
  // 1 — **슬래브**: 균열 거의 없는 큰 판. 화면의 정적 담당.
  { band: 0, lowCells: 2, lowGrit: 0.42, lowPlate: 0.35, hotCells: 2, veinW: 0.055, veinAmp: 0.55, crazeCells: 4, crazeW: 0.045, crazeAmp: 0.14 },
  // 2 — 대(大) 스케일: 32px 급 셀, 굵고 성긴 균열.
  { band: 1, lowCells: 3, lowCellsY: 5, lowGrit: 0.8, lowPlate: 1.15, hotCells: 2, hotCellsY: 4, veinW: 0.19, veinAmp: 1.05, crazeCells: 5, crazeCellsY: 8, crazeW: 0.07, crazeAmp: 0.3 },
  // 3 — 소(小) 스케일: 잘게 깨진 대상(帶狀).
  { band: 2, lowCells: 6, lowCellsY: 4, lowGrit: 1.3, lowPlate: 0.9, hotCells: 6, hotCellsY: 4, veinW: 0.115, veinAmp: 0.95, crazeCells: 14, crazeCellsY: 10, crazeW: 0.085, crazeAmp: 0.6 },
  // 4 — **슬래브 2**: 결이 다른 정적 구역(암부는 매끈, 상부는 실금만).
  { band: 0, lowCells: 3, lowGrit: 0.5, lowPlate: 0.5, hotCells: 3, veinW: 0.06, veinAmp: 0.5, crazeCells: 6, crazeW: 0.05, crazeAmp: 0.2 },
  // 5 — 극소 스케일: 8px 급 파쇄대. 좁은 띠로 들어가 리듬의 강세를 만든다.
  { band: 2, lowCells: 8, lowCellsY: 6, lowGrit: 1.45, lowPlate: 0.75, hotCells: 9, hotCellsY: 6, veinW: 0.09, veinAmp: 0.85, crazeCells: 18, crazeCellsY: 13, crazeW: 0.07, crazeAmp: 0.5 },
  // 6 — **슬래브 3**: 정적 밴드에 세 번째 결. 밴드 안에 그림이 둘뿐이면 조용한 구역에서
  //      64px 반복이 다시 눈에 잡힌다(프리뷰에서 확인).
  { band: 0, lowCells: 4, lowCellsY: 3, lowGrit: 0.65, lowPlate: 0.7, hotCells: 2, hotCellsY: 3, veinW: 0.075, veinAmp: 0.6, crazeCells: 3, crazeCellsY: 4, crazeW: 0.055, crazeAmp: 0.18 },
  // 7 — 중 스케일 변주.
  { band: 1, lowCells: 4, lowCellsY: 6, lowGrit: 1.15, lowPlate: 1.05, hotCells: 4, hotCellsY: 6, veinW: 0.13, veinAmp: 1.0, crazeCells: 11, crazeCellsY: 15, crazeW: 0.09, crazeAmp: 0.5 },
];

/**
 * **변형 간 평균 휘도 정규화(4차 필수).**
 *
 * 변형별로 균열 밀도를 크게 벌리면(슬래브 ↔ 파쇄대) 밀도만 달라지는 게 아니라 **평균 밝기도**
 * 달라진다 — `fissure`·`vein`·`craze` 는 zero-mean 이 아니기 때문. 그 평균차는 셀마다 다른
 * 변형이 깔리는 순간 정확히 64px 격자 위의 명암 블록이 되어 누비이불을 되살린다.
 * 실측: 정규화 없이 굽자 열평균 자기상관 lag64(0.9195)가 lag63(0.9171)·lag65(0.9130)를
 * **둘 다 넘어섰다**(3차에서는 사이에 있었다) — 격자 재발의 정의 그대로.
 *
 * 그래서 기준 평균을 정해 두고 **구워진 타일마다 그 타일의 실제 영역 평균**을 기준에 맞춘다
 * (스타일 단위 게인으로는 부족했다 — 스타일이 같아도 시드가 다르면 타일 평균이 몇 % 씩 어긋나고,
 * 변형이 8종뿐이라 그 오차가 씻기지 않아 lag64 봉우리가 남았다. 4시드 중 2시드에서 재현).
 * 가산이 아니라 **곱연산**이라 색상은 보존된다.
 *
 * 다만 기준을 **하나**로 두면 안 된다. 슬래브는 같은 평균을 얇은 선 대신 넓게 펴서 내므로
 * "고르게 밝은 갈색 판"이 되어 오히려 밝아 보인다 — 정적 구역은 실제로 **더 어두워야** 한다.
 * 그래서 기준을 **밴드별로** 잡는다: 같은 밴드 안의 타일끼리는 평균이 정확히 같고(밴드 내부에는
 * 격자가 없다), 밴드 사이 밝기 차는 `autotile.ts` 의 저주파 밴드 필드를 타므로 사각형이 아니라
 * 유기적 덩어리로 나타난다.
 */
const LUM = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const SEEDS_CAL = [0x9111, 0x2ac3, 0x51f7, 0x7d02];
function meanOfStyle(fn, st) {
  let s = 0;
  for (const sd of SEEDS_CAL)
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) s += LUM(fn((x + 0.5) / T, (y + 0.5) / T, sd, st));
  return s / (T * T * SEEDS_CAL.length);
}
/** 밴드별 기준 평균 = 그 밴드에 속한 스타일들의 자연 평균(억지로 맞추지 않는다). */
const BAND_REF = [0, 1, 2].map((b) => {
  const members = STYLES.filter((s) => s.band === b);
  const avg = (fn) => members.reduce((a, st) => a + meanOfStyle(fn, st), 0) / members.length;
  return { low: avg(lowerColour), up: avg(upperColour) };
});

function bakeTile(px, ox, oy, corners, seed, uniform, st = STYLES[0]) {
  const REF = BAND_REF[st.band];
  // 마스크를 먼저 전부 구해 둔다(테두리 판정에 이웃이 필요).
  const mask = new Uint8Array(T * T);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const u = (x + 0.5) / T;
      const v = (y + 0.5) / T;
      mask[y * T + x] = fieldAt(corners, u, v) > 0.5 ? 1 : 0;
    }
  }
  // 1차 패스: 원색과 **이 타일의** 영역별 평균 휘도.
  const raw = new Float64Array(T * T * 3);
  let sumUp = 0;
  let nUp = 0;
  let sumLow = 0;
  let nLow = 0;
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const u = (x + 0.5) / T;
      const v = (y + 0.5) / T;
      const up = mask[y * T + x] === 1;
      const c = up ? upperColour(u, v, seed, st) : lowerColour(u, v, seed, st);
      const o = (y * T + x) * 3;
      raw[o] = c[0];
      raw[o + 1] = c[1];
      raw[o + 2] = c[2];
      if (up) {
        sumUp += LUM(c);
        nUp++;
      } else {
        sumLow += LUM(c);
        nLow++;
      }
    }
  }
  // 2차 패스: 영역 평균을 전역 기준에 맞추는 곱연산 게인(위 주석 참조).
  const gUp = nUp > 0 && sumUp > 0 ? (REF.up * nUp) / sumUp : 1;
  const gLow = nLow > 0 && sumLow > 0 ? (REF.low * nLow) / sumLow : 1;
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const up = mask[y * T + x] === 1;
      const o = (y * T + x) * 3;
      const gain = up ? gUp : gLow;
      let c = [clamp255(raw[o] * gain), clamp255(raw[o + 1] * gain), clamp255(raw[o + 2] * gain)];
      if (!uniform) {
        // 경계에 인접한 용암 픽셀은 눌러 준다. PixelLab 이 그리던 밝은 1px 림이
        // "지형 가장자리의 가는 와이어프레임"으로 읽혔던 자리 — 대신 식은 테두리로.
        let edge = false;
        for (let k = 0; k < 4 && !edge; k++) {
          const nx = x + [1, -1, 0, 0][k];
          const ny = y + [0, 0, 1, -1][k];
          if (nx < 0 || ny < 0 || nx >= T || ny >= T) continue;
          if (mask[ny * T + nx] !== mask[y * T + x]) edge = true;
        }
        if (edge && up) c = [clamp255(c[0] * 0.5), clamp255(c[1] * 0.42), clamp255(c[2] * 0.42)];
      }
      const i = ((oy + y) * W + (ox + x)) * 4;
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
      px[i + 3] = 255;
    }
  }
}

const cornersOf = (key) => ({
  nw: (key >> 3) & 1,
  ne: (key >> 2) & 1,
  se: (key >> 1) & 1,
  sw: key & 1,
});

console.log(
  'band ref L ' +
    BAND_REF.map((r, i) => `b${i} low=${r.low.toFixed(1)} up=${r.up.toFixed(1)}`).join(' | '),
);

const px = new Uint8Array(W * H * 4);
const tilesMeta = [];
for (let key = 0; key < 16; key++) {
  const col = key % COLS;
  const row = (key / COLS) | 0;
  const c = cornersOf(key);
  bakeTile(px, col * T, row * T, c, 0x1000 + key * 977, key === 0 || key === 15);
  tilesMeta.push({
    name: `wang_${key}`,
    corners: {
      NW: c.nw ? 'upper' : 'lower',
      NE: c.ne ? 'upper' : 'lower',
      SE: c.se ? 'upper' : 'lower',
      SW: c.sw ? 'upper' : 'lower',
    },
    bounding_box: { x: col * T, y: row * T, width: T, height: T },
  });
}
const fillVariants = [];
let slot = 16;
for (const key of [0, 15]) {
  for (let v = 0; v < FILL_VARIANTS; v++) {
    const col = slot % COLS;
    const row = (slot / COLS) | 0;
    const st = STYLES[(v + 1) % STYLES.length];
    bakeTile(px, col * T, row * T, cornersOf(key), 0x7000 + key * 131 + v * 7919, true, st);
    fillVariants.push({
      key,
      // 밀도 등급. `autotile.ts` 가 저주파 밴드 필드로 등급을 고르고 그 안에서만 변형을 뽑는다.
      band: st.band,
      bounding_box: { x: col * T, y: row * T, width: T, height: T },
    });
    slot++;
  }
}

// 격자에 남는 슬롯은 메타데이터가 가리키지 않지만, 굽지 않으면 알파 0 인 채로 남아 시트를
// 열어 볼 때 "빠진 타일"처럼 보인다. 아무도 샘플하지 않으므로 기본 하부 타일로 채워 둔다.
for (; slot < ROWS * COLS; slot++) {
  bakeTile(px, (slot % COLS) * T, ((slot / COLS) | 0) * T, cornersOf(0), 0x2200 + slot, true);
}

const OUT = 'D:/ClaudeCowork/shooting/assets/tilesets';
writeFileSync(
  join(OUT, 'kargon.png'),
  encodePng({ width: W, height: H, colorType: 6, channels: 4, pixels: px }),
);
writeFileSync(
  join(OUT, 'kargon.json'),
  JSON.stringify(
    {
      name: 'kargon — 오프라인 합성 Wang 타일셋 (4차)',
      note: '실루엣·내부 전부 오프라인 합성. 재생성기는 .omc/research/kargon-aaa-shots/kargon-tileset-gen.mjs.',
      tile_size: { width: T, height: T },
      sheet: { width: W, height: H, cols: COLS, rows: ROWS },
      tileset_data: { tiles: tilesMeta, tile_size: { width: T, height: T }, total_tiles: 16 },
      /** 기본 타일(변형 슬롯 0)이 속한 밀도 등급. `autotile.ts` 의 밴드 선택이 쓴다. */
      base_band: STYLES[0].band,
      fill_variants: fillVariants,
    },
    null,
    1,
  ),
);
console.log(`wrote ${W}x${H} sheet, ${tilesMeta.length} wang + ${fillVariants.length} variants`);

/* ---------- 자체 검사 ----------
 * 1) 변 정합: 이웃할 수 있는 모든 (타일, 변) 짝에서 마스크 분류가 일치해야 한다.
 *    실패하면 지형 경계에 노치가 생긴다 — 눈으로 찾기 어려운 결함이라 여기서 잠근다.
 * 2) rot180 합법성: 180° 돌린 타일의 변 마스크가 원본 key 의 요구와 같아야 한다.
 */
function maskOf(key) {
  const c = cornersOf(key);
  const m = new Uint8Array(T * T);
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++)
      m[y * T + x] = fieldAt(c, (x + 0.5) / T, (y + 0.5) / T) > 0.5 ? 1 : 0;
  return m;
}
const masks = [];
for (let k = 0; k < 16; k++) masks.push(maskOf(k));
// 픽셀 중심은 변을 사이에 두고 서로 다른 월드 좌표에 있으므로 "열이 같아야 한다"는 잘못된
// 기준이다. 옳은 불변식은 **필드의 연속성**: A 의 필드를 타일 밖 u=1+d 로 연장한 값이 B 의
// u=d 값과 정확히 같아야 한다(그러면 등고선이 변을 가로질러 끊기지 않는다).
let bad = 0;
const EPS = 1e-12;
for (let a = 0; a < 16; a++) {
  for (let b = 0; b < 16; b++) {
    const ca = cornersOf(a);
    const cb = cornersOf(b);
    if (ca.ne === cb.nw && ca.se === cb.sw) {
      for (let v = 0; v <= 1; v += 0.017) {
        if (Math.abs(fieldAt(ca, 1, v) - fieldAt(cb, 0, v)) > EPS) {
          console.error(`SEAM H discontinuity ${a}|${b} v=${v.toFixed(3)}`);
          bad++;
          break;
        }
      }
    }
    if (ca.sw === cb.nw && ca.se === cb.ne) {
      for (let u = 0; u <= 1; u += 0.017) {
        if (Math.abs(fieldAt(ca, u, 1) - fieldAt(cb, u, 0)) > EPS) {
          console.error(`SEAM V discontinuity ${a}|${b} u=${u.toFixed(3)}`);
          bad++;
          break;
        }
      }
    }
  }
}
// rot180: tiles[rot180(k)] 를 180° 돌린 것이 k 와 픽셀 단위로 같은 마스크여야 한다.
const rot180Key = (k) => {
  const { nw, ne, se, sw } = cornersOf(k);
  return (se << 3) | (sw << 2) | (nw << 1) | ne;
};
for (let k = 0; k < 16; k++) {
  const src = masks[rot180Key(k)];
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      if (src[(T - 1 - y) * T + (T - 1 - x)] !== masks[k][y * T + x]) {
        console.error(`ROT180 mismatch key ${k} at ${x},${y}`);
        bad++;
        y = T;
        break;
      }
    }
}
// 커버리지·밝기 요약
let up = 0;
for (const m of masks) for (const b2 of m) up += b2;
const lum = (i) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
let lu = 0,
  ll = 0,
  nu = 0,
  nl = 0,
  bright = 0;
for (let k = 0; k < 16; k++) {
  const col = (k % COLS) * T;
  const row = ((k / COLS) | 0) * T;
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const i = ((row + y) * W + col + x) * 4;
      if (masks[k][y * T + x]) {
        lu += lum(i);
        nu++;
        if (lum(i) > 150) bright++;
      } else {
        ll += lum(i);
        nl++;
      }
    }
}
console.log(
  `seam/rot defects: ${bad} | tile upper share ${(up / (16 * T * T)).toFixed(3)}` +
    ` | L upper ${(lu / nu).toFixed(1)} lower ${(ll / nl).toFixed(1)}` +
    ` ratio ${(lu / nu / (ll / nl)).toFixed(2)} | bright>150 in upper ${((bright / nu) * 100).toFixed(1)}%`,
);
if (bad > 0) process.exitCode = 1;
