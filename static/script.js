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
    const refreshPreviewBtn = document.getElementById('refresh-preview-btn');

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

    // Asset Management Elements
    const assetUpload = document.getElementById('asset-upload');
    const uploadAssetsBtn = document.getElementById('upload-assets-btn');
    const assetSearch = document.getElementById('asset-search');
    const assetsGrid = document.getElementById('assets-grid');
    const assetsContent = document.querySelector('.assets-content');

    // Context Management Elements
    const contextModeSelect = document.getElementById('context-mode-select');
    const contextStatusEl = document.getElementById('context-status');
    const contextWarningEl = document.getElementById('context-warning');
    const contextDetailsBtn = document.getElementById('context-details-btn');
    const compressContextBtn = document.getElementById('compress-context-btn');
    const contextPlanBtn = document.getElementById('context-plan-btn');

    // Application State
    let isLoading = false;
    let isTtsEnabled = false;
    let preferredVoice = null;
    let chatSessions = [];
    let activeSessionId = null;
    let currentProjectId = null;
    let summarizeOnSave = true;
    let _selectedPath = null;
    let _selectedAsset = null;
    let currentStreamController = null;
    let contextMode = 'automatic'; // 'automatic', 'manual', 'hybrid'
    let contextStatus = null;

    let conversationState = {
        isModifying: false,
        awaitingPlanConfirmation: false,
        lastUserPrompt: null,
        currentPlan: null,
        currentCode: null,
        currentManifest: null
    };
    let chatModelHistory = [];

    // ENHANCED: System Prompts for Multi-File Projects
    const chatSystemPrompt = {
        role: 'system',
        content: `You are an expert Phaser 3 game development assistant. You help create MULTI-FILE game projects with proper structure.

CRITICAL: Always generate projects with MULTIPLE FILES:
- index.html (entry point linking to external files)
- js/game.js (main game configuration)
- js/scenes/*.js (individual scene files)
- js/entities/*.js (game object classes)
- css/style.css (game styling)
- Assets go in assets/ folder (images, audio, etc.)

Response scenarios:

1. **New Project Request**: Create detailed plan with multi-file manifest
   JSON: { "response_for_user": "✨ Creating multi-file [game type] structure...", "plan": "...", "manifest": {"files": [{"path": "index.html", "intent": "Game entry point"}, {"path": "js/game.js", "intent": "Main game config"}, {"path": "js/scenes/StartScene.js", "intent": "Start screen"}, {"path": "js/scenes/GameScene.js", "intent": "Main gameplay"}, {"path": "css/style.css", "intent": "Game styling"}]} }

2. **Plan Modification**: Update the plan based on user feedback
   JSON: Same structure with revised plan and manifest

3. **Plan Confirmation**: Signal to proceed with code generation
   JSON: { "PROCEED_TO_CODE": true, "response_for_user": "🚀 Generating multi-file project structure..." }

4. **Code Modification**: Create modification instructions
   JSON: { "response_for_user": "🔧 Applying modifications...", "modification_instruction": "...", "target_files": ["js/scenes/GameScene.js"] }

NEVER suggest single-file HTML. Always use proper multi-file Phaser project structure.`
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

    // ENHANCED: Context Management Functions
    const updateContextStatus = async () => {
        if (!currentProjectId) return;
        
        try {
            const response = await fetch(`/api/context/status?projectId=${encodeURIComponent(currentProjectId)}`);
            const data = await response.json();
            
            if (data.error) {
                console.error('Context status error:', data.error);
                return;
            }
            
            contextStatus = data;
            renderContextStatus(data);
            
            // Show context warning if needed
            if (data.should_compress && data.mode !== 'automatic') {
                showContextWarning(data);
            } else {
                hideContextWarning();
            }
            
        } catch (error) {
            console.error('Failed to fetch context status:', error);
        }
    };

    const renderContextStatus = (status) => {
        if (!contextStatusEl) return;
        
        const percentage = status.usage_percentage || 0;
        const color = percentage > 80 ? '#ff6b6b' : percentage > 60 ? '#ffd43b' : '#51cf66';
        
        contextStatusEl.innerHTML = `
            <div class="context-info">
                <div class="context-bar">
                    <div class="context-fill" style="width: ${percentage}%; background: ${color}"></div>
                </div>
                <div class="context-text">
                    ${Math.round(percentage)}% (${status.current_tokens}/${status.max_tokens} tokens)
                </div>
                <div class="context-mode">Mode: ${status.mode.toUpperCase()}</div>
            </div>
        `;
        
        contextStatusEl.style.display = 'block';
    };

    const showContextWarning = (status) => {
        if (!contextWarningEl) return;
        
        const plan = status.compression_plan;
        if (!plan) return;
        
        contextWarningEl.innerHTML = `
            <div class="context-warning-content">
                <div class="warning-header">
                    ⚠️ Context Approaching Limit (${Math.round(status.usage_percentage)}%)
                </div>
                <div class="warning-body">
                    <p>Current: ${status.current_tokens}/${status.max_tokens} tokens</p>
                    <p>Compression will save ~${Math.round(plan.compression_ratio * 100)}% space</p>
                    <p>Quality Score: ${Math.round(plan.quality_score)}%</p>
                </div>
                <div class="warning-actions">
                    ${status.mode === 'manual' ? `
                        <button class="action-btn" onclick="handleContextAction('compress')">🔄 Compress Now</button>
                        <button class="action-btn" onclick="handleContextAction('custom')">📋 Custom Compression</button>
                        <button class="action-btn" onclick="handleContextAction('pause')">⏸️ Pause Project</button>
                    ` : status.mode === 'hybrid' ? `
                        <button class="action-btn primary" onclick="handleContextAction('preview')">👀 Preview & Approve</button>
                        <button class="action-btn" onclick="handleContextAction('custom')">✏️ Customize</button>
                    ` : ''}
                    <button class="action-btn" onclick="hideContextWarning()">✖ Dismiss</button>
                </div>
            </div>
        `;
        
        contextWarningEl.style.display = 'block';
    };

    const hideContextWarning = () => {
        if (contextWarningEl) {
            contextWarningEl.style.display = 'none';
        }
    };

    const setContextMode = async (mode) => {
        if (!currentProjectId) {
            contextMode = mode;
            if (contextModeSelect) {
                contextModeSelect.value = mode;
            }
            return;
        }
        
        try {
            const response = await fetch('/api/context/set-mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId: currentProjectId,
                    mode: mode
                })
            });
            
            const data = await response.json();
            if (data.success) {
                contextMode = mode;
                if (contextModeSelect) {
                    contextModeSelect.value = mode;
                }
                updateContextStatus(); // Refresh status
                addMessageToHistory('system', `🧠 Context mode changed to: ${mode.toUpperCase()}`);
            }
        } catch (error) {
            console.error('Failed to set context mode:', error);
        }
    };

    const compressContext = async (customPlan = null) => {
        if (!currentProjectId) return;
        
        const compressProgress = addProgressMessage('🗜️ Compressing:', 'Optimizing context for better performance...', true);
        
        try {
            const response = await fetch('/api/context/compress', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId: currentProjectId,
                    plan: customPlan
                })
            });
            
            const data = await response.json();
            if (data.success) {
                const result = data.compression_result;
                updateProgressMessage(compressProgress, '✅ Compressed:', 
                    `Reduced from ${result.original_tokens} to ${result.compressed_tokens} tokens (${Math.round(result.compression_ratio * 100)}% reduction)`, 100);
                
                hideContextWarning();
                updateContextStatus();
                
                setTimeout(() => {
                    completeProgressMessage(compressProgress, '✅ Complete:', 'Context optimized successfully!');
                }, 1500);
            } else {
                completeProgressMessage(compressProgress, '❌ Error:', data.error || 'Compression failed');
            }
        } catch (error) {
            console.error('Context compression failed:', error);
            completeProgressMessage(compressProgress, '❌ Error:', error.message);
        }
    };

    const showCompressionPlan = async () => {
        if (!currentProjectId) {
            addMessageToHistory('error', '⚠️ Please create a project first to view context details.');
            return;
        }
        
        try {
            const response = await fetch(`/api/context/plan?projectId=${encodeURIComponent(currentProjectId)}`);
            const data = await response.json();
            
            if (data.success) {
                showCompressionModal(data.plan);
            } else {
                addMessageToHistory('error', '❌ Failed to get compression plan: ' + data.error);
            }
        } catch (error) {
            console.error('Failed to get compression plan:', error);
            addMessageToHistory('error', '❌ Failed to get compression plan: ' + error.message);
        }
    };

    const showCompressionModal = (plan) => {
        // Create modal overlay
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="compression-modal">
                <div class="modal-header">
                    <h3>🎛️ Context Compression Plan</h3>
                    <button class="close-btn" onclick="closeCompressionModal()">×</button>
                </div>
                <div class="modal-body">
                    <div class="compression-stats">
                        <div class="stat">
                            <span class="stat-label">Current Size:</span>
                            <span class="stat-value">${plan.current_tokens} tokens</span>
                        </div>
                        <div class="stat">
                            <span class="stat-label">After Compression:</span>
                            <span class="stat-value">${plan.projected_tokens} tokens</span>
                        </div>
                        <div class="stat">
                            <span class="stat-label">Space Saved:</span>
                            <span class="stat-value">${Math.round(plan.compression_ratio * 100)}%</span>
                        </div>
                        <div class="stat">
                            <span class="stat-label">Quality Score:</span>
                            <span class="stat-value">${Math.round(plan.quality_score)}%</span>
                        </div>
                    </div>
                    
                    <div class="compression-sections">
                        <div class="section">
                            <h4>✅ PRESERVED (${plan.preserve.length} items)</h4>
                            <div class="items-list">
                                ${plan.preserve.map(item => `
                                    <div class="item">
                                        <span class="item-content">${item.content}</span>
                                        <span class="item-tokens">${item.tokens} tokens</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                        
                        <div class="section">
                            <h4>🗜️ COMPRESSED (${plan.compress.length} items)</h4>
                            <div class="items-list">
                                ${plan.compress.map(item => `
                                    <div class="item">
                                        <span class="item-content">${item.content}</span>
                                        <span class="item-tokens">${item.tokens} → ${item.compressed_tokens} tokens</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                        
                        <div class="section">
                            <h4>❌ REMOVED (${plan.remove.length} items)</h4>
                            <div class="items-list">
                                ${plan.remove.map(item => `
                                    <div class="item">
                                        <span class="item-content">${item.content}</span>
                                        <span class="item-tokens">${item.tokens} tokens</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="action-btn primary" onclick="approveCompression()">✅ Approve Compression</button>
                    <button class="action-btn" onclick="customizeCompression()">✏️ Customize</button>
                    <button class="action-btn" onclick="closeCompressionModal()">❌ Cancel</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        window.currentCompressionPlan = plan;
    };

    // Global functions for compression modal
    window.closeCompressionModal = () => {
        const modal = document.querySelector('.modal-overlay');
        if (modal) {
            modal.remove();
        }
        window.currentCompressionPlan = null;
    };

    window.approveCompression = async () => {
        await compressContext();
        window.closeCompressionModal();
    };

    window.customizeCompression = () => {
        // TODO: Implement custom compression interface
        addMessageToHistory('system', '🔧 Custom compression interface coming soon! Using automatic compression for now...');
        window.approveCompression();
    };

    // Global context action handler
    window.handleContextAction = async (action) => {
        switch (action) {
            case 'compress':
                await compressContext();
                break;
            case 'custom':
                await showCompressionPlan();
                break;
            case 'preview':
                await showCompressionPlan();
                break;
            case 'pause':
                addMessageToHistory('system', '⏸️ Project paused. You can export your current progress or continue later.');
                hideContextWarning();
                break;
        }
    };

    window.hideContextWarning = hideContextWarning;

    // ENHANCED: Drag and Drop System
    const setupDragAndDrop = () => {
        let dragCounter = 0;

        document.addEventListener('dragenter', (e) => {
            e.preventDefault();
            dragCounter++;
            if (currentProjectId && assetsContent) {
                assetsContent.classList.add('drag-over');
            }
        });

        document.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dragCounter--;
            if (dragCounter <= 0 && assetsContent) {
                assetsContent.classList.remove('drag-over');
                dragCounter = 0;
            }
        });

        document.addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        document.addEventListener('drop', (e) => {
            e.preventDefault();
            dragCounter = 0;
            if (assetsContent) {
                assetsContent.classList.remove('drag-over');
            }
            
            if (e.dataTransfer.files.length > 0 && currentProjectId) {
                handleAssetUpload(e.dataTransfer.files);
            } else if (!currentProjectId) {
                addMessageToHistory('error', '⚠️ Please create a project first before uploading assets.');
                // Auto-focus project name input
                if (projectNameInput) {
                    switchTab('files');
                    projectNameInput.focus();
                    projectNameInput.style.borderColor = 'var(--color-warning)';
                    setTimeout(() => {
                        projectNameInput.style.borderColor = '';
                    }, 3000);
                }
            }
        });
    };

    // ENHANCED: Preview Frame Management with Better Error Handling
    const updatePreviewFrame = () => {
        if (!currentProjectId) {
            previewFrame.src = '';
            if (previewPlaceholder) previewPlaceholder.style.display = 'flex';
            return;
        }

        // Add loading indicator with timeout
        const previewStatus = document.getElementById('preview-status');
        if (previewStatus) {
            previewStatus.textContent = 'Loading preview...';
            previewStatus.style.color = 'var(--color-info)';
        }

        // Add timeout for preview loading
        const previewTimeout = setTimeout(() => {
            if (previewStatus) {
                previewStatus.textContent = 'Preview timeout - check console';
                previewStatus.style.color = 'var(--color-warning)';
            }
        }, 10000);

        // Set preview source with enhanced error handling
        previewFrame.src = `/api/project/preview/${currentProjectId}`;
        if (previewPlaceholder) previewPlaceholder.style.display = 'none';
        
        previewFrame.onload = () => {
            clearTimeout(previewTimeout);
            if (previewStatus) {
                previewStatus.textContent = 'Preview loaded successfully';
                previewStatus.style.color = 'var(--color-success)';
            }
            
            // Ensure preview text is readable by injecting CSS if needed
            try {
                const previewDoc = previewFrame.contentDocument;
                if (previewDoc) {
                    // Check if preview has dark text on dark background
                    const style = document.createElement('style');
                    style.textContent = `
                        body { 
                            color: #333 !important; 
                            background: #fff !important; 
                        }
                        .game-ui { 
                            color: #fff !important; 
                            text-shadow: 2px 2px 4px rgba(0,0,0,0.8) !important; 
                        }
                    `;
                    previewDoc.head.appendChild(style);
                }
            } catch (e) {
                // Cross-origin restrictions prevent styling, but that's okay
                console.log('Preview styling blocked by CORS - this is normal');
            }
        };

        previewFrame.onerror = () => {
            clearTimeout(previewTimeout);
            if (previewStatus) {
                previewStatus.textContent = 'Preview failed to load';
                previewStatus.style.color = 'var(--color-error)';
            }
            if (previewPlaceholder) {
                previewPlaceholder.style.display = 'flex';
                // Show helpful error message in placeholder
                const errorMsg = previewPlaceholder.querySelector('.placeholder-content p');
                if (errorMsg) {
                    errorMsg.textContent = 'Preview failed to load. Generate your project files first, then try refreshing the preview.';
                }
            }
            
            addMessageToHistory('error', '🖼️ **Preview Error:** Failed to load game preview.\n\n**Common causes:**\n• Missing index.html file\n• JavaScript errors in generated code\n• Asset loading issues\n\n**Solutions:**\n• Generate all required files first\n• Check browser console for errors\n• Try the refresh preview button');
        };
    };

    // ENHANCED: API & Model Management with Streaming
    const fetchFromProxy = async (path, method, body, useStreaming = false) => {
        if (useStreaming && body) {
            body.stream = true;
        }
        
        const response = await fetch('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, method, body }),
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Server responded with status ${response.status}`);
        }
        
        if (useStreaming) {
            return response; // Return response for streaming
        } else {
            const text = await response.text();
            return text ? JSON.parse(text) : {};
        }
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

    // Enhanced model selection validation
    const validateModels = () => {
        const chatModel = chatModelSelect?.value;
        const codeModel = codeModelSelect?.value;
        
        if (!chatModel || !codeModel) {
            return false;
        }
        
        // Warn about slow models
        const slowModels = ['70b', '34b', '65b'];
        const isSlowChat = slowModels.some(size => chatModel.includes(size));
        const isSlowCode = slowModels.some(size => codeModel.includes(size));
        
        if (isSlowChat || isSlowCode) {
            const slowModelNames = [
                ...(isSlowChat ? [chatModel] : []),
                ...(isSlowCode ? [codeModel] : [])
            ];
            
            addMessageToHistory('system', `⚠️ **Large Model Warning:** You've selected large models (${slowModelNames.join(', ')}) which may be slow.\n\n🏃‍♂️ **For faster generation, consider:**\n• \`codellama:7b\` or \`deepseek-coder:6.7b\` for code\n• \`llama3:8b\` or \`mistral:7b\` for chat\n\n⏱️ **Expected times with large models:**\n• Simple files: 1-2 minutes\n• Complex files: 2-5 minutes`);
        }
        
        return true;
    };

    // ENHANCED: Session Management with Context Tracking
    const renderSessionList = () => {
        sessionListEl.innerHTML = '';
        if (chatSessions.length === 0) return;
        
        chatSessions.forEach(session => {
            const sessionBtn = document.createElement('button');
            sessionBtn.classList.add('session-item');
            
            // Add context indicator
            const contextIndicator = session.contextStatus ? 
                `<span class="context-indicator" style="color: ${session.contextStatus.usage_percentage > 80 ? '#ff6b6b' : '#51cf66'}">
                    ${Math.round(session.contextStatus.usage_percentage || 0)}%
                </span>` : '';
            
            sessionBtn.innerHTML = `
                <span class="session-title">${session.title}</span>
                ${contextIndicator}
            `;
            
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
        contextMode = session.contextMode || 'automatic';

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
        
        // Update context mode selector
        if (contextModeSelect) {
            contextModeSelect.value = contextMode;
        }
        
        renderSessionList();
        if (currentProjectId) {
            refreshFileTree();
            refreshAssetGrid();
            updateContextStatus(); // Load context status for project
            updatePreviewFrame(); // Update preview frame
        }
    };

    const saveActiveSession = () => {
        const session = chatSessions.find(s => s.id === activeSessionId);
        if (!session) return;
        
        session.modelHistory = [...chatModelHistory];
        session.conversationState = { ...conversationState };
        session.projectId = currentProjectId;
        session.contextMode = contextMode;
        session.contextStatus = contextStatus;
        
        if (session.title === "New Project" && conversationState.lastUserPrompt) {
            session.title = conversationState.lastUserPrompt.substring(0, 25) + 
                          (conversationState.lastUserPrompt.length > 25 ? '...' : '');
        }
        
        renderSessionList();
    };

    const handleNewChat = () => {
        // Cancel any ongoing streams
        if (currentStreamController) {
            currentStreamController.abort();
            currentStreamController = null;
        }
        
        const newSession = {
            id: Date.now(),
            title: "New Project",
            modelHistory: [],
            projectId: null,
            contextMode: 'automatic',
            contextStatus: null,
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

    // ENHANCED: UI Update Functions with Real-time Progress
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
        return messageEl;
    };

    const addProgressMessage = (phase, description, showProgress = false) => {
        const messageEl = document.createElement('div');
        messageEl.classList.add('chat-message', 'progress-message');
        
        const progressHtml = showProgress ? `
            <div class="progress-container">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: 0%"></div>
                </div>
                <div class="progress-text">0%</div>
            </div>
        ` : '';
        
        messageEl.innerHTML = `
            <div class="message-content">
                <div class="progress-header">
                    <strong>${phase}</strong>
                    <div class="progress-spinner"></div>
                </div>
                <div class="progress-description">${description}</div>
                ${progressHtml}
            </div>
        `;
        
        chatHistoryEl.appendChild(messageEl);
        chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
        return messageEl;
    };

    const updateProgressMessage = (messageEl, phase, description, progress = null) => {
        if (!messageEl) return;
        
        const headerEl = messageEl.querySelector('.progress-header strong');
        const descEl = messageEl.querySelector('.progress-description');
        const progressFill = messageEl.querySelector('.progress-fill');
        const progressText = messageEl.querySelector('.progress-text');
        
        if (headerEl) headerEl.textContent = phase;
        if (descEl) descEl.textContent = description;
        
        if (progress !== null && progressFill && progressText) {
            progressFill.style.width = `${progress}%`;
            progressText.textContent = `${Math.round(progress)}%`;
        }
        
        chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
    };

    const completeProgressMessage = (messageEl, finalPhase, finalDescription) => {
        if (!messageEl) return;
        
        const spinner = messageEl.querySelector('.progress-spinner');
        if (spinner) {
            spinner.innerHTML = '✅';
            spinner.classList.add('completed');
        }
        
        updateProgressMessage(messageEl, finalPhase, finalDescription, 100);
        
        // Remove after 3 seconds
        setTimeout(() => {
            if (messageEl.parentNode) {
                messageEl.remove();
            }
        }, 3000);
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
        if (modificationArea) modificationArea.style.display = 'none';
        chatInput.placeholder = "Describe your game idea (e.g., 'Create a platformer with jumping mechanics')...";
        hideContextWarning(); // Clear any context warnings
    };

    // ENHANCED: JSON Parser
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

    // ENHANCED: Streaming Response Handler
    const handleStreamingResponse = async (response, onToken, onComplete, onError) => {
        try {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let fullContent = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // Keep incomplete line in buffer

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6).trim();
                        if (data === '[DONE]') {
                            onComplete(fullContent);
                            return fullContent;
                        }

                        try {
                            const parsed = JSON.parse(data);
                            const token = parsed.message?.content || '';
                            if (token) {
                                fullContent += token;
                                onToken(token, fullContent);
                            }
                        } catch (e) {
                            console.warn('Failed to parse streaming data:', data);
                        }
                    }
                }
            }

            onComplete(fullContent);
            return fullContent;
        } catch (error) {
            onError(error);
            throw error;
        }
    };

    // ENHANCED: Core Conversation Logic with Streaming and Context Management
    const handleSendMessage = async (e) => {
        e.preventDefault();
        const userPrompt = chatInput.value.trim();
        if (!userPrompt || isLoading) return;

        // Validate models first
        if (!validateModels()) {
            addMessageToHistory('error', '🤖 Please select both Chat and Code models from the header controls.');
            return;
        }

        addMessageToHistory('user', userPrompt);
        speak(userPrompt);
        chatInput.value = '';
        chatInput.style.height = 'auto';

        if (!conversationState.awaitingPlanConfirmation) {
            resetConversationState();
            conversationState.lastUserPrompt = userPrompt;
            if (projectBriefEl) projectBriefEl.value = userPrompt;
            chatModelHistory.push(chatSystemPrompt, { role: 'user', content: userPrompt });
        } else {
            chatModelHistory.push({ role: 'user', content: userPrompt });
        }
        
        saveActiveSession();
        await processChatter();
    };
    
    const handleCodeModificationForm = async (e) => {
        e.preventDefault();
        const userPrompt = modificationInput.value.trim();
        if (!userPrompt || isLoading) return;
        
        // Validate models first
        if (!validateModels()) {
            addMessageToHistory('error', '🤖 Please select both Chat and Code models from the header controls.');
            return;
        }
        
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

        // Check context status before processing
        if (currentProjectId) {
            await updateContextStatus();
            
            // Handle context compression based on mode
            if (contextStatus && contextStatus.should_compress) {
                if (contextMode === 'automatic') {
                    // Auto-compress silently
                    await compressContext();
                } else if (contextMode === 'manual' || contextMode === 'hybrid') {
                    // Show warning and wait for user action
                    showContextWarning(contextStatus);
                    setLoading(false);
                    return; // Wait for user to handle context
                }
            }
        }

        // Create progress indicator with streaming
        const progressMessage = addProgressMessage('🤖 AI Processing:', 'Connecting to model...', true);
        let streamedContent = '';
        
        try {
            currentStreamController = new AbortController();
            
            const response = await fetchFromProxy('/api/chat', 'POST', {
                model: chatModel,
                messages: chatModelHistory,
                stream: true
            }, true);

            updateProgressMessage(progressMessage, '💭 AI Thinking:', 'Streaming response...');
            
            const fullResponse = await handleStreamingResponse(
                response,
                (token, fullContent) => {
                    streamedContent = fullContent;
                    const progress = Math.min((fullContent.length / 500) * 50, 50); // Progress up to 50%
                    updateProgressMessage(progressMessage, '💭 AI Streaming:', 
                        `Generated ${fullContent.length} characters...`, progress);
                },
                (finalContent) => {
                    updateProgressMessage(progressMessage, '📝 Analyzing:', 'Processing response...', 75);
                },
                (error) => {
                    console.error('Streaming error:', error);
                    updateProgressMessage(progressMessage, '❌ Error:', error.message);
                }
            );
            
            chatModelHistory.push({ role: 'assistant', content: fullResponse });
            
            let chatResponse = tryParsePMJson(fullResponse);
            if (!chatResponse) {
                updateProgressMessage(progressMessage, '🔧 Repairing:', 'Fixing response format...');
                chatResponse = await repairJsonResponse(chatModel, fullResponse);
            }
            
            if (!chatResponse) {
                completeProgressMessage(progressMessage, '❌ Error:', 'Invalid response format received.');
                throw new Error("Invalid response format. Please try again.");
            }

            completeProgressMessage(progressMessage, '✅ Complete:', 'Response processed successfully!');

            // Handle different response types
            if (chatResponse.plan) {
                await handlePlanResponse(chatResponse);
            } else if (chatResponse.PROCEED_TO_CODE) {
                await handleCodeGeneration(chatResponse, chatModel, codeModel);
            } else if (chatResponse.modification_instruction) {
                await handleCodeModification(chatResponse, codeModel);
            }

        } catch (error) {
            console.error("Error during chat processing:", error);
            completeProgressMessage(progressMessage, '❌ Error:', error.message);
            addMessageToHistory('error', error.message);
        } finally {
            currentStreamController = null;
            saveActiveSession();
            setLoading(false);
            
            // Update context status after processing
            if (currentProjectId) {
                await updateContextStatus();
            }
        }
    };

    const handlePlanResponse = async (chatResponse) => {
        addMessageToHistory('model', chatResponse.response_for_user || '📋 Project plan ready! Review and confirm to proceed with code generation.');
        speak(chatResponse.response_for_user);
        conversationState.currentPlan = chatResponse.plan;
        conversationState.awaitingPlanConfirmation = true;
        
        if (chatResponse.manifest) {
            conversationState.currentManifest = chatResponse.manifest;
            if (manifestJsonEl) manifestJsonEl.value = JSON.stringify(chatResponse.manifest, null, 2);
        }
    };

    const handleCodeGeneration = async (chatResponse, chatModel, codeModel) => {
        conversationState.awaitingPlanConfirmation = false;
        
        // Auto-initialize project if not exists
        if (!currentProjectId && conversationState.lastUserPrompt) {
            const initProgress = addProgressMessage('🗂️ Initializing:', 'Creating project workspace...', true);
            await enhancedInitializeProject();
            completeProgressMessage(initProgress, '✅ Project Ready:', 'Workspace created successfully!');
        }
        
        // Generate all files from manifest
        if (conversationState.currentManifest && conversationState.currentManifest.files) {
            const files = conversationState.currentManifest.files;
            const genProgress = addProgressMessage('🚀 Generating:', `Creating ${files.length} project files...`, true);
            
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const progress = ((i + 1) / files.length) * 100;
                updateProgressMessage(genProgress, `📝 File ${i+1}/${files.length}:`, 
                    `Generating ${file.path}...`, progress);
                
                try {
                    const r = await postJSON('/api/project/generate', {
                        projectId: currentProjectId,
                        path: file.path,
                        chat_model: chatModel,
                        code_model: codeModel
                    });
                    
                    if (r.ok) {
                        // Show main entry file in code view
                        if (file.path === 'index.html') {
                            updateCodePanels(r.content);
                        }
                        
                        // Update context status if provided
                        if (r.context_status) {
                            contextStatus = r.context_status;
                            renderContextStatus(contextStatus);
                        }
                    }
                } catch (err) {
                    console.error(`Failed to generate ${file.path}:`, err);
                }
                
                // Small delay to show progress
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            completeProgressMessage(genProgress, '✅ Complete:', `Generated ${files.length} files successfully!`);
            addMessageToHistory('model', chatResponse.response_for_user || '🎮 Multi-file project generated! Check the Preview tab and Files tab to explore your game.');
            
            // Refresh UI
            await refreshFileTree();
            await refreshAssetGrid();
            await updateContextStatus();
            updatePreviewFrame();
            
            // Auto-switch to preview tab
            switchTab('preview');
        }
    };

    const handleCodeModification = async (chatResponse, codeModel) => {
        const modProgress = addProgressMessage('🔧 Modifying:', 'Applying requested changes...', true);
        addMessageToHistory('model', chatResponse.response_for_user || '🔄 Modifying code based on your request...');
        speak(chatResponse.response_for_user);
        
        // If specific files are mentioned, modify those
        const targetFiles = chatResponse.target_files || ['index.html'];
        
        for (let i = 0; i < targetFiles.length; i++) {
            const targetFile = targetFiles[i];
            const progress = ((i + 1) / targetFiles.length) * 100;
            updateProgressMessage(modProgress, `🔧 Modifying ${i+1}/${targetFiles.length}:`, 
                `Updating ${targetFile}...`, progress);
            
            try {
                const r = await postJSON('/api/project/generate', {
                    projectId: currentProjectId,
                    path: targetFile,
                    chat_model: chatModelSelect.value,
                    code_model: codeModel
                });
                
                if (r.ok && targetFile === 'index.html') {
                    updateCodePanels(r.content);
                }
                
                // Update context status if provided
                if (r.context_status) {
                    contextStatus = r.context_status;
                    renderContextStatus(contextStatus);
                }
            } catch (err) {
                console.error(`Failed to modify ${targetFile}:`, err);
            }
        }
        
        completeProgressMessage(modProgress, '✅ Modified:', 'Code updated successfully!');
        
        // Refresh preview and UI
        updatePreviewFrame();
        
        if (currentProjectId) {
            await refreshFileTree();
            await updateContextStatus();
        }
    };

    const repairJsonResponse = async (chatModel, rawContent) => {
        try {
            const schemaHint = `Output ONLY valid JSON matching one of these structures:
1) {"response_for_user": "...", "plan": "...", "manifest": {"files":[{"path":"index.html","intent":"..."}]}}
2) {"PROCEED_TO_CODE": true, "response_for_user": "..."}
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

    const updateCodePanels = (code) => {
        conversationState.currentCode = (code && code.trim() !== '') ? code : null;
        
        if (conversationState.currentCode) {
            if (codePlaceholder) codePlaceholder.style.display = 'none';
            if (previewPlaceholder) previewPlaceholder.style.display = 'none';
            codeBlock.textContent = conversationState.currentCode;
            
            updatePreviewFrame();
            
            if (modificationArea) modificationArea.style.display = 'block';
        } else {
            if (codePlaceholder) codePlaceholder.style.display = 'flex';
            if (previewPlaceholder) previewPlaceholder.style.display = 'flex';
            codeBlock.textContent = '';
            previewFrame.src = '';
            previewFrame.srcdoc = '';
            if (modificationArea) modificationArea.style.display = 'none';
        }
        saveActiveSession();
    };

    const setLoading = (state) => {
        isLoading = state;
        sendButton.disabled = state;
        if (modificationSendButton) modificationSendButton.disabled = state;
        sendButton.style.opacity = state ? 0.5 : 1.0;
        if (modificationSendButton) modificationSendButton.style.opacity = state ? 0.5 : 1.0;
        
        // Update cursor for all interactive elements
        const interactiveElements = [sendButton, modificationSendButton, generateSelectedBtn, uploadAssetsBtn];
        interactiveElements.forEach(el => {
            if (el) {
                el.style.cursor = state ? 'wait' : 'pointer';
            }
        });
    };

    const switchTab = (targetTabId) => {
        tabs.forEach(tab => tab.classList.toggle('active', tab.id === `${targetTabId}-tab`));
        tabContents.forEach(content => content.classList.toggle('active-content', content.id === `${targetTabId}-view`));
        
        // Perform tab-specific actions
        switch(targetTabId) {
            case 'assets':
                if (currentProjectId) {
                    refreshAssetGrid();
                }
                break;
            case 'files':
                if (currentProjectId) {
                    refreshFileTree();
                    updateContextStatus();
                }
                break;
            case 'preview':
                updatePreviewFrame();
                break;
            case 'code':
                // Refresh syntax highlighting if needed
                if (codeBlock.textContent) {
                    // Trigger any syntax highlighting
                }
                break;
            case 'settings':
                // Refresh models list
                fetchOllamaModels();
                break;
        }
        
        // Save current tab preference
        localStorage.setItem('studio42_last_tab', targetTabId);
    };

    const copyCodeToClipboard = () => {
        if (navigator.clipboard && codeBlock.textContent) {
            navigator.clipboard.writeText(codeBlock.textContent).then(() => {
                copyCodeBtn.textContent = 'Copied!';
                setTimeout(() => { copyCodeBtn.textContent = 'Copy Code'; }, 2000);
            });
        }
    };
    
    const autoResizeTextarea = (el) => {
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    };

    // ENHANCED: Settings Panel Logic
    const showStatusMessage = (element, message, type = 'info', duration = 4000) => {
        if (!element) return; // Safety check
        element.textContent = message;
        element.className = `status-message ${type}`;
        setTimeout(() => { 
            element.textContent = ''; 
            element.className = 'status-message'; 
        }, duration);
    };

    // ENHANCED: Project API Integration with Context Management
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
        const { manifest, files, context_status } = data || {};
        fileTreeEl.innerHTML = '';
        
        // Update context status if provided
        if (context_status) {
            contextStatus = context_status;
            renderContextStatus(context_status);
        }
        
        if (!files || files.length === 0) {
            fileTreeEl.innerHTML = '<em>No files found. Initialize a project to get started.</em>';
            return;
        }
        
        // Update file count
        const fileCountEl = document.getElementById('file-count');
        if (fileCountEl) {
            fileCountEl.textContent = `${files.length} files`;
        }
        
        const ul = document.createElement('ul');
        ul.className = 'file-tree-list';
        
        // Group files by directory
        const grouped = {};
        files.forEach(file => {
            const parts = file.path.split('/');
            let current = grouped;
            
            for (let i = 0; i < parts.length - 1; i++) {
                if (!current[parts[i]]) {
                    current[parts[i]] = {};
                }
                current = current[parts[i]];
            }
            
            current[parts[parts.length - 1]] = file;
        });
        
        const renderTreeNode = (node, container, level = 0) => {
            Object.keys(node).sort().forEach(key => {
                const item = node[key];
                const li = document.createElement('li');
                li.className = 'tree-item';
                li.style.paddingLeft = `${level * 20}px`;
                
                if (item.path) {
                    // File
                    li.innerHTML = `
                        <span class="file-icon ${item.category}">${getFileIcon(item.category)}</span>
                        <span class="file-name">${key}</span>
                        <span class="file-size">${formatBytes(item.size)}</span>
                    `;
                    li.addEventListener('click', () => {
                        _selectedPath = item.path;
                        [...fileTreeEl.querySelectorAll('.tree-item')].forEach(n => 
                            n.classList.remove('selected')
                        );
                        li.classList.add('selected');
                    });
                } else {
                    // Directory
                    li.innerHTML = `
                        <span class="folder-icon">📁</span>
                        <span class="folder-name">${key}</span>
                    `;
                    li.classList.add('folder');
                }
                
                container.appendChild(li);
                
                if (!item.path) {
                    // Render subdirectories
                    renderTreeNode(item, container, level + 1);
                }
            });
        };
        
        renderTreeNode(grouped, ul);
        fileTreeEl.appendChild(ul);
    };

    const getFileIcon = (category) => {
        const icons = {
            'image': '🖼️',
            'audio': '🔊',
            'font': '🔤',
            'data': '📊',
            'code': '📄',
            'other': '📄'
        };
        return icons[category] || '📄';
    };

    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    const refreshFileTree = async () => {
        if (!currentProjectId) {
            fileTreeEl.innerHTML = '<em>No project initialized.</em>';
            return;
        }
        
        try {
            const data = await getJSON(`/api/project/tree?projectId=${encodeURIComponent(currentProjectId)}`);
            renderTree(data);
        } catch (error) {
            console.error('Failed to refresh file tree:', error);
            fileTreeEl.innerHTML = '<em>Error loading file tree.</em>';
        }
    };

    // ENHANCED: Asset Management Functions
    const refreshAssetGrid = async () => {
        if (!currentProjectId) {
            assetsGrid.innerHTML = '<div class="no-assets"><div class="upload-prompt"><h3>No Project Loaded</h3><p>Create a project first to manage assets.</p></div></div>';
            return;
        }
        
        try {
            const data = await getJSON(`/api/project/tree?projectId=${encodeURIComponent(currentProjectId)}`);
            renderAssetGrid(data);
        } catch (error) {
            console.error('Failed to refresh assets:', error);
            assetsGrid.innerHTML = '<div class="no-assets"><div class="upload-prompt"><h3>Error Loading Assets</h3><p>Please try refreshing the page.</p></div></div>';
        }
    };

    const renderAssetGrid = (data) => {
        const assets = data.files?.filter(f => f.type === 'asset') || [];
        
        // Update asset stats
        const totalAssetsEl = document.getElementById('total-assets');
        const totalSizeEl = document.getElementById('total-size');
        const assetTypesEl = document.getElementById('asset-types');
        
        if (totalAssetsEl) totalAssetsEl.textContent = assets.length;
        if (totalSizeEl) totalSizeEl.textContent = formatBytes(assets.reduce((sum, asset) => sum + asset.size, 0));
        if (assetTypesEl) {
            const types = new Set(assets.map(asset => asset.category));
            assetTypesEl.textContent = types.size;
        }
        
        if (assets.length === 0) {
            assetsGrid.innerHTML = `
                <div class="no-assets">
                    <div class="upload-prompt">
                        <div class="upload-icon">📁</div>
                        <h3>Asset Library Empty</h3>
                        <p>Upload images, sounds, fonts, and data files for your game</p>
                        <button class="upload-btn" onclick="document.getElementById('asset-upload').click()">
                            ⬆️ Upload Your First Assets
                        </button>
                        <div class="supported-formats">
                            <strong>Supported:</strong> PNG, JPG, SVG, MP3, WAV, TTF, JSON, CSV
                        </div>
                    </div>
                </div>
            `;
            return;
        }
        
        assetsGrid.innerHTML = '';
        
        // Group assets by category
        const grouped = {};
        assets.forEach(asset => {
            if (!grouped[asset.category]) {
                grouped[asset.category] = [];
            }
            grouped[asset.category].push(asset);
        });
        
        Object.keys(grouped).sort().forEach(category => {
            const categorySection = document.createElement('div');
            categorySection.className = 'asset-category';
            categorySection.innerHTML = `
                <h4 class="category-title">${category.toUpperCase()}</h4>
                <div class="asset-items"></div>
            `;
            
            const itemsContainer = categorySection.querySelector('.asset-items');
            
            grouped[category].forEach(asset => {
                const assetItem = document.createElement('div');
                assetItem.className = 'asset-item';
                assetItem.innerHTML = `
                    <div class="asset-thumbnail">
                        ${renderAssetThumbnail(asset)}
                    </div>
                    <div class="asset-info">
                        <div class="asset-name" title="${asset.path}">${asset.path.split('/').pop()}</div>
                        <div class="asset-size">${formatBytes(asset.size)}</div>
                    </div>
                    <div class="asset-actions">
                        <button class="asset-action" onclick="copyAssetPath('${asset.path}')" title="Copy path">📋</button>
                        <button class="asset-action delete" onclick="deleteAsset('${asset.path}')" title="Delete">🗑️</button>
                    </div>
                `;
                
                assetItem.addEventListener('click', () => {
                    _selectedAsset = asset;
                    [...assetsGrid.querySelectorAll('.asset-item')].forEach(n => 
                        n.classList.remove('selected')
                    );
                    assetItem.classList.add('selected');
                });
                
                itemsContainer.appendChild(assetItem);
            });
            
            assetsGrid.appendChild(categorySection);
        });
    };

    const renderAssetThumbnail = (asset) => {
        if (asset.category === 'image') {
            return `<img src="/api/project/asset/${currentProjectId}/${asset.path}" alt="${asset.path}" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" loading="lazy">
                    <div class="asset-icon" style="display:none;">🖼️</div>`;
        } else {
            const icons = {
                'audio': '🔊',
                'font': '🔤',
                'data': '📊',
                'other': '📄'
            };
            return `<div class="asset-icon">${icons[asset.category] || '📄'}</div>`;
        }
    };

    // Global functions for asset management
    window.copyAssetPath = (assetPath) => {
        navigator.clipboard.writeText(assetPath).then(() => {
            addMessageToHistory('system', `📋 Asset path copied: ${assetPath}`);
        }).catch(() => {
            addMessageToHistory('error', '❌ Failed to copy asset path');
        });
    };

    window.deleteAsset = async (assetPath) => {
        if (!confirm(`Delete ${assetPath}?`)) return;
        
        try {
            const result = await postJSON('/api/project/delete-asset', {
                projectId: currentProjectId,
                path: assetPath
            });
            
            if (result.success) {
                addMessageToHistory('system', `🗑️ Asset deleted: ${assetPath}`);
                refreshAssetGrid();
                refreshFileTree();
                updatePreviewFrame(); // Refresh preview in case asset was being used
            } else {
                addMessageToHistory('error', '❌ Failed to delete asset');
            }
        } catch (error) {
            console.error('Failed to delete asset:', error);
            addMessageToHistory('error', '❌ Failed to delete asset: ' + error.message);
        }
    };

    // ENHANCED: Asset Upload with Better User Feedback
    const handleAssetUpload = async (files) => {
        if (!currentProjectId) {
            addMessageToHistory('error', '⚠️ Please initialize a project first before uploading assets.');
            // Auto-focus project name input
            if (projectNameInput) {
                switchTab('files');
                projectNameInput.focus();
                projectNameInput.style.borderColor = 'var(--color-warning)';
                setTimeout(() => {
                    projectNameInput.style.borderColor = '';
                }, 3000);
            }
            return;
        }
        
        // Validate file types
        const supportedTypes = [
            'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/svg+xml', 'image/webp',
            'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4',
            'font/ttf', 'font/woff', 'font/woff2', 'application/font-woff',
            'application/json', 'text/csv', 'application/xml'
        ];
        
        const invalidFiles = Array.from(files).filter(file => 
            !supportedTypes.includes(file.type) && 
            !file.name.match(/\.(ttf|woff|woff2|otf)$/i)
        );
        
        if (invalidFiles.length > 0) {
            addMessageToHistory('error', `❌ Unsupported file types: ${invalidFiles.map(f => f.name).join(', ')}\n\n📋 **Supported formats:**\n• Images: PNG, JPG, SVG, WebP\n• Audio: MP3, WAV, OGG\n• Fonts: TTF, WOFF, WOFF2\n• Data: JSON, CSV, XML`);
            return;
        }
        
        const formData = new FormData();
        formData.append('projectId', currentProjectId);
        
        Array.from(files).forEach(file => {
            formData.append('files', file);
        });
        
        const uploadProgress = addProgressMessage('📤 Uploading:', `Processing ${files.length} asset(s)...`, true);
        
        try {
            updateProgressMessage(uploadProgress, '📤 Uploading:', 'Transferring files...', 25);
            
            const response = await fetch('/api/project/upload-asset', {
                method: 'POST',
                body: formData
            });
            
            updateProgressMessage(uploadProgress, '📄 Processing:', 'Organizing assets...', 75);
            
            const result = await response.json();
            
            if (result.success) {
                updateProgressMessage(uploadProgress, '✅ Uploaded:', 
                    `Successfully processed ${result.uploaded.length} asset(s)`, 100);
                
                setTimeout(() => {
                    completeProgressMessage(uploadProgress, '✅ Complete:', 'Assets ready to use!');
                }, 1000);
                
                // Show detailed upload results
                const assetList = result.uploaded.map(asset => 
                    `• ${asset.name} (${asset.category}) - ${formatBytes(asset.size)}`
                ).join('\n');
                
                addMessageToHistory('model', `📁 **Assets Uploaded Successfully:**\n\n${assetList}\n\n🎨 **Assets are now available for code generation!**\nThe AI will automatically reference these assets when creating your game.`);
                
                await refreshAssetGrid();
                await refreshFileTree();
                await updateContextStatus(); // Asset uploads affect context
                updatePreviewFrame(); // Refresh preview with new assets
                
                // Auto-switch to assets tab to show results
                switchTab('assets');
                
            } else {
                completeProgressMessage(uploadProgress, '❌ Error:', result.error || 'Upload failed');
                addMessageToHistory('error', result.error || 'Upload failed');
            }
        } catch (error) {
            console.error('Upload failed:', error);
            completeProgressMessage(uploadProgress, '❌ Error:', error.message);
            addMessageToHistory('error', `Upload failed: ${error.message}`);
        }
    };

    // ENHANCED: Project Initialization
    const enhancedInitializeProject = async () => {
        const brief = projectBriefEl?.value?.trim() || conversationState.lastUserPrompt || '';
        const name = projectNameInput?.value?.trim() || 'Phaser Game Project';
        
        if (!chatModelSelect?.value || !codeModelSelect?.value) {
            addMessageToHistory('error', 'Please select both Chat and Code models.');
            return;
        }

        // Show initialization progress
        const initProgress = addProgressMessage('🗂️ Initializing:', 'Setting up project workspace...', true);
        
        try {
            updateProgressMessage(initProgress, '📁 Creating:', 'Project structure...', 25);
            
            const r = await postJSON('/api/project/init', {
                name, 
                brief,
                chat_model: chatModelSelect.value,
                code_model: codeModelSelect.value,
                context_mode: contextMode
            });
            
            if (r.projectId) {
                currentProjectId = r.projectId;
                contextMode = r.context_mode || 'automatic';
                
                updateProgressMessage(initProgress, '⚙️ Configuring:', 'Context management...', 50);
                
                // Save plan and manifest if available
                if (conversationState.currentPlan && conversationState.currentManifest) {
                    updateProgressMessage(initProgress, '📋 Saving:', 'Project plan and manifest...', 75);
                    
                    await postJSON('/api/project/manifest', {
                        projectId: currentProjectId,
                        plan: conversationState.currentPlan,
                        manifest: conversationState.currentManifest
                    });
                }
                
                updateProgressMessage(initProgress, '🔄 Refreshing:', 'UI components...', 90);
                
                // Update UI components
                await refreshFileTree();
                await refreshAssetGrid();
                await updateContextStatus();
                updatePreviewFrame(); // Add preview frame update
                saveActiveSession();
                
                completeProgressMessage(initProgress, '✅ Complete:', `Project "${name}" ready!`);
                addMessageToHistory('model', `✅ Multi-file project initialized: ${currentProjectId}\n\n🎯 **Next Steps:**\n• Upload game assets in the Asset Library tab\n• Generate code using the Files tab\n• Test your game in the Visual Simulation tab`);
                
                // Auto-switch to files tab to show the structure
                switchTab('files');
                
            } else {
                completeProgressMessage(initProgress, '❌ Error:', 'Project initialization failed.');
                addMessageToHistory('error', 'Project initialization failed.');
            }
        } catch (error) {
            completeProgressMessage(initProgress, '❌ Error:', error.message);
            addMessageToHistory('error', `Initialization failed: ${error.message}`);
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
        updateContextStatus(); // File saves affect context
    };

    // Event Listeners - Enhanced with Context Management
    newChatBtn.addEventListener('click', handleNewChat);
    chatForm.addEventListener('submit', handleSendMessage);
    if (modificationForm) modificationForm.addEventListener('submit', handleCodeModificationForm);

    chatInput.addEventListener('input', () => autoResizeTextarea(chatInput));
    if (modificationInput) modificationInput.addEventListener('input', () => autoResizeTextarea(modificationInput));

    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { 
            e.preventDefault(); 
            handleSendMessage(e); 
        }
    });
    
    if (modificationInput) {
        modificationInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { 
                e.preventDefault(); 
                handleCodeModificationForm(e); 
            }
        });
    }

    refreshModelsBtn.addEventListener('click', fetchOllamaModels);
    copyCodeBtn.addEventListener('click', copyCodeToClipboard);
    
    if (refreshPreviewBtn) {
        refreshPreviewBtn.addEventListener('click', () => {
            updatePreviewFrame();
            addMessageToHistory('system', '🔄 Preview refreshed');
        });
    }
    
    // Tab switching
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetId = tab.id.replace('-tab', '');
            switchTab(targetId);
        });
    });

    // Context mode selector
    if (contextModeSelect) {
        contextModeSelect.addEventListener('change', (e) => {
            setContextMode(e.target.value);
        });
    }

    // Context management buttons
    if (contextDetailsBtn) {
        contextDetailsBtn.addEventListener('click', showCompressionPlan);
    }

    if (compressContextBtn) {
        compressContextBtn.addEventListener('click', () => compressContext());
    }

    if (contextPlanBtn) {
        contextPlanBtn.addEventListener('click', showCompressionPlan);
    }

    // Project Management Event Listeners
    if (initProjectBtn) {
        initProjectBtn.addEventListener('click', enhancedInitializeProject);
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
                updateContextStatus();
            } else {
                addMessageToHistory('error', 'Failed saving manifest.');
            }
        });
    }

    // ENHANCED: Generate Selected Button with Better Error Handling
    if (generateSelectedBtn) {
        generateSelectedBtn.addEventListener('click', async () => {
            if (!currentProjectId) {
                addMessageToHistory('error', '🚨 Create a project first.');
                // Guide user to create project
                switchTab('files');
                if (projectNameInput) {
                    projectNameInput.focus();
                    projectNameInput.style.borderColor = 'var(--color-warning)';
                    setTimeout(() => projectNameInput.style.borderColor = '', 3000);
                }
                return;
            }
            if (!_selectedPath) {
                addMessageToHistory('error', '📁 Select a file to generate from the file tree.');
                return;
            }
            
            // Check if models are selected
            if (!chatModelSelect.value || !codeModelSelect.value) {
                addMessageToHistory('error', '🤖 Please select both Chat and Code models in the header.');
                return;
            }
            
            const genProgress = addProgressMessage('🔨 Generating:', `Creating ${_selectedPath}...`, true);
            
            // Add timeout warning after 30 seconds
            const timeoutWarning = setTimeout(() => {
                updateProgressMessage(genProgress, '⏳ Still Processing:', 
                    'Large models can take 2-3 minutes. Please wait...', 50);
                addMessageToHistory('system', '⏱️ **Generation is taking longer than usual.** This can happen with:\n• Large language models (13B+)\n• Complex file requests\n• High system load\n\n💡 **Tips to speed up generation:**\n• Use smaller models like `codellama:7b`\n• Simplify the file description\n• Check system resources');
            }, 30000);
            
            try {
                const startTime = Date.now();
                
                const r = await postJSON('/api/project/generate', {
                    projectId: currentProjectId,
                    path: _selectedPath,
                    chat_model: chatModelSelect.value,
                    code_model: codeModelSelect.value
                });
                
                clearTimeout(timeoutWarning);
                const duration = ((Date.now() - startTime) / 1000).toFixed(1);
                
                if (r.ok) {
                    completeProgressMessage(genProgress, '✅ Generated:', 
                        `${r.path} created in ${duration}s`);
                    addMessageToHistory('model', `✅ **Generated: ${r.path}** (${duration}s)\n\n📊 **File Stats:**\n• Size: ${r.content ? (r.content.length / 1000).toFixed(1) : '?'}KB\n• Type: ${r.category || 'code'}\n• Hash: ${r.hash ? r.hash.substring(0, 8) : 'N/A'}...`);
                    
                    await saveToProject(r.path, r.content);
                    refreshFileTree();
                    updateCodePanels(r.content);
                    updateContextStatus();
                    updatePreviewFrame();
                    switchTab('code');
                } else {
                    clearTimeout(timeoutWarning);
                    const errorMsg = r.error || 'Generation failed';
                    completeProgressMessage(genProgress, '❌ Error:', errorMsg);
                    
                    // Provide helpful error messages with solutions
                    let helpfulMessage = `❌ **Generation Failed:** ${errorMsg}\n\n`;
                    
                    if (errorMsg.includes('timeout') || errorMsg.includes('timed out')) {
                        helpfulMessage += `⏱️ **Timeout Issue - Try these solutions:**\n• Switch to a faster model (e.g., \`codellama:7b\`)\n• Simplify the file request\n• Check if Ollama is overloaded\n• Restart Ollama if needed\n\n💡 **Model Speed Guide:**\n• Fast: \`codellama:7b\`, \`deepseek-coder:6.7b\`\n• Medium: \`codellama:13b\`, \`llama3:8b\`\n• Slow: \`codellama:34b\`, \`llama3:70b\``;
                    } else if (errorMsg.includes('connection') || errorMsg.includes('connect')) {
                        helpfulMessage += `🔌 **Connection Issue - Check:**\n• Ollama is running (\`ollama serve\`)\n• Available at http://localhost:11434\n• No firewall blocking the connection\n• Try restarting Ollama service`;
                    } else if (errorMsg.includes('model') || errorMsg.includes('not found')) {
                        helpfulMessage += `🤖 **Model Issue - Try:**\n• Pull the model: \`ollama pull ${codeModelSelect.value}\`\n• Check model availability in Ollama Control\n• Switch to a different model`;
                    } else {
                        helpfulMessage += `🛠️ **General Troubleshooting:**\n• Check system resources (RAM/CPU)\n• Try a smaller model\n• Simplify the generation request\n• Restart Studio42 Enhanced`;
                    }
                    
                    addMessageToHistory('error', helpfulMessage);
                }
            } catch (error) {
                clearTimeout(timeoutWarning);
                console.error('Generation error:', error);
                completeProgressMessage(genProgress, '❌ Error:', error.message);
                
                let errorMessage = `❌ **Unexpected Error:** ${error.message}\n\n`;
                
                if (error.message.includes('Failed to fetch')) {
                    errorMessage += `🔌 **Network Error - Check:**\n• Studio42 server is running\n• No proxy blocking requests\n• Browser network connectivity`;
                } else {
                    errorMessage += `🛠️ **Try these steps:**\n• Refresh the page\n• Restart Studio42 Enhanced\n• Check browser console for details`;
                }
                
                addMessageToHistory('error', errorMessage);
            }
        });
    }

    if (summarizeToggle) {
        summarizeToggle.addEventListener('click', () => {
            summarizeOnSave = !summarizeOnSave;
            summarizeToggle.textContent = summarizeOnSave ? '📝 Auto-Summarize' : '❌ No Summaries';
            summarizeToggle.classList.toggle('active', summarizeOnSave);
        });
    }

    // Asset Management Event Listeners
    if (assetUpload) {
        assetUpload.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleAssetUpload(e.target.files);
                e.target.value = ''; // Reset input
            }
        });
    }

    if (uploadAssetsBtn) {
        uploadAssetsBtn.addEventListener('click', () => {
            assetUpload.click();
        });
    }

    if (assetSearch) {
        assetSearch.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const assetItems = assetsGrid.querySelectorAll('.asset-item');
            
            assetItems.forEach(item => {
                const assetName = item.querySelector('.asset-name').textContent.toLowerCase();
                item.style.display = assetName.includes(searchTerm) ? 'block' : 'none';
            });
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

    // Setup enhanced drag and drop
    setupDragAndDrop();

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + N for new chat
        if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
            e.preventDefault();
            handleNewChat();
        }
        
        // Escape to cancel current stream
        if (e.key === 'Escape' && currentStreamController) {
            currentStreamController.abort();
            currentStreamController = null;
            setLoading(false);
            addMessageToHistory('model', '❌ Generation cancelled by user');
        }
        
        // Ctrl/Cmd + J to toggle context details
        if ((e.ctrlKey || e.metaKey) && e.key === 'j' && currentProjectId) {
            e.preventDefault();
            showCompressionPlan();
        }
    });

    // Initial Load - Start everything up!
    fetchOllamaModels();
    handleNewChat(); // Start with a fresh session
    
    // Restore last tab preference
    const lastTab = localStorage.getItem('studio42_last_tab');
    if (lastTab && document.getElementById(`${lastTab}-tab`)) {
        switchTab(lastTab);
    }
    
    // Show welcome message with enhanced instructions
    setTimeout(() => {
        if (chatModelHistory.length === 0) {
            addMessageToHistory('model', `
                🚀 <strong>Studio42 Enhanced - Ready!</strong><br><br>
                ✨ <strong>New Features:</strong><br>
                • Multi-file Phaser project generation<br>
                • Real-time streaming responses<br>
                • Asset upload & management<br>
                • Adaptive context management (Auto/Manual/Hybrid)<br>
                • Enhanced progress indicators<br>
                • Live game preview system<br><br>
                🧠 <strong>Context Management:</strong><br>
                • <strong>Automatic</strong>: AI handles context compression automatically<br>
                • <strong>Manual</strong>: Full control over what gets compressed<br>
                • <strong>Hybrid</strong>: Smart defaults with approval prompts<br><br>
                💡 <strong>Try saying:</strong><br>
                "Create a platformer game with a jumping character"<br>
                "Make a space shooter with power-ups"<br>
                "Build a puzzle game with moving blocks"<br><br>
                🎯 <strong>Pro Tips:</strong><br>
                • Upload assets before generating code for better integration<br>
                • Use Ctrl+J to view context compression details<br>
                • Switch modes anytime in project settings<br>
                • Preview your games in real-time with the Visual Simulation tab
            `);
        }
    }, 1000);
});