export class LLMService {
    constructor(apiKey) {
        this.apiKey = apiKey;
        // DeepSeek 官方兼容 OpenAI 的 Chat 接口规范
        this.baseURL = 'https://api.deepseek.com/chat/completions';
        // 用于管理和阻断网络请求，防止竞态条件
        this.abortController = null; 
        
        // 核心：维护各个解剖部位的上下文对话历史
        // 结构: { [partId]: [ {role: 'system', content: '...'}, {role: 'user', content: '...'}, ... ] }
        this.historyMap = new Map();
    }

    /**
     * 发起流式提问并维护对话历史
     * @param {string} partId - 当前部位的唯一标识（如 tripo_part_1）
     * @param {Object} partContext - 部位上下文对象，包含 label 和 physicalDesc 等
     * @param {string} userQuestion - 用户的提问文本
     * @param {Function} onChunk - 收到文本碎块时的回调函数 (delta) => void
     * @param {Function} onComplete - 流式传输完成时的回调函数 () => void
     * @param {Function} onError - 发生错误时的回调函数 (err) => void
     */
    async askQuestion(partId, partContext, userQuestion, onChunk, onComplete, onError) {
        // 1. 竞态控制：如果当前有正在进行的请求，立即阻断
        if (this.abortController) {
            this.abortController.abort();
        }
        this.abortController = new AbortController();

        // 2. 上下文初始化：如果这是该部位的第一次提问，注入 System Prompt
        if (!this.historyMap.has(partId)) {
            const systemPrompt = `你是一个专业的医学影像与解剖学AI助手。
当前用户在 3D 可视化交互系统中选中了一个解剖部位。
【部位标签】：${partContext.label}
【空间物理特征】：${partContext.physicalDesc}
请解答用户关于该部位的疑问。严格遵循以下要求：
1. 语言专业、精炼，具有学术严谨性。
2. 必须使用 Markdown 格式排版。
3. 直接回答问题，不要任何客套和寒暄。`;
            
            this.historyMap.set(partId, [{ role: 'system', content: systemPrompt }]);
        }

        // 3. 压入用户的新问题
        const messages = this.historyMap.get(partId);
        messages.push({ role: 'user', content: userQuestion });

        try {
            // 4. 发起 Fetch 请求
            const response = await fetch(this.baseURL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: 'deepseek-chat', 
                    messages: messages,
                    stream: true, // 核心：开启 Server-Sent Events 流式输出
                    temperature: 0.3 // 低温以保证医疗科普的严谨性和稳定性
                }),
                signal: this.abortController.signal
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errText}`);
            }

            // 5. 挂载流式解码器
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let isDone = false;
            let fullAssistantResponse = ""; // 收集完整的 AI 回复，以便存入历史

            while (!isDone) {
                const { value, done } = await reader.read();
                isDone = done;
                
                if (value) {
                    // 解码二进制流，{ stream: true } 保证了跨 Chunk 截断的 UTF-8 字符不会乱码
                    const chunkString = decoder.decode(value, { stream: true });
                    // SSE 报文规范：以双换行或单换行分隔的文本块
                    const lines = chunkString.split('\n').filter(line => line.trim() !== '');
                    
                    for (const line of lines) {
                        if (line === 'data: [DONE]') {
                            break; 
                        }
                        
                        if (line.startsWith('data: ')) {
                            try {
                                const parsed = JSON.parse(line.substring(6));
                                const contentDelta = parsed.choices[0]?.delta?.content || "";
                                if (contentDelta) {
                                    fullAssistantResponse += contentDelta;
                                    onChunk(contentDelta); // 抛出增量文本给 UI 渲染
                                }
                            } catch (e) {
                                // 忽略流传输中偶然出现的残缺 JSON 帧
                                console.warn('[LLMService] 跳过异常帧:', line);
                            }
                        }
                    }
                }
            }
            
            // 6. 完整回复存入上下文记录
            if (fullAssistantResponse) {
                messages.push({ role: 'assistant', content: fullAssistantResponse });
            }

            if (onComplete) onComplete();

        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('[LLMService] 拦截到手势切换或强制中断，已阻断网络请求。');
                // 注意：被阻断的请求，我们暂时不从 messages 中剔除最后一个 user 问题，
                // 因为用户可能马上又切回来，或者我们可以根据策略选择 `messages.pop()`。这里选择保留以容错。
            } else {
                console.error('[LLMService] 网络或 API 异常:', error);
                // 真正的网络错误发生时，将刚才发出的用户问题弹出，允许用户重试
                messages.pop(); 
                if (onError) onError(error);
            }
        }
    }

    /**
     * 清理指定部位的对话历史（可选调用的内存管理方法）
     */
    clearHistory(partId) {
        this.historyMap.delete(partId);
    }
}