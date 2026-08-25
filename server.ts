import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { randomUUID } from 'crypto';
import cors from 'cors';

// 常數路徑與 URL 配置
const COMFYUI_URL = process.env.COMFYUI_URL || 'http://127.0.0.1:8188';
const COMFYUI_OUTPUT_DIR = process.env.COMFYUI_OUTPUT_DIR || path.join(process.cwd(), 'comfyui_output');

// vLLM configuration
const VLLM_URL = process.env.VLLM_URL || 'http://192.168.50.200:8787';
const VLLM_MODEL = process.env.VLLM_MODEL || 'cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit';

// 常用比例對應的標準生成尺寸（適配 FLUX / SDXL / MiniMax）
const ASPECT_RATIO_MAP: Record<string, { width: number; height: number }> = {
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '4:3': { width: 1024, height: 768 },
  '3:4': { width: 768, height: 1024 },
  '1:1': { width: 1024, height: 1024 },
  '21:9': { width: 1344, height: 576 },
  '3:2': { width: 1152, height: 768 },
  '2:3': { width: 768, height: 1152 },
};

const CN_NUM_MAP: Record<string, number> = {
  '一': 1, '二': 2, '兩': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '十六': 16, '二十一': 21,
};

function parseDimensions(text: string, defaultW = 768, defaultH = 1024): { width: number; height: number; hasSpecified: boolean } {
  if (!text) return { width: defaultW, height: defaultH, hasSpecified: false };

  const pixelMatch = text.match(/(\d{3,4})\s*[x*×]\s*(\d{3,4})/i);
  if (pixelMatch) {
    let w = parseInt(pixelMatch[1], 10);
    let h = parseInt(pixelMatch[2], 10);
    w = Math.round(w / 16) * 16;
    h = Math.round(h / 16) * 16;
    return { width: Math.max(64, w), height: Math.max(64, h), hasSpecified: true };
  }

  const ratioMatch = text.match(/(\d{1,2})\s*[:：比對到]\s*(\d{1,2})/);
  if (ratioMatch) {
    const key = `${ratioMatch[1]}:${ratioMatch[2]}`;
    if (ASPECT_RATIO_MAP[key]) {
      return { ...ASPECT_RATIO_MAP[key], hasSpecified: true };
    }
  }

  const cnRatioMatch = text.match(/(十六|二十一|[一二兩三四五六七八九十]+)\s*比\s*([一二兩三四五六七八九十]+)/);
  if (cnRatioMatch) {
    const n1 = CN_NUM_MAP[cnRatioMatch[1]];
    const n2 = CN_NUM_MAP[cnRatioMatch[2]];
    if (n1 && n2) {
      const key = `${n1}:${n2}`;
      if (ASPECT_RATIO_MAP[key]) {
        return { ...ASPECT_RATIO_MAP[key], hasSpecified: true };
      }
    }
  }

  if (/橫向|橫式|landscape/i.test(text)) return { width: 1024, height: 768, hasSpecified: true };
  if (/直向|直式|portrait/i.test(text)) return { width: 768, height: 1024, hasSpecified: true };
  if (/正方形|方形|square/i.test(text)) return { width: 1024, height: 1024, hasSpecified: true };

  return { width: defaultW, height: defaultH, hasSpecified: false };
}

// 🎯 原生 Multipart 上傳圖片至 ComfyUI Input 目錄
async function uploadBufferToComfyUI(buffer: Buffer, filename: string): Promise<string> {
  const boundary = `----WebKitFormBoundary${randomUUID().replace(/-/g, '')}`;
  
  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="image"; filename="${filename}"\r\n` +
    `Content-Type: image/png\r\n\r\n`
  );
  
  const overwritePart = Buffer.from(
    `\r\n--${boundary}\r\n` +
    `Content-Disposition: form-data; name="overwrite"\r\n\r\n` +
    `true\r\n` +
    `--${boundary}--\r\n`
  );
  
  const body = Buffer.concat([header, buffer, overwritePart]);

  const res = await fetch(`${COMFYUI_URL}/upload/image`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: body,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`上傳圖片到 ComfyUI 失敗 (${res.status}): ${errText}`);
  }

  const data = await res.json();
  console.log(`[ComfyUI Upload] ✅ 圖片已成功寫入 ComfyUI Input: ${data.name}`);
  return data.name;
}

// 解析 Base64、URL 並安全推送
async function resolveAndUploadImage(imageDataOrUrl: string, targetFilename: string): Promise<string> {
  if (!imageDataOrUrl || typeof imageDataOrUrl !== 'string') return '';

  try {
    if (imageDataOrUrl.startsWith('data:image')) {
      const base64Data = imageDataOrUrl.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      return await uploadBufferToComfyUI(buffer, targetFilename);
    }

    if (imageDataOrUrl.startsWith('/api/view-comfy') || imageDataOrUrl.startsWith('/comfyui_output')) {
      const urlMatch = imageDataOrUrl.match(/filename=([^&]+)/);
      const rawName = urlMatch ? decodeURIComponent(urlMatch[1]) : path.basename(imageDataOrUrl);
      const fetchUrl = `${COMFYUI_URL}/view?filename=${encodeURIComponent(rawName)}&type=output`;
      const res = await fetch(fetchUrl);
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer());
        return await uploadBufferToComfyUI(buffer, targetFilename);
      }
    }

    if (imageDataOrUrl.startsWith('http://') || imageDataOrUrl.startsWith('https://')) {
      const res = await fetch(imageDataOrUrl);
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer());
        return await uploadBufferToComfyUI(buffer, targetFilename);
      }
    }

    return imageDataOrUrl;
  } catch (e: any) {
    console.error('[Upload Error] 處理圖片失敗:', e.message);
    throw e;
  }
}

// 任務佇列資料結構
interface VideoJob {
  id: string;
  workflowId: string;
  workflowName: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  promptId?: string;
  createdAt: string;
  updatedAt: string;
  queuePosition?: number;
  result?: {
    outputUrl?: string;
    executionTimeMs?: number;
    avatarResponse?: { text: string };
  };
  error?: { message: string };
}

const JOBS_DB: Map<string, VideoJob> = new Map();

async function startServer() {
  const PORT = 8833;
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ extended: true, limit: '100mb' }));

  if (!fs.existsSync(COMFYUI_OUTPUT_DIR)) fs.mkdirSync(COMFYUI_OUTPUT_DIR, { recursive: true });

  const LLM_DISPATCH_PROMPT = `你是一位專業的 ComfyUI 生成式 AI 數位人專員。
請分析使用者的輸入意圖與提供的上下文，將其分類至最適當的工作流，並將提詞優化為高品質 Prompt。

**可用工作流清單：**
1. 純對話/問對話 (Chat Only) -> workflowId: "chat_only"
2. FLUX 高品質文生圖 -> workflowId: "flux_t2i"
3. 吉普力風格轉換/文生圖 -> workflowId: "ghibli_style"
4. 圖像編輯修圖 -> workflowId: "image_edit"
5. 高清畫質放大 -> workflowId: "upscale"
6. MiniMax I2VA 單圖生影音 -> workflowId: "minimax_i2va"
7. MiniMax FL2VA 首尾雙圖生影音 -> workflowId: "minimax_fl2va"

**必須回傳純 JSON 格式：**
{
  "workflowId": "上述選擇的工作流 ID",
  "prompt": "若為創作需求，請優化為詳細 Prompt；純對話填空字串 \"\"",
  "negativePrompt": "品質避雷詞；純對話填空字串 \"\"",
  "width": 1280,
  "height": 720,
  "hasSpecifiedSize": false,
  "seed": -1,
  "duration": 15,
  "chineseSummary": "數位人的繁體中文對話回答，說明即將調度的功能"
}`;

  function loadWorkflow(filename: string): Record<string, any> {
    let workflowPath = path.join(process.cwd(), 'workflow', filename);

    if (!fs.existsSync(workflowPath)) {
      const aliasMap: Record<string, string> = {
        'flux_t2i.json': 'FLUX_t2i.json',
        'ghibli_style.json': '吉普力.json',
        'image_edit.json': '圖像編輯.json',
        'upscale.json': '高清放大.json',
        'minimax_i2va.json': 'minimax_i2va.json',
        'minimax_fl2va.json': 'minimax_fl2va.json',
      };
      if (aliasMap[filename]) {
        workflowPath = path.join(process.cwd(), 'workflow', aliasMap[filename]);
      }
    }

    if (!fs.existsSync(workflowPath)) {
      throw new Error(`工作流檔案不存在: ${workflowPath}`);
    }
    const raw = fs.readFileSync(workflowPath, 'utf-8');
    return JSON.parse(raw);
  }

  // 替換工作流節點參數（含 LoadImage 安全防禦）
  function replaceWorkflowPlaceholders(
    workflow: Record<string, any>,
    replacements: Record<string, Record<string, any>>,
    userPrompt?: string,
    primaryImage?: string,
    lastFrameImage?: string
  ): Record<string, any> {
    const cloned = JSON.parse(JSON.stringify(workflow));

    // 1. 指定節點映射寫入
    for (const [nodeId, replacementsObj] of Object.entries(replacements)) {
      if (cloned[nodeId]) {
        if (!cloned[nodeId].inputs) cloned[nodeId].inputs = {};
        for (const [key, value] of Object.entries(replacementsObj)) {
          cloned[nodeId].inputs[key] = value;
          console.log(`[ComfyUI Node ${nodeId}] 寫入 ${key} = "${String(value).substring(0, 50)}..."`);
        }
      }
    }

    // 2. LoadImage 全域防禦
    if (primaryImage) {
      for (const nodeId of Object.keys(cloned)) {
        const node = cloned[nodeId];
        if (node?.class_type === 'LoadImage') {
          if (nodeId === '51' && lastFrameImage) {
            node.inputs.image = lastFrameImage;
            console.log(`[ComfyUI Defense] 強制設定 Node 51 (尾幀) = ${lastFrameImage}`);
          } else {
            node.inputs.image = primaryImage;
            console.log(`[ComfyUI Defense] 強制設定 Node ${nodeId} (首幀) = ${primaryImage}`);
          }
        }
      }
    }

    // 3. Prompt 全域防禦
    if (userPrompt && userPrompt.trim() !== '') {
      for (const nodeId of Object.keys(cloned)) {
        const node = cloned[nodeId];
        if (!node || !node.inputs) continue;

        const classType = node.class_type || '';
        const title = (node._meta?.title || '').toLowerCase();
        const isNegative = title.includes('negative') || title.includes('負向') || title.includes('避雷');
        const isTextEncode = [
          'CLIPTextEncode',
          'CLIPTextEncodeFlux',
          'TextEncodeQwenImageEdit',
          'CR Text',
          'CR Prompt Text',
          'ShowText|pysssss',
          'PrimitiveNode'
        ].includes(classType);

        if (isTextEncode && !isNegative) {
          if ('text' in node.inputs) node.inputs.text = userPrompt;
          if ('prompt' in node.inputs && typeof node.inputs.prompt === 'string') node.inputs.prompt = userPrompt;
          if ('string' in node.inputs) node.inputs.string = userPrompt;
          if ('value' in node.inputs && typeof node.inputs.value === 'string') node.inputs.value = userPrompt;
        }
      }
    }

    return cloned;
  }

  async function submitWorkflow(workflow: Record<string, any>): Promise<string> {
    console.log('[ComfyUI] Submitting workflow...');
    const response = await fetch(`${COMFYUI_URL}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`ComfyUI 拒絕接收請求 (${response.status}): ${errorText}`);
    }
    const data = await response.json();
    return data.prompt_id;
  }

  async function pollCompletion(promptId: string, maxAttempts: number = 180, pollIntervalMs: number = 2000): Promise<any> {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      const response = await fetch(`${COMFYUI_URL}/history/${promptId}`);
      if (!response.ok) continue;
      const data = await response.json();
      if (data[promptId]) {
        return data[promptId];
      }
    }
    throw new Error('ComfyUI 生成超時 (Timeout)');
  }

  async function callVLLM(prompt: string): Promise<string> {
    const response = await fetch(`${VLLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VLLM_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 2048,
      }),
    });
    if (!response.ok) throw new Error(`vLLM error: ${response.status} ${response.statusText}`);
    const data = await response.json();
    return data.choices[0].message.content;
  }

  async function callOllama(prompt: string): Promise<string> {
    const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
    const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
    });
    if (!response.ok) throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
    const data = await response.json();
    return data.response;
  }

  async function callLLM(prompt: string): Promise<string> {
    try {
      return await callVLLM(prompt);
    } catch (error: any) {
      console.warn(`[LLM Warning] vLLM 無法連線 (${error.message})，轉用 Ollama`);
      try {
        return await callOllama(prompt);
      } catch (ollamaError: any) {
        console.warn(`[LLM Warning] LLM 皆離線，使用安全 fallback`);
        return JSON.stringify({
          workflowId: 'flux_t2i',
          prompt: 'A beautiful highly detailed digital artwork',
          negativePrompt: 'blurry, low quality',
          width: 768,
          height: 1024,
          seed: -1,
          chineseSummary: '收到！為您調度最佳工作流進行創作！',
        });
      }
    }
  }

  function safeParseJson(text: string): any {
    try {
      return JSON.parse(text);
    } catch {
      const markdownMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (markdownMatch) {
        try { return JSON.parse(markdownMatch[1].trim()); } catch {}
      }

      let cleaned = text.trim();
      if (cleaned.charCodeAt(0) === 0xfeff) cleaned = cleaned.slice(1);
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1);
      }
      cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');
      cleaned = cleaned.replace(/([\{,])\s*([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
      cleaned = cleaned.replace(/'([^']*)'/g, '"$1"');

      try { return JSON.parse(cleaned); } catch { return null; }
    }
  }

  function extractOutputsFromHistory(historyData: any): { filename: string; subfolder: string; type: string; isVideo?: boolean } | null {
  try {
    const outputs = historyData?.outputs;
    if (!outputs) {
      console.warn('[ComfyUI Output] ⚠️ historyData 內沒有 outputs 欄位:', JSON.stringify(historyData).substring(0, 200));
      return null;
    }

    console.log('[ComfyUI Output] 🔍 正在解析 outputs 節點清單:', Object.keys(outputs));

    // 優先檢查節點 50 (VHS 影片合成)、9、230 等
    const priorityNodes = ['50', '9', '230', '171', '162'];
    const allNodeIds = [...priorityNodes.filter(id => outputs[id]), ...Object.keys(outputs).filter(id => !priorityNodes.includes(id))];

    for (const nodeId of allNodeIds) {
      const out = outputs[nodeId];
      if (!out) continue;

      // 1. 檢查 videos 陣列
      if (Array.isArray(out.videos) && out.videos.length > 0) {
        console.log(`[ComfyUI Output] ✅ 在 Node ${nodeId} 找到 videos:`, out.videos[0]);
        return { ...out.videos[0], isVideo: true };
      }
      // 2. 檢查 gifs 陣列 (VHS_VideoCombine 常用)
      if (Array.isArray(out.gifs) && out.gifs.length > 0) {
        console.log(`[ComfyUI Output] ✅ 在 Node ${nodeId} 找到 gifs:`, out.gifs[0]);
        return { ...out.gifs[0], isVideo: true };
      }
      // 3. 檢查 images 陣列
      if (Array.isArray(out.images) && out.images.length > 0) {
        const first = out.images[0];
        const isVid = /\.(mp4|webm|mkv|mov|avi)$/i.test(first.filename || '');
        console.log(`[ComfyUI Output] ✅ 在 Node ${nodeId} 找到 images:`, first);
        return { ...first, isVideo: isVid };
      }
    }

    // 備用：全物件深度遞迴搜尋 filename
    const jsonStr = JSON.stringify(outputs);
    const match = jsonStr.match(/"filename"\s*:\s*"([^"]+\.(?:mp4|webp|png|jpg|jpeg|gif))"/i);
    if (match) {
      console.log('[ComfyUI Output] ✅ 深度匹配找到檔名:', match[1]);
      return {
        filename: match[1],
        subfolder: '',
        type: 'output',
        isVideo: /\.(mp4|webm|gif)$/i.test(match[1]),
      };
    }
  } catch (err) {
    console.error('[ComfyUI Output Error] 解析 Output 失敗:', err);
  }
  return null;
}

  function getFirstOutputUrl(prefix: string): string | null {
    const dir = path.join(COMFYUI_OUTPUT_DIR, prefix);
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter(f => /\.(png|jpg|jpeg|webp|mp4|webm|gif)$/i.test(f));
      if (files.length > 0) return `/comfyui_output/${prefix}/${files[0]}`;
    }

    if (fs.existsSync(COMFYUI_OUTPUT_DIR)) {
      const rootFiles = fs.readdirSync(COMFYUI_OUTPUT_DIR).filter(f =>
        f.startsWith(prefix) && /\.(png|jpg|jpeg|webp|mp4|webm|gif)$/i.test(f)
      );
      if (rootFiles.length > 0) return `/comfyui_output/${rootFiles[0]}`;
    }

    return null;
  }

  function getWorkflowDisplayName(id: string): string {
    const names: Record<string, string> = {
      'flux_t2i': 'FLUX 高品質文生圖',
      'ghibli_style': '吉普力動漫宮崎駿風格',
      'image_edit': 'Qwen / Flux 圖像編輯修圖',
      'upscale': 'AI 高清畫質放大',
      'minimax_i2va': 'MiniMax 單圖生影音 (I2VA)',
      'minimax_fl2va': 'MiniMax 首尾雙圖生影音 (FL2VA)',
      'image_to_video': 'MiniMax H3 圖生影片',
      'ltx23_t2v': 'MiniMax H3 文生影片',
    };
    return names[id] || id;
  }

  interface WorkflowParamMapping {
    workflowFile: string;
    nodeIds: Record<string, Record<string, any>>;
    outputPrefix: string;
  }

  const WORKFLOW_PARAM_MAPS: Record<string, WorkflowParamMapping> = {
    'flux_t2i': {
      workflowFile: 'FLUX_t2i.json',
      nodeIds: {
        '17': { noise_seed: '{{seed}}' },
        '27': { text: '{{prompt}}' },
        '5': { width: '{{width}}', height: '{{height}}' },
      },
      outputPrefix: 'model',
    },
    'ghibli_style': {
      workflowFile: 'ghibli_style.json',
      nodeIds: {
        '225': { text: '{{prompt}}' },
        '217': { seed: '{{seed}}', noise_seed: '{{seed}}' },
        '223': { image: '{{inputImage}}' },
      },
      outputPrefix: 'Ghibli',
    },
    'image_edit': {
      workflowFile: 'image_edit.json',
      nodeIds: {
        '68': { prompt: '{{prompt}}' },
        '69': { prompt: '{{negativePrompt}}' },
        '65': { seed: '{{seed}}' },
        '41': { image: '{{inputImage}}' },
        '110': { width: '{{width}}', height: '{{height}}' },
      },
      outputPrefix: 'ImageEdit',
    },
    'upscale': {
      workflowFile: 'upscale.json',
      nodeIds: {
        '42': { text: '{{prompt}}' },
        '70': { seed: '{{seed}}', noise_seed: '{{seed}}' },
        '233': { image: '{{inputImage}}' },
      },
      outputPrefix: 'Upscale',
    },
    'minimax_i2va': {
      workflowFile: 'minimax_i2va.json',
      nodeIds: {
        '36': { prompt: '{{prompt}}' },
        '45': { image: '{{inputImage}}' },
        '9': { noise_seed: '{{seed}}' },
        '14': { value: '{{duration}}' },
      },
      outputPrefix: 'MiniMaxH3',
    },
    'minimax_fl2va': {
      workflowFile: 'minimax_fl2va.json',
      nodeIds: {
        '36': { prompt: '{{prompt}}' },
        '45': { image: '{{inputImage}}' },
        '51': { image: '{{lastFrameImage}}' },
        '9': { noise_seed: '{{seed}}' },
        '14': { value: '{{duration}}' },
      },
      outputPrefix: 'MiniMaxH3',
    },
  };

  app.get('/api/view-comfy', async (req: Request, res: Response) => {
    const { filename, subfolder, type } = req.query;
    if (!filename) return res.status(400).send('Missing filename');

    try {
      const comfyImgUrl = `${COMFYUI_URL}/view?filename=${encodeURIComponent(String(filename))}&subfolder=${encodeURIComponent(String(subfolder || ''))}&type=${encodeURIComponent(String(type || 'output'))}`;
      const imgRes = await fetch(comfyImgUrl);

      if (!imgRes.ok) return res.status(404).send('Media not found in ComfyUI');

      const arrayBuffer = await imgRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      res.setHeader('Content-Type', imgRes.headers.get('content-type') || 'application/octet-stream');
      return res.send(buffer);
    } catch (error: any) {
      return res.status(500).send(error.message);
    }
  });

  // --- 🎯 VideoGenerationView / App.tsx 專用的影片任務 API ---
  app.get('/api/video/jobs', (_req: Request, res: Response) => {
    const jobs = Array.from(JOBS_DB.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    res.json({ jobs });
  });

  app.get('/api/video/jobs/:jobId', (req: Request, res: Response) => {
    const job = JOBS_DB.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: { message: 'Job not found' } });
    res.json({ job });
  });

  app.post('/api/video/jobs', async (req: Request, res: Response) => {
    try {
      const { userPrompt, workflowId, params } = req.body;
      const jobId = randomUUID();

      let resolvedWorkflowId = 'minimax_i2va';
      if (params?.generationMode === 'first_last_frame' || params?.endImage || params?.lastFrameImage) {
        resolvedWorkflowId = 'minimax_fl2va';
      } else if (workflowId === 'image_to_video' || workflowId === 'ltx23_t2v' || workflowId === 'minimax_i2va') {
        resolvedWorkflowId = 'minimax_i2va';
      }

      const mapping = WORKFLOW_PARAM_MAPS[resolvedWorkflowId];
      if (!mapping) {
        return res.status(400).json({ error: { message: `未支援的工作流: ${resolvedWorkflowId}` } });
      }

      const newJob: VideoJob = {
        id: jobId,
        workflowId: resolvedWorkflowId,
        workflowName: resolvedWorkflowId === 'minimax_fl2va' ? 'MiniMax 首尾幀影片' : 'MiniMax 圖生影片',
        status: 'queued',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      JOBS_DB.set(jobId, newJob);

      (async () => {
        try {
          newJob.status = 'running';
          newJob.updatedAt = new Date().toISOString();

          let imageFilename = params?.uploadedImage || params?.inputImage;
          if (imageFilename && typeof imageFilename === 'string') {
            imageFilename = await resolveAndUploadImage(imageFilename, `upload_${Date.now()}_1.png`);
          }

          let lastImageFilename = params?.endImage || params?.lastFrameImage;
          if (lastImageFilename && typeof lastImageFilename === 'string') {
            lastImageFilename = await resolveAndUploadImage(lastImageFilename, `upload_${Date.now()}_2.png`);
          } else if (!lastImageFilename && resolvedWorkflowId === 'minimax_fl2va') {
            lastImageFilename = imageFilename;
          }

          const seed = (!params?.seed || params.seed === -1) ? Math.floor(Math.random() * 1000000000) : params.seed;
          const duration = Number(params?.duration) || 15;

          const replacements: Record<string, Record<string, any>> = {};
          for (const [nodeId, nodeParams] of Object.entries(mapping.nodeIds)) {
            replacements[nodeId] = {};
            for (const [paramKey, value] of Object.entries(nodeParams)) {
              if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
                const key = value.slice(2, -2);
                switch (key) {
                  case 'seed': replacements[nodeId][paramKey] = seed; break;
                  case 'prompt': replacements[nodeId][paramKey] = userPrompt || ''; break;
                  case 'duration': replacements[nodeId][paramKey] = duration; break;
                  case 'inputImage': if (imageFilename) replacements[nodeId][paramKey] = imageFilename; break;
                  case 'lastFrameImage': if (lastImageFilename) replacements[nodeId][paramKey] = lastImageFilename; break;
                  default: replacements[nodeId][paramKey] = value;
                }
              } else {
                replacements[nodeId][paramKey] = value;
              }
            }
          }

          const workflow = loadWorkflow(mapping.workflowFile);
          const modifiedWorkflow = replaceWorkflowPlaceholders(
            workflow,
            replacements,
            userPrompt || '',
            imageFilename,
            lastImageFilename
          );

          const promptId = await submitWorkflow(modifiedWorkflow);
          newJob.promptId = promptId;

          const history = await pollCompletion(promptId, 180, 2000);
          const outputFileInfo = extractOutputsFromHistory(history);

          let outputUrl: string | null = null;
          if (outputFileInfo) {
            outputUrl = `/api/view-comfy?filename=${encodeURIComponent(outputFileInfo.filename)}&subfolder=${encodeURIComponent(outputFileInfo.subfolder || '')}&type=${encodeURIComponent(outputFileInfo.type || 'output')}`;
            console.log('[Job Success] 成功產生 outputUrl:', outputUrl);
          } else {
            outputUrl = getFirstOutputUrl(mapping.outputPrefix);
            console.log('[Job Fallback] 採用目錄備用 outputUrl:', outputUrl);
          }

          newJob.status = 'completed';
          newJob.updatedAt = new Date().toISOString();
          newJob.result = {
            success: true, // 確保有 success 標記
            outputUrl: outputUrl || undefined,
            executionTimeMs: history?.metrics?.total_ms,
            avatarResponse: { text: 'MiniMax 影片已經為您生成完成！' },
          };
        } catch (err: any) {
          console.error(`[Job ${jobId} Failed]:`, err.message);
          newJob.status = 'failed';
          newJob.updatedAt = new Date().toISOString();
          newJob.error = { message: err.message };
        }
      })();

      res.json({ jobId, status: 'queued' });
    } catch (error: any) {
      res.status(500).json({ error: { message: error.message } });
    }
  });

  // --- 步驟一：意圖分析 ---
  app.post('/api/generate/analyze-intent', async (req: Request, res: Response) => {
    try {
      const { userPrompt, uploadedImage, lastFrameImage } = req.body;
      if (!userPrompt && !uploadedImage) {
        return res.status(400).json({ success: false, message: '缺少使用者提示詞或圖片' });
      }

      let savedImageFilename: string | null = null;
      if (uploadedImage) {
        savedImageFilename = await resolveAndUploadImage(uploadedImage, `upload_${Date.now()}_1.png`);
      }

      let savedLastImageFilename: string | null = null;
      if (lastFrameImage) {
        savedLastImageFilename = await resolveAndUploadImage(lastFrameImage, `upload_${Date.now()}_2.png`);
      }

      const promptContext = `
使用者輸入：${userPrompt || '（無文字描述）'}
是否提供首張參考圖片: ${!!uploadedImage}
是否提供第二張/尾幀圖片: ${!!lastFrameImage}
`;

      let parsed: any = null;
      try {
        const llmResponse = await callLLM(LLM_DISPATCH_PROMPT + '\n\n' + promptContext);
        parsed = safeParseJson(llmResponse);
      } catch (err: any) {
        console.warn(`[Analyze Intent Warning] LLM 分析失敗: ${err.message}`);
      }

      if (!parsed || !parsed.workflowId) {
        parsed = {
          workflowId: lastFrameImage ? 'minimax_fl2va' : (uploadedImage ? 'minimax_i2va' : 'flux_t2i'),
          prompt: userPrompt,
          chineseSummary: '好的，為您選擇適合的工作流進行創作！',
        };
      }

      let finalWorkflowId = parsed.workflowId;
      if (finalWorkflowId !== 'chat_only' && !WORKFLOW_PARAM_MAPS[finalWorkflowId]) {
        finalWorkflowId = lastFrameImage ? 'minimax_fl2va' : (uploadedImage ? 'minimax_i2va' : 'flux_t2i');
      }

      const sizeParsed = parseDimensions(userPrompt || '');
      const seed = (!parsed.seed || parsed.seed === -1) ? Math.floor(Math.random() * 1000000000) : parsed.seed;

      res.json({
        success: true,
        isChatOnly: finalWorkflowId === 'chat_only',
        workflowId: finalWorkflowId,
        workflowName: finalWorkflowId === 'chat_only' ? '對話互動' : getWorkflowDisplayName(finalWorkflowId),
        optimizedPrompt: parsed.prompt || userPrompt,
        negativePrompt: parsed.negativePrompt || '',
        params: {
          width: sizeParsed.width,
          height: sizeParsed.height,
          seed,
          duration: parsed.duration || 15,
          inputImage: savedImageFilename,
          lastFrameImage: savedLastImageFilename,
        },
        hasSpecifiedSize: sizeParsed.hasSpecified,
        avatarResponseText: parsed.chineseSummary || `已為您選擇 ${getWorkflowDisplayName(finalWorkflowId)} 工作流！`,
      });
    } catch (error: any) {
      console.error('[Analyze Intent Error]:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // --- 步驟二：執行派發 ---
  app.post('/api/generate/dispatch', async (req: Request, res: Response) => {
    try {
      const { userPrompt, workflowId, params } = req.body;
      if (!userPrompt && !params?.uploadedImage && !params?.inputImage) {
        return res.status(400).json({ success: false, message: '缺少提示或輸入圖片' });
      }

      let resolvedWorkflowId = workflowId || 'minimax_i2va';
      if (!WORKFLOW_PARAM_MAPS[resolvedWorkflowId]) {
        if (params?.lastFrameImage) resolvedWorkflowId = 'minimax_fl2va';
        else if (params?.inputImage || params?.uploadedImage) resolvedWorkflowId = 'minimax_i2va';
        else resolvedWorkflowId = 'flux_t2i';
      }

      const mapping = WORKFLOW_PARAM_MAPS[resolvedWorkflowId];

      console.log(`[Dispatch] 調度工作流: ${resolvedWorkflowId}`);

      let imageFilename = params?.inputImage || params?.uploadedImage;
      if (imageFilename && typeof imageFilename === 'string') {
        imageFilename = await resolveAndUploadImage(imageFilename, `upload_${Date.now()}_1.png`);
      }

      let lastImageFilename = params?.lastFrameImage;
      if (lastImageFilename && typeof lastImageFilename === 'string') {
        lastImageFilename = await resolveAndUploadImage(lastImageFilename, `upload_${Date.now()}_2.png`);
      } else if (!lastImageFilename && resolvedWorkflowId === 'minimax_fl2va') {
        lastImageFilename = imageFilename;
      }

      const seed = (!params?.seed || params.seed === -1) ? Math.floor(Math.random() * 1000000000) : params.seed;
      const width = Number(params?.width) || 1280;
      const height = Number(params?.height) || 720;
      const duration = Number(params?.duration) || 15;

      const replacements: Record<string, Record<string, any>> = {};

      for (const [nodeId, nodeParams] of Object.entries(mapping.nodeIds)) {
        replacements[nodeId] = {};
        for (const [paramKey, value] of Object.entries(nodeParams)) {
          if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
            const key = value.slice(2, -2);
            switch (key) {
              case 'seed': replacements[nodeId][paramKey] = seed; break;
              case 'prompt': replacements[nodeId][paramKey] = userPrompt || ''; break;
              case 'negativePrompt': replacements[nodeId][paramKey] = params?.negativePrompt || ''; break;
              case 'width': replacements[nodeId][paramKey] = width; break;
              case 'height': replacements[nodeId][paramKey] = height; break;
              case 'duration': replacements[nodeId][paramKey] = duration; break;
              case 'inputImage': if (imageFilename) replacements[nodeId][paramKey] = imageFilename; break;
              case 'lastFrameImage': if (lastImageFilename) replacements[nodeId][paramKey] = lastImageFilename; break;
              default: replacements[nodeId][paramKey] = value;
            }
          } else {
            replacements[nodeId][paramKey] = value;
          }
        }
      }

      const workflow = loadWorkflow(mapping.workflowFile);
      const modifiedWorkflow = replaceWorkflowPlaceholders(
        workflow,
        replacements,
        userPrompt || '',
        imageFilename,
        lastImageFilename
      );

      const promptId = await submitWorkflow(modifiedWorkflow);
      const history = await pollCompletion(promptId, 120, 2500);

      const outputFileInfo = extractOutputsFromHistory(history);
      let outputUrl: string | null = null;

      if (outputFileInfo) {
        outputUrl = `/api/view-comfy?filename=${encodeURIComponent(outputFileInfo.filename)}&subfolder=${encodeURIComponent(outputFileInfo.subfolder || '')}&type=${encodeURIComponent(outputFileInfo.type || 'output')}`;
      } else {
        outputUrl = getFirstOutputUrl(mapping.outputPrefix);
      }

      const isVideo = outputFileInfo?.isVideo || mapping.outputPrefix.toLowerCase().includes('minimax');

      res.json({
        success: !!outputUrl,
        taskId: randomUUID(),
        workflowName: getWorkflowDisplayName(resolvedWorkflowId),
        workflowId: resolvedWorkflowId,
        status: outputUrl ? 'completed' : 'failed',
        progress: outputUrl ? 100 : 0,
        outputType: isVideo ? 'video' : 'image',
        outputUrl,
        avatarResponse: {
          text: outputUrl ? '已經為您調度 ComfyUI 成功完成創作！' : '生成失敗，請檢查 ComfyUI 控制台',
        },
        executionTimeMs: history?.metrics?.total_ms,
      });
    } catch (error: any) {
      console.error('[Dispatch Error]:', error.message);
      res.status(500).json({
        success: false,
        message: error.message,
        avatarResponse: { text: `調度過程發生錯誤: ${error.message}` },
      });
    }
  });

  // ComfyUI GPU 狀態
  app.get('/api/comfyui/status', async (req: Request, res: Response) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);
      const comfyRes = await fetch(`${COMFYUI_URL}/system_stats`, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!comfyRes.ok) throw new Error(`ComfyUI 狀態異常: ${comfyRes.status}`);
      const data = await comfyRes.json();
      const device = data.devices?.[0];
      const vramTotalGb = device ? parseFloat((device.vram_total / (1024 * 1024 * 1024)).toFixed(1)) : 24.0;
      const vramFreeGb = device ? parseFloat((device.vram_free / (1024 * 1024 * 1024)).toFixed(1)) : 12.0;
      const vramUsedGb = parseFloat((vramTotalGb - vramFreeGb).toFixed(1));

      return res.json({
        success: true,
        systemStats: {
          gpu: {
            name: device?.name || 'NVIDIA GPU',
            vramUsedGb,
            vramTotalGb,
            loadPercent: vramTotalGb > 0 ? Math.round((vramUsedGb / vramTotalGb) * 100) : 0,
            temperatureC: 52,
            activeJobsCount: data.exec_info?.queue_remaining || 0,
            comfyConnected: true,
            comfyHost: COMFYUI_URL,
          },
        },
      });
    } catch (error: any) {
      return res.json({
        success: false,
        systemStats: {
          gpu: {
            name: 'ComfyUI 離線中',
            vramUsedGb: 0,
            vramTotalGb: 24.0,
            loadPercent: 0,
            temperatureC: 0,
            activeJobsCount: 0,
            comfyConnected: false,
            comfyHost: COMFYUI_URL,
          },
        },
      });
    }
  });

  // 中斷排程
  app.post('/api/comfyui/interrupt', async (_req: Request, res: Response) => {
    try {
      const interruptRes = await fetch(`${COMFYUI_URL}/interrupt`, { method: 'POST' });
      if (!interruptRes.ok) throw new Error(`中斷失敗: ${interruptRes.status}`);
      return res.json({ success: true, message: '已發送中斷指令' });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  // 取得佇列清單
  app.get('/api/comfyui/queue', async (_req: Request, res: Response) => {
    try {
      const queueRes = await fetch(`${COMFYUI_URL}/queue`);
      if (!queueRes.ok) throw new Error(`無法取得佇列: ${queueRes.status}`);
      const data = await queueRes.json();
      return res.json({
        success: true,
        running: data.queue_running || [],
        pending: data.queue_pending || [],
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  // 清除排程
  app.post('/api/comfyui/queue/delete', async (req: Request, res: Response) => {
    try {
      const { promptId, clearAll } = req.body;
      if (clearAll) {
        await fetch(`${COMFYUI_URL}/queue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clear: true }),
        });
        return res.json({ success: true, message: '已清空所有排程' });
      }

      if (promptId) {
        await fetch(`${COMFYUI_URL}/queue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ delete: [promptId] }),
        });
        return res.json({ success: true, message: `已取消任務 ${promptId}` });
      }

      return res.status(400).json({ success: false, message: '缺少參數' });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      hmr: { port: 24679 },
      allowedHosts: true,
    },
    appType: 'spa',
  });
  app.use(vite.middlewares);
  app.use('/comfyui_output', express.static(COMFYUI_OUTPUT_DIR));

  const server = app.listen(PORT, '127.0.0.1', () => {
    console.log(`=================================================`);
    console.log(`🚀 Express Backend Server running on http://127.0.0.1:${PORT}`);
    console.log(`=================================================`);
  });

  process.on('SIGINT', () => {
    server.close(() => process.exit(0));
  });
}

startServer().catch(console.error);