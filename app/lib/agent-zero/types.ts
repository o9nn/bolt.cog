/**
 * Agent-Zero Core Types
 * Self-evolving, organic agentic framework
 * Inspired by: https://github.com/frdel/agent-zero
 */

// Agent Identity and Configuration
export interface AgentZeroConfig {
  id: string;
  name: string;
  role: 'superior' | 'subordinate' | 'peer';
  superiorId?: string;
  capabilities: AgentCapability[];
  memory: MemoryConfig;
  tools: ToolConfig[];
  instruments: InstrumentConfig[];
  systemPrompt: string;
  customInstructions?: string;
}

export interface AgentCapability {
  name: string;
  description: string;
  enabled: boolean;
  confidence: number;
  learnedAt?: number;
}

// Memory System - Persistent and Organic
export interface MemoryConfig {
  enabled: boolean;
  vectorStore: 'faiss' | 'chromadb' | 'memory';
  persistPath?: string;
  maxMemories: number;
  embeddingModel: string;
}

export interface Memory {
  id: string;
  type: 'fact' | 'solution' | 'instruction' | 'experience' | 'code';
  content: string;
  embedding?: number[];
  metadata: MemoryMetadata;
  timestamp: number;
  accessCount: number;
  relevanceScore: number;
}

export interface MemoryMetadata {
  source: string;
  context: string[];
  tags: string[];
  relatedMemories: string[];
  confidence: number;
}

// Tool System - Self-Creating Tools
export interface ToolConfig {
  name: string;
  description: string;
  type: 'builtin' | 'custom' | 'generated';
  enabled: boolean;
  code?: string;
  parameters: ToolParameter[];
}

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
  default?: unknown;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: Record<string, unknown>;
  duration: number;
}

// Instrument System - Custom Functions
export interface InstrumentConfig {
  name: string;
  description: string;
  trigger: 'manual' | 'automatic' | 'scheduled';
  code: string;
  dependencies: string[];
  enabled: boolean;
}

// Communication System
export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  type: 'task' | 'report' | 'question' | 'answer' | 'instruction' | 'knowledge';
  content: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  timestamp: number;
  metadata?: Record<string, unknown>;
  requiresResponse: boolean;
  responseDeadline?: number;
}

export interface Conversation {
  id: string;
  participants: string[];
  messages: AgentMessage[];
  context: ConversationContext;
  status: 'active' | 'paused' | 'completed';
}

export interface ConversationContext {
  topic: string;
  goals: string[];
  constraints: string[];
  sharedKnowledge: string[];
}

// Task System
export interface AgentTask {
  id: string;
  description: string;
  assignedTo: string;
  assignedBy: string;
  status: TaskStatus;
  priority: number;
  subtasks: AgentTask[];
  dependencies: string[];
  deadline?: number;
  progress: number;
  result?: TaskResult;
  createdAt: number;
  updatedAt: number;
}

export type TaskStatus = 
  | 'pending'
  | 'in_progress'
  | 'delegated'
  | 'waiting_response'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TaskResult {
  success: boolean;
  output: string;
  artifacts: Artifact[];
  learnings: string[];
  duration: number;
}

export interface Artifact {
  type: 'file' | 'code' | 'data' | 'report';
  name: string;
  content: string;
  path?: string;
}

// Execution System
export interface ExecutionContext {
  workingDirectory: string;
  environment: Record<string, string>;
  timeout: number;
  sandboxed: boolean;
  permissions: ExecutionPermissions;
}

export interface ExecutionPermissions {
  fileSystem: 'none' | 'read' | 'write' | 'full';
  network: 'none' | 'local' | 'external' | 'full';
  shell: boolean;
  subprocess: boolean;
}

export interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  resourceUsage: ResourceUsage;
}

export interface ResourceUsage {
  cpuTime: number;
  memoryPeak: number;
  networkBytes: number;
}

// Learning System
export interface LearningEvent {
  id: string;
  type: 'success' | 'failure' | 'optimization' | 'discovery';
  context: string;
  action: string;
  outcome: string;
  lesson: string;
  confidence: number;
  timestamp: number;
}

export interface SkillAcquisition {
  skill: string;
  proficiency: number;
  practiceCount: number;
  lastPracticed: number;
  examples: string[];
}

// Project System (Isolated Workspaces)
export interface Project {
  id: string;
  name: string;
  description: string;
  prompts: ProjectPrompts;
  files: ProjectFile[];
  memory: Memory[];
  secrets: Record<string, string>;
  settings: ProjectSettings;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectPrompts {
  system: string;
  instructions: string;
  tools: string;
  communication: string;
}

export interface ProjectFile {
  path: string;
  content: string;
  type: 'prompt' | 'code' | 'data' | 'config';
  lastModified: number;
}

export interface ProjectSettings {
  model: string;
  temperature: number;
  maxTokens: number;
  timeout: number;
  autoSave: boolean;
}

// Agent State
export interface AgentState {
  id: string;
  status: 'idle' | 'thinking' | 'executing' | 'communicating' | 'learning' | 'error';
  currentTask?: AgentTask;
  activeConversations: string[];
  subordinates: string[];
  workingMemory: Memory[];
  recentActions: ActionRecord[];
  metrics: AgentMetrics;
}

export interface ActionRecord {
  action: string;
  timestamp: number;
  duration: number;
  success: boolean;
  context: string;
}

export interface AgentMetrics {
  tasksCompleted: number;
  tasksFailed: number;
  averageTaskDuration: number;
  toolsCreated: number;
  memoriesStored: number;
  learningEvents: number;
  uptime: number;
}

// Event System
export type AgentEvent = 
  | { type: 'task_received'; task: AgentTask }
  | { type: 'task_completed'; task: AgentTask; result: TaskResult }
  | { type: 'task_failed'; task: AgentTask; error: string }
  | { type: 'message_received'; message: AgentMessage }
  | { type: 'tool_created'; tool: ToolConfig }
  | { type: 'memory_stored'; memory: Memory }
  | { type: 'learning_event'; event: LearningEvent }
  | { type: 'subordinate_created'; subordinateId: string }
  | { type: 'error'; error: string; context: string };

export type EventHandler = (event: AgentEvent) => void | Promise<void>;
