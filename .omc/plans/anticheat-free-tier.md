# 치팅 방어 재설계 + 무료 티어 1만 회원 튜닝 — 구현 플랜

2026-07-24 grill 세션에서 확정된 설계(ADR-0026·ADR-0027)의 레인별 구현 계획.
기준 규모: 1만 회원 · DAU 1,500 · PvE 12,000런/일 · 침공 4,500회/일.

## 확정 설계 요약

| 축 | 결정 |
|---|---|
| 재화·기체 소유 | 서버 원장 정본, 클라 save에서 분리 (ADR-0027) |
| PvE 보상 | 정산 요약 제출 → 서버 재계산 + 3중 캡 → 원장 즉시 지급 |
| PvE 리플레이 | 제출·저장·샘플링 검증 전부 폐기 (ADR-0026, ADR-0005 개정) |
| 침공 검증 | 전수 재실행 유지 (실측 ~0.4초/판, EF CPU 2초 한도 내) |
| 침공 리플레이 | 검증 직후 hashStream·client_result 폐기, 본문 gzip 압축, 48시간 TTL GC |
| 정산 이력 | 캡 검사 창(24h) + 여유 → 7일 보존 후 GC |
| 캡 수치 | 보수적 초기값, 출시 전 밸런스 일괄 튜닝에서 확정 (defer-balance-tuning) |

## 레인 구성 (의존 순서)

### Lane 1 — 서버 원장 스키마 + 재화 이관 (선행, 최대)
- `profiles`에 원장 컬럼(credits·minerals) 또는 전용 원장 테이블 신설. 클라 write 차단(트리거/RLS).
- 기존 유저 save 값 1회 이관 마이그레이션(새 파일, 기존 마이그레이션 수정 금지).
- `save->>'credits'`/`'minerals'` 읽는 RPC 12곳 원장 참조로 수정: repair_defense, 카드 경제, 복수전, 방어 카드, M7a 침공, M7b 방어체, 코어 모듈, 모듈 슬롯, flag_pve_anomalies (탐색 보고서의 마이그레이션 좌표 참조).
- 클라: save의 재화 필드를 표시용 사본으로 강등 — 서버 응답으로만 갱신, upsertProfile에서 재화 제외.
- **검증**: 재화 위조 upsert 후 서버 잔액 불변 확인 테스트, 12개 RPC 회귀(vitest + 마이그레이션 스모크).

### Lane 2 — PvE 정산 RPC + pve_runs 개편 (Lane 1 의존)
- 정산 요약 스키마 정의(생존 틱·처치 수·획득 광물·모드 등 — 보상 공식이 요구하는 지표만).
- `settle_pve_run` RPC: 요약 수신 → ① 개연성 캡(처치 수 ≤ finalTick×스폰율 상한 등) ② 런당 지급 상한 ③ 시간당·일일 누적 상한 → 클램프 지급, 극단 초과 시 flagged. 보상 공식은 서버로 이식(클라 공식과 단일 소스 공유 — sim 모듈에서 도출).
- `pve_runs`를 정산 이력 테이블로 개편: replay·client_result 컬럼 제거, 요약+지급액 기록. 7일 GC cron.
- 클라: `recordPveRun` 리플레이 업로드 제거, 정산 RPC 호출로 대체. ReplayRecorder는 침공용으로 유지.
- **검증**: 캡 3종 각각의 경계 테스트, 위조 요약(불가능 지표) 클램프/flag 테스트.

### Lane 3 — PvE 검증 인프라 철거 (Lane 2 의존)
- `verify-pve-sample` EF 삭제(원격 배포 목록에서도 제거), `sample_pve_runs`·`apply_pve_verification` RPC 폐기 마이그레이션.
- `flag_pve_anomalies` cron은 캡 강제로 대체되므로 폐기(또는 극단 초과 리포트용으로 축소). `profiles.flagged` 컬럼과 서버 전용 write 가드는 유지.
- verify-run 코어는 삭제 금지(침공 검증이 재사용).
- **검증**: EF 배포 목록 2종→1종(verify-invasion) 확인, 전체 vitest 그린.

### Lane 4 — 기체 원장 + 공격자 로드아웃 대조 (Lane 1 의존, Lane 2와 병렬 가능)
- 기체·장비·스킬 투자 소유를 원장화: 획득(드랍 확정·건조)·소비(강화·리롤·분해)·장착 상태를 서버 RPC 경유로.
- verify-invasion: 공격자 제출 config.loadout·skillInvest를 원장과 대조, 불일치 reject(verifyInvasionCore의 잔여 신뢰 문서 갱신).
- **검증**: 위조 로드아웃 침공 reject 테스트, 정직 로드아웃 침공 accept 회귀(invasionE2E 경로).

### Lane 5 — 침공 리플레이 압축 + 48h TTL (독립, 즉시 착수 가능)
- verify-invasion 확정 시: hashStream·client_result null 처리, replay를 gzip 압축(bytea 컬럼)으로 대체 저장.
- 48시간 초과 압축 리플레이 삭제 cron(스냅샷 GC와 같은 패턴).
- 관전 로드 경로(replaySpectate)·복수전 진입에서 압축 해제 배선.
- **검증**: 관전 재생 왕복(압축→해제→isPlayableReplay) 테스트, GC 경계 테스트.

## 남은 리스크 (구현 중 측정)

- **egress 5GB/월**: profiles.save 로드 크기 × 세션 수 실측 필요. 원장 분리로 save가 줄지만, 초과 조짐이면 save 슬림화 추가.
- **EF CPU 여유**: 로컬 0.4초는 엣지 런타임에서 2~3배 느려질 수 있음 — 배포 후 SOFT_RERUN_BUDGET 로그 관측, 1.5초 근접 시 해시 폴드 경량화 검토.
- **캡 수치**: placeholder 상수로 시작, 출시 전 밸런스 패스에서 실데이터 기반 확정.
