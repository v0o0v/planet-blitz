/**
 * env-verify 페이지 캡처 스니펫 — 브라우저 콘솔/`javascript_tool` 에 붙여 넣어 쓴다.
 *
 * ## 이 파일의 규율은 전부 "실제로 거짓 판정을 만든 것"에서 왔다
 * 배경 회귀를 픽셀로 재려면 두 프레임이 **캔버스 크기·sim 상태·품질 티어까지 같아야** 한다.
 * 아래 다섯 가지 중 하나라도 빠지면 게이트가 무관한 이유로 빨개지거나, 더 나쁘게는
 * 진짜 회귀를 노이즈에 묻는다.
 *
 *  1. **품질 티어 고정** — 하네스를 일시정지·스텝으로 쓰면 FPS 계측이 10 근처로 잡혀 티어가
 *     `low` 로 강등되고 발광 게이트가 통째로 꺼진다. 그 화면을 보고 "발광이 없다"고 판정한
 *     전례가 있다(카르곤 AAA 레인). `__pb.graphicsSettings` 가 없는 빌드(구 커밋)에서는
 *     `localStorage['pb.graphics']` 를 심고 **새로고침**하면 같은 효과가 난다.
 *  2. **캡처 전 `harness.pause()`** — `ticker.update(performance.now())` 는 벽시계 경과만큼
 *     sim 을 전진시킨다. 정지하지 않으면 촬영마다 틱이 달라져(실측 910 vs 911) 노이즈 바닥이
 *     mean 1.8 · 국소 74 까지 올라간다. 정지하면 0.02 다.
 *  3. **캔버스 고정** — 렌더러 `resolution` 에 로드 시점 `devicePixelRatio` 가 굳어 있어
 *     **origin 마다 캔버스 픽셀 수가 다르다**(실측 5193=1.25 → 1600×1000, 5180=1.0 → 1280×720).
 *     크기가 다르면 비교 자체가 불가능하다. {@link __pinCanvas} 로 강제한다.
 *  4. **`harness.preset('fresh')` 를 런 전에** — 하네스 프로필이 origin 별 localStorage 라 두
 *     서버가 서로 다른 장비·해금을 갖는다. 같은 시드라도 플레이어 이동이 달라 카메라가 지형의
 *     **다른 곳**을 비춘다(실측 mean 30~50 — 미세 회귀가 아니라 완전히 다른 장면).
 *  5. **`post` 슬롯 뒤 stage 자식 전부 숨김** — `ff` 중 오토파일럿이 레벨업하면 파워업 선택
 *     오버레이(목재 패널)가 화면 83%를 덮어 명도·격자·위장 세 지표가 전부 그 패널을 잰다.
 *
 * 그리고 **`requestAnimationFrame` 을 await 하지 마라.** in-app Browser pane 은
 * `visibilityState === 'hidden'` 이라 rAF 콜백이 영영 불리지 않아 그대로 교착한다.
 *
 * ## 판정 전 선행 확인
 * 픽셀을 비교하기 전에 양쪽 `harness.snapshot().hash` 가 같은지 확인해라. 다르면 sim 상태가
 * 다른 것이므로 픽셀 차이는 렌더 회귀가 아니다(4번을 빠뜨렸을 때가 정확히 이 경우다).
 *
 * ## 모드
 *  - `'bg'` — 엔티티까지 숨긴 **순수 배경**. **판정은 이쪽으로만 한다.**
 *  - `'full'` — UI 만 숨김. 육안 검토용. sim 해시가 같아도 엔티티 렌더 보간 계수가 벽시계
 *    누산기 기반이라 재현되지 않는다(실측 mean 1.5~3.3).
 *
 * ## 사용
 *   __shotSet('base-kargon')          // 시드 1~4 × {bg, full} 8컷 + 해시 반환
 *   __shot('name', 'bg')              // 현재 상태 한 컷(호출부가 pause 를 관리한다)
 *
 * `SHOT_URL` 포트를 기준선/비교 대상 디렉터리에 맞춰 바꿔 쓴다(`shot-server.mjs --out`).
 */
(() => {
  const SHOT_URL = 'http://127.0.0.1:5181/shot';

  /** 한 프레임을 확실히 그린다. hidden pane·일시정지에서도 합성 결과가 갱신되게 강제한다. */
  function forceFrame(app) {
    app.ticker.update(performance.now());
    app.renderer.render(app.stage);
  }

  /** 캔버스를 1280×720 · resolution 1 로 못 박는다(위 3번). 두 번 부르는 것은 의도적이다 — */
  /** 중간의 resize 이벤트로 앱이 자체 레이아웃을 다시 잡을 수 있어 그 뒤에 재확정한다. */
  window.__pinCanvas = function __pinCanvas() {
    const app = window.__pb.gameApp.app;
    app.renderer.resolution = 1;
    app.renderer.resize(1280, 720);
    window.dispatchEvent(new Event('resize'));
    app.renderer.resolution = 1;
    app.renderer.resize(1280, 720);
    return [app.canvas.width, app.canvas.height, app.renderer.resolution];
  };

  /**
   * 한 컷. **정지·재개를 하지 않는다** — 호출부가 pause 한 뒤 여러 컷을 찍고 resume 해야
   * 같은 런의 여러 컷이 정확히 같은 틱이 된다(bg 와 full 을 따로 정지하면 4틱 어긋난다).
   */
  window.__shot = async function __shot(name, mode, solo) {
    const pb = window.__pb;
    const app = pb.gameApp.app;
    const root = app.stage.children[0];
    if (solo !== undefined) pb.env.solo(solo === '__none__' ? ' none ' : solo);

    const postIdx = root.children.indexOf(pb.env.slot('post'));
    const entities = pb.entityRenderer.layer;
    const saved = root.children.map((c) => c.visible);
    root.children.forEach((c, i) => {
      if (i > postIdx) c.visible = false;
      if (mode === 'bg' && c === entities) c.visible = false;
    });

    forceFrame(app);
    forceFrame(app);
    const dataUrl = app.canvas.toDataURL('image/png');

    // 반드시 복원한다 — 안 하면 이후 촬영과 사용자 플레이가 UI 없는 화면이 된다.
    root.children.forEach((c, i) => { c.visible = saved[i]; });

    const res = await fetch(`${SHOT_URL}?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: dataUrl,
    });
    const body = await res.json();
    const snap = pb.harness.snapshot();
    return { name, ok: body.ok === true, bytes: body.bytes ?? 0, err: body.error ?? null, tick: snap.tick, hash: snap.hash };
  };

  /** 회귀 게이트용 표준 세트: 시드 1~4 × {bg, full}. 반환의 `hashes` 로 sim 동일성을 먼저 확인해라. */
  window.__shotSet = async function __shotSet(label, planet = 0, ticks = 900) {
    const pb = window.__pb;
    __pinCanvas();
    try {
      pb.graphicsSettings.set({ quality: 'high' });
    } catch {
      // 구 빌드에는 노출이 없다 — localStorage 를 심고 새로고침한 뒤 다시 부르면 된다.
    }
    pb.harness.preset('fresh');

    const shots = [];
    const hashes = [];
    for (const seed of [1, 2, 3, 4]) {
      pb.harness.startRun({ seed, planet });
      pb.harness.ff(ticks, { autopilot: true });
      pb.harness.pause();
      hashes.push(pb.harness.snapshot().hash);
      shots.push(await __shot(`${label}-s${seed}-bg`, 'bg'));
      shots.push(await __shot(`${label}-s${seed}-full`, 'full'));
      pb.harness.resume();
    }
    return { shots, hashes, canvas: [pb.gameApp.app.canvas.width, pb.gameApp.app.canvas.height] };
  };

  /**
   * 레이어별 기여도 세트. 같은 틱이어야 의미가 있으므로 바깥에서 한 번만 정지한다.
   * 결과는 `analyze.mjs delta <none> <layer>` 로 잰다.
   */
  window.__soloSet = async function __soloSet(label, seed = 1, planet = 0, ticks = 900) {
    const pb = window.__pb;
    __pinCanvas();
    pb.harness.preset('fresh');
    pb.harness.startRun({ seed, planet });
    pb.harness.ff(ticks, { autopilot: true });
    pb.harness.pause();
    const out = [await __shot(`${label}-none`, 'bg', '__none__')];
    for (const n of pb.env.activeNames) out.push(await __shot(`${label}-${n}`, 'bg', n));
    out.push(await __shot(`${label}-all`, 'bg', null));
    pb.harness.resume();
    return out;
  };

  return 'ok: __shot / __shotSet / __soloSet / __pinCanvas 등록됨';
})();
