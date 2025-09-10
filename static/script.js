document.addEventListener('DOMContentLoaded', () => {
    // DOM Element References
    const chatModelSelect = document.getElementById('chat-model-select');
    const codeModelSelect = document.getElementById('code-model-select');
    const refreshModelsBtn = document.getElementById('refresh-models-btn');
    const newChatBtn = document.getElementById('new-chat-btn');
    const sessionListEl = document.getElementById('session-list');
    const chatHistoryEl = document.getElementById('chat-history');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const sendButton = document.getElementById('send-button');
    const welcomeMessage = document.getElementById('welcome-message');
    const ttsToggle = document.getElementById('tts-toggle');
    
    // Tab Elements
    const tabs = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    // Code & Preview Elements
    const codeBlock = document.getElementById('code-block');
    const copyCodeBtn = document.getElementById('copy-code-btn');
    const codePlaceholder = document.getElementById('code-placeholder');
    const previewFrame = document.getElementById('preview-frame');
    const previewPlaceholder = document.getElementById('preview-placeholder');

    // Modification Elements
    const modificationArea = document.getElementById('code-modification-area');
    const modificationForm = document.getElementById('modification-form');
    const modificationInput = document.getElementById('modification-input');
    const modificationSendButton = document.getElementById('modification-send-button');

    // Settings Elements
    const pullModelForm = document.getElementById('pull-model-form');
    const pullModelName = document.getElementById('pull-model-name');
    const pullStatus = document.getElementById('pull-status');
    const createModelForm = document.getElementById('create-model-form');
    const createModelName = document.getElementById('create-model-name');
    const createModelfile = document.getElementById('create-modelfile');
    const createStatus = document.getElementById('create-status');
    const deleteModelForm = document.getElementById('delete-model-form');
    const deleteModelSelect = document.getElementById('delete-model-select');
    const manageStatus = document.getElementById('manage-status');

    // Project Elements
    const projectNameInput = document.getElementById('project-name');
    const initProjectBtn = document.getElementById('init-project-btn');
    const confirmPlanBtn = document.getElementById('confirm-plan-btn');
    const generateSelectedBtn = document.getElementById('generate-selected-btn');
    const projectBriefEl = document.getElementById('project-brief');
    const manifestJsonEl = document.getElementById('manifest-json');
    const fileTreeEl = document.getElementById('file-tree');
    const summarizeToggle = document.getElementById('summarize-on-save-toggle');

    // Application State
    let isLoading = false;
    let isTtsEnabled = false;
    let preferredVoice = null;
    let chatSessions = [];
    let activeSessionId = null;
    let currentProjectId = null;
    let summarizeOnSave = true;
    let _selectedPath = null;

    let conversationState = {
        isModifying: false,
        awaitingPlanConfirmation: false,
        lastUserPrompt: null,
        currentPlan: null,
        currentCode: null,
        currentManifest: null
    };
    let chatModelHistory = [];

    // Enhanced System Prompts for Phaser Game Development
    const chatSystemPrompt = {
        role: 'system',
        content: `You are an expert AI project manager specializing in Phaser 3 game development. You help users create web games and applications using Phaser 3.88 (latest version). Always respond in structured JSON format.

For Phaser games, ensure you include:
- Proper Phaser 3.88 CDN link: https://cdn.jsdelivr.net/npm/phaser@3.88.0/dist/phaser.min.js
- Scene management (preload, create, update)
- Asset loading patterns
- Physics systems (Arcade, Matter.js)
- Input handling (keyboard, mouse, touch)
- Proper game configuration

Response scenarios:

1. **New Project Request**: Create a detailed plan with file manifest
   JSON: { "response_for_user": "...", "plan": "...", "manifest": {"files": [{"path": "...", "intent": "..."}]} }

2. **Plan Modification**: Update the plan based on user feedback
   JSON: Same structure with revised plan and manifest

3. **Plan Confirmation**: Signal to proceed with code generation
   JSON: { "PROCEED_TO_CODE": true }

4. **Code Modification**: Create modification instructions
   JSON: { "response_for_user": "...", "modification_instruction": "..." }

Always include a manifest with specific file paths for multi-file projects.`
    };

    const codeSystemPrompt = {
        role: 'system',
        content: `You are an expert Phaser 3 game developer. Generate complete, runnable code using Phaser 3.88.

For HTML files with Phaser:
- Use CDN: https://cdn.jsdelivr.net/npm/phaser@3.88.0/dist/phaser.min.js
- Include complete game configuration
- Implement proper scene structure
- Add responsive canvas sizing
- Include error handling

For standalone JS files:
- Export as ES6 modules when appropriate
- Follow Phaser 3 best practices
- Include clear comments for complex logic

Output only raw code, no explanations or markdown.`
    };
    
    // TTS (Text-to-Speech) Logic
    const loadVoices = () => {
        const voices = speechSynthesis.getVoices();
        preferredVoice = voices.find(voice => voice.lang.startsWith('en') && voice.localService) || 
                         voices.find(voice => voice.lang.startsWith('en')) || voices[0];
    };
    
    const speak = (text) => {
        if (!isTtsEnabled || !text) return;
        speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        if (preferredVoice) utterance.voice = preferredVoice;
        speechSynthesis.speak(utterance);
    };
    
    speechSynthesis.onvoiceschanged = loadVoices;
    loadVoices();
    
    ttsToggle.addEventListener('change', () => {
        isTtsEnabled = ttsToggle.checked;
        if (!isTtsEnabled) speechSynthesis.cancel();
    });

    // API & Model Management
    const fetchFromProxy = async (path, method, body) => {
        const response = await fetch('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, method, body }),
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Server responded with status ${response.status}`);
        }
        const text = await response.text();
        return text ? JSON.parse(text) : {};
    };

    const fetchOllamaModels = async () => {
        try {
            const data = await fetchFromProxy('/api/tags', 'GET');
            const models = data.models || [];
            const selections = { 
                chat: chatModelSelect.value, 
                code: codeModelSelect.value, 
                delete: deleteModelSelect.value 
            };
            
            [chatModelSelect, codeModelSelect, deleteModelSelect].forEach(sel => {
                sel.innerHTML = sel.id === 'delete-model-select' ? 
                    '<option value="" disabled selected>Select model to delete...</option>' : '';
            });
            
            if (models.length > 0) {
                models.forEach(model => {
                    [chatModelSelect, codeModelSelect, deleteModelSelect].forEach(sel => 
                        sel.add(new Option(model.name, model.name))
                    );
                });
                chatModelSelect.value = selections.chat;
                codeModelSelect.value = selections.code;
                deleteModelSelect.value = selections.delete;
            } else {
                const noModelOption = new Option("No models found", "", true, true);
                chatModelSelect.add(noModelOption.cloneNode(true));
                codeModelSelect.add(noModelOption.cloneNode(true));
            }
        } catch (error) {
            console.error("Error fetching Ollama models:", error);
            addMessageToHistory('error', `Could not fetch models. ${error.message}`);
        }
    };

    // Session Management
    const renderSessionList = () => {
        sessionListEl.innerHTML = '';
        if (chatSessions.length === 0) return;
        
        chatSessions.forEach(session => {
            const sessionBtn = document.createElement('button');
            sessionBtn.classList.add('session-item');
            sessionBtn.textContent = session.title;
            sessionBtn.dataset.sessionId = session.id;
            if (session.id === activeSessionId) {
                sessionBtn.classList.add('active-session');
            }
            sessionBtn.addEventListener('click', () => loadSession(session.id));
            sessionListEl.prepend(sessionBtn);
        });
    };
    
    const loadSession = (sessionId) => {
        const session = chatSessions.find(s => s.id === sessionId);
        if (!session) return;

        activeSessionId = sessionId;
        chatModelHistory = session.modelHistory;
        conversationState = { ...session.conversationState };
        currentProjectId = session.projectId || null;

        chatHistoryEl.innerHTML = '';
        if (chatModelHistory.length === 0) {
            chatHistoryEl.appendChild(welcomeMessage);
            welcomeMessage.style.display = 'block';
        } else {
            welcomeMessage.style.display = 'none';
            chatModelHistory.forEach(msg => {
                if (msg.role !== 'system') {
                    addMessageToHistory(msg.role === 'assistant' ? 'model' : msg.role, msg.content);
                }
            });
        }
        
        updateCodePanels(conversationState.currentCode || '');
        if (conversationState.currentManifest) {
            manifestJsonEl.value = JSON.stringify(conversationState.currentManifest, null, 2);
        }
        renderSessionList();
        if (currentProjectId) refreshFileTree();
    };

    const saveActiveSession = () => {
        const session = chatSessions.find(s => s.id === activeSessionId);
        if (!session) return;
        
        session.modelHistory = [...chatModelHistory];
        session.conversationState = { ...conversationState };
        session.projectId = currentProjectId;
        
        if (session.title === "New Project" && conversationState.lastUserPrompt) {
            session.title = conversationState.lastUserPrompt.substring(0, 25) + 
                          (conversationState.lastUserPrompt.length > 25 ? '...' : '');
        }
        
        renderSessionList();
    };

    const handleNewChat = () => {
        const newSession = {
            id: Date.now(),
            title: "New Project",
            modelHistory: [],
            projectId: null,
            conversationState: {
                isModifying: false,
                awaitingPlanConfirmation: false,
                lastUserPrompt: null,
                currentPlan: null,
                currentCode: null,
                currentManifest: null
            }
        };
        chatSessions.push(newSession);
        loadSession(newSession.id);
    };

    // UI Update Functions
    const addMessageToHistory = (role, content) => {
        if (typeof content !== 'string') {
            console.error(`Invalid content for role '${role}':`, content);
            content = "Error: Received invalid message content.";
        }

        welcomeMessage.style.display = 'none';
        const messageEl = document.createElement('div');
        messageEl.classList.add('chat-message', `${role}-message`);
        const contentEl = document.createElement('div');
        contentEl.classList.add('message-content');
        contentEl.innerHTML = content.replace(/\n/g, '<br>');
        messageEl.appendChild(contentEl);
        
        if (role === 'model' || role === 'user') {
            const replayBtn = document.createElement('button');
            replayBtn.classList.add('replay-tts-btn');
            replayBtn.title = 'Replay audio';
            replayBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
            </svg>`;
            replayBtn.onclick = () => speak(content);
            messageEl.appendChild(replayBtn);
        }
        
        chatHistoryEl.appendChild(messageEl);
        chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
    };

    const addIntermediaryMessage = (summaryText, detailsText) => {
        welcomeMessage.style.display = 'none';
        const messageEl = document.createElement('details');
        messageEl.classList.add('chat-message', 'intermediary-message');
        const summaryEl = document.createElement('summary');
        summaryEl.textContent = summaryText;
        const detailsContentEl = document.createElement('div');
        detailsContentEl.classList.add('details-content');
        detailsContentEl.textContent = detailsText;
        messageEl.appendChild(summaryEl);
        messageEl.appendChild(detailsContentEl);
        chatHistoryEl.appendChild(messageEl);
        chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
        return { messageEl, summaryEl, detailsContentEl };
    };

    const resetConversationState = () => {
        conversationState = { 
            isModifying: false, 
            awaitingPlanConfirmation: false, 
            lastUserPrompt: null, 
            currentPlan: null, 
            currentCode: null,
            currentManifest: null 
        };
        chatModelHistory = [];
        modificationArea.style.display = 'none';
        chatInput.placeholder = "Describe a new app or game...";
    };

    // Enhanced JSON Parser
    const tryParsePMJson = (raw) => {
        // Direct parse
        try { return JSON.parse(raw); } catch {}
        
        // Strip markdown code blocks
        let s = raw.trim();
        s = s.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
        try { return JSON.parse(s); } catch {}
        
        // Find JSON object boundaries
        const first = s.indexOf('{');
        const last = s.lastIndexOf('}');
        if (first !== -1 && last !== -1 && last > first) {
            const sub = s.slice(first, last + 1);
            try { return JSON.parse(sub); } catch {}
        }
        
        // Try to fix common issues
        if (s.includes("{") && s.includes("}")) {
            // Fix single quotes
            let guess = s.replace(/'/g, '"');
            // Fix unquoted keys
            guess = guess.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
            try { return JSON.parse(guess); } catch {}
        }
        
        return null;
    };

    // Fallback JSON coercion via model
    const coerceJsonViaModel = async (chatModel, rawContent) => {
        try {
            const schemaHint = `Output ONLY valid JSON matching one of these structures:
1) {"response_for_user": "...", "plan": "...", "manifest": {"files":[{"path":"...","intent":"..."}]}}
2) {"PROCEED_TO_CODE": true}
3) {"response_for_user": "...", "modification_instruction": "..."}`;
            
            const repairMessages = [
                { role: 'system', content: "Convert text to STRICT JSON. Output only JSON." },
                { role: 'user', content: `${schemaHint}\n\nInput:\n${rawContent}` }
            ];
            
            const fixedRaw = await fetchFromProxy('/api/chat', 'POST', {
                model: chatModel,
                messages: repairMessages,
                stream: false,
                format: 'json'
            });
            
            const content = fixedRaw?.message?.content || "";
            return tryParsePMJson(content);
        } catch (e) {
            return null;
        }
    };

    // Core Conversation Logic
    const handleSendMessage = async (e) => {
        e.preventDefault();
        const userPrompt = chatInput.value.trim();
        if (!userPrompt || isLoading) return;

        addMessageToHistory('user', userPrompt);
        speak(userPrompt);
        chatInput.value = '';
        chatInput.style.height = 'auto';

        if (!conversationState.awaitingPlanConfirmation) {
            resetConversationState();
            conversationState.lastUserPrompt = userPrompt;
            projectBriefEl.value = userPrompt; // Auto-fill project brief
            chatModelHistory.push(chatSystemPrompt, { role: 'user', content: userPrompt });
        } else {
            chatModelHistory.push({ role: 'user', content: userPrompt });
        }
        
        saveActiveSession();
        await processChatter();
    };
    
    const handleCodeModification = async (e) => {
        e.preventDefault();
        const userPrompt = modificationInput.value.trim();
        if (!userPrompt || isLoading) return;
        
        addMessageToHistory('user', userPrompt);
        speak(userPrompt);
        modificationInput.value = '';
        modificationInput.style.height = 'auto';

        chatModelHistory.push({ role: 'user', content: userPrompt });
        saveActiveSession();
        await processChatter();
    };

    const processChatter = async () => {
        setLoading(true);
        const chatModel = chatModelSelect.value;
        const codeModel = codeModelSelect.value;
        
        if (!chatModel || !codeModel) {
            addMessageToHistory('error', 'Please select both a Chat and a Code model.');
            setLoading(false);
            return;
        }

        const thinkingMessage = addIntermediaryMessage('Contacting project manager...', 'Processing request...');
        
        try {
            const chatResponseRaw = await fetchFromProxy('/api/chat', 'POST', {
                model: chatModel,
                messages: chatModelHistory,
                stream: false,
                format: 'json'
            });
            
            const chatResponseContent = chatResponseRaw.message.content;
            chatModelHistory.push({ role: 'assistant', content: chatResponseContent });
            
            let chatResponse = tryParsePMJson(chatResponseContent);
            if (!chatResponse) {
                chatResponse = await coerceJsonViaModel(chatModel, chatResponseContent);
            }
            
            if (!chatResponse) {
                thinkingMessage.summaryEl.textContent = "Error: Invalid Response";
                thinkingMessage.detailsContentEl.textContent = chatResponseContent;
                throw new Error("Invalid response format. Please try again.");
            }

            if (chatResponse.plan) {
                thinkingMessage.summaryEl.textContent = "Received Execution Plan";
                thinkingMessage.detailsContentEl.textContent = chatResponse.plan;
                addMessageToHistory('model', chatResponse.response_for_user || 'Plan ready. Confirm to proceed.');
                speak(chatResponse.response_for_user);
                conversationState.currentPlan = chatResponse.plan;
                conversationState.awaitingPlanConfirmation = true;
                
                if (chatResponse.manifest) {
                    conversationState.currentManifest = chatResponse.manifest;
                    manifestJsonEl.value = JSON.stringify(chatResponse.manifest, null, 2);
                }
                
            } else if (chatResponse.PROCEED_TO_CODE) {
                conversationState.awaitingPlanConfirmation = false;
                
                // Auto-initialize project if not exists
                if (!currentProjectId && conversationState.lastUserPrompt) {
                    await initializeProject();
                }
                
                const codePrompt = `Original Request: "${conversationState.lastUserPrompt}"
                
Execution Plan:
${conversationState.currentPlan}

Create a complete, working implementation. For Phaser games, use version 3.88.`;
                
                thinkingMessage.summaryEl.textContent = "Generating code...";
                thinkingMessage.detailsContentEl.textContent = codePrompt;
                
                const codeMessages = [codeSystemPrompt, { role: 'user', content: codePrompt }];
                const codeResponse = await fetchFromProxy('/api/chat', 'POST', { 
                    model: codeModel, 
                    messages: codeMessages, 
                    stream: false 
                });
                
                updateCodePanels(codeResponse.message.content);
                addMessageToHistory('model', '✅ Code generated successfully! Check the Code tab.');
                
                // Save to project if exists
                if (currentProjectId) {
                    await saveToProject('index.html', codeResponse.message.content);
                }
                
            } else if (chatResponse.modification_instruction) {
                thinkingMessage.summaryEl.textContent = "Applying modification...";
                thinkingMessage.detailsContentEl.textContent = chatResponse.modification_instruction;
                addMessageToHistory('model', chatResponse.response_for_user || 'Modifying code...');
                speak(chatResponse.response_for_user);
                
                const codeMessages = [
                    codeSystemPrompt, 
                    { role: 'user', content: `EXISTING_CODE:\n\n${conversationState.currentCode}\n\nModification: "${chatResponse.modification_instruction}"` }
                ];
                
                const codeResponse = await fetchFromProxy('/api/chat', 'POST', { 
                    model: codeModel, 
                    messages: codeMessages, 
                    stream: false 
                });
                
                updateCodePanels(codeResponse.message.content);
                
                if (currentProjectId) {
                    await saveToProject('index.html', codeResponse.message.content);
                }
            }

        } catch (error) {
            console.error("Error during chat processing:", error);
            addMessageToHistory('error', error.message);
        } finally {
            saveActiveSession();
            setLoading(false);
        }
    };

    const updateCodePanels = (code) => {
        conversationState.currentCode = (code && code.trim() !== '') ? code : null;
        
        if (conversationState.currentCode) {
            codePlaceholder.style.display = 'none';
            previewPlaceholder.style.display = 'none';
            codeBlock.textContent = conversationState.currentCode;
            previewFrame.srcdoc = conversationState.currentCode;
            
            const codeContextMessage = { 
                role: 'system', 
                content: `EXISTING_CODE:\n${conversationState.currentCode}` 
            };
            
            const codeContextIndex = chatModelHistory.findIndex(
                msg => msg.role === 'system' && msg.content.startsWith('EXISTING_CODE')
            );
            
            if (codeContextIndex > -1) {
                chatModelHistory[codeContextIndex] = codeContextMessage;
            } else {
                chatModelHistory.push(codeContextMessage);
            }
            
            modificationArea.style.display = 'block';
        } else {
            codePlaceholder.style.display = 'flex';
            previewPlaceholder.style.display = 'flex';
            codeBlock.textContent = '';
            previewFrame.srcdoc = '';
            modificationArea.style.display = 'none';
        }
        saveActiveSession();
    };

    const setLoading = (state) => {
        isLoading = state;
        sendButton.disabled = state;
        modificationSendButton.disabled = state;
        sendButton.style.opacity = state ? 0.5 : 1.0;
        modificationSendButton.style.opacity = state ? 0.5 : 1.0;
    };

    const switchTab = (targetTabId) => {
        tabs.forEach(tab => tab.classList.toggle('active', tab.id === `${targetTabId}-tab`));
        tabContents.forEach(content => content.classList.toggle('active-content', content.id === `${targetTabId}-view`));
    };

    const copyCodeToClipboard = () => {
        if (navigator.clipboard && codeBlock.textContent) {
            navigator.clipboard.writeText(codeBlock.textContent).then(() => {
                copyCodeBtn.textContent = 'Copied!';
                setTimeout(() => { copyCodeBtn.textContent = 'Copy'; }, 2000);
            });
        }
    };
    
    const autoResizeTextarea = (el) => {
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    };

    // Settings Panel Logic
    const showStatusMessage = (element, message, type = 'info', duration = 4000) => {
        element.textContent = message;
        element.className = `status-message ${type}`;
        setTimeout(() => { 
            element.textContent = ''; 
            element.className = 'status-message'; 
        }, duration);
    };

    // Project API Integration
    const postJSON = async (url, body) => {
        const response = await fetch(url, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(body) 
        });
        return response.json();
    };

    const getJSON = async (url) => {
        const response = await fetch(url);
        return response.json();
    };

    const renderTree = (data) => {
        const { manifest, files } = data || {};
        fileTreeEl.innerHTML = '';
        const ul = document.createElement('ul');
        ul.style.listStyle = 'none';
        ul.style.paddingLeft = '0';
        
        const addItem = (label, path) => {
            const li = document.createElement('li');
            li.style.padding = '4px 6px';
            li.style.cursor = 'pointer';
            li.textContent = label;
            li.addEventListener('click', () => {
                _selectedPath = path;
                [...fileTreeEl.querySelectorAll('li')].forEach(n => 
                    n.style.background = 'transparent'
                );
                li.style.background = 'rgba(255,255,255,0.06)';
            });
            ul.appendChild(li);
        };
        
        const paths = (manifest && manifest.files ? 
            manifest.files.map(f => f.path) : []) || files || [];
        (paths || []).forEach(p => addItem(p, p));
        fileTreeEl.appendChild(ul);
    };

    const refreshFileTree = async () => {
        if (!currentProjectId) {
            fileTreeEl.innerHTML = '<em>No project initialized.</em>';
            return;
        }
        const data = await getJSON(`/api/project/tree?projectId=${encodeURIComponent(currentProjectId)}`);
        renderTree(data);
    };

    const initializeProject = async () => {
        const brief = projectBriefEl?.value?.trim() || conversationState.lastUserPrompt || '';
        const name = projectNameInput?.value?.trim() || 'Phaser Game Project';
        
        if (!chatModelSelect?.value || !codeModelSelect?.value) {
            addMessageToHistory('error', 'Please select both Chat and Code models.');
            return;
        }
        
        const r = await postJSON('/api/project/init', {
            name, 
            brief,
            chat_model: chatModelSelect.value,
            code_model: codeModelSelect.value
        });
        
        if (r.projectId) {
            currentProjectId = r.projectId;
            addMessageToHistory('model', `✅ Project initialized: ${currentProjectId}`);
            
            // Save plan and manifest if available
            if (conversationState.currentPlan && conversationState.currentManifest) {
                await postJSON('/api/project/manifest', {
                    projectId: currentProjectId,
                    plan: conversationState.currentPlan,
                    manifest: conversationState.currentManifest
                });
            }
            
            refreshFileTree();
            saveActiveSession();
        } else {
            addMessageToHistory('error', 'Project initialization failed.');
        }
    };

    const saveToProject = async (path, content) => {
        if (!currentProjectId) return;
        
        await postJSON('/api/project/save', {
            projectId: currentProjectId,
            path: path,
            content: content,
            summarize: summarizeOnSave,
            chat_model: chatModelSelect.value
        });
        
        refreshFileTree();
    };

    // Event Listeners - Critical for UI functionality!
    newChatBtn.addEventListener('click', handleNewChat);
    chatForm.addEventListener('submit', handleSendMessage);
    modificationForm.addEventListener('submit', handleCodeModification);

    chatInput.addEventListener('input', () => autoResizeTextarea(chatInput));
    modificationInput.addEventListener('input', () => autoResizeTextarea(modificationInput));

    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { 
            e.preventDefault(); 
            handleSendMessage(e); 
        }
    });
    
    modificationInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { 
            e.preventDefault(); 
            handleCodeModification(e); 
        }
    });

    refreshModelsBtn.addEventListener('click', fetchOllamaModels);
    copyCodeBtn.addEventListener('click', copyCodeToClipboard);
    
    // Tab switching
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetId = tab.id.replace('-tab', '');
            switchTab(targetId);
        });
    });

    // Project Management Event Listeners
    if (initProjectBtn) {
        initProjectBtn.addEventListener('click', async () => {
            await initializeProject();
        });
    }

    if (confirmPlanBtn) {
        confirmPlanBtn.addEventListener('click', async () => {
            if (!currentProjectId) {
                addMessageToHistory('error', 'Create a project first.');
                return;
            }
            
            const plan = (conversationState?.currentPlan || '').trim();
            let manifestObj = {};
            try {
                manifestObj = JSON.parse(manifestJsonEl.value.trim() || '{}');
            } catch {
                addMessageToHistory('error', 'Manifest JSON is invalid.');
                return;
            }
            
            const r = await postJSON('/api/project/manifest', {
                projectId: currentProjectId,
                plan,
                manifest: manifestObj
            });
            
            if (r.ok) {
                addMessageToHistory('model', '✅ Plan & manifest saved.');
                refreshFileTree();
            } else {
                addMessageToHistory('error', 'Failed saving manifest.');
            }
        });
    }

    if (generateSelectedBtn) {
        generateSelectedBtn.addEventListener('click', async () => {
            if (!currentProjectId) {
                addMessageToHistory('error', 'Create a project first.');
                return;
            }
            if (!_selectedPath) {
                addMessageToHistory('error', 'Select a file to generate.');
                return;
            }
            
            const r = await postJSON('/api/project/generate', {
                projectId: currentProjectId,
                path: _selectedPath,
                chat_model: chatModelSelect.value,
                code_model: codeModelSelect.value
            });
            
            if (r.ok) {
                addMessageToHistory('model', `✅ Generated: ${r.path}`);
                await saveToProject(r.path, r.content);
                refreshFileTree();
                updateCodePanels(r.content);
                switchTab('code');
            } else {
                addMessageToHistory('error', r.error || 'Generation failed.');
            }
        });
    }

    if (summarizeToggle) {
        summarizeToggle.addEventListener('click', () => {
            summarizeOnSave = !summarizeOnSave;
            summarizeToggle.textContent = summarizeOnSave ? 'Summarize on Save' : 'No Summaries';
        });
    }

    // Settings Event Listeners
    pullModelForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const modelName = pullModelName.value.trim();
        if (!modelName) return;
        showStatusMessage(pullStatus, `Pulling "${modelName}"... This may take a while.`, 'info', 60000);
        try {
            await fetchFromProxy('/api/pull', 'POST', { name: modelName, stream: false });
            showStatusMessage(pullStatus, `Successfully pulled "${modelName}".`, 'success');
            pullModelName.value = '';
            fetchOllamaModels();
        } catch (error) {
            showStatusMessage(pullStatus, `Error pulling model: ${error.message}`, 'error');
        }
    });

    createModelForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const modelName = createModelName.value.trim();
        const modelfile = createModelfile.value.trim();
        if (!modelName || !modelfile) return;
        showStatusMessage(createStatus, `Creating "${modelName}"...`, 'info', 60000);
        try {
            await fetchFromProxy('/api/create', 'POST', { 
                name: modelName, 
                modelfile: modelfile, 
                stream: false 
            });
            showStatusMessage(createStatus, `Successfully created "${modelName}".`, 'success');
            createModelName.value = '';
            createModelfile.value = '';
            fetchOllamaModels();
        } catch (error) {
            showStatusMessage(createStatus, `Error creating model: ${error.message}`, 'error');
        }
    });
    
    deleteModelForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const modelName = deleteModelSelect.value;
        if (!modelName) {
            showStatusMessage(manageStatus, 'Please select a model to delete.', 'error');
            return;
        }
        if (confirm(`Are you sure you want to permanently delete the model "${modelName}"?`)) {
            try {
                await fetchFromProxy('/api/delete', 'DELETE', { name: modelName });
                showStatusMessage(manageStatus, `Successfully deleted "${modelName}".`, 'success');
                fetchOllamaModels();
            } catch (error) {
                showStatusMessage(manageStatus, `Error deleting model: ${error.message}`, 'error');
            }
        }
    });

    // Initial Load - Start everything up!
    fetchOllamaModels();
    handleNewChat(); // Start with a fresh session
});