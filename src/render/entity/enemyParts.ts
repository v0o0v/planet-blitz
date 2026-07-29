/**
 * 적 기체 장식의 **기하 조립기** — 전부 절차적 `Graphics` 다(신규 자산 0, GL 불필요, node 안전).
 *
 * ## 설계 원칙 ① 기하는 정적, 애니메이션은 변환으로만
 * 화면에 적이 20~40 마리 있고 개체당 비용이 그대로 곱해진다. `Graphics` 를 매 프레임 `clear()`
 * 후 다시 그리면 개체 수만큼 지오메트리 재빌드가 돌아 프레임 예산(+1.5ms)이 즉시 무너진다.
 * 그래서 여기 조립기들은 **상태가 바뀔 때만 한 번** 불리고, 매 프레임 움직이는 것은
 * `position` · `rotation` · `scale` · `alpha` 네 값뿐이다.
 *
 * ## 설계 원칙 ② **UI 어휘 금지**(§2-5) — 1차 반려의 본체
 * 십자선·조준 레티클·락온 브래킷·선택 링은 **HUD 의 어휘**다. 월드 실체에 붙이면 화면이 게임이
 * 아니라 디버그 오버레이로 읽힌다. 1차 구현이 여섯 항목을 전부 "스프라이트 둘레에 기하 도형"
 * 으로 풀어 정확히 그 판정을 받았다. 삭제된 것과 그 대체는 이렇다:
 *
 * | 삭제된 도형 | 왜 UI 로 읽혔나 | 대체 |
 * |---|---|---|
 * | 스폰 링의 0/90/180/270° 눈금 4개 | 십자선 레티클 | 눈금 없는 부드러운 falloff 헤일로 |
 * | 스폰 기둥 + 흰 중심 스트라이프 | 레티클 수직선 | **본체 스케일·알파 물질화**(몸으로) |
 * | 재조준 4모서리 괄호 | 락온 브래킷 | **본체 스쿼시 + 가산 명멸**(몸으로) |
 * | 조준선 + 끝 브래킷 | HUD 조준 마커 | **총구 장전 발광**(몸 앞 1.2r 이내) |
 * | 몸통 밖 완전한 원 1줄 | RTS 선택 링 | **광원 방향 반쪽 림라이트** |
 *
 * 남긴 기하 표식은 둘뿐이고 둘 다 "형태로 못 주는 정보" 다 — 엘리트 계급장(접두사는 형태가
 * 없다)과 보스 룬(등급 서사). 둘 다 비평가가 통과시킨 부분이다.
 *
 * ## 설계 원칙 ③ 가독성·밝기 계약(§2-2·§2-4)
 * - **적 실루엣을 덮거나 어둡게 만드는 도형이 없다.** 발광은 전부 가산이고, 유일한 어두운
 *   도형인 연기는 몸통 **반경 밖**에만 산다(경계까지 코드로 강제 — {@link SMOKE_INNER}).
 * - **가산 총량이 예산이다.** bright(L≥96) 면적 상한이 3레인 합산 7% 라, 여기 알파는
 *   "개별로 합리적" 이 아니라 **"20기가 동시에 켜져도 합이 예산 안"** 을 기준으로 잡혀 있다.
 * - **시안(`#39d0ff` 계열)은 아군 전용**이라 이 파일에 상수로 없다. 색은 호출측이 넘긴다.
 */

import { Container, Graphics } from 'pixi.js';

/** 림·오라의 기준: 표시 반경의 배수. 1 = 몸통 경계. */
const RIM_R = 1.04;
/**
 * 엘리트 오라 최외곽 반경 배수.
 *
 * 1.45 → 1.12 (3차). 1.45 는 몸통에서 확연히 떨어진 **동심 완전 원 3줄**이라, 1차에서 반려된
 * "RTS 선택 링" 의 정의에 그대로 들어맞았다(삭제 목록에 없었다는 이유로 살아남았을 뿐이다).
 * 몸 경계에 붙이면 같은 알파가 "링" 이 아니라 **몸에서 새어 나오는 발광**으로 읽힌다.
 */
const ELITE_AURA_R = 1.12;
/**
 * 보스 오라 최외곽 반경 배수. 1차의 2.1배는 보스 r=192 에서 403px 짜리 링이 돼 **화면에서 식별
 * 불가**했다(알파가 넓은 면적에 흩어졌다). 좁히고 알파를 안쪽에 몰아 실제로 보이게 만든다.
 */
const BOSS_AURA_R = 1.5;

/**
 * 연기 원반의 **안쪽 경계**(반경 배수). 원반 중심이 아니라 **가장자리**가 이 값 밖에 있어야
 * 한다 — 1차 주석은 "몸통 밖" 이라 적었지만 중심에만 참이었고 원반은 0.85r 까지 몸통을
 * 파고들었다. 이제 조립기가 중심을 `경계 + 자기 반지름` 으로 잡아 코드가 주석을 지킨다.
 */
const SMOKE_INNER = 1.0;

/**
 * 위협도 오라(가산). 동심 링을 겹쳐 falloff 를 만들되 **알파를 안쪽에 몬다** — 넓게 흩으면
 * 면적만 먹고 눈에는 안 보인다(보스 오라 1차 실패의 원인).
 *
 * @param radius 표시 반경(px).
 * @param color  등급 강조색.
 * @param rings  링 수.
 * @param outer  최외곽 반경 배수.
 */
export function buildThreatAura(
  radius: number,
  color: number,
  rings: number,
  outer: number,
): Graphics {
  const g = new Graphics();
  g.blendMode = 'add';
  const r0 = radius * RIM_R;
  const r1 = radius * outer;
  for (let i = rings; i >= 1; i--) {
    const t = i / rings; // 1 = 최외곽
    const r = r0 + (r1 - r0) * t;
    // 안쪽(t→0)일수록 급격히 밝아진다(제곱 가중) — 같은 알파 예산이 눈에 보이는 곳에 모인다.
    const inner = (1 - t) * (1 - t);
    g.circle(0, 0, r).stroke({ color, width: radius * 0.14, alpha: 0.03 + 0.16 * inner });
  }
  return g;
}

/** 엘리트 오라. */
export function buildEliteAura(radius: number, color: number): Graphics {
  return buildThreatAura(radius, color, 3, ELITE_AURA_R);
}

/** 보스 오라 — 링 수를 줄이고 반경을 좁혀 알파를 안쪽 두 링에 몬다. */
export function buildBossAura(radius: number, color: number): Graphics {
  return buildThreatAura(radius, color, 2, BOSS_AURA_R);
}

/**
 * (삭제됨) `buildRimLight` — 고정 반경 `arc()` stroke 로 만든 "반쪽 림라이트".
 *
 * 2차에서 완전한 원(선택 링)을 반으로 자른 것이었고, 3차 비평에서 **여전히 림라이트가 아니라는**
 * 판정을 받았다: 원호는 **실루엣을 따라가지 않는다.** 4× 확대에서 몸 경계에서 떨어진 구간과
 * 몸을 가로지르는 구간이 동시에 생기고, 보스 스케일에서는 굵은 띠가 몸 아래 빈 공간을 가로질렀다.
 *
 * 대체는 조립기가 아니라 **기법**이다 — `enemyVisual.ts` 가 본체 텍스처의 가산 사본을 광원
 * 쪽으로 몇 px 밀어 붙인다(레인 A `playerRim` 과 같은 패턴, 그리고 이 레인의 `enemyBodyGlow` 가
 * 수치로 성공시킨 바로 그 기법). 텍스처 사본은 원리적으로 실루엣을 따라간다.
 */

/**
 * 엘리트 휘장 — 몸통 위쪽에 뜨는 갈매기표 계급장. **비평가가 통과시킨 유일한 기하 표식**이다:
 * 접두사(분열/가속/자기장/…)는 형태로 줄 수 있는 정보가 아니라 표식이 정당하다.
 */
export function buildEliteInsignia(radius: number, color: number): Container {
  const c = new Container();
  const g = new Graphics();
  const w = radius * 0.5;
  const h = radius * 0.22;
  for (let i = 0; i < 2; i++) {
    // 본체 **상단에 겹쳐** 붙인다(1.3r 바깥 → 0.72r 안쪽). 몸에서 떨어져 뜨면 오라 링과 합쳐져
    // "선택된 유닛" 인상을 굳힌다는 지적을 받았다 — 계급장은 몸에 달린 것이어야 한다.
    const y = -radius * 0.72 - i * h * 1.5;
    g.moveTo(-w, y + h)
      .lineTo(0, y)
      .lineTo(w, y + h)
      .stroke({ color, width: Math.max(1.5, radius * 0.09), alpha: 0.9 });
  }
  c.addChild(g);
  return c;
}

/** 룬이 앉는 위치 = 각 축 반치수의 이 배율(안쪽 가장자리). */
const RUNE_INSET = 0.86;

/**
 * 보스 휘장 — 본체 **경계 상자의 네 가장자리 안쪽**에 박히는 룬 넷.
 *
 * ## 왜 원 궤도를 버렸나 (3차 CRIT)
 * 1차 `1.45r` → 2차 `1.08r` 로 배수를 줄였는데도 룬이 허공에 남았다. **원인은 배수가 아니라
 * 기준량이었다** — `radius = sprite.width/2` 인데 보스 스프라이트는 정사각형이 아니고 투명
 * 여백까지 폭에 들어간다. 원 궤도를 폭 하나로 잡으면 **짧은 축에서는 몸 안, 긴 축에서는 몸
 * 밖**이 되고, 배수를 아무리 줄여도 그 성질은 사라지지 않는다. 그래서 축마다 자기 반치수를
 * 쓴다.
 *
 * 이걸 지키던 2차 테스트도 항진이었다: 룬 경계 상자를 **자기 궤도 파라미터**와 비교했으니
 * `orbit + s <= 1.25r` 인 한 무조건 통과했다. **본체 치수와 대조하지 않는 단언은 "몸에 붙었다"를
 * 증명하지 못한다** — 테스트는 이제 비정사각(3:4) 스프라이트를 주고 두 축 각각을 검사한다.
 *
 * @param halfW 본체 표시 반치수(가로).
 * @param halfH 본체 표시 반치수(세로).
 */
export function buildBossInsignia(halfW: number, halfH: number, color: number): Container {
  const c = new Container();
  const g = new Graphics();
  const s = Math.min(halfW, halfH) * 0.13;
  // 좌·우는 가로 반치수, 위·아래는 세로 반치수를 쓴다. 비정사각에서도 네 룬이 전부 몸 위에 앉는다.
  const spots: readonly (readonly [number, number])[] = [
    [halfW * RUNE_INSET, 0],
    [-halfW * RUNE_INSET, 0],
    [0, halfH * RUNE_INSET],
    [0, -halfH * RUNE_INSET],
  ];
  for (const [x, y] of spots) {
    g.poly([x, y - s, x + s, y, x, y + s, x - s, y]).fill({ color, alpha: 0.8 });
  }
  c.addChild(g);
  return c;
}

/**
 * 스폰 헤일로(가산) — **눈금 없는** 부드러운 falloff 하나. 1차의 0/90/180/270° 눈금 4개가
 * 십자선 레티클로 읽혀 §2-5 위반이었다. 수축은 호출측이 스케일로 준다.
 */
export function buildSpawnHalo(radius: number, color: number): Graphics {
  const g = new Graphics();
  g.blendMode = 'add';
  for (let i = 5; i >= 1; i--) {
    const t = i / 5;
    g.circle(0, 0, radius * (0.5 + 0.9 * t)).fill({ color, alpha: 0.035 });
  }
  return g;
}

/**
 * 총구 장전 발광(가산) — `standoff` 사격 대역 자세. 1차의 "몸에서 뻗는 직선 + 끝 브래킷" 은
 * HUD 조준 마커였다(§2-5). 이제 **몸 앞 1.2r 안**에만 산다: 포구에 에너지가 고이는 것이지
 * 화면에 선을 긋는 것이 아니다. 호출측이 컨테이너를 `e.angle`(플레이어 방향)로 돌린다.
 */
export function buildMuzzleCharge(radius: number, color: number): Container {
  const c = new Container();
  const g = new Graphics();
  g.blendMode = 'add';
  // 포구 쪽으로 치우친 소프트 로브 — 중심이 몸 앞 0.8r, 최대 도달 1.2r.
  for (let i = 4; i >= 1; i--) {
    const t = i / 4;
    g.circle(radius * 0.8, 0, radius * 0.42 * t).fill({ color, alpha: 0.14 });
  }
  c.addChild(g);
  return c;
}

/**
 * 돌진 스미어(가산) — `chargeStraight` 커밋 자세. 1차는 진행 방향으로 **3.4r 쐐기**를 그려
 * "적보다 장식이 먼저 눈에 드는" 상태였다(§2-2 가 플레이어에게 쓴 금지의 적 버전).
 * 이제 **뒤로 흐르는 속도 잔상**이다 — 앞을 가리키는 표식이 아니라 몸의 2차 운동이라
 * 위협의 위치를 몸이 계속 소유한다.
 */
export function buildDashSmear(radius: number, color: number): Container {
  const c = new Container();
  const g = new Graphics();
  g.blendMode = 'add';
  const reach = radius * 1.8;
  // 뒤로 갈수록 얇아지는 꼬리(삼각형 두 겹).
  g.poly([-radius * 0.2, -radius * 0.5, -reach, 0, -radius * 0.2, radius * 0.5]).fill({
    color,
    alpha: 0.1,
  });
  g.poly([-radius * 0.2, -radius * 0.22, -reach * 0.6, 0, -radius * 0.2, radius * 0.22]).fill({
    color,
    alpha: 0.12,
  });
  c.addChild(g);
  return c;
}

/**
 * 지원 오라(가산) — `seekWounded` 가 멈춰 아군을 붙이고 있을 때. 1차의 "호 두 개 + 살 여섯"
 * 은 계기판처럼 읽혔다. 부드러운 발광 덩어리로 바꿔 "이 개체가 에너지를 뿜고 있다" 만 남긴다.
 */
export function buildMendAura(radius: number, color: number): Graphics {
  const g = new Graphics();
  g.blendMode = 'add';
  for (let i = 4; i >= 1; i--) {
    g.circle(0, 0, radius * (0.7 + 0.55 * (i / 4))).fill({ color, alpha: 0.05 });
  }
  return g;
}

/**
 * 고정 포대 가동 발광(가산) — `stationary` 종의 상시 표현. **발사 예고가 아니다**(그 시점은
 * 관측 불가능하다 — `enemyPosture.ts` 헤더). 느리게 도는 비대칭 열점 셋이라 "가동 중인 설비"
 * 로만 읽히고 예고로 오독되지 않는다.
 */
export function buildRootedHeat(radius: number, color: number): Graphics {
  const g = new Graphics();
  g.blendMode = 'add';
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3;
    const x = Math.cos(a) * radius * 0.85;
    const y = Math.sin(a) * radius * 0.85;
    for (let k = 3; k >= 1; k--) {
      g.circle(x, y, radius * 0.26 * (k / 3)).fill({ color, alpha: 0.07 });
    }
  }
  return g;
}

/**
 * 손상 불티(가산) — 몸통 가장자리에 붙는 점 무리. 1차는 반경 `0.07r`(잡몹 r=54 → **3.8px**)
 * 이라 카르곤 용암 발광 위에서 **화면 델타가 노이즈 바닥 밑**이었다(계약 §4-2 = 화면에 없는 것).
 * 점을 키우고 소프트 코어를 얹어 실측 가능한 크기로 올린다.
 */
export function buildSparks(radius: number, color: number, count: number): Graphics {
  const g = new Graphics();
  g.blendMode = 'add';
  for (let i = 0; i < count; i++) {
    // 황금각 배치 — count 가 달라져도 뭉치지 않는다.
    const a = i * 2.399963;
    const r = radius * (0.66 + 0.28 * ((i * 0.37) % 1));
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    g.circle(x, y, radius * 0.2).fill({ color, alpha: 0.3 });
    g.circle(x, y, radius * 0.1).fill({ color: 0xffe6c0, alpha: 0.75 });
  }
  return g;
}

/** 화염(가산) — 대파 이상에서 몸통 위로 솟는 불꽃 혀. 위쪽으로만 뻗어 아래 실루엣을 남긴다. */
export function buildFlame(radius: number): Graphics {
  const g = new Graphics();
  g.blendMode = 'add';
  const h = radius * 1.25;
  g.poly([-radius * 0.5, 0, 0, -h, radius * 0.5, 0]).fill({ color: 0xff6a1e, alpha: 0.5 });
  g.poly([-radius * 0.26, 0, 0, -h * 0.62, radius * 0.26, 0]).fill({
    color: 0xffd58a,
    alpha: 0.6,
  });
  return g;
}

/**
 * 연기 뭉치 — **유일하게 어두운 도형**이라 규칙이 엄격하다: 가산이 아니고, 원반의 **가장자리
 * 까지** 몸통 반경 밖({@link SMOKE_INNER})이며, 알파 상한이 낮다. 호출측이 진행 방향
 * **반대쪽**으로 돌려 꼬리로 만든다.
 */
export function buildSmoke(radius: number): Graphics {
  const g = new Graphics();
  let edge = SMOKE_INNER; // 지금까지 채워진 바깥 경계(반경 배수)
  for (let i = 0; i < 3; i++) {
    const rr = radius * (0.3 + i * 0.11);
    // 중심 = 지금 경계 + 자기 반지름 → 원반 전체가 경계 밖에 선다(주석이 코드로 강제된다).
    const cx = radius * edge + rr;
    g.circle(cx, 0, rr).fill({ color: 0x2a2620, alpha: 0.22 - i * 0.06 });
    edge = (cx + rr) / radius;
  }
  return g;
}

/** 사망 파편 하나의 정적 도형(가산). */
export function buildShard(len: number, wide: number, color: number): Graphics {
  const g = new Graphics();
  g.blendMode = 'add';
  g.poly([-len / 2, 0, 0, -wide, len / 2, 0, 0, wide]).fill({ color, alpha: 0.95 });
  return g;
}

/** 사망 충격파 링(가산). 호출측이 스케일을 키우며 알파를 떨어뜨린다. */
export function buildShockRing(radius: number, color: number): Graphics {
  const g = new Graphics();
  g.blendMode = 'add';
  g.circle(0, 0, radius).stroke({ color, width: Math.max(2, radius * 0.16), alpha: 0.8 });
  return g;
}
