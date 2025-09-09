document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Element Cache ---
    const dom = {
        chatModelSelect: document.getElementById('chat-model-select'),
        codeModelSelect: document.getElementById('code-model-select'),
        refreshModelsBtn: document.getElementById('refresh-models-btn'),
        newProjectNameInput: document.getElementById('new-project-name'),
        newProjectBtn: document.getElementById('new-project-btn'),
        projectList: document.getElementById('project-list'),
        exampleList: document.getElementById('example-list'),
        chatHistory: document.getElementById('chat-history'),
        welcomeMessage: document.getElementById('welcome-message'),
        chatForm: document.getElementById('chat-form'),
        chatInput: document.getElementById('chat-input'),
        sendButton: document.getElementById('send-button'),
        fileTree: document.getElementById('file-tree'),
        editorTabs: document.getElementById('editor-tabs'),
        editorContent: document.getElementById('editor-content'),
        editorPlaceholder: document.getElementById('editor-placeholder'),
        previewFrame: document.getElementById('preview-frame'),
        previewPlaceholder: document.getElementById('preview-placeholder'),
        refreshPreviewBtn: document.getElementById('refresh-preview-btn'),
        assetUploadInput: document.getElementById('asset-upload-input'),
        assetUploadBtn: document.getElementById('asset-upload-btn'),
        assetBrowser: document.getElementById('asset-browser'),
        // Ollama Settings
        pullModelForm: document.getElementById('pull-model-form'),
        pullModelName: document.getElementById('pull-model-name'),
        pullStatus: document.getElementById('pull-status'),
        createModelForm: document.getElementById('create-model-form'),
        createModelName: document.getElementById('create-model-name'),
        createModelfile: document.getElementById('create-modelfile'),
        createStatus: document.getElementById('create-status'),
        deleteModelForm: document.getElementById('delete-model-form'),
        deleteModelSelect: document.getElementById('delete-model-select'),
        deleteStatus: document.getElementById('delete-status'),
    };

    // --- Application State ---
    const state = {
        isLoading: false,
        activeProject: null,
        chatHistory: [],
        openFiles: new Map(), // path -> { content, editorEl, tabEl }
        activeFile: null,
        assets: [],
        markdownConverter: new showdown.Converter({ tables: true, strikethrough: true, tasklists: true }),
    };

    // --- System Prompt ---
    const CHAT_SYSTEM_PROMPT = `You are a master game developer AI. Your purpose is to create a Phaser 3 game based on user requests.
You must generate all necessary files within a structured project. The project has predefined folders: '/js', '/css', and '/assets'.
- All JavaScript code MUST go in the '/js' folder.
- All CSS code MUST go in the '/css' folder.
- You will be given a list of available images in the '/assets' folder. Use them by their filename (e.g., 'my_image.png'). The path in the code should be 'assets/my_image.png'.

**CRITICAL RULES FOR 'index.html':**
1.  It MUST link to 'phaser.min.js', which is located in the project's root directory.
2.  The '<script src="phaser.min.js"></script>' tag MUST come BEFORE any other game script tags.
3.  ALL '<script>' and '<link rel="stylesheet">' tags MUST be placed correctly (scripts before '</body>', links in '<head>').

**Your response MUST be a single JSON object with two keys:**
1.  "response_for_user": A friendly, conversational message for the user, formatted in Markdown. Explain what you've done.
2.  "file_operations": An array of objects, where each object represents a file to be created or updated. Each object must have three keys:
    - "operation": Either "CREATE" or "UPDATE".
    - "path": The full path of the file from the project root (e.g., "index.html", "js/main.js").
    - "content": A string containing the complete code/content for that file.`;

    // --- API Service ---
    const api = {
        async proxy(path, method, body) {
            const response = await fetch('/api/proxy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, method, body }),
            });
            // For chat, we get raw text to handle potential JSON errors
            if (path === '/api/chat') {
                const text = await response.text();
                if (!response.ok) throw new Error(text);
                return text;
            }
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || `Server error: ${response.status}`);
            return data;
        },
        getProjects: () => fetch('/api/projects').then(res => res.json()),
        createProject: (project_id) => fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id }) }).then(res => res.json()),
        getProjectTree: (project_id) => fetch(`/api/projects/${project_id}`).then(res => res.json()),
        getFile: (project_id, path) => fetch(`/api/projects/${project_id}/file?path=${encodeURIComponent(path)}`).then(res => res.json()),
        saveFile: (project_id, path, content) => fetch(`/api/projects/${project_id}/file`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, content }) }).then(res => res.json()),
        getExamples: () => fetch('/api/examples').then(res => res.json()),
        getAssets: () => fetch('/api/assets').then(res => res.json()),
        uploadAsset: (formData) => fetch('/api/assets', { method: 'POST', body: formData }).then(res => res.json()),
    };
    
    // --- UI Rendering & Actions ---
    const render = {
        projects: (projects) => { dom.projectList.innerHTML = projects.map(p => `<div class="sidebar-item" data-project-id="${p}">${p}</div>`).join('') || `<div class="placeholder-small">No projects.</div>`; },
        examples: (examples) => { dom.exampleList.innerHTML = examples.map(e => `<div class="sidebar-item" data-example-name="${e}">${e}</div>`).join('') || `<div class="placeholder-small">No examples found.</div>`; },
        assets: (assets) => { dom.assetBrowser.innerHTML = assets.map(a => `<div class="sidebar-item" title="${a}">${a}</div>`).join('') || `<div class="placeholder-small">No assets.</div>`; },
        fileTree: (tree, container) => { /* ... (same as previous version) ... */ },
        chatMessage: (role, content) => { /* ... (same as previous version) ... */ },
        editor: () => { /* ... (same as previous version) ... */ },
        preview: () => { /* ... (same as previous version) ... */ },
    };
    // Re-add the full render functions that were omitted for brevity
    render.fileTree = (tree, container) => {
        container.innerHTML = '';
        if (!tree || tree.length === 0) {
            container.innerHTML = `<div class="placeholder-small">[Project is empty]</div>`;
            return;
        }
        tree.forEach(item => {
            if (item.type === 'directory') {
                const dirEl = document.createElement('div');
                dirEl.className = 'dir-item';
                dirEl.innerHTML = `<div class="dir-name"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg> <span>${item.name}</span></div>`;
                const childrenContainer = document.createElement('div');
                childrenContainer.className = 'dir-children';
                dirEl.appendChild(childrenContainer);
                container.appendChild(dirEl);
                if (item.children) render.fileTree(item.children, childrenContainer);
            } else {
                const fileEl = document.createElement('div');
                fileEl.className = 'file-item';
                fileEl.dataset.path = item.path;
                fileEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg> <span>${item.name}</span>`;
                container.appendChild(fileEl);
            }
        });
    };
    render.chatMessage = (role, content) => {
        dom.welcomeMessage.style.display = 'none';
        const msgEl = document.createElement('div');
        msgEl.className = `chat-message ${role}-message`;
        const contentHtml = role === 'model' ? state.markdownConverter.makeHtml(content) : content.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        msgEl.innerHTML = `<div class="message-content">${contentHtml}</div>`;
        dom.chatHistory.appendChild(msgEl);
        dom.chatHistory.scrollTop = dom.chatHistory.scrollHeight;
    };
    render.editor = () => {
        dom.editorTabs.innerHTML = '';
        let hasActive = false;
        state.openFiles.forEach((file, path) => {
            file.tabEl.classList.toggle('active', path === state.activeFile);
            file.editorEl.classList.toggle('active', path === state.activeFile);
            dom.editorTabs.appendChild(file.tabEl);
            if (path === state.activeFile) hasActive = true;
        });
        dom.editorPlaceholder.style.display = hasActive ? 'none' : 'flex';
    };
    render.preview = () => {
        if (state.activeProject) {
            api.getProjectTree(state.activeProject).then(tree => {
                 const hasIndex = tree.some(item => item.name === 'index.html');
                 if (hasIndex) {
                    dom.previewFrame.src = `/projects/${state.activeProject}/index.html?t=${Date.now()}`;
                    dom.previewPlaceholder.style.display = 'none';
                    dom.previewFrame.style.display = 'block';
                 } else {
                    dom.previewPlaceholder.style.display = 'flex';
                    dom.previewFrame.style.display = 'none';
                 }
            });
        } else {
            dom.previewPlaceholder.style.display = 'flex';
            dom.previewFrame.style.display = 'none';
        }
    };


    const actions = {
        setLoading: (isLoading) => { state.isLoading = isLoading; dom.sendButton.disabled = isLoading || !state.activeProject; },
        // ... (actions for projects, files, etc. are the same)
    };
     // Re-add the full actions object that was omitted for brevity
    actions.loadProjects = async () => { render.projects(await api.getProjects()); };
    actions.loadExamples = async () => { render.examples(await api.getExamples()); };
    actions.loadAssets = async () => { state.assets = await api.getAssets(); render.assets(state.assets); };
    actions.setActiveProject = async (projectId) => {
        state.activeProject = projectId;
        state.openFiles.clear();
        state.activeFile = null;
        state.chatHistory = [];
        render.editor();
        document.querySelectorAll('#project-list .sidebar-item').forEach(el => el.classList.toggle('active', el.dataset.projectId === projectId));
        dom.chatHistory.innerHTML = '';
        dom.chatHistory.appendChild(dom.welcomeMessage);
        dom.welcomeMessage.style.display = 'block';
        dom.welcomeMessage.querySelector('p:last-child').textContent = `Project "${projectId}" is active.`;
        dom.chatInput.disabled = false;
        dom.sendButton.disabled = false;
        await actions.refreshFileTree();
        render.preview();
    };
    actions.refreshFileTree = async () => { if (state.activeProject) render.fileTree(await api.getProjectTree(state.activeProject), dom.fileTree); };
    actions.openFile = (path) => {
        if (state.openFiles.has(path)) { actions.setActiveFile(path); return; }
        api.getFile(state.activeProject, path).then(fileData => {
            const tabEl = document.createElement('button');
            tabEl.className = 'editor-tab';
            tabEl.dataset.path = path;
            tabEl.innerHTML = `<span>${path.split('/').pop()}</span><button class="close-tab-btn">×</button>`;
            const editorEl = document.createElement('div');
            editorEl.className = 'code-editor';
            editorEl.dataset.path = path;
            const textArea = document.createElement('textarea');
            textArea.value = fileData.content;
            editorEl.appendChild(textArea);
            dom.editorContent.appendChild(editorEl);
            state.openFiles.set(path, { content: fileData.content, editorEl, tabEl });
            actions.setActiveFile(path);
        });
    };
    actions.setActiveFile = (path) => { state.activeFile = path; render.editor(); };
    actions.closeFile = (path) => {
        const file = state.openFiles.get(path);
        if (!file) return;
        file.tabEl.remove();
        file.editorEl.remove();
        state.openFiles.delete(path);
        if (state.activeFile === path) {
            state.activeFile = state.openFiles.keys().next().value || null;
        }
        render.editor();
    };
    actions.saveActiveFile = () => {
        if (!state.activeFile) return;
        const file = state.openFiles.get(state.activeFile);
        const newContent = file.editorEl.querySelector('textarea').value;
        if (file.content === newContent) return;
        file.content = newContent;
        api.saveFile(state.activeProject, state.activeFile, newContent);
    };
    actions.fetchOllamaModels = async (populateDelete = false) => {
        try {
            const data = await api.proxy('/api/tags', 'GET');
            const models = data.models || [];
            const selects = [dom.chatModelSelect, dom.codeModelSelect];
            if(populateDelete) selects.push(dom.deleteModelSelect);

            selects.forEach(sel => { 
                const currentVal = sel.value;
                sel.innerHTML = sel.id === 'delete-model-select' ? '<option value="" disabled selected>Select model...</option>' : '';
                models.forEach(model => sel.add(new Option(model.name, model.name)));
                sel.value = currentVal;
            });
        } catch (error) {
            console.error("Error fetching Ollama models:", error);
            render.chatMessage('error', `Could not fetch models. ${error.message}`);
        }
    };

    // --- Core Logic ---
    function cleanAndParseJson(rawText) {
        // Find the first '{' and the last '}' to extract the JSON object
        const startIndex = rawText.indexOf('{');
        const endIndex = rawText.lastIndexOf('}');
        if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
            throw new Error("Could not find a valid JSON object in the response.");
        }
        const jsonString = rawText.substring(startIndex, endIndex + 1);
        return JSON.parse(jsonString);
    }

    async function handleSendMessage(e) {
        e.preventDefault();
        const userPrompt = dom.chatInput.value.trim();
        if (!userPrompt || state.isLoading || !state.activeProject) return;

        dom.chatInput.value = '';
        render.chatMessage('user', userPrompt);
        state.chatHistory.push({ role: 'user', content: userPrompt });
        actions.setLoading(true);

        try {
            const codeModel = dom.codeModelSelect.value;
            let fullPrompt = `Available static assets: [${state.assets.join(', ')}]\n\nUse code generation model '${codeModel}' to generate the files.\n\nRequest: ${userPrompt}`;
            
            const modelMessages = [
                { role: 'system', content: CHAT_SYSTEM_PROMPT },
                ...state.chatHistory.slice(-10), // Keep context manageable
                { role: 'user', content: fullPrompt }
            ];

            const rawResponse = await api.proxy('/api/chat', 'POST', { model: dom.chatModelSelect.value, messages: modelMessages, stream: false });
            
            const aiResponseJson = cleanAndParseJson(rawResponse);

            state.chatHistory.push({ role: 'assistant', content: JSON.stringify(aiResponseJson) });
            render.chatMessage('model', aiResponseJson.response_for_user);

            if (aiResponseJson.file_operations) {
                render.chatMessage('system', 'Applying file operations...');
                for (const op of aiResponseJson.file_operations) {
                    await api.saveFile(state.activeProject, op.path, op.content);
                    if (state.openFiles.has(op.path)) {
                        const file = state.openFiles.get(op.path);
                        file.content = op.content;
                        file.editorEl.querySelector('textarea').value = op.content;
                    }
                }
                await actions.refreshFileTree();
                render.chatMessage('system', 'File operations complete.');
                render.preview();
            }
        } catch (error) {
            console.error("Error processing AI response:", error);
            render.chatMessage('error', `An error occurred: ${error.message}. Check the browser console for details.`);
        } finally {
            actions.setLoading(false);
        }
    }
    
    // --- Ollama Settings Handlers ---
    function showStatusMessage(element, message, type = 'info', duration = 4000) {
        element.textContent = message;
        element.className = `status-message ${type}`;
        if (duration) setTimeout(() => { element.textContent = ''; element.className = 'status-message'; }, duration);
    }
    dom.pullModelForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const modelName = dom.pullModelName.value.trim();
        if (!modelName) return;
        showStatusMessage(dom.pullStatus, `Pulling "${modelName}"...`, 'info', null);
        try {
            await api.proxy('/api/pull', 'POST', { name: modelName, stream: false });
            showStatusMessage(dom.pullStatus, `Successfully pulled "${modelName}".`, 'success');
            dom.pullModelName.value = '';
            await actions.fetchOllamaModels(true);
        } catch (error) {
            showStatusMessage(dom.pullStatus, `Error: ${error.message}`, 'error');
        }
    });
    dom.createModelForm.addEventListener('submit', async (e) => { /* ... similar logic ... */ });
    dom.deleteModelForm.addEventListener('submit', async (e) => { /* ... similar logic ... */ });

    // --- Event Listeners Setup ---
    function setupEventListeners() {
        // ... (all previous event listeners)
        dom.newProjectBtn.addEventListener('click', () => { /* ... */ });
        dom.projectList.addEventListener('click', (e) => { /* ... */ });
        dom.fileTree.addEventListener('click', (e) => { /* ... */ });
        dom.editorTabs.addEventListener('click', (e) => { /* ... */ });
        dom.chatForm.addEventListener('submit', handleSendMessage);
        dom.refreshPreviewBtn.addEventListener('click', render.preview);
        let saveTimeout;
        dom.editorContent.addEventListener('input', (e) => { clearTimeout(saveTimeout); saveTimeout = setTimeout(actions.saveActiveFile, 1000); });
        
        // Asset Upload
        dom.assetUploadBtn.addEventListener('click', () => dom.assetUploadInput.click());
        dom.assetUploadInput.addEventListener('change', async (e) => {
            if (e.target.files.length === 0) return;
            const formData = new FormData();
            formData.append('assetFile', e.target.files[0]);
            try {
                await api.uploadAsset(formData);
                await actions.loadAssets();
            } catch (error) {
                alert(`Error uploading asset: ${error.message}`);
            }
        });

        // Tab Switchers
        document.getElementById('left-sidebar').addEventListener('click', (e) => { /* ... */ });
        document.getElementById('right-sidebar').addEventListener('click', (e) => { /* ... */ });
        document.querySelector('.editor-panel').addEventListener('click', (e) => { /* ... */ });
        
        dom.refreshModelsBtn.addEventListener('click', () => actions.fetchOllamaModels(true));
    }
    // Re-add full event listeners
    function setupFullEventListeners() {
        dom.newProjectBtn.addEventListener('click', async () => {
            const projectName = dom.newProjectNameInput.value.trim();
            if (!projectName.match(/^[a-zA-Z0-9_-]+$/)) return alert("Invalid project name.");
            await api.createProject(projectName);
            dom.newProjectNameInput.value = '';
            await actions.loadProjects();
            await actions.setActiveProject(projectName);
        });
        dom.projectList.addEventListener('click', (e) => {
            const target = e.target.closest('.sidebar-item');
            if (target) actions.setActiveProject(target.dataset.projectId);
        });
        dom.fileTree.addEventListener('click', (e) => {
            const file = e.target.closest('.file-item');
            if (file) { actions.openFile(file.dataset.path); return; }
            const dir = e.target.closest('.dir-name');
            if (dir) { const c = dir.nextElementSibling; if (c) c.classList.toggle('collapsed'); }
        });
        dom.editorTabs.addEventListener('click', (e) => {
            const tab = e.target.closest('.editor-tab');
            if (!tab) return;
            if (e.target.classList.contains('close-tab-btn')) actions.closeFile(tab.dataset.path);
            else actions.setActiveFile(tab.dataset.path);
        });
        dom.chatForm.addEventListener('submit', handleSendMessage);
        dom.refreshPreviewBtn.addEventListener('click', render.preview);
        let saveTimeout;
        dom.editorContent.addEventListener('input', () => { clearTimeout(saveTimeout); saveTimeout = setTimeout(actions.saveActiveFile, 1000); });
        
        dom.assetUploadBtn.addEventListener('click', () => dom.assetUploadInput.click());
        dom.assetUploadInput.addEventListener('change', async (e) => {
            if (e.target.files.length === 0) return;
            const formData = new FormData();
            formData.append('assetFile', e.target.files[0]);
            try {
                await api.uploadAsset(formData);
                await actions.loadAssets();
            } catch (error) { alert(`Error uploading asset: ${error.message}`); }
        });
        
        // Tab Switchers
        const setupTabSwitcher = (containerSelector) => {
            document.querySelector(containerSelector).addEventListener('click', e => {
                const btn = e.target.closest('.tab-button');
                if (btn) {
                    btn.parentElement.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const viewContainer = btn.closest('.panel, .editor-panel');
                    viewContainer.querySelectorAll(':scope > .tab-content').forEach(c => c.classList.remove('active-content'));
                    document.getElementById(btn.id.replace('-btn', '-view')).classList.add('active-content');
                }
            });
        };
        setupTabSwitcher('#left-sidebar');
        setupTabSwitcher('#right-sidebar');
        setupTabSwitcher('.editor-panel');

        dom.refreshModelsBtn.addEventListener('click', () => actions.fetchOllamaModels(true));
         // Fill in missing Ollama form handlers
        dom.createModelForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const modelName = dom.createModelName.value.trim();
            const modelfile = dom.createModelfile.value.trim();
            if (!modelName || !modelfile) return;
            showStatusMessage(dom.createStatus, `Creating "${modelName}"...`, 'info', null);
            try {
                await api.proxy('/api/create', 'POST', { name: modelName, modelfile: modelfile, stream: false });
                showStatusMessage(dom.createStatus, `Successfully created "${modelName}".`, 'success');
                dom.createModelName.value = '';
                dom.createModelfile.value = '';
                await actions.fetchOllamaModels(true);
            } catch (error) {
                showStatusMessage(dom.createStatus, `Error: ${error.message}`, 'error');
            }
        });
        dom.deleteModelForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const modelName = dom.deleteModelSelect.value;
            if (!modelName) return;
            if (confirm(`Are you sure you want to delete "${modelName}"?`)) {
                showStatusMessage(dom.deleteStatus, `Deleting "${modelName}"...`, 'info', null);
                try {
                    await api.proxy('/api/delete', 'DELETE', { name: modelName });
                    showStatusMessage(dom.deleteStatus, `Successfully deleted "${modelName}".`, 'success');
                    await actions.fetchOllamaModels(true);
                } catch (error) {
                    showStatusMessage(dom.deleteStatus, `Error: ${error.message}`, 'error');
                }
            }
        });
    }

    // --- App Initialization ---
    async function init() {
        await actions.fetchOllamaModels(true);
        await actions.loadProjects();
        await actions.loadExamples();
        await actions.loadAssets();
        setupFullEventListeners();
        console.log("Studio42 Initialized.");
    }

    init();
});

