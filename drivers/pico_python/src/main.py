#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import sys
import os
import time
import json

# ==========================================
# 1. 核心：运行时路径注入 (Path Injection)
# ==========================================
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
libs_path = os.path.join(project_root, 'libs')

if libs_path not in sys.path:
    sys.path.insert(0, libs_path)
    print(f"[BOOT] 依赖路径注入成功: {libs_path}")

# ==========================================
# 2. 安全导入底层依赖 (避开系统自带的臃肿包)
# ==========================================
try:
    import cv2
    import tflite_runtime.interpreter as tflite
    print(f"[BOOT] OpenCV 版本: {cv2.__version__}")
except ImportError as e:
    print(f"[ERROR] 无法加载底层依赖库。详细错误: {e}")
    sys.exit(1)

# ==========================================
# 3. 导入本项目内部模块
# ==========================================
from camera import CameraStream
from tracker_tflite import HandTracker
from filters import AdaptiveEMAFilter
from hsm import InteractionHSM
from ws_server import WebSocketBroadcaster

def main():
    print("[BOOT] 正在初始化 Pico Max 边缘端感知服务...")
    
    # 初始化各个解耦子模块
    cam = CameraStream(device_id=0, width=640, height=480)
    tracker = HandTracker()
    ema_filter = AdaptiveEMAFilter()
    hsm = InteractionHSM()
    ws = WebSocketBroadcaster(host='0.0.0.0', port=8080)
    
    # 启动异步视频流采集和 WebSocket 广播服务
    cam.start()
    ws.start()
    
    print("[INFO] 服务已全面就绪，开始推理循环。按 Ctrl+C 终止。")
    
    try:
        while True:
            start_time = time.time()
            
            # 1. 获取最新视频帧 (非阻塞)
            frame = cam.read()
            if frame is None:
                time.sleep(0.01)
                continue
                
            # 2. TFLite 推理获取 21 个 3D 归一化坐标
            raw_landmarks = tracker.process(frame)
            
            if raw_landmarks:
                # 3. 1-Euro 级联滤波平滑处理
                smoothed_landmarks = ema_filter.apply(raw_landmarks)
                
                # 4. 几何启发式状态机，坍缩输出离散手势
                gesture_state = hsm.update(smoothed_landmarks)
                
                # 5. 计算当前处理延迟 (端到端) 与 FPS
                latency_ms = int((time.time() - start_time) * 1000)
                fps = int(1000 / latency_ms) if latency_ms > 0 else 999
                
                # 6. 组装结构化运动学数据字典
                payload = {
                    "timestamp": time.time(),
                    "state": gesture_state,
                    "landmarks": smoothed_landmarks,
                    "metrics": {
                        "fps": fps,
                        "latency_ms": latency_ms
                    }
                }
                
                # 7. 跨线程扔给 WebSocket 下发
                ws.broadcast(json.dumps(payload))
                
                print(f"[RUN] 状态: {gesture_state.ljust(10)} | 延迟: {latency_ms}ms | FPS: {fps}", end='\r')
            else:
                ema_filter.reset()
                print("[RUN] 未检测到手势...".ljust(40), end='\r')
                
    except KeyboardInterrupt:
        print("\n[SHUTDOWN] 接收到退出信号，正在清理资源...")
    finally:
        cam.stop()
        ws.stop()
        tracker.close()
        print("[SHUTDOWN] 资源清理完毕。退出。")

if __name__ == '__main__':
    main()