type JobFn = () => Promise<void>;

interface QueuedJob {
  id: string;
  name: string;
  fn: JobFn;
  resolve: () => void;
  reject: (err: Error) => void;
  queuedAt: number;
}

interface ActiveJob {
  id: string;
  name: string;
  startedAt: number;
}

class JobQueue {
  private queue: QueuedJob[] = [];
  private active: Map<string, ActiveJob> = new Map();
  private _maxConcurrent: number = 3;
  private _maxBatchSize: number = 20;
  private _totalProcessed: number = 0;
  private _totalFailed: number = 0;

  get maxConcurrent(): number {
    return this._maxConcurrent;
  }

  set maxConcurrent(n: number) {
    this._maxConcurrent = Math.max(1, Math.min(n, 20));
    // Try to start more jobs if limit increased
    this.processQueue();
  }

  get maxBatchSize(): number {
    return this._maxBatchSize;
  }

  set maxBatchSize(n: number) {
    // 0 = no limit
    this._maxBatchSize = Math.max(0, n);
  }

  get stats() {
    return {
      queued: this.queue.length,
      active: this.active.size,
      maxConcurrent: this._maxConcurrent,
      maxBatchSize: this._maxBatchSize,
      totalProcessed: this._totalProcessed,
      totalFailed: this._totalFailed,
      activeJobs: Array.from(this.active.values()).map((j) => ({
        id: j.id,
        name: j.name,
        runningFor: Date.now() - j.startedAt,
      })),
      queuedJobs: this.queue.map((j) => ({
        id: j.id,
        name: j.name,
        waitingFor: Date.now() - j.queuedAt,
      })),
    };
  }

  /**
   * Submit a job to the queue. Returns a promise that resolves when the job completes.
   */
  submit(id: string, name: string, fn: JobFn): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({ id, name, fn, resolve, reject, queuedAt: Date.now() });
      this.processQueue();
    });
  }

  /**
   * Submit a job fire-and-forget — doesn't block the caller.
   */
  enqueue(id: string, name: string, fn: JobFn): void {
    this.submit(id, name, fn).catch((err) => {
      console.error(`[JobQueue] Job ${id} (${name}) failed:`, err);
    });
  }

  private processQueue(): void {
    while (this.active.size < this._maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.active.set(job.id, { id: job.id, name: job.name, startedAt: Date.now() });
      this.runJob(job);
    }
  }

  private async runJob(job: QueuedJob): Promise<void> {
    try {
      await job.fn();
      this._totalProcessed++;
      job.resolve();
    } catch (err) {
      this._totalProcessed++;
      this._totalFailed++;
      job.reject(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.active.delete(job.id);
      this.processQueue();
    }
  }
}

// Singleton — shared across the entire application
export const jobQueue = new JobQueue();
