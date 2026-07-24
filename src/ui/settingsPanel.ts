/**
 * 설정 패널 (M5 Phase C1/C3 — plan §4, AC8; CrazyGames QA "볼륨 조절").
 *
 * 화면 좌상단 고정 톱니 버튼 → 음소거 토글 + 볼륨 슬라이더 + 언어 전환(영어/한국어). 볼륨
 * 조절 가능은 CrazyGames 포털 QA 필수 항목이다. 언어 전환은 즉시 저장되고, 열려 있는 메뉴
 * 화면을 다시 그리도록 `onLocaleChange` 콜백을 호출한다.
 *
 * 순수 DOM/UI 레이어 — sim/결정론 무관. 오디오 설정은 {@link GameAudio} 가, 로케일은 i18n 이
 * 소유하고 이 패널은 그 뷰/컨트롤러다.
 */

import type { GameAudio, AudioSettings } from '../render/audio.js';
import { getLocale, setLocale, LOCALES, type Locale } from '../i18n/index.js';
import { t } from '../i18n/index.js';

const STYLE = `
#pb-settings-btn { position:fixed; left:16px; top:14px; z-index:60; width:38px; height:38px; display:flex; align-items:center; justify-content:center; font-size:20px; cursor:pointer; color:#aab6d6; background:rgba(8,12,24,.72); border:1px solid #2a3552; border-radius:10px; transition:color .1s ease,border-color .1s ease,transform .1s ease; pointer-events:auto; }
#pb-settings-btn:hover { color:#7affea; border-color:#4cd7ff; transform:rotate(35deg); }
#pb-settings-panel { position:fixed; left:16px; top:60px; z-index:61; width:248px; padding:16px 18px; background:linear-gradient(160deg,#111a2e,#0a0e1a); border:1px solid #2a3552; border-radius:14px; box-shadow:0 12px 34px rgba(0,0,0,.55); font-family:'Segoe UI',system-ui,sans-serif; pointer-events:auto; }
#pb-settings-panel h3 { margin:0 0 12px; color:#7affea; font-size:15px; font-weight:800; letter-spacing:1px; }
#pb-settings-panel .pb-set-row { display:flex; align-items:center; justify-content:space-between; gap:10px; margin:10px 0; }
#pb-settings-panel .pb-set-lbl { color:#aab6d6; font-size:13px; }
#pb-settings-panel .pb-toggle { cursor:pointer; padding:5px 14px; font-size:12px; font-weight:700; border-radius:8px; border:1px solid #2a3552; background:rgba(12,16,30,.7); color:#aab6d6; }
#pb-settings-panel .pb-toggle.on { color:#04121a; background:linear-gradient(90deg,#4cd7ff,#7affea); border-color:transparent; }
#pb-settings-panel input[type=range] { width:120px; accent-color:#4cd7ff; cursor:pointer; }
#pb-settings-panel .pb-langs { display:flex; gap:6px; }
#pb-settings-panel .pb-lang { cursor:pointer; padding:5px 12px; font-size:12px; font-weight:700; border-radius:8px; border:1px solid #2a3552; background:rgba(12,16,30,.7); color:#aab6d6; }
#pb-settings-panel .pb-lang.sel { color:#04121a; background:linear-gradient(90deg,#4cd7ff,#7affea); border-color:transparent; }
#pb-settings-panel .pb-close { margin-top:12px; width:100%; cursor:pointer; padding:8px; font-size:12px; font-weight:700; color:#aab6d6; background:rgba(12,16,30,.7); border:1px solid #2a3552; border-radius:8px; }
`;

const LANG_KEY: Record<Locale, 'settings.lang.en' | 'settings.lang.ko'> = {
  en: 'settings.lang.en',
  ko: 'settings.lang.ko',
};

export class SettingsPanel {
  private readonly btn: HTMLElement;
  private readonly panel: HTMLElement;
  private open = false;

  /**
   * @param audio 볼륨/음소거를 소유하는 사운드 보드.
   * @param onLocaleChange 언어 전환 후 호출(열린 메뉴 화면 재렌더용).
   */
  constructor(
    private readonly audio: GameAudio,
    private readonly onLocaleChange: () => void,
  ) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    this.btn = document.createElement('div');
    this.btn.id = 'pb-settings-btn';
    this.btn.textContent = '⚙';
    this.btn.setAttribute('role', 'button');
    this.btn.setAttribute('aria-label', t('settings.open'));
    this.btn.addEventListener('click', () => {
      // 첫 클릭이 오디오 잠금 해제 제스처를 겸한다(자동재생 정책).
      this.audio.unlock();
      this.toggle();
    });

    this.panel = document.createElement('div');
    this.panel.id = 'pb-settings-panel';
    this.panel.style.display = 'none';

    document.body.appendChild(this.btn);
    document.body.appendChild(this.panel);
  }

  private toggle(): void {
    this.open = !this.open;
    if (this.open) this.render();
    this.panel.style.display = this.open ? 'block' : 'none';
  }

  private render(): void {
    const s = this.audio.getSettings();
    this.panel.innerHTML = '';

    const title = document.createElement('h3');
    title.textContent = t('settings.title');
    this.panel.appendChild(title);

    // 음소거 토글.
    this.panel.appendChild(
      this.row(t('settings.mute'), this.muteToggle(s)),
    );
    // 볼륨 슬라이더.
    this.panel.appendChild(this.row(t('settings.volume'), this.volumeSlider(s)));
    // 언어 전환.
    this.panel.appendChild(this.row(t('settings.language'), this.langButtons()));

    const close = document.createElement('button');
    close.className = 'pb-close';
    close.textContent = t('common.close');
    close.addEventListener('click', () => this.toggle());
    this.panel.appendChild(close);
  }

  private row(label: string, control: HTMLElement): HTMLElement {
    const row = document.createElement('div');
    row.className = 'pb-set-row';
    const lbl = document.createElement('span');
    lbl.className = 'pb-set-lbl';
    lbl.textContent = label;
    row.appendChild(lbl);
    row.appendChild(control);
    return row;
  }

  private muteToggle(s: AudioSettings): HTMLElement {
    const btn = document.createElement('button');
    const paint = (muted: boolean): void => {
      btn.className = `pb-toggle${muted ? '' : ' on'}`;
      btn.textContent = muted ? t('settings.off') : t('settings.on');
    };
    paint(s.muted);
    btn.addEventListener('click', () => {
      const next = !this.audio.getSettings().muted;
      this.audio.setMuted(next);
      paint(next);
    });
    return btn;
  }

  private volumeSlider(s: AudioSettings): HTMLElement {
    // 이 DOM 패널은 ADR-0014 로 사문화됐고(라이브 UI 는 Pixi SettingsScreen — 버스별 슬라이더
    // 3개), 미참조 DOM 클래스 일괄 삭제 대기 상태다. 3버스 도입 후에도 컴파일만 유지하도록,
    // 남은 단일 슬라이더는 3버스를 동일 볼륨으로 일괄 조절한다(대표값은 SFX 버스로 표시).
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.step = '1';
    input.value = String(Math.round(s.sfxVolume * 100));
    input.addEventListener('input', () => {
      const v = Number(input.value) / 100;
      this.audio.setBusVolume('bgm', v);
      this.audio.setBusVolume('sfx', v);
      this.audio.setBusVolume('ui', v);
    });
    return input;
  }

  private langButtons(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'pb-langs';
    const cur = getLocale();
    for (const loc of LOCALES) {
      const b = document.createElement('button');
      b.className = `pb-lang${loc === cur ? ' sel' : ''}`;
      b.textContent = t(LANG_KEY[loc]);
      b.addEventListener('click', () => {
        if (loc === getLocale()) return;
        setLocale(loc);
        this.render(); // 패널 자체를 새 언어로 다시 그린다.
        this.onLocaleChange(); // 열린 메뉴 화면 재렌더.
      });
      wrap.appendChild(b);
    }
    return wrap;
  }
}
