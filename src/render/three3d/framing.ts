/**
 * 3D 액터 공용 **프레이밍** — 직교 카메라 프러스텀을 모델의 **투영 실루엣**에 맞춘다.
 *
 * 보스({@link file://./bossActor.ts})와 플레이어 기체({@link file://./shipActor.ts})가 같은
 * 규율을 쓴다. 액터마다 따로 두면 한쪽만 고쳐지고 다른 쪽이 조용히 낡는다 — 실제로 이 함수는
 * 보스 레인에서 **한 번 크게 틀렸다가** 고쳐진 자리라(아래 ⚠️) 두 번 갈라지면 안 된다.
 */

import * as THREE from 'three';

/**
 * 카메라 프러스텀을 **투영 실측**으로 모델에 맞추고, 프러스텀 **반폭**을 돌려준다.
 * 그 반폭이 곧 액터 모션의 길이 단위다(프레이밍을 바꿔도 연출의 화면상 크기가 안 변한다).
 *
 * ⚠️ 처음에는 모델을 "최대 치수 1" 로 정규화한 뒤 반폭을 상수(0.72)로 뒀는데, 그러면 화면에서
 * 보스가 기존 2D 스프라이트의 **면적 대비 1/3.5 로 작게** 나왔다(실측: 슬롯 점유 18.1% vs
 * `boss.png` 62.6%). 어두운 배경에 작게 박히니 사용자 눈에는 보스가 아예 안 보였다(신고 2026-07-30).
 *
 * 원인은 바운딩박스 최대 치수가 **화면에 보이는 크기가 아니라는** 것이다 — 기울여 내려다보면
 * 세로로 긴 모델의 투영 실루엣은 박스 대각선보다 훨씬 작다. 그래서 박스 8모서리를 카메라 공간으로
 * 투영해 실제 x/y 범위를 재고, 그 범위에 프러스텀을 맞춘다. 모델 비율이 어떻든 화면을 채운다.
 *
 * @param camera 맞출 직교 카메라(위치·`lookAt` 은 호출 전에 확정돼 있어야 한다).
 * @param object 프레이밍 대상(액터의 피벗).
 * @param margin 여유 배수(1 = 실루엣에 딱 맞춤). 연출이 모델을 움직이므로 1 보다 커야 한다.
 * @returns 프러스텀 반폭.
 */
export function fitOrthoToObject(
  camera: THREE.OrthographicCamera,
  object: THREE.Object3D,
  margin: number,
): number {
  const box = new THREE.Box3().setFromObject(object);
  camera.updateMatrixWorld();
  const toCamera = new THREE.Matrix4().copy(camera.matrixWorld).invert();
  const v = new THREE.Vector3();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        v.set(x, y, z).applyMatrix4(toCamera);
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
      }
    }
  }
  const half = (Math.max(maxX - minX, maxY - minY) / 2) * margin;
  camera.left = -half;
  camera.right = half;
  camera.top = half;
  camera.bottom = -half;
  // 투영 중심을 슬롯 중앙에 맞춘다(카메라 로컬 평행이동 = 뷰 창 이동).
  camera.translateX((minX + maxX) / 2);
  camera.translateY((minY + maxY) / 2);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return half;
}

/**
 * GLB 루트를 **중심 정렬 + 최대 치수 1** 로 정규화해 담은 그룹을 만든다. 모든 액터가 같은
 * 길이 단위(모델 최대 치수 = 1)를 쓰게 하는 자리다 — 모션 상수가 모델 크기에 안 휘둘린다.
 *
 * @param root  GLTF 씬.
 * @param orient 모델 고유 자세 보정(Euler XYZ, rad). Meshy 출력의 축이 게임 규약(**기수 +X ·
 *   위 +Y**)과 다를 때 여기서 한 번만 돌린다. 액터의 연출 회전과 섞이지 않도록 **정규화 그룹
 *   안쪽**에 걸어야 한다(피벗에 걸면 연출 회전이 자세 보정을 계속 덮어쓴다).
 */
export function normalizeModel(root: THREE.Object3D, orient?: THREE.Euler): THREE.Group {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  root.position.sub(center);
  const norm = new THREE.Group();
  norm.add(root);
  norm.scale.setScalar(1 / maxDim);
  if (orient !== undefined) norm.rotation.copy(orient);
  return norm;
}

/**
 * 재질의 **베이스컬러를 그대로 발광 맵으로 재사용**하고, 발광 세기를 조절할 수 있는 재질 목록을
 * 돌려준다. Meshy refine 을 `remove_lighting: true` 로 뽑아 텍스처에 하이라이트가 구워져 있지
 * 않으므로, 세기를 올리면 텍스처가 **자기 색으로** 달아오른다 — 액터 연출의 주 레버가 이것이다.
 */
export function collectEmissive(
  root: THREE.Object3D,
  baseIntensity: number,
): THREE.MeshStandardMaterial[] {
  const out: THREE.MeshStandardMaterial[] = [];
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (m instanceof THREE.MeshStandardMaterial) {
        m.emissiveMap = m.map;
        m.emissive = new THREE.Color(0xffffff);
        m.emissiveIntensity = baseIntensity;
        out.push(m);
      }
    }
  });
  return out;
}

/**
 * **뒷면 아웃라인 셸** — 모델을 살짝 키운 복제를 `BackSide` 로 그려 실루엣 둘레에 잉크선을 남긴다.
 *
 * ## 왜 필요한가
 * 이 게임의 스프라이트는 전부 **어두운 외곽선**을 가진 픽셀아트다. 3D 렌더에는 그 선이 없어서,
 * 같은 텍셀 밀도로 그려도 나란히 두면 3D 쪽만 **물러 보인다**(사용자 신고 2026-07-30 "흐릿하다").
 * 텍스처 해상도나 필터링으로는 해결되지 않는다 — 없는 것은 해상도가 아니라 **경계선**이다.
 *
 * ## 왜 후처리(엣지 검출)가 아니라 셸인가
 * 후처리는 전체화면 패스가 하나 더 필요하고, 이 무대는 슬롯을 scissor 로 나눠 쓰는 구조라 패스를
 * 슬롯별로 쪼개야 한다. 셸은 드로 콜 하나로 끝나고 슬롯 구조를 건드리지 않는다. 대가는 **닫힌
 * 메시 전제**인데(열린 면에서는 안쪽이 비친다) Meshy 출력은 닫혀 있다.
 *
 * 굵기는 모델 단위(최대 치수 = 1) 배율이라 슬롯 해상도가 바뀌어도 화면상 굵기가 비율로 따라간다.
 */
export function buildOutlineShell(
  source: THREE.Object3D,
  thickness: number,
  color: number,
): THREE.Object3D {
  // ⚠️ geometry 는 **공유**한다(복제 금지) — 아웃라인은 같은 형상을 뒤집어 그리는 것뿐이고,
  // 복제하면 정점 버퍼가 두 배가 되면서 `disposeSubtree` 가 원본까지 두 번 해제하게 된다.
  const shell = source.clone(true);
  shell.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.material = new THREE.MeshBasicMaterial({
      color,
      side: THREE.BackSide,
      // 깊이 기록은 하되 톤 매핑·안개는 받지 않는다 — 선은 조명 상태와 무관하게 같은 값이어야
      // 실루엣이 일정하게 읽힌다.
      fog: false,
      toneMapped: false,
    });
  });
  shell.scale.multiplyScalar(1 + thickness);
  return shell;
}

/**
 * 액터의 GPU 자원을 회수한다. three 의 geometry/material/texture 는 GC 대상이 아니라 명시
 * `dispose()` 로만 GPU 에서 내려간다 — 모델을 갈아 끼우는 경로가 있으면 그대로 누적된다.
 *
 * 같은 텍스처를 여러 재질이 공유하므로(베이스컬러가 emissiveMap 으로도 쓰인다) 모아서 한 번만 푼다.
 */
export function disposeSubtree(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>();
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.geometry.dispose();
    for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) {
      if (!(m instanceof THREE.Material)) continue;
      for (const value of Object.values(m)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
      m.dispose();
    }
  });
  for (const t of textures) t.dispose();
}

/**
 * `assets/models/*.glb` 지연 URL 로더 — 액터가 **자기 모델 하나만** 내려받게 한다.
 *
 * ⚠️ 실측 주의: `query: '?url'` 글롭은 eager 여도 **GLB 바이너리를 내려받지 않는다** — 번들에
 * 들어가는 것은 해시된 URL **문자열**뿐이고, 실제 전송은 `GLTFLoader` 가 그 URL 을 fetch 할 때
 * 처음 일어난다. 그럼에도 지연을 택한 이유는 **자산 수가 늘어나도 3D 청크 크기가 상수로 유지**
 * 되기 때문이다(보스 6종 + 기체 7종이 전부 여기를 지난다).
 */
const MODEL_LOADERS = import.meta.glob('../../../assets/models/*.glb', {
  query: '?url',
  import: 'default',
}) as Record<string, () => Promise<string>>;

/** `basename` 에 해당하는 GLB 의 번들 URL. 없으면 undefined(호출자는 2D 폴백). */
export async function modelUrl(basename: string): Promise<string | undefined> {
  for (const key in MODEL_LOADERS) {
    if (key.endsWith(`/${basename}`)) return await MODEL_LOADERS[key]!();
  }
  return undefined;
}
