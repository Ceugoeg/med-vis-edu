// app.js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { LLMService } from './services/llm_service.js';
import { AnatomyMapper } from './utils/anatomy_mapper.js';
import { STTService } from './services/stt_service.js';
import { InteractionHSM } from './controllers/interaction_hsm.js';

// --- 0. 系统配置与依赖注入 ---
const MOCK_MODE = true; 

let llmService = null;
let anatomyMapper = null; 
let sttService = null;             
let isGestureRecording = false;    

let currentModelName = 'brain';
let currentLang = 'zh';

let anatomyConfig = {};
const State_Channel = {
    activePart: null,        
    activeContext: null,     
    explodeFactor: 0
};

let currentSnappedNDC = { x: 0, y: 0 };
let prevHandState = 'NONE'; // 记录上一帧状态，用于构建边缘触发锁

// --- 1. Three.js 核心初始化 ---
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
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.0, 0.4, 0.9);
const composer = new EffectComposer(renderer); 
composer.addPass(renderScene);
composer.addPass(bloomPass);

scene.add(new THREE.AmbientLight(0xffffff, 0.6)); 
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2); 
dirLight.position.set(5, 5, 5);
scene.add(dirLight);
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6); 
scene.add(hemiLight);

// --- 2. 核心资产架构与状态机 ---
const pivotGroup = new THREE.Group();
scene.add(pivotGroup);

const focusPivotGroup = new THREE.Group();
pivotGroup.add(focusPivotGroup);

let anatomyGroup = new THREE.Group();
focusPivotGroup.add(anatomyGroup); 

const hsm = new InteractionHSM();

// --- 3. UI 元素绑定 ---
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

const topNavModel = document.getElementById('model-select');
const topNavLang = document.getElementById('lang-select');
const bottomConsole = document.getElementById('bottom-console');

fetch('api.key').then(r => r.text()).then(keyText => {
    const apiKey = keyText.trim();
    if (!apiKey) { showError("未检测到有效密钥！"); return; }
    llmService = new LLMService(apiKey);
    sttService = new STTService(); 
    loadAssets(currentModelName, currentLang);
}).catch(err => showError("核心密钥获取失败。"));

// --- 4. 材质与模型加载 ---
function getDeterministicColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) { hash = name.charCodeAt(i) + ((hash << 5) - hash); }
    const hue = Math.abs(hash % 360) / 360;
    const baseColor = new THREE.Color().setHSL(hue, 0.5, 0.35); 
    const emissiveColor = baseColor.clone().multiplyScalar(0.05);
    return { baseColor, emissiveColor };
}

function createMedicalMaterial(baseColor, emissiveColor) {
    const mat = new THREE.MeshStandardMaterial({
        color: baseColor, metalness: 0.1, roughness: 0.7,
        emissive: emissiveColor, emissiveIntensity: 0.2, side: THREE.DoubleSide
    });
    mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            `
            #include <emissivemap_fragment>
            float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 3.0);
            vec3 rimColor = vec3(1.0, 0.84, 0.0); 
            diffuseColor.rgb += rimColor * fresnel * 0.5; 
            `
        );
    };
    return mat;
}

function loadAssets(modelName, langName) {
    partNameUI.innerText = "正在加载字典与模型..."; chatInputUI.disabled = true;
    while(anatomyGroup.children.length > 0){ anatomyGroup.remove(anatomyGroup.children[0]); }
    handleSilentMiss();

    fetch(`assets/locales/${modelName}_${langName}.json`)
        .then(res => res.ok ? res.json() : {}).catch(() => ({})) 
        .then(cfg => {
            anatomyConfig = cfg; anatomyMapper = new AnatomyMapper(anatomyConfig);
            const loader = new GLTFLoader();
            loader.load(`assets/models/${modelName}.glb`, (gltf) => {
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
                anatomyGroup.add(model); anatomyGroup.updateMatrixWorld(true);

                model.traverse((child) => {
                    if (child.isMesh) {
                        if (child.name.toLowerCase().includes('skin')) { child.visible = false; return; }
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
                partNameUI.innerText = "加载完成，等待探索...";
                chatInputUI.disabled = false; micBtnUI.disabled = false; sendBtnUI.disabled = false;
                hsm.setAppMode('WHOLE');
            }, undefined, () => showError(`加载模型失败！`));
        });
}

topNavModel.addEventListener('change', (e) => loadAssets(e.target.value, currentLang));
topNavLang.addEventListener('change', (e) => loadAssets(currentModelName, e.target.value));
function showError(msg) {
    toastMsg.innerText = msg; toastMsg.style.background = 'rgba(255, 0, 0, 0.9)';
    toastMsg.style.opacity = '1'; setTimeout(() => { toastMsg.style.opacity = '0'; }, 3000);
}

// --- 5. 动画与交互路由 ---
function animateExplode(factor) {
    if(!anatomyGroup.children.length) return;
    const explosionRadius = 8.0; 
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
function checkIntersectionNDC(ndcX, ndcY) {
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const intersects = raycaster.intersectObjects(anatomyGroup.children, true).filter(hit => hit.object.visible);
    if (intersects.length > 0) handleHit(intersects[0].object);
    else handleSilentMiss();
}

function handleHit(mesh) {
    if (State_Channel.activePart === mesh.name) return; 
    State_Channel.activePart = mesh.name; State_Channel.activeContext = mesh.userData.medicalContext;
    uiLayer.classList.add('hit-active');

    anatomyGroup.traverse(child => {
        if(child.isMesh && child.visible) gsap.to(child.material, { emissiveIntensity: child.name === mesh.name ? 1.5 : 0.2, duration: 0.3 });
    });
    
    sidebar.classList.add('active');
    partNameUI.innerText = State_Channel.activeContext.label;
    partDescUI.innerText = anatomyConfig[mesh.name]?.description || "暂无描述。";
}

function handleSilentMiss() {
    State_Channel.activePart = null; State_Channel.activeContext = null;
    uiLayer.classList.remove('hit-active'); sidebar.classList.remove('active');
    anatomyGroup.traverse(child => {
        if(child.isMesh && child.visible) gsap.to(child.material, { emissiveIntensity: 0.2, duration: 0.3 });
    });
}

function transitionToFocused() {
    if (!State_Channel.activePart) return;
    uiLayer.classList.remove('scatter-active');

    let targetPart = null;
    anatomyGroup.traverse(child => { if (child.name === State_Channel.activePart) targetPart = child; });
    
    if (targetPart) {
        const tempQuat1 = pivotGroup.quaternion.clone();
        const tempQuat2 = focusPivotGroup.quaternion.clone();
        pivotGroup.quaternion.identity(); focusPivotGroup.quaternion.identity();
        pivotGroup.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(targetPart);
        const geomCenter = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        pivotGroup.quaternion.copy(tempQuat1); focusPivotGroup.quaternion.copy(tempQuat2);
        pivotGroup.updateMatrixWorld(true);

        gsap.to(anatomyGroup.position, {
            x: anatomyGroup.position.x - geomCenter.x, y: anatomyGroup.position.y - geomCenter.y, z: anatomyGroup.position.z - geomCenter.z,
            duration: 0.8, ease: "power2.inOut"
        });
        
        const targetCamZ = Math.max(2.5, Math.max(size.x, size.y, size.z) * 2.5); 
        gsap.to(camera.position, { z: targetCamZ, duration: 0.8, ease: "power2.inOut" });
        lockStateUI.innerText = "OFF (特写检视)";
    }
}

function resetFromFocused() {
    gsap.to(anatomyGroup.position, { x: 0, y: 0, z: 0, duration: 0.8, ease: "power2.inOut" });
    gsap.to(camera.position, { z: 8, duration: 0.8, ease: "power2.inOut" });
    
    const targetQ = new THREE.Quaternion(0, 0, 0, 1);
    const startQ = focusPivotGroup.quaternion.clone();
    
    gsap.to({t: 0}, {
        t: 1, duration: 0.8, ease: "power2.inOut",
        onUpdate: function() {
            focusPivotGroup.quaternion.slerpQuaternions(startQ, targetQ, this.targets()[0].t);
        },
        onComplete: () => { hsm.localTargetQuat.identity(); }
    });
}

const hsmCallbacks = {
    onExplode: () => {
        gsap.to(State_Channel, { explodeFactor: 1, duration: 0.8, ease: "power2.out", onUpdate: () => animateExplode(State_Channel.explodeFactor) });
        lockStateUI.innerText = "OFF (边缘拨动 / 悬停选择)";
        uiLayer.classList.add('scatter-active');
    },
    onImplode: () => {
        gsap.to(State_Channel, { explodeFactor: 0, duration: 0.6, ease: "power2.inOut", onUpdate: () => animateExplode(State_Channel.explodeFactor) });
        handleSilentMiss(); lockStateUI.innerText = "OFF (整体检视)";
        uiLayer.classList.remove('scatter-active');
    },
    onRaycast: () => {
        checkIntersectionNDC(currentSnappedNDC.x, currentSnappedNDC.y);
        if (State_Channel.activePart) {
            transitionToFocused(); hsm.setAppMode('FOCUSED');
        }
    },
    onResetFocus: () => {
        resetFromFocused(); lockStateUI.innerText = "OFF (边缘拨动 / 悬停选择)";
        uiLayer.classList.add('scatter-active');
    }
};

// --- 6. 原生降级交互 ---
let isMockDragging = false; let prevMousePos = { x: 0, y: 0 }; let startMousePos = { x: 0, y: 0 };
if (!MOCK_MODE) {
    gestureStateUI.innerText = "鼠标降级模式"; crosshairUI.style.display = 'none'; 
    window.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || e.target.closest('#sidebar') || e.target.closest('#bottom-console') || e.target.closest('#top-nav')) return; 
        isMockDragging = true; startMousePos = { x: e.clientX, y: e.clientY }; prevMousePos = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mousemove', (e) => {
        if (isMockDragging) {
            const dx = (e.clientX - prevMousePos.x) * 0.01;
            const dy = (e.clientY - prevMousePos.y) * 0.01;
            if (hsm.appMode === 'FOCUSED') {
                hsm.localVelocityY = dx; hsm.localVelocityX = dy;
            } else {
                hsm.currentVelocityY = dx; hsm.currentVelocityX = dy;
            }
            prevMousePos = { x: e.clientX, y: e.clientY };
        }
    });
    window.addEventListener('mouseup', (e) => {
        if (e.button !== 0) return; isMockDragging = false;
        if (Math.hypot(e.clientX - startMousePos.x, e.clientY - startMousePos.y) < 5) {
            currentSnappedNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
            currentSnappedNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
            hsmCallbacks.onRaycast(); 
        }
    });
    window.addEventListener('wheel', (e) => { if (hsm.appMode === 'WHOLE') hsmCallbacks.onExplode(); });
}

// --- 7. 意图驱动与 LLM ---
function appendMessage(role, content) {
    const msgDiv = document.createElement('div'); msgDiv.className = `chat-msg ${role}`;
    msgDiv.innerHTML = role === 'assistant' ? marked.parse(content) : content;
    chatHistoryUI.appendChild(msgDiv); chatHistoryUI.scrollTop = chatHistoryUI.scrollHeight; return msgDiv;
}
async function parseIntent(text) {
    if (!llmService || !llmService.apiKey) return { action: 'qa' };
    const partsList = Object.keys(anatomyConfig).map(k => `${k}:${anatomyConfig[k].label}`).join('; ');
    const prompt = `你是一个 3D 医学系统自然语言中枢。零件词典: [${partsList}]。判断指令: "${text}"。若要聚焦展示则输出JSON: {"action":"focus", "targetId":"ID"}。提问则输出: {"action":"qa"}`;
    try {
        const res = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${llmService.apiKey}` },
            body: JSON.stringify({ model: 'deepseek-chat', messages: [{role: 'system', content: prompt}], temperature: 0.1 })
        });
        const data = await res.json(); return JSON.parse(data.choices[0].message.content.trim());
    } catch (e) { return { action: 'qa' }; }
}
async function handleSendChat() {
    const text = chatInputUI.value.trim(); if (!text || !llmService) return;
    chatInputUI.value = ''; chatInputUI.disabled = true; sendBtnUI.disabled = true;
    appendMessage('user', text); const assistantBubble = appendMessage('assistant', '<span id="spinner">意图解析中...</span>');
    const intent = await parseIntent(text);
    if (intent.action === 'focus' && intent.targetId) {
        let targetMesh = null; anatomyGroup.traverse(child => { if (child.name === intent.targetId) targetMesh = child; });
        if (targetMesh) {
            assistantBubble.innerHTML = `定位至：<strong>${anatomyConfig[intent.targetId]?.label || intent.targetId}</strong>`;
            chatInputUI.disabled = false; sendBtnUI.disabled = false;
            hsmCallbacks.onExplode(); handleHit(targetMesh);
            setTimeout(() => { transitionToFocused(); hsm.setAppMode('FOCUSED'); }, 800);
        }
    } else {
        if (!State_Channel.activeContext) {
            assistantBubble.innerHTML = "请先选中特定部位。"; chatInputUI.disabled = false; sendBtnUI.disabled = false; return;
        }
        assistantBubble.innerHTML = ''; let rawMarkdown = "";
        llmService.askQuestion(
            State_Channel.activeContext.id, State_Channel.activeContext, text,
            (chunk) => { rawMarkdown += chunk; assistantBubble.innerHTML = marked.parse(rawMarkdown); },
            () => { chatInputUI.disabled = false; sendBtnUI.disabled = false; },
            (err) => { assistantBubble.innerHTML += `[异常: ${err.message}]`; chatInputUI.disabled = false; sendBtnUI.disabled = false; }
        );
    }
}
sendBtnUI.addEventListener('click', handleSendChat);
chatInputUI.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleSendChat(); });
function checkHover(element, x, y) {
    if (!element) return false;
    const rect = element.getBoundingClientRect(); return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

// --- 8. 渲染与状态机主循环 ---
function animate() {
    requestAnimationFrame(animate);
    let handData = window.handData || null;

    if (handData && handData.landmarks) {
        if (handData.state === 'CLOSED') handData.state = 'FIST';

        // 计算物理 PINCH 动作是否发生在当前这一帧（上升沿边缘触发器）
        const isPinchJustStarted = (handData.state === 'PINCH' && prevHandState !== 'PINCH');

        const renderState = hsm.update(handData, hsmCallbacks);
        const displayGesture = renderState?.effectiveGesture || handData.state;
        gestureStateUI.innerText = `[${hsm.appMode}] 输入: ${displayGesture}`;

        if (renderState && renderState.cursorScreen) {
            const rawMirroredX = renderState.cursorScreen.x;
            const rawMirroredY = renderState.cursorScreen.y;
            const screenX = rawMirroredX * window.innerWidth;
            const screenY = rawMirroredY * window.innerHeight;

            const isHoveringUI = checkHover(sidebar, screenX, screenY) || 
                                 checkHover(bottomConsole, screenX, screenY) || 
                                 checkHover(topNavModel, screenX, screenY) ||
                                 checkHover(topNavLang, screenX, screenY);
            
            currentSnappedNDC.x = (rawMirroredX * 2) - 1;
            currentSnappedNDC.y = -(rawMirroredY * 2) + 1;
            let isMagneticSnapped = false;

            if (hsm.appMode === 'SCATTERED' && !isHoveringUI && anatomyGroup.children.length > 0) {
                let minDist = 0.15; 
                let closestCenter = null;

                anatomyGroup.children[0].traverse((child) => {
                    if (child.isMesh && child.visible) {
                        const box = new THREE.Box3().setFromObject(child);
                        const center = new THREE.Vector3();
                        box.getCenter(center);
                        center.project(camera); 
                        
                        const dist = Math.hypot(center.x - currentSnappedNDC.x, center.y - currentSnappedNDC.y);
                        if (dist < minDist && center.z < 1) { 
                            minDist = dist;
                            closestCenter = center;
                        }
                    }
                });

                if (closestCenter) {
                    currentSnappedNDC.x = closestCenter.x;
                    currentSnappedNDC.y = closestCenter.y;
                    isMagneticSnapped = true;
                }
            }

            const uiScreenX = (currentSnappedNDC.x + 1) / 2;
            const uiScreenY = (-currentSnappedNDC.y + 1) / 2;
            
            crosshairUI.style.left = `${uiScreenX * 100}%`;
            crosshairUI.style.top = `${uiScreenY * 100}%`;
            crosshairUI.style.zIndex = '999999'; 
            
            if (renderState.panDirection && !isHoveringUI) {
                const angle = Math.atan2(renderState.panDirection.y, renderState.panDirection.x);
                crosshairUI.style.background = 'rgba(100, 200, 255, 0.8)';
                crosshairUI.style.transform = `translate(-50%, -50%) rotate(${angle}rad) scale(2.0, 0.4)`;
                crosshairUI.style.borderRadius = '5px';
                crosshairUI.style.boxShadow = 'none';
            } else if (handData.state === 'PINCH') {
                crosshairUI.style.background = 'rgba(212, 175, 55, 0.9)'; 
                crosshairUI.style.transform = 'translate(-50%, -50%) scale(0.6)'; 
                crosshairUI.style.borderRadius = '50%';
                if (hsm.appMode !== 'FOCUSED') lockStateUI.innerText = "ON (准备射击)";
            } else {
                crosshairUI.style.background = 'rgba(255, 255, 255, 0.5)';
                crosshairUI.style.transform = isMagneticSnapped ? 'translate(-50%, -50%) scale(1.3)' : 'translate(-50%, -50%) scale(1)';
                crosshairUI.style.boxShadow = isMagneticSnapped ? '0 0 10px rgba(255, 255, 255, 0.8)' : 'none';
                crosshairUI.style.borderRadius = '50%';
            }

            const isHoveringCancel = cancelZoneUI.classList.contains('active') && checkHover(cancelZoneUI, screenX, screenY);
            
            // 【UI 交互防护】：仅在捏合瞬间（isPinchJustStarted）且在按钮上时，才能触发录音和发送
            if (isPinchJustStarted) {
                if (checkHover(micBtnUI, screenX, screenY) && !micBtnUI.disabled && !isGestureRecording) {
                    isGestureRecording = true; micBtnUI.classList.add('recording'); cancelZoneUI.classList.add('active'); 
                    sttService.start((final, inter) => { chatInputUI.value = final + inter; }, () => {}, () => { isGestureRecording = false; });
                }
                if (checkHover(sendBtnUI, screenX, screenY) && !sendBtnUI.disabled) handleSendChat();
            }

            if (isGestureRecording) {
                cancelZoneUI.classList.toggle('hover-danger', isHoveringCancel);
                micHintUI.innerText = isHoveringCancel ? "松开取消" : "录音中...";
                if (handData.state === 'OPEN' || handData.state === 'NONE') {
                    isGestureRecording = false; sttService.stop(); micBtnUI.classList.remove('recording'); cancelZoneUI.classList.remove('active', 'hover-danger');
                    if (isHoveringCancel) { sttService.onEndCallback = null; chatInputUI.value = ''; micHintUI.innerText = "已取消"; }
                    else micHintUI.innerText = "捏合说话";
                }
            }
        }
        
        // 渲染完当前帧后，将状态保存，供下一帧对比
        prevHandState = handData.state;
    } else {
        gestureStateUI.innerText = `[${hsm.appMode}] 寻找手势...`;
        prevHandState = 'NONE';
    }

    hsm.applyMomentum();
    pivotGroup.quaternion.slerp(hsm.globalTargetQuat, 0.15);

    if (hsm.appMode === 'FOCUSED') {
        focusPivotGroup.quaternion.slerp(hsm.localTargetQuat, 0.15);
    }

    composer.render(); 
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight); composer.setSize(window.innerWidth, window.innerHeight);
});

animate();
