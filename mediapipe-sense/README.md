# mediapipe-sense

成员A独立交付目录：MediaPipe感知模块，不改现有主工程逻辑。

## 文件说明
- `mediapipe_hand_publisher.js`: handData 发布器（核心实现）
- `runtime_loader.js`: 主工程联调注入器（自动加载MediaPipe并启动发布器）
- `demo_index.html`: 本地摄像头验证页面
- `demo_bootstrap.js`: demo 启动脚本
- `tasks_mediapipe_sense.md`: 四状态任务管理文档

## handData 契约
```js
window.handData = {
  state: 'OPEN' | 'FIST' | 'PINCH' | 'NONE',
  landmarks: [ { x, y, z }, ...共21个 ],
  confidence: 0.0 ~ 1.0
};
```

## 本地验证
1. 用 Live Server 打开 `demo_index.html`。
2. 点击“启动”，授权摄像头。
3. 查看右侧输出，确认：
- `points` 始终是 `21`
- `state` 能在手势变化时稳定切换
- `confidence` 在 0~1 范围内

## 在主工程中接入（示例）
```html
<script src="https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js"></script>
<script type="module">
  import { MediaPipeSensePublisher } from '/mediapipe-sense/mediapipe_hand_publisher.js';
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  document.body.appendChild(video);

  const publisher = new MediaPipeSensePublisher({
    videoElement: video,
    config: { smoothingAlpha: 0.2, stateHoldFrames: 2, flipY: false }
  });
  publisher.start();
</script>
```

## 已完成联调方式（med-vis-edu-main）
1. 打开：
- mock模式（默认）: `/med-vis-edu-main/index.html`
- mediapipe模式: `/med-vis-edu-main/index.html?input=mediapipe`
2. `?input=mediapipe` 时会加载 `../mediapipe-sense/runtime_loader.js`，不修改 `app.js` 逻辑。

## 调参建议
- `pinchThreshold`: 0.045~0.065
- `smoothingAlpha`: 0.15~0.3
- `stateHoldFrames`: 2~4
- `flipY`: 默认 `false`（与现有主工程 NDC 转换一致）；若方向反了再切 `true`
