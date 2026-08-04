#!/usr/bin/env node
/**
 * boss-silhouette — 보스 GLB 에서 **타이틀 화면용 알파 실루엣 PNG** 를 굽는다.
 *
 * ## 왜 런타임 3D 가 아닌가
 * 타이틀은 행성 앞에 보스 3기를 **어두운 실루엣으로만** 세운다(2026-08-04 사용자 확정). 실루엣만
 * 보일 것이라면 GLB 를 런타임에 받을 이유가 없다 — 9종 중 3종을 매 부팅 랜덤으로 뽑는 연출이라
 * 3D 로 가면 **매번 1.5MB 를 새로 받고**, 받는 동안 보스가 없는 화면이 먼저 보인다. 미리 구워
 * 두면 9장 합계가 수십 KB 고 랜덤이 지연 없이 즉시 뜬다.
 *
 * 대가는 실루엣이 **고정 각도**라는 것이다. 부유 연출은 위치로만 주고 자세는 굳는다.
 *
 * ## 왜 headless WebGL 이 아닌가
 * `scripts/` 는 의존성 0 규약이다. 그런데 실루엣에는 **텍스처도 조명도 필요 없다** — 필요한 것은
 * 삼각형의 정사영 커버리지뿐이라, GLB 의 POSITION 만 읽어 직접 래스터화하면 된다. 렌더러를
 * 들이는 것보다 짧고, 결과가 결정적이다(같은 입력 → 바이트가 같은 PNG).
 *
 * ## 각도 — 20°/18° 는 실측으로 고른 값이다
 * 인게임 보스 카메라는 고도 62°(`bossActor.ts` CAMERA_TILT_RAD) 다. 처음에 그 근처(45°)로 잡았다가
 * 9장을 나란히 놓고 보고 **낮췄다**: 고도가 높을수록 실루엣이 통째로 뭉개진다. 38° 에서는 베르단의
 * 거미 다리와 cm_runner 의 날개가 덩어리에 흡수됐고, 20° 에서는 둘 다 또렷하게 갈라진다. 위에서
 * 볼수록 형태가 자기 자신에 겹쳐 실루엣 정보가 사라지기 때문이다.
 *
 * ⚠️ **커버리지(채워진 픽셀 비율)로 고르면 안 된다.** 20°/30°/38° 에서 커버리지는 1~2%p 밖에
 * 안 움직였지만 눈으로 본 판독성은 확연히 달랐다 — 커버리지는 면적이지 형태가 아니다.
 *
 * 요 18° 는 좌우 대칭을 깨는 최소량이다. 0° 면 정면이라 평면적이고, 크게 주면 인게임에서 본
 * 모양과 달라져 "저게 뭐지"가 된다.
 *
 * 니플헤임(얼음 전함)은 어느 각도에서도 **납작한 띠**로 나온다 — 모델 자체가 낮고 긴 함선이라
 * 각도의 문제가 아니다. 화면에서는 그대로 "낮게 깔린 전함"으로 읽히므로 그냥 둔다.
 *
 * ## 안티에일리어싱
 * {@link SUPERSAMPLE} 배로 이진 채우기를 한 뒤 면적평균으로 줄인다. 실루엣은 가장자리가 전부라
 * 계단이 그대로 결함이 된다 — 스캔라인에서 부분 커버리지를 계산하는 것보다 이쪽이 짧고 정확하다.
 *
 * 사용법:
 *   node scripts/boss-silhouette.mjs                    # 전 보스 재생성
 *   node scripts/boss-silhouette.mjs boss_kargon.glb    # 일부만
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { encodePng } from './lib/png.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_DIR = join(ROOT, 'assets', 'models');
const OUT_DIR = join(ROOT, 'assets', 'title', 'bosses');

/** 출력 한 변(px). 화면 최대 표시 폭(≈240px)의 2배 — 확대해도 물러지지 않는 최소치다. */
const SIZE = 256;
/** 이진 채우기 배율. 3배면 가장자리 계단이 9단계로 부드러워진다(그 이상은 눈에 차이가 없다). */
const SUPERSAMPLE = 3;
/** 실루엣이 프레임에 닿지 않게 두는 여백 비율. 림라이트 사본이 살짝 커지므로 그 몫도 여기에 있다. */
const MARGIN = 0.94;

/**
 * 카메라 고도·요(도). 헤더 "각도" 참조. `--elev`/`--yaw` 로 덮어쓸 수 있다 — 각도는 코드로
 * 못 고르고 **9장을 나란히 놓고 눈으로** 골라야 하기 때문이다(45° 에서 니플헤임 전함이
 * 커버리지 13% 의 납작한 조각으로 뭉개진 것을 그렇게 잡았다).
 */
const DEFAULT_ELEVATION = 20;
const DEFAULT_YAW = 18;

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error('not a GLB file (bad magic)');
  let off = 12;
  let json = null;
  let bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(data.toString('utf8'));
    else if (type === CHUNK_BIN) bin = data;
    off += 8 + len;
  }
  if (json === null || bin === null) throw new Error('GLB missing JSON or BIN chunk');
  return { json, bin };
}

// --- 4×4 행렬(열 우선, glTF 규약) ---

function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

/** TRS → 행렬. glTF 는 회전을 쿼터니언 [x,y,z,w] 로 준다. */
function trsMatrix(node) {
  if (Array.isArray(node.matrix)) return node.matrix.slice();
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function transformPoint(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

// --- accessor 읽기 ---

const COMPONENT_READERS = {
  5120: (buf, off) => buf.readInt8(off),
  5121: (buf, off) => buf.readUInt8(off),
  5122: (buf, off) => buf.readInt16LE(off),
  5123: (buf, off) => buf.readUInt16LE(off),
  5125: (buf, off) => buf.readUInt32LE(off),
  5126: (buf, off) => buf.readFloatLE(off),
};
const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/**
 * accessor 를 평평한 숫자 배열로 읽는다.
 *
 * ⚠️ `byteStride` 를 무시하면 안 된다 — Meshy 출력은 POSITION/NORMAL 이 한 bufferView 에
 * 인터리브돼 있을 수 있고, 그때 stride 를 요소 크기로 가정하면 좌표가 법선과 섞인다.
 * `sparse` 는 이 자산군에 없어 지원하지 않는다(있으면 명시적으로 터진다).
 */
function readAccessor(json, bin, index) {
  const acc = json.accessors[index];
  if (acc.sparse !== undefined) throw new Error(`accessor ${index}: sparse 는 지원하지 않는다`);
  const comps = TYPE_COUNTS[acc.type];
  const read = COMPONENT_READERS[acc.componentType];
  const compBytes = COMPONENT_BYTES[acc.componentType];
  if (comps === undefined || read === undefined) {
    throw new Error(`accessor ${index}: 미지원 타입 ${acc.type}/${acc.componentType}`);
  }
  const out = new Float64Array(acc.count * comps);
  if (acc.bufferView === undefined) return out; // 전부 0 인 accessor(규약상 유효).
  const bv = json.bufferViews[acc.bufferView];
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const stride = bv.byteStride ?? comps * compBytes;
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < comps; c++) {
      out[i * comps + c] = read(bin, base + i * stride + c * compBytes);
    }
  }
  return out;
}

/** 씬 그래프를 훑어 월드 좌표 삼각형 목록을 만든다. */
function collectTriangles(json, bin) {
  const tris = [];
  const visit = (nodeIndex, parent) => {
    const node = json.nodes[nodeIndex];
    const world = multiply(parent, trsMatrix(node));
    if (node.mesh !== undefined) {
      for (const prim of json.meshes[node.mesh].primitives ?? []) {
        // mode 기본값 4 = TRIANGLES. 그 외(스트립·팬·선)는 이 자산군에 없다.
        if ((prim.mode ?? 4) !== 4) continue;
        const posIndex = prim.attributes?.POSITION;
        if (posIndex === undefined) continue;
        const pos = readAccessor(json, bin, posIndex);
        const count = pos.length / 3;
        const world3 = new Float64Array(count * 3);
        for (let i = 0; i < count; i++) {
          const [x, y, z] = transformPoint(world, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
          world3[i * 3] = x;
          world3[i * 3 + 1] = y;
          world3[i * 3 + 2] = z;
        }
        const idx =
          prim.indices === undefined
            ? Array.from({ length: count }, (_, i) => i)
            : readAccessor(json, bin, prim.indices);
        for (let i = 0; i + 2 < idx.length; i += 3) {
          tris.push({
            idx: [idx[i] * 3, idx[i + 1] * 3, idx[i + 2] * 3],
            verts: world3,
          });
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  for (const root of scene?.nodes ?? []) visit(root, identity());
  return tris;
}

/** 카메라 기저(right·up·forward). 정사영이라 위치는 필요 없고 방향만 쓴다. */
function cameraBasis(elevationDeg, yawDeg) {
  const elevation = (elevationDeg * Math.PI) / 180;
  const yaw = (yawDeg * Math.PI) / 180;
  // 카메라는 원점을 본다 — 시선은 카메라 위치의 반대 방향이다.
  const eye = [
    Math.sin(yaw) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(yaw) * Math.cos(elevation),
  ];
  const forward = eye.map((v) => -v);
  // right = normalize(forward × worldUp) 의 부호를 화면 오른쪽에 맞춘 것.
  const worldUp = [0, 1, 0];
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const norm = (v) => {
    const len = Math.hypot(v[0], v[1], v[2]) || 1;
    return v.map((c) => c / len);
  };
  const right = norm(cross(forward, worldUp));
  const up = norm(cross(right, forward));
  return { right, up };
}

/**
 * 삼각형들을 알파 커버리지 맵으로 굽는다.
 *
 * 깊이 정렬이 없다 — 실루엣은 **합집합**이라 앞뒤가 무의미하기 때문이다. 그래서 삼각형이
 * 겹쳐도 결과가 같고, 이 자산군의 내부 구조(껍질 안의 부품)가 실루엣을 더럽히지 않는다.
 */
function rasterize(tris, elevationDeg, yawDeg) {
  const { right, up } = cameraBasis(elevationDeg, yawDeg);
  const project = (verts, i) => {
    const x = verts[i];
    const y = verts[i + 1];
    const z = verts[i + 2];
    return [
      right[0] * x + right[1] * y + right[2] * z,
      up[0] * x + up[1] * y + up[2] * z,
    ];
  };

  // 1패스: 투영 범위를 재서 프레임에 맞춘다(모델마다 크기가 제각각이다).
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { idx, verts } of tris) {
    for (const i of idx) {
      const [px, py] = project(verts, i);
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }
  if (!Number.isFinite(minX)) throw new Error('삼각형이 하나도 없다');

  const hi = SIZE * SUPERSAMPLE;
  // 가로세로 중 큰 쪽을 프레임에 맞춘다 — 종횡비를 보존해야 실루엣이 찌그러지지 않는다.
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const scale = (hi * MARGIN) / span;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const toPixel = (verts, i) => {
    const [px, py] = project(verts, i);
    // y 는 화면 아래가 +다 — 위아래를 뒤집지 않으면 실루엣이 물구나무선다.
    return [hi / 2 + (px - cx) * scale, hi / 2 - (py - cy) * scale];
  };

  const mask = new Uint8Array(hi * hi);
  for (const { idx, verts } of tris) {
    const [ax, ay] = toPixel(verts, idx[0]);
    const [bx, by] = toPixel(verts, idx[1]);
    const [cxp, cyp] = toPixel(verts, idx[2]);
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cxp)));
    const x1 = Math.min(hi - 1, Math.ceil(Math.max(ax, bx, cxp)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cyp)));
    const y1 = Math.min(hi - 1, Math.ceil(Math.max(ay, by, cyp)));
    const area = (bx - ax) * (cyp - ay) - (by - ay) * (cxp - ax);
    if (area === 0) continue; // 퇴화 삼각형.
    const inv = 1 / area;
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        // 무게중심 좌표. 부호는 area 로 정규화하므로 삼각형의 감김 방향과 무관하다
        // (모델에 뒤집힌 면이 섞여 있어도 실루엣에서 빠지지 않는다).
        const w0 = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) * inv;
        const w1 = ((cxp - bx) * (py - by) - (cyp - by) * (px - bx)) * inv;
        const w2 = ((ax - cxp) * (py - cyp) - (ay - cyp) * (px - cxp)) * inv;
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) mask[y * hi + x] = 1;
      }
    }
  }

  // 면적평균 축소 → 커버리지 알파.
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  const n = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let sum = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        const row = (y * SUPERSAMPLE + sy) * hi + x * SUPERSAMPLE;
        for (let sx = 0; sx < SUPERSAMPLE; sx++) sum += mask[row + sx];
      }
      const o = (y * SIZE + x) * 4;
      // RGB 는 흰색으로 굳힌다 — 색은 런타임 tint 가 정한다(짙은 남색 본체 + 청록 림 사본).
      pixels[o] = 255;
      pixels[o + 1] = 255;
      pixels[o + 2] = 255;
      pixels[o + 3] = Math.round((sum / n) * 255);
    }
  }
  return { width: SIZE, height: SIZE, colorType: 6, channels: 4, pixels };
}

function main(argv) {
  const flag = (name, dflt) => {
    const i = argv.indexOf(`--${name}`);
    return i < 0 ? dflt : Number(argv[i + 1]);
  };
  const elevation = flag('elev', DEFAULT_ELEVATION);
  const yaw = flag('yaw', DEFAULT_YAW);
  const outDir = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : OUT_DIR;
  const files = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
  const targets =
    files.length > 0
      ? files
      : readdirSync(MODEL_DIR).filter((f) => f.startsWith('boss_') && f.endsWith('.glb'));
  if (targets.length === 0) throw new Error(`${MODEL_DIR} 에 boss_*.glb 가 없다`);
  mkdirSync(outDir, { recursive: true });
  console.log(`고도 ${elevation}° · 요 ${yaw}° → ${outDir}`);
  for (const file of targets.sort()) {
    const { json, bin } = parseGlb(readFileSync(join(MODEL_DIR, file)));
    const tris = collectTriangles(json, bin);
    const png = encodePng(rasterize(tris, elevation, yaw));
    const outName = `${file.replace(/\.glb$/, '')}_sil.png`;
    writeFileSync(join(outDir, outName), png);
    console.log(`${file}: 삼각형 ${tris.length} → ${outName} ${(png.length / 1024).toFixed(1)}KB`);
  }
}

main(process.argv.slice(2));
