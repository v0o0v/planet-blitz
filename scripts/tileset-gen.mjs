#!/usr/bin/env node
/**
 * tileset-gen — Wang 타일셋 오프라인 합성기 (행성별 파라미터화).
 *
 * 카르곤 4차(PR#192)에서 PixelLab 없이 오프라인 합성으로 만든 생성기를, 행성 프로파일을
 * 인자로 받는 도구로 승격한 것이다. **메커니즘(이 파일) 과 테마(프로파일) 를 분리**한다:
 * 이 파일에는 "왜 이런 구조여야 하는가"만 남기고, 색·스케일 수치는 전부
 * `scripts/tileset-profiles/<planet>.mjs` 가 들고 온다.
 *
 * 사용법:
 *   node scripts/tileset-gen.mjs --planet kargon
 *   node scripts/tileset-gen.mjs --planet kargon --out /tmp/x   # 자산을 덮지 않고 대조
 *   node scripts/tileset-gen.mjs --planet niflheim --dry-run    # 검사만, 쓰기 없음
 *
 * 결정론: 모든 난수는 시드 해시(`hash2`)에서 나온다. `Math.random` 금지 — 같은 프로파일은
 * 언제 어디서 돌려도 **같은 바이트**를 내야 한다(카르곤 프로파일이 그 회귀 게이트다).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ 두 개의 "임계"를 혼동하지 마라 — 서로 다른 층이다.
 *   · 이 파일의 `MASK_THRESHOLD = 0.5` : **타일 내부** 실루엣 이진화. 32×32 한 장 안에서
 *     어느 픽셀이 상부(upper)인지 하부(lower)인지를 가른다. 코너 이중선형 + 실루엣 노이즈.
 *   · `src/render/autotile.ts` 의 `UPPER_THRESHOLD = 0.57` : **월드 코너** 분류. 지형 필드가
 *     이 값을 넘는 격자 코너를 upper 로 보고 그 4코너 조합으로 Wang key 를 고른다.
 *   전자를 후자에 맞추면 타일 안 상부 면적이 줄어 커버리지가 어긋난다(반대도 마찬가지).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 카르곤 4차가 4라운드에 걸쳐 얻은 구조(프로파일로 바꾸면 안 되는 것은 아래 "불변식 4개"):
 *  ① 지각 평균이 밝으면 주황 계열 적이 위장된다. **판정은 밝은 픽셀 수가 아니라 영역 평균**.
 *  ② 균열망이 단일 스케일이면 "절차적 필터의 서명"으로 읽힌다 → 스케일을 4배 벌리고
 *     균열을 거의 안 그리는 **슬래브** 변형으로 정적(negative space)을 만든다.
 *  ③ 암부는 균일 고주파 노이즈가 아니라 **밀도가 변조된** 거칠기여야 재질로 읽힌다.
 */
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { encodePng } from './lib/png.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const DEFAULT_OUT = join(REPO, 'assets', 'tilesets');

/* ============================ 불변식 4개 ============================
 * 하나만 깨도 64px 격자·누비이불이 **즉시** 재발한다(카르곤에서 전부 실측으로 확인).
 * 프로파일이 이것을 위반하면 조용히 나쁜 그림을 굽는 대신 **에러로 막는다** — 다음 사람이
 * 팔레트만 바꾸다 모르고 깨뜨리는 것이 이 도구의 가장 큰 실패 모드다.
 *
 *  I1  실루엣 진폭 < 1
 *      코너 이중선형 항의 폭이 1 이므로, 노이즈 진폭이 1 이상이면 코너가 전부 같은
 *      균일 타일(key 0/15) 안에서도 부호가 뒤집혀 **섬**이 생긴다 → 변 정합 붕괴.
 *  I2  실루엣 노이즈는 전 타일 공유 + 180° 대칭
 *      공유 → 이웃 타일의 맞닿는 변에서 같은 값 → 노치 없음.
 *      대칭 → rot180 변형이 합법(배치기가 타일의 절반을 뒤집어 쓴다).
 *  I3  밴드별 **곱연산** 정규화(가산 아님)
 *      변형별 균열 밀도를 벌리면 평균 밝기도 벌어지고, 그 평균차가 셀마다 다른 변형이
 *      깔리는 순간 정확히 64px 격자 위의 명암 블록이 된다. 가산으로 맞추면 색상이 무너지므로
 *      **곱연산**이어야 한다(색상 보존).
 *  I4  타일보다 큰 저주파 휘도 금지
 *      타일 절반 크기 얼룩을 넣으면 변형·회전 교체가 그 얼룩을 타일 경계에서 잘라
 *      64px 누비이불이 즉시 나온다. 큰 스케일은 **얇고 대비 높은 선**이 져야 한다.
 *      (진폭만 변조하는 저주파는 예외 — zero-mean 항의 진폭은 국소 평균을 안 움직인다.)
 * =================================================================== */

/** I1 — 실루엣 진폭 상한(배타적). */
const SIL_AMP_MAX = 1;
/** I2 — 실루엣 대칭 판정 허용 오차. */
const SYM_EPS = 1e-12;
/** I4 — 휘도에 **더해지는** pnoise 옥타브의 최소 셀 수(타일당). 4 = 8px 특징. */
const LUMA_MIN_CELLS = 4;
/** I4 — 진폭만 변조하는(=zero-mean 항에 곱해지는) 옥타브의 최소 셀 수. */
const MOD_MIN_CELLS = 2;
/** I4 — Worley 판 구조의 최소 셀 수. 1 이면 타일당 판이 하나라 타일 자체가 얼룩이 된다. */
const WORLEY_MIN_CELLS = 2;
/**
 * I4 — 경험적 게이트(지표 정의와 두 번의 오설계는 `checkLowFrequency` 주석에 있다).
 *
 * 값은 **카르곤 4차 실측 최댓값 × 1.28**: 하부 0.140 → 0.18, 상부 0.305 → 0.39.
 * 상·하부를 나눠 재는 이유는 상부(판·균열)가 원래 훨씬 큰 구조를 갖고 있어 한 문턱으로 묶으면
 * 하부 얼룩이 상부 값에 가려 안 잡히기 때문이다 — 실측: 하부에 2셀 얼룩을 넣어도 **전역**
 * 최댓값은 상부의 0.305 그대로였다(하부만 0.140 → 0.215 로 뛰었다).
 *
 * ⚠️ 새 행성이 여기 걸리면 문턱부터 올리지 마라. 먼저 "큰 스케일 요소를 **선**이 아니라
 * **덩어리**로 넣지 않았는가"를 보라 — 선은 이 지표를 거의 안 올린다. 정말 올려야 한다면
 * 프리뷰(`.omc/research/kargon-aaa-shots/kargon-tileset-preview.mjs`)로 64px 격자가 안 보이는지
 * 눈으로 확인한 근거를 같이 남겨라.
 */
const LOWFREQ_RATIO_MAX = { lower: 0.18, upper: 0.39 };

class InvariantViolation extends Error {
  constructor(id, msg) {
    super(`[불변식 ${id}] ${msg}`);
    this.name = 'InvariantViolation';
  }
}
const require_ = (ok, id, msg) => {
  if (!ok) throw new InvariantViolation(id, msg);
};

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
 * → 타일을 180° 돌려 그려도 변 위 픽셀이 그대로라 Wang 인접이 깨지지 않는다(I2).
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
 * x·y 셀 수를 따로 받는다. 같게 두면 등방성 벌집이 나오는데, "흐름 방향이 없다"가 정확히
 * 그것이다 — 실제 용암 지각의 판은 흐른 방향으로 늘어난다. `cellsY < cellsX` 면 셀이 세로로
 * 길어지고, 그 비를 **밴드 단위로** 고정하면 한 구역 전체가 같은 방향으로 흐르는 것처럼
 * 읽힌다(변형마다 방향이 다르면 그냥 어지럽다).
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

const clamp255 = (n) => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n));
const LUM = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
/** 밴드 수. `src/render/autotile.ts` 의 밴드 필드와 같은 개수여야 한다. */
const BANDS = 3;
/** 정적(靜) 밴드 인덱스. 이 밴드는 무늬가 적어 반복이 가장 잘 보이므로 변형이 더 필요하다. */
const QUIET_BAND = 0;
/** 타일 내부 실루엣 이진화 임계. autotile 의 UPPER_THRESHOLD 와 **다른 층**(파일 헤더 참조). */
const MASK_THRESHOLD = 0.5;
/** 정규화 기준 평균을 재는 데 쓰는 시드(프로파일 무관 고정 — 기준 자체는 결정론이어야 한다). */
const SEEDS_CAL = [0x9111, 0x2ac3, 0x51f7, 0x7d02];

/* ---------- 프로파일 → 실행 가능한 굽기 엔진 ---------- */

/**
 * 프로파일 정합성 검사(굽기 전). 불변식 I1~I4 의 **선언적** 부분과, 밴드 구조가
 * 성립하는지(빈 밴드 = 기준 평균이 NaN, 변형 부족 = 반복 재발)를 본다.
 */
function validateProfile(p) {
  require_(typeof p.planet === 'string' && p.planet.length > 0, 'P', '프로파일에 planet 이 없다.');
  const sil = p.silhouette;
  require_(sil && Array.isArray(sil.octaves) && sil.octaves.length > 0, 'I2', '실루엣 옥타브가 없다.');

  // I1 — 진폭 상한.
  require_(
    typeof sil.amp === 'number' && sil.amp > 0 && sil.amp < SIL_AMP_MAX,
    'I1',
    `실루엣 진폭 amp=${sil.amp} 는 [0, ${SIL_AMP_MAX}) 밖이다. ` +
      '1 이상이면 코너가 전부 같은 균일 타일 안에서도 부호가 뒤집혀 섬이 생기고 변 정합이 깨진다.',
  );

  // I2 — 대칭 접기 가능성(정수 셀 수)과 대칭 요구.
  for (const [i, o] of sil.octaves.entries()) {
    require_(
      Number.isInteger(o.cells) && o.cells >= 2,
      'I2',
      `실루엣 옥타브 ${i} 의 cells=${o.cells} — 180° 대칭 접기는 정수 셀에서만 정의된다(≥2).`,
    );
    require_(
      o.sym !== false,
      'I2',
      `실루엣 옥타브 ${i} 가 sym=false 다. 대칭이 깨지면 rot180 변형이 불법이 되어 ` +
        '배치기가 뒤집어 그린 타일의 변에서 노치가 생긴다.',
    );
  }

  // I3 — 정규화 방식.
  require_(
    (p.normalise ?? 'multiplicative') === 'multiplicative',
    'I3',
    `normalise='${p.normalise}'. 밴드 정규화는 **곱연산**이어야 한다 — 가산으로 평균을 맞추면 ` +
      '어두운 영역일수록 색상이 회색 쪽으로 끌려가 팔레트가 무너진다.',
  );

  // I4 — 선언적 셀 수 하한.
  const L = p.palette.lower;
  const U = p.palette.upper;
  const lumaOct = [
    ['lower.midACells', L.midACells],
    ['lower.midBCells', L.midBCells],
    ['lower.fineCells', L.fineCells],
    ['lower.gritCells', L.gritCells],
    ['upper.midCells', U.midCells],
    ['upper.fineCells', U.fineCells],
    ['upper.gritCells', U.gritCells],
  ];
  for (const [k, v] of lumaOct)
    require_(
      Number.isInteger(v) && v >= LUMA_MIN_CELLS,
      'I4',
      `${k}=${v} — 휘도에 더해지는 옥타브는 셀 ${LUMA_MIN_CELLS} 이상이어야 한다. ` +
        '그보다 성기면 타일 크기에 가까운 명암 얼룩이 되고, 변형 교체가 그것을 타일 경계에서 잘라 누비이불이 된다.',
    );
  require_(
    Number.isInteger(L.densCells) && L.densCells >= MOD_MIN_CELLS,
    'I4',
    `lower.densCells=${L.densCells} — 진폭 변조 옥타브도 ${MOD_MIN_CELLS} 이상이어야 한다.`,
  );

  // 스타일별 Worley 셀 하한 + 밴드 구조.
  const bandCount = new Array(BANDS).fill(0);
  for (const [i, st] of p.styles.entries()) {
    require_(
      Number.isInteger(st.band) && st.band >= 0 && st.band < BANDS,
      'B',
      `styles[${i}].band=${st.band} 가 0..${BANDS - 1} 밖이다.`,
    );
    bandCount[st.band]++;
    for (const k of ['lowCells', 'lowCellsY', 'hotCells', 'hotCellsY', 'crazeCells', 'crazeCellsY']) {
      const v = st[k];
      if (v === undefined) continue;
      require_(
        Number.isInteger(v) && v >= WORLEY_MIN_CELLS,
        'I4',
        `styles[${i}].${k}=${v} — 판 구조 셀은 ${WORLEY_MIN_CELLS} 이상이어야 한다. ` +
          '1 이면 타일당 판이 하나라 타일 자체가 하나의 얼룩이 된다.',
      );
    }
  }
  for (let b = 0; b < BANDS; b++)
    require_(
      bandCount[b] > 0,
      'B',
      `밴드 ${b} 에 속한 스타일이 없다. 기준 평균이 NaN 이 되고 그 밴드의 타일이 전부 검게 굽힌다.`,
    );
  require_(
    bandCount[QUIET_BAND] >= 3,
    'B',
    `정적 밴드(${QUIET_BAND}) 의 스타일이 ${bandCount[QUIET_BAND]} 종뿐이다. ` +
      '무늬가 적은 구역은 그림이 둘이면 64px 반복이 눈에 잡힌다(카르곤 프리뷰에서 확인) — 3종 이상.',
  );
  const fv = p.fillVariants ?? 7;
  require_(
    fv + 1 >= p.styles.length,
    'B',
    `fillVariants=${fv} 로는 스타일 ${p.styles.length} 종을 다 못 싣는다(채움 슬롯이 부족).`,
  );
}

/** 프로파일에서 실루엣 필드를 만든다. 시드·스타일을 받지 않는다 = 전 타일 공유(I2). */
function makeSilhouette(p) {
  const { amp, octaves } = p.silhouette;
  const noise = (u, v) => {
    let s = 0;
    for (const o of octaves) s += o.weight * pnoise(o.seed, o.cells, u, v, true);
    return s;
  };
  // I2 — **결과물에서** 대칭을 다시 잰다. 선언(sym:true)만 믿지 않는다.
  for (let i = 0; i < 37; i++) {
    const u = (i * 7 + 3) / 37;
    const v = (i * 13 + 5) / 37;
    const d = Math.abs(noise(u, v) - noise(1 - u, 1 - v));
    require_(
      d <= SYM_EPS,
      'I2',
      `실루엣 노이즈가 180° 대칭이 아니다(u=${u.toFixed(3)} 에서 Δ=${d}). rot180 변형이 불법이 된다.`,
    );
  }
  const fieldAt = (corners, u, v) => {
    const { nw, ne, se, sw } = corners;
    const b = nw * (1 - u) * (1 - v) + ne * u * (1 - v) + sw * (1 - u) * v + se * u * v;
    return b + amp * (noise(u, v) - 0.5);
  };
  return fieldAt;
}

/**
 * 하부 = 암반(카르곤 기준 현무암).
 *
 * "평평함"과 그 반대 실패인 "균일한 자갈밭"을 동시에 피해야 한다.
 * 시도했다가 되돌린 것: 2셀(=타일 절반) 저주파 얼룩. 표면은 확실히 살아났지만 타일 경계에서
 * 잘려 **64px 누비이불**이 그대로 나왔다(I4 의 근거). 대신 ①얇은 틈+위쪽 입술(선이라 커도
 * 반복이 안 보인다) ②중·고주파 얼룩 ③반짝임(작고 대비 높음)으로 국소 대비만 키운다.
 * 평균 밝기는 낮게 유지 — 명도 구조는 상부가 진다.
 */
function makeLower(P) {
  const C = P.palette.lower;
  return function lowerColour(u, v, s, st) {
    const w = worley(s ^ 0x27220a95, st.lowCells, st.lowCellsY ?? st.lowCells, u, v);
    // 판 사이 좁고 어두운 틈 + 그 위쪽 가장자리에만 얹는 얇은 밝은 립. **선**이라 크기가 커도
    // 반복이 안 보이고, 얇은 명암 짝이 표면을 평평하지 않게 만든다.
    const fissure = Math.max(0, 1 - w.edge / C.fissureW);
    // 틈의 **위쪽 입술만** 밝게. 얇은 명암 짝(위 밝고 아래 어두움)이 광원 방향을 알려 주고,
    // 이게 없으면 어두운 바위는 어떤 노이즈를 얹어도 평평해 보인다.
    const lip = Math.max(0, fissure - 0.5) * (w.dyFromCentre > 0 ? C.lipUp : C.lipDown);
    const midA = pnoise(s ^ 0x7feb352d, C.midACells, u, v, false);
    const midB = pnoise(s ^ 0x3b9aca07, C.midBCells, u, v, false);
    const fine = pnoise(s ^ 0x2c1b3c6d, C.fineCells, u, v, false);
    const grit = pnoise(s ^ 0x165667b1, C.gritCells, u, v, false);
    /**
     * **부스러기 밀도 변조**. 밀도 변화 없는 균일 고주파 crumb 는 "재질 없는 검정이 재질 없는
     * 사포로 바뀌었을 뿐"이라는 비평을 받았다.
     *
     * 변조는 **평균이 아니라 진폭에만** 건다. `(fine-0.5)`·`(grit-0.5)` 는 zero-mean 이라
     * 진폭을 자리마다 바꿔도 국소 평균 휘도가 움직이지 않는다 → I4(타일보다 큰 저주파 휘도
     * 금지)를 깨지 않으면서 "여긴 거칠고 저긴 매끈"이 생긴다. 그래서 `densCells` 만
     * `LUMA_MIN_CELLS` 가 아니라 `MOD_MIN_CELLS` 하한을 받는다.
     */
    const dens = pnoise(s ^ 0x1a2b3c4d, C.densCells, u, v, false);
    const rough = st.lowGrit * (C.roughBias + C.roughGain * dens);
    // 반짝임: 아주 작고 대비 높은 점. 밀도 변조를 같이 받아 반짝이는 구역이 뭉친다.
    const glint =
      Math.max(0, grit - C.glintCut) *
      C.glintGain *
      Math.min(C.glintDensCap, C.glintDensBias + C.glintDensGain * dens);
    // 평균은 낮게 두되(발광 요소와의 명도비를 지켜야 한다) **국소 대비는 크게**. 어두운 영역은
    // 평균을 올려서가 아니라 국소 대비로 살린다 — 평균을 올리면 상부와의 값 구조가 무너진다.
    const l =
      C.baseL +
      (w.id - 0.5) * C.idAmp +
      (midA - 0.5) * C.midAAmp +
      (midB - 0.5) * C.midBAmp * st.lowPlate +
      (fine - 0.5) * C.fineAmp * rough +
      (grit - 0.5) * C.gritAmp * rough -
      fissure * C.fissureAmp * st.lowPlate +
      lip * C.lipAmp * st.lowPlate;
    const ember = Math.max(0, fissure - C.emberCut) * C.emberGain * st.lowPlate;
    return [
      clamp255(l * C.rgb[0] + glint * C.glintRgb[0] + ember * C.emberRgb[0]),
      clamp255(l * C.rgb[1] + glint * C.glintRgb[1] + ember * C.emberRgb[1]),
      clamp255(l * C.rgb[2] + glint * C.glintRgb[2] + ember * C.emberRgb[2]),
    ];
  };
}

/**
 * 상부 = 활성 지대. **밝은 슬랩이 아니다.**
 * 지배색은 어두운 껍질이고, 판 사이 좁은 균열에서만 밝은 "핫 요소"가 비친다 — 작고 대비 높은
 * 요소라 반복이 잘 안 보이고, 동시에 표면이 평평해 보이지 않는다.
 *
 * 균열은 **두 스케일**이다: 큰 판을 가르는 굵은 줄기(`st.hotCells`)와 그 위에 얹힌 가는
 * 잔금(`st.crazeCells`, 훨씬 어둡게). 한 스케일만 쓰면 파충류 비늘처럼 균일해진다.
 *
 * ⚠️ 껍질 기준 명도(`crustL`)를 올리는 것은 거의 항상 잘못된 처방이다. 카르곤 3차는
 * "밝은 픽셀 L>150 이 2.1%" 라는 수치로 스스로를 통과시켰지만 화면에서 지각 **전체**가
 * 중간 밝기로 읽혀 같은 색 계열 적이 위장됐다. 밝기는 **선 위에만** 둬라.
 */
function makeUpper(P) {
  const C = P.palette.upper;
  return function upperColour(u, v, s, st) {
    const wa = worley(s ^ 0x68bc21eb, st.hotCells, st.hotCellsY ?? st.hotCells, u, v);
    const wb = worley(s ^ 0x3b9aca07, st.crazeCells, st.crazeCellsY ?? st.crazeCells, u, v);
    const vein = Math.max(0, 1 - wa.edge / st.veinW);
    const core = Math.pow(vein, C.veinPow);
    const craze = Math.max(0, 1 - wb.edge / st.crazeW);
    const bevel = Math.max(-1, Math.min(1, -wa.dyFromCentre * C.bevelGain));
    const mid = pnoise(s ^ 0x51ed270b, C.midCells, u, v, false);
    const fine = pnoise(s ^ 0x85ebca6b, C.fineCells, u, v, false);
    const grit = pnoise(s ^ 0x9e3779b9, C.gritCells, u, v, false);
    const crustL =
      C.crustL +
      (wa.id - 0.5) * C.idAmp +
      (mid - 0.5) * C.midAmp +
      (fine - 0.5) * C.fineAmp +
      (grit - 0.5) * C.gritAmp +
      bevel * C.bevelAmp;
    let r = crustL * C.rgb[0];
    let g = crustL * C.rgb[1];
    let b = crustL * C.rgb[2];
    /**
     * 균열 바깥 **어두운 후광**. 밝은 선을 더 밝게 하는 대신 그 양옆을 눌러 대비를 만든다.
     * (평균 밝기를 올리지 않고 선을 읽히게 하는 유일한 방법 — 껍질이 다시 밝아지면 안 된다.)
     */
    const halo = Math.max(0, 1 - wa.edge / (st.veinW * C.haloScale));
    const shade = Math.max(0, halo - vein) * C.shadeAmp;
    r *= 1 - shade;
    g *= 1 - shade;
    b *= 1 - shade;
    // 잔금: 굵은 줄기보다 훨씬 어두운 색. 중간 스케일 디테일 담당. 카르곤 3차는 대역 0.30 에
    // 목표 208 이라 화면 전면을 덮는 "주황 그물 벽지" 의 실체였다 → 대역·목표·강도 전부 축소.
    const tc = Math.pow(craze, C.crazePow) * st.crazeAmp * (C.crazeMidBias + C.crazeMidGain * mid);
    r += tc * (C.crazeTarget[0] - r) * C.crazeMix[0];
    g += tc * (C.crazeTarget[1] - g) * C.crazeMix[1];
    b += tc * (C.crazeTarget[2] - b) * C.crazeMix[2];
    // 굵은 줄기: 심지에서만 흰끼가 돈다. 대역이 좁아진 만큼 심지는 유지.
    const t = Math.min(
      1,
      (vein * C.veinLin + core * C.veinCore) * st.veinAmp * (C.veinMidBias + C.veinMidGain * mid),
    );
    r += t * (C.veinTarget[0] - r) * C.veinMixR;
    g += t * (C.veinTarget[1] - g) * (C.veinMixG[0] + C.veinMixG[1] * core);
    b += t * (C.veinTarget[2] - b) * (C.veinMixB[0] + C.veinMixB[1] * core);
    return [clamp255(r), clamp255(g), clamp255(b)];
  };
}

/**
 * **변형 간 평균 휘도 정규화(I3).**
 *
 * 변형별로 균열 밀도를 크게 벌리면(슬래브 ↔ 파쇄대) 밀도만 달라지는 게 아니라 **평균 밝기도**
 * 달라진다 — `fissure`·`vein`·`craze` 는 zero-mean 이 아니기 때문. 그 평균차는 셀마다 다른
 * 변형이 깔리는 순간 정확히 64px 격자 위의 명암 블록이 되어 누비이불을 되살린다.
 * 카르곤 실측: 정규화 없이 굽자 열평균 자기상관 lag64(0.9195)가 lag63(0.9171)·lag65(0.9130)를
 * **둘 다 넘어섰다** — 격자 재발의 정의 그대로.
 *
 * 그래서 기준 평균을 정해 두고 **구워진 타일마다 그 타일의 실제 영역 평균**을 기준에 맞춘다
 * (스타일 단위 게인으로는 부족했다 — 스타일이 같아도 시드가 다르면 타일 평균이 몇 % 씩 어긋나고,
 * 변형 수가 적어 그 오차가 씻기지 않아 lag64 봉우리가 남았다).
 * 가산이 아니라 **곱연산**이라 색상은 보존된다.
 *
 * 다만 기준을 **하나**로 두면 안 된다. 슬래브는 같은 평균을 얇은 선 대신 넓게 펴서 내므로
 * "고르게 밝은 판"이 되어 오히려 밝아 보인다 — 정적 구역은 실제로 **더 어두워야** 한다.
 * 그래서 기준을 **밴드별로** 잡는다: 같은 밴드 안의 타일끼리는 평균이 정확히 같고(밴드 내부에는
 * 격자가 없다), 밴드 사이 밝기 차는 `autotile.ts` 의 저주파 밴드 필드를 타므로 사각형이 아니라
 * 유기적 덩어리로 나타난다.
 */
function computeBandRef(P, lowerColour, upperColour) {
  const T = P.tile;
  const meanOfStyle = (fn, st) => {
    let s = 0;
    for (const sd of SEEDS_CAL)
      for (let y = 0; y < T; y++)
        for (let x = 0; x < T; x++) s += LUM(fn((x + 0.5) / T, (y + 0.5) / T, sd, st));
    return s / (T * T * SEEDS_CAL.length);
  };
  return Array.from({ length: BANDS }, (_, b) => {
    const members = P.styles.filter((s) => s.band === b);
    const avg = (fn) => members.reduce((a, st) => a + meanOfStyle(fn, st), 0) / members.length;
    return { low: avg(lowerColour), up: avg(upperColour) };
  });
}

const cornersOf = (key) => ({
  nw: (key >> 3) & 1,
  ne: (key >> 2) & 1,
  se: (key >> 1) & 1,
  sw: key & 1,
});

/**
 * 굽기 엔진 하나를 만든다. 반환된 객체가 `fieldAt`·`bakeTile` 과 검사에 필요한 부속을 들고 있다.
 */
function makeEngine(P) {
  validateProfile(P);
  const T = P.tile;
  const fieldAt = makeSilhouette(P);
  const lowerColour = makeLower(P);
  const upperColour = makeUpper(P);
  const BAND_REF = computeBandRef(P, lowerColour, upperColour);
  const EDGE = P.palette.edge;

  /**
   * 한 장 굽기. 반환값은 이 타일의 영역별 정규화 후 평균(밴드 정규화 검증용).
   * @param uniform 균일 타일(key 0/15)이면 경계 감쇠를 건너뛴다(경계가 없다).
   */
  function bakeTile(px, W, ox, oy, corners, seed, uniform, st = P.styles[0]) {
    const REF = BAND_REF[st.band];
    // 마스크를 먼저 전부 구해 둔다(테두리 판정에 이웃이 필요).
    const mask = new Uint8Array(T * T);
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const u = (x + 0.5) / T;
        const v = (y + 0.5) / T;
        mask[y * T + x] = fieldAt(corners, u, v) > MASK_THRESHOLD ? 1 : 0;
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
    // 2차 패스: 영역 평균을 밴드 기준에 맞추는 **곱연산** 게인(I3, 위 주석 참조).
    const gUp = nUp > 0 && sumUp > 0 ? (REF.up * nUp) / sumUp : 1;
    const gLow = nLow > 0 && sumLow > 0 ? (REF.low * nLow) / sumLow : 1;
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const up = mask[y * T + x] === 1;
        const o = (y * T + x) * 3;
        const gain = up ? gUp : gLow;
        let c = [clamp255(raw[o] * gain), clamp255(raw[o + 1] * gain), clamp255(raw[o + 2] * gain)];
        if (!uniform) {
          // 경계에 인접한 상부 픽셀은 눌러 준다. PixelLab 이 그리던 밝은 1px 림이
          // "지형 가장자리의 가는 와이어프레임"으로 읽혔던 자리 — 대신 식은 테두리로.
          let edge = false;
          for (let k = 0; k < 4 && !edge; k++) {
            const nx = x + [1, -1, 0, 0][k];
            const ny = y + [0, 0, 1, -1][k];
            if (nx < 0 || ny < 0 || nx >= T || ny >= T) continue;
            if (mask[ny * T + nx] !== mask[y * T + x]) edge = true;
          }
          if (edge && up)
            c = [clamp255(c[0] * EDGE[0]), clamp255(c[1] * EDGE[1]), clamp255(c[2] * EDGE[2])];
        }
        const i = ((oy + y) * W + (ox + x)) * 4;
        px[i] = c[0];
        px[i + 1] = c[1];
        px[i + 2] = c[2];
        px[i + 3] = 255;
      }
    }
  }

  return { T, fieldAt, lowerColour, upperColour, BAND_REF, bakeTile };
}

/* ---------- I3·I4 결과물 검사 ---------- */

/**
 * I3 — **결과물에서** 곱연산 정규화가 실제로 동작했는지 잰다.
 * 같은 밴드에 속한 균일 타일들의 영역 평균이 기준과 일치해야 한다(clamp·반올림 오차 허용).
 * 선언(`normalise: 'multiplicative'`)만으로는 게인 적용을 빠뜨린 코드를 못 잡는다.
 */
function checkBandNormalisation(eng, P) {
  const { T, bakeTile, BAND_REF } = eng;
  const px = new Uint8Array(T * T * 4);
  const worst = [];
  for (const [i, st] of P.styles.entries()) {
    for (const key of [0, 15]) {
      bakeTile(px, T, 0, 0, cornersOf(key), 0x4242 + i * 131, true, st);
      let s = 0;
      for (let k = 0; k < T * T; k++) s += LUM([px[k * 4], px[k * 4 + 1], px[k * 4 + 2]]);
      const mean = s / (T * T);
      const ref = key === 15 ? BAND_REF[st.band].up : BAND_REF[st.band].low;
      const dev = Math.abs(mean - ref) / ref;
      worst.push(dev);
      require_(
        dev < 0.06,
        'I3',
        `styles[${i}] key=${key} 의 영역 평균 ${mean.toFixed(2)} 이 밴드 ${st.band} 기준 ` +
          `${ref.toFixed(2)} 에서 ${(dev * 100).toFixed(1)}% 벗어났다 — 밴드 정규화가 안 걸렸거나 ` +
          '팔레트가 clamp 로 포화하고 있다(포화하면 게인이 무력해져 밴드 간 명암 블록이 남는다).',
      );
    }
  }
  return Math.max(...worst);
}

/**
 * I4 — **결과물에서** 저주파 휘도를 잰다.
 *
 * 지표: 정규화까지 마친 균일 타일을 8×8 블록(4×4=16칸)으로 나눠 **블록 평균 휘도의 표준편차**를
 * 타일 평균으로 나눈 값. 고주파 부스러기는 8px 평균에서 씻겨 나가고, 금지 대상인 타일 절반
 * (≈16px) 스케일 얼룩만 남는다.
 *
 * ⚠️ 두 번 틀린 지표를 여기 적어 둔다(다음 사람이 같은 길로 가지 않게):
 *  ① **사분면(16×16) 평균의 폭** — 16px 얼룩은 주기가 정확히 16px 이라 16px 창 안에서
 *     **평균이 상쇄된다**. 금지 대상을 정확히 못 보는 창 크기였다. 창은 얼룩보다 작아야 한다.
 *  ② **픽셀 표준편차로 나누기** — 얼룩은 분자(저주파)와 분모(전체 분산)를 **같이** 키워
 *     비가 오히려 내려간다. 실측으로 2셀 얼룩을 넣자 1.078 → 0.952 로 **떨어졌다**.
 *     정규화가 타일 평균을 고정해 주므로 기준은 **타일 평균**이어야 한다.
 *
 * 선언적 셀 수 하한은 **프로파일 수치**만 보므로, 코드 수정으로 들어오는 얼룩은 여기서만 잡힌다.
 */
function checkLowFrequency(eng, P) {
  const { T, bakeTile } = eng;
  const BLK = 8; // 창은 금지 대상(≈T/2)보다 작아야 한다 — 위 함정 ① 참조
  const NB = T / BLK;
  const px = new Uint8Array(T * T * 4);
  // 상·하부를 나눠 잰다. 한 문턱으로 묶으면 하부 얼룩이 상부의 큰 구조에 가려 안 잡힌다.
  const worst = { lower: 0, upper: 0 };
  const worstAt = { lower: '', upper: '' };
  const all = [];
  for (const [i, st] of P.styles.entries()) {
    for (const key of [0, 15]) {
      const region = key === 15 ? 'upper' : 'lower';
      for (const sd of SEEDS_CAL) {
        bakeTile(px, T, 0, 0, cornersOf(key), sd, true, st);
        const blk = new Float64Array(NB * NB);
        let s = 0;
        for (let y = 0; y < T; y++)
          for (let x = 0; x < T; x++) {
            const k = y * T + x;
            const L = LUM([px[k * 4], px[k * 4 + 1], px[k * 4 + 2]]);
            blk[((y / BLK) | 0) * NB + ((x / BLK) | 0)] += L;
            s += L;
          }
        const tileMean = s / (T * T);
        let bs = 0;
        let bs2 = 0;
        for (const v of blk) {
          const m = v / (BLK * BLK);
          bs += m;
          bs2 += m * m;
        }
        const nb = NB * NB;
        const blockSd = Math.sqrt(Math.max(0, bs2 / nb - (bs / nb) ** 2));
        const ratio = tileMean > 1e-9 ? blockSd / tileMean : 0;
        const at = `styles[${i}] key=${key} seed=0x${sd.toString(16)}`;
        all.push([ratio, at]);
        if (ratio > worst[region]) {
          worst[region] = ratio;
          worstAt[region] = at;
        }
      }
    }
  }
  if (process.env.TILESET_DEBUG) {
    all.sort((a, b) => b[0] - a[0]);
    console.log('lowfreq top12: ' + all.slice(0, 12).map(([r, w]) => `${r.toFixed(3)} ${w}`).join(' | '));
  }
  for (const region of ['lower', 'upper'])
    require_(
      worst[region] <= LOWFREQ_RATIO_MAX[region],
      'I4',
      `${region} 저주파 휘도 비 ${worst[region].toFixed(3)} > ${LOWFREQ_RATIO_MAX[region]} ` +
        `(${worstAt[region]}). 타일 절반 크기의 명암 얼룩이 들어왔다 — 변형·회전 교체가 그것을 ` +
        '타일 경계에서 잘라 64px 누비이불이 즉시 나온다. 큰 스케일은 얇고 대비 높은 **선**으로 실어라.',
    );
  return worst;
}

/* ---------- 시트 굽기 ---------- */

function bakeSheet(P) {
  const eng = makeEngine(P);
  const T = eng.T;
  const COLS = P.cols;
  const FILL_VARIANTS = P.fillVariants;
  const ROWS = 4 + Math.ceil((FILL_VARIANTS * 2) / COLS);
  const W = COLS * T;
  const H = ROWS * T;
  const SO = P.seedOffset ?? 0;

  const px = new Uint8Array(W * H * 4);
  const tilesMeta = [];
  for (let key = 0; key < 16; key++) {
    const col = key % COLS;
    const row = (key / COLS) | 0;
    const c = cornersOf(key);
    eng.bakeTile(px, W, col * T, row * T, c, 0x1000 + key * 977 + SO, key === 0 || key === 15);
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
      const st = P.styles[(v + 1) % P.styles.length];
      eng.bakeTile(
        px,
        W,
        col * T,
        row * T,
        cornersOf(key),
        0x7000 + key * 131 + v * 7919 + SO,
        true,
        st,
      );
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
    eng.bakeTile(
      px,
      W,
      (slot % COLS) * T,
      ((slot / COLS) | 0) * T,
      cornersOf(0),
      0x2200 + slot + SO,
      true,
    );
  }

  const json = {
    name: P.name,
    note:
      P.note ??
      `오프라인 합성. 재생성기는 scripts/tileset-gen.mjs --planet ${P.planet} (프로파일: scripts/tileset-profiles/${P.planet}.mjs).`,
    tile_size: { width: T, height: T },
    sheet: { width: W, height: H, cols: COLS, rows: ROWS },
    tileset_data: { tiles: tilesMeta, tile_size: { width: T, height: T }, total_tiles: 16 },
    /** 기본 타일(변형 슬롯 0)이 속한 밀도 등급. `autotile.ts` 의 밴드 선택이 쓴다. */
    base_band: P.styles[0].band,
    fill_variants: fillVariants,
  };
  return { eng, px, W, H, tilesMeta, fillVariants, json };
}

/* ---------- 자체 검사(변 정합 / rot180 / 커버리지) ----------
 * 1) 변 정합: 이웃할 수 있는 모든 (타일, 변) 짝에서 필드가 연속이어야 한다.
 *    실패하면 지형 경계에 노치가 생긴다 — 눈으로 찾기 어려운 결함이라 여기서 잠근다.
 * 2) rot180 합법성: 180° 돌린 타일의 마스크가 원본 key 의 요구와 같아야 한다.
 */
function selfCheck(eng, px, W, COLS) {
  const { T, fieldAt } = eng;
  const maskOf = (key) => {
    const c = cornersOf(key);
    const m = new Uint8Array(T * T);
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++)
        m[y * T + x] = fieldAt(c, (x + 0.5) / T, (y + 0.5) / T) > MASK_THRESHOLD ? 1 : 0;
    return m;
  };
  const masks = [];
  for (let k = 0; k < 16; k++) masks.push(maskOf(k));
  // 픽셀 중심은 변을 사이에 두고 서로 다른 월드 좌표에 있으므로 "열이 같아야 한다"는 잘못된
  // 기준이다. 옳은 불변식은 **필드의 연속성**: A 의 필드를 타일 밖 u=1 로 평가한 값이 B 의
  // u=0 값과 정확히 같아야 한다(그러면 등고선이 변을 가로질러 끊기지 않는다).
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
  return {
    bad,
    upperShare: up / (16 * T * T),
    upperL: lu / nu,
    lowerL: ll / nl,
    brightPct: (bright / nu) * 100,
  };
}

/* ---------- CLI ---------- */

function parseArgs(argv) {
  const a = { out: null, planet: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--planet') a.planet = argv[++i];
    else if (t === '--out') a.out = argv[++i];
    else if (t === '--dry-run') a.dryRun = true;
    else throw new Error(`알 수 없는 인자: ${t}`);
  }
  if (!a.planet) throw new Error('사용법: node scripts/tileset-gen.mjs --planet <name> [--out <dir>] [--dry-run]');
  return a;
}

export async function loadProfile(planet) {
  const file = join(HERE, 'tileset-profiles', `${planet}.mjs`);
  if (!existsSync(file))
    throw new Error(`프로파일이 없다: ${file} — 새 행성은 이 파일부터 만든다(README 참조).`);
  const mod = await import(pathToFileURL(file).href);
  const P = mod.default ?? mod.profile;
  if (!P) throw new Error(`${file} 이 프로파일을 default export 하지 않는다.`);
  if (P.planet !== planet)
    throw new Error(`프로파일 planet='${P.planet}' 이 --planet ${planet} 과 다르다.`);
  return P;
}

export function generate(P) {
  const built = bakeSheet(P);
  const normDev = checkBandNormalisation(built.eng, P);
  const lowFreq = checkLowFrequency(built.eng, P);
  const check = selfCheck(built.eng, built.px, built.W, P.cols);
  return { ...built, normDev, lowFreq, check };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const P = await loadProfile(args.planet);
  const r = generate(P);

  console.log(
    'band ref L ' +
      r.eng.BAND_REF.map((b, i) => `b${i} low=${b.low.toFixed(1)} up=${b.up.toFixed(1)}`).join(' | '),
  );
  console.log(
    `invariants OK — I1 amp=${P.silhouette.amp} | I2 sym verified | ` +
      `I3 band norm dev max ${(r.normDev * 100).toFixed(2)}% | ` +
      `I4 lowfreq lower ${r.lowFreq.lower.toFixed(3)}/${LOWFREQ_RATIO_MAX.lower} upper ${r.lowFreq.upper.toFixed(3)}/${LOWFREQ_RATIO_MAX.upper}`,
  );
  console.log(
    `seam/rot defects: ${r.check.bad} | tile upper share ${r.check.upperShare.toFixed(3)}` +
      ` | L upper ${r.check.upperL.toFixed(1)} lower ${r.check.lowerL.toFixed(1)}` +
      ` ratio ${(r.check.upperL / r.check.lowerL).toFixed(2)} | bright>150 in upper ${r.check.brightPct.toFixed(1)}%`,
  );

  if (args.dryRun) {
    console.log(`(dry-run) ${r.W}x${r.H} sheet, ${r.tilesMeta.length} wang + ${r.fillVariants.length} variants — 쓰지 않음`);
  } else {
    const out = args.out ? resolve(args.out) : DEFAULT_OUT;
    if (!existsSync(out)) mkdirSync(out, { recursive: true });
    writeFileSync(
      join(out, `${P.planet}.png`),
      encodePng({ width: r.W, height: r.H, colorType: 6, channels: 4, pixels: r.px }),
    );
    writeFileSync(join(out, `${P.planet}.json`), JSON.stringify(r.json, null, 1));
    console.log(
      `wrote ${r.W}x${r.H} sheet, ${r.tilesMeta.length} wang + ${r.fillVariants.length} variants → ${out}`,
    );
  }
  if (r.check.bad > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(e instanceof InvariantViolation ? e.message : e);
    process.exitCode = 1;
  });
}
