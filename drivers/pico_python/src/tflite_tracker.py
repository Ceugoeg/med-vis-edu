#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import cv2
import numpy as np
import tflite_runtime.interpreter as tflite

class HandTracker:
    def __init__(self, palm_score_threshold=0.5, landmark_score_threshold=0.5):
        self.palm_score_threshold = palm_score_threshold
        self.landmark_score_threshold = landmark_score_threshold
        
        current_dir = os.path.dirname(os.path.abspath(__file__))
        models_dir = os.path.join(os.path.dirname(current_dir), 'models')
        palm_model_path = os.path.join(models_dir, 'palm_detection_lite.tflite')
        landmark_model_path = os.path.join(models_dir, 'hand_landmark_lite.tflite')
        
        if not os.path.exists(palm_model_path) or not os.path.exists(landmark_model_path):
            raise FileNotFoundError(f"[Tracker] 模型文件丢失，请检查 {models_dir} 目录。")
            
        self.palm_interp = tflite.Interpreter(model_path=palm_model_path)
        self.palm_interp.allocate_tensors()
        self.palm_in = self.palm_interp.get_input_details()[0]
        self.palm_out = self.palm_interp.get_output_details()
        
        self.land_interp = tflite.Interpreter(model_path=landmark_model_path)
        self.land_interp.allocate_tensors()
        self.land_in = self.land_interp.get_input_details()[0]
        self.land_out = self.land_interp.get_output_details()
        
        self.is_tracking = False
        self.previous_landmarks = None
        print("[Tracker] TFLite 解释器分配完毕。纯 CPU 推理模式已启动。")

    def _clamp01(self, v):
        """严格复刻前端的截断逻辑"""
        return max(0.0, min(1.0, v))

    def _preprocess_image(self, frame, input_details):
        input_shape = input_details['shape']
        target_size = (input_shape[2], input_shape[1])
        img_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        img_resized = cv2.resize(img_rgb, target_size)
        img_normalized = img_resized.astype(np.float32) / 255.0
        return np.expand_dims(img_normalized, axis=0)

    def _run_palm_detection(self, frame):
        img_input = self._preprocess_image(frame, self.palm_in)
        self.palm_interp.set_tensor(self.palm_in['index'], img_input)
        self.palm_interp.invoke()
        
        classificators = self.palm_interp.get_tensor(self.palm_out[1]['index'])[0]
        scores = 1.0 / (1.0 + np.exp(-classificators))
        max_idx = np.argmax(scores)
        max_score = scores[max_idx][0]
        
        if max_score < self.palm_score_threshold:
            return None
            
        return {"score": max_score, "rough_center": (0.5, 0.5)}

    def _run_hand_landmarks(self, frame):
        img_input = self._preprocess_image(frame, self.land_in)
        self.land_interp.set_tensor(self.land_in['index'], img_input)
        self.land_interp.invoke()
        
        landmarks_tensor = self.land_interp.get_tensor(self.land_out[0]['index'])
        hand_flag = self.land_interp.get_tensor(self.land_out[1]['index'])[0][0]
        hand_score = 1.0 / (1.0 + np.exp(-hand_flag))
        
        if hand_score < self.landmark_score_threshold:
            return None

        landmarks_flat = landmarks_tensor[0]
        landmarks = []
        for i in range(21):
            x = landmarks_flat[i * 3] / 224.0
            y = landmarks_flat[i * 3 + 1] / 224.0
            # ==========================================================
            # 核心修正：严格对齐前端的 Z 轴深度量纲映射
            # clamp01((lm.z + 0.5) / 1.0)
            # ==========================================================
            raw_z = landmarks_flat[i * 3 + 2] / 224.0
            z = self._clamp01((raw_z + 0.5) / 1.0)
            
            landmarks.append({
                "x": self._clamp01(float(x)), 
                "y": self._clamp01(float(y)), 
                "z": float(z)
            })
            
        return landmarks

    def process(self, frame):
        landmarks = None
        if not self.is_tracking:
            palm_result = self._run_palm_detection(frame)
            if palm_result is not None:
                landmarks = self._run_hand_landmarks(frame)
                if landmarks:
                    self.is_tracking = True
                    self.previous_landmarks = landmarks
        else:
            landmarks = self._run_hand_landmarks(frame)
            if landmarks is not None:
                self.previous_landmarks = landmarks
            else:
                self.is_tracking = False
                self.previous_landmarks = None
                
        return landmarks

    def close(self):
        pass