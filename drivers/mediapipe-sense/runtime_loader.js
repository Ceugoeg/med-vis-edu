(function () {
  const MODE = 'mediapipe';
  window.__INPUT_MODE__ = MODE;
  const selfScriptSrc = (document.currentScript && document.currentScript.src) || null;

  function ensureDefaultHandData() {
    if (!window.handData) {
      window.handData = {
        state: 'NONE',
        landmarks: Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 })),
        confidence: 0,
      };
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`加载脚本失败: ${src}`));
      document.head.appendChild(script);
    });
  }

  function fallbackToMockDriver(reason) {
    console.warn('[mediapipe-sense] 回退到 mock 驱动:', reason);
    if (window.__mockDriverLoaded__) return;
    const mock = document.createElement('script');
    mock.src = 'drivers/mock_hands.js';
    mock.onload = () => {
      window.__mockDriverLoaded__ = true;
      console.log('[mediapipe-sense] mock 驱动已加载。');
    };
    mock.onerror = () => {
      console.error('[mediapipe-sense] mock 驱动加载失败。');
    };
    document.head.appendChild(mock);
  }

  function createHiddenVideo() {
    const video = document.createElement('video');
    video.id = 'mediapipe-camera';
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.style.position = 'fixed';
    video.style.right = '12px';
    video.style.bottom = '12px';
    video.style.width = '180px';
    video.style.height = '120px';
    video.style.opacity = '0.35';
    video.style.zIndex = '9999';
    video.style.border = '1px solid rgba(255,255,255,0.3)';
    video.style.borderRadius = '6px';
    video.style.pointerEvents = 'none';
    document.body.appendChild(video);
    return video;
  }

  async function bootstrap() {
    ensureDefaultHandData();

    try {
      await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js');
      await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js');

      const baseUrl = selfScriptSrc ? new URL('.', selfScriptSrc).href : './drivers/mediapipe-sense/';
      const moduleUrl = new URL('mediapipe_hand_publisher.js', baseUrl).href;
      const mod = await import(moduleUrl);
      const { MediaPipeSensePublisher } = mod;

      const videoElement = createHiddenVideo();

      // 暴露新版的高级参数字典，方便后续在联调中微调
      const publisher = new MediaPipeSensePublisher({
        videoElement,
        config: {
          flipY: false,
          debug: false,
          adaptiveSmoothing: true, // 开启自适应滤波
          stateVoteWindow: 5,      // 滑动窗口长度
          openConfirmFramesAfterAction: 2, // 离开 FIST/PINCH 后的缓冲死区帧数
          dynamicPinch: true       // 开启基于手部比例的动态捏合检测
        },
      });

      await publisher.start();
      window.__mediapipePublisher = publisher;
      console.log('[mediapipe-sense] 摄像头输入模式已启动。高级防抖策略已挂载。');
    } catch (err) {
      console.error('[mediapipe-sense] 启动失败，回退为 NONE:', err);
      ensureDefaultHandData();
      fallbackToMockDriver(err && err.message ? err.message : 'unknown error');
    }
  }

  bootstrap();
})();