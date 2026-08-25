import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";
import WebSocket from "ws";

// ==========================================
// 0. 環境路徑與變數設定
// ==========================================
const COMFYUI_HTTP_URL = process.env.COMFYUI_HTTP_URL || "http://127.0.0.1:8188";
const COMFYUI_WS_URL = process.env.COMFYUI_WS_URL || "ws://127.0.0.1:8188/ws";
const ROOT_DIR = process.cwd();
const WORKFLOW_DIR = path.join(ROOT_DIR, "workflow");
const INPUT_DIR = path.join(ROOT_DIR, "comfyui_input");
const OUTPUT_DIR = path.join(ROOT_DIR, "comfyui_output");

if (!fs.existsSync(INPUT_DIR)) fs.mkdirSync(INPUT_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const comfyHost = new URL(COMFYUI_HTTP_URL).host;

// 記憶體中暫存的影片任務佇列
interface JobInfo {
  promptId: string;
  workflowName: string;
  status: "queued" | "generating" | "completed" | "failed";
  progress: { current: number; max: number };
  outputs: any[];
  error?: string;
  startTime: number;
}
const activeJobs = new Map<string, JobInfo>();

const server = new Server(
  {
    name: "digital-human-video-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ==========================================
// 1. 工作流配置
// ==========================================
export type VideoWorkflowType =
  | "ltx_dual_drive"
  | "eros_t2v"
  | "minimax_i2va"
  | "minimax_fl2va";

interface WorkflowConfig {
  id: VideoWorkflowType;
  fileNameMatch: string;
  name: string;
  description: string;
  requiresImage: boolean;
  allowsImage: boolean;
  requiresAudio: boolean;
  allowsAudio: boolean;
  supportsNegative: boolean;
  supportsPrompt: boolean;
  supportsFrames: boolean;
}

const WORKFLOW_CONFIGS: Record<VideoWorkflowType, WorkflowConfig> = {
  ltx_dual_drive: {
    id: "ltx_dual_drive",
    fileNameMatch: "LTX2.3",
    name: "LTX-Video 2.3 雙驅動極速版",
    description: "支援圖片角色 + 語音音訊雙重驅動生成流暢人像說話/動作影片。",
    requiresImage: true,
    allowsImage: true,
    requiresAudio: false,
    allowsAudio: true,
    supportsNegative: true,
    supportsPrompt: true,
    supportsFrames: true,
  },
  eros_t2v: {
    id: "eros_t2v",
    fileNameMatch: "10Eros",
    name: "10Eros 雙時鐘文生影 (8步極速)",
    description: "純文字提示詞驅動，8 步極速生成高動態短影片。",
    requiresImage: false,
    allowsImage: false,
    requiresAudio: false,
    allowsAudio: false,
    supportsNegative: true,
    supportsPrompt: true,
    supportsFrames: true,
  },
  minimax_i2va: {
    id: "minimax_i2va",
    fileNameMatch: "minimax_i2va",
    name: "MiniMax 圖生影片 + 音訊生成",
    description: "上傳單張靜態照片並輸入動作描述，生成自帶配音或動作之高畫質影片。",
    requiresImage: true,
    allowsImage: true,
    requiresAudio: false,
    allowsAudio: true,
    supportsNegative: false,
    supportsPrompt: true,
    supportsFrames: false,
  },
  minimax_fl2va: {
    id: "minimax_fl2va",
    fileNameMatch: "minimax_fl2va",
    name: "MiniMax 首尾幀生影",
    description: "依據首幀圖片與提示詞生成過渡運鏡影片。",
    requiresImage: true,
    allowsImage: true,
    requiresAudio: false,
    allowsAudio: false,
    supportsNegative: false,
    supportsPrompt: true,
    supportsFrames: false,
  },
};

// ==========================================
// 2. 動態註冊 Tools (新增 check_video_status)
// ==========================================
function loadDynamicTools(): Tool[] {
  const tools: Tool[] = [
    {
      name: "check_comfyui_status",
      description: "檢查本地 ComfyUI 影片生成服務連線狀態與 GPU 系統資源",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "check_video_status",
      description: "查詢特定生成任務的即時進度、狀態或取得生成完成的影片下載 URL",
      inputSchema: {
        type: "object",
        properties: {
          job_id: {
            type: "string",
            description: "生成任務的 Job ID (Prompt ID)",
          },
        },
        required: ["job_id"],
      },
    },
  ];

  for (const [id, config] of Object.entries(WORKFLOW_CONFIGS)) {
    const properties: any = {};
    const required: string[] = [];

    if (config.supportsPrompt) {
      properties.prompt = {
        type: "string",
        description: "影片動作與場景正向提示詞 (Positive Prompt)",
      };
      required.push("prompt");
    }

    if (config.supportsNegative) {
      properties.negative_prompt = {
        type: "string",
        description: "負面提示詞 (例如: blurry, distorted limbs, jerky motion)",
      };
    }

    if (config.allowsImage) {
      properties.image_input = {
        type: "string",
        description: "角色圖片：本地路徑、檔名或 Base64 字串",
      };
      if (config.requiresImage) required.push("image_input");
    }

    if (config.allowsAudio) {
      properties.audio_input = {
        type: "string",
        description: "驅動音訊 (MP3/WAV)：本地路徑、檔名或 Base64 字串",
      };
      if (config.requiresAudio) required.push("audio_input");
    }

    if (config.supportsFrames) {
      properties.length = {
        type: "number",
        description: "生成總幀數 (例如 81, 97, 129 等，預設 81)",
      };
      properties.fps = {
        type: "number",
        description: "影片幀率 (預設 24 或 25)",
      };
    }

    properties.seed = {
      type: "number",
      description: "隨機種子碼（不填則自動生成）",
    };
    properties.motion_bucket_id = {
      type: "number",
      description: "動態幅度 (預設 127，數值越高動態越大)",
    };

    tools.push({
      name: `run_${config.id}`,
      description: `[${config.name}] ${config.description} (非同步提交)`,
      inputSchema: {
        type: "object",
        properties,
        required,
      },
    });
  }

  return tools;
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: loadDynamicTools() };
});

// ==========================================
// 3. 媒體檔案處理
// ==========================================
async function processInputMedia(mediaInput: string, isAudio = false): Promise<string> {
  let mediaBuffer: Buffer;
  const ext = isAudio ? ".mp3" : ".png";
  let filename = `mcp_upload_${Date.now()}${ext}`;

  if (mediaInput.startsWith("data:") || mediaInput.length > 500) {
    const base64Data = mediaInput.replace(/^data:\w+\/\w+;base64,/, "");
    mediaBuffer = Buffer.from(base64Data, "base64");
  } else if (fs.existsSync(mediaInput)) {
    filename = path.basename(mediaInput);
    mediaBuffer = fs.readFileSync(mediaInput);
  } else {
    const localPath = path.join(INPUT_DIR, mediaInput);
    if (fs.existsSync(localPath)) {
      filename = mediaInput;
      mediaBuffer = fs.readFileSync(localPath);
    } else {
      return mediaInput;
    }
  }

  fs.writeFileSync(path.join(INPUT_DIR, filename), mediaBuffer);

  try {
    const formData = new FormData();
    const mimeType = isAudio ? "audio/mpeg" : "image/png";
    const blob = new Blob([mediaBuffer], { type: mimeType });
    formData.append(isAudio ? "audio" : "image", blob, filename);
    formData.append("overwrite", "true");

    const endpoint = isAudio ? "/upload/audio" : "/upload/image";
    const uploadRes = await fetch(`${COMFYUI_HTTP_URL}${endpoint}`, {
      method: "POST",
      headers: { Host: comfyHost, Origin: COMFYUI_HTTP_URL },
      body: formData,
    });

    if (uploadRes.ok) {
      const uploadData = (await uploadRes.json()) as { name: string };
      return uploadData.name || filename;
    }
  } catch (err) {}

  return filename;
}

// ==========================================
// 4. 參數注入
// ==========================================
async function injectVideoParameters(workflowObj: any, params: any, config: WorkflowConfig) {
  const seed = params.seed ?? Math.floor(Math.random() * 10000000000);
  const targetImage = params.image_input ? await processInputMedia(params.image_input, false) : undefined;
  const targetAudio = params.audio_input ? await processInputMedia(params.audio_input, true) : undefined;
  const finalPrompt = params.prompt ?? "cinematic video, high quality, digital human speaking smoothly, 4k";

  for (const nodeId in workflowObj) {
    const node = workflowObj[nodeId];
    if (!node || !node.inputs) continue;

    if (node.class_type === "CLIPTextEncode" || node.class_type === "TextPrompt") {
      const isNegative = String(node._meta?.title || "").toLowerCase().includes("negative");
      if (isNegative && config.supportsNegative && params.negative_prompt) {
        node.inputs.text = params.negative_prompt;
      } else if (!isNegative && config.supportsPrompt) {
        node.inputs.text = finalPrompt;
      }
    }

    if (node.class_type === "LoadImage" && targetImage) {
      node.inputs.image = targetImage;
    }

    if ((node.class_type === "LoadAudio" || node.class_type === "VHS_LoadAudio") && targetAudio) {
      node.inputs.audio = targetAudio;
    }

    if (node.class_type?.includes("KSampler") || node.class_type?.includes("Sampler")) {
      if ("seed" in node.inputs) node.inputs.seed = seed;
      if ("noise_seed" in node.inputs) node.inputs.noise_seed = seed;
    }

    if (
      node.class_type?.includes("EmptyLatentVideo") ||
      node.class_type?.includes("LTXV") ||
      node.class_type?.includes("VideoLinearCFGGuidance")
    ) {
      if (params.length && "length" in node.inputs) node.inputs.length = params.length;
      if (params.length && "frame_count" in node.inputs) node.inputs.frame_count = params.length;
    }

    if (node.class_type === "VHS_VideoCombine" || node.class_type?.includes("SaveVideo")) {
      if (params.fps && "frame_rate" in node.inputs) node.inputs.frame_rate = params.fps;
      if (params.fps && "fps" in node.inputs) node.inputs.fps = params.fps;
    }
  }

  return workflowObj;
}

// ==========================================
// 5. 後台非同步任務監聽
// ==========================================
function startBackgroundWatcher(promptId: string, clientId: string, workflowName: string) {
  const job: JobInfo = {
    promptId,
    workflowName,
    status: "queued",
    progress: { current: 0, max: 0 },
    outputs: [],
    startTime: Date.now(),
  };
  activeJobs.set(promptId, job);

  const ws = new WebSocket(`${COMFYUI_WS_URL}?clientId=${clientId}`, {
    headers: { Origin: COMFYUI_HTTP_URL, Host: comfyHost },
  });

  const cleanup = () => {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  };

  ws.on("message", (data: string) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === "progress") {
        job.status = "generating";
        job.progress = { current: message.data.value, max: message.data.max };
      }

      if (message.type === "executed" && message.data?.prompt_id === promptId) {
        const output = message.data.output;
        if (output?.videos) job.outputs.push(...output.videos);
        if (output?.gifs) job.outputs.push(...output.gifs);
        if (output?.images) job.outputs.push(...output.images);
      }

      if (message.type === "execution_success" && message.data?.prompt_id === promptId) {
        job.status = "completed";
        cleanup();
      }

      if (message.type === "status" && message.data?.status?.exec_info?.queue_remaining === 0) {
        if (job.outputs.length > 0) {
          job.status = "completed";
          cleanup();
        }
      }
    } catch (err) {}
  });

  ws.on("error", (err) => {
    job.status = "failed";
    job.error = err.message;
    cleanup();
  });
}

// ==========================================
// 6. Tool 請求處理中心
// ==========================================
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // 1. 連線診斷
  if (name === "check_comfyui_status") {
    try {
      const res = await fetch(`${COMFYUI_HTTP_URL}/system_stats`, {
        headers: { Host: comfyHost, Origin: COMFYUI_HTTP_URL },
      });
      if (res.ok) {
        const stats = await res.json();
        return {
          content: [
            {
              type: "text",
              text: `✅ ComfyUI 影片引擎連線正常！\n系統資訊：\n${JSON.stringify(stats, null, 2)}`,
            },
          ],
        };
      }
      return { content: [{ type: "text", text: `❌ ComfyUI 狀態碼: ${res.status}` }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `❌ 連線失敗: ${e.message}` }] };
    }
  }

  // 2. 查詢任務狀態
  if (name === "check_video_status") {
    const { job_id } = args as { job_id: string };
    const job = activeJobs.get(job_id);

    if (!job) {
      return {
        content: [
          {
            type: "text",
            text: `⚠️ 找不到 Job ID [${job_id}]。可能伺服器重啟或 ID 錯誤。`,
          },
        ],
      };
    }

    if (job.status === "completed") {
      const elapsed = ((Date.now() - job.startTime) / 1000).toFixed(1);
      const results = job.outputs.map((item) => {
        const isVideo = item.filename?.endsWith(".mp4") || item.format?.includes("video");
        const typeLabel = isVideo ? "影片" : "影格/預覽";
        return `• [${typeLabel}] 檔名: ${item.filename}\n  預覽/下載 URL: ${COMFYUI_HTTP_URL}/view?filename=${encodeURIComponent(item.filename)}&type=${item.type || "output"}\n  本地路徑: ${path.join(OUTPUT_DIR, item.filename || "")}`;
      });

      return {
        content: [
          {
            type: "text",
            text: `🎬 [${job.workflowName}] 生成完成！(總耗時: ${elapsed} 秒)\n\n${results.length > 0 ? results.join("\n\n") : "任務完成，請至 comfyui_output 目錄查看。"}`,
          },
        ],
      };
    }

    if (job.status === "failed") {
      return {
        content: [{ type: "text", text: `❌ 生成失敗: ${job.error || "未知錯誤"}` }],
      };
    }

    const progressStr = job.progress.max > 0 ? ` (步數: ${job.progress.current}/${job.progress.max})` : "";
    return {
      content: [
        {
          type: "text",
          text: `⏳ 任務生成中... 狀態: [${job.status}]${progressStr}\n請稍後再次執行 check_video_status 查詢。`,
        },
      ],
    };
  }

  // 3. 提交影片生成任務
  if (name.startsWith("run_")) {
    const workflowId = name.replace("run_", "") as VideoWorkflowType;
    const config = WORKFLOW_CONFIGS[workflowId];

    if (!config) throw new Error(`找不到配置：${workflowId}`);

    const files = fs.readdirSync(WORKFLOW_DIR);
    const matchedFile = files.find((f) => f.includes(config.fileNameMatch) && f.endsWith(".json"));

    if (!matchedFile) {
      return {
        content: [{ type: "text", text: `❌ 找不到關鍵字 "${config.fileNameMatch}" 的工作流檔案` }],
      };
    }

    try {
      const rawWorkflow = JSON.parse(
        fs.readFileSync(path.join(WORKFLOW_DIR, matchedFile), "utf-8")
      );

      const modifiedPrompt = await injectVideoParameters(rawWorkflow, args || {}, config);
      const clientId = `mcp_video_${Math.random().toString(36).substring(7)}`;

      const response = await fetch(`${COMFYUI_HTTP_URL}/prompt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: COMFYUI_HTTP_URL,
          Host: comfyHost,
        },
        body: JSON.stringify({ prompt: modifiedPrompt, client_id: clientId }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ComfyUI 錯誤: ${errorText}`);
      }

      const { prompt_id } = (await response.json()) as { prompt_id: string };

      // 啟動後台監聽
      startBackgroundWatcher(prompt_id, clientId, config.name);

      return {
        content: [
          {
            type: "text",
            text: `🚀 [${config.name}] 影片任務已提交成功！\n\n• Job ID: ${prompt_id}\n\n👉 由於影片運算需時較長，請使用「check_video_status」工具並帶入此 Job ID 查詢即時進度與下載連結。`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `❌ 任務提交失敗: ${error.message}` }],
      };
    }
  }

  throw new Error(`未知的工具: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Digital Human Video MCP Server 啟動中 (stdio)");
}

main().catch(console.error);