import React, { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock3, Download, Film, LoaderCircle, Maximize2, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { VideoTask } from '../types';

interface VideoTaskCenterProps {
  tasks: VideoTask[];
  comfyActiveJobs: number;
  comfyConnected: boolean;
}

function statusLabel(status: VideoTask['status']) {
  if (status === 'queued') return '正在排隊';
  if (status === 'running') return '正在處理';
  if (status === 'completed') return '已完成';
  if (status === 'cancelled') return '已取消';
  return '失敗';
}

function formatSubmittedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('zh-TW', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

export const VideoTaskCenter: React.FC<VideoTaskCenterProps> = ({ tasks, comfyActiveJobs, comfyConnected }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [previewTask, setPreviewTask] = useState<VideoTask | null>(null);
  const activeTasks = useMemo(() => tasks.filter((task) => task.status === 'queued' || task.status === 'running'), [tasks]);
  const activeCount = Math.max(activeTasks.length, comfyActiveJobs);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        title="影片任務中心"
        className="fixed right-0 top-1/2 -translate-y-1/2 z-50 flex items-center gap-2 rounded-l-xl border border-r-0 border-blue-500/50 bg-zinc-900/95 px-2.5 py-3 text-zinc-200 shadow-xl backdrop-blur transition hover:bg-zinc-800"
      >
        {isOpen ? <PanelLeftClose className="h-4 w-4 text-blue-300" /> : <PanelLeftOpen className="h-4 w-4 text-blue-300" />}
        <span className="text-xs font-medium [writing-mode:vertical-rl]">影片任務</span>
        {activeCount > 0 && (
          <span className="absolute -left-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-bold text-white ring-2 ring-zinc-950">
            {activeCount > 99 ? '99+' : activeCount}
          </span>
        )}
      </button>

      {isOpen && (
        <aside className="fixed inset-y-0 right-0 z-40 flex w-[min(92vw,380px)] flex-col border-l border-zinc-800 bg-zinc-950/98 pt-20 shadow-2xl backdrop-blur">
          <div className="flex items-start justify-between border-b border-zinc-800 px-4 pb-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <Film className="h-4 w-4 text-blue-400" />
                影片任務中心
              </div>
              <p className="mt-1 text-[11px] text-zinc-500">切換生成方式後，任務仍會在背景執行</p>
            </div>
            <button type="button" onClick={() => setIsOpen(false)} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 border-b border-zinc-800 p-4 text-[11px]">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-2">
              <span className="block text-zinc-500">目前任務</span>
              <span className="mt-1 block text-lg font-semibold text-blue-300">{activeTasks.length}</span>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-2">
              <span className="block text-zinc-500">ComfyUI Queue</span>
              <span className={`mt-1 block text-lg font-semibold ${comfyConnected ? 'text-emerald-300' : 'text-zinc-500'}`}>{comfyConnected ? comfyActiveJobs : '--'}</span>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {tasks.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-zinc-600">
                <Film className="h-8 w-8" />
                <p className="text-xs">目前還沒有影片任務</p>
              </div>
            ) : tasks.map((task) => (
              <div key={task.id} className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-950">
                    {task.outputUrl ? (
                      <video src={task.outputUrl} muted className="h-full w-full object-cover" />
                    ) : task.status === 'failed' ? (
                      <AlertCircle className="h-5 w-5 text-rose-400" />
                    ) : (
                      <LoaderCircle className="h-5 w-5 animate-spin text-blue-400" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-zinc-200">{task.workflowName}</div>
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-500">
                      {task.status === 'completed' ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : task.status === 'queued' ? <Clock3 className="h-3 w-3 text-amber-400" /> : task.status === 'failed' ? <AlertCircle className="h-3 w-3 text-rose-400" /> : <LoaderCircle className="h-3 w-3 animate-spin text-blue-400" />}
                      {statusLabel(task.status)}
                    </div>
                    {task.status === 'queued' && task.queuePosition !== undefined && task.queuePosition > 0 && (
                      <div className="mt-0.5 text-[10px] text-amber-300/80">前方排隊：{task.queuePosition} 個任務</div>
                    )}
                    <div className="mt-1 text-[10px] text-zinc-500">送出時間：{formatSubmittedAt(task.createdAt)}</div>
                    {task.status === 'completed' && task.executionTimeMs !== undefined && (
                      <div className="mt-0.5 text-[10px] text-emerald-400/80">處理耗時：{(task.executionTimeMs / 1000).toFixed(1)} 秒</div>
                    )}
                    {task.errorMessage && <p className="mt-1 line-clamp-2 text-[10px] text-rose-300">{task.errorMessage}</p>}
                  </div>
                </div>
                {task.outputUrl && (
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => setPreviewTask(task)} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600/20 px-2 py-1.5 text-[11px] font-medium text-blue-300 hover:bg-blue-600/30">
                      <Maximize2 className="h-3.5 w-3.5" /> 預覽影片
                    </button>
                    <a href={task.outputUrl} download className="flex items-center justify-center rounded-lg border border-zinc-700 px-2.5 text-zinc-300 hover:bg-zinc-800" title="下載影片">
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        </aside>
      )}

      {previewTask?.outputUrl && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={() => setPreviewTask(null)}>
          <div className="w-full max-w-5xl rounded-2xl border border-zinc-700 bg-zinc-950 p-3 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between px-1">
              <span className="truncate text-sm font-medium text-zinc-200">{previewTask.workflowName}</span>
              <div className="flex items-center gap-2">
                <a href={previewTask.outputUrl} download className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"><Download className="h-3.5 w-3.5" />下載</a>
                <button type="button" onClick={() => setPreviewTask(null)} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <video src={previewTask.outputUrl} controls autoPlay className="max-h-[75vh] w-full rounded-xl bg-black" />
          </div>
        </div>
      )}
    </>
  );
};
