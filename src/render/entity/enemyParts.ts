/**
 * 적 기체 장식의 **기하 조립기** — 전부 절차적 `Graphics` 다(신규 자산 0, GL 불필요, node 안전).
 *
 * ## 설계 원칙: 기하는 정적, 애니메이션은 변환으로만
 * 화면에 적이 20~40 마리 있고 개체당 비용이 그대로 곱해진다. `Graphics` 를 매 프레임 `clear()`
 * 후 다시 그리면 개체 수만큼 지오메트리 재빌드가 돌아 프레임 예산(+1.5ms)이 즉시 무너진다.
 * 그래서 여기 조립기들은 **상태가 바뀔 때만 한 번** 불리고, 매 프레임 움직이는 것은
 * `position` · `rotation` · `scale` · `alpha` 네 값뿐이다. 맥동·회전·수축이 전부 변환으로
 * 표현 가능하도록 도형을 원점(0,0) 기준 단위 형태로 만든다.
 *
 * ## 가독성 계약(§2-2)이 기하에 남긴 자국
 * - **적 실루엣을 덮거나 어둡게 만드는 도형이 없다.** 오라·불티·화염은 전부 가산 합성이고,
 *   림·휘장·연기는 몸통 **바깥**(반경 > 1)에만 산다. 니플헤임의 위장 여유가 ΔRGB 35 로 가장
 *   얇아 여기서 어두운 채움을 하나라도 몸통 위에 얹으면 그 행성에서 적이 배경에 잠긴다.
 * - **시안(`#39d0ff` 계열)은 아군 전용**이라 이 파일에 상수로 존재하지 않는다. 색은 전부
 *   호출측이 {@link file://./enemyPosture.ts} 의 팔레트에서 넘긴다.
 */

import { Container, Graphics } from 'pixi.js';

/** 오라·림의 기준: 표시 반경의 배수. 1 = 몸통 경계. */
const RIM_R = 1.06;
/** 엘리트 오라 최외곽 반경 배수. */
const ELITE_AURA_R = 1.55;
/** 보스 오라 최외곽 반경 배수(엘리트보다 확연히 크다 — 등급이 거리에서 읽힌다). */
const BOSS_AURA_R = 2.1;

/**
 * 위협도 오라(가산). 동심 링을 겹쳐 중심이 밝은 falloff 를 만든다(`effects/glow.ts` 의
 * `buildGlowHalo` 와 같은 관용구). **몸통 안쪽은 비운다** — 안까지 채우면 실루엣이 씻긴다.
 *
 * @param radius 표시 반경(px).
 * @param color  등급 강조색.
 * @param rings  링 수. 등급이 높을수록 두껍게.
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
    const t = i / rings;
    const r = r0 + (r1 - r0) * t;
    // 바깥일수록 얇고 흐리게 — 안쪽으로 겹쳐 밝아진다.
    g.circle(0, 0, r).stroke({ color, width: radius * 0.1, alpha: 0.055 + 0.045 * (1 - t) });
  }
  return g;
}

/** 엘리트 오라. */
export function buildEliteAura(radius: number, color: number): Graphics {
  return buildThreatAura(radius, color, 4, ELITE_AURA_R);
}

/** 보스 오라. 링에 더해 사방으로 뻗는 광선 네 줄 — 멀리서도 "이건 보스" 로 읽힌다. */
export function buildBossAura(radius: number, color: number): Graphics {
  const g = buildThreatAura(radius, color, 6, BOSS_AURA_R);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const c = Math.cos(a);
    const s = Math.sin(a);
    g.moveTo(c * radius * RIM_R, s * radius * RIM_R)
      .lineTo(c * radius * BOSS_AURA_R * 1.25, s * radius * BOSS_AURA_R * 1.25)
      .stroke({ color, width: radius * 0.08, alpha: 0.11 });
  }
  return g;
}

/**
 * 개체 림(외곽선) — **군집 가독성**(항목 6)의 뼈대다. 같은 종 20 마리가 겹쳤을 때 개체 경계를
 * 남기는 유일한 채널이라, 몸통 **바깥**에 밝은 테두리 한 줄로만 둔다.
 *
 * 어두운 외곽선을 쓰지 않는 이유는 파일 헤더의 위장률 계약 그대로다. 기준선 캡처
 * (`.omc/research/entity-aaa-baseline-2026-07-30.md`)가 두 결함을 한꺼번에 지목한다 — 카르곤
 * 암부의 적 4기가 배경과 구분이 안 되고(`enemy_charger` 위장률 6.71%), 보스 컷에서 적 20기가
 * 겹치면 개체 경계가 통째로 사라진다. **밝은** 림 한 줄이 그 둘을 동시에 되돌리는 가장 싼 수단이라
 * 알파를 넉넉히 준다(잡몹에도 붙는 유일한 장식이므로 여기가 이 레인의 최대 표면적이다).
 */
export function buildRim(radius: number, color: number): Graphics {
  const g = new Graphics();
  g.circle(0, 0, radius * RIM_R).stroke({ color, width: Math.max(1.5, radius * 0.075), alpha: 0.5 });
  return g;
}

/**
 * 엘리트 휘장 — 몸통 위쪽에 뜨는 갈매기표(chevron) 계급장. 개수로 등급이 읽히고 색으로
 * 접두사가 읽힌다(오라와 같은 색이라 둘이 한 정보를 강화한다).
 *
 * 회전은 호출측이 컨테이너에 준다(휘장이 몸통을 따라 돌면 글자처럼 읽히지 않으므로 **돌리지
 * 않고** 위아래 부유만 시킨다).
 */
export function buildEliteInsignia(radius: number, color: number): Container {
  const c = new Container();
  const g = new Graphics();
  const w = radius * 0.5;
  const h = radius * 0.22;
  for (let i = 0; i < 2; i++) {
    const y = -radius * 1.35 - i * h * 1.5;
    g.moveTo(-w, y + h)
      .lineTo(0, y)
      .lineTo(w, y + h)
      .stroke({ color, width: Math.max(1.5, radius * 0.09), alpha: 0.9 });
  }
  c.addChild(g);
  return c;
}

/**
 * 보스 휘장 — 몸통 둘레를 도는 룬 네 개. 컨테이너를 회전시키면 궤도가 된다(2차 운동).
 */
export function buildBossInsignia(radius: number, color: number): Container {
  const c = new Container();
  const g = new Graphics();
  const orbit = radius * 1.45;
  const s = radius * 0.16;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const x = Math.cos(a) * orbit;
    const y = Math.sin(a) * orbit;
    g.poly([x, y - s, x + s, y, x, y + s, x - s, y]).fill({ color, alpha: 0.85 });
  }
  c.addChild(g);
  return c;
}

/**
 * 스폰 지면 예고 링(가산). 호출측이 큰 스케일에서 1 로 수축시키며 알파를 올린다 —
 * "여기 뭔가 온다" 가 실체보다 먼저 읽힌다.
 */
export function buildSpawnRing(radius: number, color: number): Graphics {
  const g = new Graphics();
  g.blendMode = 'add';
  g.circle(0, 0, radius).stroke({ color, width: Math.max(1.5, radius * 0.09), alpha: 0.55 });
  // 십자 눈금 — 링만 있으면 수축이 잘 안 읽힌다(원은 크기 변화가 둔하게 보인다).
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const c0 = Math.cos(a);
    const s0 = Math.sin(a);
    g.moveTo(c0 * radius * 0.75, s0 * radius * 0.75)
      .lineTo(c0 * radius * 1.25, s0 * radius * 1.25)
      .stroke({ color, width: Math.max(1, radius * 0.07), alpha: 0.45 });
  }
  return g;
}

/**
 * 워프 기둥(가산) — 스폰 순간 위아래로 솟았다가 접히는 빛기둥. 세로로 길쭉해서 지면 링과
 * 축이 갈린다(둘 다 원이면 한 이펙트로 뭉쳐 보인다).
 */
export function buildSpawnColumn(radius: number, color: number): Graphics {
  const g = new Graphics();
  g.blendMode = 'add';
  const w = radius * 0.42;
  const h = radius * 2.4;
  g.rect(-w / 2, -h, w, h * 2).fill({ color, alpha: 0.3 });
  g.rect(-w / 6, -h * 1.15, w / 3, h * 2.3).fill({ color: 0xffffff, alpha: 0.22 });
  return g;
}

/**
 * 조준선(가산) — `standoff` 사격 대역 자세. `+x` 방향으로 뻗는 가늘고 끝이 밝은 실 + 끝의
 * 조준 브래킷. 호출측이 컨테이너를 `e.angle`(= 플레이어 방향)로 돌린다.
 *
 * **적탄이 아니다.** 적탄의 흰 코어 + 유색 아웃라인 규칙은 이 파일과 무관하며, 이 실은 몸통에서
 * 뻗는 장식이라 탄으로 오독될 굵기·밝기를 일부러 넘지 않는다(굵기 = 반경의 5%).
 */
export function buildAimThread(radius: number, color: number, length: number): Container {
  const c = new Container();
  const g = new Graphics();
  g.blendMode = 'add';
  g.moveTo(radius * 1.1, 0)
    .lineTo(length, 0)
    .stroke({ color, width: Math.max(1, radius * 0.05), alpha: 0.4 });
  // 끝 브래킷 — "여기를 조준하고 있다".
  const b = radius * 0.34;
  g.moveTo(length - b, -b)
    .lineTo(length, -b)
    .lineTo(length, b)
    .lineTo(length - b, b)
    .stroke({ color, width: Math.max(1, radius * 0.07), alpha: 0.55 });
  c.addChild(g);
  return c;
}

/**
 * 장전 코어(가산) — 사격 대역에서 몸통 중심에 고이는 빛. 호출측이 스케일·알파를 램프시켜
 * "차오른다" 를 만든다. 몸통보다 작아 실루엣을 먹지 않는다.
 */
export function buildChargeCore(radius: number, color: number): Graphics {
  const g = new Graphics();
  g.blendMode = 'add';
  for (let i = 3; i >= 1; i--) {
    g.circle(0, 0, radius * 0.34 * (i / 3)).fill({ color, alpha: 0.22 });
  }
  return g;
}

/**
 * 돌진 창(가산) — `chargeStraight` 커밋 자세. 진행 방향으로 길게 늘어지는 쐐기 + 뒤로 흐르는
 * 잔상 줄. **이 선 위에 서 있으면 맞는다** 를 화면에 그린다.
 */
export function buildDashLance(radius: number, color: number, reach: number): Container {
  const c = new Container();
  const g = new Graphics();
  g.blendMode = 'add';
  // 앞으로 뻗는 쐐기.
  g.poly([radius * 1.05, -radius * 0.34, reach, 0, radius * 1.05, radius * 0.34]).fill({
    color,
    alpha: 0.22,
  });
  // 뒤로 흐르는 속도선 두 줄(2차 운동 — 본체보다 늦게 감쇠하는 부수 운동의 정적 근사).
  for (const sgn of [-1, 1]) {
    g.moveTo(-radius * 0.9, sgn * radius * 0.45)
      .lineTo(-reach * 0.55, sgn * radius * 0.12)
      .stroke({ color, width: Math.max(1, radius * 0.06), alpha: 0.18 });
  }
  c.addChild(g);
  return c;
}

/**
 * 재조준 브래킷(가산) — 차저가 방금 조준을 갈아탄 순간. 바깥에서 몸통으로 **조여드는** 네
 * 모서리 괄호다. 호출측이 스케일을 큰 값에서 1 로 내리며 알파를 떨어뜨린다(웅크림의 시각화).
 */
export function buildRelockBracket(radius: number, color: number): Graphics {
  const g = new Graphics();
  g.blendMode = 'add';
  const r = radius * 1.5;
  const a = radius * 0.55;
  const w = Math.max(1.5, radius * 0.1);
  for (let i = 0; i < 4; i++) {
    const ang = (i * Math.PI) / 2 + Math.PI / 4;
    const cx = Math.cos(ang) * r;
    const cy = Math.sin(ang) * r;
    const tx = -Math.sin(ang);
    const ty = Math.cos(ang);
    g.moveTo(cx - tx * a, cy - ty * a)
      .lineTo(cx, cy)
      .lineTo(cx + tx * a, cy + ty * a)
      .stroke({ color, width: w, alpha: 0.7 });
  }
  return g;
}

/**
 * 치료 고리(가산) — `seekWounded` 지원기가 멈춰 아군을 붙이고 있을 때. 십자가 아니라 **호 두
 * 개 + 짧은 살**이라 적탄·픽업 어느 것과도 안 겹친다. 회전시키면 "작동 중" 이 된다.
 */
export function buildMendRing(radius: number, color: number): Graphics {
  const g = new Graphics();
  g.blendMode = 'add';
  const r = radius * 1.25;
  const w = Math.max(1.5, radius * 0.09);
  g.arc(0, 0, r, -0.9, 0.9).stroke({ color, width: w, alpha: 0.5 });
  g.arc(0, 0, r, Math.PI - 0.9, Math.PI + 0.9).stroke({ color, width: w, alpha: 0.5 });
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    g.moveTo(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72)
      .lineTo(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92)
      .stroke({ color, width: w * 0.6, alpha: 0.35 });
  }
  return g;
}

/**
 * 고정 포대 배기구(가산) — `stationary` 종의 상시 표현. **발사 예고가 아니다**(그 시점은 관측
 * 불가능하다 — `enemyPosture.ts` 헤더). "가동 중인 설비" 로만 읽히도록 느리게 도는 배기 호다.
 */
export function buildRootedVents(radius: number, color: number): Graphics {
  const g = new Graphics();
  g.blendMode = 'add';
  const r = radius * 1.18;
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3;
    g.arc(0, 0, r, a, a + 0.7).stroke({ color, width: Math.max(1.5, radius * 0.11), alpha: 0.3 });
  }
  return g;
}

/**
 * 손상 불티(가산) — 몸통 가장자리에 붙는 작은 점 무리. 호출측이 컨테이너를 돌려 불티가
 * 옮겨 다니게 한다(정적 기하 + 회전으로 만드는 "지지직").
 */
export function buildSparks(radius: number, color: number, count: number): Graphics {
  const g = new Graphics();
  g.blendMode = 'add';
  for (let i = 0; i < count; i++) {
    // 황금각 배치 — count 가 달라져도 뭉치지 않는다.
    const a = i * 2.399963;
    const r = radius * (0.72 + 0.24 * ((i * 0.37) % 1));
    g.circle(Math.cos(a) * r, Math.sin(a) * r, Math.max(1, radius * 0.07)).fill({
      color,
      alpha: 0.85,
    });
  }
  return g;
}

/**
 * 화염(가산) — 대파 이상에서 몸통 위로 솟는 불꽃 혀. 위쪽으로만 뻗어 아래 실루엣을 남긴다.
 */
export function buildFlame(radius: number): Graphics {
  const g = new Graphics();
  g.blendMode = 'add';
  const h = radius * 1.15;
  g.poly([-radius * 0.42, 0, 0, -h, radius * 0.42, 0]).fill({ color: 0xff6a1e, alpha: 0.4 });
  g.poly([-radius * 0.22, 0, 0, -h * 0.62, radius * 0.22, 0]).fill({
    color: 0xffd58a,
    alpha: 0.5,
  });
  return g;
}

/**
 * 연기 뭉치 — **유일하게 어두운 도형**이라 규칙이 엄격하다: 가산이 아니고, 몸통 반경 **밖**
 * 에만 그리며(중심에서 `radius * 1.0` 이상), 알파 상한이 낮다. 호출측이 이 뭉치를 진행 방향
 * **반대쪽**으로 밀어 꼬리로 만든다 — 몸통 위로 올라오면 위장률 게이트가 즉시 빨개진다.
 */
export function buildSmoke(radius: number): Graphics {
  const g = new Graphics();
  for (let i = 0; i < 3; i++) {
    const t = i / 3;
    g.circle(radius * (1.15 + t * 0.9), 0, radius * (0.3 + t * 0.22)).fill({
      color: 0x2a2620,
      alpha: 0.22 - t * 0.06,
    });
  }
  return g;
}

/** 사망 파편 하나의 정적 도형(가산). 조각 길이·색은 호출측이 정한다. */
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
