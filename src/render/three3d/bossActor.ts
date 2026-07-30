/**
 * 보스 3D 액터 — **페이즈별로 다른 연출**을 재생한다.
 *
 * ── 왜 스켈레톤 애니메이션이 아닌가 ──
 * Meshy 의 리깅(`meshy_rig`)은 휴머노이드 전제(t-pose, height_meters 1.7)이고 커스텀 동작은
 * 정수 `action_id` 로 고르는 사전 정의 카탈로그(dancing/jumping/fighting…)다. 카르곤 보스는
 * **용암 요새 메카**라 스켈레톤이 의미가 없고, 우리가 원하는 연출(페이즈 전환·과열·붕괴)은
 * 애초에 그 카탈로그에 없다. 그래서 Meshy 는 **메시만** 주고, 연출은 여기서 트랜스폼 +
 * 발광(emissive)으로 저작한다. 게임 상태와 1:1 로 붙일 수 있고 리깅 비용도 들지 않는다.
 *
 * ── 상태 ──
 * sim 의 보스는 phase 0/1/2 를 가지고(HP 70%/35% 임계, `src/sim/boss.ts`), 임계를 넘을 때
 * 120틱(2초) 프리즈 전환에 들어가며, 시그니처 캐스트 뒤 과열 창(피해 2배)이 열린다.
 * 이 셋이 그대로 연출 상태가 된다:
 *
 *   phase 0  잔잔한 부유 — 아직 여유가 있다
 *   phase 1  빠른 맥동 + 전방 기울임 — 공격적으로 전환
 *   phase 2  격렬한 진동 + 강한 발광 + 크기 맥동 — 폭주 직전
 *   전환     상승 + 고속 스핀 + 발광 폭발(2초) — 프리즈와 화면 정리에 얹히는 연출
 *   과열     붉은 고주파 펄스 — 지금 때리라는 신호(피해 2배 창)
 *
 * 과열은 페이즈 위에 **덧씌워진다**(직교) — 페이즈별 기본 거동을 유지한 채 발광만 올라탄다.
 *
 * ── 결정론 ── render-only. 스냅샷을 읽기만 하고 sim 에 쓰지 않는다(골든 해시 불변).
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SLOT_SIZE, type Stage3D } from './stage3d.js';

/** 렌더러가 넘기는 보스 연출 상태(전부 스냅샷 파생). */
export interface BossVisualState {
  /** sim 페이즈 0/1/2. 범위 밖은 방어적으로 0 취급. */
  phase: number;
  /** 페이즈 전환 애니메이션 중(스냅샷 `flash` = `boss.timer > 0`). */
  transitioning: boolean;
  /** 과열 창(스냅샷 `active` = `boss.iframes > 0`) — 피해 2배. */
  overheated: boolean;
}

/**
 * 한 프레임의 피벗 변환 + 발광. 모든 연출이 이 한 구조로 수렴하므로, 페이즈 모션과
 * 오버레이(전환·과열)를 서로 모르는 채로 합성할 수 있다. 길이 단위는 **모델 최대 치수 = 1**.
 */
interface Motion {
  /** 좌우 이동(모델 단위). */
  x: number;
  /** 상하 이동(모델 단위). */
  y: number;
  /** 좌우 회전(rad). */
  yaw: number;
  /** 앞뒤 기울임(rad) — 양수 = 앞으로 숙임. */
  pitch: number;
  /** 좌우 기울임(rad) — 무게 이동을 읽히게 하는 축. */
  roll: number;
  /** 크기 배율(1 = 원래 크기). */
  scale: number;
  /** 용암 발광 세기. */
  emissive: number;
}

/** 초 → 라디안(주파수 Hz 의 사인파 위상). */
function osc(t: number, hz: number): number {
  return Math.sin(t * hz * Math.PI * 2);
}

/**
 * ── 페이즈별 모션은 **진폭이 아니라 형태가 다르다** ──
 *
 * 처음에는 하나의 모션 템플릿(부유 + 좌우 요동 + 기울임)에 페이즈마다 진폭만 키웠는데,
 * 그러면 셋이 "같은 동작을 세게 한 것"으로만 읽혀 구분이 안 된다(사용자 지적 2026-07-30).
 * 그래서 페이즈마다 **쓰는 축과 파형 자체를 다르게** 한다:
 *
 *   phase 0  상하 호흡만    — 좌우 축을 아예 안 쓴다. 느린 부유 + 역위상 크기 호흡 +
 *                             거의 멈춘 듯한 요 드리프트. "가만히 내려다보는" 무게감.
 *   phase 1  좌우 무게 이동 — 상하 부유를 버리고 x 이동 + **롤**(기울며 체중 싣기) 조합.
 *                             정류 사인(|sin|)으로 발 딛는 리듬을 만들어 파형부터 다르다.
 *   phase 2  폭주           — 진동이 아니라 **한 방향 회전 드리프트** + 비정수비 지터·맥동.
 *                             주기가 안 맞아떨어져 "제어를 잃은" 느낌이 난다.
 *
 * 세 함수가 서로 다른 축을 주로 쓰기 때문에(0=y / 1=x·roll / 2=yaw 누적) 실루엣이 겹치지 않는다.
 */

/** phase 0 — 상하 호흡. 좌우 축 미사용. */
function phase0Motion(t: number): Motion {
  const breathHz = 0.55;
  return {
    x: 0,
    // 부유와 크기 호흡을 **역위상**으로 둔다(위로 뜰 때 살짝 수축) — 같은 위상이면
    // 통통 튀는 공처럼 보이고, 어긋나야 숨 쉬는 덩어리로 읽힌다.
    y: osc(t, breathHz) * 0.045,
    yaw: osc(t, 0.07) * 0.25, // 거의 멈춘 드리프트 — 천천히 노려보는 느낌.
    pitch: 0,
    roll: 0,
    scale: 1 + Math.sin(t * breathHz * Math.PI * 2 + Math.PI / 2) * 0.018,
    emissive: 0.5,
  };
}

/** phase 1 — 좌우 무게 이동. 상하 부유 미사용. */
function phase1Motion(t: number): Motion {
  const stepHz = 0.85;
  const s = osc(t, stepHz);
  return {
    // 프레임을 꽉 채우므로(FRAME_MARGIN 1.10) 가로 여유가 약 0.09 뿐이다 — 이동은 그 안에
    // 묶고, 부족한 무게감은 아래 roll 로 낸다(기울기는 프레임을 거의 안 먹는다).
    x: s * 0.06,
    // 정류 사인 = 주파수 2배의 비대칭 파형. 좌우 어느 쪽으로 딛든 몸이 한 번 눌린다.
    y: -Math.abs(s) * 0.03,
    yaw: s * 0.06,
    pitch: 0.13, // 고정된 전방 기울임 — 자세 자체가 공격적이다.
    roll: -s * 0.26, // 이동 방향으로 기울며 체중을 싣는다 — 좌우 이동의 몫까지 여기서 낸다.
    scale: 1,
    emissive: 1.0,
  };
}

/** phase 2 — 폭주. 왕복이 아니라 누적 회전 + 비정수비 흔들림. */
function phase2Motion(t: number): Motion {
  return {
    // 두 주파수가 무리수 비라 패턴이 반복되지 않는다 → 기계적이지 않고 불안정하게 읽힌다.
    x: Math.sin(t * 47.3) * 0.014,
    y: Math.sin(t * 61.7) * 0.014,
    yaw: t * 0.9 + osc(t, 2.6) * 0.1, // 한 방향으로 계속 도는 드리프트 + 고주파 떨림.
    pitch: 0.2 + osc(t, 3.1) * 0.09,
    roll: osc(t, 2.3) * 0.14,
    scale: 1 + osc(t, 3.7) * 0.02 + osc(t, 5.9) * 0.015,
    emissive: 1.7 + osc(t, 4.3) * 0.35,
  };
}

/**
 * 전환 연출 — **3박자**로 실루엣 자체가 시간에 따라 바뀐다.
 *
 * 처음에는 "상승 + 스핀 + 발광"을 통째로 sin 반주기에 태웠는데, 그러면 2초 내내 같은 동작이
 * 크기만 오르내려 페이즈 idle 과 구분이 잘 안 됐다. 대신 서로 다른 세 동작을 이어 붙인다:
 *
 *   ① 충전 (0~35%)   수축하며 진동 축적 — 아래로 눌리고 떨림이 커진다. "빨아들이는" 예비 동작.
 *   ② 도약 (35~70%)  급상승 + 가속 스핀 + 발광 폭발. 화면에서 가장 큰 변화.
 *   ③ 착지 (70~100%) 낙하 후 스쿼시. 바닥을 치고 한 번 눌렸다 돌아온다.
 *
 * 예비 → 실행 → 여파의 고전적 3박자라, 같은 2초여도 "한 사건"으로 읽힌다.
 */
const TRANSITION_SECONDS = 2;

/** 전환 3박자를 기본 모션 위에 덮어쓴다. `p` 는 0→1 진행도. */
function applyTransition(m: Motion, p: number, t: number): void {
  if (p < 0.35) {
    // ① 충전 — 수축·하강하며 떨림이 커진다.
    const u = p / 0.35;
    m.scale *= 1 - 0.08 * u;
    m.y -= 0.04 * u;
    m.x += Math.sin(t * 71) * 0.025 * u; // 진동은 진행도에 비례해 커진다(축적감).
    m.pitch *= 1 - u;
    m.roll *= 1 - u;
    m.emissive += 1.2 * u;
  } else if (p < 0.7) {
    // ② 도약 — 급상승 + 가속 스핀 + 발광 폭발.
    const u = (p - 0.35) / 0.35;
    m.y += TRANSITION_RISE * Math.sin((u * Math.PI) / 2); // 빠르게 올라 정점에서 완만해진다.
    m.yaw += u * u * 11; // 제곱 = 가속하는 스핀.
    m.scale *= 0.94 + 0.1 * u;
    m.pitch = 0;
    m.roll = 0;
    m.emissive += 1.2 + 2.2 * u;
  } else {
    // ③ 착지 — 낙하 후 스쿼시. 감속 없이 떨어져야 충격이 읽힌다.
    const u = (p - 0.7) / 0.3;
    m.y += TRANSITION_RISE * (1 - u * u); // 제곱 = 가속하는 낙하.
    m.yaw += 11;
    // 마지막 15% 구간에서 한 번 납작해졌다 돌아온다(여파).
    const squash = u > 0.85 ? Math.sin(((u - 0.85) / 0.15) * Math.PI) : 0;
    m.scale *= 1.04 - 0.04 * u + squash * 0.1;
    m.emissive += 3.4 * (1 - u);
  }
}

/**
 * 과열 — 페이즈와 **직교**로 덧씌운다(페이즈별 기본 거동은 그대로 살아 있다).
 * 발광만 올리면 화면이 밝아질 뿐 "부풀어 터질 것 같다"가 안 읽혀서, 같은 위상으로
 * 크기 팽창과 뒤로 젖히는 압력을 함께 싣는다.
 */
function applyOverheat(m: Motion, t: number): void {
  const swell = 0.5 + 0.5 * osc(t, 2.4);
  m.scale *= 1 + 0.035 * swell;
  m.pitch -= 0.05 * swell; // 내압에 밀려 뒤로 젖혀진다.
  m.emissive += 1.0 + 0.8 * osc(t, 2.9);
}

/** 카메라 틸트(수평에서의 각도). 90°=완전 수직 내려보기. 기존 보스 아트의 프레이밍에 맞춘 값. */
const CAMERA_TILT_RAD = (62 * Math.PI) / 180;

/**
 * 프러스텀 여유(1 = 실루엣에 딱 맞춤). 연출이 모델을 움직이므로 여유가 없으면 프레임 밖으로
 * 잘린다.
 *
 * **실측으로 정했다** — 기존 `boss.png` 는 텍스처의 92% 폭을 채운다. margin 을 훑어 보면
 * 1.01→97%(잘림) · 1.10→90%(잘림 없음) · 1.20→84% · 1.30→77% 라, 1.10 이 "기존 스프라이트와
 * 같은 존재감 + idle 잘림 0" 의 경계다. 이 값을 키우면 화면에서 보스가 작아져 배경에 묻힌다
 * (1.3 일 때 실제로 그랬고 사용자가 "보스가 안 보인다"고 신고했다).
 */
const FRAME_MARGIN = 1.1;

/**
 * 전환 도약의 상승 높이(프러스텀 반폭 배수). margin 1.10 에서 모델 위 여유는 약 0.26 이라
 * 크기 맥동까지 감안하면 이 값이 상한이다 — 더 키우면 도약 정점에서 머리가 잘린다.
 */
const TRANSITION_RISE = 0.18;

/** GLB 자산 URL(있는 파일만 잡힌다 — 없으면 3D 액터가 생성되지 않고 2D 폴백). */
const MODEL_URLS = import.meta.glob('../../../assets/models/*.glb', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function modelUrl(basename: string): string | undefined {
  for (const key in MODEL_URLS) {
    if (key.endsWith(`/${basename}`)) return MODEL_URLS[key];
  }
  return undefined;
}

/**
 * 보스 3D 액터. `load()` 가 성공한 뒤에만 무대에 mount 되고, 그 전까지 호출자는
 * 기존 PNG 스프라이트를 계속 쓴다(로딩이 화면을 비우지 않는다).
 */
export class BossActor {
  private readonly stage: Stage3D;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  /** 모델을 담는 피벗 — 연출 트랜스폼은 전부 여기에 건다(모델 원본은 안 건드린다). */
  private readonly pivot = new THREE.Group();
  private readonly emissiveMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly coreLight: THREE.PointLight;
  private ready = false;
  /**
   * 이동 연출의 길이 단위 = 프러스텀 반폭({@link fitCamera} 가 정한다). 모션 함수들이 쓰는
   * x/y 값은 이 단위의 배수라, 카메라 프레이밍을 바꿔도 연출의 **화면상 크기**가 변하지 않는다.
   */
  private unit = 1;
  /** 연출 시계(초). 벽시계 누적 — sim 틱과 무관하다. */
  private clock = 0;
  /** 전환 연출 잔여(초). `transitioning` 상승 에지에서 채운다. */
  private transitionLeft = 0;
  private wasTransitioning = false;

  constructor(stage: Stage3D) {
    this.stage = stage;

    // 직교 카메라 — 탑다운 게임의 원근 없는 프레이밍(스프라이트와 같은 규율).
    // 프러스텀은 여기서 임시값이고, 모델 로드 후 {@link fitCamera} 가 **투영 실측**으로 다시 잡는다.
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
    const d = 6;
    this.camera.position.set(
      0,
      d * Math.sin(CAMERA_TILT_RAD),
      d * Math.cos(CAMERA_TILT_RAD),
    );
    this.camera.lookAt(0, 0, 0);

    // 조명: 위에서 내리는 키 + 채움 + 용암 코어의 주황 점광(아래에서 올려 비춘다).
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xfff0e0, 1.7);
    key.position.set(0.6, 1.6, 0.9);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.5);
    rim.position.set(-1, 0.4, -1);
    this.scene.add(rim);
    this.coreLight = new THREE.PointLight(0xff6a1a, 2.2, 4, 2);
    this.coreLight.position.set(0, -0.15, 0.1);
    this.scene.add(this.coreLight);

    this.scene.add(this.pivot);
  }

  /** 모델이 준비되어 3D 텍스처를 써도 되는가. false 면 호출자는 2D 폴백. */
  get isReady(): boolean {
    return this.ready;
  }

  /**
   * GLB 를 읽어 정규화(중심 정렬 + 최대 치수 1)하고 무대에 mount 한다.
   * 파일이 없거나 파싱에 실패하면 조용히 false — 2D 스프라이트가 그대로 남는다.
   */
  async load(basename: string): Promise<boolean> {
    const url = modelUrl(basename);
    if (url === undefined) return false;
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      const root = gltf.scene;

      // 정규화: 바운딩박스 중심을 원점으로, 최대 치수를 1 로.
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      root.position.sub(center);
      const norm = new THREE.Group();
      norm.add(root);
      norm.scale.setScalar(1 / maxDim);
      this.pivot.add(norm);

      // 베이스 컬러를 그대로 발광 맵으로 재사용한다. Meshy refine 을 `remove_lighting: true`
      // 로 뽑아 텍스처에 하이라이트가 구워져 있지 않으므로, 발광 세기를 올리면 용암 균열이
      // 실제로 달아오르는 것처럼 보인다 — 페이즈 연출의 주 레버가 이것이다.
      root.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (m instanceof THREE.MeshStandardMaterial) {
            m.emissiveMap = m.map;
            m.emissive = new THREE.Color(0xffffff);
            m.emissiveIntensity = phase0Motion(0).emissive;
            this.emissiveMaterials.push(m);
          }
        }
      });

      this.fitCamera();
      this.stage.mount('boss', this.scene, this.camera);
      this.ready = true;
      return true;
    } catch {
      return false; // 손상된 자산이 게임을 막지 않는다.
    }
  }

  /**
   * 카메라 프러스텀을 **투영 실측**으로 모델에 맞춘다.
   *
   * ⚠️ 처음에는 모델을 "최대 치수 1" 로 정규화한 뒤 프러스텀 반폭을 상수(0.72)로 뒀는데,
   * 그러면 화면에서 보스가 기존 2D 스프라이트의 **면적 대비 1/3.5 로 작게** 나온다
   * (실측: 슬롯 점유 18.1% vs `boss.png` 62.6%). 어두운 배경에 작게 박히니 사용자 눈에는
   * 보스가 아예 안 보였다(신고 2026-07-30).
   *
   * 원인은 바운딩박스 최대 치수가 **화면에 보이는 크기가 아니라는** 것이다 — 62° 로 내려다보면
   * 세로로 긴 메카의 투영 실루엣은 박스 대각선보다 훨씬 작다. 그래서 박스 8모서리를 카메라
   * 공간으로 투영해 실제 x/y 범위를 재고, 그 범위에 프러스텀을 맞춘다. 모델 비율이 어떻든
   * 화면을 채우므로 다음 모델(플레이어 기체)에도 그대로 통한다.
   */
  private fitCamera(): void {
    const box = new THREE.Box3().setFromObject(this.pivot);
    this.camera.updateMatrixWorld();
    const toCamera = new THREE.Matrix4().copy(this.camera.matrixWorld).invert();
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
    const half = (Math.max(maxX - minX, maxY - minY) / 2) * FRAME_MARGIN;
    this.camera.left = -half;
    this.camera.right = half;
    this.camera.top = half;
    this.camera.bottom = -half;
    // 투영 중심을 슬롯 중앙에 맞춘다(카메라 로컬 평행이동 = 뷰 창 이동).
    this.camera.translateX((minX + maxX) / 2);
    this.camera.translateY((minY + maxY) / 2);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    // 이동 연출의 길이 단위. 프러스텀에 비례해야 프레이밍을 바꿔도 연출 크기가 그대로다.
    this.unit = half;
  }

  /**
   * 한 프레임 갱신. 호출자는 보스가 화면에 있을 때만 부른다.
   *
   * @param dt   경과 시간(초, 상한 적용된 값).
   * @param s    이번 프레임의 보스 연출 상태.
   */
  update(dt: number, s: BossVisualState): void {
    if (!this.ready) return;
    this.clock += dt;

    // 전환은 상승 에지에서 한 번 채우고 스스로 소진된다. sim 프리즈(120틱)와 길이를 맞췄지만
    // 서로 독립이라 프레임 드랍이 나도 연출이 sim 을 기다리게 만들지 않는다.
    if (s.transitioning && !this.wasTransitioning) this.transitionLeft = TRANSITION_SECONDS;
    this.wasTransitioning = s.transitioning;
    if (this.transitionLeft > 0) this.transitionLeft = Math.max(0, this.transitionLeft - dt);

    const t = this.clock;

    // ── 기본 거동(페이즈별) ── 셋은 진폭이 아니라 쓰는 축과 파형이 다르다(위 주석 참조).
    const m =
      s.phase >= 2 ? phase2Motion(t) : s.phase === 1 ? phase1Motion(t) : phase0Motion(t);

    // ── 전환(페이즈 위에 덮어쓴다) — 3박자로 실루엣이 시간에 따라 변한다 ──
    if (this.transitionLeft > 0) {
      applyTransition(m, 1 - this.transitionLeft / TRANSITION_SECONDS, t);
    }

    // ── 과열(페이즈와 직교로 덧씌운다) ──
    if (s.overheated) applyOverheat(m, t);

    // 이동은 프러스텀 반폭 배수다(위 {@link unit} 주석) — 프레이밍과 연출이 함께 움직인다.
    this.pivot.position.set(m.x * this.unit, m.y * this.unit, 0);
    this.pivot.rotation.set(m.pitch, m.yaw, m.roll);
    this.pivot.scale.setScalar(m.scale);
    const emissive = m.emissive;

    for (const mat of this.emissiveMaterials) mat.emissiveIntensity = emissive;
    // 코어 점광도 함께 달아올라 발광이 모델 밖(주변 면)까지 번진다.
    this.coreLight.intensity = 1.4 + emissive * 1.6;

    this.stage.markActive('boss');
  }
}

/** 슬롯 해상도를 외부(테스트·문서)에서 참조할 때 쓰는 재수출. */
export { SLOT_SIZE };
