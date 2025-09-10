# Studio42 (Refactored)

- Flask serves from **/static** (index.html, script.js, style.css, logo.ico).
- New **Project API** exposes endpoints to init a project, set a plan/manifest, save/read files, and generate one file at a time with Ollama.
- Project data stored under **/projects/<projectId>** with `CONTEXT.md` and `project.json`.

## Quickstart
```bash
pip install -r requirements.txt
python app.py
# open http://127.0.0.1:5042/
```

## Endpoints
- `POST /api/proxy` → pass through to `http://localhost:11434`
- `POST /api/project/init` → {name, brief, chat_model, code_model} → {projectId}
- `GET  /api/project/tree?projectId=...`
- `POST /api/project/manifest` → {projectId, plan, manifest}
- `POST /api/project/generate` → {projectId, path, chat_model, code_model}
- `POST /api/project/save` → {projectId, path, content, summarize, chat_model}
- `POST /api/project/read` → {projectId, path}
