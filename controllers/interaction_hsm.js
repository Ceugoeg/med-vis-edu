// controllers/interaction_hsm.js
import * as THREE from 'three';
import { MathPhysicsUtil } from '../utils/math_physics.js';

export class InteractionHSM {
    constructor() {
        this.appMode = 'WHOLE';

        this.globalTargetQuat = new THREE.Quaternion();
        this.currentVelocityY = 0;
        this.currentVelocityX = 0;

        this.localTargetQuat = new THREE.Quaternion();
        this.localVelocityY = 0;
        this.localVelocityX = 0;

        this.lastHandX = 0.5;
        this.lastHandY = 0.5;
        this.isDragging = false;
        
        this.fistHoldStartMs = null;
        this.wholePinchMode = false;

        // --- 新增：OPEN 状态的防误触驻留计时器 ---
        this.wholeOpenStartTimeMs = null;

        // 防边缘抖动相关的参数
        this.wholeEdgeGuardRatio = 0.03;
        this.wholeReentryFramesRequired = 1;
        this.wholeDeltaClamp = 0.06;
        this.wholeReentryCooldownFrames = 1;
        this.wholeEdgeLocked = false;
        this.wholeSafeReentryFrames = 0;
        
        this.pinchFired = false;
        this.fistActionFired = false; 
    }

    update(handData, callbacks) {
        if (!handData || !handData.landmarks) return null;

        let currentState = handData.state; 
        const indexFinger = handData.landmarks[8];
        const mirroredX = 1.0 - indexFinger.x;
        const mirroredY = indexFinger.y;

        // ==========================================
        // 核心新增：WHOLE 模式下的 OPEN 延时逻辑锁
        // 用于保障“棘轮拖拽”体验，防止手掌微张时意外炸开模型
        // ==========================================
        if (this.appMode === 'WHOLE') {
            if (currentState === 'OPEN') {
                if (this.wholeOpenStartTimeMs === null) {
                    this.wholeOpenStartTimeMs = Date.now();
                }
                // 如果持续时间不足 0.5 秒，强制将内部状态降级为 NONE
                if (Date.now() - this.wholeOpenStartTimeMs < 500) {
                    currentState = 'NONE';
                }
            } else {
                // 一旦手势变为 FIST/PINCH/NONE，立刻清空计时器
                this.wholeOpenStartTimeMs = null;
            }
        } else {
            // 非 WHOLE 模式下不启用此锁，保证交互的灵敏度
            this.wholeOpenStartTimeMs = null;
        }

        let isEdgePanning = false;

        // --- FIST：拖拽拉扯映射 ---
        if (currentState === 'FIST') {
            this.pinchFired = false;

            if (this.appMode !== 'WHOLE') {
                this.fistHoldStartMs = null;
                this.wholePinchMode = false;
            }

            if (!this.fistActionFired) {
                this.fistActionFired = true;

                if (this.appMode === 'FOCUSED') {
                    if (callbacks.onResetFocus) callbacks.onResetFocus();
                    this.appMode = 'SCATTERED';
                    this.isDragging = false;
                } else if (this.appMode === 'SCATTERED') {
                    if (callbacks.onImplode) callbacks.onImplode();
                    this.appMode = 'WHOLE';
                    // 返回 WHOLE 后立刻允许拖拽
                    this.isDragging = true;
                    this.lastHandX = mirroredX;
                    this.lastHandY = mirroredY;
                    this.currentVelocityX = 0;
                    this.currentVelocityY = 0;
                } else if (this.appMode === 'WHOLE') {
                    this.isDragging = true;
                    this.lastHandX = mirroredX;
                    this.lastHandY = mirroredY;
                    this.currentVelocityX = 0;
                    this.currentVelocityY = 0;
                }
            } else {
                if (this.appMode === 'WHOLE' && this.isDragging) {
                    this.consumeWholeRotationInput(mirroredX, mirroredY, 1.5);
                }
            }
        }
        
        const controlState = currentState;

        // --- OPEN：展开模型 ---
        if (controlState === 'OPEN') {
            this.isDragging = false;
            this.pinchFired = false;
            this.fistActionFired = false; 
            this.fistHoldStartMs = null;
            this.wholePinchMode = false;
            this.resetWholeInputStabilizer();

            if (this.appMode === 'WHOLE') {
                if (callbacks.onExplode) callbacks.onExplode();
                this.appMode = 'SCATTERED';
            }
            if (this.appMode === 'SCATTERED') isEdgePanning = true;
        
        // --- PINCH：射击/聚焦 ---
        } else if (controlState === 'PINCH') {
            this.isDragging = false;
            this.fistActionFired = false;
            this.fistHoldStartMs = null;
            this.wholePinchMode = false;

            if (this.appMode === 'SCATTERED') {
                if (!this.pinchFired) {
                    this.pinchFired = true; 
                    const ndcX = (mirroredX * 2) - 1;
                    const ndcY = -(mirroredY * 2) + 1;
                    if (callbacks.onRaycast) callbacks.onRaycast(ndcX, ndcY);
                }
            } else if (this.appMode === 'WHOLE') {
                if (!this.pinchFired) {
                    this.pinchFired = true;
                    this.lastHandX = mirroredX;
                    this.lastHandY = mirroredY;
                    this.currentVelocityX = 0;
                    this.currentVelocityY = 0;
                    this.resetWholeInputStabilizer();
                }
                // WHOLE 模式下 PINCH 不再控制旋转
            } else if (this.appMode === 'FOCUSED') {
                if (!this.pinchFired) {
                    this.pinchFired = true;
                    this.lastHandX = mirroredX;
                    this.lastHandY = mirroredY;
                    this.localVelocityX = 0;
                    this.localVelocityY = 0;
                } else {
                    const deltaX = mirroredX - this.lastHandX;
                    const deltaY = mirroredY - this.lastHandY;
                    this.localVelocityY = deltaX * Math.PI * 1.5;
                    this.localVelocityX = deltaY * Math.PI * 1.5;
                    this.lastHandX = mirroredX;
                    this.lastHandY = mirroredY;
                }
            }
        
        // --- NONE：重置标志位 ---
        } else if (controlState === 'NONE') {
            this.isDragging = false;
            this.pinchFired = false;
            this.fistActionFired = false; 
            this.fistHoldStartMs = null;
            this.wholePinchMode = false;
            this.resetWholeInputStabilizer();
            if (this.appMode === 'SCATTERED') isEdgePanning = true;
        }

        let panDirection = null;
        if (isEdgePanning) {
            const dx = mirroredX - 0.5;
            const dy = mirroredY - 0.5;
            const distFromCenter = Math.sqrt(dx * dx + dy * dy);
            const deadzoneRadius = 0.35;

            if (distFromCenter > deadzoneRadius) {
                const dirX = dx / distFromCenter;
                const dirY = dy / distFromCenter;
                const overflow = distFromCenter - deadzoneRadius;
                const panSpeedMultiplier = 0.15;
                
                this.currentVelocityY = dirX * overflow * panSpeedMultiplier;
                this.currentVelocityX = dirY * overflow * panSpeedMultiplier;
                panDirection = { x: dirX, y: dirY, intensity: overflow };
            }
        }

        return {
            appMode: this.appMode,
            cursorScreen: { x: mirroredX, y: mirroredY },
            panDirection: panDirection,
            effectiveGesture: controlState
        };
    }

    resetWholeInputStabilizer() {
        this.wholeReentryCooldownFrames = 0;
        this.wholeEdgeLocked = false;
        this.wholeSafeReentryFrames = 0;
    }

    consumeWholeRotationInput(mirroredX, mirroredY, sensitivity) {
        const edge = this.wholeEdgeGuardRatio;
        const nearEdge =
            mirroredX < edge ||
            mirroredX > 1 - edge ||
            mirroredY < edge ||
            mirroredY > 1 - edge;

        if (nearEdge) {
            this.wholeEdgeLocked = true;
            this.wholeSafeReentryFrames = 0;
            this.wholeReentryCooldownFrames = 2;
            this.lastHandX = mirroredX;
            this.lastHandY = mirroredY;
            this.currentVelocityX = 0;
            this.currentVelocityY = 0;
            return;
        }

        if (this.wholeEdgeLocked) {
            this.wholeSafeReentryFrames += 1;
            this.lastHandX = mirroredX;
            this.lastHandY = mirroredY;
            if (this.wholeSafeReentryFrames < this.wholeReentryFramesRequired) {
                return;
            }
            this.wholeEdgeLocked = false;
            this.wholeSafeReentryFrames = 0;
            return;
        }

        if (this.wholeReentryCooldownFrames > 0) {
            this.wholeReentryCooldownFrames -= 1;
            this.lastHandX = mirroredX;
            this.lastHandY = mirroredY;
            return;
        }

        // 引入屏幕宽高比消除横向拖拽畸变
        const aspect = window.innerWidth / window.innerHeight;
        const deltaX = (mirroredX - this.lastHandX) * aspect;
        const deltaY = mirroredY - this.lastHandY;

        if (Math.abs(deltaX) > this.wholeDeltaClamp || Math.abs(deltaY) > this.wholeDeltaClamp) {
            this.lastHandX = mirroredX;
            this.lastHandY = mirroredY;
            this.wholeReentryCooldownFrames = 1;
            return;
        }

        this.currentVelocityY = deltaX * Math.PI * sensitivity;
        this.currentVelocityX = deltaY * Math.PI * sensitivity;
        this.lastHandX = mirroredX;
        this.lastHandY = mirroredY;
    }

    applyMomentum() {
        if (!this.isDragging) {
            this.currentVelocityY = MathPhysicsUtil.applyDamping(this.currentVelocityY);
            this.currentVelocityX = MathPhysicsUtil.applyDamping(this.currentVelocityX);
        }
        
        if (Math.abs(this.currentVelocityX) > 0.0001 || Math.abs(this.currentVelocityY) > 0.0001) {
            const qY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.currentVelocityY);
            const qX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.currentVelocityX);
            const deltaQ = new THREE.Quaternion().multiplyQuaternions(qY, qX);
            this.globalTargetQuat.premultiply(deltaQ);
            
            // 叠加拖拽动量后必须 normalize，防止模型长期旋转后变扁
            this.globalTargetQuat.normalize(); 
        }

        if (this.appMode === 'FOCUSED' && !this.pinchFired) {
            this.localVelocityY = MathPhysicsUtil.applyDamping(this.localVelocityY);
            this.localVelocityX = MathPhysicsUtil.applyDamping(this.localVelocityX);
        }

        if (Math.abs(this.localVelocityX) > 0.0001 || Math.abs(this.localVelocityY) > 0.0001) {
            const lqY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.localVelocityY);
            const lqX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.localVelocityX);
            const lDeltaQ = new THREE.Quaternion().multiplyQuaternions(lqY, lqX);
            this.localTargetQuat.premultiply(lDeltaQ);
            
            this.localTargetQuat.normalize();
        }
    }
    
    setAppMode(mode) {
        this.appMode = mode;
        if (mode === 'FOCUSED') {
            this.localTargetQuat.identity();
            this.localVelocityX = 0;
            this.localVelocityY = 0;
        }
    }
}