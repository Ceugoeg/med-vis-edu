// mock_hands.js
// 模拟组员 A 的 MediaPipe 硬件输入，强制限定为 20 FPS (50ms) 更新率

// 1. 初始化全局契约对象 (唯一的数据交接点)
window.handData = {
    state: 'NONE',      // 'OPEN' | 'FIST' | 'PINCH' | 'NONE'
    landmarks: new Array(21).fill({ x: 0.5, y: 0.5, z: 0 }), 
    confidence: 0.0
};

// 2. 内部高频缓冲区 (用于接收浏览器的 60Hz 事件)
const rawBuffer = {
    state: 'NONE',
    x: 0.5,
    y: 0.5
};

// 3. 拦截鼠标移动 (模拟摄像头的 X/Y 坐标)
// 注意：屏幕左上角为 (0,0)，右下角为 (1,1)
window.addEventListener('mousemove', (e) => {
    rawBuffer.x = e.clientX / window.innerWidth;
    rawBuffer.y = e.clientY / window.innerHeight;
});

// 4. 拦截键盘输入 (模拟手势状态变化)
// 空格键 -> PINCH (捏合，用于触发射线)
// O 键 -> OPEN (张开，用于剥离)
// F 键 -> FIST (握拳，用于复原)
window.addEventListener('keydown', (e) => {
    if (e.repeat) return; // 忽略长按带来的重复触发
    
    switch(e.code) {
        case 'Space':
            rawBuffer.state = 'PINCH';
            break;
        case 'KeyO':
            rawBuffer.state = 'OPEN';
            break;
        case 'KeyF':
            rawBuffer.state = 'FIST';
            break;
    }
});

window.addEventListener('keyup', (e) => {
    switch(e.code) {
        case 'Space':
        case 'KeyO':
        case 'KeyF':
            rawBuffer.state = 'NONE';
            break;
    }
});

// 5. 核心：模拟硬件 20 FPS 采样与一阶滞后滤波
const HARDWARE_FPS = 20;
const INTERVAL_MS = 1000 / HARDWARE_FPS;
const ALPHA = 0.2; // A 被要求实现的一阶滞后滤波权重

// 存放上一帧的滤波结果
let lastFilteredX = 0.5;
let lastFilteredY = 0.5;

setInterval(() => {
    // 执行空间坐标滤波 (模拟 A 的工作)
    // Formula: Output_n = alpha * Input_n + (1 - alpha) * Output_n-1
    const currentFilteredX = ALPHA * rawBuffer.x + (1 - ALPHA) * lastFilteredX;
    const currentFilteredY = ALPHA * rawBuffer.y + (1 - ALPHA) * lastFilteredY;
    
    // 更新全局契约对象
    window.handData.state = rawBuffer.state;
    // 置信度模拟：如果是有效手势，给个高置信度
    window.handData.confidence = rawBuffer.state === 'NONE' ? 0.2 : 0.95;
    
    // 我们主要关注第 8 个关键点 (食指指尖) 用于射线检测
    // 以及整体坐标用于模型旋转
    const newLandmarks = new Array(21).fill({ x: 0.5, y: 0.5, z: 0 });
    newLandmarks[8] = { 
        x: currentFilteredX, 
        y: currentFilteredY, 
        z: 0.1 // 深度暂时用固定值 
    };
    
    window.handData.landmarks = newLandmarks;

    // 状态推移
    lastFilteredX = currentFilteredX;
    lastFilteredY = currentFilteredY;

}, INTERVAL_MS);

console.log(`[Hardware Mock] 驱动已挂载，当前模拟采样率: ${HARDWARE_FPS}Hz`);