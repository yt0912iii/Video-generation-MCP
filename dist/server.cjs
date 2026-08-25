"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_vite = require("vite");
var import_crypto = require("crypto");
var import_cors = __toESM(require("cors"), 1);
var COMFYUI_URL = process.env.COMFYUI_URL || "http://127.0.0.1:8188";
var COMFYUI_OUTPUT_DIR = process.env.COMFYUI_OUTPUT_DIR || import_path.default.join(process.cwd(), "comfyui_output");
var VLLM_URL = process.env.VLLM_URL || "http://192.168.50.200:8787";
var VLLM_MODEL = process.env.VLLM_MODEL || "cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit";
var ASPECT_RATIO_MAP = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "4:3": { width: 1024, height: 768 },
  "3:4": { width: 768, height: 1024 },
  "1:1": { width: 1024, height: 1024 },
  "21:9": { width: 1344, height: 576 },
  "3:2": { width: 1152, height: 768 },
  "2:3": { width: 768, height: 1152 }
};
var CN_NUM_MAP = {
  "\u4E00": 1,
  "\u4E8C": 2,
  "\u5169": 2,
  "\u4E09": 3,
  "\u56DB": 4,
  "\u4E94": 5,
  "\u516D": 6,
  "\u4E03": 7,
  "\u516B": 8,
  "\u4E5D": 9,
  "\u5341": 10,
  "\u5341\u516D": 16,
  "\u4E8C\u5341\u4E00": 21
};
function parseDimensions(text, defaultW = 768, defaultH = 1024) {
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
async function uploadBufferToComfyUI(buffer, filename) {
  const boundary = `----WebKitFormBoundary${(0, import_crypto.randomUUID)().replace(/-/g, "")}`;
  const header = Buffer.from(
    `--${boundary}\r
Content-Disposition: form-data; name="image"; filename="${filename}"\r
Content-Type: image/png\r
\r
`
  );
  const overwritePart = Buffer.from(
    `\r
--${boundary}\r
Content-Disposition: form-data; name="overwrite"\r
\r
true\r
--${boundary}--\r
`
  );
  const body = Buffer.concat([header, buffer, overwritePart]);
  const res = await fetch(`${COMFYUI_URL}/upload/image`, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`
    },
    body
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`\u4E0A\u50B3\u5716\u7247\u5230 ComfyUI \u5931\u6557 (${res.status}): ${errText}`);
  }
  const data = await res.json();
  console.log(`[ComfyUI Upload] \u2705 \u5716\u7247\u5DF2\u6210\u529F\u5BEB\u5165 ComfyUI Input: ${data.name}`);
  return data.name;
}
async function resolveAndUploadImage(imageDataOrUrl, targetFilename) {
  if (!imageDataOrUrl || typeof imageDataOrUrl !== "string") return "";
  try {
    if (imageDataOrUrl.startsWith("data:image")) {
      const base64Data = imageDataOrUrl.split(",")[1];
      const buffer = Buffer.from(base64Data, "base64");
      return await uploadBufferToComfyUI(buffer, targetFilename);
    }
    if (imageDataOrUrl.startsWith("/api/view-comfy") || imageDataOrUrl.startsWith("/comfyui_output")) {
      const urlMatch = imageDataOrUrl.match(/filename=([^&]+)/);
      const rawName = urlMatch ? decodeURIComponent(urlMatch[1]) : import_path.default.basename(imageDataOrUrl);
      const fetchUrl = `${COMFYUI_URL}/view?filename=${encodeURIComponent(rawName)}&type=output`;
      const res = await fetch(fetchUrl);
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer());
        return await uploadBufferToComfyUI(buffer, targetFilename);
      }
    }
    if (imageDataOrUrl.startsWith("http://") || imageDataOrUrl.startsWith("https://")) {
      const res = await fetch(imageDataOrUrl);
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer());
        return await uploadBufferToComfyUI(buffer, targetFilename);
      }
    }
    return imageDataOrUrl;
  } catch (e) {
    console.error("[Upload Error] \u8655\u7406\u5716\u7247\u5931\u6557:", e.message);
    throw e;
  }
}
var JOBS_DB = /* @__PURE__ */ new Map();
async function startServer() {
  const PORT = 8833;
  const app = (0, import_express.default)();
  app.use((0, import_cors.default)());
  app.use(import_express.default.json({ limit: "100mb" }));
  app.use(import_express.default.urlencoded({ extended: true, limit: "100mb" }));
  if (!import_fs.default.existsSync(COMFYUI_OUTPUT_DIR)) import_fs.default.mkdirSync(COMFYUI_OUTPUT_DIR, { recursive: true });
  const LLM_DISPATCH_PROMPT = `\u4F60\u662F\u4E00\u4F4D\u5C08\u696D\u7684 ComfyUI \u751F\u6210\u5F0F AI \u6578\u4F4D\u4EBA\u5C08\u54E1\u3002
\u8ACB\u5206\u6790\u4F7F\u7528\u8005\u7684\u8F38\u5165\u610F\u5716\u8207\u63D0\u4F9B\u7684\u4E0A\u4E0B\u6587\uFF0C\u5C07\u5176\u5206\u985E\u81F3\u6700\u9069\u7576\u7684\u5DE5\u4F5C\u6D41\uFF0C\u4E26\u5C07\u63D0\u8A5E\u512A\u5316\u70BA\u9AD8\u54C1\u8CEA Prompt\u3002

**\u53EF\u7528\u5DE5\u4F5C\u6D41\u6E05\u55AE\uFF1A**
1. \u7D14\u5C0D\u8A71/\u554F\u5C0D\u8A71 (Chat Only) -> workflowId: "chat_only"
2. FLUX \u9AD8\u54C1\u8CEA\u6587\u751F\u5716 -> workflowId: "flux_t2i"
3. \u5409\u666E\u529B\u98A8\u683C\u8F49\u63DB/\u6587\u751F\u5716 -> workflowId: "ghibli_style"
4. \u5716\u50CF\u7DE8\u8F2F\u4FEE\u5716 -> workflowId: "image_edit"
5. \u9AD8\u6E05\u756B\u8CEA\u653E\u5927 -> workflowId: "upscale"
6. MiniMax I2VA \u55AE\u5716\u751F\u5F71\u97F3 -> workflowId: "minimax_i2va"
7. MiniMax FL2VA \u9996\u5C3E\u96D9\u5716\u751F\u5F71\u97F3 -> workflowId: "minimax_fl2va"

**\u5FC5\u9808\u56DE\u50B3\u7D14 JSON \u683C\u5F0F\uFF1A**
{
  "workflowId": "\u4E0A\u8FF0\u9078\u64C7\u7684\u5DE5\u4F5C\u6D41 ID",
  "prompt": "\u82E5\u70BA\u5275\u4F5C\u9700\u6C42\uFF0C\u8ACB\u512A\u5316\u70BA\u8A73\u7D30 Prompt\uFF1B\u7D14\u5C0D\u8A71\u586B\u7A7A\u5B57\u4E32 """,
  "negativePrompt": "\u54C1\u8CEA\u907F\u96F7\u8A5E\uFF1B\u7D14\u5C0D\u8A71\u586B\u7A7A\u5B57\u4E32 """,
  "width": 1280,
  "height": 720,
  "hasSpecifiedSize": false,
  "seed": -1,
  "duration": 15,
  "chineseSummary": "\u6578\u4F4D\u4EBA\u7684\u7E41\u9AD4\u4E2D\u6587\u5C0D\u8A71\u56DE\u7B54\uFF0C\u8AAA\u660E\u5373\u5C07\u8ABF\u5EA6\u7684\u529F\u80FD"
}`;
  function loadWorkflow(filename) {
    let workflowPath = import_path.default.join(process.cwd(), "workflow", filename);
    if (!import_fs.default.existsSync(workflowPath)) {
      const aliasMap = {
        "flux_t2i.json": "FLUX_t2i.json",
        "ghibli_style.json": "\u5409\u666E\u529B.json",
        "image_edit.json": "\u5716\u50CF\u7DE8\u8F2F.json",
        "upscale.json": "\u9AD8\u6E05\u653E\u5927.json",
        "minimax_i2va.json": "minimax_i2va.json",
        "minimax_fl2va.json": "minimax_fl2va.json"
      };
      if (aliasMap[filename]) {
        workflowPath = import_path.default.join(process.cwd(), "workflow", aliasMap[filename]);
      }
    }
    if (!import_fs.default.existsSync(workflowPath)) {
      throw new Error(`\u5DE5\u4F5C\u6D41\u6A94\u6848\u4E0D\u5B58\u5728: ${workflowPath}`);
    }
    const raw = import_fs.default.readFileSync(workflowPath, "utf-8");
    return JSON.parse(raw);
  }
  function replaceWorkflowPlaceholders(workflow, replacements, userPrompt, primaryImage, lastFrameImage) {
    const cloned = JSON.parse(JSON.stringify(workflow));
    for (const [nodeId, replacementsObj] of Object.entries(replacements)) {
      if (cloned[nodeId]) {
        if (!cloned[nodeId].inputs) cloned[nodeId].inputs = {};
        for (const [key, value] of Object.entries(replacementsObj)) {
          cloned[nodeId].inputs[key] = value;
          console.log(`[ComfyUI Node ${nodeId}] \u5BEB\u5165 ${key} = "${String(value).substring(0, 50)}..."`);
        }
      }
    }
    if (primaryImage) {
      for (const nodeId of Object.keys(cloned)) {
        const node = cloned[nodeId];
        if (node?.class_type === "LoadImage") {
          if (nodeId === "51" && lastFrameImage) {
            node.inputs.image = lastFrameImage;
            console.log(`[ComfyUI Defense] \u5F37\u5236\u8A2D\u5B9A Node 51 (\u5C3E\u5E40) = ${lastFrameImage}`);
          } else {
            node.inputs.image = primaryImage;
            console.log(`[ComfyUI Defense] \u5F37\u5236\u8A2D\u5B9A Node ${nodeId} (\u9996\u5E40) = ${primaryImage}`);
          }
        }
      }
    }
    if (userPrompt && userPrompt.trim() !== "") {
      for (const nodeId of Object.keys(cloned)) {
        const node = cloned[nodeId];
        if (!node || !node.inputs) continue;
        const classType = node.class_type || "";
        const title = (node._meta?.title || "").toLowerCase();
        const isNegative = title.includes("negative") || title.includes("\u8CA0\u5411") || title.includes("\u907F\u96F7");
        const isTextEncode = [
          "CLIPTextEncode",
          "CLIPTextEncodeFlux",
          "TextEncodeQwenImageEdit",
          "CR Text",
          "CR Prompt Text",
          "ShowText|pysssss",
          "PrimitiveNode"
        ].includes(classType);
        if (isTextEncode && !isNegative) {
          if ("text" in node.inputs) node.inputs.text = userPrompt;
          if ("prompt" in node.inputs && typeof node.inputs.prompt === "string") node.inputs.prompt = userPrompt;
          if ("string" in node.inputs) node.inputs.string = userPrompt;
          if ("value" in node.inputs && typeof node.inputs.value === "string") node.inputs.value = userPrompt;
        }
      }
    }
    return cloned;
  }
  async function submitWorkflow(workflow) {
    console.log("[ComfyUI] Submitting workflow...");
    const response = await fetch(`${COMFYUI_URL}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow })
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`ComfyUI \u62D2\u7D55\u63A5\u6536\u8ACB\u6C42 (${response.status}): ${errorText}`);
    }
    const data = await response.json();
    return data.prompt_id;
  }
  async function pollCompletion(promptId, maxAttempts = 180, pollIntervalMs = 2e3) {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      const response = await fetch(`${COMFYUI_URL}/history/${promptId}`);
      if (!response.ok) continue;
      const data = await response.json();
      if (data[promptId]) {
        return data[promptId];
      }
    }
    throw new Error("ComfyUI \u751F\u6210\u8D85\u6642 (Timeout)");
  }
  async function callVLLM(prompt) {
    const response = await fetch(`${VLLM_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: VLLM_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 2048
      })
    });
    if (!response.ok) throw new Error(`vLLM error: ${response.status} ${response.statusText}`);
    const data = await response.json();
    return data.choices[0].message.content;
  }
  async function callOllama(prompt) {
    const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
    const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b";
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false })
    });
    if (!response.ok) throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
    const data = await response.json();
    return data.response;
  }
  async function callLLM(prompt) {
    try {
      return await callVLLM(prompt);
    } catch (error) {
      console.warn(`[LLM Warning] vLLM \u7121\u6CD5\u9023\u7DDA (${error.message})\uFF0C\u8F49\u7528 Ollama`);
      try {
        return await callOllama(prompt);
      } catch (ollamaError) {
        console.warn(`[LLM Warning] LLM \u7686\u96E2\u7DDA\uFF0C\u4F7F\u7528\u5B89\u5168 fallback`);
        return JSON.stringify({
          workflowId: "flux_t2i",
          prompt: "A beautiful highly detailed digital artwork",
          negativePrompt: "blurry, low quality",
          width: 768,
          height: 1024,
          seed: -1,
          chineseSummary: "\u6536\u5230\uFF01\u70BA\u60A8\u8ABF\u5EA6\u6700\u4F73\u5DE5\u4F5C\u6D41\u9032\u884C\u5275\u4F5C\uFF01"
        });
      }
    }
  }
  function safeParseJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      const markdownMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (markdownMatch) {
        try {
          return JSON.parse(markdownMatch[1].trim());
        } catch {
        }
      }
      let cleaned = text.trim();
      if (cleaned.charCodeAt(0) === 65279) cleaned = cleaned.slice(1);
      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1);
      }
      cleaned = cleaned.replace(/,\s*([\]}])/g, "$1");
      cleaned = cleaned.replace(/([\{,])\s*([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
      cleaned = cleaned.replace(/'([^']*)'/g, '"$1"');
      try {
        return JSON.parse(cleaned);
      } catch {
        return null;
      }
    }
  }
  function extractOutputsFromHistory(historyData) {
    try {
      const outputs = historyData?.outputs;
      if (!outputs) {
        console.warn("[ComfyUI Output] \u26A0\uFE0F historyData \u5167\u6C92\u6709 outputs \u6B04\u4F4D:", JSON.stringify(historyData).substring(0, 200));
        return null;
      }
      console.log("[ComfyUI Output] \u{1F50D} \u6B63\u5728\u89E3\u6790 outputs \u7BC0\u9EDE\u6E05\u55AE:", Object.keys(outputs));
      const priorityNodes = ["50", "9", "230", "171", "162"];
      const allNodeIds = [...priorityNodes.filter((id) => outputs[id]), ...Object.keys(outputs).filter((id) => !priorityNodes.includes(id))];
      for (const nodeId of allNodeIds) {
        const out = outputs[nodeId];
        if (!out) continue;
        if (Array.isArray(out.videos) && out.videos.length > 0) {
          console.log(`[ComfyUI Output] \u2705 \u5728 Node ${nodeId} \u627E\u5230 videos:`, out.videos[0]);
          return { ...out.videos[0], isVideo: true };
        }
        if (Array.isArray(out.gifs) && out.gifs.length > 0) {
          console.log(`[ComfyUI Output] \u2705 \u5728 Node ${nodeId} \u627E\u5230 gifs:`, out.gifs[0]);
          return { ...out.gifs[0], isVideo: true };
        }
        if (Array.isArray(out.images) && out.images.length > 0) {
          const first = out.images[0];
          const isVid = /\.(mp4|webm|mkv|mov|avi)$/i.test(first.filename || "");
          console.log(`[ComfyUI Output] \u2705 \u5728 Node ${nodeId} \u627E\u5230 images:`, first);
          return { ...first, isVideo: isVid };
        }
      }
      const jsonStr = JSON.stringify(outputs);
      const match = jsonStr.match(/"filename"\s*:\s*"([^"]+\.(?:mp4|webp|png|jpg|jpeg|gif))"/i);
      if (match) {
        console.log("[ComfyUI Output] \u2705 \u6DF1\u5EA6\u5339\u914D\u627E\u5230\u6A94\u540D:", match[1]);
        return {
          filename: match[1],
          subfolder: "",
          type: "output",
          isVideo: /\.(mp4|webm|gif)$/i.test(match[1])
        };
      }
    } catch (err) {
      console.error("[ComfyUI Output Error] \u89E3\u6790 Output \u5931\u6557:", err);
    }
    return null;
  }
  function getFirstOutputUrl(prefix) {
    const dir = import_path.default.join(COMFYUI_OUTPUT_DIR, prefix);
    if (import_fs.default.existsSync(dir)) {
      const files = import_fs.default.readdirSync(dir).filter((f) => /\.(png|jpg|jpeg|webp|mp4|webm|gif)$/i.test(f));
      if (files.length > 0) return `/comfyui_output/${prefix}/${files[0]}`;
    }
    if (import_fs.default.existsSync(COMFYUI_OUTPUT_DIR)) {
      const rootFiles = import_fs.default.readdirSync(COMFYUI_OUTPUT_DIR).filter(
        (f) => f.startsWith(prefix) && /\.(png|jpg|jpeg|webp|mp4|webm|gif)$/i.test(f)
      );
      if (rootFiles.length > 0) return `/comfyui_output/${rootFiles[0]}`;
    }
    return null;
  }
  function getWorkflowDisplayName(id) {
    const names = {
      "flux_t2i": "FLUX \u9AD8\u54C1\u8CEA\u6587\u751F\u5716",
      "ghibli_style": "\u5409\u666E\u529B\u52D5\u6F2B\u5BAE\u5D0E\u99FF\u98A8\u683C",
      "image_edit": "Qwen / Flux \u5716\u50CF\u7DE8\u8F2F\u4FEE\u5716",
      "upscale": "AI \u9AD8\u6E05\u756B\u8CEA\u653E\u5927",
      "minimax_i2va": "MiniMax \u55AE\u5716\u751F\u5F71\u97F3 (I2VA)",
      "minimax_fl2va": "MiniMax \u9996\u5C3E\u96D9\u5716\u751F\u5F71\u97F3 (FL2VA)",
      "image_to_video": "MiniMax H3 \u5716\u751F\u5F71\u7247",
      "ltx23_t2v": "MiniMax H3 \u6587\u751F\u5F71\u7247"
    };
    return names[id] || id;
  }
  const WORKFLOW_PARAM_MAPS = {
    "flux_t2i": {
      workflowFile: "FLUX_t2i.json",
      nodeIds: {
        "17": { noise_seed: "{{seed}}" },
        "27": { text: "{{prompt}}" },
        "5": { width: "{{width}}", height: "{{height}}" }
      },
      outputPrefix: "model"
    },
    "ghibli_style": {
      workflowFile: "ghibli_style.json",
      nodeIds: {
        "225": { text: "{{prompt}}" },
        "217": { seed: "{{seed}}", noise_seed: "{{seed}}" },
        "223": { image: "{{inputImage}}" }
      },
      outputPrefix: "Ghibli"
    },
    "image_edit": {
      workflowFile: "image_edit.json",
      nodeIds: {
        "68": { prompt: "{{prompt}}" },
        "69": { prompt: "{{negativePrompt}}" },
        "65": { seed: "{{seed}}" },
        "41": { image: "{{inputImage}}" },
        "110": { width: "{{width}}", height: "{{height}}" }
      },
      outputPrefix: "ImageEdit"
    },
    "upscale": {
      workflowFile: "upscale.json",
      nodeIds: {
        "42": { text: "{{prompt}}" },
        "70": { seed: "{{seed}}", noise_seed: "{{seed}}" },
        "233": { image: "{{inputImage}}" }
      },
      outputPrefix: "Upscale"
    },
    "minimax_i2va": {
      workflowFile: "minimax_i2va.json",
      nodeIds: {
        "36": { prompt: "{{prompt}}" },
        "45": { image: "{{inputImage}}" },
        "9": { noise_seed: "{{seed}}" },
        "14": { value: "{{duration}}" }
      },
      outputPrefix: "MiniMaxH3"
    },
    "minimax_fl2va": {
      workflowFile: "minimax_fl2va.json",
      nodeIds: {
        "36": { prompt: "{{prompt}}" },
        "45": { image: "{{inputImage}}" },
        "51": { image: "{{lastFrameImage}}" },
        "9": { noise_seed: "{{seed}}" },
        "14": { value: "{{duration}}" }
      },
      outputPrefix: "MiniMaxH3"
    }
  };
  app.get("/api/view-comfy", async (req, res) => {
    const { filename, subfolder, type } = req.query;
    if (!filename) return res.status(400).send("Missing filename");
    try {
      const comfyImgUrl = `${COMFYUI_URL}/view?filename=${encodeURIComponent(String(filename))}&subfolder=${encodeURIComponent(String(subfolder || ""))}&type=${encodeURIComponent(String(type || "output"))}`;
      const imgRes = await fetch(comfyImgUrl);
      if (!imgRes.ok) return res.status(404).send("Media not found in ComfyUI");
      const arrayBuffer = await imgRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      res.setHeader("Content-Type", imgRes.headers.get("content-type") || "application/octet-stream");
      return res.send(buffer);
    } catch (error) {
      return res.status(500).send(error.message);
    }
  });
  app.get("/api/video/jobs", (_req, res) => {
    const jobs = Array.from(JOBS_DB.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    res.json({ jobs });
  });
  app.get("/api/video/jobs/:jobId", (req, res) => {
    const job = JOBS_DB.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: { message: "Job not found" } });
    res.json({ job });
  });
  app.post("/api/video/jobs", async (req, res) => {
    try {
      const { userPrompt, workflowId, params } = req.body;
      const jobId = (0, import_crypto.randomUUID)();
      let resolvedWorkflowId = "minimax_i2va";
      if (params?.generationMode === "first_last_frame" || params?.endImage || params?.lastFrameImage) {
        resolvedWorkflowId = "minimax_fl2va";
      } else if (workflowId === "image_to_video" || workflowId === "ltx23_t2v" || workflowId === "minimax_i2va") {
        resolvedWorkflowId = "minimax_i2va";
      }
      const mapping = WORKFLOW_PARAM_MAPS[resolvedWorkflowId];
      if (!mapping) {
        return res.status(400).json({ error: { message: `\u672A\u652F\u63F4\u7684\u5DE5\u4F5C\u6D41: ${resolvedWorkflowId}` } });
      }
      const newJob = {
        id: jobId,
        workflowId: resolvedWorkflowId,
        workflowName: resolvedWorkflowId === "minimax_fl2va" ? "MiniMax \u9996\u5C3E\u5E40\u5F71\u7247" : "MiniMax \u5716\u751F\u5F71\u7247",
        status: "queued",
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      JOBS_DB.set(jobId, newJob);
      (async () => {
        try {
          newJob.status = "running";
          newJob.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
          let imageFilename = params?.uploadedImage || params?.inputImage;
          if (imageFilename && typeof imageFilename === "string") {
            imageFilename = await resolveAndUploadImage(imageFilename, `upload_${Date.now()}_1.png`);
          }
          let lastImageFilename = params?.endImage || params?.lastFrameImage;
          if (lastImageFilename && typeof lastImageFilename === "string") {
            lastImageFilename = await resolveAndUploadImage(lastImageFilename, `upload_${Date.now()}_2.png`);
          } else if (!lastImageFilename && resolvedWorkflowId === "minimax_fl2va") {
            lastImageFilename = imageFilename;
          }
          const seed = !params?.seed || params.seed === -1 ? Math.floor(Math.random() * 1e9) : params.seed;
          const duration = Number(params?.duration) || 15;
          const replacements = {};
          for (const [nodeId, nodeParams] of Object.entries(mapping.nodeIds)) {
            replacements[nodeId] = {};
            for (const [paramKey, value] of Object.entries(nodeParams)) {
              if (typeof value === "string" && value.startsWith("{{") && value.endsWith("}}")) {
                const key = value.slice(2, -2);
                switch (key) {
                  case "seed":
                    replacements[nodeId][paramKey] = seed;
                    break;
                  case "prompt":
                    replacements[nodeId][paramKey] = userPrompt || "";
                    break;
                  case "duration":
                    replacements[nodeId][paramKey] = duration;
                    break;
                  case "inputImage":
                    if (imageFilename) replacements[nodeId][paramKey] = imageFilename;
                    break;
                  case "lastFrameImage":
                    if (lastImageFilename) replacements[nodeId][paramKey] = lastImageFilename;
                    break;
                  default:
                    replacements[nodeId][paramKey] = value;
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
            userPrompt || "",
            imageFilename,
            lastImageFilename
          );
          const promptId = await submitWorkflow(modifiedWorkflow);
          newJob.promptId = promptId;
          const history = await pollCompletion(promptId, 180, 2e3);
          const outputFileInfo = extractOutputsFromHistory(history);
          let outputUrl = null;
          if (outputFileInfo) {
            outputUrl = `/api/view-comfy?filename=${encodeURIComponent(outputFileInfo.filename)}&subfolder=${encodeURIComponent(outputFileInfo.subfolder || "")}&type=${encodeURIComponent(outputFileInfo.type || "output")}`;
            console.log("[Job Success] \u6210\u529F\u7522\u751F outputUrl:", outputUrl);
          } else {
            outputUrl = getFirstOutputUrl(mapping.outputPrefix);
            console.log("[Job Fallback] \u63A1\u7528\u76EE\u9304\u5099\u7528 outputUrl:", outputUrl);
          }
          newJob.status = "completed";
          newJob.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
          newJob.result = {
            success: true,
            // 確保有 success 標記
            outputUrl: outputUrl || void 0,
            executionTimeMs: history?.metrics?.total_ms,
            avatarResponse: { text: "MiniMax \u5F71\u7247\u5DF2\u7D93\u70BA\u60A8\u751F\u6210\u5B8C\u6210\uFF01" }
          };
        } catch (err) {
          console.error(`[Job ${jobId} Failed]:`, err.message);
          newJob.status = "failed";
          newJob.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
          newJob.error = { message: err.message };
        }
      })();
      res.json({ jobId, status: "queued" });
    } catch (error) {
      res.status(500).json({ error: { message: error.message } });
    }
  });
  app.post("/api/generate/analyze-intent", async (req, res) => {
    try {
      const { userPrompt, uploadedImage, lastFrameImage } = req.body;
      if (!userPrompt && !uploadedImage) {
        return res.status(400).json({ success: false, message: "\u7F3A\u5C11\u4F7F\u7528\u8005\u63D0\u793A\u8A5E\u6216\u5716\u7247" });
      }
      let savedImageFilename = null;
      if (uploadedImage) {
        savedImageFilename = await resolveAndUploadImage(uploadedImage, `upload_${Date.now()}_1.png`);
      }
      let savedLastImageFilename = null;
      if (lastFrameImage) {
        savedLastImageFilename = await resolveAndUploadImage(lastFrameImage, `upload_${Date.now()}_2.png`);
      }
      const promptContext = `
\u4F7F\u7528\u8005\u8F38\u5165\uFF1A${userPrompt || "\uFF08\u7121\u6587\u5B57\u63CF\u8FF0\uFF09"}
\u662F\u5426\u63D0\u4F9B\u9996\u5F35\u53C3\u8003\u5716\u7247: ${!!uploadedImage}
\u662F\u5426\u63D0\u4F9B\u7B2C\u4E8C\u5F35/\u5C3E\u5E40\u5716\u7247: ${!!lastFrameImage}
`;
      let parsed = null;
      try {
        const llmResponse = await callLLM(LLM_DISPATCH_PROMPT + "\n\n" + promptContext);
        parsed = safeParseJson(llmResponse);
      } catch (err) {
        console.warn(`[Analyze Intent Warning] LLM \u5206\u6790\u5931\u6557: ${err.message}`);
      }
      if (!parsed || !parsed.workflowId) {
        parsed = {
          workflowId: lastFrameImage ? "minimax_fl2va" : uploadedImage ? "minimax_i2va" : "flux_t2i",
          prompt: userPrompt,
          chineseSummary: "\u597D\u7684\uFF0C\u70BA\u60A8\u9078\u64C7\u9069\u5408\u7684\u5DE5\u4F5C\u6D41\u9032\u884C\u5275\u4F5C\uFF01"
        };
      }
      let finalWorkflowId = parsed.workflowId;
      if (finalWorkflowId !== "chat_only" && !WORKFLOW_PARAM_MAPS[finalWorkflowId]) {
        finalWorkflowId = lastFrameImage ? "minimax_fl2va" : uploadedImage ? "minimax_i2va" : "flux_t2i";
      }
      const sizeParsed = parseDimensions(userPrompt || "");
      const seed = !parsed.seed || parsed.seed === -1 ? Math.floor(Math.random() * 1e9) : parsed.seed;
      res.json({
        success: true,
        isChatOnly: finalWorkflowId === "chat_only",
        workflowId: finalWorkflowId,
        workflowName: finalWorkflowId === "chat_only" ? "\u5C0D\u8A71\u4E92\u52D5" : getWorkflowDisplayName(finalWorkflowId),
        optimizedPrompt: parsed.prompt || userPrompt,
        negativePrompt: parsed.negativePrompt || "",
        params: {
          width: sizeParsed.width,
          height: sizeParsed.height,
          seed,
          duration: parsed.duration || 15,
          inputImage: savedImageFilename,
          lastFrameImage: savedLastImageFilename
        },
        hasSpecifiedSize: sizeParsed.hasSpecified,
        avatarResponseText: parsed.chineseSummary || `\u5DF2\u70BA\u60A8\u9078\u64C7 ${getWorkflowDisplayName(finalWorkflowId)} \u5DE5\u4F5C\u6D41\uFF01`
      });
    } catch (error) {
      console.error("[Analyze Intent Error]:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });
  app.post("/api/generate/dispatch", async (req, res) => {
    try {
      const { userPrompt, workflowId, params } = req.body;
      if (!userPrompt && !params?.uploadedImage && !params?.inputImage) {
        return res.status(400).json({ success: false, message: "\u7F3A\u5C11\u63D0\u793A\u6216\u8F38\u5165\u5716\u7247" });
      }
      let resolvedWorkflowId = workflowId || "minimax_i2va";
      if (!WORKFLOW_PARAM_MAPS[resolvedWorkflowId]) {
        if (params?.lastFrameImage) resolvedWorkflowId = "minimax_fl2va";
        else if (params?.inputImage || params?.uploadedImage) resolvedWorkflowId = "minimax_i2va";
        else resolvedWorkflowId = "flux_t2i";
      }
      const mapping = WORKFLOW_PARAM_MAPS[resolvedWorkflowId];
      console.log(`[Dispatch] \u8ABF\u5EA6\u5DE5\u4F5C\u6D41: ${resolvedWorkflowId}`);
      let imageFilename = params?.inputImage || params?.uploadedImage;
      if (imageFilename && typeof imageFilename === "string") {
        imageFilename = await resolveAndUploadImage(imageFilename, `upload_${Date.now()}_1.png`);
      }
      let lastImageFilename = params?.lastFrameImage;
      if (lastImageFilename && typeof lastImageFilename === "string") {
        lastImageFilename = await resolveAndUploadImage(lastImageFilename, `upload_${Date.now()}_2.png`);
      } else if (!lastImageFilename && resolvedWorkflowId === "minimax_fl2va") {
        lastImageFilename = imageFilename;
      }
      const seed = !params?.seed || params.seed === -1 ? Math.floor(Math.random() * 1e9) : params.seed;
      const width = Number(params?.width) || 1280;
      const height = Number(params?.height) || 720;
      const duration = Number(params?.duration) || 15;
      const replacements = {};
      for (const [nodeId, nodeParams] of Object.entries(mapping.nodeIds)) {
        replacements[nodeId] = {};
        for (const [paramKey, value] of Object.entries(nodeParams)) {
          if (typeof value === "string" && value.startsWith("{{") && value.endsWith("}}")) {
            const key = value.slice(2, -2);
            switch (key) {
              case "seed":
                replacements[nodeId][paramKey] = seed;
                break;
              case "prompt":
                replacements[nodeId][paramKey] = userPrompt || "";
                break;
              case "negativePrompt":
                replacements[nodeId][paramKey] = params?.negativePrompt || "";
                break;
              case "width":
                replacements[nodeId][paramKey] = width;
                break;
              case "height":
                replacements[nodeId][paramKey] = height;
                break;
              case "duration":
                replacements[nodeId][paramKey] = duration;
                break;
              case "inputImage":
                if (imageFilename) replacements[nodeId][paramKey] = imageFilename;
                break;
              case "lastFrameImage":
                if (lastImageFilename) replacements[nodeId][paramKey] = lastImageFilename;
                break;
              default:
                replacements[nodeId][paramKey] = value;
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
        userPrompt || "",
        imageFilename,
        lastImageFilename
      );
      const promptId = await submitWorkflow(modifiedWorkflow);
      const history = await pollCompletion(promptId, 120, 2500);
      const outputFileInfo = extractOutputsFromHistory(history);
      let outputUrl = null;
      if (outputFileInfo) {
        outputUrl = `/api/view-comfy?filename=${encodeURIComponent(outputFileInfo.filename)}&subfolder=${encodeURIComponent(outputFileInfo.subfolder || "")}&type=${encodeURIComponent(outputFileInfo.type || "output")}`;
      } else {
        outputUrl = getFirstOutputUrl(mapping.outputPrefix);
      }
      const isVideo = outputFileInfo?.isVideo || mapping.outputPrefix.toLowerCase().includes("minimax");
      res.json({
        success: !!outputUrl,
        taskId: (0, import_crypto.randomUUID)(),
        workflowName: getWorkflowDisplayName(resolvedWorkflowId),
        workflowId: resolvedWorkflowId,
        status: outputUrl ? "completed" : "failed",
        progress: outputUrl ? 100 : 0,
        outputType: isVideo ? "video" : "image",
        outputUrl,
        avatarResponse: {
          text: outputUrl ? "\u5DF2\u7D93\u70BA\u60A8\u8ABF\u5EA6 ComfyUI \u6210\u529F\u5B8C\u6210\u5275\u4F5C\uFF01" : "\u751F\u6210\u5931\u6557\uFF0C\u8ACB\u6AA2\u67E5 ComfyUI \u63A7\u5236\u53F0"
        },
        executionTimeMs: history?.metrics?.total_ms
      });
    } catch (error) {
      console.error("[Dispatch Error]:", error.message);
      res.status(500).json({
        success: false,
        message: error.message,
        avatarResponse: { text: `\u8ABF\u5EA6\u904E\u7A0B\u767C\u751F\u932F\u8AA4: ${error.message}` }
      });
    }
  });
  app.get("/api/comfyui/status", async (req, res) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);
      const comfyRes = await fetch(`${COMFYUI_URL}/system_stats`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!comfyRes.ok) throw new Error(`ComfyUI \u72C0\u614B\u7570\u5E38: ${comfyRes.status}`);
      const data = await comfyRes.json();
      const device = data.devices?.[0];
      const vramTotalGb = device ? parseFloat((device.vram_total / (1024 * 1024 * 1024)).toFixed(1)) : 24;
      const vramFreeGb = device ? parseFloat((device.vram_free / (1024 * 1024 * 1024)).toFixed(1)) : 12;
      const vramUsedGb = parseFloat((vramTotalGb - vramFreeGb).toFixed(1));
      return res.json({
        success: true,
        systemStats: {
          gpu: {
            name: device?.name || "NVIDIA GPU",
            vramUsedGb,
            vramTotalGb,
            loadPercent: vramTotalGb > 0 ? Math.round(vramUsedGb / vramTotalGb * 100) : 0,
            temperatureC: 52,
            activeJobsCount: data.exec_info?.queue_remaining || 0,
            comfyConnected: true,
            comfyHost: COMFYUI_URL
          }
        }
      });
    } catch (error) {
      return res.json({
        success: false,
        systemStats: {
          gpu: {
            name: "ComfyUI \u96E2\u7DDA\u4E2D",
            vramUsedGb: 0,
            vramTotalGb: 24,
            loadPercent: 0,
            temperatureC: 0,
            activeJobsCount: 0,
            comfyConnected: false,
            comfyHost: COMFYUI_URL
          }
        }
      });
    }
  });
  app.post("/api/comfyui/interrupt", async (_req, res) => {
    try {
      const interruptRes = await fetch(`${COMFYUI_URL}/interrupt`, { method: "POST" });
      if (!interruptRes.ok) throw new Error(`\u4E2D\u65B7\u5931\u6557: ${interruptRes.status}`);
      return res.json({ success: true, message: "\u5DF2\u767C\u9001\u4E2D\u65B7\u6307\u4EE4" });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });
  app.get("/api/comfyui/queue", async (_req, res) => {
    try {
      const queueRes = await fetch(`${COMFYUI_URL}/queue`);
      if (!queueRes.ok) throw new Error(`\u7121\u6CD5\u53D6\u5F97\u4F47\u5217: ${queueRes.status}`);
      const data = await queueRes.json();
      return res.json({
        success: true,
        running: data.queue_running || [],
        pending: data.queue_pending || []
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });
  app.post("/api/comfyui/queue/delete", async (req, res) => {
    try {
      const { promptId, clearAll } = req.body;
      if (clearAll) {
        await fetch(`${COMFYUI_URL}/queue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clear: true })
        });
        return res.json({ success: true, message: "\u5DF2\u6E05\u7A7A\u6240\u6709\u6392\u7A0B" });
      }
      if (promptId) {
        await fetch(`${COMFYUI_URL}/queue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ delete: [promptId] })
        });
        return res.json({ success: true, message: `\u5DF2\u53D6\u6D88\u4EFB\u52D9 ${promptId}` });
      }
      return res.status(400).json({ success: false, message: "\u7F3A\u5C11\u53C3\u6578" });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  });
  const vite = await (0, import_vite.createServer)({
    server: {
      middlewareMode: true,
      hmr: { port: 24679 },
      allowedHosts: true
    },
    appType: "spa"
  });
  app.use(vite.middlewares);
  app.use("/comfyui_output", import_express.default.static(COMFYUI_OUTPUT_DIR));
  const server = app.listen(PORT, "127.0.0.1", () => {
    console.log(`=================================================`);
    console.log(`\u{1F680} Express Backend Server running on http://127.0.0.1:${PORT}`);
    console.log(`=================================================`);
  });
  process.on("SIGINT", () => {
    server.close(() => process.exit(0));
  });
}
startServer().catch(console.error);
//# sourceMappingURL=server.cjs.map
