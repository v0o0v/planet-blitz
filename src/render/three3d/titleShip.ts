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
 * 0 으로 두면 GLB 가 태어난 방향 그대로라 이 모델은 거의 **정측면**으로 보인다. 화면에서
 * 얇은 조각으로 읽혀 3D 인지조차 알기 어려웠다(실측). 요를 돌려 기수를 화면 안쪽으로 틀고
 * 피치를 내려 윗면을 보이면 부피가 살아난다 — 3/4 뷰가 실루엣 정보량이 가장 큰 각도다.
 */
const BASE_YAW = 0.62;
const BASE_PITCH = -0.34;
const BASE_ROLL = 0.08;

/** 연출 상수 — 진폭은 전부 라디안/모델 단위. 값을 키우면 프레임 밖으로 나가므로 여기서 관리한다. */
const YAW_AMPL = 0.30;
const YAW_PERIOD = 17;
const PITCH_AMPL = 0.09;
const PITCH_PERIOD = 11;
const ROLL_AMPL = 0.11;
const ROLL_PERIOD = 23;
const BOB_AMPL = 0.045; // 프레이밍 반경 대비 비율.
const BOB_PERIOD = 9;
const RIM_PULSE_PERIOD = 5.5;

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
  private time = 0;
  private disposed = false;

  /** 이 스프라이트에 물리면 된다. 매 {@link update} 마다 내용이 갱신된다. */
  readonly texture: Texture;

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
  }

  /** 바운딩 구를 프러스텀 안에 넣고, 모델 원점을 피벗 중심으로 옮긴다. */
  private frame(root: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(root);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    this.radius = sphere.radius || 1;
    // 모델을 원점 중심으로 — 회전 연출이 무게중심을 축으로 돌아야 한다.
    root.position.sub(sphere.center);
    for (const child of this.pivot.children) {
      if (child !== root) child.position.sub(sphere.center);
    }
    // 세로 프러스텀이 더 좁으므로 세로 기준으로 거리를 잡고 여유(1.35)를 준다 — 자세 연출로
    // 실루엣이 기울어도 프레임에 닿지 않게.
    const fov = (this.camera.fov * Math.PI) / 180;
    this.camera.position.set(0, 0, (this.radius / Math.sin(fov / 2)) * 1.35);
    this.camera.lookAt(0, 0, 0);
  }

  /** 배경 키아트의 광원 배치를 그대로 옮긴다 — 따뜻한 정면광 + 청록 역광. */
  private light(): void {
    // 키광: 아치 바닥에서 올라오는 금빛(키아트의 밝은 바닥과 같은 방향).
    const key = new THREE.DirectionalLight(0xffd9a0, 2.1);
    key.position.set(-0.6, -0.35, 1);
    this.scene.add(key);
    // 역광: 창 너머 성운의 청록. 실루엣 위쪽 가장자리를 살린다.
    const back = new THREE.DirectionalLight(0x74e0ff, 1.5);
    back.position.set(0.5, 0.9, -1);
    this.scene.add(back);
    // 환경광: 위는 성운 청록, 아래는 유적의 짙은 갈색.
    this.scene.add(new THREE.HemisphereLight(0x2c6c78, 0x2a2118, 0.9));
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
