import { useEffect, useState } from 'react';
import { Header } from './components/Header';
import { SettingsModal } from './components/SettingsModal';
import { VideoTaskCenter } from './components/VideoTaskCenter';
import VideoGenerationView from './VideoGenerationView';
import { GpuStatus, VideoTask } from './types';

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || window.location.origin).replace(/\/$/, '');

const OFFLINE_GPU: GpuStatus = {
  name: 'ComfyUI 離線中', vramUsedGb: 0, vramTotalGb: 24, loadPercent: 0,
  temperatureC: 0, activeJobsCount: 0, comfyConnected: false, comfyHost: 'http://127.0.0.1:8188',
};

export default function App() {
  const [gpuStatus, setGpuStatus] = useState<GpuStatus>(OFFLINE_GPU);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [videoTasks, setVideoTasks] = useState<VideoTask[]>([]);

  const handleTaskUpdate = (task: VideoTask) => {
    setVideoTasks((currentTasks) => {
      const existingIndex = currentTasks.findIndex((currentTask) => currentTask.id === task.id);
      if (existingIndex === -1) return [...currentTasks, task].slice(-20);
      return currentTasks.map((currentTask, index) => index === existingIndex ? task : currentTask);
    });
  };

  const refreshStatus = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/comfyui/status`);
      const data = await response.json();
      if (data.systemStats?.gpu) setGpuStatus(data.systemStats.gpu);
    } catch {
      setGpuStatus(OFFLINE_GPU);
    }
  };

  useEffect(() => {
    refreshStatus();
    fetch(`${BACKEND_URL}/api/video/jobs`)
      .then((response) => response.json())
      .then((payload) => {
        if (!Array.isArray(payload.jobs)) return;
        setVideoTasks(payload.jobs.map((job: any): VideoTask => ({
          id: job.id,
          workflowName: job.workflowName || job.workflowId || '影片任務',
          status: job.status,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          queuePosition: job.queuePosition,
          executionTimeMs: job.result?.executionTimeMs,
          outputUrl: job.result?.outputUrl?.startsWith('http') ? job.result.outputUrl : job.result?.outputUrl ? `${BACKEND_URL}${job.result.outputUrl}` : undefined,
          errorMessage: job.error?.message,
        })));
      })
      .catch(() => undefined);
    const timer = window.setInterval(refreshStatus, 3000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-zinc-800 selection:text-zinc-100 relative">
      <Header
        gpuStatus={gpuStatus}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenWorkflowsModal={() => undefined}
        onRefreshStatus={refreshStatus}
      />

      <div className="border-b border-zinc-800">
        <div className="max-w-[1600px] w-full mx-auto px-3 sm:px-5">
          <div className="flex gap-1">
            <button className="px-4 py-3 text-sm font-medium border-b-2 border-purple-500 text-purple-400 cursor-default">
              🎬 影片生成
            </button>
          </div>
        </div>
      </div>

      <main className="flex-1 max-w-[1600px] w-full mx-auto p-3 sm:p-5 grid grid-cols-1 lg:grid-cols-12 gap-4">
        <section className="lg:col-span-12">
          <VideoGenerationView
            onTaskUpdate={handleTaskUpdate}
            activeTaskCount={videoTasks.filter((task) => task.status === 'queued' || task.status === 'running').length}
          />
        </section>
      </main>

      {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
      <VideoTaskCenter
        tasks={videoTasks}
        comfyActiveJobs={gpuStatus.activeJobsCount}
        comfyConnected={gpuStatus.comfyConnected}
      />
    </div>
  );
}
