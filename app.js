import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { LLMService } from './services/llm_service.js';
import { AnatomyMapper } from './utils/anatomy_mapper.js';
import { STTService } from './services/stt_service.js';

// --- 0. 系统配置与依赖注入 ---
const MOCK_MODE = true; 

let llmService = null;
let anatomyMapper = null; 
let sttService = null;             
let isGestureRecording = false;    

// --- 1. 状态与配置缓存 ---
let currentAppMode = 'WHOLE'; 

const State_Channel = {
    isPinching: false,
    activePart: null,        
    activeContext: null,     
    explodeFactor: 0,
    targetRotationY: 0,
    targetRotationX: 0 
};
let anatomyConfig = {};

let lastGestureState = 'NONE';
let lastHandX = 0.5; 
let lastHandY = 0.5;

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

// 降低基础光源强度，避免色彩溢出
scene.add(new THREE.AmbientLight(0xffffff, 0.6)); 
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2); 
dirLight.position.set(5, 5, 5);
scene.add(dirLight);

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6); 
scene.add(hemiLight);

// --- 3. 核心资产加载与矩阵嵌套 ---
const pivotGroup = new THREE.Group();
scene.add(pivotGroup);

let anatomyGroup = new THREE.Group();
pivotGroup.add(anatomyGroup); 

function getDeterministicColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360) / 360;
    
    // 降低基底亮度和饱和度，让颜色显得更深沉、高级
    const baseColor = new THREE.Color().setHSL(hue, 0.5, 0.35); 
    // 自发光压到极低，仅保留微弱的色彩倾向
    const emissiveColor = baseColor.clone().multiplyScalar(0.05);
    
    return { baseColor, emissiveColor };
}

function createMedicalMaterial(baseColor, emissiveColor) {
    const mat = new THREE.MeshStandardMaterial({
        color: baseColor,
        metalness: 0.1,
        roughness: 0.7,
        emissive: emissiveColor, 
        emissiveIntensity: 0.2, 
        side: THREE.DoubleSide
    });

    mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            `
            #include <emissivemap_fragment>
            float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 3.0);
            vec3 rimColor = vec3(1.0, 0.84, 0.0); 
            // 降低菲涅尔强度的乘数，防止边缘爆白
            diffuseColor.rgb += rimColor * fresnel * 0.5; 
            `
        );
    };
    return mat;
}

const toastMsg = document.getElementById('toast-msg');
const partNameUI = document.getElementById('part-name');
const partDescUI = document.getElementById('part-desc');
const lockStateUI = document.getElementById('lock-state');
const gestureStateUI = document.getElementById('gesture-state');
const crosshairUI = document.getElementById('crosshair');
const uiLayer = document.getElementById('ui-layer');
const sidebar = document.getElementById('sidebar');

const chatHistoryUI = document.getElementById('chat-history');
const chatInputUI = document.getElementById('chat-input');
const sendBtnUI = document.getElementById('send-btn');

const micBtnUI = document.getElementById('mic-btn');
const cancelZoneUI = document.getElementById('cancel-zone');
const micHintUI = document.querySelector('.mic-hint');

Promise.all([
    fetch('Anatomy_Config.json').then(r => r.json()),
    fetch('api.key').then(r => r.text())
])
.then(([cfg, keyText]) => { 
    anatomyConfig = cfg; 
    anatomyMapper = new AnatomyMapper(anatomyConfig); 
    
    const apiKey = keyText.trim();
    if (!apiKey) {
        showError("未检测到有效密钥，请检查 api.key 内容！");
        return;
    }
    llmService = new LLMService(apiKey);
    sttService = new STTService(); 
    
    loadModel(); 
})
.catch(err => {
    console.error(err);
    showError("系统初始化失败，请确保 Anatomy_Config.json 和 api.key 存在于根目录。");
});

function loadModel() {
    const loader = new GLTFLoader();
    partNameUI.innerText = "模型加载中...";

    loader.load('models/heart.glb', (gltf) => {
        const model = gltf.scene;
        
        const globalBox = new THREE.Box3().setFromObject(model);
        const globalCenter = globalBox.getCenter(new THREE.Vector3());
        const size = globalBox.getSize(new THREE.Vector3());
        
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0) {
            const scale = 5 / maxDim;
            model.scale.set(scale, scale, scale);
        }
        
        model.position.sub(globalCenter.clone().multiplyScalar(model.scale.x));
        anatomyGroup.add(model);
        partNameUI.innerText = "加载完成，等待交互...";

        anatomyGroup.updateMatrixWorld(true);

        model.traverse((child) => {
            if (child.isMesh) {
                if (child.name.toLowerCase().includes('skin')) {
                    child.visible = false;
                    return; 
                }

                const { baseColor, emissiveColor } = getDeterministicColor(child.name);
                child.material = createMedicalMaterial(baseColor, emissiveColor);

                const localBox = new THREE.Box3().setFromObject(child);
                const localCenter = localBox.getCenter(new THREE.Vector3());
                
                const escapeDir = localCenter.clone().normalize();
                if (escapeDir.lengthSq() === 0) escapeDir.set(0, 1, 0); 

                child.userData.originalPosition = child.position.clone();
                child.userData.escapeDirection = escapeDir;

                anatomyMapper.mapPart(child); 
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
    if(!anatomyGroup.children.length) return;
    
    const explosionRadius = 12.0; 
    const modelScale = anatomyGroup.children[0].scale.x;
    const actualRadius = explosionRadius / (modelScale > 0 ? modelScale : 1);

    anatomyGroup.children[0].traverse((child) => {
        if (child.isMesh && child.visible && child.userData.originalPosition && child.userData.escapeDirection) {
            const orig = child.userData.originalPosition;
            const dir = child.userData.escapeDirection;
            
            child.position.set(
                orig.x + dir.x * actualRadius * factor,
                orig.y + dir.y * actualRadius * factor,
                orig.z + dir.z * actualRadius * factor
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
    
    // 关键修复：Three.js 射线默认会穿透不可见物体，必须手动将其从检测结果中过滤掉
    const intersects = raycaster.intersectObjects(anatomyGroup.children, true)
                                .filter(hit => hit.object.visible);
    
    if (intersects.length > 0) {
        handleHit(intersects[0].object);
    } else {
        handleSilentMiss();
    }
}

function handleHit(mesh) {
    if (State_Channel.activePart === mesh.name) return; 
    
    const partContext = mesh.userData.medicalContext;
    
    State_Channel.activePart = mesh.name;
    State_Channel.activeContext = partContext;

    uiLayer.classList.add('hit-active');

    anatomyGroup.traverse(child => {
        if(child.isMesh && child.visible) {
            gsap.to(child.material, { 
                emissiveIntensity: child.name === mesh.name ? 1.5 : 0.5, 
                duration: 0.3 
            });
        }
    });
    
    sidebar.classList.add('active');
    sidebar.classList.remove('error-state');
    
    partNameUI.innerText = partContext.label;
    partDescUI.innerText = `【空间特征】${partContext.physicalDesc}\n\n已连接远端知识库。请在下方输入问题以获取深层病理学或解剖学解释。`;
    
    chatHistoryUI.innerHTML = '';
    chatInputUI.disabled = false;
    sendBtnUI.disabled = false;
    micBtnUI.disabled = false;
}

function handleSilentMiss() {
    State_Channel.activePart = null;
    State_Channel.activeContext = null;
    uiLayer.classList.remove('hit-active');
    sidebar.classList.remove('active');

    chatInputUI.disabled = true;
    sendBtnUI.disabled = true;
    micBtnUI.disabled = true;

    anatomyGroup.traverse(child => {
        if(child.isMesh && child.visible) {
            gsap.to(child.material, { emissiveIntensity: 0.5, duration: 0.3 });
        }
    });
}

function transitionToFocused() {
    if (!State_Channel.activePart) return;
    
    let targetPart = null;
    anatomyGroup.traverse(child => {
        if (child.name === State_Channel.activePart) targetPart = child;
    });
    
    if (targetPart) {
        const tempRot = pivotGroup.rotation.clone();
        pivotGroup.rotation.set(0, 0, 0);
        pivotGroup.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(targetPart);
        const geomCenter = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        pivotGroup.rotation.copy(tempRot);
        pivotGroup.updateMatrixWorld(true);

        gsap.to(anatomyGroup.position, {
            x: anatomyGroup.position.x - geomCenter.x, 
            y: anatomyGroup.position.y - geomCenter.y, 
            z: anatomyGroup.position.z - geomCenter.z,
            duration: 0.8, ease: "power2.inOut"
        });
        
        const maxDim = Math.max(size.x, size.y, size.z);
        const targetCamZ = Math.max(2.5, maxDim * 2.5); 

        gsap.to(camera.position, { z: targetCamZ, duration: 0.8, ease: "power2.inOut" });
        currentAppMode = 'FOCUSED';
        lockStateUI.innerText = "OFF (特写检视)";
    }
}

function resetFromFocused() {
    gsap.to(anatomyGroup.position, { x: 0, y: 0, z: 0, duration: 0.8, ease: "power2.inOut" });
    gsap.to(camera.position, { z: 8, duration: 0.8, ease: "power2.inOut" });
    currentAppMode = 'SCATTERED';
}

// --- 5. 对话系统绑定 ---

function appendMessage(role, content) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-msg ${role}`;
    msgDiv.innerHTML = role === 'assistant' ? marked.parse(content) : content;
    chatHistoryUI.appendChild(msgDiv);
    chatHistoryUI.scrollTop = chatHistoryUI.scrollHeight;
    return msgDiv;
}

function handleSendChat() {
    const text = chatInputUI.value.trim();
    if (!text || !State_Channel.activeContext || !llmService) return;
    
    chatInputUI.value = '';
    chatInputUI.disabled = true;
    sendBtnUI.disabled = true;

    appendMessage('user', text);

    const assistantBubble = appendMessage('assistant', '');
    assistantBubble.classList.add('cursor-blink');
    
    let rawMarkdown = "";

    llmService.askQuestion(
        State_Channel.activeContext.id,
        State_Channel.activeContext,
        text,
        (chunk) => {
            rawMarkdown += chunk;
            assistantBubble.innerHTML = marked.parse(rawMarkdown);
            chatHistoryUI.scrollTop = chatHistoryUI.scrollHeight;
        },
        () => {
            assistantBubble.classList.remove('cursor-blink');
            chatInputUI.disabled = false;
            sendBtnUI.disabled = false;
        },
        (err) => {
            assistantBubble.classList.remove('cursor-blink');
            assistantBubble.innerHTML += `<br/><span style="color:#ff4444;">[系统断开或网络异常: ${err.message}]</span>`;
            chatInputUI.disabled = false;
            sendBtnUI.disabled = false;
        }
    );
}

sendBtnUI.addEventListener('click', handleSendChat);
chatInputUI.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSendChat();
});

function checkHover(element, x, y) {
    const rect = element.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

// --- 6. 层次状态机 (HSM) 轮询 ---
function updateFromHandData() {
    if (!window.handData) return;
    const hand = window.handData;
    const indexFinger = hand.landmarks[8];
    
    gestureStateUI.innerText = `[${currentAppMode}] 输入: ${hand.state}`;
    
    crosshairUI.style.left = `${indexFinger.x * 100}%`;
    crosshairUI.style.top = `${indexFinger.y * 100}%`;

    const screenX = indexFinger.x * window.innerWidth;
    const screenY = indexFinger.y * window.innerHeight;
    
    const isHoveringCancel = cancelZoneUI.classList.contains('active') && checkHover(cancelZoneUI, screenX, screenY);
    const isHoveringMic = checkHover(micBtnUI, screenX, screenY);

    if (hand.state !== lastGestureState) {
        if (hand.state === 'OPEN' || hand.state === 'NONE') {
            
            if (isGestureRecording) {
                isGestureRecording = false;
                if (isHoveringCancel) {
                    sttService.onEndCallback = null; 
                    sttService.stop();               
                    chatInputUI.value = '';          
                    
                    micBtnUI.classList.remove('recording');
                    cancelZoneUI.classList.remove('active', 'hover-danger');
                    micHintUI.innerText = "已取消";
                    setTimeout(() => {
                        if(!isGestureRecording) micHintUI.innerText = "按住捏合说话";
                    }, 1500);
                } else {
                    sttService.stop();
                    micBtnUI.classList.remove('recording');
                    cancelZoneUI.classList.remove('active', 'hover-danger');
                    micHintUI.innerText = "按住捏合说话";
                }
                lastGestureState = hand.state;
                return; 
            }

            crosshairUI.style.background = 'rgba(255, 255, 255, 0.5)';
            crosshairUI.style.transform = 'translate(-50%, -50%) scale(1)';

            if (hand.state === 'OPEN') {
                if (currentAppMode === 'WHOLE') {
                    gsap.to(State_Channel, { 
                        explodeFactor: 1, duration: 0.8, ease: "power2.out",
                        onUpdate: () => animateExplode(State_Channel.explodeFactor) 
                    });
                    currentAppMode = 'SCATTERED';
                    lockStateUI.innerText = "OFF (悬停选择)";
                } 
                else if (currentAppMode === 'SCATTERED' && State_Channel.activePart) {
                    transitionToFocused();
                }
            } else {
                if(currentAppMode === 'WHOLE') lockStateUI.innerText = "OFF (整体检视)";
                if(currentAppMode === 'SCATTERED') lockStateUI.innerText = "OFF (悬停选择)";
                if(currentAppMode === 'FOCUSED') lockStateUI.innerText = "OFF (特写检视)";
            }
        }
        
        else if (hand.state === 'PINCH') {
            if (isHoveringMic && !micBtnUI.disabled && sttService && sttService.isSupported) {
                isGestureRecording = true;
                chatInputUI.value = ''; 
                micBtnUI.classList.add('recording');
                cancelZoneUI.classList.add('active'); 
                
                sttService.start(
                    (finalText, interimText) => {
                        chatInputUI.value = finalText + interimText; 
                    },
                    () => {
                        if (chatInputUI.value.trim() !== '') handleSendChat();
                    },
                    (err) => {
                        micHintUI.innerText = "麦克风异常";
                        setTimeout(() => {
                            if(!isGestureRecording) micHintUI.innerText = "按住捏合说话";
                        }, 2000);
                    }
                );
                
                lastGestureState = hand.state;
                return; 
            }

            lastHandX = indexFinger.x;
            lastHandY = indexFinger.y;
            
            crosshairUI.style.background = 'rgba(212, 175, 55, 0.9)'; 
            crosshairUI.style.transform = 'translate(-50%, -50%) scale(0.6)'; 
            lockStateUI.innerText = "ON (抓取旋转中)";

            if (currentAppMode === 'SCATTERED') {
                checkIntersectionNDC((indexFinger.x * 2) - 1, -(indexFinger.y * 2) + 1);
            }
        }
        
        else if (hand.state === 'FIST') {
            crosshairUI.style.background = 'rgba(255, 255, 255, 0.5)';
            crosshairUI.style.transform = 'translate(-50%, -50%) scale(1)';

            if (currentAppMode === 'FOCUSED') {
                resetFromFocused();
                lockStateUI.innerText = "OFF (悬停选择)";
            } 
            else if (currentAppMode === 'SCATTERED') {
                gsap.to(State_Channel, { 
                    explodeFactor: 0, duration: 0.6, ease: "power2.inOut",
                    onUpdate: () => animateExplode(State_Channel.explodeFactor) 
                });
                handleSilentMiss(); 
                currentAppMode = 'WHOLE';
                lockStateUI.innerText = "OFF (整体检视)";
            }
        }

        lastGestureState = hand.state;
    }

    if (isGestureRecording) {
        if (isHoveringCancel) {
            cancelZoneUI.classList.add('hover-danger');
            micHintUI.innerText = "松开取消";
        } else {
            cancelZoneUI.classList.remove('hover-danger');
            micHintUI.innerText = "录音中...";
        }
        return; 
    }

    if (hand.state === 'PINCH') {
        const deltaX = indexFinger.x - lastHandX;
        const deltaY = indexFinger.y - lastHandY;
        
        State_Channel.targetRotationY += deltaX * Math.PI * 2.5; 
        State_Channel.targetRotationX += deltaY * Math.PI * 1.5;
        
        lastHandX = indexFinger.x;
        lastHandY = indexFinger.y;
    }
}

// --- 7. 原生降级交互 ---
let isDragging = false;
let prevMousePos = { x: 0, y: 0 };
let startMousePos = { x: 0, y: 0 };

if (!MOCK_MODE) {
    gestureStateUI.innerText = "鼠标降级模式";
    crosshairUI.style.display = 'none'; 
    
    window.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || e.target.closest('#sidebar')) return; 
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
        lockStateUI.innerText = "OFF";
        
        if (e.target.closest('#sidebar')) return;

        if (Math.hypot(e.clientX - startMousePos.x, e.clientY - startMousePos.y) < 5) {
            checkIntersectionNDC((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1); 
        }
    });

    window.addEventListener('wheel', (e) => {
        if (e.target.closest('#sidebar')) return; 
        State_Channel.explodeFactor += e.deltaY * -0.001;
        State_Channel.explodeFactor = Math.max(0, Math.min(1, State_Channel.explodeFactor));
        animateExplode(State_Channel.explodeFactor);
    });
}

// --- 8. 渲染循环 ---
let currentRotationX = 0;
let currentRotationY = 0;

function animate() {
    requestAnimationFrame(animate);
    
    if (MOCK_MODE) updateFromHandData();
    
    currentRotationY += (State_Channel.targetRotationY - currentRotationY) * 0.15;
    currentRotationX += (State_Channel.targetRotationX - currentRotationX) * 0.15;
    
    if(pivotGroup) {
        pivotGroup.rotation.y = currentRotationY;
        pivotGroup.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, currentRotationX));
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