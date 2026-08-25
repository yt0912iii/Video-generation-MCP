# Video Generator Project Context

## 2026-08-19 — Initial extraction

- User request: create a separate frontend/backend containing only video generation, removing Agent conversation and image generation.
- Location: `E:\digital-human-workflow-agent\video-generator`.
- Frontend: standalone React/Vite single-page video workstation with workflow selection, prompt, negative prompt, duration, aspect ratio, image/audio upload, async status polling, cancellation, and video playback.
- Backend: standalone Express/Vite-middleware server with video workflow registry, ComfyUI submission/history polling, job lifecycle, input validation, cancellation, output proxy, and workflow mapping validation.
- Included workflow assets: MiniMax text-to-video, MiniMax image-to-video, MiniMax first/last frame, and LTX2.3 image/audio lip-sync.
- Excluded: Agent chat, vLLM/Ollama intent analysis, image-generation tab, general gallery/avatar UI.
- Validation: Vite frontend build and esbuild backend bundle succeeded using the parent project's installed binaries.
- Added cancellation race protection so a cancelled job cannot later be overwritten as completed after submit or history polling.
- Pending: run `npm install` inside the independent project, then run `npm run lint`; the attempted install timed out before completing because dependency download was unavailable/slow in the current environment.
- User clarified the independent project must live directly under `E:\`; copied the project to `E:\digital-human-video-generator`.
- Added `start.bat` to automatically enter the project directory, create `.env` from `.env.example`, install dependencies when missing, and run the development server on port 8834.
- Diagnosed the original immediate exit: the copied batch file had LF line endings and encoding/parser issues for `cmd.exe`; replaced it with an ASCII CRLF Windows batch file using `where.exe` and `npm.cmd`.
- Installed dependencies successfully in `E:\digital-human-video-generator` (`162 packages`).
- Validation in the direct E: project: `npm.cmd run lint` and `npm.cmd run build` both pass.
- Rechecked both projects: `npm.cmd run dev` fails in the current machine with Node/tsx `uv_os_get_passwd returned ENOMEM`; the original parent project fails identically, so this is not caused by extraction. Running the built standalone server with `node dist\\server.cjs` succeeds on port 8834.
- Changed the standalone `dev` script to build then run the bundled server, avoiding the failing tsx runtime path.
- User clarified that the extracted frontend must retain the original project's video-generation screen and interaction style; replaced the simplified standalone UI with the original `VideoGenerationView` layout and Tailwind styling, while keeping the standalone async video API.
- User further clarified that the entire shell should match the original project, not only the video panel. Restored the original Header, GPU/ComfyUI status badges, settings modal, top navigation styling, max-width layout, spacing, and dark theme; retained only the Video tab.
- User requested ratio labels with resolutions and an expandable custom width/height option without changing layout. Added `1152 × 640` / `橫向畫幅（16:9）`, `640 × 1152` / `直向畫幅（9:16）`, and custom inputs. Preset aspect-ratio values sent to ComfyUI remain unchanged; MiniMax H3 custom dimensions map to Node 6 `width`/`height`.
- Validation after this change: `npm.cmd run lint` and `npm.cmd run build` pass in `E:\digital-human-video-generator`.
- Expanded the custom-resolution button to `col-span-2`, so it spans the same combined width as the two preset ratio buttons above.
- Added an image-to-video-only `original` ratio option above custom size. The UI reads the uploaded first-frame natural width/height, displays them with the note `參考首幀圖片`, and sends those dimensions to MiniMax Node 6 `width`/`height`. Validation passes after the change.
- Latest user clarification: the image-to-video `維持原圖片解析度` button must have the same full two-column width as `自定義解析度`; updated the button class accordingly.
- Latest validation: `npm.cmd run lint` and `npm.cmd run build` pass in `E:\digital-human-video-generator`.

## Review memory — 2026-08-19

- User request: review whether this project needs optimization or additions before exposing it as an MCP server.
- Findings: the project currently exposes HTTP endpoints only; no MCP SDK/server, tool schema, resource URI, or MCP transport is present.
- Recommended MCP surface: `list_video_workflows`, `create_video_job`, `get_video_job`, `cancel_video_job`, and `get_video_result`; expose workflow metadata and job/result resources, while keeping ComfyUI internal.
- Priority concerns: in-memory job storage, base64 uploads in JSON, permissive CORS, no request authentication/rate limiting, unbounded job polling, weak input validation, and output proxy path/query hardening.
- Compatibility concern: workflow filenames and user-facing strings appear garbled in terminal output and should be normalized to UTF-8-safe IDs/metadata before publishing an external MCP contract.
- Validation: `npm.cmd run lint` and `npm.cmd run build` pass; no MCP references were found outside dependencies.
- Remaining work: implement MCP adapter and the hardening items only after deciding whether MCP runs in-process or as a separate stdio/HTTP process.

## MCP MVP implementation — 2026-08-19

- User request: implement the minimal MCP version first and explain what to review.
- Decision: add a separate stdio MCP adapter so the existing Express API and frontend remain unchanged.
- Added `mcp-server.ts` using the official `@modelcontextprotocol/sdk`.
- Added tools: `list_video_workflows`, `create_video_job`, `get_video_job`, `get_video_result`, and `cancel_video_job`.
- Added Zod input validation for workflow IDs, prompt lengths, image/audio payload sizes, aspect ratios, dimensions, and job IDs.
- Added `MCP_API_URL` configuration and `npm run mcp` / `npm run build:mcp` scripts.
- MVP limitation: images and audio are still passed as data URLs; this should become asset/resource references before large or multi-user deployment.
- Validation: `npm.cmd run lint`, `npm.cmd run build`, and `npm.cmd run build:mcp` pass.

## Pending UI task center design — 2026-08-19

- User wants generation tasks to remain visible after switching to another generation mode.
- Proposed behavior: add a collapsible left-side task center/drawer, visually similar to a second page or workspace panel.
- The task center should show currently running jobs and their progress/waiting state; completed jobs should show a compact video thumbnail.
- Clicking a completed thumbnail should open a large-screen video preview, with a download action available.
- Important implementation decision: move job/task state above `VideoGenerationView` (likely into `App` or a dedicated task-center component/store) so switching workflow modes does not unmount or lose the active task preview.
- This UI task is pending implementation; the user plans to continue modifying it later.

## Video task center implementation — 2026-08-19

- User request: add a video task center that remains visible while switching generation modes, shows the current processing count, and is linked to ComfyUI status.
- Added `VideoTask` state and task updates from `VideoGenerationView` to the app-level state.
- Added `VideoTaskCenter` as a left-side collapsible drawer with a top-right active-count badge.
- The drawer shows local active tasks, ComfyUI queue count, connection state, queued/running/completed/failed status, compact video previews, full-screen playback, and download controls.
- Completed tasks remain in the task center after switching workflow modes; the main generation preview can still change independently.
- Validation: `npm.cmd run lint` and `npm.cmd run build` pass.

## Queue status ordering fix — 2026-08-19

- User reported that two task cards kept swapping positions and both could appear to process instead of showing one processing and one queued.
- Root cause: app-level task updates moved the updated task to the front on every poll; backend marked every submitted ComfyUI prompt as `running` immediately.
- Fix: preserve task insertion order in `App.tsx`; read ComfyUI `/queue` and map `queue_running` to `running` and `queue_pending` to `queued`.
- Added a safe fallback to `running` when queue state is unavailable, so polling still completes if the ComfyUI queue endpoint temporarily fails.
- Validation: `npm.cmd run lint` and `npm.cmd run build` pass.

## Task status and workflow switching refinement — 2026-08-19

- User request: show explicit task status and submission time in the video task center; after switching workflow modes, restore the new workflow's render button instead of showing the previous workflow as still rendering.
- Updated status labels to `正在排隊`, `正在處理`, `已完成`, `失敗`, and `已取消`.
- Added `送出時間` to every task card and `處理耗時` for completed jobs.
- Changed generation activity tracking from one global counter to per-workflow counters, so switching to a workflow with no active jobs restores its render button while background jobs continue in the task center.
- Validation: `npm.cmd run lint` and `npm.cmd run build` pass.
- Browser visual validation was unavailable because no local browser connection was available in the environment.
- User clarification: the task-center trigger should be fixed on the right side, and the drawer should expand leftward from the right edge.
- Updated the task-center trigger and drawer positioning from left to right; task behavior and ComfyUI linkage are unchanged.

## Concurrent video generation UX — 2026-08-19

- User request: move the active-task count badge to the upper-left of the right-side task-center button; allow continuous submission of new video jobs; warn before switching workflow modes while jobs are active; allow staying or switching, with results retained in the task center.
- Removed the global generation-button lock caused by `isLoading`; generation count is now tracked so multiple submissions can run and be monitored independently.
- MCP readiness review: the current stdio MCP MVP is suitable for local single-user testing, but should not be exposed remotely or to multiple users yet.
- Before formal MCP export, prioritize replacing the in-memory `VideoJobStore` with persistent storage plus expiry/cleanup, and add authentication, rate limiting, per-client concurrency limits, and upload quotas.
- Next priorities: replace base64 media with asset/resource references; formalize stable JSON contracts for queue/processing/completed/failed/cancelled states, timestamps, queue position, output metadata, and retry-safe cancellation; add an optional `list_video_jobs` tool.
- Harden output ownership and `/api/view-comfy` path/subfolder handling, stream media instead of buffering it, add workflow schema/version validation, and add integration tests for concurrent jobs, queue transitions, cancellation, ComfyUI disconnects, and MCP tool responses.
- User clarification: Video Generator API itself should also be portable. It can move to another computer, but the current implementation assumes local ComfyUI input/output folders; portability requires API-based media upload and a reachable `COMFYUI_URL` when ComfyUI remains on the GPU host.
- User confirmed target mechanism: MCP, Video Generator API, frontend, and control logic may run on other computers, while ComfyUI execution must remain on this computer and consume this computer's GPU/resources.
- Required architecture direction: separate portable control plane from fixed GPU execution plane. The GPU host should own ComfyUI access, local assets/outputs, execution queue, and authoritative job state; remote MCP/API should call the GPU host through authenticated network APIs.
- Next requested work: identify the concrete optimizations and additions required to implement this split deployment safely.
- Architecture finalized: portable frontend and MCP are the control plane; Backend + ComfyUI + GPU + models + local assets are the fixed execution plane on this computer.
- Updated frontend to use `VITE_BACKEND_URL` instead of assuming `window.location.origin`, allowing the UI to be hosted elsewhere while calling the GPU-host Backend.
- Added Vite environment typing and documented `VITE_BACKEND_URL`, `HOST`, `COMFYUI_URL`, `CORS_ORIGIN`, and `MCP_API_URL` deployment examples.
- API key authentication remains intentionally deferred.
- Validation after architecture configuration: `npm.cmd run lint`, `npm.cmd run build`, and `npm.cmd run build:mcp` pass.
- Remote MCP test plan: run Backend + ComfyUI on the GPU host with `HOST=0.0.0.0`; verify `/api/health` and `/api/video/workflows` from a second computer; set remote MCP `MCP_API_URL=http://GPU_HOST:8834`; then test `list_video_workflows`, `create_video_job`, `get_video_job`, `list_video_jobs`, `get_video_result`, and `cancel_video_job` through an MCP client. Keep this LAN/VPN-only until API authentication is added.
- User asked which parts can be modified now and what environment information is needed before implementing the split deployment.
- Proposed no-clarification first phase: make the current server a GPU-host execution gateway with configurable `HOST`, authentication, persistent jobs, queue-aware status, job listing, safe result streaming, and API-based asset upload; keep ComfyUI private on the GPU host.
- Information needed for the later control-plane split: network topology (LAN/VPN/public), location of MCP and Video API, GPU host address/DNS, authentication/HTTPS preference, GPU-host storage paths, ComfyUI version/API availability, asset/output retention policy, and deployment OS/runtime versions. Secrets should be supplied through environment files, not chat.
- User approved modifying the other parts first and explicitly deferred API key authentication.
- Implemented first phase without authentication: file-persisted job store under `PROJECT_DATA_DIR`, `GET /api/video/jobs`, persisted workflow metadata, queue position, job timestamps, job-bound streamed result endpoint, configurable `HOST`, task-center restoration after page reload, and MCP `list_video_jobs`.
- The current server is now better suited as the GPU-host gateway, but full control-plane separation still needs authenticated remote transport and a dedicated asset upload/resource flow.
- Validation: `npm.cmd run lint`, `npm.cmd run build`, and `npm.cmd run build:mcp` pass.
- Additional non-auth changes implemented: configurable CORS origin, `/api/health`, persisted job retention cleanup, reusable GPU-host assets via `POST /api/video/assets`, asset IDs accepted by video jobs, MCP `upload_video_asset`, and `JOB_RETENTION_HOURS` configuration.
- API key authentication remains intentionally unimplemented per user instruction.
- User asked whether the current project can now be exported as MCP and what remains before export.
- Current answer/status: it is exportable as a local single-user MCP MVP; it is not yet ready for safe remote or multi-user deployment.
- User provided a reference deployment using `VITE_COMFYUI_IP`, `VITE_COMFYUI_PORT`, `VITE_BACKEND_IP`, and `VITE_BACKEND_PORT`, where a remotely hosted frontend calls a backend that generates through another machine's ComfyUI.
- Architecture clarification: this project should use a public/runtime backend URL for the frontend and a separate server-side `COMFYUI_URL` for the backend-to-GPU connection. The browser should preferably not call ComfyUI directly.
- Important gap: if the backend is hosted away from the ComfyUI machine, direct local-folder writes via `COMFYUI_INPUT_DIR` will not work; uploads must be sent through ComfyUI's HTTP upload API or a GPU-host worker.
- Deployment refinement: for the current project, Backend and ComfyUI should be colocated on the GPU host. The portable control plane is the frontend and MCP; the fixed execution plane is Backend + ComfyUI + GPU + local assets/models.
- Rationale: colocating avoids remote filesystem problems, keeps local input/output handling valid, reduces upload latency and failure points, and allows ComfyUI to remain private on localhost. Separating Backend from ComfyUI is possible later but requires a worker/upload/API refactor.
- Deployment decision: user selected Mode B. The MCP client/server may run on another computer, while this computer remains the video-generation/GPU host.
- Target architecture: remote MCP → network API → this computer's Video Generator API → local `127.0.0.1:8188` ComfyUI → local GPU/models.
- Important clarification: the remote computer should not use its own local ComfyUI or filesystem. The video host may continue using local ComfyUI internally, but remote uploads must reach the video host through an API and then be uploaded/managed on the host side.
- Required next implementation direction: expose the Video Generator API safely over the network with authentication, configure `HOST`/`MCP_API_URL`, move media transfer to API-based upload or asset references, and keep ComfyUI itself private behind the video service.
- Added a workflow-switch warning modal with `留在目前頁面` and `繼續切換生成方式` actions.
- Passed active task count from `App` into `VideoGenerationView` for the warning message.
- Validation: `npm.cmd run lint` and `npm.cmd run build` pass.

## Conversation memory — 2026-08-19

- User requested the extracted video frontend to retain the original project's complete interface, removing only Agent chat and image generation.
- User requested ratio labels with resolutions: `1152 × 640` for 16:9 and `640 × 1152` for 9:16, while keeping the original ComfyUI ratio values.
- User requested a custom resolution option with expandable width/height inputs; MiniMax H3 text-to-video and image-to-video send custom values to Node 6 `width` and `height`.
- User requested image-to-video to add `維持原圖片解析度` above custom resolution, display the uploaded first-frame dimensions, note `參考首幀圖片`, and send those dimensions to Node 6.
- User clarified that both `維持原圖片解析度` and `自定義解析度` must span the combined width of the two preset ratio buttons.
-
## MCP readiness re-analysis 2026-08-19

- User asked whether the project can now be provided to others as MCP and what still needs optimization.
- Confirmed the repository contains a stdio MCP adapter with tools: `list_video_workflows`, `create_video_job`, `upload_video_asset`, `get_video_job`, `list_video_jobs`, `get_video_result`, and `cancel_video_job`.
- Confirmed validation: `npm.cmd run lint`, `npm.cmd run build`, and `npm.cmd run build:mcp` all pass.
- Clarified deployment model: the recipient must configure an MCP client to launch this MCP process, set `MCP_API_URL` to the GPU host Video Generator API, and have network access to that host. Sharing only the source folder or only an MCP URL is not sufficient for the current stdio implementation.
- Current safe scope: local single-user use, or trusted LAN/VPN testing with Backend + ComfyUI colocated on the GPU host. It is not ready for public Internet or untrusted multi-user access because API authentication/authorization is absent, job and asset endpoints are globally accessible, CORS defaults to permissive behavior when unset, and ComfyUI output is exposed through proxy/static routes.
- Highest-priority remaining hardening: API key or stronger authentication, per-user job ownership, rate/concurrency/upload limits, stricter CORS and network firewall rules, job transition/recovery handling after restart, and integration tests for concurrent jobs/cancellation/ComfyUI failures.
- Secondary improvements: replace or minimize data-URL transport with upload/resource references, validate workflow IDs and all API request bodies on the Backend (not only in MCP), add pagination/filtering to job listing, add retry/timeout/backoff and structured logs, verify output path/subfolder ownership, and fix UTF-8/garbled Chinese metadata in source files and documentation.
