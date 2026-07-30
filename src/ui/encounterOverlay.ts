/**
 * 조우(Encounter) 프롬프트 오버레이 — DOM. 조우 프레임워크(ADR-0033)의 **입력 배선 절반**이다.
 *
 * ## 왜 이 파일이 존재해야 하는가 (이 저장소의 반복 결함)
 * sim 은 `SPECIAL_ENCOUNTER_*` 비트를 읽을 준비가 완벽히 돼 있었지만, 그 비트를 **만들어 내는
 * 프로덕션 경로가 통째로 없었다** — 조우 5종 중 3종이 실제 플레이에서 도달 불가였고, 포탈은
 * 런이 끝날 때까지 떠 있기만 했다. "단위 테스트는 그린인데 배선이 통째로 없다"는 이 저장소가
 * 여덟 번 겪은 결함과 정확히 같은 형태다. 이 오버레이 + `InputController.queueEncounter*` 가
 * 그 빠진 절반이고, `tests/encounterInputWiring.test.ts` 가 다시 빠지지 않게 못 박는다.
 *
 * ## 정본으로 삼은 선례: {@link ../ui/powerupOverlay.ts | PowerupOverlay}
 *  - **DOM 오버레이**다(Pixi 캔버스 UI 아님). 이 프로젝트는 캔버스로 옮긴 UI 가 남은 DOM
 *    오버레이 **아래로 내려가고 z-index 로 뒤집을 수 없다**는 함정이 있다(ADR-0014 롤아웃 기록).
 *    파워업 오버레이가 DOM 인 이상 그 위/아래 관계를 예측 가능하게 두려면 같은 층에 있어야 한다.
 *  - **스스로 토글하지 않는다.** 표시/숨김은 렌더 루프가 sim 상태(`encounterRuntime`)를 근거로
 *    구동한다({@link encounterPromptView}). 클릭 시 낙관적으로 숨기면 sim 이 아직 상태를 안 바꾼
 *    프레임에 재표시되는 레이스가 생긴다(파워업이 실제로 겪은 결함).
 *  - **선택은 반드시 컨트롤러 큐를 거친다.** `stepWorld` 직접 호출 금지 — 입력 프레임에 실리지
 *    않은 선택은 리플레이에 존재하지 않는 사건이 되고 서버 재검증(EF)이 갈린다.
 *
 * ## 키 바인딩과 충돌 검토
 * 진입/개방 `KeyE` · 거부 `KeyQ` · 제단 3택 `Digit1~3`(+`Numpad1~3`) · detour 이탈 `KeyQ`.
 * `src/input/controller.ts` 는 `KeyW/A/S/D`·화살표·`Space`·`KeyZ`·`KeyX`(액티브 스킬,
 * ADR-0041) 를 쓰므로 이동/대시/액티브와 충돌이 없다. detour 이탈이 예전엔 `KeyX` 였으나
 * 액티브 슬롯 2(z/x) 와 겹쳐 `KeyQ` 로 이설했다 — 조우 거부와 같은 코드지만 detour 분기가
 * 먼저 처리되고 조기 return 하므로 상호 배타라 비충돌이다(아래 {@link EncounterOverlay.onKeyDown}).
 * `Digit1~3` 은 파워업 오버레이도 쓰지만 **서로 동시에 뜨지 않는다** — 렌더 루프가 레벨업
 * 오버레이가 떠 있는 동안 이 오버레이에 `null` 을 먹여 숨기고, 아래 키 핸들러는 `visible`
 * 게이트로 즉시 return 한다. 컨트롤러 큐 자체도 파워업 픽이 대기 중이면 소비되지 않는다.
 *
 * ## 수치 규율
 * 문구·레이아웃만 소유한다. 표시 시간·프롬프트 지속 등 밸런스 수치는 여기서 정하지 않는다
 * (TODO(밸런스): 출시 직전 일괄 튜닝 대상).
 *
 * ## 이모지 금지
 * 문구에 컬러 이모지를 넣지 않는다 — 같은 문자열이 Pixi 텍스트로 흐르면 두부로 깨진다
 * (`src/ui/pixi/text.ts` 의 `stripEmoji`).
 */

import { t } from '../i18n/index.js';
import { ENCOUNTER_TYPE } from '../../data/encounters.js';
import type { EncounterRuntime } from '../sim/encounter.js';

/** 60fps 고정 틱 → 초 변환 분모(sim `DT` 와 같은 축, 표시 전용). */
const TICKS_PER_SECOND = 60;

/**
 * 프롬프트 형태.
 *  - `binary`  진입/개방 vs 거부 2지 선택(보물 격실 포탈 · 봉인 수호자)
 *  - `altar`   오스카 제단 3택(+거부)
 *  - `detour`  격실 안 — 조기 이탈 + 잔여 시간
 */
export type EncounterPromptKind = 'binary' | 'altar' | 'detour';

/** 이 프레임에 표시할 프롬프트(널이면 아무것도 표시하지 않는다). */
export interface EncounterPromptView {
  readonly kind: EncounterPromptKind;
  /** ENCOUNTER_TYPE 값 — 제목/설명 문구 선택에 쓴다. */
  readonly type: number;
  /** detour 잔여 틱(`kind === 'detour'` 일 때만 의미 있음). */
  readonly detourTimer: number;
}

/** 오버레이가 되돌려 주는 선택. 호출부는 전부 `controller.queueEncounter*` 로 잇는다. */
export interface EncounterOverlayHandlers {
  readonly onEnter: () => void;
  readonly onDecline: () => void;
  readonly onAltarPick: (index: number) => void;
  readonly onExit: () => void;
}

/**
 * sim 조우 런타임 → 이 프레임의 프롬프트(순수 함수 — 테스트 대상).
 *
 * `state` 코드는 `src/sim/encounter.ts` 계약이다: 0 대기 · 1 출현 · 2 진행중 · 3 완료 · 4 거부.
 * **1(출현)에서만** 진입/거부/선택 입력이 sim 에 먹으므로 프롬프트도 그때만 띄운다. 파편우·
 * 보급선단은 opt-in 입력이 없는 인라인 유형이라(자동 개시) 프롬프트가 없다 — 거부만 가능하지만
 * 인라인 조우는 방해 요소가 아니라 보너스라서 굳이 거부 UI 를 노출하지 않는다.
 *
 * `inDetour` 를 state 보다 **먼저** 보는 것이 중요하다: 격실 안에서는 state 가 2(진행중)이고
 * 화면에 필요한 것은 진입 프롬프트가 아니라 이탈 프롬프트다.
 */
export function encounterPromptView(
  rt: EncounterRuntime | undefined,
): EncounterPromptView | null {
  if (rt === undefined) return null;
  if (rt.inDetour === 1) {
    return { kind: 'detour', type: rt.type, detourTimer: rt.detourTimer };
  }
  if (rt.state !== 1) return null;
  if (rt.type === ENCOUNTER_TYPE.treasureVault || rt.type === ENCOUNTER_TYPE.sealedGuardian) {
    return { kind: 'binary', type: rt.type, detourTimer: 0 };
  }
  if (rt.type === ENCOUNTER_TYPE.oscarAltar) {
    return { kind: 'altar', type: rt.type, detourTimer: 0 };
  }
  return null;
}

/** 두 프롬프트가 **같은 DOM 을 재사용해도 되는가**(형태·유형이 같으면 텍스트만 갱신). */
function sameShape(a: EncounterPromptView | null, b: EncounterPromptView | null): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.type === b.type;
}

const STYLE = `
#pb-encounter { position:absolute; left:0; right:0; bottom:6%; display:flex; flex-direction:column; align-items:center; gap:10px; font-family:'Segoe UI',system-ui,sans-serif; z-index:18; pointer-events:none; }
#pb-encounter .pb-enc-box { display:flex; flex-direction:column; align-items:center; gap:10px; max-width:760px; padding:14px 22px; background:linear-gradient(160deg,#141a2e,#0b0f1c); border:2px solid #3a4a78; border-radius:14px; box-shadow:0 10px 30px rgba(0,0,0,.55); pointer-events:auto; }
#pb-encounter .pb-enc-title { color:#ffd479; font-size:20px; font-weight:800; letter-spacing:1px; text-shadow:0 2px 8px #000; }
#pb-encounter .pb-enc-desc { color:#aab6d6; font-size:13px; line-height:1.5; text-align:center; }
#pb-encounter .pb-enc-row { display:flex; gap:12px; flex-wrap:wrap; justify-content:center; }
#pb-encounter .pb-enc-btn { min-width:150px; padding:10px 16px; background:linear-gradient(160deg,#1a2340,#101728); border:2px solid #2a3552; border-radius:10px; color:#e8f0ff; font-size:14px; font-weight:700; cursor:pointer; text-align:center; transition:transform .1s ease,border-color .1s ease,box-shadow .1s ease; }
#pb-encounter .pb-enc-btn:hover { transform:translateY(-4px); border-color:#4cd7ff; box-shadow:0 8px 22px rgba(76,215,255,.25); }
#pb-encounter .pb-enc-btn.decline { min-width:110px; color:#8896b8; }
#pb-encounter .pb-enc-btn .sub { display:block; margin-top:6px; color:#8896b8; font-size:12px; font-weight:400; }
#pb-encounter .pb-enc-key { display:inline-block; min-width:22px; height:22px; line-height:22px; padding:0 6px; margin-right:8px; border-radius:5px; background:#4cd7ff; color:#04121a; font-weight:800; font-size:12px; }
#pb-encounter .pb-enc-hint { color:#68789c; font-size:12px; letter-spacing:1px; }
#pb-encounter .pb-enc-timer { color:#7affea; font-size:16px; font-weight:800; }
`;

/**
 * 제단 3택 카드 정의(키 라벨 + 문구 키). **배열 순서 = 선택 인덱스**이고 그 인덱스가 그대로
 * `packEncounterAltar` 로 실려 sim `stepAltar` 의 분기(0 즉시 보상 · 1 부스트 · 2 봉인 상자)에
 * 대응한다 — 재배치하면 화면과 sim 이 갈린다. 키 매핑 자체는 {@link EncounterOverlay.onKeyDown}
 * 이 소유한다(여기 라벨은 표시 전용).
 */
const ALTAR_CHOICES = [
  { key: '1', name: 'encounter.altar.0.name', desc: 'encounter.altar.0.desc' },
  { key: '2', name: 'encounter.altar.1.name', desc: 'encounter.altar.1.desc' },
  { key: '3', name: 'encounter.altar.2.name', desc: 'encounter.altar.2.desc' },
] as const;

export class EncounterOverlay {
  private readonly root: HTMLElement;
  /** 현재 붙어 있는 프롬프트(널 = 숨김). 형태가 같으면 DOM 을 다시 만들지 않는다. */
  private current: EncounterPromptView | null = null;
  /** detour 잔여 시간 텍스트 노드(매 프레임 갱신 대상). */
  private timerEl: HTMLElement | null = null;

  constructor(private readonly handlers: EncounterOverlayHandlers) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.id = 'pb-encounter';
    this.root.style.display = 'none';
    document.body.appendChild(this.root);

    window.addEventListener('keydown', this.onKeyDown);
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  /**
   * 키 입력 → 컨트롤러 큐. **보이지 않을 때는 어떤 키도 먹지 않는다** — 이 게이트가
   * 파워업 오버레이의 `Digit1~3` 과의 유일한 충돌 방지 장치다(렌더 루프가 레벨업 중에는
   * 이 오버레이를 숨긴다).
   */
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const view = this.current;
    if (!this.visible || view === null) return;
    if (view.kind === 'detour') {
      // KeyX → KeyQ 이설(액티브 슬롯 2 와의 충돌 회피). 이 분기가 아래 KeyQ(조우 거부)보다
      // 먼저 처리되고 조기 return 하므로 같은 코드를 써도 상호 배타라 비충돌이다.
      if (e.code === 'KeyQ') {
        e.preventDefault();
        this.handlers.onExit();
      }
      return;
    }
    if (e.code === 'KeyQ') {
      e.preventDefault();
      this.handlers.onDecline();
      return;
    }
    if (view.kind === 'binary') {
      if (e.code === 'KeyE') {
        e.preventDefault();
        this.handlers.onEnter();
      }
      return;
    }
    // 제단 3택. 숫자열·넘패드 둘 다 받는다(파워업 오버레이 선례).
    const map: Record<string, number> = {
      Digit1: 0, Digit2: 1, Digit3: 2,
      Numpad1: 0, Numpad2: 1, Numpad3: 2,
    };
    const idx = map[e.code];
    if (idx !== undefined) {
      e.preventDefault();
      this.handlers.onAltarPick(idx);
    }
  };

  /**
   * 이 프레임의 프롬프트를 반영한다. 렌더 루프가 **매 프레임** 부르는 것이 계약이다 —
   * 오버레이가 스스로 상태를 기억해 토글하면 sim 과 화면이 갈린다(파워업 선례).
   */
  update(view: EncounterPromptView | null): void {
    if (view === null) {
      this.hide();
      return;
    }
    if (!sameShape(this.current, view)) {
      this.build(view);
    }
    this.current = view;
    if (this.timerEl !== null) {
      const sec = Math.ceil(view.detourTimer / TICKS_PER_SECOND);
      this.timerEl.textContent = t('encounter.detour.remain', { sec });
    }
    this.root.style.display = 'flex';
  }

  hide(): void {
    if (this.visible) {
      this.root.style.display = 'none';
      this.root.innerHTML = '';
      this.timerEl = null;
    }
    this.current = null;
  }

  /** 버튼 하나(키 배지 + 라벨 + 선택적 부제). */
  private button(key: string, label: string, sub: string, cls: string, onClick: () => void): HTMLElement {
    const btn = document.createElement('div');
    btn.className = `pb-enc-btn${cls === '' ? '' : ` ${cls}`}`;
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', sub === '' ? label : `${label} — ${sub}`);
    const badge = document.createElement('span');
    badge.className = 'pb-enc-key';
    badge.textContent = key;
    btn.appendChild(badge);
    btn.append(label);
    if (sub !== '') {
      const s = document.createElement('span');
      s.className = 'sub';
      s.textContent = sub;
      btn.appendChild(s);
    }
    btn.addEventListener('click', onClick);
    return btn;
  }

  /** 프롬프트 DOM 을 새로 짓는다(형태가 바뀔 때만 — {@link sameShape}). */
  private build(view: EncounterPromptView): void {
    this.root.innerHTML = '';
    this.timerEl = null;

    const box = document.createElement('div');
    box.className = 'pb-enc-box';
    const title = document.createElement('div');
    title.className = 'pb-enc-title';
    const desc = document.createElement('div');
    desc.className = 'pb-enc-desc';
    const row = document.createElement('div');
    row.className = 'pb-enc-row';
    const hint = document.createElement('div');
    hint.className = 'pb-enc-hint';

    if (view.kind === 'detour') {
      title.textContent = t('encounter.detour.title');
      const timer = document.createElement('div');
      timer.className = 'pb-enc-timer';
      this.timerEl = timer;
      desc.appendChild(timer);
      row.appendChild(
        this.button('Q', t('encounter.detour.exit'), '', '', () => this.handlers.onExit()),
      );
      hint.textContent = t('encounter.hint.keys', { keys: 'Q' });
    } else if (view.kind === 'altar') {
      title.textContent = t('encounter.altar.title');
      desc.textContent = t('encounter.altar.desc');
      ALTAR_CHOICES.forEach((c, i) => {
        row.appendChild(
          this.button(c.key, t(c.name), t(c.desc), '', () => this.handlers.onAltarPick(i)),
        );
      });
      row.appendChild(
        this.button('Q', t('encounter.action.decline'), '', 'decline', () =>
          this.handlers.onDecline(),
        ),
      );
      hint.textContent = t('encounter.hint.keys', { keys: '1 / 2 / 3 / Q' });
    } else {
      // binary — 보물 격실 포탈 vs 봉인 수호자. 진입 문구만 다르다.
      const guardian = view.type === ENCOUNTER_TYPE.sealedGuardian;
      title.textContent = guardian ? t('encounter.guardian.title') : t('encounter.vault.title');
      desc.textContent = guardian ? t('encounter.guardian.desc') : t('encounter.vault.desc');
      row.appendChild(
        this.button(
          'E',
          guardian ? t('encounter.action.open') : t('encounter.action.enter'),
          '',
          '',
          () => this.handlers.onEnter(),
        ),
      );
      row.appendChild(
        this.button('Q', t('encounter.action.decline'), '', 'decline', () =>
          this.handlers.onDecline(),
        ),
      );
      hint.textContent = t('encounter.hint.keys', { keys: 'E / Q' });
    }

    box.appendChild(title);
    box.appendChild(desc);
    box.appendChild(row);
    box.appendChild(hint);
    this.root.appendChild(box);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
  }
}
