export interface GpuStatus {
  name: string;
  vramUsedGb: number;
  vramTotalGb: number;
  loadPercent: number;
  temperatureC: number;
  activeJobsCount: number;
  comfyConnected: boolean;
  comfyHost: string;
}

export type VideoTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface VideoTask {
  id: string;
  workflowName: string;
  status: VideoTaskStatus;
  createdAt: string;
  updatedAt: string;
  queuePosition?: number;
  executionTimeMs?: number;
  outputUrl?: string;
  errorMessage?: string;
}
