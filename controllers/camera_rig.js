import * as THREE from 'three';
import { MathPhysicsUtil } from '../utils/math_physics.js';

export class CameraRig {
    /**
     * @param {THREE.PerspectiveCamera} camera - 绑定的 Three.js 相机实例
     */
    constructor(camera) {
        this.camera = camera;
        
        // 默认全局视角参数 (可根据实际场景调整)
        this.defaultPosition = new THREE.Vector3(0, 0, 15);
        this.defaultLookAt = new THREE.Vector3(0, 0, 0);

        // 目标状态 (Target State) - 用于计算平滑插值
        this.targetPosition = this.defaultPosition.clone();
        this.targetLookAt = this.defaultLookAt.clone();
        
        // 当前实际的观察点 - 因为 Three.js 的 camera.lookAt 是一个瞬间动作，
        // 为了实现视角的平滑转移，我们需要自己维护一个当前观察点，让它慢慢逼近目标观察点。
        this.currentLookAt = this.defaultLookAt.clone();

        // 线性插值 (Lerp) 的平滑系数，值越小相机移动越滞后、越平滑 (通常在 0.05 ~ 0.1 之间)
        this.lerpSpeed = 0.08;
    }

    /**
     * 计算并返回安全的模型散开系数 (Explode Factor)
     * 原理：获取相机的视锥体绝对物理边界，并对比当前模型组的总体尺寸，得出一个不会让模型飞出屏幕的最大系数。
     * @param {THREE.Group} anatomyGroup - 包含所有器官/零件的父级 Group
     * @returns {number} 安全的散开系数
     */
    getSafeExplodeFactor(anatomyGroup) {
        // 1. 从底层数学库获取当前 Z=0 平面上的安全半径 (自带 0.85 边缘 padding)
        const safeRadius = MathPhysicsUtil.calculateSafeExplosionRadius(this.camera, 0, 0.85);
        
        // 2. 获取当前模型组合的总尺寸
        const { maxDim } = MathPhysicsUtil.calculateGroupAABB(anatomyGroup.children);
        
        // 如果模型本身还未加载或异常，返回默认值
        if (maxDim <= 0.01) return 1.0;

        // 3. 计算比例因子。设定一个基础的爆炸间距倍率。
        const baseFactor = safeRadius / (maxDim * 0.4); 
        
        // 返回一个被截断的安全值，防止极端情况下 factor 过大导致撕裂感
        return Math.min(baseFactor, 4.0);
    }

    /**
     * 触发镜头特写，平滑推进并对齐到目标网格的几何中心
     * 原理：计算目标 Mesh 的世界坐标包围盒 (AABB)，提取质心，将相机焦点转移到该质心，
     * 从而使得后续的全局矩阵旋转看起来像是该零件在“自转”，而不是绕着世界原点“公转”。
     * @param {THREE.Mesh} mesh - 被 Raycaster 击中的目标零件
     */
    focusOnMesh(mesh) {
        // 利用 Three.js 内置的 Box3 计算单体零件的世界坐标包围盒
        const box = new THREE.Box3().setFromObject(mesh);
        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        
        box.getCenter(center);
        box.getSize(size);

        // 1. 将相机的观察目标 (LookAt) 转移到零件的真实几何中心
        this.targetLookAt.copy(center);

        // 2. 计算推近后的 Z 轴焦距。根据零件自身的最大跨度，确保它充满屏幕但不穿模。
        const maxDim = Math.max(size.x, size.y, size.z);
        // 简单的焦距推算：将相机放到该零件正前方的特定距离处
        const targetZ = center.z + maxDim * 2.5; 
        
        this.targetPosition.set(center.x, center.y, targetZ);
    }

    /**
     * 触发镜头归位，恢复到全局观察视角
     */
    resetToWhole() {
        this.targetPosition.copy(this.defaultPosition);
        this.targetLookAt.copy(this.defaultLookAt);
    }

    /**
     * 核心渲染循环：在 requestAnimationFrame 中逐帧调用
     * 原理：利用一阶低通滤波 (Lerp) 让相机的实际位置和视点无限逼近目标值。
     */
    update() {
        // 1. 位置插值：相机本体的 XYZ 坐标平滑移动
        this.camera.position.lerp(this.targetPosition, this.lerpSpeed);
        
        // 2. 焦点插值：相机观察的中心点平滑移动
        this.currentLookAt.lerp(this.targetLookAt, this.lerpSpeed);
        
        // 3. 应用焦点：每一帧强制要求相机看向当前插值后的观察点
        this.camera.lookAt(this.currentLookAt);
    }
}