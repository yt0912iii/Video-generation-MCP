import fs from 'fs';
import path from 'path';

export type VideoJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface VideoJob {
  id: string;
  workflowId?: string;
  workflowName?: string;
  status: VideoJobStatus;
  createdAt: string;
  updatedAt: string;
  promptId?: string;
  queuePosition?: number;
  startedAt?: string;
  completedAt?: string;
  output?: { filename: string; subfolder?: string; type?: string };
  result?: any;
  error?: { code: string; message: string };
}

export class VideoJobStore {
  private readonly jobs = new Map<string, VideoJob>();

  constructor(private readonly filePath = path.join(process.cwd(), 'data', 'jobs.json')) {
    try {
      const saved = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as VideoJob[];
      for (const job of saved) this.jobs.set(job.id, job);
    } catch {
      // First run or an unreadable store starts empty; the next update recreates it.
    }
  }

  private persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify([...this.jobs.values()], null, 2), 'utf8');
    fs.renameSync(temporaryPath, this.filePath);
  }

  create(id: string): VideoJob {
    const now = new Date().toISOString();
    const job: VideoJob = { id, status: 'queued', createdAt: now, updatedAt: now };
    this.jobs.set(id, job);
    this.persist();
    return job;
  }

  get(id: string): VideoJob | undefined {
    return this.jobs.get(id);
  }

  list(): VideoJob[] {
    return [...this.jobs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  pruneOlderThan(maxAgeMs: number) {
    const cutoff = Date.now() - maxAgeMs;
    let changed = false;
    for (const [id, job] of this.jobs) {
      if (['completed', 'failed', 'cancelled'].includes(job.status) && Date.parse(job.updatedAt) < cutoff) {
        this.jobs.delete(id);
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  update(id: string, patch: Partial<Omit<VideoJob, 'id' | 'createdAt'>>): VideoJob | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    this.persist();
    return job;
  }
}
