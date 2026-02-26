import * as THREE from 'three';

export class MathPhysicsUtil {
    /**
     * 计算一组 3D 对象的全局几何中心和包围盒尺寸
     * 原理：遍历所有可见 Mesh，通过 THREE.Box3 逐步扩张，求出最终的 AABB (Axis-Aligned Bounding Box)
     * @param {THREE.Object3D[]} objects - 需要计算的对象数组 (通常是 anatomyGroup.children)
     * @returns {Object} 包含 center(几何中心), size(尺寸), maxDim(最大跨度)
     */
    static calculateGroupAABB(objects) {
        const box = new THREE.Box3();
        // 遍历所有子节点，将可见的 Mesh 加入包围盒计算
        objects.forEach(obj => {
            obj.traverse((child) => {
                if (child.isMesh && child.visible) {
                    box.expandByObject(child);
                }
            });
        });

        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        
        // 如果场景为空，防崩溃处理
        if (box.isEmpty()) {
            return { center, size, maxDim: 1 };
        }

        box.getCenter(center);
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);

        return { center, size, maxDim };
    }

    /**
     * 动态计算相机的视锥体安全爆炸半径 (Frustum Safe Radius)
     * 原理：利用相机的 FOV (视野角) 和目标物体所在平面的 Z 轴深度，
     * 通过三角函数算出该平面在屏幕上的真实物理高度和宽度。
     * @param {THREE.PerspectiveCamera} camera - 当前相机
     * @param {number} modelZ - 模型所在的 Z 轴世界坐标 (通常是 0)
     * @param {number} padding - 安全边距系数 (0.0 ~ 1.0)，防止贴边
     * @returns {number} 安全的最大爆炸半径
     */
    static calculateSafeExplosionRadius(camera, modelZ, padding = 0.8) {
        // 计算相机到物体所在平面的绝对物理距离
        const distance = Math.abs(camera.position.z - modelZ);
        
        // 将相机的垂直 FOV 从角度转换为弧度
        const vFovRadian = (camera.fov * Math.PI) / 180; 
        
        // 三角函数求垂直可见高度：Height = 2 * distance * tan(FOV / 2)
        const visibleHeight = 2 * distance * Math.tan(vFovRadian / 2);
        
        // 根据相机的宽高比 (aspect) 求出水平可见宽度
        const visibleWidth = visibleHeight * camera.aspect;

        // 取宽高中的较小值作为直径基准，乘以 padding 留出安全边缘
        const safeDiameter = Math.min(visibleHeight, visibleWidth) * padding;
        
        // 返回半径
        return safeDiameter / 2;
    }

    /**
     * 计算带惯性阻尼的角速度 (Angular Velocity Damping)
     * 用于模拟松手后的物理滑动摩擦力
     * @param {number} currentVelocity - 当前角速度
     * @param {number} friction - 摩擦系数 (建议 0.9 ~ 0.95，越接近 1 滑得越远)
     * @param {number} stopThreshold - 停止阈值，防止无限逼近带来的浮点数运算消耗
     * @returns {number} 衰减后的角速度
     */
    static applyDamping(currentVelocity, friction = 0.92, stopThreshold = 0.001) {
        const nextVelocity = currentVelocity * friction;
        // 如果速度小到肉眼不可见，直接归零，节省算力
        if (Math.abs(nextVelocity) < stopThreshold) {
            return 0;
        }
        return nextVelocity;
    }

    /**
     * 线性插值 (Lerp) - 用于平滑过渡
     * @param {number} start - 起始值
     * @param {number} end - 目标值
     * @param {number} factor - 插值系数 (0.0 ~ 1.0)
     * @returns {number} 
     */
    static lerp(start, end, factor) {
        return start + (end - start) * factor;
    }
}