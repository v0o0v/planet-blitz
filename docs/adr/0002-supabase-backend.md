# 백엔드로 Supabase 채택

래더(전 유저 순위표), 침공 매치메이킹, 타 유저의 방어 배치 조회 등 유저 간 데이터 교환이 필요해 자체 백엔드가 필수다. CrazyGames SDK의 데이터 저장은 단순 키밸류라 이 용도에 부족하다. Postgres + Auth + Edge Functions를 한 번에 제공하는 Supabase를 채택했다. 래더 순위 교환 같은 트랜잭션은 Postgres가 적합하고, 침공 결과 검증·순위 스왑은 Edge Function으로 서버 권위 처리한다. 운영자가 haruquiz에서 Supabase 운영 경험을 이미 보유한 점도 근거다.

## Considered Options

- **Cloudflare Workers + D1/Durable Objects** — 엣지 성능·비용은 우수하나 래더 트랜잭션을 DO로 직접 설계해야 하고 운영 경험이 없음
- **백엔드 없이 PvE만 1차 출시** — PvP가 핵심 차별점이라는 판단으로 기각 (ADR-0004 참조)
