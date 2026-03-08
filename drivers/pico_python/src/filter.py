#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import math


class AdaptiveEMAFilter:
    def __init__(self,
                 adaptive_smoothing=True,
                 smoothing_alpha=0.2,
                 min_adaptive_alpha=0.16,
                 max_adaptive_alpha=0.5,
                 velocity_low=0.003,
                 velocity_high=0.03):
        """
        严格复刻前端 mediapipe_hand_publisher.js 中的自适应滤波逻辑。
        利用食指指尖(点8)的位移速度动态调整 EMA 的 alpha 系数，在抗抖动与防拖影之间取得数学平衡。
        """
        self.adaptive_smoothing = adaptive_smoothing
        self.default_alpha = smoothing_alpha
        self.min_alpha = min_adaptive_alpha
        self.max_alpha = max_adaptive_alpha
        self.velocity_low = velocity_low
        self.velocity_high = velocity_high

        # 状态记忆：用于计算速度的上一帧原始坐标，以及用于滤波插值的上一帧平滑坐标
        self.last_raw_landmarks = None
        self.last_smoothed_landmarks = None

        # 记录当前使用的 alpha 值，方便在终端或调试日志中打印监控
        self.last_adaptive_alpha = self.default_alpha

    def _distance3(self, p1, p2):
        """计算三维空间欧氏距离"""
        dx = p1['x'] - p2['x']
        dy = p1['y'] - p2['y']
        dz = p1['z'] - p2['z']
        return math.sqrt(dx * dx + dy * dy + dz * dz)

    def _clamp01(self, v):
        """将数值截断到 [0, 1] 区间"""
        return max(0.0, min(1.0, v))

    def reset(self):
        """
        当追踪丢失（未检测到手）时，由外部状态机调用以重置滤波器历史状态。
        防止重新捕获手掌时发生坐标瞬移的插值拉扯。
        """
        self.last_raw_landmarks = None
        self.last_smoothed_landmarks = None
        self.last_adaptive_alpha = self.default_alpha

    def _compute_adaptive_alpha(self, current_landmarks):
        """
        基于食指指尖(点8)的帧间位移计算动态插值系数 alpha。
        """
        if not self.adaptive_smoothing or not self.last_raw_landmarks:
            return self.default_alpha

        # 计算空间位移 (速度的代理量)
        v = self._distance3(current_landmarks[8], self.last_raw_landmarks[8])

        # 将速度线性映射到 [0, 1] 的比例参数 t
        # 使用 max(1e-6, ...) 防止除以零引发的内核异常
        denominator = max(1e-6, self.velocity_high - self.velocity_low)
        t = self._clamp01((v - self.velocity_low) / denominator)

        # 线性插值计算出这一帧专用的 alpha
        alpha = self.min_alpha + (self.max_alpha - self.min_alpha) * t
        return alpha

    def apply(self, current_landmarks):
        """
        应用自适应 EMA 滤波。传入当前帧的 21 个字典坐标组，返回平滑后的坐标组。
        """
        # 数据合法性前置拦截
        if not current_landmarks or len(current_landmarks) != 21:
            return current_landmarks

        # 第一帧初始化：直接透传，并建立深拷贝的历史基准线
        if not self.last_smoothed_landmarks:
            self.last_raw_landmarks = [{'x': p['x'], 'y': p['y'], 'z': p['z']} for p in current_landmarks]
            self.last_smoothed_landmarks = [{'x': p['x'], 'y': p['y'], 'z': p['z']} for p in current_landmarks]
            return self.last_smoothed_landmarks

        # 1. 计算当前帧的整体滤波烈度
        alpha = self._compute_adaptive_alpha(current_landmarks)
        self.last_adaptive_alpha = alpha

        # 2. 对 21 个关键点逐一执行一阶低通滤波
        smoothed = []
        for i, p in enumerate(current_landmarks):
            prev = self.last_smoothed_landmarks[i]
            sx = alpha * p['x'] + (1.0 - alpha) * prev['x']
            sy = alpha * p['y'] + (1.0 - alpha) * prev['y']
            sz = alpha * p['z'] + (1.0 - alpha) * prev['z']
            smoothed.append({'x': sx, 'y': sy, 'z': sz})

        # 3. 严格使用推导式覆盖历史状态（隔离内存引用）
        self.last_raw_landmarks = [{'x': p['x'], 'y': p['y'], 'z': p['z']} for p in current_landmarks]
        self.last_smoothed_landmarks = smoothed

        return smoothed