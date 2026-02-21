# 项目技术指南 (Project Technical Blueprint)

## 1. 系统架构与数据流 (System Architecture & Pipeline)

系统采用"神经反射"式架构，确保从摄像头捕获到 3D 响应的低延迟映射。采用模块化分层架构，确保感知层（采集）、引擎层（解析）、表现层（呈现）各模块在 MVP 阶段实现解耦。

### 1.1 感知层（Data Acquisition）

- **核心引擎**：MediaPipe Hands (Web 版本)
- **数据产出**：实时输出 21 个手部关键点的 Normalized 3D 坐标向量
- **处理流程**：MediaPipe 捕获 21 个 3D 坐标 $\rightarrow$ 归一化处理

### 1.2 引擎层（Intelligence & Logic）

- **动作逻辑判定**：基于关键点欧式距离的启发式算法（如：判定 Pinch/Open/Fist 状态）
  - **OPEN（张开手）**：触发剥离动画，`animateExplode(factor)` 从 0 过渡到 1
  - **FIST（握拳）**：触发复位动画，`animateExplode(factor)` 从当前值过渡到 0
  - **PINCH（捏合）**：触发 Raycaster 碰撞检测，用于选中解剖部位
- **坐标转换公式**：$TargetRotation = (HandX - 0.5) \cdot \pi \cdot Sensitivity$
  - **旋转锁定机制**：当 `isPinching` 为 `true` 时，旋转灵敏度降低至 10%（或完全锁定），避免在选中部位时模型旋转导致瞄准困难
- **一阶滞后滤波**：$Output_n = \alpha \cdot Input_n + (1 - \alpha) \cdot Output_{n-1}$（建议 $\alpha = 0.2$）
- **语义解析映射**：通过 Three.js Raycaster 将 2D 指尖坐标投射到 3D 空间，识别受击的"解剖实体（Entity）"
- **纠错评分系统**：计算用户指尖与"预设解剖位点"的重合度，若偏离 > 阈值，则判定为"识别错误"

### 1.3 呈现层（Visualization & UI）

- **渲染环境**：Three.js WebGL Renderer，Three.js 容器承载 GLB 模型
- **动画中枢**：GSAP (GreenSock) 负责所有物体位移与材质补间，处理状态切换动画
- **AI 接口集成**：DeepMed API 异步调用，实现侧边栏医学知识结构化展示

## 2. 交互规范 (Interaction Specification)

### 2.1 手势逻辑映射

明确的手势状态与 3D 行为映射规则：

- **OPEN（张开手）**：触发剥离动画，`animateExplode(factor)` 从 0 过渡到 1
  - **设计理由**：张开手更符合"展开"的直觉
- **FIST（握拳）**：触发复位动画，`animateExplode(factor)` 从当前值过渡到 0
  - **设计理由**：握拳更符合"收回"的直觉
- **PINCH（捏合）**：触发 Raycaster 碰撞检测，用于选中解剖部位
  - **旋转锁定机制**：当 `isPinching` 为 `true` 时，旋转灵敏度降低至 10%（或完全锁定），确保瞄准稳定性

### 2.2 旋转控制机制

- **手势位移控制旋转**：通过手部 X 坐标控制心脏模型的 Y 轴旋转
  - 公式：$TargetRotation = (HandX - 0.5) \cdot \pi \cdot Sensitivity$
- **旋转锁定机制**：当 `isPinching` 为 `true` 时，暂时锁定旋转（或大幅降低旋转灵敏度至 10%），确保用户能稳定选中解剖部位

### 2.3 交互优先级

确定"先旋转、后剥离"的交互优先级：
- 手势位移控制旋转
- 手势形态（握拳/张开）控制剥离

## 3. 关键技术点拆解与风险应对 (Risk Management)

| 技术环节 | MVP 实现逻辑 | 潜在风险与解决方案 |
|---------|-------------|------------------|
| **手势到 3D 的映射** | 将 MediaPipe 的 $x, y$ 线性映射为场景的 $Rotation.y$ | **风险**：坐标抖动<br>**对策**：引入一阶滞后滤波（Lerp）进行平滑 |
| **心脏分层剥离** | 预设各零件的 Offset 向量，通过状态机一键触发 | **风险**：模型层级混乱<br>**对策**：强制执行统一的命名规范（见分工） |
| **AI 纠错判定** | 指尖关键点与模型 Collider 碰撞检测 | **风险**：Raycaster 穿透<br>**对策**：仅检测最外层包围盒，简化碰撞逻辑 |

## 4. 核心协议设计 (Data Schema)

MVP 弃用后端数据库，采用 JSON 驱动架构：

### 4.1 Anatomy_Config.json

定义零件的行为属性，存储各部位 ID、初始坐标、目标剥离坐标、DeepMed 检索关键字。

**Schema 规范**：
- `Part_Name`：必须与 GLB 模型中的零件名称完全一致（如 `Heart_LV`）
- `label`：中文显示名称
- `offset`：目标剥离坐标 `[x, y, z]`，用于 `animateExplode` 动画
- `query`：DeepMed API 检索关键字

**标准 Schema**：`{ "Part_Name": { "label": "中文名", "offset": [x, y, z], "query": "AI检索词" } }`

```json
{
  "Heart_LV": {
    "label": "左心室",
    "offset": [2, 0, 0],
    "query": "left ventricle function"
  },
  "Heart_RV": {
    "label": "右心室",
    "offset": [-2, 0, 0],
    "query": "right ventricle function"
  },
  "Heart_Aorta": {
    "label": "主动脉",
    "offset": [0, 3, 0],
    "query": "aorta structure"
  },
  "Heart_Valves": {
    "label": "瓣膜",
    "offset": [0, 0, 1],
    "query": "heart valves mechanism"
  }
}
```

**重要说明**：
- 所有零件名称必须与组员 B 导出的 GLB 模型中的命名完全一致
- `offset` 数组表示从初始位置到剥离位置的位移向量
- `query` 字段用于向 DeepMed API 发送检索请求

### 4.2 State_Channel

前端共享的状态对象：
- `isPinching`: 布尔值，表示当前是否处于捏合状态
- `activePart`: 字符串，当前激活的解剖部位名称
- `zoomLevel`: 数字，当前缩放级别

## 5. 渲染与视觉效果配置 (Visual Configuration)

### 5.1 UnrealBloomPass 参数

- **Strength**: 1.5
- **Threshold**: 0.85
- **Radius**: 0.4

### 5.2 材质配置

- **基础设置**：所有零件统一开启 `emissive`（自发光）
- **选中状态**：选中时，`emissiveIntensity` 从 0 平滑过渡到 1
- **背景**：设置黑色背景
- **材质类型**：心脏零件使用金色/红色金属材质
- **菲涅尔反射**：通过修改 `StandardMaterial` 的 `onBeforeCompile` 钩子注入菲涅尔逻辑，实现边缘高光效果，增强模型体积感
  - **技术路径**：修改 `StandardMaterial` 的 `onBeforeCompile` 钩子来注入菲涅尔逻辑
  - **实现细节**：
    - 保留 StandardMaterial 的 `emissive` 和 `emissiveIntensity` 属性（用于自发光）
    - 在 `onBeforeCompile` 中修改 fragmentShader，注入菲涅尔反射计算
    - 计算视角与表面法线的夹角（Fresnel 系数）
    - 在边缘区域增加高光强度
    - 配合 UnrealBloomPass 实现边缘发光效果
  - **优势**：既保留了内置材质的自发光（Emissive）简便性，又实现了边缘高光效果

## 6. 任务优先级 (Task Prioritization)

### P0 (Core) - 核心功能

必须完成的基础功能，MVP 的核心价值：

- **手势识别**：Open/Fist/Pinch 三种手势状态的准确判定
- **心脏模型加载**：GLB 格式心脏模型的加载与渲染
- **基础剥离平移动画**：实现 `animateExplode(factor)` 函数，支持心脏零件的分离与合并动画

### P1 (Logic) - 逻辑功能

增强交互体验的核心逻辑：

- **Raycaster 部位锁定**：通过射线检测识别用户指向的解剖部位
- **DeepMed 文本展示**：集成 DeepMed API，展示选中部位的医学知识
- **UI 状态纠错提醒**：当用户指向无效区域时，提供视觉反馈

### P2 (Visual) - 视觉效果

提升视觉体验的增强功能：

- **模型边缘发光（Rim Light）**：通过菲涅尔反射增强模型体积感
- **背景星空粒子**：添加动态背景粒子效果
- **环境音效**：为交互动作添加音效反馈


