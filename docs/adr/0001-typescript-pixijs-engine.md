# 게임 엔진으로 TypeScript + PixiJS 채택

CrazyGames 출시용 WebGL 탄막 슈팅으로, 화면에 수천 발의 탄과 수백 마리의 적이 동시에 존재해야 하고 포털 특성상 로딩이 짧아야 한다. Unity WebGL(빌드 20MB+, 긴 로딩)과 Phaser 3(대량 탄막에서 렌더 제어 한계)를 검토한 끝에 TypeScript + PixiJS를 채택했다. PixiJS의 ParticleContainer로 탄막 렌더링 성능을 확보하고, 게임 루프는 자작하며, 인벤토리·스킬트리 같은 복잡한 RPG UI는 DOM 오버레이로 구현해 웹의 강점을 활용한다. 픽셀랩포지(PixelLab)가 생성하는 PNG 스프라이트시트 파이프라인과도 직결된다.

## Considered Options

- **Unity WebGL** — 툴체인은 성숙하나 빌드 용량·로딩이 CrazyGames 웹 환경에 불리, 2D 픽셀 탄막에 과한 스택
- **Phaser 3** — 씬·입력·사운드 내장으로 초기 속도는 빠르나 대량 탄막 성능 튜닝 여지가 좁고, RPG UI는 어차피 별도 구현 필요
