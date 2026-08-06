# S3 체크리스트 — 다음 세션의 재개 지점

**현재 main: `0f65a5c`** · **배선 96 / 210** · 앵커 21개

정본 인계는 `.omc/handoffs/skill-catalyst-merged-lane.md` §11. 이 파일은 **한 줄 상태만** 담는다.

## S3 — 신규 앵커·필드

- [ ] S3-1 `VolleyParams` 발사각(`aimAngle`) 한 칸 — 스트라이커 F5 · 말로우 SQ7
- [ ] S3-4 해츨링 출격 앵커(`stepHatchBrood`) — 해츨링 8종(BD1·BD2·BD6·BD10·NU2·NU7·NU10·SH10)
- [ ] S3-2 탄 수명 만료 소멸 앵커 — 아크캐스터 CH3
- [ ] S3-3 정산액 확정 직전 앵커 — 말로우 ME5·ME8
- [ ] S3-5 막 진입 술어 확장(`aux0 > 0` → 치명 포함) — 버블 FI9

## 그 뒤

- [ ] 순수 함수 개정(`cushionSettled`/`cushionRecovered` 임계 인자 · `filmAbsorbed`/
      `filmRemainingDamage` 효율 인자) — **골든에 닿는다. D 단계와 한 창에 묶어라**
- [ ] 배치1 기체 재방문 — 브루저 BL2(`targetDist`) · 팬텀 AS3(`cloakBreak`) · 스트라이커 F5 · 말로우 SQ7
- [ ] 촉매 48종 배선(선결 완료)
- [ ] D 단계 골든 재생성 **1회** + EF 재배포
- [ ] 단계 3~7(어픽스 재편 → ADR-0050 §1 → 배포 3단계 → 개연성 캡 → 밸런스)

## 미결(사용자 판단)

- 촉매 SQL 마이그레이션 미배포(`SLOT_CAP` 8→3) — 클라 먼저, SQL 나중
- `dailyRewardSelection` 촉매 축 사거리 축소 — 밸런스로 미룸
- 로컬 `main` 체크아웃(`D:/ClaudeCowork/shooting`)이 `ef8220a` 로 뒤처져 있다
