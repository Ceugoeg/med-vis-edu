# 团队执行手册 (Team Operations Manual)

## 1. 角色作业书 (Role Assignment)

### 1.1 组员 A：感知与坐标工程师 (Data/Sense Lead)

#### 1.1.1 核心目标

把手变成"遥控器"——实现准确的手势识别和坐标转换

#### 1.1.2 核心动作

编写 `getGestureStatus()` 函数，实现手势状态的实时判定

#### 1.1.3 具体作业

1. **部署 MediaPipe Hands 运行环境**
   - 通过 CDN 引入 MediaPipe Hands 库
   - 初始化摄像头捕获
   - 配置识别参数

2. **编写 `getGestureStatus()` 函数**
   - **输入**：接收 Webcam 数据流
   - **输出**：`window.handData` 对象，包含：
     - `state`: 手势状态（'OPEN' | 'FIST' | 'PINCH' | 'NONE'）
     - `landmarks`: 21 个关键点的归一化坐标数组
     - `confidence`: 识别置信度
   
   **手势判定逻辑**：
   - **PINCH 判定**：计算食指(8)与拇指(4)距离 $d$
     - $d < 0.05 \rightarrow$ PINCH
     - **用途**：触发 Raycaster 碰撞检测，用于选中解剖部位
   - **FIST 判定**：统计 4 个手指尖相对于指根的 $y$ 轴偏移
     - 偏移量极小 $\rightarrow$ FIST
     - **用途**：触发复位动画，`animateExplode(factor)` 从当前值过渡到 0
   - **OPEN 判定**：手指完全展开，各关节角度大于阈值
     - **用途**：触发剥离动画，`animateExplode(factor)` 从 0 过渡到 1
     - **设计理由**：张开手更符合"展开"的直觉

3. **坐标系统一**
   - 确保 MediaPipe 的 $Y$ 轴与 Three.js 的 $Y$ 轴方向一致
   - 可能需要执行 `1 - y` 处理进行坐标翻转
   - 实现坐标归一化：将 MediaPipe 输出转换为 $[0, 1]$ 范围

4. **一阶滞后滤波实现**
   - 实现滤波公式：$Output_n = \alpha \cdot Input_n + (1 - \alpha) \cdot Output_{n-1}$
   - 建议 $\alpha = 0.2$，用于平滑坐标抖动

5. **旋转控制逻辑**
   - 实现坐标转换公式：$TargetRotation = (HandX - 0.5) \cdot \pi \cdot Sensitivity$
   - **重要约束**：当 `isPinching` 为 `true` 时，旋转灵敏度降低至 10%（或完全锁定），避免在选中部位时模型旋转导致瞄准困难

#### 1.1.4 交付物

一个全局可访问的 `window.handData` 对象，包含：
- 实时手势状态（`state`）
- 归一化坐标数组（`landmarks`）
- 识别置信度（`confidence`）
- 平滑处理后的坐标数据

---

### 1.2 组员 B：3D 场景与资产架构师 (Asset/Visual Lead)

#### 1.2.1 核心目标

把心脏变成"高科技解剖标本"——实现精美的 3D 渲染和动画效果

#### 1.2.2 核心动作

模型层级命名规范化与材质调优

#### 1.2.3 具体作业

1. **模型层级命名规范化**
   - **命名规范**：前缀必须为 `Heart_`
   - 心脏 GLB 内部零件必须命名为：
     - `Heart_LV` (左心室)
     - `Heart_RV` (右心室)
     - `Heart_Aorta` (主动脉)
     - `Heart_Valves` (瓣膜)
   
   **坐标规范**：
   - 所有零件在导出前必须执行"Reset Transform"
   - 确保每个零件的局部坐标原点均在 $(0,0,0)$
   - 否则剥离动画将产生错位位移

2. **材质配置**
   - **背景设置**：设置黑色背景
   - **基础材质**：心脏零件使用金色/红色金属材质
   - **自发光效果**：所有零件统一开启 `emissive`（自发光）
   - **选中效果**：选中时，`emissiveIntensity` 从 0 平滑过渡到 1
   - **辉光特效**：开启 UnrealBloomPass 辉光特效
     - Strength: 1.5
     - Threshold: 0.85
     - Radius: 0.4

3. **执行函数：`animateExplode(factor)`**
   - **参数**：`factor` (0-1 之间的浮点数)
   - **功能**：
     - `factor = 0` 时：心脏完全合拢（初始状态）
     - `factor = 1` 时：心脏完全散开（最大分离）
     - 中间值：平滑插值实现渐进式分离
   - **实现方式**：根据 `Anatomy_Config.json` 中的 `offset` 值进行位移插值

4. **视觉效果增强**
   - 实现菲涅尔反射（Fresnel Effect）增强模型体积感
   - **技术实现**：修改 `StandardMaterial` 的 `onBeforeCompile` 钩子来注入菲涅尔逻辑
   - 在 fragmentShader 中叠加边缘高光效果
   - 保留 StandardMaterial 的 `emissive` 属性，实现自发光与边缘高光的结合

#### 1.2.4 交付物

- 一个包含所有零件的 `THREE.Group` 对象
- 核心动画执行函数 `animateExplode(factor)`
- 配置好的材质和渲染效果
- 符合命名规范的 GLB 模型文件

---

### 1.3 组员 C：逻辑集成与 AI 官 (Logic/AI Lead)

#### 1.3.1 核心目标

实现"指哪打哪"并让 AI 说话——完成交互逻辑和 AI 集成

#### 1.3.2 核心动作

编写 raycaster 逻辑与 DeepMed API 联调

#### 1.3.3 具体作业

1. **交互监听**
   - 监听 `handData.state` 状态变化
   - 当 `handData.state == 'PINCH'` 时，执行 `raycaster.intersectObjects`
   - 将 MediaPipe 的 2D 坐标转换为 Three.js 的射线检测坐标
   - 检测射线与心脏模型的碰撞
   - **旋转锁定机制**：当 `isPinching` 为 `true` 时，通知旋转控制模块降低或锁定旋转，确保瞄准稳定性

2. **AI 模块对接**
   - 集成 DeepMed API 接口
   - 当检测到有效碰撞时，向 DeepMed API 发送当前 `intersected.name`
   - 实现本地缓存（LocalCache）机制，预置核心零件的 30 字简介
   - 先显示缓存内容，后台异步获取完整 API 响应后更新

3. **UI 纠错反馈**
   - **correct_hit（正确命中）**：
     - UI 边框变为金黄色 (#D4AF37)
     - 显示医学释义（来自 DeepMed API 或本地缓存）
     - 侧边栏展示结构化医学知识
   
   - **miss_hit（错误命中）**：
     - UI 边框闪烁红色 (#FF0000)
     - 提示"请精准指向目标解剖区"
     - 如果用户指尖接触到的是无意义区域，侧边栏变红提示"无效部位"

4. **交互降级方案**
   - 检测用户设备是否支持摄像头
   - 若不支持，自动开启"鼠标滚轮剥离"作为备选交互模式
   - 实现鼠标点击触发 Raycaster 检测

5. **项目整合**
   - 整合 `index.html`，实现各模块联调
   - 使用 VS Code Live Server 插件解决模型加载的跨域限制
   - 确保所有模块能够正常通信和协作

#### 1.3.4 交付物

- 完整的 `index.html` 主文件
- 实现 Raycaster 碰撞检测的 JavaScript 模块
- DeepMed API 集成代码
- UI 纠错反馈组件
- 本地缓存机制实现
- 交互降级方案代码

---

## 2. 进度时间轴 (Development Timeline)

### 2.1 阶段一：感知层联调 (12/28 - 12/29)

**目标**：完成手势判定逻辑，确保控制台能准确输出 PINCH、OPEN、FIST 三种状态

**任务清单**：
- [ ] **P0 - 验证 Live Server 环境下的模型加载**（阻塞性任务，必须在 Day 1 完成，否则全员停工）
- [ ] 部署 MediaPipe Hands 运行环境
- [ ] 实现 `getGestureStatus()` 函数，支持 OPEN/FIST/PINCH 三种状态
- [ ] 完成坐标归一化处理
- [ ] 验证手势状态输出的准确性

**关键里程碑**：
- Live Server 环境验证通过
- 手势识别功能基本完成
- 坐标系统初步对齐

### 2.2 阶段二：解剖动画集成 (12/30 - 01/02)

**目标**：完成 `animateExplode` 并在页面显示心脏解剖结构

**任务清单**：
- [ ] 加载并解析 GLB 心脏模型
- [ ] 实现模型层级命名规范化
- [ ] 编写 `animateExplode(factor)` 动画函数
- [ ] 配置材质与 UnrealBloomPass 效果
- [ ] 测试剥离动画的流畅性

**关键里程碑**：
- 心脏模型成功加载并渲染
- 剥离动画功能完成
- 视觉效果配置完成

### 2.3 阶段三：AI 注入与交付 (01/03 - 01/06)

**目标**：接入 DeepMed 接口，进行演示视频录制及文档封包

**任务清单**：
- [ ] 实现 Raycaster 碰撞检测逻辑
- [ ] 集成 DeepMed API 接口
- [ ] 实现 UI 纠错反馈系统
- [ ] 进行端到端测试
- [ ] 录制演示视频
- [ ] 整理项目文档

**关键里程碑**：
- AI 功能集成完成
- 端到端测试通过
- 项目交付准备完成

---

## 3. 协作规范 (Collaboration Standards)

### 3.1 代码规范

- 使用统一的命名规范（见各模块详细说明）
- 所有全局变量使用 `window` 对象挂载
- 模块间通信通过 `State_Channel` 对象

### 3.2 测试要求

- 每个模块完成后需进行独立测试
- 集成测试前确保各模块接口定义清晰
- 最终交付前进行端到端测试

### 3.3 文档要求

- 每个模块需提供简要的使用说明
- 关键函数需添加注释说明
- 交付时提供模块接口文档

### 3.4 跨域环境启动指南

**重要**：Live Server 必须在 Day 1 跑通，否则模型无法加载，全员停工。

**统一开发环境**：
- 使用 VS Code Live Server 插件作为统一开发环境
- 所有开发人员统一使用该插件启动本地服务器
- 解决浏览器限制本地模型文件加载的跨域问题

**启动步骤**：
1. 在 VS Code 中安装 "Live Server" 插件
2. 右键点击 `index.html` 文件
3. 选择 "Open with Live Server"
4. 浏览器自动打开并启动本地服务器
5. 验证 GLB 模型能够正常加载

**后续考虑**：使用 CDN 托管模型文件（如果文件大小允许）


