import * as THREE from 'three';

export class AnatomyMapper {
    /**
     * @param {Object} anatomyConfig - Anatomy_Config.json 中的配置数据
     */
    constructor(anatomyConfig) {
        this.config = anatomyConfig;
        // 提取出所有可用的虚拟解剖身份名称 (如 Heart_LV, Heart_RV)
        this.availableIdentities = Object.keys(anatomyConfig);
        this.identityIndex = 0;
        
        // 用于稳定映射：记录 tripo_part_x -> 具体的解剖身份
        // 保证在同一次运行时，同一个碎块永远被判定为同一个器官
        this.partToIdentityMap = new Map();
    }

    /**
     * 提取 Mesh 的空间特征并赋予医学语义
     * @param {THREE.Mesh} mesh - 三维网格对象
     * @returns {Object} 包含特征和语义的上下文对象
     */
    mapPart(mesh) {
        const originalName = mesh.name;
        let mappedIdentityId = originalName;

        // 1. 动态身份分配 (专为 Tripo 的无语义碎块设计)
        if (originalName.startsWith('tripo_part_') || originalName.startsWith('mesh_')) {
            if (this.partToIdentityMap.has(originalName)) {
                // 如果之前已经分配过，直接读取历史身份
                mappedIdentityId = this.partToIdentityMap.get(originalName);
            } else {
                // 否则，利用取模算法循环分配配置池中的虚拟身份
                if (this.availableIdentities.length > 0) {
                    mappedIdentityId = this.availableIdentities[this.identityIndex % this.availableIdentities.length];
                    this.identityIndex++;
                }
                this.partToIdentityMap.set(originalName, mappedIdentityId);
            }
        }

        // 获取基础配置，如果没有则生成一个通用兜底
        const baseConfig = this.config[mappedIdentityId] || {
            label: `未知解剖结构 (${originalName})`,
            query: "heart anatomy structure"
        };

        // 2. 几何特征提取 (利用 Box3 计算真实的物理空间表现)
        // 必须强制更新世界矩阵，避免受到父级 Group 的未同步旋转平移污染
        mesh.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(mesh);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        // 3. 生成空间特征描述词汇 (将图形学参数转化为 LLM 提示词)
        // 计算包围盒近似体积
        const volume = size.x * size.y * size.z;
        let sizeDesc = "中等体积";
        
        // 这里的阈值(8.0, 1.0)是为了适配你 app.js 中 model.scale 的最终缩放比
        if (volume > 8.0) sizeDesc = "大体积主干"; 
        else if (volume < 1.0) sizeDesc = "微小附属或连接";

        // 相对方位判定 (基于 Three.js 右手坐标系: X向右, Y向上, Z向前)
        let posDesc = [];
        if (center.x > 0.5) posDesc.push("偏右侧");
        else if (center.x < -0.5) posDesc.push("偏左侧");
        
        if (center.y > 0.5) posDesc.push("偏上方");
        else if (center.y < -0.5) posDesc.push("偏下方");

        if (center.z > 0.5) posDesc.push("偏前部 (腹侧)");
        else if (center.z < -0.5) posDesc.push("偏后部 (背侧)");

        const positionString = posDesc.length > 0 ? posDesc.join("、") : "核心居中";

        // 4. 组装最终的上下文对象，供 LLM 和 UI 使用
        const context = {
            id: originalName,                  // 原始模型 ID，用于保持 Three.js 对象级引用
            mappedId: mappedIdentityId,        // 映射后的语义 ID
            label: baseConfig.label,           // UI 显示的中英文名称
            query: baseConfig.query,           // 传给 LLM 的核心检索词
            physicalDesc: `该组织在视觉表现上呈现为${sizeDesc}结构，在当前 3D 空间坐标系中整体位于${positionString}。`,
            size: size,                        // 保留原始 Vector3 供相机推拉特写等渲染逻辑使用
            center: center                     // 保留原始质心 Vector3
        };

        // 将编译好的上下文数据直接挂载到 mesh 实例上
        // 这样在 raycaster 击中时，直接读取 intersects[0].object.userData.medicalContext 即可，无需重复计算
        mesh.userData.medicalContext = context;

        return context;
    }
}