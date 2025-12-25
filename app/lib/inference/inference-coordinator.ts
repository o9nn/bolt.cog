/**
 * Inference Coordinator
 * Manages multiple inference engines for parallel processing
 * Optimized for Deep Tree Echo parallel inference
 */

import { GGMLEngine } from './ggml-engine';
import type {
  GGMLConfig,
  InferenceRequest,
  InferenceResponse,
  QuantizationType,
  BackendType,
} from './ggml-engine';

export interface CoordinatorConfig {
  maxEngines: number;
  defaultQuantization: QuantizationType;
  defaultBackend: BackendType;
  loadBalancing: 'round-robin' | 'least-loaded' | 'priority';
  enableCaching: boolean;
  cacheSize: number;
}

export interface InferenceJob {
  id: string;
  request: InferenceRequest;
  priority: number;
  callback?: (response: InferenceResponse) => void;
  createdAt: number;
}

export interface EngineStatus {
  id: string;
  modelName: string;
  status: 'idle' | 'loading' | 'processing' | 'error';
  currentJob?: string;
  processedJobs: number;
  averageLatency: number;
  lastActive: number;
}

/**
 * Inference Coordinator
 * Manages parallel inference across multiple GGML engines
 */
export class InferenceCoordinator {
  private config: CoordinatorConfig;
  private engines: Map<string, GGMLEngine>;
  private engineStatus: Map<string, EngineStatus>;
  private jobQueue: InferenceJob[];
  private responseCache: Map<string, CachedResponse>;
  private metrics: CoordinatorMetrics;
  private isRunning: boolean = false;

  constructor(config: Partial<CoordinatorConfig> = {}) {
    this.config = {
      maxEngines: 3,
      defaultQuantization: 'Q4_K_M',
      defaultBackend: 'CPU',
      loadBalancing: 'least-loaded',
      enableCaching: true,
      cacheSize: 1000,
      ...config,
    };

    this.engines = new Map();
    this.engineStatus = new Map();
    this.jobQueue = [];
    this.responseCache = new Map();
    this.metrics = {
      totalJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      cacheHits: 0,
      cacheMisses: 0,
      averageLatency: 0,
      tokensPerSecond: 0,
    };
  }

  /**
   * Initialize the coordinator with engines
   */
  async initialize(modelPath: string, engineCount: number = 3): Promise<void> {
    const count = Math.min(engineCount, this.config.maxEngines);

    for (let i = 0; i < count; i++) {
      const engineId = `engine_${i}`;
      const engine = new GGMLEngine({
        quantization: this.config.defaultQuantization,
        backend: this.config.defaultBackend,
      });

      await engine.loadModel(modelPath);
      this.engines.set(engineId, engine);
      
      this.engineStatus.set(engineId, {
        id: engineId,
        modelName: modelPath,
        status: 'idle',
        processedJobs: 0,
        averageLatency: 0,
        lastActive: Date.now(),
      });
    }

    this.isRunning = true;
    this.processQueue();
  }

  /**
   * Submit an inference job
   */
  async submit(request: InferenceRequest, priority: number = 5): Promise<InferenceResponse> {
    // Check cache first
    if (this.config.enableCaching) {
      const cacheKey = this.getCacheKey(request);
      const cached = this.responseCache.get(cacheKey);
      
      if (cached && Date.now() - cached.timestamp < 300000) { // 5 min TTL
        this.metrics.cacheHits++;
        return cached.response;
      }
      this.metrics.cacheMisses++;
    }

    // Create job
    const job: InferenceJob = {
      id: this.generateId(),
      request,
      priority,
      createdAt: Date.now(),
    };

    this.metrics.totalJobs++;

    // Execute immediately if engine available
    const availableEngine = this.findAvailableEngine();
    if (availableEngine) {
      return this.executeJob(job, availableEngine);
    }

    // Queue the job
    return new Promise((resolve, reject) => {
      job.callback = (response) => {
        if (response.finishReason === 'error') {
          reject(new Error(response.text));
        } else {
          resolve(response);
        }
      };
      this.enqueueJob(job);
    });
  }

  /**
   * Submit multiple jobs for parallel processing
   */
  async submitBatch(
    requests: InferenceRequest[],
    priority: number = 5,
  ): Promise<InferenceResponse[]> {
    const promises = requests.map((request) => this.submit(request, priority));
    return Promise.all(promises);
  }

  /**
   * Stream inference results
   */
  async *stream(request: InferenceRequest): AsyncGenerator<string, void, unknown> {
    const engine = await this.waitForEngine();
    const engineId = this.getEngineId(engine);
    
    this.updateEngineStatus(engineId, 'processing');

    try {
      for await (const token of engine.inferStream(request)) {
        yield token;
      }
    } finally {
      this.updateEngineStatus(engineId, 'idle');
    }
  }

  /**
   * Get embeddings
   */
  async embed(text: string): Promise<number[]> {
    const engine = await this.waitForEngine();
    return engine.embed(text);
  }

  /**
   * Get coordinator status
   */
  getStatus(): CoordinatorStatus {
    return {
      isRunning: this.isRunning,
      engineCount: this.engines.size,
      queueLength: this.jobQueue.length,
      engines: Array.from(this.engineStatus.values()),
      metrics: { ...this.metrics },
    };
  }

  /**
   * Get metrics
   */
  getMetrics(): CoordinatorMetrics {
    return { ...this.metrics };
  }

  /**
   * Shutdown the coordinator
   */
  async shutdown(): Promise<void> {
    this.isRunning = false;

    // Wait for active jobs to complete
    await this.waitForCompletion();

    // Unload all engines
    for (const engine of this.engines.values()) {
      engine.unload();
    }

    this.engines.clear();
    this.engineStatus.clear();
    this.jobQueue = [];
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private async processQueue(): Promise<void> {
    while (this.isRunning) {
      if (this.jobQueue.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        continue;
      }

      const engine = this.findAvailableEngine();
      if (!engine) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        continue;
      }

      const job = this.dequeueJob();
      if (job) {
        this.executeJob(job, engine).then((response) => {
          job.callback?.(response);
        }).catch((error) => {
          job.callback?.({
            text: error.message,
            tokens: 0,
            promptTokens: 0,
            completionTokens: 0,
            timings: {
              promptEvalTime: 0,
              tokenGenTime: 0,
              totalTime: 0,
              tokensPerSecond: 0,
            },
            finishReason: 'error',
          });
        });
      }
    }
  }

  private async executeJob(
    job: InferenceJob,
    engine: GGMLEngine,
  ): Promise<InferenceResponse> {
    const engineId = this.getEngineId(engine);
    this.updateEngineStatus(engineId, 'processing', job.id);

    const startTime = Date.now();

    try {
      const response = await engine.infer(job.request);
      const latency = Date.now() - startTime;

      // Update metrics
      this.metrics.completedJobs++;
      this.updateAverageLatency(latency);
      this.updateTokensPerSecond(response.timings.tokensPerSecond);

      // Update engine status
      const status = this.engineStatus.get(engineId);
      if (status) {
        status.processedJobs++;
        status.averageLatency = 
          (status.averageLatency * (status.processedJobs - 1) + latency) / 
          status.processedJobs;
      }

      // Cache response
      if (this.config.enableCaching) {
        this.cacheResponse(job.request, response);
      }

      return response;
    } catch (error) {
      this.metrics.failedJobs++;
      throw error;
    } finally {
      this.updateEngineStatus(engineId, 'idle');
    }
  }

  private findAvailableEngine(): GGMLEngine | null {
    switch (this.config.loadBalancing) {
      case 'round-robin':
        return this.findRoundRobin();
      case 'least-loaded':
        return this.findLeastLoaded();
      case 'priority':
        return this.findByPriority();
      default:
        return this.findLeastLoaded();
    }
  }

  private findRoundRobin(): GGMLEngine | null {
    for (const [id, status] of this.engineStatus) {
      if (status.status === 'idle') {
        return this.engines.get(id) || null;
      }
    }
    return null;
  }

  private findLeastLoaded(): GGMLEngine | null {
    let bestEngine: GGMLEngine | null = null;
    let lowestLoad = Infinity;

    for (const [id, status] of this.engineStatus) {
      if (status.status === 'idle') {
        const load = status.processedJobs;
        if (load < lowestLoad) {
          lowestLoad = load;
          bestEngine = this.engines.get(id) || null;
        }
      }
    }

    return bestEngine;
  }

  private findByPriority(): GGMLEngine | null {
    // For priority-based, prefer engines with lower average latency
    let bestEngine: GGMLEngine | null = null;
    let lowestLatency = Infinity;

    for (const [id, status] of this.engineStatus) {
      if (status.status === 'idle' && status.averageLatency < lowestLatency) {
        lowestLatency = status.averageLatency;
        bestEngine = this.engines.get(id) || null;
      }
    }

    return bestEngine;
  }

  private async waitForEngine(): Promise<GGMLEngine> {
    while (true) {
      const engine = this.findAvailableEngine();
      if (engine) return engine;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  private async waitForCompletion(): Promise<void> {
    const timeout = 30000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const activeCount = Array.from(this.engineStatus.values()).filter(
        (s) => s.status === 'processing'
      ).length;

      if (activeCount === 0 && this.jobQueue.length === 0) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private enqueueJob(job: InferenceJob): void {
    // Insert by priority (higher priority first)
    let inserted = false;
    for (let i = 0; i < this.jobQueue.length; i++) {
      if (job.priority > this.jobQueue[i].priority) {
        this.jobQueue.splice(i, 0, job);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      this.jobQueue.push(job);
    }
  }

  private dequeueJob(): InferenceJob | undefined {
    return this.jobQueue.shift();
  }

  private getEngineId(engine: GGMLEngine): string {
    for (const [id, e] of this.engines) {
      if (e === engine) return id;
    }
    return '';
  }

  private updateEngineStatus(
    engineId: string,
    status: EngineStatus['status'],
    jobId?: string,
  ): void {
    const engineStatus = this.engineStatus.get(engineId);
    if (engineStatus) {
      engineStatus.status = status;
      engineStatus.currentJob = jobId;
      engineStatus.lastActive = Date.now();
    }
  }

  private getCacheKey(request: InferenceRequest): string {
    return JSON.stringify({
      prompt: request.prompt,
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      topK: request.topK,
      topP: request.topP,
    });
  }

  private cacheResponse(request: InferenceRequest, response: InferenceResponse): void {
    const key = this.getCacheKey(request);
    
    // Enforce cache size limit
    if (this.responseCache.size >= this.config.cacheSize) {
      // Remove oldest entry
      const oldestKey = this.responseCache.keys().next().value;
      if (oldestKey) {
        this.responseCache.delete(oldestKey);
      }
    }

    this.responseCache.set(key, {
      response,
      timestamp: Date.now(),
    });
  }

  private updateAverageLatency(latency: number): void {
    const total = this.metrics.completedJobs;
    this.metrics.averageLatency = 
      (this.metrics.averageLatency * (total - 1) + latency) / total;
  }

  private updateTokensPerSecond(tps: number): void {
    const total = this.metrics.completedJobs;
    this.metrics.tokensPerSecond = 
      (this.metrics.tokensPerSecond * (total - 1) + tps) / total;
  }

  private generateId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Types
interface CachedResponse {
  response: InferenceResponse;
  timestamp: number;
}

interface CoordinatorMetrics {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  cacheHits: number;
  cacheMisses: number;
  averageLatency: number;
  tokensPerSecond: number;
}

interface CoordinatorStatus {
  isRunning: boolean;
  engineCount: number;
  queueLength: number;
  engines: EngineStatus[];
  metrics: CoordinatorMetrics;
}
