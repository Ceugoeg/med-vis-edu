import * as THREE from 'three';

export class AnatomyMapper {
    /**
     * @param {Object} anatomyConfig - (已废弃强制依赖) 用于兼容可能的自定义配置
     */
    constructor(anatomyConfig) {
        this.config = anatomyConfig || {};
    }

    /**
     * 提取 Mesh 的空间特征并赋予医学语义
     * @param {THREE.Mesh} mesh - 三维网格对象
     * @returns {Object} 包含特征和语义的上下文对象
     */
    mapPart(mesh) {
        const originalName = mesh.name;
        let mappedIdentityId = originalName;
        let displayName = originalName;

        // 1. 语义提取：解析类似 "Model_17_left_hippocampus" 的标准命名
        // 匹配 "Model_数字_" 后面的所有字符
        const match = originalName.match(/Model_\d+_(.*)/);
        if (match && match[1]) {
            // 将下划线替换为空格，清理尾部可能存在的数字编号 (如 sulcus1)
            displayName = match[1].replace(/_/g, ' ').replace(/\d+$/, '').trim();
            // 将首字母大写，提升 UI 美观度
            displayName = displayName.charAt(0).toUpperCase() + displayName.slice(1);
        }

        // 尝试从字典获取自定义中文覆盖，如果没有则使用解析出的英文名
        const baseConfig = this.config[mappedIdentityId] || {
            label: displayName,
            // 动态生成严谨的英文医学 Prompt 给 DeepSeek
            query: `Please explain the anatomy, physical location, and physiological function of the ${displayName} in the human brain.`
        };

        // 2. 几何特征提取 (利用 Box3 计算真实的物理空间表现)
        mesh.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(mesh);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        // 3. 生成空间特征描述词汇 (将图形学参数转化为 LLM 提示词)
        const volume = size.x * size.y * size.z;
        let sizeDesc = "中等体积";
        
        if (volume > 8.0) sizeDesc = "大体积主干"; 
        else if (volume < 0.5) sizeDesc = "微小神经核团或沟回";

        // 相对方位判定
        let posDesc = [];
        if (center.x > 0.3) posDesc.push("右半球");
        else if (center.x < -0.3) posDesc.push("左半球");
        
        if (center.y > 0.5) posDesc.push("偏上方(背侧)");
        else if (center.y < -0.5) posDesc.push("偏下方(腹侧)");

        if (center.z > 0.5) posDesc.push("偏前部(额侧)");
        else if (center.z < -0.5) posDesc.push("偏后部(枕侧)");

        const positionString = posDesc.length > 0 ? posDesc.join("、") : "脑部核心居中";

        // 4. 组装最终的上下文对象
        const context = {
            id: originalName,
            mappedId: mappedIdentityId,
            label: baseConfig.label,
            query: baseConfig.query,
            physicalDesc: `该组织在视觉表现上呈现为${sizeDesc}结构，在当前 3D 空间坐标系中整体位于${positionString}。`,
            size: size,
            center: center
        };

        mesh.userData.medicalContext = context;

        return context;
    }
}