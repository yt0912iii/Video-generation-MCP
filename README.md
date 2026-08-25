# Independent Video Generator

這是從主專案抽離的獨立影片生成前端與後端，只保留 ComfyUI 影片 workflow，不包含 Agent 對話與圖像生成。

## 啟動

1. 複製 `.env.example` 為 `.env`，確認 ComfyUI 與 FFPROBE 路徑。
2. 安裝依賴：`npm install`
3. 開發模式：`npm run dev`
4. 正式建置：`npm run build`
5. 正式啟動：`npm run start`

預設網址：`http://127.0.0.1:8834`

Windows 使用者可以直接雙擊 `start.bat`，它會自動切換到目前資料夾、建立 `.env`、安裝依賴並啟動服務。

## 影片 API

- `GET /api/video/workflows`
- `POST /api/video/jobs`
- `GET /api/video/jobs/:jobId`
- `DELETE /api/video/jobs/:jobId`

## MCP 最小版本

先啟動影片 API，再執行 `npm run mcp`。MCP server 使用 stdio transport，透過 `MCP_API_URL`（預設 `http://127.0.0.1:8834`）呼叫既有影片 API。

提供的 tools：

- `list_video_workflows`
- `create_video_job`
- `upload_video_asset`
- `get_video_job`
- `list_video_jobs`
- `get_video_result`
- `cancel_video_job`

## Remote frontend and GPU host

Keep the frontend and MCP on the portable control side, and keep Backend, ComfyUI, models, and GPU on the same GPU host. Build the frontend with:

```env
VITE_BACKEND_URL=http://GPU_HOST:8834
```

Configure the GPU host Backend with:

```env
HOST=0.0.0.0
PORT=8834
COMFYUI_URL=http://127.0.0.1:8188
CORS_ORIGIN=http://FRONTEND_HOST
```

Configure MCP with:

```env
MCP_API_URL=http://GPU_HOST:8834
```

The browser and MCP call only the Video Generator API; ComfyUI remains private on the GPU host. API key authentication is not enabled yet, so `HOST=0.0.0.0` should only be used on a trusted LAN or VPN.

目前圖片與音訊仍使用 data URL 傳送，適合本機 MVP，不適合大型或多使用者部署。

影片 workflow 資產位於 `workflow/`。此專案目前與主專案共用相同的 ComfyUI 服務，但程式碼、前端頁面、任務 API 與 workflow JSON 已獨立。
