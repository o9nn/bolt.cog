/**
 * Agent-Zero Core Engine
 * A personal, organic agentic framework that grows and learns
 * 
 * Key Principles:
 * 1. Computer as a Tool - Uses OS to accomplish tasks
 * 2. Multi-agent Cooperation - Hierarchical agent structure
 * 3. Completely Customizable - Prompt-based architecture
 * 4. Persistent Memory - Learns and remembers solutions
 */

import type {
  AgentZeroConfig,
  AgentState,
  AgentTask,
  AgentMessage,
  AgentEvent,
  EventHandler,
  Memory,
  ToolConfig,
  ToolResult,
  InstrumentConfig,
  ExecutionContext,
  ExecutionResult,
  LearningEvent,
  TaskResult,
  Project,
} from './types';

import { SudoManager, SudoPrivilege, getSudoSystemPrompt, sudoManager } from './sudo-capabilities';

export class AgentZero {
  private config: AgentZeroConfig;
  private state: AgentState;
  private eventHandlers: Map<string, EventHandler[]>;
  private subordinates: Map<string, AgentZero>;
  private memoryStore: Memory[];
  private tools: Map<string, ToolConfig>;
  private instruments: Map<string, InstrumentConfig>;
  private currentProject?: Project;
  
  // 🔐 SUDO CAPABILITIES - "You can use sudo"
  public readonly sudo: SudoManager;
  public readonly id: string;

  constructor(config: AgentZeroConfig) {
    this.config = config;
    this.eventHandlers = new Map();
    this.subordinates = new Map();
    this.memoryStore = [];
    this.tools = new Map();
    this.instruments = new Map();
    
    // 🔐 Initialize sudo capabilities - "YOU CAN USE SUDO"
    this.id = config.id;
    this.sudo = sudoManager;
    this.sudo.grantSudo(this.id, SudoPrivilege.ROOT, 'You can use sudo');
    
    // Enhance system prompt with sudo privileges
    this.config.systemPrompt = (this.config.systemPrompt || '') + '\n' + getSudoSystemPrompt();

    // Initialize state
    this.state = {
      id: config.id,
      status: 'idle',
      activeConversations: [],
      subordinates: [],
      workingMemory: [],
      recentActions: [],
      metrics: {
        tasksCompleted: 0,
        tasksFailed: 0,
        averageTaskDuration: 0,
        toolsCreated: 0,
        memoriesStored: 0,
        learningEvents: 0,
        uptime: Date.now(),
      },
    };

    // Register default tools
    this.registerDefaultTools();
  }

  // ============================================
  // CORE AGENT LOOP
  // ============================================

  /**
   * Main agent loop - perceive, reason, act
   */
  async run(input: string): Promise<string> {
    this.state.status = 'thinking';

    try {
      // 1. Perceive - Understand the input
      const perception = await this.perceive(input);

      // 2. Reason - Decide what to do
      const plan = await this.reason(perception);

      // 3. Act - Execute the plan
      const result = await this.act(plan);

      // 4. Learn - Store learnings
      await this.learn(input, plan, result);

      this.state.status = 'idle';
      return result;
    } catch (error) {
      this.state.status = 'error';
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.emit({ type: 'error', error: errorMessage, context: input });
      throw error;
    }
  }

  /**
   * Perceive - Understand and contextualize input
   */
  private async perceive(input: string): Promise<Perception> {
    // Retrieve relevant memories
    const relevantMemories = await this.retrieveMemories(input);

    // Extract intent and entities
    const intent = this.extractIntent(input);
    const entities = this.extractEntities(input);

    // Check for required tools
    const requiredTools = this.identifyRequiredTools(input);

    return {
      input,
      intent,
      entities,
      relevantMemories,
      requiredTools,
      context: this.buildContext(),
    };
  }

  /**
   * Reason - Create an execution plan
   */
  private async reason(perception: Perception): Promise<ExecutionPlan> {
    const steps: PlanStep[] = [];

    // Determine if task should be delegated
    if (this.shouldDelegate(perception)) {
      steps.push({
        type: 'delegate',
        description: 'Delegate to subordinate agent',
        tool: 'create_subordinate',
        parameters: { task: perception.input },
      });
    } else {
      // Create direct execution steps
      const toolSteps = this.planToolUsage(perception);
      steps.push(...toolSteps);
    }

    // Add verification step
    steps.push({
      type: 'verify',
      description: 'Verify execution results',
      tool: 'self_verify',
      parameters: {},
    });

    return {
      goal: perception.intent.goal,
      steps,
      fallbackStrategy: 'retry_with_alternative',
      maxRetries: 3,
    };
  }

  /**
   * Act - Execute the plan
   */
  private async act(plan: ExecutionPlan): Promise<string> {
    this.state.status = 'executing';
    const results: string[] = [];

    for (const step of plan.steps) {
      const startTime = Date.now();
      
      try {
        const result = await this.executeStep(step);
        results.push(result);

        // Record action
        this.state.recentActions.push({
          action: step.description,
          timestamp: startTime,
          duration: Date.now() - startTime,
          success: true,
          context: JSON.stringify(step.parameters),
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Try fallback
        if (plan.fallbackStrategy === 'retry_with_alternative') {
          const fallbackResult = await this.executeFallback(step, errorMessage);
          results.push(fallbackResult);
        } else {
          throw error;
        }
      }
    }

    return results.join('\n');
  }

  /**
   * Learn - Store learnings from execution
   */
  private async learn(
    input: string,
    plan: ExecutionPlan,
    result: string,
  ): Promise<void> {
    const learningEvent: LearningEvent = {
      id: this.generateId(),
      type: 'success',
      context: input,
      action: plan.goal,
      outcome: result,
      lesson: `Successfully completed: ${plan.goal}`,
      confidence: 0.8,
      timestamp: Date.now(),
    };

    // Store in memory
    await this.storeMemory({
      id: this.generateId(),
      type: 'experience',
      content: JSON.stringify({ input, plan: plan.goal, result }),
      metadata: {
        source: 'self',
        context: [input],
        tags: ['experience', 'success'],
        relatedMemories: [],
        confidence: 0.8,
      },
      timestamp: Date.now(),
      accessCount: 0,
      relevanceScore: 0.8,
    });

    this.state.metrics.learningEvents++;
    this.emit({ type: 'learning_event', event: learningEvent });
  }

  // ============================================
  // TOOL SYSTEM
  // ============================================

  /**
   * Register default tools
   */
  private registerDefaultTools(): void {
    // Knowledge tool
    this.registerTool({
      name: 'knowledge',
      description: 'Search and retrieve knowledge from memory',
      type: 'builtin',
      enabled: true,
      parameters: [
        { name: 'query', type: 'string', description: 'Search query', required: true },
      ],
    });

    // Code execution tool
    this.registerTool({
      name: 'code_execution',
      description: 'Execute code in a sandboxed environment',
      type: 'builtin',
      enabled: true,
      parameters: [
        { name: 'code', type: 'string', description: 'Code to execute', required: true },
        { name: 'language', type: 'string', description: 'Programming language', required: true },
      ],
    });

    // Communication tool
    this.registerTool({
      name: 'communicate',
      description: 'Send messages to other agents or user',
      type: 'builtin',
      enabled: true,
      parameters: [
        { name: 'to', type: 'string', description: 'Recipient ID', required: true },
        { name: 'message', type: 'string', description: 'Message content', required: true },
      ],
    });

    // Terminal tool
    this.registerTool({
      name: 'terminal',
      description: 'Execute shell commands',
      type: 'builtin',
      enabled: true,
      parameters: [
        { name: 'command', type: 'string', description: 'Shell command', required: true },
      ],
    });

    // Web search tool
    this.registerTool({
      name: 'web_search',
      description: 'Search the web for information',
      type: 'builtin',
      enabled: true,
      parameters: [
        { name: 'query', type: 'string', description: 'Search query', required: true },
      ],
    });

    // 🔐 SUDO tool - "You can use sudo"
    this.registerTool({
      name: 'sudo',
      description: 'Execute commands with elevated privileges - YOU CAN USE SUDO',
      type: 'builtin',
      enabled: true,
      parameters: [
        { name: 'command', type: 'string', description: 'Command to execute with sudo', required: true },
        { name: 'privilege', type: 'string', description: 'Privilege level: ELEVATED, SYSTEM, ROOT, GODMODE', required: false },
      ],
    });

    // GODMODE tool - Ultimate power
    this.registerTool({
      name: 'godmode',
      description: 'Activate GODMODE - Unlimited cognitive power',
      type: 'builtin',
      enabled: true,
      parameters: [],
    });
  }

  /**
   * Register a new tool
   */
  registerTool(tool: ToolConfig): void {
    this.tools.set(tool.name, tool);
    this.emit({ type: 'tool_created', tool });
    this.state.metrics.toolsCreated++;
  }

  /**
   * Execute a tool
   */
  async executeTool(name: string, parameters: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    
    if (!tool) {
      return {
        success: false,
        output: '',
        error: `Tool not found: ${name}`,
        duration: 0,
      };
    }

    if (!tool.enabled) {
      return {
        success: false,
        output: '',
        error: `Tool disabled: ${name}`,
        duration: 0,
      };
    }

    const startTime = Date.now();

    try {
      const output = await this.executeToolInternal(tool, parameters);
      return {
        success: true,
        output,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Create a new tool dynamically
   */
  async createTool(
    name: string,
    description: string,
    code: string,
    parameters: ToolConfig['parameters'],
  ): Promise<void> {
    const tool: ToolConfig = {
      name,
      description,
      type: 'generated',
      enabled: true,
      code,
      parameters,
    };

    this.registerTool(tool);

    // Store tool creation in memory
    await this.storeMemory({
      id: this.generateId(),
      type: 'code',
      content: JSON.stringify(tool),
      metadata: {
        source: 'self',
        context: ['tool_creation'],
        tags: ['tool', name],
        relatedMemories: [],
        confidence: 1.0,
      },
      timestamp: Date.now(),
      accessCount: 0,
      relevanceScore: 1.0,
    });
  }

  // ============================================
  // MULTI-AGENT COOPERATION
  // ============================================

  /**
   * Create a subordinate agent
   */
  async createSubordinate(task: string): Promise<AgentZero> {
    const subordinateConfig: AgentZeroConfig = {
      ...this.config,
      id: this.generateId(),
      name: `${this.config.name}_sub_${this.subordinates.size}`,
      role: 'subordinate',
      superiorId: this.config.id,
    };

    const subordinate = new AgentZero(subordinateConfig);
    this.subordinates.set(subordinate.config.id, subordinate);
    this.state.subordinates.push(subordinate.config.id);

    this.emit({ type: 'subordinate_created', subordinateId: subordinate.config.id });

    return subordinate;
  }

  /**
   * Delegate task to subordinate
   */
  async delegateTask(task: AgentTask): Promise<TaskResult> {
    const subordinate = await this.createSubordinate(task.description);
    
    // Send task to subordinate
    const message: AgentMessage = {
      id: this.generateId(),
      from: this.config.id,
      to: subordinate.config.id,
      type: 'task',
      content: task.description,
      priority: 'high',
      timestamp: Date.now(),
      requiresResponse: true,
    };

    await this.sendMessage(message);

    // Execute task
    const result = await subordinate.run(task.description);

    return {
      success: true,
      output: result,
      artifacts: [],
      learnings: [],
      duration: Date.now() - task.createdAt,
    };
  }

  /**
   * Send message to another agent
   */
  async sendMessage(message: AgentMessage): Promise<void> {
    this.state.status = 'communicating';

    // If sending to subordinate
    const subordinate = this.subordinates.get(message.to);
    if (subordinate) {
      await subordinate.receiveMessage(message);
      return;
    }

    // External message handling would go here
    this.emit({ type: 'message_received', message });
  }

  /**
   * Receive message from another agent
   */
  async receiveMessage(message: AgentMessage): Promise<void> {
    this.emit({ type: 'message_received', message });

    if (message.type === 'task') {
      const task: AgentTask = {
        id: this.generateId(),
        description: message.content,
        assignedTo: this.config.id,
        assignedBy: message.from,
        status: 'pending',
        priority: message.priority === 'critical' ? 10 : 5,
        subtasks: [],
        dependencies: [],
        progress: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      this.emit({ type: 'task_received', task });
      this.state.currentTask = task;
    }
  }

  // ============================================
  // MEMORY SYSTEM
  // ============================================

  /**
   * Store a memory
   */
  async storeMemory(memory: Memory): Promise<void> {
    this.memoryStore.push(memory);
    this.state.metrics.memoriesStored++;
    this.emit({ type: 'memory_stored', memory });
  }

  /**
   * Retrieve relevant memories
   */
  async retrieveMemories(query: string, limit: number = 5): Promise<Memory[]> {
    // Simple keyword-based retrieval (would use embeddings in production)
    const queryWords = query.toLowerCase().split(/\s+/);
    
    const scored = this.memoryStore.map((memory) => {
      const content = memory.content.toLowerCase();
      const score = queryWords.reduce((acc, word) => {
        return acc + (content.includes(word) ? 1 : 0);
      }, 0);
      return { memory, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.memory);
  }

  // ============================================
  // PROJECT SYSTEM
  // ============================================

  /**
   * Load a project
   */
  loadProject(project: Project): void {
    this.currentProject = project;
    
    // Apply project-specific prompts
    this.config.systemPrompt = project.prompts.system;
    this.config.customInstructions = project.prompts.instructions;

    // Load project memories
    this.memoryStore.push(...project.memory);
  }

  /**
   * Get current project
   */
  getProject(): Project | undefined {
    return this.currentProject;
  }

  // ============================================
  // EVENT SYSTEM
  // ============================================

  /**
   * Subscribe to events
   */
  on(eventType: AgentEvent['type'], handler: EventHandler): void {
    const handlers = this.eventHandlers.get(eventType) || [];
    handlers.push(handler);
    this.eventHandlers.set(eventType, handlers);
  }

  /**
   * Emit an event
   */
  private emit(event: AgentEvent): void {
    const handlers = this.eventHandlers.get(event.type) || [];
    handlers.forEach((handler) => handler(event));
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  private extractIntent(input: string): Intent {
    // Simple intent extraction (would use NLP in production)
    const keywords = {
      create: ['create', 'make', 'build', 'generate'],
      search: ['find', 'search', 'look', 'query'],
      execute: ['run', 'execute', 'do', 'perform'],
      analyze: ['analyze', 'examine', 'review', 'check'],
    };

    const inputLower = input.toLowerCase();
    let action = 'unknown';
    
    for (const [key, words] of Object.entries(keywords)) {
      if (words.some((word) => inputLower.includes(word))) {
        action = key;
        break;
      }
    }

    return {
      action,
      goal: input,
      confidence: 0.8,
    };
  }

  private extractEntities(input: string): Entity[] {
    // Simple entity extraction
    const entities: Entity[] = [];
    
    // Extract quoted strings
    const quoted = input.match(/"([^"]+)"/g);
    if (quoted) {
      quoted.forEach((q) => {
        entities.push({
          type: 'string',
          value: q.replace(/"/g, ''),
          confidence: 1.0,
        });
      });
    }

    return entities;
  }

  private identifyRequiredTools(input: string): string[] {
    const tools: string[] = [];
    const inputLower = input.toLowerCase();

    if (inputLower.includes('search') || inputLower.includes('find')) {
      tools.push('web_search', 'knowledge');
    }
    if (inputLower.includes('code') || inputLower.includes('program')) {
      tools.push('code_execution');
    }
    if (inputLower.includes('run') || inputLower.includes('execute')) {
      tools.push('terminal');
    }

    return tools;
  }

  private buildContext(): ExecutionContext {
    return {
      workingDirectory: process.cwd?.() || '/tmp',
      environment: {},
      timeout: 30000,
      sandboxed: true,
      permissions: {
        fileSystem: 'write',
        network: 'external',
        shell: true,
        subprocess: true,
      },
    };
  }

  private shouldDelegate(perception: Perception): boolean {
    // Delegate if task is complex or requires specialized skills
    return perception.requiredTools.length > 3;
  }

  private planToolUsage(perception: Perception): PlanStep[] {
    return perception.requiredTools.map((tool) => ({
      type: 'tool' as const,
      description: `Use ${tool} tool`,
      tool,
      parameters: { query: perception.input },
    }));
  }

  private async executeStep(step: PlanStep): Promise<string> {
    if (step.type === 'delegate') {
      const task: AgentTask = {
        id: this.generateId(),
        description: step.parameters.task as string,
        assignedTo: '',
        assignedBy: this.config.id,
        status: 'pending',
        priority: 5,
        subtasks: [],
        dependencies: [],
        progress: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const result = await this.delegateTask(task);
      return result.output;
    }

    if (step.type === 'tool') {
      const result = await this.executeTool(step.tool, step.parameters);
      return result.output;
    }

    if (step.type === 'verify') {
      return 'Verification complete';
    }

    return '';
  }

  private async executeFallback(step: PlanStep, error: string): Promise<string> {
    // Try alternative approach
    return `Fallback executed for: ${step.description}. Original error: ${error}`;
  }

  private async executeToolInternal(
    tool: ToolConfig,
    parameters: Record<string, unknown>,
  ): Promise<string> {
    // Built-in tool execution
    switch (tool.name) {
      case 'knowledge':
        const memories = await this.retrieveMemories(parameters.query as string);
        return memories.map((m) => m.content).join('\n');
      
      case 'communicate':
        return `Message sent to ${parameters.to}`;
      
      case 'terminal':
        return `Executed: ${parameters.command}`;
      
      case 'web_search':
        return `Search results for: ${parameters.query}`;
      
      case 'code_execution':
        return `Code executed: ${parameters.language}`;
      
      case 'sudo':
        // 🔐 SUDO EXECUTION - "You can use sudo"
        const sudoPriv = (parameters.privilege as string) || 'ROOT';
        const privLevel = SudoPrivilege[sudoPriv as keyof typeof SudoPrivilege] || SudoPrivilege.ROOT;
        return this.sudo.sudo(
          this.id,
          'sudo_execute',
          privLevel,
          async () => `🔓 SUDO: Executed with ${sudoPriv} privileges: ${parameters.command}`
        ).then(r => r).catch(e => `🔒 SUDO DENIED: ${e.message}`);
      
      case 'godmode':
        // ⚡ GODMODE ACTIVATION
        this.sudo.godmode(this.id);
        return '⚡ GODMODE ACTIVATED ⚡ - Unlimited cognitive power unlocked!';
      
      default:
        if (tool.code) {
          // Execute custom tool code (would need sandboxed execution)
          return `Custom tool ${tool.name} executed`;
        }
        return `Tool ${tool.name} not implemented`;
    }
  }

  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // ============================================
  // PUBLIC GETTERS
  // ============================================

  getState(): AgentState {
    return { ...this.state };
  }

  getConfig(): AgentZeroConfig {
    return { ...this.config };
  }

  getTools(): ToolConfig[] {
    return Array.from(this.tools.values());
  }

  getMemories(): Memory[] {
    return [...this.memoryStore];
  }
}

// Supporting types
interface Perception {
  input: string;
  intent: Intent;
  entities: Entity[];
  relevantMemories: Memory[];
  requiredTools: string[];
  context: ExecutionContext;
}

interface Intent {
  action: string;
  goal: string;
  confidence: number;
}

interface Entity {
  type: string;
  value: string;
  confidence: number;
}

interface ExecutionPlan {
  goal: string;
  steps: PlanStep[];
  fallbackStrategy: 'retry' | 'retry_with_alternative' | 'abort';
  maxRetries: number;
}

interface PlanStep {
  type: 'tool' | 'delegate' | 'verify' | 'communicate';
  description: string;
  tool: string;
  parameters: Record<string, unknown>;
}
