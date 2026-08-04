/**
 * 타이틀 화면 3D 함선 — **`Stage3D` 와 별개의 전용 오프스크린 렌더러**.
 *
 * ## 왜 `Stage3D` 를 재사용하지 않는가
 * `stage3d.ts` 는 헤더에 설계 의도를 못 박아 두었다: *"슬롯을 표시 크기보다 **작게** 렌더하고
 * nearest 확대로 **움직이는 픽셀아트**를 만든다"*. 인게임 보스는 주변 픽셀 적·2D 배경과 톤이
 * 맞아야 하므로 그게 옳다.
 *
 * 타이틀은 정반대다. 페인터리 키아트 위에 놓이고 화면에서 큰 면적을 차지하므로 **고해상도
 * 스무스 렌더**여야 한다. 그 요구를 `Stage3D` 에 겸업시키면 고정 격자 아틀라스
 * (`SLOT_ORDER.length × SLOT_SIZE`)를 가변 해상도로 뜯어야 하고, 그 수술은 **인게임 보스
 * 렌더에 회귀 위험**을 만든다. 타이틀은 화면 하나뿐이고 sim 과 무관하므로 격리가 싸다.
 *
 * 대가는 WebGL 컨텍스트 하나 추가다. 브라우저 상한(보통 16)에 여유가 있고, 타이틀을 떠나면
 * {@link TitleShip3D.destroy} 로 즉시 반납한다.
 *
 * ## 룩 — 왜 툰 셰이딩인가
 * Meshy 산출 텍스처는 PBR 기반이라 그대로 두면 **사실적**이다. 배경은 손그림 페인터리라
 * 함선 1기만 다른 게임에서 온 것처럼 뜬다. 그래서 셋을 건다:
 *
 *  - **툰 머티리얼** — 연속 음영을 4단계로 계단화한다(`MeshToonMaterial` + 4px gradientMap).
 *  - **프레넬 림라이트** — 실루엣 가장자리에 청록 발광을 가산으로 얹는다. 배경 성운의 청록과
 *    같은 계열이라 함선이 장면 **안에** 있는 것처럼 붙는다.
 *  - **아웃라인 셸** — 법선 방향으로 살짝 부풀린 `BackSide` 검정 껍질. 페인터리 배경 위에서
 *    실루엣을 또렷하게 유지한다.
 *
 * ## 결정론(ADR-0005)
 * 전부 render-only 다. sim 을 읽지도 쓰지도 않고, 시간축은 sim 틱이 아니라 호출자가 넘기는
 * 벽시계 delta 다(연출 전용). 골든 해시와 무관하다.
 *
 * ## 폴백
 * WebGL 컨텍스트 실패·GLB 로드 실패면 {@link TitleShip3D.create} 가 **null** 을 돌려준다.
 * 호출자는 함선 없이 배경만 보여준다 — 3D 는 덧붙임이지 전제가 아니다.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CanvasSource, Texture } from 'pixi.js';

/** 오프스크린 렌더 해상도. 화면 표시 크기(≈620×410)보다 크게 잡아 확대 시 물러지지 않게 한다. */
const RENDER_W = 768;
const RENDER_H = 512;

/** 모델 파일명(원장 `assets/models/manifest.json` 의 `ship_title`). */
const MODEL_FILE = 'ship_title.glb';

/**
 * 모델 URL 글롭. `bossActor.ts` 와 같은 규약이다 — `?url` 이라 번들에는 해시 URL **문자열**만
 * 들어가고, 실제 GLB 전송은 아래 `GLTFLoader` 가 그 URL 을 fetch 할 때 처음 일어난다.
 * 즉 타이틀이 뜨는 첫 페인트는 이 1MB 를 기다리지 않는다.
 */
const MODEL_LOADERS = import.meta.glob('../../../assets/models/*.glb', {
  query: '?url',
  import: 'default',
}) as Record<string, () => Promise<string>>;

async function modelUrl(basename: string): Promise<string | undefined> {
  for (const key in MODEL_LOADERS) {
    if (key.endsWith(`/${basename}`)) return await MODEL_LOADERS[key]!();
  }
  return undefined;
}

/**
 * 툰 음영용 4단계 그라디언트 맵. 연속 램프를 nearest 로 샘플해 **계단**을 만든다 —
 * 값 사이의 간격이 그대로 음영 밴드의 폭이 된다.
 */
function toonGradient(): THREE.DataTexture {
  const steps = new Uint8Array([56, 118, 196, 255]);
  const tex = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 엔진 발광용 방사형 그라디언트 텍스처(64²).
 *
 * 가산 합성이라 **가장자리가 정확히 0 이어야** 한다 — 사각형 경계가 조금이라도 밝으면 화면에
 * 네모난 얼룩으로 드러난다. 그래서 중심 1 → 가장자리 0 인 램프를 굽고, 알파가 아니라 **밝기**로
 * 감쇠시킨다(가산에서는 검정이 곧 투명이다).
 */
function glowTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.28, 'rgba(190,246,255,0.75)');
  g.addColorStop(0.62, 'rgba(90,200,255,0.22)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/** 프레넬 림 셰이더 — 시선과 법선이 이루는 각이 클수록(가장자리일수록) 밝다. */
const RIM_VERT = `
varying vec3 vNormalView;
varying vec3 vPositionView;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormalView = normalize(normalMatrix * normal);
  vPositionView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const RIM_FRAG = `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uPower;
varying vec3 vNormalView;
varying vec3 vPositionView;
void main() {
  vec3 n = normalize(vNormalView);
  vec3 v = normalize(-vPositionView);
  float f = pow(1.0 - clamp(abs(dot(n, v)), 0.0, 1.0), uPower);
  gl_FragColor = vec4(uColor * f * uIntensity, f);
}
`;

/**
 * **기본 자세** — 연출 진동은 이 값을 중심으로 흔들린다.
 *
 * 타이틀이 원하는 그림은 **플레이어가 있는 자리에서 화면 안쪽 행성으로 날아가는 함선**이다.
 * 즉 카메라가 함선의 **뒤**에 있고, 기체는 좌우 대칭 뒷모습으로 멀어지며, 기수만 살짝 들려
 * 있어야 한다(사용자 확정, 2026-08-02).
 *
 * ⚠️ **요는 정확히 `−π/2` 여야 하고 다른 항을 더하면 안 된다.** 이 GLB 의 전방은 로컬 −x 라,
 * y 축으로 −90° 돌려야 전방이 화면 안쪽(−z)에 정렬돼 좌우 대칭 뒷모습이 나온다. 여기에
 * 3/4 뷰 시절의 보정값(0.62)이 남아 있어서 기체가 **늘 비스듬히 틀어져 있었다** — 화면에서는
 * "기수가 왼쪽을 본다"로 보였고, 스프라이트를 회전시켜 덮으려 하면 오히려 옆으로 누웠다.
 * 모델을 교체하면 이 값이 맞는지 화면으로 다시 확인해야 한다(코드만 봐서는 앞뒤를 모른다).
 *
 * ⚠️ 피치는 **부호가 그림을 뒤집는다.** three 의 기본 오일러 순서(XYZ)에서 `rotation.x` 는 요를
 * 먹인 뒤 **월드 x 축**(=화면 가로축)으로 도는 항이라, 뒷모습 구도에서는 그대로 화면상 기수의
 * 상하다. 기수가 −z 일 때 `Rx(a)` 는 그것을 `(0, sin a, −cos a)` 로 보내므로 **양수라야 기수가
 * 든다**. 음수였을 때는 행성이 위에 있는데 함선은 아래를 보고 있었다.
 *
 * 롤은 0 이다. 뒷모습의 값어치가 **좌우 대칭**인데 롤을 주면 그게 바로 깨진다.
 */
const BASE_YAW = -Math.PI / 2;
const BASE_PITCH = 0.30;
const BASE_ROLL = 0;

/** 연출 상수 — 진폭은 전부 라디안/모델 단위. 값을 키우면 프레임 밖으로 나가므로 여기서 관리한다. */
/**
 * ⚠️ 요 진폭은 **작아야 한다**. 뒤에서 보는 구도에서 요는 화면상 좌우 흔들림으로 나타나는데,
 * 0.30(±17°)이면 "행성으로 간다"가 아니라 "좌우로 표류한다"로 읽힌다(실측 — 스크린샷마다
 * 기수가 다른 쪽을 보고 있었고, 기본 자세가 틀린 줄 알았으나 진폭이 원인이었다).
 */
const YAW_AMPL = 0.085;
const YAW_PERIOD = 17;
const PITCH_AMPL = 0.05;
const PITCH_PERIOD = 11;
const ROLL_AMPL = 0.11;
const ROLL_PERIOD = 23;
const BOB_AMPL = 0.045; // 프레이밍 반경 대비 비율.
const BOB_PERIOD = 9;
const RIM_PULSE_PERIOD = 5.5;

/**
 * 엔진 발광 배치 — **바운딩 박스 반치수 대비 비율**이다. 절대 좌표로 적으면 모델을 바꿀 때
 * 발광만 허공에 남는다. 전방이 로컬 −x 이므로 후방(=노즐)은 +x 다.
 */
const ENGINE_AT = { back: 0.80, down: -0.16, side: 0.17 } as const;
/**
 * 불꽃 세기 배수 — **노즐 코어(여기)와 Pixi 코로나(`titleScreen.ts`)가 공유하는 단 하나의 손잡이**다.
 *
 * 둘을 따로 두면 한쪽만 올려 놓고 잊는다: 코어만 키우면 캔버스 경계에서 잘리고, 코로나만 키우면
 * 심지 없는 안개가 된다.
 *
 * 값 1.5 는 실화면 3안 비교로 골랐다(사용자 확정, 2026-08-04). ⚠️ **이 수치는 코로나를 함선
 * **앞**에 그린다는 전제와 한 몸이다.** 뒤에 그리던 시절에는 2.8 도 약해 보였는데, 앞으로
 * 옮기자 같은 2.8 이 함선을 통째로 흰 덩어리로 지웠다 — 합성 순서를 되돌리면 이 값도 다시
 * 골라야 한다.
 */
export const FLAME_STRENGTH = 1.5;
/**
 * 빌보드 지름(박스 세로 반치수 대비).
 *
 * ⚠️ 이 값을 무한정 키울 수 없다. 함선은 {@link RENDER_W}×{@link RENDER_H} 오프스크린 캔버스에
 * 그려지므로, 발광이 프러스텀을 넘으면 **네모난 단면**으로 잘린다(가산 합성이라 특히 눈에 띈다).
 * 넓게 번지는 몫은 캔버스 밖 Pixi 가산 레이어가 맡는다 — 여기는 심지만 담당한다.
 */
const ENGINE_GLOW_SIZE = 0.85 * FLAME_STRENGTH;
/**
 * 노즐 뒤 점광 — 선체 **후미만** 청록으로 물들여 "가동 중"을 만든다.
 *
 * ⚠️ 세기·거리를 키우면 기체 전체가 청록으로 덮여 **브론즈·금색이 죽는다**(실측 — 2.4 /
 * 반경×3 에서 선체가 통째로 물들었다). 이 발광의 값어치는 밝기가 아니라 **국소성**이다.
 */
const ENGINE_LIGHT_INTENSITY = 0.9;
/** 점광 감쇠 거리(바운딩 반경 대비). 짧을수록 후미에만 머문다. */
const ENGINE_LIGHT_RANGE = 0.85;
/** 발광 맥동 주기(초). 림 맥동과 **다른 주기**여야 둘이 한 덩어리로 뛰지 않는다. */
const ENGINE_PULSE_PERIOD = 2.3;

export class TitleShip3D {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly source: CanvasSource;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  /** 연출 트랜스폼은 전부 여기 건다 — 모델 원본 노드는 건드리지 않는다. */
  private readonly pivot = new THREE.Group();
  private readonly rimMaterials: THREE.ShaderMaterial[] = [];
  /** 프레이밍 반경(모델 바운딩 구). 상하 흔들림 진폭이 이 값에서 파생한다. */
  private radius = 1;
  /** 바운딩 박스 반치수. 엔진 발광 배치가 여기서 파생한다. */
  private readonly half = new THREE.Vector3(1, 1, 1);
  /** 노즐 빌보드(맥동 대상). */
  private readonly engineGlows: THREE.Sprite[] = [];
  /** 노즐 뒤 점광(맥동 대상). */
  private engineLight: THREE.PointLight | null = null;
  private time = 0;
  private disposed = false;
  /**
   * 직전 프레임의 연소 맥동값(≈0.48~1.17). Pixi 코로나가 **같은 값**을 읽어 크기·알파를 정한다 —
   * 두 계층이 각자 사인파를 돌리면 위상이 어긋나 불꽃이 둘로 보인다.
   */
  private burn = 1;

  /** 이 스프라이트에 물리면 된다. 매 {@link update} 마다 내용이 갱신된다. */
  readonly texture: Texture;

  /** {@link burn} 의 읽기 전용 창. 호출자는 이 값을 곱해 자기 계층을 맞춘다. */
  get flicker(): number {
    return this.burn;
  }

  /**
   * 노즐 둘의 **텍스처 중심 기준 픽셀 오프셋**. Pixi 코로나가 이 값으로 자리를 잡는다.
   *
   * ⚠️ 이 값을 손으로 상수에 적으면 안 된다. 실제로 두 번 틀렸다 — 처음엔 광채가 동체를 감싸
   * 역광처럼 보였고, 내려 보니 이번엔 함선 밑 조명이 됐다. 노즐의 화면 위치는 기본 자세
   * (요 −90°·피치 +0.30)와 매 프레임 흔들리는 요·피치·롤·상하 부유가 **전부 곱해진 결과**라,
   * 눈대중으로 맞출 수 있는 값이 아니다.
   *
   * 스프라이트가 이 텍스처를 그대로 배율만 바꿔 그리므로, 호출자는 여기에 스케일만 곱하면 된다.
   */
  nozzleOffsets(): { x: number; y: number }[] {
    this.camera.updateMatrixWorld();
    return this.engineGlows.map((g) => {
      const v = g.getWorldPosition(new THREE.Vector3()).project(this.camera);
      // NDC(-1..1) → 텍스처 픽셀. y 는 화면 아래가 +라 부호가 뒤집힌다.
      return { x: (v.x * RENDER_W) / 2, y: (-v.y * RENDER_H) / 2 };
    });
  }

  private constructor(renderer: THREE.WebGLRenderer, canvas: HTMLCanvasElement) {
    this.renderer = renderer;
    this.canvas = canvas;
    // ⚠️ **반드시 `CanvasSource`**. 베이스 `TextureSource` 로 감싸면 Pixi 가 업로드 방식을
    // 결정하지 못해 GPU 텍스처가 **경고 없이 빈 채로** 남는다(stage3d.ts 헤더의 실사례).
    this.source = new CanvasSource({ resource: canvas });
    this.texture = new Texture({ source: this.source });
    this.camera = new THREE.PerspectiveCamera(30, RENDER_W / RENDER_H, 0.1, 100);
    this.scene.add(this.pivot);
  }

  /**
   * 렌더러를 세우고 모델을 로드한다. 어느 단계든 실패하면 **null** — 호출자는 함선 없이
   * 배경만 보여준다.
   */
  static async create(): Promise<TitleShip3D | null> {
    if (typeof document === 'undefined') return null; // 노드(테스트) 환경.
    let ship: TitleShip3D;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = RENDER_W;
      canvas.height = RENDER_H;
      const renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true, // 배경 투명 — 키아트 위에 합성된다.
        antialias: true, // 보스 슬롯과 정반대다: 여기는 스무스가 목적이다(헤더 참조).
        premultipliedAlpha: false,
      });
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(1);
      ship = new TitleShip3D(renderer, canvas);
    } catch {
      return null; // 컨텍스트 소진·미지원.
    }

    try {
      const url = await modelUrl(MODEL_FILE);
      if (url === undefined) throw new Error(`${MODEL_FILE} 미등재`);
      const gltf = await new GLTFLoader().loadAsync(url);
      ship.adopt(gltf.scene);
      ship.light();
      return ship;
    } catch {
      ship.destroy();
      return null; // 모델 없이 3D 만 띄우면 빈 사각형이 된다 — 통째로 폴백한다.
    }
  }

  /** 모델을 받아 툰 머티리얼·아웃라인·림 셸을 입히고 카메라를 맞춘다. */
  private adopt(root: THREE.Object3D): void {
    const gradient = toonGradient();
    const rimShells: THREE.Mesh[] = [];
    const outlineShells: THREE.Mesh[] = [];

    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const src = obj.material;
      const base = Array.isArray(src) ? src[0] : src;
      const map = base instanceof THREE.MeshStandardMaterial ? base.map : null;

      obj.material = new THREE.MeshToonMaterial({ map, gradientMap: gradient });

      // 림 셸: 같은 지오메트리를 가산으로 한 겹 더 그린다. depthWrite 를 끄지 않으면
      // 자기 자신을 가려 가장자리 발광이 사라진다.
      const rimMat = new THREE.ShaderMaterial({
        vertexShader: RIM_VERT,
        fragmentShader: RIM_FRAG,
        uniforms: {
          uColor: { value: new THREE.Color(0x7fe6ff) },
          uIntensity: { value: 1.0 },
          uPower: { value: 2.6 },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this.rimMaterials.push(rimMat);
      const rim = new THREE.Mesh(obj.geometry, rimMat);
      rim.applyMatrix4(obj.matrixWorld);
      rimShells.push(rim);

      // 아웃라인 셸: 법선 방향으로 부풀린 뒷면. 페인터리 배경 위에서 실루엣을 유지한다.
      const outline = new THREE.Mesh(
        obj.geometry,
        new THREE.MeshBasicMaterial({ color: 0x0d1416, side: THREE.BackSide }),
      );
      outline.applyMatrix4(obj.matrixWorld);
      outline.scale.multiplyScalar(1.022);
      outlineShells.push(outline);
    });

    this.pivot.add(root);
    for (const m of outlineShells) this.pivot.add(m);
    for (const m of rimShells) this.pivot.add(m);
    this.frame(root);
    this.engines();
  }

  /**
   * 엔진 발광 — 노즐 자리에 가산 빌보드 둘 + 그 뒤 점광 하나.
   *
   * ⚠️ **스프라이트(2D) 좌표에 박으면 안 된다.** 기체는 매 프레임 미세하게 요·피치가 흔들리는데,
   * 화면 좌표에 고정하면 발광만 제자리에 남아 노즐에서 떨어져 나간다. 피벗의 자식으로 두면
   * 자세 변화가 그대로 따라온다.
   *
   * 빌보드(`THREE.Sprite`)를 쓰는 이유는 항상 카메라를 마주 보기 때문이다 — 평면 메시로 두면
   * 기체가 기울 때 발광이 타원으로 찌그러진다.
   */
  private engines(): void {
    const tex = glowTexture();
    if (tex === null) return;
    const size = this.half.y * ENGINE_GLOW_SIZE;
    for (const side of [-1, 1]) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        color: 0x9ff0ff,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      });
      const glow = new THREE.Sprite(mat);
      glow.scale.set(size, size, 1);
      glow.position.set(
        this.half.x * ENGINE_AT.back,
        this.half.y * ENGINE_AT.down,
        this.half.z * ENGINE_AT.side * side,
      );
      this.pivot.add(glow);
      this.engineGlows.push(glow);
    }
    // 점광은 노즐보다 조금 더 뒤에 둔다 — 선체 후미가 물들고 앞쪽은 키광이 유지된다.
    const light = new THREE.PointLight(0x6fe3ff, ENGINE_LIGHT_INTENSITY, this.radius * ENGINE_LIGHT_RANGE, 2);
    light.position.set(this.half.x * (ENGINE_AT.back + 0.25), this.half.y * ENGINE_AT.down, 0);
    this.pivot.add(light);
    this.engineLight = light;
  }

  /** 바운딩 구를 프러스텀 안에 넣고, 모델 원점을 피벗 중심으로 옮긴다. */
  private frame(root: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(root);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    this.radius = sphere.radius || 1;
    box.getSize(this.half).multiplyScalar(0.5);
    // 모델을 원점 중심으로 — 회전 연출이 무게중심을 축으로 돌아야 한다.
    root.position.sub(sphere.center);
    for (const child of this.pivot.children) {
      if (child !== root) child.position.sub(sphere.center);
    }
    // 세로 프러스텀이 더 좁으므로 세로 기준으로 거리를 잡고 여유(1.35)를 준다 — 자세 연출로
    // 실루엣이 기울어도 프레임에 닿지 않게.
    // ⚠️ 여유 1.6 은 **불꽃 예산**이다. 원래 1.35 였는데, 그 값에서는 노즐 발광을 키우는 순간
    // 프러스텀을 넘어 네모나게 잘렸다 — 세기 손잡이를 돌려도 화면이 안 변하는 원인의 절반이
    // 여기였다. 여유를 늘리면 함선이 작아지므로 `titleScreen.ts` 의 SHIP_SCALE 이 함께 커진다.
    const fov = (this.camera.fov * Math.PI) / 180;
    this.camera.position.set(0, 0, (this.radius / Math.sin(fov / 2)) * 1.6);
    this.camera.lookAt(0, 0, 0);
  }

  /** 배경 키아트의 광원 배치를 그대로 옮긴다 — 따뜻한 정면광 + 청록 역광. */
  private light(): void {
    // 키광: 아치 바닥에서 올라오는 금빛(키아트의 밝은 바닥과 같은 방향).
    // 밝기는 **배경 대비로** 정한다: 함선은 창 안 밝은 성운 앞에 놓이므로, 실내 조명 감각으로
    // 맞추면 실루엣만 남은 검은 덩어리가 된다(실측 — 어두워서 형태가 안 읽혔다).
    const key = new THREE.DirectionalLight(0xffd9a0, 2.9);
    key.position.set(-0.6, -0.35, 1);
    this.scene.add(key);
    // 역광: 창 너머 성운의 청록. 실루엣 위쪽 가장자리를 살린다.
    const back = new THREE.DirectionalLight(0x74e0ff, 1.8);
    back.position.set(0.5, 0.9, -1);
    this.scene.add(back);
    // 환경광: 위는 성운 청록, 아래는 유적의 짙은 갈색.
    this.scene.add(new THREE.HemisphereLight(0x3d8894, 0x352a1e, 1.3));
  }

  /**
   * 연출을 진행하고 한 프레임 그린다. `dt` 는 **벽시계 초**다(sim 틱 아님 — 연출 전용).
   *
   * 호출자가 화면에 없을 때 부르지 않으면 GPU 비용이 0 이다.
   */
  update(dt: number): void {
    if (this.disposed) return;
    this.time += dt;
    const t = this.time;

    // 세 축을 **서로 다른 주기**로 돌린다. 주기가 정수배로 맞으면 왕복이 눈에 띄어 기계적으로
    // 보이므로 17/11/23(서로소)으로 잡았다.
    this.pivot.rotation.y = BASE_YAW + Math.sin((t / YAW_PERIOD) * Math.PI * 2) * YAW_AMPL;
    this.pivot.rotation.x = BASE_PITCH + Math.sin((t / PITCH_PERIOD) * Math.PI * 2) * PITCH_AMPL;
    this.pivot.rotation.z = BASE_ROLL + Math.sin((t / ROLL_PERIOD) * Math.PI * 2) * ROLL_AMPL;
    this.pivot.position.y = Math.sin((t / BOB_PERIOD) * Math.PI * 2) * this.radius * BOB_AMPL;

    // 림 발광 맥동 — 엔진이 숨 쉬는 것처럼 보이게 한다.
    const pulse = 0.85 + 0.35 * Math.sin((t / RIM_PULSE_PERIOD) * Math.PI * 2);
    for (const m of this.rimMaterials) {
      (m.uniforms['uIntensity'] as { value: number }).value = pulse;
    }

    // 엔진 맥동 — 림보다 **빠르게** 뛴다. 같은 주기로 두면 기체 전체가 한 덩어리로 숨 쉬어
    // 엔진이 따로 가동 중이라는 느낌이 사라진다. 진폭도 더 크다(연소는 불규칙하다).
    const burn = 0.78 + 0.30 * Math.sin((t / ENGINE_PULSE_PERIOD) * Math.PI * 2);
    // 두 배 주기의 작은 흔들림을 얹어 맥동이 기계적인 사인파로 읽히지 않게 한다.
    const flicker = burn + 0.09 * Math.sin((t / (ENGINE_PULSE_PERIOD * 0.37)) * Math.PI * 2);
    this.burn = flicker;
    const glowSize = this.half.y * ENGINE_GLOW_SIZE * flicker;
    for (const g of this.engineGlows) {
      g.scale.set(glowSize, glowSize, 1);
      (g.material as THREE.SpriteMaterial).opacity = Math.min(1, flicker);
    }
    if (this.engineLight !== null) this.engineLight.intensity = ENGINE_LIGHT_INTENSITY * flicker;

    this.renderer.render(this.scene, this.camera);
    // three 가 캔버스를 갱신했음을 Pixi 에 알린다 — 없으면 첫 프레임만 올라간다.
    this.source.update();
  }

  /** WebGL 컨텍스트와 GPU 자원을 반납한다. 타이틀을 떠날 때 부른다. */
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) m.dispose();
    });
    this.texture.destroy();
    this.source.destroy();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}
