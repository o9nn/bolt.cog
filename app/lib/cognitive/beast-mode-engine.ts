/**
 * Beast-Mode Cognitive Engine
 * The ultimate cognitive processing system combining:
 * - Agent-Zero self-evolving architecture
 * - GGML ultra-fast inference
 * - Deep Tree Echo parallel processing
 * - 12-step cognitive loop with 3 concurrent streams
 * - AAR (Agent-Arena-Relation) self-encoding
 */

import { AgentZero } from '../agent-zero/agent';
import { MultiAgentCoordinator } from '../agent-zero/multi-agent-coordinator';
import { MemoryManager } from '../agent-zero/memory-manager';
import { ToolFactory } from '../agent-zero/tool-factory';
import { InferenceCoordinator } from '../inference/inference-coordinator';
import { GGMLEngine, type InferenceRequest, type InferenceResponse } from '../inference/ggml-engine';
import type { AgentZeroConfig, Memory, AgentTask, TaskResult } from '../agent-zero/types';

// ============================================
// BEAST-MODE CONFIGURATION
// ============================================

export interface BeastModeConfig {
  // Core settings
  name: string;
  mode: 'standard' | 'turbo' | 'beast' | 'ultra-beast';
  
  // Inference settings
  inferenceEngines: number;
  modelPath: string;
  quantization: 'Q4_K_M' | 'Q5_K_M' | 'Q6_K' | 'Q8_0' | 'IQ2_XXS' | 'IQ1_S';
  contextSize: number;
  
  // Cognitive loop settings
  cognitiveStreams: number;
  loopSteps: number;
  streamPhaseOffset: number;
  
  // Agent settings
  maxAgents: number;
  agentHierarchyDepth: number;
  
  // Memory settings
  memoryEnabled: boolean;
  maxMemories: number;
  
  // Performance settings
  parallelInference: boolean;
  cacheEnabled: boolean;
  batchSize: number;
}

const DEFAULT_CONFIG: BeastModeConfig = {
  name: 'BeastMode',
  mode: 'beast',
  inferenceEngines: 3,
  modelPath: '',
  quantization: 'Q4_K_M',
  contextSize: 8192,
  cognitiveStreams: 3,
  loopSteps: 12,
  streamPhaseOffset: 4,
  maxAgents: 10,
  agentHierarchyDepth: 3,
  memoryEnabled: true,
  maxMemories: 10000,
  parallelInference: true,
  cacheEnabled: true,
  batchSize: 512,
};

// ============================================
// COGNITIVE STREAM (Deep Tree Echo)
// ============================================

interface CognitiveStream {
  id: number;
  phase: number;
  mode: 'expressive' | 'reflective';
  state: StreamState;
  currentStep: number;
  buffer: CognitiveBuffer;
}

interface StreamState {
  perception: PerceptionState;
  action: ActionState;
  simulation: SimulationState;
}

interface PerceptionState {
  salience: Map<string, number>;
  affordances: string[];
  relevance: number;
}

interface ActionState {
  pending: string[];
  executing: string | null;
  completed: string[];
}

interface SimulationState {
  hypotheses: Hypothesis[];
  predictions: Prediction[];
  confidence: number;
}

interface Hypothesis {
  id: string;
  content: string;
  probability: number;
  evidence: string[];
}

interface Prediction {
  id: string;
  outcome: string;
  confidence: number;
  timeHorizon: number;
}

interface CognitiveBuffer {
  inputs: unknown[];
  outputs: unknown[];
  intermediates: Map<string, unknown>;
}

// ============================================
// AAR CORE (Agent-Arena-Relation)
// ============================================

interface AARCore {
  agent: AgentState;
  arena: ArenaState;
  relation: RelationState;
}

interface AgentState {
  urgeToAct: number;
  intentionVector: number[];
  capabilities: string[];
  currentGoal: string | null;
}

interface ArenaState {
  manifold: number[][];
  constraints: string[];
  opportunities: string[];
  threats: string[];
}

interface RelationState {
  self: SelfModel;
  feedback: FeedbackLoop[];
  attention: AttentionState;
}

interface SelfModel {
  identity: string;
  beliefs: Map<string, number>;
  values: Map<string, number>;
  metacognition: MetacognitionState;
}

interface MetacognitionState {
  confidence: number;
  uncertainty: number;
  learningRate: number;
  adaptability: number;
}

interface FeedbackLoop {
  source: string;
  target: string;
  strength: number;
  delay: number;
}

interface AttentionState {
  focus: string[];
  breadth: number;
  depth: number;
  switching: number;
}

// ============================================
// BEAST-MODE ENGINE
// ============================================

export class BeastModeEngine {
  private config: BeastModeConfig;
  private inferenceCoordinator: InferenceCoordinator;
  private agentCoordinator: MultiAgentCoordinator;
  private memoryManager: MemoryManager;
  private toolFactory: ToolFactory;
  private streams: CognitiveStream[];
  private aarCore: AARCore;
  private isRunning: boolean = false;
  private currentStep: number = 0;
  private metrics: BeastModeMetrics;

  constructor(config: Partial<BeastModeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.inferenceCoordinator = new InferenceCoordinator({
      maxEngines: this.config.inferenceEngines,
      defaultQuantization: this.config.quantization,
      enableCaching: this.config.cacheEnabled,
    });
    this.agentCoordinator = new MultiAgentCoordinator();
    this.memoryManager = new MemoryManager({
      enabled: this.config.memoryEnabled,
      vectorStore: 'memory',
      maxMemories: this.config.maxMemories,
      embeddingModel: 'local',
    });
    this.toolFactory = new ToolFactory();
    this.streams = [];
    this.aarCore = this.initializeAARCore();
    this.metrics = this.initializeMetrics();
  }

  /**
   * Initialize the Beast-Mode Engine
   */
  async initialize(modelPath?: string): Promise<void> {
    const path = modelPath || this.config.modelPath;
    
    if (path) {
      // Initialize inference engines
      await this.inferenceCoordinator.initialize(path, this.config.inferenceEngines);
    }

    // Initialize cognitive streams
    this.initializeCognitiveStreams();

    // Create root agent
    this.createRootAgent();

    // Register beast-mode tools
    this.registerBeastModeTools();

    this.isRunning = true;
    console.log(`🦁 Beast-Mode Engine initialized: ${this.config.mode}`);
  }

  /**
   * Process input through the cognitive engine
   */
  async process(input: string): Promise<BeastModeResponse> {
    const startTime = Date.now();
    this.metrics.totalProcessed++;

    try {
      // 1. Perceive - Update all streams with input
      await this.perceive(input);

      // 2. Run cognitive loop
      const loopResult = await this.runCognitiveLoop();

      // 3. Generate response using parallel inference
      const response = await this.generateResponse(input, loopResult);

      // 4. Learn from interaction
      await this.learn(input, response);

      // 5. Update metrics
      const duration = Date.now() - startTime;
      this.updateMetrics(duration, true);

      return {
        text: response,
        streams: this.getStreamStates(),
        aar: this.getAARState(),
        metrics: this.getMetrics(),
        duration,
      };
    } catch (error) {
      this.updateMetrics(Date.now() - startTime, false);
      throw error;
    }
  }

  /**
   * Stream processing with real-time output
   */
  async *processStreamOutput(input: string): AsyncGenerator<string, BeastModeResponse, unknown> {
    const startTime = Date.now();

    // Perceive
    await this.perceive(input);

    // Run cognitive loop
    const loopResult = await this.runCognitiveLoop();

    // Stream inference
    const request: InferenceRequest = {
      prompt: this.buildPrompt(input, loopResult),
      maxTokens: 2048,
      temperature: 0.7,
      stream: true,
    };

    let fullResponse = '';
    for await (const token of this.inferenceCoordinator.stream(request)) {
      fullResponse += token;
      yield token;
    }

    // Learn
    await this.learn(input, fullResponse);

    const duration = Date.now() - startTime;
    this.updateMetrics(duration, true);

    return {
      text: fullResponse,
      streams: this.getStreamStates(),
      aar: this.getAARState(),
      metrics: this.getMetrics(),
      duration,
    };
  }

  /**
   * Execute a task through the agent system
   */
  async executeTask(description: string, priority: number = 5): Promise<TaskResult> {
    const task: AgentTask = {
      id: this.generateId(),
      description,
      assignedTo: '',
      assignedBy: 'user',
      status: 'pending',
      priority,
      subtasks: [],
      dependencies: [],
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    return this.agentCoordinator.submitTask(task);
  }

  /**
   * Get current engine status
   */
  getStatus(): BeastModeStatus {
    return {
      isRunning: this.isRunning,
      mode: this.config.mode,
      currentStep: this.currentStep,
      streams: this.streams.map((s) => ({
        id: s.id,
        phase: s.phase,
        mode: s.mode,
        step: s.currentStep,
      })),
      inference: this.inferenceCoordinator.getStatus(),
      agents: this.agentCoordinator.getMetrics(),
      memory: this.memoryManager.getStats(),
      metrics: this.metrics,
    };
  }

  /**
   * Get metrics
   */
  getMetrics(): BeastModeMetrics {
    return { ...this.metrics };
  }

  /**
   * Shutdown the engine
   */
  async shutdown(): Promise<void> {
    this.isRunning = false;
    await this.inferenceCoordinator.shutdown();
    await this.agentCoordinator.shutdown();
    console.log('🦁 Beast-Mode Engine shutdown complete');
  }

  // ============================================
  // COGNITIVE LOOP IMPLEMENTATION
  // ============================================

  private async runCognitiveLoop(): Promise<CognitiveLoopResult> {
    const results: StepResult[] = [];

    // Run 12-step cognitive loop
    for (let step = 0; step < this.config.loopSteps; step++) {
      this.currentStep = step;

      // Determine step type (7 expressive, 5 reflective)
      const isExpressive = this.isExpressiveStep(step);

      // Process each stream at its current phase
      const streamResults = await Promise.all(
        this.streams.map((stream) => this.processCognitiveStream(stream, step, isExpressive))
      );

      // Synchronize streams
      await this.synchronizeStreams(streamResults);

      // Update AAR core
      this.updateAARCore(streamResults);

      results.push({
        step,
        isExpressive,
        streamResults,
        aarState: this.getAARState(),
      });

      // Advance stream phases
      this.advanceStreamPhases();
    }

    return {
      steps: results,
      finalState: this.getStreamStates(),
      aarCore: this.aarCore,
    };
  }

  private async processCognitiveStream(
    stream: CognitiveStream,
    step: number,
    isExpressive: boolean,
  ): Promise<StreamResult> {
    stream.currentStep = step;
    stream.mode = isExpressive ? 'expressive' : 'reflective';

    if (isExpressive) {
      // Expressive mode: Action and interaction
      return this.processExpressive(stream);
    } else {
      // Reflective mode: Simulation and planning
      return this.processReflective(stream);
    }
  }

  private async processExpressive(stream: CognitiveStream): Promise<StreamResult> {
    // Process affordances
    const affordances = stream.state.perception.affordances;
    
    // Select action based on salience
    const selectedAction = this.selectAction(stream);
    
    if (selectedAction) {
      stream.state.action.executing = selectedAction;
      
      // Execute through inference
      const result = await this.inferenceCoordinator.submit({
        prompt: `Execute action: ${selectedAction}`,
        maxTokens: 256,
        temperature: 0.5,
      });

      stream.state.action.completed.push(selectedAction);
      stream.state.action.executing = null;

      return {
        streamId: stream.id,
        mode: 'expressive',
        action: selectedAction,
        result: result.text,
        confidence: stream.state.perception.relevance,
      };
    }

    return {
      streamId: stream.id,
      mode: 'expressive',
      action: null,
      result: '',
      confidence: 0,
    };
  }

  private async processReflective(stream: CognitiveStream): Promise<StreamResult> {
    // Generate hypotheses
    const hypothesis = await this.generateHypothesis(stream);
    
    // Make predictions
    const prediction = await this.makePrediction(stream, hypothesis);

    stream.state.simulation.hypotheses.push(hypothesis);
    stream.state.simulation.predictions.push(prediction);

    return {
      streamId: stream.id,
      mode: 'reflective',
      action: null,
      result: hypothesis.content,
      confidence: hypothesis.probability,
      hypothesis,
      prediction,
    };
  }

  private async synchronizeStreams(results: StreamResult[]): Promise<void> {
    // Cross-stream information sharing
    for (let i = 0; i < this.streams.length; i++) {
      const stream = this.streams[i];
      const otherResults = results.filter((r) => r.streamId !== stream.id);

      // Update salience based on other streams
      for (const result of otherResults) {
        if (result.action) {
          stream.state.perception.salience.set(
            result.action,
            (stream.state.perception.salience.get(result.action) || 0) + 0.1
          );
        }
      }
    }
  }

  private updateAARCore(results: StreamResult[]): void {
    // Update agent state
    const avgConfidence = results.reduce((acc, r) => acc + r.confidence, 0) / results.length;
    this.aarCore.agent.urgeToAct = avgConfidence;

    // Update relation state
    this.aarCore.relation.self.metacognition.confidence = avgConfidence;
    this.aarCore.relation.self.metacognition.uncertainty = 1 - avgConfidence;

    // Update attention
    const actions = results.filter((r) => r.action).map((r) => r.action!);
    this.aarCore.relation.attention.focus = actions;
  }

  private advanceStreamPhases(): void {
    for (const stream of this.streams) {
      stream.phase = (stream.phase + 1) % this.config.loopSteps;
    }
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  private initializeCognitiveStreams(): void {
    this.streams = [];
    
    for (let i = 0; i < this.config.cognitiveStreams; i++) {
      const stream: CognitiveStream = {
        id: i,
        phase: i * this.config.streamPhaseOffset, // 120 degrees apart
        mode: 'expressive',
        currentStep: 0,
        state: {
          perception: {
            salience: new Map(),
            affordances: [],
            relevance: 0,
          },
          action: {
            pending: [],
            executing: null,
            completed: [],
          },
          simulation: {
            hypotheses: [],
            predictions: [],
            confidence: 0,
          },
        },
        buffer: {
          inputs: [],
          outputs: [],
          intermediates: new Map(),
        },
      };

      this.streams.push(stream);
    }
  }

  private initializeAARCore(): AARCore {
    return {
      agent: {
        urgeToAct: 0.5,
        intentionVector: new Array(128).fill(0),
        capabilities: ['reasoning', 'planning', 'execution', 'learning'],
        currentGoal: null,
      },
      arena: {
        manifold: [],
        constraints: [],
        opportunities: [],
        threats: [],
      },
      relation: {
        self: {
          identity: 'BeastMode',
          beliefs: new Map(),
          values: new Map([
            ['accuracy', 0.9],
            ['efficiency', 0.8],
            ['helpfulness', 0.95],
          ]),
          metacognition: {
            confidence: 0.7,
            uncertainty: 0.3,
            learningRate: 0.1,
            adaptability: 0.8,
          },
        },
        feedback: [],
        attention: {
          focus: [],
          breadth: 0.5,
          depth: 0.7,
          switching: 0.3,
        },
      },
    };
  }

  private initializeMetrics(): BeastModeMetrics {
    return {
      totalProcessed: 0,
      successfulProcessed: 0,
      failedProcessed: 0,
      averageLatency: 0,
      tokensPerSecond: 0,
      cognitiveLoopIterations: 0,
      memoryOperations: 0,
      agentTasksCompleted: 0,
    };
  }

  private createRootAgent(): void {
    const rootConfig: AgentZeroConfig = {
      id: 'root_agent',
      name: 'BeastMode Root Agent',
      role: 'superior',
      capabilities: [
        { name: 'reasoning', description: 'Logical reasoning', enabled: true, confidence: 0.9 },
        { name: 'planning', description: 'Task planning', enabled: true, confidence: 0.85 },
        { name: 'execution', description: 'Task execution', enabled: true, confidence: 0.9 },
        { name: 'learning', description: 'Continuous learning', enabled: true, confidence: 0.8 },
      ],
      memory: {
        enabled: true,
        vectorStore: 'memory',
        maxMemories: 1000,
        embeddingModel: 'local',
      },
      tools: [],
      instruments: [],
      systemPrompt: 'You are the root agent of the Beast-Mode cognitive engine.',
    };

    this.agentCoordinator.createAgent(rootConfig);
  }

  private registerBeastModeTools(): void {
    // Parallel inference tool
    this.toolFactory.createFromCode(
      'parallel_inference',
      'Run inference across multiple engines in parallel',
      `
async function execute(params, context) {
  const { prompts } = params;
  const results = await Promise.all(
    prompts.map(p => context.infer({ prompt: p, maxTokens: 256 }))
  );
  return JSON.stringify(results.map(r => r.text));
}
      `,
      [{ name: 'prompts', type: 'array', description: 'Array of prompts', required: true }],
    );

    // Memory search tool
    this.toolFactory.createFromCode(
      'memory_search',
      'Search through cognitive memory',
      `
async function execute(params, context) {
  const { query, limit } = params;
  const memories = await context.memoryManager.retrieve(query, limit || 5);
  return JSON.stringify(memories.map(m => m.content));
}
      `,
      [
        { name: 'query', type: 'string', description: 'Search query', required: true },
        { name: 'limit', type: 'number', description: 'Max results', required: false },
      ],
    );

    // Stream synchronization tool
    this.toolFactory.createFromCode(
      'sync_streams',
      'Synchronize cognitive streams',
      `
async function execute(params, context) {
  const states = context.streams.map(s => ({
    id: s.id,
    phase: s.phase,
    mode: s.mode,
  }));
  return JSON.stringify(states);
}
      `,
      [],
    );
  }

  private async perceive(input: string): Promise<void> {
    // Update all streams with new input
    for (const stream of this.streams) {
      stream.buffer.inputs.push(input);
      
      // Extract affordances
      const affordances = this.extractAffordances(input);
      stream.state.perception.affordances = affordances;

      // Calculate salience
      for (const affordance of affordances) {
        const currentSalience = stream.state.perception.salience.get(affordance) || 0;
        stream.state.perception.salience.set(affordance, currentSalience + 0.2);
      }

      // Update relevance
      stream.state.perception.relevance = this.calculateRelevance(input, stream);
    }

    // Update AAR arena
    this.aarCore.arena.opportunities = this.extractAffordances(input);
  }

  private extractAffordances(input: string): string[] {
    // Extract actionable items from input
    const affordances: string[] = [];
    const keywords = ['create', 'find', 'analyze', 'explain', 'help', 'write', 'code', 'search'];
    
    const inputLower = input.toLowerCase();
    for (const keyword of keywords) {
      if (inputLower.includes(keyword)) {
        affordances.push(keyword);
      }
    }

    return affordances;
  }

  private calculateRelevance(input: string, stream: CognitiveStream): number {
    // Calculate relevance based on salience and context
    let relevance = 0;
    
    for (const [, salience] of stream.state.perception.salience) {
      relevance += salience;
    }

    return Math.min(relevance / 5, 1); // Normalize to 0-1
  }

  private selectAction(stream: CognitiveStream): string | null {
    // Select highest salience action
    let maxSalience = 0;
    let selectedAction: string | null = null;

    for (const [action, salience] of stream.state.perception.salience) {
      if (salience > maxSalience && !stream.state.action.completed.includes(action)) {
        maxSalience = salience;
        selectedAction = action;
      }
    }

    return selectedAction;
  }

  private async generateHypothesis(stream: CognitiveStream): Promise<Hypothesis> {
    const context = Array.from(stream.state.perception.salience.keys()).join(', ');
    
    return {
      id: this.generateId(),
      content: `Hypothesis based on: ${context}`,
      probability: stream.state.perception.relevance,
      evidence: stream.state.action.completed,
    };
  }

  private async makePrediction(stream: CognitiveStream, hypothesis: Hypothesis): Promise<Prediction> {
    return {
      id: this.generateId(),
      outcome: `Predicted outcome for: ${hypothesis.content}`,
      confidence: hypothesis.probability * 0.8,
      timeHorizon: 1000,
    };
  }

  private isExpressiveStep(step: number): boolean {
    // 7 expressive steps, 5 reflective steps in 12-step loop
    // Expressive: 0, 1, 2, 4, 5, 8, 9
    // Reflective: 3, 6, 7, 10, 11
    const reflectiveSteps = [3, 6, 7, 10, 11];
    return !reflectiveSteps.includes(step);
  }

  private async generateResponse(input: string, loopResult: CognitiveLoopResult): Promise<string> {
    const prompt = this.buildPrompt(input, loopResult);

    if (this.config.parallelInference) {
      // Use parallel inference for faster response
      const response = await this.inferenceCoordinator.submit({
        prompt,
        maxTokens: 2048,
        temperature: 0.7,
      });
      return response.text;
    } else {
      // Single engine inference
      const engines = Array.from(this.inferenceCoordinator['engines'].values());
      if (engines.length > 0) {
        const response = await engines[0].infer({
          prompt,
          maxTokens: 2048,
          temperature: 0.7,
        });
        return response.text;
      }
      return 'No inference engine available';
    }
  }

  private buildPrompt(input: string, loopResult: CognitiveLoopResult): string {
    const context = loopResult.steps
      .filter((s) => s.streamResults.some((r) => r.result))
      .map((s) => s.streamResults.map((r) => r.result).join('\n'))
      .join('\n');

    return `
Context from cognitive processing:
${context}

User input: ${input}

Response:`;
  }

  private async learn(input: string, response: string): Promise<void> {
    // Store interaction in memory
    await this.memoryManager.store({
      type: 'experience',
      content: JSON.stringify({ input, response }),
      metadata: {
        source: 'interaction',
        context: [input],
        tags: ['conversation'],
        relatedMemories: [],
        confidence: 0.8,
      },
      relevanceScore: 0.7,
    });

    this.metrics.memoryOperations++;
  }

  private updateMetrics(duration: number, success: boolean): void {
    if (success) {
      this.metrics.successfulProcessed++;
    } else {
      this.metrics.failedProcessed++;
    }

    const total = this.metrics.successfulProcessed + this.metrics.failedProcessed;
    this.metrics.averageLatency = 
      (this.metrics.averageLatency * (total - 1) + duration) / total;

    this.metrics.cognitiveLoopIterations += this.config.loopSteps;
  }

  private getStreamStates(): StreamStateSnapshot[] {
    return this.streams.map((s) => ({
      id: s.id,
      phase: s.phase,
      mode: s.mode,
      step: s.currentStep,
      salience: Object.fromEntries(s.state.perception.salience),
      affordances: s.state.perception.affordances,
      relevance: s.state.perception.relevance,
    }));
  }

  private getAARState(): AARStateSnapshot {
    return {
      urgeToAct: this.aarCore.agent.urgeToAct,
      currentGoal: this.aarCore.agent.currentGoal,
      confidence: this.aarCore.relation.self.metacognition.confidence,
      uncertainty: this.aarCore.relation.self.metacognition.uncertainty,
      focus: this.aarCore.relation.attention.focus,
    };
  }

  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ============================================
// TYPES
// ============================================

interface BeastModeResponse {
  text: string;
  streams: StreamStateSnapshot[];
  aar: AARStateSnapshot;
  metrics: BeastModeMetrics;
  duration: number;
}

interface BeastModeStatus {
  isRunning: boolean;
  mode: BeastModeConfig['mode'];
  currentStep: number;
  streams: { id: number; phase: number; mode: string; step: number }[];
  inference: unknown;
  agents: unknown;
  memory: unknown;
  metrics: BeastModeMetrics;
}

interface BeastModeMetrics {
  totalProcessed: number;
  successfulProcessed: number;
  failedProcessed: number;
  averageLatency: number;
  tokensPerSecond: number;
  cognitiveLoopIterations: number;
  memoryOperations: number;
  agentTasksCompleted: number;
}

interface CognitiveLoopResult {
  steps: StepResult[];
  finalState: StreamStateSnapshot[];
  aarCore: AARCore;
}

interface StepResult {
  step: number;
  isExpressive: boolean;
  streamResults: StreamResult[];
  aarState: AARStateSnapshot;
}

interface StreamResult {
  streamId: number;
  mode: 'expressive' | 'reflective';
  action: string | null;
  result: string;
  confidence: number;
  hypothesis?: Hypothesis;
  prediction?: Prediction;
}

interface StreamStateSnapshot {
  id: number;
  phase: number;
  mode: string;
  step: number;
  salience: Record<string, number>;
  affordances: string[];
  relevance: number;
}

interface AARStateSnapshot {
  urgeToAct: number;
  currentGoal: string | null;
  confidence: number;
  uncertainty: number;
  focus: string[];
}

// Export singleton factory
let beastModeInstance: BeastModeEngine | null = null;

export function getBeastModeEngine(config?: Partial<BeastModeConfig>): BeastModeEngine {
  if (!beastModeInstance) {
    beastModeInstance = new BeastModeEngine(config);
  }
  return beastModeInstance;
}

export async function initializeBeastMode(
  modelPath: string,
  config?: Partial<BeastModeConfig>,
): Promise<BeastModeEngine> {
  const engine = getBeastModeEngine(config);
  await engine.initialize(modelPath);
  return engine;
}
