import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// --- 0. 系统运行模式开关 ---
const MOCK_MODE = true; 

// --- 1. 状态与配置缓存 ---
const State_Channel = {
    isPinching: false,
    activePart: null,
    explodeFactor: 0,
    targetRotationY: 0,
    targetRotationX: 0 
};
let anatomyConfig = {};
const LocalCache = {
    "Heart_LV": "【本地缓存】左心室是心脏最厚的腔室，负责将含氧血液泵入主动脉供全身使用。",
    "Heart_RV": "【本地缓存】右心室负责将脱氧血液泵入肺部进行气体交换。",
    "Heart_Aorta": "【本地缓存】主动脉是人体内最大的动脉，承受极高的血压。",
    "Heart_Valves": "【本地缓存】心脏瓣膜确保血液单向流动，防止反流。"
};

// 状态防抖与 Delta 锚点寄存器
let lastGestureState = 'NONE';
let lastHandX = 0.5; // 用于计算相对位移
let lastHandY = 0.5;
let debounceTimer = null;

// --- 2. Three.js 核心初始化 ---
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0f);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0, 8); 

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
container.appendChild(renderer.domElement);

const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.0, 0.4, 0.85);
const composer = new EffectComposer(renderer); 
composer.addPass(renderScene);
composer.addPass(bloomPass);

scene.add(new THREE.AmbientLight(0xffffff, 2.0));
const dirLight = new THREE.DirectionalLight(0xffffff, 3.0);
dirLight.position.set(5, 5, 5);
scene.add(dirLight);

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 2.0);
scene.add(hemiLight);

// --- 3. 核心资产加载与材质增强 ---
let heartGroup = new THREE.Group();
scene.add(heartGroup);
const originalPositions = new Map();

function createMedicalMaterial(child) {
    const oldMat = child.material;
    const geom = child.geometry;
    
    if (geom) geom.computeVertexNormals();

    const hasMap = oldMat && oldMat.map;
    const hasVColor = geom && geom.hasAttribute('color');

    const mat = new THREE.MeshStandardMaterial({
        color: hasMap ? 0xffffff : (hasVColor ? 0xffffff : 0x882222),
        map: hasMap ? oldMat.map : null,
        vertexColors: hasVColor,
        metalness: 0.1,
        roughness: 0.7,
        emissive: 0x331111, 
        emissiveIntensity: 0.5,
        side: THREE.DoubleSide
    });

    mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            `
            #include <emissivemap_fragment>
            float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 3.0);
            vec3 rimColor = vec3(1.0, 0.84, 0.0); 
            diffuseColor.rgb += rimColor * fresnel * 0.8;
            `
        );
    };
    return mat;
}

const toastMsg = document.getElementById('toast-msg');
const partNameUI = document.getElementById('part-name');
const lockStateUI = document.getElementById('lock-state');
const gestureStateUI = document.getElementById('gesture-state');
const crosshairUI = document.getElementById('crosshair');

fetch('Anatomy_Config.json')
    .then(r => r.json())
    .then(cfg => { 
        anatomyConfig = cfg; 
        loadModel(); 
    })
    .catch(err => showError("JSON 配置读取失败"));

function loadModel() {
    const loader = new GLTFLoader();
    partNameUI.innerText = "模型加载中...";

    loader.load('models/heart.glb', (gltf) => {
        const model = gltf.scene;
        
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0) {
            const scale = 5 / maxDim;
            model.scale.set(scale, scale, scale);
        }
        model.position.sub(center.multiplyScalar(model.scale.x));
        heartGroup.add(model);
        partNameUI.innerText = "加载完成，等待交互...";

        model.traverse((child) => {
            if (child.isMesh) {
                child.material = createMedicalMaterial(child);
                if(!anatomyConfig[child.name]) {
                    anatomyConfig[child.name] = {
                        label: `未知结构 (${child.name})`,
                        offset: [(Math.random()-0.5)*6, (Math.random()-0.5)*6, (Math.random()-0.5)*6],
                        query: "heart structure"
                    };
                }
                originalPositions.set(child.name, child.position.clone());
            }
        });
    }, undefined, () => showError("模型加载失败！"));
}

function showError(msg) {
    toastMsg.innerText = msg;
    toastMsg.style.background = 'rgba(255, 0, 0, 0.9)';
    toastMsg.style.opacity = '1';
}

// --- 4. 动画与逻辑控制 ---
function animateExplode(factor) {
    if(!heartGroup.children.length) return;
    heartGroup.children[0].traverse((child) => {
        const config = anatomyConfig[child.name];
        if (config && originalPositions.has(child.name)) {
            const orig = originalPositions.get(child.name);
            child.position.set(
                orig.x + config.offset[0] * factor,
                orig.y + config.offset[1] * factor,
                orig.z + config.offset[2] * factor
            );
        }
    });
}

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2(); 

function checkIntersectionNDC(ndcX, ndcY) {
    mouse.x = ndcX;
    mouse.y = ndcY;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(heartGroup.children, true);
    
    if (intersects.length > 0) {
        handleHit(intersects[0].object);
    } else {
        handleMiss();
    }
}

function handleHit(mesh) {
    const partConfig = anatomyConfig[mesh.name];
    if (State_Channel.activePart === mesh.name) return; 
    State_Channel.activePart = mesh.name;

    heartGroup.traverse(child => {
        if(child.isMesh) {
            gsap.to(child.material, { 
                emissiveIntensity: child.name === mesh.name ? 1.5 : 0.5, 
                duration: 0.3 
            });
        }
    });

    const sidebar = document.getElementById('sidebar');
    const title = document.getElementById('part-name');
    const desc = document.getElementById('part-desc');
    const spinner = document.getElementById('loading-spinner');
    
    sidebar.classList.add('active');
    title.innerText = partConfig.label;
    desc.innerText = LocalCache[mesh.name] || "请求远端知识库中...";
    spinner.style.display = 'block';

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        if(State_Channel.activePart === mesh.name) {
            desc.innerText += `\n\n【DeepMed API】针对 "${partConfig.query}" 的特征响应已记录。`;
            spinner.style.display = 'none';
        }
    }, 1500);
}

function handleMiss() {
    toastMsg.innerText = "未选中有效部位";
    toastMsg.style.opacity = '1';
    setTimeout(() => toastMsg.style.opacity = '0', 2000);
}

// --- 5. 基于数据驱动的状态机轮询 (修正交互范式) ---
function updateFromHandData() {
    if (!window.handData) return;
    const hand = window.handData;
    const indexFinger = hand.landmarks[8];
    
    gestureStateUI.innerText = `输入: ${hand.state}`;
    
    // UI：准星永远跟随食指（激光笔模式）
    crosshairUI.style.left = `${indexFinger.x * 100}%`;
    crosshairUI.style.top = `${indexFinger.y * 100}%`;

    // 状态边缘触发逻辑
    if (hand.state !== lastGestureState) {
        if (hand.state === 'OPEN') {
            gsap.to(State_Channel, { 
                explodeFactor: 1, duration: 0.8, ease: "power2.out",
                onUpdate: () => animateExplode(State_Channel.explodeFactor) 
            });
            lockStateUI.innerText = "OFF (悬停瞄准)";
            crosshairUI.style.background = 'rgba(255, 255, 255, 0.5)';
            crosshairUI.style.transform = 'translate(-50%, -50%) scale(1)';
        }
        else if (hand.state === 'FIST') {
            gsap.to(State_Channel, { 
                explodeFactor: 0, duration: 0.6, ease: "power2.inOut",
                onUpdate: () => animateExplode(State_Channel.explodeFactor) 
            });
            lockStateUI.innerText = "OFF (悬停瞄准)";
            crosshairUI.style.background = 'rgba(255, 255, 255, 0.5)';
            crosshairUI.style.transform = 'translate(-50%, -50%) scale(1)';
        }
        else if (hand.state === 'PINCH') {
            // 【修正1】射线检测仅在捏合瞬间触发
            checkIntersectionNDC((indexFinger.x * 2) - 1, -(indexFinger.y * 2) + 1);
            
            // 【修正2】刷新锚点，防止解除捏合后重新捏合产生跳变
            lastHandX = indexFinger.x;
            lastHandY = indexFinger.y;
            
            lockStateUI.innerText = "ON (抓取旋转中)";
            crosshairUI.style.background = 'rgba(212, 175, 55, 0.9)'; // 准星变金黄色反馈抓取
            crosshairUI.style.transform = 'translate(-50%, -50%) scale(0.6)'; // 准星缩小
        }
        else if (hand.state === 'NONE') {
            lockStateUI.innerText = "OFF (悬停瞄准)";
            crosshairUI.style.background = 'rgba(255, 255, 255, 0.5)';
            crosshairUI.style.transform = 'translate(-50%, -50%) scale(1)';
        }

        lastGestureState = hand.state;
    }

    // 【修正3】持续状态处理：仅在 PINCH 状态下利用 Delta 计算旋转
    if (hand.state === 'PINCH') {
        const deltaX = indexFinger.x - lastHandX;
        const deltaY = indexFinger.y - lastHandY;
        
        // 相对位移累加（根据手感可调整系数）
        State_Channel.targetRotationY += deltaX * Math.PI * 2.5; 
        State_Channel.targetRotationX += deltaY * Math.PI * 1.5;
        
        // 更新锚点
        lastHandX = indexFinger.x;
        lastHandY = indexFinger.y;
    }
}

// --- 6. 原生降级交互 ---
let isDragging = false;
let prevMousePos = { x: 0, y: 0 };
let startMousePos = { x: 0, y: 0 };

if (!MOCK_MODE) {
    gestureStateUI.innerText = "鼠标降级模式";
    crosshairUI.style.display = 'none'; // 原生鼠标不需要准星
    
    window.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return; 
        isDragging = true;
        lockStateUI.innerText = "ON (抓取旋转中)";
        startMousePos = { x: e.clientX, y: e.clientY };
        prevMousePos = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mousemove', (e) => {
        if (isDragging) {
            State_Channel.targetRotationY += (e.clientX - prevMousePos.x) * 0.01;
            State_Channel.targetRotationX += (e.clientY - prevMousePos.y) * 0.01;
            prevMousePos = { x: e.clientX, y: e.clientY };
        }
    });

    window.addEventListener('mouseup', (e) => {
        if (e.button !== 0) return;
        isDragging = false;
        lockStateUI.innerText = "OFF (悬停瞄准)";
        if (Math.hypot(e.clientX - startMousePos.x, e.clientY - startMousePos.y) < 5) {
            checkIntersectionNDC((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1); 
        }
    });

    window.addEventListener('wheel', (e) => {
        State_Channel.explodeFactor += e.deltaY * -0.001;
        State_Channel.explodeFactor = Math.max(0, Math.min(1, State_Channel.explodeFactor));
        animateExplode(State_Channel.explodeFactor);
    });
}

// --- 7. 渲染循环 ---
let currentRotationX = 0;
let currentRotationY = 0;

function animate() {
    requestAnimationFrame(animate);
    
    if (MOCK_MODE) updateFromHandData();
    
    // 平滑追赶计算好的 targetRotation
    currentRotationY += (State_Channel.targetRotationY - currentRotationY) * 0.15;
    currentRotationX += (State_Channel.targetRotationX - currentRotationX) * 0.15;
    
    if(heartGroup) {
        heartGroup.rotation.y = currentRotationY;
        heartGroup.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, currentRotationX));
    }

    composer.render(); 
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});

animate();