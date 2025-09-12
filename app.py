import os, json, hashlib, pathlib, datetime, requests, mimetypes, tiktoken, time
from flask import Flask, request, jsonify, render_template, abort, send_from_directory, Response
from flask_cors import CORS
from werkzeug.utils import secure_filename
import threading
from dataclasses import dataclass
from typing import Dict, List, Optional, Any

app = Flask(__name__, static_folder='static', template_folder='static')
CORS(app)  # Enable CORS for better API handling

OLLAMA_API_URL = os.environ.get('OLLAMA_API_URL', 'http://localhost:11434')

# --- Projects workspace
BASE_DIR = pathlib.Path(__file__).parent.resolve()
PROJECTS_DIR = BASE_DIR / "projects"
PROJECTS_DIR.mkdir(exist_ok=True)
STATIC_DIR = BASE_DIR / "static"
STATIC_DIR.mkdir(exist_ok=True)
CONTEXT_DIR = BASE_DIR / "context"
CONTEXT_DIR.mkdir(exist_ok=True)

# Enhanced: Context Management Classes
@dataclass
class ContextMessage:
    role: str
    content: str
    timestamp: datetime.datetime
    tokens: int
    priority: int  # 1=critical, 2=important, 3=normal, 4=verbose
    category: str  # 'user', 'assistant', 'system', 'file', 'plan'
    
@dataclass
class CompressionResult:
    original_tokens: int
    compressed_tokens: int
    compression_ratio: float
    preserved_items: List[str]
    compressed_items: List[str]
    removed_items: List[str]

class ContextManager:
    def __init__(self, project_id: str, max_tokens: int = 8192):
        self.project_id = project_id
        self.max_tokens = max_tokens
        self.warning_threshold = 0.8
        self.current_tokens = 0
        self.mode = 'automatic'  # 'automatic', 'manual', 'hybrid'
        self.messages: List[ContextMessage] = []
        self.compression_history: List[CompressionResult] = []
        try:
            self.encoding = tiktoken.get_encoding("cl100k_base")  # GPT-4 tokenizer
        except:
            self.encoding = None  # Fallback if tiktoken not available
        
    def estimate_tokens(self, text: str) -> int:
        """Estimate token count for given text"""
        try:
            if self.encoding:
                return len(self.encoding.encode(text))
            else:
                # Fallback estimation: ~4 chars per token
                return len(text) // 4
        except Exception:
            # Fallback estimation: ~4 chars per token
            return len(text) // 4
    
    def add_message(self, role: str, content: str, category: str = 'normal', priority: int = 3) -> ContextMessage:
        """Add a new message to context history"""
        tokens = self.estimate_tokens(content)
        message = ContextMessage(
            role=role,
            content=content,
            timestamp=datetime.datetime.utcnow(),
            tokens=tokens,
            priority=priority,
            category=category
        )
        self.messages.append(message)
        self.current_tokens += tokens
        return message
    
    def should_compress(self) -> bool:
        """Check if context compression is needed"""
        return self.current_tokens >= (self.max_tokens * self.warning_threshold)
    
    def get_compression_plan(self) -> Dict[str, Any]:
        """Generate a compression plan showing what will be preserved/compressed/removed"""
        preserve = []
        compress = []
        remove = []
        
        current_time = datetime.datetime.utcnow()
        
        for msg in self.messages:
            age_hours = (current_time - msg.timestamp).total_seconds() / 3600
            
            # Preservation rules
            if (msg.priority == 1 or  # Critical messages
                msg.category in ['user', 'plan'] or  # User requests and plans
                age_hours < 1):  # Recent messages
                preserve.append({
                    'content': msg.content[:100] + "..." if len(msg.content) > 100 else msg.content,
                    'tokens': msg.tokens,
                    'reason': 'Critical/Recent'
                })
            
            # Compression rules  
            elif (msg.priority <= 3 and 
                  msg.category in ['assistant', 'file'] and
                  age_hours < 24):
                compress.append({
                    'content': msg.content[:50] + "..." if len(msg.content) > 50 else msg.content,
                    'tokens': msg.tokens,
                    'compressed_tokens': msg.tokens // 5,  # 20% retention
                    'reason': 'Compressible file/response'
                })
            
            # Removal rules
            else:
                remove.append({
                    'content': msg.content[:30] + "..." if len(msg.content) > 30 else msg.content,
                    'tokens': msg.tokens,
                    'reason': 'Old/Verbose'
                })
        
        total_preserve = sum(item['tokens'] for item in preserve)
        total_compress_original = sum(item['tokens'] for item in compress)
        total_compress_final = sum(item['compressed_tokens'] for item in compress)
        total_remove = sum(item['tokens'] for item in remove)
        
        projected_tokens = total_preserve + total_compress_final
        compression_ratio = (self.current_tokens - projected_tokens) / self.current_tokens if self.current_tokens > 0 else 0
        
        return {
            'current_tokens': self.current_tokens,
            'projected_tokens': projected_tokens,
            'compression_ratio': compression_ratio,
            'preserve': preserve,
            'compress': compress,
            'remove': remove,
            'quality_score': min(95, 100 - (compression_ratio * 100))
        }
    
    def compress_context(self, plan: Optional[Dict] = None) -> CompressionResult:
        """Execute context compression based on plan"""
        if plan is None:
            plan = self.get_compression_plan()
        
        original_tokens = self.current_tokens
        new_messages = []
        
        # Create summary of what's being compressed
        compressed_summary = {
            'files_completed': [],
            'conversation_summary': "",
            'project_progress': ""
        }
        
        current_time = datetime.datetime.utcnow()
        
        for msg in self.messages:
            age_hours = (current_time - msg.timestamp).total_seconds() / 3600
            
            # Preserve critical and recent messages
            if (msg.priority == 1 or 
                msg.category in ['user', 'plan'] or 
                age_hours < 1):
                new_messages.append(msg)
            
            # Compress file content and responses
            elif (msg.priority <= 3 and 
                  msg.category in ['assistant', 'file'] and 
                  age_hours < 24):
                # Create compressed version
                if msg.category == 'file':
                    summary = f"File generated: {msg.content[:50]}... (Original: {msg.tokens} tokens)"
                    compressed_summary['files_completed'].append(summary)
                else:
                    summary = f"AI Response: {msg.content[:100]}..."
                    compressed_summary['conversation_summary'] += summary + " "
                
                compressed_msg = ContextMessage(
                    role=msg.role,
                    content=summary,
                    timestamp=msg.timestamp,
                    tokens=self.estimate_tokens(summary),
                    priority=msg.priority,
                    category=f"compressed_{msg.category}"
                )
                new_messages.append(compressed_msg)
            
            # Remove old/verbose messages (they're just dropped)
        
        # Add compression summary message
        summary_content = f"""Context compressed to maintain performance:
        
Files completed: {len(compressed_summary['files_completed'])}
Conversation history: Preserved key interactions
Project progress: Maintained structure and goals

This compression preserves all critical project information while reducing memory usage."""
        
        summary_msg = ContextMessage(
            role='system',
            content=summary_content,
            timestamp=datetime.datetime.utcnow(),
            tokens=self.estimate_tokens(summary_content),
            priority=1,
            category='compression'
        )
        new_messages.append(summary_msg)
        
        # Update context
        self.messages = new_messages
        self.current_tokens = sum(msg.tokens for msg in new_messages)
        
        result = CompressionResult(
            original_tokens=original_tokens,
            compressed_tokens=self.current_tokens,
            compression_ratio=(original_tokens - self.current_tokens) / original_tokens if original_tokens > 0 else 0,
            preserved_items=[msg.content[:50] for msg in new_messages if msg.priority == 1],
            compressed_items=[msg.content[:50] for msg in new_messages if 'compressed' in msg.category],
            removed_items=[]  # We don't track individual removed items
        )
        
        self.compression_history.append(result)
        self.save_context_state()
        
        return result
    
    def get_chat_history(self) -> List[Dict[str, str]]:
        """Convert context messages to chat format for LLM"""
        chat_messages = []
        for msg in self.messages:
            if msg.role in ['user', 'assistant', 'system']:
                chat_messages.append({
                    'role': msg.role,
                    'content': msg.content
                })
        return chat_messages
    
    def save_context_state(self):
        """Save context state to disk"""
        try:
            context_file = CONTEXT_DIR / f"{self.project_id}_context.json"
            data = {
                'project_id': self.project_id,
                'mode': self.mode,
                'current_tokens': self.current_tokens,
                'max_tokens': self.max_tokens,
                'messages': [
                    {
                        'role': msg.role,
                        'content': msg.content,
                        'timestamp': msg.timestamp.isoformat(),
                        'tokens': msg.tokens,
                        'priority': msg.priority,
                        'category': msg.category
                    }
                    for msg in self.messages
                ],
                'compression_history': [
                    {
                        'original_tokens': cr.original_tokens,
                        'compressed_tokens': cr.compressed_tokens,
                        'compression_ratio': cr.compression_ratio,
                        'timestamp': datetime.datetime.utcnow().isoformat()
                    }
                    for cr in self.compression_history
                ]
            }
            context_file.write_text(json.dumps(data, indent=2))
        except Exception as e:
            print(f"Error saving context state for {self.project_id}: {e}")
    
    def load_context_state(self):
        """Load context state from disk"""
        try:
            context_file = CONTEXT_DIR / f"{self.project_id}_context.json"
            if context_file.exists():
                data = json.loads(context_file.read_text())
                self.mode = data.get('mode', 'automatic')
                self.current_tokens = data.get('current_tokens', 0)
                self.max_tokens = data.get('max_tokens', 8192)
                
                # Restore messages
                self.messages = []
                for msg_data in data.get('messages', []):
                    msg = ContextMessage(
                        role=msg_data['role'],
                        content=msg_data['content'],
                        timestamp=datetime.datetime.fromisoformat(msg_data['timestamp']),
                        tokens=msg_data['tokens'],
                        priority=msg_data['priority'],
                        category=msg_data['category']
                    )
                    self.messages.append(msg)
        except Exception as e:
            print(f"Error loading context state for {self.project_id}: {e}")

# Global context managers for active projects
context_managers: Dict[str, ContextManager] = {}

def get_context_manager(project_id: str) -> ContextManager:
    """Get or create context manager for project"""
    if project_id not in context_managers:
        cm = ContextManager(project_id)
        cm.load_context_state()
        context_managers[project_id] = cm
    return context_managers[project_id]

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

def _hash_content(content) -> str:
    if isinstance(content, str):
        content = content.encode("utf-8")
    return hashlib.sha256(content).hexdigest()

def _create_default_manifest(project_id: str) -> dict:
    """Create a default manifest when loading fails"""
    return {
        "id": project_id,
        "name": "Game Project",
        "type": "phaser",
        "created_at": datetime.datetime.utcnow().isoformat() + "Z",
        "chat_model": None,
        "code_model": None,
        "brief": "",
        "plan": None,
        "manifest": None,
        "files": {},  # CRITICAL: Always ensure files key exists
        "history": [],
        "assets": {},
        "context_mode": "automatic"
    }

def _load_manifest(project_id: str) -> dict:
    """Enhanced manifest loading with error recovery"""
    mp = _manifest_path(project_id)
    if not mp.exists():
        return _create_default_manifest(project_id)
    
    try:
        content = mp.read_text(encoding="utf-8")
        if not content.strip():
            print(f"Warning: Empty manifest file for project {project_id}")
            return _create_default_manifest(project_id)
        
        # Clean the content before parsing
        content = _clean_generated_code(content)
        
        # Try to parse JSON
        manifest = json.loads(content)
        
        # CRITICAL FIX: Ensure required keys exist
        if not isinstance(manifest, dict):
            print(f"Warning: Manifest is not a dictionary for project {project_id}")
            return _create_default_manifest(project_id)
        
        # Ensure all required keys exist
        required_keys = ["id", "files", "assets"]
        for key in required_keys:
            if key not in manifest:
                manifest[key] = {} if key in ["files", "assets"] else project_id if key == "id" else None
        
        return manifest
        
    except json.JSONDecodeError as e:
        print(f"JSON decode error for project {project_id}: {e}")
        print(f"Manifest content: {content[:200]}...")
        
        # Try to recover by fixing common issues
        try:
            content = mp.read_text(encoding="utf-8")
            # Remove everything before first {
            start = content.find('{')
            if start > 0:
                content = content[start:]
            # Remove everything after last }
            end = content.rfind('}')
            if end != -1:
                content = content[:end+1]
            
            manifest = json.loads(content)
            # Ensure required keys exist
            if "files" not in manifest:
                manifest["files"] = {}
            if "assets" not in manifest:
                manifest["assets"] = {}
            return manifest
        except:
            print(f"Failed to recover manifest for {project_id}, creating default")
            return _create_default_manifest(project_id)
    except Exception as e:
        print(f"Unexpected error loading manifest for {project_id}: {e}")
        return _create_default_manifest(project_id)

def _save_manifest(project_id: str, data: dict):
    """Enhanced manifest saving with validation"""
    try:
        # Validate the data structure
        if not isinstance(data, dict):
            raise ValueError("Manifest data must be a dictionary")
        
        # Ensure required fields exist
        if "id" not in data:
            data["id"] = project_id
        if "files" not in data:
            data["files"] = {}
        if "assets" not in data:
            data["assets"] = {}
        
        manifest_path = _manifest_path(project_id)
        content = json.dumps(data, indent=2, ensure_ascii=False)
        manifest_path.write_text(content, encoding="utf-8")
        
    except Exception as e:
        print(f"Error saving manifest for {project_id}: {e}")
        # Don't fail silently - re-raise so caller knows there's an issue
        raise

def _relative_tree(project_id: str) -> list:
    root = PROJECTS_DIR / project_id
    if not root.exists():
        return []
    items = []
    for p in root.rglob("*"):
        if p.is_file() and not p.name.startswith('.'):
            rel_path = str(p.relative_to(root))
            items.append({
                "path": rel_path,
                "size": p.stat().st_size,
                "type": "asset" if rel_path.startswith("assets/") else "code",
                "category": _get_file_category(rel_path)
            })
    return sorted(items, key=lambda x: x["path"])

def _get_file_category(file_path: str) -> str:
    """Determine file category for asset management"""
    ext = pathlib.Path(file_path).suffix.lower()
    if ext in ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.bmp', '.webp']:
        return 'image'
    elif ext in ['.mp3', '.wav', '.ogg', '.m4a', '.aac']:
        return 'audio'
    elif ext in ['.ttf', '.woff', '.woff2', '.otf']:
        return 'font'
    elif ext in ['.json', '.xml', '.csv']:
        return 'data'
    elif ext in ['.js', '.html', '.css']:
        return 'code'
    else:
        return 'other'

def _convert_es6_to_browser_compatible(code: str) -> str:
    """Convert ES6 imports to browser-compatible format"""
    lines = code.split('\n')
    cleaned_lines = []
    
    for line in lines:
        # Remove ES6 import statements - they won't work in browser without bundler
        if line.strip().startswith('import ') and ' from ' in line:
            # Skip ES6 imports - Phaser and other libs loaded via CDN
            continue
        elif line.strip().startswith('export default '):
            # Convert export default to regular class/function
            line = line.replace('export default ', '')
        elif line.strip().startswith('export '):
            # Remove other exports
            line = line.replace('export ', '')
        
        cleaned_lines.append(line)
    
    return '\n'.join(cleaned_lines)

def _clean_generated_code(code: str) -> str:
    """Enhanced code cleaning with better file format handling"""
    if not code:
        return ""
    
    code = code.strip()
    
    # Remove filename headers that LLMs often add
    lines = code.split('\n')
    cleaned_lines = []
    skip_next_empty = False
    
    for i, line in enumerate(lines):
        line_stripped = line.strip()
        
        # Skip lines that look like filenames or paths
        if (line_stripped.endswith('.js') or line_stripped.endswith('.html') or 
            line_stripped.endswith('.css') or line_stripped.endswith('.json') or
            line_stripped.startswith('Generated ') or
            line_stripped.startswith('Here is the content of ') or
            line_stripped.startswith('```') and not line_stripped.endswith('```')):
            skip_next_empty = True
            continue
            
        # Skip single backticks at start/end
        if line_stripped == '```':
            continue
            
        # Skip empty lines after filename headers
        if skip_next_empty and line_stripped == '':
            skip_next_empty = False
            continue
            
        skip_next_empty = False
        cleaned_lines.append(line)
    
    code = '\n'.join(cleaned_lines)
    
    # Remove markdown code blocks
    if code.startswith('```'):
        lines = code.split('\n')
        if lines[0].startswith('```'):
            lines = lines[1:]
        if lines and lines[-1].strip() == '```':
            lines = lines[:-1]
        code = '\n'.join(lines)
    
    # Remove common unwanted prefixes
    unwanted_prefixes = [
        "Here's the code:",
        "Here is the code:",
        "Here's the content:",
        "Here is the content:",
        "Generated ",
        "```javascript",
        "```html", 
        "```css",
        "```json"
    ]
    
    for prefix in unwanted_prefixes:
        if code.lower().startswith(prefix.lower()):
            code = code[len(prefix):].lstrip()
            break
    
    # For JSON files, ensure it starts with { or [
    if code.strip() and not code.lstrip().startswith(('{', '[')):
        # Try to find JSON content
        start_pos = code.find('{')
        if start_pos == -1:
            start_pos = code.find('[')
        if start_pos != -1:
            code = code[start_pos:]
    
    # Clean up ES6 imports for browser compatibility
    if 'import ' in code and 'from ' in code:
        code = _convert_es6_to_browser_compatible(code)
    
    return code.strip()

# ENHANCED: Multi-file Phaser templates and defaults with Asset Integration
def generate_index_with_assets(project_id: str, title: str = "Game") -> str:
    """Generate index.html with proper asset manifest"""
    mf = _load_manifest(project_id)
    assets = mf.get("assets", {})
    
    # Create asset manifest for JavaScript
    asset_manifest = {}
    for asset_path, asset_info in assets.items():
        # Create a clean key from the filename
        asset_key = asset_info['name'].split('.')[0].replace('-', '_').replace(' ', '_').lower()
        asset_manifest[asset_key] = {
            'path': asset_path,
            'category': asset_info['category'],
            'name': asset_info['name']
        }
    
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title}</title>
    <link rel="stylesheet" href="css/style.css">
    <script src="https://cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js"></script>
</head>
<body>
    <div id="game-container">
        <div id="loading-screen">
            <div class="loading-spinner"></div>
            <p>Loading {title}...</p>
        </div>
    </div>
    
    <script>
        // Asset manifest - populated dynamically
        window.gameAssets = {json.dumps(asset_manifest, indent=2)};
    </script>
    
    <script src="js/scenes/StartScene.js"></script>
    <script src="js/scenes/GameScene.js"></script>
    <script src="js/scenes/GameOverScene.js"></script>
    <script src="js/entities/Player.js"></script>
    <script src="js/utils/AssetLoader.js"></script>
    <script src="js/game.js"></script>
</body>
</html>"""

PHASER_INDEX_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title}</title>
    <link rel="stylesheet" href="css/style.css">
    <script src="https://cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js"></script>
</head>
<body>
    <div id="game-container">
        <div id="loading-screen">
            <div class="loading-spinner"></div>
            <p>Loading {title}...</p>
        </div>
    </div>
    
    <script>
        // Asset manifest - populated dynamically
        window.gameAssets = {asset_manifest};
    </script>
    
    <script src="js/scenes/StartScene.js"></script>
    <script src="js/scenes/GameScene.js"></script>
    <script src="js/scenes/GameOverScene.js"></script>
    <script src="js/entities/Player.js"></script>
    <script src="js/utils/AssetLoader.js"></script>
    <script src="js/game.js"></script>
</body>
</html>"""

DEFAULT_CSS_CONTENT = """/* Game Styling */
body {
    margin: 0;
    padding: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    font-family: 'Arial', sans-serif;
}

#game-container {
    position: relative;
    border: 2px solid #fff;
    box-shadow: 0 0 20px rgba(0,0,0,0.4);
    border-radius: 8px;
    overflow: hidden;
}

#loading-screen {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.8);
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    color: white;
    z-index: 1000;
}

.loading-spinner {
    width: 40px;
    height: 40px;
    border: 4px solid #ffffff33;
    border-top: 4px solid #ffffff;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 20px;
}

@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}

/* Game UI Elements */
.game-ui {
    position: absolute;
    top: 10px;
    left: 10px;
    color: white;
    font-weight: bold;
    text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
    z-index: 100;
}

.score {
    font-size: 24px;
    margin-bottom: 5px;
}

.lives {
    font-size: 18px;
}"""

DEFAULT_GAME_CONFIG = """// Main game configuration - Browser Compatible
const config = {
    type: Phaser.CANVAS, // Better iframe compatibility
    width: 800,
    height: 600,
    parent: 'game-container',
    backgroundColor: '#2c3e50',
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 300 },
            debug: false
        }
    },
    scene: [StartScene, GameScene, GameOverScene]
};

// Global game variables
let gameData = {
    score: 0,
    lives: 3,
    level: 1,
    highScore: localStorage.getItem('highScore') || 0
};

// Start the game
const game = new Phaser.Game(config);

// Hide loading screen when game starts
game.events.once('ready', () => {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
        loadingScreen.style.display = 'none';
    }
});"""

DEFAULT_START_SCENE = """class StartScene extends Phaser.Scene {
    constructor() {
        super({ key: 'StartScene' });
    }

    preload() {
        // Create simple colored rectangles as placeholders for sprites
        this.load.image('startBg', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
        
        // Load any uploaded assets
        if (typeof AssetLoader !== 'undefined') {
            AssetLoader.loadAssets(this);
        }
    }

    create() {
        // Background
        this.add.rectangle(400, 300, 800, 600, 0x2c3e50);
        
        // Title
        this.add.text(400, 200, 'PHASER GAME', {
            fontSize: '48px',
            fill: '#ffffff',
            fontFamily: 'Arial',
            fontStyle: 'bold'
        }).setOrigin(0.5);

        // Instructions
        this.add.text(400, 350, 'Click anywhere to start', {
            fontSize: '24px',
            fill: '#ecf0f1'
        }).setOrigin(0.5);

        // High score
        this.add.text(400, 450, 'High Score: ' + gameData.highScore, {
            fontSize: '18px',
            fill: '#bdc3c7'
        }).setOrigin(0.5);

        // Start game on click
        this.input.once('pointerdown', () => {
            this.scene.start('GameScene');
        });

        // Keyboard start
        this.input.keyboard.once('keydown-SPACE', () => {
            this.scene.start('GameScene');
        });
    }
}"""

DEFAULT_GAME_SCENE = """class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
    }

    preload() {
        // Load game assets
        if (typeof AssetLoader !== 'undefined') {
            AssetLoader.loadAssets(this);
        }
    }

    create() {
        // Background
        this.add.rectangle(400, 300, 800, 600, 0x34495e);
        
        // Create player
        if (typeof Player !== 'undefined') {
            this.player = new Player(this, 100, 400);
        } else {
            // Simple player sprite fallback
            this.player = this.physics.add.sprite(100, 400, null);
            this.player.setDisplaySize(32, 48);
            this.player.setTint(0x3498db);
            this.player.setBounce(0.2);
            this.player.setCollideWorldBounds(true);
        }
        
        // Create platforms group
        this.platforms = this.physics.add.staticGroup();
        this.platforms.create(400, 568, null).setScale(800, 64).refreshBody().setTint(0x27ae60);
        this.platforms.create(600, 400, null).setScale(200, 32).refreshBody().setTint(0x27ae60);
        this.platforms.create(50, 250, null).setScale(200, 32).refreshBody().setTint(0x27ae60);
        this.platforms.create(750, 220, null).setScale(200, 32).refreshBody().setTint(0x27ae60);

        // Player physics
        this.physics.add.collider(this.player, this.platforms);

        // Controls
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys('W,S,A,D');

        // UI
        this.scoreText = this.add.text(16, 16, 'Score: ' + gameData.score, {
            fontSize: '32px',
            fill: '#ffffff'
        });

        this.livesText = this.add.text(16, 56, 'Lives: ' + gameData.lives, {
            fontSize: '24px',
            fill: '#ffffff'
        });

        // Create collectibles
        this.createCollectibles();
    }

    createCollectibles() {
        this.collectibles = this.physics.add.group({
            key: null,
            repeat: 5,
            setXY: { x: 120, y: 0, stepX: 120 }
        });

        this.collectibles.children.entries.forEach(star => {
            star.setDisplaySize(20, 20);
            star.setTint(0xf1c40f);
            star.setBounce(Phaser.Math.FloatBetween(0.4, 0.8));
        });

        this.physics.add.collider(this.collectibles, this.platforms);
        this.physics.add.overlap(this.player, this.collectibles, this.collectStar, null, this);
    }

    collectStar(player, star) {
        star.disableBody(true, true);
        gameData.score += 10;
        this.scoreText.setText('Score: ' + gameData.score);

        if (this.collectibles.countActive(true) === 0) {
            // Level complete
            gameData.level++;
            this.scene.restart();
        }
    }

    update() {
        // Player movement
        if (this.cursors.left.isDown || this.wasd.A.isDown) {
            this.player.setVelocityX(-160);
        } else if (this.cursors.right.isDown || this.wasd.D.isDown) {
            this.player.setVelocityX(160);
        } else {
            this.player.setVelocityX(0);
        }

        // Jumping
        if ((this.cursors.up.isDown || this.wasd.W.isDown) && this.player.body.touching.down) {
            this.player.setVelocityY(-330);
        }

        // Check if player fell off the world
        if (this.player.y > 600) {
            gameData.lives--;
            if (gameData.lives > 0) {
                this.player.setPosition(100, 400);
                this.livesText.setText('Lives: ' + gameData.lives);
            } else {
                this.scene.start('GameOverScene');
            }
        }
    }
}"""

DEFAULT_GAME_OVER_SCENE = """class GameOverScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameOverScene' });
    }

    create() {
        // Background
        this.add.rectangle(400, 300, 800, 600, 0x2c3e50);

        // Game Over title
        this.add.text(400, 200, 'GAME OVER', {
            fontSize: '48px',
            fill: '#e74c3c',
            fontFamily: 'Arial',
            fontStyle: 'bold'
        }).setOrigin(0.5);

        // Final score
        this.add.text(400, 300, 'Final Score: ' + gameData.score, {
            fontSize: '32px',
            fill: '#ffffff'
        }).setOrigin(0.5);

        // Check for high score
        if (gameData.score > gameData.highScore) {
            gameData.highScore = gameData.score;
            localStorage.setItem('highScore', gameData.highScore);
            
            this.add.text(400, 350, 'NEW HIGH SCORE!', {
                fontSize: '24px',
                fill: '#f1c40f'
            }).setOrigin(0.5);
        }

        // Restart instructions
        this.add.text(400, 450, 'Click to play again', {
            fontSize: '24px',
            fill: '#ecf0f1'
        }).setOrigin(0.5);

        this.add.text(400, 500, 'Press M for Main Menu', {
            fontSize: '18px',
            fill: '#bdc3c7'
        }).setOrigin(0.5);

        // Restart game
        this.input.once('pointerdown', () => {
            this.restartGame();
        });

        // Keyboard controls
        this.input.keyboard.once('keydown-SPACE', () => {
            this.restartGame();
        });

        this.input.keyboard.once('keydown-M', () => {
            this.restartGame();
            this.scene.start('StartScene');
        });
    }

    restartGame() {
        gameData.score = 0;
        gameData.lives = 3;
        gameData.level = 1;
        this.scene.start('GameScene');
    }
}"""

DEFAULT_PLAYER_CLASS = """class Player {
    constructor(scene, x, y) {
        this.scene = scene;
        
        // Create player sprite (using colored rectangle as placeholder)
        this.sprite = scene.physics.add.sprite(x, y, null);
        this.sprite.setDisplaySize(32, 48);
        this.sprite.setTint(0x3498db);
        this.sprite.setBounce(0.2);
        this.sprite.setCollideWorldBounds(true);

        // Movement properties
        this.speed = 160;
        this.jumpPower = 330;
        
        return this.sprite; // Return the sprite so it can be used directly
    }
}"""

DEFAULT_ASSET_LOADER = """class AssetLoader {
    static loadAssets(scene) {
        // Load uploaded assets dynamically
        const assetManifest = window.gameAssets || {};
        
        // Load images
        Object.keys(assetManifest).forEach(assetKey => {
            const asset = assetManifest[assetKey];
            if (asset.category === 'image') {
                scene.load.image(assetKey, asset.path);
            } else if (asset.category === 'audio') {
                scene.load.audio(assetKey, asset.path);
            }
        });
        
        console.log('Assets loaded for scene:', scene.scene.key);
    }

    static getAssetList() {
        return window.gameAssets || {};
    }
}"""

# Enhanced generation instructions
def _get_generation_instructions(target_path: str, project_type: str) -> str:
    """Get enhanced file-specific generation instructions"""
    
    base_rules = """
CRITICAL RULES:
- Output ONLY the raw file content
- NO markdown code fences (```)  
- NO filename headers or paths
- NO "Generated filename:" or "Here is the code:" prefixes
- NO explanatory text before or after the code
- Start directly with the actual file content
"""
    
    if target_path.endswith('.html'):
        return base_rules + """
Generate clean HTML5 entry point that:
- Links to external CSS files in css/ folder
- Includes Phaser 3.90 CDN link
- References JS files in proper load order
- Has game container div with id="game-container"  
- Includes loading screen div
- Uses relative paths for all local files
"""
    elif target_path.endswith('.css'):
        return base_rules + """
Generate modern CSS that:
- Styles the game container and loading screen
- Uses responsive design principles
- Includes smooth animations for UI elements
- Has consistent color scheme
- Supports fullscreen gaming experience
"""
    elif 'scenes/' in target_path and target_path.endswith('.js'):
        return base_rules + """
Generate Phaser 3.90 Scene class that:
- Uses ES5 class syntax (class Name extends Phaser.Scene)
- NO ES6 imports - all dependencies loaded via HTML
- Has proper constructor with scene key
- Implements preload(), create(), update() methods as needed
- Handles scene transitions correctly
- References uploaded assets from window.gameAssets
- Uses Canvas renderer compatible code
"""
    elif 'entities/' in target_path and target_path.endswith('.js'):
        return base_rules + """
Generate game entity class that:
- Uses ES5 class syntax 
- NO ES6 imports or exports
- Has proper constructor with scene reference
- Implements update() method for game logic
- Uses Phaser physics if appropriate
- Has clean public API
- Works in browser without bundler
"""
    elif target_path.endswith('game.js'):
        return base_rules + """
Generate main Phaser game configuration:
- Uses Phaser.CANVAS renderer for iframe compatibility
- NO ES6 imports - Phaser loaded via CDN
- Proper scene registration and ordering
- Physics configuration if needed
- Global game data management
- Error handling and loading states
"""
    elif target_path.endswith('.json'):
        return base_rules + """
Generate valid JSON file:
- Start immediately with { or [
- NO filename or path headers
- NO markdown formatting
- Proper JSON syntax with quoted keys
- No trailing commas
- Valid data structure
"""
    else:
        return base_rules + "Generate appropriate file content following project conventions."

# Enhanced system prompt for the code model
ENHANCED_CODE_SYSTEM_PROMPT = {
    'role': 'system',
    'content': '''You are an expert Phaser 3 game developer. Generate clean, browser-compatible code.

CRITICAL OUTPUT REQUIREMENTS:
1. Output ONLY raw file content - no markdown, no explanations
2. NO code fences (```) or filename headers  
3. NO "Generated filename:" or "Here is the code:" prefixes
4. Start directly with the actual file content

BROWSER COMPATIBILITY:
- NO ES6 imports/exports (code runs directly in browser)
- Use ES5 class syntax: class Name extends Phaser.Scene
- Phaser 3 loaded via CDN, available globally
- Use Canvas renderer for iframe compatibility
- Handle missing dependencies gracefully

CODE QUALITY:
- Clean, readable, well-structured code
- Proper error handling
- Cross-browser compatibility
- Mobile-friendly responsive design
- Optimized for performance'''
}

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/proxy', methods=['POST'])
def ollama_proxy():
    """Enhanced proxy with streaming support"""
    try:
        data = request.get_json() or {}
        target_path = data.get('path')
        body = data.get('body', {})
        method = data.get('method', 'POST')
        
        if not target_path:
            abort(400, description="Missing 'path' in request to proxy.")
        
        full_url = f"{OLLAMA_API_URL}{target_path}"
        
        # Handle streaming responses
        if body.get('stream', False):
            resp = requests.request(method, full_url, json=body, stream=True)
            resp.raise_for_status()
            
            def generate():
                try:
                    for line in resp.iter_lines():
                        if line:
                            yield f"data: {line.decode('utf-8')}\n\n"
                    yield "data: [DONE]\n\n"
                except Exception as e:
                    yield f"data: {json.dumps({'error': str(e)})}\n\n"
            
            return Response(
                generate(),
                mimetype='text/event-stream',
                headers={
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type'
                }
            )
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

# ENHANCED: Preview System - FIXED MISSING ENDPOINT
@app.route('/api/project/preview/<project_id>')
def serve_project_preview(project_id):
    """Serve the main HTML file for project preview"""
    try:
        # Serve the index.html file for the project
        file_path = _safe_join(project_id, 'index.html')
        if file_path.exists():
            # Read the HTML content
            html_content = file_path.read_text(encoding='utf-8')
            
            # Modify asset paths to work with the preview context
            # Replace relative paths with absolute API paths
            modified_content = html_content.replace(
                'src="assets/', 
                f'src="/api/project/asset/{project_id}/assets/'
            ).replace(
                'href="css/',
                f'href="/api/project/asset/{project_id}/css/'
            ).replace(
                'src="js/',
                f'src="/api/project/asset/{project_id}/js/'
            )
            
            return modified_content, 200, {'Content-Type': 'text/html'}
        else:
            return '<html><body><h1>Project not found or no index.html</h1><p>Generate your project files first.</p></body></html>', 404
    except ValueError:
        return '<html><body><h1>Invalid project</h1></body></html>', 400

# ENHANCED: Context Management API Endpoints
@app.route('/api/context/status', methods=['GET'])
def context_status():
    """Get context status for a project"""
    project_id = request.args.get('projectId')
    if not project_id:
        return jsonify({'error': 'Missing projectId'}), 400
    
    cm = get_context_manager(project_id)
    plan = cm.get_compression_plan() if cm.should_compress() else None
    
    return jsonify({
        'project_id': project_id,
        'current_tokens': cm.current_tokens,
        'max_tokens': cm.max_tokens,
        'usage_percentage': (cm.current_tokens / cm.max_tokens) * 100,
        'should_compress': cm.should_compress(),
        'mode': cm.mode,
        'compression_plan': plan,
        'compression_history': len(cm.compression_history)
    })

@app.route('/api/context/set-mode', methods=['POST'])
def set_context_mode():
    """Set context management mode for a project"""
    data = request.get_json() or {}
    project_id = data.get('projectId')
    mode = data.get('mode')
    
    if not project_id or mode not in ['automatic', 'manual', 'hybrid']:
        return jsonify({'error': 'Invalid projectId or mode'}), 400
    
    cm = get_context_manager(project_id)
    cm.mode = mode
    cm.save_context_state()
    
    return jsonify({'success': True, 'mode': mode})

@app.route('/api/context/compress', methods=['POST'])
def compress_context():
    """Execute context compression"""
    data = request.get_json() or {}
    project_id = data.get('projectId')
    custom_plan = data.get('plan')  # Optional custom compression plan
    
    if not project_id:
        return jsonify({'error': 'Missing projectId'}), 400
    
    cm = get_context_manager(project_id)
    
    try:
        result = cm.compress_context(custom_plan)
        return jsonify({
            'success': True,
            'compression_result': {
                'original_tokens': result.original_tokens,
                'compressed_tokens': result.compressed_tokens,
                'compression_ratio': result.compression_ratio,
                'preserved_count': len(result.preserved_items),
                'compressed_count': len(result.compressed_items),
                'removed_count': len(result.removed_items)
            }
        })
    except Exception as e:
        return jsonify({'error': f'Compression failed: {str(e)}'}), 500

@app.route('/api/context/plan', methods=['GET'])
def get_compression_plan():
    """Get compression plan for review"""
    project_id = request.args.get('projectId')
    if not project_id:
        return jsonify({'error': 'Missing projectId'}), 400
    
    cm = get_context_manager(project_id)
    plan = cm.get_compression_plan()
    
    return jsonify({
        'success': True,
        'plan': plan
    })

# --- Project API (Enhanced with Context Management)
@app.route('/api/project/init', methods=['POST'])
def project_init():
    """Initialize a new multi-file Phaser project with context management"""
    data = request.get_json() or {}
    name = data.get("name") or "Untitled Phaser Game"
    brief = data.get("brief") or ""
    chat_model = data.get("chat_model")
    code_model = data.get("code_model")
    project_type = data.get("type", "phaser")
    context_mode = data.get("context_mode", "automatic")
    
    project_id = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    root = PROJECTS_DIR / project_id
    root.mkdir(exist_ok=True)
    
    # Initialize context manager
    cm = get_context_manager(project_id)
    cm.mode = context_mode
    cm.add_message('system', f'Project initialized: {name}', category='plan', priority=1)
    cm.add_message('user', brief, category='user', priority=1)
    
    # Create directory structure
    directories = [
        'css',
        'js/scenes',
        'js/entities', 
        'js/utils',
        'assets/images',
        'assets/audio',
        'assets/fonts',
        'assets/data'
    ]
    
    for dir_path in directories:
        dir_obj = _safe_join(project_id, dir_path)
        dir_obj.mkdir(parents=True, exist_ok=True)
    
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
        "files": {},
        "history": [],
        "assets": {},
        "context_mode": context_mode
    }
    
    # Create initial files
    initial_files = {
        "index.html": PHASER_INDEX_TEMPLATE.format(title=name, asset_manifest="{}"),
        "css/style.css": DEFAULT_CSS_CONTENT,
        "js/game.js": DEFAULT_GAME_CONFIG,
        "js/scenes/StartScene.js": DEFAULT_START_SCENE,
        "js/scenes/GameScene.js": DEFAULT_GAME_SCENE,
        "js/scenes/GameOverScene.js": DEFAULT_GAME_OVER_SCENE,
        "js/entities/Player.js": DEFAULT_PLAYER_CLASS,
        "js/utils/AssetLoader.js": DEFAULT_ASSET_LOADER,
        "README.md": f"# {name}\n\n{brief}\n\nGenerated with Studio42 Enhanced\n\n## Files Structure\n- `index.html` - Game entry point\n- `js/game.js` - Main game configuration\n- `js/scenes/` - Game scenes\n- `js/entities/` - Game objects\n- `assets/` - Game assets\n"
    }
    
    for file_path, content in initial_files.items():
        file_obj = _safe_join(project_id, file_path)
        file_obj.write_text(content, encoding="utf-8")
        
        manifest["files"][file_path] = {
            "hash": _hash_content(content),
            "size": len(content),
            "lang": pathlib.Path(file_path).suffix.lstrip(".").lower() or "text",
            "type": "code",
            "category": _get_file_category(file_path)
        }
        
        # Add to context
        cm.add_message('system', f'File created: {file_path}', category='file', priority=2)
    
    _save_manifest(project_id, manifest)
    cm.save_context_state()
    
    return jsonify({"projectId": project_id, "type": project_type, "context_mode": context_mode})

@app.route('/api/project/tree', methods=['GET'])
def project_tree():
    """Get enhanced project file tree with asset info"""
    project_id = request.args.get("projectId")
    if not project_id:
        abort(400, description="Missing projectId")
    
    manifest = _load_manifest(project_id)
    files = _relative_tree(project_id)
    
    # Include context status
    cm = get_context_manager(project_id)
    context_status = {
        'current_tokens': cm.current_tokens,
        'max_tokens': cm.max_tokens,
        'usage_percentage': (cm.current_tokens / cm.max_tokens) * 100,
        'should_compress': cm.should_compress(),
        'mode': cm.mode
    }
    
    return jsonify({
        "manifest": manifest.get("manifest"),
        "files": files,
        "type": manifest.get("type", "generic"),
        "assets": manifest.get("assets", {}),
        "context_status": context_status
    })

@app.route('/api/project/upload-asset', methods=['POST'])
def project_upload_asset():
    """Upload assets to project"""
    project_id = request.form.get('projectId')
    if not project_id:
        abort(400, description="Missing projectId")
    
    if 'files' not in request.files:
        abort(400, description="No files provided")
    
    files = request.files.getlist('files')
    uploaded_assets = []
    
    # Get context manager
    cm = get_context_manager(project_id)
    
    for file in files:
        if file.filename == '':
            continue
            
        # Secure filename
        filename = secure_filename(file.filename)
        file_ext = filename.lower().split('.')[-1]
        category = _get_file_category(filename)
        
        # Determine storage path based on file type
        if category == 'image':
            asset_path = f"assets/images/{filename}"
        elif category == 'audio':
            asset_path = f"assets/audio/{filename}"
        elif category == 'font':
            asset_path = f"assets/fonts/{filename}"
        elif category == 'data':
            asset_path = f"assets/data/{filename}"
        else:
            asset_path = f"assets/{filename}"
        
        # Save file
        file_path = _safe_join(project_id, asset_path)
        file.save(file_path)
        
        # Get file info
        file_stats = file_path.stat()
        file_content = file_path.read_bytes()
        
        # Update manifest
        mf = _load_manifest(project_id)
        mf["files"][asset_path] = {
            "hash": _hash_content(file_content),
            "size": file_stats.st_size,
            "type": "asset",
            "category": category,
            "mimetype": mimetypes.guess_type(filename)[0],
            "uploaded_at": datetime.datetime.utcnow().isoformat() + "Z"
        }
        
        if "assets" not in mf:
            mf["assets"] = {}
        mf["assets"][asset_path] = {
            "name": filename,
            "category": category,
            "size": file_stats.st_size
        }
        
        _save_manifest(project_id, mf)
        
        # Add to context
        cm.add_message('system', f'Asset uploaded: {asset_path} ({category})', category='file', priority=2)
        
        uploaded_assets.append({
            "path": asset_path,
            "name": filename,
            "size": file_stats.st_size,
            "category": category,
            "url": f"/api/project/asset/{project_id}/{asset_path}"
        })
        
        # Update index.html with new asset manifest
        updated_index = generate_index_with_assets(project_id, mf.get("name", "Game"))
        index_file = _safe_join(project_id, "index.html")
        index_file.write_text(updated_index, encoding="utf-8")
    
    cm.save_context_state()
    
    return jsonify({
        "success": True,
        "uploaded": uploaded_assets
    })

@app.route('/api/project/asset/<project_id>/<path:asset_path>')
def serve_project_asset(project_id, asset_path):
    """Enhanced file serving with proper MIME types"""
    try:
        file_path = _safe_join(project_id, asset_path)
        if file_path.exists():
            # Determine MIME type
            mime_type = mimetypes.guess_type(str(file_path))[0] or 'application/octet-stream'
            
            if asset_path.endswith('.js'):
                mime_type = 'application/javascript'
            elif asset_path.endswith('.css'):
                mime_type = 'text/css'
            elif asset_path.endswith('.html'):
                mime_type = 'text/html'
                
            with open(file_path, 'rb') as f:
                content = f.read()
                
            return content, 200, {'Content-Type': mime_type}
        else:
            return 'File not found', 404
    except ValueError:
        return 'Invalid path', 400

@app.route('/api/project/delete-asset', methods=['POST'])
def project_delete_asset():
    """Delete asset from project"""
    data = request.get_json() or {}
    project_id = data.get("projectId")
    asset_path = data.get("path")
    
    if not project_id or not asset_path:
        abort(400, description="Missing projectId or path")
    
    try:
        file_path = _safe_join(project_id, asset_path)
        if file_path.exists():
            file_path.unlink()
        
        # Update manifest
        mf = _load_manifest(project_id)
        if asset_path in mf.get("files", {}):
            del mf["files"][asset_path]
        if asset_path in mf.get("assets", {}):
            del mf["assets"][asset_path]
        _save_manifest(project_id, mf)
        
        # Update index.html with new asset manifest
        updated_index = generate_index_with_assets(project_id, mf.get("name", "Game"))
        index_file = _safe_join(project_id, "index.html")
        index_file.write_text(updated_index, encoding="utf-8")
        
        # Add to context
        cm = get_context_manager(project_id)
        cm.add_message('system', f'Asset deleted: {asset_path}', category='file', priority=3)
        cm.save_context_state()
        
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

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
    
    try:
        content = f.read_text(encoding="utf-8")
        
        # Add to context if requested
        if data.get('addToContext', False):
            cm = get_context_manager(project_id)
            cm.add_message('system', f'File read: {path}', category='file', priority=3)
            cm.save_context_state()
        
        return jsonify({"content": content})
    except UnicodeDecodeError:
        # Handle binary files
        return jsonify({"content": "[Binary file]", "binary": True})

@app.route('/api/project/save', methods=['POST'])
def project_save():
    """Save and optionally summarize a project file"""
    try:
        data = request.get_json() or {}
        project_id = data.get("projectId")
        path = data.get("path")
        content = data.get("content", "")
        summarize = bool(data.get("summarize"))
        chat_model = data.get("chat_model")
        
        if not project_id or not path:
            return jsonify({"error": "Missing projectId or path"}), 400
        
        f = _safe_join(project_id, path)
        f.write_text(content, encoding="utf-8")
        
        mf = _load_manifest(project_id)
        
        # CRITICAL FIX: Ensure files key exists
        if "files" not in mf:
            mf["files"] = {}
        
        entry = mf["files"].get(path, {})
        entry["hash"] = _hash_content(content)
        entry["size"] = len(content)
        entry["lang"] = pathlib.Path(path).suffix.lstrip(".").lower() or "text"
        entry["type"] = "asset" if path.startswith("assets/") else "code"
        entry["category"] = _get_file_category(path)
        entry["modified_at"] = datetime.datetime.utcnow().isoformat() + "Z"
        
        mf["files"][path] = entry
        _save_manifest(project_id, mf)
        
        # Add to context
        cm = get_context_manager(project_id)
        cm.add_message('system', f'File saved: {path}', category='file', priority=2)
        
        summary = None
        if summarize and chat_model:
            prompt_addon = ""
            if "phaser" in content.lower():
                prompt_addon = "\nFocus on: Phaser scenes, game objects, physics, input handling, and game loop logic."
            
            prompt = f"""Summarize this {'Phaser game' if 'phaser' in content.lower() else ''} file in <=10 lines:
- Purpose and functionality
- Key classes/functions
- Dependencies
- Public API{prompt_addon}

```{entry.get('lang','text')}
{content[:3000]}...
```"""
            
            try:
                # Add summarization request to context
                cm.add_message('user', f'Summarize {path}', category='system', priority=3)
                
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
                
                # Add summary to context
                cm.add_message('assistant', f'Summary of {path}: {summary}', category='file', priority=2)
                
            except Exception as e:
                print(f"Summarization failed: {e}")
                summary = None
        
        cm.save_context_state()
        
        return jsonify({
            "saved": True, 
            "hash": entry["hash"], 
            "summary": summary,
            "category": entry.get("category"),
            "type": entry.get("type")
        })
        
    except Exception as e:
        print(f"Error in project_save: {e}")
        return jsonify({"error": str(e)}), 500

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
    
    # Add to context
    cm = get_context_manager(project_id)
    if plan:
        cm.add_message('assistant', f'Project plan: {plan[:200]}...', category='plan', priority=1)
    if manifest_obj:
        cm.add_message('system', f'Manifest updated with {len(manifest_obj.get("files", []))} files', category='plan', priority=1)
    cm.save_context_state()
    
    return jsonify({"ok": True})

@app.route('/api/project/generate', methods=['POST'])
def project_generate_file():
    """Generate a specific project file with enhanced prompts and context management"""
    data = request.get_json() or {}
    project_id = data.get("projectId")
    target_path = data.get("path")
    chat_model = data.get("chat_model")
    code_model = data.get("code_model")
    
    if not project_id or not target_path or not code_model:
        abort(400, description="Missing required fields")
    
    # Get context manager and check for compression
    cm = get_context_manager(project_id)
    
    # Auto-compress if in automatic mode and threshold reached
    if cm.should_compress() and cm.mode == 'automatic':
        compression_result = cm.compress_context()
        print(f"Auto-compressed context: {compression_result.original_tokens} -> {compression_result.compressed_tokens} tokens")
    
    mf = _load_manifest(project_id)
    brief = mf.get("brief", "")
    plan = mf.get("plan") or ""
    manifest_obj = mf.get("manifest") or {}
    file_map = mf.get("files") or {}
    project_type = mf.get("type", "generic")
    
    # Get available assets
    assets = mf.get("assets", {})
    asset_list = []
    for asset_path, asset_info in assets.items():
        asset_list.append(f"- {asset_path} ({asset_info['category']})")
    
    # Enhanced file-specific generation instructions
    extra_instructions = _get_generation_instructions(target_path, project_type)
    
    # Collect file summaries for context
    summaries = []
    for p, meta in file_map.items():
        if meta.get("summary"):
            summaries.append(f"- {p}: {meta['summary'][:600]}")
    
    manifest_paths = [f.get("path") for f in (manifest_obj.get("files") or [])]
    
    # Use context manager's chat history
    chat_history = cm.get_chat_history()
    
    # Add generation request to context
    cm.add_message('user', f'Generate file: {target_path}', category='user', priority=1)
    
    # Special handling for index.html with assets
    if target_path == 'index.html':
        content = generate_index_with_assets(project_id, mf.get("name", "Game"))
        
        # Save generated file
        f = _safe_join(project_id, target_path)
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(content, encoding="utf-8")
        
        meta = {
            "hash": _hash_content(content),
            "size": len(content),
            "lang": "html",
            "type": "code",
            "category": "code",
            "generated_at": datetime.datetime.utcnow().isoformat() + "Z"
        }
        
        if "files" not in mf:
            mf["files"] = {}
        mf["files"][target_path] = {**mf["files"].get(target_path, {}), **meta}
        _save_manifest(project_id, mf)
        
        cm.add_message('assistant', f'Generated {target_path} with asset integration', category='file', priority=2)
        cm.save_context_state()
        
        return jsonify({
            "ok": True, 
            "path": target_path, 
            "hash": meta["hash"], 
            "content": content,
            "category": meta.get("category"),
            "type": meta.get("type"),
            "context_status": {
                'current_tokens': cm.current_tokens,
                'max_tokens': cm.max_tokens,
                'should_compress': cm.should_compress()
            }
        })
    
    prompt = f"""Generate the file: {target_path}

Project Type: {project_type}
Project Brief: {brief}

{extra_instructions}

Execution Plan:
{plan}

All Project Files:
{json.dumps(manifest_paths, indent=2)}

Available Assets:
{chr(10).join(asset_list) if asset_list else "(no assets uploaded yet)"}

File Intent: {next((f.get('intent', '') for f in manifest_obj.get('files', []) if f.get('path') == target_path), '')}

Existing File Summaries:
{chr(10).join(summaries) if summaries else "(none yet)"}

Rules:
- Output ONLY raw file content for {target_path}
- No markdown code fences, no commentary
- Use relative paths for imports (./file.js, ../folder/file.js)
- Reference uploaded assets from assets/ folder
- Maintain consistency with project structure
- For Phaser games, use proper Scene lifecycle methods
- Use Canvas renderer for iframe compatibility"""
    
    # Add generation prompt to context
    generation_messages = chat_history + [
        ENHANCED_CODE_SYSTEM_PROMPT,
        {"role": "user", "content": prompt}
    ]
    
    try:
        # FIXED: Increase timeout and add retry logic
        max_retries = 3
        retry_count = 0
        timeout_duration = 120  # Increased from 60 to 120 seconds
        
        while retry_count < max_retries:
            try:
                print(f"Attempting code generation (attempt {retry_count + 1}/{max_retries}) with {timeout_duration}s timeout...")
                
                r = requests.post(f"{OLLAMA_API_URL}/api/chat", json={
                    "model": code_model,
                    "messages": generation_messages,
                    "stream": False
                }, timeout=timeout_duration)
                
                r.raise_for_status()
                code = (r.json().get("message") or {}).get("content", "")
                
                if code and len(code.strip()) > 10:  # Basic validation
                    break
                else:
                    raise ValueError("Generated code is too short or empty")
                    
            except (requests.exceptions.Timeout, requests.exceptions.RequestException) as e:
                retry_count += 1
                if retry_count < max_retries:
                    wait_time = retry_count * 10  # Exponential backoff
                    print(f"Request failed (attempt {retry_count}), retrying in {wait_time}s... Error: {str(e)}")
                    time.sleep(wait_time)
                    timeout_duration += 30  # Increase timeout on retry
                    continue
                else:
                    raise
        
        # Clean up common issues
        code = _clean_generated_code(code)
        
        # Add generated code to context
        cm.add_message('assistant', f'Generated {target_path}: {code[:200]}...', category='file', priority=2)
        
    except Exception as e:
        error_message = str(e)
        print(f"Code generation failed for {target_path}: {error_message}")
        
        # Add more specific error messages
        if "timeout" in error_message.lower():
            error_message = f"Code generation timed out. The model may be processing a complex request. Try simplifying the file or using a faster model like 'codellama:7b' instead of larger models."
        elif "connection" in error_message.lower():
            error_message = f"Cannot connect to Ollama. Make sure Ollama is running and accessible at {OLLAMA_API_URL}"
        
        cm.add_message('system', f'Generation failed for {target_path}: {error_message}', category='system', priority=3)
        cm.save_context_state()
        return jsonify({"error": error_message}), 500
    
    # Save generated file
    f = _safe_join(project_id, target_path)
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(code, encoding="utf-8")
    
    meta = {
        "hash": _hash_content(code),
        "size": len(code),
        "lang": pathlib.Path(target_path).suffix.lstrip(".").lower(),
        "type": "asset" if target_path.startswith("assets/") else "code",
        "category": _get_file_category(target_path),
        "generated_at": datetime.datetime.utcnow().isoformat() + "Z"
    }
    
    if "files" not in mf:
        mf["files"] = {}
    mf["files"][target_path] = {**mf["files"].get(target_path, {}), **meta}
    _save_manifest(project_id, mf)
    
    cm.save_context_state()
    
    return jsonify({
        "ok": True, 
        "path": target_path, 
        "hash": meta["hash"], 
        "content": code,
        "category": meta.get("category"),
        "type": meta.get("type"),
        "context_status": {
            'current_tokens': cm.current_tokens,
            'max_tokens': cm.max_tokens,
            'should_compress': cm.should_compress()
        }
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
    """List all projects with enhanced info"""
    projects = []
    for project_dir in PROJECTS_DIR.iterdir():
        if project_dir.is_dir():
            manifest = _load_manifest(project_dir.name)
            if manifest:
                asset_count = len([f for f in manifest.get("files", {}).values() if f.get("type") == "asset"])
                code_count = len([f for f in manifest.get("files", {}).values() if f.get("type") == "code"])
                
                # Get context status
                cm = get_context_manager(project_dir.name)
                context_status = {
                    'current_tokens': cm.current_tokens,
                    'mode': cm.mode,
                    'compressions': len(cm.compression_history)
                }
                
                projects.append({
                    "id": manifest.get("id"),
                    "name": manifest.get("name"),
                    "type": manifest.get("type", "generic"),
                    "created_at": manifest.get("created_at"),
                    "file_count": len(manifest.get("files", {})),
                    "asset_count": asset_count,
                    "code_count": code_count,
                    "brief": manifest.get("brief", "")[:100] + ("..." if len(manifest.get("brief", "")) > 100 else ""),
                    "context_status": context_status
                })
    
    projects.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return jsonify({"projects": projects})

if __name__ == '__main__':
    print(f"Studio42 Enhanced with Context Management starting...")
    print(f"Ollama API URL: {OLLAMA_API_URL}")
    print(f"Projects directory: {PROJECTS_DIR}")
    print(f"Context directory: {CONTEXT_DIR}")
    print(f"Features: Multi-file projects, Asset management, Adaptive context management, Enhanced Preview")
    print(f"Context modes: Automatic, Manual, Hybrid")
    print(f"Access the UI at: http://127.0.0.1:5042")
    app.run(host='127.0.0.1', port=5042, debug=True)