/**
 * Agent system types for distributed agentic network
 * Defines specialized AI agents that work together
 */

import type { CognitiveContext, SemanticNode, GrammarRule } from './cognitive-grammar';
import type { BoltAction } from './actions';

// Base Agent Interface
export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  capabilities: AgentCapability[];
  status: AgentStatus;
  context: CognitiveContext;
  
  // Core agent methods
  perceive(input: AgentInput): Promise<Perception>;
  reason(perception: Perception): Promise<Reasoning>;
  act(reasoning: Reasoning): Promise<AgentOutput>;
  
  // Communication methods
  sendMessage(targetAgent: string, message: AgentMessage): Promise<void>;
  receiveMessage(message: AgentMessage): Promise<void>;
  
  // Learning methods
  updateKnowledge(experience: Experience): void;
  shareKnowledge(knowledge: Knowledge): void;
}

export type AgentType = 
  | 'grammar'      // Understands syntax and semantics
  | 'context'      // Maintains project understanding
  | 'planning'     // Breaks down complex tasks
  | 'execution'    // Executes specific actions
  | 'coordination' // Manages agent interactions
  | 'learning';    // Improves system over time

export interface AgentCapability {
  name: string;
  description: string;
  inputTypes: string[];
  outputTypes: string[];
  confidence: number;
}

export type AgentStatus = 'idle' | 'thinking' | 'acting' | 'communicating' | 'error';

export interface AgentInput {
  type: 'user_request' | 'agent_message' | 'system_event' | 'code_change';
  content: string;
  metadata: Record<string, unknown>;
  timestamp: number;
  sourceAgent?: string;
}

export interface Perception {
  understood: boolean;
  confidence: number;
  semanticNodes: SemanticNode[];
  missingInfo: string[];
  suggestedActions: string[];
}

export interface Reasoning {
  strategy: 'sequential' | 'parallel' | 'conditional' | 'iterative';
  steps: ReasoningStep[];
  dependencies: string[];
  confidence: number;
  alternatives: AlternativeReasoning[];
}

export interface ReasoningStep {
  id: string;
  description: string;
  action: BoltAction | AgentAction;
  preconditions: string[];
  expectedOutcome: string;
  confidence: number;
}

export interface AgentAction {
  type: 'communicate' | 'analyze' | 'synthesize' | 'validate';
  targetAgent?: string;
  parameters: Record<string, unknown>;
}

export interface AlternativeReasoning {
  description: string;
  confidence: number;
  tradeoffs: string[];
}

export interface AgentOutput {
  type: 'action' | 'response' | 'question' | 'collaboration_request';
  content: string;
  actions: BoltAction[];
  messages: AgentMessage[];
  confidence: number;
  nextSteps: string[];
}

export interface AgentMessage {
  id: string;
  fromAgent: string;
  toAgent: string;
  type: 'request' | 'response' | 'notification' | 'knowledge_share';
  content: string;
  metadata: Record<string, unknown>;
  timestamp: number;
  urgency: 'low' | 'medium' | 'high' | 'critical';
}

export interface Experience {
  situation: string;
  action: string;
  outcome: string;
  feedback: string;
  success: boolean;
  lessons: string[];
}

export interface Knowledge {
  type: 'pattern' | 'rule' | 'fact' | 'heuristic';
  content: string;
  confidence: number;
  context: string[];
  source: string;
}

// Specialized Agent Interfaces
export interface GrammarAgent extends Agent {
  type: 'grammar';
  grammarRules: GrammarRule[];
  parseCode(code: string): SemanticNode[];
  validateSyntax(code: string, language: string): ValidationResult;
  suggestCorrections(errors: SyntaxError[]): Correction[];
}

export interface ContextAgent extends Agent {
  type: 'context';
  projectModel: ProjectModel;
  updateProjectModel(changes: ProjectChange[]): void;
  queryContext(question: string): ContextAnswer;
  trackDependencies(file: string): DependencyGraph;
}

export interface PlanningAgent extends Agent {
  type: 'planning';
  decomposeTasks(task: string): TaskBreakdown;
  prioritizeTasks(tasks: Task[]): Task[];
  allocateResources(tasks: Task[], agents: Agent[]): ResourceAllocation;
  monitorProgress(plan: ExecutionPlan): ProgressReport;
}

export interface ExecutionAgent extends Agent {
  type: 'execution';
  executeAction(action: BoltAction): Promise<ExecutionResult>;
  validateExecution(result: ExecutionResult): ValidationResult;
  rollbackChanges(checkpoint: string): Promise<boolean>;
}

// Supporting Types
interface Warning {
  name: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: Error[];
  warnings: Warning[];
  suggestions: string[];
}

export interface Correction {
  location: { line: number; column: number };
  original: string;
  suggested: string;
  confidence: number;
  explanation: string;
}

export interface ProjectModel {
  structure: FileNode[];
  dependencies: DependencyGraph;
  patterns: CodePattern[];
  conventions: CodingConvention[];
}

export interface ProjectChange {
  type: 'file_added' | 'file_modified' | 'file_deleted' | 'dependency_changed';
  path: string;
  content?: string;
  metadata: Record<string, unknown>;
}

export interface ContextAnswer {
  answer: string;
  confidence: number;
  sources: string[];
  relatedInfo: string[];
}

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}

export interface DependencyNode {
  id: string;
  type: 'file' | 'function' | 'class' | 'variable' | 'module';
  name: string;
  path: string;
}

export interface DependencyEdge {
  from: string;
  to: string;
  type: 'imports' | 'calls' | 'extends' | 'implements' | 'references';
}

export interface TaskBreakdown {
  mainTask: string;
  subtasks: Task[];
  dependencies: TaskDependency[];
  estimatedDuration: number;
}

export interface Task {
  id: string;
  description: string;
  type: 'create' | 'modify' | 'delete' | 'analyze' | 'test';
  priority: number;
  estimatedDuration: number;
  requiredSkills: string[];
  assignedAgent?: string;
}

export interface TaskDependency {
  taskId: string;
  dependsOn: string[];
  type: 'blocking' | 'optional' | 'parallel';
}

export interface ResourceAllocation {
  assignments: AgentAssignment[];
  timeline: TimeSlot[];
  conflicts: ResourceConflict[];
}

export interface AgentAssignment {
  agentId: string;
  taskId: string;
  startTime: number;
  estimatedDuration: number;
  confidence: number;
}

export interface TimeSlot {
  startTime: number;
  endTime: number;
  agentId: string;
  taskId: string;
}

export interface ResourceConflict {
  type: 'agent_overloaded' | 'dependency_unmet' | 'resource_unavailable';
  description: string;
  suggestions: string[];
}

export interface ExecutionPlan {
  tasks: Task[];
  timeline: TimeSlot[];
  checkpoints: Checkpoint[];
}

export interface ProgressReport {
  completedTasks: string[];
  inProgressTasks: string[];
  blockedTasks: string[];
  overallProgress: number;
  estimatedCompletion: number;
  issues: Issue[];
}

export interface Checkpoint {
  id: string;
  timestamp: number;
  state: Record<string, unknown>;
  description: string;
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  errors: Error[];
  changes: FileChange[];
  duration: number;
}

export interface FileChange {
  path: string;
  type: 'created' | 'modified' | 'deleted';
  content?: string;
  diff?: string;
}

export interface Issue {
  type: 'warning' | 'error' | 'blocker';
  description: string;
  affectedTasks: string[];
  suggestedActions: string[];
}

export interface FileNode {
  path: string;
  type: 'file' | 'directory';
  size?: number;
  lastModified?: number;
  children?: FileNode[];
}

export interface CodePattern {
  name: string;
  pattern: string;
  description: string;
  examples: string[];
  frequency: number;
}

export interface CodingConvention {
  name: string;
  rule: string;
  scope: string[];
  examples: { good: string; bad: string }[];
}