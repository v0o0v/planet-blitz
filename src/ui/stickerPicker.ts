/**
 * 도발 스티커 선택 UI (F2, AC12) — 침공/방어 성공 후 12종 그리드에서 1개 선택.
 *
 * 문구·인덱스 정본은 `data/stickers.ts`(서버는 smallint 0..11 만 저장). 선택하면
 * `onPick(index)` 로 상위(main/controlTower)에 넘겨 서버 `set_invasion_sticker` 를 호출한다.
 * 자유 입력 경로는 없다(사전 세트 전용, fun-factors Constraints). 렌더/입력 전용.
 */

import { STICKERS } from '../../data/stickers.js';

const STYLE = `
#pb-stk { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; padding:24px; box-sizing:border-box; background:rgba(4,3,10,.78); backdrop-filter:blur(4px); z-index:33; font-family:'Segoe UI',system-ui,sans-serif; }
#pb-stk h2 { margin:0; color:#c86aff; font-size:20px; font-weight:900; letter-spacing:1px; text-align:center; }
#pb-stk .pb-stk-sub { color:#8896b8; font-size:12px; margin-top:-6px; text-align:center; max-width:520px; }
#pb-stk .pb-stk-grid { display:grid; grid-template-columns:repeat(3,minmax(150px,1fr)); gap:10px; width:min(560px,92vw); }
#pb-stk .pb-stk-item { pointer-events:auto; cursor:pointer; display:flex; align-items:center; gap:8px; padding:11px 12px; border:1px solid #2a3552; border-radius:11px; background:rgba(18,20,40,.9); color:#e6ecff; font-size:13px; text-align:left; line-height:1.25; }
#pb-stk .pb-stk-item:hover { border-color:#c86aff; box-shadow:0 0 0 1px #c86aff inset; }
#pb-stk .pb-stk-item .em { font-size:20px; flex:0 0 auto; }
#pb-stk .pb-stk-skip { pointer-events:auto; cursor:pointer; margin-top:4px; padding:8px 18px; font-size:13px; font-weight:700; color:#aab6d6; background:rgba(20,24,44,.9); border:1px solid #2a3552; border-radius:10px; }
`;

/** 스티커 선택 콜백. */
export interface StickerPickerCallbacks {
  /** 스티커 1개 선택(index = STICKERS 배열 위치 = 서버 smallint). */
  onPick: (index: number) => void;
  /** 스티커 없이 넘어가기(선택은 선택 사항 — 도발 안 함). */
  onSkip: () => void;
}

/** show() 옵션. */
export interface StickerPickerShowOpts {
  /** 제목 문구(예: "침공 성공! 도발 스티커를 남기시겠어요?"). */
  title: string;
  /** 부제(상대 이름 등 맥락). 생략 가능. */
  subtitle?: string;
}

/** 도발 스티커 선택 오버레이(12종 그리드 + 건너뛰기). */
export class StickerPicker {
  private readonly root: HTMLElement;
  private cb: StickerPickerCallbacks | null = null;

  constructor() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'pb-stk';
    this.root.style.display = 'none';
    document.body.appendChild(this.root);
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  show(cb: StickerPickerCallbacks, opts: StickerPickerShowOpts): void {
    this.cb = cb;
    this.root.innerHTML = '';

    const h2 = document.createElement('h2');
    h2.textContent = opts.title;
    this.root.appendChild(h2);
    if (opts.subtitle !== undefined && opts.subtitle.length > 0) {
      const sub = document.createElement('div');
      sub.className = 'pb-stk-sub';
      sub.textContent = opts.subtitle;
      this.root.appendChild(sub);
    }

    const grid = document.createElement('div');
    grid.className = 'pb-stk-grid';
    STICKERS.forEach((sticker, index) => {
      const item = document.createElement('button');
      item.className = 'pb-stk-item';
      item.type = 'button';
      const em = document.createElement('span');
      em.className = 'em';
      em.textContent = sticker.emoji;
      const txt = document.createElement('span');
      txt.textContent = sticker.text;
      item.append(em, txt);
      item.title = sticker.text;
      item.addEventListener('click', () => {
        const cbk = this.cb;
        this.hide();
        cbk?.onPick(index);
      });
      grid.appendChild(item);
    });
    this.root.appendChild(grid);

    const skip = document.createElement('button');
    skip.className = 'pb-stk-skip';
    skip.type = 'button';
    skip.textContent = '스티커 없이 넘어가기';
    skip.addEventListener('click', () => {
      const cbk = this.cb;
      this.hide();
      cbk?.onSkip();
    });
    this.root.appendChild(skip);

    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
    this.cb = null;
  }
}
