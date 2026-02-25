# MediaPipe 功能调用简要说明

## 1. 启动方式
- 默认模式（原有 mock 输入）：
  - 打开 `med-vis-edu-main/index.html`
- MediaPipe 模式（启用新功能）：
  - 打开 `med-vis-edu-main/index.html?input=mediapipe`

## 2. 你会得到什么
- 主界面保持不变（含原有 LLM 功能）。
- 输入源从 mock 切到摄像头 MediaPipe。
- 系统持续输出并消费：

```js
window.handData = {
  state: 'OPEN' | 'FIST' | 'PINCH' | 'NONE',
  landmarks: [{ x, y, z }, ... 21个],
  confidence: 0.0 ~ 1.0
};
```

## 3. 前置条件
- 浏览器允许摄像头权限。
- 使用本地服务器打开页面（如 Live Server）。
- 若要用 LLM：`med-vis-edu-main` 根目录需有有效 `api.key`。

## 4. 常见问题
- 页面没切到 MediaPipe：确认 URL 带 `?input=mediapipe`。
- 无手势数据：检查摄像头权限与光照。
- LLM 不工作：检查 `api.key` 是否存在且有效。
- Y 轴方向反了：先用默认 `flipY=false`，若仍反向再改为 `true`。
