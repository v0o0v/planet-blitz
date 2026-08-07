/**
 * 언어 카탈로그 (M5 Phase C3 — plan §4, AC8).
 *
 * 영어(`EN`)가 정본(source of truth)이며 `MessageKey` 는 그 키 집합에서 파생된다. 한국어
 * (`KO`)는 동일 키를 모두 채워야 한다(`Record<MessageKey, string>` 로 강제 — 누락 시 컴파일
 * 오류). `{name}` 형태 플레이스홀더는 `t()` 에서 치환된다.
 *
 * ── 범위(OQ-M5-4 기본안: 전체) ── UI 크롬·버튼·라벨·정산·튜토리얼·도발 스티커 문구를 담는다.
 * sim/data 소유의 콘텐츠명(행성명·파워업명·적명 등)은 데이터 레이어라 별도 확장으로 남긴다
 * (carry-forward). 하네스/치트 패널은 개발 도구라 제외(plan 지시).
 *
 * ── 결정론 ── 순수 상수 테이블. sim 은 이 파일을 절대 참조하지 않는다(ADR-0005).
 */

/** 영어 카탈로그(정본). 키 추가는 여기서 시작하고 KO 에도 반드시 채운다. */
export const EN = {
  // --- 공통 ---
  'common.close': 'Close',

  // --- 설정 패널(C1 볼륨/음소거 + C3 언어) ---
  'settings.title': 'Settings',
  'settings.open': 'Settings',
  'settings.sound': 'Sound',
  'settings.mute': 'Mute',
  'settings.on': 'On',
  'settings.off': 'Off',
  'settings.volume': 'Volume',
  'settings.bgmVolume': 'BGM Volume',
  'settings.sfxVolume': 'SFX Volume',
  'settings.uiVolume': 'UI Volume',
  'settings.account': 'Account',
  'settings.accountSignedIn': 'Signed in',
  'settings.notSignedIn': 'Not signed in — progress stays on this device only.',
  'settings.signOut': 'Sign out',
  'settings.language': 'Language',
  'settings.lang.en': 'English',
  'settings.lang.ko': '한국어',
  // --- 그래픽/접근성(Phase 0 — plan §AC-0.7; ADR-0031) ---
  'settings.graphics': 'Graphics',
  'settings.quality.auto': 'Auto',
  'settings.quality.low': 'Low',
  'settings.quality.med': 'Medium',
  'settings.quality.high': 'High',
  'settings.reducedMotion': 'Reduced Motion',
  'settings.reducedGlow': 'Reduced Glow',
  'settings.damageNumbers': 'Damage Numbers',

  // --- 정산 화면(C2) ---
  'result.win.title': 'Planet Conquered',
  'result.lose.title': 'Shot Down…',
  'result.win.sub': '{name} destroyed.',

  // --- 행성 보스 표시명 (HUD 체력바 머리글 · 승리 문구) ---
  // ⚠️ 한 곳에 카르곤 보스를 하드코딩하면 어느 행성을 돌아도 카르곤이 뜬다 — 실제로 그랬다
  //     (사용자 신고 2026-07-27). 키는 `BossDef.id` 를 그대로 쓴다(데이터 ↔ 표시 1:1).
  'boss.kargon-lava-fortress': 'Lava Fortress Tank',
  'boss.berdan-swarm-queen': 'Swarm Queen',
  'boss.niflheim-ghost-flagship': 'Ghost Flagship',
  'boss.arke-guardian-obelisk': 'Guardian Obelisk',
  'boss.toxar-rot-matriarch': 'Rot Matriarch',
  'boss.kras-siege-colossus': 'Siege Colossus',
  /** 보스 체력바 머리글 = 행성 · 보스. */
  'boss.hudName': '{planet} · {boss}',

  // --- 적 표시명 (성계 지도 전장 정찰 로스터) ---
  // ⚠️ 키는 `EnemyDef.id` 를 그대로 쓴다(데이터 ↔ 표시 1:1, 보스 선례). 순서는
  //     `ENEMY_BY_TYPE`(전역 typeIndex) 와 같다 — 행성이 늘면 여기에 append 한다.
  //     한글 표기의 출처는 각 정의의 JSDoc 첫 줄이다(데이터가 원본, 여기는 복사가 아니라 표시).
  'enemy.kargon-charger': 'Shredder',
  'enemy.kargon-gunner': 'Mortar Trooper',
  'enemy.kargon-lava-spring': 'Lava Spring',
  'enemy.kargon-repair-drone': 'Repair Drone',
  'enemy.berdan-worker-rusher': 'Worker Rusher',
  'enemy.berdan-spitter': 'Spitter Soldier',
  'enemy.berdan-acid-gland': 'Acid Gland',
  'enemy.berdan-brood-nurse': 'Brood Nurse',
  'enemy.berdan-sentinel': 'Sentinel',
  'enemy.berdan-brood-mother': 'Brood Mother',
  'enemy.niflheim-wraith-interceptor': 'Wraith Interceptor',
  'enemy.niflheim-frost-gunner': 'Frost Gunner',
  'enemy.niflheim-rime-fissure': 'Rime Fissure',
  'enemy.niflheim-cryo-tender': 'Cryo Tender',
  'enemy.niflheim-frost-sentinel': 'Frost Sentinel',
  'enemy.niflheim-spectral-carrier': 'Spectral Carrier',
  'enemy.arke-crusher-golem': 'Crusher Golem',
  'enemy.arke-precision-turret': 'Precision Turret',
  'enemy.arke-grind-totem': 'Grind Totem',
  'enemy.arke-restore-droid': 'Restore Droid',
  'enemy.arke-guardian-battery': 'Guardian Battery',
  'enemy.arke-ancient-breaker': 'Ancient Breaker',
  'enemy.toxar-corroder': 'Corroder',
  'enemy.toxar-venom-spitter': 'Venom Spitter',
  'enemy.toxar-blight-gland': 'Blight Gland',
  'enemy.toxar-plague-tender': 'Plague Tender',
  'enemy.toxar-toxin-sentinel': 'Toxin Sentinel',
  'enemy.toxar-rot-behemoth': 'Rot Behemoth',
  'enemy.kras-breaker': 'Breaker',
  'enemy.kras-piercer': 'Piercer',
  'enemy.kras-crusher-totem': 'Crusher Totem',
  'enemy.kras-salvage-drone': 'Salvage Drone',
  'enemy.kras-siege-battery': 'Siege Battery',
  'enemy.kras-devastator': 'Devastator',
  // 카르곤 엘리트 2종은 typeIndex 34~35(append-only) 라 목록 끝에 온다 — 표시 순서와 무관하다.
  'enemy.kargon-lava-battery': 'Lava Battery',
  'enemy.kargon-magma-colossus': 'Magma Colossus',
  /** 역할 태그 — 정찰 로스터 칩의 두 번째 줄. */
  'enemy.role.charger': 'Charger',
  'enemy.role.gunner': 'Gunner',
  'enemy.role.special': 'Special',
  'enemy.role.support': 'Support',
  'enemy.role.elite': 'Elite',
  'enemy.role.boss': 'Boss',

  'result.lose.sub': 'The pilot ejected safely. Time to sortie again.',
  'result.stat.title': 'Battle Log',
  'result.stat.time': 'Survival Time',
  'result.stat.level': 'Level Reached',
  'result.stat.xp': 'XP Gained',
  'result.stat.kills': 'Kills',
  'result.stat.combo': 'Max Combo',
  'result.stat.resources': 'Supplies',
  'result.stat.seed': 'Seed',
  'result.levelShort': 'Lv {n}',
  'result.loot.title': 'Run Rewards',
  'result.loot.items': 'Items Gained',
  'result.loot.count': '{n}',
  'result.loot.levels': 'Ship Levels',
  'result.loot.skillPoints': 'Skill Points',
  'result.loot.credits': 'Credits',
  'result.loot.power': 'Combat Power',
  'result.loot.overflow': 'Storage Full',
  'result.loot.overflowVal': '{n} (no space)',
  'result.tip.power': 'Combat Power {n}',
  'result.drops.title': 'New Gear',
  'result.drops.none': 'No new gear this run.',
  'result.drops.more': '+{n} more',
  'result.btn.inventory': '🛠 Manage Gear',
  'result.btn.restart': 'Launch Again',

  // --- 아이템 슬롯/등급/무기(정산 드랍 목록 표시용) ---
  'item.slot.main': 'Main Weapon',
  'item.slot.sub': 'Sub Weapon',
  'item.slot.armor': 'Armor',
  'item.slot.shield': 'Shield',
  'item.slot.engine': 'Engine',
  'item.slot.core': 'Core',
  'item.slot.module': 'Module',
  'item.weapon.0': 'Vulcan',
  'item.weapon.1': 'Spread',
  'item.weapon.2': 'Railgun',
  'item.rarity.normal': 'Normal',
  'item.rarity.magic': 'Magic',
  'item.rarity.rare': 'Rare',
  'item.rarity.unique': 'Unique',
  'item.reqLevel': 'Req. Lv{n}',
  'item.levelLocked': 'Requires ship Lv{n}',

  // --- 어픽스 stat 표시명 + 설명(장비 툴팁) ---
  // 툴팁이 raw StatKey(`damagePct +8`)를 노출해 무엇이 좋아지는지 안 읽힌다는 사용자 지적
  // (2026-07-26)에 따른 키. `.name` = 표시명, `.desc` = 한 줄 설명({n} = 롤 수치).
  'stat.damagePct.name': 'Damage',
  'stat.damagePct.desc': 'Bullets deal {n}% more damage.',
  'stat.fireRatePct.name': 'Fire Rate',
  'stat.fireRatePct.desc': 'You shoot {n}% faster.',
  'stat.bulletCount.name': 'Bullets',
  'stat.bulletCount.desc': 'Each shot fires {n} extra bullet(s).',
  'stat.pierce.name': 'Pierce',
  'stat.pierce.desc': 'Bullets punch through {n} more enemy before vanishing.',
  'stat.bulletSpeedPct.name': 'Bullet Speed',
  'stat.bulletSpeedPct.desc': 'Bullets travel {n}% faster.',
  'stat.rangeFlat.name': 'Range',
  'stat.rangeFlat.desc': 'Bullets fly {n} further before expiring.',
  'stat.fireDmg.name': 'Burn',
  'stat.fireDmg.desc': 'Hits set enemies alight: {n} damage per tick for 2s.',
  'stat.coldSlow.name': 'Chill',
  'stat.coldSlow.desc': 'Hits slow enemies to 55% move speed for 1.5s.',
  'stat.lightning.name': 'Chain',
  'stat.lightning.desc': 'Hits zap up to 3 nearby enemies for {n} damage.',
  'stat.moveSpeedPct.name': 'Move Speed',
  'stat.moveSpeedPct.desc': 'Your ship moves {n}% faster.',
  'stat.maxHpFlat.name': 'Max HP',
  'stat.maxHpFlat.desc': 'Max HP increases by {n}.',
  'stat.maxHpPct.name': 'Max HP',
  'stat.maxHpPct.desc': 'Max HP increases by {n}%.',
  'stat.dashCdPct.name': 'Dash Cooldown',
  'stat.dashCdPct.desc': 'Dash recharges {n}% sooner.',
  'stat.magnetPct.name': 'Magnet',
  'stat.magnetPct.desc': 'Gem pickup radius grows {n}%.',
  'stat.xpPct.name': 'XP',
  'stat.xpPct.desc': 'You gain {n}% more XP.',
  'stat.mineralFindPct.name': 'Mineral Find',
  'stat.mineralFindPct.desc': 'Runs yield {n}% more minerals.',
  // ADR-0049 스킬 어픽스 3종(축 단위 +N 레벨). "already-invested" 문구는 정본 1을 드러내는
  // 유일한 자리다 — 투자 0인 스킬에는 가산되지 않는다(빼지 마라).
  'stat.skillLvOffense.name': 'Offense Skills',
  'stat.skillLvOffense.desc': 'Already-invested offense skills gain {n} level(s).',
  'stat.skillLvDefense.name': 'Defense Skills',
  'stat.skillLvDefense.desc': 'Already-invested defense skills gain {n} level(s).',
  'stat.skillLvUtility.name': 'Utility Skills',
  'stat.skillLvUtility.desc': 'Already-invested utility skills gain {n} level(s).',

  // --- 필드 아군·이익 오브젝트 이름표(스프라이트 아래 표시) ---
  'ent.turret.pickup': 'Turret Kit',
  'ent.turret.active': 'Ally Turret',
  'ent.magnetEmitter': 'Magnet Pylon',
  'ent.bombDevice': 'Bomb Charge',
  'ent.boostPad': 'Boost Pad',
  'ent.supply': 'Supply Drop',
  'ent.loot': 'Loot',
  'ent.echo': 'Echo Signal',
  'ent.shelter': 'Shelter',

  // --- 성계 지도 ---
  'planet.title': 'Star Map',
  // 성계 지도 도움말(사용자 요청 2026-08-05). 문단 구분은 홑 개행(`helpModal.ts` 주석 ①).
  'planet.help': 'Help',
  'planet.help.title': 'Star Map Guide',
  'planet.help.s1.h': 'What this screen is for',
  'planet.help.s1.b':
    'This is the launch screen. You pick a planet, pick a stage, optionally inject catalysts, and go.\nEach planet is an archive facility of the lost Oscar civilization with its own enemies, its own terrain, and its own drop table. Which planet you run decides what you can find, not just how it looks.',
  'planet.help.s2.h': 'Stages',
  'planet.help.s2.b':
    'Stage is the difficulty axis and it starts at 1 with no upper limit. Each planet tracks its own best clear independently.\nWhat you may attempt is your best clear plus five, floored at ten. Clearing is the only thing that opens stages — your ship level never locks one.\nAs a rough anchor, ship level around five times the stage number is comfortable. Stage raises the quality of loot, not the quantity, and it also sets the required level on what drops there so that gear is wearable rather than something you shelve.',
  'planet.help.s3.h': 'Catalysts',
  'planet.help.s3.b':
    'Catalysts are consumables injected here, just before launch. Every catalyst carries a difficulty penalty and a reward boost as one inseparable package — there is no catalyst that only helps.\nYou may inject several at once, including duplicates of the same kind. They are consumed when the run starts, whether or not it goes well.\nCatalysts are for ordinary planet runs only. They never enter a commission run or an invasion.',
  'planet.help.s4.h': 'The popularity multiplier',
  'planet.help.s4.b':
    'Each planet shows a live multiplier. It rises on planets few pilots are running and falls on crowded ones, rebalancing automatically from how many runs everyone settled in the last hour.\nIt moves quantity, experience, and resources only. Loot quality is never touched, and neither are boss guaranteed drops, planet-exclusive blueprints and catalysts, encounter rewards, or invasion payouts. The rule is that only fungible rewards get a multiplier.\nThe value is stamped onto your run at launch, so the number you saw is the number you get. Offline or logged out, every planet reads 1.0.',
  'planet.help.s5.h': 'Before you launch',
  'planet.help.s5.b':
    'The summary beside the launch button states what is actually confirmed — planet, stage, and injected catalysts. Read it rather than trusting what you thought you selected.\nRun growth is temporary. Levels and powerups gathered inside a run vanish when it ends; what you keep is the loot and the resources, which are the raw material for permanent growth back at the base.',
  'planet.sub': 'Choose a planet and invasion stage.',
  'planet.stageLabel': 'Invasion Stage',
  'planet.stageDesc': 'Stage {stage} · open up to {cap}',
  'planet.back': '◀ Back to Base',
  'planet.inventory': '🛠 Manage Gear',
  'planet.launch': '▶ Launch {name}',
  // AAA 시네마틱 전환(2026-08-03) — 패널 각인 제목 셋 · 목록 행 배율 · 하단 띠 선택 요약.
  'planet.list.head': 'Planets',
  'planet.arena.head': 'Battlefield Recon',
  /** 정찰 창 캡션(지형 위 머리글) = 행성 · 부제. */
  'planet.recon.caption': '{name} · {subtitle}',
  /** 지형 위 적 이름표 = 이름 · 역할(한 줄). */
  'planet.recon.unit': '{name} · {role}',
  'planet.ops.head': 'Sortie Setup',
  'planet.list.tail': 'No routes chart the deeper sectors yet.',
  'planet.rewardMult': 'Reward ×{x}',
  'planet.summary': '{name} · Stage {stage} · Catalysts {n}',

  // --- 촉매 UI(주입 패널·픽커·출격 폴백·관리·분해 — ADR-0029, Lane 4) ---
  'catalyst.panel.title': 'Catalysts',
  'catalyst.panel.sub': 'Risk-reward run consumables',
  'catalyst.panel.none': 'None injected',
  'catalyst.panel.available': 'Owned {n} — Edit Injection to load them',
  'catalyst.panel.count': 'Injected {n} / {cap}',
  'catalyst.panel.edit': 'Edit Injection',
  'catalyst.picker.title': 'Inject Catalysts',
  'catalyst.picker.slots': 'Slots {n} / {cap}',
  'catalyst.picker.owned': 'Owned {n}',
  'catalyst.picker.inject': 'Inject',
  'catalyst.picker.remove': 'Remove',
  'catalyst.picker.clear': 'Clear All',
  'catalyst.picker.confirm': 'Confirm',
  'catalyst.picker.signatureLocked': '{planet} only',
  'catalyst.picker.slotFull': 'Slot cap reached ({cap})',
  'catalyst.picker.noneOwned': 'No catalysts owned yet. Earn them from elite and boss runs.',
  'catalyst.kind.common': 'Common',
  'catalyst.kind.signature': 'Signature',
  'catalyst.sortie.failTitle': 'Injection Failed',
  'catalyst.sortie.failBody':
    'Could not consume your catalysts (offline or rejected). Nothing was consumed — retry, or launch without them.',
  'catalyst.sortie.retry': 'Retry',
  'catalyst.sortie.skip': 'Launch Without Catalysts',
  'catalyst.manage.open': 'Catalysts',
  'catalyst.manage.title': 'Catalyst Stock',
  // 촉매 보관함 도움말(사용자 요청 2026-08-05). 문단 구분은 홑 개행(`helpModal.ts` 주석 ①).
  'catalyst.help': 'Help',
  'catalyst.help.title': 'Catalyst Stock Guide',
  'catalyst.help.s1.h': 'What a catalyst is',
  'catalyst.help.s1.b':
    'A catalyst is a consumable that intensifies one run. Every catalyst carries a difficulty penalty and a reward boost as one inseparable package — none of them is purely an upgrade.\nEach kind has a fixed effect and no grade, so two copies of the same catalyst are identical. You inject them on the Star Map just before launching, and they are consumed when the run starts.',
  'catalyst.help.s2.h': 'Common and planet-exclusive',
  'catalyst.help.s2.b':
    'Common catalysts drop anywhere and are the bulk of what you will hold.\nPlanet-exclusive catalysts drop only on the planet they belong to. They are never sold, so the only way to get one is to go there and earn it.',
  'catalyst.help.s3.h': 'Dismantling and residue',
  'catalyst.help.s3.b':
    'Dismantling a catalyst returns catalyst residue. Residue has exactly one source and one use: it comes from dismantling and it buys catalysts in the shop on this screen. Nothing else produces it and nothing else spends it.\nThat closed loop is deliberate. If credits or minerals could buy catalysts, you could raise your resource multipliers with resources and spend the winnings on more catalysts — the shop is sealed off from your other currencies to prevent exactly that.',
  'catalyst.help.s4.h': 'The shop',
  'catalyst.help.s4.b':
    'The shop stocks the full common catalogue at all times, so nothing is ever out of stock or on rotation. Planet-exclusive catalysts are never sold.\nBoth the refund from dismantling and the purchase price derive from how rare a catalyst is, and the refund is always lower than the price. Every trip through residue therefore shrinks your total catalyst count slightly. Converting freely is not free.\nExclusives refund by the same formula but cannot be bought back, so their listed price is a figure you can read but never pay.',
  'catalyst.help.s5.h': 'Where catalysts do and do not apply',
  'catalyst.help.s5.b':
    'Catalysts are for ordinary PvE planet runs. They never enter an invasion or a commission run — a commission already has its stage and rewards written, so there is nothing for a catalyst to season.\nThe server holds your catalyst records, so this screen and the shop need a login.',
  'catalyst.manage.empty': 'No catalysts in stock. Earn them from elite and boss runs.',
  'catalyst.manage.owned': 'x{n}',
  // {n} = 이번 클릭으로 실제 분해될 수량(스테퍼 값을 보유량으로 깎은 값). 되돌릴 수 없는
  // 조작이라 라벨이 수량을 반드시 반영해야 한다 — 고정 "1" 문구는 오조작을 부른다.
  'catalyst.manage.salvage': 'Salvage {n}',
  'catalyst.manage.salvageDone': 'Salvaged {name} · +{residue} catalyst residue',
  'catalyst.manage.salvageFail': 'Salvage failed',
  'catalyst.manage.offline': 'Catalysts require online play.',
  'catalyst.manage.filterAll': 'All',
  'catalyst.manage.filterCommon': 'Common',
  'catalyst.manage.filterSignature': 'Signature',
  'result.loot.catalysts': 'Catalysts',
  'result.loot.catalystList': 'Catalysts Gained',
  // --- 의뢰 확정 지급물 판정(의뢰서 시스템 Phase E, verify-commission 응답) ---
  'result.commission.label': 'Commission Reward',
  'result.commission.pending': 'Confirming…',
  'result.commission.verified': '+{credits} credits · +{minerals} minerals',
  'result.commission.xpLabel': 'Commission XP',
  'result.commission.xp': '+{xp} XP',
  'result.commission.xpLevels': '+{xp} XP · +{levels} Lv',
  'result.commission.rejected': 'Rejected',
  'result.commission.queued': 'Retrying (offline)',
  'result.commission.lost': 'Could not submit — rewards not granted',
  'result.commission.offline': 'Offline',

  // --- 촉매 잔재·촉매 상점·분해 수량(ADR-0042, catalyst-shop-residue lane) ---
  'catalyst.residue.name': 'Catalyst Residue',
  'catalyst.shop.buy': 'Buy',
  'catalyst.shop.price': '{n} Catalyst Residue',
  'catalyst.shop.signatureNotSold': 'Signature catalysts are not sold.',
  'catalyst.shop.priceUnset': 'Price not set — cannot buy.',
  'catalyst.shop.insufficientResidue': 'Not enough catalyst residue.',
  'catalyst.shop.noProfile': 'Could not load your profile yet. Please try again in a moment.',
  'catalyst.shop.offline': 'The catalyst shop needs a server connection.',
  'catalyst.shop.buyFail': 'Purchase failed',
  'catalyst.salvage.qty': 'Salvage Qty',
  'catalyst.salvage.gained': '+{n} Catalyst Residue',
  // 보관함 잔재 패널(2026-08-02 AAA 전환) — 큰 숫자 하나만 두면 패널이 비어 보인다.
  'catalyst.archive.affordable': 'Affordable now: {n} kinds',
  'catalyst.archive.residueUse': 'Earned by salvaging. Spent on purchases.',
  'catalyst.archive.detailTitle': 'Catalyst Details',
  'catalyst.archive.detailEmpty': 'Select a catalyst from the list.',
  'catalyst.archive.labelSalvage': 'Salvage',
  'catalyst.archive.labelPrice': 'Price',
  'catalyst.archive.labelOwned': 'Owned',
  'catalyst.archive.rowKind': 'Type',
  'catalyst.archive.rowTags': 'Tags',
  'catalyst.archive.rowCap': 'Settlement Cap',
  'catalyst.archive.notSold': 'Not sold',

  // --- 태그·상한(ADR-0052) — 픽커 카드 / 보관함 상세 / 런 중 정보판 공용 ---
  // 태그 6종 고정. 같은 태그 2장 = 약공명 / 3장 = 강공명(`data/catalystResonance.ts`).
  'catalyst.tag.ignite': 'Ignite',
  'catalyst.tag.density': 'Density',
  'catalyst.tag.precision': 'Precision',
  'catalyst.tag.harvest': 'Harvest',
  'catalyst.tag.gamble': 'Gamble',
  'catalyst.tag.erosion': 'Erosion',
  // 상한 축 5종(`CatalystCapAxis`). 구 보상축과 달리 **정산 유계**이지 발동 배율이 아니다.
  'catalyst.cap.drop': 'Drops',
  'catalyst.cap.resource': 'Resources',
  'catalyst.cap.rarity': 'Rarity',
  'catalyst.cap.xp': 'XP',
  'catalyst.cap.catalystDrop': 'Catalyst Drops',
  'catalyst.cap.line': '{axis} x{mult}',
  'catalyst.cap.head': 'Cap',

  // --- 공명(시스템 용어) — 한 런에 최대 하나만 발동한다 ---
  'catalyst.resonance.head': 'Resonance',
  'catalyst.resonance.none': 'No resonance yet',
  'catalyst.resonance.need': '+{n} more',
  'catalyst.tag.head': 'Tags',
  'catalyst.resonance.tier.weak': 'Weak',
  'catalyst.resonance.tier.strong': 'Strong',
  'catalyst.resonance.ember.name': 'Ember',
  'catalyst.resonance.ember.rule':
    'A kill bursts and shoves nearby enemies back. Shoved enemies take less damage for 1s.',
  'catalyst.resonance.reverberation.name': 'Reverberation',
  'catalyst.resonance.reverberation.rule':
    'Kills chain. The last link of the chain strikes you instead.',
  'catalyst.resonance.attraction.name': 'Attraction',
  'catalyst.resonance.attraction.rule':
    'At 15+ enemies, like kinds pull together. Clustered enemies share armor and toughen.',
  'catalyst.resonance.crossfire.name': 'Crossfire',
  'catalyst.resonance.crossfire.rule':
    'Enemy bullets hit enemies too. Your bullets stop at the first enemy.',
  'catalyst.resonance.whetting.name': 'Whetting',
  'catalyst.resonance.whetting.rule':
    'Every 10s unhit, your next shot pierces. Right after, you fire slower for 3s.',
  'catalyst.resonance.deflection.name': 'Deflection',
  'catalyst.resonance.deflection.rule':
    'Some enemy bullets ricochet into other enemies. Bullets that do not ricochet hit twice as hard.',
  'catalyst.resonance.snare.name': 'Snare',
  'catalyst.resonance.snare.rule':
    'Enemies stepping on ground loot are held for 1s. You cannot collect it meanwhile.',
  'catalyst.resonance.fruition.name': 'Fruition',
  'catalyst.resonance.fruition.rule':
    'An enemy dying on loot raises its grade. An enemy stepping on it lowers the grade.',
  'catalyst.resonance.advance.name': 'Advance',
  'catalyst.resonance.advance.rule':
    'You get one loot up front at run start. Lose the run and you lose that too.',
  'catalyst.resonance.settlement.name': 'Settlement',
  'catalyst.resonance.settlement.rule':
    'Your first loot is sealed. Kill the boss for top grade; lose and only that one is gone.',
  'catalyst.resonance.abrasion.name': 'Abrasion',
  'catalyst.resonance.abrasion.rule':
    'Every 30s your move speed rises and your hitbox grows (restored on wave change).',
  'catalyst.resonance.subsidence.name': 'Subsidence',
  'catalyst.resonance.subsidence.rule':
    'Every 30s the field crumbles inward — smaller arena, denser drops. Clearing a heavy fight restores half.',

  // --- 픽커 경고 2단 — 회색 = 이 행성에서 무효(구조적) / 노랑 = 촉매 간 충돌(축소 작동) ---
  // ⚠️ 헌장 §축소 작동 규율: 경고일 뿐이고 sim 이 그 카드를 끄는 근거가 아니다.
  'catalyst.warn.head': 'Warnings',
  'catalyst.warn.none': '—',
  'catalyst.warn.voidOnPlanet': 'Void on this planet',
  'catalyst.warn.conflict': 'Reduced by another catalyst',
  'catalyst.warn.badgeVoid': 'VOID',
  'catalyst.warn.badgeConflict': 'CLASH',

  // --- 픽커 슬롯·거부 사유(유니크 주입 — 같은 카드는 한 장뿐) ---
  'catalyst.picker.slotEmpty': 'Empty',
  'catalyst.picker.blockDuplicate': 'Already injected',
  'catalyst.picker.blockSignatureCap': 'Signature max {cap}',
  'catalyst.picker.blockNoStock': 'None owned',
  'catalyst.picker.injected': 'Injected',

  // --- 런 중 침공 정보판(우측 가운데, 사용자 요청 2026-07-28) ---
  'runinfo.title': 'Current Sortie',
  'runinfo.stage': 'Stage {n}',
  'runinfo.catalysts': 'Catalysts {n}',
  'runinfo.noCatalysts': 'No catalysts injected',

  // --- 촉매 카탈로그(catalyst.<slug>.name/desc — src/data/catalysts.ts 48종) ---
  'catalyst.abundance.name': 'Abundance',
  'catalyst.abundance.rule':
    'Drops fall twice as often, but once five pile up on the ground, enemies speed up by that much.',
  'catalyst.abundance.signal':
    'Past five loot on the ground, a red current rises off the pile and enemy afterimages lengthen.',
  'catalyst.plunder.name': 'Plunder',
  'catalyst.plunder.rule':
    'Elites and bosses drop nothing on death, but ramming one loots it all at once — and you take contact damage.',
  'catalyst.plunder.signal':
    'Plunderable enemies pulse with a gold outline; on plunder their body bursts and loot spills out.',
  'catalyst.harvest.name': 'Harvest',
  'catalyst.harvest.rule':
    'A harvest zone opens where an enemy dies, piercing your shots inside it, but standing on it slows you like a field.',
  'catalyst.harvest.signal':
    'A golden ring lights bullets as they pierce through it; standing on it wraps your ship in a harvest ring.',
  'catalyst.bounty.name': 'Bounty',
  'catalyst.bounty.rule':
    'Getting hit drops a bounty marker where you were struck; collect it for resources, but an enemy grabs it first.',
  'catalyst.bounty.signal':
    'A gold marker plants at the hit spot; if an enemy eats it, it swells red and the payout shifts to that enemy.',
  'catalyst.cornucopia.name': 'Cornucopia',
  'catalyst.cornucopia.rule':
    'Leveling up detonates all ground loot to burn nearby enemies, but recovered loot drops one rarity tier.',
  'catalyst.cornucopia.signal':
    "On level-up all ground loot explodes at once, brightening the screen as it's pulled in a tier lower.",
  'catalyst.refinement.name': 'Refinement',
  'catalyst.refinement.rule':
    'A refine option appears on level-up to fuse three same-rarity items into one higher tier, but losing the run loses the forge.',
  'catalyst.refinement.signal':
    'One level-up slot becomes a refine card; fusing triggers an upgrade flourish, with the forge shown on the HUD.',
  'catalyst.gilding.name': 'Gilding',
  'catalyst.gilding.rule':
    'Enemies gild over time and grow stronger, but killing one strips the gilding onto the nearest enemy.',
  'catalyst.gilding.signal':
    'Enemy surfaces shift copper to silver to gold by stage; on death the gilding flies off to a neighbor.',
  'catalyst.prospect.name': 'Appraisal',
  'catalyst.prospect.rule':
    'Each wave marks one enemy as a lode-bearer, invincible while escorted, breakable only once escorts scatter.',
  'catalyst.prospect.signal':
    'The marked enemy wears a crystal shell; a shield shimmers while escorted and cracks open once they scatter.',
  'catalyst.alchemy.name': 'Alchemy',
  'catalyst.alchemy.rule':
    'Three nearby common-rarity drops fuse into a magic one, but the fusion spot becomes a toxic field.',
  'catalyst.alchemy.signal':
    'Purple threads link three commons and pull into one point on fusion, spreading a purple field there.',
  'catalyst.epiphany.name': 'Epiphany',
  'catalyst.epiphany.rule':
    'Level-up becomes a single, unrejectable double-stacked pick — every unwanted one still banks XP.',
  'catalyst.epiphany.signal':
    'The pick screen folds into one gilded card as the other two slots turn to ash; there is no choice button.',
  'catalyst.insight.name': 'Insight',
  'catalyst.insight.rule':
    'Enemy bullets show a warning line before firing, but XP triples only while you stand on that line.',
  'catalyst.insight.signal':
    'A red warning line is drawn before the shot; standing on it makes your ship glow white with a gem multiplier shown.',
  'catalyst.tutelage.name': 'Tutelage',
  'catalyst.tutelage.rule':
    'You start at level 5, but every level-up for the rest of this run is decided automatically, with no pick.',
  'catalyst.tutelage.signal':
    'Five level-up flourishes fire back to back at launch; after that, cards are drawn but never chosen.',
  'catalyst.ascension.name': 'Ascension',
  'catalyst.ascension.rule':
    'Each wave crossed cuts max HP by 10% and raises damage by 10%, but piercing an enemy with a dash restores 1 HP.',
  'catalyst.ascension.signal':
    "At each wave transition the HP bar's ceiling drops and the ship glows a shade brighter; recovery rewinds it.",
  'catalyst.enlightenment.name': 'Enlightenment',
  'catalyst.enlightenment.rule':
    'The fewer enemies on screen, the bigger your bullets grow (up to 3x), but express spawns come in twice as fast.',
  'catalyst.enlightenment.signal':
    'Bullets visibly thicken and brighten as enemies thin out, then shrink back once the screen fills again.',
  'catalyst.mastery.name': 'Mastery',
  'catalyst.mastery.rule':
    'The level-up pick offers the same powerup three times over — take it for a triple stack, but the other two picks are gone.',
  'catalyst.mastery.signal':
    'All three cards show the identical art with a large stack count; loot drops beside you right after picking.',
  'catalyst.extraction.name': 'Extraction',
  'catalyst.extraction.rule':
    "Supply-raid resources don't arrive at once — they ride on enemies, hardening into loot on a kill, but vanish if it leaves the screen.",
  'catalyst.extraction.signal':
    'At the raid, resources scatter onto enemies in a blue-white glow; a kill hardens them into a crystal on the ground.',
  'catalyst.foundry.name': 'Foundry',
  'catalyst.foundry.rule':
    'Every third kill raises a turret, but while any stand, your own damage is split down by that many turrets.',
  'catalyst.foundry.signal':
    'Metal folds up into a turret on every third kill, and the HUD firepower gauge dips per turret standing.',
  'catalyst.greed.name': 'Greed',
  'catalyst.greed.rule':
    "Resources don't arrive directly — they spawn as an enemy worth that much, paying triple on a kill but vanishing if it escapes.",
  'catalyst.greed.signal':
    "The ground splits open into a gold-tinted enemy the instant you'd earn it; it fades to gray if it leaves the screen.",
  'catalyst.mercantile.name': 'Mercantile',
  'catalyst.mercantile.rule':
    "One level-up slot becomes a debt card, granting a double stack now but seizing that run's loot if the debt goes unpaid.",
  'catalyst.mercantile.signal':
    'One pick slot turns into a red IOU, and the HUD tallies a rising debt total with every one you take.',
  'catalyst.motherlode.name': 'Motherlode',
  'catalyst.motherlode.rule':
    'Enemies become ore veins — a kill leaves a chunk instead of resources, and breaking it locks your auto-aim onto it.',
  'catalyst.motherlode.signal':
    'A shining ore chunk is left behind on a kill, shedding fragments as it breaks with the aim line locked onto it.',
  // ⚠️ id 20 의 **표시명만** 'Resonance' → 'Attunement'. 시스템 용어 Resonance(공명, 12종
  // 태그 공명)와 카드 이름이 같은 말이면 픽커 하단 "Resonance" 챔버 안에 "Resonance" 카드가
  // 서서 읽히지 않는다. `slug: 'resonance'`·`id: 20`·아이콘 파일명은 **그대로**다(서버 원장·
  // 상점 가격 시드·자산이 그 앵커 위에 있다). 헌장 §"표시명은 바꿀 수 있다(slug 는 불변)".
  'catalyst.resonance.name': 'Attunement',
  'catalyst.resonance.rule':
    'Three enemies of a kind clustered together attune and grow stronger, but killing one instantly kills the rest and drops all three shares of loot.',
  'catalyst.resonance.signal':
    'A pulsing beam links the attuned enemies together, and a resonant tone hums softly between them.',
  'catalyst.catalysis.name': 'Catalysis',
  'catalyst.catalysis.rule':
    "Catalyst drops don't go to your stash — they lodge as an unsettled crystal that breaks if an enemy steps on it, settling only on a win.",
  'catalyst.catalysis.signal':
    'A catalyst crystal pulses embedded in the ground, and cracks form and shatter it if an enemy nears.',
  'catalyst.cascade.name': 'Cascade',
  'catalyst.cascade.rule':
    'Enemies explode on death, burning you too for half the damage, but a kill from that blast pays double loot.',
  'catalyst.cascade.signal':
    'A visible blast radius spreads on every kill, and self-damage tints the screen in a catalyst-only color.',
  'catalyst.seeding.name': 'Seeding',
  'catalyst.seeding.rule':
    'A seed is left where an enemy dies and grows into a loot tree after 15 seconds, but an enemy stepping on it first eats it and grows stronger.',
  'catalyst.seeding.signal':
    'The seed pulses on the ground as a sprout ring fills, then a tree rises and sheds fruit once it germinates.',
  'catalyst.chainreaction.name': 'Chain Reaction',
  'catalyst.chainreaction.rule':
    'Damage you take is transferred straight to the nearest enemy, but your max HP cap drops by that much for the rest of the wave.',
  'catalyst.chainreaction.signal':
    "A red chain lashes from your ship to an enemy on every hit, and the HP bar's ceiling sinks by the transfer amount.",
  'catalyst.overdrive.name': 'Overdrive',
  'catalyst.overdrive.rule':
    'Firing heats your barrel, boosting damage up to 2x as it glows hotter, but crossing the threshold silences you for 3 seconds.',
  'catalyst.overdrive.signal':
    'The barrel glows red as the HUD heat gauge climbs, then vents steam and stalls once it crosses the threshold.',
  'catalyst.rapidcore.name': 'Rapid Core',
  'catalyst.rapidcore.rule':
    'Holding one heading builds damage up to 2x, but taking a hit resets it back to nothing.',
  'catalyst.rapidcore.signal':
    'The longer you hold a heading, the longer the trail and brighter the bullets, until a hit scatters it all.',
  'catalyst.afterburner.name': 'Afterburner',
  'catalyst.afterburner.rule':
    'Dash cooldown vanishes, but each dash cuts max HP by 3 — piercing a kill with a dash returns those 3.',
  'catalyst.afterburner.signal':
    'Flame bursts from the thruster on every dash as the HP ceiling dips, then rewinds on a piercing kill.',
  'catalyst.bulwark.name': 'Bulwark',
  'catalyst.bulwark.rule':
    'For 3 seconds after a hit, a 120-degree arc toward the hit blocks enemy bullets, but your own guns go silent in that arc too.',
  'catalyst.bulwark.signal':
    'A hex barrier unfolds on the hit side, shattering bullets, while the gun on that side visibly folds shut.',
  'catalyst.ascendant.name': 'Ascendant',
  'catalyst.ascendant.rule':
    'Max HP is halved, but dash invincibility lasts twice as long, and any enemy passed through during it is frozen in place for 2 seconds.',
  'catalyst.ascendant.signal':
    'The ship turns translucent white as enemies passed through freeze solid with a binding ring at their feet.',
  'catalyst.kargon-swarmcall.name': 'Kargon Swarmcall',
  'catalyst.kargon-swarmcall.rule':
    "The kill quota per wave is halved, but each wave crossed adds a stacking bump to the next segment's enemy cap.",
  'catalyst.kargon-swarmcall.signal':
    "A stack gauge at the top fills one notch per wave crossed, and the next segment visibly thickens with enemies.",
  'catalyst.kargon-magma-vein.name': 'Kargon Magma Vein',
  'catalyst.kargon-magma-vein.rule':
    'Lava rises along the path of your shots, burning enemies and you alike, but a kill on lava pays double loot.',
  'catalyst.kargon-magma-vein.signal':
    'Cracks split the ground into lava along your firing line, with self-damage tinted in the catalyst-only color.',
  'catalyst.kargon-lava-warden.name': 'Kargon Lava Warden',
  'catalyst.kargon-lava-warden.rule':
    'The boss wears a lava shell that softens the closer you get, but that same radius is its contact-damage zone.',
  'catalyst.kargon-lava-warden.signal':
    'The shell melts into red cracks as you approach, then seals shut with a hardening sound as you back off.',
  'catalyst.berdan-collapse.name': 'Berdan Collapse',
  'catalyst.berdan-collapse.rule':
    'The safe circle no longer follows you and jumps elsewhere every 15 seconds, but for 5 seconds after each jump every enemy inside the new circle dies instantly.',
  'catalyst.berdan-collapse.signal':
    'A warning ring marks the next spot 3 seconds ahead, then a white burst wipes out every enemy inside on the jump.',
  'catalyst.berdan-royal-jelly.name': 'Berdan Royal Jelly',
  'catalyst.berdan-royal-jelly.rule':
    'Jelly is left behind as the safe zone shrinks — enemies that eat it slow down and pay triple resources on death, but the rest speed up.',
  'catalyst.berdan-royal-jelly.signal':
    'A golden jelly trail lines the shrink edge; enemies that feed on it turn gold and sluggish while others flush red and quicken.',
  'catalyst.berdan-hive-queen.name': 'Berdan Hive Queen',
  'catalyst.berdan-hive-queen.rule':
    'The boss sheds worker bees in proportion to damage taken, and each bee carries a share of its HP that drains when killed.',
  'catalyst.berdan-hive-queen.signal':
    "Bees burst from the boss's flank on every hit, and the boss HP bar visibly drops whenever one is killed.",
  'catalyst.niflheim-pursuit.name': 'Niflheim Pursuit',
  'catalyst.niflheim-pursuit.rule':
    "The predator leaves a shadow that retraces your path and kills on contact, but outrunning it doubles shelter-capture speed.",
  'catalyst.niflheim-pursuit.signal':
    "A translucent black silhouette retraces your exact path, with a faint trail left behind so you can read where it's coming from.",
  'catalyst.niflheim-rime-crystal.name': 'Niflheim Rime Crystal',
  'catalyst.niflheim-rime-crystal.rule':
    'Ground you cross freezes, slowing enemies and dropping a crystal on a kill there, but the predator accelerates on ice instead.',
  'catalyst.niflheim-rime-crystal.signal':
    'A frost trail lines your path and enemies on it turn blue and sluggish, while the predator glides faster across it.',
  'catalyst.niflheim-flagship.name': 'Niflheim Flagship',
  'catalyst.niflheim-flagship.rule':
    'A flagship hovers over the predator, breaking shelters one by one, but standing at a broken one lets it repair over time.',
  'catalyst.niflheim-flagship.signal':
    'A flagship crosses overhead trailing bombardment fire, and a repair ring fills over each broken shelter.',
  'catalyst.arke-overclock.name': 'Arke Overclock',
  'catalyst.arke-overclock.rule':
    'Scroll speed doubles and crashing through walls breaks them for resources, but each crash drops your top speed a notch.',
  'catalyst.arke-overclock.signal':
    'Speed lines stretch along both edges, walls burst into resources on impact, and the HUD top-speed gauge rises and falls.',
  'catalyst.arke-ancient-core.name': 'Arke Ancient Core',
  'catalyst.arke-ancient-core.rule':
    'Absorbing an ancient core on the course pays a large resource haul, but its mass doubles your turn radius for 3 seconds.',
  'catalyst.arke-ancient-core.signal':
    'Absorbing a core drags your flight path heavy, and the widened turning arc is visibly slower to close.',
  'catalyst.arke-obelisk.name': 'Arke Obelisk',
  'catalyst.arke-obelisk.rule':
    'Three gates stand before the boss and weaken it per gate cleared, but each gate missed hands that power back to the boss.',
  'catalyst.arke-obelisk.signal':
    'Each gate raises a distinct light-grid with its condition marked, collapsing into a filled seal on a clear.',
  'catalyst.toxar-outbreak.name': 'Toxar Outbreak',
  'catalyst.toxar-outbreak.rule':
    'Purging a node only clears half the contamination, but your shots feed on contamination to grow, doubling loot from kills on it.',
  'catalyst.toxar-outbreak.signal':
    'Purges leave a faint residue of contamination behind, and a contamination-area gauge sits on the HUD at all times.',
  'catalyst.toxar-blightspore.name': 'Toxar Blightspore',
  'catalyst.toxar-blightspore.rule':
    'A kill leaves a spore cloud that doubles the speed of enemies inside, but a kill inside the cloud pays double loot.',
  'catalyst.toxar-blightspore.signal':
    'A purple cloud spreads on every kill, visibly quickening any enemy caught inside as spores cling to them.',
  'catalyst.toxar-blight-mother.name': 'Toxar Blight Mother',
  'catalyst.toxar-blight-mother.rule':
    "The boss rises into a second form the instant it falls, tripling the reward if you finish it, but losing both if you don't.",
  'catalyst.toxar-blight-mother.signal':
    "The fallen body swells and bursts into a larger form as the reward display locks to 'pending' at the top.",
  'catalyst.kras-breach.name': 'Kras Breach',
  'catalyst.kras-breach.rule':
    'Blocks triple in toughness and stack in layers, but each layer broken leaves cover behind that blocks enemy fire.',
  'catalyst.kras-breach.signal':
    'Blocks take on a layered metallic look, peeling off one layer per hit as a catalyst icon flies out from inside.',
  'catalyst.kras-breachsteel.name': 'Kras Breachsteel',
  'catalyst.kras-breachsteel.rule':
    'Broken block fragments orbit behind you as a shield, but carrying them slows your ship down proportionally.',
  'catalyst.kras-breachsteel.signal':
    'Block fragments trail your ship in orbit, and enemy bullets shatter on contact with them.',
  'catalyst.kras-colossus.name': 'Kras Colossus',
  'catalyst.kras-colossus.rule':
    "Remaining blocks are the boss's armor, so breaking them weakens it, but the scroll speeds up wherever a block was cleared.",
  'catalyst.kras-colossus.signal':
    'Beams link every block to the boss, and its armor peels off a layer with each block broken.',

  // --- 기지 허브 ---
  'base.title': 'Base',
  'base.sub': 'Enter a building to manage, or launch to raid a planet.',
  // 시네마틱 기지 화면의 하단 메타. `meta.line` 과 달리 **크레딧·광물이 없다** — 그 둘은
  // 상단 재화 칩이 이미 보여 주므로 같은 화면에서 두 번 적으면 디버그 텍스트로 읽힌다
  // (AAA 비평 지적). `meta.line` 은 DOM 판·정산이 계속 쓰므로 건드리지 않는다.
  'base.metaShort': 'Ship Lv {lv} · Skills {sp}',
  'base.launch': '▶ Star Map (Launch)',
  // 출격 카드(격자 8번째 칸)의 부제. 카드가 건물 타일과 같은 골격을 쓰므로 설명 줄이 필요하다.
  'base.launchSub': 'To the six archive worlds',
  'base.bld.hangar.name': 'Hangar',
  'base.bld.hangar.desc': 'Gear · Inventory · Salvage',
  'base.bld.research.name': 'Research Lab',
  'base.bld.research.desc': 'Skill Tree · Respec',
  'base.bld.refinery.name': 'Refinery',
  'base.bld.refinery.desc': 'Affix Reroll · Lock Reroll',
  'base.bld.defense.name': 'Defense Command',
  'base.bld.defense.desc': 'Defense Layout · Maintenance',
  'base.bld.control.name': 'Control Tower',
  'base.bld.control.desc': 'Ladder · Invasion · Replay',
  'base.bld.archive.name': 'Record Vault',
  'base.bld.archive.desc': 'Pilot Files · Record Shards · Prologue',
  'base.bld.commission.name': 'Commission Desk',
  'base.bld.commission.desc': 'Accept Commissions · Confirmed Rewards',
  'base.lock.pre': 'Locked',
  'base.lock.level': 'Requires Ship Lv {lvl}',
  'base.lock.clear': 'Clear a planet first',
  'base.locked': 'Locked',

  // --- 상태줄(크레딧/광물/레벨/스킬) ---
  'meta.line': 'Credits {c} · Minerals {m} · Ship Lv {lv} · Skills {sp}',

  // --- 타이틀 ---
  'title.tag': 'Raid planets to farm loot, then breach higher-ranked bases.',
  'title.startTutorial': '▶ Start Tutorial',
  'title.enterBase': '▶ Enter Base',
  'title.note': 'Learn the basics in homeworld orbit (about 3–4 min).',
  // Google 브랜딩 가이드라인이 규정한 문구. 임의로 바꾸지 마라(공식 번역만 허용된다).
  'title.signInGoogle': 'Sign in with Google',
  'title.signInFailed': 'Sign-in could not start. Check your connection and try again.',
  'title.loading': 'Loading your commander file…',

  // --- 튜토리얼 힌트 ---
  'tutorial.label': 'Tutorial',
  'tutorial.hint0': 'Move to aim at enemies — firing is automatic.',
  'tutorial.hint1': 'Defeat enemies to collect XP gems. Leveling up lets you pick a powerup.',
  'tutorial.hint2': 'Dash to dodge enemy fire. Dodging dense barrages is the smart play.',
  'tutorial.hint3': 'Grabbing your first gear reveals the base. Keep pushing!',
  'tutorial.hint4': 'Press Z or X to trigger your active skills once unlocked.',

  // --- 액티브 스킬 크롬(ADR-0041 · 레인 D) — 연구소 패널 + HUD 좌하단 -------------------------
  // ⚠️ `lab.actives.locked` 의 `{n}` 은 **파생값**(`activeGateThreshold(def)`)을 넘긴다.
  //    숫자를 문구에 박으면 안 된다 — 고티어 게이트는 `capstoneGate` 추종이라 **해츨링만 44** 다.
  //    `lab.actives.sub` 의 `{m}` 도 `ACTIVE_SLOT_COUNT` 파생이다.
  'lab.actives.btn': 'Active Skills',
  'lab.actives.title': 'Active Skills',
  'lab.actives.sub': 'Equipped {n}/{m} · unlocked by tree investment',
  'lab.actives.slot': 'Slot {n}',
  'lab.actives.slotEmpty': 'Empty',
  'lab.actives.unequipHint': 'Click a slot to unequip',
  'lab.actives.locked': 'Locked · {n} pt in tree',
  'lab.actives.ready': 'Equipped',
  'lab.actives.meta': 'CD {cd}s · Power {p}%',
  'lab.actives.tier.lo': 'Tier I',
  'lab.actives.tier.hi': 'Tier II',
  'lab.actives.none': 'No active skills authored for this ship yet.',
  'lab.err.activeLocked': 'Not unlocked yet — invest more in that tree.',
  'lab.err.activeFull': 'Both active slots are full — unequip one first.',
  'hud.active.title': 'ACTIVES',
  'tutorial.drop': 'Gear acquired! Finish this run to maintain it at the base.',

  // --- 레벨업 파워업 선택 ---
  'powerup.title': 'Level Up! — Choose an Upgrade',
  'powerup.hint': 'Click or keys {keys}',
  'powerup.aria': 'Upgrade {n}: {name} — {desc}',
  'powerup.stat.weapon': 'Weapon',
  'powerup.stat.level': 'Lv',
  'powerup.stat.damage': 'Damage',
  'powerup.stat.bullets': 'Bullets',
  'powerup.stat.fire': 'Fire',
  'powerup.stat.pierce': 'Pierce',
  'powerup.stat.spread': 'Spread',
  'powerup.stat.move': 'Move',
  'powerup.stat.dash': 'Dash',
  'powerup.stat.hp': 'HP',
  'powerup.stat.magnet': 'Magnet',

  // --- 조우(Encounter) 프롬프트 (ADR-0033) ---
  // 컬러 이모지 금지(Pixi 텍스트에서 두부로 깨진다 — src/ui/pixi/text.ts stripEmoji).
  'encounter.vault.title': 'Treasure Vault Portal',
  'encounter.vault.desc': 'Loot beyond, guards inside. Dying here fails the run.',
  'encounter.guardian.title': 'Sealed Guardian',
  'encounter.guardian.desc': 'Breaking the seal summons a mini boss right here.',
  'encounter.altar.title': "Oscar's Altar",
  'encounter.altar.desc': 'One offering only. Choose your gamble.',
  'encounter.altar.0.name': 'Instant Reward',
  'encounter.altar.0.desc': 'High-grade gear and credits, right now',
  'encounter.altar.1.name': 'Drop Boost',
  'encounter.altar.1.desc': 'More drops for the rest of the run',
  'encounter.altar.2.name': 'Sealed Chest',
  'encounter.altar.2.desc': 'Many low-grade items, never empty-handed',
  'encounter.action.enter': 'Enter (E)',
  'encounter.action.open': 'Break Seal (E)',
  'encounter.action.decline': 'Ignore (Q)',
  'encounter.detour.title': 'Inside the Treasure Vault',
  'encounter.detour.remain': 'Time left {sec}s',
  // detour 이탈 키는 `KeyX` → `KeyQ` 로 이설됐다(ADR-0041 — `x` 는 액티브 슬롯 2가 쓴다).
  'encounter.detour.exit': 'Leave now (Q)',
  'encounter.hint.keys': 'Click or keys {keys}',

  // --- 도발 스티커 12종(data/stickers.ts 인덱스 계약과 id 로 연결) ---
  'sticker.good-game': 'GG! See you next round',
  'sticker.nice-try': 'Nice fight — but I won anyway',
  'sticker.galaxy-small': 'Small galaxy, see you around',
  'sticker.lock-door': 'Lock the door next time',
  'sticker.five-stars': '5 stars for your base! (not for the difficulty)',
  'sticker.maintenance': 'Should have kept up the maintenance',
  'sticker.sightseeing': 'Thanks for the planet tour',
  'sticker.turret-regards': 'Our turret says hi',
  'sticker.take-a-seat': 'Should have stayed for coffee',
  'sticker.rematch-anytime': 'Revenge? I can wait',
  'sticker.core-walk': 'Nice stroll to the core',
  'sticker.safe-travels': 'Safe travels home',
  'sticker.skip': 'Skip without a sticker',
  'sticker.prompt.invade': 'Invasion success! Leave a taunt sticker?',
  'sticker.prompt.defend': 'Defense success! Leave a taunt sticker?',
  'sticker.subtitle': 'A word for {name}',

  // --- 공통 내비게이션 ---
  'common.backToBase': '◀ Back to Base',

  // --- 아이템 무기 확장(정제소 5타입) ---
  'item.weapon.3': 'Missile',
  'item.weapon.4': 'Beam',
  // 보조무기 5종(world.ts SUB_TYPE_*) — 이름이 없어 인벤토리에서 구별이 안 됐다(2026-07-27).
  'item.subWeapon.0': 'Sidekick',
  'item.subWeapon.1': 'Scattergun',
  'item.subWeapon.2': 'Mine Layer',
  'item.subWeapon.3': 'Sentry Drone',
  'item.subWeapon.4': 'Homing Flare',

  // --- HUD ---
  'hud.supplyRaid': '⚠ Supply Raid — Shoot it down!',
  // 시험 침공 이탈 버튼(사용자 요청 2026-08-05). 시험 침공은 정산도 리플레이 제출도 타지 않는
  // 오염 런이라 "끝까지 가야 하는" 이유가 없는데, 여태 나가는 길이 화면에 없었다.
  'hud.exitTest': 'Exit test invasion',
  'hud.combo': 'Combo x{mult} ({combo})',
  // 회수 개수 HUD 연출(PR#366 서버 권위 드랍 후속). `WorldState.loot.length` 그대로 — 콤보와
  // 같은 관용구로 0 이면 감춘다.
  'hud.lootCount': 'Loot {n}',
  'hud.phaseTransition': '⚙ Phase {n} transition…',
  'hud.overheat': "🔥 Overheat — now's your chance! (2× damage)",
  'hud.phase': 'Phase {n}',
  // 보스 등장 예고 게이지(사용자 요청 2026-07-26).
  'hud.bossEta.title': 'UNTIL BOSS',
  'hud.bossEta.segment': 'Sector {n}/{total}',
  'hud.bossEta.kills': 'Kills {n}/{goal}',
  'hud.bossEta.clash': 'Destroy the commander',
  'hud.bossEta.distance': 'Push forward',
  'hud.bossEta.purify': 'Purify the zone',
  'hud.bossEta.shelter': 'Shelters {n}/{goal} — find them all to draw out the predator',
  'hud.bossEta.ring': 'Clear the safe ring',
  // --- 런 목표·주의 2줄(사용자 요청 2026-08-04). 1줄=목표+카운터, 2줄=모드 고정 주의 또는
  // 상황 경고(`warn.*`). 파생은 src/ui/runObjective.ts.
  'hud.obj.count': '{n}/{total}',
  'hud.obj.inv0': 'Break through the atmosphere',
  'hud.obj.inv1': 'Push down the corridor',
  'hud.obj.inv2': 'Destroy the core',
  'hud.obj.caution.vampire': 'Getting cornered means getting surrounded — keep moving',
  'hud.obj.caution.blockBreak': 'The screen keeps pushing up — blast the walls open',
  'hud.obj.caution.racing': 'Falling to the rear edge grinds your hull down',
  'hud.obj.caution.chase': 'Touching the predator is instant death — keep your distance',
  'hud.obj.caution.shrink': 'Outside the safe ring you take damage every moment',
  'hud.obj.caution.contamination': 'If contamination hits critical the run is lost',
  'hud.obj.caution.invasion': 'The core must fall before the clock runs out',
  'hud.obj.warn.predator': 'The predator is on you — break away now',
  'hud.obj.warn.outside': 'You are outside the safe ring — get back inside',
  'hud.obj.warn.healer': 'A repair ship is healing them — take it out first',
  'hud.obj.warn.time': 'Only {n}s left',
  'hud.obj.shelterReached': 'Shelter secured — {n}/{goal}',
  // 오염도 게이지(톡사르=오염 모드). 실패 임계를 실패 전에 보여 준다.
  'hud.contamination.title': 'CONTAMINATION',
  'hud.contamination.warn': 'Critical contamination imminent — destroy the nodes',
  // 침공 진행 패널(사용자 요청 2026-07-29). `hud.inv.layer{0,1,2}` 는 페이즈 코드로 조립되므로
  // 세 키가 반드시 연속으로 존재해야 한다(src/ui/invasionProgress.ts).
  'hud.inv.title': 'INVASION PROGRESS',
  'hud.inv.layer0': 'L1 · Atmospheric Breach',
  'hud.inv.layer1': 'L2 · Corridor Push',
  'hud.inv.layer2': 'L3 · Core Chamber',
  'hud.inv.layerTime': 'Layer',
  'hud.inv.totalTime': 'Total',
  'hud.inv.core': 'CORE',
  'hud.inv.boss': 'GUARDIAN BOSS',
  'hud.inv.defense': 'Defenders left',
  'hud.inv.facilities': 'Emplacements',
  'hud.inv.guardians': 'Guardians',
  'hud.inv.props': 'Fixtures',
  'hud.inv.enemies': 'Hostiles',

  // --- 리플레이 관전 ---
  'replay.badge': 'Spectate',
  'replay.titleBody': '{who} invasion replay (render-only, does not affect records)',
  'replay.pause': '⏸ Pause',
  'replay.play': '▶ Play',
  'replay.restart': '⟲ Restart',
  'replay.exit': 'Exit',
  'replay.opponentBase': 'Opponent Base',

  // --- 연구소 ---
  'lab.title': 'Research Lab — Skill Tree',
  'lab.tree.firepower': 'Firepower',
  'lab.tree.survival': 'Survival',
  'lab.tree.mobility': 'Mobility',
  // M8 신규 기체 12계열. 키의 축은 `ShipTreeDef.slug` 다 — 위 3개(firepower/survival/mobility)는
  // 스트라이커의 slug 라 개명 없이 그대로 맞는다. `tests/i18n.test.ts` 가 SHIP_TYPES 를 순회해
  // 전 계열 slug 의 존재를 대조하므로, 타입이 늘면 문구를 채우기 전까지 빨간불이다.
  'lab.tree.blade': 'Blade',
  'lab.tree.morph': 'Morph',
  'lab.tree.fortify': 'Fortify',
  'lab.tree.chain': 'Chain',
  'lab.tree.barrage': 'Barrage',
  'lab.tree.barrier': 'Barrier',
  'lab.tree.assassin': 'Assassin',
  'lab.tree.phase': 'Phase',
  'lab.tree.disrupt': 'Disrupt',
  'lab.tree.brood': 'Brood',
  'lab.tree.nurture': 'Nurture',
  'lab.tree.shelter': 'Shelter',
  'lab.tree.squish': 'Squish',
  'lab.tree.mend': 'Mend',
  'lab.tree.cushion': 'Cushion',
  'lab.tree.pop': 'Pop',
  'lab.tree.drift': 'Drift',
  'lab.tree.film': 'Film',
  'lab.browseAll': 'All Skills ({n}/{m} invested)',
  'lab.noInvested': 'Nothing invested in this tree yet.\nOpen the full list above to invest.',
  'lab.all.title': '{tree} — All Skills',
  'lab.all.sub': 'Points available {n} · invested in this tree {m}pt',
  'lab.all.hint': 'Wheel to scroll · click a row to invest 1pt',
  'lab.bar.points': 'Skill Points',
  'lab.bar.invest': 'Invested',
  'lab.bar.credits': 'Credits',
  'lab.bar.shipLv': 'Ship Lv',
  'lab.err.noPoints': 'Not enough skill points.',
  'lab.err.maxed': 'Already invested to the maximum.',
  // 사슬 선행 조건(ADR-0047). `prereq` 는 팝업 잠긴 행의 설명줄, `chainLocked` 는 클릭 힌트.
  'lab.err.noInvest': 'No investment to undo.',
  'lab.err.noCredits': 'Not enough credits (need {n}).',
  'lab.respecDone': 'Reset the skill tree and refunded the points.',
  'lab.respecBtn': 'Respec ({n} credits)',
  // 리스펙이 장비의 스킬 축 어픽스도 함께 무효화한다는 고지(정본 1 — 설계 ①-10). 진입점은
  // 아직 못 찾았다(보고 참조) — 배선 전까지는 키만 존재.
  'lab.respec.affixNotice':
    'Refunding your points also turns off any gear skill-level bonuses (they come back once you re-invest).',

  // 연구소 도움말(사용자 요청 2026-08-05). 문단 구분은 **홑 개행**이다 — 빈 줄은 Pixi 라벨이
  // 거치는 stripEmoji 가 접어 화면에 도달하지 못한다(`helpModal.ts` 모듈 주석 ①).
  'lab.help': 'Help',
  'lab.help.title': 'Research Lab Guide',
  'lab.help.s1.h': 'What this screen is for',
  'lab.help.s1.b':
    'This is where permanent growth happens. Skill points spent here stay with your ship forever — nothing you build in this screen is lost when a run ends.\nEach ship type has its own three trees. Switching to a different ship means a different set of trees, not the same ones relearned.',
  'lab.help.s2.h': 'Skill points',
  'lab.help.s2.b':
    'Every ship level grants one skill point, and ship level rises from experience carried out of runs. Level 100 is the cap, so points are finite over a ship\'s life and where you spend them is the build.\nSpending is a click on a skill row. Filling all thirty costs 600 points while a lifetime yields around 100, so what you give up is the build.',
  'lab.help.s3.h': 'No prerequisites',
  'lab.help.s3.b':
    'Each tree holds ten skills and all ten are open from the start. There are no tiers and no chains, so you can put a point straight into whichever skill you want.\nWhat you lack is points. Every tree mixes skills worth a single point with skills that only shine at twenty, so the question is which few to go deep on.',
  'lab.help.s4.h': 'One point opens it fully',
  'lab.help.s4.b':
    'A skill\'s behaviour switches on completely at one point. Levels two through twenty only grow that behaviour\'s core number — no level suddenly turns it into something else.\nSo there is no level to wait for. A one-point skill already does its job.',
  'lab.help.s5.h': 'Active skills',
  'lab.help.s5.b':
    'Each ship has six active skills, two per tree, opened by cumulative investment in that tree — 8 points for the lower one, 40 for the higher. Open the Active Skills button in the header to equip them.\nYou may equip two at a time and fire them with Z and X during a run. Their only cost is cooldown; they consume no resource and no hull.\nInvestment keeps improving their power and cooldown whether or not they are equipped, so points are never wasted on a tree whose skill you left at home.',
  'lab.help.s6.h': 'Respec',
  'lab.help.s6.b':
    'Respec costs credits and refunds every point at once, so a build is never permanent. The button in the header shows the current price.\nYour ship\'s signature passive is not part of the tree — it is always on, cannot be invested in, and respec does not touch it.',

  // --- 인벤토리 ---
  'inv.title': 'Manage Gear',
  'inv.cur.credits': 'Credits',
  'inv.cur.minerals': 'Minerals',
  'inv.cur.skillPoints': 'Skill Points',
  'inv.cur.shipLv': 'Ship Lv',
  'inv.equip': 'Equipped',
  'inv.module1': 'Module 1',
  'inv.module2': 'Module 2',
  'inv.invHeader': 'Inventory ({n}/{cap})',
  'inv.stashHeader': 'Stash ({n}/{cap})',
  'inv.loadoutStats': 'Loadout Stats',
  'inv.stat.weapon': 'Main Weapon',
  'inv.stat.damage': 'Damage',
  'inv.stat.fireRate': 'Fire Rate',
  'inv.stat.bullets': 'Bullets',
  'inv.stat.pierce': 'Pierce',
  'inv.stat.moveSpeed': 'Move Speed',
  'inv.stat.hp': 'Bonus HP',
  'inv.stat.magnet': 'Magnet',
  'inv.stat.xp': 'XP',
  'inv.stat.mineralFind': 'Mineral Find',
  'inv.tip.compare': 'Equipped: {name} ({n} affixes)',
  // 장착 비교 블록(사용자 요청 2026-07-27).
  'inv.tip.compareTitle': '— vs equipped —',
  'inv.tip.comparePower': 'Combat Power {n}',
  'inv.tip.compareSame': 'Same as equipped',
  'inv.tip.compareAdded': '▲ added',
  'inv.tip.compareLost': '▼ lost',
  'inv.err.full': 'Inventory is full. Salvage something or expand the stash first.',
  'inv.err.noSalvage': 'No items to salvage.',
  'inv.salvageDone': 'Salvaged {n} → Credits +{credits}, Minerals +{minerals}',
  'inv.stashMax': 'Stash is fully expanded.',
  'inv.err.noCredits': 'Not enough credits (need {n}).',
  'inv.stashExpanded': 'Expanded the stash.',
  'inv.act.salvageLow': 'Salvage Normal·Magic',
  'inv.act.salvageHigh': 'Salvage Rare+',
  // 보관함 헤더용 짧은 라벨(패널이 좁다) + 이동 안내·결과 문구(사용자 요청 2026-07-27).
  'inv.act.salvageLowShort': 'Salvage N·M',
  'inv.act.salvageHighShort': 'Salvage R+',
  'inv.help.stash': 'Click: move to inventory  ·  Salvage respects the active filter',
  'inv.help.inventory': 'Click: equip  ·  Right-click: move to stash',
  'inv.moved.toInventory': 'Moved {name} to the inventory.',
  'inv.moved.toStash': 'Moved {name} to the stash.',
  'inv.err.stashFull': 'The stash is full. Expand it or salvage something first.',
  // 같은 유니크 중복 장착 차단(src/items/uniqueEquip.ts) — 무음 거부 금지.
  'inv.err.duplicateUnique':
    '{name} — the same unique is already equipped. Unique effects do not stack, so the second copy would waste the slot.',
  'inv.tip.equippedNow': 'Currently equipped',
  'inv.act.expand': 'Expand Stash ({n} credits)',
  'inv.act.expandMax': 'Stash Fully Expanded',
  'inv.act.backToMap': '◀ To Star Map',
  // 서버 원장 거부 사유 구분(SpendOutcome.reason) — 전부 "재화 부족"으로 뭉개지 않는다.
  // 재화를 쓰는 세 화면(격납고 창고 확장 · 정제소 리롤 · 연구소 리스펙)이 공유한다.
  'spend.err.rejectedCredits': 'The server ledger rejected it: need {n} credits, server balance {have}.',
  'spend.err.rejectedMinerals': 'The server ledger rejected it: need {n} minerals, server balance {have}.',
  'spend.err.unavailable': "Couldn't reach the server. Nothing was charged — try again later.",
  // 인벤토리/창고 분류 보기(슬롯 필터 + 정렬 토글).
  'inv.filter.all': 'All',
  'inv.filter.empty': 'No items in this category.',
  'inv.act.sort': 'Sort: {v}',
  'inv.sort.default': 'Newest',
  'inv.sort.rarity': 'Rarity',
  'inv.sort.slot': 'Slot',

  // --- 격납고 카툰 UI (Pixi 리스킨) ---
  'hangar.title': 'Hangar',
  // 격납고 도움말(사용자 요청 2026-08-05). 문단 구분은 홑 개행(`helpModal.ts` 주석 ①).
  'hangar.help': 'Help',
  'hangar.help.title': 'Hangar Guide',
  'hangar.help.s1.h': 'What this screen is for',
  'hangar.help.s1.b':
    'This is where you dress your active ship. Gear equipped here is permanent progress — it survives every run, unlike the powerups you pick up during one.\nThe stat panel shows what your current loadout actually produces, with every source already folded in. That total is the number to compare builds by, not the numbers on individual pieces.',
  'hangar.help.s2.h': 'Gear and the stash',
  'hangar.help.s2.b':
    'Eight slots take gear, and every ship type uses the same eight — farming carries across ship generations rather than restarting with each one.\nGear comes in four grades, normal through unique, and carries random affixes. A piece may also have a required level; you cannot equip it below that. Stage difficulty sets the ceiling on what drops there, so gear you find is gear you can wear while running that stage.',
  'hangar.help.s3.h': 'Changing ships',
  'hangar.help.s3.b':
    'Change Ship stays locked until your current ship reaches level 100. Swapping early would throw away growth the ship has not finished, so the button is gated rather than merely discouraged.\nRetiring at the cap is an endgame move: the retired ship keeps its equipped gear, becomes a guardian, and pays out lineage points. The next ship is a free pick from the whole roster with nothing to unlock.',
  'hangar.help.s4.h': 'Guardians and lineage',
  'hangar.help.s4.b':
    'Guardians are your retired ships. They can stand in your Defense Command core room, and their gear stays locked inside them.\nLineage points accumulate across retirements and buy permanent bonuses that apply to every future ship. The two buttons in the header open those screens.',
  'hangar.help.s5.h': 'Catalysts',
  'hangar.help.s5.b':
    'Catalysts are consumables that season an ordinary run, raising its difficulty and its rewards together. The header button opens the collection where you manage them; you choose which to inject just before launching.\nCatalysts never appear in a commission run — that run already has its stage and rewards written.',
  'hangar.panel.stats': 'Ship Stats',
  'hangar.stat.element.fire': 'Fire',
  'hangar.stat.element.cold': 'Cold',
  'hangar.stat.element.lightning': 'Lightning',
  'hangar.stat.lineage': 'Lineage Boost',
  'hangar.stat.unique': 'Unique Effects',
  // 게이트 도입 전 세이브에 남아 있는 중복 사본(uniqueMask 가 OR 라 효과가 없다) 표기.
  'hangar.stat.uniqueDup': '{name} (duplicate — no effect)',
  'hangar.desc.weapon': 'Your ship’s primary fire pattern.',
  'hangar.desc.damage': 'Multiplier on all outgoing damage.',
  'hangar.desc.fireRate': 'How fast your weapon cycles.',
  'hangar.desc.bullets': 'Extra projectiles per volley.',
  'hangar.desc.pierce': 'Enemies each shot can pass through.',
  'hangar.desc.moveSpeed': 'Ship movement speed multiplier.',
  'hangar.desc.hp': 'Bonus hull points added to base.',
  'hangar.desc.magnet': 'Pickup collection radius.',
  'hangar.desc.xp': 'Experience gained multiplier.',
  'hangar.desc.mineralFind': 'Salvage mineral yield multiplier.',
  'hangar.desc.element.fire': 'Burn damage over time on hit.',
  'hangar.desc.element.cold': 'Slows enemies on hit.',
  'hangar.desc.element.lightning': 'Chains damage to nearby enemies.',
  'hangar.desc.lineage': 'Account-wide boost to your active ship.',
  // 스킬 축 어픽스 툴팁 고지(정본 1 — 설계 ①-10). 그 축에 투자가 0이면 회색으로 값을 보여
  // 주되 왜 무효과인지를 이 문구로 설명한다(값을 숨기지 않는다).
  'hangar.affix.noInvest': '(no investment - inactive)',
  'hangar.act.swapShip': 'Change Ship',
  'hangar.act.guardians': 'Guardians',
  'hangar.act.lineage': 'Lineage',
  // 기체 교체(퇴역·세대 교체)는 현역이 만렙일 때만 열린다 — 잠긴 이유를 화면에 남긴다.
  'hangar.err.swapNeedMaxLevel': 'Change Ship unlocks at max level (Lv {n}). Active ship: Lv {lv}.',

  // --- 기체 타입(M8, ADR-0019) ---
  // 키의 축은 `ShipTypeDef.slug` 다(`src/ui/pixi/shipLabels.ts` 가 유도한다). 하드코딩 목록이
  // 아니라 SHIP_TYPES 파생이므로, 타입이 늘면 `tests/i18n.test.ts` 가 누락을 잡는다.
  // `.signature` 는 **시그니처를 가진 타입만** 둔다. 스트라이커도 ADR-0049 §1(정조준 사이클,
  // 비트 24)로 이제 시그니처를 갖는다 — "시그니처 없는 타입" 이라는 구 §11 채택안 A 는
  // 폐기됐다. 수치는 sim 정본(`src/sim/shipSignature.ts`)에서 그대로 옮겼다. 문구가 없는
  // 효과를 약속하면 UI 가 거짓말을 한다. 컬러 이모지 금지(Pixi stripEmoji 가 두부로 떨군다).
  'ship.striker.name': 'Striker',
  'ship.striker.role': 'Balanced baseline — no chassis bias in any direction.',
  'ship.striker.signature':
    'Marksman Cycle — every 12th volley from your main weapon is a marksman volley: every bullet in it deals +50% damage and gains +1 pierce, then the cycle starts over.',
  'ship.bruiser.name': 'Bruiser',
  'ship.bruiser.role': 'Brawler that walks into fire. Heaviest hull, shortest reach.',
  'ship.bruiser.signature':
    'Armor Stacks — each hit you take adds a stack (up to 8). Every stack cuts incoming damage by 2.5%, so a full stack absorbs 20%. One stack falls off after 3 seconds without being hit.',
  'ship.arccaster.name': 'Arccaster',
  'ship.arccaster.role': 'Siege gunner. Longest range and densest volleys, slowest to reposition.',
  'ship.arccaster.signature':
    'Overcharge — stand still for 1.5 seconds to gain +15% damage, then +15% for each further second, up to +40%. Moving cancels it instantly.',
  'ship.phantom.name': 'Phantom',
  'ship.phantom.role': 'Glass assassin. Highest single-shot damage, thinnest hull.',
  'ship.phantom.signature':
    'Cloak — go 4 seconds without being hit to slip out of enemy targeting. The shot that breaks cloak lands at 2.5x damage.',
  'ship.hatchling.name': 'Hatchling',
  'ship.hatchling.role':
    'Brood carrier. Fastest fire rate and the widest trees, weakest single shot.',
  'ship.hatchling.signature':
    'Hatch — kills fill the nest and a chick drone launches on its own once the count is met. The count starts at 12 kills and rises by 4 every 60 cumulative kills, capped at 40.',
  'ship.mallow.name': 'Mallow',
  'ship.mallow.role': 'Cushioned brawler. Largest percentage hull growth, softest punch.',
  'ship.mallow.signature':
    'Cushion — 35% of every hit is stored as delayed damage instead of landing right away. Go 3 seconds without being hit and 60% of what is stored heals back.',
  'ship.bubble.name': 'Bubble',
  'ship.bubble.role': 'Drifting skirmisher. Fastest shots and widest pickup pull, thinnest film hull.',
  'ship.bubble.signature':
    'Bubble Film — a film that absorbs 60 damage forms every 7 seconds. When it pops it shoves nearby enemies out to a radius of 220.',

  // --- 챔피언 선택(M8) ---
  'champion.title': 'Choose Your Ship',
  // 챔피언 선택 도움말(사용자 요청 2026-08-05). 문단 구분은 홑 개행(`helpModal.ts` 주석 ①).
  'champion.help': 'Help',
  'champion.help.title': 'Ship Selection Guide',
  'champion.help.s1.h': 'What you are choosing',
  'champion.help.s1.b':
    'You are picking the ship you will fly next. The whole roster is open — nothing here needs unlocking.\nThis choice is not cosmetic. A ship type owns its three skill trees, its signature passive, its six active skills, its base stat modifiers, and its look. What stays the same across every type is the eight gear slots, movement, hitbox, and controls.',
  'champion.help.s2.h': 'What carries over and what does not',
  'champion.help.s2.b':
    'Gear carries over. All eight slots are shared across ship types, which is what keeps farming meaningful through generation after generation.\nSkill investment does not. Trees belong to the ship type, so a new ship starts at level 1 with its own trees to fill.\nLineage carries over too, and it never resets — every bonus you bought in the Lineage Hall applies to this ship from its first run.',
  'champion.help.s3.h': 'Switching means retiring',
  'champion.help.s3.b':
    'Taking a new ship retires the current one, which is why the button is locked until it reaches level 100. The retired ship keeps its equipped gear locked inside and becomes a guardian.\nRetirement pays lineage points and the retired ship can stand in your defense base. It is a step forward in the loop rather than a loss, but it is permanent — the ship does not come back to active duty.',
  'champion.help.s4.h': 'Signature passives and stories',
  'champion.help.s4.b':
    'Every type except the baseline one carries a signature passive that is always on and cannot be invested in. It is the clearest single difference between two ships, so read it before you commit.\nEach ship also has a three-chapter story explaining why it has that passive. Chapter one is readable here from the start; the rest unlock through play and collect in the Record Vault.',
  'champion.roster': 'Roster',
  'champion.rosterSub': 'All ships are available — no unlock requirements.',
  'champion.confirm': 'Retire & Switch to {name}',
  'champion.current': 'Current: {name}',
  'champion.signature': 'Signature',
  'champion.signature.none': 'No signature passive — a clean baseline chassis.',
  'champion.chassis': 'Chassis',
  'champion.bp.damage': 'Damage',
  'champion.bp.fireRate': 'Fire rate',
  'champion.bp.maxHp': 'Hull',
  'champion.bp.moveSpeed': 'Speed',
  'champion.chassis.now': 'Current',
  'champion.chassis.pick': 'Selected',
  'champion.role': 'Role',
  'champion.trees': 'Skill trees',
  'champion.tree.meta': '{n} nodes · {g}pt unlocks Tier II actives',
  'champion.retire.title': 'Retire your ship?',
  'champion.retire.body':
    'Your current ship (Lv {level}) becomes a Guardian. Level, skill points and gear slots reset; your equipped gear stays locked to that Guardian and returns to your stash only when you dismiss it. You will pilot a fresh {name}.',
  'champion.retire.yes': 'Retire and switch',
  'champion.retire.no': 'Cancel',
  'champion.retire.warn':
    'Switching retires your current ship. Level and skill investment reset, and equipped gear stays locked to the Guardian it leaves behind.',
  // 만렙 게이트 사유(ADR-0007 + 만렙 게이트). 격납고의 `hangar.err.swapNeedMaxLevel` 과 같은 게이트를
  // 챔피언 선택 화면에서 설명한다 — 반드시 카탈로그에 있어야 한다. `tShipKey` 폴백은 `params` 를
  // 치환하지 않으므로, 키가 없으면 화면에 `{level}` 리터럴이 그대로 노출된다.
  'champion.retire.needMaxLevel': 'Retirement unlocks at max level (Lv {required}). Active ship: Lv {level}.',

  // --- 예비역 수호기 로스터·소멸(ADR-0024 Task #8) ---
  'guardians.title': 'Reserve Guardians',
  // 예비역 로스터 도움말(사용자 요청 2026-08-05). 문단 구분은 홑 개행(`helpModal.ts` 주석 ①).
  'guardians.help': 'Help',
  'guardians.help.title': 'Reserve Guardians Guide',
  'guardians.help.s1.h': 'What a guardian is',
  'guardians.help.s1.b':
    'A guardian is a ship you retired. Retiring is only possible at level 100, and the ship keeps the gear it had equipped — locked inside it rather than returned to your stash.\nGuardians are not idle trophies. They can be deployed to the core room of your defense base, where the lineage guardian branch strengthens all of them at once.',
  'guardians.help.s2.h': 'Dismantling',
  'guardians.help.s2.b':
    'Dismantling breaks a guardian down. You get lineage points back and the gear locked inside returns to your stash.\nThe points returned scale with what the ship was worth — its combat score at retirement, which folds in gear grade, affix value, and skill build. A stronger retirement returns more.\nThis never happens on its own. A guardian sits in your roster indefinitely until you choose to dismantle it, and the choice cannot be undone.',
  'guardians.help.s3.h': 'Deployed guardians wear differently',
  'guardians.help.s3.b':
    'Neglect only touches defense units you have actually deployed, guardians included. Anything sitting in this roster keeps its condition.\nGuardians are the one exception to repair — a deployed guardian\'s condition cannot be restored once it has worn, so treat deployment as a decision with a cost rather than a free placement.',
  'guardians.help.s4.h': 'How this fits the loop',
  'guardians.help.s4.b':
    'Retire, dismantle, invest. Retirement pays lineage points up front, dismantling recovers more from ships you no longer need, and the Lineage Hall next door is where those points buy permanent bonuses for every future ship.\nBecause dismantling also frees the gear locked inside, an old guardian is worth revisiting once the equipment inside it starts to look useful again.',
  'guardians.empty': 'No guardians yet. Retire a ship to leave one in reserve.',
  'guardians.perf': 'Performance {pct}%',
  'guardians.gear': 'Locked gear {n}',
  'guardians.recover': 'Recover {points} pts',
  'guardians.dismiss': 'Dismiss',
  'guardians.dismiss.title': 'Dismiss Guardian?',
  'guardians.dismiss.confirm':
    'Dismiss this {name}? Its {gear} locked item(s) return to your stash and you recover {points} lineage points. This cannot be undone.',
  'guardians.cancel': 'Cancel',
  'guardians.dismissed': '{n} gear returned to stash · {points} points recovered',
  // 상세 패널(2026-08-02 AAA 시네마틱 전환) — 소멸이 무엇을 되돌려주는지 먼저 말한다.
  'guardians.lineage.title': 'Lineage Points',
  'guardians.lineage.use': 'Recovered by dismissing guardians · spent on lineage upgrades.',
  'guardians.detail.title': 'Selected Guardian',
  'guardians.detail.empty': 'Pick a guardian from the list to see what dismissing it returns.',
  'guardians.detail.perf': 'Performance left',
  'guardians.detail.score': 'Combat score',
  'guardians.detail.gear': 'Locked gear',
  'guardians.detail.recover': 'On dismissal',
  'guardians.detail.gearTitle': 'Gear returned to your stash',
  'guardians.detail.gearNone': 'No locked gear.',
  'guardians.detail.warn':
    'Dismissal cannot be undone. The guardian is gone for good and can never defend your base again.',

  // --- 계보 전당(ADR-0007) — 계보 포인트를 쓰는 유일한 플레이어 표면 ---
  // 곡선·비용·마일스톤 레벨은 전부 `data/lineage.ts` 정본에서 유도한다(문구에 수치를 박지 마라).
  'lineage.title': 'Lineage',
  // 계보 전당 도움말(사용자 요청 2026-08-05). 문단 구분은 홑 개행(`helpModal.ts` 주석 ①).
  'lineage.help': 'Help',
  'lineage.help.title': 'Lineage Hall Guide',
  'lineage.help.s1.h': 'What this screen is for',
  'lineage.help.s1.b':
    'Lineage is a permanent tree that belongs to your account rather than to any one ship. Everything invested here keeps paying out across every ship generation that follows.\nIt is the only place lineage points can be spent. Points come from retiring a ship and from dismantling guardians.',
  'lineage.help.s2.h': 'The two branches',
  'lineage.help.s2.b':
    'The ship branch strengthens the ship you are currently flying, applied when your loadout is assembled.\nThe guardian branch strengthens every guardian you own at once, which is what stands in your defense base.\nBoth accept unlimited investment, but the return follows a logarithmic curve and converges toward a ceiling. The bar on each branch shows what you have now, with the next level\'s gain overlaid as a ghost segment so you can see what this particular spend buys.',
  'lineage.help.s3.h': 'Investment cannot be undone',
  'lineage.help.s3.b':
    'There is no respec here. Unlike the skill tree in the Research Lab, a point spent on a branch stays on that branch permanently.\nThat is why every investment asks for confirmation. It is not a formality — read the branch and the amount before you confirm.',
  'lineage.help.s4.h': 'Milestones',
  'lineage.help.s4.b':
    'The guardian branch has three milestones that unlock purely by reaching a level, with nothing extra to buy. They add qualitative abilities rather than more of the same number, so the smooth bonus curve does not tell you they are coming.\nThe panel lists what is unlocked and what the next one needs, which is often half the reason to keep investing in that branch.',
  'lineage.branches.title': 'Lineage Branches',
  'lineage.branch.ship': 'Ship Branch',
  'lineage.branch.ship.desc':
    'Strengthens the ship you fly now, and every ship of every generation after it.',
  'lineage.branch.guardian': 'Guardian Branch',
  'lineage.branch.guardian.desc':
    'Strengthens every guardian defending your base — the ones in reserve now and all future ones.',
  'lineage.level': 'Invested level {lv}',
  'lineage.next': 'Next level: +{pct}% (+{delta}%p)',
  'lineage.cost': '{cost} pts',
  'lineage.cap': 'Cap +{pct}%',
  'lineage.invest': 'Invest',
  'lineage.short': '{need} pts short',
  'lineage.sunk': '{pt} pts already sunk into this branch — no respec.',
  // 서버 권위(ADR-0007): 계보 조작은 서버가 확정한다. 오프라인이면 잠근다 — 되돌릴 수 없는
  // 지출이라 낙관적 진행이 불가능하다.
  'lineage.offline': 'Offline — lineage needs the server',
  'lineage.busy': 'Confirming with the server…',
  'lineage.failed': 'The server did not confirm it. Nothing was spent.',
  'lineage.invested': '{name} reached level {lv} · {cost} pts spent',
  'lineage.points.title': 'Lineage Points',
  'lineage.points.use': 'Earned by retiring ships and dismissing guardians.',
  'lineage.points.warn':
    'Investment cannot be undone. There is no respec — points spent on a branch stay there forever.',
  'lineage.confirm.title': 'Invest in the lineage?',
  'lineage.confirm.body':
    'Raise the {name} to level {lv} for {cost} points? Its bonus becomes +{pct}% and you are left with {left} points. There is no respec — this cannot be undone.',
  'lineage.confirm.yes': 'Invest',
  'lineage.cancel': 'Cancel',
  // 마일스톤 — 수호 가지 레벨 도달 시 자동 해금(별도 투자 없음).
  'lineage.ms.title': 'Guardian Milestones',
  'lineage.ms.req': 'Level {lv}',
  'lineage.ms.remain': 'Level {lv} · {n} to go',
  'lineage.ms.unlocked': 'Unlocked',
  'lineage.ms.reboot': 'Combat Reboot',
  'lineage.ms.reboot.desc': 'A downed guardian revives once per defense battle.',
  'lineage.ms.coreGuard': 'Core Guard',
  'lineage.ms.coreGuard.desc': 'Guardians hit harder and faster while near the core.',
  'lineage.ms.shieldShare': 'Shield Share',
  'lineage.ms.shieldShare.desc':
    'The core and turrets start each defense with a shield scaled to guardian power.',

  // --- 서사(스토리) — 사연·인트로·기록 파편 (ADR-0023) ---
  // 키는 `data/lore` 정본 파생이다(`src/ui/pixi/loreLabels.ts` 가 유도). 사연 캐스트는 혼합 —
  // 일부 기체는 전속 파일럿 인물이, 유기체형(해츨링·말로우·버블)은 기체 자신이 인격체다. 각
  // 사연의 핵심은 시그니처 패시브의 "왜 이 능력인가"를 푸는 것이다. 컬러 이모지 금지(Pixi 두부).

  // 인트로 슬라이드(첫 실행 1회, 스킵/다시보기 가능)
  'intro.collapse.title': 'The Oscar Collapse',
  'intro.collapse.body':
    'An age ago, the Oscar civilization recorded everything it ever built — and then fell silent in a single day. Its cities are dust now. Its blueprints are not.',
  'intro.records.title': 'Records Are the Only Currency',
  'intro.records.body':
    'In the ruins, one thing still holds value: a record. A sealed design, a scrap of lost knowledge. Whoever gathers the most rises highest on the Archive ledger.',
  'intro.archives.title': 'Six Sealed Worlds',
  'intro.archives.body':
    'Oscar locked its knowledge inside six archive planets, each guarded by systems that never powered down. Pilots swarm them — and raid one another for records, copying the vaults without ever taking the original.',
  'intro.launch.title': 'Your Turn to Launch',
  'intro.launch.body':
    'You have a ship, an empty logbook, and a name no one has heard yet. The ledger is open. Go make it remember you.',
  'intro.skip': 'Skip',
  'intro.next': 'Next',
  'intro.begin': 'Begin',

  // 기록 보관소(기지 시설) 화면 크롬
  'archive.title': 'Record Vault',
  'archive.subtitle': 'The stories and secrets you have uncovered.',
  'archive.tab.stories': 'Pilot Files',
  'archive.tab.shards': 'Record Shards',
  'archive.list.head': 'Index',
  'archive.detail.head': 'Reading',
  'archive.detail.empty': 'Select an entry from the list on the left.',
  'archive.stories.progress': 'Chapters unlocked: {n} / {total}',
  'archive.story.progress': '{n} / {total} chapters unlocked',
  'archive.shards.progress': '{n} / {total} shards recovered',
  'archive.shards.locked': 'Not yet recovered. Stabilize an Echo Signal to find one.',
  'archive.story.locked': 'Locked',
  'archive.story.chapter': 'Chapter {n}',
  'archive.intro.replay': 'Replay Prologue',
  'archive.empty': 'Nothing here yet.',

  // 기록 보관소 도움말(사용자 요청 2026-08-05). 문단 구분은 홑 개행(`helpModal.ts` 주석 ①).
  'archive.help': 'Help',
  'archive.help.title': 'Record Vault Guide',
  'archive.help.s1.h': 'What this screen is for',
  'archive.help.s1.b':
    'Everything you have uncovered about this galaxy collects here, and it is purely for reading. Nothing on this screen changes a single number in a run — no stats, no rewards, no unlocks that affect combat.\nThe two tabs hold two different kinds of record: pilot files and record shards.',
  'archive.help.s2.h': 'Pilot files',
  'archive.help.s2.b':
    'Each ship type carries a three-chapter personal story. Chapter one is open from the start. Chapter two unlocks when you clear that ship\'s bonded planet, and chapter three when you finish its signature milestone.\nThe stories exist to explain why a ship has the signature passive it has. Some ships have a named pilot; the organic ones are themselves the character.',
  'archive.help.s3.h': 'Record shards',
  'archive.help.s3.b':
    'Shards are fragments of the lost Oscar civilization, recovered by stabilizing Echo Signals — a narrative kind of encounter that appears rarely during runs.\nEncounters are opt-in. Ignoring one costs you nothing and the run continues safely; entering one carries real risk, including death. A shard you have not recovered shows as locked rather than hidden, so you can see what is still out there.',
  'archive.help.s4.h': 'Where the entries come from',
  'archive.help.s4.b':
    'Nothing here is bought and nothing here is farmed directly. Records arrive as a side effect of playing — clearing planets, finishing milestones, and taking the encounters you choose to take.\nThe prologue can be replayed from this screen at any time.',

  // 챔피언 선택 화면 — 사연 열람 버튼/팝업
  'champion.story.open': 'Read Pilot File',
  'champion.story.title': '{name} — Pilot File',

  // 출격 기체 선택(예비역 소집, ADR-0024) — 관제탑 침공 시작 팝업
  'sortie.title': 'Choose Sortie Ship',
  'sortie.sub': 'Launch with your active ship, or call up a retired guardian to fly in its place.',
  'sortie.active': 'Active ship · full performance',
  'sortie.guardian': 'Reserve',
  'sortie.perf': 'Performance {n}%',
  'sortie.gear': 'Locked gear {n}',
  'sortie.launch': 'Sortie',

  // 사연 — 스트라이커(무명 신출내기, 성장)
  'story.striker.tagline': 'The pilot with an empty logbook.',
  'story.striker.ch1.title': 'No Record to Speak Of',
  'story.striker.ch1.body':
    'You come from a world that recorded nothing — a people who left no blueprint, no monument, not even a name the Archive bothered to file. The Striker is a plain chassis with no signature trick to its name. That is the point: your story has not been written yet.',
  'story.striker.ch2.title': 'First Entry',
  'story.striker.ch2.body':
    'The molten vaults of Kargon do not care where you came from. You cleared them anyway, and for the first time the ledger holds a line with your call sign on it. It is a small line. It is still yours.',
  'story.striker.ch3.title': 'Someone Worth Filing',
  'story.striker.ch3.body':
    'A dozen victories in, other pilots have started spelling your name right. The Archive that ignored your entire civilization now keeps a folder on you. It turns out the way to be remembered was never to inherit a record — it was to make one.',
  'story.striker.quest.ch2': 'Clear Kargon, your first proving ground, at least once.',
  'story.striker.quest.ch3': 'Win enough runs to make the ledger spell your name right.',

  // 사연 — 브루저(호위함 노병, 감동)
  'story.bruiser.tagline': 'He carries their names into every fight.',
  'story.bruiser.ch1.title': 'The Names on the Plating',
  'story.bruiser.ch1.body':
    'Bruiser escorted supply convoys for thirty years and lost one. He never speaks of the ships he saved, only the one he did not. Every armor plate on his hull is engraved with a name from that lost convoy.',
  'story.bruiser.ch2.title': 'Kras Remembers Weight',
  'story.bruiser.ch2.body':
    'Kras is a world of siege and rubble, and it hits back hard. Bruiser walked into it on purpose — the heavier the blow, the more names he gets to remember. He came out slower, dented, and still standing.',
  'story.bruiser.ch3.title': 'Every Plate Full',
  'story.bruiser.ch3.body':
    'Take enough fire and the whole hull is covered — no bare plating left, every name accounted for. The Armor Stacks are not a defensive trick. They are a roll call, read aloud, one hit at a time.',
  'story.bruiser.quest.ch2': 'Clear Kras, the siege world, at least once.',
  'story.bruiser.quest.ch3': 'Take enough hits to engrave every last name onto your plating.',

  // 사연 — 아크 캐스터(광선 조각가, 재미)
  'story.arccaster.tagline': 'Shooting on the move is just doodling.',
  'story.arccaster.ch1.title': 'The Beam Sculptor',
  'story.arccaster.ch1.body':
    'Arccaster insists that firing while moving is scribbling, and that real art happens only when the feet are planted. Critics call this pretentious. Arccaster calls the critics people who move too much.',
  'story.arccaster.ch2.title': 'The Masterpiece Vault',
  'story.arccaster.ch2.body':
    'Arke is the Oscar capital archive, where the finest sealed designs are kept — and Arccaster has wanted a look for a very long time. Standing perfectly still under fire, it carved a path straight to the vault. Beautiful, apparently.',
  'story.arccaster.ch3.title': 'Overcharged Perfection',
  'story.arccaster.ch3.body':
    'Hold still long enough and the beam stops being a weapon and becomes a signature. Overcharge is not patience; it is a refusal to smudge the work. Hundreds of finished pieces later, even the skeptics have gone quiet.',
  'story.arccaster.quest.ch2': 'Clear Arke, the capital archive, at least once.',
  'story.arccaster.quest.ch3': 'Finish enough kills mid-Overcharge to earn the title of artist.',

  // 사연 — 팬텀(지워진 자, 미스터리)
  'story.phantom.tagline': 'The pilot the Archive forgot to keep.',
  'story.phantom.ch1.title': 'File Not Found',
  'story.phantom.ch1.body':
    'When Oscar fell, one record was deleted — not damaged, deleted, cleanly, as though someone meant it. Phantom is what remains when a whole existence goes unfiled. No one recalls the face beneath the cloak, and on most nights, neither does Phantom.',
  'story.phantom.ch2.title': 'The Cold Trail',
  'story.phantom.ch2.body':
    'Niflheim is a frozen world of ghost ships and dead signals, the last place the record of Phantom was seen intact. Cloaked and silent, it slipped past every guardian to reach the vault. The file it wanted was gone. Something worse remained: a note that the deletion had been requested.',
  'story.phantom.ch3.title': 'The Strike That Remembers',
  'story.phantom.ch3.body':
    'The Cloak works because there is nothing to target — you cannot lock onto a person who was erased. But the shot that ends the cloak lands like the universe suddenly recalls that you exist. Again and again, someone learns the name of Phantom a half-second before it matters.',
  'story.phantom.quest.ch2': 'Clear Niflheim, where your record was last seen, at least once.',
  'story.phantom.quest.ch3': 'Land enough cloak-breaking strikes to be remembered, if only for a moment.',

  // 사연 — 해츨링(어미 생체함선, 감동)
  'story.hatchling.tagline': 'She is looking for the way home.',
  'story.hatchling.ch1.title': 'The Last Nursery',
  'story.hatchling.ch1.body':
    'Hatchling is a living ship, the only one to leave her nursery world before it went dark. Her brood rides inside her hull, too young to remember the sky they were born under. She keeps flying so that one day she can show them.',
  'story.hatchling.ch2.title': 'The Green Coordinates',
  'story.hatchling.ch2.body':
    'Berdan is a restless world, its archive guarded and its skies thick with defenders. Buried inside is a star chart — a map of nurseries, one of which might be home. Hatchling tore through to reach it. The coordinates were only partial. It is more than she had the day before.',
  'story.hatchling.ch3.title': 'A Brood That Flies',
  'story.hatchling.ch3.body':
    'Every kill fills the nest a little more, and when it is full a chick launches on its own — old enough now to fight beside her instead of hiding within. Hundreds of launches on, the little ones lead as often as they follow. Wherever home turns out to be, they will arrive together.',
  'story.hatchling.quest.ch2': 'Clear Berdan, where the star chart is sealed, at least once.',
  'story.hatchling.quest.ch3': 'Launch enough of your brood to raise a flight that flies on its own.',

  // 사연 — 말로우(먹보 생체함선, 재미)
  'story.mallow.tagline': 'It turns a punch into pudding.',
  'story.mallow.ch1.title': 'The Sweet Tooth',
  'story.mallow.ch1.body':
    'Mallow is a soft, round living ship with a talent that baffles every engineer who studies it: it takes a hit, holds it, and somehow gives back sugar. No one knows how. Mallow will not explain — its mouth is full.',
  'story.mallow.ch2.title': 'The Sealed Recipe',
  'story.mallow.ch2.body':
    'Toxar is a world of corrosion and rot, a strange place to hunt for dessert. But Oscar sealed its greatest recipe there, and Mallow could smell it through the decay. It ate a path to the vault. Worth it.',
  'story.mallow.ch3.title': 'Sweet by the Thousand',
  'story.mallow.ch3.body':
    'Every blow Mallow cushions is stored, then softened, then handed back as healing — pain in, sweetness out. Tens of thousands of points of hurt digested so far. It turns out the best dessert was never in the vault; it was the trick of making anything taste good.',
  'story.mallow.quest.ch2': 'Clear Toxar, where the recipe is sealed, at least once.',
  'story.mallow.quest.ch3': 'Cushion and recover enough damage to perfect the sweetest recipe.',

  // 사연 — 버블(겁쟁이 비눗방울, 귀여움+감동)
  'story.bubble.tagline': 'It was so afraid to pop.',
  'story.bubble.ch1.title': 'Afraid of the Pop',
  'story.bubble.ch1.body':
    'Bubble is exactly what it sounds like: a small, drifting film of a ship, terrified of the one thing that bubbles do. For a long time it hung at the back of every fight, holding its breath, hoping not to burst.',
  'story.bubble.ch2.title': 'Kargon Taught It to Burst',
  'story.bubble.ch2.body':
    'The fire of Kargon allows little hiding, and one day Bubble popped — and the shockwave shoved an enemy clear off a friend who was about to be hit. Bubble stared at the space where the danger had been. Oh. So that is what popping is for.',
  'story.bubble.ch3.title': 'Three Hundred Bursts',
  'story.bubble.ch3.body':
    'Now Bubble reforms its film every few seconds and pops it on purpose, hurling danger away from whoever stands behind it. Hundreds of bursts later, it is not afraid anymore. A bubble that bursts to protect someone does not vanish — it did exactly what it was for.',
  'story.bubble.quest.ch2': 'Clear Kargon, where you first learned to burst, at least once.',
  'story.bubble.quest.ch3': 'Burst your film enough times to stop being afraid of it.',

  // 기록 파편 도감(에코 신호로 수집 — 오스카 문명 붕괴의 전말)
  'shard.first-archive.title': 'Fragment: The First Archive',
  'shard.first-archive.body':
    'The very first record of Oscar was not a weapon or a city. It was a promise: "Nothing we make will ever be truly lost." They kept that promise. They did not keep themselves.',
  'shard.the-curators.title': 'Fragment: The Curators',
  'shard.the-curators.body':
    'The archive planets were tended by the Curators — automated keepers built to guard the records forever. Forever ran longer than anyone designed for. The Curators are still on duty, and have forgotten they were ever meant to let anyone in.',
  'shard.overflow.title': 'Fragment: Overflow',
  'shard.overflow.body':
    'The late records grow frantic: too much to store, too little time. Oscar had begun archiving things that should never be kept — including, one fragment hints, the design of whatever ended them.',
  'shard.the-silence.title': 'Fragment: The Silence',
  'shard.the-silence.body':
    'There was no war, no plague, no impact. One day the transmissions simply stopped, mid-sentence, across every world at once. The Archive logged the silence as an event to be recorded. Then it, too, went quiet — for a while.',
  'shard.copy-of-a-copy.title': 'Fragment: Copy of a Copy',
  'shard.copy-of-a-copy.body':
    'A record can be copied without end and the original takes no harm. This is why pilots raid without destroying, and why the ledger never forgets. Oscar meant it as mercy. It became a game.',
  'shard.the-last-curator.title': 'Fragment: The Last Curator',
  'shard.the-last-curator.body':
    'One Curator, deep within Arke, still speaks. It insists the civilization never fell — that everyone simply stepped into the records to wait out the danger, and will return once it is safe. It has been saying this for a very long time.',
  'shard.echoes.title': 'Fragment: Echoes',
  'shard.echoes.body':
    'Now and then a run flickers with a signal that should not be there — a stray record still trying to finish sending, long after the sender is gone. Hold steady beside one and it stabilizes, handing you a shard of what it meant to say.',
  'shard.your-name-here.title': 'Fragment: Your Name Here',
  'shard.your-name-here.body':
    'The final shard is blank. Not lost — blank, waiting. The Archive leaves one entry open on every ledger it keeps. It seems to believe your story is still being filed.',

  // 에코 신호 보상 — 안정화 로어 토스트 · 파편 획득 알림 (Phase E, ADR-0023)
  'echo.stabilized.toast': 'Echo Signal stabilized — a lost record finishes sending.',
  'shard.gained': 'New record shard recovered.',

  // 도감 코스메틱 — 사연 챕터 해금 배지(챕터 2)·칭호(챕터 3). id = `<slug>-ch<번호>` (Phase E)
  'cosmetic.striker-ch2.name': 'First Entry',
  'cosmetic.striker-ch3.name': 'The Self-Made Record',
  'cosmetic.bruiser-ch2.name': 'Weight of Kras',
  'cosmetic.bruiser-ch3.name': 'Bearer of Names',
  'cosmetic.arccaster-ch2.name': 'The Masterpiece Vault',
  'cosmetic.arccaster-ch3.name': 'The Beam Sculptor',
  'cosmetic.phantom-ch2.name': 'The Cold Trail',
  'cosmetic.phantom-ch3.name': 'The Strike That Remembers',
  'cosmetic.hatchling-ch2.name': 'The Green Coordinates',
  'cosmetic.hatchling-ch3.name': 'Mother of a Brood',
  'cosmetic.mallow-ch2.name': 'The Sealed Recipe',
  'cosmetic.mallow-ch3.name': 'Sweet by the Thousand',
  'cosmetic.bubble-ch2.name': 'First Burst',
  'cosmetic.bubble-ch3.name': 'The Fearless Film',

  // --- 정제소 ---
  'refine.title': 'Refinery',
  'refine.bar.minerals': 'Minerals',
  'refine.bar.credits': 'Credits',
  'refine.listHeader': 'Owned Gear ({n})',
  'refine.noItems': 'No gear with affixes.\nAcquire gear on planets.',
  'refine.processTitle': 'Refining Process',
  'refine.selectPrompt': 'Select gear on the left.',
  'refine.cost.normal': 'Reroll cost: {n} minerals',
  'refine.lock.alt.locked': 'Locked',
  'refine.lock.alt.unlocked': 'Unlocked',
  'refine.spinning': '⟳ Refining…',
  'refine.rollBtn': '🎰 Reroll',
  'refine.err.noMinerals': 'Not enough minerals (need {n}).',
  // 정련 공정(ADR-0040) — 노 출력·고착·용해
  'refine.chain.heat.low': 'Low heat',
  'refine.chain.heat.mid': 'Medium heat',
  'refine.chain.heat.high': 'High heat',
  'refine.chain.heat.hint': 'Higher heat rolls better values, but costs more and raises melt risk',
  'refine.chain.risk': 'Melt risk {n}%',
  'refine.chain.riskNone': 'No melt risk',
  'refine.chain.fasten': 'Fasten',
  'refine.chain.fastenHint': 'After a roll you may fasten one affix (cannot be undone)',
  'refine.chain.fastenedCount': 'Fastened {n}/{total}',
  'refine.chain.stop': 'Stop refining',
  'refine.chain.rollBtn': 'Roll',
  'refine.chain.cost': 'Roll cost: {n} minerals',
  'refine.chain.melted': 'Melted — all fastened affixes released',
  'refine.chain.complete': 'Refining complete — every affix fastened',
  'refine.chain.noBand': 'This affix has a fixed value; heat does not affect it',
  'refine.sort.recent': 'Recent',
  'refine.sort.rarity': 'Rarity',

  // 정제소 도움말(사용자 요청 2026-08-05). 문단 구분은 홑 개행(`helpModal.ts` 모듈 주석 ①).
  'refine.help': 'Help',
  'refine.help.title': 'Refinery Guide',
  'refine.help.s1.h': 'What this screen is for',
  'refine.help.s1.b':
    'This is where you reroll the affixes on gear you already own. The gear itself — its slot, its grade, its base stats — never changes here. Only the affixes move.\nPick an item on the left and the refining process opens on the right.',
  'refine.help.s2.h': 'Rolling',
  'refine.help.s2.b':
    'Each roll costs minerals and redraws every affix that is not yet fastened. Rolling is not a single purchase but a session: you keep rolling until you are happy, then stop.\nNothing is committed to the item until you press Stop refining.',
  'refine.help.s3.h': 'Fastening',
  'refine.help.s3.b':
    'After a roll you may fasten one affix you like. A fastened affix is removed from the redraw pool, so the next roll only touches what is left.\nFastening cannot be undone within the process, and fastened affixes only become permanent once you stop and commit. Accumulated fastens are your stake — the more you have riding, the more a failure costs you.',
  'refine.help.s4.h': 'Heat',
  'refine.help.s4.b':
    'Every roll is made at one of three heats: low, medium, or high. Heat moves three things together — the quality of the affix values, the mineral cost, and the melt risk.\nHeat is a dial, not a safety switch. Low heat is not zero risk; it is a smaller multiplier on the risk your fastens have already created. Affixes with a fixed value ignore heat entirely, and the row tells you when that is the case.',
  'refine.help.s5.h': 'Melting',
  'refine.help.s5.b':
    'A failed roll melts. Melting releases every fastened affix and returns the process to where it stood before you began — but the item is untouched. Its grade, its affix count, and its existence are never at risk. What melts is your progress, not your gear.\nThe exact failure chance is shown as a number before you commit to a roll, so a melt is always a risk you accepted rather than one you were surprised by.',
  'refine.sort.slot': 'Slot',
  'refine.sort.affixes': 'Affixes',
  // 레인 2(정제소 스킬 어픽스 배선)가 쓰는 키 — 카탈로그는 이 레인이 관리한다.
  'refine.skillAffix.locked': 'Fastened - cannot refine',
  'refine.fastenCounter': 'Fastened {n} / {d}',
  'refine.offSlotWarn': 'This affix will not roll again in this slot - fasten it to keep it',

  // --- 관제탑 ---
  'ctl.title': 'Control Tower',
  'ctl.sub': 'Scout and invade higher-ranked pilots.',
  'ctl.verifying': 'Verifying on server… (confirming the result by full re-simulation)',
  'ctl.note':
    'The retry cooldown (1 hour), rank swaps, and clone raids are enforced by the server. Values here mirror the server verdict.',
  'ctl.anonymous': 'Unknown Pilot',
  'ctl.noBase': 'No defense base',
  'ctl.maintenance': 'Maintenance {m}%',
  'ctl.ship.unknown': 'Unknown Ship',
  'ctl.ship.withLevel': '{name} · Lv {level}',
  'ctl.cooldown.min': 'Retry in {n}m',
  'ctl.cooldown.h': 'Retry in {h}h',
  'ctl.cooldown.hm': 'Retry in {h}h {m}m',
  'ctl.res.provWin': 'core destroyed (provisional win)',
  'ctl.res.provLose': 'invasion failed (provisional)',
  'ctl.res.unsubmitted': '{who}Invasion ended · {outcome} — server not configured/offline, unsubmitted (provisional)',
  'ctl.res.rejected': '{who}Invasion rejected — replay verification mismatch (server authority)',
  'ctl.res.pending': '{who}Confirming the verdict — check the Control Tower shortly',
  'ctl.res.winHead': 'Invasion success — core destroyed',
  'ctl.res.revengeHead': 'Revenge success — seat reclaimed',
  'ctl.res.rank': ' · new rank #{n}',
  'ctl.res.loot': ' · loot {n}',
  'ctl.res.bonus': ' · bonus minerals {n}',
  'ctl.res.winLine': '{who}{head}(server-confirmed){extra}',
  'ctl.res.lose': '{who}Invasion failed — defense held (server-confirmed)',
  'ctl.incoming.banner': 'New invasion results: {n} — your base was attacked',
  'ctl.incoming.fell': 'base fell',
  'ctl.incoming.held': 'defense held',
  'ctl.incoming.revengePrefix': '[Revenge] ',
  'ctl.incoming.taunt': ' · taunt: {taunt}',
  'ctl.tgt.head': 'Suggested Invasion Targets',
  'ctl.tgt.placementHead': 'Placement Opponents (NPC seed bases)',
  'ctl.tgt.loading': 'Loading targets…',
  'ctl.tgt.completingMsg':
    'You finished all 5 placement matches. Confirm your initial rank with the Rank Entry button above.',
  'ctl.tgt.placementNull': 'Could not load placement opponents — server not configured or offline. (Local play works fine.)',
  'ctl.tgt.normalNull': 'Server not configured or offline — invasion is disabled. (Local play works fine.)',
  'ctl.tgt.placementEmpty': 'No placement opponents. Try again shortly.',
  'ctl.tgt.normalEmpty': 'No invasion targets to suggest. Finish placement to get a rank.',
  'ctl.tgt.difficulty': 'Difficulty {band} · {ship}',
  'ctl.tgt.btnPlacement': 'Placement',
  'ctl.tgt.btnInvade': 'Invade',
  'ctl.tgt.tail': 'Climb the ladder and stronger opponents will be suggested here.',
  'ctl.tgt.titlePlacement': 'Start placement run',
  'ctl.tgt.titleInvade': 'Start invasion run',
  'ctl.place.entered':
    'Rank entry! Placed at #{rank} by your placement record ({won} wins). You can now invade higher-ranked pilots.',
  'ctl.place.completeLine': 'Placement done — {total} matches, {won} wins. Ready for rank entry.',
  'ctl.place.applying': 'Confirming rank…',
  'ctl.place.enter': 'Rank Entry',
  'ctl.place.remaining': ' · {n} placement matches left',
  'ctl.place.hint':
    'First PvP gate — play 5 matches against NPC seed bases and your initial rank is set by your record (existing ranks unchanged).',
  'ctl.notif.head': 'Recent Invasion Results',
  'ctl.notif.myTaunt': ' · my taunt: {taunt}',
  'ctl.notif.tauntBtn': 'Taunt',
  'ctl.notif.tauntTitle': 'Leave a taunt sticker for the pilot you repelled.',
  'ctl.rev.head': 'Revenge — strike back within 24 hours (cooldown ignored)',
  'ctl.rev.badge': 'cooldown ignored',
  'ctl.rev.expired': 'Revenge window expired',
  'ctl.rev.btnExpired': 'Expired',
  'ctl.rev.btnNoBase': 'No base',
  'ctl.rev.btnRevenge': 'Revenge',
  'ctl.rev.none': 'No revenge windows open. If your base falls, you can strike back within 24 hours.',
  'ctl.rev.tail': 'When your base falls, the pilot who took it lands here for 24 hours.',
  'ctl.ops.head': 'Operations',
  'ctl.ops.rankHead': 'Your Standing',
  'ctl.recon.head': 'Base Recon',
  'ctl.recon.slice.wave': 'L1 Airspace · Waves',
  'ctl.recon.slice.socket': 'L2 Corridor · Facilities',
  'ctl.recon.slice.boss': 'L3 Core Room · Boss',
  'ctl.recon.slice.prop': 'L3 Core Room · Props',
  'ctl.recon.slice.guardian': 'L3 Core Room · Guardians',
  'ctl.recon.selectPrompt': 'Select a target to preview its defense layout.',
  'ctl.recon.noBase': 'This target has no defense base.',
  // 3레이어 정찰 요약(M7a 임시 — 정식 정찰 화면은 M7b-command-ui).
  'ctl.recon.summary3': 'Waves {f}/{fm} · Facilities {s}/{sm} · Props {p}/{pm} · Boss {b}',
  'ctl.ladder.head': 'Ladder',
  'ctl.ladder.loading': 'Loading…',
  'ctl.ladder.null': 'Server not configured — cannot show the ladder.',
  'ctl.ladder.empty': 'No ranks yet.',
  'ctl.ladder.rank': 'Rank',
  'ctl.ladder.name': 'Name',

  // 관제탑 도움말(사용자 요청 2026-08-05). 문단 구분은 홑 개행(`helpModal.ts` 모듈 주석 ①).
  'ctl.help': 'Help',
  'ctl.help.title': 'Control Tower Guide',
  'ctl.help.s1.h': 'What this screen is for',
  'ctl.help.s1.b':
    'This is the attacking half of PvP. You scout other pilots\' bases here and launch invasions against them. The defending half — arranging what meets them at your own base — lives in Defense Command.\nEverything on this screen needs a server connection. Offline, the lists stay empty while the rest of the game plays normally.',
  'ctl.help.s2.h': 'The ladder',
  'ctl.help.s2.b':
    'The ladder is one permanent queue of every pilot. There is no season reset, so a rank you take is a rank you keep until someone takes it from you.\nOnly three things move a rank: a successful invasion swaps the two pilots, placement inserts a newcomer, and inactivity sinks you slowly.',
  'ctl.help.s3.h': 'Placement',
  'ctl.help.s3.b':
    'Your first five invasions after PvP opens are placement matches, fought against NPC seed bases rather than real pilots. Your record across them decides where you enter the ladder.\nPlacement inserts you without moving anyone else, so nobody loses a rank to your arrival.',
  'ctl.help.s4.h': 'Scouting before you commit',
  'ctl.help.s4.b':
    'Selecting a target shows its defense layout in the recon panel: how many wave slots, facilities, and props are filled across the three layers, and what boss sits in the core room.\nWhat you see first is silhouettes, grades, and ascension stars — not exact numbers. Precise stats and defense-unit affixes are revealed only after you have invaded that base once, which makes a losing first attempt worth something.',
  'ctl.help.s5.h': 'Revenge',
  'ctl.help.s5.b':
    'When your base falls, the pilot who took your rank appears in the revenge list for 24 hours. A revenge strike ignores the normal retry cooldown, and winning reclaims your seat and pays bonus minerals.\nThe window expires on its own. Nothing is lost by letting it pass except the free swing.',
  'ctl.help.s6.h': 'Results are decided by the server',
  'ctl.help.s6.b':
    'Your client shows a provisional outcome the moment a run ends, but the verdict is not final until the server re-simulates your replay in full and agrees. That is why a result can read "confirming" for a short while.\nIncoming attacks on your own base land in the notifications list, where you can watch the replay or leave a taunt sticker for a pilot you repelled.',
  'ctl.ladder.record': 'Record',
  'ctl.ladder.wl': '{w}W {l}L',
  // 관제탑 팝업(순위표 · 알림 · 전투 기록)
  'ctl.btn.ladder': 'Ladder',
  'ctl.btn.history': 'Battle Log',
  'ctl.btn.alerts': 'Alerts {n}',
  'ctl.pop.close': 'Close',
  'ctl.pop.search': 'Search by name',
  'ctl.pop.noMatch': 'Nothing matches that search.',
  'ctl.pop.page': 'Page {cur} / {total}',
  'ctl.pop.prev': 'Prev',
  'ctl.pop.next': 'Next',
  'ctl.pop.loading': 'Loading…',
  'ctl.ladder.title': 'Ladder',
  'ctl.ladder.me': 'You',
  'ctl.ladder.meRank': 'Your rank #{n} · {w}W {l}L · win rate {p}%',
  'ctl.ladder.meUnranked': 'No rank yet — finish placement to enter the ladder.',
  'ctl.ladder.winRate': 'Win rate',
  'ctl.ladder.games': 'Games',
  'ctl.ladder.cap': 'Showing the top {n}.',
  'ctl.notif.title': 'Invasion Alerts',
  'ctl.notif.when': 'Attacked {when}',
  'ctl.notif.mine': 'My taunt: {taunt}',
  'ctl.notif.empty': 'No invasions on your base yet.',
  'ctl.hist.title': 'Battle Log',
  'ctl.hist.loading': 'Loading the battle log…',
  'ctl.hist.null': 'Server not configured or offline — the battle log is unavailable.',
  'ctl.hist.empty': 'No battles recorded yet.',
  'ctl.hist.summary': '{n} battles · {w}W {l}L · attacks {a} · defenses {d}',
  'ctl.hist.filter.all': 'All',
  'ctl.hist.filter.attack': 'Attacks',
  'ctl.hist.filter.defense': 'Defenses',
  'ctl.hist.sort.newest': 'Newest first',
  'ctl.hist.sort.oldest': 'Oldest first',
  'ctl.hist.col.when': 'When',
  'ctl.hist.col.side': 'Side',
  'ctl.hist.col.opponent': 'Opponent',
  'ctl.hist.col.result': 'Result',
  'ctl.hist.col.status': 'Verdict',
  'ctl.hist.side.attack': 'Attack',
  'ctl.hist.side.defense': 'Defense',
  'ctl.hist.result.win': 'Win',
  'ctl.hist.result.lose': 'Loss',
  'ctl.hist.result.pending': 'Pending',
  'ctl.hist.status.verified': 'Confirmed',
  'ctl.hist.status.pending': 'Verifying',
  'ctl.hist.status.rejected': 'Rejected',
  'ctl.time.now': 'just now',
  'ctl.time.min': '{n}m ago',
  'ctl.time.hour': '{n}h ago',
  'ctl.time.day': '{n}d ago',

  // --- 방어 사령부 ---
  'def.guardian.titan': 'Titan-type',
  'def.guardian.interceptor': 'Interceptor-type',
  'def.repairDone': 'Repaired — maintenance recovered to {m}% (credits left {c}).',
  'def.repairFail': 'Repair failed (insufficient credits or server not configured). Check the status again.',
  'def.maint.loading': 'Checking maintenance status…',
  'def.maint.offline': 'Maintenance: server not configured or offline — weathering/repair activate when connected.',
  'def.maint.noActive': 'No active defense registered on the server yet. Save a layout to become a maintenance target.',
  'def.maint.label': 'Maintenance {m}%',
  'def.maint.critical': ' ⚠ critical',
  'def.maint.warn': ' caution',
  'def.maint.credits': 'Credits {c} · Repair cost {r}',
  'def.maint.repairing': 'Repairing…',
  'def.maint.repair': '🛠 Repair',
  'def.maint.repairTitle': 'Restore maintenance to 100% with credits',
  'def.guardianHead': 'Guardians',
  'def.guardian.emptyTitle': 'Retire a ship to create a guardian.',
  'def.guardian.none': 'None',
  'def.guardian.slotTitle': '{label} · perf {perf}% — click, then re-place on the grid',
  'def.guardian.tip': 'Guardian {n} · {label} · perf {perf}% (stats are server-authoritative)',
  // 실화면 통합 편집(레인 C) — 선택/제거/카드 관리 접이식.
  // 카드 관리는 별도 캔버스 화면이다(카툰나무풍 롤아웃 #7) — 여기서는 진입 버튼만 둔다.

  // --- 코어 모듈 경제(M7b — 슬롯 2/보관함/상점/합성/분해, ADR-0018) ---
  // 구 `card.*`(M6 방어 카드)의 계승 자리다. 카드 화면·데이터·EF 는 M7b 에서 삭제됐고, 코어
  // 모듈은 L3 코어의 강화 슬롯 2개에 꽂는 **소모성 인스턴스**다. 컬러 이모지 금지(Pixi 두부).
  'mod.title': 'Core Modules',
  // 코어 모듈 도움말(사용자 요청 2026-08-05). 문단 구분은 홑 개행(`helpModal.ts` 주석 ①).
  'mod.help': 'Help',
  'mod.help.title': 'Core Modules Guide',
  'mod.help.s1.h': 'What a core module is',
  'mod.help.s1.b':
    'A core module slots into your base core and fires automatically when someone invades you. You never activate one during a run — it is defensive equipment that works while you are away.\nModules are consumable instances, not catalog picks. Each has its own grade from normal to unique, its own module affixes, and a number of uses. When the uses run out, the module is gone.',
  'mod.help.s2.h': 'When a module is spent',
  'mod.help.s2.b':
    'A module\'s effect is frozen at the moment an invasion begins. Swapping modules never changes an invasion already in progress.\nUses are deducted only when an invasion result is finalized. An attacker who starts a run against you and abandons it costs you nothing.',
  'mod.help.s3.h': 'Getting modules',
  'mod.help.s3.b':
    'The shop carries a daily rotation of low-grade modules. Rare and above are never sold there.\nRare and unique modules come from planet boss drops, from winning a revenge strike, and from fusing. Unique is rare on every one of those paths.\nRule-changing effects exist only on unique modules and unique defense units — nowhere else.',
  'mod.help.s4.h': 'Fusing and dismantling',
  'mod.help.s4.b':
    'Fusing takes three modules of the same grade and attempts a promotion to the grade above. Failure is not a total loss: you get a new module of the same grade back instead.\nDismantling turns a module you do not want back into currency. Storage here has a cap, so dismantling is also how you make room.',
  'mod.help.s5.h': 'Why this is a separate screen',
  'mod.help.s5.b':
    'Defense Command arranges units you place and keep. Modules are spent and replaced, so they live in their own screen with their own storage rather than sitting in a layout slot.\nThe server holds the record of which modules you own and how many uses each has left, so this screen needs a login.',
  'mod.back': '◀ Back to Defense Command',
  'mod.baseOnly': 'Base effect only',
  'mod.affixLine': '{name} +{value}',
  // 슬롯(2)
  'mod.slot.head': 'Core Module Slots',
  'mod.slot.loading': 'Loading modules…',
  'mod.slot.offline': 'Core modules need a server connection. Offline play continues normally.',
  // 조회 실패 전용 — "연결이 없다"(offline)와 "물어봤는데 답을 못 받았다"(failed)는 다르다.
  'mod.load.failed': 'Could not load your modules. Please try again in a moment.',
  'mod.load.retry': 'Try again',
  'mod.slot.noBase': 'Save a defense layout first to use the core module slots.',
  'mod.slot.label': 'Slot {n}',
  'mod.slot.empty': 'Empty slot',
  'mod.slot.emptyHint': 'Pick a slot, then equip a module from your collection.',
  'mod.slot.selected': 'Selected',
  'mod.slot.equipped': 'Equipped',
  'mod.slot.autoHint': 'Equipped modules trigger automatically when you are invaded.',
  'mod.slot.charges': 'Charges {n}/{m}',
  'mod.slot.lastCharge': 'Last charge — consumed on the next confirmed invasion.',
  'mod.slot.unequip': 'Unequip',
  // 보관함
  'mod.inv.head': 'Collection',
  'mod.inv.empty': 'No modules yet. Buy one from the daily shop.',
  'mod.inv.storage': 'Storage {count}/{cap}',
  'mod.inv.full': 'Storage full — salvage or fuse to make room. Purchases and fusion results are blocked.',
  'mod.inv.charges': 'x{n}',
  'mod.inv.equip': 'Equip',
  'mod.inv.equipped': 'Equipped',
  'mod.inv.salvage': 'Salvage',
  'mod.inv.fuseStart': 'Fuse (3 into 1)',
  'mod.inv.fuseMode': 'Select 3 modules of the same grade to fuse.',
  'mod.inv.fuseConfirm': 'Fuse selected ({n}/3)',
  'mod.inv.fuseCancel': 'Cancel',
  'mod.inv.pick': 'Pick',
  'mod.inv.picked': 'Picked',
  'mod.inv.fuseHint': 'Fuse 3 of the same grade into one — with a chance to promote.',
  'mod.inv.offlineNote': 'Your collection lives on the server. Sign in and it fills up here.',
  // 효과를 수치로 — 스탯 축 · 발동 조건 · 기저/유니크 (사용자 지시 2026-08-03).
  // 부호와 단위는 **문구가 갖는다**(값은 항상 양수 롤이다) — src/ui/modulesView.ts 주석이 근거.
  'mod.effect.base': 'All defense damage +{d}% / core HP +{h}%',
  'mod.effect.when': '{when} — {effect}',
  'mod.stat.formationDamagePct': 'Approach formation damage +{n}%',
  'mod.stat.facilityDamagePct': 'Corridor facility damage +{n}%',
  'mod.stat.facilityFireRatePct': 'Corridor facility fire rate +{n}%',
  'mod.stat.propDurabilityPct': 'Core room prop durability +{n}%',
  'mod.stat.bossDamagePct': 'Defense boss damage +{n}%',
  'mod.stat.coreShieldFlat': 'Core shield +{n}',
  'mod.stat.incomingDmgReductionPct': 'Damage taken -{n}%',
  'mod.stat.volleyDamage': 'Volley strike {n} damage',
  'mod.stat.attackerSubCdPct': 'Attacker subweapon cooldown +{n}%',
  'mod.stat.attackerSlowPct': 'Attacker move speed -{n}%',
  'mod.stat.reflectDamagePct': 'Damage reflected to attacker +{n}%',
  'mod.when.fireAttacker': 'vs fire attacker',
  'mod.when.coldAttacker': 'vs cold attacker',
  'mod.when.lightningAttacker': 'vs lightning attacker',
  'mod.when.beamAttacker': 'vs beam/railgun',
  'mod.when.powerSuperiority': 'when the attacker outclasses you',
  'mod.when.revenge': 'on a revenge raid',
  'mod.when.reinvasion': 'on a repeat invasion',
  'mod.when.subweaponHeavy': 'vs heavy subweapon',
  'mod.when.coreProximity': 'when the attacker nears the core',
  'mod.when.facilitiesDestroyed': 'after {n} facilities are destroyed',
  'mod.when.timeElapsed': 'after {n}s',
  'mod.when.guardianDowned': 'when a guardian goes down',
  'mod.when.coreHpLow': 'at core HP {n}% or below',
  'mod.when.earlyPhase': 'in the first {n}s',
  'mod.when.coreHit': 'when the core is hit',
  'mod.when.coreRoomEntered': 'after the attacker enters the core room',
  'mod.uq.uq-mirage-core': 'Spawns {decoyCount} decoy core at {decoyHpPct}% HP',
  'mod.uq.uq-blackout': "Disables the attacker's radar for the first {radarDisableSec}s",
  'mod.uq.uq-last-reboot': 'Revives the core {reviveCount}x at {reviveHpPct}% HP',
  'mod.uq.uq-mirror-gate': 'Reflects {reflectPct}% of core damage back',
  'mod.inv.more': 'Scroll for more modules.',
  // 상점
  'mod.shop.head': 'Daily Shop',
  'mod.shop.offline': 'The shop needs a server connection.',
  'mod.shop.empty': 'The shop is empty today.',
  'mod.shop.note': 'Rotates daily · normal/magic only · options shown up front.',
  'mod.shop.price': '{c} cr',
  'mod.shop.buy': 'Buy',
  'mod.shop.bought': 'Bought',
  // 결과 안내
  'mod.buy.done': 'Purchased a {rarity} module.',
  'mod.buy.storageFull': 'Storage full (20). Salvage or fuse first.',
  'mod.buy.insufficient': 'Not enough credits.',
  'mod.buy.alreadyBought': 'You already bought this slot today.',
  'mod.buy.badSlot': 'Invalid shop slot.',
  'mod.buy.noProfile': 'Profile not found on the server.',
  'mod.buy.failed': 'Purchase failed. Please try again.',
  'mod.salvage.done': 'Salvaged — +{c} credits.',
  'mod.salvage.notOwned': 'That module is no longer available.',
  'mod.salvage.failed': 'Salvage failed. Please try again.',
  // 분해 확인 팝업 — 되돌릴 수 없는 유일한 조작이라 확인을 한 겹 둔다(레인 계약 §1-⑤).
  'mod.salvage.confirm.title': 'Salvage this module?',
  'mod.salvage.confirm.body': 'The module is destroyed for credits. This cannot be undone.',
  'mod.salvage.confirm.ok': 'Salvage it',
  'mod.salvage.confirm.cancel': 'Keep it',
  'mod.fuse.done': 'Fusion complete — got a {rarity} module.',
  'mod.fuse.promoted': 'Fusion promoted! Upgraded to {rarity}.',
  'mod.fuse.needThree': 'Select exactly 3 modules.',
  'mod.fuse.dupIds': 'Cannot select the same module twice.',
  'mod.fuse.rarityMismatch': 'All 3 modules must be the same grade.',
  'mod.fuse.notOwned': 'One of the modules is no longer available.',
  'mod.fuse.failed': 'Fusion failed. Please try again.',
  'mod.equip.done': 'Module equipped.',
  'mod.equip.unequipped': 'Module unequipped.',
  'mod.equip.failed': 'Equip change failed (server rejected).',
  'mod.equip.noSlot': 'Both slots are full. Unequip one first.',
  // 침공 결과 정찰 공개(상대 코어 모듈 옵션 — 스펙 R9)
  'mod.reveal.head': 'Enemy Core Module',
  'mod.reveal.grade': 'Grade: {rarity}',
  'mod.reveal.charges': 'Charges left {n}',
  // 렌더 배너(블랙아웃 등 유니크 룰 변경)
  'mod.hud.blackout': 'Radar jammed — {n}s',

  // --- 모듈 어픽스 표기(M7b — data/coreModules.ts MODULE_AFFIXES 파생) ---
  // 방어체 어픽스(`du-`/`dt-`)와 **같은 `def3.affix.*` 네임스페이스**를 쓴다(id 접두가 달라
  // 충돌 없음). 존재 여부는 tests/i18n.test.ts 가 배열에서 파생해 전수 강제한다.
  // 접두 8종 — 정적 카운터(T0 공격자 매치업)
  'def3.affix.mc-quench.name': 'Quenching',
  'def3.affix.mc-quench.desc':
    'Against an attacker carrying fire affixes, defense units take less damage.',
  'def3.affix.mc-frostward.name': 'Frostward',
  'def3.affix.mc-frostward.desc':
    'Against an attacker carrying cold affixes, defense units take less damage.',
  'def3.affix.mc-insulate.name': 'Insulating',
  'def3.affix.mc-insulate.desc':
    'Against an attacker carrying lightning affixes, their subweapon cooldown grows.',
  'def3.affix.mc-refract.name': 'Refracting',
  'def3.affix.mc-refract.desc':
    'Against a beam or railgun main weapon, defense units take less damage.',
  'def3.affix.mc-armorbreak.name': 'Armorbreaking',
  'def3.affix.mc-armorbreak.desc':
    'When the attacker outclasses you in combat power, corridor facilities hit harder.',
  'def3.affix.mc-avenger.name': 'Avenging',
  'def3.affix.mc-avenger.desc': 'Against a revenge raid, the defense boss hits much harder.',
  'def3.affix.mc-blockade.name': 'Blockading',
  'def3.affix.mc-blockade.desc':
    'Against a repeat invader, core room props are built far more durable.',
  'def3.affix.mc-disruptor.name': 'Disrupting',
  'def3.affix.mc-disruptor.desc':
    'Against a heavy subweapon loadout, that subweapon cooldown grows.',
  // 접미 8종 — 동적 트리거(런 중 공격자 행동 반응)
  'def3.affix.mt-forcefield.name': 'of the Force Field',
  'def3.affix.mt-forcefield.desc': 'Grants the core a shield the first time the attacker closes in.',
  'def3.affix.mt-fury.name': 'of Fury',
  'def3.affix.mt-fury.desc':
    'Once enough corridor facilities are destroyed, the rest fire faster.',
  'def3.affix.mt-attrition.name': 'of Attrition',
  'def3.affix.mt-attrition.desc': 'After the raid drags on, the attacker is slowed.',
  'def3.affix.mt-retribution.name': 'of Retribution',
  'def3.affix.mt-retribution.desc': 'When a guardian goes down, a volley strikes the attacker.',
  'def3.affix.mt-laststand.name': 'of the Last Stand',
  'def3.affix.mt-laststand.desc': 'While the core is badly damaged, the defense boss hits harder.',
  'def3.affix.mt-vanguard.name': 'of the Vanguard',
  'def3.affix.mt-vanguard.desc': 'Approach formations hit harder during the opening seconds.',
  'def3.affix.mt-reflection.name': 'of Reflection',
  'def3.affix.mt-reflection.desc': 'Part of the damage the core takes is reflected at the attacker.',
  'def3.affix.mt-bulwark.name': 'of the Final Bulwark',
  'def3.affix.mt-bulwark.desc':
    'Once the attacker reaches the core room, defense units take less damage.',

  // --- 침공 3레이어 방어체 카탈로그(M7a 임시 16종 — L9-garrison-catalog) ---
  // 키 규약: `def3.<종류>.<슬러그>.name` / `.desc`. 식별자는 data/invasion/catalog.ts 가
  // 원본 배열에서 파생하고(하드코딩 목록 없음), tests/i18n.test.ts 가 전수 존재를 강제한다.
  // **이름·설명에 컬러 이모지 금지** — Pixi 텍스트에서 두부(tofu)로 렌더된다.
  // L1 편대
  'def3.formation.scout-drones.name': 'Scout Drone Flight',
  'def3.formation.scout-drones.desc':
    'Five light drones hold a V and drift straight down the approach lane.',
  'def3.formation.interceptors.name': 'Interceptor Wing',
  'def3.formation.interceptors.desc':
    'Six mortar craft close in from both flanks in staggered waves.',
  'def3.formation.assault.name': 'Assault Charge',
  'def3.formation.assault.desc': 'Four rammers dive in a tight column, one right after another.',
  'def3.formation.glide-flock.name': 'Glide Flock',
  'def3.formation.glide-flock.desc':
    'Six fragile interceptors dive inward from both edges. Their diagonal tracks cross the lane, so standing still means getting clipped.',
  'def3.formation.mine-layer.name': 'Mine Layer',
  'def3.formation.mine-layer.desc':
    'A slow hauler drifts ahead and seeds stationary hulks across the lane. They stay where they land and the forced scroll pushes you into them.',
  'def3.formation.shield-escort.name': 'Shield Escort',
  'def3.formation.shield-escort.desc':
    'Heavy hulls form a wall in front with precision turrets trailing behind. Punch through the line or go around it.',
  'def3.formation.sniper-nest.name': 'Sniper Nest',
  'def3.formation.sniper-nest.desc':
    'Long-range emplacements park high in the lane and keep painting warning lines. Easy to break up close, punishing if ignored.',
  'def3.formation.support-escort.name': 'Support Escort',
  'def3.formation.support-escort.desc':
    'A heavy brood ship travels with repair droids that keep healing it from close range. Kill the healers first or the brood never drops.',
  // Lane9 신규 편대(톡사르·크라스)
  'def3.formation.toxar-corrosion.name': 'Corrosion Assault',
  'def3.formation.toxar-corrosion.desc':
    'Acid rushers flank in from both sides with spitters and blight glands stacked behind. Stand still and the acid keeps eating away at you.',
  'def3.formation.toxar-blight.name': 'Blight Drift',
  'def3.formation.toxar-blight.desc':
    'A slow drifting swarm of spitters and blight glands seals the lane in toxin and lingers on screen far longer than most.',
  'def3.formation.kras-breaker.name': 'Breaker Charge',
  'def3.formation.kras-breaker.desc':
    'Three crusher golems ram in a tight column while two ancient breakers accelerate in behind. Push through the wall or go around.',
  'def3.formation.kras-piercer.name': 'Piercer Nest',
  'def3.formation.kras-piercer.desc':
    'Guardian batteries perch up top painting warning lines while precision turrets and a golem follow. Close in fast or keep getting pierced.',
  // L2 설비
  'def3.fac.rapid.name': 'Rapid Cannon',
  'def3.fac.rapid.desc': 'Wall-mounted autocannon with a steady stream of short-range fire.',
  'def3.fac.rail.name': 'Piercing Railgun',
  'def3.fac.rail.desc': 'Locks its aim, paints a warning line, then fires one piercing round.',
  'def3.fac.mortar.name': 'Arcing Mortar',
  'def3.fac.mortar.desc': 'Lobs a wide fan of slow shells to blanket the corridor.',
  'def3.fac.laser.name': 'Laser Grid',
  'def3.fac.laser.desc': 'Cycles on and off, sweeping a burning field across the lane.',
  'def3.fac.flame.name': 'Flame Vent',
  'def3.fac.flame.desc': 'Pours a constant burning field just inside the wall.',
  'def3.fac.spawner.name': 'Drone Launcher',
  'def3.fac.spawner.desc':
    'Launches small drones down the corridor ahead of the intruder while they are in range.',
  'def3.fac.press.name': 'Crusher Press',
  'def3.fac.press.desc':
    'An indestructible plate that sweeps out into the corridor and back on a fixed cycle. Get caught with no room to give and it grinds you down.',
  'def3.fac.gravwell.name': 'Tractor Well',
  'def3.fac.gravwell.desc':
    'Raises a wide slowing field on a cycle. It deals no damage of its own — it just makes every other facility hit.',
  'def3.fac.shock.name': 'Shock Emitter',
  'def3.fac.shock.desc':
    'Charges for a long beat, then detonates a huge blast for a fraction of a second. One dodge, correctly timed.',
  // Lane9 신규 설비(톡사르 부식 · 크라스 파괴)
  'def3.fac.venomvent.name': 'Venom Vent',
  'def3.fac.venomvent.desc': 'Pours a constant acid field just inside the wall, wearing down anything that lingers.',
  'def3.fac.blightpool.name': 'Blight Pool',
  'def3.fac.blightpool.desc': 'Raises a wide slowing sludge on a cycle. It barely stings, but it strips your room to dodge.',
  'def3.fac.corrosivemist.name': 'Corrosive Mist',
  'def3.fac.corrosivemist.desc': 'Spreads a broad low-damage haze that covers the lane for a long beat after a short warmup.',
  'def3.fac.toxinturret.name': 'Toxin Autogun',
  'def3.fac.toxinturret.desc': 'Sweeps close range with a fast stream of low-damage toxic rounds.',
  'def3.fac.heavyrail.name': 'Heavy Railgun',
  'def3.fac.heavyrail.desc': 'Locks its aim, paints a warning line, then drives one massive piercing round down the lane.',
  'def3.fac.siegecannon.name': 'Siege Cannon',
  'def3.fac.siegecannon.desc': 'Slow but heavy — lobs a single high-impact shell that hits like a wrecking ball.',
  'def3.fac.breachturret.name': 'Breach Scattergun',
  'def3.fac.breachturret.desc': 'Fires a mid-power fan of shells to blanket the corridor with breaching fire.',
  'def3.fac.demolisher.name': 'Demolition Charge',
  'def3.fac.demolisher.desc': 'Charges for a long beat, then blows a huge blast for an instant. One dodge, correctly timed.',
  // L3 기물
  'def3.prop.shieldGenerator.name': 'Shield Generator',
  'def3.prop.shieldGenerator.desc':
    'Wraps the core in a barrier. Break it first or the core takes nothing.',
  'def3.prop.gravityAnchor.name': 'Gravity Anchor',
  'def3.prop.gravityAnchor.desc':
    'Drops a slowing field on a cycle, shrinking the room you have to dodge.',
  'def3.prop.fixedCannon.name': 'Fixed Battery',
  'def3.prop.fixedCannon.desc': 'A stationary gun that covers the core room with direct fire.',
  'def3.prop.repairPylon.name': 'Repair Pylon',
  'def3.prop.repairPylon.desc':
    'Never fires. It pulses repairs into every defense unit around it, so the boss and the props keep coming back until the pylon is gone.',
  'def3.prop.decoyHologram.name': 'Decoy Hologram',
  'def3.prop.decoyHologram.desc':
    'A fake core with the same silhouette and the same targeting priority. Breaking it wins nothing — its damage is the fire you waste on it.',
  'def3.prop.mineSwarm.name': 'Mine Swarm',
  'def3.prop.mineSwarm.desc':
    'Lays blast mines one at a time around its own ring. It punishes anyone who parks next to it to shoot.',
  // L3 방어 보스
  'def3.boss.steelGoliath.name': 'Steel Goliath',
  'def3.boss.steelGoliath.desc':
    'Core room guardian. Three phases, with an overheat window after each opening pattern.',
  'def3.boss.sporeQueen.name': 'Spore Queen',
  'def3.boss.sporeQueen.desc':
    'Slow, huge, and territorial. She takes the floor away with slowing fields and lava pillars, then opens her overheat window while you stand in them.',
  'def3.boss.phaseWarden.name': 'Phase Warden',
  'def3.boss.phaseWarden.desc':
    'Thin, fast, and pure bullet pattern — it lays no ground hazard at all. It leaves you gaps between shots instead of room to stand.',
  // L2 맵 템플릿
  'def3.map.straight.name': 'Open Corridor',
  'def3.map.straight.desc': 'A long straight run with twelve sockets and almost no cover.',
  'def3.map.curved.name': 'Winding Corridor',
  'def3.map.curved.desc': 'Three offset segments, ten sockets, and blind spots between them.',
  'def3.map.choke.name': 'Choke Corridor',
  'def3.map.choke.desc': 'A narrow squeeze with only eight sockets but very little room to move.',

  // 방어체 어픽스(M7b — data/defenseUnits.ts DEFENSE_UNIT_AFFIXES 에서 파생 검증)
  'def3.affix.du-reinforced.name': 'Reinforced',
  'def3.affix.du-reinforced.desc':
    'Thicker plating. The unit takes more hits before it goes down.',
  'def3.affix.du-honed.name': 'Honed',
  'def3.affix.du-honed.desc':
    'Sharpened firing gear. Every shot lands harder.',
  'def3.affix.du-cycled.name': 'Cycled',
  'def3.affix.du-cycled.desc':
    'Tuned feed mechanism. The unit fires more often.',
  'def3.affix.du-plated.name': 'Plated',
  'def3.affix.du-plated.desc':
    'A standing barrier that soaks damage before the hull does.',
  'def3.affix.du-sealed.name': 'Sealed',
  'def3.affix.du-sealed.desc':
    'Weatherproofed housing. Neglect wears this unit down more slowly.',
  'def3.affix.du-teeming.name': 'Teeming',
  'def3.affix.du-teeming.desc':
    'Wider launch bay. The spawner keeps more drones alive at once.',
  'def3.affix.du-insulated.name': 'Insulated',
  'def3.affix.du-insulated.desc':
    'Heat sinks on the drive. The boss overheats later and less often.',
  'def3.affix.du-vanward.name': 'Vanward',
  'def3.affix.du-vanward.desc':
    'Boosted approach thrusters. The flight reaches its firing line sooner.',
  'def3.affix.dt-ambush.name': 'of Ambush',
  'def3.affix.dt-ambush.desc':
    'Strikes hardest right after the attacker enters the layer.',
  'def3.affix.dt-lastwall.name': 'of the Last Wall',
  'def3.affix.dt-lastwall.desc':
    'Hardens once the core drops below thirty percent.',
  'def3.affix.dt-vengeance.name': 'of Vengeance',
  'def3.affix.dt-vengeance.desc':
    'Grows angrier with each nearby defender destroyed.',
  'def3.affix.dt-siege.name': 'of Siege',
  'def3.affix.dt-siege.desc':
    'Winds up over the first minute and then fires faster.',
  'def3.affix.dt-bulwark.name': 'of the Bulwark',
  'def3.affix.dt-bulwark.desc':
    'Raises a barrier when the core falls to half health.',
  'def3.affix.dt-recoil.name': 'of Recoil',
  'def3.affix.dt-recoil.desc':
    'Hits far harder while the attacker is at close range.',
  'def3.affix.dt-swarmcall.name': 'of the Swarm Call',
  'def3.affix.dt-swarmcall.desc':
    'Every defender lost frees another slot for drones.',
  'def3.affix.dt-secondwind.name': 'of Second Wind',
  'def3.affix.dt-secondwind.desc':
    'Shrugs off neglect once the invasion runs long.',
  // 유니크 방어체 고유 효과(M7b — data/defenseUnits.ts DEFENSE_UNIQUES 에서 파생 검증)
  'def3.duq.duq-overclock-core.name': 'Overclock Core',
  'def3.duq.duq-overclock-core.desc':
    'Fires faster the longer the invasion runs, up to a hard cap. Pays for it with permanently thinner hull.',
  'def3.duq.duq-vengeance-engine.name': 'Vengeance Engine',
  'def3.duq.duq-vengeance-engine.desc':
    'Every allied defender destroyed on the same layer raises its damage, up to a cap.',
  'def3.duq.duq-deathgrip-bastion.name': 'Deathgrip Bastion',
  'def3.duq.duq-deathgrip-bastion.desc':
    'Toughens up as the core loses integrity, peaking when the core is nearly gone.',
  'def3.duq.duq-proximity-reactor.name': 'Proximity Reactor',
  'def3.duq.duq-proximity-reactor.desc':
    'Hits harder the closer the attacker gets, stepping up through fixed distance bands.',
  'def3.duq.duq-swarm-nexus.name': 'Swarm Nexus',
  'def3.duq.duq-swarm-nexus.desc':
    'Keeps far more drones alive at once, but every cycle takes longer to come around.',
  'def3.duq.duq-aegis-lattice.name': 'Aegis Lattice',
  'def3.duq.duq-aegis-lattice.desc':
    'Gains a flat shield and heavy weathering resistance at the cost of its own damage.',
  'def3.duq.duq-thermal-vault.name': 'Thermal Vault',
  'def3.duq.duq-thermal-vault.desc':
    'A defense boss that cuts its overheat window short and carries extra hull.',
  'def3.duq.duq-vanguard-tide.name': 'Vanguard Tide',
  'def3.duq.duq-vanguard-tide.desc':
    'A formation that pours in much faster and hits harder, but folds under return fire.',
  // 코어 모듈 유니크(M7b — data/coreModules.ts CORE_MODULE_UNIQUES)
  'def3.module.uq-mirage-core.name': 'Mirage Core',
  'def3.module.uq-mirage-core.desc':
    'Projects a decoy core beside the real one. Breaking it wins nothing.',
  'def3.module.uq-blackout.name': 'Blackout',
  'def3.module.uq-blackout.desc':
    'Jams attacker radar for the first thirty seconds.',
  'def3.module.uq-last-reboot.name': 'Last Reboot',
  'def3.module.uq-last-reboot.desc':
    'The core reboots once instead of falling, at a fifth of its health.',
  'def3.module.uq-mirror-gate.name': 'Mirror Gate',
  'def3.module.uq-mirror-gate.desc':
    'Reflects a quarter of the damage the core takes back at the attacker.',

  // 방어 사령부 화면(M7b — src/ui/pixi/defenseCommand.ts). 통합 게이트가 레인 로컬
  // 폴백표(CMD_FALLBACK_*)를 정본 카탈로그로 승격한 분량이다.
  'def3.cmd.title': 'Defense Command',
  'def3.cmd.tab.l1': 'L1 Approach',
  'def3.cmd.tab.l2': 'L2 Corridor',
  'def3.cmd.tab.l3': 'L3 Core Room',
  'def3.cmd.tab.inv': 'Collection',
  'def3.cmd.tab.mod': 'Core Modules',
  'def3.cmd.save': 'Save layout',
  'def3.cmd.revert': 'Revert',
  'def3.cmd.test': 'Test invasion',
  'def3.cmd.back': '◀ Base',
  'def3.cmd.dirty': 'Unsaved changes',
  // 미저장 편집 상태에서 [시험 침공] 을 누를 때의 확인 팝업 전용 문구.
  'def3.cmd.test.confirm.title': 'Start a test invasion?',
  'def3.cmd.test.confirm.body':
    'The test runs the layout you are editing now, but leaving this screen discards unsaved changes. Save first to keep them.',
  'def3.cmd.test.confirm.saveAndGo': 'Save and start',
  'def3.cmd.test.confirm.discardAndGo': 'Start without saving',
  'def3.cmd.test.confirm.cancel': 'Keep editing',
  'def3.cmd.saved': 'Layout saved.',
  'def3.cmd.savedLocal': 'Saved locally only (offline — the server layout is unchanged).',
  'def3.cmd.offline': 'Managing defense units needs a login. Layout editing works offline.',
  'def3.cmd.loading': 'Loading…',
  'def3.cmd.preview': 'Preview',
  'def3.cmd.previewHint': 'This is what an attacker actually sees on this layer.',
  // 슬롯 패널 제목은 세 레이어 공통이다 — 각인 제목은 패널에 구워지므로 레이어마다 다르면
  // 탭 전환 때마다 석재를 다시 구워야 한다(어느 레이어인지는 탭 바가 이미 말한다).
  'def3.cmd.slots': 'Deployment slots',
  'def3.cmd.core.note': 'Core modules are consumable instances, handled on their own screen.',
  'def3.cmd.slots.l1': 'Wave slots',
  'def3.cmd.slots.l2': 'Facility sockets',
  'def3.cmd.slots.l3': 'Core room',
  'def3.cmd.slot.empty': 'Empty — the standing garrison fills in',
  'def3.cmd.slot.emptyProp': 'Empty',
  'def3.cmd.slot.wave': 'Wave {n}',
  'def3.cmd.slot.socket': 'Socket {n}',
  'def3.cmd.slot.prop': 'Prop {n}',
  'def3.cmd.slot.boss': 'Defense boss',
  'def3.cmd.slot.guardian': 'Guardian {n}',
  'def3.cmd.slot.core': 'Core',
  'def3.cmd.slot.place': 'Place',
  'def3.cmd.slot.clear': 'Clear',
  'def3.cmd.core.hp': 'Core integrity {hp}',
  'def3.cmd.template': 'Corridor terrain',
  'def3.cmd.template.sockets': '{n} sockets',
  'def3.cmd.pick.title': 'Choose a defense unit',
  'def3.cmd.pick.none': 'No eligible unit. Craft one from a blueprint in the Collection tab.',
  'def3.cmd.pick.placed': 'Already placed',
  'def3.cmd.inv.head': 'Defense units',
  'def3.cmd.inv.empty': 'No defense units yet. Craft one from a blueprint.',
  'def3.cmd.inv.blueprints': 'Blueprints',
  'def3.cmd.unit.title': 'Upgrade defense unit',
  // ⚠️ 획득 경로는 CONTEXT.md "설계도" 항목과 ADR-0018 이 정본이다. 예전 문구는 **방어 성공을
  // 획득 경로로 적었는데 그런 경로는 없다**(ADR-0018: 부익부 방지로 명시 제외). 게다가 같은
  // 패널에서 bpEmpty 는 "행성 런과 침공 약탈", bpMore 는 "침공을 막아 내면"이라 서로 모순이었다
  // (사용자 신고 2026-08-05 "약탈 때도 나오고 막아도 나온다는 말이야?"). 경로는 둘뿐이다 —
  // 행성 런 드랍, 그리고 **공격에 성공했을 때**의 복제 약탈.
  'def3.cmd.inv.more': 'Defense units drop from planet runs, or you craft them from blueprints.',
  'def3.cmd.inv.bpMore':
    'Blueprints drop from planet runs, or are copied from the loser when your own invasion succeeds.',
  'def3.cmd.inv.bpEmpty': 'No blueprints yet.',
  'def3.cmd.inv.craft': 'Craft',
  'def3.cmd.inv.count': 'x{n}',
  'def3.cmd.unit.level': 'Lv {n}',
  'def3.cmd.unit.ascension': 'Ascension {n}',
  'def3.cmd.unit.power': 'Power {p}%',
  'def3.cmd.unit.levelUp': 'Level up',
  'def3.cmd.unit.ascend': 'Ascend',
  'def3.cmd.unit.reroll': 'Reroll affixes',
  'def3.cmd.unit.promote': 'Promote grade',
  'def3.cmd.unit.max': 'Max',
  'def3.cmd.unit.cost': '{c} cr / {m} min / {b} bp',
  'def3.cmd.unit.affix.none': 'Base stats only',
  'def3.cmd.unit.affix.always': 'Always',
  'def3.cmd.unit.affix.cond': 'Conditional',
  'def3.cmd.mod.head': 'Core modules',
  'def3.cmd.mod.note':
    'Core modules are consumable instances, not catalog picks — they live in their own screen.',
  'def3.cmd.mod.open': 'Manage modules',
  'def3.cmd.rarity.normal': 'Normal',
  'def3.cmd.rarity.magic': 'Magic',
  'def3.cmd.rarity.rare': 'Rare',
  'def3.cmd.rarity.unique': 'Unique',
  'def3.cmd.err.failed': 'Server rejected the request.',
  'def3.cmd.err.offline': 'Not connected.',
  'def3.cmd.ok.upgrade': 'Upgraded.',

  // 방어 사령부 도움말(사용자 요청 2026-08-05) — 이 화면은 레이어 셋·획득 경로·강화 3축·풍화·
  // 코어 모듈·초안 저장 규약이 한 화면에 겹쳐 있어 처음 오는 사람이 무엇부터 볼지 알 수 없다.
  // 절 단위로 쪼갠 이유는 스크롤 팝업이 제목으로 훑을 수 있어야 하기 때문이다.
  'def3.cmd.help': 'Help',
  'def3.cmd.help.title': 'Defense Command Guide',
  'def3.cmd.help.s1.h': 'What this screen is for',
  'def3.cmd.help.s1.b':
    'This is where you arrange the defense that meets other pilots when they invade your base. You never pilot it yourself — the layout you save here fights on your behalf while you are away.\nOne invasion is a single uninterrupted run through three layers: L1 Upper Atmosphere, L2 Corridor, L3 Core Chamber. The attacker carries hull and resources across the boundaries, so damage you inflict early is what protects the layers behind it.',
  'def3.cmd.help.s2.h': 'The three layers',
  'def3.cmd.help.s2.b':
    'L1 Upper Atmosphere — wave slots. Slot your squadrons and decide the order only; each squadron carries its own formation and path.\nL2 Corridor — pick the corridor terrain, then fit facilities into its mounting sockets. Facilities come in three kinds: wall turrets, gimmick hazards, and drone spawners. Socket count and placement belong to the terrain, which is what stops everything being stacked in one spot.\nL3 Core Chamber — one defense boss slot, guardian slots, prop sockets, and the core itself. When core durability reaches zero the defense has failed.\nEmpty slots are filled by the default garrison, the planet\'s lowest-grade units. Leaving them empty is legal but weak.',
  'def3.cmd.help.s3.h': 'Getting defense units',
  'def3.cmd.help.s3.b':
    'Defense units drop from planet runs, or you craft them from a blueprint plus minerals.\nBlueprints have exactly two sources: planet run drops, and copy-loot — when your own invasion of someone else succeeds, you may copy one of their blueprints. Being invaded is not a source.\nWhen someone invades you, you lose nothing at all. What they take is a copy, never your original.',
  'def3.cmd.help.s4.h': 'Growing a defense unit',
  'def3.cmd.help.s4.b':
    'Level — credits and minerals raise its stats. This is the everyday sink.\nAscension — collect duplicate blueprints of the same unit. Ascension jumps its stats and changes its appearance, and that appearance is visible on the attacker\'s screen.\nAffix reroll — minerals reroll the random defense-unit affixes carried by magic and rare units.\nGrade promotion — normal to magic to rare to unique. Unique units carry their own effects and rule changes.',
  'def3.cmd.help.s5.h': 'Neglect',
  'def3.cmd.help.s5.b':
    'Only deployed defense units decay. Anything sitting in your collection keeps its condition indefinitely, so there is no cost to holding spares. Guardians are the one exception to repair — their condition cannot be restored.',
  'def3.cmd.help.s6.h': 'Core modules',
  'def3.cmd.help.s6.b':
    'Core modules are consumable instances rather than catalog picks, so they have their own screen.\nA module\'s effect is frozen at the moment an invasion begins — swapping modules never changes an invasion already in progress. Charges are deducted only when an invasion result is finalized, so an attacker who starts and abandons a run costs you nothing.',
  'def3.cmd.help.s7.h': 'Saving and testing a layout',
  'def3.cmd.help.s7.b':
    'Your edits are a draft. Nothing defends you until you press Save layout. Revert restores the last saved state.\nTest invasion lets you attack your own current draft. Nothing is recorded — it touches neither the ladder nor any settlement — and the Exit test button on the game screen brings you straight back here.\nLeaving this screen discards unsaved edits, so save first if you want to keep them.',
  'def3.cmd.help.s8.h': 'Worth knowing',
  'def3.cmd.help.s8.b':
    'Slots are the budget. There is no separate cost pool — the map fixes how many wave slots, sockets, and boss or guardian slots you get, and fairness is handled by ladder matchmaking instead.\nAn attacker choosing a target sees only silhouettes, grades, and ascension stars. Exact stats and defense-unit affixes are revealed to them only after they have invaded you once.\nManaging defense units — crafting and upgrading — needs a login. Editing the layout works offline.',

  // 액티브 스킬 42종 i18n (ADR-0041 · .omc/plans/active-skills-catalog.md 저작 카탈로그 정본).
  'activeSkill.as_striker_firepower_lo.name': 'Straight Volley',
  'activeSkill.as_striker_firepower_lo.desc':
    'Fires 12 beam bolts in a fan toward the input direction.',
  'activeSkill.as_striker_firepower_hi.name': 'Full Salvo',
  'activeSkill.as_striker_firepower_hi.desc':
    'Releases 24 beam bolts in every direction at once.',
  'activeSkill.as_striker_survival_lo.name': 'Guard Field',
  'activeSkill.as_striker_survival_lo.desc': 'Ignores all damage for 180 ticks.',
  'activeSkill.as_striker_survival_hi.name': 'Bulwark Protocol',
  'activeSkill.as_striker_survival_hi.desc':
    'Invulnerable for 300 ticks; repairs some hull when it ends.',
  'activeSkill.as_striker_mobility_lo.name': 'Assault Thrust',
  'activeSkill.as_striker_mobility_lo.desc':
    'Instantly surges 600 units along the input direction.',
  'activeSkill.as_striker_mobility_hi.name': 'Double Vault',
  'activeSkill.as_striker_mobility_hi.desc': 'Vaults twice for a total of 900 units.',
  'activeSkill.as_bruiser_blade_lo.name': 'Plate Shatter',
  'activeSkill.as_bruiser_blade_lo.desc':
    'Burns every armor stack, hurling shrapnel in proportion.',
  'activeSkill.as_bruiser_blade_hi.name': 'Overplate Cleave',
  'activeSkill.as_bruiser_blade_hi.desc':
    'Tops armor to maximum, then spends it all on 24 cleaving shots.',
  'activeSkill.as_bruiser_morph_lo.name': 'Ram Charge',
  'activeSkill.as_bruiser_morph_lo.desc': 'Plows 600 units forward and gains 3 armor stacks.',
  'activeSkill.as_bruiser_morph_hi.name': 'Breaker Charge',
  'activeSkill.as_bruiser_morph_hi.desc': 'Rams 900 units through and fills armor to maximum.',
  'activeSkill.as_bruiser_fortify_lo.name': 'Locked Plating',
  'activeSkill.as_bruiser_fortify_lo.desc': 'Armor stays pinned at maximum for 180 ticks.',
  'activeSkill.as_bruiser_fortify_hi.name': 'Rupture Plating',
  'activeSkill.as_bruiser_fortify_hi.desc':
    'Pins armor for 300 ticks, then detonates all of it.',
  'activeSkill.as_arccaster_chain_lo.name': 'Forced Charge',
  'activeSkill.as_arccaster_chain_lo.desc':
    'Enters overcharge without standing still and looses 12 arcs.',
  'activeSkill.as_arccaster_chain_hi.name': 'Full Discharge',
  'activeSkill.as_arccaster_chain_hi.desc':
    'Dumps the whole overcharge as arcs scaled to what was stored.',
  'activeSkill.as_arccaster_barrage_lo.name': 'Phase Blink',
  'activeSkill.as_arccaster_barrage_lo.desc': 'Blinks 600 units without losing overcharge.',
  'activeSkill.as_arccaster_barrage_hi.name': 'Apex Leap',
  'activeSkill.as_arccaster_barrage_hi.desc':
    'Leaps 900 units and lands at maximum overcharge.',
  'activeSkill.as_arccaster_barrier_lo.name': 'Kinetic Charge',
  'activeSkill.as_arccaster_barrier_lo.desc':
    'Overcharge keeps building while moving for 180 ticks.',
  'activeSkill.as_arccaster_barrier_hi.name': 'Locked Overcharge',
  'activeSkill.as_arccaster_barrier_hi.desc':
    'Overcharge is pinned at maximum for 300 ticks.',
  'activeSkill.as_phantom_assassin_lo.name': 'Shadow Break',
  'activeSkill.as_phantom_assassin_lo.desc':
    'Snaps cloak early, throwing 12 daggers carrying the break bonus.',
  'activeSkill.as_phantom_assassin_hi.name': 'Flicker Assassination',
  'activeSkill.as_phantom_assassin_hi.desc':
    'Enters and exits cloak instantly, loading all 24 shots with the break bonus.',
  'activeSkill.as_phantom_phase_lo.name': 'Phase Glide',
  'activeSkill.as_phantom_phase_lo.desc':
    'Slides 600 units and advances the cloak timer by 120 ticks.',
  'activeSkill.as_phantom_phase_hi.name': 'Abyss Step',
  'activeSkill.as_phantom_phase_hi.desc':
    'Phases 900 units and enters cloak the moment it lands.',
  'activeSkill.as_phantom_disrupt_lo.name': 'Held Cloak',
  'activeSkill.as_phantom_disrupt_lo.desc':
    'Hits no longer reset the cloak cycle for 180 ticks.',
  'activeSkill.as_phantom_disrupt_hi.name': 'Endless First Strike',
  'activeSkill.as_phantom_disrupt_hi.desc':
    'The cloak-break bonus never gets consumed for 300 ticks.',
  'activeSkill.as_hatchling_brood_lo.name': 'Egg Scatter',
  'activeSkill.as_hatchling_brood_lo.desc':
    'Scatters 12 egg shots and pulls the next hatch much closer.',
  'activeSkill.as_hatchling_brood_hi.name': 'Clutch Burn',
  'activeSkill.as_hatchling_brood_hi.desc':
    'Burns all hatch progress to erupt 24 egg shots at once.',
  'activeSkill.as_hatchling_nurture_lo.name': 'Egg Roll',
  'activeSkill.as_hatchling_nurture_lo.desc': 'Rolls 600 units and nudges the hatch timer forward.',
  'activeSkill.as_hatchling_nurture_hi.name': 'Nest Leap',
  'activeSkill.as_hatchling_nurture_hi.desc':
    "Leaps 900 units and advances the hatch by 12 kills' worth.",
  'activeSkill.as_hatchling_shelter_lo.name': 'Warm Brooding',
  'activeSkill.as_hatchling_shelter_lo.desc':
    'The hatch timer keeps creeping forward for 180 ticks.',
  'activeSkill.as_hatchling_shelter_hi.name': 'Open Nest',
  'activeSkill.as_hatchling_shelter_hi.desc':
    'The hatch threshold stays satisfied for 300 ticks.',
  'activeSkill.as_mallow_squish_lo.name': 'Returned Ache',
  'activeSkill.as_mallow_squish_lo.desc':
    'Converts all deferred damage into shots and gives it back.',
  'activeSkill.as_mallow_squish_hi.name': 'Deferred Detonation',
  'activeSkill.as_mallow_squish_hi.desc':
    'Doubles the deferred debt to erupt 24 shots right now.',
  'activeSkill.as_mallow_mend_lo.name': 'Bounce Recoil',
  'activeSkill.as_mallow_mend_lo.desc':
    'Bounces 600 units and settles deferred damage on landing.',
  'activeSkill.as_mallow_mend_hi.name': 'Elastic Vault',
  'activeSkill.as_mallow_mend_hi.desc':
    'Vaults 900 units, halving the deferred pool before settling it.',
  'activeSkill.as_mallow_cushion_lo.name': 'Rapid Mend',
  'activeSkill.as_mallow_cushion_lo.desc':
    'The recovery timer fills three times faster for 180 ticks.',
  'activeSkill.as_mallow_cushion_hi.name': 'Total Deferral',
  'activeSkill.as_mallow_cushion_hi.desc':
    'Defers all damage for 300 ticks, then settles it in one go.',
  'activeSkill.as_bubble_pop_lo.name': 'Forced Pop',
  'activeSkill.as_bubble_pop_lo.desc':
    'Bursts the film at once, spraying 12 bubbles and shoving foes back.',
  'activeSkill.as_bubble_pop_hi.name': 'Film Conversion',
  'activeSkill.as_bubble_pop_hi.desc': 'Turns every remaining point of film into bubble shots.',
  'activeSkill.as_bubble_drift_lo.name': 'Buoyant Glide',
  'activeSkill.as_bubble_drift_lo.desc':
    'Floats 600 units and cuts half the film recharge wait.',
  'activeSkill.as_bubble_drift_hi.name': 'Updraft Leap',
  'activeSkill.as_bubble_drift_hi.desc':
    'Rides 900 units and the film re-forms the instant it lands.',
  'activeSkill.as_bubble_film_lo.name': 'Film Recharge',
  'activeSkill.as_bubble_film_lo.desc':
    'Refills the film instantly and doubles recharge for 180 ticks.',
  'activeSkill.as_bubble_film_hi.name': 'Everlasting Film',
  'activeSkill.as_bubble_film_hi.desc':
    'The film refills every tick for 300 ticks, then bursts hard.',

  // --- Commission Desk (지시 수신소, Phase E) ---
  'commission.title': 'Commission Desk',
  'commission.sub': 'Accept a commission, launch instantly',
  'commission.stock': 'Held {n}/{cap}',
  'commission.empty': 'No commissions held. Defeat planet bosses to earn one.',
  'commission.offline': 'Commissions are online-only — connect to view your inventory.',
  'commission.grade.1': 'Standing Order',
  'commission.grade.2': 'Priority Order',
  'commission.grade.3': 'Urgent Order',
  'commission.grade.4': 'Final Order',
  'commission.order.chain': 'Chain Expedition',
  'commission.order.constraint': 'Restricted Contract',
  'commission.order.bounty': 'Bounty Target',
  'commission.order.elite': 'Elite Summons',
  'commission.segments': '{n} stages',
  'commission.rewards.credits': '+{n} credits',
  'commission.rewards.minerals': '+{n} minerals',
  'commission.rewards.items': '+{n} items',
  'commission.rewards.xp': '+{n} XP',
  'commission.rewards.unique': 'Guaranteed unique',
  'commission.eliteNoGrowth': 'No in-run growth — no XP gems, no level-ups, no powerup picks. Only your permanent build fights.',
  'commission.constraint.bannedSlots': 'Sealed: {list}',
  'commission.constraint.maxRarity': '{name} or below only',
  'commission.constraint.bannedUniques': 'Sealed uniques: {list}',
  'commission.constraint.bannedPowerups': 'Banned growth: {list}',
  'commission.launch': 'Launch',
  'commission.launching': 'Launching…',
  // 폐기(2026-08-03) — 보관 상한이 차면 새 의뢰서가 발령되지 않는데, 상한을 내리는 길이
  // 출격 하나뿐이었다. 되돌릴 수 없으므로 문구가 그 사실을 먼저 말한다.
  'commission.discard': 'Discard',
  'commission.discard.title': 'Discard Commission',
  'commission.discard.body':
    'This cannot be undone. The order is struck from the ledger and its rewards are lost. Storage frees up, so new orders can be issued again.',
  'commission.discard.confirm': 'Discard it',
  'commission.discard.cancel': 'Keep it',
  // 2026-08-03 AAA 시네마틱 전환(2열 목록/상세) — 각인 패널 제목과 상세 챔버 넷.
  'commission.list.head': 'Held Orders',
  'commission.detail.head': 'Order Detail',
  'commission.detail.brief': 'Brief',
  'commission.detail.stages': 'Stages',
  'commission.detail.rewards': 'Confirmed Rewards',
  'commission.detail.constraints': 'Restrictions',
  'commission.detail.noConstraints': 'No additional restrictions.',
  'commission.stageLine': '{name} · Invasion Stage {stage}',
  'commission.list.tail': 'Room for more. Planet bosses issue new orders.',
  // 아무것도 선택되지 않은 상세 열이 받는 안내 셋 — 이 화면의 **기본 상태**(보유 0 · 오프라인)
  // 에서 플레이어가 알아야 하는 것은 "고르라"가 아니라 "어떻게 얻고 몇 장까지 쌓이는가"다.
  'commission.about.what': 'What is a Commission',
  'commission.about.whatBody':
    'A sealed order. Its stages and rewards are fixed the moment it is issued — clearing it pays exactly what is written.',
  'commission.about.get': 'How to Obtain',
  'commission.about.getBody':
    'Planet bosses rarely issue one on defeat. Higher invasion stages issue higher grades.',
  'commission.about.stock': 'Storage',
  'commission.about.stockBody':
    'You may hold up to {cap}. While full, no new commission is issued — launch or clear space first.',

  // 지시 수신소 도움말(사용자 요청 2026-08-05). 문단 구분은 홑 개행(`helpModal.ts` 주석 ①).
  'commission.help': 'Help',
  'commission.help.title': 'Order Desk Guide',
  'commission.help.s1.h': 'What a commission is',
  'commission.help.s1.b':
    'A commission is a sealed order. Its stages, its restrictions, and its rewards are all fixed the moment it is issued, and clearing it pays exactly what is written on it — no roll, no variance.\nBecause the reward is a promise rather than a drop, the planet popularity multiplier does not apply to it.',
  'commission.help.s2.h': 'How you get one',
  'commission.help.s2.b':
    'Planet bosses issue a commission on defeat, rarely, and only from runs you won by killing the boss. Higher invasion stages issue higher grades.\nA commission run never issues another commission. To get more you have to go back to ordinary farming, which is what keeps the loop from feeding itself.\nYou may hold a limited number at once. While your desk is full, no new order is issued — launch one or clear space first.',
  'commission.help.s3.h': 'What a commission run is like',
  'commission.help.s3.b':
    'A commission run follows the same grammar as an invasion: several stages passed in a single run with one settlement at the end, resources carried across the boundaries, and no checkpoint if you die partway.\nThe difference is what changes at a boundary. An invasion changes scroll direction; a commission changes the entire planet mode.\nCommissions and catalysts never share a run. A catalyst seasons an ordinary run; a commission opens a separate one with its stage already written.',
  'commission.help.s4.h': 'Restrictions',
  'commission.help.s4.b':
    'Some orders carry restrictions. These are not policed during the run — what is forbidden is simply removed from your loadout options and from the powerup pool, so violating one is impossible rather than punished.\nIf an order lists no restrictions, the detail column says so plainly.',
  'commission.help.s5.h': 'Why this screen needs a login',
  'commission.help.s5.b':
    'The server holds the record of both the orders you have and the guaranteed items they pay out. That is why obtaining a commission and launching a commission run both need a connection.\nA commission run is also the one PvE run that submits a replay. Because the reward is guaranteed rather than rolled, the server re-simulates the run in full before paying it.',

  // 일일 보상 통지 팝업 (ADR-0048 §화면 · `src/ui/pixi/dailyRewardModal.ts`).
  // 이 화면에는 "받기"가 없다 — 그래서 수령을 요청하는 문구도 없다(AC-19).
  'daily.title': 'Daily Reward',
  'daily.streak': 'Consecutive day {n}',
  // 헤더 칩 전용 축약형. 모달의 문장형(`daily.streak`)과 **모양이 다르다** — 칩은 30일 주기를
  // 함께 담아야 하고(AC-20) 폭 예산이 좁다. EN 은 `Streak` 원어 표기를 피한다.
  'daily.chip': 'Daily {n}/{max}',
  'daily.streak.sub':
    'A {max}-day cycle. Day {max} is the peak of the ramp, and the day after it starts over at day 1.',
  'daily.today': 'What arrived today',
  'daily.today.notice': 'It was issued the moment you entered the base. There is nothing to press.',
  'daily.today.side': 'Plus {n} credits on the side.',
  'daily.step': 'Step {index} of {total} toward that goal.',
  'daily.tomorrow': 'Notice for tomorrow',
  'daily.tomorrow.hidden':
    'Only what is coming is written down. The exact values are rolled when you receive it tomorrow.',
  'daily.tomorrow.none': 'Nothing has been written down for tomorrow yet.',
  'daily.count': 'x{n}',
  'daily.uses': '{n} uses',
  'daily.amount.credits': '{n} credits',
  'daily.amount.minerals': '{n} minerals',
  'daily.axis.currency': 'Currency',
  'daily.axis.catalyst': 'Catalyst',
  'daily.axis.blueprint': 'Blueprint',
  'daily.axis.coreModule': 'Core Module',
  'daily.axis.gear': 'Gear',
  'daily.axis.commission': 'Commission',
  'daily.help.reset':
    'Miss a single day and you go back to day 1. The notice written for that day is gone with it.',
  'daily.help.ceiling':
    'The ceiling on what you can receive is bound to the total the server has granted you so far.',
} as const;

/** 카탈로그 키 = 영어 정본의 키 집합. */
export type MessageKey = keyof typeof EN;

/**
 * 한국어 카탈로그(전 키 필수).
 *
 * ## 용어 정본 — 새 문자열을 넣기 전에 여기부터 본다
 *
 * 2026-08-04 전수 점검에서 **같은 개념이 화면마다 다른 이름으로 불리는** 결함을 119건 고쳤다.
 * 사용자가 "표현이 어색하다"고 지적한 실제 원인이 대부분 그것이었다(대표: 런의 구간을 지시
 * 수신소만 `무대`라 부르고 HUD 는 `구간`이라 불렀다). 아래 표가 그 결론이다.
 *
 * | EN | 정본 KO | 함께 쓰면 안 되는 것 |
 * |---|---|---|
 * | `Hull` | 선체 | ⚠ `HP` 는 **체력**이다. 이 둘의 갈림은 EN 을 정확히 반영한 것이지 결함이 아니다 |
 * | `HP`(플레이어) | 체력 | 적·코어·기물·방어체의 HP 는 **내구도** — 전역 치환 금지 |
 * | `Stash`(장비) | 창고 | `보관함`은 촉매·모듈 Collection 이 선점 |
 * | `Collection`/`Stock` | 보관함 | 위와 반드시 분리 |
 * | `Guardian`(예비 전력) | 수호기 | 아르케 적 고유명(`수호 오벨리스크` 등)과 병합 금지 |
 * | `Active ship` | 현역 기체 | `활성`은 액티브 스킬과 혼동 |
 * | `Elite` | 정예 | (엘리트 ✗) |
 * | `Commission`/`Order` | 의뢰서 | 건물명 `지시 수신소`·등급명 `…지시`는 세계관 플레이버라 유지 |
 * | `Wave`(L1 슬롯) | 편대 | (웨이브 ✗) |
 * | `Cooldown` | 쿨다운 | (재사용·재충전 ✗) |
 * | `Damage`(스탯) | 피해량 | (데미지·공격력 ✗) |
 * | `Fire Rate` | 연사 속도 | (발사 속도 ✗) |
 * | `Bullets` | 탄 수 | |
 * | `Magnet` | 자석 | |
 * | `Rarity` 사다리 | 노말·매직·레어·유니크 | 같은 enum 이 화면 따라 두 이름이었다 |
 * | `powerup`/`Upgrade` | 파워업 | `강화`는 계보·방어체·촉매에 13회로 과부하 |
 * | `shield`(코어 임시 자원) | 보호막 | 장비 슬롯명·유닛명 `실드`는 유지 |
 * | `heat`(정련) | 불 세기 | `화력`은 damage 축(14회) |
 * | `neglect`(방어체 감쇠) | 풍화 | |
 * | `Power`(전투 지표) | 전투력 | `전력`은 電力 오독 |
 * | `Invasion` | **침략 단계**(행성 난이도) / **침공**(PvP 기지 공격) | EN 이 한 낱말로 뭉갠 두 개념을 KO 가 나눠 놓은 것이다. 병합하지 마라 |
 *
 * ## 두 가지 예외 정책
 * 1. **좁은 칩은 축약을 허용한다** — `champion.bp.*`·`catalyst.rew.power.fireRate` 의 `피해`·`연사`,
 *    `hud.inv.guardians`·`def3.cmd.slot.guardian` 의 `수호`. 정본대로 늘리면 +18px 이고 그 칸들은
 *    폭이 없다(실측). 각 자리에 이유를 주석으로 남겨 뒀다.
 * 2. **서사는 문체가 연출이다** — 인트로 4컷·기체 사연·기록 파편은 문어체를, 도발 스티커
 *    (`sticker.*`)는 반말을 의도적으로 유지한다. UI 문장만 존댓말(`~합니다`/`~하세요`)로 통일한다.
 *
 * ## 직역 함정 (실제로 밟은 것들)
 * `A sealed order` → `굳은 종이`(뻣뻣한 종이로 읽힘) · `sunk into` → `묻었습니다`(땅에 묻음) ·
 * `authored` → `저작`(저작권) · `weapon cycles` → `재장전`(**없는 메커니즘을 UI 가 약속했다**) ·
 * `instances` → `인스턴스`(코드 용어 유출). **은유가 한국어에서 살지 않으면 규칙을 그대로 적어라.**
 */
export const KO: Record<MessageKey, string> = {
  'common.close': '닫기',

  'settings.title': '설정',
  'settings.open': '설정',
  'settings.sound': '사운드',
  'settings.mute': '음소거',
  'settings.on': '켜짐',
  'settings.off': '꺼짐',
  'settings.volume': '볼륨',
  'settings.bgmVolume': 'BGM 볼륨',
  'settings.sfxVolume': '효과음 볼륨',
  'settings.uiVolume': 'UI 볼륨',
  'settings.account': '계정',
  'settings.accountSignedIn': '로그인됨',
  'settings.notSignedIn': '로그인되지 않음 — 진행도가 이 기기에만 남습니다.',
  'settings.signOut': '로그아웃',
  'settings.language': '언어',
  'settings.lang.en': 'English',
  'settings.lang.ko': '한국어',
  'settings.graphics': '그래픽',
  'settings.quality.auto': '자동',
  'settings.quality.low': '낮음',
  'settings.quality.med': '보통',
  'settings.quality.high': '높음',
  'settings.reducedMotion': '모션 감소',
  'settings.reducedGlow': '발광 감소',
  'settings.damageNumbers': '데미지 숫자',

  'result.win.title': '행성 정복',
  'result.lose.title': '격추당했습니다…',
  // 조사(을/를)는 앞 글자 받침에 따라 갈리는데 `{name}` 이 데이터라 고를 수 없다 — 명사구로 끝낸다.
  'result.win.sub': '{name} 격파 완료.',

  // --- 행성 보스 표시명 (HUD 체력바 머리글 · 승리 문구) ---
  'boss.kargon-lava-fortress': '용암 요새 전차',
  'boss.berdan-swarm-queen': '군체 여왕',
  'boss.niflheim-ghost-flagship': '유령 기함',
  'boss.arke-guardian-obelisk': '수호 오벨리스크',
  'boss.toxar-rot-matriarch': '부패의 모체',
  'boss.kras-siege-colossus': '공성 콜로서스',
  'boss.hudName': '{planet} · {boss}',

  // --- 적 표시명 (성계 지도 전장 정찰 로스터) ---
  // 표기의 출처는 각 `EnemyDef` 정의의 JSDoc 첫 줄이다(데이터가 원본).
  'enemy.kargon-charger': '파쇄차',
  'enemy.kargon-gunner': '박격포',
  'enemy.kargon-lava-spring': '용암샘',
  'enemy.kargon-repair-drone': '수리드론',
  'enemy.berdan-worker-rusher': '일벌레 돌격체',
  'enemy.berdan-spitter': '침뱉기 병정',
  'enemy.berdan-acid-gland': '산성 분비샘',
  'enemy.berdan-brood-nurse': '여왕유모',
  'enemy.berdan-sentinel': '파수병정',
  'enemy.berdan-brood-mother': '분열유충모체',
  'enemy.niflheim-wraith-interceptor': '유령 요격기',
  'enemy.niflheim-frost-gunner': '서리 포수',
  'enemy.niflheim-rime-fissure': '서리 균열',
  'enemy.niflheim-cryo-tender': '냉기 정비선',
  'enemy.niflheim-frost-sentinel': '서리 파수병',
  'enemy.niflheim-spectral-carrier': '유령 모함',
  'enemy.arke-crusher-golem': '파쇄 골렘',
  'enemy.arke-precision-turret': '정밀 포탑',
  'enemy.arke-grind-totem': '분쇄 토템',
  'enemy.arke-restore-droid': '복원 드로이드',
  'enemy.arke-guardian-battery': '수호 포대',
  'enemy.arke-ancient-breaker': '고대 파괴자',
  'enemy.toxar-corroder': '부식 돌격체',
  'enemy.toxar-venom-spitter': '독액 분사체',
  'enemy.toxar-blight-gland': '부식 분비강',
  'enemy.toxar-plague-tender': '역병 정비체',
  'enemy.toxar-toxin-sentinel': '독소 파수병',
  'enemy.toxar-rot-behemoth': '부패 거수',
  'enemy.kras-breaker': '파쇄 강습체',
  'enemy.kras-piercer': '관통 포수',
  'enemy.kras-crusher-totem': '파쇄 토템',
  'enemy.kras-salvage-drone': '잔해 회수체',
  'enemy.kras-siege-battery': '공성 포대',
  'enemy.kras-devastator': '파멸 거병',
  'enemy.kargon-lava-battery': '용암 포대',
  'enemy.kargon-magma-colossus': '용암 거인',
  'enemy.role.charger': '돌격형',
  'enemy.role.gunner': '사수형',
  'enemy.role.special': '특수형',
  'enemy.role.support': '지원형',
  'enemy.role.elite': '정예',
  'enemy.role.boss': '보스',

  'result.lose.sub': '파일럿은 무사히 사출했습니다. 다시 출격하세요.',
  'result.stat.title': '전투 기록',
  'result.stat.time': '생존 시간',
  'result.stat.level': '도달 레벨',
  'result.stat.xp': '획득 경험치',
  'result.stat.kills': '처치 수',
  'result.stat.combo': '최대 콤보',
  'result.stat.resources': '보급 자원',
  'result.stat.seed': '시드',
  'result.levelShort': 'Lv {n}',
  'result.loot.title': '전리품 정산',
  'result.loot.items': '획득 장비',
  'result.loot.count': '{n}개',
  'result.loot.levels': '기체 레벨업',
  'result.loot.skillPoints': '스킬 포인트',
  'result.loot.credits': '크레딧',
  'result.loot.power': '전투력',
  'result.loot.overflow': '보관 실패',
  'result.loot.overflowVal': '{n}개 (공간 부족)',
  'result.tip.power': '전투력 {n}',
  'result.drops.title': '새 장비',
  'result.drops.none': '이번 런에는 새 장비가 없습니다.',
  'result.drops.more': '외 {n}개',
  'result.btn.inventory': '🛠 장비 정비',
  'result.btn.restart': '다시 출격',

  'item.slot.main': '주무기',
  'item.slot.sub': '보조무기',
  'item.slot.armor': '장갑',
  'item.slot.shield': '실드',
  'item.slot.engine': '엔진',
  'item.slot.core': '코어',
  'item.slot.module': '모듈',
  'item.weapon.0': '발칸',
  'item.weapon.1': '스프레드',
  'item.weapon.2': '레일건',
  'item.rarity.normal': '노말',
  'item.rarity.magic': '매직',
  'item.rarity.rare': '레어',
  'item.rarity.unique': '유니크',
  'item.reqLevel': '요구 레벨 Lv{n}',
  'item.levelLocked': '기체 Lv{n} 필요',

  'stat.damagePct.name': '피해량',
  'stat.damagePct.desc': '탄이 주는 피해가 {n}% 증가합니다.',
  'stat.fireRatePct.name': '연사 속도',
  'stat.fireRatePct.desc': '발사 간격이 짧아져 {n}% 빠르게 쏩니다.',
  'stat.bulletCount.name': '탄 수',
  'stat.bulletCount.desc': '한 번 쏠 때 탄이 {n}발 늘어납니다.',
  'stat.pierce.name': '관통',
  'stat.pierce.desc': '탄이 적 {n}명을 더 뚫고 지나갑니다.',
  'stat.bulletSpeedPct.name': '탄속',
  'stat.bulletSpeedPct.desc': '탄이 날아가는 속도가 {n}% 빨라집니다.',
  'stat.rangeFlat.name': '사거리',
  'stat.rangeFlat.desc': '탄이 사라지기까지 {n} 더 날아갑니다.',
  'stat.fireDmg.name': '화염',
  'stat.fireDmg.desc': '명중한 적이 2초 동안 틱당 {n} 피해를 입습니다.',
  'stat.coldSlow.name': '냉기',
  'stat.coldSlow.desc': '명중한 적이 1.5초 동안 이동 속도 55%로 느려집니다.',
  'stat.lightning.name': '전격',
  'stat.lightning.desc': '명중 시 주변 적 최대 3명에게 {n} 연쇄 피해를 줍니다.',
  'stat.moveSpeedPct.name': '이동 속도',
  'stat.moveSpeedPct.desc': '기체 이동 속도가 {n}% 빨라집니다.',
  'stat.maxHpFlat.name': '최대 체력',
  'stat.maxHpFlat.desc': '최대 체력이 {n} 늘어납니다.',
  'stat.maxHpPct.name': '최대 체력',
  'stat.maxHpPct.desc': '최대 체력이 {n}% 늘어납니다.',
  'stat.dashCdPct.name': '대시 쿨다운',
  'stat.dashCdPct.desc': '대시 재사용 대기가 {n}% 짧아집니다.',
  'stat.magnetPct.name': '자석',
  'stat.magnetPct.desc': '젬을 끌어당기는 반경이 {n}% 넓어집니다.',
  'stat.xpPct.name': '경험치',
  'stat.xpPct.desc': '획득 경험치가 {n}% 증가합니다.',
  'stat.mineralFindPct.name': '광물 획득',
  'stat.mineralFindPct.desc': '런에서 얻는 광물이 {n}% 증가합니다.',
  'stat.skillLvOffense.name': '공격 계열 스킬',
  'stat.skillLvOffense.desc': '이미 투자한 공격 계열 스킬이 모두 {n} 레벨 오릅니다.',
  'stat.skillLvDefense.name': '방어 계열 스킬',
  'stat.skillLvDefense.desc': '이미 투자한 방어 계열 스킬이 모두 {n} 레벨 오릅니다.',
  'stat.skillLvUtility.name': '유틸 계열 스킬',
  'stat.skillLvUtility.desc': '이미 투자한 유틸 계열 스킬이 모두 {n} 레벨 오릅니다.',

  'ent.turret.pickup': '포탑 키트',
  'ent.turret.active': '아군 포탑',
  'ent.magnetEmitter': '자석 발신기',
  'ent.bombDevice': '폭탄 장치',
  'ent.boostPad': '부스트 패드',
  'ent.supply': '보급 물자',
  'ent.loot': '전리품',
  'ent.echo': '에코 신호',
  'ent.shelter': '대피소',

  'planet.title': '성계 지도',
  // 성계 지도 도움말(사용자 요청 2026-08-05). 용어는 KO 정본표를 따른다 — `침략 단계`(PvE) ·
  // `행성 인기 배율`(행성 보너스·드랍률 ✗) · `촉매`(모디파이어 ✗) · `파워업` · `요구 레벨`.
  // 이모지 금지, 존댓말.
  'planet.help': '도움말',
  'planet.help.title': '성계 지도 안내',
  'planet.help.s1.h': '이 화면은 무엇을 하는 곳인가요',
  'planet.help.s1.b':
    '출격 화면입니다. 행성을 고르고 단계를 고르고, 원하시면 촉매를 주입한 뒤 출격하시면 됩니다.\n행성은 저마다 사라진 오스카 문명의 기록 보관 시설이며, 적도 지형도 드랍 테이블도 서로 다릅니다. 어느 행성을 도느냐가 보이는 풍경만이 아니라 무엇을 얻을 수 있는지를 정합니다.',
  'planet.help.s2.h': '침략 단계',
  'planet.help.s2.b':
    '단계는 난이도 축이며 1부터 시작해 상한이 없습니다. 최고 클리어 단계는 행성마다 따로 기록됩니다.\n도전할 수 있는 상한은 그 행성의 최고 클리어 단계 더하기 5이고, 최소 10입니다. 단계를 여는 것은 오직 클리어이며 기체 레벨이 단계를 잠그는 일은 없습니다.\n기체 레벨이 단계의 다섯 배쯤이면 편안하다고 보시면 됩니다. 단계는 전리품의 품질을 올리고 수량은 올리지 않습니다. 또한 그 단계에서 나오는 장비의 요구 레벨 상한도 정하는데, 그 상한이 그 단계를 돌기 시작하는 레벨이라 나온 장비를 한참 묵히지 않고 바로 입으실 수 있습니다.',
  'planet.help.s3.h': '촉매',
  'planet.help.s3.b':
    '촉매는 출격 직전에 여기서 주입하는 소모품입니다. 모든 촉매는 난이도 페널티와 보상 증가를 한 몸으로 가집니다. 좋기만 한 촉매는 없습니다.\n여러 장을 한꺼번에 넣을 수 있고 같은 종류를 중복으로 쌓아도 됩니다. 주입한 촉매는 런이 시작되는 순간 소모되며, 런이 잘 풀리든 아니든 돌아오지 않습니다.\n촉매는 평범한 행성 런 전용입니다. 의뢰 런이나 침공에는 들어가지 않습니다.',
  'planet.help.s4.h': '행성 인기 배율',
  'planet.help.s4.b':
    '행성마다 수시로 갱신되는 배율이 표시됩니다. 사람이 덜 도는 행성은 올라가고 많이 도는 행성은 내려갑니다. 전체 유저가 최근 한 시간 동안 정산한 런 수를 보고 자동으로 평형을 맞춥니다.\n배율이 걸리는 것은 전리품 수량과 경험치, 자원 셋뿐입니다. 전리품의 품질은 건드리지 않으며 보스 확정 드랍, 행성 특산 설계도와 특산 촉매, 조우 보상, 침공 보상도 배율 밖입니다. 대체 가능한 보상에만 배율을 건다는 원칙입니다.\n값은 출격 시점에 그 런에 고정됩니다. 보신 숫자가 곧 받으실 숫자입니다. 오프라인이거나 로그인하지 않으면 전 행성이 1.0입니다.',
  'planet.help.s5.h': '출격 전에',
  'planet.help.s5.b':
    '화면 맨 아래 띠 왼쪽의 요약 줄이 실제로 확정된 것을 적어 줍니다. 행성과 단계, 주입한 촉매입니다. 고른 줄 알았던 것 말고 이 줄을 확인해 주세요.\n런 안에서의 성장은 임시입니다. 런 도중 오른 레벨과 주운 파워업은 런이 끝나면 사라집니다. 남는 것은 전리품과 자원이고, 그것이 기지에서 이루는 영구 성장의 재료가 됩니다.',
  'planet.sub': '행성과 침략 단계를 선택하세요.',
  'planet.stageLabel': '침략 단계',
  'planet.stageDesc': '{stage}단계 · 개방 상한 {cap}',
  'planet.back': '◀ 기지로',
  'planet.inventory': '🛠 장비 정비',
  'planet.launch': '▶ {name} 출격',
  // AAA 시네마틱 전환(2026-08-03) — 패널 각인 제목 셋 · 목록 행 배율 · 하단 띠 선택 요약.
  'planet.list.head': '행성',
  'planet.arena.head': '전장 정찰',
  'planet.recon.caption': '{name} · {subtitle}',
  'planet.recon.unit': '{name} · {role}',
  'planet.ops.head': '출격 제원',
  'planet.list.tail': '더 깊은 성역은 아직 항로가 없습니다',
  'planet.rewardMult': '보상 ×{x}',
  'planet.summary': '{name} · 침략 {stage}단계 · 촉매 {n}',

  // --- 촉매 UI(주입 패널·픽커·출격 폴백·관리·분해 — ADR-0029, Lane 4) ---
  'catalyst.panel.title': '촉매',
  'catalyst.panel.sub': '위험-보상 런 소모품',
  'catalyst.panel.none': '주입 없음',
  'catalyst.panel.available': '보유 {n}종 · 주입 편집에서 얹습니다',
  'catalyst.panel.count': '주입 {n} / {cap}',
  'catalyst.panel.edit': '주입 편집',
  'catalyst.picker.title': '촉매 주입',
  'catalyst.picker.slots': '슬롯 {n} / {cap}',
  'catalyst.picker.owned': '보유 {n}',
  'catalyst.picker.inject': '주입',
  'catalyst.picker.remove': '해제',
  'catalyst.picker.clear': '전체 해제',
  'catalyst.picker.confirm': '확정',
  'catalyst.picker.signatureLocked': '{planet} 전용',
  'catalyst.picker.slotFull': '슬롯 상한 도달({cap})',
  'catalyst.picker.noneOwned': '보유한 촉매가 없습니다. 정예·보스 런에서 획득하세요.',
  'catalyst.kind.common': '공용',
  'catalyst.kind.signature': '특산',
  'catalyst.sortie.failTitle': '주입 실패',
  'catalyst.sortie.failBody':
    '촉매를 소모하지 못했습니다(오프라인/거부). 차감된 것은 없습니다 — 재시도하거나 촉매 없이 출격하세요.',
  'catalyst.sortie.retry': '재시도',
  'catalyst.sortie.skip': '촉매 빼고 출격',
  'catalyst.manage.open': '촉매',
  'catalyst.manage.title': '촉매 보관함',
  // 촉매 보관함 도움말(사용자 요청 2026-08-05). 용어는 KO 정본표를 따른다 — `촉매 잔재`는 반드시
  // 전체 표기(단독 `잔재` ✗ · `파편`은 기록 파편과 충돌) · `촉매 상점`(거래소 ✗) · `분해` ·
  // `특산 촉매` · `보관함`. 이모지 금지, 존댓말.
  'catalyst.help': '도움말',
  'catalyst.help.title': '촉매 보관함 안내',
  'catalyst.help.s1.h': '촉매란 무엇인가요',
  'catalyst.help.s1.b':
    '촉매는 런 한 번을 격화시키는 소모품입니다. 모든 촉매가 난이도 페널티와 보상 증가를 한 몸으로 가지며, 좋기만 한 촉매는 하나도 없습니다.\n종류마다 효과가 고정이고 등급이 없어서 같은 촉매 두 장은 완전히 같습니다. 주입은 성계 지도에서 출격 직전에 하고, 런이 시작되는 순간 소모됩니다.',
  'catalyst.help.s2.h': '공용 촉매와 특산 촉매',
  'catalyst.help.s2.b':
    '공용 촉매는 어디서든 나오며 보유량의 대부분을 차지하게 됩니다.\n특산 촉매는 그 촉매가 속한 행성에서만 나옵니다. 상점에서도 팔지 않으므로 얻는 방법은 그 행성에 직접 가서 따 오는 것뿐입니다.',
  'catalyst.help.s3.h': '분해와 촉매 잔재',
  'catalyst.help.s3.b':
    '촉매를 분해하면 촉매 잔재가 나옵니다. 촉매 잔재는 획득처도 사용처도 정확히 하나씩입니다. 분해로만 얻고, 이 화면의 촉매 상점에서 촉매를 사는 데에만 씁니다. 다른 어떤 것도 이 재화를 만들지 않고 쓰지도 않습니다.\n이렇게 닫아 둔 것은 의도된 설계입니다. 크레딧이나 광물로 촉매를 살 수 있다면 자원으로 자원 획득 배율이 붙은 촉매를 사고 그렇게 불린 자원으로 또 촉매를 사는 고리가 생기기 때문에, 상점을 다른 재화로부터 아예 떼어 놓았습니다.',
  'catalyst.help.s4.h': '촉매 상점',
  'catalyst.help.s4.b':
    '상점에는 공용 촉매 전 목록이 항상 진열됩니다. 품절도 로테이션도 없습니다. 특산 촉매는 팔지 않습니다.\n분해 환급량과 구매가는 모두 그 촉매의 희소도에서 나오며, 환급량이 구매가보다 항상 적습니다. 그래서 촉매 잔재를 거쳐 한 번 바꿀 때마다 촉매 총량이 조금씩 줄어듭니다. 마음대로 바꾸는 것이 공짜는 아닙니다.\n특산 촉매도 같은 산식으로 환급되지만 되살 수는 없습니다. 적혀 있는 가격은 읽을 수는 있어도 지불할 수는 없는 값입니다.',
  'catalyst.help.s5.h': '어디에 쓰이고 어디에 안 쓰이나요',
  'catalyst.help.s5.b':
    '촉매는 평범한 PvE 행성 런 전용입니다. 침공이나 의뢰 런에는 들어가지 않습니다. 의뢰 런은 도는 구간과 보상이 이미 적혀 있어 촉매가 들어갈 자리가 없습니다.\n촉매 기록은 서버가 쥐고 있으므로 이 화면과 상점은 로그인이 필요합니다.',
  'catalyst.manage.empty': '보유한 촉매가 없습니다. 정예·보스 런에서 획득하세요.',
  'catalyst.manage.owned': 'x{n}',
  'catalyst.manage.salvage': '분해 {n}',
  'catalyst.manage.salvageDone': '{name} 분해 · +{residue} 촉매 잔재',
  'catalyst.manage.salvageFail': '분해 실패',
  'catalyst.manage.offline': '촉매는 온라인 플레이가 필요합니다.',
  'catalyst.manage.filterAll': '전체',
  'catalyst.manage.filterCommon': '공용',
  'catalyst.manage.filterSignature': '특산',
  'result.loot.catalysts': '촉매',
  'result.loot.catalystList': '획득 촉매',
  // --- 의뢰 확정 지급물 판정(의뢰서 시스템 Phase E, verify-commission 응답) ---
  'result.commission.label': '의뢰 확정 보상',
  'result.commission.pending': '확인 중…',
  'result.commission.verified': '+{credits} 크레딧 · +{minerals} 광물',
  'result.commission.xpLabel': '의뢰 확정 경험치',
  'result.commission.xp': '경험치 +{xp}',
  'result.commission.xpLevels': '경험치 +{xp} · 레벨 +{levels}',
  'result.commission.rejected': '거부됨',
  'result.commission.queued': '재시도 예정(오프라인)',
  'result.commission.lost': '제출하지 못함 — 보상 미지급',
  'result.commission.offline': '오프라인',

  // --- 촉매 잔재·촉매 상점·분해 수량(ADR-0042, catalyst-shop-residue 레인) ---
  'catalyst.residue.name': '촉매 잔재',
  'catalyst.shop.buy': '구매',
  'catalyst.shop.price': '{n} 촉매 잔재',
  'catalyst.shop.signatureNotSold': '특산 촉매는 판매하지 않습니다.',
  'catalyst.shop.priceUnset': '가격이 설정되지 않아 구매할 수 없습니다.',
  'catalyst.shop.insufficientResidue': '촉매 잔재가 부족합니다.',
  'catalyst.shop.noProfile': '프로필을 아직 불러오지 못했습니다. 잠시 후 다시 시도하세요.',
  'catalyst.shop.offline': '촉매 상점은 서버 연결이 필요합니다.',
  'catalyst.shop.buyFail': '구매 실패',
  'catalyst.salvage.qty': '분해 수량',
  'catalyst.salvage.gained': '+{n} 촉매 잔재',
  'catalyst.archive.affordable': '지금 잔재로 {n}종 구매 가능',
  'catalyst.archive.residueUse': '분해로 얻고 구매에 씁니다.',
  'catalyst.archive.detailTitle': '촉매 정보',
  'catalyst.archive.detailEmpty': '왼쪽 목록에서 촉매를 선택하세요.',
  'catalyst.archive.labelSalvage': '분해',
  'catalyst.archive.labelPrice': '구매가',
  'catalyst.archive.labelOwned': '보유',
  'catalyst.archive.rowKind': '분류',
  'catalyst.archive.rowTags': '태그',
  'catalyst.archive.rowCap': '정산 상한',
  'catalyst.archive.notSold': '판매 안 함',

  // --- 태그·상한(ADR-0052) ---
  // ⚠️ 태그 6종의 KO 는 **정본 고정**이다(설계 계약표). 여기서 바꾸면 픽커·공명·계약표가 갈린다.
  // ⚠️ `harvest` 태그 '수확' 은 촉매 id 2 의 표시명 '수확' 과 글자가 같다 — 설계가 그렇게
  //    정한 것이라 여기서 임의로 어느 한쪽을 바꾸지 않는다.
  'catalyst.tag.ignite': '점화',
  'catalyst.tag.density': '밀도',
  'catalyst.tag.precision': '정밀',
  'catalyst.tag.harvest': '수확',
  'catalyst.tag.gamble': '도박',
  'catalyst.tag.erosion': '침식',
  // 상한 축 5종 — 정산 유계다. 어휘는 계약표(`impl-contract-table.md`)의 상한 축 열을 따른다.
  'catalyst.cap.drop': '드랍',
  'catalyst.cap.resource': '자원',
  'catalyst.cap.rarity': '희귀도',
  'catalyst.cap.xp': 'XP',
  'catalyst.cap.catalystDrop': '촉매 드랍',
  'catalyst.cap.line': '{axis} ×{mult}',
  'catalyst.cap.head': '상한',

  // --- 공명 — **시스템 용어**다. 촉매 id 20 의 표시명 '동조' 와 반드시 구분한다(설계 명시). ---
  'catalyst.resonance.head': '공명',
  'catalyst.resonance.none': '아직 공명 없음',
  'catalyst.resonance.need': '{n}장 더',
  'catalyst.tag.head': '태그',
  'catalyst.resonance.tier.weak': '약공명',
  'catalyst.resonance.tier.strong': '강공명',
  'catalyst.resonance.ember.name': '불씨',
  'catalyst.resonance.ember.rule':
    '처치 시 파열이 주변 적을 밀어냅니다. 밀려난 적은 1초간 받는 피해가 줄어듭니다.',
  'catalyst.resonance.reverberation.name': '되울림',
  'catalyst.resonance.reverberation.rule': '처치가 연쇄합니다. 사슬의 마지막 하나는 당신을 칩니다.',
  'catalyst.resonance.attraction.name': '인력',
  'catalyst.resonance.attraction.rule':
    '적이 15 이상이면 같은 종류끼리 끌립니다. 뭉친 적은 방어력을 나눠 단단해집니다.',
  'catalyst.resonance.crossfire.name': '오폭',
  'catalyst.resonance.crossfire.rule': '적의 탄이 적에게도 맞습니다. 당신의 탄은 첫 적에서 멎습니다.',
  'catalyst.resonance.whetting.name': '벼름',
  'catalyst.resonance.whetting.rule':
    '무피격 10초마다 다음 한 발이 관통합니다. 그 직후 3초간 발사가 느려집니다.',
  'catalyst.resonance.deflection.name': '반사',
  'catalyst.resonance.deflection.rule':
    '적탄 일부가 튕겨 다른 적을 맞힙니다. 안 튕긴 탄은 피해가 두 배입니다.',
  'catalyst.resonance.snare.name': '덫',
  'catalyst.resonance.snare.rule':
    '바닥 전리품을 적이 밟으면 1초간 붙잡힙니다. 그동안 당신은 회수할 수 없습니다.',
  'catalyst.resonance.fruition.name': '결실',
  'catalyst.resonance.fruition.rule':
    '전리품 위에서 죽은 적은 그 등급을 올립니다. 적이 밟으면 등급이 내려갑니다.',
  'catalyst.resonance.advance.name': '선불',
  'catalyst.resonance.advance.rule': '런 시작 시 전리품 하나를 미리 받습니다. 지면 그것도 잃습니다.',
  'catalyst.resonance.settlement.name': '청산',
  'catalyst.resonance.settlement.rule':
    '첫 전리품이 봉인됩니다. 보스를 잡으면 최고 등급, 지면 그것만 사라집니다.',
  'catalyst.resonance.abrasion.name': '마모',
  'catalyst.resonance.abrasion.rule':
    '30초마다 이동 속도가 오르고 피격 반경이 커집니다(편대 전환 시 복구).',
  'catalyst.resonance.subsidence.name': '함몰',
  'catalyst.resonance.subsidence.rule':
    '30초마다 가장자리부터 무너져 전장이 좁아지고 드랍 밀도가 오릅니다. 격전을 통과하면 절반 복구됩니다.',

  // --- 픽커 경고 2단 — 회색 = 이 행성에서 무효(구조적) / 노랑 = 촉매 간 충돌(축소 작동) ---
  // ⚠️ 헌장 §축소 작동 규율: 경고일 뿐이고 sim 이 그 카드를 끄는 근거가 아니다.
  'catalyst.warn.head': '경고',
  'catalyst.warn.none': '—',
  'catalyst.warn.voidOnPlanet': '이 행성에서 무효',
  'catalyst.warn.conflict': '다른 촉매가 축소시킴',
  'catalyst.warn.badgeVoid': '무효',
  'catalyst.warn.badgeConflict': '충돌',

  // --- 픽커 슬롯·거부 사유(유니크 주입 — 같은 카드는 한 장뿐) ---
  'catalyst.picker.slotEmpty': '빈 슬롯',
  'catalyst.picker.blockDuplicate': '이미 주입됨',
  'catalyst.picker.blockSignatureCap': '특산 최대 {cap}장',
  'catalyst.picker.blockNoStock': '보유 없음',
  'catalyst.picker.injected': '주입됨',

  // --- 런 중 침공 정보판(우측 가운데, 사용자 요청 2026-07-28) ---
  'runinfo.title': '현재 출격',
  'runinfo.stage': '{n}단계',
  'runinfo.catalysts': '촉매 {n}장',
  'runinfo.noCatalysts': '주입 촉매 없음',

  // --- 촉매 카탈로그(catalyst.<slug>.name/desc — src/data/catalysts.ts 48종) ---
  'catalyst.abundance.name': '풍요',
  'catalyst.abundance.rule':
    '전리품이 두 배로 떨어지지만, 바닥에 다섯 개 이상 쌓여 있는 동안에는 적들이 그 더미 크기만큼 빨라진다.',
  'catalyst.abundance.signal': '바닥 전리품이 다섯을 넘으면 더미에서 붉은 기류가 피어오르고 적의 잔상이 길어진다.',
  'catalyst.plunder.name': '약탈',
  'catalyst.plunder.rule':
    '엘리트와 보스는 죽어도 전리품을 안 뱉지만, 몸에 부딪히면 한 번에 전부 강탈한다 — 부딪히면 접촉 피해도 받는다.',
  'catalyst.plunder.signal': '강탈 가능한 적은 금색 외곽선이 맥동하고, 강탈 순간 몸통이 터지며 전리품이 쏟아진다.',
  'catalyst.harvest.name': '수확',
  'catalyst.harvest.rule':
    '적이 죽은 자리에 수확 지대가 열려 그 위에서 네 탄이 관통하지만, 지대를 밟으면 감속장판처럼 느려진다.',
  'catalyst.harvest.signal': '황금빛 원형 장판 위로 탄이 밝아지며 적을 꿰뚫고, 밟는 동안 기체 발밑에 수확 링이 감긴다.',
  'catalyst.bounty.name': '현상금',
  'catalyst.bounty.rule':
    '피격당하면 맞은 자리에 현상금 표식이 떨어져 주우면 자원을 회수하지만, 적이 먼저 밟으면 그 적이 강화된다.',
  'catalyst.bounty.signal': '피격 지점에 금색 표식이 박히고, 적이 먹으면 붉게 부풀며 액수가 그 적에게 옮겨 붙는다.',
  'catalyst.cornucopia.name': '풍요의 뿔',
  'catalyst.cornucopia.rule':
    '레벨업 시 바닥의 전리품이 전부 폭발해 주변 적을 태우지만, 회수되는 전리품은 등급이 한 단계 내려간다.',
  'catalyst.cornucopia.signal':
    '레벨업 순간 바닥 전리품이 일제히 폭발하며 화면이 밝아지고, 등급색이 한 칸씩 내려앉은 채 빨려 들어온다.',
  'catalyst.refinement.name': '정련',
  'catalyst.refinement.rule':
    '레벨업 3택에 정련 선택지가 떠 같은 등급 셋을 한 단계 위로 합칠 수 있지만, 정련로에 든 것은 지면 전부 잃는다.',
  'catalyst.refinement.signal':
    '3택 한 칸이 정련로 카드로 바뀌고, 합성 순간 승격 연출이 터진다. HUD 에 정련로 잔량이 상시 표시된다.',
  'catalyst.gilding.name': '도금',
  'catalyst.gilding.rule':
    '적은 살아 있는 시간에 비례해 도금되어 강해지지만, 처치하면 도금이 벗겨져 가장 가까운 적에게 옮겨 붙는다.',
  'catalyst.gilding.signal': '적 표면이 단계마다 구리에서 은, 금으로 물들고, 처치 시 금박이 벗겨져 옆 적에게 날아가 붙는다.',
  'catalyst.prospect.name': '감정',
  'catalyst.prospect.rule':
    '매 편대마다 적 하나가 광맥 보유자로 지목돼 호위에 둘러싸인 동안에는 무적이고, 호위가 흩어져야만 뚫린다.',
  'catalyst.prospect.signal':
    '지목된 적이 광맥 결정을 두르고, 호위가 붙어 있으면 보호막이 서리다가 흩어지면 결정이 드러난다.',
  'catalyst.alchemy.name': '연성',
  'catalyst.alchemy.rule':
    '노말 등급 전리품 셋이 가까이 있으면 서로 융합해 매직이 되지만, 융합한 자리는 유독 장판이 되어 태운다.',
  'catalyst.alchemy.signal':
    '노말 셋 사이에 보랏빛 선이 이어지다 한 점으로 빨려 들며 융합하고, 그 자리에 보라색 장판이 퍼진다.',
  'catalyst.epiphany.name': '계시',
  'catalyst.epiphany.rule':
    '레벨업 3택이 1택 2중첩으로 바뀌어 거부할 수 없지만, 원치 않는 것을 받을 때마다 경험치가 적립된다.',
  'catalyst.epiphany.signal': '3택 화면이 단일 금테 카드로 접히며 나머지 두 자리가 재로 흩어지고, 선택 버튼이 없다.',
  'catalyst.insight.name': '통찰',
  'catalyst.insight.rule':
    '적탄이 발사되기 전 예고선으로 미리 보이지만, 그 예고선 위에 서 있는 동안만 경험치가 세 배로 들어온다.',
  'catalyst.insight.signal': '발사 전 붉은 예고선이 그어지고, 그 위에 서면 기체가 백색으로 빛나며 젬 배율이 표시된다.',
  'catalyst.tutelage.name': '교습',
  'catalyst.tutelage.rule':
    '레벨 5에서 곧장 시작하지만, 이 런에서는 이후 모든 레벨업이 3택 없이 전부 자동으로 결정되어 버린다.',
  'catalyst.tutelage.signal':
    '출격 직후 레벨업 연출이 다섯 번 연달아 터지고, 이후 카드가 뽑히는 것을 보기만 할 뿐 고를 수 없다.',
  'catalyst.ascension.name': '승격',
  'catalyst.ascension.rule':
    '웨이브를 넘길 때마다 최대 HP 가 10% 깎이고 공격력이 10% 오르지만, 대시로 적을 관통하면 깎인 HP 가 1 돌아온다.',
  'catalyst.ascension.signal': '웨이브 전환마다 HP 바 상한선이 내려앉고 기체가 발광하며, 복구 시 상한선이 되감긴다.',
  'catalyst.enlightenment.name': '각성',
  'catalyst.enlightenment.rule':
    '화면에 남은 적이 적을수록 네 탄이 최대 3배까지 커지지만, 대신 급행 소환 속도가 두 배로 빨라진다.',
  'catalyst.enlightenment.signal': '적이 줄수록 탄이 눈에 띄게 굵어지고 밝아지며, 적이 다시 차면 탄이 도로 가늘어진다.',
  'catalyst.mastery.name': '숙련',
  'catalyst.mastery.rule':
    '레벨업 3택에 같은 파워업이 셋 나와 고르면 3중첩으로 들어오지만, 사라진 두 선택지 대신 전리품이 하나 떨어질 뿐이다.',
  'catalyst.mastery.signal': '세 카드가 완전히 같은 그림으로 뜨고 스택 수가 크게 표시되며, 선택 직후 전리품이 하나 떨어진다.',
  'catalyst.extraction.name': '채굴',
  'catalyst.extraction.rule':
    '보급 습격의 자원이 곧장 들어오지 않고 화면의 적들에게 실려, 죽이면 전리품으로 굳어 떨어지지만 화면 밖으로 나가면 사라진다.',
  'catalyst.extraction.signal':
    '보급 습격 순간 자원이 적들에게 달라붙어 청백색으로 빛나고, 처치하면 결정으로 굳어 바닥에 박힌다.',
  'catalyst.foundry.name': '제련소',
  'catalyst.foundry.rule':
    '적 셋을 처치할 때마다 포탑이 하나 서지만, 포탑이 서 있는 동안에는 네 공격력이 포탑 수만큼 나뉘어 줄어든다.',
  'catalyst.foundry.signal': '처치 셋째마다 금속이 접히며 포탑이 솟고, HUD 화력 게이지가 포탑 수만큼 내려간다.',
  'catalyst.greed.name': '탐욕',
  'catalyst.greed.rule':
    '자원이 곧장 들어오지 않고 그 값어치만큼 적이 되어 나타나 죽이면 세 배로 받지만, 못 죽이면 그대로 사라진다.',
  'catalyst.greed.signal': '적립 순간 바닥이 갈라지며 금빛 적이 솟아오르고, 화면을 벗어나면 액수가 잿빛으로 꺼진다.',
  'catalyst.mercantile.name': '교역',
  'catalyst.mercantile.rule':
    '레벨업 3택 한 칸이 빚 카드가 되어 지금 2중첩으로 받지만, 런 종료 시 못 갚은 만큼 그 런의 전리품이 압류된다.',
  'catalyst.mercantile.signal': '3택 한 칸이 붉은 차용증으로 바뀌고, 받을 때마다 HUD 에 부채 총액이 쌓인다.',
  'catalyst.motherlode.name': '노다지',
  'catalyst.motherlode.rule':
    '적이 광맥이 되어 처치하면 자원 대신 광석 덩어리를 남기고, 부숴야 자원이 되며 그동안 자동 조준이 그쪽에 묶인다.',
  'catalyst.motherlode.signal': '처치 시 광석 덩어리가 남아 반짝이고, 부술 때 파편이 튀며 자동 조준선이 덩어리로 향한다.',
  // ⚠️ 시스템 용어 '공명'(태그 공명 12종)과 구분한다 — 계약표가 `20 resonance (동조)` 로 못박았다.
  'catalyst.resonance.name': '동조',
  'catalyst.resonance.rule':
    '같은 종류의 적 셋이 가까이 모이면 동조해 강해지지만, 그 상태에서 하나를 죽이면 나머지가 즉사하며 셋 몫의 전리품을 전부 뱉는다.',
  'catalyst.resonance.signal': '동조 중인 적들 사이에 진동하는 광선이 이어지고, 동조음이 은은하게 울려 퍼진다.',
  'catalyst.catalysis.name': '촉매 반응',
  'catalyst.catalysis.rule':
    '촉매가 떨어지면 보유함으로 안 가고 그 자리에 미정착 결정으로 박혀, 적이 밟으면 부서지고 런을 이겨야 정착한다.',
  'catalyst.catalysis.signal': '촉매 결정이 바닥에 박혀 은은히 맥동하고, 적이 다가가면 균열이 가며 부서진다.',
  'catalyst.cascade.name': '연쇄',
  'catalyst.cascade.rule':
    '적이 죽을 때 폭발이 일어나 너도 그 절반만큼 태우지만, 그 폭발로 죽인 적은 전리품을 두 배 뱉는다.',
  'catalyst.cascade.signal': '처치마다 반경이 보이는 폭발구가 퍼지고, 자기 피해 시 화면이 촉매 전용 색으로 물든다.',
  'catalyst.seeding.name': '파종',
  'catalyst.seeding.rule':
    '처치한 적 자리에 씨앗이 남아 15초 뒤 전리품 나무로 자라지만, 그 전에 적이 밟으면 씨앗을 먹고 강화된다.',
  'catalyst.seeding.signal': '씨앗이 바닥에서 맥동하며 발아 링이 차오르고, 발아하면 나무가 솟아 열매가 떨어진다.',
  'catalyst.chainreaction.name': '연쇄 반응',
  'catalyst.chainreaction.rule':
    '네가 받은 피해가 그대로 가장 가까운 적에게 전이되지만, 전이한 만큼 그 웨이브 동안 최대 HP 상한이 내려간다.',
  'catalyst.chainreaction.signal': '피격 순간 기체에서 붉은 사슬이 뻗어 적에게 꽂히고, HP 바 상한선이 전이량만큼 내려앉는다.',
  'catalyst.overdrive.name': '오버드라이브',
  'catalyst.overdrive.rule':
    '발사할수록 총열이 달아올라 뜨거울수록 피해가 최대 2배까지 오르지만, 임계를 넘기면 3초간 침묵한다.',
  'catalyst.overdrive.signal': '총열이 붉게 달아오르고 HUD 열 게이지가 차오르며, 임계 초과 시 증기를 뿜으며 멎는다.',
  'catalyst.rapidcore.name': '속사 코어',
  'catalyst.rapidcore.rule':
    '같은 방향으로 계속 이동할수록 공격력이 최대 2배까지 오르지만, 피격당하면 그대로 초기화된다.',
  'catalyst.rapidcore.signal': '방향 유지 시간이 길수록 기체 잔상이 길어지고 탄이 밝아지며, 피격 순간 잔상이 흩어진다.',
  'catalyst.afterburner.name': '애프터버너',
  'catalyst.afterburner.rule':
    '대시 쿨다운이 사라지지만 대시마다 최대 HP 가 3 깎이며, 대시로 적을 관통해 죽이면 3이 돌아온다.',
  'catalyst.afterburner.signal': '대시마다 후미에서 불꽃이 뿜어지고 HP 바 상한선이 내려앉으며, 관통 처치 시 상한선이 되감긴다.',
  'catalyst.bulwark.name': '방벽',
  'catalyst.bulwark.rule':
    '피격 직후 3초간 맞은 방향 120도의 적탄이 소멸하지만, 그 3초 동안 그 방향으로는 네 탄도 안 나간다.',
  'catalyst.bulwark.signal': '맞은 쪽에 육각 방벽이 펼쳐져 탄이 부서지고, 그 방향 총구가 접히는 것이 보인다.',
  'catalyst.ascendant.name': '초월',
  'catalyst.ascendant.rule':
    '최대 HP 가 절반이 되지만, 대시 무적 시간이 두 배이고 그동안 통과한 적은 2초간 이동 불능이 된다.',
  'catalyst.ascendant.signal': '기체가 반투명 백색으로 승화하고, 통과한 적이 얼어붙은 듯 멎으며 발밑에 결박 링이 그려진다.',
  'catalyst.kargon-swarmcall.name': '카르곤 군단 소집',
  'catalyst.kargon-swarmcall.rule':
    '웨이브 처치 할당이 절반이 되지만, 넘긴 웨이브 수만큼 다음 구간의 적 상한이 누진해서 오른다.',
  'catalyst.kargon-swarmcall.signal':
    '웨이브 전환마다 화면 상단의 누진 단계가 한 칸씩 차오르고, 다음 구간이 눈에 띄게 두껍게 밀려온다.',
  'catalyst.kargon-magma-vein.name': '카르곤 마그마 광맥',
  'catalyst.kargon-magma-vein.rule':
    '네가 쏜 탄이 지나간 자리에 용암이 솟아 적도 너도 태우지만, 용암 위에서 죽은 적은 전리품을 두 배 뱉는다.',
  'catalyst.kargon-magma-vein.signal':
    '사격 궤적을 따라 바닥에 균열이 갈라지며 용암이 올라오고, 자기 피해는 촉매 전용 색으로 보인다.',
  'catalyst.kargon-lava-warden.name': '카르곤 용암 관리자',
  'catalyst.kargon-lava-warden.rule':
    '보스가 용암 갑주를 둘러 가까이 붙을수록 물러지지만, 그 반경 안은 보스의 접촉 피해권이다.',
  'catalyst.kargon-lava-warden.signal': '접근하면 갑주가 녹아내리며 붉게 갈라지고, 물러나면 굳는 소리와 함께 다시 닫힌다.',
  'catalyst.berdan-collapse.name': '베르단 붕괴',
  'catalyst.berdan-collapse.rule':
    '안전 원이 따라오지 않고 15초마다 다른 곳으로 점프하지만, 점프 직후 5초간 새 원 안의 적이 전부 즉사한다.',
  'catalyst.berdan-collapse.signal':
    '점프 3초 전 다음 자리에 예고 링이 그려지고, 점프 순간 원 안의 적이 일제히 소멸하며 백색 파열이 터진다.',
  'catalyst.berdan-royal-jelly.name': '베르단 여왕 젤리',
  'catalyst.berdan-royal-jelly.rule':
    '안전 원이 조여든 자리에 젤리가 남아 먹은 적은 느려지고 죽으면 자원을 세 배 뱉지만, 못 먹은 적은 더 빨라진다.',
  'catalyst.berdan-royal-jelly.signal':
    '수축 흔적을 따라 황금 젤리 띠가 깔리고, 먹은 적은 금빛으로 굼떠지며 못 먹은 적은 붉게 가속한다.',
  'catalyst.berdan-hive-queen.name': '베르단 군체 여왕',
  'catalyst.berdan-hive-queen.rule':
    '보스가 피해를 입으면 그만큼 일벌을 토해내고, 일벌은 보스 HP 를 나눠 가져 죽이면 보스가 그만큼 약해진다.',
  'catalyst.berdan-hive-queen.signal':
    '보스가 맞을 때마다 옆구리에서 일벌이 사출되고, 일벌 처치 시 보스 HP 바가 눈에 띄게 줄어든다.',
  'catalyst.niflheim-pursuit.name': '니플헤임 추격',
  'catalyst.niflheim-pursuit.rule':
    '포식자가 네 그림자를 남겨 지나온 경로를 따라오며 닿으면 즉사지만, 그림자를 따돌린 대피소 확보는 두 배 빠르다.',
  'catalyst.niflheim-pursuit.signal':
    '반투명한 검은 기체가 내 궤적을 그대로 밟아 오고, 궤적선이 옅게 남아 있어 위치를 읽을 수 있다.',
  'catalyst.niflheim-rime-crystal.name': '니플헤임 서리 결정',
  'catalyst.niflheim-rime-crystal.rule':
    '지나간 자리가 얼어 적이 느려지고 그 위에서 죽으면 결정을 떨구지만, 포식자는 언 바닥에서 오히려 가속한다.',
  'catalyst.niflheim-rime-crystal.signal':
    '서리 궤적이 깔리고 그 위 적이 푸르게 굳으며, 포식자가 올라타면 미끄러지듯 가속한다.',
  'catalyst.niflheim-flagship.name': '니플헤임 유령 기함',
  'catalyst.niflheim-flagship.rule':
    '포식자 위로 기함이 떠 대피소를 하나씩 부수지만, 부서진 대피소는 그 자리에 서 있으면 시간이 지나 복구된다.',
  'catalyst.niflheim-flagship.signal':
    '상공을 가로지르는 기함과 포격 궤적이 보이고, 부서진 대피소에 복구 링이 차오른다.',
  'catalyst.arke-overclock.name': '아르케 오버클록',
  'catalyst.arke-overclock.rule':
    '스크롤이 두 배 빨라지고 충돌한 벽은 부서지며 자원을 뱉지만, 부딪힐 때마다 최대 속도가 한 단계 내려간다.',
  'catalyst.arke-overclock.signal':
    '화면 양옆 속도선이 길어지고, 충돌 시 벽이 파열하며 자원이 튄다. HUD 최대속도 게이지가 오르내린다.',
  'catalyst.arke-ancient-core.name': '아르케 고대 코어',
  'catalyst.arke-ancient-core.rule':
    '코스 위 고대 코어를 흡수하면 대량의 자원을 얻지만, 코어의 질량 때문에 3초간 선회 반경이 두 배가 된다.',
  'catalyst.arke-ancient-core.signal':
    '코어를 흡수하면 기체가 무겁게 늘어지는 궤적을 그리고, 선회가 넓어지는 것이 눈에 보인다.',
  'catalyst.arke-obelisk.name': '아르케 오벨리스크',
  'catalyst.arke-obelisk.rule':
    '보스 앞에 관문 셋이 서서 통과한 수만큼 보스를 약화시키지만, 통과 못 한 관문은 그 힘을 보스에게 준다.',
  'catalyst.arke-obelisk.signal':
    '관문마다 다른 빛의 격자와 조건 표식이 서고, 통과하면 격자가 무너지며 인장이 채워진다.',
  'catalyst.toxar-outbreak.name': '톡사르 창궐',
  'catalyst.toxar-outbreak.rule':
    '오염 노드를 부숴도 정화가 절반만 일어나지만, 오염 위에서는 네 탄이 오염을 먹고 커져 처치가 두 배 뱉는다.',
  'catalyst.toxar-outbreak.signal':
    '정화가 절반만 걷히며 잔류 오염이 옅게 남고, 오염 면적 게이지가 HUD 에 상시 뜬다.',
  'catalyst.toxar-blightspore.name': '톡사르 역병 포자',
  'catalyst.toxar-blightspore.rule':
    '처치한 적이 포자 구름을 남겨 안의 적을 두 배 빠르게 하지만, 구름 안에서 죽으면 전리품을 두 배 뱉는다.',
  'catalyst.toxar-blightspore.signal':
    '처치마다 보랏빛 구름이 퍼지고, 구름에 들어간 적이 눈에 띄게 빨라지며 몸에 포자가 묻는다.',
  'catalyst.toxar-blight-mother.name': '톡사르 부패의 모체',
  'catalyst.toxar-blight-mother.rule':
    '보스가 쓰러지면 즉시 두 번째 형태로 일어서 잡으면 보상이 세 배지만, 못 잡으면 첫 형태의 보상까지 사라진다.',
  'catalyst.toxar-blight-mother.signal':
    "쓰러진 시체가 부풀어 터지며 더 큰 형태가 일어서고, 화면 상단의 보상 표시가 '보류'로 잠긴다.",
  'catalyst.kras-breach.name': '크라스 돌파',
  'catalyst.kras-breach.rule':
    '블록이 세 배 단단해지고 층이 겹쳐 쌓이지만, 부순 층이 그 자리에 엄폐물로 남아 적탄을 막아 준다.',
  'catalyst.kras-breach.signal':
    '블록이 다층 금속 질감으로 갈아입고, 파괴 시 층이 하나씩 벗겨지며 안에서 촉매 아이콘이 튀어나온다.',
  'catalyst.kras-breachsteel.name': '크라스 돌파 강철',
  'catalyst.kras-breachsteel.rule':
    '부순 블록 조각이 최대 다섯 개까지 뒤를 따라다니며 방패가 되지만, 조각을 달고 있으면 그만큼 느려진다.',
  'catalyst.kras-breachsteel.signal':
    '기체 뒤로 블록 조각이 궤도를 돌며 따라오고, 적탄이 조각에 맞아 부서진다.',
  'catalyst.kras-colossus.name': '크라스 공성 콜로서스',
  'catalyst.kras-colossus.rule':
    '남은 블록이 곧 보스의 방어력이라 부술수록 약해지지만, 부순 자리로 스크롤이 더 빨리 밀려 올라온다.',
  'catalyst.kras-colossus.signal':
    '모든 블록에서 보스로 뻗는 광선이 이어지고, 블록이 부서질 때마다 보스 갑주가 한 겹 벗겨진다.',

  'base.title': '기지',
  'base.sub': '건물을 선택해 정비하거나, 출격해 행성을 침략하세요.',
  'base.metaShort': '기체 Lv {lv} · 스킬 {sp}',
  'base.launch': '▶ 성계 지도 (출격)',
  'base.launchSub': '여섯 아카이브 행성으로',
  'base.bld.hangar.name': '격납고',
  'base.bld.hangar.desc': '장비 · 인벤토리 · 분해',
  'base.bld.research.name': '연구소',
  'base.bld.research.desc': '스킬 트리 · 리스펙',
  'base.bld.refinery.name': '정제소',
  'base.bld.refinery.desc': '어픽스 리롤 · 잠금 리롤',
  'base.bld.defense.name': '방어 사령부',
  'base.bld.defense.desc': '방어 배치 · 정비',
  'base.bld.control.name': '관제탑',
  'base.bld.control.desc': '래더 · 침공 · 리플레이',
  'base.bld.archive.name': '기록 보관소',
  'base.bld.archive.desc': '파일럿 파일 · 기록 파편 · 프롤로그',
  'base.bld.commission.name': '지시 수신소',
  'base.bld.commission.desc': '의뢰서 수락 · 확정 보상',
  'base.lock.pre': '해금 전',
  'base.lock.level': '기체 Lv {lvl} 필요',
  'base.lock.clear': '행성 1회 클리어 필요',
  'base.locked': '잠김',

  'meta.line': '크레딧 {c} · 광물 {m} · 기체 Lv {lv} · 스킬 {sp}',

  'title.tag': '행성을 침략해 파밍하고, 상위 랭커의 기지를 뚫으세요.',
  'title.startTutorial': '▶ 튜토리얼 시작',
  'title.enterBase': '▶ 기지로 진입',
  'title.note': '홈월드 궤도에서 기초 조작을 익힙니다 (약 3~4분).',
  // Google 공식 한국어 문구. 임의 의역 금지(브랜딩 가이드라인).
  'title.signInGoogle': 'Google 계정으로 로그인',
  'title.signInFailed': '로그인을 시작하지 못했습니다. 연결을 확인하고 다시 시도하세요.',
  'title.loading': '지휘관 기록을 불러오는 중…',

  'tutorial.label': '튜토리얼',
  'tutorial.hint0': '이동하며 적을 조준하세요 — 사격은 자동입니다.',
  'tutorial.hint1': '적을 처치해 경험치 젬을 모으세요. 레벨업하면 파워업을 고를 수 있습니다.',
  'tutorial.hint2': '대시로 적탄을 회피하세요. 밀집한 탄막은 피하는 게 상책입니다.',
  'tutorial.hint3': '첫 장비를 획득하면 기지가 공개됩니다. 계속 밀어붙이세요!',
  'tutorial.hint4': '해금되면 Z 또는 X 키로 액티브 스킬을 발동할 수 있습니다.',

  // 액티브 스킬 크롬(ADR-0041 · 레인 D). params 토큰은 EN 과 동일하게 보존한다.
  'lab.actives.btn': '액티브 스킬',
  'lab.actives.title': '액티브 스킬',
  'lab.actives.sub': '장착 {n}/{m} · 계열 투자로 해금',
  'lab.actives.slot': '슬롯 {n}',
  'lab.actives.slotEmpty': '비어 있음',
  'lab.actives.unequipHint': '슬롯을 누르면 장착이 해제됩니다',
  'lab.actives.locked': '잠김 · 계열 투자 {n} 필요',
  'lab.actives.ready': '장착됨',
  'lab.actives.meta': '쿨다운 {cd}초 · 위력 {p}%',
  'lab.actives.tier.lo': '1티어',
  'lab.actives.tier.hi': '2티어',
  'lab.actives.none': '이 기체에는 아직 액티브 스킬이 없습니다.',
  'lab.err.activeLocked': '아직 해금되지 않았습니다 — 해당 계열에 더 투자하세요.',
  'lab.err.activeFull': '액티브 슬롯 2칸이 모두 찼습니다 — 하나를 먼저 해제하세요.',
  'hud.active.title': '액티브',
  'tutorial.drop': '장비 획득! 이 런을 마치면 기지에서 정비할 수 있습니다.',

  'powerup.title': '레벨업! — 파워업을 선택하세요',
  'powerup.hint': '클릭 또는 {keys} 키',
  'powerup.aria': '{n}번 파워업: {name} — {desc}',
  'powerup.stat.weapon': '무기',
  'powerup.stat.level': 'Lv',
  'powerup.stat.damage': '피해량',
  'powerup.stat.bullets': '탄 수',
  'powerup.stat.fire': '연사',
  'powerup.stat.pierce': '관통',
  'powerup.stat.spread': '확산',
  'powerup.stat.move': '이동',
  'powerup.stat.dash': '대시',
  'powerup.stat.hp': '체력',
  'powerup.stat.magnet': '자석',

  'encounter.vault.title': '보물 격실 포탈',
  'encounter.vault.desc': '안에는 전리품이 있고, 지키는 자들도 있습니다. 여기서 죽으면 런이 실패합니다.',
  'encounter.guardian.title': '봉인 수호자',
  'encounter.guardian.desc': '봉인을 열면 이 자리에 미니 보스가 소환됩니다.',
  'encounter.altar.title': '오스카의 제단',
  'encounter.altar.desc': '공물은 한 번뿐입니다. 무엇에 걸지 고르세요.',
  'encounter.altar.0.name': '즉시 보상',
  'encounter.altar.0.desc': '고등급 장비와 크레딧을 지금 바로',
  'encounter.altar.1.name': '드랍 부스트',
  'encounter.altar.1.desc': '남은 런 동안 드랍이 늘어납니다',
  'encounter.altar.2.name': '봉인 상자',
  'encounter.altar.2.desc': '낮은 등급 다수 — 빈손은 없습니다',
  'encounter.action.enter': '진입 (E)',
  'encounter.action.open': '봉인 개방 (E)',
  'encounter.action.decline': '무시 (Q)',
  'encounter.detour.title': '보물 격실 내부',
  'encounter.detour.remain': '남은 시간 {sec}초',
  'encounter.detour.exit': '지금 이탈 (Q)',
  'encounter.hint.keys': '클릭 또는 {keys} 키',

  'sticker.good-game': 'GG! 다음 판도 부탁해',
  'sticker.nice-try': '잘 싸웠다 — 그래도 내가 이겼지만',
  'sticker.galaxy-small': '은하가 좁네, 또 보자고',
  'sticker.lock-door': '다음엔 문 좀 잠가두렴',
  'sticker.five-stars': '네 기지 별점 5개! (돌파 난이도 별점 아님)',
  'sticker.maintenance': '정비도 좀 챙기지 그랬어',
  'sticker.sightseeing': '행성 관광 잘 마쳤습니다',
  'sticker.turret-regards': '우리 포탑이 안부 전하래',
  'sticker.take-a-seat': '앉아서 커피 한 잔 하고 갈걸',
  'sticker.rematch-anytime': '복수? 얼마든지 기다릴게',
  'sticker.core-walk': '코어까지 산책 편했다',
  'sticker.safe-travels': '돌아가는 길 조심하고',
  'sticker.skip': '스티커 없이 넘어가기',
  'sticker.prompt.invade': '침공 성공! 도발 스티커를 남기시겠어요?',
  'sticker.prompt.defend': '방어 성공! 도발 스티커를 남기시겠어요?',
  'sticker.subtitle': '{name} 에게 한 마디',

  'common.backToBase': '◀ 기지로',

  'item.weapon.3': '미사일',
  'item.weapon.4': '빔',
  'item.subWeapon.0': '사이드킥',
  'item.subWeapon.1': '산탄 발사기',
  'item.subWeapon.2': '기뢰 살포기',
  'item.subWeapon.3': '센트리 드론',
  'item.subWeapon.4': '유도 플레어',

  'hud.supplyRaid': '⚠ 보급선 습격 — 격추하세요!',
  'hud.exitTest': '시험 침공 종료',
  'hud.combo': '콤보 x{mult} ({combo})',
  'hud.lootCount': '전리품 {n}',
  'hud.phaseTransition': '⚙ 페이즈 {n} 전환 중…',
  'hud.overheat': '🔥 과열 — 지금이 기회입니다! (피해 2배)',
  'hud.phase': '페이즈 {n}',
  'hud.bossEta.title': '보스까지',
  'hud.bossEta.segment': '{n}/{total} 구간',
  'hud.bossEta.kills': '처치 {n}/{goal}',
  'hud.bossEta.clash': '지휘관을 격파하세요',
  'hud.bossEta.distance': '전방으로 돌파하세요',
  'hud.bossEta.purify': '구역을 정화하세요',
  'hud.bossEta.shelter': '대피소 {n}/{goal} — 전부 찾으면 포식자가 모습을 드러냅니다',
  'hud.bossEta.ring': '안전권을 소탕하세요',
  'hud.obj.count': '{n}/{total}',
  'hud.obj.inv0': '대기권을 돌파하세요',
  'hud.obj.inv1': '회랑을 밀고 나아가세요',
  'hud.obj.inv2': '코어를 파괴하세요',
  'hud.obj.caution.vampire': '한곳에 몰리면 포위됩니다 — 계속 움직이세요',
  'hud.obj.caution.blockBreak': '화면이 계속 위로 밀립니다 — 벽을 부수며 길을 여세요',
  'hud.obj.caution.racing': '뒤 경계까지 처지면 기체가 깎입니다',
  'hud.obj.caution.chase': '포식자에 닿으면 즉사합니다 — 거리를 유지하세요',
  'hud.obj.caution.shrink': '안전권 밖에서는 매 순간 피해를 입습니다',
  'hud.obj.caution.contamination': '오염이 임계에 닿으면 런이 실패합니다',
  'hud.obj.caution.invasion': '제한시간 안에 코어를 무너뜨려야 합니다',
  'hud.obj.warn.predator': '포식자가 붙었습니다 — 지금 떼어내세요',
  'hud.obj.warn.outside': '안전권 밖입니다 — 안으로 들어가세요',
  'hud.obj.warn.healer': '정비선이 적을 수복하고 있습니다 — 먼저 제거하세요',
  'hud.obj.warn.time': '남은 시간 {n}초',
  'hud.obj.shelterReached': '대피소 확보 — {n}/{goal}',
  'hud.contamination.title': '오염도',
  'hud.contamination.warn': '오염 임계 도달 직전 — 노드를 파괴하세요',
  'hud.inv.title': '침공 진행',
  'hud.inv.layer0': 'L1 · 대기권 돌파',
  'hud.inv.layer1': 'L2 · 회랑 돌파',
  'hud.inv.layer2': 'L3 · 코어방',
  'hud.inv.layerTime': '레이어',
  'hud.inv.totalTime': '총 제한',
  'hud.inv.core': '코어',
  'hud.inv.boss': '방어 보스',
  'hud.inv.defense': '방어 잔존',
  'hud.inv.facilities': '설비',
  // '수호' — '수호기'로 늘리면 +18px 이라 좁은 HUD 칸을 넘친다. 폭 예외로 축약을 유지한다.
  'hud.inv.guardians': '수호',
  'hud.inv.props': '기물',
  'hud.inv.enemies': '적',

  'replay.badge': '관전',
  'replay.titleBody': '{who} 침공 리플레이 (렌더 전용·기록에 영향 없음)',
  'replay.pause': '⏸ 일시정지',
  'replay.play': '▶ 재생',
  'replay.restart': '⟲ 처음부터',
  'replay.exit': '종료',
  'replay.opponentBase': '상대 기지',

  'lab.title': '연구소 — 스킬 트리',
  'lab.tree.firepower': '화력',
  'lab.tree.survival': '생존',
  'lab.tree.mobility': '기동',
  'lab.tree.blade': '칼날',
  'lab.tree.morph': '변형',
  'lab.tree.fortify': '요새',
  'lab.tree.chain': '연쇄',
  'lab.tree.barrage': '탄막',
  'lab.tree.barrier': '방벽',
  'lab.tree.assassin': '암살',
  'lab.tree.phase': '위상',
  'lab.tree.disrupt': '교란',
  'lab.tree.brood': '무리',
  'lab.tree.nurture': '보살핌',
  'lab.tree.shelter': '둥지',
  'lab.tree.squish': '뭉개기',
  'lab.tree.mend': '아물기',
  'lab.tree.cushion': '완충',
  'lab.tree.pop': '터트리기',
  'lab.tree.drift': '표류',
  'lab.tree.film': '방막',
  'lab.browseAll': '전체 스킬 보기 ({n}/{m} 투자)',
  'lab.noInvested': '이 계열에 투자한 스킬이 없습니다.\n위 버튼으로 전체 목록에서 투자하세요.',
  'lab.all.title': '{tree} — 전체 스킬',
  'lab.all.sub': '보유 포인트 {n} · 이 계열 투자 {m}pt',
  'lab.all.hint': '휠로 스크롤 · 행을 클릭하면 1pt 투자',
  'lab.bar.points': '스킬 포인트',
  'lab.bar.invest': '투자',
  'lab.bar.credits': '크레딧',
  'lab.bar.shipLv': '기체 Lv',
  'lab.err.noPoints': '스킬 포인트가 부족합니다.',
  'lab.err.maxed': '이미 최대까지 투자했습니다.',
  // 사슬 선행 조건(ADR-0047). `prereq` 는 팝업 잠긴 행의 설명줄, `chainLocked` 는 클릭 힌트.
  // 조사(을/를)를 쓰지 않는 형태다 — 노드 이름의 받침이 제각각이라 정적으로 고를 수 없다.
  'lab.err.noInvest': '되돌릴 투자가 없습니다.',
  'lab.err.noCredits': '크레딧이 부족합니다 (필요 {n}).',
  'lab.respecDone': '스킬 트리를 초기화하고 포인트를 환급했습니다.',
  'lab.respecBtn': '리스펙 ({n} 크레딧)',
  'lab.respec.affixNotice':
    '포인트를 되돌리면 장비의 계열 스킬 레벨 보너스도 함께 꺼집니다 (스킬에 다시 투자하면 되살아납니다).',

  // 연구소 도움말(사용자 요청 2026-08-05). 용어는 KO 선언부 정본표를 따른다 —
  // `스킬 트리`(화면 제목 `lab.title`·기지 건물 설명이 띄어 쓴다. 붙여 쓴 `스킬트리` 금지)·
  // `노드 행`(`lab.all.hint` 가 `행`이라 부른다)·`계열`·`기체 레벨`·`액티브 스킬`(단독 `액티브` 금지)·`시그니처 패시브`·
  // `쿨다운`·`피해량`. 이모지 금지, 존댓말.
  'lab.help': '도움말',
  'lab.help.title': '연구소 안내',
  'lab.help.s1.h': '이 화면은 무엇을 하는 곳인가요',
  'lab.help.s1.b':
    '기체를 영구히 성장시키는 곳입니다. 여기에 쓴 스킬 포인트는 기체에 그대로 남아 런이 끝나도 사라지지 않습니다. 런 안에서 얻는 파워업과는 완전히 다른 축입니다.\n스킬 트리는 기체 타입마다 다르고, 한 기체에 3계열이 있습니다. 다른 기체로 갈아타면 같은 트리를 다시 배우는 것이 아니라 아예 다른 트리를 처음부터 익히게 됩니다.',
  'lab.help.s2.h': '스킬 포인트',
  'lab.help.s2.b':
    '기체 레벨이 1 오를 때마다 스킬 포인트를 1 받습니다. 기체 레벨은 런에서 가지고 나온 경험치로 오르고 100이 상한이라, 한 기체가 평생 쓸 수 있는 포인트는 정해져 있습니다. 어디에 넣느냐가 곧 빌드입니다.\n스킬 행을 누르면 그 스킬에 1pt 가 들어갑니다. 30종을 다 채우려면 600pt 가 드는데 평생 받는 것은 100pt 남짓이라, 무엇을 포기하느냐가 빌드의 본질입니다.',
  'lab.help.s3.h': '선행 조건이 없습니다',
  'lab.help.s3.b':
    '계열마다 스킬이 10종 있고, 열 종 전부 처음부터 투자할 수 있습니다. 티어도 사슬 선행 조건도 없으니 원하는 스킬에 곧바로 1pt 를 넣으면 됩니다.\n대신 포인트가 모자랍니다. 1pt 만 찍어도 값어치가 있는 스킬과 20pt 를 몰아야 빛나는 스킬이 계열마다 섞여 있어서, 몇 개를 깊게 파고 몇 개를 1pt 유틸로 둘지가 고민이 됩니다.',
  'lab.help.s4.h': '1pt 에 전부 열립니다',
  'lab.help.s4.b':
    '스킬은 1pt 를 넣는 순간 그 동작이 온전히 켜집니다. 레벨 2부터 20까지는 그 동작의 핵심 수치만 자랍니다 — 특정 레벨에서 갑자기 다른 것으로 변하는 구간은 없습니다.\n그래서 몇 레벨부터 쓸 만한지 걱정할 필요가 없습니다. 1pt 짜리 스킬도 그 자리에서 제 몫을 합니다.',
  'lab.help.s5.h': '액티브 스킬',
  'lab.help.s5.b':
    '기체마다 액티브 스킬이 6종 있고 계열마다 2종씩 붙습니다. 해금은 그 계열의 누적 투자량으로, 낮은 쪽은 8, 높은 쪽은 40입니다. 헤더의 액티브 스킬 버튼에서 장착합니다.\n한 번에 2개까지 장착할 수 있고 런에서 Z·X 키로 직접 발동합니다. 비용은 쿨다운뿐이라 자원도 선체도 소모하지 않습니다.\n계열에 투자할수록 장착 여부와 무관하게 그 계열 스킬 2종의 위력과 쿨다운이 계속 좋아집니다. 그래서 지금 장착하지 않은 스킬이라도 그 계열에 넣은 포인트는 헛되지 않습니다.',
  'lab.help.s6.h': '리스펙',
  'lab.help.s6.b':
    '리스펙은 크레딧을 내고 투자한 포인트를 한 번에 전부 돌려받는 기능입니다. 빌드는 영구 결정이 아니니 편하게 실험하셔도 됩니다. 헤더의 버튼에 현재 비용이 적혀 있습니다.\n기체의 시그니처 패시브는 스킬 트리 밖입니다. 항상 켜져 있고 투자 대상이 아니며 리스펙으로도 바뀌지 않습니다.',

  'inv.title': '장비 정비',
  'inv.cur.credits': '크레딧',
  'inv.cur.minerals': '광물',
  'inv.cur.skillPoints': '스킬 포인트',
  'inv.cur.shipLv': '기체 Lv',
  'inv.equip': '장착',
  'inv.module1': '모듈1',
  'inv.module2': '모듈2',
  'inv.invHeader': '인벤토리 ({n}/{cap})',
  'inv.stashHeader': '창고 ({n}/{cap})',
  'inv.loadoutStats': '로드아웃 스탯',
  'inv.stat.weapon': '주무기',
  'inv.stat.damage': '피해량',
  'inv.stat.fireRate': '연사 속도',
  'inv.stat.bullets': '탄 수',
  'inv.stat.pierce': '관통',
  'inv.stat.moveSpeed': '이동 속도',
  'inv.stat.hp': '추가 체력',
  'inv.stat.magnet': '자석',
  'inv.stat.xp': '경험치',
  'inv.stat.mineralFind': '광물 획득',
  'inv.tip.compare': '장착 중: {name} (어픽스 {n}개)',
  'inv.tip.compareTitle': '— 장착 장비와 비교 —',
  'inv.tip.comparePower': '전투력 {n}',
  'inv.tip.compareSame': '장착 장비와 동일',
  'inv.tip.compareAdded': '▲ 추가',
  'inv.tip.compareLost': '▼ 사라짐',
  'inv.err.full': '인벤토리가 가득 찼습니다. 먼저 분해하거나 창고를 확장하세요.',
  'inv.err.noSalvage': '분해할 아이템이 없습니다.',
  'inv.salvageDone': '{n}개 분해 → 크레딧 +{credits}, 광물 +{minerals}',
  'inv.stashMax': '창고를 최대까지 확장했습니다.',
  'inv.err.noCredits': '크레딧이 부족합니다 (필요 {n}).',
  'inv.stashExpanded': '창고를 확장했습니다.',
  'inv.act.salvageLow': '노말·매직 일괄 분해',
  'inv.act.salvageHigh': '레어 이상 일괄 분해',
  'inv.act.salvageLowShort': '노말·매직 분해',
  'inv.act.salvageHighShort': '레어+ 분해',
  'inv.help.stash': '클릭: 인벤토리로 꺼내기  ·  분해는 현재 분류 탭에 보이는 것만',
  'inv.help.inventory': '클릭: 장착  ·  우클릭: 창고로 넣기',
  // 조사(을/를)는 앞 글자 받침에 따라 갈린다 — `{name}` 이 데이터라 고를 수 없으므로 화살표로
  // 표기해 어색한 "엔진 을(를)" 을 피한다.
  'inv.moved.toInventory': '{name} → 인벤토리로 이동',
  'inv.moved.toStash': '{name} → 창고로 이동',
  'inv.err.stashFull': '창고가 가득 찼습니다. 확장하거나 먼저 분해하세요.',
  // 조사(을/를) 회피는 위 이동 문구와 같은 이유 — `{name}` 이 데이터라 받침을 고를 수 없다.
  'inv.err.duplicateUnique':
    '{name} — 같은 유니크를 이미 장착 중입니다. 유니크 효과는 중첩되지 않아 두 번째 사본은 칸만 낭비합니다.',
  'inv.tip.equippedNow': '현재 장착 중',
  'inv.act.expand': '창고 확장 ({n} 크레딧)',
  'inv.act.expandMax': '창고 최대 확장됨',
  'inv.act.backToMap': '◀ 성계 지도로',
  // 서버 원장 거부 사유 구분(SpendOutcome.reason) — 전부 "재화 부족"으로 뭉개지 않는다.
  // 재화를 쓰는 세 화면(격납고 창고 확장 · 정제소 리롤 · 연구소 리스펙)이 공유한다.
  'spend.err.rejectedCredits': '서버 원장이 거부했습니다 (필요 크레딧 {n}, 서버 잔액 {have}).',
  'spend.err.rejectedMinerals': '서버 원장이 거부했습니다 (필요 광물 {n}, 서버 잔액 {have}).',
  'spend.err.unavailable': '서버와 통신하지 못했습니다. 차감된 것은 없으니 잠시 후 다시 시도하세요.',
  // 인벤토리/창고 분류 보기(슬롯 필터 + 정렬 토글).
  'inv.filter.all': '전체',
  'inv.filter.empty': '이 분류에 아이템이 없습니다.',
  'inv.act.sort': '정렬: {v}',
  'inv.sort.default': '획득순',
  'inv.sort.rarity': '희귀도',
  'inv.sort.slot': '슬롯',

  // --- 격납고 카툰 UI (Pixi 리스킨) ---
  'hangar.title': '격납고',
  // 격납고 도움말(사용자 요청 2026-08-05). 용어는 KO 정본표를 따른다 — `창고`(장비 Stash) ·
  // `보관함`은 촉매·모듈 전용 · `수호기` · `퇴역` · `요구 레벨` · `파워업`. 이모지 금지, 존댓말.
  'hangar.help': '도움말',
  'hangar.help.title': '격납고 안내',
  'hangar.help.s1.h': '이 화면은 무엇을 하는 곳인가요',
  'hangar.help.s1.b':
    '현역 기체에 장비를 입히는 곳입니다. 여기서 장착한 장비는 런이 끝나도 사라지지 않습니다. 런 도중에 줍는 파워업과 달리 영구히 남는 축입니다.\n스탯 패널은 지금 장착 구성이 실제로 만들어 내는 값을 보여 줍니다. 모든 출처가 이미 합산된 값이므로, 빌드를 비교하실 때는 개별 장비의 수치가 아니라 이 총합을 보시면 됩니다.',
  'hangar.help.s2.h': '장비와 창고',
  'hangar.help.s2.b':
    '장비 슬롯은 8칸이고, 기체 타입이 달라도 8칸은 그대로입니다. 그래서 파밍한 장비가 기체 세대를 넘어 이어집니다.\n장비는 노말·매직·레어·유니크 4등급이며 무작위 어픽스가 붙습니다. 요구 레벨이 붙은 장비는 그 레벨 아래에서는 착용할 수 없습니다. 침략 단계가 그 단계에서 나오는 장비의 요구 레벨 상한을 정하므로, 어느 단계에서 딴 장비든 그 단계를 도는 동안 입을 수 있습니다.',
  'hangar.help.s3.h': '기체 교체',
  'hangar.help.s3.b':
    '기체 교체는 현재 기체가 레벨 100에 닿기 전까지 잠겨 있습니다. 아직 자랄 여지가 남은 기체를 버리는 셈이 되기 때문에, 권고가 아니라 버튼 자체를 잠급니다.\n만렙에서 기체를 바꾸는 것은 퇴역이라는 엔드게임 절차입니다. 퇴역한 기체는 장착 장비를 품은 채 수호기가 되고 계보 포인트를 지급합니다. 다음 기체는 로스터 전체에서 자유롭게 고르며 따로 해금할 것이 없습니다.',
  'hangar.help.s4.h': '수호기와 계보',
  'hangar.help.s4.b':
    '수호기는 퇴역시킨 기체들입니다. 방어 사령부의 코어방에 세울 수 있고, 품고 있는 장비는 그 안에 잠긴 채로 남습니다.\n계보 포인트는 퇴역을 거듭할수록 쌓이며, 앞으로 타게 될 모든 기체에 적용되는 영구 강화를 삽니다. 헤더의 예비역 버튼이 수호기 로스터를, 계보 버튼이 계보 투자를 엽니다.',
  'hangar.help.s5.h': '촉매',
  'hangar.help.s5.b':
    '촉매는 평범한 런의 난이도와 보상을 함께 올리는 소모품입니다. 헤더의 버튼이 촉매를 관리하는 보관함을 열고, 어떤 촉매를 넣을지는 출격 직전에 고르시면 됩니다.\n의뢰 런에는 촉매가 들어가지 않습니다. 그 런은 도는 구간과 보상이 이미 적혀 있기 때문입니다.',
  'hangar.panel.stats': '기체 스탯',
  'hangar.stat.element.fire': '화염',
  'hangar.stat.element.cold': '냉기',
  'hangar.stat.element.lightning': '전격',
  'hangar.stat.lineage': '계보 강화',
  'hangar.stat.unique': '유니크 효과',
  'hangar.stat.uniqueDup': '{name} (중복 — 효과 없음)',
  'hangar.desc.weapon': '기체의 기본 발사 방식입니다.',
  'hangar.desc.damage': '모든 피해에 곱해지는 배율입니다.',
  'hangar.desc.fireRate': '무기가 다음 발사를 준비하는 속도입니다.',
  'hangar.desc.bullets': '발사당 추가 탄환 수입니다.',
  'hangar.desc.pierce': '탄환이 관통하는 적의 수입니다.',
  'hangar.desc.moveSpeed': '기체 이동 속도 배율입니다.',
  'hangar.desc.hp': '기본값에 더해지는 추가 체력입니다.',
  'hangar.desc.magnet': '아이템 수집 반경입니다.',
  'hangar.desc.xp': '획득 경험치 배율입니다.',
  'hangar.desc.mineralFind': '분해 광물 획득 배율입니다.',
  'hangar.desc.element.fire': '명중 시 지속 화염 피해를 줍니다.',
  'hangar.desc.element.cold': '명중 시 적을 감속시킵니다.',
  'hangar.desc.element.lightning': '명중 시 인접 적에게 연쇄 피해를 줍니다.',
  'hangar.desc.lineage': '현역 기체를 강화하는 계정 단위 보너스입니다.',
  'hangar.affix.noInvest': '(투자 없음 — 미적용)',
  'hangar.act.swapShip': '기체 교체',
  'hangar.act.guardians': '예비역',
  'hangar.act.lineage': '계보',
  // 기체 교체(퇴역·세대 교체)는 현역이 만렙일 때만 열린다 — 잠긴 이유를 화면에 남긴다.
  'hangar.err.swapNeedMaxLevel': '기체 교체는 만렙(Lv {n})부터 가능합니다. 현역 기체: Lv {lv}.',

  'ship.striker.name': '스트라이커',
  'ship.striker.role': '균형 잡힌 기준점. 어느 축으로도 섀시 보정이 없습니다.',
  'ship.striker.signature':
    '정조준 사이클 — 주무기 볼리 12회마다 다음 1볼리가 정조준 볼리가 되어, 그 볼리의 모든 탄이 피해 +50%·관통 +1 을 받습니다. 이후 사이클이 다시 시작됩니다.',
  'ship.bruiser.name': '브루저',
  'ship.bruiser.role': '맞으며 전진하는 근접형. 가장 두꺼운 선체, 가장 짧은 사거리.',
  'ship.bruiser.signature':
    '장갑 스택 — 피격할 때마다 스택이 1개 쌓입니다(최대 8). 스택 1개당 받는 피해가 2.5% 줄어 8스택이면 20% 감소합니다. 3초 동안 맞지 않으면 스택이 1개 사라집니다.',
  'ship.arccaster.name': '아크 캐스터',
  'ship.arccaster.role': '자리를 잡고 쏘는 포격형. 가장 긴 사거리와 두꺼운 탄막, 가장 느린 재배치.',
  'ship.arccaster.signature':
    '과충전 — 1.5초 동안 멈춰 있으면 피해가 15% 오르고, 이후 정지 1초마다 15%씩 더해져 최대 40%까지 오릅니다. 움직이면 즉시 풀립니다.',
  'ship.phantom.name': '팬텀',
  'ship.phantom.role': '유리 대포 암살형. 가장 높은 단발 피해, 가장 얇은 선체.',
  'ship.phantom.signature':
    '은신 — 4초 동안 피격되지 않으면 적의 조준 대상에서 빠집니다. 은신을 푸는 첫 타는 피해가 2.5배입니다.',
  'ship.hatchling.name': '해츨링',
  'ship.hatchling.role': '무리를 부화시키는 소환형. 가장 빠른 연사와 가장 넓은 트리, 가장 약한 단발.',
  'ship.hatchling.signature':
    '부화 — 적을 처치하면 둥지가 차고 요구치를 채우면 병아리 드론이 스스로 출격합니다. 요구치는 12처치에서 시작해 누적 60처치마다 4씩 오르며 40에서 멈춥니다.',
  'ship.mallow.name': '말로우',
  'ship.mallow.role': '충격을 삼키는 완충형. 선체 성장률이 가장 크고, 한 방의 위력은 가장 약합니다.',
  'ship.mallow.signature':
    '완충 — 피격 피해의 35%는 즉시 들어가지 않고 지연분으로 적립됩니다. 3초 동안 맞지 않으면 적립된 지연분의 60%가 회복됩니다.',
  'ship.bubble.name': '버블',
  'ship.bubble.role': '막을 두르고 떠다니는 유격형. 가장 빠른 탄과 가장 넓은 수집, 가장 얇은 선체.',
  'ship.bubble.signature':
    '거품 방막 — 7초마다 피해 60을 흡수하는 막이 생깁니다. 막이 터지면 반경 220 안의 적을 밀어냅니다.',

  'champion.title': '기체 고르기',
  // 챔피언 선택 도움말(사용자 요청 2026-08-05). 용어는 KO 정본표를 따른다 — `기체 타입` ·
  // `시그니처 패시브`(고유 스킬 ✗) · `액티브 스킬`(단독 `액티브` ✗) · `퇴역` · `수호기` ·
  // `사연`. 이모지 금지, 존댓말.
  'champion.help': '도움말',
  'champion.help.title': '기체 선택 안내',
  'champion.help.s1.h': '무엇을 고르는 것인가요',
  'champion.help.s1.b':
    '다음에 탈 기체를 고르는 화면입니다. 보유 가능 기체가 전부 열려 있어 따로 해금할 것이 없습니다.\n외형만 바뀌는 선택이 아닙니다. 기체 타입은 3계열 스킬 트리와 시그니처 패시브, 액티브 스킬 6종, 기본 스탯 보정, 외형을 전부 고유하게 가집니다. 모든 타입이 공유하는 것은 장비 8슬롯과 이동, 판정점, 조작입니다.',
  'champion.help.s2.h': '무엇이 이어지고 무엇이 이어지지 않나요',
  'champion.help.s2.b':
    '장비는 이어집니다. 8슬롯이 기체 타입과 무관하게 같아서, 세대를 거듭해도 파밍한 것이 계속 쓰입니다.\n스킬 투자는 이어지지 않습니다. 트리가 기체 타입 소유라, 새 기체는 레벨 1에서 자기 트리를 처음부터 채우게 됩니다.\n계보는 이어지고 초기화되지 않습니다. 계보에서 산 강화는 이 기체의 첫 런부터 그대로 적용됩니다.',
  'champion.help.s3.h': '교체는 곧 퇴역입니다',
  'champion.help.s3.b':
    '새 기체를 고르면 지금 기체가 퇴역합니다. 그래서 레벨 100에 닿기 전까지는 버튼이 잠겨 있습니다. 퇴역한 기체는 장착 장비를 안에 품은 채 수호기가 됩니다.\n퇴역은 계보 포인트를 지급하고, 그 기체는 방어 기지에 설 수 있습니다. 잃는 것이 아니라 순환의 다음 단계입니다. 다만 되돌릴 수 없어 그 기체가 현역으로 돌아오지는 않습니다.',
  'champion.help.s4.h': '시그니처 패시브와 사연',
  'champion.help.s4.b':
    '기준 섀시를 제외한 모든 타입은 항상 켜져 있는 시그니처 패시브를 가집니다. 투자 대상이 아니며, 두 기체를 가르는 가장 뚜렷한 차이이므로 결정 전에 꼭 읽어 보세요.\n기체마다 그 패시브가 왜 생겼는지 설명하는 3챕터짜리 사연도 있습니다. 챕터 1은 처음부터 여기서 읽으실 수 있고, 나머지는 플레이하면서 열려 기록 보관소에 쌓입니다.',
  'champion.roster': '보유 가능 기체',
  'champion.rosterSub': '모든 기체가 열려 있습니다 — 해금 조건이 없습니다.',
  'champion.confirm': '퇴역하고 {name}(으)로 교체',
  'champion.current': '현재 기체: {name}',
  'champion.signature': '시그니처',
  'champion.signature.none': '시그니처 패시브가 없습니다 — 보정 없는 기준 섀시입니다.',
  'champion.chassis': '섀시 보정',
  // '피해'·'연사' 는 좁은 청사진 칩 폭에 맞춘 의도적 축약이다('피해량'·'연사 속도'의 통일 대상 아님).
  // 'maxHp'='선체' 는 EN 이 'Hull' 이라 그대로다 — 'HP' 자리의 '체력' 과 갈리는 것이 정상이다.
  'champion.bp.damage': '피해',
  'champion.bp.fireRate': '연사',
  'champion.bp.maxHp': '선체',
  'champion.bp.moveSpeed': '이동',
  'champion.chassis.now': '현재',
  'champion.chassis.pick': '선택',
  'champion.role': '전투 역할',
  'champion.trees': '스킬 계열',
  'champion.tree.meta': '노드 {n}개 · {g}pt 로 2티어 액티브 해금',
  'champion.retire.title': '기체를 퇴역시킬까요?',
  'champion.retire.body':
    '현재 기체(Lv {level})가 수호기로 넘어갑니다. 레벨·스킬 포인트·장착 슬롯이 초기화되고, 장착한 장비는 그 수호기에 잠긴 채 소멸시킬 때에만 창고로 돌아옵니다. 새 {name}(으)로 출격하게 됩니다.',
  'champion.retire.yes': '퇴역하고 교체',
  'champion.retire.no': '취소',
  'champion.retire.warn':
    '교체하면 현역 기체가 퇴역합니다. 레벨과 스킬 투자가 초기화되고, 장착한 장비는 남는 수호기에 잠깁니다.',
  'champion.retire.needMaxLevel': '퇴역은 만렙(Lv {required})부터 가능합니다. 현역 기체: Lv {level}.',

  // --- 예비역 수호기 로스터·소멸(ADR-0024 Task #8) ---
  'guardians.title': '예비역 수호기',
  // 예비역 로스터 도움말(사용자 요청 2026-08-05). 용어는 KO 정본표를 따른다 — `수호기` ·
  // `퇴역` · `소멸`(분해·폐기 ✗) · `전투력`(화면 라벨 `guardians.detail.score`) · `창고`(장비) · `풍화`.
  // ⚠️ 수호기가 닳는 값은 `성능`(`guardians.perf`)이지 `정비도`가 아니다 — `정비도`(`def.maint.label`)는
  //    기지 전체의 별개 지표이고 크레딧으로 회복된다. `guardianBridge.ts` 가 둘을 명시적으로 갈라 놨다.
  // ⚠️ 수호기 풍화에는 **배치 조건이 없다**(`20260717110000_m4_phase_e_weathering.sql` 의
  //    `where not retired and performance > 50`). "안 쓰면 보존된다"고 쓰면 거짓 안전을 파는 것이다.
  // 이모지 금지, 존댓말.
  'guardians.help': '도움말',
  'guardians.help.title': '예비역 수호기 안내',
  'guardians.help.s1.h': '수호기란 무엇인가요',
  'guardians.help.s1.b':
    '수호기는 퇴역시킨 기체입니다. 퇴역은 레벨 100에서만 가능하며, 그 기체는 장착하고 있던 장비를 품은 채로 남습니다. 장비는 창고로 돌아오지 않고 기체 안에 잠깁니다.\n수호기는 그냥 진열되는 기념품이 아닙니다. 방어 기지의 코어방에 배치할 수 있고, 계보의 수호 가지가 보유한 수호기 전원을 한꺼번에 강화합니다.',
  'guardians.help.s2.h': '소멸',
  'guardians.help.s2.b':
    '소멸은 수호기를 해체하는 것입니다. 계보 포인트를 회수하고, 안에 잠겨 있던 장비가 창고로 돌아옵니다.\n돌려받는 포인트는 퇴역 시점에 기록된 전투력에 지금 남은 성능을 곱한 값입니다. 전투력에는 장비 등급과 어픽스 가치, 스킬 빌드가 모두 반영됩니다. 강하게 키워 퇴역시킨 기체일수록 많이 돌아오고, 성능이 닳을수록 회수액은 줄어듭니다.\n소멸은 저절로 일어나지 않습니다. 직접 고르기 전까지 수호기는 이 목록에 그대로 남아 있고, 한 번 소멸시키면 되돌릴 수 없습니다.',
  'guardians.help.s3.h': '수호기는 가만히 둬도 닳습니다',
  'guardians.help.s3.b':
    '수호기의 성능은 배치 여부와 무관하게 매주 조금씩 떨어집니다. 이 목록에 모셔 두기만 해도 닳으며, 바닥까지 내려가면 더 내려가지는 않습니다.\n수호기는 정비가 안 되는 예외입니다. 한 번 닳은 성능은 되돌릴 수 없고 회수액도 남은 성능에 비례하므로, 회수를 미룰수록 돌려받는 몫이 줄어듭니다.',
  'guardians.help.s4.h': '순환에서 수호기가 서는 자리',
  'guardians.help.s4.b':
    '퇴역하고, 소멸시키고, 투자합니다. 퇴역이 계보 포인트를 먼저 지급하고, 소멸이 더 이상 필요 없는 기체에서 남은 몫을 회수하며, 격납고의 계보가 그 포인트로 앞으로의 모든 기체에 적용될 영구 강화를 삽니다.\n소멸은 안에 잠긴 장비도 함께 풀어 줍니다. 그래서 오래된 수호기는 그 안의 장비가 다시 쓸 만해 보일 때 한 번씩 들여다볼 가치가 있습니다.',
  'guardians.empty': '아직 수호기가 없습니다. 기체를 퇴역시키면 예비역으로 남습니다.',
  'guardians.perf': '성능 {pct}%',
  'guardians.gear': '잠긴 장비 {n}개',
  'guardians.recover': '회수 {points}pt',
  'guardians.dismiss': '소멸',
  'guardians.dismiss.title': '수호기를 소멸시킬까요?',
  'guardians.dismiss.confirm':
    '{name} — 이 수호기를 소멸시킬까요? 잠긴 장비 {gear}개가 창고로 돌아오고 계보 {points}pt 를 회수합니다. 되돌릴 수 없습니다.',
  'guardians.cancel': '취소',
  'guardians.dismissed': '장비 {n}개 창고 회수 · 계보 {points}pt 회수',
  // 상세 패널(2026-08-02 AAA 시네마틱 전환)
  'guardians.lineage.title': '계보 포인트',
  'guardians.lineage.use': '수호기를 소멸시켜 회수하고, 계보 투자에 씁니다.',
  'guardians.detail.title': '선택한 수호기',
  'guardians.detail.empty': '목록에서 수호기를 고르면 소멸 시 무엇이 돌아오는지 여기에 나옵니다.',
  'guardians.detail.perf': '남은 성능',
  'guardians.detail.score': '전투력',
  'guardians.detail.gear': '잠긴 장비',
  'guardians.detail.recover': '소멸 시 회수',
  'guardians.detail.gearTitle': '창고로 돌아오는 장비',
  'guardians.detail.gearNone': '잠긴 장비가 없습니다.',
  'guardians.detail.warn':
    '소멸은 되돌릴 수 없습니다. 이 수호기는 완전히 사라지고 다시는 기지 방어에 나설 수 없습니다.',

  // --- 계보 전당(ADR-0007) ---
  'lineage.title': '계보',
  // 계보 전당 도움말(사용자 요청 2026-08-05). 용어는 KO 정본표를 따른다 — `계보 포인트`
  // (수호 포인트·명성 ✗) · `퇴역` · `소멸` · `수호기`. 이모지 금지, 존댓말.
  'lineage.help': '도움말',
  'lineage.help.title': '계보 안내',
  'lineage.help.s1.h': '이 화면은 무엇을 하는 곳인가요',
  'lineage.help.s1.b':
    '계보는 특정 기체가 아니라 계정에 붙는 영구 트리입니다. 여기에 투자한 것은 앞으로 타게 될 모든 기체 세대에 계속 적용됩니다.\n계보 포인트를 쓸 수 있는 유일한 곳이기도 합니다. 포인트는 기체를 퇴역시킬 때 지급되고, 수호기를 소멸시킬 때 회수됩니다.',
  'lineage.help.s2.h': '기체 가지와 수호 가지',
  'lineage.help.s2.b':
    '기체 가지는 지금 타고 있는 현역 기체를 강화합니다. 출격할 때마다 자동으로 반영됩니다.\n수호 가지는 보유한 수호기 전원을 한꺼번에 강화합니다. 내 방어 기지에 서는 것이 바로 그 수호기들입니다.\n어느 쪽이든 무한히 투자할 수 있지만 효과는 로그 곡선이라 상한으로 수렴합니다. 각 가지의 막대는 지금 수치를 보여 주고, 다음 레벨의 증가분을 옅은 예고 구간으로 겹쳐 이번 투자가 무엇을 사는지 눈으로 가늠하실 수 있게 합니다.',
  'lineage.help.s3.h': '투자는 되돌릴 수 없습니다',
  'lineage.help.s3.b':
    '계보에는 리스펙이 없습니다. 연구소의 스킬 트리와 달리, 한 가지에 쓴 포인트는 영영 그 가지에 묶입니다.\n그래서 투자할 때마다 확인을 한 번 더 받습니다. 형식적인 절차가 아니니 어느 가지에 얼마를 넣는지 보시고 확정해 주세요.',
  'lineage.help.s4.h': '마일스톤',
  'lineage.help.s4.b':
    '수호 가지에는 마일스톤 3종이 있습니다. 따로 살 것 없이 레벨에 도달하기만 하면 열립니다. 같은 수치가 더 붙는 것이 아니라 질적인 능력이 붙기 때문에, 완만한 보너스 곡선만 봐서는 다음 마일스톤이 가까워졌는지 알 수 없습니다.\n오른쪽 아래 패널에 무엇이 열렸고 다음 것에 무엇이 필요한지 적혀 있습니다. 그 가지에 계속 투자할 이유의 절반이 여기 있는 경우가 많습니다.',
  'lineage.branches.title': '계보 가지',
  'lineage.branch.ship': '기체 가지',
  'lineage.branch.ship.desc': '지금 타는 기체를 강화합니다. 이후 모든 세대의 기체에 그대로 이어집니다.',
  'lineage.branch.guardian': '수호 가지',
  'lineage.branch.guardian.desc':
    '기지를 지키는 모든 수호기를 강화합니다. 지금 예비역에 있는 기체도, 앞으로 남길 기체도 함께입니다.',
  'lineage.level': '누적 레벨 {lv}',
  'lineage.next': '다음 레벨 +{pct}% (+{delta}%p)',
  'lineage.cost': '{cost}pt',
  'lineage.cap': '상한 +{pct}%',
  'lineage.invest': '투자',
  'lineage.short': '{need}pt 부족',
  'lineage.sunk': '이 가지에 이미 {pt}pt 를 넣었습니다 — 되돌릴 수 없습니다.',
  // 서버 권위(ADR-0007) — 오프라인이면 잠근다.
  'lineage.offline': '오프라인 — 계보는 서버가 필요합니다',
  'lineage.busy': '서버에 확인하는 중…',
  'lineage.failed': '서버가 확정하지 않았습니다. 차감된 것은 없습니다.',
  'lineage.invested': '{name} 누적 레벨 {lv} 달성 · {cost}pt 소비',
  'lineage.points.title': '계보 포인트',
  'lineage.points.use': '기체를 퇴역시키거나 수호기를 소멸시켜 모읍니다.',
  'lineage.points.warn':
    '투자는 되돌릴 수 없습니다. 리스펙이 없어 한 가지에 쓴 포인트는 영영 그 가지에 남습니다.',
  'lineage.confirm.title': '계보에 투자할까요?',
  'lineage.confirm.body':
    // 가지 이름은 둘 다 "가지"로 끝나 받침이 없다 — 로스터처럼 "을(를)" 로 둘 이유가 없다.
    '{name}를 누적 레벨 {lv}(으)로 올릴까요? {cost}pt 를 쓰고 보너스는 +{pct}%가 되고 {left}pt 가 남습니다. 리스펙이 없어 되돌릴 수 없습니다.',
  'lineage.confirm.yes': '투자하기',
  'lineage.cancel': '취소',
  // 마일스톤 — 수호 가지 레벨 도달 시 자동 해금(별도 투자 없음).
  'lineage.ms.title': '수호 가지 마일스톤',
  'lineage.ms.req': '레벨 {lv}',
  'lineage.ms.remain': '레벨 {lv} · {n} 남음',
  'lineage.ms.unlocked': '해금됨',
  'lineage.ms.reboot': '격추 재기동',
  'lineage.ms.reboot.desc': '격추된 수호기가 방어전마다 한 번 부활합니다.',
  'lineage.ms.coreGuard': '코어 근접 수비',
  'lineage.ms.coreGuard.desc': '코어 가까이에서 수호기의 피해량이 오르고 연사가 빨라집니다.',
  'lineage.ms.shieldShare': '보호막 공유',
  'lineage.ms.shieldShare.desc': '방어전 시작 시 코어와 포탑이 수호기 전투력에 비례한 보호막을 받습니다.',

  // --- 서사(스토리) — 사연·인트로·기록 파편 (ADR-0023) ---
  // 인트로 슬라이드
  'intro.collapse.title': '오스카 문명의 붕괴',
  'intro.collapse.body':
    '아득한 옛날, 오스카 문명은 자신이 만든 모든 것을 기록으로 남겼다 — 그리고 단 하루 만에 침묵 속으로 사라졌다. 그들의 도시는 먼지가 되었다. 그들의 설계도는 그러지 않았다.',
  'intro.records.title': '기록만이 유일한 화폐',
  'intro.records.body':
    '폐허 속에서 아직 가치를 지닌 것은 단 하나, 기록이다. 봉인된 설계, 잃어버린 지식의 조각. 가장 많이 모으는 자가 기록 보관소의 공적부에서 가장 높이 오른다.',
  'intro.archives.title': '봉인된 여섯 세계',
  'intro.archives.body':
    '오스카는 자신의 지식을 여섯 아카이브 행성에 봉인했고, 그 하나하나를 한 번도 꺼진 적 없는 시스템이 지킨다. 파일럿들은 그곳으로 몰려들고 — 서로의 금고를 침공해, 원본은 건드리지 않은 채 기록을 복제해 간다.',
  'intro.launch.title': '이제 당신이 출격할 차례',
  'intro.launch.body':
    '당신에겐 기체 한 대와 텅 빈 항해일지, 그리고 아직 아무도 들어보지 못한 이름이 있다. 공적부는 열려 있다. 가서 그것이 당신을 기억하게 만들어라.',
  'intro.skip': '건너뛰기',
  'intro.next': '다음',
  'intro.begin': '시작',

  // 기록 보관소 화면 크롬
  'archive.title': '기록 보관소',
  'archive.subtitle': '당신이 밝혀낸 이야기와 비밀들.',
  'archive.tab.stories': '파일럿 파일',
  'archive.tab.shards': '기록 파편',
  'archive.list.head': '기록 목록',
  'archive.detail.head': '기록 열람',
  'archive.detail.empty': '왼쪽 목록에서 항목을 선택하세요.',
  'archive.stories.progress': '사연 {n} / {total}장 해금',
  'archive.story.progress': '{n} / {total}장 해금',
  'archive.shards.progress': '기록 파편 {n} / {total} 수집',
  'archive.shards.locked': '아직 수집하지 못했습니다. 에코 신호를 안정화해 찾아내세요.',
  'archive.story.locked': '잠김',
  'archive.story.chapter': '{n}장',
  'archive.intro.replay': '프롤로그 다시 보기',
  'archive.empty': '아직 아무것도 없습니다.',

  // 기록 보관소 도움말(사용자 요청 2026-08-05). 용어는 KO 정본표를 따른다 — `사연`·`기록 파편`·
  // `에코 신호`·`조우`·`시그니처 패시브`. 이모지 금지, 존댓말.
  'archive.help': '도움말',
  'archive.help.title': '기록 보관소 안내',
  'archive.help.s1.h': '이 화면은 무엇을 하는 곳인가요',
  'archive.help.s1.b':
    '이 은하에 대해 밝혀낸 것이 전부 여기에 모입니다. 읽기 위한 화면이며, 이 화면의 무엇도 런의 수치를 바꾸지 않습니다. 스탯도, 보상도, 전투에 영향을 주는 해금도 없습니다.\n두 탭에 서로 다른 두 종류의 기록이 들어 있습니다. 파일럿 파일과 기록 파편입니다.',
  'archive.help.s2.h': '파일럿 파일',
  'archive.help.s2.b':
    '기체 타입마다 3챕터짜리 사연이 붙어 있습니다. 챕터 1은 처음부터 열려 있고, 챕터 2는 그 기체의 인연 행성을 클리어하면, 챕터 3은 시그니처 마일스톤을 달성하면 열립니다.\n사연은 그 기체가 왜 그런 시그니처 패시브를 가졌는지를 설명하기 위해 있습니다. 이름이 붙은 전속 파일럿이 있는 기체도 있고, 유기체형 기체는 기체 자신이 곧 그 인물입니다.',
  'archive.help.s3.h': '기록 파편',
  'archive.help.s3.b':
    '기록 파편은 사라진 오스카 문명의 조각입니다. 런 도중 드물게 나타나는 에코 신호를 안정화하면 얻습니다. 에코 신호는 서사형 조우입니다.\n조우는 들어갈지 말지 직접 고르는 것입니다. 무시하면 아무 손해 없이 런을 이어 가고, 들어가면 사망까지 포함한 실제 위험을 감수하는 대신 큰 보상을 노립니다. 아직 찾지 못한 파편은 숨겨지지 않고 잠긴 채로 보이므로, 무엇이 남았는지 알 수 있습니다.',
  'archive.help.s4.h': '기록은 어떻게 쌓이나요',
  'archive.help.s4.b':
    '여기 있는 것들은 사서 얻는 것도, 따로 파밍해서 얻는 것도 아닙니다. 행성을 클리어하고 마일스톤을 채우고 조우를 선택해 들어가는 과정에서 부수적으로 쌓입니다.\n프롤로그는 이 화면에서 언제든 다시 보실 수 있습니다.',

  // 챔피언 선택 화면 — 사연 열람 버튼/팝업
  'champion.story.open': '사연 읽기',
  'champion.story.title': '{name} — 파일럿 파일',

  // 출격 기체 선택(예비역 소집, ADR-0024) — 관제탑 침공 시작 팝업
  'sortie.title': '출격 기체 선택',
  'sortie.sub': '활성 기체로 출격하거나, 퇴역한 수호 기체를 소집해 대신 출격시킵니다.',
  'sortie.active': '현역 기체 · 성능 100%',
  'sortie.guardian': '예비역',
  'sortie.perf': '성능 {n}%',
  'sortie.gear': '잠긴 장비 {n}개',
  'sortie.launch': '출격',

  // 사연 — 스트라이커
  'story.striker.tagline': '항해일지가 텅 빈 파일럿.',
  'story.striker.ch1.title': '내세울 기록 하나 없이',
  'story.striker.ch1.body':
    '당신은 아무것도 기록하지 못한 세계 출신이다 — 설계도 하나, 기념비 하나, 기록 보관소가 굳이 정리해 둘 이름 하나 남기지 못한 사람들. 스트라이커는 이렇다 할 시그니처 재주 하나 없는 평범한 기체다. 그게 요점이다: 당신의 이야기는 아직 쓰이지 않았다.',
  'story.striker.ch2.title': '첫 줄',
  'story.striker.ch2.body':
    '카르곤의 용암 금고는 당신이 어디서 왔는지 따위 신경 쓰지 않는다. 그래도 당신은 그곳을 클리어했고, 처음으로 공적부에 당신의 콜사인이 적힌 한 줄이 남았다. 짧은 한 줄이다. 그래도 당신의 것이다.',
  'story.striker.ch3.title': '기록에 남길 만한 사람',
  'story.striker.ch3.body':
    '열두 번의 승리를 거두자, 다른 파일럿들이 당신의 이름을 제대로 부르기 시작했다. 당신의 문명 전체를 무시했던 기록 보관소가 이제 당신 앞으로 폴더 하나를 둔다. 기억되는 길은 기록을 물려받는 것이 아니라 — 만들어내는 것이었다.',
  'story.striker.quest.ch2': '당신의 첫 시험장 카르곤을 한 번 이상 클리어하세요.',
  'story.striker.quest.ch3': '공적부가 당신 이름을 제대로 적을 만큼 런에서 승리하세요.',

  // 사연 — 브루저
  'story.bruiser.tagline': '그는 그들의 이름을 싣고 매 전투에 나선다.',
  'story.bruiser.ch1.title': '장갑판에 새긴 이름들',
  'story.bruiser.ch1.body':
    '브루저는 삼십 년간 수송선단을 호위했고, 한 번 잃었다. 그는 자신이 지켜낸 배들 이야기는 하지 않는다, 지키지 못한 그 한 척 이야기만 한다. 그의 선체 장갑판마다 그 잃어버린 선단의 이름이 하나씩 새겨져 있다.',
  'story.bruiser.ch2.title': '크라스는 무게를 기억한다',
  'story.bruiser.ch2.body':
    '크라스는 공성과 잔해의 세계이고, 되받아치는 힘이 거세다. 브루저는 일부러 그 안으로 걸어 들어갔다 — 타격이 무거울수록 더 많은 이름을 떠올릴 수 있으니까. 그는 더 느려지고 찌그러진 채, 그래도 제 발로 걸어 나왔다.',
  'story.bruiser.ch3.title': '빈 장갑판 하나 없이',
  'story.bruiser.ch3.body':
    '충분히 얻어맞으면 선체 전체가 뒤덮인다 — 맨 장갑판 하나 남지 않고, 모든 이름이 제자리를 얻는다. 장갑 스택은 방어 재주가 아니다. 그것은 한 대 맞을 때마다 한 명씩, 소리 내어 부르는 점호다.',
  'story.bruiser.quest.ch2': '공성의 세계 크라스를 한 번 이상 클리어하세요.',
  'story.bruiser.quest.ch3': '장갑판에 마지막 이름까지 새길 만큼 피격을 견뎌내세요.',

  // 사연 — 아크 캐스터
  'story.arccaster.tagline': '움직이며 쏘는 건 그냥 낙서다.',
  'story.arccaster.ch1.title': '광선 조각가',
  'story.arccaster.ch1.body':
    '아크 캐스터는 움직이며 쏘는 것은 끄적임일 뿐이고, 진짜 예술은 발을 딱 붙이고 섰을 때만 나온다고 우긴다. 평론가들은 이걸 허세라 부른다. 아크 캐스터는 그 평론가들을 「너무 많이 움직이는 사람들」이라 부른다.',
  'story.arccaster.ch2.title': '걸작의 금고',
  'story.arccaster.ch2.body':
    '아르케는 오스카의 수도 아카이브로, 가장 뛰어난 봉인 설계들이 보관된 곳이다 — 아크 캐스터는 아주 오래전부터 그것을 한 번 보고 싶어 했다. 빗발치는 포화 속에 완벽히 멈춰 선 채, 금고로 곧장 이어지는 길을 조각해냈다. 아름다웠다, 본인 말로는.',
  'story.arccaster.ch3.title': '과충전된 완성',
  'story.arccaster.ch3.body':
    '충분히 오래 멈춰 있으면 광선은 무기이길 그만두고 서명이 된다. 과충전은 인내가 아니라, 작품을 뭉개지 않겠다는 거부다. 수백 점의 완성작을 남긴 뒤엔, 회의론자들조차 조용해졌다.',
  'story.arccaster.quest.ch2': '수도 아카이브 아르케를 한 번 이상 클리어하세요.',
  'story.arccaster.quest.ch3': '과충전 상태로 충분히 처치해 예술가라는 칭호를 얻으세요.',

  // 사연 — 팬텀
  'story.phantom.tagline': '기록 보관소가 보관하길 잊은 파일럿.',
  'story.phantom.ch1.title': '파일을 찾을 수 없음',
  'story.phantom.ch1.body':
    '오스카가 무너질 때 한 기록이 삭제됐다 — 손상된 게 아니라, 삭제됐다, 깔끔하게, 마치 누군가 작정한 것처럼. 팬텀은 한 존재 전체가 등재되지 못한 채 지워졌을 때 남는 것이다. 은신막 아래의 얼굴을 아무도 기억하지 못한다, 그리고 대개의 밤엔, 팬텀 자신도 그렇다.',
  'story.phantom.ch2.title': '차가운 흔적',
  'story.phantom.ch2.body':
    '니플헤임은 유령선과 죽은 신호의 얼어붙은 세계로, 팬텀 자신의 기록이 온전히 목격된 마지막 장소다. 은신한 채 소리 없이, 모든 수호자를 지나쳐 금고에 닿았다. 원하던 파일은 사라지고 없었다. 더 나쁜 것이 남아 있었다: 그 삭제가 요청된 것이었다는 기록.',
  'story.phantom.ch3.title': '기억하게 만드는 일격',
  'story.phantom.ch3.body':
    '은신막이 통하는 건 조준할 대상이 없기 때문이다 — 지워진 사람에게는 락온이 걸리지 않는다. 하지만 은신을 끝내는 그 한 발은, 우주가 문득 당신의 존재를 떠올린 것처럼 내리꽂힌다. 몇 번이고, 누군가는 그것이 중요해지기 반 초 전에 팬텀의 이름을 알게 된다.',
  'story.phantom.quest.ch2': '당신의 기록이 마지막으로 목격된 니플헤임을 한 번 이상 클리어하세요.',
  'story.phantom.quest.ch3': '은신을 끝내는 일격을 충분히 꽂아, 잠깐이라도 기억되세요.',

  // 사연 — 해츨링
  'story.hatchling.tagline': '그녀는 집으로 가는 길을 찾고 있다.',
  'story.hatchling.ch1.title': '마지막 부화장',
  'story.hatchling.ch1.body':
    '해츨링은 살아있는 함선이고, 부화장 세계가 어둠에 잠기기 전에 그곳을 떠난 유일한 하나다. 그녀의 새끼들은 선체 안에 타고 있는데, 자기들이 태어난 하늘을 기억하기엔 너무 어리다. 그녀는 언젠가 그 하늘을 보여주려고 계속 날아간다.',
  'story.hatchling.ch2.title': '초록빛 좌표',
  'story.hatchling.ch2.body':
    '베르단은 잠들지 않는 세계로, 아카이브는 굳게 지켜지고 하늘은 수호자들로 빽빽하다. 그 안 깊숙이 성도(星圖)가 묻혀 있다 — 부화장들의 지도, 그중 하나가 어쩌면 집일지도 모른다. 해츨링은 그것을 향해 뚫고 들어갔다. 좌표는 일부뿐이었다. 그래도 어제보다는 많다.',
  'story.hatchling.ch3.title': '스스로 나는 새끼들',
  'story.hatchling.ch3.body':
    '처치할 때마다 둥지가 조금씩 차오르고, 가득 차면 병아리 한 마리가 스스로 출격한다 — 이제는 안에 숨는 대신 그녀 곁에서 싸울 만큼 자랐다. 수백 번의 출격을 지나, 어린것들은 따라오는 만큼 앞장선다. 집이 결국 어디로 밝혀지든, 그들은 함께 도착할 것이다.',
  'story.hatchling.quest.ch2': '성도가 봉인된 베르단을 한 번 이상 클리어하세요.',
  'story.hatchling.quest.ch3': '새끼들을 충분히 출격시켜 스스로 나는 편대를 길러내세요.',

  // 사연 — 말로우
  'story.mallow.tagline': '주먹을 푸딩으로 바꾼다.',
  'story.mallow.ch1.title': '단것 애호가',
  'story.mallow.ch1.body':
    '말로우는 부드럽고 둥근 살아있는 함선으로, 연구하는 기술자마다 어리둥절하게 만드는 재주를 지녔다: 한 대 맞으면, 그걸 머금었다가, 어떻게든 설탕으로 되돌려준다. 아무도 방법을 모른다. 말로우는 설명하지 않는다 — 입이 꽉 차 있어서.',
  'story.mallow.ch2.title': '봉인된 레시피',
  'story.mallow.ch2.body':
    '톡사르는 부식과 부패의 세계라, 디저트를 찾기엔 이상한 곳이다. 하지만 오스카는 자신의 최고 레시피를 그곳에 봉인했고, 말로우는 그 부패를 뚫고 냄새를 맡았다. 금고까지 먹어 치우며 길을 냈다. 그럴 만했다.',
  'story.mallow.ch3.title': '천 번의 단맛',
  'story.mallow.ch3.body':
    '말로우가 완충한 모든 타격은 적립되고, 부드러워졌다가, 회복으로 되돌아온다 — 아픔이 들어가고, 달콤함이 나온다. 지금까지 삼켜 소화한 아픔이 수만에 이른다. 최고의 디저트는 애초에 금고에 있던 게 아니었다. 무엇이든 맛있게 만드는 그 재주였다.',
  'story.mallow.quest.ch2': '레시피가 봉인된 톡사르를 한 번 이상 클리어하세요.',
  'story.mallow.quest.ch3': '피해를 충분히 완충하고 회복해 가장 달콤한 레시피를 완성하세요.',

  // 사연 — 버블
  'story.bubble.tagline': '터지는 게 너무 무서웠다.',
  'story.bubble.ch1.title': '터짐이 두려워',
  'story.bubble.ch1.body':
    '버블은 말 그대로다: 작고, 떠다니는 막 한 겹짜리 함선으로, 비눗방울이 하는 바로 그 한 가지를 두려워한다. 오랫동안 그것은 모든 전투의 맨 뒤에 매달려, 숨을 참으며, 터지지 않기만을 바랐다.',
  'story.bubble.ch2.title': '카르곤이 터지는 법을 가르쳤다',
  'story.bubble.ch2.body':
    '카르곤의 불길은 숨을 곳을 거의 허락하지 않고, 어느 날 버블은 터졌다 — 그리고 그 충격파가 막 맞으려던 동료에게서 적을 밀쳐냈다. 버블은 방금 위험이 있던 자리를 바라보았다. 아. 터진다는 건 이럴 때 쓰는 거구나.',
  'story.bubble.ch3.title': '삼백 번의 파열',
  'story.bubble.ch3.body':
    '이제 버블은 몇 초마다 막을 다시 만들고 일부러 터뜨려, 뒤에 선 누구에게서든 위험을 밀쳐낸다. 수백 번의 파열을 지나, 그것은 더 이상 두렵지 않다. 누군가를 지키려 터지는 비눗방울은 사라지는 게 아니다 — 자기가 할 일을 정확히 해낸 것이다.',
  'story.bubble.quest.ch2': '당신이 처음 터지는 법을 배운 카르곤을 한 번 이상 클리어하세요.',
  'story.bubble.quest.ch3': '막을 충분히 터뜨려 더 이상 그것을 두려워하지 않게 되세요.',

  // 기록 파편 도감
  'shard.first-archive.title': '파편: 최초의 아카이브',
  'shard.first-archive.body':
    '오스카의 가장 첫 기록은 무기도 도시도 아니었다. 그것은 약속이었다: "우리가 만든 것은 무엇도 결코 완전히 사라지지 않는다." 그들은 그 약속을 지켰다. 자기 자신은 지키지 못했다.',
  'shard.the-curators.title': '파편: 큐레이터들',
  'shard.the-curators.body':
    '아카이브 행성들은 큐레이터들이 돌봤다 — 기록을 영원히 지키도록 만들어진 자동 관리자들. 그 「영원」은 누구도 설계해 두지 않은 길이였다. 큐레이터들은 여전히 근무 중이고, 애초에 누군가를 들여보내도록 되어 있었다는 사실을 잊었다.',
  'shard.overflow.title': '파편: 과적',
  'shard.overflow.body':
    '후기 기록들은 다급해진다: 저장할 것은 너무 많고, 시간은 너무 없다. 오스카는 결코 보관해선 안 될 것들까지 저장하기 시작했다 — 한 파편이 암시하기로는, 자신들을 끝장낸 무언가의 설계까지도.',
  'shard.the-silence.title': '파편: 침묵',
  'shard.the-silence.body':
    '전쟁도, 역병도, 충돌도 없었다. 어느 날 송신이 그냥 멈췄다, 문장 한가운데서, 모든 세계에서 동시에. 기록 보관소는 그 침묵을 기록해야 할 사건으로 남겼다. 그러고는 그것마저 조용해졌다 — 한동안.',
  'shard.copy-of-a-copy.title': '파편: 사본의 사본',
  'shard.copy-of-a-copy.body':
    '기록은 끝없이 복제해도 원본이 상하지 않는다. 파일럿들이 파괴하지 않고 침공하는 이유이고, 공적부가 결코 잊지 않는 이유다. 오스카는 이것을 자비로 만든 것이었다. 그것은 게임이 되었다.',
  'shard.the-last-curator.title': '파편: 마지막 큐레이터',
  'shard.the-last-curator.body':
    '아르케 깊은 곳의 한 큐레이터는 여전히 말한다. 그것은 문명이 무너진 적 없다고 우긴다 — 모두가 그저 위험이 지나가길 기다리려 기록 속으로 걸어 들어갔을 뿐이며, 안전해지면 돌아올 거라고. 아주 오랫동안 그 말을 되풀이해 왔다.',
  'shard.echoes.title': '파편: 메아리',
  'shard.echoes.body':
    '이따금 런 도중에 있어선 안 될 신호가 깜빡인다 — 보낸 이가 사라진 지 오래인데도 전송을 마치려 애쓰는 떠도는 기록. 그 곁에 굳건히 머물면 신호가 안정화되며, 그것이 전하려던 말의 파편 하나를 건넨다.',
  'shard.your-name-here.title': '파편: 여기 당신의 이름',
  'shard.your-name-here.body':
    '마지막 파편은 비어 있다. 잃어버린 게 아니라 — 비어서, 기다리는 중이다. 기록 보관소는 자신이 관리하는 모든 공적부에 한 칸을 비워 둔다. 당신의 이야기가 아직 정리되는 중이라고 여기는 모양이다.',

  // 에코 신호 보상 — 안정화 로어 토스트 · 파편 획득 알림
  'echo.stabilized.toast': '에코 신호 안정화 — 잃어버린 기록이 전송을 마칩니다.',
  'shard.gained': '새 기록 파편을 획득했습니다.',

  // 도감 코스메틱 — 사연 챕터 해금 배지(챕터 2)·칭호(챕터 3)
  'cosmetic.striker-ch2.name': '첫 줄',
  'cosmetic.striker-ch3.name': '스스로 남긴 이름',
  'cosmetic.bruiser-ch2.name': '크라스의 무게',
  'cosmetic.bruiser-ch3.name': '이름을 새긴 자',
  'cosmetic.arccaster-ch2.name': '걸작의 금고',
  'cosmetic.arccaster-ch3.name': '광선 조각가',
  'cosmetic.phantom-ch2.name': '차가운 흔적',
  'cosmetic.phantom-ch3.name': '기억하게 만드는 일격',
  'cosmetic.hatchling-ch2.name': '초록빛 좌표',
  'cosmetic.hatchling-ch3.name': '무리의 어미',
  'cosmetic.mallow-ch2.name': '봉인된 레시피',
  'cosmetic.mallow-ch3.name': '천 번의 단맛',
  'cosmetic.bubble-ch2.name': '첫 파열',
  'cosmetic.bubble-ch3.name': '두렵지 않은 막',

  'refine.title': '정제소',
  'refine.bar.minerals': '광물',
  'refine.bar.credits': '크레딧',
  'refine.listHeader': '보유 장비 ({n})',
  'refine.noItems': '어픽스가 있는 장비가 없습니다.\n행성에서 장비를 획득하세요.',
  'refine.processTitle': '정련 공정',
  'refine.selectPrompt': '왼쪽에서 장비를 선택하세요.',
  'refine.cost.normal': '리롤 비용: 광물 {n}',
  'refine.lock.alt.locked': '잠김',
  'refine.lock.alt.unlocked': '열림',
  'refine.spinning': '⟳ 정제 중…',
  'refine.rollBtn': '🎰 리롤',
  'refine.err.noMinerals': '광물이 부족합니다 (필요 {n}).',
  // 정련 공정(ADR-0040) — 노 출력·고착·용해
  'refine.chain.heat.low': '약불',
  'refine.chain.heat.mid': '중불',
  'refine.chain.heat.high': '강불',
  'refine.chain.heat.hint': '불이 셀수록 값이 잘 나오지만 비용과 용해 위험도 오릅니다',
  'refine.chain.risk': '용해 위험 {n}%',
  'refine.chain.riskNone': '용해 위험 없음',
  'refine.chain.fasten': '고착',
  'refine.chain.fastenHint': '굴린 뒤 어픽스 하나를 고착할 수 있습니다 (해제 불가)',
  'refine.chain.fastenedCount': '고착 {n}/{total}',
  'refine.chain.stop': '공정 멈추기',
  'refine.chain.rollBtn': '굴리기',
  'refine.chain.cost': '굴림 비용: 광물 {n}',
  'refine.chain.melted': '용해 — 고착이 전부 풀렸습니다',
  'refine.chain.complete': '공정 완주 — 모든 어픽스를 고착했습니다',
  'refine.chain.noBand': '이 어픽스는 값이 고정이라 불 세기의 영향을 받지 않습니다',
  'refine.sort.recent': '획득순',
  'refine.sort.rarity': '희귀도순',

  // 정제소 도움말(사용자 요청 2026-08-05). 용어는 이 화면의 기존 문구와 같은 낱말을 쓴다 —
  // `정련 공정`·`굴리기`·`고착`·`불 세기`(약불·중불·강불)·`용해`. 이모지 금지, 존댓말.
  'refine.help': '도움말',
  'refine.help.title': '정제소 안내',
  'refine.help.s1.h': '이 화면은 무엇을 하는 곳인가요',
  'refine.help.s1.b':
    '이미 가지고 있는 장비의 어픽스를 다시 굴리는 곳입니다. 장비 자체는 여기서 바뀌지 않습니다. 슬롯도 등급도 기저 스탯도 그대로이고, 움직이는 것은 어픽스뿐입니다.\n왼쪽 목록에서 장비를 고르면 오른쪽에 정련 공정이 열립니다.',
  'refine.help.s2.h': '굴리기',
  'refine.help.s2.b':
    '한 번 굴릴 때마다 광물이 들어가고, 아직 고착하지 않은 어픽스가 전부 다시 뽑힙니다. 정련은 한 번 사고 끝나는 거래가 아니라 마음에 들 때까지 이어 가는 공정입니다.\n공정 멈추기를 누르기 전까지는 아무것도 장비에 확정되지 않습니다.',
  'refine.help.s3.h': '고착',
  'refine.help.s3.b':
    '굴린 뒤 마음에 드는 어픽스 하나를 고착할 수 있습니다. 고착한 어픽스는 다시 뽑히지 않으므로 다음 굴림은 남은 것만 건드립니다.\n공정 안에서는 고착을 해제할 수 없고, 공정을 멈춰 확정해야 장비에 남습니다. 쌓인 고착이 곧 판돈입니다. 많이 걸어 둘수록 실패했을 때 잃는 것이 큽니다.',
  'refine.help.s4.h': '불 세기',
  'refine.help.s4.b':
    '굴릴 때마다 약불·중불·강불 중 하나를 고릅니다. 불 세기 하나가 세 가지를 한꺼번에 움직입니다. 어픽스 값의 품질, 광물 비용, 그리고 용해 위험입니다.\n불 세기는 위험을 없애는 스위치가 아니라 조절하는 다이얼입니다. 약불도 위험이 없는 것은 아닙니다. 고착이 이미 만들어 둔 위험에 더 작은 배수를 걸 뿐입니다. 값이 고정인 어픽스는 불 세기의 영향을 받지 않으며, 그런 경우에는 해당 줄이 알려 줍니다.',
  'refine.help.s5.h': '용해',
  'refine.help.s5.b':
    '굴리기에 실패하면 용해입니다. 고착이 전부 풀려 공정을 시작하기 직전 상태로 돌아갑니다. 다만 장비는 아무 손상도 입지 않습니다. 등급도, 어픽스 개수도, 장비의 존재 자체도 위험에 놓이지 않습니다. 녹는 것은 지금까지의 진행이지 장비가 아닙니다.\n실패 확률은 굴리기 전에 숫자로 보여 드립니다. 용해는 예고 없이 당하는 일이 아니라 알고 감수한 위험입니다.',
  'refine.sort.slot': '슬롯순',
  'refine.sort.affixes': '어픽스순',
  'refine.skillAffix.locked': '고착됨 · 정련 불가',
  'refine.fastenCounter': '고착 {n} / {d}',
  'refine.offSlotWarn': '이 어픽스는 이 슬롯에서 다시 나오지 않습니다 — 지키려면 고착하세요',

  'ctl.title': '관제탑',
  'ctl.sub': '상위 랭커를 정찰하고 침공하세요.',
  'ctl.verifying': '서버 검증 중… (전체 재시뮬레이션으로 결과를 확정합니다)',
  'ctl.note': '재도전 쿨다운(1시간)과 순위 스왑·복제 약탈은 서버가 강제합니다. 이 화면의 값은 서버 판정의 미러입니다.',
  'ctl.anonymous': '무명 파일럿',
  'ctl.noBase': '방어 기지 없음',
  'ctl.maintenance': '정비도 {m}%',
  'ctl.ship.unknown': '알 수 없는 기체',
  'ctl.ship.withLevel': '{name} · Lv {level}',
  'ctl.cooldown.min': '재도전까지 {n}분',
  'ctl.cooldown.h': '재도전까지 {h}시간',
  'ctl.cooldown.hm': '재도전까지 {h}시간 {m}분',
  'ctl.res.provWin': '코어 파괴(잠정 승리)',
  'ctl.res.provLose': '침공 실패(잠정)',
  'ctl.res.unsubmitted': '{who}침공 종료 · {outcome} — 서버 미설정/오프라인으로 미제출(잠정 결과)',
  'ctl.res.rejected': '{who}침공 거부됨 — 리플레이 검증 불일치(서버 권위)',
  'ctl.res.pending': '{who}침공 판정 확정 중 — 잠시 후 관제탑에서 결과를 확인하세요',
  'ctl.res.winHead': '침공 성공 — 코어 파괴',
  'ctl.res.revengeHead': '복수 성공 — 자리 탈환',
  'ctl.res.rank': ' · 새 순위 {n}위',
  'ctl.res.loot': ' · 전리품 {n}개',
  'ctl.res.bonus': ' · 보너스 광물 {n}',
  'ctl.res.winLine': '{who}{head}(서버 확정){extra}',
  'ctl.res.lose': '{who}침공 실패 — 방어 성공(서버 확정)',
  'ctl.incoming.banner': '새 침공 결과 {n}건 — 기지가 공격받았습니다',
  'ctl.incoming.fell': '기지 함락',
  'ctl.incoming.held': '방어 성공',
  'ctl.incoming.revengePrefix': '[복수] ',
  'ctl.incoming.taunt': ' · 도발: {taunt}',
  'ctl.tgt.head': '침공 대상 제안',
  'ctl.tgt.placementHead': '배치전 상대 (NPC 시드 기지)',
  'ctl.tgt.loading': '대상을 불러오는 중…',
  'ctl.tgt.completingMsg': '배치전 5회를 모두 마쳤습니다. 위의 순위 진입 버튼으로 초기 순위를 확정하세요.',
  'ctl.tgt.placementNull': '배치전 상대를 불러오지 못했습니다 — 서버 미설정 또는 오프라인. (로컬 플레이는 정상)',
  'ctl.tgt.normalNull': '서버 미설정 또는 오프라인 — 침공이 비활성입니다. (로컬 플레이는 정상)',
  'ctl.tgt.placementEmpty': '배치전 상대가 없습니다. 잠시 후 다시 시도하세요.',
  'ctl.tgt.normalEmpty': '제안할 침공 대상이 없습니다. 배치전을 마치면 순위가 잡힙니다.',
  'ctl.tgt.difficulty': '난이도 {band} · {ship}',
  'ctl.tgt.btnPlacement': '배치전',
  'ctl.tgt.btnInvade': '침공',
  'ctl.tgt.tail': '순위를 올리면 더 강한 상대가 여기에 제안됩니다.',
  'ctl.tgt.titlePlacement': '배치전 런 시작',
  'ctl.tgt.titleInvade': '침공 런 시작',
  'ctl.place.entered': '순위 진입! 배치전 성적으로 {rank}위에 배치됐습니다 (배치전 {won}승). 이제 상위 랭커에 침공할 수 있습니다.',
  'ctl.place.completeLine': '배치전 완료 — {total}전 {won}승. 순위 진입 준비 완료.',
  'ctl.place.applying': '순위 확정 중…',
  'ctl.place.enter': '순위 진입',
  'ctl.place.remaining': ' · 남은 배치전 {n}회',
  'ctl.place.hint': 'PvP 첫 관문 — NPC 시드 기지 상대로 5회를 치르면 성적에 따라 초기 순위가 잡힙니다(기존 순위 불변).',
  'ctl.notif.head': '최근 침공 결과',
  'ctl.notif.myTaunt': ' · 내 도발: {taunt}',
  'ctl.notif.tauntBtn': '도발',
  'ctl.notif.tauntTitle': '격퇴한 상대에게 도발 스티커를 남깁니다.',
  'ctl.rev.head': '복수전 — 24시간 내 되갚으세요 (쿨다운 무시)',
  'ctl.rev.badge': '쿨다운 무시',
  'ctl.rev.expired': '복수 기한 만료',
  'ctl.rev.btnExpired': '만료',
  'ctl.rev.btnNoBase': '기지 없음',
  'ctl.rev.btnRevenge': '복수 침공',
  'ctl.rev.none': '복수 창이 열린 상대가 없습니다. 기지가 함락되면 24시간 안에 되갚을 수 있습니다.',
  'ctl.rev.tail': '기지가 함락되면 그 상대가 24시간 동안 여기에 쌓입니다.',
  'ctl.ops.head': '작전 상황',
  'ctl.ops.rankHead': '내 순위',
  'ctl.recon.head': '기지 정찰',
  'ctl.recon.slice.wave': 'L1 대기권 · 편대',
  'ctl.recon.slice.socket': 'L2 회랑 · 설비',
  'ctl.recon.slice.boss': 'L3 코어방 · 보스',
  'ctl.recon.slice.prop': 'L3 코어방 · 기물',
  'ctl.recon.slice.guardian': 'L3 코어방 · 수호',
  'ctl.recon.selectPrompt': '대상을 선택하면 방어 배치를 미리봅니다.',
  'ctl.recon.noBase': '이 대상은 방어 기지가 없습니다.',
  'ctl.recon.summary3': '편대 {f}/{fm} · 설비 {s}/{sm} · 기물 {p}/{pm} · 보스 {b}',
  'ctl.ladder.head': '순위표',
  'ctl.ladder.loading': '불러오는 중…',
  'ctl.ladder.null': '서버 미설정 — 순위표를 표시할 수 없습니다.',
  'ctl.ladder.empty': '아직 순위가 없습니다.',
  'ctl.ladder.rank': '순위',
  'ctl.ladder.name': '이름',

  // 관제탑 도움말(사용자 요청 2026-08-05). 용어는 KO 정본표를 따른다 — `래더`(랭킹·리더보드 ✗) ·
  // `배치전`(예선전 ✗) · `복수전`(리벤지 매치 ✗) · `침공`(PvP) · `방어체`. 이모지 금지, 존댓말.
  'ctl.help': '도움말',
  'ctl.help.title': '관제탑 안내',
  'ctl.help.s1.h': '이 화면은 무엇을 하는 곳인가요',
  'ctl.help.s1.b':
    'PvP 의 공격 쪽입니다. 다른 파일럿의 기지를 정찰하고 침공을 거는 곳입니다. 반대로 내 기지에 쳐들어온 상대를 맞이할 배치를 짜는 일은 방어 사령부가 맡습니다.\n이 화면의 내용은 전부 서버에 있습니다. 접속돼 있지 않으면 목록이 비어 있고, 나머지 게임은 평소처럼 즐기실 수 있습니다.',
  'ctl.help.s2.h': '래더',
  'ctl.help.s2.b':
    '래더는 전체 파일럿이 한 줄로 늘어선 영구 순위표입니다. 시즌 리셋이 없으므로 한 번 차지한 순위는 누군가 빼앗아 가기 전까지 그대로 유지됩니다.\n순위를 움직이는 것은 세 가지뿐입니다. 침공에 성공하면 두 파일럿의 자리가 맞바뀌고, 배치전은 신규 파일럿을 끼워 넣으며, 오래 활동하지 않으면 서서히 내려갑니다.',
  'ctl.help.s3.h': '배치전',
  'ctl.help.s3.b':
    'PvP 가 열린 뒤 처음 다섯 번의 침공은 배치전입니다. 실제 파일럿이 아니라 NPC 시드 기지를 상대로 치릅니다. 그 다섯 판의 성적이 래더 어디쯤에서 시작할지를 정합니다.\n배치전은 기존 순위를 밀어내지 않고 끼워 넣는 방식이라, 내가 들어온다고 해서 누군가 순위를 잃지는 않습니다.',
  'ctl.help.s4.h': '침공을 걸기 전에 정찰하기',
  'ctl.help.s4.b':
    '대상을 고르면 정찰 패널에 그 기지의 방어 배치가 나옵니다. 세 레이어에 편대 슬롯과 설비, 기물이 각각 몇 칸이나 차 있는지, 코어방에 어떤 방어 보스가 앉아 있는지를 볼 수 있습니다.\n처음에는 실루엣과 등급, 승격 별까지만 보입니다. 정확한 스탯과 방어체 어픽스는 그 기지를 한 번 침공해 본 뒤에야 공개됩니다. 그래서 첫 도전은 져도 얻는 것이 있습니다.',
  'ctl.help.s5.h': '복수전',
  'ctl.help.s5.b':
    '내 기지가 함락되면 내 순위를 가져간 파일럿이 24시간 동안 복수전 목록에 올라옵니다. 복수전은 평소의 재도전 쿨다운을 무시하며, 성공하면 자리를 되찾고 보너스 광물을 받습니다.\n기한이 지나면 저절로 닫힙니다. 그냥 흘려보내도 잃는 것은 이 공짜 한 번뿐입니다.',
  'ctl.help.s6.h': '결과는 서버가 정합니다',
  'ctl.help.s6.b':
    '런이 끝나는 순간 화면에 뜨는 결과는 잠정입니다. 서버가 리플레이를 처음부터 다시 돌려 같은 결과가 나오는지 확인한 뒤에야 확정됩니다. 결과가 잠시 서버 검증 중으로 보이는 것은 그 때문입니다.\n내 기지가 받은 공격은 최근 침공 결과 목록에 쌓입니다. 거기서 리플레이를 관전하거나, 막아 낸 상대에게 도발 스티커를 남기실 수 있습니다.',
  'ctl.ladder.record': '전적',
  'ctl.ladder.wl': '{w}승 {l}패',
  // 관제탑 팝업(순위표 · 알림 · 전투 기록)
  'ctl.btn.ladder': '순위표',
  'ctl.btn.history': '전투 기록',
  'ctl.btn.alerts': '알림 {n}',
  'ctl.pop.close': '닫기',
  'ctl.pop.search': '이름으로 검색',
  'ctl.pop.noMatch': '검색 결과가 없습니다.',
  'ctl.pop.page': '{cur} / {total} 쪽',
  'ctl.pop.prev': '이전',
  'ctl.pop.next': '다음',
  'ctl.pop.loading': '불러오는 중…',
  'ctl.ladder.title': '순위표',
  'ctl.ladder.me': '나',
  'ctl.ladder.meRank': '내 순위 {n}위 · {w}승 {l}패 · 승률 {p}%',
  'ctl.ladder.meUnranked': '아직 순위가 없습니다 — 배치전을 마치면 순위에 진입합니다.',
  'ctl.ladder.winRate': '승률',
  'ctl.ladder.games': '판수',
  'ctl.ladder.cap': '상위 {n}위까지 표시합니다.',
  'ctl.notif.title': '침공 알림',
  'ctl.notif.when': '{when} 공격받음',
  'ctl.notif.mine': '내 도발: {taunt}',
  'ctl.notif.empty': '아직 기지가 공격받은 적이 없습니다.',
  'ctl.hist.title': '전투 기록',
  'ctl.hist.loading': '전투 기록을 불러오는 중…',
  'ctl.hist.null': '서버 미설정 또는 오프라인 — 전투 기록을 볼 수 없습니다.',
  'ctl.hist.empty': '아직 전투 기록이 없습니다.',
  'ctl.hist.summary': '총 {n}전 · {w}승 {l}패 · 공격 {a}전 · 방어 {d}전',
  'ctl.hist.filter.all': '전체',
  'ctl.hist.filter.attack': '공격',
  'ctl.hist.filter.defense': '방어',
  'ctl.hist.sort.newest': '최신순',
  'ctl.hist.sort.oldest': '오래된순',
  'ctl.hist.col.when': '시각',
  'ctl.hist.col.side': '구분',
  'ctl.hist.col.opponent': '상대',
  'ctl.hist.col.result': '결과',
  'ctl.hist.col.status': '판정',
  'ctl.hist.side.attack': '공격',
  'ctl.hist.side.defense': '방어',
  'ctl.hist.result.win': '승',
  'ctl.hist.result.lose': '패',
  'ctl.hist.result.pending': '확정 중',
  'ctl.hist.status.verified': '확정',
  'ctl.hist.status.pending': '검증 중',
  'ctl.hist.status.rejected': '거부',
  'ctl.time.now': '방금',
  'ctl.time.min': '{n}분 전',
  'ctl.time.hour': '{n}시간 전',
  'ctl.time.day': '{n}일 전',

  'def.guardian.titan': '타이탄형',
  'def.guardian.interceptor': '인터셉터형',
  'def.repairDone': '정비 완료 — 정비도 {m}% 회복(잔여 크레딧 {c}).',
  'def.repairFail': '정비에 실패했습니다(크레딧 부족 또는 서버 미설정). 상태를 다시 확인하세요.',
  'def.maint.loading': '정비 상태 확인 중…',
  'def.maint.offline': '정비: 서버 미설정 또는 오프라인 — 풍화·정비는 서버 연결 시 활성화됩니다.',
  'def.maint.noActive': '아직 서버에 등록된 활성 방어가 없습니다. 배치를 저장하면 정비 대상이 됩니다.',
  'def.maint.label': '정비도 {m}%',
  'def.maint.critical': ' ⚠ 위험',
  'def.maint.warn': ' 주의',
  'def.maint.credits': '크레딧 {c} · 정비 비용 {r}',
  'def.maint.repairing': '정비 중…',
  'def.maint.repair': '🛠 정비',
  'def.maint.repairTitle': '크레딧으로 정비도 100% 회복',
  'def.guardianHead': '수호기',
  'def.guardian.emptyTitle': '기체를 퇴역시키면 수호기가 됩니다.',
  'def.guardian.none': '없음',
  'def.guardian.slotTitle': '{label} · 성능 {perf}% — 클릭 후 격자에 재배치',
  'def.guardian.tip': '수호 {n} · {label} · 성능 {perf}% (스탯은 서버 권위)',
  // 실화면 통합 편집(레인 C) — 선택/제거/카드 관리 접이식.

  // --- 코어 모듈 경제(M7b — 슬롯 2/보관함/상점/합성/분해, ADR-0018) ---
  'mod.title': '코어 모듈',
  // 코어 모듈 도움말(사용자 요청 2026-08-05). 용어는 KO 정본표를 따른다 — `코어 모듈`은 반드시
  // 전체 표기(단독 `모듈`은 장비 슬롯과 혼동) · `모듈 어픽스` · `사용 횟수` · `합성` · `분해` ·
  // `복수전`. 이모지 금지, 존댓말.
  'mod.help': '도움말',
  'mod.help.title': '코어 모듈 안내',
  'mod.help.s1.h': '코어 모듈이란 무엇인가요',
  'mod.help.s1.b':
    '코어 모듈은 기지 코어의 코어 모듈 슬롯에 장착하는 물품입니다. 누군가 내 기지를 침공해 오면 자동으로 발동합니다. 런 도중에 직접 쓰는 것이 아니라, 내가 접속해 있지 않을 때 대신 일해 주는 방어 장비입니다.\n목록에서 골라 쓰는 것이 아니라, 개체마다 성능이 다르고 쓰면 없어지는 소모품입니다. 저마다 노말에서 유니크까지의 등급과 모듈 어픽스, 그리고 사용 횟수를 가지며, 횟수가 다하면 사라집니다.',
  'mod.help.s2.h': '언제 소모되나요',
  'mod.help.s2.b':
    '모듈의 효력은 침공이 시작되는 시점에 고정됩니다. 이미 진행 중인 침공은 도중에 모듈을 바꿔도 달라지지 않습니다.\n사용 횟수는 침공 결과가 확정될 때에만 줄어듭니다. 공격자가 시작만 하고 도중에 버린 침공은 내 모듈을 소모시키지 않습니다.',
  'mod.help.s3.h': '어떻게 얻나요',
  'mod.help.s3.b':
    '상점에는 낮은 등급이 매일 로테이션으로 진열됩니다. 레어 이상은 상점에서 팔지 않습니다.\n레어와 유니크는 행성 보스 드랍, 복수전 승리, 합성으로만 얻습니다. 유니크는 그 어느 경로에서도 확률이 매우 낮습니다.\n규칙 자체를 바꾸는 효과는 유니크 코어 모듈과 유니크 방어체에만 있습니다. 다른 곳에는 없습니다.',
  'mod.help.s4.h': '합성과 분해',
  'mod.help.s4.b':
    '합성은 같은 등급 3개로 한 등급 위를 노리는 것입니다. 실패해도 전부 잃지는 않습니다. 같은 등급의 새 모듈이 대신 나옵니다.\n분해는 쓰지 않을 모듈을 재화로 되돌립니다. 보관 상한이 있으므로 자리를 비우는 방법이기도 합니다.',
  'mod.help.s5.h': '왜 별도 화면인가요',
  'mod.help.s5.b':
    '방어 사령부는 배치해 두고 계속 쓰는 방어체를 다룹니다. 코어 모듈은 쓰고 없어지고 다시 채우는 물품이라, 배치 슬롯에 앉히지 않고 전용 보관함을 가진 별도 화면에서 다룹니다.\n어떤 모듈을 몇 회분 남긴 채 가지고 있는지는 서버가 기록하므로 이 화면은 로그인이 필요합니다.',
  'mod.back': '◀ 방어 사령부로',
  'mod.baseOnly': '기저 효과만',
  'mod.affixLine': '{name} +{value}',
  // 슬롯(2)
  'mod.slot.head': '코어 모듈 슬롯',
  'mod.slot.loading': '모듈 불러오는 중…',
  'mod.slot.offline': '코어 모듈은 서버 연결이 필요합니다. 오프라인 플레이는 정상 동작합니다.',
  'mod.load.failed': '모듈 정보를 불러오지 못했습니다. 잠시 후 다시 시도하세요.',
  'mod.load.retry': '다시 시도',
  'mod.slot.noBase': '코어 모듈 슬롯을 쓰려면 먼저 방어 배치를 저장하세요.',
  'mod.slot.label': '슬롯 {n}',
  'mod.slot.empty': '빈 슬롯',
  'mod.slot.emptyHint': '슬롯을 고른 뒤 보관함에서 모듈을 장착하세요.',
  'mod.slot.selected': '선택됨',
  'mod.slot.equipped': '장착됨',
  'mod.slot.autoHint': '장착한 모듈은 침공당할 때 자동으로 발동합니다.',
  'mod.slot.charges': '사용 {n}/{m}회',
  'mod.slot.lastCharge': '잔여 1회 — 다음 확정 침공에서 소진됩니다.',
  'mod.slot.unequip': '해제',
  // 보관함
  'mod.inv.head': '보관함',
  'mod.inv.empty': '모듈이 없습니다. 일일 상점에서 구매하세요.',
  'mod.inv.storage': '보관 {count}/{cap}',
  'mod.inv.full': '보관함 만석 — 분해·합성으로 자리를 비우세요. 구매·합성 결과가 차단됩니다.',
  'mod.inv.charges': '×{n}',
  'mod.inv.equip': '장착',
  'mod.inv.equipped': '장착됨',
  'mod.inv.salvage': '분해',
  'mod.inv.fuseStart': '합성 (3→1)',
  'mod.inv.fuseMode': '동급 모듈 3개를 선택해 합성하세요.',
  'mod.inv.fuseConfirm': '선택 합성 ({n}/3)',
  'mod.inv.fuseCancel': '취소',
  'mod.inv.pick': '선택',
  'mod.inv.picked': '선택됨',
  'mod.inv.fuseHint': '동급 3개를 하나로 — 확률로 한 등급 위가 됩니다.',
  'mod.inv.offlineNote': '보관함은 서버가 갖고 있습니다. 로그인하면 여기가 채워집니다.',
  // 효과를 수치로 — 스탯 축 · 발동 조건 · 기저/유니크 (사용자 지시 2026-08-03).
  // 부호와 단위는 **문구가 갖는다**(값은 항상 양수 롤이다) — src/ui/modulesView.ts 주석이 근거.
  'mod.effect.base': '전 방어체 화력 +{d}% · 코어 HP +{h}%',
  'mod.effect.when': '{when} — {effect}',
  'mod.stat.formationDamagePct': '대기권 편대 화력 +{n}%',
  'mod.stat.facilityDamagePct': '회랑 설비 화력 +{n}%',
  'mod.stat.facilityFireRatePct': '회랑 설비 연사 +{n}%',
  'mod.stat.propDurabilityPct': '코어방 기물 내구 +{n}%',
  'mod.stat.bossDamagePct': '방어 보스 화력 +{n}%',
  'mod.stat.coreShieldFlat': '코어 보호막 +{n}',
  'mod.stat.incomingDmgReductionPct': '받는 피해 -{n}%',
  'mod.stat.volleyDamage': '일제사격 {n} 피해',
  'mod.stat.attackerSubCdPct': '공격자 보조무기 쿨다운 +{n}%',
  'mod.stat.attackerSlowPct': '공격자 이동속도 -{n}%',
  'mod.stat.reflectDamagePct': '공격자에게 피해 반사 +{n}%',
  'mod.when.fireAttacker': '화염 공격자 상대',
  'mod.when.coldAttacker': '냉기 공격자 상대',
  'mod.when.lightningAttacker': '전격 공격자 상대',
  'mod.when.beamAttacker': '빔·레일건 상대',
  'mod.when.powerSuperiority': '공격자 전투력 우위일 때',
  'mod.when.revenge': '복수전일 때',
  'mod.when.reinvasion': '재침공일 때',
  'mod.when.subweaponHeavy': '강한 보조무기 상대',
  'mod.when.coreProximity': '공격자가 코어에 접근하면',
  'mod.when.facilitiesDestroyed': '설비 {n}기가 파괴되면',
  'mod.when.timeElapsed': '{n}초가 지나면',
  'mod.when.guardianDowned': '수호기가 격추되면',
  'mod.when.coreHpLow': '코어 HP {n}% 이하에서',
  'mod.when.earlyPhase': '시작 {n}초 이내',
  'mod.when.coreHit': '코어가 피격되면',
  'mod.when.coreRoomEntered': '공격자가 코어방에 진입한 뒤',
  'mod.uq.uq-mirage-core': '가짜 코어 {decoyCount}기 소환(HP {decoyHpPct}%)',
  'mod.uq.uq-blackout': '첫 {radarDisableSec}초 동안 공격자 레이더 무력화',
  'mod.uq.uq-last-reboot': '코어 파괴 직전 {reviveCount}회 부활(HP {reviveHpPct}%)',
  'mod.uq.uq-mirror-gate': '코어가 받은 피해의 {reflectPct}% 를 반사',
  'mod.inv.more': '스크롤하면 모듈이 더 있습니다.',
  // 상점
  'mod.shop.head': '일일 상점',
  'mod.shop.offline': '상점은 서버 연결이 필요합니다.',
  'mod.shop.empty': '오늘 상점이 비어 있습니다.',
  'mod.shop.note': '매일 로테이션 · 노말·매직 전용 · 옵션 미리 공개.',
  'mod.shop.price': '{c} 크레딧',
  'mod.shop.buy': '구매',
  'mod.shop.bought': '구매함',
  // 결과 안내
  'mod.buy.done': '{rarity} 모듈을 구매했습니다.',
  'mod.buy.storageFull': '보관함 만석(20). 먼저 분해·합성하세요.',
  'mod.buy.insufficient': '크레딧이 부족합니다.',
  'mod.buy.alreadyBought': '오늘 이 슬롯은 이미 구매했습니다.',
  'mod.buy.badSlot': '잘못된 상점 슬롯입니다.',
  'mod.buy.noProfile': '서버에서 프로필을 찾을 수 없습니다.',
  'mod.buy.failed': '구매에 실패했습니다. 다시 시도하세요.',
  'mod.salvage.done': '분해 완료 — 크레딧 +{c}.',
  'mod.salvage.notOwned': '해당 모듈을 더 이상 찾을 수 없습니다.',
  'mod.salvage.failed': '분해에 실패했습니다. 다시 시도하세요.',
  // 분해 확인 팝업 — 되돌릴 수 없는 유일한 조작이라 확인을 한 겹 둔다(레인 계약 §1-⑤).
  'mod.salvage.confirm.title': '이 모듈을 분해할까요?',
  'mod.salvage.confirm.body': '모듈이 사라지고 크레딧으로 바뀝니다. 되돌릴 수 없습니다.',
  'mod.salvage.confirm.ok': '분해하기',
  'mod.salvage.confirm.cancel': '그대로 두기',
  'mod.fuse.done': '합성 완료 — {rarity} 모듈을 얻었습니다.',
  'mod.fuse.promoted': '합성 승급! {rarity} 등급으로 상승했습니다.',
  'mod.fuse.needThree': '정확히 3개를 선택하세요.',
  'mod.fuse.dupIds': '같은 모듈을 두 번 선택할 수 없습니다.',
  'mod.fuse.rarityMismatch': '3개 모두 같은 등급이어야 합니다.',
  'mod.fuse.notOwned': '선택한 모듈 중 하나를 더 이상 찾을 수 없습니다.',
  'mod.fuse.failed': '합성에 실패했습니다. 다시 시도하세요.',
  'mod.equip.done': '모듈을 장착했습니다.',
  'mod.equip.unequipped': '모듈을 해제했습니다.',
  'mod.equip.failed': '장착 변경에 실패했습니다(서버 거부).',
  'mod.equip.noSlot': '두 슬롯이 모두 찼습니다. 먼저 하나를 해제하세요.',
  // 침공 결과 정찰 공개(상대 코어 모듈 옵션 — 스펙 R9)
  'mod.reveal.head': '상대 코어 모듈',
  'mod.reveal.grade': '등급: {rarity}',
  'mod.reveal.charges': '잔여 {n}회',
  // 렌더 배너(블랙아웃 등 유니크 룰 변경)
  'mod.hud.blackout': '레이더 교란 — {n}초',

  // --- 모듈 어픽스 표기(M7b — data/coreModules.ts MODULE_AFFIXES 파생) ---
  // 접두 8종 — 정적 카운터(T0 공격자 매치업)
  'def3.affix.mc-quench.name': '소화의',
  'def3.affix.mc-quench.desc': '공격자가 화염 어픽스를 지녔을 때, 배치 방어체가 받는 피해가 줄어듭니다.',
  'def3.affix.mc-frostward.name': '방한의',
  'def3.affix.mc-frostward.desc': '공격자가 냉기 어픽스를 지녔을 때, 배치 방어체가 받는 피해가 줄어듭니다.',
  'def3.affix.mc-insulate.name': '절연의',
  'def3.affix.mc-insulate.desc': '공격자가 전격 어픽스를 지녔을 때, 그 보조무기 쿨다운이 늘어납니다.',
  'def3.affix.mc-refract.name': '분광의',
  'def3.affix.mc-refract.desc': '공격자의 주무기가 빔·레일건 계열일 때, 배치 방어체가 받는 피해가 줄어듭니다.',
  'def3.affix.mc-armorbreak.name': '파쇄의',
  'def3.affix.mc-armorbreak.desc': '공격자의 전투력이 방어자보다 우위일 때, 회랑 설비의 화력이 오릅니다.',
  'def3.affix.mc-avenger.name': '복수자의',
  'def3.affix.mc-avenger.desc': '복수전으로 들어온 공격자에게 방어 보스의 화력이 크게 오릅니다.',
  'def3.affix.mc-blockade.name': '봉쇄의',
  'def3.affix.mc-blockade.desc': '같은 공격자가 재침공하면 코어방 기물이 훨씬 단단해집니다.',
  'def3.affix.mc-disruptor.name': '교란의',
  'def3.affix.mc-disruptor.desc': '공격자가 강한 보조무기를 장착했을 때, 그 쿨다운이 늘어납니다.',
  // 접미 8종 — 동적 트리거(런 중 공격자 행동 반응)
  'def3.affix.mt-forcefield.name': '의 역장',
  'def3.affix.mt-forcefield.desc': '공격자가 코어에 처음 접근할 때 코어에 보호막을 부여합니다.',
  'def3.affix.mt-fury.name': '의 격노',
  'def3.affix.mt-fury.desc': '회랑 설비가 일정 수 파괴되면 남은 설비의 연사가 빨라집니다.',
  'def3.affix.mt-attrition.name': '의 지연전',
  'def3.affix.mt-attrition.desc': '침공이 길어지면 공격자의 이동속도가 떨어집니다.',
  'def3.affix.mt-retribution.name': '의 응징',
  'def3.affix.mt-retribution.desc': '수호기가 격추당하면 일제사격이 공격자를 강타합니다.',
  'def3.affix.mt-laststand.name': '의 배수진',
  'def3.affix.mt-laststand.desc': '코어 내구도가 위험 수준으로 낮으면 방어 보스의 화력이 오릅니다.',
  'def3.affix.mt-vanguard.name': '의 선제',
  'def3.affix.mt-vanguard.desc': '침공 시작 몇 초 동안 대기권 편대의 화력이 오릅니다.',
  'def3.affix.mt-reflection.name': '의 반사',
  'def3.affix.mt-reflection.desc': '코어가 받은 피해의 일부를 공격자에게 반사합니다.',
  'def3.affix.mt-bulwark.name': '의 최종 방벽',
  'def3.affix.mt-bulwark.desc': '공격자가 코어방에 진입한 뒤로 배치 방어체가 받는 피해가 줄어듭니다.',

  // --- 침공 3레이어 방어체 카탈로그(M7a 임시 16종 — L9-garrison-catalog) ---
  // L1 편대
  'def3.formation.scout-drones.name': '정찰 드론편대',
  'def3.formation.scout-drones.desc': '경량 드론 5기가 V자를 유지한 채 진입로를 따라 곧장 내려옵니다.',
  'def3.formation.interceptors.name': '요격 편대',
  'def3.formation.interceptors.desc': '박격 기체 6기가 좌우에서 시차를 두고 조여듭니다.',
  'def3.formation.assault.name': '강습 돌격편대',
  'def3.formation.assault.desc': '충각 기체 4기가 밀집 종대로 연달아 들이받습니다.',
  'def3.formation.glide-flock.name': '활공 편대',
  'def3.formation.glide-flock.desc':
    '무른 요격기 6기가 좌우 끝에서 안쪽으로 급강하합니다. 궤도가 대각선이라 제자리에 서 있으면 반드시 스칩니다.',
  'def3.formation.mine-layer.name': '기뢰 살포선',
  'def3.formation.mine-layer.desc':
    '느린 수송선이 앞서 흐르며 고정형 기체를 통로에 넓게 깔아 둡니다. 깔린 자리에 그대로 남고, 강제 스크롤이 그 위로 밀어 넣습니다.',
  'def3.formation.shield-escort.name': '실드 호위편대',
  'def3.formation.shield-escort.desc':
    '중장갑 기체가 앞에서 벽을 세우고 정밀 포탑이 뒤를 따릅니다. 전열을 뚫을지 우회할지 골라야 합니다.',
  'def3.formation.sniper-nest.name': '저격 편대',
  'def3.formation.sniper-nest.desc':
    '원거리 포대가 통로 위쪽에 눌러앉아 착탄 예고선을 계속 긋습니다. 붙으면 쉽게 부수지만 방치하면 계속 맞습니다.',
  'def3.formation.support-escort.name': '지원 편대',
  'def3.formation.support-escort.desc':
    '육중한 모체를 복원 드로이드가 따라다니며 근거리에서 계속 회복시킵니다. 복원 드로이드를 먼저 지우지 않으면 모체가 내려가지 않습니다.',
  // Lane9 신규 편대(톡사르·크라스)
  'def3.formation.toxar-corrosion.name': '부식 강습편대',
  'def3.formation.toxar-corrosion.desc':
    '부식 돌격체가 좌우에서 파고들고 그 뒤로 독액 분사체·부식 분비강이 협공으로 붙습니다. 가만히 있으면 부식이 계속 갉아먹습니다.',
  'def3.formation.toxar-blight.name': '역병 살포편대',
  'def3.formation.toxar-blight.desc':
    '독액 분사체와 부식 분비강이 느리게 흘러내리며 통로를 오염으로 봉쇄합니다. 화면에 오래 남아 지속 피해로 길을 좁힙니다.',
  'def3.formation.kras-breaker.name': '파쇄 돌격편대',
  'def3.formation.kras-breaker.desc':
    '파쇄 골렘 3기가 밀집 종대로 들이받고 고대 파괴자 2기가 뒤에서 가속 진입합니다. 전열을 뚫을지 우회할지 고르게 만듭니다.',
  'def3.formation.kras-piercer.name': '관통 저격 편대',
  'def3.formation.kras-piercer.desc':
    '수호 포대가 상단에 눌러앉아 예고선을 긋고 정밀 포탑과 골렘이 뒤따릅니다. 빨리 붙지 않으면 계속 관통당합니다.',
  // L2 설비
  'def3.fac.rapid.name': '속사포',
  'def3.fac.rapid.desc': '벽에 붙어 근거리를 꾸준히 훑는 기본 연사 포대.',
  'def3.fac.rail.name': '관통 레일포',
  'def3.fac.rail.desc': '조준을 잠그고 예고선을 그은 뒤 관통탄 한 발을 쏩니다.',
  'def3.fac.mortar.name': '곡사 박격포',
  'def3.fac.mortar.desc': '느린 포탄을 넓은 부채꼴로 뿌려 회랑을 면으로 덮습니다.',
  'def3.fac.laser.name': '레이저 격자',
  'def3.fac.laser.desc': '주기적으로 켜졌다 꺼지며 회랑을 불태우는 장판을 세웁니다.',
  'def3.fac.flame.name': '화염 방사구',
  'def3.fac.flame.desc': '벽 안쪽에 꺼지지 않는 화염 장판을 계속 뿜습니다.',
  'def3.fac.spawner.name': '드론 사출구',
  'def3.fac.spawner.desc':
    '침입자가 사거리 안에 있는 동안, 회랑 앞쪽으로 소형 드론을 사출해 정면에서 맞부딪히게 합니다.',
  'def3.fac.press.name': '압축 프레스',
  'def3.fac.press.desc':
    '부술 수 없는 압축 판이 정해진 주기로 회랑 안쪽까지 뻗었다 되돌아옵니다. 밀려날 자리가 없으면 그대로 짓눌립니다.',
  'def3.fac.gravwell.name': '견인 자기장',
  'def3.fac.gravwell.desc':
    '주기적으로 넓은 감속 장판을 세웁니다. 스스로는 피해를 주지 않고, 다른 설비의 사격을 맞게 만드는 것이 역할입니다.',
  'def3.fac.shock.name': '충격파 발생기',
  'def3.fac.shock.desc':
    '길게 예열한 뒤 아주 짧은 순간에 거대한 광역 폭발을 터뜨립니다. 회피 타이밍 한 번을 정확히 묻습니다.',
  // Lane9 신규 설비(톡사르 부식 · 크라스 파괴)
  'def3.fac.venomvent.name': '부식 분사구',
  'def3.fac.venomvent.desc': '벽 안쪽에 꺼지지 않는 산성 장판을 계속 뿜어 오래 머무는 것을 갉아먹습니다.',
  'def3.fac.blightpool.name': '오염 늪',
  'def3.fac.blightpool.desc': '주기적으로 넓은 감속 오염 늪을 세웁니다. 피해는 미미하지만 회피 여유를 깎습니다.',
  'def3.fac.corrosivemist.name': '부식 안개',
  'def3.fac.corrosivemist.desc': '짧은 예열 뒤 넓은 저피해 안개를 오래 깔아 회랑을 덮습니다.',
  'def3.fac.toxinturret.name': '독성 연사포',
  'def3.fac.toxinturret.desc': '저피해 독성 탄을 빠르게 뿜어 근거리를 훑습니다.',
  'def3.fac.heavyrail.name': '중장 레일포',
  'def3.fac.heavyrail.desc': '조준을 잠그고 예고선을 그은 뒤 초고피해 관통탄 한 발을 회랑으로 내리꽂습니다.',
  'def3.fac.siegecannon.name': '공성 주포',
  'def3.fac.siegecannon.desc': '느리지만 묵직합니다. 단발 고화력 포탄이 철퇴처럼 내리꽂힙니다.',
  'def3.fac.breachturret.name': '돌파 산탄포',
  'def3.fac.breachturret.desc': '중간 화력의 부채꼴 다발을 뿌려 회랑을 돌파 탄막으로 덮습니다.',
  'def3.fac.demolisher.name': '파괴 폭뢰기',
  'def3.fac.demolisher.desc': '길게 예열한 뒤 한순간에 거대한 광역 폭발을 터뜨립니다. 회피 타이밍 한 번을 정확히 묻습니다.',
  // L3 기물
  'def3.prop.shieldGenerator.name': '실드 발생기',
  'def3.prop.shieldGenerator.desc': '코어를 보호막으로 감쌉니다. 이걸 먼저 부수지 않으면 코어에 흠집도 안 납니다.',
  'def3.prop.gravityAnchor.name': '중력 앵커',
  'def3.prop.gravityAnchor.desc': '주기적으로 감속 지대를 깔아 회피할 여유를 깎습니다.',
  'def3.prop.fixedCannon.name': '고정 주포',
  'def3.prop.fixedCannon.desc': '코어방을 직사로 훑는 고정 화력.',
  'def3.prop.repairPylon.name': '회복 파일런',
  'def3.prop.repairPylon.desc':
    '아무도 때리지 않는 대신 주변 방어체를 주기적으로 회복시킵니다. 이걸 지우기 전까지 보스도 기물도 계속 되살아납니다.',
  'def3.prop.decoyHologram.name': '기만 홀로그램',
  'def3.prop.decoyHologram.desc':
    '실루엣도 조준 우선순위도 코어와 같은 가짜 코어. 부숴도 승리가 서지 않습니다 — 여기 쏟은 화력 자체가 이 기물의 피해입니다.',
  'def3.prop.mineSwarm.name': '자폭 지뢰군',
  'def3.prop.mineSwarm.desc':
    '자기 주위 링을 돌며 폭발 지뢰를 하나씩 깝니다. 옆에 붙어서 쏘는 자세를 벌줍니다.',
  // L3 방어 보스
  'def3.boss.steelGoliath.name': '강철 골리앗',
  'def3.boss.steelGoliath.desc': '코어방의 수문장. 3페이즈로 싸우며 각 페이즈 첫 패턴 뒤 과열 창이 열립니다.',
  'def3.boss.sporeQueen.name': '포자 여왕',
  'def3.boss.sporeQueen.desc':
    '느리고 거대한 지형 장악형. 감속 장판과 용암 기둥으로 바닥을 계속 빼앗고, 그 장판 위에서 과열 창을 엽니다.',
  'def3.boss.phaseWarden.name': '위상 감시자',
  'def3.boss.phaseWarden.desc':
    '얇고 빠른 순수 탄막형. 장판을 전혀 깔지 않는 대신 설 자리가 아니라 탄 사이 틈만 남깁니다.',
  // L2 맵 템플릿
  'def3.map.straight.name': '개활 회랑',
  'def3.map.straight.desc': '엄폐가 거의 없는 긴 직선 통로. 설치 소켓이 12개로 가장 많습니다.',
  'def3.map.curved.name': '굴곡 회랑',
  'def3.map.curved.desc': '세 구간이 위아래로 엇갈린 통로. 소켓 10개에 사각지대가 생깁니다.',
  'def3.map.choke.name': '병목 회랑',
  'def3.map.choke.desc': '소켓은 8개뿐이지만 통로가 좁아 피할 자리가 거의 없습니다.',

  // 방어체 어픽스(M7b)
  'def3.affix.du-reinforced.name': '보강된',
  'def3.affix.du-reinforced.desc':
    '장갑을 덧댔습니다. 쓰러지기까지 더 많은 타격을 견딥니다.',
  'def3.affix.du-honed.name': '벼려진',
  'def3.affix.du-honed.desc':
    '한 발 한 발이 더 세게 박힙니다.',
  'def3.affix.du-cycled.name': '순환식',
  'def3.affix.du-cycled.desc':
    '급탄부를 손봤습니다. 더 자주 쏩니다.',
  'def3.affix.du-plated.name': '판갑의',
  'def3.affix.du-plated.desc':
    '내구도보다 먼저 피해를 흡수하는 상시 보호막.',
  'def3.affix.du-sealed.name': '밀폐된',
  'def3.affix.du-sealed.desc':
    '풍화가 더 천천히 진행됩니다.',
  'def3.affix.du-teeming.name': '증식형',
  'def3.affix.du-teeming.desc':
    '사출구를 넓혔습니다. 드론을 더 많이 동시에 유지합니다.',
  'def3.affix.du-insulated.name': '단열된',
  'def3.affix.du-insulated.desc':
    '구동부 방열재. 보스가 더 늦게, 더 적게 과열됩니다.',
  'def3.affix.du-vanward.name': '선봉의',
  'def3.affix.du-vanward.desc':
    '편대가 사격 위치에 더 빨리 붙습니다.',
  'def3.affix.dt-ambush.name': '매복의',
  'def3.affix.dt-ambush.desc':
    '공격자가 레이어에 들어선 직후 가장 강하게 때립니다.',
  'def3.affix.dt-lastwall.name': '최후 방벽의',
  'def3.affix.dt-lastwall.desc':
    '코어가 30% 아래로 떨어지면 단단해집니다.',
  'def3.affix.dt-vengeance.name': '복수의',
  'def3.affix.dt-vengeance.desc':
    '곁의 방어체가 부서질수록 사나워집니다.',
  'def3.affix.dt-siege.name': '공성의',
  'def3.affix.dt-siege.desc':
    '첫 1분을 버틴 뒤부터 연사가 빨라집니다.',
  'def3.affix.dt-bulwark.name': '성벽의',
  'def3.affix.dt-bulwark.desc':
    '코어가 절반까지 깎이면 보호막을 올립니다.',
  'def3.affix.dt-recoil.name': '반동의',
  'def3.affix.dt-recoil.desc':
    '공격자가 가까이 붙어 있는 동안 훨씬 세게 때립니다.',
  'def3.affix.dt-swarmcall.name': '군집 호출의',
  'def3.affix.dt-swarmcall.desc':
    '방어체를 하나 잃을 때마다 드론 자리가 하나 늘어납니다.',
  'def3.affix.dt-secondwind.name': '재기의',
  'def3.affix.dt-secondwind.desc':
    '침공이 길어지면 쌓인 풍화를 털어냅니다.',
  // 유니크 방어체 고유 효과(M7b — data/defenseUnits.ts DEFENSE_UNIQUES)
  'def3.duq.duq-overclock-core.name': '과부하 코어',
  'def3.duq.duq-overclock-core.desc':
    '침공이 길어질수록 연사가 빨라집니다(상한 있음). 대가로 내구도가 상시 깎입니다.',
  'def3.duq.duq-vengeance-engine.name': '복수 기관',
  'def3.duq.duq-vengeance-engine.desc': '같은 레이어의 아군이 파괴될 때마다 피해가 오릅니다(상한 있음).',
  'def3.duq.duq-deathgrip-bastion.name': '최후의 요새',
  'def3.duq.duq-deathgrip-bastion.desc':
    '코어 내구도가 떨어질수록 단단해지고, 코어가 거의 무너졌을 때 가장 질깁니다.',
  'def3.duq.duq-proximity-reactor.name': '근접 반응로',
  'def3.duq.duq-proximity-reactor.desc':
    '공격자가 가까울수록 피해가 오릅니다. 정해진 거리 구간마다 계단식으로 올라갑니다.',
  'def3.duq.duq-swarm-nexus.name': '군체 중추',
  'def3.duq.duq-swarm-nexus.desc': '드론을 훨씬 많이 동시에 유지합니다. 대신 매 주기가 더 느려집니다.',
  'def3.duq.duq-aegis-lattice.name': '수호 격자',
  'def3.duq.duq-aegis-lattice.desc': '보호막과 강한 풍화 저항을 얻는 대신 자기 화력을 잃습니다.',
  'def3.duq.duq-thermal-vault.name': '열 금고',
  'def3.duq.duq-thermal-vault.desc': '과열 창이 짧아지고 내구도가 늘어난 방어 보스.',
  'def3.duq.duq-vanguard-tide.name': '선봉 조류',
  'def3.duq.duq-vanguard-tide.desc':
    '훨씬 빨리 밀려 들어오고 피해도 높은 편대. 대신 반격에 쉽게 무너집니다.',
  // 코어 모듈 유니크(M7b)
  'def3.module.uq-mirage-core.name': '신기루 코어',
  'def3.module.uq-mirage-core.desc':
    '진짜 코어 곁에 가짜를 투영합니다. 부숴도 얻는 것이 없습니다.',
  'def3.module.uq-blackout.name': '블랙아웃',
  'def3.module.uq-blackout.desc':
    '첫 30초 동안 공격자의 레이더를 무력화합니다.',
  'def3.module.uq-last-reboot.name': '최후의 재기동',
  'def3.module.uq-last-reboot.desc':
    '코어가 쓰러지는 대신 최대 내구도의 5분의 1로 1회 재기동합니다.',
  'def3.module.uq-mirror-gate.name': '거울 관문',
  'def3.module.uq-mirror-gate.desc':
    '코어가 받는 피해의 4분의 1을 공격자에게 되돌립니다.',

  // 방어 사령부 화면(M7b)
  'def3.cmd.title': '방어 사령부',
  'def3.cmd.tab.l1': 'L1 대기권',
  'def3.cmd.tab.l2': 'L2 회랑',
  'def3.cmd.tab.l3': 'L3 코어방',
  'def3.cmd.tab.inv': '보관함',
  'def3.cmd.tab.mod': '코어 모듈',
  'def3.cmd.save': '배치 저장',
  'def3.cmd.revert': '되돌리기',
  'def3.cmd.test': '시험 침공',
  'def3.cmd.back': '◀ 기지로',
  'def3.cmd.dirty': '저장하지 않은 변경',
  'def3.cmd.test.confirm.title': '시험 침공을 시작할까요?',
  'def3.cmd.test.confirm.body':
    '시험 침공은 지금 편집 중인 배치로 진행되지만, 이 화면을 떠나면 저장하지 않은 변경은 사라집니다. 남기려면 먼저 저장하세요.',
  'def3.cmd.test.confirm.saveAndGo': '저장하고 시작',
  'def3.cmd.test.confirm.discardAndGo': '저장 없이 시작',
  'def3.cmd.test.confirm.cancel': '계속 편집',
  'def3.cmd.saved': '배치를 저장했습니다.',
  'def3.cmd.savedLocal': '로컬에만 저장했습니다(오프라인 — 서버 배치는 그대로).',
  'def3.cmd.offline': '방어체 관리는 로그인이 필요합니다. 배치 편집은 오프라인에서도 됩니다.',
  'def3.cmd.loading': '불러오는 중…',
  'def3.cmd.preview': '미리보기',
  'def3.cmd.previewHint': '공격자가 이 레이어에서 실제로 보는 모습입니다.',
  'def3.cmd.slots': '배치 슬롯',
  'def3.cmd.core.note': '코어 모듈은 한 번 쓰면 없어지는 개별 물품이라 전용 화면에서 다룹니다.',
  'def3.cmd.slots.l1': '편대 슬롯',
  'def3.cmd.slots.l2': '설비 소켓',
  'def3.cmd.slots.l3': '코어방',
  'def3.cmd.slot.empty': '비어 있음 — 기본 수비대가 충원합니다',
  'def3.cmd.slot.emptyProp': '비어 있음',
  'def3.cmd.slot.wave': '편대 {n}',
  'def3.cmd.slot.socket': '소켓 {n}',
  'def3.cmd.slot.prop': '기물 {n}',
  'def3.cmd.slot.boss': '방어 보스',
  // '수호 {n}' — '수호기'로 늘리면 +18px 이라 좁은 슬롯 칸을 넘친다. 폭 예외로 축약을 유지한다.
  'def3.cmd.slot.guardian': '수호 {n}',
  'def3.cmd.slot.core': '코어',
  'def3.cmd.slot.place': '배치',
  'def3.cmd.slot.clear': '비우기',
  'def3.cmd.core.hp': '코어 내구도 {hp}',
  'def3.cmd.template': '회랑 지형',
  'def3.cmd.template.sockets': '소켓 {n}',
  'def3.cmd.pick.title': '방어체 고르기',
  'def3.cmd.pick.none': '배치할 수 있는 방어체가 없습니다. 보관함 탭에서 설계도로 제작하세요.',
  'def3.cmd.pick.placed': '이미 배치됨',
  'def3.cmd.inv.head': '보유 방어체',
  'def3.cmd.inv.empty': '보유 방어체가 없습니다. 설계도로 제작하세요.',
  'def3.cmd.inv.blueprints': '설계도',
  'def3.cmd.unit.title': '방어체 강화',
  // ⚠️ 사용자 신고 2026-08-05: "설계도가 침공 약탈때도 나오고 막아도 나온다는 말이야?" — 두 줄이
  // 실제로 서로 다른 말을 하고 있었다. 그리고 `막아 내면` 쪽이 틀린 쪽이다(ADR-0018: 방어 실적은
  // 획득 경로에서 명시 제외 — 부익부 방지). 경로는 **행성 런 드랍**과 **내가 공격에 성공했을 때의
  // 복제 약탈** 둘뿐이다. 두 줄이 이어 붙어 한 문단으로 읽히므로(`bpEmpty\nbpMore`) 빈 상태 문장은
  // 사실만 말하고 경로 설명은 bpMore 한 곳에만 둔다.
  'def3.cmd.inv.more': '방어체는 행성 런에서 드랍되거나, 설계도로 제작해 얻습니다.',
  'def3.cmd.inv.bpMore':
    '설계도는 행성 런에서 드랍되고, 내가 다른 기지 침공에 성공하면 상대 설계도를 복제해 얻습니다.',
  'def3.cmd.inv.bpEmpty': '보유 설계도가 없습니다.',
  'def3.cmd.inv.craft': '제작',
  'def3.cmd.inv.count': '{n}장',
  'def3.cmd.unit.level': 'Lv {n}',
  'def3.cmd.unit.ascension': '승격 {n}',
  'def3.cmd.unit.power': '전투력 {p}%',
  'def3.cmd.unit.levelUp': '레벨업',
  'def3.cmd.unit.ascend': '승격',
  'def3.cmd.unit.reroll': '어픽스 리롤',
  'def3.cmd.unit.promote': '등급 승급',
  'def3.cmd.unit.max': '최대',
  'def3.cmd.unit.cost': '크레딧 {c} / 광물 {m} / 설계도 {b}',
  'def3.cmd.unit.affix.none': '기저 스탯만',
  'def3.cmd.unit.affix.always': '상시',
  'def3.cmd.unit.affix.cond': '조건부',
  'def3.cmd.mod.head': '코어 모듈',
  'def3.cmd.mod.note':
    '코어 모듈은 카탈로그에서 고르는 것이 아니라 한 번 쓰면 없어지는 개별 물품이라 전용 화면에서 다룹니다.',
  'def3.cmd.mod.open': '모듈 관리',
  'def3.cmd.rarity.normal': '노말',
  'def3.cmd.rarity.magic': '매직',
  'def3.cmd.rarity.rare': '레어',
  'def3.cmd.rarity.unique': '유니크',
  'def3.cmd.err.failed': '서버가 요청을 거부했습니다.',
  'def3.cmd.err.offline': '서버에 연결돼 있지 않습니다.',
  'def3.cmd.ok.upgrade': '강화했습니다.',

  // 방어 사령부 도움말(사용자 요청 2026-08-05 — "처음 오는 사람이 전체 내용을 다 알 수 있게").
  // ⚠️ 용어는 이 파일 KO 선언부의 정본표를 따른다 — `편대`(웨이브 ✗) · `설비`(포탑 ✗) ·
  // `수호기` · `내구도`(방어체·코어의 HP) · `보관함`(창고 ✗) · `침공`(PvP, 침략 ✗) ·
  // `승격`/`등급 승급`(이 화면의 강화 버튼 라벨과 같은 낱말이어야 도움말이 화면을 가리킬 수 있다).
  // ⚠️ 이모지 금지(사용자 지시이자 `text.ts` stripEmoji 가 두부로 떨군다). 문장은 존댓말.
  'def3.cmd.help': '도움말',
  'def3.cmd.help.title': '방어 사령부 안내',
  'def3.cmd.help.s1.h': '이 화면은 무엇을 하는 곳인가요',
  'def3.cmd.help.s1.b':
    '다른 파일럿이 내 기지를 침공해 왔을 때 그를 맞이할 방어 배치를 짜는 곳입니다. 그 순간 조종간을 잡는 것은 내가 아니라 여기서 저장해 둔 배치이며, 내가 접속해 있지 않아도 이 배치가 대신 싸웁니다.\n침공 한 번은 L1 대기권, L2 회랑, L3 코어방 세 레이어를 끊김 없이 이어 달리는 단일 런입니다. 공격자는 레이어 경계에서 선체와 자원을 그대로 가지고 넘어가므로, 앞 레이어에서 깎아 둔 만큼이 뒤 레이어를 지켜 줍니다.',
  'def3.cmd.help.s2.h': '세 레이어',
  'def3.cmd.help.s2.b':
    'L1 대기권 — 편대 슬롯입니다. 보유한 편대를 슬롯에 꽂아 등장 순서만 정하시면 됩니다. 진형과 이동 경로는 편대마다 내장돼 있어 직접 그리지 않습니다.\nL2 회랑 — 회랑 지형을 고르고, 그 지형에 뚫려 있는 설치 소켓에 설비를 넣습니다. 설비는 세 갈래입니다. 화력을 담당하는 벽부착 방어포, 회피를 강요하는 장치형 해저드, 파괴 전까지 소형 드론을 계속 뽑아내는 드론 사출구입니다. 소켓의 수와 위치는 지형이 정하므로 한 곳에 몰아 넣을 수는 없습니다.\nL3 코어방 — 방어 보스 한 자리, 수호기 자리, 기물 소켓, 그리고 코어가 있습니다. 코어 내구도가 0이 되는 순간 방어는 실패합니다.\n비어 있는 슬롯은 기본 수비대가 자동으로 채웁니다. 그 행성의 최하급 유닛이라 비워 두어도 방어는 서지만 약합니다. 내가 모은 방어체로 바꿔 꽂을수록 기지가 강해집니다.',
  'def3.cmd.help.s3.h': '방어체는 어떻게 얻나요',
  'def3.cmd.help.s3.b':
    '방어체는 행성 런에서 직접 드랍되거나, 설계도와 광물을 들여 제작해 얻습니다.\n설계도의 획득 경로는 정확히 둘입니다. 하나는 행성 런 드랍이고, 다른 하나는 복제 약탈입니다. 복제 약탈은 내가 다른 기지를 침공해 성공했을 때 낮은 확률로 상대의 설계도를 복제해 오는 것입니다. 침공을 막아 냈을 때 설계도가 나오지는 않습니다.\n반대로 내가 침공당했을 때 잃는 것도 없습니다. 공격자가 가져가는 것은 언제나 사본이며 내 원본은 그대로 남습니다.',
  'def3.cmd.help.s4.h': '방어체를 키우는 방법',
  'def3.cmd.help.s4.b':
    '레벨 — 크레딧과 광물을 넣어 스탯을 올립니다. 가장 자주 쓰게 되는 축입니다.\n승격 — 같은 방어체의 설계도가 중복으로 모였을 때 씁니다. 스탯이 크게 뛰는 동시에 외형이 달라지며, 이 외형은 나를 침공하러 온 공격자의 화면에 그대로 보입니다.\n어픽스 리롤 — 광물로 방어체 어픽스를 다시 굴립니다. 방어체 어픽스는 매직과 레어 등급 방어체에 붙는 무작위 옵션입니다.\n등급 승급 — 노말에서 매직, 레어, 유니크 순으로 올립니다. 유니크 방어체는 다른 등급에는 없는 고유 효과를 가집니다.',
  'def3.cmd.help.s5.h': '풍화',
  'def3.cmd.help.s5.b':
    '풍화는 배치해 둔 방어체에만 작용합니다. 보관함에 넣어 둔 방어체는 아무리 오래 두어도 닳지 않으므로 여분 방어체를 쌓아 두는 데에는 비용이 들지 않습니다. 다만 수호기만은 예외로, 배치 여부와 무관하게 성능이 떨어지고 한 번 닳은 성능은 되돌릴 수 없습니다.',
  'def3.cmd.help.s6.h': '코어 모듈',
  'def3.cmd.help.s6.b':
    '코어 모듈은 목록에서 골라 쓰는 것이 아니라 하나하나가 사용 횟수를 가진 개별 물품이라, 이 화면이 아닌 전용 화면에서 다룹니다.\n모듈의 효력은 침공이 시작되는 시점에 고정됩니다. 이미 진행 중인 침공은 도중에 모듈을 바꿔도 달라지지 않습니다. 사용 횟수는 침공 결과가 확정될 때에만 줄어들므로, 공격자가 시작만 하고 도중에 버린 침공은 내 모듈을 소모시키지 않습니다.',
  'def3.cmd.help.s7.h': '배치를 저장하고 시험해 보기',
  'def3.cmd.help.s7.b':
    '이 화면에서 고친 내용은 아직 초안입니다. 화면 아래 배치 저장을 눌러야 실제 방어에 쓰입니다. 되돌리기를 누르면 마지막으로 저장한 상태로 돌아갑니다.\n시험 침공은 지금 편집 중인 배치를 내가 직접 공격해 보는 기능입니다. 결과는 어디에도 기록되지 않아 래더에도 정산에도 영향이 없으며, 게임 화면에 뜨는 시험 침공 종료 버튼을 누르면 언제든 이 화면으로 돌아옵니다.\n이 화면을 떠나면 저장하지 않은 변경은 사라집니다. 남기고 싶으시다면 먼저 저장해 주세요.',
  'def3.cmd.help.s8.h': '알아 두면 좋은 것',
  'def3.cmd.help.s8.b':
    '슬롯이 곧 예산입니다. 별도의 코스트 포인트는 없고, 편대 슬롯과 설치 소켓, 보스와 수호기 자리의 수는 맵이 고정합니다. 전투력 차이의 공정성은 래더 매칭이 맞춰 줍니다.\n공격자는 대상을 고르는 화면에서 내 방어체의 실루엣과 등급, 승격 별만 봅니다. 정확한 스탯과 방어체 어픽스는 나를 한 번 침공해 본 뒤에야 공개됩니다.\n방어체 제작과 강화는 로그인이 필요합니다. 배치 편집은 로그인 없이도 됩니다.',

  // 액티브 스킬 42종 i18n (ADR-0041 · .omc/plans/active-skills-catalog.md 저작 카탈로그 정본).
  'activeSkill.as_striker_firepower_lo.name': '직사 제압',
  'activeSkill.as_striker_firepower_lo.desc': '발동 방향으로 광선탄 12발을 부채꼴로 발사합니다.',
  'activeSkill.as_striker_firepower_hi.name': '전탄 일제사',
  'activeSkill.as_striker_firepower_hi.desc': '사방으로 광선탄 24발을 동시에 발사합니다.',
  'activeSkill.as_striker_survival_lo.name': '방호 전개',
  'activeSkill.as_striker_survival_lo.desc': '180틱 동안 모든 피해를 무시합니다.',
  'activeSkill.as_striker_survival_hi.name': '불굴 방벽',
  'activeSkill.as_striker_survival_hi.desc':
    '300틱 동안 무적이 되고, 끝날 때 선체를 일부 회복합니다.',
  'activeSkill.as_striker_mobility_lo.name': '강습 추진',
  'activeSkill.as_striker_mobility_lo.desc': '발동 방향으로 600 거리를 즉시 돌파합니다.',
  'activeSkill.as_striker_mobility_hi.name': '이중 도약',
  'activeSkill.as_striker_mobility_hi.desc': '두 번 연속으로 도약해 900 거리를 이동합니다.',
  'activeSkill.as_bruiser_blade_lo.name': '장갑 파쇄',
  'activeSkill.as_bruiser_blade_lo.desc': '쌓인 장갑 스택을 전부 태워 스택 수만큼 파편을 날립니다.',
  'activeSkill.as_bruiser_blade_hi.name': '전탄 참격',
  'activeSkill.as_bruiser_blade_hi.desc':
    '장갑을 최대치까지 채운 즉시 전량을 참격 24발로 쏟아냅니다.',
  'activeSkill.as_bruiser_morph_lo.name': '충각 돌진',
  'activeSkill.as_bruiser_morph_lo.desc': '600 거리를 밀고 나가며 장갑 스택 3개를 얻습니다.',
  'activeSkill.as_bruiser_morph_hi.name': '관통 충각',
  'activeSkill.as_bruiser_morph_hi.desc': '900 거리를 관통 돌진하고 장갑 스택을 최대치로 채웁니다.',
  'activeSkill.as_bruiser_fortify_lo.name': '고정 장갑',
  'activeSkill.as_bruiser_fortify_lo.desc': '180틱 동안 장갑 스택이 최대치로 고정되어 줄지 않습니다.',
  'activeSkill.as_bruiser_fortify_hi.name': '파열 장갑',
  'activeSkill.as_bruiser_fortify_hi.desc':
    '300틱 동안 장갑을 고정하고, 끝나는 순간 전량을 폭발로 터뜨립니다.',
  'activeSkill.as_arccaster_chain_lo.name': '강제 충전',
  'activeSkill.as_arccaster_chain_lo.desc':
    '정지하지 않고도 즉시 과충전에 진입하며 전격 12발을 뿜습니다.',
  'activeSkill.as_arccaster_chain_hi.name': '전량 방전',
  'activeSkill.as_arccaster_chain_hi.desc':
    '모아둔 과충전을 한 번에 방전해 충전량만큼 전격을 쏟습니다.',
  'activeSkill.as_arccaster_barrage_lo.name': '위상 점멸',
  'activeSkill.as_arccaster_barrage_lo.desc': '과충전을 잃지 않은 채 600 거리를 점멸 이동합니다.',
  'activeSkill.as_arccaster_barrage_hi.name': '상한 도약',
  'activeSkill.as_arccaster_barrage_hi.desc':
    '900 거리를 도약하고 착지와 동시에 과충전이 상한에 닿습니다.',
  'activeSkill.as_arccaster_barrier_lo.name': '유동 충전',
  'activeSkill.as_arccaster_barrier_lo.desc': '180틱 동안 움직이면서도 과충전이 계속 쌓입니다.',
  'activeSkill.as_arccaster_barrier_hi.name': '고정 과충전',
  'activeSkill.as_arccaster_barrier_hi.desc':
    '300틱 동안 과충전이 상한에 고정되어 무엇을 해도 풀리지 않습니다.',
  'activeSkill.as_phantom_assassin_lo.name': '그림자 파열',
  'activeSkill.as_phantom_assassin_lo.desc':
    '은신을 즉시 끊어 해제 첫 타 배율이 실린 단검 12발을 던집니다.',
  'activeSkill.as_phantom_assassin_hi.name': '순간 암살',
  'activeSkill.as_phantom_assassin_hi.desc':
    '은신에 들어가는 즉시 빠져나오며 24발 전탄에 해제 배율을 싣습니다.',
  'activeSkill.as_phantom_phase_lo.name': '위상 활강',
  'activeSkill.as_phantom_phase_lo.desc':
    '600 거리를 미끄러지며 은신 진입 조건을 120틱만큼 앞당깁니다.',
  'activeSkill.as_phantom_phase_hi.name': '심연 도약',
  'activeSkill.as_phantom_phase_hi.desc': '900 거리를 위상 이동하고 착지하는 순간 은신에 들어갑니다.',
  'activeSkill.as_phantom_disrupt_lo.name': '은신 유지',
  'activeSkill.as_phantom_disrupt_lo.desc': '180틱 동안 맞아도 은신 조건이 리셋되지 않습니다.',
  'activeSkill.as_phantom_disrupt_hi.name': '무한 초격',
  'activeSkill.as_phantom_disrupt_hi.desc':
    '300틱 동안 해제 첫 타 배율이 소모되지 않고 계속 실립니다.',
  'activeSkill.as_hatchling_brood_lo.name': '알 흩뿌리기',
  'activeSkill.as_hatchling_brood_lo.desc': '알탄 12발을 흩뿌리고 다음 부화를 크게 앞당깁니다.',
  'activeSkill.as_hatchling_brood_hi.name': '부화 소각',
  'activeSkill.as_hatchling_brood_hi.desc':
    '쌓인 부화 진행도를 전부 태워 알탄 24발을 한 번에 터뜨립니다.',
  'activeSkill.as_hatchling_nurture_lo.name': '알 구르기',
  'activeSkill.as_hatchling_nurture_lo.desc': '600 거리를 굴러 이동하고 부화를 조금 앞당깁니다.',
  'activeSkill.as_hatchling_nurture_hi.name': '둥지 도약',
  'activeSkill.as_hatchling_nurture_hi.desc': '900 거리를 도약하고 부화를 적 12기를 잡은 만큼 앞당깁니다.',
  'activeSkill.as_hatchling_shelter_lo.name': '온기 품기',
  'activeSkill.as_hatchling_shelter_lo.desc': '180틱 동안 부화가 계속 조금씩 앞당겨집니다.',
  'activeSkill.as_hatchling_shelter_hi.name': '둥지 개방',
  'activeSkill.as_hatchling_shelter_hi.desc':
    '300틱 동안 부화 임계가 항상 충족된 상태로 유지됩니다.',
  'activeSkill.as_mallow_squish_lo.name': '되돌린 아픔',
  'activeSkill.as_mallow_squish_lo.desc': '미뤄둔 피해를 전부 탄으로 바꿔 되돌려줍니다.',
  'activeSkill.as_mallow_squish_hi.name': '이월 폭발',
  'activeSkill.as_mallow_squish_hi.desc':
    '미뤄둔 피해를 두 배로 늘리는 대가로 24발을 한 번에 터뜨립니다.',
  'activeSkill.as_mallow_mend_lo.name': '반동 튕김',
  'activeSkill.as_mallow_mend_lo.desc':
    '600 거리를 튕겨 이동하고 착지하는 순간 미뤄둔 피해를 정산합니다.',
  'activeSkill.as_mallow_mend_hi.name': '탄력 도약',
  'activeSkill.as_mallow_mend_hi.desc': '900 거리를 도약하며 미뤄둔 피해를 절반으로 줄이고 정산합니다.',
  'activeSkill.as_mallow_cushion_lo.name': '빠른 회복',
  'activeSkill.as_mallow_cushion_lo.desc': '180틱 동안 회복 임계가 세 배 빠르게 채워집니다.',
  'activeSkill.as_mallow_cushion_hi.name': '전량 유예',
  'activeSkill.as_mallow_cushion_hi.desc':
    '300틱 동안 모든 피해를 미뤄두고, 끝나는 순간 한 번에 정산합니다.',
  'activeSkill.as_bubble_pop_lo.name': '강제 파열',
  'activeSkill.as_bubble_pop_lo.desc': '막을 즉시 터뜨려 거품탄 12발과 함께 주변을 밀어냅니다.',
  'activeSkill.as_bubble_pop_hi.name': '막 환산',
  'activeSkill.as_bubble_pop_hi.desc': '남은 막을 전부 거품탄으로 바꿔 쏟아냅니다.',
  'activeSkill.as_bubble_drift_lo.name': '부양 활공',
  'activeSkill.as_bubble_drift_lo.desc': '600 거리를 떠서 이동하고 막 재생을 절반만큼 앞당깁니다.',
  'activeSkill.as_bubble_drift_hi.name': '기류 도약',
  'activeSkill.as_bubble_drift_hi.desc': '900 거리를 떠서 이동하고 착지하는 순간 막이 다시 섭니다.',
  'activeSkill.as_bubble_film_lo.name': '막 재충전',
  'activeSkill.as_bubble_film_lo.desc':
    '막을 즉시 가득 채우고 180틱 동안 재생이 두 배로 빨라집니다.',
  'activeSkill.as_bubble_film_hi.name': '불멸 막',
  'activeSkill.as_bubble_film_hi.desc':
    '300틱 동안 막이 매 틱 다시 차오르고, 끝날 때 크게 터집니다.',

  // --- 지시 수신소(Phase E) ---
  'commission.title': '지시 수신소',
  'commission.sub': '의뢰서를 수락하면 그 자리에서 출격합니다',
  'commission.stock': '보유 {n}/{cap}',
  'commission.empty': '보유한 의뢰서가 없습니다. 행성 보스를 처치하면 드물게 얻습니다.',
  'commission.offline': '의뢰서는 온라인 전용입니다 — 접속해야 보유 목록을 볼 수 있습니다.',
  'commission.grade.1': '정기 지시',
  'commission.grade.2': '우선 지시',
  'commission.grade.3': '특급 지시',
  'commission.grade.4': '최종 지시',
  'commission.order.chain': '연쇄 원정',
  'commission.order.constraint': '제약 계약',
  'commission.order.bounty': '현상금 표적',
  'commission.order.elite': '정예 소집령',
  // ⚠️ EN 원문의 `stages` 는 런의 **구간**(segment)이고 침략 단계(`commission.stageLine` 의
  // '침략 {stage}단계')와는 다른 축이다. 그 충돌을 피하려고 '무대'를 골랐던 자리인데, 정작
  // 게임이 같은 것을 이미 **구간**이라 부르고 있었다(`hud.bossEta.segment` = '{n}/{total} 구간').
  // 한 제품에서 같은 것을 두 이름으로 부르면 그 자체가 어색함이다 — HUD 쪽 이름으로 통일한다.
  'commission.segments': '{n}개 구간',
  'commission.rewards.credits': '크레딧 +{n}',
  'commission.rewards.minerals': '광물 +{n}',
  'commission.rewards.items': '아이템 +{n}',
  'commission.rewards.xp': '경험치 +{n}',
  'commission.rewards.unique': '유니크 확정',
  'commission.eliteNoGrowth': '런 내 성장 없음 — 경험치 젬도, 레벨업도, 파워업 선택도 없습니다. 영구 성장만으로 싸웁니다.',
  'commission.constraint.bannedSlots': '봉인: {list}',
  'commission.constraint.maxRarity': '{name} 이하만',
  'commission.constraint.bannedUniques': '봉인 유니크: {list}',
  'commission.constraint.bannedPowerups': '금지 성장: {list}',
  'commission.launch': '출격',
  'commission.launching': '출격 중…',
  // 폐기(2026-08-03) — 보관 상한이 차면 새 의뢰서가 발령되지 않는데, 상한을 내리는 길이
  // 출격 하나뿐이었다. 되돌릴 수 없으므로 문구가 그 사실을 먼저 말한다.
  'commission.discard': '폐기',
  'commission.discard.title': '의뢰서 폐기',
  'commission.discard.body':
    '되돌릴 수 없습니다. 보유 목록에서 지워지고 적힌 보상도 함께 사라집니다. 대신 보관 자리가 비어 새 의뢰서가 다시 들어옵니다.',
  'commission.discard.confirm': '폐기하기',
  'commission.discard.cancel': '그대로 두기',
  // 2026-08-03 AAA 시네마틱 전환(2열 목록/상세) — 각인 패널 제목과 상세 챔버 넷.
  'commission.list.head': '보유 의뢰서',
  'commission.detail.head': '의뢰서 상세',
  'commission.detail.brief': '의뢰 개요',
  'commission.detail.stages': '구간', // `commission.segments` 와 같은 이름(위 주석 참조).
  'commission.detail.rewards': '확정 보상',
  'commission.detail.constraints': '제약',
  'commission.detail.noConstraints': '추가 제약 없음.',
  'commission.stageLine': '{name} · 침략 {stage}단계',
  'commission.list.tail': '아직 자리가 남았습니다. 행성 보스가 새 의뢰서를 내립니다.',
  // 아무것도 선택되지 않은 상세 열이 받는 안내 셋 — 이 화면의 **기본 상태**(보유 0 · 오프라인)
  // 에서 플레이어가 알아야 하는 것은 "고르라"가 아니라 "어떻게 얻고 몇 장까지 쌓이는가"다.
  'commission.about.what': '의뢰서란',
  // ⚠️ 의뢰서가 생기는 일은 `발급`, 급수는 `등급` 이다(사용자 확정 2026-08-05). 한때 이 칸만
  // `발령`·`계급` 을 쓰고 도움말은 `발급`·`등급` 을 써서 한 화면이 같은 것을 두 이름으로 불렀다.
  // 두 자리를 함께 고치지 않으면 그 갈림이 그대로 재발한다.
  // ⚠️ 예전 문구는 '발령 시점에 굳은 종이입니다' 였다. EN 원문 `A sealed order` 의 "봉인"을
  // "굳은"으로 직역한 것인데, 한국어에서 '굳은 종이'는 봉인이 아니라 **뻣뻣한 종이**로 읽힌다
  // (사용자 지적 2026-08-04). 은유를 버리고 규칙을 그대로 적는다 — 이 칸이 실제로 알려 줘야
  // 하는 것은 "내용이 언제 정해지는가"이지 종이의 재질이 아니다.
  'commission.about.whatBody':
    '발급되는 순간 내용이 확정되는 의뢰서입니다. 구간과 보상이 그때 정해지고, 완수하면 적힌 그대로 지급됩니다.',
  'commission.about.get': '얻는 법',
  // '높을수록 높은'의 반복을 피한다 — 같은 낱말이 한 문장에 두 번 나오면 규칙보다 말투가 먼저 읽힌다.
  'commission.about.getBody':
    '행성 보스를 처치하면 드물게 발급됩니다. 침략 단계가 높을수록 상위 등급이 나옵니다.',
  'commission.about.stock': '보관',
  'commission.about.stockBody':
    '{cap}장까지 보관합니다. 꽉 차 있는 동안에는 새 의뢰서가 들어오지 않습니다 — 먼저 출격해 자리를 비우세요.',

  // 지시 수신소 도움말(사용자 요청 2026-08-05). 용어는 KO 정본표를 따른다 — `의뢰서`(건물명
  // `지시 수신소`는 세계관 플레이버라 유지) · `촉매` · `침략 단계` · `파워업`. 이모지 금지, 존댓말.
  'commission.help': '도움말',
  'commission.help.title': '지시 수신소 안내',
  'commission.help.s1.h': '의뢰서란 무엇인가요',
  'commission.help.s1.b':
    '의뢰서는 발급되는 순간 내용이 봉인되는 문서입니다. 어느 구간을 도는지, 어떤 제약이 걸리는지, 무엇을 받는지가 그때 전부 적혀 확정됩니다. 완수하면 적힌 그대로 지급되며 굴림도 편차도 없습니다.\n보상이 굴림이 아니라 약속이라서 행성 인기 배율이 걸리지 않습니다.',
  'commission.help.s2.h': '어떻게 얻나요',
  'commission.help.s2.b':
    '행성 보스가 쓰러질 때 드물게 발급됩니다. 보스를 잡아 이긴 런에서만 나오며, 침략 단계가 높을수록 상위 등급이 나옵니다.\n의뢰 런은 다시 의뢰서를 낳지 않습니다. 더 얻으려면 평범한 파밍으로 돌아와야 하고, 이 규칙이 순환이 스스로 불어나는 것을 막습니다.\n보유할 수 있는 장수에는 상한이 있습니다. 꽉 차 있는 동안에는 새 의뢰서가 들어오지 않으니 먼저 출격해 자리를 비워 주세요.',
  'commission.help.s3.h': '의뢰 런은 어떤 런인가요',
  'commission.help.s3.b':
    '의뢰 런은 침공과 같은 문법입니다. 여러 구간을 한 번의 런으로 통과해 정산을 한 번만 하고, 자원이 구간을 넘어 승계되며, 중간에 죽어도 돌아갈 체크포인트가 없습니다.\n다른 점은 구간 경계에서 바뀌는 것입니다. 침공은 스크롤 방향이 바뀌지만 의뢰 런은 행성 모드가 통째로 바뀝니다.\n의뢰서와 촉매는 같은 런에 함께 들어가지 않습니다. 촉매는 평범한 런의 난이도와 보상을 함께 올리는 것이고, 의뢰서는 도는 구간이 이미 적혀 있는 별개의 런을 여는 것이기 때문입니다.',
  'commission.help.s4.h': '제약',
  'commission.help.s4.b':
    '의뢰서에 제약이 붙는 경우가 있습니다. 이 제약은 런 도중에 감시하는 것이 아니라, 금지된 것을 출격 장비 선택지와 파워업 후보에서 아예 빼는 방식으로 강제합니다. 어기는 것이 벌을 받는 일이 아니라 애초에 불가능한 일입니다.\n제약이 없는 의뢰서는 의뢰서 상세에 없다고 분명히 적어 드립니다.',
  'commission.help.s5.h': '이 화면은 왜 로그인이 필요한가요',
  'commission.help.s5.b':
    '보유한 의뢰서와 그것이 확정 지급하는 물건의 기록을 서버가 쥐고 있습니다. 그래서 의뢰서 획득과 의뢰 출격은 접속이 필요합니다.\n의뢰 런은 리플레이를 제출하는 유일한 PvE 런이기도 합니다. 보상이 굴림이 아니라 확정 지급이라, 서버가 런을 처음부터 다시 돌려 확인한 뒤에 지급합니다.',

  // 일일 보상 통지 팝업 (ADR-0048 §화면 · `src/ui/pixi/dailyRewardModal.ts`).
  //
  // 용어 정본은 CONTEXT.md 경제 절이다 — `일일 보상` · `보상 예고` · `연속 접속` · `진행 견인`.
  // ⚠️ 기피어 금지: `출석 보상`(근태 문법 — 이 세계엔 학교도 직장도 없고 지급 주체는 죽은
  //    자동 시스템이다) · `로그인 보너스` · `데일리` · `출석 일수` · `streak`(원어 표기) ·
  //    `누적 접속일`(리셋이 없다는 오해). 등급 사다리는 노말·매직·레어·유니크(`item.rarity.*`
  //    재사용) · 의뢰서 계급은 `commission.grade.*` 재사용 · 닫기는 `common.close` 재사용.
  // ⚠️ `daily.help.ceiling` 의 앵커는 **서버가 지급한 총량**이다. 옛 문구 *"자기 최고 클리어
  //    단계에 묶인다"* 는 거짓이다 — 상한 앵커가 `pve_runs` 의 단계에서 `profiles.lifetime_granted`
  //    로 바뀌었고(클라가 채우는 주장은 앵커가 될 수 없다), 그 문구를 쓰면 화면이 플레이어에게
  //    거짓을 말한다. `tests/dailyRewardModal.test.ts` 가 그 표현의 부재를 잠근다.
  'daily.title': '일일 보상',
  'daily.streak': '연속 접속 {n}일차',
  'daily.chip': '연속 접속 {n}/{max}',
  'daily.streak.sub': '{max}일 주기입니다. {max}일차가 가장 높고, 그다음 날은 1일차로 돌아갑니다.',
  'daily.today': '오늘 받은 것',
  'daily.today.notice': '기지에 들어온 순간 이미 지급되었습니다. 따로 누를 것은 없습니다.',
  'daily.today.side': '곁들여 크레딧 {n} 이 함께 들어왔습니다.',
  'daily.step': '그 목표까지 {total}걸음 중 {index}걸음째입니다.',
  'daily.tomorrow': '내일 보상 예고',
  'daily.tomorrow.hidden': '무엇이 오는지까지만 적혀 있습니다. 세부 값은 내일 받을 때 정해집니다.',
  'daily.tomorrow.none': '내일 것은 아직 적히지 않았습니다.',
  'daily.count': '{n}개',
  'daily.uses': '사용 {n}회',
  'daily.amount.credits': '크레딧 {n}',
  'daily.amount.minerals': '광물 {n}',
  'daily.axis.currency': '재화',
  'daily.axis.catalyst': '촉매',
  'daily.axis.blueprint': '설계도',
  'daily.axis.coreModule': '코어 모듈',
  'daily.axis.gear': '장비',
  'daily.axis.commission': '의뢰서',
  'daily.help.reset': '하루라도 놓치면 1일차로 돌아갑니다. 그날 적어 둔 예고도 함께 사라집니다.',
  'daily.help.ceiling': '받을 수 있는 것의 상한은 지금까지 서버가 지급한 총량에 묶입니다.',
};

/** 로케일별 카탈로그 묶음. */
export const CATALOG = { en: EN, ko: KO } as const;
