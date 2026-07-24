# 구현 계획: Planet Blitz 사운드 풍성화

- 상태: **pending approval** (합의 정제 완료 — Architect + Critic 반영)
- 입력 명세: `.omc/specs/deep-interview-sound-enrichment.md` (ambiguity 18.5% PASSED)
- 모드: consensus / short / non-interactive
- 근거 ADR: ADR-0029(하이브리드 에셋), ADR-0005(결정론). 본 계획 §ADR 참조.

## Requirements Summary
4개 축에서 사운드를 확장한다: BGM 도입(외부 5트랙, 하이브리드) · 3버스 믹싱 · SFX 확장(등급/무기/패닝/UI음/보이스관리) · 침공 배선(라이브 SFX·관전 BGM만). 모든 사운드는 render 계층에 머물러 결정론(ADR-0005)에 무관하며, `RunSoundObserver`를 **render-only 관측**(스칼라 델타 + 호출부 엔티티 스캔)으로 확장한다.

## RALPLAN-DR 요약 (short)

### Principles (5)
1. **결정론 성역** — 사운드는 render-only. `src/sim/`에서 audio import 금지, sim은 사운드 큐를 emit하지 않는다. 해시·리플레이·정산 불변.
2. **render-only 관측 일관성** — 신규 트리거는 `RunSoundObserver` 관측을 재사용하되, 관측 방식은 **스칼라 스냅샷 델타 + (좌표·rarity·bullet-kind가 필요한 경우) 호출부의 `w` 엔티티 스캔** 두 형태를 명시적으로 허용한다. 새 pub/sub 이벤트 채널은 신설하지 않는다. `SoundFrame`은 스칼라만 유지하고, per-entity 데이터(드랍 좌표·rarity·특수탄)는 호출부(main.ts)에서 도출해 `play()`의 별도 opts/events로 전달한다(코어 프레임 비대화 방지).
3. **하이브리드 절제** — SFX는 절차 합성 유지, BGM만 외부 루프(ADR-0029). 외부 오디오 라이브러리 미도입.
4. **밸런스 유예** — 구조/배선만 확정, 수치(지터·스로틀 ms·크로스페이드 duration·보이스 상한)는 출시 전 밸런스 패스. **버스 기본 볼륨(BGM 0.5·SFX 0.6·UI 0.5)은 잠정값으로 코드에 두되 밸런스 패스 조정 대상임을 표기**(유예 목록에서 별도 취급).
5. **시각/청각 대칭** — 등급 팡파레는 시각 레지스터(등급=강조, 유니크만 고유)와 정합.

### 책임 분해 (God 객체 회피 — Architect antithesis 반영)
관찰자 확장이 GameAudio·RunSoundObserver를 God 객체로 부풀리지 않도록 책임을 나눈다:
- **GameAudio**: 저수준 절차 신스 + 3버스 GainNode 호스트 + **VoiceAllocator**(활성 source 추적·스로틀·voice-steal). ctx·GainNode·레시피 소유.
- **musicDirector**(신규 별도 모듈): 트랙 디코드·crossfade 엔벨로프·seamless loop·prefetch·존 상태기계. GameAudio와 생애주기가 전혀 달라 **흡수하지 않고 분리**. `bgmGain`을 **명시적 접근자**로 받는다(privates reach-in 금지).
- **RunSoundObserver**: 스칼라 델타 differ 유지. per-entity 데이터는 호출부에서 도출해 주입.

### Decision Drivers (top 3)
1. CrazyGames 상업 배포 제약 — 라이선스 명확성 · 번들/초기 로딩.
2. 탄막 밀도에서의 청감 — 소리 폭주 방지(보이스 관리).
3. 기존 아키텍처 최소 변경 — 관찰자 확장 + 3버스, 대규모 리팩터 회피.

### Viable Options
- **Option A (채택): render-only 관측 확장(스칼라 델타 + 호출부 엔티티 스캔) + 3버스 GainNode + 별도 musicDirector.**
  - Pros: 기존 패턴 재사용, 저위험, 결정론 자연 보존, 순수함수 테스트 용이, 점진 배선.
  - Cons: `play()` opts 확장 필요, 다수 파일 터치. → 책임 분해로 God 객체화 완화.
- **Option B: 사운드 이벤트 버스(pub/sub) 신설 — sim이 이벤트 emit, render 구독.** Pros: 확장성. Cons: sim→render 결합 유입(**원칙1 위반**), 대규모 리팩터. → **기각**. (중간지대 "render 측 경량 이벤트 큐"는 Option A의 호출부 events 주입으로 흡수 — sim 무접촉이라 별 채널 불요.)
- **Option C: 외부 오디오 라이브러리(Howler.js 등) 도입.** Pros: crossfade·풀 관리 기성. Cons: 번들 증가, 절차 합성과 이중 스택, lock-in(**원칙3·드라이버1 위반**). → **기각**.

## Acceptance Criteria (명세 승계 + 합의 정정)
정정분은 **[정정]** 표기. 나머지는 명세 §AC 승계.

### bgm-zone
- AC1: 4개 지속 존(menu / combatPvE / boss / invasion) + 정산 스팅어(one-shot). 계 "5 존".
- AC2: 메타 화면 전부(title·base·defense·archive·controlTower·starMap·inventory·research·refinery) → `menu` 존.
- AC3 **[정정]**: `run` 화면은 **런 종류 플래그로 분기** — 3개 진입점 모두 `setScreen('run')` 직전 런종류 플래그 설정(정식 침공 main.ts:819-820, 하네스 침공 869-870, PvE 986-987). 침공 런(정식+하네스) → `invasion` 존, PvE 런 → `combatPvE` 존.
- AC4 **[정정]**: 보스존 트리거 = observe `hasBoss`(=`kind==='boss'`) false→true. 침공 L3 코어 보스는 `kind:'defenseBoss'`라 이 델타에 안 걸림 → v1은 침공존 유지(별도 보스존 없음). 최소 유지시간 가드로 짧은 보스전 thrash 방지. `hasDefenseBoss` 관측(침공 클라이맥스 큐)은 확장 예약.
- AC5: 관전(`spectate` 화면) → `invasion` 존 BGM.
- AC6: 런 종료→`result`(main.ts:1122) 진입 시 전투·보스존 정지 → 정산 스팅어 1회(승/패 분기) → 스팅어 종료 후 `menu` 존 복귀.
- AC7: 존 전환 equal-power 크로스페이드, 트랙 seamless loop(**AudioBufferSourceNode `loop=true`** — HTMLAudioElement 루프 갭 회피). 메뉴곡 첫 제스처(unlock) 로드, 나머지 화면 전환 직전 프리페치.

### mixing-bus
- AC8: `master` 아래 BGM/SFX/UI 3 GainNode, 각 사운드를 버스로 라우팅. 전역 muted = master gain 0(정상 master gain=1).
- AC9 **[정정]**: `AudioSettings {muted, bgmVolume, sfxVolume, uiVolume}`. 기본값 BGM 0.5·SFX 0.6·UI 0.5(**잠정값 — 밸런스 조정 대상**).
- AC10: `parseAudioSettings` 레거시 `{muted, volume}` 감지 → `volume`을 3버스 동일 복사(무손실). 테스트 필수.
- AC11 **[정정]**: 슬라이더 3개 + 전역 음소거 토글. **구현 위치 확인** — `buildSlider` 정의는 `pixi/settingsPanel.ts:351`(호출부 271). DOM `src/ui/settingsPanel.ts`가 ADR-0014로 사문화됐으면 Pixi만 구현(이중 구현 회피). "음악만 끄기"는 BGM 슬라이더 0으로 달성(버스별 음소거 없음).

### sfx-expansion
- AC12 **[정정]**: 무기 발사음 = weaponType **0~4 5종**(VULCAN0·SPREAD1·RAILGUN2·MISSILE3·BEAM4, world.ts:1829-1832). 6번째 없음. observe 호출부가 `w.weapon.weaponType` 전달.
- AC13 **[정정]**: **드랍 순간** 3단계 사운드 — 두 드랍 경로 모두 처리:
  - (i) 바닥 드랍: `spawnLoot`가 `kind:'loot'` 엔티티 생성(world.ts:3267; 좌표 x + rarity=`enemyType`, entities.ts:440-455). 호출부가 **신규 loot 엔티티 등장**을 감지(엔티티 id 추적) → rarity + 좌표.
  - (ii) 보스/승리틱 직행 드랍: `state.loot`에 엔티티 없이 직접 push(world.ts:3255,3264). 호출부가 **엔티티 없는 state.loot 증분**(당 프레임 수거로 설명 안 되는 증가)을 감지 → rarity(좌표 없음 → 중앙 pan).
  - **더블카운트 금지**: 바닥 드랍 loot의 이후 수거(collectLoot push)를 드랍으로 오인 금지 — 엔티티 id 소비 추적으로 구분. 테스트로 "실드랍 1회당 사운드 1회" 단언.
- AC14: 드랍 3단계 매핑 — 노말(0)·매직(1) 공용 획득음 / 레어(2) 강조음 / 유니크(3) 팡파레. 보스 유니크(경로 ii) 포함.
- AC15 **[정정]**: 좌우 패닝(거리 감쇠 없음) — **바닥 loot 엔티티 드랍 한정**(좌표 보유). 보스 직행 드랍은 좌표 없음 → 중앙(pan 0). 처치·pickup·hit는 트리거가 좌표 없는 스칼라라 **패닝 descope**(명세 Round 4 정합). 화면 밖 loot는 무음(레이더 담당).
- AC16: 메타 UI음 4~5 의미범주(navigate·confirm·positive·negative·celebrate) 재사용, UI 버스.
- AC17: 반복 SFX 미세 랜덤 지터(피치·게인) + 처치·피격 레이어 보강(기존 `hit`/`kill` 합성 audio.ts:194-201 위에 레이어 추가).
- AC18: 보이스 관리 — 사운드별 최소간격 스로틀 + **동시 활성 source 상한**(1 play가 N source면 N 카운트, 초과 시 oldest source stop).
- AC19 **[정정]**: 적탄 경고음 = **보스 소유탄 및/또는 특수 거동탄**(`enemyBullet.enemyType` 거동 코드 BK_ACCEL/HOMING/CURVE/SPLIT ≠ BK_NONE, bullets.ts:32-36)만. 잡몹 직진탄 무음. 호출부가 `w.entities`의 enemyBullet를 스캔해 판별(신규 sim 플래그 추가 금지 — render 관측만, 결정론 무관). 폭주는 AC18 보이스 상한으로 유계.

### invasion-gating
- AC20: 라이브 침공(`run` 화면 + 침공 런) → SFX 전량(기존 observe 재사용).
- AC21: 관전(`spectate` 화면 또는 `spectatePlaying`) → SFX 게이트 off, `invasion` 존 BGM만.

## Implementation Steps

### Phase 1 — mixing-bus (기반)
1. `src/render/audio.ts`: `ensureCtx()`에서 `master` 아래 `bgmGain`/`sfxGain`/`uiGain` 생성·연결. `getBus(name)` 접근자(musicDirector용).
2. `AudioSettings` 확장 + `DEFAULT_AUDIO_SETTINGS`(잠정 0.5/0.6/0.5). `clampVolume` 재사용.
3. `parseAudioSettings` 레거시 마이그레이션(구 `volume`→3버스 복사). serialize/readStored/writeStored 갱신.
4. `setBusVolume(bus,v)`/`setMuted`/`applyGain()`(버스별). muted=master 0.
5. `play()` 각 SoundName→버스 라우팅(전투 SFX→sfx, ui계열→ui).
6. `src/ui/pixi/settingsPanel.ts`(정의 351): 슬라이더 3 + 음소거 토글. DOM `settingsPanel.ts` 사문화 여부 확인 후 이중 구현 회피.
7. `tests/audioSettings.test.ts`: 레거시 마이그레이션·clamp·serialize 왕복·기본값.

### Phase 2 — sfx-expansion (P1 후, P3와 병렬)
8. `src/render/soundScape.ts`: `SoundFrame`에 스칼라만 추가(`weaponType`). **드랍·패닝·특수탄은 SoundFrame에 넣지 않고** 호출부에서 도출해 `play()` opts로 전달(원칙2·책임분해).
9. `src/render/audio.ts` `play(name, opts?)`: `opts.pan`(StereoPanner), `opts.weaponType`(5발사음 변주), 드랍 3단계 SoundName(`dropCommon`/`dropRare`/`dropUnique`), UI 4~5 범주 SoundName, 지터, VoiceAllocator(스로틀맵 + 동시 source 상한 + oldest steal). voice는 per-source 카운트.
10. `src/main.ts` observe 호출부(1337): (a) 신규 `kind:'loot'` 엔티티 등장 감지(id 추적)→rarity+좌표, (b) 엔티티 없는 `state.loot` 증분(보스 직행)→rarity(중앙), (c) 더블카운트 방지(수거 push 제외), (d) `w.weapon.weaponType` 전달, (e) loot 좌표와 player x로 pan 산출(화면밖 무음), (f) enemyBullet 스캔으로 특수탄 경고 판별.
11. Step 11(구) 삭제 — AC19로 통합(위 10-f). sim 플래그 추가 없음.

### Phase 3 — bgm-zone (P1 후, P2와 병렬)
12. `src/render/musicDirector.ts`(신규): 존 상태기계(menu/combatPvE/boss/invasion) + 스팅어. AudioBufferSourceNode(loop) 디코드·프리페치, equal-power crossfade. `bgmGain` 접근자 사용. **unlock 핸드셰이크**: ctx 미준비 시 요청 존 큐잉→unlock에서 시작(타이틀 메뉴곡은 첫 제스처까지 지연 — 자동재생 정책, 명시). 5트랙 디코드 RAM은 지연 로드로 완화.
13. `src/main.ts` `setScreen()`(404): 화면→존 매핑. `run`은 런종류 플래그(AC3의 3진입점)로 combatPvE/invasion 분기. `result`→스팅어 시퀀스→menu.
14. `src/main.ts` observe(1337): `hasBoss` false→true→보스존 crossfade(최소 유지 가드), 보스 처치/런 종료→복귀. defenseBoss는 미해당(문서화).
15. 에셋: 로열티프리·상업 라이선스 5트랙(ogg+mp3, ~1–2MB). `assets/audio/` + `assets/audio/CREDITS.md`(트랙별 출처·라이선스). 프리페치 배선.

### Phase 4 — invasion-gating (P2·P3 후)
16. observe/soundScape: 관전 상태(`spectate` 화면 or `spectatePlaying`)→SFX 계열 억제, invasion 존 BGM 유지. 라이브 침공은 SFX 전량.

## Risks and Mitigations
| # | Risk | Mitigation |
|---|------|-----------|
| R1 | 결정론 회귀(sim→render 결합) | 전부 `src/render/`; sim import 금지; sim은 사운드 emit 안 함; 기존 sim 해시 테스트 그린; grep로 `src/sim/**`의 `render/audio` import 0 검증 |
| R2 | 에셋 라이선스 하자 → CrazyGames 거부 | CC0/명확한 상업 라이선스만; 트랙별 `CREDITS.md`; 머지 전 검증 |
| R3 | 번들/초기 로딩 악화 | 지연+프리페치; ~1–2MB/트랙; ogg+mp3; 빌드 후 초기 페이로드에 음악 미포함 측정 |
| R4 | 보이스 폭주(CPU·소음), 특히 AC19 특수탄 | 사운드별 스로틀 + 동시 source 상한(AC18); AC19는 보스/특수탄 한정 + 상한 유계 |
| R5 | 설정 마이그레이션 데이터 손실 | 레거시 volume→3버스 비파괴 복사; 전용 테스트 |
| R6 | 보스존 thrash(짧은 보스전) | 최소 유지시간 가드(AC4) |
| R7 **[정정]** | 드랍 패닝 좌표 | 바닥 loot 엔티티는 좌표 보유→유효; 보스/승리틱 직행 드랍은 좌표 없음→중앙(pan 0); 처치·pickup·hit는 스칼라 트리거라 패닝 descope. 트리거는 신규 배선(엔티티 등장 + state.loot 증분 이원 관측) |
| R8 **[신규]** | 드랍음 더블카운트(바닥 드랍 수거를 드랍으로 오인) | 엔티티 id 소비 추적으로 드랍 vs 수거 구분; "실드랍 1회당 사운드 1회" 테스트 |

## Verification Steps
1. **Unit(vitest)**: `audioSettings.test.ts` — 레거시 마이그레이션·clamp·serialize·기본값.
2. **Integration(vitest, 순수함수)** **[강화]**: 드랍 관측을 **드랍 순간 의미**로 테스트 — (a) 바닥 loot 엔티티 등장→해당 rarity 사운드 1회, (b) **보스 무엔티티 직행 드랍(state.loot 직접 push)→유니크 팡파레 1회**, (c) 바닥 드랍 수거는 사운드 없음(더블카운트 금지), (d) weaponType 0~4 5종 각각 발사음 매핑, (e) AC19 특수탄(BK_* / 보스탄) 판별 vs 잡몹 직진탄 무음, (f) 보스 hasBoss 전이. 오디오 컨텍스트 없이 순수함수로.
3. **결정론**: 기존 sim 테스트(`invasionHash`/`fullRun` 등) 그린(해시 불변); `grep -r "render/audio" src/sim` = 0.
4. **수동/하네스(browser preview)**: 화면별 존, 런종류 분기(PvE combatPvE vs 침공 invasion), 보스 crossfade, 드랍 등급음(바닥+보스 유니크), 5발사음, 3버스 슬라이더 라이브, 관전 BGM-only, 정산 스팅어 시퀀스.
5. **번들**: `pnpm build` 후 초기 청크에 음악 에셋 미포함(지연 로딩) 확인 — dist 청크 목록에서 audio 파일이 별도/지연임을 검사.

## 실행 순서·병렬성
Phase 1(기반) → Phase 2·3 병렬 → Phase 4. team 레인: Lane-mixing(P1), Lane-sfx(P2), Lane-bgm(P3), Lane-invasion(P4).

## ADR
### Decision
Planet Blitz 사운드를 render-only 관측 확장(스칼라 델타 + 호출부 엔티티 스캔) + 3버스 GainNode + 별도 `musicDirector` 모듈로 풍성화한다. BGM만 외부 5트랙(하이브리드, ADR-0029), SFX는 절차 합성 유지.
### Drivers
CrazyGames 상업 배포 제약(라이선스·번들) · 탄막 밀도 청감(폭주 방지) · 기존 아키텍처 최소 변경(결정론 보존).
### Alternatives considered
- pub/sub 이벤트 버스(B): sim→render 결합으로 결정론 위반 → 기각.
- 외부 오디오 라이브러리(C): 번들·이중 스택·lock-in → 기각.
### Why chosen
기존 관찰자 패턴을 render-only로 확장하면 결정론을 자연 보존하면서 점진 배선·순수함수 테스트가 가능. 책임 분해(GameAudio=신스+버스+VoiceAllocator, musicDirector 분리, SoundFrame 스칼라 유지)로 God 객체화를 회피.
### Consequences
- 드랍 관측이 스칼라 델타에서 **이원(엔티티 등장 + state.loot 직행 증분) 관측**으로 확장 — 더블카운트 가드·테스트 필수.
- 처치음 패닝은 구조적 불가(compact로 위치 소실) → 드랍 한정.
- 침공 L3 defenseBoss는 boss존 미트리거(v1 침공존 유지) — 클라이맥스 큐는 확장 예약.
- 타이틀 메뉴 BGM은 자동재생 정책상 첫 제스처까지 지연.
- CrazyGames용 트랙 라이선스 관리 책임 발생(CREDITS.md).
### Follow-ups
- `hasDefenseBoss` 관측(침공 클라이맥스 음악) 확장.
- 행성/모드별 전투곡 변주.
- 밸런스 패스에서 지터·스로틀·crossfade·보이스 상한·버스 기본값 튜닝.
- weaponType 6번째 추가 시 발사음 확장.
- **AC19 보스 직진탄 경고(문서화된 v1 한계)**: 경고음은 특수 거동탄(`enemyBullet.enemyType` ≠ BK_NONE)만 낸다. 보스의 직진 패턴탄(예: `laserNet`·`polygonSpin`, `applyBehavior` 미적용 = BK_NONE)은 render 가 소유주를 식별할 신호(`ownerId` 미설정)가 없어 경고에서 빠진다. 계획의 "render 관측만 · 신규 sim 플래그 추가 금지"(AC19) 제약에 내재된 한계다. 개선하려면 보스탄에 render 가 읽을 수 있는 소유 태그(결정론 무관한 render 파생 신호 또는 별도 sim 필드)가 필요 — 후속 검토. 특수 거동 보스탄(ring/spiral/aimedBurst 등)은 v1 에서 이미 커버된다.
- **AC16 메타 UI음 의미 범주 세분 배선**: 현재 공유 `PixiButton` 이 기본 `uiNavigate` 를, 주요 출격 CTA(PvE 출격·소집 출격)가 `uiConfirm` 을 낸다(팔레트 5범주 정의 완료·UI 버스 라우팅 완료). `uiPositive`/`uiNegative`/`uiCelebrate` 의 화면별 세분 매핑(예: 확인 다이얼로그 긍정/부정, 연구 해금·승급 축하)은 UX 폴리시 정리 대상 — 팔레트·버스·훅은 확정됐고 세부 배정만 남았다.

## Changelog (합의 정제 반영)
Architect + Critic 리뷰에서 수용한 개선:
- **[CRITICAL]** 드랍 관측을 `state.loot` 길이 델타(수거 시점)에서 **이원 관측**(바닥 loot 엔티티 등장 + 보스/승리틱 직행 push)으로 교체 — "드랍 순간" 의미 복원 + 보스 유니크 팡파레 포함(AC13/14, Step10, R8, Verification 2).
- **[MAJOR]** 처치음 패닝 불가(compact 위치 소실) 확정 → 드랍 한정, R7 재작성(AC15).
- **[MAJOR]** 무기 발사음 6종→**5종(0~4)** 정정(AC12).
- **[MAJOR]** AC19 적탄 경고음을 실존 필드(`enemyBullet.enemyType` BK_* / 보스탄)로 판별 재정의, "sim 플래그 추가" 삭제 — **결정론 위반 아님**을 근거 정정.
- **[MAJOR]** 원칙2를 "스칼라 델타 + 호출부 엔티티 스캔"으로 명문화, SoundFrame 스칼라 유지·per-entity는 opts 주입(원칙-AC 모순 해소).
- **[MAJOR]** Verification 2를 드랍 순간 의미 + 보스 무엔티티 드랍 + 5발사음 커버리지 + AC19 판별로 강화(반복 결함 "그린인데 오동작" 차단).
- **[MINOR]** 버스 기본 볼륨을 잠정값으로 표기(원칙4 vs AC9 정합).
- **[구조]** God 객체 회피 책임 분해 절 추가(Architect antithesis/synthesis).
- **[구조]** musicDirector↔GameAudio unlock 핸드셰이크 + AudioBufferSourceNode 선택 명시.
- AC3 run 진입점 3곳 런종류 플래그 명시. defenseBoss 안전성 문서화.
