import os
import shutil
import requests
import subprocess
from flask import Flask, request, jsonify, render_template, abort, send_from_directory
from werkzeug.utils import secure_filename
import json

# Initialize the Flask application
app = Flask(__name__, static_folder='static', template_folder='templates')

# --- CONFIGURATION ---
OLLAMA_API_URL = os.environ.get('OLLAMA_API_URL', 'http://localhost:11434')
PROJECTS_BASE_DIR = os.path.join(os.getcwd(), 'projects')
STATIC_DIR = os.path.join(os.getcwd(), 'static')
ASSETS_DIR = os.path.join(STATIC_DIR, 'assets')
EXAMPLES_DIR = os.path.join(STATIC_DIR, 'examples')
PHASER_DIR = os.path.join(STATIC_DIR, 'phaser')
PHASER_FILE_PATH = os.path.join(PHASER_DIR, 'phaser.min.js')
PHASER_CDN_URL = 'https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js'
PHASER_EXAMPLES_REPO = 'https://github.com/photonstorm/phaser3-examples.git'

# --- HELPER FUNCTIONS ---
def setup_directories():
    """Ensure all necessary static directories exist."""
    os.makedirs(PROJECTS_BASE_DIR, exist_ok=True)
    os.makedirs(ASSETS_DIR, exist_ok=True)
    os.makedirs(EXAMPLES_DIR, exist_ok=True)
    os.makedirs(PHASER_DIR, exist_ok=True)

def setup_phaser():
    """Checks for Phaser and downloads it if missing."""
    if not os.path.exists(PHASER_FILE_PATH):
        print("[INFO] Phaser not found. Downloading from CDN...")
        try:
            with requests.get(PHASER_CDN_URL, stream=True) as r:
                r.raise_for_status()
                with open(PHASER_FILE_PATH, 'wb') as f:
                    for chunk in r.iter_content(chunk_size=8192):
                        f.write(chunk)
            print("[SUCCESS] Phaser downloaded successfully.")
        except Exception as e:
            print(f"[ERROR] Failed to download Phaser: {e}")

def setup_phaser_examples():
    """Clones the Phaser examples repository if the directory is empty."""
    if not os.listdir(EXAMPLES_DIR):
        print(f"[INFO] Examples directory is empty. Cloning from {PHASER_EXAMPLES_REPO}...")
        try:
            subprocess.run(['git', 'clone', '--depth', '1', PHASER_EXAMPLES_REPO, EXAMPLES_DIR], check=True)
            # Optional: Clean up .git directory to save space
            git_dir = os.path.join(EXAMPLES_DIR, '.git')
            if os.path.exists(git_dir):
                shutil.rmtree(git_dir)
            print("[SUCCESS] Phaser examples cloned successfully.")
        except Exception as e:
            print(f"[ERROR] Failed to clone Phaser examples: {e}")
            print("[INFO] Please ensure Git is installed and in your system's PATH.")

def get_project_path(project_id):
    """Get the full path for a project, ensuring it's within the base directory."""
    if not project_id or '..' in project_id or '/' in project_id or '\\' in project_id:
        return None
    return os.path.join(PROJECTS_BASE_DIR, project_id)

def get_file_tree(path):
    """Recursively get the file tree for a given path."""
    tree = []
    base_project_path = path
    if not os.path.exists(path):
        return tree
    for item in os.listdir(path):
        item_path = os.path.join(path, item)
        rel_path = os.path.relpath(item_path, base_project_path).replace('\\', '/')
        node = {'name': item, 'path': rel_path}
        if os.path.isdir(item_path):
            node['type'] = 'directory'
            node['children'] = get_file_tree(item_path)
        else:
            node['type'] = 'file'
        tree.append(node)
    return sorted(tree, key=lambda x: (x['type'], x['name']))

# --- CORE ROUTES ---
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/projects/<project_id>/<path:filepath>')
def serve_project_file(project_id, filepath):
    project_path = get_project_path(project_id)
    if not project_path or not os.path.exists(project_path):
        abort(404, "Project not found.")
    return send_from_directory(project_path, filepath)

# --- API: OLLAMA PROXY ---
@app.route('/api/proxy', methods=['POST'])
def ollama_proxy():
    try:
        data = request.get_json()
        target_path = data.get('path')
        body = data.get('body', {})
        method = data.get('method', 'POST')
        if not target_path:
            abort(400, "Missing 'path' in proxy request.")
        
        full_url = f"{OLLAMA_API_URL}{target_path}"
        response = requests.request(method, full_url, json=body, stream=False)
        response.raise_for_status()
        
        # Return raw text for chat, as it might not always be perfect JSON
        if target_path == '/api/chat':
             return response.text, response.status_code

        return (response.json(), response.status_code) if response.content else (jsonify({"status": "success"}), response.status_code)
    except requests.exceptions.RequestException as e:
        return jsonify({"error": f"Could not connect to Ollama at {OLLAMA_API_URL}. Is it running?"}), 503
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# --- API: PROJECT & FILE MANAGEMENT ---
@app.route('/api/projects', methods=['GET', 'POST'])
def handle_projects():
    if request.method == 'GET':
        projects = [d for d in os.listdir(PROJECTS_BASE_DIR) if os.path.isdir(os.path.join(PROJECTS_BASE_DIR, d))]
        return jsonify(sorted(projects))
    if request.method == 'POST':
        project_id = request.json.get('project_id')
        project_path = get_project_path(project_id)
        if not project_path:
            abort(400, "Invalid project name.")
        if os.path.exists(project_path):
            abort(409, "Project already exists.")
        
        os.makedirs(os.path.join(project_path, 'js'), exist_ok=True)
        os.makedirs(os.path.join(project_path, 'assets'), exist_ok=True)
        os.makedirs(os.path.join(project_path, 'css'), exist_ok=True)
        
        if os.path.exists(PHASER_FILE_PATH):
            shutil.copy(PHASER_FILE_PATH, project_path)
        return jsonify({"status": "success", "project_id": project_id})

@app.route('/api/projects/<project_id>', methods=['GET'])
def get_project_files(project_id):
    project_path = get_project_path(project_id)
    if not project_path or not os.path.exists(project_path):
        abort(404, "Project not found.")
    return jsonify(get_file_tree(project_path))

@app.route('/api/projects/<project_id>/file', methods=['GET', 'POST'])
def handle_file(project_id):
    project_path = get_project_path(project_id)
    if not project_path:
        abort(404, "Project not found.")

    if request.method == 'GET':
        filepath = request.args.get('path')
        abs_path = os.path.abspath(os.path.join(project_path, filepath))
        if not abs_path.startswith(os.path.abspath(project_path)):
            abort(403)
        with open(abs_path, 'r', encoding='utf-8') as f:
            return jsonify({"path": filepath, "content": f.read()})

    if request.method == 'POST':
        data = request.json
        filepath, content = data.get('path'), data.get('content', '')
        abs_path = os.path.abspath(os.path.join(project_path, filepath))
        if not abs_path.startswith(os.path.abspath(project_path)):
            abort(403)
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        with open(abs_path, 'w', encoding='utf-8') as f:
            f.write(content)
        return jsonify({"status": "success", "path": filepath})

# --- API: ASSETS & EXAMPLES ---
@app.route('/api/assets', methods=['GET', 'POST'])
def handle_assets():
    if request.method == 'GET':
        assets = [f for f in os.listdir(ASSETS_DIR) if os.path.isfile(os.path.join(ASSETS_DIR, f))]
        return jsonify(sorted(assets))
    if request.method == 'POST':
        if 'assetFile' not in request.files:
            return abort(400, "No file part in request.")
        file = request.files['assetFile']
        if file.filename == '':
            return abort(400, "No selected file.")
        if file:
            filename = secure_filename(file.filename)
            file.save(os.path.join(ASSETS_DIR, filename))
            return jsonify({"status": "success", "filename": filename})

@app.route('/api/examples', methods=['GET'])
def list_examples():
    if not os.path.exists(EXAMPLES_DIR):
        return jsonify([])
    # We list subdirectories inside the 'examples/assets' folder as this is where phaser examples are
    examples_assets_path = os.path.join(EXAMPLES_DIR, 'assets')
    if not os.path.exists(examples_assets_path):
         return jsonify([])
    examples = [d for d in os.listdir(examples_assets_path) if os.path.isdir(os.path.join(examples_assets_path, d))]
    return jsonify(sorted(examples))

@app.route('/api/examples/<example_name>', methods=['POST'])
def load_example(example_name):
    # This needs to be adapted based on the actual structure of the cloned repo
    # For now, we assume a simple copy, but this would need more logic for a real implementation
    return jsonify({"status": "error", "message": "Example loading not fully implemented yet."})


# --- MAIN EXECUTION ---
if __name__ == '__main__':
    setup_directories()
    setup_phaser()
    setup_phaser_examples()
    app.run(host='127.0.0.1', port=5042, debug=True)

