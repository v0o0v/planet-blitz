/**
 * 런 사운드 관찰자 (M5 Phase C1 — plan §4, AC8; P2 sfx-expansion 확장).
 *
 * sim 스냅샷/요약을 프레임마다 **관찰**해 사운드 트리거를 파생한다. sim 은 소리를 전혀 모른다
 * (단방향 sim → render, ADR-0005). 이 클래스는 이전 프레임 대비 델타(처치 증가·레벨업·피격·
 * 픽업·보스 등장·발사)를 감지해 {@link GameAudio} 를 호출한다. 세리머니({@link UniqueCeremony})
 * 와 동일한 "스냅샷 델타 관찰" 패턴이다.
 *
 * ── P2 확장 ── `SoundFrame` 에 스칼라 `weaponType` 만 추가한다(원칙2: 코어 프레임 비대화 방지).
 * per-entity 데이터(드랍 좌표·rarity·특수탄)는 SoundFrame 이 아니라 호출부(main.ts)가 `w` 엔티티를
 * 스캔해 도출하고, {@link DropObserver}/{@link shouldWarn} 로 가공해 `observe`의 `ev` 로 주입한다.
 *
 * 렌더 전용 — 해시/리플레이/정산에 전혀 영향 없다.
 */

import type { GameAudio, SoundName } from './audio.js';

/** 프레임 요약(사운드 트리거 파생용, sim 원시 수치). */
export interface SoundFrame {
  /** 누적 처치 수(world.kills). */
  kills: number;
  /** 기체 런 레벨(world.level). */
  level: number;
  /** 플레이어 현재 HP(격추 사출 감지). */
  playerHp: number;
  /** 획득 자원(world.resources) — 픽업 감지. */
  resources: number;
  /**
   * **보스전이 열렸는가**(등장 감지). 이름 그대로 "보스 엔티티가 있는가"가 아니다.
   *
   * ## 왜 존재 여부가 아닌가 (2026-08-05 사용자 신고 "보스 등장 시 사운드 추가")
   * 추격(니플헤임)은 포식자가 **런 시작부터 boss 엔티티로 존재**한다. 존재 여부로 상승 에지를
   * 보면 첫 프레임이 곧 기준선이라 등장음이 **영영 울리지 않았다** — 정작 이 무대에서 극적인
   * 순간(대피소를 다 찾아 포식자가 취약해지는 그 틱)은 존재 여부가 변하지 않는다.
   *
   * 그래서 호출부(main.ts)가 "지금부터 싸울 수 있는가"를 판단해 넘긴다. 일반 무대에서는 보스
   * 스폰과 동시에 참이라 기존 거동이 그대로다(구 필드명 `hasBoss` 의 의미를 포함한다).
   */
  bossEngaged: boolean;
  /** 플레이어 탄환 수(발사 감지 — 증가분만 신규 발사로 취급). */
  bulletCount: number;
  /**
   * 현재 무기 종류(0..4). 발사음 5종 변주(AC12)에 쓴다. **호출부(main.ts:1337)가 반드시
   * `w.weapon.weaponType` 를 전달할 것** — 미전달(undefined)이면 발사음이 VULCAN 으로 고정된다
   * (변주 손실, 크래시는 아님). optional 인 이유: 기존 main.ts observe 호출부를 리드가 배선하기
   * 전까지 빌드(tsc)를 그린으로 유지하기 위함(리드 통합 seam). 배선 후 `number` 로 좁혀도 무방.
   */
  weaponType?: number;
  /** 런 패배 종료(플레이어 격추). eject/피격 판정을 HP 추정이 아닌 이 전이로 견고화. */
  gameOver: boolean;
  /** 런 승리 종료. 종료 후 피격/사출음 억제에 사용. */
  victory: boolean;
}

/** 이번 프레임 실드랍 1건(rarity + 선택적 pan). 좌표 있는 바닥 드랍만 pan 보유(AC15). */
export type DropSound = { rarity: number; pan?: number };

/** {@link RunSoundObserver.observe} 이벤트(호출부에서 도출한 per-entity 파생). */
export interface ObserveEvents {
  /** 이번 프레임 실드랍(바닥+보스직행). 각 1회 재생(AC13). */
  drops?: DropSound[];
  /** 특수탄/보스탄 경고 트리거(AC19). rising-edge 로 볼리 온셋 1회 발사. */
  warn?: boolean;
  /** true 면 모든 SFX 억제(관전 게이트, P4). 단 프레임 델타 기준선(prev)은 정상 갱신(AC21). */
  suppressSfx?: boolean;
}

/** sim `BK_NONE`(직진 잡몹탄 거동 코드)과 동일. import 회피용 리터럴(bullets.ts:32). */
const BK_NONE = -1;

/**
 * 적탄 경고 대상 판별(AC19, 순수). 하나라도 **특수 거동탄**(behavior ≠ BK_NONE, 즉
 * BK_ACCEL/HOMING/CURVE/SPLIT) **또는 보스 소유탄**이면 경고. 잡몹 직진탄만 있으면 무음.
 * 호출부가 `w.entities` 의 enemyBullet 를 `{behavior: enemyType, boss}` 로 사상해 넘긴다
 * (신규 sim 플래그 추가 없음 — render 관측만이라 결정론 무관).
 */
export function shouldWarn(bullets: ReadonlyArray<{ behavior: number; boss: boolean }>): boolean {
  for (const b of bullets) {
    if (b.behavior !== BK_NONE || b.boss) return true;
  }
  return false;
}

/**
 * 이원(二元) 드랍 관측자 (AC13·R8, 순수·CRITICAL). "실드랍 1회당 사운드 1회" 를 보장한다.
 *
 * 드랍은 두 경로로 발생한다:
 *  - (i) **바닥 드랍**: `spawnLoot` 가 `kind:'loot'` 엔티티를 만든다(좌표 x + rarity=`enemyType`).
 *        엔티티 **신규 등장**(id 추적)을 드랍 순간으로 본다 → 좌표 기반 pan.
 *  - (ii) **보스/승리틱 직행 드랍**: 엔티티 없이 `state.loot` 에 직접 push(좌표 없음) → 중앙 pan.
 *
 * **더블카운트 금지**: 바닥 loot 는 이후 수거(collectLoot)될 때 `state.loot` 를 증가시키지만,
 * 그 증가는 이미 (i)에서 소리를 낸 드랍이므로 다시 울리면 안 된다. 엔티티 소멸(수거) 을 추적해
 * `state.loot` 증분에서 **다중집합 차집합**으로 빼면, 남는 증분이 곧 경로(ii)의 직행 드랍이다.
 */
export class DropObserver {
  /** 드랍 사운드를 이미 낸 살아있는 loot 엔티티: id → rarity. */
  private readonly seen = new Map<number, number>();
  /** 직전까지 관측한 `state.loot` 길이(이번 프레임 증분 슬라이스 시작점). */
  private prevLootLen = 0;

  /** 새 런 시작 시 호출 — 관측 상태 리셋. */
  reset(): void {
    this.seen.clear();
    this.prevLootLen = 0;
  }

  /**
   * 이번 프레임의 실드랍을 산출한다(부작용 없음 — 사운드 재생은 호출부/RunSoundObserver 담당).
   * @param lootEntities 현재 살아있는 loot 엔티티(id·좌표 x·rarity). 호출부가 `w` 에서 사상.
   * @param stateLoot `state.loot` 원장(rarity 만 필요). append-only, 런 중 축소 없음.
   * @param playerX 플레이어 x(pan 산출 기준).
   * @param halfWidth 화면 반폭(|dx|>halfWidth 면 화면 밖 → 무음).
   */
  observe(
    lootEntities: ReadonlyArray<{ id: number; x: number; rarity: number }>,
    stateLoot: ReadonlyArray<{ rarity: number }>,
    playerX: number,
    halfWidth: number,
  ): DropSound[] {
    const drops: DropSound[] = [];

    // 1) 이번 프레임 state.loot 증분(경로 i 수거 + 경로 ii 직행 push 를 모두 포함).
    const newRarities: number[] = [];
    for (const entry of stateLoot.slice(this.prevLootLen)) newRarities.push(entry.rarity);
    this.prevLootLen = stateLoot.length;

    // 2) 바닥 드랍(경로 i): id 가 seen 에 없는 loot = 신규 등장(탄생 프레임 1회).
    const currentIds = new Set<number>();
    for (const e of lootEntities) {
      currentIds.add(e.id);
      if (this.seen.has(e.id)) continue;
      // 화면 안일 때만 소리(화면 밖 loot 는 레이더 담당·무음). seen 기록은 onscreen 무관.
      const dx = e.x - playerX;
      if (Math.abs(dx) <= halfWidth) {
        drops.push({ rarity: e.rarity, pan: clampPan(dx / halfWidth) });
      }
      this.seen.set(e.id, e.rarity);
    }

    // 3) 수거 판별: 직전 seen 에 있었으나 현재 lootEntities 에 없는 id = 수거됨(소리 없음).
    const collectedRarities: number[] = [];
    for (const [id, rarity] of this.seen) {
      if (!currentIds.has(id)) {
        collectedRarities.push(rarity);
        this.seen.delete(id);
      }
    }

    // 4) 보스/직행 드랍(경로 ii): state.loot 증분에서 수거분(경로 i)을 다중집합 차집합으로 제거.
    //    남는 증분 = 엔티티 없이 원장에 직접 push 된 직행 드랍 → 각 1회(좌표 없음 → 중앙 pan).
    const collectedCount = new Map<number, number>();
    for (const r of collectedRarities) collectedCount.set(r, (collectedCount.get(r) ?? 0) + 1);
    for (const r of newRarities) {
      const c = collectedCount.get(r) ?? 0;
      if (c > 0) {
        collectedCount.set(r, c - 1); // 수거로 설명됨 — 스킵(더블카운트 금지).
      } else {
        drops.push({ rarity: r }); // 직행 드랍(중앙).
      }
    }

    return drops;
  }
}

/** pan 을 -1..1 로 클램프(순수, DropObserver 좌표 pan 방어). */
function clampPan(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return p < -1 ? -1 : p > 1 ? 1 : p;
}

export class RunSoundObserver {
  private prev: SoundFrame | null = null;
  /** 경고음 rising-edge 추적(연속 present 시 매프레임 발사 금지 — 볼리 온셋 1회). */
  private prevWarn = false;

  constructor(private readonly audio: GameAudio) {}

  /** 새 런 시작 시 호출 — 델타 기준선을 리셋(런마다 수치가 0부터 다시 시작). */
  reset(): void {
    this.prev = null;
    this.prevWarn = false;
  }

  /**
   * 이번 프레임 요약을 관찰해 필요한 사운드를 재생한다. 매 프레임 안전 호출.
   * `ev` 는 호출부에서 도출한 per-entity 파생(드랍·경고·관전 억제)이다.
   */
  observe(f: SoundFrame, ev?: ObserveEvents): void {
    const p = this.prev;
    this.prev = f;
    if (p === null) return; // 첫 프레임: 기준선만 세우고 소리 없음.

    // 관전 게이트(P4·AC21): 기준선(prev)은 위에서 갱신됨. 모든 SFX(드랍·경고 포함) 억제.
    // prevWarn 은 실제 warn 상태로 유지해, 관전 종료 후 연속 볼리가 재트리거되지 않게 한다.
    if (ev?.suppressSfx === true) {
      this.prevWarn = ev?.warn === true;
      return;
    }

    const over = f.gameOver || f.victory;
    const prevOver = p.gameOver || p.victory;

    if (f.level > p.level) this.audio.play('levelUp');
    // ⚠️ **보스 등장음은 의도적으로 없다**(사용자 선택 2026-08-05 — 청취실 X0). 등장 신호는
    // `BossWarnLoop`(render/bossWarn.ts)의 반복이 **끊기는 정적**과 보스 BGM 전환이 함께 낸다.
    // 여기서 스팅어를 울리면 그 정적이 메워져 구조가 무너진다 — `bossEngaged` 는 예고 루프를
    // 멈추는 신호로만 쓰이고(main.ts), 이 관찰자는 그것으로 소리를 내지 않는다.
    if (f.kills > p.kills) this.audio.play('kill');
    if (f.resources > p.resources) this.audio.play('pickup');
    if (f.bulletCount > p.bulletCount) {
      // weaponType 미배선(undefined)이면 opts 없이 → playShot VULCAN 기본. exactOptional 안전 스레딩.
      this.audio.play('shot', f.weaponType !== undefined ? { weaponType: f.weaponType } : undefined);
    }

    // 격추 사출(eject): 패배 종료로의 전이에서 정확히 1회. entities[0]=플레이어 HP 추정에
    // 의존하지 않아, 엔티티 배열 재정렬 시에도 오발/중복이 없다(LOW#1 견고화).
    if (!prevOver && f.gameOver) {
      this.audio.play('eject');
    } else if (!over && f.playerHp < p.playerHp && f.playerHp > 0) {
      // 피격: 런 진행 중 HP 감소(종료 후에는 억제 — 사후 배열 변동 오발 차단).
      this.audio.play('hit');
    }

    // 드랍 등급음(AC13·AC14): 이번 프레임 실드랍 각 1회. rarity → 등급 사운드 매핑.
    for (const d of ev?.drops ?? []) {
      const name: SoundName = d.rarity >= 3 ? 'dropUnique' : d.rarity === 2 ? 'dropRare' : 'dropCommon';
      this.audio.play(name, d.pan !== undefined ? { pan: d.pan } : undefined);
    }

    // 특수탄/보스탄 경고(AC19): false→true rising-edge 에서만 1회(스로틀은 VoiceAllocator 백스톱).
    const warn = ev?.warn === true;
    if (warn && !this.prevWarn) this.audio.play('warn');
    this.prevWarn = warn;
  }
}
