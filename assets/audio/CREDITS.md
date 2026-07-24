# BGM 트랙 크레딧 · 라이선스 관리 (사운드 풍성화 Phase 3, ADR-0029)

Planet Blitz 는 SFX 를 절차 합성(`src/render/audio.ts`)하지만 **BGM 만 외부 5트랙**을 쓰는
하이브리드 정책이다(ADR-0029). 이 문서는 그 외부 트랙의 출처·라이선스·확보 상태를 추적한다.

> **현재 상태: 전부 확보 필요(placeholder).** 아래 파일명은 `src/render/musicDirector.ts` 의
> `TRACK_MANIFEST` 이 기대하는 basename 이다. 실제 오디오 파일이 `assets/audio/` 에 없어도
> 빌드·런타임은 깨지지 않는다 — `musicDirector` 는 파일이 없는 존을 조용히 **무음** 처리한다.
> 사람이 아래 표를 채우고 파일을 넣으면 자동으로 재생된다.

## 라이선스 정책 (반드시 준수)

- **허용:** 로열티프리 / CC0 / 명확한 상업용 라이선스(구매·구독 포함)만. CrazyGames 상업 배포에
  적합해야 한다.
- **금지: AI 생성 음악(Suno · Udio 등).** 학습 데이터 저작권·라이선스 불확실성 때문에 상업
  배포에 부적합하다.
- **CrazyGames 상업 배포 책임(ADR-0029):** 각 트랙의 라이선스 증빙(구매 영수증·라이선스 URL·
  CC0 출처)을 확보하고, 아래 표의 "라이선스"·"출처" 칸을 채운다. 저작자 표기 의무(attribution)가
  있는 라이선스는 이 문서에 표기가 곧 준수다. 머지 전 라이선스 하자 검증(R2).

## 트랙 목록 (5 존 + 정산 스팅어)

각 트랙은 **ogg + mp3** 두 포맷이 필요하다(ogg 우선, Safari 등 미지원 시 mp3 폴백). 파일은
`assets/audio/` 에 basename 그대로 넣는다.

| 용도(존) | 파일명(ogg / mp3) | 성격 | 출처 | 라이선스 | 확보 상태 |
|---|---|---|---|---|---|
| 메뉴(menu) | `bgm_menu.ogg` / `bgm_menu.mp3` | 메타 화면 전체(타이틀·기지·격납고·연구소 등). 잔잔한 루프. | (미정) | (미정) | **확보 필요(placeholder)** |
| PvE 전투(combatPvE) | `bgm_combat_pve.ogg` / `bgm_combat_pve.mp3` | 일반 PvE 런 전투. 경쾌·긴장 루프. | (미정) | (미정) | **확보 필요(placeholder)** |
| 보스(boss) | `bgm_boss.ogg` / `bgm_boss.mp3` | 보스 등장 클라이맥스. 고조 루프. | (미정) | (미정) | **확보 필요(placeholder)** |
| 침공(invasion) | `bgm_invasion.ogg` / `bgm_invasion.mp3` | 침공 런 + 관전. 위협적 루프. | (미정) | (미정) | **확보 필요(placeholder)** |
| 정산 승리 스팅어(victory) | `stinger_victory.ogg` / `stinger_victory.mp3` | 런 승리 정산. one-shot(루프 아님). | (미정) | (미정) | **확보 필요(placeholder)** |
| 정산 패배 스팅어(defeat) | `stinger_defeat.ogg` / `stinger_defeat.mp3` | 런 패배 정산. one-shot(루프 아님). | (미정) | (미정) | **확보 필요(placeholder)** |

> 존은 4개(menu·combatPvE·boss·invasion), 스팅어는 2변종(victory·defeat)이라 트랙 파일은 6종이다.
> 계획 문서의 "5 존"은 지속 존 4 + 정산 스팅어 1묶음(2변종)을 뜻한다(AC1).

## 확보 시 체크리스트

1. 로열티프리/CC0/상업 라이선스 트랙을 고른다(AI 생성 음악 금지).
2. ogg + mp3 두 포맷으로 변환해 `assets/audio/` 에 위 basename 으로 저장한다.
3. 위 표의 "출처"·"라이선스"·"확보 상태" 칸을 채운다(라이선스 URL·영수증 링크 포함).
4. 지속 존 트랙은 **seamless loop**(시작/끝 이음매 없음)로 편집한다 — `musicDirector` 가
   `AudioBufferSourceNode.loop=true` 로 반복하므로 루프 포인트가 튀면 그대로 들린다.
5. 용량은 트랙당 약 1~2MB 이내를 권장한다(초기 로딩·번들 영향, R3). 지연 로딩이라 초기 청크에는
   포함되지 않지만 실행 중 fetch 부담을 줄인다.
