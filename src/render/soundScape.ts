/**
 * 런 사운드 관찰자 (M5 Phase C1 — plan §4, AC8).
 *
 * sim 스냅샷/요약을 프레임마다 **관찰**해 사운드 트리거를 파생한다. sim 은 소리를 전혀 모른다
 * (단방향 sim → render, ADR-0005). 이 클래스는 이전 프레임 대비 델타(처치 증가·레벨업·피격·
 * 픽업·보스 등장·발사)를 감지해 {@link GameAudio} 를 호출한다. 세리머니({@link UniqueCeremony})
 * 와 동일한 "스냅샷 델타 관찰" 패턴이다.
 *
 * 렌더 전용 — 해시/리플레이/정산에 전혀 영향 없다.
 */

import type { GameAudio } from './audio.js';

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
  /** 보스 엔티티 존재 여부(등장 감지). */
  hasBoss: boolean;
  /** 플레이어 탄환 수(발사 감지 — 증가분만 신규 발사로 취급). */
  bulletCount: number;
}

export class RunSoundObserver {
  private prev: SoundFrame | null = null;

  constructor(private readonly audio: GameAudio) {}

  /** 새 런 시작 시 호출 — 델타 기준선을 리셋(런마다 수치가 0부터 다시 시작). */
  reset(): void {
    this.prev = null;
  }

  /** 이번 프레임 요약을 관찰해 필요한 사운드를 재생한다. 매 프레임 안전 호출. */
  observe(f: SoundFrame): void {
    const p = this.prev;
    this.prev = f;
    if (p === null) return; // 첫 프레임: 기준선만 세우고 소리 없음.

    if (f.level > p.level) this.audio.play('levelUp');
    if (f.hasBoss && !p.hasBoss) this.audio.play('boss');
    if (f.kills > p.kills) this.audio.play('kill');
    if (f.resources > p.resources) this.audio.play('pickup');
    if (f.bulletCount > p.bulletCount) this.audio.play('shot');
    // 피격: HP 가 줄었고 아직 살아 있으면 'hit', 0 이하로 떨어지는 순간이면 'eject'(격추 사출).
    if (f.playerHp < p.playerHp) {
      if (f.playerHp <= 0 && p.playerHp > 0) this.audio.play('eject');
      else if (f.playerHp > 0) this.audio.play('hit');
    }
  }
}
