#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import math
import time

class InteractionHSM:
    def __init__(self):
        """
        边缘端启发式状态机 (Heuristic State Machine)
        职责是将 21 个 3D 坐标坍缩为稳定的离散控制信号 (NONE, OPEN, PINCH, FIST)。
        为配合前端的“棘轮拖拽”交互，此版本启用了严格几何判定（严格五指全开/全收）。
        """
        self.config = {
            'pinchThreshold': 0.055,
            'dynamicPinch': True,
            'pinchRatioThreshold': 0.34,
            'pinchOpenBaselineCount': 2,

            # [STRICT MODE] 加严 OPEN 的伸展阈值：要求手指绷得更直，指尖明显高于指根
            'openEnterExtensionThreshold': 0.05,
            'openExitExtensionThreshold': 0.035,
            'openEnterYGapThreshold': -0.075,
            'openExitYGapThreshold': -0.055,

            # [STRICT MODE] 加严 FIST 的卷曲阈值：要求握得更紧，不留空隙
            'fistEnterCurlThreshold': -0.015,
            'fistExitCurlThreshold': -0.008,
            'fistEnterYGapAbsThreshold': 0.05,
            'fistExitYGapAbsThreshold': 0.07,

            # [STRICT MODE] 加严拇指状态判定：必须明显远离或紧贴掌心
            'thumbExtendedEnterThreshold': 0.06,
            'thumbExtendedExitThreshold': 0.05,
            'thumbCurledEnterThreshold': 0.045,
            'thumbCurledExitThreshold': 0.055,

            'stateVoteWindow': 5,
            'openConfirmFramesAfterAction': 2,
            'stateHoldFrames': 1,
            'forceFistAfterMs': 300
        }

        self.stable_state = 'NONE'
        self.candidate_state = 'NONE'
        self.candidate_frames = 0
        self.state_history = []
        self.open_candidate_frames = 0
        self.force_fist_start_ms = None

    def _distance3(self, a, b):
        dx = a['x'] - b['x']
        dy = a['y'] - b['y']
        dz = a['z'] - b['z']
        return math.sqrt(dx * dx + dy * dy + dz * dz)

    def update(self, smoothed_landmarks):
        if not smoothed_landmarks or len(smoothed_landmarks) != 21:
            self.state_history.clear()
            self.open_candidate_frames = 0
            self.force_fist_start_ms = None
            
            # 维持 FIST 状态不断触，但允许自然降级
            if self.stable_state == 'FIST':
                return 'FIST'
            else:
                return self._commit_state('NONE')

        now_ms = time.time() * 1000.0

        # 1. 宽容度降级的 FIST 兜底判定
        hold_fist_candidate = self._detect_force_fist_candidate(smoothed_landmarks)
        self._update_force_fist_timer(hold_fist_candidate, now_ms)

        # 2. 核心严格判定
        raw_state = self._detect_gesture(smoothed_landmarks)

        # 3. 强制覆盖兜底
        if self._should_force_fist(raw_state, now_ms):
            raw_state = 'FIST'

        # 4. 时序约束与防抖
        constrained_state = self._apply_transition_constraints(raw_state)
        voted_state = self._vote_state(constrained_state)
        stable = self._commit_state(voted_state)

        return stable

    def _update_force_fist_timer(self, is_candidate, now_ms):
        if not is_candidate:
            self.force_fist_start_ms = None
            return
        if self.force_fist_start_ms is None:
            self.force_fist_start_ms = now_ms

    def _should_force_fist(self, raw_state, now_ms):
        if raw_state != 'NONE':
            return False
        if self.stable_state not in ('NONE', 'FIST'):
            return False
        if self.force_fist_start_ms is None:
            return False
        return (now_ms - self.force_fist_start_ms) >= self.config['forceFistAfterMs']

    def _detect_force_fist_candidate(self, landmarks):
        wrist = landmarks[0]
        finger_pairs = [(8, 5), (12, 9), (16, 13), (20, 17)]

        loose_curl_threshold = self.config['fistExitCurlThreshold'] + 0.02
        curled = []
        for tip_idx, mcp_idx in finger_pairs:
            tip_dist = self._distance3(landmarks[tip_idx], wrist)
            mcp_dist = self._distance3(landmarks[mcp_idx], wrist)
            delta = tip_dist - mcp_dist
            curled.append(delta < loose_curl_threshold)

        index_curled = curled[0]
        middle_curled = curled[1]
        curled_count_loose = sum(curled)

        return (index_curled or middle_curled) and curled_count_loose >= 2

    def _apply_transition_constraints(self, raw_state):
        # 移除早期版本 FIST 锁死 NONE 的 Bug，使得棘轮拖拽时的微张动作可以平滑回归 NONE
        if raw_state == 'OPEN':
            self.open_candidate_frames += 1
        else:
            self.open_candidate_frames = 0

        from_state = self.stable_state
        leaving_critical_state = from_state in ('FIST', 'PINCH')

        if leaving_critical_state and raw_state == 'OPEN' and self.open_candidate_frames < self.config['openConfirmFramesAfterAction']:
            return 'NONE'

        return raw_state

    def _vote_state(self, state):
        self.state_history.append(state)
        if len(self.state_history) > self.config['stateVoteWindow']:
            self.state_history.pop(0)

        counts = {}
        for s in self.state_history:
            counts[s] = counts.get(s, 0) + 1

        winner = self.stable_state
        winner_count = -1
        for candidate, count in counts.items():
            if count > winner_count:
                winner = candidate
                winner_count = count
            elif count == winner_count and candidate == self.stable_state:
                winner = candidate

        return winner

    def _commit_state(self, raw_state):
        if raw_state != self.candidate_state:
            self.candidate_state = raw_state
            self.candidate_frames = 1
        else:
            self.candidate_frames += 1

        if self.candidate_state != self.stable_state and self.candidate_frames >= self.config['stateHoldFrames']:
            self.stable_state = self.candidate_state

        return self.stable_state

    def _detect_gesture(self, landmarks):
        pinch_dist = self._distance3(landmarks[4], landmarks[8])
        hand_scale = max(self._distance3(landmarks[0], landmarks[5]), 1e-6)
        pinch_ratio = pinch_dist / hand_scale

        if self.config['dynamicPinch']:
            pinch_matched = pinch_ratio < self.config['pinchRatioThreshold']
        else:
            pinch_matched = pinch_dist < self.config['pinchThreshold']

        wrist = landmarks[0]
        finger_pairs = [(8, 5), (12, 9), (16, 13), (20, 17)]

        extended_count = 0
        curled_count = 0

        for tip_idx, mcp_idx in finger_pairs:
            tip_dist = self._distance3(landmarks[tip_idx], wrist)
            mcp_dist = self._distance3(landmarks[mcp_idx], wrist)
            delta = tip_dist - mcp_dist

            if delta > self.config['openEnterExtensionThreshold']:
                extended_count += 1
            if delta < self.config['fistEnterCurlThreshold']:
                curled_count += 1

        thumb_dist = self._distance3(landmarks[4], landmarks[2])
        is_open_sticky = (self.stable_state == 'OPEN')
        is_fist_sticky = (self.stable_state == 'FIST')

        open_delta_threshold = self.config['openExitExtensionThreshold'] if is_open_sticky else self.config['openEnterExtensionThreshold']
        fist_delta_threshold = self.config['fistExitCurlThreshold'] if is_fist_sticky else self.config['fistEnterCurlThreshold']

        open_count = 0
        fist_count = 0
        open_y_count = 0
        fist_y_count = 0

        for tip_idx, mcp_idx in finger_pairs:
            tip_dist = self._distance3(landmarks[tip_idx], wrist)
            mcp_dist = self._distance3(landmarks[mcp_idx], wrist)
            delta = tip_dist - mcp_dist
            y_gap = landmarks[tip_idx]['y'] - landmarks[mcp_idx]['y']
            y_gap_abs = abs(y_gap)

            if delta > open_delta_threshold: open_count += 1
            if delta < fist_delta_threshold: fist_count += 1
            if y_gap < open_y_gap_threshold: open_y_count += 1
            if y_gap_abs < fist_y_gap_abs_threshold: fist_y_count += 1

        thumb_extended_hys = thumb_dist > thumb_open_threshold
        thumb_curled_hys = thumb_dist < thumb_fist_threshold

        pinch_baseline_ready = self.stable_state in ('PINCH', 'OPEN') or (open_y_count >= self.config['pinchOpenBaselineCount'])

        finger_curl_flags = []
        for tip_idx, mcp_idx in finger_pairs:
            tip_dist = self._distance3(landmarks[tip_idx], wrist)
            mcp_dist = self._distance3(landmarks[mcp_idx], wrist)
            delta = tip_dist - mcp_dist
            y_gap_abs = abs(landmarks[tip_idx]['y'] - landmarks[mcp_idx]['y'])
            finger_curl_flags.append(delta < fist_delta_threshold or y_gap_abs < fist_y_gap_abs_threshold)

        index_curled, middle_curled, ring_curled, pinky_curled = finger_curl_flags
        
        # [严格判定]：四指必须全部卷曲
        core_fist_ready = index_curled and middle_curled and ring_curled and pinky_curled

        pinch_support_pairs = [(12, 9), (16, 13), (20, 17)]
        pinch_support_open_count = 0
        for tip_idx, mcp_idx in pinch_support_pairs:
            tip_dist = self._distance3(landmarks[tip_idx], wrist)
            mcp_dist = self._distance3(landmarks[mcp_idx], wrist)
            delta = tip_dist - mcp_dist
            y_gap = landmarks[tip_idx]['y'] - landmarks[mcp_idx]['y']
            if delta > open_delta_threshold and y_gap < open_y_gap_threshold:
                pinch_support_open_count += 1

        pinch_support_open_threshold = 2 if self.stable_state == 'PINCH' else 3

        if pinch_matched and pinch_baseline_ready and pinch_support_open_count >= pinch_support_open_threshold:
            return 'PINCH'

        # [严格判定]：五根手指（四指 + 拇指）全部伸展
        if open_count >= 4 and open_y_count >= 4 and thumb_extended_hys and extended_count == 4:
            return 'OPEN'

        # [严格判定]：五根手指（四指 + 拇指）全部卷曲且贴近掌心
        if core_fist_ready and fist_count >= 4 and fist_y_count >= 3 and curled_count == 4 and (
                thumb_curled_hys or self.stable_state == 'FIST'):
            return 'FIST'

        return 'NONE'