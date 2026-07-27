/**
 * Entity model and factories for the simulation core (M1 Phase 2).
 *
 * The world keeps a single flat `entities` array so the deterministic state hash
 * can walk it in a fixed order. Every entity — player, enemy, bullet, hazard,
 * gem — shares one struct; kind-specific fields simply default to 0 for kinds
 * that do not use them. This keeps hashing branch-free and makes it trivial to
 * add new kinds without touching the hash layout ordering.
 *
 * This module is a leaf: it imports nothing from `world`/`patterns`/`waves`, so
 * both the world loop and the pattern engine can depend on it without cycles.
 */

export type EntityKind =
  | 'player'
  | 'enemy'
  | 'bullet'
  | 'enemyBullet'
  | 'hazard'
  | 'gem'
  | 'supply'
  | 'boss'
  // --- Scroll-map gimmicks (plan Phase E/F) ---
  | 'wall' // 이동 차단 + 양측 탄 차단 + LOS 가림 직사각(AABB) 엄폐물
  | 'destructible' // 부수면 젬 드랍하는 파괴 가능 오브젝트(이동은 통과)
  | 'magnetEmitter' // 접촉 시 젬 자석 반경 배율 버프
  | 'bombDevice' // 접촉 시 반경 내 적 피해 + 적탄 소거
  | 'turretPickup' // 접촉 시 일정 시간 자동 사격하는 아군 포탑으로 활성화
  // --- M2 파밍 루프 (plan Phase B3) ---
  | 'loot' // 엘리트·보스가 바닥에 떨군 장비 드랍(접촉 자동 획득). damage=드랍시드, enemyType=rarity 코드
  // --- M4 침공 방어 배치 (plan Phase C1) ---
  // (구 'defenseTurret' 포탑 6종은 M7a L11 에서 삭제 — L2 회랑 설비 3종이 계승했다.
  //  KIND_CODE 15 는 재사용하지 않는다. 아래 KIND_CODE 주석 참조.)
  | 'core' // 방어 코어(침공 목표). 파괴 시 침공 승리(compact가 victory 판정)
  // --- M5 수호 기체 (plan Phase A1, ADR-0007) ---
  | 'guardian' // 퇴역 기체의 방어 AI(추적형 요격 유닛). 침공 방어전에 참전, 플레이어를 추적·사격
  // --- 방어 카드 유니크 신기루 코어 (Lane B) ---
  | 'decoyCore' // 유니크 '신기루 코어'가 스폰하는 가짜 코어. 조준·피격은 실제 코어와 같으나 파괴돼도 승리 없음
  // --- M7a 침공 3레이어 (레인 문서 W1 예약분, ADR-0017~0019) ---
  // 이 8종은 W1 킥오프 시 L1-determinism 레인이 **미리 예약**한 것이다. L2~L5 레인이
  // 병렬로 구현하면서 kind 를 append 하려고 replay/entities 를 동시에 열면 해시 계약이
  // 갈리므로, 코드 번호를 여기서 한 번에 확정해 두고 각 레인은 이름만 쓴다.
  | 'formation' // L1 편대 리더. 진형의 기준점이자 편대원 스폰 앵커(aux0=편대 카탈로그 id, aux1=진형 진행 틱)
  | 'formationDrone' // L1 편대원. 리더 기준 절대 오프셋으로 배치되는 실전투 유닛
  | 'facilityGun' // L2 벽부착 방어포. 방향 제한 사격(facingDeg/arcDeg 는 설비 스펙에서 파생)
  | 'facilityHazard' // L2 기믹 해저드. 주기 온오프 상태머신(period/on/phaseOffset)
  | 'facilitySpawner' // L2 드론 스포너. aux0=남은 소환 수, aux1=다음 소환까지 틱, timer=드론 내구도
  | 'spawnedDrone' // facilitySpawner 가 소환한 드론(모체 파괴와 무관하게 독립 생존)
  | 'prop' // L3 기물(실드 발생기·중력 앵커·고정 주포). aux0=기물 카탈로그 id
  | 'defenseBoss' // L3 방어 보스. PvE 'boss' 와 별도 kind — compact() 의 boss→victory 함정을 피한다
  // --- 레이싱(Lane5, ADR-0021 §2.3) — 부스트 패드 -----------------------------------
  | 'boostPad' // 레이싱 지름길 채널의 순간가속 오버레이. 충돌·이동 차단·grid 등록 없음(inert) — racingCleared 가 플레이어 overlap 만 판정해 가속
  // --- 추격·탈출(Lane6, ADR-0021 §2.4) — 대피소 -------------------------------------
  | 'shelter' // 추격 모드 대피소. boostPad 선례(inert): 충돌·이동 차단·grid 등록·isGimmick 어디에도 없음 — chaseShelterReached 가 플레이어 overlap 만 판정해 세그먼트 전진. aux0=대피소 인덱스(세그먼트 대응)
  // --- 에코 신호(story Phase D, ADR-0023) — 서사 이벤트 오브젝트 ----------------------
  | 'echo' // 에코 신호. boostPad/shelter 선례(inert): 충돌·이동 차단·grid 등록·isGimmick 어디에도 없음 — echo.ts stepEchoStabilize 가 플레이어 반경 내 체류를 판정해 안정화. 에코 런(≈3%)에만 등장
  // --- 조우 프레임워크(ADR-0033) — 에코를 일반화한 opt-in 희귀 이벤트 오브젝트 ---------
  | 'encounterPortal' // 보물 격실 진입 포탈. echo 정본과 같은 inert — encounter.ts 가 플레이어 근접 + SPECIAL_ENCOUNTER_ENTER 입력을 판정해 detour 로 보낸다. 조우 런(≈2%)의 treasureVault 유형에만 등장
  | 'encounterAltar'; // 오스카 제단(3택 도박). 마찬가지로 inert — 근접 + SPECIAL_ENCOUNTER_ALTAR_PICK 입력만 판정한다. 조우 런의 oscarAltar 유형에만 등장

/**
 * Stable integer per kind, folded into the state hash. Never renumber existing
 * codes — a run recorded under old codes must re-verify identically. New kinds
 * are APPENDED (codes 9+) so existing recordings hash unchanged.
 */
export const KIND_CODE: Record<EntityKind, number> = {
  player: 1,
  enemy: 2,
  bullet: 3,
  enemyBullet: 4,
  hazard: 5,
  gem: 6,
  supply: 7,
  boss: 8,
  // Appended for the scroll-map gimmicks (never renumber 1..8).
  wall: 9,
  destructible: 10,
  magnetEmitter: 11,
  bombDevice: 12,
  turretPickup: 13,
  // Appended for the M2 farming loop (never renumber 1..13).
  loot: 14,
  // Appended for the M4 침공 방어 배치 (never renumber 1..14).
  // **코드 15(구 defenseTurret)는 영구 결번**이다. M7a L11 에서 포탑 6종을 삭제했지만 번호를
  // 당기지 않는다 — 당기면 core(16) 이하 전부가 재배치돼 기존 리플레이·fixture 가 통째로 갈린다.
  core: 16,
  // Appended for the M5 수호 기체 (never renumber 1..16). PvE·수호 미포함 침공 런에는
  // guardian 엔티티가 없어 이 코드가 해시에 등장하지 않는다 → 기존 fixtures 바이트 불변.
  guardian: 17,
  // Appended for 방어 카드 유니크 신기루 코어 (never renumber 1..17). 이 kind 를 만드는 경로는
  // **둘**이다: ① 유니크 '신기루 코어' 모듈(`src/sim/moduleEffects.ts`) ② M7c L3 기물 역할 4
  // '기만 홀로그램'(`src/sim/invasion/coreRoom.ts` — 카탈로그에서 배치된다). 둘 중 하나라도
  // 실린 침공에만 decoyCore 엔티티가 존재해 이 코드가 해시에 등장한다 → 미장착·미배치 침공과
  // PvE 리플레이는 바이트 불변(조건부 접기).
  decoyCore: 18,
  // Appended for M7a 침공 3레이어 (never renumber 1..18). 이 8종은 3레이어 침공 런에만
  // 등장하므로 PvE·구 침공 리플레이의 해시에는 나타나지 않는다(기존 fixtures 회귀 0).
  // **코드 19..26 은 계약이다** — 재배치·중간 삽입 금지, 신규 kind 는 27 부터 append.
  formation: 19,
  formationDrone: 20,
  facilityGun: 21,
  facilityHazard: 22,
  facilitySpawner: 23,
  spawnedDrone: 24,
  prop: 25,
  defenseBoss: 26,
  // Appended for 레이싱(Lane5, never renumber 1..26). 부스트 패드는 레이싱 런에만 등장하므로
  // PvE·구 침공·블록격파 리플레이의 해시에는 나타나지 않는다(기존 fixtures 회귀 0).
  boostPad: 27,
  // Appended for 추격·탈출(Lane6, never renumber 1..27). 대피소는 추격 런에만 등장하므로
  // PvE·구 침공·블록격파·레이싱·오염 리플레이의 해시에는 나타나지 않는다(기존 fixtures 회귀 0).
  shelter: 28,
  // Appended for 에코 신호(story Phase D, never renumber 1..28). 에코 오브젝트는 에코 런(≈3%)
  // 에만 등장하므로 에코 미발생 런(뱀서류·침공·블록격파·레이싱·추격·수축·오염 전부)의 해시에는
  // 나타나지 않는다(기존 fixtures 회귀 0). 신규 kind 는 30 부터 append.
  echo: 29,
  // Appended for 조우 프레임워크(ADR-0033, never renumber 1..29). 두 오브젝트는 조우 런(≈2%)
  // 중에서도 해당 유형이 뽑힌 런에만 스폰되므로, 조우 미발생 런(기존 전 모드·침공 포함)의
  // 해시에는 이 코드가 등장하지 않는다(조건부 접기 · 기존 fixtures 회귀 0).
  // **append-only 규율**: 신규 kind 는 32 부터. 30/31 을 다른 kind 로 재사용하지 않는다 —
  // 재사용하면 이 코드로 기록된 리플레이가 다른 kind 로 재해석돼 서버 재검증이 갈린다.
  encounterPortal: 30,
  encounterAltar: 31,
};

export interface Entity {
  id: number;
  kind: EntityKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Facing / travel angle (radians). */
  angle: number;
  radius: number;
  hp: number;
  maxHp: number;
  /** Generic countdown: hazard windup, enemy re-decision timer. */
  timer: number;
  /** Dash cooldown in ticks (player). */
  dashCooldown: number;
  /** Invulnerability frames remaining (player). */
  iframes: number;
  /** Enemy role index (see patterns/types) / hazard subtype; -1 when unused. */
  enemyType: number;
  /** Attack / weapon fire cooldown in ticks. */
  cooldown: number;
  /** Pattern or hazard sub-state (0 = telegraph, 1 = active, ...). */
  phase: number;
  /** Remaining lifetime in ticks (bullets, hazards). -1 = never expires. */
  life: number;
  /** Contact / bullet / hazard damage. */
  damage: number;
  /** Bullet remaining pierces (0 = despawn on first hit). */
  pierce: number;
  /** Steering / impact target (mortar zone, charger goal, heal-beam target). */
  targetX: number;
  targetY: number;
  /** Owning entity id (hazard/beam source); 0 = none. */
  ownerId: number;
  /**
   * 범용 정수 확장 슬롯 0 (M7a). 기존 22필드가 kind 별 재활용으로 포화 상태라, 3레이어
   * 콘텐츠가 필드를 하나씩 늘리며 `hashEntity` 레이아웃을 반복 변경하는 것을 막으려고
   * **여기서 1회만** 확장한다. 용도는 kind 마다 각 레인이 정한다(예: facilitySpawner =
   * 남은 소환 수, formation = 편대 카탈로그 id).
   *
   * **반드시 정수**여야 한다 — 해시가 `hashU32`(ToUint32)로 접으므로 소수부는 조용히
   * 사라져 재현 대조를 무력화한다. 실수 상태가 필요하면 aux 가 아니라 기존 f64 필드를 써라.
   */
  aux0: number;
  /** 범용 정수 확장 슬롯 1. 규율은 {@link Entity.aux0} 와 동일(정수 전용). */
  aux1: number;
  /** Transient removal flag — set during a tick, compacted before hashing. */
  dead: boolean;
}

/** A world-like sink that can allocate ids and hold entities. */
export interface EntitySink {
  entities: Entity[];
  nextEntityId: number;
}

/** All-zero entity of the given kind; callers override the fields they need. */
export function blankEntity(kind: EntityKind): Entity {
  return {
    id: 0,
    kind,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    radius: 0,
    hp: 0,
    maxHp: 0,
    timer: 0,
    dashCooldown: 0,
    iframes: 0,
    enemyType: -1,
    cooldown: 0,
    phase: 0,
    life: -1,
    damage: 0,
    pierce: 0,
    targetX: 0,
    targetY: 0,
    ownerId: 0,
    aux0: 0,
    aux1: 0,
    dead: false,
  };
}

/** Allocate an id, append to the sink, and return the entity. */
export function addEntity(sink: EntitySink, e: Entity): Entity {
  e.id = sink.nextEntityId++;
  sink.entities.push(e);
  return e;
}

/** Spawn a friendly (player) bullet travelling along `angle`. */
export function spawnBullet(
  sink: EntitySink,
  x: number,
  y: number,
  angle: number,
  speed: number,
  damage: number,
  pierce: number,
  radius: number,
  life: number,
  vcos: number,
  vsin: number,
): Entity {
  const b = blankEntity('bullet');
  b.x = x;
  b.y = y;
  b.vx = vcos * speed;
  b.vy = vsin * speed;
  b.angle = angle;
  b.radius = radius;
  b.damage = damage;
  b.pierce = pierce;
  b.life = life;
  return addEntity(sink, b);
}

/** Spawn a hostile bullet with an explicit velocity. */
export function spawnEnemyBullet(
  sink: EntitySink,
  x: number,
  y: number,
  vx: number,
  vy: number,
  angle: number,
  damage: number,
  radius: number,
  life: number,
): Entity {
  const b = blankEntity('enemyBullet');
  b.x = x;
  b.y = y;
  b.vx = vx;
  b.vy = vy;
  b.angle = angle;
  b.radius = radius;
  b.damage = damage;
  b.life = life;
  return addEntity(sink, b);
}

/** Spawn a telegraphed hazard zone (mortar impact, lava pillar). */
export function spawnHazard(
  sink: EntitySink,
  subtype: number,
  x: number,
  y: number,
  radius: number,
  windup: number,
  activeTicks: number,
  damage: number,
  continuous: boolean,
  ownerId: number,
): Entity {
  const h = blankEntity('hazard');
  h.enemyType = subtype;
  h.x = x;
  h.y = y;
  h.radius = radius;
  h.timer = windup; // telegraph countdown
  h.life = activeTicks; // active duration once telegraph ends
  h.damage = damage;
  h.phase = continuous ? 1 : 0; // 1 = continuous damage, 0 = single burst
  h.ownerId = ownerId;
  return addEntity(sink, h);
}

/**
 * Spawn an experience gem dropped by a slain enemy. `xpValue` (enemy-dependent)
 * is stored in the `damage` field — gems never deal damage, so the slot is free
 * and is already folded into the state hash.
 */
export function spawnGem(sink: EntitySink, x: number, y: number, xpValue: number): Entity {
  const g = blankEntity('gem');
  g.x = x;
  g.y = y;
  g.radius = 20; // 2x scale (plan D1): 10 -> 20
  g.hp = 1;
  g.damage = xpValue;
  return addEntity(sink, g);
}

/**
 * Spawn a supply raider — a high-HP transport that crosses the arena without
 * firing. `life` counts down its time window (despawns on expiry); shooting it
 * down before then yields the reward. `vx` carries it across; `enemyType` tags
 * the render.
 */
export function spawnSupply(
  sink: EntitySink,
  x: number,
  y: number,
  vx: number,
  hp: number,
  lifeTicks: number,
): Entity {
  const s = blankEntity('supply');
  s.x = x;
  s.y = y;
  s.vx = vx;
  s.radius = 92; // 2x scale (plan D1): 46 -> 92
  s.hp = hp;
  s.maxHp = hp;
  s.life = lifeTicks;
  s.enemyType = 0;
  return addEntity(sink, s);
}

// ---------------------------------------------------------------------------
// Scroll-map gimmicks (plan Phase E/F). All reuse the flat Entity struct — no
// new hash fields. The wall AABB is the single field-mapping source of truth
// (plan E1): both the movement-slide resolver and the LOS segment test read it.
// ---------------------------------------------------------------------------

/**
 * Spawn a rectangular cover wall (AABB).
 *
 * FIELD MAPPING — SINGLE SOURCE OF TRUTH (plan E1, do not redefine elsewhere):
 *   - `radius`  = half-WIDTH  (halfW) of the axis-aligned box
 *   - `targetX` = half-HEIGHT (halfH) of the axis-aligned box
 * A square wall is `targetX === radius`. Both the circle-vs-AABB movement slide
 * (src/sim/los.ts) and the segment-vs-AABB LOS test read exactly these two
 * fields — never introduce a parallel half-extent field.
 */
export function spawnWall(sink: EntitySink, x: number, y: number, halfW: number, halfH: number): Entity {
  const w = blankEntity('wall');
  w.x = x;
  w.y = y;
  w.radius = halfW; // half-width  (single source — see mapping above)
  w.targetX = halfH; // half-height (single source — see mapping above)
  return addEntity(sink, w);
}

/**
 * 파괴가능 벽(hp>0, blockBreak Lane4). 아군탄이 hp 를 깎고 hp≤0 에서 파괴한다. AABB 필드
 * 매핑(radius=halfW, targetX=halfH)은 spawnWall 정본과 동일 — **별도 kind 를 만들지 않아**
 * 이동 차단·창 클램프·LOS·압사 기하가 전부 기존 wall 경로로 공짜로 붙는다. `hp>0` 자체가
 * 파괴가능 표식이라 침공/뱀서류 벽(hp=0)과 게이트로 갈린다(그쪽 거동·해시 불변).
 */
export function spawnBreakableWall(
  sink: EntitySink,
  x: number,
  y: number,
  halfW: number,
  halfH: number,
  hp: number,
): Entity {
  const w = spawnWall(sink, x, y, halfW, halfH);
  w.hp = hp;
  w.maxHp = hp;
  return w;
}

/** Spawn a destructible object: `hp` > 0, drops a gem worth `xpValue` when broken. */
export function spawnDestructible(
  sink: EntitySink,
  x: number,
  y: number,
  radius: number,
  hp: number,
  xpValue: number,
): Entity {
  const d = blankEntity('destructible');
  d.x = x;
  d.y = y;
  d.radius = radius;
  d.hp = hp;
  d.maxHp = hp;
  d.damage = xpValue; // gem XP granted on destruction (mirrors spawnGem's slot use)
  return addEntity(sink, d);
}

/**
 * Spawn a proximity event object (magnet emitter / bomb device / turret pickup).
 * `radius` is the proximity trigger radius. Turret pickups use `phase` (0 =
 * dormant pickup, 1 = active turret) and `life` (active turret lifetime).
 */
export function spawnEventObject(
  sink: EntitySink,
  kind: 'magnetEmitter' | 'bombDevice' | 'turretPickup',
  x: number,
  y: number,
  radius: number,
): Entity {
  const e = blankEntity(kind);
  e.x = x;
  e.y = y;
  e.radius = radius;
  return addEntity(sink, e);
}

/**
 * Spawn the boss. Fields carry its fight state: `phase` (0/1/2), `timer` (phase
 * transition/animation countdown, 0 = fighting), `cooldown` (next pattern),
 * `iframes` (overheat window — takes double damage while > 0), `dashCooldown`
 * (overheat re-arm timer — the boss never dashes, so the field gates how often
 * the overheat window may re-open; see src/sim/boss.ts). `enemyType` tags render
 * variant.
 */
export function spawnBoss(sink: EntitySink, x: number, y: number, hp: number, radius: number): Entity {
  const b = blankEntity('boss');
  b.x = x;
  b.y = y;
  b.radius = radius;
  b.hp = hp;
  b.maxHp = hp;
  b.phase = 0;
  b.enemyType = 0;
  return addEntity(sink, b);
}

/**
 * Spawn a floor loot drop (M2 plan B3). The sim never carries the item itself —
 * only the DROP SEED (u32) it stands for, from which `rollItem` reconstructs the
 * item at settlement (ADR-0005, plan §2 ①A). Field mapping:
 *   - `damage`    = drop seed (exact integer < 2^53, folded into the hash)
 *   - `enemyType` = rarity code (0 normal .. 3 unique; drives the beam colour)
 *   - `radius`    = pickup radius (contact auto-collect, OQ-M2-1 default)
 */
export function spawnLoot(
  sink: EntitySink,
  x: number,
  y: number,
  dropSeed: number,
  rarityCode: number,
): Entity {
  const l = blankEntity('loot');
  l.x = x;
  l.y = y;
  l.radius = 44; // generous pickup radius (2x scale)
  l.hp = 1;
  l.damage = dropSeed >>> 0;
  l.enemyType = rarityCode;
  return addEntity(sink, l);
}

/**
 * 부스트 패드(레이싱 Lane5). `radius` 는 밟음 판정용 접촉 반경. 순수 오버레이 —
 * resolveCollisions 격자·rebuildActiveWalls·isGimmick 어디에도 등록되지 않아 충돌·이동
 * 차단이 없다. racingCleared 가 플레이어 overlap 을 판정해 가속만 낸다. hp=0 이라 파괴되지도
 * 않는다(compact 는 dead 만 수거하는데 부스트 패드는 dead 가 되는 경로가 없다).
 */
export function spawnBoostPad(sink: EntitySink, x: number, y: number, radius: number): Entity {
  const b = blankEntity('boostPad');
  b.x = x;
  b.y = y;
  b.radius = radius;
  return addEntity(sink, b);
}

/**
 * 대피소(추격·탈출 Lane6). `radius` 는 도달 판정용 접촉 반경. boostPad 정본과 같은 순수
 * 오버레이 — resolveCollisions 격자·rebuildActiveWalls·isGimmick·피해목록 어디에도 등록되지
 * 않아 충돌·이동 차단이 없다(inert). chaseShelterReached 가 플레이어 overlap 을 판정해
 * 세그먼트를 전진시킨다. hp=0 이라 파괴되지 않는다(compact 는 dead 만 수거하는데 대피소는
 * dead 가 되는 경로가 없다). `aux0` = 대피소 인덱스(세그먼트 대응)는 배치 시 세팅한다.
 */
export function spawnShelter(sink: EntitySink, x: number, y: number, radius: number): Entity {
  const s = blankEntity('shelter');
  s.x = x;
  s.y = y;
  s.radius = radius;
  return addEntity(sink, s);
}

/**
 * 에코 신호 오브젝트(story Phase D, ADR-0023). `radius` 는 렌더/풋프린트 반경일 뿐 충돌엔 쓰지
 * 않는다. boostPad/shelter 정본과 같은 순수 inert 오브젝트 — resolveCollisions 격자·
 * rebuildActiveWalls·isGimmick·피해목록 어디에도 등록되지 않아 충돌·이동 차단·청크 컬링이 없다.
 * echo.ts 의 stepEchoStabilize 가 플레이어 반경 내 체류를 판정해 안정화하고, 성공 시 dead 로
 * 표시한다(그전엔 dead 가 되는 경로가 없다). 에코 런(≈3%)에만 스폰돼 KIND_CODE 29 가 그 외
 * 런의 해시에 등장하지 않는다.
 */
export function spawnEcho(sink: EntitySink, x: number, y: number, radius: number): Entity {
  const e = blankEntity('echo');
  e.x = x;
  e.y = y;
  e.radius = radius;
  return addEntity(sink, e);
}

/**
 * 보물 격실 진입 포탈(조우 프레임워크, ADR-0033). `radius` 는 렌더/풋프린트 반경일 뿐
 * 충돌엔 쓰지 않는다 — spawnEcho 정본과 완전히 같은 inert 오브젝트다: resolveCollisions
 * 격자·rebuildActiveWalls·isGimmick·피해목록 어디에도 등록되지 않아 충돌·이동 차단·청크
 * 컬링이 없다. 진입 판정은 encounter.ts 가 플레이어 거리 + `SPECIAL_ENCOUNTER_ENTER`
 * 입력으로 직접 한다(격자를 타지 않는 이유는 "접촉 즉발"이 아니라 **명시적 opt-in 입력**
 * 이기 때문이다 — 스치기만 해서 딴 세상에 끌려가면 안 된다).
 */
export function spawnEncounterPortal(
  sink: EntitySink,
  x: number,
  y: number,
  radius: number,
): Entity {
  const p = blankEntity('encounterPortal');
  p.x = x;
  p.y = y;
  p.radius = radius;
  return addEntity(sink, p);
}

/**
 * 오스카 제단(조우 프레임워크, ADR-0033). 포탈과 동일한 inert 오브젝트이며, 판정은
 * 근접 + `SPECIAL_ENCOUNTER_ALTAR_PICK` 입력(선택 인덱스는 비트 6..7)뿐이다. 3택 결과
 * 적용은 경량 조우 모듈(`src/sim/encounters/light.ts`)이 소유한다 — 이 파일은 스폰만 한다.
 */
export function spawnEncounterAltar(
  sink: EntitySink,
  x: number,
  y: number,
  radius: number,
): Entity {
  const a = blankEntity('encounterAltar');
  a.x = x;
  a.y = y;
  a.radius = radius;
  return addEntity(sink, a);
}
