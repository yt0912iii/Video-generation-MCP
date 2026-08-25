import React, { useState, useRef } from 'react';
import { VideoTask } from './types';

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || window.location.origin).replace(/\/$/, '');

type VideoWorkflowType = 'ltx23_t2v' | 'image_to_video' | 'ltx23_i2v';
type MiniMaxGenerationMode = 'first_frame' | 'first_last_frame';

interface VideoWorkflowConfig {
  id: VideoWorkflowType;
  name: string;
  icon: string;
  description: string;
  requiresImage: boolean;
  allowsImage: boolean;
  supportsNegative: boolean;
  supportsAspectRatio?: boolean;
  requiresAudio?: boolean;
}

const VIDEO_WORKFLOW_CONFIGS: Record<VideoWorkflowType, VideoWorkflowConfig> = {
  ltx23_t2v: {
    id: 'ltx23_t2v',
    name: 'MiniMax H3文生影片',
    icon: '🎥',
    description: '使用 MiniMax H3 從文字提示直接生成具備動態與聲音的影片。',
    requiresImage: false,
    allowsImage: false,
    supportsNegative: false,
    supportsAspectRatio: true,
  },
  image_to_video: {
    id: 'image_to_video',
    name: 'MiniMax H3圖生影片',
    icon: '🎬',
    description: '使用 MiniMax H3 將起始首幀圖片轉化為動態影片。',
    requiresImage: true,
    allowsImage: true,
    supportsNegative: false,
    supportsAspectRatio: true,
  },
  ltx23_i2v: {
    id: 'ltx23_i2v',
    name: 'LTX2.3 音訊對嘴虛擬人',
    icon: '🌌',
    description: '結合角色圖片與台詞音訊，生成自然對嘴說話的虛擬人影片。',
    requiresImage: true,
    allowsImage: true,
    supportsNegative: true,
    requiresAudio: true,
  },
};

interface VideoGenerationViewProps {
  onAvatarResponse?: (resp: { text: string }) => void;
  workflow?: unknown;
  onWorkflowChange?: (workflow: any) => void;
  onGenerate?: (params: Record<string, any>) => Promise<any>;
  onTaskUpdate?: (task: VideoTask) => void;
  activeTaskCount?: number;
}

export default function VideoGenerationView({ onAvatarResponse, onTaskUpdate, activeTaskCount = 0 }: VideoGenerationViewProps) {
  const [selectedWorkflow, setSelectedWorkflow] = useState<VideoWorkflowType>('ltx23_t2v');

  // 提示詞狀態
  const [prompt, setPrompt] = useState('');

  const [negativePrompt, setNegativePrompt] = useState('blurry, jitter, distorted, low quality, static, frozen frame');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedImageFilename, setSelectedImageFilename] = useState<string | null>(null);
  const [imageLongestEdge, setImageLongestEdge] = useState<number | null>(null);
  const [imageWidth, setImageWidth] = useState<number | null>(null);
  const [imageHeight, setImageHeight] = useState<number | null>(null);
  const [selectedAudio, setSelectedAudio] = useState<string | null>(null);
  const [selectedAudioFilename, setSelectedAudioFilename] = useState<string | null>(null);
  const [selectedAudioDuration, setSelectedAudioDuration] = useState<number | null>(null);
  const [endImage, setEndImage] = useState<string | null>(null);
  const [endImageFilename, setEndImageFilename] = useState<string | null>(null);
  const [miniMaxMode, setMiniMaxMode] = useState<MiniMaxGenerationMode>('first_frame');
  const [aspectRatio, setAspectRatio] = useState('16:9 (Widescreen)');
  const [customWidth, setCustomWidth] = useState(1152);
  const [customHeight, setCustomHeight] = useState(640);

  const [workflowActivity, setWorkflowActivity] = useState<Record<VideoWorkflowType, number>>({
    ltx23_t2v: 0,
    image_to_video: 0,
    ltx23_i2v: 0,
  });
  const [pendingWorkflow, setPendingWorkflow] = useState<VideoWorkflowType | null>(null);
  const [isSwitchWarningOpen, setIsSwitchWarningOpen] = useState(false);
  const [resultVideoUrl, setResultVideoUrl] = useState<string | null>(null);
  const [executionTime, setExecutionTime] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const endFileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const currentConfig = VIDEO_WORKFLOW_CONFIGS[selectedWorkflow];
  const isLoading = workflowActivity[selectedWorkflow] > 0;

  const switchWorkflow = (workflow: VideoWorkflowType) => {
    if (workflow === selectedWorkflow) return;
    if (activeTaskCount > 0) {
      setPendingWorkflow(workflow);
      setIsSwitchWarningOpen(true);
      return;
    }
    setSelectedWorkflow(workflow);
    setResultVideoUrl(null);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        alert('檔案大小不能超過 10MB');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const imageData = reader.result as string;
        setSelectedImage(imageData);
        setSelectedImageFilename(file.name);
        const image = new window.Image();
        image.onload = () => {
          setImageLongestEdge(Math.max(image.naturalWidth, image.naturalHeight));
          setImageWidth(image.naturalWidth);
          setImageHeight(image.naturalHeight);
        };
        image.src = imageData;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAudioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const objectUrl = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl);
      if (!Number.isFinite(audio.duration) || audio.duration >= 15) {
        alert('音訊長度必須小於 15 秒');
        if (audioInputRef.current) audioInputRef.current.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedAudio(reader.result as string);
        setSelectedAudioFilename(file.name);
        setSelectedAudioDuration(audio.duration);
      };
      reader.readAsDataURL(file);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      alert('無法讀取音訊檔案');
    };
    audio.src = objectUrl;
  };

  const handleEndImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        alert('檔案大小不能超過 10MB');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setEndImage(reader.result as string);
        setEndImageFilename(file.name);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGenerate = async () => {
    if (currentConfig.requiresImage && !selectedImage) {
      alert(`「${currentConfig.name}」必須上傳一張參考圖片！`);
      return;
    }

    if (selectedWorkflow === 'image_to_video' && miniMaxMode === 'first_last_frame' && !endImage) {
      alert('「首尾幀生成影片」必須上傳結尾尾幀圖片！');
      return;
    }

    if (currentConfig.requiresAudio && !selectedAudio) {
      alert(`「${currentConfig.name}」必須上傳一個小於 15 秒的音訊檔案！`);
      return;
    }

    if (!prompt.trim() && !selectedImage) {
      alert('請輸入影片動作描述或上傳圖片！');
      return;
    }

    const submittedWorkflow = selectedWorkflow;
    setWorkflowActivity((activity) => ({
      ...activity,
      [submittedWorkflow]: activity[submittedWorkflow] + 1,
    }));
    setResultVideoUrl(null);

    try {
      const finalPromptToUse = prompt || 'cinematic motion video, high quality, 24fps';

      const res = await fetch(`${BACKEND_URL}/api/video/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userPrompt: finalPromptToUse,
          workflowId: selectedWorkflow,
          params: {
            seed: Math.floor(Math.random() * 999999999999),
            width: 768,
            height: 512,
            negativePrompt: negativePrompt,
            uploadedImage: selectedImage || undefined,
            endImage: miniMaxMode === 'first_last_frame' ? endImage || undefined : undefined,
            generationMode: miniMaxMode,
            aspectRatio,
            customWidth: aspectRatio === 'custom' ? customWidth : undefined,
            customHeight: aspectRatio === 'custom' ? customHeight : undefined,
            originalWidth: aspectRatio === 'original' ? imageWidth : undefined,
            originalHeight: aspectRatio === 'original' ? imageHeight : undefined,
            uploadedAudio: selectedWorkflow === 'ltx23_i2v' ? selectedAudio || undefined : undefined,
            audioFileName: selectedWorkflow === 'ltx23_i2v' ? selectedAudioFilename || undefined : undefined,
            maxDimension: selectedWorkflow === 'ltx23_i2v' ? imageLongestEdge || undefined : undefined,
          },
        }),
      });

      if (!res.ok) throw new Error(`伺服器錯誤 (${res.status})`);
      const queued = await res.json();
      if (!queued.jobId) throw new Error('影片任務建立失敗');

      const taskId = String(queued.jobId);
      const taskCreatedAt = new Date().toISOString();
      const updateTask = (patch: Partial<VideoTask>) => {
        onTaskUpdate?.({
          id: taskId,
          workflowName: currentConfig.name,
          status: 'queued',
          createdAt: taskCreatedAt,
          updatedAt: new Date().toISOString(),
          ...patch,
        });
      };
      updateTask({ status: queued.status === 'running' ? 'running' : 'queued' });

      let data: any = null;
      for (;;) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        const statusRes = await fetch(`${BACKEND_URL}/api/video/jobs/${encodeURIComponent(queued.jobId)}`);
        if (!statusRes.ok) throw new Error(`無法取得影片任務狀態 (${statusRes.status})`);
        const statusPayload = await statusRes.json();
        const job = statusPayload.job;
        if (job?.status === 'queued' || job?.status === 'running') updateTask({ status: job.status, queuePosition: job.queuePosition });
        if (job?.status === 'completed') {
          data = job.result;
          const outputUrl = data?.outputUrl?.startsWith('http') ? data.outputUrl : `${BACKEND_URL}${data?.outputUrl || ''}`;
          updateTask({ status: 'completed', queuePosition: 0, outputUrl, executionTimeMs: data?.executionTimeMs });
          break;
        }
        if (job?.status === 'failed' || job?.status === 'cancelled') {
          updateTask({ status: job.status, errorMessage: job.error?.message || `影片任務${job.status}` });
          throw new Error(job.error?.message || `影片任務${job.status}`);
        }
      }

      if (data.success && data.outputUrl) {
        const fullUrl = data.outputUrl.startsWith('http') ? data.outputUrl : `${BACKEND_URL}${data.outputUrl}`;
        setResultVideoUrl(fullUrl);
        setExecutionTime(data.executionTimeMs);
        if (onAvatarResponse && data.avatarResponse?.text) {
          onAvatarResponse({ text: data.avatarResponse.text });
        }
      } else {
        throw new Error(data.message || '影片生成失敗');
      }
    } catch (err: any) {
      alert(`影片生成失敗: ${err.message}`);
    } finally {
      setWorkflowActivity((activity) => ({
        ...activity,
        [submittedWorkflow]: Math.max(0, activity[submittedWorkflow] - 1),
      }));
    }
  };

  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 min-h-[680px] flex flex-col gap-5">
      {/* 工作流切換 */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold text-blue-400 flex items-center gap-1.5">
          <span>🎬</span> ComfyUI 影片生成工作流：
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {(Object.keys(VIDEO_WORKFLOW_CONFIGS) as VideoWorkflowType[]).map((key) => {
            const wf = VIDEO_WORKFLOW_CONFIGS[key];
            const isSelected = selectedWorkflow === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => switchWorkflow(key)}
                className={`p-3 rounded-xl border text-left flex flex-col gap-1 transition-all ${
                  isSelected
                    ? 'bg-blue-600/20 border-blue-500 ring-1 ring-blue-500/50 text-white'
                    : 'bg-zinc-950/60 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                }`}
              >
                <div className="flex items-center gap-2 font-medium text-sm">
                  <span>{wf.icon}</span>
                  <span className={isSelected ? 'text-blue-300 font-semibold' : ''}>{wf.name}</span>
                </div>
                <span className="text-[10px] text-zinc-500 line-clamp-2 leading-relaxed">
                  {wf.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 主控制面板 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1">
        {/* 左側輸入 */}
        <div className="lg:col-span-5 bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
            <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1">
              {currentConfig.icon} {currentConfig.name} - 動態參數
            </span>
            {currentConfig.requiresImage && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                需要參考圖
              </span>
            )}
          </div>

          {selectedWorkflow === 'image_to_video' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-zinc-400 font-medium">🎞️ 生成方式</label>
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-zinc-900/70 p-1 border border-zinc-800">
                {([
                  ['first_frame', '首圖生成影片'],
                  ['first_last_frame', '首尾幀生成影片'],
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setMiniMaxMode(mode);
                      setResultVideoUrl(null);
                    }}
                    className={`px-3 py-2 rounded-md text-xs font-medium transition-all ${
                      miniMaxMode === mode
                        ? 'bg-blue-600/20 border border-blue-500 text-blue-300 shadow-sm'
                        : 'border border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/70'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 圖片上傳 (圖生影專用) */}
          {currentConfig.allowsImage && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-zinc-400 font-medium flex items-center justify-between">
                <span>🖼️ 上傳起始首幀圖片 {currentConfig.requiresImage && <span className="text-amber-400">*</span>}</span>
                {selectedImage && (
                  <button
                    onClick={() => {
                      setSelectedImage(null);
                      setSelectedImageFilename(null);
                      setImageLongestEdge(null);
                      setImageWidth(null);
                      setImageHeight(null);
                    }}
                    className="text-[10px] text-red-400"
                  >
                    清除圖片
                  </button>
                )}
              </label>

              <input type="file" ref={fileInputRef} onChange={handleImageChange} accept="image/*" className="hidden" />

              {selectedImage ? (
                <div className="border border-blue-500/50 rounded-lg p-2 bg-zinc-900/60 flex items-center gap-3">
                  <img src={selectedImage} alt="Uploaded" className="w-14 h-14 object-cover rounded border border-zinc-700" />
                  <span className="text-xs text-zinc-200 truncate">{selectedImageFilename}</span>
                  {selectedWorkflow === 'ltx23_i2v' && imageLongestEdge && (
                    <span className="ml-auto text-[10px] text-blue-300 whitespace-nowrap">最長邊 {imageLongestEdge}px</span>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-zinc-800 hover:border-zinc-700 rounded-lg p-3 flex flex-col items-center gap-1"
                >
                  <span className="text-sm text-zinc-300">📤 點擊選擇參考圖片</span>
                </button>
              )}
            </div>
          )}

          {selectedWorkflow === 'ltx23_i2v' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-zinc-400 font-medium flex items-center justify-between">
                <span>🎵 上傳台詞音訊 <span className="text-amber-400">*</span></span>
                <span className="text-[10px] text-amber-300">小於 15 秒</span>
              </label>

              <input type="file" ref={audioInputRef} onChange={handleAudioChange} accept="audio/*" className="hidden" />

              {selectedAudio ? (
                <div className="border border-blue-500/50 rounded-lg p-2.5 bg-zinc-900/60 flex items-center gap-3">
                  <span className="text-lg">🎧</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-zinc-200 truncate">{selectedAudioFilename}</div>
                    <div className="text-[10px] text-zinc-500">{selectedAudioDuration?.toFixed(1)} 秒</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAudio(null);
                      setSelectedAudioFilename(null);
                      setSelectedAudioDuration(null);
                      if (audioInputRef.current) audioInputRef.current.value = '';
                    }}
                    className="text-[10px] text-red-400"
                  >
                    清除音訊
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => audioInputRef.current?.click()}
                  className="border-2 border-dashed border-zinc-800 hover:border-zinc-700 rounded-lg p-3 flex flex-col items-center gap-1"
                >
                  <span className="text-sm text-zinc-300">🎵 點擊選擇台詞音訊</span>
                </button>
              )}
            </div>
          )}

          {selectedWorkflow === 'image_to_video' && miniMaxMode === 'first_last_frame' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-zinc-400 font-medium flex items-center justify-between">
                <span>🖼️ 上傳結尾尾幀圖片 <span className="text-amber-400">*</span></span>
                {endImage && (
                  <button
                    type="button"
                    onClick={() => {
                      setEndImage(null);
                      setEndImageFilename(null);
                    }}
                    className="text-[10px] text-red-400"
                  >
                    清除圖片
                  </button>
                )}
              </label>

              <input type="file" ref={endFileInputRef} onChange={handleEndImageChange} accept="image/*" className="hidden" />

              {endImage ? (
                <div className="border border-blue-500/50 rounded-lg p-2 bg-zinc-900/60 flex items-center gap-3">
                  <img src={endImage} alt="End frame" className="w-14 h-14 object-cover rounded border border-zinc-700" />
                  <span className="text-xs text-zinc-200 truncate">{endImageFilename}</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => endFileInputRef.current?.click()}
                  className="border-2 border-dashed border-zinc-800 hover:border-zinc-700 rounded-lg p-3 flex flex-col items-center gap-1"
                >
                  <span className="text-sm text-zinc-300">📤 點擊選擇結尾尾幀圖片</span>
                </button>
              )}
            </div>
          )}

          {currentConfig.supportsAspectRatio && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-zinc-400 font-medium">📐 影片比例</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: '16:9 (Widescreen)', resolution: '1152 × 640', note: '橫向畫幅（16:9）' },
                  { value: '9:16 (Portrait Widescreen)', resolution: '640 × 1152', note: '直向畫幅（9:16）' },
                  ...(selectedWorkflow === 'image_to_video' ? [{ value: 'original', resolution: imageWidth && imageHeight ? `${imageWidth} × ${imageHeight}` : '維持原圖片解析度', note: '參考首幀圖片' }] : []),
                  { value: 'custom', resolution: '自定義解析度', note: '自定義寬高' },
                ].map((ratio) => (
                  <button
                    key={ratio.value}
                    type="button"
                    onClick={() => setAspectRatio(ratio.value)}
                    className={`px-3 py-2 rounded-lg border text-xs transition-all ${
                      ratio.value === 'custom' || ratio.value === 'original' ? 'col-span-2' : ''
                    } ${
                      aspectRatio === ratio.value
                        ? 'bg-blue-600/20 border-blue-500 text-blue-300 ring-1 ring-blue-500/40'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                    }`}
                  >
                    <span className="block font-medium">{ratio.resolution}</span>
                    <span className="block mt-0.5 text-[10px] text-zinc-500">{ratio.note}</span>
                  </button>
                ))}
              </div>
              {aspectRatio === 'custom' && (
                <div className="grid grid-cols-2 gap-2 mt-1.5">
                  <label className="text-[10px] text-zinc-500">
                    寬度
                    <input
                      type="number"
                      min={64}
                      max={4096}
                      step={16}
                      value={customWidth}
                      onChange={(e) => setCustomWidth(Number(e.target.value))}
                      className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
                    />
                  </label>
                  <label className="text-[10px] text-zinc-500">
                    高度
                    <input
                      type="number"
                      min={64}
                      max={4096}
                      step={16}
                      value={customHeight}
                      onChange={(e) => setCustomHeight(Number(e.target.value))}
                      className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          {/* 正向提示詞 */}
          <div className="flex flex-col gap-1.5 flex-1">
            <label className="text-xs text-zinc-400 font-medium">🎥 影片動作提示詞 (Prompt)</label>

            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="例如：女孩在雨中奔跑，鏡頭緩慢向前推進，動作自然流暢，電影感光影。"
              className="w-full flex-1 min-h-[90px] bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-100 font-mono resize-none focus:outline-none focus:border-blue-500"
            />
            {selectedWorkflow === 'ltx23_i2v' && (
              <span className="text-[10px] text-blue-400/80">
                系統會自動補上自然說話、嘴型同步音訊與角色穩定指令。
              </span>
            )}
          </div>

          {/* 負向提示詞 */}
          {currentConfig.supportsNegative && <div className="flex flex-col gap-1.5">
            <label className="text-xs text-zinc-400 font-medium">🚫 避雷提示詞 (Negative)</label>
            <input
              type="text"
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-100 font-mono focus:outline-none focus:border-red-500/50"
            />
          </div>}

          <button
            type="button"
            onClick={handleGenerate}
            disabled={(currentConfig.requiresImage && !selectedImage) || (currentConfig.requiresAudio && !selectedAudio) || (selectedWorkflow === 'image_to_video' && miniMaxMode === 'first_last_frame' && !endImage)}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-all disabled:opacity-50"
          >
            {isLoading ? 'ComfyUI 影片渲染中 (約需 30~90 秒)...' : `🚀 開始渲染影片 (${currentConfig.name})`}
          </button>
        </div>

        {/* 右側影片播放器 */}
        <div className="lg:col-span-7 bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex flex-col items-center justify-center relative min-h-[400px]">
          {isLoading ? (
            <div className="flex flex-col items-center gap-3 text-blue-400 animate-pulse">
              <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-sm font-medium">正在進行 ComfyUI 多幀畫面推算與影片合成...</span>
              <span className="text-xs text-zinc-500">影片渲染較耗費 GPU 效能，請耐心等候</span>
            </div>
          ) : resultVideoUrl ? (
            <div className="w-full h-full flex flex-col items-center justify-center gap-3">
              <video
                src={resultVideoUrl}
                controls
                autoPlay
                loop
                className="max-h-[480px] w-full rounded-lg border border-zinc-800 shadow-2xl object-contain bg-black"
              />
              <span className="text-xs text-zinc-500">
                渲染耗時: {executionTime ? `${(executionTime / 1000).toFixed(1)} 秒` : ''}
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-zinc-600 text-xs">
              <span className="text-3xl">🎞️</span>
              <span>影片生成成果預覽區</span>
            </div>
          )}
        </div>
      </div>

      {isSwitchWarningOpen && pendingWorkflow && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-300">!</div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">目前仍有影片正在生成</h3>
                <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                  現在有 {activeTaskCount} 個任務正在處理。若切換到「{VIDEO_WORKFLOW_CONFIGS[pendingWorkflow].name}」，目前生成結果會保留在影片任務中心，完成後可從任務中心預覽與下載。
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPendingWorkflow(null);
                  setIsSwitchWarningOpen(false);
                }}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                留在目前頁面
              </button>
              <button
                type="button"
                onClick={() => {
                  if (pendingWorkflow) setSelectedWorkflow(pendingWorkflow);
                  setResultVideoUrl(null);
                  setPendingWorkflow(null);
                  setIsSwitchWarningOpen(false);
                }}
                className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500"
              >
                繼續切換生成方式
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
