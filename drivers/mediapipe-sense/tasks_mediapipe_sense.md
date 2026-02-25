# [MediaPipe Sense]任务管理文档
<!-- 当前状态: CLEANUP -->
*创建时间: 2026-02-24*  
**版本: v1.2**  
**项目: med-vis-edu (成员A感知模块)**

---
## 📋 任务状态管理系统
### 🔄 当前任务状态: **CLEANUP - Task-03**
#### 📝 任务管理规则
1. **🎯 规划 (PLANNING)**: 计划要执行的任务，确定优先级和依赖关系。
2. **🔍 完善 (REFINING)**: 深入分析当前任务，检查相关代码，完善理解程度。
3. **⚡ 执行 (EXECUTING)**: 执行成员A范围内的实现，输出稳定 handData。
4. **🧹 清理 (CLEANUP)**: 汇总结果，标记完成状态，为集成准备环境。

#### 🎯 当前任务队列
##### 🥇 第一优先级任务
- [✅] **Task-01**: 成员A感知数据发布模块（MediaPipe + 稳态手势 + 滤波）
- 状态: [🧹] 已完成
- 依赖: 无
- 预计时间: 2-3 小时
- 开始时间: 2026-02-24 00:35 CST

##### 🥈 第二优先级任务
- [✅] **Task-02**: 与主工程联调（仅注入脚本，不改 app.js 主逻辑）
- 状态: [🧹] 已完成
- 依赖: Task-01
- 预计时间: 0.5-1 小时
- 开始时间: 2026-02-24 00:45 CST

##### 🥉 第三优先级任务
- [✅] **Task-03**: 联调缺陷修复（路径解析/坐标翻转/失败回退）
- 状态: [🧹] 已完成
- 依赖: Task-02
- 预计时间: 0.5 小时
- 开始时间: 2026-02-24 02:05 CST

#### 📊 任务执行记录
| 任务ID | 任务名称 | 状态 | 开始时间 | 完成时间 | 备注 |
|--------|----------|------|----------|----------|------|
| Task-01 | 成员A感知数据发布模块 | ✅ | 2026-02-24 00:35 CST | 2026-02-24 00:40 CST | 新增独立目录 `mediapipe-sense`，未修改主工程 |
| Task-02 | 与主工程联调（输入源切换） | ✅ | 2026-02-24 00:45 CST | 2026-02-24 00:52 CST | 未改 `app.js`，仅改 `index.html` 的输入脚本加载 |
| Task-03 | 联调缺陷修复 | ✅ | 2026-02-24 02:05 CST | 2026-02-24 02:12 CST | 不改 `app.js`，仅修复 `mediapipe-sense` 内部实现 |

#### 🎯 下一步行动
1. 在 `med-vis-edu-main/index.html?input=mediapipe` 下验证 Y 轴方向与命中点一致性。
2. 按设备光照情况微调阈值：`pinchThreshold`、`stateHoldFrames`、`smoothingAlpha`。

---
## PLANNING
<!-- 当前状态: PLANNING -->
### 任务拆分
1. 明确成员A唯一交付：`window.handData` 协议。
2. 完成手势识别：`OPEN/FIST/PINCH/NONE`。
3. 增加一阶滞后滤波：`alpha=0.2`。
4. 增加状态稳态控制：减少 OPEN/NONE 抖动。
5. 提供独立验证页面，保证不侵入主工程。

### 优先级排序
1. P0: handData 协议正确性（字段、类型、21点）
2. P0: 摄像头采集 + MediaPipe Hands
3. P1: 手势判定稳定性（阈值 + 状态持有帧）
4. P1: 滤波与坐标翻转配置
5. P2: 本地演示和接入说明

### 依赖关系图
```text
Task-01.1 协议定义
  -> Task-01.2 MediaPipe采集
    -> Task-01.3 手势判定
      -> Task-01.4 滤波稳态
        -> Task-01.5 验证页面与文档
```

### 预估资源
- 技术依赖: `@mediapipe/hands`, `@mediapipe/camera_utils`
- 运行前置: 浏览器摄像头权限
- 风险: 光照不足导致识别不稳；通过滤波和状态持有缓解

---
## REFINING
<!-- 当前状态: REFINING -->
### 相关代码检查结论
1. 现有主工程通过 `window.handData` 消费手势输入（符合成员A接口分离要求）。
2. 现有主工程已有 mock 驱动，仅用于模拟；真实摄像头接入应新增独立模块。
3. 主工程不应改动 `app.js` 3D、Raycaster、材质与路径逻辑（交接文档硬约束）。

### 技术方案
1. 新建独立发布器类 `MediaPipeSensePublisher`。
2. 启动流程：摄像头流 -> MediaPipe Hands -> `onResults`。
3. `onResults` 内执行：归一化 -> 可选 `flipY` -> 滤波 -> 手势判定 -> 状态稳态 -> 发布。
4. 发布结构严格固定：
```js
window.handData = {
  state: 'OPEN' | 'FIST' | 'PINCH' | 'NONE',
  landmarks: [{x,y,z} x21],
  confidence: 0..1
};
```
5. 加入独立 demo，不侵入主工程。

### 风险与对策
- 风险: 手势抖动导致状态频繁跳变。
- 对策: `stateHoldFrames` 稳态提交策略 + `alpha=0.2` 滤波。
- 风险: 不同设备坐标方向不一致。
- 对策: 配置项 `flipY` 可开关。

---
## EXECUTING
<!-- 当前状态: EXECUTING -->
### 执行日志
1. 创建目录：`mediapipe-sense`。
2. 新增 `mediapipe_hand_publisher.js`：完成采集、手势、滤波、发布。
3. 新增 `demo_index.html` 与 `demo_bootstrap.js`：用于本地验证。
4. 新增 `README.md`：说明接入步骤与参数。
5. 新增 `runtime_loader.js`，用于联调自动注入（MediaPipe脚本 + publisher）。
6. 修改 `med-vis-edu-main/index.html`，通过 query 参数切换输入源（mock/mediapipe）。
7. 修复 `runtime_loader.js` 路径解析：避免异步场景 `currentScript` 丢失导致 404。
8. 将 `flipY` 默认值改为 `false`，避免与主工程 NDC 转换冲突造成反向。
9. MediaPipe 启动失败时自动回退加载 `drivers/mock_hands.js`。

### 基础验证
- 语法检查: `node --check mediapipe-sense/mediapipe_hand_publisher.js`
- 语法检查: `node --check mediapipe-sense/demo_bootstrap.js`
- 语法检查: `node --check mediapipe-sense/runtime_loader.js`

---
## 🧹 CLEANUP
<!-- 当前状态: CLEANUP -->
### ✅ **Task-01 成员A感知模块完成总结**
#### 🎯 完成成果
1. **协议实现**: 完成 `window.handData` 持续发布。
- ✅ **状态字段**: 输出 `OPEN/FIST/PINCH/NONE`。
- ✅ **关键点字段**: 固定 21 点 `{x,y,z}`。
- ✅ **置信度字段**: 输出 `0~1`。

2. **稳定性增强**: 解决抖动与跳变风险。
- ✅ **一阶滞后滤波**: 默认 `alpha=0.2`。
- ✅ **状态稳态提交**: `stateHoldFrames` 防抖。

3. **可验证交付**: 提供独立演示入口。
- ✅ **摄像头验证页**: `demo_index.html`。
- ✅ **启动脚本**: `demo_bootstrap.js`。

#### 🎨 技术实现亮点
- **低耦合设计**: 仅写 `window.handData`，与主渲染逻辑彻底解耦。
- **可配置阈值**: 支持手势阈值、滤波系数、Y轴翻转按设备调参。

#### 📋 系统架构总览
```text
Camera Stream
  -> MediaPipe Hands
    -> normalize + flipY
      -> smoothing(alpha)
        -> gesture detect
          -> state hold frames
            -> window.handData publish
```

#### 🚀 集成就绪状态
- ✅ **成员A交付契约**: 已满足。
- ✅ **非侵入主工程**: 已满足。

**完成时间**: 2026-02-24 00:40 CST  
**质量评估**: A-（具备可用性与可调性，待真实场景阈值微调）  
**下一任务**: Task-02 联调并在目标环境验证阈值

---
### ✅ **Task-02 主工程联调完成总结**
#### 🎯 完成成果
1. **输入源切换联调**: 主工程支持 mock 与 mediapipe 双输入模式。
- ✅ **默认行为保持**: 不带参数仍使用 `drivers/mock_hands.js`。
- ✅ **联调开关**: `?input=mediapipe` 时加载 `mediapipe-sense/runtime_loader.js`。

2. **注入式集成**: 未修改 `app.js` 逻辑与其文件引用路径。
- ✅ **摄像头启动**: 运行时动态加载 MediaPipe 依赖并启动 publisher。
- ✅ **数据交接**: 持续发布 `window.handData` 给原有前端消费。

#### 🎨 技术实现亮点
- **最小侵入联调**: 只改入口脚本加载策略，不触碰3D交互主代码。
- **可回退机制**: 启动失败时维持 `handData` 默认值，不阻断页面渲染。

#### 🚀 集成就绪状态
- ✅ **Task-02完成**: 具备可切换输入源的联调能力。
- ✅ **Handoff约束满足**: 保持 `app.js` 不变。

**完成时间**: 2026-02-24 00:52 CST  
**质量评估**: A（联调路径清晰，可直接验证）  
**下一任务**: 实机验证与阈值调优（若需要）

---
### ✅ **Task-03 联调缺陷修复完成总结**
#### 🎯 完成成果
1. **路径修复**: 避免 `currentScript` 在异步后为 `null` 导致模块路径错误。
- ✅ 在脚本同步阶段缓存 `selfScriptSrc`，后续用缓存值推导模块路径。
- ✅ 移除对站点根路径 `'/mediapipe-sense/'` 的强依赖。

2. **坐标修复**: 统一 Y 轴处理，降低“上下反向”风险。
- ✅ `runtime_loader.js` 默认 `flipY=false`。
- ✅ `mediapipe_hand_publisher.js` 默认 `flipY=false`。

3. **兜底修复**: MediaPipe 失败时仍保留可交互输入。
- ✅ 启动失败自动回退加载 `drivers/mock_hands.js`。

#### 🚀 集成就绪状态
- ✅ 不改 `app.js`，满足交接文档的非侵入约束。
- ✅ 三项缺陷均已通过代码修复。

**完成时间**: 2026-02-24 02:12 CST  
**质量评估**: A（关键路径更稳，回退机制补齐）  
**下一任务**: 浏览器实机验收（输入方向/命中率/稳定性）

---
*最后更新: 2026-02-24 02:12 CST*  
**当前版本: v1.2**
