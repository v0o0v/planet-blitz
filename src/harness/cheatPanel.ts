/**
 * 치트 패널 (개발 도구, DEV 전용 — ADR-0008).
 *
 * A collapsible bottom-right DOM overlay that drives the harness for manual
 * testing: 재생 제어(속도/일시정지/스텝/ff), 스크린 점프 + 시드 런 런처, 세그먼트/보스
 * 점프, 치트(무적/힐/레벨업/재화·장비 지급), 스폰 제어(적탄 소거/전멸/정예·보스 소환),
 * 그리고 라이브 인스펙터(snapshot + 이벤트 + 엔티티 목록). 모든 상태 변경은
 * `harness.cheat()`(또는 프로필 지급)을 거쳐 오염 런(markTainted)으로 표시된다.
 *
 * 프로덕션 미포함: main.ts가 `import.meta.env.DEV` 가드 안에서만 이 모듈을 동적
 * import 하므로, 프로덕션 번들에서는 트리 셰이킹으로 완전히 제거된다(정적 false 분기).
 *
 * 이 파일은 sim/save를 절대 수정하지 않는다 — 순수 read-only import만 사용하고,
 * 세그먼트/보스/정예 점프는 `harness.cheat()`로 라이브 월드 상태를 변형해 구현한다
 * (점프는 본질적으로 오염이므로 ADR-0008 상 허용).
 */

import type { Harness, HarnessScreen } from './core.js';
import type { EntitySnapshot } from '../sim/snapshot.js';
import { xpToNext } from '../sim/world.js';
import { SEGMENTS } from '../../data/waves.js';
import { makeElite, ELITE_AFFIX_COUNT, isElite } from '../sim/elite.js';
import { rollItem } from '../items/roll.js';
import type { Item, Rarity, SlotKind, EquipSlotId } from '../items/types.js';
import { EQUIP_SLOTS } from '../items/types.js';
import { activeShip } from '../save/profile.js';
import type { Profile } from '../save/profile.js';

/**
 * main.ts가 주입하는 치트 패널 호스트. 하네스 공개 API로는 닿지 않는 프로필 지급·
 * 엔티티 스냅샷 접근을 최소 위임으로 열어 준다(로직은 전부 이 파일에 있음).
 */
export interface CheatPanelHost {
  /** window.__pb.harness (재생/점프/치트/인스펙터 구동). */
  harness: Harness;
  /** 렌더 스냅샷의 엔티티 목록(read-only, 오염 없음 — 인스펙터용). */
  getEntities(): readonly EntitySnapshot[];
  /** 라이브(=활성 슬롯) 프로필 참조. */
  getProfile(): Profile;
  /** 프로필을 활성 슬롯에 영속화. */
  saveProfile(): void;
  /** 변경된 프로필로 현재 메뉴 스크린을 다시 그림. */
  refreshScreen(): void;
  /** 프로필 I/O를 격리된 하네스 프로필 슬롯으로 전환(멱등). */
  activateHarnessProfile(): void;
}

/** The equip position → slot kind it accepts. */
const SLOT_KIND_FOR: Record<EquipSlotId, SlotKind> = {
  main: 'main',
  sub: 'sub',
  armor: 'armor',
  shield: 'shield',
  engine: 'engine',
  core: 'core',
  module0: 'module',
  module1: 'module',
};

/** 장비 지급 슬롯 셀렉트의 한글 라벨. */
const SLOT_LABEL: Record<EquipSlotId, string> = {
  main: '주무기',
  sub: '보조무기',
  armor: '장갑',
  shield: '실드',
  engine: '엔진',
  core: '코어',
  module0: '모듈1',
  module1: '모듈2',
};

const RARITIES: readonly Rarity[] = ['normal', 'magic', 'rare', 'unique'];

const STYLE = `
#pb-cheat { position:absolute; right:12px; bottom:12px; z-index:60; font-family:'Segoe UI',system-ui,sans-serif; color:#dce4ff; }
#pb-cheat .pb-c-toggle { pointer-events:auto; cursor:pointer; width:36px; height:36px; border-radius:10px; border:1px solid #2a3552; background:rgba(12,16,30,.92); color:#7affea; font-size:18px; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 16px rgba(0,0,0,.5); }
#pb-cheat .pb-c-toggle:hover { border-color:#4cd7ff; }
#pb-cheat .pb-c-body { position:absolute; right:0; bottom:44px; width:328px; max-height:78vh; overflow:auto; background:rgba(6,9,18,.96); border:1px solid #2a3552; border-radius:14px; padding:12px; box-shadow:0 10px 40px rgba(0,0,0,.6); backdrop-filter:blur(4px); }
#pb-cheat .pb-c-body.hidden { display:none; }
#pb-cheat h3 { margin:0 0 6px; color:#7affea; font-size:13px; font-weight:800; letter-spacing:1px; }
#pb-cheat .pb-c-sec { border-top:1px solid rgba(255,255,255,.07); padding:9px 0 4px; }
#pb-cheat .pb-c-sec:first-of-type { border-top:none; padding-top:2px; }
#pb-cheat .pb-c-sec > .pb-c-t { color:#9fb0d8; font-size:11px; font-weight:700; letter-spacing:.5px; margin-bottom:6px; text-transform:uppercase; }
#pb-cheat .pb-c-row { display:flex; flex-wrap:wrap; gap:5px; align-items:center; margin-bottom:5px; }
#pb-cheat button.pb-c-b { pointer-events:auto; cursor:pointer; padding:5px 9px; font-size:12px; font-weight:700; color:#c3cdea; background:rgba(20,26,44,.9); border:1px solid #2a3552; border-radius:8px; }
#pb-cheat button.pb-c-b:hover:not(:disabled) { border-color:#4cd7ff; color:#fff; }
#pb-cheat button.pb-c-b.on { background:linear-gradient(90deg,#4cd7ff,#7affea); color:#04121a; border:none; }
#pb-cheat button.pb-c-b:disabled { opacity:.35; cursor:default; }
#pb-cheat input, #pb-cheat select { pointer-events:auto; background:rgba(20,26,44,.9); border:1px solid #2a3552; border-radius:7px; color:#e8ecff; font-size:12px; padding:4px 6px; box-sizing:border-box; }
#pb-cheat input[type=number] { width:64px; }
#pb-cheat input[type=text] { width:96px; }
#pb-cheat label.pb-c-chk { display:inline-flex; align-items:center; gap:4px; font-size:12px; color:#c3cdea; cursor:pointer; }
#pb-cheat .pb-c-lbl { font-size:11px; color:#8896b8; }
#pb-cheat .pb-c-badge { display:inline-block; background:#ff3355; color:#fff; font-size:12px; font-weight:900; letter-spacing:1px; padding:3px 10px; border-radius:20px; margin-bottom:8px; box-shadow:0 0 12px rgba(255,50,80,.7); }
#pb-cheat .pb-c-badge.clean { background:rgba(30,40,64,.9); color:#5f7196; box-shadow:none; }
#pb-cheat pre.pb-c-dump { margin:0; font-family:'Consolas',monospace; font-size:11px; line-height:1.35; color:#b7c6ea; white-space:pre-wrap; word-break:break-word; }
#pb-cheat .pb-c-ents { max-height:150px; overflow:auto; border:1px solid #222c46; border-radius:8px; margin-top:5px; }
#pb-cheat .pb-c-ent { display:flex; justify-content:space-between; gap:8px; font-size:11px; padding:3px 7px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,.04); }
#pb-cheat .pb-c-ent:hover { background:rgba(76,215,255,.12); }
#pb-cheat .pb-c-ent .k { color:#7affea; font-weight:700; }
#pb-cheat .pb-c-ent .p { color:#8896b8; }
#pb-cheat .pb-c-hint { color:#ffc96a; font-size:11px; min-height:13px; margin-top:4px; }
#pb-cheat .pb-c-evt { font-size:11px; color:#a7b6da; padding:1px 0; }
`;

/** 지정한 슬롯 종류·희귀도의 아이템을 결정론적으로 뽑는다(presets.ts와 동일 전략). */
function rollItemForSlot(startSeed: number, slotKind: SlotKind, rarity: Rarity): Item {
  const source = { planet: 0, tier: 1 };
  let last = rollItem(startSeed >>> 0, rarity, source);
  for (let i = 0; i < 4096; i++) {
    const item = rollItem((startSeed + i) >>> 0, rarity, source);
    if (item.slot === slotKind) return item;
    last = item;
  }
  return last;
}

/**
 * 치트 패널을 만들어 DOM에 붙인다. 반환된 핸들의 `destroy()`로 정리한다.
 * DEV 전용 — main.ts의 import.meta.env.DEV 블록에서만 호출된다.
 */
export function createCheatPanel(host: CheatPanelHost): { destroy(): void } {
  const { harness } = host;

  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'pb-cheat';

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'pb-c-toggle';
  toggleBtn.textContent = '⚙';
  toggleBtn.title = '치트 패널 (백틱 ` 키로 토글)';
  root.appendChild(toggleBtn);

  const body = document.createElement('div');
  body.className = 'pb-c-body hidden';
  root.appendChild(body);

  document.body.appendChild(root);

  let hint = '';
  let selectedEntityId: number | null = null;
  let speed: 1 | 4 | 16 = 1;
  let paused = false;
  let invincible = false;
  let savedMaxHp = 0;
  // 런 식별 추적: 새 런이 시작되면 런 스코프 치트 상태(무적)를 리셋한다.
  // 무적은 일회성 world 변형이라 런을 넘어가면 실제 효과가 없는데 UI만 ON으로
  // 남고, OFF 시 이전 런의 savedMaxHp를 새 런에 덮어쓰는 desync가 생긴다(리뷰 LOW).
  let lastRunSeed: number | null = null;
  let lastRunTick = -1;

  // --- DOM 빌더 헬퍼 --------------------------------------------------------

  function section(title: string): HTMLElement {
    const s = document.createElement('div');
    s.className = 'pb-c-sec';
    const t = document.createElement('div');
    t.className = 'pb-c-t';
    t.textContent = title;
    s.appendChild(t);
    return s;
  }

  function btn(label: string, onClick: () => void, title?: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'pb-c-b';
    b.textContent = label;
    if (title !== undefined) b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  function numInput(value: number, width = 64): HTMLInputElement {
    const i = document.createElement('input');
    i.type = 'number';
    i.value = String(value);
    i.style.width = `${width}px`;
    return i;
  }

  function setHint(msg: string): void {
    hint = msg;
    render();
  }

  // --- 액션 -----------------------------------------------------------------

  function grantCurrency(field: 'credits' | 'minerals', amount: number): void {
    host.activateHarnessProfile();
    host.getProfile()[field] += amount;
    host.saveProfile();
    host.refreshScreen();
    // 라이브 런이면 오염 표시(재화 개입). 런이 없으면 cheat는 무해한 no-op.
    harness.cheat(() => {});
    setHint(`${field === 'credits' ? '크레딧' : '광물'} +${amount} 지급 (하네스 프로필)`);
  }

  function grantItem(slotId: EquipSlotId, rarity: Rarity): void {
    host.activateHarnessProfile();
    const profile = host.getProfile();
    const ship = activeShip(profile);
    const seed = (0xc0ffee + Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    const item = rollItemForSlot(seed, SLOT_KIND_FOR[slotId], rarity);
    // 기존 장착분은 인벤토리로 반환(정비 화면과 동일 규칙).
    const displaced = ship.equipped[slotId];
    if (displaced !== undefined) profile.inventory.push(displaced);
    ship.equipped[slotId] = item;
    host.saveProfile();
    host.refreshScreen();
    harness.cheat(() => {});
    setHint(`${SLOT_LABEL[slotId]} · ${rarity} 장착 (활성 기체)`);
  }

  function toggleInvincible(): void {
    invincible = !invincible;
    harness.cheat((w) => {
      const p = w.entities[0];
      if (p === undefined) return;
      if (invincible) {
        savedMaxHp = p.maxHp;
        p.maxHp = 1e9;
        p.hp = 1e9;
      } else {
        p.maxHp = savedMaxHp > 0 ? savedMaxHp : p.maxHp;
        p.hp = p.maxHp;
      }
    });
    setHint(invincible ? '무적 ON (HP 1e9)' : '무적 OFF (HP 복구)');
  }

  function fullHeal(): void {
    harness.cheat((w) => {
      const p = w.entities[0];
      if (p !== undefined) p.hp = p.maxHp;
    });
    setHint('풀 힐');
  }

  function levelUp(): void {
    // 정식 레벨업 흐름을 태운다: 다음 레벨 임계치까지 XP를 채우면 다음 틱에
    // pendingLevelUp(파워업 선택)으로 자연히 승급한다.
    harness.cheat((w) => {
      w.xp += xpToNext(w.level);
    });
    setHint('레벨업 +1 (다음 틱 파워업 선택)');
  }

  function clearEnemyBullets(): void {
    harness.cheat((w) => {
      const kept = w.entities.filter((e) => e.kind !== 'enemyBullet');
      w.entities.length = 0;
      for (const e of kept) w.entities.push(e);
    });
    setHint('적 탄막 소거');
  }

  function killAllEnemies(): void {
    harness.cheat((w) => {
      const kept = w.entities.filter((e) => e.kind !== 'enemy');
      w.entities.length = 0;
      for (const e of kept) w.entities.push(e);
    });
    setHint('모든 적 제거');
  }

  function spawnElite(): void {
    let ok = false;
    harness.cheat((w) => {
      const target = w.entities.find((e) => e.kind === 'enemy' && !isElite(e));
      if (target === undefined) return;
      makeElite(target, Math.floor(Math.random() * ELITE_AFFIX_COUNT));
      ok = true;
    });
    setHint(ok ? '정예 승격(현장 적 1기)' : '승격할 일반 적이 없습니다');
  }

  function jumpToBoss(): void {
    harness.cheat((w) => {
      w.wave.segmentIndex = SEGMENTS.length - 1;
      w.wave.segmentTimer = 1;
      w.wave.done = false;
    });
    setHint('보스 세그먼트로 점프');
  }

  function segmentForward(): void {
    harness.cheat((w) => {
      const last = SEGMENTS.length - 1;
      w.wave.segmentIndex = Math.min(w.wave.segmentIndex + 1, last);
      w.wave.segmentTimer = 1;
      w.wave.done = false;
    });
    setHint('다음 세그먼트로 점프');
  }

  function launchSeededRun(seed: string, planet: number, tier: number, anomaly: boolean): void {
    const opts: Parameters<Harness['startRun']>[0] = { planet, tier, anomaly };
    const s = seed.trim();
    if (s !== '') {
      const n = Number(s);
      if (Number.isFinite(n)) opts.seed = n >>> 0;
    }
    harness.startRun(opts);
    setHint(`런 시작 (행성 ${planet} · 티어 ${tier}${anomaly ? ' · 변칙' : ''})`);
  }

  // --- 렌더 -----------------------------------------------------------------

  function render(): void {
    if (body.classList.contains('hidden')) return;
    body.innerHTML = '';

    const snap = harness.snapshot();

    // 새 런 감지(시드 변경 또는 틱 되감김) → 런 스코프 치트 상태 리셋.
    if (snap.screen === 'run') {
      if (snap.seed !== lastRunSeed || snap.tick < lastRunTick) {
        invincible = false;
        savedMaxHp = 0;
      }
      lastRunSeed = snap.seed;
      lastRunTick = snap.tick;
    }

    const h3 = document.createElement('h3');
    h3.textContent = '치트 패널';
    body.appendChild(h3);

    // 오염 배지
    const badge = document.createElement('div');
    badge.className = `pb-c-badge${snap.tainted ? '' : ' clean'}`;
    badge.textContent = snap.tainted ? '⚠ 오염 런 (정산·제출 제외)' : '정상 런';
    body.appendChild(badge);

    // 1) 재생 제어
    {
      const s = section('재생 제어');
      const speedRow = document.createElement('div');
      speedRow.className = 'pb-c-row';
      for (const m of [1, 4, 16] as const) {
        const b = btn(`${m}×`, () => {
          speed = m;
          harness.setSpeed(m);
          render();
        });
        if (speed === m) b.classList.add('on');
        speedRow.appendChild(b);
      }
      const pb = btn(paused ? '▶ 재개' : '⏸ 일시정지', () => {
        paused = !paused;
        if (paused) harness.pause();
        else harness.resume();
        render();
      });
      if (paused) pb.classList.add('on');
      speedRow.appendChild(pb);
      s.appendChild(speedRow);

      const stepRow = document.createElement('div');
      stepRow.className = 'pb-c-row';
      stepRow.appendChild(btn('+1 틱', () => harness.step(1)));
      stepRow.appendChild(btn('+10 틱', () => harness.step(10)));
      stepRow.appendChild(btn('+60 틱', () => harness.step(60)));
      s.appendChild(stepRow);

      const ffRow = document.createElement('div');
      ffRow.className = 'pb-c-row';
      const ffTicks = numInput(600);
      const apChk = document.createElement('label');
      apChk.className = 'pb-c-chk';
      const ap = document.createElement('input');
      ap.type = 'checkbox';
      ap.checked = true;
      apChk.appendChild(ap);
      apChk.appendChild(document.createTextNode('오토파일럿'));
      ffRow.appendChild(document.createTextNode(''));
      const ffLbl = document.createElement('span');
      ffLbl.className = 'pb-c-lbl';
      ffLbl.textContent = 'ff';
      ffRow.appendChild(ffLbl);
      ffRow.appendChild(ffTicks);
      ffRow.appendChild(apChk);
      ffRow.appendChild(
        btn('▶▶ 실행', () => {
          const n = Math.max(0, Math.floor(Number(ffTicks.value) || 0));
          harness.ff(n, { autopilot: ap.checked });
          setHint(`ff ${n}틱 (${ap.checked ? '오토파일럿' : '중립'})`);
        }),
      );
      s.appendChild(ffRow);
      body.appendChild(s);
    }

    // 2) 점프
    {
      const s = section('점프');
      const scrRow = document.createElement('div');
      scrRow.className = 'pb-c-row';
      const screens: readonly [HarnessScreen, string][] = [
        ['title', '타이틀'],
        ['base', '기지'],
        ['starMap', '성계'],
        ['inventory', '정비'],
        ['research', '연구'],
        ['refinery', '정제'],
      ];
      for (const [scr, label] of screens) {
        scrRow.appendChild(btn(label, () => {
          harness.goto(scr);
          setHint(`스크린 → ${label}`);
        }));
      }
      s.appendChild(scrRow);

      // 시드 런 런처
      const runRow1 = document.createElement('div');
      runRow1.className = 'pb-c-row';
      const seedIn = document.createElement('input');
      seedIn.type = 'text';
      seedIn.placeholder = 'seed(빈=랜덤)';
      const planetIn = numInput(0, 44);
      const tierIn = numInput(0, 44);
      const anomChk = document.createElement('label');
      anomChk.className = 'pb-c-chk';
      const anom = document.createElement('input');
      anom.type = 'checkbox';
      anomChk.appendChild(anom);
      anomChk.appendChild(document.createTextNode('변칙'));
      const l1 = document.createElement('span');
      l1.className = 'pb-c-lbl';
      l1.textContent = 'seed';
      const l2 = document.createElement('span');
      l2.className = 'pb-c-lbl';
      l2.textContent = 'planet';
      const l3 = document.createElement('span');
      l3.className = 'pb-c-lbl';
      l3.textContent = 'tier';
      runRow1.append(l1, seedIn);
      s.appendChild(runRow1);
      const runRow2 = document.createElement('div');
      runRow2.className = 'pb-c-row';
      runRow2.append(l2, planetIn, l3, tierIn, anomChk);
      s.appendChild(runRow2);
      const runRow3 = document.createElement('div');
      runRow3.className = 'pb-c-row';
      runRow3.appendChild(
        btn('▶ 런 시작', () => {
          launchSeededRun(
            seedIn.value,
            Math.max(0, Math.floor(Number(planetIn.value) || 0)),
            Math.max(0, Math.floor(Number(tierIn.value) || 0)),
            anom.checked,
          );
        }),
      );
      const segBtn = btn('세그먼트+1', segmentForward);
      const bossBtn = btn('보스 점프', jumpToBoss);
      if (snap.segment === 0) {
        segBtn.disabled = true;
        bossBtn.disabled = true;
        segBtn.title = '진행 중인 런이 없습니다';
        bossBtn.title = '진행 중인 런이 없습니다';
      }
      runRow3.append(segBtn, bossBtn);
      s.appendChild(runRow3);
      body.appendChild(s);
    }

    // 3) 치트
    {
      const s = section('치트');
      const row1 = document.createElement('div');
      row1.className = 'pb-c-row';
      const invBtn = btn('무적', toggleInvincible);
      if (invincible) invBtn.classList.add('on');
      row1.append(invBtn, btn('풀 힐', fullHeal), btn('레벨업 +1', levelUp));
      s.appendChild(row1);

      const row2 = document.createElement('div');
      row2.className = 'pb-c-row';
      const credIn = numInput(10000, 72);
      row2.append(
        credIn,
        btn('크레딧', () => grantCurrency('credits', Math.max(0, Math.floor(Number(credIn.value) || 0)))),
      );
      const minIn = numInput(10000, 72);
      row2.append(
        minIn,
        btn('광물', () => grantCurrency('minerals', Math.max(0, Math.floor(Number(minIn.value) || 0)))),
      );
      s.appendChild(row2);

      const row3 = document.createElement('div');
      row3.className = 'pb-c-row';
      const slotSel = document.createElement('select');
      for (const id of EQUIP_SLOTS) {
        const o = document.createElement('option');
        o.value = id;
        o.textContent = SLOT_LABEL[id];
        slotSel.appendChild(o);
      }
      const raritySel = document.createElement('select');
      for (const r of RARITIES) {
        const o = document.createElement('option');
        o.value = r;
        o.textContent = r;
        if (r === 'rare') o.selected = true;
        raritySel.appendChild(o);
      }
      row3.append(
        slotSel,
        raritySel,
        btn('장비 지급', () => grantItem(slotSel.value as EquipSlotId, raritySel.value as Rarity)),
      );
      s.appendChild(row3);

      const row4 = document.createElement('div');
      row4.className = 'pb-c-row';
      row4.append(
        btn('프리셋: 신규', () => {
          harness.preset('fresh');
          setHint('프리셋 fresh 주입');
        }),
        btn('프리셋: 만렙', () => {
          harness.preset('maxed');
          setHint('프리셋 maxed 주입');
        }),
      );
      s.appendChild(row4);
      body.appendChild(s);
    }

    // 4) 스폰 제어
    {
      const s = section('스폰 제어');
      const row = document.createElement('div');
      row.className = 'pb-c-row';
      const bulletBtn = btn('적탄 소거', clearEnemyBullets);
      const killBtn = btn('적 전멸', killAllEnemies);
      const eliteBtn = btn('정예 소환', spawnElite);
      const bossBtn = btn('보스 소환', jumpToBoss, '보스 세그먼트로 점프해 sim이 보스를 소환');
      const live = snap.segment > 0;
      if (!live) {
        for (const b of [bulletBtn, killBtn, eliteBtn, bossBtn]) {
          b.disabled = true;
          b.title = '진행 중인 런이 없습니다';
        }
      }
      row.append(bulletBtn, killBtn, eliteBtn, bossBtn);
      s.appendChild(row);
      body.appendChild(s);
    }

    // 5) 인스펙터
    {
      const s = section('인스펙터');
      const dump = document.createElement('pre');
      dump.className = 'pb-c-dump';
      const bossLine = snap.boss
        ? `boss hp ${Math.ceil(snap.boss.hp)}/${snap.boss.maxHp} ph${snap.boss.phase}`
        : 'boss -';
      const counts = Object.entries(snap.entityCounts)
        .map(([k, v]) => `${k}:${v}`)
        .join(' ');
      dump.textContent =
        `screen ${snap.screen}  tick ${snap.tick}\n` +
        `hp ${Math.ceil(snap.hp)}/${snap.maxHp}  lv ${snap.level}  xp ${snap.xp}\n` +
        `seg ${snap.segment}  kills ${snap.kills}  combo ${snap.combo}\n` +
        `${bossLine}\n` +
        `hash ${snap.hash || '-'}  seed ${snap.seed}\n` +
        `프로필 c${snap.profileSummary.credits} m${snap.profileSummary.minerals} shipLv${snap.profileSummary.shipLevel}\n` +
        `엔티티 ${counts || '-'}`;
      s.appendChild(dump);

      // 최근 이벤트(최대 10)
      const events = harness.events().slice(-10).reverse();
      if (events.length > 0) {
        const evWrap = document.createElement('div');
        for (const e of events) {
          const line = document.createElement('div');
          line.className = 'pb-c-evt';
          line.textContent = `t${e.tick} ${e.type}${e.detail !== undefined ? ` (${e.detail})` : ''}`;
          evWrap.appendChild(line);
        }
        s.appendChild(evWrap);
      }

      // 엔티티 목록(클릭 인스펙트)
      const entities = host.getEntities();
      const list = document.createElement('div');
      list.className = 'pb-c-ents';
      // 관심 종류만: player/enemy/boss/supply/loot (탄·젬 제외로 잡음 감소).
      const KINDS = new Set(['player', 'enemy', 'boss', 'supply', 'loot', 'destructible']);
      const shown = entities.filter((e) => KINDS.has(e.kind)).slice(0, 60);
      for (const e of shown) {
        const item = document.createElement('div');
        item.className = 'pb-c-ent';
        const left = document.createElement('span');
        left.className = 'k';
        const eliteTag = e.elite >= 0 ? '★' : '';
        left.textContent = `#${e.id} ${e.kind}${eliteTag}`;
        const right = document.createElement('span');
        right.className = 'p';
        right.textContent = `hp ${Math.ceil(e.hp)}/${e.maxHp} (${Math.round(e.x)},${Math.round(e.y)})`;
        item.append(left, right);
        item.addEventListener('click', () => {
          selectedEntityId = e.id;
          setHint(`엔티티 #${e.id} ${e.kind} hp ${Math.ceil(e.hp)}/${e.maxHp} pos (${Math.round(e.x)},${Math.round(e.y)}) angle ${e.angle.toFixed(2)}`);
        });
        if (e.id === selectedEntityId) item.style.background = 'rgba(76,215,255,.18)';
        list.appendChild(item);
      }
      if (shown.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'pb-c-evt';
        empty.style.padding = '4px 7px';
        empty.textContent = '표시할 엔티티 없음';
        list.appendChild(empty);
      }
      s.appendChild(list);
      body.appendChild(s);
    }

    // 힌트
    const hintEl = document.createElement('div');
    hintEl.className = 'pb-c-hint';
    hintEl.textContent = hint;
    body.appendChild(hintEl);
  }

  // --- 토글 + 라이브 갱신 ---------------------------------------------------

  function toggleOpen(): void {
    body.classList.toggle('hidden');
    if (!body.classList.contains('hidden')) render();
  }

  toggleBtn.addEventListener('click', toggleOpen);

  function onKey(ev: KeyboardEvent): void {
    // 백틱(`)으로 패널 토글. 입력 필드에 포커스가 있으면 무시.
    if (ev.key !== '`') return;
    const t = ev.target as HTMLElement | null;
    if (t !== null && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    ev.preventDefault();
    toggleOpen();
  }
  window.addEventListener('keydown', onKey);

  // 열려 있는 동안 250ms마다 인스펙터/상태 갱신.
  const timer = window.setInterval(() => {
    if (!body.classList.contains('hidden')) render();
  }, 250);

  return {
    destroy(): void {
      window.clearInterval(timer);
      window.removeEventListener('keydown', onKey);
      root.remove();
      style.remove();
    },
  };
}
