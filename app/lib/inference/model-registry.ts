/**
 * Model Registry
 * Manages model discovery, download, and configuration
 */

import type { QuantizationType, BackendType, ModelInfo } from './ggml-engine';

export interface RegisteredModel {
  id: string;
  name: string;
  description: string;
  architecture: ModelArchitecture;
  sizes: ModelSize[];
  quantizations: QuantizationType[];
  contextLengths: number[];
  capabilities: ModelCapability[];
  source: ModelSource;
  license: string;
  recommended: boolean;
}

export type ModelArchitecture =
  | 'llama'
  | 'llama2'
  | 'llama3'
  | 'mistral'
  | 'mixtral'
  | 'phi'
  | 'phi3'
  | 'qwen'
  | 'qwen2'
  | 'gemma'
  | 'gemma2'
  | 'deepseek'
  | 'yi'
  | 'command-r'
  | 'starcoder'
  | 'codellama'
  | 'mamba'
  | 'rwkv';

export type ModelSize = '0.5B' | '1B' | '1.5B' | '2B' | '3B' | '7B' | '8B' | '9B' | '13B' | '14B' | '27B' | '32B' | '33B' | '70B' | '72B' | '405B';

export type ModelCapability =
  | 'chat'
  | 'instruct'
  | 'code'
  | 'math'
  | 'reasoning'
  | 'multilingual'
  | 'vision'
  | 'long-context'
  | 'function-calling'
  | 'embedding';

export interface ModelSource {
  type: 'huggingface' | 'local' | 'url';
  repo?: string;
  path?: string;
  url?: string;
}

export interface ModelVariant {
  modelId: string;
  size: ModelSize;
  quantization: QuantizationType;
  contextLength: number;
  filename: string;
  fileSize: number;
  sha256?: string;
}

/**
 * Model Registry
 * Central registry for all available models
 */
export class ModelRegistry {
  private models: Map<string, RegisteredModel>;
  private variants: Map<string, ModelVariant[]>;
  private downloadedModels: Set<string>;

  constructor() {
    this.models = new Map();
    this.variants = new Map();
    this.downloadedModels = new Set();
    this.registerBuiltinModels();
  }

  /**
   * Register a model
   */
  register(model: RegisteredModel): void {
    this.models.set(model.id, model);
  }

  /**
   * Get a model by ID
   */
  get(id: string): RegisteredModel | undefined {
    return this.models.get(id);
  }

  /**
   * List all models
   */
  list(): RegisteredModel[] {
    return Array.from(this.models.values());
  }

  /**
   * Search models by capability
   */
  searchByCapability(capability: ModelCapability): RegisteredModel[] {
    return this.list().filter((m) => m.capabilities.includes(capability));
  }

  /**
   * Search models by architecture
   */
  searchByArchitecture(architecture: ModelArchitecture): RegisteredModel[] {
    return this.list().filter((m) => m.architecture === architecture);
  }

  /**
   * Get recommended models
   */
  getRecommended(): RegisteredModel[] {
    return this.list().filter((m) => m.recommended);
  }

  /**
   * Get model variants
   */
  getVariants(modelId: string): ModelVariant[] {
    return this.variants.get(modelId) || [];
  }

  /**
   * Add a model variant
   */
  addVariant(variant: ModelVariant): void {
    const variants = this.variants.get(variant.modelId) || [];
    variants.push(variant);
    this.variants.set(variant.modelId, variants);
  }

  /**
   * Find best variant for hardware constraints
   */
  findBestVariant(
    modelId: string,
    maxMemoryGB: number,
    preferredQuantization?: QuantizationType,
  ): ModelVariant | null {
    const variants = this.getVariants(modelId);
    if (variants.length === 0) return null;

    const maxBytes = maxMemoryGB * 1024 * 1024 * 1024;

    // Filter by memory constraint
    const fitting = variants.filter((v) => v.fileSize * 1.2 <= maxBytes);
    if (fitting.length === 0) return null;

    // Prefer specified quantization
    if (preferredQuantization) {
      const preferred = fitting.find((v) => v.quantization === preferredQuantization);
      if (preferred) return preferred;
    }

    // Sort by quality (higher quantization = better quality)
    const quantOrder: QuantizationType[] = [
      'F16', 'Q8_0', 'Q6_K', 'Q5_K_M', 'Q5_K_S', 
      'Q4_K_M', 'Q4_K_S', 'Q3_K_M', 'Q3_K_S', 
      'Q2_K', 'IQ2_XXS', 'IQ1_M', 'IQ1_S'
    ];

    fitting.sort((a, b) => {
      const aIdx = quantOrder.indexOf(a.quantization);
      const bIdx = quantOrder.indexOf(b.quantization);
      return aIdx - bIdx;
    });

    return fitting[0];
  }

  /**
   * Mark model as downloaded
   */
  markDownloaded(variantKey: string): void {
    this.downloadedModels.add(variantKey);
  }

  /**
   * Check if model is downloaded
   */
  isDownloaded(variantKey: string): boolean {
    return this.downloadedModels.has(variantKey);
  }

  /**
   * Get download URL for variant
   */
  getDownloadUrl(variant: ModelVariant): string | null {
    const model = this.models.get(variant.modelId);
    if (!model) return null;

    if (model.source.type === 'huggingface') {
      return `https://huggingface.co/${model.source.repo}/resolve/main/${variant.filename}`;
    }

    if (model.source.type === 'url') {
      return model.source.url || null;
    }

    return null;
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private registerBuiltinModels(): void {
    // Llama 3.2 - Latest and greatest
    this.register({
      id: 'llama-3.2',
      name: 'Llama 3.2',
      description: 'Meta\'s latest Llama model with improved reasoning',
      architecture: 'llama3',
      sizes: ['1B', '3B', '8B', '70B'],
      quantizations: ['Q4_K_M', 'Q5_K_M', 'Q6_K', 'Q8_0'],
      contextLengths: [8192, 32768, 131072],
      capabilities: ['chat', 'instruct', 'code', 'reasoning', 'multilingual'],
      source: { type: 'huggingface', repo: 'meta-llama/Llama-3.2-3B-Instruct' },
      license: 'Llama 3.2 Community License',
      recommended: true,
    });

    // Qwen 2.5 - Excellent for code and reasoning
    this.register({
      id: 'qwen-2.5',
      name: 'Qwen 2.5',
      description: 'Alibaba\'s powerful multilingual model',
      architecture: 'qwen2',
      sizes: ['0.5B', '1.5B', '3B', '7B', '14B', '32B', '72B'],
      quantizations: ['Q4_K_M', 'Q5_K_M', 'Q6_K', 'Q8_0'],
      contextLengths: [32768, 131072],
      capabilities: ['chat', 'instruct', 'code', 'math', 'reasoning', 'multilingual', 'long-context'],
      source: { type: 'huggingface', repo: 'Qwen/Qwen2.5-7B-Instruct' },
      license: 'Apache 2.0',
      recommended: true,
    });

    // Phi-3 - Microsoft's tiny powerhouse
    this.register({
      id: 'phi-3',
      name: 'Phi-3',
      description: 'Microsoft\'s compact but powerful model',
      architecture: 'phi3',
      sizes: ['3B', '7B', '14B'],
      quantizations: ['Q4_K_M', 'Q5_K_M', 'Q6_K', 'Q8_0'],
      contextLengths: [4096, 8192, 128000],
      capabilities: ['chat', 'instruct', 'code', 'reasoning'],
      source: { type: 'huggingface', repo: 'microsoft/Phi-3-mini-4k-instruct' },
      license: 'MIT',
      recommended: true,
    });

    // Mistral - Fast and efficient
    this.register({
      id: 'mistral',
      name: 'Mistral',
      description: 'Fast and efficient 7B model',
      architecture: 'mistral',
      sizes: ['7B'],
      quantizations: ['Q4_K_M', 'Q5_K_M', 'Q6_K', 'Q8_0'],
      contextLengths: [8192, 32768],
      capabilities: ['chat', 'instruct', 'code', 'function-calling'],
      source: { type: 'huggingface', repo: 'mistralai/Mistral-7B-Instruct-v0.3' },
      license: 'Apache 2.0',
      recommended: true,
    });

    // DeepSeek Coder - Best for code
    this.register({
      id: 'deepseek-coder',
      name: 'DeepSeek Coder',
      description: 'Specialized coding model',
      architecture: 'deepseek',
      sizes: ['1.5B', '7B', '33B'],
      quantizations: ['Q4_K_M', 'Q5_K_M', 'Q6_K', 'Q8_0'],
      contextLengths: [16384, 32768],
      capabilities: ['code', 'instruct', 'function-calling'],
      source: { type: 'huggingface', repo: 'deepseek-ai/deepseek-coder-7b-instruct-v1.5' },
      license: 'DeepSeek License',
      recommended: true,
    });

    // Gemma 2 - Google's open model
    this.register({
      id: 'gemma-2',
      name: 'Gemma 2',
      description: 'Google\'s efficient open model',
      architecture: 'gemma2',
      sizes: ['2B', '9B', '27B'],
      quantizations: ['Q4_K_M', 'Q5_K_M', 'Q6_K', 'Q8_0'],
      contextLengths: [8192],
      capabilities: ['chat', 'instruct', 'reasoning'],
      source: { type: 'huggingface', repo: 'google/gemma-2-9b-it' },
      license: 'Gemma Terms of Use',
      recommended: true,
    });

    // SmolLM - Tiny but capable
    this.register({
      id: 'smollm',
      name: 'SmolLM',
      description: 'Hugging Face\'s tiny efficient model',
      architecture: 'llama',
      sizes: ['0.5B', '1B', '1.5B'],
      quantizations: ['Q4_K_M', 'Q5_K_M', 'Q8_0', 'F16'],
      contextLengths: [2048, 8192],
      capabilities: ['chat', 'instruct'],
      source: { type: 'huggingface', repo: 'HuggingFaceTB/SmolLM-1.7B-Instruct' },
      license: 'Apache 2.0',
      recommended: true,
    });

    // RWKV - Linear attention, infinite context
    this.register({
      id: 'rwkv',
      name: 'RWKV',
      description: 'RNN with transformer-level performance',
      architecture: 'rwkv',
      sizes: ['0.5B', '1.5B', '3B', '7B', '14B'],
      quantizations: ['Q4_K_M', 'Q5_K_M', 'Q8_0'],
      contextLengths: [4096, 8192, 32768],
      capabilities: ['chat', 'instruct', 'long-context'],
      source: { type: 'huggingface', repo: 'RWKV/rwkv-6-world-7b' },
      license: 'Apache 2.0',
      recommended: false,
    });

    // Mamba - State space model
    this.register({
      id: 'mamba',
      name: 'Mamba',
      description: 'State space model with linear scaling',
      architecture: 'mamba',
      sizes: ['0.5B', '1.5B', '3B', '7B'],
      quantizations: ['Q4_K_M', 'Q5_K_M', 'Q8_0'],
      contextLengths: [4096, 8192, 65536],
      capabilities: ['chat', 'instruct', 'long-context'],
      source: { type: 'huggingface', repo: 'state-spaces/mamba-2.8b-hf' },
      license: 'Apache 2.0',
      recommended: false,
    });

    // Add variants for recommended models
    this.addDefaultVariants();
  }

  private addDefaultVariants(): void {
    // Qwen 2.5 variants
    const qwenSizes: { size: ModelSize; fileSize: number }[] = [
      { size: '0.5B', fileSize: 400_000_000 },
      { size: '1.5B', fileSize: 1_200_000_000 },
      { size: '3B', fileSize: 2_400_000_000 },
      { size: '7B', fileSize: 5_600_000_000 },
    ];

    for (const { size, fileSize } of qwenSizes) {
      for (const quant of ['Q4_K_M', 'Q5_K_M', 'Q8_0'] as QuantizationType[]) {
        const quantMultiplier = quant === 'Q8_0' ? 1.0 : quant === 'Q5_K_M' ? 0.65 : 0.5;
        this.addVariant({
          modelId: 'qwen-2.5',
          size,
          quantization: quant,
          contextLength: 32768,
          filename: `qwen2.5-${size.toLowerCase()}-instruct-${quant.toLowerCase()}.gguf`,
          fileSize: Math.round(fileSize * quantMultiplier),
        });
      }
    }

    // Phi-3 variants
    this.addVariant({
      modelId: 'phi-3',
      size: '3B',
      quantization: 'Q4_K_M',
      contextLength: 4096,
      filename: 'phi-3-mini-4k-instruct-q4_k_m.gguf',
      fileSize: 2_200_000_000,
    });

    // SmolLM variants
    this.addVariant({
      modelId: 'smollm',
      size: '1.5B',
      quantization: 'Q4_K_M',
      contextLength: 8192,
      filename: 'smollm-1.7b-instruct-q4_k_m.gguf',
      fileSize: 1_000_000_000,
    });
  }
}

/**
 * Get singleton registry instance
 */
let registryInstance: ModelRegistry | null = null;

export function getModelRegistry(): ModelRegistry {
  if (!registryInstance) {
    registryInstance = new ModelRegistry();
  }
  return registryInstance;
}
