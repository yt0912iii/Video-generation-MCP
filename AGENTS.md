# Video Generator Project Memory

This is an independent video-only frontend/backend extracted from the parent project. It intentionally excludes Agent conversation, LLM intent analysis, and image-generation UI.

Read `PROJECT_CONTEXT.md` at the start of each task. At the end of every meaningful task, record the user request, decisions, processing flow, changed files, validation, and remaining work there.

Runtime:

- `npm install`
- `npm run dev` (default `http://127.0.0.1:8834`)
- `npm run lint`
- `npm run build`

Backend endpoints:

- `GET /api/video/workflows`
- `POST /api/video/jobs`
- `GET /api/video/jobs/:jobId`
- `DELETE /api/video/jobs/:jobId`
- `GET /api/view-comfy`

The backend uses the ComfyUI service configured by `.env`; workflow JSON files are under `workflow/`.
