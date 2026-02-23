// services/stt_service.js

export class STTService {
    constructor() {
        // 兼容性处理：主流浏览器（如 Chrome/Edge）通常带有 webkit 前缀
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        
        if (!SpeechRecognition) {
            console.warn('[STTService] 当前浏览器不支持原生语音识别 API。建议使用 Chrome 浏览器进行演示。');
            this.isSupported = false;
            return;
        }

        this.isSupported = true;
        this.recognition = new SpeechRecognition();
        
        // 配置参数
        this.recognition.lang = 'zh-CN'; 
        this.recognition.continuous = true;      // 保持持续监听，直到手动 stop
        this.recognition.interimResults = true;  // 开启临时结果，用于实现打字机般的实时预览
        this.recognition.maxAlternatives = 1;

        this.isRecording = false;

        // 外部注入的回调钩子
        this.onResultCallback = null;
        this.onEndCallback = null;
        this.onErrorCallback = null;

        this._bindEvents();
    }

    _bindEvents() {
        this.recognition.onstart = () => {
            this.isRecording = true;
            console.log('[STTService] 麦克风已激活，开始拾音...');
        };

        this.recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';

            // 遍历并拼接识别结果
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }

            if (this.onResultCallback) {
                // 将最终确定的文本和还在猜的临时文本一起抛出
                this.onResultCallback(finalTranscript, interimTranscript);
            }
        };

        this.recognition.onerror = (event) => {
            console.error('[STTService] 识别异常:', event.error);
            this.isRecording = false;
            if (this.onErrorCallback) this.onErrorCallback(event.error);
        };

        this.recognition.onend = () => {
            this.isRecording = false;
            console.log('[STTService] 拾音结束。');
            if (this.onEndCallback) this.onEndCallback();
        };
    }

    /**
     * 启动录音
     * @param {Function} onResult - (finalText, interimText) => void
     * @param {Function} onEnd - () => void
     * @param {Function} onError - (err) => void
     */
    start(onResult, onEnd, onError) {
        if (!this.isSupported || this.isRecording) return;
        
        this.onResultCallback = onResult;
        this.onEndCallback = onEnd;
        this.onErrorCallback = onError;

        try {
            this.recognition.start();
        } catch (e) {
            console.warn('[STTService] 实例启动冲突，已忽略:', e);
        }
    }

    /**
     * 停止录音
     */
    stop() {
        if (!this.isSupported || !this.isRecording) return;
        this.recognition.stop();
    }
}