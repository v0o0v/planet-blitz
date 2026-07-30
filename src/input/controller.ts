/**
 * Keyboard + mouse input -> per-tick sim InputFrame.
 *
 * This layer lives entirely outside the sim core. It samples live device state
 * and produces an {@link InputFrame} that the game loop feeds to `stepWorld` and
 * records into the replay log. It must never write to sim state directly.
 */

import type { InputFrame } from '../sim/world.js';
import { packPowerupPick } from '../sim/world.js';
import { atan2 } from '../sim/math.js';
import type { GameApp } from '../render/app.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../render/app.js';
import {
  SPECIAL_ENCOUNTER_ENTER,
  SPECIAL_ENCOUNTER_DECLINE,
  SPECIAL_ENCOUNTER_EXIT,
  packEncounterAltar,
} from '../../data/encounters.js';
import { SPECIAL_ACTIVE_SLOT1, SPECIAL_ACTIVE_SLOT2 } from '../../data/inputBits.js';

export class InputController {
  private readonly keys = new Set<string>();
  private mouseClientX = 0;
  private mouseClientY = 0;
  private dashQueued = false;
  /** Pending powerup pick (offer index 0..2), consumed by the next sample. */
  private powerupPick: number | null = null;
  /**
   * 조우(Encounter, ADR-0033) 입력 큐 — 파워업 픽과 **완전히 같은 패턴**이다. UI 오버레이가
   * 클릭/키로 이 큐에 넣고, `sample()` 이 한 번 소비해 `special` 비트로 실어 보낸다.
   *
   * 오버레이가 `stepWorld` 를 직접 부르지 않고 굳이 이 큐를 거치는 이유는 결정론이다 —
   * 조우 진입/선택은 런 경제(전리품·크레딧)를 바꾸므로 서버(EF)가 시드+입력로그 재실행으로
   * 재검증한다. 입력 프레임에 실리지 않은 선택은 리플레이에 존재하지 않는 사건이 된다.
   */
  private encounterEnter = false;
  private encounterDecline = false;
  /** 제단 3택 선택 인덱스(0..3). null = 대기 없음. */
  private encounterAltarPick: number | null = null;
  private encounterExit = false;
  /**
   * 액티브 스킬 슬롯 1/2(키 `z`/`x`, ADR-0041) 입력 큐 — 대시(`dashQueued`)와 같은 1회성
   * 소비 플래그 패턴. `sample()` 이 한 번 소비해 `SPECIAL_ACTIVE_SLOT1/2` 비트로 싣는다.
   */
  private activeSlot1Queued = false;
  private activeSlot2Queued = false;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
    if (e.code === 'Space') {
      this.dashQueued = true;
      e.preventDefault();
    }
    if (e.code === 'KeyZ') {
      this.activeSlot1Queued = true;
    }
    if (e.code === 'KeyX') {
      this.activeSlot2Queued = true;
    }
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };
  private readonly onMouseMove = (e: MouseEvent): void => {
    this.mouseClientX = e.clientX;
    this.mouseClientY = e.clientY;
  };

  constructor(private readonly gameApp: GameApp) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
  }

  /** Queue a powerup pick (offer index 0..2). Consumed by the next sample. */
  queuePowerupPick(index: number): void {
    this.powerupPick = index;
  }

  /** 조우 포탈 진입 / 봉인 개방(`SPECIAL_ENCOUNTER_ENTER`)을 큐잉한다. */
  queueEncounterEnter(): void {
    this.encounterEnter = true;
  }

  /** 조우 거부(`SPECIAL_ENCOUNTER_DECLINE`)를 큐잉한다. */
  queueEncounterDecline(): void {
    this.encounterDecline = true;
  }

  /**
   * 오스카 제단 3택(`SPECIAL_ENCOUNTER_ALTAR_PICK` + 비트 6..7 인덱스)을 큐잉한다.
   * 인덱스 검증(범위 밖 거부)은 sim(`stepAltar`)이 소유하므로 여기서 자르지 않는다 —
   * 입력층이 조용히 값을 고치면 리플레이와 화면이 갈린다.
   */
  queueEncounterAltarPick(index: number): void {
    this.encounterAltarPick = index;
  }

  /** detour 조기 이탈(`SPECIAL_ENCOUNTER_EXIT`)을 큐잉한다. */
  queueEncounterExit(): void {
    this.encounterExit = true;
  }

  /** 액티브 슬롯 1(`SPECIAL_ACTIVE_SLOT1`, 키 `z`)을 큐잉한다. 테스트 전용 진입점. */
  queueActiveSlot1(): void {
    this.activeSlot1Queued = true;
  }

  /** 액티브 슬롯 2(`SPECIAL_ACTIVE_SLOT2`, 키 `x`)를 큐잉한다. 테스트 전용 진입점. */
  queueActiveSlot2(): void {
    this.activeSlot2Queued = true;
  }

  /**
   * Sample the current input for one sim tick. Consumes the queued dash so a
   * single Space press maps to exactly one dash request, and any queued powerup
   * pick (packed into `special` for the replay log).
   *
   * ## 파워업 픽과 조우 비트의 동시 프레임 규율 (중요)
   * `stepWorld` 최상단은 `pendingLevelUp` 이면 **파워업만 처리하고 즉시 return** 한다 —
   * 그 프레임의 조우 비트는 sim 이 한 번도 읽지 않고 버려진다. 그래서 두 종류를 한
   * 프레임에 같이 실으면 조우 입력이 **조용히 증발**한다(플레이어는 눌렀는데 아무 일도
   * 안 일어나고, 서버 재검증도 그 이유를 설명할 수 없다).
   *
   * 그래서 파워업 픽이 대기 중이면 **조우 큐를 소비하지 않고 그대로 유지**한다. 조우
   * 입력은 프리즈가 풀린 다음 프레임에 온전히 실려 나간다. 반대 선택(조우 우선)은
   * 레벨업 프리즈를 영원히 못 푸는 교착을 만들 수 있어 택하지 않았다.
   *
   * 액티브 스킬(z/x, ADR-0041)도 조우 비트와 같은 결로 맞춘다 — 파워업 픽 대기 중에는
   * 큐를 소비하지 않고 **버린다**(ADR-0041 "프리즈 중 입력은 버린다, 큐잉 금지"). 조우처럼
   * 프리즈 해제 후로 이월하지 않는 이유는 액티브 발동이 그 순간의 전황(적 밀집·체력)에
   * 반응하는 입력이라 프리즈가 몇 프레임이든 걸릴 수 있는 픽 UI 뒤로 미루면 플레이어가
   * 누른 시점의 의도와 실제 발동 시점이 어긋나기 때문이다 — 조우처럼 되돌릴 수 없는 선택이
   * 아니라 다시 누르면 되는 입력이므로 유실 비용이 낮다.
   */
  sample(playerX: number, playerY: number): InputFrame {
    let moveX = 0;
    let moveY = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveY -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveY += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) moveX -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) moveX += 1;

    // Mouse → world coordinates. `clientToDesign` maps the cursor into the fixed
    // 1920x1080 design viewport; the camera (= player) sits at the viewport
    // centre, so undo that offset to recover where the cursor points in the
    // infinite world. Aim is then a world-space angle, keeping auto-aim and dash
    // consistent with the scrolled camera.
    const design = this.gameApp.clientToDesign(this.mouseClientX, this.mouseClientY);
    const worldX = design.x - DESIGN_WIDTH / 2 + playerX;
    const worldY = design.y - DESIGN_HEIGHT / 2 + playerY;
    const aim = atan2(worldY - playerY, worldX - playerX);

    const dash = this.dashQueued;
    this.dashQueued = false;

    let special = 0;
    if (this.powerupPick !== null) {
      special = packPowerupPick(this.powerupPick);
      this.powerupPick = null;
      // 조우 큐는 **일부러 소비하지 않는다** — 위 "동시 프레임 규율" 주석 참조.
      // 액티브 슬롯 큐는 반대로 **여기서 버린다**(소비하지 않고 리셋) — ADR-0041
      // "프리즈 중 입력은 버린다(큐잉 금지)". 조우처럼 이월하면 프리즈 해제 후 뒤늦게
      // 발동해 플레이어가 누른 시점의 전황과 어긋난다.
      this.activeSlot1Queued = false;
      this.activeSlot2Queued = false;
    } else {
      // 조우 비트는 비트 3 이상만 쓰므로(data/encounters.ts 배치 계약) 파워업이 점유한
      // 비트 0..2 를 절대 오염시키지 않는다. 여러 종류가 동시에 큐잉되는 것은 UI 상
      // 일어나지 않지만, 일어나더라도 각 비트가 독립이라 sim 이 자기 규칙대로 판정한다
      // (예: 거부가 진입보다 먼저 읽힌다 — stepVault).
      if (this.encounterEnter) {
        special |= SPECIAL_ENCOUNTER_ENTER;
        this.encounterEnter = false;
      }
      if (this.encounterDecline) {
        special |= SPECIAL_ENCOUNTER_DECLINE;
        this.encounterDecline = false;
      }
      if (this.encounterAltarPick !== null) {
        special |= packEncounterAltar(this.encounterAltarPick);
        this.encounterAltarPick = null;
      }
      if (this.encounterExit) {
        special |= SPECIAL_ENCOUNTER_EXIT;
        this.encounterExit = false;
      }
      // 액티브 슬롯 1/2(비트 9·10, ADR-0041) — 조우 비트들 다음에 append. 파워업 픽이
      // 대기 중이 아닐 때만 소비된다(위 파워업 분기의 큐 폐기 주석 참조).
      if (this.activeSlot1Queued) {
        special |= SPECIAL_ACTIVE_SLOT1;
        this.activeSlot1Queued = false;
      }
      if (this.activeSlot2Queued) {
        special |= SPECIAL_ACTIVE_SLOT2;
        this.activeSlot2Queued = false;
      }
    }

    return { moveX, moveY, aim, dash, special };
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
  }
}
