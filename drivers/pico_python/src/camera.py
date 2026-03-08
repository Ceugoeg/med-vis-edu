#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import cv2
import threading
import time


class CameraStream:
    def __init__(self, device_id=0, width=640, height=480, fps=30):
        """
        异步非阻塞摄像头拉流模块，严格对应前端 MediaPipe 的 window.Camera 行为。
        :param device_id: 摄像头设备号。在 Luckfox Pico Max 上，CSI 摄像头通常映射为 0 或 11 (/dev/video0 或 /dev/video11)
        """
        self.device_id = device_id
        self.width = width
        self.height = height
        self.fps = fps

        # 强制使用 V4L2 后端，这是 Linux 下读取 CSI 摄像头的标准协议
        self.cap = cv2.VideoCapture(self.device_id, cv2.CAP_V4L2)

        # 尝试配置硬件寄存器
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        self.cap.set(cv2.CAP_PROP_FPS, self.fps)

        # 很多嵌入式板卡需要指定 MJPG 格式才能跑到高帧率，否则 YUYV 格式带宽不够会掉帧
        self.cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))

        if not self.cap.isOpened():
            print(f"[ERROR] 无法打开摄像头设备 /dev/video{self.device_id}。请检查排线或 dmesg 日志。")

        self.frame = None
        self.running = False
        # 线程锁，防止主线程读取和后台线程写入发生内存冲突（撕裂）
        self.lock = threading.Lock()
        self.thread = None

    def start(self):
        """
        对应 JS 中的 await this.camera.start();
        开启后台守护线程，疯狂拉取最新帧，不阻塞主线程。
        """
        if self.running:
            return

        self.running = True
        # Daemon=True 保证主程序退出时，这个底层的拉流线程会自动被强制销毁，防止僵尸进程占用摄像头
        self.thread = threading.Thread(target=self._update, daemon=True)
        self.thread.start()

        # 稍微阻塞一下主线程，确保摄像头硬件已经预热并吐出第一帧
        time.sleep(0.5)

    def _update(self):
        """
        后台无限循环拉流（对应 JS 中的 requestAnimationFrame loop）
        """
        while self.running:
            ret, frame = self.cap.read()
            if ret:
                # ==========================================================
                # 核心细节复刻：facingMode: 'user' (前置摄像头镜像还原)
                # MediaPipe 的坐标系依赖于镜像画面。如果在 Python 端不翻转，
                # 前端的渲染骨架将向反方向移动，且左右手判定完全颠倒！
                # ==========================================================
                frame = cv2.flip(frame, 1)

                with self.lock:
                    self.frame = frame
            else:
                # 硬件异常或掉帧时的退避策略，防止 CPU 100% 空转
                time.sleep(0.01)

    def read(self):
        """
        暴露给主推理循环的非阻塞读取接口。
        永远只返回当前内存里最新的一帧，跳过中间积压的旧帧（降低端到端延迟）。
        """
        with self.lock:
            if self.frame is not None:
                # 返回副本，防止主线程在预处理图像时，后台线程同时写入覆盖
                return self.frame.copy()
            return None

    def stop(self):
        """
        对应 JS 中的 this.camera.stop(); 释放硬件资源
        """
        self.running = False
        if self.thread is not None:
            self.thread.join()

        if self.cap is not None:
            self.cap.release()