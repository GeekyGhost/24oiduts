import os, json, hashlib, pathlib, datetime, requests
from flask import Flask, request, jsonify, render_template, abort, send_from_directory
from flask_cors import CORS

app = Flask(__name__, static_folder='static', template_folder='static')
CORS(app)  # Enable CORS for better API handling

OLLAMA_API_URL = os.environ.get('OLLAMA_API_URL', 'http://localhost:11434')

# --- Projects workspace
BASE_DIR = pathlib.Path(__file__).parent.resolve()
PROJECTS_DIR = BASE_DIR / "projects"
PROJECTS_DIR.mkdir(exist_ok=True)
STATIC_DIR = BASE_DIR / "static"
STATIC_DIR.mkdir(exist_ok=True)

def _safe_join(project_id: str, rel_path: str) -> pathlib.Path:
    """Safely join paths preventing directory traversal"""
    root = PROJECTS_DIR / project_id
    root.mkdir(exist_ok=True)
    p = (root / rel_path).resolve()
    if not str(p).startswith(str(root)):
        raise ValueError("Unsafe path.")
    p.parent.mkdir(parents=True, exist_ok=True)
    return p

def _manifest_path(project_id: str) -> pathlib.Path:
    return _safe_join(project_id, "project.json")

def _hash_content(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()

def _load_manifest(project_id: str) -> dict:
    mp = _manifest_path(project_id)
    if not mp.exists():
        return {}
    return json.loads(mp.read_text(encoding="utf-8"))

def _save_manifest(project_id: str, data: dict):
    _manifest_path(project_id).write_text(json.dumps(data, indent=2), encoding="utf-8")

def _relative_tree(project_id: str) -> list:
    root = PROJECTS_DIR / project_id
    if not root.exists():
        return []
    items = []
    for p in root.rglob("*"):
        if p.is_file() and not p.name.startswith('.'):
            items.append(str(p.relative_to(root)))
    return sorted(items)

# Phaser-specific templates
PHASER_GAME_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title}</title>
    <script src="https://cdn.jsdelivr.net/npm/phaser@3.88.0/dist/phaser.min.js"></script>
    <style>
        body {{
            margin: 0;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }}
        #game-container {{
            border: 2px solid #fff;
            box-shadow: 0 0 20px rgba(0,0,0,0.4);
        }}
    </style>
</head>
<body>
    <div id="game-container"></div>
    <script src="game.js"></script>
</body>
</html>"""

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/proxy', methods=['POST'])
def ollama_proxy():
    """Proxy requests to Ollama API"""
    try:
        data = request.get_json() or {}
        target_path = data.get('path')
        body = data.get('body', {})
        method = data.get('method', 'POST')
        
        if not target_path:
            abort(400, description="Missing 'path' in request to proxy.")
        
        full_url = f"{OLLAMA_API_URL}{target_path}"
        
        # Handle streaming for better performance with large models
        if body.get('stream', False):
            resp = requests.request(method, full_url, json=body, stream=True)
            resp.raise_for_status()
            
            def generate():
                for line in resp.iter_lines():
                    if line:
                        yield line.decode('utf-8') + '\n'
            
            return app.response_class(generate(), mimetype='text/event-stream')
        else:
            resp = requests.request(method, full_url, json=body, stream=False, timeout=120)
            resp.raise_for_status()
            return (jsonify(resp.json()), resp.status_code) if resp.content else (jsonify({'status': 'success'}), resp.status_code)
            
    except requests.exceptions.Timeout:
        return jsonify({'error': 'Request to Ollama timed out. The model might be loading.'}), 504
    except requests.exceptions.RequestException as e:
        return jsonify({'error': f"Could not connect to Ollama at {OLLAMA_API_URL}. Is it running? Error: {str(e)}"}), 503
    except Exception as e:
        return jsonify({'error': f'An internal server error occurred: {str(e)}'}), 500

# --- Project API
@app.route('/api/project/init', methods=['POST'])
def project_init():
    """Initialize a new project with Phaser support"""
    data = request.get_json() or {}
    name = data.get("name") or "Untitled Phaser Game"
    brief = data.get("brief") or ""
    chat_model = data.get("chat_model")
    code_model = data.get("code_model")
    project_type = data.get("type", "phaser")  # Default to Phaser
    
    project_id = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    root = PROJECTS_DIR / project_id
    root.mkdir(exist_ok=True)
    
    manifest = {
        "id": project_id,
        "name": name,
        "type": project_type,
        "created_at": datetime.datetime.utcnow().isoformat() + "Z",
        "chat_model": chat_model,
        "code_model": code_model,
        "brief": brief,
        "plan": None,
        "manifest": None,
        "files": {},   # path -> {hash, summary, deps, size, lang}
        "history": []
    }
    _save_manifest(project_id, manifest)
    
    # Create initial files based on project type
    if project_type == "phaser":
        # Create index.html from template
        index_content = PHASER_GAME_TEMPLATE.format(title=name)
        _safe_join(project_id, "index.html").write_text(index_content, encoding="utf-8")
        manifest["files"]["index.html"] = {
            "hash": _hash_content(index_content),
            "size": len(index_content),
            "lang": "html"
        }
    
    # Create context document
    _safe_join(project_id, "CONTEXT.md").write_text(
        f"# Project Context: {name}\n\n"
        f"## Type: {project_type}\n\n"
        f"## Brief\n{brief}\n\n"
        f"## Technical Stack\n"
        f"- Phaser 3.88.0 (Latest)\n"
        f"- ES6 JavaScript\n"
        f"- HTML5 Canvas\n\n", 
        encoding="utf-8"
    )
    
    _save_manifest(project_id, manifest)
    return jsonify({"projectId": project_id, "type": project_type})

@app.route('/api/project/tree', methods=['GET'])
def project_tree():
    """Get project file tree"""
    project_id = request.args.get("projectId")
    if not project_id:
        abort(400, description="Missing projectId")
    
    manifest = _load_manifest(project_id)
    return jsonify({
        "manifest": manifest.get("manifest"),
        "files": _relative_tree(project_id),
        "type": manifest.get("type", "generic")
    })

@app.route('/api/project/read', methods=['POST'])
def project_read():
    """Read a project file"""
    data = request.get_json() or {}
    project_id = data.get("projectId")
    path = data.get("path")
    
    if not project_id or not path:
        abort(400, description="Missing projectId or path")
    
    f = _safe_join(project_id, path)
    if not f.exists():
        abort(404, description="File not found")
    
    return jsonify({"content": f.read_text(encoding="utf-8")})

@app.route('/api/project/save', methods=['POST'])
def project_save():
    """Save and optionally summarize a project file"""
    data = request.get_json() or {}
    project_id = data.get("projectId")
    path = data.get("path")
    content = data.get("content", "")
    summarize = bool(data.get("summarize"))
    chat_model = data.get("chat_model")
    
    if not project_id or not path:
        abort(400, description="Missing projectId or path")
    
    f = _safe_join(project_id, path)
    f.write_text(content, encoding="utf-8")
    
    mf = _load_manifest(project_id)
    entry = mf["files"].get(path, {})
    entry["hash"] = _hash_content(content)
    entry["size"] = len(content)
    entry["lang"] = pathlib.Path(path).suffix.lstrip(".").lower() or "text"
    
    # Detect Phaser usage
    if "phaser" in content.lower():
        entry["framework"] = "phaser"
    
    mf["files"][path] = entry
    _save_manifest(project_id, mf)
    
    summary = None
    if summarize and chat_model:
        # Enhanced prompt for Phaser projects
        prompt_addon = ""
        if entry.get("framework") == "phaser":
            prompt_addon = "\nFocus on: Phaser scenes, game objects, physics, input handling, and game loop logic."
        
        prompt = f"""Summarize this {'Phaser game' if entry.get('framework') == 'phaser' else ''} file in <=10 lines:
- Purpose and functionality
- Key classes/functions
- Dependencies
- Public API{prompt_addon}

```{entry.get('lang','text')}
{content[:3000]}...
```"""
        
        try:
            r = requests.post(f"{OLLAMA_API_URL}/api/chat", json={
                "model": chat_model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False
            }, timeout=30)
            r.raise_for_status()
            summary = (r.json().get("message") or {}).get("content")
            entry["summary"] = summary
            mf["files"][path] = entry
            _save_manifest(project_id, mf)
        except Exception as e:
            print(f"Summarization failed: {e}")
            summary = None
    
    return jsonify({
        "saved": True, 
        "hash": entry["hash"], 
        "summary": summary,
        "framework": entry.get("framework")
    })

@app.route('/api/project/manifest', methods=['POST'])
def project_set_manifest():
    """Set project plan and file manifest"""
    data = request.get_json() or {}
    project_id = data.get("projectId")
    plan = data.get("plan")
    manifest_obj = data.get("manifest")
    
    if not project_id:
        abort(400, description="Missing projectId")
    
    mf = _load_manifest(project_id)
    mf["plan"] = plan
    mf["manifest"] = manifest_obj
    _save_manifest(project_id, mf)
    
    # Update context document
    ctx = _safe_join(project_id, "CONTEXT.md")
    with ctx.open("a", encoding="utf-8") as fp:
        fp.write("\n## Execution Plan\n")
        fp.write(plan or "(No plan provided)")
        fp.write("\n\n## File Structure\n")
        if manifest_obj and manifest_obj.get("files"):
            for file_info in manifest_obj["files"]:
                fp.write(f"- {file_info.get('path', 'unknown')}: {file_info.get('intent', 'no description')}\n")
        fp.write("\n")
    
    return jsonify({"ok": True})

@app.route('/api/project/generate', methods=['POST'])
def project_generate_file():
    """Generate a specific project file with enhanced Phaser support"""
    data = request.get_json() or {}
    project_id = data.get("projectId")
    target_path = data.get("path")
    chat_model = data.get("chat_model")
    code_model = data.get("code_model")
    
    if not project_id or not target_path or not code_model:
        abort(400, description="Missing required fields")
    
    mf = _load_manifest(project_id)
    brief = mf.get("brief", "")
    plan = mf.get("plan") or ""
    manifest_obj = mf.get("manifest") or {}
    file_map = mf.get("files") or {}
    project_type = mf.get("type", "generic")
    
    manifest_paths = [f.get("path") for f in (manifest_obj.get("files") or [])]
    
    # Collect file summaries
    summaries = []
    for p, meta in file_map.items():
        if meta.get("summary"):
            summaries.append(f"- {p}: {meta['summary'][:600]}")
    
    # Enhanced prompt for Phaser projects
    extra_instructions = ""
    if project_type == "phaser" or "game" in target_path.lower():
        extra_instructions = """
Special Instructions for Phaser 3.88:
- Use modern Phaser 3.88 API (not older versions)
- Implement proper scene lifecycle (init, preload, create, update)
- Use ES6 classes for scenes
- Configure proper physics system if needed
- Handle responsive sizing
- Include proper asset loading in preload()
- Use proper Phaser.GameObjects for sprites, text, etc.
"""
    
    prompt = f"""Generate the file: {target_path}

Project Type: {project_type}
Project Brief: {brief}

Execution Plan:
{plan}

Project Files:
{json.dumps(manifest_paths, indent=2)}

Existing File Summaries:
{chr(10).join(summaries) if summaries else "(none yet)"}
{extra_instructions}

Rules:
- Output ONLY raw file content for {target_path}
- No code fences, no commentary, no explanations
- For HTML: complete document with all necessary tags
- For JS: proper module with exports if needed
- For Phaser: use version 3.88.0 CDN
- Respect cross-file contracts from summaries
- Match the file intent from the manifest"""
    
    try:
        r = requests.post(f"{OLLAMA_API_URL}/api/chat", json={
            "model": code_model,
            "messages": [
                {"role": "system", "content": 
                 "You are an expert Phaser 3 game developer. Generate clean, working code."},
                {"role": "user", "content": prompt}
            ],
            "stream": False
        }, timeout=60)
        r.raise_for_status()
        code = (r.json().get("message") or {}).get("content", "")
        
        # Clean up common issues
        code = code.strip()
        if code.startswith("```"):
            # Remove code fences if model added them
            lines = code.split('\n')
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines[-1] == "```":
                lines = lines[:-1]
            code = '\n'.join(lines)
        
    except Exception as e:
        return jsonify({"error": f"Code generation failed: {str(e)}"}), 500
    
    # Save generated file
    f = _safe_join(project_id, target_path)
    f.write_text(code, encoding="utf-8")
    
    meta = {
        "hash": _hash_content(code),
        "size": len(code),
        "lang": pathlib.Path(target_path).suffix.lstrip(".").lower()
    }
    
    if "phaser" in code.lower():
        meta["framework"] = "phaser"
    
    mf["files"][target_path] = {**mf.get("files", {}).get(target_path, {}), **meta}
    _save_manifest(project_id, mf)
    
    return jsonify({
        "ok": True, 
        "path": target_path, 
        "hash": meta["hash"], 
        "content": code,
        "framework": meta.get("framework")
    })

@app.route('/api/project/export', methods=['GET'])
def project_export():
    """Export project as a zip file"""
    project_id = request.args.get("projectId")
    if not project_id:
        abort(400, description="Missing projectId")
    
    import zipfile
    import io
    
    root = PROJECTS_DIR / project_id
    if not root.exists():
        abort(404, description="Project not found")
    
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        for file_path in root.rglob("*"):
            if file_path.is_file() and not file_path.name.startswith('.'):
                arcname = file_path.relative_to(root)
                zip_file.write(file_path, arcname)
    
    zip_buffer.seek(0)
    
    from flask import send_file
    return send_file(
        zip_buffer,
        mimetype='application/zip',
        as_attachment=True,
        download_name=f'project_{project_id}.zip'
    )

@app.route('/api/project/list', methods=['GET'])
def project_list():
    """List all projects"""
    projects = []
    for project_dir in PROJECTS_DIR.iterdir():
        if project_dir.is_dir():
            manifest = _load_manifest(project_dir.name)
            if manifest:
                projects.append({
                    "id": manifest.get("id"),
                    "name": manifest.get("name"),
                    "type": manifest.get("type", "generic"),
                    "created_at": manifest.get("created_at"),
                    "file_count": len(manifest.get("files", {}))
                })
    
    projects.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return jsonify({"projects": projects})

if __name__ == '__main__':
    print(f"Studio42 starting...")
    print(f"Ollama API URL: {OLLAMA_API_URL}")
    print(f"Projects directory: {PROJECTS_DIR}")
    print(f"Access the UI at: http://127.0.0.1:5042")
    app.run(host='127.0.0.1', port=5042, debug=True)